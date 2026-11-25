# Google, GitHub and Apple login without leaking tokens: external OAuth behind your own JWTs

> Series: MMCA.Common · Article #26 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-036, ADR-043 ·
> Status: grounded in `Website/docs-src/adr/036-external-oauth-login.md`, `MMCA.Common.API`'s `OAuthControllerBase`,
> `OAuthReturnUrls` and `ExternalAuthExtensions`, the `IAuthenticationService.ExternalLoginAsync` default, and ADC's
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
`OAuth:Apple:ClientId` is set. Beside those three, every `OAuth:Oidc:<Name>` section that sets a
`ClientId` becomes a generic OpenID Connect scheme named `<Name>` (Entra ID, Okta, any OIDC issuer),
running the authorization code flow with PKCE into the same handoff cookie, with its callback at
`/auth/callback/<Name>`. With the three built-in client ids absent and no OIDC section, it returns the
service collection untouched, so a host with no OAuth secrets keeps exactly the JWT-only pipeline
`AddCommonAuthentication` gave it. It calls `AddAuthentication()` with no argument on purpose, so the
new schemes append rather than displacing the JWT bearer default. Fail-fast is per provider: Google and
GitHub throw when a `ClientId` is set without its matching `ClientSecret`, while Apple has no static
client secret at all (the handler mints a short-lived ES256 assertion instead,
`GenerateClientSecret = true`) and throws on a missing `OAuth:Apple:TeamId`, `OAuth:Apple:KeyId` or
`OAuth:Apple:PrivateKeyPem`. Those throws live in each scheme's options callback, so they fire when the
options are first built (the first request through the authentication middleware), not at host build.
The OIDC sections are read and validated eagerly instead, so a misconfigured one fails startup naming
its key. Either way a half-wired provider fails with a named configuration error before any sign-in
reaches the provider.

**A ten-minute cookie carries the external principal, and it dies at the exchange.** The provider
callback signs into a dedicated `ExternalLogin` cookie scheme (cookie name `mmca_external_login`,
HttpOnly, `SameSite=Lax`, a ten-minute lifetime). That cookie exists only to hand the external claims,
with the stashed `returnUrl` and client state, from the provider callback to the controller. It is
never the app session, and nothing persists provider tokens beyond it. The Google, GitHub and Apple
handlers set `SaveTokens = true`, so their provider tokens do ride inside that cookie's ticket for its
short life, until `CompleteAsync` signs it out; the generic OIDC scheme sets `SaveTokens = false`, so
its ID token never enters the cookie at all. GitHub is asked for the `user:email` scope, because its
default scope omits the email the exchange needs to match an account. Apple returns its callback as a
cross-site form POST (`response_mode=form_post` is forced by the name and email scopes), which the
middleware handles at `/auth/callback/apple` like any other provider callback.

**The exchange swaps the external identity for a local JWT, then hides the tokens behind a single-use
code.** The challenge endpoints (`GET auth/oauth/google`, `GET auth/oauth/github`,
`GET auth/oauth/apple`, and `GET auth/oauth/{provider}` for a configured OIDC scheme, which answers 404
for an unknown name) redirect to the provider and back to `OAuthControllerBase.CompleteAsync`. A fifth
route, `GET auth/oauth/discover?email=`, is home-realm discovery: anonymous and rate limited per client
IP, it maps the address's domain to the OIDC provider whose `Domains` list claims it, so the sign-in
page can offer one "Sign in with your organization" step, and it reveals which provider owns a domain,
never whether an account exists. Each challenge takes an optional opaque `state` value the client
round-trips through the provider, which the challenge stashes in the authentication properties and the
completion redirect hands back, so the client can prove the code belongs to the flow it started. The
server never interprets that value.
`CompleteAsync` authenticates the `ExternalLogin` cookie, pulls
`(provider, providerKey, email, firstName, lastName)` off the external principal (the key and email
from the standard name-identifier and email claims, the name from the given-name and surname claims,
falling back to GitHub's display-name claim and finally a `User` placeholder; Apple's name is added
from its callback form when the ticket is created), and calls
`IAuthenticationService.ExternalLoginAsync`. On success it signs the external cookie straight out,
mints a 32-byte opaque code, stashes the token pair server-side in the cache under a two-minute TTL,
and redirects to the UI carrying that code and the client's state (the web redirect also carries the
non-secret `returnUrl`), never a token. The UI then POSTs the code back to `ExchangeAsync` out of band
to collect the tokens.

