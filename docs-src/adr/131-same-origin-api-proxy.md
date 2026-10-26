# ADR-131: Same-Origin API Proxy (a Backend-for-Frontend That Keeps Tokens Out of Browser Script)

## Status
Accepted (2026-10-01). Shipped in MMCA.Common v1.218.0. Revised 2026-10-06: v1.218.0 is released,
ADC adopted it through 1.218.1, HTTP/2 WebSocket CONNECT is exempt from the CSRF header, and proxied
hub traffic is exempt from the UI rate limiter.
Records the owner's TD-08 decision for Option A of the token-storage design note; the implementing
MMCA.Common commits are 4cfb4a35 (the proxy), b542dde1 (downloads through the proxy) and fba02c29
(refresh outcomes and the same-origin gate). Opt-in per host: a host that does not call
`AddCommonSameOriginApiProxy` is unchanged (`MMCA.Common/UPGRADING.md:918`). Extends
[ADR-022](022-browser-session-cookie-auth.md) (the HttpOnly session cookie, until now read only for
server-side rendering) and [ADR-051](051-client-auth-token-lifecycle.md) (the client token
lifecycle) without changing [ADR-088](088-gateway-edge-responsibilities.md) (the gateway stays the
API edge). Revised 2026-10-07: the proxied hub connection carries no `X-CSRF` header and both hub
modes are WebSocket-only with negotiation skipped, `Unavailable` covers every non-refusal status
including 409 `Auth.RefreshSuperseded`, and the implementing commits are on `main` as squash e9c28d15
(#469). Revised 2026-10-21: a seventh setting, `MaxRequestBodySizeByPath` (v1.237.0), raises the
request body cap per gateway-relative path before the session step, the validator also refuses
malformed endpoint paths and body-size entries, the proxy's switch-off of status-code pages for the
whole request (shipped in e9c28d15, so that a proxied empty-body 401 or 404 reaches the client
unchanged) is now recorded, the session cookie lifetime follows the refresh-token lifetime, and
anchors are refreshed. Revised 2026-10-26: the `OPTIONS` step and the ADR-082 link now say that no
preflight reaches the gateway while a forwarded request keeps the browser's `Origin` for the gateway's
CORS middleware, the session cookie is also `Secure` on any HTTPS request in Development (MMCA.Common
#588), and anchors are refreshed after MMCA.Common #587, #588, #590, #612 and the release notes through
v1.261.0.

## Context
A Blazor WebAssembly client calls the API through the gateway, which is a different origin from the
UI host, so the HttpOnly session cookies the UI host writes (ADR-022) never travel with those calls.
The client therefore authenticates with a bearer token script can read: a host that does not opt in
still attaches the stored token to the notification hub through
`options.AccessTokenProvider = _tokenStorageService.GetAccessTokenAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:546`;
off the browser the hub's own socket factory sets that bearer on the upgrade, `:548-551`, `:591-595`),
and to every `"APIClient"` call through `AuthDelegatingHandler`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:15`). One
successful script injection can then lift a live token and use it from anywhere until it expires.

The ADC token-storage design note (kept in the private ADC repository) weighed four answers to "how
does an HttpOnly credential reach a cross-origin API": A, a same-origin proxy on the UI host; B, a
cookie scoped to a registrable domain shared by UI and API, sent straight to the gateway; C, keep the
script-readable token and shrink the blast radius (enforced CSP, short TTLs); and C+, an interim
hybrid with the refresh token in the HttpOnly cookie and the access token held in memory. C+ removes
the long-lived prize but still leaves a usable access token in script for its lifetime. The pieces A
needs already existed: the cookie pair and its writer (`ISessionCookieStore`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/ISessionCookieStore.cs:15`, HttpOnly,
Secure outside Development and on any HTTPS request in Development, `SessionCookieJar.cs:68`, with a
lifetime that defaults to `Jwt:RefreshTokenExpirationDays` when
that section is bound and to 7 days otherwise,
`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieSettings.cs:31-38`,
resolved at `SessionCookieJar.cs:35-47`), and a single-flight refresher over that cookie
(`ICookieSessionRefresher`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:32`, striped
per refresh token, `:68-73`, `:88`).

## Decision
The UI host serves the API on its own origin and forwards to the gateway server-side, attaching the
bearer it reads from the HttpOnly cookie. The browser never holds a token that any API accepts.

- **Opt-in, hosted in MMCA.Common.UI.Web.** `AddCommonSameOriginApiProxy(IConfiguration)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:51`)
  binds and validates the settings on start (`:55-67`), registers YARP's forwarder (`:76`) and data
  protection (`:77`), and replaces the Blazor Server circuit's `ITokenRefresher` and
  `ISessionCookieSync` with protected-handoff implementations (`:83-84`).
  `MapCommonSameOriginApiProxy()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpointExtensions.cs:33`)
  maps `{PathPrefix}/{**path}` for every method, WebSocket upgrades included, anonymous by
  declaration, without antiforgery and outside the OpenAPI description (`:49-52`). It fails the boot
  when the registration call is missing (`:38-42`) or when a later registration displaced the handoff
  services, because that would put the access token back in the page (`:59-69`, `:85-90`).
- **Settings.** `SameOriginApiProxySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:22`,
  section `SameOriginApiProxy`, `:25`): `PathPrefix` `/api` (`:39`), `GatewayAddress` defaulting to
  `Api:ApiEndpoint` so an Aspire discovery name resolves as it does for the host's other clients
  (`:47`, filled at `SameOriginApiProxyServiceExtensions.cs:57-64`), token-issuing paths
  `auth/login`, `auth/register`, `auth/oauth/exchange` plus any `AdditionalTokenIssuingPaths`
  (`:32`, `:53`), `MaxRequestBodySizeByPath` (`:55-76`), `RefreshPath` `auth/refresh` (`:83`),
  `RevokePath` `auth/revoke` (`:90`) and `SessionCookieSameSite` `Strict` (`:98`).
  `MaxRequestBodySizeByPath` is empty by default; each key is a gateway-relative path, matched
  case-insensitively on a whole-segment prefix with the longest key winning, and its value in bytes
  replaces the server default (Kestrel's is 30,000,000 bytes) for that path, so an upload the API
  accepts is not refused 413 at the UI host first. The validator refuses a prefix with route syntax,
  a non-absolute gateway and any `SameSite` other than `Strict` or `Lax`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettingsValidator.cs:28-45`),
  a `RefreshPath`, `RevokePath` or additional token-issuing path that is not a non-empty relative path
  (`:47-51`), and a `MaxRequestBodySizeByPath` entry whose key is not such a path or whose limit is not
  positive (`:53-66`).
- **The request pipeline, in order.** `SameOriginApiProxyEndpoint`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:29`)
  first disables the host's status-code pages for the request, so a proxied 401 or 404 with an empty
  body reaches the client as sent rather than as a re-executed HTML page (`:72-77`), then runs every
  gate before anything is forwarded (`:79`, `:241-274`):
  1. **Same-origin gate.** An `Origin` that is not exactly the host's own (scheme, host and port as the
     app sees them; a sibling subdomain is another origin), a WebSocket upgrade with no `Origin`
     (HTTP/1.1 upgrade or HTTP/2 extended `CONNECT`), or a `Sec-Fetch-Site` other than `same-origin`
     is refused 403 `cross_origin_rejected`; `none` is allowed only on a plain GET or HEAD, for a
     user-initiated navigation such as a pasted download link (`:128-220`, own-origin comparison
     `:152-173`, refusal `:247-252`).
  2. **`OPTIONS` answered locally** with 204 and no CORS grant, never forwarded, so no preflight
     reaches the gateway on the proxy's behalf (`:254-263`). A request that clears the remaining steps
     and is forwarded keeps the browser's `Origin`, so the gateway's CORS middleware still sees it:
     the transformer starts from YARP's default header copy and never removes `Origin`
     (`SameOriginProxyTransformer.cs:53`, its rewrites at `:60-62`).
  3. **CSRF header.** Every unsafe method must carry exactly `X-CSRF: 1` or gets 403
     `csrf_header_required` (`:123-126`, `:265-271`). The one exemption is a WebSocket opened over
     HTTP/2, an RFC 8441 extended `CONNECT` to which a browser cannot add headers and which the
     same-origin gate has already held to the host's own `Origin` (`:175-185`, `:266`). The
     constants are `SameOriginProxyHeaders`
     (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyHeaders.cs:11`,
     `:14`, `:17`).
  4. **Body-size cap.** When a `MaxRequestBodySizeByPath` key covers the gateway-relative path, the
     request's body limit is set to that value before anything reads the body
     (`SameOriginApiProxyEndpoint.cs:86-87`, `:346-369`, keys ordered longest first at `:60-66`).
  5. **Session step.** A request with a session cookie is validated or refreshed through
     `ICookieSessionRefresher.ValidateOrRefreshAsync`; sign-in requests skip it so a stale session
     cannot block a login (`SameOriginApiProxyEndpoint.cs:96-109`).
  6. **Forward** through YARP over HTTP/1.1 with a 100-second activity timeout, so an HTTP/1.1
     WebSocket upgrade forwards as a plain upgrade and an HTTP/2 one is turned into an HTTP/1.1 GET
     upgrade to the gateway (`:40-48`, `:379-389`), with the bearer attached server-side.
  7. **One forced refresh and replay** when a safe, bodiless method comes back 401 (a revoked token
     or a rotated key); nothing with a body, and no upgrade, is re-sent (`:111-117`, `:226-230`,
     `:328-344`).
