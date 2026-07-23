# ADR-051: Client-Side Authentication Token Lifecycle Across Render Modes

## Status
Accepted (2026-07-23).

## Context
ADR-022 and ADR-050 describe the two server halves of authentication: the Blazor host's
HttpOnly session cookie that survives SSR prerender (ADR-022), and the Identity service's single
rotating refresh token with reuse detection (ADR-050). Neither covers the client half: how a Blazor
or MAUI head actually holds an access token, attaches it to API calls, and reacquires one when it
nears expiry.

The awkward part is that the same UI code runs under three different render heads with three
different safe-storage stories:

- **Blazor Server** (interactive circuit): no direct DOM access from the server, JS interop is
  available only once the circuit is live, and during SSR prerender there is no circuit at all,
  only an `HttpContext`.
- **Blazor WebAssembly**: runs in the browser with a DOM and an XSS surface, so persisting a refresh
  token where JS can read it (localStorage) is unsafe.
- **MAUI** (Blazor Hybrid WebView): a native process with OS-backed secure storage and no
  cross-origin browser cookie jar to lean on.

A single access token acquisition path cannot serve all three: the browser heads must keep the
refresh token out of JS reach, while MAUI has no same-origin UI host to proxy a refresh through and
must talk to the API cross-origin. We wanted the application-facing surface (how a page reads auth
state, how an outgoing API request gets its bearer token) to be identical across heads, with the
head-specific storage and refresh mechanics hidden behind narrow abstractions.

## Decision
Model the client token lifecycle as two small abstractions (`ITokenStorageService` for persistence,
`ITokenRefresher` for reacquisition) plus a shared bearer-attaching handler and a shared JWT-driven
auth-state provider. Each head registers the implementation that matches its safe-storage story; the
UI code above them never branches on render mode.

- **`ITokenRefresher` abstracts reacquisition, one implementation per head family.** The interface
  exposes a single `AcquireAccessTokenAsync` that returns a fresh access token or `null` when no
  valid session exists
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13`,
  `ITokenRefresher.cs:20`). Where the refresh token lives and how rotation happens are internal to
  the implementation.
- **Browser heads refresh through the same-origin proxy.** `SameOriginProxyTokenRefresher` (used by
  both Blazor Server and WASM) invokes `mmcaAuthSession.getToken` over JS interop
  (`SameOriginProxyTokenRefresher.cs:11`, `SameOriginProxyTokenRefresher.cs:17`), which issues a
  `POST /auth/session/token` with `credentials:'same-origin'` so the browser sends its HttpOnly auth
  cookies and the UI host validates-or-refreshes server-side, returning only the access token
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/mmca-auth-cookie.js:35`). The refresh
  token never reaches JS. When interop is unavailable (SSR prerender, disconnected circuit) it
  returns `null` rather than throwing (`SameOriginProxyTokenRefresher.cs:20`).
- **MAUI refreshes directly against the API.** `DirectApiTokenRefresher` reads the stored access and
  refresh tokens from OS SecureStorage (via `ITokenStorageService`), posts them to the API's
  cross-origin `auth/refresh` endpoint, and persists the rotated pair back
  (`DirectApiTokenRefresher.cs:11`, `DirectApiTokenRefresher.cs:19-20`, `DirectApiTokenRefresher.cs:29`,
  `DirectApiTokenRefresher.cs:42`). This head has no browser DOM (and thus no XSS surface), so direct
  token handling is acceptable.
- **`ITokenStorageService` abstracts persistence, one implementation per head.** The interface holds
  access-token and refresh-token get/set/clear
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenStorageService.cs:8`). The two
  browser implementations keep the access token **in memory only** and never expose a refresh token:
  `WasmTokenStorageService` (in MMCA.Common.UI) hydrates the in-memory token on demand from the cookie
  and returns `null` for the refresh token (`WasmTokenStorageService.cs:11`, `WasmTokenStorageService.cs:17`,
  `WasmTokenStorageService.cs:40`); `ServerTokenStorageService` (in MMCA.Common.UI.Web) reads the
  HttpOnly cookie during SSR prerender when an `HttpContext` is present and holds an in-memory token on
  the interactive circuit otherwise
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`,
  `ServerTokenStorageService.cs:32-35`, `ServerTokenStorageService.cs:38-52`). The MAUI implementation
  is app-local and backs onto `SecureStorage.Default` (platform secure enclaves)
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiTokenStorageService.cs:9`,
  `MauiTokenStorageService.cs:16`, `MauiTokenStorageService.cs:28`; Store registers its own equivalent
  at `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:76`).
- **Login seeds the browser HttpOnly cookie through a JS fetch.** `SetTokensAsync` on both browser
  storage services caches the access token in memory and calls `ISessionCookieSync.SyncAsync`, which
  fires a browser fetch to `/auth/session-cookie` so the resulting `Set-Cookie` lands in the user's
  cookie jar in both Server interactive mode and WASM
  (`WasmTokenStorageService.cs:42-48`, `ISessionCookieSync.cs:8`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11`,
  `JsFetchSessionCookieSync.cs:20`, `mmca-auth-cookie.js:5`). The refresh token transits JS only for
  that single same-origin POST and is never persisted in localStorage. The sync is registered via
  `AddClientAuthSessionCookieSync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:105-109`).
