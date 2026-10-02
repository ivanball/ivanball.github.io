# Browser session-cookie auth for Blazor SSR: surviving the F5

> Series: MMCA.Common · Article #25 (deep-dive) · Pillar P2/P4 · Groups G08, G15 · Rubric §11, §26 · ADR-022, ADR-069, ADR-131 ·
> Status: grounded in `Website/docs-src/adr/022-browser-session-cookie-auth.md`,
> `Website/docs-src/adr/069-shared-data-protection-key-ring.md`,
> `Website/docs-src/adr/131-same-origin-api-proxy.md`, the `MMCA.Common.API/SessionCookies`
> source, the `MMCA.Common.UI.Web/SameOriginProxy` source, the `MMCA.Common.Aspire` DataProtection
> extension, the `MMCA.Common.UI` auth companion, and both apps' Web UI hosts.
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
handoffs. The script-facing `POST /auth/session-cookie` therefore answers 204 without writing anything on
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

**The browser holds a claims copy, never a credential.** When the interactive client starts, it calls
`POST /auth/session/token`, a same-origin "validate-or-refresh" endpoint, to learn who is signed in.
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
`X-CSRF: 1` header on every unsafe method (403 `csrf_header_required`), and validates or refreshes the
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
default `Lax`, so they are not sent on cross-site subrequests), the refresh endpoint rejects cross-site
POSTs by checking the `Sec-Fetch-Site` header (`IsCrossSite`), and the cookie endpoints disable antiforgery
deliberately (they carry no antiforgery token and are guarded by `SameSite` + `Sec-Fetch-Site` + POST-only
instead). On the proxied data path, the same-origin check and the `X-CSRF` header carry CSRF: a custom
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

`AddCommonDataProtection` (ADR-069) is the one-call answer. Given a `DataProtection:BlobStorageUri` it
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

Absent configuration is a **full no-op**: with no blob URI the method returns the builder untouched and
registers no DataProtection services at all. A developer machine, a test host and the Helpdesk seed all run
single-process, keep the in-memory default, and take no Azure dependency at startup.

Adoption is per host, and the shape of it is worth saying plainly. MMCA.ADC calls it on exactly the two
hosts that mint those payloads, its Identity service and its Web UI host. MMCA.Store's Web UI host calls it as well, on a storage
account provisioned for this and nothing else, with one extra catch on the infrastructure side: the blob
URI is injected only when a `dataProtectionStorageReady` parameter is true (it defaults to false), because
`AddCommonDataProtection` gates on the *presence* of the URI and never on its reachability, so wiring the
URI before the blob role assignment exists would fail the first protect call rather than degrade. That flag
is true in production today. Store's Identity service still makes no call, and its container app also runs
two replicas.

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
- **CSRF surface a header-only design would not have.** `SameSite` plus `Sec-Fetch-Site` plus POST-only on
  the session endpoints, and an origin gate plus `X-CSRF` on the proxy, is solid, but it is a surface, and
  a reviewer has to understand both layers to trust it.
- **Expiry is checked, not cryptographically enforced, at the SSR edge.** A tampered cookie produces claims
  that fail at the API on the next call, but the one prerendered HTML pass is produced from unverified
  claims. For rendering, that is acceptable; for a decision, it is not, which loops back to the first point.
- **Scaling out adds a shared-state dependency.** A cookie session is only as portable as the key ring
  behind it, so a multi-replica host has to persist that ring where every replica can read it (ADR-069):
  one more piece of infrastructure and one more credential that has to resolve at startup. It is also
  opt-in per host, so adoption has to be audited. A scaled-out host that never makes the call keeps the
  broken per-replica default and fails intermittently rather than loudly.

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
5. **Budget for CSRF.** Cookies bring it back. `SameSite` plus a `Sec-Fetch-Site` check plus POST-only
   endpoints protects the session endpoints, and a strict same-origin check plus a custom header protects a
   cookie-authenticated proxy: a defensible, layered answer.
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

**Next in the series:** external OAuth login, adding Google and GitHub sign-in behind your own local
JWTs (ADR-036), where an `OAuthControllerBase` swaps a single-use, short-lived cached code for the JWT
pair so the tokens never ride the redirect URL.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-022 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-022 (browser session-cookie auth): `Website/docs-src/adr/022-browser-session-cookie-auth.md` in the docs site.

*Tags: .NET, C Sharp, Blazor, Security, Authentication*