- **What the forward rewrites.** `SameOriginProxyTransformer` replaces any browser `Authorization` with
  the session's bearer, drops the `X-CSRF` header and strips the two session cookies from the upstream
  `Cookie` header
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:60-62`,
  `:156-172`). A successful token-issuing response moves the pair into the cookies and reaches the
  browser with `accessToken` replaced by its claims-only form and `refreshToken` emptied (`:91`,
  `:134-143`); a revoke forwards the bearer and clears the cookies whatever the upstream answered
  (`:84-87`). A browser POST to the refresh path is answered by the proxy itself from the refresh
  cookie, with the claims-only `accessToken`, an empty `refreshToken` and the `accessTokenExpiry`
  (`SameOriginApiProxyEndpoint.cs:89-94`, `:302-326`, `:391-414`).
- **Stateless: tokens stay in the existing cookie.** No server-side session store; the proxy reads and
  writes the same HttpOnly pair through `ISessionCookieStore` (`ISessionCookieStore.cs:21`, `:25`).
- **The browser holds an unsigned claims copy.** `SessionClaimsToken.Create`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionClaimsToken.cs:25-33`)
  keeps the access token's payload under an `{"alg":"none","typ":"JWT"}` header with an empty
  signature (`:17`), enough to render authentication state and nothing any API accepts (`:7-13`).
  Opting in sets `SessionCookieSettings.ClaimsOnlyBrowserTokens`, so `/auth/session/token` returns the
  claims copy and `POST /auth/session-cookie` ignores script-supplied tokens
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieSettings.cs:21-29`,
  set at `SameOriginApiProxyServiceExtensions.cs:69-74`).
- **Refresh outcomes are three, not two.** `SessionRefreshStatus`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionRefreshOutcome.cs:4`) is
  `Refreshed`, `Rejected` (no refresh cookie, or the identity endpoint answered 400, 401 or 403) and
  `Unavailable` (any other status, a timeout, a network failure or an unreadable body) (`:10-23`),
  classified at `CookieSessionRefresher.cs:123-126`. "Any other status" covers 5xx, 429, 408, a 404
  from a misrouted gateway, and 409 `Auth.RefreshSuperseded` when another request rotated the same
  token inside `RefreshSessions:ReuseGraceSeconds` (`CookieSessionRefresher.cs:114-122`). The proxy
  clears the cookies and answers 401 only on `Rejected`; on `Unavailable` it keeps them, forwards and
  replays nothing, and answers 503 with the upstream `Retry-After`, or 5 seconds when there is none (`SameOriginApiProxyEndpoint.cs:51`,
  `:283-300`).
