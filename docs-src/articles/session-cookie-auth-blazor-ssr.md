# Browser session-cookie auth for Blazor SSR: surviving the F5

> Series: MMCA.Common · Article #25 (deep-dive) · Pillar P2/P4 · Groups G08, G15 · Rubric §11, §26 · ADR-022, ADR-069 ·
> Status: grounded in `Website/docs-src/adr/022-browser-session-cookie-auth.md`,
> `Website/docs-src/adr/069-shared-data-protection-key-ring.md`, the `MMCA.Common.API/SessionCookies`
> source, the `MMCA.Common.Aspire` DataProtection extension, and the `MMCA.Common.UI` auth companion.
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

The mechanism ships in `MMCA.Common.API` (a `SessionCookies/` folder) with a `MMCA.Common.UI` companion,
and both apps' Web UI hosts wire it. It has four moving parts.

**Two HttpOnly cookies, seeded from the client at login.** `mmca_auth_access` carries the JWT and
`mmca_auth_refresh` carries the refresh token (the names are constants on `SessionCookieEndpoints`). After a
successful login the browser POSTs to `/auth/session-cookie`, and `SessionCookieJar.Append` writes both
cookies HttpOnly with `SameSite=Lax`; logout DELETEs them. Because they are HttpOnly, no script can read
either one.

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

**The refresh token never leaves the server.** When the interactive client starts, it calls
`POST /auth/session/token`, a same-origin "validate-or-refresh" endpoint, to hydrate its in-memory access
token. `CookieSessionRefresher.GetOrRefreshAsync` reads the HttpOnly refresh cookie server-side, refreshes
the access token if it has expired, writes fresh cookies back, and returns **only** the access token and
its expiry.

```csharp
// POST /auth/session/token: hydrate the in-memory access token; the refresh token never leaves the server.
endpoints.MapPost("/auth/session/token", async (
    HttpContext httpContext, ICookieSessionRefresher refresher, CancellationToken cancellationToken) =>
{
    if (IsCrossSite(httpContext.Request))                       // Sec-Fetch-Site CSRF guard
    {
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    }

    var result = await refresher.GetOrRefreshAsync(httpContext, cancellationToken).ConfigureAwait(false);
    return result is null
        ? Results.Json(new { error = "no_session" }, statusCode: StatusCodes.Status401Unauthorized)
        : Results.Json(new SessionTokenResponse(result.Value.AccessToken, result.Value.AccessTokenExpiry));
});
```

The response is a `SessionTokenResponse(AccessToken, AccessTokenExpiry)`. The refresh token is never
serialized to the browser. On the UI side, `ITokenStorageService` keeps the access token **in memory** and
treats the refresh token as living only in the HttpOnly cookie, and `ISessionCookieSync` (implemented by
`JsFetchSessionCookieSync`) mirrors the client's tokens back into the cookies via a small JS shim so the
next prerender sees a current session.

**A refresh middleware closes the expiry race.** `CookieSessionRefreshMiddleware` runs *before*
`UseAuthentication` and, only on GET requests that accept HTML, refreshes the access token server-side if it
has expired but the refresh cookie is still good. So a fresh GET after the access token lapsed still renders
authenticated, because the middleware has already minted a fresh access token (read by `CookieTokenReader`
from `HttpContext.Items`) before the SSR scheme runs.

This is a backend-for-frontend (BFF) token-storage layer: the browser holds an HttpOnly session whose
refresh half it cannot read, the SSR pass authenticates from the access cookie without trusting it as the
boundary, and the real enforcement stays at the API.

## The CSRF tax, and how it is paid

