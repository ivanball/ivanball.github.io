# ADR-051: Client-Side Authentication Token Lifecycle Across Render Modes

## Status
Accepted (2026-07-23). Revised 2026-08-07 (the SecureStorage-backed MAUI storage is hoisted from
the apps into the framework's MAUI-TFM package). Revised 2026-08-14 (`SetTokensAsync` writes the
refresh token and the access token under one shared guard, so a failed refresh-token write also drops
both tokens). Revised 2026-08-31 (MAUI storage splits into a freshness layer over a raw
`ISecureTokenStore`, and all three storage services carry the 30-second expiry check plus
single-flight refresh). Revised 2026-10-01 (citations re-anchored; the `SkipBearer` exemption and the
browser `SetTokensAsync` throw on a failed cookie write recorded). Revised 2026-10-06: the browser
refresher reports a three-way `TokenAcquisition`, the browser storage services hold a 15-second
anonymous grace, the MAUI single-flight is process-wide, and the bearer handler leaves an existing
`Authorization` header alone. Revised 2026-10-07: on the same-origin API proxy hosts (both
consumers) the Blazor Server circuit refreshes and seeds cookies through a protected handoff, the
browser receives only a claims-only token, and the proxy strips and re-stamps the bearer; the MAUI
refresher treats a 409 as transient and keeps the stored pair. See the Revisions below. Revised
2026-10-21: the MAUI refresher reports no session only for a refused token (400, 401 or 403), no
stored pair or an empty access token (other failures are unavailable), the Server storage is
recorded as seeing a non-null `HttpContext` on the circuit and telling it from the prerender by a
hub-connection request and by memory authority, both browser storage services discard a hydrate
overtaken by a login or logout, and the bearer handler marks replay safety on a transport failure;
anchors refreshed. Revised 2026-10-26: both browser storage services raise `SessionEnded`
(`ISessionAwareTokenStorage`) when a held session ends on the server and the auth-state provider
signs the shell out on it (no MAUI equivalent), the WASM clients pre-hydrate the token through
`TokenHydrationWarmup`, and Decision anchors are refreshed. Revised 2026-10-28: anchors refreshed
after the 2026-10-27 ADC and Store Server host `Program.cs` changes.

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
Model the client token lifecycle as three small abstractions (`ITokenStorageService`, the
freshness-checked persistence every caller consumes; `ISecureTokenStore`, raw persistence for the one
head that persists tokens itself; `ITokenRefresher` for reacquisition) plus a shared bearer-attaching
handler and a shared JWT-driven auth-state provider. Each head registers the implementations that
match its safe-storage story; the UI code above them never branches on render mode.

- **`ITokenRefresher` abstracts reacquisition, one implementation per head family.** The interface
  exposes a single `AcquireAccessTokenAsync` that returns a fresh access token or `null` when no
  valid session exists
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ITokenRefresher.cs:17`,
  `ITokenRefresher.cs:24`). Where the refresh token lives and how rotation happens are internal to
  the implementation.
- **Browser heads refresh through the same-origin proxy.** `SameOriginProxyTokenRefresher` (the WASM
  client's refresher, and the Blazor Server default until the same-origin API proxy replaces it on
  the circuit, below) invokes `mmcaAuthSession.getToken` over JS interop
  (`SameOriginProxyTokenRefresher.cs:16`, `SameOriginProxyTokenRefresher.cs:27`), which issues a
  `POST /auth/session/token` with `credentials:'same-origin'` so the browser sends its HttpOnly auth
  cookies and the UI host validates-or-refreshes server-side, returning a browser token (the access
  token by default; a claims-only copy on a same-origin API proxy host, below)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/mmca-auth-cookie.js:47-63`). The refresh
  token never reaches JS. The script answers `null` only for the endpoint's 401 and throws on any
  other non-OK status (`mmca-auth-cookie.js:54-59`). The refresher also implements
  `ISessionAwareTokenRefresher`, whose `TryAcquireAccessTokenAsync` returns a three-way
  `TokenAcquisition`: acquired, no session (a blank token), or unavailable when interop is missing
  (SSR prerender, disconnected circuit), the call is cancelled, or the endpoint fails transiently
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISessionAwareTokenRefresher.cs:12`,
  `TokenAcquisition.cs:9`, `SameOriginProxyTokenRefresher.cs:23-37`). The plain
  `AcquireAccessTokenAsync` collapses that to the token or `null`, so it never throws
  (`SameOriginProxyTokenRefresher.cs:19-20`).
- **On a same-origin API proxy host the browser never holds a credential.** Both consumer Server
  hosts call `AddCommonSameOriginApiProxy` and `MapCommonSameOriginApiProxy`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:168`, `Program.cs:291`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:160`, `Program.cs:269`; ADR-131). That
  call replaces the Server circuit's `ITokenRefresher` with `HandoffTokenRefresher` and its
  `ISessionCookieSync` with `HandoffSessionCookieSync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:83-84`).
  They call `mmcaAuthHandoff.getToken` / `mmcaAuthHandoff.setCookie`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:24`,
  `HandoffSessionServices.cs:58`, `mmca-auth-cookie.js:69-103`) against `/auth/session/handoff` and
  `/auth/session-cookie/handoff` (`SessionHandoffEndpoints.cs:17-18`), so the page carries only
  `SessionHandoffProtector` ciphertext and the circuit opens it server-side; a handoff it cannot open
  is unavailable, not "no session" (`HandoffSessionServices.cs:32-34`). Boot fails if a later
  registration displaces either replacement (`SameOriginApiProxyEndpointExtensions.cs:64-92`). The
  same call sets `ClaimsOnlyBrowserTokens` (`SameOriginApiProxyServiceExtensions.cs:73`), so the
  WASM client's `/auth/session/token` answers with an unsigned `alg:none` claims copy rather than
  the access token
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:83-86`,
  `SessionClaimsToken.cs:10`, `SessionClaimsToken.cs:17`).
- **MAUI refreshes directly against the API.** `DirectApiTokenRefresher` reads the stored access and
  refresh tokens out of OS SecureStorage through `ISecureTokenStore`, posts them to the API's
  cross-origin `auth/refresh` endpoint, and persists the rotated pair back
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:41-43`,
  `DirectApiTokenRefresher.cs:54-55`, `DirectApiTokenRefresher.cs:62-67`, `DirectApiTokenRefresher.cs:104`).
  It is an `ISessionAwareTokenRefresher` too: a `409 Conflict` (`Auth.RefreshSuperseded`) is
  transient and never clears the stored pair, answering with a newer pair another refresh in this
  process already stored or otherwise unavailable, so a stolen-and-rotated token is caught by the
  server's reuse detection (BR-206) on the next presentation (`DirectApiTokenRefresher.cs:25-33`,
  `DirectApiTokenRefresher.cs:86-89`, `DirectApiTokenRefresher.cs:112-122`). Only a refusal of the
  presented token (400, 401 or 403) is no session; every other non-success status (a 408, a 429, a
  5xx) is unavailable (`DirectApiTokenRefresher.cs:91-96`, rationale at
  `DirectApiTokenRefresher.cs:34-39`), and so are a dropped connection and an `HttpClient` timeout the
  caller did not request (`DirectApiTokenRefresher.cs:74-82`). No session is also the answer when no
  pair is stored (`DirectApiTokenRefresher.cs:57-60`) and when a success body carries an empty access
  token (`DirectApiTokenRefresher.cs:98-102`). MAUI storage hydrates through the collapsing
  `AcquireAccessTokenAsync`, so an unavailable result reaches its callers as a `null` bearer
  (`MauiTokenStorageService.cs:103-104`).
  It takes the raw store rather than `ITokenStorageService` on purpose: every operation it performs is
  a raw read or write, and depending on the freshness-checking storage instead would close the loop and
  let a refresh re-enter the acquisition that started it (`DirectApiTokenRefresher.cs:12-18`). This
  head has no browser DOM (and thus no XSS surface), so direct token handling is acceptable.