- **The Blazor Server circuit trades handoffs, not tokens.** The circuit keeps calling the gateway
  server-to-server; it exchanges tokens with the cookies only as data-protected, purpose-bound
  handoffs that live one minute
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffProtector.cs:19`,
  `:21-27`).
- **The WebAssembly client switches by configuration.** `/client-config` adds
  `SameOriginApiEndpoint` only on an opted-in host
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:99`),
  the bootstrap resolves it against the app base address
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/MmcaClientConfigBootstrap.cs:98`),
  and `ApiSettings.SameOriginApiEndpoint`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:33`) then becomes the
  `"APIClient"` base address
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:144`) and adds
  `SameOriginProxyRequestHandler` (`DependencyInjection.cs:161-162`), which removes any
  `Authorization` header and stamps `X-CSRF: 1`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyRequestHandler.cs:11`,
  `:18-20`).
- **Hubs are proxied too.** On an opted-in client the notification hub connects through the proxy
  with no token, no extra header and no access-token provider (`NotificationHubService.cs:100-101`,
  `:519-522`, `:541-544`). A browser cannot add headers to a WebSocket upgrade, so the proxy needs no
  `X-CSRF` there: a GET upgrade is a safe method and an HTTP/2 extended `CONNECT` is exempt
  (`SameOriginApiProxyEndpoint.cs:266`), and both are held to the host's own `Origin` by the
  same-origin gate (`:193-201`); the proxy attaches the bearer to
  the upgrade server-side. Both modes skip negotiation and use WebSockets only, with no Server-Sent
  Events or long-polling fallback (`NotificationHubService.cs:538-539`).
