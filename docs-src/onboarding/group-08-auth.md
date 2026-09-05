# 8. Authentication & Authorization

**What this group covers.** This is the security spine of the framework: how a caller proves who they
are (authentication), how the system decides what they may do (authorization), and how both survive
the jump from a single-process monolith to a fleet of extracted services. Almost every type here
serves one of nine moving parts: **minting and validating JWTs**
([`TokenService`](#tokenservice) / [`ITokenService`](#itokenservice),
[`RsaJwksProvider`](#rsajwksprovider) / [`IJwksProvider`](#ijwksprovider), and the settings that
select the algorithm and the key material: [`JwtSettings`](#jwtsettings),
[`JwtSigningAlgorithm`](#jwtsigningalgorithm), [`JwksSettings`](#jwkssettings)); **the shared login /
register / refresh workflow** ([`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser),
[`IAuthenticationService`](#iauthenticationservice),
[`AuthenticationValidators`](#authenticationvalidators)); **multi-device refresh sessions**
([`RefreshSession`](#refreshsession), [`IRefreshSessionStore`](#irefreshsessionstore),
[`RefreshSessionSettings`](#refreshsessionsettings),
[`RefreshSessionSummaryResponse`](#refreshsessionsummaryresponse), and the two workflow-private
helpers [`IssuedSession`](#issuedsession) and
[`SessionStampingTokenService`](#sessionstampingtokenservice)); **the contracts an app's `User`
aggregate exposes to those shared workflows** ([`IAuthUser`](#iauthuser),
[`IPasswordChangeableUser`](#ipasswordchangeableuser), [`IUserPreferences`](#iuserpreferences),
[`IErasableUser`](#ierasableuser)); **password material**
([`PasswordHasher`](#passwordhasher) / [`IPasswordHasher`](#ipasswordhasher)); **brute-force and
rate-limit protection** ([`LoginProtectionService`](#loginprotectionservice) /
[`ILoginProtectionService`](#iloginprotectionservice),
[`LoginProtectionSettings`](#loginprotectionsettings)); **the forgot-password token lifecycle**
([`PasswordResetTokenService`](#passwordresettokenservice) /
[`IPasswordResetTokenService`](#ipasswordresettokenservice),
[`PasswordResetEntry`](#passwordresetentry), [`PasswordResetSettings`](#passwordresetsettings));
**reading the current caller's identity from claims**
([`CurrentUserService`](#currentuserservice) / [`ICurrentUserService`](#icurrentuserservice),
[`ClaimsPrincipalExtensions`](#claimsprincipalextensions),
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider), [`AuthClaimTypes`](#authclaimtypes)); **the
authorization model** (permissions and resource ownership under
[`AuthorizationExtensions`](#authorizationextensions),
[`PermissionAuthorizationHandler`](#permissionauthorizationhandler), and
[`OwnerOrAdminFilter`](#owneroradminfilter)); and the HttpOnly **session-cookie** machinery
([`SessionCookieEndpoints`](#sessioncookieendpoints),
[`SessionCookieAuthenticationHandler`](#sessioncookieauthenticationhandler),
[`CookieSessionRefresher`](#cookiesessionrefresher)) that keeps server-side-rendered Blazor pages
authenticated across a cold navigation.

The governing decisions are [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)
(dual-fetch login and cross-service token validation via JWKS, with RS256 as the default because it
survives extraction),
[ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) (hashed,
rotating, per-device refresh sessions, which supersedes the storage model of
[ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) while keeping its
rotation and reuse-detection policy),
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
(brute-force protection),
[ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html) (PBKDF2-only
password hashing, superseding [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) (the cache-backed
forgot-password token),
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)
(permission-based authorization),
[ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)
(resource-ownership authorization),
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html) (the browser
session-cookie scheme),
[ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html) (how each render
head holds and reacquires a token), and
[ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) (runtime
revocation for a soft-deleted account). The rubric lenses are dominated by [Rubric §11, Security],
with supporting [Rubric §7, Microservices Readiness] and [Rubric §10, Cross-Cutting]. Auth surfaces
all of its expected failures (bad password, lockout, expired session, rejected reset token) as
[`Result`](group-01-result-error-handling.md#result) failures, never exceptions, so reading the
[Result pattern](group-01-result-error-handling.md#result) first pays off here.

## Tokens: one signing switch, two validation worlds

The framework mints two credentials on every successful sign-in: a short-lived **access token** (a
JWT, 15 minutes by default,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:61`) and an opaque,
random **refresh token** (64 bytes of `RandomNumberGenerator` output, Base64-encoded, valid 7 days by
default, `TokenService.cs:118-121`, `JwtSettings.cs:64`), both produced by
[`TokenService`](#tokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:24`). The access token
carries a fixed claim spine: `sub`, `jti`, `iat`, plus name, email, and role
(`TokenService.cs:90-99`), and the app adds its own claims (for example `speaker_id` or
`customer_id`) through the `additionalClaims` parameter (`TokenService.cs:101-104`). `sub` is the
single carrier of the user identifier: the duplicate custom claim that used to ride alongside it is
gone, because two values that can disagree is two claim names every reader has to know
(`TokenService.cs:87-89`). The port [`ITokenService`](#itokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:8`)
publishes both lifetimes as default interface members pinned to the same 15-minute / 7-day baseline
(`ITokenService.cs:33`, `ITokenService.cs:40`), so a hand-written test double reports the same expiry
the production settings would, while the concrete service derives them from the bound settings
(`TokenService.cs:125`, `TokenService.cs:128`).

The load-bearing design choice is a single configuration switch,
[`JwtSettings`](#jwtsettings)`.SigningAlgorithm`
(`TokenService.cs:64`). It defaults to
[`JwtSigningAlgorithm`](#jwtsigningalgorithm)`.RS256`
(`JwtSettings.cs:30`): the Identity service signs with an RSA private key and every other service
validates against the matching public key, which it fetches over JWKS. A single-host monolith opts
into `HS256` explicitly, where one symmetric Base64 secret both signs and validates because issuer
and validator are the same process (`TokenService.cs:64-75`, `TokenService.cs:180-192`). Asymmetric
is the default precisely because it is the shape that survives extraction: a compromised non-Identity
service can verify tokens but cannot forge them. An issuer with no explicit public key configured
derives one from its own private-key parameters so it can still self-validate during refresh
(`TokenService.cs:216-230`), and the key id from
[`JwksSettings`](#jwkssettings) travels into every RS256 token's
`kid` header so a validator reading the published document selects the right key by name rather than
trying each in turn (`TokenService.cs:209-213`). Key material is materialized once in the constructor
and the owned `RSA` handles are disposed with the service (`TokenService.cs:34-35`,
`TokenService.cs:174-178`), so token operations never re-parse a PEM. The settings class enforces the
pairing rather than trusting the host: it implements `IValidatableObject` and rejects an HS256 secret
shorter than 32 characters or an RS256 configuration with no private key (`JwtSettings.cs:70-85`).

The public half is served by [`RsaJwksProvider`](#rsajwksprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:14`), which lazily builds
a `JsonWebKeySet` from a PEM key (inline or read from a path) configured through
[`JwksSettings`](#jwkssettings) (`RsaJwksProvider.cs:27-55`,
`RsaJwksProvider.cs:57-73`), behind the [`IJwksProvider`](#ijwksprovider) port
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11`). Publishing is off by
default, and when disabled or unconfigured the provider returns an *empty* key set
(`RsaJwksProvider.cs:29-32`, `RsaJwksProvider.cs:35-38`) so the endpoint stays queryable but a
non-issuer host advertises nothing. The cache is a `Lazy<JsonWebKeySet>` in `PublicationOnly` mode
rather than the default `ExecutionAndPublication` (`RsaJwksProvider.cs:16-22`): the default caches a
factory *exception* forever, so a single transient IO failure reading the PEM would brick the endpoint
(and with it cross-service auth) until the process restarted. The endpoint itself,
`/.well-known/jwks.json`, is mapped in the API layer by
[`JwksEndpointExtensions`](group-12-api-hosting-mapping.md#jwksendpointextensions)
(path constant at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Endpoints/JwksEndpointExtensions.cs:20`, mapped
anonymously at `JwksEndpointExtensions.cs:33-39`), paired with the OIDC discovery document from
[`OidcDiscoveryEndpointExtensions`](group-12-api-hosting-mapping.md#oidcdiscoveryendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Endpoints/OidcDiscoveryEndpointExtensions.cs:27`);
[`OpenIdConnectMetadataWarmupTask`](group-16-aspire-orchestration.md#openidconnectmetadatawarmuptask)
pre-fetches that document as a startup warm-up task
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:21`) so the
first authenticated request on a cold replica does not pay the discovery round trip. Validation pins
the expected algorithm so an attacker cannot force an algorithm swap: `GetPrincipalFromExpiredToken`
sets `ValidAlgorithms` to the single configured value (`TokenService.cs:150`) and then re-checks the
token header after `ValidateToken` returns (`TokenService.cs:159-163`). Only the lifetime check is
skipped there (`TokenService.cs:145`), because the method exists to read claims out of an
already-expired token during refresh.

## The shared authentication workflow

Login, registration, refresh, revocation, and device listing are not re-implemented per app. They
live once in [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:53`), an abstract
base each app's Identity module seals over its concrete `User` aggregate. The base owns the sequence;
the sealed subclass supplies the genuinely app-specific pieces through abstract and virtual hooks:
`FindUntrackedByEmailAsync` and `EmailExistsAsync` (written against the concrete `User` so EF
translation is unchanged, `AuthenticationServiceBase.cs:505`, `AuthenticationServiceBase.cs:511`),
`CreateUser` (`AuthenticationServiceBase.cs:514`), `CreateAccessToken`
(`AuthenticationServiceBase.cs:517`), the two optional candidate gates
(`AuthenticationServiceBase.cs:552-557`), the post-commit `OnUserRegisteredAsync`
(`AuthenticationServiceBase.cs:563`), and the overridable "refresh user vanished" error
(`AuthenticationServiceBase.cs:571`, 401 by default because a token for a deleted user is
indistinguishable from an invalid one). Both token lifetimes are read from
[`ITokenService`](#itokenservice) with a defensive fallback to the 15-minute / 7-day baseline for a
misconfigured host or a test double (`AuthenticationServiceBase.cs:102-111`).

`LoginAsync` (`AuthenticationServiceBase.cs:121`) shows the shape. It validates the request first,
then runs the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
lockout check (`AuthenticationServiceBase.cs:133`), then does the **dual-fetch**: an untracked,
no-change-tracking query to verify the password cheaply (`AuthenticationServiceBase.cs:144`,
`AuthenticationServiceBase.cs:161`), and only on success a second *tracked* re-fetch of the instance
the app's `CreateAccessToken` hook mints from, which is also what turns a race that deleted the
account between the two steps into a clean 404 (`AuthenticationServiceBase.cs:169-178`). The email is
normalized through the [`Email`](group-02-domain-building-blocks.md#email) value object before the
query so the EF predicate compares same-typed converted values
(`AuthenticationServiceBase.cs:141`). Soft-deleted accounts fall out through EF global query filters
and return the same generic 401 as a wrong password (`AuthenticationServiceBase.cs:145-152`), so the
API never reveals whether an email exists, and a successful login clears the attempt counters
(`AuthenticationServiceBase.cs:181`) before handing off to the shared token-issue path
(`AuthenticationServiceBase.cs:183`).

`RegisterAsync` (`AuthenticationServiceBase.cs:187`) rate-limits by source IP, rejects a duplicate
email as a conflict, hashes the password, saves, and only then runs the app's post-commit hook, counts
the registration, and opens the session (`AuthenticationServiceBase.cs:199-263`). The up-front email
check is a check-then-act, so two concurrent registrations for the same address both pass it and the
loser only fails on the insert. The save is therefore wrapped in a deliberately broad catch that
re-checks the address and, if it now exists, returns the *same* conflict the serialized path would
have produced, rethrowing anything else (`AuthenticationServiceBase.cs:224-252`); the shared failure
factory keeps the two paths indistinguishable to the caller (`AuthenticationServiceBase.cs:752`). The
catch is broad because the Application layer has no EF Core dependency by layer rule and cannot name
`DbUpdateException`; the re-check is what narrows it, and it deliberately runs on
`CancellationToken.None` so a cancelled save can still be classified
(`AuthenticationServiceBase.cs:246`). `RefreshTokenAsync` (`AuthenticationServiceBase.cs:267`)
extracts claims from the *expired* access token (signature still verified, only lifetime skipped,
`AuthenticationServiceBase.cs:280`), reads the identifier off `sub` through
[`ClaimsPrincipalExtensions`](#claimsprincipalextensions) (`AuthenticationServiceBase.cs:291`), and
then resolves the presented refresh token to its session row. Every failure path returns a
[`Result`](group-01-result-error-handling.md#result) rather than throwing, matching the framework-wide
Result pattern (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

The request and response DTOs for these flows ([`LoginRequest`](#loginrequest),
[`RegisterRequest`](#registerrequest), [`RefreshTokenRequest`](#refreshtokenrequest),
[`AuthenticationResponse`](#authenticationresponse), [`ChangePasswordRequest`](#changepasswordrequest),
[`OAuthCodeExchangeRequest`](#oauthcodeexchangerequest), and the device-aware
[`AuthenticationRequest`](#authenticationrequest) used by MAUI clients) are compact `readonly record
struct`s in `MMCA.Common.Shared`. Several of them mark boundaries worth noting: password change is
dispatched straight through its command handler at the controller layer rather than brokered by
[`IAuthenticationService`](#iauthenticationservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:12`), the same is
true of the forgot/reset pair below ([`ForgotPasswordRequest`](#forgotpasswordrequest),
[`ResetPasswordRequest`](#resetpasswordrequest)), and `ExternalLoginAsync` has a default interface
implementation that *rejects* the call (`IAuthenticationService.cs:131-139`) because OAuth account
linking stays coupled to the app's own `User` factory. `OAuthCodeExchangeRequest` carries only an
opaque single-use code
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/OAuthCodeExchangeRequest.cs:11`) precisely so the
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

## Refresh sessions: one row per device

A refresh token is no longer a column on the user row. Every issue opens its own
[`RefreshSession`](#refreshsession)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:31`), so signing in on a phone
leaves a laptop signed in, and the store holds only the token's digest: `Create` hashes on the way in
so the plaintext never reaches a property (`RefreshSession.cs:112-145`), and `HashToken` is an
unsalted, deterministic SHA-256 rendered as 64 upper-case hex characters precisely because lookups are
*by* hash (`RefreshSession.cs:160-164`, width constant at `RefreshSession.cs:34`). The encoding is
part of the contract, not an implementation detail: the type's own remarks give the byte-for-byte SQL
Server equivalent a consumer's data migration has to reproduce (`RefreshSession.cs:151-157`). The row
is deliberately *not* an aggregate: no audit stamps, no soft-delete flag, no concurrency token, like
`OutboxMessage` and `AuditTrailEntry`, because rows are only ever inserted or revoked and no global
query filter may hide a revoked row from the reuse check (`RefreshSession.cs:22-29`). `Revoke` is
idempotent by refusal, so the first reason and instant recorded are the ones kept
(`RefreshSession.cs:174-189`), and the four reason constants (`Rotated`, `SignedOut`, `ReuseDetected`,
`SessionCapExceeded`, `RefreshSession.cs:46-55`) are what an operator reads afterwards.

Rotation leaves a chain, and the chain is the security mechanism. Using a session revokes it and
records the successor in `ReplacedByTokenHash` (`RefreshSession.cs:79`), so presenting an
already-rotated token lands on a *revoked* row rather than on nothing: that is the
[ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) reuse signal, and
the workflow answers it by revoking every live session the user holds
(`AuthenticationServiceBase.cs:603-610`, `AuthenticationServiceBase.cs:705-715`). The three
rejections behind the single generic error are deliberately different in what they *do*
(`AuthenticationServiceBase.cs:575-615`): an unknown hash, or one belonging to another account, is
failed alone, since revoking the family on it would let anyone holding one of this user's expired
access tokens sign them out everywhere by posting a random string; a revoked row revokes the family;
an expired row is an ordinary end of life, so that device re-authenticates while the others keep
working. Two requests presenting the same still-live token are covered by the same rule: rotation is
claimed atomically through [`IRefreshSessionStore`](#irefreshsessionstore)`.TryRotateAsync`
(`AuthenticationServiceBase.cs:685-699`), and the request that loses the claim is answered exactly
like a replay because a caller cannot tell the two apart.

[`IRefreshSessionStore`](#irefreshsessionstore)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:21`) is the narrow
persistence port: add, find by hash (revoked and expired rows included, which is load-bearing for
reuse detection, `IRefreshSessionStore.cs:28-37`), list a user's un-revoked sessions
(`IRefreshSessionStore.cs:45`), find one of a user's sessions by id with the owner *inside* the query
so another account's id is indistinguishable from a nonexistent one (`IRefreshSessionStore.cs:49-62`),
save, and `TryRotateAsync` (`IRefreshSessionStore.cs:95`). Implementations must return **tracked**
instances, because revocation is a mutation on an instance the store handed out and a no-tracking read
would drop it at save time (`IRefreshSessionStore.cs:16-19`). The default `TryRotateAsync` body
(revoke in memory, add, save) is atomic only per instance, which is all an in-memory or test store can
offer; the shipped EF implementation
[`EFRefreshSessionStore`](group-07-persistence-ef-core.md#efrefreshsessionstore) overrides it with a
conditional `ExecuteUpdateAsync` the database arbitrates
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:108-133`).
That is the [Rubric §8, Data Architecture] half of the story, and the store is registered scoped
alongside the unit of work it shares a `DbContext` with, so a login and its session insert commit
together (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:157-163`).

The workflow around the port is small and worth reading end to end.
`IssueTokensAsync` (`AuthenticationServiceBase.cs:474`) opens the session *before* it mints the access
token, because the token carries the session's id and a session only has an id once it has been
created (`AuthenticationServiceBase.cs:484-498`); `OpenSessionAsync`
(`AuthenticationServiceBase.cs:623`) mints the refresh token, builds the row, and first enforces the
per-user cap by revoking the oldest live sessions
(`AuthenticationServiceBase.cs:645`, `AuthenticationServiceBase.cs:725-738`), so one account cannot
grow the table without bound while a legitimate sign-in never fails. Both helpers return
[`IssuedSession`](#issuedsession) (`AuthenticationServiceBase.cs:761`), the private pair of "the
plaintext token, which exists nowhere else" and "the row id". The id reaches the client as the
standard `sid` claim, stamped by [`SessionStampingTokenService`](#sessionstampingtokenservice)
(`AuthenticationServiceBase.cs:773`), a pass-through `ITokenService` armed for the duration of the
app's `CreateAccessToken` call (`AuthenticationServiceBase.cs:538-549`,
`AuthenticationServiceBase.cs:792-802`). Doing it with a wrapper rather than by changing the hook's
signature is what makes the claim additive: every existing subclass keeps compiling and starts
emitting `sid` with no edit. `GetSessionsAsync` (`AuthenticationServiceBase.cs:401`) projects the
user's live sessions into [`RefreshSessionSummaryResponse`](#refreshsessionsummaryresponse)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:23`), newest first,
flagging the caller's own device by comparing against the token's `sid`
(`AuthenticationServiceBase.cs:409-422`); the response deliberately omits the token hash and the
rotation link, since nothing a client does with a session needs anything but its id
(`RefreshSessionSummaryResponse.cs:6-11`). `RevokeSessionByIdAsync`
(`AuthenticationServiceBase.cs:439`) signs one device out and treats an already-revoked row as a
success that writes nothing, because a device list clicked twice is the most ordinary duplicate in the
feature (`AuthenticationServiceBase.cs:452-457`), while `RevokeTokenAsync`
(`AuthenticationServiceBase.cs:336`) degrades to signing every device out when the presented token does
not identify a live session of this user's (`AuthenticationServiceBase.cs:349-367`). Those methods
surface on [`IAuthenticationService`](#iauthenticationservice) (`IAuthenticationService.cs:79`,
`IAuthenticationService.cs:96`, `IAuthenticationService.cs:115`) and are exposed by
[`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) as `revoke`, `my-sessions`,
and a per-session route
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:144`,
`AuthControllerBase.cs:175`, `AuthControllerBase.cs:222`).

[`RefreshSessionSettings`](#refreshsessionsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:9`) is where a host
tunes the model: `MaxActiveSessionsPerUser` (default 10, range 1 to 1000,
`RefreshSessionSettings.cs:34-35`), `RetentionDays` (default 30, `RefreshSessionSettings.cs:71-72`),
`CleanupIntervalHours` (default 6, `RefreshSessionSettings.cs:79-80`), the `DataSourceName` that says
which database carries the table (`RefreshSessionSettings.cs:51-52`), and `Enabled`
(`RefreshSessionSettings.cs:25`), which gates the *model*, not the workflow: the service that owns
identity sets it, every other service in a modular host leaves it alone, and that is what keeps the
table, its migrations, and its sweep in exactly one database. Retention is not decoration: the
settings' own remarks state that the sweep bounds reuse detection, because once a revoked row is
swept, a replay of its token reads as an unknown token and fails alone
(`RefreshSessionSettings.cs:59-66`). The hosted sweep
[`RefreshSessionCleanupService`](group-07-persistence-ef-core.md#refreshsessioncleanupservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:48`)
is registered only when the flag is set, so a service with no `RefreshSessions` table never starts a
sweep over a table it does not have
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:165-172`), and the mapping
itself is opt-in through
[`RefreshSessionModelBuilderExtensions`](group-07-persistence-ef-core.md#refreshsessionmodelbuilderextensions)`.ApplyRefreshSessionConfiguration`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:34`).
This whole cluster is [Rubric §7, Microservices Readiness] as much as [Rubric §11, Security]: the
credential store is one service's table, not a column every service's user model has to carry.

## What the app's User aggregate must expose

The shared workflows never see an app's `User` class. They see four small Domain-layer contracts, each
sized to one workflow, which is the [Rubric §1, SOLID] interface-segregation story in miniature.
[`IAuthUser`](#iauthuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:16`) is now the *password* surface and
nothing else: the hash and the salt whose length once selected an algorithm (`IAuthUser.cs:19-23`).
Refresh tokens are deliberately absent, and the interface says why: they used to live here as a single
plaintext column, which capped every account at one signed-in device and put a usable credential in the
users table (`IAuthUser.cs:9-14`). Profile fields, roles, and linked aggregates stay app-specific and
are reached only through the per-app hooks.
[`IPasswordChangeableUser`](#ipasswordchangeableuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11`) extends it with
`ChangePassword` (`IPasswordChangeableUser.cs:19`), because both the rotation workflow and the reset
workflow have to write a new credential through the aggregate rather than around it.
[`IUserPreferences`](#iuserpreferences)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:10`) carries the stored culture
and theme plus a single `UpdatePreferences` mutator that always replaces *both* fields
(`IUserPreferences.cs:13-25`); the shared workflow is what preserves the other preference, passing the
stored value for any field the request left null
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53-55`),
which is the null-means-unchanged contract stated on
[`ChangePreferencesRequest`](#changepreferencesrequest) and mirrored by
[`UserPreferencesResponse`](#userpreferencesresponse)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePreferencesRequest.cs:10`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/UserPreferencesResponse.cs:9`).

[`IErasableUser`](#ierasableuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30`) is the subtlest of the four. It
extends [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and *redeclares* `Delete()`
(`IErasableUser.cs:37`) rather than inheriting it from `AuditableBaseEntity<TId>`, because an app
`User` commonly **hides** the base method (`public new Result Delete()`) to add account-specific
behavior. A hidden method is not an override, so a shared workflow calling through the class constraint
would silently run the base implementation and skip that behavior; routing the call through this
interface makes the interface map resolve to the most derived `Delete()` (`IErasableUser.cs:11-24`).
The base entity deliberately does not implement the interface, so a consumer that forgets to add it
fails the generic constraint at compile time instead of losing behavior at run time
(`IErasableUser.cs:25-28`). These four contracts are consumed by the shared handler bases in group 14:
[`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:25`),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
[`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:31`),
and
[`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:58`),
each of which constrains `TUser` to the matching contract.

## Passwords and brute-force protection

Password material is handled by [`PasswordHasher`](#passwordhasher)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:12`), which hashes with
PBKDF2-HMAC-SHA512 at 600,000 iterations (OWASP 2023 guidance, `PasswordHasher.cs:24`) over a 32-byte
random salt (`PasswordHasher.cs:15`, `PasswordHasher.cs:31`) into a 64-byte output
(`PasswordHasher.cs:18`), and verifies in constant time via
`CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:53`) to close the timing side channel.
PBKDF2 is now the *only* path: the legacy single-round HMAC branch, and with it the algorithm
selection keyed on stored salt length, is gone
([ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html)), so one
algorithm derives and verifies every stored credential (`PasswordHasher.cs:7-10`,
`PasswordHasher.cs:57-63`). That is a compact [Rubric §11, Security] story: a modern KDF and a
constant-time compare in one small type, all behind the [`IPasswordHasher`](#ipasswordhasher) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:6`) so
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
`LoginProtectionService.cs:101-136`). Every setting carries a `[Range]` attribute, which is what makes
the clamp argument airtight: `MaxLockoutSeconds` cannot exceed 3600 (`LoginProtectionSettings.cs:23`),
and `1 << 30` already dwarfs that. The [`ILoginProtectionService`](#iloginprotectionservice) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`) is what the
workflow depends on, and it calls the gates at exactly the right points (increment on failed login,
reset on success), so the protection is centralized rather than sprinkled through each app's
controller. One documented trade-off is stated in source: the attempt increment is a
read-modify-write rather than an atomic counter, because the native Redis `INCR` path wrote a key shape
`IDistributedCache` could not read back (`LoginProtectionService.cs:66-74`). Sequential guessing, which
is what a credential-stuffing run looks like, still trips the lockout.

## Forgot password: a cache-backed single-use token

A user who has lost the password cannot present one, so this flow is anonymous by necessity, which
makes every one of its responses a potential account-enumeration oracle. It is also built without a
schema change: the token lives in the cache, hashed, and expires by TTL rather than being reaped by a
sweeper ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). The
port is [`IPasswordResetTokenService`](#ipasswordresettokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IPasswordResetTokenService.cs:10`), two methods
wide: `IssueAsync` mints a token for an address (`IPasswordResetTokenService.cs:23`) and
`ValidateAndConsumeAsync` redeems it exactly once (`IPasswordResetTokenService.cs:36`). The
implementation, [`PasswordResetTokenService`](#passwordresettokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26`), rides on
[`ICacheService`](group-09-caching.md#icacheservice) and buys four properties in a few lines each:

- **One active token per email.** Issuing writes the same per-address key
  (`PasswordResetTokenService.cs:51`, `PasswordResetTokenService.cs:88`), so requesting a new link
  retires the previous one.
- **Hashed at rest.** Only the Base64 of the token's SHA-256 is stored
  (`PasswordResetTokenService.cs:55-56`, `PasswordResetTokenService.cs:82-88`), so a cache dump hands
  out no working reset links, and the comparison on redemption is constant time through
  `CryptographicOperations.FixedTimeEquals` (`PasswordResetTokenService.cs:118`).
- **An attempt cap.** A wrong token increments a counter on the record, and the record is discarded at
  `MaxValidationAttempts` (`PasswordResetTokenService.cs:132-153`, default 5,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:36`). The rewrite
  after a wrong guess uses the record's *remaining* lifetime rather than a fresh one
  (`PasswordResetTokenService.cs:146-152`), so guessing cannot extend the redeemable window.
- **A per-email request throttle.** A counter carrying the window's TTL caps how often one address can
  trigger an email (`PasswordResetTokenService.cs:66-77`, default 3 per 60 minutes,
  `PasswordResetSettings.cs:40`, `PasswordResetSettings.cs:44`), and a successful redemption deletes
  the token *and* that counter (`PasswordResetTokenService.cs:126-127`) so a legitimate reset does not
  leave the user throttled out of a later one.

Keys are built from an `Email`-normalized identity for the same reason
[`LoginProtectionService`](#loginprotectionservice) does it
(`PasswordResetTokenService.cs:34-53`). The cached record, [`PasswordResetEntry`](#passwordresetentry)
(`PasswordResetTokenService.cs:171`), is deliberately all JSON primitives: cache values round-trip
through `System.Text.Json`, so a value object or a `byte[]` member would not survive a distributed
backing store (`PasswordResetTokenService.cs:162-166`). Token material is 32 random bytes, Base64Url
encoded (`PasswordResetTokenService.cs:30`, `PasswordResetTokenService.cs:79`), redeemable for
`TokenLifetimeMinutes` (default 30, `PasswordResetSettings.cs:29`), and every rejection (unknown,
expired, mismatched, attempt-capped) collapses into one generic failure
(`PasswordResetTokenService.cs:155-159`). The settings bind from the `PasswordReset` configuration
section and the service is registered scoped in Infrastructure DI (`PasswordResetSettings.cs:13`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:151-155`).

The workflow around the port lives in the group-14 handler bases, and it is where the
anti-enumeration rule is enforced.
[`ForgotPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:36`)
resolves the account through its one abstract lookup, issues a token, and mails it through
[`IEmailSender`](group-10-notifications.md#iemailsender) (`ForgotPasswordHandlerBase.cs:84-89`), but a
malformed address, an address with no account, a throttled request, and a failed send all log and
return success alike (`ForgotPasswordHandlerBase.cs:60-63`, `ForgotPasswordHandlerBase.cs:68-71`,
`ForgotPasswordHandlerBase.cs:75-78`, `ForgotPasswordHandlerBase.cs:91-97`). The only 400 comes from
[`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:11`),
which inspects the shape of the address and nothing else. The email carries both a prefilled link
(composed from `PasswordResetSettings.ResetUrl`, deliberately not required so a host that has not
configured a UI base still boots, `PasswordResetSettings.cs:25`,
`ForgotPasswordHandlerBase.cs:145-148`) and the raw token, because a client without deep linking (the
MAUI head) needs it typed into the reset page by hand (`ForgotPasswordHandlerBase.cs:124`).
[`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:31`)
consumes the token *before* the save on a stated trade-off (leaving it live until the write succeeds
opens a replay window; a token burned by a later invariant failure costs the user one more reset
request, `ResetPasswordHandlerBase.cs:59-69`), hashes through [`IPasswordHasher`](#ipasswordhasher)
and writes the credential through the aggregate's `ChangePassword`
(`ResetPasswordHandlerBase.cs:80-81`), then clears the login-protection counters so a user who reset
*because* of a lockout is not left locked out (`ResetPasswordHandlerBase.cs:90`).
[`ResetPasswordRequestValidator`](#resetpasswordrequestvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:12`)
includes the same [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest) that
registration and change-password use (`ResetPasswordRequestValidator.cs:23`), so a reset is not a way
around the complexity policy. The endpoints are
[`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:43`):
both actions are `[AllowAnonymous]` and rate-limited per IP exactly as login and register are
(`PasswordResetAuthControllerBase.cs:77-78`, `PasswordResetAuthControllerBase.cs:101-102`),
`forgot-password` answers 202 for any well-formed request (`PasswordResetAuthControllerBase.cs:79`,
`PasswordResetAuthControllerBase.cs:92`), and `reset-password` collapses every rejection into a single
401 (`PasswordResetAuthControllerBase.cs:105`).

## Reading identity from claims

Once a request is authenticated, downstream code needs the caller's identity without re-parsing the
JWT, and it needs one answer no matter which pipeline produced the principal. That is the job of
[`ClaimsPrincipalExtensions`](#claimsprincipalextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:18`): `FindUserIdValue`
reads the raw `sub` claim and falls back to the `ClaimTypes.NameIdentifier` form the JWT bearer
handler maps it onto (`ClaimsPrincipalExtensions.cs:26-28`), `GetUserId` parses that value through
`IParsable<T>` in the invariant culture so the solution-wide identifier alias can change shape without
editing any reader (`ClaimsPrincipalExtensions.cs:40-44`), and `FindSessionId` reads the `sid` claim,
treating absence as an ordinary "the caller's own device is unknown" rather than an error
(`ClaimsPrincipalExtensions.cs:56-60`). [`AuthClaimTypes`](#authclaimtypes)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:9`) names the three claim types
this group cares about: the framework-custom `"permission"` (`AuthClaimTypes.cs:17`) used by the
authorization model below, plus the standard `sub` (`AuthClaimTypes.cs:27`) and `sid`
(`AuthClaimTypes.cs:40`), each documented with the pipeline caveat that motivates reading it through
the extensions.

[`CurrentUserService`](#currentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:17`) is the scoped
adapter over `IHttpContextAccessor`: it exposes the `ClaimsPrincipal`, the parsed user id, and the
first role claim, caching the parsed values behind a per-request `Lazy<T>`
(`CurrentUserService.cs:19-23`) and reading the identifier through the shared extensions
(`CurrentUserService.cs:20`). Its generic `GetClaimValue<T>` (`CurrentUserService.cs:35`) is what the
ownership filter uses to read app-specific owner claims, and it parses in the invariant culture
because claims are machine-written and the ambient request culture must not decide how a separator
reads (`CurrentUserService.cs:39-41`). The interface itself,
[`ICurrentUserService`](#icurrentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:9`),
carries the multi-role logic as *default interface members*: `Roles` reads every role claim across the
three claim-type spellings the JWT middleware may produce and falls back to the single `Role` property
when a hand-written double populates only that (`ICurrentUserService.cs:45-64`), and `IsInRole` does a
case-insensitive membership check over that set (`ICurrentUserService.cs:88-89`). A sibling adapter,
[`ClaimBasedUserIdProvider`](#claimbaseduseridprovider)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:11`), plugs
the same identifier into SignalR's `IUserIdProvider` so `Clients.User(userId)` routes hub messages to
the right connections (`ClaimBasedUserIdProvider.cs:14-15`).

## Authorization: permissions and ownership

There is **one** authorization model here, and it is capabilities, not role names. The single
`AddAuthorizationPolicies()` extension in [`AuthorizationExtensions`](#authorizationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12`,
`AuthorizationExtensions.cs:23`) wires the whole mechanism: the handler, the on-demand policy
provider, and the shared registry (`AuthorizationExtensions.cs:25-36`). Role *names* still exist as
data, in [`RoleNames`](#rolenames)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:12`, five constants across both apps:
`Organizer`, `Attendee`, `ContentEditor`, `Admin`, `Customer`, `RoleNames.cs:15-31`), and roles get a
value-object base, [`RoleValue`](#rolevalue)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25`), so each app can fix its own role
set with case-insensitive, type-guarded equality (`RoleValue.cs:90-96`), a frozen interned lookup
(`RoleValue.cs:75-84`), and `Result`-returning validation (`RoleValue.cs:42`) while staying
dependency-free enough to use from Blazor WASM. What no longer exists is a shipped policy per role:
an endpoint states the capability it needs and the registry maps roles to capabilities
([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)).

[`HasPermissionAttribute`](#haspermissionattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13`) marks a
controller or action with a permission such as `"sessions:manage"`; under the hood it is an
`AuthorizeAttribute` whose policy name is `perm:sessions:manage`
([`PermissionPolicy`](#permissionpolicy)`.NameFor`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`,
`PermissionPolicy.cs:17`, applied at `HasPermissionAttribute.cs:17-18`). Rather than pre-registering a
named policy per permission, [`PermissionPolicyProvider`](#permissionpolicyprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13`)
materializes those policies on demand for any `perm:` name and falls through to the default provider
for everything else (`PermissionPolicyProvider.cs:31-47`). The requirement it attaches,
[`PermissionRequirement`](#permissionrequirement)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10`), is
evaluated by [`PermissionAuthorizationHandler`](#permissionauthorizationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14`),
which grants access when the principal holds the permission directly (a `permission` claim) *or*
derives it from one of its roles via [`IPermissionRegistry`](#ipermissionregistry)
(`PermissionAuthorizationHandler.cs:30-31`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:13`), reading roles across the
same three claim-type spellings (`PermissionAuthorizationHandler.cs:43-49`). The registry itself
([`PermissionRegistry`](#permissionregistry),
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:10`) is an immutable, frozen
role-to-permission map with case-insensitive role keys and ordinal permission values
(`PermissionRegistry.cs:25-28`) built by
[`PermissionRegistryBuilder`](#permissionregistrybuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:8`); each module
contributes only its own grants through `AddPermissions(...)`
(`AuthorizationExtensions.cs:47-55`), duplicate grants union rather than collide
(`PermissionRegistryBuilder.cs:25-42`), and the shared registry is built lazily on first resolve, after
every module has registered (`AuthorizationExtensions.cs:61-74`). That module-local contribution is the
[Rubric §7, Microservices Readiness] touch: an extracted service carries only its own permission
grants.

The same capabilities reach *inside* the CQRS pipeline, not just the HTTP boundary: a command or query
that implements [`IRequiresPermission`](group-05-cqrs-pipeline.md#irequirespermission) is checked by
[`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult)
and
[`AuthorizationQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#authorizationquerydecoratortquery-tresult)
against the same registry. Because those decorators are registered unconditionally, a host with no
Identity module and no grants would fail to activate every handler in the pipeline, which is what
[`UnconfiguredPermissionRegistry`](#unconfiguredpermissionregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:20`) exists to
prevent: it is registered with `TryAdd`, so a host that called `AddAuthorizationPolicies()` keeps its
own registry and never constructs this one
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:126`). It grants nothing, so a
permission-gated request is *denied* rather than allowed (`UnconfiguredPermissionRegistry.cs:28-42`),
and it says so exactly once, in a log message naming the call that would fix it
(`UnconfiguredPermissionRegistry.cs:49-60`). The warning is deferred to the first real check rather
than raised at startup, because a host with no permission-gated request is correctly configured: it
simply never needs a registry (`UnconfiguredPermissionRegistry.cs:44-48`). Fail-closed plus a
diagnosable message is the [Rubric §11, Security] and [Rubric §13, Observability & Operability]
reading of that type.

The second style is **resource ownership**. [`OwnerOrAdminFilter`](#owneroradminfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31`) is an action
filter for endpoints that mix admin and owner access (carts, orders, bookmarks). It lets a bypass role
through (`OwnerOrAdminFilter.cs:43`), then compares the caller's owner claim against the resource id
taken from either the route or a bound argument (`OwnerOrAdminFilter.cs:49`,
`OwnerOrAdminFilter.cs:93-111`), returning 403 otherwise. The important property is that it **denies by
default**: when the owner claim is missing (`OwnerOrAdminFilter.cs:51-55`) or the owner parameter
cannot be resolved at all, the request is rejected rather than waved through
(`OwnerOrAdminFilter.cs:57-71`), because "nothing to compare" must not read as "nothing to enforce". An
action that legitimately has no owner parameter opts out explicitly with
[`AllowMissingOwnerAttribute`](#allowmissingownerattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21`),
honored from either the action or its declaring controller via endpoint metadata
(`OwnerOrAdminFilter.cs:82-85`, `AllowMissingOwnerAttribute.cs:20`), and the attribute's own remarks
require the application site to name the guard that replaces the check
(`AllowMissingOwnerAttribute.cs:15-19`). The filter's vocabulary (claim type, bypass role, route
parameter) is configurable through
[`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions)
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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:52`) through
the [`ICookieSessionRefresher`](#icookiesessionrefresher) port (`CookieSessionRefresher.cs:30`). The
refresher first tries to read a still-valid expiry out of the access cookie with a 30-second skew
allowance (`CookieSessionRefresher.cs:60`, `CookieSessionRefresher.cs:155-184`); failing that it
exchanges the refresh cookie at the API's `auth/refresh` endpoint server-to-server
(`CookieSessionRefresher.cs:128-131`), so the refresh token never reaches browser JS. It then writes
the rotated pair back as cookies and stashes the fresh access token on `HttpContext.Items`
(`CookieSessionRefresher.cs:88-92`) so the *current* request's authentication reads the new token:
[`CookieTokenReader`](#cookietokenreader) checks that item before falling back to the request cookie
(`CookieTokenReader.cs:17`, `CookieTokenReader.cs:27-33`). Concurrent refreshes are collapsed into a
single flight by a [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) keyed on the refresh token plus a
10-second rotation-grace `IMemoryCache` entry keyed by the **old** refresh token
(`CookieSessionRefresher.cs:61`, `CookieSessionRefresher.cs:63`, `CookieSessionRefresher.cs:96-112`,
`CookieSessionRefresher.cs:145`), so a queued herd of requests cannot double-rotate. Striping rather
than one process-wide lock is deliberate and stated in source: the lock is held across an outbound HTTP
call, so a single semaphore serialized every unrelated user's cold navigation behind whichever refresh
was in flight (`CookieSessionRefresher.cs:45-50`); two unrelated tokens sharing a stripe is harmless
because the grace cache is re-checked per token after acquiring
(`CookieSessionRefresher.cs:105-109`). A transport failure is not cached and renders the request
anonymously rather than throwing a 500 out of SSR (`CookieSessionRefresher.cs:118-123`,
`CookieSessionRefresher.cs:148-152`). The same refresher backs the same-origin
`POST /auth/session/token` endpoint the browser polls to hydrate its in-memory token
(`SessionCookieEndpoints.cs:45-60`), guarded by `SameSite=Lax` plus a `Sec-Fetch-Site` cross-site
rejection (`SessionCookieEndpoints.cs:48-51`, `SessionCookieEndpoints.cs:68-70`) and returning
[`SessionTokenResponse`](#sessiontokenresponse) (`CookieSessionRefresher.cs:21`), the browser-safe
projection of the internal [`SessionTokenResult`](#sessiontokenresult)
(`CookieSessionRefresher.cs:15`) that deliberately omits the refresh token. This whole cluster is
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
(`UserDataExportDTO.cs:40`), and an ordered list of
[`UserDataExportSectionDTO`](#userdataexportsectiondto) envelopes (`UserDataExportDTO.cs:48`,
`UserDataExportDTO.cs:61`). Each section reports `Available` explicitly (`UserDataExportDTO.cs:72`) so
a reader can tell "this subject has no data here" apart from "this contributor could not be reached",
and an unavailable section carries only a caller-safe reason string, never an exception message or a
connection string (`UserDataExportDTO.cs:88`). One failing contributor therefore degrades one section
instead of denying the subject their whole export, which is the [Rubric §30, Compliance/Privacy/Data
Governance] point of the shape. [`PrivacyFeatures`](#privacyfeatures)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6`) holds the single flag name
`Privacy.DataExport` (`PrivacyFeatures.cs:9`) that keeps the whole surface off until a host turns it
on, applied as a `[FeatureGate]` on
[`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery).
The composing workflow
([`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery)
and the [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection)
contributors) lives in group 14
([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)).

## Shared primitives and adjacent members

Several group members are general-purpose primitives that landed in this chapter because of how the
dependency grouping fell, though one of them is now load-bearing for auth.
[`KeyedSemaphoreStripe`](#keyedsemaphorestripe)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`) and its
[`Releaser`](#releaser) handle (`KeyedSemaphoreStripe.cs:78`) serialize work per logical key across a
fixed set of semaphores (256 by default, `KeyedSemaphoreStripe.cs:25`, with an explicit-width
constructor at `KeyedSemaphoreStripe.cs:37`; acquisition maps the key onto one stripe at
`KeyedSemaphoreStripe.cs:60-75`). That is the bounded alternative to a semaphore-per-key dictionary,
which forces a choice between two defects: removing the entry on release opens a window where one
caller waits on a semaphore no longer in the table while another creates a fresh one, and never
removing it lets caller-supplied keys grow the table without bound
(`KeyedSemaphoreStripe.cs:7-16`). Its consumers today are
[`CookieSessionRefresher`](#cookiesessionrefresher) (above, `CookieSessionRefresher.cs:63`),
the [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:90`),
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:249`),
[`MemoryCacheService`](group-09-caching.md#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:38`), and the
default `GetOrCreateAsync` lock table on
[`ICacheService`](group-09-caching.md#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:145`).
[`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) is the
deliberate exception: it keys on the exact key in a `ConcurrentDictionary` instead, because its
contract has a *bounded* wait, and stripe false-sharing would turn that into a spurious
"held elsewhere" answer for a key nobody holds
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:19-24`).

Three HTTP and convention helpers sit in `MMCA.Common.Shared` for the same structural reason: both
ends of an exchange need them and the two packages do not reference each other.
[`IdempotencyHeaders`](#idempotencyheaders)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13`) is a two-constant class
holding `Idempotency-Key` and `X-Idempotent-Replay`, read by the API filter and written by the UI
service bases (`IdempotencyHeaders.cs:19`, `IdempotencyHeaders.cs:25`).
[`ConcurrencyETag`](#concurrencyetag)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:24`) translates between the EF
Core `rowversion` token and the HTTP entity tag that represents it: `Format` renders the base64 of the
raw token as a **weak** tag (`ConcurrencyETag.cs:40-45`), weak on purpose because the same row version
renders differently under a `fields=` projection and a strong tag would be promising byte-for-byte
equality it cannot deliver (`ConcurrencyETag.cs:12-18`), and the parse side tolerates the weak prefix
and the quotes while treating a blank value, the `*` wildcard, and a non-base64 payload alike as "no
concrete token" for the caller to classify (`ConcurrencyETag.cs:27-33`, `ConcurrencyETag.cs:52-60`).
[`ProblemDetailsResultReader`](#problemdetailsresultreader)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:58`) is the client-side
inverse of the API's error contract: it turns a response body back into
[`Error`](group-01-result-error-handling.md#error) values, synthesizing a status-derived code
(`Http.404` and friends, `ProblemDetailsResultReader.cs:65`) when the payload carries no
machine-readable code, and it is explicit that the reverse mapping is lossy for 400, where Validation,
Invariant and Failure all collapse onto one status
(`ProblemDetailsResultReader.cs:50-56`). [`ModuleNameConventions`](#modulenameconventions)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:10`) derives a type's
owning module from its namespace under the `MMCA.{App}.{Module}.{Layer}` convention
(`ModuleNameConventions.cs:38-45`); it lives in Shared because both persistence (schema and data-source
names) and the Application-layer CQRS logging decorators need it, and Application may not reference
Infrastructure (`ModuleNameConventions.cs:6-8`). Its layer list deliberately omits `Shared`
(`ModuleNameConventions.cs:17`) so a framework namespace never resolves to a phantom module.
[`IcsEvent`](#icsevent) and [`IcsCalendarBuilder`](#icscalendarbuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12`) build RFC 5545
calendar (`.ics`) exports from UTC-normalized event times, with 75-octet line folding and CRLF endings
(`IcsCalendarBuilder.cs:14` for the `MaxLineOctets` budget; the folding and the `\r\n` writes both live
in `AppendLine`, `IcsCalendarBuilder.cs:83-104`).

Two genuine auth members sit at the edge of the group.
[`ISoftDeletedUserValidator`](#isoftdeleteduservalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7`)
is the small contract the API's
[`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) uses to reject
an otherwise-valid token whose backing account has since been soft-deleted (BR-133,
[ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)),
implemented by each Identity module so Common never takes a cross-module domain reference. Its fast
path is [`SoftDeletedUserCache`](#softdeletedusercache)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17`), which owns both the
key shape and the 30-second marker lifetime (`SoftDeletedUserCache.cs:29`, `SoftDeletedUserCache.cs:42`)
so the module that deletes an account writes exactly the key the middleware reads; the marker only has
to outlive the window between the delete committing and the next validator query, and the 15-minute
access-token lifetime bounds the rest of the exposure (`SoftDeletedUserCache.cs:22-28`). The key is
formatted invariantly on purpose, because a culture-sensitive identifier would be written under one
request's culture and missed under another (`SoftDeletedUserCache.cs:36-43`). The controller surface
that drives everything above
([`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase),
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase),
[`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand),
[`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand),
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
  Governance & Documentation]` (assesses whether a deliberate exemption is written down where it
  applies, so it can be audited later). The filter this attribute exempts from denies the request when
  it cannot resolve an owner parameter, because "no owner to compare" must not read as "no restriction"
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:6-13`).
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:84-85`).
- **Why it's built this way**: an empty marker keeps the opt-out cheap to apply and impossible to
  mis-configure, but the `<remarks>` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:15-19`)
  is the load-bearing half of the design: applying it is an *assertion* that the action is guarded
  elsewhere, so every application site is expected to name the replacement guard in a comment. That
  turns a silent hole into a reviewable claim ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)
  records the audit that produced the current application sites).
- **Where it's used**: honored by [`OwnerOrAdminFilter`](#owneroradminfilter) through endpoint
  metadata. In MMCA.Store it marks four actions on
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:98,113,142,178`
  and five on
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/CustomersController.cs:49,61,78,110,131`,
  both controllers naming the replacing guard in an inline comment next to the attribute
  (`ShoppingCartsController.cs:93-97`, `CustomersController.cs:48`).
- **Caveats / not-in-source**: nothing enforces the assertion. No analyzer or compile-time rule checks
  that an action carrying this attribute really is guarded another way; the guarantee is a review
  convention. Store closes the specific gap it opens with a hand-written `RequireResolvableOwner()` gate
  on the collection reads (`ShoppingCartsController.cs:80-90`), but that gate is per-controller code,
  not something the attribute demands.

### OwnerOrAdminFilterOptions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11` · Level 0 · class (options)

- **What it is**: a host-configurable options object that supplies the three vocabulary values
  [`OwnerOrAdminFilter`](#owneroradminfilter) needs: which claim carries the caller's owner id, which
  role bypasses the ownership check, and which route or argument parameter names the resource owner.
- **Depends on**: nothing first-party.
- **Concept introduced, externalizing a filter's vocabulary through the options pattern.**
  `[Rubric §11, Security]` (assesses whether the ownership rule is enforced consistently; here the rule
  is fixed in code while its identifiers are configuration) and `[Rubric §16, Maintainability]`
  (assesses whether a second host can reuse a component without forking it). The doc comment cites
  [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:4`):
  the filter used to hard-code MMCA.Store's `customer_id` / `Admin` / `id` triple, and moving those into
  an `IOptions<T>`-bound class lets an app with a different ownership vocabulary (a `UserId` claim with
  an `Organizer` bypass keyed by a `userId` route value) reconfigure it via
  `services.Configure<OwnerOrAdminFilterOptions>(...)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:5-9`).
- **Walkthrough**: three mutable auto-properties, each seeded with the original default so an unchanged
  host needs no configuration: `OwnerClaimType` = `"customer_id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:14`),
  `BypassRole` = `"Admin"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:17`), and
  `OwnerParameterName` = `"id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:24`). The
  last one's doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:19-23`)
  spells out that the parameter is looked up as a route value first and a model-bound query or body
  argument second, which is exactly the two-step lookup the filter performs.
- **Why it's built this way**: `get; set;` (not `init`) is the shape the ASP.NET Core options binder
  expects, so the values can arrive from `appsettings` or a `Configure` callback; defaults on every
  property mean adding the options type broke no existing host.
- **Where it's used**: injected as `IOptions<OwnerOrAdminFilterOptions>` into
  [`OwnerOrAdminFilter`](#owneroradminfilter)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:33`). MMCA.ADC's
  Engagement module is the host that configures it rather than taking the defaults, pointing the shared
  filter at `ClaimTypes.NameIdentifier`, the `Organizer` bypass role, and a `userId` parameter
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:45,53-55`); the
  comment above those assignments explains why `NameIdentifier` and not the raw `sub` claim is the type
  the principal actually carries by the time the filter runs
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:47-52`).

### PermissionPolicy
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:9` · Level 0 · class (static)

- **What it is**: the naming convention that turns a permission string such as `"sessions:manage"`
  into the ASP.NET Core policy name `"perm:sessions:manage"`, and back.
- **Depends on**: nothing first-party.
- **Concept introduced, permission policies as prefixed policy names.** `[Rubric §11, Security]`
  (assesses whether authorization is expressed as capabilities rather than hard-coded role checks) and
  `[Rubric §2, Design Patterns]` (assesses deliberate use of a known pattern; here a reserved-prefix
  naming convention is what lets an on-demand provider recognize its own policies). Rather than
  pre-register one named policy per permission, the codebase encodes the permission *inside* the policy
  name behind a reserved prefix; [`PermissionPolicyProvider`](#permissionpolicyprovider) then
  materializes any policy whose name starts with that prefix on demand
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:3-8`). This class
  owns both ends of that encoding.
- **Walkthrough**: `Prefix` = `"perm:"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:12`), the reserved
  marker; and `NameFor(string permission)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicy.cs:17`), an
  expression-bodied `Prefix + permission` that builds the policy name.
  [`HasPermissionAttribute`](#haspermissionattribute) calls `NameFor` to build the `[Authorize]` policy
  string, and [`PermissionPolicyProvider`](#permissionpolicyprovider) strips `Prefix` back off to
  recover the permission.
- **Why it's built this way**: a single shared prefix constant means the attribute that *writes* the
  policy name and the provider that *reads* it cannot disagree; both reference
  `PermissionPolicy.Prefix`.
- **Where it's used**: by [`HasPermissionAttribute`](#haspermissionattribute) (encode) and
  [`PermissionPolicyProvider`](#permissionpolicyprovider) (decode).

### PermissionRequirement
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10` · Level 0 · class (sealed)

- **What it is**: an ASP.NET Core `IAuthorizationRequirement` carrying the single permission a
  principal must hold for a given policy to succeed.
- **Depends on**: `Microsoft.AspNetCore.Authorization.IAuthorizationRequirement` (framework).
- **Concept introduced, the requirement/handler pair.** `[Rubric §11, Security]` and `[Rubric §2,
  Design Patterns]` (assesses whether the ASP.NET Core authorization model is used as designed: it
  splits *what is required* from *how it is checked*). A requirement is a passive data object; a
  matching `AuthorizationHandler<T>` decides whether it is satisfied. This type is the passive half;
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler) is the active half, as the doc
  comment states
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:5-9`).
- **Walkthrough**: a `sealed` class implementing `IAuthorizationRequirement`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:10`). Its
  constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:14-18`) guards
  with `ArgumentException.ThrowIfNullOrWhiteSpace(permission)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:16`) and
  stores the value into the get-only `Permission` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionRequirement.cs:21`), so a
  requirement can never carry an empty permission.
- **Why it's built this way**: keeping `Permission` immutable and non-empty means the handler can trust
  it without re-validating; the requirement is a value carrier with no behavior of its own.
- **Where it's used**: attached to a policy by [`PermissionPolicyProvider`](#permissionpolicyprovider)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:43`) and
  evaluated by [`PermissionAuthorizationHandler`](#permissionauthorizationhandler).

### HasPermissionAttribute
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13` · Level 1 · class (sealed attribute)

- **What it is**: an `[Authorize]`-derived attribute that requires the authenticated principal to hold
  a named permission, applied to a controller or an action.
- **Depends on**: [`PermissionPolicy`](#permissionpolicy) (to build the policy name);
  `Microsoft.AspNetCore.Authorization.AuthorizeAttribute` (framework base).
- **Concept introduced, capability-based endpoint authorization.** `[Rubric §11, Security]` (assesses
  whether endpoints depend on *capabilities* rather than hard-coded role names) and `[Rubric §7,
  Microservices Readiness]` (assesses whether a module can be lifted out on its own; permissions travel
  as claims or through a per-module registry, so an extracted service authorizes without embedding the
  issuer's role taxonomy). The doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:5-11`)
  states the intent directly: prefer `[HasPermission("sessions:manage")]` over role-based
  `[Authorize(Policy = ...)]` so an endpoint declares the *capability* it needs, with the mapping from
  roles to that capability living in one registry ([`IPermissionRegistry`](#ipermissionregistry)).
- **Walkthrough**: `sealed class HasPermissionAttribute : AuthorizeAttribute`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13`) with
  `[AttributeUsage(... AllowMultiple = true, Inherited = true)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:12`) so
  several permission requirements can stack on one target and subclasses inherit them. The constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:17-18`)
  chains to the base with `PermissionPolicy.NameFor(permission)`: setting the inherited `Policy` to
  `"perm:<permission>"` is what routes the check through
  [`PermissionPolicyProvider`](#permissionpolicyprovider). It also stores the bare `permission` on the
  get-only `Permission` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:21`).
- **Why it's built this way**: deriving from `AuthorizeAttribute` (rather than inventing a filter)
  means the standard MVC authorization pipeline picks it up for free, and encoding the permission into
  the inherited `Policy` string is what removes the per-permission registration step.
- **Where it's used**: on controllers and actions across both apps; its policy name is resolved by
  [`PermissionPolicyProvider`](#permissionpolicyprovider) and satisfied by
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler) against the grants each module
  declares through [`AuthorizationExtensions.AddPermissions`](#authorizationextensions).

### PermissionAuthorizationHandler
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14` · Level 1 · class (sealed)

- **What it is**: the `AuthorizationHandler<PermissionRequirement>` that decides whether the current
  principal satisfies a [`PermissionRequirement`](#permissionrequirement), either because it carries
  the permission as an explicit claim or because one of its roles grants it.
- **Depends on**: [`PermissionRequirement`](#permissionrequirement),
  [`IPermissionRegistry`](#ipermissionregistry) (the role-to-permission map, taken as a primary
  constructor parameter at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14`),
  [`AuthClaimTypes`](#authclaimtypes) (the permission claim type,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:17`); `System.Security.Claims`.
- **Concept introduced, resolving a permission through claim-or-role.** `[Rubric §11, Security]`
  (assesses correctness of the grant decision; there are two independent grant paths, a direct
  permission claim and a role-derived one) and `[Rubric §7, Microservices Readiness]` (assesses whether
  a service stands alone; the handler reads roles out of the token regardless of how the JWT middleware
  mapped the role claim type, so it survives inbound-claim mapping being on or off).
- **Walkthrough**: `HandleRequirementAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:18`)
  null-guards both arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:22-23`),
  then short-circuits to a completed task when the principal is not authenticated
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:25-28`),
  so an anonymous request never succeeds. It then succeeds the requirement if *either*
  `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` (a directly granted
  permission) *or* `permissionRegistry.HasPermission(GetRoles(context.User), requirement.Permission)`
  (a role-derived grant) holds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:30-34`).
  The private `GetRoles(ClaimsPrincipal)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:43-49`)
  gathers role values across three possible claim types: the standard `ClaimTypes.Role` URI plus the
  raw `"role"` and `"roles"` claims, so roles are found whether or not the JWT bearer middleware mapped
  them. The comment at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:39-42`
  states the rationale and flags the deliberate duplication: this is the same predicate
  [`ICurrentUserService.Roles`](#icurrentuserservice) applies
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:45,49-55`),
  restated here because the handler runs on the raw principal and has no `ICurrentUserService` to read
  from.
- **Why it's built this way**: never calling `context.Fail()` (only `context.Succeed`) is the
  ASP.NET Core convention that lets multiple handlers vote independently: this handler abstains rather
  than vetoes when it cannot grant. Reading three role claim types defensively decouples the check from
  the host's token-mapping configuration.
- **Where it's used**: registered as an `IAuthorizationHandler` singleton by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:31-32`);
  invoked by the authorization middleware for every policy that carries a
  [`PermissionRequirement`](#permissionrequirement).

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
  Maintainability]` (assesses whether the design scales without repetitive registration; a system with
  an open-ended set of permissions cannot pre-register a named policy for each, so the policy is built
  from its own name at resolution time). The doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:6-12`)
  explains the design: `"perm:*"` names are materialized here, and every other name falls through to
  the default provider, so a policy the application registers itself is still resolved the usual way.
- **Walkthrough**: the constructor
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:19-20`)
  wraps a `DefaultAuthorizationPolicyProvider` built from the ambient `AuthorizationOptions` and keeps
  it in `_fallbackPolicyProvider`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:15`).
  `GetDefaultPolicyAsync` and `GetFallbackPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:23-28`)
  delegate straight to that fallback. `GetPolicyAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:31`) is
  the interesting one: it rejects a null or blank name outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:33`), and
  if the name does not start with `PermissionPolicy.Prefix` it defers to the fallback
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:35-38`);
  otherwise it slices the prefix off with the range expression
  `policyName[PermissionPolicy.Prefix.Length..]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:40`) and
  builds a policy that requires an authenticated user plus a fresh `PermissionRequirement(permission)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:41-44`).
  Note the `RequireAuthenticatedUser()` at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:42`: it
  makes anonymous requests fail with a challenge before the handler ever runs, which is why the handler
  can treat "not authenticated" as a plain abstain.
- **Why it's built this way**: composing over `DefaultAuthorizationPolicyProvider` rather than
  reimplementing it means all pre-registered policies survive; only the `perm:` namespace is
  intercepted. That is what lets [`HasPermissionAttribute`](#haspermissionattribute) work for any
  permission string without a registration step.
- **Where it's used**: installed (via `Replace`) as the single `IAuthorizationPolicyProvider` by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:33-34`).
- **Caveats / not-in-source**: a policy object is built on every `GetPolicyAsync` call for a `perm:`
  name; no cache is present in this type, and whether ASP.NET Core caches the result upstream is not
  determinable from this source file.

### AuthorizationExtensions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12` · Level 3 · class (static, extension block)

- **What it is**: the DI wiring for the whole authorization model, in two calls: one that turns on
  ASP.NET Core authorization and installs the permission mechanism (handler, on-demand provider,
  registry), and one each module uses to declare its role-to-permission grants.
- **Depends on**: [`PermissionAuthorizationHandler`](#permissionauthorizationhandler),
  [`PermissionPolicyProvider`](#permissionpolicyprovider), [`IPermissionRegistry`](#ipermissionregistry)
  and [`PermissionRegistryBuilder`](#permissionregistrybuilder);
  `Microsoft.Extensions.DependencyInjection` plus its `Extensions` namespace for `TryAddEnumerable`.
- **Concept introduced, `extension(T)` DI members and lazy registry accumulation.** `[Rubric §10,
  Cross-Cutting Concerns]` (assesses whether a concern is configured once for every host rather than
  re-wired per application) and `[Rubric §7, Microservices Readiness]` (assesses per-module
  self-sufficiency: each module contributes only the permissions it owns, so an extracted module
  carries its own grants). The `extension(IServiceCollection services)` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14`) is the
  C# `extension(T)` DI idiom taught in the [primer](00-primer.md#c-extensiont-types-read-this-once):
  it adds `AddAuthorizationPolicies` and `AddPermissions` directly onto `IServiceCollection`. The
  doc comment states the model plainly
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:16-21`):
  permissions are *the* authorization model here, an endpoint states the capability it needs and the
  registry maps roles to capabilities, so no policy name has to be pre-registered per role.
- **Walkthrough**
  - `AddAuthorizationPolicies()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:23`):
    calls `services.AddAuthorization()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:25`) to
    bring in the framework's authorization services, then wires the permission mechanism:
    `TryAddEnumerable` adds [`PermissionAuthorizationHandler`](#permissionauthorizationhandler) as a
    singleton `IAuthorizationHandler`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:31-32`),
    `Replace` installs [`PermissionPolicyProvider`](#permissionpolicyprovider) as the transient
    `IAuthorizationPolicyProvider`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:33-34`),
    and `EnsurePermissionRegistry(services)` guarantees a registry exists
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:35`). The
    inline comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:27-30`)
    records why the mechanism ships here: every host that wires authentication gets it for free, and
    consumers only have to declare their grants.
  - `AddPermissions(Action<PermissionRegistryBuilder> configure)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:47`): the
    per-module entry point for declaring grants. It guards the callback
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:49`),
    fetches the shared builder via `EnsurePermissionRegistry`, and invokes `configure(builder)` so the
    module's grants accumulate
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:51-52`).
    The doc comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:40-46`)
    notes it is safe to call once per module because grants union into a single registry; the union
    itself happens in [`PermissionRegistryBuilder.Grant`](#permissionregistrybuilder)
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:32-39`).
  - `EnsurePermissionRegistry(IServiceCollection)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:61`): the
    idempotent core. If a [`PermissionRegistryBuilder`](#permissionregistrybuilder) is already
    registered as a singleton instance it returns that existing one
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:63-67`);
    otherwise it creates one, registers it, and registers [`IPermissionRegistry`](#ipermissionregistry)
    as a singleton whose factory calls `builder.Build()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:69-71`).
    Because the registry is built on first *resolve*, every module's `AddPermissions` call has already
    contributed by the time any request evaluates a permission, which is the point the comment at
    `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:58-60`
    makes.
- **Why it's built this way**: `TryAddEnumerable` lets the permission handler coexist with any other
  authorization handlers a host registers; `Replace` guarantees exactly one policy provider (the
  permission-aware one); and the lazy `builder.Build()` factory is what makes module registration order
  irrelevant, since all grants are collected before the first `Build()`.
- **Where it's used**: `AddAuthorizationPolicies()` is called at the end of both framework
  authentication-wiring helpers, so a host that wires authentication through either gets the
  authorization model without an explicit call: `AddForwardedJwtBearerCore`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:471`,
  the call at `WebApplicationBuilderExtensions.cs:522`) and `AddCommonAuthentication`
  (`WebApplicationBuilderExtensions.cs:539`, the call at `WebApplicationBuilderExtensions.cs:573`).
  `AddPermissions(...)` is called by each module that owns permissions: in MMCA.ADC by Conference
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41`), Engagement
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:58`), Identity
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44`) and Notification
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:38`), and in
  MMCA.Store by Catalog
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/DependencyInjection.cs:41`), Sales
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/DependencyInjection.cs:40`) and Identity
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/DependencyInjection.cs:42`).
- **Caveats / not-in-source**: a host that never calls either method has no `IPermissionRegistry`
  registered at all. That case is covered elsewhere in this group by
  [`UnconfiguredPermissionRegistry`](#unconfiguredpermissionregistry), whose diagnostic message names
  these two methods as the fix
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:59`).

### OwnershipHelper
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10` · Level 9 · class (static)

- **What it is**: static helpers a controller calls to scope a query to the current user's own data,
  returning a specification that filters by owner id, or `null` when the caller holds the privileged
  bypass role and should see everything.
- **Depends on**: [`ICurrentUserService`](#icurrentuserservice) (Application layer, imported at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:1`). The
  specification it hands back is typically a
  [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype),
  though the helper itself never says so (see caveats).
- **Concept introduced, ownership scoping at the query level, as distinct from the filter's gate.**
  `[Rubric §11, Security]` (assesses row-level data isolation: a non-admin caller can only read their
  own rows) and `[Rubric §1, SOLID]` (assesses separation of responsibility: the helper *produces* a
  specification, the repository *applies* it). Where [`OwnerOrAdminFilter`](#owneroradminfilter)
  *blocks* a request that names someone else's id, this helper *narrows the result set* so a list
  endpoint returns only the caller's rows without them passing any id at all.
  [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) calls these
  the two enforcement points of one ownership axis: reject-one for single-resource routes, filter-many
  for collection routes.
- **Walkthrough**
  - `IsAdmin(ICurrentUserService, string bypassRole = "Admin")`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:17`): a
    case-insensitive compare of the current user's `Role` against the bypass role
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:20`). The default
    argument is `"Admin"`, and hosts with a different vocabulary pass their own (MMCA.ADC passes
    `Organizer`); [`OwnerOrAdminFilter`](#owneroradminfilter) reuses this same method so the gate and
    the scoping agree on who bypasses.
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
    default vocabulary.
- **Why it's built this way**: returning `null` for bypass-role callers (rather than a "match
  everything" specification) lets the caller skip filtering entirely on the privileged path; producing a
  specification rather than running the query keeps the helper in the API layer while the actual
  filtering runs in the query pipeline.
- **Where it's used**: called from MMCA.Store controller query actions that must isolate a caller's
  data. `ShoppingCartsController` exposes both an `IsAdmin` property and a private
  `GetOwnershipSpecification()` over it
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:64,66-68`),
  and `OrdersController` does the same
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/OrdersController.cs:62,65`). Its
  `IsAdmin` method is also the bypass check inside [`OwnerOrAdminFilter`](#owneroradminfilter)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:43`).
- **Caveats / not-in-source**: two gaps are worth knowing. `TSpec` is an open generic with only a
  `class` constraint
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:39`), so the helper
  does not itself require the returned type to be a specification: that contract is the caller's. And a
  non-admin caller whose claim is missing or unparseable also gets `null`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:51`), which means
  no scoping, so callers must not read `null` as "admin". Store closes that in the controller with a
  `RequireResolvableOwner()` gate that forbids the second case explicitly
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:80-90`);
  the helper itself does not distinguish them.

### OwnerOrAdminFilter
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31` · Level 10 · class (sealed action filter)

- **What it is**: an MVC async action filter that lets a request proceed only if the caller holds the
  bypass role or owns the resource named by the request, returning 403 Forbidden otherwise.
- **Depends on**: [`OwnershipHelper`](#ownershiphelper) (for the `IsAdmin` check),
  [`OwnerOrAdminFilterOptions`](#owneroradminfilteroptions) (the vocabulary),
  [`AllowMissingOwnerAttribute`](#allowmissingownerattribute) (the opt-out it honors),
  [`ICurrentUserService`](#icurrentuserservice) (claims); `Microsoft.AspNetCore.Mvc.Filters`,
  `Microsoft.Extensions.Options`, `System.Globalization`.
- **Concept introduced, per-request ownership enforcement as a filter, and deny-by-default.**
  `[Rubric §11, Security]` (assesses whether a resource-level access gate runs before the action body
  and whether it fails closed) and `[Rubric §10, Cross-Cutting Concerns]` (assesses whether the rule is
  expressed once and attached, rather than re-coded in each action). This is the *gate* counterpart to
  [`OwnershipHelper`](#ownershiphelper)'s *query scoping*: the helper narrows a list, this filter blocks
  an attempt to read or mutate a specific id the caller does not own
  ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html), cited at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:15`). The
  deny-by-default half is the more important lesson, and the class doc comment spells it out
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:16-23`): a gate
  that treats "nothing to compare" as "nothing to enforce" silently stops guarding every action whose
  parameter is optional, non-integer, or carried inside a bound model.
- **Walkthrough**: `OnActionExecutionAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:36`) null-guards
  its arguments and reads the current `settings = options.Value`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:38-41`), then
  walks four decisions in order:
  1. **Bypass role**: if `OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole)` it calls
     `next()` and returns
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:43-47`).
  2. **Missing owner claim**: it reads the caller's owner id with
     `currentUserService.GetClaimValue<int>(settings.OwnerClaimType)`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:49`) and
     short-circuits to `ForbidResult` when the claim is absent
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:51-55`).
  3. **Unresolvable owner parameter**: if `TryGetOwnerParameter` cannot produce an int, the request is
     denied unless the endpoint carries
     [`AllowMissingOwnerAttribute`](#allowmissingownerattribute), in which case it falls through to
     `next()`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:57-71`). Note
     the ordering: the opt-out excuses only a *missing* parameter, and it is checked after the claim
     check, so an `[AllowMissingOwner]` action still requires a valid owner claim.
  4. **Mismatch**: a resolved parameter that does not equal the claim value yields `ForbidResult`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:73-77`); only
     an exact match reaches `await next()`
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:79`).

  Two private helpers back that flow. `HasAllowMissingOwner`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:84-85`) reads
  `context.ActionDescriptor.EndpointMetadata.OfType<AllowMissingOwnerAttribute>()`, which is how one
  lookup covers the attribute whether it sits on the action or on its declaring controller: MVC has
  already composed both into the metadata (comment at `OwnerOrAdminFilter.cs:82-83`).
  `TryGetOwnerParameter`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:93-111`) resolves
  the id from the route values first
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:95-100`) and,
  failing that, from the model-bound action arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:102-107`),
  reporting failure by setting `value = 0` and returning `false`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:109-110`). Both
  parses pass `NumberStyles.Integer` and `CultureInfo.InvariantCulture` explicitly
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:97,104`); the
  comment above the method states the convention
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:90-92`): an
  owner id off the wire is not a number the request's ambient culture formatted, so the host's
  `CurrentCulture` must not decide which strings are ids.
- **Why it's built this way**: denying on an unresolvable parameter, with an explicit attribute as the
  only escape, converts a silent failure mode into a visible one: the action either compares an owner id
  or documents the guard that replaces the comparison
  ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)'s
  deny-by-default decision and the audit table that came with it). Reading the vocabulary from injected
  options keeps a single filter reusable across hosts, and checking the route before the bound arguments
  means a conventional `/{id}` route costs one dictionary lookup.
- **Where it's used**: registered scoped by `AddAPI`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:78`, next to
  `IdempotencyFilter` at `DependencyInjection.cs:77`, because both depend on scoped services) and
  applied as `[ServiceFilter(typeof(OwnerOrAdminFilter))]`, per the remarks at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:25-30`. MMCA.Store
  applies it at controller level on `ShoppingCartsController`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:49`) and
  `CustomersController`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/CustomersController.cs:34`),
  which covers every action on those controllers, so adoption there was an audit of the whole controller
  and the actions with no owner parameter carry
  [`AllowMissingOwnerAttribute`](#allowmissingownerattribute). MMCA.ADC instead applies it per action, on
  two `BookmarksController` endpoints
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/Controllers/BookmarksController.cs:85,106`),
  against the Engagement vocabulary configured at
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:45-56`.
- **Caveats / not-in-source**: the owner id is parsed as `int` only
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:97,104`), and the
  claim is read as `GetClaimValue<int>` (`OwnerOrAdminFilter.cs:49`), so a host whose owner id is a
  `Guid` or a string cannot use this filter as-is. It also assumes the owner parameter *is* the owning
  id, which holds for a cart or a customer profile but not for a resource with its own id and a
  foreign-key owner
  ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) lists orders
  as that case, handled with a specification or an explicit per-id check instead).

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

### SessionTokenResponse
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:21` · Level 0 · record

- **What it is**: the JSON body returned by `POST /auth/session/token`: the access token and its UTC
  expiry, and nothing else.
- **Depends on**: BCL only. Produced by [`SessionCookieEndpoints`](#sessioncookieendpoints) from a
  [`SessionTokenResult`](#sessiontokenresult).
- **Concept introduced, the refresh token never crosses the wire to the browser.** [Rubric §9, API &
  Contract Design] assesses whether a response exposes only what its client needs. This record carries
  the access token, which the SPA holds in memory for its Bearer calls, and deliberately omits the
  refresh token, which stays exclusively in the HttpOnly cookie. The doc comment states the rule
  outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:17-20`).
- **Walkthrough**: `public sealed record SessionTokenResponse(string AccessToken, DateTime
  AccessTokenExpiry)` (`:20`). It is the serialized projection of the internal
  [`SessionTokenResult`](#sessiontokenresult), which is why the two types carry the same two members
  and different visibility of intent.
- **Where it's used**: constructed and returned by the `/auth/session/token` handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:56`).

### SessionTokenResult
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:15` · Level 0 · record struct

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:15`), with
  the one-line summary at `:13` naming its provenance ("acquired from the session cookies").
- **Where it's used**: the return type of
  [`ICookieSessionRefresher.GetOrRefreshAsync`](#icookiesessionrefresher) (`:36`); constructed by
  [`CookieSessionRefresher`](#cookiesessionrefresher) at `:71` (cookie still valid) and `:92` (after a
  rotation); unwrapped by [`SessionCookieEndpoints`](#sessioncookieendpoints) at
  `SessionCookieEndpoints.cs:56`.

### ICookieSessionRefresher
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:30` · Level 1 · interface

- **What it is**: the "validate-or-refresh over the HttpOnly session cookies" port. One method returns
  a currently-valid access token for the request, rotating from the refresh cookie when the access
  cookie has expired, or `null` when there is no valid session.
- **Depends on**: `HttpContext` (ASP.NET Core) and [`SessionTokenResult`](#sessiontokenresult). Its
  only implementation is [`CookieSessionRefresher`](#cookiesessionrefresher).
- **Concept introduced, server-side refresh that browser script never sees.** [Rubric §11, Security]
  assesses where the long-lived credential lives. The type comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:23-29`) is
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
  `MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:172`.

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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:141` (with `UseAuthentication()` on the very next
  statement at `:140`) and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:178` (`:180`). Its
  gating rules are pinned one test per branch in
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs`:
  an HTML navigation refreshes (`:19`), a browser-style multi-value `Accept` list still matches (`:31`),
  a non-HTML `Accept` (`:45`), a missing `Accept` (`:60`) and a `POST` (`:74`) all skip, and a `null`
  refresh result still calls `next` (`:90`).
- **Caveats / not-in-source**: the ordering rule (before `UseAuthentication`) is enforced by the host
  that calls the extension, not by this class. Getting it wrong silently disables the SSR refresh
  rather than failing loudly.

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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:160` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:194`. The routes are exercised end to end by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:125`,
  whose `CreateHostAsync` builds a real pipeline around the mapper; the cases that matter most are the
  cross-site `403` (`:60`), the no-session `401` (`:91`), and the assertion that a valid session returns
  the access token but never the refresh token (`:104`).

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
  [`CookieSessionRefresher`](#cookiesessionrefresher) (rewrite after rotation,
  `CookieSessionRefresher.cs:88`). The attributes it emits are asserted directly by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/SessionCookieJarTests.cs`.

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
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:141`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:178`). Both the null guard and the
  pipeline wiring are covered directly at
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:115`
  and `:123`.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:20`).
  Registered scoped by `AddServerAuthSessionCookie`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:166`), and covered by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieTokenReaderTests.cs`.

### CookieSessionRefresher
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:52` · Level 4 · class

- **What it is**: the singleton implementation of
  [`ICookieSessionRefresher`](#icookiesessionrefresher). It validates the access cookie's JWT locally
  and, when that fails, exchanges the refresh cookie at the API's `auth/refresh` endpoint
  server-to-server, writes the rotated pair back as cookies, and single-flights concurrent refreshes so
  a burst of requests rotates the token only once.
- **Depends on**: `IHttpClientFactory`, `IMemoryCache`, `IWebHostEnvironment` and
  `ILogger<CookieSessionRefresher>` (primary constructor,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:52-56`);
  [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) (`:62`); [`SessionCookieJar`](#sessioncookiejar);
  [`CookieTokenReader`](#cookietokenreader) for the Items key;
  [`SessionCookieEndpoints`](#sessioncookieendpoints) for the cookie names; and the
  [`AuthenticationResponse`](#authenticationresponse) / [`RefreshTokenRequest`](#refreshtokenrequest)
  contracts from `MMCA.Common.Shared.Auth`. It reads token expiry with
  `System.IdentityModel.Tokens.Jwt`.
- **Concept introduced, single-flight refresh under a thundering herd.** [Rubric §12, Performance &
  Scalability] assesses behavior under concurrent load. When an access token expires, many queued
  navigations can arrive at once; rotating for each would burn the refresh token repeatedly and log the
  user out. The type comment (`:39-50`) states the design: the lock is a **striped**
  [`KeyedSemaphoreStripe`](#keyedsemaphorestripe) keyed by refresh token rather than one process-wide
  semaphore, because the lock is held across an outbound HTTP call and a single semaphore would
  serialize every unrelated user's cold navigation behind whichever refresh happened to be in flight.
  Two unrelated tokens can still land on the same one of the stripe's 256 lanes
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:25`), which the
  comment calls out as harmless precisely because the rotation-grace cache is re-checked per token
  after acquiring. Alongside the lock, a 10-second `RotationGrace` (`:60`) caches the rotated pair
  keyed by the OLD refresh token (`:144`), so a slightly-late sibling carrying the same expired pair
  gets the same result instead of rotating again.
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
- **Concept, an SSR-safe failure mode.** [Rubric §29, Resilience & Business Continuity] and [Rubric
  §13, Observability & Operability] apply to the outbound call. `CallRefreshAsync` wraps the POST in a
  `try` whose filter narrows to `HttpRequestException`, `OperationCanceledException`, `JsonException`
  and `NotSupportedException` (`:147`), logs one warning through the source-generated
  `LogRefreshCallFailed` (`:149`, declared with `[LoggerMessage]` at `:191-192`, which is why the class
  is `partial` at `:51`), and returns `null`. The comment at `:117-122` gives the reasoning: this code
  runs during SSR, so an escaping exception would turn a signed-in user's navigation into a `500`
  instead of an anonymous render. The failure is deliberately not cached (only a successful rotation
  reaches `cache.Set` at `:144`), so the next navigation retries, and a missing `BaseAddress` raises
  `InvalidOperationException` and is left to propagate because that is a host misconfiguration rather
  than a runtime condition.
- **Why it's built this way**: keying the grace cache by the OLD token is what lets a slightly-late
  sibling find the already-rotated pair, and striping the lock keeps one user's slow refresh from
  blocking everyone else's cold navigation. The server-to-server call is what keeps the refresh token
  off browser JS ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)).
  [Rubric §11, Security].
- **Where it's used**: resolved as [`ICookieSessionRefresher`](#icookiesessionrefresher) by
  [`CookieSessionRefreshMiddleware`](#cookiesessionrefreshmiddleware) and by the
  `/auth/session/token` endpoint. Its named `HttpClient`, `RefreshClientName =
  "SessionCookieRefreshClient"` (`:57`), is configured with the API base address in
  `AddServerAuthSessionCookie`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:168-169`), which also
  registers the refresher as a singleton (`:171-172`) with an inline note that a shared instance across
  requests is what makes single-flight work at all. The validate, rotate, grace-cache and failure paths
  are covered by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs`.

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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:73-74` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:111-112`. Covered directly by
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/SessionCookieAuthenticationHandlerTests.cs`,
  including the fresh-token-from-Items path (`:95`, which stashes the token under
  `CookieTokenReader.FreshAccessTokenItemKey` at `:102` and asserts it wins over an expired cookie) and
  the proof that expiry is judged by the handler's `TimeProvider` rather than the system clock (`:112`).

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
- **Where it's used**: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:74` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:112`, chained onto the host's
  `AddAuthentication(SessionCookieAuthenticationHandler.SchemeName)` call on the preceding line.

### IPasswordHasher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:6` · Level 0 · interface

- **What it is**: the password-security port. Two methods: hash a plaintext password into a separated `(byte[] Hash, byte[] Salt)` pair, and verify a plaintext against a stored hash plus salt.
- **Depends on**: nothing first-party, BCL only (`byte[]`). Its Infrastructure adapter is [PasswordHasher](#passwordhasher).
- **Concept introduced: hash and salt kept apart.** `[Rubric §11, Security]` assesses credential handling. Returning the hash and the salt as two distinct `byte[]` members (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:11`) rather than one concatenated blob keeps the storage contract explicit: the caller persists two columns, and `VerifyPassword` (`:18`) is unambiguous about what it re-derives and compares. Because the algorithm and its parameters live entirely behind this interface, they can be strengthened without touching a single Application handler ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) sets the current hashing policy, applied inside [PasswordHasher](#passwordhasher)).
- **Walkthrough**: `(byte[] Hash, byte[] Salt) HashPassword(string password)` (`:11`) returns a named value tuple the caller stores as two fields. `bool VerifyPassword(string password, byte[] hash, byte[] salt)` (`:18`) re-derives from the supplied salt and compares. The interface declares no iteration count, algorithm identifier, or format version: every one of those is the concrete's business.
- **Why it's built this way**: a two-method port is the `[Rubric §1, SOLID]` dependency-inversion story in miniature. Swapping the key-derivation function or raising the iteration count is an Infrastructure change, invisible to the register, login, and change-password use cases that only ever see this contract.
- **Where it's used**: constructor-injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:56`), which calls `VerifyPassword` on the login path (`:159`) and `HashPassword` on registration (`:210`); into the shared [ChangePasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand), which verifies the current password (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:56`) before hashing the new one (`:61`); into [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand), which hashes the replacement after the token redeems (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:80`); and into the per-app Identity services, handlers and seeders that derive from those, for example ADC's [AuthenticationService](group-24-identity-module.md#authenticationservice) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:49`), its `ChangePasswordHandler` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:20`) and its module seeder (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:34`, which needs the hasher because seed data carries plaintext credentials).

### ISoftDeletedUserValidator
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7` · Level 0 · interface

- **What it is**: a single-method port that answers "has this account been soft-deleted?", called after JWT authentication to reject a soft-deleted user who still holds a valid, unexpired token (BR-133, named in the type comment at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:4`).
- **Depends on**: BCL plus the solution-wide `UserIdentifierType` alias (`:15`). See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) for the alias convention and [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for soft-delete versus erasure. The generic implementation is [SoftDeletedUserValidator<TUser>](group-14-module-system-composition.md#softdeleteduservalidatortuser).
- **Concept introduced: closing the stateless-token window.** `[Rubric §11, Security]` assesses whether revocation is timely. A JWT is stateless: once signed it stays valid until `exp`, even if the account behind it was deleted a minute later. This port lets middleware re-ask the question on every authenticated request and fail the request when the answer is yes, with no per-handler code. The comment at `:5` states the second motive: the interface is declared in Application and implemented against the app's own `User` aggregate precisely so the middleware never takes a cross-module domain reference. That is the same dependency inversion as the other ports in this group, applied to a cross-module read.
- **Walkthrough**: one member, `Task<bool> IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:15`). One question, one answer, cancellable.
- **Where it's used**: [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware) resolves it lazily from the request scope (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75` calls `context.RequestServices.GetService<ISoftDeletedUserValidator>()`, so a host that registers no implementation simply skips the check; the reason is stated at `:43`) and queries it on a cache miss (`:113-115`). Both apps register the shared generic against their own user type: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:35` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:43`, both as `TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()`.

### IssuedSession
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:761` · Level 0 · record (private sealed, nested)

- **What it is**: the two-field result of opening or rotating a refresh session: the plaintext refresh token the client is handed, and the id of the session row it belongs to. It is a `private sealed record` nested inside [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:761`), not part of the framework's public surface.
- **Depends on**: nothing beyond the BCL (`string`, `Guid`). It is produced and consumed entirely inside its declaring class.
- **Concept introduced: the plaintext token exists in exactly one place, and it is a return value.** `[Rubric §11, Security]` assesses how a bearer credential is stored. [RefreshSession](#refreshsession) rows keep only a digest (`RefreshSession.HashToken`, used at `:349` and `:593` to *look up* by hash), so once a session is persisted the raw token cannot be recovered from the store at all. The type comment says exactly this (`:753-757`): the plaintext "exists nowhere else". Modelling the hand-off as a small record rather than an out-parameter or a tuple is what keeps that fact readable: every method that can produce a token returns `Result<IssuedSession>`, so the compiler shows you the complete list of places raw token material is in flight. `[Rubric §15, Best Practices & Code Quality]` also applies: a positional record gives value equality and immutability for free, and `Guid SessionId` names what would otherwise be an anonymous second tuple element.
- **Walkthrough**: one positional declaration, `IssuedSession(string RefreshToken, Guid SessionId)` (`:758`). `RefreshToken` is what goes back to the caller in the [AuthenticationResponse](#authenticationresponse); `SessionId` is what the access token's `sid` claim carries, which is why the session must be created before the token is minted (`:481-483`).
- **Why it's built this way**: the pairing is load-bearing rather than incidental. A caller that received only the token could not stamp `sid`, and a caller that received only the id could not answer the client. Returning both together removes the ordering mistake where a token is minted for a session that does not exist yet.
- **Where it's used**: returned by `OpenSessionAsync` (`:620`, constructed at `:645`) and `RotateAsync` (`:659`, constructed at `:698`); unwrapped by `IssueTokensAsync` (`:492-493`) and by `RefreshTokenAsync` (`:327-328`), each of which reads `SessionId` to mint the access token and `RefreshToken` to fill the response.

### ITokenService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:8` · Level 0 · interface

- **What it is**: the token-minting port called by the login and refresh use cases. It builds a signed JWT access token from explicit identity facts, generates an opaque refresh token, publishes the two token lifetimes, and recovers the `ClaimsPrincipal` from an expired-but-validly-signed access token.
- **Depends on**: `System.Security.Claims` (BCL, `:1`) and the `UserIdentifierType` alias. Its Infrastructure adapter is [TokenService](#tokenservice), which signs with the RSA key surfaced by [IJwksProvider](#ijwksprovider); [SessionStampingTokenService](#sessionstampingtokenservice) is a second, internal implementation that decorates the first.
- **Concept introduced: token creation as an Infrastructure detail.** `[Rubric §3, Clean Architecture]` assesses whether library-specific types stay out of the inner layers: the handlers call this contract and never see `System.IdentityModel.Tokens.Jwt`. `GetPrincipalFromExpiredToken` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:48`) is the linchpin of the refresh flow: it validates the signature while deliberately ignoring lifetime, so an expired access token can still identify the user whose tokens are being rotated, returning `null` when the token is invalid (`:47`).
- **Walkthrough**: `GenerateAccessToken(UserIdentifierType userId, string email, string role, string fullName, IEnumerable<Claim>? additionalClaims = null)` (`:17-22`) takes the minimum claim set as typed parameters rather than a ready-made principal, with an escape hatch for module-specific claims. `GenerateRefreshToken()` (`:26`) returns a cryptographically random base64 string. Two **default interface members** publish the lifetimes: `AccessTokenLifetime` (`:33`, defaulting to 15 minutes) and `RefreshTokenLifetime` (`:40`, defaulting to 7 days), both documented as the BR-205 baseline. The comments at `:28-32` and `:35-39` explain the split: the real implementation derives both from the bound JWT settings, so the expiry reported to a client matches the token's actual `exp`, while the defaults keep hand-written test doubles on the baseline instead of forcing every double to implement two more members. That derivation is visible in the concrete: `TimeSpan.FromMinutes(_jwtSettings.AccessTokenExpirationMinutes)` and `TimeSpan.FromDays(_jwtSettings.RefreshTokenExpirationDays)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:125` and `:129`). `GetPrincipalFromExpiredToken(string token)` (`:48`) closes the set.
- **Why it's built this way**: the explicit-parameter overload is a `[Rubric §11, Security]` guardrail. The token's contents are a deliberate list, not whatever claims happened to ride in on an inbound principal. Surfacing the lifetimes through the same port removes the duplication where a caller would hard-code an expiry that could drift from the signed `exp`. Note the consumer still guards: [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) falls back to the same 15-minute and 7-day baselines when an implementation reports a non-positive lifetime (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:102-111`).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`AuthenticationServiceBase.cs:55`), which reads the expired principal on refresh (`:278`), mints refresh tokens when opening and rotating sessions (`:627`, `:667`), and re-exposes a *wrapped* instance to subclasses through its `TokenService` property (`:82`). Each app's Identity service mints from that property, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:119-120` (access token plus the `speaker_id` claim). The rotated pair produced here is what [CookieSessionRefresher](#cookiesessionrefresher) later exchanges on the browser's behalf.

### PasswordResetSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the bound options object for the forgot-password workflow: where the reset page lives, how long a token stays redeemable, how many wrong guesses a token tolerates, and how often one address may ask for a reset (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:6-9`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for the range attributes and `System.Diagnostics.CodeAnalysis` for one scoped suppression (BCL, `:1-2`). Nothing first-party. Read by the implementation behind [IPasswordResetTokenService](#ipasswordresettokenservice) and by the shared [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand).
- **Concept: validated options whose defaults keep an unconfigured host bootable.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether policy knobs are configuration rather than constants buried in a handler, and `[Rubric §11, Security]` assesses whether the security-relevant knobs (token lifetime, attempt cap, request throttle) are bounded rather than free-form. Every numeric member carries a `[Range]` attribute, and the host binds the section with `ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:151-154`), so a typo such as `TokenLifetimeMinutes: 0` fails the host at startup instead of silently issuing tokens that are already expired.
- **Walkthrough**: `const string SectionName = "PasswordReset"` (`:13`) names the configuration section the host binds. `ResetUrl` (`:25`) defaults to `string.Empty` and is **deliberately not** `[Required]`: the doc comment (`:15-20`) records that a host which has not configured a UI base must still boot, and an empty value degrades to a token-only email the user pastes into the reset page by hand. That degradation is visible in the caller, which emits the bare token when the URL is blank and otherwise appends `?email=...&token=...` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:146-148`). The property carries a scoped `CA1056` suppression (`:21-24`) explaining why it is a `string` and not a `System.Uri`: it is bound from `PasswordReset__ResetUrl`, concatenated with a query string, and the empty default is not a valid `Uri`. The four numeric knobs follow: `TokenLifetimeMinutes` (`:29`, `[Range(1, 1440)]`, default 30), `MaxValidationAttempts` (`:36`, `[Range(1, 100)]`, default 5), `MaxRequestsPerEmail` (`:40`, `[Range(1, 100)]`, default 3), and `RequestWindowMinutes` (`:44`, `[Range(1, 1440)]`, default 60). All five members are `init`-only, so the bound instance is immutable afterwards.
- **Why it's built this way**: the defaults are a working policy on their own, so adopting the feature costs a registration call and no configuration at all, while the `[Range]` bounds plus `ValidateOnStart` make the one genuinely dangerous class of misconfiguration (a zero or negative lifetime, an unbounded attempt cap) unreachable. The decision to keep the whole reset credential in configuration and cache rather than in schema is [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html).
- **Where it's used**: bound in the framework's Infrastructure registration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:151-154`, immediately before the token service that reads it is registered at `:141`); consumed by [PasswordResetTokenService](#passwordresettokenservice) as a snapshot field (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:32`) for the request window, the throttle ceiling, the token lifetime, and the attempt cap; and exposed to the shared forgot-password handler as a protected `Settings` property (`ForgotPasswordHandlerBase.cs:49`) that states the expiry in the email body (`:125`) and renders the link (`:145-147`).

### RefreshSessionSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the bound options object for multi-device refresh sessions: whether this host owns the `RefreshSessions` table, which database carries it, how many live sessions one user may hold, and how long dead session rows are retained before a sweep deletes them (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:5-8`). A host that omits the section gets the defaults.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL, `:1`). Nothing first-party. Read by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser), by [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore), by [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), and by [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice).
- **Concept introduced: a flag that places a table rather than switching a feature.** `[Rubric §8, Data Architecture]` assesses whether each table has exactly one owning database, and `[Rubric §7, Microservices Readiness]` assesses whether that ownership survives splitting a modular host into services. The doc comment on `Enabled` states the distinction precisely (`:20-23`): the flag "gates the model, not the workflow". The workflow always issues, rotates and revokes sessions; `Enabled` decides which host maps the table, runs its migrations, and sweeps it. In a modular host the service that owns identity sets it to `true` and every other service leaves it `false`, which is what keeps one table in one database instead of one per service. The `Scheduler:Enabled` precedent is named in the same comment as the pattern being followed.
- **Walkthrough**: six members, all `init`-only.
  - `const string SectionName = "RefreshSessions"` (`:12`) names the configuration section.
  - `Enabled` (`:25`) defaults to `false`. Two places read it: the model gate in [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), which enables the table only when the flag is set **and** the context instance's physical source name equals `DataSourceName` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:295-298`), and the hosted-service registration, which starts the retention sweep only when the flag is set (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:168-172`, whose comment explains that registering it unconditionally would start a sweep in every service of a modular host, all but one of which has no table to sweep).
  - `MaxActiveSessionsPerUser` (`:35`, `[Range(1, 1000)]`, default 10) caps live sessions per user. The comment (`:28-33`) records the deliberate behavior at the ceiling: signing in on device number cap + 1 **revokes the oldest live session rather than refusing the login**, so the table is bounded without a legitimate sign-in ever failing.
  - `DataSourceName` (`:52`, `[MinLength(1)]`, default `"Default"`) names the logical data source whose database holds the table. The comment (`:37-49`) is worth reading in full: the value answers two questions that must agree, which context *maps* the table and which context the shipped [IRefreshSessionStore](#irefreshsessionstore) reads and writes through, and naming a source that does not exist fails loudly on the first session query rather than reading the wrong database. It is ignored for routing when the consumer ships its own entity configuration for the session entity.
  - `RetentionDays` (`:72`, `[Range(0, 3650)]`, default 30) is measured from the instant a session died (its revocation, or its expiry when never revoked), so a live session is never a sweep candidate. The comment (`:59-66`) states the constraint that makes the number security-relevant: retention **bounds reuse detection**, because BR-206 catches a replayed refresh token by landing on its revoked row, and a swept row turns that replay into an unknown token that fails alone instead of revoking the family. Thirty days sits well past the seven-day refresh-token lifetime for exactly that reason. `0` keeps every row forever (`:67-69`).
  - `CleanupIntervalHours` (`:80`, `[Range(1, 168)]`, default 6) is how often the sweep runs, ignored when `RetentionDays` is `0`, and matches the outbox sweep cadence because the deadline is measured in days (`:74-77`).
- **Why it's built this way**: the same `AddOptions(...).Bind(...).ValidateDataAnnotations().ValidateOnStart()` treatment as every other settings class in the framework (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:159-162`) means an out-of-range cap or a negative retention window fails the host at startup, not at the first login. Defaulting `Enabled` to `false` is the safe direction for a multi-service host: a service that never opts in never grows a table it does not own.
- **Where it's used**: bound at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:159-162`; injected as `IOptions<RefreshSessionSettings>` into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:61`, read for the cap at `:115`), into [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:34`), and into [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:51`, snapshotted at `:54`). The design-time context helper supplies an instance so `dotnet ef` can build a model that includes the table (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:150-151`). Each app's Identity service takes it as a required constructor dependency and passes it through, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:55`.

### SessionStampingTokenService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:773` · Level 1 · class (private sealed, nested)

- **What it is**: a pass-through [ITokenService](#itokenservice) that appends the current refresh session's `sid` claim to every access token minted while it is armed, and behaves as the plain inner service the rest of the time. It is a `private sealed class` nested inside [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:773`).
- **Depends on**: [ITokenService](#itokenservice) (the contract it implements and the inner instance it wraps, `:770`), [AuthClaimTypes](#authclaimtypes) for the `sid` claim name (`:797`), and the BCL (`System.Security.Claims`, `System.Globalization.CultureInfo`).
- **Concept introduced: a decorator used to make a new claim additive.** `[Rubric §2, Design Patterns]` assesses idiomatic pattern use, and this is the Decorator pattern applied to a very specific compatibility problem. Access tokens now need to name the session they belong to, but the claim set is produced by the app's own `CreateAccessToken` hook. The obvious fix, adding a session-id parameter to that hook, is a compile break in every consumer for a claim the app has no decision to make about, and the remarks say so (`:765-769`, and again at `:520-525`). Wrapping the token service instead means the base arms the wrapper around the hook call and the claim appears in tokens minted by subclasses that were never edited. `[Rubric §16, Maintainability & Evolvability]` is the payoff: an additive protocol change with a zero-line consumer diff.
- **Walkthrough**: a primary constructor takes the `inner` service (`:770`).
  - `Guid? CurrentSessionId { get; set; }` (`:773`) is the arming switch: a session id stamps, `null` mints unchanged. The remarks on the caller explain why a plain mutable field is safe here (`:526-530`): the authentication service is resolved per request (scoped, like the unit of work it saves through) and one request issues one token at a time.
  - `AccessTokenLifetime` (`:776`) and `RefreshTokenLifetime` (`:779`) forward straight to `inner`, so the lifetime the base reports is still the JWT settings' value.
  - `GenerateAccessToken(...)` (`:782-800`) is the only member with behavior. When not armed it delegates verbatim (`:789-792`). When armed it copies the app's `additionalClaims` into a new `List<Claim>` (`:796`, so the caller's sequence is never mutated), appends `AuthClaimTypes.SessionId` formatted as `sessionId.ToString("D", CultureInfo.InvariantCulture)` (`:797`), and delegates with the extended list (`:799`). The `"D"` format is not incidental: the comment (`:794-795`) records that it is the canonical hyphenated Guid form and the one `ClaimsPrincipalExtensions.FindSessionId` parses back ([ClaimsPrincipalExtensions](#claimsprincipalextensions)).
  - `GenerateRefreshToken()` (`:803`) and `GetPrincipalFromExpiredToken(string token)` (`:806-807`) are plain forwards.
- **Why it's built this way**: putting the stamping behind an `ITokenService` rather than inside the base's own method keeps the app hook's signature and semantics untouched while still guaranteeing the claim on the tokens the framework's own flows mint. The escape hatch is documented (`:528-530`): an app that mints from its own injected `ITokenService` reference produces a valid token with no `sid`, and can restore the claim by overriding `CreateAccessTokenForSession`.
- **Where it's used**: constructed once per authentication service instance (`:67`), surfaced to subclasses as the protected `TokenService` property (`:82`, whose remarks state that minting through the property is what puts `sid` on the token), and armed and disarmed around the hook call in `CreateAccessTokenForSession` (`:535-546`, with the `finally` at `:542-545` guaranteeing disarm even when the hook throws).

### UnconfiguredPermissionRegistry
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:20` · Level 1 · class (internal sealed partial)

- **What it is**: the fallback [IPermissionRegistry](#ipermissionregistry) for a host that wired the CQRS pipeline without declaring any role-to-permission grants. It grants nothing, so a permission-gated command or query is **denied** rather than allowed, and it logs one warning naming the call that would fix it (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:6-11`).
- **Depends on**: [IPermissionRegistry](#ipermissionregistry) (`:21`), [IRequiresPermission](group-05-cqrs-pipeline.md#irequirespermission) by reference in the doc comment (`:9`), and `Microsoft.Extensions.Logging` for the source-generated log message (`:1`).
- **Concept introduced: failing closed, and only where it costs nothing.** `[Rubric §11, Security]` assesses the direction a misconfiguration fails in: a registry that answered "no permission model, therefore allow" would silently open every gated request, so this one denies. `[Rubric §13, Observability & Operability]` assesses whether an operator can tell why: the log message spells out the remedy verbatim (`:57-60`, naming `AddAuthorizationPolicies()` / `AddPermissions(...)` and the required ordering before `AddApplicationDecorators()`). The second half of the doc comment (`:12-17`) is the more interesting teaching point and is an availability story rather than a security one: the two authorization decorators are registered **unconditionally** and take an `IPermissionRegistry` constructor dependency, so without any registration the whole pipeline fails to activate and a small app with no Identity module answers 500 on **every** read, not only the gated ones. This type turns a total activation failure into a correct, noisy denial on the subset of requests that actually declare a permission.
- **Walkthrough**: two fields and three methods, no configuration.
  - `private static readonly HashSet<string> None = []` (`:23`) is the single empty grant set every call returns, and `private int _warned` (`:25`) is the one-time-warning latch.
  - `GetPermissions(string role)` (`:28-32`) warns then returns `None`.
  - `HasPermission(IEnumerable<string> roles, string permission)` (`:35-42`) argument-guards both parameters (`:37-38`) before warning and returning `false`, so a caller bug still surfaces as an `ArgumentException` rather than being swallowed by the stub.
  - `WarnOnce()` (`:49-55`) uses `Interlocked.Exchange(ref _warned, 1) == 0` (`:51`) so concurrent requests produce exactly one log line. The comment (`:44-48`) explains why the warning is deferred to the first check instead of emitted at startup: a host with no permission-gated request is **correctly** configured and simply never needs a registry, so warning at boot would cry wolf.
  - `LogNoPermissionsConfigured` (`:57-60`) is a `[LoggerMessage]` source-generated `Warning`, which is why the class is `partial`.
- **Why it's built this way**: it is registered with `TryAddSingleton` from inside `AddApplicationDecorators()` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:126`), and the surrounding comment (`:119-123`) states both halves of the rule: `TryAdd` so a host that already declared its grants (via `AddAuthorizationPolicies()` or `AddPermissions(...)`, both of which run before this call) keeps its own registry and never constructs this type, and *here* rather than in `AddApplication()` so the registration lands exactly where the decorators that need it are wired.
- **Where it's used**: nowhere by name outside that one registration. It is reached only through the [IPermissionRegistry](#ipermissionregistry) dependency of the authorization command and query decorators in the CQRS pipeline (see [group 05](group-05-cqrs-pipeline.md)).
- **Caveats / not-in-source**: `internal`, so it is not part of the framework's public API and cannot be referenced or asserted against from a consumer's code.

### ILoginProtectionService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` · Level 3 · interface

- **What it is**: the application-layer contract for **brute-force and rate-limit protection** on authentication endpoints: lockout checks, failed-attempt increments, successful-login resets, and registration rate-limiting per IP address.
- **Depends on**: [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:1`).
- **Concept introduced: rate limiting as a first-class application concern.** `[Rubric §11, Security]` assesses brute-force protection on auth flows, and `[Rubric §10, Cross-Cutting Concerns]` assesses whether such a policy is extracted to a port so the application layer can reason about it without coupling to a specific store (the doc comment at `:7-8` names both a distributed and an in-memory cache as valid backers). Returning [Result](group-01-result-error-handling.md#result) from `CheckLockoutAsync` (`:18`) and `CheckRegistrationRateLimitAsync` (`:42`) makes "account is locked out" a normal control-flow branch rather than a thrown exception.
- **Walkthrough**: five async methods in two scopes.
  - **Email-scoped (failed-login lockout):** `CheckLockoutAsync` (`:18`) returns a failure result when the email is currently locked; `IncrementFailedAttemptsAsync` (`:26`) records a failure and, per the doc comment (`:20-22`), applies **exponential-backoff lockout** once the maximum is exceeded; `ResetFailedAttemptsAsync` (`:33`) clears the counter after a successful login.
  - **IP-scoped (registration flood):** `CheckRegistrationRateLimitAsync` (`:42`) and `IncrementRegistrationCountAsync` (`:49`) throttle account creation per client IP. Both accept a nullable `ipAddress` and **skip** the check when it is null, so a host that cannot resolve the caller IP degrades to no limit rather than blocking everyone; `CheckRegistrationRateLimitAsync` returns `Result.Success()` in that case (doc comment, `:36-37`).

  All five take a `CancellationToken` with a `default` argument, per convention.
- **Why it's built this way**: keeping the protection policy behind an interface lets the shared authentication workflow compose it in while the concrete cache mechanics stay in the implementation; the null-IP skip keeps the limiter from becoming an availability hazard ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:57`), which calls all five across its login and registration flows: `CheckLockoutAsync` (`:131`), `IncrementFailedAttemptsAsync` on both the unknown-email and wrong-password branches (`:146`, `:161`), `ResetFailedAttemptsAsync` on success (`:178`), `CheckRegistrationRateLimitAsync` (`:197`) and `IncrementRegistrationCountAsync` (`:256`). The concrete, cache-backed [LoginProtectionService](#loginprotectionservice) (tuned by [LoginProtectionSettings](#loginprotectionsettings), bound at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:145-148`) implements it, and the framework registers that pairing at `:135`.

### IPasswordResetTokenService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IPasswordResetTokenService.cs:10` · Level 3 · interface

- **What it is**: the two-method port behind the forgot-password workflow: issue a single-use reset token for an email address, and validate-then-consume a token presented back by the user. Implementations keep the token material outside the database, hashed at rest, and enforce both the per-email request throttle and the per-token validation-attempt cap (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IPasswordResetTokenService.cs:5-9`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) and its generic form from `MMCA.Common.Shared.Abstractions` (`:1`), plus the `UserIdentifierType` alias. Its Infrastructure adapter is [PasswordResetTokenService](#passwordresettokenservice), backed by [ICacheService](group-09-caching.md#icacheservice) and tuned by [PasswordResetSettings](#passwordresetsettings).
- **Concept introduced: a single-use credential without a schema change.** `[Rubric §11, Security]` assesses how a secondary credential is minted, stored, and retired; `[Rubric §8, Data Architecture]` assesses whether short-lived state earns a place in the durable store. A reset token is not durable data: it is valid for minutes and must stop working the instant it is redeemed. Putting it in columns on the user row costs a migration in every consumer and needs a sweeper to reap expired rows, because expiry is not something a table enforces; a self-contained signed payload needs no store but then cannot be single-use, since a signed token that has not expired stays valid however many times it is presented. This port takes the third path and hides the choice: the handlers see two `Result`-returning methods, and the cache substrate is entirely the implementation's business ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)).

  The second teaching point is in the return shapes. `ValidateAndConsumeAsync` is documented to collapse **unknown, expired, mismatched, and attempt-capped** into one generic failure (`:32-35`), so the redeem endpoint cannot be used to distinguish a wrong token from an expired one from an address that was never issued a token. The issue path is throttled rather than refused loudly, for the same anti-enumeration reason the forgot-password handler answers success to every input.
- **Walkthrough**: two members.
  - `Task<Result<string>> IssueAsync(string email, UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:23`) returns the **raw** token to email, or a failure when the per-email request throttle has been exceeded. The doc comment (`:12-15`) states the replace semantics: issuing overwrites any token already outstanding for that address, so requesting a new link immediately stops the older one from working. The `userId` parameter is what the token resolves back to at redeem time, which is why the redeem call never has to trust an identifier supplied by the caller.
  - `Task<Result<UserIdentifierType>> ValidateAndConsumeAsync(string email, string token, CancellationToken cancellationToken = default)` (`:36`) validates the presented token against the outstanding record and **consumes it on success**, so a token never redeems twice (`:25-28`), returning the account the token belongs to.
- **Why it's built this way**: taking `email` on both methods, rather than treating the token as self-describing, is what lets the implementation key its records by address and enforce the per-address throttle and the one-active-token rule at the same key. Returning `Result<UserIdentifierType>` rather than a boolean means the redeem handler gets the account identity from the token store itself. See [PasswordResetTokenService](#passwordresettokenservice) for the mechanics the port hides: a 32-byte random token (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:30`), only its digest stored, an attempt counter, and an address normalized through [Email](group-02-domain-building-blocks.md#email) before it becomes a cache key (`:34-45`) so `User@x.com` and `user@x.com` cannot hold independent tokens for one account.
- **Where it's used**: injected into the shared [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:38`, called at `:72`, where a throttled issue is logged and still answered as success) and into [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:34`, redeemed at `:61-62`). Both apps' sealed subclasses take the same dependency, for example ADC's [ForgotPasswordHandler](group-24-identity-module.md#forgotpasswordhandler) and [ResetPasswordHandler](group-24-identity-module.md#resetpasswordhandler). The framework registers the concrete as scoped at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:155`.

### IRefreshSessionStore
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:21` · Level 4 · interface

- **What it is**: persistence for [RefreshSession](#refreshsession) rows, the multi-device replacement for the single plaintext refresh-token column a user aggregate used to carry (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:5-7`). Sessions are added, looked up by token hash or by id, listed per user, rotated, and saved.
- **Depends on**: [RefreshSession](#refreshsession) from `MMCA.Common.Domain.Auth` (`:1`) and the `UserIdentifierType` alias. The shipped implementation is [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore); the test doubles are [InMemoryRefreshSessionStore](group-27-testing-infrastructure.md#inmemoryrefreshsessionstore) and [FakeRefreshSessionStore](group-27-testing-infrastructure.md#fakerefreshsessionstore).
- **Concept introduced: a repository whose contract is deliberately missing an `Update`.** `[Rubric §1, SOLID]` assesses interface segregation, and `[Rubric §8, Data Architecture]` assesses whether the persistence contract expresses the aggregate's rules. The doc comment (`:8-15`) explains the shape: sessions are mutated only through `RefreshSession.Revoke` on instances **this store returned**, so an implementation that tracks its entities persists a revocation with no update method at all. The requirement that makes that safe is stated as a contract obligation, not left implicit: implementations must return **tracked** instances, because a no-tracking read would accept revocations and rotations and drop them silently at save time (`:16-19`). This is the same trap called out for composed EF queries elsewhere in the framework, promoted here to interface documentation.

  The second concept is **lookup by hash, never by token** (`:37`). The store never sees plaintext: callers hash first with `RefreshSession.HashToken` and search on the digest, which is what lets the table hold only digests. `[Rubric §11, Security]` applies directly.
- **Walkthrough**: six members.
  - `AddAsync(RefreshSession session, ...)` (`:26`) stages an insert.
  - `FindByTokenHashAsync(string tokenHash, ...)` (`:37`) finds by digest **including revoked and expired rows**, and the comment (`:28-32`) marks that as load-bearing: a rotated token that comes back is found on its revoked row, which is the BR-206 reuse signal, so a store that filtered revoked rows out would report a replay as "unknown token" and never revoke the family.
  - `GetUnrevokedByUserAsync(UserIdentifierType userId, ...)` (`:45-47`) returns the user's un-revoked sessions oldest first, expired ones included since they still occupy a row, which is what makes both family revocation and cap eviction deterministic (`:39-41`).
  - `FindByIdAsync(Guid id, UserIdentifierType userId, ...)` (`:59-62`) takes the owner as part of the **query** rather than as a check the caller performs afterwards. The comment (`:50-53`) gives the reason: a session id is a value a client hands back, so scoping the query to the owner is what makes another account's id indistinguishable from a nonexistent one. That is an authorization decision encoded in a signature.
  - `SaveChangesAsync(...)` (`:67`) persists staged inserts and revocations.
  - `TryRotateAsync(RefreshSession presented, RefreshSession successor, DateTime revokedAt, ...)` (`:95-113`) is the one exception to the no-update rule, and it ships a **default interface implementation**. It argument-guards both sessions (`:101-102`), revokes the presented session as `RefreshSession.ReasonRotated` linked to the successor's hash (`:104`), then stages and saves the successor (`:109-110`). The `bool` return is the whole point (`:73-79`): two requests presenting the same still-live token both read an un-revoked row, so a check-then-act rotation would mint two successors from one token and the presented row could never fire reuse detection again. Returning `false` tells the caller it lost the claim, which is indistinguishable from a replay and gets the same answer. The default body is atomic only per instance, which is all an in-memory or test store can offer; the shipped EF store replaces it with a conditional `ExecuteUpdateAsync` the database arbitrates (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:108` and `:126`), as the comment at `:80-84` says.
- **Why it's built this way**: hashed-at-rest, per-device session rows are what turn refresh-token rotation into something a user can inspect and revoke per device, and what let reuse detection revoke a whole family ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), BR-205/206). Keeping the contract in Application means the workflow that uses it is independent of EF, so an extracted Identity service can bring its own store. Making rotation a *claim* rather than a mutation is the difference between a race that mints two live tokens and a race one side of which is answered as a replay.
- **Where it's used**: registered as scoped against the EF implementation at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:163`, with the comment (`:143-144`) noting the lifetime is deliberate: scoped, like the unit of work it shares a `DbContext` with, so a login and its session insert commit together. Consumed throughout [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (injected at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:60`, exposed to subclasses at `:88`) for single-device sign-out (`:348-350`), session listing (`:404`), targeted revocation (`:441`), reuse resolution (`:592-594`), rotation (`:682-684`), family revocation (`:708`) and cap eviction (`:725`).

### SoftDeletedUserCache
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17` · Level 4 · class (static)

- **What it is**: the shared cache contract for the **soft-deleted user marker** (BR-133): the key shape, the marker lifetime, and a one-call helper that writes it. The API middleware reads the marker on every authenticated request; the module that soft-deletes a user writes it (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:6-9`).
- **Depends on**: [ICacheService](group-09-caching.md#icacheservice) from `MMCA.Common.Application.Interfaces` (`:2`), the `UserIdentifierType` alias, and `System.Globalization.CultureInfo` (BCL, `:1`).
- **Concept introduced: revoking a stateless credential without a per-request lookup.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access, and `[Rubric §10, Cross-Cutting Concerns]` assesses whether such a concern is factored so both ends share one definition. A JWT is a bearer credential: signature validation never asks "is this account still active?", so soft-deleting a user leaves an already-issued access token passing validation until it expires ([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)). The textbook fixes (a deny-list, or an account-status query on every request) reintroduce exactly the per-request state that stateless JWT was chosen to avoid. This type is the middle path: a short-lived cache marker written at deletion time and read cheaply on the hot path.

  The `remarks` (`:11-16`) explain why the constants live in the **Application** layer rather than next to the middleware that reads them: a downstream application deleting an account has to write the exact same key the middleware reads, and a private constant in the presentation layer is unreachable from an application-layer command handler. Same reasoning as [IdempotencyHeaders](#idempotencyheaders), applied one layer up.
- **Walkthrough**: three static members, no state.
  - `MarkerDuration => TimeSpan.FromSeconds(30)` (`:29`). The remarks (`:22-28`) justify the number rather than leaving it magic: the marker only has to cover the window between the delete committing and the next token validation, because once it expires the validator query is the source of truth again and gives the same answer. Short-lived access tokens (15 minutes, the BR-205 default on [ITokenService](#itokenservice)) bound the rest of the exposure, so a longer marker would buy nothing and would keep stale entries alive for users who were never deleted.
  - `KeyFor(UserIdentifierType userId)` (`:42-43`) builds `user:deleted:{userId}` through `string.Create(CultureInfo.InvariantCulture, ...)`. The remarks (`:36-41`) name the bug this prevents: an identifier renders differently under some cultures (digit shapes, group separators), so a culture-sensitive key would be written under one request's culture and missed under another, silently letting a deleted user keep making requests. This is a case where the analyzer rule about culture-invariant formatting is guarding a security property, not just a formatting nicety.
  - `MarkDeletedAsync(ICacheService cache, UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:53-61`) null-guards the cache (`:58`) and writes `true` under `KeyFor(userId)` for `MarkerDuration` (`:60`). It returns the task without awaiting, so there is no extra async state machine for a one-call passthrough.
- **Why it's built this way**: publishing the key shape and the TTL as framework API is what keeps the writer and the reader honest, and it is a precondition for the module boundary in [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html): Identity owns the delete, every service hosts the middleware, and the only thing they share is a cache entry rather than a database. `[Rubric §7, Microservices Readiness]` applies directly: an extracted service can enforce the revocation without a reference to the Identity database.
- **Where it's used**: read by [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which builds the key (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:85`), short-circuits with 401 when the marker is `true` (`:102-105`), and on a miss falls back to the validator query (`:113-115`) and caches **that** answer, deleted or not, for the same `MarkerDuration` (`:132`). Written by the Identity delete path: ADC's [DeleteUserHandler](group-24-identity-module.md#deleteuserhandler) queues it as an after-commit action (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:72-74`, inside the `OnAfterSoftDeleteAsync` override at `:46`) and swallows a cache fault so a failed marker cannot turn a successful erasure into an error the caller would retry.
- **Caveats / not-in-source**: the marker is best effort on both ends by design. The middleware fails **open** on a cache outage, falling through to the validator query (`:95-100`) and proceeding if that is also unavailable (`:118-125`), and the writer logs and continues on a cache fault. The exposure that leaves is bounded by the access-token lifetime, which is the trade-off ADR-047 accepts explicitly. ADC's handler is the only writer in the source tree today; MMCA.Store soft-deletes users without writing the marker, so there the middleware's own validator-query fallback is what enforces BR-133.

### AuthenticationValidators
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:16` · Level 5 · class (sealed)

- **What it is**: a tiny **parameter object** that bundles the three FluentValidation validators the authentication workflow needs (login, registration, refresh) into one injectable dependency.
- **Depends on**: FluentValidation's `IValidator<T>` (NuGet, `:1`) over the request DTOs [LoginRequest](#loginrequest), [RegisterRequest](#registerrequest), and [RefreshTokenRequest](#refreshtokenrequest) (all in `MMCA.Common.Shared.Auth`, `:2`).
- **Concept introduced: the parameter object as a constructor-arity guardrail.** `[Rubric §1, SOLID]` assesses whether a class stays a single, cohesive responsibility rather than sprawling into a god class, and `[Rubric §16, Maintainability & Evolvability]` assesses whether cross-cutting dependencies are grouped so a class can grow without exploding its constructor. The doc comment (`:6-11`) states the exact motive: collapsing three closely-related dependencies into one keeps the app's `AuthenticationService` **below the application-service constructor-arity ceiling** (a god-class analyzer guardrail) without giving up per-request validation. Because the request DTOs already live in `MMCA.Common.Shared.Auth`, the bundle is app-agnostic, which is why it could be hoisted out of the apps into the framework. The pressure is real rather than theoretical: even with the bundle, ADC's subclass constructor takes nine parameters (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:46-55`).
- **Walkthrough**: a primary constructor takes the three `IValidator<T>` instances (`:16-19`), and three get-only properties surface them by name: `Login` (`:22`), `Register` (`:25`), and `Refresh` (`:28`), each assigned from its matching constructor parameter. There is no logic here; the type exists purely to shrink the dependency footprint of its consumer.
- **Why it's built this way**: a `sealed` grouping type with get-only properties is the cheapest way to fold three cohesive dependencies into one constructor slot, so the workflow base can validate each request shape without pushing its constructor over the arity limit; DI resolves the three underlying validators and composes them into this one object. Two of the three ([LoginRequestValidator](#loginrequestvalidator), [RefreshTokenRequestValidator](#refreshtokenrequestvalidator)) come from the framework assembly, while `IValidator<RegisterRequest>` is satisfied by the app's own `RegisterRequestValidator`, so the bundle is the point where framework and app validation meet.
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:59`), whose `LoginAsync`, `RegisterAsync`, and `RefreshTokenAsync` call `validators.Login` (`:124`), `validators.Register` (`:190`), and `validators.Refresh` (`:270`) respectively before doing any work. It is registered by each app's Identity module rather than by the framework, since one of its three dependencies is app-owned: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:34` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:42`, both `TryAddScoped<AuthenticationValidators>()`.

### IAuthenticationService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:12` · Level 5 · interface

- **What it is**: the application-layer contract for the Identity module's authentication workflows: login, registration, token refresh, per-device and global session revocation, session listing, and external (OAuth) login.
- **Depends on**: [LoginRequest](#loginrequest), [RefreshTokenRequest](#refreshtokenrequest), [RegisterRequest](#registerrequest), [AuthenticationResponse](#authenticationresponse), [RefreshSessionSummaryResponse](#refreshsessionsummaryresponse), [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error), and the `UserIdentifierType` alias (`:1-2`).
- **Concept introduced: default interface methods for optional capabilities.** `[Rubric §1, SOLID]` (interface segregation and dependency inversion): `ExternalLoginAsync` (`:130-138`) ships a **default implementation** in the interface itself that returns a not-supported [Error](group-01-result-error-handling.md#error) (`"Auth.ExternalLoginNotSupported"`, `:138`). An implementation that does not offer OAuth (a stub host, or a deployment with social login disabled) inherits that failure for free and need not override anything, so the interface stays one piece while the capability is opt-in ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)). `[Rubric §11, Security]`: login, registration, and refresh all return `Result<AuthenticationResponse>`, so auth outcomes flow as values and no exception leaks credential detail to the caller.

  The second concept the signatures teach is that a session is a **device**, not a user. `LoginAsync`, `RegisterAsync` and `RefreshTokenAsync` all take optional `ipAddress` and `userAgent` (`:24-25`, `:32-33`, `:47-48`) recorded on the session row, and the doc comments state the invariant each time: signing in opens a session for the calling device and leaves the user's other devices signed in (`:14-15`), and refreshing rotates the presenting device's session only (`:43-44`).
- **Walkthrough**: eight methods, all async, all ending in a `CancellationToken`.
  - `LoginAsync(LoginRequest, string? ipAddress = null, string? userAgent = null, ...)` returns `Result<AuthenticationResponse>` (`:22-26`).
  - `RegisterAsync(RegisterRequest, string? ipAddress = null, string? userAgent = null, ...)` (`:36-40`); the `ipAddress` does double duty, feeding [ILoginProtectionService](#iloginprotectionservice)'s registration rate limit and the new session row (`:32`).
  - `RefreshTokenAsync(RefreshTokenRequest, ...)` (`:51-55`) exchanges an expired access token plus a valid refresh token for a rotated pair.
  - `RevokeTokenAsync(UserIdentifierType userId, string? refreshToken = null, ...)` (`:66-69`) signs **one device** out. The documented fallback is the interesting part (`:58-60`): passing no token, or one that does not belong to this user, revokes every session the user holds, which the comment calls the safe reading of "log me out" from a caller that cannot produce its refresh token.
  - `RevokeAllSessionsAsync(UserIdentifierType userId, ...)` (`:78-80`) signs every device out: a password change, an admin lockout, or an explicit "sign out everywhere".
  - `GetSessionsAsync(UserIdentifierType userId, Guid? currentSessionId = null, ...)` (`:95-98`) lists live sessions newest first with the caller's own device marked. `currentSessionId` is the caller token's `sid` claim and is used only to set `RefreshSessionSummaryResponse.IsCurrent`; passing `null` marks no row (`:88-91`).
  - `RevokeSessionByIdAsync(UserIdentifierType userId, Guid sessionId, ...)` (`:114-117`) revokes one named device. The remarks (`:103-108`) fix two behaviors as contract: an unknown id and another account's id both return `NotFound` and are indistinguishable, so a caller cannot probe for another user's sessions; and revoking an **already-revoked** session succeeds and changes nothing, because a device list a user is clicking through is exactly where a duplicate request comes from.
  - `ExternalLoginAsync(loginProvider, providerKey, email, firstName, lastName, ...)` (`:130-138`), the default-implemented OAuth path.

  The doc comment (`:6-9`) also records a scope decision: **password change is not on this interface**. It is dispatched directly through its own command handler at the controller layer.
- **Why it's built this way**: concentrating the token-issuing and session-management workflows behind one port keeps the Identity controllers thin and lets the protection and rate-limit policy ([ILoginProtectionService](#iloginprotectionservice)) compose in; the default OAuth method keeps the contract stable across hosts that do and do not enable social login. Encoding the anti-probing and idempotent-revoke rules in `remarks` rather than leaving them to an implementation makes them testable expectations of every implementer.
- **Where it's used**: implemented by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (which realises every member except the default `ExternalLoginAsync`) and, through it, by each app's sealed [AuthenticationService](group-24-identity-module.md#authenticationservice); consumed by the Identity API controllers.

### AuthenticationServiceBase<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:53` · Level 8 · class (abstract)

- **What it is**: the **shared authentication workflow** (login, registration, refresh-token rotation, per-device and global revocation, session listing) hoisted once into the framework, generic over the app's `User` aggregate. It realises [IAuthenticationService](#iauthenticationservice) and leaves the genuinely app-specific decisions to a small set of `abstract` and `virtual` hooks a sealed subclass overrides.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and [IRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (persistence, G07), [ITokenService](#itokenservice), [IPasswordHasher](#ipasswordhasher), [ILoginProtectionService](#iloginprotectionservice), [AuthenticationValidators](#authenticationvalidators), [IRefreshSessionStore](#irefreshsessionstore) and `IOptions<`[RefreshSessionSettings](#refreshsessionsettings)`>` (all eight constructor parameters, `:50-58`), the [IAuthUser](#iauthuser) credential contract plus [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint (`:59`), [RefreshSession](#refreshsession) (the session aggregate it creates and revokes), [Email](group-02-domain-building-blocks.md#email) (normalizing the login and register address), [ClaimsPrincipalExtensions](#claimsprincipalextensions) (`principal.GetUserId()`, `:288`), [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error), the request and response DTOs, and the BCL `TimeProvider` (injected at `:55`, never `DateTime.UtcNow`, so the clock is testable).
- **Concept introduced: the Template Method that de-duplicates a whole vertical slice.** `[Rubric §2, Design Patterns]` assesses idiomatic pattern use: this is a textbook **Template Method**, the invariant sequence of an operation living in the base while the variable steps are deferred to subclass hooks. `[Rubric §16, Maintainability & Evolvability]` (DRY across services) and `[Rubric §1, SOLID]` also apply: the doc comment (`:14-19`) records that the app Identity modules previously duplicated this workflow at roughly 70 to 95 percent line-identity, so a fix to the lockout order or the rotation logic is written once. `[Rubric §11, Security]`: the base encodes the security posture directly, validate first, an [ILoginProtectionService](#iloginprotectionservice) lockout and rate-limit gate ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)), an untracked-then-tracked dual fetch ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)), and refresh-token rotation with **reuse detection** ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), BR-205/206). `[Rubric §7, Microservices Readiness]`: the workflow depends only on ports, so it runs unchanged whether the Identity module is in-monolith or its own service.

  **The session model is the other concept to absorb before reading the code** (`:35-47`). Refresh tokens are not a column on the user: every issue opens its own [RefreshSession](#refreshsession) row, the store holds only `RefreshSession.HashToken` digests, and rotation revokes the presented session and links it to its successor. Presenting an already-rotated token therefore lands on a revoked row, which is the reuse signal that revokes the user's whole live family (BR-206). Two requests presenting the same live token at the same instant get the same treatment, because the rotation is claimed atomically through `IRefreshSessionStore.TryRotateAsync` and the loser is answered as a replay rather than handed a second successor. An expired session is **not** a reuse signal and fails alone. A per-user cap evicts the oldest live session on a new sign-in so one account cannot grow the table without bound.
- **Walkthrough** (members in teaching order):
  - **Constructor and protected accessors** (`:50-92`): a primary constructor takes the eight collaborators; a private field wraps the injected token service in a [SessionStampingTokenService](#sessionstampingtokenservice) (`:67`); protected read-only properties re-expose `UnitOfWork` (`:70`), the *wrapped* `TokenService` (`:82`, whose remarks explain that minting through this property is what puts `sid` on the token), `TimeProvider` (`:85`), `RefreshSessions` (`:88`), and a `Repository` resolved lazily as `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:91-92`).
  - **Lifetimes and cap** (`:99-115`): `virtual` `AccessTokenLifetime` and `RefreshTokenLifetime` read through to [ITokenService](#itokenservice) (which derives them from `Jwt:AccessTokenExpirationMinutes` and `Jwt:RefreshTokenExpirationDays`), falling back to the BR-205 defaults of 15 minutes and 7 days on a non-positive value, meaning a hand-written test double or a misconfigured host. `virtual MaxActiveSessionsPerUser` (`:115`) reads `RefreshSessions:MaxActiveSessionsPerUser`.
  - **`LoginAsync`** (`:118-181`): validate the request (`:124-128`), check lockout (`:131`, ADR-029 and BR-212), normalize the raw email into an [Email](group-02-domain-building-blocks.md#email) value object (`:139`) so the EF predicate compares same-typed converted values (an invalid address yields a null value object that simply matches no user, which is the invalid-credentials answer anyway). **Step 1** is an *untracked* fetch via the `FindUntrackedByEmailAsync` hook (`:143`) to verify credentials without change-tracker overhead; a null result increments failed attempts and returns a generic 401 (`:144-149`). An app gate runs before password verification (`:153`, with no failed-attempt increment so the pre-hoist behavior is preserved), then `passwordHasher.VerifyPassword` (`:159`). **Step 2** is a *tracked* re-fetch by id (`:170`). Read the comment there (`:166-169`): now that refresh tokens live in their own rows, this fetch is purely about the instance the app's `CreateAccessToken` hook mints from, and the second lookup is what turns a race that deleted the account between the two steps into a clean 404. Then `ResetFailedAttemptsAsync` (`:178`) and `IssueTokensAsync` (`:180`).
  - **`RegisterAsync`** (`:184-261`): validate (`:190-194`), IP rate-limit (`:197`, ADR-029 and BR-213), reject a duplicate email through the `EmailExistsAsync` hook (`:204-208`), hash the password (`:210`), build the user through the `CreateUser` hook (`:211`), `AddAsync` (`:219`) and `SaveChangesAsync` (`:223`), run the `OnUserRegisteredAsync` post-commit hook (`:253`) to pick up the instance the first access token is minted from, increment the IP registration count (`:256`), and open the session last (`:260`). The final comment (`:258-259`) explains that ordering: the session row carries the user id, which a store-generated key only has once the insert has run.

    The save is wrapped in a deliberately **broad** `catch (Exception)` (`:221-249`, with a scoped `CA1031` suppression at `:225-227`) whose comment is the teaching material. The email lookup above is a check-then-act: two concurrent registrations for the same address both pass it, and the loser only fails on the insert, against the unique index every consumer puts on `Email` (ADC unfiltered, Store filtered on `IsDeleted`). Without the catch, that race surfaces as a generic 500 instead of the 409 a serialized pair would have produced. The catch cannot name `DbUpdateException`, because Application has no EF Core dependency by layer rule, so the **re-check is what narrows it** (`:243`): if the address exists now, the concurrent registration is the cause and the caller gets the same conflict the serial path returns through the shared `EmailAlreadyExistsFailure()` helper; anything else rethrows untouched (`:248`) and still reaches the exception middleware. The re-check passes `CancellationToken.None` on purpose (`:241-243`): it has to run even when the caller's token is what aborted the save, or a cancelled save could never be classified.
  - **`RefreshTokenAsync`** (`:264-330`): validate (`:270-274`), pull claims from the *expired* JWT via `tokenService.GetPrincipalFromExpiredToken` (`:278`, signature still checked, only lifetime skipped), read the identifier with `principal.GetUserId()` (`:288`; the comment at `:285-287` notes it rides the standard `sub` claim, also accepts the `NameIdentifier` form the bearer handler maps it to, and parses through `IParsable` so the identifier alias can change shape without editing this file), load the tracked user (`:295`), run the refresh app gate (`:302`), resolve the session behind the presented token (`:309-310`), rotate it (`:317`), and answer with a token pair whose access token carries the **successor's** `sid` (`:326-329`, comment at `:323-325`: a client's current-device marker follows the rotation instead of pointing at the session the rotation just revoked).
  - **`RevokeTokenAsync`** (`:333-371`): load the user, and when a refresh token was supplied, look up its session by hash (`:348-350`). Only a **live session belonging to this user** identifies the device to sign out (`:356-358`); anything else (unknown token, another account's token, an already-revoked row) leaves the caller unidentifiable, so the request degrades to revoking every live session rather than reporting success for a revocation that reached nothing (`:352-355`, then `:367`).
  - **`RevokeAllSessionsAsync`** (`:374-389`): the unconditional form of the same thing.
  - **`GetSessionsAsync`** (`:398-422`): reads the same "un-revoked sessions for this user" query the cap and family revocation use, then drops expired rows in memory with `IsActiveAt(now)` (`:409`) and orders newest first with `Id` as the tie-break (`:410-411`). The remarks (`:392-396`) explain why the filtering is in memory: the store returns expired-but-unrevoked rows on purpose, and a device list must not offer a user a device that can no longer authenticate.
  - **`RevokeSessionByIdAsync`** (`:436-460`): the ownership check *is* the store query (`:441`, scoped to the user), so another account's id and a nonexistent id produce the same `NotFound` (`:444-449`); an already-revoked session returns success without writing (`:451-454`).
  - **`IssueTokensAsync`** (`:471-495`): the shared open-and-respond used by login and registration, and reusable by an app-level external-login flow. It opens the session **before** minting the access token, because the token carries the session's id (`:481-483`), saves (`:489`), and returns the response.
  - **The private mechanics**: `ResolveRotatableSessionAsync` (`:581-613`) is where the three rejections differ behind one identical error, and its comment (`:571-579`) is the single most important paragraph in the file. An unknown hash, or one belonging to another account, is failed **alone** (`:596-599`), because revoking the family on it would let anyone holding one of this user's expired access tokens sign them out everywhere by posting a random token. A **revoked** row means this exact token was already rotated away or signed out and has come back, which is the BR-206 reuse signal that revokes every live session (`:601-608`). An **expired** row is an ordinary end of life and fails alone (`:610-612`). `OpenSessionAsync` (`:620-646`) mints a token, creates the session, enforces the cap, and stages the insert, returning an [IssuedSession](#issuedsession). `RotateAsync` (`:659-699`) mints the successor and claims the rotation through `TryRotateAsync` (`:682-684`); losing the claim is answered exactly like a replay (`:686-696`). `RevokeLiveSessionsAsync` (`:702-713`) revokes without saving. `EnforceSessionCapAsync` (`:722-735`) revokes the oldest live sessions while the user is at or over the cap; the comment (`:715-720`) notes expired-but-unrevoked rows do not count against the cap because they authenticate nobody, and age out through the retention sweep instead. `InvalidRefreshTokenError()` (`:741-742`) and `EmailAlreadyExistsFailure()` (`:749-751`) are the two shared failures that keep distinct internal paths indistinguishable to a caller.
  - **The hooks**: four are `abstract`, so a subclass must supply them. `FindUntrackedByEmailAsync` (`:502`) and `EmailExistsAsync` (`:508`) are deliberately written against the app's concrete `User` so EF translates the predicate byte-for-byte as before, and the second explicitly leaves the app to decide whether soft-deleted accounts count (`ignoreQueryFilters: true` blocks re-registration of an erased address, `:504-507`); `CreateUser` (`:511`) runs the app's domain factory; `CreateAccessToken` (`:514`) mints the app's claim set (for example `speaker_id` versus `customer_id`). Five `virtual` members can be overridden: `CreateAccessTokenForSession` (`:535-546`) arms the stamping wrapper around the hook call; `ValidateLoginCandidateAsync` (`:549`) and `ValidateRefreshCandidateAsync` (`:553`) add extra gates such as a deactivated-account check; `OnUserRegisteredAsync` (`:560`) runs the post-commit side-effect; and `CreateRefreshUserMissingError` (`:568`) defaults the vanished-user case to 401 (a token for a missing user is indistinguishable from an invalid one) while letting an app return 404 where its public contract already promises it.
- **Why it's built this way**: the untracked-then-tracked dual fetch keeps the common credential-verification path off the change tracker (cheaper, and soft-deleted accounts fall out via EF query filters returning the generic 401) while still giving a tracked instance to mint from ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). Per-device session rows with hashed tokens, rotation, family revocation on reuse, and a per-user cap are the BR-205/206 model ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)). Password material flows through [IAuthUser](#iauthuser)'s `PasswordHash` and `PasswordSalt` ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)), and the whole workflow depends only on abstractions, so it is identical whether the module runs in-process or as an extracted service.
- **Where it's used**: subclassed by each app's sealed [AuthenticationService](group-24-identity-module.md#authenticationservice), for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:46`, which binds `TUser = User`, adds the Attendee default role (BR-45) and the `speaker_id` claim (BR-209, built at `:275`), and re-lists `IAuthenticationService` (`:63`) so it can re-implement `RegisterAsync` and `ExternalLoginAsync` outright: ADC raises its registration side-effects inside one transactional unit rather than through the `OnUserRegisteredAsync` hook, because the identity column means the id does not exist until the first save (`AuthenticationService.cs:28-39`). MMCA.Store supplies its own subclass with a `customer_id` claim. Consumed by the Identity API controllers via the [IAuthenticationService](#iauthenticationservice) port.
- **Caveats / not-in-source**: `ExternalLoginAsync` is intentionally **not** overridden here: the base inherits the interface's default not-supported failure, and OAuth account linking stays in the app subclass because it is coupled to the app's `User` factory surface (doc comment, `:33-34`).

### ICurrentUserService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:9` · Level 8 · interface

- **What it is**: the Application layer's read-only window onto the authenticated caller: the raw `ClaimsPrincipal`, a strongly-typed `UserId`, the caller's first role, the full role set, a generic typed-claim reader, and a role-membership helper. It answers "who is calling?" without any handler ever touching `HttpContext`.
- **Depends on**: `System.Security.Claims` and `IParsable<T>` (BCL, `:1`) plus the solution-wide `UserIdentifierType` alias (`:15`); see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to). It references [RoleNames](#rolenames) in documentation only (`:80`). Its adapter is [CurrentUserService](#currentuserservice) in Infrastructure.
- **Concept introduced: the caller-identity port with behavior on the interface.** `[Rubric §3, Clean Architecture]` assesses whether inner layers stay free of transport types, and `[Rubric §1, SOLID]` (interface segregation) whether a contract exposes only what its clients need. A handler must know the caller to run ownership checks and to stamp audit fields, but it must not depend on `IHttpContextAccessor`, which would drag ASP.NET Core into the Application project. This interface is that inversion, and the adapter is the only place the accessor appears (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:17`, `:25`). What makes it worth studying is the use of **default interface members**: `Roles` (`:45-64`) and `IsInRole` (`:88-89`) ship real implementations on the contract, so every implementer and every hand-written test double inherits correct multi-role behavior instead of re-deriving it.
- **Walkthrough**: `ClaimsPrincipal User` (`:12`) exposes the full principal for advanced inspection. `UserIdentifierType? UserId` (`:15`) is the typed identifier, nullable because an unauthenticated request has no user. `string? Role` (`:22`) is documented as the **first** role claim only, with the remarks at `:18-21` steering callers to `Roles` or `IsInRole` for membership checks. `Roles` (`:45-64`) is the interesting member: it reads every role claim, accepting each claim type the JWT middleware may produce (`ClaimTypes.Role` when inbound claim mapping is on, or the raw `role` / `roles` claim when it is off, `:50-53`), falls back to a single-element list built from `Role` when the principal yields nothing (`:62`), and null-guards `User` even though the property is declared non-nullable (`:49`). The long remarks at `:27-44` justify both accommodations from the nature of a default interface member: it runs against *every* implementation, including a hand-written double or a mock that stubs only `Role`, where reading claims alone would have reported no roles and silently turned an authorization check into a denial, and dereferencing a null principal would have turned it into a `NullReferenceException`. Claims win when present, so a genuine multi-role principal is still read in full. `T? GetClaimValue<T>(string claimType) where T : struct, IParsable<T>` (`:73-74`) parses a named claim into any parsable value type and returns `null` when the claim is missing or unparseable, which is how a module reads its own claim (the doc names `speaker_id`, `:68`) without Common ever knowing that claim exists. `IsInRole(string roleName)` (`:88-89`) is `Roles.Any(role => string.Equals(role, roleName, StringComparison.OrdinalIgnoreCase))`.
- **Why it's built this way**: the remarks at `:82-87` record the reasoning behind `IsInRole` checking every claim rather than comparing against `Role`. Comparing against the first role alone matched only whichever role happened to be listed first, which is latent today because tokens carry a single role, and would have surfaced silently as an authorization denial the moment a second role was added. Typing `UserId` as the per-app alias instead of a generic parameter keeps the interface concrete and easy to mock while staying correct for each app. `[Rubric §11, Security]` and `[Rubric §15, Best Practices & Code Quality]` both apply.
- **Where it's used**: registered as scoped against [CurrentUserService](#currentuserservice) at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:555`. It supplies the `Roles` set the CQRS authorization decorators check permissions against (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/AuthorizationCommandDecorator.cs:30`, and its query twin; see [group 05](group-05-cqrs-pipeline.md)); it is how audit fields get their actor, since [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory) passes `_currentUserService.UserId` into every save (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:58`, used at `:248`, `:291`, `:330`, `:352` and `:414`); and it backs the ownership check in [OwnerOrAdminFilter](#owneroradminfilter) and the framework's account controllers.
- **Caveats / not-in-source**: `Role` deliberately reports only the first role claim; treat it as a display value and use `Roles` or `IsInRole` for any decision.

### IAuthUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:16` · Level 0 · interface

- **What it is**: the deliberately minimal **credential** surface an Identity module's `User` aggregate exposes to the shared [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) workflow. Two properties, both password material. It is the contract that lets the framework's authentication plumbing verify and replace a password without knowing anything app-specific about the user (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:3-8`).
- **Depends on**: nothing first-party; the BCL only (`byte[]`). Implemented transitively through [IPasswordChangeableUser](#ipasswordchangeableuser) by each app's `User` aggregate (see [User](group-24-identity-module.md#user)).
- **Concept introduced: the inverted user contract.** Rather than the shared auth workflow depending on a concrete `User` class, `User` implements a small interface the framework owns. Profile fields, roles, linked aggregates, and claim sources stay app-specific: the shared workflow reaches those only through per-app hooks (`CreateAccessToken`, `CreateUser`), never through this contract (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:6-8`). `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion, and this is a textbook case: the interface is exactly the credential surface and nothing more. `[Rubric §11, Security]` assesses credential handling, and the whole security-relevant surface of a `User` aggregate is now readable in five lines.
- **Concept: a contract that got smaller on purpose.** The `<para>` block (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`) is the most instructive part of the file, because it records what is deliberately **absent**. Refresh tokens used to be members here: one plaintext `RefreshToken` column plus its expiry, per user. Two problems followed from that shape, and both are named in source. One user row could hold one token, so signing in on a phone signed the same account out of a laptop. And the column held a **usable bearer credential** in the users table, so a database read was enough to mint access tokens. Both are gone: sessions are rows in [RefreshSession](#refreshsession), hashed at rest and reached through [IRefreshSessionStore](#irefreshsessionstore), so this interface covers passwords only ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). `[Rubric §16, Maintainability]` applies to the removal itself: shrinking a framework contract is a breaking change for every consumer, and it was taken because the alternative was a security and UX defect baked into the contract shape.
- **Walkthrough**: two members, both `byte[]` and both read-only.
  - `byte[] PasswordHash` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:20`), the PBKDF2 hash produced by [IPasswordHasher](#ipasswordhasher).
  - `byte[] PasswordSalt` (`:23`), the salt paired with it.
  - Both sit inside a scoped `#pragma warning disable CA1819` (`:18`, restored on `:24`) that knowingly returns arrays, to mirror [IPasswordHasher](#ipasswordhasher)'s `byte[]` tuple and the EF-mapped `varbinary` columns rather than force a defensive copy on every read. The suppression's justification is written on the disable line itself, which is the convention this codebase uses everywhere it takes an analyzer exception.
  - There is no mutator. Writing new material is the separate capability [IPasswordChangeableUser](#ipasswordchangeableuser) adds, so an aggregate that only ever authenticates never exposes a way to change its own password.
- **Why it's built this way**: keeping the contract in Domain and keeping it small is what makes the shared auth workflow reusable across Store and ADC (both `User` aggregates satisfy it) while each aggregate stays free to model everything else its own way. See [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) for the password-material policy, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) for the dual-fetch auth model this contract feeds, and [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) for the refresh-token move.
- **Where it's used**: it is half the generic constraint on the shared login and registration workflow, `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IAuthUser` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:62`), which reads both properties on the login path (`:159`) and writes the pair on registration (`:210`). It is also the base of [IPasswordChangeableUser](#ipasswordchangeableuser), and the shape hand-written test doubles copy (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:975`).
- **Caveats / not-in-source**: the doc comment on `PasswordSalt` still says the salt's length selects the verify algorithm (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:22`). That was true while [PasswordHasher](#passwordhasher) also verified a legacy HMAC-SHA512 format; the current implementation has one algorithm and one salt size (`SaltSize = 32`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:15`, with no legacy branch) per [ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html). The comment is stale; the code is the contract.

### IJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` · Level 0 · interface

- **What it is**: the abstraction that returns the active `JsonWebKeySet` served at `/.well-known/jwks.json`. Implementations materialize the public signing key(s) in the JWK format that other services consume to validate access tokens (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:5-10`).
- **Depends on**: `Microsoft.IdentityModel.Tokens.JsonWebKeySet` (NuGet, `:1`). Implemented by [RsaJwksProvider](#rsajwksprovider); configured by [JwksSettings](group-08-auth.md#jwkssettings) and served by [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).
- **Concept introduced: publishing a public key instead of sharing a secret.** `[Rubric §11, Security]` assesses key management and blast radius, and `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a rewrite. In an extracted-service topology, symmetric HS256 would require every service to hold the same secret, so any one compromised service can mint tokens for all of them. The asymmetric alternative ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) keeps the RSA private key inside the Identity service and publishes only the public key at a well-known URL; peers fetch it and validate signatures without ever being able to sign. `IJwksProvider` is how the Identity API obtains that public key set to serve.
- **Walkthrough**: a single synchronous member, `JsonWebKeySet GetJsonWebKeySet()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:19`). Synchronous is the deliberate shape because key material is resolved once and cached in-process by the implementation. The doc comment sets a contract that the implementation must honor: return an **empty** key set rather than throwing when no signing key is configured (`:13-17`), so `/.well-known/jwks.json` stays a valid, pollable URL even in a host where JWKS publishing is off.
- **Why it's built this way**: an interface here lets tests inject a pre-built key set with no file IO, and the empty-set contract makes the endpoint safe to map unconditionally instead of behind a feature check.
- **Where it's used**: registered as `services.TryAddSingleton<IJwksProvider, RsaJwksProvider>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:183`) immediately after the `JwksSettings` options binding (`:165-168`); the JWKS minimal-API endpoint calls it, and consuming services fetch the resulting document through `AddForwardedJwtBearer` at startup (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:9`).

### JwksSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: the `Jwks` section that controls whether an Identity service publishes a JSON Web Key Set at `/.well-known/jwks.json`, and where its RSA public key comes from (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:5-9`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[StringLength]` (BCL, `:1`) only. Consumed by [RsaJwksProvider](#rsajwksprovider) and [TokenService](#tokenservice) through `IOptions<JwksSettings>`.
- **Concept introduced: key distribution as configuration.** `[Rubric §11, Security]` assesses how trust is established between services. In a single-process monolith the issuer and the validator can share one symmetric secret. Once a module is extracted, the validator must obtain the issuer's *public* key without sharing anything secret, which is what a JWKS document is for ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §7, Microservices Readiness]`: the framework ships the endpoint always and the key set empty, so nothing about a deployment changes until a host flips `Enabled`. The `kid` contract is the subtle part: `KeyId` is published as the JWK `kid` and must match the `kid` header on tokens the issuer signs (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:13-14`, restated on the property itself at `:28-32`), otherwise a validator holding a correct key set still cannot pick the right key. [TokenService](#tokenservice) closes that loop by taking these same options and stamping `KeyId` onto every RS256 token it signs (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:48-53`, `:57`, `:67`).
- **Walkthrough**:
  - `SectionName = "Jwks"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:20`).
  - `Enabled` (`:26`), defaulting to `false` with the rationale spelled out inline (`:22-25`): existing HMAC-only deployments must not start advertising an RSA key set by accident.
  - `KeyId` (`:34`), `[StringLength(64)]` (`:33`), defaulting to `"default"`.
  - `RsaPublicKeyPem` (`:41`) and `RsaPublicKeyPath` (`:47`), documented as mutually exclusive (`:36-40`, `:43-46`); the path form exists for keys mounted as a secret rather than inlined in configuration.
  - The consuming logic, worth reading alongside: [RsaJwksProvider](#rsajwksprovider)`.BuildKeySet` returns an EMPTY `JsonWebKeySet` when `Enabled` is false (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:29-32`) and again when neither PEM source resolves (`:36-39`); otherwise it imports the PEM, stamps `KeyId` onto the `RsaSecurityKey` (`:41-47`) and tags the JWK `use=sig`, `alg=RS256` (`:50-51`). `ResolvePem` prefers the inline value over the file (`:58-74`), and the key set is built once behind a `Lazy<JsonWebKeySet>` in `PublicationOnly` mode (`:21-22`) so that one transient IO failure reading the PEM is retried rather than cached forever (`:17-21`).
- **Why it's built this way**: default-off plus an empty key set means the endpoint is safe to map unconditionally, and two key sources cover both "inline it in configuration" and "mount it as a secret" without a second code path in the provider.
- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:179-182`), immediately followed by the [IJwksProvider](#ijwksprovider) registration (`:183`). [TokenService](#tokenservice) takes it as an optional constructor dependency and falls back to `new JwksSettings().KeyId` when it is absent (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:67`).

### JwtSigningAlgorithm
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:21` · Level 0 · enum

- **What it is**: a two-value enum selecting how access tokens are signed and validated: symmetric HMAC or asymmetric RSA.
- **Depends on**: nothing. Referenced by [JwtSettings](#jwtsettings), [TokenService](#tokenservice), and the API-layer authentication wiring.
- **Concept introduced: the deployment shape encoded as one configuration value.** `[Rubric §11, Security]` assesses key management: HS256 requires every validator to hold the *signing* key, which is acceptable only while issuer and validators share a process. RS256 splits the pair, the issuer holds the private key and peers validate against the JWKS endpoint, so no peer ever holds the signing key ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). `[Rubric §7, Microservices Readiness]`: making this a configuration value rather than a compile-time choice is what lets the same binaries run both topologies, and the type's own doc says RS256 is also the right choice for a monolith that intends to extract later, because the token format does not change when it does (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:8-12`). The operational consequence is stated just as plainly: switching a running deployment between the two invalidates every existing token, a hard cutover (`:17-18`).
- **Walkthrough**: `HS256 = 0` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:24`) and `RS256 = 1` (`:27`), both with explicit ordinals.
  - The default is RS256, and where that default lives is worth being precise about. The enum's zero value is HS256, so a configuration binder that saw an *invalid* value would land there; but a host that simply omits `Jwt:SigningAlgorithm` never has the property set at all, and [JwtSettings](#jwtsettings)'s own initializer holds (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`). The default is a property initializer, not the enum ordinal.
  - [TokenService](#tokenservice) branches on the value once, in its constructor, and caches the resulting credentials (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:64-74`), with the RSA and HMAC builders at `:194` and `:180`. Each builder throws a named `InvalidOperationException` when its key material is missing (`:184`, `:200`).
  - The API layer branches on the same value when configuring in-process JWT bearer validation: `BuildValidationParameters` takes the RSA path for RS256 (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:629-642`) and, when the public key is absent, throws a message that points the reader at `AddForwardedJwtBearer` for services that fetch the key through JWKS at runtime instead (`:633-636`).
- **Why it's built this way**: both members stay because they encode deployment shapes rather than a compatibility level (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:5-6`). A single-process monolith that will never be split skips RSA key management entirely; everything else gets the algorithm that survives extraction.
- **Where it's used**: [JwtSettings.SigningAlgorithm](#jwtsettings) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`) and its conditional validation (`:72`, `:79`), [TokenService](#tokenservice), and `BuildValidationParameters` in the API startup extensions (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:631`).

### LoginProtectionSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: strongly typed, `[Range]`-validated configuration for brute-force login lockout and registration rate limiting, bound from the `LoginProtection` configuration section (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:5-7`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]` (BCL, `:1`). Consumed by [LoginProtectionService](#loginprotectionservice) through `IOptions<LoginProtectionSettings>`.
- **Concept**: `[Rubric §11, Security]` assesses whether brute-force defenses exist and are tunable, and this settings class is where the policy numbers live rather than being hard-coded into a handler. `[Rubric §16, Maintainability]` also applies in a small way: five `init`-only properties with defaults mean an app that configures nothing still gets a safe policy, and an app that configures one value inherits the rest.
- **Walkthrough**: `const string SectionName = "LoginProtection"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:12`) names the bound section. Two concerns follow.
  - Account lockout: `MaxFailedAttempts` (default 5, `[Range(1, 100)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:17-18`), `MaxLockoutSeconds` (default 300, `[Range(1, 3600)]`, `:23-24`), `FailedAttemptWindowMinutes` (default 30, `[Range(1, 1440)]`, `:30-31`). The window comment (`:26-29`) is load-bearing for understanding the service: the attempt counter resets by cache expiration, not by a sweep job.
  - Registration rate limiting: `MaxRegistrationsPerIpPerHour` (default 10, `[Range(1, 10000)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:36-37`) and `RegistrationRateLimitWindowMinutes` (default 60, `[Range(1, 1440)]`, `:42-43`).
- **Why it's built this way**: `sealed` with `init`-only properties gives an immutable options object. Every property carries a `[Range]`, and the registration wires `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:145-148`), so an obviously unsafe value such as `MaxFailedAttempts = 0` fails the host at startup instead of quietly disabling lockout until someone notices in production. The `MaxLockoutSeconds` upper bound of 3600 is also what lets [LoginProtectionService](#loginprotectionservice) reason about its shift-clamp safely.
- **Where it's used**: bound and validated in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:145-148`) immediately before [LoginProtectionService](#loginprotectionservice) is registered (`:135`). Its sibling [PasswordResetSettings](#passwordresetsettings) is bound in exactly the same shape two lines later (`:137-140`), as is [RefreshSessionSettings](#refreshsessionsettings) (`:145-148`).

### PasswordResetEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:171` · Level 0 · record (internal sealed)

- **What it is**: the cached reset record behind the forgot-password flow: what [PasswordResetTokenService](#passwordresettokenservice) writes into the cache when a reset token is issued, and reads back when one is redeemed. It is `internal sealed`, declared as a second type at the bottom of its service's file (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:171-175`).
- **Depends on**: nothing first-party except the `UserIdentifierType` alias (the per-module `global using` identifier alias taught in the primer, [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Four positional parameters, all BCL primitives.
- **Concept introduced: a cache DTO is constrained by its serializer, not by your domain.** `[Rubric §8, Data Architecture]` assesses whether each store is given a shape it can actually round-trip, and this four-line record is a compact lesson in that. The XML comment states the rule directly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:162-166`): the cache round-trips values through `System.Text.Json`, so **every member is a JSON primitive**. A value object such as [Email](group-02-domain-building-blocks.md#email) or a raw `byte[]` here would not survive a distributed backing store, which is why the token digest is carried as Base64 text (`:172`) and the expiry as Unix seconds (`:175`) rather than as `byte[]` and `DateTimeOffset`. `[Rubric §11, Security]` also applies through one member name: `TokenHashBase64`, not `Token`. The record is structurally incapable of holding the secret it guards.
- **Walkthrough**: four members, in the order they matter.
  - `string TokenHashBase64` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:172`): Base64 of the SHA-256 of the issued token, never the token itself (`:167`). Validation re-hashes the presented token and compares digests, so the cache never holds redeemable material.
  - `UserIdentifierType UserId` (`:173`): the account the token redeems to (`:168`). Storing the id in the record is what lets redemption resolve the user without a second lookup by email.
  - `int FailedAttempts` (`:174`): wrong tokens presented against this record so far (`:169`), the counter the attempt cap is enforced against.
  - `long ExpiresAtUnixSeconds` (`:175`): when the record expires (`:170`). This one exists for a specific reason explained at the rewrite site: when a failed attempt bumps the counter, the record is re-cached with the **remaining** lifetime computed from this field, so a wrong guess cannot extend how long the token stays redeemable (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:138`, `:146-152`).
- **Why it's built this way**: being a `record` gives the non-destructive `with` expression that the attempt-counter update relies on (`entry with { FailedAttempts = attempts }`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:150`), so the rewrite is a copy rather than a mutation. Being `internal` keeps a cache-layout detail out of the package's public API: nothing outside the Infrastructure assembly should be able to construct or read one. See [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) for why the reset lifecycle lives in the cache at all.
- **Where it's used**: written by `IssueAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:82-88`), read by `ValidateAndConsumeAsync` (`:100`), and rewritten by `RecordFailedAttemptAsync` (`:148-152`). It appears nowhere else.

### JwtSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `Jwt` section: issuer, audience, signing algorithm, the key material for whichever algorithm is selected, and the two token lifetimes. It adds the piece attributes cannot express, algorithm-aware validation of the key material.
- **Depends on**: [JwtSigningAlgorithm](#jwtsigningalgorithm) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`), which is what puts it at Level 1, plus `System.ComponentModel.DataAnnotations` for `[Required]` and, critically, for the `IValidatableObject` interface (`:1`, `:16`).
- **Concept introduced: `IValidatableObject` for conditional requirements.** Attributes describe a property in isolation, so they cannot say "this one is required only when that one has a particular value". `IValidatableObject` is the options-validation extension point for exactly that case: the type implements a single `Validate` method that yields one `ValidationResult` per failure, and `.ValidateDataAnnotations()` runs it alongside the attribute checks. This class is the framework's canonical example, and says so in its own doc (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:13-14`).
  `[Rubric §11, Security]` assesses credential handling. The HS256 branch does not merely check that a secret is present, it checks the length: fewer than 32 characters fails, and the message explicitly tells the operator to replace the placeholder with a real secret from user-secrets or environment variables (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:72-77`). That is deliberate: a short or shipped-placeholder HMAC key is the failure mode that would otherwise reach production silently.
  `[Rubric §15, Best Practices & Code Quality]` assesses fail-fast posture. Registration pairs the bind with `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:541-544`), so both the attribute checks and `Validate` run at boot, not on the first token issued ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Walkthrough**: one static field, eight `init` properties, one method.
  - `SectionName = "Jwt"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:19`).
  - `SigningAlgorithm` (`:30`): defaults to [JwtSigningAlgorithm](#jwtsigningalgorithm)`.RS256`, and the remarks give the reason (`:24-29`): asymmetric signing is what lets a validator verify a token without holding the key that mints one, so a host that never sets `Jwt:SigningAlgorithm` gets the algorithm that survives extraction. A single-host monolith opts into HS256 explicitly.
  - `SecretForKey` (`:37`), `RsaPrivateKeyPem` (`:43`), `RsaPublicKeyPem` (`:50`): none carries `[Required]`, because whether it is required is decided in `Validate`. The docs are specific about the split: the private key is what an issuer signs with, the public key is what an in-process validator verifies with, and a service that fetches the key through JWKS at runtime leaves the public key unset (`:45-49`).
  - `Issuer` (`:54`) and `Audience` (`:58`): both `[Required]` (`:53`, `:57`), because they matter in every mode.
  - `AccessTokenExpirationMinutes` (`:61`), default `15`; `RefreshTokenExpirationDays` (`:64`), default `7`. The short-access-plus-long-refresh split of [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), expressed as defaults rather than as required configuration.
  - `Validate(ValidationContext)` (`:70-85`): an iterator method with two independent checks. Under HS256, `SecretForKey.Length < 32` yields a failure naming `SecretForKey` (`:72-77`); under RS256, a null or whitespace `RsaPrivateKeyPem` yields a failure naming `RsaPrivateKeyPem` (`:79-84`). Note the asymmetry: the private key is enforced here, the public key is not, because a service that only validates fetches it through JWKS.
  - The in-process validator enforces the other half at wiring time instead: `BuildValidationParameters` throws when RS256 is selected with no `RsaPublicKeyPem`, and the message points at `AddForwardedJwtBearer` for services that should fetch the key at runtime (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:629-642`).
- **Why it's built this way**: keeping the conditional rule in code next to the properties it constrains, rather than in the registration call, means every host that binds this section gets the same guarantee without repeating it. The algorithm switch is a hard cutover that invalidates every existing token (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:17-18`), so failing the boot on a half-configured section is much cheaper than discovering it at the first sign or the first validation.
- **Where it's used**: bound in `AddCommonAuthentication` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:541-544`), which then re-reads the section eagerly to build the token validation parameters at wiring time (`:549-552`); consumed by [TokenService](#tokenservice) through `IOptions<JwtSettings>`, which branches on the algorithm once in the constructor and caches the credentials (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:54-75`).

### RsaJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:14` · Level 1 · class (sealed)

- **What it is**: the production [IJwksProvider](#ijwksprovider). It builds a `JsonWebKeySet` from a PEM-encoded RSA public key configured via [JwksSettings](group-08-auth.md#jwkssettings), and returns an empty set when publishing is disabled (the default) or no key is configured (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:7-12`).
- **Depends on**: [IJwksProvider](#ijwksprovider); [JwksSettings](group-08-auth.md#jwkssettings) via `IOptions<JwksSettings>` (`:2`, `:4`, `:15`); `System.Security.Cryptography.RSA` and `Microsoft.IdentityModel.Tokens` (`JsonWebKeySet`, `RsaSecurityKey`, `JsonWebKeyConverter`, `SecurityAlgorithms`).
- **Concept**: this reinforces the JWKS story introduced on [IJwksProvider](#ijwksprovider) (`[Rubric §11, Security]`, `[Rubric §7, Microservices Readiness]`, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) and adds one lesson of its own about caching failure. The PEM parse cost is paid once and memoized in a `Lazy<JsonWebKeySet>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:21-22`), but the mode is `LazyThreadSafetyMode.PublicationOnly`, not the default `ExecutionAndPublication`. The comment above it (`:17-21`) explains why, and it is worth internalizing: the default `Lazy<T>` caches a factory **exception** forever, so a single transient IO failure reading the PEM file would brick `/.well-known/jwks.json` (and with it cross-service auth) until the process restarts. `PublicationOnly` caches only a successful result and lets a later call retry; concurrent factory runs are harmless here because `BuildKeySet` is pure and disposes its own `RSA`. That is `[Rubric §29, Resilience]` reasoning applied to one field declaration.
- **Walkthrough**
  - Primary constructor takes `IOptions<JwksSettings> options` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:14`) and the `Lazy<JsonWebKeySet>` captures it (`:22-23`); `GetJsonWebKeySet()` is just `_cachedKeySet.Value` (`:26`).
  - `BuildKeySet(JwksSettings settings)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:27`) short-circuits to an empty `JsonWebKeySet` when `!settings.Enabled` (`:30-33`) or when the resolved PEM is blank (`:36-39`). Those are the two paths that satisfy the [IJwksProvider](#ijwksprovider) never-throw contract.
  - With a key present it imports the PEM into a disposable `RSA` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:40-41`), exports **only** the public parameters (`ExportParameters(includePrivateParameters: false)`, `:44`) into an `RsaSecurityKey` tagged with the configured `KeyId` (`:44-47`), converts it with `JsonWebKeyConverter.ConvertFromRSASecurityKey` (`:49`), marks it `Use = "sig"` and `Alg = SecurityAlgorithms.RsaSha256` (`:50-51`) so consumers know the key's purpose and algorithm, and adds it to a fresh key set (`:53-55`).
  - `ResolvePem(JwksSettings settings)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:57`) prefers the inline `RsaPublicKeyPem` (`:60-63`) and otherwise reads `RsaPublicKeyPath` from disk with a synchronous `File.ReadAllText` (`:70`), justified in the comment because the read happens on the first request and its success is cached, while a failure is deliberately not cached (`:67-69`). With neither configured it returns `null` (`:73`), which is what lands `BuildKeySet` on the empty-set path.
- **Why it's built this way**: exporting only the public parameters guarantees the private key can never reach the JWKS document even by accident. The inline-PEM-or-path pair supports both secrets-manager injection (env var or config) and a volume-mounted key file, which are the two deployment shapes the framework's samples use. `sealed`, and registered singleton (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:183`) so the cache is process-wide.
- **Where it's used**: the JWKS minimal-API endpoint calls `GetJsonWebKeySet()` per request; see [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).

### PasswordHasher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:12` · Level 1 · class

- **What it is**: the framework's one credential hasher. It derives a hash for a new password and
  verifies a candidate password against a stored `(hash, salt)` pair, using PBKDF2-HMAC-SHA512 at
  600,000 iterations. PBKDF2 is the *only* algorithm in the type: every hash it writes and every hash
  it verifies goes through the same derivation
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:7-11`).
- **Depends on**: [`IPasswordHasher`](#ipasswordhasher), the Application-layer port it implements
  (imported at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:3`, declared at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:6`).
  Externals are BCL only: `System.Security.Cryptography` (`Rfc2898DeriveBytes`,
  `RandomNumberGenerator`, `CryptographicOperations`) and `System.Text.Encoding`.
- **Concept introduced: a password is stored as a deliberately slow, salted one-way derivation.**
  `[Rubric §11, Security]` assesses credential-at-rest protection, and this 64-line type is where the
  framework makes its whole stance on it. Three decisions are visible in source and each one answers a
  specific attack. A per-credential 32-byte salt drawn from a CSPRNG
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:15`, `:31`) means two
  users who pick the same password get different stored hashes, so a precomputed rainbow table buys an
  attacker nothing. A 600,000-iteration work factor
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:24`, OWASP 2023
  guidance for PBKDF2-HMAC-SHA512) makes each guess in an offline cracking run cost real CPU time,
  which is the only defense once a dump has left the building. And `FixedTimeEquals` (`:53`) compares
  the full buffer regardless of where the first byte differs, so the *duration* of a failed login
  carries no information about how close the guess was. `[Rubric §16, Maintainability]` applies to the
  shape rather than the crypto: one algorithm, no version flag, no per-app copy, so the question
  "which primitive authenticated this login" has exactly one answer everywhere.
- **Walkthrough**
  - Three private constants carry the whole policy: `SaltSize = 32` (256 bits,
    `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:15`),
    `HashSize = 64` (512 bits, `:18`), and `Iterations = 600_000` (`:24`). Changing the policy is a
    one-line edit; reading it takes no archaeology.
  - `HashPassword(string password)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:27`) rejects null,
    empty and whitespace-only input up front with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:29`),
    draws a fresh salt from `RandomNumberGenerator.GetBytes(SaltSize)` (`:31`, the cryptographic RNG
    and not `Random`), derives 64 bytes via `Rfc2898DeriveBytes.Pbkdf2` over the UTF-8 password bytes
    (`:32-37`), and returns the `(Hash, Salt)` named tuple (`:39`). The salt is generated here rather
    than accepted from the caller, so no call site can accidentally reuse one.
  - `VerifyPassword(string password, byte[] hash, byte[] salt)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:43`) guards all
    three arguments (`:45-47`), recomputes the derivation over the *stored* salt (`:49`), and returns
    `CryptographicOperations.FixedTimeEquals(computedHash, hash)` (`:53`). Note the third argument at
    `:49`: it derives `hash.Length` bytes, not `HashSize`, so the comparison is made at whatever length
    the stored hash actually has instead of failing on a length mismatch.
  - `ComputePbkdf2Hash(string password, byte[] salt, int outputLength)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:57-63`) is the
    single expression-bodied derivation both public members route through, which is what keeps the
    write path and the verify path from ever drifting apart.
- **Why it's built this way**: the type used to carry a second verification branch, an HMAC-SHA512
  recompute selected at verify time by reading the stored salt length, kept alive for credentials
  written under an older scheme.
  [ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html) records its
  removal and supersedes
  [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html): the legacy branch verified
  a single-round digest offering none of the offline-cracking resistance the rest of the design argues
  for, and keying algorithm selection on a data property meant the credential row, not configuration,
  decided which primitive ran. With the legacy corpus gone, deleting the branch made the stored format
  and the executing primitive the same fact. The remaining shape (no per-app hasher, no algorithm
  parameter on the port) is what lets `[Rubric §11, Security]` be assessed once for both applications.
- **Where it's used**: registered as `services.TryAddSingleton<IPasswordHasher, PasswordHasher>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:563`); the type is
  stateless, so a singleton is safe. Consumers reach it through the port:
  [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) takes it as a constructor
  parameter (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:56`),
  verifies on login (`:159`, and a failure there increments the brute-force counter at `:160`) and
  hashes on registration (`:210`);
  [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand)
  verifies the current password then re-hashes the new one
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:27`,
  `:55`, `:61`); and
  [`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
  only hashes
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:33`,
  `:79`), because possession of the reset token stands in for knowledge of the old password.
- **Caveats / not-in-source**: `VerifyPassword` returns a plain `bool`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:43`), so there is no
  "this row was derived with a lower work factor, rehash it" signal on the successful-login path.
  Verification recomputes with the current `Iterations` constant (`:61`), so raising it invalidates
  previously stored hashes, and nothing in this file or its call sites migrates them.

### TokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:24` · Level 2 · class

- **What it is**: the JWT issuer. It mints signed access tokens carrying the user id, email, role and
  display name (plus any extra claims a caller supplies), generates opaque random refresh tokens,
  projects both configured lifetimes as `TimeSpan`s, and re-reads an already-expired access token
  during the refresh flow. It signs with RSA-SHA256 or HMAC-SHA256, decided once at construction from
  configuration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:11-23`).
- **Depends on**: [`ITokenService`](#itokenservice) (the port it implements) and `IDisposable`;
  [`JwtSettings`](group-08-auth.md#jwtsettings),
  [`JwtSigningAlgorithm`](group-08-auth.md#jwtsigningalgorithm) and
  [`JwksSettings`](group-08-auth.md#jwkssettings), all bound through
  `IOptions<T>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:54-57`).
  Externals: `System.IdentityModel.Tokens.Jwt` (`JwtSecurityToken`, `JwtSecurityTokenHandler`),
  `Microsoft.IdentityModel.Tokens` (`SigningCredentials`, `SecurityKey`, `TokenValidationParameters`),
  `System.Security.Cryptography` (`RSA`, `RandomNumberGenerator`), and `TimeProvider` for the clock.
- **Concept introduced: asymmetric issuance, and one deliberate hole in validation.**
  `[Rubric §11, Security]` assesses token issuance and algorithm-confusion defense, and two choices
  here are worth reading slowly. First, `GetPrincipalFromExpiredToken` sets `ValidateLifetime = false`
  on purpose (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:145`) under
  a narrowly scoped `#pragma warning disable CA5404` (`:145`, restored at `:147`) whose comment states
  why: the refresh flow's whole job is reading claims out of a token that has already expired. Every
  other check stays on (`:142-144`). Second, the algorithm is pinned twice: `ValidAlgorithms` limits
  validation to the one algorithm this instance was built for (`:151`), and the token header's `alg` is
  re-compared with an ordinal string comparison *after* validation succeeds (`:160-161`). That pair is
  the defense against algorithm substitution, where an attacker takes the RSA *public* key (which is
  published on purpose) and presents it as an HMAC shared secret.
  `[Rubric §7, Microservices Readiness]` applies to the algorithm switch itself: RS256, the default,
  lets an extracted service validate a token without ever holding the issuer's private key, because it
  fetches the public key from the JWKS document that [`RsaJwksProvider`](#rsajwksprovider) publishes
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). HS256 remains
  available for a single-process monolith, where issuer and validator are the same host and a shared
  secret costs nothing (`:16-23`). `[Rubric §14, Testability]` shows up in the constructor: the clock
  is an injected `TimeProvider` with a `TimeProvider.System` fallback (`:63`), so a test can assert
  `iat`/`nbf`/`exp` without waiting for wall-clock time to pass.
- **Walkthrough**
  - Fields (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:26-35`): the
    settings snapshot, the `TimeProvider`, the `SigningCredentials` used to sign, the `SecurityKey` and
    algorithm string used to validate, and two nullable owned `RSA` handles. The comment at `:33-34`
    explains why `IDisposable` is on the class at all: `RsaSecurityKey` does not own the `RSA` it
    wraps, so something has to.
  - The constructor
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:54-75`) materializes
    all key material exactly once, so no token operation re-parses a PEM. For
    `JwtSigningAlgorithm.RS256` it builds RSA credentials and pins `SecurityAlgorithms.RsaSha256`
    (`:65-70`); the key id it passes is `jwksSettings?.Value.KeyId` falling back to a default
    `JwksSettings` instance (`:68`), which is how the same `kid` ends up on both the token and the
    published JWK (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:45`).
    Otherwise it builds HMAC credentials and pins `HmacSha256` (`:73-74`).
  - `GenerateAccessToken(userId, email, role, fullName, additionalClaims)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:78-115`) reads the
    clock once (`:86`), then builds six claims (`:92-100`): `sub` (the user id, formatted with
    `CultureInfo.InvariantCulture`), `jti` (a fresh GUID, so a token is individually identifiable),
    `iat` as Unix seconds, and the standard name, email and role claims. The comment at `:88-91` is the
    design note worth internalizing: `sub` is the *only* carrier of the user id. A duplicate custom
    claim used to ride alongside it, which meant two values that could disagree and two claim names
    every reader had to know; readers now go through
    [`ClaimsPrincipalExtensions`](#claimsprincipalextensions) instead. Caller-supplied claims are
    appended (`:102-105`), then a `JwtSecurityToken` is assembled with issuer, audience, `notBefore`
    from the injected clock and `expires` at `now + AccessTokenExpirationMinutes` (`:107-113`) and
    serialized (`:115`).
  - `GenerateRefreshToken()`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:118-122`) returns 64
    CSPRNG bytes Base64-encoded. It is not a JWT and carries no claims: it is an opaque bearer string
    whose only property is being unguessable, and the store it is compared against is what gives it
    meaning.
  - `AccessTokenLifetime` and `RefreshTokenLifetime`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:125`, `:129`) project
    the configured minutes and days, so callers computing an expiry timestamp never re-read settings
    and never disagree with the token just minted.
  - `GetPrincipalFromExpiredToken(string token)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:137-171`) builds the
    validation parameters described above (`:140-152`), validates (`:158`), applies the
    post-validation `alg` re-check and returns `null` when the token is not a `JwtSecurityToken` or the
    header disagrees (`:160-164`), and swallows every exception into `null` (`:168-171`). A malformed,
    forged, or wrong-issuer token therefore produces a plain "no principal" answer rather than a parser
    exception leaking to the caller.
  - `Dispose()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:174-178`)
    releases both owned `RSA` handles.
  - `BuildHmacCredentials`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:180-192`) throws
    `InvalidOperationException` when `SecretForKey` is missing (`:183-187`) and Base64-decodes it into
    a `SymmetricSecurityKey` used for both signing and validation (`:190-192`).
  - `BuildRsaCredentials`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:194-249`) throws when
    `RsaPrivateKeyPem` is missing (`:199-203`), imports the private key (`:205-208`), and stamps the
    key id on the signing key (`:214`) so every RS256 token carries a `kid` header. The comment at
    `:210-213` gives the reason: a validator reading the published JWKS selects the key by name, and
    without a `kid` it has to try every published key, which stops working the moment a rotation
    publishes two. The validation key prefers the configured `RsaPublicKeyPem` and otherwise derives
    the public parameters from the private key (`:223-231`), so an issuer configured with only a
    private key still validates its own tokens during refresh; it carries the same key id (`:236`).
    Both nested `try`/`catch` blocks dispose the partially built `RSA` before rethrowing (`:239-243`,
    `:245-249`), so a bad PEM does not leak a native handle. Because all of this runs in the
    constructor, missing or malformed key material fails at host startup, not on the first login.
- **Why it's built this way**:
  [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) records the
  asymmetric-issuance rationale. The DI lifetime deserves its own read at the registration site
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:556-562`): the comment
  there records that a scoped lifetime disposed the underlying `RSA` at end-of-request while the static
  `CryptoProviderCache` in `Microsoft.IdentityModel.Tokens` still held the cached
  `AsymmetricSignatureProvider` wrapping it, throwing `ObjectDisposedException` on the next RS256 sign.
  Singleton is correct because the constructor depends only on singleton options and the service is
  stateless afterwards.
- **Where it's used**: registered as `services.TryAddSingleton<ITokenService, TokenService>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:562`) and consumed
  through the port by [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser): the
  lifetime feeds the response's expiry
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:102-103`, with a
  15-minute floor when the setting is non-positive), the refresh flow reads the expired token (`:278`),
  and refresh tokens are minted at `:627` and `:667`. That base also wraps this service in a private
  `SessionStampingTokenService` pass-through
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:773`) which
  appends the [`AuthClaimTypes`](#authclaimtypes)`.SessionId` (`sid`) claim through the
  `additionalClaims` parameter when a session is armed (`:782-800`, the claim added at `:797`), so
  per-device session identity is layered on without this type knowing about sessions at all. The `sub`
  claim it writes is what [`CurrentUserService`](#currentuserservice) and
  [`ClaimBasedUserIdProvider`](#claimbaseduseridprovider) read back.
- **Caveats / not-in-source**: nothing here rotates or reloads key material. The keys are read once in
  the constructor
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:54-75`) and the
  instance is a singleton, so a key change takes a host restart. Refresh-token storage, rotation and
  revocation are not in this file either: it only produces the random string.

### IPasswordChangeableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11` · Level 3 · interface

- **What it is**: the password-rotation surface an Identity module's `User` aggregate exposes to the shared [ChangePasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) workflow. It is one method on top of [IAuthUser](#iauthuser) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:5-9`).
- **Depends on**: [IAuthUser](#iauthuser) (its base interface, `:11`) and [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`:1`).
- **Concept: capability interfaces layered by workflow.** `[Rubric §1, SOLID]` assesses interface segregation, and this is the pattern applied twice over: a `User` that only ever authenticates satisfies [IAuthUser](#iauthuser); a `User` whose app offers self-service password change implements this one and gets `PasswordHash` and `PasswordSalt` along with it, because the workflow must verify the current credential before writing the new one (the XML comment states exactly this reason, `:7-9`). Inheritance here encodes a real dependency between capabilities rather than a taxonomy. `[Rubric §4, DDD]` also applies: the method returns [Result](group-01-result-error-handling.md#result), so the aggregate can refuse the change (an invariant failure) instead of the handler assuming success.
- **Walkthrough**: one member, `Result ChangePassword(byte[] newPasswordHash, byte[] newPasswordSalt)` (`:19`). The aggregate receives already-hashed material, never a plaintext password: hashing is the handler's job via [IPasswordHasher](#ipasswordhasher), so no plaintext ever reaches the Domain layer or an EF change tracker.
- **Why it's built this way**: keeping the hash-and-salt pair as the parameter shape mirrors [IAuthUser](#iauthuser)'s two properties and [IPasswordHasher](#ipasswordhasher)'s tuple return, so the whole chain from handler to aggregate speaks one vocabulary. See [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html).
- **Where it's used**: as the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IPasswordChangeableUser` on the shared change-password workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:29`), which verifies the current password (`:55`), hashes the new one (`:61`), and calls `ChangePassword` with the result (`:62`). The forgot-password sibling, [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand), calls the same member on the redeem path after [IPasswordResetTokenService](#ipasswordresettokenservice) has identified the account (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:80-81`). Both apps' [User](group-24-identity-module.md#user) aggregates declare it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34-35`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:29-30`), which is also how they pick up [IAuthUser](#iauthuser).

### IUserPreferences
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:10` · Level 3 · interface

- **What it is**: the stored UI-preference surface an Identity module's `User` aggregate exposes to the shared preference read and write workflows: preferred culture, preferred theme, and a single method that replaces both (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:5-8`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`:1`). Nothing else; it is deliberately not tied to [IAuthUser](#iauthuser), because preferences are orthogonal to credentials.
- **Concept: null as "not chosen".** `[Rubric §27, i18n]` assesses whether locale is a first-class, persisted user choice rather than a per-session guess, and `[Rubric §19, State Management]` assesses where such UI state lives. Both properties are nullable, and the contract states that `null` means the user has not chosen that preference (`:7-8`), which is what lets the UI fall back to a browser or host default without needing a separate "is set" flag. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the culture model and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) for the theme model.
- **Walkthrough**: `string? PreferredCulture` (for example `"es"`, `:13`) and `string? PreferredTheme` (`"light"` or `"dark"`, `:16`) are read-only. `Result UpdatePreferences(string? preferredCulture, string? preferredTheme)` (`:25`) replaces **both** at once. The subtlety is documented at `:18-21`: because the method is a whole-object replace, the shared workflow always passes the currently stored value for any field the request left `null`, so writing one preference never silently clears the other. That read-then-merge is visible in the caller (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53`).
- **Why it's built this way**: one replace method keeps the aggregate's invariant check in a single place, and pushing the merge into the workflow keeps the null-means-unchanged policy out of every app's `User`. Returning [Result](group-01-result-error-handling.md#result) lets the aggregate reject an unsupported culture or theme value.
- **Where it's used**: the read workflow constrains `where TUser : AuditableBaseEntity<UserIdentifierType>, IUserPreferences` and projects both properties into a response (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:23`, `:44`); the write workflow constrains `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IUserPreferences` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:26`). Both are cross-linked as [GetUserPreferencesHandlerBase<TUser>](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser) and [ChangePreferencesHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand), and both apps' [User](group-24-identity-module.md#user) aggregates implement the interface.

### RefreshSession
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:31` · Level 3 · class (sealed)

- **What it is**: one refresh-token session, meaning a single device's right to mint access tokens for one user, held as a **hash** of the issued refresh token. A user has as many rows as they have signed-in devices, so signing in on a phone no longer signs the same account out of a laptop (BR-205/206, `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:7-10`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`:3`), the `UserIdentifierType` alias, and from the BCL `System.Security.Cryptography.SHA256`, `System.Text.Encoding`, and `Convert.ToHexString` (`:1-2`). Persisted by [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore) behind [IRefreshSessionStore](#irefreshsessionstore), mapped by [RefreshSessionModelBuilderExtensions](group-07-persistence-ef-core.md#refreshsessionmodelbuilderextensions), swept by [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice), tuned by [RefreshSessionSettings](#refreshsessionsettings).
- **Concept introduced: a refresh token is a credential, so store its digest and make reuse detectable.** `[Rubric §11, Security]` assesses how a long-lived credential is stored, rotated, and revoked, and this one class carries three separate properties that are each worth understanding on their own.
  - **Hash at rest.** The plaintext refresh token exists only in the response that hands it to the client; the row keeps `TokenHash` (`:63-64`), so a database read cannot mint tokens (`:11-15`). That forces one design consequence the comment calls out explicitly: because lookups are **by hash**, the digest must be unsalted and deterministic. A per-row salt would make the token unfindable. This is the opposite trade-off from [PasswordHasher](#passwordhasher), and legitimately so: a refresh token is 64 random bytes from a CSPRNG rather than a human-chosen password, so there is no dictionary to run against it and no value in slowing the digest down.
  - **Rotation leaves a chain.** Using a session revokes it and records its successor in `ReplacedByTokenHash` (`:16-21`, `:75-79`). The point is not bookkeeping: presenting an already-rotated token lands on a **revoked row** rather than on nothing, and that difference is the signal that a token was replayed. A stolen-and-replayed token therefore triggers revocation of the whole family instead of failing quietly (BR-206 reuse detection, [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)).
  - **Framework bookkeeping, not an aggregate.** The class comment (`:22-29`) is explicit that this is a flat record like [OutboxMessage](group-04-events-outbox.md#outboxmessage) and [AuditTrailEntry](group-07-persistence-ef-core.md#audittrailentry): no audit stamps, no soft-delete flag, no concurrency token. The reason matters for `[Rubric §8, Data Architecture]`: rows are never deleted or edited except to be revoked, and **no global query filter may hide a revoked row**, because the reuse check depends on finding it. It is also mapped only where a consumer opts in (`ApplyRefreshSessionConfiguration`), since sessions belong to the Identity module's database rather than to every data source ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service).
- **Walkthrough**
  - **Width and reason constants** (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:33-55`): `TokenHashLength = 64` (the width of a hex-encoded SHA-256 digest, `:34`), `IpAddressMaxLength = 45` (sized to fit an IPv4-mapped IPv6 literal, `:37`), `UserAgentMaxLength = 512` (`:40`), `ReasonRevokedMaxLength = 64` (`:43`), and the four revocation reasons `ReasonRotated` (`:46`), `ReasonSignedOut` (`:49`), `ReasonReuseDetected` (`:52`), and `ReasonSessionCap` (`:55`). Publishing the widths as `public const` on the Domain type is what lets the EF configuration derive every column width from the same numbers (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:47`, `:52`, `:56-58`) rather than repeating magic numbers in a mapping file.
  - **State** (`:57-92`): `Id` defaults to a fresh `Guid` (`:58`); `UserId`, `TokenHash`, `CreatedAt` and `ExpiresAt` are `required` and `init`-only (`:61-70`), so a session cannot be constructed without them and cannot be rewritten afterwards. The three mutable members carry `private set` and change only through `Revoke`: `RevokedAt` (`:73`), `ReplacedByTokenHash` (`:79`), `ReasonRevoked` (`:82`). `IpAddress` (`:89`) and `UserAgent` (`:92`) are optional `init`-only capture. The comment on `IpAddress` (`:84-88`) is a good example of documenting what a field is **not** for: it identifies a session in a "your devices" list and gives an audit trail for a revocation, and it is never part of a validation decision, so a mobile client changing networks is not signed out.
  - **Derived state**: `IsRevoked => RevokedAt is not null` (`:95`) and `IsActiveAt(DateTime utcNow) => !IsRevoked && ExpiresAt > utcNow` (`:99`). Passing the instant in rather than reading a clock keeps the type free of ambient time, which is what makes it directly unit-testable (see [RefreshSessionTests](group-27-testing-infrastructure.md#refreshsessiontests)).
  - **`Create(...)`** (`:112-145`), the factory returning `Result<RefreshSession>` in the framework's standard shape (see the primer on factory methods and the [Result](group-01-result-error-handling.md#result) pattern). Two guards: a blank token fails with `RefreshSession.TokenRequired` (`:120-126`), and an expiry at or before creation fails with `RefreshSession.ExpiryInPast` (`:128-134`), both `Error.Validation`. On success it hashes the token on the way in (`:139`), so **the plaintext never reaches a property**, and truncates the two optional capture fields to their column widths (`:142-143`). Truncating in the factory rather than trusting the caller is what keeps an oversized `User-Agent` header from turning a login into a database error.
  - **`HashToken(string refreshToken)`** (`:160-164`): `Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)))`, guarded by `ArgumentException.ThrowIfNullOrWhiteSpace` (`:162`). The `<remarks>` (`:151-157`) is the one piece of this file to read twice: the encoding is **part of the contract, not an implementation detail**, because a consumer's data migration has to reproduce it exactly to carry existing tokens over. It even gives the T-SQL equivalent, `CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), Token)), 2)`, and explains both halves of why it matches: style 2 emits upper-case hex with no `0x` prefix, and the `varchar` conversion is what makes the hashed bytes UTF-8 rather than SQL Server's default UTF-16. `[Rubric §8, Data Architecture]` and `[Rubric §34, Architecture Governance & Documentation]` both apply here: a hash format that a migration must reproduce is a published contract, and it is documented as one.
  - **`Revoke(DateTime revokedAt, string reason, string? replacedByTokenHash = null)`** (`:174-189`): the only mutator. It is **idempotent by refusal** (`:166-169`), returning `Error.Invariant("RefreshSession.AlreadyRevoked", ...)` when the session is already revoked (`:176-182`) rather than silently overwriting, so the first reason and instant recorded are the ones kept. That matters for forensics: a session revoked by reuse detection must not have that reason overwritten by a later sign-out. On success it stamps the instant, the truncated reason, and the successor hash (`:184-186`).
  - `Truncate` (`:191-192`) is the shared private helper, returning the value unchanged when it is null, empty, or already short enough.
- **Why it's built this way**: [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) records the move from one plaintext refresh-token column on the user row to a session table, and [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) the rotation-and-reuse-detection model the chain implements. Keeping the class free of audit stamps and soft-delete is deliberate rather than an omission, and keeping `Create`/`Revoke` as the only ways in and out means every row in the table was validated and every revoked row carries a reason.
- **Where it's used**: [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) is the main consumer. It hashes a presented token to look the session up (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:352`, `:593`), creates one per login (`:628`) and per rotation (`:668`), revokes on sign-out (`:360`, `:367`, `:385`, `:456`), revokes the live family on reuse detection (`:603`, `:691`), and evicts the oldest session with `ReasonSessionCap` when a user exceeds `RefreshSessions:MaxActiveSessionsPerUser` (`:733`, documented at `:111`). Rotation itself is a claim rather than a plain mutation: [IRefreshSessionStore](#irefreshsessionstore)`.TryRotateAsync` revokes with `ReasonRotated` and links the successor (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:104`; the EF implementation does it as a conditional `ExecuteUpdate`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:129`, `:142`). The table is mapped through `ApplyRefreshSessionConfiguration` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:680`), and the account-deletion path deliberately does **not** revoke sessions (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:103-107`): the refresh flow re-fetches the user through the soft-delete query filter, so an erased account's sessions stop working the moment the delete commits.

### IErasableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30` · Level 4 · interface

- **What it is**: the erasure surface an Identity module's `User` aggregate exposes to the shared [DeleteUserHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) workflow: soft-delete the row, then irreversibly anonymize the personal data it still holds (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:6-9`).
- **Depends on**: [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) (its base, contributing `Result Anonymize()`, `:1` and `:30`) and [Result](group-01-result-error-handling.md#result) (`:2`).
- **Concept introduced: why a `Delete()` that already exists on the base entity is redeclared here.** This is the most instructive comment in the file and it is worth reading in full (`:11-29`). [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) already has a `Delete()`. But an app's `User` may **hide** it (`public new Result Delete()`) to couple account-specific behavior to deletion. A hidden method is not an override, and C# member lookup on a generic type parameter prefers the members of its **class** constraint, so a shared workflow writing `user.Delete()` would bind to the base implementation and silently skip the app's version. Because the app `User` lists this interface in its own base list, the interface map resolves to the most derived `Delete()` declared on the app type, so invoking it **through the interface** forces interface dispatch and reaches exactly the member the app intended. `[Rubric §1, SOLID]` (Liskov: the hidden method is exactly the substitutability hazard this closes) and `[Rubric §15, Best Practices & Code Quality]` both apply, and this is a case where a language rule, not a style preference, dictates the design. The second paragraph (`:25-28`) adds the compile-time guarantee: the base entity deliberately does **not** implement this interface, so a consumer that forgets to declare it fails the generic constraint at compile time rather than losing behavior at run time.
- **Walkthrough**: one declared member, `Result Delete()` (`:37`), documented as soft-delete plus whatever the app couples to deletion (`:32-34`), returning a failure when the account is already deleted (`:36`). Inherited from [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) is `Result Anonymize()`, which must be idempotent. The two-step order is visible in the caller: cast once to the interface (`IErasableUser erasable = user;`, `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:114`, with the reason spelled out at `:88-92`), `erasable.Delete()` first (`:94`), the app's own tail hook next (`OnAfterSoftDeleteAsync`, `:101`), then `erasable.Anonymize()` (`:108`), each short-circuiting on failure.
- **Why it's built this way**: soft-delete alone hides a row but retains its personal data, so it does not satisfy an erasure request; anonymize-in-place overwrites the personal fields while keeping the row so foreign keys and the audit trail survive ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). Splitting the two into separate members lets the workflow run app-specific work between them, which the handler documents as the only point where an app can both read the personal data and know the delete succeeded (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:41-42`). `[Rubric §30, Compliance, Privacy & Data Governance]` assesses exactly this: an erasure path that does not destroy referential integrity.
- **Where it's used**: the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IErasableUser` on the shared delete-user workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:62`), implemented by each app's [User](group-24-identity-module.md#user) aggregate (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34-35`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:29-30`).
- **Caveats / not-in-source**: the interface's own comment says an app typically hides `Delete()` to revoke the refresh token (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:16`, `:34`). That phrasing predates the move to [RefreshSession](#refreshsession) rows and no longer describes either app. ADC is the only consumer that hides the method, and its version calls `base.Delete()` and raises a `UserDeleted` domain event (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:341-350`), with the XML comment there stating outright that sessions are not touched and do not need to be. MMCA.Store does not hide `Delete()` at all. The load-bearing lesson (interface dispatch over a possibly-hidden base member) is unchanged; the example in the comment is stale.

### LoginProtectionService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19` · Level 5 · class (sealed)

- **What it is**: the cache-backed brute-force and rate-limiting service: exponential-backoff account lockout after repeated login failures, plus a per-IP registration rate limit (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:9-18`).
- **Depends on**: [ILoginProtectionService](#iloginprotectionservice) (the Application port); [LoginProtectionSettings](#loginprotectionsettings) via `IOptions<>` (`:21`, snapshotted at `:23`); [ICacheService](group-09-caching.md#icacheservice) (`:20`); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`:4`); and the [Email](group-02-domain-building-blocks.md#email) value object, used purely as a normalizer (`:5`).
- **Concept introduced: counter keys must be normalized the same way the lookup is.** `[Rubric §11, Security]` assesses brute-force protection and rate limiting; `[Rubric §10, Cross-Cutting Concerns]` assesses whether it is one shared service rather than logic copied per endpoint. Two mechanisms in this file deserve close reading.
  - **Key normalization** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:34-43`, documented at `:25-33`): `NormalizeIdentity` runs the supplied address through [Email](group-02-domain-building-blocks.md#email)`.Create` and uses the normalized value (`:39-41`). Without it, the counter keys are built from raw request input while the user lookup runs against the normalized value object, so `User@x.com`, `user@x.com` and `" user@x.com "` resolve to one account but get **independent** attempt counters, and an attacker defeats the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) backoff just by varying capitalization. A malformed address (which never matches a user but still increments a counter) falls back to the same trim-and-lowercase shape (`:41`) so its attempts collapse onto one key too. The `#pragma warning disable CA1308` (`:40`) is scoped and justified: lowercase is the RFC 5321 normalization `Email` itself performs. [PasswordResetTokenService](#passwordresettokenservice) copies this helper verbatim and cites this type as the reason (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:34-38`).
  - **The lockout curve** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:80-90`): `excessAttempts = newCount - MaxFailedAttempts` (`:82`) drives `lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), MaxLockoutSeconds)` (`:88`), doubling the lockout per excess failure (1s, 2s, 4s, and so on) up to the configured cap. The inner `Math.Min(excessAttempts, 30)` clamps the shift exponent, and the comment explains why (`:84-87`): C# masks an `int` shift count to five bits, so `1 << 31` is negative and `1 << 32` wraps back to `1`, which would silently shrink the lockout for a sufficiently persistent attacker. Since `1 << 30` already exceeds the `[Range(1, 3600)]` cap on [LoginProtectionSettings](#loginprotectionsettings)`.MaxLockoutSeconds`, deep excess always lands on the cap.
- **Walkthrough**
  - Key builders: `LockoutKey` produces `login:lockout:{normalized}` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:45`), `AttemptsKey` produces `login:attempts:{normalized}` (`:47`), `RegistrationKey` produces `registration:ip:{ipAddress}` (`:136`, and note this one is **not** normalized: an IP literal is already canonical).
  - `CheckLockoutAsync(string email, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:50`): reads the boolean lockout key (`:53`) and returns `Error.Unauthorized("Auth.TooManyAttempts", ...)` when set, otherwise `Result.Success()` (`:55-60`). A cache miss is treated as not locked out (`?? false`), so a cache outage fails open on lockout rather than locking everyone out.
  - `IncrementFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:64`): increments the attempts key with the `FailedAttemptWindowMinutes` TTL (`:75-78`), and once the count reaches `MaxFailedAttempts` writes the lockout key with the exponential TTL (`:80-90`).
  - `ResetFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:94`): removes both keys on a successful login (`:96-97`).
  - `CheckRegistrationRateLimitAsync(string? ipAddress, ...)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:101`): a null or empty IP is unrestricted (`:103-106`); otherwise it compares the per-IP count against `MaxRegistrationsPerIpPerHour` and fails with `Auth.RegistrationRateLimitExceeded` (`:109-116`).
  - `IncrementRegistrationCountAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:120`): no-ops on a missing IP (`:122-125`) and otherwise increments the per-IP counter with the `RegistrationRateLimitWindowMinutes` TTL (`:130-133`). The comment (`:127-129`) notes the TTL is refreshed on every write, so the window slides rather than staying anchored to the first registration, which only ever tightens the limit.
- **Why it's built this way**: reusing [ICacheService](group-09-caching.md#icacheservice) (Redis in production, in-memory fallback) instead of a bespoke store keeps the service thin and lets counters expire naturally by TTL rather than needing a sweep job; `IOptions<>` keeps every threshold configurable per environment ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). Registered scoped (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:149`).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:57`), which calls all five members across its login and registration flows: the lockout check (`:131`), an increment on both the unknown-user and wrong-password branches (`:146`, `:161`), the reset on success (`:178`), and the registration rate-limit check and increment (`:197`, `:256`). Incrementing on the unknown-user branch as well as the wrong-password branch is what keeps the endpoint from becoming a user-enumeration oracle by timing or by lockout behavior.
- **Caveats / not-in-source**: the increment is documented in source as **not atomic** on the distributed cache today (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:66-74`). [DistributedCacheService](group-09-caching.md#distributedcacheservice)`.IncrementAsync` is a read-modify-write, because the Redis `INCR` it used to issue wrote a plain string key while `IDistributedCache` reads entries back as hashes, and the mismatch made the counter unreadable (`WRONGTYPE`). The accepted cost: genuinely parallel attempts can overwrite each other's increments, so a concurrent burst can stay under `MaxFailedAttempts`. Sequential guessing, which is what a credential-stuffing run against one account looks like, still trips the lockout. The comment names the two ways to close the gap (a Lua script that increments within the hash layout, or moving counters off `IDistributedCache`); neither is implemented today.

### PasswordResetTokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26` · Level 5 · class (sealed)

- **What it is**: the [IPasswordResetTokenService](#ipasswordresettokenservice) implementation, and the whole forgot-password token lifecycle in one file: issue a single-use token for an address, throttle how often one address can ask, hash the token at rest, cap wrong guesses, and consume the token on a successful redeem (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:12-24`).
- **Depends on**: [IPasswordResetTokenService](#ipasswordresettokenservice) (the Application port, `:5`); [PasswordResetSettings](#passwordresetsettings) via `IOptions<>` (`:28`, snapshotted at `:32`); [ICacheService](group-09-caching.md#icacheservice) (`:6`, `:27`); [PasswordResetEntry](#passwordresetentry) (its cached record); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`:7`); the [Email](group-02-domain-building-blocks.md#email) value object as a normalizer (`:8`); and from the BCL `SHA256`, `RandomNumberGenerator`, `CryptographicOperations`, and `System.Buffers.Text.Base64Url` (`:1-3`).
- **Concept introduced: a reset token is a bearer credential, so treat it like a password.** `[Rubric §11, Security]` assesses credential issuance and redemption; `[Rubric §8, Data Architecture]` assesses picking the right store for the right lifetime. Four properties are designed in, and the class doc lists all four up front (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:15-24`).
  - **Hashed at rest.** Only `SHA256.HashData(...)` of the token is stored (`:55-56`, `:83`), so a cache dump does not hand out working reset links. Like [RefreshSession](#refreshsession) and unlike a password, a reset token is high-entropy (32 random bytes, `:30`, `:79`) and short-lived, which is why a plain digest is sufficient here where [PasswordHasher](#passwordhasher) needs 600,000 PBKDF2 iterations: there is no dictionary to run against a 256-bit random value.
  - **One active token per email.** The key is derived purely from the address (`:51`), so `SetAsync` overwrites (`:88`) and an older link stops working the moment a newer one is requested.
  - **Attempt cap.** Wrong tokens are counted on the record and the record is discarded at `MaxValidationAttempts` (`:140-144`), which turns the token into a credential you cannot grind at.
  - **No schema change, no sweeper.** The whole lifecycle rides [ICacheService](group-09-caching.md#icacheservice), so expiry is the cache TTL rather than a background job over a table ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). Compare [LoginProtectionService](#loginprotectionservice), which reaches the same conclusion for lockout counters.
- **Walkthrough**
  - Primary constructor takes `ICacheService cacheService` and `IOptions<PasswordResetSettings> settings` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26-28`), snapshotting `settings.Value` into `_settings` (`:32`). `TokenByteLength = 32` (`:30`) is the only other constant.
  - `NormalizeIdentity` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:40-49`) is the same [Email](group-02-domain-building-blocks.md#email)`.Create`-then-fallback shape as [LoginProtectionService](#loginprotectionservice), and its doc comment cites that type as the reason (`:34-39`): keys built from raw request input would give `User@x.com` and `user@x.com` independent tokens **and** independent request counters while resolving to one account. Two key builders follow: `TokenKey` produces `pwdreset:token:{normalized}` (`:51`) and `RequestKey` produces `pwdreset:req:{normalized}` (`:53`). `HashToken` is the shared SHA-256 helper (`:55-56`).
  - `IssueAsync(string email, UserIdentifierType userId, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:59`): throttle first. It increments the per-email request counter with the `RequestWindowMinutes` TTL (`:66-69`) and fails with `Error.Unauthorized("Auth.ResetThrottled", ...)` once the count exceeds `MaxRequestsPerEmail` (`:71-77`). Only then does it mint the token: 32 CSPRNG bytes rendered with `Base64Url.EncodeToString` (`:79`, URL-safe because the token travels in a query string), builds a [PasswordResetEntry](#passwordresetentry) holding the Base64 digest, the user id, a zero attempt count and the absolute expiry as Unix seconds (`:82-86`), caches it under the token key with the configured lifetime (`:88`), and returns the **raw** token to the caller to email (`:90`). The raw token exists only in that return value: it is never written anywhere.
  - `ValidateAndConsumeAsync(string email, string token, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:94`): loads the entry (`:99-100`) and returns `InvalidToken()` when there is none (`:101-104`). A `FormatException` decoding the stored Base64 removes the unreadable record rather than leaving it to expire (`:107-116`). The comparison is `CryptographicOperations.FixedTimeEquals` over the two digests (`:118`), the same timing-side-channel defense [PasswordHasher](#passwordhasher) uses, with `token ?? string.Empty` so a null token hashes rather than throwing. A mismatch records a failed attempt and returns the same generic failure (`:120-121`). On a match it removes **both** the token key and the address's request counter (`:126-127`), so a successful reset does not leave the user throttled out of a later legitimate request (`:124-125`), and returns the entry's `UserId` (`:129`).
  - `RecordFailedAttemptAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:132`): computes `attempts = entry.FailedAttempts + 1` and the remaining lifetime from `ExpiresAtUnixSeconds` (`:137-138`). At `MaxValidationAttempts`, or once the remaining lifetime is non-positive, it deletes the record (`:140-144`). Otherwise it rewrites the entry with `entry with { FailedAttempts = attempts }` and a TTL of the **remaining** seconds, not a fresh lifetime (`:146-152`), because a wrong guess must not be able to extend how long the token stays redeemable.
  - `InvalidToken()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:155-159`) is the single failure factory: unknown, expired, mismatched and attempt-capped all collapse to one `Auth.InvalidResetToken` error with one message. That uniformity is deliberate: distinct errors would make the endpoint an oracle for which addresses have an outstanding reset.
- **Why it's built this way**: [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) records the decision. It extends [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) (the cache-backed protection idiom reused here) and sits beside [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html), which decided how a password is stored but not how a user who has lost one gets a new one. Keeping the token out of the database is what makes the feature additive: no migration, no new table, and nothing to reap.
- **Where it's used**: registered `services.TryAddScoped<IPasswordResetTokenService, PasswordResetTokenService>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:155`), directly after the `PasswordResetSettings` binding (`:137-140`). [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand) calls `IssueAsync` and emails the resulting link (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:73`); [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand) calls `ValidateAndConsumeAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:62-64`) **before** the save, because leaving the token live until the write succeeds would open a replay window, and a token burned by a later invariant failure only costs the user one more reset request (`:58-60`). It is unit-tested by [PasswordResetTokenServiceTests](group-27-testing-infrastructure.md#passwordresettokenservicetests).
- **Caveats / not-in-source**: the per-email request throttle inherits [LoginProtectionService](#loginprotectionservice)'s non-atomic increment, and the source says so where it matters (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:64-65`): concurrent requests can undercount, which loosens the throttle but never tightens it. The failed-attempt rewrite is a read-modify-write too, so a burst of simultaneous wrong guesses can lose increments against the attempt cap; sequential guessing still trips it.

### AuthClaimTypes
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:9` · Level 0 · class (static)

- **What it is**: the three claim-type name constants the framework's own token vocabulary rests on,
  sitting alongside the standard `System.Security.Claims.ClaimTypes` values
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:5-9`).
- **Depends on**: nothing first-party at runtime. Its doc comments point at
  [IPermissionRegistry](#ipermissionregistry) for the role-derived half of the permission model
  (`AuthClaimTypes.cs:14`) and at
  [ClaimsPrincipalExtensions](#claimsprincipalextensions)`.FindUserIdValue` for the reader that
  papers over claim-name mapping (`AuthClaimTypes.cs:24`).
- **Concept introduced, a claim vocabulary owned by the framework rather than by each reader.**
  `[Rubric §11, Security]` assesses how authentication and authorization are modeled and which facts a
  principal is allowed to carry; `[Rubric §16, Maintainability]` assesses single points of change. A
  claim type is just a string, so writer and reader agreeing on it is a convention with no compiler
  behind it. Putting all three names in one `const` holder is what makes the token issuer and every
  reader provably agree.
  - `Permission` (`AuthClaimTypes.cs:17`, value `"permission"`) carries a single granted capability.
    The load-bearing design note is in its doc comment (`AuthClaimTypes.cs:11-16`): permission claims
    are honored **in addition to** the permissions a role confers through
    [IPermissionRegistry](#ipermissionregistry), and baking them into the token is explicitly
    *optional*, because role-derived permissions work without them. A token can therefore stay small
    (roles only) and still authorize against capabilities, which is what makes the model in
    [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) backward
    compatible with plain role checks.
  - `Subject` (`AuthClaimTypes.cs:27`, value `"sub"`) is the single authoritative carrier of the user
    identifier in every token the framework mints. The doc comment states the trap that follows
    (`AuthClaimTypes.cs:19-26`): one value reaches readers under two different claim types, because
    the JWT bearer handler maps inbound `sub` onto `ClaimTypes.NameIdentifier` while a handler that
    materializes an identity straight from a token's claims leaves the raw `sub` in place.
  - `SessionId` (`AuthClaimTypes.cs:40`, value `"sid"`) is the RFC 7519 / OpenID Connect session id:
    the identifier of the refresh session the access token was minted for, which is to say the
    *device* behind the token (`AuthClaimTypes.cs:29-33`). It is **additive, never required**
    (`AuthClaimTypes.cs:34-38`): rotation mints a new session and therefore a new `sid`, a token
    issued before the claim shipped simply carries none, and nothing validates it. A missing or
    unparsable value degrades to "no current session known", never to a rejected token.
- **Walkthrough**: three `public const string` fields and nothing else. `const` rather than
  `static readonly` so the values are usable in attribute arguments and in patterns that require
  compile-time constants, the same reason [RoleNames](#rolenames) uses `const`.
- **Why it's built this way**:
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) makes the
  permission layer opt-in, and
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) adds the
  per-device session identity that `sid` names. Keeping the claim types as shared constants means the
  writer and the reader cannot drift apart on a string.
- **Where it's used**:
  - `Permission` is read by [PermissionAuthorizationHandler](#permissionauthorizationhandler), which
    checks `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` before falling
    back to the registry
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:30-31`),
    and is described (without being named) in the
    [HasPermissionAttribute](#haspermissionattribute) doc comment as the "explicit permission claim"
    alternative to the role-derived path
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/HasPermissionAttribute.cs:5-11`).
  - `Subject` is written by [TokenService](#tokenservice) as `JwtRegisteredClaimNames.Sub`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:93`, with the
    one-carrier rationale at `:88-91`) and read through
    [ClaimsPrincipalExtensions](#claimsprincipalextensions) by
    [CurrentUserService](#currentuserservice), [ClaimBasedUserIdProvider](#claimbaseduseridprovider),
    the [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), and the rate-limit
    partitioner.
  - `SessionId` is stamped by the private
    [SessionStampingTokenService](#sessionstampingtokenservice) decorator inside
    [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:800`) and read
    back by `FindSessionId` for the "my sessions" endpoint
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:187`).
- **Caveats / not-in-source**: no shipped token issuer in this repo writes a `Permission` claim.
  Across both applications and the framework there are exactly four references to that constant (its
  declaration, the handler's doc comment at `PermissionAuthorizationHandler.cs:10`, the handler's check
  at `:29`, and one test), and the only writer in the tree is a test that hands the claim to a
  principal directly
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Authorization/PermissionAuthorizationHandlerTests.cs:31`).
  The claim path is real and covered, but every deployed grant today flows through roles.

### ChangePasswordRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePasswordRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: `(string CurrentPassword, string NewPassword)`, the payload for an authenticated
  password change (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePasswordRequest.cs:3-10`).
- **Depends on**: nothing first-party.
- **Concept**: the same `readonly record struct` DTO shape introduced by
  [AuthenticationResponse](#authenticationresponse). `[Rubric §11, Security]`: requiring the current
  password re-proves the caller's identity before a credential change, so a stolen session alone
  cannot lock the owner out. The strength rules for `NewPassword` are deliberately *not* here; they
  live in each app's validator (see
  [ChangePasswordRequestValidator](group-24-identity-module.md#changepasswordrequestvalidator)),
  which is what lets Store and ADC differ on policy while sharing the contract.
- **Walkthrough**: two positional parameters (`ChangePasswordRequest.cs:8-10`); no body.
- **Where it's used**: bound as the body of the shared `PUT password` endpoint on
  [UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:87,93`),
  reached only through the `IUserScopedCommand<ChangePasswordRequest>` constraint on the app's command
  (`UserAccountAuthControllerBase.cs:48`); carried by each app's
  [ChangePasswordCommand](group-24-identity-module.md#changepasswordcommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15-16`
  and its Store twin); validated by ADC's
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11`,
  which requires a non-empty `CurrentPassword` (`:15-16`) and includes the shared
  [StrongPasswordRules<T>](group-06-validation.md#strongpasswordrulest) for `NewPassword` (`:18`).
- **Caveats / not-in-source**: nothing in this type prevents the password strings from reaching a log.
  That is an operational convention (PII masking plus the "never log the body" habit), not a
  compile-time or runtime guarantee.

### ChangePreferencesRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePreferencesRequest.cs:10` · Level 0 · record (sealed)

- **What it is**: `(string? Culture, string? Theme)`, the payload for updating the signed-in user's
  stored UI preferences
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePreferencesRequest.cs:3-10`).
- **Depends on**: nothing first-party. It is the write-side counterpart of
  [UserPreferencesResponse](#userpreferencesresponse).
- **Concept introduced, null-means-unchanged partial update.** `[Rubric §9, API & Contract Design]`
  assesses how a contract expresses partial intent, and `[Rubric §19, State Management]` assesses
  where user state lives and who may overwrite it. A naive "PUT the whole preferences object" endpoint
  has a real bug hiding in it: the app-bar language switcher knows only the culture and the theme
  toggle knows only the theme, so whichever fires last would send `null` for the other field and
  silently erase the user's other choice. The doc comment states the rule that removes the bug
  (`ChangePreferencesRequest.cs:3-7`): a `null` field leaves that preference unchanged, so each
  control can persist its own field in isolation. The rule is honored in exactly one place, the
  shared handler's `command.Request.Culture ?? user.PreferredCulture` /
  `command.Request.Theme ?? user.PreferredTheme` coalesce
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:54-55`),
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
  (`ChangePreferencesHandlerBase.cs:18`), and it is a good illustration of the framework's hoisting
  rule: share the shape, leave the per-app policy behind.
- **Where it's used**: the body of the shared `PUT preferences` endpoint
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:113,119`),
  which hands it to the app's command through the abstract `CreateChangePreferencesCommand` factory
  (`UserAccountAuthControllerBase.cs:78-80,127`); the generic constraint that ties the two together is
  `where TChangePreferencesCommand : IUserScopedCommand<ChangePreferencesRequest>`
  (`UserAccountAuthControllerBase.cs:49`). It is consumed by
  [ChangePreferencesHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand)
  and carried by each app's
  [ChangePreferencesCommand](group-24-identity-module.md#changepreferencescommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14-15`).
- **Caveats / not-in-source**: this type validates nothing. Rejecting an unknown culture such as
  `"xx"` or an unknown theme such as `"blue"` is the domain's job, inside `UpdatePreferences` on the
  `User` aggregate behind [IUserPreferences](#iuserpreferences), which returns a
  [Result](group-01-result-error-handling.md#result) the handler propagates. Note also that the
  Blazor UI does **not** send this exact type:
  [ApiUserPreferenceWriter](group-15-common-ui-framework.md#apiuserpreferencewriter) declares its own
  private `UserPreferencesRequest(string? Culture, string? Theme)` wire record
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/ApiUserPreferenceWriter.cs:29,65`), so
  the two shapes agree by convention rather than by a shared reference.

### ForgotPasswordRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ForgotPasswordRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Email)` that starts a password reset
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ForgotPasswordRequest.cs:3-9`).
- **Depends on**: nothing first-party. It pairs with
  [ResetPasswordRequest](#resetpasswordrequest), which completes the flow this one starts.
- **Concept introduced, the anti-enumeration contract.** `[Rubric §11, Security]` assesses whether an
  endpoint leaks facts an attacker can harvest, and `[Rubric §9, API & Contract Design]` assesses
  whether a contract's shape matches the answer it is allowed to give. A password-reset entry point is
  the classic account-enumeration oracle: if "no such user" answers differently from "email sent", an
  attacker can test an address list against your user base for free. The doc comment on this one-field
  record records the countermeasure as part of the contract (`ForgotPasswordRequest.cs:3-6`): the
  response is *always* accepted, so the payload carries no signal about whether the address belongs to
  an account. The rule is not aspirational, it is implemented in three coordinated places:
  - the request validator checks only the **shape** of the address, and its doc comment says exactly
    why it stops there, because a 400 on an unknown address would be the oracle the always-accepted
    response exists to close
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:6-9,13-16`);
  - the handler returns `Result.Success()` for a malformed address, an address with no account, a
    throttled request, and a failed send alike, logging the real reason instead of returning it
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:62,70,77,96,100`);
  - the endpoint answers `202 Accepted` on every well-formed request
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:79,92`).
- **Walkthrough**: one positional `string Email` (`ForgotPasswordRequest.cs:8-9`); no body, no
  validation attributes, no normalization. Normalizing the address is the handler's job, through
  `Email.Create(command.Request.Email)` (`ForgotPasswordHandlerBase.cs:58`), which is what lets the
  DTO stay a raw wire shape while the [Email](group-02-domain-building-blocks.md#email) value object
  owns the parsing rules.
- **Why it's built this way**:
  [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) records the
  cache-backed reset design this request opens. Keeping the payload to a single field means there is
  nothing else for an attacker to probe, and keeping the "always accepted" promise in the *type's* doc
  comment puts it where a reader meets it before the handler.
- **Where it's used**: bound as the body of the anonymous, rate-limited `POST forgot-password` action
  on
  [PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:75,83`),
  which turns it into the app's command through an abstract factory (`:61`) constrained to
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (`:46`); shape-validated by
  [ForgotPasswordRequestValidator](#forgotpasswordrequestvalidator); handled by
  [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand);
  posted by [AuthUIService](group-15-common-ui-framework.md#authuiservice)'s
  `RequestPasswordResetAsync`, deliberately over a bearer-free client so a signed-in caller does not
  bind the reset to the current session
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:194,202`).
- **Caveats / not-in-source**: both applications now wire this vertical. ADC has a
  [ForgotPasswordCommand](group-24-identity-module.md#forgotpasswordcommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:12-13`)
  and a derived controller
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/PasswordResetController.cs:36`);
  Store has the same pair
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:11`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/PasswordResetController.cs:33`).

### IPermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:13` · Level 0 · interface

- **What it is**: the abstraction that maps roles to the fine-grained permissions they grant, and the
  single place that knows which roles confer which capabilities
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:3-13`).
- **Depends on**: nothing first-party; its remarks reference [RoleNames](#rolenames) for the
  case-insensitivity rule.
- **Concept introduced, permission (capability) authorization over role checks.** `[Rubric §11,
  Security]` assesses the authorization model, and `[Rubric §1, SOLID]` assesses dependency inversion:
  endpoints depend on an abstraction, not on a role name. Instead of scattering
  `[Authorize(Roles = "Organizer")]` across endpoints, code authorizes against a *permission* (a
  capability such as `sessions:manage`) and this registry translates a principal's roles into the
  permissions they hold. The payoff is decoupling: adding a role or reshaping who-can-do-what is a
  registry change, not an edit to every endpoint (`IPermissionRegistry.cs:4-7`). The remarks also fix
  the comparison rules (`IPermissionRegistry.cs:9-12`): role lookups are case-insensitive, permission
  values are compared ordinally, and implementations are expected to be immutable and thread-safe.
  Those three sentences are what let the implementation be a frozen, lock-free structure.
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
- **Where it's used**: implemented by [PermissionRegistry](#permissionregistry) (built via
  [PermissionRegistryBuilder](#permissionregistrybuilder)); registered as a lazily-built singleton by
  [AuthorizationExtensions](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:71`) and
  injected into [PermissionAuthorizationHandler](#permissionauthorizationhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14`).

### LoginRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/LoginRequest.cs:8` · Level 0 · record struct (readonly)

- **What it is**: the email/password payload for authentication: `(string Email, string Password)`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/LoginRequest.cs:3-10`).
- **Depends on**: nothing first-party.
- **Concept**: the `readonly record struct` DTO introduced by
  [AuthenticationResponse](#authenticationresponse). `[Rubric §11, Security]`: the doc comment
  (`LoginRequest.cs:7`) records the rule that the password travels over TLS and is never logged. That
  convention is enforced operationally, not by this type, but the intent is documented at the source
  where a reader will meet it.
- **Walkthrough**: two positional parameters (`LoginRequest.cs:8-10`); no body.
- **Where it's used**: shape-validated by [LoginRequestValidator](#loginrequestvalidator), which is
  deliberately minimal (non-empty plus address shape) so that no field-level 400 hints at which half
  of the credential was wrong
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:6-10,15-20`);
  then handled by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)`.LoginAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:121-122`), which
  is reached through [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase)'s
  `POST login`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:69,76-77`).

### OAuthCodeExchangeRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/OAuthCodeExchangeRequest.cs:11` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Code)` that exchanges a short-lived, single-use
  OAuth completion code for the token pair
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/OAuthCodeExchangeRequest.cs:3-12`).
- **Depends on**: nothing first-party.
- **Concept reinforced, security by construction.** `[Rubric §11, Security]` and `[Rubric §26,
  Front-End Security]` both assess safe token handling, in particular whether credentials can leak
  into places that are logged or replayed. The doc comment (`OAuthCodeExchangeRequest.cs:3-9`)
  explains *why* the indirection exists: the server mints an opaque code after the external-provider
  callback succeeds and carries *that* in the redirect URL, so the access and refresh tokens never
  appear in the address bar, browser history, the `Referer` header, or server access logs. The mint
  side is right there in the controller, with the same reasoning as a comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:127-134`).
  [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) records the decision,
  and
  [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)
  extends the pattern to the native mobile callback.
- **Walkthrough**: one positional `string Code` (`OAuthCodeExchangeRequest.cs:11-12`).
- **Why it's built this way**: the code is worthless once redeemed, which is the property that makes
  putting it in a URL acceptable.
  [OAuthControllerBase](group-12-api-hosting-mapping.md#oauthcontrollerbase)`.ExchangeAsync` rejects a
  blank code (`OAuthControllerBase.cs:157-160`), looks the code up in
  [ICacheService](group-09-caching.md#icacheservice) (`OAuthControllerBase.cs:162-170`), and then
  removes it so a replayed code cannot mint a second token pair (`OAuthControllerBase.cs:172-173`); an
  unknown, burned, or expired code all return the same HTTP 400 with a deliberately non-specific
  message (`OAuthControllerBase.cs:178-181`). The action is also marked `[NonIdempotent]` with the
  reason inline: replaying a stored response would defeat the burn and let a leaked code mint the same
  tokens again (`OAuthControllerBase.cs:150`).
- **Where it's used**: the body of the OAuth `exchange` endpoint
  (`OAuthControllerBase.cs:149,153-155`), called by the UI's `/auth/oauth-complete` page after the
  provider redirect lands (`OAuthControllerBase.cs:137-140,143-144`).

### RefreshTokenRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/RefreshTokenRequest.cs:9` · Level 0 · record struct (readonly)

- **What it is**: `(string AccessToken, string RefreshToken)`; it sends the *expired* access token
  alongside the refresh token so the server can read its claims without forcing a full
  re-authentication (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/RefreshTokenRequest.cs:3-11`).
- **Depends on**: nothing first-party.
- **Concept**: the `readonly record struct` DTO shape from
  [AuthenticationResponse](#authenticationresponse). `[Rubric §11, Security]`: this is the request
  half of [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)'s
  rotation scheme. Carrying the expired token lets the server reconstruct the principal cheaply, while
  the opaque refresh token is what actually gates the rotation, so possession of an expired access
  token alone buys nothing.
- **Walkthrough**: two positional parameters (`RefreshTokenRequest.cs:9-11`); no body. Both are
  required to be non-empty, and the validator's doc comment says why each is needed: the access token
  for claim extraction, the refresh token for rotation verification
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:6-9,14-18`).
- **Where it's used**: shape-validated by
  [RefreshTokenRequestValidator](#refreshtokenrequestvalidator), handled by
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)`.RefreshTokenAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:267-268`), which
  rejects an unreadable token or a principal with no usable user id with an `Auth.InvalidToken`
  failure before it ever looks at the refresh token (`AuthenticationServiceBase.cs:284-285,291-295`);
  exposed by [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase)'s
  `POST refresh`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:117,122-123`).

### ResetPasswordRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ResetPasswordRequest.cs:9` · Level 0 · record struct (readonly)

- **What it is**: `(string Email, string Token, string NewPassword)`, the payload that completes a
  password reset by redeeming the single-use token that
  [ForgotPasswordRequest](#forgotpasswordrequest) caused to be mailed
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ResetPasswordRequest.cs:3-12`).
- **Depends on**: nothing first-party; the `readonly record struct` shape from
  [AuthenticationResponse](#authenticationresponse).
- **Concept, the three-field redemption payload and the single collapsed failure.** `[Rubric §11,
  Security]`: the address is carried alongside the token so the server can verify that the token was
  issued *for that address* rather than trusting the token in isolation, which is what the handler's
  `ValidateAndConsumeAsync(request.Email, request.Token, ...)` call checks
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:62-64`).
  The anti-enumeration discipline that governs the forgot half continues here in a different form:
  an unknown, expired, mismatched or attempt-capped token and a vanished account all collapse to one
  `Auth.InvalidResetToken` 401 with the same message, so the response distinguishes none of them
  (`ResetPasswordHandlerBase.cs:18-23,65-69,74-78,96-100`). One ordering decision is worth
  internalizing: the token is consumed *before* the save, and the comment says why
  (`ResetPasswordHandlerBase.cs:59-61`), because leaving it live until the write succeeds would open a
  replay window in which the same token is redeemed twice; a token burned by a later invariant failure
  costs the user one more reset request, which is the cheaper failure.
- **Walkthrough**: three positional parameters (`ResetPasswordRequest.cs:9-12`); no body. The doc
  comment repeats the never-logged rule for `NewPassword` (`ResetPasswordRequest.cs:8`), the same
  convention [LoginRequest](#loginrequest) states.
- **Why it's built this way**: the new password goes through the *same*
  [StrongPasswordRules<T>](group-06-validation.md#strongpasswordrulest) that registration and
  change-password use, so a reset cannot become a way around the complexity policy
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:7-11,16-23`).
  Reusing one rule set rather than restating it per endpoint is the reason the policy cannot drift.
  [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) covers the
  token side.
- **Where it's used**: bound as the body of the anonymous, rate-limited `POST reset-password` action
  on
  [PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand),
  which answers 204 on success
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:99,103,108,117`);
  shape-validated by [ResetPasswordRequestValidator](#resetpasswordrequestvalidator); handled by
  [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand),
  which hashes the new password, lets the aggregate apply its own invariants, saves, and then clears
  the account's failed-attempt count so a user who reset *because* of a lockout is not still locked
  out (`ResetPasswordHandlerBase.cs:80-81,87,89-90`); posted by
  [AuthUIService](group-15-common-ui-framework.md#authuiservice)'s `ResetPasswordAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:211,221`). ADC
  carries it in a [ResetPasswordCommand](group-24-identity-module.md#resetpasswordcommand) marked
  `ICacheInvalidating`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:15-16`);
  Store carries its own, without that marker
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:12`).

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
  [ICurrentUserService](#icurrentuserservice)`.IsInRole`), which is the same equality contract
  [RoleValue](#rolevalue) and [PermissionRegistry](#permissionregistry) implement.
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
  attribute and option initializers that require compile-time constants. Keeping both apps' roles in
  one shared file is a deliberate trade: a small amount of irrelevance for each consumer in exchange
  for one authoritative list.
- **Where it's used**: the per-app role types
  ([UserRole](group-24-identity-module.md#userrole);
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:20,23,30` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserRole.cs:17,20`), each
  module's permission grants
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41-50`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:58-61`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44-47`), and the
  ownership-filter bypass role in ADC's Engagement module
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:54`).
- **Caveats / not-in-source**: [AuthorizationExtensions](#authorizationextensions) registers no named
  role policies today: `AddAuthorizationPolicies` wires only ASP.NET Core's authorization services and
  the permission mechanism
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:23-38`,
  with the "permissions are the one authorization model" statement at `:17-20`). Role names therefore
  reach authorization only through the registry, not through a pre-registered policy per role.

### AuthenticationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared` · `MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15` · Level 0 · record struct

- **What it is**: a device-aware authentication request shape for mobile/MAUI clients. It carries device metadata (id, form factor, platform, model, manufacturer, name, type) alongside the user's email so that sessions and tokens can be tracked per device (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-5`).
- **Depends on**: nothing first-party. Eight positional `string` parameters and the BCL only.
- **Concept**: an immutable `readonly record struct` request DTO. The `readonly record struct` gives value-based equality and a compact, copy-by-value payload for something that crosses the wire once per login, and the eight positional parameters (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`) show the same request shape scaling from bare credentials to a credential-plus-context payload. `[Rubric §11, Security]` assesses credential handling and session management: capturing device identity at authentication time is the precondition for per-device session tracking, which is what the XML doc states the type exists for (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:4-5`).
- **Walkthrough**: the whole type is one positional constructor with eight `string` members (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`): `DeviceId`, `Email`, `DeviceFormFactor`, `DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceName`, `DeviceType`. Note that `Email` is the plain `string` here and not the [Email](group-02-domain-building-blocks.md#email) value object: this is a transport shape, and normalization happens further in. It is also the only type in the root `MMCA.Common.Shared` namespace; the rest of the auth request family lives under `MMCA.Common.Shared.Auth`.
- **Why it's built this way**: a struct record keeps a small, short-lived login payload allocation-free while still giving structural equality and a `with`-expression copy for free; every member being `string` keeps it trivially serializable by any client transport.
- **Caveats / not-in-source**: this type has **no first-party consumer in the workspace source today**. A search across all four .NET repos finds `AuthenticationRequest` only in its own declaration file, so the device fields are a published contract awaiting a caller rather than an active login path. The per-device story that did ship is [RefreshSession](#refreshsession), which captures IP and user-agent rather than these eight fields; treat the device-metadata contract as documented intent (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-5`), not as shipped behavior.

### ClaimsPrincipalExtensions
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:18` · Level 1 · class (static)

- **What it is**: the one place the framework reads identity claims off a `ClaimsPrincipal`: the raw
  user-id value, the parsed user id, and the refresh-session id
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:6-18`).
- **Depends on**: [AuthClaimTypes](#authclaimtypes) for the two claim names it reads
  (`ClaimsPrincipalExtensions.cs:27,58`); the solution-wide `UserIdentifierType` alias; BCL
  `System.Security.Claims` and `System.Globalization` (`ClaimsPrincipalExtensions.cs:1-2`).
- **Concept introduced, one reader for a claim that arrives under two names.** `[Rubric §11,
  Security]` assesses whether identity resolution is correct and uniform, and `[Rubric §16,
  Maintainability]` assesses whether a fragile detail is centralized or copy-pasted. The trap is
  ASP.NET Core's inbound claim mapping. Tokens carry the user identifier in the standard `sub` claim
  only, but that single value reaches readers under two different claim types depending on which
  pipeline produced the principal (`ClaimsPrincipalExtensions.cs:8-16`):
  - the JWT bearer handler maps inbound `sub` onto `ClaimTypes.NameIdentifier`, the long
    `http://schemas.xmlsoap.org/...` URI;
  - a handler that materializes an identity straight from a token's claims leaves the raw `sub` in
    place. [SessionCookieAuthenticationHandler](#sessioncookieauthenticationhandler) is exactly that
    case: it builds `new ClaimsIdentity(jwt.Claims, ...)` from the decoded token
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:60-61`).

  A reader that hard-codes either name works under one pipeline and silently returns "anonymous" under
  the other, and "silently anonymous" in an authorization path is the worst failure shape available.
  Routing every framework reader through `FindUserIdValue` makes both shapes resolve identically, and
  means a consumer that changes its claim mapping does not lose the current user
  (`ClaimsPrincipalExtensions.cs:13-15`). Note the deliberate use of C#'s classic `this`-parameter
  extension methods here rather than the `extension(T)` blocks the codebase uses for DI registration:
  these are plain static helpers on a BCL type.
- **Walkthrough**: three extension methods, all null-tolerant by construction (every parameter is
  `ClaimsPrincipal?`, so a null principal yields null rather than throwing).
  - `FindUserIdValue(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:26-28`) is the primitive:
    `principal?.FindFirst(AuthClaimTypes.Subject)?.Value ?? principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value`.
    Raw `sub` wins, the mapped `NameIdentifier` is the fallback, and a principal carrying neither
    yields `null`.
  - `GetUserId(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:40-44`) parses that value into
    the module's `UserIdentifierType` and returns `null` when the claim is absent or unparsable. It
    parses through `IParsable<TSelf>.TryParse` in `CultureInfo.InvariantCulture`, which the remarks
    justify twice over (`:34-38`): it matches the writer (claims are formatted invariantly) and it
    stays correct if the solution-wide identifier alias changes shape, so the helper does not have to
    be rewritten when an app moves from `int` to `Guid`.
  - `FindSessionId(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:56-60`) reads the `sid`
    claim and `Guid.TryParse`s it. The remarks make the degradation explicit (`:50-54`): `null` is an
    ordinary answer, not an error, because tokens issued before `sid` shipped carry no such claim, and
    every reader treats its absence as "the caller's own session is unknown". Nothing authenticates on
    this value.
- **Why it's built this way**: [TokenService](#tokenservice) records the other half of the story in a
  comment (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:87-90`): a
  duplicate custom user-id claim used to ride alongside `sub`, which meant two values that could
  disagree and two claim names every reader had to know. Collapsing the writer to one claim
  (`TokenService.cs:93`) is only safe because one reader absorbs the mapping difference, which is this
  type. The `sid` half comes from
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html).
- **Where it's used**: broadly, and always instead of a hand-rolled claim lookup.
  [CurrentUserService](#currentuserservice) resolves the ambient user id through `GetUserId()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:13,20`);
  [ClaimBasedUserIdProvider](#claimbaseduseridprovider) uses `FindUserIdValue()` to key SignalR
  connections
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:15`); the
  [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter) uses it to scope an
  idempotency key to a caller
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:487`);
  [CurrentUserTargetingContextAccessor](group-12-api-hosting-mapping.md#currentusertargetingcontextaccessor)
  uses it for feature-flag targeting
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:17,86`);
  rate-limit partitioning uses it to build a per-user partition
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:93`);
  [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase) uses `FindSessionId()` to
  tell the session list which row is the caller's own
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:187`);
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) uses `GetUserId()` on the
  principal recovered from an expired access token during rotation
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:288-291`); and
  [TestPrincipal](group-27-testing-infrastructure.md#testprincipal) writes `sub` precisely so test
  principals resolve the same way real ones do
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:19,27`).
- **Caveats / not-in-source**: MMCA.Store's Sales UI module defines its own unrelated
  `ClaimsPrincipalExtensions` in a different namespace
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Extensions/ClaimsPrincipalExtensions.cs:9`);
  do not confuse the two when reading a `using` list. Also note `GetUserId` returns a nullable value
  type, so `is { } userId` pattern-matching (as ADC's Blazor pages use) is the idiomatic call shape,
  not a `!` dereference.

### PermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:10` · Level 1 · class (sealed)

- **What it is**: the immutable, thread-safe implementation of
  [IPermissionRegistry](#ipermissionregistry), backed by a frozen role-to-permissions map
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:5-10`).
- **Depends on**: [IPermissionRegistry](#ipermissionregistry); `System.Collections.Frozen`
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
- **Where it's used**: constructed by [PermissionRegistryBuilder](#permissionregistrybuilder)`.Build`
  and registered as the [IPermissionRegistry](#ipermissionregistry) singleton in
  [AuthorizationExtensions](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:69-71`);
  read by [PermissionAuthorizationHandler](#permissionauthorizationhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14,31`).

### PermissionRegistryBuilder
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:8` · Level 2 · class (sealed)

- **What it is**: a mutable accumulator that collects role-to-permission grants and freezes them into
  an immutable [PermissionRegistry](#permissionregistry)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:3-8`).
- **Depends on**: [PermissionRegistry](#permissionregistry), its build target.
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
  and hands it to the [PermissionRegistry](#permissionregistry) constructor
  (`PermissionRegistryBuilder.cs:48-53`).
- **Why it's built this way**: mutable while assembling, immutable once built is the safe way to let
  independent modules compose one shared authorization table at startup without any shared mutable
  state at runtime.
- **Where it's used**: [AuthorizationExtensions](#authorizationextensions) registers exactly one
  builder instance and a lazily-built singleton registry over it, so the registry is materialized on
  first resolve, after every module has contributed
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:58-74`);
  modules reach it through `AddPermissions(...)`, which is deliberately safe to call once per module
  (`AuthorizationExtensions.cs:40-55`), as MMCA.ADC's Conference, Engagement, and Identity modules
  each do
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41-50`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:58-61`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44-47`).
- **Caveats / not-in-source**: the lazy build means a `Grant` call made after the first
  [IPermissionRegistry](#ipermissionregistry) resolve would silently not take effect; the API doc says
  to call before the host is built (`AuthorizationExtensions.cs:43`), but nothing enforces it at
  runtime.

### RoleValue

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25` · Level 3 · class (abstract)

- **What it is**: the abstract base for a role value object. It stores one canonical string, gives it
  case-insensitive value equality and hashing, and offers a shared validation helper against a
  per-app set of known role names
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:6-25`).
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`
  (`RoleValue.cs:2`), plus `System.Collections.Frozen` from the BCL (`RoleValue.cs:1`). Its doc
  comments point at [`RoleNames`](#rolenames) for the canonical strings (`RoleValue.cs:9`) and at
  `ICurrentUserService.IsInRole` for the comparison semantics it matches (`RoleValue.cs:16`).
  Conceptually a value object (see [`ValueObject`](group-02-domain-building-blocks.md#valueobject))
  but deliberately not derived from that base, for a reason the next bullet unpacks.
- **Concept introduced, a value object as an abstract class with type-guarded equality.**
  `[Rubric §4, Domain-Driven Design]` assesses whether identity-less concepts are modeled as value
  objects rather than bare primitives, and `[Rubric §1, SOLID]` applies to how an open hierarchy is
  left safe to extend. A role has no database identity: two "Organizer" values are the same role, so
  the type is defined by its value, which is exactly the value-object shape. Two design decisions
  make this base unusual, and both are written into the source:
  1. **No `IEquatable<T>` on the base** (`RoleValue.cs:17-23`). The remarks cite Sonar S4035: an
     unsealed type implementing `IEquatable<T>` breaks the equality contract, because a subclass
     instance compared through the base-typed interface can report an equality the derived type
     would reject. Instead equality is the plain `object.Equals` override, and it is type-guarded:
     `GetType() == other.GetType()` before the value comparison (`RoleValue.cs:90-93`), so a role of
     one concrete type is never equal to a same-valued role of another. A *sealed* derived type is
     then free to layer a strongly-typed `IEquatable<TSelf>` plus `==`/`!=` on top, which is what
     ADC's `UserRole` does
     (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17,77-83`).
  2. **It does not derive from [`ValueObject`](group-02-domain-building-blocks.md#valueobject)**, and
     that is a fitness-rule consequence, not an oversight. `ValueObjectsAreImmutableSealedInShared`
     requires every concrete class whose base type starts with
     `MMCA.Common.Shared.ValueObjects.ValueObject` to be sealed, immutable, *and* to live in the
     Shared layer
     (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Immutability.cs:56-72`).
     A concrete role type lives in its app's Domain layer
     (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:5`), so deriving
     from `ValueObject` would fail that rule in every app. Keeping the base in `MMCA.Common.Shared`
     with its own equality also keeps it dependency-free and therefore usable from Blazor WebAssembly
     and UI code as well as Domain (`RoleValue.cs:11-16`). The same trade-off is made by
     [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration), whose
     own remarks name `RoleValue` as the shipped precedent
     (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:25-29`).

  `[Rubric §11, Security]` applies too, because role strings arrive as JWT claim values whose casing
  is not under this codebase's control. Every comparison here is `OrdinalIgnoreCase`, so an
  authorization check does not silently miss on `"organizer"` against `"Organizer"`.
- **Walkthrough**: a get-only `Value` (`RoleValue.cs:28`) assigned by the protected constructor
  (`RoleValue.cs:32`), so an instance is immutable and only a derived type can create one. The static
  `Validate(role, knownRoles, source)` (`RoleValue.cs:42`) null-guards the supplied set
  (`RoleValue.cs:44`), then returns `Result.Success()` when the role is known, otherwise a
  [`Result`](group-01-result-error-handling.md#result) failure carrying an
  [`Error`](group-01-result-error-handling.md#error) of kind `Invariant`, coded `User.Role.Invalid`,
  with the caller's method name as `source` and `role` as `target` (`RoleValue.cs:46-52`). The
  membership test is the private `IsKnown` (`RoleValue.cs:63-65`) and it is more careful than it
  first looks: the fast path is the supplied set's own `Contains` (correct and O(1) for the intended
  `OrdinalIgnoreCase` sets, with a `role ?? string.Empty` coalesce so a null role becomes a clean
  failure rather than a `NullReferenceException`), and a miss falls back to an explicit
  case-insensitive `Any` scan, so a set built with the *default* ordinal comparer still validates
  case-insensitively as the contract promises (`RoleValue.cs:55-62`). Role sets hold a handful of
  entries, so the fallback is negligible and only ever runs on a miss. The protected generic
  `BuildLookup<TRole>(params TRole[] roles)` (`RoleValue.cs:75`) freezes the supplied singletons into
  a case-insensitive `FrozenDictionary` keyed by `Value` (`RoleValue.cs:80-83`), so a derived type
  can back its `FromString`/`IsValid` members with interned instances instead of re-allocating on
  every parse. `ToString` returns the value (`RoleValue.cs:87`), and `GetHashCode` uses the
  ordinal-ignore-case hash (`RoleValue.cs:96`) so it stays consistent with `Equals`, which is the
  contract any dictionary or `HashSet` key depends on.
- **Why it's built this way**: the abstract-class-plus-type-guard shape is how you share equality
  behavior across an open hierarchy of value objects without violating the equality contract, and the
  S4035 rationale is documented inline (`RoleValue.cs:17-23`) so a future reader does not
  "helpfully" add `IEquatable<T>` to the base. The comparer-agnostic `IsKnown` fallback exists
  because `Validate` accepts any `IReadOnlySet<string>`: the type cannot see how the caller built the
  set, so it enforces its own promise instead of trusting the caller's comparer. That behavior is
  pinned by test, including the default-comparer case
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Auth/RoleValueTests.cs:18`), the
  `OrdinalIgnoreCase` case (`RoleValueTests.cs:30`), a null role (`RoleValueTests.cs:59`), and a null
  role set throwing (`RoleValueTests.cs:67`).
- **Where it's used**: the two apps consume it differently, and the difference is instructive.
  ADC derives a full sealed value object, [`UserRole`](group-24-identity-module.md#userrole), which
  fixes three roles (Organizer, Attendee, ContentEditor), interns them through `BuildLookup`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:20-33`), exposes
  `FromString` returning a `Result<UserRole>` and `IsValid` over that frozen lookup
  (`UserRole.cs:51-65`), and adds a case-insensitive `IsOrganizer` for raw claim strings
  (`UserRole.cs:75`) plus the sealed-type `IEquatable<UserRole>` and `==`/`!=` operators the base
  leaves to subclasses (`UserRole.cs:77-89`). Store's `UserRole` is a **static class**, not a
  subclass: it fixes Admin and Customer as string properties over an `OrdinalIgnoreCase` set and
  calls the shared `RoleValue.Validate` helper for its `IsValid`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserRole.cs:14,26-30,37`), so
  it inherits the rule set (case-insensitive membership, the `User.Role.Invalid` code) without
  inheriting the type. Both key their known-role sets off the [`RoleNames`](#rolenames) constants,
  and [`PermissionRegistryBuilder`](#permissionregistrybuilder) keeps its role keys on the same
  case-insensitive comparer to match
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:11`).

### RegisterRequest

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/RegisterRequest.cs:13` · Level 4 · record struct (readonly)

- **What it is**: the registration payload for a new account: email, password, first and last name,
  and an optional postal address
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/RegisterRequest.cs:5-18`).
- **Depends on**: [`Address`](group-02-domain-building-blocks.md#address) from
  `MMCA.Common.Shared.ValueObjects` (`RegisterRequest.cs:1`), which is the only reason this
  otherwise Level 0-shaped DTO sits at Level 4.
- **Concept**: the `readonly record struct` request shape introduced by
  [`LoginRequest`](#loginrequest); see that section for the value semantics. `[Rubric §9, API &
  Contract Design]` assesses whether the wire contract is explicit and evolvable. The optional
  `Address? Address = null` parameter (`RegisterRequest.cs:18`) is the notable detail here:
  positional record structs support default parameter values, so a caller with no address simply
  omits it rather than needing a second overload or a null literal at the call site. That default is
  what lets one shared contract serve two apps with different profile shapes (see **Where it's
  used**).
- **Walkthrough**: five positional parameters and no body (`RegisterRequest.cs:13-18`): four strings
  plus the nullable [`Address`](group-02-domain-building-blocks.md#address). The strings arrive raw,
  with no validation attributes and no normalization. Shape checking is the validator's job and
  semantic conversion is the domain factory's, which is the codebase's standing division of labor:
  ADC's [`RegisterRequestValidator`](group-24-identity-module.md#registerrequestvalidator) composes
  reusable rule sets over the four strings and applies `AddressValidator` only `When` the address is
  non-null
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:16-23`),
  while [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) hands the whole request
  to an abstract `CreateUser(RegisterRequest request, byte[] passwordHash, byte[] passwordSalt)` that
  each app implements against its own `User` aggregate
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:514`). Note
  that `Password` is a plain `string` on the contract and never travels past the hashing call:
  `RegisterAsync` turns it into a hash and salt pair, and that pair, not the password, is what
  reaches `CreateUser` and the aggregate (`AuthenticationServiceBase.cs:213-214`).
  `[Rubric §11, Security]`.
- **Where it's used**:
  [`AuthenticationServiceBase<TUser>.RegisterAsync`](#authenticationservicebasetuser)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:187-188`), the
  `register` endpoint on [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase),
  which binds it `[FromBody]` on an anonymous, rate-limited, idempotent POST
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:93-102`), and
  each app's register form. The two apps' `CreateUser` overrides show why the address is optional:
  Store passes `request.Address` straight into `User.Create`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:52-60`),
  while ADC ignores it entirely and creates the user from email, names, hash, salt, and the default
  `UserRole.Attendee`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:109-116`).

### AuthenticationResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/AuthenticationResponse.cs:10` · Level 0 · record struct (readonly)

- **What it is**: the success payload of authentication, carrying `AccessToken`, `RefreshToken`, and
  `AccessTokenExpiry`, shared by the Identity API and the UI clients
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/AuthenticationResponse.cs:3-13`).
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
  [OAuthControllerBase](group-12-api-hosting-mapping.md#oauthcontrollerbase) therefore detects a
  missing exchange entry by testing `string.IsNullOrEmpty(response.AccessToken)`, with the reason
  written down at the call site
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:164-167`).
- **Where it's used**: produced by
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) from the shared
  `IssueTokensAsync` helper that login and registration both funnel through
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:183,263,474,494`)
  and directly at the end of a rotation (`AuthenticationServiceBase.cs:329`); declared as the 200/201
  response type on the three [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase)
  token endpoints
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:73,97,120`);
  consumed by [AuthUIService](group-15-common-ui-framework.md#authuiservice),
  [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher), and
  [CookieSessionRefresher](#cookiesessionrefresher).

### RefreshSessionSummaryResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:23` · Level 0 · record (sealed)

- **What it is**: one row of a user's "signed-in devices" list, describing a live refresh session in
  the terms a person can recognize it by
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:3-5`).
- **Depends on**: nothing first-party at compile time. It is the sanitized projection of the
  [RefreshSession](#refreshsession) entity, and its `IsCurrent` flag is computed from the `sid` claim
  named by [AuthClaimTypes](#authclaimtypes)`.SessionId`.
- **Concept introduced, the sanitized read model over a credential-bearing entity.** `[Rubric §11,
  Security]` assesses what a response is allowed to expose, and `[Rubric §9, API & Contract Design]`
  assesses whether a contract carries exactly the fields its consumers need. The entity behind this
  row holds the material the refresh-token reuse check runs on: a `TokenHash`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:64`) and the rotation link
  `ReplacedByTokenHash` (`RefreshSession.cs:79`). Both are deliberately **absent** from this response,
  and the doc comment states the reasoning (`RefreshSessionSummaryResponse.cs:6-11`): shipping either
  would hand every caller a queryable index of another session's credentials-at-rest for no gain,
  since nothing a client does with a session needs anything but its id. The rule is enforced by a
  reflection assertion rather than by review habit: a test asserts the type's property names contain
  neither `TokenHash` nor `ReplacedByTokenHash`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/RefreshSessionManagementTests.cs:199-202`).
  This is the read-model half of the "never project a secret" discipline; the same instinct is what
  keeps password hashes out of every user DTO.
- **Walkthrough**: six positional parameters on a `sealed record`
  (`RefreshSessionSummaryResponse.cs:23-29`), documented one by one at `:13-22`.
  - `SessionId` (`Guid`) is the value a per-device sign-out is addressed to (`:13`), which is why it
    is the only identifying field the row needs.
  - `CreatedAt` and `ExpiresAt` (`DateTime`, both UTC) say when this device signed in and when the
    session stops being usable even if never revoked (`:14-15`).
  - `IpAddress` and `UserAgent` are nullable and explicitly labeled **informational** (`:16-17`):
    they are what a human recognizes a device by, and nothing authorizes on them.
  - `IsCurrent` (`bool`) marks the session the calling access token was minted for. The doc comment
    records the degradation rule (`:18-22`): it is always `false` for a caller whose token predates
    the `sid` claim, because nothing then identifies the caller's own device.
- **Why it's built this way**:
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) introduces the
  per-device refresh session, and
  [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) is the rotation
  scheme whose hashes this response must not leak. `IsCurrent` is computed server-side rather than
  guessed by the client, which is what keeps the UI from having to parse a token to know which row is
  its own: the service compares each session id against a `currentSessionId` argument
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:421`), and the
  interface documents that passing `null` simply marks no row as current
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:89-93`).
- **Where it's used**: produced by
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)`.GetSessionsAsync`, which
  reads unrevoked sessions from [IRefreshSessionStore](#irefreshsessionstore), filters to those active
  at the current instant, orders newest-first, and projects each into this record
  (`AuthenticationServiceBase.cs:401-424`); returned by the `GET my-sessions` endpoint on
  [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase), which supplies the
  caller's own session via `User.FindSessionId()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:175-187`);
  fetched client-side by [AuthUIService](group-15-common-ui-framework.md#authuiservice)`.GetSessionsAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:229,236`) and
  rendered by the [Sessions](group-15-common-ui-framework.md#sessions) page, which uses `IsCurrent` to
  disable the revoke action on the caller's own row
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:38,108-110,179`).
- **Caveats / not-in-source**: `IpAddress` and `UserAgent` are whatever the client sent at issue time
  and are stored verbatim; nothing in this type or the projection validates, geolocates, or
  canonicalizes them, so a spoofed user-agent shows up as-is in the device list.

### UserPreferencesResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/UserPreferencesResponse.cs:9` · Level 0 · record (sealed)

- **What it is**: `(string? Culture, string? Theme)`, the read side of the stored UI preferences: what
  the server hands back when a returning user signs in
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/UserPreferencesResponse.cs:3-9`).
- **Depends on**: nothing first-party. It is the exact mirror of
  [ChangePreferencesRequest](#changepreferencesrequest).
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
  (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetPreferences/GetUserPreferencesHandlerTests.cs:47,61`).
- **Why it's built this way**: like its request twin, the response record was byte-identical in both
  applications' Identity modules and was hoisted into Shared, which is what let the read side become a
  shared base generic parameterized only on the `User` aggregate rather than on the query and the
  response too
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21-22`).
- **Where it's used**: produced by
  [GetUserPreferencesHandlerBase<TUser>](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser)
  from the aggregate's `PreferredCulture`/`PreferredTheme` (`GetUserPreferencesHandlerBase.cs:44`),
  against a
  [GetUserPreferencesQuery](group-14-module-system-composition.md#getuserpreferencesquery); declared
  as the 200 response of the shared `GET preferences` endpoint on
  [UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:139,141,143`).
- **Caveats / not-in-source**: the handler reads through `GetReadRepository`, not the write
  repository, and the remarks note this was a deliberate correction of a disagreement between the two
  app copies (ADC read, Store write), so Store gained a no-tracking read on adoption
  (`GetUserPreferencesHandlerBase.cs:16,39`). As with the request twin, the Blazor client does not
  deserialize into this type:
  [ApiUserPreferenceReader](group-15-common-ui-framework.md#apiuserpreferencereader) reads
  `auth/preferences` into its own UI-side `UserPreferences` record and falls back to an empty one for
  anonymous users or any transport error
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Preferences/ApiUserPreferenceReader.cs:18,39-40,44-48`).

### ConcurrencyETag

> MMCA.Common.Shared · `MMCA.Common.Shared.Http` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:24` · Level 0 · class (static)

- **What it is**: the translator between the framework's optimistic-concurrency token (the EF Core
  `rowversion` byte array carried by [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware))
  and the HTTP entity tag that represents that token on the wire. It owns three header constants plus
  a `Format`/`TryParse` pair
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:24-105`).
- **Depends on**: nothing first-party at runtime (the doc comment references
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) at `ConcurrencyETag.cs:7`).
  BCL only: `Convert.ToBase64String`, `Convert.TryFromBase64Chars`, `ReadOnlySpan<char>`, and
  `[NotNullWhen]` from `System.Diagnostics.CodeAnalysis` (`ConcurrencyETag.cs:1`).
- **Concept introduced, the HTTP conditional-request boundary for optimistic concurrency.**
  Optimistic concurrency itself is introduced at
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware): a client echoes back the
  row version it last saw so a stale write is refused. This type is where that value becomes an HTTP
  citizen, and two decisions recorded in its own doc comment are the whole design. First, the tag is
  **always weak** (`W/"..."`, `ConcurrencyETag.cs:12-18`): a strong entity tag promises byte-for-byte
  equality of the representation, and this one does not, because the same row version renders
  differently under a `fields=` projection and says nothing about serializer formatting. Weak is the
  honest strength for a token that answers "is this the same version of the resource", which is
  exactly what `If-Match` asks. Second, the payload is base64 of the raw token
  (`ConcurrencyETag.cs:19-22`), so the round trip is lossless and the value stays inside the
  quoted-string grammar RFC 9110 defines for an entity tag. `[Rubric §9, API & Contract Design]`
  assesses whether the framework speaks the standard protocol rather than inventing a private one:
  preconditions here travel in the headers HTTP already defines, so a generic client library can
  participate. `[Rubric §8, Data Architecture]` covers concurrency control as a deliberate
  persistence concern. This is also the same shared-wire-literal placement rule
  [`IdempotencyHeaders`](#idempotencyheaders) follows, and the doc comment says so: it lives in Shared
  "because both ends of the exchange need it: the API reads an `If-Match` value with it and the UI
  services write one with it" (`ConcurrencyETag.cs:8-9`).
- **Walkthrough**:
  - Three constants name the protocol: `IfMatchHeaderName = "If-Match"` (`ConcurrencyETag.cs:27`),
    `ETagHeaderName = "ETag"` (`:30`), and `Wildcard = "*"` (`:33`), the `If-Match` value that matches
    any current version.
  - `Format(byte[] rowVersion)` (`:40`) null-guards (`:42`) and returns
    `string.Concat("W/\"", Convert.ToBase64String(rowVersion), "\"")` (`:44`), so a token renders as,
    for example, `W/"AAAAAAAAB9E="`.
  - `TryParse(string? value, out byte[]? rowVersion)` (`:62`) is deliberately forgiving on the way in
    and strict about what counts as success. It nulls the out parameter first (`:64`), returns `false`
    for a blank value (`:66-69`), then takes only the **first** entry of a comma-separated list
    (`:71-77`). The remark explains why (`:57-61`): a conditional write here is a single-version
    precondition, since there is one row version to compare against, so a list beyond its first entry
    has no meaning. It then trims (`:79`), strips a case-insensitive `W/` prefix (`:81-84`), strips the
    surrounding quotes when both are present (`:86-89`), and fails on an empty remainder (`:91-94`).
  - Decoding is allocation-conscious: it sizes a buffer from the candidate length (`:96`), calls
    `Convert.TryFromBase64Chars` and rejects both a decode failure and a zero-length result (`:97-100`),
    then slices the buffer to the bytes actually written (`:102`).
  - The contract on `false` is spelled out in the doc (`:52-56`): a blank value, the wildcard, and
    anything that is not base64 all return `false`, and **the caller decides which of those is an error
    in its context**. That is what lets
    [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute) treat a
    wildcard as "no precondition" while treating unparsable input as a 400.
- **Why it's built this way**:
  [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) is the governing
  record. It picks the header as the one transport because HTTP already defines `ETag` and `If-Match`
  for precisely this exchange (`Website/docs-src/adr/035-optimistic-concurrency.md:23-24,147`), and it
  states the Shared placement as a deliberate consequence: the type lives in `MMCA.Common.Shared.Http`
  "rather than in the API package precisely so both ends of the exchange can use it"
  (`035-optimistic-concurrency.md:124-128`). Keeping the wire format in one static class means the
  reader side and the writer side cannot disagree about weakness, base64, or list handling; pushing
  the error decision to the caller keeps the parser free of HTTP status opinions.
- **Where it's used**: server side,
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)`.SetConcurrencyETag`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:471`) writes
  `Response.Headers[ConcurrencyETag.ETagHeaderName] = ConcurrencyETag.Format(rowVersion)`
  (`EntityControllerBase.cs:479`) after a successful by-id read (`EntityControllerBase.cs:436`), and
  the CRUD base does the same after a create
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:112`);
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute) reads the
  request header
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:106`),
  compares against the wildcard (`:110`) and decodes with `TryParse` (`:116`). Client side,
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  formats the tag
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:199`) and attaches it
  as `If-Match` (`EntityServiceBase.cs:394`), as do ADC's
  [`EventService`](group-21-conference-ui.md#eventservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventService.cs:29,41`),
  [`SessionQuestionUIService`](group-22-engagement-module.md#sessionquestionuiservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/SessionQuestionUIService.cs:133,142`)
  and [`LivePollUIService`](group-22-engagement-module.md#livepolluiservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/LivePollUIService.cs:197,206`).
  Framework coverage is `ConcurrencyETagTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Http/ConcurrencyETagTests.cs:16,21,33,47`), and
  ADC's integration bases build their `If-Match` values through the same helper
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestBase.cs:49,59,63`).
- **Caveats / not-in-source**: the `ETag` this type renders exists to be echoed back on the next
  write. Nothing here implements conditional **GET**: no code path compares an inbound `If-None-Match`
  against it, which ADR-035 records explicitly
  (`Website/docs-src/adr/035-optimistic-concurrency.md:182-184`).

### IcsEvent

> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15` · Level 0 · record

- **What it is**: one calendar entry handed to [`IcsCalendarBuilder`](#icscalendarbuilder): a stable
  `Uid`, a `Summary`, a UTC start and end, and two optional strings for description and location
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsEvent.cs:15-21`).
- **Depends on**: nothing first-party; `System.DateTimeOffset` (BCL).
- **Concept introduced, the UTC-only calendar contract.** `[Rubric §9, API & Contract Design]`
  assesses whether a contract states its own invariants rather than leaving them to convention. The
  invariant here is written into the type's own doc comment: "Times are UTC by contract"
  (`IcsEvent.cs:4`). RFC 5545 lets a calendar carry local times paired with a `VTIMEZONE` block that
  restates the zone's DST rules inside the document; getting that block right (and keeping it right as
  tzdata moves) is a well-known source of bugs. By declaring the two timestamps `DateTimeOffset` and
  requiring them to already be UTC instants, this record pushes the wall-clock to UTC conversion onto
  the caller, which is where the zone knowledge actually lives, and lets the builder emit plain
  `Z`-suffixed timestamps with no `VTIMEZONE` machinery at all (`IcsEvent.cs:5-7`). The `Uid` carries a
  second contract: calendar clients de-duplicate re-imports by it, so it must be globally unique and
  *stable* across exports of the same thing (`IcsEvent.cs:9`).
- **Walkthrough**: a positional `sealed record` with six parameters and no body. `Uid`, `Summary`,
  `StartsAtUtc`, `EndsAtUtc` are required by position; `Description` and `Location` default to `null`
  (`IcsEvent.cs:16-21`), which is how the builder decides to omit the corresponding lines entirely
  rather than emit an empty one. A `record` (reference type) rather than the `readonly record struct`
  that the auth DTOs in this group use: entries are built into a collection and enumerated once, so
  there is no per-call allocation to avoid.
- **Why it's built this way**: the framework ships no calendar NuGet dependency, so the shape of an
  entry is the framework's to define. Keeping it to the six fields every calendar client honors is the
  same minimal-subset judgement the builder documents at
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:7-10`. No ADR governs
  calendar export; the decision lives in these two files' doc comments.
- **Where it's used**: ADC's Conference module builds entries from sessions in
  [`CalendarExportMapper`](group-18-conference-application.md#calendarexportmapper), which does the
  event-zone to UTC conversion the contract demands (its `ToUtc` helper at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:47`)
  and composes the `Uid` as `session-{id}@atldevcon` (`CalendarExportMapper.cs:31-44`, the id at
  `:38`). The mapped entries reach
  [`ExportSessionCalendarHandler`](group-18-conference-application.md#exportsessioncalendarhandler)
  (`.../ExportCalendar/ExportSessionCalendarHandler.cs:51-54`) and
  [`ExportEventCalendarHandler`](group-18-conference-application.md#exporteventcalendarhandler)
  (`.../ExportCalendar/ExportEventCalendarHandler.cs:46-53`).
- **Caveats / not-in-source**: nothing in the type enforces that `StartsAtUtc` and `EndsAtUtc` really
  carry a zero offset, that the end follows the start, or that the `Uid` is unique. All three are
  contract-by-documentation; the only enforcement is the mapper that produces them.

### IdempotencyHeaders

> MMCA.Common.Shared · `MMCA.Common.Shared.Http` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13` · Level 0 · class (static)

- **What it is**: the two HTTP header names of the idempotency protocol, as `const string`s:
  `Idempotency-Key` (the request header a client sends) and `X-Idempotent-Replay` (the response header
  a server appends when it served a cached body)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19,25`).
- **Depends on**: nothing.
- **Concept introduced, the shared wire-literal.** `[Rubric §16, Maintainability]` assesses whether a
  fact that two components must agree on has exactly one home. `[Rubric §9, API & Contract Design]`
  assesses whether the protocol between client and server is expressed explicitly. Both ends of this
  protocol are first-party but live in packages that do not reference each other: the filter that reads
  the key ships in `MMCA.Common.API`, the service bases that write it ship in `MMCA.Common.UI`. The doc
  comment states the consequence plainly: "Hard-coding the string in both places is exactly the drift
  this constant exists to prevent" (`IdempotencyHeaders.cs:8-12`). Putting the literal in
  `MMCA.Common.Shared`, the one assembly both sides already depend on, is the standard placement rule
  for cross-layer constants in this framework, and it is the same rule
  [`ConcurrencyETag`](#concurrencyetag) and the auth request DTOs follow.
- **Walkthrough**: a `static class` with two `const string` fields and nothing else
  (`IdempotencyHeaders.cs:13-26`). `const` rather than `static readonly` so the values can appear in
  attribute arguments and constant patterns, matching [`AuthClaimTypes`](#authclaimtypes) and
  [`RoleNames`](#rolenames) in this group.
- **Why it's built this way**:
  [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) defines the protocol: the
  client supplies the key, and a server that replays a cached response adds
  `X-Idempotent-Replay: true` so the caller can tell a replay from a fresh execution
  (`Website/docs-src/adr/017-request-idempotency.md:31,46`).
- **Where it's used**: server side,
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) re-exports the request
  header name as a public property
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:73`), reads it in
  the one helper both filter stages share (`IdempotencyFilter.cs:165`), and appends the replay header
  when it serves a cached response (`IdempotencyFilter.cs:383`);
  [`NotificationsController`](group-10-notifications.md#notificationscontroller) reads the same request
  header directly
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:62`).
  Client side,
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  attaches a generated key on retried writes
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:386`), as do ADC's
  [`SessionQuestionUIService`](group-22-engagement-module.md#sessionquestionuiservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/SessionQuestionUIService.cs:73`)
  and [`LivePollUIService`](group-22-engagement-module.md#livepolluiservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/LivePollUIService.cs:93,156`).

### ModuleNameConventions

> MMCA.Common.Shared · `MMCA.Common.Shared.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:10` · Level 0 · class (static)

- **What it is**: one function, `GetModuleName(Type)`, that reads a CLR type's namespace and returns
  the module that owns it, following the workspace naming convention `MMCA.{App}.{Module}.{Layer}`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:10-51`).
  `MMCA.Store.Sales.Domain.Orders` gives `"Sales"`; `MMCA.ADC.Conference.Application.Sessions` gives
  `"Conference"`; a type outside that shape gives `null`.
- **Depends on**: nothing first-party; `System.Array.FindIndex`/`Array.Exists` and `string.Split` (BCL).
- **Concept introduced, convention over configuration, with the convention hoisted to one function.**
  `[Rubric §16, Maintainability]` assesses whether a rule two subsystems must agree on has one
  implementation. `[Rubric §7, Microservices Readiness]` assesses whether module ownership is a
  first-class, machine-readable fact rather than a naming habit. Two very different subsystems need to
  answer "which module does this type belong to": persistence, which turns the answer into a SQL schema
  name and a logical data-source name, and the CQRS logging decorators, which stamp it into every log
  scope. The class doc names the constraint that forced the hoist: Application "may not reference
  Infrastructure" (`ModuleNameConventions.cs:6-8`), so the derivation cannot live beside the
  persistence code that first needed it. `[Rubric §3, Clean Architecture]` in miniature: the rule moved
  down to `MMCA.Common.Shared`, the assembly every layer may see, rather than up into a layer that
  would have inverted the dependency. The alternative (each subsystem parsing namespaces its own way)
  is the drift the test file names explicitly: the two callers "must never disagree"
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Conventions/ModuleNameConventionsTests.cs:10-11`).
- **Walkthrough**:
  - `NonDomainLayerSegments` is a private `static readonly string[]` holding `Application`,
    `Infrastructure`, `API`, `UI` (`ModuleNameConventions.cs:17`). What is *absent* is the load-bearing
    part, and the comment says so: `Shared` is deliberately not in the list, so framework namespaces
    such as `MMCA.Common.Shared.*` cannot resolve to a phantom module (`:13-16`).
  - `GetModuleName` (`:38`) splits the namespace, defaulting to an empty array when the type has none
    (`:40`), so a compiler-generated or global-namespace type is handled without a null check at the
    call site.
  - **Rule one, `Domain` at any position past the first segment** (`:41-46`). This is the original
    persistence rule, and the remark records that it is kept byte-for-byte so schema and data-source
    names do not move (`:26-28`). `domainIndex >= 1` is the guard: a namespace that *starts* with
    `Domain` has nothing preceding it to name.
  - **Rule two, the other layer segments, only at the fourth segment or later** (`:48-50`). The
    `layerIndex >= 3` test is what makes `MMCA.Common.Application.*` return `null` rather than the
    phantom `"Common"`: in that namespace `Application` sits at index 2, below the threshold, while in
    `MMCA.ADC.Conference.Application` it sits at index 3 and yields `"Conference"` (`:29-31`).
  - Every comparison is `StringComparison.OrdinalIgnoreCase` (`:42,49`), and the first matching
    segment wins (`:22-23`), so a module that happens to be named after a layer word resolves
    deterministically rather than by accident of ordering.
- **Why it's built this way**: no ADR governs the derivation; the rationale is entirely in the class
  doc comment and in the test file's summary. The asymmetric threshold (any position for `Domain`, index
  3 or later for the rest) is not elegance, it is compatibility: relaxing the `Domain` rule would rename
  live SQL schemas, and tightening the others is what keeps framework namespaces module-less.
- **Where it's used**: two subsystems, exactly as the doc comment claims.
  [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult)
  and
  [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult)
  each resolve it into a `private static readonly string ModuleName`, falling back to `"unknown"`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:75`,
  `.../LoggingCommandDecorator.cs:76`) and push it into the log scope
  (`LoggingQueryDecorator.cs:26,68`, `LoggingCommandDecorator.cs:26,69`). Because the field is `static`
  on a closed generic, the namespace parse happens once per query or command type rather than per
  execution, which the doc comment calls out (`LoggingQueryDecorator.cs:70-74`). On the persistence
  side, the internal `NamespaceConventions` wrapper delegates straight to it
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:20-21`), and
  that wrapper is what
  [`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype)
  uses for the SQL Server schema name (falling back to `dbo`,
  `.../Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:66`) and the Cosmos container
  name (`EntityTypeConfiguration.cs:87`), and what
  [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) uses to derive
  a logical database name when no `[UseDatabase]` attribute overrides it
  (`.../DataSources/EntityDataSourceRegistry.cs:181`).
- **Caveats / not-in-source**: the parse keys on the type's own namespace and never on its type
  arguments, so `List<SalesFakeAggregate>` resolves to `null` rather than `"Sales"`; that is pinned by
  test rather than by anything visible in the method
  (`ModuleNameConventionsTests.cs:46-48`). The "framework namespaces resolve to no module" behavior has
  no direct test in this file either: the comment records that it is pinned indirectly, by the
  `LoggingCommandDecorator` tests asserting a scope of `"unknown"` for their own fake command
  (`ModuleNameConventionsTests.cs:41-44`).

### PrivacyFeatures

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6` · Level 0 · class (static)

- **What it is**: one `const string` naming the feature flag that gates the data-subject export
  surface, `Privacy.DataExport`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:9`).
- **Depends on**: nothing first-party.
- **Concept introduced, the feature flag as a shared constant.** `[Rubric §30, Compliance / Privacy /
  Data Governance]` assesses how the codebase handles data-subject rights and how deliberately those
  surfaces are turned on. `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns like feature
  gating are applied uniformly rather than ad hoc. A data-subject access endpoint returns a complete
  dossier of one person's personal data, so it is the last endpoint that should default to reachable.
  Naming the flag once, in the assembly every layer can see, lets the attribute that gates the
  controller and the host configuration that enables it refer to the same string. The flag's own
  evaluation is the `Microsoft.FeatureManagement` `[FeatureGate]` attribute, whose behavior is not this
  type's concern; see
  [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html).
- **Walkthrough**: a `static class` containing a single
  `public const string DataExport = "Privacy.DataExport";` (`PrivacyFeatures.cs:6-10`). The dotted name
  is a namespace convention for the flag key, not C# syntax: it is one opaque string as far as the
  feature manager is concerned.
- **Why it's built this way**:
  [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) makes the whole export
  capability opt-in and records the gate explicitly: a host that has not turned the feature on gets a
  404 from the endpoint rather than an unauthorized-looking 403
  (`Website/docs-src/adr/076-data-subject-export.md:124`).
- **Where it's used**: the framework side is
  [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery),
  which carries `[FeatureGate(PrivacyFeatures.DataExport)]` on the class
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:58`)
  with the rationale in the same file's remarks (`DataExportControllerBase.cs:52-53`). Both apps
  subclass that base with a thin, route-only controller:
  [`UsersDataExportController`](group-24-identity-module.md#usersdataexportcontroller)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersDataExportController.cs:26-35`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersDataExportController.cs:28-38`),
  and both Identity service hosts turn the flag on in configuration
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:21`,
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/appsettings.json:18`). ADC's config carries
  the operational warning beside it: the flag "must stay true: with the flag off the endpoint 404s and
  ADC has no other DSAR surface" (`MMCA.ADC/.../appsettings.json:17-19`).
- **Caveats / not-in-source**: those two `appsettings.json` files are the only places in the workspace
  that declare the flag. Both apps deploy the endpoint from their Identity **service** host, so the
  deployed path is covered, but any other host that mounted the controller would serve a 404 until it
  added its own `FeatureManagement` entry.

### Releaser

> MMCA.Common.Shared · `MMCA.Common.Shared.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:78` · Level 0 · record struct (readonly, nested)

- **What it is**: the handle [`KeyedSemaphoreStripe.AcquireAsync`](#keyedsemaphorestripe) returns.
  Disposing it releases the stripe that was taken
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:78-86`).
- **Depends on**: nested inside [`KeyedSemaphoreStripe`](#keyedsemaphorestripe); implements
  `System.IDisposable`; wraps a `System.Threading.SemaphoreSlim` (BCL).
- **Concept introduced, the disposable-scope handle over a manual acquire/release pair.**
  `[Rubric §15, Best Practices & Code Quality]` assesses whether resource lifetimes are expressed so the
  compiler enforces them. A raw `SemaphoreSlim` requires `WaitAsync` and `Release` to be paired by hand,
  and the pairing has to survive an exception in between; forgetting the `finally` deadlocks every later
  caller on that semaphore permanently. Returning a handle turns the pairing into a `using` statement,
  which the compiler expands to a `try/finally` for you. The caller's whole contract becomes one line,
  and the doc comment says so: "Await the call inside a `using` statement so the release happens even
  when the guarded work throws" (`KeyedSemaphoreStripe.cs:53-55`). `[Rubric §12, Performance &
  Scalability]`: making it a `readonly record struct` means the handle costs one machine word on the
  stack rather than a heap allocation on the hot path of every cache read.
- **Walkthrough**: one private field, `SemaphoreSlim? _stripe` (`KeyedSemaphoreStripe.cs:80`), set by an
  `internal` constructor so only the enclosing stripe set can hand out a live handle
  (`KeyedSemaphoreStripe.cs:82`). `Dispose` is `_stripe?.Release()` (`KeyedSemaphoreStripe.cs:85`). The
  null-conditional is load-bearing rather than defensive noise: a struct always has a parameterless
  `default` form that no constructor ever ran for, so `default(Releaser).Dispose()` is reachable C# and
  must be a no-op instead of a `NullReferenceException`. The doc comment states that guarantee
  (`KeyedSemaphoreStripe.cs:84`).
- **Why it's built this way**: synchronous `IDisposable` rather than `IAsyncDisposable` because
  `SemaphoreSlim.Release` does not block. Contrast the distributed path, where
  [`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) returns
  an `IAsyncDisposable?`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:42`),
  because releasing a lock held in a remote store is I/O.
- **Where it's used**: every caller of `AcquireAsync`, always inside a `using`:
  [`MemoryCacheService`](group-09-caching.md#memorycacheservice) at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:101,112,132`,
  [`CookieSessionRefresher`](#cookiesessionrefresher) at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:103`,
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:206`, and the
  [`ICacheService`](group-09-caching.md#icacheservice) `GetOrCreateAsync` default implementation at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:112`.
  [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
  is the one caller that names the type explicitly: its `TryAcquirePopulateLockAsync` returns
  `KeyedSemaphoreStripe.Releaser?`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:178`,
  acquiring at `:182` or, under a budget, `:189`), so the nullable handle can carry "no lock was taken"
  as a value rather than as a separate flag.

### UserDataExportSectionDTO

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:61` · Level 0 · record

- **What it is**: one section of a data-subject export package: a `SectionName`, an `Available` flag,
  an opaque `Data` payload, and an `UnavailableReason`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:61-89`). It is the envelope
  around whatever one contributor holds about the subject.
- **Depends on**: nothing first-party;
  `System.Runtime.Serialization.DataContractAttribute`/`DataMemberAttribute` (BCL). It is the element
  type of [`UserDataExportDTO.Sections`](#userdataexportdto).
- **Concept introduced, "no data" is not the same fact as "not retrieved".** `[Rubric §29, Resilience &
  Business Continuity]` assesses how a composite operation behaves when one contributor is down.
  `[Rubric §30, Compliance / Privacy / Data Governance]` assesses whether a data-subject right can be
  honored under partial failure. A naive export either fails whole when any peer is unreachable
  (denying the subject the data that *is* available) or silently omits the failed section (telling the
  subject, falsely, that nothing is held there). This envelope refuses both: a section that could not be
  produced is still present in the document, reporting `Available = false`, and the doc comment records
  the distinction the reader must draw: false "means the section is incomplete and the export can be
  retried later; it does not mean the subject has no data here" (`UserDataExportDTO.cs:68-69`). This is
  the shape [ADR-096](https://ivanball.github.io/docs/adr/096-best-effort-side-effects.html) calls
  best-effort, applied to a read.
- **Walkthrough**: four `init`-only properties, ordered explicitly with `[DataMember(Order = n)]`
  (`UserDataExportDTO.cs:64,71,79,87`) so the serialized field order is a stated part of the contract
  rather than a reflection accident. `SectionName` and `Available` are `required`
  (`UserDataExportDTO.cs:65,72`), so a section envelope cannot be constructed without answering both
  questions. `Data` is typed `object?` for the same reason `UserDataExportDTO.Subject` is: the framework
  owns the envelope, the contributor owns the payload shape, and `System.Text.Json` serializes an
  `object`-typed property by its runtime type (`UserDataExportDTO.cs:74-78`). The fourth property
  carries the section's most security-sensitive rule: `UnavailableReason` is "a short, caller-safe
  explanation" that "never carries exception messages, stack traces, connection strings, or peer
  addresses: this string is handed to the data subject" (`UserDataExportDTO.cs:82-86`).
- **Why it's built this way**:
  [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) settled the three
  questions neither app had answered, the first of which was exactly what an export does when one
  contributing source is unavailable
  (`Website/docs-src/adr/076-data-subject-export.md:52-53`). Degrading one section preserves the legal
  deadline on the rest of the document, and the ADR names the trade-off it accepts in return: an export
  that looks successful can be incomplete, which is what the `Available` flag exists to disclose
  (`076-data-subject-export.md:84-88`).
- **Where it's used**: produced by
  [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery)
  on both paths of its per-section `try/catch`: from a successful
  [`UserDataExportSectionResult`](group-14-module-system-composition.md#userdataexportsectionresult)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:177-183`)
  and from the `catch` that degrades a throwing contributor
  (`ExportUserDataHandlerBase.cs:185-197`), where the reason is the fixed string on
  [`UserDataExportSectionDefaults`](group-14-module-system-composition.md#userdataexportsectiondefaults)
  rather than anything derived from the exception (`:196`) and the exception detail goes to the log
  instead (`:190`). The envelopes are collected into [`UserDataExportDTO.Sections`](#userdataexportdto)
  at `ExportUserDataHandlerBase.cs:104,116`. The contributors themselves implement
  [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection)
  (`ExportUserDataHandlerBase.cs:167`).
- **Caveats / not-in-source**: nothing prevents an envelope from setting `Available = true` and a
  non-null `UnavailableReason` at the same time, or `Available = false` with a payload. The consistency
  is a convention the producing handler upholds, not a type invariant.

### IcsCalendarBuilder

> MMCA.Common.Shared · `MMCA.Common.Shared.Calendars` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12` · Level 1 · class (static)

- **What it is**: a dependency-free RFC 5545 writer. Given a product id, a collection of
  [`IcsEvent`](#icsevent), and a timestamp, it returns a complete `VCALENDAR` document as a string
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:22-41`).
- **Depends on**: [`IcsEvent`](#icsevent); `System.Text.StringBuilder`, `System.Text.Encoding`, and
  `System.Globalization.CultureInfo` (BCL). No NuGet package.
- **Concept introduced, the deterministic pure builder.** `[Rubric §14, Testability]` assesses whether
  behavior can be asserted without a harness. This type takes `dtStamp` as a parameter rather than
  reading a clock, and the doc comment states the consequence: "Deterministic by design: the caller
  supplies `dtStamp`, so identical inputs produce identical output" (`IcsCalendarBuilder.cs:9-10`).
  That makes the whole document byte-assertable, which is exactly what the suite in
  `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Calendars/IcsCalendarBuilderTests.cs` does, including
  a determinism test that builds twice and compares (`IcsCalendarBuilderTests.cs:138-143`).
  `[Rubric §32, Dependency & Supply-Chain]` assesses what the framework takes on as a dependency.
  Emitting an ICS file is a few hundred lines of string handling; taking a calendar library for it would
  add a transitive surface to `MMCA.Common.Shared`, the assembly every other package depends on. The
  type instead states its scope as "the subset every calendar app imports reliably"
  (`IcsCalendarBuilder.cs:7-9`).
- **Walkthrough**:
  - `MaxLineOctets = 75` (`IcsCalendarBuilder.cs:14`) is RFC 5545's content-line limit, counted in
    octets rather than characters.
  - `Build` (`:22`) guards both inputs (`ThrowIfNullOrWhiteSpace` on the product id, `ThrowIfNull` on
    the events, `:24-25`), then writes the fixed calendar preamble `VERSION:2.0`, an escaped `PRODID`,
    `CALSCALE:GREGORIAN`, and `METHOD:PUBLISH` (`:28-32`), loops the entries in the order given
    (`:34-37`), and closes the document (`:39`). Note that an empty collection is legal: it produces a
    valid, entry-less calendar, which `IcsCalendarBuilderTests.cs:151` pins.
  - `AppendEvent` (`:43`) writes the five mandatory `VEVENT` lines: `UID`, `DTSTAMP`, `DTSTART`,
    `DTEND`, `SUMMARY` (`:46-50`). `DESCRIPTION` and `LOCATION` are emitted only when the optional field
    is not null *or whitespace* (`:52-60`), so an all-blank location does not leave a stray empty
    property in the document.
  - `FormatUtc` (`:65`) is where the UTC-only contract shows up on the wire: it converts through
    `UtcDateTime` and formats `yyyyMMdd'T'HHmmss'Z'` under `InvariantCulture` (`:66`). The invariant
    culture is not optional decoration; a non-Gregorian or non-ASCII-digit current culture would
    otherwise corrupt the timestamp.
  - `EscapeText` (`:69`) implements RFC 5545 section 3.3.11 TEXT escaping. Order matters and is correct
    here: backslash is escaped *first* (`:71`), so the backslashes introduced by the later replacements
    are not double-escaped. Semicolon and comma follow (`:72-73`), then all three newline forms collapse
    to the literal escaped-`n` sequence (`:74-76`), CRLF before its parts so a Windows line break does
    not become two escapes.
  - `AppendLine` (`:83`) is the subtlest method: RFC 5545 folding. It walks the string counting UTF-8
    *octets* per character, treating a surrogate pair as one unit (`:89-90`), and when the next
    character would push the line past 75 octets it emits `CRLF` plus a single space and resets the
    counter to `1` (`:92-96`). Two details are easy to get wrong and are handled: a fold never splits a
    multi-byte character (because the decision is made per character, before appending), and the
    continuation line's leading space counts against its own budget, which the inline comment states
    (`:95`). Every line, folded or not, ends in `CRLF` (`:103`).
- **Why it's built this way**: no ADR covers calendar export; the rationale is entirely in the doc
  comments cited above. The minimal-subset choice is the same instinct as the [`IcsEvent`](#icsevent)
  UTC contract: avoid the parts of the specification whose correctness would need continuous
  maintenance.
- **Where it's used**: ADC's Conference module only, from
  [`ExportSessionCalendarHandler`](group-18-conference-application.md#exportsessioncalendarhandler) for
  a single session
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:51-54`)
  and [`ExportEventCalendarHandler`](group-18-conference-application.md#exporteventcalendarhandler) for
  a whole event (`.../ExportCalendar/ExportEventCalendarHandler.cs:46-53`), both passing
  [`CalendarExportMapper`](group-18-conference-application.md#calendarexportmapper)'s `ProductId`
  constant `-//MMCA//AtlDevCon//EN` (`.../ExportCalendar/CalendarExportMapper.cs:17`).
- **Caveats / not-in-source**: both ADC handlers pass `DateTimeOffset.UtcNow` for `dtStamp`
  (`ExportSessionCalendarHandler.cs:54`, `ExportEventCalendarHandler.cs:53`) rather than an injected
  `TimeProvider`, so the determinism the builder guarantees is available to its own tests but not
  exercised through the handlers.

### KeyedSemaphoreStripe

> MMCA.Common.Shared · `MMCA.Common.Shared.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22` · Level 1 · class

- **What it is**: an in-process, per-key mutual-exclusion primitive. Callers ask to serialize on a
  string key; the key is hashed onto one of a fixed number of `SemaphoreSlim` stripes, and the caller
  gets back a [`Releaser`](#releaser) to dispose
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22-86`).
- **Depends on**: its own nested [`Releaser`](#releaser); `System.Threading.SemaphoreSlim` (BCL).
- **Concept introduced, lock striping.** `[Rubric §12, Performance & Scalability]` assesses how shared
  state is guarded under concurrency and what that guard costs. The naive way to lock per key is a
  `ConcurrentDictionary<string, SemaphoreSlim>`, and the class doc comment lays out why that shape is a
  trap, in the code rather than in tribal memory (`KeyedSemaphoreStripe.cs:8-15`):
  - If you **remove** the entry when the last holder releases, you open a race. Caller A looks the
    semaphore up, then B releases and removes it, then A waits on an object no longer in the table while
    C creates a fresh one and takes that. A and C now both run the guarded section, which is precisely
    what the lock existed to prevent.
  - If you **never remove** it, the table grows without bound, and the keys here are caller-supplied
    (an idempotency key, a parameterized cache key), so that is an attacker-influenced memory leak.

  Striping sidesteps both by never creating or destroying anything: the table is allocated once at the
  declared width and every key maps into it forever. The price is stated honestly in the same comment:
  two unrelated keys can collide on a stripe and briefly serialize against each other. That is harmless
  for the double-check-locking callers this exists for, because each one re-checks its own key's state
  after acquiring (`KeyedSemaphoreStripe.cs:13-15`).
- **Walkthrough**:
  - `DefaultWidth = 256` (`:25`), described as "ample concurrency without a meaningful memory cost"
    (`:24`); 256 `SemaphoreSlim` instances is a fixed, small, one-time allocation.
  - The parameterless constructor chains to the width-taking one (`:30-33`). The real constructor
    validates with `ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(width, 0)` (`:39`), then eagerly
    fills the array with binary semaphores, `new SemaphoreSlim(1, 1)` (`:42-46`). Eager fill is what
    removes every later allocation and every later race: after the constructor there is no mutation of
    the table at all, which is why the type is safe to share without any lock of its own.
  - `Width` is a get-only property (`:50`), exposed so tests can reason about collisions; one test
    computes the exact stripe index a key lands on, precisely so it "cannot flake on the
    one-in-`DefaultWidth` collision"
    (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:270,291`).
  - `AcquireAsync` (`:60`) resolves the stripe, awaits `WaitAsync(cancellationToken)` with
    `ConfigureAwait(false)` per
    [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html) (`:63`), and
    wraps the semaphore in a `Releaser` (`:64`). The parameter doc draws a line worth remembering: the
    token "Cancels the wait, not the work that follows it" (`:58`).
  - `GetStripe` (`:67`) does the hashing:
    `(uint)string.GetHashCode(key, StringComparison.Ordinal) % (uint)Width` (`:73`). Two deliberate
    choices, both commented (`:71-72`). `StringComparison.Ordinal` is passed explicitly rather than
    relying on the default, which keeps the mapping culture-independent. And the sign is folded by
    casting to `uint` rather than calling `Math.Abs`, because `int.MinValue` has no positive counterpart
    and `Math.Abs` would throw on it.
- **Why it's built this way**: the class is a hoisted shared primitive rather than a private helper
  because five separate call sites needed the same guard.
  [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) records its role in the
  idempotency filter explicitly: the striped semaphore is the fallback for a host that registers no
  `IDistributedLock`, and the ADR reproduces the same two-defects argument
  (`Website/docs-src/adr/017-request-idempotency.md:59-65`). The scaling limit is stated there too: a
  process-local lock only serializes duplicates that land on the same replica
  (`017-request-idempotency.md:91-93`), which is why
  [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) is preferred when present
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:34-37`).
- **Where it's used**: five holders, all `static` or instance fields that live for the lifetime of their
  owner, matching the remark that instances are "intended to be held in a static field for the process
  lifetime" and that stripes are never disposed (`KeyedSemaphoreStripe.cs:18-21`):
  [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) (`IdempotencyFilter.cs:90`),
  [`CookieSessionRefresher`](#cookiesessionrefresher)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:63`),
  [`MemoryCacheService`](group-09-caching.md#memorycacheservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:38`), the
  `CacheKeyLocks` holder behind [`ICacheService`](group-09-caching.md#icacheservice)'s
  `GetOrCreateAsync` default implementation
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:142-145`), and the
  `QueryCacheKeyLocks` holder behind
  [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:246-249`).
  [`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) cites the
  same reasoning in its own doc comment (`InProcessDistributedLock.cs:20`).
- **Caveats / not-in-source**: .NET randomizes string hash codes per process, so the stripe a given key
  lands on differs between runs. That is invisible to correctness (any key consistently maps to one
  stripe *within* a process) but it means collision behavior cannot be reproduced across processes.

### UserDataExportDTO

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` · Level 1 · record

- **What it is**: the whole data-subject export package: a format version, a generation timestamp, the
  subject's id, an app-owned snapshot of the account itself, and a list of
  [`UserDataExportSectionDTO`](#userdataexportsectiondto) envelopes
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15-49`).
- **Depends on**: [`UserDataExportSectionDTO`](#userdataexportsectiondto); the `UserIdentifierType` alias
  ([ADR-085](https://ivanball.github.io/docs/adr/085-identifier-type-aliases-revisited.html));
  `System.Runtime.Serialization` attributes (BCL).
- **Concept introduced, the versioned, PII-by-design document.** `[Rubric §30, Compliance / Privacy /
  Data Governance]` assesses how personal data is classified and handled. Most DTOs in this codebase
  carry incidental personal data; this one *is* personal data end to end, and the type says so in bold
  in its own summary: "This document is **PII by design**. It exists to hand a data subject everything
  an app holds about them, so it must only ever be produced for the account owner (or a privileged role)
  and must never be logged, cached, or persisted by the pipeline that serves it"
  (`UserDataExportDTO.cs:9-11`). That single comment is what makes three otherwise-invisible decisions
  legible: the query is not `IQueryCacheable`, so the caching decorator never sees it
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:43-44`);
  the degradation path logs the exception but hands the subject a generic reason
  (`ExportUserDataHandlerBase.cs:188-196`); and the controller serializes to bytes and returns a file
  rather than an `ObjectResult`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:101-109`).
  `[Rubric §9, API & Contract Design]`: `FormatVersion` versions "the export document shape itself (not
  the app's data)" (`UserDataExportDTO.cs:18-19`), so a consumer parsing an old file can detect an
  envelope change rather than guess at it.
- **Walkthrough**: five `init`-only properties under `[DataContract]` (`:14`), each with an explicit
  `[DataMember(Order = n)]` (`UserDataExportDTO.cs:21,25,29,39,47`) pinning field order into the
  contract.
  - `FormatVersion`, `GeneratedOn`, and `UserId` are `required` (`:22,26,30`), so the envelope cannot be
    constructed without them.
  - `Subject` is `object?` (`:40`), and the doc comment gives the full reasoning: the framework owns the
    envelope, each app owns which of its own fields are portable personal data, and an `object`-typed
    property serializes by its *runtime* type under `System.Text.Json` (`:32-38`). That last clause is
    the mechanism that makes the erasure of the static type harmless. `null` is legal and means the app
    publishes no subject fields.
  - `Sections` defaults to an empty collection expression, `= []` (`:48`), so an export with no
    registered contributors is a well-formed document rather than a null-bearing one. Order is the
    section registration order, which the comment makes part of the contract (`:42-46`).
- **Why it's built this way**:
  [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) hoisted this shape out of
  two near-identical app implementations. It is the export half of the data-subject obligation whose
  erasure half was settled by
  [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), which explicitly scoped
  export out and left it to consumers
  (`Website/docs-src/adr/076-data-subject-export.md:21-23`).
- **Where it's used**: it is the result type of the export query all the way through the stack.
  [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery)
  implements `IQueryHandler<TQuery, Result<UserDataExportDTO>>` (`ExportUserDataHandlerBase.cs:53`),
  stamps `CurrentFormatVersion = "1.0"` into it (`ExportUserDataHandlerBase.cs:61,112`), and takes
  `GeneratedOn` from an injected `TimeProvider` rather than a static clock
  (`ExportUserDataHandlerBase.cs:113`).
  [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery)
  declares it as the 200 response type (`DataExportControllerBase.cs:78`) and derives the download file
  name from the package's own `GeneratedOn` so the file name and the document can never disagree
  (`DataExportControllerBase.cs:109,124-134`). Both apps subclass the handler
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:35`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:39`)
  and expose it through their own
  [`UsersDataExportController`](group-24-identity-module.md#usersdataexportcontroller)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersDataExportController.cs:27`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersDataExportController.cs:29`).

### ProblemDetailsResultReader

> MMCA.Common.Shared · `MMCA.Common.Shared.Http` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:58` · Level 3 · class (static)

- **What it is**: the client-side inverse of the API's error edge. It reads an RFC 9457 Problem Details
  body (or a non-JSON body, or no body at all) and turns it back into the
  [`Error`](group-01-result-error-handling.md#error) list and failed
  [`Result`](group-01-result-error-handling.md#result) the server started from
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:58-476`).
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result) and
  [`ErrorType`](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions`
  (`ProblemDetailsResultReader.cs:4`); BCL only otherwise: `System.Text.Json`,
  `System.Collections.Frozen`, `System.Net.Http.HttpResponseMessage`, `System.Globalization`
  (`:1-3`).
- **Concept introduced, closing the Result round trip across an HTTP hop.** The framework's error
  currency is a `Result` carrying typed `Error`s, and
  [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) makes that the whole point:
  business failures are values, not exceptions. HTTP does not carry `Result`s, so
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) projects a failure into
  Problem Details on the way out. Without a reader, the client half of that trip is lossy in the worst
  way: a Blazor page would see "500" or an `HttpRequestException` where the server said
  "Session.AlreadyClosed, Conflict". This type is the missing half. `[Rubric §9, API & Contract Design]`
  assesses whether the contract is honored symmetrically at both ends; `[Rubric §29, Resilience &
  Business Continuity]` assesses whether a caller degrades usefully rather than crashing, which is why
  every unreadable-body path still yields exactly one usable `Error`. Its **placement** is the same rule
  [`IdempotencyHeaders`](#idempotencyheaders) and [`ConcurrencyETag`](#concurrencyetag) follow, stated in
  the doc comment: the client half of the round trip is `MMCA.Common.UI`, "which references Shared only"
  (`ProblemDetailsResultReader.cs:15-18`), so the reader lives in Shared and uses nothing beyond the BCL.
  The doc comment also enumerates the four payload shapes it understands and, crucially, states its own
  **fidelity limit** in the same breath (`:20-56`): only the MMCA error array is lossless; the other
  three derive the `ErrorType` from the status code, "which is **lossy for 400 Bad Request**".
- **Walkthrough**:
  - Three public `const string` codes name the synthesized failures: `StatusErrorCodePrefix = "Http."`
    (`:65`), `EmptyResponseCode = "Http.EmptyResponse"` (`:71`), and
    `MalformedResponseCode = "Http.MalformedResponse"` (`:77`). They are public precisely so tests and
    callers can branch on them without re-spelling the literal.
  - A block of private `const`s holds every JSON member name it looks for (`:79-88`), so the wire
    vocabulary is declared once.
  - `StatusCodeToErrorType` is a `FrozenDictionary<int, ErrorType>` (`:96-106`), documented as "the exact
    reverse of `ErrorHttpMapping.ErrorTypeToStatusCode`" (`:91-92`). That forward map really does collapse
    three types onto 400 (`Validation`, `Invariant` and `Failure`, at
    `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:22,23,29`), which is
    exactly why the reverse is lossy there and picks `Validation`.
  - `FromHttpStatusCode(int)` (`:128`) is the public reverse mapping: a dictionary hit wins (`:130-133`),
    any other 4xx becomes `Failure`, anything else (5xx included) becomes `Unexpected` (`:135`).
  - `ParseProblemDetails(int, string?)` (`:153`) is the pure core, and the doc says why it is separated
    from the HTTP surface: "no HTTP, no I/O, no allocation of an `HttpResponseMessage`, so it can be
    tested directly against captured payloads" (`:139-141`), which is `[Rubric §14, Testability]` made
    structural. Its flow: a blank body synthesizes one error (`:155-158`); a `JsonException` is caught
    and does the same, with the comment naming the real-world cases ("a bare challenge, an HTML error
    page, a proxy response", `:161-169`); a root that is not a JSON object likewise (`:174-177`).
    Otherwise it resolves the effective status (`:179`) and the fallback type (`:180`), then branches on
    the `errors` member: an array goes to `ReadErrorArray` (`:186-188`), an object to
    `ReadValidationDictionary` (`:190-192`). Parsed errors win only when the list is non-empty
    (`:195-198`); otherwise it falls through to a synthesized error carrying `detail` or `title`
    (`:201`).
  - `ResolveStatus` (`:419`) is a small but deliberate affordance: a caller that passes a non-positive
    status gets the status read out of the body's own `status` member instead (`:426-430`), which is what
    makes the parser usable against a captured payload with no response object around it.
  - `ReadErrorArray` (`:319`) maps each object element through `ReadErrorObject` and, notably, still
    salvages a degraded array of plain strings (`:331-336`). `ReadErrorObject` (`:342`) reads `code`,
    `message`, `type`, `source` and `target`, with a three-step fallback for the message
    (`message`, then `code`, then the generic default) so an `Error` is never constructed with an empty
    one (`:348-353`).
  - `ReadValidationDictionary` (`:356`) handles the standard ASP.NET Core shape. The key becomes
    `Validation.{propertyName}`, or bare `Validation` for an object-level rule with an empty key
    (`:363-365`), and the property name is carried separately as `Target` (`:366`). A value may be an
    array of messages or a single one, and both paths funnel through `AddValidationError` (`:368-378`),
    which silently ignores non-string and blank entries (`:391-400`).
  - `ParseErrorType` (`:403`) is the one place an inbound string becomes an enum, and it is
    defensive in the right way: `Enum.TryParse` with `ignoreCase: true` **plus** `Enum.IsDefined`
    (`:405-406`). Without the second check `TryParse` would happily accept an arbitrary numeric string and
    hand back an undefined enum value.
  - `ToFailureResult` (`:212`) lifts the parsed errors into a failed `Result`. `ReadAsync` (`:223`)
    short-circuits on a 2xx to `Result.Success()` (`:229-232`) and otherwise parses the body.
    `ReadAsync<T>` (`:257`) is the value-returning overload: a non-success status parses errors (`:269`),
    a blank 2xx body is a *failure* coded `EmptyResponseCode` (`:272-279`), a body that deserializes to
    `null` is the same failure with a different message (`:284-289`), and a `JsonException` becomes
    `MalformedResponseCode` (`:292-295`). The "204 is a failure here" rule is stated in the doc with its
    escape hatch: use the non-generic overload for endpoints that legitimately answer without a body
    (`:241-246`).
  - `ReadBodyAsync` (`:298`) buffers the content as a string and swallows an `HttpRequestException` back
    to `null` (`:311-316`), with the comment explaining the judgement: a truncated body should still
    report the status-level failure rather than surface a transport exception "from a reader".
  - `TryGetProperty` (`:444`) does case-insensitive member lookup, trying the exact name first and only
    then enumerating (`:453-459`). The doc gives the reason (`:438-443`): the wire form is camelCase, but
    a hand-assembled or differently-configured payload can be PascalCase, and a reader that understood
    only one "would silently drop every error field".
- **Why it's built this way**:
  [ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html) is the governing
  record. It states that the client dispatch "returns a `Result`; it does not throw", hands the response
  to this reader in both service-base overloads, and records what the change replaced: the client used
  to pull domain wording out of the body and **rethrow** it as a `DomainInvariantViolationException`
  before falling back to `EnsureSuccessStatusCode`, and that helper "is deleted, not deprecated"
  (`Website/docs-src/adr/094-client-entity-data-access.md:81-92`).
- **Where it's used**: it is the single funnel for every framework-shaped HTTP read on the client.
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  uses both overloads
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:339,367`, documented at
  `:304,321,347`),
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase) uses all three call
  shapes
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:42,58,77`), and the
  notification inbox service does the same
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:54,73,92,110`).
  ADC's hand-written UI services call it directly rather than going through a base, for example
  [`UserService`](group-24-identity-module.md#userservice)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:64,90,112,139,156`),
  [`SpeakerDashboardService`](group-21-conference-ui.md#speakerdashboardservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerDashboardService.cs:102`),
  [`CategoryItemLookupService`](group-21-conference-ui.md#categoryitemlookupservice)
  (`.../Services/CategoryItemLookupService.cs:51`) and
  [`SessionQuestionUIService`](group-22-engagement-module.md#sessionquestionuiservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/SessionQuestionUIService.cs:35,54,80`).
  The round trip is pinned end to end by `ProblemDetailsRoundTripTests`, which serializes a real failure
  through the API edge and reads it back with `ParseProblemDetails`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/ProblemDetailsRoundTripTests.cs:47,71,86,125`).
- **Caveats / not-in-source**: `ErrorHttpMapping` is `internal` to `MMCA.Common.API`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:14`) and this reader
  lives in `MMCA.Common.Shared`, so the two dictionaries cannot reference each other. Nothing in the type
  system keeps the reverse map aligned when a new `ErrorType` or status is added to the forward one; the
  alignment rests on the doc comment (`ProblemDetailsResultReader.cs:91-94`) and on the round-trip test.
  The `[Rubric §16, Maintainability]` reading is that this is a knowingly accepted duplication, priced
  against giving Shared a reference to the API package.

### ForgotPasswordRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:11` · Level 1 · class

- **What it is**: the FluentValidation validator for
  [`ForgotPasswordRequest`](#forgotpasswordrequest). It checks one field, `Email`, for non-empty and
  address shape
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:13-16`).
- **Depends on**: [`ForgotPasswordRequest`](#forgotpasswordrequest); `FluentValidation`'s
  `AbstractValidator<T>` (NuGet).
- **Concept introduced, validation that deliberately stops short.** `[Rubric §11, Security]` assesses
  whether the system leaks facts an attacker can use, and account enumeration is the classic leak: if
  "forgot password" answers differently for a registered and an unregistered address, the endpoint
  becomes a membership oracle. The forgot-password endpoint answers `202 Accepted` unconditionally
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:79,92`),
  and this validator is the place that could quietly undo it: a rule that checked whether the address
  belongs to an account would turn a miss into a `400`, which is the same oracle by a different status
  code. The class doc comment names that trap and refuses it: a 400 there "would be the enumeration
  oracle the always-accepted response exists to close" (`ForgotPasswordRequestValidator.cs:7-9`), and
  the controller's own remarks agree that only a malformed payload may reach 400
  (`PasswordResetAuthControllerBase.cs:28-30`). `[Rubric §24, Forms / Validation / UX Safety]`: shape
  validation still runs, so a genuinely malformed address gets a useful client-side message without
  costing an email send.
- **Walkthrough**: an expression-bodied constructor with a single chained rule,
  `RuleFor(x => x.Email).NotEmpty().EmailAddress()`, each stage carrying an explicit `WithMessage`
  (`ForgotPasswordRequestValidator.cs:13-16`). The messages are literal English strings rather than
  resource lookups, which is how every validator in this assembly is written.
- **Why it's built this way**: the reset flow itself is
  [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html); the
  uniform-response posture it depends on is only as strong as its weakest responder, and a validator
  runs before the handler does.
- **Where it's used**: registered by assembly scan.
  `services.AddValidatorsFromAssemblyContaining<ClassReference>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51`) picks up every validator
  in `MMCA.Common.Application`, with the comment explaining why it must happen here rather than in the
  per-module scan (`DependencyInjection.cs:48-50`). The resolved `IValidator<ForgotPasswordRequest>` is
  then consumed indirectly: an app's forgot-password command implements
  `ICommandWithRequest<ForgotPasswordRequest>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:43`),
  and
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  bridges the command's `Request` property to this validator
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:37-39`),
  auto-registered for every such command at `DependencyInjection.cs:254-270`.

### LoginRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11` · Level 1 · class

- **What it is**: the validator for [`LoginRequest`](#loginrequest): `Email` must be non-empty and a
  valid address, `Password` must be non-empty
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:15-20`).
- **Depends on**: [`LoginRequest`](#loginrequest); `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: the same "validation that deliberately stops short" posture introduced by
  [`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator). `[Rubric §11, Security]`: the doc
  comment is explicit that the minimalism is a security property, not laziness. Credential verification
  "happens in the authentication service to avoid leaking information about which field was wrong"
  (`LoginRequestValidator.cs:7-9`). Notice what is *absent*: no
  [`PasswordRules<T>`](group-06-validation.md#passwordrulest) or
  [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest) include. Applying the
  complexity policy at login would tell an attacker that a candidate password could not possibly be the
  stored one, and would lock out any account whose password predates the current policy. Complexity
  belongs on the *writing* paths only, which is why
  [`ResetPasswordRequestValidator`](#resetpasswordrequestvalidator) includes it and this one does not.
- **Walkthrough**: a block-bodied constructor with two independent `RuleFor` chains
  (`LoginRequestValidator.cs:15-20`), each stage given an explicit `WithMessage`. FluentValidation runs
  both rule sets and reports every failure, so a request missing both fields returns two errors rather
  than one.
- **Why it's built this way**: uniform failure responses for authentication are the same discipline as
  the forgot-password 202, applied to a different endpoint. The complementary defence against guessing
  at scale is the per-IP rate-limit policy the login action carries,
  `[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:72`, with the
  posture stated in the class remarks at `:19-21`), which is
  [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html).
- **Where it's used**: registered by the assembly scan at
  `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51` (which names this class in
  its comment, `DependencyInjection.cs:48`), then injected as `IValidator<LoginRequest>` into
  [`AuthenticationValidators`](#authenticationvalidators), the parameter object that bundles the three
  auth validators
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:17,22`), which is in
  turn what [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) consumes.
- **Caveats / not-in-source**: `AuthenticationValidators` also requires an `IValidator<RegisterRequest>`
  (`AuthenticationValidators.cs:18,25`), but `MMCA.Common.Application` ships no
  `RegisterRequestValidator`: the only ones in the tree are app-level
  ([`RegisterRequestValidator`](group-24-identity-module.md#registerrequestvalidator) at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:12`
  and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:13`).
  The bundle therefore only resolves in a host whose own Application assembly has been scanned as well.

### RefreshTokenRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10` · Level 1 · class

- **What it is**: the validator for [`RefreshTokenRequest`](#refreshtokenrequest). Both fields are
  required and nothing more is checked
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:14-18`).
- **Depends on**: [`RefreshTokenRequest`](#refreshtokenrequest); `FluentValidation`'s
  `AbstractValidator<T>`.
- **Concept**: the shape is the one
  [`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator) introduced. What this validator
  teaches is *why both* fields are mandatory, which the doc comment states: the expired access token is
  needed "for claim extraction" and the refresh token "for rotation verification"
  (`RefreshTokenRequestValidator.cs:7-8`). `[Rubric §11, Security]`: rotation verifies the presented
  refresh token against the one stored for the *identity carried by the access token*, so a request
  missing either half cannot be evaluated at all. Deliberately absent: any JWT well-formedness or
  signature check. Parsing a token is the token service's job, and doing it here would duplicate the
  trust boundary in a layer that has no key material.
- **Walkthrough**: two single-stage `RuleFor(...).NotEmpty()` chains with explicit messages
  (`RefreshTokenRequestValidator.cs:14-18`).
- **Why it's built this way**: keeping the validator to presence checks leaves exactly one place where a
  token's authenticity is decided, which is what makes the refresh endpoint's failure responses uniform.
- **Where it's used**: picked up by the same assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51`, named in the comment at
  `:47`) and injected as `IValidator<RefreshTokenRequest>` into
  [`AuthenticationValidators`](#authenticationvalidators)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:19,28`).

### ResetPasswordRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:12` · Level 1 · class

- **What it is**: the validator for [`ResetPasswordRequest`](#resetpasswordrequest): address shape on
  `Email`, presence on `Token`, and the shared strong-password policy on `NewPassword`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:16-23`).
- **Depends on**: [`ResetPasswordRequest`](#resetpasswordrequest);
  [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest); `FluentValidation`'s
  `AbstractValidator<T>` and its `Include` composition.
- **Concept introduced, composing a rule set with `Include`.** `[Rubric §11, Security]` assesses whether
  a policy holds on every path that can change the guarded value, and `[Rubric §1, SOLID]` the
  single-responsibility split that makes that possible. A password-complexity policy is only a policy if
  *every* write path enforces it; if registration demands an uppercase letter and reset does not, reset
  is a documented downgrade route. FluentValidation's `Include` merges another validator's rules for the
  same model type into this one, so the policy can live in exactly one class and be pulled into each
  writer. The doc comment states the intent: the new password goes through "the same
  `StrongPasswordRules<T>` the registration and change-password requests use, so a reset cannot be a way
  around the complexity policy" (`ResetPasswordRequestValidator.cs:8-10`). `StrongPasswordRules<T>` is
  generic over the containing model and takes a selector expression, which is what lets one rule set
  attach to a differently-shaped request each time
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:188-199`): it
  enforces non-empty, 8 to 128 characters, and one each of uppercase, lowercase, digit, and
  non-alphanumeric.
- **Walkthrough**: three statements in a block-bodied constructor
  (`ResetPasswordRequestValidator.cs:14-24`). `Email` gets `NotEmpty().EmailAddress()` (`:16-18`),
  matching the forgot-password half so the two steps agree on what an address is. `Token` gets
  `NotEmpty()` with a reset-specific message (`:20-21`); no format check, because the token's validity is
  a lookup, not a shape. Then
  `Include(new StrongPasswordRules<ResetPasswordRequest>(x => x.NewPassword))` (`:23`) grafts the seven
  policy rules onto the `NewPassword` field. Note the contrast with the weaker sibling
  [`PasswordRules<T>`](group-06-validation.md#passwordrulest) (`CommonValidationRules.cs:174-181`), which
  enforces length only; reset deliberately takes the strong one.
- **Why it's built this way**: the reset flow is
  [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html), and the hashing
  the accepted password ends up under is
  [ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html) (which supersedes
  ADR-032). Neither is this validator's concern, which is the point: it only decides whether the
  candidate is policy-compliant.
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51`) and reached through
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  for any command implementing `ICommandWithRequest<ResetPasswordRequest>`, the constraint
  [`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
  declares
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:38`).
  The request arrives at
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:108`),
  which is why a policy failure surfaces as the documented `400`
  (`PasswordResetAuthControllerBase.cs:104`) while a bad token collapses to `401`
  (`PasswordResetAuthControllerBase.cs:97,105`).

### ClaimBasedUserIdProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:11` · Level 8 · class

- **What it is**: a two-line SignalR `IUserIdProvider` that tells the hub infrastructure which user a
  connection belongs to, by reading the identity claim off the connection's principal
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:6-10`).
- **Depends on**: `Microsoft.AspNetCore.SignalR` (`IUserIdProvider`, `HubConnectionContext`) and
  [`ClaimsPrincipalExtensions`](#claimsprincipalextensions) for `FindUserIdValue`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:1-2`).
- **Concept**: `[Rubric §11, Security]` assesses that identity is derived from the validated token and
  never from client-supplied input, and `[Rubric §10, Cross-Cutting]` assesses whether that derivation
  is centralized once. SignalR keys its user-targeted sends on whatever string an `IUserIdProvider`
  returns; the built-in provider reads `ClaimTypes.NameIdentifier`. This framework mints the user id
  only into `sub` (see [`TokenService`](#tokenservice),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:93`), and whether that
  survives as `sub` or arrives mapped to `NameIdentifier` depends on which handler authenticated the
  connection. Routing through the shared extension is what makes both shapes resolve identically, so a
  consumer that changes its inbound claim mapping does not silently start delivering zero
  notifications.
- **Walkthrough**: the entire type is `GetUserId(HubConnectionContext connection)`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:14-15`), an
  expression body returning `connection?.User.FindUserIdValue()`. Two null paths are handled without a
  branch: a null connection short-circuits to `null`, and `FindUserIdValue` is an extension on a
  nullable `ClaimsPrincipal` that returns `null` when neither claim is present
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`). An
  unauthenticated connection therefore has no user id, and SignalR treats it as belonging to no user
  rather than failing connection setup.
- **Why it's built this way**: the value returned here is compared as a *string* against the string a
  sender passes to `Clients.User(...)`, so both sides must format the identifier the same way. The raw
  claim value is used verbatim on this side, and the sender formats with `CultureInfo.InvariantCulture`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs:19`),
  matching the invariant formatting the token writer used
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:93`). Keeping the whole
  provider to one delegating line is what makes that three-way agreement checkable at a glance.
- **Where it's used**: registered as
  `services.TryAddSingleton<IUserIdProvider, ClaimBasedUserIdProvider>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:647`), in the same block
  that swaps the null notification implementations for the SignalR-backed ones (`:630-632`). SignalR's
  connection manager calls it on every connection, and it is what makes
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender) reach the
  right sockets on [`NotificationHub`](group-10-notifications.md#notificationhub)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs:17-21`
  for the single-user send and `:25-34` for the batched multi-user send).

### CurrentUserService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:17` · Level 9 · class

- **What it is**: the per-request implementation of [`ICurrentUserService`](#icurrentuserservice). It
  answers "who is calling" by reading claims off the current HTTP request's principal: the raw
  `ClaimsPrincipal`, the typed user id, the role, and any other parsable claim by name
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:10-16`).
- **Depends on**: [`ICurrentUserService`](#icurrentuserservice) (the Application port) and
  [`ClaimsPrincipalExtensions`](#claimsprincipalextensions) for the identity read
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CurrentUserService.cs:4-5`); externals
  are `Microsoft.AspNetCore.Http.IHttpContextAccessor`, `System.Security.Claims` and
  `System.Globalization`. The claims it reads are the ones [`TokenService`](#tokenservice) writes.
- **Concept introduced: a scoped identity snapshot, computed lazily and parsed invariantly.**
  `[Rubric §3, Clean Architecture]` applies first: application code needs the caller's identity but
  must not reference `HttpContext`, so the port lives in Application and this HTTP-aware implementation
  lives in Infrastructure, which is the only place `IHttpContextAccessor` appears.
  `[Rubric §12, Performance & Scalability]` explains the `Lazy<T>` fields
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:19`, `:21`):
  because the service is registered scoped
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:555`), the claim walk
  happens at most once per request no matter how many handlers, filters and save operations ask.
  `[Rubric §27, i18n]` covers the trap most codebases miss: claim values are machine-written under
  `CultureInfo.InvariantCulture`, so they must be *read* invariantly too, or a request running under a
  culture with different separators misreads decimal, double and `DateTime` claims. Both parse paths
  say so explicitly (`:40`, with the comment at `:38-39`, and the identifier parse inside
  `ClaimsPrincipalExtensions.GetUserId` at
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:43`).
- **Walkthrough**
  - The primary constructor takes `IHttpContextAccessor httpContextAccessor`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:17`) and is
    captured directly by the lazy initializers, so there is no field boilerplate.
  - `_userId`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:19-20`) defers
    to `ClaimsPrincipalExtensions.GetUserId`, which reads `sub` first and falls back to the mapped
    `ClaimTypes.NameIdentifier`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`) before
    parsing into `UserIdentifierType`. That indirection is the reason a JWT-bearer request and a
    session-cookie request resolve to the same user.
  - `_role`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:22-23`) caches
    the first `ClaimTypes.Role` claim.
  - `User` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:26`)
    returns the principal, substituting a fresh empty `ClaimsPrincipal` when there is no HTTP context.
    That fallback is what makes the service safe to resolve from a background job or hosted service:
    callers get an anonymous principal instead of a `NullReferenceException`.
  - `UserId` and `Role`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:29`, `:31`) are
    one-line projections of the two lazies, both nullable, both `null` when unauthenticated.
  - `GetClaimValue<T>(string claimType)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:35-42`) is
    constrained to `T : struct, IParsable<T>` and calls the static abstract `T.TryParse`, so any
    parsable value type (`int`, `Guid`, `DateTime`) can be lifted out of a named claim without Common
    knowing what the claim means. It returns `null` for an absent or unparsable claim, and unlike
    `UserId`/`Role` it is a fresh lookup on every call.
- **Why it's built this way**: scoped lifetime plus `Lazy<T>` yields a stable per-request identity
  snapshot at minimal cost, while the empty-principal fallback keeps the same abstraction usable
  outside a request. Reading identity through the shared extension rather than a hand-rolled
  `FindFirst("sub")` is the load-bearing part: it is what stops a consumer's claim-mapping choice from
  silently emptying the current user
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:9-16`).
- **Where it's used**: registered as
  `services.TryAddScoped<ICurrentUserService, CurrentUserService>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:555`). The
  highest-traffic consumer is
  [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), which takes it as a
  constructor dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:43`,
  `:57`) and passes `UserId` into every save so audit fields are stamped with the acting user (`:248`,
  `:291`, `:330`, `:352`, `:414`);
  [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype)
  accepts it as an optional dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:26`).
  Application handlers in both apps inject the port for ownership checks and caller-scoped queries.
- **Caveats / not-in-source**: this class implements four members. `Roles` and `IsInRole` are default
  interface members on the port
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:45`,
  `:88`), not overridden here, so multi-role behavior is defined on the interface rather than in this
  file. Outside an HTTP request `HttpContext` is null and `UserId` is therefore `null`, which means a
  save performed by a background worker stamps no acting user; nothing in this file substitutes a
  system identity.


---
[⬅ Persistence & EF Core](group-07-persistence-ef-core.md)  •  [Index](00-index.md)  •  [Caching ➡](group-09-caching.md)
