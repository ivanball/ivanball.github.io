# ADR-022: Browser Session-Cookie Authentication for Blazor SSR

## Status
Accepted. Extended by [ADR-131](131-same-origin-api-proxy.md) (the same-origin API proxy). Revised
2026-10-06: both apps run the same-origin API proxy, so the server writes the session cookies, the
browser receives only a claims-only token, and SameSite is a configured value (Lax in both apps).
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
The apps are Blazor Web Apps: a server-rendered (SSR) prerender pass runs on the first request, then
an interactive phase (Blazor Server or WebAssembly) takes over. Authentication against the API is
JWT-based (ADR-004): login returns an access token plus a refresh token, and the gateway expects the
access token as a bearer header on API calls. (In both apps the WebAssembly client and the
notification hub now call the same-origin proxy
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:24-25`),
which attaches that bearer from the HttpOnly cookie (`SameOriginApiProxyEndpoint.cs:95`,
`SameOriginProxyTransformer.cs:60`); see ADR-131.) That leaves a gap on **fresh GET requests**
the browser issues directly: a deep link, an F5 refresh, or "open in new tab" of an `[Authorize]`
page. At SSR-prerender time there is no interactive client yet and no `Authorization` header, so
`[Authorize]` would fail and bounce the user to `/login` even though they are logged in. Storing the
JWT in `localStorage` does not help: SSR runs on the server and cannot read it, and exposing the
refresh token to JavaScript is an XSS-exfiltration risk.

## Decision
Carry the session in **HttpOnly cookies** and add an authentication scheme that reads them during SSR
prerender. The mechanism ships in `MMCA.Common.API` (`SessionCookies/`) with a `MMCA.Common.UI`
companion, and both apps' Web UI hosts wire it.

- **Two HttpOnly cookies, written by the server.** `mmca_auth_access` (the JWT) and
  `mmca_auth_refresh` (the refresh token). In the framework's default mode the browser seeds them via
  `POST /auth/session-cookie` at login and `SessionCookieJar` writes them
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:43`).
  Both apps run the same-origin proxy (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:161`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:153`), which sets
  `ClaimsOnlyBrowserTokens = true`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:73`),
  so that `POST` answers 204 without writing anything (`SessionCookieEndpoints.cs:41-46`). The cookies
  are instead written server-side: by the proxy transformer on the token-issuing paths `auth/login`,
  `auth/register` and `auth/oauth/exchange` (`SameOriginProxyTransformer.cs:141`,
  `SameOriginApiProxySettings.cs:31`) and by `POST /auth/session-cookie/handoff` for the Server circuit
  (`SessionHandoffEndpoints.cs:18`, `:55`). `DELETE /auth/session-cookie` clears them at logout
  (`SessionCookieEndpoints.cs:49-53`).
- **SameSite is a setting.** `SessionCookieSettings.SameSite` defaults to `Lax`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieSettings.cs:19`). The
  proxy replaces it with `SameOriginApiProxy:SessionCookieSameSite` (default `Strict`,
  `SameOriginApiProxySettings.cs:74`, applied at `SameOriginApiProxyServiceExtensions.cs:72`), and both
  apps configure `Lax` so a signed-in user arriving from a mailed deep link keeps the session on the
  first server render (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:63-64`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:53-54`).
- **An SSR-time scheme reads the access cookie.** `SessionCookieAuthenticationHandler` (scheme
  `"SessionCookie"`) reads `mmca_auth_access` during prerender, parses its claims
  (`SessionCookieAuthenticationHandler.cs:51`), checks expiry (`:55`), and populates
  `HttpContext.User`, so `[Authorize]` passes on fresh GETs. It **does not validate the signature**:
  the cookie was minted by the UI host from a token the API already issued, and the API still fully
  validates the JWT on every API call (ADR-004). The handler is not the security boundary. Under the
  proxy the same cookie also authenticates data calls (`SessionCookieSettings.cs:16-17`), but only by
  being forwarded as the bearer to the gateway, where the API validates it.
- **The refresh token never leaves the server.** `POST /auth/session/token`
  (`SessionCookieEndpoints.cs:60`) is a same-origin "validate-or-refresh" endpoint the browser calls to
  hydrate its **in-memory** token; `CookieSessionRefresher` reads the HttpOnly refresh cookie
  server-side, refreshes if needed, and returns a token plus expiry (`:78`). With
  `ClaimsOnlyBrowserTokens` set, as in both apps, that token is `SessionClaimsToken`, an unsigned copy
  of the claims that no API accepts, not the access token (`:74-77`). The refresh token is never
  exposed to JavaScript.
- **CSRF defense-in-depth.** The seed/clear endpoints (`POST` and `DELETE /auth/session-cookie`)
  deliberately disable antiforgery (they carry no antiforgery token, `SessionCookieEndpoints.cs:47`,
  `:53`) and rest on the cookies' `SameSite` value; the `/auth/session/token` refresh endpoint
  additionally rejects cross-site requests via the `Sec-Fetch-Site` header (`:63`, `:91-93`). Under the
  proxy, unsafe methods on `/api/**` and both handoff endpoints require the `X-CSRF: 1` header
  (`SameOriginApiProxyEndpoint.cs:251`, `SessionHandoffEndpoints.cs:26`, `:44`), which is the CSRF gate
  the apps rely on rather than SameSite.