- **Downloads follow the API client.** `ApiFileDownloadButton` resolves its anchor base as
  `SameOriginApiEndpoint`, then `WasmApiEndpoint`, then `ApiEndpoint`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Forms/ApiFileDownloadButton.razor.cs:98`),
  so a top-level GET carries the cookie and the proxy supplies the bearer.
- **MAUI is excluded.** Native heads keep OS SecureStorage and talk to the gateway directly; the
  `"APIClient"` pipeline changes only when `SameOriginApiEndpoint` is configured, which only an
  opted-in host's WebAssembly client receives (`DependencyInjection.cs:125-129`).
- **SameSite: Strict by default, Lax allowed.** The framework-wide cookie default stays `Lax`
  (`SessionCookieSettings.cs:19`); opting in raises it to the proxy's `SessionCookieSameSite`,
  `Strict` unless the host chooses `Lax` (`SameOriginApiProxySettings.cs:92-98`). CSRF protection
  rests on the header and origin gates above, not on `SameSite`. MMCA.ADC, which adopted the proxy
  with MMCA.Common 1.218.1 (ADC #236), sets `Lax` so a signed-in user arriving from a mailed deep
  link keeps the session on the first server render, and raises the body cap for
  `SessionAssets/file` to 52,494,336 bytes so session-material uploads the gateway and API accept are
  not refused at the UI host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:60-74`, the two settings at `:70`,
  `:71-73`).
- **Gates.** The behavior is pinned by `SameOriginApiProxyOptInTests` (hosts that do not opt in are
  unchanged,
  `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/SameOriginProxy/SameOriginApiProxyOptInTests.cs:21`),
  `SameOriginApiProxyCsrfTests` (`SameOriginApiProxyCsrfTests.cs:12`), `SameOriginApiProxyOriginTests`
  (`SameOriginApiProxyOriginTests.cs:14`), `SameOriginApiProxyRefreshOutcomeTests`
  (`SameOriginApiProxyRefreshOutcomeTests.cs:14`), `SameOriginApiProxyHubTests`
  (`SameOriginApiProxyHubTests.cs:29`), `SameOriginApiProxyTokenTests`
  (`SameOriginApiProxyTokenTests.cs:15`), `SameOriginApiProxyAuthFlowTests`
  (`SameOriginApiProxyAuthFlowTests.cs:20`), `SameOriginApiProxyBodySizeTests`
  (`SameOriginApiProxyBodySizeTests.cs:40`) and `SessionHandoffServicesTests`
  (`SessionHandoffServicesTests.cs:14`), all in the same folder.

## Rationale
- **Tokens out of script, with no infrastructure prerequisite.** An injected script can still call the
  API as the user while the page is open, but it cannot carry a token away: the only token in script
  is the unsigned claims copy (`SessionClaimsToken.cs:7-13`). Option B buys the same property only
  once UI and API share a registrable domain in every environment.
- **Reuse, not a second auth system.** The proxy is built on the cookie writer and the single-flight
  refresher that already served server-side rendering (`ISessionCookieStore.cs:15`,
  `CookieSessionRefresher.cs:68-73`), so there is one place a session is refreshed and one cookie
  format.
- **The right package.** MMCA.Common.UI.Web is server-only; the MMCA.Common.UI Razor class library is
  loaded by WebAssembly and MAUI heads, which cannot host a forwarder, and MMCA.Common.API is
  referenced by every service, which would carry a YARP dependency into hosts that never front a
  browser.