*Notes: verified type/behavior names against source under `Source/Presentation/MMCA.Common.API/SessionCookies/`:
cookie name constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`),
`SessionCookieJar.Append/Delete/BuildOptions` (HttpOnly + SameSite=Lax; `SessionCookieJar.cs:11,16,23,31`),
`SessionCookieEndpoints.MapSessionCookieEndpoints` (POST/DELETE `/auth/session-cookie` + POST `/auth/session/token`;
`SessionCookieEndpoints.cs:15,20`, `SessionCookieRequest` record `:69`, `IsCrossSite` Sec-Fetch-Site `:65`),
`SessionCookieAuthenticationHandler` (scheme `"SessionCookie"`, `HandleAuthenticateAsync` uses `ReadJwtToken`
not `ValidateToken` and checks `ValidTo` against the injected clock `TimeProvider.GetUtcNow().UtcDateTime`
(`SessionCookieAuthenticationHandler.cs:55`); the no-signature-check `<remarks>` at `:18-23`; `AddSessionCookieAuthentication`
`:98`), `CookieSessionRefresher` / `ICookieSessionRefresher.GetOrRefreshAsync` (returns access token only, single-flighted;
`CookieSessionRefresher.cs:26,43,55,86,110`), `SessionTokenResult`/`SessionTokenResponse` records (`:11,17`),
`CookieTokenReader.ReadAccessToken/ReadRefreshToken` (HttpContext.Items fresh-token then cookie; `CookieTokenReader.cs:10,17,19,36`),
`CookieSessionRefreshMiddleware.InvokeAsync` (before UseAuthentication, GET + Accept text/html; `UseCookieSessionRefresh` `:14,17,42`),
`AddServerAuthSessionCookie(apiBaseAddress)` (`MMCA.Common.API/DependencyInjection.cs:141`). UI companion:
`ISessionCookieSync` (`SyncAsync`/`ClearAsync`; `MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8`),
`JsFetchSessionCookieSync` (JS `mmcaAuthCookie.set/clear`), `ITokenStorageService` (access in-memory, refresh in HttpOnly cookie;
`ITokenStorageService.cs:8`), `AddClientAuthSessionCookieSync` (`MMCA.Common.UI/DependencyInjection.cs:111`,
`TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` at `:113`). The two code
blocks are quoted from `SessionCookieAuthenticationHandler.cs:37-63` and `SessionCookieEndpoints.cs:43-58` (lightly
trimmed of try/catch and comments for length, named types unchanged). The "API is the boundary" framing and the §26
scoring (impl 8, the deliberately-partial default CSP noted in the security-headers work) are from `Website/docs-src/governance/common-ArchitectureScorecard.md` §26 (`:86`).
2026-06-30: re-verified the two DI declarations against current source. `AddServerAuthSessionCookie(string apiBaseAddress)`
is now `MMCA.Common.API/DependencyInjection.cs:141` and `AddClientAuthSessionCookieSync()` is now
`MMCA.Common.UI/DependencyInjection.cs:100` (citations updated from the prior :107 / :71); the prose mechanism claims are unchanged.
2026-07-04: re-verified against current source. `AddClientAuthSessionCookieSync()` moved to
`MMCA.Common.UI/DependencyInjection.cs:100` (line 86 is now the `IUserPreferenceReader` registration), and §26
Front-End Security Implementation was recalibrated 9 to 8 in the thirteenth wave (Maturity holds at 4;
`Website/docs-src/governance/common-ArchitectureScorecard.md:74`).
2026-07-06: re-grounded every named type/behavior against current source. The SSR expiry check now reads the
injected clock: `if (jwt.ValidTo < TimeProvider.GetUtcNow().UtcDateTime)` (was `DateTime.UtcNow`) at
`SessionCookieAuthenticationHandler.cs:55` (behavior unchanged: still `ReadJwtToken`, no signature check). The
quoted snippet in body + `.medium.md` was updated to match. Corrected two shifted anchors: `AddSessionCookieAuthentication`
`:95`→`:98` and §26 Front-End Security `Website/docs-src/governance/common-ArchitectureScorecard.md:74`→`:76` (Maturity 4 / Implementation 8, unchanged
substance). Re-verified unchanged: cookie constants `mmca_auth_access`/`mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`),
HttpOnly + `SameSite=Lax` (`SessionCookieJar.cs:32,34`), `IsCrossSite` Sec-Fetch-Site guard (`SessionCookieEndpoints.cs:65`),
`/auth/session/token` refresher returning access-token-only (`CookieSessionRefresher.cs:55,83`), `SessionTokenResponse`
(`:17`), `CookieSessionRefreshMiddleware` before `UseAuthentication`, GET + `text/html` (`CookieSessionRefreshMiddleware.cs:17,29-32`),
`CookieTokenReader` HttpContext.Items-then-cookie (`CookieTokenReader.cs:19,27-33`), `AddServerAuthSessionCookie(apiBaseAddress)`
(`MMCA.Common.API/DependencyInjection.cs:141`), UI `ISessionCookieSync` (`:8`)/`ITokenStorageService` in-memory-access-refresh-in-cookie
(`ITokenStorageService.cs:6,8`)/`AddClientAuthSessionCookieSync` (`MMCA.Common.UI/DependencyInjection.cs:100,102`).
2026-07-10: corrected a further-shifted anchor. §26 Front-End Security scoring (Maturity 4, Implementation 8, unchanged
substance) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:78` (was `:76`; the row shifted after intervening category edits, line 76
is now §24 Forms, Validation and UX Safety).
2026-07-15: re-verified against current source and corrected shifted anchors (values unchanged). `AddClientAuthSessionCookieSync()` is now
`MMCA.Common.UI/DependencyInjection.cs:105` and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` is at `:107` (were `:100`/`:102`;
`:100` is now the `AddClientAuthSessionCookieSync` XML-doc summary). §26 Front-End Security scoring (Maturity 4, Implementation 8, unchanged
substance) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:84` (was `:82`; the §26 Front-End Security row shifted down after an intervening §27 Internationalization content expansion).
2026-07-21: re-verified against current source (framework v1.121.0). ADR-022 is centralized to the Website repo at `Website/docs-src/adr/022-browser-session-cookie-auth.md` (the former `MMCA.Common/ADRs/` directory no longer exists; published at https://ivanball.github.io/docs/), and the body/CTA already point there. §26 Front-End Security scoring (Maturity 4 / Implementation 8, unchanged substance) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:86` (was `:84`; the row shifted +2 after the twenty-first-wave insertion block). MMCA.Common two-axis index now Maturity 96.9% (314/324) / Implementation 84.6% (685/810) at `common-ArchitectureScorecard.md:100-101`.
2026-07-23: re-verified against current source (framework v1.124.0) and corrected four shifted anchors (all behavior/values unchanged). HttpOnly + `SameSite=Lax` are now `SessionCookieJar.cs:33,35` (were `:32,34`). `IsCrossSite` Sec-Fetch-Site guard is now `SessionCookieEndpoints.cs:68` and the `SessionCookieRequest` record is now `:72` (were `:65`/`:69`). §26 Front-End Security scoring (Maturity 4 / Implementation 8, unchanged substance) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:88` (was `:86`; the row shifted +2 after the twenty-second-wave re-score pass). The MMCA.Common two-axis index is unchanged (Maturity 96.9% = 314/324, Implementation 84.6% = 685/810, steady state through the twenty-second wave, 2026-07-23, no score moves) and is now at `common-ArchitectureScorecard.md:102-103` (was `:100-101`).
2026-07-25: re-verified every named type and behavior against current source (framework v1.128.0, `MMCA.Common/FACTS.md:14`; 15 published packages, `FACTS.md:19`) and corrected two shifted scorecard anchors; no prose claim changed. Re-confirmed unchanged in source: cookie constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`), `MapSessionCookieEndpoints` (`:22`) mapping POST/DELETE `/auth/session-cookie` (`:29,35`, both `DisableAntiforgery()`) and POST `/auth/session/token` (`:45`), the `IsCrossSite` Sec-Fetch-Site guard (`:68`) and the `SessionCookieRequest` record (`:72`); `SessionCookieJar.Append`/`Delete` (`SessionCookieJar.cs:16,23`) writing `HttpOnly = true` (`:33`) and `SameSite = SameSiteMode.Lax` (`:35`) from `BuildOptions` (`:31`); `SessionCookieAuthenticationHandler` scheme `"SessionCookie"` (`:32`), `HandleAuthenticateAsync` still parsing with `ReadJwtToken` and not `ValidateToken` (`:51`) and comparing `jwt.ValidTo` to `TimeProvider.GetUtcNow().UtcDateTime` (`:55`), the no-signature-check `<remarks>` (`:18-23`), `AddSessionCookieAuthentication` (`:98`); `ICookieSessionRefresher.GetOrRefreshAsync` (`CookieSessionRefresher.cs:33`, implementation `:55`, single-flighted through `RefreshAsync` `:86` and `CallRefreshAsync` `:110`, access-token-only return `:83`) with `SessionTokenResult` / `SessionTokenResponse` (`:11,17`); `CookieTokenReader.ReadAccessToken` reading `HttpContext.Items` first then the cookie (`CookieTokenReader.cs:19,27-33`, `FreshAccessTokenItemKey` `:17`, `ReadRefreshToken` `:36`); `CookieSessionRefreshMiddleware.InvokeAsync` running before `UseAuthentication` and gated to GET + `Accept: text/html` (`CookieSessionRefreshMiddleware.cs:16,28-31`; `UseCookieSessionRefresh` is now `:43`, was `:42`); `AddServerAuthSessionCookie(apiBaseAddress)` (`MMCA.Common.API/DependencyInjection.cs:141`); UI companion `ISessionCookieSync` (`SyncAsync`/`ClearAsync`, `ISessionCookieSync.cs:8,10,12`), `ITokenStorageService` (access token in memory, refresh token in an HttpOnly cookie, never localStorage; `ITokenStorageService.cs:4-6,8`), `AddClientAuthSessionCookieSync` (`MMCA.Common.UI/DependencyInjection.cs:105`) and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` (`:107`). Corrected anchors (values and substance unchanged): §26 Front-End Security (Maturity 4 / Implementation 8) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:90` (was `:88`; the row shifted +2 after the twenty-third-wave re-score, and line 88 is now §24 Forms, Validation & UX Safety), and the MMCA.Common two-axis index is now `common-ArchitectureScorecard.md:104` (Maturity 96.9% = 314/324) and `:105` (Implementation 84.6% = 685/810), with the "N/A (excluded from denominators): none" bullet at `:107`; the twenty-third-wave full re-score (2026-07-25) again moved no scores, so both indices hold at their prior values. The ADR corpus is now fifty-five ADRs, range 001-055 (`Website/docs-src/adr/README.md:62`); ADR-022 (the pattern behind this article) and ADR-036 (the external-OAuth teaser) both still exist and still match the body.
2026-07-28: re-verified every named type and behavior against current source (framework v1.131.0, `MMCA.Common/FACTS.md:14`; 15 published packages, `FACTS.md:19`) and corrected the second code block's anchor plus four shifted scorecard anchors; no prose claim changed. Re-confirmed unchanged in source: cookie constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`), `MapSessionCookieEndpoints` (`:22`) mapping POST/DELETE `/auth/session-cookie` (`:29,35`, both `DisableAntiforgery()`) and POST `/auth/session/token` (`:45`), the `IsCrossSite` Sec-Fetch-Site guard (`:68`) and the `SessionCookieRequest` record (`:72`); `SessionCookieJar.Append`/`Delete` (`SessionCookieJar.cs:16,23`) writing `HttpOnly = true` (`:33`) and `SameSite = SameSiteMode.Lax` (`:35`) from `BuildOptions` (`:31`); `SessionCookieAuthenticationHandler` scheme `"SessionCookie"` (`:32`), `HandleAuthenticateAsync` (`:35`) still parsing with `ReadJwtToken` and not `ValidateToken` (`:51`) and comparing `jwt.ValidTo` to `TimeProvider.GetUtcNow().UtcDateTime` (`:55`), the no-signature-check `<remarks>` (`:18-23`), `AddSessionCookieAuthentication` (`:98`); `ICookieSessionRefresher.GetOrRefreshAsync` (`CookieSessionRefresher.cs:33`, implementation `:55`, single-flighted through `RefreshAsync` `:86` and `CallRefreshAsync` `:110`, access-token-only return `:83`) with `SessionTokenResult` / `SessionTokenResponse` (`:11,17`); `CookieTokenReader.ReadAccessToken` reading `HttpContext.Items` first then the cookie (`CookieTokenReader.cs:19,27-33`, `FreshAccessTokenItemKey` `:17`, `ReadRefreshToken` `:36`); `CookieSessionRefreshMiddleware.InvokeAsync` running before `UseAuthentication` and gated to GET + `Accept: text/html` (`CookieSessionRefreshMiddleware.cs:16,28-31`, `UseCookieSessionRefresh` `:43`); `AddServerAuthSessionCookie(apiBaseAddress)` (`MMCA.Common.API/DependencyInjection.cs:141`); UI companion `ISessionCookieSync` (`SyncAsync`/`ClearAsync`, `ISessionCookieSync.cs:8,10,12`), `ITokenStorageService` (access token in memory, refresh token in an HttpOnly cookie, never localStorage; `ITokenStorageService.cs:5-6,8`), `JsFetchSessionCookieSync` mirroring the client's tokens through the JS shim `mmcaAuthCookie.set` / `mmcaAuthCookie.clear` (`JsFetchSessionCookieSync.cs:11,20,32`), `AddClientAuthSessionCookieSync` (`MMCA.Common.UI/DependencyInjection.cs:105`) and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` (`:107`); both apps' Web UI hosts still wire the whole mechanism (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:58,61,128,147` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:85,88,154,170`). Corrected anchors (quoted code, values and substance unchanged): the `/auth/session/token` block is quoted from `SessionCookieEndpoints.cs:45-57` (was `:43-58`; the explanatory comments now at `:41-44` pushed the `MapPost` down, and the trailing `.ExcludeFromDescription()`/`.AllowAnonymous()`/`.DisableAntiforgery()` chain at `:58-60` stays trimmed out of the quote), while the handler block still matches `SessionCookieAuthenticationHandler.cs:37-63`; §26 Front-End Security (Maturity 4 / Implementation 8) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:92` (was `:90`; the row shifted +2 after the twenty-fourth-wave re-score, and line 90 is now §24 Forms, Validation & UX Safety); the MMCA.Common two-axis index is now `common-ArchitectureScorecard.md:106` (Maturity 96.9% = 314/324) and `:107` (Implementation 84.6% = 685/810), with the "N/A (excluded from denominators): none" bullet at `:110`; the twenty-fourth-wave full re-score (2026-07-28, pinned at v1.131.0) moved no scores, the fourth consecutive cycle at these indices. The ADR corpus is now sixty ADRs, range 001-060 (last row `Website/docs-src/adr/README.md:67`); ADR-022 (the pattern behind this article, `Website/docs-src/adr/022-browser-session-cookie-auth.md:17-43`) and ADR-036 (the external-OAuth teaser, `Website/docs-src/adr/036-external-oauth-login.md`) both still exist and still match the body.
2026-08-01: re-verified and corrected six drifted claims (framework v1.135.0, `MMCA.Common/FACTS.md:14`; was v1.131.0). `AddClientAuthSessionCookieSync()` and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` shifted +6 lines, content unchanged, to `MMCA.Common.UI/DependencyInjection.cs:111` and `:113` (were `:105`/`:107`). The Store wiring citation was stale: `:85` and `:88` are now comment lines, not call sites; `AddServerAuthSessionCookie`/`AddClientAuthSessionCookieSync` are now at `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:91`/`:92`; `:154` is now a blank line and `:170` is an unrelated `/client-config` fallback comment; `UseCookieSessionRefresh()` is now at `:160` and `MapSessionCookieEndpoints()` is at `:176` (was the single citation `:85,88,154,170`); the MMCA.ADC citation was not re-checked this run. §26 Front-End Security scoring (Maturity 4 / Implementation 8, unchanged substance) is now `Website/docs-src/governance/common-ArchitectureScorecard.md:94` (was `:92`; row shifted +2). The MMCA.Common two-axis index is now `common-ArchitectureScorecard.md:108` (Maturity unchanged at 96.9% = 314/324) and `:109` (Implementation MOVED to 84.8% = 687/810: the twenty-fifth wave, 2026-08-01, recalibrated §10 Implementation 8 to 9, the first score move after four consecutive no-move cycles), with the "N/A (excluded from denominators): none" bullet now at `:112`. The ADR corpus is now sixty-four ADRs, range 001-064 (last row [064] deploy-recency-gates, `Website/docs-src/adr/README.md:71`; was sixty ADRs, range 001-060); ADR-022 and ADR-036 both still exist and still match the body.
2026-08-07: re-verified every named type and behavior against current source (framework v1.142.0, `MMCA.Common/FACTS.md:4,14`; 15 published packages, `FACTS.md:19`), corrected six shifted anchors, and added the ADR-069 shared DataProtection key-ring section. Re-confirmed unchanged in source: cookie constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`), `MapSessionCookieEndpoints` (`:22`) mapping POST/DELETE `/auth/session-cookie` (`:29,35`, both `DisableAntiforgery()`) and POST `/auth/session/token` (`:45`), the `IsCrossSite` Sec-Fetch-Site guard (`:68`) and the `SessionCookieRequest` record (`:72`); `SessionCookieJar.Append`/`Delete` (`SessionCookieJar.cs:16,23`) writing `HttpOnly = true` (`:33`) and `SameSite = SameSiteMode.Lax` (`:35`) from `BuildOptions` (`:31`); `SessionCookieAuthenticationHandler` scheme `"SessionCookie"` (`:32`), `HandleAuthenticateAsync` (`:35`) still parsing with `ReadJwtToken` and not `ValidateToken` (`:51`) and comparing `jwt.ValidTo` to `TimeProvider.GetUtcNow().UtcDateTime` (`:55`), the no-signature-check `<remarks>` (`:18-23`), `AddSessionCookieAuthentication` (`:98`); `SessionTokenResult` / `SessionTokenResponse` (`CookieSessionRefresher.cs:12,18`); `CookieTokenReader.ReadAccessToken` reading `HttpContext.Items` first then the cookie (`CookieTokenReader.cs:19,27-33`, `FreshAccessTokenItemKey` `:17`, `ReadRefreshToken` `:36`); `CookieSessionRefreshMiddleware.InvokeAsync` running before `UseAuthentication` and gated to GET + `Accept: text/html` (`CookieSessionRefreshMiddleware.cs:16,28-31`, `UseCookieSessionRefresh` `:43`); `AddServerAuthSessionCookie(apiBaseAddress)` (`MMCA.Common.API/DependencyInjection.cs:141`); UI companion `ISessionCookieSync` (`ISessionCookieSync.cs:8,10,12`), `ITokenStorageService` (access token in memory, refresh token in an HttpOnly cookie, never localStorage; `ITokenStorageService.cs:5-6,8`), `JsFetchSessionCookieSync` mirroring through `mmcaAuthCookie.set` / `mmcaAuthCookie.clear` (`JsFetchSessionCookieSync.cs:11,20,32`); the Store wiring (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:91,92,160,176`); and both quoted code blocks (`SessionCookieAuthenticationHandler.cs:37-63`, `SessionCookieEndpoints.cs:45-57`). Corrected anchors (behavior and values unchanged): `ICookieSessionRefresher.GetOrRefreshAsync` `:33`→`:34`, its implementation `:55`→`:61`, `RefreshAsync` `:86`→`:92` and the access-token-only return `:83`→`:89` (`CallRefreshAsync` `:110` unchanged); `AddClientAuthSessionCookieSync()` `:111`→`:119` and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` `:113`→`:121` (`MMCA.Common.UI/DependencyInjection.cs`); the MMCA.ADC wiring, not re-checked on 2026-08-01, is now `AddServerAuthSessionCookie` `:59`, `AddClientAuthSessionCookieSync` `:60`, `UseCookieSessionRefresh` `:129`, `MapSessionCookieEndpoints` `:148` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs`, was `:58,61,128,147`); §26 Front-End Security (Maturity 4 / Implementation 8, unchanged substance) `:94`→`Website/docs-src/governance/common-ArchitectureScorecard.md:96`; the MMCA.Common two-axis index `:108`/`:109`→`:110`/`:111`, with the "N/A (excluded from denominators): none" bullet `:112`→`:114`. The twenty-sixth-wave re-score (2026-08-07, pinned at v1.142.0) moved no scores: Maturity holds at 96.9% (314/324) and Implementation at 84.8% (687/810), and a proposed §26 Implementation 8→9 was among the six lifts refuted on adversarial re-verification. The ADR corpus is now seventy ADRs, range 001-070 (last row [070] fail-fast-configuration-contract, `Website/docs-src/adr/README.md:77`; was sixty-four, range 001-064); ADR-022 and ADR-036 both still exist and still match the body. New this run: the shared-key-ring section is grounded in `Website/docs-src/adr/069-shared-data-protection-key-ring.md` (index row `README.md:76`) and `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs` (`AddCommonDataProtection` `:52`, the gate-1 configuration key `:54` and the absent-config no-op return `:59-62`, the application discriminator `:64-65,71`, one `DefaultAzureCredential` for both sinks `:68`, `PersistKeysToAzureBlobStorage` `:72`, the deliberately independent gate-2 rationale `:74-80` and `ProtectKeysWithAzureKeyVault` `:81-85`); ADC adopts it at `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:118` and `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:31`, while MMCA.Store has no call site anywhere in its source and its UI container app still runs `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:1169`); "persisted but not encrypted at rest" is ADR-069's own recorded trade-off (`069-shared-data-protection-key-ring.md:105-107`).
2026-08-14: re-verified every named type and behavior against current source (framework v1.152.0, `MMCA.Common/FACTS.md:14`, was v1.142.0; 15 published packages, `FACTS.md:19`), rewrote the adoption paragraph after a substantive change, and corrected fourteen shifted anchors. Substantive: MMCA.Store adopted the shared key ring on 2026-08-13, so "MMCA.Store does not call it anywhere" is false. Its Web UI host now calls `AddCommonDataProtection()` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:82`, immediately after `AddServiceDefaults()` at `:76`) against a storage account provisioned only for the key ring (`MMCA.Store/infra/main.bicep:783-801`, private `dataprotection-keys` container `:808-814`), and the `DataProtection__BlobStorageUri` env var is appended only when the `dataProtectionStorageReady` parameter is true (declared `bool = false` at `:93`, concatenated at `:1467-1469`); production passes `"dataProtectionStorageReady": {"value": true}` in its base parameters (`MMCA.Store/.github/workflows/deploy.yml:961`). `DataProtection__ApplicationName` `'MMCA.Store'` (`:1464`) and `AZURE_CLIENT_ID` (`:1466`) are unconditional. The Store UI container app still runs `maxReplicas: 2` (`main.bicep:1481`; the `:1169` citation was stale) and Store's Identity service (`identityApp`, `:939-1090`, `maxReplicas: 2` at `:1083`) still has no call site: the repo-wide grep for `AddCommonDataProtection` under `MMCA.Store/Source` returns exactly one hit. ADR-069 records the both-consumers state and the readiness-flag rationale at `Website/docs-src/adr/069-shared-data-protection-key-ring.md:91-110`, and the "persisted but not encrypted at rest" trade-off moved to `:60-61` (was `:105-107`; `DataProtection__KeyVaultKeyUri` is still deliberately unset, `MMCA.Store/infra/main.bicep:1445`). The "What we covered" recap was updated to match. Corrected anchors (behavior and values unchanged): ADC's `AddCommonDataProtection` calls `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:118`→`:126` and `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:31`→`:40`; `AddServerAuthSessionCookie(apiBaseAddress)` `MMCA.Common.API/DependencyInjection.cs:141`→`:151`; `SessionTokenResult` `CookieSessionRefresher.cs:12`→`:14` and `SessionTokenResponse` `:18`→`:20`, with `ICookieSessionRefresher.GetOrRefreshAsync` `:34`→`:36`, its implementation `:61`→`:64`, the access-token-only return `:89`→`:92`, `RefreshAsync` `:92`→`:95` and `CallRefreshAsync` `:110`→`:113`; the session-cookie wiring in both apps, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:59,60,129,148`→`:68,69,138,157` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:91,92,160,176`→`:109,110,178,194`; §26 Front-End Security (Maturity 4 / Implementation 8, unchanged substance) `Website/docs-src/governance/common-ArchitectureScorecard.md:96`→`:98` (line 96 is now §24 Forms, Validation & UX Safety); the MMCA.Common two-axis index `:110`/`:111`→`:112`/`:113`, with the "N/A (excluded from denominators): none" bullet `:114`→`:116`. The twenty-seventh-wave full re-score (2026-08-14, framework v1.152.0, git HEAD `3ba8d13`, clean tree; `common-ArchitectureScorecard.md:5,67`) moved no score: Maturity holds at 96.9% (314/324) and Implementation at 84.8% (687/810), and a proposed §26 Implementation 8→9 was again refuted on adversarial re-verification. Re-confirmed unchanged in source: cookie constants `mmca_auth_access` / `mmca_auth_refresh` (`SessionCookieEndpoints.cs:17-18`), `MapSessionCookieEndpoints` (`:22`) mapping POST/DELETE `/auth/session-cookie` (`:29,35`, `DisableAntiforgery()` at `:33,39`) and POST `/auth/session/token` (`:45`, its own `DisableAntiforgery()` `:60`), the `IsCrossSite` Sec-Fetch-Site guard (`:68`) and the `SessionCookieRequest` record (`:72`); `SessionCookieJar.Append`/`Delete` (`SessionCookieJar.cs:16,23`) writing `HttpOnly = true` (`:33`) and `SameSite = SameSiteMode.Lax` (`:35`) from `BuildOptions` (`:31`); `SessionCookieAuthenticationHandler` scheme `"SessionCookie"` (`:32`), `HandleAuthenticateAsync` (`:35`) still parsing with `ReadJwtToken` and not `ValidateToken` (`:51`, no `ValidateToken` call anywhere in the file) and comparing `jwt.ValidTo` to `TimeProvider.GetUtcNow().UtcDateTime` (`:55`), `AddSessionCookieAuthentication` (`:98`); `CookieTokenReader.ReadAccessToken` reading `HttpContext.Items` first then the cookie (`CookieTokenReader.cs:19,27-33`, `FreshAccessTokenItemKey` `:17`, `ReadRefreshToken` `:36`); `CookieSessionRefreshMiddleware.InvokeAsync` before `UseAuthentication`, gated to GET + `Accept: text/html` (`CookieSessionRefreshMiddleware.cs:16,28-31`, `UseCookieSessionRefresh` `:43`); UI companion `ISessionCookieSync` (`ISessionCookieSync.cs:8,10,12`), `ITokenStorageService` (access token in memory, refresh token mirrored to an HttpOnly cookie, never localStorage; `ITokenStorageService.cs:4-6,8`), `JsFetchSessionCookieSync` through `mmcaAuthCookie.set` / `mmcaAuthCookie.clear` (`JsFetchSessionCookieSync.cs:11,20,32`), `AddClientAuthSessionCookieSync` (`MMCA.Common.UI/DependencyInjection.cs:119`) and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` (`:121`); `AddCommonDataProtection` (`DataProtectionExtensions.cs:52`) with the gate-1 configuration key (`:54`), the absent-config no-op return (`:59-62`), the application discriminator (`:64-65,71`), one `DefaultAzureCredential` for both sinks (`:68`), `PersistKeysToAzureBlobStorage` (`:72`), the deliberately independent gate-2 rationale (`:74-80`) and `ProtectKeysWithAzureKeyVault` (`:81-85`); and both quoted code blocks (`SessionCookieAuthenticationHandler.cs:37-63`, `SessionCookieEndpoints.cs:45-57`). The ADR corpus is now eighty-four ADRs, range 001-084 (last row [084] stripe-webhook-ingress, `Website/docs-src/adr/README.md:91`; was seventy, range 001-070); ADR-022 (`README.md:29`), ADR-036 (the external-OAuth teaser, `:43`) and ADR-069 (`:76`) all still exist and still match the body.
2026-08-19: re-verified the three drifted anchors this run (framework v1.154.0, `MMCA.Common/FACTS.md:14`, dated 2026-08-18 at `:4`; was v1.152.0). `AddServerAuthSessionCookie(apiBaseAddress)` shifted +9 lines to `MMCA.Common.API/DependencyInjection.cs:160` (was `:151`; body and behavior unchanged: `HttpContextAccessor`, `MemoryCache`, `CookieTokenReader`, `HttpClient` registration, singleton `ICookieSessionRefresher`). The ADR corpus is now eighty-nine ADRs, range 001-089 (last row [089] gateway-topology-owned-by-configuration, `Website/docs-src/adr/README.md:96`; was eighty-four, range 001-084); row [084] stripe-webhook-ingress is unchanged at `README.md:91` but is no longer the last row. ADR-022 (`README.md:29`) and ADR-036 both still exist and still match the body; this is corpus-growth drift in the trailing verification footnote, not a substantive claim about the article's mechanism.
2026-09-19: re-verified against current source (framework v1.205.0, `MMCA.Common/FACTS.md:4,14`, dated 2026-09-17, was v1.154.0; 19 published packages, `FACTS.md:19`, was 15, and the shared closing boilerplate reads nineteen) and corrected one body claim plus every anchor this audit flagged. Substantive: ADR-069's 2026-09-10 revision retires the "configured nowhere" framing, so "Today no deployed app sets the key-vault URI" is no longer a statement the repositories support. Gate 2 ships in both templates with its parameter defaulting to off (`Website/docs-src/adr/069-shared-data-protection-key-ring.md:165`), and the at-rest trade-off bullet reads "Both templates ship the path and both default it off (2026-09-10 revision) ... the deployed value of that variable is not readable from the repositories, so this record can state what ships and not what is enabled" (`:141-146`, was `:60-61`); the both-consumers-adopted block holds at `:92` and the readiness-flag bullet at `:103`. Store declares `param dataProtectionKeyVaultKeyUri string = ''` (`MMCA.Store/infra/main.bicep:103`) with the `hasDataProtectionKek` guard (`:124`) and a gated `DataProtection__KeyVaultKeyUri` env entry (`:2016`); ADC declares the same parameter (`MMCA.ADC/infra/main.bicep:145`) and the same gated env entry on two container apps (`:1697`, `:2425`). The body paragraph and its `.medium.md` mirror were rewritten to that current-state wording, and the "What we covered" recap dropped its before/after "now adopted". Corrected anchors (behavior and values unchanged): `MapSessionCookieEndpoints` holds at `SessionCookieEndpoints.cs:22` and the cookie-name constants at `:17-18`, but the group `MapPost`/`MapDelete` for `/auth/session-cookie` are `:34`/`:40` (were `:29,35`) with `DisableAntiforgery()` at `:38`/`:44` (were `:33,39`), POST `/auth/session/token` is `:50` (was `:45`) with its own `DisableAntiforgery()` at `:65`, `IsCrossSite` is `:73` (was `:68`) and the `SessionCookieRequest` record is `:77` (was `:72`); the second quoted code block is `SessionCookieEndpoints.cs:50-61` (was `:45-57`), its text unchanged, with the trailing `ExcludeFromDescription()`/`AllowAnonymous()`/`DisableAntiforgery()` chain ending at `:65` still trimmed out of the quote. `SessionTokenResult` is `CookieSessionRefresher.cs:15` (was `:14`), `SessionTokenResponse` `:21` (was `:20`), `ICookieSessionRefresher.GetOrRefreshAsync` `:37` (was `:36`), its implementation `:65` (was `:64`), the access-token-only return `:93` (was `:92`), `RefreshAsync` `:96` (was `:95`) and `CallRefreshAsync` `:114` (was `:113`). `AddServerAuthSessionCookie(string apiBaseAddress)` is `MMCA.Common.API/DependencyInjection.cs:174` (was `:160`); `AddClientAuthSessionCookieSync()` is `MMCA.Common.UI/DependencyInjection.cs:189` with `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` at `:191` (were `:119`/`:121`). Host wiring: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:85,86,228,261` (was `:68,69,138,157`) and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:129,130,257,277` (was `:109,110,178,194`). The `AddCommonDataProtection` adoption set is still exactly three call sites: `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:114` (was `:126`), `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:46` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:70` immediately after `AddServiceDefaults()` at `:64` (were `:82` after `:76`). Store infra: the dedicated storage account is `MMCA.Store/infra/main.bicep:1132` with the private `dataprotection-keys` container at `:1157`, `param dataProtectionStorageReady bool = false` at `:97` (was `:93`), the `DataProtection__BlobStorageUri` gate at `:2008-2009` (was `:1467-1469`), `DataProtection__ApplicationName` `'MMCA.Store'` at `:2005` (was `:1464`) and the client-id env at `:2007` (was `:1466`); `uiApp` (`:1942`) runs `maxReplicas: 2` at `:2036` (was `:1481`) and `identityApp` (`:1390`, was `:939-1090`) at `:1559` (was `:1083`) with no call site; production still passes `"dataProtectionStorageReady": {"value": true}` (`MMCA.Store/.github/workflows/deploy.yml:1324`, was `:961`). Governance: Section 26 Front-End Security is Maturity 4 / Implementation 9 at `Website/docs-src/governance/common-ArchitectureScorecard.md:106` (was 4/8 at `:98`; the implementation lift landed in the thirtieth wave, 2026-08-31, so the first footnote's "impl 8, deliberately-partial default CSP" reading is superseded by the current row, which credits a centralized hardened security-headers middleware with a pluggable `ICspPolicyProvider` CSP extension). The MMCA.Common two-axis index is Maturity 97.0% = 318/328 (`:120`) and Implementation 86.0% = 705/820 (`:121`), with the "N/A (excluded from denominators): none this cycle" bullet at `:124` (was 96.9% = 314/324 at `:112` and 84.8% = 687/810 at `:113`); the thirty-sixth-wave full re-score (2026-09-19, v1.205.0) moved no score. The ADR corpus is 125 ADRs, range 001-125 (last row [125] parameterized-sql-only, `Website/docs-src/adr/README.md:137`; was eighty-nine, range 001-089); ADR-022 (`README.md:34`), ADR-036 (the external-OAuth teaser, `:48`) and ADR-069 (`:81`) all still exist and still match the body.
2026-10-02: refreshed against current source (framework v1.221.0, `MMCA.Common/FACTS.md`) and folded in ADR-131 (same-origin API proxy) as the present answer to how the browser reaches the API; header ADR cell gains ADR-131 and the Status line names the ADR and the `MMCA.Common.UI.Web/SameOriginProxy` source. Substantive: both apps opt in to the proxy on `main` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:156` register, `:268` map; `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:153` register, `:262` map) and both set `SameOriginApiProxy:SessionCookieSameSite` to `Lax` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:50-51`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:53-54`), so the body's in-memory access-token hydrate was replaced by the claims-only copy plus the proxy, the cookie-seeding paragraph says the server is the only writer on these hosts, and the CSRF section and trade-offs gained the proxy layer (the audit's "neither consumer calls AddSameOriginApiProxy" finding grepped the wrong method name; the API is `AddCommonSameOriginApiProxy`). Proxy evidence: `AddCommonSameOriginApiProxy(IConfiguration)` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:51`) sets `SessionCookieSettings.SameSite` from `SessionCookieSameSite` and `ClaimsOnlyBrowserTokens = true` (`:69-74`), registers the YARP forwarder (`:76`) and replaces `ITokenRefresher` / `ISessionCookieSync` with the handoff implementations (`:83-84`); `SameOriginApiProxyEndpoint` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:29`) calls `ValidateOrRefreshAsync` (`:88`), refuses `cross_origin_rejected` (`:237`), answers `OPTIONS` locally (`:243`), refuses `csrf_header_required` (`:254`) and answers 503 `session_refresh_unavailable` (`:284`); the WASM `"APIClient"` takes `SameOriginApiEndpoint` as its base address (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:114`) and adds `SameOriginProxyRequestHandler` (`:131-132`); Strict-by-default, Lax-allowed, theft-not-use and the UI-host-in-the-API-path trade-offs are ADR-131's own (`Website/docs-src/adr/131-same-origin-api-proxy.md:139-145`, `:184-194`, `:206-208`; the handoff and token-issuing rewrite at `:84-92`, `:111-115`). Claims copy: `SessionClaimsToken.Create` (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionClaimsToken.cs:25`, `alg: none` header `:17`, payload with empty signature `:33`); `SessionCookieSettings.SameSite` defaults to `Lax` (`SessionCookieSettings.cs:19`) and `ClaimsOnlyBrowserTokens` (`:29`) makes `POST /auth/session-cookie` answer 204 without writing (`SessionCookieEndpoints.cs:40-45`). The second code block now quotes `SessionCookieEndpoints.cs:58-80` (was `:50-61`): it gained the `IOptions<SessionCookieSettings>` parameter (`:59`) and the claims-only `browserToken` branch (`:73-76`); trailing `ExcludeFromDescription()` / `AllowAnonymous()` / `DisableAntiforgery()` (`:78-80`) trimmed. The handler block still matches `SessionCookieAuthenticationHandler.cs:37-63` (scheme `:32`, `ReadJwtToken` `:51`, injected clock `:55`). Re-anchored (values unchanged unless stated): cookie constants `SessionCookieEndpoints.cs:18-19` (was `:17-18`), `MapSessionCookieEndpoints` `:23` (was `:22`), group POST/DELETE `:35`/`:48` (was `:34`/`:40`) with `DisableAntiforgery()` `:46`/`:52`, `IsCrossSite` `:88` (was `:73`), `SessionCookieRequest` `:92` (was `:77`); `SessionCookieJar.Append` `:16,19` and `Delete` `:26,29` (now taking a `sameSite` argument), `BuildOptions` `:37`, `HttpOnly` `:39`, `Secure` `:40`, `SameSite = sameSite` `:41` (was a fixed `Lax` at `:35`); `SessionTokenResult` `CookieSessionRefresher.cs:17` (was `:15`), `SessionTokenResponse` `:23` (was `:21`), `GetOrRefreshAsync` interface `:39` (was `:37`) and implementation `:89` (was `:65`, now delegating to `ValidateOrRefreshAsync` `:92`), access-token-only result `:143`, public `RefreshAsync` `:105` with private overload `:146`, `CallRefreshAsync` `:165` (was `:114`); `AddServerAuthSessionCookie(string apiBaseAddress)` `MMCA.Common.API/DependencyInjection.cs:174` (unchanged); `AddClientAuthSessionCookieSync()` `MMCA.Common.UI/DependencyInjection.cs:213` and `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` `:215` (were `:189`/`:191`); `ITokenStorageService` moved to `MMCA.Common.UI/Services/Auth/Tokens/ITokenStorageService.cs:8` (in-memory, never localStorage, `:3-7`); `JsFetchSessionCookieSync` `:13`, `mmcaAuthCookie.set` `:23`, `mmcaAuthCookie.clear` `:37` (were `:11,20,32`). Host wiring: ADC `AddServiceDefaults` `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:52`, `AddCommonDataProtection` `:62` (was `:46`), `AddServerAuthSessionCookie` `:101`, `AddClientAuthSessionCookieSync` `:102`, `UseCookieSessionRefresh` `:246`, `MapSessionCookieEndpoints` `:267` (were `:85,86,228,261`); Store `AddServiceDefaults` `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:63` (was `:64`), `AddCommonDataProtection` `:69` (was `:70`), `AddServerAuthSessionCookie` `:117`, `AddClientAuthSessionCookieSync` `:118`, `UseCookieSessionRefresh` `:247`, `MapSessionCookieEndpoints` `:261` (were `:129,130,257,277`); ADC Identity `AddCommonDataProtection` `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:115` (was `:114`, per the audit grep, which found exactly three call sites). Store infra: `param dataProtectionStorageReady bool = false` `MMCA.Store/infra/main.bicep:97`, `DataProtection__ApplicationName` `:2056`, the `DataProtection__BlobStorageUri` gate `:2059-2060`, `uiApp` `:1991` with `maxReplicas: 2` `:2087` (were `:2005`, `:2008-2009`, `:2036`); every other `maxReplicas` in the template (`:1591`, `:1712`, `:1850`, `:1969`) is also 2, which is what keeps the Identity-replica clause true. Not re-read this run, carried from the audit: `deploy.yml` passing `dataProtectionStorageReady` true (`MMCA.Store/.github/workflows/deploy.yml:1294`, was `:1324`) and `DataProtectionExtensions.cs` (absent-config no-op `:59-62`, Key Vault gate `:74-85`). Narrowed: the ADC sentence no longer claims both hosts share one private container on a pre-existing storage account (not checked this run). ADR index rows: ADR-022 `Website/docs-src/adr/README.md:35` (was `:34`), ADR-036 `:49`, ADR-069 `:82`, ADR-131 `:144`; corpus 131 ADRs, range 001-131. Section 26 Front-End Security row is `Website/docs-src/governance/common-ArchitectureScorecard.md:90` (scores not restated in the body); the MMCA.Common index is Maturity 96.6% (317/328) and Implementation 86.0% (705/820) at `:9-10`.*

- Full series index: https://ivanball.github.io/writing.html
