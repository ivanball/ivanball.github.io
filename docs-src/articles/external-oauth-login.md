# Google, GitHub and Apple login without leaking tokens: external OAuth behind your own JWTs

> Series: MMCA.Common · Article #26 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-036, ADR-043 ·
> Status: grounded in `Website/docs-src/adr/036-external-oauth-login.md`, `MMCA.Common.API`'s `OAuthControllerBase`
> and `ExternalAuthExtensions`, the `IAuthenticationService.ExternalLoginAsync` default, and ADC's
> `AuthenticationService` / `User` / `OAuthController` adoption (Store not adopted). No em dashes.

**Subtitle:** You want "Sign in with Google," "Sign in with GitHub," and the "Sign in with Apple"
button the store guidelines ask for. So you add the provider packages, wire the callbacks, and
redirect the browser back to your app with the freshly minted session token on the query string,
because that is the easy way to get it into the client. Now your access token is in the address bar,
the browser history, the `Referer` header, and every proxy log between you and the user. The fix is
to terminate federation at the edge and hand the browser a single-use code, never a token.

---

Social login looks like an afternoon's work. Add the Google package, add the GitHub package, add the
Apple package, register a callback URL, and let the middleware run the OAuth dance. The provider
bounces the user back to your app, you read the external identity off the callback, and they are
signed in. The demo works on the first try.

Then you look at what actually crossed the wire. The naive version redirects back to your SPA with the
session token sitting on the URL, because a redirect is the path of least resistance for getting a
value into the browser. But a redirect is a GET. The browser writes that GET into history. Any reverse
proxy or CDN in front of you logs the full path. The `Referer` header carries it into whatever the
landing page loads next. You have taken your most sensitive credential and printed it in four places
you do not control.

There is a second trap under the first. The provider hands you its own access token, and maybe a
refresh token, and it is tempting to save them. But you never wanted a Google session, you wanted your
user signed into your app. Provider tokens you never call are just more secret material to leak. And a
third trap, which runs the opposite way to the one most people plan for: a returning user who
registered with a password last month clicks "Sign in with GitHub" today, and the obvious kindness is
to match the email and drop the provider onto that account. That match is an account-takeover vector.
An incoming assertion proves the provider's side of the address, and nothing proves the local row's
address was ever confirmed, so the account you are about to hand over may belong to whoever typed that
address into your registration form first.

## Why it matters

The invariant the rest of the system leans on is small and load-bearing: inside the app, a user is
always a local `User` carrying the app's own JWT. Every other auth concern is built on that one token.
Cross-service validation checks it against the issuer's JWKS. Permission checks read its role claim.
Ownership checks read its subject. The browser session cookies carry it. If social login introduced a
*second* kind of identity, every one of those consumers would have to learn to validate a Google,
GitHub or Apple token too.

So external identity cannot be a parallel identity system. It has to be an entry path that terminates
in the exact same local token pair a password login produces. The moment the provider vouches for the
user, you exchange that vouching for your own JWT and throw the external principal away. Downstream,
nothing changes, because downstream never sees anything but your token.

And it has to be optional. Most hosts, every test, and local dev have no OAuth secrets. Turning the
framework's OAuth support on with nothing configured must leave the JWT-only pipeline exactly as it
was, the same inert-until-configured posture the permission system uses (ADR-020).

## The MMCA answer: external OAuth behind a local-JWT exchange

The mechanism ships in `MMCA.Common.API`, and adoption is one app deep (more on that below). It has
three moving parts and one rule: the tokens never touch the URL.

**Scheme registration is gated per provider, and inert until configured.** `AddExternalAuthProviders`
reads the `OAuth` config section and turns on the Google scheme only if `OAuth:Google:ClientId` is
set, the GitHub scheme only if `OAuth:GitHub:ClientId` is set, and the Apple scheme only if
`OAuth:Apple:ClientId` is set. With all three absent it returns the service collection untouched, so a
host with no OAuth secrets keeps exactly the JWT-only pipeline `AddCommonAuthentication` gave it. It
calls `AddAuthentication()` with no argument on purpose, so the new schemes append rather than
displacing the JWT bearer default. Fail-fast is per provider: Google and GitHub throw at startup when a
`ClientId` is set without its matching `ClientSecret`, while Apple has no static client secret at all
(the handler mints a short-lived ES256 assertion instead, `GenerateClientSecret = true`) and throws on
a missing `OAuth:Apple:TeamId`, `OAuth:Apple:KeyId` or `OAuth:Apple:PrivateKeyPem`. Either way a
half-wired provider fails at startup rather than at the first sign-in.