- **Defense in depth for CSRF.** A cookie that authenticates data calls must not be usable from
  another origin. The custom header cannot be sent cross-origin without a preflight, and the proxy
  never answers a preflight with a grant (`SameOriginApiProxyEndpoint.cs:254-263`); the origin gate
  covers what the header cannot, a WebSocket upgrade, which is not CORS-protected
  (`:135-137`). Both gates were added after an adversarial review found upgrades and preflights open
  (commit fba02c29, which reached `main` in the squash commit e9c28d15, #469).
- **A blip at the identity endpoint must not sign users out.** Treating every failed refresh as the
  end of the session cleared the cookies on a 5xx or a timeout; separating `Unavailable` from
  `Rejected` keeps a live session and tells the client when to retry
  (`SessionRefreshOutcome.cs:12-23`).
- **SameSite is a usability choice, not the CSRF control.** Because the header and origin gates carry
  CSRF, a consumer can choose `Lax` for deep links without weakening the data path; `None` stays
  impossible (`SameOriginApiProxySettingsValidator.cs:42-45`).

## Trade-offs
- **One extra hop.** Every browser API call and every hub frame passes through the UI host before the
  gateway (`SameOriginApiProxyEndpoint.cs:379-382`).
- **The UI host becomes a stateful-ish auth edge.** It owns refresh, the refresh race, the 401 replay
  and cookie rotation for browser traffic (`SameOriginApiProxyEndpoint.cs:328-344`,
  `:391-414`); a UI host outage now takes the browser's API path down with it.
- **Upload limits are the UI host's too.** Every proxied body passes through the UI host, so an
  upload larger than its server default is refused 413 there unless the host maps that path in
  `MaxRequestBodySizeByPath` (`SameOriginApiProxySettings.cs:55-76`); a consumer that raises a limit
  at the gateway or the API raises it here as well.
- **The UI host rate limiter now meters API traffic.** Its exempt prefixes are `/health`, `/alive`,
  `/_framework`, `/_content` and `/hubs`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:78`),
  and proxied hub traffic under `{PathPrefix}/hubs` (the hub at `/api/hubs/notifications`,
  `NotificationHubService.cs:103`) is exempt too (`UiRateLimitingExtensions.cs:73-76`, `:107`). Every other
  proxied `/api/**` call, a file-extension path such as `/api/report.csv` included, counts against
  the per-IP window and the concurrency ceiling of [ADR-124](124-blazor-circuit-ceiling-ui-edge.md)
  (`UiRateLimitingExtensions.cs:104-116`, the proxy-prefix carve-out at `:112-115`).
- **Ingress hosts must adopt forwarded headers or lose every POST.** The origin gate compares against
  the scheme, host and port as the app sees them (`SameOriginApiProxyEndpoint.cs:152-173`), so a host
  behind a TLS-terminating ingress must call `UseCommonUiForwardedHeaders()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/CommonForwardedHeadersExtensions.cs:24`)
  first, or every browser POST is refused (`UPGRADING.md:907-911`).
- **Registration order matters.** `AddCommonSameOriginApiProxy` must come after every
  `ITokenRefresher` and `ISessionCookieSync` registration; the boot fails otherwise
  (`SameOriginApiProxyServiceExtensions.cs:29-35`).
- **Client code that presented the browser-held token breaks.** Decoding it for claims still works;
  sending it to the gateway does not (`UPGRADING.md:912-913`), and requests a host writes by hand must
  add `X-CSRF: 1` on unsafe methods (`UPGRADING.md:906-907`).
- **Script on the page can still act as the user.** The proxy removes theft, not use: an injected
  script runs same-origin and passes both gates. Content Security Policy
  ([ADR-023](023-security-response-headers.md)) stays the control for that.

## Alternatives rejected
- **Option B: a same-site cookie sent straight to the API** (weighed 2026-10-01). Rejected because it
  needs UI and gateway under one registrable domain in every environment (DNS, certificates,
  infrastructure), a cookie-JWT path in every service, and credentialed gateway CORS. Revisit if
  production puts UI and API under one parent domain for other reasons.
- **Stopping at the C+ hybrid** (weighed 2026-10-01). Rejected because the access token stays in
  script for its lifetime, so theft is shortened rather than removed. C+ was the interim step, not the
  target.
- **A server-side session store** (rejected 2026-10-01). Holding tokens in a store keyed by an opaque
  session id would make every UI host depend on a stateful store and its availability; the existing
  HttpOnly cookie already keeps the tokens out of script, so the proxy stays stateless. Revisit if
  token size outgrows a cookie or server-side revocation of a browser session becomes a requirement.
- **Hosting the proxy in MMCA.Common.UI or MMCA.Common.API** (rejected 2026-10-01). The Razor class
  library is loaded by WebAssembly and MAUI heads, and the API package by every service, which would
  push YARP into hosts that front no browser.
- **`SameSite` or an antiforgery token as the CSRF control** (rejected 2026-10-01). `SameSite=Lax`
  must remain available for deep links, and the API client is not a form post; the fixed header plus
  the origin gate cover both fetches and WebSocket upgrades.
- **Forwarding `OPTIONS` to the gateway** (rejected 2026-10-01, after review). The gateway's CORS
  policy would then decide whether `X-CSRF` may be sent cross-origin to the proxy
  (`SameOriginApiProxyEndpoint.cs:254-255`).
- **Proxying MAUI too** (rejected 2026-10-01). A native head has no DOM and no script-injection
  surface, keeps tokens in OS SecureStorage, and would only gain a hop.

## Consequences
- **Adoption, per Blazor Web host.** Register after the session-cookie and token registrations, map
  next to the session-cookie endpoints after `UseAuthorization`, configure the section only where a
  default does not fit, and call `UseCommonUiForwardedHeaders()` first behind an ingress
  (`UPGRADING.md:887-918`).
- **The gateway URL stays configured.** `ApiEndpoint` keeps the gateway address for full-page
  navigations that must reach the gateway itself, such as the external sign-in challenge
  (`ApiSettings.cs:25-31`).
- **What to watch.** UI host 429s and concurrency rejections on `/api/**` after a consumer opts in
  (the limiter above now sees API traffic; proxied hub traffic stays exempt), 503
  `session_refresh_unavailable` rates as a signal of identity-endpoint health (read alongside the 409
  `Auth.RefreshSuperseded` rotation races it also counts, from a second tab or another replica inside
  `RefreshSessions:ReuseGraceSeconds`), and 403 `cross_origin_rejected` spikes after an ingress
  change, which usually mean forwarded headers are missing.

## Revision (2026-10-06)
- **Release state.** MMCA.Common v1.218.0 is released (tags `v1.218.0` and `v1.218.1`), and MMCA.ADC
  adopted the proxy with 1.218.1 (ADC #236); the Status line and the SameSite bullet no longer
  describe an unreleased version or an unmerged adoption branch.
- **CSRF exemption for HTTP/2 WebSockets.** An RFC 8441 extended `CONNECT` with `:protocol websocket`
  is exempt from the `X-CSRF` header and still held to the host's own `Origin`
  (`SameOriginApiProxyEndpoint.cs:169-172`, `:251`); YARP turns it into an HTTP/1.1 GET upgrade
  upstream (`:40-48`).
- **Rate limiter and hub traffic.** Proxied hub traffic under `{PathPrefix}/hubs` is exempt from the
  UI host limiter, while non-hub proxied paths count even with a file extension
  (`UiRateLimitingExtensions.cs:51-56`, `:65-70`); the Trade-offs and Consequences text no longer
  says the hub is metered.
- Every `path:line` anchor in the live sections was re-verified against current source and moved
  where the code had moved.

## Revision (2026-10-07)
Re-verified against current source. The proxy's own code, its gates and its settings are unchanged.
MMCA.Common v1.233.0 (#520, commit b222df4f) changed the hub transport, and it added
`RefreshSessionSettings.ReuseGraceSeconds` (section `RefreshSessions`, default 10,
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:12`, `:98`) with a new
identity-endpoint answer, 409 `Auth.RefreshSuperseded` for a rotation inside that window
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:276-280`, `:330`,
`:438`). The proxy's unchanged `ClassifyFailure` routes that answer to `Unavailable`, a 503 with
`Retry-After` (`CookieSessionRefresher.cs:122-125`, `:195-197`), so the refresh behavior the browser
sees changed, and the hub, refresh and What-to-watch text moved.

1. **The proxied hub sends no CSRF header.** The Decision bullet no longer says the hub connects with
   the `X-CSRF` header: it connects with no token and no extra header
   (`NotificationHubService.cs:518-521`, `:540-543`), and the proxy lets the upgrade through because a
   GET upgrade is a safe method and an HTTP/2 extended `CONNECT` is exempt
   (`SameOriginApiProxyEndpoint.cs:251`), both held to the host's own `Origin` (`:175-188`).
2. **WebSocket-only hub transport.** Both modes skip negotiation and use WebSockets only, with no
   Server-Sent Events or long-polling fallback (`NotificationHubService.cs:537-538`). Off the browser,
   the direct connection's socket factory sets the stored bearer on the upgrade
   (`NotificationHubService.cs:547-550`, `:590-594`); the Context paragraph now says so.
3. **`Unavailable` covers every non-refusal status.** The Decision bullet now names 408, a misrouted
   404 and 409 `Auth.RefreshSuperseded` inside `RefreshSessions:ReuseGraceSeconds` alongside 5xx and
   429 (`CookieSessionRefresher.cs:113-125`).
4. **Implementing commits.** 4cfb4a35, b542dde1 and fba02c29 are on the feature branch only; the work
   reached `main` as the squash commit e9c28d15 (#469), contained in tag `v1.218.0`. The Rationale
   citation now names it.
5. Anchors re-verified against current source: `NotificationHubService.cs:528` -> `:545`;
   `NotificationHubService.cs:97` -> `:100-102` (Decision and Trade-offs); `:522-526` -> `:540-543`;
   `CookieSessionRefresher.cs:119-121` -> `:122-125`. The other live anchors still hold.

## Revision (2026-10-21)
Re-verified against current source. The gates, their order, the refresh outcomes, the claims-only
browser token, the WebAssembly switch and the release provenance are unchanged. MMCA.Common v1.237.0
(#541, commit 87758096) added a seventh setting and moved most anchors in the endpoint and settings
files; the session cookie lifetime is no longer a fixed 7 days.

1. **`MaxRequestBodySizeByPath`.** A new setting maps gateway-relative paths to request body limits
   in bytes (case-insensitive, whole-segment prefix, longest key wins, replacing Kestrel's
   30,000,000-byte default;
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:55-76`).
   The endpoint applies it after the gates and before the session step
   (`SameOriginApiProxyEndpoint.cs:86-87`, `:344-367`). The Settings bullet, the pipeline list (new
   step 4), the SameSite bullet (MMCA.ADC raises `SessionAssets/file`,
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:71-73`) and the Trade-offs now say so.
2. **Validator.** Besides the prefix, gateway and `SameSite` checks
   (`SameOriginApiProxySettingsValidator.cs:28-45`), it refuses a malformed `RefreshPath`,
   `RevokePath` or additional token-issuing path (`:47-51`) and an invalid
   `MaxRequestBodySizeByPath` key or non-positive limit (`:53-66`).
3. **Status-code pages disabled.** The endpoint turns the host's status-code pages off for the
   request before the gates, so a proxied empty-bodied 401 or 404 is not re-executed as an HTML page
   (`SameOriginApiProxyEndpoint.cs:72-77`); the pipeline lead now says so.
4. **Local refresh answer.** The refresh-path answer carries the claims-only `accessToken`, an empty
   `refreshToken` and `accessTokenExpiry` (`SameOriginApiProxyEndpoint.cs:404-411`); the Decision
   bullet names those fields instead of calling it the same shape as a forwarded sign-in response.
5. **Cookie lifetime.** `SessionCookieSettings.Lifetime` defaults to `Jwt:RefreshTokenExpirationDays`
   when bound and otherwise 7 days
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieSettings.cs:31-38`,
   `SessionCookieJar.cs:35-47`); the Context paragraph no longer says 7-day.
6. **Gates.** `SameOriginApiProxyBodySizeTests` (`SameOriginApiProxyBodySizeTests.cs:40`) and
   `SessionHandoffServicesTests` (`SessionHandoffServicesTests.cs:14`) join the listed gate classes.
7. Anchors re-verified against current source: `AuthDelegatingHandler.cs:14` -> `:15`;
   `CookieSessionRefresher.cs:67-71`, `:87` -> `:68-73`, `:88`; `:122-125` -> `:123-126`;
   `:113-121` -> `:114-122`; `SameOriginApiProxySettings.cs:21`, `:24`, `:31`, `:38`, `:46`, `:52`,
   `:59`, `:66`, `:74`, `:68-74` -> `:22`, `:25`, `:32`, `:39`, `:47`, `:53`, `:83`, `:90`, `:98`,
   `:92-98`; `SameOriginApiProxySettingsValidator.cs:26-43`, `:40-43` -> `:28-45`, `:42-45`;
   `SameOriginApiProxyEndpoint.cs:71`, `:232-259` -> `:79`, `:241-272`; `:115-207` -> `:128-220`;
   `:146-160` and `:139-160` -> `:152-173`; `:234-239` -> `:247-252`; `:241-248` -> `:254-261`;
   `:241-242` -> `:254-255`; `:110-113`, `:250-256` -> `:123-126`, `:263-269`; `:169-172`, `:251` ->
   `:175-185`, `:264`; `:175-188` -> `:193-201`; `:122-124` -> `:135-137`; `:85-96` -> `:96-109`;
   `:339-349` -> `:377-387`; `:339-342` -> `:377-380`; `:98-104`, `:213-217`, `:313-329` ->
   `:111-117`, `:226-230`, `:326-342`; `:76-81`, `:291-301`, `:351-374` -> `:89-94`, `:300-324`,
   `:389-412`; `:268-285` -> `:281-298`; `DependencyInjection.cs:136`, `:153-154`, `:117-121` ->
   `:144`, `:161-162`, `:125-129`; `appsettings.json:60-65` -> `:60-74`; `UPGRADING.md:243-274`,
   `:261-263`, `:264-267`, `:268-269` -> `:659-690`, `:677-679`, `:679-683`, `:684-685` (the Status
   paragraph's `UPGRADING.md:274` is now `:690`). The other live anchors still hold.

## Revision (2026-10-26)
Re-verified against current source. The gates, their order, the refresh outcomes, the claims-only
browser token, the hub transport, the rate-limiter exemptions and the proxy settings are unchanged.
MMCA.Common #587 (commit 51c321fe) rewrote the comment above the `OPTIONS` answer, shifting the endpoint
anchors after it by two; #588 (commit e450a762) changed the session cookie's `Secure` flag; #590
(commit 622633f3) moved the rate-limiter anchors; #612 (commit 1c481e69) moved the hub anchors; and the
release notes added since, through v1.261.0 (#613), moved the `UPGRADING.md` anchors.

1. **`OPTIONS` and the gateway's CORS policy.** `OPTIONS` is still answered locally with 204 and
   never forwarded, so no preflight reaches the gateway (`SameOriginApiProxyEndpoint.cs:254-263`). A
   request that clears the remaining steps and is forwarded keeps the browser's `Origin`, because the
   transformer starts from YARP's default header copy and never removes `Origin`
   (`SameOriginProxyTransformer.cs:53`); it replaces or nulls `Authorization`, removes `X-CSRF` and
   strips the session cookies (`:60-62`). So the gateway's CORS middleware still sees those requests.
   Decision step 2 and the ADR-082 entry in Related no longer say the gateway's CORS policy is never
   consulted.
2. **Adoption pointer.** The `UPGRADING.md` opt-in steps sit at `:887-918`. Step 3 there
   (`:898-901`) lists the settings a host may configure without `MaxRequestBodySizeByPath`; the
   Settings bullet above remains the reference for that seventh setting.
3. **Session cookie `Secure` flag.** The cookie is `Secure` outside Development and, in Development,
   on any HTTPS request, so only a plain `http://localhost` run goes without it
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieJar.cs:68`,
   `ISessionCookieStore.cs:9`); the Context paragraph now says so.
4. Anchors re-verified against current source: `SameOriginApiProxyEndpoint.cs:241-272` ->
   `:241-274`; `:254-261` -> `:254-263`; `:263-269`, `:264` -> `:265-271`, `:266`; `:344-367` ->
   `:346-369`; `:377-387`, `:377-380` -> `:379-389`, `:379-382`; `:326-342` -> `:328-344`;
   `:300-324` -> `:302-326`; `:389-412` -> `:391-414`; `:281-298` -> `:283-300`;
   `ISessionCookieStore.cs:14`, `:20`, `:24` -> `:15`, `:21`, `:25`;
   `NotificationHubService.cs:545` -> `:546`; `:547-550`, `:590-594` -> `:548-551`, `:591-595`;
   `:100-102` -> `:100-101` (endpoint selection) and `:103` (the `/hubs/notifications` URL);
   `:518-521`, `:540-543`, `:537-538` -> `:519-522`, `:541-544`, `:538-539`;
   `UiRateLimitingExtensions.cs:56` -> `:78`; `:51-54` -> `:73-76`, `:107`; `:65-70` ->
   `:104-116` (carve-out `:112-115`); `UPGRADING.md:274` -> `:918`; `:659-690` -> `:887-918`;
   `:677-679`, `:679-683`, `:684-685` -> `:906-907`, `:907-911`, `:912-913`. Anchors inside the
   dated revisions above stay as written. The other live anchors still hold.

## Related
[ADR-022](022-browser-session-cookie-auth.md) (the HttpOnly session cookie the proxy reads),
[ADR-051](051-client-auth-token-lifecycle.md) (client token lifecycle across render modes),
[ADR-023](023-security-response-headers.md) (security headers and the CSP),
[ADR-082](082-two-tier-cors-posture.md) (the gateway CORS posture, which never sees a proxied preflight
but still sees the browser's `Origin` on every forwarded request),
[ADR-088](088-gateway-edge-responsibilities.md) and
[ADR-089](089-gateway-topology-owned-by-configuration.md) (the gateway behind the proxy),
[ADR-124](124-blazor-circuit-ceiling-ui-edge.md) (the UI host as its own hardened edge),
[ADR-070](070-fail-fast-configuration-contract.md) (startup validation of the proxy settings).
Framework version and package figures live in `MMCA.Common/FACTS.md`.
