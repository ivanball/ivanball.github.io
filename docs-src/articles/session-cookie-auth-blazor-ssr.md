# Browser session-cookie auth for Blazor SSR: surviving the F5

> Series: MMCA.Common · Article #25 (deep-dive) · Pillar P2/P4 · Groups G08, G15 · Rubric §11, §26 · ADR-022, ADR-069, ADR-131, ADR-139 ·
> Status: grounded in `Website/docs-src/adr/022-browser-session-cookie-auth.md`,
> `Website/docs-src/adr/069-shared-data-protection-key-ring.md`,
> `Website/docs-src/adr/131-same-origin-api-proxy.md`, `Website/docs-src/adr/139-passkeys-webauthn-opt-in-sign-in.md`,
> the `MMCA.Common.API/SessionCookies`
> source, the `MMCA.Common.UI.Web/SameOriginProxy` source, the `MMCA.Common.Azure.Startup` DataProtection
> extension and the `MMCA.Common.Aspire` startup tripwire, the `MMCA.Common.UI` auth companion, and both
> apps' Web UI hosts.
> No em dashes.

**Subtitle:** Your Blazor app authenticates with a bearer token. Then a user presses F5 on an
`[Authorize]` page and gets bounced to the login screen even though they are signed in. The fix is an
HttpOnly cookie and a server-side reader, without that reader ever becoming the security boundary.

---

You build a Blazor Web App, you wire up JWT auth against your API, and it works. Login returns an access
token and a refresh token, the interactive client holds the access token, and every API call carries it
as a bearer header. You click around the app, protected pages render, the demo is clean.

Then someone presses F5 on a protected page. Or pastes a deep link into a new tab. Or just refreshes after
lunch. The page is decorated `[Authorize]`, and it bounces them to `/login`, even though they are very much
still logged in.

Here is what happened. A Blazor Web App renders in two phases: a server-side (SSR) prerender pass runs on
that first request, and only afterward does the interactive phase (Blazor Server or WebAssembly) take over.
On a fresh GET, there is no interactive client yet, and the browser issues a plain navigation with **no
`Authorization` header**. So at prerender time, `[Authorize]` sees an anonymous request and redirects. The
access token sitting in the client's memory, or in `localStorage`, is no help: SSR runs on the server and
cannot read either. And you do not *want* the refresh token in `localStorage` anyway, because anything a
script can read, an XSS payload can exfiltrate.

## Why it matters

This is the gap between "the user has a valid session" and "the server rendering the first paint can see
it." A pure bearer-header design has nowhere to put the session that the SSR pass can read. So the choices
look like: redirect every fresh GET to a round-trip through login (ugly and wrong, they are logged in), or
store the token somewhere the server can read it.

The somewhere has to satisfy three constraints at once. The SSR pass must be able to read the user's
identity to render `[Authorize]` pages. The refresh token must stay unreadable to JavaScript, because it is
the long-lived credential. And none of this can become a second, weaker place to validate auth, because you
already have one validation boundary (the API) and a second one is a second thing to get wrong.

The answer is an HttpOnly cookie for transport, a non-validating SSR reader for prerender, and a strict rule
that the cookie reader is for rendering only. The API stays the boundary.

## The MMCA answer: HttpOnly cookies plus an SSR-time reader

The mechanism ships in `MMCA.Common.API` (a `SessionCookies/` folder) with a `MMCA.Common.UI` companion
and a same-origin API proxy in `MMCA.Common.UI.Web`, and both apps' Web UI hosts wire all of it. It has
five moving parts.