**A ten-minute cookie carries the external principal, and nothing else.** The provider callback signs
into a dedicated `ExternalLogin` cookie scheme (cookie name `mmca_external_login`, HttpOnly,
`SameSite=Lax`, a ten-minute lifetime). That cookie exists only to hand the external claims from the
provider callback to the controller. It is never the app session. GitHub is asked for the `user:email`
scope, because its default scope omits the email the exchange needs to match an account. Apple returns
its callback as a cross-site form POST (`response_mode=form_post` is forced by the name and email
scopes), which the middleware handles at `/auth/callback/apple` like any other provider callback.

**The exchange swaps the external identity for a local JWT, then hides the tokens behind a single-use
code.** The challenge endpoints (`GET auth/oauth/google`, `GET auth/oauth/github`,
`GET auth/oauth/apple`) redirect to the provider and back to `OAuthControllerBase.CompleteAsync`. Each
of them takes an optional opaque `state` value the client round-trips through the provider, which the
challenge stashes in the authentication properties and the completion redirect hands back, so the
client can prove the code belongs to the flow it started. The server never interprets that value.
`CompleteAsync` authenticates the `ExternalLogin` cookie, pulls
`(provider, providerKey, email, firstName, lastName)` out of the standard claims, and calls
`IAuthenticationService.ExternalLoginAsync`. On success it signs the external cookie straight out,
mints a 32-byte opaque code, stashes the token pair server-side in the cache under a two-minute TTL,
and redirects to the UI carrying that code and the client's state (the web redirect also carries the
non-secret `returnUrl`), never a token. The UI then POSTs the code back to `ExchangeAsync` out of band
to collect the tokens.

```csharp
// OAuthControllerBase.CompleteAsync (trimmed): swap the external identity for a local JWT pair,
// then hand the UI only a single-use code, never the tokens.
var (returnUrl, clientState) = ReadChallengeState(authenticateResult.Properties);  // stashed at challenge time
var mobileReturnUrl = GetAllowedMobileReturnUrl(returnUrl);   // an allow-listed native scheme, or null for web
var result = await authenticationService.ExternalLoginAsync(
    providerName, providerKey, email, firstName, lastName);   // by provider, guarded link, or create
if (result.IsFailure)
{
    return RedirectError(uiBaseUrl, mobileReturnUrl, GetErrorCode(result.Errors));
}
var response = result.Value;

await HttpContext.SignOutAsync(ExternalLoginScheme);          // the external principal dies with the exchange

// Stash the minted token pair server-side under a short TTL; the redirect carries only the opaque
// code plus the client's own state, so the client can prove the code belongs to the flow it started.
var exchangeCode = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
await cacheService.SetAsync(
    "oauth-exchange:" + exchangeCode, response, TimeSpan.FromMinutes(2), HttpContext.RequestAborted);
// Web target normally; the allow-listed native scheme when mobileReturnUrl is non-null (ADR-043).
return Redirect(BuildSuccessRedirectUrl(uiBaseUrl, mobileReturnUrl, exchangeCode, returnUrl, clientState));

// OAuthControllerBase.ExchangeAsync (POST, [NonIdempotent], out of band): burn the code on first use.
if (string.IsNullOrWhiteSpace(request.Code)) { return InvalidCode(); }
var response = await cacheService.GetAsync<AuthenticationResponse>("oauth-exchange:" + request.Code, ct);
if (string.IsNullOrEmpty(response.AccessToken)) { return InvalidCode(); }  // missing/replayed/expired => 400
await cacheService.RemoveAsync("oauth-exchange:" + request.Code, ct);      // single-use
return Ok(response);
```

Read the redirect line again: it carries `code=...`, not `access_token=...`. The access and refresh
tokens sit in the server-side cache the whole time. They reach the browser only through a same-origin
POST response body, which history, the `Referer` header, and upstream access logs do not record. The
code is burned on first read, so a leaked or replayed code buys nothing, and a blank, missing,
replayed, or expired code returns HTTP 400. The exchange is marked `[NonIdempotent]`, because
replaying a stored response would defeat the burn.

## The same handshake, now for native heads