```csharp
// OAuthControllerBase.CompleteAsync (trimmed): swap the external identity for a local JWT pair,
// then hand the UI only a single-use code, never the tokens.
var (returnUrl, clientState) = ReadChallengeState(authenticateResult.Properties);  // stashed at challenge time
var mobileReturnUrl = OAuthReturnUrls.GetAllowedMobileReturnUrl(configuration, returnUrl);  // native scheme, or null for web
var result = await authenticationService.ExternalLoginAsync(
    providerName, providerKey, email, firstName, lastName);   // by provider, guarded link, or create
if (result.IsFailure)
{
    return Redirect(OAuthReturnUrls.ErrorRedirectUrl(uiBaseUrl, mobileReturnUrl, GetErrorCode(result.Errors)));
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
if (distributedLock is null) { return await RedeemExchangeCodeAsync(cacheKey, cancellationToken); }
// Multi-replica hosts: the read and the burn are one critical section under a distributed lock.
var handle = await distributedLock.TryAcquireAsync(
    $"lock:{cacheKey}", RedeemLockTimeToLive, RedeemLockWait, cancellationToken);  // 10 s lease, 5 s wait
if (handle is null) { return InvalidCode(); }                 // contended redeem => 400, never a second success
await using (handle) { return await RedeemExchangeCodeAsync(cacheKey, cancellationToken); }

// OAuthControllerBase.RedeemExchangeCodeAsync: the shared store, not a local copy, so a code
// burned on another replica is a miss here.
var response = await cacheService.GetFromSharedStoreAsync<AuthenticationResponse>(cacheKey, cancellationToken);
if (string.IsNullOrEmpty(response.AccessToken)) { return InvalidCode(); }  // missing/replayed/expired => 400
await cacheService.RemoveAsync(cacheKey, cancellationToken);              // single-use
return Ok(response);
```

Read the redirect line again: it carries `code=...`, not `access_token=...`. The access and refresh
tokens sit in the server-side cache the whole time. They reach the browser only through a same-origin
POST response body, which history, the `Referer` header, and upstream access logs do not record. The
exchange reads the code from the shared cache store rather than a per-replica copy, so a code already
burned on one replica is a miss on every other. That alone leaves a race: two replicas that both read
before either removes would both hand out the token pair. So a controller subclass that passes an
`IDistributedLock` to the base's four-argument constructor gets the read and the burn inside one lock
on `lock:{cacheKey}` (a ten-second lease, a five-second wait), and a redeem that cannot take the lock
is answered as an invalid code. A subclass that keeps the three-argument constructor gets no lock and
the plain read-then-burn, which is single-use only per replica. The
code is burned on first read, so a leaked or replayed code buys nothing, and a blank, missing,
replayed, expired, or contended code returns HTTP 400. The exchange is marked `[NonIdempotent]`, because
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
deep link carrying someone else's code cannot sign the app in as them. Web heads, where the broker
reports itself unavailable, get a button whose click mints the same per-attempt state in device
storage and then navigates to the challenge URL with that state attached, so the web flow is
state-bound too; if storage will not keep the attempt, the page says so and disables the redirect
buttons instead of leaving for a provider round trip the completion page would refuse. The code
still rides the redirect and a token never does, so the invariant holds identically across web and
native: the only thing that differs is where the code lands.

## Finding the local user, three ways

`ExternalLoginAsync` is where the external identity becomes one of your users, and it resolves in a
deliberate order inside a single transaction. First it looks for a user already carrying this
`LoginProvider` + `ProviderKey`: a returning social user. If there is none, it
validates the provider-supplied email with `Email.Create` (this is the one address in the system no
request validator has already gated, and an unparseable claim returns `Auth.ExternalEmailInvalid`
rather than turning the next query into "find the users whose email is null"), then looks the account
up by that validated value.

