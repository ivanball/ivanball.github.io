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
facades**, a **pluggable UI-module** contract, an end-to-end **localization** pipeline, drop-in **role
and user administration** screens, and a turnkey **notification inbox / push / live-channel** feature.
A second, thinner package `MMCA.Common.UI.Web` sits above it and holds the pieces that need an ASP.NET
pipeline (server-side token storage, the Blazor Content-Security-Policy provider, the
trusted-caller header an SSR host stamps on its gateway calls, and the host's own edge rate limiter
and ceiling on open circuits, plus an opt-in same-origin API proxy that keeps every token out of script). The per-app and per-module Razor pages in the consumer apps
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
(`MMCA.Common.UI/Services/Api/EntityServiceBase.cs:43`), which derives in turn from
[`AuthenticatedServiceBase`](#authenticatedservicebase)
(`MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:16`). That base owns the cross-cutting concerns
of an outbound call. First, a **Polly** retry policy: 3 retries with exponential backoff (2s, 4s, 8s)
plus up to one second of random jitter so a fleet of clients does not re-converge on the same instant
(`AuthenticatedServiceBase.cs:20-27`, `:153-155`), over a deliberate retryable set rather than "any
5xx", since 501 and 505 are permanent verdicts and are excluded while 408 and 429 are explicit
invitations to come back (`AuthenticatedServiceBase.cs:97-122`). A POST or PATCH is replayed only
when its request carried an `Idempotency-Key`, because re-sending a write the server cannot dedupe
could apply it twice (`:115-118`, `:134-148`). The policy's `onRetry` disposes each
superseded response, because Polly hands the caller only the final outcome and an undisposed 5xx
leaks its content buffer and holds its connection out of the pool under exactly the sustained failure
the retries exist to survive (`AuthenticatedServiceBase.cs:163-173`). Second, a helper that creates a
`"APIClient"` `HttpClient` from `IHttpClientFactory` and stamps the JWT Bearer token onto it from
[`ITokenStorageService`](#itokenstorageservice), swallowing the `InvalidOperationException` that JS
interop throws during SSR prerender (`AuthenticatedServiceBase.cs:53-78`); a sibling
`CreateClientWithToken` builds a client around an explicitly supplied token so a request the API
answered `401` can be replayed with one acquired straight from [`ITokenRefresher`](#itokenrefresher)
rather than resending the token the server just rejected (`AuthenticatedServiceBase.cs:80-95`).
The same policy object is reachable without inheritance: [`IdempotentReadRetry`](#idempotentreadretry)
(`MMCA.Common.UI/Services/Api/IdempotentReadRetry.cs:18`) hands anonymous lookup services the exact
instance the base exposes to its subclasses, so the two paths cannot drift, and its only entry point
is a GET because re-sending is safe only for an idempotent read (`IdempotentReadRetry.cs:9-16`, `:24`,
`:35-44`, `AuthenticatedServiceBase.cs:34-38`). Its read-side sibling [`PagedReadAll`](#pagedreadall)
(`MMCA.Common.UI/Services/Api/PagedReadAll.cs:19`) exists because a single read truncates silently at
the API's page-size maximum: it pages a `/paged` endpoint in stable id order with a `PageSize` of 500
until the server's reported total is reached, hands back the first failure unchanged, and stops after
40 pages (20,000 rows) whatever the server claims (`PagedReadAll.cs:12-18`, `:22`, `:28`, `:43-46`,
`:57-90`).

Retry and idempotency are coupled on purpose: `NewIdempotencyKey()`
(`AuthenticatedServiceBase.cs:51`) is generated **once per logical write** and set as a default header
on the single client that serves every attempt (`EntityServiceBase.cs:168-175`, `:399-414`), so a
retried create dedupes on the server instead of producing a duplicate row (the server half is
[`IdempotencyHeaders`](group-08-auth.md#idempotencyheaders) and
[`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute),
[ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). Creates are the only
verb that carries a key: updates are full PUTs and deletes are naturally idempotent
(`EntityServiceBase.cs:168-170`). Updates instead carry a precondition: `ConcurrencyTagOf` renders a
DTO's `RowVersion` as a weak entity tag when the DTO implements
[`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), and that tag travels as the
`If-Match` header on the same per-operation client, so every retry states the same precondition
instead of a later attempt succeeding against a version the user never saw
(`EntityServiceBase.cs:193-209`, `:416-424`,
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Responses come back
in the same [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) /
[`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) envelopes the API
returns, and both `SendRequestAsync` overloads read the response through
[`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader)
(`EntityServiceBase.cs:351-366`, `:381-394`), so a 404 arrives as an
[`ErrorType`](group-01-result-error-handling.md#errortype)`.NotFound` failure, a rejection as
`Validation`, a 500 as `Unexpected`, each carrying the server's own text. What the reader cannot
convert is the *absence* of a response, and that is
[`HttpResultExecutor`](#httpresultexecutor)'s job
(`MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:35`): it wraps each call, turns a refused connection,
a broken stream or an unreadable body into `Http.TransportFailure` and a client-side timeout into
`Http.Timeout` (`HttpResultExecutor.cs:38`, `:41`, `:135-136`), and rethrows an
`OperationCanceledException` **only** when the caller's own token asked for it, because a page owns
its cancellation and must not have a disposed component reported back as an error to render
(`HttpResultExecutor.cs:69-75`, `:104-110`). Many-to-many join endpoints, which have POST and DELETE but no
standalone reads, get their own thinner base, [`ChildEntityServiceBase`](#childentityservicebase)
(`MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:19`), whose `DeleteByIdAsync` reports a missing
join row as a `NotFound` failure so "nothing to remove" stays distinguishable from "the remove
failed" (`ChildEntityServiceBase.cs:62-79`). The page-side half of the same transport is
[`ResultUiExtensions`](#resultuiextensions)
(`MMCA.Common.UI/Common/ResultUiExtensions.cs:74`): `TryGetValue` unwraps inside a conditional the way
`Dictionary.TryGetValue` does, branching on `IsFailure` rather than on a null so a failed
`(Items, TotalItems)` tuple is not read as a success (`ResultUiExtensions.cs:86-103`), and the
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
rendered in two components) costs one round trip. Its operations are `TryGetFresh`, `Set`,
`InvalidatePrefix` and `Clear` (`IUiReadCache.cs:50`, `:59`, `:78`, `:85`), plus a `Generation` counter that moves on every
invalidation (`:35-40`), and the key is
**deliberately the relative URL, path plus the full query string**, which is the same key shape the
server's authenticated output cache uses, so a filter, page or sort change misses on both tiers
rather than being served stale by one of them (`IUiReadCache.cs:9-15`,
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
[`UiReadCache`](#uireadcache) (`MMCA.Common.UI/Services/Caching/UiReadCache.cs:18`) implements it as a
lock-guarded ordinal dictionary (`UiReadCache.cs:20`, `:25`) with **lazy** expiry, dropping a stale
entry when it is next read instead of running a sweep timer over the few dozen entries a circuit ever
holds (`UiReadCache.cs:12-14`, `:68`, `:76`), and TTL resolution picks the **longest** matching route
prefix so a child route can state a different budget than the endpoint it sits under
(`UiReadCache.cs:157-178`). Staleness is configuration, not accident:
[`UiReadCacheOptions`](#uireadcacheoptions)
(`MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:13`) binds the `UiReadCache` section with an
`Enabled` escape hatch, a 60-second `DefaultTtl` and the per-prefix override map
(`UiReadCacheOptions.cs:16`, `:24`, `:32`, `:41`). `EntityServiceBase` takes the cache as an
**optional** constructor argument, so a service registered without one behaves exactly like a plain
GET (`EntityServiceBase.cs:47`, `:58`, `:253-284`), and a `bypassCache` flag forces a round trip
for a read the user explicitly asked to be current (`:243-247`); only successes are stored, because caching a
failure would pin a transient outage in front of the user for the whole TTL and let a 404 survive the
create that fixed it (`EntityServiceBase.cs:276-281`), while the generation captured before the GET
drops a late store that a concurrent write has already made stale (`:270-273`,
`IUiReadCache.cs:63-70`); and every write invalidates its own endpoint prefix unless the server
refused it before touching state (a validation, unprocessable, unauthorized, forbidden or
rate-limited answer), because a 412, 404 or 409 can be the answer to the retry of a write whose first
attempt landed, and a 5xx or transport failure says nothing about whether it did
(`EntityServiceBase.cs:291-314`). The one cross-cutting hazard is scope: the cache is
scoped, which is per-circuit on Blazor Server but per **app lifetime** on WebAssembly and MAUI, so
[`AuthUIService`](#authuiservice)`.LogoutAsync` clears it explicitly rather than trusting the scope to
end with the session (`MMCA.Common.UI/Services/Auth/AuthUIService.cs:88`, the clear at `:190`; the
registration states why at `MMCA.Common.UI/DependencyInjection.cs:73-76`); the device-local document
cache that backs offline list snapshots is wiped in the same pass, since those snapshots are keyed by
surface rather than by user (the optional `ILocalCacheStore` dependency, `AuthUIService.cs:51`). `[Rubric §12, Performance & Scalability]` and `[Rubric §19, State
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
(`DataGridListPageBase.cs:53`, set at `:752` and `:773`), **viewport-driven mobile versus desktop
rendering** (it implements `IBrowserViewportObserver` and flips `IsMobile` through
[`BreakpointConstants`](#breakpointconstants) at the 960 px sidebar-collapse boundary,
`DataGridListPageBase.cs:22`, `:322`, and
`MMCA.Common.UI/Common/BreakpointConstants.cs:16-17`), a persisted dense-density toggle
(`DataGridListPageBase.cs:83`), and a careful `IAsyncDisposable`/`IDisposable` teardown. The fetch
path is Result-shaped end to end: a failed page toasts through
`NotifyOnFailure(Toast, Localizer)` and returns an empty grid rather than throwing
(`DataGridListPageBase.cs:772-773`). It also solves a Blazor render-mode problem: grid data captured
during SSR prerender is persisted through `PersistentComponentState` as a private
[`PersistedGridState`](#persistedgridstate) record (`DataGridListPageBase.cs:1132`), restored in
`OnInitialized` (`:179-189`) and re-registered for persisting with an **explicit**
`RenderMode.InteractiveAuto`, because a page that inherits its render mode from `<Routes>` gives the
framework nothing to associate the callback with (`DataGridListPageBase.cs:191-208`,
[ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)). A
`PrerenderFetchTimeoutMs` of 5000 caps how long prerender may block on a cold backend before falling
back to an empty grid the first interactive fetch refills (`DataGridListPageBase.cs:95`, applied at
`:820`). That fetch links the timeout to the page's own lifetime token, read through
[`ComponentLifetimeExtensions`](#componentlifetimeextensions)`.LifetimeToken`
(`DataGridListPageBase.cs:816-817`, `MMCA.Common.UI/Common/ComponentLifetimeExtensions.cs:18`, `:26`):
reading `Token` off a disposed `CancellationTokenSource` throws `ObjectDisposedException`, so a load
that resumed after the user navigated away would crash the circuit, whereas the extension returns an
already-cancelled token and the work stops through its ordinary cancellation path
(`ComponentLifetimeExtensions.cs:3-11`, `:28-41`). `LatestLoadGuard` and `DetailPageBase` read their
tokens the same way (`LatestLoadGuard.cs:58`, `DetailPageBase.cs:36`), and
`LifetimeTokenConventionTestsBase` pins the rule in each repo (`ComponentLifetimeExtensions.cs:13-14`). `[Rubric §23, Front-End Performance & Rendering]` assesses render efficiency and avoided
round-trips; this persist-and-restore dance is that concern made concrete. Around the base sit three
smaller helpers that are deliberately *not* members of it, so a page composing its own layout can
still use them: [`ListPageActions`](#listpageactions)
(`MMCA.Common.UI/Pages/Common/ListPageActions.cs:15`) holds the mobile-versus-desktop reload dispatch
and the confirm-delete-reload flow every organizer list page repeats (`:25-38`, `:56`);
[`LatestLoadGuard`](#latestloadguard) (`MMCA.Common.UI/Common/LatestLoadGuard.cs:38`) gives each load
a generation and a token and cancels the previous one, which is what keeps a routed detail component
(reused by Blazor across route-parameter changes) from rendering entity 100's late answer after the
user has navigated to 101 (`LatestLoadGuard.cs:50-59`, `:67`); and
[`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem)
(`MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:29`) records the first page of a list into
[`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) as a private
[`CachedPage`](#cachedpage) record (`:39`) and serves it back **only** when the device reports itself
offline, the store is available and the request is page 1, so the live path is untouched
(`OfflineFirstPageSnapshot.cs:43`, `:49`, `:67`). The single-aggregate counterpart of the list base
is [`DetailPageBase`](#detailpagebase)
(`MMCA.Common.UI/Pages/Common/DetailPageBase.cs:26`), an abstract `ComponentBase` that owns what
every detail page loaded by route id otherwise repeats: a page-scoped `PageToken` that cancels
in-flight work when the page goes away (`:36`), a `LatestLoadGuard` for route-driven reloads (`:43`),
and the inline edit lifecycle, where `BeginEdit` and `EndEdit` both reset `IsDirty` so the flag an
unsaved-changes guard reads can never be left set behind a closed editor (`:46-49`, `:68-79`,
rationale at `:15-19`). A derived page keeps only its load, its edit-model copy and its save, and
releases its own disposables in a `Dispose(bool)` override that calls the base last (`:22-23`,
`:86-101`). `[Rubric §22, Responsive &
Cross-Browser]` is named by `BreakpointConstants` and exercised by
[`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem)
(`MMCA.Common.UI/Components/Lists/MobileInfiniteScrollList.razor.cs:20`), the mobile card list whose
IntersectionObserver sentinel, 500-item `MaxRenderedItems` cap (`:52`) and generation-guarded
supersession of in-flight fetches keep a long list bounded; a page that wants infinite scroll without
giving up its own card markup renders [`InfiniteScrollSentinel`](#infinitescrollsentinel) alone
(`MMCA.Common.UI/Components/Lists/InfiniteScrollSentinel.razor.cs:21`), which owns just the observer and is
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
(`MMCA.Common.UI/DependencyInjection.cs:175-177`). `[Rubric §25, Navigation & Information
Architecture]` covers the route catalogue ([`RoutePaths`](#routepaths)
(`MMCA.Common.UI/Common/RoutePaths.cs:7`), [`NavItem`](#navitem) with its role, claim, permission,
section and group facets plus resource-key titles resolved per circuit
(`MMCA.Common.UI/Common/NavItem.cs:20`), and the [`NavSection`](#navsection) enum whose declaration
order is the sidebar order, `MMCA.Common.UI/Common/NavSection.cs:7-17`) and the open-redirect guard
[`ReturnUrlProtector`](#returnurlprotector), which accepts only same-origin relative paths beginning
with a single forward slash and rejects protocol-relative forms, backslashes, control characters and
anything that does not parse as a relative URI, replacing each with a fallback
(`MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:18-60`).

**Authentication, the host-polymorphic token refresh, and the devices page.** Client-side auth is
contracted by [`IAuthUIService`](#iauthuiservice)
(`MMCA.Common.UI/Services/Auth/IAuthUIService.cs:18`), whose members are Result-returning like the
entity services, and implemented by [`AuthUIService`](#authuiservice)
(`MMCA.Common.UI/Services/Auth/AuthUIService.cs:44`), which calls the WebAPI `auth/*` endpoints,
persists tokens through [`ITokenStorageService`](#itokenstorageservice), pushes auth-state changes
through [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) so `AuthorizeView` reacts
immediately, and coordinates push-registration through the device-capability contract
[`IPushRegistrationService`](group-26-device-capability-layer.md#ipushregistrationservice)
(`AuthUIService.cs:49`). Two named codes make its local-only failures legible rather than null:
`Auth.TokenStorageUnavailable` when the sign-in succeeded but JS interop could not persist the tokens,
and `Auth.MissingAccessToken` when a 2xx carried no usable token, which means the response shape
drifted (`AuthUIService.cs:57`, `:63`). The provider round trip is bound to the client that started
it: [`OAuthFlowStateStore`](#oauthflowstatestore)
(`MMCA.Common.UI/Services/Auth/OAuth/OAuthFlowStateStore.cs:20`) mints a 32-character random hex value
before the challenge and persists it to device-local storage under `auth.oauth-flow` as a private
[`PendingAttempt`](#pendingattempt) record (`:23`, `:53-56`, `:89`), then refuses a completion whose
returned state does not match, or whose attempt is older than the 10-minute lifetime, removing the
attempt either way so one value is redeemable exactly once (`:29`, `:68-87`). The reason that matters
is stated on the type: the completion code is a bearer value, so without a binding an attacker can
complete the provider flow with their own account and hand the victim the completion link, signing the
victim's app in as the attacker (`OAuthFlowStateStore.cs:8-16`). A host with no durable storage at all
reports `IsEnforced` false and keeps the previous behavior, because nothing can be written across the
redirect (`:39`, `:48-51`, `:70-73`). Alongside login, register, OAuth exchange, logout, refresh and
change-password, it carries the self-service reset pair (`IAuthUIService.cs:60`, `:67`,
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)) and the
multi-device session pair: `GetSessionsAsync` lists the caller's live refresh sessions newest first
and `RevokeSessionAsync` ends one of them (`IAuthUIService.cs:75`, `:84`,
[ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). Those two are
rendered by the framework-owned [`Sessions`](#sessions) page
(`MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:27`), reachable at `/profile/sessions`
(`RoutePaths.cs:16`), which deliberately offers **two** revoke paths: a per-row sign-out that ends one
other device's session, and a page-level sign-out-everywhere that also ends the caller's own and is
therefore followed by the local logout and a redirect. The current device's row carries no button at
all, since revoking it from here would leave the app signed in on a dead session until the access
token expired (`Sessions.razor.cs:16-24`, `:110-112`). The page-level path is
`RevokeAllSessionsAsync`, which signs out locally only once the server confirmed the revoke
(`IAuthUIService.cs:94`), and one busy flag disables every button while any revoke is in flight, so a
second click cannot race the list rebuild (`Sessions.razor.cs:52-55`). Each row is labelled from
[`UserAgentSummary`](#useragentsummary) (`MMCA.Common.UI/Services/Auth/UserAgentSummary.cs:18`), which
extracts a browser and a platform from the raw header with the most specific token winning (every
Chromium browser also says "Chrome", and Chrome and Edge both say "Safari",
`UserAgentSummary.cs:20-38`) and returns the two parts **separately**, because composing "Chrome on
Windows" in code would hard-code English word order (`UserAgentSummary.cs:13-16`).

Email confirmation
([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)) ships the same
way, as a framework page over a framework client. [`IEmailConfirmationUIService`](#iemailconfirmationuiservice)
(`MMCA.Common.UI/Services/Auth/IEmailConfirmationUIService.cs:21`) is a separate interface rather than
two new `IAuthUIService` members, so a consumer's own `IAuthUIService` implementation keeps compiling
(`MMCA.Common.UI/DependencyInjection.cs:164-166`). Its two anonymous, Result-returning calls redeem a
link's single-use token and ask for a fresh link, the latter answering success on any well-formed
request because the endpoint returns 202 whether or not the address holds an account
(`IEmailConfirmationUIService.cs:28`, `:30-38`). The in-box
[`EmailConfirmationUIService`](#emailconfirmationuiservice)
(`MMCA.Common.UI/Services/Auth/EmailConfirmationUIService.cs:23`) is deliberately **not** built on the
entity-service bases: the token is single-use and the resend spends a per-address request budget, so
a retried POST could only spend either one twice. It takes the `"APIClient"` straight from the factory,
posts exactly once and reads the answer through `ProblemDetailsResultReader` inside
`HttpResultExecutor` (`EmailConfirmationUIService.cs:13-21`, `:35-48`). The anonymous
[`ConfirmEmail`](#confirmemail) page (`MMCA.Common.UI/Pages/Auth/ConfirmEmail.razor.cs:36`, routed at
`/confirm-email`, `ConfirmEmail.razor:1`) reads the email and token from the URI **fragment**, which
a browser never sends to a server, so the live token stays out of ingress logs, request telemetry
and `Referer` headers; the `locationHashTake` interop call also scrubs it from the address bar and
history, with query-string parameters honored as a fallback (`ConfirmEmail.razor.cs:17-22`, `:139`).
A link carrying both values is redeemed once on the first interactive render, a link missing either
lands on manual entry without posting a request that can only be refused, and a refused token keeps
the form with the API's own message and a resend button (`:25-30`, `:108-128`). What the page shows
is the private three-value [`ConfirmationState`](#confirmationstate) enum, `Working`, `Form` and
`Confirmed` (`ConfirmEmail.razor.cs:50-60`).

The refresh is the interesting part: one [`ITokenRefresher`](#itokenrefresher) abstraction
(`MMCA.Common.UI/Services/Auth/Tokens/ITokenRefresher.cs:17`) has two implementations picked per host,
[`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) for the browser (the refresh token
lives in an HttpOnly cookie and rotation happens server-side behind a same-origin
`/auth/session/token` proxy, so JS never sees it) and
[`DirectApiTokenRefresher`](#directapitokenrefresher) for MAUI (the refresh token sits in OS
SecureStorage and is exchanged directly against `auth/refresh`). Storage is host-polymorphic in the
same way: [`WasmTokenStorageService`](#wasmtokenstorageservice) holds the access token in memory only
and single-flights its re-acquisition behind a lock, since an unguarded `??=` lets two callers each
start a hydrate and the later one overwrite the other's token
(`MMCA.Common.UI/Services/Auth/Tokens/WasmTokenStorageService.cs:22`, `:22-38`), while
[`ServerTokenStorageService`](#servertokenstorageservice) reads the HttpOnly cookie through
[`CookieTokenReader`](group-08-auth.md#cookietokenreader) whenever a live `HttpContext` exists (SSR
prerender) and switches to the in-memory token on the interactive circuit
(`MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:30`, `:30-43`,
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). The same `AddCommonServerTokenStorage()` also puts
[`BrowserOriginHandler`](#browseroriginhandler)
(`MMCA.Common.UI.Web/Services/BrowserOriginHandler.cs:32`) on the server-side `"APIClient"`
(`MMCA.Common.UI.Web/DependencyInjection.cs:41`, `:47-48`): a Blazor Server host calls the API on the
visitor's behalf, and without it every visitor would share the host's own address and send no
user-agent, so the registration rate limit and the session's recorded IP and device would key on the
host. It forwards `X-Forwarded-For` from the request's `RemoteIpAddress`, which has already been
through this host's forwarded-headers middleware rather than copied from whatever the client sent,
plus the browser's `User-Agent`, replacing any value already present and sending nothing when no
request is in scope (`BrowserOriginHandler.cs:5-29`, `:47-52`, `:57-68`). A third
contract, [`ISecureTokenStore`](#isecuretokenstore)
(`MMCA.Common.UI/Services/Auth/Tokens/ISecureTokenStore.cs:16`), is raw persistence with **no** freshness
semantics, and it exists to keep the MAUI graph acyclic: storage depends on the refresher, the
refresher depends on the raw store, and there is no loop (`ISecureTokenStore.cs:5-14`). A refresher can also say *why* it came back
empty. `ITokenRefresher` answers null both for "there is no session" and for a transient failure, so
the optional [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher)
(`MMCA.Common.UI/Services/Auth/Tokens/ISessionAwareTokenRefresher.cs:12`) adds
`TryAcquireAccessTokenAsync`, which returns a [`TokenAcquisition`](#tokenacquisition)
(`MMCA.Common.UI/Services/Auth/Tokens/TokenAcquisition.cs:9`): `NoSession` for the endpoint's 401,
`Unavailable` for a 429 or 5xx, a dropped connection, missing JS interop or a cancelled call, and
`Acquired(token)` otherwise (`ISessionAwareTokenRefresher.cs:17`, `TokenAcquisition.cs:3-8`, `:18`,
`:21`, `:35`). Storage that remembers a "no session" answer for an anonymous grace period starts the
grace only on the definitive kind, so one 429 cannot sign a signed-in user out for the whole window,
and a refresher that does not implement the interface keeps the old reading of null as "no session"
(`ISessionAwareTokenRefresher.cs:3-11`). On
WebAssembly the first hydration (a JS interop hop for the session cookies plus a same-origin token
exchange) would otherwise run inline on whichever API call the user makes first, so a client host
may start [`TokenHydrationWarmup`](#tokenhydrationwarmup)
(`MMCA.Common.UI/Services/Auth/Tokens/TokenHydrationWarmup.cs:26`) after `builder.Build()` and
discard the task, letting it overlap first render instead of delaying it (`:11-15`). It only reads
through `ITokenStorageService.GetAccessTokenAsync`, which never forces a refresh, so an anonymous
visitor gets a no-op, and it swallows and debug-logs every failure because the first real call
hydrates again with its own handling (`TokenHydrationWarmup.cs:18-22`, `:36-57`); the ADC client
wires it that way (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:92`). The
[`ISessionCookieSync`](#isessioncookiesync) / [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)
pair mirrors the in-memory access token into the cookie by firing the fetch **from the browser**, so
the `Set-Cookie` lands in the user's own jar under both render modes, and both calls report
whether the jar was actually updated, `false` on a non-2xx answer or when JS interop is unavailable
(`MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8-19`, `JsFetchSessionCookieSync.cs:26-34`). All three storage services agree
on one 30-second expiry skew read through [`JwtTokenInfo`](#jwttokeninfo)`.IsFresh`
(`MMCA.Common.UI/Services/Auth/Tokens/JwtTokenInfo.cs:16-37`, used at `WasmTokenStorageService.cs:15,24` and
`ServerTokenStorageService.cs:41`), which parses the token client-side **without validating its
signature**, because the API validates every request. Every outbound call also passes
[`AuthDelegatingHandler`](#authdelegatinghandler), which attaches the stored bearer token to requests
that do not go through `CreateAuthenticatedClientAsync`
(`MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:14`), except one that sets its `SkipBearer` request
option: the token-refresh POST does, because that endpoint is anonymous and reading storage from
inside a refresh would re-enter the very acquisition waiting on it (`AuthDelegatingHandler.cs:9-19`). The lifecycle across render modes is
[ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html); the cross-service
JWKS validation these tokens flow into is
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html).

**An opt-in same-origin API proxy: no token in the page at all.** By default a browser client still
holds an access token in memory, the one `/auth/session/token` hands to script. A Blazor Web host can
remove even that by calling `AddCommonSameOriginApiProxy(configuration)` and
`MapCommonSameOriginApiProxy()` from `MMCA.Common.UI.Web`, a backend-for-frontend in which the browser
calls `/api/**` on the UI host's own origin and the host forwards to the gateway with the bearer taken
from the HttpOnly session cookie
([`SameOriginApiProxyServiceExtensions`](#sameoriginapiproxyserviceextensions),
`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:12-18`, `:51`;
[`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions),
`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpointExtensions.cs:15`, `:33`).
[`SameOriginApiProxySettings`](#sameoriginapiproxysettings)
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:21`) binds `SameOriginApiProxy`
with a default for every value, so a host opts in with no section at all: a `/api` `PathPrefix`, a
`GatewayAddress` that falls back to `Api:ApiEndpoint` so a service-discovery name resolves exactly as
it does for the host's own clients, `auth/login`, `auth/register` and `auth/oauth/exchange` as the
token-issuing paths, `auth/refresh` and `auth/revoke`, and `SameSite=Strict` session cookies (`:31`,
`:38`, `:46`, `:52`, `:59`, `:66`, `:74`; the gateway fallback at
`SameOriginApiProxyServiceExtensions.cs:57-64`).
[`SameOriginApiProxySettingsValidator`](#sameoriginapiproxysettingsvalidator)
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettingsValidator.cs:14`) runs on start and
refuses a prefix or path carrying route syntax, a query, a fragment or whitespace, a gateway that is
not an absolute address, and any `SameSite` other than `Strict` or `Lax`, because a cookie that
authenticates data calls must never ride on a cross-site request (`:7-13`, `:16`, `:26-49`). Opting in
also makes the session cookies claims-only toward the browser and has `/client-config` advertise the
proxy, which is what moves the WebAssembly `"APIClient"` and notification hub onto it
(`SameOriginApiProxyServiceExtensions.cs:21-28`, `:69-74`).

Each request runs through [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint)
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:29`) in a fixed order (`:15-28`).
A foreign `Origin` or `Sec-Fetch-Site` is refused with 403 before anything else, and a WebSocket
upgrade must carry this host's own `Origin`, because an upgrade is not CORS-protected and the origin
is the only proof of who opened it (`:115-131`, `:232-237`); `OPTIONS` is answered locally with 204
and no CORS grant, so the gateway's CORS policy is never consulted on the proxy's behalf
(`:241-245`); and every unsafe method must carry the `X-CSRF: 1` header named by
[`SameOriginProxyHeaders`](#sameoriginproxyheaders)
(`MMCA.Common.UI/Services/Auth/SameOriginProxyHeaders.cs:11`, `:14`, `:17`), the one exemption being
an HTTP/2 WebSocket, to which a browser cannot add a header (`SameOriginApiProxyEndpoint.cs:250-254`).
The header is defense in depth behind the origin check and carries no secret
(`SameOriginProxyHeaders.cs:3-9`). The session step then validates or refreshes the cookie's access
token through the single-flighted `ICookieSessionRefresher`: a refused refresh token clears the
cookies and answers 401, while a refresh that could not be decided keeps them and answers 503 with
`Retry-After`, so a blip at the identity endpoint does not sign the user out (`:22-25`, `:261-284`).
A browser POST to the refresh path is answered by the proxy itself from the refresh cookie
(`:351-356`), and a safe method the gateway answers 401 gets one forced refresh and one replay, never
an unsafe one whose body the upstream could apply twice (`:313-328`). The per-request YARP transform
is [`SameOriginProxyTransformer`](#sameoriginproxytransformer)
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:34`): it maps `{prefix}/rest` to
`{gateway}/rest`, replaces whatever `Authorization` the browser sent with the session's bearer, and
keeps the session cookies and the CSRF header off the upstream request (`:26-33`, `:55-62`). Its
[`ProxyResponseMode`](#proxyresponsemode) (`:14`) picks the response treatment: `Forward` copies,
`TokenIssuing` moves a sign-in's token pair into the cookies and sends the browser the same JSON with
a claims-only `accessToken` and an empty `refreshToken` under `no-store`, and `Revoke` clears the
cookies whatever the upstream answered, so a failed revoke cannot strand the user in a session
(`:16-23`, `:84-95`, `:100-145`). Forwarding goes through
[`SameOriginProxyInvoker`](#sameoriginproxyinvoker)
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyInvoker.cs:19`), one `HttpMessageInvoker` built
the way YARP requires rather than taken from `IHttpClientFactory`: no cookie container, which would
replay one user's upstream cookies on another user's request, no redirects or decompression, and none
of the host's default handlers, since a retry would replay a streamed body and the trusted-caller
header would exempt every browser request from the gateway's rate limiter (`:9-18`, `:50-58`). On the
client, [`SameOriginProxyRequestHandler`](#sameoriginproxyrequesthandler)
(`MMCA.Common.UI/Services/Auth/SameOriginProxyRequestHandler.cs:11`) is the innermost `"APIClient"`
handler: it strips any `Authorization` header, since the client only ever holds a claims-only token,
and stamps the CSRF header (`:3-10`, `:18-20`).

The Blazor Server circuit keeps calling the gateway server-to-server, but its tokens still have to
meet the browser's cookie jar, which it can reach only through a script `fetch`. The proxy therefore
replaces the circuit's `ITokenRefresher` and `ISessionCookieSync` with
[`HandoffTokenRefresher`](#handofftokenrefresher) and
[`HandoffSessionCookieSync`](#handoffsessioncookiesync)
(`SameOriginApiProxyServiceExtensions.cs:83-84`,
`MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:14`, `:39`), which trade only
ciphertext with the page. [`SessionHandoffProtector`](#sessionhandoffprotector)
(`MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffProtector.cs:16`) encrypts and signs with the
host's data-protection key ring under one purpose each way, so an access-token handoff can never be
replayed as a cookie write, and expires a handoff after one minute (`:7-15`, `:19`, `:23-27`); a
tampered, expired or wrong-purpose value unprotects to null (`:57-72`), and the cookie direction
serializes the pair as the private [`TokenPair`](#tokenpair) record (`:33-34`, `:75`).
[`SessionHandoffEndpoints`](#sessionhandoffendpoints)
(`MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffEndpoints.cs:15`) maps the two halves,
`POST /auth/session/handoff` (validate-or-refresh from the cookies, answered with a protected access
token) and `POST /auth/session-cookie/handoff` (seed the cookies from a protected pair), both
requiring the CSRF header and both exchanging the [`HandoffBody`](#handoffbody) `{ "handoff": "..." }`
record (`:17-18`, `:23-60`, `:64`). Because a registration that lands later would silently put the
access token back in the page, `MapCommonSameOriginApiProxy` resolves both services and fails the boot
naming the culprit when either is not the handoff implementation, and it also fails when
`AddCommonSameOriginApiProxy` was never called, which it detects through the internal
[`SameOriginApiProxyMarker`](#sameoriginapiproxymarker)
(`SameOriginApiProxyEndpointExtensions.cs:38-44`, `:59-92`,
`SameOriginApiProxyServiceExtensions.cs:91-92`). `[Rubric §26, Front-End Security]` is the home
category: with the proxy on, no token is readable by script on the page.

**Front-end security beyond tokens.** `[Rubric §26, Front-End Security]` assesses token handling, XSS
exposure and secret storage, and this group answers it in five places: keeping the refresh token out
of JS-reachable storage (above); [`BlazorCspPolicyProvider`](#blazorcsppolicyprovider), which pins
`connect-src` to `'self'` plus the configured API/Gateway origin and its `wss` form for the SignalR
hub (`MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`, `:49-79`) and, when the endpoint
cannot be parsed, **fails closed**: `connect-src` narrows to `'self'` and the policy stays *enforced*,
so a misconfiguration surfaces immediately as blocked calls in the console rather than as a
Report-Only header that protects nothing and nobody notices (`BlazorCspPolicyProvider.cs:16-20`,
`:60-62`), feeding the shared
[`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) through
[`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider);
[`WebApplicationExtensions`](#webapplicationextensions)`.UseAuthenticatedNoStore`, which emits
`Cache-Control: no-store` on authenticated HTML so a logged-out user pressing Back never sees the
previous user's page out of the bfcache while anonymous pages stay bfcache-eligible
(`MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:24-44`); the `returnUrl` sanitizer already
covered; and, on a native head, the app-lock overlay [`BiometricGate`](#biometricgate)
(`MMCA.Common.UI/Components/Capabilities/BiometricGate.razor.cs:18`), which re-arms once the app has
sat in the background longer than its 30-second `ReLockAfter` parameter, short by design because a
device handed to someone else is usually away for longer than a glance at a notification
(`BiometricGate.razor.cs:19-25`). It subscribes to the resume event regardless of the current
preference, since app lock can be switched on later in the same session and the handler re-reads the
preference every time it fires (`:52-55`), and it moves focus onto the unlock button once the locked
branch has actually rendered, so the panel is a real interaction boundary rather than a picture of one
(`:31-45`).

The CSP has exactly one host-configurable allowance, and it is configured rather than coded.
[`BlazorCspSettings`](#blazorcspsettings)
(`MMCA.Common.UI.Web/Security/BlazorCspSettings.cs:18`) binds the `BlazorCsp` section and carries a
single `FrameSources` list, the https origins this host's pages may embed in an `iframe` (`:21`,
`:35`); with the default empty list the provider emits no `frame-src` directive at all, so frames
fall back to `default-src 'self'` and the baseline policy stays byte-identical
(`BlazorCspPolicyProvider.cs:85-90`), and when the list is non-empty the origins are canonicalized to
`scheme://host[:port]` and de-duplicated ordinally before being joined into `frame-src 'self' ...`
(`BlazorCspPolicyProvider.cs:92-96`, `BlazorCspSettingsValidator.cs:61-62`). `frame-ancestors 'none'`,
which governs who may frame *this* host, is never relaxed by any of it
(`BlazorCspPolicyProvider.cs:113`). Because each entry is spliced verbatim into a security response
header, the value is validated at startup rather than at first use:
[`BlazorCspSettingsValidator`](#blazorcspsettingsvalidator)
(`MMCA.Common.UI.Web/Security/BlazorCspSettingsValidator.cs:13`) is registered with `ValidateOnStart`
and rejects anything that is not a plain https origin, refusing whitespace and the character set
`*'";,@?#` outright (`:19`, `:42-48`) and then requiring the `https` scheme, a non-empty host and a
root-only path (`:52-54`), with a failure message naming the offending entry so the boot log says
which one (`:26-36`). The reasoning is on the type: a quote, semicolon or space could smuggle a
keyword or a whole new directive into the policy, and a wildcard or bare scheme would widen
`frame-src` to arbitrary sites (`BlazorCspSettingsValidator.cs:6-12`). The options registration and
the validator are added by the same `AddCommonBlazorCsp()` that registers the provider, the validator
through `TryAddEnumerable` so calling the method twice does not run the validation twice
(`MMCA.Common.UI.Web/DependencyInjection.cs:67-77`).

**The UI host's own edge: a request limiter.** The Blazor Web host is an externally reachable origin
separate from the Gateway, so the edge limiter of
[ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) never sees a
request to it, while every page load there opens an interactive Server circuit in a container
typically sized at 0.25 vCPU and 0.5 GiB
(`MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:11-15`). `MMCA.Common.UI.Web` therefore
ships a limiter of its own. [`UiRateLimitingSettings`](#uiratelimitingsettings)
(`UiRateLimitingSettings.cs:33`) binds the `UiRateLimiting` section with an `Enabled` switch that
defaults on, a per-IP `PermitLimit` of 300 over a 60-second `WindowSeconds`, and a replica-wide
`GlobalConcurrencyLimit` of 200 (`:36`, `:43`, `:58`, `:62`, `:76`). The 300 sits well above any single
visitor on purpose, because an office or carrier NAT presents many visitors as one address, and a
host whose audience shares one egress (a venue's wifi) is told to raise it (`:49-55`).
[`UiRateLimitingExtensions`](#uiratelimitingextensions)
(`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:25`) turns that into a **chained** global
limiter, so a request must pass both a fixed window keyed by client IP and one concurrency bucket for
the whole process, each with a zero-length queue so excess is rejected with `429` at once rather than
queued (`:101-108`, `:126-133`, `:163`, `:172-176`). The settings are validated on start and then
closed over once rather than resolved per request, because the partition callback runs on every
request (`:150-159`). Exemptions are declared rather than inferred from middleware order: `/health`,
`/alive`, `/_framework`, `/_content` and `/hubs` match on whole segments, and any path whose last
segment carries a file extension counts as a static asset, while `/_blazor` has neither and stays
metered because its negotiate is exactly what opens a circuit (`:42`, `:50-56`, `:62-70`). An
unresolvable client IP fails open instead of collapsing every such request into one shared bucket
(`:93-98`), and both counts are per replica and in memory, the same trade the Gateway kit makes so the
limiter never puts a network round trip in front of the site (`UiRateLimitingSettings.cs:27-30`).
`AddUiRateLimiting(configuration)` registers it and `UseUiRateLimiting()` adds the middleware
(`UiRateLimitingExtensions.cs:145`, `:187`).

**And a ceiling on open circuits.** A rate still lets a caller who opens circuits slowly enough
accumulate them, and `CircuitOptions` only bounds circuits that have already disconnected, which is
what the second bound closes (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:10-15`).
[`BlazorCircuitLimitSettings`](#blazorcircuitlimitsettings) (`BlazorCircuitLimitSettings.cs:17`)
binds `BlazorCircuitLimits` with a `MaxActiveCircuits` of 200 per replica, derived from that
container's memory and stated as an abuse ceiling rather than a capacity plan, plus a tighter
disconnected retention of 25 circuits for 60 seconds against the framework's 100 and three minutes
(`:20`, `:27-38`, `:46`, `:57`). [`BoundedCircuitHandler`](#boundedcircuithandler)
(`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:43`) keeps the count as a `CircuitHandler`,
the documented extension point that sees a circuit open and close (`:14-20`). It increments first and
rolls back on refusal so two simultaneous opens cannot both take the last slot, floors the close-side
decrement at zero so an unpaired close never hands out permits forever, and runs last among the
registered handlers (`:55`, `:64-73`, `:84-88`). Refusal is a thrown `InvalidOperationException`, one
of the few places the Result pattern does not apply, because `OnCircuitOpenedAsync` returns a `Task`
with no refuse value; the client sees Blazor's reconnect UI rather than a crashed page (`:23-28`,
`:70-72`). [`BlazorCircuitLimitExtensions`](#blazorcircuitlimitextensions)
(`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:19`) keeps the two halves as separate
calls because they attach to different builders: `RetentionFrom(configuration)` returns the
`CircuitOptions` callback for `AddInteractiveServerComponents`, and `AddBoundedBlazorCircuits()`
validates the options on start and registers the handler as a **singleton**, since circuit handlers
resolve from each circuit's own scope and a scoped one would count to one and cap nothing (`:13-17`,
`:28-40`, `:51-60`). Both read the same section, so the two numbers cannot drift apart. The ADC Blazor
Web host wires all four calls (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:72`, `:62`,
`:127`, `:197`). `[Rubric §12, Performance & Scalability]` and `[Rubric §29, Resilience]`: a public
origin sheds load at its own edge instead of letting an unauthenticated loop exhaust its container.

**Forms declare their rules once.** The shared auth forms ([`LoginModel`](#loginmodel),
[`RegisterModel`](#registermodel), [`ForgotPasswordModel`](#forgotpasswordmodel),
[`ResetPasswordModel`](#resetpasswordmodel)) are plain data-annotation `EditForm` models, with
[`PasswordComplexityAttribute`](#passwordcomplexityattribute) mirroring the server's rule (at least 8
characters with upper, lower, digit and a non-alphanumeric character) so the form gives the verdict
the API would, and deferring empty input to `[Required]` so a blank field shows one message rather
than two (`MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:15`, `:21-30`).
[`OptionalEmailAttribute`](#optionalemailattribute)
(`MMCA.Common.UI/Validation/OptionalEmailAttribute.cs:25`) covers the optional address the stock
`[EmailAddress]` cannot express: blank passes, and anything else must hold exactly one `@` that is
neither first nor last, the server's `EmailRules` check (`OptionalEmailAttribute.cs:5-23`, `:38-41`).
The auth models resolve their messages through the internal [`AuthFieldMessages`](#authfieldmessages)
(`MMCA.Common.UI/Resources/AuthFieldMessages.cs:19`) as an `ErrorMessageResourceType`, reading
`SharedResource` in the current UI culture with the key itself as fallback, because MudBlazor also
runs a `For` field's attributes on its own and shows the message verbatim, so a bare resource key
there reached the screen raw (`AuthFieldMessages.cs:11-18`, `:44`).
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
(`DataAnnotationsModelValidator.cs:13-19`, `:36-41`); an `EditForm` gets the same localizing path by swapping
`<DataAnnotationsValidator />` for
[`LocalizedDataAnnotationsValidator`](#localizeddataannotationsvalidator)
(`MMCA.Common.UI/Validation/LocalizedDataAnnotationsValidator.cs:21`), which writes the results into
the form's `EditContext`, re-validating a field when it changes and the whole model on submit
(`:9-20`); a consumer that keeps its rules in
FluentValidation supplies its own implementation and `MMCA.Common.UI` never references a validation
library. That client-side parity is the point of `[Rubric §24, Forms, Validation & UX Safety]`: the
client predicts, the server decides.

**Sign-in, registration and terms acceptance ship as framework pages.** The `/login` page's
[`Login`](#login) code-behind (`MMCA.Common.UI/Pages/Auth/Login.razor.cs:8`) reads the `error`
query value the OAuth completion endpoint sends a refused external sign-in back with and maps the
machine code to words, never showing the raw code, with a dedicated resource for each refusal that
carries its own recovery path and a generic refusal for the rest (`:15-21`, `:23-29`); when device
storage dropped the OAuth attempt it disables the web-redirect provider buttons, since a flow
started there would be refused at completion (`:10-14`). The `/register` page's
[`Register`](#register) (`MMCA.Common.UI/Pages/Auth/Register.razor.cs:10`) validates any address the
user did type and blocks the registration on an invalid one instead of dropping it, while an
all-blank block sends no address (`:15-40`); the whole block is switchable through
[`RegistrationSettings`](#registrationsettings)`.CollectAddress`, bound from `Registration` and
defaulting to `true` so a host that configures nothing keeps the page as it was
(`MMCA.Common.UI/Common/Settings/RegistrationSettings.cs:8`, `:11`, `:18`). Legal documents are
[`LegalSettings`](#legalsettings) (`MMCA.Common.UI/Common/Settings/LegalSettings.cs:16`), bound
from `Legal`: optional absolute URLs for the terms, the privacy policy, the code of conduct and the
account-deletion page, where an empty value renders nothing and a set `TermsUrl` is what makes the
register page require "I agree"; the current terms version itself stays server configuration
(`LegalSettings.cs:5-15`, `:22`, `:26`, `:30`, `:34`, `:41`). Consent owed after sign-up is
[`TermsAcceptanceGate`](#termsacceptancegate)
(`MMCA.Common.UI/Components/Legal/TermsAcceptanceGate.razor.cs:29`): it reads the signed-in user's
standing once per user from `OnAfterRenderAsync`, because the bearer token is readable only once the
renderer is interactive, renders nothing on any failed read so the gate never takes the app down with
the API, and otherwise holds a dialog with no close button, backdrop click, Escape or
close-on-navigation, since a list page rewriting its own URL right after load would otherwise dismiss
it for the rest of the session (`:19-28`, `:31-45`). Its client is
[`ILegalAcceptanceUIService`](#ilegalacceptanceuiservice)
(`MMCA.Common.UI/Services/Legal/ILegalAcceptanceUIService.cs:16`), a Result-returning `GetAsync` and
`AcceptAsync` against `Users/me/legal-acceptance` that never throws for a server answer or a
transport fault, so a caller treats any failure as "do not block" (`:6-15`, `:21`, `:27`), implemented
by [`LegalAcceptanceUIService`](#legalacceptanceuiservice)
(`MMCA.Common.UI/Services/Legal/LegalAcceptanceUIService.cs:23`) on the authenticated-service shape:
the read is retried, the accept POST is sent once (`:14-20`, `:29-40`; registered for every host at
`MMCA.Common.UI/DependencyInjection.cs:168-170`). On the profile page,
[`ChangePasswordCard`](#changepasswordcard)
(`MMCA.Common.UI/Components/Auth/ChangePasswordCard.razor.cs:18`) validates all three fields
client-side first (the new password at least `MinLength`, 8 by default, and the confirmation equal to
it) and calls `IAuthUIService.ChangePasswordAsync` only for a valid form, toasting a success in its own
words and a refusal with the server's reason (`:9-17`, `:33-38`).

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
[`MudToastService`](#mudtoastservice) (`MMCA.Common.UI/Services/MudToastService.cs:19`) and
[`MudAppDialogService`](#mudappdialogservice) (`MMCA.Common.UI/Services/MudAppDialogService.cs:11`)
are the **only two types in the framework that name MudBlazor's `ISnackbar` and `IDialogService`**,
and even the severity projection is written out as a switch rather than cast, because the two enums
agreeing numerically today is not a dependency worth taking silently
(`MudToastService.cs:92-104`). Announcement is deliberately not this service's job: the shared
provider block hosts MudBlazor's snackbar inside a `role="status" aria-live="polite"` element, so the
rendered toast already is the live-region content and a second channel would read the same sentence
twice (`MudToastService.cs:12-17`). The dialog facade collapses a dismissal (backdrop click, escape) onto
`false`, so a caller only ever branches on `true` (`MudAppDialogService.cs:14-26`). Both are
registered by their own `AddCommonUiFacades()` (`MMCA.Common.UI/DependencyInjection.cs:228-233`),
separate from `AddUIShared` so a bUnit harness can resolve exactly these two without the rest of the
shared-UI surface. `[Rubric §1, SOLID]` (dependency inversion) and `[Rubric §14, Testability]`: a
component test records toasts instead of driving a rendered snackbar host.

**Design system and theming.** Visual consistency is centralized in one static
[`MMCATheme`](#mmcatheme) `MudTheme` instance (`MMCA.Common.UI/Theme/MMCATheme.cs:9`, `:11`) holding a
light palette (`:13-55`), a full dark palette (`:56-111`), an Inter-first typography scale (`:112-190`)
and a 6 px default border radius (`:191-194`). It is applied through the shared `MmcaThemeProviders`
component, which renders the four Mud providers every root layout needs exactly once and takes the
theme as a parameter defaulting to `MMCATheme.Instance`, so an app with its own brand passes a derived
`MudTheme` instead of duplicating the provider block
(`MMCA.Common.UI/Theme/MmcaThemeProviders.razor:33-36`). The palette itself comes from a
single C# source of truth, [`BrandColors`](#brandcolors) (`MMCA.Common.UI/Theme/BrandColors.cs:10`),
whose doc comment states the duplication contract plainly: the CSS custom properties in
`wwwroot/app.css` must mirror these constants because C# cannot read CSS at build time, and
`BrandColorTokenTests` asserts the two stay in sync (`BrandColors.cs:3-9`). Color choices carry
explicit WCAG reasoning: Secondary is Teal 700 `#00796B` for about 5.3:1 on light surfaces because the
Teal 600 it replaced sat at about 4.0:1, under the AA 4.5:1 floor (`BrandColors.cs:21-26`), and
the light `Warning` is Amber 900 `#A85D00` (4.96:1 on Surface, 4.79:1 on Background) rather than the
Material amber `#F57F17`, which measures only about 2.65:1 on white and so fails the 4.5:1 floor
everywhere the palette colour is used as text or as a border rather than as a fill, with
`WarningContrastText` moved to white in the same edit because the two values have to move together
(`MMCATheme.cs:28-36`). The dark palette makes the mirror-image choice, keeping `rgba(0,0,0,0.87)` on
`#FFA726`, where white would be about 2.0:1 and dark text is about 10.8:1 (`MMCATheme.cs:83-85`).
`[Rubric §20, Design System, Theming & Consistency]` is the home category (one token source, dark
mode, consistent typography) and `[Rubric §21, Accessibility]` is woven into the palette itself and
into the chrome, down to the skip-to-content link the shared layout renders first
(`MMCA.Common.UI/Layout/MainLayout.razor:17`).

**Dark mode is a service, not a flag.** [`ThemeService`](#themeservice)
(`MMCA.Common.UI/Theme/ThemeService.cs:17`, registered `Scoped` at `DependencyInjection.cs:180`)
owns the preference: `InitializeAsync` reads the stored value through a `theme.js` module and falls
back to the OS `prefers-color-scheme` only when nothing is stored (`ThemeService.cs:35`),
`SetDarkModeAsync` persists through the same module and raises `OnChange` (`ThemeService.cs:29`,
`:54`), and the JS module handle is held by [`LazyJsModule`](#lazyjsmodule)
(`MMCA.Common.UI/Services/LazyJsModule.cs:20`), a single-flight importer that caches the in-flight
import under a lock so two concurrent callers cannot leak a second module reference, and that drops a
failed task so an import attempted during prerender does not poison the module for the rest of the
circuit (`LazyJsModule.cs:5-19`, `:22-25`). `MmcaThemeProviders` subscribes to `OnChange` and
re-renders (`MMCA.Common.UI/Theme/MmcaThemeProviders.razor:52`), and every best-effort theme interop
call it makes goes through the internal [`ThemeInterop`](#themeinterop)`.TryAsync`
(`MMCA.Common.UI/Theme/ThemeInterop.cs:9`, `:19-30`), which turns a `JSException`, a
`JSDisconnectedException` or an `InvalidOperationException` (a prerender race, a disposed dispatcher)
into `false`, so a JS failure never escapes a component lifecycle and kills the circuit
(`MmcaThemeProviders.razor:62`, `:90`). **Honest caveat:** on a web head the no-flash SSR bootstrap
is not wired for theme. `InitializeAsync` runs from `OnAfterRenderAsync(firstRender)` because JS
interop is unavailable during prerender (`MmcaThemeProviders.razor:55-62`), so the bound mode is
corrected just after hydration and a brief wrong-theme first paint is possible
([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)). A head that already knows
the stored preference without JS closes that gap by registering an
[`IInitialThemeModeSource`](#iinitialthememodesource)
(`MMCA.Common.UI/Theme/IInitialThemeModeSource.cs:14`), whose synchronous `IsDarkMode` (`null` when
unknown) `MmcaThemeProviders` reads during initialization, with the JS path still running afterwards
and staying authoritative; a MAUI hybrid head reading device preferences is the intended implementer,
and web heads register nothing (`IInitialThemeModeSource.cs:3-13`, `:21`,
`MmcaThemeProviders.razor:44-47`).

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
(`MMCA.Common.UI/Services/Culture/MmcaCultureBootstrap.cs:22-34`). Outbound API calls forward the active
culture as an `Accept-Language` header through
[`CultureDelegatingHandler`](#culturedelegatinghandler)
(`MMCA.Common.UI/Services/Culture/CultureDelegatingHandler.cs:13`, `:20-25`), wired into the `"APIClient"`
pipeline at `DependencyInjection.cs:146-147`, because the cross-origin Gateway does not carry the
cookie through to the services and that header is what makes a backend failure come back localized.
View strings are externalized to co-located `.resx` resolved by `IStringLocalizer<T>`
(`AddLocalization()` at `DependencyInjection.cs:88`), anchored by two marker types:
[`SharedResource`](#sharedresource) for cross-cutting chrome
(`MMCA.Common.UI/Resources/SharedResource.cs:9`) and [`MudTranslations`](#mudtranslations) for
MudBlazor's own component text (pager, filter menus, pickers,
`MMCA.Common.UI/Resources/MudTranslations.cs:10`), served through
[`ResxMudLocalizer`](#resxmudlocalizer), which `AddUIShared` `TryAdd`s because `AddMudServices`
registers no `MudLocalizer` of its own (`DependencyInjection.cs:97-101`) and whose values degrade to
MudBlazor's built-in English when a key reports `ResourceNotFound`
(`MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:7-19`). How MudBlazor *reaches* that fallback is
replaced too: `AddUIShared` installs
[`InvariantMudLocalizationInterceptor`](#invariantmudlocalizationinterceptor)
(`MMCA.Common.UI/Globalization/InvariantMudLocalizationInterceptor.cs:37`) through MudBlazor's
`AddLocalizationInterceptor`, which replaces the default regardless of whether `AddMudServices` ran
first (`MMCA.Common.UI/DependencyInjection.cs:110`). The resolution order is unchanged (an English UI
culture, or no `MudLocalizer`, reads the built-in strings; any other culture asks the `MudLocalizer`
and falls back on `ResourceNotFound`, `InvariantMudLocalizationInterceptor.cs:49-60`), and the
English test is the *parent* language, so `en-US` counts as English while the neutral `en` goes
through the localizer like every other culture (`:46-52`). The one difference is how the built-in
strings are read. MudBlazor 9.7+ assigns `CultureInfo.CurrentUICulture` to the invariant culture and
then assigns the previous value back, and both writes land in an `AsyncLocal`, so the "restore"
leaves the calling thread's `ExecutionContext` carrying an explicit culture from then on; on a MAUI
hybrid head the renderer dispatches on the process's main thread, which nothing ever resets, so the
first MudBlazor chrome string a page renders pins the app to its launch language and a later switch
loses to the pinned value even after a WebView reload (`:16-27`). The private nested
[`BuiltInStrings`](#builtinstrings) (`InvariantMudLocalizationInterceptor.cs:73`) reads the same
embedded `MudBlazor.Resources.LanguageResource` through a `ResourceManager` with an explicit
invariant culture instead, addressing it by manifest name because MudBlazor's generated resource
class is internal (`:75`, `:77`, `:89`, `:98-102`), which is what the culture swap was for (no
satellite-assembly probing under a non-English culture) with no culture assignment at all.
Count-sensitive messages are handled by a suffix convention rather than by string concatenation:
[`StringLocalizerPluralExtensions`](#stringlocalizerpluralextensions)`.Plural`
(`MMCA.Common.UI/Globalization/StringLocalizerPluralExtensions.cs:20`, `:40`) asks for `{key}.One`
when the count is exactly one and `{key}.Other` otherwise, falling back to the base key when the
plural sibling is missing so a resource set that has not been split yet keeps rendering its single
message instead of leaking a raw key name to the reader (`:46-51`); the send confirmation is the
current call site (`MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:137`). Two
categories cover both shipped cultures, and a language with more CLDR categories needs a category
selector rather than more suffixes, which would not change the call site
(`StringLocalizerPluralExtensions.cs:13-19`). Applying a switch is host-specific and sits
behind [`ICultureApplier`](#icultureapplier): the web default
[`EndpointCultureApplier`](#endpointcultureapplier) force-loads the server `/culture/set` endpoint so
the server re-renders SSR under the new cookie and the WASM runtime re-reads it on startup
(`MMCA.Common.UI/Services/Culture/EndpointCultureApplier.cs:18-32`), while a MAUI hybrid head, having no
ASP.NET pipeline, replaces it after `AddUIShared` with an in-process applier
([`MauiCultureApplier`](group-26-device-capability-layer.md#mauicultureapplier), chapter 26). The
development-only pseudo locale is the group's own i18n test harness:
[`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorates `IStringLocalizerFactory`
unconditionally (`DependencyInjection.cs:95`,
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
safe to surface (`ErrorMessages.cs:14-22`). Time is shown on the viewer's clock rather than the
server's: [`ViewerTimeZone`](#viewertimezone)
(`MMCA.Common.UI/Services/Culture/ViewerTimeZone.cs:18`, registered scoped at
`MMCA.Common.UI/DependencyInjection.cs:190`) reads the browser's IANA zone once per scope through
`time-zone.js`, resolves it with `TimeZoneInfo`, and converts to UTC until then or whenever the zone
cannot be read, never to the server's own zone, which on Blazor Server and during prerender is the
wrong answer for every viewer elsewhere (`ViewerTimeZone.cs:6-17`, `:32`). A page calls
`EnsureResolvedAsync` from its first `OnAfterRenderAsync` and re-renders when it returns `true`;
during prerender the call is skipped and a later one retries (`:49`, `:62-69`). `[Rubric §27, Internationalization]` is the home category
here, and adding a locale is a `.es.resx` sibling plus one allowlist entry, not new infrastructure.

**Per-user preference persistence.** A signed-in user's culture and theme follow them across devices
via the Identity profile. [`IUserPreferenceWriter`](#iuserpreferencewriter) /
[`ApiUserPreferenceWriter`](#apiuserpreferencewriter) PUT to `auth/preferences` over the shared
`"APIClient"` (`MMCA.Common.UI/Services/Preferences/ApiUserPreferenceWriter.cs:22`, `:62-66`) using the private
[`UserPreferencesRequest`](#userpreferencesrequest) record (`:29`), and
[`IUserPreferenceReader`](#iuserpreferencereader) /
[`ApiUserPreferenceReader`](#apiuserpreferencereader) GET the same endpoint at login and return the
immutable [`UserPreferences`](#userpreferences) record, whose null fields mean "leave unchanged"
(`MMCA.Common.UI/Services/Preferences/UserPreferences.cs:9`,
`MMCA.Common.UI/Services/Preferences/ApiUserPreferenceReader.cs:14`, `:21-31`). The write is strictly
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
[`IUIModule`](#iuimodule) (`MMCA.Common.UI/Common/Interfaces/IUIModule.cs:11`). A module descriptor
exposes its navigation entries as [`NavItem`](#navitem) values, the `Assembly` holding its Razor pages
so the host can add it to `AdditionalAssemblies` for route discovery, and two defaulted collections of
component types to render in the app bar and at the root layout (`IUIModule.cs:12-22`). The
registration prologue is shared too: `AddUIModule<TModule>()` runs one Scrutor scan that picks up
every `IEntityService<,>` implementation in the module's assembly as scoped, then registers the
descriptor as a singleton (`MMCA.Common.UI/DependencyInjection.cs:320-329`), so a module's own
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
plus a push-notification entry gated on the `NotificationPermissions.Manage` permission rather than on
a role name (`:17-21`, the permission facet at `:20`), the app-bar
[`NotificationBell`](#notificationbell) (`:23`) and a root-layout listener component (`:25`);
[`NotificationInbox`](#notificationinbox), [`NotificationList`](#notificationlist) and
[`NotificationSend`](#notificationsend) (with its [`NotificationSendModel`](#notificationsendmodel)
form model) render it; [`NotificationInboxService`](#notificationinboxservice) and
[`PushNotificationService`](#pushnotificationservice) (behind
[`INotificationInboxUIService`](#inotificationinboxuiservice) and
[`IPushNotificationUIService`](#ipushnotificationuiservice)) call the API; and
[`NotificationHubService`](#notificationhubservice)
(`MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:44`) holds the **SignalR**
connection to the API's [`NotificationHub`](group-10-notifications.md#notificationhub). A dropped
connection reconnects for as long as the service is alive: the internal
[`UnboundedReconnectPolicy`](#unboundedreconnectpolicy)
(`MMCA.Common.UI/Services/Notifications/UnboundedReconnectPolicy.cs:21`, wired at
`NotificationHubService.cs:206`) walks a 0, 2, 5 and 10 second warm-up and then retries every 30
seconds, where the SignalR default gives up after about 42 seconds and leaves live notifications dead
until a page reload (`UnboundedReconnectPolicy.cs:6-20`, `:24-32`, `:44-46`). A connection that still
closes with an error is restarted under the same 30-second cap, a deliberate stop or dispose is never
restarted, and a 401 or 403 handshake ends both loops, since an expired session cannot recover by
retrying (`NotificationHubService.cs:32-41`, `:280`). The same connection
carries ephemeral **live channel** events
([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): components join through
`JoinChannelAsync` (`NotificationHubService.cs:319`), membership is reference-counted per key by
[`ChannelReferenceCounter`](#channelreferencecounter)
(`MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16`) so one subscriber leaving does
not cut the channel off for the others, handlers are multicast through disposable
[`ChannelSubscription`](#channelsubscription) handles (`NotificationHubService.cs:771`), and every held
channel is re-joined on `Reconnected` because SignalR group membership does not survive a new
connection (`NotificationHubService.cs:226`). On a WebAssembly client whose host runs the same-origin
proxy, the hub connects through it and sends the proxy's CSRF header instead of an access token
(`NotificationHubService.cs:100-109`, `:540`). Which notifications a user sees can be narrowed by
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
not want real-time notifications never pays for the SignalR plumbing. A host that skips it can also set
`HideNotificationPagesWhenUnregistered` (`MMCA.Common.UI/Common/Settings/LayoutSettings.cs:49`), and
[`NotificationPageGate`](#notificationpagegate)
(`MMCA.Common.UI/Notifications/NotificationPageGate.cs:12`) then has the router answer the three
notification pages with the not-found page whenever no `NotificationUIModule` is registered
(`:14-31`). The router places the internal
[`NotificationPageNotFoundStatus`](#notificationpagenotfoundstatus)
(`MMCA.Common.UI/Notifications/NotificationPageNotFoundStatus.cs:11`) beside that not-found page; it
renders nothing and calls `NavigationManager.NotFound()` on initialization, so a server render
answers 404 rather than 200 (`:5-10`, `:18`). The pages themselves declare the
`mmca:notification-pages` policy instead of a bare `[Authorize]`, because `[Authorize]` is endpoint
metadata and the authorization middleware would challenge a signed-out visitor to sign in before the
router's gate ever ran, for a page that does not exist on this host
([`NotificationPageRequirement`](#notificationpagerequirement),
`MMCA.Common.UI/Notifications/NotificationPageRequirement.cs:20`, `:23`, rationale at `:14-19`).
[`NotificationPageAuthorizationHandler`](#notificationpageauthorizationhandler)
(`MMCA.Common.UI/Notifications/NotificationPageAuthorizationHandler.cs:14`) passes an authenticated
caller, and every caller while the host hides the pages, reusing the gate's own predicate so the two
cannot disagree (`:26-30`); `AddUIShared` registers the policy and the handler for every host
(`MMCA.Common.UI/DependencyInjection.cs:78-85`).

**Administration screens ship as components, not pages.** Identity administration is the second
finished feature in the package
([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)), and it is
delivered as components an app routes itself: [`UserAdminList<TUser>`](#useradminlisttuser)
(`MMCA.Common.UI/Pages/Administration/UserAdminList.razor.cs:47`), [`RoleAdminList`](#roleadminlist)
(`MMCA.Common.UI/Pages/Administration/RoleAdminList.razor.cs:28`) and
[`RoleAdminEdit`](#roleadminedit) (`MMCA.Common.UI/Pages/Administration/RoleAdminEdit.razor.cs:36`)
carry no `@page` directive, so the route, the authorization attribute and the links between them stay
the app's decision (`UserAdminList.razor.cs:17-22`, `RoleAdminList.razor.cs:12-14`,
`RoleAdminEdit.razor.cs:13-14`). The account roster is the one shipped screen that derives from the
list-page base itself (`MMCA.Common.UI/Pages/Administration/UserAdminList.razor:4`) and it is generic
over the app's own DTO, constrained only to `IUserAdminDTO` (`UserAdminList.razor.cs:47-48`). It has
two data paths: by default it reads through
[`IUserAdminUIService<TUserDto>`](#iuseradminuiservicetuserdto)
(`MMCA.Common.UI/Services/Administration/IUserAdminUIService.cs:18`), whose endpoint takes a search
term and a role rather than the grid's per-column filter syntax
(`IUserAdminUIService.cs:11-16`, `:27-32`), while an app whose roster lives on its own filtered
endpoint passes a `FetchPage` delegate instead and the service is never resolved for reads, with the
free-text box injected under the `SearchFilterKey` filter key (`UserAdminList.razor.cs:32-39`,
`:50-55`). The three account actions always go through
[`IUserAdminActionsUIService`](#iuseradminactionsuiservice)
(`MMCA.Common.UI/Services/Administration/IUserAdminActionsUIService.cs:16`), the non-generic half so a
component that only acts on an account never names the DTO, and they are hidden on the signed-in
operator's own row: an operator who locked or demoted themselves would lose the very capability needed
to undo it, and the API has no notion of "the caller" (`UserAdminList.razor.cs:40-44`). `SetRoleAsync`
is its own member rather than a default interface implementation over `SetRolesAsync`, because a
default implementation is not virtual on the interface a mock proxies, so a test could neither stub
nor verify it (`IUserAdminActionsUIService.cs:40-54`).

Role administration is non-generic throughout, since a role and a permission are both strings the
framework already owns ([`IRoleAdminUIService`](#iroleadminuiservice),
`MMCA.Common.UI/Services/Administration/IRoleAdminUIService.cs:22`, rationale at `:11-15`). The roster
reports the permissions a role's code grants and the permissions stored rows grant as two separate
counts, because only the stored half is editable and a single total would hide that removing a
compiled permission is a code change (`RoleAdminList.razor.cs:16-20`). The editor offers only what the
server's catalog declares, so nothing it can submit is a permission no endpoint checks, and it locks
two kinds of checkbox: one the host compiled in for this role, and `ManageRoles` itself, which guards
this very screen and which the server refuses to store, so offering it would be offering an action
guaranteed to fail (`RoleAdminEdit.razor.cs:17-29`). The rest are grouped by the area before the first
colon of an `area:capability` name through the private [`PermissionGroup`](#permissiongroup) record,
with un-prefixed permissions filed under a localized "General" (`RoleAdminEdit.razor.cs:37-38`,
`:222`, `:301-303`). Wording stays the app's: every string these three render is looked up in an app-supplied
`IStringLocalizer` **first** and falls back to the framework's
[`UserAdminListResources`](#useradminlistresources),
[`RoleAdminListResources`](#roleadminlistresources) and
[`RoleAdminEditResources`](#roleadmineditresources) markers, so "Deactivate" instead of "Lock" costs
no parameter per word (`UserAdminList.razor.cs:24-31`,
`MMCA.Common.UI/Pages/Administration/RoleAdminListResources.cs:9-14`). Both implementations,
[`UserAdminService<TUserDto>`](#useradminservicetuserdto)
(`MMCA.Common.UI/Services/Administration/UserAdminService.cs:26`) and
[`RoleAdminService`](#roleadminservice)
(`MMCA.Common.UI/Services/Administration/RoleAdminService.cs:25`), derive from
[`AuthenticatedServiceBase`](#authenticatedservicebase) rather than the entity-service base, because
these endpoints are not CRUD over an entity resource, and they read every answer back through
[`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader) inside
[`HttpResultExecutor`](#httpresultexecutor) so only the caller's own cancellation still propagates
(`UserAdminService.cs:15-22`, `RoleAdminService.cs:64-78`, `:89-101`). `[Rubric §18, UI Architecture &
Component Design]` again: the framework ships the screen, the app keeps the route, the vocabulary and
the DTO.

**How it wires up at startup.** A host's `Program.cs` calls `AddUIShared(configuration)` once, a C#
`extension(IServiceCollection)` member (see
[primer §4](00-primer.md#4-c-build-and-code-style-conventions)) on
[`DependencyInjection`](#dependencyinjection) (`MMCA.Common.UI/DependencyInjection.cs:31`, `:39-209`).
In order it binds and **validates on start** [`ApiSettings`](#apisettings), so a missing endpoint
fails the host rather than the first request (`:42-45`; the read-only face of those options is
[`IApiSettings`](#iapisettings), whose `WasmApiEndpoint` lets the server call an internal URL while
the browser is handed an external one, `MMCA.Common.UI/Common/Settings/IApiSettings.cs:11-17`); binds
[`LayoutSettings`](#layoutsettings), `LegalSettings`, `RegistrationSettings`, `UiReadCacheOptions` and
`NotificationBellOptions` *without* validation, deliberately optional so a host that configures none
of them keeps the compiled-in defaults (`:48-67`); `TryAdd`s `TimeProvider.System` as the clock those
staleness policies are measured against and the read cache itself (`:71`, `:76`); registers the
notification pages' authorization policy and its handler (`:81-85`); sets up localization, the
pseudo/Mud localizer decorators and the MudBlazor localization interceptor (`:88-110`); registers the
auth and culture delegating handlers and the named
`"APIClient"` whose base address comes from `ApiSettings` and whose timeout is pinned to
[`HttpResilienceDefaults`](group-16-aspire-orchestration.md#httpresiliencedefaults)`.TotalRequestTimeout`
rather than the BCL's arbitrary 100s, so the transport never pre-empts the resilience budget
(`:118-147`; when `Api:SameOriginApiEndpoint` is configured the base address is that proxy endpoint
and [`SameOriginProxyRequestHandler`](#sameoriginproxyrequesthandler) joins as the innermost handler,
`:120-121`, `:136`, `:149-154`); calls `AddCommonUiFacades()` for the toast and dialog pair (`:159`);
then `TryAdd`s [`AuthUIService`](#authuiservice), the email-confirmation client (`:166`), the
terms-acceptance client (`:170`), the [`OAuthFlowStateStore`](#oauthflowstatestore) (`:174`),
the two list-page state services,
[`NavigationHistoryService`](#navigationhistoryservice), [`ThemeService`](#themeservice),
[`EndpointCultureApplier`](#endpointcultureapplier), `ViewerTimeZone` (`:190`),
[`NavigationPublicLinkBuilder`](#navigationpubliclinkbuilder) behind
[`IPublicLinkBuilder`](#ipubliclinkbuilder) (share-sheet and QR links resolved against the browser
origin, which a MAUI head replaces because its WebView origin is a virtual host nobody else can open,
`MMCA.Common.UI/Services/Navigation/IPublicLinkBuilder.cs:9`,
`MMCA.Common.UI/Services/Navigation/NavigationPublicLinkBuilder.cs:11`), the preference reader and writer, and a
default [`IOAuthUISettings`](#ioauthuisettings) ([`DefaultOAuthUISettings`](#defaultoauthuisettings))
that downstream apps override with
[`ConfigurationOAuthUISettings`](#configurationoauthuisettings), which reads provider availability
from the `OAuth` section for a server host and from pre-computed `Enabled` flags for a WASM client
(`:161-204`, `MMCA.Common.UI/Services/Auth/OAuth/ConfigurationOAuthUISettings.cs:13`, `:24-30`); and finally
calls `AddDeviceCapabilityDefaults()` so every capability contract resolves on every head (`:208`,
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), chapter 26).
The `TryAdd*` discipline is what lets a consumer pre-register its own implementation and win. Browser
hosts add `AddClientAuthSessionCookieSync()` (`:240-242`) and `AddWasmFormFactor()` (`:252`); a
Blazor Server head adds `AddCommonServerTokenStorage()`, `AddCommonBlazorCsp()` (before
`AddCommonSecurityHeaders`, so it beats the `TryAdd`ed static provider) and
`AddCommonWebFormFactor()` from `MMCA.Common.UI.Web`
(`MMCA.Common.UI.Web/DependencyInjection.cs:41`, `:67`, `:85`; the first also registers `BrowserOriginHandler`, `:47-48`) plus the
`UseAuthenticatedNoStore()` middleware. The administration screens are opt-in on the same pattern:
`AddUserAdministrationUI<TUserDto>()` registers the generic service and **forwards** the non-generic
actions contract to that same instance, so the roster and the actions it performs go through one
object and one substitute in a test (`MMCA.Common.UI/DependencyInjection.cs:269-276`), and
`AddRoleAdministrationUI()` registers the role client (`:295-297`); nothing in the framework calls
either, so an app serving no administration endpoints registers nothing and the components are
simply never rendered. An
SSR host behind the gateway also calls `AddTrustedCallerHeader(configuration)`, which composes
[`TrustedCallerHandler`](#trustedcallerhandler)
(`MMCA.Common.UI.Web/Security/TrustedCallerHandler.cs:35`) onto **every** `HttpClient` the host creates,
inserted at index 0 so the origin gate judges the authority the caller wrote rather than one Aspire's
service-discovery handler has already rewritten (`MMCA.Common.UI.Web/DependencyInjection.cs:121`,
`:143-156`), and registers nothing at all when no secret, header name or parseable gateway origin is
configured (the early return at `:137`). The breadth is the point: the call that suffers most from the gateway's per-IP
limiter partition, the cookie-session token refresh, is created by the framework under a name a host
cannot reach, while the handler itself stays narrow, stamping the secret only on a request whose
scheme, host and port match the gateway origin and replacing rather than appending the header, because
the gateway compares one single-valued header in constant time (`TrustedCallerHandler.cs:9-27`,
`:67-79`). [`UISharedAssemblyReference`](#uisharedassemblyreference)
(`MMCA.Common.UI/DependencyInjection.cs:335`) is the marker other assemblies scan against.

**How a WebAssembly client learns its API address.** The WASM bundle is static, so the API base
address is fetched at runtime rather than baked in. On the server side,
[`ClientConfigEndpointExtensions`](#clientconfigendpointextensions)
(`MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:17`) adds
`MapClientConfigEndpoint`, an anonymous `GET /client-config` excluded from the OpenAPI description
whose framework-owned `Api` section carries `Api:WasmApiEndpoint` (`:17`, `:52-81`). It
**fails closed**: with that key missing it throws rather than fall back to `Api:ApiEndpoint`, which is
the server head's service-discovery name a browser cannot resolve, so the client fails to start
instead of pointing at the wrong API (`:32-38`, `:53-59`). When the host runs the same-origin proxy,
the same `api` section also carries `sameOriginApiEndpoint`, the proxy prefix with a trailing slash,
which is what moves the client's `"APIClient"` onto it (`:84-99`). The endpoint declares `AllowAnonymous`
itself, because the client fetches the document before it can hold a session and a host's fallback
policy would otherwise gate it (`:40-44`, `:80`). A host adds its own sections through a per-request
[`ClientConfigBuilder`](#clientconfigbuilder)
(`MMCA.Common.UI.Web/ClientConfig/ClientConfigBuilder.cs:17`), whose `Add` refuses a blank name, the
reserved `Api` section and a duplicate, and whose remarks warn that everything added is served to
every browser before sign-in, so only public values belong there (`:12-16`, `:45-62`). The client
half is [`MmcaClientConfigBootstrap`](#mmcaclientconfigbootstrap)
(`MMCA.Common.UI/Common/Settings/MmcaClientConfigBootstrap.cs:28`), whose `LoadAsync` fetches the
document from the app's own origin with a 15-second per-attempt timeout and a single retry after one
second (for the cold-start case where the Server host is still warming), then rethrows a second
failure on purpose, and returns a buffered stream because browser fetch streams do not support the
synchronous reads `AddJsonStream` performs (`:12-22`, `:30`, `:33`, `:44-85`). Only the timeout it
did not ask for is retried, never the caller's own cancellation (`:87-90`). ADC wires both halves
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:265`,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:31`).

The small Level-0 supporting cast fills in the rest: [`NotificationRoutePaths`](#notificationroutepaths)
(`MMCA.Common.UI/Common/NotificationRoutePaths.cs:8`), whose deep-link builder formats invariantly
because the route's `:int` constraint is the validation boundary (`:14-20`);
[`QrErrorCorrectionLevel`](#qrerrorcorrectionlevel), the framework's own enum for `QrCodeImage` so the
component's public API does not pin consumers to QRCoder's `ECCLevel`
(`MMCA.Common.UI/Components/Sharing/QrErrorCorrectionLevel.cs:9`);
[`RatingStars`](#ratingstars) (`MMCA.Common.UI/Components/Ratings/RatingStars.razor.cs:13`), five
read-only stars out of a `MaxValue` of 5 rendered as one `role="img"` element whose required
`AriaLabel` carries the numeric figure, so the stars stay decorative rounding (whole stars fill, a
half star shows at .5 and above, `:6-11`, `:16`, `:31-33`, `:46-54`), which the ADC feedback and
speaker dashboards render
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor:67`);
[`ApiFileDownloadButton`](#apifiledownloadbutton)
(`MMCA.Common.UI/Components/Forms/ApiFileDownloadButton.razor.cs:14`), which gives browsers a plain download
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
(`MMCA.Common.UI/Extensions/MoneyExtensions.cs:14`, the single-price form at `:29-30` and the
collection form at `:33`), keeping a display concern out of the
domain value object, exactly where Clean Architecture wants it.

Read the per-type sections that follow for the mechanics. The consumer-side module UIs live in the ADC
module-UI chapter ([chapter 21](group-21-conference-ui.md)), and the bUnit component tests plus the
Playwright/axe-core E2E suite that exercise this package are covered in the testing chapter
([chapter 27](group-28-testing-infrastructure.md)), which is where `[Rubric §28, Front-End Testing]`
lives.

### BreakpointConstants

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:9` · Level 0 · class (static)

- **What it is**: a one-method static helper that answers "is this viewport a mobile viewport?", so C# viewport detection and the CSS media-query boundary agree on one number.
- **Depends on**: `MudBlazor.Breakpoint` (NuGet, imported at `BreakpointConstants.cs:1`). Nothing first-party.
- **Concept introduced, the single authoritative breakpoint.** `[Rubric §22, Responsive & Cross-Browser]` assesses whether a codebase has one definition of "small screen" rather than a magic number re-chosen per component; this class embodies it by making the mobile/desktop split a named predicate. The doc comment (`BreakpointConstants.cs:11-15`) pins the threshold as "below the sidebar-collapse threshold (MudBlazor Xs or Sm, i.e. < 960 px)", which is the same boundary the shared stylesheet collapses the sidebar at. `[Rubric §20, Design System & Theming]` applies for the same reason: one threshold keeps the layout, the nav drawer and the list pages switching modes together instead of at three slightly different widths.
- **Walkthrough**: the type has exactly one member. `IsMobileBreakpoint(Breakpoint breakpoint)` (`BreakpointConstants.cs:16-17`) is expression-bodied and returns `breakpoint is Breakpoint.Xs or Breakpoint.Sm`. That pattern is the whole rule: `Md` and wider is desktop, and there is no third state.
- **Why it's built this way**: static and dependency-free, so a component can call it without injecting anything, and moving the mobile threshold is a one-line edit paired with one CSS rule rather than a hunt through component code.
- **Where it's used**: exactly one production call site, [DataGridListPageBase<TDto>](#datagridlistpagebasetdto)'s viewport-change handler `NotifyBrowserViewportChangeAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:317`), which sets `IsMobile` from it at line 308 and, on a desktop-to-mobile transition, resets `MobileCurrentPage` to 1 and re-requests the mobile data (`DataGridListPageBase.cs:324-328`). That single assignment is what swaps a desktop `MudDataGrid` for the [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem) card layout on every list page in both consumer apps.

---

### IAppDialogService

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:14` · Level 0 · interface

- **What it is**: the framework's modal-confirmation contract, one method that asks a yes/no question and resolves once the user answers. It exists so page code never names the component library that draws the dialog.
- **Depends on**: nothing first-party (the file carries no `using` directives at all). Implemented by [MudAppDialogService](#mudappdialogservice) over MudBlazor's `IDialogService`.
- **Concept introduced, the vendor-neutral UI facade.** `[Rubric §32, Dependency & Supply-Chain]` assesses whether a third-party dependency is contained behind your own contract or spread across call sites; `[Rubric §14, Testability]` assesses whether a unit of behavior can be exercised without its infrastructure; `[Rubric §1, SOLID]` covers the dependency-inversion half of the same idea. The framework applies all three the same way twice: this interface and its sibling [IToastService](#itoastservice) are the only shapes pages depend on, and their two implementations are the only types in the framework that name MudBlazor's `IDialogService` / `ISnackbar` ([MudAppDialogService](#mudappdialogservice) at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudAppDialogService.cs:11`, doc comment at `:6-10`). The payoff is concrete: a bUnit test answers a confirmation prompt with a stub instead of rendering, driving and dismissing a real dialog. The doc comment (`IAppDialogService.cs:3-13`) also states the deliberate scope limit: only the yes/no shape is abstracted, and richer entity-specific dialogs (`DeleteConfirmation`) stay component-side rather than growing this contract.
- **Walkthrough**: one member. `ConfirmAsync(string title, string message, string confirmText, string cancelText)` returns `Task<bool>` (`IAppDialogService.cs:26`). Two contract details are stated in the XML doc and honored by the implementation. First, every string parameter is documented as "already-localized" (`:21-24`): the facade never touches `IStringLocalizer`, the caller resolves its own copy, which is what keeps the resource key next to the page that owns it ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). Second, dismissing the dialog without choosing counts as declining (`:17-19`), so a caller only ever has to branch on `true`. [MudAppDialogService](#mudappdialogservice) implements exactly that by collapsing MudBlazor's tri-state answer with `return confirmed is true;` (`MudAppDialogService.cs:25`), because `ShowMessageBoxAsync` answers `null` for a backdrop click or an escape key press (`MudAppDialogService.cs:16-18`).
- **Why it's built this way**: a four-string method with a `bool` answer is the smallest contract that covers every destructive-action prompt in the framework, and keeping it that small is what makes the vendor genuinely swappable: the whole surface an alternative renderer must satisfy is one method. It is registered by `AddCommonUiFacades()` alongside the toast facade ([DependencyInjection](#dependencyinjection), `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:231`), scoped to match the MudBlazor services it wraps. See [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html), whose 2026-08-29 revision records the vendor choice and these two facades, and whose 2026-08-31 revision records their move into their own registration call.
- **Where it's used**: injected by the shared framework surfaces that ask before doing something lossy: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto), the notification list, send and inbox pages, `ListPageActions`, the signed-in-devices page (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs`), and the `UnsavedChangesGuard` component. Registered for component tests by the shipped bUnit base's `Services.AddCommonUiFacades()` call (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:54`), which uses `TryAdd` semantics so a test that wants a recording double registers one afterwards (`BunitComponentTestBase.cs:51-53`).

---

### IHomePageContent

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8` · Level 0 · interface

- **What it is**: the hook that lets each consuming application supply its own landing page at the `/` route without forking the shared routing or layout.
- **Depends on**: `System.Type` (BCL) and, at the consuming end, `Microsoft.AspNetCore.Components.DynamicComponent`, which the doc comment names as the rendering mechanism (`IHomePageContent.cs:3-7`).
- **Concept introduced, late-bound content injection into a packaged shell.** `[Rubric §18, UI Architecture & Component Design]` assesses whether shared UI infrastructure adapts to per-app content without duplication. The shared package owns the route: `Home.razor` declares `@page "/"` once (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Home.razor:1`), injects `IEnumerable<IHomePageContent>` (`Home.razor:3`), and renders `<DynamicComponent Type="_contentType" />` when a provider resolved (`Home.razor:8-11`). Because the component arrives as a runtime `Type` rather than a compile-time reference, the framework package renders an app's landing page without referencing the app. When no implementation is registered the page falls back to a localized welcome panel (`Home.razor:12-21`), so a brand-new host still renders something coherent.
- **Walkthrough**: two read-only members. `ComponentType` (`IHomePageContent.cs:11`) is the `System.Type` of the Razor component to render as the home-page body. `PageTitle` (`IHomePageContent.cs:14`) is the browser-tab title, bound by `Home.razor:6`.
- **Why it's built this way**: an inverted dependency (the app registers into the framework, never the reverse) is what lets the whole shell ship as a NuGet package. Compare the sibling mechanism in [IUIModule](#iuimodule): both hand the framework a `Type` or an `Assembly` and let reflection do the binding, and both exist for the same reason ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)).
- **Where it's used**: implemented once per app and registered once per head. ADC registers `ADCHomePageContent` as a singleton in all three heads (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:97`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:45`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:126`), with two separate implementations, one for the web heads (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11`) and one for MAUI (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8`). Store does the same with `StoreHomePageContent` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:101`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:41`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:76`).
- **Caveats / not-in-source**: the injection point is `IEnumerable<IHomePageContent>`, so several registrations do not fail; which one wins is decided by `Home.razor`'s selection code (`Home.razor:23` onward), not by this interface. Every current host registers exactly one.

---

### ComponentLifetimeExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ComponentLifetimeExtensions.cs:18` · Level 0 · class (static, extension methods)

- **What it is**: one extension method, `LifetimeToken(this CancellationTokenSource?)`, that gives a component a cancellation token it can read at any point of its lifetime without risking an exception.
- **Depends on**: `System.Threading.CancellationTokenSource`, `CancellationToken` and `ObjectDisposedException` (BCL). Nothing first-party.
- **Concept introduced, the always-safe lifetime token.** `[Rubric §15, Best Practices & Code Quality]` assesses whether a recurring hazard has one shared answer. Reading `CancellationTokenSource.Token` after `Dispose()` throws `ObjectDisposedException`, and a Blazor component's async continuation can easily run after the component is gone. The extension converts that failure mode into the correct behavior: a component that has ended gets a token that is already cancelled, so the in-flight call stops instead of throwing out of a dead render tree.
- **Walkthrough**: `LifetimeToken` (`ComponentLifetimeExtensions.cs:26-42`) has three outcomes. A `null` source, or one whose `IsCancellationRequested` is already true, returns `new CancellationToken(canceled: true)` (`:28-31`). Otherwise it returns `source.Token` (`:35`) inside a `try`; an `ObjectDisposedException` (a source disposed without being cancelled first) is caught and also returns a cancelled token (`:37-41`), with the comment that the component is gone all the same.
- **Why it's built this way**: an extension on the nullable source, rather than a wrapper type, so a component keeps its familiar `_cts` field and writes `_cts.LifetimeToken()` where it used to write `_cts.Token`. `null` is treated as ended (`:28`), which covers a component whose source was never created.
- **Where it's used**: [LatestLoadGuard](#latestloadguard) reads its token through it (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:58`), and the `ResultUiExtensions` examples show `_cts.LifetimeToken()` as the call-site shape (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:47`, `:63`). The convention is enforced by `ArchitectureRules.ComponentsReadTheirTokenThroughLifetimeToken` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Ui/ArchitectureRules.LifetimeTokens.cs:28`), which fails the build on a direct `_cts.Token` read, wrapped for subclassing by `LifetimeTokenConventionTestsBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/LifetimeTokenConventionTestsBase.cs:13`). It is on the shipped public surface (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Shipped.txt:1391`).

---

### LatestLoadGuard

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:38` · Level 0 · class (sealed, `IDisposable`)

- **What it is**: a small per-page helper that keeps a routed component showing the load it asked for **last**, by giving every load a generation number and a cancellation token and cancelling the previous one as the next begins.
- **Depends on**: `System.Threading.CancellationTokenSource` and `ObjectDisposedException.ThrowIf` (BCL), and [ComponentLifetimeExtensions](#componentlifetimeextensions) for the token it hands out.
- **Concept introduced, generation-guarded supersession.** `[Rubric §19, State Management & Data Flow]` assesses the correctness of in-flight asynchronous state, and this is the canonical bug it looks for. The doc comment states it precisely (`LatestLoadGuard.cs:5-10`): Blazor **reuses a routed component instance** across route-parameter changes, so a page that opens entity 100 (slow response) and then navigates to entity 101 (fast response) receives 100's late answer after 101 has already rendered. Assigning it unconditionally leaves the URL on 101 while the page holds 100, and any action bound to the loaded entity then fires against the wrong record. Cancellation alone does not fix this, because a fetch that ignores its token still completes; the integer generation is the authoritative check. The same pattern appears at component scope inside [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem), which snapshots a generation before awaiting and drops the result if the world moved; `LatestLoadGuard` is that idea extracted into a reusable object so a detail page gets it in three lines. `[Rubric §15, Best Practices & Code Quality]` applies: the alternative is every page hand-rolling a token source, a counter and a dispose path.
- **Walkthrough**: three private fields (`LatestLoadGuard.cs:40-42`): the current `CancellationTokenSource?`, the `int _generation`, and a `_disposed` flag.
  - `Begin()` (`:50-59`) is the entry point. It throws if the guard is disposed (`:52`), cancels and disposes the previous load through the private `CancelAndDisposeCurrent()` (`:54`), publishes a fresh token source (`:55`), increments the generation (`:56`), and returns the pair `(CancellationToken Token, int Generation)` (`:58`), with the token read as `_cts.LifetimeToken()` rather than `_cts.Token` (`:58`) so it is the always-safe token of [ComponentLifetimeExtensions](#componentlifetimeextensions). Returning a tuple rather than exposing two properties is what makes the generation a **snapshot**: the caller holds the value it started with, so a later `Begin()` cannot retroactively change what it compares against.
  - `IsCurrent(int generation)` (`:67`) is the check after the await: `!_disposed && generation == _generation`. Disposal counts as not-current, so a component torn down mid-fetch also drops its answer instead of assigning into a dead render tree.
  - `Dispose()` (`:70-79`) is idempotent via the `_disposed` early return (`:72-75`) and cancels the in-flight load on the way out.
  - `CancelAndDisposeCurrent()` (`:81-91`) null-guards, then cancels, disposes and nulls the source, so the guard never double-disposes a token source and never leaks one.
  - The usage shape is spelled out as a `<code>` block in the doc comment (`:15-31`): a `private readonly LatestLoadGuard _load = new();` field, `var (token, generation) = _load.Begin();` at the top of `OnParametersSetAsync`, an `if (!_load.IsCurrent(generation)) { return; }` immediately after the await, and `public void Dispose() => _load.Dispose();`.
- **Why it's built this way**: deliberately **not thread-safe**, and the doc comment says so in bold (`:32-36`). It is built for the renderer's synchronization context, where component lifecycle methods and event callbacks are already serialized, so the fields need no interlocking and the type stays allocation-cheap. That is a contract, not an oversight: sharing one instance across threads is documented as unsupported.
- **Where it's used**: the framework's `DetailPageBase` exposes one as `protected LatestLoadGuard LoadGuard { get; } = new();` and disposes it (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DetailPageBase.cs:43`, `:95`), so every detail page derived from it inherits the guard. `RoleAdminEdit` holds its own `_load` and runs the `Begin()` / `IsCurrent(generation)` shape directly (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminEdit.razor.cs:42`, `:162`, `:174`, `:187`), and ADC's public event, session and speaker detail pages and `SessionCreate` also call it (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventDetail.razor.cs`, `Pages/Public/Sessions/PublicSessionDetail.razor.cs`, `Pages/Public/Speakers/PublicSpeakerDetail.razor.cs`, `Pages/Sessions/SessionCreate.razor.cs`). It is on the shipped public surface (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Shipped.txt:37-41`). It is also exercised by [LatestLoadGuardTests](group-28-testing-infrastructure.md#per-project-test-rollup) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Common/LatestLoadGuardTests.cs:11`, six test methods covering `Begin` cancelling the prior token, generation advance, `IsCurrent` after supersession, and behavior after disposal) `[Rubric §28, Front-End Testing]`; `DetailPageBaseTests` covers the base-class wiring (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/DetailPageBaseTests.cs`).
- **Caveats / not-in-source**: the guard is not thread-safe by contract, and a page that bypasses it (assigning a fetch result unconditionally) is not caught by any analyzer; adoption is by `DetailPageBase` inheritance or by hand, as `RoleAdminEdit` does.

---

### NavSection

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavSection.cs:7` · Level 0 · enum

- **What it is**: classifies a sidebar entry into one of three audience groups: everyone, signed-in users, or administrators.
- **Depends on**: nothing. Consumed by [NavItem](#navitem) and by the shared nav menu.
- **Concept introduced, audience as a first-class navigation axis.** `[Rubric §25, Navigation & Information Architecture]` assesses whether the menu structure is declarative and audience-aware rather than a hand-maintained pile of conditionals. `[Rubric §11, Security]` touches it too, but with an important distinction worth internalizing early: the section is a **grouping hint, not an authorization check**. What actually hides a link is `RequiredRole` / `RequiredClaim` on [NavItem](#navitem), evaluated by the menu (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:198-199`), and what actually protects the destination is page-level and API-level authorization.
- **Walkthrough**: three values in declaration order, and the order is itself a contract because the doc comment states sections render in enum declaration order (`NavSection.cs:5`). `General` (`:10`) is for items visible to everyone, anonymous and authenticated alike. `User` (`:13`) is for signed-in non-admin items. `Admin` (`:16`) is for administrator items.
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
- **Where it's used**: `RoutePaths.Home` backs the navbar brand link (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:18`), the Home nav link (`NavMenu.razor:58`), and the first breadcrumb of the sessions page (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:68`). `RoutePaths.Sessions` backs the authenticated-section nav link (`NavMenu.razor:142`) and is asserted by name in both repos' component tests: `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:76` pins that the link renders inside `.nav-auth-section`, `:75` pins its position, `:88` pins that it is absent for an anonymous user, and `MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.UI.Tests/Pages/Users/Profile/ProfileTests.cs:67` pins that the profile page links to it.
- **Caveats / not-in-source**: `Sessions` is still listed in `PublicAPI.Unshipped.txt` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Unshipped.txt:339`) while `Home` is baselined in `PublicAPI.Shipped.txt:916`, so the two members sit at different points in the public-API baseline cycle.

---

### ToastSeverity

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs:8` · Level 0 · enum

- **What it is**: the framework's own five-level scale for how prominent a toast is, and therefore which color and icon the host renders it with.
- **Depends on**: nothing. Declared above [IToastService](#itoastservice) in the same file.
- **Concept reinforced, keeping the vendor enum out of call sites.** The facade idea is taught at [IAppDialogService](#iappdialogservice); this enum is the part of it that is easy to skip. A contract that abstracts the snackbar but takes `MudBlazor.Severity` as a parameter has not abstracted anything, because every caller still references the vendor assembly. The doc comment says exactly that (`IToastService.cs:3-7`): the five levels mirror what every component library exposes, so a host maps them one-to-one without losing anything, and "naming them here is what keeps the vendor's own severity enum out of page code". `[Rubric §32, Dependency & Supply-Chain]` and `[Rubric §9, API & Contract Design]` both apply: the mapping to `MudBlazor.Severity` lives in one private method inside [MudToastService](#mudtoastservice), so swapping renderers is a change to one `switch`.
- **Walkthrough**: five explicitly numbered members, each documented by what it means for the user rather than by color. `Normal = 0` (`IToastService.cs:11`), neutral with no color emphasis. `Info = 1` (`:14`), something happened that the user did not ask for. `Success = 2` (`:17`), the action the user asked for completed. `Warning = 3` (`:20`), completed partially or with something worth knowing. `Error = 4` (`:23`), the action failed. The explicit values keep the enum stable if members are ever reordered.
- **Why it's built this way**: five levels rather than four, because `Normal` (an uncolored toast) is a distinct affordance from `Info`, and not more, because there is no shape beyond these that the framework raises. `Info` is the default parameter value on both `ShowPersistent` and `ShowAction` (`:72`, `:100`), which is the neutral choice for an unprompted message.
- **Where it's used**: the `severity` parameter of `IToastService.Show`, `ShowPersistent` and `ShowAction`; the `severity` parameter of [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`, where it defaults to `ToastSeverity.Error` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:293`); and [MudToastService](#mudtoastservice), the one type that maps it to `MudBlazor.Severity` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudToastService.cs:27`).

---

### UISharedAssemblyReference

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:335` · Level 0 · class

- **What it is**: an empty marker class whose only job is to give code a compile-checked `typeof(...).Assembly` handle on the shared UI assembly.
- **Depends on**: nothing.
- **Concept introduced, the assembly-marker type.** Reflection over an assembly needs an `Assembly` instance, and there are two ways to get one: a string (`Assembly.Load("MMCA.Common.UI")`, which fails at run time when someone renames the project) or a type reference (`typeof(UISharedAssemblyReference).Assembly`, which fails at compile time and is carried along by a rename refactoring). Every layer of the framework ships an equivalent marker; this is the UI layer's. `[Rubric §15, Best Practices & Code Quality]` assesses exactly this kind of refactor-safety over stringly-typed lookups.
- **Walkthrough**: a single declaration using the semicolon type body, `public class UISharedAssemblyReference;` (`DependencyInjection.cs:335`), with its doc comment on line 217. It shares a file with [DependencyInjection](#dependencyinjection) but is declared at namespace scope **beneath** it, outside that static class, because a type nested inside a static class could not serve as a public marker the same way. It carries no members, so nothing can accidentally depend on state it does not have.
- **Why it's built this way**: type-only, public and empty is the whole point. It is the assembly's identity expressed as a symbol the compiler tracks.
- **Where it's used**: the architecture fitness suite is the real consumer. `CommonArchitectureMap` registers the assembly as the framework's UI layer with `Framework(Layer.Ui, typeof(Common.UI.UISharedAssemblyReference).Assembly)` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:27`), which is what lets the shared layer-dependency rules know which assembly *is* the UI layer; `AnonymousEndpointTests` includes it in the assemblies it scans (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:19`); and `NavigationContractTests` enumerates its types with `typeof(UI.UISharedAssemblyReference).Assembly.GetTypes()` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/NavigationContractTests.cs:105`). `[Rubric §34, Architecture Governance & Documentation]` applies: this one-line type is what makes a layer boundary machine-checkable.
- **Caveats / not-in-source**: the doc comment (`DependencyInjection.cs:334`) offers "e.g., for Scrutor scanning" as the motivating case, but no Scrutor registration in this repo takes its scan root from this marker. `AddUIModule<TModule>()` scans `FromAssemblyOf<TModule>()` (`DependencyInjection.cs:324`), taking the root from the module descriptor's own assembly instead. Trust the call sites: the current consumers are the architecture tests.

---

### IToastService

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs:37` · Level 1 · interface

- **What it is**: the framework's contract for transient user notifications ("toasts"), covering four named severities, a runtime-chosen severity, a persistent two-line notification, and a toast that carries a clickable action.
- **Depends on**: [ToastSeverity](#toastseverity) (same file). Implemented by [MudToastService](#mudtoastservice) over MudBlazor's `ISnackbar`.
- **Concept introduced, fire-and-forget by design.** The facade rationale is taught at [IAppDialogService](#iappdialogservice); what is specific here is that every method returns `void`. The doc comment explains why (`IToastService.cs:31-35`): during server-side prerender there is no toast host at all, so the call is a silent no-op, and a contract that reported whether the message rendered would force every call site to handle a condition it can do nothing about. `[Rubric §24, Forms, Validation & UX Safety]` assesses whether outcomes surface to the user in a recoverable way; `[Rubric §27, Internationalization]` applies because every parameter is documented as **already localized**, which pushes resource resolution out to the page that owns the key. That last rule is enforced, not merely documented: an architecture fitness regex fails the build on a literal first argument to any toast method (`Toast\.(?:Success|Info|Warning|Error|Show|ShowPersistent|ShowAction)\(\s*\$?"`, at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Ui/ArchitectureRules.LocalizedText.cs:14`, with the comment at `:12-13` recording that it is the same guard that previously watched direct `ISnackbar` use at `:9`).
- **Walkthrough**: seven members, in three tiers.
  - **The four named severities**, `Success` (`IToastService.cs:41`), `Info` (`:45`), `Warning` (`:49`) and `Error` (`:53`), each taking one already-localized message. [MudToastService](#mudtoastservice) implements each as a one-line `snackbar.Add(message, Severity.X)` (`MudToastService.cs:15-24`).
  - **`Show(string message, ToastSeverity severity)`** (`:62`) is the same thing with the level as a parameter, and the doc comment names its motivating caller: [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`, which carries the severity through as an argument rather than picking one of the four (`:55-58`).
  - **`ShowPersistent(string title, string body, ToastSeverity severity = ToastSeverity.Info)`** (`:72`) is the push-notification shape: an emphasized title above a body, staying on screen until dismissed. The reasoning (`:64-67`) is that a message arriving unprompted must not expire before the user has looked at the screen. [MudToastService](#mudtoastservice) builds it as a render fragment, a `<strong>` title, a `<br>`, then the body (`MudToastService.cs:41-51`).
  - **`ShowAction(string message, string actionText, Func<Task> onAction, ToastSeverity severity = ToastSeverity.Info, bool requireInteraction = false)`** (`:96-101`) is the undo / view-it / retry shape a bare message cannot express. Two contract details are documented rather than enforced. First, the callback runs outside any render callback, so nothing catches what it throws: a caller whose work can fail must guard it and raise its own failure toast (`:78-81`, restated at `:86-88`). Second, `requireInteraction: true` pins the toast open until the user dismisses it or takes the action, and the MudBlazor implementation additionally renders it filled, following the same emphasis convention `ShowPersistent` uses, "because a toast that waits for the user has to look like it is waiting" (`:90-95`).
- **Why it's built this way**: a small, `void`-returning, already-localized contract is what allows the vendor to appear in exactly one class. It is registered scoped by `AddCommonUiFacades()` ([DependencyInjection](#dependencyinjection), `MMCA.Common.UI/DependencyInjection.cs:230`) to match the lifetime of the MudBlazor `ISnackbar` it wraps. See [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html).
- **Where it's used**: essentially everywhere a page reports an outcome. Inside the framework package: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto), [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem), `ListPageActions`, the three notification pages, the sessions page, and the `UnsavedChangesGuard`, `SharePageButton`, `ApiFileDownloadButton` and `NotificationListener` components. Outside it, every consumer page reaches it indirectly through [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`. Component tests resolve it from the shipped bUnit base (`BunitComponentTestBase.cs:54`, whose comment at `:50-51` records that without it a consumer's component test fails to resolve `IToastService` and each repo ends up re-registering the same pair).

---

### NavItem

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:20` · Level 1 · record

- **What it is**: the immutable description of one sidebar entry a UI module contributes: title, href, icon, the resource type its title resolves against, optional role, claim and permission gates, its [NavSection](#navsection), and an optional collapsible group.
- **Depends on**: [NavSection](#navsection); `System.Type` (BCL).
- **Concept introduced, navigation as data contributed by modules.** `[Rubric §25, Navigation & Information Architecture]` assesses modular, role-aware navigation. The shared menu never knows which modules exist: it injects `IEnumerable<IUIModule>`, flattens every module's `NavItems`, filters, partitions and renders (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:219-228`). That mirrors the server-side [IModule](group-14-module-system-composition.md#imodule) contract one layer up ([ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) for the server, [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) for this one). `[Rubric §27, Internationalization]` applies through `TitleResource` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). `[Rubric §11, Security]` and [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) apply through `RequiredPermission`.
- **Walkthrough**: a positional record declared on one line (`NavItem.cs:20`) with nine parameters, five of them optional:
  - `Title`, `Href`, `Icon`: required, positional.
  - `Type TitleResource`: **required**, and the fourth positional parameter. This is the localization contract, and the doc comment states it precisely (`NavItem.cs:13-18`): `Title` and `Group` are resource **keys**, resolved against `TitleResource` at render time, per-circuit, so the menu follows the active culture. A key the resource type does not declare renders as the raw string, which is what makes a not-yet-translated entry legible instead of blank. `NavMenu.razor` implements exactly that, calling `LocalizerFactory.Create(item.TitleResource)[item.Title]` for an item (`NavMenu.razor:166-170`) and `LocalizerFactory.Create(group.First().TitleResource)[group.Key]` for a group heading (`NavMenu.razor:172-180`), with the ADR-027 rule restated in a code comment at `:163-165`.
  - `string? RequiredRole = null` and `string? RequiredClaim = null`: render gates. The menu applies them as `item.RequiredRole is null || _user?.IsInRole(item.RequiredRole) == true` and the equivalent claim-type test (`NavMenu.razor:221-222`).
  - `string? RequiredPermission = null`: a third, permission-based render gate, layered on top of role and claim. The menu applies it as `item.RequiredPermission is null || _user.HasPermissionClaim(item.RequiredPermission)` (`NavMenu.razor:223`), the same permission-claim mechanism [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) uses on the write side, so a nav entry can be hidden by permission instead of only by role.
  - `NavSection Section = NavSection.General`: which sidebar group the item lands in (`NavMenu.razor:226-228`).
  - `string? Group = null`: nests the item inside a collapsible `MudNavGroup`; the menu groups by it with `GroupBy(i => i.Group)` in each of the three sections (`NavMenu.razor:60`, `:83`, `:110`).
- **Why it's built this way**: a positional record gives value semantics and a one-line construction per entry, which is what makes a module's `NavItems` read as a small declarative list. Making `TitleResource` a **required positional** parameter rather than an optional nullable one is the load-bearing design choice: there is no way to register a nav item that bypasses localization, so "all visible text follows the selected language" holds for the menu by construction rather than by review. [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) records the shape at this exact line (`NavItem.cs:20`). `RequiredPermission` was added as a third, independent gate rather than folded into `RequiredClaim`, so a caller can express "hide by permission" without hand-building the permission claim type/value pair itself.
- **Where it's used**: returned from the `NavItems` property of every [IUIModule](#iuimodule) implementation and rendered by `NavMenu.razor`. [NotificationUIModule](#notificationuimodule) is the framework's own example and shows both the minimal and the maximal form: `new("Nav.NotificationInbox", NotificationRoutePaths.NotificationInbox, Icons.Material.Filled.Inbox, typeof(SharedResource), Section: NavSection.User)` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:19`) and `new("Nav.PushNotifications", NotificationRoutePaths.Notifications, Icons.Material.Filled.NotificationsActive, typeof(SharedResource), RoleNames.Organizer, Section: NavSection.Admin, Group: "Notifications")` (`:20`). Covered by [NavMenuTests](group-28-testing-infrastructure.md#per-project-test-rollup) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs`), which drives the menu through a `StubUiModule(IReadOnlyList<NavItem> navItems)` (`:198`).
- **Caveats / not-in-source**: `RequiredRole` and `RequiredClaim` control **rendering only**. They hide a link; they do not authorize the destination. The menu keeps a section-level authentication check alongside the per-item one deliberately (`NavMenu.razor:104-105`), but page-level and API-level authorization remain the enforcing gates.

---

### IUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:11` · Level 2 · interface

- **What it is**: the UI-side counterpart to the server's [IModule](group-14-module-system-composition.md#imodule). A pluggable UI module declares its navigation entries, its Razor assembly for route discovery, and optionally components it injects into the top app bar and the root layout.
- **Depends on**: [NavItem](#navitem); `System.Reflection.Assembly` (`IUIModule.cs:1`).
- **Concept introduced, plugging into a packaged application shell.** `[Rubric §18, UI Architecture & Component Design]` assesses whether there is a coherent composition model. [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) states the problem this solves: before it, every Blazor head owned its own `App` / `Routes` / layout / nav markup, so adding a module meant editing the host (a new nav link, a new assembly in the router, a new drawer in the layout), and two apps built on the same framework drifted apart in shell behavior even where they agreed. The framework already shipped the shell; what was missing was a contract letting a module contribute **into** it. Resolution is `IEnumerable<IUIModule>` from DI, so the shell composes whatever is registered without naming any module. `[Rubric §25, Navigation & Information Architecture]` applies because nav is contributed rather than hard-coded, and `[Rubric §7, Microservices Readiness]` applies in the same spirit as the server contract: a module that can be added or removed by one registration line is a module that can move.
- **Walkthrough**: five members, three of them defaulted.
  - `IReadOnlyList<NavItem> NavItems` (`IUIModule.cs:14`): the module's contribution to the shared sidebar. Flattened by `NavMenu.razor:256` with `.SelectMany(m => m.NavItems)`.
  - `Assembly Assembly` (`:17`): the assembly containing the module's Razor pages. The router consumes it as `AdditionalAssemblies="UIModules.Select(m => m.Assembly)"` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:13`), which is what makes a module's `@page` routes discoverable at run time with no central route table to edit.
  - `IReadOnlyList<Type> AppBarComponentTypes => []` (`:20`): a **default interface member** returning an empty collection expression. Components listed here render inside the top app bar (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:155`, also gathered by `NavMenu.razor:216`).
  - `IReadOnlyList<Type> LayoutComponentTypes => []` (`:23`): the same idea at the root-layout level, for drawers, overlays and headless listeners (`MainLayout.razor:156`).
  - `IReadOnlyList<Type> ContentHeaderComponentTypes => []` (`:29`): components rendered at the top of the main content region, above the page body and beside the offline banner, for a banner the user must see before the page itself (`:25-28`). `MainLayout` gathers them with `UIModules.SelectMany(m => m.ContentHeaderComponentTypes)` (`MainLayout.razor:157`) and renders them in a block documented at `MainLayout.razor:77`.
- **Why it's built this way**: the three default interface members are what keep the simple case simple. A module that only contributes navigation implements two properties, not five, and can gain app-bar, layout or content-header contributions later without a breaking change to anything already written. Passing an `Assembly` rather than a list of page types keeps route discovery reflective, so adding a page is never a framework edit.
- **Where it's used**: implemented by module descriptors across the workspace: the framework's own [NotificationUIModule](#notificationuimodule) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15`), ADC's `ConferenceUIModule` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`), `EngagementUIModule` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/EngagementUIModule.cs:17`), `IdentityUIModule` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:18`) and the MAUI-head-only `DeviceUIModule` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:18`), plus Store's `CatalogUIModule` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/CatalogUIModule.cs:13`), `SalesUIModule` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:16`), `IdentityUIModule` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/IdentityUIModule.cs:13`) and `MauiUIModule` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:14`). The optional members earn their keep in practice: `NotificationUIModule` contributes `NotificationBell` to the app bar and `NotificationListener` to the layout (`NotificationUIModule.cs:23-25`), Store's `SalesUIModule` contributes `CartButton` plus `CartDrawer` and `OrphanOrderRecovery` (`SalesUIModule.cs:30-32`), ADC's `EngagementUIModule` contributes `LiveEventListener` (`EngagementUIModule.cs:31`), and ADC's `DeviceUIModule` contributes five headless native listeners at once (`DeviceUIModule.cs:33`). Registration goes through `AddUIModule<TModule>()` (see [DependencyInjection](#dependencyinjection)), which each module's own one-line `Add{Module}UI()` delegates to, for example `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/DependencyInjection.cs:19`. A stub implementation drives the menu tests (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:308`) and another drives the backend-less component gallery (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:14`).

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
- **Where it's used**: implemented for every entity by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:43-47`, which also composes an optional [IUiReadCache](#iuireadcache)) and consumed by every module CRUD page, most of them through [DataGridListPageBase<TDto>](#datagridlistpagebasetdto). Registration is automatic: `AddUIModule<TModule>()` runs a Scrutor scan over the module's assembly that picks up every class assignable to `IEntityService<,>` and registers it scoped as its implemented interfaces ([DependencyInjection](#dependencyinjection), `MMCA.Common.UI/DependencyInjection.cs:323-327`). The `(Items, TotalItems)` shape of `GetPagedAsync` is also the shape [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem)'s page-fetch delegate expects.

---

### ResultUiExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:74` · Level 4 · class (static, extension methods)

- **What it is**: the page-side half of the Result transport. It is the four things a Blazor page ever does with a failed [Result](group-01-result-error-handling.md#result), written once so no page hand-rolls them again: unwrap the value, push the message into an inline alert, raise it as a toast, or branch on **why** it failed.
- **Depends on**: [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error), [ErrorType](group-01-result-error-handling.md#errortype) and [ErrorTypeSeverity](group-01-result-error-handling.md#errortypeseverity) from `MMCA.Common.Shared.Abstractions` (`ResultUiExtensions.cs:5`); `ProblemDetailsResultReader` and the synthesized-failure codes of `HttpResultExecutor` (`:6`, `:9`); [IToastService](#itoastservice) and [ToastSeverity](#toastseverity) (`:7`); the framework's `SharedResource` resource pair (`:8`); `Microsoft.Extensions.Localization.IStringLocalizer` (`:4`); `System.Resources.ResourceManager` (`:3`); `System.Diagnostics.CodeAnalysis.NotNullWhenAttribute` and `SuppressMessageAttribute` (`:1`).
- **Concept introduced, localize-with-pass-through, and severity-ordered deduplication.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a failure reaches the user as one clear, actionable sentence; `[Rubric §27, Internationalization]` assesses whether that sentence follows the active culture; `[Rubric §15, Best Practices & Code Quality]` assesses whether the same five lines get re-typed per page. Two mechanisms carry all three.
  - **Pass-through localization** (`:22-27`): every message is looked up as a resource key, and one the localizer does not declare renders **verbatim**. That is what lets a single call site handle both an API error whose text the server already localized and a client-side error whose `Message` is a resource key.
  - **Code-keyed fallback for synthesized failures** (`:27-33`): a failure the client built itself, with no server-phrased message to pass through (a bodiless HTTP status, a transport failure, a client timeout), is looked up by its error **code** instead: `Http.{status}`, then the generic `Http.Status` format, `Http.TransportFailure`, `Http.Timeout`. A code the supplied localizer does not hold resolves from the framework's own `SharedResource` pair for the current UI culture, so a consumer page passing its own `IStringLocalizer<PageType>` (which holds no `Http.*` keys) still shows the translated sentence; the English message is the last resort. The class holds a private `ResourceManager SharedResources = new(typeof(SharedResource))` (`:84`) and the format key `HttpStatusFallbackKey = "Http.Status"` (`:78`) for this.
  - **Severity-ordered deduplication** (`:36-39`): messages are made distinct with `StringComparer.Ordinal` and ordered most-severe-first via [ErrorTypeSeverity](group-01-result-error-handling.md#errortypeseverity), so a real 403 or 500 leads and an incidental validation message never buries it. The shape this guards against is common once `Result.Combine` aggregates invariants: the same sentence arriving under several codes now reads as one sentence. This is the client mirror of the server-side status selection recorded in [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html), using the very same ranking type hoisted into `Shared` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:59`) so both edges classify one aggregate identically.

  The class doc even ships a before/after pair (`:42-73`) contrasting the old `try` / `catch (Exception ex)` shape with `if (result.TryGetValue(out var dto)) { ... } else { result.NotifyOnFailure(Toast, L); }`, both reading the token as `_cts.LifetimeToken()` ([ComponentLifetimeExtensions](#componentlifetimeextensions)).
- **Walkthrough**: eleven public members plus five private helpers, in four tiers.
  - **Unwrapping.** `TryGetValue<T>(this Result<T>, [NotNullWhen(true)] out T? value)` (`:103-118`) reads like `Dictionary.TryGetValue` so the success and failure branches sit side by side. The implementation carries a subtle correctness note in its comment (`:107-109`): the failure branch is decided by `result.IsFailure`, **not** by whether the value is null, because for a value type (a `(Items, TotalItems)` tuple, an `int` count) `default` is never null and a null test alone would report every failure as a success. The three-argument overload (`:137-154`) hands the errors back on the failing branch and documents one edge honestly (`:123-129`): a *success* carrying a null value also takes the failing branch, and a success has no errors, so `errors` comes back empty. The framework's own services never produce that shape (a 2xx with no value fails with `Http.EmptyResponse`), but a caller switching on the error list should not assume it is non-empty.
  - **Composing the message.** `LocalizedErrorMessages(this Result, IStringLocalizer?)` (`:166-180`) returns an empty list for a success, so a caller can bind it without a null or success check, and otherwise orders by `ErrorTypeSeverity.Rank` descending, localizes each **error** through the private `LocalizeError` (`:177`) rather than its bare message, drops blanks, and takes ordinal-distinct values (`:175-179`). `LocalizedErrorMessage` (`:190-194`) joins that list with a space and returns `null` for a success. `LocalizeDistinct(IEnumerable<string>?, IStringLocalizer?)` (`:206-218`) gives the same treatment to a plain message list, specifically the `MudForm.Errors` shape whose entries are resource keys produced by the model's DataAnnotations; it preserves original order rather than re-ranking, since those entries carry no `ErrorType`.
  - **Rendering.** `OnFailureSetError(this Result, Action<string?> setError, IStringLocalizer?)` (`:248-255`) hands the composed message to the page's own error field, the one an inline `MudAlert` or the `PageErrorState` component renders (its doc comment names it by its current home, `MMCA.Common.UI.Components.PageState.PageErrorState`, at `:221-222`, matching the file at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/PageState/PageErrorState.razor:1`), and **clears it on success** by passing `null` (`:253`), which is why a retry that succeeds does not leave a stale alert on screen. `NotifyOnFailure(this Result, IToastService, IStringLocalizer?, ToastSeverity = Error)` (`:289-305`) raises the composed message as **one** toast, never one per error, calling `toast.Show(message, severity)` only when the composed message is non-null (`:298-302`). Both return the same result instance so the call can sit inline, and both have a `Result<T>` overload that delegates to the non-generic one and returns the typed result (`:260-264`, `:310-318`), which is what keeps `(await Service.AddAsync(dto, token)).NotifyOnFailure(Toast, L)` chainable. All four rendering overloads carry the same `[SuppressMessage("ApiDesign", "RS0026...")]` (`:247`, `:259`, `:288`, `:309`): two public overloads with optional parameters is the shape RS0026 forbids, and the justification records them as grandfathered, released after the v1.152 public-API baseline while RS0026/RS0027 were off, so changing the signatures now would be a breaking change.
  - **Branching on why.** `HasErrorType(this Result, ErrorType)` (`:328-332`) is the general predicate; the doc comment (`:320-323`) notes the category survives the HTTP round trip through [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), which is what makes this meaningful client-side at all. `IsNotFound()` (`:340`) and `IsUnauthorized()` (`:348`) are the two named cases, and their doc comments state the intended UI reaction: a 404 becomes a "not found" state rather than an error alert, a 401 becomes a redirect to the login route.
  - **The private helpers.** `LocalizeError(Error, IStringLocalizer?)` (`:350-373`) chooses the lookup per error. With no localizer it returns the message verbatim. For a synthesized HTTP status (`ProblemDetailsResultReader.TryGetSynthesizedStatus`) it tries the status's own `Http.{status}` code, then the `Http.Status` format with the status code as argument, then the message (`:360-364`). For the executor's own transport or timeout failure it tries the code, then the message (`:367-369`); `IsSynthesizedTransportFailure` (`:400-405`) matches only when the message is still the executor's own English sentence, so a caller that reused one of those codes with a message of its own keeps it. Anything else falls to `Localize`. `LookUpByCode` (`:377`) asks the caller's localizer first and then the framework's `SharedResources`, and `FormatByCode` (`:386`) does the same for a format string. `Localize(string message, IStringLocalizer?)` (`:407-416`) is where pass-through actually happens: a null localizer or a blank message returns the input unchanged, otherwise it indexes the localizer and returns `localized.ResourceNotFound ? message : localized.Value` (`:415`).
- **Why it's built this way**: extension methods on `Result` rather than an injectable service, because there is no state and nothing to resolve, so a page uses them without a constructor parameter and a unit test calls them directly. Every rendering helper returns the result it was given, which is what allows the fluent one-liner style the class doc advertises. The nullable `IStringLocalizer?` parameter everywhere means the helpers work from a context that has no localizer (they then render verbatim) rather than forcing one in.
- **Where it's used**: by every page and component that calls an [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) member, across the framework package and both consumer apps, plus the shared deduplicating error-summary component. Covered by [ResultUiExtensionsTests](group-28-testing-infrastructure.md#per-project-test-rollup) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Common/ResultUiExtensionsTests.cs:17`) `[Rubric §28, Front-End Testing]`.
- **Caveats / not-in-source**: the class doc opens with "the Result transport (ADR-030)" (`ResultUiExtensions.cs:14`), but ADR-030 is `030-startup-sole-migrator.md`. The Result-pattern record, including the 2026-08-27 revision that names `ResultUiExtensions` and its exact member list, is [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html); the client data-access half is [ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html). Trust the ADR index over the comment.

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
- **Where it's used**: the notification surfaces navigate by these constants rather than by literals: `NotificationSend.razor.cs:72` (its breadcrumb back to the list), `:117` (post-send navigation) and `:136` (the cancel path), `NotificationList.razor.cs:106` (navigate to send), and `NotificationBell.razor.cs:249` (`NavigateToInbox`). [NotificationUIModule](#notificationuimodule) builds its two [NavItem](#navitem) entries from `NotificationInbox` and `Notifications` (`NotificationUIModule.cs:19-20`). ADC's `AppActionRouteMapTests` asserts that a push action resolves to `NotificationRoutePaths.NotificationInbox` (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Services/AppActionRouteMapTests.cs:39`).
- **Caveats / not-in-source**: `NotificationInboxItem` has **no call site** in any of the four repos as of this source; it is listed in `PublicAPI.Unshipped.txt` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Unshipped.txt:315`, recorded there with its resolved signature `NotificationInboxItem(int id)`), while the three string constants are baselined in `PublicAPI.Shipped.txt:913-915`. The `{Id:int}` route it targets is live; the typed builder for it is shipped but not yet adopted.

---

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:31` · Level 10 · class (static, with one `extension(IServiceCollection)` block)

- **What it is**: the composition root of the UI layer. One `AddUIShared(configuration)` call wires the shared UI infrastructure every head needs (Blazor Server, WebAssembly, MAUI), and six smaller methods cover the per-head, per-module and per-opt-in registrations.
- **Depends on**: nearly the whole group. Settings: [ApiSettings](#apisettings), [LayoutSettings](#layoutsettings), [LegalSettings](#legalsettings), [RegistrationSettings](#registrationsettings), [UiReadCacheOptions](#uireadcacheoptions), [NotificationBellOptions](#notificationbelloptions). Authorization: [NotificationPageRequirement](#notificationpagerequirement) / [NotificationPageAuthorizationHandler](#notificationpageauthorizationhandler). Caching: [IUiReadCache](#iuireadcache) / [UiReadCache](#uireadcache). Localization: [PseudoStringLocalizerFactory](#pseudostringlocalizerfactory), [ResxMudLocalizer](#resxmudlocalizer), [InvariantMudLocalizationInterceptor](#invariantmudlocalizationinterceptor). HTTP: [AuthDelegatingHandler](#authdelegatinghandler), [CultureDelegatingHandler](#culturedelegatinghandler), [SameOriginProxyRequestHandler](#sameoriginproxyrequesthandler), [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults). Facades: [IToastService](#itoastservice) / [MudToastService](#mudtoastservice), [IAppDialogService](#iappdialogservice) / [MudAppDialogService](#mudappdialogservice). Services: [IAuthUIService](#iauthuiservice), [IEmailConfirmationUIService](#iemailconfirmationuiservice) / [EmailConfirmationUIService](#emailconfirmationuiservice), [ILegalAcceptanceUIService](#ilegalacceptanceuiservice) / [LegalAcceptanceUIService](#legalacceptanceuiservice), [ViewerTimeZone](#viewertimezone), [OAuthFlowStateStore](#oauthflowstatestore), [ListPageStateService](#listpagestateservice), [ListPageQueryStateService](#listpagequerystateservice), [NavigationHistoryService](#navigationhistoryservice), [ThemeService](#themeservice), [ICultureApplier](#icultureapplier) / [EndpointCultureApplier](#endpointcultureapplier), [IPublicLinkBuilder](#ipubliclinkbuilder) / [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder), [IUserPreferenceWriter](#iuserpreferencewriter), [IUserPreferenceReader](#iuserpreferencereader), [IOAuthUISettings](#ioauthuisettings) / [DefaultOAuthUISettings](#defaultoauthuisettings), [ISessionCookieSync](#isessioncookiesync) / [JsFetchSessionCookieSync](#jsfetchsessioncookiesync). Administration opt-ins: [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto) / [UserAdminService<TUserDto>](#useradminservicetuserdto), [IUserAdminActionsUIService](#iuseradminactionsuiservice), [IRoleAdminUIService](#iroleadminuiservice) / [RoleAdminService](#roleadminservice). Capabilities: [IFormFactor](group-26-device-capability-layer.md#iformfactor) / [WasmFormFactor](group-26-device-capability-layer.md#wasmformfactor). Composition: [IUIModule](#iuimodule), [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype). Externals: Scrutor (`Decorate`, `Scan`), MudBlazor, and `Microsoft.Extensions.{Configuration, DependencyInjection, Localization, Options}` (`DependencyInjection.cs:2-23`).
- **Concept introduced, the composition root written as an `extension(T)` block.** The whole registration surface lives inside `extension(IServiceCollection services)` (`DependencyInjection.cs:33`) rather than as classic `this`-parameter extension methods; see [primer, C# extension(T) types](00-primer.md#c-extensiont-types-read-this-once) for the language mechanics, taught once. `[Rubric §15, Best Practices & Code Quality]` assesses one consistent idiom across layers, and this file matches the other `DependencyInjection` classes in every layer of the workspace. `[Rubric §33, Developer Experience]` assesses fail-fast startup and a small number of calls per host. `[Rubric §12, Performance & Scalability]` assesses whether concerns are wired once, centrally: localization, culture forwarding, authentication, resilience and caching are all configured here rather than per page.
- **Walkthrough**: seven methods in the extension block.
  - **`AddUIShared(IConfiguration configuration)`** (`:39-211`), in order:
    - **Options.** [ApiSettings](#apisettings) binds with `.ValidateDataAnnotations().ValidateOnStart()` (`:42-46`), so a missing `ApiEndpoint` fails the host at startup rather than at the first HTTP call. [LayoutSettings](#layoutsettings) binds without validation because empty defaults are acceptable (`:48-49`), and so do [LegalSettings](#legalsettings) (`:53-54`, the footer, registration-checkbox and terms-dialog links; an absent section leaves every URL empty, which renders none of them) and [RegistrationSettings](#registrationsettings) (`:58-59`, the optional blocks of the shared register page; an absent section keeps every block). [UiReadCacheOptions](#uireadcacheoptions) (`:63-64`) and [NotificationBellOptions](#notificationbelloptions) (`:66-67`) bind the client-side staleness policy; the comment (`:61-62`) records that both sections are optional and an absent section leaves the compiled-in defaults, which is what a host gets without configuring anything.
    - **Clock and read cache.** `TryAddSingleton(TimeProvider.System)` (`:71`), with a comment explaining both directions of the `TryAdd` (`:69-70`): a host that already registered one, as `AddInfrastructure` does, keeps it, and a test substitutes a `FakeTimeProvider`. `TryAddScoped<IUiReadCache, UiReadCache>()` (`:76`) is scoped so it is per-circuit on Blazor Server; the comment (`:73-75`) records the consequence on the other heads, where the scope is the app lifetime, which is why the sign-out path clears it explicitly, otherwise one account's reads would outlive its session `[Rubric §26, Front-End Security]`.
    - **Notification-page policy.** `AddAuthorizationCore` registers a policy named `NotificationPageRequirement.PolicyName` carrying a [NotificationPageRequirement](#notificationpagerequirement) (`:81-83`), and `TryAddEnumerable` adds the transient [NotificationPageAuthorizationHandler](#notificationpageauthorizationhandler) (`:84-85`). The comment (`:78-80`) states the intent: `[Authorize]` semantics, except that a host hiding those pages (`Layout:HideNotificationPagesWhenUnregistered`) lets the request reach the router, which answers 404 instead of the sign-in challenge.
    - **Localization** ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). `AddLocalization()` (`:88`) for `IStringLocalizer<T>`, then `Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (`:95`), registered unconditionally because the pseudo-locale transform is inert under every other culture and the pseudo locale is only ever activatable in Development (`:90-94`). `TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`:101`) localizes MudBlazor's own component text; the comment (`:97-100`) records why `TryAdd` is authoritative regardless of host registration order, namely that `AddMudServices` registers no `MudLocalizer` of its own and a DI resolution test guards that assumption. `AddLocalizationInterceptor<InvariantMudLocalizationInterceptor>()` (`:110`) follows immediately: MudBlazor's own default interceptor reads its built-in English strings by assigning `CultureInfo.CurrentUICulture` (invariant, then the previous value back), which writes an `AsyncLocal` culture into the calling context; on a MAUI hybrid head, where that is the main thread, nothing resets it and the app pins to its launch language even after a culture switch reloads the thread defaults. [InvariantMudLocalizationInterceptor](#invariantmudlocalizationinterceptor) reads the same resource under an explicit invariant culture instead, and registers with replace semantics so it wins whether `AddMudServices` ran before or after this call ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 10) (`:103-109`).
    - **The one HTTP client.** Both delegating handlers register transient (`:114-115`). Before the client itself, `usesSameOriginProxy` is computed from the raw configuration (`:120-121`): it is true only when `Api:SameOriginApiEndpoint` carries a value, which per the comment (`:117-119`) happens only on a WebAssembly client whose Server host opted into the same-origin API proxy ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)) and handed that value down through `/client-config`; every other host (Server, MAUI, a WASM client of a host that did not opt in) keeps the pipeline unchanged. Then the named `"APIClient"` (`:124-147`), whose builder is kept in `apiClient` (`:124`) so a handler can be appended afterwards. Its factory resolves `IOptions<ApiSettings>` and sets `client.BaseAddress = new Uri(apiSettings.SameOriginApiEndpoint ?? apiSettings.ApiEndpoint!, UriKind.Absolute)` (`:131-136`): the same-origin proxy base, when present, replaces the gateway URL for data calls, and the comment (`:134-135`) notes the bootstrap has already resolved it to an absolute address. There is deliberately **no** hand-written endpoint guard, and the comment says why (`:126-130`): resolving `.Value` runs the `ValidateDataAnnotations` rules registered above, so a missing `[Required]` endpoint already fails as an `OptionsValidationException`, and a second check would only give the same failure a different, less informative exception. `client.Timeout` is pinned to [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults)`.TotalRequestTimeout` (`:142`) because the BCL's own 100-second default was chosen with no knowledge of the resilience budget and would cut a call off mid-policy at an arbitrary point (`:138-141`) `[Rubric §29, Resilience & Business Continuity]`. Default headers are cleared and `Accept: application/json` added (`:143-144`), and the two handlers chain in order (`:146-147`) so every outgoing call carries both the bearer token and the active UI culture as `Accept-Language`. When `usesSameOriginProxy` is true, [SameOriginProxyRequestHandler](#sameoriginproxyrequesthandler) is registered transient and appended as the **innermost** handler (`:149-155`); the comment (`:151-152`) gives the reason for that position: it must see, and strip, every `Authorization` header the outer handlers or a service's `DefaultRequestHeaders` attached, and it stamps the proxy's CSRF header `[Rubric §26, Front-End Security]`.
    - **Facades.** `services.AddCommonUiFacades()` (`:159`), factored out so a bUnit harness can register exactly these two without pulling in the whole shared-UI surface (`:157-158`).
    - **Scoped services**, all via `TryAdd` so several composing hosts cannot double-register: [IAuthUIService](#iauthuiservice) (`:162`), [IEmailConfirmationUIService](#iemailconfirmationuiservice) to [EmailConfirmationUIService](#emailconfirmationuiservice) (`:166`, the `/confirm-email` page's client per [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html); a separate interface rather than new `IAuthUIService` members, so a consumer's own `IAuthUIService` implementation keeps compiling, per the comment at `:164-165`), [ILegalAcceptanceUIService](#ilegalacceptanceuiservice) to [LegalAcceptanceUIService](#legalacceptanceuiservice) (`:170`, the terms-acceptance client behind `TermsAcceptanceGate`, registered for every host and inert until a host renders the gate, per the comment at `:168-169`), [OAuthFlowStateStore](#oauthflowstatestore) (`:174`, binding an OAuth completion to the flow this client started so a deep-linked completion code from someone else's provider round trip is dropped instead of exchanged, per its own comment at `:172-173`), [ListPageStateService](#listpagestateservice) (`:175`), [ListPageQueryStateService](#listpagequerystateservice) (`:176`), [NavigationHistoryService](#navigationhistoryservice) (`:177`), [ThemeService](#themeservice) (`:180`, [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), [ICultureApplier](#icultureapplier) defaulting to [EndpointCultureApplier](#endpointcultureapplier) (`:186`), [ViewerTimeZone](#viewertimezone) (`:190`, the viewer's browser time zone, so UTC instants such as notification and session times render on the clock the person reads), [IPublicLinkBuilder](#ipubliclinkbuilder) defaulting to [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) (`:196`), and the per-user preference writer and reader (`:199-200`), documented as best-effort and a no-op for an anonymous user (`:198`). `TryAddSingleton<IOAuthUISettings, DefaultOAuthUISettings>()` (`:204`) supplies a no-op default that a downstream app replaces.
    - **Capabilities.** `AddDeviceCapabilityDefaults()` (`:208`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) so every capability contract resolves on every head, registered here specifically so MAUI and browser hosts can override afterwards under last-registration-wins (`:206-207`).
  - **`AddCommonUiFacades()`** (`:228-233`): two `TryAddScoped` calls, [IToastService](#itoastservice) to [MudToastService](#mudtoastservice) (`:230`) and [IAppDialogService](#iappdialogservice) to [MudAppDialogService](#mudappdialogservice) (`:231`). Its doc comment (`:213-227`) is the clearest statement of the facade rule anywhere in the codebase: apart from these two implementations, the only framework type that names MudBlazor's `ISnackbar` / `IDialogService` is the `DeleteConfirmation` component, which injects `IDialogService` directly to show its typed dialog (pages, other components and the `Result` helpers depend on the contracts), they are scoped to match the MudBlazor services they wrap, and the method is called both by `AddUIShared` and by the shipped bUnit base so a component test resolves the facades without the rest of the shared-UI surface.
  - **`AddClientAuthSessionCookieSync()`** (`:240-244`): one `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>()` (`:242`), the bridge that mirrors the client's in-memory tokens into the HttpOnly cookie read during server-side SSR prerender. Called from both the Blazor Server host and the WebAssembly client (`:235-239`).
  - **`AddWasmFormFactor()`** (`:252-253`): registers [IFormFactor](group-26-device-capability-layer.md#iformfactor) to [WasmFormFactor](group-26-device-capability-layer.md#wasmformfactor) as a singleton. The doc comment names the two alternatives (`:246-251`): `AddCommonWebFormFactor()` from `MMCA.Common.UI.Web` on the Blazor Server head, `AddMauiFormFactor()` from `MMCA.Common.UI.Maui` on the MAUI head.
  - **`AddUserAdministrationUI<TUserDto>()`** (`:269-279`), the [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) UI opt-in for user administration: registers [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto) to [UserAdminService<TUserDto>](#useradminservicetuserdto) (`:271`), then forwards [IUserAdminActionsUIService](#iuseradminactionsuiservice) to the same instance rather than registering it a second time (`:275-276`), so the actions the component performs and the page it lists go through one instance (and one substitute, in a test), per the comment at `:273-274`. The doc comment (`:255-266`) states the call convention (once per app, after `AddUIShared`, with the app's own administration DTO) and that an app which serves no administration endpoints registers nothing and the component the service backs is simply never rendered.
  - **`AddRoleAdministrationUI()`** (`:295-300`): the non-generic [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) sibling, registering [IRoleAdminUIService](#iroleadminuiservice) to [RoleAdminService](#roleadminservice) (`:297`). Its doc comment (`:281-293`) explains why it takes no type parameter unlike `AddUserAdministrationUI<TUserDto>()`: roles and permissions are strings the framework already owns, so there is no app DTO to name.
  - **`AddUIModule<TModule>()`** (`:320-330`), constrained to `TModule : class, IUIModule` (`:321`): a Scrutor scan `FromAssemblyOf<TModule>()` registering every [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) implementation scoped as its implemented interfaces (`:323-327`), then `AddSingleton<IUIModule, TModule>()` (`:329`). The doc comment (`:308-314`) records the deliberate boundary: this is the two-step prologue every module's `Add{Module}UI()` opens with, and module-specific services stay with the caller **afterwards**, so a module whose service must beat a shared default still controls its own registration order. The type-parameter doc (`:316-319`) states the constraint that follows from using the descriptor's assembly as the scan root: it must live alongside the module's entity services and Razor pages.
- **Why it's built this way**: `TryAdd` throughout is both a safety property (several composing hosts calling `AddUIShared` cannot double-register) and the override mechanism (a host that registers its own implementation **before** the call wins). Two ordering choices push in the opposite direction and are called out in comments because they are load-bearing: [ICultureApplier](#icultureapplier)'s default round-trips a server `/culture/set` endpoint that a MAUI hybrid head does not have, so hybrids override it **after** `AddUIShared` (`:182-185`), and [IPublicLinkBuilder](#ipubliclinkbuilder)'s default resolves against the browser origin, which is wrong for a MAUI WebView whose origin is a virtual host nobody else can open, so that is overridden after as well (`:192-195`). [InvariantMudLocalizationInterceptor](#invariantmudlocalizationinterceptor) follows the same head-dependent pattern one layer down: MudBlazor's own interceptor is correct everywhere except the MAUI hybrid main thread, so the replacement is registered unconditionally here rather than left to the affected head to override, because replace semantics make the registration order irrelevant (`:103-110`). [SameOriginProxyRequestHandler](#sameoriginproxyrequesthandler) is the one registration decided by configuration rather than by order: it is added only when `Api:SameOriginApiEndpoint` is present (`:120-121`, `:149-155`), so a host that never opts in carries no trace of it in its pipeline. Read together, the file encodes a rule worth carrying into any new registration: a contract whose correct implementation depends on the *head* is defaulted here and replaced later (or, where replace semantics make order irrelevant, registered outright), while a contract that is the same everywhere is `TryAdd`ed and left alone. The two administration opt-ins follow the same principle one level up: nothing else in the framework calls either one, so an app that serves no administration or role-administration endpoints registers nothing and the corresponding component is simply never rendered.
- **Where it's used**: called once at startup by all six consuming UI hosts (ADC's `MMCA.ADC.UI.Web`, `MMCA.ADC.UI.Web.Client` and MAUI `MMCA.ADC.UI`, plus the three Store equivalents), each followed by the per-module `Add{Module}UI()` calls, which are usually one-liners over `AddUIModule<TModule>()`, for example `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/DependencyInjection.cs:19` and `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:24`. `AddCommonUiFacades()` has a second caller outside any host, the shipped bUnit base (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:54`). `AddUserAdministrationUI<TUserDto>()` and `AddRoleAdministrationUI()` are each meant to be called once per app, after `AddUIShared`, by an app that opts into the corresponding [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) administration surface (`:259`, `:286`); nothing inside the framework itself calls either one. The `"APIClient"` configured here is the client every [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)-derived service resolves. The assembly this class lives in is also the one [UISharedAssemblyReference](#uisharedassemblyreference) names for the architecture fitness suite.

### ApiFileDownloadButton

> MMCA.Common.UI · `MMCA.Common.UI.Components.Forms` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Forms/ApiFileDownloadButton.razor.cs:14` · Level 0 · class (partial component)

- **What it is**: a payload-agnostic icon button that hands the user a file produced by an API endpoint. On a browser it is a plain download link to the endpoint; on a native (MAUI) head, where the WebView cannot download, it fetches the bytes over the API client, stages a temp file, and opens the OS share sheet. Callers supply the endpoint, the file name, the MIME type and the labels; the button knows nothing about what the payload is (`ApiFileDownloadButton.razor.cs:6-13`).
- **Depends on**: [`IExternalLinkService`](group-26-device-capability-layer.md#iexternallinkservice) and [`IShareService`](group-26-device-capability-layer.md#ishareservice) (the device-capability abstractions), [`IToastService`](#itoastservice), [`ApiSettings`](#apisettings) through `IOptions<ApiSettings>`, and `IStringLocalizer<ApiFileDownloadButton>` over the component's own `.resx` pair, all injected in the markup file (`Components/ApiFileDownloadButton.razor:4-9`). Externals: `IHttpClientFactory`, `System.IO.File`/`Path`, and MudBlazor's `MudIconButton`.
- **Concept introduced, one component, two heads, one contract.** `[Rubric §18, UI Architecture]` (assesses whether components have a single clear responsibility and keep host differences out of pages) and `[Rubric §26, Front-End Security]` (assesses whether the front end treats caller-supplied data as untrusted). The head split is decided by a *capability query*, not by a compilation symbol: the markup branches on `ExternalLink.InterceptsLinks` (`ApiFileDownloadButton.razor:18`), and both branches render the same `MudIconButton` with the same icon, size and accessible name, so the affordance looks identical while the mechanism differs ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). The security concept is **path containment**: a file name built from entity data must not be able to steer a filesystem write, which is what `ResolveStagedFileName` exists to prevent.
- **Walkthrough**:
  - Parameters (lines 17-80). Three are `[EditorRequired]`: `RelativeApiPath` (line 19), `FileName` (line 30) and `ShareTitle` (line 35). `ContentType` defaults to `application/octet-stream` (line 43) and is what the share sheet uses to pick target apps. `Icon` defaults to the generic download glyph (line 47), `Size` to `Size.Small` (line 51). `AriaLabel`, `UnavailableMessage` and `FailureMessage` (lines 59, 66, 73) are nullable overrides over localized defaults. `HttpClientName` defaults to `"APIClient"` (line 80), the framework's bearer-token plus culture-header client.
  - `AccessibleLabel` (line 84) resolves `AriaLabel ?? L["Button.Download.Aria"].Value`, and the markup binds it to BOTH `aria-label` and `title` on either branch (`ApiFileDownloadButton.razor:22-23`, `:31-32`), so an icon-only control always carries a name. The default key lives in the component's own resource file (`Components/ApiFileDownloadButton.resx:15`).
  - `BrowserDownloadUrl` (lines 93-103) is the browser branch's `Href`. The anchor is a plain top-level navigation, so it carries cookies but never an `Authorization` header (lines 86-92), and the base is chosen in that light as `SameOriginApiEndpoint ?? WasmApiEndpoint ?? ApiEndpoint` (line 98). On a WebAssembly client of a host running the same-origin API proxy the link targets the proxy, the same base the `"APIClient"` uses: the browser sends the HttpOnly session cookie and the proxy attaches the real bearer server-side, so an authenticated download works with no token in script ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)). Everywhere else it prefers `WasmApiEndpoint` over `ApiEndpoint` because the browser needs the externally reachable gateway URL: on the Server head `ApiEndpoint` may be a container-internal name, and on the WASM head `ApiEndpoint` is already the browser-reachable value fetched from `/client-config`. With no base URL configured it falls back to the relative path (lines 99-100); otherwise it composes an absolute URI (line 101).
  - `ShareDownloadedFileAsync` (lines 105-154) is the native branch. It re-entrancy-guards on `_isExporting` and an empty path (lines 107-110), sanitizes the file name **before** the fetch so an unusable name costs no download (lines 115-121), creates the named client and pulls the bytes (lines 123-124), stages the file (line 126), and calls `Share.ShareFileAsync` (line 128), toasting a warning when no share surface accepted it (line 130). Three catch blocks all surface a toast rather than throwing: `HttpRequestException` (line 133), `OperationCanceledException` (line 137, which here is the `HttpClient` timeout, not a disposal, since no token is passed), and a bare `Exception` (line 143) covering the staging write and the share sheet, because this runs in an `OnClick` callback where an unhandled exception is fatal to a native host (lines 145-147). The `finally` clears the guard (line 152).
  - `ResolveStagedFileName` (lines 167-176) reduces the caller's name to a bare file name with `Path.GetFileName` and rejects `.` and `..` (lines 169-175), returning null when nothing usable remains. The remarks (lines 160-166) state the exact hazard: `Path.Combine` discards its first argument outright when the second is rooted, and `..` segments walk out of the temp root, so an unsanitized name would decide where the delete and the write land.
  - `StageFileAsync` (lines 185-197) writes into `Path.GetTempPath()` under the already-sanitized name (line 187), deleting any leftover first (lines 189-192) so a truncated previous copy is never shared. It deliberately does **not** delete after sharing: on Android the share intent returns as soon as it launches, so deleting would race the receiving app (lines 179-184).
- **Why it's built this way**: the download mechanics are the part every consumer would otherwise re-implement per file type, and they are exactly the part that differs per head, so they belong in the framework behind a capability query ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Keeping the wording out of the component (labels are parameters with localized fallbacks) is what lets one button serve a calendar file, an export, or a receipt without the framework knowing any of those words.
- **Where it's used**: ADC wraps it in a thin calendar affordance, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Components/AddToCalendarButton.razor:8-17`, which supplies `ContentType="text/calendar"`, the calendar glyph, and its own localized aria-label and failure messages while the download and share mechanics stay here. Covered by [`ApiFileDownloadButtonTests`](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: the doc comment on `AriaLabel` (line 54) tags the icon-only accessible-name rule as "ADR-021", but ADR-021 in the current set is `021-consumer-inbox-idempotency`; the accessibility contract the rule belongs to is [ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html). Which apps a native share sheet offers for a given MIME type is OS behavior and not determinable from this source.

### IApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/IApiSettings.cs:6` · Level 0 · interface

- **What it is**: a two-property read-only view of the API configuration a UI host needs: the base URL it calls, and the base URL it hands to a browser.
- **Depends on**: nothing. Two `string?` getters and no using directives.
- **Concept introduced, split-horizon endpoints.** `[Rubric §7, Microservices Readiness]` (assesses whether a component copes with the topology it is deployed into rather than assuming one address space). A Blazor Web host and the browser it serves do not see the gateway the same way. `ApiEndpoint` (line 9) is what the *server* calls, which in production is a container-internal or service-discovery name that resolves nowhere in a browser. `WasmApiEndpoint` (lines 11-17) is the externally reachable URL served to the WebAssembly client through the `/client-config` endpoint. Splitting them lets the server take the faster internal path while the browser gets a name it can resolve, from one configuration section.
- **Walkthrough**: `string? ApiEndpoint { get; }` (line 9) and `string? WasmApiEndpoint { get; }` (line 17). Both are nullable, because the interface itself imposes no requirement; the `[Required]` rule lives on the implementation ([`ApiSettings`](#apisettings)).
- **Why it's built this way**: a read-only interface over an options class is the shape that lets a consumer state "I only read configuration" instead of taking a mutable settings object. It also documents the contract in one place while `ApiSettings` carries the binding and validation attributes.
- **Where it's used**: implemented by [`ApiSettings`](#apisettings) (`Common/Settings/ApiSettings.cs:9`). The two endpoint values are read through `IOptions<ApiSettings>` at the `/client-config` endpoints and in the API client factory, not through this interface.
- **Caveats / not-in-source**: no injection site resolves `IApiSettings` today: a repo-wide search finds the interface only at its declaration and on the `ApiSettings` class. The doc comment (line 15) says `WasmApiEndpoint` "falls back to `ApiEndpoint` when null", but neither host's `/client-config` endpoint actually does that today: both ADC and Store serve it through the shared `MapClientConfigEndpoint` (`MMCA.Common.UI.Web`), which throws an `InvalidOperationException` naming the missing key when `WasmApiEndpoint` is unset instead of substituting `ApiEndpoint` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:58-60`, called from `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:265` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:247`). The fail-closed behavior is now framework policy shared by both hosts, not a per-host divergence, and the doc comment's fallback claim is stale.

### InfiniteScrollSentinel

> MMCA.Common.UI · `MMCA.Common.UI.Components.Lists` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Lists/InfiniteScrollSentinel.razor.cs:21` · Level 0 · class (partial component)

- **What it is**: a bottom-of-list marker that raises `OnVisible` when it scrolls near the viewport, so the hosting page can fetch and append its next page. It owns the IntersectionObserver and nothing else: the item markup, the fetch, and the accumulated list stay with the page.
- **Depends on**: `IJSRuntime` and the shared JS module `_content/MMCA.Common.UI/infinite-scroll.js` (`wwwroot/infinite-scroll.js`), `DotNetObjectReference`, `ElementReference`, and MudBlazor's `MudProgressCircular` in the markup. Nothing first-party; it is a sibling of [`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem), which drives the same JS module.
- **Concept introduced, the observer as a child component so disposal is correct.** `[Rubric §23, Front-End Performance]` (assesses render and network cost: paging on demand instead of loading everything, and detaching observers so they stop costing anything), `[Rubric §21, Accessibility]` (assesses whether dynamic content changes are announced without hijacking focus) and `[Rubric §18, UI Architecture]`. The design point recorded in the doc comment (lines 14-19) is a lifecycle one: a page deriving from [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) cannot hook async disposal because its `DisposeAsync` is not virtual, whereas a child component is disposed by the renderer the moment the host stops rendering it. Rendering the sentinel only while more pages exist therefore makes "detach the observer" a rendering decision rather than a bookkeeping one, and a filter reset that refills the list gets a fresh instance with a fresh observer.
- **Walkthrough**:
  - Parameters: `OnVisible` (line 26), `IsLoading` (line 29) which renders the inline progress row, and `LoadingLabel` (line 32), the localized accessible name for that row.
  - State (lines 34-44): a per-instance `_observerId` (a `Guid` "N" string, line 34), the `_sentinelRef` element reference, the imported `_module`, the `_dotNetRef` self-reference handed to JS, the `_observing` flag, `_wasLoading` (line 43, the previous render's `IsLoading`), and `_disposed`.
  - `OnSentinelVisible()` (lines 50-52) is the `[JSInvokable]` callback. Its name is fixed by the shared JS module, which calls it by string (lines 46-49). It returns immediately when disposed, otherwise marshals onto the renderer with `InvokeAsync` before invoking `OnVisible`.
  - `OnAfterRenderAsync` (lines 55-66) attaches the observer on the first render, and re-attaches it on the render where a load has just finished: `loadJustFinished` is `_wasLoading && !IsLoading && _observing` (line 57), `_wasLoading` is then updated (line 58), and either condition triggers `AttachObserverAsync` (line 60). The reason is recorded on the field (lines 40-42): an IntersectionObserver reports threshold crossings only, so a sentinel that is still inside the viewport when the appended page arrives would never fire again and the list would stall until the user scrolled away and back. Re-observing creates a fresh observer, which delivers a fresh initial entry.
  - `AttachObserverAsync` (lines 106-121) imports the module lazily (lines 110-111), creates the `DotNetObjectReference` once (line 112), calls `observe` with the reference, the element and the id (line 113), and sets `_observing` (line 114). A `JSDisconnectedException` is swallowed (lines 116-120): during prerendering or circuit teardown there is no JS to talk to, and the list simply stops at the pages already loaded rather than failing the render.
  - `DisposeAsync` (lines 69-104) suppresses finalization, guards re-entry with `_disposed`, calls `unobserve` when it was observing (lines 84-87), disposes the module (line 89), tolerates both `JSDisconnectedException` and `JSException` (lines 92-99), and disposes the `DotNetObjectReference` in a `finally` (line 102) so the .NET side is released even if the JS side already went away.
  - The markup (`Components/InfiniteScrollSentinel.razor:4-13`) is a single `div` carrying the element reference, with the progress row rendered only while `IsLoading`. That row is `role="status" aria-live="polite" aria-busy="true"` (line 9), matching `PageLoadingState`'s politeness so a screen reader hears that more items are loading without the announcement interrupting reading.
  - The JS side is deliberately tiny: `observe` disconnects any prior observer for the id, creates an `IntersectionObserver` with `rootMargin: '200px'` and invokes `OnSentinelVisible` on intersection (`wwwroot/infinite-scroll.js:3-14`); `unobserve` disconnects and forgets the id (lines 16-22). The 200px margin is what makes the next page start loading slightly *before* the sentinel is on screen, and the disconnect-before-create step is what makes the post-load re-attach above safe to call repeatedly with the same id.
- **Why it's built this way**: extracting just the observer is what lets a page keep its own cards, empty state and error state and still get infinite scroll (lines 10-13). The alternative, folding the behavior into the list component, would force any page that wants infinite scroll to also adopt that component's layout.
- **Where it's used**: ADC's public speaker list renders it below the card grid while more pages exist, wiring `OnVisible` to its own loader and passing a localized loading label (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Speakers/PublicSpeakerList.razor:144-145`, inside [`PublicSpeakerList`](group-21-conference-ui.md#publicspeakerlist)). Covered by [`InfiniteScrollSentinelTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

### LayoutSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the five settings that make the shared shell look and behave like a specific application: the navbar brand text, an optional brand logo URL, the footer text, an optional role gate on the framework-owned "signed-in devices" nav entry, and an opt-in switch that hides the framework's notification pages in a host that never registered the notification UI.
- **Depends on**: nothing first-party. `System.Diagnostics.CodeAnalysis.SuppressMessage` (BCL) for one analyzer waiver, and the `Microsoft.Extensions.Options` binder at registration time.
- **Concept introduced, a settings section as a bound options class.** `[Rubric §17, DevOps & Deployment]` (assesses whether configuration is centralized and typed rather than read ad hoc) and `[Rubric §20, Design System and Theming]` (assesses whether the look of the app is expressed once rather than repeated per page). The shape repeats across every settings class in this namespace: a `public static readonly string SectionName` naming the configuration section (line 12), `init`-only properties with compiled-in defaults, and one `services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName))` call in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:48-49`). Because every property has a default, an absent section is not an error: the host simply gets the compiled-in values. Components then take `IOptions<LayoutSettings>` and read `.Value`, so nothing in the shell parses configuration itself.
- **Walkthrough**:
  - `SectionName = "Layout"` (line 12).
  - `BrandName` (line 15) defaults to `"MMCA"`. `NavMenu` renders it as the brand link's text and folds it into the link's localized accessible name (`Layout/NavMenu.razor:18`, `:26`).
  - `FooterText` (line 18) defaults to `string.Empty`, and `MainLayout` renders the footer block only when it is non-blank (`Layout/MainLayout.razor:72-76`). An empty default therefore means "no footer", not "an empty footer".
  - `BrandLogoUrl` (line 30) defaults to empty, which renders the text-only brand. When set, `NavMenu` emits an `img` beside the brand text with `alt=""` and `aria-hidden="true"` (`Layout/NavMenu.razor:22-24`): the image is decorative because the brand link already carries its own accessible name, so alt text here would only repeat it to a screen reader (lines 20-24). The property carries a `[SuppressMessage]` for CA1056 (lines 26-29) whose justification records why it is a `string` and not a `Uri`: the value is usually a host-relative path such as `/img/logo.svg`, which `System.Uri` cannot represent without `RelativeOrAbsolute` round-tripping.
  - `SessionsNavRequiredRole` (line 39) is nullable and unset by default, which shows the "signed-in devices" nav entry to every signed-in user. `NavMenu` reads it in `OnInitializedAsync` and computes `_showSessionsLink` as unset-or-blank OR the current user is in that role (`Layout/NavMenu.razor:214-215`). The gate covers only the menu entry: `/profile/sessions` itself stays reachable for any signed-in account whether or not the link is shown (`Layout/NavMenu.razor:78-82`).
  - `HideNotificationPagesWhenUnregistered` (line 49) defaults to `false`, which leaves the routes exactly as they are. When `true`, the framework's notification pages (`/notifications`, `/notifications/inbox`, `/notifications/inbox/{Id}` and `/notifications/send`) answer with the not-found page in a host that never called `AddNotificationUI()`, instead of being reachable by URL with none of the services they need (lines 41-48). The decision is [`NotificationPageGate`](#notificationpagegate)`.Hides`, which requires the flag, a page type in its notification set, and no registered [`NotificationUIModule`](#notificationuimodule) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationPageGate.cs:22-31`), so a host that registers the notification UI is unaffected either way.
- **Why it's built this way**: the shell ships in the framework package, so the only way a consuming app can brand it, narrow a framework-owned menu entry, or close framework-owned routes it does not use, without forking is configuration. Keeping the branding in `appsettings.json` also means a deployment can rebrand without a rebuild.
- **Where it's used**: injected as `IOptions<LayoutSettings>` by `Layout/NavMenu.razor:12` and `Layout/MainLayout.razor:11`, and read by [`NotificationPageGate`](#notificationpagegate) (`Notifications/NotificationPageGate.cs:22`). Configured by every UI host, for example `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:15-18`. Covered by [`NavMenuTests`](group-28-testing-infrastructure.md#per-project-test-rollup) and `NotificationPageGateTests`.

### LegalSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LegalSettings.cs:16` · Level 0 · class (sealed)

- **What it is**: the four legal-document URLs a host can publish (Terms of Service, Privacy Policy, Code of Conduct, and the page explaining how to delete an account), plus a computed flag saying whether any footer document is configured. Every URL defaults to empty, which means "not configured" and hides the link it drives.
- **Depends on**: nothing first-party. `System.Diagnostics.CodeAnalysis.SuppressMessage` (BCL) for the CA1056 waivers, and the `Microsoft.Extensions.Options` binder at registration time.
- **Concept introduced, an empty default as the off switch.** `[Rubric §17, DevOps & Deployment]` (assesses whether configuration is centralized and typed rather than read ad hoc). It follows the same bound-options shape as [`LayoutSettings`](#layoutsettings): a `public static readonly string SectionName = "Legal"` (line 22) and `init`-only properties with compiled-in defaults. Here the default doubles as the feature toggle: an unset URL is `string.Empty`, and each consumer tests `string.IsNullOrWhiteSpace` before rendering a link, so a host opts into each document by configuring it and a host that configures nothing sees no legal UI at all. The section is optional for the same reason; ADR-070 (fail-fast configuration contract) is the reference for which settings must be present and which, like this one, may be absent.
- **Walkthrough**:
  - `TermsUrl` (line 26), `PrivacyUrl` (line 30) and `CodeOfConductUrl` (line 34) are `string` properties defaulting to `string.Empty`. The doc comment on `TermsUrl` states the double effect: empty hides both the footer link and the registration checkbox (line 24).
  - `DeleteAccountUrl` (line 41) is the page that explains how to delete an account, which app stores require for apps that offer sign-up (lines 36-39). It is deliberately outside the footer group.
  - Each URL carries a `[SuppressMessage]` for CA1056 (lines 25, 29, 33, 40) sharing one `UrlJustification` constant (lines 18-19): the value is bound from configuration and emitted straight into an `href`, and the empty default is not a valid `System.Uri`, the same precedent as `LayoutSettings.BrandLogoUrl`.
  - `HasFooterLinks` (lines 44-47) is true when any of the three footer documents (Terms, Privacy, Code of Conduct) is non-blank. `DeleteAccountUrl` is not part of it.
- **Why it's built this way**: the shared shell and the register page ship in the framework package, so the only way an app can publish its own legal documents without forking is configuration. Computing `HasFooterLinks` once on the settings class keeps the "is there anything to show" decision out of every markup file.
- **Where it's used**: bound by `services.AddOptions<LegalSettings>().Bind(...)` in `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:53-54`. `Layout/MainLayout.razor` injects it (line 13), renders the footer when footer text or `HasFooterLinks` is present (line 87), and emits one `ExternalLink` per configured document (lines 104-114). `Components/Legal/TermsAcceptanceGate.razor.cs` reads it through `IOptions<LegalSettings>` (lines 70, 78) and the gate markup checks `Legal.HasFooterLinks` (`TermsAcceptanceGate.razor:17`). `Pages/Auth/Register.razor` injects it (line 17) and shows the Terms checkbox only when a Terms URL is configured (line 143; `Pages/Auth/RegisterModel.cs:46`). ADC's `LegalAndDataCard.razor.cs` on the profile page reads it too. Covered by `MainLayoutFooterTests` and `RegisterTermsTests` in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests`.

### MmcaClientConfigBootstrap

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/MmcaClientConfigBootstrap.cs:28` · Level 2 · class (static)

- **What it is**: the WebAssembly client's bootstrap-time fetch of the `client-config` document (served by [`ClientConfigEndpointExtensions.MapClientConfigEndpoint`](#clientconfigendpointextensions)) into a stream `AddJsonStream` can consume, with one automatic retry on failure or timeout, and with a same-origin API proxy path resolved to an absolute address on the way through.
- **Depends on**: [`ApiSettings`](#apisettings), used only for its `SectionName` and the `SameOriginApiEndpoint` property name when rewriting the document; otherwise `System.Net.Http.HttpClient`, `System.Text.Json.Nodes` and `System.Text.Encoding` (BCL). Nothing it touches needs a service provider, which is deliberate, since it runs before `builder.Services` exists.
- **Concept introduced, a bounded retry at the one point in startup where configuration itself is still unknown.** `[Rubric §29, Resilience, Reliability & Business Continuity]` (assesses whether a single transient failure at startup is survivable) and `[Rubric §17, DevOps & Deployment]`. Every other resilience mechanism in the framework (Polly pipelines, the outbox, internal commands) runs once DI and configuration exist; this runs *before* both, in `Program.cs`, fetching the very document that will configure the rest of the client. A `Polly`-based retry is unavailable at this point (no service provider yet), so the retry is hand-rolled: one attempt, then one retry after a fixed delay, with the caller's own `HttpClient` and its own `Timeout`.
- **Walkthrough**:
  - `ClientConfigPath = "client-config"` (line 31), the relative path both overloads fetch, matching the endpoint's own route.
  - `DefaultTimeout` (line 34, 15 seconds) and `DefaultRetryDelay` (line 37, 1 second) are the defaults the single-argument overload uses.
  - `LoadAsync(Uri baseAddress, CancellationToken)` (lines 49-60) is the convenience overload: it builds a short-lived `HttpClient` scoped to `baseAddress` with `DefaultTimeout`, then delegates to the caller-owned overload. It carries an RS0027 `[SuppressMessage]` (line 48) whose justification records it as a grandfathered public overload whose signature cannot change without a breaking change.
  - `LoadAsync(HttpClient client, TimeSpan retryDelay, CancellationToken)` (lines 72-90) is the real logic: fetch the bytes (line 81), and on `HttpRequestException` or a caller-uncancelled timeout (`IsTimeout`, lines 83, 142-143) wait `retryDelay` then fetch once more (lines 85-86) with no further retry. `IsTimeout` (lines 142-143) is the detail that makes the retry precise: `HttpClient` reports its own per-request timeout as `TaskCanceledException`, the same exception type the caller's own cancellation produces, so the two are told apart by checking whether the caller's token was the one that fired; only a timeout the caller did not ask for is retried.
  - The result passes through `ResolveSameOriginApiEndpoint` against the client's `BaseAddress` and is wrapped in a non-writable `MemoryStream` (line 89), the shape `AddJsonStream` expects.
  - `ResolveSameOriginApiEndpoint(byte[], Uri?)` (lines 98-128, `internal`) exists because a host running the same-origin API proxy serves `Api:SameOriginApiEndpoint` as an origin-relative path (the server cannot know the public origin a browser used behind ingress) while the `"APIClient"` needs an absolute base address (lines 92-97). It returns the document byte for byte unless every precondition holds: an absolute base address (line 100), a document that parses (a `JsonException` is left for configuration binding to report, lines 110-114), an `Api` object holding a non-blank string `SameOriginApiEndpoint` that is not already an http(s) URL (lines 116-124). Only then does it replace the value with `new Uri(baseAddress, path).AbsoluteUri` and re-serialize (lines 126-127). Parsing is case-insensitive on property names (line 108).
  - `IsHttpAbsolute(string)` (lines 136-138, `internal`) accepts only an absolute `http` or `https` URI. A bare absolute-`Uri.TryCreate` check is not enough: on Unix-like runtimes, browser WebAssembly included, `"/api/"` parses as the absolute `file:///api/`, so the relative path would be left unresolved and every client call would go to `file:///api/...` (lines 130-135).
- **Why it's built this way**: a single flaky fetch (a cold container, a brief network blip during a rollout) would otherwise fail the entire WASM client boot before it can render anything, including an error page with any styling. One retry buys resilience against exactly that class of transient failure without turning a genuine outage into a long hang, since both attempts still respect `DefaultTimeout`. Resolving the proxy path here rather than on the server keeps the server ignorant of the browser-facing origin, and doing it on the raw document means every later consumer of [`ApiSettings`](#apisettings) on the client sees an absolute address ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)).
- **Where it's used**: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs` calls `LoadAsync` to populate the WASM client's configuration before any service is registered. The endpoint it fetches from is [`ClientConfigEndpointExtensions`](#clientconfigendpointextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs`). Covered by `MmcaClientConfigBootstrapTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Common/Settings/MmcaClientConfigBootstrapTests.cs`) and `SameOriginProxyClientTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/SameOriginProxyClientTests.cs`).
- **Caveats / not-in-source**: only one retry is ever attempted regardless of how the second attempt fails; a second transient failure fails the boot outright.

### NotificationBellOptions

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/NotificationBellOptions.cs:12` · Level 0 · class (sealed)

- **What it is**: the two numbers that define how stale the unread-notification badge is allowed to be: how often it re-reads the API, and how old its count may be before a navigation re-reads it.
- **Depends on**: nothing first-party. `TimeSpan` (BCL). Bound with the same options shape [`LayoutSettings`](#layoutsettings) introduces.
- **Concept introduced, staleness as a stated policy.** `[Rubric §19, State Management]` (assesses whether client-side state has an explicit freshness contract) and `[Rubric §31, Cost and FinOps]` (assesses whether the design lets an operator trade money against latency). Both numbers are host decisions rather than compiled constants: a deployment paying per API call widens the poll, one where an unread count must feel instant narrows it (lines 6-10). The framing in the doc comment is important for reading the code: the periodic read is the **backstop** behind the real-time push, not the primary path, so `PollInterval` is the budget for "how long a missed push may go unnoticed" (lines 17-22).
- **Walkthrough**:
  - `SectionName = "NotificationBell"` (line 15).
  - `PollInterval` (line 23), default 30 seconds. [`NotificationBell`](#notificationbell) builds its `PeriodicTimer` from it (`Components/Notifications/NotificationBell.razor.cs:103`), against the injected clock rather than the ambient one. Zero or a negative value disables periodic polling while the push refresh and the navigation refresh keep working (lines 20-21): the bell returns before creating the timer when `PollInterval <= TimeSpan.Zero` (`NotificationBell.razor.cs:96-99`), because `PeriodicTimer` rejects such a period and throwing there faulted the circuit (lines 94-95).
  - `NavigationRefreshMaxAge` (line 30), default 30 seconds. On a page change the bell accepts the count it already holds unless it is older than this window (`NotificationBell.razor.cs:166`, via `State.IsStale(...)`). That is what keeps a user clicking through five pages in ten seconds from issuing five reads of a number that has not moved (lines 25-29).
- **Why it's built this way**: both values are pure policy with no correct universal answer, so they belong in configuration; and because both have defaults, a host that says nothing keeps the framework's chosen 30-second budgets.
- **Where it's used**: bound in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:66-67`) and injected as `IOptions<NotificationBellOptions>` by [`NotificationBell`](#notificationbell) (`Components/Notifications/NotificationBell.razor.cs:36`). Covered indirectly by [`NotificationBellTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

### QrErrorCorrectionLevel

> MMCA.Common.UI · `MMCA.Common.UI.Components.Sharing` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Sharing/QrErrorCorrectionLevel.cs:9` · Level 0 · enum

- **What it is**: the four QR error-correction strengths the framework's QR components expose. Higher levels survive more damage or occlusion but pack fewer characters into the same module count, so the code grows denser (lines 4-5).
- **Depends on**: nothing. It is a bare enum with no using directives.
- **Concept introduced, a framework-owned enum instead of a re-exported vendor type.** `[Rubric §9, API and Contract Design]` (assesses whether a public surface is expressed in types the owner controls) and `[Rubric §32, Dependency and Supply-Chain]` (assesses whether third-party types leak into contracts consumers must compile against). The doc comment states the decision outright (lines 6-7): declaring this rather than exposing QRCoder's own `ECCLevel` keeps the component's public API from pinning consumers to the encoder package. The mapping to the vendor type is a private detail of the component, a one-line `switch` in `Components/QrCodeImage.razor:77-82`, so replacing the encoder would not be a breaking change for any page that names this enum.
- **Walkthrough**: four members with explicit values and a stated recovery budget each: `Low = 0` (line 12, about 7% recovery, densest code, short payloads on clean screens), `Medium = 1` (line 15, about 15%, the usual screen and print trade-off), `Quartile = 2` (line 18, about 25%, printed sheets that may get scuffed) and `High = 3` (line 21, about 30%, codes overlaid with a logo or scanned in poor light). The explicit values matter because the enum is bound as a component parameter and compared for change detection.
- **Why it's built this way**: the recovery percentages are properties of the QR standard, not of the encoder, so documenting them on a framework enum keeps the decision (how much damage must this code survive?) at the call site where the physical context is known.
- **Where it's used**: `QrCodeImage` takes it as a parameter defaulting to `Medium` (`Components/QrCodeImage.razor:36`) and maps it to `QRCodeGenerator.ECCLevel` before encoding (`:77-82`); `QrCodeButton` defaults to `Quartile` (`Components/QrCodeButton.razor:65`). ADC passes `Medium` explicitly on the attendee badge (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/MyBadge.razor:36`) and the speaker QR page (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerQr.razor:29`). Covered by [`QrCodeImageTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

### RatingStars

> MMCA.Common.UI · `MMCA.Common.UI.Components.Ratings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Ratings/RatingStars.razor.cs:13` · Level 0 · class (partial component)

- **What it is**: a five-icon star rating display over a `double` value on a 0-5 scale, rendering full, half, or empty stars per position.
- **Depends on**: MudBlazor's `Size` enum and `Icons.Material.Filled.{Star,StarHalf,StarBorder}`. Nothing first-party.
- **Concept introduced, a pure display component with no state of its own.** `[Rubric §18, UI Architecture]` (assesses whether a component's responsibility is genuinely narrow) and `[Rubric §21, Accessibility]` (assesses whether a visual-only rendering carries an equivalent text alternative). Unlike an editable star-rating input, this component only renders: it has no click handler and no two-way binding, so the same `Value` always paints the same five icons regardless of interaction history. The single required `AriaLabel` parameter is what keeps the rating accessible to a screen reader, which otherwise would see five decorative icons and no number.
- **Walkthrough**:
  - `MaxValue = 5` (line 115) is the fixed scale; the markup renders exactly that many icons regardless of `Value`.
  - `Value` (line 127) is a `double` on the 0-`MaxValue` scale. The doc comment (lines 121-125) states the intended caller pattern explicitly: a caller holding a `decimal` average casts it to `double`, because the half-star threshold this component applies needs no decimal precision.
  - `AriaLabel` (lines 130-132) is `[EditorRequired]`, so the compiler enforces that every usage supplies the accessible name for the whole rating; there is no per-star label.
  - `Size` (line 136) defaults to `Size.Small`.
  - `FillFor(int star)` (lines 145-153) is the per-position logic: a star index at or below `Value` is `FullStar`; otherwise it is `HalfStar` when `Value` is within half a star of that position (`Value >= star - 0.5`), else `EmptyStar`. `IconFor(string fill)` (lines 138-143) maps those three string constants to the three MudBlazor icon glyphs through a `switch`, defaulting to the empty-star border icon for any other value.
- **Why it's built this way**: three private string constants (`FullStar`/`HalfStar`/`EmptyStar`) rather than an enum keep the fill/icon mapping a two-function, easily-read pair; the component stays a pure function of `Value` with no fields to maintain across renders.
- **Where it's used**: exercised directly by `RatingStarsTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/Ratings/RatingStarsTests.cs`) and by 4 further call sites in Store's Catalog UI rendering `Product.RatingSummary` on catalog and product-detail pages.
- **Caveats / not-in-source**: the exact call sites beyond the test project were not opened for this section (the brief lists "5" and "and 4 more"); which pages render it is not itemized here.

### RegistrationSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/RegistrationSettings.cs:8` · Level 0 · class (sealed)

- **What it is**: a one-property settings class that lets a host turn the register page's optional postal-address block on or off.
- **Depends on**: nothing first-party. The `Microsoft.Extensions.Options` binder at registration time.
- **Concept introduced, a feature switch that defaults to the framework's existing behavior.** `[Rubric §17, DevOps & Deployment]` (assesses whether configuration is centralized and typed rather than read ad hoc). `CollectAddress` defaults to `true` (line 18), so a host that never configures the `Registration` section (`SectionName`, line 11) keeps the address block it always had; only a host that sets `false` changes anything. ADR-070 (fail-fast configuration contract) covers why an absent optional section is not an error.
- **Walkthrough**: `CollectAddress` (line 18, `get; set;`) is the only member. `true` shows the optional address block; `false` hides it and the registration request carries no address (lines 13-17).
- **Why it's built this way**: not every deployment wants to ask for a postal address at sign-up, and the register page is framework-owned, so configuration is the only way a consuming app can drop the block without forking the page.
- **Where it's used**: bound in `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:58-59`. `Pages/Auth/Register.razor` injects `IOptions<RegistrationSettings>` (line 18) and wraps the address block in `@if (CollectAddress)` (line 107); `Pages/Auth/Register.razor.cs` exposes `CollectAddress` from the options (line 13) and branches on it at line 24. Covered by `RegisterAddressOptionTests` in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth`.

### UIModuleConfiguration

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` · Level 0 · class (static)

- **What it is**: a one-method helper that answers "is this UI module enabled in this host?" by reading `Modules:{moduleName}:Enabled` from configuration, defaulting to enabled when nothing is configured.
- **Depends on**: `Microsoft.Extensions.Configuration.IConfiguration` (`GetSection`, `Exists`, `GetValue`). Nothing first-party, which is what lets a host call it before any DI registration has happened.
- **Concept introduced, composing a UI host from configuration.** `[Rubric §7, Microservices Readiness]` (assesses whether the same codebase can be deployed as different subsets) and `[Rubric §17, DevOps & Deployment]`. The server-side module system registers [`IModule`](group-14-module-system-composition.md#imodule) implementations in topological order; the UI side has its own analogue, [`IUIModule`](#iuimodule), registered by each module's `AddXUI()` extension ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)). This helper is the gate in front of those calls: a host that switches a module off never calls `AddXUI()`, so no `IUIModule` descriptor is registered, and the shell composes without that module's routes, nav entries or services. The default-on behavior (lines 7-8) is a compatibility choice: a host with no `Modules` section behaves exactly as it did before the section existed.
- **Walkthrough**: `ModulesSectionName = "Modules"` (line 12) and `IsModuleEnabled(IConfiguration configuration, string moduleName)` (lines 18-22). It walks two section levels, `Modules` then the module name (line 20), and returns `!section.Exists() || section.GetValue("Enabled", true)` (line 21). Read carefully, that is two independent defaults: an absent module entry is enabled, and a present entry missing the `Enabled` key is also enabled. Only an explicit `false` turns a module off.
- **Why it's built this way**: a static helper over `IConfiguration` (rather than a bound options class) is what makes it usable at the exact point it is needed, inside `Program.cs`/`MauiProgram.cs` before the service provider exists. Keeping the check in the framework rather than hand-rolling `builder.Configuration["Modules:X:Enabled"]` per host is what keeps the default-on semantics identical across all six heads.
- **Where it's used**: all six UI hosts gate their module registrations with it. ADC: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:167-177`, `MMCA.ADC.UI.Web.Client/Program.cs:55-64`, `MMCA.ADC.UI/MauiProgram.cs:129-138` (Identity, Conference, Engagement, Notification). Store: `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:120-126`, `MMCA.Store.UI.Web.Client/Program.cs:51-57`, `MMCA.Store.UI/MauiProgram.cs:83-89` (Catalog, Sales, Identity). The corresponding configuration block is `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:9-14`.

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
- **Where it's used**: bound in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:63-64`) and injected into [`UiReadCache`](#uireadcache) (`Services/Caching/UiReadCache.cs:18`, snapshotted to a field at `:27`). Covered by [`UiReadCacheTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

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
- **Where it's used**: both Blazor Web hosts call it once: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:245` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:171`.
- **Caveats / not-in-source**: whether a given browser honors `no-store` as bfcache-ineligibility is browser behavior, not code, and cannot be verified from this source. This type is distinct from the same-named [`WebApplicationExtensions`](group-12-api-hosting-mapping.md#webapplicationextensions) in the API layer; they share a name across assemblies, not an implementation.

### ApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the bound implementation of [`IApiSettings`](#iapisettings): the `"Api"` configuration section, validated at startup so a host with no API endpoint fails immediately instead of at the first request.
- **Depends on**: [`IApiSettings`](#iapisettings) (the read-only contract it implements) and `System.ComponentModel.DataAnnotations.RequiredAttribute` (BCL).
- **Concept introduced, fail-fast configuration.** `[Rubric §29, Resilience, Reliability & Business Continuity]` and `[Rubric §15, Best Practices and Code Quality]`. The class is three properties of data, but the behavior lives in how it is registered: `AddOptions<ApiSettings>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:42-45`). `ValidateDataAnnotations` turns the `[Required]` attribute into an options validator, and `ValidateOnStart` runs that validator during host startup rather than lazily on first resolution, so a missing `Api:ApiEndpoint` surfaces as an `OptionsValidationException` naming the key before the host accepts traffic ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)). That is what licenses the null-forgiving `apiSettings.ApiEndpoint!` in the client factory (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:133-136`): the validator, not a local check, is the guarantee.
- **Walkthrough**:
  - `SectionName = "Api"` (line 12), the same convention every settings class here uses.
  - `[Required] public string? ApiEndpoint { get; init; }` (lines 15-16). Nullable so the binder can leave it unset, `[Required]` so leaving it unset fails validation. `init`-only, so a bound instance is immutable after construction.
  - `WasmApiEndpoint { get; init; }` (line 19) carries `<inheritdoc />` and no `[Required]`: it is optional at the contract level, and each host decides whether an absent value is acceptable.
  - `SameOriginApiEndpoint { get; init; }` (line 33) is declared on the class only, not on [`IApiSettings`](#iapisettings), and is `null` everywhere except on a WebAssembly client whose Server host opted in with `AddCommonSameOriginApiProxy` (lines 21-32). The host serves it as an origin-relative path in `/client-config` and [`MmcaClientConfigBootstrap`](#mmcaclientconfigbootstrap)`.LoadAsync` resolves it to an absolute address. When it is set, the `"APIClient"` and the notification hub target it instead of `ApiEndpoint`, send no `Authorization` header (the proxy attaches the bearer from the HttpOnly session cookie server-side) and add the proxy's CSRF header; `ApiEndpoint` keeps the gateway URL for full-page navigations that must reach the gateway itself, such as the external sign-in challenge ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)). In the client factory the switch is `client.BaseAddress = new Uri(apiSettings.SameOriginApiEndpoint ?? apiSettings.ApiEndpoint!, ...)` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:136`), and the same configuration key decides at registration time whether the proxy pipeline is wired at all (`DependencyInjection.cs:117-121`).
- **Why it's built this way**: `sealed` plus `init` gives an immutable snapshot of configuration that cannot drift while the app runs. Putting the validation attribute on the options class rather than writing a guard in the `HttpClient` factory keeps one failure mode with one message: the comment at `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:126-130` records that a second hand-written check would only give the same failure a different, less informative exception.
- **Where it's used**: bound in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:42-45`); read by the named `"APIClient"` `HttpClient` factory to set `BaseAddress` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:124-136`, alongside the 90-second total-request timeout at `:120`); read by [`ApiFileDownloadButton`](#apifiledownloadbutton) for its browser download URL (`Components/Forms/ApiFileDownloadButton.razor.cs:98`); read by [`NotificationHubService`](#notificationhubservice) and [`BlazorCspPolicyProvider`](#blazorcsppolicyprovider); and served to the WebAssembly client by each Server head's `/client-config` endpoint, both routed through the shared `MapClientConfigEndpoint` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:52-61`; called at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:265-281` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:247`).

### MobileInfiniteScrollList<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Components.Lists` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Lists/MobileInfiniteScrollList.razor.cs:20` · Level 3 · class (generic partial component)

- **What it is**: the mobile card list every list page falls back to on a narrow viewport. It owns the whole loop: an IntersectionObserver sentinel that asks for the next page, an accumulated item list rendered through a caller-supplied card template, a rendered-item cap that bounds DOM growth, generation-guarded supersession of in-flight fetches, and localized load-failure handling with a Retry button.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (the fetch delegate's return type), [`SharedResource`](#sharedresource) through `IStringLocalizer<SharedResource>`, [`ResultUiExtensions.LocalizedErrorMessage`](#resultuiextensions), the `EmptyState` component, the `ClickableCard` component each row's card is wrapped in, and the shared `_content/MMCA.Common.UI/infinite-scroll.js` module it shares with [`InfiniteScrollSentinel`](#infinitescrollsentinel). Externals: `IJSRuntime`, `DotNetObjectReference`, `CancellationTokenSource`, MudBlazor primitives.
- **Concept introduced, generation-guarded supersession.** `[Rubric §19, State Management]` (assesses whether concurrent updates to client state have a defined winner) and `[Rubric §23, Front-End Performance]`. The hard problem in an infinite list is not fetching, it is what happens when the user changes the filter while a fetch is in flight. Cancellation alone is not enough: the fetch delegate is consumer-supplied and may ignore its `CancellationToken` entirely, so a superseded call can still complete successfully and try to append rows to a list that was cleared. The answer here is a monotonically increasing `_generation` counter (line 62). A load snapshots it before awaiting and discards its results if the value moved while it waited (lines 181-183, 199). The token cancellation is still issued (it stops work that *does* honor it), but the generation, not the token, is authoritative (lines 196-198). The second half of the pattern is that **the page counter is computed, not committed**: `targetPage = _currentPage + 1` (line 190) and `_currentPage` only advances on a successful, non-superseded completion (line 214), so a cancelled, failed or superseded fetch leaves nothing to compensate back and no page is ever re-requested (lines 187-189).
- **Walkthrough**:
  - Injected services (lines 22-23: `IJSRuntime` and the localizer, no toast service) and parameters (lines 25-52). `CardTemplate` is an `[EditorRequired]` `RenderFragment<TItem>` (line 27). `FetchPageResult` (line 37), also `[EditorRequired]`, is the fetch delegate in the shape every Result-returning UI service already has, `(page, pageSize, cancellationToken)` returning `Result<(IReadOnlyList<TItem> Items, int TotalItems)>`, which is [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)`.GetPagedAsync` minus the filter and sort arguments. `PageSize` defaults to 10 (line 39), `MaxRenderedItems` to 500 (line 52).
  - State (lines 54-87): `_items`, `_totalCount`, `_currentPage`, `_generation`, the four render flags (`_isInitialLoad`, `_isLoadingMore`, `_hasMore`, `_loadError`), `_loadErrorMessage`, the interop handles (`_sentinelRef`, `_jsModule`, `_dotNetRef`, `_observerId`, `_cts`, `_observerAttached`), `_reobservePending` (line 86) and `_disposed`.
  - `OnInitializedAsync` (lines 89-95) validates the delegate then loads page 1. `ValidateFetchParameter` (lines 102-109) throws an `InvalidOperationException` when `FetchPageResult` is null, deliberately *before* the load, so a misconfigured call site fails loudly instead of rendering as a load failure with a Retry button that can never succeed (lines 97-101).
  - `OnAfterRenderAsync` (lines 111-120) consumes and clears `_reobservePending` (lines 113-114), then attaches the observer only while more pages exist, there are items to scroll past and the initial load is done, either when none is attached yet or when a re-observe was queued (line 116). `AttachObserverAsync` (lines 122-136) and `DetachObserverAsync` (lines 138-153) import and call the same `observe`/`unobserve` module functions the sentinel component uses, tolerating `JSDisconnectedException` on both paths.
  - `OnSentinelVisible()` (lines 155-168), the `[JSInvokable]` entry point, early-returns when already loading, exhausted or disposed (lines 158-161), then loads on the renderer's context and re-renders.
  - `LoadNextPageAsync(bool isInitial)` (lines 170-252) is the core. It guards re-entry (lines 172-175), clears the error state (lines 178-179), snapshots the generation and publishes a fresh `CancellationTokenSource` (lines 183-185), computes `targetPage` (line 190), and awaits the delegate (line 194). After the await it checks disposal and generation (line 199), unwraps the `Result` with `TryGetValue` and routes a failure to `SetLoadFailed` (lines 204-210), and only then commits: advance the page (line 214), append the items through `AppendNew` and keep the count of new rows (line 216), record the total (line 217), set `_hasMore` from `HasMoreAfter(appended)` (line 218), which is where the DOM cap and the empty-append guard stop the loop, and call `MarkReobserveAfterAppend(isInitial)` (line 220). `OperationCanceledException` is swallowed as a normal supersession (lines 222-225); any other exception raises the generic failure, again only for the current generation (lines 226-234). The `finally` (lines 235-251) is careful about ownership: only the current generation may clear `_isLoadingMore` (a superseding reset already cleared it and may have set it again), and only the still-current `CancellationTokenSource` is disposed here (`ReferenceEquals`, line 244), because a resetter that took one over already cancelled and disposed it.
  - `AppendNew(IEnumerable<TItem> items)` (lines 260-268) appends only the rows not already shown and returns how many were new. Offset paging plus an insert ahead of the window can repeat a row across pages, and rows are keyed by value (`@key="item"`), so a repeat would be two siblings with one key and a render error (lines 254-259). It filters lazily with `_items.Contains` while adding (lines 264-265), so a row repeated inside the same page is caught too; records compare by value, the same equality `@key` uses. `HasMoreAfter(int appended)` (lines 276-277) is `appended > 0 && _items.Count < _totalCount && _items.Count < MaxRenderedItems`: besides the rendered-item cap it stops when a page added nothing new (an empty page, or a window shifted by a whole page), so the re-observed sentinel cannot re-request the same page forever; `ResetAsync` starts over (lines 270-275).
  - `MarkReobserveAfterAppend(bool isInitial)` (lines 283-289) sets `_reobservePending` after a non-initial append that left more pages. The IntersectionObserver reports threshold crossings only, so a sentinel still inside the viewport after the append would never fire again; re-observing creates a fresh observer, which delivers an initial entry with the current state (lines 83-85). This is the same stall [`InfiniteScrollSentinel`](#infinitescrollsentinel) guards against with its post-load re-attach.
  - `SetLoadFailed(Result? failure)` (lines 301-305) sets the inline error state and nothing else: no toast is raised, because the inline alert is announced on its own, rendered in place of the list for a failed first page or below it for a later page (lines 291-294). The message comes from `failure?.LocalizedErrorMessage(L)` (line 304); a raw exception passes `null`, because exception text is neither translatable nor safe to surface (lines 295-299), and the generic resource string is used instead.
  - `CardCallback(TItem item)` (lines 314-317), declared between `SetLoadFailed` and `RetryAsync`, binds one row's click behavior for the markup below. When `OnCardClick` has a delegate it returns an `EventCallback.Factory.Create` wrapping the invoke; when it does not, it returns `default`, deliberately not `EventCallback.Empty`, because `EventCallback.Empty` wraps a no-op `Action` so its `HasDelegate` is still true and every card would present as interactive. `default` is the only value `ClickableCard` reads as "no handler wired", which is what lets it render a plain, non-focusable card instead of a keyboard control that does nothing (lines 307-313).
  - `ResetAsync()` (lines 329-365) is the public API a page calls when filters change. Order matters and is commented: bump the generation *first* so any in-flight fetch is already superseded (line 333), then cancel and dispose the stale token source (lines 335-342), then clear `_isLoadingMore` explicitly (lines 344-347, because the superseded load will not clear it), then reset the list and every flag (lines 349-355), detach the observer (lines 357-358), and reload from page 1 (lines 360-364).
  - `DisposeAsync` (lines 367-399) guards re-entry, cancels and disposes the token source, detaches the observer, disposes the JS module tolerating `JSDisconnectedException`, and disposes the `DotNetObjectReference`.
  - The markup (`Components/Lists/MobileInfiniteScrollList.razor:1-64`) renders one of four shapes: an indeterminate progress bar inside a `role="status"` live region on the initial load (lines 5-14), the load-failure alert when the first page itself failed (lines 15-20, because a failed first page is not an empty list), `EmptyState` when the list came back empty (lines 21-24), or a `MudStack` of `ClickableCard` wrappers around the caller's template, each keyed by item and wired to `CardCallback(item)` (lines 27-34). Below the cards it renders the sentinel `div` only while `_hasMore`, with a polite live-region spinner while a page loads (lines 36-49), and the same alert when a later page failed (lines 51-54). That alert is one `RenderFragment`, `LoadFailedAlert`, carrying `role="alert"` with the message and a Retry button (lines 58-63).
- **Why it's built this way**: the component encapsulates the part of infinite scroll that is genuinely hard to get right (supersession, cancellation ownership, disposal, the DOM cap) and leaves the part that is app-specific (what a card looks like, where the data comes from) to parameters. The `Result`-returning delegate rather than a raw `Task<List<T>>` is what makes a *localized* failure message reachable without the component knowing any error catalogue.
- **Where it's used**: the mobile branch of nearly every list page. ADC: `SessionList.razor:56`, `SpeakerList.razor:41`, `SponsorList.razor:41`, `RoomList.razor:41`, `EventList.razor:31`, `ActivityList.razor:41`, `QuestionList.razor:27`, `ConferenceCategoryList.razor:27`, the public views `PublicSessionListView.razor:6` and `PublicEventList.razor:23`, the check-in `AttendeeSearchPanel.razor:27`, and `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserList.razor:27`. Store: `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/OrderList.razor:26` and `Pages/ShoppingCart/ShoppingCartList.razor:19`. It is also exercised in the component gallery (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Pages/ComponentsGallery.razor:57`) and covered by [`MobileInfiniteScrollListTests`](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: `MaxRenderedItems` bounds the DOM but there is no virtualization, so 500 rendered cards remain in the DOM; whether that is acceptable on a given device is not determinable from source. A consumer fetch delegate that ignores its `CancellationToken` still runs to completion after a reset: the generation guard discards its results, but the request itself is not stopped.

### MoneyExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/MoneyExtensions.cs:14` · Level 5 · class (static)

- **What it is**: the presentation-layer formatter for money, turning a [`Money`](group-02-domain-building-blocks.md#money) value object into `$12.50 USD` and a collection of them into a per-currency range such as `$10.00 - $25.00 USD`, formatted under a caller-chosen or ambient culture.
- **Depends on**: [`Money`](group-02-domain-building-blocks.md#money) and its [`Currency`](group-02-domain-building-blocks.md#currency) (both `MMCA.Common.Shared.ValueObjects`), plus `CultureInfo.CurrentCulture` and `StringComparer.Ordinal` (BCL).
- **Concept introduced, formatting lives in the UI layer, not the value object.** `[Rubric section 3, Clean Architecture]` (assesses whether presentation concerns stay out of the inner layers: `Money` knows amounts and currencies, it does not know what a price *looks like*) and `[Rubric section 20, Design System and Theming]` (assesses consistent presentation of a recurring data shape; one formatter means every price on every page reads the same). It also shows the C# `extension(T)` preview syntax used for something other than DI: two blocks, one on `Money` and one on `IReadOnlyCollection<Money>`, sit in a single static class so both spellings (`price.ToDisplayString()` and `prices.ToDisplayRange()`) are available from one `using`.
- **Walkthrough**:
  - The class carries a file-level `[SuppressMessage("Naming", "CA1708")]` (lines 10-13): with two or more `extension(T)` blocks in one static class, CA1708 flags the compiler-generated grouping members as case-colliding. The justification records that no user-visible identifier differs only by case, a known analyzer trap of the preview syntax.
  - `extension(Money price)` (lines 16-31) exposes `ToDisplayString(CultureInfo? culture = null)` (lines 29-30), which delegates to `FormatGroup(price.Amount, price.Amount, price.Currency.Code, culture)`: passing the same value as both bounds is what makes the shared helper render a single price rather than a degenerate range. Left unset, `culture` resolves inside `FormatGroup` to `CultureInfo.CurrentCulture`, the request's culture as already set by its culture provider; a caller passes one explicitly only when rendering off the reader's thread (a background job, an export, a test).
  - `extension(IReadOnlyCollection<Money> prices)` (lines 33-64) exposes `ToDisplayRange(CultureInfo? culture = null)` (lines 47-63): returns `string.Empty` for an empty collection (lines 49-52), resolves `culture ?? CultureInfo.CurrentCulture` once into `resolved` (line 54, ahead of the grouping), then groups by `Currency.Code` with `StringComparer.Ordinal` and formats each group from its own min and max under `resolved` (lines 58-60), joining the groups with `", "` (line 62). Grouping is the load-bearing detail: a mixed-currency collection renders one range per currency, each with its own symbol, instead of collapsing unrelated amounts under whichever currency appeared first. The inline comment notes `GroupBy` preserves first-appearance order, so the single-currency case (every collection in practice today) is unchanged. Resolving the culture once outside the `Select` and passing it into every `FormatGroup` call is what keeps a one-element range and the single price it holds reading identically: the two paths must not drift.
  - `Symbol(string code)` (lines 71-76), a private switch mapping `"USD"` to `$` and `"EUR"` to the escaped euro sign (line 74, escaped to keep the source file ASCII-only). Every other code, **including the empty code of the `Currency.None` sentinel behind `Money.Zero()`** (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Financial/Currency.cs:25`, `Money.cs:160`), renders with no symbol rather than falsely claiming dollars.
  - `FormatGroup(decimal min, decimal max, string code, CultureInfo? culture)` (lines 88-97), the single formatting path: resolves `culture ?? CultureInfo.CurrentCulture` (line 90), then renders a single price when `min == max` and a hyphen-separated range otherwise, each bound through `FormatAmount` (lines 92-94), and appends the trailing code only when it is non-empty (line 96). Only the digit grouping and decimal separator follow the culture; the currency symbol and the trailing ISO code always come from the money itself, so a USD price stays USD in every locale.
  - `FormatAmount(decimal amount, string symbol, CultureInfo culture)` (lines 103-106) formats one amount with `"N2"` under the resolved culture, so an English reader gets `$1,234.56` and a Spanish reader gets `$1.234,56`. A negative amount puts the sign before the symbol (`-$5.00`, not `$-5.00`) by formatting `Math.Abs(amount)` behind a leading `-`, which keeps the culture's digit grouping intact (lines 99-102).
- **Why it's built this way**: presentational formatting belongs above the domain, so `Money` stays display-agnostic and the same value can be rendered differently by a different head. The move from a hardcoded `CultureInfo.InvariantCulture` to a caller-optional, request-defaulted `CultureInfo.CurrentCulture` lets the number format follow the reader's culture (a Spanish reader's thousands and decimal separators) while the currency symbol and ISO code stay tied to the money's own currency, so the price never implies a currency the data does not carry. The optional parameter keeps every existing call site source-compatible while opening a path for a background job, an export, or a test to format under an explicit culture instead of the ambient one.
- **Where it's used**: Store's Sales and Catalog UIs. `ToDisplayString()` renders order totals and line amounts (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/OrderLinesPanel.razor:63`, `:39`, `:51`; `Pages/Order/OrderSummaryPanel.razor:54`; `Pages/Order/OrderList.razor:36`, `:102`) and the cart's order-created snackbar (`Pages/ShoppingCart/ShoppingCartDetail.razor.cs:354`); `ToDisplayRange()` renders the price span across a product's variants in catalog browse (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogBrowse.CardFormatting.razor.cs:38`, with the single-price helper alongside it at `:41`) and on the catalog product detail page (`Pages/Catalog/CatalogProductDetail.razor.cs:266`, `:269`). None of these call sites pass a `culture` argument, so all of them format under the ambient `CultureInfo.CurrentCulture`. Covered by [`MoneyExtensionsTests`](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: only `USD` and `EUR` have symbols; adding a currency means editing `Symbol`, there is no configuration-driven table. The `"N2"` format assumes a two-minor-unit currency, so a zero-decimal currency (JPY) would render two spurious decimals; no code guards that today.

### BuiltInStrings

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/InvariantMudLocalizationInterceptor.cs:73` · Level 0 · class (private, sealed, nested, implements `IStringLocalizer`)

- **What it is**: a private class nested inside [`InvariantMudLocalizationInterceptor`](#invariantmudlocalizationinterceptor) that resolves MudBlazor's own built-in English strings straight from its embedded resource file, instead of MudBlazor's generated `LanguageResource` class, which is `internal` to the MudBlazor assembly and therefore unreachable directly.
- **Depends on**: `System.Resources.ResourceManager` and `System.Globalization.CultureInfo` (BCL); reads the manifest resource named `"MudBlazor.Resources.LanguageResource"` off `typeof(MudLocalizer).Assembly` (MudBlazor, NuGet). Nothing first-party beyond its owner.
- **Concept**: no new pattern; addressing an internal library resource by its manifest name, plus a minimal singleton (a `private` constructor and a `static Instance` property, lines 79-83).
- **Walkthrough**: `this[string name]` (85-92) calls `Resources.GetString(name, CultureInfo.InvariantCulture)` (89) and returns a `LocalizedString` whose `resourceNotFound` flag is set when that lookup returns null. `this[string name, params object[] arguments]` (94-104) does the same lookup, then formats the resolved string with `CultureInfo.CurrentCulture` when it was found, or falls back to the bare `name` when it was not (98-101). `GetAllStrings(bool includeParentCultures)` (106-122) enumerates the invariant-culture `ResourceSet` (108) and yields a `LocalizedString` per entry, or nothing if the set cannot be created (109-112).
- **Why it's built this way**: `private` and `sealed`, nested inside its only consumer, because it exists solely to give [`InvariantMudLocalizationInterceptor`](#invariantmudlocalizationinterceptor) an `IStringLocalizer` it can pass as the English fallback to the base `AbstractLocalizationInterceptor` constructor; reading the manifest resource by string name is the only way to reach MudBlazor's built-in strings since the generated resource class itself is internal to MudBlazor.
- **Where it's used**: constructed once via `Instance` and passed as the built-in localizer argument to [`InvariantMudLocalizationInterceptor`](#invariantmudlocalizationinterceptor)'s base constructor call (line 38); not referenced outside the file that defines it.

### NotificationPageNotFoundStatus

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationPageNotFoundStatus.cs:11` · Level 0 · class (internal, sealed)

- **What it is**: a render-nothing `ComponentBase` whose only job is to tell the host the response is a 404 when the router answers a notification route with the not-found page.
- **Depends on**: externals only: `Microsoft.AspNetCore.Components` (`ComponentBase`, `[Inject]`, `NavigationManager`). No first-party types.
- **Concept introduced, a not-found that is a real status.** `[Rubric §25, Navigation, Routing & Information Architecture]` assesses whether the routing answer matches what the host composed. Rendering the not-found page alone would still return HTTP 200 on a server render; calling `NavigationManager.NotFound()` is the framework signal that sets the 404 status.
- **Walkthrough**
  - `Navigation` (lines 14-15) is an `[Inject]`ed private `NavigationManager`.
  - `OnInitialized()` (line 18) is the whole behavior: `Navigation.NotFound()`.
- **Why it's built this way**: the call has to run inside a component lifecycle, so the signal is a tiny component rather than code in `Routes.razor`; `internal` because only the router uses it.
- **Where it's used**: mounted through `<DynamicComponent Type="typeof(NotificationPageNotFoundStatus)" />` in the hidden branch of the router (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:25`), next to the not-found page rendered by [NotificationPageGate](#notificationpagegate)'s decision.

### NotificationPageRequirement

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationPageRequirement.cs:20` · Level 0 · class (internal, sealed)

- **What it is**: the `IAuthorizationRequirement` behind the `mmca:notification-pages` policy that the notification pages declare instead of a bare `[Authorize]`. It is a marker with one constant, `PolicyName` (line 23).
- **Depends on**: externals only: `Microsoft.AspNetCore.Authorization` (`IAuthorizationRequirement`). The class doc references [LayoutSettings](#layoutsettings) and [NotificationPageGate](#notificationpagegate).
- **Concept introduced, a policy that can defer to the router.** `[Rubric §11, Security]` and `[Rubric §25, Navigation, Routing & Information Architecture]`. A bare `[Authorize]` becomes endpoint metadata, so on a Blazor Web host the authorization middleware challenged a signed-out request (a sign-in redirect) before the router's gate ran, and a page that does not exist for this host asked the visitor to sign in (class remarks, lines 14-19). The requirement carries no data; the decision is made by [NotificationPageAuthorizationHandler](#notificationpageauthorizationhandler).
- **Walkthrough**: `PolicyName` is `"mmca:notification-pages"` (line 23). The type has no other members.
- **Why it's built this way**: a named policy with its own requirement lets the pass condition be "authenticated, or the pages are hidden" while still reading as `[Authorize]` semantics on the page.
- **Where it's used**: the policy is added in `AddUIShared` with `NotificationPageRequirement.PolicyName` and `new NotificationPageRequirement()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:81-83`); evaluated by the handler (`NotificationPageAuthorizationHandler.cs`, 3 references).

### PseudoLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` · Level 0 · class (static)

- **What it is**: a pure string transform that "pseudo-localizes" text. It accents every letter, pads the result by roughly 40% to simulate real-translation expansion, and wraps it in `[!! ... !!]` bracket sentinels, while leaving composite-format placeholders (`{0}`, `{name}`) byte-identical so the string can still be formatted with arguments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: `System.Text.StringBuilder` and `char.IsLetter` (BCL). Nothing first-party. It is consumed by [`PseudoStringLocalizer`](#pseudostringlocalizer).
- **Concept introduced, pseudo-localization as an i18n fitness test.** `[Rubric §27, Internationalization]` (assesses whether the app is genuinely translation-ready, not just wired for one extra language) and `[Rubric §28, Front-End Testing]` (assesses whether i18n defects are caught automatically). Pseudo-localization is a development-time technique that surfaces three classes of bug in a single visual pass, without needing a real second translation, and the `<remarks>` block (`PseudoLocalizer.cs:12-19`) enumerates exactly those three: (1) any string that stays plain ASCII was **hard-coded** rather than pulled from a resource, and stands out beside the accented text; (2) any UI that **truncates** the padded text has a fixed-width layout that a real (longer) translation would break; (3) any label built by **concatenating fragments** shows one sentinel per fragment, exposing the joins that translate badly.
- **Walkthrough**:
  - Three constants (lines 22-24): `OpenSentinel = "[!! "`, `CloseSentinel = " !!]"`, and `CombiningAcute` (the combining acute accent code point) appended after each base glyph so the letter stays readable while visibly altered.
  - `Transform(string value)` (lines 30-74): returns null/empty input unchanged (lines 32-35); pre-sizes a `StringBuilder` with slack for the padding (line 37) and appends the open sentinel (line 38); then walks each character in a `switch` (lines 42-66) tracking an `insidePlaceholder` flag toggled by `{` and `}` (lines 46-53) so placeholder bodies are copied verbatim, and for every letter *outside* a placeholder appends the combining accent and increments a `letters` counter (lines 54-64); finally computes the pad length as `Math.Max(1, letters * 2 / 5)` (about 40%, line 69), appends a separating space (line 70), that many `~` characters (line 71) and the close sentinel (line 72), and returns the string (line 73).
- **Why it's built this way**: keeping the transform **pure and static** (input string to output string, no culture check inside) makes it trivially unit-testable and lets the *culture gating* live one layer up in [`PseudoStringLocalizer`](#pseudostringlocalizer). Preserving `{...}` placeholders is essential: transforming them would corrupt `string.Format`, so pseudo-loc must accent the template and only then substitute arguments (see the two-step in `PseudoStringLocalizer`).
- **Where it's used**: called by [`PseudoStringLocalizer`](#pseudostringlocalizer) on every resolved string when the current UI culture is the pseudo locale ([`SupportedCultures.PseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures), referenced in the doc comment at line 10); inert otherwise. Covered by [`PseudoLocalizationTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

### StringLocalizerPluralExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/StringLocalizerPluralExtensions.cs:20` · Level 0 · class (static)

- **What it is**: a static extension class that adds a `Plural(key, count, args)` method to `IStringLocalizer`, resolving the count-appropriate resource key (a `.One` suffix for a count of exactly one, `.Other` for every other count, zero included) with a fallback to the base key when the plural-specific entry is missing.
- **Depends on**: `Microsoft.Extensions.Localization.IStringLocalizer`/`LocalizedString` (NuGet). No first-party dependency.
- **Concept introduced, plural-form resolution via key suffixing.** `[Rubric §27, Internationalization]` assesses whether the app handles languages whose plural rules diverge from a naive singular-versus-plural split; this extension implements the simpler English-style two-category split (one, other) as a suffix convention on top of the standard `IStringLocalizer` indexer, rather than pulling in a full CLDR plural-rules library. `OneSuffix` (`".One"`, line 23) and `OtherSuffix` (`".Other"`, line 26) are the two constants callers key their resx entries against. The C# `extension(IStringLocalizer localizer)` block (line 28) is the new extension-member syntax the workspace's `LangVersion: preview` setting enables, in place of a classic `this IStringLocalizer localizer` first parameter.
- **Walkthrough**: `Plural(string key, int count, params object[] args)` (lines 40-52) validates its arguments (42-44), picks `pluralKey` as `key + OneSuffix` when `count == 1` or `key + OtherSuffix` otherwise (46), resolves it through the localizer's indexer (47), and if that lookup's `ResourceNotFound` is true, falls back to the base `key` itself (51): the comment at 49-50 records why the fallback matters, `ResourceNotFound` is how a `ResourceManager`-backed localizer reports a missing key, by handing back the key name itself, which must never reach the screen.
- **Why it's built this way**: the fallback to the unsuffixed `key` means a resx file that has not yet been split into `.One`/`.Other` entries still renders something legible instead of a raw resource-key string; the suffix convention keeps plural-aware resources in the same flat resx format every other string uses, no separate plural-rules resource format.
- **Where it's used**: not referenced outside the file that defines it.

### InvariantMudLocalizationInterceptor

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/InvariantMudLocalizationInterceptor.cs:37` · Level 1 · class (internal, sealed)

- **What it is**: MudBlazor's interception point for resolving its own chrome text, tuned so the neutral `"en"` culture (whose parent is the invariant culture) still routes through the app's `MudLocalizer` like every other non-English culture, and only `"en-US"` (and other cultures whose parent is literally English) short-circuits straight to MudBlazor's built-in strings ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: [`BuiltInStrings`](#builtinstrings) (its own nested Level 0 type, passed as the built-in localizer), an optional `MudLocalizer` constructor parameter (MudBlazor, NuGet), and the base class the constructor chains into, `AbstractLocalizationInterceptor(BuiltInStrings.Instance, mudLocalizer)` (line 38).
- **Concept introduced, matching a library's own "is this English" test rather than assuming one.** `[Rubric §27, Internationalization]`. The comment at lines 46-48 records the design constraint directly: this interceptor deliberately reproduces MudBlazor's own definition of "is this culture English", the culture's *parent's* two-letter ISO name equals `"en"` so a specific culture like `"en-US"` counts as English, but the neutral `"en"` culture itself (whose parent is the invariant culture, not English) does not, and instead flows through `MudLocalizer` like any other culture, falling back to the built-in string only if that lookup reports `ResourceNotFound`.
- **Walkthrough**: the primary constructor (line 37) takes an optional `MudLocalizer? mudLocalizer` and passes it, alongside [`BuiltInStrings.Instance`](#builtinstrings), to the base `AbstractLocalizationInterceptor`. `Handle(string key, params object[] arguments)` (lines 41-61) validates its arguments (43-44), computes `isEnglish` by comparing `CultureInfo.CurrentUICulture.Parent.TwoLetterISOLanguageName` to `"en"` with `OrdinalIgnoreCase` (49-52), and returns straight from `BuiltIn(key, arguments)` (56) when `MudLocalizer` is null or the culture is English (54-57); otherwise it tries `MudLocalizer[key, arguments]` (59) and falls back to `BuiltIn` when that translation reports `ResourceNotFound` (60). The private `BuiltIn(string key, object[] arguments)` helper (65-66) is a no-argument-indexer call when `arguments` is empty, the comment at 63-64 notes that formatting a value containing literal braces with an empty argument list would throw, and MudBlazor's own strings are looked up the same way.
- **Why it's built this way**: reusing MudBlazor's own English-detection rule, rather than a simpler "does the culture name start with `en`" check, keeps this interceptor's fallback behavior identical to MudBlazor's default `DefaultLocalizationInterceptor` for the one case (the neutral `"en"` culture) where a naive check would diverge from it.
- **Where it's used**: `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs` (1 reference, its registration). Tested by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Globalization/InvariantMudLocalizationInterceptorTests.cs`.

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
- **Where it's used**: registered as MudBlazor's `MudLocalizer` in `AddUIShared` via `services.TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:101`). `TryAdd` is authoritative because `AddMudServices` does not register a `MudLocalizer` of its own (guarded by a DI-resolution test, per the comment at `DependencyInjection.cs:97-100`), regardless of host registration order. Covered by [`ResxMudLocalizerTests`](group-28-testing-infrastructure.md#per-project-test-rollup).

### PseudoStringLocalizerFactory

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` · Level 2 · class (sealed)

- **What it is**: an `IStringLocalizerFactory` decorator that wraps *every* localizer the inner factory produces in a [`PseudoStringLocalizer`](#pseudostringlocalizer), so decorating this one factory pseudo-localizes every `IStringLocalizer<T>` and `IStringLocalizer` in the host at once ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: [`PseudoStringLocalizer`](#pseudostringlocalizer) (Level 1) and `IStringLocalizerFactory`/`IStringLocalizer` (Microsoft.Extensions.Localization, NuGet). Constructed with the `inner` factory via a primary constructor (line 11).
- **Concept introduced, decorate the factory to reach every product.** `[Rubric §2, Design Patterns]` (Decorator applied at the *factory* level) and `[Rubric §6, CQRS & Event-Driven Design]` (assesses whether cross-cutting behavior is injected in one place rather than scattered). Because `StringLocalizer<T>` resolves its backing localizer through the `IStringLocalizerFactory`, wrapping the factory means every localizer the DI container ever hands out is already pseudo-aware: no per-type registration, no consumer change. This is the same "decorate the boundary, not the callers" idea the CQRS pipeline uses (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), applied to localization.
- **Walkthrough**: two forwarding overrides, each wrapping the inner factory's product:
  - `Create(Type resourceSource)` (lines 14-15): `new PseudoStringLocalizer(inner.Create(resourceSource))`, the path used by `IStringLocalizer<T>`.
  - `Create(string baseName, string location)` (lines 18-19): `new PseudoStringLocalizer(inner.Create(baseName, location))`, the path used by name-based localizers.
- **Why it's built this way**: registering the wrapper on the factory is the minimal, DI-idiomatic way to make pseudo-loc universal; combined with the culture gate inside [`PseudoStringLocalizer`](#pseudostringlocalizer), it can be registered **unconditionally** because it is inert under every non-pseudo culture, so production wiring is not conditional on environment (the registration comment, `DependencyInjection.cs:90-94`, says exactly that: the pseudo locale is only ever activatable in Development).
- **Where it's used**: registered via `services.Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (Scrutor) in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:95`), after `services.AddLocalization()` (line 60). Its reach includes MudBlazor chrome through [`ResxMudLocalizer`](#resxmudlocalizer), which resolves its `IStringLocalizer<MudTranslations>` through this same factory.

### NotificationUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15` · Level 7 · class (sealed)

- **What it is**: the notification feature's [IUIModule](#iuimodule) descriptor. It declares the two nav entries (user inbox, admin push notifications), the app-bar component, the layout component, and the assembly to scan for routable pages.
- **Depends on**: first-party: [IUIModule](#iuimodule) (the contract, line 15), [NavItem](#navitem) and [NavSection](#navsection) (the nav item shape and its placement enum), [NotificationRoutePaths](#notificationroutepaths) (the two routes), [SharedResource](#sharedresource) (the resx type each nav label resolves against), [NotificationPermissions](group-10-notifications.md#notificationpermissions) (the `Manage` gate), plus the [NotificationBell](#notificationbell) and `NotificationListener` components in the same package (lines 23, 25). Externals: `MudBlazor` (`Icons.Material.Filled.*`), `System.Reflection` (`Assembly`).
- **Concept introduced, the UI module pattern (the client-side counterpart to [IModule](group-14-module-system-composition.md#imodule)).** `[Rubric §25, Navigation, Routing & Information Architecture]` assesses how navigation is composed and how routes are discovered. Server modules declare their registrations and dependencies through `IModule`; UI features do the same for the shell. Nothing here calls into a layout: the module *declares* nav items and component types as data, and the host discovers every registered [IUIModule](#iuimodule) and assembles the menu, app bar, and layout from those declarations. Adding a feature therefore never edits a shared `MainLayout.razor` or a central menu file.
  - `[Rubric §18, UI Architecture & Component Design]` applies to the two component collections: `AppBarComponentTypes` and `LayoutComponentTypes` are `Type` handles, so the shell renders them dynamically without a compile-time reference to the feature.
  - `[Rubric §11, Security]` applies to the permission gate: the admin entry carries `RequiredPermission: NotificationPermissions.Manage` (line 20) on the nav item itself, so the authorization fact lives next to the thing it protects rather than in a layout `if`.
  - `[Rubric §27, Internationalization & Localization]`: the nav labels are **resource keys plus a resource type**, `"Nav.NotificationInbox"` and `"Nav.PushNotifications"` with `typeof(SharedResource)` (lines 19-20), not literal English. A descriptor is a singleton built once at startup, so it cannot hold a localized string; carrying the key and the resx anchor instead is what lets the shell resolve the label per circuit under the active culture.
- **Walkthrough**
  - `NavItems` (lines 17-21) is an immutable `IReadOnlyList<NavItem>` with two entries: the inbox key `Nav.NotificationInbox` to `NotificationRoutePaths.NotificationInbox` with the `Inbox` icon in `NavSection.User` (line 19, no role, so any authenticated user sees it), and `Nav.PushNotifications` to `NotificationRoutePaths.Notifications` with the `NotificationsActive` icon, gated on `NotificationPermissions.Manage`, in `NavSection.Admin` and grouped under the resource key `"Nav.Group.Notifications"` (line 20), so the group heading is localized like the labels.
  - `AppBarComponentTypes` (line 23) is `[typeof(NotificationBell)]`, the badge the shell injects into the top bar.
  - `LayoutComponentTypes` (line 25) is `[typeof(NotificationListener)]`, mounted once per layout so the SignalR callback wiring has exactly one owner.
  - `Assembly` (line 27) returns `typeof(NotificationUIModule).Assembly`, which the host adds to the Blazor router's additional assemblies so the pages in this package become routable in the consumer app.
- **Why it's built this way**: expressing contributions as data (collections of records and `Type`s) keeps the shell open for extension and closed for modification, and it is what allows a package to ship a complete feature (routes, nav, app-bar widget, background listener) that a host enables with one DI call. The class is `sealed` and every member is a get-only auto-property initialized inline, so the descriptor is safely shared as a singleton.
- **Where it's used**: registered as a singleton [IUIModule](#iuimodule) by `AddNotificationUI()` in the notifications [DependencyInjection](#dependencyinjection-2) (`Notifications/DependencyInjection.cs:39`); enumerated by the host shell at startup to build navigation and to discover this package's routable components.

### NotificationPageGate

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationPageGate.cs:12` · Level 8 · class (internal, static)

- **What it is**: the two-method predicate (`Hides` and `HidesNotificationPages`) the framework router consults to decide whether a matched notification page should be answered with the not-found page instead, because the host opted in and never registered the notification UI (class doc, lines 7-11).
- **Depends on**: first-party: [LayoutSettings](#layoutsettings) (the `HideNotificationPagesWhenUnregistered` opt-in, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:49`), [IUIModule](#iuimodule) (the registered modules it scans), [NotificationUIModule](#notificationuimodule) (the module whose presence means "registered"), and the three routable pages it guards, [NotificationList](#notificationlist), [NotificationInbox](#notificationinbox) and [NotificationSend](#notificationsend). Externals: BCL `System.Type` and LINQ (`Contains`, `Any`).
- **Concept introduced, a feature's routes follow its registration.** `[Rubric §25, Navigation, Routing & Information Architecture]` assesses whether what is reachable by URL matches what the host actually composed. The notification pages ship in the `MMCA.Common.UI` assembly itself, so they are routable in every host whether or not it called `AddNotificationUI()`; a host that never registered the feature would serve pages whose services it never registered, which fail at render. The UI module pattern ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)) already makes the [NotificationUIModule](#notificationuimodule) singleton the evidence of registration, so the gate reads that rather than probing for individual services.
  - **Opt-in, not a behavior change.** `HideNotificationPagesWhenUnregistered` defaults to `false`, which leaves the routes exactly as they are, and a host that registers the notification UI is unaffected either way (`LayoutSettings.cs:38-49`). Only a host that sets the flag and lacks the module gets the not-found answer.
- **Walkthrough**
  - `NotificationPages` (line 15) is a private static `Type[]` of `typeof(NotificationList)`, `typeof(NotificationInbox)` and `typeof(NotificationSend)`, the routable pages that need the services `AddNotificationUI()` registers.
  - `Hides(Type pageType, LayoutSettings settings, IEnumerable<IUIModule> modules)` (lines 22-23) is `NotificationPages.Contains(pageType) && HidesNotificationPages(settings, modules)`: the matched page must be one of the three before the host-level question is asked.
  - `HidesNotificationPages(LayoutSettings settings, IEnumerable<IUIModule> modules)` (lines 29-31) is the page-independent half: the flag is on (line 30) and no registered module `is NotificationUIModule` (line 31). It is `public` so [NotificationPageAuthorizationHandler](#notificationpageauthorizationhandler) can ask the same question without a page type.
- **Why it's built this way**: keeping the decision in a small `internal static` predicate, with the page type, settings and module list passed in, keeps `Routes.razor` to a one-line branch and lets a unit test cover every combination without rendering a router. Answering with the framework's own not-found page inside the main layout gives the user the same experience as any unknown URL instead of a render failure.
- **Where it's used**: called once per route match from the `<Found>` branch of the framework router, `NotificationPageGate.Hides(routeData.PageType, LayoutOptions.Value, UIModules)` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:16`), which renders `Pages.NotFound` inside `MainLayout` when it returns `true`; pinned by `NotificationPageGateTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Notifications/NotificationPageGateTests.cs`, 4 references).
- **Caveats / not-in-source**: the `LayoutSettings` doc lists four routes (`/notifications`, `/notifications/inbox`, `/notifications/inbox/{Id}`, `/notifications/send`) while the gate matches three page types, so the inbox detail route is presumably served by one of those three pages; which page carries it is not visible from these files.

### NotificationPageAuthorizationHandler

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationPageAuthorizationHandler.cs:14` · Level 9 · class (internal, sealed)

- **What it is**: the `AuthorizationHandler<NotificationPageRequirement>` that evaluates the `mmca:notification-pages` policy: it succeeds for any authenticated caller, and also for every caller when the host hides the notification pages.
- **Depends on**: first-party: [NotificationPageRequirement](#notificationpagerequirement) (the requirement it handles), [NotificationPageGate](#notificationpagegate) (`HidesNotificationPages`), [LayoutSettings](#layoutsettings) (via `IOptions<LayoutSettings>`), [IUIModule](#iuimodule) (the registered modules). Externals: `Microsoft.AspNetCore.Authorization`, `Microsoft.Extensions.Options`.
- **Concept introduced, authorization that steps aside for a 404.** `[Rubric §11, Security]` assesses that access rules are explicit and centrally evaluated. The handler keeps `[Authorize]` semantics but lets a hidden page reach the router, so a signed-out visitor to a route the host does not serve gets a not-found answer instead of a sign-in challenge (requirement doc, `NotificationPageRequirement.cs:6-13`). Nothing is ever failed explicitly: the handler only calls `Succeed`, so an unauthenticated caller on a host that shows the pages falls through to the default denial.
- **Walkthrough**
  - Primary constructor (lines 14-16) takes `IOptions<LayoutSettings> layoutOptions` and `IEnumerable<IUIModule> modules`.
  - `HandleRequirementAsync` (lines 20-33) guards `context` with `ArgumentNullException.ThrowIfNull` (line 24), then calls `context.Succeed(requirement)` (line 29) when any identity `IsAuthenticated` (line 26) or `NotificationPageGate.HidesNotificationPages(layoutOptions.Value, modules)` is true (line 27), and returns `Task.CompletedTask` (line 32).
- **Why it's built this way**: delegating the "hidden" question to `NotificationPageGate.HidesNotificationPages` means the router and the policy cannot disagree about when the pages are hidden. The handler is synchronous work wrapped in a completed task because no I/O is needed.
- **Where it's used**: registered as a transient `IAuthorizationHandler` with `TryAddEnumerable` in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:84-85`), alongside the policy registration at lines 81-83.

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
- **Caveats / not-in-source**: this method does not register [NotificationBellOptions](#notificationbelloptions). The bell injects `IOptions<NotificationBellOptions>` (`NotificationBell.razor.cs:36`) and the options type supplies its own defaults (`NotificationBellOptions.cs:23,30`), so the unconfigured case works, but where a host binds the `NotificationBell` configuration section is not visible from this file.

### PermissionGroup

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminEdit.razor.cs:328` · Level 0 · record (private, sealed, nested)

- **What it is**: a private record nested inside [`RoleAdminEdit`](#roleadminedit) that groups the permissions filed under one `area:capability` prefix, the shape the edit form renders one checkbox section per.
- **Depends on**: nothing first-party beyond its own owner; an `IReadOnlyList<string>` for the member permissions.
- **Concept**: no new pattern; a compact in-memory grouping record with two positional properties.
- **Walkthrough**: `Area` (the text before the first colon, or the localized "General") and `Permissions` (that area's permissions, ordered). Built by `RoleAdminEdit.Group(IEnumerable<string>)` (`RoleAdminEdit.razor.cs:308-317`), which groups the catalog's permissions by [`RoleAdminEdit.AreaOf`](#roleadminedit) and orders both the groups and each group's members with `StringComparer.Ordinal`, so the checkbox layout is stable across loads.
- **Why it's built this way**: `private` and `sealed` because it exists only to shape one component's markup loop; nothing outside `RoleAdminEdit` needs it.
- **Where it's used**: the `_groups` field of [`RoleAdminEdit`](#roleadminedit) (`RoleAdminEdit.razor.cs:131`), populated by `Group(...)` and iterated by the permission checkbox markup.

### RoleAdminEditResources

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminEditResources.cs:14` · Level 0 · class (sealed, empty)

- **What it is**: an empty marker class, `public sealed class RoleAdminEditResources;`, whose only job is to be the generic argument of an `IStringLocalizer<RoleAdminEditResources>`.
- **Depends on**: nothing; it carries no members.
- **Concept introduced, a fallback-resource marker for an app-first localization pattern.** `[Rubric §27, Internationalization]` assesses whether an app can supply its own wording without forking framework code. [`RoleAdminEdit`](#roleadminedit) injects `IStringLocalizer<RoleAdminEditResources>` as `L` (`RoleAdminEdit.razor.cs:160`) and its private `T(key, args)` helper (`:205-217`) checks the caller-supplied `Localizer` parameter first, falling through to `L` (this marker's resx) only when the app's localizer does not carry the key. The marker class itself defines no strings; it exists purely so .NET's resource-file convention (`RoleAdminEditResources.resx` beside the class) has something to key against.
- **Walkthrough**: no members.
- **Why it's built this way**: `sealed` because nothing subclasses a resource marker; kept as a distinct class per component (paired with `RoleAdminListResources`, `UserAdminListResources`) rather than one shared marker, so each component's resx file, and its "app localizer not consulted for this key" fallback, is scoped independently.
- **Where it's used**: `RoleAdminEdit.razor.cs` (3 references: the injected `L` property, the `T` fallback call, and the DI registration type argument) and 2 more, including `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`.

### RoleAdminListResources

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminListResources.cs:14` · Level 0 · class (sealed, empty)

- **What it is**: the same empty resx-marker shape as [`RoleAdminEditResources`](#roleadmineditresources), scoped to [`RoleAdminList`](#roleadminlist) instead.
- **Depends on**: nothing; no members.
- **Concept reinforced**: the app-localizer-first fallback [`RoleAdminEditResources`](#roleadmineditresources) introduces. `[Rubric §27, Internationalization]`.
- **Walkthrough**: no members.
- **Why it's built this way**: kept distinct from `RoleAdminEditResources` so the two components' resx files, and their independent "app localizer missing this key" fallbacks, do not share one namespace.
- **Where it's used**: `RoleAdminList.razor.cs` (3 references) and 2 more, including `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`.

### UserAdminListResources

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminListResources.cs:14` · Level 0 · class (sealed, empty)

- **What it is**: the same empty resx-marker shape, scoped to [`UserAdminList<TUser>`](#useradminlisttuser).
- **Depends on**: nothing; no members.
- **Concept reinforced**: the app-localizer-first fallback [`RoleAdminEditResources`](#roleadmineditresources) introduces. `[Rubric §27, Internationalization]`.
- **Walkthrough**: no members.
- **Why it's built this way**: same rationale as its two siblings, one marker per component so each keeps its own resx and fallback scope.
- **Where it's used**: `UserAdminList.razor.cs` (3 references) and 2 more, including `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`.

### RoleAdminEdit

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminEdit.razor.cs:36` · Level 4 · class (partial, `ComponentBase, IDisposable`)

- **What it is**: the UI half of ADR-116 role administration: an editable, grouped checkbox matrix of every permission the catalog knows about for one `Role`, with code-compiled permissions shown locked and only the operator's extra grants persisted.
- **Depends on**: `IRoleAdminUIService` (injected as `Roles`, line 80), `IToastService` (`Toast`, 82), `IStringLocalizer<RoleAdminEditResources>` (`L`, 84, see [`RoleAdminEditResources`](#roleadmineditresources)), `LatestLoadGuard` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:38`, held as `_load`, line 42), its own nested [`PermissionGroup`](#permissiongroup) record, and `AdministrationPermissions.ManageRoles` (`MMCA.Common.Shared.Auth.Administration`). Externals: `Microsoft.Extensions.Localization.IStringLocalizer`, Blazor's `ComponentBase`.
- **Concept introduced, a compiled/stored permission split rendered as locked vs. editable checkboxes.** `[Rubric §11, Security]` assesses whether a role's code-granted authority stays visible and non-revocable from the UI; `[Rubric §18, UI Architecture & Component Design]` assesses whether that split is legible to the operator. `_compiled` (line 47) is the set of permissions the role's code already grants (the registry, unconditionally locked); `_stored` (48) is the operator-editable overlay persisted to the `PermissionGrant` table. A permission is ticked when either set contains it (`IsChecked`, line 253) but is read-only, and therefore excluded from a save, when it is compiled OR is `AdministrationPermissions.ManageRoles` itself (`IsReadOnly`, 258-260): the second clause is a deliberate lockout guard, an operator can never uncheck the one permission that lets a role reach this very page.
- **Concept introduced (2), an app-localizer-first fallback with per-call override args.** `[Rubric §27, Internationalization]`. The private `T(key, args)` helper (141-153) checks the caller-supplied `Localizer` parameter first via its indexer (`overridden.ResourceNotFound`), falling back to `L` (an `IStringLocalizer<RoleAdminEditResources>`) only when the app's localizer does not carry the key; the same shape repeats verbatim in [`RoleAdminList`](#roleadminlist) and [`UserAdminList<TUser>`](#useradminlisttuser).
- **Walkthrough**:
  - **State** (39-59): `GeneralAreaKey` const `"Group.General"` (39, the resource key for an ungrouped permission), a component-scoped `CancellationTokenSource` (41), the `LatestLoadGuard` `_load` (42, supersedes an in-flight load), `_compiled`/`_stored` as `HashSet<string>(StringComparer.Ordinal)` (47-48, `IDE0028` suppressed because a collection expression cannot carry the comparer), `_groups` (51, the display-ready [`PermissionGroup`](#permissiongroup) list), `_loadResult`/`_saveResult` (52-53, the last load/save outcome for inline rendering), `_loadedRole` (54, guards a redundant reload), `_isDirty` (58, whether `_stored` has diverged from what was last loaded or saved, the whole unsaved state a navigation guard protects), `_disposed` (59).
  - **Parameters**: `Role` (62-64, `[EditorRequired]`), `ListHref` (67-69, `[EditorRequired]`, the route back to the roster), `Heading` (72, optional override of the default "Permissions for {role}" title), `Localizer` (78).
  - `OnParametersSetAsync` (108): reloads only when `Role` actually changed (`string.Equals(_loadedRole, Role, Ordinal)`), so a parent re-render does not throw away an operator's half-made edits. A `Role` change also supersedes the load still in flight (the doc comment at 103-105), so a late answer for the previous role can never become what Save posts for the current one.
  - `Dispose(bool)` (116-): cancels and disposes `_cts` and also disposes `_load` (127).
  - `LoadAsync` (160-217): opens a generation with `_load.Begin()` (162), capturing `(token, generation)`, and snapshots `Role` into `requestedRole` (163). It loads the role with that token, then the catalog; after each `await` it returns silently unless `_load.IsCurrent(generation)` still holds (174, 187), so a superseded load never touches the form. Either failure sets `_loadResult` and calls `Reset()` (219) and returns early. It clears `_isDirty` (169) up front, since a fresh load has nothing unsaved yet. On success it repopulates `_compiled` from `role.Value.RegisteredPermissions` and `_stored` from `role.Value.StoredPermissions`, then builds `_groups` from `catalog.Value.Permissions` via `Group(...)`. An `OperationCanceledException` is swallowed only when the load is no longer current (206), and `finally` clears `IsLoading` only for the current generation (212), so the newer load owns the spinner.
  - `Group(permissions)` (233): groups by `AreaOf` (243, the text before the first `:` or the localized `GeneralAreaKey`), orders groups and, within each, members, both with `StringComparer.Ordinal`, so the rendered layout is deterministic across loads.
  - `ReadOnlyHint(permission)` (265): the reason text beside a locked checkbox, `Hint.Compiled` when the code grants it, `Hint.ManageRoles` for the self-lockout case, empty otherwise.
  - `Toggle(permission, granted)` (277-289): adds or removes the permission from `_stored` only, a compiled permission is never touched because it is not a member of `_stored` to begin with, and sets `_isDirty = true` (288) unconditionally, since either direction of a toggle is an edit worth protecting.
  - `SaveAsync` (291-323): posts `_stored`, ordered, via `Roles.SetStoredPermissionsAsync(Role, permissions, _cts.LifetimeToken())` (300). On success it does **not** trust what it submitted: it re-seeds `_compiled` and `_stored` from the server's response (the comment at 308-310 records that the two lists the server reports are disjoint, so a permission the host compiles in moves to the locked half even if the operator's own submission still carried it as stored), and it clears `_isDirty` (315) now that the form matches what the server holds.
  - The nested [`PermissionGroup`](#permissiongroup) record (328) closes the file.
- **Why it's built this way**: reseeding from the server's answer rather than the submitted payload is the same "server is the authority, reload rather than assume" principle [`Sessions`](#sessions) applies after a revoke; locking `ManageRoles` unconditionally is a UI-level backstop for a lockout the server-side authorization gate would otherwise only catch after the fact.
- **Where it's used**: wrapped by MMCA.ADC's `RoleEdit.razor.cs` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Roles/RoleEdit.razor.cs`), registered in `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`. Tested by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Administration/RoleAdminEditTests.cs` (5 tests), `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Roles/RoleEditTests.cs`, and the e2e page object `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/PageObjects/Identity/RoleAdminPage.cs`. See [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).

### RoleAdminList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminList.razor.cs:28` · Level 4 · class (partial, `ComponentBase, IDisposable`)

- **What it is**: the ADR-116 role roster: every declared role with a link into [`RoleAdminEdit`](#roleadminedit) for each, loaded whole in one call rather than through a paged grid.
- **Depends on**: `IRoleAdminUIService` (`Roles`, 49), `IStringLocalizer<RoleAdminListResources>` (`L`, 51, see [`RoleAdminListResources`](#roleadminlistresources)). Externals: same `ComponentBase`/`IStringLocalizer` shape as its sibling.
- **Concept reinforced**: the app-localizer-first `T(key, args)` fallback [`RoleAdminEdit`](#roleadminedit) introduces (100-112 here, identical shape). `[Rubric §27, Internationalization]`.
- **Walkthrough**:
  - **State** (30-33): `_cts`, `_roles` as `IReadOnlyList<RolePermissionsResponse>` (33, defaulting empty), `_disposed`.
  - **Parameters**: `Heading` (36, optional), `EditHref` (39-41, `[EditorRequired]` `Func<string, string>` that builds the route to one role's editor), `Localizer` (47).
  - `OnInitializedAsync` (69) calls `LoadRolesAsync` once.
  - `LoadRolesAsync` (114): calls `Roles.GetAllAsync(_cts.LifetimeToken())` (121), stores the whole `Result` in `_loadResult` (59, private field) for inline failure rendering, and sets `_roles` to the result's value on success or empty on failure.
  - Dispose pattern (`Dispose(bool)`, 76): the same idempotent cancel-and-dispose shape as [`RoleAdminEdit`](#roleadminedit) and [`Sessions`](#sessions).
- **Why it's built this way**: unlike [`UserAdminList<TUser>`](#useradminlisttuser), which pages through `MudDataGrid`'s server-data contract, this component loads the entire roster in one `GetAllAsync` call: the declared-role set is small and bounded by the app's own role list, so a paging protocol would add ceremony without solving a real scale problem.
- **Where it's used**: wrapped by MMCA.ADC's `RoleList.razor.cs` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Roles/RoleList.razor.cs`), registered in `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`. Tested by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Administration/RoleAdminListTests.cs` (4 tests), `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Roles/RoleListTests.cs`, and the e2e page object `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/PageObjects/Identity/RoleAdminPage.cs`. See [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).

### UserAdminList<TUser>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminList.razor.cs:47` · Level 5 · class (partial, generic, constrained `where TUser : IUserAdminDTO`)

- **What it is**: a drop-in, generic account roster component covering the ADR-116 user-administration operator actions (lock, unlock, change role, optional delete), built as a component rather than a page so the app supplies the route, the authorization attribute, and the detail link.
- **Depends on**: `IUserAdminActionsUIService` (`Actions`, 131, the three account actions, always used regardless of data source), `IAppDialogService` (`Dialogs`, 133, confirmation dialogs), `AuthenticationStateProvider` (135, to find the signed-in operator's own id), `IServiceProvider` (137, to resolve `IUserAdminUIService<TUser>` on demand), `IStringLocalizer<UserAdminListResources>` (`L`, 139, see [`UserAdminListResources`](#useradminlistresources)), `MudDataGrid<TUser>`/`MobileInfiniteScrollList<TUser>` (143-144), `DeleteConfirmation` (145), `ListPageActions.ReloadActiveLayoutAsync` (215), and `IUserAdminDTO` as the `TUser` bound. Its class declaration (`UserAdminList.razor.cs:47-49`) shows no explicit base in this partial; the overridden members (`Title`, `GridRef`, `OnInitializedAsync`, `SaveFilters`, `RestoreFilters`, all `protected override`) match [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto)'s shape, so the base is declared on the paired `.razor` file, not visible in this `.cs` half.
- **Concept introduced, two swappable data paths behind one component.** `[Rubric §18, UI Architecture & Component Design]` assesses whether a reusable component adapts to an app's own backend without a fork. By default `LoadServerData` (227-243) and `FetchMobilePage` (245) read through `Users`, a property that resolves `IUserAdminUIService<TUser>` from `ServiceProvider` on demand (158-162) and throws a directive `InvalidOperationException` naming the missing registration call if it is absent; when the app supplies `FetchPage` (96-, a delegate taking the grid's filter bag, paging, sort column/direction and a token) that delegate is used instead and the reading service is never resolved. The three account actions (lock/unlock/role-change) always go through `IUserAdminActionsUIService` regardless of which reading path is active, because both the framework's own endpoint and an app's custom listing endpoint sit in front of the same administration API.
- **Concept introduced (2), hiding an operator's destructive power over their own row.** `[Rubric §11, Security]`. `CanAdminister(user)` (204) is false when `_currentUserId` (set from `AuthenticationStateProvider` in `OnInitializedAsync`, 165) equals the row's `UserId`, and every administration affordance (lock, role, delete) checks it: an operator who locked, demoted or deleted themselves would lose the very capability needed to undo it (self-service deletion stays on the profile page), and the API itself has no notion of "the caller", so the guard is UI-only and deliberately placed here.
- **Walkthrough**:
  - `SearchFilterKey` const `"Search"` (55, the filter-bag key the search box is injected under when `FetchPage` owns the fetch).
  - **Parameters**: `Heading` (58), `DetailHref` (61-63, `[EditorRequired]`), `AssignableRoles` (70, ordered least to most privileged, offered as "Set role to X" menu items, empty offers only lock/unlock), `RoleLabel` (78, maps a stored role value to a display label; raw value shown when null), `Columns`/`TrailingColumns`/`CardContent` (81-87, extension render fragments), `FetchPage` (96-, the custom-endpoint override described above), `Sortable` (112, defaults false because the framework's own administration endpoint ignores sort and a sortable header would lie), `ShowSearch` (115, default true), `OnDelete` (122, null means no Delete affordance at all: account erasure has its own authorization rule the framework does not assume exists), `Localizer` (129).
  - **State**: `_currentUserId` (141), `_dataGrid`/`_infiniteList` (143-144, the two render-mode grid handles), `_deleteConfirm` (145), `_searchString` (146).
  - `RoleText(role)` (196): `RoleLabel?.Invoke(role) ?? role`.
  - `SaveFilters`/`RestoreFilters` (208-213): persist and restore `_searchString` under the `"search"` key, the list-page filter-persistence contract [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) defines.
  - `LoadServerData` (227-243): routes to `FetchPage` via `InjectSearchFilter` when supplied, otherwise to `Users.GetPagedAsync` with the search term and the Role column's filter value.
  - `InjectSearchFilter` (264): adds the free-text box to the filter bag under `SearchFilterKey`, but only when non-blank, so the delegate never has to distinguish "empty" from "absent".
  - `SearchTermFrom` (278-281): prefers the free-text box; falls back to the Email column's own filter, so both affordances reach the one search parameter the administration endpoint takes.
  - `FilterValue` (290): reads one column filter's value out of the grid's filter bag, ignoring its operator, since the endpoint takes a value only.
  - `ToggleLockAsync` (296-322): confirms via `IAppDialogService`, then calls `Actions.LockAsync`/`UnlockAsync`, toasts, and reloads the active layout on success.
  - `ChangeRoleAsync` (325-348): confirms, calls `Actions.SetRoleAsync(user.UserId, role)`, toasts, and reloads.
  - `DeleteUserAsync` (352): routes through `ListPageActions.DeleteWithConfirmationAsync`, the shared delete-confirm-toast-reload sequence, calling `OnDelete!(user)` (the null-forgiving operator is safe here because the Delete button only renders when `OnDelete` is non-null).
- **Why it's built this way**: making `Users` a computed property resolved from `ServiceProvider` rather than an `[Inject]` field is what lets an app that supplies `FetchPage` skip registering `IUserAdminUIService<TUser>` at all; a required inject would force every consumer to register a service some of them never call.
- **Where it's used**: wrapped by MMCA.ADC's `UserList.razor.cs` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserList.razor.cs`, 3 references), registered in `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`, and referenced from `RoleAdminEdit.razor.cs` and `RoleAdminList.razor.cs` (shared `AdministrationPermissions` usage). Tested by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Administration/UserAdminListTests.cs` (8 tests) and `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Users/UserListTests.cs`.
- **Caveats / not-in-source**: the base class (`DataGridListPageBase<TDto>`, inferred from the `protected override` members) is declared in the paired `.razor` file, which this brief's source excerpt does not include; the inference is from member shape, not a visible `@inherits` or base-list clause.

### ConfirmationState

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ConfirmEmail.razor.cs:50` · Level 0 · enum (private, nested)

- **What it is**: the three states [`ConfirmEmail`](#confirmemail) cycles through while redeeming an email-confirmation link: `Working`, `Form`, `Confirmed` (`:50-60`).
- **Depends on**: nothing; a private nested enum with no other type references.
- **Concept**: a private nested enum used purely as component render-state, the same shape used throughout the UI layer to drive conditional markup without a separate view-model class.
- **Walkthrough**: `Working` is the initial field value (`:40`) and stays current through the automatic redeem attempt in `OnAfterRenderAsync` (`:108-128`); `Form` covers manual entry together with any resend notice or error message above it, and is the state chosen both up front, when neither an email nor a token is available to redeem (`:122`), and after a failed redeem (`:181`, `:201`); `Confirmed` marks a successful redeem (`:193`).
- **Why it's built this way**: a private enum keeps the state vocabulary scoped to the one component that interprets it, rather than promoting it to a shared UI-layer type nothing else needs. The vocabulary is three values, not four: a missing token, a failed redeem, and a completed resend all land the visitor back on the same manual-entry form, with only the `_errorMessage` / `_linkSent` fields (not the enum) distinguishing which of those happened.
- **Where it's used**: only inside [`ConfirmEmail`](#confirmemail), which stores it in `_state` and switches its markup on the value.

### Login

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor.cs:8` · Level 0 · class (partial, page code-behind)

- **What it is**: the code-behind half of the shared Login page. The markup half (`Login.razor`) owns the form; this file owns the two behaviors around external sign-in: turning a refused OAuth round trip into words, and writing the per-attempt OAuth state before a provider redirect.
- **Depends on**: [`OAuthFlowStateStore`](#oauthflowstatestore) (the `OAuthFlowState` injection, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:14`), `IStringLocalizer<SharedResource>` as `L` (see [`SharedResource`](#sharedresource)); externals: `[SupplyParameterFromQuery]` (`Microsoft.AspNetCore.Components`), BCL `InvalidOperationException`.
- **Concept introduced, a refusal code is a machine value that is mapped to words and never displayed.** `[Rubric §27, Internationalization]` assesses whether user-facing text translates; `[Rubric §26, Front-End Security]` assesses whether the front end leaks internals. The OAuth completion endpoint sends every refusal back to `/login?error={code}`, and `Error` (`Login.razor.cs:20-21`, bound by `[SupplyParameterFromQuery(Name = "error")]`) receives it. `ExternalSignInErrorMessage` (`:32-38`) maps `null` or empty to no message, `oauth_failed` and `missing_claims` to their own resources, and any other code to `RefusalMessage` (`:40-44`). That helper looks up `Auth.Login.ExternalError.{code}` and, when the resource is missing (`ResourceNotFound`), falls back to the generic `Auth.Login.ExternalError.Refused` text. The doc comment (`:24-29`) explains the split: a code with a recovery path of its own (a locked account, an email already linked to another sign-in, an unverified provider email) gets its own resource, and every other domain code (for example an invalid name) shows the generic refusal. The raw code is never rendered.
- **Walkthrough**:
  - `_externalSignInUnavailable` (`:14`): set when device storage dropped the OAuth attempt; the web-redirect provider buttons are then disabled, because a flow started there would be refused at completion (comment, `:11-13`).
  - `BeginOAuthAttemptAsync()` (`:52-70`): awaits `OAuthFlowState.BeginAsync()` (`:56`) and keeps the returned state in `_oauthState`. If the store throws `InvalidOperationException` (`:58`), because storage accepted the write without keeping it (storage full, site data blocked, private mode), it sets `_externalSignInUnavailable`, shows `Auth.Login.ExternalSignInStorageUnavailable`, calls `StateHasChanged`, and returns (`:60-64`). Otherwise, when a state was written, it re-renders (`:66-69`).
- **Why it's built this way**: the completion page refuses a flow whose state it cannot find one redirect later, with no explanation; failing at the click, with the buttons disabled and a reason on screen, turns a silent dead end into an actionable message (doc comment, `:46-51`). The fallback-to-generic rule means a new domain error code never surfaces as a raw key.
- **Where it's used**: the `Login.razor` markup calls `BeginOAuthAttemptAsync` after first render when external providers exist (`Login.razor:193`, `:180` for `_oauthState`), and appends the state to the provider redirect query (`Login.razor:211-213`). Error mapping is covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/LoginErrorQueryTests.cs`, and the form models by [`LoginModel`](#loginmodel). The OAuth design is [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) and the native callback is [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html).
- **Caveats / not-in-source**: the markup half was read only for the cited lines; the form submit path and provider buttons live there, not here.

### PasswordComplexityAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:15` · Level 1 · class (sealed attribute)

- **What it is**: a custom `ValidationAttribute` that enforces the framework's password-strength rule on any form that sets a new password: at least 8 characters including an uppercase, a lowercase, a digit, and a special (non-alphanumeric) character.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`, BCL) and the first-party [`PasswordComplexity`](group-08-auth.md#passwordcomplexity) rule in `MMCA.Common.Shared.Auth` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PasswordComplexity.cs:18`).
- **Concept introduced, extending DataAnnotations with a domain rule defined once for both sides.** `[Rubric §24, Forms, Validation & UX Safety]` assesses client-side validation parity with the server. Beyond the built-in `[Required]` and `[EmailAddress]`, a bespoke rule subclasses `ValidationAttribute` and overrides `IsValid`, which plugs it straight into the same validator that drives the rest of the form. Parity is structural rather than copied: the attribute does not encode the character rules itself, it calls `PasswordComplexity.Evaluate` (`PasswordComplexity.cs:52`), the single Unicode-aware definition the server's `StrongPasswordRules` also uses (doc comment, lines 6-13; `PasswordComplexity.cs:5-17`). That definition counts any `\p{Lu}` as uppercase, any `\p{Ll}` as lowercase, any `\p{Nd}` as a digit, and anything that is neither a letter nor a decimal digit as special (`PasswordComplexity.cs:27-43`), so an accented or CJK letter is a letter, never the special character. What happens to an accepted password server-side (PBKDF2-HMAC-SHA512 hashing with legacy-hash compatibility) is [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html); this attribute is only the client-side gate, never the security boundary.
- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]` (line 14), so it is applied as `[PasswordComplexity]` on a single property.
  - The constructor (lines 17-20) seeds the base `ErrorMessage` with the full English rule, so a usage that does not override the message still shows something actionable. The framework's own forms override it with an `ErrorMessageResourceType` / `ErrorMessageResourceName` pair that points at [`AuthFieldMessages`](#authfieldmessages)`.PasswordComplexity` (see [`RegisterModel`](#registermodel)).
  - `IsValid(object?, ValidationContext)` (lines 22-36): one guard (line 24) returns `ValidationResult.Success` for a non-string, a null/empty input, or a password for which `PasswordComplexity.Evaluate` is true. Deferring the empty case to `RequiredAttribute` keeps the field to one message rather than two. On failure it returns a `ValidationResult` scoped to the member name (lines 34-35) so the message attaches to the right input; the member lookup is null-conditional (`validationContext?.MemberName`, line 34) because the base class routes the context-free `IsValid(object)` overload here with no context (comment, lines 29-30), and there is then no member to attach the error to.
  - The message is built with `FormatErrorMessage(validationContext?.DisplayName ?? string.Empty)` (line 35), not the raw `ErrorMessage` property (comment, lines 31-33): `FormatErrorMessage` also resolves an `ErrorMessageResourceType` / `ErrorMessageResourceName` pair, which is how the auth models localize inside the attribute, and it returns a plain `ErrorMessage` or the default message unchanged.
- **Why it's built this way**: because the rule is an attribute rather than page code, a second form that sets a password gets identical behavior by adding one line, which is exactly how the reset vertical picked it up. Delegating the predicate to a type in the Shared project, the one project both client and server may reference, is what makes the two verdicts identical by construction rather than by review. Delegating emptiness to `[Required]` keeps one field from stacking two errors. The length cap is deliberately not part of this attribute: `PasswordComplexity.MaximumLength` is a separate rule with its own message on both sides (`PasswordComplexity.cs:24`, `:45-49`).
- **Where it's used**: applied to `RegisterModel.Password` ([`RegisterModel`](#registermodel), `RegisterModel.cs:28`) and to `ResetPasswordModel.NewPassword` ([`ResetPasswordModel`](#resetpasswordmodel), `ResetPasswordModel.cs:26`); evaluated by the [`LocalizedDataAnnotationsValidator`](#localizeddataannotationsvalidator) in `Register.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:33`) and `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:43`). Unit-tested in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/PasswordComplexityAttributeTests.cs:12`; its agreement with the server rule is pinned by the architecture test `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/PasswordRuleParityTests.cs:21`.
- **Caveats / not-in-source**: the doc comment (line 7) still describes the attribute as the rule "for the Register form" although the reset form carries it too; the code is the wider truth.

### ForgotPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPasswordModel.cs:15` · Level 2 · class (sealed)

- **What it is**: the `EditForm` backing model for the Forgot Password page: one `Email` string carrying DataAnnotations for shape validation. Nothing else is collected, because nothing else is needed to start a reset.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`, and the first-party [`AuthFieldMessages`](#authfieldmessages) resource type that supplies both messages.
- **Concept introduced, validation deliberately capped at "shape" because of an anti-enumeration contract.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form gives a clear per-field verdict before submit; `[Rubric §26, Front-End Security]` assesses whether the front end avoids leaking information the back end withholds. Every other form in this group validates as much as it can client-side. This one stops at "is this a syntactically valid address", because the interesting question, does an account exist for it, is one the server refuses to answer: [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3 has the reset request succeed on every path (malformed address, no account, throttled, failed send), so a distinguishable client-side outcome would reintroduce exactly the account-enumeration oracle the endpoint exists to avoid. The doc comment (`ForgotPasswordModel.cs:7-8`) states that trade-off directly.
- **Walkthrough**: one `get; set;` property. `Email` (line 19) carries `[Required]` and `[EmailAddress]` (lines 17-18), each naming `ErrorMessageResourceType = typeof(AuthFieldMessages)` with `ErrorMessageResourceName = nameof(AuthFieldMessages.EmailRequired)` / `nameof(AuthFieldMessages.EmailInvalid)`, and defaults to `string.Empty`. The message is read from the shared resources inside the attribute ([`AuthFieldMessages`](#authfieldmessages), `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/AuthFieldMessages.cs:19`, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), so the form's validator and MudBlazor's own field-level pass (which runs the `For` property's attributes when a field is touched) both show localized text, never a raw key (`AuthFieldMessages.cs:11-17`; model doc comment, `ForgotPasswordModel.cs:10-12`).
- **Why it's built this way**: `sealed` and mutable (`set`, not `init`) because `EditForm` two-way-binds the input to the model; keeping the model to one field is what makes the page's anti-enumeration behavior easy to reason about, since there is no second field whose validation could betray a lookup.
- **Where it's used**: instantiated as `_model` by `ForgotPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPassword.razor:71`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleRequestAsync">` plus `<LocalizedDataAnnotationsValidator />` (lines 38-39), with the field wired `For="@(() => _model.Email)"` (line 41) so the message attaches to that input. On valid submit `HandleRequestAsync` (lines 80-97) calls [`IAuthUIService`](#iauthuiservice)`.RequestPasswordResetAsync(_model.Email)` (line 86, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:60`) inside a `try` whose `catch` is empty on purpose (lines 88-91) and whose `finally` sets `_isSubmitted = true` unconditionally (line 95), so the confirmation renders for every submitted address whether the call succeeded, failed, or threw.
- **Caveats / not-in-source**: `RequestPasswordResetAsync` returns a `Result` and the call site never inspects it (line 86); the comment block above the method (lines 75-79) records that this is the anti-enumeration rule rather than a dropped result. The gallery E2E suite pins the behavior by asserting the confirmation appears with no backend at all (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Auth/ForgotPasswordPageE2ETests.cs:28`), with WCAG 2.1 AA scans on both the form and the confirmation state (`:41`, `:50`).

### LoginModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/LoginModel.cs:15` · Level 2 · class (sealed)

- **What it is**: the `EditForm` backing model for the Login page: two string properties (`Email`, `Password`) carrying DataAnnotations for field-level validation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. The only first-party reference is [`AuthFieldMessages`](#authfieldmessages), the resource type its attributes read their messages from.
- **Concept introduced, the form-backing model plus a localizing DataAnnotations validator.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether forms validate at the field level with clear inline messages before submit; `[Rubric §26, Front-End Security]` assesses that client-side checks are a UX convenience, not the trust boundary; `[Rubric §27, Internationalization]` assesses whether validation messages translate. A Blazor `EditForm` binds to a plain model, a `<LocalizedDataAnnotationsValidator />` reads the attributes and surfaces a per-field message as the user types, and the submit handler only fires on a valid form. Each message is read from the shared resources through [`AuthFieldMessages`](#authfieldmessages) inside the attribute (doc comment, `LoginModel.cs:10-12`, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), so the model carries no English text and the localized text shows whether the form's validator or MudBlazor's own field-level pass runs the attribute. The doc comment (`LoginModel.cs:7-8`) is also explicit that the server remains the authority on whether the credentials are actually valid: the form only prevents an obviously malformed request.
- **Walkthrough**: two `get; set;` properties.
  - `Email` (line 19), `[Required]` plus `[EmailAddress]` (lines 17-18), each with `ErrorMessageResourceType = typeof(AuthFieldMessages)` and the name `EmailRequired` / `EmailInvalid`, defaulting to `string.Empty`.
  - `Password` (line 22), `[Required]` with the name `PasswordRequired` (line 21). There is deliberately no complexity rule here: login validates an *existing* credential, not a new one, and rejecting a legacy password client-side would lock a user out of their own account.
- **Why it's built this way**: `sealed` and mutable because `EditForm` two-way-binds each input; each attribute names one `AuthFieldMessages` entry so each field shows exactly one verdict, in the reader's language.
- **Where it's used**: instantiated as `_model` and bound by `Login.razor` (`<EditForm Model="_model" OnValidSubmit="HandleLoginAsync">` plus `<LocalizedDataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:39-40`, field at line 172 (not re-verified), inputs bound `For="@(() => _model.Email)"` and `For="@(() => _model.Password)"` at lines 48 and 54 so each `MudTextField` shows its own message). On valid submit the page hands the credentials to [`IAuthUIService`](#iauthuiservice) as a [`LoginRequest`](group-08-auth.md#loginrequest) (`Login.razor:241`). Sibling of [`RegisterModel`](#registermodel); its shape rules are unit-tested alongside the other auth models in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs:11`.

### RegisterModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/RegisterModel.cs:16` · Level 2 · class (sealed)

- **What it is**: the `EditForm` backing model for the Register page: name, email, and password fields with DataAnnotations, plus six optional address fields.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[StringLength]`, `[EmailAddress]`, `[Compare]`), the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute), [`AuthFieldMessages`](#authfieldmessages) for every message, and [`PasswordComplexity`](group-08-auth.md#passwordcomplexity) for the shared length cap.
- **Concept reinforced, multi-field form validation with a cross-field compare.** `[Rubric §24, Forms, Validation & UX Safety]`. This builds on the [`LoginModel`](#loginmodel) shape with three richer rules: `[PasswordComplexity]` on the password (paired with a `[StringLength(PasswordComplexity.MaximumLength)]` cap, 128 at `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PasswordComplexity.cs:24`, the constant the server rule shares), `[Compare(nameof(Password))]` on the confirmation (a cross-field equality check the validator resolves by property name), and an address block left attribute-free because it is optional. The doc comment (lines 8-13) notes the annotations mirror the server's rules so client and server agree, and that every message is read from the shared resources through [`AuthFieldMessages`](#authfieldmessages) inside the attribute ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), so both the form's validator and MudBlazor's field-level pass show localized text.
- **Walkthrough**: every attribute below names `ErrorMessageResourceType = typeof(AuthFieldMessages)` plus an `ErrorMessageResourceName = nameof(AuthFieldMessages.X)` entry.
  - `FirstName` / `LastName` (lines 19, 22), each `[Required]` with its own entry, `FirstNameRequired` / `LastNameRequired` (lines 18, 21).
  - `Email` (line 26), `[Required]` plus `[EmailAddress]` (lines 24-25), entries `EmailRequired` / `EmailInvalid`.
  - `Password` (line 31), `[Required]` (`PasswordRequired`) plus `[StringLength(PasswordComplexity.MaximumLength)]` (`PasswordMaxLength`) plus `[PasswordComplexity]` (`PasswordComplexity`) (lines 28-30).
  - `ConfirmPassword` (line 35), `[Required]` (`ConfirmPasswordRequired`) plus `[Compare(nameof(Password))]` (`ConfirmPasswordMismatch`) (lines 33-34).
  - `AddressLine1` plus nullable `AddressLine2`/`City`/`State`/`ZipCode`/`Country` (lines 38-43), with no validation attributes; the inline comment (line 37) states that an empty Line 1 means "no address supplied".
  - `AcceptedTerms` (line 48), the "I agree to the Terms" box. It carries no validation attribute: it is required only when the host configures a Terms URL (`LegalSettings.TermsUrl`), and the page enforces that by keeping the submit button disabled until it is ticked (comment, lines 45-47).
- **Why it's built this way**: the address fields stay attribute-free so a user can register without supplying one; the model is a flat view-model that the page projects onto the wire DTO at submit time rather than reusing a domain type directly, which is what lets the optional-address rule live in page code instead of leaking into the contract.
- **Where it's used**: instantiated as `_model` and bound by `Register.razor` (`<EditForm Model="_model" OnValidSubmit="HandleRegisterAsync">` plus `<LocalizedDataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:32-33`, field at line 148). On valid submit the page projects it into a [`RegisterRequest`](group-08-auth.md#registerrequest) (`Register.razor:189`), folding the address fields into an [`Address`](group-02-domain-building-blocks.md#address) through `BuildAddressResult()` (defined in the [`Register`](#register) code-behind, `Register.razor.cs:22`), which returns `null` when all six are blank (lines 29-37) and otherwise calls `Address.Create(...)` (line 39). Its password block is mirrored by [`ResetPasswordModel`](#resetpasswordmodel); the accepted password is hashed server-side per [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html). Shape rules are unit-tested in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs:11`; rendering and validation behavior are covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs:22` and the gallery E2E suite (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Auth/RegisterPageE2ETests.cs:9`).

### ResetPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPasswordModel.cs:17` · Level 2 · class (sealed)

- **What it is**: the `EditForm` backing model for the Reset Password page: the address and the emailed reset token that identify the request, plus the new password and its confirmation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[StringLength]`, `[EmailAddress]`, `[Compare]`), the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute), [`AuthFieldMessages`](#authfieldmessages) for every message, and [`PasswordComplexity`](group-08-auth.md#passwordcomplexity) for the shared length cap.
- **Concept reinforced, the same password block as registration, on a credential-carrying form.** `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §26, Front-End Security]`. The password half is exactly the shape [`RegisterModel`](#registermodel) introduced, which is the payoff of expressing the complexity rule as an attribute rather than page code. What is new is the top half: `Email` and `Token` are not values the user chooses, they are the credential the server minted and mailed. The client validates only that both are present and that the address is well formed; every substantive rejection (unknown, expired, mismatched, or attempt-capped token) collapses into one server-side error by design ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3), so the form must not try to pre-judge a token it cannot verify. As on the sibling models, each message is read from the shared resources through [`AuthFieldMessages`](#authfieldmessages) inside the attribute (doc comment, lines 12-14, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**: four `get; set;` properties, each defaulting to `string.Empty`; every attribute names `ErrorMessageResourceType = typeof(AuthFieldMessages)` plus an `ErrorMessageResourceName` entry.
  - `Email` (line 21), `[Required]` plus `[EmailAddress]` (lines 19-20), entries `EmailRequired` / `EmailInvalid`.
  - `Token` (line 24), `[Required]` with entry `TokenRequired` (line 23) and nothing more: length, encoding, and freshness are all properties of the server-side cache record.
  - `NewPassword` (line 29), `[Required]` (`PasswordRequired`) plus `[StringLength(PasswordComplexity.MaximumLength)]` (`PasswordMaxLength`) plus `[PasswordComplexity]` (`PasswordComplexity`) (lines 26-28).
  - `ConfirmPassword` (line 33), `[Required]` (`ConfirmPasswordRequired`) plus `[Compare(nameof(NewPassword))]` (`ConfirmPasswordMismatch`) (lines 31-32), the cross-field check retargeted at `NewPassword`.
- **Why it's built this way**: the doc comment (lines 7-10) records the load-bearing choice, that `Email` and `Token` arrive prefilled from the reset link but stay **editable**, so a user who only has the raw token text from the email (the situation on a native head with no working deep link) can paste it by hand. Making those two ordinary bound fields rather than read-only parameters buys that fallback for free.
- **Where it's used**: instantiated as `_model` by `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:105`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleResetAsync">` plus `<LocalizedDataAnnotationsValidator />` (lines 42-43). The model is prefilled from two sources, both of which fill a field **only when it is still blank** so a value the user corrected by hand is not overwritten. First, the page declares `[SupplyParameterFromQuery]` `Email` and `Token` properties (lines 99-103) and copies them in `OnParametersSet` (lines 112-123, blank checks at 114 and 119). Second, `OnAfterRenderAsync` (lines 130-177) reads the URL fragment once on first render through the `locationHashTake` JS call (line 143), which also scrubs it from the address bar, and fills `email` / `token` from it (lines 161-170); the comment at lines 125-129 explains why: a fragment is never sent to a server, so the live token stays out of ingress logs and request telemetry, while the query-string path keeps older links working. `HandleResetAsync` (lines 179-204) calls [`IAuthUIService`](#iauthuiservice)`.ResetPasswordAsync(_model.Email, _model.Token, _model.NewPassword)` (line 186, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:67`), flips `_isCompleted` on success, and on failure renders `result.LocalizedErrorMessage(L)` or the generic `Auth.Reset.GenericError` string (line 193), which a thrown call also falls back to (lines 196-199). The prefill path is pinned by a gallery E2E test (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Auth/ResetPasswordPageE2ETests.cs:31`), with a WCAG 2.1 AA scan alongside it (`:43`).
- **Caveats / not-in-source**: the model has no rule tying `Token` to the address; that pairing is enforced by the server's cache record ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 1), not by anything visible here.

### ConfirmEmail

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ConfirmEmail.razor.cs:36` · Level 4 · class (sealed, partial, page code-behind)

- **What it is**: the shared, framework-provided landing page for the emailed confirmation link. It reads the address and token from the query string or a URL fragment, attempts to redeem them automatically on first render, and falls back to manual entry plus a resend option when redemption fails.
- **Depends on**: [`IEmailConfirmationUIService`](#iemailconfirmationuiservice) (injected as `ConfirmationService`, `:70`), `CapabilitiesJsModule` (the optional JS interop module used to read the URL fragment, resolved through `IServiceProvider` at `:135`), [`SharedResource`](#sharedresource) (as `IStringLocalizer<SharedResource>`, `:74`), `ComponentLifetimeExtensions.LifetimeToken` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ComponentLifetimeExtensions.cs:26`), the private nested [`ConfirmationState`](#confirmationstate) (`:50-60`); externals: `[SupplyParameterFromQuery]`, `[Inject]`, `ComponentBase` (`Microsoft.AspNetCore.Components`), BCL `System.Uri`, `System.StringComparison`, `System.Threading.CancellationToken`.
- **Concept**: the component accepts the email and token two ways: as ordinary query parameters (`EmailFromQuery`, `TokenFromQuery`, `:62-68`), or as a URL fragment read client-side through `CapabilitiesJsModule` (`TakeFragmentAsync`, `:130-140`). A URL fragment is never sent to the server in the request line, so a host that wants the token to never touch server logs can mint links that carry it there instead; the query-parameter path stays as a fallback. `ApplyFragment` (`:144-171`) only fills a field that is still empty (`:162`, `:166`), so a query value already present is never overwritten by the fragment.
- **Walkthrough**: nine private fields track render state (`_cts`, `_state`, `_email`, `_token`, `_errorMessage`, `_linkSent`, `_isBusy`, `_attempted`, `_disposed`, `:38-47`), and two properties are query-bindable via `[SupplyParameterFromQuery]` (`EmailFromQuery`, `:63-64`; `TokenFromQuery`, `:67-68`).
  - `Dispose()` (`:77-87`): idempotent, cancels then disposes `_cts`.
  - `OnParametersSet()` (`:94-105`) only fills `_email`/`_token` from the query parameters when the field is still empty, so a value the visitor corrected by hand survives a re-render.
  - `OnAfterRenderAsync(firstRender)` (`:108-128`) runs the redeem attempt exactly once (`_attempted`, `:110-115`): it reads the fragment (`:116`), and if the email or the token is still missing after that, sets `_state = ConfirmationState.Form` and returns without ever calling the confirmation service (`:118-125`), so a bare visit to the page (no link data at all) goes straight to manual entry instead of posting a request that can only fail.
  - `TakeFragmentAsync()` (`:130-140`) resolves `CapabilitiesJsModule` from `Services` and returns `null` when it is absent (`:137-139`); the comment above it notes this happens during SSR prerender and in a host without the capabilities module, and its absence is treated as normal, not an error.
  - `ConfirmAsync()` (`:173-215`) posts through `ConfirmationService.ConfirmEmailAsync(_email.Trim(), _token.Trim(), _cts.LifetimeToken())` (`:190`) and sets `_state` to `Confirmed` (`:193`) on success, or `Form` with `_errorMessage` set to the API's own wording via `result.LocalizedErrorMessage(L)` on failure (`:200-201`), wrapped in `_isBusy`/`StateHasChanged` bracketing so the UI can show a spinner. The token comes from `LifetimeToken()` rather than the raw `_cts.Token`, the repo convention for component cancellation sources. `OperationCanceledException` is swallowed as expected during disposal or an `InteractiveAuto` render-mode transition (`:203-206`).
  - `ResendAsync()` (`:217-251`) calls `ConfirmationService.ResendEmailConfirmationAsync(_email.Trim(), _cts.LifetimeToken())` (`:232`) and sets `_linkSent = true` on success, never changing `_state`; the endpoint answers 202 whether or not the address holds an account, so the page reports the same thing either way, the same anti-enumeration rule the [`ForgotPasswordModel`](#forgotpasswordmodel) flow uses.
- **Why it's built this way**: separating the automatic redeem attempt from the manual/resend UI means a stale, already-used, or malformed link degrades to a working form instead of a dead end, and the fragment-vs-query split lets a deployment choose whether the token transits the server's own request logs. Collapsing resend and redeem-failure onto the same `Form` state (rather than distinct states) keeps `_state` purely about which panel renders, while `_errorMessage` and `_linkSent` carry the finer detail.
- **Where it's used**: reached wherever a host maps the framework's shared Auth pages. Exercised by the shared conformance test base `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Pages/ConfirmEmailPageTestsBase.cs`, and backed downstream by ADC's confirm-email domain and application workflow that `IEmailConfirmationUIService` ultimately calls through the API (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ConfirmEmail/ConfirmEmailHandler.cs`, `ConfirmEmailCommand.cs`, `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IEmailConfirmableUser.cs`).
- **Caveats / not-in-source**: the paired `.razor` markup (not read here) is what actually renders the states; this code-behind only manages the state transitions. Which query names ("email", "token") a real confirmation email uses is set by whatever composes the link server-side, not by this component.

### Register

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor.cs:10` · Level 4 · class (partial, page code-behind)

- **What it is**: the code-behind half of the shared Register page. It holds one decision the markup needs: whether the user supplied an address, and if so whether it is a valid one.
- **Depends on**: [`RegisterModel`](#registermodel) (the `_model` field the markup declares), [`RegistrationSettings`](#registrationsettings) (read through `RegistrationOptions.Value.CollectAddress`, `Register.razor.cs:13`), and the first-party [`Address`](group-02-domain-building-blocks.md#address) value object plus [`Result`](group-01-result-error-handling.md#result) (`Register.razor.cs:22`, `:39`).
- **Concept introduced, an optional block that is validated if touched.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form drops or silently accepts bad input. `BuildAddressResult()` (`:22-40`) returns `Result<Address>?` with three outcomes. With address collection off (`CollectAddress`, `:13`) it returns `null`, because there is no block to type into (`:24-27`). With collection on and all six fields blank (`:29-37`) it also returns `null`: no address is legitimate. Otherwise it calls `Address.Create(...)` (`:39`) and returns that `Result`, so anything the user did type is validated and an invalid address blocks the registration. The doc comment (`:15-21`) records the reason: the account used to be created with no address at all when the typed address was invalid.
- **Walkthrough**: one computed property (`CollectAddress`, `:13`) and one method (`BuildAddressResult`, `:22`). The markup calls it on valid submit and projects the success value into a [`RegisterRequest`](group-08-auth.md#registerrequest), as described under [`RegisterModel`](#registermodel).
- **Why it's built this way**: returning a nullable `Result` rather than a bare `Address?` is what lets "nothing entered" (null) stay distinct from "entered and invalid" (a failed `Result`), which a plain null could not express.
- **Where it's used**: bound by `Register.razor`; behavior is covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs`, `RegisterAddressOptionTests.cs` and `RegisterTermsTests.cs` in the same folder.
- **Caveats / not-in-source**: the Terms checkbox enforcement lives in the markup half, not in this file; only the address rule is here.

### Sessions

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:27` · Level 6 · class (partial, page code-behind)

- **What it is**: the code-behind for the signed-in devices page at `/profile/sessions`: one row per live refresh session, with a per-device sign-out and a sign-out-everywhere, each behind a confirmation dialog.
- **Depends on**: [`IAuthUIService`](#iauthuiservice) (line 29), [`IToastService`](#itoastservice) (line 31), [`IAppDialogService`](#iappdialogservice) (line 32), [`SharedResource`](#sharedresource) as `IStringLocalizer<SharedResource>` (line 33), [`ViewerTimeZone`](#viewertimezone) (line 34), [`RefreshSessionSummaryResponse`](group-08-auth.md#refreshsessionsummaryresponse) (the row DTO, line 41), [`Result`](group-01-result-error-handling.md#result) (line 44), [`ResultUiExtensions`](#resultuiextensions) (`IsNotFound`, `NotifyOnFailure`), [`UserAgentSummary`](#useragentsummary) (line 239), `ComponentLifetimeExtensions.LifetimeToken` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ComponentLifetimeExtensions.cs:26`), and [`RoutePaths`](#routepaths) (line 68). Externals: Blazor's `NavigationManager` and MudBlazor's `BreadcrumbItem` / `MudTable`.
- **Concept introduced, two revoke paths with deliberately different endings.** `[Rubric §11, Security]` assesses whether a user can see and end their own live credentials; `[Rubric §25, Navigation & IA]` assesses whether a destructive action leaves the app in a coherent place. The class comment (lines 16-24) states the model: a row's button calls the per-session revoke, which ends one *other* device's session and leaves this one alone, while the page-level button is the account-wide revoke, which also ends the session the caller is using and therefore must be followed by the local sign-out and a redirect, but only once the server confirmed the revoke (line 21). The consequence is visible in the markup: the row for the current device offers no button at all (`Sessions.razor:68-75`), because revoking it from a row would leave the app signed in on a dead session until the access token expired, which reads to a user as a broken sign-out.
- **Concept introduced (2), a single in-flight gate over two different operations.** `[Rubric §18, UI Architecture & Component Design]`. `IsBusy` (line 58) is `_revokingSessionId is not null || IsRevokingAll`, and every button in the markup reads it (`Sessions.razor:80`, `:97`). One flag over both operations is what stops a second click from starting a concurrent revoke while the list is about to be rebuilt underneath it, and `_revokingSessionId` doubles as the per-row spinner selector (`Sessions.razor:84`). Both revoke handlers check `IsBusy` twice, before and after the awaited confirmation dialog (lines 124 and 135, 189 and 200), because another operation can start while the dialog is open.
- **Walkthrough**:
  - **State** (lines 36-61): a component-scoped `CancellationTokenSource` (line 38) passed into every service call (as `_cts.LifetimeToken()`, the repo convention) and cancelled on dispose, `_breadcrumbs`, `_sessions`, the nullable `_loadResult` that carries the last load outcome for inline rendering (line 44), `_revokingSessionId`, `IsLoading` (line 52), `IsBusy` (line 58), and `IsRevokingAll` (line 61). `LoginRoute` is a `const` (line 36).
  - `OnInitializedAsync` (lines 63-73): builds the breadcrumbs **here rather than in a field initializer** so the injected localizer is available (comment at line 65, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), then loads.
  - `OnAfterRenderAsync(firstRender)` (lines 76-83): on first render, while not disposed, awaits `ViewerTime.EnsureResolvedAsync(_cts.LifetimeToken())` and calls `StateHasChanged` when it resolved a zone (line 81). Session times render on the viewer's clock, and the browser's zone is only readable once JS is available, so the page re-renders once the zone is known. See [`ViewerTimeZone`](#viewertimezone).
  - `LoadSessionsAsync` (lines 85-114): stores the whole `Result` in `_loadResult` (line 93) so the markup can render the failure inline with a retry button rather than as a toast (`Sessions.razor:17`, `:23-30`; the comment at `Sessions.razor:15-16` explains why: an empty table and a failed load look identical once a toast expires). On failure it **empties** `_sessions` deliberately (lines 99-104), so a stale device list can never be left on screen for a user to act on. `OperationCanceledException` is swallowed as expected-on-disposal (lines 106-109) and `IsLoading` clears in the `finally`.
  - `RevokeSessionAsync(session)` (lines 122-178): refuses to run while busy or for the current device (lines 124-127, a second guard behind the markup's), then asks for confirmation through [`IAppDialogService`](#iappdialogservice)`.ConfirmAsync` with a message naming the device via `DescribeDevice` (lines 129-133), because the device loses its session at once (doc comment, lines 116-121). After the post-dialog re-check (lines 135-138) it marks the row in flight (line 140) and calls `StateHasChanged` (line 145): the dialog completed asynchronously, so Blazor has already rendered once for the click and will not render again until the handler returns, which would otherwise leave the button showing no progress for the length of the revoke call (comment, lines 142-144). It then treats three outcomes distinctly. Success toasts (line 153). A not-found result, which means the session is already revoked (the server answers `Auth.SessionAlreadyRevoked` after a duplicate click or once the device signed itself out) or no longer exists, toasts at *info* severity instead (lines 155-161), because the user's intent is satisfied and there is nothing to correct. Any other failure goes through `result.NotifyOnFailure(Toast, L)` and returns without reloading (lines 162-166). On either satisfied outcome it reloads the list from the server rather than removing the row locally (line 168), because the server is the authority on what is still live and a reload also catches a session that expired while the page sat open.
  - `RevokeAllAsync` (lines 187-230): guards on `IsBusy` (line 189), confirms through `ConfirmAsync` (lines 194-198) because this also ends the session the user is on, re-checks (line 200), renders the busy state before the long call (`StateHasChanged`, line 208, same reasoning as the per-device revoke), then calls [`IAuthUIService`](#iauthuiservice)`.RevokeAllSessionsAsync(_cts.LifetimeToken())` (line 212, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:94`), which is the account-wide revoke followed, on success, by the local sign-out. Only on success does it navigate to `/login` with `forceLoad: true` (line 215), so the circuit and any cached client state are rebuilt rather than kept alive against a revoked identity. A failed revoke is shown through `result.NotifyOnFailure(Toast, L)` (line 219) and the page stays put: the doc comment (lines 180-186) explains that a best-effort logout would claim every device was signed out even when the server refused. `OperationCanceledException` is swallowed as expected-on-disposal (lines 222-225) and `IsRevokingAll` clears in the `finally` (lines 226-229).
  - `DescribeDevice(session)` (lines 237-248): parses browser and platform out of the user agent via [`UserAgentSummary.Parse`](#useragentsummary) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/UserAgentSummary.cs:66`) and composes them through a **resource format string** in the both-known case (line 243), so the word order translates rather than being concatenated in English order; a single known part is returned as is, and neither known falls back to an explicit "unknown device" string (line 246). `[Rubric §27, Internationalization]`. The same label feeds the per-row confirmation message and `aria-label`.
  - `FormatInstant(DateTime)` (line 255, doc comment lines 250-254): delegates to `ViewerTime.Format(instant)`. It formats in the viewer's browser time zone and current culture, because the endpoint reports UTC and "signed in at 03:14" only means something on the clock the reader uses; `DateTime.ToLocalTime` would be the server's zone on Blazor Server and in prerender, which is why the method is no longer a static local-time conversion.
  - `Dispose(bool)` / `Dispose()` (lines 257-277): the standard idempotent pattern, cancelling and disposing the CTS.
- **Why it's built this way**: rendering the load failure inline instead of as a toast is a deliberate `[Rubric §24, Forms, Validation & UX Safety]` choice for a page whose empty state is indistinguishable from its failure state, and it is the same reasoning [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) encodes in its `LoadFailed` flag. Treating "already revoked" as an informational outcome rather than an error avoids punishing a user for a double click on an idempotent action. Confirming both revokes before acting is the same section's destructive-action rule: each one signs a device out immediately.
- **Where it's used**: routed at `/profile/sessions` behind `[Authorize]` with `[StreamRendering(false)]` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor:1-6`), reachable in any host that maps the framework's UI pages. Its component behavior is covered by bUnit tests (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/SessionsTests.cs:27`) and its rendered accessibility by the gallery E2E WCAG 2.1 AA scan (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Auth/SessionsPageE2ETests.cs:21`).
- **Caveats / not-in-source**: whether `RevokeAllSessionsAsync` completes the local sign-out when the server call succeeds but token clearing fails is a property of [`IAuthUIService`](#iauthuiservice), not of this file; any exception other than `OperationCanceledException` still propagates out of both handlers with no toast. The accessibility markers the page relies on (the text-variant "this device" chip at `Sessions.razor:58-59`, chosen so the marker does not depend on color alone, and the per-button `aria-label`s at `:83` and `:100`) live in the markup half, not in this code-behind.

### CachedPage

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:39` · Level 0 · record (sealed, private, nested)

- **What it is**: the on-disk shape of an offline list snapshot, a two-field record `(List<TItem> Items, int TotalItems)` nested privately inside [`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem). It is what actually gets serialized when a list page remembers its first page for a dead network.
- **Depends on**: nothing first-party. It is round-tripped through [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore), whose `SetAsync`/`GetAsync<T>` do the JSON work (`OfflineFirstPageSnapshot.cs:44-45`, `:63`).
- **Concept introduced, the private nested cache payload.** `[Rubric §19, State Management & Data Flow]` assesses whether client-held state has an explicit, owned shape rather than being smeared across ad-hoc dictionaries; `[Rubric §29, Resilience & Business Continuity]` assesses whether a surface degrades instead of failing when a dependency is gone. Declaring the payload as a `private sealed record` inside the only type that reads and writes it makes the snapshot format an implementation detail: no consumer can take a dependency on the field names, so the shape can change without a public-API break. The trade-off is the flip side of that: because the format is private and unversioned, a shape change silently orphans whatever is already in the device store.
- **Walkthrough**: one line. `private sealed record CachedPage(List<TItem> Items, int TotalItems);` (line 26). Written by `RememberAsync`, which materializes the fetched rows into a fresh list with a collection expression, `new CachedPage([.. fetched.Items], fetched.TotalItems)` (line 44), so the cached copy is decoupled from the caller's live list. Read back by `TryReadAsync` as `store.GetAsync<CachedPage>(cacheKey, cancellationToken)` (line 63) and immediately destructured into the tuple the grid expects, `(cached.Items, cached.TotalItems)` (line 64).
- **Why it's built this way**: a `record` gives value semantics and a positional constructor for free, which is all a serialization payload needs; `List<TItem>` rather than `IReadOnlyList<TItem>` is the concrete collection the round-trip materializes into. Nesting it privately keeps the type out of the package's public surface entirely.
- **Where it's used**: only inside [`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem). Its round-trip is covered end to end by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/OfflineFirstPageSnapshotTests.cs:15`.
- **Caveats / not-in-source**: the doc comment states that `TItem` "must be JSON round-trippable" (`OfflineFirstPageSnapshot.cs:14`), but nothing in this file enforces that; a DTO the store's serializer cannot handle fails at runtime, not at compile time.

### ErrorMessages

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:24` · Level 0 · class (static)

- **What it is**: a small factory of user-facing failure strings (load, save, delete, delete-failed, not-found, validation) so every page code-behind reports an outcome with identical, culture-correct phrasing, resolved through a shared localizer once one is configured ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: `IStringLocalizer` / `LocalizedString` (Microsoft.Extensions.Localization, NuGet) and `string.Format` with `CultureInfo.CurrentCulture` (BCL). No first-party types at all. The localizer it is handed is an `IStringLocalizer<SharedResource>` (doc comment, `ErrorMessages.cs:32`), so it shares the [`SharedResource`](#sharedresource) `.resx` keys.
- **Concept introduced, the static helper back-filled with an injected localizer, and the "never show raw exception text" rule.** `[Rubric §27, Internationalization]` assesses whether user-facing copy resolves per UI culture from resources instead of being hard-coded English; `[Rubric §15, Best Practices & Code Quality]` assesses whether a wording change lands in one place; `[Rubric §24, Forms, Validation & UX Safety]` assesses that internal error text never leaks to the user. The mechanism is the interesting part: the API is `static`, so any page can call `ErrorMessages.LoadError(Title, ex)` without taking a DI dependency, yet the output is culture-aware because the root layout hands the class one shared localizer at startup. Every method routes through a private `Localize(key, fallbackFormat, args)` that returns the resource value when the localizer is set and the key resolves, and the inline English format string otherwise. The scope note in the class comment (lines 14-22) is what pins the responsibility boundary: a server answer reaches a page as a `Result` and is rendered by [`ResultUiExtensions`](#resultuiextensions) (`NotifyOnFailure`, `OnFailureSetError`), so these helpers only cover the exceptions a page can still see, which are its own faults (a JS-interop failure, a mapping bug, a callback the page supplied). Such an exception's `Message` is never rendered: raw exception text is neither localizable nor safe to surface ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9).
- **Walkthrough**: one mutable static field plus pure builders.
  - `_localizer` (line 26), a nullable `IStringLocalizer?`, null until configured.
  - `Configure(IStringLocalizer localizer)` (line 33), the single wiring point: an expression-bodied assignment, idempotent, called once from the root layout.
  - `Localize(key, fallbackFormat, args)` (lines 35-47), the resolution core: when `_localizer` is set and the lookup's `ResourceNotFound` is false it returns `localized.Value` (lines 37-44); otherwise `string.Format(CultureInfo.CurrentCulture, fallbackFormat, args)` (line 46).
  - `LoadError`/`SaveError`/`DeleteError` (lines 56-57, 60-61, 64-65), the three CRUD failure paths, keyed `Common.Error.Load`/`Save`/`Delete`. Each passes the entity name **and** `ex.Message` as format arguments, and the shipped templates deliberately ignore the second one (doc comment, lines 49-55), so the exception text is available to a resource that wants it while the shipped copy never prints it. The two siblings carry `<inheritdoc cref="LoadError"/>` (lines 59, 63) rather than repeating the rationale.
  - `DeleteFailed(string entityName)` (lines 67-68, key `Common.Error.DeleteFailed`), the "the call returned but the delete did not happen" case, distinct from `DeleteError`, which carries an exception.
  - `NotFound(string entityName, object id)` (lines 70-71, key `Common.Error.NotFound`), interpolating the entity name and the missing id.
  - `ValidationError` (lines 73-74, key `Common.Error.Validation`), a parameterless property and the only fixed sentence.
- **Why it's built this way**: keeping the API static means call sites never move, while the `Configure` indirection adds localization without a signature change anywhere. The uniform "template only" answer is what makes the class safe to call from any `catch`: there is no branch on exception type, so no curated-message path can accidentally become a leak path. The mutable static is a deliberate, single exception to the framework's no-static-state rule and is named explicitly in the architecture fitness allowlist (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/StateManagementConventionTests.cs:22`, with the reasoning at lines 16-21: write-once wiring, not per-user state).
- **Where it's used**: configured once per host by `ErrorMessages.Configure(L)` in the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`). Called by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) on the two non-`Result` failure paths (`DataGridListPageBase.cs:751` paged, `:665` virtualized, `:767` mobile), by `NotificationSend` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:127`), and by the Store entity pages for `NotFound` and `ValidationError` (for example `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Products/ProductDetail.razor.cs:86` and `:200`).
- **Caveats / not-in-source**: the `.resx` payloads (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`, so per-key contents are not enumerable here; a shipped template that *did* consume `{1}` would print the exception text, and only the unit tests pin that it does not (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:11`, including the explicit case that even a `DomainInvariantViolationException` gets the plain template, `:45`).

### PersistedGridState

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:1132` · Level 0 · record (sealed, private, nested)

- **What it is**: a tiny serializable record `(List<TDto> Items, int TotalItems)` that carries the grid's already-fetched rows from the SSR pre-render pass into the interactive circuit, so the first interactive `ServerData` call can answer instantly instead of re-hitting the API.
- **Depends on**: `Microsoft.AspNetCore.Components.PersistentComponentState` (the Blazor mechanism that serializes it). Nested privately inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto).
- **Concept introduced, `PersistentComponentState` to skip the double fetch.** `[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance & Rendering]` assess whether redundant work is avoided across render-mode transitions. Under InteractiveAuto a page renders more than once (static SSR, then interactive Server, then WebAssembly), and naively each transition re-runs the data fetch, which the user sees as a fetch-cancel-refetch flicker. Blazor's `PersistentComponentState` serializes chosen data into the pre-rendered HTML and rehydrates it in the interactive circuit; `PersistedGridState` is the payload for the grid's data slice, so that cycle disappears.
- **Walkthrough**: declared as `private sealed record PersistedGridState(List<TDto> Items, int TotalItems)` (line 1034) at the very bottom of the file, under a doc comment (lines 1030-1033). On the persisting side, the callback registered in `OnInitialized` writes `new PersistedGridState([.. _lastSuccessfulGridData.Items], _lastSuccessfulGridData.TotalItems)` (line 189) under the key `grid:{GetType().FullName}` (built at line 171), and only when a successful fetch has actually happened (line 187). On the restoring side, the synchronous `OnInitialized` calls `ApplicationState.TryTakeFromJson<PersistedGridState>(persistKey, out var restored)` (line 172) and, when present, rebuilds a `GridData<TDto>` into `_persistedGridData` (line 174) that the first `LoadServerDataAsync` returns directly (lines 513-522).
- **Why it's built this way**: `private` because the persistence is purely an implementation detail of the base class; a `sealed record` for JSON friendliness and value semantics; the items are materialized into a fresh `List<TDto>` with a collection expression (line 189) so the persisted snapshot is decoupled from the live grid data.
- **Where it's used**: exclusively inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto), so every derived list page inherits the behavior with no wiring of its own.
- **Caveats / not-in-source**: the persisting callback is registered with an explicit `Microsoft.AspNetCore.Components.Web.RenderMode.InteractiveAuto` (line 194) to satisfy the framework's "callback must be associated with a render mode" rule during the static prerender pass, because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` rather than declaring one itself; the inline comment (lines 177-183) quotes the exact framework error this avoids. The restore runs in the **synchronous** `OnInitialized`, before any async lifecycle work.

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
  - `GetOrImportAsync` (`LazyJsModule.cs:37`) starts with a lock-free fast path returning the cached
    module (`LazyJsModule.cs:39-42`), then takes the lock only to publish or read the in-flight task
    (`LazyJsModule.cs:47-51`); the inline comment (`LazyJsModule.cs:44-45`) notes why holding a lock
    there is safe, since `ImportAsync` reaches its first await immediately and nothing slow runs under
    it. The import is started with no caller token at all (`LazyJsModule.cs:49`), and each caller then
    awaits the shared task through `WaitAsync(cancellationToken)` (`LazyJsModule.cs:55`), so a caller's
    token cancels only that caller's wait, never the import. The method summary
    (`LazyJsModule.cs:30-36`) gives the reason: binding the import to the first caller's token would let
    that one caller's cancellation fault the import for every concurrent awaiter.
  - The `finally` block is the subtle part (`LazyJsModule.cs:57-73`): it clears the field only when the
    task has completed and did **not** complete successfully (`LazyJsModule.cs:63`), and only when the
    field still holds this task (`LazyJsModule.cs:67`), because clearing unconditionally could drop a
    newer import started after this one completed and split the next set of callers. The inline
    comment (`LazyJsModule.cs:59-62`) covers the cancellation case: a caller that stopped waiting on its
    own token leaves the import still running rather than failed, so it stays cached for the others.
  - `ImportAsync` (`LazyJsModule.cs:76-84`) performs the actual
    `js.InvokeAsync<IJSObjectReference>("import", CancellationToken.None, modulePath)`
    (`LazyJsModule.cs:78-80`) and assigns `_module` (`LazyJsModule.cs:82`).
  - `DisposeAsync` (`LazyJsModule.cs:87-104`) returns immediately when nothing was imported
    (`LazyJsModule.cs:89-92`), nulls the field before awaiting (`LazyJsModule.cs:94`), and swallows
    `JSDisconnectedException` (`LazyJsModule.cs:100-103`), since a torn-down circuit is the normal end of
    life for a scoped UI service.
- **Why it's built this way**: the remarks (`LazyJsModule.cs:14-19`) draw the responsibility line. This
  class deliberately does not swallow anything on the import path, so each consuming service keeps its
  own degradation contract (return a default, fall back to a navigation, no-op). That is why
  [ListPageStateService](#listpagestateservice) wraps its calls in catch-and-ignore blocks while
  [MmcaCultureBootstrap](#mmcaculturebootstrap), which does not use this type at all, imports its
  module directly under an `await using`.
- **Where it's used**: [ThemeService](#themeservice) (`ThemeService.cs:20`),
  [ListPageStateService](#listpagestateservice) (`ListPageStateService.cs:69`),
  [NavigationHistoryService](#navigationhistoryservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:16`)
  and [CapabilitiesJsModule](group-26-device-capability-layer.md#capabilitiesjsmodule)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/CapabilitiesJsModule.cs:19`).
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
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:430` and
  `DataGridListPageBase.cs:434`); serialized to `sessionStorage` as JSON and encoded into the query
  string.

---

### MudTranslations

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/MudTranslations.cs:10` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors a `.resx` resource pair for **MudBlazor's own built-in component text**: the data-grid pager and filter menus, pickers, table editing, pagination, snackbar and alert close buttons, and input adornments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. The type has no members: it is the single declaration `public sealed class MudTranslations;` (line 10). Its meaning comes from its co-located resources, whose keys mirror MudBlazor's own `LanguageResource` keys (v9.6.0) with the English values copied verbatim so en-US behavior is unchanged, and from [`ResxMudLocalizer`](#resxmudlocalizer), which injects `IStringLocalizer<MudTranslations>` and hands those strings to MudBlazor's localization interceptor.
- **Concept reinforced, the resource-anchor type.** The idiom is introduced in full at [`SharedResource`](#sharedresource): ASP.NET Core's `IStringLocalizer<T>` resolves keys against the `.resx` whose base name matches `T`, so a dedicated empty class becomes the *name* of a shared string table. `MudTranslations` is the second anchor, scoped to third-party chrome rather than app chrome. `[Rubric §27, Internationalization]` assesses whether *all* user-visible copy follows the active culture, including the component library's; `[Rubric §20, Design System & Theming]` assesses a coherent design system, and a pager that still reads "Rows per page" under an `es` UI would break that coherence at exactly the surface the user interacts with most.
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `MudTranslations` in this namespace, with sibling `.resx` files whose keys match MudBlazor's `LanguageResource`". The doc comment (lines 3-9) records the verbatim-English-mirror invariant.
- **Why it's built this way**: MudBlazor exposes exactly one extension point for translating its built-in strings (an injectable `MudLocalizer`), and it needs some resource base to read from. A separate anchor keeps the library's keys in their own table, mirroring the upstream names one to one, cleanly apart from the app's own [`SharedResource`](#sharedresource) chrome. This is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) way to translate a dependency you do not own.
- **Where it's used**: injected as `IStringLocalizer<MudTranslations>` by [`ResxMudLocalizer`](#resxmudlocalizer), which `AddUIShared` registers as MudBlazor's `MudLocalizer` via `TryAddTransient` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:101`). Because resolution flows through the DI `IStringLocalizerFactory`, the [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorator registered at `DependencyInjection.cs:95` reaches these strings too.
- **Caveats / not-in-source**: the `.resx` files and their per-key match to MudBlazor v9.6.0's `LanguageResource` are resources, not `.cs`; individual key contents are not enumerated here.

### SharedResource

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/SharedResource.cs:9` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors `IStringLocalizer<SharedResource>` over its co-located `.resx` files, the single home for cross-cutting UI chrome strings ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. The type is empty: `public sealed class SharedResource;` (line 9). Its meaning comes from the co-located resources `SharedResource.resx` (the English default) and `SharedResource.es.resx` (Spanish), named in the doc comment (line 7), and from the ASP.NET Core localization stack that binds `IStringLocalizer<T>` to the `.resx` named after `T`.
- **Concept introduced, the resource-anchor type.** `[Rubric §27, Internationalization]` assesses whether user-facing copy is externalized to per-culture resources keyed stably rather than hard-coded. ASP.NET Core's `IStringLocalizer<T>` convention resolves keys against the resource file whose base name matches the type `T`, so a dedicated empty class becomes the *name* that ties many components to one shared string table: injecting `IStringLocalizer<SharedResource>` anywhere reads the same dotted, stable keys (`Common.Error.Load`, `Grid.Snackbar.LoadCancelled`, `Auth.Sessions.Title`). The doc comment (lines 3-8) enumerates the chrome it covers: buttons, layout labels, snackbar and error templates, and the culture- and theme-switcher text. Its counterpart for library chrome is [`MudTranslations`](#mudtranslations).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `SharedResource` in this namespace, with sibling `.resx` files". The work lives in the key/value pairs and in the localization middleware that resolves them by culture.
- **Why it's built this way**: a marker type is the idiomatic ASP.NET Core way to scope a shared resource table without inventing a real class, and one anchor keeps the chrome strings in a single table every component shares ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Where it's used**: injected as `IStringLocalizer<SharedResource>` by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) for its cancellation toast and its `Result` error rendering (`DataGridListPageBase.cs:25`), by [`Sessions`](#sessions) for every label on the devices page (`Sessions.razor.cs:33`), by the auth pages for their field labels and messages, and handed to [`ErrorMessages.Configure`](#errormessages) from the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`) so the static helper resolves the same table.
- **Caveats / not-in-source**: the `.resx` files are resources, not `.cs`; their per-key contents are not enumerated here.

### AuthFieldMessages

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/AuthFieldMessages.cs:19` · Level 1 · class (internal static)

- **What it is**: a static lookup of the localized validation messages the auth page models attach to their form fields (first name, last name, email, password, confirm password, token), resolved from the shared resource table.
- **Depends on**: [`SharedResource`](#sharedresource) only, as the type that names the `.resx` table; it builds a `ResourceManager` over `typeof(SharedResource).FullName` and `typeof(SharedResource).Assembly` (line 21).
- **Concept**: the validation-attribute counterpart to injecting `IStringLocalizer<SharedResource>`. A DataAnnotations attribute on a model property needs its message at attribute-evaluation time, where there is no DI container to inject a localizer from, so the messages are static properties read through a `ResourceManager` on demand. Each property is a one-line `Get("Auth.Field.<Field>.<Rule>")` call (lines 24-42): `FirstNameRequired`, `LastNameRequired`, `EmailRequired`, `EmailInvalid`, `PasswordRequired`, `PasswordMaxLength`, `PasswordComplexity`, `ConfirmPasswordRequired`, `ConfirmPasswordMismatch` and `TokenRequired`. `[Rubric §27, Internationalization]` assesses that user-facing copy is externalized to per-culture resources.
- **Walkthrough**: `Get` (line 44) calls `Resources.GetString(key, CultureInfo.CurrentUICulture)` and falls back to the key itself when the entry is missing, so a missing translation shows a stable dotted key rather than throwing or rendering blank. Because it reads `CurrentUICulture` on every access, the message follows the active culture at the moment the validator runs.
- **Why it's built this way**: keeping the auth messages in the same `SharedResource` table as the rest of the chrome means one `.resx` pair per locale ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) rather than a second resource file just for validation text. The type is `internal`, so it is an implementation detail of this assembly, not framework surface.
- **Where it's used**: the auth page models `RegisterModel.cs` (10 references), `ResetPasswordModel.cs` (9), `LoginModel.cs` (4) and `ForgotPasswordModel.cs` (3), all under `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/`.
- **Caveats / not-in-source**: the `Auth.Field.*` keys live in the `SharedResource` `.resx` files, which are resources rather than `.cs`, so their per-key text is not enumerated here. How the model attributes bind to these properties (for example through `ErrorMessageResourceType`) is in the model files, not in this type.

### DetailPageBase

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DetailPageBase.cs:26` · Level 1 · class (abstract)

- **What it is**: the shared framework base for a single-aggregate detail page (loaded by route id, edited inline). It owns the two concerns every such page used to repeat: a page-scoped `CancellationTokenSource` with its dispose pattern, and the inline edit-mode lifecycle (`IsEditing` / `IsDirty` plus the enter and leave transitions the unsaved-changes guard reads).
- **Depends on**: `Microsoft.AspNetCore.Components.ComponentBase` and `IDisposable` only, plus the sibling [`LatestLoadGuard`](#latestloadguard) it exposes through `LoadGuard` (`:43`).
- **Concept**: the mirror image of the list-page base one level up, [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto): the same page-scoped cancellation and dirty-tracking plumbing, but for the one-aggregate-by-id shape instead of the paged-grid shape. `PageToken` (`:36`) is handed to every awaited call the page makes, so navigating away, or an `InteractiveAuto` render-mode transition swapping the component out, cancels the in-flight work instead of completing into a component that is gone. `LoadGuard` (`:43`, a [`LatestLoadGuard`](#latestloadguard)) is the companion for the route-driven load itself: `Begin()` at the start of each load cancels the load it supersedes, and `IsCurrent(generation)` after each await tells a stale response to leave the page state alone.
- **Walkthrough**:
  - **State** (`:28-29`): a `readonly CancellationTokenSource _cts` created at construction, and a `_disposed` idempotency flag.
  - **`PageToken`** (`:36`): `protected`, exposing only the token, never the source (it returns `_cts.LifetimeToken()`, not the raw `_cts.Token`; the extension at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ComponentLifetimeExtensions.cs:26` hands back an already-cancelled token once the source is cancelled, disposed or null, so work started late in a disposed page stops through its normal `OperationCanceledException` path instead of throwing `ObjectDisposedException`), so a derived page can pass it but cannot cancel or dispose it out from under the base.
  - **`LoadGuard`** (`:43`): a `protected` `LatestLoadGuard` property, disposed with the page.
  - **`IsEditing` / `IsDirty`** (`:46`, `:49`): both `protected` with `private set`, so only the transition methods below can move them.
  - **`Dispose()`** (`:52-56`): the public entry point, delegating to `Dispose(bool)` and calling `GC.SuppressFinalize(this)`.
  - **`MarkDirty()`** (`:59`): the one-line setter bound to every editable field's `@bind-Value:after`.
  - **`ClearDirty()`** (`:65`): clears the dirty flag without opening or closing the editor, for a child panel that reports its own dirty state in both directions while the page's editor state stays as it is.
  - **`BeginEdit()`** (`:68-72`) and **`EndEdit()`** (`:75-79`): open the editor on a clean slate, and close it clearing the dirty flag, so the dirty flag can never be left set behind a closed editor.
  - **`Dispose(bool)`** (`:86-101`): the standard disposable pattern, guarded on `_disposed`, disposing `LoadGuard` and cancelling then disposing `_cts`.
- **Why it's built this way**: the guard component consumes `IsDirty` directly to drive the "are you sure" prompt, so that prompt is driven by one flag with a small, fixed set of writers rather than by per-page bookkeeping; adding a new detail page costs an `@inherits` line and two calls, not a re-implementation of the token, the load guard, and the flag.
- **Where it's used**: `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/DetailPageBaseTests.cs` and, in current source, ADC's `EventDetail` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventDetail.razor.cs`).
- **Caveats / not-in-source**: this file's own class-level remarks are outside the cited span (they sit above line 26), so the rationale above is drawn from the members' own doc comments rather than a class remark. The usage-site scan surfaces only `EventDetail.razor.cs`; whether the other Conference detail pages still inherit this base through an `@inherits` directive in their `.razor` markup is not verifiable from a `.cs`-scoped scan.

### OfflineFirstPageSnapshot<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:29` · Level 1 · class (sealed, generic)

- **What it is**: a small helper that keeps the last successful **first page** of a list on the device and hands it back when a fetch fails while the device is offline, so a dead venue network still shows content instead of an empty grid ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Depends on**: [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice), both taken through the primary constructor along with a `string cacheKey` and an optional `string? userScope = null` (lines 29-33), plus the private nested [`CachedPage`](#cachedpage) payload. No external NuGet dependency at all.
- **Concept introduced, offline-first read-through with a deliberately tiny blast radius.** `[Rubric §29, Resilience & Business Continuity]` assesses whether a surface degrades gracefully when a dependency is unreachable; `[Rubric §19, State Management & Data Flow]` assesses where client-side state lives and who owns it; `[Rubric §22, Responsive & Cross-Browser]` applies because the behavior is head-dependent by design. The teaching point is how narrowly the fallback is scoped. Three conditions must all hold before a cached row is ever shown (`CanServe`, line 43): the device reports itself offline, the store is available on this head, and the grid asked for page 1. That means the live path is untouched: an online user never reads the cache, a paged-past-page-1 user never reads it, and a head with no local store (Blazor Server, where SSR always has the live API) never reads it because [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) reports itself unavailable there. The class comment states exactly that contract.
- **Walkthrough**: three public members over a primary constructor, plus a computed field.
  - The `_scopedKey` field (lines 35-37): `string.IsNullOrWhiteSpace(userScope) ? cacheKey : $"{cacheKey}.u{userScope}"`, computed once at construction and used by every store call in place of the bare `cacheKey`.
  - `CanServe(int page)` (line 43): the single predicate, `!connectivity.IsOnline && store.IsAvailable && page == 1`. It is public so a caller can also use it as an exception filter, which is how the ADC consumer avoids swallowing a throw it has nothing to answer with.
  - `RememberAsync((IReadOnlyList<TItem> Items, int TotalItems) fetched, int page, CancellationToken)` (lines 49-59): writes only when `page == 1 && store.IsAvailable` (line 54), materializing a [`CachedPage`](#cachedpage) and handing it to `store.SetAsync(_scopedKey, ..., cancellationToken)` (lines 56-57). Any other page is silently left alone, so a user who paged deep does not overwrite the snapshot of page 1 with page 7.
  - `TryReadAsync(int page, CancellationToken)` (lines 67-78): returns `null` immediately unless `CanServe(page)` (lines 71-74), then reads `store.GetAsync<CachedPage>(_scopedKey, ...)` (line 76) and projects it back into the same tuple shape the fetch delegate returns (line 77), so the caller substitutes it without reshaping anything.
- **Why it's built this way**: it is a plain class constructed by the consuming service rather than a DI-registered singleton, because the `cacheKey` is per surface and cannot be resolved from the container. The doc comment on that parameter states the invariant plainly: the key must be unique per list surface (and per scope, when one head shows the same list for different tenants or events), since a shared key would let one page serve another page's rows. The `userScope` parameter folds the signed-in subject id into the stored key: a device is shared, so a snapshot written for one account must not be readable by the next one. Sign-out already wipes the store (`ILocalCacheStore.ClearAsync`), and `_scopedKey` is the defense in depth for the paths that never reach sign-out, an app killed mid-session or a token that simply expired. Returning `null` rather than an empty page keeps "nothing cached" distinguishable from "cached and genuinely empty", which is what lets the caller fall through to the real failure.
- **Where it's used**: composed by ADC's `PublicSessionScheduleService`, which builds one instance with a per-surface constant key (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Public/PublicSessionScheduleService.cs:28-34`) and wires all three members into one fetch: `RememberAsync` on every success (`:42`), a snapshot read when the live query returns a failed `Result` (`:49-50`), and `CanServe` as the exception filter on the guarded `catch` (`:52-59`) so a throw from the store itself is rethrown when there is nothing cached to answer with. Behavior is pinned by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/OfflineFirstPageSnapshotTests.cs:15`, including the per-key isolation case (`:97-98`).
- **Caveats / not-in-source**: the snapshot has no expiry, no size cap, and no versioning; how long a stale first page can be served is a property of [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and of the head's storage, not of this file. The class is best-effort by design: a store write failure inside `RememberAsync` is not caught here.

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
    `"search"` filter name that maps to `q` by convention and the `desc`/`1` markers. A separate
    `MaxPageSize` constant of `1000` (`ListPageQueryStateService.cs:45`) caps the page size a URL may
    ask for; its summary (`ListPageQueryStateService.cs:42-44`) ties it to the same ceiling
    `KeysetPageRequest.MaxPageSize` states.
  - `ReadCurrent()` (`ListPageQueryStateService.cs:50-54`) is the instance entry point: it resolves the
    absolute URI from the injected `NavigationManager` and hands the query to the parser.
  - `ParseQueryString` (`ListPageQueryStateService.cs:61`) is deliberately `static` and public,
    documented as a pure helper exposed for unit testing without a `NavigationManager`
    (`ListPageQueryStateService.cs:56-60`). It reads the three integers through `TryGetInt`
    (`ListPageQueryStateService.cs:222-232`, which parses with `CultureInfo.InvariantCulture` and falls
    back to the supplied default rather than throwing). Out-of-range values get the same fallback as
    unparsable ones (`ListPageQueryStateService.cs:65-69`): the page is floored at `0`, the mobile page
    at `1`, and a page size outside `1..1000` collapses to `0`, the page default, through
    `ClampPageSize` (`ListPageQueryStateService.cs:220`). The inline comment states the reason: a
    hand-edited or stale link with `p=-3` or `ps=5000` must not leave the list stuck on a failing
    fetch. It then treats a blank sort value as no sort
    (`ListPageQueryStateService.cs:72-79`), matches `desc` case-insensitively
    (`ListPageQueryStateService.cs:84`) but the dense marker `1` ordinally
    (`ListPageQueryStateService.cs:90`), then walks every remaining key, folding `q` into the `search`
    filter and stripping the `f:` prefix off the rest (`ListPageQueryStateService.cs:94-110`).
  - `BuildPath` (`ListPageQueryStateService.cs:129`) is the inverse, and the omission rules are visible
    one by one: page only when `> 0` (`ListPageQueryStateService.cs:136`), page size only when `> 0`
    (`ListPageQueryStateService.cs:141`), mobile page only when `> 1`
    (`ListPageQueryStateService.cs:146`), `sd` only when a sort column exists and is descending
    (`ListPageQueryStateService.cs:151-158`), `d` only when dense
    (`ListPageQueryStateService.cs:160-163`); with no parameters at all it returns the bare base path
    (`ListPageQueryStateService.cs:182-184`).
  - `ReplaceState` (`ListPageQueryStateService.cs:203`) writes the URL back using
    `NavigationOptions { ReplaceHistoryEntry = true }` (`ListPageQueryStateService.cs:216`) so filter
    changes do not pollute the back stack.
- **Why it's built this way**: the most instructive part is the guard in `ReplaceState`
  (`ListPageQueryStateService.cs:208-213`), which drops the write when the current path no longer
  matches the owning `basePath`. The remarks (`ListPageQueryStateService.cs:193-202`) record the
  diagnosed defect: a grid-state write is inherently deferred (a debounced search, a late `ServerData`
  completion), so it can land after the user has already navigated away. Building from the then-current
  URI used to stamp grid parameters onto the next page's URL and issue a spurious navigation that
  disposed it mid-load, and detail pages reached by clicking a list row had their first data fetch
  canceled about 66ms in, leaving them stuck on their loading state.
- **Where it's used**: registered `TryAddScoped` (`DependencyInjection.cs:176`) and injected into
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:28`), which
  reads the URL on initialization and on parameter changes (`DataGridListPageBase.cs:217` and
  `DataGridListPageBase.cs:278`) and writes it back after a grid or filter change
  (`DataGridListPageBase.cs:981` and `DataGridListPageBase.cs:1023`).

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
- **Where it's used**: registered `TryAddScoped` (`DependencyInjection.cs:175`) and injected into
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:27`), which reads
  it during state restore (`DataGridListPageBase.cs:219`), hydrates from session on first render
  (`DataGridListPageBase.cs:347-352`), records scroll offsets (`DataGridListPageBase.cs:411`), and
  saves plus persists after grid and density changes (`DataGridListPageBase.cs:962-987` and
  `DataGridListPageBase.cs:1018-1027`).

---

### MudAppDialogService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudAppDialogService.cs:11` · Level 1 · class (internal sealed)

- **What it is**: the MudBlazor-backed implementation of the framework's confirm-prompt facade. It asks
  MudBlazor's message box for a yes/no answer and reduces it to a single `bool`.
- **Depends on**: [IAppDialogService](#iappdialogservice) (implemented) and MudBlazor's `IDialogService`
  (`MudAppDialogService.cs:1-2`). It has no other state.
- **Concept introduced, quarantining the component library behind a facade.**
  `[Rubric §15, Best Practices & Code Quality]` assesses how much of the codebase would have to change if a vendor
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
  `TryAddScoped<IAppDialogService, MudAppDialogService>()` (`DependencyInjection.cs:231`, under the
  facade-registration doc at `DependencyInjection.cs:213-227`). Consumers resolve the interface: the
  shared `UnsavedChangesGuard` component
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Forms/UnsavedChangesGuard.razor:14` and
  `UnsavedChangesGuard.razor:57`) and the Helpdesk seed's ticket pages
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:104` and
  `Components/Pages/TicketDetail.razor:348`). A bUnit test pins the registration to this implementation
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/BunitComponentTestBaseFacadeTests.cs:32`).

---

### MudToastService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudToastService.cs:19` · Level 2 · class (internal sealed)

- **What it is**: the MudBlazor-backed [IToastService](#itoastservice). It is one of only two types in
  the framework that name a component-library service, the other being its sibling
  [MudAppDialogService](#mudappdialogservice).
- **Depends on**: [IToastService](#itoastservice) (the contract implemented at
  `MudToastService.cs:19`) and [ToastSeverity](#toastseverity) (the vendor-neutral level, taken as a
  `Show` parameter at line 38 and switched over at lines 96-102); MudBlazor's `ISnackbar` (held in a
  private field, line 21), `Severity`, `Variant`, `Color` and `SnackbarOptions`, and
  `Microsoft.AspNetCore.Components.Rendering.RenderTreeBuilder` (ASP.NET Core) for the one method that
  renders markup (lines 45-50).
- **Concept introduced, the vendor boundary.** `[Rubric §20, Design System, Theming & UI Consistency]`
  assesses whether the app depends on its own design vocabulary rather than on a specific component
  library's API. Every page, component and `Result` helper in both applications depends on
  `IToastService`; only this class and `MudAppDialogService` know that MudBlazor exists, and the DI
  comment says so outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:185-188`).
  `[Rubric §14, Testability & Test Strategy]` is the practical payoff: a test records toasts against
  the interface without rendering a snackbar host, which is how
  [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure` can be tested at all
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:289,301`).
  `[Rubric §1, SOLID Principles]` covers the shape: an internal implementation behind a public
  interface means no consumer can name the concrete type even by accident. The class doc comment also
  states why toast text is not duplicated into a second screen-reader channel: `MmcaThemeProviders`
  hosts MudBlazor's `MudSnackbarProvider` inside a `role="status" aria-live="polite"` element, so the
  rendered toast is itself the live-region content, and pushing the same sentence through a second
  channel would announce it twice and make every text locator ambiguous.
- **Walkthrough**
  - The class holds `ISnackbar` in a private field (`_snackbar`, line 21) set by an explicit
    constructor (line 23) rather than a primary-constructor parameter; the two are behaviorally
    identical, only the field-access syntax changed.
  - Four one-liners cover the common levels: `Success`, `Info`, `Warning` and `Error` (lines 26, 29,
    32, 35), each a direct `_snackbar.Add(message, Severity.X)`. `Show(message, severity)` (line 38) is
    the same call with the level chosen at runtime.
  - `ShowPersistent(title, body, severity)` (line 41) is the push-notification shape. It renders a
    two-line body through a `RenderTreeBuilder` (a bolded title, a line break, then the body,
    lines 45-50) and sets `RequireInteraction = true` with `Variant.Filled` (lines 57-58). The comment
    states the rule (lines 55-56): the message arrived unprompted, so it must survive until the user
    has actually looked at the screen rather than expiring on the default timer.
  - `ShowAction(message, actionText, onAction, severity, requireInteraction)` (line 62) is the
    undo-style toast. It sets `Action` and `ActionColor` (lines 73-74) and adapts MudBlazor's click
    signature to the caller's parameterless delegate by discarding the `Snackbar` instance MudBlazor
    passes (line 78). `requireInteraction` is opt-in: when false the options are left untouched so the
    host's own snackbar timing applies, and when true both `RequireInteraction` and `Variant.Filled`
    are stated outright rather than relying on MudBlazor's null default (comment at lines 82-85, values
    at lines 86-87).
  - `Map(ToastSeverity)` (line 96) projects the neutral enum onto MudBlazor's with an explicit switch
    over all five members plus a `Normal` default (lines 98-103). It is written out rather than cast on
    purpose: the two enums agree numerically today, and an implicit dependency on that would break
    silently the day either side gains a member (comment at lines 91-94).
  - Nothing wraps `onAction`. The absence is a documented contract, pinned by a test that asserts a
    throwing callback propagates
    (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/MudToastServiceTests.cs:49-59`): a
    caller whose work can fail guards it instead of discovering the failure as a swallowed no-op.
- **Why it's built this way**: keeping the vendor type behind a facade is what makes the component
  library swappable in principle and mockable in practice, and it is the reason the framework ships
  `AddCommonUiFacades()` as its own registration
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:228-233`), factored out so a
  bUnit harness can register exactly these two services without pulling in the whole shared-UI surface
  (comment at lines 144-157). Every method returns `void`: a toast is fire-and-forget by design, and
  MudBlazor's `ISnackbar.Add` is synchronous.
- **Where it's used**: registered by `AddCommonUiFacades` with `TryAddScoped`
  (`DependencyInjection.cs:230`), which `AddUIShared` calls for every host
  (`DependencyInjection.cs:159`). Consumers resolve `IToastService`, never this type: the framework's
  `NotificationListener` raises an incoming push as a persistent toast
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationListener.razor:49`),
  [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure` turns a failed
  [Result](group-01-result-error-handling.md#result) into one
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:301`), and ADC's
  [LiveEventListener](group-22-engagement-module.md#liveeventlistener) uses the action shape for its
  reconnect prompt
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Components/LiveEventListener.razor.cs:81,166`).
  Its own behavior is pinned by
  [MudToastServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup), which captures the
  options lambda and applies it to a fresh `SnackbarOptions` carrying MudBlazor's defaults, so the
  assertions see exactly what a rendered snackbar would
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/MudToastServiceTests.cs:163`).
- **Caveats**: `ShowPersistent` renders the title and body as content in a render fragment, so both are
  escaped by the renderer, but neither string is length-bounded in source: a long push body produces a
  correspondingly tall toast. `Show`, `Success` and the rest pass the caller's string straight to
  MudBlazor, so any localization has to happen before the call; the facade does not touch
  `IStringLocalizer`.

### DataGridListPageBase<TDto>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:22` · Level 3 · class (abstract)

- **What it is**: the abstract Blazor base for every server-paged `MudDataGrid<TDto>` list page. It folds the otherwise copy-pasted concerns (cancellation lifecycle, loading and failure flags, mobile/desktop viewport detection, filter and sort extraction, error reporting, scroll tracking and restore, density toggle, URL plus session plus prerender state plumbing, an opt-in virtualization funnel, newest-load-wins ordering for overlapping paged loads, and disposal) into one reusable component: `class DataGridListPageBase<TDto> : ComponentBase, IBrowserViewportObserver, IAsyncDisposable, IDisposable` (line 22).
- **Depends on**: [`IToastService`](#itoastservice), [`SharedResource`](#sharedresource) (as `IStringLocalizer<SharedResource>`), [`ListPageState`](#listpagestate), [`ListPageStateService`](#listpagestateservice), [`ListPageQueryStateService`](#listpagequerystateservice), [`BreakpointConstants`](#breakpointconstants), [`ErrorMessages`](#errormessages), [`ResultUiExtensions`](#resultuiextensions) (`NotifyOnFailure`), [`Result`](group-01-result-error-handling.md#result), and the nested [`PersistedGridState`](#persistedgridstate). Externals: MudBlazor's `MudDataGrid<T>`, `GridState<T>`, `GridStateVirtualize<T>`, `GridData<T>`, `IBrowserViewportObserver` / `IBrowserViewportService`, and Blazor's `PersistentComponentState`, `NavigationManager`, `IJSRuntime`, `RendererInfo`.
- **Concept introduced, a behavior-rich Blazor base component.** `[Rubric §18, UI Architecture & Component Design]` assesses reuse, and every list page in both apps inherits this behavior with no copy-paste. `[Rubric §23, Front-End Performance & Rendering]` assesses render and fetch cost: only the requested page is ever fetched, the prerender cache skips a redundant round trip, and the opt-in virtualization funnel keeps the DOM small for large sets. `[Rubric §19, State Management & Data Flow]` covers the four-channel persistence (URL, in-memory, sessionStorage, prerender cache) and the newest-load-wins rule for overlapping fetches. `[Rubric §27, Internationalization]` applies because the cancellation toast and every `Result` failure message resolve through [`SharedResource`](#sharedresource). `[Rubric §24, Forms, Validation & UX Safety]` shows up in the `LoadFailed` flag (line 53): a failed fetch renders zero rows, which is visually identical to a genuinely empty list once the error toast expires, so derived pages branch on the flag to show an inline error-with-retry instead of the "no records" empty state. Several hard-won defect fixes live here too, each with the diagnosis inline: the MudDataGrid v9 `RowsPerPage` setter that always resets `CurrentPage` (`RestoreCurrentPageAfterRowsPerPageReset`, line 422), the disposed-CTS race that stuck the `blazor-error-ui` banner (`ResetCancellationTokenAsync`, line 877), the stale-write race where a late grid-state save stamped grid parameters onto the *next* page's URL (`_ownRoutePath`, lines 215 and 1032), and the last-completing-call race in MudDataGrid's `ServerData` (`NewestPagedResultAsync`, line 571), all of which were E2E-discovered, touching `[Rubric §28, Front-End Testing]`.
- **Walkthrough**, in teaching order:
  - **Injected services and abstract surface** (lines 24-31): [`IToastService`](#itoastservice) (line 24, the only `protected` one, so derived pages toast through the same abstraction), `IStringLocalizer<SharedResource>` (line 25), `IBrowserViewportService` (line 26), the two state services, `NavigationManager`, `IJSRuntime`, `PersistentComponentState` (line 31). Derived pages supply the abstract `Title` (line 54) and may override `SaveFilters` / `RestoreFilters` (lines 128, 131), `GridRef` (line 141), `OnMobileDataRequestedAsync` (line 1047), and the three virtualization knobs.
  - **Public and protected state**: `IsLoading` (lines 41-45), `LoadFailed` (line 53), `IsMobile` (line 57), the mobile card-view block `MobileItems` / `MobileTotalItems` / `MobileCurrentPage` / `MobilePageSize` (lines 60-63), the bindable `CurrentPageState` (line 70, 0-indexed), `RowsPerPageState` (line 80, defaulting to 10 to match MudDataGrid v9's own default), and `DenseGrid` (line 89). `IsLoading` is a computed property, `get => field || !RendererInfo.IsInteractive` (line 42): it is always true during the non-interactive SSR prerender pass, because the grid fetches from `OnAfterRenderAsync`, which a static render never reaches, so without this the prerendered HTML would carry the "no records" empty state until the interactive render loads the rows. Once interactive it reflects the latest load only (see `RunFetchAsync`).
  - **Constants** (lines 95, 99): `PrerenderFetchTimeoutMs = 5000` bounds the SSR fetch, and `VirtualizedScrollContainerSelector = ".mud-table-container"` records where a virtualized grid actually scrolls (the grid's own height-bound viewport, not the document).
  - **Private fields** (lines 101-118): the CTS, the `_disposed` guard, the scroll module and its `DotNetObjectReference`, the persistence subscription, the prerender caches `_persistedGridData` / `_lastSuccessfulGridData`, `_newestPagedLoad` (line 109, the newest paged load task), `_pendingScrollRestore`, the saved-state mirrors `_savedPage` / `_savedPageSize` / `_savedSortColumn` / `_savedSortDescending`, the re-entrancy and deferral flags, and a per-instance `_scrollTrackerId` GUID. The observer contract's `Id` and `ResizeOptions` (a 250 ms report rate) sit at lines 122 and 125; `_ownRoutePath`, the stale-write anchor, is declared later at line 1032.
  - **The virtualization opt-in** (lines 154, 162, 170): `VirtualizeGrid` defaults to `false`, so every existing page keeps its pager untouched. A page that overrides it to `true` binds `Virtualize`, `Height="@VirtualizedGridHeight"` (default `70vh`), `ItemSize="VirtualizedItemSize"` (default 52, the comfortable-density row height) and `VirtualizeServerData` **instead of** `ServerData`: the doc comment records that MudBlazor v9 accepts only one of the two funnels and that binding both leaves the grid fetching through a pager it no longer renders. Turning it on also disables the pager-restore machinery, which has no meaning without a pager; sort, filter, and density persistence still apply.
  - `OnInitialized` (from line 179), synchronously: (a) restores any [`PersistedGridState`](#persistedgridstate) under the key `grid:{GetType().FullName}`; (b) registers the persisting callback with an explicit `RenderMode.InteractiveAuto` (line 198); (c) pins `_ownRoutePath` to this page's route (line 215); (d) reads the URL through [`ListPageQueryStateService`](#listpagequerystateservice) and falls back to the in-memory [`ListPageStateService`](#listpagestateservice) snapshot when the URL carries no state; (e) primes `CurrentPageState`, `RowsPerPageState`, `MobileCurrentPage`, sort, and `DenseGrid`, then calls `RestoreFilters` so the grid's *first* `ServerData` call already fetches the right page; (f) sets `_deferSessionPersist` when neither channel had state and picks up a pending scroll position; and (g) subscribes to `LocationChanged`.
  - `OnLocationChanged` (from line 262): honors the one-shot `_suppressNextLocationChanged` flag (line 266), reacts only to same-path back/forward navigation (a different path returns early and is handled by disposal, line 273), re-reads the URL into the mirror fields, then re-applies `CurrentPage` to the live grid through the BL0005-suppressed `ApplyCurrentPageFromUrl` (line 309) and reloads. The virtualized path skips the page re-apply entirely, because there is no pager to move.
  - `NotifyBrowserViewportChangeAsync` (from line 318): the `IBrowserViewportObserver` callback, recomputing `IsMobile` from [`BreakpointConstants.IsMobileBreakpoint`](#breakpointconstants) (line 322) and, on a desktop-to-mobile transition only, resetting to page 1 and requesting mobile data.
  - `OnAfterRenderAsync(firstRender)` (from line 339): on first render it hydrates session state now that interop is available (`HydrateFromSessionAsync`, line 347), runs the cross-circuit fallback (`needsSessionRestore`, line 353), clears the deferral, subscribes to viewport changes, imports `./_content/MMCA.Common.UI/list-page-scroll.js` and enables debounced (150 ms) scroll tracking through a `DotNetObjectReference` scoped to `ScrollContainerSelector` (`enableScrollTracking`, line 374; selector at line 403), then calls `RestoreGridStateAsync` (line 380) and forces a sessionStorage sync. On every render it restores a pending scroll position once the grid has stopped loading. JS calls back into `[JSInvokable] OnScrollPositionChanged` (line 409), which updates only the scroll field so page, page size, and filters are untouched.
  - `RestoreGridStateAsync` (from line 456) is the single entry point for the pager-restore machinery, so virtualization opts out in **one** place (still honoring a session-driven reload). Otherwise it forces `SetRowsPerPageAsync(_savedPageSize, resetPage: false)` when the parameter did not take (line 481), then calls `RestoreCurrentPageAfterRowsPerPageReset` (line 422) because the v9 setter clobbers `CurrentPage` to 0, and finally reloads when session hydration changed pagination after the grid's first fetch.
  - `LoadServerDataAsync(state, fetchAsync, additionalFilters, showCancelSnackbar)` (lines 521-532), the paged entry point, is now a thin non-async wrapper. It starts `LoadPagedAsync` (line 529), records the returned task in `_newestPagedLoad` (line 530) **before anything yields** (the load's own cancellation reset cancels the previous load, whose continuation must already see this one as its successor), and returns `NewestPagedResultAsync(load)` (line 531). Overlapping calls therefore end on the NEWEST call's result: a superseded call returns the later call's rows and total, never its own empty cancelled page.
  - `LoadPagedAsync` (from line 535) is one paged load: it resets the CTS (line 541) and returns the prerender cache on the first interactive call, now also setting `IsLoading = false` (line 553) because that call is the latest load and is already finished, still saving state (line 556); otherwise it delegates to `FetchPagedAsync` (line 560).
  - `NewestPagedResultAsync(load)` (lines 571-581): awaits its own load, then loops while `_newestPagedLoad` is a different task, adopting and awaiting that newer load, and returns the newest data. It exists because MudDataGrid applies whichever `ServerData` call completes LAST, not the newest, so a superseded load (token cancelled by the newer call's reset) would otherwise overwrite the newer rows with its empty cancelled page.
  - `FetchPagedAsync` (from line 588) holds the actual fetch, routed through `RunFetchAsync`: inside the fetch body it extracts filters and sort, calls the delegate with a 1-based page number, and on success caches `_lastSuccessfulGridData` and calls `SaveCurrentState`; a failed `Result` goes through `FailedFetch(fetched, EmptyGridData)`. No extra token is linked in (`CancellationToken.None`): the paged funnel has no per-request token of its own, and the SSR pre-render timeout still applies because `RunFetchAsync` builds the token through `CreateFetchCts`.
  - `LoadVirtualizedServerDataAsync(state, fetchAsync, additionalFilters, cancellationToken)` (lines 642-690), the `VirtualizeServerData` counterpart, resets the CTS (line 651) and runs through `RunFetchAsync` (line 654, `showCancelSnackbar: false` since cancellation here is always silent: a virtualized grid supersedes its own in-flight fetch on every scroll burst, so a cancel toast would fire continuously and say nothing actionable). Inside the fetch body it maps the row window MudBlazor asks for onto the same page-based fetch delegate (line 661); when the window straddles two pages it fetches the following page too and concatenates (lines 670-679), then trims to exactly the requested count (line 682). MudBlazor's own per-window `cancellationToken` parameter is forwarded straight into `RunFetchAsync`'s `additionalToken` (line 689) so a superseded fetch stops at the API boundary.
  - `RunFetchAsync<TResult>(fetchAsync, onCancelled, onFailed, showCancelSnackbar, additionalToken)` (lines 717-764), the one fetch pipeline behind the paged, virtualized, **and** mobile loaders. It captures `loadSource = _cts` first (line 724), sets `IsLoading` and clears `LoadFailed` (lines 725-726), builds the fetch token through `CreateFetchCts(additionalToken)` and runs the caller's `fetchAsync` **entirely inside the `try`** (lines 729-733), because the caller's `additionalFilters` callback (and the filter/sort extraction around it) is arbitrary page code and a throw from it used to strand `IsLoading` at `true`. `OperationCanceledException` maps to `onCancelled()`, but the localized `Grid.Snackbar.LoadCancelled` toast fires only when `showCancelSnackbar && ReferenceEquals(loadSource, _cts) && !_disposed` (line 742): a superseded load lost its source to the newer one (the reset swaps before it cancels) and a disposed component has nobody to tell, so both end silently, while a user cancel through `CancelLoading` cancels the current source without replacing it and still toasts. Any other exception maps to `onFailed()` plus [`ErrorMessages.LoadError`](#errormessages) (line 751) and `LoadFailed = true`. The `finally` clears `IsLoading` only when `ReferenceEquals(loadSource, _cts)` (lines 757-760), so only the LATEST load ends the loading state; otherwise the grid would drop its Cancel button and show the empty state while the newer load is still in flight. Each caller supplies its own `onCancelled`/`onFailed` result shape (an empty `GridData<TDto>` for the two grid loaders, `false` for the mobile loader).
  - `FailedFetch<TResult>(fetched, onFailed)` (from line 770): the `Result`-branch counterpart to `RunFetchAsync`'s exception branch, reporting a failed fetch the same way, `fetched.NotifyOnFailure(Toast, Localizer)`, `LoadFailed = true`, then `onFailed()`.
  - `EmptyGridData()` (line 777): a `private static` one-liner returning `new GridData<TDto> { Items = [], TotalItems = 0 }`, passed as the `onCancelled`/`onFailed` delegate to both grid loaders.
  - `ComputeVirtualWindow(startIndex, count)` (lines 792-801), the pure arithmetic behind the virtualized window mapping and the reason it is testable: the window's own size becomes the page size, so an aligned window is exactly one page and an unaligned one spills into the next (`offset > 0`). It is `internal static` precisely so the unit tests can drive it directly.
  - `CreateFetchCts(additionalToken)` (from line 813): links to the active `_cts`, plus the caller's token when one can be cancelled, and during **non-interactive** prerender (`!RendererInfo.IsInteractive`, line 818) calls `CancelAfter(PrerenderFetchTimeoutMs)` (line 820) so a cold or unreachable backend cannot block the page load indefinitely.
  - `LoadMobileDataAsync` (lines 830-868), the mobile-card equivalent, also routed through `RunFetchAsync` (line 842). Its failure shape depends on the page: `onFailed` is `static () => false` when `MobileCurrentPage > 1` (an infinite-scroll append keeps the items, `MobileTotalItems` and `MobileCurrentPage`, so the inline error and Retry render below what is already loaded and Retry re-requests the same page) and `ClearMobileItems` (line 870) on page 1 (line 841). A failed `Result` goes through `FailedFetch(fetched, onFailed)` (line 851), and cancellation returns `false` with no toast and keeps the cards shown (`onCancelled: static () => false`, line 864). Its `SaveCurrentState(0, 0, ...)` call is deliberate (comment at lines 857-860): persisting the mobile page size would overwrite the desktop grid's `RowsPerPage`, so a user who chose 50 rows and then narrowed the viewport would come back to 10.
  - `ResetCancellationTokenAsync` (from line 877): swaps in a fresh CTS **first** (line 885) so the caller always has a valid token, then tears down the previous one, tolerating `ObjectDisposedException`.
  - `ExtractGridFilters` (from line 911) flattens MudDataGrid's filter definitions into a one-entry-per-column dictionary, grouping by property name and letting the **newest** row win rather than throwing on the duplicate key a second filter on the same column would produce; it takes the definition collection rather than the state object so the paged and virtualized funnels share one implementation. `ExtractSortParameters` (line 926) takes the first sort definition, and `ResolveSortParameters` (line 938) adds the first-fetch fallback: when MudDataGrid has not yet picked up a `SortDefinition`, the sort restored from the query string is used, so the data lands sorted from the very first request.
  - `SaveCurrentState` (from line 952): guarded by `IsOwnRouteCurrent()` (line 956, the stale-write drop), it composes a new [`ListPageState`](#listpagestate) preserving the existing scroll position and writes it to all three channels: the in-memory service, the URL via `ReplaceState` (line 981) with `_suppressNextLocationChanged` set first (line 980) so it does not re-trigger its own handler, and sessionStorage, skipped during the deferred-hydration window.
  - `ToggleDensity` / `PersistDensity` (lines 996 and 1009): flips `DenseGrid` and mirrors just that one field through the same three channels using a `with` expression on the existing state, under the same `IsOwnRouteCurrent` guard (line 1012), so a density change made before the grid's first `ServerData` save is not lost.
  - **Route pinning**: `_ownRoutePath` (line 1032), `GetRoutePath()` (line 1034, falling back to the live URI only before initialization), and `IsOwnRouteCurrent()` (line 1040).
  - `CancelLoading` (line 1049), the manual cancel hook a page can bind to a stop affordance.
  - `DisposeAsync` / `Dispose` (from lines 1052 and 1097): dispose the persistence subscription, unsubscribe `LocationChanged` (helper `UnsubscribeLocationChanged`, line 1113), disable scroll tracking and dispose the JS module guarded against shutdown-time races (`JSDisconnectedException`, line 1070, and `JSException`), dispose the `DotNetObjectReference` in a `finally`, unsubscribe the viewport observer best-effort, and cancel plus dispose the CTS. Both paths are `_disposed`-idempotent.
- **Why it's built this way**: every concern here was independently re-implemented (and re-broken) on individual pages before being lifted into one base, so a single fix now propagates to every list page at once. The four-channel persistence covers the full matrix of how a user can leave and return to a list: browser back, in-app navigation, refresh or `forceLoad`, and a shared link. The delegate signature deliberately mirrors [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)`.GetPagedAsync` exactly (remarks at lines 511-520), so a page still passes a method group with no adapter, and the move to a `Result`-returning delegate means a server failure is handled on the same terms an exception used to be, with the API's own localized wording reaching the toast through [`ResultUiExtensions`](#resultuiextensions). The newest-load-wins wrapper and the `loadSource` identity checks exist for the same reason: MudDataGrid applies the last-completing `ServerData` call, so the base, not each page, must make an overlapping or superseded load harmless.
- **Where it's used**: base class for the list pages in both apps, including ADC's `UserList` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserList.razor.cs:18`) and `SessionList` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionList.razor.cs:22`), and Store's `OrderList` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/OrderList.razor.cs:21`), alongside the Catalog, Identity, and Engagement list pages. The virtualized funnel is exercised by the backend-less gallery page `GridGallery` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Pages/GridGallery.razor:44`, `:50`), which the deploy-gating E2E suite uses to assert that far fewer rows render than the data set holds and that scrolling happens inside the grid's own viewport (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Layout/GridPageE2ETests.cs:34`, `:52`, with a WCAG 2.1 AA scan at `:77`). The base's own behavior is covered by bUnit tests at `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:22`.
- **Caveats / not-in-source**: two `BL0005` suppressions (near `ApplyCurrentPageFromUrl`, line 309, and `RestoreCurrentPageAfterRowsPerPageReset`, line 422) set `grid.CurrentPage` from outside the component; the justification (MudDataGrid v9 exposes no public method for arbitrary-page navigation and the setter is well behaved) is inlined at both. The prerender optimization assumes a warm backend; under a cold one the prerender fetch times out at 5 s and the interactive pass refills the grid. The `list-page-scroll.js` module (`enableScrollTracking` / `setScrollPosition` / `disableScrollTracking`) is JavaScript under `wwwroot`, invoked here only by name, so its behavior is not verifiable from this `.cs` file. Note also that the route comparison is `Ordinal` in `OnLocationChanged` (line 273) but `OrdinalIgnoreCase` in `IsOwnRouteCurrent` (line 1041); the source does not state why the two differ.

### ListPageActions

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ListPageActions.cs:15` · Level 4 · class (static)

- **What it is**: two static helpers that every list page shares: reload whichever layout (mobile list or desktop grid) is currently rendered, and run the confirm-delete-toast-reload flow.
- **Depends on**: [`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem), [`IToastService`](#itoastservice), [`Result`](group-01-result-error-handling.md#result), and the `DeleteConfirmation` dialog component (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Forms/DeleteConfirmation.razor:27`). Externals: MudBlazor's `MudDataGrid<T>`.
- **Concept introduced, the shared page helper that stays out of the base class.** `[Rubric §15, Best Practices & Code Quality]` assesses whether a repeated flow exists once; `[Rubric §24, Forms, Validation & UX Safety]` assesses that destructive actions confirm first and that failures surface to the user. The placement argument is in the class comment (lines 8-13) and is the interesting part: these are kept as plain statics rather than members on [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) so that a page which composes its own layout, or holds several grids, can reuse them **without inheriting anything**. Inheritance would have forced every consumer into the base class's whole lifecycle just to get two flows.
- **Walkthrough**: two static methods.
  - `ReloadActiveLayoutAsync<TDto>(bool isMobile, MobileInfiniteScrollList<TDto>? mobileList, MudDataGrid<TDto>? dataGrid)` (lines 25-38). When the mobile layout is active and its ref is bound it calls `mobileList.ResetAsync()` (line 32); otherwise it calls `dataGrid.ReloadServerData()` when that ref is bound (line 36). Both refs are nullable **by design**: only one layout is in the render tree at a time, so the other `@ref` is genuinely null, which makes the null checks the mechanism rather than defensive noise (`[Rubric §22, Responsive & Cross-Browser]`).
  - `DeleteWithConfirmationAsync(...)` (lines 56-93) takes the page's `DeleteConfirmation` ref, the entity display name, a `Func<Task<Result>>` delete call, the toast service, a localized success message, a `Func<Result, string>` error mapper, and a reload callback. It guards every reference argument with `ArgumentNullException.ThrowIfNull` (lines 65-69), shows the dialog, and returns immediately unless the answer is exactly `true` (lines 71-75): a dialog dismissed with `null` is a cancel, not a confirm. On confirm it awaits the delete and branches on the `Result` (lines 79-87): a failure toasts the mapped error and returns without reloading, a success toasts and reloads. The single `catch (OperationCanceledException)` (lines 89-92) is swallowed with a comment naming the two causes, component disposal and the InteractiveAuto render-mode transition where a Server-rendered circuit is torn down as WebAssembly takes over.
- **Why it's built this way**: passing the localized strings and the error mapper in as parameters keeps this class free of any resource dependency, so each page supplies its own translated text ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) while the flow itself stays identical everywhere. The `errorMessage` delegate is what lets a page choose between a fixed sentence and the API's own wording via `result.LocalizedErrorMessage(L)`, which the parameter doc (lines 50-54) spells out.
- **Where it's used**: sixteen list pages across both apps in current source. ADC calls both methods from Identity's `UserList` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserList.razor.cs:57`, `:77`), from Conference's `EventList`, `SessionList`, `SpeakerList`, `RoomList`, `QuestionList`, `ConferenceCategoryList`, `SponsorList`, `ActivityList`, `PublicEventList`, and `PublicSessionListView`, and from Engagement's `AttendeeSearchPanel` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/AttendeeSearchPanel.razor.cs:60`). Store calls them from `ProductList` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Products/ProductList.razor.cs:38`, `:72`, `:79`), `CategoryList`, `OrderList`, and `CustomerList`. Covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/ListPageActionsTests.cs:20`.
- **Caveats / not-in-source**: `DeleteWithConfirmationAsync` catches only `OperationCanceledException`; any other throw from the caller's `deleteAsync` or `reloadAsync` delegate propagates to the page's own handler, which is not visible from this file.

### IOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.OAuth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/IOAuthUISettings.cs:9` · Level 0 · interface

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:204`, with the override
  instructions in the comment at lines 133-134). The shared login page injects it
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:11`), guards each provider
  button on it (lines 86, 107, 128) and folds the three flags into one `_hasExternalProviders` value
  that decides whether the whole external-login block renders (line 167). MMCA.ADC registers
  [`ConfigurationOAuthUISettings`](#configurationoauthuisettings) on all three heads
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:89`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:38`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:101`).

### PendingAttempt
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.OAuth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/OAuthFlowStateStore.cs:106` · Level 0 · record (private, sealed)

- **What it is**: the private record [OAuthFlowStateStore](#oauthflowstatestore) persists while an OAuth
  redirect is in flight, `State` (the random value sent on the challenge URL) and `StartedAt` (the
  timestamp used to expire an abandoned attempt).
- **Depends on**: nothing beyond the BCL (`string`, `DateTimeOffset`).
- **Where it's used**: written and read only inside
  [OAuthFlowStateStore](#oauthflowstatestore) (`OAuthFlowStateStore.cs:96`, `100`); it never crosses the
  store's own boundary.

### ISessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8` · Level 0 · interface

- **What it is**: a two-method contract for mirroring the client's in-memory tokens into the browser's
  HttpOnly auth cookies, and for clearing them again on logout. Both methods report whether the
  cookie jar was actually updated.
- **Depends on**: nothing first-party. Implemented by
  [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync) and, on a Blazor Server host that enabled
  the same-origin proxy, by [`HandoffSessionCookieSync`](#handoffsessioncookiesync)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:52`);
  consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and by
  [`ServerTokenStorageService`](#servertokenstorageservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:33`).
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
- **Walkthrough**: two members, both returning `Task<bool>`: `true` when the cookie jar was
  updated, `false` when the write failed or could not be attempted (a non-2xx answer, a dropped
  connection, JS interop unavailable).
  `SyncAsync(accessToken, refreshToken)` writes the pair (`ISessionCookieSync.cs:15`) and
  `ClearAsync()` removes it (line 20). The two callers treat the answers differently on purpose.
  A failed sync is surfaced: [`WasmTokenStorageService`](#wasmtokenstorageservice) throws
  `InvalidOperationException` when `SyncAsync` returns `false`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/WasmTokenStorageService.cs:103-106`),
  so [`AuthUIService`](#authuiservice) reports `Auth.TokenStorageUnavailable` instead of a sign-in
  that silently ends at the first access-token expiry, when no cookie exists to refresh from
  (comment at lines 64-67; [`ServerTokenStorageService`](#servertokenstorageservice) does the same at
  `ServerTokenStorageService.cs:131`). A failed clear is discarded (`_ = await
  sessionCookieSync.ClearAsync()`, `WasmTokenStorageService.cs:115`), because sign-out proceeds
  locally whatever the cookie endpoint answered.
- **Why it's built this way**: the shape is the client half of
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html), which decided
  the BFF-style `mmca_auth_access` / `mmca_auth_refresh` HttpOnly cookie pair and the
  `/auth/session/token` hydration endpoint. Keeping it an interface (rather than calling JS interop
  inline from token storage) is what lets a bUnit or unit test drive the storage services with a mock
  and no browser, which `WasmTokenStorageServiceTests` does
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:29`).
- **Where it's used**: registered by the dedicated extension
  `AddClientAuthSessionCookieSync()`, which `TryAddScoped`s
  [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:240-244`); the doc there
  records that both the Blazor Server host and the WebAssembly client call it (lines 165-169).

### SameOriginProxyHeaders
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyHeaders.cs:11` · Level 0 · class (static)

- **What it is**: two constants naming the fixed CSRF request header the same-origin API proxy
  requires on every state-changing request: `CsrfHeaderName = "X-CSRF"`
  (`SameOriginProxyHeaders.cs:14`) and `CsrfHeaderValue = "1"` (line 17).
- **Depends on**: nothing. It lives in `MMCA.Common.UI` rather than `MMCA.Common.UI.Web` so the
  client that stamps the header and the server that checks it share one definition.
- **Concept introduced, a custom header as a CSRF signal.** A cross-site page can make a browser send
  a simple POST carrying the user's cookies, but it cannot add a custom header without a CORS
  preflight. The proxy answers `OPTIONS` itself with no CORS grant and refuses any request whose
  `Origin` or `Sec-Fetch-Site` names another origin, so the header is defense in depth behind that
  origin check; the value carries no secret (`SameOriginProxyHeaders.cs:3-10`).
  - `[Rubric §26, Front-End Security]` assesses cookie-borne credentials against cross-site request
    forgery. Once the bearer moves into an HttpOnly cookie, a header the browser will not attach on a
    cross-site request is what distinguishes the app's own calls.
- **Walkthrough**: two `const string` members and no behavior. Being `const`, both values are baked
  into each caller at compile time.
- **Why it's built this way**: one shared type instead of a literal per call site keeps the stamp
  and the check from drifting apart. The proxy design is
  [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html).
- **Where it's used**: stamped by [`SameOriginProxyRequestHandler`](#sameoriginproxyrequesthandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyRequestHandler.cs:19-20`)
  and by [`NotificationHubService`](#notificationhubservice) on the SignalR connection options
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:363`);
  checked by [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint) in `HasCsrfHeader`, which
  demands exactly one value equal to `CsrfHeaderValue`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:110-113`);
  stripped before forwarding by [`SameOriginProxyTransformer`](#sameoriginproxytransformer)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:61`).
  Covered by `SameOriginProxyClientTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/SameOriginProxyClientTests.cs:27`).

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:239`), whose `switch`
  covers all four null combinations and falls back to a localized "unknown device" string
  (lines 183-189). Pinned by `UserAgentSummaryTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/UserAgentSummaryTests.cs:13`).
  The page itself is the UI half of
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html).

### ConfigurationOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.OAuth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/ConfigurationOAuthUISettings.cs:13` · Level 1 · class (sealed)

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
  - `[Rubric §15, Best Practices & Code Quality]` assesses duplication. One class, one rule, three providers.
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
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:89`), the WASM client
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:38`) and MAUI
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:101`, whose comment at line 78 explains that
  the MAUI registration goes before `AddUIShared` because that call `TryAdd`s the default). The
  server head also projects the resolved flags to the WASM client through its `/client-config`
  endpoint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:265`).

### DefaultOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.OAuth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/DefaultOAuthUISettings.cs:7` · Level 1 · class (internal, sealed)

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
  `TryAddSingleton` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:204`), so
  a host that registers first keeps its own, and a host that registers afterwards with `AddSingleton`
  wins the resolution.
- **Where it's used**: resolved as [`IOAuthUISettings`](#ioauthuisettings) in every host that has not
  registered its own, which today is all of MMCA.Store's UI heads and MMCA.Helpdesk.

### OAuthFlowStateStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.OAuth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/OAuthFlowStateStore.cs:20` · Level 1 · class (sealed)

- **What it is**: binds an OAuth authorize-redirect to the client that started it, by minting a random
  `state` value, persisting it with a start time, and later checking that the value the provider's
  callback returns matches. It is the anti-CSRF half of the flow described by ADR-036.
- **Depends on**: `ILocalCacheStore` (device-local storage, injected, `OAuthFlowStateStore.cs:20`) for
  persistence, `TimeProvider` (injected, defaulted to `TimeProvider.System`, `OAuthFlowStateStore.cs:20`,
  `31`) for the expiry check, `System.Security.Cryptography.RandomNumberGenerator` to mint the state
  value, and its own private record [PendingAttempt](#pendingattempt) as the stored shape.
- **Concept introduced, device-local state binding for a redirect-based flow.** A browser or MAUI OAuth
  challenge leaves the app entirely and comes back on a different navigation, so nothing in memory
  survives the round trip; the only thing that can prove the callback belongs to the request this
  client made is a value written to durable storage before the redirect and checked after it.
  `[Rubric §11, Security]` assesses this exact class of defense: `BeginAsync` mints the value with
  `RandomNumberGenerator.GetHexString(32, lowercase: true)` (`OAuthFlowStateStore.cs:58`), a
  cryptographically strong source, not `Guid.NewGuid()` or a counter.
- **Walkthrough**:
  - `StorageKey = "auth.oauth-flow"` (`OAuthFlowStateStore.cs:23`) and `AttemptLifetime = 10` minutes
    (`OAuthFlowStateStore.cs:29`, "comfortably longer than a provider round trip and far shorter than a
    session, so an abandoned attempt cannot be revived days later").
  - `IsEnforced` (`OAuthFlowStateStore.cs:39`) reports `store.IsAvailable`: `false` only on a host that
    registered neither the browser nor the native local-storage capability, in which case the caller
    keeps its prior behavior because nothing durable can be written across the redirect.
  - `BeginAsync` (`OAuthFlowStateStore.cs:51`) returns `null` immediately when storage is unavailable
    (`53-56`), otherwise mints the state, stores a `PendingAttempt` under `StorageKey` (`58-61`), then
    reads the attempt back and compares its state ordinally (`63-65`). The read-back exists because the
    browser store swallows a failed write; if the attempt was not kept (storage full, site data blocked,
    private mode) it throws `InvalidOperationException` (`66-69`, documented at `46-50`), so the failure
    surfaces before the redirect for the page to explain rather than one redirect later as an
    unexplained refusal. On success it returns the state for the caller to append to the challenge URL
    (`72`).
  - `TryCompleteAsync` (`OAuthFlowStateStore.cs:84`) returns `true` unconditionally when storage is
    unavailable (`86-89`, matching `BeginAsync`'s no-op), otherwise reads and unconditionally removes the
    pending attempt (`91-92`, "removed either way, so a value is good for exactly one completion"),
    and fails if there was none or it expired (`94-97`). When a pending attempt exists, it accepts only
    a non-empty `returnedState` that matches exactly, ordinal comparison (`102-103`). An absent or empty
    value is refused: every legitimate flow round-trips the state, and accepting an omitted parameter
    would let a pasted link bypass the binding (comment at `99-101`, doc at `76-80`).
- **Why it's built this way**: ADR-036 (`Website/docs-src/adr/036-external-oauth-login.md`) is the OAuth
  design this binds into; the single-use, time-boxed local record, together with refusing a completion
  that omits the state, is what keeps a replayed, stale, or forged callback from being accepted.
- **Where it's used**: constructed inside
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs` for
  the native OAuth callback path, and registered in
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:174` (`TryAddScoped`). Pinned by
  `OAuthFlowStateStoreTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/OAuthFlowStateStoreTests.cs`).

### AuthDelegatingHandler
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:14` · Level 1 · class (sealed)

- **What it is**: the `DelegatingHandler` that attaches the stored JWT as a `Bearer` header on every
  outgoing API request, so no UI service ever sets an `Authorization` header by hand. One request can
  opt out through the `SkipBearer` request option.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (its only constructor parameter);
  externals `System.Net.Http.Headers.AuthenticationHeaderValue` and `DelegatingHandler`.
- **Concept introduced, the HTTP message-handler pipeline.** `HttpClient` composes handlers into a
  chain, each free to inspect or mutate a request before passing it to the next. Registering this one
  on the named `"APIClient"` client means auth is applied once, at the transport, for every typed
  service built on top of it.
  - `[Rubric §6, CQRS & Event-Driven Design]` assesses whether concerns like auth are centralized rather
    than repeated per call. This is the client-side twin of the server's middleware pipeline: one
    registration covers every request.
  - `[Rubric §1, SOLID]` shows in the single responsibility. The handler knows nothing about login,
    refresh, or expiry; it asks storage for whatever token exists and moves on.
- **Walkthrough**:
  - `SkipBearer` (`AuthDelegatingHandler.cs:22`) is a public static
    `HttpRequestOptionsKey<bool>` named `"MMCA.Common.UI.Auth.SkipBearer"`. The token refresh POST
    sets it: that endpoint is anonymous, and reading token storage from inside a refresh would
    re-enter the very acquisition that is waiting for the request to complete (doc at lines 17-21).
  - `SendAsync(request, cancellationToken)` (`AuthDelegatingHandler.cs:25`) first checks the option:
    when it is set to `true` the request passes straight to `base.SendAsync` without touching token
    storage at all (lines 29-32). A request that already carries an `Authorization` header also gets no
    stored token (the `Authorization is null` check at line 34): the forced-refresh replay sets the token
    it just acquired, and replacing it with the stored one would resend the token the server just
    rejected. Otherwise it awaits `GetAccessTokenAsync()` (line 36), and only when the result is
    non-blank sets
    `request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token)` (lines 37-40)
    before delegating to `base.SendAsync` (line 43). An anonymous call therefore goes out with no
    header at all rather than an empty one, which matters for the endpoints that are deliberately
    anonymous.
  Note the freshness work happens inside the token service: by the time this handler sees a token,
  a stale one has already been re-acquired.
- **Why it's built this way**: a handler rather than a base-class helper, because the pipeline applies
  to everything the named client sends, including calls made by code that never inherits from a
  framework base. It is registered `AddTransient`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:114`), the lifetime
  `AddHttpMessageHandler` expects.
- **Where it's used**: added to the `"APIClient"` pipeline alongside the culture handler
  (`DependencyInjection.cs:146-147`, with the intent stated at lines 75-76). One documented bypass
  exists: [`AuthenticatedServiceBase`](#authenticatedservicebase) builds a client with the token set
  directly for the cases where the pipeline is not in play
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:55`). The
  `SkipBearer` option is set by [`DirectApiTokenRefresher`](#directapitokenrefresher) on its refresh
  request (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:61`).
  On a WebAssembly client of a host running the same-origin proxy,
  [`SameOriginProxyRequestHandler`](#sameoriginproxyrequesthandler) sits inside this handler and
  strips whatever header it attached (`DependencyInjection.cs:148-155`). Covered
  by `AuthDelegatingHandlerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthDelegatingHandlerTests.cs:16`)
  and by a DI resolution test that exists because the pipeline must be able to construct it
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/ApiClientRegistrationTests.cs:29`).

### JsFetchSessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:13` · Level 1 · class (sealed)

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
  (`JsFetchSessionCookieSync.cs:6-8`).
  - `[Rubric §26, Front-End Security]` again: the tokens transit JS only for this one same-origin POST
    and are never persisted anywhere JS can read afterwards.
  - `[Rubric §29, Resilience & Business Continuity]` assesses degradation. Every interop failure is
    caught and turned into a `false` answer, so a prerender pass or a disconnected circuit cannot throw
    out of a cookie write, yet the caller still learns the write did not happen.
- **Walkthrough**:
  - `IsInteropUnavailable(ex)` (`JsFetchSessionCookieSync.cs:15-16`) is the shared exception filter,
    naming the four types that mean "there is no live JS runtime right now":
    `InvalidOperationException`, `JSDisconnectedException`, `JSException` and
    `OperationCanceledException`.
  - `SyncAsync(accessToken, refreshToken)` (line 19) returns
    `InvokeAsync<bool>("mmcaAuthCookie.set", accessToken, refreshToken)` (line 23): the script itself
    reports whether the endpoint answered 2xx. An interop failure returns `false`, the comment noting
    nothing was written (lines 25-29).
  - `ClearAsync()` (line 33) returns `InvokeAsync<bool>("mmcaAuthCookie.clear")` (line 37) under the
    same filter, and an interop failure again returns `false` because the cookie was not cleared by
    this call (lines 39-43). The class doc records that the script tries the clear twice
    (`JsFetchSessionCookieSync.cs:9-11`).
- **Why it's built this way**: a shared static filter rather than two duplicated `when` clauses keeps
  the definition of "interop unavailable" in one place. Reporting rather than swallowing silently is
  what lets the token storage services refuse a sign-in whose cookie never landed (see
  [`ISessionCookieSync`](#isessioncookiesync)). The cookie contract itself
  belongs to [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: `TryAddScoped` behind [`ISessionCookieSync`](#isessioncookiesync) by
  `AddClientAuthSessionCookieSync()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:242`); consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and
  [`ServerTokenStorageService`](#servertokenstorageservice).
- **Caveats / not-in-source**: the `mmcaAuthCookie.set` / `.clear` JS implementations live in
  `mmca-auth-cookie.js`, outside this unit; only the C# side is described here.

### JwtAuthenticationStateProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:13` · Level 1 · class (sealed)

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
    (`JwtAuthenticationStateProvider.cs:15-16`). Because a `ClaimsIdentity` with no authentication
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:150,199,207,354`),
  so a host that registered a different provider still works.
- **Where it's used**: registered against `AuthenticationStateProvider` on every head
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:116`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:46`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:98`). Covered by
  `JwtAuthenticationStateProviderTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/JwtAuthenticationStateProviderTests.cs:14`);
  `AuthUIServiceTests` constructs a real one rather than a double, precisely because the type test
  above would not match a mock
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthUIServiceTests.cs:67-69`).

### SameOriginProxyRequestHandler
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyRequestHandler.cs:11` · Level 1 · class (internal, sealed)

- **What it is**: the innermost handler of the `"APIClient"` pipeline on a WebAssembly client whose
  host runs the same-origin API proxy. It removes any `Authorization` header and stamps the proxy's
  CSRF header on every request (`SameOriginProxyRequestHandler.cs:3-10`).
- **Depends on**: [`SameOriginProxyHeaders`](#sameoriginproxyheaders) for the header name and value;
  external `DelegatingHandler`.
- **Concept introduced, the browser holds no usable bearer.** Behind the proxy the client only ever
  holds a claims-only token; the proxy attaches the real bearer server-side from the HttpOnly session
  cookie. Any `Authorization` header the outer handlers (such as
  [`AuthDelegatingHandler`](#authdelegatinghandler)) or a service's `DefaultRequestHeaders` attached is
  therefore noise at best, so this handler clears it rather than trusting every caller to know.
  - `[Rubric §26, Front-End Security]` assesses whether a usable credential is reachable from browser
    code. Here it is not, and the transport enforces that for every request.
- **Walkthrough**: one override. `SendAsync(request, cancellationToken)`
  (`SameOriginProxyRequestHandler.cs:14`) guards `request` with `ArgumentNullException.ThrowIfNull`
  (line 16), sets `request.Headers.Authorization = null` (line 18), removes any existing CSRF header
  and adds exactly one with `TryAddWithoutValidation` (lines 19-20), then delegates to
  `base.SendAsync` (line 21). Removing first guarantees a single value, which is what the proxy's
  check demands.
- **Why it's built this way**: registering it innermost means it sees the request after every other
  handler and service has had its say, so one place decides what reaches the proxy. It is
  registered only when `Api:SameOriginApiEndpoint` is configured, so every other client (Blazor
  Server, MAUI, a WebAssembly client of a host that did not opt in) keeps its pipeline unchanged
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:116-121`). The proxy design is
  [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html).
- **Where it's used**: `AddTransient` and `AddHttpMessageHandler` inside `AddUIShared()` behind the
  `usesSameOriginProxy` check (`DependencyInjection.cs:150-155`), after the auth and culture handlers
  (lines 124-125). The proxy side that reads the CSRF header is
  [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint).

### IEmailConfirmationUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IEmailConfirmationUIService.cs:21` · Level 3 · interface

- **What it is**: the client-side contract for the email-confirmation flow: redeeming a confirmation
  link's token, and asking for a fresh one when the first has expired or was never received.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result); externals: BCL (`Task`,
  `CancellationToken`, `string`).
- **Concept reinforced, the bespoke UI service contract (introduced at [`IAuthUIService`](#iauthuiservice)).**
  `[Rubric §18, UI Architecture & Component Design]` and `[Rubric §26, Front-End Security]` (assesses that
  a resend cannot be used to enumerate registered addresses). Two members, both returning `Result` so a
  page branches on the outcome instead of catching. `ResendEmailConfirmationAsync`'s own doc comment
  states the anti-enumeration rule directly, that the endpoint answers 202 whether or not the address
  holds an account, so a success means "accepted", never "this address exists"
  (`IEmailConfirmationUIService.cs:31-33`). The class-level remarks also record why there is no retry:
  the token is single-use and the resend spends a per-address request budget, so a repeat is a second
  request rather than a replayed response (`IEmailConfirmationUIService.cs:16-19`).
- **Walkthrough**: two methods.
  - `ConfirmEmailAsync(string email, string token, CancellationToken cancellationToken = default)`
    (`IEmailConfirmationUIService.cs:28`) redeems a single-use token via `POST auth/confirm-email`; the
    doc comment records that the endpoint returns the same generic rejection for every bad token
    (`IEmailConfirmationUIService.cs:23-27`).
  - `ResendEmailConfirmationAsync(string email, CancellationToken cancellationToken = default)`
    (`IEmailConfirmationUIService.cs:38`) requests a fresh link via `POST auth/send-email-confirmation`,
    always reported as success at this layer regardless of whether the address is known.
- **Why it's built this way**: a narrow interface here, rather than the generic
  [`IEntityService<,>`](#ientityservicetentitydto-tidentifiertype), matches the same reasoning
  [`IAuthUIService`](#iauthuiservice) documents: confirming an email is not a CRUD operation on a
  resource with an identity, so it gets its own contract instead of being bent to fit one
  (`[Rubric §14, Testability]`).
- **Where it's used**: implemented by [`EmailConfirmationUIService`](#emailconfirmationuiservice);
  injected by `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ConfirmEmail.razor.cs` and by
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Pages/ConfirmEmailPageTestsBase.cs`; registered in
  `AddUIShared()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`).

### EmailConfirmationUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/EmailConfirmationUIService.cs:23` · Level 4 · class (sealed)

- **What it is**: the [`IEmailConfirmationUIService`](#iemailconfirmationuiservice) implementation. It
  posts to the two confirmation endpoints and translates the response through the shared
  [`HttpResultExecutor`](#httpresultexecutor) / `ProblemDetailsResultReader` path used across the auth
  services.
- **Depends on**: [`IEmailConfirmationUIService`](#iemailconfirmationuiservice) (the contract it
  implements); `IHttpClientFactory` (its only constructor parameter, `EmailConfirmationUIService.cs:23`);
  [`HttpResultExecutor`](#httpresultexecutor) and `ProblemDetailsResultReader`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs`) for the transport and
  response-translation work.
- **Concept reinforced, one shared execution path for every anonymous auth POST.** Both members funnel
  through the private `PostOnceAsync<TRequest>` helper, so the retry policy and response translation are
  written once rather than duplicated per endpoint.
  - `[Rubric §15, Best Practices & Code Quality]` assesses duplication; the two public methods are each a
    single expression forwarding to the shared helper (`EmailConfirmationUIService.cs:31-35`).
  - `[Rubric §29, Resilience & Business Continuity]` is answered by what the helper deliberately does
    not do: no retry, because a repeat here is a second request (a spent token, a second email), never a
    replayed response (`EmailConfirmationUIService.cs:41-42`).
- **Walkthrough**:
  - `ApiClientName = "APIClient"` (`EmailConfirmationUIService.cs:25`) names the shared named client.
  - `ConfirmEmailAsync` (line 28) posts a `ConfirmEmailRequest` to `auth/confirm-email`.
  - `ResendEmailConfirmationAsync` (line 32) posts a `SendEmailConfirmationRequest` to
    `auth/send-email-confirmation`.
  - `PostOnceAsync<TRequest>(relativeUrl, body, cancellationToken)` (line 35) creates a fresh
    `HttpClient` from the factory (line 39), posts the body with `PostAsJsonAsync` (lines 43-44) and
    reads the result with `ProblemDetailsResultReader.ReadAsync` (line 46), all wrapped in
    `HttpResultExecutor.ExecuteAsync` for the shared transport-fault translation.
- **Why it's built this way**: a fresh `HttpClient` per call (rather than a stored field) matches how the
  other anonymous auth services in this package are built, since the client is cheap to create from the
  factory and this service holds no other per-call state.
- **Where it's used**: covered by `EmailConfirmationUIServiceTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/EmailConfirmationUIServiceTests.cs`);
  registered against [`IEmailConfirmationUIService`](#iemailconfirmationuiservice) in
  `AddUIShared()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`).

### IAuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:18` · Level 5 · interface

- **What it is**: the single client-side authentication contract: login, register, OAuth code
  exchange, logout, refresh, the three password flows, the signed-in-devices list with revoke, and
  sign-out of every device. Every auth page in the framework talks to this and nothing else.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form from
  `MMCA.Common.Shared.Abstractions`; the `MMCA.Common.Shared.Auth` contracts
  [`LoginRequest`](group-08-auth.md#loginrequest),
  [`RegisterRequest`](group-08-auth.md#registerrequest),
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and
  [`RefreshSessionSummaryResponse`](group-08-auth.md#refreshsessionsummaryresponse); and
  [`ErrorType`](group-01-result-error-handling.md#errortype) for the failure kinds it documents.
  Implemented by [`AuthUIService`](#authuiservice).
- **Concept introduced, the failure travels with the call.** The interface doc states the rule
  (`IAuthUIService.cs:11-16`): every call that talks to the API returns a
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
    (`IAuthUIService.cs:21,24`).
  - `ExchangeOAuthCodeAsync(code, ct)` (line 31) trades a single-use completion code carried in the
    redirect URL for the token pair through `auth/oauth/exchange`, stores the tokens and notifies auth
    state; the doc's closing sentence names the reason for the indirection, keeping tokens out of the
    address bar (lines 26-30).
  - `LogoutAsync()` (line 39) is the deliberate no-`Result` member: it revokes the server-side refresh
    sessions and clears local storage, and returns nothing because the local sign-out happens whatever
    the server answered. A user who asked to leave must never be kept signed in by a failed network
    call (lines 33-38).
  - `TryRefreshTokenAsync(ct)` (line 50) is the deliberate `bool` member: it makes no API call of its
    own, since the host's [`ITokenRefresher`](#itokenrefresher) owns the exchange, and its two states
    ("session still live", "session gone") are not errors to render. A `false` is not always a
    sign-out: when an `ISessionAwareTokenRefresher` reports the attempt as transient
    (`TokenAcquisition.IsUnavailable`), the stored credential is kept and a later call tries again
    (lines 41-49).
  - `ChangePasswordAsync(currentPassword, newPassword, ct)` (line 53) hits `auth/password`.
  - `RequestPasswordResetAsync(email, ct)` (line 60) hits the anonymous `auth/forgot-password`. The
    doc pins the semantics: the endpoint answers 202 for every well-formed address as an
    anti-enumeration measure, so a success means "accepted", never "an account exists"
    (lines 55-59).
  - `ResetPasswordAsync(email, token, newPassword, ct)` (line 67) completes the reset via the
    anonymous `auth/reset-password`; an invalid, expired or already-consumed token comes back as a
    failure carrying the server's generic message (lines 62-66).
  - `GetSessionsAsync(ct)` (line 75) returns
    `Result<IReadOnlyList<RefreshSessionSummaryResponse>>` from `auth/my-sessions`, newest first, and
    documents that exactly one row can carry `IsCurrent`, resolved server-side from the access token's
    `sid` claim (lines 69-74).
  - `RevokeSessionAsync(sessionId, ct)` (line 84) signs one device out via `auth/revoke/{sessionId}`;
    another account's session id (or a nonexistent one) answers 404 and arrives as an
    [`ErrorType`](group-01-result-error-handling.md#errortype)`.NotFound` failure, and revoking an
    already-revoked session answers the same 404 (lines 77-83).
  - `RevokeAllSessionsAsync(ct)` (line 94) signs out of every device via `auth/revoke` and, unlike
    `LogoutAsync`, returns the server's answer as a `Result`. A failed revoke is reported rather than
    hidden, and the local session is left in place so the caller can say so and let the user retry;
    on success it also performs the same local sign-out `LogoutAsync` does (lines 86-93). The pair
    is the clearest statement of the return-shape rule: the same endpoint, two members, because "leave
    this device" must never fail while "end every session" must never claim success it did not get.
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
  `AddUIShared()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:162`, the
  comment at line 108 noting `TryAdd` prevents duplicate registration when several hosts call in);
  injected by the shipped auth pages, including `Login`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor`) and
  [`Sessions`](#sessions), whose sign-out-everywhere action calls `RevokeAllSessionsAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:191`).

### AuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:44` · Level 6 · class (sealed)

- **What it is**: the one client-side service that owns a user's session on a Blazor or MAUI head. It
  calls the WebAPI `auth/*` endpoints (sign in, register, OAuth code exchange, change password, forgot
  and reset password, list and revoke devices, sign out), persists the returned token pair, and tells
  Blazor's authentication state that something changed, so `AuthorizeView` and `[Authorize]` routes
  react without a page reload. Every method that talks to the API hands back a
  [Result](group-01-result-error-handling.md#result) carrying the server's own error text, so no page
  has to interpret an `HttpResponseMessage`.
- **Depends on**: first-party
  [IAuthUIService](#iauthuiservice) (the contract it implements, `AuthUIService.cs:51`),
  [ITokenStorageService](#itokenstorageservice) (token persistence, injected at `AuthUIService.cs:46`),
  [ITokenRefresher](#itokenrefresher) (the host-specific renewal path, `AuthUIService.cs:47`),
  [JwtAuthenticationStateProvider](#jwtauthenticationstateprovider) (injected as the framework
  `AuthenticationStateProvider` base type at `AuthUIService.cs:48` and pattern-matched back down),
  [IPushRegistrationService](group-26-device-capability-layer.md#ipushregistrationservice) (native push
  cleanup, `AuthUIService.cs:49`),
  [IUiReadCache](#iuireadcache) (optional, defaulted to `null` at `AuthUIService.cs:50`),
  `ILocalCacheStore` (optional device-local document cache, defaulted to `null`,
  `AuthUIService.cs:51`, wiped on sign-out alongside the read cache),
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
  `[Rubric §11, Security]` assesses the end-to-end auth design. There are two sign-outs with opposite
  failure policies. `LogoutAsync` is deliberately **local-first**: the remote revoke is best effort, and
  both the server call and the local clear are wrapped so a dropped connection can never strand a user
  inside a session they asked to leave (`AuthUIService.cs:88-101`, `109-124`, `361-399`). `RevokeAllSessionsAsync`
  is **server-first**: it reports a failed revoke and only signs out locally once the server confirmed,
  so "signed out everywhere" is never claimed when it did not happen (`AuthUIService.cs:127-148`).
  `[Rubric §19, State Management]` assesses who owns mutable client state and when it is invalidated:
  this service is the single writer of auth state, and it is also the thing that empties the read cache,
  because on WebAssembly and MAUI the DI scope is the app lifetime, so cached rows would otherwise
  outlive the account that fetched them (`AuthUIService.cs:33-37`, `390-394`).
  `[Rubric §18, UI Architecture]` sees the same shape the entity services use, a typed service over the
  named `"APIClient"` returning `Result`, so pages render failures with
  [ResultUiExtensions](#resultuiextensions) instead of catching exceptions.
  `[Rubric §14, Testability]` is served by taking all five collaborators through the primary constructor
  with no statics: [AuthUIServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup) drives the
  whole class through a stub `HttpMessageHandler`.
- **Walkthrough**
  - Two public error codes head the class. `TokenStorageUnavailableCode = "Auth.TokenStorageUnavailable"`
    (`AuthUIService.cs:57`) is reported when authentication succeeded but the tokens could not be written
    because JS interop was unavailable (SSR prerender, or a render-mode transition), and
    `MissingAccessTokenCode = "Auth.MissingAccessToken"` (`AuthUIService.cs:63`) covers a 2xx whose body
    carried no access token, which means the response shape drifted. Both are `const string`, so tests
    and pages branch on them without duplicating literals. The private `ApiClientName = "APIClient"`
    (`AuthUIService.cs:65`) names the shared client registered in
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:124`.
  - `LoginAsync` and `RegisterAsync` are one-liners over the private `AuthenticateAsync`, differing only
    in the relative URL, `auth/login` and `auth/register` (`AuthUIService.cs:68-73`).
  - `ExchangeOAuthCodeAsync` (`AuthUIService.cs:76`) guards the code client-side first: a blank code
    returns `Error.Validation("Auth.OAuth.MissingCode", ...)` without a round trip
    (`AuthUIService.cs:78-82`), then it posts an
    [OAuthCodeExchangeRequest](group-08-auth.md#oauthcodeexchangerequest) to `auth/oauth/exchange`
    (`AuthUIService.cs:84`). The single-use code arrives in the redirect URL, which is what keeps the
    tokens themselves out of the address bar (ADR-036,
    `Website/docs-src/adr/036-external-oauth-login.md`).
  - `AuthenticateAsync` (`AuthUIService.cs:294`) is the shared body of all three. It posts the credential
    through [HttpResultExecutor](#httpresultexecutor) and reads the response with
    `ProblemDetailsResultReader.ReadAsync<AuthenticationResponse>` (`AuthUIService.cs:299-306`), returns
    early on failure (`308-311`), then checks the access token is actually present and fails with
    `MissingAccessTokenCode` if it is not (`313-318`). Only then does it call
    `tokenStorageService.SetTokensAsync` inside a `try` that converts an `InvalidOperationException` into
    a `TokenStorageUnavailableCode` failure carrying the exception message as detail (`320-345`). The
    point of that branch is that valid credentials nothing can hold are a failure, not a silent no-op;
    on browser hosts it also fires when the HttpOnly cookie write reports failure, because the token
    storage services throw on a `false` from [ISessionCookieSync](#isessioncookiesync). Before returning
    that failure it cleans up after itself (`326-339`): the server already minted a session and the
    storage took the access token in memory before the cookie write failed, so it revokes the session
    through `TryRevokeAsync(authentication.AccessToken, ...)` (`331`) and then clears the stored tokens
    (`334`, swallowing a second `InvalidOperationException`), or the API client would behave signed in
    behind a page that reported failure.
    Finally it pattern-matches the injected `AuthenticationStateProvider` down to
    [JwtAuthenticationStateProvider](#jwtauthenticationstateprovider) and calls
    `NotifyUserAuthentication(accessToken)` (`348-351`, and
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:60`).
    The `is` test rather than a cast is what lets a host register a different provider without breaking
    sign-in.
  - `LogoutAsync` (`AuthUIService.cs:88`) runs three steps, each isolated so a failure cannot stop the
    next. First the private `UnregisterPushAsync()` (call at line 90). Second, if a token can be read
    (`92-93`), it calls the private `TryRevokeAsync(accessToken, CancellationToken.None)` (line 98),
    which is the shared best-effort revoke: it creates an APIClient, sets the Bearer header by hand and
    posts `auth/revoke` inside a bare `catch` that ignores every failure (`109-124`). The helper is
    shared with the login path that cannot store the session it was just issued (see
    `AuthenticateAsync`), so the two revokes cannot drift. Third, the private `SignOutLocallyAsync()`
    (line 101).
  - `RevokeAllSessionsAsync` (`AuthUIService.cs:127`) posts the same `auth/revoke` through
    [HttpResultExecutor](#httpresultexecutor) on an authenticated client, reading it with the
    non-generic reader (`129-137`). Only when the result is a success does it run `UnregisterPushAsync()`
    then `SignOutLocallyAsync()`, in the same order as `LogoutAsync` so the push unregister still holds a
    valid access token (`139-145`); either way it returns the server's `Result` (line 147). A failure
    leaves the local session intact for the caller to report and retry.
  - `TryRefreshTokenAsync` (`AuthUIService.cs:151`) makes no HTTP call of its own. It asks the injected
    `tokenRefresher` for a token, through one of two paths (`162-171`). When the refresher is an
    `ISessionAwareTokenRefresher` (pattern-matched at line 162) it calls `TryAcquireAccessTokenAsync`
    and, if the answer `IsUnavailable` (a transient outcome that says nothing about the session, for
    the direct refresher a 409 refresh-superseded), returns `false` immediately (`164-167`) without
    clearing anything: the stored credential is kept for the next attempt, because clearing it would
    stop this client from ever presenting a token someone else rotated, which is what lets the server's
    reuse detection (BR-206) revoke the other holder's session (comment at `156-160`). Any other
    refresher falls back to `AcquireAccessTokenAsync` (line 170). Browser hosts renew through the
    same-origin cookie proxy so the refresh token never reaches JS
    ([SameOriginProxyTokenRefresher](#sameoriginproxytokenrefresher)) and MAUI renews straight from
    secure storage ([DirectApiTokenRefresher](#directapitokenrefresher)). A null or blank answer means
    the session is gone, which this method treats exactly like a sign-out: clear tokens, clear the read
    cache and the local cache (also through `ClearLocalCacheAsync()`), notify logout, return `false`
    (`173-199`). It spells these steps out inline rather than calling `SignOutLocallyAsync()`. A token
    that comes back is published with `NotifyUserAuthentication` and answered with `true` (`201-206`).
    The `bool` return is the honest type here, because neither outcome is an error a page would render
    (`IAuthUIService.cs:41-50`).
  - The password trio all wrap [HttpResultExecutor](#httpresultexecutor).
    `ChangePasswordAsync` (`210`) is the only one that authenticates: it builds a
    [ChangePasswordRequest](group-08-auth.md#changepasswordrequest) and `PUT`s it to `auth/password`
    (`217-221`). `RequestPasswordResetAsync` (`226`) and `ResetPasswordAsync` (`243`) deliberately use
    the plain factory client with no Bearer header (`232`, `251`), because a reset must not be bound to
    whatever session happens to be open (comment at `230-231`). The comment at `236-237` records the
    contract that matters: `auth/forgot-password` answers 202 for every well-formed address, so a
    success never means "this account exists".
  - The two session methods back the devices page. `GetSessionsAsync` (`261`) `GET`s `auth/my-sessions`
    and reads it with the **generic** reader into `IReadOnlyList<RefreshSessionSummaryResponse>`
    (`269-270`). `RevokeSessionAsync` (`275`) posts `auth/revoke/{sessionId}` and reads it with the
    **non-generic** reader (`282-285`), because that endpoint answers 204 and
    [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader)'s generic overload turns an
    empty 2xx body into an `EmptyResponseCode` failure
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:305-310`). Picking
    the wrong overload there would turn every successful revoke into an error.
  - Private helpers close the class: `TryRevokeAsync` (`109`, described under `LogoutAsync`) and five
    more. `UnregisterPushAsync` (`361`) calls
    `pushRegistration.UnregisterAsync()` inside a bare `catch` (`363-372`): the Devices DELETE is
    authenticated, so it has to happen while the access token is still valid, and it is a no-op on web
    heads (ADR-044, `Website/docs-src/adr/044-native-push-delivery.md`). `SignOutLocallyAsync` (`379`)
    is the local half of every sign-out: `tokenStorageService.ClearTokensAsync()` under
    `catch (InvalidOperationException)` for the interop-unavailable case (`381-388`), then
    `readCache?.Clear()` and `ClearLocalCacheAsync()` (`393-394`), then `NotifyUserLogout()` (`396-399`,
    and `.../Services/Auth/JwtAuthenticationStateProvider.cs:71`). The two
    `#pragma warning disable CA1031` blocks (`118-120` in `TryRevokeAsync`, `367-369` in
    `UnregisterPushAsync`) are deliberate and annotated in place: catching everything is the correct
    policy for a best-effort cleanup step. `CreateAuthenticatedClientAsync` (`408`) creates the APIClient
    and sets `DefaultRequestHeaders.Authorization` from the stored token; its doc comment states plainly
    that it mirrors [AuthenticatedServiceBase](#authenticatedservicebase) and cannot inherit it, because
    this is not an entity service and takes a different dependency set (`402-407`).
    `ReadAccessTokenAsync` (`421`) swallows `InvalidOperationException` from the store and returns `null`,
    so an SSR prerender proceeds tokenless and lets the API answer 401 like any other failure
    (`427-432`). `ClearLocalCacheAsync` (`AuthUIService.cs:438`) no-ops when `localCache` is `null`,
    otherwise calls `localCache.ClearAsync()` inside a `catch (InvalidOperationException)` for the same
    JS-interop-gone case the token clear guards against (`445-452`), so a device-local offline snapshot
    never survives to be read by the next account on the same device.
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
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:162`, so every host that adds
  the shared UI gets it. Consumers inside the shared UI are the auth pages
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:204`,
  `Pages/Auth/Register.razor:161`, `Pages/Auth/OAuthComplete.razor:65`,
  `Pages/Auth/ForgotPassword.razor:81`, `Pages/Auth/ResetPassword.razor:122`), the devices page
  [Sessions](#sessions) (`Pages/Auth/Sessions.razor.cs:79`, `119`, `165`, `191`), and both shells
  (`Layout/MainLayout.razor:108`, `Layout/NavMenu.razor:185`, which call `LogoutAsync`). Downstream, the
  shared [ChangePasswordCard](#changepasswordcard) calls `ChangePasswordAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/ChangePasswordCard.razor.cs:114`),
  and the consumer profile pages ([Profile](group-24-identity-module.md#profile)) host that card
  rather than calling the service themselves. Note
  how `ForgotPassword.razor` consumes it: it discards the `Result` and swallows exceptions
  (`Pages/Auth/ForgotPassword.razor:75-92`), because the page must look identical whether or not the
  address exists. The component gallery substitutes
  [NoOpAuthUIService](group-28-testing-infrastructure.md#noopauthuiservice), and
  [AuthUIServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup)
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthUIServiceTests.cs:37`) pins the
  behavior end to end, including the storage-unavailable and missing-token branches
  (`AuthUIServiceTests.cs:216`, `229`).
- **Caveats**: `TryRefreshTokenAsync` has no production call site in the workspace; the only callers are
  [AuthUIServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup) (`AuthUIServiceTests.cs:508`,
  `454`) and the gallery stub. Renewal in a running app happens further down, inside the storage service
  and the refreshers, so this method is a public entry point that nothing currently enters. The
  `auth/revoke` call in `LogoutAsync` is described in the comment as "fire-and-forget" (lines 94-96) but
  is in fact awaited (`await TryRevokeAsync(...)`, `AuthUIService.cs:98`); the accurate reading is
  best-effort-and-ignored, and on a bad network the awaited call can add its full timeout to a
  sign-out. That same call passes `CancellationToken.None`, because `LogoutAsync` takes none by design
  (`IAuthUIService.cs:39`). Finally,
  `CreateAuthenticatedClientAsync` sets a `DefaultRequestHeaders` Bearer while
  [AuthDelegatingHandler](#authdelegatinghandler) is already attaching one to every APIClient request
  from the same store (`DependencyInjection.cs:146`, `Services/Auth/AuthDelegatingHandler.cs:34-40`), so
  the header is computed twice per authenticated call; the handler now skips its own lookup when the
  request already carries an `Authorization` header (`AuthDelegatingHandler.cs:34`), so the stored
  token is read once here and the handler leaves that header alone, which is redundancy avoided
  rather than a defect. Behind the same-origin proxy both are then stripped by
  [SameOriginProxyRequestHandler](#sameoriginproxyrequesthandler).

### ISecureTokenStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISecureTokenStore.cs:16` · Level 0 · interface

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:105`, with the rationale
  at lines 66-77). Injected into [`DirectApiTokenRefresher`](#directapitokenrefresher)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:27`) and
  mocked directly in `DirectApiTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:32`).
- **Caveats / not-in-source**: no browser host implements it. Resolving it on a Blazor Server or WASM
  head is a DI failure by design, not an oversight.

### ITokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ITokenRefresher.cs:17` · Level 0 · interface

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
  doc enumerates both (`ITokenRefresher.cs:4-15`): on the browser the refresh token lives in an
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
  (`ITokenRefresher.cs:24`). The nullable return is the whole error model: `null` means no valid
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

### TokenAcquisition
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/TokenAcquisition.cs:9` · Level 0 · class (sealed)

- **What it is**: the three-way outcome of a token-acquisition attempt: a token, a definitive "no
  session", or a transient failure. It is a sealed value holder with a private constructor
  (`TokenAcquisition.cs:11`), so the only ways to get one are its three factories.
- **Depends on**: nothing first-party. Produced by
  [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) implementations
  ([`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher),
  [`DirectApiTokenRefresher`](#directapitokenrefresher)) and read by
  [`WasmTokenStorageService`](#wasmtokenstorageservice).
- **Concept introduced, making "absent" and "unknown" different values.** A nullable token collapses
  two very different facts: the server said there is no session, or the attempt failed and said
  nothing. Treating the second as the first makes a signed-in user look anonymous after a 429 or a
  dropped connection.
  - `[Rubric §12, Performance & Scalability]`: only the definitive `NoSession` lets storage skip
    repeat token POSTs, and the type, not an exception or a magic null, carries that distinction.
  - `[Rubric §11, Security]`: a revoked or reused refresh token is `NoSession`, but a 409 on a
    superseded token is `Unavailable` (`DirectApiTokenRefresher.cs:64-67`), so the stored pair is not
    cleared by a race.
- **Walkthrough**:
  - `NoSession` (line 35), the static outcome for an answer that proves there is no session (the
    endpoint's 401); `AccessToken` is `null` and `IsUnavailable` is false.
  - `Unavailable` (line 38), for an attempt that failed without saying anything about the session;
    `IsUnavailable` is true, so the next read should try again (lines 43-47).
  - `Acquired(accessToken)` (line 52) calls `ArgumentException.ThrowIfNullOrWhiteSpace` (line 54) and
    returns an outcome carrying the token, so a blank token can never masquerade as success.
  - `AccessToken` (line 41) is `null` for both non-success outcomes.
- **Why it's built this way**: the two static singletons avoid allocation on the hot "no token" paths,
  and the private constructor keeps the invariant (a token implies not unavailable) unforgeable. Design
  rationale: [ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html).
- **Where it's used**: returned by `TryAcquireAccessTokenAsync` in both refreshers, and consumed in
  `WasmTokenStorageService.HydrateAsync` (`WasmTokenStorageService.cs:127-129`) and the handoff session
  services (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs`).
  Covered through `WasmTokenStorageServiceTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs`).

### ITokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ITokenStorageService.cs:8` · Level 0 · interface

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
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:55`) and
  [`NotificationHubService`](#notificationhubservice) for the SignalR access-token provider. Test
  hosts substitute `StubTokenStorageService` and `NullTokenStorageService`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:8`).

### JwtTokenInfo
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/JwtTokenInfo.cs:9` · Level 0 · class (static)

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
  30-second skew (`WasmTokenStorageService.cs:27,52`), and the same pattern in
  [`ServerTokenStorageService`](#servertokenstorageservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:37`).

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
    served to the next (`IUiReadCache.cs:22-26,80-84`).
  - `[Rubric §29, Resilience & Business Continuity]` shows in the storage rule: only successful reads
    are stored, so a transient outage cannot pin an error in front of the user (`IUiReadCache.cs:19-20`).
  - **Why the parameter is a `string` and not a `Uri`.** The `CA1054` suppression (lines 28-31) is
    worth reading as a small design argument: the parameter is a cache *key* that happens to be spelled
    as a relative URL, it is compared by ordinal prefix and stored verbatim, and `System.Uri` would
    re-encode and re-normalize it, which is exactly what must not happen to a key when the point is
    matching the server's key byte for byte.
  - **The in-flight read race, and the generation counter that closes it.** A read issued before a
    write and completing after it would otherwise re-store exactly the value the write just
    invalidated. `Generation` (line 40) is a counter that moves on every `InvalidatePrefix` and `Clear`;
    a reader captures it before the GET and hands it back to the three-argument `Set`, which drops the
    value when an invalidation happened in between (lines 34-39, 61-70). `[Rubric §19, State Management
    & Data Flow]` assesses exactly this kind of stale-write ordering.
- **Walkthrough**: six members, two of them default interface members.
  - `long Generation => 0` (line 40) is the invalidation generation. The default body returns a
    constant, so an implementation that does not track generations never drops a value.
  - `bool TryGetFresh<T>(string url, out T? value)` (line 50) reports a fresh hit; a miss, an expired
    entry, or a disabled cache all read as `false`, and the doc notes that a hit stored under a
    different type also reads as a miss (line 45).
  - `void Set<T>(string url, T value)` (line 59) stores a successfully read value stamped with the
    current time, and is a no-op when caching is disabled. The doc is explicit that only success values
    are ever passed here (line 58).
  - `void Set<T>(string url, T value, long generation)` (line 70) stores only when no invalidation
    happened since `generation` was read; its default body forwards to the two-argument `Set` and
    ignores the generation (lines 61-65, 70).
  - `void InvalidatePrefix(string routePrefix)` (line 78) drops every entry whose key starts with the
    prefix, ordinally. That is how one endpoint's create, update or delete clears that endpoint's list,
    paged, lookup and by-id entries in a single call (lines 73-75).
  - `void Clear()` (line 85) drops everything, for the sign-out case above.
- **Why it's built this way**: an interface (rather than a concrete helper) is what lets the whole
  feature be optional. Both consumers take `IUiReadCache?` with a `null` default, so a host that
  registers nothing gets exactly the plain GET the read methods issued before a cache existed
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:47`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:50`). Prefix
  invalidation rather than per-key invalidation matches how the framework's endpoints are shaped: one
  resource owns one route prefix, so a write knows what it invalidated without enumerating the reads.
  The two generation members are default interface members, so a host-supplied implementation that
  does not care about the in-flight race only has to implement the original four.
- **Where it's used**: registered `TryAddScoped` against [UiReadCache](#uireadcache) by `AddUIShared`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:76`). Read through by
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)'s
  `GetCachedAsync` (`EntityServiceBase.cs:253-284`), which captures `Generation` before the GET
  (`EntityServiceBase.cs:273`) and stores through the three-argument `Set` (`EntityServiceBase.cs:280`),
  and invalidated by its `InvalidateOnSuccess` (`EntityServiceBase.cs:285-291`); cleared on sign-out and
  on an unrefreshable session by `AuthUIService` (`AuthUIService.cs:190,393`).
- **Caveats / not-in-source**: nothing here is shared between users or between tabs. It is an in-memory
  per-scope cache, so a second browser tab on WebAssembly has its own instance and its own entries.

### TokenHydrationWarmup
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/TokenHydrationWarmup.cs:26` · Level 1 · class (static, partial)

- **What it is**: a one-method boot-time warm-up that reads the access token once through
  [`ITokenStorageService`](#itokenstorageservice), so the first hydration overlaps the app's first
  render instead of delaying whichever API call happens to go out first.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (resolved, not injected, so the call
  is optional at the call site) and `Microsoft.Extensions.Logging.ILoggerFactory`, both pulled from the
  host's root `IServiceProvider` (`TokenHydrationWarmup.cs:37,42,46`).
- **Concept introduced, a fire-and-forget warm-up that cannot fault.** `[Rubric §23, Front-End
  Performance]` assesses avoidable delay on first render; this type exists because hydration used to
  run inline on whichever `APIClient` call the user made first. `[Rubric §29, Resilience & Business
  Continuity]` applies to the swallow-and-log shape: because the call is discarded (`_ =
  TokenHydrationWarmup.WarmAsync(...)`) rather than awaited, an unhandled fault here would surface as an
  unobserved task exception rather than anywhere useful, so the method is written to never throw. On the
  anonymous path a failed warm-up is expected (there is no session to hydrate), so the failure logs at
  `Debug`, not `Warning` (`TokenHydrationWarmup.cs:52`).
- **Walkthrough**
  - `WarmAsync(IServiceProvider services)` (`TokenHydrationWarmup.cs:37`) null-guards `services`
    (line 38).
  - It resolves the logger before the `try` (line 41), with the comment noting that this keeps the
    handler resolution itself from being the thing that throws.
  - Inside the `try`, it resolves `ITokenStorageService` and calls `GetAccessTokenAsync()`, discarding
    the result (line 45): the point is the side effect (populating the in-memory token or the
    single-flight hydration), not the value.
  - A `catch (Exception ex)` (line 48, `CA1031` suppressed with a comment explaining the design) logs
    through the source-generated `LogWarmupFailed` (lines 54, 59-60) and returns normally.
- **Why it's built this way**: a `static partial class` with a `[LoggerMessage]`-generated logging
  method keeps the warm-up allocation-light and dependency-free at the call site: it takes the root
  provider rather than a constructor-injected service, because it runs once at startup before any
  component tree exists to inject into.
- **Where it's used**: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:92`, called and
  discarded (`_ = TokenHydrationWarmup.WarmAsync(host.Services)`) right after
  [`MmcaCultureBootstrap.SetBrowserCultureAsync`](#mmcaculturebootstrap) and before `host.RunAsync()`;
  the surrounding comment (`Program.cs:87-91`) records the cost it replaces, about 2.4s added to the
  first cold-start `APIClient` call under the old inline hydration. Covered by
  `TokenHydrationWarmupTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/TokenHydrationWarmupTests.cs:13`),
  which exercises the success path (line 21), a storage failure (line 33) and a provider with no
  registered storage service (line 45).

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
    and every prefix check passes `StringComparison.Ordinal` explicitly (lines 137, 170).
  - **One generation counter for the whole dictionary.** `_generation` moves under `_sync` on every
    `InvalidatePrefix` and `Clear`, and the comment at lines 29-30 states why it is one counter rather
    than one per prefix: the cache holds tens of entries, and a global counter also covers `Clear`. The
    cost is that a write to one endpoint also drops an in-flight read of an unrelated one, which is a
    wasted store, never a stale one.
  - `[Rubric §14, Testability]` shows in the injected `TimeProvider` (line 16): TTL behavior is
    exercised with a fake clock rather than by sleeping, in `UiReadCacheTests`.
- **Walkthrough**:
  - Fields: the `Lock _sync` (line 20), the entry dictionary mapping URL to a
    `(object Value, DateTimeOffset StoredAt)` tuple (line 25), the null-guarded `_timeProvider`
    (line 26), the eagerly unwrapped `_options` (line 27), and the `long _generation` counter
    (line 31). Storing the value as `object` is what lets one dictionary hold every read shape the app
    makes.
  - `Generation` (lines 34-43) reads `_generation` under the same lock that guards its increments.
  - `TryGetFresh<T>` (lines 46-83) guards the URL, sets `value = default`, and short-circuits to
    `false` when `_options.Enabled` is off (lines 52-55). It then takes the lock and applies three
    exits: no entry (lines 61-64); an entry older than `ResolveTtl(url)`, which is **removed** on the
    way out (lines 66-70); and an entry whose stored value is not a `T`, which is also removed, because
    the same URL read back as a different type means the caller changed shape and the stored value can
    no longer answer the question (lines 72-78). Only then is it a hit (lines 80-81).
  - `Set<T>(url, value)` (lines 86-101) is a no-op when caching is disabled **or the value is null**
    (line 90), stamps `GetUtcNow()` outside the lock, and assigns inside it (lines 95-100).
  - `Set<T>(url, value, generation)` (lines 104-126) has the same guards, then, inside the lock,
    returns without storing when `generation` no longer equals `_generation` (lines 119-122): a write
    invalidated the endpoint, or a sign-out cleared everything, while the read was in flight, so the
    value may be exactly what the write made stale (lines 117-118). Otherwise it assigns (line 124).
  - `InvalidatePrefix` (lines 129-145) increments `_generation` (line 135) and materializes the
    matching keys into a list under the lock before removing them (lines 136-143), because removing
    while enumerating the same dictionary would throw.
  - `Clear` (lines 148-155) increments `_generation` (line 152) and empties the dictionary under the
    lock.
  - `ResolveTtl` (lines 163-178) is the freshness lookup: it starts from
    `UiReadCacheOptions.DefaultTtl` and scans every configured route prefix, keeping the TTL of the
    **longest** prefix the URL starts with (lines 168-175). The doc says why longest-match rather than
    first-match (lines 157-162): a nested route can state a stricter budget than the endpoint above it,
    whatever order the configuration happens to enumerate in.
- **Why it's built this way**: `internal` because the interface is the supported surface and the DI
  registration is the only supported way to get one
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:76` registers it
  `TryAddScoped`, so a host can substitute its own implementation). The clock is registered alongside
  it with `TryAddSingleton(TimeProvider.System)` (`DependencyInjection.cs:71`), which the comment notes
  is a `TryAdd` so a host that already registered one (as `AddInfrastructure` does) keeps it and a test
  substitutes a `FakeTimeProvider`. The defaults come from the options object rather than constants:
  caching is `Enabled` by default with a 60-second `DefaultTtl`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:24,32`), long
  enough to collapse the burst of identical reads a page issues while it mounts and short enough that a
  stale list corrects itself within one user's attention span.
- **Where it's used**: resolved as [IUiReadCache](#iuireadcache) by
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) and
  [AuthUIService](#authuiservice); covered by `UiReadCacheTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Caching/UiReadCacheTests.cs:15`),
  whose generation cases drop a late `Set` after an invalidation and after a `Clear`
  (`UiReadCacheTests.cs:156,175`).

### ISessionAwareTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISessionAwareTokenRefresher.cs:12` · Level 1 · interface

- **What it is**: an [`ITokenRefresher`](#itokenrefresher) that can say why it returned no token. It
  adds one method that reports a [`TokenAcquisition`](#tokenacquisition) instead of a bare nullable
  string.
- **Depends on**: [`ITokenRefresher`](#itokenrefresher) (base interface) and
  [`TokenAcquisition`](#tokenacquisition) (the return type). Implemented by
  [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) and
  [`DirectApiTokenRefresher`](#directapitokenrefresher); consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and `ServerTokenStorageService`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs`).
- **Concept introduced, a capability interface instead of a changed contract.** The base
  `Task<string?>` answer cannot separate a definitive "no session" from a transient failure, and a
  caller that caches the absence of a session needs exactly that difference. Rather than break
  every `ITokenRefresher` implementation, the richer method lives on a derived interface that callers
  probe for at runtime (`WasmTokenStorageService.cs:125`).
  - `[Rubric §1, SOLID]` (open for extension, closed for modification): the original contract is
    untouched and implementers opt in.
  - `[Rubric §12, Performance & Scalability]` assesses redundant work: knowing "no session" is
    definitive is what lets storage skip repeat token POSTs for a short grace.
- **Walkthrough**: a single member,
  `Task<TokenAcquisition> TryAcquireAccessTokenAsync(CancellationToken cancellationToken = default)`
  (`ISessionAwareTokenRefresher.cs:17`). Its documented result is "the acquired token, a definitive
  'no session', or a transient failure" (line 16), and it does not throw for those cases.
- **Why it's built this way**: see
  [ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html). A refresher
  that does not implement it (for example the handoff one) keeps the previous reading, where `null`
  means "no session" (`WasmTokenStorageService.cs:131-134`).
- **Where it's used**: the two refreshers above implement it, and
  `WasmTokenStorageService.HydrateAsync` type-tests for it (`WasmTokenStorageService.cs:125`). Covered
  by `DirectApiTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs`).

### SameOriginProxyTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/SameOriginProxyTokenRefresher.cs:16` · Level 2 · class (sealed)

- **What it is**: the browser [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher), used by
  both Blazor Server and WebAssembly. It asks a JS helper to POST the same-origin
  `/auth/session/token` endpoint and reports what comes back as a
  [`TokenAcquisition`](#tokenacquisition).
- **Depends on**: [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) (the contract),
  [`TokenAcquisition`](#tokenacquisition) and `IJSRuntime`, plus the
  `mmcaAuthSession` helper in
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/mmca-auth-cookie.js:32`, whose `getToken`
  issues the `fetch` (line 35).
- **Concept introduced, the BFF hop.** The refresh token never enters this process. The browser sends
  its HttpOnly cookies with `credentials:'same-origin'`, the UI host validates or refreshes
  server-side, and only the access token comes back over the wire
  (`SameOriginProxyTokenRefresher.cs:5-10`). The server half is
  `SessionCookieEndpoints`, which maps `POST /auth/session/token`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:60`).
  - `[Rubric §26, Front-End Security]` assesses whether a long-lived credential is reachable from
    scripts. It is not: an XSS on this page can steal an access token that expires in minutes, not the
    refresh token behind it.
  - `[Rubric §7, Microservices Readiness]` shows in the origin choice. The call goes to the UI host,
    not the API, so it stays same-origin and needs no CORS or cross-site cookie policy.
- **Walkthrough**: two methods. `AcquireAccessTokenAsync(cancellationToken)`
  (`SameOriginProxyTokenRefresher.cs:19`) is a shim returning
  `(await TryAcquireAccessTokenAsync(...)).AccessToken`. `TryAcquireAccessTokenAsync` (line 23) invokes
  `mmcaAuthSession.getToken` through interop (line 27) and maps a blank result to
  `TokenAcquisition.NoSession`, anything else to `Acquired` (line 28). The remarks (lines 11-15) record
  the script contract: it answers `null` only for the endpoint's 401 and throws for any other failure
  (a 429, a 5xx, a network error), which is what lets this method tell the two apart. The four
  interop-unavailable exception types [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync) filters
  on are caught inline (line 30) and reported as `Unavailable`, with the comment saying none of these
  says anything about the session and that the server-side cookie path covers the interop-less phases
  (lines 32-34).
- **Why it's built this way**: a proxy hop instead of a direct API call is the decision recorded in
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html), including the
  `SameSite=Lax` plus `Sec-Fetch-Site` check that hardens the refresh endpoint. The three-way outcome
  (see [ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html)) lets token
  storage tell "no session" from "interop not ready or endpoint failing", so a transient failure is
  not remembered as anonymous; the plain `string?` shim still satisfies the
  [`ITokenRefresher`](#itokenrefresher) contract.
- **Where it's used**: registered on both browser heads
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:115` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:45`); consumed indirectly by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and
  [`ServerTokenStorageService`](#servertokenstorageservice). Covered by
  `SameOriginProxyTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/SameOriginProxyTokenRefresherTests.cs:14`).

### WasmTokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/WasmTokenStorageService.cs:22` · Level 2 · class (sealed)

- **What it is**: the WebAssembly [`ITokenStorageService`](#itokenstorageservice). The access token
  lives in memory only and is hydrated on demand from the HttpOnly cookies; there is no `localStorage`
  anywhere in it.
- **Depends on**: [`ISessionCookieSync`](#isessioncookiesync) and
  [`ITokenRefresher`](#itokenrefresher) (constructor parameters, `WasmTokenStorageService.cs:22-24`),
  plus [`JwtTokenInfo`](#jwttokeninfo) for the freshness check; optionally
  [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) (a runtime type test in
  `HydrateAsync`, line 125); externals `System.Threading.Lock` and `TimeProvider`.
- **Concept introduced, single-flight hydration.** Several callers can ask for a token in the same
  instant: the [`AuthDelegatingHandler`](#authdelegatinghandler) on an outgoing request, the
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) during a render, and
  [`NotificationHubService`](#notificationhubservice)'s access-token provider. Without coordination
  each would start its own refresh, and the last one to finish would overwrite the others' token. The
  fix is to share one in-flight `Task`, and the source is explicit that the lock, not a `??=`, is what
  makes it single (lines 62-65).
  - **Remembering "no session" for a short grace.** A visitor with no session would otherwise cost one
    same-origin token POST per API call. After a hydrate returns a DEFINITIVE "no session", the service
    answers `null` from memory for `AnonymousGrace`, 15 seconds (line 30), checked in
    `GetAccessTokenAsync` (lines 57-60). A transient failure is never remembered, and
    `SetTokensAsync` resets the window so a login right after anonymous browsing does not wait it out
    (lines 96-97).
  - `[Rubric §19, State Management & Data Flow]` assesses ownership of shared per-circuit state; the
    in-memory token and its in-flight hydration are exactly that.
  - `[Rubric §12, Performance & Scalability]` assesses redundant work: a burst of concurrent callers
    costs one network round trip, not one each.
  - `[Rubric §11, Security]` assesses at-rest exposure. The refresh token is never held client-side,
    the comment at line 91 saying it lives only in the HttpOnly cookie.
- **Walkthrough**:
  - `ExpirySkew`, 30 seconds (`WasmTokenStorageService.cs:27`), the proactive margin handed to
    [`JwtTokenInfo.IsFresh`](#jwttokeninfo); `AnonymousGrace`, 15 seconds (line 30).
  - `_hydrateSync` (line 32), the `Lock`; `_timeProvider` (line 33), the injected clock (system clock
    when null); `_accessToken` (line 35), the in-memory token; `_hydrateInFlight` (line 36), the shared
    hydration task; and `_anonymousUntil` (line 37), the end of the current grace.
  - A second, two-argument constructor (line 45) chains to the primary one with a null clock, so code
    compiled against the original signature keeps binding.
  - `GetAccessTokenAsync()` (line 50) returns the cached token immediately when it is fresh
    (lines 52-55). If there is no token and the grace has not elapsed it returns `null` without any
    network call (lines 57-60). Otherwise it takes the lock only long enough to publish or read the
    in-flight task (lines 67-71), which is safe because `HydrateAsync` reaches its first `await`
    immediately so nothing slow runs under the lock (lines 62-65). It then awaits the shared task
    (line 75) and, in a `finally`, clears `_hydrateInFlight` **only if it is still the same task**
    (`ReferenceEquals`, line 83). That guard is the subtle half: an unguarded clear can drop a newer
    hydrate started after this one completed, splitting the next set of callers all over again
    (lines 79-80).
  - `GetRefreshTokenAsync()` (line 92) returns `null` unconditionally, an honest answer rather than a
    stub: in the browser there is nothing to return.
  - `SetTokensAsync(accessToken, refreshToken)` (line 94) resets `_anonymousUntil` (line 97), stores
    the access token in memory (line 98) and seeds the HttpOnly cookies through
    [`ISessionCookieSync.SyncAsync`](#isessioncookiesync) (line 103); the comment records that the
    refresh token transits JS only for that same-origin POST (lines 99-102). A `false` from the cookie
    write throws `InvalidOperationException` (lines 103-105), after the in-memory token is set, so
    [`AuthUIService`](#authuiservice) reports `Auth.TokenStorageUnavailable` instead of a login that
    silently signs out at the first access-token expiry, when no cookie exists to refresh from.
  - `ClearTokensAsync()` (line 109) nulls the field and clears the cookies (lines 111, 115). Clearing
    is best-effort by contract, so a `false` from `ClearAsync` is discarded; the comment points a caller
    that needs proof the session ended at `IAuthUIService.RevokeAllSessionsAsync` (lines 112-114).
  - `HydrateAsync()` (line 118) branches on the refresher's capability. When it is an
    [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) (line 125) it calls
    `TryAcquireAccessTokenAsync`, stores `AccessToken` and reads `IsUnavailable` (lines 127-129);
    otherwise it falls back to [`ITokenRefresher.AcquireAccessTokenAsync`](#itokenrefresher), where a
    `null` means "no session" (line 133). Only a null token that is not unavailable starts the grace
    (lines 136-139), so a 429, a 5xx or unavailable interop never makes a signed-in user look
    anonymous. See [`TokenAcquisition`](#tokenacquisition).
- **Why it's built this way**: the class doc records that it was hoisted out of the app WASM clients
  because it carries no app-specific state, and names its Blazor Server sibling
  [`ServerTokenStorageService`](#servertokenstorageservice) in
  MMCA.Common.UI.Web. The two share the skew constant, the `Lock`, and the same
  single-flight shape; the server one adds an `HttpContext` branch for the prerender pass. The
  cookie-only storage model is [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: registered on the WASM clients,
  `AddScoped<ITokenStorageService, WasmTokenStorageService>()`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:45`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:48`). Covered by
  `WasmTokenStorageServiceTests`, which drives the concurrency path directly and pins the failed
  cookie write as a throw
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:16,237`).

### DirectApiTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth.Tokens` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:35` · Level 2 · class (sealed)

- **What it is**: the MAUI [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) (and so an
  [`ITokenRefresher`](#itokenrefresher)). It reads the token pair out of OS SecureStorage, exchanges it
  against the API's cross-origin `auth/refresh` endpoint, and writes the rotated pair back, reporting
  the outcome as a [`TokenAcquisition`](#tokenacquisition).
- **Depends on**: [`ISecureTokenStore`](#isecuretokenstore) (deliberately, not
  [`ITokenStorageService`](#itokenstorageservice)),
  [`AuthDelegatingHandler`](#authdelegatinghandler) (for its `SkipBearer` request option),
  [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest) and
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) from `MMCA.Common.Shared.Auth`;
  externals `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept introduced, direct token handling where there is no DOM.** The class doc justifies the
  choice: MAUI has no browser and thus no XSS surface, so holding a refresh token client-side and
  posting it is acceptable there in a way it is not in a browser
  (`DirectApiTokenRefresher.cs:9-11`). This is the counterpart to
  [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher), and reading the two together is
  the clearest statement of the framework's per-platform threat model.
  - `[Rubric §11, Security]` assesses per-platform credential handling, exactly as above.
  - `[Rubric §1, SOLID]`, dependency direction: the second doc paragraph is unusually explicit
    (lines 12-18). Every operation it performs is a raw read or write, so it takes the raw store;
    taking [`ITokenStorageService`](#itokenstorageservice) instead would close the loop and let a
    refresh re-enter the acquisition that started it.
  - **The same cycle through the HTTP pipeline.** The third doc paragraph (lines 19-24) names the
    indirect route back into that loop: the `APIClient` carries
    [`AuthDelegatingHandler`](#authdelegatinghandler), which reads the storage service for a bearer.
    The refresh POST therefore sets `AuthDelegatingHandler.SkipBearer` (line 61), so the anonymous
    refresh call never reaches the storage instance that is awaiting it. The handler honors the option
    by passing the request through untouched
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:22,29`).
  - **A 409 is transient, never "no session".** The fourth doc paragraph (lines 26-33) explains
    `Auth.RefreshSuperseded`: the presented token was rotated by another request inside the server's
    reuse grace. Clearing the pair on that answer would let a stolen-and-rotated token live for the full
    refresh lifetime, so the stored pair is left untouched and the next attempt presents it again.
- **Walkthrough**: `AcquireAccessTokenAsync(cancellationToken)` (`DirectApiTokenRefresher.cs:42`) is an
  expression-bodied shim over `TryAcquireAccessTokenAsync` (line 46) that returns only
  `.AccessToken`, which keeps the plain [`ITokenRefresher`](#itokenrefresher) contract intact. The
  `Try` method is a straight line of early returns, each producing a
  [`TokenAcquisition`](#tokenacquisition) rather than an exception:
  - read both tokens from the store (lines 48-49), and return `NoSession` when either is blank
    (lines 51-54), so a never-logged-in device costs one storage read and no network call;
  - create the named `"APIClient"` (`ApiClientName`, line 39), build an `HttpRequestMessage` POSTing a
    [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest) carrying both tokens as
    `JsonContent` to the relative `auth/refresh` (lines 56-60), mark it `SkipBearer` (line 61), and
    send it (line 62);
  - on `HttpStatusCode.Conflict` (lines 64-67) delegate to `ReadSupersededOutcomeAsync` (line 88),
    which re-reads the store: if another refresh in this process already stored a different non-blank
    pair it returns `Acquired` with that access token, otherwise `Unavailable` with the pair left as it
    was (lines 90-97);
  - return `NoSession` on any other non-success status (lines 69-72), which is how a revoked or reused
    refresh token arrives;
  - deserialize an [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and return
    `NoSession` when the access token came back blank (lines 74-78);
  - persist the rotated pair through [`ISecureTokenStore.SetTokensAsync`](#isecuretokenstore) and
    return `TokenAcquisition.Acquired` with the new access token (lines 80-81).
- **Why it's built this way**: the rotation-on-refresh shape it participates in is
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html), which made
  refresh sessions hashed, rotating and per device: writing the returned pair back is not an
  optimization, it is required, because the old refresh token is dead after the exchange. An explicit
  `HttpRequestMessage` rather than `PostAsJsonAsync` is what gives the call an `Options` bag to carry
  `SkipBearer`. The `using var httpClient` (line 56) and the relative `Uri` both lean on the named
  client configured once in `AddUIShared`, which also attaches the delegating handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:124,146`).
- **Where it's used**: registered on the MAUI heads,
  `AddScoped<ITokenRefresher, DirectApiTokenRefresher>()`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:98`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:166`). Covered by
  `DirectApiTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:18`),
  which stubs the store and the HTTP handler (lines 25-36) and asserts the `SkipBearer` mark on the
  refresh POST (line 62).

### CultureDelegatingHandler

> MMCA.Common.UI · `MMCA.Common.UI.Services.Culture` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/CultureDelegatingHandler.cs:13` · Level 0 · class (sealed)

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
  `[Rubric §6, CQRS & Event-Driven Design]` also applies, because this is a concern every service call
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:115`) and appended to the
  `"APIClient"` pipeline after the auth handler (`DependencyInjection.cs:146-147`).
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

> MMCA.Common.UI · `MMCA.Common.UI.Services.Culture` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/ICultureApplier.cs:14` · Level 0 · interface

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/CultureSwitcher.razor:6` and
  `CultureSwitcher.razor:44-48`), and by the login page when reconciling a returning user's stored
  culture (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:15` and
  `Login.razor:239-244`).

---

### IPublicLinkBuilder

> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/IPublicLinkBuilder.cs:9` · Level 0 · interface

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
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationPublicLinkBuilder.cs:25`),
    after rejecting a blank path (`NavigationPublicLinkBuilder.cs:23`).
  - The hybrid binding resolves against the `PublicSite:BaseUrl` key pinned in the head's embedded
    configuration
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiPublicLinkBuilder.cs:17` and
    `MauiPublicLinkBuilder.cs:28-32`), and throws `InvalidOperationException` at construction when the
    key is missing, so a misconfigured head fails at startup instead of shipping unusable links.
- **Why it's built this way**: the default is registered with `TryAddScoped`
  (`DependencyInjection.cs:149`) and the comment above it (`DependencyInjection.cs:145-148`) records
  the override rule: the hybrid head calls `AddCommonMauiPublicLinkBuilder()` after `AddUIShared`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:140-141`, invoked at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:145`) and the last registration wins. That is
  the same head-override composition convention
  [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) establishes
  for the device capability layer.
- **Where it's used**: the shared `SharePageButton` component
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Sharing/SharePageButton.razor:4` and
  `SharePageButton.razor:43`), the shared `QrCodeButton` component (`QrCodeButton.razor:1` and
  `QrCodeButton.razor:79`), and app pages such as ADC's speaker QR page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerQr.razor.cs:26` and
  `SpeakerQr.razor.cs:62`). A bUnit test pins the default registration to the browser-origin builder
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Navigation/NavigationPublicLinkBuilderTests.cs:59`).

---

### BackNavigationResult
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19` · Level 0 · record (sealed)

- **What it is**: the outcome of a hardware-back or WebView-back attempt routed through
  [MauiBackNavigationBridge](#mauibacknavigationbridge): whether the WebView consumed the gesture, and
  whether the WebView is sitting at the root of its history stack.
- **Depends on**: nothing first-party. It is a two-field positional record produced and consumed by
  [MauiBackNavigationBridge](#mauibacknavigationbridge).
- **Concept introduced, the interop return contract.** This record is also the wire shape of a single
  JS interop call: `nav-interop.js`'s `tryGoBack()` returns an object that deserializes straight into
  it (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:48`),
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

### EndpointCultureApplier

> MMCA.Common.UI · `MMCA.Common.UI.Services.Culture` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/EndpointCultureApplier.cs:18` · Level 1 · class (sealed)

- **What it is**: the Blazor Web implementation of [ICultureApplier](#icultureapplier). It
  force-navigates to the server's `GET /culture/set` endpoint, which writes the culture cookie and
  redirects the user back to where they were.
- **Depends on**: [ICultureApplier](#icultureapplier) (implemented) and
  `Microsoft.AspNetCore.Components.NavigationManager`. It pairs with the server endpoint mapped by
  `MapCultureEndpoint()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:102`, the
  `MapGet("/culture/set", ...)` at `WebApplicationExtensions.cs:120`) and with
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
  `TryAddScoped<ICultureApplier, EndpointCultureApplier>()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:186`), with the
  comment above it
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:182-185`) recording that a hybrid head overrides it
  afterwards. The MAUI replacement is
  [MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier).

---

### MmcaCultureBootstrap

> MMCA.Common.UI · `MMCA.Common.UI.Services.Culture` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/MmcaCultureBootstrap.cs:14` · Level 1 · class (static)

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
  - Two overloads of `SetBrowserCultureAsync`. The one-argument form
    (`SetBrowserCultureAsync(IJSRuntime jsRuntime)`, `MmcaCultureBootstrap.cs:25`) forwards with
    `allowPseudoLocale: false`, so the pseudo locale is never accepted through it. The real work is in
    `SetBrowserCultureAsync(IJSRuntime jsRuntime, bool allowPseudoLocale)`
    (`MmcaCultureBootstrap.cs:41`), null-guarded at `MmcaCultureBootstrap.cs:43`. A Development host
    passes `builder.HostEnvironment.IsDevelopment()` as the flag, because the server accepts the
    pseudo locale only in Development (`MmcaCultureBootstrap.cs:28-40`).
  - It imports `./_content/MMCA.Common.UI/culture.js` under an `await using`
    (`MmcaCultureBootstrap.cs:45-46`), so the module reference is released as soon as the one call is
    done: unlike the long-lived services, this runs once at startup and has no reason to hold it.
  - It calls `getCulture` (`MmcaCultureBootstrap.cs:47`), whose JS side parses the
    `.AspNetCore.Culture` cookie's `uic=` segment and returns null when the cookie is absent or
    unparseable (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/culture.js:4`).
  - The returned value is accepted when `SupportedCultures.IsSupported` says so, or when
    `allowPseudoLocale` is true and `SupportedCultures.IsPseudoLocale` matches; anything else falls back
    to `SupportedCultures.Default` (`MmcaCultureBootstrap.cs:49-51`). The predicate is at
    `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:35`, the pseudo-locale
    check at `SupportedCultures.cs:76`, the `"qps-Ploc"` constant at `SupportedCultures.cs:28`, the
    allowlist at `SupportedCultures.cs:18`, and the `"en-US"` default at `SupportedCultures.cs:12`.
  - It then assigns only `CultureInfo.DefaultThreadCurrentCulture` and
    `CultureInfo.DefaultThreadCurrentUICulture` (`MmcaCultureBootstrap.cs:53-54`), never
    `CurrentCulture`/`CurrentUICulture` directly: setting the defaults makes every subsequently created
    thread inherit the culture, which is what a later switch needs in order to take effect.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). The cookie is deliberately
  non-HttpOnly for exactly this reader, a decision recorded in the suppression comment on the server
  side (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:111`,
  written at `WebApplicationExtensions.cs:120`), which names
  `MmcaCultureBootstrap.SetBrowserCultureAsync` as the consumer. The doc comment
  (`MmcaCultureBootstrap.cs:11-12`) also pins the call ordering: it must run after `builder.Build()`
  and before `host.RunAsync()`.
- **Where it's used**: both Blazor Web clients call the two-argument overload exactly as documented,
  passing `builder.HostEnvironment.IsDevelopment()` so hydration keeps the pseudo locale the server
  prerendered: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:83` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:71`. Its MAUI counterpart is
  [MauiCultureInitializer](group-26-device-capability-layer.md#mauicultureinitializer).

---

### NavigationPublicLinkBuilder
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationPublicLinkBuilder.cs:11` · Level 1 · class (sealed)

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
  head-agnostic (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Sharing/SharePageButton.razor:4`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Sharing/QrCodeButton.razor:1`).
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
    [NavigationPublicLinkBuilderTests](group-28-testing-infrastructure.md#per-project-test-rollup)
    asserts that `"/sessions/42"` and `"sessions/42"` both resolve to `http://localhost/sessions/42`
    against the bUnit origin
    (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Navigation/NavigationPublicLinkBuilderTests.cs:21-25`),
    that a query string survives (`:27-29`), and that a blank path throws (`:31-41`).
- **Why it's built this way**: `AddUIShared` registers this implementation with `TryAddScoped`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:196`), so every head gets a
  working builder without opting in, and the one head that must differ replaces it afterwards:
  `AddCommonMauiPublicLinkBuilder()` registers
  [MauiPublicLinkBuilder](group-26-device-capability-layer.md#mauipubliclinkbuilder) over the
  configured public site URL
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:141`). The registration
  shape is itself asserted, implementation type and lifetime, so a refactor that changes the default is
  a red test rather than a silently wrong share link (`NavigationPublicLinkBuilderTests.cs:43-62`).
- **Where it's used**: injected by the framework's share affordances, `SharePageButton` and
  `QrCodeButton`, and by ADC's [SpeakerQr](group-21-conference-ui.md#speakerqr) page, which encodes the
  absolute public URL into the badge QR rather than the WebView origin
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerQr.razor.cs:26`).
  The bUnit harnesses in both repos register it explicitly so component tests exercise the real builder
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/BunitTestBase.cs:42`,
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:35`).
- **Caveats**: `BuildAbsolute` performs no allow-list check on `relativePath`, and nothing in the class
  restricts the result to the app's own origin, so a path value that came from user input should be
  sanitized upstream.

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
  `./_content/MMCA.Common.UI/nav-interop.js` (`ModulePath`, line 30) into an `await using` module
  reference (line 47) and invokes its `tryGoBack()` helper, deserializing the answer into a
  [BackNavigationResult](#backnavigationresult) (lines 48-49). The module reference is disposed on
  every call: the class is static, so nothing else owns it, and re-importing on each back press without
  disposing would leak one JS object reference per press (comment at lines 44-46). Three interop
  failure modes are caught explicitly and collapse to the same safe value
  `new BackNavigationResult(Handled: false, AtRoot: true)`: `InvalidOperationException` when Blazor is
  not yet hydrated (lines 51-55), `JSDisconnectedException` (lines 56-59, which also covers a dispose
  on a torn-down circuit), and `JSException` (lines 60-63). A not-yet-ready WebView therefore reports
  "at root, not handled" and the host falls back to its default back behavior.
- **Why it's built this way**: a static helper with no state fits a one-shot interop call, and
  returning a data record instead of throwing keeps the native handler branch-free. Because it holds no
  state, it also cannot cache the imported module, which is why each call owns and disposes its own
  reference. Collapsing the three JS exception types into one safe default means an unhydrated or
  disconnected circuit never crashes the native back button.
- **Where it's used**: the MAUI host base page in `MMCA.Common.UI.Maui`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/MainPageBase.cs:77`) calls it from its
  `OnBackButtonPressed` override (`MainPageBase.cs:38`); the returned [BackNavigationResult](#backnavigationresult) tells the host
  whether to exit the app.
- **Caveats / not-in-source**: the `nav-interop.js` `tryGoBack()` implementation and the
  `MainPageBase` dispatch logic live outside this unit; only the C# side of the bridge is visible here.

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

### ViewerTimeZone
> MMCA.Common.UI · `MMCA.Common.UI.Services.Culture` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/ViewerTimeZone.cs:18` · Level 1 · class (sealed)

- **What it is**: a scoped service that learns the viewer's browser time zone once and converts the UTC
  instants the API serializes onto the clock the person actually reads. Until the zone is known it
  reports UTC (`ViewerTimeZone.cs:32`).
- **Depends on**: [LazyJsModule](#lazyjsmodule) (held as `_module`, built over the host's `IJSRuntime` in
  the constructor, `ViewerTimeZone.cs:26`) and the `time-zone.js` module named at
  `ViewerTimeZone.cs:20`. Implements `IAsyncDisposable`.
- **Concept introduced, rendering instants on the viewer's clock.** `[Rubric §27, Internationalization]`
  assesses whether dates are shown the way the reader expects, not the way the server stores them. A
  server-side `ToLocalTime()` would use the server's zone; this service asks the browser instead.
- **Walkthrough**
  - `Zone` (`ViewerTimeZone.cs:32`) defaults to `TimeZoneInfo.Utc`; `IsResolved` (`ViewerTimeZone.cs:38`)
    stays false while JS interop is unavailable, so a later call can retry.
  - `EnsureResolvedAsync` (`ViewerTimeZone.cs:49`) returns early when already resolved, then imports the
    module and invokes `getTimeZone` (`ViewerTimeZone.cs:59-60`). JS side:
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/time-zone.js:6` returns the
    `Intl.DateTimeFormat` zone id, or null when the browser cannot say.
  - Failure handling is split by whether a retry could help. `InvalidOperationException` (SSR
    prerender, no interop yet), `JSDisconnectedException` and `OperationCanceledException` return false
    without marking resolved (`ViewerTimeZone.cs:62-74`); a `JSException` means the browser answered
    with an error, so the zone id becomes null and resolution is final (`ViewerTimeZone.cs:76-80`).
  - On success it sets `IsResolved`, resolves the id through the private `ResolveZone`, and returns
    whether the zone id changed (`ViewerTimeZone.cs:82-86`), so the caller knows whether to re-render.
    `ResolveZone` (`ViewerTimeZone.cs:122`) falls back to UTC for a missing or unknown id.
  - `ToViewerTime` (`ViewerTimeZone.cs:97`) reads `Utc` and `Unspecified` kinds as UTC (a deserialized
    value often arrives unspecified) and normalizes `Local` first, then calls
    `TimeZoneInfo.ConvertTimeFromUtc`. `Format` (`ViewerTimeZone.cs:112`) formats that result with
    `CultureInfo.CurrentCulture`, default format `"g"`.
  - `DisposeAsync` (`ViewerTimeZone.cs:116`) forwards to the module wrapper.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)
  treats locale as a per-viewer concern. Returning a "changed" boolean from `EnsureResolvedAsync`
  keeps the service free of render coupling: the page decides whether to call `StateHasChanged`.
  Swallowing prerender interop failures lets the same component render on the server (UTC) and then
  correct itself after hydration.
- **Where it's used**: registered with `TryAddScoped<ViewerTimeZone>()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:190`) and injected by
  `NotificationList.razor.cs:26`, `NotificationInbox.razor.cs:36` and `Sessions.razor.cs:34` under
  `MMCA.Common.UI/Pages/`, plus ADC pages such as
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/Points/MyPoints.razor.cs`.
  Covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Culture/ViewerTimeZoneTests.cs`.

### ChannelReferenceCounter
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16` · Level 0 · class (internal, sealed)

- **What it is**: a small self-synchronized counter that tracks how many outstanding joins the circuit
  holds for each live-channel key, so [NotificationHubService](#notificationhubservice) tells the
  SignalR server to join a group on the first join and to leave it only on the last matching leave.
- **Depends on**: nothing first-party. It is a `System.Threading.Lock` plus a `Dictionary<string, int>`
  (BCL). It is owned as a private field by [NotificationHubService](#notificationhubservice)
  (`NotificationHubService.cs:62`), and sits beside (not inside) the separate handler bookkeeping that
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
  `AddRef` in `JoinChannelAsync` (`NotificationHubService.cs:324`, deliberately counted before the
  connection is started so the replay inside `StartAsync` sees it, line 196), `Release` in
  `LeaveChannelAsync` (line 229), and `Snapshot` in `RejoinChannelsAsync` (line 351). Covered directly
  by `ChannelReferenceCounterTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:569`,
  whose summary names the H13 regression it locks down, lines 314-319). The two concurrent holders it
  exists for are real: [LiveEventListener](group-22-engagement-module.md#liveeventlistener) and the
  [HappeningNow](group-23-engagement-live-layer.md#happeningnow) page both join the same event
  channel key.
- **Caveats / not-in-source**: it counts joins only; it knows nothing about handlers. Subscriptions
  live in a separate `_channelSubscriptions` dictionary under a different lock
  (`NotificationHubService.cs:55,63`), so disposing a [ChannelSubscription](#channelsubscription)
  does not decrement the count, and leaving a channel does not remove handlers
  (`NotificationHubService.cs:348-349` states that pairing requirement).

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
    `=> Task.FromResult<string?>(null)` (`INotificationScopeProvider.cs:41`), so an application with no
    display name, and every implementation written before the member existed, keeps compiling untouched
    (the rationale is stated in the doc at lines 31-37). `[Rubric §15, Best Practices & Code Quality]` assesses
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
    direction there (`INotificationScopeProvider.cs:34-36`).
- **Walkthrough**: two members.
  - `Task<string?> GetCurrentScopeKeyAsync(CancellationToken ct = default)`
    (`INotificationScopeProvider.cs:22`) returns the key currently in force (the example in source is
    `"event:2"`) or null when the application is unscoped (lines 17-21).
  - `Task<string?> GetCurrentScopeDisplayNameAsync(CancellationToken ct = default)` (line 41) returns a
    human-readable name for that scope (the conference event's title, the tenant's name). The send page
    uses it to caption which scope the notification will be tagged with, so an operator can see the
    auto-applied scope rather than infer it (lines 24-30). The doc is explicit that the scope only
    decides which inbox view lists the notification and does not narrow delivery, which goes to every
    recipient the application's recipient provider returns, so the caption must not be read as the
    audience (lines 27-30). The one call site is
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:78`.
- **Why it's built this way**: an interface rather than a settings value, because the answer is dynamic
  (it changes as the app's current context changes) and may need an async lookup. Keeping the key a
  plain string keeps the framework free of any domain concept, and the never-throw rule written into
  the contract is what makes the fail-closed guarantee real rather than aspirational. See
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html), which records the
  optional `ScopeKey` travelling with a send.
- **Where it's used**: injected into [NotificationInboxService](#notificationinboxservice)
  (`NotificationInboxService.cs:32`) and [PushNotificationService](#pushnotificationservice)
  (`PushNotificationService.cs:19`); registered with `TryAddScoped` against
  [NullNotificationScopeProvider](#nullnotificationscopeprovider) by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:24`). In
  MMCA.ADC the real implementation is
  [CurrentEventNotificationScopeProvider](group-22-engagement-module.md#currenteventnotificationscopeprovider).

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:52,55,118,130,166,184,267`),
  and into [NotificationInbox](#notificationinbox); driven by real-time pushes that arrive over
  [NotificationHubService](#notificationhubservice). Covered by `NotificationStateTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Notifications/NotificationStateTests.cs:13`).

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
  `[Rubric §15, Best Practices & Code Quality]` follows: the feature was additive, and an app that ignores it sees a
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

### ChannelSubscription
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:771` · Level 2 · class (private, sealed, nested)

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
  (`NotificationHubService.cs:771`), exposing `ChannelKey` (line 414) and `Handler` (line 416) as
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
  explicitly (`NotificationHubService.cs:348-349`).

### UnboundedReconnectPolicy
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/UnboundedReconnectPolicy.cs:21` · Level 0 · class (internal, sealed)

- **What it is**: the SignalR automatic-reconnect schedule for the notification hub. It never gives up and
  never waits longer than 30 seconds between attempts, with one exception: when the server refused
  authentication, it stops.
- **Depends on**: nothing first-party. Externals: `IRetryPolicy` and `RetryContext` from
  `Microsoft.AspNetCore.SignalR.Client`, `HttpRequestException` and `HttpStatusCode` (BCL).
- **Concept introduced, an unbounded retry schedule with a terminal auth exception.**
  `[Rubric §29, Resilience & Business Continuity]` assesses recovery from outages of unknown length. The
  SignalR default schedule gives up after four attempts (0, 2, 10 and 30 seconds), which leaves live notifications dead for the
  rest of a session after a longer outage; this policy replaces the give-up with a capped delay, so an
  outage of any length is recovered within `MaxDelay` of the network returning
  (`UnboundedReconnectPolicy.cs:24`). The one deliberate stop is a refused authentication, since an
  expired session cannot recover by retrying the same credentials (lines 39-42).
- **Walkthrough**:
  - `MaxDelay` (line 24) is `internal static` at 30 seconds so the hub's restart loop reuses the same cap
    ([NotificationHubService](#notificationhubservice) `MaxRetryDelay`, `NotificationHubService.cs:124`).
  - `WarmUp` (lines 26-31) is the first four delays: zero, 2, 5 and 10 seconds.
  - `NextRetryDelay` (line 35) null-checks the context, returns `null` (stop) when
    `IsAuthenticationRefused(retryContext.RetryReason)` (lines 39-42), otherwise indexes `WarmUp` by
    `PreviousRetryCount` and falls back to `MaxDelay` once the warm-up is spent (lines 44-46).
  - `IsAuthenticationRefused` (line 55) walks the exception and its `InnerException` chain looking for an
    `HttpRequestException` whose `StatusCode` is `Unauthorized` or `Forbidden` (lines 57-62), and for an
    `AggregateException` it answers from any member (lines 64-67). The hub's socket factory rethrows a
    refused WebSocket handshake as exactly that exception so this check can see the status
    (`NotificationHubService.cs:549-608`).
- **Why it's built this way**: a policy class instead of the lambda overload keeps the auth-refusal rule
  testable on its own and shared with the start loop in `NotificationHubService` (line 280), so the
  automatic reconnect and the restart loop agree on when to stop. It is `internal sealed` because it is
  an implementation detail of the hub service. The hub class doc states the contract (`NotificationHubService.cs:32-41`).
- **Where it's used**: passed to `WithAutomaticReconnect(new UnboundedReconnectPolicy())` by
  [NotificationHubService](#notificationhubservice) (`NotificationHubService.cs:206`), and its
  `IsAuthenticationRefused` is called again from the start loop (`NotificationHubService.cs:280`).

### NotificationHubService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:44` · Level 2 · class (sealed, partial)

- **What it is**: the client-side SignalR connection manager. It opens a connection to
  `/hubs/notifications` after login, invokes a callback for received notifications (after an optional
  per-notification filter), and carries the ephemeral live-channel events that components join and
  subscribe to.
- **Depends on**: [ApiSettings](#apisettings) (for the hub URL, via `IOptions<ApiSettings>`, reading
  `SameOriginApiEndpoint` first and `ApiEndpoint` second),
  [ITokenStorageService](#itokenstorageservice) (for the bearer token on a direct connection);
  [UnboundedReconnectPolicy](#unboundedreconnectpolicy) (the reconnect schedule and the
  auth-refusal test); [ChannelReferenceCounter](#channelreferencecounter) (membership counting) and
  [ChannelSubscription](#channelsubscription) (its subscription handle). Externals:
  `Microsoft.AspNetCore.SignalR.Client` (`HubConnection`, `HubConnectionBuilder`),
  `Microsoft.AspNetCore.Http.Connections.Client` (`HttpConnectionOptions`), `ClientWebSocket`,
  `ILogger<T>` with `[LoggerMessage]` source generation, `System.Threading.Lock`, `SemaphoreSlim` and
  `CancellationTokenSource`; implements `IAsyncDisposable`.
- **Concept introduced, resilient client-side real-time with re-joinable channels and a lifetime.**
  `[Rubric §6, CQRS & Event-Driven]` extends to the browser here: the server pushes notifications and
  channel events over SignalR instead of the client polling for everything.
  `[Rubric §29, Resilience & Business Continuity]` shows in six distinct mechanisms, each with its
  rationale in source:
  - the initial connect retries with exponential backoff up to `MaxRetries = 3` starting at
    `InitialRetryDelay` of 2 seconds and doubling (lines 46, 118, 254-302), so a token-not-yet-ready or
    API-still-starting race recovers;
  - `WithAutomaticReconnect(new UnboundedReconnectPolicy())` (line 206) keeps long sessions alive for as
    long as the service lives, never giving up and waiting at most 30 seconds between attempts, and
    because SignalR group membership does not survive a new connection, `Reconnected` re-joins every held
    channel (line 226, `RejoinChannelsAsync` lines 698-721);
  - if the connection still closes with an error (the server refused the reconnect), `Closed` runs
    `RestartAfterCloseAsync` (line 231, lines 633-667): a loop that repeats the serialized start, with a
    doubling backoff capped at `MaxRetryDelay` (line 124, defaulting to `UnboundedReconnectPolicy.MaxDelay`),
    until one connects, so live notifications do not stay dead for the rest of the session. A `Closed`
    with a null error is a deliberate stop or dispose and is never restarted (line 231; class doc lines
    32-41);
  - a **lifetime** token ends every start and restart loop on `StopAsync` or `DisposeAsync`. `_lifetime`
    (line 71) is canceled and replaced by `StopCoreAsync` (lines 436-480); each loop runs under the token
    it began in and re-checks `IsLifetimeOver` (line 669) under `_startSync` before building or starting a
    connection, so nothing begun before a stop connects after it, and the cancellation also cuts short the
    backoff delays and an in-flight connect (`DelayUnlessStoppedAsync`, lines 498-508);
  - a refused authentication (401 or 403) ends both the automatic reconnect and the restart loop: the
    start loop logs `LogAuthenticationRefused`, discards the connection and returns `false`
    (lines 280-287), which `RestartAfterCloseAsync` reads as "stop" (lines 651-656). The next
    `StartAsync` tries again;
  - a terminal start failure **discards** the connection object (`DiscardUnstartedConnectionAsync`,
    lines 622-631) instead of leaving it in the field, because a connection that never started must
    not satisfy the guard in `StartCoreAsync`, or every later `StartAsync` (including one reached
    through `JoinChannelAsync`) would no-op forever (comment at lines 293-295). The guard itself only
    leaves a connected, connecting or reconnecting connection alone (line 241); a `Disconnected` one is
    discarded and rebuilt (lines 246-249);
  - `StartAsync` is serialized by a `SemaphoreSlim` (line 60), since two components calling
    `JoinChannelAsync` at once on Blazor Server (which has no single synchronization context) could
    both see a null connection, both build one, and leak the loser socket with duplicate server
    registrations (doc lines 136-142).
  `[Rubric §13, Observability & Operability]` applies too: every outcome is a source-generated
  structured log (lines 738-769, including `LogReconnectExhausted` at line 748 and `LogRestartRetrying`
  at line 751), and failures on the channel paths are logged, never thrown.
- **Walkthrough**:
  - Constants and fields: the four hub method names (lines 47-50), `_sameOriginProxyEndpoint`
    (line 53), `_channelSync` guarding the subscription dictionary (line 55), `_lifetimeSync` guarding
    the lifetime swap (line 56), `_startSync` guarding start (line 60, a `SemaphoreSlim` rather than a
    `Lock` because the guarded body awaits, lines 58-59), the
    [ChannelReferenceCounter](#channelreferencecounter) (line 62), and `_channelSubscriptions` mapping a
    channel key to its handler list (line 63).
  - `NotificationCallback` (line 77) is a settable `Func<string, string, Task>?` the host assigns to
    surface a snackbar. `NotificationFilter` (line 85) is an optional
    `Func<IReadOnlyDictionary<string, string>?, Task<bool>>` consulted with the notification's live
    metadata (null for an unscoped send) before the callback runs; `false` drops the notification for this
    client, which is how the listener leaves another scope's notifications out of the toast and the badge.
    `IsConnected` (line 112) reports the connection state; `InitialRetryDelay` (line 118) and
    `MaxRetryDelay` (line 124) are `internal` and settable so a test can exercise the terminal-failure path
    and the unbounded restart loop without waiting out the real backoff; `ConnectionFactory` (line 130) is
    an `internal` test-only hook that replaces the `HubConnectionBuilder` call so a test can supply a
    connection over an in-memory transport, and is null in production.
  - The constructor (lines 87-103) null-checks the options (line 94), records
    `ApiSettings.SameOriginApiEndpoint` (line 100), and builds `_hubUrl` from that endpoint, falling
    back to `ApiSettings.ApiEndpoint` and throwing when neither is set (line 101), trimmed of its
    trailing slash plus `/hubs/notifications` (line 102). `UsesSameOriginProxy` (line 109) reports which
    path was taken. The same-origin path serves a WebAssembly client of an opted-in host: the hub is
    reached through the UI host's `/api` proxy, which attaches the bearer from the HttpOnly session
    cookie on the WebSocket upgrade (the only request, since negotiation is skipped), so the connection
    carries no client-held token (comment at lines 96-99).
  - `StartAsync` (lines 144-152) bails when disposed and otherwise calls `StartForLifetimeAsync` with the
    current lifetime token (`CurrentLifetime`, lines 482-496). `StartForLifetimeAsync` (lines 162-200)
    returns `true` when the lifetime is over, waits on `_startSync` with the lifetime token (tolerating
    `ObjectDisposedException` and `OperationCanceledException`, both treated as "nothing left to start"),
    re-checks the lifetime under the gate, runs `StartCoreAsync`, and releases in a `finally` that
    tolerates the disposal race. Its `bool` result is `false` only when the server refused authentication.
  - `BuildConnection(lifetime)` (lines 202-234) builds the `HubConnection` from `ConnectionFactory` when
    set or from a `HubConnectionBuilder` configured by `ConfigureConnection` with the unbounded reconnect
    policy (lines 203-207). It registers `ReceiveNotification`, which applies `NotificationFilter` and then
    `NotificationCallback` (lines 209-220), and `ReceiveChannelEvent` to `DispatchChannelEventAsync`
    (line 222), wires the reconnect re-join (line 226) and the close-with-error restart bound to this
    connection's lifetime (line 231).
  - `StartCoreAsync(lifetime)` (lines 236-308) returns `true` immediately unless the existing connection
    is null or `Disconnected` (line 241), discards a dead one (lines 246-249), builds a connection
    (line 251), then runs the retry loop: each attempt first checks the lifetime (lines 256-260), starts
    the connection under the lifetime token (line 264), and on success replays any channel joins requested
    before the connection came up (line 268). A failure while the lifetime is over is not a failure
    (lines 273-278); a refused authentication returns `false` (lines 280-287); the last attempt logs and
    discards (lines 289-298).
  - `ConfigureConnection(options)` (lines 533-551) applies the transport options. Both modes skip
    negotiation and use WebSockets only (lines 537-538): negotiate and connect are separate requests, and
    behind a non-sticky ingress with several hub replicas the connect can land on a replica that never
    issued the connection id, so WebSockets are required and there is no Server-Sent Events or
    long-polling fallback (doc lines 511-516). Through the same-origin proxy it returns early, sending no
    token and no extra header (lines 540-543). On a direct gateway connection it binds
    `AccessTokenProvider` to `ITokenStorageService.GetAccessTokenAsync` (line 545) and, outside the
    browser, installs `ConnectWebSocketAsync` as the socket factory (lines 547-550).
  - `ConnectWebSocketAsync` (lines 577-615) opens a `ClientWebSocket`, copies the configured headers and
    the bearer, and connects. When the server answered the upgrade with a non-101 status it rethrows an
    `HttpRequestException` carrying that status (lines 599-609), which is what lets
    `UnboundedReconnectPolicy.IsAuthenticationRefused` recognise a 401 or 403; a bare `WebSocketException`
    would not carry it.
  - `JoinChannelAsync(channelKey)` (lines 319-341) counts the join **before** starting the connection
    so the replay inside `StartAsync` sees it (lines 323-326), then invokes the server `JoinChannel`
    only on the first join and only when connected (lines 328-340).
  - `LeaveChannelAsync(channelKey)` (lines 352-371) is the mirror: it invokes `LeaveChannel` only when
    `Release` reports the last outstanding leave (lines 356-370).
  - `OnChannelEvent(channelKey, handler)` (lines 382-400) creates a
    [ChannelSubscription](#channelsubscription) and appends it to the channel's handler list under
    the lock, returning the subscription as the unsubscribe token. Subscribing deliberately does not
    join the channel; the doc says to call `JoinChannelAsync` as well (lines 376-377).
  - `DispatchChannelEventAsync` (lines 671-696) snapshots the subscriber list under the lock
    (line 681), then invokes each handler in isolation, logging (never rethrowing) a failure so one bad
    subscriber cannot starve the rest (lines 684-695).
  - `StopAsync` (line 410) is a no-op once disposed and otherwise calls `StopCoreAsync` (lines 436-480),
    which swaps in a fresh `CancellationTokenSource` under `_lifetimeSync`, cancels and disposes the ended
    one, then takes `_startSync` so no start can build anything after the stop returns, and disposes and
    clears the connection. `DisposeAsync` (lines 413-434) sets `_disposed`, stops, disposes the
    semaphore, and cancels and disposes the final lifetime. The comment at lines 423-424 records why that
    is safe: the stop already canceled any start in flight and waited for it to release the gate.
    `RestartAfterCloseAsync` also checks the lifetime first (lines 635-638), so a close during teardown
    starts nothing.
- **Why it's built this way**: sealed and scoped per circuit, because a connection and its channel
  membership are per-user-session. Best-effort semantics (join, leave and handler failures are logged,
  not thrown) match the reality that live updates are a convenience layered over the authoritative API,
  not a correctness guarantee, and isolating handler invocations protects the fan-out. Binding every
  start and restart to a lifetime token is what makes an unbounded retry safe: without it a loop that
  never gives up could outlive a logout or a disposed circuit. The overall shape is the client half of
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), with push notifications
  themselves covered by
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html). Choosing the transport
  once in the constructor, and keeping the token-or-no-token decision in `ConfigureConnection`, is what
  lets the same service run either directly against the gateway or behind the same-origin API proxy of
  [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html) without a client-held
  token.
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
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:29` · Level 4 · class (sealed)

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
    `SendReadWithAuthRefreshAsync` (lines 128-153) is the interesting mechanism: a badge poll or an
    inbox load that lands on an access token the server has already rejected gets one forced token
    refresh and one replay, instead of surfacing as an empty inbox or a blanked badge (lines 16-19).
    The doc states the constraint that makes it safe (lines 121-125): only the reads use it, because
    they are safe to replay, whereas a mark-read PUT is left with its existing single-shot behavior.
    `[Rubric §29, Resilience & Business Continuity]` is the category; `[Rubric §11, Security]` is the
    reason it is bounded, one attempt, no loop.
  - **A failure is "unknown", deliberately not zero.** The comment on the unread count (lines 73-75)
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
    `tokenRefresher` (`NotificationInboxService.cs:29-34`); `Endpoint` is the constant
    `"notifications/inbox"` (line 36); `_refreshSync` and `_refreshInFlight` (lines 38-39) hold the single-flight token refresh. The refresher's default of `null` is documented as the
    graceful-degradation path: a host that registers none simply skips the retry, and the read reports
    failure rather than a fabricated empty result (lines 24-27).
  - `ScopeQueryAsync(separator, ct)` (lines 225-232) is the shared helper: it asks
    [INotificationScopeProvider](#inotificationscopeprovider) for the current key and returns either an
    empty string (leaving the request byte-identical to the pre-scope one, lines 217-220) or
    `{separator}scope={Uri.EscapeDataString(scopeKey)}` (line 231). The separator parameter is `"&"`
    for a URL that already carries query parameters and `"?"` for one that does not (lines 221-223).
  - `GetInboxAsync` (lines 42-60) resolves the scope with `"&"` (line 49), builds an invariant-culture
    relative URL (lines 50-52), sends through `SendReadWithAuthRefreshAsync` (lines 54-55), and reads
    a `Result<PagedCollectionResult<UserNotificationDTO>>` (lines 57-58).
  - `GetUnreadCountAsync` (lines 63-78) resolves the scope with `"?"` (line 67), goes through the same
    read path, and reads a `Result<int>` (line 76).
  - `MarkReadAsync` (lines 81-97) PUTs to `{Endpoint}/{id}/read` (line 88) on a plain authenticated
    client. It is the one method that sends no scope: the id already identifies a single notification.
  - `MarkAllReadAsync` (lines 100-115) PUTs to `{Endpoint}/read-all` **with** the scope query
    (lines 104-106), so a bulk operation is bounded by the same filter the list was read under.
  - Both mutations pass the `cancellationToken` **into** the retry policy as well as the request
    (lines 90-93, 108-111), and the comment says why: without it an abandoned mark-read sleeps out its
    full backoff budget instead of aborting.
  - `SendReadWithAuthRefreshAsync` (lines 128-153) runs the send under the retry policy inside a
    `using` for the first client (lines 133-136), returns the response untouched when it is not a `401`
    or no refresher was registered (lines 138-141), and otherwise acquires a token, disposes the first
    response, and replays on a client built with the new token (lines 143-152). The doc notes the
    response content is fully buffered before the send task completes, which is what makes it legal to
    read the body after the client that produced it is disposed (lines 124-125).
  - `TryAcquireRefreshedTokenAsync` (lines 168-201) is **single-flight**, with the same shape as the token
    storage's hydrate: two reads that both land on a rejected token (the bell poll and the inbox page
    share this scoped instance) share one rotation, because on MAUI a second rotation presenting the same
    refresh token is read as reuse and revokes the whole session (BR-206; remarks at lines 159-166). Under
    `_refreshSync` it starts `AcquireRefreshedTokenAsync` only when no refresh is in flight or the stored
    one has completed (lines 175-183), under `CancellationToken.None` so one caller giving up cannot
    cancel the refresh another is awaiting (comment at lines 170-173). Each caller stops waiting on its
    own token via `WaitAsync` (line 187), and the `finally` clears only its own finished task, so a
    still-running or newer refresh is not dropped (lines 189-200). The residual is stated in the remarks:
    it does not coordinate with the storage's own expiry-driven hydrate (lines 163-166).
  - `AcquireRefreshedTokenAsync` (lines 203-215) forces one re-acquisition and returns `null` for a
    blank token or when JS interop is unavailable during SSR prerender (lines 210-213), which is a
    "no refresh is possible here", not an error.
- **Why it's built this way**: inheriting from [AuthenticatedServiceBase](#authenticatedservicebase)
  removes per-method boilerplate for auth and retry, and wrapping every body in
  [HttpResultExecutor](#httpresultexecutor) means no method has to hand-write a try/catch to honor the
  Result-returning contract. Routing the scope through a provider (rather than a parameter on every
  call) is what keeps the UI contract unchanged while the inbox, badge and mark-all agree on one slice
  (`NotificationInboxService.cs:11-16`).
- **Where it's used**: registered against
  [INotificationInboxUIService](#inotificationinboxuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:30`); consumed
  by [NotificationBell](#notificationbell) and the [NotificationInbox](#notificationinbox) page.

### PushNotificationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:16` · Level 5 · class (sealed)

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
    `scopeProvider` (`PushNotificationService.cs:16-22`).
  - `SendAsync(request, ct)` (lines 23-52) null-guards the request (line 28), then applies scoping
    conditionally: a request that already carries a `ScopeKey` is sent unchanged, and only an unscoped
    one picks up the ambient key via a `record with` expression (lines 32-40, rationale at lines
    30-31). It then POSTs through `SendRequestAsync<PushNotificationDTO>` with a fresh
    `idempotencyKey: NewIdempotencyKey()` (lines 45-51). The send is retried on a transient failure,
    so without a key an attempt that reached the server before failing would broadcast twice; the key
    rides on every attempt so the `[Idempotent]` endpoint collapses the duplicate (comment at
    lines 42-44). `NewIdempotencyKey()` is a GUID in `N` format
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:51`), and
    the base sets it as a default header on the one client that serves every retry attempt
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:407-414`).
  - `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` (lines 54-64) builds an invariant-culture
    `pageNumber`/`pageSize` query (line 60) and sends a GET through the same helper (lines 61-63),
    with no idempotency key since a read is safe to repeat.
    Note it does **not** send a scope: history is the admin's full send log.
- **Why it's built this way**: delegating transport, auth, retry and error translation to
  [EntityServiceBase](#entityservicebasetentitydto-tidentifiertype) keeps this class down to two short
  methods, matching the framework's "UI services are typed HTTP clients, never raw `HttpClient`"
  convention. Reading the scope through the same
  [INotificationScopeProvider](#inotificationscopeprovider) the inbox service uses is what makes a
  send and the reads that follow it resolve to one scope
  (`PushNotificationService.cs:10-15`); the wire-level `ScopeKey` on the request is recorded in
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Where it's used**: registered against
  [IPushNotificationUIService](#ipushnotificationuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:27`); injected
  into the admin pages [NotificationList](#notificationlist) and
  [NotificationSend](#notificationsend).
- **Caveats / not-in-source**: `SendAsync` does not read
  `GetCurrentScopeDisplayNameAsync`; that member exists for the send page's caption and is consumed by
  [NotificationSend](#notificationsend) directly
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:78`),
  not by this service.

### BrandColors

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:10` · Level 0 · class (static)

- **What it is**: the single C# source of truth for every hex value in the theme. It holds the two brand triads (primary and secondary), the app-chrome colors shared by both modes, and the full light and dark palettes, so every hex value [MMCATheme](#mmcatheme) assigns in either MudBlazor variant is one of these constants (doc comment, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:4-5`).
- **Depends on**: nothing first-party. Part of it is mirrored by CSS custom properties in `wwwroot/app.css`; the doc comments name `--mmca-primary`, `--mmca-primary-dark`, `--mmca-primary-light`, `--mmca-secondary`, `--mmca-secondary-dark` (`BrandColors.cs:12,15,18,22,28`), plus `--mmca-sidebar-bg` on `ChromeBackground` (line 36) and `--mmca-divider` on `LightDivider` (line 80).
- **Concept introduced, a fitness-tested duplication.** `[Rubric §20, Design System & Theming]` assesses whether visual tokens are centralized rather than scattered as literals; here the whole palette lives in exactly one C# class, and the theme carries no hex literal of its own. `[Rubric §34, Architecture Governance & Documentation]` assesses whether *necessary* duplication is monitored: C# cannot read CSS at build time, so the brand colors must exist in both `BrandColors` and `app.css`, and `BrandColorTokenTests` in MMCA.Common.UI.Tests asserts the two stay in sync so the copy cannot silently drift (`BrandColors.cs:6-8`). The test pins the five brand tokens, one `InlineData` row each (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:35-39`); the `--mmca-sidebar-bg` and `--mmca-divider` mirrors are named in the doc comments but have no row there.
  - `[Rubric §21, Accessibility]` lands here rather than only in the theme: the `Secondary` constant carries its own contrast math in source, Teal 700 `#00796B` holding about 5.3:1 on light surfaces, replacing the Teal 600 `#00897B` that measured about 4.0:1 and sat under the WCAG 2.1 AA 4.5:1 floor for normal text (`BrandColors.cs:21-26`). The contrast reasoning for `LightWarning` and `DarkError` is deliberately not here: their summaries point at [MMCATheme](#mmcatheme), where the math sits beside the assignment (lines 56, 109).
- **Walkthrough**: `public const string` fields in four commented groups.
  - The primary triad: `Primary = "#1565C0"` (line 13), `PrimaryDark = "#0D47A1"` (line 16), `PrimaryLight = "#42A5F5"` used for accents and dark-mode contrast (line 19). The secondary triad: `Secondary = "#00796B"` (line 26, with the contrast rationale immediately above it at lines 21-25), `SecondaryDark = "#00695C"` (line 29), and `SecondaryLight = "#4DB6AC"` (line 32).
  - Shared chrome, identical in both palettes (line 34): `ChromeBackground = "#1A2035"` for the app bar and sidebar (line 37), `ChromeText = "#FFFFFF"` (line 40), and `ChromeTextMuted = "#FFFFFFB3"`, white at 70% alpha for sidebar text and icons (line 43).
  - The light palette (lines 45-84): `LightTertiary` Purple 700, `LightInfo` Blue 700, `LightSuccess` Green 800, `LightWarning = "#A85D00"` with `LightWarningContrastText = "#FFFFFF"`, `LightError` Red 800, then `LightBackground = "#FAFBFC"`, `LightSurface`, the two text tones, `LightActionDefault`, and the two dividers.
  - The dark palette (lines 86-131): `DarkPrimaryLighten` Blue 200, `DarkSecondaryDarken = "#00897B"` (Teal 600, the same value the light `Secondary` was moved off for contrast, line 92), `DarkSecondaryLighten`, `DarkTertiary`, `DarkInfo`, `DarkSuccess`, `DarkWarning` Orange 400, `DarkError = "#FF8A80"` (line 110), then `DarkBackground = "#1A2027"`, `DarkSurface = "#27303A"`, text, action and divider tones. Note `DarkInfo` and `PrimaryLight` share `#42A5F5`, and `DarkTextSecondary` and `DarkActionDefault` share `#B0BEC5`: each keeps its own name so a role can change without dragging the other.
- **Why it's built this way**: `const` rather than `static readonly` means the values can appear in contexts that require compile-time constants; the governance is the fitness test, not the language keyword. Keeping every palette value in one class means a rebrand or a contrast fix touches one file plus the mirrored CSS, and the theme reads as a mapping of roles to names rather than a wall of hex.
- **Where it's used**: every palette entry of [MMCATheme](#mmcatheme) that is not an `rgba(...)` literal (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:18-54,60-120`); `BrandColorTokenTests`; the doc comment of `BrandColorTokenTestsBase`, the per-host stylesheet check that consumer repos subclass (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/BrandColorTokenTestsBase.cs:6-13`); any component that references a brand color programmatically.

### IUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/IUserPreferenceWriter.cs:9` · Level 0 · interface

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/ThemeToggle.razor:23-27`); the culture
  switcher does the same for culture before handing off to the applier
  (`CultureSwitcher.razor:38-42`).

---

### UserPreferences

> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/UserPreferences.cs:9` · Level 0 · record (sealed)

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

> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/ApiUserPreferenceWriter.cs:29` · Level 0 · record (private sealed, nested)

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

### IInitialThemeModeSource
> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/IInitialThemeModeSource.cs:14` · Level 0 · interface

- **What it is**: an optional hook that lets a head tell the theme providers the stored Day/Dark mode without JavaScript, so the first render already has the right palette instead of light-then-dark (ADR-028). Its one member, `bool? IsDarkMode` (line 21), is `true` for dark, `false` for light, and `null` when nothing is stored yet, which leaves the first render unchanged.
- **Depends on**: nothing.
- **Concept introduced, an optional capability probed with `GetService`.** `[Rubric §20, Design System, Theming & UI Consistency]` covers theming that works from the first paint. The provider asks the container for the interface and treats absence and `null` identically (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MmcaThemeProviders.razor:43-50`), so web heads register nothing and still behave as before, while the JS path in `OnAfterRenderAsync` stays the source of truth for them.
- **Why it's built this way**: the MAUI head can read its stored mode synchronously from device preferences, which a Blazor circuit cannot do with a cookie before the first render. A nullable bool keeps "unknown" distinct from "light".
- **Where it's used**: implemented by `MauiInitialThemeModeSource` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Theme/MauiInitialThemeModeSource.cs:12`) and registered as a singleton (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:68`); consumed by `MmcaThemeProviders.razor:47`; pinned by `MmcaThemeProvidersInitialModeTests`.

---

### ThemeInterop
> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/ThemeInterop.cs:9` · Level 0 · class (internal static)

- **What it is**: a one-method guard, `TryAsync(Func<Task>)` (`ThemeInterop.cs:18`), that runs a best-effort JS interop call and returns `false` instead of throwing when it fails.
- **Depends on**: `Microsoft.JSInterop` exception types (`JSException`, `JSDisconnectedException`) and `InvalidOperationException` (BCL).
- **Concept introduced, theme interop failure must not escape the component lifecycle.** `[Rubric §18, UI Architecture & Component Design]` covers resilient component lifecycles. The filter catches exactly three cases: the asset is missing or the browser call failed (`JSException`), the circuit was torn down mid-call (`JSDisconnectedException`), and interop is unavailable on this renderer (`InvalidOperationException`, a prerender race or disposed dispatcher). Any other exception still propagates.
- **Why it's built this way**: theming is cosmetic, so a failed cookie read or write degrades to "the page keeps its current mode" rather than killing the circuit from the root layout.
- **Where it's used**: `MmcaThemeProviders.razor:62,90` and `ThemeToggle.razor:22` (all under `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/`). No dedicated test file; it is exercised through the provider and toggle component tests.

---

### ThemeService
> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/ThemeService.cs:17` · Level 1 · class (sealed)

- **What it is**: the single owner of the Day/Dark preference (ADR-028). It holds the current mode for
  the circuit, persists a change through a small JS module to a cookie plus `localStorage`, and raises
  an event so every subscriber re-renders together.
- **Depends on**: [LazyJsModule](#lazyjsmodule) (single-flight importer for its JS module,
  `ThemeService.cs:20`); `Microsoft.JSInterop.IJSRuntime` (ASP.NET Core, primary-constructor parameter
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
  interactive render; the class documents that requirement on itself (`ThemeService.cs:11-14`) rather
  than guarding it internally, and the component that owns the lifecycle calls it from
  `OnAfterRenderAsync(firstRender)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MmcaThemeProviders.razor:35`).
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
  - `SetDarkModeAsync(bool)` (line 54) persists first, through `set` (line 59), then writes the field
    (line 60) and notifies (line 61): a failed import or JS call leaves `IsDarkMode` and every subscriber
    on the mode that is actually stored (comment, `ThemeService.cs:56-57`). The JS side writes a non-HttpOnly cookie with a one-year `max-age` and
    `samesite=lax` and mirrors it to `localStorage`, guarding the mirror in a `try` because private
    browsing can refuse storage (`theme.js:23-31`). The cookie is deliberately readable by the server,
    which is how SSR can paint the right theme on the first response (`theme.js:1-2`).
  - `ToggleAsync()` (line 65) is `SetDarkModeAsync(!IsDarkMode)`, the entire body of the app-bar
    toggle's click handler.
  - `DisposeAsync()` (line 70) forwards to the module wrapper, which is where the guarded release of a
    torn-down circuit's `IJSObjectReference` lives.
- **Why it's built this way**: ADR-028 (`Website/docs-src/adr/028-dark-theme-mode.md`) requires the
  preference to survive a reload and to be visible to the server for a no-flash first paint, which is
  why the value goes to a cookie and `localStorage` rather than to component state, and why the service
  holds no `MudTheme` of its own: it publishes a boolean and lets the theme providers decide what that
  means visually. Not gating `InitializeAsync` on `RendererInfo` is also deliberate and pinned: the
  prerender test uses the `get` invocation as proof that the first render ran at all
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/MmcaThemeProvidersPrerenderTests.cs:29-33`).
- **Where it's used**: registered by `AddUIShared` as scoped
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:180`) and consumed by
  `MmcaThemeProviders`, which subscribes in `OnInitialized`, initializes on first render and
  unsubscribes on dispose
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MmcaThemeProviders.razor:28,35,119`), by
  `ThemeToggle` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/ThemeToggle.razor:2,7`), by
  the MAUI head's `NativeThemeSync`, which mirrors the in-app choice onto the native chrome
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Components/NativeThemeSync.razor:17,41,52`),
  and by the login flow, which applies a returning user's stored theme
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:232-234`). Hosts that compose
  their own DI register it directly, for example MMCA.Helpdesk
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:23`). Behavior is pinned through the
  two components that drive it,
  [MmcaThemeProvidersTests](group-28-testing-infrastructure.md#per-project-test-rollup) and
  [ThemeToggleTests](group-28-testing-infrastructure.md#per-project-test-rollup), and end to end by
  `DarkModeE2ETests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Layout/DarkModeE2ETests.cs:54`).
- **Caveats**: no test file in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services` is named
  for this type; its behavior is covered only through those components, so a change to
  `InitializeAsync` surfaces as a component-test failure rather than a direct one. `OnChange` is a
  plain event with no weak-reference handling, so a subscriber that fails to unsubscribe outlives its
  component for the life of the circuit; both in-framework subscribers unsubscribe on dispose and both
  have a test asserting it. `SetDarkModeAsync` sets `IsDarkMode` only after the JS write succeeds, so a
  failed `set` throws out of the call with the in-memory mode, the persisted mode and the subscribers
  still in agreement and no `OnChange` raised. The exception is not swallowed here: the callers that
  must not take down the circuit wrap the call in [ThemeInterop](#themeinterop) (`ThemeToggle.razor:22`).

### ApiUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/ApiUserPreferenceWriter.cs:22` · Level 1 · class (sealed)

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
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/JwtTokenInfo.cs:16`). The comment
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
  (`MMCA.Common.UI/DependencyInjection.cs:199`); resolved optionally by the theme toggle
  (`ThemeToggle.razor:23-27`) and the culture switcher (`CultureSwitcher.razor:38-42`).

---

### IUserPreferenceReader

> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/IUserPreferenceReader.cs:9` · Level 1 · interface

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

### MMCATheme

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:9` · Level 2 · class (static)

- **What it is**: the single application-wide MudBlazor `MudTheme` instance, defining the brand palette (light and dark), typography, and layout radius, applied once via `MudThemeProvider` in the root layout.
- **Depends on**: [BrandColors](#brandcolors) (the palette source of truth); MudBlazor (NuGet: `MudTheme`, `PaletteLight`, `PaletteDark`, `Typography`, `LayoutProperties`).
- **Concept introduced, one theme, accessibility-justified, with contrast math for both text and non-text UI.** `[Rubric §20, Design System & Theming]` assesses whether an app has a single coherent theme rather than per-page overrides; `MMCATheme.Instance` is that one object (line 11). `[Rubric §21, Accessibility]` is unusually visible here, because most non-default color choices carry inline WCAG 2.1 AA/1.4.11 contrast math in a comment immediately above the value:
  - light `Warning = BrandColors.LightWarning` (`#A85D00`) / `WarningContrastText = BrandColors.LightWarningContrastText` (`#FFFFFF`) (lines 35-36): the palette color is used as text and as a border as often as it is a fill (`Color.Warning` on `MudText`/`MudLink`/`MudIcon` and on outlined chips/buttons), and MudBlazor's default `#F57F17` is only about 2.65:1 on Surface, failing the 4.5:1 floor everywhere it is text; `#A85D00` is 4.96:1 on Surface and 4.79:1 on Background, and is dark enough that white becomes the correct on-color label (comment, lines 29-34);
  - light `LinesInputs = "rgba(0,0,0,0.45)"` (line 42): outlined-field borders answer to the 3:1 non-text floor (WCAG 1.4.11); MudBlazor's default is only 3.03:1/3.01:1, passing with no margin, so any host that darkens Background drops it below (comment, lines 38-41);
  - dark `PrimaryContrastText = "rgba(0,0,0,0.87)"` (line 66), because white on the lightened dark-mode primary `#42A5F5` is about 2.65:1 fill-on-fill while dark text is about 6.6:1 (comment, lines 63-65);
  - dark `SecondaryContrastText`/`TertiaryContrastText`/`InfoContrastText`/`SuccessContrastText` (lines 76, 78, 80, 82): every lightened dark-mode accent takes the same Material treatment, white is 2.36-2.65:1 as a fill across the four colors while `rgba(0,0,0,0.87)` lands at 6.96-7.70:1, and each accent stays legible as text on Surface too (comment, lines 71-75);
  - dark `WarningContrastText` (line 85), white on `#FFA726` being about 2.0:1 against about 10.8:1 (line 84);
  - dark `Error = BrandColors.DarkError` (`#FF8A80`) / `ErrorContrastText = "rgba(0,0,0,0.87)"` (lines 90, 93): the previous `#EF5350` was only 3.84:1 as text on Surface, below the 4.5:1 floor wherever `Color.Error` is a label rather than a fill (inline validation copy, outlined error chips); `#FF8A80` reads 5.86:1 on Surface, with the white-vs-dark label question resolved the same way as Primary (comments, lines 86-89, 91-92);
  - dark `LinesInputs = "rgba(255,255,255,0.5)"` (line 98): the dark default `rgba(255,255,255,0.3)` is only 2.6:1 on Surface, effectively invisible to a low-vision user, while `0.5` is 4.59:1/5.10:1 (comment, lines 94-97);
  - dark `TableStriped = "rgba(0,0,0,0.2)"` / `TableHover = "rgba(0,0,0,0.32)"` (lines 107-108): the row overlays darken rather than lighten, because a link sits on the composited row and MudBlazor's default white striping turns Surface `#27303A` into about `rgb(82,89,97)`, where the link colour `#42A5F5` is only about 2.66:1 (any white overlay above roughly 3% already drops under 4.5:1); the black overlays read 5.77:1 (striped) and 6.15:1 (hover) on Surface and 6.61:1 / 6.87:1 on Background while staying visibly distinct from the plain row and from each other, and `LinkContrastTests` pins both (comment, lines 99-106).

  The `Secondary` (light) contrast rationale is deliberately *not* repeated here: line 21 points at [BrandColors](#brandcolors), where the value and its justification live together. The reverse holds for `Warning` and `Error`: their constants live in [BrandColors](#brandcolors), whose summaries point back here for the math.
- **Walkthrough**: a single `static MudTheme Instance { get; }` (line 11) initialized with four blocks. Every hex value in both palettes is a [BrandColors](#brandcolors) constant (comment, lines 15-17); the only literals left are the `rgba(...)` on-color labels and input lines, each justified by the contrast comment above it.
  - `PaletteLight` (lines 13-55) reads its primary and secondary triads from [BrandColors](#brandcolors) (lines 18-24), sets the semantic colors from the `Light*` constants (`Tertiary`, `Info`, `Success`, `Warning`, `Error`, lines 25-37, including the WCAG-driven `Warning` and `LinesInputs` values above), and then fixes app chrome: `AppbarBackground` and `DrawerBackground` from `BrandColors.ChromeBackground`, `DrawerText`/`DrawerIcon` from `ChromeTextMuted`, and background, surface, text, action and divider values from the matching `Light*` constants (lines 43-54).
  - `PaletteDark` (lines 56-121) lightens the primary for contrast on dark surfaces (`Primary = BrandColors.PrimaryLight`, line 60), darkens the table row overlays (lines 107-108, above), takes the same `Chrome*` constants for app bar and drawer so the shell reads identically in both modes (lines 109-115), and darkens the surface stack (`Background = BrandColors.DarkBackground`, `Surface = BrandColors.DarkSurface`, lines 111-112) with the `Dark*` text and divider tones.
  - `Typography` (lines 122-200). `Default` sets the font stack `Inter, Segoe UI, Helvetica Neue, Arial, sans-serif`; the comment above it records that Inter is self-hosted by this RCL (`wwwroot/fonts` plus an `@font-face` block in `wwwroot/app.css`) and that before those faces existed the stack silently fell through to Segoe UI, so the two must stay in step. `H1` through `H4` use display weights 800/800/700/700 with slight negative letter spacing, which the comment explains is how Inter is meant to be set at large sizes; `H5` and `H6` stay at weight 600 with no negative tracking. `Subtitle1`/`Subtitle2` sit at weight 500, `Body1`/`Body2` set line heights 1.6 and 1.5, and `Button` sets `TextTransform = "none"`, because MudBlazor's default uppercasing wrecks localized strings (German compounds, accented capitals) and reads dated; weight 600 keeps the label as prominent as the shouting did.
  - `LayoutProperties` sets `DefaultBorderRadius = "6px"` (lines 201-204).
- **Why it's built this way**: a static get-only property means the theme is constructed once and shared by every `MudThemeProvider`. Sourcing every hex value from [BrandColors](#brandcolors) rather than re-typing it is what lets `BrandColorTokenTests` police C# versus CSS drift and keeps this class a mapping of roles to named colors, and the per-color contrast comments turn accessibility decisions into reviewable source rather than tribal knowledge, now covering both text-on-fill (4.5:1) and non-text UI like input borders (3:1, WCAG 1.4.11) rather than text alone. The button-casing override is a small but instructive case of `[Rubric §27, Internationalization & Localization]` reaching into theming: a purely visual default became a localization problem.
- **Where it's used**: applied in the root layout of the Blazor Web and MAUI hosts via `MudThemeProvider Theme="MMCATheme.Instance"`.

### ApiUserPreferenceReader
> MMCA.Common.UI · `MMCA.Common.UI.Services.Preferences` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/ApiUserPreferenceReader.cs:14` · Level 2 · class (sealed)

- **What it is**: the default [IUserPreferenceReader](#iuserpreferencereader). It GETs
  `auth/preferences` with the signed-in user's bearer token and hands back the culture and theme the
  user chose on some other device, or empty preferences when there is nothing to read.
- **Depends on**: [IUserPreferenceReader](#iuserpreferencereader) (the contract,
  `ApiUserPreferenceReader.cs:16`), [UserPreferences](#userpreferences) (the two-nullable-field record
  it returns, line 18), [ITokenStorageService](#itokenstorageservice) (primary-constructor parameter,
  line 15), [JwtTokenInfo](#jwttokeninfo) (the freshness check, line 31); `IHttpClientFactory` and
  `System.Net.Http.Json` (BCL) for the named `"APIClient"`.
- **Concept introduced, a best-effort read that cannot fail its caller.**
  `[Rubric §6, CQRS & Event-Driven Design]` assesses whether a secondary concern is prevented from
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
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:146-147`), then
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:199-200`).
- **Where it's used**: registered by `AddUIShared` with `TryAddScoped`
  (`DependencyInjection.cs:200`) and injected by exactly one page, the framework's login page
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:14`). Its
  `ApplyStoredPreferencesAndNavigateAsync` calls `GetAsync`, applies a stored theme through
  [ThemeService](#themeservice), and, when the stored culture differs from the current one, hands the
  rest of the navigation to [ICultureApplier](#icultureapplier), which owns the head-specific switch
  (`Login.razor:228-248`).
- **Caveats**: no test under `MMCA.Common/Tests` names this type, while its sibling writer has
  [ApiUserPreferenceWriterTests](group-28-testing-infrastructure.md#per-project-test-rollup); the
  reader's guard and its two catch paths are unpinned. Because `TaskCanceledException` is caught
  unconditionally, a caller that cancels its own token receives `Empty` rather than an
  `OperationCanceledException`, which is the opposite of the convention
  [HttpResultExecutor](#httpresultexecutor) enforces elsewhere in this package; the single caller
  passes no token (`Login.razor:230`), so the difference is invisible in current use.

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

### BlazorCircuitLimitSettings

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Hardening` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: the bound options type for a Blazor Server host's circuit hardening, three numbers under the `BlazorCircuitLimits` configuration section: a ceiling on concurrently active circuits, a ceiling on disconnected circuits retained for reconnect, and how long a disconnected circuit is retained.
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations.RangeAttribute` on all three properties (`BlazorCircuitLimitSettings.cs:37`, `:45`, `:56`) is what makes the settings self-validating. The class doc (`:9-15`) states it is deliberately separate from [UiRateLimitingSettings](#uiratelimitingsettings): the rate limiter bounds how fast requests arrive, while a circuit is state that stays resident on the server for as long as the connection lives, so a caller opening circuits slowly enough to stay inside the rate window still accumulates them without this ceiling.
- **Concept introduced, sizing an abuse ceiling from the container rather than from traffic.** The doc comment on `MaxActiveCircuits` (`:26-36`) derives 200 from the container a Blazor UI host typically runs in (0.25 vCPU, 0.5 GiB): roughly 200 MiB of that half-gibibyte is the runtime, the framework and the static assets the host also serves, leaving on the order of 300 MiB for circuit state, and a MudBlazor page's server-side render tree costs a few hundred kilobytes up to about a megabyte, so 200 fits with headroom on memory and is already generous on the 0.25 vCPU side, where render throughput binds first. It sits far above real demand for a host rendering Interactive Auto, where a returning visitor's session moves to the WebAssembly runtime after the first render and holds no circuit at all: the number is an abuse ceiling, not a capacity plan. [Rubric §29, Resilience & Business Continuity] assesses exactly this: a documented, container-derived ceiling rather than an arbitrary round number. [Rubric §11, Validation] applies through the `[Range]` attributes that fail startup on an out-of-range value (see [BlazorCircuitLimitExtensions](#blazorcircuitlimitextensions)).
- **Walkthrough**
  - `SectionName => "BlazorCircuitLimits"` (`:20`) is the configuration section this type binds from.
  - `MaxActiveCircuits` (`:37-38`), `[Range(1, 100_000)]`, defaults to `200`.
  - `DisconnectedCircuitMaxRetained` (`:45-46`), `[Range(0, 10_000)]`, defaults to `25`, tighter than the Blazor framework default of 100 because a retained circuit holds the same state an active one does while serving nobody (`:41-43`).
  - `DisconnectedCircuitRetentionSeconds` (`:56-57`), `[Range(5, 3600)]`, defaults to `60`, tighter than the framework's three minutes: a visitor who really did drop off Wi-Fi reconnects within seconds, and everything beyond that is memory held for someone who is gone (`:49-54`). The doc comment says a host whose audience sits on a flaky shared network (a conference venue, where someone walking between rooms should come back to the state they left) raises this back towards the framework's 180 and leans on `DisconnectedCircuitMaxRetained` to bound the memory.
- **Why it's built this way**: the three numbers are kept in one bound, validated options type instead of inline literals so the ceiling can be tuned per environment through configuration without a code change, and so an out-of-range value fails fast at startup via [BlazorCircuitLimitExtensions](#blazorcircuitlimitextensions)'s `ValidateOnStart()` rather than silently at runtime. See [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) for the edge-hardening posture this settings type is part of.
- **Where it's used**: bound and registered by [BlazorCircuitLimitExtensions](#blazorcircuitlimitextensions)'s `AddBoundedBlazorCircuits()`; read by [BoundedCircuitHandler](#boundedcircuithandler) for the active-circuit ceiling and by `BlazorCircuitLimitExtensions.RetentionFrom` for the disconnected-circuit settings.

### OptionalEmailAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/OptionalEmailAttribute.cs:25` · Level 0 · class (sealed, `ValidationAttribute`)

- **What it is**: a DataAnnotations rule that a string property, when it has a value, must look like an email address. A blank value passes, so the attribute never makes a field required.
- **Depends on**: nothing first-party. Externals: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`). Like its sibling [AbsoluteUrlAttribute](#absoluteurlattribute), it is run on a MudBlazor field by [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) through the [ModelValidation](#modelvalidation) bridge.
- **Concept introduced, a deliberately loose format check that mirrors the server's rule.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether the client enforces what the server enforces. The private `IsValidEmailFormat` (`OptionalEmailAttribute.cs:59-65`) accepts exactly one `@` with at least one character on each side of it (`index > 0`, `index != value.Length - 1`, `index == value.LastIndexOf('@')`). Its doc comment (`:52-56`) names this as the server's email format rule, so the form does not reject an address the API would accept, nor accept one the API would refuse.
  - **Optionality is the caller's decision.** A non-string, null, empty or whitespace value returns `ValidationResult.Success` (`:38-41`), the same contract as `AbsoluteUrlAttribute`: a mandatory field pairs this with `[Required]`.
- **Walkthrough**
  - The parameterless constructor (`:28-31`) passes the default English message `"Enter a valid email address."` to the base class.
  - `IsValid(object?, ValidationContext)` (`:34-50`) null-guards the context (`:36`), lets blanks through, then calls `IsValidEmailFormat`. On failure it builds the member-name array from `validationContext.MemberName` when present and returns `new ValidationResult(ErrorMessage, members)` (`:48-49`), so the failure attaches to the right field.
  - `IsValidEmailFormat(string)` (`:59-65`): `IndexOf('@', StringComparison.Ordinal)` plus the three index checks above, with no regular expression.
- **Why it's built this way**: the check is a plain index test, not an RFC parser, so the client verdict cannot drift from the server's equally simple rule, and the ordinal comparison avoids culture sensitivity.
- **Where it's used**: exercised by `OptionalEmailAttributeTests` in MMCA.Common.UI.Tests (`Validation/OptionalEmailAttributeTests.cs`).
- **Caveats / not-in-source**: which consumer models carry this attribute is not visible from this file.

### UiRateLimitingSettings

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Hardening` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:33` · Level 0 · class (sealed)

- **What it is**: the bound options type for a Blazor Web host's own edge rate limiting, under the `UiRateLimiting` configuration section: an on/off switch, a per-client-IP request budget and window, and a replica-wide concurrency ceiling.
- **Depends on**: nothing first-party; `RangeAttribute` on `PermitLimit`, `WindowSeconds`, and `GlobalConcurrencyLimit` (`UiRateLimitingSettings.cs:57`, `:61`, `:75`).
- **Concept introduced, a Blazor host's own edge limiter because it is a separate origin from the Gateway.** The class doc (`:9-32`) states why a UI host needs one at all: the Blazor UI is a separate externally reachable origin from the Gateway (its own FQDN), so the ADR-088 Gateway edge limiter never sees a request to it, and every page load on this origin opens an interactive Server circuit against a typically 0.25 vCPU / 0.5 GiB container. It is shaped like the Gateway's limiter (same per-IP-plus-global-concurrency pairing, anonymous traffic included) but shipped as a distinct kit rather than referenced from `MMCA.Common.Gateway`, because a Blazor host is not a reverse proxy and its exemptions differ (it serves `/_framework` and `/_content` itself). Both counts are per replica, in memory, the same deliberate trade the Gateway kit makes: an edge limiter answers in microseconds on every request, and a shared counter would put a network round trip in front of the whole site. [Rubric §29, Resilience & Business Continuity] and [Rubric §11, Validation] apply as with [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings): a documented, traffic-shape-derived number behind `[Range]` validation.
- **Walkthrough**
  - `SectionName => "UiRateLimiting"` (`:36`).
  - `Enabled` (`:43`), default `true`; the doc comment (`:39-42`) calls out its escape hatch use, a load or capacity proof driven from one runner IP that the per-IP window cannot tell from a flood.
  - `PermitLimit` (`:57-58`), `[Range(1, 1_000_000)]`, default `300`, which no real visitor approaches (a page load costs a handful of requests once static assets are exempt, and Interactive Auto hands the session to WebAssembly after the first render). The doc comment (`:48-56`) sets it well above a single visitor on purpose because an office or mobile-carrier NAT presents many visitors as one IP, and tells a host whose audience sits behind one address (a venue's wifi, a single corporate egress) to raise it, since the whole crowd arrives as a single partition key.
  - `WindowSeconds` (`:61-62`), `[Range(1, 3600)]`, default `60`.
  - `GlobalConcurrencyLimit` (`:75-76`), `[Range(1, 1_000_000)]`, default `200`: a ceiling rather than a rate, guarding against a slow downstream backing up threads on this replica; excess requests are rejected with 429 immediately rather than queued (`:64-74`), and unlike the per-IP window it needs no widening for a shared-address audience because in-flight concurrency is bounded by what the container can render, not by how many people share an address. The doc comment (`:71-73`) also records that the Blazor circuit transport (`/_blazor`) is excluded from this ceiling: a circuit WebSocket would hold one permit for its whole lifetime, so open circuits are bounded by `BlazorCircuitLimits:MaxActiveCircuits` ([BlazorCircuitLimitSettings](#blazorcircuitlimitsettings)) instead.
- **Why it's built this way**: same rationale as [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings), a bound, validated, environment-tunable options type rather than inline literals in [UiRateLimitingExtensions](#uiratelimitingextensions). See [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) and [ADR-124](https://ivanball.github.io/docs/adr/124-blazor-circuit-ceiling-ui-edge.html) for the split between the request concurrency ceiling and the circuit ceiling.
- **Where it's used**: bound and read by [UiRateLimitingExtensions](#uiratelimitingextensions)'s `AddUiRateLimiting()`, which closes over a resolved instance rather than `IOptions<T>` per request (see that section).

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
- **Where it's used**: constructed inline on a page over that page's localizer and handed to [ModelValidation](#modelvalidation)`.For`, exactly as [NotificationSend](#notificationsend) does (`NotificationSend.razor.cs:77`).

### BoundedCircuitHandler

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Hardening` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:43` · Level 1 · class (sealed, partial, `CircuitHandler`)

- **What it is**: a Blazor `CircuitHandler` that refuses a new circuit once this replica already holds [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings)`.MaxActiveCircuits` active circuits, and counts circuits back down as they close.
- **Depends on**: `CircuitHandler` (base class), `IOptions<BlazorCircuitLimitSettings>` and `ILogger<BoundedCircuitHandler>` (primary-constructor parameters, `BoundedCircuitHandler.cs:43-45`).
- **Concept introduced, a singleton counter guarding a per-circuit-scoped hook.** The class doc (`:9-40`) states why a handler rather than `CircuitOptions`: `DisconnectedCircuitMaxRetained` bounds only circuits that already dropped their connection, and since every page load on a public Blazor origin opens one (a host rendering Interactive Auto makes the first render a Server circuit), the handler is the documented extension point that sees a circuit being opened and closed. It also states why the class throws rather than returning a refusal value: `OnCircuitOpenedAsync` returns `Task` with no "refuse" return, so an exception is the only way to stop a circuit starting, one of the few places in the framework where the Result pattern does not apply because the contract belongs to ASP.NET Core. Finally (`:31-39`) it explains the one piece of per-circuit state on a singleton: the set of admitted circuits, keyed by reference, which exists because a refused circuit is still torn down through `OnCircuitClosedAsync`, and without the set that close would release a permit some other circuit holds. [Rubric §29, Resilience & Business Continuity] assesses this directly: an explicit admission-control decision at the point circuits are opened, rather than letting an unbounded flood of circuits exhaust a replica's memory. [Rubric §14, Testability] applies through `ActiveCircuits` (`:55`), a public read-only counter the doc comment (`:51-54`) says exists so a consuming host can assert the ceiling behaves and a diagnostic endpoint can report saturation; `BoundedCircuitHandlerTests` reads it to assert the increment, decrement and floor behavior without inspecting private state.
- **Walkthrough**
  - `_admitted` (`:47`): a `ConcurrentDictionary<Circuit, byte>` constructed with `ReferenceEqualityComparer.Instance`, used as a set of the circuits this handler admitted.
  - `_activeCircuits` (`:49`) and `ActiveCircuits => Volatile.Read(ref _activeCircuits)` (`:55`): the live count, read with `Volatile.Read` because it is written from `Interlocked` calls on possibly-concurrent circuit-open/close callbacks.
  - `Order => int.MaxValue` (`:61`): runs LAST among registered handlers on the way in, so a refusal happens after cheaper handlers have already done their work rather than in the middle of it (`:57-60`).
  - `OnCircuitOpenedAsync` (`:64-85`): guards `circuit` against null (`:66`), then increments first and rolls back on refusal (`:70-75`) rather than checking-then-incrementing, because two simultaneous opens could otherwise both observe the last free slot and both take it; over the ceiling it decrements, logs via `LogCircuitRefused`, and returns a faulted `Task` carrying an `InvalidOperationException` telling the caller to retry (`:75-80`). Only an admitted circuit is added to `_admitted` (`:83`).
  - `OnCircuitClosedAsync` (`:88-109`): guards `circuit` against null (`:90`), then returns without touching the count unless `_admitted.TryRemove` finds the circuit (`:92-98`), because the framework's teardown calls every handler's close unconditionally, including for a circuit this handler refused, and that close must not release a permit another circuit holds. An admitted circuit decrements the count, which then floors at zero (`:100-106`) as a last line of defence against a count driven negative handing out permits forever.
  - `LogCircuitRefused` (`:111-114`): a `[LoggerMessage]`-generated warning logger, partial method paired with the `partial class` declaration.
- **Why it's built this way**: see [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings) for why 200 is the number; this handler is the enforcement point for that ceiling. See [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) and [ADR-124](https://ivanball.github.io/docs/adr/124-blazor-circuit-ceiling-ui-edge.html).
- **Where it's used**: registered as a singleton `CircuitHandler` by [BlazorCircuitLimitExtensions](#blazorcircuitlimitextensions)'s `AddBoundedBlazorCircuits()`, called from MMCA.ADC.UI.Web's Blazor Server host composition (`Program.cs`).

### UiRateLimitingExtensions

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Hardening` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:25` · Level 1 · class (static)

- **What it is**: the registration and pipeline wiring for a Blazor Web host's edge rate limiter, an `IServiceCollection` extension that builds a chained per-IP-and-global limiter from [UiRateLimitingSettings](#uiratelimitingsettings), and an `IApplicationBuilder` extension that adds it to the pipeline.
- **Depends on**: [UiRateLimitingSettings](#uiratelimitingsettings); `System.Threading.RateLimiting` (`RateLimitPartition`, `FixedWindowRateLimiterOptions`, `ConcurrencyLimiterOptions`, `PartitionedRateLimiter`); ASP.NET Core's `IServiceCollection`/`AddRateLimiter` and `IApplicationBuilder`/`UseRateLimiter`. The class carries a `[SuppressMessage("Naming", "CA1708", ...)]` attribute (`:18-21`) whose justification records why: with multiple `extension(T)` blocks in one static class, CA1708 flags the compiler-generated grouping members as case-colliding even though no user-visible identifier differs only by case.
- **Concept introduced, exempting probes and static assets from a per-IP window, and long-lived connections from the concurrency ceiling.** `IsExempt(PathString, PathString proxyPathPrefix)` (`:82-94`) matches two things: a fixed prefix list (`/health`, `/alive`, `/_framework`, `/_content`, `/hubs`, `:56`) plus the proxied hub path `{proxyPathPrefix}/hubs` (`:85`), all matched on whole segments so `/healthz` is not caught by `/health`; and any path OUTSIDE the proxy prefix whose last segment carries a file extension (`:90-93`). Proxied traffic is API traffic whatever its last segment looks like, so `/api/report.csv` is counted. The doc comment (`:44-55`) explains the `/hubs` entry mirrors the Gateway's own `GatewayRateLimiting:BypassPathPrefixes` bypass for long-lived SignalR traffic, so a host that ever fronts a hub on this origin is covered by declaration rather than by accident, and that the same hub traffic arriving through the same-origin API proxy ([SameOriginApiProxyEndpoint](#sameoriginapiproxyendpoint)) is exempt at whatever prefix the host configured, not a hard-coded `/api/hubs`: without it every open hub WebSocket would hold a concurrency lease for its whole lifetime and exhaust the ceiling. `/_blazor` is treated differently on each limiter (`:72-76`): it has no extension and no exemption from the per-IP window, because the negotiate endpoint is exactly what opens a circuit, but `BlazorTransportPrefix` (`:36-42`) keeps it out of the concurrency ceiling, because the same prefix carries the circuit WebSocket, whose lease would otherwise be held for the whole circuit lifetime; open circuits are bounded by [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings) and [BoundedCircuitHandler](#boundedcircuithandler) instead. [Rubric §29, Resilience & Business Continuity] applies to the chained limiter design; [Rubric §1, SOLID] applies to `IsExempt` being the single decision both partitions delegate to, so the shared exemption rule cannot drift between the two limiters, with the concurrency partition adding only the transport prefix on top.
- **Walkthrough**
  - `ExemptPartitionKey`, `UnknownIpPartitionKey`, `ConcurrencyPartitionKey` (`:28`, `:31`, `:34`): the three partition keys the limiter buckets requests into.
  - `BlazorTransportPrefix` (`:42`): `"/_blazor"`, the Blazor circuit transport (negotiate, the circuit WebSocket and its long-polling fallback), excluded from the concurrency ceiling only.
  - `ExemptPrefixes` (`:56`) and `IsExempt(PathString, PathString)` (`:82-94`): the shared exemption rule, detailed above; internal so it is unit-testable via `InternalsVisibleTo` (`:77-80`).
  - `ClientIpPartition(HttpContext, UiRateLimitingSettings, PathString)` (`:105-134`): no limiter for exempt paths, no limiter for an unresolvable client IP (fail open, `:118-124`, so an in-process `TestServer` is never collapsed into one shared bucket), otherwise a `FixedWindowRateLimiter` keyed on the client IP with `QueueLimit = 0` (rejected immediately, not queued, `:126-133`).
  - `ConcurrencyPartition(HttpContext, UiRateLimitingSettings, PathString)` (`:147-164`): the replica-wide `ConcurrencyLimiter`, one bucket for the whole process with `QueueLimit = 0`, exempt for every path `IsExempt` matches plus any path under `BlazorTransportPrefix` (`:155-156`).
  - `AddUiRateLimiting(IConfiguration)` (`:175-216`), an `IServiceCollection` extension: binds and validates `UiRateLimitingSettings` (`:180-183`), then resolves a plain instance from configuration to close over in the partition callbacks (`:188-189`) rather than resolving `IOptions<T>` per request, because the partition callback runs on the hot path of every request and an out-of-range value has already failed `ValidateOnStart()`. `RejectionStatusCode` is set to 429 in its own `AddRateLimiter` call (`:191`); when `Enabled` is false the method returns early with no `GlobalLimiter` configured (`:193-196`). Otherwise it configures `RateLimiterOptions` through `Configure<IOptions<SameOriginApiProxySettings>>` (`:201-213`), reading the proxy's `PathPrefix` from the proxy's own options (`:204`) so the limiter and the proxy cannot disagree, and chains the client-IP and concurrency partitions with `PartitionedRateLimiter.CreateChained` (`:208-212`), so a request must satisfy both.
  - `UseUiRateLimiting()` (`:225-229`), an `IApplicationBuilder` extension: calls the framework's `UseRateLimiter()`.
- **Why it's built this way**: see [UiRateLimitingSettings](#uiratelimitingsettings) for the tuning rationale. See [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) for the edge-hardening split between this host and the Gateway, [ADR-124](https://ivanball.github.io/docs/adr/124-blazor-circuit-ceiling-ui-edge.html) for why circuits are bounded by their own ceiling rather than by this limiter, and [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html) for the same-origin proxy behind the proxied-hub exemption.
- **Where it's used**: `AddUiRateLimiting` and `UseUiRateLimiting` are called from MMCA.ADC.UI.Web's Blazor Server host composition (`Program.cs`); the extension methods live on the `IServiceCollection`/`IApplicationBuilder` extension blocks (`:166`, `:219`).

### LocalizedDataAnnotationsValidator

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/LocalizedDataAnnotationsValidator.cs:21` · Level 2 · class (sealed, `ComponentBase`, `IDisposable`)

- **What it is**: a drop-in replacement for the stock `<DataAnnotationsValidator />` inside an `EditForm`. It runs the same DataAnnotations rules, but through [DataAnnotationsModelValidator](#dataannotationsmodelvalidator), so every `ErrorMessage` is resolved as a resource key and fields bound with `For` show the translated message; a message that is not a known key passes through unchanged, exactly as with the stock validator (doc comment, `LocalizedDataAnnotationsValidator.cs:9-15`).
- **Depends on**: [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (the localizing rule engine it constructs, line 54) and [SharedResource](#sharedresource) (the resource marker behind the injected `IStringLocalizer<SharedResource>`, lines 30-31). Externals: `Microsoft.AspNetCore.Components` (`ComponentBase`, `[CascadingParameter]`, `[Inject]`), `Microsoft.AspNetCore.Components.Forms` (`EditContext`, `ValidationMessageStore`, `FieldIdentifier`, `FieldChangedEventArgs`, `ValidationRequestedEventArgs`), `Microsoft.Extensions.Localization`, `System.Reflection`.
- **Concept introduced, one localizing path for both form styles.** `[Rubric §27, Internationalization & Localization]` assesses whether user-facing text, validation messages included, resolves per culture from one catalog. The MudForm pages already localize through [ModelValidation](#modelvalidation) and [DataAnnotationsModelValidator](#dataannotationsmodelvalidator); the `EditForm` pages used the stock validator, which renders `ErrorMessage` verbatim, so a model declaring a resource key would show the key. This component closes that gap by feeding the same engine into the `EditContext` instead of a MudBlazor `Validation` delegate (doc comment, lines 11-14). See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the localization model.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses single-declaration rules and consistent feedback timing. The rules stay on the model; this class only decides *when* they run: per field on change, and for every public property on submit (doc comment, lines 16-19).
- **Walkthrough**
  - State is three nullable fields, the attached `EditContext`, its `ValidationMessageStore`, and the validator (lines 23-25). `CurrentEditContext` is a private `[CascadingParameter]` (lines 27-28) and the localizer a private `[Inject]` (lines 30-31), so the markup takes no parameters at all: `<LocalizedDataAnnotationsValidator />`.
  - `OnParametersSet` (lines 37-57) throws `InvalidOperationException` when no cascading `EditContext` exists, naming the fix ("Place it inside an EditForm", lines 39-43). It returns early when the context is the one already attached (lines 45-48); otherwise it detaches from any previous context (line 50), then creates the message store and a `new DataAnnotationsModelValidator(Localizer)` and subscribes to `OnFieldChanged` and `OnValidationRequested` (lines 52-56). Re-attaching on a swapped context is what keeps a form that replaces its model working.
  - `HandleFieldChanged` (lines 59-70) clears the changed field's messages, adds `_validator.Validate(field.Model, field.FieldName)`, and calls `NotifyValidationStateChanged` (lines 66-69).
  - `HandleValidationRequested` (lines 72-94) clears every message (line 79), reflects the model's public instance properties, drops indexers, and de-duplicates names ordinally (lines 82-86), then validates each one into its own `FieldIdentifier` (lines 88-91) before notifying once (line 93).
  - `Detach` (lines 96-109) unsubscribes both handlers, clears the store and nulls all three fields; `Dispose` is exactly `Detach()` (line 34), so the component never leaves a handler on a context that outlives it.
- **Why it's built this way**: reusing [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) rather than re-implementing resolution means the `EditForm` and MudForm paths cannot disagree about which keys resolve. Injecting `IStringLocalizer<SharedResource>` rather than taking a page localizer as a parameter keeps the drop-in property: swapping the tag is the whole migration, and the auth forms' `Auth.Field.*` keys live in that shared catalog (`MMCA.Common/CHANGELOG.md:36`).
- **Where it's used**: the four auth `EditForm` pages, Login (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:40`), Register (`Register.razor:33`), ForgotPassword (`ForgotPassword.razor:39`) and ResetPassword (`ResetPassword.razor:43`); their models, [LoginModel](#loginmodel), [RegisterModel](#registermodel), [ForgotPasswordModel](#forgotpasswordmodel) and [ResetPasswordModel](#resetpasswordmodel), name it in their doc comments as the reason their `ErrorMessage` values are keys (`LoginModel.cs:10`, `RegisterModel.cs:11`, `ForgotPasswordModel.cs:10`, `ResetPasswordModel.cs:12`). It is public API of the package (`PublicAPI.Shipped.txt:1193-1195`).
- **Caveats**: submit validation walks top-level properties only and calls the per-property path, so it does not run class-level attributes or `IValidatableObject.Validate`, which the stock validator's whole-object pass does; a model relying on either loses that check when it switches. Messages always resolve against `SharedResource`, so a key that exists only in a page's own resource file passes through untranslated. No file under `MMCA.Common/Tests` names this type, so its attach, re-attach and submit behavior is unpinned except through whatever the auth-page E2E runs exercise.

---

### ModelValidation

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/ModelValidation.cs:26` · Level 2 · class (static)

- **What it is**: the bridge that turns a form model's declared rules into the delegate MudBlazor's field `Validation` parameter expects, so a page declares its rules once (on the model) instead of scattering `Required` and `MaxLength` across the markup and re-checking them by hand.
- **Depends on**: first-party: [IModelValidator](#imodelvalidator) (the pluggable engine taken by `For`) and [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (taken concretely by `ForProperty`, and reused via its `internal static` `TryResolveOwner` in `IsRequired`, line 97). Externals: `System.Linq.Expressions` (`Expression<Func<,>>`, `MemberExpression`, `UnaryExpression`, `ParameterExpression`), `System.ComponentModel.DataAnnotations` (`RequiredAttribute`), `System.Reflection` (`PropertyInfo`).
- **Concept introduced, adapting a model's rules onto a UI library's callback shape.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether validation is declared once and enforced consistently. MudBlazor's contract is a delegate; DataAnnotations' contract is attributes on a type. This class is the two-line adapter between them, and the usage block in the doc comment (lines 14-24) is the canonical example a page copies: `_validate = ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` in `OnInitialized`, then `Validation="@_validate"` on every field.
  - **One delegate serves the whole form.** `For` returns a closure that ignores nothing and dispatches on the path MudBlazor passes (line 48), so a fifteen-field form still assigns the same single delegate to every field. The fallback `instance ?? model` on that line is the small robustness detail: MudBlazor normally passes its own `MudForm.Model` back, and the captured instance covers the case where it does not, so a field still validates outside a form (parameter doc, lines 33-36).
  - `[Rubric §15, Best Practices & Code Quality]` assesses rename safety. `ForProperty` names the property by expression rather than by string (line 71), so a rename becomes a compile error instead of a silently dead rule.
  - `[Rubric §21, Accessibility]`: `IsRequired` exists so a field's `Required` parameter (the asterisk and the `aria-required` affordance) can be read off the same model that supplies the rules, rather than being typed a second time in markup where it can drift from the rule (doc, lines 83-87). It is explicitly *not* a second rule: MudBlazor's own required message is unused when a `Validation` delegate is present, so the localized message from the model is the one shown.
- **Walkthrough**
  - `For(object model, IModelValidator validator)` (lines 43-49): null-guards both arguments, then returns `(instance, propertyPath) => validator.Validate(instance ?? model, propertyPath)` (line 48). This is the model-wide bridge, and it is what almost every page wants.
  - `ForProperty<TModel, TValue>(TModel model, Expression<Func<TModel, TValue>> property, DataAnnotationsModelValidator validator)` (lines 69-81): resolves the dotted path once at setup via `GetPropertyPath` (line 79) and returns `value => validator.ValidateValue(model, path, value)` (line 80). Note the parameter type is the concrete validator, not the interface: the doc (lines 55-58) says why, the value being validated has not necessarily been written to the model yet, so the rules must come from DataAnnotations directly rather than from an arbitrary engine reading the model's current state.
  - `IsRequired(object model, string propertyPath)` (lines 92-99): resolves the property through [DataAnnotationsModelValidator](#dataannotationsmodelvalidator)`.TryResolveOwner` and reports `property.IsDefined(typeof(RequiredAttribute), inherit: true)` (line 98).
  - `GetPropertyPath<TModel, TValue>` (lines 109-133) renders an expression as the dotted path MudBlazor's `For` would produce. It first unwraps the `Convert` node the compiler inserts when `TValue` is a value type boxed to object (lines 114-116, with the comment saying so), then walks `MemberExpression` links pushing each name onto a `Stack<string>` (lines 118-123), which reverses `m => m.Address.City` into `Address.City` on `string.Join` (line 132). Anything that is not a chain of property accesses rooted at the lambda parameter throws `ArgumentException` with a message showing the expected shape (lines 125-130).
- **Why it's built this way**: a static class with no state, because the bridge is pure translation. Offering both a model-wide and a single-field entry point matches the two ways MudBlazor fields actually bind, and pushing the expensive part (expression parsing) into setup rather than into the per-keystroke delegate keeps validation cheap on the typing path.
- **Where it's used**: [NotificationSend](#notificationsend) builds its `_validate` delegate with `For` (`NotificationSend.razor.cs:77`) and reads its two `Required` affordances with `IsRequired` (`NotificationSend.razor:47,58`). It is public API of `MMCA.Common.UI`, so consumer app forms use the same bridge.

### BlazorCircuitLimitExtensions

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Hardening` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:19` · Level 2 · class (static)

- **What it is**: the registration wiring for [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings) and [BoundedCircuitHandler](#boundedcircuithandler): an `IServiceCollection` extension that registers the bounded-circuit handler, and a factory method that builds the `CircuitOptions` retention callback from configuration.
- **Depends on**: [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings), [BoundedCircuitHandler](#boundedcircuithandler); ASP.NET Core's `IServiceCollection`, `IConfiguration`, and Blazor's `CircuitOptions`/`CircuitHandler`.
- **Concept introduced, a singleton handler counting a state that is really per-circuit.** The class doc (`:12-17`) states why the two halves are deliberately separate calls: the disconnected-circuit retention is `CircuitOptions` on `AddInteractiveServerComponents`, while the active-circuit ceiling is a `CircuitHandler` singleton in the container, and both read the same section so the two numbers cannot drift apart. `AddBoundedBlazorCircuits`'s own doc (`:45-49`) states why registration is `AddSingleton` and not scoped: circuit handlers are resolved from each circuit's own scope, so a scoped registration would count to one and cap nothing. [Rubric §29, Resilience & Business Continuity] applies to the retention tightening described under [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings); [Rubric §1, SOLID] applies to keeping registration wiring separate from both the settings type and the handler's own logic.
- **Walkthrough**
  - `RetentionFrom(IConfiguration)` (`:28-41`): reads [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings) from configuration (falling back to `new BlazorCircuitLimitSettings()` if the section is absent), and returns an `Action<CircuitOptions>` that copies `DisconnectedCircuitMaxRetained` and converts `DisconnectedCircuitRetentionSeconds` to a `TimeSpan` for `DisconnectedCircuitRetentionPeriod` (`:37-39`).
  - `AddBoundedBlazorCircuits()` (`:51-61`), an `IServiceCollection` extension: binds and validates [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings) (`:55-58`), then registers [BoundedCircuitHandler](#boundedcircuithandler) as a singleton `CircuitHandler` (`:60`).
- **Why it's built this way**: keeps circuit-limit registration next to the retention-callback factory, both consumers of the same [BlazorCircuitLimitSettings](#blazorcircuitlimitsettings), while the enforcement logic itself stays in [BoundedCircuitHandler](#boundedcircuithandler). See [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html).
- **Where it's used**: `AddBoundedBlazorCircuits()` and `RetentionFrom` are both called from MMCA.ADC.UI.Web's Blazor Server host composition (`Program.cs`).

### HandoffBody
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffEndpoints.cs:64` · Level 0 · record

- **What it is**: the JSON body both session-handoff endpoints exchange, `{ "handoff": "..." }`: a single nullable `Handoff` string (`SessionHandoffEndpoints.cs:63-64`). It is a nested `internal sealed record` of [`SessionHandoffEndpoints`](#sessionhandoffendpoints).
- **Depends on**: nothing first-party.
- **Concept**: a wire DTO for an opaque, Data-Protection-sealed token; the sealing is taught on [`SessionHandoffProtector`](#sessionhandoffprotector).
- **Walkthrough**: the token endpoint returns it with a protected access token (`SessionHandoffEndpoints.cs:34`); the cookie endpoint binds it from the request body and unprotects `body.Handoff` (`SessionHandoffEndpoints.cs:42,49`).
- **Why it's built this way**: the property is nullable so a missing or empty body binds instead of failing model binding; the protector then treats null or whitespace as "no handoff" (`SessionHandoffProtector.cs:59-62`) and the endpoint answers 400 `invalid_handoff` (`SessionHandoffEndpoints.cs:50-53`).
- **Where it's used**: only inside `SessionHandoffEndpoints.cs`.

### ProxyResponseMode
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:14` · Level 0 · enum

- **What it is**: how the same-origin proxy treats the upstream response of one forwarded request: `Forward` (copy as is), `TokenIssuing` (a sign-in: move the token pair into the session cookies and strip it from the body), `Revoke` (a sign-out: copy, then clear the session cookies) (`SameOriginProxyTransformer.cs:17,20,23`).
- **Depends on**: nothing first-party.
- **Concept**: a strategy selector passed into the per-request [`SameOriginProxyTransformer`](#sameoriginproxytransformer); see that section for each mode's mechanism.
- **Walkthrough**: [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint) picks the mode in `ResolveMode` (`SameOriginApiProxyEndpoint.cs:291-311`): every non-POST is `Forward`; a POST to the refresh path yields `null` (the proxy answers it itself); a POST to a token-issuing path is `TokenIssuing`; a POST to the revoke path is `Revoke`; any other POST is `Forward`.
- **Why it's built this way**: the endpoint decides once per request and the transformer branches on it (`SameOriginProxyTransformer.cs:64,84,91`), so the request path matching stays in one class and the body rewriting in another.
- **Where it's used**: `SameOriginApiProxyEndpoint` and `SameOriginProxyTransformer` only; it is `internal`.

### SameOriginApiProxyMarker
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:92` · Level 0 · class

- **What it is**: an empty `internal sealed class` registered as a singleton only by `AddCommonSameOriginApiProxy` (`SameOriginApiProxyServiceExtensions.cs:81,92`), so other code can ask the container "did this host opt in to the proxy?".
- **Depends on**: nothing.
- **Concept**: a DI marker service: presence in the container is the signal, the instance carries no state.
- **Walkthrough**: no members.
- **Why it's built this way**: checking a private marker type is cheaper and more precise than probing for a public service a host could register for other reasons (for example the options type, which binding alone would create).
- **Where it's used**: [`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions) throws when it is absent, naming the missing call (`SameOriginApiProxyEndpointExtensions.cs:38-42`); [`ClientConfigEndpointExtensions`](#clientconfigendpointextensions) reads it to decide whether to publish the proxy's path prefix to the client (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:93,98`).

### SameOriginApiProxySettings
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:21` · Level 0 · class

- **What it is**: the options class for the same-origin API proxy, bound from configuration section `SameOriginApiProxy` (`SameOriginApiProxySettings.cs:24`) and validated at startup.
- **Depends on**: `SameSiteMode` (ASP.NET Core); first-party only by reference: the gateway address falls back to [`ApiSettings`](#apisettings)'s `ApiEndpoint`.
- **Concept**: options pattern with fail-fast validation, same shape as the other settings classes in this group (for example [`BlazorCspSettings`](#blazorcspsettings) with [`BlazorCspSettingsValidator`](#blazorcspsettingsvalidator)). `[Rubric §33, Developer Experience]` assesses whether misconfiguration surfaces early and clearly; every knob here has a default, so a host opts in with no configuration at all.
- **Walkthrough**:
  - `DefaultTokenIssuingPaths` = `auth/login`, `auth/register`, `auth/oauth/exchange` (`SameOriginApiProxySettings.cs:31`): the endpoints whose successful response carries a token pair.
  - `PathPrefix` = `/api` (`:38`): a request to `{PathPrefix}/orders/5` is forwarded to `{gateway}/orders/5`.
  - `GatewayAddress` (`:46`): null by default; `AddCommonSameOriginApiProxy` fills it from `Api:ApiEndpoint` when unset (`SameOriginApiProxyServiceExtensions.cs:57-64`), so an Aspire discovery name such as `https+http://gateway` resolves as it does for the host's API clients.
  - `AdditionalTokenIssuingPaths` (`:52`): empty; a host adds paths such as `auth/2fa/verify`.
  - `RefreshPath` = `auth/refresh` (`:59`): answered by the proxy itself from the refresh cookie.
  - `RevokePath` = `auth/revoke` (`:66`): forwarded, then the cookies are cleared whatever upstream answered.
  - `SessionCookieSameSite` = `SameSiteMode.Strict` (`:74`); `Lax` is the only other accepted value.
- **Why it's built this way**: recorded in [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html): a WebAssembly client calling the gateway cross-origin cannot carry the HttpOnly session cookie, so tokens end up script-readable; a same-origin proxy on the UI host lets the cookie authenticate data calls instead.
- **Where it's used**: [`SameOriginApiProxyServiceExtensions`](#sameoriginapiproxyserviceextensions) (binding, and copying `SessionCookieSameSite` onto [`SessionCookieSettings`](group-08-auth.md#sessioncookiesettings), `SameOriginApiProxyServiceExtensions.cs:69-74`), [`SameOriginApiProxySettingsValidator`](#sameoriginapiproxysettingsvalidator), [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint), [`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions) and `ClientConfigEndpointExtensions.cs:98`.

### SameOriginProxyInvoker
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyInvoker.cs:19` · Level 0 · class

- **What it is**: an `IDisposable` holder for the one `HttpMessageInvoker` YARP's forwarder sends every proxied request through (`SameOriginProxyInvoker.cs:19,37`).
- **Depends on**: `IServiceDiscoveryHttpMessageHandlerFactory` (Microsoft.Extensions.ServiceDiscovery), `SocketsHttpHandler`, YARP's `ReverseProxyPropagator`.
- **Concept**: YARP's `IHttpForwarder` expects a long-lived invoker with a transport tuned for proxying, not a pooled `HttpClient`. `[Rubric §12, Performance & Scalability]` assesses connection reuse and resource lifetime: one singleton transport is shared by all requests.
- **Walkthrough**:
  - The public ctor resolves the optional discovery factory and builds the handler (`SameOriginProxyInvoker.cs:24-31`); the invoker is created with `disposeHandler: false` and the class keeps `_ownedHandler` to dispose itself (`:22,39-43`).
  - An `internal` ctor takes a test-supplied handler, for example a TestServer's (`:34-35`); that handler is not owned or disposed.
  - `CreateHandler` (`:45-69`) configures `SocketsHttpHandler`: `UseProxy = false`, `AllowAutoRedirect = false`, no automatic decompression, `UseCookies = false`, multiple HTTP/2 connections, `ConnectTimeout` 15 s, and a `ReverseProxyPropagator` over `DistributedContextPropagator.Current` (`:50-59`). When discovery is registered it wraps the transport (`:61`) so `https+http://gateway` resolves. The null-out-then-`finally` pattern disposes the transport only if wrapping throws.
- **Why it's built this way**: redirects, cookies and decompression must pass through to the browser untouched, which is why they are all off; the propagator keeps the trace context flowing to the gateway.
- **Where it's used**: injected into [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint) (`SameOriginApiProxyEndpoint.cs:31,342`), registered by `SameOriginApiProxyServiceExtensions.cs:78`, and built from a handler in the test harness `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/SameOriginProxy/ProxyTestHarness.cs`.

### TokenPair
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffProtector.cs:75` · Level 0 · record

- **What it is**: a private nested record `(AccessToken, RefreshToken)` of [`SessionHandoffProtector`](#sessionhandoffprotector) (`SessionHandoffProtector.cs:75`), the plaintext shape serialized to JSON before it is sealed.
- **Depends on**: nothing first-party; `System.Text.Json`.
- **Walkthrough**: serialized in `ProtectTokenPair` (`SessionHandoffProtector.cs:33-34`) and deserialized in `UnprotectTokenPair`, which rejects a null pair or either token blank (`:46-49`).
- **Where it's used**: only inside `SessionHandoffProtector.cs`; callers see a value tuple instead.

### SameOriginApiProxySettingsValidator
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettingsValidator.cs:14` · Level 1 · class

- **What it is**: the `IValidateOptions<SameOriginApiProxySettings>` that fails the boot on an unusable proxy configuration, collecting every failure into one result (`SameOriginApiProxySettingsValidator.cs:14,19-51`).
- **Depends on**: [`SameOriginApiProxySettings`](#sameoriginapiproxysettings); `SearchValues<char>`, `ValidateOptionsResult`.
- **Concept**: startup validation via `ValidateOnStart`, cross-referenced to [`BlazorCspSettingsValidator`](#blazorcspsettingsvalidator). `[Rubric §11, Security]` applies to the `SameSite` check: only `Strict` or `Lax` pass, because the cookie now authenticates data calls (`:40-43`).
- **Walkthrough**:
  - `ForbiddenPathCharacters` = `{}*?#\` (`:16`): route syntax, query, fragment and backslash.
  - `PathPrefix` must pass `IsValidPrefix` (`:26-31,54-60`): non-blank, longer than one char, starts with `/`, does not end with `/`, no whitespace, no forbidden char. It becomes a route pattern, hence the literal-path rule.
  - `GatewayAddress` must be an absolute URI with a host (`:33-38`); the message names the `Api:ApiEndpoint` fallback.
  - `RefreshPath`, `RevokePath` and every `AdditionalTokenIssuingPaths` entry must pass `IsValidRelativePath` (`:45-49,62-67`): not blank after trimming `/`, no whitespace, no forbidden char, no `://`.
- **Why it's built this way**: an invalid prefix would otherwise surface as a route-pattern exception or a silently unmatched route at request time; naming the setting at boot is cheaper to diagnose.
- **Where it's used**: registered with `TryAddEnumerable` by `SameOriginApiProxyServiceExtensions.cs:66-67`.

### SessionHandoffProtector
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffProtector.cs:16` · Level 1 · class

- **What it is**: seals tokens with ASP.NET Core Data Protection so the Blazor Server circuit can pass them through browser script without script being able to read or replay them later (`SessionHandoffProtector.cs:16`).
- **Depends on**: `IDataProtectionProvider` / `ITimeLimitedDataProtector` (Microsoft.AspNetCore.DataProtection); nested [`TokenPair`](#tokenpair).
- **Concept introduced, the protected handoff.** With the proxy enabled the HttpOnly cookies are the only session store, but a Server circuit runs over a WebSocket where it cannot read cookies on demand, and it may need to seed the cookies after a sign-in. The handoff hops through JS interop carrying an opaque blob that only this server can open, valid for one minute. `[Rubric §26, Front-End Security]` assesses keeping credentials out of script-reachable storage: the browser holds ciphertext with a 1-minute lifetime, never a usable bearer.
- **Walkthrough**:
  - `Lifetime` = 1 minute, "one fetch plus one interop hop" (`:19`).
  - Two purpose-isolated protectors under the root `MMCA.Common.UI.Web.SameOriginProxy.SessionHandoff`, one for `AccessToken`, one for `TokenPair` (`:21-27`), so a blob minted for one cannot be opened as the other.
  - `ProtectAccessToken` / `UnprotectAccessToken` (`:29,31`); `ProtectTokenPair` serializes a `TokenPair` to JSON (`:33-34`); `UnprotectTokenPair` returns a tuple or null on a missing, blank or malformed pair (`:36-55`).
  - `TryUnprotect` (`:57-73`) maps null or whitespace input, and `CryptographicException` or `FormatException` (tampered, expired, wrong purpose, retired key), to null.
- **Why it's built this way**: see [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html). Returning null instead of throwing lets each endpoint answer a clean 401 or 400.
- **Where it's used**: [`SessionHandoffEndpoints`](#sessionhandoffendpoints), [`HandoffTokenRefresher`](#handofftokenrefresher), [`HandoffSessionCookieSync`](#handoffsessioncookiesync); registered as a singleton at `SameOriginApiProxyServiceExtensions.cs:80`; tested in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/SameOriginProxy/SameOriginApiProxyAuthFlowTests.cs` and `SessionHandoffServicesTests.cs`.
- **Caveats / not-in-source**: whether the host's Data Protection key ring is persisted and shared across replicas is host configuration; `AddDataProtection()` here (`SameOriginApiProxyServiceExtensions.cs:77`) adds no persistence. Not determinable from this source.

### HandoffSessionCookieSync
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:52` · Level 2 · class

- **What it is**: the proxy-mode [`ISessionCookieSync`](#isessioncookiesync) for the Blazor Server circuit: after a sign-in it hands the browser a protected token pair to post back, instead of the raw tokens (`HandoffSessionServices.cs:52`).
- **Depends on**: `IJSRuntime`, [`SessionHandoffProtector`](#sessionhandoffprotector).
- **Concept**: cross-reference [`SessionHandoffProtector`](#sessionhandoffprotector); it replaces the default sync (compare [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)).
- **Walkthrough**: `SyncAsync` calls `mmcaAuthHandoff.setCookie` with `ProtectTokenPair(...)` (`:41-51`); the script posts it to `/auth/session-cookie/handoff` (see [`SessionHandoffEndpoints`](#sessionhandoffendpoints)). `ClearAsync` calls `mmcaAuthCookie.clear` (`:53-63`). Both return `false` when interop is unavailable (`InvalidOperationException`, `JSDisconnectedException`, `JSException`, `OperationCanceledException`, `:65-66`).
- **Where it's used**: registered with `Replace` as scoped (`SameOriginApiProxyServiceExtensions.cs:84`) and verified at map time by [`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions).
- **Caveats / not-in-source**: the `mmcaAuthHandoff` / `mmcaAuthCookie` JavaScript is not in this C# source and was not read.

### HandoffTokenRefresher
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:14` · Level 2 · class

- **What it is**: the proxy-mode [`ISessionAwareTokenRefresher`](#isessionawaretokenrefresher) (an [`ITokenRefresher`](#itokenrefresher)) for the Blazor Server circuit: it gets an access token from the cookie session through a protected handoff (`HandoffSessionServices.cs:14`).
- **Depends on**: `IJSRuntime`, [`SessionHandoffProtector`](#sessionhandoffprotector).
- **Concept**: cross-reference [`SessionHandoffProtector`](#sessionhandoffprotector); it replaces the default refresher (compare [`DirectApiTokenRefresher`](#directapitokenrefresher)).
- **Walkthrough**: `AcquireAccessTokenAsync` is a thin wrapper that returns the `AccessToken` of `TryAcquireAccessTokenAsync` (`:16-17`). The latter calls `mmcaAuthHandoff.getToken` (`:24`), whose script calls `/auth/session/handoff` and answers null only for the endpoint's 401. A null handoff yields [`TokenAcquisition`](#tokenacquisition)`.NoSession` (`:25-28`). Otherwise the blob is unprotected server-side (`:32`): a non-empty token yields `Acquired`, while an empty result (expired handoff, or a key this host does not hold) yields `Unavailable` because it says nothing about the session itself (`:32-34`). Interop failure during SSR prerender, a disconnected circuit, a cancelled call or a transient endpoint failure also yields `Unavailable` (`:36-42`).
- **Where it's used**: registered with `Replace` as scoped (`SameOriginApiProxyServiceExtensions.cs:83`); tested in `SessionHandoffServicesTests.cs`.
- **Caveats / not-in-source**: the JavaScript side is not in this C# source.

### SameOriginProxyTransformer
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:34` · Level 12 · class

- **What it is**: the per-request YARP `HttpTransformer` that rewrites the outbound request (path, bearer, cookies) and treats the response according to its [`ProxyResponseMode`](#proxyresponsemode) (`SameOriginProxyTransformer.cs:34-39`).
- **Depends on**: [`ISessionCookieStore`](group-08-auth.md#isessioncookiestore), [`SessionCookieEndpoints`](group-08-auth.md#sessioncookieendpoints) (cookie names), [`SessionClaimsToken`](group-08-auth.md#sessionclaimstoken), [`SameOriginProxyHeaders`](#sameoriginproxyheaders); YARP `HttpTransformer` and `RequestUtilities`.
- **Concept**: `[Rubric §26, Front-End Security]` (credentials kept out of script): the token pair from a sign-in never reaches the browser body, and the cookie jar's token copies never reach the upstream.
- **Walkthrough**:
  - `TransformRequestAsync` (`:47-69`): runs YARP's default, strips the prefix to build the destination URI (`:55-58`), sets `Authorization: Bearer` from the session or removes it (`:60`), drops the CSRF header (`:61`), removes the session cookies (`:62`), and in `TokenIssuing` mode clears `Accept-Encoding` so the body arrives as plain JSON (`:64-68`).
  - `TransformResponseAsync` (`:71-98`): when `captureUnauthorized` is on and upstream answered 401, sets `UnauthorizedCaptured` and copies nothing so the endpoint can replay (`:76-80`); in `Revoke` clears the cookies whatever upstream said (`:84-89`); in `TokenIssuing` on success rewrites the body (`:91-95`).
  - `RewriteTokenResponseAsync` / `TryMoveTokensToCookies` (`:106-145`): parses the JSON case-insensitively, writes both tokens to the cookie store (`:141`), replaces `accessToken` with its claims-only form and empties `refreshToken` (`:142-143`), and sets `no-store` (`:115-117`). A body without a token pair passes through unchanged.
  - `RemoveSessionCookies` (`:156-174`): filters only the access and refresh cookie pairs from the `Cookie` header; other cookies pass.
- **Why it's built this way**: the browser-facing JSON keeps its shape, so a client written for the non-proxy mode still parses a well-formed response (`:100-105`).
- **Where it's used**: created per request by [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint) (`SameOriginApiProxyEndpoint.cs:336-337`).

### SameOriginApiProxyEndpoint
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:29` · Level 13 · class

- **What it is**: the request handler behind `{PathPrefix}/{**path}`: gates the request, resolves the session from the cookies, forwards to the gateway with a bearer, and refreshes and replays once on an unexpected 401 (`SameOriginApiProxyEndpoint.cs:29-35,60-105`).
- **Depends on**: YARP `IHttpForwarder`, [`SameOriginProxyInvoker`](#sameoriginproxyinvoker), [`ICookieSessionRefresher`](group-08-auth.md#icookiesessionrefresher) with [`SessionRefreshOutcome`](group-08-auth.md#sessionrefreshoutcome) / [`SessionRefreshStatus`](group-08-auth.md#sessionrefreshstatus), [`ISessionCookieStore`](group-08-auth.md#isessioncookiestore), [`SameOriginApiProxySettings`](#sameoriginapiproxysettings), [`SameOriginProxyTransformer`](#sameoriginproxytransformer), [`SessionClaimsToken`](group-08-auth.md#sessionclaimstoken).
- **Concept introduced, a Backend-for-Frontend proxy.** The UI host forwards same-origin calls to the gateway, so the browser's cookie authenticates them and the bearer is attached server-side. `[Rubric §26, Front-End Security]` assesses CSRF and origin defenses: a same-origin gate and a CSRF header gate run before anything is forwarded. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation: an undecided refresh answers 503 with `Retry-After` and keeps the session.
- **Walkthrough**:
  - Config: `RequestConfig` uses a 100 s activity timeout and HTTP/1.1 with `RequestVersionOrLower` (`:43-48`), which lets YARP turn an HTTP/2 WebSocket into an HTTP/1.1 upgrade; `DefaultRetryAfter` 5 s (`:51`); `_tokenIssuingPaths` merges the defaults and additions case-insensitively (`:54-58`).
  - `InvokeAsync` (`:60-105`): disables status code pages so a proxied empty 401/404 is not replaced by an HTML page (`:66-69`); runs `TryAnswerBeforeForwardingAsync`; resolves the mode, with `null` meaning `RefreshLocallyAsync` (`:76-81`); for non-sign-in requests that carry a session cookie calls `ValidateOrRefreshAsync` and fails via `FailRefreshAsync` when no session results (`:85-96`); forwards with 401 capture on only for a bearer plus a replayable request (`:98-99`); replays on capture (`:101-104`).
  - Gates, in order (`TryAnswerBeforeForwardingAsync`, `:232-259`): `CrossOriginRejection` (403 `cross_origin_rejected`); `OPTIONS` answered 204 locally, never forwarded, no CORS grant; unsafe methods other than an HTTP/2 WebSocket CONNECT need the CSRF header (403 `csrf_header_required`). `HasCsrfHeader` requires exactly one header value equal to [`SameOriginProxyHeaders`](#sameoriginproxyheaders)'s value (`:110-113`).
  - `CrossOriginRejection` (`:131-137`): `OriginRejection` refuses a foreign `Origin` and an upgrade with no `Origin` (`:180-188`); `IsOwnOrigin` compares scheme and server against the request as seen after forwarded headers, refusing paths, user info and the `null` origin (`:146-160`); `FetchSiteRejection` allows `same-origin`, and `none` only on a non-upgrade GET or HEAD (`:190-207`). `IsWebSocketExtendedConnect` detects RFC 8441 CONNECT (`:169-172`).
  - `IsReplayable` (`:215-217`): GET, HEAD or OPTIONS and not an upgrade, so nothing with a body is re-sent.
  - `FailRefreshAsync` (`:274-285`): `Rejected` ends the session (clear cookies, 401 `session_expired`, `:262-266`); anything else answers 503 `session_refresh_unavailable` with `Retry-After` from upstream or 5 s.
  - `RefreshAndReplayAsync` (`:318-329`): resets status to 200, forces `RefreshAsync`, forwards again without capture.
  - `RefreshLocallyAsync` (`:356-374`): rotates from the refresh cookie and answers the sign-in shape with a claims-only access token, empty refresh token and the expiry, `no-store`.
  - Four `[LoggerMessage]` warnings (`:376-386`); `ForwardAsync` logs a forward error only if the client did not abort (`:339-349`).
- **Why it's built this way**: [ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html) records the decision; the gateway stays the API edge and authorizes the forwarded bearer.
- **Where it's used**: mapped by [`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions); its `HasCsrfHeader` is reused by [`SessionHandoffEndpoints`](#sessionhandoffendpoints) (`SessionHandoffEndpoints.cs:26,44`); registered as a singleton at `SameOriginApiProxyServiceExtensions.cs:79`.

### SameOriginApiProxyServiceExtensions
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:37` · Level 14 · class

- **What it is**: the opt-in registration, `services.AddCommonSameOriginApiProxy(configuration)` (`SameOriginApiProxyServiceExtensions.cs:51`), written as a C# `extension(IServiceCollection)` block (see [C# `extension(T)` types](00-primer.md#c-extensiont-types--read-this-once)).
- **Depends on**: every proxy type above; [`ApiSettings`](#apisettings), [`SessionCookieSettings`](group-08-auth.md#sessioncookiesettings), [`ITokenRefresher`](#itokenrefresher), [`ISessionCookieSync`](#isessioncookiesync); YARP `AddHttpForwarder`, Data Protection.
- **Walkthrough**:
  - Binds [`SameOriginApiProxySettings`](#sameoriginapiproxysettings), post-configures the gateway from `Api:ApiEndpoint` when unset, `ValidateOnStart` (`:55-65`), and adds the validator (`:66-67`).
  - Configures `SessionCookieSettings`: `SameSite` from the proxy settings and `ClaimsOnlyBrowserTokens = true` (`:69-74`).
  - `AddHttpForwarder`, `AddDataProtection` (`:76-77`); singletons for the invoker, endpoint, protector and [`SameOriginApiProxyMarker`](#sameoriginapiproxymarker) (`:78-81`).
  - `Replace`s the scoped `ITokenRefresher` and `ISessionCookieSync` with [`HandoffTokenRefresher`](#handofftokenrefresher) and [`HandoffSessionCookieSync`](#handoffsessioncookiesync) (`:83-84`).
- **Why it's built this way**: opt-in per host; a host that never calls it is unchanged ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)). `Replace` means call order matters, which `MapCommonSameOriginApiProxy` checks.
- **Where it's used**: paired with [`SameOriginApiProxyEndpointExtensions`](#sameoriginapiproxyendpointextensions); exercised in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/SameOriginProxy/SameOriginApiProxyOptInTests.cs`.
- **Caveats / not-in-source**: which consumer hosts call it is not determinable from this source (no call site under `MMCA.Common/Source` other than its own pairing).

### SessionHandoffEndpoints
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffEndpoints.cs:15` · Level 14 · class

- **What it is**: maps the two Blazor Server circuit handoff endpoints, `POST /auth/session/handoff` and `POST /auth/session-cookie/handoff` (`SessionHandoffEndpoints.cs:17-18,20`).
- **Depends on**: [`ICookieSessionRefresher`](group-08-auth.md#icookiesessionrefresher), [`ISessionCookieStore`](group-08-auth.md#isessioncookiestore), [`SessionHandoffProtector`](#sessionhandoffprotector), [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint) (`HasCsrfHeader`), [`HandoffBody`](#handoffbody).
- **Walkthrough**:
  - Token handoff (`:23-38`): requires the CSRF header (else 403), calls `GetOrRefreshAsync` on the cookie session, answers 401 `no_session` or a `HandoffBody` with a protected access token.
  - Cookie handoff (`:41-60`): requires the CSRF header, unprotects the token pair (400 `invalid_handoff` on failure), writes the cookies, answers 204.
  - Both are `ExcludeFromDescription`, `AllowAnonymous`, `DisableAntiforgery`; the CSRF header is the gate.
- **Where it's used**: called from `MapCommonSameOriginApiProxy` (`SameOriginApiProxyEndpointExtensions.cs:54`); reached from the browser by [`HandoffTokenRefresher`](#handofftokenrefresher) and [`HandoffSessionCookieSync`](#handoffsessioncookiesync) through their JS interop.

### SameOriginApiProxyEndpointExtensions
> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.SameOriginProxy` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpointExtensions.cs:15` · Level 15 · class

- **What it is**: `endpoints.MapCommonSameOriginApiProxy()` (`SameOriginApiProxyEndpointExtensions.cs:33`), which maps `{PathPrefix}/{**path}` for every method (WebSocket upgrades included) plus the handoff endpoints, after checking the registrations.
- **Depends on**: [`SameOriginApiProxyMarker`](#sameoriginapiproxymarker), [`SameOriginApiProxySettings`](#sameoriginapiproxysettings), [`SameOriginApiProxyEndpoint`](#sameoriginapiproxyendpoint), [`SessionHandoffEndpoints`](#sessionhandoffendpoints), [`HandoffTokenRefresher`](#handofftokenrefresher), [`HandoffSessionCookieSync`](#handoffsessioncookiesync).
- **Concept**: fail-fast wiring checks. `[Rubric §33, Developer Experience]`: a wrong registration order fails the boot with a message naming the fix rather than silently leaking tokens.
- **Walkthrough**:
  - Throws `InvalidOperationException` if the marker is absent (`:38-42`).
  - `VerifyCircuitRegistrations` (`:64-69`) resolves `ITokenRefresher` and `ISessionCookieSync` in a scope; a resolved type other than the handoff implementation throws, telling the host to call `AddCommonSameOriginApiProxy` after every such registration (`:71-92`). A missing dependency such as `IJSRuntime` (no interactive Server circuit) skips the check (`:79-83`).
  - Maps the proxy route to `proxy.InvokeAsync` as `ExcludeFromDescription`, `AllowAnonymous`, `DisableAntiforgery` (`:49-52`), then `SessionHandoffEndpoints.Map` (`:54`).
- **Why it's built this way**: a later `ITokenRefresher` registration would put the access token back in the page on every Server-circuit hydration (`:59-63`); the doc comment asks hosts to map it after `UseAuthorization` (`:19-26`).
- **Where it's used**: by consumer hosts that opted in. Not determinable from this source which hosts do.

### TrustedCallerHandler

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/TrustedCallerHandler.cs:35` · Level 0 · class (sealed, `DelegatingHandler`)

- **What it is**: an outgoing `HttpClient` handler that stamps a shared-secret header onto a request
  only when the request targets the configured gateway origin, so the gateway can trust that the call
  came from this app rather than from an arbitrary caller.
- **Depends on**: nothing first-party. Externals: `System.Net.Http` (`DelegatingHandler`,
  `HttpRequestMessage`, `HttpResponseMessage`), BCL `Uri`.
- **Concept introduced, an edge-trust header scoped to origin match, not applied blindly.**
  `[Rubric §11, Security]` assesses whether a trust signal is bounded to the audience it is meant for.
  The constructor takes a header name, a shared secret, and the gateway origin
  (`TrustedCallerHandler.cs:39`), and `SendAsync` only stamps the header when the outgoing request's
  scheme, host, and port match that origin (`TrustedCallerHandler.cs:57-63`); a request to any other
  destination goes out unmodified, so the secret cannot leak to a third-party origin the same
  `HttpClient` happens to call. [ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html)
  is the policy this enforces on the client side.
- **Walkthrough**
  - The constructor (`TrustedCallerHandler.cs:39-48`) null/blank-guards `headerName` and `secret` and
    null-guards `gatewayOrigin`, storing all three as readonly fields.
  - `SendAsync` (`TrustedCallerHandler.cs:51-72`) null-guards the request, then compares
    `request.RequestUri` against `_gatewayOrigin` with `Uri.Compare` over
    `UriComponents.Scheme | UriComponents.HostAndPort`, case-insensitive
    (`TrustedCallerHandler.cs:57-63`). On a match it removes any existing value for the header and adds
    exactly one via `TryAddWithoutValidation` (`TrustedCallerHandler.cs:67-68`); the comment
    (`TrustedCallerHandler.cs:65-66`) explains the replace-not-append choice, the gateway compares one
    header value in constant time, so a second value would silently fail the comparison. It then calls
    `base.SendAsync` unconditionally.
- **Why it's built this way**: a `DelegatingHandler` composes into the existing `HttpClient` pipeline
  without every call site having to remember to add the header itself, and gating on origin means the
  same registered handler is safe to reuse on a client that also talks to other hosts.
- **Where it's used**: registered in `MMCA.Common.UI.Web`'s
  [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs`);
  its behavior is pinned by `TrustedCallerHandlerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Security/TrustedCallerHandlerTests.cs`).

### BlazorCspSettings

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspSettings.cs:18` · Level 0 · class (sealed)

- **What it is**: the bindable options type for an opt-in `frame-src` allowance on the Blazor host's Content-Security-Policy, one string list of origins a page may embed in an `<iframe>` (`BlazorCspSettings.cs:23-35`).
- **Depends on**: nothing first-party. It is read by [BlazorCspPolicyProvider](#blazorcsppolicyprovider) through `BuildFrameSrc` and validated at startup by [BlazorCspSettingsValidator](#blazorcspsettingsvalidator). Externals: `Microsoft.Extensions.Options` binding conventions (BCL `IList<string>`).
- **Concept introduced, an empty default that changes nothing.** `[Rubric §26, Front-End Security]` assesses whether a security-relevant default stays strict until a deployment explicitly opts out. `SectionName = "BlazorCsp"` (line 28) names the configuration section; `FrameSources` (line 42) initializes to an empty list, so an unconfigured host emits no `frame-src` directive at all and the policy stays byte-identical to the pre-existing baseline (comment, lines 30-33). Only a deployment that needs to embed a specific third-party origin (the doc comment's example is a map provider's embed endpoint, lines 30-31) adds entries.
  - The doc comment (lines 33-40) states the origin shape a configured entry must satisfy: an absolute `https` origin with no path, query, fragment, user info, wildcard, quote, semicolon, comma or whitespace, so the field carries the contract [BlazorCspSettingsValidator](#blazorcspsettingsvalidator) enforces rather than leaving it implicit.
- **Walkthrough**: two members: `SectionName` (line 28, a `public const string`) and `FrameSources` (line 42, `public IList<string>` initialized to `[]`).
- **Why it's built this way**: a settings class bound through `IOptions<BlazorCspSettings>` fits the same registration and validation pipeline every other options type in the host uses, so adding `frame-src` support did not need a new configuration mechanism, only a new section.
- **Where it's used**: bound and validated in `MMCA.Common.UI.Web`'s [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs`), consumed by [BlazorCspPolicyProvider](#blazorcsppolicyprovider)'s constructor as `IOptions<BlazorCspSettings>`.

### BrowserOriginHandler

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/BrowserOriginHandler.cs:32` · Level 0 · class (internal sealed, `DelegatingHandler`)

- **What it is**: an outgoing `HttpClient` handler that stamps the visitor's browser origin (`X-Forwarded-For` with its address, `User-Agent` with its user-agent) on the server-side `"APIClient"` calls a Blazor Server host makes for that visitor (`BrowserOriginHandler.cs:5-11`). Without it the API would see this host's own address for every visitor, and the host's HTTP client sends no user-agent at all.
- **Depends on**: nothing first-party. Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `ConnectionInfo.RemoteIpAddress`), `System.Net.Http` (`DelegatingHandler`, `HttpRequestMessage`).
- **Concept introduced, per-client policy keyed on the visitor rather than the host.** `[Rubric §11, Security]` assesses whether a trust or rate-limit signal is attributed to the right principal. The API keys the registration rate limit, the session's recorded IP and the recorded device on the caller; behind a Blazor Server host every caller would collapse onto the host's address. The handler copies two values from the HTTP request that carries the work (the page request during prerender, the connection the circuit was established on afterwards, `BrowserOriginHandler.cs:14-17`). The address is `RemoteIpAddress`, which has already passed through this host's forwarded-headers middleware, so it is only as far back as the host trusts its own proxies, and a client-supplied `X-Forwarded-For` is never copied verbatim (`BrowserOriginHandler.cs:16-19`).
- **Walkthrough**
  - The primary constructor (line 32) takes `IHttpContextAccessor`, an async-local that crosses the handler's own DI scope (parameter doc, lines 30-31). Two internal constants name the headers: `ForwardedForHeaderName` (line 35) and `UserAgentHeaderName` (line 38).
  - `SendAsync` (lines 41-55) null-guards the request, reads `httpContextAccessor.HttpContext` (line 47) and, only when a request is in scope, calls `Replace` for the connection's remote address (line 50) and the request's `User-Agent` (line 51), then calls `base.SendAsync` unconditionally (line 54). With no visitor behind the call (a background job) nothing is sent.
  - `Replace` (lines 57-68) returns early on a null or blank value (lines 59-62), so a blank user-agent is not forwarded; otherwise it removes any existing header (line 66) and adds exactly one value via `TryAddWithoutValidation` (line 67). The comment (lines 64-65) gives the reason for skipping validation: a real browser user-agent does not always parse as a strict product-token list, and neither value needs parsing on this side.
- **Why it's built this way**: a `DelegatingHandler` composes into the named client's pipeline without any call site remembering to add the headers, and replace-not-append keeps each header single-valued so a caller cannot smuggle a second value in. It is the same shape as [TrustedCallerHandler](#trustedcallerhandler), but unconditional on origin because the target is always this app's own API.
- **Where it's used**: registered transient and attached to the `"APIClient"` named client by `AddCommonServerTokenStorage()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:47-48`); only a Blazor Server host calls that, because the WebAssembly client reaches the API through the same-origin proxy, which forwards the browser's own headers (`BrowserOriginHandler.cs:23-28`). Pinned by `BrowserOriginHandlerTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Services/BrowserOriginHandlerTests.cs`).

### NotificationSendModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSendModel.cs:19` · Level 1 · class (sealed)

- **What it is**: the two-property form model for the push-notification compose page. Its DataAnnotations are the single declaration of that form's field rules.
- **Depends on**: first-party: [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the endpoint contract, whose length constants it reuses, lines 23 and 28). Externals: `System.ComponentModel.DataAnnotations` (`RequiredAttribute`, `MaxLengthAttribute`). It is consumed by [NotificationSend](#notificationsend) through [ModelValidation](#modelvalidation) and [DataAnnotationsModelValidator](#dataannotationsmodelvalidator).
- **Concept introduced, one number shared by the cap, the message, and the server invariant.** The lengths are *not* declared here. `MaxLength(SendPushNotificationRequest.TitleMaxLength)` (line 23) and `MaxLength(SendPushNotificationRequest.BodyMaxLength)` (line 28) point at the shared request contract, which fixes them at 200 and 2000 (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:15,21`). The same constants drive the input cap and the character counter in the markup (`NotificationSend.razor:49-50,61-62`), and the server-side validator enforces the same numbers.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses whether client and server agree. Here they cannot disagree, because there is one literal and everything else is a reference to it.
  - `[Rubric §9, API & Contract Design]` assesses whether contract facts live with the contract; putting the length constants on the request record (the type the endpoint binds) rather than on the form model is what makes the sharing possible in the first place.
  - `[Rubric §27, Internationalization & Localization]`: each `ErrorMessage` is a resource key (`"Notif.Send.Field.Title.Required"`, line 22, and its three siblings), resolved by the page's localizing [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). This is the concrete case the pass-through localization in that validator was designed for.
- **Walkthrough**: two mutable `string` properties, both initialized to `string.Empty` so a fresh model binds cleanly. `Title` (line 24) carries `[Required]` with key `Notif.Send.Field.Title.Required` (line 22) and `[MaxLength(200)]` with key `Notif.Send.Field.Title.MaxLength` (line 23). `Body` (line 29) carries the matching pair, `Notif.Send.Field.Message.Required` (line 27) and `Notif.Send.Field.Message.MaxLength` with the 2000-character cap (line 28).
- **Why it's built this way**: a settable class rather than a record with `init` accessors, because MudBlazor two-way binding (`@bind-Value="_model.Title"`) writes back into the instance. It is a separate type from [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) because the form model is mutable and carries presentation rules, while the request record is the immutable wire contract; the page maps one to the other in a single line (`NotificationSend.razor.cs:131`).
- **Where it's used**: held as `private readonly NotificationSendModel _model = new()` by [NotificationSend](#notificationsend) (`NotificationSend.razor.cs:46`) and bound by both fields in its markup.

### BiometricGate

> MMCA.Common.UI · `MMCA.Common.UI.Components.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Capabilities/BiometricGate.razor.cs:18` · Level 1 · class (partial, component code-behind)

- **What it is**: a hybrid-head app-lock gate. It locks the UI behind a biometric prompt whenever the
  app returns from the background having sat there longer than `ReLockAfter`, so a device handed to
  someone else, or simply left unattended, does not reopen straight into a signed-in session.
- **Depends on**: injected services resolved by the component (`AppLifecycle`'s `Resumed` event,
  `Preferences`, `TokenStorage`, `AuthService` (`IAuthUIService`, used only to sign out), `Biometrics`, `Navigation`, `Logger`, the page's localizer `L`);
  MudBlazor's `MudButton` for the focus target (`_unlockButton`, line 30).
- **Concept introduced, an async-void lifecycle handler that cannot afford to throw.**
  `[Rubric §11, Security]` assesses whether a re-auth control actually re-arms on every qualifying
  event, not just the first one. The class subscribes to `AppLifecycle.Resumed` on first render
  regardless of the current preference, because app lock can be switched on later in the same session
  (comment, lines 53-54), and every resume re-reads the preference. `[Rubric §18, UI Architecture &
  Component Design]` covers the handler shape itself: `OnResumed` (line 94) is a plain
  `EventHandler<AppResumedEventArgs>`, so it cannot be `async`; it fires `ReLockAsync` with an explicit
  discard, and the security comment (lines 88-93) states why that discard is safe here, `ReLockAsync`
  observes its own failures with a catch-all, and an unobserved exception in a true async-void handler
  would crash a native head's process (VSTHRD100).
- **Concept introduced, a precondition read that fails open before opt-in and closed after it.**
  `[Rubric §11, Security]` also assesses which way a control fails when its own inputs are unreadable.
  The class summary states the rule (lines 15-16) and `ShouldLockAsync` documents both halves
  (lines 133-138): if the `AppLockEnabled` preference itself cannot be read, nothing says the owner
  opted in, so the gate stays open rather than forcing a biometric prompt on a device that may have
  none enrolled; if the preference reads as on but the stored session cannot be read, the session
  state is unknown and the gate locks. Either way the method never throws, which matters because it
  runs from both the first render and the resume path.
- **Walkthrough**
  - `ReLockAfter` (lines 25-26) is a `[Parameter]` `TimeSpan` defaulting to 30 seconds; the comment
    (lines 20-24) explains the default is deliberately short, a device handed off is usually away from
    its owner longer than a glance at a notification.
  - `OnAfterRenderAsync(firstRender)` (lines 40-66): first focuses the Unlock button if
    `_focusUnlockPending` and the button reference now exists (lines 42-46), because that flag can
    only be acted on once the locked branch has actually rendered (field comment, lines 32-36). On
    `firstRender` it subscribes to `AppLifecycle.Resumed` (lines 55-56), then calls `ShouldLockAsync`
    and, if it returns true, sets `_locked` and awaits `UnlockAsync` (lines 58-65).
  - `ReLockAsync` (lines 96-131) returns early if already locked or if the background duration was
    under `ReLockAfter` (line 100), otherwise dispatches the lock-and-unlock sequence through
    `InvokeAsync` (lines 105-115). It catches `ObjectDisposedException` and `InvalidOperationException`
    as expected teardown races (lines 117-124), and a general `Exception` last, logged rather than
    rethrown, with the comment (lines 127-128) recording that this is the exhaustive catch an async-void
    handler needs.
  - `ShouldLockAsync` (lines 139-167) wraps the preference read in its own `try` (lines 142-150): a
    failure is logged as a warning and returns false. A preference that is off also returns false
    (lines 152-155). Otherwise a second `try` (lines 157-166) returns whether a refresh token is still
    stored, nothing to protect without a session, and a failure there is logged and returns true
    (line 165).
  - `UnlockAsync` (lines 169-183) calls `Biometrics.AuthenticateAsync` with a localized prompt reason;
    success clears `_locked`, failure queues `_focusUnlockPending` for the next render rather than
    focusing immediately, because the button does not exist yet on the very first lock.
  - `FocusUnlockAsync` (lines 189-203) tolerates `JSDisconnectedException` (circuit gone) and
    `InvalidOperationException` (prerendering, or the element already removed).
  - `SignOutAsync` (lines 209-214) calls `AuthService.LogoutAsync()` (line 211), clears `_locked`, and navigates to `/login`. The doc (lines 205-208) states why it is the app's own logout and never a bare token clear: clearing the tokens alone left Blazor's auth state signed in and the previous session's read cache and offline snapshots on the device.
  - `Dispose(bool)` (lines 70-79) unsubscribes from `AppLifecycle.Resumed` if subscribed, guarded so
    it is safe to call more than once; the public `Dispose()` (lines 82-86) forwards to it and
    suppresses finalization.
- **Why it's built this way**: the re-lock decision is driven entirely by wall-clock background
  duration rather than any UI state, so it behaves the same whether the app was backgrounded for a
  phone call or for the rest of the day. Catching broadly inside `ReLockAsync` but narrowly inside
  `FocusUnlockAsync` reflects the difference between an operation whose caller cannot observe a failure
  at all (the lifecycle event) and one whose failure just means "skip the focus this time". The two
  catches inside `ShouldLockAsync` resolve in opposite directions on purpose: before opt-in the safe
  default is "no lock", after opt-in it is "lock".
- **Where it's used**: MMCA.ADC's `DeviceUIModule`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs`) and `App.xaml.cs`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs`); pinned by `BiometricGateTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/Capabilities/BiometricGateTests.cs`).

### BlazorCspSettingsValidator

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspSettingsValidator.cs:13` · Level 1 · class (internal, sealed)

- **What it is**: the startup `IValidateOptions<BlazorCspSettings>` that rejects a `frame-src` origin the moment it is misshapen, so a bad entry fails fast rather than silently reaching the CSP header.
- **Depends on**: first-party: [BlazorCspSettings](#blazorcspsettings) (the options type it validates). Externals: `Microsoft.Extensions.Options` (`IValidateOptions<T>`, `ValidateOptionsResult`), BCL `SearchValues<char>`, `Uri`.
- **Concept introduced, an explicit character denylist plus a shape check, not a regex.** The fail-fast configuration contract of ADR-070 (Website/docs-src/adr/070-fail-fast-configuration-contract.md) assesses whether a misconfigured setting is caught at startup instead of at request time. `Validate` (lines 21-31) runs every configured `FrameSources` entry through `IsValidOrigin` and fails the whole registration with one message per bad entry (lines 26-30) rather than starting the host on a policy it cannot honor.
  - `ForbiddenCharacters` (line 18, a `SearchValues<char>` over `*'";,@?#`) is the set that could either break out of a CSP source expression or widen it, plus the URL delimiters (user info, query, fragment) a plain origin never carries. `IsValidOrigin` (lines 21-25 of the walkthrough below) rejects on that set before it ever calls `Uri.TryCreate`, so a value crafted to look like a URL but carrying a CSP metacharacter never reaches the parser.
  - `[Rubric §26, Front-End Security]` assesses browser-side hardening; this validator is what keeps [BlazorCspSettings](#blazorcspsettings)'s contract (an absolute https origin, no path, wildcard, or delimiter) a checked invariant instead of a comment.
- **Walkthrough**
  - `Validate(string? name, BlazorCspSettings options)` (lines 21-31) null-guards `options`, projects every entry that fails `IsValidOrigin` into a message naming the section, the entry, and the shape it must satisfy (lines 26-30), and returns `ValidateOptionsResult.Success` only when that list is empty.
  - `IsValidOrigin(string? source)` (lines 34-49), `internal static`: rejects null, whitespace-only, any entry containing whitespace, anything matching `ForbiddenCharacters`, or anything `Uri.TryCreate` cannot parse as absolute (lines 36-41). What remains must be `https` (ordinal case-insensitive), have a non-empty host, and have `PathAndQuery` equal to exactly `"/"` (lines 46-48); the comment (lines 44-45) notes the forbidden set already rules out user info, a query, and a fragment, so a root-only path is the last thing separating an origin from a full URL.
  - `ToOrigin(string source)` (lines 55-56), `internal static`: `new Uri(source, UriKind.Absolute).GetLeftPart(UriPartial.Authority)`, the canonical `scheme://host[:port]` form used to splice a validated entry into the CSP header, lower-cased host, default port dropped, no trailing slash.
- **Why it's built this way**: an explicit character denylist checked before parsing is stricter than trusting `Uri` alone, because `Uri` will happily parse strings a CSP source expression cannot safely contain; failing every bad entry at once (rather than the first) gives a deployment the whole list of what to fix in one pass.
- **Where it's used**: registered alongside [BlazorCspSettings](#blazorcspsettings) in `MMCA.Common.UI.Web`'s [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs`); `ToOrigin` is reused by [BlazorCspPolicyProvider](#blazorcsppolicyprovider)'s `BuildFrameSrc` to canonicalize an already-validated entry.

### BlazorCspPolicyProvider

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28` · Level 2 · class (internal, sealed)

- **What it is**: the Content-Security-Policy provider for a Blazor Web host. It computes one CSP string at construction, pinning `connect-src` to `'self'` plus the configured API or Gateway origin (https and its matching WebSocket origin), optionally adding an opt-in `frame-src` directive, and hands the result to the shared security-headers middleware on every request.
- **Depends on**: first-party: [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the contract it implements, line 24), [CspPolicy](group-16-aspire-orchestration.md#csppolicy) (the value it returns, a policy string plus an `Enforce` flag), [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware) (its only consumer, named in the class doc at line 12), [ApiSettings](#apisettings) (the endpoint source, injected as `IOptions<ApiSettings>`, line 35), and [BlazorCspSettings](#blazorcspsettings) (the frame-src source, injected as `IOptions<BlazorCspSettings>`, line 36) whose entries it canonicalizes with [BlazorCspSettingsValidator](#blazorcspsettingsvalidator)`.ToOrigin` (line 94). Externals: `Microsoft.Extensions.Options` (`IOptions<T>`), `Microsoft.AspNetCore.Hosting` (`IWebHostEnvironment`), `Microsoft.AspNetCore.Http` (`HttpContext`), BCL `Uri`.
- **Concept introduced, a computed CSP that fails closed.** `[Rubric §26, Front-End Security]` assesses whether the browser is told which origins may load scripts and open connections. A static CSP cannot express "this deployment's API origin", because that origin is configuration, so the policy is *built* rather than hard-coded. The two directives that matter for exfiltration are locked: `script-src 'self' 'wasm-unsafe-eval'` (line 99, where the WASM allowance is what lets the Blazor WebAssembly runtime instantiate) and the computed `connect-src` (line 79). The load-bearing decision is what happens when the origin cannot be determined. The provider narrows `connect-src` to `'self'`, keeps the rest of the policy unchanged, and stays **enforced** (`Enforce: true`, line 62). A misconfigured endpoint therefore surfaces immediately as blocked API calls in the browser console rather than as a permissive header that protects nothing and that nobody notices, and the class doc states the reasoning outright: a security response header that quietly stops being enforced is the worse failure mode (lines 16-20).
  - `[Rubric §11, Security]` assesses the wider defense posture; this class is one control in a chain that also includes the session-cookie auth design and the security-headers middleware, and it is deliberately `internal` (line 24) so the only supported way to get it is the registration call, not a hand-wired `new`.
  - **`frame-src` is opt-in and null-safe.** [BlazorCspSettings](#blazorcspsettings)'s default is an empty `FrameSources` list, and `BuildFrameSrc` (line 85) returns `null` when it is empty (lines 87-90), which is what keeps the policy byte-identical to the pre-existing baseline for every deployment that has not opted in (comment, lines 83-84).
- **Walkthrough**
  - `_policy` (line 32) is a single `CspPolicy` field computed once. The constructor (lines 33-43) null-guards `apiOptions`, `cspOptions`, and `environment` and calls `BuildCsp(apiOptions.Value, BuildFrameSrc(cspOptions.Value), environment.IsDevelopment())` (line 42). Because the type is registered as a singleton, this runs exactly once per process.
  - `GetPolicy(HttpContext context)` (line 45) ignores the context and returns the cached policy, so the per-request cost is a field read.
  - `BuildCsp` (lines 49-80) now takes the pre-computed `frameSrc` as a parameter and resolves the endpoint as `api.WasmApiEndpoint ?? api.ApiEndpoint` (line 51). The guard on lines 55-59 rejects a blank value, a non-absolute URI, and any scheme that is not http or https; the comment on lines 53-54 records why the scheme check is not redundant: on Linux a rooted path such as `/relative/path` parses as an absolute `file://` URI and would otherwise sail through `Uri.TryCreate`. A rejected endpoint returns the enforced `connect-src 'self'` policy, still carrying `frameSrc` (line 62).
  - With a valid endpoint it derives `origin` via `apiUri.GetLeftPart(UriPartial.Authority)` (line 66, `scheme://host:port`), picks `wss` or `ws` to match (line 67), and composes `connect-src 'self' {origin} {wsScheme}://{authority}` (line 68). The WebSocket origin is there for the SignalR notification hub, so the live push channel is allowed without opening `connect-src` to the world.
  - Development only (lines 74-77) appends `http://localhost:*` and `ws://localhost:*` for Visual Studio Browser Link and Hot Reload, whose ports change per run (comment, lines 70-73); the production policy is untouched.
  - `BuildFrameSrc(BlazorCspSettings settings)` (lines 85-98) is new: it returns `null` on an empty `FrameSources` (lines 87-90), so the directive is omitted entirely rather than emitted empty; otherwise it maps every entry through [BlazorCspSettingsValidator](#blazorcspsettingsvalidator)`.ToOrigin`, de-duplicates with `StringComparer.OrdinalIgnoreCase` (lines 92-95), and joins the result into `"frame-src 'self' {origins}"` (line 97). The comment (lines 82-84) notes every entry already passed the startup validator, so canonicalization here cannot fail.
  - `BuildPolicy` (lines 103-112) now takes `frameSrc` as a parameter and assembles the directive list: `default-src 'self'`, the `script-src` above plus `'unsafe-inline'` **in Development only** (line 99, for the injected Hot Reload bootstrap), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https:` (line 101, deliberately open because profile pictures and content images come from arbitrary external hosts, per the comment on lines 93-96 of the class), `font-src 'self'`, the computed `connect-src`, the `frame-src` directive when non-null (line 110, spliced in with its own trailing `"; "` so a null value leaves the rest of the policy unchanged), `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'` (line 112, clickjacking protection).
- **Why it's built this way**: computing once and caching keeps the hot path free, and returning a [CspPolicy](group-16-aspire-orchestration.md#csppolicy) record rather than writing a header directly keeps the provider testable and lets one middleware own header emission. Registering it with `AddSingleton` (not `TryAdd`) is what makes it *replace* the default static provider, which is why the ordering rule in the class doc (lines 21-22) matters: call `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders`. `frame-src` is threaded through as a plain `string?` parameter rather than read a second time inside `BuildPolicy`, so the policy string is still built from one pass over its inputs.
- **Where it's used**: registered by `AddCommonBlazorCsp()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs`); the policy it returns is emitted by [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware). The class doc notes it was hoisted out of the app Blazor Web hosts where it had been byte-identical (line 21).
- **Caveats / not-in-source**: the registration method's own XML doc still describes the fallback as a "permissive Report-Only fallback on misconfiguration" (`MMCA.Common.UI.Web/DependencyInjection.cs:54`). The code is the truth: the fallback is enforced and narrowed to `'self'` (line 62). Treat that doc line as stale.

### NotificationInbox

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:27` · Level 4 · class (partial, page)

- **What it is**: the code-behind for the per-user notification inbox, routed at both `@page "/notifications/inbox"` and `@page "/notifications/inbox/{Id:int}"` (`NotificationInbox.razor:1-2`). It fetches the signed-in user's notifications a page at a time, renders each as a read or unread card, lets the user mark items read individually or all at once, highlights and scrolls to a deep-linked notification, and reloads the current page when a real-time push asks for a refresh.
- **Depends on**: first-party: [INotificationInboxUIService](#inotificationinboxuiservice) (the typed read-side HTTP service), [NotificationState](#notificationstate) (the per-circuit unread-count store and refresh signal), [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (the row shape), [IToastService](#itoastservice) (the toast abstraction), [ResultUiExtensions](#resultuiextensions) (the `NotifyOnFailure` helper), [SharedResource](#sharedresource) (the resx anchor for the localizer), [ViewerTimeZone](#viewertimezone) (the viewer's clock for sent times, resolved after first render), and [ComponentLifetimeExtensions](#componentlifetimeextensions) (the `LifetimeToken` read). Externals: `MudBlazor` (`IScrollManager`, `ScrollBehavior`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`[Inject]`, `[Parameter]`, `OnInitializedAsync`, `OnParametersSet`, `OnAfterRenderAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `CancellationTokenSource`, `IDisposable`, `Math.Ceiling`, `CultureInfo.InvariantCulture`.
- **Concept introduced, the Blazor code-behind page pattern (`.razor` plus `.razor.cs` partial class).** The three notification pages in this unit are authored as *partial classes* split across two files: the `.razor` holds declarative MudBlazor markup and the routes, the `.razor.cs` holds the C# (`public partial class NotificationInbox`, line 27), the injected services, the view state, and the handlers. The framework constructs the component, calls `OnInitializedAsync` (line 75) once, and re-renders when a handler mutates a field. Four habits recur across all three pages and are worth learning once here:
  - **Disposal-safe async with a per-component `CancellationTokenSource`.** A `readonly CancellationTokenSource _cts` (line 47) is created with the component and its token is read through `_cts.LifetimeToken()` ([ComponentLifetimeExtensions](#componentlifetimeextensions)) and passed to every service call (lines 111, 219, 271, 286, 307). Reading `.Token` off a disposed source throws `ObjectDisposedException`, so `LifetimeToken` returns an already-cancelled token instead and the work stops through the normal `OperationCanceledException` path (`ComponentLifetimeExtensions.cs:3-10,26-31`). `Dispose(bool)` (lines 338-350) cancels and disposes it behind the classic `_disposed` guard (line 336). Every async handler swallows `OperationCanceledException` silently (for example lines 241-244) because that is the *expected* outcome when the user navigates away mid-fetch.
  - **Result-typed failures, not exceptions.** The service calls return a `Result`, so the page branches on `TryGetValue` (line 220) and routes the failure through `result.NotifyOnFailure(Toast, L)` (line 238). The comment there (lines 236-237) records the rule that makes this safe: one toast, and the list is left as it was rather than blanked, so a transient failure does not erase what is on screen.
  - **Busy flags gate the UI.** `IsLoading` and `IsSaving` (lines 53-54) are `protected` with private setters; the markup shows progress while loading and sets `Disabled="IsSaving"` on the action controls (`NotificationInbox.razor:18`) so a double click cannot double-post.
  - **Push-driven refresh via an event subscription.** `OnInitializedAsync` subscribes to `NotificationState.OnRefreshRequested` (line 85) and `Dispose(bool)` unsubscribes (line 344).
  - `[Rubric §19, State Management & Data Flow]` assesses where state lives; transient view state stays in private fields (`_notifications`, `_currentPage`, `_totalPages`, lines 56-58) while the *shared* unread count is written back into the scoped [NotificationState](#notificationstate) (lines 289, 323) and its refresh signal is read. Local stays local, shared stays shared.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure. The second `@page` directive is a **typed deep link**: a push payload or an email can point straight at one notification. The class doc (lines 19-25) states the two design rules that follow from it: the `:int` route constraint is the validation boundary, so a malformed id never reaches the component (the router renders `NotFound` instead), and an id that is simply not on the loaded page degrades silently to the plain inbox rather than raising an error the user can do nothing about.
  - `[Rubric §21, Accessibility]`: the icon-only mark-read control carries an explicit localized `aria-label` (`NotificationInbox.razor:66`).
  - `[Rubric §27, Internationalization & Localization]`: this page holds no literal English. The injected `IStringLocalizer<SharedResource> L` (line 34) resolves the title (line 49), the breadcrumbs, and every toast (`L["Notif.AllMarkedRead"]`, line 324). The breadcrumb trail is built inside `OnInitializedAsync` (lines 79-83), not in a field initializer, so the injected localizer is available and labels re-resolve per circuit under the active culture (comment, lines 77-78, citing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - `PageSize` (line 29) is `const int 20`: fixed-size server-side pagination, not infinite scroll. Injected `InboxService`, `NotificationState`, `Toast`, `L`, MudBlazor's `ScrollManager`, and `ViewerTime` (lines 31-36).
  - `[Parameter] public int? Id` (line 45) is the deep-link route parameter. The doc (lines 38-44) explains the type choice: `UserNotificationIdentifierType` is an `int` alias, and a route parameter's type must be written out for the `:int` constraint to bind, so the parameter is declared `int?` and converted where it is used.
  - **Deep-link state is four separate fields, and each exists for a distinct reason** (lines 63-73): `_highlightedId` (found on the loaded page), `_pendingScrollId` (a scroll the next render owes), `_scrolledId` (already scrolled, so a re-render or push-driven reload never scrolls twice), and `_appliedId` (the `Id` the state was last computed for, to detect a re-navigation).
  - `OnParametersSet` (lines 96-105) clears the `_scrolledId` latch when `_appliedId != Id` and then recomputes the target. The doc (lines 90-95) records the bug this prevents: navigating from `/notifications/inbox/5` to `/notifications/inbox/9` reuses the component instance, so without clearing the latch the second deep link would highlight but never move the viewport.
  - `OnAfterRenderAsync` (lines 108-126) first resolves the viewer's time zone: on the first render, while the component is alive, it awaits `ViewerTime.EnsureResolvedAsync(_cts.LifetimeToken())` and calls `StateHasChanged` when the zone changed (lines 110-114), because sent times render on the viewer's clock and the zone is only readable once JS is available (comment, line 110). It is also the only place a scroll happens. It returns unless a scroll is pending and the component is alive, clears `_pendingScrollId` and sets `_scrolledId` **before** the await (comment, line 121, so a re-entrant render cannot queue the same scroll twice), and calls `ScrollManager.ScrollIntoViewAsync(CardSelector(id), ScrollBehavior.Smooth)` (line 125).
  - `ApplyDeepLinkTarget` (lines 134-148) matches the route id against what the loaded page actually holds: `Id is not { } id || id <= 0 || !_notifications.Exists(n => n.Id == id)` clears both the highlight and the pending scroll (lines 136-141). The doc (lines 128-133) is the "no toast" decision, a deep link the user cannot act on is not an error they caused.
  - The card-chrome helpers: `IsDeepLinkTarget` (line 150); `CardElementId` (lines 152-155, formatting `notification-{id}` with `CultureInfo.InvariantCulture` because it becomes a DOM id) and `CardSelector` (line 157); `CardElevation` (lines 160-168, 4 when deep-linked, else 1 for unread and 0 for read); `CardClass` (lines 177-183), which emits only state classes (`notification-card`, `read` or `unread`, plus `deep-linked`). The chrome those classes select lives in `wwwroot/app.css` (`.notification-card.unread` and `.notification-card.deep-linked`, `app.css:519,523`), built from MudBlazor palette tokens only so both themes stay legible: a primary left border marks unread, a secondary-colored ring plus a faint surface tint marks the deep link (doc, lines 170-176). `[Rubric §20, Design System & Theming]` shows up here: the page builds no inline styles, so its colors come from the theme's tokens in one stylesheet.
  - **Push coalescing.** `HandleRefreshRequested` (lines 185-193) is `EventHandler`-shaped so it cannot be `async Task`; it discards into `InvokeAsync(RefreshFromPushAsync)` (line 192). `RefreshFromPushAsync` (lines 195-212) sets `_refreshPending = true` and returns when a load is already in flight (lines 202-208); the comment (lines 204-205) states the invariant, never drop the push, so overlapping pushes coalesce into exactly one trailing reload instead of vanishing.
  - `LoadNotificationsAsync` (lines 214-258): sets `IsLoading`, calls `GetInboxAsync(_currentPage, PageSize, _cts.LifetimeToken())` (line 219), and on success materializes `page.Items` (line 222), computes `_totalPages` from `page.PaginationMetadata.TotalItemCount` with `Math.Ceiling` (line 223) clamped to a floor of 1 (lines 224-227) so an empty inbox never renders a zero-page pager, then recomputes the deep-link highlight (line 232, only a successful load can decide whether the id is present). The tail (lines 253-257) drains `_refreshPending` with one more `RefreshFromPushAsync`; the comment (lines 250-252) explains why the recursion is bounded, the flag is cleared first, so a push arriving during *this* reload queues one more and no further.
  - `OnPageChangedAsync(int page)` (lines 260-264): records the page and reloads.
  - `MarkReadAsync(UserNotificationDTO)` (lines 266-300): calls `MarkReadAsync(notification.Id, _cts.LifetimeToken())` (line 271), returns early on failure after a toast (lines 272-276), then **optimistically patches local state**, locating the row with `FindIndex` (line 279) and replacing it via a `record with`-expression, `notification with { IsRead = true, ReadOn = DateTime.UtcNow }` (line 282). It then refetches the authoritative unread count (line 286) and pushes it into `NotificationState.SetUnreadCount` only when the count call succeeded (lines 287-290); a failed count means "unknown", so the badge keeps its value (comment, line 285).
  - `MarkAllReadAsync` (lines 302-334): one service call (line 307), a loop flipping every unread row in place (lines 315-321), then `SetUnreadCount(0)` (line 323) and a localized success toast (line 324).
  - Disposal: `_disposed` (line 336), `Dispose(bool)` (lines 338-350) unsubscribing the refresh event and cancelling the `_cts`, `Dispose()` (lines 352-356) with `GC.SuppressFinalize`.
- **Why it's built this way**: the page is a *thin* view over [INotificationInboxUIService](#inotificationinboxuiservice), so all HTTP and JSON live in the service and the component stays testable against a stub. Patching local state after a mark-read (rather than refetching the page) keeps the interaction snappy while still reconciling the shared badge from the server, and the coalescing refresh keeps the list current when pushes arrive in bursts. The deep-link machinery is worth reading as a case study in idempotent side effects: a scroll is a one-shot action in a component model that re-renders freely, so it needs the "owed" and "already done" flags to be correct under re-render, re-navigation, and disposal.
- **Where it's used**: rendered at `/notifications/inbox` (and `/notifications/inbox/{Id:int}`) for authenticated users; the route constant and nav entry come from [NotificationRoutePaths](#notificationroutepaths) and [NotificationUIModule](#notificationuimodule). [NotificationBell](#notificationbell) reads the same [NotificationState](#notificationstate) this page writes, and the layout-mounted `NotificationListener` raises the `OnRefreshRequested` signal it consumes. Its admin siblings are [NotificationList](#notificationlist) and [NotificationSend](#notificationsend).

### NotificationList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:20` · Level 6 · class (partial, page)

- **What it is**: the code-behind for the **admin/organizer** push-notification history page, routed at `@page "/notifications"` (`NotificationList.razor:1`). It loads previously sent broadcasts and renders them in a status table, with a button onward to the compose page. It renders only for an account holding the `notifications:manage` permission claim; any other account gets the 403 view and the history endpoint is never called (field comment, lines 32-35).
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the send and history HTTP service), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the row shape, carrying status and recipient count), [NotificationRoutePaths](#notificationroutepaths) (the route constants), [IToastService](#itoastservice), [ResultUiExtensions](#resultuiextensions) (`NotifyOnFailure`), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `[Inject]`), `Microsoft.Extensions.Localization`.
- **Concept reinforced, the same code-behind shape as [NotificationInbox](#notificationinbox).** Same `[Inject]` service set (lines 22-26), same `readonly CancellationTokenSource _cts` plus dispose pattern (lines 30, 108-127), same `IsLoading` gate (line 41), same cancellation-swallowing load (lines 96-99), same `result.NotifyOnFailure(Toast, L)` failure surface (line 93). It differs only in *what* it loads and *how much* of it.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure and inter-page flow; navigation goes through [NotificationRoutePaths](#notificationroutepaths) constants (`NavigateToSend` targets `NotificationRoutePaths.NotificationSend`, line 106) rather than a literal URL, so a route change happens in exactly one file.
  - `[Rubric §27, Internationalization & Localization]` picks up an extra trick here: `DisplayStatus(string status)` (lines 45-50) looks up `L[$"Notif.Status.{status}"]` and falls back to the raw wire value when `localized.ResourceNotFound` (line 49). The *comparison* value stays the untranslated wire string while only the displayed chip text localizes, which keeps transport values and presentation separate and means a newly added server status renders (untranslated) instead of blanking (the comment on line 45 cites [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). This is the same pass-through-on-unknown-key discipline that [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) applies to error messages.
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Toast`, `L`, `ViewerTime` (lines 22-26) and a cascading `AuthenticationState` (line 28); `Title` reads `L["Notif.List.Title"].Value` (line 37); `_breadcrumbs` (line 39) is built Home to Push Notifications in `OnInitializedAsync` (lines 62-66), with the leaf crumb `disabled: true` to mark the current page (line 65).
  - `_notifications` is an `IReadOnlyCollection<PushNotificationDTO>` initialized empty (line 43).
  - `OnInitializedAsync` (lines 52-69) first reads the cascading auth state and sets `_canManage = user.HasPermissionClaim(NotificationPermissions.Manage)` (lines 54-55); when it is false it returns before building breadcrumbs or loading anything (lines 56-59), so the 403 view never triggers the history call. Otherwise it builds the breadcrumbs then awaits `LoadNotificationsAsync` (line 68). `OnAfterRenderAsync` (lines 71-79) resolves the viewer's time zone on the first render through `ViewerTime.EnsureResolvedAsync(_cts.LifetimeToken())` and re-renders when it changed, because sent times render on the viewer's clock and the zone is only readable once JS is available.
  - `LoadNotificationsAsync` (lines 81-104): calls `GetHistoryAsync(pageNumber: 1, pageSize: 50, _cts.LifetimeToken())` (line 86) and copies `history.Items` into `_notifications` on success (line 89), otherwise raises the localized failure toast (line 93). This page fetches **one fixed 50-row page** and lets MudBlazor page that buffer client-side; unlike the inbox there is no server round-trip per page.
  - `NavigateToSend` (line 106) sends the "send new" button to the compose page.
  - Disposal mirrors the family: `_disposed` (line 108), `Dispose(bool)` cancelling the `_cts` (lines 110-121), `Dispose()` (lines 123-127).
- **Why it's built this way**: broadcast history is low-volume admin data, so one 50-row fetch with client-side paging is simpler and adequate, and it avoids server-side paging plumbing that would earn nothing. Keeping HTTP behind [IPushNotificationUIService](#ipushnotificationuiservice) mirrors the inbox and keeps the component a thin view. The shared `[Rubric §18, UI Architecture & Component Design]` story is told under [NotificationInbox](#notificationinbox).
- **Where it's used**: rendered at `/notifications` for accounts holding the `notifications:manage` permission (the nav entry from [NotificationUIModule](#notificationuimodule) carries `RequiredPermission: NotificationPermissions.Manage`, `NotificationUIModule.cs:20`); it links onward to [NotificationSend](#notificationsend).
- **Caveats / not-in-source**: the 50-row ceiling is a client-side choice in this file; what the server does when more than 50 broadcasts exist (whether the page silently truncates the history) is not visible here.

### NotificationSend

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:23` · Level 6 · class (partial, page)

- **What it is**: the code-behind for the compose-and-broadcast form, routed at `@page "/notifications/send"` (`NotificationSend.razor:1`). It collects a title and a message into [NotificationSendModel](#notificationsendmodel), validates them against that model's own annotations, sends one broadcast through the Notification API, reports the recipient count, and returns to the history page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the `SendAsync` call), [NotificationSendModel](#notificationsendmodel) (the form model), [ModelValidation](#modelvalidation) + [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (the validation bridge), [INotificationScopeProvider](#inotificationscopeprovider) (the targeting caption), [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the wire contract), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the result carrying `RecipientCount`), [Result](group-01-result-error-handling.md#result), [NotificationRoutePaths](#notificationroutepaths), [ErrorMessages](#errormessages), [IToastService](#itoastservice), [ResultUiExtensions](#resultuiextensions), and [SharedResource](#sharedresource). The markup also composes an `UnsavedChangesGuard` bound to `IsDirty` (`NotificationSend.razor:12`). Externals: `MudBlazor` (`MudForm`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `OnInitialized`, `OnInitializedAsync`), `Microsoft.Extensions.Localization`.
- **Concept introduced, `MudForm` validation driven entirely by the model.** This is the family's *form* page, and it is the worked example of the validation stack in this unit. The markup declares `<MudForm @ref="_form" Model="_model">` with two fields that set `For`, `Validation="@_validate"`, and read their affordances off the same model (`NotificationSend.razor:43-66`). **No rule is declared in markup**: the comment above the form (lines 38-42 of the markup) spells out the division, `Required` drives the asterisk and `aria-required` while its message still comes from the model, `MaxLength` caps the input, and `Counter` shows the budget from the shared request contract so the numbers cannot drift from the server. The C# holds the form by reference (`MudForm? _form`, line 47) and explicitly drives validation before sending: `await _form.ValidateAsync()` then a guard on `_form.IsValid` (lines 122-129). MudForm has no `OnValidSubmit`, so that explicit pass is the gate (comment, lines 120-121).
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses input validation, double-submit protection, and feedback. All four are present: model-declared rules run through the shared delegate, an `IsSaving` flag (line 44) bound to `Disabled` on both buttons (`NotificationSend.razor:73,80`) so the send cannot be fired twice (backed in code by a re-entrancy guard, `_form is null || IsSaving`, raised before the first await at lines 109-113: each send mints its own idempotency key, so a second click that slipped in while the first was still validating would broadcast twice), a warning toast `ErrorMessages.ValidationError` on a failed gate (line 127), and a success toast naming the recipient count (line 137).
  - **Two failure surfaces, deliberately not one.** `_sendResult` (line 53) holds the last attempt's outcome and is rendered inline by the shared `ErrorSummary` component (`NotificationSend.razor:36`), while the toast stays the transient cue. The markup comment (lines 31-35) records the design constraint: the summary is deliberately *not* fed `MudForm.Errors`, because every field already renders its own message inline and MudBlazor contributes a generic "Required" of its own that would stack on top of the model's wording. `_sendResult` is nulled at the start of every attempt (line 118), so the summary never shows a stale failure.
  - `[Rubric §21, Accessibility]` and `[Rubric §18, UI Architecture & Component Design]` meet in the `ErrorSummary`: a failure that only appeared as a toast would time out on a long form and be unrecoverable for a screen-reader user who missed it (comment, lines 146-147).
  - `[Rubric §27, Internationalization & Localization]`: every string resolves through `IStringLocalizer<SharedResource> L` (line 28), including the success message `L.Plural("Notif.Send.SentTo", sent.RecipientCount, sent.RecipientCount)` (line 137), which passes the count through the shared plural extension so the resource file (not C#) picks the plural form as well as the word order. As with its siblings the breadcrumb trail is built in an initialization hook, here the synchronous `OnInitialized` (lines 66-78, comment citing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - `[Rubric §24, Forms, Validation & UX Safety]` again, for the navigate-away guard: `Sent` (a private bool, set true immediately before the post-send `NavigateTo`) and `IsDirty` (true whenever `Sent` is false and either field is non-blank) feed the markup's `UnsavedChangesGuard`, so leaving with typed-but-unsent text prompts, while the send's own redirect never does. The comment on the `Sent` setter records the ordering: it is set *before* the navigation call, because the guard reads the live accessor.
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Toast`, `L`, and `ScopeProvider` (lines 25-29), plus a cascading `AuthenticationState` (line 31); `_cts` (line 33); `_canManage` (line 38); `Title` (line 40); `_breadcrumbs` (line 42) built Home to Push Notifications to Send (lines 69-74), where the middle crumb is a real link via `NotificationRoutePaths.Notifications` (line 72) and the leaf is `disabled: true` (line 73).
  - `_model` (line 46) is a `readonly NotificationSendModel` created with the component; `_validate` (line 57) is the single `Func<object, string, IEnumerable<string>>` MudBlazor calls with `(model, member path)`, wired in `OnInitialized` as `ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` (line 77). One delegate serves both fields, and no rule is written twice (comment, lines 55-56).
  - `OnInitializedAsync` (lines 80-105) first reads the cascading auth state and sets `_canManage = user.HasPermissionClaim(NotificationPermissions.Manage)` (lines 82-83); when it is false it returns before touching the scope provider (lines 84-87), and the page renders the 403 view instead of the compose form (field comment, lines 35-38). Otherwise it resolves the optional scope caption: `ScopeProvider.GetCurrentScopeDisplayNameAsync(_cts.LifetimeToken())` (line 95), and only when the name is non-blank does it build `_scopeCaption` (lines 96-99). The field doc (lines 59-64) and the comment (lines 89-92) give the reasoning: a scoped application applies its scope to the send automatically, so without a caption the operator would be composing a broadcast with no visible statement of who receives it, and when there is no scope the page renders no caption at all rather than an empty line. `[Rubric §24, Forms, Validation & UX Safety]` again: making an implicit targeting decision visible is part of a safe destructive-ish action.
  - `SendNotificationAsync` (lines 107-159): returns at once when `_form` is null or a send is already in flight (lines 109-113), sets `IsSaving` (line 115), and inside the `try` clears `_sendResult` (line 118) and validates, warning on failure (lines 122-129), so a failed validation also releases the flag in `finally`; then builds `new SendPushNotificationRequest(_model.Title, _model.Body)` (line 131) and awaits `SendAsync(request, _cts.LifetimeToken())` (line 132), storing the result for the summary (line 133). On a non-null [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) it raises the success toast with `sent.RecipientCount` (line 137), sets `Sent = true` (line 141), and navigates back to the list; otherwise `result.NotifyOnFailure(Toast, L)` (line 148). The cancellation catch (lines 151-154) additionally names the `InteractiveAuto` render-mode transition, the case where the WebAssembly runtime takes over mid-call; `IsSaving` is cleared in `finally` (lines 155-158).
  - `NavigateToList` (line 161) is the Cancel button's handler, back to `NotificationRoutePaths.Notifications`.
  - `Sent` (a private bool property) and `IsDirty` (`!Sent && (Title or Body non-whitespace)`) are declared just after `NavigateToList`, immediately above the disposal members; `Sent` is documented as being set the moment a send has succeeded and the page is about to navigate away on its own, so the unsaved-changes guard does not prompt over work that has just left the building.
  - Disposal mirrors the family: `_disposed` (line 177), `Dispose(bool)` (lines 179-190), `Dispose()` (lines 192-196).
- **Why it's built this way**: a deliberately small form that still demonstrates the full pattern. The rules live on [NotificationSendModel](#notificationsendmodel) so the client cap, the client message, and the server invariant all read the same constants; HTTP stays behind [IPushNotificationUIService](#ipushnotificationuiservice) so the component is unit-testable; and the `Sent`/`IsDirty` pair keeps the unsaved-changes guard from firing on the page's own post-send redirect, which is the one navigation on this page that is not the user abandoning work. The send is fire-and-confirm: the server fans out to recipients through the push pipeline (see [Group 10](group-10-notifications.md)) and returns only the aggregate count.
- **Where it's used**: rendered at `/notifications/send` for accounts holding the `notifications:manage` permission (the same gate as the navigation entry, `NotificationUIModule.cs:20`; other accounts get the 403 view), reached from the button on [NotificationList](#notificationlist). The server-side validator for [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) enforces the same rules a second time, so client validation is a UX affordance rather than the security boundary.

### ServerTokenStorageService

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:30` · Level 13 · class (sealed)

- **What it is**: the Blazor **Server** implementation of [ITokenStorageService](#itokenstorageservice): a cookie-only token store with no `localStorage`. During SSR prerender it reads the access token from the HttpOnly session cookie; on the live interactive circuit it holds the access token in memory only and re-acquires it from those cookies through a same-origin refresh endpoint. The refresh token is never readable from JavaScript.
- **Depends on**: first-party: [ITokenStorageService](#itokenstorageservice) (the contract, line 35), [CookieTokenReader](group-08-auth.md#cookietokenreader) (reads the access and refresh cookies off the request), [ISessionCookieSync](#isessioncookiesync) (seeds and clears the HttpOnly cookies, and reports whether the write succeeded), [ITokenRefresher](#itokenrefresher) (acquires a fresh access token from `/auth/session/token`), [JwtTokenInfo](#jwttokeninfo) (client-side freshness check), and [ISessionAwareTokenRefresher](#isessionawaretokenrefresher) with its [TokenAcquisition](#tokenacquisition) result (`AccessToken`, `IsUnavailable`), the optional refresher capability that tells a definitive "no session" from an unavailable one (`ServerTokenStorageService.cs:153-156`). Its WASM sibling is [WasmTokenStorageService](#wasmtokenstorageservice) (named in the class doc, line 15). Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `HttpContext`), BCL `Lock`, `TimeProvider`, `Task`, `TimeSpan`, `InvalidOperationException`.
- **Concept introduced, the two-world token store (SSR request versus interactive circuit).** A Blazor Web page runs twice: first as a server-side prerender inside a live HTTP request, where an `HttpContext` exists and JS interop does not, and then as a stateful circuit with no `HttpContext`. One store has to serve both worlds, and this class branches on `httpContextAccessor.HttpContext is not null` (line 70) to decide which source of truth applies.
  - **SSR prerender** (lines 70-73): the request's HttpOnly cookie wins, read via `cookieTokenReader.ReadAccessToken()` (line 72), because the middleware may have just refreshed it in place on this navigation (comment, lines 68-69).
  - **Interactive circuit** (lines 75-112): the token lives in the `_accessToken` field (line 45). If `JwtTokenInfo.IsFresh(_accessToken, ExpirySkew)` (line 76) says it survives the 30-second skew (line 37), it is returned as is; otherwise it is re-acquired, unless a recent definitive "no session" answer is still remembered (the anonymous grace, next).
  - `[Rubric §26, Front-End Security]` assesses how credentials are held in the browser. This is a deliberate XSS-hardening design: the long-lived refresh token stays in an HttpOnly cookie unreachable from script, the access token exists only in circuit memory and is never persisted, and the refresh token transits JS exactly once, for the same-origin POST that seeds the cookies at login (`SetTokensAsync`, lines 122-135).
  - `[Rubric §11, Security]` assesses the wider auth model; this store is one edge of the browser session-cookie design ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)) and of the client token lifecycle ([ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html)), the piece that decides *where* a bearer token is read on each side of the prerender boundary.
  - **Login fails loudly, logout stays best-effort.** The two cookie writes are deliberately asymmetric. `SetTokensAsync` throws `InvalidOperationException("The session cookie could not be written.")` when `SyncAsync` returns `false` (lines 131-134), after the in-memory token is already set, so [AuthUIService](#authuiservice) reports `Auth.TokenStorageUnavailable` instead of a login that looks successful and then silently signs out at the first access-token expiry, when no cookie exists to refresh from (comment, lines 127-130). `ClearTokensAsync` discards the boolean (`_ = await sessionCookieSync.ClearAsync()`, line 143), because logout is best-effort by contract (`IAuthUIService.LogoutAsync` never fails); a caller that needs proof the session ended uses `IAuthUIService.RevokeAllSessionsAsync` (comment, lines 140-142).
  - **Anonymous grace, so a signed-out visitor costs one token round trip, not one per API call.** `AnonymousGrace` is a 15-second `static readonly TimeSpan` (line 40). When a hydrate returns no token and the refresher did not report itself unavailable, `HydrateAsync` sets `_anonymousUntil = now + AnonymousGrace` (lines 164-167); `GetAccessTokenAsync` then answers null from memory while `_accessToken is null` and the clock is before `_anonymousUntil` (lines 81-84). `SetTokensAsync` resets `_anonymousUntil` (line 125) so a login right after anonymous browsing does not wait out the grace, and a session created in another tab is seen within the window (class doc, lines 17-23). Only a DEFINITIVE answer starts it: a refresher implementing `ISessionAwareTokenRefresher` reports a 429, a 5xx, a dropped connection or unavailable interop as unavailable (comment, lines 148-151), so the next read hydrates again instead of treating a signed-in user as anonymous; a refresher without that capability keeps the earlier reading, where null means "no session" (lines 159-162).: a Blazor circuit is genuinely multi-threaded, and several consumers (the delegating handler, the auth-state provider, the SignalR connection) can all miss the cache at once.
- **Walkthrough**
  - The primary constructor (lines 30-35) takes `IHttpContextAccessor`, [CookieTokenReader](group-08-auth.md#cookietokenreader), [ISessionCookieSync](#isessioncookiesync), and [ITokenRefresher](#itokenrefresher), and a nullable `TimeProvider`. A public four-argument constructor (lines 49-64) chains to it with `timeProvider: null`, kept so code compiled against the original signature keeps binding (doc, lines 49-52). The type is `sealed` and carries no app-specific state, which is why it could be hoisted out of both app hosts (class doc, lines 14-16).
  - Fields: `ExpirySkew` (line 37, a `static readonly TimeSpan` of 30 seconds), `AnonymousGrace` (line 40, 15 seconds), the `Lock _hydrateSync` (line 42, the .NET 9+ dedicated lock object), `_timeProvider` (line 43, `timeProvider ?? TimeProvider.System`), the in-memory `_accessToken` (line 45), `_hydrateInFlight` (line 46), the shared acquisition task, and `_anonymousUntil` (line 47), the end of the remembered "no session" answer.
  - `GetAccessTokenAsync` (lines 66-113): the SSR/circuit branch, the freshness check, the anonymous-grace short-circuit (lines 81-84), then the **single-flight** guard. `_hydrateInFlight ??= HydrateAsync()` executes *inside* `lock (_hydrateSync)` (lines 91-95) and the resulting task is copied to a local before the lock is released. The comment on lines 86-89 records exactly why the naive unguarded `??=` was not enough: two callers could each start a hydrate and the later completion would overwrite the other's token; `HydrateAsync` reaches its first await immediately, so nothing slow runs under the lock. The `finally` (lines 101-112) clears `_hydrateInFlight` **only when it is still reference-equal to the task this caller awaited** (line 107), so a newer hydrate started after this one completed is not dropped, which would split the next set of callers again.
  - `GetRefreshTokenAsync` (lines 115-120): returns `cookieTokenReader.ReadRefreshToken()` during SSR and `null` on the circuit, because the HttpOnly refresh cookie is unreadable there; it wraps the value in `Task.FromResult` rather than being `async` (no await needed).
  - `SetTokensAsync` (lines 122-135): resets `_anonymousUntil` (line 125), caches the access token in memory (line 126), then awaits `sessionCookieSync.SyncAsync(accessToken, refreshToken)` and throws when it reports failure (lines 131-134).
  - `ClearTokensAsync` (lines 137-144): nulls the in-memory token (line 139) and awaits `sessionCookieSync.ClearAsync()` with its result explicitly discarded (line 143).
  - `HydrateAsync` (lines 146-170): the private acquisition. When the refresher is an `ISessionAwareTokenRefresher` it calls `TryAcquireAccessTokenAsync()` (line 155) and keeps both the token and the `IsUnavailable` flag; otherwise it calls `AcquireAccessTokenAsync()` (line 161). A null token with `unavailable` false starts the grace (lines 164-167); the token is cached and returned (line 169). Every await on the hydrate path uses `ConfigureAwait(false)` (lines 99, 155, 161), the library posture the cookie-write awaits do not take.
- **Why it's built this way**: Blazor Server's split lifecycle breaks the naive "read a token from storage" store, which would either fail during prerender (no JS) or leak the refresh token to script if it used `localStorage`. Branching on `HttpContext` presence and keeping the refresh token cookie-only resolves both. The locked single-flight is the correction of a real concurrency defect in the simpler `??=` version, and it is worth reading as a small case study in why "good enough" atomicity on a circuit is not good enough. Surfacing a failed cookie write at login, while tolerating one at logout, puts the failure where the user can still act on it. The 15-second anonymous grace trades a short staleness window for not paying a token round trip on every API call of a signed-out visitor, and it never remembers a transient failure. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: registered as the scoped [ITokenStorageService](#itokenstorageservice) by `AddCommonServerTokenStorage()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection-1) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:41-51`); consumer hosts call that instead of shipping their own copy. The same call registers [BrowserOriginHandler](#browseroriginhandler) on the `"APIClient"` pipeline (lines 47-48). Pinned by `ServerTokenStorageServiceTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Services/ServerTokenStorageServiceTests.cs`).
- **Caveats / not-in-source**: the cookie names, lifetimes, and the `/auth/session/token` endpoint itself are not in this file; they live in the `MMCA.Common.API` session-cookie plumbing referenced by the doc comment (lines 9-23).

### AuthenticatedServiceBase

> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:16` · Level 1 · class (abstract)

- **What it is**: the base class every UI-side HTTP service inherits. It supplies one shared Polly
  retry policy, two ways to get an `HttpClient` with a bearer token already attached, and the
  idempotency-key generator that makes those retries safe.
- **Depends on**: [ITokenStorageService](#itokenstorageservice), imported from the token namespace
  `MMCA.Common.UI.Services.Auth.Tokens` (`AuthenticatedServiceBase.cs:4`); its documentation also
  names [AuthDelegatingHandler](#authdelegatinghandler) as the thing it deliberately bypasses and
  `Auth.Tokens.ITokenRefresher`, that is [ITokenRefresher](#itokenrefresher), as the source of the
  replay token. Externals: `IHttpClientFactory`, `Polly` and `Polly.Retry`.
- **Concept introduced, why a base class and not just the handler pipeline.**
  `[Rubric §29, Resilience & Business Continuity]` assesses whether transient failures are absorbed
  rather than surfaced; the retry policy is that. The sharper teaching is in the
  `CreateAuthenticatedClientAsync` doc comment (`AuthenticatedServiceBase.cs:53-58`):
  `IHttpClientFactory` creates its handlers in a separate DI scope from the Blazor circuit, so a
  `DelegatingHandler` cannot reach the circuit's `IJSRuntime` to read the in-memory access token. The
  base class works around that by reading the token from the circuit-scoped storage service itself and
  setting the header directly. `[Rubric §9, API & Contract Design]` covers the idempotency half:
  retrying a POST is only safe if the server can recognize the repeat, which is what
  [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) provides.
- **Walkthrough**
  - `RetryPolicy` is a `protected static readonly AsyncRetryPolicy<HttpResponseMessage>` built once from
    the shipped backoff (`AuthenticatedServiceBase.cs:27`), so one policy instance serves the whole app
    rather than one per service instance per circuit. `ApiClientName` pins the named client to
    `"APIClient"` (`AuthenticatedServiceBase.cs:29`), and both constructor arguments are null-checked
    into private fields (`AuthenticatedServiceBase.cs:31-32`).
  - `SharedRetryPolicy` (`AuthenticatedServiceBase.cs:38`) is an `internal static` getter that returns
    that same `RetryPolicy` instance. Its doc comment (`AuthenticatedServiceBase.cs:34-37`) names the
    only reader, [IdempotentReadRetry](#idempotentreadretry), which reuses the exact policy object
    without inheriting from this class, so the anonymous read path and the authenticated one cannot
    drift apart.
  - `NewIdempotencyKey()` (`AuthenticatedServiceBase.cs:51`) returns a compact
    `Guid.NewGuid().ToString("N")`, and its remarks (`AuthenticatedServiceBase.cs:43-49`) carry the
    load-bearing rule: the value is generated once per logical operation and reused across every retry
    attempt, because the server-side idempotency filter keys its cached response off it. Generating a
    new key per attempt would defeat the dedup entirely and let a retry create a duplicate record.
  - `CreateAuthenticatedClientAsync()` (`AuthenticatedServiceBase.cs:59`) resolves the `"APIClient"`
    (`AuthenticatedServiceBase.cs:61`), reads the token (`AuthenticatedServiceBase.cs:65`), sets
    `Authorization: Bearer` when non-blank (`AuthenticatedServiceBase.cs:66-70`), and catches
    `InvalidOperationException` to proceed without a token during SSR prerender, when JS interop is
    unavailable (`AuthenticatedServiceBase.cs:72-75`).
  - `CreateClientWithToken(string accessToken)` (`AuthenticatedServiceBase.cs:88`) is the replay path.
    Its doc comment (`AuthenticatedServiceBase.cs:80-86`) explains why it exists: after the API answers
    `401`, the stored token still looks fresh by the client clock, so re-reading storage would just
    resend the token the server has already rejected. The caller passes the token it acquired straight
    from [ITokenRefresher](#itokenrefresher); the method rejects a blank one
    (`AuthenticatedServiceBase.cs:90`) and stamps the header unconditionally
    (`AuthenticatedServiceBase.cs:93`).
  - `IsRetryableResponse` (`AuthenticatedServiceBase.cs:108`) is the retry predicate. It first excludes
    `501 Not Implemented` and `505 HTTP Version Not Supported` (`AuthenticatedServiceBase.cs:110-113`)
    because, as the remarks say (`AuthenticatedServiceBase.cs:102-107`), those are permanent verdicts and
    retrying only burns the budget and delays the error the caller needs to see. It then asks
    `IsReplaySafe` whether the request may be sent again and gives up if not
    (`AuthenticatedServiceBase.cs:115-118`). Only then does it accept anything `>= 500` plus
    `408 Request Timeout` and `429 Too Many Requests` (`AuthenticatedServiceBase.cs:120-121`), the two
    codes where the server is explicitly inviting a later attempt.
  - `IsReplaySafe(HttpRequestMessage? request)` (`AuthenticatedServiceBase.cs:134`) is the gate that
    keeps a retry from duplicating a write. Its doc comment (`AuthenticatedServiceBase.cs:124-131`)
    states the rule: GET, HEAD, PUT, DELETE and the other idempotent verbs are always safe to re-send,
    while a POST or PATCH is safe only when it carries a non-blank `Idempotency-Key` header, which an
    `[Idempotent]` endpoint deduplicates on. Without a key, a failed attempt may still have run
    server-side, and a retry can hit a rate limit and replace the server's real failure with a 429. A
    response with no request attached is treated as safe (`AuthenticatedServiceBase.cs:136-139`). The
    method is `internal static` so a test can pin it directly, and the doc comment on `RetryPolicy`
    (`AuthenticatedServiceBase.cs:22-26`) carries the same POST/PATCH caveat.
  - `DefaultBackoff` (`AuthenticatedServiceBase.cs:153-155`) is the shipped schedule: `2^attempt`
    seconds (2s, 4s, 8s) plus up to one second of random jitter, so a fleet of clients does not
    re-converge on the same instant. The `S2245`/`CA5394` suppression around it
    (`AuthenticatedServiceBase.cs:150`) documents that the randomness only spaces retries and feeds no
    security decision.
  - `BuildRetryPolicy(Func<int, TimeSpan> backoff)` (`AuthenticatedServiceBase.cs:170-173`) is
    `internal` and backoff-injectable so a test can exercise the disposal contract without waiting out
    the real delays. Its `onRetry` disposes the retried attempt's response
    (`AuthenticatedServiceBase.cs:173`); the remarks (`AuthenticatedServiceBase.cs:162-169`) explain
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:47`),
  [ChildEntityServiceBase](#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:22`) and
  [NotificationInboxService](#notificationinboxservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:34`),
  and through them by every module-level UI service in the consumer apps. The members show up as
  `NewIdempotencyKey()` on writes (`EntityServiceBase.cs:174`), `RetryPolicy.ExecuteAsync` around each
  call (`EntityServiceBase.cs:365` and `EntityServiceBase.cs:393`) and `CreateClientWithToken` on the
  401 replay (`NotificationInboxService.cs:151`). The policy itself is also reached without
  inheritance by [IdempotentReadRetry](#idempotentreadretry)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/IdempotentReadRetry.cs:24`), which
  gives anonymous lookup services the same retries on GETs.

---

### IdempotentReadRetry

> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/IdempotentReadRetry.cs:18` · Level 2 · class (static)

- **What it is**: the retry that [AuthenticatedServiceBase](#authenticatedservicebase) applies, made
  reachable without inheriting from it, so a service that makes anonymous reads (a lookup service that
  creates a plain `APIClient`) gets three retries instead of a single attempt (class summary,
  lines 5-8).
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) for the policy instance, read
  through its `internal` `SharedRetryPolicy` (line 24,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:38`).
  Externals: `Polly.Retry` (`AsyncRetryPolicy<HttpResponseMessage>`, line 1) and BCL `HttpClient`.
- **Concept introduced, retry is only safe for an idempotent verb.** `[Rubric §29, Resilience,
  Reliability & Business Continuity]` assesses whether transient failures are absorbed rather than
  surfaced on every call path, not just the inherited one. `[Rubric §9, API & Contract Design]`
  covers the limit: the class remarks (lines 9-16) state that the policy re-sends on an
  `HttpRequestException`, a 5xx other than 501/505, 408 or 429, up to three times with 2s, 4s, 8s
  backoff plus jitter, and that re-sending is only safe when doing the operation twice is the same as
  doing it once. That is why the only entry point is a GET; a write that needs retries goes through
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype),
  whose creates carry an `Idempotency-Key` the server deduplicates on.
- **Walkthrough**
  - `Policy` (line 24) is an `internal static` getter returning
    `AuthenticatedServiceBase.SharedRetryPolicy`. Its doc comment (lines 20-23) stresses that it is the
    same object, not a copy built from the same settings, so the two paths cannot drift.
  - `GetAsync(HttpClient httpClient, Uri requestUri, CancellationToken cancellationToken)` (line 35)
    null-guards both arguments (lines 40-41) and returns
    `Policy.ExecuteAsync(token => httpClient.GetAsync(requestUri, token), cancellationToken)`
    (line 43), so the token is honored between attempts and by each send. The doc comment (lines 26-34)
    sets the ownership rule: every retried response is disposed by the policy, the caller owns and
    disposes the final one, and `HttpRequestException` escapes only when every attempt failed without a
    response.
- **Why it's built this way**: sharing the instance rather than re-declaring the policy keeps one
  definition of "retryable" and one backoff schedule for the whole UI layer, including the
  response-disposal behavior of `AuthenticatedServiceBase.BuildRetryPolicy`. Exposing a GET-only
  surface instead of a general `ExecuteAsync` is the guardrail: the type cannot be used to retry a
  non-idempotent write by accident.
- **Where it's used**: ADC lookup services that read anonymously, for example `SpeakerLookupService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerLookupService.cs:96`),
  `EventLookupService` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventLookupService.cs:102`),
  `CategoryItemLookupService` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/CategoryItemLookupService.cs:54`),
  `SessionLookupService` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/Lookups/SessionLookupService.cs:26,57`)
  and `NowNextService` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/HappeningNow/NowNextService.cs:26`).
  Several of them pass it as the per-page fetch inside [PagedReadAll](#pagedreadall). Pinned by
  `IdempotentReadRetryTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Api/IdempotentReadRetryTests.cs`).

### ClientConfigBuilder

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.ClientConfig` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigBuilder.cs:17` · Level 2 · class (sealed)

- **What it is**: the accumulator a host's own `extras` delegate writes into when it wants extra data
  served on the anonymous `/client-config` document, one named section per `Add` call.
- **Depends on**: [ClientConfigEndpointExtensions](#clientconfigendpointextensions) (its `ApiSectionName`
  constant, checked as the one reserved name, `ClientConfigBuilder.cs:57`); `Microsoft.AspNetCore.Http`
  (`HttpContext`, BCL) and `Microsoft.Extensions.DependencyInjection` /
  `Microsoft.Extensions.Configuration` for the two convenience accessors it republishes.
- **Concept, a builder with an internal constructor.** `[Rubric §26, Front-End Security]` covers what
  this type prevents: the constructor is `internal` (line 29), so the only place a `ClientConfigBuilder`
  can come into existence is inside `MapClientConfigEndpoint`'s own request delegate, which is also the
  one place a host's `extras` callback runs. A host cannot construct one ahead of time and stash
  arbitrary state in it outside the request it belongs to.
- **Walkthrough**
  - `_sections` (line 27) is a `Dictionary<string, object?>` keyed with `StringComparer.OrdinalIgnoreCase`,
    so `"OAuth"` and `"oauth"` collide as the same section.
  - `HttpContext` (line 32) and the two accessors built on it, `Services` (line 35, reads
    `HttpContext.RequestServices`) and `Configuration` (line 38, resolves `IConfiguration` from those
    services), let an `extras` delegate reach DI and configuration without the endpoint having to pass
    them separately.
  - `Add(string name, object? value)` (line 53) blank-checks `name`
    (`ArgumentException.ThrowIfNullOrWhiteSpace`, line 55), rejects the reserved
    `ClientConfigEndpointExtensions.ApiSectionName` case-insensitively (lines 57-62), then adds through
    `_sections.TryAdd` (line 64) so a second call with the same name throws rather than silently
    overwriting the first (lines 65-67). It returns `this` for chaining (line 69).
  - `Sections` (line 40) is `internal`, an `IReadOnlyDictionary<string, object?>` view the endpoint reads
    back after the delegate returns; nothing outside this package can enumerate a builder's contents.
- **Why it's built this way**: the reserved-name and duplicate-name guards live on the builder rather
  than being left to the endpoint's own loop, so every caller of `Add`, present or future, gets the same
  two checks for free. The internal constructor and internal `Sections` getter keep the type's read side
  as narrow as its write side: a host can only add, never inspect what a different extras call already
  added.
- **Where it's used**: constructed once per request inside
  [ClientConfigEndpointExtensions](#clientconfigendpointextensions)`.MapClientConfigEndpoint`'s handler
  and handed to the caller's `extras` delegate
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:63-64`);
  its `Sections` are then read back to assemble the response document
  (`ClientConfigEndpointExtensions.cs:73-76`). Exercised directly by
  `ClientConfigEndpointTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/ClientConfig/ClientConfigEndpointTests.cs`).

### ClientConfigEndpointExtensions

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.ClientConfig` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:17` · Level 2 · class (static)

- **What it is**: the extension that maps `GET /client-config`, the anonymous document a WASM client's
  bootstrap fetches to learn the browser-reachable API base address before it can hold a session, plus
  whatever extra sections the host contributes.
- **Depends on**: [ClientConfigBuilder](#clientconfigbuilder) (constructed per request, line 63),
  [ApiSettings](#apisettings) (`IOptions<ApiSettings>`, read for `WasmApiEndpoint`, line 55), and, only
  in a host running the same-origin API proxy, [SameOriginApiProxyMarker](#sameoriginapiproxymarker)
  (probed from request services, line 93) and [SameOriginApiProxySettings](#sameoriginapiproxysettings)
  (read for `PathPrefix`, line 98); externals `Microsoft.AspNetCore.Routing` (`IEndpointRouteBuilder`,
  `RouteHandlerBuilder`), `Microsoft.AspNetCore.Http` (`HttpContext`), `System.Text.Json`
  (`JsonNamingPolicy.CamelCase`), and the ASP.NET Core minimal-API `Results` type.
- **Concept introduced, fail-closed instead of falling back.** `[Rubric §22, Configuration and Secrets
  Management]` assesses whether a bad or missing configuration value is caught rather than silently
  degrading a live host. The endpoint's remarks (lines 33-40) state the rule directly: it serves
  `Api:WasmApiEndpoint`, the browser-reachable gateway URL, and never falls back to `Api:ApiEndpoint`,
  the server head's own service-discovery name, because a browser cannot resolve that name and serving
  it would hand the client a silently broken base address. A host missing the key answers every request
  with a server error naming the missing key (lines 56-61), which surfaces as a failed client start
  instead of a client quietly pointed at the wrong API.
- **Concept introduced, anonymous by declared necessity.** `[Rubric §11, Security]` covers why this
  endpoint is one of the few that must allow anonymous access on purpose: the WASM client fetches this
  document before it can hold a session (remarks, lines 41-46), and a host's fallback authorization
  policy would otherwise gate it like any other endpoint that states nothing. The endpoint therefore
  declares `AllowAnonymous()` itself (line 80) rather than relying on an ambient default, and the
  remarks warn that only values the public site renders anyway belong in `extras` (lines 44-45).
- **Concept introduced, an additive key for the same-origin proxy.** A host that runs the same-origin
  API proxy ([ADR-131](https://ivanball.github.io/docs/adr/131-same-origin-api-proxy.html)) gets one
  extra member in the `Api` section, `sameOriginApiEndpoint`, the proxy's origin-relative base (for
  example `/api/`) that the WASM bootstrap resolves against the page's own origin, while `apiEndpoint`
  stays the gateway for full-page navigations (doc, lines 84-90). The proxy's presence is detected
  from DI (the marker service), not from configuration, so every host without the proxy serves the
  section exactly as before and an existing client sees no change.
- **Walkthrough**
  - Two public constants: `ClientConfigPath = "/client-config"` (line 20) and
    `ApiSectionName = "Api"` (line 23), the one section name [ClientConfigBuilder](#clientconfigbuilder)
    treats as reserved.
  - The `extension(IEndpointRouteBuilder endpoints)` block (line 25, see
    [primer](00-primer.md#c-extensiont-types-read-this-once)) holds the single member
    `MapClientConfigEndpoint(Action<ClientConfigBuilder>? extras = null)` (line 52).
  - The handler (lines 53-79) takes the request's `HttpContext` plus `IOptions<ApiSettings>`, reads
    `apiSettings.Value.WasmApiEndpoint` (line 55), throws `InvalidOperationException` naming the missing
    key when it is blank (lines 56-61), builds a [ClientConfigBuilder](#clientconfigbuilder) for the
    request and invokes `extras` on it (lines 63-64), seeds the response with the camelCased `Api`
    section produced by `BuildApiSection(context, wasmApiEndpoint)` (lines 68-71), then overlays every
    builder section, each name run through the same `JsonNamingPolicy.CamelCase` policy the web JSON
    defaults apply to members (lines 73-76), so the document's shape matches what an anonymous-object
    payload would have produced anyway.
  - The route is finished with `.AllowAnonymous().ExcludeFromDescription()` (lines 80-81): anonymous
    for the reason above, and excluded from the OpenAPI description because it is not a data endpoint a
    client integrates against, it is bootstrap plumbing.
  - The private `BuildApiSection(HttpContext, string)` (lines 91-100) returns `new { ApiEndpoint }` when
    `GetService<SameOriginApiProxyMarker>()` is null (lines 93-96); otherwise it reads
    `IOptions<SameOriginApiProxySettings>.Value.PathPrefix` (line 98) and returns
    `new { ApiEndpoint, SameOriginApiEndpoint = prefix + "/" }` (line 99).
- **Why it's built this way**: putting the base-address selection, the reserved-name policy and the
  camelCase conversion all in one mapped endpoint means every host that calls
  `MapClientConfigEndpoint` gets the identical fail-closed contract; a host only supplies the pieces
  specific to it through `extras`. The same-origin key is decided here too, from the proxy's own DI
  marker, so a host that adds the proxy does not have to remember a second client-config change.
- **Where it's used**: called from a host's endpoint mapping alongside the other framework endpoints;
  its handler constructs [ClientConfigBuilder](#clientconfigbuilder)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigBuilder.cs`, 3 call
  sites) and is pinned by `ClientConfigEndpointTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/ClientConfig/ClientConfigEndpointTests.cs`, 2
  call sites).

### HttpResultExecutor
> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:35` · Level 3 · class (static)

- **What it is**: the wrapper every UI service call runs inside. It converts the faults that survive
  after a response has been handled, a refused connection, a DNS failure, a broken stream, a client
  timeout, into failed [Result](group-01-result-error-handling.md#result) values, so a service method
  typed as returning a `Result` really does return one.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and its generic sibling
  `Result<T>`, plus [Error](group-01-result-error-handling.md#error) for the failure it mints
  (`HttpResultExecutor.cs:2,133,136`); `System.Text.Json` and `System.Net.Http` (BCL) plus `Polly`
  (`HttpResultExecutor.cs:3`) for the fault set it recognizes. It is `static` and holds no state, so anything can call it, including services that
  derive from none of this package's bases.
- **Concept introduced, the two halves of "a client call never throws".**
  `[Rubric §9, API & Contract Design]` assesses whether the error channel between client and server is
  explicit and typed. The framework's answer has two pieces and this is the second one. The first,
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), converts a **response**:
  it reads the server's ProblemDetails body back into errors with the original
  [ErrorType](group-01-result-error-handling.md#errortype) intact. This class converts the **absence**
  of a response, and the class comment states the split outright (lines 12-17). Only with both does a
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
  (lines 18-24).
- **Walkthrough**
  - Two public constants name the failures it can mint, `TransportErrorCode = "Http.TransportFailure"`
    (line 38) and `TimeoutErrorCode = "Http.Timeout"` (line 41). They are public because they are the
    branch a page uses when it needs different wording; the two English messages are `internal`
    constants (lines 43-47), internal rather than private so that
    [ResultUiExtensions](#resultuiextensions) can recognize the executor's own sentence
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:400-405`).
  - `ExecuteAsync(Func<Task<Result>>, CancellationToken)` (line 56) and its generic twin
    `ExecuteAsync<T>(Func<Task<Result<T>>>, CancellationToken)` (line 91) are the whole public surface.
    Both are structurally identical, and both start with `ArgumentNullException.ThrowIfNull` (lines 58,
    93) and `cancellationToken.ThrowIfCancellationRequested()` (lines 63, 98). The pre-check is
    explained in the source (lines 60-62): an already-abandoned call must never reach the network, and
    the propagation contract has to hold even for an operation that would complete without ever
    observing the token.
  - The `try` simply awaits the caller's operation (lines 67, 102). Everything interesting is in the
    three catch clauses, and their order is the design.
  - `catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)` rethrows
    (lines 69-72, 104-107). This filter is the entire mechanism: the caller's token being cancelled is
    what identifies the exception as the caller's own.
  - The unfiltered `catch (OperationCanceledException)` (lines 73, 108) is therefore the other case:
    `HttpClient` gave up on its own timeout, which raises the same exception type with the token not
    cancelled. That one becomes a failure carrying `TimeoutError()` (lines 75, 110).
  - `catch (Exception exception) when (IsTransportFault(exception))` (lines 77, 112) filters rather
    than catching broadly, so nothing outside the recognized set is swallowed. `IsTransportFault`
    (line 127) admits four types: `HttpRequestException`, `IOException`, `JsonException` and
    Polly's `ExecutionRejectedException` (line 128), the base of `TimeoutRejectedException` and
    `BrokenCircuitException`, so a client resilience pipeline that refuses to run or finish the call
    also becomes a failure (`HttpResultExecutor.cs:3` imports `Polly`). The comment above it draws the
    line explicitly (lines 118-126): anything else is a programming fault and keeps travelling as an
    exception.
  - `TransportError` (line 130) puts the exception's own text on the error's `Source` rather than its
    `Message` (lines 131-133), because that text is diagnostic detail: not localizable, and not safe to
    render verbatim. `TimeoutError` (line 135) carries no detail at all.
- **Why it's built this way**: the class comment records the third consequence of the split (lines
  25-33): a transport failure never reached a server, so nothing localized it on the way back, which is
  why the two messages are English literals and why the codes are public. A page that needs translated
  wording does not read the synthesized message: `ResultUiExtensions.LocalizedErrorMessage` translates
  these two by their code, first through the localizer the page passes and then, when that has no such
  key, through the framework's own `SharedResource` pair for the current UI culture, and a page can
  also branch on the code or override the translation with the same key in its own resource pair.
  Keeping the type static and dependency-free is what lets services outside this package's
  hierarchy, including a consumer app's hand-written client, adopt the same contract with one call.
- **Where it's used**: it wraps every dispatch in this package,
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:359,389`),
  [ChildEntityServiceBase](#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:37,53,71`),
  [AuthUIService](#authuiservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:214,227,248,263,276,299`)
  and [NotificationInboxService](#notificationinboxservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:46,64,84,101`).
  Outside the framework it is called directly by services that sit outside the base hierarchy: Store's
  cart and lookup services
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/ShoppingCarts/CartStateService.cs:93,140,174,206,260,297`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:27,73`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/ProductVariantLookupService.cs:29,94`)
  and Helpdesk's single API client
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Services/HelpdeskApiClient.cs:30,50,64,84,95,109,122,138,149`).
  Its own behavior is pinned by
  [HttpResultExecutorTests](group-28-testing-infrastructure.md#per-project-test-rollup), including the
  code literals
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Api/HttpResultExecutorTests.cs:29-30`),
  the timeout-versus-cancellation split (`:150,164,178`) and the rethrow paths
  (`:192,206,219,230,240`).
- **Caveats**: a `JsonException` is classified as a transport fault, so a server that answers 200 with
  a body the client cannot deserialize produces the same generic "check the connection" message as a
  refused socket; the distinction is available in the error's `Source` but not in its code. The two
  user-facing messages are hard-coded English at the source; they reach a localized UI only when the
  page renders them through `LocalizedErrorMessage`, which replaces the sentence only while the error
  still carries the executor's own text (`ResultUiExtensions.cs:398-405`), so a page that displays
  `Error.Message` directly still shows English.

### PagedReadAll

> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/PagedReadAll.cs:19` · Level 3 · class (static)

- **What it is**: a helper that reads every row of an entity controller's `/paged` endpoint by
  requesting page after page until the server's reported total is reached, for hand-written services
  that need the whole set in one list (class summary, lines 8-11).
- **Depends on**: [Result](group-01-result-error-handling.md#result) and `Result<T>` for the return
  shape, [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and its
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) for each page (imported
  through `MMCA.Common.Shared.Abstractions` and `MMCA.Common.UI.Common`, lines 3-4). Externals: BCL
  `CultureInfo`, `string.Create`, `System.Diagnostics.CodeAnalysis`.
- **Concept introduced, a single read truncates silently.** `[Rubric §19, State Management & Data
  Flow]` assesses whether the data a page holds is the data the server has. The remarks (lines 12-18)
  record the trap: the API clamps any requested page size to its own maximum
  (`ApplicationSettings.MaxPageSize`, 500 by default), and the GET-all endpoint ignores `pageSize` and
  always returns that maximum, so rows past it vanish with nothing to say so. Paging until
  `PaginationMetadata.TotalItemCount` is reached is the only unbounded route. `[Rubric §29, Resilience,
  Reliability & Business Continuity]` applies to the loop bound: a server that misreports its total
  cannot make the client spin forever.
- **Walkthrough**
  - `PageSize` (line 22) is a public `const int` of 500, the API's default maximum, so no request is
    clamped (comment, line 21). `MaxPages` (line 28) is a private `const` of 40, the runaway guard of
    20,000 rows (comment, lines 24-27).
  - `LookupPageUrl(string entity, int pageNumber)` (line 43) builds
    `{entity}/paged?pageNumber=...&pageSize=500&sortColumn=Id&sortDirection=asc&includeFKs=false&includeChildren=false`
    with `string.Create(CultureInfo.InvariantCulture, ...)` (lines 44-46). Sorting by `Id` ascending
    keeps consecutive pages from skipping or repeating a row, and the doc comment (lines 30-38) makes
    the exact text part of a contract: a host that warms its output cache by replaying these URLs must
    replay them byte for byte. The `CA1055` suppression (lines 39-42) keeps the return a string for
    that reason, since callers both compose it as text and wrap it as a relative `Uri`.
  - `ReadAllAsync<T>(Func<int, Task<Result<PagedCollectionResult<T>>>> fetchPage, CancellationToken)`
    (line 57) null-guards the delegate (line 61) and loops `pageNumber` from 1 to `MaxPages`
    (line 65). Each iteration checks cancellation first (line 67), fetches the page (line 69), and
    returns the first failure unchanged as `Result.Failure<List<T>>(result.Errors)` (lines 70-73). An
    empty page ends the loop (lines 75-79); otherwise the items are accumulated (line 81) and the loop
    ends once the count reaches `TotalItemCount` (lines 83-86). The method returns
    `Result.Success(accumulated)` (line 89), so hitting the 40-page guard yields the rows read so far
    rather than a failure.
- **Why it's built this way**: the fetch is a delegate rather than an `HttpClient`, so each caller
  keeps its own transport choice (an authenticated `SendRequestAsync`, or an anonymous
  [IdempotentReadRetry](#idempotentreadretry) GET) and its own filters, while the paging rule lives
  once. Returning a `Result` rather than throwing keeps it inside the framework's client contract
  that a page branches on failures instead of catching them.
- **Where it's used**: ADC UI services `SpeakerLookupService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerLookupService.cs:91`),
  `EventLookupService` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventLookupService.cs:97`),
  `CategoryItemLookupService` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/CategoryItemLookupService.cs:37`)
  and `OrganizerFeedbackService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:27,82`).
  The ADC Conference service's `SelfHttpOutputCacheWarmupTask` replays URLs in the
  `LookupPageUrl` shape
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:38`). Pinned
  by `PagedReadAllTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Api/PagedReadAllTests.cs`).
  `OrganizerFeedbackService` composes its own filtered `/paged` URLs with `PagedReadAll.PageSize`
  rather than `LookupPageUrl` (`OrganizerFeedbackService.cs:32,87`), since it needs an `EventId` or
  `SessionId` filter.

### IRoleAdminUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/IRoleAdminUIService.cs:22` · Level 3 · interface

- **What it is**: the typed client contract for the role-admin editor: read every role's compiled and
  stored permissions, read one role, read the catalog an editor renders from, and replace one role's
  stored permission set.
- **Depends on**: first-party: [RolePermissionsResponse](group-08-auth.md#rolepermissionsresponse) (the
  per-role read and write shape), [PermissionCatalogResponse](group-08-auth.md#permissioncatalogresponse)
  (the closed sets a role editor may choose from), and [Result](group-01-result-error-handling.md#result)
  / `Result<T>` (`IRoleAdminUIService.cs:30,36,44,54`) for every member's return type. Its sole
  implementation is [RoleAdminService](#roleadminservice).
- **Concept**: each member's XML doc names the exact endpoint it calls (`GET Admin/Roles`,
  `GET Admin/Roles/{role}`, `GET Admin/Roles/catalog`, `PUT Admin/Roles/{role}/permissions`, lines
  27,32,40,47-48), so the contract doubles as the wire map for the role-admin surface without a
  separate reference. `[Rubric §1, SOLID Principles]` reads this as a small, role-scoped interface:
  it names only what a role editor needs and nothing a user editor would, the mirror decision to the
  split between [IUserAdminActionsUIService](#iuseradminactionsuiservice) and
  [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto) one member table below.
- **Walkthrough**: `GetAllAsync` (line 30) and `GetAsync(string role, ...)` (line 36) are the two reads
  that feed the role list and role-detail pages. `GetCatalogAsync` (line 44) reads the roles-plus-
  permissions catalog a role editor renders its checkboxes from. `SetStoredPermissionsAsync(role,
  permissions, ...)` (lines 54-57) replaces the complete stored permission set for one role in a single
  PUT, not an incremental add/remove, so the caller always sends the full desired set.
- **Why it's built this way**: this is an ADR-116 opt-in surface
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)): the admin app
  can wire role management by registering [RoleAdminService](#roleadminservice) against this contract
  without the framework hard-wiring an admin UI into every consumer.
- **Where it's used**: implemented by [RoleAdminService](#roleadminservice) and registered against it in
  [DependencyInjection](#dependencyinjection) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`);
  consumed by `RoleAdminEdit.razor.cs` and `RoleAdminList.razor.cs`; its ADC identity pages carry the
  behavior-pinning tests
  (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Roles/RoleEditTests.cs`,
  `RoleListTests.cs`).

### IUserAdminActionsUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/IUserAdminActionsUIService.cs:16` · Level 3 · interface

- **What it is**: the account-mutation contract for user admin: lock, unlock, and two shapes of
  role-replacement, a full-set `SetRolesAsync` and a single-role convenience `SetRoleAsync`.
- **Depends on**: first-party: [SetUserRolesRequest](group-08-auth.md#setuserrolesrequest) (implied wire
  shape behind `SetRolesAsync`), [Result](group-01-result-error-handling.md#result)
  (`IUserAdminActionsUIService.cs:22,26,33,41,56,58`); `UserIdentifierType` (the module's identifier
  alias) names every account parameter. Extended by
  [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto).
- **Concept, a member that exists only because a mock cannot proxy a default interface method.** The
  remarks on `SetRoleAsync` (lines 108-111) give the reasoning directly: the obvious shape would have
  been a default interface implementation over `SetRolesAsync` that wraps the single role in a
  one-element list, but a default implementation on an interface is not virtual to a mock proxy, so a
  test could neither stub nor verify it if it were written that way. Declaring `SetRoleAsync` as its
  own interface member keeps it mockable at the cost of one more line on the contract.
  `[Rubric §14, Testability]` is the rubric this decision serves.
- **Walkthrough**: `LockAsync(userId, ...)` (line 84) and `UnlockAsync(userId, ...)` (line 90) are the
  two session-revoking actions. `SetRolesAsync(userId, roles, ...)` (lines 97-100) replaces the complete
  role set an account holds. `SetRoleAsync(userId, role, ...)` (line 116) is documented as sending a
  one-element set to the same replacement endpoint (lines 102-106), the shape both shipped consumers
  need because each holds exactly one role per account.
- **Why it's built this way**: separated from the read/page surface in
  [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto) so the mutating actions have one
  narrow, generic-free contract a page or a test can depend on without also depending on the DTO type
  parameter.
- **Where it's used**: extended by [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto);
  implemented by [UserAdminService<TUserDto>](#useradminservicetuserdto); called directly from
  `UserAdminList.razor.cs` for the lock/unlock/role actions on the user-admin grid, and pinned by
  `UserListTests.cs` (ADC) and `UserAdminListTests.cs` (Common).

### ChangePasswordCard

> MMCA.Common.UI · `MMCA.Common.UI.Components.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/ChangePasswordCard.razor.cs:18` · Level 3 · class (partial component)

- **What it is**: the shared change-password form for a signed-in user: three password fields inside a
  `MudForm`, client-side length and confirmation checks, and a submit that calls the auth service and
  reports the outcome through toasts. A consumer app drops it into its profile page instead of
  re-implementing the form (ADC does so with a bare `<ChangePasswordCard />`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/Profile/Profile.razor:85`).
- **Depends on**: [IAuthUIService](#iauthuiservice) (`@inject AuthService`,
  `ChangePasswordCard.razor:2`), [IToastService](#itoastservice) (`ChangePasswordCard.razor:3`),
  `IStringLocalizer<ChangePasswordCard>` (`ChangePasswordCard.razor:4`) with the plural helper
  [StringLocalizerPluralExtensions](#stringlocalizerpluralextensions), [ResultUiExtensions](#resultuiextensions)
  for `LocalizedErrorMessage` (`ChangePasswordCard.razor.cs:130`), and
  [ComponentLifetimeExtensions](#componentlifetimeextensions) for `LifetimeToken()`
  (`ChangePasswordCard.razor.cs:114`). Externals: `MudForm` and `MudTextField` from MudBlazor.
- **Concept introduced, a form that reports the server's reason, not its own guess.**
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether validation feedback is honest and
  where it is raised. Two layers are visible here. The client checks only what it can know cheaply:
  the new password meets `MinLength` (`ChangePasswordCard.razor.cs:88-91`) and the confirmation
  matches (`ChangePasswordCard.razor.cs:93-96`); the server still enforces its own rules (doc comment,
  `ChangePasswordCard.razor.cs:33-36`). A server refusal is shown with the server's own message when it
  has one, falling back to a fixed `ChangePassword.Failed` text only when the failure carries none
  (comment `ChangePasswordCard.razor.cs:127-130`).
- **Walkthrough**
  - Parameters: `MinLength` defaults to `8`, the framework's password policy minimum, and also feeds the
    helper text (`ChangePasswordCard.razor.cs:38`; `ChangePasswordCard.razor:18`). `MaxLength` is an
    optional `int?` where `null` leaves the field unbounded (`ChangePasswordCard.razor.cs:45`); the
    razor falls back to the private `NoMaxLength` constant `524288`, MudTextField's own default
    (`ChangePasswordCard.razor.cs:20-21`; `ChangePasswordCard.razor:20`). `AdditionalActions`
    (`RenderFragment?`) renders extra actions, such as a device-management link, after the submit
    button (`ChangePasswordCard.razor.cs:52`; `ChangePasswordCard.razor:38`).
  - Callbacks: `OnChanged` fires after success, once the toast has been shown
    (`ChangePasswordCard.razor.cs:56`); `OnFailed` carries the failed `Result` after the failure
    toast, and is not raised for a client-side validation failure, which the form itself reports
    (`ChangePasswordCard.razor.cs:63`).
  - Validators: `ValidateNewPassword` and `ValidateConfirmPassword` return `null` for valid or empty
    input and leave the `Required` check to report a missing value (comment
    `ChangePasswordCard.razor.cs:86-87`). The length message is plural-aware through `L.Plural`
    (`ChangePasswordCard.razor.cs:91`), the mismatch uses `Validation.PasswordsDoNotMatch`
    (`ChangePasswordCard.razor.cs:96`), and the confirmation comparison is ordinal
    (`ChangePasswordCard.razor.cs:94`).
  - `SavePasswordAsync` (`ChangePasswordCard.razor.cs:98`) returns when the `@ref`-set form is absent
    (`:100-103`), validates the form and stops on invalid (`:105-109`), then sets `_isSaving` and calls
    `AuthService.ChangePasswordAsync(current, new, _cts.LifetimeToken())` (`:114`). On success it resets
    the form, clears the three fields, toasts `ChangePassword.Success` and raises `OnChanged`
    (`:116-124`). On failure it toasts and raises `OnFailed(result)` (`:130-131`). A cancelled call is
    swallowed (`:134-137`), and `_isSaving` always clears in `finally` (`:140`).
  - Disposal: the component implements `IDisposable` (`ChangePasswordCard.razor:5`).
    `Dispose(bool)` is idempotent, sets `_disposed`, then cancels and disposes the
    `CancellationTokenSource` (`ChangePasswordCard.razor.cs:74-83`). The `MudForm` reference is not
    disposed here because the renderer owns it (comment `ChangePasswordCard.razor.cs:25`).
- **Why it's built this way**: the cancel-on-dispose token is what makes a navigation away, or an
  InteractiveAuto render-mode transition, harmless: the in-flight request is cancelled and the
  `OperationCanceledException` is expected (comment `ChangePasswordCard.razor.cs:136`). Taking
  `MinLength` and `MaxLength` as parameters lets a consumer tighten the form without forking it, while
  the server remains the authority. Localization follows ADR-027
  (`Website/docs-src/adr/027-multi-locale-i18n.md`).
- **Where it's used**: ADC's profile page renders it (`Profile.razor:85`). Its behavior is pinned by
  `ChangePasswordCardTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/Auth/ChangePasswordCardTests.cs`), and
  `FormsConventionTestsBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/FormsConventionTestsBase.cs`)
  references it.

### ILegalAcceptanceUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Legal` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Legal/ILegalAcceptanceUIService.cs:16` · Level 3 · interface

- **What it is**: the UI-side contract for Terms of Service acceptance: read the signed-in user's
  standing, and record an acceptance of the version the user was shown. It is the dependency behind
  [TermsAcceptanceGate](#termsacceptancegate) (`TermsAcceptanceGate.razor.cs:61`).
- **Depends on**: `Result<T>` (`ILegalAcceptanceUIService.cs:1`) and `LegalAcceptanceDTO`
  (`MMCA.Common.Shared.Legal`, `ILegalAcceptanceUIService.cs:2`); both calls target
  `LegalAcceptanceRoutes.Path` (`ILegalAcceptanceUIService.cs:11`).
- **Concept introduced, no failure should block the user.** `[Rubric §9, API & Contract Design]`
  assesses whether the client treats the API's error channel as a typed contract. The remarks say every
  member returns a `Result` carrying the API's own errors, including a 404 for a host that serves no
  such endpoint, and nothing throws for a server answer or a transport fault, so a caller can treat any
  failure as "do not block" (`ILegalAcceptanceUIService.cs:10-15`).
- **Walkthrough**: `GetAsync(cancellationToken)` reads the standing via `GET Users/me/legal-acceptance`
  (`:21`). `AcceptAsync(version, cancellationToken)` records an acceptance via
  `POST Users/me/legal-acceptance` and returns the standing after acceptance (`:27`).
- **Why it's built this way**: an interface keeps the gate component testable and lets a host swap the
  transport. The framework registers the default with `TryAddScoped`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:170`), so a consumer's own
  registration wins.
- **Where it's used**: implemented by [LegalAcceptanceUIService](#legalacceptanceuiservice); consumed
  by [TermsAcceptanceGate](#termsacceptancegate) and by ADC's `LegalAndDataCard`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/Profile/LegalAndDataCard.razor.cs`).

### ChildEntityServiceBase
> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:19` · Level 4 · class (abstract)

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
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:76-87`),
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
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:22,35,48,61`).
  Each adds a typed `AddAsync`/`DeleteAsync` pair over the two protected methods and implements its own
  module interface (for example `:25-29`). The base is pinned by
  [ChildEntityServiceBaseTests](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats**: because there is no retry, a transient 503 on a join add surfaces to the user as a
  failure that the equivalent CRUD call would have retried away; that is a decision, not an oversight,
  but it is invisible from the subclass. Neither `PostAsync` overload exposes the response headers, so
  an endpoint answering `201 Created` with a `Location` header gives the caller no way to read it.

### EntityServiceBase<TEntityDTO, TIdentifierType>
> MMCA.Common.UI · `MMCA.Common.UI.Services.Api` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:43` · Level 4 · class (abstract)

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
  [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (line 132),
  [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt) and
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) with its
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) (lines 80, 128, 137),
  [IUiReadCache](#iuireadcache) (optional constructor parameter, line 47),
  [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) and
  [ConcurrencyETag](group-08-auth.md#concurrencyetag) (lines 210-212, 424),
  [IdempotencyHeaders](group-08-auth.md#idempotencyheaders) (line 413),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (lines 366, 394),
  [HttpResultExecutor](#httpresultexecutor) (lines 359, 389) and
  [ITokenStorageService](#itokenstorageservice) (line 46); Polly through the inherited `RetryPolicy`,
  and `System.Net.Http.Json` (BCL).
- **Concept introduced, one dispatch point for every cross-cutting HTTP concern.**
  `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses whether retry, auth and error handling are applied in
  one place instead of repeated per call: the six public methods contain only URL construction, and the
  two `SendRequestAsync` overloads (lines 351 and 381) contain all of the policy.
  `[Rubric §19, State Management & Data Flow]` applies because components never touch `HttpClient`:
  they inject the typed interface and receive DTOs wrapped in a `Result`.
  `[Rubric §29, Resilience, Reliability & Business Continuity]` applies through the inherited
  three-retry exponential-backoff-with-jitter policy
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:27`), whose
  predicate retries 5xx plus 408 and 429 but not 501 or 505 (`AuthenticatedServiceBase.cs:108`).
- **Concept introduced, retry safety for a non-idempotent verb.** `[Rubric §9, API & Contract Design]`
  assesses whether client and server share an explicit protocol for duplicate writes. A retry policy
  that re-issues a POST is a correctness hazard: if the first attempt reached the server and only the
  response was lost, the retry creates a second record. `AddAsync` is the one method that passes a key
  (line 174), minted by `AuthenticatedServiceBase.NewIdempotencyKey()` as a compact GUID
  (`AuthenticatedServiceBase.cs:51`). The key is set as a **default request header on the client**
  (line 413) rather than per request, and that one client instance serves every retry attempt, so all
  attempts carry the identical value (the comment at lines 409-412 says exactly that). The retry
  predicate enforces the same rule from the other side: a POST or PATCH response is retried only when
  its request carried a non-blank key (`AuthenticatedServiceBase.IsReplaySafe`,
  `AuthenticatedServiceBase.cs:134`), so a keyless write is sent once. The server side
  is the opt-in [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), and both ends
  read the header name from the shared [IdempotencyHeaders](group-08-auth.md#idempotencyheaders)
  constant. Reads, full-PUT updates and deletes send no key because they are naturally idempotent
  (comment at lines 168-170).
- **Concept introduced, the conditional write.** `[Rubric §24, Forms, Validation & UX Safety]` assesses
  whether the UI protects a user from silently overwriting somebody else's work. `UpdateAsync` sends
  the DTO's concurrency token as an `If-Match` entity tag (line 196), and that header is the only route
  the token travels (remarks at lines 182-187). A DTO carrying no token sends no header, and the server
  answers `428 Precondition Required` rather than accepting a blind write. `ConcurrencyTagOf` (line
  209) is the whole rule: a DTO that implements
  [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) with a non-empty `RowVersion`
  is formatted by `ConcurrencyETag.Format`, anything else yields `null` (lines 210-212). This is
  ADR-035 (`Website/docs-src/adr/035-optimistic-concurrency.md`) seen from the client.
- **Concept introduced, a read-through cache keyed by the request URL.**
  `[Rubric §23, Front-End Performance & Rendering]` assesses whether the client avoids work it has
  already done. `GetCachedAsync` (line 253) is the client half of ADR-040
  (`Website/docs-src/adr/040-authenticated-output-caching-for-public-reads.md`): the relative URL, path
  plus full query string, **is** the cache key, deliberately matching the server-side output cache's
  `QueryKeys = "*"` shape, and the `CA1054` suppression at lines 249-252 exists to keep it a verbatim
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
  - `PagedIncludeFKs` (line 65) is a `protected virtual bool` that defaults to `false`, so the paged
    URL is unchanged by default; a service whose list grid shows a foreign-key name (a product's
    category) overrides it to `true`, and `GetPagedAsync` then appends `includeFKs=True` (lines
    104-107). Only the paged read has this hook: `GetAllAsync` takes `includeFKs` as an argument
    (line 69).
  - `GetAllAsync(includeFKs, includeChildren, ct)` (line 68) builds a two-parameter query string
    (lines 73-77), goes through the cache (line 80), and maps the paged envelope down to its items
    (line 82). The "all" endpoint answers with the paged envelope, not a bare array.
  - `GetPagedAsync(filters, pageNumber, pageSize, sortColumn, sortDirection, includeChildren, ct)`
    (line 86) is the one with real work. Page numbers are formatted with
    `string.Create(CultureInfo.InvariantCulture, ...)` (lines 97-98) so a comma-decimal locale cannot
    corrupt the query, and every filter property, operator and value goes through
    `Uri.EscapeDataString` (lines 115-117). Filters serialize as `filters[Property].operator=` plus an
    optional `filters[Property].value=`, and a filter whose operator is blank is skipped entirely
    (line 113), which is how a grid clears a column filter. It targets `{Endpoint}/paged` (line 122)
    and maps the envelope to the `(Items, TotalItems)` tuple a server-side data grid binds to
    (lines 127-128).
  - `GetAllForLookupAsync(nameProperty, ct)` (line 132) hits `{Endpoint}/lookup` (line 136) and maps a
    `CollectionResult<BaseLookup<TIdentifierType>>` to its items (lines 137-139), the lightweight
    id-plus-name shape that feeds dropdowns and autocompletes.
  - `GetByIdAsync(id, includeChildren, ct)` (line 143) is a plain cached GET (line 158). A missing
    entity is a `NotFound` failure, not a null, and the comment records both halves of why
    (lines 155-157): the caller can tell it apart from a transport failure via
    [ResultUiExtensions](#resultuiextensions)`.IsNotFound`, and a failure is never cached, so a 404 is
    re-asked every time.
  - `AddAsync(entity, ct)` (line 162) POSTs with the idempotency key (lines 171-175) and then calls
    `InvalidateAfterWrite` (line 177). `UpdateAsync(entity, ct)` (line 188) PUTs to
    `{Endpoint}/{GetEntityId(entity)}` with the `If-Match` tag (lines 192-197); `DeleteAsync(id, ct)`
    (line 215) DELETEs `{Endpoint}/{id}` (lines 219-223). All three call `InvalidateAfterWrite`
    (lines 177, 199, 225), which invalidates on success and on most failures (see below).
  - `GetEntityId(entity)` (line 229) is `protected virtual` and returns `entity.Id`, the hook a
    subclass overrides when the route key is not the DTO's own id.
  - `GetCachedAsync<T>(url, ct, bypassCache)` (line 253) guards the url (line 258), goes straight to the
    network when no cache is registered or the caller asked to bypass (lines 260-263), answers from a
    fresh entry when there is one (lines 265-268), and otherwise fetches and stores. Before the GET it
    captures `ReadCache.Generation` (line 273), and the store passes that value back as
    `ReadCache.Set(url, result.Value, generation)` (line 280); the comment (lines 270-272) explains
    that a write invalidating this endpoint while the read is in flight moves the generation, so the
    late store is dropped instead of re-caching a value the write just made stale. Only a success
    with a non-null value is stored (lines 276-281), because caching a failure would pin a transient
    outage in front of the user for the whole TTL and a cached 404 would survive the create that fixed
    it. `bypassCache` exists for a read the user explicitly asked to be current, a refresh button or a
    re-poll after a push (documented at lines 243-247).
  - `InvalidateAfterWrite` (line 300) drops this endpoint's cached reads by prefix, and it is no longer
    success-only. It invalidates when the write succeeded or when any error is NOT one the server
    raised before touching state (line 302). `IsRejectedBeforeWrite` (line 309) lists the
    refused-before-write types: `Validation`, `UnprocessableEntity`, `Unauthorized`, `Forbidden` and
    `TooManyRequests` (lines 310-314). Those changed nothing, so invalidating would throw away entries
    that are still accurate. Every other outcome invalidates because server state is changed or unknown
    (doc, lines 291-298): a 412, 404 or 409 can answer the retry of a write whose first attempt landed
    and only lost its response, and a 5xx or transport failure says nothing about whether it landed.
    `AsReadOnlyList` (line 320) presents a deserialized `Items` collection
    without assuming the JSON reader produced a list (lines 321-326).
  - `SendRequestAsync<T>` (line 351) and `SendRequestAsync` (line 381) are the center of the class and
    are structurally identical: null-guard the lambda (lines 357, 387), wrap everything in
    [HttpResultExecutor](#httpresultexecutor) (lines 359, 389), build a client for this one logical
    operation (lines 364, 392), execute the caller's lambda through `RetryPolicy` with the cancellation
    token threaded in so a cancelled operation does not sleep out its backoff (lines 365, 393), and
    hand the response to [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader)
    (lines 366, 394). The generic overload fails a 2xx with no body via the reader's
    `EmptyResponseCode`, which is why the body-less overload exists at all (documented at lines
    346-350). The client is kept in scope across the read on purpose (comment at lines 362-363).
  - `CreateRequestClientAsync(idempotencyKey, ifMatch)` (line 403) is where both conditional headers are
    attached (lines 407-425), each with a comment stating the retry property it preserves: the same key
    on every attempt, and the same precondition on every attempt so a write that lost the race fails
    consistently instead of succeeding on a later attempt against a version the caller never saw. The
    `If-Match` comment (lines 418-423) adds the other half: when the first attempt landed and only its
    response was lost, the retry answers 412 (or 404 for a soft-deleted row) for a write that
    happened, which is why that outcome still invalidates the cache through `InvalidateAfterWrite`.
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
  [EntityServiceBaseTests](group-28-testing-infrastructure.md#per-project-test-rollup),
  [EntityServiceBaseCachingTests](group-28-testing-infrastructure.md#per-project-test-rollup) and
  [EntityServiceBaseIdempotencyRetryTests](group-28-testing-infrastructure.md#per-project-test-rollup),
  which asserts the key is emitted on creates only and stays identical across attempts.
- **Caveats**: `GetAllAsync` sends no page size, but it is not unbounded: the "all" endpoint ignores
  `pageSize` and returns at most the API's maximum page size (500 by default), so rows past it are
  silently dropped (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/PagedReadAll.cs:12-18`).
  A service that needs every row pages with [PagedReadAll](#pagedreadall), and grids use
  `GetPagedAsync`. The generation guard only works against an [IUiReadCache](#iuireadcache) that
  implements it: the interface defaults `Generation` to `0` and the three-argument `Set` to the plain
  `Set` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Caching/IUiReadCache.cs:40,70`),
  which the shipped [UiReadCache](#uireadcache) overrides
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Caching/UiReadCache.cs:34,104`). The read
  cache is keyed by URL alone and holds nothing about who fetched it, so it is only safe while
  [IUiReadCache](#iuireadcache) stays a per-circuit registration. `GetPagedAsync` accepts a `filters`
  dictionary that the signature does not declare nullable (line 87), yet the body null-checks it
  (line 109): defensive against a caller the signature says cannot exist.

### LegalAcceptanceUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Legal` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Legal/LegalAcceptanceUIService.cs:23` · Level 4 · class (sealed)

- **What it is**: the default [ILegalAcceptanceUIService](#ilegalacceptanceuiservice): a small
  HTTP service that reads and records the signed-in user's Terms acceptance against the framework's
  legal-acceptance route.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (base class, `:26`) for the
  bearer-token client and `RetryPolicy`, [ITokenStorageService](#itokenstorageservice) (constructor,
  `:24-25`), [HttpResultExecutor](#httpresultexecutor) and
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) for the error contract, plus
  `LegalAcceptanceRoutes.Path`, `LegalAcceptanceDTO` and `AcceptLegalTermsRequest` from the Shared
  project.
- **Concept introduced, the same dispatch recipe, minus the generic base.** `[Rubric §29, Resilience,
  Reliability & Business Continuity]` applies through the shared pipeline shape ADR-094 records
  (`Website/docs-src/adr/094-client-entity-data-access.md`): executor outside, reader innermost.
  The class does not derive from [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  because the route is not CRUD, so each method composes the pieces itself.
- **Walkthrough**
  - `GetAsync` (`:29`) wraps the call in `HttpResultExecutor.ExecuteAsync` (`:30`), creates the
    authenticated client (`:33`), sends the GET through `RetryPolicy.ExecuteAsync` (`:34`) and reads the
    response with `ProblemDetailsResultReader.ReadAsync<LegalAcceptanceDTO>` (`:38`).
  - `AcceptAsync` (`:44`) rejects a blank `version` (`:46`), then wraps the call the same way
    (`:48`) but posts an `AcceptLegalTermsRequest(version)` straight through the client (`:52-55`)
    without `RetryPolicy`, so the write is sent once. This fits the replay rule: the retry predicate
    would not retry a keyless POST anyway (`AuthenticatedServiceBase.cs:115-118`).
- **Why it's built this way**: keeping it `sealed` and thin leaves the gate component with one
  mockable interface, and the executor guarantees the "any failure means do not block" contract the
  interface documents.
- **Where it's used**: registered as the scoped default for the interface
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:170`) and exercised by
  `LegalAcceptanceUIServiceTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Legal/LegalAcceptanceUIServiceTests.cs`).

### IUserAdminUIService<TUserDto>

> MMCA.Common.UI · `MMCA.Common.UI.Services.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/IUserAdminUIService.cs:18` · Level 4 · interface

- **What it is**: the read-plus-actions contract a user-admin page depends on: the two paged/single
  reads generic over the consumer's own user DTO, plus every mutation from
  [IUserAdminActionsUIService](#iuseradminactionsuiservice) via interface inheritance.
- **Depends on**: extends [IUserAdminActionsUIService](#iuseradminactionsuiservice) (line 18); its
  reads are generic over `TUserDto`, the consumer-supplied user row shape. `UserIdentifierType` names
  the account parameter of `GetAsync`. Implemented by
  [UserAdminService<TUserDto>](#useradminservicetuserdto).
- **Concept, the type parameter is the seam between a shared service and an app-specific DTO.** ADC and
  Store each ship their own user row shape (different columns for the admin grid), so the interface is
  generic rather than fixed to one DTO, and only the read half needs the parameter: the write half in
  [IUserAdminActionsUIService](#iuseradminactionsuiservice) takes only an id and never returns a DTO, so
  it carries no type parameter of its own. `[Rubric §1, SOLID Principles]` reads the split as interface
  segregation again: a caller that only needs to lock or re-role an account depends on the narrower,
  non-generic interface.
- **Walkthrough**: `GetPagedAsync(pageNumber, pageSize, searchTerm, role, ...)` (lines 146-151) reads
  one page of accounts from `GET Admin/Users/paged`, with an optional free-text search and an optional
  role filter; the doc (line 142) leaves which fields the search covers to the server. `GetAsync(userId,
  ...)` (line 157) reads one account, including its lock state, from `GET Admin/Users/{userId}`.
- **Why it's built this way**: generic over `TUserDto` rather than one fixed shape keeps the paging and
  single-read plumbing in the framework while each consumer app supplies its own admin row DTO.
- **Where it's used**: implemented by [UserAdminService<TUserDto>](#useradminservicetuserdto),
  registered against it by [DependencyInjection](#dependencyinjection); consumed by
  `UserAdminList.razor.cs` and ADC's `UserDetail.razor.cs`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserDetail/UserDetail.razor.cs`),
  and pinned by `UserAdminListTests.cs` (Common) and `UserDetailTests.cs` (ADC).

### RoleAdminService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/RoleAdminService.cs:25` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of [IRoleAdminUIService](#iroleadminuiservice), the four calls
  against the `Admin/Roles` endpoint family.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (base class,
  `RoleAdminService.cs:25`), [IRoleAdminUIService](#iroleadminuiservice) (implemented interface),
  [HttpResultExecutor](#httpresultexecutor) (lines 217, 243),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (lines 228, 251),
  [RolePermissionsResponse](group-08-auth.md#rolepermissionsresponse) and
  [PermissionCatalogResponse](group-08-auth.md#permissioncatalogresponse) (the response bodies),
  [SetRolePermissionsRequest](group-08-auth.md#setrolepermissionsrequest) (the write payload, line 224);
  `IHttpClientFactory` and [ITokenStorageService](#itokenstorageservice) (primary-constructor
  parameters, lines 178-180).
- **Concept, one private generic GET carries all three reads.** `GetAsync<TResponse>(url,
  cancellationToken)` (lines 242-254) is the whole shared shape: authenticate, retry through the
  inherited `RetryPolicy`, read the body or the Problem Details. `GetAllAsync`, `GetAsync(role, ...)`
  and `GetCatalogAsync` are each a one-line call into it with a different URL and response type (lines
  186-188, 191-200, 203-204). Only the write, `SetStoredPermissionsAsync`, needs its own method, because
  it is the one call whose response reader differs (a `RolePermissionsResponse` rather than a bare
  success) and whose HTTP verb is `PUT`.
- **Walkthrough**: `Endpoint` (line 183) is the private constant `"Admin/Roles"`. `GetAllAsync` (lines
  186-188) hits the endpoint bare. `GetAsync(string role, ...)` (lines 191-200) null-checks `role` then
  appends `Uri.EscapeDataString(role)`, so a role name with reserved URL characters still round-trips.
  `GetCatalogAsync` (lines 203-204) appends `/catalog`. `SetStoredPermissionsAsync` (lines 207-232)
  null-checks both arguments, builds `{Endpoint}/{role}/permissions`, and PUTs a
  [SetRolePermissionsRequest](group-08-auth.md#setrolepermissionsrequest) wrapping the complete
  permission list (line 224), inside the same authenticate-retry-read wrapper as the private read
  helper but written out separately because it POSTs (in fact PUTs) rather than GETs.
- **Why it's built this way**: matches the composition every other service in this package uses,
  [HttpResultExecutor](#httpresultexecutor) outside, `RetryPolicy` in the middle,
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) innermost, so a reader who
  has studied [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  already knows the shape here. It is a plain [AuthenticatedServiceBase](#authenticatedservicebase)
  subclass rather than an [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  one because roles are not a CRUD resource with create/delete: only read and one full-replace write
  exist.
- **Where it's used**: registered against [IRoleAdminUIService](#iroleadminuiservice) by
  [DependencyInjection](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`). See
  [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).

### UserAdminService<TUserDto>

> MMCA.Common.UI · `MMCA.Common.UI.Services.Administration` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/UserAdminService.cs:26` · Level 5 · class (sealed)

- **What it is**: the HTTP implementation of
  [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto), generic over the consumer's user DTO,
  covering paged read, single read, lock/unlock, and role replacement against the `Admin/Users`
  endpoint family.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (base class),
  [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto) (implemented interface),
  [HttpResultExecutor](#httpresultexecutor) (lines 534, 558, 595, 618),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (lines 542, 566, 606, 631),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (line 542, the
  paged-read response envelope), [SetUserRolesRequest](group-08-auth.md#setuserrolesrequest) (line 602,
  the role-replace payload); `UserIdentifierType` names every account parameter;
  `System.Globalization.CultureInfo.InvariantCulture` formats every interpolated URL segment (lines 518-519,
  556, 593, 616).
- **Concept, the same read/write composition as its sibling [RoleAdminService](#roleadminservice), plus
  one query-string builder.** `GetPagedAsync` (lines 509-549) is the one method with real assembly work:
  it always sends `pageNumber` and `pageSize` (lines 516-520), and appends `searchTerm` and `role` only
  when non-blank, each through `Uri.EscapeDataString` (lines 522-530), the same optional-filter pattern
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) uses for
  its own query strings. The paged envelope is mapped down to the `(Items, TotalItems)` tuple a
  server-side data grid binds to (lines 547-548).
- **Walkthrough**: `Endpoint` (line 506) is the private constant `"Admin/Users"`. `GetAsync(userId, ...)`
  (lines 552-570) is a plain cached-free GET at `{Endpoint}/{userId}`. `LockAsync` and `UnlockAsync`
  (lines 573-578) both delegate to the private `PostLockChangeAsync(userId, action, ...)` (lines
  611-634) with `"lock"` or `"unlock"` as the action segment. `SetRoleAsync(userId, role, ...)` (lines
  581-585) wraps the single role in a one-element array and calls `SetRolesAsync`, the concrete
  implementation of the convenience member [IUserAdminActionsUIService](#iuseradminactionsuiservice)
  declares. `SetRolesAsync(userId, roles, ...)` (lines 588-609) PUTs
  [SetUserRolesRequest](group-08-auth.md#setuserrolesrequest) to `{Endpoint}/{userId}/roles`.
  `PostLockChangeAsync` (lines 611-634) POSTs to `{Endpoint}/{userId}/{action}` with **no retry**: the
  comment (lines 623-625) states the reasoning directly, the endpoint is declared non-idempotent, so a
  retried POST is a second request rather than a replayed response, even though both lock and unlock are
  idempotent in the domain, because the client should not make that call on the endpoint's behalf.
- **Why it's built this way**: matches the executor-outside/retry-middle/reader-innermost composition
  every other service in this package uses, generic over `TUserDto` so ADC and Store each supply their
  own admin-grid row shape without a second copy of the HTTP plumbing. The deliberate absence of retry on
  the two POST actions is the one place this service diverges from the pattern, and it is a documented
  choice rather than an oversight.
- **Where it's used**: registered against [IUserAdminUIService<TUserDto>](#iuseradminuiservicetuserdto)
  by [DependencyInjection](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs`); consumed by ADC's
  `UserDetail.razor.cs`.

### NotificationBell

> MMCA.Common.UI · `MMCA.Common.UI.Components.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:30` · Level 6 · class (partial, component)

- **What it is**: the code-behind for the app-bar notification bell. It renders an unread badge from the scoped [NotificationState](#notificationstate), and exactly one instance at a time holds the single active-poller slot, so a bell placed in two layout slots never doubles the API traffic.
- **Depends on**: first-party: [NotificationState](#notificationstate) (badge value, change and refresh events, staleness clock, and the poller slot), [INotificationInboxUIService](#inotificationinboxuiservice) (the unread-count call), [NotificationBellOptions](#notificationbelloptions) (the two intervals), [NotificationRoutePaths](#notificationroutepaths) (the inbox route), [ComponentLifetimeExtensions](#componentlifetimeextensions) (the `LifetimeToken()` read of the component's token source), and [SharedResource](#sharedresource) (the resx anchor for the injected localizer). Externals: `Microsoft.AspNetCore.Components` (`[Inject]`, `NavigationManager`, `LocationChangedEventArgs`, `OnAfterRenderAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Options` (`IOptions<T>`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `TimeProvider`, `PeriodicTimer`, `CancellationTokenSource`, `IDisposable`.
- **Concept introduced, a poller slot with symmetric registration and handover.** `[Rubric §19, State Management & Data Flow]` assesses how shared UI state is coordinated. The bell is a component, so a responsive layout can legitimately render it twice at once (desktop app bar and mobile drawer). Without coordination each copy would start its own timer and its own navigation refresh, doubling the unread-count endpoint's load for no user benefit. The design is a *slot* held by an owner object, not a bare counter: `State.TryRegisterPoller(this)` (line 55) takes the slot only when it is free or already this instance's (`NotificationState.cs:111-124`), and `State.UnregisterPoller(this)` releases it only when this instance actually holds it and then raises `OnPollerSlotFreed` (`NotificationState.cs:133-149`).
  - **Why owner identity matters here.** The class remarks (lines 22-29) name the real scenario: hosts render the bell inside `<AuthorizeView>`, which tears the children down and rebuilds them on every authentication-state change, including a routine access-token refresh. Registration is therefore strictly symmetric (every instance unregisters on dispose, whether or not it was polling, line 267), and the surviving instance claims the freed slot through `OnPollerSlotFreed` (subscribed at line 52), so the circuit never ends up with a badge that nobody refreshes.
  - `[Rubric §23, Front-End Performance]` assesses avoidable network work. Three mechanisms cut it. The slot removes an entire duplicate polling stream in dual-placement layouts, and it owns **every** refresh trigger, not just the timer: the push-refresh subscription `State.OnRefreshRequested += HandleRefreshRequested` is made inside `BecomeActivePollerAsync` (line 80), next to the navigation hook, because subscribing every bell made each push read the API once per placement (comment, lines 77-79); a takeover runs that method again, so the surviving bell picks the subscription up with the slot. And the navigation trigger is throttled by staleness rather than firing per click: `OnLocationChanged` reads only when `State.IsStale(Options.Value.NavigationRefreshMaxAge)` (line 166), because navigation is an ambient trigger, not evidence that the count moved (doc, lines 154-159). The defaults are 30 seconds for both the poll interval and the navigation max age (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/NotificationBellOptions.cs:23,30`), and both are configuration, not constants. A zero or negative `PollInterval` switches the periodic backstop off entirely (lines 96-99) while push and navigation refresh keep working; the comment (lines 94-95) records that `PeriodicTimer` rejects such a period and throwing there faulted the circuit.
  - **The staleness policy has exactly three tiers, and they are deliberate.** The first read and every periodic tick are unconditional; a navigation reads only past the configured window; a real-time push calls `State.MarkStale()` first and then reads regardless (lines 182-186), because the server has just said the data changed, so the age of the number carries no information any more (doc, lines 177-179). That is the one path that must never be throttled.
  - `[Rubric §14, Testability]` assesses whether time-dependent behavior can be driven deterministically. Both the timer and the age comparison run off the injected `TimeProvider Clock` (line 37), and the `PeriodicTimer` is constructed with the `TimeProvider` overload (line 103) precisely so a test drives the loop instead of waiting out a real interval (comment, lines 101-102).
  - `[Rubric §21, Accessibility]`: the bell button carries an explicit localized `aria-label="@L["Notif.Bell.Aria"]"` in the markup (`NotificationBell.razor:10`), which is what the injected `IStringLocalizer<SharedResource> L` (line 35) is for.
  - **Fire-and-forget from a synchronous event handler.** `HandlePollerSlotFreed` (lines 109-110), `OnLocationChanged` (lines 164-170), and `HandleRefreshRequested` (lines 182-186) are all `EventHandler`-shaped, so they cannot be `async Task`. Rather than `async void` (which turns an unobserved exception into a process crash, VSTHRD100, per the comments at lines 107-108 and 160-163), they discard the task with `_ =` and rely on the callee observing its own failures.
- **Walkthrough**
  - Injected members (lines 32-37): `State`, `InboxService`, `NavigationManager`, `L`, `IOptions<NotificationBellOptions> Options`, and `TimeProvider Clock`. Fields (lines 39-42): a per-component `CancellationTokenSource _cts`, the `PeriodicTimer? _pollTimer`, and the two flags `_isActivePoller` and `_disposed`.
  - `OnAfterRenderAsync(bool firstRender)` (lines 44-59) returns immediately on subsequent renders (lines 46-49), subscribes every instance to two state events, `OnChange` and `OnPollerSlotFreed` (lines 51-52), then tries for the slot and, on success, calls `BecomeActivePollerAsync()` (lines 55-58).
  - `BecomeActivePollerAsync` (lines 67-105) is the double-start-guarded start: it bails on `_disposed || _isActivePoller` (lines 69-72), latches `_isActivePoller`, hooks `LocationChanged` (line 75) and `OnRefreshRequested` (line 80), does the unconditional first read (line 83), then **re-checks `_disposed` after that await** (lines 89-92). The comment (lines 85-88) explains what that guard prevents: `Dispose` may have run during the read, having already disposed the then-null timer and the token source, so starting the loop now would leak a `PeriodicTimer` nothing disposes and fault the discarded task on a disposed `_cts`. It then returns without a timer when `PollInterval <= TimeSpan.Zero` (lines 96-99). Only then does it create the timer from `Options.Value.PollInterval` and the injected clock (line 103) and launch `PollLoopAsync` with an explicit discard (line 104). The method doc (lines 61-66) notes it always runs on the renderer's synchronization context, which is what makes the simple `_isActivePoller` guard sufficient rather than needing an interlocked operation.
  - `TryTakeOverPollingAsync` (lines 116-132) is the handover path: it re-checks the guards and claims the slot (line 118), then marshals the actual start onto this component's renderer with `InvokeAsync(BecomeActivePollerAsync)` (line 125), because the event was raised synchronously from the disposing bell's thread (doc, lines 112-115). If that dispatch hits `ObjectDisposedException` it hands the slot straight back (lines 127-131) so another bell can claim it.
  - `PollLoopAsync` (lines 134-152) awaits `_pollTimer!.WaitForNextTickAsync(_cts.LifetimeToken())` in a loop (line 138) and refreshes each tick. The token comes from [ComponentLifetimeExtensions](#componentlifetimeextensions) (`ComponentLifetimeExtensions.cs:26`), which returns an already-cancelled token instead of throwing once the source is cancelled or disposed, so a late read stops through the normal cancellation path. It still catches `OperationCanceledException` (the expected disposal exit) and `ObjectDisposedException` (disposed between timer creation and the first wait, where reading the token off the disposed source throws rather than cancelling, comment lines 149-150).
  - `RefreshUnreadCountAsync` (lines 188-227) is the one place that touches the network: it bails when `_disposed` (lines 190-193), calls `InboxService.GetUnreadCountAsync(_cts.LifetimeToken())` (line 197), and **returns without touching the badge when the result is a failure** (lines 198-204). That early return is load-bearing: the comment (lines 200-202) records that zeroing the badge on an unknown count is what used to erase a push increment, and that a failed read is silent by design because the bell has no surface to report it on. On success it re-checks `_disposed` and marshals `State.SetUnreadCount(unread)` plus `StateHasChanged()` back onto the renderer with `InvokeAsync` (lines 206-213). Three catch tiers follow (lines 215-226): cancellation, disposal during the async gap, and a bare `catch` for network or deserialization failures where the badge keeps its last value. That catch-all is what makes the discards above safe.
  - `HandleStateChanged` (lines 229-230) discards into `RerenderSafeAsync` (lines 232-247), which re-renders through `InvokeAsync(StateHasChanged)` and tolerates a dispose landing between the event firing and the render dispatch.
  - `NavigateToInbox` (line 249) sends the click to `NotificationRoutePaths.NotificationInbox`.
  - `Dispose(bool disposing)` (lines 251-272) sets `_disposed` first (line 258), unsubscribes all three state events and `LocationChanged` (lines 259-262; removing a handler that a non-poller never added is a no-op), then calls `State.UnregisterPoller(this)` **unconditionally** (line 267). The comment (lines 264-266) states both halves of why that is safe: a bell that claimed the slot but was torn down before it started polling still frees it, and a bell that never held it cannot evict the live poller, because the state object checks owner identity. It then disposes the timer and cancels and disposes the `_cts` (lines 269-271). `Dispose()` (lines 274-278) is the public half with `GC.SuppressFinalize`.
- **Why it's built this way**: a live unread badge is a genuinely useful affordance, but a naive implementation is a request amplifier (one timer and one push read per rendered copy, per circuit) and a fragile one under `<AuthorizeView>` churn. Owner-identity registration plus a freed-slot event keeps the affordance, removes the amplification, and survives the teardown-rebuild cycle that a plain counter would leave stuck. Making both intervals options and both clocks injected turns the polling policy into something a host can tune and a test can drive.
- **Where it's used**: contributed to the shell as an app-bar component by [NotificationUIModule](#notificationuimodule) (`NotificationUIModule.cs:23`); it reads the same [NotificationState](#notificationstate) that [NotificationInbox](#notificationinbox) writes after a mark-read, so the badge stays consistent with the inbox without either component knowing about the other.

### TermsAcceptanceGate

> MMCA.Common.UI · `MMCA.Common.UI.Components.Legal` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Legal/TermsAcceptanceGate.razor.cs:29` · Level 6 · class (partial, component)

- **What it is**: the code-behind for the blocking consent dialog a signed-in user sees when the current terms version is one they have not accepted. It listens to the authentication state, reads the user's standing once per identity, and shows a modal whose only exits are accepting or signing out.
- **Depends on**: first-party: [ILegalAcceptanceUIService](#ilegalacceptanceuiservice) (`GetAsync` and `AcceptAsync`), [IAuthUIService](#iauthuiservice) (`LogoutAsync` for the sign-out exit), [LegalSettings](#legalsettings) (the bound options the dialog body reads), [LegalAcceptanceDTO](group-08-auth.md#legalacceptancedto) (the standing: `CurrentVersion`, `AcceptedVersion`, `IsCurrent`), and [SharedResource](#sharedresource) (the localizer anchor). Externals: `Microsoft.AspNetCore.Components.Authorization` (`AuthenticationStateProvider`), `MudBlazor` (`DialogOptions`, `MaxWidth`), `Microsoft.Extensions.Options`, `Microsoft.Extensions.Localization`, `Microsoft.Extensions.Logging` (`ILogger<T>`), `System.Security.Claims` (`ClaimsPrincipal`), BCL `CancellationTokenSource`, `IDisposable`.
- **Concept introduced, a gate that cannot be dismissed by the framework and re-asks only when the identity or the version changes.** `[Rubric §19, State Management & Data Flow]` assesses how per-user UI state is coordinated across navigation and authentication changes. Three pieces of state keep this honest, all private fields (lines 47-55): the cached `_standing`, the `_checkedUserKey` it belongs to, and the `_visible` flag.
  - **Not dismissible, on purpose.** `DialogOptions` (lines 37-45) turns off `BackdropClick`, `CloseOnEscapeKey`, `CloseOnNavigation` and `CloseButton`. The summary (lines 31-36) records the real failure behind `CloseOnNavigation = false`: the dialog provider dismisses every open dialog on `LocationChanged`, and a list page rewrites its own URL (page, sort, filter) right after loading, which closed the gate for the rest of the session while consent was still owed.
  - **Identity-keyed evaluation.** `UserKey` (lines 134-135) is the user-id claim, else the identity name, else empty. `EvaluateAsync` (lines 137-184) returns early when the key equals `_checkedUserKey` (lines 147-151), so a token refresh that re-raises the authentication event does not re-read the standing; only a change of key (sign-in, account switch) does. An unauthenticated principal clears the key and hides the dialog (lines 139-145).
  - **Stale-response guard.** After the awaited read, the method compares the key again and drops the result if the user changed while it was in flight (lines 165-169), because the newer evaluation owns the outcome. The dialog shows only when the read succeeded and `CurrentVersion` is non-null and `IsCurrent` is false (line 171); any failed read hides it, so a transport fault never locks a user out of the app.
  - `[Rubric §15, Best Practices and Code Quality]` assesses precedent reuse: the discarded-task event handler and its exhaustive catch follow the `BiometricGate` precedent named in the comments (lines 247-248, 268-269), see [BiometricGate](#biometricgate).
- **Walkthrough**
  - Injected members (lines 57-76): `AuthStateProvider`, `LegalAcceptance`, `AuthService`, `Navigation`, `LegalOptions`, `L`, and `Logger`. `Heading` (lines 81-83) picks the "first" title when `AcceptedVersion` is null and the "updated" title when the user accepted an earlier version.
  - `OnAfterRenderAsync(bool firstRender)` (lines 93-105) returns on later renders, subscribes to `AuthenticationStateChanged` (line 100), sets `_subscribed`, then evaluates the current principal (lines 103-104).
  - `AcceptAsync` (lines 186-230) requires a version, the agreement checkbox, and `!_busy` (lines 188-192). On success it hides the dialog (lines 199-203). If the server refuses with `LegalAcceptanceErrorCodes.VersionNotCurrent`, the version moved while the dialog was open, so it clears the cached key and re-evaluates (lines 207-213), showing the version that is current now instead of retrying a stale one. Any other failure sets the error text: a validation refusal uses the server-phrased message, everything else (transport fault, timeout, server error) uses the gate's own localized `Legal.Gate.AcceptFailed` (lines 218-220, comment lines 215-217). Cancellation is swallowed (lines 222-225) and `_busy` is cleared in `finally`.
  - `SignOutAsync` (lines 232-237) sets `_busy`, calls `AuthService.LogoutAsync()` (line 235), and navigates to `/login` with `forceLoad: true` (line 236) so the circuit and its state are discarded.
  - `OnAuthenticationStateChanged` (line 249) discards into `ReevaluateAsync` (lines 251-272), which awaits the new state, marshals `EvaluateAsync` through `InvokeAsync`, and catches `ObjectDisposedException`, `InvalidOperationException`, and finally a bare `Exception` that is logged (lines 266-270); the last tier exists because the event handler discards the task, so nothing else would observe a fault.
  - `Dispose(bool)` (lines 109-128) unsubscribes only if subscribed, cancels `_disposalCts` once, and disposes it; the token source is passed to both service calls (lines 158, 198), so teardown mid-request ends through the cancellation path.
- **Why it's built this way**: consent is owed, so the gate must survive everything that normally closes a dialog (navigation, Escape, backdrop) and must not nag when nothing changed (token refresh) or when it cannot know (failed read). Keying the cache on identity and re-reading on a version-conflict code keeps it correct across account switches and mid-dialog version bumps. See [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) for the identity-completions context.
- **Where it's used**: contributed as a layout component by the ADC `IdentityUIModule` (`LayoutComponentTypes = [typeof(TermsAcceptanceGate)]`, `MMCA.ADC.Identity.UI/IdentityUIModule.cs:40`); the client it calls, [ILegalAcceptanceUIService](#ilegalacceptanceuiservice), is registered for every host (`MMCA.Common.UI/DependencyInjection.cs:168`).

### DependencyInjection

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:20` · Level 14 · class (static)

- **What it is**: the registration extensions for the server-side Blazor Web host pieces this package ships: four `IServiceCollection` methods a host calls from `Program.cs` instead of registering app-local copies of the token store (which now also forwards the visitor's origin on server-side API calls), the CSP provider (now including its options and their startup validation), the form factor, and the trusted-caller rate-limit exemption.
- **Depends on**: first-party: [ServerTokenStorageService](#servertokenstorageservice) + [ITokenStorageService](#itokenstorageservice), [BrowserOriginHandler](#browseroriginhandler) (the `"APIClient"` message handler), [BlazorCspPolicyProvider](#blazorcsppolicyprovider) + [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider), [BlazorCspSettings](#blazorcspsettings) (the bound `"BlazorCsp"` options) + [BlazorCspSettingsValidator](#blazorcspsettingsvalidator) (its `IValidateOptions<BlazorCspSettings>`), [WebFormFactor](group-26-device-capability-layer.md#webformfactor) + [IFormFactor](group-26-device-capability-layer.md#iformfactor), [TrustedCallerHandler](#trustedcallerhandler) (the delegating handler `AddTrustedCallerHeader` composes), [GatewayRateLimitingSettings](group-16-aspire-orchestration.md#gatewayratelimitingsettings) (the shared configuration section for both ends) and [ApiSettings](#apisettings) (the server-side endpoint the origin gate is built from). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`, `AddHttpContextAccessor`, `ConfigureAll<HttpClientFactoryOptions>`), `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAddEnumerable`), `Microsoft.Extensions.Options` (`AddOptions`, `BindConfiguration`, `ValidateOnStart`), `Microsoft.Extensions.Configuration` (`IConfiguration`).
- **Concept**: the same `extension(IServiceCollection services)` block idiom used package-wide (line 22, see [primer](00-primer.md#c-extensiont-types-read-this-once)). What is worth studying here is that the XML docs carry **operational rules the compiler cannot enforce**, and they are the only place those rules are written down next to the code.
  - `[Rubric §15, Best Practices and Code Quality]` assesses idiom consistency; every `MMCA.Common.*` package registers services through the same extension shape, so a reader who has seen one registrar has seen them all.
  - `[Rubric §26, Front-End Security]` assesses browser hardening wiring; `AddCommonBlazorCsp()` is what actually puts [BlazorCspPolicyProvider](#blazorcsppolicyprovider) in front of the default static provider, and its doc (lines 56-58) encodes the ordering rule: call it **before** `AddCommonSecurityHeaders`, because the default is registered with `TryAdd` and would otherwise win.
  - `[Rubric §22, Configuration and Secrets Management]` assesses whether a bad configuration value is caught before it can silently degrade a live host; `ValidateOnStart()` (line 71) is what turns a bad `BlazorCsp:FrameSources` entry into a boot failure instead of a policy that quietly omits the frame source.
  - `[Rubric §19, Rate Limiting and Throttling]` assesses whether a legitimate internal caller can be told apart from the anonymous crowd it is partitioned with; `AddTrustedCallerHeader` is that opt-in exemption for this host's own server-to-server calls.
- **Walkthrough**
  - `AddCommonServerTokenStorage()` (lines 41-51): calls `services.AddHttpContextAccessor()` (line 43), the accessor [ServerTokenStorageService](#servertokenstorageservice) needs to tell SSR from circuit. It then registers [BrowserOriginHandler](#browseroriginhandler) as a transient and appends it to the named `"APIClient"` client with `AddHttpClient("APIClient").AddHttpMessageHandler<BrowserOriginHandler>()` (lines 47-48). The doc (lines 33-40) says each server-side request then carries `X-Forwarded-For` set to the remote IP and `User-Agent` set to the browser's user-agent of the HTTP request behind the render (the page request during prerender, the circuit's connection afterwards), so per-client limits such as the registration rate limit key on the visitor rather than on this host, and a sign-in records the visitor's device; nothing is sent when no request is in scope. The comment (lines 45-46) notes a second `AddHttpClient` with the same name appends to the client registered by `AddUIShared`, whichever runs first. Finally it registers [ServerTokenStorageService](#servertokenstorageservice) as the **scoped** [ITokenStorageService](#itokenstorageservice) (line 50). Scoped is the right lifetime: a circuit is a DI scope, so the in-memory access token is per-session state. The doc (lines 24-31) names the two companions this registration assumes, `AddServerAuthSessionCookie` and `UseCookieSessionRefresh` from `MMCA.Common.API`, plus a registered [ITokenRefresher](#itokenrefresher).
  - `AddCommonBlazorCsp()` (lines 67-78) now does three things, not one. It binds [BlazorCspSettings](#blazorcspsettings) from the `"BlazorCsp"` configuration section and calls `ValidateOnStart()` (lines 69-71); it registers [BlazorCspSettingsValidator](#blazorcspsettingsvalidator) as an `IValidateOptions<BlazorCspSettings>` through `TryAddEnumerable`, so calling this method twice never runs the same validation twice (comment at line 73, registration lines 74-75); and it registers [BlazorCspPolicyProvider](#blazorcsppolicyprovider) as a **singleton** [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (line 77), matching the provider's compute-once constructor. `AddSingleton` (not `TryAdd`) is what makes the replacement deterministic. The doc (lines 60-64) states the configuration contract: `BlazorCsp:FrameSources` lists the https origins the host's pages may frame, emitted as `frame-src 'self' <origins>`; an absent or empty list leaves the policy unchanged, and an invalid entry fails the boot rather than being silently dropped.
  - `AddCommonWebFormFactor()` (lines 85-86): registers [WebFormFactor](group-26-device-capability-layer.md#webformfactor) as a **singleton** [IFormFactor](group-26-device-capability-layer.md#iformfactor), which reports "Web" plus the server OS description; the doc (lines 81-84) notes the WASM client registers `AddWasmFormFactor()` from `MMCA.Common.UI` instead, so the same abstraction resolves differently per host kind.
  - `AddTrustedCallerHeader(IConfiguration configuration)` (lines 121-159) is opt-in: it reads
    [GatewayRateLimitingSettings](group-16-aspire-orchestration.md#gatewayratelimitingsettings) and, when
    `TrustedCallerSecret` is blank (the local/CI default), or `TrustedCallerHeaderName` is blank, or the
    server-side `ApiSettings.ApiEndpoint` is missing or not an absolute URI, registers nothing at all
    (lines 133-138). The remarks (lines 96-117) give three reasons in full: **opt in**, no secret means
    every call stays rate limited exactly as today, and the gateway must read the *same*
    `GatewayRateLimiting` section so one section configures both ends; **server only**, the secret must
    reach this SSR host alone (`GatewayRateLimiting__TrustedCallerSecret`) and never the WebAssembly
    client or a rendered page; and **why every client**, the cookie-session token-refresh client is
    created under a name a host cannot reach, so the composition targets every `HttpClient` this host
    builds via `services.ConfigureAll<HttpClientFactoryOptions>(...)` (lines 152-156) rather than one
    named client. When it does register, it inserts [TrustedCallerHandler](#trustedcallerhandler) at
    `AdditionalHandlers.Insert(0, ...)` (lines 154-156), not `Add`: the comment (lines 143-151) explains
    that index 0 is the outermost handler, so the origin gate judges the authority the caller configured
    rather than the authority Aspire's service-discovery handler rewrites mid-pipeline, and that ordering
    holds regardless of whether a host calls `AddServiceDefaults` before or after this method.
- **Why it's built this way**: all four pieces are host-level infrastructure that carry no app-specific state, so they were hoisted into `MMCA.Common.UI.Web` and exposed as one-line registrations. Binding and validating [BlazorCspSettings](#blazorcspsettings) inside `AddCommonBlazorCsp()` itself, rather than leaving it to the host, means a host that opts into `frame-src` gets the fail-fast contract for free instead of having to know to add its own `ValidateOnStart()`. `AddTrustedCallerHeader` follows the deployment's gateway rate-limiting policy: a per-client-IP partition that a trusted internal caller would otherwise collapse into, exempted only when the deployment explicitly configures a shared secret. That keeps every consumer's `Program.cs` free of duplicated token-store, CSP, form-factor and rate-limit-exemption wiring, which is the reusable-building-blocks charter of this group. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html) for the session design the first method plugs into, and [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.md) for the fail-fast-on-boot posture `ValidateOnStart()` follows.
- **Where it's used**: called from the `Program.cs` of the server-interactive Blazor Web hosts in the consumer apps (MMCA.ADC, MMCA.Store).
- **Caveats / not-in-source**: the doc comment and the provider's fail-closed `connect-src 'self'` fallback now agree (`BlazorCspPolicyProvider.cs:60-62`); which host binds a `BlazorCsp:FrameSources` list, if any, is not visible from this file.


---
[⬅ Module System, Composition & Configuration](group-14-module-system-composition.md)  •  [Index](00-index.md)  •  [Aspire Orchestration & Service Defaults ➡](group-16-aspire-orchestration.md)
