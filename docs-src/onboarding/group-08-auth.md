# 8. Authentication & Authorization

**What this group covers.** This is the security spine of the framework: how a user proves who they
are (authentication), how the system decides what they may do (authorization), and how both survive
the jump from a single-process monolith to a fleet of extracted services. Almost every type here lives
to serve one of six moving parts: **minting and validating JWTs**
([`TokenService`](#tokenservice)/[`ITokenService`](#itokenservice),
[`RsaJwksProvider`](#rsajwksprovider)/[`IJwksProvider`](#ijwksprovider)); **the shared login /
register / refresh workflow** ([`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser),
[`IAuthenticationService`](#iauthenticationservice), [`AuthenticationValidators`](#authenticationvalidators));
**password material** ([`PasswordHasher`](#passwordhasher)/[`IPasswordHasher`](#ipasswordhasher),
[`IAuthUser`](#iauthuser)); **brute-force / rate-limit protection**
([`LoginProtectionService`](#loginprotectionservice)/[`ILoginProtectionService`](#iloginprotectionservice));
**reading the current user's identity from claims**
([`CurrentUserService`](#currentuserservice)/[`ICurrentUserService`](#icurrentuserservice),
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider), [`AuthClaimTypes`](#authclaimtypes)); and
**the authorization model** (roles, permissions, and resource ownership under
[`AuthorizationExtensions`](#authorizationextensions),
[`PermissionAuthorizationHandler`](#permissionauthorizationhandler), and
[`OwnerOrAdminFilter`](#owneroradminfilter)). A seventh cluster, the HttpOnly **session-cookie**
machinery ([`SessionCookieEndpoints`](#sessioncookieendpoints),
[`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler),
[`CookieSessionRefresher`](#cookiesessionrefresher)), exists so that server-side-rendered Blazor pages
stay authenticated across a cold navigation. The governing decisions are ADR-004 (cross-service token
validation via JWKS), ADR-029 (brute-force protection), ADR-032 (password hashing), and ADR-033
(resource-ownership authorization); the rubric lenses are almost entirely [Rubric §11, Security] with
supporting [Rubric §7, Microservices Readiness] and [Rubric §10, Cross-Cutting]. Auth surfaces all of
its expected failures (bad password, lockout, expired session) as
[`Result`](group-01-result-error-handling.md#result) failures, never exceptions, so reading the
[Result pattern](group-01-result-error-handling.md#result) section first pays off here.

## Tokens: one signing switch, two validation worlds

The framework mints two credentials on every successful login: a short-lived **access token** (a JWT,
default 15 minutes) and an opaque, random **refresh token** (64 bytes of `RandomNumberGenerator`
output, Base64-encoded), both produced by [`TokenService`](#tokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:23`). The access token
carries a fixed claim spine: `sub`, `jti`, `iat`, a custom `user_id`, plus name, email, and role
(`TokenService.cs:76`), and the app adds its own claims (for example `speaker_id` or `customer_id`) via
the `additionalClaims` parameter.

The load-bearing design choice is a single configuration switch,
[`IJwtSettings`](group-14-module-system-composition.md#ijwtsettings)`.SigningAlgorithm`
(`TokenService.cs:53`). In **monolith mode** it defaults to `HS256`: one symmetric Base64 secret both
signs and validates, because issuer and validator are the same process. In **microservice mode** it is
`RS256`: the Identity service signs with an RSA private key and every other service validates against
the matching public key, which it fetches over JWKS. The keys are materialized once at construction and
the owned `RSA` handles are disposed with the service (`TokenService.cs:33`, `TokenService.cs:154`), so
token operations never re-parse key material. That asymmetric split is exactly what lets a module be
extracted without every service holding a signing key (ADR-004): a compromised non-Identity service can
verify tokens but cannot forge them.

The public half is served by [`RsaJwksProvider`](#rsajwksprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15`), which lazily builds a
`JsonWebKeySet` from a PEM key configured through
[`JwksSettings`](group-14-module-system-composition.md#jwkssettings). Publishing is off by default, and
when disabled or unconfigured the provider returns an *empty* key set (`RsaJwksProvider.cs:24`,
`RsaJwksProvider.cs:32`) so the endpoint stays queryable but a non-issuer host advertises nothing. The
endpoint itself, `/.well-known/jwks.json`, is mapped in the API layer by
[`JwksEndpointExtensions`](group-12-api-hosting-mapping.md#jwksendpointextensions), paired with the OIDC
discovery document from
[`OidcDiscoveryEndpointExtensions`](group-12-api-hosting-mapping.md#oidcdiscoveryendpointextensions);
[`OpenIdConnectMetadataWarmupTask`](group-16-aspire-orchestration.md#openidconnectmetadatawarmuptask)
pre-fetches that document at startup so the first authenticated request on a cold replica does not pay
the discovery round trip. Both validators pin `ValidAlgorithms` so an attacker cannot force an
algorithm swap; you can see the in-process version of that guard in
`TokenService.GetPrincipalFromExpiredToken` (`TokenService.cs:130` pins `ValidAlgorithms`), where the
algorithm is then re-checked against the token header even after `ValidateToken` returns
(`TokenService.cs:139-140`).

## The shared authentication workflow

Login, registration, refresh, and revocation are not re-implemented per app. They live once in
[`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34`), an abstract
base each app's Identity module seals over its concrete `User` aggregate. The base owns the sequence;
the sealed subclass supplies the genuinely app-specific pieces through hooks (`FindUntrackedByEmailAsync`,
`EmailExistsAsync`, `CreateUser`, `CreateAccessToken`, and optional validation and post-commit hooks).
The `User` aggregate reaches the workflow through the deliberately minimal
[`IAuthUser`](#iauthuser) contract
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:10`): password hash and salt, the current
refresh token and its expiry, and two mutators (`UpdateRefreshToken`, `RevokeRefreshToken`).

`LoginAsync` (`AuthenticationServiceBase.cs:63`) shows the shape. It validates the request first, then
runs the ADR-029 lockout check, then does the **dual-fetch**: an untracked, no-change-tracking query to
verify the password cheaply (`AuthenticationServiceBase.cs:86`), and only on success a second *tracked*
re-fetch so the rotated refresh token can be persisted through `SaveChangesAsync`
(`AuthenticationServiceBase.cs:110`). Soft-deleted accounts fall out through EF query filters and return
the same generic 401 as a wrong password, so the API never reveals whether an email exists. Every failure
path returns a [`Result`](group-01-result-error-handling.md#result) rather than throwing, matching the
framework-wide Result pattern (see [primer](../00-primer.md)). `RefreshTokenAsync`
(`AuthenticationServiceBase.cs:180`) extracts claims from the *expired* access token (signature still
verified, only lifetime skipped), then compares the presented refresh token against the stored one; a
mismatch is treated as token reuse and *revokes* the stored token to force re-authentication
(`AuthenticationServiceBase.cs:221`, BR-206). The request/response DTOs for these flows
([`LoginRequest`](#loginrequest), [`RegisterRequest`](#registerrequest),
[`RefreshTokenRequest`](#refreshtokenrequest), [`AuthenticationResponse`](#authenticationresponse),
[`ChangePasswordRequest`](#changepasswordrequest), [`OAuthCodeExchangeRequest`](#oauthcodeexchangerequest),
and the base [`AuthenticationRequest`](#authenticationrequest)) are compact record structs in
`MMCA.Common.Shared`, and the FluentValidation rules that guard them are bundled in
[`AuthenticationValidators`](#authenticationvalidators) alongside
[`LoginRequestValidator`](#loginrequestvalidator) and
[`RefreshTokenRequestValidator`](#refreshtokenrequestvalidator).

## Passwords and brute-force protection

Password material is handled by [`PasswordHasher`](#passwordhasher)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12`), which hashes with
PBKDF2-HMAC-SHA512 at 600,000 iterations (OWASP 2023 guidance, `PasswordHasher.cs:24`) and verifies in
constant time via `CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:58`) to close the timing
side channel. It stays backward-compatible with an older HMAC-SHA512 scheme by branching on salt length
(32 bytes = PBKDF2, 128 bytes = legacy, `PasswordHasher.cs:52`), so existing hashes still verify without
a forced reset (ADR-032). This is a clean [Rubric §11, Security] story: modern KDF, constant-time
compare, and a migration path all in one small type.

[`LoginProtectionService`](#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:18`) adds the
ADR-029 gates on top, backed by [`ICacheService`](group-09-caching.md#icacheservice) rather than a
database so the counters are cheap and self-expiring. After
[`LoginProtectionSettings`](#loginprotectionsettings)`.MaxFailedAttempts` consecutive failures it applies
an exponential-backoff lockout (`LoginProtectionService.cs:58`), with a deliberately clamped shift
exponent so a persistent attacker cannot wrap the TTL back to something small, and it rate-limits
registrations per source IP (`LoginProtectionService.cs:72`). The workflow calls these gates at exactly
the right points (increment on failed login, reset on success) so the protection is centralized rather
than sprinkled through each app's controller.

## Reading identity from claims

Once a request is authenticated, downstream code needs the caller's identity without re-parsing the JWT.
[`CurrentUserService`](#currentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:12`) is the scoped
adapter over `IHttpContextAccessor`: it exposes the `ClaimsPrincipal`, the parsed `user_id`, and the
role, caching each behind a per-request `Lazy<T>` (`CurrentUserService.cs:17`) and reading the same
custom `user_id` claim that [`TokenService`](#tokenservice) emits. Its generic `GetClaimValue<T>` is
what the ownership filter uses to read app-specific owner claims. A sibling,
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9`), plugs the
same `user_id` claim into SignalR's `IUserIdProvider` so `Clients.User(userId)` routes hub messages to
the right connections. [`AuthClaimTypes`](#authclaimtypes) names the one framework-custom claim beyond
the BCL set, `"permission"`, used by the authorization model below.

## Authorization: roles, permissions, ownership

The framework supports three overlapping authorization styles, wired together by the single
`AddAuthorizationPolicies()` extension in [`AuthorizationExtensions`](#authorizationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12`). The simplest is
**named role policies**: [`AuthorizationPolicies`](#authorizationpolicies) defines the constant policy
names (`RequireAdmin`, `RequireOrganizer`, and so on) that controllers reference through
`[Authorize(Policy = ...)]`, registered against the role names in [`RoleNames`](#rolenames). Roles
themselves get a value-object base, [`RoleValue`](#rolevalue), so each app can fix its own role set with
case-insensitive equality and validation while staying dependency-free enough to use from Blazor WASM.

The richer style is **permission-based** authorization, so endpoints depend on capabilities rather than
role names. [`HasPermissionAttribute`](#haspermissionattribute) marks a controller or action with a
permission such as `"sessions:manage"`; under the hood it is an `AuthorizeAttribute` whose policy name is
`perm:sessions:manage` ([`PermissionPolicy`](#permissionpolicy)). Rather than pre-registering a named
policy per permission, [`PermissionPolicyProvider`](#permissionpolicyprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13`) materializes
those policies on demand for any `perm:` name and falls through to the default provider for everything
else. The requirement it attaches, [`PermissionRequirement`](#permissionrequirement), is evaluated by
[`PermissionAuthorizationHandler`](#permissionauthorizationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`), which
grants access when the principal holds the permission directly (a `permission` claim) *or* derives it
from one of its roles via [`IPermissionRegistry`](#ipermissionregistry). The registry itself
([`PermissionRegistry`](#permissionregistry)) is an immutable, frozen role-to-permission map built by
[`PermissionRegistryBuilder`](#permissionregistrybuilder); each module contributes only its own grants
through `AddPermissions(...)`, and the grants union into one shared registry built lazily after all
modules have registered (`AuthorizationExtensions.cs:68`). That module-local contribution is the
[Rubric §7, Microservices Readiness] touch: an extracted service carries only its own permission grants.

The third style is **resource ownership**. [`OwnerOrAdminFilter`](#owneroradminfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:20`) is an action filter for
endpoints that mix admin and owner access (carts, orders, bookmarks). It lets a bypass role through, then
compares the caller's owner claim against the resource id taken from either the route or a bound argument,
returning 403 otherwise (`OwnerOrAdminFilter.cs:46`). Its vocabulary (claim type, bypass role, route
parameter) is configurable through [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions) with
[`OwnershipHelper`](#ownershiphelper) supplying the admin check, and the defaults preserve the original
`customer_id` / `Admin` / `id` behavior (ADR-033).

## Session cookies: keeping SSR authenticated

The final cluster solves a Blazor-specific problem: an interactive Blazor app keeps its access token in
browser memory, but a *cold* server-side render (a new tab, an F5, an external deep link) has no memory
to read, so an `[Authorize]` page would bounce to `/login` before the interactive phase starts. The fix
is a pair of HttpOnly cookies (`mmca_auth_access`, `mmca_auth_refresh`) seeded and cleared from JS through
[`SessionCookieEndpoints`](#sessioncookieendpoints)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:15`), written and
attributed by [`SessionCookieJar`](#sessioncookiejar), and read during prerender by
[`CookieTokenReader`](#cookietokenreader). [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24`) is a
custom authentication scheme that reads the cookie JWT, checks only its expiry (the API still does full
validation on every API call, `SessionCookieAuthenticationHandler.cs:18`), and populates
`HttpContext.User` so SSR authorization passes.

When the access cookie has expired but the refresh cookie is still valid,
[`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) runs *before* `UseAuthentication` on
qualifying navigations (GET + `Accept: text/html`) and delegates to
[`CookieSessionRefresher`](#cookiesessionrefresher)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:43`). The refresher
exchanges the refresh cookie at the API's `auth/refresh` endpoint server-to-server, so the refresh token
never reaches browser JS; it writes the rotated pair back as cookies and stashes the fresh access token on
`HttpContext.Items` so the current request's authentication reads the *new* token
(`CookieSessionRefresher.cs:82`). A process-wide lock plus a short rotation-grace cache collapse concurrent
refreshes into a single flight, keyed by the old refresh token, so a thundering herd of queued requests
cannot double-rotate (`CookieSessionRefresher.cs:88`). The same refresher backs the same-origin
`POST /auth/session/token` endpoint the browser polls to hydrate its in-memory token, guarded by
`SameSite=Lax` plus a `Sec-Fetch-Site` cross-site check (`SessionCookieEndpoints.cs:65`). The returned DTOs
are [`SessionTokenResult`](#sessiontokenresult), [`SessionTokenResponse`](#sessiontokenresponse), and
[`SessionCookieRequest`](#sessioncookierequest); registration runs through
[`ICookieSessionRefresher`](#icookiesessionrefresher) and the two extension classes
[`SessionCookieAuthenticationExtensions`](#sessioncookieauthenticationextensions) and
[`CookieSessionRefreshMiddlewareExtensions`](#cookiesessionrefreshmiddlewareextensions).

## Adjacent members

Two group members are not strictly auth types but ride along in this file:
[`IcsEvent`](#icsevent) and [`IcsCalendarBuilder`](#icscalendarbuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12`) build RFC 5545
calendar (`.ics`) exports from UTC-normalized event times, and
[`ISoftDeletedUserValidator`](#isoftdeleteduservalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7`)
is the small contract the API's
[`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) uses to reject an
authenticated token whose backing account has since been soft-deleted. The controller surface that drives
all of the above ([`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase),
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase),
[`ExternalAuthExtensions`](group-12-api-hosting-mapping.md#externalauthextensions)) and the gRPC token
forwarding ([`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor))
live in later groups; this chapter is the engine those endpoints call into.

### AuthorizationPolicies
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationPolicies.cs:11` · Level 0 · class (static)

- **What it is**: a static holder of the four named-policy string constants controllers pass to
  `[Authorize(Policy = ...)]`: `RequireOrganizer`, `RequireAttendee`, `RequireAdmin`, and
  `RequireAuthenticated`.
- **Depends on**: nothing first-party (BCL `System.Diagnostics.CodeAnalysis` for the suppression only).
- **Concept introduced, named role/authentication policies.** `[Rubric §11, Security]` (assesses
  whether authorization is centralized and declarative rather than scattered `if (role == "Admin")`
  checks) and `[Rubric §9, API & Contract Design]` (endpoints declare their access requirement in an
  attribute). ASP.NET Core authorization has two styles: *named policies* (a string key registered once,
  referenced by attribute) and ad-hoc role checks. This class is the registry of the named keys; the
  policies they map to are wired in [`AuthorizationExtensions`](#authorizationextensions). The doc
  comment (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationPolicies.cs:5-9`)
  explains why these are `const string` and not an `enum`: attribute arguments must be compile-time
  constants, and only a `const` qualifies.
- **Walkthrough**: four `public const string` fields
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationPolicies.cs:14-23`), each
  defined as `nameof(itself)` so the constant value equals its own name (`RequireOrganizer` is the
  string `"RequireOrganizer"`), which keeps the registered policy name and the referencing constant in
  sync by construction. The class carries a scoped `[SuppressMessage(... "S2339" ...)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationPolicies.cs:10`) that
  silences the "prefer an enum over constants" analyzer with an inline justification, exactly the
  attribute-argument constraint above.
- **Why it's built this way**: centralizing the policy names in one type means a controller cannot
  reference a policy that was never registered by a typo, the name flows from this constant into both
  the `[Authorize]` attribute and the registration call.
- **Where it's used**: referenced by controllers via `[Authorize(Policy = AuthorizationPolicies.X)]`
  and registered as real policies in [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions).

### OwnerOrAdminFilterOptions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11` · Level 0 · class (options)

- **What it is**: a host-configurable options object that supplies the three vocabulary values
  [`OwnerOrAdminFilter`](#owneroradminfilter) needs: which claim carries the caller's owner id, which
  role bypasses the ownership check, and which route/argument parameter names the resource owner.
- **Depends on**: nothing first-party.
- **Concept introduced, externalizing a filter's vocabulary through the options pattern.**
  `[Rubric §11, Security]` (the ownership rule is real but its identifiers are configuration, not
  hard-code) and `[Rubric §16, Maintainability]` (one host reuses the framework filter with a
  different claim/role without a fork). Before ADR-033 (cited in the doc comment,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:4`) the
  filter hard-coded MMCA.Store's `customer_id` / `Admin` / `id` triple; extracting them into an
  `IOptions<T>`-bound class lets an app with a different ownership vocabulary (say a `UserId` claim
  with an `Organizer` bypass keyed by a `userId` route value) reconfigure it via
  `services.Configure<OwnerOrAdminFilterOptions>(...)`.
- **Walkthrough**: three mutable auto-properties, each seeded with the legacy default so an unchanged
  host needs no configuration: `OwnerClaimType` = `"customer_id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:14`),
  `BypassRole` = `"Admin"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:17`), and
  `OwnerParameterName` = `"id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:24`). The
  last one's doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:19-23`)
  spells out that the parameter is looked up as a route value first and a model-bound query/body
  argument second, which is exactly the two-step lookup the filter performs.
- **Why it's built this way**: `get; set;` (not `init`) is the shape the ASP.NET Core options binder
  expects, so the values can arrive from `appsettings` or a `Configure` callback; defaults on every
  property preserve backward compatibility.
- **Where it's used**: injected as `IOptions<OwnerOrAdminFilterOptions>` into
  [`OwnerOrAdminFilter`](#owneroradminfilter).

### PermissionPolicy
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:9` · Level 0 · class (static)

- **What it is**: the naming convention that turns a permission string such as `"sessions:manage"`
  into the ASP.NET Core policy name `"perm:sessions:manage"`, and back.
- **Depends on**: nothing first-party.
- **Concept introduced, permission policies as prefixed policy names.** `[Rubric §11, Security]`
  (permission-based authorization, capabilities rather than roles) and `[Rubric §2, Design Patterns]`
  (a tiny naming convention that lets an on-demand provider recognize its own policies). Rather than
  pre-register one named policy per permission, the codebase encodes the permission *inside* the
  policy name behind a reserved prefix; [`PermissionPolicyProvider`](#permissionpolicyprovider) then
  materializes any policy whose name starts with that prefix on demand. This class owns the two ends of
  that encoding.
- **Walkthrough**: `Prefix` = `"perm:"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`), the reserved
  marker; and `NameFor(string permission)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:17`), an
  expression-bodied `Prefix + permission` that builds the policy name.
  [`HasPermissionAttribute`](#haspermissionattribute) calls `NameFor` to build the `[Authorize]` policy
  string, and [`PermissionPolicyProvider`](#permissionpolicyprovider) strips `Prefix` back off to
  recover the permission.
- **Why it's built this way**: a single shared prefix constant means the attribute that *writes* the
  policy name and the provider that *reads* it cannot disagree, they reference the same
  `PermissionPolicy.Prefix`.
- **Where it's used**: by [`HasPermissionAttribute`](#haspermissionattribute) (encode) and
  [`PermissionPolicyProvider`](#permissionpolicyprovider) (decode).

### PermissionRequirement
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10` · Level 0 · class (sealed)

- **What it is**: an ASP.NET Core `IAuthorizationRequirement` carrying the single permission a
  principal must hold for a given policy to succeed.
- **Depends on**: `Microsoft.AspNetCore.Authorization.IAuthorizationRequirement` (framework).
- **Concept introduced, the requirement/handler pair.** `[Rubric §11, Security]` and `[Rubric §2,
  Design Patterns]` (the ASP.NET Core authorization model splits *what is required* from *how it is
  checked*). A `requirement` is a passive data object; a matching `AuthorizationHandler<T>` decides
  whether it is satisfied. This type is the passive half; [`PermissionAuthorizationHandler`](#permissionauthorizationhandler)
  is the active half.
- **Walkthrough**: a `sealed` class implementing `IAuthorizationRequirement`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10`). Its
  constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:14`) guards
  with `ArgumentException.ThrowIfNullOrWhiteSpace(permission)` and stores it into the read-only
  `Permission` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:21`), so a
  requirement can never carry an empty permission.
- **Why it's built this way**: keeping `Permission` immutable and non-empty means the handler can trust
  it without re-validating; the requirement is a value carrier with no behavior of its own.
- **Where it's used**: attached to a policy by [`PermissionPolicyProvider`](#permissionpolicyprovider)
  and evaluated by [`PermissionAuthorizationHandler`](#permissionauthorizationhandler).

### HasPermissionAttribute
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13` · Level 1 · class (sealed attribute)

- **What it is**: an `[Authorize]`-derived attribute that requires the authenticated principal to hold
  a named permission, applied to a controller or action.
- **Depends on**: [`PermissionPolicy`](#permissionpolicy) (to build the policy name);
  `Microsoft.AspNetCore.Authorization.AuthorizeAttribute` (framework base).
- **Concept introduced, capability-based endpoint authorization.** `[Rubric §11, Security]` (assesses
  whether endpoints depend on *capabilities* rather than hard-coded role names) and `[Rubric §7,
  Microservices Readiness]` (permissions travel as claims, so an extracted service authorizes without
  knowing the issuer's role taxonomy). The doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:5-11`)
  states the intent directly: prefer `[HasPermission("sessions:manage")]` over role-based
  `[Authorize(Policy = ...)]` so an endpoint declares the *capability* it needs, and the mapping from
  roles to that capability lives in one registry ([`IPermissionRegistry`](#ipermissionregistry)).
- **Walkthrough**: `sealed class HasPermissionAttribute : AuthorizeAttribute`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13`) with
  `[AttributeUsage(... AllowMultiple = true, Inherited = true)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:12`) so
  several permission requirements can stack on one target and subclasses inherit them. The constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:17-18`)
  chains to the base with `PermissionPolicy.NameFor(permission)`, so setting the base `Policy` to
  `"perm:<permission>"` is what routes the check through
  [`PermissionPolicyProvider`](#permissionpolicyprovider); it also stores the bare `permission` on the
  read-only `Permission` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:21`).
- **Why it's built this way**: deriving from `AuthorizeAttribute` (rather than inventing a filter)
  means the standard MVC authorization pipeline picks it up for free; the permission is encoded into
  the inherited `Policy` string so no per-permission policy registration is needed.
- **Where it's used**: on controllers/actions across the apps; its policy name is resolved by
  [`PermissionPolicyProvider`](#permissionpolicyprovider) and satisfied by
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler).

### OwnershipHelper
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10` · Level 1 · class (static)

- **What it is**: static helpers a controller calls to scope a query to the current user's own data,
  returning a specification that filters by owner id, or `null` when the caller holds the privileged
  bypass role and should see everything.
- **Depends on**: `ICurrentUserService` (Application,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:1`, the
  current-user/claims boundary described later in this group).
- **Concept introduced, ownership scoping at the query level (as distinct from the filter's gate).**
  `[Rubric §11, Security]` (row-level data isolation, a non-admin caller can only read their own rows)
  and `[Rubric §1, SOLID]` (the helper produces a specification; the repository applies it). Where
  [`OwnerOrAdminFilter`](#owneroradminfilter) *blocks* a request that names someone else's id, this
  helper *narrows the result set* so a list endpoint returns only the caller's rows without them
  passing any id at all.
- **Walkthrough**
  - `IsAdmin(ICurrentUserService, string bypassRole = "Admin")`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:17`):
    case-insensitive compare of the current user's `Role` against the bypass role
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:20`); this is the
    same predicate [`OwnerOrAdminFilter`](#owneroradminfilter) reuses so the two stay consistent.
  - `GetOwnershipSpecification<TSpec, TId>(...)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:34`): the general
    form. It returns `null` for a bypass-role caller
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:45-48`, no scoping
    needed); otherwise it reads the owner id from the named claim via
    `currentUserService.GetClaimValue<TId>(claimType)` and, when present, calls the supplied
    `specFactory(id.Value)` to build the scoping specification
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:50-51`). The
    `where TId : struct, IParsable<TId>` constraint
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:40`) is what lets
    the claim string be parsed into a strongly-typed id.
  - `GetOwnershipSpecification<TSpec>(...)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:63`): the
    convenience overload that fixes `TId` to `int` and the claim to `"customer_id"`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:67`), matching the
    legacy default vocabulary.
- **Why it's built this way**: returning `null` for admins (rather than a "match everything"
  specification) lets the caller skip the filter entirely on the privileged path; producing a
  specification (not running the query) keeps the helper in the API layer while the actual filtering
  runs in the repository.
- **Where it's used**: called from controller query actions that must isolate a caller's data; the
  specification it returns is applied by the repository layer.
- **Caveats / not-in-source**: `TSpec` is an open generic with only a `class` constraint, the helper
  does not itself require the returned type to be a specification, that contract is the caller's.

### PermissionAuthorizationHandler
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13` · Level 1 · class (sealed)

- **What it is**: the `AuthorizationHandler<PermissionRequirement>` that decides whether the current
  principal satisfies a [`PermissionRequirement`](#permissionrequirement), either because it carries
  the permission as an explicit claim or because one of its roles grants it.
- **Depends on**: [`PermissionRequirement`](#permissionrequirement),
  [`IPermissionRegistry`](#ipermissionregistry) (injected role-to-permission map,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:3,13`),
  [`AuthClaimTypes`](#authclaimtypes) (the permission claim type); `System.Security.Claims`.
- **Concept introduced, resolving a permission through claim-or-role.** `[Rubric §11, Security]`
  (two independent grant paths: a direct permission claim, and role-derived permissions) and
  `[Rubric §7, Microservices Readiness]` (the handler reads roles out of the token regardless of how
  the JWT middleware mapped the role claim type, so it survives inbound-claim-mapping being on or off).
- **Walkthrough**: `HandleRequirementAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:17`)
  short-circuits to a completed task when the principal is not authenticated
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:24-27`),
  so an anonymous request never succeeds. It then succeeds the requirement if *either*
  `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` (a directly granted
  permission) *or* `permissionRegistry.HasPermission(GetRoles(context.User), requirement.Permission)`
  (a role-derived grant) holds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:29-33`).
  The private `GetRoles(ClaimsPrincipal)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:40-46`)
  gathers role values across three possible claim types: the standard `ClaimTypes.Role` URI plus the
  raw `"role"` and `"roles"` claims, so roles are found whether or not the JWT bearer middleware mapped
  them (the inline comment at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:38-39`
  states this rationale).
- **Why it's built this way**: never calling `context.Fail()` (only `context.Succeed`) is the
  ASP.NET Core convention that lets multiple handlers vote independently, this handler abstains rather
  than vetoes when it cannot grant. Reading three role claim types defensively decouples the check from
  the host's token-mapping configuration.
- **Where it's used**: registered as an `IAuthorizationHandler` singleton by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions); invoked by the
  authorization middleware for every policy that carries a [`PermissionRequirement`](#permissionrequirement).

### PermissionPolicyProvider
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13` · Level 1 · class (sealed)

- **What it is**: an `IAuthorizationPolicyProvider` that lazily builds an `AuthorizationPolicy` for any
  policy name starting with the [`PermissionPolicy`](#permissionpolicy) prefix, attaching a
  [`PermissionRequirement`](#permissionrequirement) for the encoded permission, and delegates every
  other policy name to the default provider.
- **Depends on**: [`PermissionPolicy`](#permissionpolicy) (the prefix),
  [`PermissionRequirement`](#permissionrequirement); `Microsoft.AspNetCore.Authorization`,
  `Microsoft.Extensions.Options`.
- **Concept introduced, on-demand policy materialization.** `[Rubric §11, Security]` and `[Rubric §16,
  Maintainability]` (a system with an open-ended set of permissions cannot pre-register a named policy
  for each, so the policy is built from its own name at resolution time). The doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:6-12`)
  explains the design: `"perm:*"` names are materialized here, and every other name falls through to
  the default provider so the named role policies in [`AuthorizationPolicies`](#authorizationpolicies)
  keep working unchanged.
- **Walkthrough**: the constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:19`) wraps
  a `DefaultAuthorizationPolicyProvider` built from the ambient `AuthorizationOptions`, kept as the
  fallback. `GetDefaultPolicyAsync` and `GetFallbackPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:23-28`)
  delegate straight to that fallback. `GetPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:31`) is
  the interesting one: if the name does not start with `PermissionPolicy.Prefix` it defers to the
  fallback
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:35-38`);
  otherwise it slices the prefix off with a range expression
  `policyName[PermissionPolicy.Prefix.Length..]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:40`) and
  builds a policy that requires an authenticated user plus a fresh `PermissionRequirement(permission)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:41-44`).
- **Why it's built this way**: composing over `DefaultAuthorizationPolicyProvider` rather than
  replacing it means all pre-registered policies survive; only the `perm:` namespace is intercepted.
  This is what lets [`HasPermissionAttribute`](#haspermissionattribute) work for any permission string
  without a registration step.
- **Where it's used**: registered (via `Replace`) as the single `IAuthorizationPolicyProvider` by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions).

### OwnerOrAdminFilter
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:20` · Level 2 · class (sealed action filter)

- **What it is**: an MVC async action filter that lets a request proceed only if the caller holds the
  bypass role or owns the resource named by the request, returning 403 Forbidden otherwise.
- **Depends on**: [`OwnershipHelper`](#ownershiphelper) (for the `IsAdmin` check),
  [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions) (the vocabulary), `ICurrentUserService`
  (claims); `Microsoft.AspNetCore.Mvc.Filters`, `Microsoft.Extensions.Options`.
- **Concept introduced, per-request ownership enforcement as a filter.** `[Rubric §11, Security]`
  (a resource-level access gate that runs before the action body) and `[Rubric §10, Cross-Cutting
  Concerns]` (the ownership rule is expressed once as a filter and attached to any controller that
  mixes admin and owner access, rather than re-coded in each action). This is the *gate* counterpart to
  [`OwnershipHelper`](#ownershiphelper)'s *query scoping*: the helper narrows a list; this filter blocks
  an attempt to read or mutate a specific id the caller does not own (ADR-033, cited at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:14`).
- **Walkthrough**: `OnActionExecutionAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:25`) reads the
  current `settings = options.Value`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:30`), then: if
  `OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole)` it calls `next()` and returns
  (privileged bypass,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:32-36`);
  otherwise it reads the caller's owner id from the configured claim
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:38`) and
  short-circuits to `ForbidResult` if that claim is absent
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:40-44`). It then
  compares the caller's id against the requested id via `TryGetOwnerParameter` and forbids on mismatch
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:46-51`); only a
  match (or no such parameter on the request) falls through to `next()`. The private
  `TryGetOwnerParameter`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:58-76`) resolves
  the id from the route values first
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:60-65`) and,
  failing that, from the model-bound action arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:67-72`), parsing
  each as `int`.
- **Why it's built this way**: forbidding when the parameter *is present but mismatched*, while
  allowing when the parameter is *absent*, means the filter guards id-scoped endpoints without breaking
  actions that carry no owner parameter. Reading the vocabulary from injected options keeps a single
  filter reusable across hosts (ADR-033). The registration guidance in the remarks
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:16-19`) is
  `[ServiceFilter(typeof(OwnerOrAdminFilter))]` as a scoped service.
- **Where it's used**: applied via `[ServiceFilter(typeof(OwnerOrAdminFilter))]` on controllers that
  mix admin and owner access (carts, orders, customers, bookmarks); it needs
  [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions) registered.
- **Caveats / not-in-source**: the owner id is parsed as `int` only
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:62,69`); a host
  whose owner id is a `Guid` or string cannot use this filter as-is.

### AuthorizationExtensions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12` · Level 3 · class (static, extension block)

- **What it is**: the DI wiring that registers the whole authorization model in one call: the four
  named role/authentication policies plus the permission-based mechanism (handler, on-demand provider,
  and the accumulating permission registry).
- **Depends on**: [`AuthorizationPolicies`](#authorizationpolicies) (the policy names),
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler),
  [`PermissionPolicyProvider`](#permissionpolicyprovider), [`IPermissionRegistry`](#ipermissionregistry) /
  [`PermissionRegistryBuilder`](#permissionregistrybuilder), [`RoleNames`](#rolenames);
  `Microsoft.Extensions.DependencyInjection`.
- **Concept, `extension(T)` DI members and lazy registry accumulation.** `[Rubric §10, Cross-Cutting
  Concerns]` (authorization set up once for every host) and `[Rubric §7, Microservices Readiness]`
  (each module contributes only the permissions it owns, so an extracted module carries its own grants).
  The `extension(IServiceCollection services)` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14`) is the
  C# `extension(T)` DI idiom taught in the [primer](../00-primer.md#c-extensiont-types--read-this-once):
  it adds `AddAuthorizationPolicies` and `AddPermissions` directly onto `IServiceCollection`.
- **Walkthrough**
  - `AddAuthorizationPolicies()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:22`):
    registers the four named policies through `AddAuthorizationBuilder()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:24-32`),
    mapping each [`AuthorizationPolicies`](#authorizationpolicies) constant to a
    `RequireRole(RoleNames.X)` (or `RequireAuthenticatedUser()` for `RequireAuthenticated`). It then
    wires the permission mechanism: `TryAddEnumerable` for the
    [`PermissionAuthorizationHandler`](#permissionauthorizationhandler) as a singleton
    `IAuthorizationHandler`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:38-39`),
    and `Replace` to install [`PermissionPolicyProvider`](#permissionpolicyprovider) as the transient
    `IAuthorizationPolicyProvider`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:40-41`),
    then ensures the registry exists
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:42`).
  - `AddPermissions(Action<PermissionRegistryBuilder> configure)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:54`): the
    per-module entry point for declaring role-to-permission grants. It guards the callback, fetches the
    shared builder via `EnsurePermissionRegistry`, and invokes `configure(builder)` so the module's
    grants accumulate
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:56-61`).
    The doc comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:47-53`)
    notes it is safe to call once per module: grants union into a single registry.
  - `EnsurePermissionRegistry(IServiceCollection)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:68`): the
    idempotent core. If a [`PermissionRegistryBuilder`](#permissionregistrybuilder) is already
    registered as a singleton instance it returns that existing one
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:70-74`);
    otherwise it creates one, registers it, and registers [`IPermissionRegistry`](#ipermissionregistry)
    as a singleton whose factory calls `builder.Build()` lazily
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:76-80`).
    Because the registry is built on first *resolve*, every module's `AddPermissions` call has already
    contributed by the time any request evaluates a permission.
- **Why it's built this way**: `TryAddEnumerable` lets the permission handler coexist with any other
  authorization handlers; `Replace` guarantees exactly one policy provider (the permission-aware one);
  and the lazy `builder.Build()` factory is what makes module registration order irrelevant, all grants
  are collected before the first `Build()`.
- **Where it's used**: `AddAuthorizationPolicies()` is called once by each service host during
  authentication wiring; `AddPermissions(...)` is called by each module that owns permissions.

### ICurrentUserService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:9` · Level 0 · interface

- **What it is**: the Application layer's read-only window into the authenticated caller: the raw `ClaimsPrincipal`, a strongly-typed `UserId`, the caller's `Role`, a generic typed-claim reader, and a default `IsInRole` helper. It answers "who is calling?" without any handler ever touching `HttpContext`.
- **Depends on**: `System.Security.Claims.ClaimsPrincipal` and `IParsable<T>` (both BCL) and the solution-wide `UserIdentifierType` alias (an `int` today; see [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)). No first-party dependencies: this is a pure port. Its concrete adapter is [`CurrentUserService`](#currentuserservice) in Infrastructure.
- **Concept introduced: the caller-identity port. [Rubric §3, Clean Architecture]** assesses whether the inner layers stay free of framework/transport types; **[Rubric §1, SOLID]** (Interface Segregation) assesses whether a contract exposes only what its clients need. An Application handler must know the caller to run ownership checks and to stamp audit fields, but it must not depend on `IHttpContextAccessor`, which would drag ASP.NET into the Application project. `ICurrentUserService` is that inversion: Infrastructure reads `HttpContext.User` and exposes it through this clean, minimal contract. The default interface method on line 36 (`IsInRole(string) => string.Equals(Role, roleName, StringComparison.OrdinalIgnoreCase)`) means every implementer and every test double inherits the role check for free rather than re-implementing a trivial equality.
- **Walkthrough**: line 12 `ClaimsPrincipal User { get; }` exposes the full principal for advanced claim inspection. Line 15 `UserIdentifierType? UserId { get; }` is the typed identifier, nullable because an unauthenticated request has no user. Line 18 `string? Role { get; }` is a single role (the codebase models one role per user). Lines 27-28 `T? GetClaimValue<T>(string claimType) where T : struct, IParsable<T>` parses a named claim into any parsable value struct (`int`, `Guid`, and so on) and returns `null` when the claim is absent or unparseable, so a module can read its own claim (for example `speaker_id`) without Common knowing that claim exists. Line 36 supplies the default `IsInRole`.
- **Why it's built this way**: typing `UserId` as the per-module alias rather than a generic parameter keeps the interface concrete and mock-friendly while remaining correct for each app. Reading module claims through `GetClaimValue<T>` keeps Common decoupled from any specific module's claim vocabulary.
- **Where it's used**: injected into command handlers for ownership checks, into [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext)'s `SaveChangesAsync` for `CreatedBy`/`LastModifiedBy` stamping, and into the authorization filters (`OwnerOrAdminFilter`, permission handlers) elsewhere in this group.

---

### IPasswordHasher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:6` · Level 0 · interface

- **What it is**: the password-security port: hash a plaintext password into a separated `(byte[] Hash, byte[] Salt)` pair, and verify a plaintext against a stored hash and salt.
- **Depends on**: BCL only. Its Infrastructure adapter is [`PasswordHasher`](#passwordhasher).
- **Concept introduced: hash and salt kept apart. [Rubric §11, Security]** assesses credential handling. Returning the hash and salt as two separate `byte[]` fields (line 11) rather than one concatenated blob keeps the storage contract explicit: the caller persists both columns, and `VerifyPassword` (line 18) is unambiguous about what it re-derives and compares. Because the algorithm lives entirely behind this interface, it can be strengthened without touching a single Application handler (ADR-032 sets the current PBKDF2-HMAC-SHA512 / 600k-iteration policy, applied inside [`PasswordHasher`](#passwordhasher)).
- **Walkthrough**: line 11 `(byte[] Hash, byte[] Salt) HashPassword(string password)` returns a value tuple the caller stores as two fields. Line 18 `bool VerifyPassword(string password, byte[] hash, byte[] salt)` re-derives from the supplied salt and compares (constant-time, in the concrete).
- **Why it's built this way**: abstracting the hasher behind a two-method port is the [Rubric §1, SOLID] Dependency-Inversion story: swapping to Argon2 or bumping the iteration count is an Infrastructure registration change, invisible to the Register/Login use cases.
- **Where it's used**: the Identity module's register handler (calls `HashPassword`) and login handler (calls `VerifyPassword`).

---

### ISoftDeletedUserValidator
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7` · Level 0 · interface

- **What it is**: a single-method port (`IsUserSoftDeletedAsync`, line 15) that answers "has this account been soft-deleted?", called after JWT authentication to reject a soft-deleted user who still holds a valid, unexpired token (BR-133).
- **Depends on**: BCL and the `UserIdentifierType` alias. Cross-reference ADR-005 (soft-delete versus erasure) and [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to) for the soft-delete convention.
- **Concept introduced: closing the stateless-token window. [Rubric §11, Security]** assesses whether revocation is timely; a JWT is stateless and can outlive the account it names. This interface lets middleware re-check deletion on every authenticated request and return 401 when the account is gone, with no per-handler code. It is deliberately defined in Application and implemented by the Identity module so the middleware never takes a cross-module domain reference (the same dependency-inversion move as the other ports here).
- **Walkthrough**: line 15 `Task<bool> IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)`. One question, one answer.
- **Where it's used**: [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), registered after authentication in the API pipeline; the Identity module supplies the concrete backed by its own query.

---

### ITokenService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:8` · Level 0 · interface

- **What it is**: the token-minting port called by the Login and Refresh use cases: build a signed JWT access token from identity facts, generate an opaque refresh token, and recover the `ClaimsPrincipal` from an expired-but-validly-signed access token.
- **Depends on**: `System.Security.Claims` (BCL) and the `UserIdentifierType` alias. Its Infrastructure adapter is [`TokenService`](#tokenservice), which signs with the RSA key surfaced by [`IJwksProvider`](#ijwksprovider).
- **Concept introduced: token creation as an Infrastructure detail. [Rubric §3, Clean Architecture]** assesses whether the JWT library stays out of the inner layers; the Login/Refresh handlers call this contract and never see `System.IdentityModel.Tokens.Jwt`. `GetPrincipalFromExpiredToken` (line 34) is the linchpin of the refresh flow: it validates the signature while ignoring lifetime, so an expired access token can still authenticate its own rotation, returning `null` when the signature is bad.
- **Walkthrough**: lines 17-22 `GenerateAccessToken(UserIdentifierType userId, string email, string role, string fullName, IEnumerable<Claim>? additionalClaims = null)` builds a signed JWT; the typed parameters force the caller to supply the minimum claim set explicitly (rather than passing a raw principal), which prevents accidentally-thin tokens. Line 26 `GenerateRefreshToken()` returns a cryptographically random base64 string for the refresh-token store. Line 34 `ClaimsPrincipal? GetPrincipalFromExpiredToken(string token)` validates signature only.
- **Why it's built this way**: the explicit-parameter overload is a small [Rubric §11, Security] guardrail: the token's contents are a deliberate list, not whatever claims happened to be on an inbound principal.
- **Where it's used**: the Identity module's login and refresh-token handlers in both ADC and Store. The rotated pair produced here is what [`CookieSessionRefresher`](#cookiesessionrefresher) later exchanges on the browser's behalf.

---

### SessionCookieRequest
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:69` · Level 0 · record

- **What it is**: the inbound body for `POST /auth/session-cookie`: the access and refresh token strings the browser hands back to the server so they can be re-issued as HttpOnly cookies.
- **Depends on**: nothing first-party; a two-string `sealed record`. Consumed by [`SessionCookieEndpoints`](#sessioncookieendpoints).
- **Concept introduced: the browser cannot set an HttpOnly cookie from JS. [Rubric §11, Security]** and [Rubric §26, Front-End Security] both assess XSS-resistant token storage. After the SPA logs in against the API it holds the token pair in memory; to persist them as HttpOnly cookies (unreadable by JS, so an injected script cannot exfiltrate them) it POSTs them once to this same-origin endpoint, which writes the cookies server-side. This is the seeding half of ADR-022's browser session-cookie scheme.
- **Walkthrough**: the whole type is the record on line 69: `sealed record SessionCookieRequest(string AccessToken, string RefreshToken)`. It is a nested type of [`SessionCookieEndpoints`](#sessioncookieendpoints), bound from the request JSON.
- **Where it's used**: the `POST /auth/session-cookie` handler in [`SessionCookieEndpoints`](#sessioncookieendpoints) (line 27), which passes both tokens straight to [`SessionCookieJar`](#sessioncookiejar).

---

### SessionTokenResponse
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:17` · Level 0 · record

- **What it is**: the JSON body returned by `POST /auth/session/token`: the access token and its UTC expiry, and nothing else.
- **Depends on**: BCL only. Produced by [`SessionCookieEndpoints`](#sessioncookieendpoints) from a [`SessionTokenResult`](#sessiontokenresult).
- **Concept introduced: the refresh token never crosses the wire to the browser. [Rubric §9, API & Contract Design]** assesses whether a response exposes only what the client needs. This record carries the access token (which the SPA holds in memory for its Bearer calls) but deliberately omits the refresh token, which stays exclusively in the HttpOnly cookie (the type comment on lines 13-16 states the rule).
- **Walkthrough**: line 17: `sealed record SessionTokenResponse(string AccessToken, DateTime AccessTokenExpiry)`. It is the serialized projection of the internal [`SessionTokenResult`](#sessiontokenresult).
- **Where it's used**: returned by the `/auth/session/token` handler in [`SessionCookieEndpoints`](#sessioncookieendpoints) (line 54).

---

### SessionTokenResult
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:11` · Level 0 · record struct

- **What it is**: the internal carrier for a validated access token plus its UTC expiry, returned by the refresher. A `readonly record struct`, so it allocates nothing on the hot validate path.
- **Depends on**: BCL only. Returned by [`ICookieSessionRefresher`](#icookiesessionrefresher); projected to the wire-facing [`SessionTokenResponse`](#sessiontokenresponse).
- **Concept introduced**: the value-type twin of [`SessionTokenResponse`](#sessiontokenresponse): same two fields, but this one stays server-side and is nullable at the call site (`SessionTokenResult?`) to signal "no valid session" without a sentinel. [Rubric §12, Performance] assesses avoidable allocation; a `readonly record struct` is the light choice for a result returned on every qualifying navigation.
- **Walkthrough**: line 11: `readonly record struct SessionTokenResult(string AccessToken, DateTime AccessTokenExpiry)`.
- **Where it's used**: the return type of [`ICookieSessionRefresher.GetOrRefreshAsync`](#icookiesessionrefresher); unwrapped by [`SessionCookieEndpoints`](#sessioncookieendpoints) into a [`SessionTokenResponse`](#sessiontokenresponse).

---

### ICookieSessionRefresher
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:26` · Level 1 · interface

- **What it is**: the "validate-or-refresh over the HttpOnly session cookies" port: one method that returns a currently-valid access token for the request, rotating from the refresh cookie when the access cookie has expired, or `null` when there is no valid session.
- **Depends on**: `HttpContext` (ASP.NET) and [`SessionTokenResult`](#sessiontokenresult). Its implementation is [`CookieSessionRefresher`](#cookiesessionrefresher).
- **Concept introduced: server-side, JS-invisible refresh. [Rubric §11, Security]** assesses where the long-lived credential lives. The type-level comment (lines 19-25) describes the contract precisely: if the access cookie's JWT is still valid it is returned as-is; otherwise the refresh cookie is exchanged at the API's `auth/refresh` endpoint server-to-server so the refresh token never reaches browser JS, the rotated pair is written back as HttpOnly cookies, and the fresh access token is stashed on `HttpContext.Items` so the current request's SSR authentication can read it before the `Set-Cookie` takes effect on the next request.
- **Walkthrough**: line 33 `Task<SessionTokenResult?> GetOrRefreshAsync(HttpContext context, CancellationToken cancellationToken = default)`. The nullable return is the whole vocabulary: a value means "here is a good access token"; `null` means "no session, treat as anonymous".
- **Why it's built this way**: a single interface lets both the SSR middleware and the `/auth/session/token` endpoint share one refresh path, so there is exactly one place that rotates and one place that decides validity (ADR-022).
- **Where it's used**: [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) (before authentication, on navigations) and the `/auth/session/token` handler in [`SessionCookieEndpoints`](#sessioncookieendpoints) (on the browser's poll).

---

### CookieSessionRefreshMiddleware
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:14` · Level 2 · class

- **What it is**: an ASP.NET middleware that runs before `UseAuthentication` on full-page navigations and, when the access cookie has expired but the refresh cookie is still valid, refreshes server-side so SSR `[Authorize]` survives instead of bouncing to `/login`.
- **Depends on**: `RequestDelegate` and [`ICookieSessionRefresher`](#icookiesessionrefresher) (constructor injected, line 14). Registered by [`CookieSessionRefreshMiddlewareExtensions`](#cookiesessionrefreshmiddlewareextensions).
- **Concept introduced: refresh-before-authenticate for prerender. [Rubric §11, Security]** and [Rubric §18, UI Architecture] meet here: a Blazor Web App prerenders `[Authorize]` pages on a cold GET (new tab, F5, deep link), and authentication reads the cookie before any interactive code runs. If the access cookie has just expired, plain authentication would fail and redirect. This middleware inserts a refresh attempt first, so the stashed fresh token (set on `HttpContext.Items` by the refresher) is what authentication then reads.
- **Walkthrough**: `InvokeAsync` (lines 17-27) null-checks the context, calls `ShouldAttempt`, and on a match awaits `refresher.GetOrRefreshAsync(context, context.RequestAborted)` before invoking `next`. `ShouldAttempt` (lines 29-32) gates strictly to `GET` with an `Accept` header containing `text/html`, so it never fires on static assets, API, or XHR calls. The refresh is a side effect only: the middleware ignores the return value and always continues the pipeline, leaving the actual authentication decision to the downstream scheme.
- **Why it's built this way**: narrow gating keeps a per-request cookie read off every static-asset request, and delegating single-flight to the refresher means the middleware itself cannot double-rotate a token (ADR-022).
- **Where it's used**: registered on the Blazor Server (UI.Web) host immediately before `UseAuthentication()` via `UseCookieSessionRefresh()`.
- **Caveats / not-in-source**: the registration order (before `UseAuthentication`) is enforced by the host that calls the extension, not by this class; getting it wrong silently disables the SSR refresh.

---

### SessionCookieEndpoints
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:15` · Level 2 · class

- **What it is**: the static minimal-API mapper for the three session-cookie routes: `POST`/`DELETE /auth/session-cookie` (seed and clear the HttpOnly cookies from JS at login/logout) and `POST /auth/session/token` (the same-origin validate-or-refresh the browser polls to hydrate its in-memory access token). It also owns the two cookie-name constants.
- **Depends on**: [`SessionCookieJar`](#sessioncookiejar), [`ICookieSessionRefresher`](#icookiesessionrefresher), [`SessionCookieRequest`](#sessioncookierequest), [`SessionTokenResponse`](#sessiontokenresponse), and ASP.NET routing/`Results`. Cookies written here are read by [`CookieTokenReader`](#cookietokenreader).
- **Concept introduced: the cookie names are the shared contract.** Lines 17-18 declare `AccessTokenCookieName = "mmca_auth_access"` and `RefreshTokenCookieName = "mmca_auth_refresh"`; every other type in this feature (the jar, the reader, the refresher) references these constants rather than string literals, so there is one source of truth for the cookie names. [Rubric §9, API & Contract Design] is the relevant lens: three tightly-scoped endpoints, each excluded from OpenAPI (`ExcludeFromDescription`, lines 25/56) because they are browser plumbing, not a public API.
- **Walkthrough**: `MapSessionCookieEndpoints` (lines 20-61): the `/auth/session-cookie` group is created with `ExcludeFromDescription` (lines 24-25). The `POST` (lines 27-31) takes a [`SessionCookieRequest`](#sessioncookierequest) and calls `SessionCookieJar.Append`; the `DELETE` (lines 33-37) calls `SessionCookieJar.Delete`; both `DisableAntiforgery` because there is no token cookie to validate. The `/auth/session/token` `POST` (lines 43-58) first rejects an obvious cross-site request with 403 (lines 47-49), then calls the refresher: a `null` result becomes a `401` JSON `{ error = "no_session" }` (line 53), otherwise a [`SessionTokenResponse`](#sessiontokenresponse) is returned (line 54). It is `AllowAnonymous` (it authenticates via the cookies themselves) and antiforgery-disabled. The private `IsCrossSite` (lines 65-67) inspects the `Sec-Fetch-Site` header and treats an absent header as allowed (older browsers).
- **Why it's built this way**: CSRF is defended in depth: `POST`-only, `SameSite=Lax` on the cookies, and the `Sec-Fetch-Site` check together stop a cross-site page from driving these endpoints, which is why they can safely disable the standard antiforgery token (ADR-022). [Rubric §11, Security].
- **Where it's used**: mapped on the UI.Web host's endpoint routing; the SPA's auth client calls all three.

---

### SessionCookieJar
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieJar.cs:11` · Level 2 · class

- **What it is**: the single internal static helper that writes and clears the two HttpOnly auth cookies, so the endpoints, the refresher, and the SSR middleware all emit identical cookie options.
- **Depends on**: `CookieOptions`/`IWebHostEnvironment` (ASP.NET) and the cookie-name constants on [`SessionCookieEndpoints`](#sessioncookieendpoints).
- **Concept introduced: one place to build cookie options. [Rubric §11, Security]** assesses cookie hardening. Centralizing `BuildOptions` (lines 30-37) means every write is `HttpOnly = true`, `Secure` outside Development (line 33: `!environment.IsDevelopment()`, so localhost HTTP still works while production forces HTTPS), `SameSite = SameSiteMode.Lax`, and `Path = "/"`. Any drift between the seed, refresh, and clear paths is impossible because they all call this one method.
- **Walkthrough**: line 14 `Lifetime = TimeSpan.FromDays(7)`, aligned to the refresh-token lifetime so a cookie never outlives the credential it carries. `Append` (lines 16-21) writes both cookies with the 7-day `MaxAge`. `Delete` (lines 23-28) rebuilds the options with `TimeSpan.Zero`, which line 36 turns into a `null` `MaxAge`, and calls `Cookies.Delete` for both names.
- **Why it's built this way**: a delete must send back the same `Path`/`SameSite`/`Secure` attributes as the original write or the browser will not match and clear the cookie; sharing `BuildOptions` guarantees that (ADR-022).
- **Where it's used**: [`SessionCookieEndpoints`](#sessioncookieendpoints) (seed and clear) and [`CookieSessionRefresher`](#cookiesessionrefresher) (rewrite on rotation).

---

### CookieSessionRefreshMiddlewareExtensions
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:36` · Level 3 · class

- **What it is**: a one-method registration helper (`UseCookieSessionRefresh`) that adds [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) to the pipeline.
- **Depends on**: `IApplicationBuilder` (ASP.NET) and [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware).
- **Concept introduced**: the standard `UseXxx()` middleware-registration idiom; cross-reference the DI conventions in [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to). Nothing new beyond hiding `UseMiddleware<T>` behind a named, documented call.
- **Walkthrough**: lines 42-46: null-check the builder, then `return app.UseMiddleware<CookieSessionRefreshMiddleware>()`. The XML comment (lines 38-41) states the load-bearing rule: register it immediately before `UseAuthentication()`.
- **Where it's used**: the Blazor Server (UI.Web) host's pipeline configuration.

---

### CookieTokenReader
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10` · Level 3 · class

- **What it is**: the read side of the cookie feature: it pulls the access JWT and refresh token out of the request cookies (or the freshly-refreshed token stashed on `HttpContext.Items`) for server-side token storage during SSR prerender, when JS interop (localStorage) is unreachable.
- **Depends on**: `IHttpContextAccessor` (constructor, line 10) and the cookie-name constants on [`SessionCookieEndpoints`](#sessioncookieendpoints). Consumed by [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler).
- **Concept introduced: the fresh-token handoff. [Rubric §10, Cross-Cutting Concerns]** covers request-scoped state. The internal `FreshAccessTokenItemKey` constant (line 17) is the agreed `HttpContext.Items` key under which [`CookieSessionRefresher`](#cookiesessionrefresher) parks a just-rotated access token. `ReadAccessToken` checks that key first so, on the very request that triggered a refresh, SSR authentication uses the new token rather than the still-expired one sitting in the request cookie (the `Set-Cookie` only affects the next request).
- **Walkthrough**: `ReadAccessToken` (lines 19-34): return `null` if there is no `HttpContext`; otherwise prefer a non-empty `string` under `FreshAccessTokenItemKey` (lines 27-31); fall back to the access cookie (line 33). `ReadRefreshToken` (lines 36-37) reads the refresh cookie directly, with no fresh-item fallback (only the access token is ever rotated mid-request).
- **Why it's built this way**: the Items-first precedence is what makes the middleware's server-side refresh actually take effect on the triggering request instead of only the next one (ADR-022).
- **Where it's used**: [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler) and the UI host's server-side token store during prerender.

---

### CookieSessionRefresher
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:43` · Level 4 · class

- **What it is**: the singleton implementation of [`ICookieSessionRefresher`](#icookiesessionrefresher): it validates the access cookie's JWT locally and, when it has expired, exchanges the refresh cookie at the API's `auth/refresh` endpoint server-to-server, writes the rotated pair back as cookies, and single-flights concurrent refreshes so a thundering herd rotates the token only once.
- **Depends on**: `IHttpClientFactory`, `IMemoryCache`, `IWebHostEnvironment` (constructor, lines 43-46), [`SessionCookieJar`](#sessioncookiejar), [`CookieTokenReader`](#cookietokenreader) (the Items key), [`SessionCookieEndpoints`](#sessioncookieendpoints) (cookie names), and the [`AuthenticationResponse`](#authenticationresponse)/[`RefreshTokenRequest`](#refreshtokenrequest) contracts from `MMCA.Common.Shared.Auth`. Uses `System.IdentityModel.Tokens.Jwt` to read expiry.
- **Concept introduced: single-flight refresh under a thundering herd. [Rubric §12, Performance & Scalability]** assesses behavior under concurrent load. When an access token expires, many queued requests can arrive at once; rotating for each would invalidate the refresh token repeatedly and log the user out. The type comment (lines 36-42) states the design: a process-wide `SemaphoreSlim` (line 53) plus a short 10-second rotation-grace cache (line 51 `RotationGrace`) collapse concurrent refreshes. The first request rotates and caches the result keyed by the OLD refresh token (line 133); siblings carrying the same expired pair read the cached rotated pair instead of rotating again.
- **Walkthrough**: `GetOrRefreshAsync` (lines 55-84): read the access cookie and, if `TryReadValidExpiry` passes, return it as-is (lines 59-63). Otherwise read the refresh cookie; a missing one returns `null` (lines 65-69). Call `RefreshAsync`, and on success write the rotated pair with `SessionCookieJar.Append` (line 78) and stash the fresh access token on `context.Items[CookieTokenReader.FreshAccessTokenItemKey]` (line 82). `RefreshAsync` (lines 86-108) is the double-checked lock: a cache hit returns immediately (lines 88-91), otherwise it waits the semaphore, re-checks the cache (a request it queued behind may have just rotated, lines 97-100), then calls `CallRefreshAsync`. `CallRefreshAsync` (lines 110-135) POSTs a `RefreshTokenRequest` to the relative `auth/refresh` URI on the named `SessionCookieRefreshClient` (line 48), deliberately with `CancellationToken.None` (lines 114-119) so that once the lock is held the rotation completes and writes its cookies even if the triggering request was aborted, then caches the `AuthenticationResponse` under the old refresh token for `RotationGrace`. `TryReadValidExpiry` (lines 137-166) reads the JWT and rejects it if `ValidTo <= UtcNow + ClockSkew` (30-second skew, line 50), catching malformed-token exceptions. `Dispose` (line 170) releases the semaphore.
- **Why it's built this way**: keying the grace cache by the OLD token is what lets a slightly-late sibling still find the rotated pair; refreshes are rare (only on cold-navigation expiry) and each holds the lock for one short HTTP call, so the process-wide lock is cheap (ADR-022). The server-to-server call is what keeps the refresh token off browser JS. [Rubric §11, Security].
- **Where it's used**: resolved as [`ICookieSessionRefresher`](#icookiesessionrefresher) by [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) and the `/auth/session/token` endpoint.
- **Caveats / not-in-source**: the `SessionCookieRefreshClient` named `HttpClient` must be configured (base address = the API) by the host; that registration lives in the host's DI, not this file.

---

### SessionCookieAuthenticationHandler
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24` · Level 4 · class

- **What it is**: an ASP.NET Core `AuthenticationHandler` that reads the JWT from the session cookie, parses its claims, and populates `HttpContext.User` during SSR prerender, so both Blazor's internal SSR authorization and endpoint `[Authorize]` pass on a fresh GET before the interactive phase starts.
- **Depends on**: `AuthenticationHandler<AuthenticationSchemeOptions>` (ASP.NET), [`CookieTokenReader`](#cookietokenreader) (constructor, line 28), and `System.IdentityModel.Tokens.Jwt`. Registered by [`SessionCookieAuthenticationExtensions`](#sessioncookieauthenticationextensions).
- **Concept introduced: a deliberately non-validating scheme. [Rubric §11, Security]** assesses where the trust decision is actually made. The `<remarks>` (lines 18-23) are load-bearing: this handler does not validate the JWT signature. The cookie was minted by the UI host after a successful API login, and every real API call still performs full JWT validation, so this handler exists only to extract claims for ASP.NET's auth system during prerender. It is the reason a deep-linked `[Authorize]` page renders instead of flashing a redirect.
- **Walkthrough**: `SchemeName = "SessionCookie"` (line 32) is the canonical scheme name. `HandleAuthenticateAsync` (lines 35-69): read the token via [`CookieTokenReader`](#cookietokenreader); no token gives `AuthenticateResult.NoResult()` (lines 37-41). It then checks the token is a readable JWT (`Fail` if not, lines 46-49) and, using the base handler's injectable `TimeProvider` (line 55), fails if `ValidTo` is in the past (lines 55-58). On success it builds a `ClaimsIdentity` from the JWT claims with `NameIdentifier`/`Role` claim types (line 60), wraps it in a `ClaimsPrincipal` and `AuthenticationTicket`, and returns `Success` (lines 60-63), catching malformed-token exceptions as `Fail` (lines 65-68). `HandleChallengeAsync` (lines 72-77) redirects an unauthenticated caller to `/login?returnUrl=...`. `HandleForbiddenAsync` (lines 80-84) sets a bare `403`.
- **Why it's built this way**: validating the signature here would duplicate the API's JWKS validation and couple the UI host to the signing key; extracting claims only, while the API remains the single validation authority, keeps the trust boundary in one place (ADR-004 / ADR-022). Using the injectable `TimeProvider` keeps the expiry check on the same clock the rest of the auth stack (and its tests) uses. [Rubric §14, Testability].
- **Where it's used**: registered as the `SessionCookie` scheme on the UI.Web host via `AddSessionCookieAuthentication()`.

---

### SessionCookieAuthenticationExtensions
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:90` · Level 5 · class

- **What it is**: the registration helper for [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler): a single `AddSessionCookieAuthentication()` that wires the scheme into an `AuthenticationBuilder`.
- **Depends on**: `AuthenticationBuilder` (ASP.NET) and [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler).
- **Concept introduced: `extension(T)` DI registration.** The method is declared inside an `extension(AuthenticationBuilder builder)` block (lines 92-101), the C# preview extension-member syntax this codebase uses throughout for fluent DI registration (see [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)). It reads as an instance method on `AuthenticationBuilder` without a static-class `this`-parameter signature.
- **Walkthrough**: lines 98-100: `AddSessionCookieAuthentication()` calls `builder.AddScheme<AuthenticationSchemeOptions, SessionCookieAuthenticationHandler>(SessionCookieAuthenticationHandler.SchemeName, displayName: null, configureOptions: null)`, so the scheme name comes from the handler's own constant rather than a duplicated literal.
- **Where it's used**: the UI.Web host, after `AddAuthentication(SessionCookieAuthenticationHandler.SchemeName)`, as the comment on lines 94-97 directs.

### AuthenticationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared` · `MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15` · Level 0 · record struct

- **What it is**: a device-aware authentication request for mobile/MAUI clients. It carries device
  metadata (id, form factor, platform, model, manufacturer, name, type) alongside the user's email so
  sessions and tokens can be tracked and revoked per device (`AuthenticationRequest.cs:3-14`).
- **Depends on**: nothing first-party. It is eight positional `string` parameters and the BCL only.
- **Concept**: an immutable `readonly record struct` request DTO. The struct gives value-based
  equality and zero-allocation copying for a small payload that crosses the wire once per login; the
  eight positional parameters (`AuthenticationRequest.cs:15-23`) show the same shape scaling to a richer
  credential-plus-context payload. `[Rubric §11, Security]` assesses safe credential handling and
  session management: capturing device identity at authentication time is what makes per-device token
  revocation possible downstream.
- **Walkthrough**: a single positional constructor with eight `string` members
  (`AuthenticationRequest.cs:15-23`); notably this is the lone type in the root `MMCA.Common.Shared`
  namespace, while most of the auth request family lives under `MMCA.Common.Shared.Auth`.
- **Where it's used**: device-aware login flows initiated by the mobile/MAUI clients; the device
  fields feed per-device refresh-token tracking.

---

### ClaimBasedUserIdProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9` · Level 0 · class

- **What it is**: a SignalR `IUserIdProvider` that extracts the `user_id` JWT claim from a
  `HubConnectionContext`, so that `IHubContext<THub>.Clients.User(userId)` routes push messages to the
  right WebSocket connections (`ClaimBasedUserIdProvider.cs:5-8`).
- **Depends on**: `Microsoft.AspNetCore.SignalR.IUserIdProvider` (BCL/ASP.NET). Consumed by
  [NotificationHub](group-10-notifications.md#notificationhub) and
  [SignalRPushNotificationSender](group-10-notifications.md#signalrpushnotificationsender).
- **Concept**: `[Rubric §11, Security]` and `[Rubric §10, Cross-Cutting Concerns]`. SignalR's default
  `IUserIdProvider` keys connections by the `NameIdentifier` claim. This codebase instead stamps a
  custom `user_id` claim on every JWT (see [TokenService](#tokenservice)) for cross-service
  consistency, so a matching provider is required or `Clients.User(userId)` would silently fail to
  resolve any connection.
- **Walkthrough**: `const string UserIdClaimType = "user_id"` (`ClaimBasedUserIdProvider.cs:11`) keeps
  the claim name identical to the issuer's. `GetUserId(HubConnectionContext connection)`
  (`ClaimBasedUserIdProvider.cs:14-15`) returns `connection.User?.FindFirst("user_id")?.Value`. The
  null-conditional chain means an unauthenticated connection (no claim) returns `null`, and SignalR then
  routes it as no user rather than throwing.
- **Why it's built this way**: `sealed`, single responsibility, one claim in and one string out; the
  `const` claim type prevents the issuer and the connection router from drifting apart on a literal.
- **Where it's used**: registered as `IUserIdProvider` in Infrastructure DI; called by SignalR's
  connection manager on every server-initiated `Clients.User(...)`.

---

### IAuthUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:10` · Level 0 · interface

- **What it is**: the deliberately minimal credential and refresh-token surface an Identity module's
  `User` aggregate exposes to the shared `AuthenticationServiceBase<TUser>` workflow. It is the contract
  that lets the framework's authentication plumbing read and rotate password material and refresh tokens
  without knowing anything app-specific about the user (`IAuthUser.cs:3-9`).
- **Depends on**: nothing first-party; the BCL only (`byte[]`, `DateTime`). Implemented by each app's
  `User` aggregate (see [User](group-24-identity-module.md#user)).
- **Concept**: an inverted-dependency contract living in the Domain layer. Rather than the shared
  auth workflow depending on a concrete `User`, `User` implements a small interface the workflow owns.
  Profile fields, roles, linked aggregates, and claim sources stay app-specific: the shared workflow
  reaches those only through per-app hooks (`CreateAccessToken`, `CreateUser`), never through this
  contract (`IAuthUser.cs:5-8`). `[Rubric §1, SOLID]` (interface segregation and dependency inversion:
  the interface is exactly the credential surface, nothing more) and `[Rubric §11, Security]` (the
  password hash, its salt, and the refresh-token lifecycle are the whole contract) both apply.
- **Walkthrough**: read the members in two groups. Password material: `byte[] PasswordHash`
  (`IAuthUser.cs:14`) and `byte[] PasswordSalt` (`IAuthUser.cs:17`), where the salt length selects the
  verify algorithm (see [PasswordHasher](#passwordhasher)). The `#pragma warning disable CA1819`
  (`IAuthUser.cs:12`) knowingly returns arrays to mirror `IPasswordHasher`'s `byte[]` shape and the
  EF-mapped `varbinary` columns. Refresh-token state: nullable `string? RefreshToken`
  (`IAuthUser.cs:21`) and `DateTime? RefreshTokenExpiry` (`IAuthUser.cs:24`). Two mutators express the
  rotation and revocation business rules: `UpdateRefreshToken(string, DateTime)` (`IAuthUser.cs:27`) and
  `RevokeRefreshToken()` (`IAuthUser.cs:30`).
- **Why it's built this way**: keeping the contract in Domain and minimal keeps the shared auth
  workflow reusable across Store and ADC (both `User` aggregates implement it) while the aggregates stay
  free to model everything else however each app needs (ADR-004 for the dual-fetch/JWKS auth model that
  this contract feeds).
- **Where it's used**: the shared `AuthenticationServiceBase<TUser>` login and refresh flow; each
  Identity module's `User` aggregate is the implementer.

---

### IJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` · Level 0 · interface

- **What it is**: the abstraction that returns the active `JsonWebKeySet` served at
  `/.well-known/jwks.json`. Implementations materialize the public signing key(s) in the JWK format that
  other services consume to validate access tokens (`IJwksProvider.cs:5-10`).
- **Depends on**: `Microsoft.IdentityModel.Tokens.JsonWebKeySet` (NuGet). Implemented by
  [RsaJwksProvider](#rsajwksprovider); driven by
  [JwksSettings](group-14-module-system-composition.md#jwkssettings) and served by
  [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).
- **Concept**: `[Rubric §11, Security]` and `[Rubric §7, Microservices Readiness]` (ADR-004). In the
  extracted-service topology, services cannot share a symmetric HMAC secret without every service
  holding it and widening the blast radius on compromise. Instead the Identity service holds the RSA
  private key and publishes only the public key at a well-known URL; other services fetch it at startup
  and validate tokens against it. `IJwksProvider` is how the Identity API retrieves that public key set
  to serve.
- **Walkthrough**: a single synchronous `JsonWebKeySet GetJsonWebKeySet()` (`IJwksProvider.cs:19`);
  synchronous because key material is loaded once at startup and cached in-process. The doc comment
  instructs implementations to return an empty key set rather than throwing when no key is configured
  (`IJwksProvider.cs:13-18`), so the endpoint stays a valid, pollable URL even when JWKS publishing is
  off.
- **Why it's built this way**: the interface lets tests inject a pre-built key set without file I/O,
  and the empty-set contract keeps the `/.well-known/jwks.json` endpoint safe to expose unconditionally.
- **Where it's used**: the JWKS minimal-API endpoint in the API layer; consuming services fetch the
  document via `AddForwardedJwtBearer` at startup.

---

### LoginProtectionSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` · Level 0 · class

- **What it is**: strongly typed, `[Range]`-validated configuration for brute-force login lockout and
  registration rate limiting, bound from the `LoginProtection` configuration section
  (`LoginProtectionSettings.cs:5-8`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]`; consumed by
  [LoginProtectionService](#loginprotectionservice) via `IOptions<LoginProtectionSettings>`.
- **Concept**: `[Rubric §11, Security]`. Five `init`-only properties cover two concerns. Account
  lockout: `MaxFailedAttempts` (`LoginProtectionSettings.cs:18`), `MaxLockoutSeconds`
  (`LoginProtectionSettings.cs:24`), `FailedAttemptWindowMinutes` (`LoginProtectionSettings.cs:31`).
  Registration rate limiting: `MaxRegistrationsPerIpPerHour` (`LoginProtectionSettings.cs:37`),
  `RegistrationRateLimitWindowMinutes` (`LoginProtectionSettings.cs:43`). Every property carries a
  `[Range]`; wired with `.ValidateDataAnnotations().ValidateOnStart()` this makes the app refuse to boot
  on an obviously unsafe value (for example `MaxFailedAttempts = 0`), catching misconfiguration before
  the first request rather than at the first login.
- **Walkthrough**: `const string SectionName = "LoginProtection"` (`LoginProtectionSettings.cs:12`).
  Production-safe defaults: five failed attempts, a 300-second (5-minute) lockout cap, a 30-minute
  failed-attempt window, ten registrations per IP, and a 60-minute registration window. Every `[Range]`
  upper bound (`MaxLockoutSeconds` caps at 3600, windows at 1440) is generous enough for high-volume
  legitimate traffic.
- **Why it's built this way**: `sealed` with `init`-only properties for immutability; validation moves
  configuration errors to startup.
- **Where it's used**: [LoginProtectionService](#loginprotectionservice); the login and registration
  command handlers in each Identity module.

---

### PasswordHasher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12` · Level 1 · class

- **What it is**: the `IPasswordHasher` implementation. It hashes new passwords with
  PBKDF2-HMAC-SHA512 at 600,000 iterations (OWASP 2023 guidance) and verifies against both the current
  PBKDF2 format and a legacy HMAC-SHA512 format, choosing the algorithm from the stored salt length
  (`PasswordHasher.cs:7-11`).
- **Depends on**: [IPasswordHasher](#ipasswordhasher) (the Application contract);
  `System.Security.Cryptography` (`Rfc2898DeriveBytes`, `RandomNumberGenerator`, `HMACSHA512`,
  `CryptographicOperations`) and `System.Text.Encoding` (BCL).
- **Concept introduced: password hashing with a salt-length-encoded algorithm selector.**
  `[Rubric §11, Security]` assesses credential-at-rest protection, and this type is the clearest
  expression of it in the framework. Three deliberate choices are visible in source: a work factor high
  enough to make brute force expensive (`Iterations = 600_000`, `PasswordHasher.cs:24`), constant-time
  comparison to defeat timing side channels (`PasswordHasher.cs:56-58`), and a migration path that
  upgrades old hashes without a flag column by reading the salt length. The salt-length trick is the
  teaching point: a PBKDF2 salt is 32 bytes (`SaltSize`, `PasswordHasher.cs:15`) while a legacy
  HMAC-SHA512 salt is the 128-byte HMAC key (`LegacyHmacSaltSize`, `PasswordHasher.cs:27`), so the salt
  itself records which algorithm produced the hash.
- **Walkthrough**
  - Constants first: `SaltSize = 32`, `HashSize = 64` (512 bits, `PasswordHasher.cs:18`),
    `Iterations = 600_000` (`PasswordHasher.cs:24`), `LegacyHmacSaltSize = 128` (`PasswordHasher.cs:27`).
  - `HashPassword(string)` (`PasswordHasher.cs:30`): guards against blank input, draws a fresh 32-byte
    salt from `RandomNumberGenerator.GetBytes`, derives the hash via `Rfc2898DeriveBytes.Pbkdf2` with
    SHA512, and returns the `(Hash, Salt)` tuple (`PasswordHasher.cs:34-42`). New passwords are always
    PBKDF2.
  - `VerifyPassword(string, byte[] hash, byte[] salt)` (`PasswordHasher.cs:46`): selects the algorithm
    by `salt.Length == LegacyHmacSaltSize` (`PasswordHasher.cs:52`), computing either the legacy HMAC or
    a PBKDF2 hash sized to the stored hash length, then compares with
    `CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:58`) so the comparison always walks the
    full length regardless of where the first byte differs.
  - `ComputePbkdf2Hash` (`PasswordHasher.cs:62`) and `ComputeLegacyHash` (`PasswordHasher.cs:71`) are the
    two private algorithm bodies.
- **Why it's built this way**: verification stays backward-compatible with pre-existing HMAC hashes so
  a deployment can migrate lazily; new writes are PBKDF2 only, so the population converges without a
  data migration. `FixedTimeEquals` and the 600k iteration count are the concrete OWASP-aligned defenses
  (ADR-032 for the password-material model this feeds).
- **Where it's used**: the Identity module's registration and login command handlers, against the
  `PasswordHash`/`PasswordSalt` exposed by [IAuthUser](#iauthuser).

---

### RsaJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15` · Level 1 · class

- **What it is**: the production [IJwksProvider](#ijwksprovider). It builds a `JsonWebKeySet` from a
  PEM-encoded RSA public key configured via `JwksSettings`, and returns an empty set when publishing is
  disabled (the default) or no key is configured (`RsaJwksProvider.cs:8-13`).
- **Depends on**: [IJwksProvider](#ijwksprovider);
  [JwksSettings](group-14-module-system-composition.md#jwkssettings) via `IOptions<JwksSettings>`;
  `System.Security.Cryptography.RSA`, `Microsoft.IdentityModel.Tokens`
  (`JsonWebKeySet`, `RsaSecurityKey`, `JsonWebKeyConverter`) (NuGet/BCL).
- **Concept**: reinforces the JWKS story introduced on [IJwksProvider](#ijwksprovider)
  (`[Rubric §11, Security]`, `[Rubric §7, Microservices Readiness]`, ADR-004). The build cost is paid
  once and memoized: the constructor stores a `Lazy<JsonWebKeySet>` (`RsaJwksProvider.cs:17`) so the PEM
  is parsed a single time on first request and cached for the process lifetime.
- **Walkthrough**
  - Primary constructor takes `IOptions<JwksSettings>` and captures the lazy key set
    (`RsaJwksProvider.cs:15-17`); `GetJsonWebKeySet()` just returns `_cachedKeySet.Value`
    (`RsaJwksProvider.cs:20`).
  - `BuildKeySet(JwksSettings)` (`RsaJwksProvider.cs:22`) short-circuits to an empty `JsonWebKeySet`
    when `!settings.Enabled` (`RsaJwksProvider.cs:24-27`) or when the resolved PEM is blank
    (`RsaJwksProvider.cs:30-33`).
  - With a key present it imports the PEM into a disposable `RSA`, exports only the public parameters
    (`includePrivateParameters: false`, `RsaJwksProvider.cs:38`) into an `RsaSecurityKey` tagged with the
    configured `KeyId`, converts it to a JWK, marks it `Use = "sig"` and `Alg = RsaSha256`
    (`RsaJwksProvider.cs:43-45`), and adds it to the set (`RsaJwksProvider.cs:47-49`).
  - `ResolvePem(JwksSettings)` (`RsaJwksProvider.cs:52`) prefers the inline `RsaPublicKeyPem`
    (`RsaJwksProvider.cs:54-57`) and otherwise reads `RsaPublicKeyPath` from disk with a synchronous
    `File.ReadAllText`, justified by the comment because it runs once at startup and the result is cached
    (`RsaJwksProvider.cs:59-64`).
- **Why it's built this way**: exporting only public parameters guarantees the private key never
  reaches the JWKS document; the dual inline-PEM-or-path option supports both secrets-manager injection
  and volume-mounted key files. The empty-set fallbacks keep the endpoint always-valid per the
  [IJwksProvider](#ijwksprovider) contract.
- **Where it's used**: registered as `IJwksProvider` in Infrastructure DI; the JWKS endpoint calls
  `GetJsonWebKeySet()` per request.

---

### TokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:23` · Level 2 · class

- **What it is**: the JWT token service. It mints access tokens (user id, email, role, full name, plus
  optional extra claims), generates cryptographically random refresh tokens, and validates expired
  tokens for the refresh flow. It supports both symmetric HS256 and asymmetric RS256 signing, selected
  once at construction (`TokenService.cs:11-22`).
- **Depends on**: [ITokenService](#itokenservice);
  [IJwtSettings](group-14-module-system-composition.md#ijwtsettings);
  [JwtSigningAlgorithm](group-14-module-system-composition.md#jwtsigningalgorithm);
  `System.IdentityModel.Tokens.Jwt`, `Microsoft.IdentityModel.Tokens`, `System.Security.Cryptography`
  (NuGet/BCL). A `TimeProvider` is injected for testable timestamps.
- **Concept introduced: dual-algorithm JWT service and an intentional lifetime bypass.**
  `[Rubric §11, Security]` assesses token issuance, refresh handling, and algorithm-confusion defense.
  Two security-critical choices are explicit in source: `GetPrincipalFromExpiredToken` sets
  `ValidateLifetime = false` on purpose (`TokenService.cs:125`), scoped under
  `#pragma warning disable CA5404` with a comment explaining that the refresh flow must read claims from
  an already-expired token (`TokenService.cs:124`); and validation pins the algorithm via
  `ValidAlgorithms = [_validationAlgorithm]` (`TokenService.cs:130`) and re-checks the token header's
  `Alg` after validation (`TokenService.cs:139-140`), which blocks the algorithm-substitution attack
  where a public RS256 key is abused as an HS256 secret. RS256 is the extracted-service mode (ADR-004):
  the issuer signs with its private key and publishes the public key via JWKS so other services validate
  without a shared secret.
- **Walkthrough**
  - Constructor (`TokenService.cs:47`): materializes the signing and validation keys once. For RS256 it
    calls `BuildRsaCredentials` (`TokenService.cs:174`) and owns the two `RSA` instances; for HS256 it
    calls `BuildHmacCredentials` (`TokenService.cs:160`), which Base64-decodes `SecretForKey` into a
    `SymmetricSecurityKey`. Missing key material throws at construction, not at first use.
  - `GenerateAccessToken` (`TokenService.cs:67`): assembles a seven-claim set including `sub`, `jti`,
    `iat`, the custom `user_id`, name, email, and role (`TokenService.cs:76-85`), appends any
    caller-supplied claims, and writes a `JwtSecurityToken` whose `notBefore`/`expires` come from the
    injected `TimeProvider` and `AccessTokenExpirationMinutes` (`TokenService.cs:92-100`).
  - `GenerateRefreshToken` (`TokenService.cs:104`): 64 random bytes from `RandomNumberGenerator`,
    Base64-encoded.
  - `GetPrincipalFromExpiredToken` (`TokenService.cs:117`): validates issuer, audience, signature, and
    algorithm but not lifetime; any validation failure is swallowed and returns `null`
    (`TokenService.cs:147-150`) rather than leaking an exception.
  - `Dispose` (`TokenService.cs:154`): releases the owned `RSA` handles.
- **Why it's built this way**: see ADR-004 (dual-fetch/JWKS auth) for the RS256 rationale. Owning and
  disposing the `RSA` objects is required to release native key handles; the `RsaSecurityKey` wrappers
  hold only weak references to them (`TokenService.cs:31-34`).
- **Where it's used**: the Identity module's authentication and refresh command handlers; the emitted
  `user_id` claim is what [CurrentUserService](#currentuserservice) and
  [ClaimBasedUserIdProvider](#claimbaseduseridprovider) read back.

---

### LoginProtectionService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:18` · Level 4 · class

- **What it is**: the cache-backed brute-force and rate-limiting service: exponential-backoff account
  lockout after repeated login failures, plus a per-IP registration rate limit
  (`LoginProtectionService.cs:8-17`).
- **Depends on**: [ILoginProtectionService](#iloginprotectionservice);
  [LoginProtectionSettings](#loginprotectionsettings) via `IOptions<>`;
  [ICacheService](group-09-caching.md#icacheservice); [Result](group-01-result-error-handling.md#result)
  and [Error](group-01-result-error-handling.md#error).
- **Concept**: `[Rubric §11, Security]` (brute-force protection, rate limiting) and
  `[Rubric §10, Cross-Cutting Concerns]` (the protection is a shared service contract, not logic
  copy-pasted per endpoint). The lockout math is worth reading closely
  (`LoginProtectionService.cs:52-58`): `excessAttempts = newCount - MaxFailedAttempts` drives
  `lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), MaxLockoutSeconds)`, doubling the
  lockout per excess failure (1s, 2s, 4s, ...) capped at the configured maximum. The inner
  `Math.Min(excessAttempts, 30)` clamps the shift exponent: C# masks an `int` shift count to five bits,
  so an unclamped `1 << 32` would wrap back to `1` and a persistent attacker could silently shrink their
  own lockout. `1 << 30` already exceeds the 3600-second range cap, so deep excess always lands on the
  cap (`LoginProtectionService.cs:54-57`).
- **Walkthrough**
  - `CheckLockoutAsync(string email, CancellationToken)` (`LoginProtectionService.cs:25`): reads a
    boolean `login:lockout:{email}` cache key; returns `Error.Unauthorized("Auth.TooManyAttempts", ...)`
    when set, otherwise `Result.Success()`.
  - `IncrementFailedAttemptsAsync` (`LoginProtectionService.cs:39`): increments
    `login:attempts:{email}` inside the `FailedAttemptWindowMinutes` window, and once the count reaches
    `MaxFailedAttempts` writes the lockout key with the exponential TTL described above.
  - `ResetFailedAttemptsAsync` (`LoginProtectionService.cs:65`): removes both the attempts and lockout
    keys on a successful login.
  - `CheckRegistrationRateLimitAsync(string? ipAddress, ...)` (`LoginProtectionService.cs:72`): a null or
    empty IP is treated as unrestricted; otherwise it compares the `registration:ip:{ipAddress}` count
    against `MaxRegistrationsPerIpPerHour` and fails with `Auth.RegistrationRateLimitExceeded` when
    exceeded.
  - `IncrementRegistrationCountAsync` (`LoginProtectionService.cs:91`): increments the per-IP counter
    inside `RegistrationRateLimitWindowMinutes`.
- **Why it's built this way**: reusing [ICacheService](group-09-caching.md#icacheservice) (Redis in
  production, in-memory fallback) instead of a bespoke store keeps the service thin and lets attempt
  counters expire naturally via cache TTL rather than an explicit sweep; `IOptions<>` keeps the
  thresholds configurable.
- **Where it's used**: injected into the Identity module's login and registration command handlers.

---

### CurrentUserService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:12` · Level 7 · class

- **What it is**: the scoped, per-request implementation of `ICurrentUserService`. It extracts the
  current user's id, role, and arbitrary typed claims from the JWT in the HTTP context
  (`CurrentUserService.cs:7-11`).
- **Depends on**: [ICurrentUserService](#icurrentuserservice); `Microsoft.AspNetCore.Http`
  (`IHttpContextAccessor`) and `System.Security.Claims` (BCL). The `user_id` claim it reads is emitted
  by [TokenService](#tokenservice).
- **Concept: scoped JWT claim extraction with lazy per-request caching.**
  `[Rubric §11, Security]` assesses correct, over-share-free claim extraction. The service is
  registered scoped (one instance per request) and wraps `_userId` and `_role` in `Lazy<T>`
  (`CurrentUserService.cs:17`, `CurrentUserService.cs:23`) so `HttpContext.User` is read at most once per
  request no matter how often the properties are accessed. Reading the custom `user_id` claim type
  (`CurrentUserService.cs:15`), not the standard `sub`, keeps the claim contract with
  [TokenService](#tokenservice) explicit.
- **Walkthrough**
  - `User` (`CurrentUserService.cs:27`): returns the `ClaimsPrincipal`, or a fresh empty one when there
    is no HTTP context (so background jobs without a request do not null-crash).
  - `UserId` (`CurrentUserService.cs:30`): `_userId.Value`, a `UserIdentifierType?` parsed with
    `int.TryParse`; `null` when the claim is absent or non-numeric.
  - `Role` (`CurrentUserService.cs:33`): `_role.Value`, the `ClaimTypes.Role` claim.
  - `GetClaimValue<T>(string claimType)` (`CurrentUserService.cs:36`): generic over
    `T : struct, IParsable<T>`, using the static-abstract `T.TryParse` to parse any primitive claim,
    returning `null` when absent or unparseable.
- **Why it's built this way**: scoped lifetime plus `Lazy<T>` gives a stable per-request snapshot at
  minimal cost; the empty-principal fallback makes the service safe outside a request pipeline.
- **Where it's used**: injected into command handlers and controllers throughout the apps, primarily to
  supply the acting `userId` to `ApplicationDbContext.SaveChangesAsync` for audit-field stamping.

### AuthClaimTypes
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:7` · Level 0 · class (static)

- **What it is**: a one-constant holder for the framework's custom JWT claim type names, sitting
  alongside the standard `System.Security.Claims.ClaimTypes` values (`AuthClaimTypes.cs:3-7`).
- **Depends on**: nothing first-party at runtime; the doc comment references
  [`IPermissionRegistry`](#ipermissionregistry).
- **Concept introduced: custom claim types for capability-based authorization.** `[Rubric §11,
  Security]` (assesses correct authN/authZ modeling and how principals carry authorization facts). The
  standard `ClaimTypes` set covers identity (name, email, role); this framework layers *permissions*
  (fine-grained capabilities) on top. `AuthClaimTypes.Permission` (`AuthClaimTypes.cs:15`, value
  `"permission"`) is the claim type a token uses to carry a single granted capability. The important
  design note is in the doc comment (`AuthClaimTypes.cs:9-14`): permission claims are honored **in
  addition to** the permissions a role confers through [`IPermissionRegistry`](#ipermissionregistry),
  and baking them into the token is *optional*: role-derived permissions work without them. So a token
  can stay small (roles only) and still authorize against capabilities.
- **Walkthrough**: a single `public const string Permission = "permission"` (`AuthClaimTypes.cs:15`).
  `const` (not `static readonly`) so the value is usable in attribute arguments and pattern matches that
  require compile-time constants, the same reason [`RoleNames`](#rolenames) uses `const`.
- **Where it's used**: the permission-based authorization path: the API's permission authorization
  handler reads permission claims of this type, and the token service writes them when a token opts to
  embed capabilities.
- **Caveats / not-in-source**: the runtime read/write of this claim lives in the Infrastructure and API
  authorization types (covered elsewhere in this chapter); only the constant is defined here.

### AuthenticationResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10` · Level 0 · record struct (readonly)

- **What it is**: the success payload returned by authentication: `(string AccessToken, string
  RefreshToken, DateTime AccessTokenExpiry)`, shared by the Identity API and the UI clients
  (`AuthenticationResponse.cs:3-9`).
- **Depends on**: nothing first-party.
- **Concept introduced: the `readonly record struct` DTO.** `[Rubric §15, Best Practices & Code
  Quality]` (assesses consistent conventions and immutability) and `[Rubric §9, API & Contract Design]`
  (assesses well-shaped request/response contracts). A positional **`record struct`** is a value type
  with a compiler-generated constructor, deconstruction, equality, and `ToString`; `readonly` makes it
  immutable. For small, short-lived request/response carriers this avoids a heap allocation while staying
  immutable: the codebase's default shape for auth DTOs, reused by every sibling below. The explicit
  `AccessTokenExpiry` (`AuthenticationResponse.cs:13`) lets clients refresh proactively instead of
  waiting for a 401.
- **Walkthrough**: three positional parameters (`AuthenticationResponse.cs:10-13`); no body.
- **Where it's used**: returned by the login and token-refresh endpoints; consumed by the UI's auth
  state provider and token storage.

### ChangePasswordRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePasswordRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: `(string CurrentPassword, string NewPassword)` for an authenticated password change
  (`ChangePasswordRequest.cs:3-7`).
- **Depends on**: nothing first-party.
- **Concept**: the same `readonly record struct` DTO shape introduced by
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §11, Security]`: passing the current
  password re-proves the user's identity before a credential change, and the password fields are meant
  to travel over TLS and never be logged (enforced operationally by PII masking, not by this type).
- **Walkthrough**: two positional parameters (`ChangePasswordRequest.cs:8-10`).
- **Where it's used**: the change-password endpoint and the profile UI.

### IcsEvent
> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15` · Level 0 · record (sealed)

- **What it is**: one calendar entry consumed by [`IcsCalendarBuilder`](#icscalendarbuilder): a
  positional `sealed record` carrying a stable UID, title, start/end instants, and optional
  description/location (`IcsEvent.cs:15-21`).
- **Depends on**: nothing first-party; `DateTimeOffset` (BCL).
- **Concept: UTC-by-contract calendar times.** `[Rubric §9, API & Contract Design]` (assesses clear,
  unambiguous contracts). Unlike the auth siblings this is a `record` (reference type), not a `record
  struct`, because it carries optional members and is passed as a collection to the builder. The
  load-bearing contract is in the doc comment (`IcsEvent.cs:3-8`): `StartsAtUtc`/`EndsAtUtc` are UTC by
  contract, so converting a wall-clock time in the event's IANA time zone to UTC is the *caller's* job.
  That single rule lets the builder emit `Z`-suffixed timestamps and skip RFC 5545's error-prone
  VTIMEZONE machinery entirely.
- **Walkthrough**: six positional parameters (`IcsEvent.cs:15-21`): `Uid` (globally unique, stable,
  used by calendar apps to de-duplicate reimports), `Summary`, `StartsAtUtc`, `EndsAtUtc`, and the two
  nullable optionals `Description = null` and `Location = null`.
- **Where it's used**: passed as an `IReadOnlyCollection<IcsEvent>` to
  [`IcsCalendarBuilder`](#icscalendarbuilder)'s `Build`; an app maps its own domain rows (e.g. a
  session's schedule) into these before export.

### IPermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/IPermissionRegistry.cs:13` · Level 0 · interface

- **What it is**: the abstraction that maps roles to the fine-grained permissions they grant, and the
  single place that knows which roles confer which capabilities (`IPermissionRegistry.cs:3-13`).
- **Depends on**: nothing first-party; described alongside [`RoleNames`](#rolenames) and the
  [`AuthClaimTypes`](#authclaimtypes) permission claim.
- **Concept introduced: permission (capability) authorization over role checks.** `[Rubric §11,
  Security]` (assesses the authorization model) and `[Rubric §1, SOLID]` (dependency inversion:
  endpoints depend on an abstraction, not on role names). Instead of scattering `[Authorize(Roles =
  "Organizer")]` across endpoints, code authorizes against a *permission* (a capability such as
  "sessions.edit"), and this registry translates a principal's roles into the permissions they hold.
  The payoff is decoupling: adding a role or re-shaping who-can-do-what is a registry change, not an
  edit to every endpoint (`IPermissionRegistry.cs:5-7`). The contract also fixes the comparison rules
  (`IPermissionRegistry.cs:9-12`): role lookups are case-insensitive, permission values are ordinal, and
  implementations are expected to be immutable and thread-safe.
- **Walkthrough**: two members. `GetPermissions(string role)` (`IPermissionRegistry.cs:20`) returns the
  permission set for a role, or an empty set for an unknown role (no throw). `HasPermission(IEnumerable<
  string> roles, string permission)` (`IPermissionRegistry.cs:28`) answers whether *any* of a
  principal's roles grants the permission: the hot path the authorization handler calls per request.
- **Why it's built this way**: an empty-set-on-miss contract keeps callers branchless, and pushing the
  who-grants-what knowledge behind one interface is the capability-based-security expression of the
  framework's "decision logic behind an abstraction" habit.
- **Where it's used**: implemented by [`PermissionRegistry`](#permissionregistry) (built via
  [`PermissionRegistryBuilder`](#permissionregistrybuilder)); consumed by the API authorization layer
  (the permission authorization handler and permission attribute).

### LoginRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/LoginRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: the email/password payload for authentication: `(string Email, string Password)`
  (`LoginRequest.cs:3-8`).
- **Depends on**: nothing first-party.
- **Concept**: the `readonly record struct` DTO introduced by
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §11, Security]`: the doc comment
  (`LoginRequest.cs:7`) records the rule that the password travels over TLS and is never logged. That
  convention is enforced operationally (PII masking), not by this type, but the intent is documented at
  the source.
- **Walkthrough**: two positional parameters (`LoginRequest.cs:8-10`); no body.
- **Where it's used**: validated by [`LoginRequestValidator`](#loginrequestvalidator); consumed by the
  Identity module's login endpoint and the UI login form.

### OAuthCodeExchangeRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:11` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Code)` that exchanges a short-lived, single-use OAuth
  completion code for the token pair (`OAuthCodeExchangeRequest.cs:3-11`).
- **Depends on**: nothing first-party.
- **Concept reinforced: security by construction.** `[Rubric §11, Security]` and `[Rubric §26,
  Front-End Security]` (assesses safe token handling: no secrets leaking into the browser). The doc
  comment (`OAuthCodeExchangeRequest.cs:3-9`) explains *why* the indirection exists: the server mints an
  opaque code after the external-provider callback succeeds and carries *that* in the redirect URL, so
  the access/refresh tokens never appear in the address bar, browser history, the `Referer` header, or
  server access logs. A concrete, well-reasoned security design captured at the contract level.
- **Walkthrough**: one positional `string Code` (`OAuthCodeExchangeRequest.cs:11-12`).
- **Where it's used**: the OAuth "complete" endpoint's exchange step, called from the UI after the
  provider redirect lands.

### RefreshTokenRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RefreshTokenRequest.cs:9` · Level 0 · record struct (readonly)

- **What it is**: `(string AccessToken, string RefreshToken)`; it sends the *expired* access token
  alongside the refresh token so the server can read its claims without forcing a full re-authentication
  (`RefreshTokenRequest.cs:3-8`).
- **Depends on**: nothing first-party.
- **Concept**: `readonly record struct` DTO (see [`AuthenticationResponse`](#authenticationresponse)).
  `[Rubric §11, Security]`: part of the JWT refresh flow; carrying the expired token lets the server
  reconstruct the principal cheaply while still gating the refresh on the opaque refresh token.
- **Walkthrough**: two positional parameters (`RefreshTokenRequest.cs:9-11`).
- **Where it's used**: validated by
  [`RefreshTokenRequestValidator`](#refreshtokenrequestvalidator); consumed by the token-refresh
  endpoint.

### RoleNames
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:12` · Level 0 · class (static)

- **What it is**: canonical role-name string constants shared across all layers and both apps
  (`RoleNames.cs:3-12`).
- **Depends on**: nothing first-party.
- **Concept introduced: centralized constants over magic strings.** `[Rubric §11, Security]`
  (authorization correctness) and `[Rubric §16, Maintainability]` (low duplication, one place to
  change). Roles are stored as plain strings and emitted as JWT claims; using `RoleNames.Organizer`
  instead of the literal `"Organizer"` everywhere prevents typo-driven authorization bugs. The doc
  comment (`RoleNames.cs:8-10`) notes role comparisons should be **case-insensitive**
  (`ICurrentUserService.IsInRole`), matching the equality contract in [`RoleValue`](#rolevalue).
- **Walkthrough**: five `public const string` fields: `Organizer` (`RoleNames.cs:15`), `Attendee`
  (`RoleNames.cs:18`), and `ContentEditor` (`RoleNames.cs:25`) are ADC roles, while `Admin`
  (`RoleNames.cs:28`) and `Customer` (`RoleNames.cs:31`) are Store roles. `ContentEditor` is documented
  as a strict subset of the Organizer's capabilities (`RoleNames.cs:20-24`): it curates the session
  catalog without full event-structure or user-administration rights. The constants live in the shared
  framework so both consumers draw from one list.
- **Why it's built this way**: `const` (not `static readonly`) so the values can be used in attribute
  arguments (`[Authorize(Roles = RoleNames.Organizer)]`), which require compile-time constants.
- **Where it's used**: authorization policies, `[Authorize]` attributes, per-app
  [`RoleValue`](#rolevalue) subclasses, and role checks across the Identity module and UI.

### IcsCalendarBuilder
> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12` · Level 1 · class (static)

- **What it is**: a dependency-free RFC 5545 iCalendar writer for "add to calendar" exports, turning a
  product id and a collection of [`IcsEvent`](#icsevent)s into a complete `VCALENDAR` string
  (`IcsCalendarBuilder.cs:6-12`).
- **Depends on**: [`IcsEvent`](#icsevent); `System.Text.StringBuilder`, `System.Globalization` (BCL).
- **Concept introduced: a deliberately minimal, deterministic protocol writer.** `[Rubric §15, Best
  Practices & Code Quality]` (assesses a focused, correct, standards-compliant implementation). Rather
  than pull in a heavyweight iCalendar NuGet, the builder implements exactly the RFC 5545 subset every
  calendar app imports reliably: UTC-only timestamps (no VTIMEZONE), TEXT escaping, CRLF line endings,
  and 75-octet line folding (`IcsCalendarBuilder.cs:8-11`). It is **deterministic**: the caller supplies
  `dtStamp`, so identical inputs produce byte-identical output, which makes the export cacheable and
  testable.
- **Walkthrough**: one public entry point and four private helpers.
  `Build(productId, events, dtStamp)` (`IcsCalendarBuilder.cs:22`) guards its inputs
  (`IcsCalendarBuilder.cs:24-25`), writes the `VCALENDAR` header lines (`VERSION:2.0`,
  `PRODID`, `CALSCALE`, `METHOD:PUBLISH`, `IcsCalendarBuilder.cs:28-32`), appends each event, and closes
  the document (`IcsCalendarBuilder.cs:34-40`). `AppendEvent` (`IcsCalendarBuilder.cs:43`) writes a
  `VEVENT` block with `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, and the optional
  `DESCRIPTION`/`LOCATION` only when present (`IcsCalendarBuilder.cs:52-60`). `FormatUtc`
  (`IcsCalendarBuilder.cs:65`) renders an instant as the `Z`-suffixed
  `yyyyMMddTHHmmssZ` form using `CultureInfo.InvariantCulture`. `EscapeText`
  (`IcsCalendarBuilder.cs:69`) applies RFC 5545 §3.3.11 TEXT escaping (backslash, semicolon, comma,
  newlines). The subtlest helper is `AppendLine` (`IcsCalendarBuilder.cs:83`): it folds content lines at
  75 octets (UTF-8), never splitting a multi-byte character because it counts octets per char and treats
  a surrogate pair as one unit (`IcsCalendarBuilder.cs:89-98`), and the leading fold space counts
  against the continuation line's budget (`IcsCalendarBuilder.cs:95`).
- **Why it's built this way**: a static, allocation-light writer with no external dependency keeps the
  Shared layer pure and Blazor-WASM-safe, and pushing the `dtStamp` to the caller is what makes the
  output deterministic.
- **Where it's used**: the calendar-export endpoints/services in the apps (e.g. an ADC session-schedule
  `.ics` download).

### LoginRequestValidator
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11` · Level 1 · class

- **What it is**: a FluentValidation validator for [`LoginRequest`](#loginrequest) that checks only for
  a non-empty, well-formed email and a non-empty password (`LoginRequestValidator.cs:6-11`).
- **Depends on**: [`LoginRequest`](#loginrequest); `FluentValidation.AbstractValidator<T>` (NuGet).
- **Concept introduced: FluentValidation `AbstractValidator<T>` for request shape.** `[Rubric §24,
  Forms/Validation/UX Safety]` (assesses input validation) and `[Rubric §11, Security]`. A validator
  subclasses `AbstractValidator<LoginRequest>` and declares rules in its constructor with
  `RuleFor(...)` chains; the framework's convention scanning auto-registers every validator so the CQRS
  validating decorator (see [Group 06](group-06-validation.md)) runs it before a command's transaction
  opens. The security-relevant design note is in the doc comment (`LoginRequestValidator.cs:6-9`): the
  validator is *intentionally minimal*. It confirms the fields are present and the email is shaped like
  an email, but detailed credential verification happens inside the authentication service so the
  response never leaks *which* field was wrong.
- **Walkthrough**: the constructor (`LoginRequestValidator.cs:13`) declares two rules: `Email` must be
  `NotEmpty` and pass `EmailAddress` (`LoginRequestValidator.cs:15-17`), and `Password` must be
  `NotEmpty` (`LoginRequestValidator.cs:19-20`), each with an explicit message.
- **Where it's used**: auto-discovered by module convention scanning and applied by the validating
  decorator on the login command; the richer, cross-field auth validators live in
  [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators).

### PermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistry.cs:10` · Level 1 · class (sealed)

- **What it is**: the immutable, thread-safe implementation of
  [`IPermissionRegistry`](#ipermissionregistry), backed by a frozen role-to-permissions map
  (`PermissionRegistry.cs:5-10`).
- **Depends on**: [`IPermissionRegistry`](#ipermissionregistry); `System.Collections.Frozen`
  (`FrozenDictionary`/`FrozenSet`, BCL).
- **Concept introduced: `Frozen*` collections for read-optimized immutable lookups.** `[Rubric §12,
  Performance & Scalability]` (assesses hot-path data-structure choices) and `[Rubric §11, Security]`.
  A `FrozenDictionary`/`FrozenSet` is built once and then optimized for repeated reads, which is exactly
  the authorization access pattern: constructed at startup, queried on every request. The registry pins
  the two comparison rules from the interface into the data structure itself: the outer dictionary uses
  `StringComparer.OrdinalIgnoreCase` so role lookups are case-insensitive
  (`PermissionRegistry.cs:25-28`), while each permission set uses `StringComparer.Ordinal` so permission
  values compare exactly (`PermissionRegistry.cs:27`).
- **Walkthrough**: a shared empty `FrozenSet` sentinel (`PermissionRegistry.cs:12`) and the frozen map
  field (`PermissionRegistry.cs:14`). The constructor (`PermissionRegistry.cs:21`) freezes the supplied
  role-to-permissions map with the two comparers (`PermissionRegistry.cs:25-28`). `GetPermissions`
  (`PermissionRegistry.cs:32`) returns the matching set or the shared empty sentinel on a miss (so it
  never allocates or throws). `HasPermission` (`PermissionRegistry.cs:38`) guards its inputs then
  short-circuits on the first role whose set contains the permission (`PermissionRegistry.cs:43-53`).
- **Why it's built this way**: freezing at construction trades a one-time build cost for fast, lock-free
  concurrent reads, which suits a startup-built structure hit on every authorized request.
- **Where it's used**: registered as the [`IPermissionRegistry`](#ipermissionregistry) singleton and
  constructed via [`PermissionRegistryBuilder`](#permissionregistrybuilder); read by the API's
  permission authorization handler.

### RefreshTokenRequestValidator
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10` · Level 1 · class

- **What it is**: a FluentValidation validator for [`RefreshTokenRequest`](#refreshtokenrequest) that
  requires both tokens to be present (`RefreshTokenRequestValidator.cs:6-10`).
- **Depends on**: [`RefreshTokenRequest`](#refreshtokenrequest);
  `FluentValidation.AbstractValidator<T>` (NuGet).
- **Concept**: the same `AbstractValidator<T>` shape introduced by
  [`LoginRequestValidator`](#loginrequestvalidator). `[Rubric §24, Forms/Validation/UX Safety]`. Both
  token fields are load-bearing: the expired access token supplies the claims to reconstruct the
  principal, and the refresh token drives rotation verification (`RefreshTokenRequestValidator.cs:6-8`),
  so each gets a `NotEmpty` rule.
- **Walkthrough**: the constructor (`RefreshTokenRequestValidator.cs:12`) declares `AccessToken`
  `NotEmpty` (`RefreshTokenRequestValidator.cs:14-15`) and `RefreshToken` `NotEmpty`
  (`RefreshTokenRequestValidator.cs:17-18`).
- **Where it's used**: auto-registered by convention scanning; applied ahead of the token-refresh
  command.

### PermissionRegistryBuilder
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:8` · Level 2 · class (sealed)

- **What it is**: a mutable accumulator that collects role-to-permission grants and freezes them into
  an immutable [`PermissionRegistry`](#permissionregistry) (`PermissionRegistryBuilder.cs:3-8`).
- **Depends on**: [`PermissionRegistry`](#permissionregistry) (its build target).
- **Concept introduced: the builder pattern for multi-module contribution.** `[Rubric §2, Design
  Patterns]` (assesses idiomatic pattern use) and `[Rubric §7, Microservices Readiness]` (each module
  declares only what it owns). The builder separates the *accumulation* phase (mutable, order-free,
  contributed to by many modules) from the *finished* phase (an immutable snapshot). The key property is
  in the doc comment (`PermissionRegistryBuilder.cs:5-7`): multiple modules can grant permissions for
  the same role and the grants are **unioned**, so each module declares only the permissions it owns
  without knowing about the others.
- **Walkthrough**: a case-insensitive backing `Dictionary<string, HashSet<string>>`
  (`PermissionRegistryBuilder.cs:14-15`); the inline comment (`PermissionRegistryBuilder.cs:10-13`)
  explains why a concrete dictionary with an explicit `OrdinalIgnoreCase` comparer is kept over a
  collection expression (the comparer must survive, and CA1859 favors the concrete type). `Grant(role,
  params permissions)` (`PermissionRegistryBuilder.cs:25`) is additive and idempotent: it filters blank
  permissions (`PermissionRegistryBuilder.cs:30`), then either unions into the existing set or seeds a
  new ordinal `HashSet` (`PermissionRegistryBuilder.cs:32-39`), and returns `this` for chaining.
  `Build()` (`PermissionRegistryBuilder.cs:46`) projects the grants into an
  `IReadOnlyDictionary<string, IReadOnlySet<string>>` and hands it to the
  [`PermissionRegistry`](#permissionregistry) constructor (`PermissionRegistryBuilder.cs:48-53`).
- **Why it's built this way**: mutable-while-assembling, immutable-once-built is the safe way to let
  independent modules compose a shared authorization table at startup without shared mutable state at
  runtime.
- **Where it's used**: module composition/DI wiring, where each module calls `Grant(...)` for its own
  capabilities before the host builds the singleton [`PermissionRegistry`](#permissionregistry).

### RoleValue
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25` · Level 3 · class (abstract)

- **What it is**: an abstract base for a role value object: it stores a canonical string, provides
  case-insensitive value equality and hashing, and offers validation against a per-app set of known role
  names (`RoleValue.cs:6-25`).
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) (via `MMCA.Common.Shared.Abstractions`,
  `RoleValue.cs:2`); references [`RoleNames`](#rolenames). Conceptually a value object (see
  [`ValueObject`](group-02-domain-building-blocks.md#valueobject)) but does *not* inherit the record base.
- **Concept introduced: a value object as an abstract class with type-guarded equality.** `[Rubric §4,
  Domain-Driven Design]` (assesses modeling identity-less concepts as value objects) and `[Rubric §1,
  SOLID]`. Roles are stored as plain strings and emitted as JWT claims; this type gives them value
  semantics without a database identity. It deliberately does **not** implement `IEquatable<T>`
  (`RoleValue.cs:18-23`): the doc comment cites Sonar S4035, an unsealed `IEquatable<T>` breaks the
  equality contract for subclasses. Instead equality is the `object.Equals` override, type-guarded so two
  roles are equal only when they are the *same concrete type* with the same case-insensitive value
  (`RoleValue.cs:78-81`); a sealed derived type may safely add a strongly-typed `IEquatable<TSelf>` and
  `==`/`!=` on top. It lives in `MMCA.Common.Shared` so it stays dependency-free and usable from Blazor
  WASM as well as Domain, and each app derives a concrete role type fixing its own role set
  (`RoleValue.cs:11-16`).
- **Walkthrough**: a read-only `Value` (`RoleValue.cs:28`) set by the protected constructor
  (`RoleValue.cs:32`). The static `Validate(role, knownRoles, source)` (`RoleValue.cs:42`) returns
  `Result.Success()` when the role is in the app's known set, else a
  [`Result`](group-01-result-error-handling.md#result) failure carrying an
  [`Error`](group-01-result-error-handling.md#error) `Invariant` coded `User.Role.Invalid`
  (`RoleValue.cs:46-52`): the value-object factory idiom, but exposed as a reusable check for derived
  factories. The protected generic `BuildLookup<TRole>(params roles)` (`RoleValue.cs:63`) freezes the
  supplied singletons into a case-insensitive `FrozenDictionary` keyed by `Value`
  (`RoleValue.cs:68-71`), so a derived type can back its `FromString`/`IsValid` members with interned
  instances. `ToString` returns the value (`RoleValue.cs:75`); `GetHashCode` uses the ordinal-ignore-case
  hash (`RoleValue.cs:84`) to stay consistent with `Equals`.
- **Why it's built this way**: the abstract-class-plus-type-guard approach is the correct way to share
  equality behavior across an open hierarchy of value objects without violating the equality contract
  (the S4035 rationale is documented inline).
- **Where it's used**: each app derives a concrete `UserRole` (Store: Admin/Customer; ADC:
  Organizer/Attendee) with its own factory members; those feed the Identity module and authorization
  checks. Validation is keyed off the [`RoleNames`](#rolenames) constants.

### RegisterRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RegisterRequest.cs:13` · Level 4 · record struct (readonly)

- **What it is**: the registration payload for a new account: email, password, first/last name, and an
  optional postal address (`RegisterRequest.cs:5-13`).
- **Depends on**: [`Address`](group-02-domain-building-blocks.md#address) (Level 3,
  `RegisterRequest.cs:1`).
- **Concept**: the `readonly record struct` DTO shape from
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §9, API & Contract Design]`. The
  optional `Address? Address = null` parameter (`RegisterRequest.cs:18`) shows that positional record
  structs support default values, so callers that omit the address get a null without a second overload.
- **Walkthrough**: five positional parameters (`RegisterRequest.cs:13-18`): four strings plus the
  nullable [`Address`](group-02-domain-building-blocks.md#address). The strings are handed to domain
  factories for conversion rather than pre-validated here, per the "validate in the domain" convention.
- **Where it's used**: the Identity module's register command and the UI register form.

### ILoginProtectionService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` · Level 3 · interface

- **What it is**: the application-layer contract for **brute-force and rate-limit protection** on
  authentication endpoints: lockout checks, failed-attempt increments, successful-login resets, and
  registration rate-limiting per IP address.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, rate-limiting as a first-class application concern.** `[Rubric §11,
  Security]` (assesses brute-force protection on auth flows) and `[Rubric §10, Cross-Cutting
  Concerns]` (rate-limiting extracted to a port so the application layer reasons about it without
  coupling to a specific store; the doc comment, lines 7-8, names both a distributed and an in-memory
  cache as valid backers). Returning [`Result`](group-01-result-error-handling.md#result) from
  `CheckLockoutAsync` (line 18) and `CheckRegistrationRateLimitAsync` (line 42) makes "account is
  locked out" a normal control-flow branch rather than a thrown exception.
- **Walkthrough**: five async methods, split into two scopes.
  - **Email-scoped (failed-login lockout):** `CheckLockoutAsync` (line 18) returns a failure result
    when the email is currently locked; `IncrementFailedAttemptsAsync` (line 26) records a failure and,
    per the doc comment (line 21), applies **exponential-backoff lockout** once the max is exceeded;
    `ResetFailedAttemptsAsync` (line 33) clears the counter after a successful login.
  - **IP-scoped (registration flood):** `CheckRegistrationRateLimitAsync` (line 42) and
    `IncrementRegistrationCountAsync` (line 49) throttle account creation per client IP. Both accept a
    nullable `ipAddress` and **skip** the check when it is null (so a host that cannot resolve the
    caller IP degrades to no limit rather than blocking everyone); `CheckRegistrationRateLimitAsync`
    returns `Result.Success()` in that case (doc comment, lines 37-38).

  All five methods take a `CancellationToken` per convention.
- **Why it's built this way**: keeping the protection policy behind an interface lets the shared
  authentication workflow compose it in while the concrete cache mechanics stay in the implementation;
  the null-IP "skip" keeps the limiter from becoming an availability hazard (ADR-029).
- **Where it's used**: injected into [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser),
  which calls all five methods across its login and registration flows; the concrete, cache-backed
  [`LoginProtectionService`](#loginprotectionservice) (tuned by
  [`LoginProtectionSettings`](#loginprotectionsettings)) implements it.

### AuthenticationValidators
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:16` · Level 5 · class (sealed)

- **What it is**: a tiny **parameter object** that bundles the three FluentValidation validators the
  authentication workflow needs (login, registration, refresh) into one injectable dependency.
- **Depends on**: FluentValidation's `IValidator<T>` (NuGet, line 1) over the request DTOs
  [`LoginRequest`](#loginrequest), [`RegisterRequest`](#registerrequest), and
  [`RefreshTokenRequest`](#refreshtokenrequest) (all in `MMCA.Common.Shared.Auth`, line 2).
- **Concept introduced, the parameter object as a constructor-arity guardrail.** `[Rubric §1, SOLID]`
  (assesses whether a class stays a single, cohesive responsibility rather than sprawling into a
  god-class) and `[Rubric §16, Maintainability & Evolvability]` (assesses whether cross-cutting
  dependencies are grouped so a class can grow without exploding its constructor). The doc comment
  (lines 6-11) states the exact motive: collapsing three closely-related dependencies into one keeps
  the app's `AuthenticationService` **below the application-service constructor-arity ceiling** (a
  god-class analyzer guardrail) without giving up per-request validation. Because the request DTOs
  already live in `MMCA.Common.Shared.Auth`, the bundle is app-agnostic, which is why it could be
  hoisted out of the apps into the framework.
- **Walkthrough**: a primary constructor takes the three `IValidator<T>` instances (lines 16-19), and
  three get-only properties surface them by name: `Login` (line 22), `Register` (line 25), and
  `Refresh` (line 28), each assigned from its matching constructor parameter. There is no logic here;
  the type exists purely to shrink the dependency footprint of its consumer.
- **Why it's built this way**: a `sealed` grouping type with get-only properties is the cheapest way to
  fold three cohesive dependencies into one constructor slot, so the workflow base can validate each
  request shape without pushing its constructor over the arity limit; DI resolves the three underlying
  validators and composes them into this one object.
- **Where it's used**: injected into [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
  (constructor, `AuthenticationServiceBase.cs:40`), whose `LoginAsync`/`RegisterAsync`/`RefreshTokenAsync`
  call `validators.Login`, `validators.Register`, and `validators.Refresh` respectively before doing any
  work.

### IAuthenticationService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:11` · Level 5 · interface

- **What it is**: the application-layer contract for the Identity module's authentication workflows:
  login, registration, token refresh, token revocation, and external (OAuth) login.
- **Depends on**: [`LoginRequest`](#loginrequest), [`RefreshTokenRequest`](#refreshtokenrequest),
  [`RegisterRequest`](#registerrequest), [`AuthenticationResponse`](#authenticationresponse),
  [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error), and the `UserIdentifierType` alias.
- **Concept introduced, default interface methods for optional capabilities.** `[Rubric §1, SOLID]`
  (Interface Segregation and Dependency Inversion): `ExternalLoginAsync` (lines 66-74) ships a
  **default implementation** in the interface itself that returns a "not supported"
  [`Error.Failure`](group-01-result-error-handling.md#error) (`"Auth.ExternalLoginNotSupported"`). An
  implementation that does not offer OAuth (a stub host, or a deployment with social login disabled)
  inherits that failure for free and need not override anything, so the interface stays one piece while
  the capability is opt-in. `[Rubric §11, Security]`: login, registration, and refresh all return
  `Result<AuthenticationResponse>`, so auth outcomes flow as values and no exception leaks credential
  detail to the caller.
- **Walkthrough**: five methods, all async, all taking a `CancellationToken`.
  - `LoginAsync(LoginRequest)` returns `Result<AuthenticationResponse>` (line 19).
  - `RegisterAsync(RegisterRequest, string? ipAddress = null)` (line 30); the optional `ipAddress`
    feeds [`ILoginProtectionService`](#iloginprotectionservice)'s registration rate limit.
  - `RefreshTokenAsync(RefreshTokenRequest)` (line 41) rotates the token pair.
  - `RevokeTokenAsync(UserIdentifierType userId)` returns `Result` (line 51) and revokes a user's
    refresh token, returning a not-found error when there is none.
  - `ExternalLoginAsync(loginProvider, providerKey, email, firstName, lastName)` (line 66), the
    default-implemented OAuth path; finds an account by provider and key or creates one from claims.

  The doc comment (lines 6-9) also records a scope decision: **password change is not on this
  interface**. It is dispatched directly through its own command handler at the controller layer.
- **Why it's built this way**: concentrating the token-issuing workflows behind one port keeps the
  Identity controllers thin and lets the protection/rate-limit policy
  ([`ILoginProtectionService`](#iloginprotectionservice)) compose in; the default OAuth method keeps
  the contract stable across hosts that do and do not enable social login.
- **Where it's used**: implemented by [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
  (which realises every member except the default `ExternalLoginAsync`) and, through it, by each app's
  sealed [`AuthenticationService`](group-24-identity-module.md#authenticationservice); consumed by the
  Identity API controllers.

### AuthenticationServiceBase<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34` · Level 8 · class (abstract)

- **What it is**: the **shared authentication workflow** (login, registration, token refresh and
  rotation, revocation) hoisted once into the framework, generic over the app's `User` aggregate. It
  realises [`IAuthenticationService`](#iauthenticationservice) and leaves the genuinely app-specific
  decisions to a small set of `abstract`/`virtual` hooks a sealed subclass overrides.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype)
  (persistence, G07), [`ITokenService`](#itokenservice), [`IPasswordHasher`](#ipasswordhasher),
  [`ILoginProtectionService`](#iloginprotectionservice), [`AuthenticationValidators`](#authenticationvalidators)
  (this group), the [`IAuthUser`](#iauthuser) credential contract plus
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  as the `TUser` constraint (line 41), [`Email`](group-02-domain-building-blocks.md#email) (normalising the
  login/register email), [`Result`](group-01-result-error-handling.md#result) /
  [`Error`](group-01-result-error-handling.md#error), the request/response DTOs
  ([`LoginRequest`](#loginrequest), [`RegisterRequest`](#registerrequest),
  [`RefreshTokenRequest`](#refreshtokenrequest), [`AuthenticationResponse`](#authenticationresponse)),
  and the BCL `TimeProvider` (injected, never `DateTime.UtcNow`, so the clock is testable).
- **Concept introduced, the Template Method that de-duplicates a whole vertical slice.** `[Rubric §2,
  Design Patterns]` (assesses idiomatic pattern use): this is a textbook **Template Method**, the
  invariant sequence of an operation lives in the base while the variable steps are deferred to
  subclass hooks. `[Rubric §16, Maintainability & Evolvability]` (DRY across services) and `[Rubric §1,
  SOLID]`: the doc comment (lines 11-32) records that the app Identity modules previously duplicated
  this workflow at roughly 70-95% line-identity; folding it here means a fix to the lockout order or
  the refresh-rotation logic is written once. `[Rubric §11, Security]`: the base encodes the security
  posture directly, validate-first, an [`ILoginProtectionService`](#iloginprotectionservice)
  lockout/rate-limit gate (ADR-029), an untracked-then-tracked dual fetch, and refresh-token rotation
  with **reuse detection** (BR-205/206). `[Rubric §7, Microservices Readiness]`: the workflow depends
  only on ports (`IUnitOfWork`, `ITokenService`, ...) so it runs unchanged whether the Identity module
  is in-monolith or its own service.
- **Walkthrough** (members in teaching order):
  - **Constructor + protected accessors** (lines 34-54): a primary constructor takes the six
    collaborators; protected read-only properties re-expose `UnitOfWork` (line 44), `TokenService`
    (line 47), `TimeProvider` (line 50) and a `Repository` (lines 53-54) resolved lazily as
    `unitOfWork.GetRepository<TUser, UserIdentifierType>()`, so subclass hooks and app-level flows
    (external login) reuse them without re-injecting.
  - **Token lifetimes** (lines 57-60): `virtual` `AccessTokenLifetime` (15 minutes) and
    `RefreshTokenLifetime` (7 days), the BR-205 defaults, are overridable per app.
  - **`LoginAsync`** (lines 63-121): validate the request (line 67), check lockout (line 74, ADR-029 /
    BR-212), normalise the raw email into an [`Email`](group-02-domain-building-blocks.md#email) value
    object (line 82) so the EF predicate compares same-typed converted values. **Step 1** is an
    *untracked* fetch via the `FindUntrackedByEmailAsync` hook (line 86) to verify credentials without
    change-tracker overhead; a null result increments failed attempts and returns a generic 401 (lines
    87-92). An app gate runs before password verification (line 96, no failed-attempt increment so the
    pre-hoist behaviour is preserved), then `passwordHasher.VerifyPassword` (line 102). **Step 2** is a
    *tracked* re-fetch by id (line 110) so the new refresh token can be persisted, followed by
    `ResetFailedAttemptsAsync` (line 118) and `IssueTokensAsync` (line 120).
  - **`RegisterAsync`** (lines 124-177): validate (line 129), IP rate-limit (line 136, ADR-029 /
    BR-213), reject a duplicate email through the `EmailExistsAsync` hook (line 143), hash the password
    (line 150), build the user through the `CreateUser` hook (line 151), mint and store a refresh token
    (lines 158-159), `AddAsync` + `SaveChangesAsync` (lines 161-162), then run the `OnUserRegisteredAsync`
    post-commit hook (line 166) to pick up the instance the first access token is minted from,
    increment the IP registration count (line 169), and return the token pair (lines 173-176).
  - **`RefreshTokenAsync`** (lines 180-231): validate (line 184), pull claims from the *expired* JWT via
    `tokenService.GetPrincipalFromExpiredToken` (line 192, signature still checked, only lifetime
    skipped), read the `user_id` claim (lines 199-204), load the tracked user (line 206), run the
    refresh app gate (line 213), then the security-critical check (line 221): if the stored
    `RefreshToken` does not match or has expired, this is treated as **token reuse (potential theft)**,
    so `user.RevokeRefreshToken()` is called and saved (lines 223-224, BR-206) before returning a 401.
    A clean match issues a rotated pair through `IssueTokensAsync` (line 230).
  - **`RevokeTokenAsync`** (lines 234-248): load by id, `RevokeRefreshToken()`, save; a missing user
    yields `Error.NotFound` targeted at `typeof(TUser).Name` (line 241).
  - **`IssueTokensAsync`** (lines 254-268): the shared rotation used by login and refresh (and reusable
    by app-level external login), mints an access token via the `CreateAccessToken` hook, generates a
    new refresh token, stamps its expiry off `TimeProvider`, saves, and returns the response.
  - **The hooks**: four `abstract` (a subclass must supply them), `FindUntrackedByEmailAsync` (line 275)
    and `EmailExistsAsync` (line 281) are deliberately written against the app's concrete `User` so EF
    translates the predicate byte-for-byte as before; `CreateUser` (line 284) runs the app's domain
    factory; `CreateAccessToken` (line 287) mints the app's claim set (for example `speaker_id` vs
    `customer_id`). Four `virtual` hooks default to a no-op: `ValidateLoginCandidateAsync` (line 290)
    and `ValidateRefreshCandidateAsync` (line 294) add extra gates such as a deactivated-account check;
    `OnUserRegisteredAsync` (line 301) runs the post-commit side-effect (publish an integration event
    or re-fetch a linked id); and `CreateRefreshUserMissingError` (line 309) defaults the vanished-user
    case to 401 (a token for a missing user is indistinguishable from an invalid one) while letting an
    app return 404 where its public contract already promises it.
- **Why it's built this way**: the untracked-then-tracked dual fetch keeps the common
  credential-verification path off the change tracker (cheaper, and soft-deleted accounts fall out via
  EF query filters returning the generic 401) while still giving a tracked instance to persist the new
  token. Refresh-token reuse detection (revoke-on-mismatch) is the BR-206 defence against a stolen
  token being replayed. Password material flows through [`IAuthUser`](#iauthuser)'s `PasswordHash`/
  `PasswordSalt` (ADR-032), and the whole workflow depends only on abstractions, so it is identical
  whether the module runs in-process or as an extracted service.
- **Where it's used**: subclassed by each app's sealed
  [`AuthenticationService`](group-24-identity-module.md#authenticationservice) (for example
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:22`,
  which binds `TUser = User`, adds the Attendee default role, the `speaker_id` claim, and the
  post-commit `UserRegistered` integration event; MMCA.Store supplies its own subclass with a
  `customer_id` claim). Consumed by the Identity API controllers via the
  [`IAuthenticationService`](#iauthenticationservice) port.
- **Caveats / not-in-source**: the `user_id` claim is parsed with `int.TryParse` (line 200), so the
  refresh flow assumes `UserIdentifierType` is `int` (the framework alias today); an app that redefined
  the alias would need to override the refresh handling. `ExternalLoginAsync` is intentionally **not**
  overridden here: the base inherits the interface's default "not supported" failure, and OAuth account
  linking stays in the app subclass because it is coupled to the app's `User` factory surface (doc
  comment, lines 30-31).


---
[⬅ Persistence & EF Core](group-07-persistence-ef-core.md)  •  [Index](00-index.md)  •  [Caching ➡](group-09-caching.md)