When an account already owns that email, nothing is linked until three guards pass, and they are
strict on purpose. **One provider link per user:** any account that already carries an external
login is refused with `Auth.ExternalProviderAlreadyLinked`, because the aggregate holds a single
`(LoginProvider, ProviderKey)` pair and a second link would overwrite the first and strand the
original login, which on a pure-OAuth account has no password to fall back on. That includes the
*same* provider under a different key: this branch is reached only after the provider-plus-key lookup
missed, and a different key is a different account at the provider, so re-keying would hand this
account to it. That check runs ahead
of the verifier, so saying no costs no external round trip. **A provider-asserted verified email:** an
injected `IExternalLoginEmailVerifier` is asked whether the provider asserted this address as
verified, and an unverified assertion is refused with `Auth.ExternalEmailNotVerified`. **No local
password:** even on a verified assertion, an account whose `HasLocalPassword` is true is refused with
`Auth.ExternalLinkRequiresLocalSignIn`, whose message tells the person to sign in with their email
and password because that provider's sign-in is not available for the account (the login page has
no resource of its own for this code, so a browser shows the generic refusal: try again or use
another sign-in method). The verifier proves only the provider's side of the
address, so only an account nobody can already sign into with a password is claimable by an email
match; everyone else proves possession first. Once all three pass, `User.LinkExternalProvider`
attaches the provider to the existing account and marks its email confirmed, since the link only ever
follows a verified assertion.

When no account owns the email at all, the flow *creates* one through `User.CreateExternal`, an
`Attendee` with empty password hash and salt. The verifier runs on this branch too, but it does not
gate the create (GitHub's OAuth flow asserts nothing, and refusing would close GitHub sign-up): the
assertion rides along as a sixth `emailVerified` argument, which starts the account confirmed when the
provider vouched for the address and unconfirmed otherwise. An unconfirmed account is asked to confirm
its address the way a local registration is: the create schedules the confirmation email on the same
unit of work as the account, so the two commit together or not at all.

An external user is a `User` with an empty password hash and salt, carrying `LoginProvider` and
`ProviderKey`; `IsExternalLogin` is simply `LoginProvider is not null`. The third guard asks a
different question, `HasLocalPassword` (a non-empty password hash), and the two are not complements:
an account provisioned by an invitation link, a service account, and an account whose password was
cleared all have neither a password nor a provider link, so an external login whose provider verified
the same address can claim any of them by email. The linkage is two nullable columns
(`LoginProvider varchar(50)`, `ProviderKey varchar(256)`) plus a unique index over the pair filtered
to rows where both are non-null and the row is not soft-deleted, so two live external identities
cannot collide onto one account while local (null, null) accounts stay unconstrained. An existing
account, whether matched by provider key or linked by email, then passes two gates before anything is
saved. An administrator lock refuses it outright. Next comes the privileged-account email rule the
password and refresh paths share: a confirmed account passes; an unconfirmed one is confirmed on the
spot when this sign-in's provider asserted the account's own address as verified; otherwise an
Organizer, ContentEditor or speaker-linked account is refused with `Authentication.EmailNotConfirmed`,
and an attendee signs in unconfirmed. A brand-new account cannot be locked and is an attendee, so it
skips both. Whichever of the three paths runs, the exchange finishes through the
shared `IssueTokensAsync` workflow, which opens a refresh *session* for the device (hashed at rest, a
per-user cap, a rotation chain) rather than stamping a plaintext refresh token on the aggregate, and
hands back the same `AuthenticationResponse` shape a password login returns. A brand-new external user
also publishes a post-commit `UserRegistered` integration event, and the one field that differs from
the local registration path decides what happens next: the external event carries the provider's
`emailVerified` assertion, while local registration hard-codes it to `false`, so the downstream
speaker auto-link runs only for a proven address and the rest are logged for an organizer to link by
hand. An invitation sign-in link also counts as proof: its redemption raises `UserRegistered` with
`EmailVerified: true`, because delivery to the mailbox proved the address.

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
  Google's and Apple's `email_verified` claims pass the verifier, and so does a generic OIDC
  provider's when the operator marks it `TrustEmail` and the token asserts it; GitHub's OAuth flow
  asserts nothing, so a GitHub sign-in whose email matches an existing account is refused rather than
  linked. A verified
  assertion is still not enough on its own: an account that signs in with a password is refused too,
  and the refusal sends that person back to the password they already hold (the API message says so
  outright; the login page shows its generic "use another sign-in method" text). Those guards live in
  ADC's override, not the framework: a non-adopting host gets only the `Auth.ExternalLoginNotSupported`
  default, so the check is ADC's own edge, not a framework guarantee.
- **Not exactly-once account creation across the redirect.** The exchange commits the `User` before
  the UI redeems the code, so an abandoned redemption still creates (or links) the account. That is
  the intended tradeoff (the identity is real the moment the provider vouched for it), but a completed
  challenge can leave a local account whose token pair was never collected.
- **A second credential shape on `User`.** External accounts carry empty password hash and salt and
  rely on `LoginProvider` / `ProviderKey`. Any code that assumes every `User` has a usable password
  has to check `HasLocalPassword`, not `IsExternalLogin`, because invitation, service-account and
  cleared-password accounts carry no password and no provider link either. The pair is single-valued,
  so a person holds at most one provider link, which is exactly what the first guard enforces.

**Adoption is one app deep, by design.** ADC's Identity module wires the whole flow: a sealed
`OAuthController` subclass carrying the `[ApiController]` / `[Route("auth/oauth")]` / `[ApiVersion("1.0")]`
attributes (the base cannot reliably inherit them) and taking an `IDistributedLock` it hands to the
four-argument base constructor, so a code redeems once across Identity replicas, an `AuthenticationService` that overrides
`ExternalLoginAsync`, an Identity service host that calls `AddExternalAuthProviders`, and an AppHost
that passes the UI's HTTPS endpoint to the service as `OAuth__UIBaseUrl` so the post-exchange redirect
lands on the right host. MMCA.Store does none of this. It registers no OAuth schemes, defines no
`OAuthController`, adds no provider columns to its `User`, and leaves `ExternalLoginAsync` at the
not-supported default. Store's user sign-in stays local-credential, with RS256 user tokens (the only
other bearer scheme its Identity host registers is the HS256 service token for internal gRPC
callers). That is not a gap
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
is needless risk, how MMCA.Common keeps the session token off the URL and provider tokens out of
storage with a config-gated `AddExternalAuthProviders` for Google, GitHub, Apple and any configured
OpenID Connect issuer, a throwaway ten-minute `ExternalLogin` cookie the exchange signs out, and an
`OAuthControllerBase` that swaps the external identity for a local JWT pair and hands the UI a
single-use, cache-backed code bound to the client's own state value instead of the tokens, how
`ExternalLoginAsync` resolves a local `User` by provider, then by a guarded email match (already linked
elsewhere, not provider-verified, or still holding a local password are all refusals), then by create,
with every existing account still facing the administrator lock and the privileged-account email rule,
and the honest costs: a per-app opt-in that is easy to half-wire, link guards that are ADC-level rather
than framework ones, a not-exactly-once account creation across the redirect, a second credential shape
on `User`, and adoption that is ADC-only while Store's user sign-in stays local-credential with RS256
tokens.