A mobile head cannot intercept a redirect to a web URL, and the providers reject OAuth inside an
embedded WebView, so a MAUI app has to run the provider flow in the system browser and then needs
the completion redirect to land back inside the app. ADR-043 adds exactly that without touching the
property above. `CompleteAsync` consults `OAuth:AllowedReturnUrlSchemes` (a config array, empty by
default): when the challenge's stashed `returnUrl` is an absolute URI whose custom scheme is on that
list (for example `atldevcon://oauth-complete`), the success and failure redirects target that URL
instead of `OAuth:UIBaseUrl`, carrying the same single-use code. `http` and `https` schemes never
match even if listed, so a web destination always flows through the config-pinned base URL and the
allowlist cannot become an open redirect. An empty list reproduces the web-only behavior exactly. On
the client, the Login page branches on an injected `IExternalAuthBroker`: the MAUI implementation
(`MauiExternalAuthBroker`) begins a per-attempt value in an `OAuthFlowStateStore`, launches the
provider in the system browser via `WebAuthenticator` with that value on the challenge URL, captures
`code` and the returned `state` off the custom-scheme callback, and hands both to the shared
`/auth/oauth-complete` page, which already owns the same out-of-band `ExchangeAsync` the browser uses.
The completion page refuses a code that does not belong to an attempt started on this device, so a
deep link carrying someone else's code cannot sign the app in as them. Web heads keep the plain anchor
flow; the broker reports itself unavailable when no mobile redirect scheme is configured. The code
still rides the redirect and a token never does, so the invariant holds identically across web and
native: the only thing that differs is where the code lands.

## Finding the local user, three ways

`ExternalLoginAsync` is where the external identity becomes one of your users, and it resolves in a
deliberate order inside a single transaction. First it looks for a user already carrying this
`LoginProvider` + `ProviderKey`: a returning social user, signed in immediately. If there is none, it
validates the provider-supplied email with `Email.Create` (this is the one address in the system no
request validator has already gated, and an unparseable claim returns `Auth.ExternalEmailInvalid`
rather than turning the next query into "find the users whose email is null"), then looks the account
up by that validated value.

When an account already owns that email, nothing is linked until three guards pass, and they are
strict on purpose. **One provider link per user:** an account already linked to a *different* provider
is refused with `Auth.ExternalProviderAlreadyLinked`, because the aggregate holds a single
`(LoginProvider, ProviderKey)` pair and a second link would overwrite the first and strand the
original login, which on a pure-OAuth account has no password to fall back on. That check runs ahead
of the verifier, so saying no costs no external round trip. **A provider-asserted verified email:** an
injected `IExternalLoginEmailVerifier` is asked whether the provider asserted this address as
verified, and an unverified assertion is refused with `Auth.ExternalEmailNotVerified`. **No local
password:** even on a verified assertion, an account whose `HasLocalPassword` is true is refused with
`Auth.ExternalLinkRequiresLocalSignIn`, and the message tells the person to sign in with their
password and link the provider from their profile. The verifier proves only the provider's side of the
address, so only an account nobody can already sign into with a password is claimable by an email
match; everyone else proves possession first. Once all three pass, `User.LinkExternalProvider`
attaches the provider to the existing account.