**Two HttpOnly cookies, written by the server.** `mmca_auth_access` carries the JWT and
`mmca_auth_refresh` carries the refresh token (the names are constants on `SessionCookieEndpoints`).
`SessionCookieJar` is the one writer: both cookies are HttpOnly, `Secure` outside Development, and carry
the `SameSite` mode from `SessionCookieSettings` (framework default `Lax`). Because they are HttpOnly, no
script can read either one. On a host that runs the same-origin proxy (both apps do), the UI host writes
the cookies itself: a sign-in from the WebAssembly client passes through the proxy, which moves the issued
pair into the cookies, and the Blazor Server circuit hands its tokens over as short-lived, data-protected
handoffs. The proxy treats five gateway paths as token-issuing by default (`auth/login`, `auth/register`,
`auth/oauth/exchange`, `auth/sign-in-link/redeem` and `auth/passkeys/signin`, the passkey sign-in of
ADR-139), so a passkey sign-in opens the cookie session the same way a password sign-in does. The script-facing `POST /auth/session-cookie` therefore answers 204 without writing anything on
those hosts, and logout DELETEs the cookies.

**An SSR-time scheme reads the access cookie, and deliberately does not validate its signature.**
`SessionCookieAuthenticationHandler` (scheme `"SessionCookie"`) reads `mmca_auth_access` during prerender,
parses its claims, checks expiry, and populates `HttpContext.User` so `[Authorize]` passes.

```csharp
// SessionCookieAuthenticationHandler.HandleAuthenticateAsync: read claims for prerender, no signature check.
var token = cookieTokenReader.ReadAccessToken();
if (string.IsNullOrWhiteSpace(token))
{
    return Task.FromResult(AuthenticateResult.NoResult());
}

var jwtHandler = new JwtSecurityTokenHandler();
if (!jwtHandler.CanReadToken(token))
{
    return Task.FromResult(AuthenticateResult.Fail("Session cookie is not a valid JWT."));
}

var jwt = jwtHandler.ReadJwtToken(token);          // ReadJwtToken, NOT ValidateToken: no signature check
if (jwt.ValidTo < TimeProvider.GetUtcNow().UtcDateTime)  // injectable clock, same as the rest of the auth stack
{
    return Task.FromResult(AuthenticateResult.Fail("Session cookie JWT is expired."));
}

var identity  = new ClaimsIdentity(jwt.Claims, Scheme.Name, ClaimTypes.NameIdentifier, ClaimTypes.Role);
var principal = new ClaimsPrincipal(identity);
return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
```

That missing signature check is the part that looks alarming and is actually the crux of the design. The
handler calls `ReadJwtToken` (parse) rather than `ValidateToken` (verify). It is safe for exactly one
reason: the cookie was minted by the UI host from a token the API already issued, and **every API call
still fully validates the JWT** (the cross-service JWKS story from the auth article). The SSR handler only
needs the user's claims to render the first paint; it is explicitly not the security boundary.

**The browser holds a claims copy, never a credential.** When the WebAssembly client starts, it calls
`POST /auth/session/token`, a same-origin "validate-or-refresh" endpoint, to learn who is signed in (on
the proxy hosts the Blazor Server circuit's refresher calls `POST /auth/session/handoff` instead, one of
the handoffs described below).
`CookieSessionRefresher.GetOrRefreshAsync` reads the HttpOnly refresh cookie server-side, refreshes the
access token if it has expired, writes fresh cookies back, and returns the access token and its expiry.
On a host where `SessionCookieSettings.ClaimsOnlyBrowserTokens` is set (the proxy sets it, so both apps
run this way), the endpoint does not hand that token over either: it returns `SessionClaimsToken.Create`,
the token's own payload under an `alg: none` header with an empty signature. The client can read the
user's claims and the expiry to render its auth state, and no API accepts it, because every API checks
signatures.

```csharp
// POST /auth/session/token: the refresh token never leaves the server, and a claims-only host
// never hands out the access token either.
endpoints.MapPost("/auth/session/token", async (
    HttpContext httpContext, ICookieSessionRefresher refresher,
    IOptions<SessionCookieSettings> settings, CancellationToken cancellationToken) =>
{
    if (IsCrossSite(httpContext.Request))                       // Sec-Fetch-Site CSRF guard
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    // (elided: a live view-as overlay cookie, ADR-137, is answered here before the session is read)

    var result = await refresher.GetOrRefreshAsync(httpContext, cancellationToken).ConfigureAwait(false);
    if (result is null)
    {
        return Results.Json(new { error = "no_session" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var browserToken = settings.Value.ClaimsOnlyBrowserTokens
        ? SessionClaimsToken.Create(result.Value.AccessToken) ?? string.Empty   // unsigned claims copy
        : result.Value.AccessToken;
    return Results.Json(new SessionTokenResponse(browserToken, result.Value.AccessTokenExpiry));
});
```

