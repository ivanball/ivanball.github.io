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
await cacheService.SetAsync(                                  // prefix "oauth-exchange:", lifetime 2 minutes
    OAuthExchangeCodePrefix + exchangeCode, response, OAuthExchangeCodeLifetime, HttpContext.RequestAborted);
// Web target normally; the allow-listed native scheme when mobileReturnUrl is non-null (ADR-043).
return Redirect(BuildSuccessRedirectUrl(uiBaseUrl, mobileReturnUrl, exchangeCode, returnUrl, clientState));

// OAuthControllerBase.ExchangeAsync (POST, [NonIdempotent], out of band): burn the code on first use.
if (string.IsNullOrWhiteSpace(request.Code)) { return InvalidCode(); }
var cacheKey = OAuthExchangeCodePrefix + request.Code;
// The shared store, not a local copy: a code burned on another replica must be a miss here.
var response = await cacheService.GetFromSharedStoreAsync<AuthenticationResponse>(cacheKey, cancellationToken);
if (string.IsNullOrEmpty(response.AccessToken)) { return InvalidCode(); }  // missing/replayed/expired => 400
await cacheService.RemoveAsync(cacheKey, cancellationToken);              // single-use
return Ok(response);
```

Read the redirect line again: it carries `code=...`, not `access_token=...`. The access and refresh
tokens sit in the server-side cache the whole time. They reach the browser only through a same-origin
POST response body, which history, the `Referer` header, and upstream access logs do not record. The
exchange reads the code from the shared cache store rather than a per-replica copy, so a code already
burned on one replica is a miss on every other. The
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
accounts stay unconstrained. An existing account, whether matched by provider key or linked by email,
is refused before anything is saved when an administrator has locked it; a brand-new account cannot
be locked. Whichever of the three paths runs, the exchange finishes through the
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

*Notes: re-verified against source on 2026-10-02 (framework v1.221.0). Body changes in this pass: the
`ExchangeAsync` half of the code block reads the code through
`cacheService.GetFromSharedStoreAsync<AuthenticationResponse>(cacheKey, ...)` (it showed a stale
`GetAsync` call) and the `SetAsync` call names `OAuthExchangeCodePrefix` / `OAuthExchangeCodeLifetime`
as source does; the paragraph after the block states the shared-store read; and "Finding the local
user" states the administrator-lock refusal for existing accounts. Every anchor after
`OAuthControllerBase.cs:190` moved +2, every `Login.razor` anchor moved +1, ADC's
`AuthenticationService.cs` anchors moved (-1 through the create branch, +12 from the lock check on),
and the Identity service host and `main.bicep` anchors moved. Anchors below are this run's; those
marked (audit) carry the 2026-10-02 audit's CONFIRMED verdict and were not re-read in this pass.
`MMCA.Common.API`: `OAuthControllerBase`
(`Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs`; primary ctor `:35-38`, prefix
`"oauth-exchange:"` `:45`, `ClientStateItemKey` `:49`, two-minute `OAuthExchangeCodeLifetime` `:50`,
`GoogleLogin` `:57-60`, `GitHubLogin` `:67-70`, `AppleLogin` `:80-83`, all (audit)). `CompleteAsync`
`[HttpGet("complete")]` (`:97-100`) authenticates the external cookie (`:103`), reads the stashed pair via
`ReadChallengeState` (`:115`; method `:151-152`), computes `GetAllowedMobileReturnUrl(returnUrl)` (`:116`),
extracts `(provider, providerKey, email, firstName, lastName)` (`:118`, `ExtractClaims` `:216-224`),
redirects `missing_claims` when key or email is absent (`:120-123`), calls `ExternalLoginAsync`
(`:125-126`), on failure `RedirectError(...)` (`:130`; `GetErrorCode` `:256-257`,
`RedirectToLoginWithError` `:259-260`, `RedirectError` `:266-269`), `SignOutAsync(ExternalLoginScheme)`
(`:136`), mints the code via `Convert.ToHexString(RandomNumberGenerator.GetBytes(32))` (`:141`), stashes
it with `cacheService.SetAsync(OAuthExchangeCodePrefix + exchangeCode, response, OAuthExchangeCodeLifetime, ...)`
(`:142-143`), then redirects via `BuildSuccessRedirectUrl(uiBaseUrl, mobileReturnUrl, exchangeCode, returnUrl, clientState)`
(`:145`; builder `:154-168`, `&state=` only when the client supplied one `:161-163`, the web target
carrying `returnUrl` `:166`, the native target `:167`, never a token). `ExchangeAsync`
`[HttpPost("exchange")]` / `[NonIdempotent]` / `[AllowAnonymous]` (`:177-181`, `[NonIdempotent]` at `:178`)
rejects a blank code (`:185-188`), builds the key once (`:190`), reads it with
`GetFromSharedStoreAsync<AuthenticationResponse>` so a code burned on another replica is a miss (`:196`,
reasoning `:192-195`), returns 400 `InvalidCode` on an empty `AccessToken` (`:197-200`; `InvalidCode`
`:208-214`), burns the code via `RemoveAsync` (`:203`) and returns `Ok(response)` (`:205`).
`ChallengeProvider` (`:303-319`) sets `RedirectUri = "/auth/oauth/complete"` (`:307`), stashes `returnUrl`
(`:310`) and the opaque client state under `ClientStateItemKey` (`:312-315`).
ADR-043 native callback: `GetAllowedMobileReturnUrl` (`:278-292`) returns null for a non-absolute URI or
an `http`/`https` scheme (`:280-285`), reads `OAuth:AllowedReturnUrlSchemes` null-tolerantly so a missing
or empty section means no allowlist (`:287-290`) and matches the scheme (`:291`); `AppendQuery` uses
`OriginalString` (`:294-301`). ADR-043 record
(`Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md`): `## Status` `:3`,
`## Decision` `:74`, `## Trade-offs` `:122`, dated revisions from 2026-07-28 (`:144`) through 2026-10-01
(`:376`), including 2026-08-31 (`:237`), 2026-09-07 (`:284`), 2026-09-11 (`:305`) and 2026-09-25 (`:350`);
the last two are anchor passes that change no decision.
Native client broker (ADR-043, all (audit)): `IExternalAuthBroker`
(`Source/Presentation/MMCA.Common.UI/Services/Capabilities/Auth/IExternalAuthBroker.cs:10`) and
`MauiExternalAuthBroker` (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:20`;
`OAuthFlowStateStore` `:24`, per-attempt state `:63-66`, state on the challenge URL `:70-71`,
`WebAuthenticator.Default.AuthenticateAsync` `:75-81`, `code` `:83-88`, returned `state` `:90`,
`NavigateTo("/auth/oauth-complete?code=...&state=...")` `:94-98`; it does not POST `ExchangeAsync`
itself). `Login.razor` (`Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor`) gates the block on
`_hasExternalProviders` (`:88`, field `:175`, assigned from the three provider flags `:181`), branches
per provider (`AppleEnabled` `:99`, `GoogleEnabled` `:120`, `GitHubEnabled` `:141`), checks
`ExternalAuthBroker.IsAvailable` (`:101`, `:122`, `:143`) and calls `SignInWithBrokerAsync` (`:105`,
`:126`, `:147`; method `:219`).
`ExternalAuthExtensions` (`Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs`):
`ExternalLoginScheme = "ExternalLogin"` (`:28`), `AddExternalAuthProviders(IConfiguration)` (`:38`),
`AddAuthentication()` with no argument (`:56`), cookie `mmca_external_login` (`:86`) with a 10-minute
`ExpireTimeSpan` (`:91`), Google `ClientSecret` throw (`:99-100`), GitHub `ClientSecret` throw
(`:111-112`) and `Scope.Add("user:email")` (`:117`), Apple `GenerateClientSecret = true` (`:130`) with
throws on a missing `Apple:TeamId` (`:131-133`), `Apple:KeyId` (`:134-136`) or `Apple:PrivateKeyPem`
(`:137-139`); the three `ClientId` reads (`:40-43`), the untouched return (`:47-52`), the provider
registrations (`:60-73`) and the cookie block (`:83-92`) are (audit).
`IAuthenticationService.ExternalLoginAsync` default returns `Auth.ExternalLoginNotSupported`
(`Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:139`, (audit)).
`OAuthCodeExchangeRequest` (`Source/Core/MMCA.Common.Shared/Auth/Requests/OAuthCodeExchangeRequest.cs`).
`ConfigurationOAuthUISettings` (`Source/Presentation/MMCA.Common.UI/Services/Auth/OAuth/ConfigurationOAuthUISettings.cs`;
`GoogleEnabled` `:16`, `GitHubEnabled` `:19`, `AppleEnabled` `:22`, read from `OAuth:<Provider>` `:29-31`, (audit)).
ADC adoption (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs`):
the ctor takes `IExternalLoginEmailVerifier` (`:54`); `ExternalLoginAsync` (`:192`) opens the transaction
(`ExecuteInTransactionAsync` `:199-201`) around `ExternalLoginCoreAsync` (`:204`), which looks up by
`LoginProvider` + `ProviderKey` (`:213-216`), validates the claim with `Email.Create(email)` (`:232`),
returns `Auth.ExternalEmailInvalid` on failure (`:235-238`), looks up by the validated email (`:242-245`)
and sends a match to `TryLinkProviderToExistingAccountAsync` (`:249`; method `:328-378`): the
one-provider guard `Auth.ExternalProviderAlreadyLinked` ahead of the verifier (`:337-343`), the verifier
call (`:350-351`) with `Auth.ExternalEmailNotVerified` (`:353-359`), and the SEC-ADC-01 guard
`if (existingUser.HasLocalPassword)` returning `Auth.ExternalLinkRequiresLocalSignIn` (`:368-374`,
reasoning `:361-367`) before `existingUser.LinkExternalProvider(...)` (`:376`). The create branch asks the
same verifier (`:264-265`) without gating on it, passes the answer to `User.CreateExternal(..., emailVerified)`
(`:271-272`) and adds the user (`:279`). An existing account (matched or linked) is refused when locked
(`CheckNotLocked`, `:288-295`; a new account cannot be locked). New users raise
`UserRegistered(..., emailVerified)` (`:306-307`, speaker auto-link reasoning `:299-303`) while local
registration hard-codes `EmailVerified: false` (`:168-169`, reasoning `:160-163`). Token issuance is
`IssueTokensAsync(user, cancellationToken: cancellationToken)` (`:316`, refresh-session reasoning
`:311-315`). `IExternalLoginEmailVerifier`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`,
`IsCurrentExternalLoginEmailVerifiedAsync` `:19`, (audit)).
`User` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs`): `CreateExternal`
(`:247`, `bool emailVerified = false` `:253`, `UserRole.Attendee` `:266`, `IsEmailConfirmed = emailVerified`
`:271`), `LinkExternalProvider` (`:300`), `IsExternalLogin => LoginProvider is not null` (`:130`),
`HasLocalPassword => PasswordHash.Length > 0` (`:151`), `LoginProvider` (`:102`) / `ProviderKey` (`:105`),
`Anonymize` clears both (`:494-495`).
ADC `OAuthController` sealed subclass with `[ApiController][Route("auth/oauth")][ApiVersion("1.0")]`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:17-20`, (audit)).
Service host `services.AddExternalAuthProviders(builder.Configuration)`
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:196`, behind the "External OAuth providers
(Google / GitHub / Apple)" banner at `:188`); ADC allow-lists `atldevcon`
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:84`, also recorded by ADR-043's
2026-09-25 revision). AppHost `OAuth__UIBaseUrl` (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:464`,
(audit)); prod `OAuth__UIBaseUrl` at `MMCA.ADC/infra/main.bicep:1799`, inside the `hasAnyOAuth ? [`
branch at `:1798`, with the `hasAnyOAuth` variable at `:169` ORing `hasAppleOAuth`.
Store non-adoption: a Grep over `MMCA.Store/Source` `*.cs` on 2026-10-02 finds no `OAuthControllerBase`,
`AddExternalAuthProviders`, `ExternalLoginAsync`, `class OAuthController` or `LoginProvider`.
The single code block is illustrative, trimmed (comments and branches condensed) from
`OAuthControllerBase.CompleteAsync`/`ExchangeAsync` (`:97-206`), with named calls, argument lists and
cache-key constants matching current source.
ADR-036 (`Website/docs-src/adr/036-external-oauth-login.md`): title "External OAuth Login (Federated
Google/GitHub/Apple) with Local-JWT Exchange" (`:1`); `## Status` spans `:3-13`, with the 2026-09-07
revision at `:5` and the 2026-09-19 revision at `:10`; `## Decision` `:32`, the
three-ways-plus-three-guards bullet `:73-118`, the ADC-only adoption paragraph `:143-152` (Store at
`:149`); `## Rationale` `:153`; `## Trade-offs` `:172`, the "verified-email guard is ADC-level, not
framework-provided" bullet `:178-193`; `## Revision (2026-09-07)` `:205`; `## Revision (2026-10-01)` `:255`
(an anchor refresh only). The body states no package count; FACTS records 22 published packages
(`MMCA.Common/FACTS.md:19`).*