- **`ITokenStorageService` abstracts persistence, one implementation per head.** The interface holds
  access-token and refresh-token get/set/clear
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ITokenStorageService.cs:8`). The two
  browser implementations keep the access token **in memory only** and never hand a refresh token to
  JS: `WasmTokenStorageService` (in MMCA.Common.UI) hydrates the
  in-memory token on demand from the cookie and returns `null` for the refresh token unconditionally
  (`WasmTokenStorageService.cs:26`, `WasmTokenStorageService.cs:71-110`, `WasmTokenStorageService.cs:113`);
  `ServerTokenStorageService` (in MMCA.Common.UI.Web) answers from the HttpOnly cookie during SSR
  prerender and holds an in-memory token on the interactive circuit
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:47`,
  `ServerTokenStorageService.cs:106-151`, `ServerTokenStorageService.cs:200-253`). The circuit still
  has an `HttpContext`: the request that opened the hub connection, whose cookie is stale by
  construction (`ServerTokenStorageService.cs:29-39`). So the cookie answers a hub-connection request
  only until this instance has stored, cleared or hydrated a token, and then only while that cookie
  is fresh or absent; an expired one goes to the refresher instead
  (`ServerTokenStorageService.cs:77`, `ServerTokenStorageService.cs:260-288`,
  `ServerTokenStorageService.cs:295-297`). A connection request whose cookie carries a token also
  marks the circuit as holding a session (`ServerTokenStorageService.cs:282-285`). Its refresh-token
  read returns the cookie value whenever an `HttpContext` is present, which on the circuit is that
  connection request's cookie (`ServerTokenStorageService.cs:153-160`). Both browser services
  discard a hydrate whose acquisition was in flight when a login or logout landed, through a
  token-version counter that `SetTokensAsync` bumps and `ClearTokensAsync` bumps both before and
  after its cookie clear (`WasmTokenStorageService.cs:48`, `WasmTokenStorageService.cs:118`,
  `WasmTokenStorageService.cs:134`, `WasmTokenStorageService.cs:145`,
  `WasmTokenStorageService.cs:175-178`, `ServerTokenStorageService.cs:71`,
  `ServerTokenStorageService.cs:165`, `ServerTokenStorageService.cs:182`,
  `ServerTokenStorageService.cs:196`, `ServerTokenStorageService.cs:226-229`). Both browser
  services remember a definitive "no session" for a 15-second anonymous grace, so an anonymous
  visitor is answered from memory instead of one token POST per API call; a `null` from the
  refresher starts it unless an `ISessionAwareTokenRefresher` reports the result unavailable (a
  plain `ITokenRefresher`'s `null` counts as no session), and `SetTokensAsync` ends it at once
  (`WasmTokenStorageService.cs:34`, `WasmTokenStorageService.cs:78-81`, `WasmTokenStorageService.cs:119`,
  `WasmTokenStorageService.cs:159-173`, `WasmTokenStorageService.cs:182-185`,
  `ServerTokenStorageService.cs:57`, `ServerTokenStorageService.cs:119-122`,
  `ServerTokenStorageService.cs:166`, `ServerTokenStorageService.cs:210-223`,
  `ServerTokenStorageService.cs:235-238`). All three shipped refreshers are session-aware. Both
  browser services also implement `ISessionAwareTokenStorage`, whose `SessionEnded` event fires once
  when a session-aware refresher answers a definitive "no session" for a session the storage held (a
  session revoked from another device, or a deleted account); a transient failure never raises it
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISessionAwareTokenStorage.cs:12`,
  `ISessionAwareTokenStorage.cs:18`, `WasmTokenStorageService.cs:29`, `WasmTokenStorageService.cs:58`,
  `WasmTokenStorageService.cs:191-197`, `ServerTokenStorageService.cs:52`,
  `ServerTokenStorageService.cs:87`, `ServerTokenStorageService.cs:244-249`). The MAUI storage does
  not implement it, so the MAUI head has no `SessionEnded` path (`MauiTokenStorageService.cs:34`). Each WASM client also starts
  `TokenHydrationWarmup.WarmAsync` after `builder.Build()` and discards the task, so the first
  hydration overlaps first render instead of running inline on the first API call; it only reads
  through `ITokenStorageService` and swallows every failure
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/TokenHydrationWarmup.cs:26`,
  `TokenHydrationWarmup.cs:37-58`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:92`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:80`). The MAUI
  implementation is framework-shared too and is a pair: `MauiTokenStorageService` is the
  freshness-checking layer
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:32-34`)
  over `MauiSecureTokenStore`, which backs onto `SecureStorage.Default` (platform secure enclaves) and
  guards every read and write so an OS-invalidated keystore entry degrades to one clean re-login
  instead of an unhandled throw on launch
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:22`,
  `MauiSecureTokenStore.cs:69-85`, `MauiSecureTokenStore.cs:91-104`,
  `MauiSecureTokenStore.cs:107-120`); both MAUI heads register the pair through the one
  `AddCommonMauiTokenStorage` call
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:103`,
  `DependencyInjection.cs:105-106`).
- **`ISecureTokenStore` isolates raw persistence, and only MAUI implements it.** It reads back exactly
  what was written and never triggers a refresh
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISecureTokenStore.cs:16`). Splitting
  it out of `ITokenStorageService` is what keeps the MAUI graph acyclic: storage depends on the
  refresher, and the refresher depends on the raw store rather than back on storage
  (`ISecureTokenStore.cs:4-9`). The browser heads implement nothing here, because they hold the access
  token in memory and leave the refresh token in an HttpOnly cookie, so they have no raw store to
  expose (`ISecureTokenStore.cs:10-14`).