When no account owns the email at all, the flow *creates* one through `User.CreateExternal`, an
`Attendee` with empty password hash and salt. The verifier runs on this branch too, but it does not
gate the create (GitHub's OAuth flow asserts nothing, and refusing would close GitHub sign-up): the
assertion rides along as a sixth `emailVerified` argument, which starts the account confirmed when the
provider vouched for the address and unconfirmed otherwise, in which case it receives a confirmation
link exactly like a local registration.

An external user is a `User` with an empty password hash and salt, carrying `LoginProvider` and
`ProviderKey`; `IsExternalLogin` is simply `LoginProvider is not null`, and `HasLocalPassword` is the
complementary question the third guard asks. The linkage is two nullable columns
(`LoginProvider varchar(50)`, `ProviderKey varchar(256)`) plus a unique index over the pair filtered
to non-null rows, so two external identities cannot collide onto one account while local (null, null)
accounts stay unconstrained. Whichever of the three paths runs, the exchange finishes through the
shared `IssueTokensAsync` workflow, which opens a refresh *session* for the device (hashed at rest, a
per-user cap, a rotation chain) rather than stamping a plaintext refresh token on the aggregate, and
hands back the same `AuthenticationResponse` shape a password login returns. A brand-new external user
also publishes a post-commit `UserRegistered` integration event, and the one field that differs from
the local registration path decides what happens next: the external event carries the provider's
`emailVerified` assertion, while local registration hard-codes it to `false`, so the downstream
speaker auto-link runs only for an address a provider vouched for and the rest are logged for an
organizer to link by hand.

The split of responsibility is the point. The handshake, the cookie, and the code exchange are generic
and live in the framework's `OAuthControllerBase`. The `User` factory, the default role, the claim
set, and the link guards are app-specific and live in the subclass. The interface member
`ExternalLoginAsync` even ships a default implementation that returns a not-supported failure, so a
host that never wires the flow degrades safely instead of silently succeeding.

## Trade-offs, honestly

The pattern buys real safety, and ADR-036 is candid about what it costs.

- **Opt-in per app, and easy to half-wire.** The flow needs four cooperating pieces: scheme
  registration, the controller subclass, the service override, and the `OAuth__UIBaseUrl` redirect
  target, plus the migration that adds the provider columns. Register schemes but forget the
  controller, or configure a `ClientId` without the matching UI flags, and you get a broken or
  invisible button. Auditing the whole inventory is on the adopter.
- **The link guards are ADC-level, not framework-provided.** Linking on a bare email match would let
  an unverified address attach to an existing account, so ADC runs all three refusals in its own
  override: already linked elsewhere, not provider-verified, and still holding a local password.
  Google's `email_verified` claim passes the verifier; GitHub's OAuth flow asserts nothing, so a
  GitHub sign-in whose email matches an existing account is refused rather than linked. A verified
  assertion is still not enough on its own: an account that signs in with a password is refused too,
  and the message routes that person through the credential they already hold. Those guards live in
  ADC's override, not the framework: a non-adopting host gets only the `Auth.ExternalLoginNotSupported`
  default, so the check is ADC's own edge, not a framework guarantee.
- **Not exactly-once account creation across the redirect.** The exchange commits the `User` before
  the UI redeems the code, so an abandoned redemption still creates (or links) the account. That is
  the intended tradeoff (the identity is real the moment the provider vouched for it), but a completed
  challenge can leave a local account whose token pair was never collected.
- **A second credential shape on `User`.** External accounts carry empty password hash and salt and
  rely on `LoginProvider` / `ProviderKey`. Any code that assumes every `User` has a usable password
  has to check `IsExternalLogin` first. The pair is single-valued, so a person holds at most one
  provider link, which is exactly what the first guard enforces.

**Adoption is one app deep, by design.** ADC's Identity module wires the whole flow: a sealed
`OAuthController` subclass carrying the `[ApiController]` / `[Route("auth/oauth")]` / `[ApiVersion("1.0")]`
attributes (the base cannot reliably inherit them), an `AuthenticationService` that overrides
`ExternalLoginAsync`, an Identity service host that calls `AddExternalAuthProviders`, and an AppHost
that passes the UI's HTTPS endpoint to the service as `OAuth__UIBaseUrl` so the post-exchange redirect
lands on the right host. MMCA.Store does none of this. It registers no OAuth schemes, defines no
`OAuthController`, adds no provider columns to its `User`, and leaves `ExternalLoginAsync` at the
not-supported default. Store's Identity story stays local-credential and RS256 only. That is not a gap
to close: partial adoption is the framework's model (ship the capability, let each app opt in), the
same shape as the permission and polyglot-persistence opt-ins.

## Apply this even without MMCA

The shape ports to any app that wants social login without a second identity system:

1. **Terminate federation at the edge.** Exchange the external principal for your own token the moment
   the callback returns, and keep exactly one internal identity. Downstream code should never see a
   provider token.
2. **Never put tokens on a redirect URL.** Put a single-use, short-TTL, server-side code on the URL and
   swap it for the tokens over an out-of-band POST. A redirect is a GET, and GETs get logged.
3. **Treat an email match as evidence, not proof.** Matching an incoming external email to an existing
   user is where account takeover lives. Link only when the provider asserts the address is verified
   *and* nobody can already sign into that account with a password. Refuse everything else and route
   the person through the credential they already hold.
4. **Make it inert until configured.** Gate each provider on its client id and default the exchange to
   a not-supported failure, so a host with no secrets behaves exactly as before.
5. **Split the handshake from account creation.** The OAuth dance is generic; the user factory, default
   role, claim set, and link guards are yours. Keep them on opposite sides of an interface.

The takeaway: **social login does not have to mean a second identity system or a token in the address
bar. Federate at the edge, exchange the external identity for your own JWT behind a single-use
server-side code, attach a provider to an existing account only when the address is provider-verified
and nobody can already sign into it with a password, and every layer downstream keeps validating the
one token it already understands.**

---

**What we covered:** why rolling your own social login leaks the session token through the redirect URL
(browser history, the `Referer` header, and proxy logs) and why storing provider tokens you never call
is needless risk, how MMCA.Common closes both gaps with a config-gated `AddExternalAuthProviders` for
Google, GitHub and Apple, a throwaway ten-minute `ExternalLogin` cookie, and an `OAuthControllerBase`
that swaps the external identity for a local JWT pair and hands the UI a single-use, cache-backed code
bound to the client's own state value instead of the tokens, how `ExternalLoginAsync` resolves a local
`User` by provider, then by a guarded email match (already linked elsewhere, not provider-verified, or
still holding a local password are all refusals), then by create, and the honest costs: a per-app
opt-in that is easy to half-wire, link guards that are ADC-level rather than framework ones, a
not-exactly-once account creation across the redirect, a second credential shape on `User`, and
adoption that is ADC-only while Store stays local-credential and RS256 only.

**Next in the series:** refresh tokens that rotate per device, stored only as hashes in a
`RefreshSession` row, and the reuse detection that turns a replayed token into a self-limiting,
revoke-on-reuse forced re-login.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-036 for the decision record, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-036 (external OAuth login) in the docs site.

*Tags: .NET, C Sharp, OAuth, Security, Software Architecture*

*Notes: re-verified every type, behavior and anchor against source on 2026-09-19 (framework v1.205.0).
Three behavior changes since the 2026-08-19 pass are reflected above: Apple joined Google and GitHub as
a third config-gated provider, the by-email link now runs three guards instead of one, and token
issuance moved to the shared refresh-session workflow. Every anchor in `OAuthControllerBase.cs`,
`ExternalAuthExtensions.cs`, ADC's `AuthenticationService.cs` / `User.cs` and both ADRs moved; three of
the cited MMCA.Common.UI file paths gained an `Auth/` or `Auth/OAuth/` folder level, and the MAUI broker
moved into `Capabilities/Auth/`. Anchors below are this run's.
`MMCA.Common.API`:
`OAuthControllerBase` (abstract, primary ctor takes `IAuthenticationService`/`ICacheService`/`IConfiguration`;
`Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:35-38`), the exchange-code prefix
`"oauth-exchange:"` (`:45`), the client-state properties key `ClientStateItemKey = "clientState"` (`:49`)
and the two-minute `OAuthExchangeCodeLifetime` (`:50`). Challenge endpoints `GoogleLogin`
`[HttpGet("google")]` (`:57-60`), `GitHubLogin` `[HttpGet("github")]` (`:67-70`) and `AppleLogin`
`[HttpGet("apple")]` (`:80-83`), each taking `[FromQuery] Uri? returnUrl` and `[FromQuery] string? state`.
`CompleteAsync` `[HttpGet("complete")]` (`:97-100`) authenticates the external cookie (`:103`), reads the
stashed pair via `ReadChallengeState` (`:115`; method `:151-152`), computes
`mobileReturnUrl = GetAllowedMobileReturnUrl(returnUrl)` (`:116`), extracts
`(provider, providerKey, email, firstName, lastName)` (`:118`, `ExtractClaims` `:214-222`), calls
`ExternalLoginAsync` (`:125-126`), on failure `RedirectError(...)` (`:130`; `GetErrorCode` `:254-255`,
`RedirectError` `:264-267`, `RedirectToLoginWithError` `:257-258`), `SignOutAsync(ExternalLoginScheme)`
(`:136`), mints the code via `Convert.ToHexString(RandomNumberGenerator.GetBytes(32))` (`:141`) and
`cacheService.SetAsync(...)` (`:142-143`), then redirects via
`BuildSuccessRedirectUrl(uiBaseUrl, mobileReturnUrl, exchangeCode, returnUrl, clientState)` (`:145`;
five-argument builder `:154-168`, appending `&state=` only when the client supplied one `:161-163`, never
a token). `ExchangeAsync` `[HttpPost("exchange")]` / `[NonIdempotent]` / `[AllowAnonymous]` (`:177-181`,
attribute at `:178`) rejects a blank code up front (`:185-188`), detects a cache miss via empty
`AccessToken` and returns 400 `InvalidCode` (miss check `:195-198`; `InvalidCode` `:206-212`), and burns
the code via `RemoveAsync` (`:201`). `ChallengeProvider` (`:301-317`) sets
`RedirectUri = "/auth/oauth/complete"`, stashes `returnUrl`, and stashes the opaque client state under
`ClientStateItemKey` so the client can prove the code belongs to the flow it started (`:310-313`).
ADR-043 native-callback: `GetAllowedMobileReturnUrl` returns the stashed URL only when it is an absolute
URI whose custom scheme is in `OAuth:AllowedReturnUrlSchemes`, and `http`/`https` never match, so no open
redirect (`:276-290`); a missing or empty section means no allowlist (`:287-288`); `AppendQuery` uses
`OriginalString` (`:292-299`). ADR-043 record:
`Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md` (`## Status` `:3`, Accepted
2026-07-15 with revisions recorded through 2026-08-31 (`:234`), 2026-09-07 (`:281`) and 2026-09-11
(`:302`); `## Decision` `:71`, `## Trade-offs` `:119`).
Native client broker (ADR-043): `IExternalAuthBroker`
(`Source/Presentation/MMCA.Common.UI/Services/Capabilities/Auth/IExternalAuthBroker.cs:10`) with the MAUI
`MauiExternalAuthBroker` (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:20`),
which holds an `OAuthFlowStateStore` (`:24`), begins a per-attempt state because the completion page
refuses a code that does not belong to an attempt started on this device (`:63-66`), puts it on the
challenge URL (`:70-71`), runs `WebAuthenticator.Default.AuthenticateAsync` (`:75-81`), pulls `code`
(`:83-88`) and the returned `state` (`:90`), then `NavigateTo("/auth/oauth-complete?code=...&state=...")`
(`:94-98`) to hand off to the shared completion page (it does NOT POST `ExchangeAsync` itself); web heads
get the null default. `Login.razor`
(`Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor`) gates the whole block on
`_hasExternalProviders` (`:87`, field `:174`, assigned from the three provider flags `:180`), branches per
provider (`AppleEnabled` `:98`, `GoogleEnabled` `:119`, `GitHubEnabled` `:140`), checks
`ExternalAuthBroker.IsAvailable` (`:100`, `:121`, `:142`) and calls `SignInWithBrokerAsync` (`:104`,
`:125`, `:146`). `ExternalAuthExtensions`
(`Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs`):
`ExternalLoginScheme = "ExternalLogin"` (`:28`), `AddExternalAuthProviders(IConfiguration)` (`:38`) reads
`OAuth:Google:ClientId` / `OAuth:GitHub:ClientId` / `OAuth:Apple:ClientId` (`:40-43`), returns untouched
when all three are unset (`:47-52`), calls `AddAuthentication()` with no argument (`:56`), adds the
`ExternalLogin` cookie named `mmca_external_login`, HttpOnly, `SameSite=Lax`, 10-minute `ExpireTimeSpan`
(`:83-92`), then registers each configured provider (`:60-73`). `AddGoogleProvider` throws on a missing
`ClientSecret` (`:98-100`), `AddGitHubProvider` throws likewise (`:110-112`) and adds
`Scope.Add("user:email")` (`:117`), and `AddAppleProvider` (`:121-145`) sets `GenerateClientSecret = true`
(`:130`) and throws on a missing `Apple:TeamId` (`:131-133`), `Apple:KeyId` (`:134-136`) or
`Apple:PrivateKeyPem` (`:137-139`).
`IAuthenticationService.ExternalLoginAsync` default returns `Error.Failure("Auth.ExternalLoginNotSupported", ...)`
(`Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:139`).
`OAuthCodeExchangeRequest` (`Source/Core/MMCA.Common.Shared/Auth/Requests/OAuthCodeExchangeRequest.cs`).
UI button gating `ConfigurationOAuthUISettings`
(`Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/ConfigurationOAuthUISettings.cs`): `GoogleEnabled`
(`:16`), `GitHubEnabled` (`:19`), `AppleEnabled` (`:22`), all read from `OAuth:<Provider>` (`:29-31`).
ADC adoption: `AuthenticationService.ExternalLoginAsync` overrides the interface default and opens the
transaction (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:193`,
`ExecuteInTransactionAsync` `:200-202`); the ctor takes `IExternalLoginEmailVerifier` (`:51`). The body runs
in `ExternalLoginCoreAsync` (`:205`): lookup by `LoginProvider`+`ProviderKey` where-clause (`:214-215`), the
provider-supplied email validated with `Email.Create(email)` (`:233`) returning
`Error.Validation("Auth.ExternalEmailInvalid", ...)` on failure (`:236-239`) before the by-email lookup runs
(`:243-246`). An email match goes to `TryLinkProviderToExistingAccountAsync` (`:316-366`), which runs three
guards: `Error.Conflict("Auth.ExternalProviderAlreadyLinked", ...)` when the account is already linked to a
different provider, checked ahead of the verifier (`:325-331`);
`externalLoginEmailVerifier.IsCurrentExternalLoginEmailVerifiedAsync()` (`:338-339`) with
`Error.Unauthorized("Auth.ExternalEmailNotVerified", ...)` when the provider asserted nothing (`:343-346`);
and the SEC-ADC-01 pre-registration guard `if (existingUser.HasLocalPassword)` returning
`Error.Conflict("Auth.ExternalLinkRequiresLocalSignIn", ...)` (`:356-362`). Only past all three does
`existingUser.LinkExternalProvider(...)` run (`:364`). The create branch asks the same verifier (`:265-266`)
without gating on it and passes the answer to `User.CreateExternal(..., emailVerified)` (`:272-273`,
`AddAsync` `:280`); new users raise `UserRegistered(..., emailVerified)` (`:294-295`) while the local
registration path hard-codes `EmailVerified: false` (`:170`, reasoning at `:160-165`), which is why the
downstream speaker auto-link runs only on a provider-asserted address (`:286-291`). Token issuance is
`IssueTokensAsync(user, cancellationToken: cancellationToken)` (`:304`), opening a per-device refresh
session (hash at rest, per-user cap, rotation chain) instead of stamping a plaintext token on the
aggregate (`:299-303`); no `new AuthenticationResponse(...)` literal remains on this path. The guard
interface `IExternalLoginEmailVerifier`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`,
`IsCurrentExternalLoginEmailVerifiedAsync` `:19`).
`User.CreateExternal` (empty hash/salt, `UserRole.Attendee` at `:266`, sixth `emailVerified` parameter
`:253`, `IsEmailConfirmed = emailVerified` `:271`;
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:247-275`),
`LinkExternalProvider` (`:300-304`), `IsExternalLogin => LoginProvider is not null` (`:130`),
`HasLocalPassword => PasswordHash.Length > 0` (`:151`), `LoginProvider` (`:102`) / `ProviderKey` (`:105`),
`Anonymize` clears both (`:494-495`). ADC `OAuthController` sealed subclass with
`[ApiController][Route("auth/oauth")][ApiVersion("1.0")]`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:17-20`). Service host
`AddExternalAuthProviders(builder.Configuration)` call
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:197`, behind an "External OAuth providers
(Google / GitHub / Apple)" comment banner at `:189`), ADC allow-lists the `atldevcon` scheme
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:84`). AppHost
`OAuth__UIBaseUrl = ui HTTPS endpoint` (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:464`; prod
`infra/main.bicep:1690`, inside the `hasAnyOAuth` branch at `:1689`, the `hasAnyOAuth` variable itself at
`:169`, which now ORs `hasAppleOAuth`). Store non-adoption unchanged: no `OAuthController`,
`AddExternalAuthProviders` or `ExternalLoginAsync` override under `MMCA.Store`.
The single code block is illustrative, trimmed (comments and branches condensed) from
`OAuthControllerBase.CompleteAsync`/`ExchangeAsync` (`:97-203`) with named calls, argument lists and cache
keys matching current source. ADR-036
(`Website/docs-src/adr/036-external-oauth-login.md`) is titled "External OAuth Login (Federated
Google/GitHub/Apple) with Local-JWT Exchange" (`:1`); its `## Status` spans `:3-13`, including the
2026-09-07 revision (link-by-email requires both a provider-verified address and an account with no
password) and the 2026-09-19 revision (Apple as a third provider, three link guards, refresh-session
issuance, the provider assertion carried into the new account's confirmation state); the
three-ways-plus-three-guards decision bullet is `:73-118`, the "verified-email guard is ADC-level, not
framework-provided" trade-off is `:178-193`, and the ADC-only adoption paragraph is `:143-151`.
Published package count "nineteen" is `MMCA.Common/FACTS.md:19`.*