The response is a `SessionTokenResponse(AccessToken, AccessTokenExpiry)`, and the refresh token is never
serialized to the browser. On the UI side, `ITokenStorageService` keeps what the client holds in memory,
never in `localStorage`; on these hosts that is the claims copy.

**A same-origin proxy carries every browser API call (ADR-131).** A claims copy cannot call the API, so
the browser never calls the API directly. The WebAssembly client's API client and notification hub point
at `/api/**` on the UI host's own origin, and the UI host forwards each call to the gateway server-side
with the bearer it reads from the HttpOnly cookie. `AddCommonSameOriginApiProxy(IConfiguration)`
registers it: it sets the session cookies' `SameSite` mode from the proxy settings and turns on
claims-only browser tokens, registers YARP's forwarder, and replaces the Blazor Server circuit's
`ITokenRefresher` and `ISessionCookieSync` with handoff implementations, so the circuit keeps calling the
gateway server-to-server and trades tokens with the cookies only as protected handoffs. Before anything
is forwarded, the proxy endpoint refuses a cross-origin caller (403 `cross_origin_rejected`), requires an
`X-CSRF: 1` header on every unsafe method (403 `csrf_header_required`) except an HTTP/2 WebSocket
handshake (an extended `CONNECT`, which a browser cannot add a header to, so the same-origin `Origin`
gate carries it instead), and validates or refreshes the
session through `ICookieSessionRefresher.ValidateOrRefreshAsync`. When the identity endpoint is
unreachable it answers 503 `session_refresh_unavailable` and keeps the cookies, rather than signing the
user out over a blip. Both Web UI hosts register the proxy after their session-cookie wiring and map it
next to `MapSessionCookieEndpoints`.

**A refresh middleware closes the expiry race.** `CookieSessionRefreshMiddleware` runs *before*
`UseAuthentication` and, only on GET requests that accept HTML, refreshes the access token server-side if it
has expired but the refresh cookie is still good. So a fresh GET after the access token lapsed still renders
authenticated, because the middleware has already minted a fresh access token (read by `CookieTokenReader`
from `HttpContext.Items`) before the SSR scheme runs.

This is a backend-for-frontend (BFF) layer: the browser holds an HttpOnly session it cannot read and a
claims copy that authorizes nothing, the SSR pass authenticates from the access cookie without trusting it
as the boundary, the UI host attaches the real bearer on the way to the gateway, and the real enforcement
stays at the API.

## The CSRF tax, and how it is paid