This is a backend-for-frontend (BFF) style token-storage layer: the browser holds an HttpOnly session
whose refresh half it cannot read, the SSR pass authenticates from the access cookie without trusting
it as the security boundary, and the real enforcement stays at the API.

## Rationale
- **Fixes the fresh-GET prerender gap.** Without a server-readable session, every deep-link or F5 to
  an `[Authorize]` page would redirect to `/login` despite a valid session; the cookie scheme closes
  that without a per-page workaround.
- **HttpOnly keeps the refresh token out of JS.** Storing the refresh token where a script can read it
  (localStorage) is the classic XSS-exfiltration risk; HttpOnly cookies plus a server-side refresh
  endpoint keep it inaccessible to scripts.
- **Skipping signature validation at SSR is safe because the API is the boundary.** The SSR handler
  only needs the user's claims to render; every state-changing or data-returning call goes to the API,
  which validates the JWT properly (ADR-004), so prerender does not need to re-verify a cookie the
  host itself minted.
- **Shared in the framework.** Both apps face the identical Blazor-Web-App prerender problem, so the
  scheme, the cookie jar, the endpoints, and the refresher live in MMCA.Common rather than being
  re-derived per app.

## Trade-offs
- **A non-validating auth scheme exists.** `SessionCookieAuthenticationHandler` trusts a cookie it does
  not cryptographically verify. This is sound only because (a) the cookie is HttpOnly and host-minted
  and (b) the API independently validates every call. Authorizing a sensitive action purely on the SSR
  principal without an API round-trip would break the safety argument.
- **Cookie and header dual path.** The session lives both in cookies (browser GETs / SSR, and proxied
  data calls in both apps) and in the Blazor Server circuit's own token store (server-to-server gateway
  calls); the two must stay in sync. With the proxy on, the circuit's `ITokenRefresher` and
  `ISessionCookieSync` are replaced by `HandoffTokenRefresher` and `HandoffSessionCookieSync`
  (`SameOriginApiProxyServiceExtensions.cs:83-84`), so the sync runs through the protected handoff
  endpoints (`SessionHandoffEndpoints.cs:17-18`).
- **CSRF surface.** Cookie-based auth reintroduces CSRF considerations a pure bearer-header scheme
  avoids; mitigated by the cookies' `SameSite` value (Lax in both apps), the refresh endpoint's
  `Sec-Fetch-Site` check and, under the proxy, the `X-CSRF` header on unsafe methods, but it is a
  surface a header-only design would not have.
- **Expiry is checked, not cryptographically enforced, at the SSR edge.** A tampered cookie yields
  claims that fail at the API on the next call, but the prerendered HTML for that one pass is produced
  from unverified claims.

## Revision (2026-10-06)
- Both apps run the same-origin API proxy (ADR-131): `POST /auth/session-cookie` now answers 204
  without writing, and the cookies are written server-side by the proxy transformer and the
  `/auth/session-cookie/handoff` endpoint.
- `SameSite` is documented as a setting (default Lax, proxy default Strict, configured Lax in both
  apps); the proxy's `X-CSRF` header is the CSRF gate on unsafe proxied methods.
- `/auth/session/token` returns a claims-only `SessionClaimsToken` in both apps, not the access token;
  the refresh token is still never returned.
- The session cookie also authenticates proxied data calls (as the forwarded bearer), not only SSR;
  the Server circuit syncs through the handoff implementations.
- Status and Related now point to ADR-131. Anchors were added and re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The decision is unchanged: the server is the only writer of the
session cookies under the proxy, `POST /auth/session-cookie` answers 204 without writing, the refresh
endpoint returns a claims-only token and checks `Sec-Fetch-Site`, and both apps run the proxy. Only
line numbers moved.

1. Anchors re-verified against current source:
   `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:43`
   (`SessionCookieJar.Append`), `:41-46` (claims-only guard and 204), `:47` and `:53`
   (`DisableAntiforgery` on POST and DELETE), `:49-53` (DELETE clears the cookies), `:60`
   (`/auth/session/token`), `:63` (cross-site check), `:74-77` (`SessionClaimsToken` under
   claims-only), `:78` (token plus expiry), `:91-93` (`IsCrossSite`);
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:161` (`AddCommonSameOriginApiProxy`). The
   Context anchor for the proxy now cites
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:24-25`
   for the client and hub switch, and `SameOriginApiProxyEndpoint.cs:95` plus
   `SameOriginProxyTransformer.cs:60` for the bearer taken from the HttpOnly cookie.

## Related
ADR-004 (the JWT/JWKS validation the API performs on every call, which is why the SSR handler can skip
signature validation), ADR-008 (the gateway and topology the UI talks to), ADR-019 (rate limiting on the
auth surface), ADR-029 (the login brute-force protection this session seeds from), ADR-131 (the
same-origin API proxy that extends this cookie to authenticate data calls and makes the server its only
writer).