- **Login seeds the browser HttpOnly cookie through a JS fetch.** `SetTokensAsync` on both browser
  storage services caches the access token in memory and calls `ISessionCookieSync.SyncAsync`, which
  fires a browser fetch to `/auth/session-cookie` so the resulting `Set-Cookie` lands in the user's
  cookie jar in both Server interactive mode and WASM
  (`WasmTokenStorageService.cs:115-130`, `ISessionCookieSync.cs:8`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:13`,
  `JsFetchSessionCookieSync.cs:19`, `mmca-auth-cookie.js:10-23`). The refresh token transits JS only for
  that single same-origin POST and is never persisted in localStorage. The sync is registered via
  `AddClientAuthSessionCookieSync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:251`,
  `DependencyInjection.cs:253`). That is the default mode. On a same-origin API proxy host the Server
  circuit seeds the cookies through the protected handoff instead (above), and in WASM the proxy's
  `TokenIssuing` rewrite writes the cookies from the sign-in response and hands the browser the
  claims-only token with `refreshToken` emptied
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:122-144`);
  the WASM client still registers `AddClientAuthSessionCookieSync`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:52`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:49`), but its
  `POST /auth/session-cookie` then writes nothing and answers 204 (`SessionCookieEndpoints.cs:41`,
  `SessionCookieEndpoints.cs:55`).
- **Every outgoing API request is bearer-stamped by one handler.** `AuthDelegatingHandler` reads the
  current access token from `ITokenStorageService` and attaches it as a `Bearer` authorization header
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:15`,
  `AuthDelegatingHandler.cs:54`, `AuthDelegatingHandler.cs:57`). It is registered into the shared named
  `"APIClient"` HttpClient pipeline via `AddHttpMessageHandler` (`DependencyInjection.cs:122`,
  `DependencyInjection.cs:132`, `DependencyInjection.cs:154`), so the handler is head-agnostic: it
  depends only on the storage abstraction, which supplies the correctly-hydrated token per head. Two
  requests pass through without reading storage: one that sets the `SkipBearer` option
  (`AuthDelegatingHandler.cs:23`, `AuthDelegatingHandler.cs:47-50`), which the MAUI refresh POST sets
  (`DirectApiTokenRefresher.cs:67`), and one that already carries an `Authorization` header, so a
  forced-refresh replay keeps the token it just acquired instead of resending the rejected one
  (`AuthDelegatingHandler.cs:10-13`, `AuthDelegatingHandler.cs:52`). The handler also catches an
  `HttpRequestException`, marks on it whether the request may be resent, and rethrows, so the shared
  retry policy can tell a replay-safe request from one that may not be resent
  (`AuthDelegatingHandler.cs:26-41`). On a WASM client of a proxy host
  the handler's bearer never reaches the API: the `"APIClient"` base address is the proxy endpoint
  and an innermost `SameOriginProxyRequestHandler` strips every `Authorization` header
  (`DependencyInjection.cs:128-129`, `DependencyInjection.cs:144`, `DependencyInjection.cs:157-163`),
  and the host proxy stamps the cookie session's bearer server-side: the endpoint takes the bearer
  from the validated-or-refreshed cookie session and the transformer sets it as the `Authorization`
  header (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:96-111`,
  `SameOriginProxyTransformer.cs:60`).
