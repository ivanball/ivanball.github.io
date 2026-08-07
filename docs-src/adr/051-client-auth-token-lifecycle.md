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
  and returns `null` for the refresh token (`WasmTokenStorageService.cs:11`, `WasmTokenStorageService.cs:22`,
  `WasmTokenStorageService.cs:59`); `ServerTokenStorageService` (in MMCA.Common.UI.Web) reads the
  HttpOnly cookie during SSR prerender when an `HttpContext` is present and holds an in-memory token on
  the interactive circuit otherwise
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`,
  `ServerTokenStorageService.cs:32-35`, `ServerTokenStorageService.cs:38-52`). The MAUI implementation
  is framework-shared too and backs onto `SecureStorage.Default` (platform secure enclaves), guarding
  every read and write so an OS-invalidated keystore entry degrades to one clean re-login instead of an
  unhandled throw on launch
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:20`,
  `MauiTokenStorageService.cs:66-82`, `MauiTokenStorageService.cs:88-101`,
  `MauiTokenStorageService.cs:104-117`); both MAUI heads register that one class through
  `AddCommonMauiTokenStorage`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:73`).
- **Login seeds the browser HttpOnly cookie through a JS fetch.** `SetTokensAsync` on both browser
  storage services caches the access token in memory and calls `ISessionCookieSync.SyncAsync`, which
  fires a browser fetch to `/auth/session-cookie` so the resulting `Set-Cookie` lands in the user's
  cookie jar in both Server interactive mode and WASM
  (`WasmTokenStorageService.cs:61-67`, `ISessionCookieSync.cs:8`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11`,
  `JsFetchSessionCookieSync.cs:20`, `mmca-auth-cookie.js:5`). The refresh token transits JS only for
  that single same-origin POST and is never persisted in localStorage. The sync is registered via
  `AddClientAuthSessionCookieSync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:119`).
- **Every outgoing API request is bearer-stamped by one handler.** `AuthDelegatingHandler` reads the
  current access token from `ITokenStorageService` and attaches it as a `Bearer` authorization header
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9`,
  `AuthDelegatingHandler.cs:17-20`). It is registered into the shared named `"APIClient"` HttpClient
  pipeline via `AddHttpMessageHandler` (`DependencyInjection.cs:59`, `DependencyInjection.cs:63`,
  `DependencyInjection.cs:81`), so the handler is head-agnostic: it depends only on the storage
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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:52-54`); the Blazor Server host
  registers `ServerTokenStorageService` via `AddCommonServerTokenStorage`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:26-29`) plus the same
  proxy refresher and auth-state provider
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:97-98`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:65-66`); the MAUI host registers the shared
  SecureStorage-backed storage via `AddCommonMauiTokenStorage` plus `DirectApiTokenRefresher` +
  `JwtAuthenticationStateProvider`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:103-105`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:88-90`).

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
- **MAUI storage is shared, but only from a MAUI-TFM package.** All three storage services are
  framework-owned now, yet the SecureStorage-backed one depends on the MAUI `SecureStorage` API, so it
  cannot sit beside its siblings in MMCA.Common.UI: it lives in `MMCA.Common.UI.Maui`, which is
  deliberately outside `MMCA.Common.slnx` (the solution lists `MMCA.Common.UI` and
  `MMCA.Common.UI.Web` only, `MMCA.Common/MMCA.Common.slnx:17-18`) and is built across its four TFMs
  by a separate windows-only CI job (`MMCA.Common/.github/workflows/ci.yml:161`,
  `ci.yml:221`; ADR-042). A change to the MAUI storage is therefore verified on a different, slower
  path than the browser ones.
- **The split multiplies the paths to keep correct.** Three storage implementations plus two
  refreshers plus the cookie-sync means the same login/refresh/logout invariant is expressed in
  several places; each head's registration trio must stay consistent or a head silently loses auth.

## Related
ADR-022 (the Blazor host's HttpOnly session cookie and the `/auth/session/*` endpoints the browser
refresher proxies through), ADR-050 (the single rotating refresh token with reuse detection that the
`auth/refresh` endpoint enforces and that this client lifecycle acquires against), ADR-042 (the
device-capability abstraction and the MAUI head whose SecureStorage backs `DirectApiTokenRefresher`
and the shared `MauiTokenStorageService` in the MAUI-TFM package).

## Revision (2026-08-07)
The MAUI half of `ITokenStorageService` is no longer app-local. The original Decision left the
SecureStorage-backed implementation in each app because it depends on the MAUI `SecureStorage` API;
it has since been hoisted into the framework's MAUI-TFM package, so all three storage
implementations are now framework-owned.

1. **One class, in MMCA.Common.UI.Maui.** `MauiTokenStorageService` is a single sealed
   `ITokenStorageService` holding both tokens under the `auth_access_token` / `auth_refresh_token`
   keys in `SecureStorage.Default`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:20`,
   `MauiTokenStorageService.cs:22-23`). The per-app copies are gone: no
   `MauiTokenStorageService.cs` exists under `MMCA.ADC/Source/` or `MMCA.Store/Source/` (the only
   match in the workspace is the framework file above), so the "behavior can drift between the two
   apps" risk the Trade-offs section recorded no longer applies.
2. **Both heads register it through one extension method.** `AddCommonMauiTokenStorage()` registers
   it as the scoped `ITokenStorageService`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:73-74`), and both
   MAUI hosts call exactly that (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:103`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:88`). Scoped, not singleton, to match the
   two browser siblings so component code depends on one lifetime on every head
   (`DependencyInjection.cs:70-71`). The rest of each MAUI trio is unchanged:
   `DirectApiTokenRefresher` + `JwtAuthenticationStateProvider` still follow it
   (`MauiProgram.cs:104-105` in ADC, `MauiProgram.cs:89-90` in Store).
3. **The hoist added failure handling the app copies did not have.** Every read and write is guarded,
   because the OS invalidates keystore entries on its own schedule and the raw API then throws rather
   than returning nothing: a failed read drops the unreadable entry and degrades to "no token stored"
   (`MauiTokenStorageService.cs:66-82`), a failed write retries once against a freshly removed key and
   otherwise propagates (`MauiTokenStorageService.cs:88-101`), `ClearTokensAsync` is best-effort so
   logout always succeeds (`MauiTokenStorageService.cs:53-60`, `:104-117`), and `SetTokensAsync`
   writes the refresh token first and drops both on a failed access-token write rather than leaving a
   mismatched pair (`MauiTokenStorageService.cs:32-50`).
4. **What it cost.** The class cannot live in `MMCA.Common.UI` (that package must stay
   Blazor-WASM-compatible and MAUI-free), so it sits in `MMCA.Common.UI.Maui`, outside
   `MMCA.Common.slnx` and built across its four TFMs by a windows-only CI job (ADR-042). The
   Trade-offs bullet above is rewritten accordingly: the risk is no longer divergent copies, it is a
   slower and separate verification path for the one shared copy.