**Next in the series:** refresh tokens that rotate per device, stored only as hashes in a
`RefreshSession` row, and the reuse detection that turns a replayed token into a self-limiting,
revoke-on-reuse forced re-login.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-036 for the decision record, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-036 (external OAuth login) in the docs site.

*Tags: .NET, C Sharp, OAuth, Security, Software Architecture*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`; FACTS records
30 published packages, `:20`; the body states no package count). Prior passes: 2026-10-29, 2026-10-22
at v1.250.0, 2026-10-08 at v1.233.0, 2026-10-02 at v1.221.0; their change history is superseded by the
anchors below.
Body changes in this pass (2026-11-25), each against source read this pass:
(1) Scheme registration names generic OIDC: the untouched early return also requires
`oidcProviders.Count == 0`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:68-74`), the
OIDC sections are read and validated eagerly (`:63-64`), one `AddOpenIdConnect` per section (`:97-106`,
`:118-152`) with code flow and PKCE (`:124-125`), the `ExternalLogin` sign-in scheme (`:126`) and
callback `/auth/callback/{Name}` (`:127`); the class doc names the optional keys and reserved names
(`:30-33`); ADR-036 Revision 2026-11-08 (`Website/docs-src/adr/036-external-oauth-login.md:401-461`).
(2) The cookie paragraph no longer says the cookie carries the principal "and nothing else": Google,
GitHub and Apple set `SaveTokens = true` (`ExternalAuthExtensions.cs:179`, `:195`, `:222`), OIDC sets
`SaveTokens = false` with the "ID token stays out of the short-lived cookie" comment (`:135-138`); the
cookie also carries the stashed `returnUrl` and client state (`OAuthControllerBase.cs:412-425`,
`ChallengeProvider` `:412`, `RedirectUri` `:416`, return-url item `:419`). Cookie attributes re-read:
name `:161`, HttpOnly `:162`, Lax `:165`, 10 minutes `:166`.
(3) Challenge routes: the literal `google` / `github` / `apple` routes
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:115`, `:125`, `:138`),
`GET auth/oauth/{provider}` returning 404 for an unknown name (`:154-162`, doc `:143-153`) and
`GET auth/oauth/discover` on the per-IP auth rate-limit policy (`:174-185`, doc `:164-171`).
(4) Code block: `OAuthReturnUrls.GetAllowedMobileReturnUrl(configuration, returnUrl)` (`:223`) and
`Redirect(OAuthReturnUrls.ErrorRedirectUrl(uiBaseUrl, mobileReturnUrl, GetErrorCode(result.Errors)))`
(`:237`); the helpers live in the internal class `OAuthReturnUrls`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/OAuthReturnUrls.cs:13`, `ErrorRedirectUrl`
`:53-56`, `GetAllowedMobileReturnUrl` `:68-80` with the `http`/`https` refusal `:71-72` and the
`OAuth:AllowedReturnUrlSchemes` read `:80`, `AppendQuery` `:88`).
(5) Existing accounts: "signed in immediately" and the lock-only refusal are replaced by
`CheckExistingExternalAccountAsync`, run under `!isNewUser`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:379-387`;
method `:420-440`): `CheckNotLocked` first (`:425`, defined `:173-179`), a confirmed account passes
(`:426`), `user.ConfirmEmail()` when the provider verified the account's own address (`:433-438`),
otherwise `CheckPrivilegedAccountConfirmed` (`:439`, defined `:162-165`) refuses Organizer,
ContentEditor or speaker-linked accounts (`:168-171`); ADR-036 Revision 2026-11-23 item 1 (`:470-479`).
(6) Verified-email sources: the Identity host maps `email_verified` for Google
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:165-166`) and Apple (`:169-173`); GitHub
asserts nothing (`:160-161`); an OIDC provider's claim is normalized with its `TrustEmail` setting
(`ExternalAuthExtensions.cs:149`; ADR-036 `:429-433`, `:480-484`); the verifier reads that one claim
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:22`, `:25`).
(7) `HasLocalPassword` is no longer called the complement of `IsExternalLogin`, and the trade-off names
it as the check: `IsExternalLogin` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:148`),
`HasLocalPassword => PasswordHash.Length > 0` (`:169`), `CreateFromInvitation` (`:318`, confirmed `:335`),
`CreateServiceAccount` (`:356`), `ClearPassword` (`:608`, empties the hash and salt `:610-611`); the guard
`if (existingUser.HasLocalPassword)` (`AuthenticationService.cs:546`); ADR-036 Revision 2026-11-23 item 3
(`:485-504`).
(8) Index filter: the configuration declares `[LoginProvider] IS NOT NULL AND [ProviderKey] IS NOT NULL`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:119-121`;
columns `:58-64`), and the model snapshot records it with `AND [IsDeleted] = 0`
(`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/SQLServerDbContextModelSnapshot.cs:151-153`).
(9) `UserRegistered`: external path (`AuthenticationService.cs:472-473`), local `EmailVerified: false`
(`:259-260`), and the invitation redemption raising `EmailVerified: true`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RedeemSignInLink/RedeemSignInLinkHandler.cs:113-114`).
(10) The closing summary names the OIDC issuers, the signed-out cookie and the existing-account gates.
Anchors re-read this pass for claims that did not change: `ExternalLoginScheme` (`ExternalAuthExtensions.cs:42`),
`AddExternalAuthProviders` (`:56`), the three `ClientId` reads (`:59-61`), `AddAuthentication()` (`:78`),
Google and GitHub `ClientSecret` throws (`:173-175`, `:186-188`), `user:email` (`:194`), Apple
`GenerateClientSecret = true` (`:207`) with `TeamId` / `KeyId` / `PrivateKeyPem` throws (`:208-216`),
Apple's name via `AppleUserNameClaims.AddFromCallbackFormAsync` (`:226`). `OAuthControllerBase.cs`:
prefix `"oauth-exchange:"` (`:73`), `ClientStateItemKey` (`:77`), `urn:github:name` (`:80`, read `:374`),
two-minute lifetime (`:87`), 10 s / 5 s lock timings (`:92-93`), three-argument ctor delegating with
`distributedLock: null` (`:102-106`), `CompleteAsync` (`[HttpGet("complete")]` `:204`, method `:207`),
`ReadChallengeState` (`:222`, method `:258-259`), `missing_claims` (`:229`), `ExternalLoginAsync` call
(`:232`), `SignOutAsync` (`:243`), 32-byte code (`:248`), `SetAsync` (`:249`), success redirect (`:252`;
builder `:261`, native target via `AppendQuery` `:274`), `ExchangeAsync` (`[HttpPost("exchange")]` `:289`,
`[NonIdempotent]` `:290`, method `:293`), `TryAcquireAsync($"lock:{cacheKey}", ...)` (`:313`),
`GetFromSharedStoreAsync` (`:332`), `RemoveAsync` (`:339`). ADC `AuthenticationService.cs`:
`IExternalLoginEmailVerifier` ctor parameter (`:56`), `ExternalLoginAsync` (`:283`) in
`ExecuteInTransactionAsync` (`:290-291`), `ExternalLoginCoreAsync` (`:295`), provider lookup (`:304-307`),
`Email.Create` (`:324`) and `Auth.ExternalEmailInvalid` (`:327-330`), by-email lookup (`:333-336`),
link call (`:340`), create-branch verifier (`:355-356`) and `User.CreateExternal(..., emailVerified)`
(`:362-363`), `RecordNewAccountAsync` (`:461-490`) scheduling `SendEmailConfirmationCommand` (`:475-481`),
`IssueTokensAsync` (`:403`), `TryLinkProviderToExistingAccountAsync` (`:502-556`): one-provider guard
(`:515-521`, reasoning `:508-514`), verifier (`:528-537`), SEC-ADC-01 (`:539-552`), `LinkExternalProvider`
(`:554`). `User.cs`: `LoginProvider` `:94`, `ProviderKey` `:98`, `CreateExternal` `:269`,
`IsEmailConfirmed = emailVerified` `:294`. Identity host `AddExternalAuthProviders` (`Program.cs:155`,
banner `:148-149`). Prod `OAuth__UIBaseUrl` (`MMCA.ADC/infra/main.bicep:2518`) inside the
`hasAnyOAuth ? [` branch (`:2517`), `hasAnyOAuth` ORing the three providers (`:194`).
ADR anchors: ADR-036 `## Decision` `:49`, `## Rationale` `:191`, `## Trade-offs` `:210`, revisions
2026-09-07 (`:252`), 2026-10-01 (`:302`), 2026-10-06 (`:313`), 2026-10-21 (`:337`), 2026-10-26 (`:358`),
2026-11-08 generic OIDC (`:401`), 2026-11-23 (`:463`). ADR-043
(`Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md`): `## Decision` `:94`,
`## Trade-offs` `:148`, dated revisions 2026-07-28 (`:185`) through 2026-10-31 (`:564`).
Confirmed by this run's audit and not re-read by the editor (no text changed): the native-head
paragraph (`IExternalAuthBroker`, `MauiExternalAuthBroker`, `OAuthFlowStateStore`, Login page
state-bound redirect), the `Auth.ExternalLinkRequiresLocalSignIn` generic-refusal resource behavior,
ADC's sealed `OAuthController` subclass with the four-argument base ctor, the
`IAuthenticationService.ExternalLoginAsync` not-supported default, and Store non-adoption (RS256 user
tokens plus the HS256 `ServiceToken` scheme).
Flag (2026-11-25): the AppHost line that sets `OAuth__UIBaseUrl` was not located this pass; a Grep for the
literal finds only the explanatory comment at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:472`
(the prior anchor `:499` is stale). The body claim is left as written.
Flag (2026-11-25): the audit's independence note (no prior DRIFTED/UNVERIFIABLE list supplied) is a
process remark, not an article claim; no text depends on it.*