Cookie-based auth reintroduces a concern that a pure bearer-header design does not have: a cross-site page
can cause the browser to send your cookies. The framework pays that tax with defense-in-depth rather than a
single control. The cookies are `SameSite=Lax`, so they are not sent on cross-site subrequests. The
refresh endpoint additionally rejects cross-site POSTs by checking the `Sec-Fetch-Site` header
(`IsCrossSite`). The cookie endpoints disable antiforgery deliberately (they carry no antiforgery token and
are guarded by `SameSite` + `Sec-Fetch-Site` + POST-only instead). Three overlapping checks, none of them
load-bearing alone.

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
hosts that mint those payloads, its Identity service and its Web UI host, and points both at one private
container on a storage account it already had. MMCA.Store's Web UI host calls it as well, on a storage
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
- **The session now lives in two places.** Cookies for browser GETs and SSR, an in-memory bearer token for
  interactive API calls. The two must stay in sync, which is exactly what `/auth/session/token` and the UI's
  `ISessionCookieSync` exist to manage. A bug in that sync shows up as a flicker of the wrong auth state.
- **CSRF surface a header-only design would not have.** `SameSite=Lax` plus `Sec-Fetch-Site` plus POST-only
  is solid, but it is a surface, and a reviewer has to understand all three to trust the cookie endpoints.
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
3. **Keep the refresh token server-side behind a hydrate endpoint.** The browser asks a same-origin
   endpoint for a fresh access token; the refresh token is exchanged on the server and never serialized to
   the client.
4. **Refresh before authentication on GETs.** A small middleware that mints a fresh access token before the
   auth handler runs closes the "expired between requests" gap without a client round-trip.
5. **Budget for CSRF.** Cookies bring it back. `SameSite=Lax` plus a `Sec-Fetch-Site` check plus POST-only
   endpoints is a defensible, layered answer.
6. **Share the key ring before you scale out.** The moment a cookie-minting host runs more than one
   replica, per-process keys become random sign-outs. Persist the ring to one shared store with an
   application discriminator, and keep encryption of the ring at rest as a separate switch so a lagging
   role assignment costs you hardening rather than login.

The takeaway: **the SSR prerender gap is real, and the fix is an HttpOnly cookie the server can read plus
the discipline that reading it is for rendering, never for deciding. Keep the refresh token off the client,
keep the API as the one validator, and an `[Authorize]` page survives an F5 without weakening anything.**

---