- **Blazor auth state is derived from the JWT client-side.** `JwtAuthenticationStateProvider` reads
  the stored access token, parses and expiry-checks it without server validation, and builds an
  authenticated `ClaimsPrincipal` from the token's claims, falling back to anonymous on any failure
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:20`,
  `JwtAuthenticationStateProvider.cs:62-93`, `JwtAuthenticationStateProvider.cs:79`,
  `JwtAuthenticationStateProvider.cs:89-92`). Client-side parsing keeps the UI responsive
  (`AuthorizeView` reacts immediately after login or logout via `NotifyUserAuthentication` /
  `NotifyUserLogout`, `JwtAuthenticationStateProvider.cs:99`, `JwtAuthenticationStateProvider.cs:111`);
  the WebAPI still performs full token validation on every request. The provider subscribes to
  `SessionEnded` when its storage is an `ISessionAwareTokenStorage` (it does not implement the
  interface), and on that event clears the optional `IUiReadCache` its second constructor takes and
  flips the state to anonymous through `NotifyUserLogout`, so a session ended on the server signs the
  shell out instead of leaving it signed in behind 401s
  (`JwtAuthenticationStateProvider.cs:33`, `JwtAuthenticationStateProvider.cs:44`,
  `JwtAuthenticationStateProvider.cs:51-54`, `JwtAuthenticationStateProvider.cs:114-118`).
- **Concurrent callers share one refresh.** All three storage services proactively reacquire when the
  token they hold is within a 30-second expiry skew and collapse concurrent acquisitions (delegating
  handler, auth-state provider, SignalR) onto a single in-flight hydration
  (`WasmTokenStorageService.cs:31`, `WasmTokenStorageService.cs:87-92`, `ServerTokenStorageService.cs:54`,
  `ServerTokenStorageService.cs:128-133`, `MauiTokenStorageService.cs:36`,
  `MauiTokenStorageService.cs:57-66`). The browser services hold that slot per instance; on MAUI it is
  process-wide (static), because the `AuthDelegatingHandler` that `IHttpClientFactory` builds resolves
  its own scoped storage instance in its handler scope, and a per-instance slot let that scope and the
  component scope each rotate the same refresh token, which the server reads as reuse and answers by
  revoking the session (`MauiTokenStorageService.cs:24-30`, `MauiTokenStorageService.cs:38-40`,
  `MauiTokenStorageService.cs:70-76`). On MAUI the check reads through the raw store first, so a token
  recovered from the enclave hours later is refreshed rather than handed to a caller as a bearer that
  answers 401 (`MauiTokenStorageService.cs:45-49`).
- **Each head wires its own trio in Program.cs.** The WASM client registers `WasmTokenStorageService`
  + `SameOriginProxyTokenRefresher` + `JwtAuthenticationStateProvider`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:45-47`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:48-50`); the Blazor Server host
  registers `ServerTokenStorageService` via `AddCommonServerTokenStorage`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:41`,
  `DependencyInjection.cs:50`) plus the same proxy refresher and auth-state provider
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:149-150`, `Program.cs:162`;
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:157-158`, `Program.cs:170`), and in both hosts
  the later `AddCommonSameOriginApiProxy` call overrides that refresher with `HandoffTokenRefresher`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:160`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:168`; the auth-state provider registration
  follows that call); the MAUI host
  registers the shared SecureStorage-backed pair via `AddCommonMauiTokenStorage` plus
  `DirectApiTokenRefresher` + `JwtAuthenticationStateProvider`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:171-173`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:103-105`).

## Rationale
- **One application surface, three storage stories.** Pages, services, and the HTTP pipeline talk to
  `ITokenStorageService` and `AuthenticationStateProvider` only; the head-specific choice of HttpOnly
  cookie versus SecureStorage lives entirely behind those abstractions and the Program.cs
  registration, so UI code never branches on render mode. `ISecureTokenStore` is below that line
  again: nothing outside the MAUI package and its refresher consumes it.
- **Keep the refresh token off the highest-risk surface.** The browser heads are the ones with an XSS
  attack surface, so their refresh token stays in an HttpOnly cookie and rotation happens server-side
  through the same-origin proxy; the token the browser holds is memory-only and short-lived, and on a
  same-origin API proxy host it is only a claims-only copy, never the credential
  (`SessionCookieEndpoints.cs:83-86`, `SameOriginProxyTransformer.cs:142-143`). MAUI, with no
  DOM, can safely hold both tokens in the OS secure enclave.
- **Reuse the ADR-022 cookie plumbing rather than duplicate it.** The browser refresher is a thin JS
  interop call onto the same `/auth/session/token` and `/auth/session-cookie` endpoints ADR-022
  already stands up, so the default path adds the client lifecycle without a second server
  mechanism. A same-origin API proxy host does add one, the handoff endpoints and the proxy itself
  (`SessionHandoffEndpoints.cs:17-18`; ADR-131), so that the browser holds no credential at all.
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
  framework-owned, yet the SecureStorage-backed pair depends on the MAUI `SecureStorage` API, so it
  cannot sit beside its siblings in MMCA.Common.UI: it lives in `MMCA.Common.UI.Maui`, which is
  deliberately outside `MMCA.Common.slnx` (the solution's Presentation folder lists `MMCA.Common.API`,
  `MMCA.Common.Grpc`, `MMCA.Common.UI` and `MMCA.Common.UI.Web` but not the MAUI package,
  `MMCA.Common/MMCA.Common.slnx:19-24`) and is built across its four TFMs by a separate windows-only
  CI job (`MMCA.Common/.github/workflows/ci.yml:173-178`, `ci.yml:179-182`, `ci.yml:214-216`; ADR-042). A change to the MAUI storage is therefore verified on a different, slower
  path than the browser ones.
