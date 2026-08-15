# 8. Authentication & Authorization

**What this group covers.** This is the security spine of the framework: how a caller proves who they
are (authentication), how the system decides what they may do (authorization), and how both survive
the jump from a single-process monolith to a fleet of extracted services. Almost every type here
serves one of eight moving parts: **minting and validating JWTs**
([`TokenService`](#tokenservice) / [`ITokenService`](#itokenservice),
[`RsaJwksProvider`](#rsajwksprovider) / [`IJwksProvider`](#ijwksprovider)); **the shared login /
register / refresh workflow** ([`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser),
[`IAuthenticationService`](#iauthenticationservice),
[`AuthenticationValidators`](#authenticationvalidators)); **the contracts an app's `User` aggregate
exposes to those shared workflows** ([`IAuthUser`](#iauthuser),
[`IPasswordChangeableUser`](#ipasswordchangeableuser), [`IUserPreferences`](#iuserpreferences),
[`IErasableUser`](#ierasableuser)); **password material**
([`PasswordHasher`](#passwordhasher) / [`IPasswordHasher`](#ipasswordhasher)); **brute-force and
rate-limit protection** ([`LoginProtectionService`](#loginprotectionservice) /
[`ILoginProtectionService`](#iloginprotectionservice),
[`LoginProtectionSettings`](#loginprotectionsettings)); **reading the current caller's identity from
claims** ([`CurrentUserService`](#currentuserservice) / [`ICurrentUserService`](#icurrentuserservice),
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider), [`AuthClaimTypes`](#authclaimtypes)); **the
authorization model** (roles, permissions, and resource ownership under
[`AuthorizationExtensions`](#authorizationextensions),
[`PermissionAuthorizationHandler`](#permissionauthorizationhandler), and
[`OwnerOrAdminFilter`](#owneroradminfilter)); and the HttpOnly **session-cookie** machinery
([`SessionCookieEndpoints`](#sessioncookieendpoints),
[`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler),
[`CookieSessionRefresher`](#cookiesessionrefresher)) that keeps server-side-rendered Blazor pages
authenticated across a cold navigation.

The governing decisions are [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)
(dual-fetch login and cross-service token validation via JWKS),
[ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) (one rotating
refresh token with reuse detection),
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
(brute-force protection),
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) (password hashing),
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)
(permission-based authorization),
[ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)
(resource-ownership authorization),
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html) (the browser
session-cookie scheme), and
[ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html) (how each render
head holds and reacquires a token). The rubric lenses are dominated by [Rubric §11, Security], with
supporting [Rubric §7, Microservices Readiness] and [Rubric §10, Cross-Cutting]. Auth surfaces all of
its expected failures (bad password, lockout, expired session) as
[`Result`](group-01-result-error-handling.md#result) failures, never exceptions, so reading the
[Result pattern](group-01-result-error-handling.md#result) first pays off here.

## Tokens: one signing switch, two validation worlds

The framework mints two credentials on every successful login: a short-lived **access token** (a JWT,
15 minutes by default,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:42`) and an opaque,
random **refresh token** (64 bytes of `RandomNumberGenerator` output, Base64-encoded, valid 7 days by
default, `TokenService.cs:106-107`, `JwtSettings.cs:45`), both produced by
[`TokenService`](#tokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:23`). The access token
carries a fixed claim spine: `sub`, `jti`, `iat`, a custom `user_id`, plus name, email, and role
(`TokenService.cs:76-85`), and the app adds its own claims (for example `speaker_id` or `customer_id`)
through the `additionalClaims` parameter (`TokenService.cs:87-90`). The port
[`ITokenService`](#itokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:8`)
publishes both lifetimes as default interface members pinned to the same 15-minute / 7-day baseline
(`ITokenService.cs:33`, `ITokenService.cs:40`), so a hand-written test double reports the same expiry
the production settings would, while the concrete service derives them from the bound settings
(`TokenService.cs:111`, `TokenService.cs:114`).

The load-bearing design choice is a single configuration switch,
[`IJwtSettings`](group-14-module-system-composition.md#ijwtsettings)`.SigningAlgorithm`
(`TokenService.cs:53`). In **monolith mode** it defaults to
[`JwtSigningAlgorithm`](group-14-module-system-composition.md#jwtsigningalgorithm)`.HS256`
(`JwtSettings.cs:22`): one symmetric Base64 secret both signs and validates, because issuer and
validator are the same process (`TokenService.cs:166-178`). In **microservice mode** it is `RS256`:
the Identity service signs with an RSA private key and every other service validates against the
matching public key, which it fetches over JWKS. An issuer with no explicit public key configured
derives one from its own private-key parameters so it can still self-validate during refresh
(`TokenService.cs:199-213`). Key material is materialized once in the constructor and the owned `RSA`
handles are disposed with the service (`TokenService.cs:33-34`, `TokenService.cs:160-164`), so token
operations never re-parse a PEM. The settings class enforces the pairing rather than trusting the
host: it implements `IValidatableObject` and rejects an HS256 secret shorter than 32 characters or an
RS256 configuration with no private key (`JwtSettings.cs:51-66`). That asymmetric split is exactly
what lets a module be extracted without every service holding a signing key: a compromised
non-Identity service can verify tokens but cannot forge them.

The public half is served by [`RsaJwksProvider`](#rsajwksprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15`), which lazily builds
a `JsonWebKeySet` from a PEM key (inline or read from a path) configured through
[`JwksSettings`](group-14-module-system-composition.md#jwkssettings) (`RsaJwksProvider.cs:15`,
`RsaJwksProvider.cs:58-74`), behind the [`IJwksProvider`](#ijwksprovider) port
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11`). Publishing is off by
default, and when disabled or unconfigured the provider returns an *empty* key set
(`RsaJwksProvider.cs:30-33`, `RsaJwksProvider.cs:36-39`) so the endpoint stays queryable but a
non-issuer host advertises nothing. The cache is a `Lazy<JsonWebKeySet>` in `PublicationOnly` mode
rather than the default `ExecutionAndPublication` (`RsaJwksProvider.cs:22-23`): the default caches a
factory *exception* forever, so a single transient IO failure reading the PEM would brick the endpoint
(and with it cross-service auth) until the process restarted. The endpoint itself,
`/.well-known/jwks.json`, is mapped in the API layer by
[`JwksEndpointExtensions`](group-12-api-hosting-mapping.md#jwksendpointextensions)
(path constant at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:20`, mapped
anonymously at `JwksEndpointExtensions.cs:31`), paired with the OIDC discovery document from
[`OidcDiscoveryEndpointExtensions`](group-12-api-hosting-mapping.md#oidcdiscoveryendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:27`);
[`OpenIdConnectMetadataWarmupTask`](group-16-aspire-orchestration.md#openidconnectmetadatawarmuptask)
pre-fetches that document as a startup warm-up task
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:21`,
`OpenIdConnectMetadataWarmupTask.cs:35-46`) so the first authenticated request on a cold replica does
not pay the discovery round trip. Validation pins the expected algorithm so an attacker cannot force
an algorithm swap: `GetPrincipalFromExpiredToken` sets `ValidAlgorithms` to the single configured
value (`TokenService.cs:136`) and then re-checks the token header after `ValidateToken` returns
(`TokenService.cs:145-149`). Only the lifetime check is skipped there (`TokenService.cs:131`), because
the method exists to read claims out of an already-expired token during refresh.

## The shared authentication workflow

Login, registration, refresh, and revocation are not re-implemented per app. They live once in
[`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34`), an abstract
base each app's Identity module seals over its concrete `User` aggregate. The base owns the sequence;
the sealed subclass supplies the genuinely app-specific pieces through abstract and virtual hooks:
`FindUntrackedByEmailAsync` and `EmailExistsAsync` (written against the concrete `User` so EF
translation is unchanged, `AuthenticationServiceBase.cs:313`, `AuthenticationServiceBase.cs:319`),
`CreateUser` (`AuthenticationServiceBase.cs:322`), `CreateAccessToken`
(`AuthenticationServiceBase.cs:325`), the two optional candidate gates
(`AuthenticationServiceBase.cs:328-333`), the post-commit `OnUserRegisteredAsync`
(`AuthenticationServiceBase.cs:339`), and the overridable "refresh user vanished" error
(`AuthenticationServiceBase.cs:347`, 401 by default because a token for a deleted user is
indistinguishable from an invalid one). Both token lifetimes are read from
[`ITokenService`](#itokenservice) with a defensive fallback to the 15-minute / 7-day baseline for a
misconfigured host or a test double (`AuthenticationServiceBase.cs:61-70`).

`LoginAsync` (`AuthenticationServiceBase.cs:73`) shows the shape. It validates the request first, then
runs the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
lockout check (`AuthenticationServiceBase.cs:84`), then does the **dual-fetch**: an untracked,
no-change-tracking query to verify the password cheaply (`AuthenticationServiceBase.cs:96`,
`AuthenticationServiceBase.cs:112`), and only on success a second *tracked* re-fetch so the rotated
refresh token can be persisted through `SaveChangesAsync` (`AuthenticationServiceBase.cs:120`,
`AuthenticationServiceBase.cs:292-306`). The email is normalized through the
[`Email`](group-02-domain-building-blocks.md#email) value object before the query so the EF predicate
compares same-typed converted values (`AuthenticationServiceBase.cs:92`). Soft-deleted accounts fall
out through EF global query filters and return the same generic 401 as a wrong password
(`AuthenticationServiceBase.cs:97-102`), so the API never reveals whether an email exists, and a
successful login clears the attempt counters (`AuthenticationServiceBase.cs:128`).

`RegisterAsync` (`AuthenticationServiceBase.cs:134`) rate-limits by source IP, rejects a duplicate
email as a conflict, hashes the password, saves, and only then runs the app's post-commit hook and
counts the registration (`AuthenticationServiceBase.cs:146-215`). The up-front email check is a
check-then-act, so two concurrent registrations for the same address both pass it and the loser only
fails on the insert. The save is therefore wrapped in a deliberately broad catch that re-checks the
address and, if it now exists, returns the *same* conflict the serialized path would have produced,
rethrowing anything else (`AuthenticationServiceBase.cs:172-200`); the shared failure factory keeps
the two paths indistinguishable to the caller (`AuthenticationServiceBase.cs:355`). The catch is broad
because the Application layer has no EF Core dependency by layer rule and cannot name
`DbUpdateException`; the re-check is what narrows it, and it deliberately runs on
`CancellationToken.None` so a cancelled save can still be classified
(`AuthenticationServiceBase.cs:194`). `RefreshTokenAsync`
(`AuthenticationServiceBase.cs:218`) extracts claims from the *expired* access token (signature still
verified, only lifetime skipped, `AuthenticationServiceBase.cs:230`), then compares the presented
refresh token against the stored one; a mismatch or an expired stored token is treated as reuse and
*revokes* the stored token to force re-authentication (`AuthenticationServiceBase.cs:259-266`,
[ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) / BR-206). Every
failure path returns a [`Result`](group-01-result-error-handling.md#result) rather than throwing,
matching the framework-wide Result pattern (see
[primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

The request and response DTOs for these flows ([`LoginRequest`](#loginrequest),
[`RegisterRequest`](#registerrequest), [`RefreshTokenRequest`](#refreshtokenrequest),
[`AuthenticationResponse`](#authenticationresponse), [`ChangePasswordRequest`](#changepasswordrequest),
[`OAuthCodeExchangeRequest`](#oauthcodeexchangerequest), and the device-aware
[`AuthenticationRequest`](#authenticationrequest) used by MAUI clients) are compact `readonly record
struct`s in `MMCA.Common.Shared`. Two of them mark boundaries worth noting: password change is
dispatched straight through its command handler at the controller layer rather than brokered by
[`IAuthenticationService`](#iauthenticationservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:8-9`), and
`ExternalLoginAsync` has a default interface implementation that *rejects* the call
(`IAuthenticationService.cs:66-74`) because OAuth account linking stays coupled to the app's own
`User` factory. `OAuthCodeExchangeRequest` carries only an opaque single-use code
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:11`) precisely so the
token pair never appears in the address bar, browser history, a `Referer` header, or an access log.
The FluentValidation rules that guard the requests are bundled into one parameter object,
[`AuthenticationValidators`](#authenticationvalidators)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:16`), which keeps
the app's `AuthenticationService` constructor below the arity ceiling; the framework ships
[`LoginRequestValidator`](#loginrequestvalidator) and
[`RefreshTokenRequestValidator`](#refreshtokenrequestvalidator), both deliberately minimal
presence-and-shape checks so a rejection never reveals which field was wrong
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10`),
while the `IValidator<RegisterRequest>` the bundle requires is supplied by each app
(`AuthenticationValidators.cs:16-19`).

## What the app's User aggregate must expose

The shared workflows never see an app's `User` class. They see four small Domain-layer contracts, each
sized to one workflow, which is the [Rubric §1, SOLID] interface-segregation story in miniature.
[`IAuthUser`](#iauthuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:10`) is the login/refresh surface:
password hash and salt, the current refresh token and its expiry, and the two mutators
`UpdateRefreshToken` / `RevokeRefreshToken` (`IAuthUser.cs:14-30`). Profile fields, roles, and linked
aggregates stay app-specific and are reached only through the per-app hooks.
[`IPasswordChangeableUser`](#ipasswordchangeableuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11`) extends it with
`ChangePassword`, because the rotation workflow must verify the current credential before writing the
new one. [`IUserPreferences`](#iuserpreferences)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:10`) carries the stored culture
and theme plus a single `UpdatePreferences` mutator that always writes both fields, so persisting one
preference never clears the other (`IUserPreferences.cs:18-25`), matching the null-means-unchanged
semantics of [`ChangePreferencesRequest`](#changepreferencesrequest) and
[`UserPreferencesResponse`](#userpreferencesresponse)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:10`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/UserPreferencesResponse.cs:9`).

[`IErasableUser`](#ierasableuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30`) is the subtlest of the four. It
extends [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and *redeclares* `Delete()`
(`IErasableUser.cs:37`) rather than inheriting it from `AuditableBaseEntity<TId>`, because an app
`User` commonly **hides** the base method (`public new Result Delete()`) to also revoke the refresh
token. A hidden method is not an override, so a shared workflow calling through the class constraint
would silently run the base implementation and skip that behavior; routing the call through this
interface makes the interface map resolve to the most derived `Delete()` (`IErasableUser.cs:11-29`).
The base entity deliberately does not implement the interface, so a consumer that forgets to add it
fails the generic constraint at compile time instead of losing behavior at run time. These four
contracts are consumed by the shared handler bases in group 14:
[`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24`),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
and
[`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38`),
each of which constrains `TUser` to the matching contract.

## Passwords and brute-force protection

Password material is handled by [`PasswordHasher`](#passwordhasher)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12`), which hashes with
PBKDF2-HMAC-SHA512 at 600,000 iterations (OWASP 2023 guidance, `PasswordHasher.cs:24`) over a 32-byte
random salt (`PasswordHasher.cs:15`, `PasswordHasher.cs:34`) and verifies in constant time via
`CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:58`) to close the timing side channel. It
stays backward-compatible with an older HMAC-SHA512 scheme by branching on salt length (128 bytes means
legacy, anything else means PBKDF2, `PasswordHasher.cs:27`, `PasswordHasher.cs:52-54`), so existing
hashes still verify without a forced reset
([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)). That is a compact
[Rubric §11, Security] story: modern KDF, constant-time compare, and a migration path in one small
type, all behind the [`IPasswordHasher`](#ipasswordhasher) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:6`) so
the algorithm can be strengthened without touching an Application handler.

[`LoginProtectionService`](#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19`) adds the
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) gates on
top, backed by [`ICacheService`](group-09-caching.md#icacheservice) rather than a database so the
counters are cheap and self-expiring. Counter keys are built from an `Email`-normalized identity
(`LoginProtectionService.cs:34-47`), so `User@x.com`, `user@x.com`, and a padded variant collapse onto
one lockout instead of handing an attacker three independent budgets. After
[`LoginProtectionSettings`](#loginprotectionsettings)`.MaxFailedAttempts` consecutive failures
(default 5,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:18`) it applies an
exponential-backoff lockout capped at `MaxLockoutSeconds` (default 300,
`LoginProtectionSettings.cs:24`), with a deliberately clamped shift exponent so a persistent attacker
cannot wrap the TTL back to something small (`LoginProtectionService.cs:88`), and it rate-limits
registrations per source IP (default 10 per 60-minute window, `LoginProtectionSettings.cs:37-43`,
`LoginProtectionService.cs:101-134`). Every setting carries a `[Range]` attribute, which is what makes
the clamp argument airtight: `MaxLockoutSeconds` cannot exceed 3600 (`LoginProtectionSettings.cs:23`),
and `1 << 30` already dwarfs that. The [`ILoginProtectionService`](#iloginprotectionservice) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`) is what the
workflow depends on, and it calls the gates at exactly the right points (increment on failed login,
reset on success), so the protection is centralized rather than sprinkled through each app's
controller. One documented trade-off is stated in source: the attempt increment is a
read-modify-write rather than an atomic counter, because the native Redis `INCR` path wrote a key shape
`IDistributedCache` could not read back (`LoginProtectionService.cs:66-74`). Sequential guessing, which
is what a credential-stuffing run looks like, still trips the lockout.

## Reading identity from claims

Once a request is authenticated, downstream code needs the caller's identity without re-parsing the
JWT. [`CurrentUserService`](#currentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:13`) is the scoped
adapter over `IHttpContextAccessor`: it exposes the `ClaimsPrincipal`, the parsed `user_id`, and the
first role claim, caching the parsed values behind a per-request `Lazy<T>` (`CurrentUserService.cs:18`,
`CurrentUserService.cs:26`) and reading the same custom `user_id` claim that
[`TokenService`](#tokenservice) emits. Every parse is pinned to `CultureInfo.InvariantCulture`
(`CurrentUserService.cs:23`, `CurrentUserService.cs:45`) to match the writer: the token was formatted
invariantly, so reading it under the request culture would misread separators. Its generic
`GetClaimValue<T>` (`CurrentUserService.cs:39`) is what the ownership filter uses to read app-specific
owner claims. The interface itself, [`ICurrentUserService`](#icurrentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:9`),
carries the multi-role logic as *default interface members*: `Roles` reads every role claim across the
three claim-type spellings the JWT middleware may produce and falls back to the single `Role` property
when a hand-written double populates only that (`ICurrentUserService.cs:45-64`), and `IsInRole` does a
case-insensitive membership check over that set (`ICurrentUserService.cs:88-89`). A sibling adapter,
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9`), plugs the
same `user_id` claim into SignalR's `IUserIdProvider` so `Clients.User(userId)` routes hub messages to
the right connections. [`AuthClaimTypes`](#authclaimtypes)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:7`) names the one framework-custom
claim beyond the BCL set, `"permission"` (`AuthClaimTypes.cs:15`), used by the authorization model
below.

## Authorization: roles, permissions, ownership

The framework supports three overlapping authorization styles, wired together by the single
`AddAuthorizationPolicies()` extension in [`AuthorizationExtensions`](#authorizationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12`,
`AuthorizationExtensions.cs:22`). The simplest is **named role policies**:
[`AuthorizationPolicies`](#authorizationpolicies) defines the four constant policy names
(`RequireOrganizer`, `RequireAttendee`, `RequireAdmin`, `RequireAuthenticated`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationPolicies.cs:14-23`) that
controllers reference through `[Authorize(Policy = ...)]`, registered against the role names in
[`RoleNames`](#rolenames) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:12`) at
`AuthorizationExtensions.cs:24-32`. `RoleNames` carries five constants across both apps (`Organizer`,
`Attendee`, `ContentEditor`, `Admin`, `Customer`, `RoleNames.cs:15-31`); `ContentEditor` has no
dedicated named policy and is expected to be reached through permissions instead. Roles themselves get
a value-object base, [`RoleValue`](#rolevalue)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25`), so each app can fix its own role
set with case-insensitive, type-guarded equality (`RoleValue.cs:90-96`), a frozen interned lookup
(`RoleValue.cs:75-84`), and `Result`-returning validation (`RoleValue.cs:42`) while staying
dependency-free enough to use from Blazor WASM.

The richer style is **permission-based** authorization
([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)), so endpoints
depend on capabilities rather than role names. [`HasPermissionAttribute`](#haspermissionattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13`) marks a
controller or action with a permission such as `"sessions:manage"`; under the hood it is an
`AuthorizeAttribute` whose policy name is `perm:sessions:manage`
([`PermissionPolicy`](#permissionpolicy)`.NameFor`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`,
`PermissionPolicy.cs:17`). Rather than pre-registering a named policy per permission,
[`PermissionPolicyProvider`](#permissionpolicyprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13`)
materializes those policies on demand for any `perm:` name and falls through to the default provider
for everything else (`PermissionPolicyProvider.cs:31-47`). The requirement it attaches,
[`PermissionRequirement`](#permissionrequirement)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10`), is
evaluated by [`PermissionAuthorizationHandler`](#permissionauthorizationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`),
which grants access when the principal holds the permission directly (a `permission` claim) *or*
derives it from one of its roles via [`IPermissionRegistry`](#ipermissionregistry)
(`PermissionAuthorizationHandler.cs:29-30`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/IPermissionRegistry.cs:13`), reading roles across the
same three claim-type spellings (`PermissionAuthorizationHandler.cs:42-48`). The registry itself
([`PermissionRegistry`](#permissionregistry),
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistry.cs:10`) is an immutable, frozen
role-to-permission map with case-insensitive role keys and ordinal permission values
(`PermissionRegistry.cs:25-28`) built by
[`PermissionRegistryBuilder`](#permissionregistrybuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:8`); each module
contributes only its own grants through `AddPermissions(...)`
(`AuthorizationExtensions.cs:54-62`), duplicate grants union rather than collide
(`PermissionRegistryBuilder.cs:32-39`), and the shared registry is built lazily on first resolve, after
every module has registered (`AuthorizationExtensions.cs:68-81`). That module-local contribution is the
[Rubric §7, Microservices Readiness] touch: an extracted service carries only its own permission
grants.

The third style is **resource ownership**. [`OwnerOrAdminFilter`](#owneroradminfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:30`) is an action
filter for endpoints that mix admin and owner access (carts, orders, bookmarks). It lets a bypass role
through (`OwnerOrAdminFilter.cs:42`), then compares the caller's owner claim against the resource id
taken from either the route or a bound argument (`OwnerOrAdminFilter.cs:48`,
`OwnerOrAdminFilter.cs:88-106`), returning 403 otherwise. The important property is that it **denies by
default**: when the owner claim is missing (`OwnerOrAdminFilter.cs:50-54`) or the owner parameter
cannot be resolved at all, the request is rejected rather than waved through
(`OwnerOrAdminFilter.cs:56-70`), because "nothing to compare" must not read as "nothing to enforce". An
action that legitimately has no owner parameter opts out explicitly with
[`AllowMissingOwnerAttribute`](#allowmissingownerattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21`),
honored from either the action or its declaring controller via endpoint metadata
(`OwnerOrAdminFilter.cs:83-84`). The filter's vocabulary (claim type, bypass role, route parameter) is
configurable through [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11`) whose
defaults preserve the original `customer_id` / `Admin` / `id` behavior
(`OwnerOrAdminFilterOptions.cs:14-24`,
[ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)), with
[`OwnershipHelper`](#ownershiphelper)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10`) supplying both
the bypass-role check (`OwnershipHelper.cs:17`) and the query-scoping specification factory that
controllers use to narrow *collection* endpoints to the caller's own rows
(`OwnershipHelper.cs:34-67`).

## Session cookies: keeping SSR authenticated

The final cluster solves a Blazor-specific problem: an interactive Blazor app keeps its access token in
browser memory, but a *cold* server-side render (a new tab, an F5, an external deep link) has no memory
to read, so an `[Authorize]` page would bounce to `/login` before the interactive phase starts. The fix
is a pair of HttpOnly cookies (`mmca_auth_access`, `mmca_auth_refresh`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:17-18`)
seeded and cleared from JS through [`SessionCookieEndpoints`](#sessioncookieendpoints)
(`SessionCookieEndpoints.cs:15`, `SessionCookieEndpoints.cs:29-39`, request body
[`SessionCookieRequest`](#sessioncookierequest) at `SessionCookieEndpoints.cs:72`), written with one
shared set of attributes by [`SessionCookieJar`](#sessioncookiejar)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieJar.cs:11`: `HttpOnly`,
`Secure` outside Development, `SameSite=Lax`, `Path=/`, and a 7-day max age aligned to the
refresh-token lifetime, `SessionCookieJar.cs:14`, `SessionCookieJar.cs:31-38`), and read during
prerender by [`CookieTokenReader`](#cookietokenreader)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10`).
[`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24`)
is a custom authentication scheme that reads the cookie JWT, checks only its expiry against the
handler's injectable `TimeProvider` (`SessionCookieAuthenticationHandler.cs:55`) because the API still
performs full validation on every API call (`SessionCookieAuthenticationHandler.cs:18-23`), and
populates `HttpContext.User` so SSR authorization passes
(`SessionCookieAuthenticationHandler.cs:60-63`); a challenge redirects to `/login` with a `returnUrl`
(`SessionCookieAuthenticationHandler.cs:72-77`). It is registered through
[`SessionCookieAuthenticationExtensions`](#sessioncookieauthenticationextensions)
(`SessionCookieAuthenticationHandler.cs:90`).

When the access cookie has expired but the refresh cookie is still valid,
[`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:13`,
registered by [`CookieSessionRefreshMiddlewareExtensions`](#cookiesessionrefreshmiddlewareextensions)
at `CookieSessionRefreshMiddleware.cs:35`) runs *before* `UseAuthentication` on qualifying navigations
(GET plus an `Accept` header containing `text/html`, `CookieSessionRefreshMiddleware.cs:28-31`) and
delegates to [`CookieSessionRefresher`](#cookiesessionrefresher)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:51`) through
the [`ICookieSessionRefresher`](#icookiesessionrefresher) port (`CookieSessionRefresher.cs:29`). The
refresher first tries to read a still-valid expiry out of the access cookie with a 30-second skew
allowance (`CookieSessionRefresher.cs:59`, `CookieSessionRefresher.cs:154-183`); failing that it
exchanges the refresh cookie at the API's `auth/refresh` endpoint server-to-server
(`CookieSessionRefresher.cs:127-130`), so the refresh token never reaches browser JS. It then writes
the rotated pair back as cookies and stashes the fresh access token on `HttpContext.Items`
(`CookieSessionRefresher.cs:87-91`) so the *current* request's authentication reads the new token:
[`CookieTokenReader`](#cookietokenreader) checks that item before falling back to the request cookie
(`CookieTokenReader.cs:17`, `CookieTokenReader.cs:27-33`). Concurrent refreshes are collapsed into a
single flight by a [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) keyed on the refresh token plus a
10-second rotation-grace `IMemoryCache` entry keyed by the **old** refresh token
(`CookieSessionRefresher.cs:60`, `CookieSessionRefresher.cs:62`, `CookieSessionRefresher.cs:95-111`,
`CookieSessionRefresher.cs:144`), so a queued herd of requests cannot double-rotate. Striping rather
than one process-wide lock is deliberate and stated in source: the lock is held across an outbound HTTP
call, so a single semaphore serialized every unrelated user's cold navigation behind whichever refresh
was in flight (`CookieSessionRefresher.cs:44-49`); two unrelated tokens sharing a stripe is harmless
because the grace cache is re-checked per token after acquiring
(`CookieSessionRefresher.cs:104-108`). A transport failure is not cached and renders the request
anonymously rather than throwing a 500 out of SSR (`CookieSessionRefresher.cs:117-122`,
`CookieSessionRefresher.cs:147-151`). The same refresher backs the same-origin
`POST /auth/session/token` endpoint the browser polls to hydrate its in-memory token
(`SessionCookieEndpoints.cs:45-60`), guarded by `SameSite=Lax` plus a `Sec-Fetch-Site` cross-site
rejection (`SessionCookieEndpoints.cs:48`, `SessionCookieEndpoints.cs:68-70`) and returning
[`SessionTokenResponse`](#sessiontokenresponse) (`CookieSessionRefresher.cs:20`), the browser-safe
projection of the internal [`SessionTokenResult`](#sessiontokenresult)
(`CookieSessionRefresher.cs:14`) that deliberately omits the refresh token. This whole cluster is
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)'s server half; the
client half across Blazor Server, WASM, and MAUI is
[ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html).

## Privacy: the data-subject export package

Three members of this group belong to the privacy surface that sits beside erasure.
[`UserDataExportDTO`](#userdataexportdto)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15`) is the portable
GDPR/CCPA export envelope: a document `FormatVersion` consumers read before parsing
(`UserDataExportDTO.cs:22`), the generation instant, the subject id, an app-owned `Subject` snapshot
typed as `object` so each app decides which of its own fields are portable
(`UserDataExportDTO.cs:39-40`), and an ordered list of
[`UserDataExportSectionDTO`](#userdataexportsectiondto) envelopes (`UserDataExportDTO.cs:48`,
`UserDataExportDTO.cs:61`). Each section reports `Available` explicitly (`UserDataExportDTO.cs:72`) so
a reader can tell "this subject has no data here" apart from "this contributor could not be reached",
and an unavailable section carries only a caller-safe reason string, never an exception message or a
connection string (`UserDataExportDTO.cs:88`). One failing contributor therefore degrades one section
instead of denying the subject their whole export, which is the [Rubric §30, Compliance/Privacy/Data
Governance] point of the shape. [`PrivacyFeatures`](#privacyfeatures)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6`) holds the single flag name
`Privacy.DataExport` (`PrivacyFeatures.cs:9`) that keeps the whole surface off until a host turns it
on: it is applied as a `[FeatureGate]` on
[`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery)
alongside an `[Authorize]` requiring an authenticated caller
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:58-60`),
with the owner-or-privileged-role check enforced independently in the handler. The composing workflow
([`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery)
and the [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection)
contributors) lives in group 14
([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)).

## Shared primitives and adjacent members

Four group members are general-purpose primitives that landed in this chapter because of how the
dependency grouping fell, though one of them is now load-bearing for auth.
[`KeyedSemaphoreStripe`](#keyedsemaphorestripe)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`) and its
[`Releaser`](#releaser) handle (`KeyedSemaphoreStripe.cs:78`) serialize work per logical key across a
fixed set of 256 semaphores (`KeyedSemaphoreStripe.cs:25`, `KeyedSemaphoreStripe.cs:60-75`). That is
the bounded alternative to a semaphore-per-key dictionary, which forces a choice between two defects:
removing the entry on release opens a window where one caller waits on a semaphore no longer in the
table while another creates a fresh one, and never removing it lets caller-supplied keys grow the table
without bound (`KeyedSemaphoreStripe.cs:7-16`). Its consumers today are
[`CookieSessionRefresher`](#cookiesessionrefresher) (above, `CookieSessionRefresher.cs:62`),
the [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:92`),
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:197`),
[`MemoryCacheService`](group-09-caching.md#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:38`), and the
default `GetOrCreateAsync` lock table on
[`ICacheService`](group-09-caching.md#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:142-145`).
[`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) is the
deliberate exception: it keys on the exact key in a `ConcurrentDictionary` instead, because its
contract has a *bounded* wait, and stripe false-sharing would turn that into a spurious
"held elsewhere" answer for a key nobody holds
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:19-24`).
[`IcsEvent`](#icsevent) and [`IcsCalendarBuilder`](#icscalendarbuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12`) build RFC 5545
calendar (`.ics`) exports from UTC-normalized event times, with 75-octet line folding and CRLF endings
(`IcsCalendarBuilder.cs:14` for the `MaxLineOctets` budget; the folding and the `\r\n` writes both live
in `AppendLine`, `IcsCalendarBuilder.cs:83-104`). [`IdempotencyHeaders`](#idempotencyheaders)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13`) is a two-constant class
holding `Idempotency-Key` and `X-Idempotent-Replay`, in Shared because the API filter reads them and
the UI service bases write them and those two packages do not reference each other
(`IdempotencyHeaders.cs:19`, `IdempotencyHeaders.cs:25`).

Two genuine auth members sit at the edge of the group.
[`ISoftDeletedUserValidator`](#isoftdeleteduservalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7`)
is the small contract the API's
[`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) uses to reject
an otherwise-valid token whose backing account has since been soft-deleted (BR-133), implemented by
each Identity module so Common never takes a cross-module domain reference. Its fast path is
[`SoftDeletedUserCache`](#softdeletedusercache)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17`), which owns both the
key shape and the 30-second marker lifetime (`SoftDeletedUserCache.cs:29`, `SoftDeletedUserCache.cs:42`)
so the module that deletes an account writes exactly the key the middleware reads; the marker only has
to outlive the window between the delete committing and the next validator query, and the 15-minute
access-token lifetime bounds the rest of the exposure. The key is formatted invariantly on purpose,
because a culture-sensitive identifier would be written under one request's culture and missed under
another (`SoftDeletedUserCache.cs:42-43`). The controller surface that drives everything above
([`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase),
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase),
[`ExternalAuthExtensions`](group-12-api-hosting-mapping.md#externalauthextensions)) and the gRPC token
forwarding ([`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor))
live in later groups; this chapter is the engine those endpoints call into.

### AllowMissingOwnerAttribute
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21` · Level 0 · class (sealed attribute, marker)

- **What it is**: a marker attribute placed on an action or a whole controller to declare that the
  action legitimately has no owner parameter, exempting it from
  [`OwnerOrAdminFilter`](#owneroradminfilter)'s requirement that the request carry a resolvable owner
  identifier.
- **Depends on**: nothing first-party; `System.Attribute` and `AttributeUsageAttribute` (BCL). It is
  read (never constructed) by [`OwnerOrAdminFilter`](#owneroradminfilter).
- **Concept introduced, the explicit opt-out that makes deny-by-default safe.** `[Rubric §11,
  Security]` (assesses whether a guard fails closed rather than open) and `[Rubric §34, Architecture
  Governance & Documentation]` (the exemption is written down at the site it applies to, so it can be
  audited later). The filter this attribute exempts from denies the request when it cannot resolve an
  owner parameter, because "no owner to compare" must not read as "no restriction"
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:6-12`).
  Deny-by-default only works if the genuinely parameter-less actions have a way to say so, and that is
  the entire job of this type. The doc comment names the two shapes that qualify: a collection endpoint
  whose rows are already narrowed to the caller by an ownership specification, and an action restricted
  to administrators by its own authorization policy
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:9-12`).
- **Walkthrough**: the whole type is its `[AttributeUsage]` declaration plus an empty body
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:20-23`).
  `AttributeTargets.Class | AttributeTargets.Method` allows both controller-wide and per-action
  application; `AllowMultiple = false` because a second copy would mean nothing; `Inherited = true` so a
  controller base class can carry it. It holds no data: presence in the endpoint metadata is the entire
  signal, which is exactly what `OwnerOrAdminFilter.HasAllowMissingOwner` looks for
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:83-84`).
- **Why it's built this way**: an empty marker keeps the opt-out cheap to apply and impossible to
  mis-configure, but the `<remarks>` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:15-19`)
  is the load-bearing half of the design: applying it is an *assertion* that the action is guarded
  elsewhere, so every application site is expected to name the replacement guard in a comment. That
  turns a silent hole into a reviewable claim ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) records the audit that produced the current
  application sites).
- **Where it's used**: honored by [`OwnerOrAdminFilter`](#owneroradminfilter) through endpoint
  metadata. In MMCA.Store it marks three actions on
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:61,86,123`
  and four on
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/CustomersController.cs:47,59,76,93`,
  the latter with the replacing guard named in an inline comment
  (`CustomersController.cs:46`).
- **Caveats / not-in-source**: nothing enforces the assertion. No analyzer or test checks that an action
  carrying this attribute really is guarded another way; the guarantee is a review convention, not a
  compile-time or runtime rule.

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
  different claim/role without a fork). Before [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) (cited in the doc comment,
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
  [`OwnerOrAdminFilter`](#owneroradminfilter). MMCA.ADC's Engagement module is the first host to
  configure it rather than take the defaults, pointing the shared filter at a `user_id` claim, the
  `Organizer` bypass role, and a `userId` query argument
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:44`).

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
  checked*). A requirement is a passive data object; a matching `AuthorizationHandler<T>` decides
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
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler), against the grants each module
  declares through [`AuthorizationExtensions.AddPermissions`](#authorizationextensions).

### PermissionAuthorizationHandler
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13` · Level 1 · class (sealed)

- **What it is**: the `AuthorizationHandler<PermissionRequirement>` that decides whether the current
  principal satisfies a [`PermissionRequirement`](#permissionrequirement), either because it carries
  the permission as an explicit claim or because one of its roles grants it.
- **Depends on**: [`PermissionRequirement`](#permissionrequirement),
  [`IPermissionRegistry`](#ipermissionregistry) (injected role-to-permission map, taken as a primary
  constructor parameter at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`),
  [`AuthClaimTypes`](#authclaimtypes) (the permission claim type); `System.Security.Claims`.
- **Concept introduced, resolving a permission through claim-or-role.** `[Rubric §11, Security]`
  (two independent grant paths: a direct permission claim, and role-derived permissions) and
  `[Rubric §7, Microservices Readiness]` (the handler reads roles out of the token regardless of how
  the JWT middleware mapped the role claim type, so it survives inbound-claim-mapping being on or off).
- **Walkthrough**: `HandleRequirementAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:17`)
  null-guards both arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:21-22`),
  then short-circuits to a completed task when the principal is not authenticated
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:24-27`),
  so an anonymous request never succeeds. It then succeeds the requirement if *either*
  `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` (a directly granted
  permission) *or* `permissionRegistry.HasPermission(GetRoles(context.User), requirement.Permission)`
  (a role-derived grant) holds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:29-33`).
  The private `GetRoles(ClaimsPrincipal)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:42-48`)
  gathers role values across three possible claim types: the standard `ClaimTypes.Role` URI plus the
  raw `"role"` and `"roles"` claims, so roles are found whether or not the JWT bearer middleware mapped
  them. The inline comment at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:38-41`
  states the rationale and flags the deliberate duplication: this is the same rule
  [`ICurrentUserService.Roles`](#icurrentuserservice) applies
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:49-55`),
  restated here because the handler runs on the raw principal and has no `ICurrentUserService` to read
  from.
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:19-20`) wraps
  a `DefaultAuthorizationPolicyProvider` built from the ambient `AuthorizationOptions`, kept as the
  fallback. `GetDefaultPolicyAsync` and `GetFallbackPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:23-28`)
  delegate straight to that fallback. `GetPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:31`) is
  the interesting one: it rejects a null/blank name outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:33`), and
  if the name does not start with `PermissionPolicy.Prefix` it defers to the fallback
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
- **Caveats / not-in-source**: a policy object is built on every `GetPolicyAsync` call for a `perm:`
  name; no cache is present in this type, and whether ASP.NET Core caches the result upstream is not
  determinable from this source file.

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
  C# `extension(T)` DI idiom taught in the [primer](00-primer.md#c-extensiont-types--read-this-once):
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
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:42`). The
    inline comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:34-37`)
    records why the mechanism ships here: every host that wires authentication gets it for free, and
    consumers only have to declare their grants.
  - `AddPermissions(Action<PermissionRegistryBuilder> configure)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:54`): the
    per-module entry point for declaring role-to-permission grants. It guards the callback, fetches the
    shared builder via `EnsurePermissionRegistry`, and invokes `configure(builder)` so the module's
    grants accumulate
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:56-61`).
    The doc comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:47-53`)
    notes it is safe to call once per module: grants union into a single registry (the union happens in
    [`PermissionRegistryBuilder.Grant`](#permissionregistrybuilder),
    `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:32-39`).
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
- **Where it's used**: `AddAuthorizationPolicies()` is called at the end of both framework
  authentication-wiring helpers, `AddForwardedJwtBearer`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:187`,
  the call at `WebApplicationBuilderExtensions.cs:241`) and `AddCommonAuthentication`
  (`WebApplicationBuilderExtensions.cs:257`, the call at `WebApplicationBuilderExtensions.cs:291`), so a
  host that wires authentication through either gets the authorization model without an explicit call. `AddPermissions(...)` is called by each module that owns permissions: in
  MMCA.ADC by Conference
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41`), Engagement
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:51`), and Identity
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44`).

### OwnershipHelper
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10` · Level 8 · class (static)

- **What it is**: static helpers a controller calls to scope a query to the current user's own data,
  returning a specification that filters by owner id, or `null` when the caller holds the privileged
  bypass role and should see everything.
- **Depends on**: [`ICurrentUserService`](#icurrentuserservice) (Application,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:1`, the
  current-user/claims boundary described later in this group). The specification it hands back is
  typically a [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype),
  though the helper itself never says so (see caveats).
- **Concept introduced, ownership scoping at the query level (as distinct from the filter's gate).**
  `[Rubric §11, Security]` (row-level data isolation, a non-admin caller can only read their own rows)
  and `[Rubric §1, SOLID]` (the helper produces a specification; the repository applies it). Where
  [`OwnerOrAdminFilter`](#owneroradminfilter) *blocks* a request that names someone else's id, this
  helper *narrows the result set* so a list endpoint returns only the caller's rows without them
  passing any id at all. [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) calls these the two enforcement points of one ownership axis:
  reject-one versus filter-many.
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
  runs in the query pipeline.
- **Where it's used**: called from controller query actions that must isolate a caller's data (in
  MMCA.Store, the shopping-cart and order list endpoints per [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)); its `IsAdmin` overload is also
  the bypass check inside [`OwnerOrAdminFilter`](#owneroradminfilter)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:42`).
- **Caveats / not-in-source**: two gaps are worth knowing. `TSpec` is an open generic with only a
  `class` constraint
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:39`), so the helper
  does not itself require the returned type to be a specification: that contract is the caller's. And a
  non-admin caller whose claim is missing or unparseable also gets `null`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:51`), which means
  no scoping, so callers must not read `null` as "admin" ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) lists this among its trade-offs).

### OwnerOrAdminFilter
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:30` · Level 9 · class (sealed action filter)

- **What it is**: an MVC async action filter that lets a request proceed only if the caller holds the
  bypass role or owns the resource named by the request, returning 403 Forbidden otherwise.
- **Depends on**: [`OwnershipHelper`](#ownershiphelper) (for the `IsAdmin` check),
  [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions) (the vocabulary),
  [`AllowMissingOwnerAttribute`](#allowmissingownerattribute) (the opt-out it honors),
  [`ICurrentUserService`](#icurrentuserservice) (claims); `Microsoft.AspNetCore.Mvc.Filters`,
  `Microsoft.Extensions.Options`.
- **Concept introduced, per-request ownership enforcement as a filter, and deny-by-default.**
  `[Rubric §11, Security]` (a resource-level access gate that runs before the action body, and one that
  fails closed) and `[Rubric §10, Cross-Cutting Concerns]` (the ownership rule is expressed once as a
  filter and attached to any controller that mixes admin and owner access, rather than re-coded in each
  action). This is the *gate* counterpart to [`OwnershipHelper`](#ownershiphelper)'s *query scoping*:
  the helper narrows a list; this filter blocks an attempt to read or mutate a specific id the caller
  does not own ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html), cited at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:14`). The
  deny-by-default half is the newer and more important lesson, and the class doc comment spells it out
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:16-22`): a gate
  that treats "nothing to compare" as "nothing to enforce" silently stops guarding every action whose
  parameter is optional, non-integer, or carried inside a bound model.
- **Walkthrough**: `OnActionExecutionAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:35`) null-guards
  its arguments and reads the current `settings = options.Value`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:37-40`), then
  walks four decisions in order:
  1. **Bypass role**: if `OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole)` it calls
     `next()` and returns
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:42-46`).
  2. **Missing owner claim**: it reads the caller's owner id with
     `currentUserService.GetClaimValue<int>(settings.OwnerClaimType)`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:48`) and
     short-circuits to `ForbidResult` when the claim is absent
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:50-54`).
  3. **Unresolvable owner parameter**: if `TryGetOwnerParameter` cannot produce an int, the request is
     denied unless the endpoint carries
     [`AllowMissingOwnerAttribute`](#allowmissingownerattribute), in which case it falls through to
     `next()`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:56-70`). Note
     the ordering: the opt-out excuses only a *missing* parameter, and it is checked after the claim
     check, so an `[AllowMissingOwner]` action still requires a valid owner claim.
  4. **Mismatch**: a resolved parameter that does not equal the claim value yields `ForbidResult`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:72-76`); only
     an exact match reaches `await next()`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:78`).

  Two private helpers back that flow. `HasAllowMissingOwner`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:83-84`) reads
  `context.ActionDescriptor.EndpointMetadata.OfType<AllowMissingOwnerAttribute>()`, which is how one
  lookup covers the attribute whether it sits on the action or on its declaring controller: MVC has
  already composed both into the metadata (comment at `OwnerOrAdminFilter.cs:81-82`).
  `TryGetOwnerParameter`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:88-106`) resolves
  the id from the route values first
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:90-94`) and,
  failing that, from the model-bound action arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:97-101`), parsing
  each with `int.TryParse` and reporting failure by returning `false`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:104-105`).
- **Why it's built this way**: denying on an unresolvable parameter, with an explicit attribute as the
  only escape, converts a silent failure mode into a visible one: the action either compares an owner id
  or documents the guard that replaces the comparison ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)'s deny-by-default decision and the audit
  table that came with it). Reading the vocabulary from injected options keeps a single filter reusable
  across hosts, and checking the route before the bound arguments means a conventional `/{id}` route
  costs one dictionary lookup.
- **Where it's used**: registered scoped by `AddAPI`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:68`, alongside
  `IdempotencyFilter`, because it depends on scoped services) and applied per controller as
  `[ServiceFilter(typeof(OwnerOrAdminFilter))]`, per the remarks at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:24-29`. Applying
  it at controller level covers every action on that controller, so adoption is an audit of the whole
  controller: MMCA.Store guards `ShoppingCartsController` and `CustomersController` this way, and the
  actions with no owner parameter carry [`AllowMissingOwnerAttribute`](#allowmissingownerattribute).
- **Caveats / not-in-source**: the owner id is parsed as `int` only
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:92,99`), and the
  claim is read as `GetClaimValue<int>` (`OwnerOrAdminFilter.cs:48`); a host whose owner id is a `Guid`
  or a string cannot use this filter as-is. It also assumes the owner parameter *is* the owning id, which
  holds for a cart or a customer profile but not for a resource with its own id and a foreign-key owner
  ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) lists orders as that case, handled with a specification or an explicit per-id check instead).

### IPasswordHasher

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:6` · Level 0 · interface

- **What it is**: the password-security port. Two methods: hash a plaintext password into a separated
  `(byte[] Hash, byte[] Salt)` pair, and verify a plaintext against a stored hash plus salt.
- **Depends on**: nothing first-party, BCL only (`byte[]`). Its Infrastructure adapter is
  [`PasswordHasher`](#passwordhasher).
- **Concept introduced, hash and salt kept apart.** [Rubric §11, Security] assesses credential
  handling. Returning the hash and the salt as two distinct `byte[]` members
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:11`)
  rather than one concatenated blob keeps the storage contract explicit: the caller persists two
  columns, and `VerifyPassword` (`:18`) is unambiguous about what it re-derives and compares. Because
  the algorithm and its parameters live entirely behind this interface, they can be strengthened
  without touching a single Application handler
  ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) sets the current hashing
  policy, applied inside [`PasswordHasher`](#passwordhasher)).
- **Walkthrough**: `(byte[] Hash, byte[] Salt) HashPassword(string password)` (`:11`) returns a named
  value tuple the caller stores as two fields. `bool VerifyPassword(string password, byte[] hash,
  byte[] salt)` (`:18`) re-derives from the supplied salt and compares. The interface declares no
  iteration count, algorithm identifier, or format version: every one of those is the concrete's
  business.
- **Why it's built this way**: a two-method port is the [Rubric §1, SOLID] dependency-inversion story
  in miniature. Swapping the KDF or raising the iteration count is an Infrastructure change, invisible
  to the Register/Login/ChangePassword use cases that only ever see this contract.
- **Where it's used**: constructor-injected into the shared `AuthenticationServiceBase<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:37`), which calls
  `VerifyPassword` on the login path (`:112`) and `HashPassword` on registration (`:159`), and into the
  per-app Identity services that derive from it, for example ADC's `AuthenticationService`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:38`)
  and its `ChangePasswordHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:19`).

---

### ISoftDeletedUserValidator

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7` · Level 0 · interface

- **What it is**: a single-method port that answers "has this account been soft-deleted?", called after
  JWT authentication to reject a soft-deleted user who still holds a valid, unexpired token (BR-133,
  named in the type comment at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:4`).
- **Depends on**: BCL plus the solution-wide `UserIdentifierType` alias (`:15`). See
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) for the alias convention
  and [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for soft-delete
  versus erasure. The generic implementation is
  [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser).
- **Concept introduced, closing the stateless-token window.** [Rubric §11, Security] assesses whether
  revocation is timely. A JWT is stateless: once signed it stays valid until `exp`, even if the account
  behind it was deleted a minute later. This port lets middleware re-ask the question on every
  authenticated request and fail the request when the answer is yes, with no per-handler code. The
  comment at `:5` states the second motive: the interface is declared in Application and implemented
  against the app's own `User` aggregate precisely so the middleware never takes a cross-module domain
  reference. That is the same dependency inversion as the other ports in this group, applied to a
  cross-module read.
- **Walkthrough**: `Task<bool> IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken
  cancellationToken = default)` (`:15`). One question, one answer, cancellable.
- **Where it's used**:
  [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) resolves it
  lazily from the request scope
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75` uses
  `context.RequestServices.GetService<ISoftDeletedUserValidator>()`, so a host that registers no
  implementation simply skips the check; the reason is stated at `:43`). Both apps register the shared
  generic against their own user type:
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:35` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:41`, both
  as `TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()`.

---

### ITokenService

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:8` · Level 0 · interface

- **What it is**: the token-minting port called by the login and refresh use cases. It builds a signed
  JWT access token from explicit identity facts, generates an opaque refresh token, publishes the two
  token lifetimes, and recovers the `ClaimsPrincipal` from an expired-but-validly-signed access token.
- **Depends on**: `System.Security.Claims` (BCL) and the `UserIdentifierType` alias. Its Infrastructure
  adapter is [`TokenService`](#tokenservice), which signs with the RSA key surfaced by
  [`IJwksProvider`](#ijwksprovider).
- **Concept introduced, token creation as an Infrastructure detail.** [Rubric §3, Clean Architecture]
  assesses whether library-specific types stay out of the inner layers: the handlers call this contract
  and never see `System.IdentityModel.Tokens.Jwt`. `GetPrincipalFromExpiredToken`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:48`) is
  the linchpin of the refresh flow: it validates the signature while deliberately ignoring lifetime, so
  an expired access token can still identify the user whose tokens are being rotated, returning `null`
  when the token is invalid (`:47`).
- **Walkthrough**: `GenerateAccessToken(UserIdentifierType userId, string email, string role, string
  fullName, IEnumerable<Claim>? additionalClaims = null)` (`:17-22`) takes the minimum claim set as
  typed parameters rather than a ready-made principal, with an escape hatch for module-specific claims.
  `GenerateRefreshToken()` (`:26`) returns a cryptographically random base64 string. Two **default
  interface members** publish the lifetimes: `AccessTokenLifetime` (`:33`, defaulting to 15 minutes)
  and `RefreshTokenLifetime` (`:40`, defaulting to 7 days), both documented as the BR-205 baseline. The
  comments at `:28-32` and `:35-39` explain the split: the real implementation derives both from the
  bound JWT settings, so the expiry reported to a client matches the token's actual `exp`, while the
  defaults keep hand-written test doubles on the baseline instead of forcing every double to implement
  two more members. `GetPrincipalFromExpiredToken(string token)` (`:48`) closes the set.
- **Why it's built this way**: the explicit-parameter overload is a [Rubric §11, Security] guardrail.
  The token's contents are a deliberate list, not whatever claims happened to ride in on an inbound
  principal. Surfacing the lifetimes through the same port removes the older duplication where the
  caller hard-coded an expiry that could silently drift from the signed `exp`. Note the consumer still
  guards: `AuthenticationServiceBase` falls back to the same 15-minute and 7-day baselines when an
  implementation reports a non-positive lifetime
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:61-70`).
- **Where it's used**: the shared `AuthenticationServiceBase` login/refresh/register paths
  (`AuthenticationServiceBase.cs:168` and `:214` stamp the refresh-token and access-token expiries from
  those lifetimes, and `:298`/`:305` do the same on the refresh path) and, through it, each app's
  Identity authentication service, for example
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:100`
  (access token with speaker claims) and `:225` (refresh token). The rotated pair produced here is what
  [`CookieSessionRefresher`](#cookiesessionrefresher) later exchanges on the browser's behalf.

---

### SessionCookieRequest

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:72` · Level 0 · record

- **What it is**: the inbound body for `POST /auth/session-cookie`: the access and refresh token
  strings the browser hands back to the server so they can be re-issued as HttpOnly cookies.
- **Depends on**: nothing first-party. It is a two-string `public sealed record` nested inside
  [`SessionCookieEndpoints`](#sessioncookieendpoints).
- **Concept introduced, the browser cannot set an HttpOnly cookie from JS.** [Rubric §11, Security] and
  [Rubric §26, Front-End Security] both assess XSS-resistant token storage. After the SPA logs in
  against the API it holds the token pair in memory; to persist that pair as HttpOnly cookies
  (unreadable by script, so an injected payload cannot exfiltrate them) it POSTs the tokens once to
  this same-origin endpoint, which writes the cookies server-side. This is the seeding half of
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)'s browser
  session-cookie scheme.
- **Walkthrough**: the whole type is one line, `public sealed record SessionCookieRequest(string
  AccessToken, string RefreshToken)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:72`). It
  is nested in the endpoint class it serves, so the contract sits next to its only route.
- **Where it's used**: bound by the `POST` handler at `SessionCookieEndpoints.cs:29`, which passes both
  strings straight to [`SessionCookieJar`](#sessioncookiejar) (`:31`).

---

### SessionTokenResponse

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:20` · Level 0 · record

- **What it is**: the JSON body returned by `POST /auth/session/token`: the access token and its UTC
  expiry, and nothing else.
- **Depends on**: BCL only. Produced by [`SessionCookieEndpoints`](#sessioncookieendpoints) from a
  [`SessionTokenResult`](#sessiontokenresult).
- **Concept introduced, the refresh token never crosses the wire to the browser.** [Rubric §9, API &
  Contract Design] assesses whether a response exposes only what its client needs. This record carries
  the access token, which the SPA holds in memory for its Bearer calls, and deliberately omits the
  refresh token, which stays exclusively in the HttpOnly cookie. The doc comment states the rule
  outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:16-19`).
- **Walkthrough**: `public sealed record SessionTokenResponse(string AccessToken, DateTime
  AccessTokenExpiry)` (`:20`). It is the serialized projection of the internal
  [`SessionTokenResult`](#sessiontokenresult), which is why the two types carry the same two members
  and different visibility of intent.
- **Where it's used**: constructed and returned by the `/auth/session/token` handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:56`).

---

### SessionTokenResult

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:14` · Level 0 · record struct

- **What it is**: the internal carrier for a validated access token plus its UTC expiry, returned by
  the refresher. A `readonly record struct`, so the validate path allocates nothing to report success.
- **Depends on**: BCL only. Returned by [`ICookieSessionRefresher`](#icookiesessionrefresher) and
  projected onto the wire-facing [`SessionTokenResponse`](#sessiontokenresponse).
- **Concept**: the value-type twin of [`SessionTokenResponse`](#sessiontokenresponse). Same two
  members, but this one stays server-side and is used as `SessionTokenResult?` at every call site, so
  "no valid session" is expressed by the absence of a value rather than by a sentinel string or a
  thrown exception. [Rubric §12, Performance & Scalability] assesses avoidable allocation; a
  `readonly record struct` is the light choice for a result produced on every qualifying navigation.
- **Walkthrough**: `public readonly record struct SessionTokenResult(string AccessToken, DateTime
  AccessTokenExpiry)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:14`), with
  the one-line summary at `:13` naming its provenance ("acquired from the session cookies").
- **Where it's used**: the return type of
  [`ICookieSessionRefresher.GetOrRefreshAsync`](#icookiesessionrefresher) (`:36`); constructed by
  [`CookieSessionRefresher`](#cookiesessionrefresher) at `:71` (cookie still valid) and `:92` (after a
  rotation); unwrapped by [`SessionCookieEndpoints`](#sessioncookieendpoints) at
  `SessionCookieEndpoints.cs:56`.

---

### ICookieSessionRefresher

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:29` · Level 1 · interface

- **What it is**: the "validate-or-refresh over the HttpOnly session cookies" port. One method returns
  a currently-valid access token for the request, rotating from the refresh cookie when the access
  cookie has expired, or `null` when there is no valid session.
- **Depends on**: `HttpContext` (ASP.NET Core) and [`SessionTokenResult`](#sessiontokenresult). Its
  only implementation is [`CookieSessionRefresher`](#cookiesessionrefresher).
- **Concept introduced, server-side refresh that browser script never sees.** [Rubric §11, Security]
  assesses where the long-lived credential lives. The type comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:22-28`) is
  the contract in prose: if the access cookie's JWT is still valid it is returned as-is; otherwise the
  refresh cookie is exchanged at the API's `auth/refresh` endpoint server-to-server, so the refresh
  token never reaches browser JS; the rotated pair is written back as HttpOnly cookies; and the fresh
  access token is stashed on `HttpContext.Items` so the current request's SSR authentication can read
  it before the `Set-Cookie` takes effect on the next request.
- **Walkthrough**: `Task<SessionTokenResult?> GetOrRefreshAsync(HttpContext context, CancellationToken
  cancellationToken = default)` (`:36`). The nullable return is the whole vocabulary: a value means
  "here is a good access token", `null` means "no session, treat this caller as anonymous". The doc
  comment at `:31-35` flags that setting fresh cookies is a side effect of the call.
- **Why it's built this way**: one interface lets the SSR middleware and the `/auth/session/token`
  endpoint share a single refresh path, so exactly one type decides validity and exactly one type
  rotates ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). It is
  also what makes both callers trivially testable against a mock.
- **Where it's used**: injected into
  [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) (which runs before
  authentication on navigations) and resolved by the `/auth/session/token` handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:46`).
  Registered as a singleton at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:163`.

---

### CookieSessionRefreshMiddleware

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:13` · Level 2 · class

- **What it is**: an ASP.NET Core middleware that runs before `UseAuthentication` on full-page
  navigations and, when the access cookie's JWT has expired but the refresh cookie is still good,
  refreshes server-side so SSR `[Authorize]` survives instead of bouncing to `/login`.
- **Depends on**: `RequestDelegate` and [`ICookieSessionRefresher`](#icookiesessionrefresher), both
  primary-constructor parameters
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:13`).
  Registered through
  [`CookieSessionRefreshMiddlewareExtensions`](#cookiesessionrefreshmiddlewareextensions).
- **Concept introduced, refresh before authenticate for prerender.** [Rubric §11, Security] and
  [Rubric §18, UI Architecture] meet here. A Blazor Web App prerenders `[Authorize]` pages on a cold
  GET (new tab, F5, external deep link), and authentication reads the cookie before any interactive
  code runs. If the access cookie has just expired, plain authentication fails and the user is
  redirected even though a perfectly good refresh token is sitting in the next cookie over. This
  middleware inserts a refresh attempt first, so the token the refresher stashes on `HttpContext.Items`
  is what authentication then reads.
- **Walkthrough**: `InvokeAsync` (`:16-26`) null-checks the context (`:18`), asks `ShouldAttempt`
  (`:20`), and on a match awaits `refresher.GetOrRefreshAsync(context, context.RequestAborted)` (`:22`)
  before invoking the rest of the pipeline (`:25`). The refresh is a side effect only: the return value
  is discarded and the pipeline always continues, leaving the actual authentication decision to the
  downstream scheme. `ShouldAttempt` (`:28-31`) gates strictly to `GET` requests whose `Accept` header
  contains `text/html`, so it never fires on static assets, API calls, or XHR.
- **Why it's built this way**: the narrow gate keeps a cookie read and a possible outbound HTTP call
  off every static-asset request, and delegating single-flight to the refresher means the middleware
  itself cannot double-rotate a token
  ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)).
- **Where it's used**: registered on both Blazor Server hosts immediately before `UseAuthentication()`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:138` (with `UseAuthentication()` on the very next
  statement at `:140`) and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:178` (`:180`).
- **Caveats / not-in-source**: the ordering rule (before `UseAuthentication`) is enforced by the host
  that calls the extension, not by this class. Getting it wrong silently disables the SSR refresh
  rather than failing loudly.

---

### SessionCookieEndpoints

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:15` · Level 2 · class

- **What it is**: the minimal-API mapper for the three session-cookie routes: `POST` and `DELETE
  /auth/session-cookie` (seed and clear the HttpOnly cookies at login and logout) and `POST
  /auth/session/token` (the same-origin validate-or-refresh the browser calls to hydrate its in-memory
  access token). It also owns the two cookie-name constants and the cross-site guard.
- **Depends on**: [`SessionCookieJar`](#sessioncookiejar),
  [`ICookieSessionRefresher`](#icookiesessionrefresher),
  [`SessionCookieRequest`](#sessioncookierequest), [`SessionTokenResponse`](#sessiontokenresponse), and
  ASP.NET Core routing plus `Results`. The cookies it writes are read back by
  [`CookieTokenReader`](#cookietokenreader).
- **Concept introduced, the cookie names are the shared contract.** `AccessTokenCookieName =
  "mmca_auth_access"` and `RefreshTokenCookieName = "mmca_auth_refresh"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:17-18`)
  are `public const`, and every other type in this feature (the jar, the reader, the refresher)
  references them instead of a string literal, so the names have exactly one definition. [Rubric §9,
  API & Contract Design] is the other lens: three tightly-scoped routes, all excluded from OpenAPI
  (`ExcludeFromDescription` at `:27` and `:58`) because they are browser plumbing, not public API
  surface.
- **Walkthrough**: the mapping method lives inside an `extension(IEndpointRouteBuilder endpoints)`
  block (`:20`), the C# extension-member syntax this codebase uses for fluent registration
  ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), so hosts call
  `app.MapSessionCookieEndpoints()`. Inside `MapSessionCookieEndpoints` (`:22-63`): a route group for
  `/auth/session-cookie` is created and excluded from description (`:26-27`); the `POST` (`:29-33`)
  binds a [`SessionCookieRequest`](#sessioncookierequest), calls `SessionCookieJar.Append` and returns
  `204`; the `DELETE` (`:35-39`) calls `SessionCookieJar.Delete` and returns `204`; both
  `DisableAntiforgery()` because there is no antiforgery token cookie to validate on these calls. The
  `/auth/session/token` `POST` (`:45-60`) first rejects an obvious cross-site request with `403`
  (`:48-51`), then awaits `refresher.GetOrRefreshAsync` (`:53`); a `null` result becomes a `401` JSON
  body `{ error = "no_session" }` (`:55`), otherwise a
  [`SessionTokenResponse`](#sessiontokenresponse) is serialized (`:56`). That route is
  `AllowAnonymous()` (`:59`) because it authenticates via the cookies themselves. The private
  `IsCrossSite` (`:68-70`) inspects the `Sec-Fetch-Site` request header and treats a missing header as
  allowed, which the comment at `:67` attributes to older browsers.
- **Why it's built this way**: CSRF is defended in depth rather than by antiforgery tokens. The comment
  at `:66-67` spells it out: `POST`-only, `SameSite=Lax` on the cookies (which already blocks
  cross-site cookie attachment), and the `Sec-Fetch-Site` check together stop a cross-site page from
  driving these endpoints, which is what makes disabling antiforgery safe here
  ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). [Rubric §11,
  Security].
- **Where it's used**: mapped by both Blazor Server hosts,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:157` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:194`. The routes are exercised end to end by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:125`,
  whose `CreateHostAsync` builds a real pipeline around the mapper; the cases that matter most are the
  cross-site `403` (`:60`), the no-session `401` (`:91`), and the assertion that a valid session returns
  the access token but never the refresh token (`:104`).

---

### SessionCookieJar

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieJar.cs:11` · Level 2 · class

- **What it is**: the one internal static helper that writes and clears the two HttpOnly auth cookies,
  so the endpoints, the server-side refresher, and the SSR middleware all emit identical cookie
  options.
- **Depends on**: `CookieOptions`, `HttpContext` and `IWebHostEnvironment` (ASP.NET Core) plus the
  cookie-name constants on [`SessionCookieEndpoints`](#sessioncookieendpoints).
- **Concept introduced, one place to build cookie options.** [Rubric §11, Security] assesses cookie
  hardening. Centralizing `BuildOptions`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieJar.cs:31-38`) means
  every write is `HttpOnly = true` (`:33`), `Secure` outside Development (`:34`,
  `!environment.IsDevelopment()`, so `http://localhost` dev still works while every deployed
  environment forces HTTPS), `SameSite = SameSiteMode.Lax` (`:35`), and `Path = "/"` (`:36`). Drift
  between the seed, refresh, and clear paths is structurally impossible because all three call this
  method. The conditional `Secure` is the one thing an analyzer objects to, and the suppression carries
  its justification inline (`:30` and `:39` bracket a scoped `#pragma warning disable S2092`), which is
  the house style for an accepted deviation.
- **Walkthrough**: `Lifetime = TimeSpan.FromDays(7)` (`:14`) is aligned to the refresh-token lifetime
  by the comment at `:13`, so a cookie never outlives the credential it carries. `Append` (`:16-21`)
  builds options once and writes both cookies with that 7-day `MaxAge`. `Delete` (`:23-28`) rebuilds
  the options with `TimeSpan.Zero`, which `:37` turns into a `null` `MaxAge`, and calls
  `Cookies.Delete` for both names.
- **Why it's built this way**: a delete must send back the same `Path`, `SameSite` and `Secure`
  attributes as the original write or the browser will not match the cookie and will not clear it.
  Sharing `BuildOptions` between `Append` and `Delete` guarantees that
  ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)).
- **Where it's used**: [`SessionCookieEndpoints`](#sessioncookieendpoints) (seed at
  `SessionCookieEndpoints.cs:31`, clear at `:37`) and
  [`CookieSessionRefresher`](#cookiesessionrefresher) (rewrite after rotation, `CookieSessionRefresher.cs:87`).

---

### CookieSessionRefreshMiddlewareExtensions

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:35` · Level 3 · class

- **What it is**: a one-method registration helper (`UseCookieSessionRefresh`) that adds
  [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) to the request pipeline.
- **Depends on**: `IApplicationBuilder` (ASP.NET Core) and
  [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware).
- **Concept**: the standard `UseXxx()` middleware-registration idiom, written with the codebase's
  `extension(IApplicationBuilder app)` member syntax
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:37`);
  see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to). Nothing new beyond
  putting a name and a doc comment on `UseMiddleware<T>`.
- **Walkthrough**: `UseCookieSessionRefresh()` (`:43-47`) null-guards the builder (`:45`) and returns
  `app.UseMiddleware<CookieSessionRefreshMiddleware>()` (`:46`). The XML comment (`:39-42`) states the
  load-bearing rule in bold: register it immediately **before** `UseAuthentication()` on the Blazor
  Server (UI.Web) host.
- **Where it's used**: the two Blazor Server hosts
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:138`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:178`). Both the null guard and the
  pipeline wiring are covered directly at
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:115`
  and `:123`.

---

### CookieTokenReader

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10` · Level 3 · class

- **What it is**: the read side of the cookie feature. It pulls the access JWT and the refresh token
  out of the request cookies (or out of the freshly-refreshed token stashed on `HttpContext.Items`) for
  server-side token storage during SSR prerender, when JS interop and therefore `localStorage` are
  unreachable.
- **Depends on**: `IHttpContextAccessor` (primary constructor,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10`) and the
  cookie-name constants on [`SessionCookieEndpoints`](#sessioncookieendpoints). Consumed by
  [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler) and by
  [`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice).
- **Concept introduced, the fresh-token handoff.** [Rubric §10, Cross-Cutting Concerns] covers
  request-scoped state. The `internal const string FreshAccessTokenItemKey = "mmca.fresh-access-token"`
  (`:17`) is the agreed `HttpContext.Items` key under which
  [`CookieSessionRefresher`](#cookiesessionrefresher) parks a just-rotated access token, as the comment
  at `:12-16` explains. `ReadAccessToken` checks that key first, so on the very request that triggered
  a refresh, SSR authentication uses the new token instead of the still-expired one sitting in the
  request cookie; the `Set-Cookie` from the rotation only affects the next request.
- **Walkthrough**: `ReadAccessToken` (`:19-34`) returns `null` when there is no `HttpContext` (`:22-25`),
  then prefers a non-empty `string` under `FreshAccessTokenItemKey` (`:27-31`), and otherwise falls back
  to the access cookie (`:33`). The `fresh is string freshToken` pattern plus the whitespace check mean
  a wrong-typed or blank item silently falls through to the cookie rather than poisoning the request.
  `ReadRefreshToken` (`:36-37`) reads the refresh cookie directly with a null-conditional accessor and
  has no fresh-item fallback, because only the access token is ever swapped mid-request.
- **Why it's built this way**: the Items-first precedence is exactly what makes the middleware's
  server-side refresh take effect on the request that triggered it instead of only on the next one
  ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)).
- **Where it's used**: injected into
  [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler)
  (`SessionCookieAuthenticationHandler.cs:28`) and into the UI host's server-side token store
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:19`).
  Registered scoped by `AddServerAuthSessionCookie`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:157`).

---

### CookieSessionRefresher

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:51` · Level 4 · class

- **What it is**: the singleton implementation of
  [`ICookieSessionRefresher`](#icookiesessionrefresher). It validates the access cookie's JWT locally
  and, when that fails, exchanges the refresh cookie at the API's `auth/refresh` endpoint
  server-to-server, writes the rotated pair back as cookies, and single-flights concurrent refreshes so
  a burst of requests rotates the token only once.
- **Depends on**: `IHttpClientFactory`, `IMemoryCache`, `IWebHostEnvironment` and
  `ILogger<CookieSessionRefresher>` (primary constructor,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:51-55`);
  [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) (`:62`); [`SessionCookieJar`](#sessioncookiejar);
  [`CookieTokenReader`](#cookietokenreader) for the Items key;
  [`SessionCookieEndpoints`](#sessioncookieendpoints) for the cookie names; and the
  [`AuthenticationResponse`](#authenticationresponse) / [`RefreshTokenRequest`](#refreshtokenrequest)
  contracts from `MMCA.Common.Shared.Auth`. It reads token expiry with
  `System.IdentityModel.Tokens.Jwt`.
- **Concept introduced, single-flight refresh under a thundering herd.** [Rubric §12, Performance &
  Scalability] assesses behavior under concurrent load. When an access token expires, many queued
  navigations can arrive at once; rotating for each would burn the refresh token repeatedly and log the
  user out. The type comment (`:39-50`) states the design and, notably, why it changed: the lock is a
  **striped** [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) keyed by refresh token rather than one
  process-wide semaphore, because the lock is held across an outbound HTTP call and a single semaphore
  serialized every unrelated user's cold navigation behind whichever refresh happened to be in flight.
  Two unrelated tokens can still land on one stripe, which the comment calls out as harmless precisely
  because the rotation-grace cache is re-checked per token after acquiring. Alongside the lock, a
  10-second `RotationGrace` (`:60`) caches the rotated pair keyed by the OLD refresh token (`:144`), so
  a slightly-late sibling carrying the same expired pair gets the same result instead of rotating
  again.
- **Walkthrough**: `GetOrRefreshAsync` (`:64-93`) reads the access cookie (`:68`) and, if
  `TryReadValidExpiry` passes, returns it untouched (`:69-72`). Otherwise it reads the refresh cookie
  and returns `null` when there is none (`:74-78`). It calls `RefreshAsync` (`:80`), treats a missing or
  blank access token as failure (`:81-84`), writes the rotated pair with `SessionCookieJar.Append`
  (`:87`), stashes the fresh access token on `context.Items[CookieTokenReader.FreshAccessTokenItemKey]`
  (`:91`, with the reason spelled out at `:89-90`), and returns the new
  [`SessionTokenResult`](#sessiontokenresult) (`:92`). `RefreshAsync` (`:95-111`) is textbook
  double-checked locking: a cache hit returns immediately (`:97-100`), otherwise it acquires the stripe
  for this token (`:102`) and re-checks the cache before doing any work (`:105-108`). `CallRefreshAsync`
  (`:113-152`) creates the named client (`:115`), POSTs a
  [`RefreshTokenRequest`](#refreshtokenrequest) to the relative `auth/refresh` URI with
  `CancellationToken.None` (`:127-130`) so that once the lock is held the rotation completes and writes
  its cookies even if the triggering request was aborted (the reason is at `:125-126`), bails on a
  non-success status (`:132-135`) or an empty access token (`:138-141`), and caches the
  [`AuthenticationResponse`](#authenticationresponse) under the old refresh token for `RotationGrace`
  (`:144`). `TryReadValidExpiry` (`:154-183`) rejects a blank token, refuses anything
  `JwtSecurityTokenHandler` cannot read (`:162-166`), treats the token as expired when
  `jwt.ValidTo <= DateTime.UtcNow + ClockSkew` (`:171`, with `ClockSkew` a 30-second margin at `:59`),
  and swallows only `ArgumentException`/`FormatException` (`:179-182`). `CacheKey` (`:189`) builds the
  `mmca:session-refresh:{refreshToken}` string that is both the cache key and the striping key; the
  comment at `:185-188` explains it is `internal` rather than `private` so a concurrency test can pick
  two refresh tokens that do not collide on a stripe, which is a nice example of a testability
  affordance that costs nothing at runtime. [Rubric §14, Testability].
- **Concept, an SSR-safe failure mode.** [Rubric §29, Resilience] and [Rubric §13, Observability]
  apply to the outbound call. `CallRefreshAsync` wraps the POST in a `try` whose filter narrows to
  `HttpRequestException`, `OperationCanceledException`, `JsonException` and `NotSupportedException`
  (`:147`), logs one warning through the source-generated `LogRefreshCallFailed` (`:149`, declared with
  `[LoggerMessage]` at `:191-192`, which is why the class is `partial` at `:51`), and returns `null`.
  The comment at `:117-122` gives the reasoning: this code runs during SSR, so an escaping exception
  would turn a signed-in user's navigation into a `500` instead of an anonymous render. The failure is
  deliberately not cached (only a successful rotation reaches `cache.Set` at `:144`), so the next
  navigation retries, and a missing `BaseAddress` raises `InvalidOperationException` and is left to
  propagate because that is a host misconfiguration rather than a runtime condition.
- **Why it's built this way**: keying the grace cache by the OLD token is what lets a slightly-late
  sibling find the already-rotated pair, and striping the lock keeps one user's slow refresh from
  blocking everyone else's cold navigation. The server-to-server call is what keeps the refresh token
  off browser JS ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)).
  [Rubric §11, Security].
- **Where it's used**: resolved as [`ICookieSessionRefresher`](#icookiesessionrefresher) by
  [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) and by the
  `/auth/session/token` endpoint. Its named `HttpClient`, `RefreshClientName =
  "SessionCookieRefreshClient"` (`:57`), is configured with the API base address in
  `AddServerAuthSessionCookie` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:159-160`),
  which also registers the refresher as a singleton (`:162-163`) with an inline note that a shared
  instance across requests is what makes single-flight work at all.

---

### SessionCookieAuthenticationHandler

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24` · Level 4 · class

- **What it is**: an ASP.NET Core `AuthenticationHandler` that reads the JWT out of the session cookie,
  parses its claims, and populates `HttpContext.User` during SSR prerender, so both Blazor's internal
  SSR authorization and endpoint-level `[Authorize]` pass on a fresh GET before the interactive phase
  starts.
- **Depends on**: `AuthenticationHandler<AuthenticationSchemeOptions>` and its three framework
  constructor arguments (`IOptionsMonitor`, `ILoggerFactory`, `UrlEncoder`) plus
  [`CookieTokenReader`](#cookietokenreader)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24-29`),
  and `System.IdentityModel.Tokens.Jwt`. Registered by
  [`SessionCookieAuthenticationExtensions`](#sessioncookieauthenticationextensions).
- **Concept introduced, a deliberately non-validating scheme.** [Rubric §11, Security] assesses where
  the trust decision is actually made. The `<remarks>` block (`:18-23`) is load-bearing: this handler
  does **not** validate the JWT signature. The cookie was minted by the UI host in response to a
  successful login against the API, and every real API call still performs full JWT validation, so the
  handler exists only to extract claims for ASP.NET Core's auth system during prerender. That is what
  lets a deep-linked `[Authorize]` page render instead of flashing a redirect. Read it next to
  [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html): the API remains
  the single validation authority via JWKS, and the UI host deliberately does not duplicate it.
- **Walkthrough**: `SchemeName = "SessionCookie"` (`:32`) is the canonical scheme name, exposed as a
  `public const` so registration never repeats a literal. `HandleAuthenticateAsync` (`:35-69`) reads the
  token through [`CookieTokenReader`](#cookietokenreader) (`:37`) and returns
  `AuthenticateResult.NoResult()` when there is none (`:38-41`), which lets other schemes have their
  turn rather than hard-failing the request. It then rejects anything that is not a readable JWT
  (`:46-49`), and fails when `jwt.ValidTo` is in the past according to the base handler's injectable
  `TimeProvider` (`:55-58`, with the rationale at `:53-54`). On success it builds a `ClaimsIdentity`
  from the JWT claims with `ClaimTypes.NameIdentifier` and `ClaimTypes.Role` as the name and role claim
  types (`:60`), wraps it in a `ClaimsPrincipal` and an `AuthenticationTicket` stamped with the scheme
  name (`:61-63`), and returns `Success`. Malformed-token exceptions are narrowed to `ArgumentException`
  and `FormatException` and returned as `Fail` (`:65-68`). `HandleChallengeAsync` (`:72-77`) redirects
  to `/login?returnUrl=...` with the original path and query URL-escaped (`:74-75`), and
  `HandleForbiddenAsync` (`:80-84`) sets a bare `403`.
- **Why it's built this way**: validating the signature here would duplicate the API's JWKS validation
  and couple the UI host to the signing key. Extracting claims only, while the API stays the single
  authority, keeps the trust boundary in one place
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) and
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). Reading the
  clock through the base handler's `TimeProvider` rather than `DateTime.UtcNow` keeps the expiry check
  on the same injectable clock as the rest of the auth stack and its tests. [Rubric §14, Testability].
- **Where it's used**: registered as the `SessionCookie` scheme on both Blazor Server hosts,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:70-71` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:111-112`. Covered directly by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/SessionCookieAuthenticationHandlerTests.cs`,
  including the fresh-token-from-Items path (`:95`, which stashes the token under
  `CookieTokenReader.FreshAccessTokenItemKey` at `:102` and asserts it wins over an expired cookie).

---

### SessionCookieAuthenticationExtensions

> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:90` · Level 5 · class

- **What it is**: the registration helper for
  [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler): a single
  `AddSessionCookieAuthentication()` that wires the scheme into an `AuthenticationBuilder`.
- **Depends on**: `AuthenticationBuilder` (ASP.NET Core) and
  [`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler).
- **Concept**: the same `extension(T)` DI-registration idiom introduced by the other extension helpers
  in this group. The method is declared inside an `extension(AuthenticationBuilder builder)` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:92`)
  and reads at the call site as an instance method on the builder; see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Walkthrough**: `AddSessionCookieAuthentication()` (`:98-100`) is a single expression:
  `builder.AddScheme<AuthenticationSchemeOptions, SessionCookieAuthenticationHandler>(
  SessionCookieAuthenticationHandler.SchemeName, displayName: null, configureOptions: null)`. The
  scheme name comes from the handler's own constant rather than a duplicated literal, and the two
  explicit `null` arguments are named, so the call site says what it is skipping. The doc comment
  (`:94-97`) directs callers to use it after
  `AddAuthentication(SessionCookieAuthenticationHandler.SchemeName)`.
- **Where it's used**: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:71` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:112`, chained onto the host's
  `AddAuthentication(SessionCookieAuthenticationHandler.SchemeName)` call on the preceding line.

---

### ICurrentUserService

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:9` · Level 8 · interface

- **What it is**: the Application layer's read-only window onto the authenticated caller: the raw
  `ClaimsPrincipal`, a strongly-typed `UserId`, the caller's first role, the full role set, a generic
  typed-claim reader, and a role-membership helper. It answers "who is calling?" without any handler
  ever touching `HttpContext`.
- **Depends on**: `System.Security.Claims` and `IParsable<T>` (BCL) plus the solution-wide
  `UserIdentifierType` alias
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:15`);
  see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to). It references
  [`RoleNames`](#rolenames) in documentation only (`:80`). Its adapter is
  [`CurrentUserService`](#currentuserservice) in Infrastructure.
- **Concept introduced, the caller-identity port with behavior on the interface.** [Rubric §3, Clean
  Architecture] assesses whether inner layers stay free of transport types, and [Rubric §1, SOLID]
  (interface segregation) whether a contract exposes only what its clients need. A handler must know
  the caller to run ownership checks and to stamp audit fields, but it must not depend on
  `IHttpContextAccessor`, which would drag ASP.NET Core into the Application project. This interface is
  that inversion. What makes it worth studying is the use of **default interface members**: `Roles`
  (`:45-64`) and `IsInRole` (`:88-89`) ship real implementations on the contract, so every implementer
  and every hand-written test double inherits correct multi-role behavior instead of re-deriving it.
- **Walkthrough**: `ClaimsPrincipal User` (`:12`) exposes the full principal for advanced inspection.
  `UserIdentifierType? UserId` (`:15`) is the typed identifier, nullable because an unauthenticated
  request has no user. `string? Role` (`:22`) is documented as the **first** role claim only, with the
  remarks at `:18-21` steering callers to `Roles` or `IsInRole` for membership checks. `Roles`
  (`:45-64`) is the interesting member: it reads every role claim, accepting each claim type the JWT
  middleware may produce (`ClaimTypes.Role` when inbound claim mapping is on, or the raw `role` /
  `roles` claim when it is off, `:50-53`), falls back to a single-element list built from `Role` when
  the principal yields nothing (`:62`), and null-guards `User` even though the property is declared
  non-nullable (`:49`). The long remarks at `:27-44` justify both accommodations from the nature of a
  default interface member: it runs against *every* implementation, including a hand-written double or
  a mock that stubs only `Role`, where reading claims alone would have reported no roles and silently
  turned an authorization check into a denial, and dereferencing a null principal would have turned it
  into a `NullReferenceException`. Claims win when present, so a genuine multi-role principal is still
  read in full. `T? GetClaimValue<T>(string claimType) where T : struct, IParsable<T>` (`:73-74`)
  parses a named claim into any parsable value type and returns `null` when the claim is missing or
  unparseable, which is how a module reads its own claim (the doc names `speaker_id`, `:68`) without
  Common ever knowing that claim exists. `IsInRole(string roleName)` (`:88-89`) is
  `Roles.Any(role => string.Equals(role, roleName, StringComparison.OrdinalIgnoreCase))`.
- **Why it's built this way**: the remarks at `:82-87` record the reasoning behind `IsInRole` checking
  every claim rather than comparing against `Role`. Comparing against the first role alone matched only
  whichever role happened to be listed first, which is latent today because tokens carry a single role,
  and would have surfaced silently as an authorization denial the moment a second role was added.
  Typing `UserId` as the per-app alias instead of a generic parameter keeps the interface concrete and
  easy to mock while staying correct for each app. [Rubric §11, Security] and [Rubric §15, Best
  Practices & Code Quality].
- **Where it's used**: injected into command handlers for ownership checks, into
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) for `CreatedBy` and
  `LastModifiedBy` stamping, and into this group's authorization filters and permission handlers.
- **Caveats / not-in-source**: `Role` deliberately reports only the first role claim; treat it as a
  display value and use `Roles` or `IsInRole` for any decision.

### AuthenticationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared` · `MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15` · Level 0 · record struct

- **What it is**: a device-aware authentication request shape for mobile/MAUI clients. It carries device metadata (id, form factor, platform, model, manufacturer, name, type) alongside the user's email so that sessions and tokens can be tracked per device (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-14`).
- **Depends on**: nothing first-party. Eight positional `string` parameters and the BCL only.
- **Concept**: an immutable `readonly record struct` request DTO. The `readonly record struct` gives value-based equality and a compact, copy-by-value payload for something that crosses the wire once per login, and the eight positional parameters (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`) show the same request shape scaling from bare credentials to a credential-plus-context payload. `[Rubric §11, Security]` assesses credential handling and session management: capturing device identity at authentication time is the precondition for per-device session tracking, which is what the XML doc states the type exists for (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:4-5`).
- **Walkthrough**: the whole type is one positional constructor with eight `string` members (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`): `DeviceId`, `Email`, `DeviceFormFactor`, `DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceName`, `DeviceType`. Note that `Email` is the plain `string` here and not the [Email](group-02-domain-building-blocks.md#email) value object: this is a transport shape, and normalization happens further in. It is also the only type in the root `MMCA.Common.Shared` namespace; the rest of the auth request family lives under `MMCA.Common.Shared.Auth`.
- **Why it's built this way**: a struct record keeps a small, short-lived login payload allocation-free while still giving structural equality and a `with`-expression copy for free; every member being `string` keeps it trivially serializable by any client transport.
- **Caveats / not-in-source**: this type has **no first-party consumer in the workspace source today**. A search across all four .NET repos finds `AuthenticationRequest` only in its own declaration file (plus onboarding/inventory documents), so the device fields are a published contract awaiting a caller rather than an active login path. Treat the per-device revocation story as the documented intent (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-5`), not as shipped behavior.

---

### ClaimBasedUserIdProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9` · Level 0 · class

- **What it is**: a SignalR `IUserIdProvider` that extracts the `user_id` JWT claim from a `HubConnectionContext`, so that `IHubContext<THub>.Clients.User(userId)` routes push messages to the right WebSocket connections (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:5-8`).
- **Depends on**: `Microsoft.AspNetCore.SignalR.IUserIdProvider` (ASP.NET Core). Consumed by [NotificationHub](group-10-notifications.md#notificationhub) and [SignalRPushNotificationSender](group-10-notifications.md#signalrpushnotificationsender).
- **Concept**: `[Rubric §11, Security]` assesses that identity is derived from the token and not from client-supplied input, and `[Rubric §10, Cross-Cutting]` assesses whether such plumbing is centralized once. SignalR's default `IUserIdProvider` keys connections by the `NameIdentifier` claim. This codebase instead stamps a custom `user_id` claim on every JWT (see [TokenService](#tokenservice), `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:81`), so without a matching provider `Clients.User(userId)` would resolve zero connections and every targeted push would silently vanish.
- **Walkthrough**: `const string UserIdClaimType = "user_id"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:11`) keeps the claim name identical to the issuer's. `GetUserId(HubConnectionContext connection)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:14-15`) returns `connection.User?.FindFirst(UserIdClaimType)?.Value`. The null-conditional chain means an unauthenticated connection (no principal, or no claim) yields `null`, and SignalR then treats the connection as having no user rather than throwing during connection setup.
- **Why it's built this way**: `sealed`, one claim in and one nullable string out. Naming the claim in a `const` on the reader side, matching the literal on the writer side, is what keeps the issuer and the connection router from drifting apart.
- **Where it's used**: registered as `services.TryAddSingleton<IUserIdProvider, ClaimBasedUserIdProvider>()` in Infrastructure DI (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:310`); called by SignalR's connection manager on every server-initiated `Clients.User(...)`.

---

### IAuthUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:10` · Level 0 · interface

- **What it is**: the deliberately minimal credential and refresh-token surface an Identity module's `User` aggregate exposes to the shared [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) workflow. It is the contract that lets the framework's authentication plumbing read password material and rotate refresh tokens without knowing anything app-specific about the user (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:3-9`).
- **Depends on**: nothing first-party; the BCL only (`byte[]`, `DateTime`). Implemented by each app's `User` aggregate (see [User](group-24-identity-module.md#user)).
- **Concept introduced: the inverted user contract.** Rather than the shared auth workflow depending on a concrete `User` class, `User` implements a small interface the framework owns. Profile fields, roles, linked aggregates, and claim sources stay app-specific: the shared workflow reaches those only through per-app hooks (`CreateAccessToken`, `CreateUser`), never through this contract (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:5-8`). `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion, and this is a textbook case: the interface is exactly the credential surface and nothing more. `[Rubric §11, Security]` assesses credential and session handling, and here the password hash, its salt, and the refresh-token lifecycle are the entire contract, which makes the security-relevant surface of a `User` aggregate readable in one screen.
- **Walkthrough**: read the six members in two groups.
  - Password material: `byte[] PasswordHash` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:14`) and `byte[] PasswordSalt` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:17`), where the salt length is what selects the verify algorithm (see [PasswordHasher](#passwordhasher)). The scoped `#pragma warning disable CA1819` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:12`, restored on `:18`) knowingly returns arrays, to mirror [IPasswordHasher](#ipasswordhasher)'s `byte[]` shape and the EF-mapped `varbinary` columns rather than force a defensive copy on every read.
  - Refresh-token state: nullable `string? RefreshToken` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:21`) and `DateTime? RefreshTokenExpiry` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:24`), both null when the token was never issued or has been revoked. Two mutators carry the rotation and revocation rules: `UpdateRefreshToken(string refreshToken, DateTime expiry)` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:27`, BR-205) and `RevokeRefreshToken()` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:30`, BR-206/216). Note that the state is read-only through properties and changed only through the two methods: the aggregate keeps control of the transition.
- **Why it's built this way**: keeping the contract in Domain and keeping it small is what makes the shared auth workflow reusable across Store and ADC (both `User` aggregates implement it) while each aggregate stays free to model everything else its own way. See [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) for the dual-fetch/JWKS auth model this contract feeds and [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) for the password-material policy.
- **Where it's used**: it is the generic constraint on the shared login/refresh workflow, `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IAuthUser` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:41`), which calls `UpdateRefreshToken` on issue and rotation (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:168`, `:298`) and `RevokeRefreshToken` on logout and revocation (`:261`, `:282`). It is also the base of [IPasswordChangeableUser](#ipasswordchangeableuser).

---

### IJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` · Level 0 · interface

- **What it is**: the abstraction that returns the active `JsonWebKeySet` served at `/.well-known/jwks.json`. Implementations materialize the public signing key(s) in the JWK format that other services consume to validate access tokens (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:5-10`).
- **Depends on**: `Microsoft.IdentityModel.Tokens.JsonWebKeySet` (NuGet). Implemented by [RsaJwksProvider](#rsajwksprovider); configured by [JwksSettings](group-14-module-system-composition.md#jwkssettings) and served by [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).
- **Concept introduced: publishing a public key instead of sharing a secret.** `[Rubric §11, Security]` assesses key management and blast radius, and `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a rewrite. In an extracted-service topology, symmetric HS256 would require every service to hold the same secret, so any one compromised service can mint tokens for all of them. The asymmetric alternative ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) keeps the RSA private key inside the Identity service and publishes only the public key at a well-known URL; peers fetch it and validate signatures without ever being able to sign. `IJwksProvider` is how the Identity API obtains that public key set to serve.
- **Walkthrough**: a single synchronous member, `JsonWebKeySet GetJsonWebKeySet()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:19`). Synchronous is the deliberate shape because key material is resolved once and cached in-process by the implementation. The doc comment sets a contract that the implementation must honor: return an **empty** key set rather than throwing when no signing key is configured (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:13-18`), so `/.well-known/jwks.json` stays a valid, pollable URL even in a host where JWKS publishing is off.
- **Why it's built this way**: an interface here lets tests inject a pre-built key set with no file I/O, and the empty-set contract makes the endpoint safe to map unconditionally instead of behind a feature check.
- **Where it's used**: registered as `services.TryAddSingleton<IJwksProvider, RsaJwksProvider>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:141`) next to the `JwksSettings` options binding (`:137-140`); the JWKS minimal-API endpoint calls it, and consuming services fetch the resulting document through `AddForwardedJwtBearer` at startup.

---

### LoginProtectionSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` · Level 0 · class

- **What it is**: strongly typed, `[Range]`-validated configuration for brute-force login lockout and registration rate limiting, bound from the `LoginProtection` configuration section (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:5-8`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]` (BCL). Consumed by [LoginProtectionService](#loginprotectionservice) through `IOptions<LoginProtectionSettings>`.
- **Concept**: `[Rubric §11, Security]` assesses whether brute-force defenses exist and are tunable, and this settings class is where the policy numbers live rather than being hard-coded into a handler. `[Rubric §16, Maintainability]` also applies in a small way: five `init`-only properties with defaults mean an app that configures nothing still gets a safe policy, and an app that configures one value inherits the rest.
- **Walkthrough**: `const string SectionName = "LoginProtection"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:12`) names the bound section. Two concerns follow.
  - Account lockout: `MaxFailedAttempts` (default 5, `[Range(1, 100)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:17-18`), `MaxLockoutSeconds` (default 300, `[Range(1, 3600)]`, `:23-24`), `FailedAttemptWindowMinutes` (default 30, `[Range(1, 1440)]`, `:30-31`). The window comment (`:27-28`) is load-bearing for understanding the service: the attempt counter resets by cache expiration, not by a sweep job.
  - Registration rate limiting: `MaxRegistrationsPerIpPerHour` (default 10, `[Range(1, 10000)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:36-37`) and `RegistrationRateLimitWindowMinutes` (default 60, `[Range(1, 1440)]`, `:42-43`).
- **Why it's built this way**: `sealed` with `init`-only properties gives an immutable options object. Every property carries a `[Range]`, and the registration wires `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:126-129`), so an obviously unsafe value such as `MaxFailedAttempts = 0` fails the host at startup instead of quietly disabling lockout until someone notices in production. The `MaxLockoutSeconds` upper bound of 3600 is also what lets [LoginProtectionService](#loginprotectionservice) reason about its shift-clamp safely.
- **Where it's used**: bound and validated in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:126-129`) immediately before [LoginProtectionService](#loginprotectionservice) is registered (`:130`).

---

### PasswordHasher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12` · Level 1 · class

- **What it is**: the [IPasswordHasher](#ipasswordhasher) implementation. It hashes new passwords with PBKDF2-HMAC-SHA512 at 600,000 iterations (OWASP 2023 guidance) and verifies against both the current PBKDF2 format and a legacy HMAC-SHA512 format, choosing the algorithm from the stored salt length (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:7-11`).
- **Depends on**: [IPasswordHasher](#ipasswordhasher) (the Application port, imported on `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:3`); `System.Security.Cryptography` (`Rfc2898DeriveBytes`, `RandomNumberGenerator`, `HMACSHA512`, `CryptographicOperations`) and `System.Text.Encoding` (BCL).
- **Concept introduced: password hashing with a salt-length-encoded algorithm selector.** `[Rubric §11, Security]` assesses credential-at-rest protection, and this type is the clearest expression of it in the framework. Three deliberate choices are visible in source: a work factor high enough to make offline brute force expensive (`Iterations = 600_000`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:24`), constant-time comparison to defeat timing side channels (`:56-58`), and a migration path that upgrades old hashes without adding a flag column. The salt-length trick is the teaching point: a PBKDF2 salt is 32 bytes (`SaltSize`, `:15`) while a legacy HMAC-SHA512 salt is the 128-byte HMAC key (`LegacyHmacSaltSize`, `:27`), so the stored salt itself records which algorithm produced the hash. No schema change, no ambiguity, and no way for the two formats to be confused.
- **Walkthrough**
  - Constants first: `SaltSize = 32` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:15`), `HashSize = 64` (512 bits, `:18`), `Iterations = 600_000` (`:24`), `LegacyHmacSaltSize = 128` (`:27`).
  - `HashPassword(string password)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:30`): guards blank input with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:32`), draws a fresh 32-byte salt from `RandomNumberGenerator.GetBytes` (`:34`, a CSPRNG rather than `Random`), derives the hash via `Rfc2898DeriveBytes.Pbkdf2` with SHA512 (`:35-40`), and returns the `(Hash, Salt)` tuple (`:42`). New passwords are always PBKDF2: nothing writes the legacy format.
  - `VerifyPassword(string password, byte[] hash, byte[] salt)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:46`): null-guards all three arguments (`:48-50`), selects the algorithm by `salt.Length == LegacyHmacSaltSize` (`:52-54`), and compares with `CryptographicOperations.FixedTimeEquals` (`:58`) so the comparison always walks the full length regardless of where the first difference occurs. Note the PBKDF2 branch derives `hash.Length` bytes rather than `HashSize` (`:54`), so a stored hash of a different length still verifies.
  - `ComputePbkdf2Hash` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:62`) and `ComputeLegacyHash` (`:71`, `using var hmac = new HMACSHA512(salt)`) are the two private algorithm bodies.
- **Why it's built this way**: verification stays backward-compatible with pre-existing HMAC hashes so a deployment can migrate lazily, while every write is PBKDF2, so the stored population converges on the strong format as users log in and change passwords, with no data migration and no downtime. `FixedTimeEquals` and the 600k iteration count are the concrete OWASP-aligned defenses; [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) records the policy.
- **Where it's used**: registered `services.TryAddSingleton<IPasswordHasher, PasswordHasher>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:224`); called by the shared change-password workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:55` verify, `:61` re-hash) and by each Identity module's register and login handlers, against the `PasswordHash`/`PasswordSalt` exposed by [IAuthUser](#iauthuser).

---

### RsaJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15` · Level 1 · class

- **What it is**: the production [IJwksProvider](#ijwksprovider). It builds a `JsonWebKeySet` from a PEM-encoded RSA public key configured via [JwksSettings](group-14-module-system-composition.md#jwkssettings), and returns an empty set when publishing is disabled (the default) or no key is configured (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:8-13`).
- **Depends on**: [IJwksProvider](#ijwksprovider); [JwksSettings](group-14-module-system-composition.md#jwkssettings) via `IOptions<JwksSettings>`; `System.Security.Cryptography.RSA` and `Microsoft.IdentityModel.Tokens` (`JsonWebKeySet`, `RsaSecurityKey`, `JsonWebKeyConverter`, `SecurityAlgorithms`).
- **Concept**: this reinforces the JWKS story introduced on [IJwksProvider](#ijwksprovider) (`[Rubric §11, Security]`, `[Rubric §7, Microservices Readiness]`, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) and adds one lesson of its own about caching failure. The PEM parse cost is paid once and memoized in a `Lazy<JsonWebKeySet>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:22-23`), but the mode is `LazyThreadSafetyMode.PublicationOnly`, not the default `ExecutionAndPublication`. The comment above it (`:17-21`) explains why, and it is worth internalizing: the default `Lazy<T>` caches a factory **exception** forever, so a single transient IO failure reading the PEM file would brick `/.well-known/jwks.json` (and with it cross-service auth) until the process restarts. `PublicationOnly` caches only a successful result and lets a later call retry; concurrent factory runs are harmless here because `BuildKeySet` is pure and disposes its own `RSA`. That is `[Rubric §29, Resilience]` reasoning applied to one field declaration.
- **Walkthrough**
  - Primary constructor takes `IOptions<JwksSettings> options` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15`) and the `Lazy<JsonWebKeySet>` captures it (`:22-23`); `GetJsonWebKeySet()` is just `_cachedKeySet.Value` (`:26`).
  - `BuildKeySet(JwksSettings settings)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:28`) short-circuits to an empty `JsonWebKeySet` when `!settings.Enabled` (`:30-33`) or when the resolved PEM is blank (`:36-39`). Those are the two paths that satisfy the [IJwksProvider](#ijwksprovider) never-throw contract.
  - With a key present it imports the PEM into a disposable `RSA` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:41-42`), exports **only** the public parameters (`ExportParameters(includePrivateParameters: false)`, `:44`) into an `RsaSecurityKey` tagged with the configured `KeyId` (`:46`), converts it with `JsonWebKeyConverter.ConvertFromRSASecurityKey` (`:49`), marks it `Use = "sig"` and `Alg = SecurityAlgorithms.RsaSha256` (`:50-51`) so consumers know the key's purpose and algorithm, and adds it to a fresh key set (`:53-55`).
  - `ResolvePem(JwksSettings settings)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:58`) prefers the inline `RsaPublicKeyPem` (`:60-63`) and otherwise reads `RsaPublicKeyPath` from disk with a synchronous `File.ReadAllText` (`:70`), justified in the comment because the read happens on the first request and its success is cached, while a failure is deliberately not cached (`:67-69`).
- **Why it's built this way**: exporting only the public parameters guarantees the private key can never reach the JWKS document even by accident. The inline-PEM-or-path pair supports both secrets-manager injection (env var or config) and a volume-mounted key file, which are the two deployment shapes the framework's samples use. `sealed`, and registered singleton (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:141`) so the cache is process-wide.
- **Where it's used**: the JWKS minimal-API endpoint calls `GetJsonWebKeySet()` per request; see [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).

---

### TokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:23` · Level 2 · class

- **What it is**: the JWT token service. It mints access tokens (user id, email, role, full name, plus optional extra claims), generates cryptographically random refresh tokens, exposes both token lifetimes, and validates expired tokens for the refresh flow. It supports both symmetric HS256 and asymmetric RS256 signing, selected once at construction (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:11-22`).
- **Depends on**: [ITokenService](#itokenservice); [IJwtSettings](group-14-module-system-composition.md#ijwtsettings); [JwtSigningAlgorithm](group-14-module-system-composition.md#jwtsigningalgorithm); `System.IdentityModel.Tokens.Jwt`, `Microsoft.IdentityModel.Tokens`, `System.Security.Cryptography`, and `TimeProvider` (BCL) for testable timestamps.
- **Concept introduced: dual-algorithm JWT issuance and an intentional lifetime bypass.** `[Rubric §11, Security]` assesses token issuance, refresh handling, and algorithm-confusion defense. Two security-critical choices are explicit in source. First, `GetPrincipalFromExpiredToken` sets `ValidateLifetime = false` on purpose (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:131`) under a scoped `#pragma warning disable CA5404` whose comment states the reason: the refresh flow must read claims out of an already-expired access token (`:130`). Second, validation pins the algorithm with `ValidAlgorithms = [_validationAlgorithm]` (`:136`) **and** re-checks the token header's `Alg` after validation succeeds (`:145-146`), which is the defense against the classic algorithm-substitution attack where an attacker takes the public RS256 key and uses it as an HS256 shared secret. `[Rubric §7, Microservices Readiness]` also applies: RS256 is the extracted-service mode ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)), where the issuer signs with its private key and publishes the public key via [RsaJwksProvider](#rsajwksprovider) so peers validate without a shared secret; HS256 is the monolith default.
- **Walkthrough**
  - Fields (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:25-34`): settings, `TimeProvider`, the `SigningCredentials`, the `SecurityKey` used for validation, the pinned algorithm string, and two nullable owned `RSA` handles. The comment on `:31-32` is the reason `Dispose` exists at all: the `RsaSecurityKey` wrappers hold weak references to those `RSA` objects, so someone must own them.
  - Constructor (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:47`): materializes signing and validation keys once. For `JwtSigningAlgorithm.RS256` it calls `BuildRsaCredentials` and pins `SecurityAlgorithms.RsaSha256` (`:53-58`); otherwise `BuildHmacCredentials` and `HmacSha256` (`:59-63`). `timeProvider` is optional and falls back to `TimeProvider.System` (`:51`) so tests can construct the service directly with a fake clock.
  - `GenerateAccessToken` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:67`): builds a seven-claim set of `sub`, `jti`, `iat`, the custom `user_id`, name, email, and role (`:76-85`), appends any caller-supplied claims (`:87-90`), and writes a `JwtSecurityToken` whose issuer, audience, `notBefore` and `expires` come from settings and the injected clock (`:92-100`). Both the `sub` and `user_id` claims are formatted with `CultureInfo.InvariantCulture` (`:78`, `:81`), which is the writer half of the contract that [CurrentUserService](#currentuserservice) reads back invariantly.
  - `GenerateRefreshToken` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:104`): 64 random bytes from `RandomNumberGenerator.GetBytes`, Base64-encoded (`:106-107`). It is an opaque bearer string, not a JWT: nothing is derived from it, it is only compared against the stored value.
  - `AccessTokenLifetime` and `RefreshTokenLifetime` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:111`, `:114`) project the configured minutes and days as `TimeSpan`s so callers such as the shared auth workflow compute expiry without re-reading settings.
  - `GetPrincipalFromExpiredToken` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:123`): validates issuer, audience, signing key and algorithm but not lifetime (`:125-137`), then applies the post-validation `Alg` re-check (`:145-149`). Any exception is swallowed and returns `null` (`:153-156`), so a malformed or forged token produces a plain "no principal" answer rather than leaking a parser exception to the caller.
  - `Dispose` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:160`): releases both owned `RSA` handles.
  - `BuildHmacCredentials` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:166`) throws `InvalidOperationException` when `SecretForKey` is missing (`:168-172`) and Base64-decodes it into a `SymmetricSecurityKey` (`:175`). `BuildRsaCredentials` (`:180`) throws when `RsaPrivateKeyPem` is missing (`:183-187`), imports the private key, and then resolves a validation key: the configured `RsaPublicKeyPem` when present, otherwise the public parameters derived from the private key (`:196-210`), so an issuer configured with only a private key can still self-validate its own tokens during refresh. Both nested `try`/`catch` blocks dispose the partially-created `RSA` before rethrowing (`:215-225`), so a bad PEM does not leak a native key handle. Missing key material therefore fails at construction, meaning at host startup, not on the first login.
- **Why it's built this way**: see [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) for the RS256 rationale. The DI lifetime is worth reading in full at the registration site (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:217-223`): the service is `TryAddSingleton` because a scoped lifetime disposed the underlying `RSA` at end-of-request while `Microsoft.IdentityModel.Tokens`' static `CryptoProviderCache` still held the cached `AsymmetricSignatureProvider` wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. Singleton is safe because the constructor depends only on the singleton `IJwtSettings` and the service is stateless afterwards.
- **Where it's used**: the shared [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) login/refresh flow and each Identity module's auth handlers. The `user_id` claim it emits is exactly what [CurrentUserService](#currentuserservice) and [ClaimBasedUserIdProvider](#claimbaseduseridprovider) read back.

---

### IPasswordChangeableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11` · Level 3 · interface

- **What it is**: the password-rotation surface an Identity module's `User` aggregate exposes to the shared [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) workflow. It is one method on top of [IAuthUser](#iauthuser) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:5-10`).
- **Depends on**: [IAuthUser](#iauthuser) (its base interface) and [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:1`).
- **Concept**: capability interfaces layered by workflow. `[Rubric §1, SOLID]` assesses interface segregation, and this is the pattern applied twice over: a `User` that only ever authenticates implements [IAuthUser](#iauthuser); a `User` whose app offers self-service password change implements this one and gets `PasswordHash`/`PasswordSalt` along with it, because the workflow must verify the current credential before writing the new one (the XML comment states exactly this reason, `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:8-9`). Inheritance here encodes a real dependency between capabilities rather than a taxonomy. `[Rubric §4, DDD]` also applies: the method returns [Result](group-01-result-error-handling.md#result), so the aggregate can refuse the change (an invariant failure) instead of the handler assuming success.
- **Walkthrough**: one member, `Result ChangePassword(byte[] newPasswordHash, byte[] newPasswordSalt)` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:19`). The aggregate receives already-hashed material, never a plaintext password: hashing is the handler's job via [IPasswordHasher](#ipasswordhasher), so no plaintext ever reaches the Domain layer or an EF change tracker.
- **Why it's built this way**: keeping the hash-and-salt pair as the parameter shape mirrors [IAuthUser](#iauthuser)'s two properties and [IPasswordHasher](#ipasswordhasher)'s tuple return, so the whole chain from handler to aggregate speaks one vocabulary. See [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html).
- **Where it's used**: as the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IPasswordChangeableUser` on the shared change-password workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:28`), which verifies the current password (`:55`), hashes the new one (`:61`), and calls `ChangePassword` with the result (`:62`).

---

### IUserPreferences
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:10` · Level 3 · interface

- **What it is**: the stored UI-preference surface an Identity module's `User` aggregate exposes to the shared preference read and write workflows: preferred culture, preferred theme, and a single method that replaces both (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:5-9`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:1`). Nothing else; it is deliberately not tied to [IAuthUser](#iauthuser), because preferences are orthogonal to credentials.
- **Concept**: null as "not chosen". `[Rubric §27, i18n]` assesses whether locale is a first-class, persisted user choice rather than a per-session guess, and `[Rubric §19, State Management]` assesses where such UI state lives. Both properties are nullable, and the contract states that `null` means the user has not chosen that preference (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:7-8`), which is what lets the UI fall back to a browser or host default without needing a separate "is set" flag. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the culture model and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) for the theme model.
- **Walkthrough**: `string? PreferredCulture` (for example `"es"`, `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:13`) and `string? PreferredTheme` (`"light"`/`"dark"`, `:16`) are read-only. `Result UpdatePreferences(string? preferredCulture, string? preferredTheme)` (`:25`) replaces **both** at once. The subtlety is documented on `:18-21`: because the method is a whole-object replace, the shared workflow always passes the currently stored value for any field the request left `null`, so writing one preference never silently clears the other. You can see that read-then-merge in the caller: `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53-55`).
- **Why it's built this way**: one replace method keeps the aggregate's invariant check in a single place, and pushing the merge into the workflow keeps the null-means-unchanged policy out of every app's `User`. Returning [Result](group-01-result-error-handling.md#result) lets the aggregate reject an unsupported culture or theme value.
- **Where it's used**: the read workflow constrains `where TUser : AuditableBaseEntity<UserIdentifierType>, IUserPreferences` and projects both properties into a response (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:23`, `:44`); the write workflow constrains `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IUserPreferences` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:26`). Both are cross-linked as [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser) and [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand).

---

### IErasableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30` · Level 4 · interface

- **What it is**: the erasure surface an Identity module's `User` aggregate exposes to the shared [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) workflow: soft-delete the row, then irreversibly anonymize the personal data it still holds (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:6-10`).
- **Depends on**: [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) (its base, contributing `Result Anonymize()`) and [Result](group-01-result-error-handling.md#result) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:1-2`).
- **Concept introduced: why a `Delete()` that already exists on the base entity is redeclared here.** This is the most instructive comment in the file and it is worth reading in full (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:11-29`). [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) already has a `Delete()`. But an app's `User` may **hide** it (`public new Result Delete()`) to couple account-specific behavior to deletion, typically revoking the refresh token so outstanding sessions die immediately. A hidden method is not an override. C# member lookup on a generic type parameter prefers the members of its **class** constraint, so a shared workflow writing `user.Delete()` would bind to the base implementation and silently skip the app's version. Redeclaring `Delete()` on this interface and invoking it **through the interface** forces interface dispatch, which resolves to the most derived member the app type maps onto `IErasableUser`. `[Rubric §1, SOLID]` (Liskov: the hidden method is exactly the substitutability hazard this closes) and `[Rubric §15, Best Practices]` both apply, and this is a case where the language rule, not a style preference, dictates the design. The second paragraph (`:25-28`) adds the compile-time guarantee: the base entity deliberately does **not** implement this interface, so a consumer that forgets to declare it fails the generic constraint at compile time rather than losing behavior at run time.
- **Walkthrough**: one declared member, `Result Delete()` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:37`), documented as soft-delete plus whatever the app couples to deletion (`:32-35`), returning a failure when the account is already deleted (`:36`). Inherited from [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) is `Result Anonymize()` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:30`), which must be idempotent (`:26-27`). The two-step order is visible in the caller: cast once to the interface (`IErasableUser erasable = user;`, `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:88`), `erasable.Delete()` first (`:89`), the app's own tail hook next (`:96`), then `erasable.Anonymize()` (`:103`), each short-circuiting on failure.
- **Why it's built this way**: soft-delete alone hides a row but retains its personal data, so it does not satisfy an erasure request; anonymize-in-place overwrites the personal fields while keeping the row so foreign keys and the audit trail survive ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), and `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:10-20`). Splitting the two into separate members lets the workflow run app-specific work between them. `[Rubric §30, Compliance and Data Governance]` assesses exactly this: a GDPR/CCPA erasure path that does not destroy referential integrity.
- **Where it's used**: the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IErasableUser` on the shared delete-user workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:41`), implemented by each app's [User](group-24-identity-module.md#user) aggregate.

---

### LoginProtectionService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19` · Level 5 · class

- **What it is**: the cache-backed brute-force and rate-limiting service: exponential-backoff account lockout after repeated login failures, plus a per-IP registration rate limit (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:9-18`).
- **Depends on**: [ILoginProtectionService](#iloginprotectionservice) (the Application port); [LoginProtectionSettings](#loginprotectionsettings) via `IOptions<>`; [ICacheService](group-09-caching.md#icacheservice); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); and the [Email](group-02-domain-building-blocks.md#email) value object, used purely as a normalizer.
- **Concept introduced: counter keys must be normalized the same way the lookup is.** `[Rubric §11, Security]` assesses brute-force protection and rate limiting; `[Rubric §10, Cross-Cutting]` assesses whether it is one shared service rather than logic copied per endpoint. Two mechanisms in this file deserve close reading.
  - **Key normalization** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:25-43`): `NormalizeIdentity` runs the supplied address through [Email](group-02-domain-building-blocks.md#email)`.Create` and uses the normalized value (`:39-41`). Without it, the counter keys are built from raw request input while the user lookup runs against the normalized value object, so `User@x.com`, `user@x.com` and `" user@x.com "` resolve to one account but get **independent** attempt counters, and an attacker defeats the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) backoff just by varying capitalization. A malformed address (which never matches a user but still increments a counter) falls back to the same trim-and-lowercase shape (`:41`) so its attempts collapse onto one key too. The `#pragma warning disable CA1308` (`:40`) is scoped and justified: lowercase is the RFC 5321 normalization `Email` itself performs.
  - **The lockout curve** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:80-89`): `excessAttempts = newCount - MaxFailedAttempts` (`:82`) drives `lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), MaxLockoutSeconds)` (`:88`), doubling the lockout per excess failure (1s, 2s, 4s, and so on) up to the configured cap. The inner `Math.Min(excessAttempts, 30)` clamps the shift exponent, and the comment explains why (`:84-87`): C# masks an `int` shift count to five bits, so `1 << 31` is negative and `1 << 32` wraps back to `1`, which would silently shrink the lockout for a sufficiently persistent attacker. Since `1 << 30` already exceeds the `[Range(1, 3600)]` cap on [LoginProtectionSettings](#loginprotectionsettings)`.MaxLockoutSeconds`, deep excess always lands on the cap.
- **Walkthrough**
  - Key builders: `LockoutKey` -> `login:lockout:{normalized}` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:45`), `AttemptsKey` -> `login:attempts:{normalized}` (`:47`), `RegistrationKey` -> `registration:ip:{ipAddress}` (`:136`).
  - `CheckLockoutAsync(string email, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:50`): reads the boolean lockout key (`:53`) and returns `Error.Unauthorized("Auth.TooManyAttempts", ...)` when set, otherwise `Result.Success()` (`:55-60`). A cache miss is treated as not locked out (`?? false`), so a cache outage fails open on lockout rather than locking everyone out.
  - `IncrementFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:64`): increments the attempts key with the `FailedAttemptWindowMinutes` TTL (`:75-78`), and once the count reaches `MaxFailedAttempts` writes the lockout key with the exponential TTL (`:80-90`).
  - `ResetFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:94`): removes both keys on a successful login (`:96-97`).
  - `CheckRegistrationRateLimitAsync(string? ipAddress, ...)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:101`): a null or empty IP is unrestricted (`:103-106`); otherwise it compares the per-IP count against `MaxRegistrationsPerIpPerHour` and fails with `Auth.RegistrationRateLimitExceeded` (`:111-116`).
  - `IncrementRegistrationCountAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:120`): no-ops on a missing IP (`:122-125`) and otherwise increments the per-IP counter with the `RegistrationRateLimitWindowMinutes` TTL (`:130-133`). The comment (`:127-129`) notes the TTL is refreshed on every write, so the window slides rather than staying anchored to the first registration, which only ever tightens the limit.
- **Why it's built this way**: reusing [ICacheService](group-09-caching.md#icacheservice) (Redis in production, in-memory fallback) instead of a bespoke store keeps the service thin and lets counters expire naturally by TTL rather than needing a sweep job; `IOptions<>` keeps every threshold configurable per environment. Registered scoped (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:130`).
- **Caveats / not-in-source**: the increment is documented in source as **not atomic** on the distributed cache today (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:66-74`). [DistributedCacheService](group-09-caching.md#distributedcacheservice)`.IncrementAsync` is a read-modify-write, because the Redis `INCR` it used to issue wrote a plain string key while `IDistributedCache` reads entries back as hashes, and the mismatch made the counter unreadable (`WRONGTYPE`). The accepted cost: genuinely parallel attempts can overwrite each other's increments, so a concurrent burst can stay under `MaxFailedAttempts`. Sequential guessing, which is what a credential-stuffing run against one account looks like, still trips the lockout. The comment names the two ways to close the gap (a Lua script that increments within the hash layout, or moving counters off `IDistributedCache`); neither is implemented today.

---

### CurrentUserService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:13` · Level 9 · class

- **What it is**: the scoped, per-request implementation of [ICurrentUserService](#icurrentuserservice). It extracts the current user's id, role, principal, and arbitrary typed claims from the JWT in the HTTP context (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:8-12`).
- **Depends on**: [ICurrentUserService](#icurrentuserservice); `Microsoft.AspNetCore.Http.IHttpContextAccessor`, `System.Security.Claims`, and `System.Globalization` (BCL). The `user_id` claim it reads is emitted by [TokenService](#tokenservice).
- **Concept introduced: scoped claim extraction with lazy per-request caching, parsed invariantly.** `[Rubric §11, Security]` assesses correct claim extraction, `[Rubric §12, Performance]` the cost of doing it repeatedly, and `[Rubric §27, i18n]` the culture trap. The service is registered scoped (one instance per request, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:216`) and wraps `_userId` and `_role` in `Lazy<T>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:18`, `:26`), so `HttpContext.User` is walked at most once per request no matter how many handlers, filters, and `SaveChangesAsync` calls ask. The i18n point is the one most codebases get wrong: claims are machine-written by [TokenService](#tokenservice) under `CultureInfo.InvariantCulture`, so they must be **read** invariantly too. Both `int.TryParse` for the user id (`:23`) and `T.TryParse` for generic claims (`:45`) pass `CultureInfo.InvariantCulture` explicitly, with comments explaining that parsing under the ambient request culture misreads separators for decimal, double and `DateTime` claim types (`:21-22`, `:43-44`). Reading the custom `user_id` claim type (`:16`) rather than the standard `sub` keeps the claim contract with [TokenService](#tokenservice) explicit.
- **Walkthrough**
  - Primary constructor takes `IHttpContextAccessor httpContextAccessor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:13`), captured directly by the lazy initializers.
  - `User` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:30`): returns the `ClaimsPrincipal`, or a fresh empty one when there is no HTTP context, so background jobs and hosted services resolving the same interface get an anonymous principal instead of a `NullReferenceException`.
  - `UserId` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:33`): `_userId.Value`, a `UserIdentifierType?` produced by the lazy on `:18-24`; `null` when the claim is absent or not an invariant integer.
  - `Role` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:36`): `_role.Value`, the `ClaimTypes.Role` claim read on `:26-27`.
  - `GetClaimValue<T>(string claimType)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:39-46`): generic over `T : struct, IParsable<T>`, using the static-abstract `T.TryParse` so any parsable value type (`int`, `Guid`, `DateTime`, and so on) can be read from a named claim, returning `null` when the claim is absent or unparseable. This is not cached: it is a fresh lookup per call, unlike `UserId` and `Role`.
- **Why it's built this way**: scoped lifetime plus `Lazy<T>` gives a stable per-request snapshot at minimal cost, and the empty-principal fallback makes the service safe to resolve outside a request pipeline. Keeping the parse culture invariant on both sides of the token is what stops a Spanish or German request culture from silently failing to read a claim the issuer wrote.
- **Where it's used**: injected into command handlers and controllers throughout both apps for ownership checks, and into `ApplicationDbContext.SaveChangesAsync` to supply the acting user id for audit-field stamping.

### AuthClaimTypes
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:7` · Level 0 · class (static)

- **What it is**: a one-constant holder for the framework's custom JWT claim type names, sitting
  alongside the standard `System.Security.Claims.ClaimTypes` values
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:3-7`).
- **Depends on**: nothing first-party at runtime; the doc comment points at
  [`IPermissionRegistry`](#ipermissionregistry) for the role-derived half of the model.
- **Concept introduced, custom claim types for capability-based authorization.** `[Rubric §11,
  Security]` assesses how authentication and authorization are modeled and what facts a principal
  carries. The standard `ClaimTypes` set covers identity (name, email, role); this framework layers
  *permissions* (fine-grained capabilities) on top. `AuthClaimTypes.Permission`
  (`AuthClaimTypes.cs:15`, value `"permission"`) is the claim type a token uses to carry a single
  granted capability. The load-bearing design note is in the doc comment (`AuthClaimTypes.cs:9-14`):
  permission claims are honored **in addition to** the permissions a role confers through
  [`IPermissionRegistry`](#ipermissionregistry), and baking them into the token is explicitly
  *optional*, because role-derived permissions work without them. So a token can stay small (roles
  only) and still authorize against capabilities, which is what makes the model in
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) backward
  compatible with the pre-existing role policies.
- **Walkthrough**: a single `public const string Permission = "permission"` (`AuthClaimTypes.cs:15`).
  `const` (not `static readonly`) so the value is usable in attribute arguments and in patterns that
  require compile-time constants, the same reason [`RoleNames`](#rolenames) and
  [`AuthorizationPolicies`](#authorizationpolicies) use `const`.
- **Why it's built this way**:
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) makes the
  permission layer opt-in. Keeping the claim type as one shared constant means the writer (a token
  service that chooses to embed capabilities) and the reader (the authorization handler) cannot drift
  apart on the string.
- **Where it's used**: read by
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler), which first checks
  `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` before falling back to
  the registry
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:29-30`),
  and described (without being named) in the [`HasPermissionAttribute`](#haspermissionattribute) doc
  comment as the "explicit permission claim" alternative to the role-derived path
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:6-10`).
- **Caveats / not-in-source**: no shipped token issuer in this repo writes a permission claim. Across
  both applications and the framework there are exactly four references to the constant
  (its declaration, the handler's doc comment, the handler's check, and one test), and the only
  writer in the tree is a test that hands the claim to a principal directly
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Authorization/PermissionAuthorizationHandlerTests.cs:30`).
  The claim path is real and covered, but every deployed grant today flows through roles.

### AuthenticationResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10` · Level 0 · record struct (readonly)

- **What it is**: the success payload of authentication, carrying `AccessToken`, `RefreshToken`, and
  `AccessTokenExpiry`, shared by the Identity API and the UI clients
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthenticationResponse.cs:3-13`).
- **Depends on**: nothing first-party; `System.DateTime` (BCL).
- **Concept introduced, the `readonly record struct` DTO.** `[Rubric §15, Best Practices & Code
  Quality]` assesses consistent conventions and immutability, and `[Rubric §9, API & Contract Design]`
  assesses well-shaped request/response contracts. A positional **`record struct`** is a value type
  with a compiler-generated constructor, deconstruction, value equality, and `ToString`; `readonly`
  makes every field immutable. For small, short-lived request/response carriers this avoids a heap
  allocation while staying immutable, and it is this codebase's default shape for auth DTOs, reused by
  every sibling below. The explicit `AccessTokenExpiry` (`AuthenticationResponse.cs:13`) lets clients
  refresh proactively instead of waiting for a 401, which is the client-side half of
  [ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html).
- **Walkthrough**: three positional parameters and no body (`AuthenticationResponse.cs:10-13`).
- **Why it's built this way**: value semantics keep the type cheap, but they have one consequence
  worth internalizing before you reuse the shape. A struct has no null, so a cache miss returns
  `default(AuthenticationResponse)` rather than `null`, and
  [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) therefore detects a
  missing exchange entry by testing `string.IsNullOrEmpty(response.AccessToken)`, with the reason
  written down at the call site
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:149-155`).
- **Where it's used**: produced by
  [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) at the end of registration
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:211-214`) and
  from the shared `IssueTokensAsync` helper that login, refresh, and app-level external-login flows
  all funnel through (`AuthenticationServiceBase.cs:292,302-305`); declared as the 200/201 response
  type on the three [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase)
  endpoints
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:56,77,97`);
  consumed by [`AuthUIService`](group-15-common-ui-framework.md#authuiservice),
  [`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher), and
  [`CookieSessionRefresher`](#cookiesessionrefresher).

### ChangePasswordRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePasswordRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: `(string CurrentPassword, string NewPassword)`, the payload for an authenticated
  password change (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePasswordRequest.cs:3-10`).
- **Depends on**: nothing first-party.
- **Concept**: the same `readonly record struct` DTO shape introduced by
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §11, Security]`: requiring the current
  password re-proves the caller's identity before a credential change, so a stolen session alone
  cannot lock the owner out. The strength rules for `NewPassword` are deliberately *not* here; they
  live in each app's validator (see
  [`ChangePasswordRequestValidator`](group-24-identity-module.md#changepasswordrequestvalidator)),
  which is what lets Store and ADC differ on policy while sharing the contract.
- **Walkthrough**: two positional parameters (`ChangePasswordRequest.cs:8-10`); no body.
- **Where it's used**: bound as the body of the shared `PUT change-password` endpoint on
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:100`),
  carried by each app's [`ChangePasswordCommand`](group-24-identity-module.md#changepasswordcommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs`
  and its Store twin), and validated by ADC's
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11`,
  which requires a non-empty `CurrentPassword` (`:15-16`) and applies the shared
  `StrongPasswordRules` to `NewPassword` (`:18`).
- **Caveats / not-in-source**: nothing in this type prevents the password strings from reaching a log.
  That is an operational convention (PII masking plus the "never log the body" habit), not a
  compile-time or runtime guarantee.

### ChangePreferencesRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:10` · Level 0 · record (sealed)

- **What it is**: `(string? Culture, string? Theme)`, the payload for updating the signed-in user's
  stored UI preferences
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:3-10`).
- **Depends on**: nothing first-party. It is the write-side counterpart of
  [`UserPreferencesResponse`](#userpreferencesresponse).
- **Concept introduced, null-means-unchanged partial update.** `[Rubric §9, API & Contract Design]`
  assesses how a contract expresses partial intent, and `[Rubric §19, State Management]` assesses
  where user state lives and who may overwrite it. A naive "PUT the whole preferences object" endpoint
  has a real bug hiding in it: the app-bar language switcher knows only the culture and the theme
  toggle knows only the theme, so whichever fires last would send `null` for the other field and
  silently erase the user's other choice. The doc comment states the rule that removes the bug
  (`ChangePreferencesRequest.cs:3-6`): a `null` field leaves that preference unchanged, so each
  control can persist its own field in isolation. The rule is honored in exactly one place, the
  shared handler's `command.Request.Culture ?? user.PreferredCulture` /
  `command.Request.Theme ?? user.PreferredTheme` coalesce
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53-55`),
  which is why the contract can afford to be this terse. The two preferences themselves come from
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (culture) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) (theme).
- **Walkthrough**: two nullable positional parameters on a `sealed record`
  (`ChangePreferencesRequest.cs:10`); no body. Unlike the auth siblings this is a reference type
  (`record`, not `record struct`), which matters at the boundary: the controller binds it with
  `[FromBody]`, so a completely absent body deserializes to `null` rather than to a silently valid
  all-defaults struct.
- **Why it's built this way**: the payload record was byte-identical in both applications' Identity
  modules and was hoisted here, while the *command* record stayed app-side because ADC marks it
  `ICacheInvalidating` and Store does not. That split is spelled out in the handler base's remarks
  (`ChangePreferencesHandlerBase.cs:16-20`), and it is a good illustration of the framework's hoisting
  rule: share the shape, leave the per-app policy behind.
- **Where it's used**: the body of the shared `PUT auth/preferences` endpoint
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:112-119`),
  which hands it to the app's command through the abstract `CreateChangePreferencesCommand` factory
  (`UserAccountAuthControllerBase.cs:77-79,125-127`); the generic constraint that ties the two together
  is `where TChangePreferencesCommand : IUserScopedCommand<ChangePreferencesRequest>`
  (`UserAccountAuthControllerBase.cs:48`). It is consumed by
  [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand)
  and carried by each app's
  [`ChangePreferencesCommand`](group-24-identity-module.md#changepreferencescommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14-15`).
- **Caveats / not-in-source**: this type validates nothing. Rejecting an unknown culture such as
  `"xx"` or an unknown theme such as `"blue"` is the domain's job, inside `UpdatePreferences` on the
  `User` aggregate behind [`IUserPreferences`](#iuserpreferences)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:25`), which returns a
  [`Result`](group-01-result-error-handling.md#result) the handler propagates. Note also that the
  Blazor UI does **not** send this exact type: `ApiUserPreferenceWriter` declares its own private
  `UserPreferencesRequest(string? Culture, string? Theme)` wire record
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:29,64-65`), so
  the two shapes agree by convention rather than by a shared reference.

### IcsEvent
> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15` · Level 0 · record (sealed)

- **What it is**: one calendar entry consumed by [`IcsCalendarBuilder`](#icscalendarbuilder): a
  positional `sealed record` carrying a stable UID, a title, start and end instants, and optional
  description and location (`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15-21`).
- **Depends on**: nothing first-party; `System.DateTimeOffset` (BCL).
- **Concept introduced, UTC by contract.** `[Rubric §9, API & Contract Design]` assesses whether a
  contract is unambiguous about what the caller must supply. Unlike the auth siblings this is a
  `record` (reference type), not a `record struct`, because it carries optional members and travels as
  a collection. The load-bearing rule is in the doc comment (`IcsEvent.cs:3-8`): `StartsAtUtc` and
  `EndsAtUtc` are UTC by contract, so converting a wall-clock time in the event's IANA time zone to
  UTC is the *caller's* job. That single rule lets the builder emit `Z`-suffixed timestamps and skip
  RFC 5545's error-prone VTIMEZONE machinery entirely, and it pushes the one genuinely hard problem
  (daylight-saving transitions) to the one layer that knows the event's zone.
- **Walkthrough**: six positional parameters (`IcsEvent.cs:15-21`): `Uid` (globally unique and stable,
  which is how calendar apps de-duplicate a reimport instead of creating a second entry, documented at
  `IcsEvent.cs:9`), `Summary`, `StartsAtUtc`, `EndsAtUtc`, and the two nullable optionals
  `Description = null` and `Location = null` (`IcsEvent.cs:20-21`).
- **Where it's used**: passed as an `IReadOnlyCollection<IcsEvent>` to
  [`IcsCalendarBuilder`](#icscalendarbuilder)'s `Build`. In MMCA.ADC,
  [`CalendarExportMapper`](group-18-conference-application.md#calendarexportmapper) converts a session
  plus its event into one entry
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:31,37-43`),
  performing exactly the wall-clock-to-UTC conversion the contract demands in its own `ToUtc` helper,
  with the DST discipline written out (invalid spring-forward times shift ahead one hour, ambiguous
  fall-back times take the standard offset, `CalendarExportMapper.cs:47-56`).

### IPermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/IPermissionRegistry.cs:13` · Level 0 · interface

- **What it is**: the abstraction that maps roles to the fine-grained permissions they grant, and the
  single place that knows which roles confer which capabilities
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/IPermissionRegistry.cs:3-13`).
- **Depends on**: nothing first-party; its remarks reference [`RoleNames`](#rolenames) for the
  case-insensitivity rule.
- **Concept introduced, permission (capability) authorization over role checks.** `[Rubric §11,
  Security]` assesses the authorization model, and `[Rubric §1, SOLID]` assesses dependency inversion:
  endpoints depend on an abstraction, not on a role name. Instead of scattering `[Authorize(Roles =
  "Organizer")]` across endpoints, code authorizes against a *permission* (a capability such as
  `sessions:manage`) and this registry translates a principal's roles into the permissions they hold.
  The payoff is decoupling: adding a role or reshaping who-can-do-what is a registry change, not an
  edit to every endpoint (`IPermissionRegistry.cs:4-7`). The remarks also fix the comparison rules
  (`IPermissionRegistry.cs:9-12`): role lookups are case-insensitive, permission values are compared
  ordinally, and implementations are expected to be immutable and thread-safe. Those three sentences
  are what let the implementation be a frozen, lock-free structure.
- **Walkthrough**: two members. `GetPermissions(string role)` (`IPermissionRegistry.cs:20`) returns
  the permission set for a role, or an empty set for an unknown role, never a throw
  (`IPermissionRegistry.cs:15-17`). `HasPermission(IEnumerable<string> roles, string permission)`
  (`IPermissionRegistry.cs:28`) answers whether *any* of a principal's roles grants the permission:
  the hot path the authorization handler calls per request.
- **Why it's built this way**:
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) records the
  decision. An empty-set-on-miss contract keeps callers branchless, and pushing the who-grants-what
  knowledge behind one interface is the capability-security expression of the framework's habit of
  hiding decision logic behind an abstraction.
- **Where it's used**: implemented by [`PermissionRegistry`](#permissionregistry) (built via
  [`PermissionRegistryBuilder`](#permissionregistrybuilder)); registered as a lazily-built singleton by
  [`AuthorizationExtensions`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:78`) and
  injected into [`PermissionAuthorizationHandler`](#permissionauthorizationhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`).

### LoginRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/LoginRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: the email/password payload for authentication: `(string Email, string Password)`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/LoginRequest.cs:3-10`).
- **Depends on**: nothing first-party.
- **Concept**: the `readonly record struct` DTO introduced by
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §11, Security]`: the doc comment
  (`LoginRequest.cs:7`) records the rule that the password travels over TLS and is never logged. That
  convention is enforced operationally, not by this type, but the intent is documented at the source
  where a reader will meet it.
- **Walkthrough**: two positional parameters (`LoginRequest.cs:8-10`); no body.
- **Where it's used**: shape-validated by [`LoginRequestValidator`](#loginrequestvalidator)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs`), then
  handled by [`AuthenticationServiceBase<TUser>.LoginAsync`](#authenticationservicebasetuser)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:73`), which is
  reached through
  [`AuthControllerBase.LoginAsync`](group-12-api-hosting-mapping.md#authcontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:59-60`).

### OAuthCodeExchangeRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:11` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Code)` that exchanges a short-lived, single-use
  OAuth completion code for the token pair
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:3-12`).
- **Depends on**: nothing first-party.
- **Concept reinforced, security by construction.** `[Rubric §11, Security]` and `[Rubric §26,
  Front-End Security]` both assess safe token handling, in particular whether credentials can leak
  into places that are logged or replayed. The doc comment (`OAuthCodeExchangeRequest.cs:3-9`)
  explains *why* the indirection exists: the server mints an opaque code after the external-provider
  callback succeeds and carries *that* in the redirect URL, so the access and refresh tokens never
  appear in the address bar, browser history, the `Referer` header, or server access logs.
  [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) records the same
  reasoning as a decision, and
  [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)
  extends the pattern to the native mobile callback.
- **Walkthrough**: one positional `string Code` (`OAuthCodeExchangeRequest.cs:11-12`).
- **Why it's built this way**: the code is worthless once redeemed, which is the property that makes
  putting it in a URL acceptable.
  [`OAuthControllerBase.ExchangeAsync`](group-12-api-hosting-mapping.md#oauthcontrollerbase) rejects a
  blank code
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:142-145`),
  looks the code up in [`ICacheService`](group-09-caching.md#icacheservice)
  (`OAuthControllerBase.cs:151`), and then removes it so a replayed code cannot mint a second token
  pair (`OAuthControllerBase.cs:157-158`); an unknown, burned, or expired code all return the same
  HTTP 400 with a deliberately non-specific message (`OAuthControllerBase.cs:163-169`).
- **Where it's used**: the body of the OAuth `exchange` endpoint
  (`OAuthControllerBase.cs:135-140`), called by the UI's `/auth/oauth-complete` page after the
  provider redirect lands (`OAuthControllerBase.cs:125,128-131`).

### RefreshTokenRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RefreshTokenRequest.cs:9` · Level 0 · record struct (readonly)

- **What it is**: `(string AccessToken, string RefreshToken)`; it sends the *expired* access token
  alongside the refresh token so the server can read its claims without forcing a full
  re-authentication (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RefreshTokenRequest.cs:3-11`).
- **Depends on**: nothing first-party.
- **Concept**: the `readonly record struct` DTO shape from
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §11, Security]`: this is the request
  half of [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)'s
  rotation scheme. Carrying the expired token lets the server reconstruct the principal cheaply, while
  the opaque refresh token is what actually gates the rotation, so possession of an expired access
  token alone buys nothing.
- **Walkthrough**: two positional parameters (`RefreshTokenRequest.cs:9-11`); no body.
- **Where it's used**: shape-validated by
  [`RefreshTokenRequestValidator`](#refreshtokenrequestvalidator), handled by
  [`AuthenticationServiceBase<TUser>.RefreshTokenAsync`](#authenticationservicebasetuser)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:218`), which
  rejects an unreadable token or missing claims with an `Auth.InvalidToken` failure before it ever
  looks at the refresh token (`AuthenticationServiceBase.cs:233-241`); exposed by
  [`AuthControllerBase.RefreshAsync`](group-12-api-hosting-mapping.md#authcontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:99-100`).

### RoleNames
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:12` · Level 0 · class (static)

- **What it is**: the canonical role-name string constants shared across all layers and both
  applications (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:3-12`).
- **Depends on**: nothing first-party.
- **Concept introduced, centralized constants over magic strings.** `[Rubric §11, Security]` assesses
  authorization correctness and `[Rubric §16, Maintainability]` assesses duplication and single points
  of change. Roles are stored as plain strings and emitted as JWT claims (`RoleNames.cs:8`), so a typo
  in a literal does not fail to compile: it silently fails to authorize, or worse, silently authorizes
  nobody while looking correct. Referencing `RoleNames.Organizer` instead of `"Organizer"` moves that
  class of bug to compile time. The remarks also record that role comparisons should be
  **case-insensitive** (`RoleNames.cs:10`, pointing at
  [`ICurrentUserService`](#icurrentuserservice)`.IsInRole`), which is the same equality contract
  [`RoleValue`](#rolevalue) and [`PermissionRegistry`](#permissionregistry) implement.
- **Walkthrough**: five `public const string` fields. `Organizer` (`RoleNames.cs:15`), `Attendee`
  (`RoleNames.cs:18`), and `ContentEditor` (`RoleNames.cs:25`) are ADC roles; `Admin`
  (`RoleNames.cs:28`) and `Customer` (`RoleNames.cs:31`) are Store roles. `ContentEditor` is
  documented as a strict subset of the Organizer's capabilities (`RoleNames.cs:20-24`): it curates the
  session catalog without rights over event structure, rooms, questions, session selection, or user
  administration. That subset is precisely the case
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) uses to
  justify the permission layer, and you can see the payoff in ADC's grants, where Organizer and Admin
  each receive the module's whole permission set while ContentEditor receives only the
  content-management slice, one extra line rather than an edit to every attribute
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44,50`).
- **Why it's built this way**: `const` rather than `static readonly` so the values can appear in
  attribute arguments such as `[Authorize(Roles = RoleNames.Organizer)]`, which require compile-time
  constants. Keeping both apps' roles in one shared file is a deliberate trade: a small amount of
  irrelevance for each consumer in exchange for one authoritative list.
- **Where it's used**: the named role policies in
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:24-32`),
  the per-app role types ([`UserRole`](group-24-identity-module.md#userrole);
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:20-30` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserRole.cs:17-20`), and each
  module's permission grants
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-50`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:53-54`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:46-47`).

### UserPreferencesResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/UserPreferencesResponse.cs:9` · Level 0 · record (sealed)

- **What it is**: `(string? Culture, string? Theme)`, the read side of the stored UI preferences: what
  the server hands back when a returning user signs in
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/UserPreferencesResponse.cs:3-9`).
- **Depends on**: nothing first-party. It is the exact mirror of
  [`ChangePreferencesRequest`](#changepreferencesrequest).
- **Concept**: the null-means-absent convention. Where the request's `null` means "leave unchanged",
  the response's `null` means the user has never chosen that preference
  (`UserPreferencesResponse.cs:4-5`). `[Rubric §9, API & Contract Design]` assesses whether the same
  wire shape can carry two different meanings without confusing the reader: here it can, because the
  two directions are separate types with separate doc comments rather than one reused DTO.
  `[Rubric §27, i18n]` and `[Rubric §20, Design System & Theming]` both apply, since this is the
  cross-device carrier for the culture and theme choices of
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html): the browser's own storage
  is per device, and this response is what makes the choice roam with the account.
- **Walkthrough**: two nullable positional parameters on a `sealed record`
  (`UserPreferencesResponse.cs:9`); no body. Being a `record` (not a `record struct`) it also carries
  value equality, which the tests lean on directly, asserting whole-object equality rather than
  field-by-field
  (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUserPreferencesHandlerTests.cs:46,60`).
- **Why it's built this way**: like its request twin, the response record was byte-identical in both
  applications' Identity modules and was hoisted into Shared, which is what let the read handler become
  a shared base generic only in the `User` aggregate rather than in the query and the response too
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:10-14`).
- **Where it's used**: produced by
  [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser)
  from the aggregate's `PreferredCulture`/`PreferredTheme`
  (`GetUserPreferencesHandlerBase.cs:44`), against a
  [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery); declared
  as the 200 response of the shared `GET auth/preferences` endpoint on
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:140-142`).
- **Caveats / not-in-source**: the handler reads through `GetReadRepository`, not the write repository,
  and the remarks note this was a deliberate correction of a disagreement between the two app copies
  (ADC read, Store write), so Store gained a no-tracking read on adoption
  (`GetUserPreferencesHandlerBase.cs:15-19,39`). As with the request twin, the Blazor client does not
  deserialize into this type: `ApiUserPreferenceReader` reads `auth/preferences` into its own UI-side
  `UserPreferences` record and falls back to an empty one for anonymous users or any error
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:18,39-42`).

### IcsCalendarBuilder
> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12` · Level 1 · class (static)

- **What it is**: a dependency-free RFC 5545 iCalendar writer for "add to calendar" exports, turning a
  product id and a collection of [`IcsEvent`](#icsevent)s into a complete `VCALENDAR` string
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:6-12`).
- **Depends on**: [`IcsEvent`](#icsevent); `System.Text.StringBuilder` and
  `System.Globalization.CultureInfo` (BCL).
- **Concept introduced, the deliberately minimal, deterministic protocol writer.** `[Rubric §15, Best
  Practices & Code Quality]` assesses focused, standards-correct implementations, and `[Rubric §32,
  Dependency & Supply-Chain]` assesses whether a dependency is worth its cost. Rather than pull in a
  full iCalendar package, the builder implements exactly the RFC 5545 subset every calendar app
  imports reliably: UTC-only timestamps (no VTIMEZONE), TEXT escaping, CRLF line endings, and 75-octet
  line folding (`IcsCalendarBuilder.cs:7-10`). It is also **deterministic**: the caller supplies
  `dtStamp` (`IcsCalendarBuilder.cs:21-22`), so identical inputs produce byte-identical output, which
  is what makes the export cacheable and lets a test assert on the exact document.
- **Walkthrough**: one public entry point and four private helpers, plus the `MaxLineOctets = 75`
  constant (`IcsCalendarBuilder.cs:14`).
  `Build(productId, events, dtStamp)` (`IcsCalendarBuilder.cs:22`) guards its inputs
  (`IcsCalendarBuilder.cs:24-25`), writes the calendar header (`BEGIN:VCALENDAR`, `VERSION:2.0`,
  `PRODID`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `IcsCalendarBuilder.cs:28-32`), appends each entry
  in the collection's own order, and closes the document (`IcsCalendarBuilder.cs:34-40`).
  `AppendEvent` (`IcsCalendarBuilder.cs:43`) writes a `VEVENT` block with `UID`, `DTSTAMP`, `DTSTART`,
  `DTEND`, and `SUMMARY` (`:45-50`), then `DESCRIPTION` and `LOCATION` only when non-blank
  (`IcsCalendarBuilder.cs:52-60`), so an absent optional produces no property line at all rather than
  an empty one. `FormatUtc` (`IcsCalendarBuilder.cs:65-66`) renders an instant through
  `instant.UtcDateTime` with the invariant culture, which is what turns the [`IcsEvent`](#icsevent)
  UTC-by-contract rule into a literal `Z`-suffixed timestamp. `EscapeText`
  (`IcsCalendarBuilder.cs:69-76`) applies RFC 5545 section 3.3.11 TEXT escaping, and the order
  matters: backslash is escaped first (`IcsCalendarBuilder.cs:71`) so the escapes it later introduces
  are not double-escaped, and all three newline forms collapse to a literal `\n` (`:74-76`). The
  subtlest helper is `AppendLine` (`IcsCalendarBuilder.cs:83`): it folds content lines at 75 octets of
  UTF-8, counting octets per character and treating a surrogate pair as one unit
  (`IcsCalendarBuilder.cs:89-90`) so a fold can never split a multi-byte character, and it charges the
  leading fold space against the continuation line's budget (`IcsCalendarBuilder.cs:94-95`).
- **Why it's built this way**: a static, allocation-light writer with no external dependency keeps
  `MMCA.Common.Shared` pure and therefore usable from Blazor WebAssembly, and pushing `dtStamp` to the
  caller is the single choice that makes the output deterministic and testable.
- **Where it's used**: MMCA.ADC's calendar exports:
  [`ExportSessionCalendarHandler`](group-18-conference-application.md#exportsessioncalendarhandler)
  for one session
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:59-62`)
  and [`ExportEventCalendarHandler`](group-18-conference-application.md#exporteventcalendarhandler)
  for a whole event
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:54,61`).
  Both pass ADC's single `PRODID` constant
  (`.../ExportCalendar/CalendarExportMapper.cs:17`).
- **Caveats / not-in-source**: both ADC call sites pass `DateTimeOffset.UtcNow` as `dtStamp`
  (`ExportSessionCalendarHandler.cs:62`, `ExportEventCalendarHandler.cs:61`), so the determinism the
  builder offers is exercised by the tests rather than by production output.

### PermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistry.cs:10` · Level 1 · class (sealed)

- **What it is**: the immutable, thread-safe implementation of
  [`IPermissionRegistry`](#ipermissionregistry), backed by a frozen role-to-permissions map
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistry.cs:5-10`).
- **Depends on**: [`IPermissionRegistry`](#ipermissionregistry); `System.Collections.Frozen`
  (`FrozenDictionary` and `FrozenSet`, BCL, `PermissionRegistry.cs:1`).
- **Concept introduced, `Frozen*` collections for read-optimized immutable lookups.** `[Rubric §12,
  Performance & Scalability]` assesses hot-path data-structure choices. A `FrozenDictionary` or
  `FrozenSet` pays a higher one-time construction cost in exchange for faster repeated reads and no
  mutation support, which is exactly the authorization access pattern: built once at startup, queried
  on every authorized request, never written again. Immutability is also what makes the structure
  lock-free under concurrency, satisfying the interface's thread-safety expectation without a lock.
  The registry pins the interface's two comparison rules into the data structure itself: the outer
  dictionary uses `StringComparer.OrdinalIgnoreCase` so role lookups are case-insensitive, while each
  permission set uses `StringComparer.Ordinal` so permission values must match exactly
  (`PermissionRegistry.cs:25-28`).
- **Walkthrough**: a shared empty `FrozenSet` sentinel (`PermissionRegistry.cs:12`) and the frozen map
  field (`PermissionRegistry.cs:14`). The constructor (`PermissionRegistry.cs:21`) guards its argument
  and freezes the supplied map with the two comparers (`PermissionRegistry.cs:23-28`).
  `GetPermissions` (`PermissionRegistry.cs:32-35`) returns the matching set, or the shared sentinel on
  a null or unknown role, so it never allocates and never throws: the empty-set-on-miss contract from
  the interface, made literal. `HasPermission` (`PermissionRegistry.cs:38`) guards its inputs
  (`PermissionRegistry.cs:40-41`), then walks the principal's roles and returns on the first role whose
  set contains the permission (`PermissionRegistry.cs:43-53`), so the common case of a matching first
  role costs one dictionary probe and one set probe.
- **Why it's built this way**: freezing at construction trades a one-time build cost for fast,
  allocation-free, lock-free concurrent reads, which suits a startup-built structure hit on every
  authorized request
  ([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)).
- **Where it's used**: constructed by [`PermissionRegistryBuilder.Build`](#permissionregistrybuilder)
  and registered as the [`IPermissionRegistry`](#ipermissionregistry) singleton in
  [`AuthorizationExtensions`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:76-78`);
  read by [`PermissionAuthorizationHandler`](#permissionauthorizationhandler).

### PermissionRegistryBuilder
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:8` · Level 2 · class (sealed)

- **What it is**: a mutable accumulator that collects role-to-permission grants and freezes them into
  an immutable [`PermissionRegistry`](#permissionregistry)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:3-8`).
- **Depends on**: [`PermissionRegistry`](#permissionregistry), its build target.
- **Concept introduced, the builder pattern for multi-module contribution.** `[Rubric §2, Design
  Patterns]` assesses idiomatic pattern use and `[Rubric §7, Microservices Readiness]` assesses whether
  a module can declare only what it owns. The builder separates the *accumulation* phase (mutable,
  order-independent, contributed to by many modules during startup) from the *finished* phase (an
  immutable snapshot read by every request). The property that makes it work for a modular monolith is
  in the doc comment (`PermissionRegistryBuilder.cs:5-6`): multiple modules may grant permissions for
  the same role and the grants are **unioned**, so a module never needs to know what the others
  granted, and load order does not change the result.
- **Walkthrough**: a case-insensitive backing `Dictionary<string, HashSet<string>>`
  (`PermissionRegistryBuilder.cs:14-15`), preceded by a comment
  (`PermissionRegistryBuilder.cs:10-12`) that explains the scoped `IDE0028` suppression: a collection
  expression cannot carry the `OrdinalIgnoreCase` comparer that keeps role keys case-insensitive, and
  the concrete `Dictionary` type is kept for `CA1859`. `Grant(role, params permissions)`
  (`PermissionRegistryBuilder.cs:25`) guards its inputs (`:27-28`), filters blank permissions
  (`:30`), then either unions into the existing set or seeds a new ordinal `HashSet`
  (`:32-39`), and returns `this` for chaining (`:41`): additive and idempotent, so a duplicate grant
  from a second module is a no-op. `Build()` (`PermissionRegistryBuilder.cs:46`) projects the grants
  into an `IReadOnlyDictionary<string, IReadOnlySet<string>>` (keeping the case-insensitive comparer)
  and hands it to the [`PermissionRegistry`](#permissionregistry) constructor
  (`PermissionRegistryBuilder.cs:48-53`).
- **Why it's built this way**: mutable while assembling, immutable once built is the safe way to let
  independent modules compose one shared authorization table at startup without any shared mutable
  state at runtime.
- **Where it's used**: [`AuthorizationExtensions`](#authorizationextensions) registers exactly one
  builder instance and a lazily-built singleton registry over it, so the registry is materialized on
  first resolve, after every module has contributed
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:65-81`);
  modules reach it through `AddPermissions(...)`, which is deliberately safe to call once per module
  (`AuthorizationExtensions.cs:47-62`), as MMCA.ADC's Conference, Engagement, and Identity modules
  each do
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41-51`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:51-54`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44-47`).
- **Caveats / not-in-source**: the lazy build means a `Grant` call made after the first
  `IPermissionRegistry` resolve would silently not take effect; the API doc says to call before the
  host is built (`AuthorizationExtensions.cs:50`), but nothing enforces it at runtime.

### RoleValue
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25` · Level 3 · class (abstract)

- **What it is**: the abstract base for a role value object: it stores a canonical string, provides
  case-insensitive value equality and hashing, and offers validation against a per-app set of known
  role names (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:6-25`).
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`
  (`RoleValue.cs:2`), plus `System.Collections.Frozen` (`RoleValue.cs:1`). It references
  [`RoleNames`](#rolenames) in its documentation. Conceptually a value object (see
  [`ValueObject`](group-02-domain-building-blocks.md#valueobject)) but deliberately not derived from
  that base.
- **Concept introduced, a value object as an abstract class with type-guarded equality.** `[Rubric §4,
  Domain-Driven Design]` assesses whether identity-less concepts are modeled as value objects, and
  `[Rubric §1, SOLID]` applies to how the hierarchy is left open. Roles are stored as plain strings and
  emitted as JWT claims; this type gives them value semantics without a database identity. It
  deliberately does **not** implement `IEquatable<T>` (`RoleValue.cs:17-23`): the remarks cite Sonar
  S4035, an unsealed `IEquatable<T>` breaks the equality contract for subclasses. Instead equality is
  the `object.Equals` override, type-guarded so two roles are equal only when they are the *same
  concrete type* with the same case-insensitive value (`RoleValue.cs:78-81`), and a sealed derived type
  may safely add a strongly-typed `IEquatable<TSelf>` plus `==`/`!=` on top, which ADC's `UserRole`
  does (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17,78-84`). It
  lives in `MMCA.Common.Shared` so it stays dependency-free and usable from Blazor WebAssembly as well
  as Domain, with each app deriving a concrete role type that fixes its own role set
  (`RoleValue.cs:11-16`).
- **Walkthrough**: a get-only `Value` (`RoleValue.cs:28`) set by the protected constructor
  (`RoleValue.cs:32`). The static `Validate(role, knownRoles, source)` (`RoleValue.cs:42`) returns
  `Result.Success()` when the role is in the app's known set, otherwise a
  [`Result`](group-01-result-error-handling.md#result) failure carrying an
  [`Error`](group-01-result-error-handling.md#error) of kind `Invariant` coded `User.Role.Invalid`
  (`RoleValue.cs:46-52`); note the `role ?? string.Empty` coalesce (`RoleValue.cs:46`), which turns a
  null role into a clean failure rather than a `NullReferenceException`. The protected generic
  `BuildLookup<TRole>(params roles)` (`RoleValue.cs:63`) freezes the supplied singletons into a
  case-insensitive `FrozenDictionary` keyed by `Value` (`RoleValue.cs:68-71`), so a derived type can
  back its `FromString`/`IsValid` members with interned instances instead of re-allocating. `ToString`
  returns the value (`RoleValue.cs:75`), and `GetHashCode` uses the ordinal-ignore-case hash
  (`RoleValue.cs:84`) so it stays consistent with `Equals`, which is the contract a dictionary key
  depends on.
- **Why it's built this way**: the abstract-class-plus-type-guard shape is how you share equality
  behavior across an open hierarchy of value objects without violating the equality contract, and the
  S4035 rationale is documented inline so a future reader does not "helpfully" add `IEquatable<T>` to
  the base.
- **Where it's used**: the two apps consume it differently, and the difference is instructive.
  ADC derives a full sealed value object,
  [`UserRole`](group-24-identity-module.md#userrole), which fixes three roles (Organizer, Attendee,
  ContentEditor), interns them through `BuildLookup`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:20-33`), and exposes
  `FromString`/`IsValid` over that frozen lookup (`UserRole.cs:51-65`) plus a case-insensitive
  `IsOrganizer` for raw claim strings (`UserRole.cs:76`). Store's `UserRole` is a **static class**
  rather than a subclass: it fixes Admin and Customer as string constants and calls the shared
  `RoleValue.Validate` helper for its `IsValid`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserRole.cs:14,26-30,37`), so
  it inherits the rule set (case-insensitive membership, the `User.Role.Invalid` code) without
  inheriting the type. Both key their known-role sets off the [`RoleNames`](#rolenames) constants.

### RegisterRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RegisterRequest.cs:13` · Level 4 · record struct (readonly)

- **What it is**: the registration payload for a new account: email, password, first and last name,
  and an optional postal address
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RegisterRequest.cs:5-18`).
- **Depends on**: [`Address`](group-02-domain-building-blocks.md#address) from
  `MMCA.Common.Shared.ValueObjects` (`RegisterRequest.cs:1`), which is what puts this Level 0-shaped
  DTO at Level 4.
- **Concept**: the `readonly record struct` DTO shape from
  [`AuthenticationResponse`](#authenticationresponse). `[Rubric §9, API & Contract Design]`. The
  optional `Address? Address = null` parameter (`RegisterRequest.cs:18`) shows that positional record
  structs support default values, so a caller that has no address omits it rather than needing a
  second overload or a null literal.
- **Walkthrough**: five positional parameters (`RegisterRequest.cs:13-18`): four strings plus the
  nullable [`Address`](group-02-domain-building-blocks.md#address). The strings arrive raw: no
  validation attributes, no normalization. Shape checking is the validator's job and semantic
  conversion is the domain factory's, which is why
  [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) hands the request to an
  abstract `CreateUser(RegisterRequest request, byte[] passwordHash, byte[] passwordSalt)` that each
  app implements against its own `User` aggregate
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:322`, called at
  `:160`).
- **Where it's used**:
  [`AuthenticationServiceBase<TUser>.RegisterAsync`](#authenticationservicebasetuser)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:134`) and
  the `register` endpoint on
  [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:81-82`), plus
  each app's register form.

### IdempotencyHeaders

> MMCA.Common.Shared · `MMCA.Common.Shared.Http` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13` · Level 0 · class (static)

- **What it is**: two `const string` header names for the idempotency protocol, the request header a
  client sends to make a write repeatable and the response header a server sets when it replayed a
  stored answer instead of executing again
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13-26`).
- **Depends on**: nothing. No usings, no first-party types, no externals.
- **Concept introduced, the shared-literal constant as a contract between two packages that cannot
  see each other.** `[Rubric §9, API & Contract Design]` assesses whether the wire contract is
  expressed once and consistently; `[Rubric §16, Maintainability & Evolvability]` assesses whether a
  change lands in one place. The remarks
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:7-12`) state the exact
  reason this type sits in `Shared` rather than next to the filter that consumes it: the server-side
  reader lives in `MMCA.Common.API` and the client-side writer lives in `MMCA.Common.UI`, and by the
  layering rules those two packages have no reference to one another (`UI` depends on `Shared` only,
  for Blazor WebAssembly compatibility). `Shared` is the one assembly both can see, so it is the only
  place a single literal can serve both ends. Hard-coding `"Idempotency-Key"` twice would compile
  perfectly and break silently the day one side is edited: a typo on the client means the server never
  sees a key and every retry executes again.
- **Walkthrough**: two members and no behavior.
  - `IdempotencyKey = "Idempotency-Key"` (line 19), the client-provided key. The doc comment (lines
    15-18) records the protocol contract: a server that has already seen the key replays the original
    response rather than executing the action a second time.
  - `IdempotentReplay = "X-Idempotent-Replay"` (line 25), appended by the server when the body it
    returned came from the idempotency cache rather than a fresh execution, so a client can tell a
    deduplicated answer from an original one.

  Both are `const`, not `static readonly`, so they are usable in attribute arguments and in `switch`
  patterns that require compile-time constants, the same choice
  [`AuthClaimTypes`](#authclaimtypes) and [`RoleNames`](#rolenames) make.
- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)
  defines idempotency as a client-supplied-key protocol at the inbound HTTP edge, which only works if
  both ends agree on the header spelling. Putting the literal in `Shared` makes that agreement a
  compile-time fact instead of a convention.
- **Where it's used**: on the server,
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) re-exposes it as a public
  `IdempotencyKeyHeader` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:72`), reads the
  incoming header (`IdempotencyFilter.cs:167`), and appends `X-Idempotent-Replay: true` on a replay
  (`IdempotencyFilter.cs:387`). On the client,
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  sets it as a default request header on the `HttpClient` that serves every retry attempt of one
  logical operation
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:193-199`), which is
  what makes the retries deduplicate instead of creating extra records. ADC's live-layer UI services
  do the same per call
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:96` and
  `:143`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:75`).

### PrivacyFeatures

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6` · Level 0 · class (static)

- **What it is**: the feature-flag name space for the privacy (data-subject rights) surface. One
  member today: `DataExport = "Privacy.DataExport"`, the flag that turns the data-subject export
  endpoint on
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6-10`).
- **Depends on**: nothing. No usings, no first-party types, no externals. Same reason as
  [`IdempotencyHeaders`](#idempotencyheaders): a flag name has to be nameable from the layer that
  gates on it and from the configuration a host writes, so it lives at the bottom of the stack.
- **Concept introduced, the flag name as a compile-time symbol rather than a magic string.**
  `[Rubric §10, Cross-Cutting Concerns]` assesses whether a concern like feature gating is expressed
  once instead of restated per call site;
  `[Rubric §30, Compliance / Privacy / Data Governance]` assesses whether privacy-affecting surfaces
  are deliberately controlled rather than always-on. `Microsoft.FeatureManagement` matches flags by
  **string**, both in the `FeatureManagement` configuration section and in the `[FeatureGate("...")]`
  attribute, so nothing in the compiler stops a host from enabling `"Privacy.DataExport"` while the
  controller gates on `"PrivacyDataExport"`: the endpoint would simply stay 404 with no error
  anywhere. Publishing the literal as a `const` makes the attribute side of that pair a symbol the
  compiler checks, and it is `const` (not `static readonly`) precisely so it can be used as an
  attribute argument, which `static readonly` cannot
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:59`).
  The configuration side stays a string a host types, and no source in this tree types it.
- **Walkthrough**: one member.
  - `DataExport = "Privacy.DataExport"` (line 9), documented as the flag controlling the data-subject
    export (DSAR) endpoint (line 8). The value is dotted, matching the flag-name convention the
    feature-management configuration section uses.
- **Why it's built this way**: [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)
  settles on `Microsoft.FeatureManagement` and enforces one flag name on two surfaces (a
  `[FeatureGate]` on controllers, `IFeatureGated` on CQRS handlers), with a disabled feature
  answering **404, not 403**, so a turned-off capability is indistinguishable from one that was never
  deployed. [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) then chooses
  to ship the whole export endpoint behind that gate, so adopting the framework does not silently
  publish a route that returns a complete dossier on a person.
- **Where it's used**: as the argument to the class-level
  `[FeatureGate(PrivacyFeatures.DataExport)]` on
  [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery)
  (`DataExportControllerBase.cs:59`, with the rationale in its remarks at `:50-55`), and asserted by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:149`,
  which reflects over the attribute so the gate cannot be dropped in a refactor.
- **Caveats / not-in-source**: no `appsettings*.json` in this workspace declares a
  `Privacy.DataExport` entry, and no production controller derives from
  `DataExportControllerBase<TQuery>` (ADC and Store keep their own earlier export endpoints, see
  [`UserDataExportDTO`](#userdataexportdto)). So the flag is defined and gated on, but not currently
  enabled by any host in this tree.

### Releaser

> MMCA.Common.Shared · `MMCA.Common.Shared.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:78` · Level 0 · record struct (readonly, nested)

- **What it is**: the disposable handle [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) hands back
  from `AcquireAsync`; disposing it releases the stripe that was taken
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:78-86`).
- **Depends on**: `System.IDisposable` and `SemaphoreSlim` (both BCL). It is nested inside
  [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) and only that type can construct it.
- **Concept introduced, the scope-bound lock handle.** `[Rubric §15, Best Practices & Code Quality]`
  assesses whether resource lifetimes are expressed so the compiler enforces them. The alternative
  shape, `WaitAsync(...)` followed by a `try` / `finally` `Release()` at every call site, puts the
  release on the caller and fails open the first time someone forgets or returns early. Returning a
  handle instead makes `using` the natural spelling, so the release rides on the scope and survives an
  exception in the guarded work (the `AcquireAsync` doc comment says exactly this,
  `KeyedSemaphoreStripe.cs:52-56`). `readonly record struct` keeps the handle allocation-free on a
  path that runs per cache write and per idempotent POST, which matters because the whole point of the
  striped design is to be cheap. `[Rubric §12, Performance & Scalability]` covers that allocation
  choice.
- **Walkthrough**: three members.
  - `private readonly SemaphoreSlim? _stripe` (line 80): the semaphore to release, deliberately
    nullable.
  - `internal Releaser(SemaphoreSlim stripe)` (line 82): `internal`, so only the enclosing stripe set
    can mint one; there is no public way to fabricate a handle for a semaphore you never took.
  - `Dispose()` (line 85): `_stripe?.Release()`. The null-conditional is what makes a
    `default(Releaser)` (which a struct always permits, since a struct has no null) a safe no-op
    rather than a `NullReferenceException`; the doc comment on line 84 calls that out.
- **Why it's built this way**: a struct handle with an `internal` constructor gives the ergonomics of
  `using` with none of the per-acquisition garbage, and the null-tolerant `Dispose` closes the one
  hole a value type opens (nobody can construct a broken handle, but the language always allows a
  zeroed one).
- **Where it's used**: returned by
  [`KeyedSemaphoreStripe.AcquireAsync`](#keyedsemaphorestripe)
  (`KeyedSemaphoreStripe.cs:64`) and consumed as a `using` at every call site:
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:208`),
  [`CookieSessionRefresher`](#cookiesessionrefresher)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:102`),
  [`MemoryCacheService`](group-09-caching.md#memorycacheservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:101`, `:112`,
  `:132`), the default `GetOrCreateAsync` implementation on
  [`ICacheService`](group-09-caching.md#icacheservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:112`), and
  [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:89`).

### UserDataExportSectionDTO

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:61` · Level 0 · record (sealed)

- **What it is**: one section of a data-subject export package: the data a single contributor holds
  about the subject, plus whether that contributor could be reached at all
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:51-89`).
- **Depends on**: `System.Runtime.Serialization`'s `DataContract` / `DataMember` (BCL, line 1). No
  first-party types. It is the element type of [`UserDataExportDTO`](#userdataexportdto)`.Sections`.
- **Concept introduced, the degradation envelope: reporting "not retrieved" as data rather than as an
  error.** `[Rubric §29, Resilience & Business Continuity]` assesses whether a partial failure
  degrades a response instead of failing it, and `[Rubric §30, Compliance / Privacy / Data
  Governance]` assesses whether a legal obligation is actually met under fault. A data-subject access
  request is a deadline with a statutory obligation attached, and this document is assembled by
  fanning out over contributors that in an extracted topology are **other services**. If any one of
  them being unreachable failed the whole export, one peer outage would deny the subject their entire
  package. So the shape carries the outcome instead: an unreachable contributor still produces an
  envelope, with `Available = false` and a caller-safe reason. The doc comment states the invariant
  the reader depends on (lines 67-70): `Available = false` means "incomplete, retry later", **not**
  "the subject has no data here". Without that flag those two cases are the same empty payload, and a
  subject could be told their record is empty when a service was simply down.

  The second half of the concept is the **caller-safe** reason string (lines 82-86): it explicitly
  never carries exception messages, stack traces, connection strings or peer addresses, because this
  string is handed to the data subject. `[Rubric §11, Security]` applies: an error surface that leaks
  infrastructure detail to an unauthenticated-adjacent audience is a disclosure bug, and the diagnostic
  detail belongs in the log instead. The producer honours that split, logging the exception and
  substituting a fixed generic reason
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:187-197`).
- **Walkthrough**: four `init`-only properties, no behavior, each with an explicit `[DataMember(Order
  = n)]` so the wire order is declared rather than inherited from declaration order.
  - `SectionName` (`required`, Order 1, line 65): the stable identifier for the section, for example
    "Engagement" or "Sales".
  - `Available` (`required`, Order 2, line 72): whether the section was produced successfully. Both
    of these are `required`, so a section envelope cannot be constructed without answering the two
    questions the reader must have.
  - `Data` (Order 3, line 80): the contributor's own payload, or `null` when the section is
    unavailable. Typed `object` for the same reason [`UserDataExportDTO`](#userdataexportdto)`.Subject`
    is (taught there): the payload shape is owned by the contributor, not by the framework.
  - `UnavailableReason` (Order 4, line 88): the short caller-safe explanation, `null` when the section
    is available.
- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)
  makes per-section degradation the rule rather than an implementation detail, and the two `required`
  members are what stop a producer from emitting an ambiguous envelope. `sealed record` gives value
  equality and `init`-only immutability for free, so an assembled package cannot be mutated on its way
  out.
- **Where it's used**: produced by
  [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery)`.RunSectionAsync`
  on both the success path (`ExportUserDataHandlerBase.cs:177-183`, copying the fields off the
  contributor's [`UserDataExportSectionResult`](group-14-module-system-composition.md#userdataexportsectionresult))
  and the degraded path (`:192-197`, stamping
  [`UserDataExportSectionDefaults`](group-14-module-system-composition.md#userdataexportsectiondefaults)`.UnavailableReason`);
  collected into `Sections` at `:104-107` and `:116`.

### KeyedSemaphoreStripe

> MMCA.Common.Shared · `MMCA.Common.Shared.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22` · Level 1 · class (sealed)

- **What it is**: an in-process mutual-exclusion primitive that serializes work **per logical key**
  across a fixed array of `SemaphoreSlim` instances. A key hashes to one stripe, so the table size is
  bounded by `Width` no matter how many distinct keys the process ever sees
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:3-6`).
- **Depends on**: `SemaphoreSlim`, `ArgumentOutOfRangeException`, `ArgumentNullException` and
  `string.GetHashCode(ReadOnlySpan<char>, StringComparison)` (all BCL); it returns the nested
  [`Releaser`](#releaser). No first-party dependencies at all, which is why it can live in `Shared`
  and be used from Application, Infrastructure and API alike.
- **Concept introduced, lock striping (and the two defects it exists to avoid).** `[Rubric §12,
  Performance & Scalability]` assesses whether concurrency control is bounded and does not become a
  memory or contention hazard; `[Rubric §11, Security]` applies because the keys here are frequently
  **caller-supplied** (an idempotency key, a parameterized cache key), which makes an unbounded
  per-key table a remote memory-exhaustion vector. The class doc (lines 7-16) is worth reading in
  full, because it argues against the shape most codebases reach for first, one `SemaphoreSlim` per
  key in a `ConcurrentDictionary`. That shape forces a choice between two real defects:
  1. **Remove the entry when the last holder releases**, and you open a window where one caller is
     waiting on a semaphore that is no longer in the table while a second caller creates a fresh one;
     both then run concurrently, which is precisely what the lock existed to prevent.
  2. **Never remove it**, and a caller-supplied key grows the table without bound.

  Striping has neither problem: the array is allocated once at construction and never mutated. The
  price is **false sharing of a stripe**: two unrelated keys can hash to the same slot and briefly
  serialize against each other. The doc explains why that is acceptable here (lines 13-15): every
  caller is doing double-check locking and re-checks its own key's state after acquiring, so a
  spurious wait costs latency, never correctness.
- **Walkthrough** (fields, constructors, then the one public method):
  - `DefaultWidth = 256` (line 25): the default stripe count, documented as "ample concurrency without
    a meaningful memory cost" (line 24). It is `public const`, which is what lets a test compute a
    deliberate collision (see Caveats below).
  - `private readonly SemaphoreSlim[] _stripes` (line 27): the fixed table.
  - Parameterless constructor (lines 30-33): chains to the width overload with `DefaultWidth`.
  - `KeyedSemaphoreStripe(int width)` (lines 37-47): guards with
    `ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(width, 0)` (line 39), stores `Width` (line 41),
    then eagerly allocates every stripe as `new SemaphoreSlim(1, 1)` (lines 42-46). Initial count 1 and
    maximum count 1 is a mutex: exactly one holder at a time. Allocating all of them up front is what
    removes every race from the acquire path, there is no lazy creation to synchronize.
  - `Width { get; }` (line 50): the table size, get-only.
  - `AcquireAsync(string key, CancellationToken)` (lines 60-65): map the key to its stripe, `await
    stripe.WaitAsync(cancellationToken)` with `ConfigureAwait(false)` (line 63, the library
    ConfigureAwait policy of
    [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html)), and return
    a [`Releaser`](#releaser) wrapping it (line 64). The doc comment (line 58) is precise about the
    token's scope: it cancels the **wait**, not the work that follows it.
  - `private SemaphoreSlim GetStripe(string key)` (lines 67-75): null-checks the key (line 69) and then
    folds an **ordinal** hash into a non-negative index:
    `(uint)string.GetHashCode(key, StringComparison.Ordinal) % (uint)Width` (line 73). Two details
    matter. Ordinal (not the default culture-sensitive comparison) keeps the mapping stable regardless
    of the ambient culture. The `uint` cast rather than `Math.Abs` is deliberate and commented (lines
    71-72): `int.MinValue` has no positive counterpart, so `Math.Abs` on it throws, while masking the
    sign bit by reinterpreting as unsigned cannot.
- **Why it's built this way**: the remarks (lines 18-21) fix the intended lifetime: instances are
  thread-safe and meant to be held in a **static field for the process lifetime**, and the stripes are
  never disposed because the instance outlives every caller. That is why you will find it as a
  `static readonly` or an instance field on a singleton, never as a scoped dependency. Note the scope
  limit that follows from being in-process: it serializes callers **inside one process only**, so
  under more than one replica it is not sufficient on its own. That is exactly why
  [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) was revised to make the
  idempotency guard an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) resolved from
  DI, keeping the stripe only as the fallback for a host that registers none
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:36` and
  `:197-199`). `[Rubric §7, Microservices Readiness]` is the lens here: a primitive that is correct on
  one node and insufficient on several is exactly the kind of assumption an extraction has to
  re-examine.
- **Where it's used**: five call sites, all double-check-locking a cache.
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) holds a static instance
  (`IdempotencyFilter.cs:92`) and runs the guarded section under it when no distributed lock is
  registered (`IdempotencyFilter.cs:208-215`).
  [`CookieSessionRefresher`](#cookiesessionrefresher) holds a per-instance one
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:62`) so
  concurrent SSR requests carrying the same expired cookie do not each burn the refresh token
  (`:102-105`). [`MemoryCacheService`](group-09-caching.md#memorycacheservice) uses one to make its
  read-modify-write paths atomic per key
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:38`, `:101`,
  `:112`, `:132`). The default `GetOrCreateAsync` on
  [`ICacheService`](group-09-caching.md#icacheservice) collapses a factory stampede through an
  `internal` non-generic holder, `CacheKeyLocks.Locks`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:112`, holder at
  `:142-146`), and
  [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
  does the same for a query key through its own holder `QueryCacheKeyLocks`
  (`CachingQueryDecorator.cs:89`, holder field at `:197`). The two holders are deliberately separate
  tables, not one shared set: the remarks on `CacheKeyLocks` (`ICacheService.cs:134-141`) note that
  sharing stripes across unrelated call sites would only widen the unrelated-key collisions striping
  already tolerates.
- **Caveats / not-in-source**: `[Rubric §14, Testability]` shows up in an unusual way here. Because
  `DefaultWidth` is public, `CookieSessionRefresherTests` computes a key that provably lands on a
  *different* stripe rather than hoping, so the test cannot flake on the one-in-256 collision
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:274`
  and `:289-291`). The primitive's own behavior is covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Concurrency/KeyedSemaphoreStripeTests.cs`, which
  drives it at `width: 1`, `2` and `4` (`:40`, `:78`, `:98`) to force collisions deterministically.
  Note also that `string.GetHashCode` is randomized per process by default in .NET, so which key lands
  on which stripe is stable within a run and not across runs; nothing in the design depends on it being
  stable across runs.

### LoginRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11` · Level 1 · class

- **What it is**: the FluentValidation rule set for [`LoginRequest`](#loginrequest): the email must be
  present and well-formed, the password must be present. Nothing else
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11-22`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, line 1) and
  [`LoginRequest`](#loginrequest) from `MMCA.Common.Shared.Auth` (line 2).
- **Concept introduced, validation that deliberately stops short.** `[Rubric §11, Security]` assesses
  whether authentication avoids leaking information to an unauthenticated caller. The doc comment
  (lines 6-10) is explicit that the minimalism is the design: detailed credential verification happens
  in the authentication service to avoid leaking information about which field was wrong. A
  validator that answered "no account with that email" would turn the login endpoint into an account
  enumeration oracle. Instead the shape check happens here, and every credential outcome collapses
  into the single `Auth.InvalidCredentials` / "Invalid email or password." failure that
  [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) returns for both a missing
  user and a wrong password
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:100-101` and
  `:115-116`). `[Rubric §9, API & Contract Design]` also applies: shape validation belongs at the edge
  of the request, semantic validation belongs in the workflow.
- **Walkthrough**: one constructor (line 13) with two rules.
  - `RuleFor(x => x.Email).NotEmpty().EmailAddress()` (lines 15-17), with the messages "Email is
    required." and "A valid email address is required."
  - `RuleFor(x => x.Password).NotEmpty()` (lines 19-20), message "Password is required." There is no
    length, complexity or character rule here; a password policy on *login* would only reject
    credentials that a legacy account might legitimately still hold.
- **Why it's built this way**: FluentValidation keeps the rules declarative and out of the workflow,
  and the framework owns this particular validator because the request DTO it validates is itself
  framework-owned. Contrast `RegisterRequestValidator`, which stays in each app
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:12`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:13`)
  because password policy and required profile fields are an application decision.
- **Where it's used**: registered by `AddApplication()` via
  `services.AddValidatorsFromAssemblyContaining<ClassReference>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:40`); the comment there
  (`:37-39`) records why it cannot ride on the module scan, `ScanModuleApplicationServices` only scans
  a module's own assembly. DI then injects it into
  [`AuthenticationValidators`](#authenticationvalidators) as the `IValidator<LoginRequest>`, and
  [`AuthenticationServiceBase<TUser>.LoginAsync`](#authenticationservicebasetuser) runs it first
  (`AuthenticationServiceBase.cs:77-81`).

### RefreshTokenRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10` · Level 1 · class

- **What it is**: the sibling rule set for [`RefreshTokenRequest`](#refreshtokenrequest): both tokens
  must be non-empty
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10-20`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (line 1) and
  [`RefreshTokenRequest`](#refreshtokenrequest) (line 2). Structurally identical to
  [`LoginRequestValidator`](#loginrequestvalidator); the shared shape and the "stop short on purpose"
  rationale are taught there.
- **Walkthrough**: one constructor (line 12), two `NotEmpty` rules: `AccessToken` (lines 14-15,
  "Access token is required.") and `RefreshToken` (lines 17-18, "Refresh token is required."). The doc
  comment (lines 6-9) explains why *both* are mandatory even though only one is the credential: the
  expired access token is what the workflow parses claims out of, and the refresh token is what it
  compares for rotation. Neither is optional because the refresh flow needs both halves
  (`AuthenticationServiceBase.cs:230` reads the principal out of the access token,
  `:259` compares the refresh token).
- **Why it's built this way**: same reasoning as its login sibling. It also validates no token
  *format*, which is correct: an unparsable or tampered access token is rejected by signature
  validation inside `GetPrincipalFromExpiredToken`
  ([`ITokenService`](#itokenservice)), not by a string rule that would only tell an attacker which of
  their guesses were shaped right.
- **Where it's used**: registered by the same
  `AddValidatorsFromAssemblyContaining<ClassReference>()` call
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:40`), bundled into
  [`AuthenticationValidators`](#authenticationvalidators) as the `IValidator<RefreshTokenRequest>`, and
  run first by
  [`AuthenticationServiceBase<TUser>.RefreshTokenAsync`](#authenticationservicebasetuser)
  (`AuthenticationServiceBase.cs:222-226`).

### UserDataExportDTO

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` · Level 1 · record (sealed)

- **What it is**: the portable data-subject export package (GDPR/CCPA access and portability): a
  snapshot of the account itself plus one [`UserDataExportSectionDTO`](#userdataexportsectiondto)
  envelope per registered section of the user's data
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:5-49`).
- **Depends on**: `System.Runtime.Serialization`'s `DataContract` / `DataMember` (BCL, line 1), the
  `UserIdentifierType` alias, and [`UserDataExportSectionDTO`](#userdataexportsectiondto) (line 48).
  Nothing else: it is a pure contract type, which is why it sits in `Shared` where the Application
  handler, the API controller and any client can all see it.
- **Concept introduced, the versioned envelope with app-owned payloads.** `[Rubric §9, API &
  Contract Design]` assesses whether a contract can evolve without breaking readers, and `[Rubric §30,
  Compliance / Privacy / Data Governance]` assesses whether personal data is handled with an explicit,
  documented shape. Two design choices carry the whole idea:

  1. **`FormatVersion` is read before parsing** (lines 17-22). The framework owns the *envelope*, so
     when the envelope changes a consumer can detect it rather than guess. Crucially the version
     covers the envelope only: an app changing its own subject or section payloads does not move it
     (`ExportUserDataHandlerBase.cs:57-61`, where the constant `CurrentFormatVersion = "1.0"` lives).
  2. **`Subject` and each section's `Data` are typed `object`** (lines 32-40). This looks like a lost
     type, and the doc comment explains why it is the point: the framework owns the envelope, each app
     owns which of *its* fields are portable personal data, and a property typed `object` serializes
     **by its runtime type** under System.Text.Json. So ADC can put its
     [`UserDataExportSubjectDTO`](group-24-identity-module.md#userdataexportsubjectdto) in that slot and
     Store can put a different one, with no generic parameter threaded through the controller, the
     handler and the response type. The cost is that a *reader* deserializing back into this record
     gets a `JsonElement` rather than the app's type, which is exactly what the round-trip test
     asserts
     (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:99`).

  The third thing to internalise is the header comment (lines 8-12): this document is **PII by
  design**. It exists to hand a data subject everything an app holds about them, so it must only ever
  be produced for the account owner (or a privileged role) and must never be logged, cached, or
  persisted by the pipeline that serves it. The producer honours that literally: the export query
  implements no `IQueryCacheable`, so the caching decorator does not apply to it
  (`ExportUserDataHandlerBase.cs:42-45`). `[Rubric §11, Security]` and `[Rubric §13, Observability &
  Operability]` pull in opposite directions here, and privacy wins: this is one payload you do not log.
- **Walkthrough**: five `init`-only properties, explicit `[DataMember(Order = n)]` on each so the wire
  order is declared rather than incidental.
  - `FormatVersion` (`required`, Order 1, line 22): the envelope version, described above.
  - `GeneratedOn` (`required`, Order 2, line 26): the UTC instant the export was produced, sourced
    from the injected `TimeProvider` (`ExportUserDataHandlerBase.cs:113`), never `DateTime.UtcNow`.
  - `UserId` (`required`, Order 3, line 30): the subject the export describes, in the
    `UserIdentifierType` alias.
  - `Subject` (Order 4, line 40): the app's account snapshot, `object?`, null when the app publishes
    no subject fields.
  - `Sections` (Order 5, line 48): the section envelopes, defaulting to `[]` so an export with no
    registered contributors is an empty list rather than a null a reader has to guard. The doc comment
    (lines 42-46) pins the two guarantees a consumer relies on: the order is the registration order,
    and a section that could not be produced is *still present* reporting `Available = false`, so
    "no data" is distinguishable from "not retrieved".

  The three `required` members mean the compiler refuses a package missing its version, timestamp or
  subject id: the three facts that make the document self-describing.
- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)
  hoists the export idiom ADC and Store each wrote by hand into one framework contract, mirroring the
  delete-handler shape, and makes per-section degradation the rule. `sealed record` with `init`-only
  members gives an immutable, structurally-equal document, which is what lets a test compare an
  assembled package by value. Erasure (the other half of the data-subject story) is a separate
  decision, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
- **Where it's used**: assembled by
  [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery),
  whose whole contract is `IQueryHandler<TQuery, Result<UserDataExportDTO>>`
  (`ExportUserDataHandlerBase.cs:53`, assembly at `:110-117`). Served by
  [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery),
  which deliberately serializes it to UTF-8 bytes and returns a `File(...)` download rather than
  `Ok(export)`, because the document exists to be saved by the person it describes
  (`DataExportControllerBase.cs:104-110`), naming the file from the package's own `GeneratedOn` so the
  name and the document always agree (`:134-135`).
- **Caveats / not-in-source**: the shipped controller base has no production subclass in this
  workspace today. Both apps keep their earlier standalone export endpoints, which return the same
  `UserDataExportDTO` inline via `Ok(result.Value)` with no feature gate and no file download
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:153-168`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersController.cs:39-54`).
  ADR-076 records that non-adoption explicitly; the type itself is shared by both paths.

### ILoginProtectionService

> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` · Level 3 · interface

- **What it is**: the application-layer contract for **brute-force and rate-limit protection** on
  authentication endpoints: lockout checks, failed-attempt increments, successful-login resets, and
  registration rate-limiting per IP address.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (`MMCA.Common.Shared.Abstractions`,
  line 1).
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
    per the doc comment (lines 20-22), applies **exponential-backoff lockout** once the max is
    exceeded; `ResetFailedAttemptsAsync` (line 33) clears the counter after a successful login.
  - **IP-scoped (registration flood):** `CheckRegistrationRateLimitAsync` (line 42) and
    `IncrementRegistrationCountAsync` (line 49) throttle account creation per client IP. Both accept a
    nullable `ipAddress` and **skip** the check when it is null (so a host that cannot resolve the
    caller IP degrades to no limit rather than blocking everyone); `CheckRegistrationRateLimitAsync`
    returns `Result.Success()` in that case (doc comment, lines 36-37).

  All five methods take a `CancellationToken` with a `default` argument, per convention.
- **Why it's built this way**: keeping the protection policy behind an interface lets the shared
  authentication workflow compose it in while the concrete cache mechanics stay in the implementation;
  the null-IP "skip" keeps the limiter from becoming an availability hazard
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)).
- **Where it's used**: injected into [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
  (constructor, `AuthenticationServiceBase.cs:38`), which calls all five methods across its login and
  registration flows (`:84`, `:99`, `:114`, `:128`, `:146`, `:207`); the concrete, cache-backed
  [`LoginProtectionService`](#loginprotectionservice) (tuned by
  [`LoginProtectionSettings`](#loginprotectionsettings)) implements it.

### SoftDeletedUserCache

> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17` · Level 4 · class (static)

- **What it is**: the shared cache contract for the **soft-deleted user marker** (BR-133): the key
  shape, the marker lifetime, and a one-call helper that writes it. The API middleware reads the
  marker on every authenticated request; the module that soft-deletes a user writes it
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:6-10`).
- **Depends on**: [`ICacheService`](group-09-caching.md#icacheservice) (line 2), the
  `UserIdentifierType` alias, and `System.Globalization.CultureInfo` (BCL, line 1).
- **Concept introduced, revoking a stateless credential without a per-request lookup.** `[Rubric §11,
  Security]` assesses whether a revoked principal actually loses access, and `[Rubric §10,
  Cross-Cutting Concerns]` assesses whether such a concern is factored so both ends share one
  definition. A JWT is a bearer credential: signature validation never asks "is this account still
  active?", so soft-deleting a user leaves their already-issued access token passing validation until
  it expires
  ([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)). The
  textbook fixes (a deny-list, or an account-status query on every request) reintroduce exactly the
  per-request state that stateless JWT was chosen to avoid. This type is the middle path: a short-lived
  cache marker written at deletion time and read cheaply on the hot path.

  The `remarks` (lines 11-16) explain why the constants live in the **Application** layer rather than
  next to the middleware that reads them: a downstream application deleting an account has to write
  the exact same key the middleware reads, and a private constant in the presentation layer is
  unreachable from an application-layer command handler. Same reasoning as
  [`IdempotencyHeaders`](#idempotencyheaders), applied one layer up.
- **Walkthrough**: three static members, no state.
  - `MarkerDuration => TimeSpan.FromSeconds(30)` (line 29). The remarks (lines 22-28) justify the
    number rather than leaving it magic: the marker only has to cover the window between the delete
    committing and the next token validation, because once it expires the validator query is the
    source of truth again and gives the same answer. Short-lived access tokens (15 minutes, the BR-205
    default on [`ITokenService`](#itokenservice)) bound the rest of the exposure, so a longer marker
    would buy nothing and would keep stale entries alive for users who were never deleted.
  - `KeyFor(UserIdentifierType userId)` (lines 42-43): builds `user:deleted:{userId}` through
    `string.Create(CultureInfo.InvariantCulture, ...)`. The remarks (lines 36-41) name the bug this
    prevents: an identifier renders differently under some cultures (digit shapes, group separators),
    so a culture-sensitive key would be written under one request's culture and missed under another,
    silently letting a deleted user keep making requests. This is a case where the analyzer rule about
    culture-invariant formatting is guarding a security property, not just a formatting nicety.
  - `MarkDeletedAsync(ICacheService cache, UserIdentifierType userId, CancellationToken)` (lines
    53-61): null-guards the cache (line 58) and writes `true` under `KeyFor(userId)` for
    `MarkerDuration` (line 60). It returns the task without awaiting, so there is no extra async state
    machine for a one-call passthrough.
- **Why it's built this way**: publishing the key shape and the TTL as framework API is what keeps the
  writer and the reader honest, and it is a precondition for the module boundary in
  [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html):
  Identity owns the delete, every service hosts the middleware, and the only thing they share is a
  cache entry rather than a database. `[Rubric §7, Microservices Readiness]` applies directly, an
  extracted service can enforce the revocation without a reference to the Identity database.
- **Where it's used**: read by
  [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which
  builds the key (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:85`),
  short-circuits with 401 when the marker is `true` (`:102-106`), and on a miss falls back to the
  validator query and caches **that** answer, deleted or not, for the same `MarkerDuration`
  (`:131-133`). Written by the Identity delete path: ADC's
  [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) queues it as an after-commit
  action and swallows a cache fault so a failed marker cannot turn a successful erasure into an error
  the caller would retry
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:68-80`,
  inside the `OnAfterSoftDeleteAsync` override at `:46`).
- **Caveats / not-in-source**: the marker is best effort on both ends by design. The middleware fails
  **open** on a cache outage (falling through to the validator query, and proceeding if that is also
  unavailable, `SoftDeletedUserMiddleware.cs:93-100` and `:118-125`), and the writer logs and
  continues on a cache fault. The exposure that leaves is bounded by the access-token lifetime, which
  is the trade-off ADR-047 accepts explicitly. ADC's handler is the only writer in the source tree
  today; MMCA.Store soft-deletes users without writing the marker.

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
  (lines 6-12) states the exact motive: collapsing three closely-related dependencies into one keeps
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
  validators and composes them into this one object. Two of the three
  ([`LoginRequestValidator`](#loginrequestvalidator),
  [`RefreshTokenRequestValidator`](#refreshtokenrequestvalidator)) come from the framework assembly,
  while `IValidator<RegisterRequest>` is satisfied by the app's own `RegisterRequestValidator`, so the
  bundle is the point where framework and app validation meet.
- **Where it's used**: injected into [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
  (constructor, `AuthenticationServiceBase.cs:40`), whose `LoginAsync`/`RegisterAsync`/`RefreshTokenAsync`
  call `validators.Login` (`:77`), `validators.Register` (`:139`), and `validators.Refresh` (`:222`)
  respectively before doing any work.

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
  the capability is opt-in ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)).
  `[Rubric §11, Security]`: login, registration, and refresh all return
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
  lockout/rate-limit gate
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)), an
  untracked-then-tracked dual fetch
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)), and
  refresh-token rotation with **reuse detection**
  ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), BR-205/206).
  `[Rubric §7, Microservices Readiness]`: the workflow depends only on ports (`IUnitOfWork`,
  `ITokenService`, ...) so it runs unchanged whether the Identity module is in-monolith or its own
  service.
- **Walkthrough** (members in teaching order):
  - **Constructor + protected accessors** (lines 34-54): a primary constructor takes the six
    collaborators; protected read-only properties re-expose `UnitOfWork` (line 44), `TokenService`
    (line 47), `TimeProvider` (line 50) and a `Repository` (lines 53-54) resolved lazily as
    `unitOfWork.GetRepository<TUser, UserIdentifierType>()`, so subclass hooks and app-level flows
    (external login) reuse them without re-injecting.
  - **Token lifetimes** (lines 61-70): `virtual` `AccessTokenLifetime` and `RefreshTokenLifetime` read
    through to [`ITokenService`](#itokenservice) (which derives them from `Jwt:AccessTokenExpirationMinutes`
    and `Jwt:RefreshTokenExpirationDays`), so the expiry reported to the client matches the JWT's
    actual `exp`. A non-positive value, meaning a hand-written test double or a misconfigured host,
    falls back to the BR-205 defaults of 15 minutes and 7 days
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:33`
    and `:40` carry the same defaults on the port).
  - **`LoginAsync`** (lines 73-131): validate the request (lines 77-81), check lockout (line 84,
    [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) /
    BR-212), normalise the raw email into an [`Email`](group-02-domain-building-blocks.md#email) value
    object (line 92) so the EF predicate compares same-typed converted values (an invalid email yields
    a null value object that simply matches no user, which is the invalid-credentials answer anyway).
    **Step 1** is an *untracked* fetch via the `FindUntrackedByEmailAsync` hook (line 96) to verify
    credentials without change-tracker overhead; a null result increments failed attempts and returns
    a generic 401 (lines 97-102). An app gate runs before password verification (line 106, no
    failed-attempt increment so the pre-hoist behaviour is preserved), then
    `passwordHasher.VerifyPassword` (line 112). **Step 2** is a *tracked* re-fetch by id (line 120) so
    the new refresh token can be persisted, followed by `ResetFailedAttemptsAsync` (line 128) and
    `IssueTokensAsync` (line 130).
  - **`RegisterAsync`** (lines 134-215): validate (lines 139-143), IP rate-limit (line 146,
    [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) /
    BR-213), reject a duplicate email through the `EmailExistsAsync` hook (lines 153-157), hash the
    password (line 159), build the user through the `CreateUser` hook (line 160), mint and store a
    refresh token (lines 167-168), `AddAsync` (line 170) and `SaveChangesAsync` (line 174), then run
    the `OnUserRegisteredAsync` post-commit hook (line 204) to pick up the instance the first access
    token is minted from, increment the IP registration count (line 207), and return the token pair
    (lines 209-214).

    The save is wrapped in a deliberately **broad** `catch (Exception)` (lines 172-200, with a scoped
    `CA1031` suppression) whose comment is the teaching material. The email lookup above is a
    check-then-act: two concurrent registrations for the same address both pass it, and the loser only
    fails on the insert, against the unique index every consumer puts on `Email` (ADC unfiltered, Store
    filtered on `IsDeleted`). Without the catch, that race surfaces as a generic 500 instead of the 409
    a serialized pair would have produced. The catch cannot name `DbUpdateException`, because
    Application has no EF Core dependency by layer rule, so the **re-check is what narrows it** (line
    194): if the address exists now, the concurrent registration is the cause and the caller gets the
    same conflict the serial path returns through the shared `EmailAlreadyExistsFailure()` helper;
    anything else rethrows untouched (line 199) and still reaches the exception middleware. The
    re-check passes `CancellationToken.None` on purpose (lines 192-194): it has to run even when the
    caller's token is what aborted the save, or a cancelled save could never be classified.
  - **`RefreshTokenAsync`** (lines 218-269): validate (lines 222-226), pull claims from the *expired*
    JWT via `tokenService.GetPrincipalFromExpiredToken` (line 230, signature still checked, only
    lifetime skipped), read the `user_id` claim (lines 237-242), load the tracked user (line 244), run
    the refresh app gate (line 251), then the security-critical check (line 259): if the stored
    `RefreshToken` does not match or has expired, this is treated as **token reuse (potential theft)**,
    so `user.RevokeRefreshToken()` is called and saved (lines 261-262, BR-206) before returning a 401.
    A clean match issues a rotated pair through `IssueTokensAsync` (line 268).
  - **`RevokeTokenAsync`** (lines 272-286): load by id, `RevokeRefreshToken()`, save; a missing user
    yields `Error.NotFound` targeted at `typeof(TUser).Name` (line 279).
  - **`IssueTokensAsync`** (lines 292-306): the shared rotation used by login and refresh (and reusable
    by app-level external login), mints an access token via the `CreateAccessToken` hook, generates a
    new refresh token, stamps its expiry off `TimeProvider`, saves, and returns the response.
  - **The hooks**: four `abstract` (a subclass must supply them). `FindUntrackedByEmailAsync` (line
    313) and `EmailExistsAsync` (line 319) are deliberately written against the app's concrete `User`
    so EF translates the predicate byte-for-byte as before, and the second explicitly leaves the app to
    decide whether soft-deleted accounts count (`ignoreQueryFilters: true` blocks re-registration of an
    erased email, lines 315-318); `CreateUser` (line 322) runs the app's domain factory;
    `CreateAccessToken` (line 325) mints the app's claim set (for example `speaker_id` vs
    `customer_id`). Four `virtual` hooks default to a no-op: `ValidateLoginCandidateAsync` (line 328)
    and `ValidateRefreshCandidateAsync` (line 332) add extra gates such as a deactivated-account check;
    `OnUserRegisteredAsync` (line 339) runs the post-commit side-effect (publish an integration event
    or re-fetch a linked id); and `CreateRefreshUserMissingError` (line 347) defaults the vanished-user
    case to 401 (a token for a missing user is indistinguishable from an invalid one) while letting an
    app return 404 where its public contract already promises it. One `private static` helper,
    `EmailAlreadyExistsFailure()` (lines 355-357), returns the `Auth.EmailAlreadyExists` conflict so
    the up-front check and the race recovery are indistinguishable to the caller.
- **Why it's built this way**: the untracked-then-tracked dual fetch keeps the common
  credential-verification path off the change tracker (cheaper, and soft-deleted accounts fall out via
  EF query filters returning the generic 401) while still giving a tracked instance to persist the new
  token ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).
  Refresh-token reuse detection (revoke-on-mismatch) is the BR-206 defence against a stolen token being
  replayed ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)).
  Password material flows through [`IAuthUser`](#iauthuser)'s `PasswordHash`/`PasswordSalt`
  ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)), and the whole workflow
  depends only on abstractions, so it is identical whether the module runs in-process or as an
  extracted service.
- **Where it's used**: subclassed by each app's sealed
  [`AuthenticationService`](group-24-identity-module.md#authenticationservice) (for example
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35`,
  which binds `TUser = User`, adds the Attendee default role (BR-45) and the `speaker_id` claim
  (BR-209, built at `:249-252`), and re-lists `IAuthenticationService` so it can re-implement
  `RegisterAsync` (`:57-62`) and `ExternalLoginAsync` (`:130-137`) outright: ADC raises its
  registration side-effects inside one `ExecuteInTransactionAsync` unit rather than through the
  `OnUserRegisteredAsync` hook, because the identity column means the id does not exist until the first
  save (`AuthenticationService.cs:16-32`, `:44`). MMCA.Store supplies its own subclass with a
  `customer_id` claim. Consumed by the Identity API controllers via the
  [`IAuthenticationService`](#iauthenticationservice) port.
- **Caveats / not-in-source**: the `user_id` claim is parsed with `int.TryParse` (line 238), so the
  refresh flow assumes `UserIdentifierType` is `int` (the framework alias today, per
  [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)); an app
  that redefined the alias would need to override the refresh handling. `ExternalLoginAsync` is
  intentionally **not** overridden here: the base inherits the interface's default "not supported"
  failure, and OAuth account linking stays in the app subclass because it is coupled to the app's
  `User` factory surface (doc comment, lines 30-31).


---
[⬅ Persistence & EF Core](group-07-persistence-ef-core.md)  •  [Index](00-index.md)  •  [Caching ➡](group-09-caching.md)