Cookie-based auth reintroduces a concern that a pure bearer-header design does not have: a cross-site page
can cause the browser to send your cookies. The framework pays that tax with defense-in-depth rather than a
single control, at two layers. On the session endpoints, the cookies carry a `SameSite` mode (framework
default `Lax`, so they are not sent on cross-site subrequests), the `/auth/session/token` refresh endpoint
additionally rejects cross-site POSTs by checking the `Sec-Fetch-Site` header (`IsCrossSite`), and the
cookie seed and clear endpoints (`POST` and `DELETE /auth/session-cookie`) disable antiforgery deliberately
(they carry no antiforgery token and rest on the cookies' `SameSite` mode alone). On the proxied data path, the same-origin check and the `X-CSRF` header carry CSRF: a custom
header cannot be sent cross-origin without a preflight, and the proxy answers `OPTIONS` itself with no
CORS grant. That makes `SameSite` a usability choice there rather than the CSRF control. The proxy
defaults it to `Strict`; both apps choose `Lax`, so a signed-in user following a mailed deep link keeps
the session on the first server render. Overlapping checks, none of them load-bearing alone.

## Scaling out: the key ring has to be shared

One replica is a special case. Add a second and a failure appears that has nothing to do with the design
above: ASP.NET Core's DataProtection key ring lives **in memory, per process**, so every replica generates
its own keys and a payload minted by replica A cannot be decrypted by replica B. The symptom follows the
load balancer rather than the user: random sign-outs and "The antiforgery token could not be decrypted"
errors that fit no pattern.

`builder.AddAzureDataProtection()` (ADR-069, in `MMCA.Common.Azure.Startup`, which `MMCA.Common.Azure`
references and type-forwards) is the one-call answer on Azure;
`AddAwsDataProtection()` and `AddGoogleCloudDataProtection()` are its peers in the other
[vendor adapter packages](cloud-neutral-vendor-adapters.md), and a host keeps exactly one ring. Given a
`DataProtection:BlobStorageUri` it
persists the key ring to a **single Azure blob** under `DefaultAzureCredential` and sets an application
discriminator, so the cookies and antiforgery tokens minted by one replica decrypt on another. Encrypting
that key ring at rest with a Key Vault key is a **second, deliberately independent gate**
(`DataProtection:KeyVaultKeyUri`): the correctness fix has to work *without* the Key Vault Crypto User
role, because that role assignment is granted out of band and can lag a deployment, and folding the two
into one switch would turn an optional hardening gap into a total authentication outage. Both consumer
templates ship that second gate with its parameter defaulting to off, and the deployed value of that
parameter is not readable from the repositories, so the record states what ships rather than what is
switched on: on default parameters the ring is protected by a private container and a narrow account grant
instead of by a Key Vault key. ADR-069 keeps that as a named trade-off rather than hiding it.

Absent configuration is a **no-op**: with no blob URI the method returns before it registers anything,
not even the `HostIntegrationMarker` (the receipt the startup tripwire checks), so a URI that only arrives
from a configuration source added after the call still trips the startup check. A developer machine, a test host and the Helpdesk seed all run
single-process, keep the in-memory default, and take no Azure dependency at startup.

Adoption is per host, and the shape of it is worth saying plainly. MMCA.ADC calls it on exactly the two
hosts that mint those payloads, its Identity service and its Web UI host. MMCA.Store calls it on three:
its Web UI host, its Identity service and its Sales service, each persisting to its own blob in a storage
account provisioned for this and nothing else, with one extra catch on the infrastructure side: the blob
URI is injected only when a `dataProtectionStorageReady` parameter is true (it defaults to false), because
`AddAzureDataProtection` gates on the *presence* of the URI and never on its reachability, so wiring the
URI before the blob role assignment exists would fail the first protect call rather than degrade. That flag
is true in production today, and each of those three container apps scales to two replicas (minimum one,
maximum two).

## Trade-offs, honestly

The pattern fixes a real gap, and the §26 review names what it costs.

- **A non-validating auth scheme exists in your codebase.** `SessionCookieAuthenticationHandler` trusts a
  cookie it does not cryptographically verify. That is sound only because the cookie is HttpOnly and
  host-minted and the API independently validates every call. Authorize a sensitive action on the SSR
  principal *without* an API round-trip and you have broken the safety argument. The rule "the API is the
  boundary" is not a nicety here, it is the whole proof.
- **The UI host becomes part of the API path.** Every browser API call and hub frame passes through the UI
  host before the gateway, which is one extra hop, and the UI host owns refresh, the refresh race and
  cookie rotation for browser traffic. A UI host outage takes the browser's API path down with it, and the
  UI host's rate limiter meters API traffic as well as pages.
- **The proxy removes theft, not use.** An injected script runs same-origin and passes both proxy gates,
  so it can still act as the user while the page is open; it just cannot carry a token away. Content
  Security Policy stays the control for that.
- **CSRF surface a header-only design would not have.** `SameSite` on the session endpoints plus a
  `Sec-Fetch-Site` check on the token endpoint, and an origin gate plus `X-CSRF` on the proxy, is solid,
  but it is a surface, and
  a reviewer has to understand both layers to trust it.
- **Expiry is checked, not cryptographically enforced, at the SSR edge.** A tampered cookie produces claims
  that fail at the API on the next call, but the one prerendered HTML pass is produced from unverified
  claims. For rendering, that is acceptable; for a decision, it is not, which loops back to the first point.
- **Scaling out adds a shared-state dependency.** A cookie session is only as portable as the key ring
  behind it, so a multi-replica host has to persist that ring where every replica can read it (ADR-069):
  one more piece of infrastructure and one more credential that has to resolve at startup. It is also
  opt-in per host, so adoption has to be audited. A host that sets `DataProtection:BlobStorageUri` but
  never makes the call fails at startup, because `HostIntegrationTripwire` names the missing call; a
  scaled-out host with neither the key nor the call keeps the broken per-replica default and fails
  intermittently rather than loudly.

None of these are reasons to redirect every F5 to a login round-trip. They are the reasons to keep the SSR
reader honest about what it is for.

## Apply this even without MMCA

The shape ports to any server-prerendered SPA with token auth:

1. **Put the session in an HttpOnly cookie, not `localStorage`.** The server can read a cookie during
   render; it cannot read `localStorage`. And the refresh token belongs somewhere a script cannot reach it.
2. **Let the prerender pass read claims, not verify them, and make the API the only validator.** A
   parse-don't-validate reader is safe only if a real validation boundary sits behind every state-changing
   call. Write that invariant down.
3. **Keep every credential server-side and proxy the API through the UI origin.** The browser asks a
   same-origin endpoint for its session state and gets an unsigned claims copy; its API calls go to the UI
   host, which attaches the real bearer from the HttpOnly cookie on the way to the API. The refresh token
   is exchanged on the server and never serialized to the client.
4. **Refresh before authentication on GETs.** A small middleware that mints a fresh access token before the
   auth handler runs closes the "expired between requests" gap without a client round-trip.
5. **Budget for CSRF.** Cookies bring it back. `SameSite` cookies protect the session endpoints, with a
   `Sec-Fetch-Site` check on the one that hands out session state, and a strict same-origin check plus a
   custom header protects a cookie-authenticated proxy: a defensible, layered answer.
6. **Share the key ring before you scale out.** The moment a cookie-minting host runs more than one
   replica, per-process keys become random sign-outs. Persist the ring to one shared store with an
   application discriminator, and keep encryption of the ring at rest as a separate switch so a lagging
   role assignment costs you hardening rather than login.

The takeaway: **the SSR prerender gap is real, and the fix is an HttpOnly cookie the server can read plus
the discipline that reading it is for rendering, never for deciding. Keep every credential off the client,
keep the API as the one validator, and an `[Authorize]` page survives an F5 without weakening anything.**

---

**What we covered:** why a Blazor Web App's SSR prerender pass bounces `[Authorize]` pages to login on a
fresh GET (no `Authorization` header, no server-readable token), how MMCA.Common closes the gap with two
HttpOnly cookies, a `SessionCookieAuthenticationHandler` that reads claims for prerender without validating
the signature, a server-side `/auth/session/token` refresher that hands the browser only an unsigned
claims copy, a same-origin API proxy (ADR-131) that attaches the real bearer server-side, and a pre-auth
refresh middleware, why the design is safe only because the API stays the validation
boundary, why a scaled-out cookie host also needs a shared DataProtection key ring (ADR-069, adopted by
both apps, with Store's blob URI gated behind a readiness flag), and the CSRF and dual-path costs that buys.

**Next in the series:** external OAuth login, adding Google, GitHub and Apple sign-in behind your own local
JWTs (ADR-036), where an `OAuthControllerBase` swaps a single-use, short-lived cached code for the JWT
pair so the tokens never ride the redirect URL.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-022 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-022 (browser session-cookie auth): `Website/docs-src/adr/022-browser-session-cookie-auth.md` in the docs site.

*Tags: .NET, C Sharp, Blazor, Security, Authentication*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`; ADC and Store pin 1.319.0). Prior verification history (2026-06-30 through 2026-10-29) is in this file's git history.
Changed this run: (1) the `/auth/session/token` snippet gains an elided-branch comment, because the real endpoint answers a live view-as overlay (ADR-137) between the `IsCrossSite` guard and the refresher (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:72-75` guard, `:77-85` overlay via `ViewAsOverlayCookie.TryRead`, `:87` refresher, `:94-97` claims-only branch). (2) `AddAzureDataProtection` lives in `MMCA.Common.Azure.Startup` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/AzureDataProtectionExtensions.cs:54`), type-forwarded from `MMCA.Common.Azure` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/TypeForwards.cs:8`); header Status line updated to match. (3) With no blob URI the method returns at `AzureDataProtectionExtensions.cs:64-66` BEFORE the `HostIntegrationMarker` registration at `:71` (comment `:58-63`: "No receipt either"), so "always registers a marker" was wrong. (4) Store adoption: the Web UI host (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:50`), the Identity service (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:62`) and the Sales service (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:82`) all call it; bicep injects `DataProtection__BlobStorageUri` per host behind `dataProtectionStorageReady` (`MMCA.Store/infra/main.bicep:2148-2150` identity-keys.xml, `:2468-2470` sales-keys.xml, `:2696-2697` keys.xml; parameter default false `:131`), the flag is true in production (`MMCA.Store/.github/workflows/deploy.yml:1468`), and the three apps scale min 1 / max 2 (`main.bicep:2178`, `:2487`, `:2723-2724`). (5) Added the passkey token-issuing path (approved change): `SameOriginApiProxySettings.DefaultTokenIssuingPaths` lists `auth/login`, `auth/register`, `auth/oauth/exchange`, `auth/sign-in-link/redeem`, `auth/passkeys/signin` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:33`), matched in `SameOriginApiProxyEndpoint.cs:57-59,325-327`; `PasskeysControllerBase.cs:37-38` names it; ADR-139 added to the header.
Re-confirmed unchanged this run: cookie constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:18-19`), `MapSessionCookieEndpoints` (`:23`), POST/DELETE `/auth/session-cookie` with `DisableAntiforgery` and the claims-only 204 (`:32-62`), `IsCrossSite` Sec-Fetch-Site helper (`:110-112`), `SessionCookieRequest` (`:131`); `SessionCookieJar` HttpOnly, Secure outside Development, configured SameSite (`SessionCookieJar.cs:68-70`), framework default `Lax` (`SessionCookieSettings.cs:19`), `ClaimsOnlyBrowserTokens` (`SessionCookieSettings.cs:29`); scheme `"SessionCookie"` (`SessionCookieAuthenticationHandler.cs:32`), the first code block quoted from `:37-63` (try/catch trimmed), `ReadJwtToken` not `ValidateToken` (`:51`), injected-clock expiry check (`:55`); `SessionClaimsToken.Create` (`SessionClaimsToken.cs:25`); `SessionTokenResponse(AccessToken, AccessTokenExpiry)` (`CookieSessionRefresher.cs:22`), `GetOrRefreshAsync` (`:38,89-90`) and `ValidateOrRefreshAsync` (`:48,92`); `CookieSessionRefreshMiddleware` GET + `text/html` gate (`CookieSessionRefreshMiddleware.cs:29-31`), `UseCookieSessionRefresh` (`:43`); handoff path `/auth/session/handoff` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SessionHandoffEndpoints.cs:17`); `AddCommonSameOriginApiProxy(IConfiguration)` setting SameSite and claims-only tokens (`SameOriginApiProxyServiceExtensions.cs:51,72-73`); proxy default `Strict` (`SameOriginApiProxySettings.cs:116`), both apps choose `Lax` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:87`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:65`); proxy errors `cross_origin_rejected` (`SameOriginApiProxyEndpoint.cs:257`), `csrf_header_required` (`:276`), `session_refresh_unavailable` 503 (`:306`), `ValidateOrRefreshAsync` call (`:103`); key-ring gate 2 `KeyVaultKeyUri` separate from gate 1 (`AzureDataProtectionExtensions.cs:83-99`); `HostIntegrationTripwire` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`); ADC calls `AddAzureDataProtection` on its Web UI host and Identity service (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:47`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:106`). Left as stated: the Key Vault gate paragraph (the deployed value of the key-URI parameter is not readable from source).*

- Full series index: https://ivanball.github.io/writing.html