- **The split multiplies the paths to keep correct.** Three `ITokenStorageService` implementations,
  the MAUI-only `ISecureTokenStore` beneath one of them
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:22`), two
  refreshers plus the proxy's handoff refresher, and two cookie-syncs, mean the same login/refresh/logout invariant is expressed in several
  places; each head's registration set must stay consistent or a head silently loses auth, and the
  MAUI head's storage registration is a pair rather than a single line.

## Related
ADR-022 (the Blazor host's HttpOnly session cookie and the `/auth/session/*` endpoints the browser
refresher proxies through), ADR-050 (the single rotating refresh token with reuse detection that the
`auth/refresh` endpoint enforces and that this client lifecycle acquires against), ADR-042 (the
device-capability abstraction and the MAUI head whose SecureStorage backs `DirectApiTokenRefresher`
and the shared storage pair, `MauiTokenStorageService` over `MauiSecureTokenStore`, in the MAUI-TFM
package), ADR-131 (the same-origin API proxy whose handoff refresher, handoff cookie sync and
claims-only browser tokens replace the browser credential path on both consumer hosts).

## Revision (2026-08-07)
The MAUI half of `ITokenStorageService` is no longer app-local. The original Decision left the
SecureStorage-backed implementation in each app because it depends on the MAUI `SecureStorage` API;
it has since been hoisted into the framework's MAUI-TFM package, so all three storage
implementations are now framework-owned.

1. **Framework-owned, in MMCA.Common.UI.Maui.** Both tokens live under the `auth_access_token` /
   `auth_refresh_token` keys in `SecureStorage.Default`, in the sealed class the 2026-08-31 Revision
   below names `MauiSecureTokenStore`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:22`,
   `MauiSecureTokenStore.cs:24-25`). The per-app copies are gone: a workspace-wide search for the MAUI
   storage types returns only the framework files under `MMCA.Common.UI.Maui`, nothing under
   `MMCA.ADC/Source/` or `MMCA.Store/Source/`, so the "behavior can drift between the two apps" risk
   the Trade-offs section recorded no longer applies.
2. **Both heads register it through one extension method.** `AddCommonMauiTokenStorage()` is the
   single call each MAUI host makes
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:97`,
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:163`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:97`). Its registrations are scoped, not
   singleton, to match the two browser siblings so component code depends on one lifetime on every
   head (`DependencyInjection.cs:99-100`, rationale at `DependencyInjection.cs:92-95`). The rest of
   each MAUI trio is unchanged: `DirectApiTokenRefresher` + `JwtAuthenticationStateProvider` still
   follow it (`MauiProgram.cs:164-165` in ADC, `MauiProgram.cs:98-99` in Store).
3. **The hoist added failure handling the app copies did not have.** Every read and write is guarded,
   because the OS invalidates keystore entries on its own schedule and the raw API then throws rather
   than returning nothing: a failed read drops the unreadable entry and degrades to "no token stored"
   (`MauiSecureTokenStore.cs:69-85`), a failed write retries once against a freshly removed key and
   otherwise propagates (`MauiSecureTokenStore.cs:91-104`), `ClearTokensAsync` is best-effort so
   logout always succeeds (`MauiSecureTokenStore.cs:56-63`, `:107-120`), and `SetTokensAsync`
   writes both tokens under one shared guard so either write failing drops both, rather than leaving a
   mismatched pair (`MauiSecureTokenStore.cs:34-53`).
4. **What it cost.** The classes cannot live in `MMCA.Common.UI` (that package must stay
   Blazor-WASM-compatible and MAUI-free), so they sit in `MMCA.Common.UI.Maui`, outside
   `MMCA.Common.slnx` and built across its four TFMs by a windows-only CI job (ADR-042). The
   Trade-offs bullet above is rewritten accordingly: the risk is no longer divergent copies, it is a
   slower and separate verification path for the one shared copy.

## Revision (2026-08-14)
`SetTokensAsync` closed a gap the original hoist left open. Point 3 above previously described the
method as writing the refresh token first and dropping both tokens only when the following
access-token write failed, which left a window where a failing refresh-token write escaped before
the guard was entered and left the OLD pair in place: the app then held a stale access token it
believed was current until a manual sign-out cleared it.

`SetTokensAsync` performs both writes inside one `try`/`catch`, so either write failing drops both
tokens and forces a clean re-login instead of leaving a stale, partially-updated pair
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:34-53`; the
comment at `:36-39` records the trap). Point 3's description above is updated accordingly: read
guarding, write-retry, and best-effort clearing are all unchanged, only the `SetTokensAsync` behavior
narrowed.

## Revision (2026-08-31)
MAUI storage is two classes, and the freshness check the browser heads always had is now on every
head.

1. **A raw store beneath the storage service.** `ISecureTokenStore` is the third abstraction: raw
   persistence, no freshness semantics, implemented only where a head persists tokens itself
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISecureTokenStore.cs:16`). The MAUI
   implementation `MauiSecureTokenStore` holds every line of `SecureStorage.Default` handling and all
   the guarding the 2026-08-07 Revision describes
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:22`);
   `MauiTokenStorageService` keeps the `ITokenStorageService` surface and delegates the raw
   reads and writes to it (`MauiTokenStorageService.cs:69`, `MauiTokenStorageService.cs:72-73`,
   `MauiTokenStorageService.cs:76`).
2. **The split is what keeps the graph acyclic.** Storage depends on the refresher, and
   `DirectApiTokenRefresher` depends on the raw store rather than back on storage
   (`DirectApiTokenRefresher.cs:18-20`, rationale at `DirectApiTokenRefresher.cs:10-16`,
   `ISecureTokenStore.cs:4-9`). Depending on `ITokenStorageService` there would let a refresh
   re-enter the acquisition that started it.
3. **MAUI reads through an expiry check.** `MauiTokenStorageService` refreshes proactively when the
   stored token is within the same 30-second skew the browser services use, and collapses concurrent
   callers onto one in-flight acquisition (`MauiTokenStorageService.cs:23`,
   `MauiTokenStorageService.cs:30-36`, `MauiTokenStorageService.cs:43-48`). A token read back from the
   enclave can be hours or days old, so returning it verbatim handed the delegating handler, the
   auth-state provider and SignalR an expired bearer, which the user experienced as a random
   sign-out.
4. **Registration is a pair, still one call.** `AddCommonMauiTokenStorage()` registers both the raw
   store and the storage service, both scoped
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:97`,
   `DependencyInjection.cs:99-100`), so each MAUI host's wiring is unchanged
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:163-165`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:97-99`). Both halves are required: the
   storage service cannot resolve without a raw store behind it.

## Revision (2026-10-01)
No decision or rationale changed. Citations in Decision and Trade-offs are re-anchored to the current
source (`DirectApiTokenRefresher`, `JsFetchSessionCookieSync`, `mmca-auth-cookie.js`,
`AuthDelegatingHandler`, the three storage services, both `DependencyInjection.cs` files, the ADC and
Store host `Program.cs` files, `MMCA.Common.slnx` and the windows MAUI job in `ci.yml`). Two statements
are corrected where they live. The Trade-offs bullet now lists all four projects in the slnx
Presentation folder (`MMCA.Common/MMCA.Common.slnx:19-24`), which never held only the two UI
packages. The bearer-handler bullet now records the `SkipBearer` request option: the MAUI refresh POST
goes through the same `"APIClient"` pipeline as every other call, so it opts out of the bearer header
and never reads the storage instance that is awaiting it, which is the HTTP-pipeline counterpart of
the raw-store split
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:15-20`,
`AuthDelegatingHandler.cs:27-30`, `DirectApiTokenRefresher.cs:18-22`, `DirectApiTokenRefresher.cs:46`).
Also previously unrecorded: `SetTokensAsync` on both browser storage services throws
`InvalidOperationException` when the session-cookie write reports failure, after the in-memory token
is set, so a login whose cookie was never written surfaces as an error rather than signing out at the
first access-token expiry (`WasmTokenStorageService.cs:68-71`, `ServerTokenStorageService.cs:89-92`).

## Revision (2026-10-06)
No decision changed; four behaviors the Decision did not record are now stated where they live.

1. **The browser refresher tells "no session" from "unavailable".** `SameOriginProxyTokenRefresher`
   implements `ISessionAwareTokenRefresher` and returns a three-way `TokenAcquisition`; the script
   answers `null` only on a 401 and throws on any other non-OK status
   (`SameOriginProxyTokenRefresher.cs:23-37`, `mmca-auth-cookie.js:51-56`). The earlier wording
   ("returns `null` rather than throwing") now holds only for the collapsing `AcquireAccessTokenAsync`
   (`SameOriginProxyTokenRefresher.cs:19-20`).
2. **Both browser storage services hold a 15-second anonymous grace**, started only by a definitive
   no-session answer and cleared by `SetTokensAsync` (`WasmTokenStorageService.cs:30`,
   `ServerTokenStorageService.cs:40`). Each also gained a constructor taking a `TimeProvider`, with
   the original constructor kept (`WasmTokenStorageService.cs:22-25`, `WasmTokenStorageService.cs:45`).
3. **The MAUI single-flight is process-wide**, not per instance, so the handler scope and the
   component scope cannot each rotate the same refresh token (`MauiTokenStorageService.cs:24-30`,
   `MauiTokenStorageService.cs:70-76`).
4. **`AuthDelegatingHandler` leaves a request that already carries an `Authorization` header
   untouched**, so a forced-refresh replay is not overwritten with the rejected stored token
   (`AuthDelegatingHandler.cs:34`).

All path:line anchors in Status, Decision and Trade-offs were re-verified against current source.
The MAUI registration cited in the 2026-08-07 and 2026-08-31 Revisions now sits at
`MMCA.Common.UI.Maui/DependencyInjection.cs:103` and `:105-106`, the ADC MAUI wiring at
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:165-167`, and the browser `SetTokensAsync`
throw at `WasmTokenStorageService.cs:103-106` and `ServerTokenStorageService.cs:131-134`.

## Revision (2026-10-07)
Re-verified against current source. The three abstractions, the shared bearer handler, the
client-side auth-state provider and the MAUI storage story are unchanged. What moved is the
browser credential path on the same-origin API proxy hosts, which the Decision attributed to the
default refresher and cookie sync: there the browser holds only a claims-only token and the
handoff endpoints plus the proxy are a second server mechanism, so the Rationale bullets on the
browser token and on reusing the ADR-022 plumbing are qualified accordingly. Two MAUI refresher
outcomes the Decision did not record are also stated.

1. **The Server circuit uses the protected handoff on both consumer hosts.**
   `AddCommonSameOriginApiProxy` replaces `ITokenRefresher` with `HandoffTokenRefresher` and
   `ISessionCookieSync` with `HandoffSessionCookieSync`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:83-84`),
   and both hosts call it after their own registrations
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:161`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:153`). The page carries only
   `SessionHandoffProtector` ciphertext (`HandoffSessionServices.cs:24`, `HandoffSessionServices.cs:58`,
   `mmca-auth-cookie.js:66-100`, `SessionHandoffEndpoints.cs:17-18`), so the circuit's
   `mmcaAuthSession.getToken` and `mmcaAuthCookie.set` paths are not used there, and boot fails if a
   later registration displaces either (`SameOriginApiProxyEndpointExtensions.cs:64-92`). ADR-131 is
   now cross-referenced in Related.
2. **Claims-only browser tokens.** The proxy sets `ClaimsOnlyBrowserTokens`
   (`SameOriginApiProxyServiceExtensions.cs:73`): `/auth/session/token` returns an unsigned claims
   copy (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:75-77`),
   `POST /auth/session-cookie` writes nothing and answers 204 (`SessionCookieEndpoints.cs:36-46`), and
   WASM sign-in cookies are written by the proxy's `TokenIssuing` rewrite, which empties
   `refreshToken` in the body (`SameOriginProxyTransformer.cs:122-144`).
3. **The WASM bearer is stripped and re-stamped.** A WASM client of a proxy host points
   `"APIClient"` at the proxy and adds an innermost handler that strips `Authorization`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:120-121`,
   `DependencyInjection.cs:136`, `DependencyInjection.cs:149-155`); the proxy stamps the cookie
   session's bearer server-side (`SameOriginApiProxyEndpoint.cs:86-95`,
   `SameOriginProxyTransformer.cs:60`).
4. **MAUI refresher outcomes.** `DirectApiTokenRefresher` is a sealed `ISessionAwareTokenRefresher`
   (`DirectApiTokenRefresher.cs:35-37`). A 409 (`Auth.RefreshSuperseded`) is transient and never
   clears the stored pair (`DirectApiTokenRefresher.cs:25-33`, `DirectApiTokenRefresher.cs:64-67`,
   `DirectApiTokenRefresher.cs:88-98`); any other non-success status is no session
   (`DirectApiTokenRefresher.cs:69-72`); MAUI storage hydrates through the collapsing overload, so an
   unavailable result reaches callers as a `null` bearer (`MauiTokenStorageService.cs:103-104`).
5. Anchors re-verified against current source: `DirectApiTokenRefresher.cs:48-49` (reads),
   `:56-62` (POST), `:61` (`SkipBearer`), `:80` (persist), `:12-18` (raw-store rationale); the ADC
   Server host at `MMCA.ADC.UI.Web/Program.cs:150-151` and `:163`; the windows MAUI job at
   `MMCA.Common/.github/workflows/ci.yml:173-178`, `:179-182` and `:214-216` (the MAUI build step,
   formerly cited at `:239-241`, moved up when lines above it were removed). The `MauiTokenStorageService` delegation the
   2026-08-31 Revision cites now sits at `MauiTokenStorageService.cs:94`, `:97-98` and `:101`.

## Revision (2026-10-21)
Re-verified against current source. The three abstractions, the head-specific trios, the same-origin
proxy handoff, the claims-only browser token, the 15-second grace, the 30-second skew and the
single-flight refresh are unchanged. What moved is how the MAUI refresher classifies failures, how
the Server storage service tells the circuit from the prerender, and two behaviors the Decision did
not record. The Decision anchors that drifted are re-pointed (point 6); the MAUI storage, Server
host and client `Program.cs` anchors had not moved and stand as written. The dated
Revisions above keep their anchors as written; they are not current.

1. **MAUI refresher: a refusal is "no session", other failures are unavailable.**
   `DirectApiTokenRefresher` answers no session
   for a 400, 401 or 403 and unavailable for every other non-success status, a dropped connection and
   an `HttpClient` timeout the caller did not request
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:91-96`,
   `DirectApiTokenRefresher.cs:74-82`, rationale at `DirectApiTokenRefresher.cs:34-39`). It also
   answers no session when no pair is stored and when a success body carries an empty access token
   (`DirectApiTokenRefresher.cs:57-60`, `DirectApiTokenRefresher.cs:98-102`). The Decision bullet is
   corrected in place; point 4 of the 2026-10-07 Revision ("any other non-success status is no
   session") no longer holds.
2. **Server storage: the circuit has an `HttpContext`.** It is the request that opened the hub
   connection, so a non-null `HttpContext` alone does not mean prerender: `ServerTokenStorageService`
   answers from memory when there is no `HttpContext` or memory has become authoritative, and
   otherwise lets a hub-connection request use its cookie only while that token is fresh or absent
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:26-36`,
   `ServerTokenStorageService.cs:74`, `ServerTokenStorageService.cs:227-250`,
   `ServerTokenStorageService.cs:257-259`). Its refresh-token read returns the cookie whenever an
   `HttpContext` is present, including that connection request on the circuit
   (`ServerTokenStorageService.cs:140-145`).
3. **A hydrate overtaken by a login or logout is discarded.** Both browser storage services carry a
   token-version counter that `SetTokensAsync` and `ClearTokensAsync` bump; a hydrate that sees it
   move returns the current token instead of its stale answer and starts no grace
   (`WasmTokenStorageService.cs:44`, `WasmTokenStorageService.cs:141`, `WasmTokenStorageService.cs:155`,
   `ServerTokenStorageService.cs:68`, `ServerTokenStorageService.cs:191`,
   `ServerTokenStorageService.cs:205-208`).
4. **The bearer handler marks replay safety.** `AuthDelegatingHandler` catches an
   `HttpRequestException`, records on it whether the request may be resent, and rethrows
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:26-41`).
5. **What starts the anonymous grace.** A `null` from the refresher starts it unless a
   session-aware refresher reports the result unavailable; a plain `ITokenRefresher`'s `null` counts
   as no session (`WasmTokenStorageService.cs:144-153`, `ServerTokenStorageService.cs:194-203`). The
   Decision bullet, which said only a session-aware `NoSession` starts it, is corrected in place.
6. Anchors re-verified against current source: `ITokenRefresher.cs:17` and `:24`;
   `DirectApiTokenRefresher.cs:41-43` (class), `:54-55` (reads), `:62-67` (POST), `:67`
   (`SkipBearer`), `:86-89` and `:112-122` (409), `:104` (persist); `AuthDelegatingHandler.cs:15`,
   `:23`, `:10-13`, `:47-50`, `:52`, `:54`, `:57`; `MMCA.Common.UI/DependencyInjection.cs:122`, `:132`,
   `:154` (handler), `:128-129`, `:144`, `:157-163` (proxy strip), `:251` and `:253` (cookie sync);
   `WasmTokenStorageService.cs:57-96`, `:64-67`, `:73-78`, `:99`, `:101-115`, `:105`, `:162-165`;
   `ServerTokenStorageService.cs:44`, `:51`, `:54`, `:93-138`, `:106-109`, `:115-120`, `:151`,
   `:214-217`; the MAUI wiring at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:171-173` and
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:103-105`. `ISecureTokenStore` still has
   one implementer (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiSecureTokenStore.cs:22`).

## Revision (2026-10-26)
Re-verified against current source. The three abstractions, the head-specific trios, the
same-origin proxy handoff, the claims-only browser token, the 15-second grace, the 30-second skew,
the token-version counter and the single-flight refresh are unchanged. What the Decision did not
record is how a session that ends on the server reaches the UI, and the WASM boot warm-up; both are
now stated in place. Every Decision anchor into the two browser storage services, the auth-state
provider, the auth script, the session-cookie endpoints, the proxy endpoint and the Server host
`Program.cs` files had moved and is re-pointed (point 4). The dated Revisions above keep their
anchors as written; they are not current (the 2026-10-21 note that the Server host anchors had not
moved no longer holds).

1. **A session ended on the server signs the shell out.** `ISessionAwareTokenStorage` extends
   `ITokenStorageService` with a `SessionEnded` event, raised once when a session-aware refresher
   answers a definitive "no session" for a session the storage held, and never on a transient
   failure
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/ISessionAwareTokenStorage.cs:12`,
   `ISessionAwareTokenStorage.cs:18`). Both browser storage services implement it
   (`WasmTokenStorageService.cs:29`, `:58`, raised at `:191-197`;
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:52`,
   `:87`, raised at `:244-249`). `JwtAuthenticationStateProvider` subscribes rather than implements:
   on the event it clears the optional `IUiReadCache` and calls `NotifyUserLogout`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:44`,
   `:51-54`, `:114-118`). `MauiTokenStorageService` implements only `ITokenStorageService`, so the
   MAUI head has no such path
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:34`).
2. **The Server storage marks a session held from the connection cookie.** A hub-connection request
   whose cookie carries a token sets the held flag before answering, so a circuit that started signed
   in can later raise `SessionEnded` (`ServerTokenStorageService.cs:282-285`).
3. **WASM boot pre-hydrates the token.** `TokenHydrationWarmup.WarmAsync` reads the access token once
   through `ITokenStorageService` and swallows any failure; both WASM clients start it after
   `builder.Build()` and discard the task
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/TokenHydrationWarmup.cs:26`,
   `TokenHydrationWarmup.cs:37-58`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:92`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:80`).
4. Anchors re-verified against current source: `mmca-auth-cookie.js:47-63` (`getToken`), `:54-59`
   (401 versus throw), `:69-103` (`mmcaAuthHandoff`), `:10-23` (`mmcaAuthCookie.set`);
   `WasmTokenStorageService.cs:26` (class), `:31` (skew), `:34` (grace), `:48` (version), `:71-110`
   (read, grace check `:78-81`, single flight `:87-92`), `:113` (null refresh token), `:115-130`
   (`SetTokensAsync`, bump `:118`, grace cleared `:119`), `:134` and `:145` (clear bumps), `:159-173`,
   `:175-178` and `:182-185` (hydrate); `ServerTokenStorageService.cs:29-39` (remarks), `:47` (class),
   `:54`, `:57`, `:71`, `:77`, `:106-151` (read, grace `:119-122`, single flight `:128-133`),
   `:153-160` (refresh-token read), `:165`, `:166`, `:182`, `:196` (bumps and grace clear),
   `:200-253` (hydrate, version check `:226-229`), `:260-288` (`TryAnswerFromCookie`), `:295-297`
   (`IsHubConnection`); `JwtAuthenticationStateProvider.cs:20`, `:62-93`, `:79`, `:89-92`, `:99`,
   `:111`; `SessionCookieEndpoints.cs:41` and `:55` (claims-only POST answers 204), `:83-86`
   (claims-only token); `SameOriginApiProxyEndpoint.cs:96-111` (bearer from the cookie session); the
   Server hosts at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:156-157`, `:167`, `:169`,
   `:290` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:148-149`, `:159`, `:161`,
   `:268`. `SessionClaimsToken.cs:10` and `:17` and `SameOriginProxyTransformer.cs:60` stand as
   written.

## Revision (2026-10-28)
Re-verified against current source. The head-specific trios, the same-origin proxy handoff and the
override order are unchanged: in both Server hosts `AddCommonSameOriginApiProxy` still follows the
`SameOriginProxyTokenRefresher` registration and precedes the auth-state provider, and the call still
replaces `ITokenRefresher` with `HandoffTokenRefresher` and `ISessionCookieSync` with
`HandoffSessionCookieSync`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:83-84`).
Only the Server host `Program.cs` anchors moved, each by one line, and the Decision is re-pointed in
place. The dated Revisions above keep their anchors as written.

1. Anchors re-verified against current source: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:157`
   (`AddCommonServerTokenStorage`), `:158` (`SameOriginProxyTokenRefresher`), `:168`
   (`AddCommonSameOriginApiProxy`), `:170` (`JwtAuthenticationStateProvider`), `:291`
   (`MapCommonSameOriginApiProxy`); `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:149`,
   `:150`, `:160`, `:162`, `:269` (same order).