- **Every outgoing API request is bearer-stamped by one handler.** `AuthDelegatingHandler` reads the
  current access token from `ITokenStorageService` and attaches it as a `Bearer` authorization header
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9`,
  `AuthDelegatingHandler.cs:17-20`). It is registered into the shared named `"APIClient"` HttpClient
  pipeline via `AddHttpMessageHandler` (`DependencyInjection.cs:57`, `DependencyInjection.cs:61`,
  `DependencyInjection.cs:73`), so the handler is head-agnostic: it depends only on the storage
  abstraction, which supplies the correctly-hydrated token per head.
- **Blazor auth state is derived from the JWT client-side.** `JwtAuthenticationStateProvider` reads
  the stored access token, parses and expiry-checks it without server validation, and builds an
  authenticated `ClaimsPrincipal` from the token's claims, falling back to anonymous on any failure
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:12`,
  `JwtAuthenticationStateProvider.cs:32-47`, `JwtAuthenticationStateProvider.cs:49-52`). Client-side
  parsing keeps the UI responsive (`AuthorizeView` reacts immediately after login or logout via
  `NotifyUserAuthentication` / `NotifyUserLogout`, `JwtAuthenticationStateProvider.cs:59`,
  `JwtAuthenticationStateProvider.cs:71`); the WebAPI still performs full token validation on every
  request.
- **Concurrent callers share one refresh.** Both browser storage services proactively reacquire when
  the in-memory token is within a 30-second expiry skew and collapse concurrent acquisitions
  (delegating handler, auth-state provider, SignalR) onto a single in-flight hydration
  (`WasmTokenStorageService.cs:15`, `WasmTokenStorageService.cs:28-37`, `ServerTokenStorageService.cs:23`,
  `ServerTokenStorageService.cs:44`).
- **Each head wires its own trio in Program.cs.** The WASM client registers `WasmTokenStorageService`
  + `SameOriginProxyTokenRefresher` + `JwtAuthenticationStateProvider`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:44-46`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:46-48`); the Blazor Server host
  registers `ServerTokenStorageService` via `AddCommonServerTokenStorage`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:26-29`) plus the same
  proxy refresher and auth-state provider
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:91-92`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:64-65`); the MAUI host registers its
  SecureStorage-backed storage + `DirectApiTokenRefresher` + `JwtAuthenticationStateProvider`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:98-100`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:76-78`).

## Rationale
- **One application surface, three storage stories.** Pages, services, and the HTTP pipeline talk to
  `ITokenStorageService` and `AuthenticationStateProvider` only; the head-specific choice of HttpOnly
  cookie versus SecureStorage lives entirely behind the two abstractions and the Program.cs
  registration, so UI code never branches on render mode.
- **Keep the refresh token off the highest-risk surface.** The browser heads are the ones with an XSS
  attack surface, so their refresh token stays in an HttpOnly cookie and rotation happens server-side
  through the same-origin proxy; the access token there is memory-only and short-lived. MAUI, with no
  DOM, can safely hold both tokens in the OS secure enclave.
- **Reuse the ADR-022 cookie plumbing rather than duplicate it.** The browser refresher is a thin JS
  interop call onto the same `/auth/session/token` and `/auth/session-cookie` endpoints ADR-022
  already stands up, so this decision adds the client lifecycle without a second server mechanism.
- **Single-flight refresh avoids a token stampede.** On a heavily-concurrent page (delegating handler,
  auth-state, SignalR all asking at once) the shared in-flight hydration means one network round-trip,
  not several racing refreshes.

## Trade-offs
- **The browser heads depend on the same-origin UI host.** `SameOriginProxyTokenRefresher` only works
  where the UI host serves the `/auth/session/*` endpoints; a browser head deployed without that
  plumbing (ADR-022) cannot refresh. MAUI has no such dependency but pays for it with cross-origin
  direct token handling.
- **Client-side JWT parsing is advisory, not authoritative.** `JwtAuthenticationStateProvider` trusts
  the token's shape and expiry for UI responsiveness and does no signature validation; the security
  boundary is the WebAPI, which validates every request. A tampered local token can flip an
  `AuthorizeView` but cannot pass an API call.
- **MAUI token storage is app-local, not framework-shared.** The two browser storage services are
  hoisted into MMCA.Common.UI / MMCA.Common.UI.Web, but the SecureStorage-backed MAUI implementation
  is duplicated per app (ADC and Store each own a copy), because it depends on the MAUI
  `SecureStorage` API (ADR-042). Behavior can drift between the two apps.
- **The split multiplies the paths to keep correct.** Three storage implementations plus two
  refreshers plus the cookie-sync means the same login/refresh/logout invariant is expressed in
  several places; each head's registration trio must stay consistent or a head silently loses auth.

## Related
ADR-022 (the Blazor host's HttpOnly session cookie and the `/auth/session/*` endpoints the browser
refresher proxies through), ADR-050 (the single rotating refresh token with reuse detection that the
`auth/refresh` endpoint enforces and that this client lifecycle acquires against), ADR-042 (the
device-capability abstraction and the MAUI head whose SecureStorage backs `DirectApiTokenRefresher`
and the app-local MAUI token storage).