**What we covered:** why a Blazor Web App's SSR prerender pass bounces `[Authorize]` pages to login on a
fresh GET (no `Authorization` header, no server-readable token), how MMCA.Common closes the gap with two
HttpOnly cookies, a `SessionCookieAuthenticationHandler` that reads claims for prerender without validating
the signature, a server-side `/auth/session/token` refresher that keeps the refresh token off the client,
and a pre-auth refresh middleware, why the design is safe only because the API stays the validation
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
2026-09-19: re-verified against current source (framework v1.205.0, `MMCA.Common/FACTS.md:4,14`, dated 2026-09-17, was v1.154.0; 19 published packages, `FACTS.md:19`, was 15, and the shared closing boilerplate reads nineteen) and corrected one body claim plus every anchor this audit flagged. Substantive: ADR-069's 2026-09-10 revision retires the "configured nowhere" framing, so "Today no deployed app sets the key-vault URI" is no longer a statement the repositories support. Gate 2 ships in both templates with its parameter defaulting to off (`Website/docs-src/adr/069-shared-data-protection-key-ring.md:165`), and the at-rest trade-off bullet reads "Both templates ship the path and both default it off (2026-09-10 revision) ... the deployed value of that variable is not readable from the repositories, so this record can state what ships and not what is enabled" (`:141-146`, was `:60-61`); the both-consumers-adopted block holds at `:92` and the readiness-flag bullet at `:103`. Store declares `param dataProtectionKeyVaultKeyUri string = ''` (`MMCA.Store/infra/main.bicep:103`) with the `hasDataProtectionKek` guard (`:124`) and a gated `DataProtection__KeyVaultKeyUri` env entry (`:2016`); ADC declares the same parameter (`MMCA.ADC/infra/main.bicep:145`) and the same gated env entry on two container apps (`:1697`, `:2425`). The body paragraph and its `.medium.md` mirror were rewritten to that current-state wording, and the "What we covered" recap dropped its before/after "now adopted". Corrected anchors (behavior and values unchanged): `MapSessionCookieEndpoints` holds at `SessionCookieEndpoints.cs:22` and the cookie-name constants at `:17-18`, but the group `MapPost`/`MapDelete` for `/auth/session-cookie` are `:34`/`:40` (were `:29,35`) with `DisableAntiforgery()` at `:38`/`:44` (were `:33,39`), POST `/auth/session/token` is `:50` (was `:45`) with its own `DisableAntiforgery()` at `:65`, `IsCrossSite` is `:73` (was `:68`) and the `SessionCookieRequest` record is `:77` (was `:72`); the second quoted code block is `SessionCookieEndpoints.cs:50-61` (was `:45-57`), its text unchanged, with the trailing `ExcludeFromDescription()`/`AllowAnonymous()`/`DisableAntiforgery()` chain ending at `:65` still trimmed out of the quote. `SessionTokenResult` is `CookieSessionRefresher.cs:15` (was `:14`), `SessionTokenResponse` `:21` (was `:20`), `ICookieSessionRefresher.GetOrRefreshAsync` `:37` (was `:36`), its implementation `:65` (was `:64`), the access-token-only return `:93` (was `:92`), `RefreshAsync` `:96` (was `:95`) and `CallRefreshAsync` `:114` (was `:113`). `AddServerAuthSessionCookie(string apiBaseAddress)` is `MMCA.Common.API/DependencyInjection.cs:174` (was `:160`); `AddClientAuthSessionCookieSync()` is `MMCA.Common.UI/DependencyInjection.cs:189` with `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>` at `:191` (were `:119`/`:121`). Host wiring: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:85,86,228,261` (was `:68,69,138,157`) and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:129,130,257,277` (was `:109,110,178,194`). The `AddCommonDataProtection` adoption set is still exactly three call sites: `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:114` (was `:126`), `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:46` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:70` immediately after `AddServiceDefaults()` at `:64` (were `:82` after `:76`). Store infra: the dedicated storage account is `MMCA.Store/infra/main.bicep:1132` with the private `dataprotection-keys` container at `:1157`, `param dataProtectionStorageReady bool = false` at `:97` (was `:93`), the `DataProtection__BlobStorageUri` gate at `:2008-2009` (was `:1467-1469`), `DataProtection__ApplicationName` `'MMCA.Store'` at `:2005` (was `:1464`) and the client-id env at `:2007` (was `:1466`); `uiApp` (`:1942`) runs `maxReplicas: 2` at `:2036` (was `:1481`) and `identityApp` (`:1390`, was `:939-1090`) at `:1559` (was `:1083`) with no call site; production still passes `"dataProtectionStorageReady": {"value": true}` (`MMCA.Store/.github/workflows/deploy.yml:1324`, was `:961`). Governance: Section 26 Front-End Security is Maturity 4 / Implementation 9 at `Website/docs-src/governance/common-ArchitectureScorecard.md:106` (was 4/8 at `:98`; the implementation lift landed in the thirtieth wave, 2026-08-31, so the first footnote's "impl 8, deliberately-partial default CSP" reading is superseded by the current row, which credits a centralized hardened security-headers middleware with a pluggable `ICspPolicyProvider` CSP extension). The MMCA.Common two-axis index is Maturity 97.0% = 318/328 (`:120`) and Implementation 86.0% = 705/820 (`:121`), with the "N/A (excluded from denominators): none this cycle" bullet at `:124` (was 96.9% = 314/324 at `:112` and 84.8% = 687/810 at `:113`); the thirty-sixth-wave full re-score (2026-09-19, v1.205.0) moved no score. The ADR corpus is 125 ADRs, range 001-125 (last row [125] parameterized-sql-only, `Website/docs-src/adr/README.md:137`; was eighty-nine, range 001-089); ADR-022 (`README.md:34`), ADR-036 (the external-OAuth teaser, `:48`) and ADR-069 (`:81`) all still exist and still match the body.*

- Full series index: https://ivanball.github.io/writing.html
