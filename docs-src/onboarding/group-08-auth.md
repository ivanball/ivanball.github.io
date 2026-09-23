# 8. Authentication & Authorization

**What this group covers.** This is the security spine of the framework: how a caller proves who they
are (authentication), how the system decides what they may do (authorization), and how both survive
the jump from a single-process monolith to a fleet of extracted services. Almost every type here
serves one of the clusters below: **minting and validating JWTs**
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
authenticated across a cold navigation. Four further clusters arrived as opt-in identity completions:
**a second factor** ([`ITwoFactorService`](#itwofactorservice) /
[`TotpTwoFactorService`](#totptwofactorservice),
[`ITwoFactorAuthenticator`](#itwofactorauthenticator), [`ITwoFactorStore`](#itwofactorstore),
[`ITwoFactorUserState`](#itwofactoruserstate)); **email confirmation**
([`IEmailConfirmationTokenService`](#iemailconfirmationtokenservice) /
[`EmailConfirmationTokenService`](#emailconfirmationtokenservice),
[`IEmailConfirmableUser`](#iemailconfirmableuser)); **operator-editable permission grants**
([`PermissionGrant`](#permissiongrant), [`IPermissionGrantStore`](#ipermissiongrantstore),
[`LayeredPermissionRegistry`](#layeredpermissionregistry)); and **a user and role administration
API** ([`IUserAdministrationService<TUserDto>`](#iuseradministrationservicetuserdto),
[`IRoleAdministrationService`](#iroleadministrationservice),
[`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice)). Each of
those four is a set of contracts plus an abstract or concrete base behind its own `Add*` call, never a
framework feature with a framework table, so a host that does not opt in pays nothing.

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
revocation for a soft-deleted account), and
[ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) (the second
factor, email confirmation, operator-editable permission grants, and the administration API, all
shipped as contracts and bases behind their own `Add*` calls rather than as framework features). Two
neighbouring records also reach into this chapter by dependency grouping:
[ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html) owns the
`MMCA.Common.Shared.Identifiers` wrapper-struct capability, and
[ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html) owns the
`[FeatureFlag]` lifecycle metadata in `MMCA.Common.Shared.FeatureFlags`. The rubric lenses are dominated by [Rubric §11, Security],
with supporting [Rubric §7, Microservices Readiness] and [Rubric §12, Performance & Scalability]. Auth surfaces
all of its expected failures (bad password, lockout, expired session, rejected reset token) as
[`Result`](group-01-result-error-handling.md#result) failures, never exceptions, so reading the
[Result pattern](group-01-result-error-handling.md#result) first pays off here.

## Tokens: one signing switch, two validation worlds

The framework mints two credentials on every successful sign-in: a short-lived **access token** (a
JWT, 15 minutes by default,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:61`) and an opaque,
random **refresh token** (64 bytes of `RandomNumberGenerator` output, Base64-encoded, valid 7 days by
default, `TokenService.cs:145-148`, `JwtSettings.cs:64`), both produced by
[`TokenService`](#tokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:26`). The access token
carries a fixed claim spine: `sub`, `jti`, `iat`, plus name, email, and role
(`TokenService.cs:103-112`), and the app adds its own claims (for example `speaker_id` or
`customer_id`) through the `additionalClaims` parameter (`TokenService.cs:114-117`). `sub` is the
single carrier of the user identifier: the duplicate custom claim that used to ride alongside it is
gone, because two values that can disagree is two claim names every reader has to know
(`TokenService.cs:100-102`). The port [`ITokenService`](#itokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:8`)
publishes both lifetimes as default interface members pinned to the same 15-minute / 7-day baseline
(`ITokenService.cs:33`, `ITokenService.cs:40`), so a hand-written test double reports the same expiry
the production settings would, while the concrete service derives them from the bound settings
(`TokenService.cs:152`, `TokenService.cs:155`).

The load-bearing design choice is a single configuration switch,
[`JwtSettings`](#jwtsettings)`.SigningAlgorithm`
(`TokenService.cs:77`). It defaults to
[`JwtSigningAlgorithm`](#jwtsigningalgorithm)`.RS256`
(`JwtSettings.cs:30`): the Identity service signs with an RSA private key and every other service
validates against the matching public key, which it fetches over JWKS. A single-host monolith opts
into `HS256` explicitly, where one symmetric Base64 secret both signs and validates because issuer
and validator are the same process (`TokenService.cs:77-88`, `TokenService.cs:207-219`). Asymmetric
is the default precisely because it is the shape that survives extraction: a compromised non-Identity
service can verify tokens but cannot forge them. An issuer with no explicit public key configured
derives one from its own private-key parameters so it can still self-validate during refresh
(`TokenService.cs:243-257`), and the key id from
[`JwksSettings`](#jwkssettings) travels into every RS256 token's
`kid` header so a validator reading the published document selects the right key by name rather than
trying each in turn (`TokenService.cs:236-240`). Key material is materialized once in the constructor
and the owned `RSA` handles are disposed with the service (`TokenService.cs:37-38`,
`TokenService.cs:201-205`), so token operations never re-parse a PEM. The settings class enforces the
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
sets `ValidAlgorithms` to the single configured value (`TokenService.cs:177`) and then re-checks the
token header after `ValidateToken` returns (`TokenService.cs:186-190`). Only the lifetime check is
skipped there (`TokenService.cs:172`), because the method exists to read claims out of an
already-expired token during refresh.

## The shared authentication workflow

Login, registration, refresh, revocation, and device listing are not re-implemented per app. They
live once in [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74`), an abstract
base each app's Identity module seals over its concrete `User` aggregate. The base owns the sequence;
the sealed subclass supplies the genuinely app-specific pieces through abstract and virtual hooks:
`FindUntrackedByEmailAsync` and `EmailExistsAsync` (written against the concrete `User` so EF
translation is unchanged, `AuthenticationServiceBase.cs:585`, `AuthenticationServiceBase.cs:591`),
`CreateUser` (`AuthenticationServiceBase.cs:594`), `CreateAccessToken`
(`AuthenticationServiceBase.cs:597`), the two optional candidate gates
(`AuthenticationServiceBase.cs:691-696`), the post-commit `OnUserRegisteredAsync`
(`AuthenticationServiceBase.cs:702`), and the overridable "refresh user vanished" error
(`AuthenticationServiceBase.cs:710`, 401 by default because a token for a deleted user is
indistinguishable from an invalid one). Both token lifetimes are read from
[`ITokenService`](#itokenservice) with a defensive fallback to the 15-minute / 7-day baseline for a
misconfigured host or a test double (`AuthenticationServiceBase.cs:137-146`).

`LoginAsync` (`AuthenticationServiceBase.cs:156`) shows the shape. It validates the request first,
then runs the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
lockout check (`AuthenticationServiceBase.cs:168`), then does the **dual-fetch**: an untracked,
no-change-tracking query to verify the password cheaply (`AuthenticationServiceBase.cs:179`,
`AuthenticationServiceBase.cs:210`), and only on success a second *tracked* re-fetch of the instance
the app's `CreateAccessToken` hook mints from, which is also what turns a race that deleted the
account between the two steps into a clean 404 (`AuthenticationServiceBase.cs:228-237`). The email is
normalized through the [`Email`](group-02-domain-building-blocks.md#email) value object before the
query so the EF predicate compares same-typed converted values
(`AuthenticationServiceBase.cs:176`). Soft-deleted accounts fall out through EF global query filters
and return the same generic 401 as a wrong password (`AuthenticationServiceBase.cs:180-192`), so the
API never reveals whether an email exists, and a successful login clears the attempt counters
(`AuthenticationServiceBase.cs:240`) before handing off to the shared token-issue path
(`AuthenticationServiceBase.cs:245`).

`RegisterAsync` (`AuthenticationServiceBase.cs:254`) rate-limits by source IP, rejects a duplicate
email as a conflict, hashes the password, saves, and only then runs the app's post-commit hook, counts
the registration, and opens the session (`AuthenticationServiceBase.cs:266-330`). The up-front email
check is a check-then-act, so two concurrent registrations for the same address both pass it and the
loser only fails on the insert. The save is therefore wrapped in a deliberately broad catch that
re-checks the address and, if it now exists, returns the *same* conflict the serialized path would
have produced, rethrowing anything else (`AuthenticationServiceBase.cs:291-319`); the shared failure
factory keeps the two paths indistinguishable to the caller (`AuthenticationServiceBase.cs:915`). The
catch is broad because the Application layer has no EF Core dependency by layer rule and cannot name
`DbUpdateException`; the re-check is what narrows it, and it deliberately runs on
`CancellationToken.None` so a cancelled save can still be classified
(`AuthenticationServiceBase.cs:313`). `RefreshTokenAsync` (`AuthenticationServiceBase.cs:334`)
extracts claims from the *expired* access token (signature still verified, only lifetime skipped,
`AuthenticationServiceBase.cs:347`), reads the identifier off `sub` through
[`ClaimsPrincipalExtensions`](#claimsprincipalextensions) (`AuthenticationServiceBase.cs:358`), and
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
(`AuthenticationServiceBase.cs:742-749`, `AuthenticationServiceBase.cs:844-854`). The three
rejections behind the single generic error are deliberately different in what they *do*
(`AuthenticationServiceBase.cs:714-754`): an unknown hash, or one belonging to another account, is
failed alone, since revoking the family on it would let anyone holding one of this user's expired
access tokens sign them out everywhere by posting a random string; a revoked row revokes the family;
an expired row is an ordinary end of life, so that device re-authenticates while the others keep
working. Two requests presenting the same still-live token are covered by the same rule: rotation is
claimed atomically through [`IRefreshSessionStore`](#irefreshsessionstore)`.TryRotateAsync`
(`AuthenticationServiceBase.cs:824-838`), and the request that loses the claim is answered exactly
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
together (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:160-166`).

The workflow around the port is small and worth reading end to end.
`IssueTokensAsync` (`AuthenticationServiceBase.cs:554`) opens the session *before* it mints the access
token, because the token carries the session's id and a session only has an id once it has been
created (`AuthenticationServiceBase.cs:564-578`); `OpenSessionAsync`
(`AuthenticationServiceBase.cs:762`) mints the refresh token, builds the row, and first enforces the
per-user cap by revoking the oldest live sessions
(`AuthenticationServiceBase.cs:784`, `AuthenticationServiceBase.cs:864-877`), so one account cannot
grow the table without bound while a legitimate sign-in never fails. Both helpers return
[`IssuedSession`](#issuedsession) (`AuthenticationServiceBase.cs:924`), the private pair of "the
plaintext token, which exists nowhere else" and "the row id". The id reaches the client as the
standard `sid` claim, stamped by [`SessionStampingTokenService`](#sessionstampingtokenservice)
(`AuthenticationServiceBase.cs:936`), a pass-through `ITokenService` armed for the duration of the
app's `CreateAccessToken` call (`AuthenticationServiceBase.cs:618-651`,
`AuthenticationServiceBase.cs:792-802`). Doing it with a wrapper rather than by changing the hook's
signature is what makes the claim additive: every existing subclass keeps compiling and starts
emitting `sid` with no edit. `GetSessionsAsync` (`AuthenticationServiceBase.cs:481`) projects the
user's live sessions into [`RefreshSessionSummaryResponse`](#refreshsessionsummaryresponse)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:23`), newest first,
flagging the caller's own device by comparing against the token's `sid`
(`AuthenticationServiceBase.cs:489-502`); the response deliberately omits the token hash and the
rotation link, since nothing a client does with a session needs anything but its id
(`RefreshSessionSummaryResponse.cs:6-11`). `RevokeSessionByIdAsync`
(`AuthenticationServiceBase.cs:519`) signs one device out and treats an already-revoked row as a
success that writes nothing, because a device list clicked twice is the most ordinary duplicate in the
feature (`AuthenticationServiceBase.cs:532-537`), while `RevokeTokenAsync`
(`AuthenticationServiceBase.cs:416`) degrades to signing every device out when the presented token does
not identify a live session of this user's (`AuthenticationServiceBase.cs:429-447`). Those methods
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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:168-175`), and the mapping
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:36`),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
[`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:43`),
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
`CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:64`) to close the timing side channel.
PBKDF2 is now the *only* path: the legacy single-round HMAC branch, and with it the algorithm
selection keyed on stored salt length, is gone
([ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html)), so one
algorithm derives and verifies every stored credential (`PasswordHasher.cs:7-10`,
`PasswordHasher.cs:68-74`). That is a compact [Rubric §11, Security] story: a modern KDF and a
constant-time compare in one small type, all behind the [`IPasswordHasher`](#ipasswordhasher) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:6`) so
the algorithm can be strengthened without touching an Application handler.

[`LoginProtectionService`](#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19`) adds the
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) gates on
top, backed by [`ICacheService`](group-09-caching.md#icacheservice) rather than a database so the
counters are cheap and self-expiring. Counter keys are built from an `Email`-normalized identity
(`LoginProtectionService.cs:34-36`), so `User@x.com`, `user@x.com`, and a padded variant collapse onto
one lockout instead of handing an attacker three independent budgets. The normalization itself lives
once, in the internal [`EmailIdentity`](#emailidentity) helper
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailIdentity.cs:12`), which every
cache-keyed auth service calls: a valid address becomes the `Email` value object's normalized value,
and a malformed one (which never matches a user but can still mint a key) falls back to the same
trim-and-lowercase shape so its attempts land on one key too (`EmailIdentity.cs:22-30`). After
[`LoginProtectionSettings`](#loginprotectionsettings)`.MaxFailedAttempts` consecutive failures
(default 5,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:18`) it applies an
exponential-backoff lockout capped at `MaxLockoutSeconds` (default 300,
`LoginProtectionSettings.cs:24`), with a deliberately clamped shift exponent so a persistent attacker
cannot wrap the TTL back to something small (`LoginProtectionService.cs:77`), and it rate-limits
registrations per source IP (default 10 per 60-minute window, `LoginProtectionSettings.cs:37-43`,
`LoginProtectionService.cs:90-125`). Every setting carries a `[Range]` attribute, which is what makes
the clamp argument airtight: `MaxLockoutSeconds` cannot exceed 3600 (`LoginProtectionSettings.cs:23`),
and `1 << 30` already dwarfs that. The [`ILoginProtectionService`](#iloginprotectionservice) port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`) is what the
workflow depends on, and it calls the gates at exactly the right points (increment on failed login,
reset on success), so the protection is centralized rather than sprinkled through each app's
controller. One documented trade-off is stated in source: the attempt increment is a
read-modify-write rather than an atomic counter, because the native Redis `INCR` path wrote a key shape
`IDistributedCache` could not read back (`LoginProtectionService.cs:55-63`). Sequential guessing, which
is what a credential-stuffing run looks like, still trips the lockout.

## The second factor: one optional step in the same sign-in

Two-factor authentication ships as contracts plus a stateless implementation, never as a feature that
turns itself on: the account row belongs to the app, and making a second factor mandatory would be a
behavior change in a deployed system
([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)). The
cryptography lives in [`ITwoFactorService`](#itwofactorservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorService.cs:16`) and its
implementation [`TotpTwoFactorService`](#totptwofactorservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TotpTwoFactorService.cs:35`): mint
a Base32 shared secret (`TotpTwoFactorService.cs:40-41`), render the `otpauth://totp/...` provisioning
URI an authenticator app is keyed from (`TotpTwoFactorService.cs:44`, `TotpTwoFactorService.cs:54`),
verify a code inside the configured skew window (`TotpTwoFactorService.cs:58`), and generate and match
single-use recovery codes (`TotpTwoFactorService.cs:87`, `TotpTwoFactorService.cs:116`). It is
deliberately stateless and persistence-free, so a data migration enrolling existing accounts can call
it directly and every method is testable against a fixed clock (`ITwoFactorService.cs:10-15`). Recovery
codes travel as a [`RecoveryCodeSet`](#recoverycodeset) (`ITwoFactorService.cs:84`), plaintext and
hashes paired positionally so a caller cannot store one set and display another, and the plaintext
exists only in the returned value. Matching compares in fixed time through
`CryptographicOperations.FixedTimeEquals` with no early exit (`TotpTwoFactorService.cs:138`), and the
codes are Base32 rather than Base64 because that alphabet has no case ambiguity for a user reading one
off paper (`TotpTwoFactorService.cs:94-96`).

[`TwoFactorSettings`](#twofactorsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/TwoFactorSettings.cs:15`) binds from
`Authentication:TwoFactor` (`TwoFactorSettings.cs:18`) and defaults to the RFC 6238 values every
authenticator app assumes: six digits (`TwoFactorSettings.cs:30`), a thirty-second step
(`TwoFactorSettings.cs:34`), one step of tolerated skew on each side, which widens the accepted window
to roughly ninety seconds (`TwoFactorSettings.cs:46`), a twenty-byte secret
(`TwoFactorSettings.cs:61`), and ten recovery codes of ten random bytes each
(`TwoFactorSettings.cs:50`, `TwoFactorSettings.cs:57`). They are configurable so a host can match an
existing enrollment base, not because moving them is a good idea: an app keyed against one period
cannot read codes minted with another (`TwoFactorSettings.cs:9-14`).

State is the app's, so it is reached through two contracts rather than a framework table.
[`ITwoFactorUserState`](#itwofactoruserstate)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ITwoFactorUserState.cs:27`) is what the app's `User`
exposes: the enabled flag, the Base32 secret, and the unspent recovery-code hashes
(`ITwoFactorUserState.cs:30`, `ITwoFactorUserState.cs:36`, `ITwoFactorUserState.cs:42`). The
load-bearing invariant is stated on the interface itself: a stored secret is not an enabled second
factor, because starting an enrollment writes the secret while the flag stays false, so an enrollment
the user abandons half way can never gate a later sign-in (`ITwoFactorUserState.cs:22-25`).
[`ITwoFactorStore`](#itwofactorstore)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorStore.cs:24`) is the matching
persistence port, split along that invariant: `StartEnrollmentAsync` stores the secret without
activating anything (`ITwoFactorStore.cs:44`), `CompleteEnrollmentAsync` activates it and stores the
first recovery hashes only after a code minted from that secret has verified (`ITwoFactorStore.cs:54`),
`DisableAsync` clears both so a later enrollment starts from a fresh secret rather than reviving an old
one (`ITwoFactorStore.cs:66`), and the recovery set is replaced wholesale or spent one code at a time
(`ITwoFactorStore.cs:76`, `ITwoFactorStore.cs:93`). Every mutating member returns a
[`Result`](group-01-result-error-handling.md#result) so an aggregate that refuses can say so without an
exception crossing the layer, and implementations save their own work, because a workflow treats one
call's result as final (`ITwoFactorStore.cs:13-22`). The framework ships no EF implementation here the
way it does for refresh sessions, because the secret and the hashes belong to the app's user row
(`ITwoFactorStore.cs:6-10`).

The sign-in hook is a third contract, [`ITwoFactorAuthenticator`](#itwofactorauthenticator)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorAuthenticator.cs:24`), and it
is a separate collaborator on purpose:
[`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) takes it as an *optional*
constructor dependency, so an app that has not adopted the second factor passes nothing and its
sign-in does not even pay a query (`ITwoFactorAuthenticator.cs:13-16`). The challenge runs *after* the
password check, for the same reason the account-state gate does: reaching it proves the caller owns the
credential, so answering "this account needs a second factor" tells the owner something rather than
telling an address sweeper which accounts are protected (`ITwoFactorAuthenticator.cs:19-21`). The
shipped [`TwoFactorAuthenticator`](#twofactorauthenticator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs:25`) reads
the state and returns [`TwoFactorOutcome`](#twofactoroutcome)`.NotEnrolled` when there is no active
factor, so an unenrolled account's sign-in is unchanged (`TwoFactorAuthenticator.cs:40`,
`ITwoFactorAuthenticator.cs:47`); otherwise it verifies a TOTP code (`TwoFactorAuthenticator.cs:53`),
falls back to matching and spending a recovery code (`TwoFactorAuthenticator.cs:56`,
`TwoFactorAuthenticator.cs:71`), and fails with one of the two [`TwoFactorErrors`](#twofactorerrors)
codes: `Authentication.TwoFactorRequired` when a code was needed and none arrived,
`Authentication.TwoFactorInvalid` when one arrived and did not verify
(`TwoFactorAuthenticator.cs:48`, `TwoFactorAuthenticator.cs:60`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/TwoFactorErrors.cs:18`,
`TwoFactorErrors.cs:21`). Which method satisfied the challenge is what the issued token records:
[`AuthClaimTypes`](#authclaimtypes) names the `mfa` claim and its two values, `otp` and `recovery`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:62`, `AuthClaimTypes.cs:65`,
`AuthClaimTypes.cs:68`), read back through
[`ClaimsPrincipalExtensions`](#claimsprincipalextensions)`.HasMultiFactor` and `FindMultiFactorMethod`
(`ClaimsPrincipalExtensions.cs:127`, `ClaimsPrincipalExtensions.cs:137`), which is how a presence check
stays out of [`ICurrentUserService`](#icurrentuserservice). The wire shapes are
[`TwoFactorCodeRequest`](#twofactorcoderequest) with its
[`TwoFactorCodeRequestValidator`](#twofactorcoderequestvalidator),
[`TwoFactorSetupResponse`](#twofactorsetupresponse) and
[`TwoFactorRecoveryCodesResponse`](#twofactorrecoverycodesresponse).

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
  (`PasswordResetTokenService.cs:40`, `PasswordResetTokenService.cs:77`), so requesting a new link
  retires the previous one.
- **Hashed at rest.** Only the Base64 of the token's SHA-256 is stored
  (`PasswordResetTokenService.cs:44-45`, `PasswordResetTokenService.cs:71-77`), so a cache dump hands
  out no working reset links, and the comparison on redemption is constant time through
  `CryptographicOperations.FixedTimeEquals` (`PasswordResetTokenService.cs:107`).
- **An attempt cap.** A wrong token increments a counter on the record, and the record is discarded at
  `MaxValidationAttempts` (`PasswordResetTokenService.cs:121-142`, default 5,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:36`). The rewrite
  after a wrong guess uses the record's *remaining* lifetime rather than a fresh one
  (`PasswordResetTokenService.cs:135-141`), so guessing cannot extend the redeemable window.
- **A per-email request throttle.** A counter carrying the window's TTL caps how often one address can
  trigger an email (`PasswordResetTokenService.cs:55-66`, default 3 per 60 minutes,
  `PasswordResetSettings.cs:40`, `PasswordResetSettings.cs:44`), and a successful redemption deletes
  the token *and* that counter (`PasswordResetTokenService.cs:115-116`) so a legitimate reset does not
  leave the user throttled out of a later one.

Keys are built from an `Email`-normalized identity, through the same
[`EmailIdentity`](#emailidentity) helper and for the same reason
[`LoginProtectionService`](#loginprotectionservice) does it
(`PasswordResetTokenService.cs:34-42`). The cached record, [`PasswordResetEntry`](#passwordresetentry)
(`PasswordResetTokenService.cs:160`), is deliberately all JSON primitives: cache values round-trip
through `System.Text.Json`, so a value object or a `byte[]` member would not survive a distributed
backing store (`PasswordResetTokenService.cs:151-155`). Token material is 32 random bytes, Base64Url
encoded (`PasswordResetTokenService.cs:30`, `PasswordResetTokenService.cs:68`), redeemable for
`TokenLifetimeMinutes` (default 30, `PasswordResetSettings.cs:29`), and every rejection (unknown,
expired, mismatched, attempt-capped) collapses into one generic failure
(`PasswordResetTokenService.cs:144-148`). The settings bind from the `PasswordReset` configuration
section and the service is registered scoped in Infrastructure DI (`PasswordResetSettings.cs:13`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:154-158`).

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
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:43`)
consumes the token *before* the save on a stated trade-off (leaving it live until the write succeeds
opens a replay window; a token burned by a later invariant failure costs the user one more reset
request, `ResetPasswordHandlerBase.cs:73-83`), hashes through [`IPasswordHasher`](#ipasswordhasher)
and writes the credential through the aggregate's `ChangePassword`
(`ResetPasswordHandlerBase.cs:94-95`), then clears the login-protection counters so a user who reset
*because* of a lockout is not left locked out (`ResetPasswordHandlerBase.cs:110`).
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

## Email confirmation: the same token shape, a different prefix

Confirming an address is the forgot-password flow's twin, and it is built that way on purpose: member
for member, [`IEmailConfirmationTokenService`](#iemailconfirmationtokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/IEmailConfirmationTokenService.cs:15`)
mirrors the reset port, with `IssueAsync` minting a token for an address and account
(`IEmailConfirmationTokenService.cs:28`) and `ValidateAndConsumeAsync` redeeming it exactly once and
returning the confirmed account's identifier (`IEmailConfirmationTokenService.cs:41`). The
implementation [`EmailConfirmationTokenService`](#emailconfirmationtokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:35`) rides on
[`ICacheService`](group-09-caching.md#icacheservice) under its own key prefix and buys the same four
properties: 32 random bytes Base64Url encoded (`EmailConfirmationTokenService.cs:39`,
`EmailConfirmationTokenService.cs:64`), only the token's SHA-256 stored
(`EmailConfirmationTokenService.cs:130`), a constant-time comparison on redemption
(`EmailConfirmationTokenService.cs:103`), and every rejection collapsed into one generic failure
(`EmailConfirmationTokenService.cs:155-157`). Its token and request-counter keys go through the same
[`EmailIdentity`](#emailidentity) normalization as the reset keys
(`EmailConfirmationTokenService.cs:125`, `EmailConfirmationTokenService.cs:127`). The cached record is
[`EmailConfirmationEntry`](#emailconfirmationentry) (`EmailConfirmationTokenService.cs:169`), JSON
primitives only for the same round-trip reason [`PasswordResetEntry`](#passwordresetentry) is.

[`EmailConfirmationSettings`](#emailconfirmationsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/EmailConfirmationSettings.cs:10`)
binds from `Authentication:EmailConfirmation` (`EmailConfirmationSettings.cs:13`) and differs from the
reset settings where the use case does: the token is redeemable for a day rather than half an hour
(`TokenLifetimeMinutes` default 1440, `EmailConfirmationSettings.cs:29`), because a confirmation mail
is commonly opened much later, while the attempt cap (5, `EmailConfirmationSettings.cs:36`) and the
per-address request throttle (3 per 60 minutes, `EmailConfirmationSettings.cs:40`,
`EmailConfirmationSettings.cs:44`) match. The gate is `RequireConfirmedEmail`
(`EmailConfirmationSettings.cs:55`), off unless a host sets it *and* the app's user implements
[`IEmailConfirmableUser`](#iemailconfirmableuser)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IEmailConfirmableUser.cs:22`), a two-member contract:
the `IsEmailConfirmed` flag and a `Result`-returning `ConfirmEmail()` that writes it through the
aggregate (`IEmailConfirmableUser.cs:25`, `IEmailConfirmableUser.cs:33`). A user type that does not
implement the interface is never asked about confirmation (`IEmailConfirmableUser.cs:12`), which is
what keeps the feature inert for the apps that have not adopted it. The two failures are named in
[`EmailConfirmationErrors`](#emailconfirmationerrors)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/EmailConfirmationErrors.cs:9`):
`Authentication.EmailNotConfirmed` for a sign-in blocked by the gate and
`Authentication.InvalidConfirmationToken` for every rejected redemption
(`EmailConfirmationErrors.cs:12`, `EmailConfirmationErrors.cs:15`, `EmailConfirmationErrors.cs:25`,
`EmailConfirmationErrors.cs:33`). The requests are
[`SendEmailConfirmationRequest`](#sendemailconfirmationrequest) and
[`ConfirmEmailRequest`](#confirmemailrequest), guarded by
[`SendEmailConfirmationRequestValidator`](#sendemailconfirmationrequestvalidator) and
[`ConfirmEmailRequestValidator`](#confirmemailrequestvalidator). A sibling constant class,
[`AuthErrorCodes`](#autherrorcodes)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthErrorCodes.cs:12`), names the one authentication
outcome a *client* has to branch on rather than merely display, `Auth.EmailAlreadyExists`
(`AuthErrorCodes.cs:19`), returned identically by the registration pre-check and by the unique-index
race recovery so the two paths stay indistinguishable.

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
(`ClaimsPrincipalExtensions.cs:109-113`). [`AuthClaimTypes`](#authclaimtypes)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:9`) names the three claim types
this group cares about: the framework-custom `"permission"` (`AuthClaimTypes.cs:24`) used by the
authorization model below, plus the standard `sub` (`AuthClaimTypes.cs:34`) and `sid`
(`AuthClaimTypes.cs:47`), each documented with the pipeline caveat that motivates reading it through
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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14`,
`AuthorizationExtensions.cs:60`) wires the whole mechanism: the permission handler and the on-demand
policy provider (`AuthorizationExtensions.cs:69-71`), the shared registry, built once and exposed
under both [`IPermissionRegistry`](#ipermissionregistry) and
[`IPermissionCatalog`](#ipermissioncatalog) (`AuthorizationExtensions.cs:126-127`,
`AuthorizationExtensions.cs:133-134`), and the fallback policy described at the end of this section.
Role *names* still exist as data, but the framework ships no constant class naming them: roles get a
value-object base, [`RoleValue`](#rolevalue)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:26`), so each app can fix its own role
set with case-insensitive, type-guarded equality (`RoleValue.cs:91-97`), a frozen interned lookup
(`RoleValue.cs:76-85`), and `Result`-returning validation (`RoleValue.cs:43`) while staying
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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`),
which grants access when the principal holds the permission directly (a `permission` claim) *or*
derives it from one of its roles via [`IPermissionRegistry`](#ipermissionregistry)
(`PermissionAuthorizationHandler.cs:30-32`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:14`), reading the
caller's roles through [`ClaimsPrincipalExtensions`](#claimsprincipalextensions)`.GetRoleValues`
(`PermissionAuthorizationHandler.cs:30`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:59`), which is the one
place the three claim-type spellings the JWT middleware may produce are reconciled. The registry itself
([`PermissionRegistry`](#permissionregistry),
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:16`) is an immutable, frozen
role-to-permission map with case-insensitive role keys and ordinal permission values
(`PermissionRegistry.cs:33-36`) built by
[`PermissionRegistryBuilder`](#permissionregistrybuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:8`); each module
contributes only its own grants through `AddPermissions(...)`
(`AuthorizationExtensions.cs:103`), duplicate grants union rather than collide
(`PermissionRegistryBuilder.cs:34`), and the shared registry is built lazily on first resolve, after
every module has registered (`AuthorizationExtensions.cs:127`, `PermissionRegistryBuilder.cs:46`). The
same instance answers as [`IPermissionCatalog`](#ipermissioncatalog)
(`PermissionRegistry.cs:16`, `PermissionRegistry.cs:55`, `PermissionRegistry.cs:58`), explicitly
implemented because a catalog's flat list of permission names and the registry's per-role lookup are
different questions that would otherwise share a member name. That module-local contribution is the
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:123`). It grants nothing, so a
permission-gated request is *denied* rather than allowed (`UnconfiguredPermissionRegistry.cs:37`,
`UnconfiguredPermissionRegistry.cs:44`), and it says so exactly once, through an interlocked one-shot
flag, in a log message naming the call that would fix it (`UnconfiguredPermissionRegistry.cs:25`,
`UnconfiguredPermissionRegistry.cs:60`, `UnconfiguredPermissionRegistry.cs:68`). The warning is
deferred to the first real check rather than raised at startup, because a host with no
permission-gated request is correctly configured: it simply never needs a registry
(`UnconfiguredPermissionRegistry.cs:13-19`). Fail-closed plus a
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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:13`) whose
defaults preserve the original `customer_id` / `Admin` / `id` behavior
(`OwnerOrAdminFilterOptions.cs:16-31`,
[ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)), with
[`OwnershipHelper`](#ownershiphelper)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10`) supplying both
the bypass-role check (`OwnershipHelper.cs:17`) and the query-scoping specification factory that
controllers use to narrow *collection* endpoints to the caller's own rows
(`OwnershipHelper.cs:34-67`).

Compiled grants are the baseline, not the ceiling. A host that needs an operator to move a capability
between roles without a redeploy calls `AddStoredPermissionGrants(configuration)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:104`), which binds
[`PermissionGrantSettings`](#permissiongrantsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/PermissionGrantSettings.cs:12`,
bound at `DependencyInjection.Auth.cs:106-109`), registers the EF-backed
[`IPermissionGrantStore`](#ipermissiongrantstore) (`DependencyInjection.Auth.cs:114`), and decorates the
compiled registry with [`LayeredPermissionRegistry`](#layeredpermissionregistry)
(`DependencyInjection.Auth.cs:135-146`). The layering rule is a union with **no deny row**: a role holds a
permission when either the compiled registry or the stored grants say so
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/LayeredPermissionRegistry.cs:30`,
`LayeredPermissionRegistry.cs:55-65`), so a bad edit can add a capability but can never take away one
an endpoint's own module declared. Because `HasPermission` is synchronous, the stored half cannot be
read from the database on the hot path: [`IPermissionGrantCache`](#ipermissiongrantcache)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/IPermissionGrantCache.cs:21`) is the
boundary over an in-memory snapshot, refreshed on demand (`IPermissionGrantCache.cs:37`,
`IPermissionGrantCache.cs:11-19`), and
[`IPermissionGrantCacheInvalidator`](#ipermissiongrantcacheinvalidator) (`IPermissionGrantCache.cs:51`,
`IPermissionGrantCache.cs:59`) is what an edit calls. The consequence a host accepts is that a grant
edit reaches other replicas within `CacheSeconds` (default 300, `PermissionGrantSettings.cs:23`), with
`DataSourceName` naming the one database that carries the rows (`PermissionGrantSettings.cs:31`),
exactly as [`RefreshSessionSettings`](#refreshsessionsettings) does. The row itself,
[`PermissionGrant`](#permissiongrant)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/PermissionGrant.cs:24`), is a two-column identity
(`PermissionGrant.cs:39`, `PermissionGrant.cs:45`) trimmed and length-validated in a
`Result`-returning factory (`PermissionGrant.cs:64`, widths at `PermissionGrant.cs:27` and
`PermissionGrant.cs:30`), and its table is mapped only for the host that opted in, through a model gate
whose mere registration is the opt-in the context reads (`DependencyInjection.Auth.cs:112`).

The administration API sits on top of the same grants.
[`IRoleAdministrationService`](#iroleadministrationservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IRoleAdministrationService.cs:29`)
lists roles, reads one role, returns the catalog of role and permission names, and replaces a role's
*stored* grants (`IRoleAdministrationService.cs:37`, `IRoleAdministrationService.cs:45`,
`IRoleAdministrationService.cs:58`, `IRoleAdministrationService.cs:72`); it ships filled in as
[`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:45`,
its four methods at `:54`, `:80`, `:93`, `:120`) because both halves of that surface are
framework-owned. The user half cannot be:
[`IUserAdministrationService<TUserDto>`](#iuseradministrationservicetuserdto)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IUserAdministrationService.cs:24`)
is generic in the app's own DTO, constrained by the marker [`IUserAdminDTO`](#iuseradmindto)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Administration/IUserAdminDTO.cs:15`), and each app
implements listing, reading, locking and role assignment over its own `User`
(`IUserAdministrationService.cs:32`, `IUserAdministrationService.cs:42`,
`IUserAdministrationService.cs:57`, `IUserAdministrationService.cs:66`), with
[`UserAdministrationQuery`](#useradministrationquery) (`IUserAdministrationService.cs:79`) carrying the
paging and filter arguments. The two capabilities that gate the whole surface are named once in
[`AdministrationPermissions`](#administrationpermissions)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:15`):
`users:manage` and `roles:manage` (`AdministrationPermissions.cs:18`, `AdministrationPermissions.cs:21`).
The wire shapes are [`SetUserRolesRequest`](#setuserrolesrequest),
[`SetRolePermissionsRequest`](#setrolepermissionsrequest),
[`RolePermissionsResponse`](#rolepermissionsresponse) and
[`PermissionCatalogResponse`](#permissioncatalogresponse), each guarded by its own FluentValidation
rule ([`SetUserRolesRequestValidator`](#setuserrolesrequestvalidator),
[`SetRolePermissionsRequestValidator`](#setrolepermissionsrequestvalidator)).

The last piece of the authorization wiring is defensive rather than declarative.
`AddAuthorizationPolicies()` installs a **fallback policy**, so an endpoint carrying no authorization
metadata at all is denied rather than served. The requirement is its own type,
[`FallbackAuthorizationRequirement`](#fallbackauthorizationrequirement)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationRequirement.cs:16`),
and [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:15`)
grants it to an authenticated caller or to a request whose path matches one of the exempt prefixes
(`FallbackAuthorizationHandler.cs:26-28`). A bare `RequireAuthenticatedUser()` would not do, because a
Blazor host maps endpoint-routed static and framework surfaces that carry no metadata of their own and
would be gated along with everything else (`FallbackAuthorizationRequirement.cs:11-15`), which is why
the requirement is path-aware. [`FallbackAuthorizationOptions`](#fallbackauthorizationoptions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:14`)
carries the `Enabled` switch (on by default, `FallbackAuthorizationOptions.cs:52`) and the editable
exempt-prefix list seeded from the framework defaults (`FallbackAuthorizationOptions.cs:61`); the
handler is registered with `TryAddEnumerable` and the policy attached only while the switch is set
(`AuthorizationExtensions.cs:80-81`, `AuthorizationExtensions.cs:86-89`).

## Session cookies: keeping SSR authenticated

The final cluster solves a Blazor-specific problem: an interactive Blazor app keeps its access token in
browser memory, but a *cold* server-side render (a new tab, an F5, an external deep link) has no memory
to read, so an `[Authorize]` page would bounce to `/login` before the interactive phase starts. The fix
is a pair of HttpOnly cookies (`mmca_auth_access`, `mmca_auth_refresh`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:17-18`)
seeded and cleared from JS through [`SessionCookieEndpoints`](#sessioncookieendpoints)
(`SessionCookieEndpoints.cs:15`, `SessionCookieEndpoints.cs:34-44`, request body
[`SessionCookieRequest`](#sessioncookierequest) at `SessionCookieEndpoints.cs:77`), written with one
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
(`SessionCookieEndpoints.cs:50-65`), guarded by `SameSite=Lax` plus a `Sec-Fetch-Site` cross-site
rejection (`SessionCookieEndpoints.cs:53-56`, `SessionCookieEndpoints.cs:73-75`) and returning
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
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:8`) holds the single flag name
`Privacy.DataExport` (`PrivacyFeatures.cs:12`) that keeps the whole surface off until a host turns it
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:250`),
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

Two further Shared clusters land here the same way. The **feature-flag lifecycle metadata** closes the
flag-debt trade-off of
[ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html):
[`FeatureFlagAttribute`](#featureflagattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32`) is applied to the
`public const string` fields of a `*Features` class (`FeatureFlagAttribute.cs:9`,
`FeatureFlagAttribute.cs:31`) and carries a [`FeatureFlagLifetime`](#featureflaglifetime)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagLifetime.cs:9`), an optional
`RemoveBy` date in a fixed `yyyy-MM-dd` format, and an owner (`FeatureFlagAttribute.cs:35`,
`FeatureFlagAttribute.cs:38`, `FeatureFlagAttribute.cs:46`, `FeatureFlagAttribute.cs:52`). The
distinction is the whole point: a `Permanent` flag is a capability a host chooses to run with or
without and must *not* carry a removal date, while a `Temporary` one exists only until a migration or
experiment finishes, must carry one, and fails the build once that date has passed
(`FeatureFlagLifetime.cs:11-20`). [`FeatureFlagRegistry`](#featureflagregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:35`) is the runtime
half, reflecting over assemblies to project every declared flag into a
[`FeatureFlagDescriptor`](#featureflagdescriptor) (`FeatureFlagRegistry.cs:17`,
`FeatureFlagRegistry.cs:46`, `FeatureFlagRegistry.cs:64`) with the two recognizers the fitness rules
also use (`FeatureFlagRegistry.cs:77`, `FeatureFlagRegistry.cs:91`).
[`PrivacyFeatures`](#privacyfeatures) above is one of the framework's own annotated flags.

The **strongly typed identifier** capability is the opt-in wrapper struct of
[ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html), shipped
complete and adopted by nothing, with the
[ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html) primitive
aliases left as the default. [`IStronglyTypedId<TSelf, TValue>`](#istronglytypedidtself-tvalue)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`) is two members, a
`Value` getter and a `static abstract From` (`IStronglyTypedId.cs:65`, `IStronglyTypedId.cs:72`), so a
wrapper is a positional `readonly record struct` plus one factory line; `IParsable<TSelf>` arrives as
*explicit* default implementations, which is the only form an inherited static abstract member allows,
so `OrderId.Parse(...)` does not compile and every framework boundary parses through the interface
(`IStronglyTypedId.cs:25-36`). The static helper [`StronglyTypedId`](#stronglytypedid)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedId.cs:19`) is what those
boundaries call: `Parse`/`TryParse` (`StronglyTypedId.cs:40`, `StronglyTypedId.cs:63`), the
`CanParseValues` and `GetValueType`/`IsStronglyTypedId` reflection probes (`StronglyTypedId.cs:85`,
`StronglyTypedId.cs:97`, `StronglyTypedId.cs:108`), and `TryDescribe` (`StronglyTypedId.cs:118`), with
the per-primitive delegate cache
[`StronglyTypedIdValueParser<TValue>`](#stronglytypedidvalueparsertvalue) and its
[`StronglyTypedIdValueParserDelegate<TValue>`](#stronglytypedidvalueparserdelegatetvalue)
(`StronglyTypedId.cs:173`, `StronglyTypedId.cs:161`) keeping the reflection off the hot path. Each
boundary then gets one adapter: JSON through
[`StronglyTypedIdJsonConverterFactory`](#stronglytypedidjsonconverterfactory) and its private
[`StronglyTypedIdConverter<TSelf, TValue>`](#stronglytypedidconvertertself-tvalue)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdJsonConverterFactory.cs:22`,
`StronglyTypedIdJsonConverterFactory.cs:25`, `StronglyTypedIdJsonConverterFactory.cs:38`), MVC route
and query binding through [`StronglyTypedIdTypeConverter<TSelf, TValue>`](#stronglytypedidtypeconvertertself-tvalue)
and the [`StronglyTypedIdTypeConverters`](#stronglytypedidtypeconverters) registrar
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdTypeConverter.cs:21`,
`StronglyTypedIdTypeConverter.cs:82`, `StronglyTypedIdTypeConverter.cs:89`,
`StronglyTypedIdTypeConverter.cs:108`), object mapping through
[`StronglyTypedIdMappings<TSelf, TValue>`](#stronglytypedidmappingstself-tvalue), whose four *static*
methods are the contract because Mapperly discovers them by signature on a closed generic type
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdMappings.cs:31`,
`StronglyTypedIdMappings.cs:38-53`), and discovery through
[`StronglyTypedIdRegistry`](#stronglytypedidregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdRegistry.cs:22`), which scans
assemblies up front and hands out the type list (`StronglyTypedIdRegistry.cs:28`,
`StronglyTypedIdRegistry.cs:66`, `StronglyTypedIdRegistry.cs:73`) because EF needs it before any entity
exists. One more Shared constant class rounds the group out:
[`MessageHeaders`](#messageheaders)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Messaging/MessageHeaders.cs:22`) names the four
`MMCA-`-prefixed transport headers a message carries across a boundary (tenant, user, roles, and
correlation id, `MessageHeaders.cs:25-34`), so a publisher and a consumer in different services spell
them identically.

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

### FallbackAuthorizationOptions
> MMCA.Common.API · `MMCA.Common.API.Authorization.Fallback` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:14` · Level 0 · class (options)

- **What it is**: a host-configurable options object controlling the framework's fallback
  authorization policy, whether it runs at all and which request path prefixes it never gates.
- **Depends on**: nothing first-party.
- **Concept introduced, deny-by-default as the ASP.NET Core `FallbackPolicy`.** `[Rubric §11,
  Security]` (assesses whether an endpoint with no authorization metadata fails closed rather than
  publishing itself anonymously) and `[Rubric §17, DevOps & Deployment]` (assesses whether the rule
  ships with a documented, code-level opt-out rather than forcing every host to fork it). An endpoint
  that declares neither `[Authorize]` nor `[AllowAnonymous]` used to be anonymous by omission; this
  options type is what a host tunes before flipping that default.
- **Walkthrough**: `DefaultExemptPathPrefixes`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:21-44`)
  is a static, read-only seed list of framework and static surfaces that are endpoint-routed but carry
  no authorization metadata of their own: Blazor's framework files and circuit (`/_framework`,
  `/_blazor`, `/_content`, `/_vs`), health probes (`/health`, `/alive`), well-known documents
  (`/.well-known`, `/robots.txt`, `/sitemap.xml`, `/manifest.json`, `/site.webmanifest`,
  `/service-worker.js`, `/apple-app-site-association`), and static asset roots (`/css`, `/js`, `/lib`,
  `/images`, `/img`, `/fonts`, `/media`, `/favicon.ico`). `Enabled`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:52`)
  defaults to `true`; the doc comment states the opt-out is deliberate
  (`AddAuthorizationPolicies(options => options.Enabled = false)`) rather than by omission
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:57-62`).
  `ExemptPathPrefixes`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:61`)
  is a mutable `IList<string>` seeded with `[.. DefaultExemptPathPrefixes]`, so a host appends its own
  static roots without losing the framework defaults; the doc comment is explicit that application
  endpoints belong on `[AllowAnonymous]`, not in this list, because that is what the anonymous-endpoint
  fitness gate reads
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:65-70`).
- **Why it's built this way**: matching is segment-based and case-insensitive against these prefixes
  (per the `ExemptPathPrefixes` doc comment), so a coarse prefix like `/_framework` covers everything
  beneath it without enumerating individual asset paths.
- **Where it's used**: bound via `services.AddOptions<FallbackAuthorizationOptions>()` and read by
  [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler) inside
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions).

### FallbackAuthorizationRequirement
> MMCA.Common.API · `MMCA.Common.API.Authorization.Fallback` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationRequirement.cs:16` · Level 0 · class (sealed)

- **What it is**: the marker `IAuthorizationRequirement` attached to the framework's fallback
  authorization policy.
- **Depends on**: `Microsoft.AspNetCore.Authorization.IAuthorizationRequirement` (framework).
- **Concept introduced, the requirement half of the fallback requirement/handler pair.** `[Rubric §11,
  Security]` and `[Rubric §2, Design Patterns]` (assesses whether the ASP.NET Core
  requirement/handler split is used as designed even for a policy with no data of its own). Unlike
  [`PermissionRequirement`](#permissionrequirement), this requirement carries no permission string: the
  whole type is a one-line marker,
  `public sealed class FallbackAuthorizationRequirement : IAuthorizationRequirement;`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationRequirement.cs:16`).
- **Walkthrough**: no members; presence in a policy's requirement list is the entire signal
  [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler) reacts to.
- **Why it's built this way**: a data-free requirement is enough here because the decision (is the
  caller authenticated, or is the path exempt) needs no configuration carried on the requirement
  itself; the configuration instead lives on
  [`FallbackAuthorizationOptions`](#fallbackauthorizationoptions), injected into the handler.
- **Where it's used**: attached to the built-in `AuthorizationPolicy` set as ASP.NET Core's
  `AuthorizationOptions.FallbackPolicy` by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions) when
  `FallbackAuthorizationOptions.Enabled` is true, and evaluated by
  [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler).

### OwnerOrAdminFilterOptions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:13` · Level 0 · class (options)

- **What it is**: a host-configurable options object that supplies the three vocabulary values
  [`OwnerOrAdminFilter`](#owneroradminfilter) needs: which claim carries the caller's owner id, which
  role bypasses the ownership check, and which route or argument parameter names the resource owner.
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations` for `[Required]`.
- **Concept introduced, externalizing a filter's vocabulary through the options pattern.**
  `[Rubric §11, Security]` (assesses whether the ownership rule is enforced consistently; here the rule
  is fixed in code while its identifiers are configuration, and the bypass role is required rather than
  defaulted) and `[Rubric §15, Best Practices & Code Quality]`
  (assesses whether a second host can reuse a component without forking it). The class doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:5-12`)
  states the current shape: the claim and route parameter keep the framework's conventional names
  (`customer_id` and `id`), but the bypass role has no default because the framework knows no role
  names, so a host that applies the filter configures its own role through
  `services.Configure<OwnerOrAdminFilterOptions>(o => o.BypassRole = MyRoleNames.Admin)`, and a host
  that never applies the filter configures nothing.
- **Walkthrough**: three mutable auto-properties. `OwnerClaimType` still defaults to `"customer_id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:16`).
  `BypassRole` now carries `[Required]` and defaults to `string.Empty`, not `"Admin"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:23-24`);
  its doc comment states the options are validated against their data annotations on first resolve, so
  a host that applies the filter without naming a role fails loudly instead of silently bypassing for
  nobody
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:19-22`).
  `OwnerParameterName` still defaults to `"id"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:31`); its
  doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:26-30`)
  spells out that the parameter is looked up as a route value first and a model-bound query or body
  argument second, which is exactly the two-step lookup the filter performs.
- **Why it's built this way**: `get; set;` (not `init`) is the shape the ASP.NET Core options binder
  expects, so the values can arrive from `appsettings` or a `Configure` callback; requiring `BypassRole`
  rather than defaulting it to `"Admin"` means a host cannot silently ship a filter that bypasses for a
  role it never granted to anyone.
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

### FallbackAuthorizationHandler
> MMCA.Common.API · `MMCA.Common.API.Authorization.Fallback` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:15` · Level 1 · class (sealed)

- **What it is**: the `AuthorizationHandler<FallbackAuthorizationRequirement>` that decides whether an
  endpoint carrying no authorization metadata of its own should be allowed through: it succeeds for an
  authenticated caller or an exempt path, and otherwise leaves the requirement unsatisfied.
- **Depends on**: [`FallbackAuthorizationRequirement`](#fallbackauthorizationrequirement),
  [`FallbackAuthorizationOptions`](#fallbackauthorizationoptions) (the exempt path prefixes, taken as
  `IOptions<FallbackAuthorizationOptions>` on the primary constructor,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:15`);
  `Microsoft.AspNetCore.Http`, `Microsoft.AspNetCore.Authorization`.
- **Concept introduced, path-based exemption over endpoint routing's ambient resource.** `[Rubric §11,
  Security]` (assesses whether the fail-closed default still lets framework and static surfaces
  through without requiring `[AllowAnonymous]` on infrastructure that was never meant to declare
  authorization metadata) and `[Rubric §7, Microservices Readiness]` (assesses whether the handler
  works without extra DI plumbing; it needs no `IHttpContextAccessor`).
- **Walkthrough**: `HandleRequirementAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:19-32`)
  null-guards both arguments and succeeds the requirement when either
  `context.User.Identity?.IsAuthenticated == true` or `IsExemptPath(context.Resource)` holds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:26-29`);
  otherwise it returns without calling `context.Succeed`, leaving the requirement unmet. `IsExemptPath`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:37-49`)
  pattern-matches `context.Resource` to `HttpContext` and returns `false` for anything else
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:39-42`),
  then checks the request path against `options.Value.ExemptPathPrefixes` with
  `StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:46-48`).
  The comment above `IsExemptPath`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:34-36`)
  explains why no `IHttpContextAccessor` is needed: under endpoint routing the authorization resource
  IS the `HttpContext`, and a non-HTTP resource (a SignalR hub invocation) simply has no exempt path and
  falls through to the authenticated-user rule.
- **Why it's built this way**: reading the resource directly off `AuthorizationHandlerContext` instead
  of injecting `IHttpContextAccessor` keeps the handler stateless and singleton-safe; never calling
  `context.Fail()` follows the same ASP.NET Core convention as
  [`PermissionAuthorizationHandler`](#permissionauthorizationhandler), abstaining rather than vetoing.
- **Where it's used**: registered as an `IAuthorizationHandler` singleton and wired as ASP.NET Core's
  `AuthorizationOptions.FallbackPolicy` handler by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions) whenever
  `FallbackAuthorizationOptions.Enabled` is true.

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
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13` · Level 1 · class (sealed)

- **What it is**: the `AuthorizationHandler<PermissionRequirement>` that decides whether the current
  principal satisfies a [`PermissionRequirement`](#permissionrequirement), either because it carries
  the permission as an explicit claim or because one of its roles grants it.
- **Depends on**: [`PermissionRequirement`](#permissionrequirement),
  [`IPermissionRegistry`](#ipermissionregistry) (the role-to-permission map, taken as a primary
  constructor parameter at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`),
  and the shared `ClaimsPrincipal` extension methods `HasPermissionClaim` / `GetRoleValues`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:30-31`).
- **Concept introduced, resolving a permission through claim-or-role.** `[Rubric §11, Security]`
  (assesses correctness of the grant decision; there are two independent grant paths, a direct
  permission claim and a role-derived one) and `[Rubric §7, Microservices Readiness]` (assesses whether
  a service stands alone; the role lookup used by `GetRoleValues()` reads out of the token regardless of
  how the JWT middleware mapped the role claim type, so it survives inbound-claim mapping being on or
  off).
- **Walkthrough**: `HandleRequirementAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:17`)
  null-guards both arguments
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:21-22`),
  then short-circuits to a completed task when the principal is not authenticated
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:24-27`),
  so an anonymous request never succeeds. It then succeeds the requirement if *either*
  `context.User.HasPermissionClaim(requirement.Permission)` (a directly granted permission) *or*
  `permissionRegistry.HasPermission(context.User.GetRoleValues(), requirement.Permission)` (a
  role-derived grant) holds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:30-31`).
  The handler no longer carries its own role-gathering helper: the three-claim-type role lookup (the
  standard `ClaimTypes.Role` URI plus the raw `"role"`/`"roles"` claims) that used to live as a private
  `GetRoles` method here now lives once, on the shared `ClaimsPrincipalExtensions.GetRoleValues()` used
  by both this handler and [`ICurrentUserService.Roles`](#icurrentuserservice), so the two call sites
  cannot restate the predicate and drift.
- **Why it's built this way**: never calling `context.Fail()` (only `context.Succeed`) is the
  ASP.NET Core convention that lets multiple handlers vote independently: this handler abstains rather
  than vetoes when it cannot grant. Moving the role-claim-type lookup into a shared extension (rather
  than a private method restated per call site) is what removed the duplication the prior version
  flagged in a comment.
- **Where it's used**: registered as an `IAuthorizationHandler` singleton by
  [`AuthorizationExtensions.AddAuthorizationPolicies`](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:68-69`);
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
- **Concept introduced, on-demand policy materialization.** `[Rubric §11, Security]` and `[Rubric §15,
  Best Practices & Code Quality]` (assesses whether the design scales without repetitive registration; a system with
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:70-71`).
- **Caveats / not-in-source**: a policy object is built on every `GetPolicyAsync` call for a `perm:`
  name; no cache is present in this type, and whether ASP.NET Core caches the result upstream is not
  determinable from this source file.

### AuthorizationExtensions
> MMCA.Common.API · `MMCA.Common.API.Authorization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14` · Level 3 · class (static, extension block)

- **What it is**: the DI wiring for the whole authorization model: one overload set that turns on
  ASP.NET Core authorization, installs the permission mechanism (handler, on-demand provider, registry)
  and the framework's fallback policy, and one method each module uses to declare its role-to-permission
  grants.
- **Depends on**: [`PermissionAuthorizationHandler`](#permissionauthorizationhandler),
  [`PermissionPolicyProvider`](#permissionpolicyprovider), [`IPermissionRegistry`](#ipermissionregistry),
  [`IPermissionCatalog`](#ipermissioncatalog), [`PermissionRegistryBuilder`](#permissionregistrybuilder),
  [`FallbackAuthorizationOptions`](#fallbackauthorizationoptions) and
  [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler);
  `Microsoft.Extensions.DependencyInjection` plus its `Extensions` namespace for `TryAddEnumerable`.
- **Concept introduced, `extension(T)` DI members and lazy registry accumulation.** `[Rubric §6,
  CQRS & Event-Driven Design]` (assesses whether a concern is configured once for every host rather than
  re-wired per application) and `[Rubric §7, Microservices Readiness]` (assesses per-module
  self-sufficiency: each module contributes only the permissions it owns, so an extracted module
  carries its own grants). The `extension(IServiceCollection services)` block
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:16`) is the
  C# `extension(T)` DI idiom taught in the [primer](00-primer.md#c-extensiont-types-read-this-once):
  it adds `AddAuthorizationPolicies` and `AddPermissions` directly onto `IServiceCollection`. The
  doc comment on the no-argument overload
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:18-23`)
  states the permission model plainly: an endpoint states the capability it needs and the registry maps
  roles to capabilities, so no policy name has to be pre-registered per role. The parameterized
  overload's doc comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:28-59`)
  states the fallback half: an endpoint declaring NO authorization metadata now requires an
  authenticated caller instead of publishing anonymously by omission, exempt paths are seeded from
  [`FallbackAuthorizationOptions.DefaultExemptPathPrefixes`](#fallbackauthorizationoptions), the opt-out
  is `AddAuthorizationPolicies(options => options.Enabled = false)`, and two surfaces need a decision
  before adopting it in an existing host: a YARP gateway's proxied routes need
  `"AuthorizationPolicy": "anonymous"` per public route (or the opt-out), and a routable Blazor page is
  gated by `AuthorizeRouteView`, which reads attributes and ignores this policy entirely, so a page
  still declares `[Authorize]`/`[AllowAnonymous]` for itself.
- **Walkthrough**
  - `AddAuthorizationPolicies()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:25-26`):
    a one-line forward to `AddAuthorizationPolicies(configureFallback: null)`, so the fallback policy
    is enabled with its default exempt list unless a host opts out.
  - `AddAuthorizationPolicies(Action<FallbackAuthorizationOptions>? configureFallback)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:60`):
    calls `services.AddAuthorization()`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:62`) to
    bring in the framework's authorization services, then wires the permission mechanism:
    `TryAddEnumerable` adds [`PermissionAuthorizationHandler`](#permissionauthorizationhandler) as a
    singleton `IAuthorizationHandler`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:68-69`),
    `Replace` installs [`PermissionPolicyProvider`](#permissionpolicyprovider) as the transient
    `IAuthorizationPolicyProvider`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:70-71`),
    and `EnsurePermissionRegistry(services)` guarantees a registry exists
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:72`). It
    then binds [`FallbackAuthorizationOptions`](#fallbackauthorizationoptions), applies
    `configureFallback` when supplied, registers
    [`FallbackAuthorizationHandler`](#fallbackauthorizationhandler) as a singleton
    `IAuthorizationHandler`, and configures `AuthorizationOptions.FallbackPolicy` through the options
    pipeline (`Configure<IOptions<FallbackAuthorizationOptions>>`) rather than inline, so the `Enabled`
    flag is read after every `AddAuthorizationPolicies`/`Configure` call the host makes
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:74-91`):
    a `FallbackAuthorizationRequirement`-carrying policy when `Enabled` is true, `null` (no fallback
    policy) when it is false.
  - `AddPermissions(Action<PermissionRegistryBuilder> configure)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:103`): the
    per-module entry point for declaring grants. It guards the callback
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:105`),
    fetches the shared builder via `EnsurePermissionRegistry`, and invokes `configure(builder)` so the
    module's grants accumulate
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:107-108`).
    The doc comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:96-102`)
    notes it is safe to call once per module because grants union into a single registry; the union
    itself happens in [`PermissionRegistryBuilder.Grant`](#permissionregistrybuilder)
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:32-39`).
  - `EnsurePermissionRegistry(IServiceCollection)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:117`): the
    idempotent core. If a [`PermissionRegistryBuilder`](#permissionregistrybuilder) is already
    registered as a singleton instance it returns that existing one
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:119-123`);
    otherwise it creates one, registers it, and registers the built `PermissionRegistry` as a singleton
    factory
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:125-127`).
    Both [`IPermissionRegistry`](#ipermissionregistry) and `IPermissionCatalog` are then registered as
    singleton factories that resolve that same concrete `PermissionRegistry`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:133-134`);
    the inline comment
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:129-132`)
    states why: both contracts must forward to the ONE built instance so what an administration screen
    enumerates and what an authorization check answers from can never disagree, and calling
    `builder.Build()` a second time to satisfy the second contract would build two. Because the registry
    is built on first *resolve*, every module's `AddPermissions` call has already contributed by the
    time any request evaluates a permission, which is the point the comment at
    `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:114-116`
    makes.
- **Why it's built this way**: `TryAddEnumerable` lets the permission handler (and, separately, the
  fallback handler) coexist with any other authorization handlers a host registers; `Replace` guarantees
  exactly one policy provider (the permission-aware one); and the lazy `builder.Build()` factory is what
  makes module registration order irrelevant, since all grants are collected before the first `Build()`.
  Resolving `IPermissionRegistry` and `IPermissionCatalog` from the same singleton factory output (rather
  than each calling `builder.Build()`) is what keeps the read side and the enforcement side of the
  permission model looking at one object.
- **Where it's used**: `AddAuthorizationPolicies()` is called at the end of both framework
  authentication-wiring helpers, so a host that wires authentication through either gets the
  authorization model without an explicit call: `AddForwardedJwtBearerCore`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:76`,
  the call at `WebApplicationBuilderExtensions.Authentication.cs:127`) and `AddCommonAuthentication`
  (`WebApplicationBuilderExtensions.Authentication.cs:144`, the call at `WebApplicationBuilderExtensions.Authentication.cs:178`).
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:68`).

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
  - `IsAdmin(ICurrentUserService, string bypassRole)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:17`): a
    case-insensitive compare of the current user's `Role` against the bypass role
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:20`).
    `bypassRole` has no default argument: every caller supplies its own, normally sourced from
    [`OwnerOrAdminFilterOptions.BypassRole`](#owneroradminfilteroptions), so the framework itself
    declares no role names
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:13-16`).
    [`OwnerOrAdminFilter`](#owneroradminfilter) reuses this same method so the gate and the scoping
    agree on who bypasses.
  - `GetOwnershipSpecification<TSpec, TId>(...)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:34`): the general
    form. It returns `null` for a bypass-role caller
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:45-48`, no scoping
    needed); otherwise it reads the owner id from the named claim via
    `currentUserService.GetClaimValue<TId>(claimType)` and, when present, calls the supplied
    `specFactory(id.Value)` to build the scoping specification
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:50-51`). Like
    `IsAdmin`, `bypassRole` is a required parameter with no default
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:38`). The
    `where TId : struct, IParsable<TId>` constraint
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:40`) is what lets
    the claim string be parsed into a strongly-typed id.
  - `GetOwnershipSpecification<TSpec>(...)`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:64`): the
    convenience overload that fixes `TId` to `int` and the claim to `"customer_id"`, but still takes
    `bypassRole` as a required parameter and forwards it
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:67`).
- **Why it's built this way**: returning `null` for bypass-role callers (rather than a "match
  everything" specification) lets the caller skip filtering entirely on the privileged path; producing a
  specification rather than running the query keeps the helper in the API layer while the actual
  filtering runs in the query pipeline. Removing the `"Admin"` default arguments (in favor of a required
  parameter everywhere) matches the same move on
  [`OwnerOrAdminFilterOptions.BypassRole`](#owneroradminfilteroptions): the framework no longer names a
  default role anywhere in the ownership axis.
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
  and whether it fails closed) and `[Rubric §17, DevOps & Deployment]` (assesses whether the rule is
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`, next to
  `IdempotencyFilter` at `DependencyInjection.cs:84`, because both depend on scoped services) and
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
> MMCA.Common.API · `MMCA.Common.API.SessionCookies` · `MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:77` · Level 0 · record

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:77`). It
  is nested in the endpoint class it serves, so the contract sits next to its only route.
- **Where it's used**: bound by the `POST` handler at `SessionCookieEndpoints.cs:34`, which passes both
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:61`).

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
  `SessionCookieEndpoints.cs:61`.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:51`).
  Registered as a singleton at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:186`.

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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:228` (with `UseAuthentication()` on the very next
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
  (`ExcludeFromDescription` at `:31` and `:63`) because they are browser plumbing, not public API
  surface.
- **Walkthrough**: the mapping method lives inside an `extension(IEndpointRouteBuilder endpoints)`
  block (`:20`), the C# extension-member syntax this codebase uses for fluent registration
  ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), so hosts call
  `app.MapSessionCookieEndpoints()`. Inside `MapSessionCookieEndpoints` (`:22-68`): a route group for
  `/auth/session-cookie` is created, excluded from description, and explicitly marked
  `AllowAnonymous()` (`:30-32`); the comment above it (`:26-29`) spells out why the anonymity has to be
  declared rather than left implicit: the `POST` seeds the cookie jar at login and the `DELETE` clears
  it at logout, so both run before or after a session exists, and the default fallback authorization
  policy (SEC-Common-16) requires an authenticated caller on any endpoint that does not declare
  otherwise, which would make sign-in impossible on a Blazor host. The `POST` (`:34-38`) binds a
  [`SessionCookieRequest`](#sessioncookierequest), calls `SessionCookieJar.Append` and returns `204`;
  the `DELETE` (`:40-44`) calls `SessionCookieJar.Delete` and returns `204`; both `DisableAntiforgery()`
  because there is no antiforgery token cookie to validate on these calls. The `/auth/session/token`
  `POST` (`:50-65`) first rejects an obvious cross-site request with `403` (`:53-56`), then awaits
  `refresher.GetOrRefreshAsync` (`:58`); a `null` result becomes a `401` JSON body
  `{ error = "no_session" }` (`:60`), otherwise a [`SessionTokenResponse`](#sessiontokenresponse) is
  serialized (`:61`). That route is `AllowAnonymous()` (`:64`) because it authenticates via the cookies
  themselves. The private `IsCrossSite` (`:73-75`) inspects the `Sec-Fetch-Site` request header and
  treats a missing header as allowed, which the comment at `:72` attributes to older browsers.
- **Why it's built this way**: CSRF is defended in depth rather than by antiforgery tokens. The comment
  at `:71-72` spells it out: `POST`-only, `SameSite=Lax` on the cookies (which already blocks
  cross-site cookie attachment), and the `Sec-Fetch-Site` check together stop a cross-site page from
  driving these endpoints, which is what makes disabling antiforgery safe here
  ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). [Rubric §11,
  Security]. The group-level `AllowAnonymous()` is the same defense-in-depth posture applied to
  authentication instead of CSRF: it is a deliberate, commented opt-out of the fallback policy
  (SEC-Common-16) rather than an oversight.
- **Where it's used**: mapped by both Blazor Server hosts,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:247` and
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
  `SessionCookieEndpoints.cs:36`, clear at `:37`) and
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
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:228`,
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
- **Concept introduced, the fresh-token handoff.** [Rubric §29, Resilience, Reliability & Business Continuity] covers
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:180`), and covered by
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:182-183`), which also
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
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:87-88` and
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
- **Where it's used**: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:88` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:112`, chained onto the host's
  `AddAuthentication(SessionCookieAuthenticationHandler.SchemeName)` call on the preceding line.

### IssuedSession
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:924` · Level 0 · record (private sealed, nested)

- **What it is**: the two-field result of opening or rotating a refresh session: the plaintext refresh token the client is handed, and the id of the session row it belongs to. It is a `private sealed record` nested inside [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:924`), not part of the framework's public surface.
- **Depends on**: nothing beyond the BCL (`string`, `Guid`). It is produced and consumed entirely inside its declaring class.
- **Concept introduced: the plaintext token exists in exactly one place, and it is a return value.** `[Rubric §11, Security]` assesses how a bearer credential is stored. [RefreshSession](#refreshsession) rows keep only a digest (`RefreshSession.HashToken`, used at `:349` and `:593` to *look up* by hash), so once a session is persisted the raw token cannot be recovered from the store at all. The type comment says exactly this (`:753-757`): the plaintext "exists nowhere else". Modelling the hand-off as a small record rather than an out-parameter or a tuple is what keeps that fact readable: every method that can produce a token returns `Result<IssuedSession>`, so the compiler shows you the complete list of places raw token material is in flight. `[Rubric §15, Best Practices & Code Quality]` also applies: a positional record gives value equality and immutability for free, and `Guid SessionId` names what would otherwise be an anonymous second tuple element.
- **Walkthrough**: one positional declaration, `IssuedSession(string RefreshToken, Guid SessionId)` (`:758`). `RefreshToken` is what goes back to the caller in the [AuthenticationResponse](#authenticationresponse); `SessionId` is what the access token's `sid` claim carries, which is why the session must be created before the token is minted (`:481-483`).
- **Why it's built this way**: the pairing is load-bearing rather than incidental. A caller that received only the token could not stamp `sid`, and a caller that received only the id could not answer the client. Returning both together removes the ordering mistake where a token is minted for a session that does not exist yet.
- **Where it's used**: returned by `OpenSessionAsync` (`:620`, constructed at `:645`) and `RotateAsync` (`:659`, constructed at `:698`); unwrapped by `IssueTokensAsync` (`:492-493`) and by `RefreshTokenAsync` (`:327-328`), each of which reads `SessionId` to mint the access token and `RefreshToken` to fill the response.

### PasswordResetSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the bound options object for the forgot-password workflow: where the reset page lives, how long a token stays redeemable, how many wrong guesses a token tolerates, and how often one address may ask for a reset (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/PasswordResetSettings.cs:6-9`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for the range attributes and `System.Diagnostics.CodeAnalysis` for one scoped suppression (BCL, `:1-2`). Nothing first-party. Read by the implementation behind [IPasswordResetTokenService](#ipasswordresettokenservice) and by the shared [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand).
- **Concept: validated options whose defaults keep an unconfigured host bootable.** `[Rubric §17, DevOps & Deployment]` assesses whether policy knobs are configuration rather than constants buried in a handler, and `[Rubric §11, Security]` assesses whether the security-relevant knobs (token lifetime, attempt cap, request throttle) are bounded rather than free-form. Every numeric member carries a `[Range]` attribute, and the host binds the section with `ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:154-157`), so a typo such as `TokenLifetimeMinutes: 0` fails the host at startup instead of silently issuing tokens that are already expired.
- **Walkthrough**: `const string SectionName = "PasswordReset"` (`:13`) names the configuration section the host binds. `ResetUrl` (`:25`) defaults to `string.Empty` and is **deliberately not** `[Required]`: the doc comment (`:15-20`) records that a host which has not configured a UI base must still boot, and an empty value degrades to a token-only email the user pastes into the reset page by hand. That degradation is visible in the caller, which emits the bare token when the URL is blank and otherwise appends `?email=...&token=...` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:146-148`). The property carries a scoped `CA1056` suppression (`:21-24`) explaining why it is a `string` and not a `System.Uri`: it is bound from `PasswordReset__ResetUrl`, concatenated with a query string, and the empty default is not a valid `Uri`. The four numeric knobs follow: `TokenLifetimeMinutes` (`:29`, `[Range(1, 1440)]`, default 30), `MaxValidationAttempts` (`:36`, `[Range(1, 100)]`, default 5), `MaxRequestsPerEmail` (`:40`, `[Range(1, 100)]`, default 3), and `RequestWindowMinutes` (`:44`, `[Range(1, 1440)]`, default 60). All five members are `init`-only, so the bound instance is immutable afterwards.
- **Why it's built this way**: the defaults are a working policy on their own, so adopting the feature costs a registration call and no configuration at all, while the `[Range]` bounds plus `ValidateOnStart` make the one genuinely dangerous class of misconfiguration (a zero or negative lifetime, an unbounded attempt cap) unreachable. The decision to keep the whole reset credential in configuration and cache rather than in schema is [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html).
- **Where it's used**: bound in the framework's Infrastructure registration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:154-157`, immediately before the token service that reads it is registered at `:141`); consumed by [PasswordResetTokenService](#passwordresettokenservice) as a snapshot field (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:32`) for the request window, the throttle ceiling, the token lifetime, and the attempt cap; and exposed to the shared forgot-password handler as a protected `Settings` property (`ForgotPasswordHandlerBase.cs:49`) that states the expiry in the email body (`:125`) and renders the link (`:145-147`).

### RefreshSessionSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the bound options object for multi-device refresh sessions: whether this host owns the `RefreshSessions` table, which database carries it, how many live sessions one user may hold, and how long dead session rows are retained before a sweep deletes them (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:5-8`). A host that omits the section gets the defaults.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL, `:1`). Nothing first-party. Read by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser), by [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore), by [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), and by [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice).
- **Concept introduced: a flag that places a table rather than switching a feature.** `[Rubric §8, Data Architecture]` assesses whether each table has exactly one owning database, and `[Rubric §7, Microservices Readiness]` assesses whether that ownership survives splitting a modular host into services. The doc comment on `Enabled` states the distinction precisely (`:20-23`): the flag "gates the model, not the workflow". The workflow always issues, rotates and revokes sessions; `Enabled` decides which host maps the table, runs its migrations, and sweeps it. In a modular host the service that owns identity sets it to `true` and every other service leaves it `false`, which is what keeps one table in one database instead of one per service. The `Scheduler:Enabled` precedent is named in the same comment as the pattern being followed.
- **Walkthrough**: six members, all `init`-only.
  - `const string SectionName = "RefreshSessions"` (`:12`) names the configuration section.
  - `Enabled` (`:25`) defaults to `false`. Two places read it: the model gate in [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), which enables the table only when the flag is set **and** the context instance's physical source name equals `DataSourceName` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:331-334`), and the hosted-service registration, which starts the retention sweep only when the flag is set (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:171-175`, whose comment explains that registering it unconditionally would start a sweep in every service of a modular host, all but one of which has no table to sweep).
  - `MaxActiveSessionsPerUser` (`:35`, `[Range(1, 1000)]`, default 10) caps live sessions per user. The comment (`:28-33`) records the deliberate behavior at the ceiling: signing in on device number cap + 1 **revokes the oldest live session rather than refusing the login**, so the table is bounded without a legitimate sign-in ever failing.
  - `DataSourceName` (`:52`, `[MinLength(1)]`, default `"Default"`) names the logical data source whose database holds the table. The comment (`:37-49`) is worth reading in full: the value answers two questions that must agree, which context *maps* the table and which context the shipped [IRefreshSessionStore](#irefreshsessionstore) reads and writes through, and naming a source that does not exist fails loudly on the first session query rather than reading the wrong database. It is ignored for routing when the consumer ships its own entity configuration for the session entity.
  - `RetentionDays` (`:72`, `[Range(0, 3650)]`, default 30) is measured from the instant a session died (its revocation, or its expiry when never revoked), so a live session is never a sweep candidate. The comment (`:59-66`) states the constraint that makes the number security-relevant: retention **bounds reuse detection**, because BR-206 catches a replayed refresh token by landing on its revoked row, and a swept row turns that replay into an unknown token that fails alone instead of revoking the family. Thirty days sits well past the seven-day refresh-token lifetime for exactly that reason. `0` keeps every row forever (`:67-69`).
  - `CleanupIntervalHours` (`:80`, `[Range(1, 168)]`, default 6) is how often the sweep runs, ignored when `RetentionDays` is `0`, and matches the outbox sweep cadence because the deadline is measured in days (`:74-77`).
- **Why it's built this way**: the same `AddOptions(...).Bind(...).ValidateDataAnnotations().ValidateOnStart()` treatment as every other settings class in the framework (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:162-165`) means an out-of-range cap or a negative retention window fails the host at startup, not at the first login. Defaulting `Enabled` to `false` is the safe direction for a multi-service host: a service that never opts in never grows a table it does not own.
- **Where it's used**: bound at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:162-165`; injected as `IOptions<RefreshSessionSettings>` into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:61`, read for the cap at `:115`), into [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:34`), and into [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:51`, snapshotted at `:54`). The design-time context helper supplies an instance so `dotnet ef` can build a model that includes the table (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:173-174`). Each app's Identity service takes it as a required constructor dependency and passes it through, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:55`.

### UserAdministrationQuery
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IUserAdministrationService.cs:79` · Level 0 · record struct

- **What it is**: the paging and filter parameters for [IUserAdministrationService<TUserDto>](#iuseradministrationservicetuserdto)'s `ListAsync`: a page number, a page size, an optional free-text search term, and an optional role filter (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IUserAdministrationService.cs:79-83`).
- **Depends on**: nothing beyond the BCL (`string`, `int`). It exists purely as the input shape to [IUserAdministrationService<TUserDto>](#iuseradministrationservicetuserdto)`.ListAsync`.
- **Concept introduced: a query parameter object at an admin list boundary.** `[Rubric §9, API & Contract Design]` assesses whether a list endpoint's inputs are a named, typed shape rather than several loose parameters strung along a signature. A `readonly record struct` gives value equality for free and keeps the four knobs, paging plus the two optional filters, together at the controller, the service, and any test double.
- **Walkthrough**: a four-member positional declaration: `PageNumber` and `PageSize` (required), `SearchTerm` and `Role` (both `string?`, default `null`, meaning "no filter").
- **Why it's built this way**: a `record struct` rather than a class avoids a heap allocation for a value that is built once, passed to one call, and discarded, and the two optional filters default to `null` so a caller that wants an unfiltered page supplies only the paging pair.
- **Where it's used**: built by `UsersAdminControllerBase` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs`) from the incoming query string and passed to [IUserAdministrationService<TUserDto>](#iuseradministrationservicetuserdto)`.ListAsync`; consumed by each app's `UserAdministrationService`, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Administration/UserAdministrationService.cs`.

### SessionStampingTokenService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:936` · Level 1 · class (private sealed, nested)

- **What it is**: a pass-through [ITokenService](#itokenservice) that appends the current refresh session's `sid` claim and, when a second factor verified this request, an `mfa` claim to every access token minted while it is armed, and behaves as the plain inner service the rest of the time. It is a `private sealed class` nested inside [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:936`).
- **Depends on**: [ITokenService](#itokenservice) (the contract it implements and the inner instance it wraps, `:106`), [AuthClaimTypes](#authclaimtypes) for the `sid` and `mfa` claim names (`:142`, `:147`), and the BCL (`System.Security.Claims`, `System.Globalization.CultureInfo`).
- **Concept introduced: a decorator used to make a new claim additive.** `[Rubric §2, Design Patterns]` assesses idiomatic pattern use, and this is the Decorator pattern applied to a very specific compatibility problem. Access tokens now need to name the session they belong to (and, when relevant, the second factor that satisfied a step-up), but the claim set is produced by the app's own `CreateAccessToken` hook. The obvious fix, adding parameters to that hook, is a compile break in every consumer for claims the app has no decision to make about. Wrapping the token service instead means the base arms the wrapper around the hook call and the claims appear in tokens minted by subclasses that were never edited. `[Rubric §15, Best Practices & Code Quality]` is the payoff: an additive protocol change with a zero-line consumer diff, twice over.
- **Walkthrough**: a primary constructor takes the `inner` service (`:106`).
  - `Guid? CurrentSessionId { get; set; }` (`:109`) is the session arming switch: a session id stamps, `null` mints unchanged.
  - `string? CurrentMultiFactorMethod { get; set; }` (`:115`) is the second-factor arming switch, set only when a second factor really verified for this request. The remarks on the caller explain why plain mutable properties are safe here: the authentication service is resolved per request (scoped, like the unit of work it saves through) and one request issues one token pair at a time.
  - `AccessTokenLifetime` (`:118`) and `RefreshTokenLifetime` (`:121`) forward straight to `inner`, so the lifetime the base reports is still the JWT settings' value.
  - `GenerateAccessToken(...)` (`:124-151`) is the only member with behavior. When neither switch is armed it delegates verbatim (`:131-134`). Otherwise it copies the app's `additionalClaims` into a new `List<Claim>` (`:136`, so the caller's sequence is never mutated), then independently appends `AuthClaimTypes.SessionId` formatted as `sessionId.ToString("D", CultureInfo.InvariantCulture)` when `CurrentSessionId` is set (`:138-143`, the `"D"` format being the canonical hyphenated Guid form `ClaimsPrincipalExtensions.FindSessionId` parses back, see [ClaimsPrincipalExtensions](#claimsprincipalextensions)) and `AuthClaimTypes.MultiFactor` set to the raw method string when `CurrentMultiFactorMethod` is set (`:145-148`), before delegating with the extended list (`:150`). The two claims are independent: a token can carry either, both, or neither.
  - `GenerateRefreshToken()` (`:154`) and `GetPrincipalFromExpiredToken(string token)` (`:157-158`) are plain forwards.
- **Why it's built this way**: putting the stamping behind an `ITokenService` rather than inside the base's own method keeps the app hook's signature and semantics untouched while still guaranteeing both claims on the tokens the framework's own flows mint. The escape hatch still applies: an app that mints from its own injected `ITokenService` reference produces a valid token with neither claim, and can restore them by overriding `CreateAccessTokenForSession`.
- **Where it's used**: constructed once per authentication service instance (`:93`), surfaced to subclasses as the protected `TokenService` property (`:120`, whose remarks state that minting through the property is what puts `sid` on the token), and armed and disarmed around the hook call in `CreateAccessTokenForSession` (`:618-631`, with the `finally` guaranteeing both switches disarm even when the hook throws). `CurrentMultiFactorMethod` is set from the base's `_multiFactorMethod` field, armed in `LoginAsync` around `IssueTokensAsync` and in `RefreshTokenAsync` around the successor mint (see [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)).

### UnconfiguredPermissionRegistry
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:20` · Level 1 · class (internal sealed partial)

- **What it is**: the fallback [IPermissionRegistry](#ipermissionregistry) (and, since it also implements [IPermissionCatalog](#ipermissioncatalog), the fallback catalog) for a host that wired the CQRS pipeline without declaring any role-to-permission grants. It grants nothing, so a permission-gated command or query is **denied** rather than allowed, and it logs one warning naming the call that would fix it (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:6-11`).
- **Depends on**: [IPermissionRegistry](#ipermissionregistry) and [IPermissionCatalog](#ipermissioncatalog) (`:20`), [IRequiresPermission](group-05-cqrs-pipeline.md#irequirespermission) by reference in the doc comment (`:9`), and `Microsoft.Extensions.Logging` for the source-generated log message (`:1`).
- **Concept introduced: failing closed, and only where it costs nothing.** `[Rubric §11, Security]` assesses the direction a misconfiguration fails in: a registry that answered "no permission model, therefore allow" would silently open every gated request, so this one denies, and now that it doubles as the fallback [IPermissionCatalog](#ipermissioncatalog) it renders an **empty** catalog rather than throwing, so a role-administration screen on an unconfigured host reads as "this host grants nothing yet" instead of failing (`:225-228`). `[Rubric §13, Observability & Operability]` assesses whether an operator can tell why: the log message spells out the remedy verbatim (`:264-267`, naming `AddAuthorizationPolicies()` / `AddPermissions(...)` and the required ordering before `AddApplicationDecorators()`). The second half of the doc comment (`:12-17`) is the more interesting teaching point and is an availability story rather than a security one: the two authorization decorators are registered **unconditionally** and take an `IPermissionRegistry` constructor dependency, so without any registration the whole pipeline fails to activate and a small app with no Identity module answers 500 on **every** read, not only the gated ones. This type turns a total activation failure into a correct, noisy denial on the subset of requests that actually declare a permission.
- **Walkthrough**: two fields, two catalog properties, and three methods.
  - `private static readonly HashSet<string> None = []` (`:221`) is the single empty grant set every permission call returns, and `private int _warned` (`:223`) is the one-time-warning latch.
  - `IReadOnlyList<string> Roles => []` (`:229`) and `IReadOnlyList<string> Permissions => []` (`:232`) are the [IPermissionCatalog](#ipermissioncatalog) members: both always empty, so an unconfigured host's role editor renders no roles and no permissions to pick from rather than erroring.
  - `GetPermissions(string role)` (`:235-239`) warns then returns `None`.
  - `HasPermission(IEnumerable<string> roles, string permission)` (`:242-249`) argument-guards both parameters (`:244-245`) before warning and returning `false`, so a caller bug still surfaces as an `ArgumentException` rather than being swallowed by the stub.
  - `WarnOnce()` (`:256-262`) uses `Interlocked.Exchange(ref _warned, 1) == 0` (`:258`) so concurrent requests produce exactly one log line. The comment (`:251-255`) explains why the warning is deferred to the first permission check instead of emitted at startup: a host with no permission-gated request is **correctly** configured and simply never needs a registry, so warning at boot would cry wolf. Reading the catalog properties never triggers the warning, only `GetPermissions`/`HasPermission` do.
  - `LogNoPermissionsConfigured` (`:264-267`) is a `[LoggerMessage]` source-generated `Warning`, which is why the class is `partial`.
- **Why it's built this way**: it is registered with `TryAddSingleton` from inside `AddApplicationDecorators()` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:123`), and the surrounding comment (`:119-123`) states both halves of the rule: `TryAdd` so a host that already declared its grants (via `AddAuthorizationPolicies()` or `AddPermissions(...)`, both of which run before this call) keeps its own registry and never constructs this type, and *here* rather than in `AddApplication()` so the registration lands exactly where the decorators that need it are wired. Adding [IPermissionCatalog](#ipermissioncatalog) to the same fallback type, rather than a second stub class, means the one `TryAddSingleton` call keeps both ports covered from the same no-op instance.
- **Where it's used**: reached through the [IPermissionRegistry](#ipermissionregistry) dependency of the authorization command and query decorators in the CQRS pipeline (see [group 05](group-05-cqrs-pipeline.md)), and through the [IPermissionCatalog](#ipermissioncatalog) dependency of [IRoleAdministrationService](#iroleadministrationservice)'s `GetCatalogAsync` on a host that never configured a registry.
- **Caveats / not-in-source**: `internal`, so it is not part of the framework's public API and cannot be referenced or asserted against from a consumer's code.

### ILoginProtectionService
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` · Level 3 · interface

- **What it is**: the application-layer contract for **brute-force and rate-limit protection** on authentication endpoints: lockout checks, failed-attempt increments, successful-login resets, and registration rate-limiting per IP address.
- **Depends on**: [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:1`).
- **Concept introduced: rate limiting as a first-class application concern.** `[Rubric §11, Security]` assesses brute-force protection on auth flows, and `[Rubric §12, Performance & Scalability]` assesses whether such a policy is extracted to a port so the application layer can reason about it without coupling to a specific store (the doc comment at `:7-8` names both a distributed and an in-memory cache as valid backers). Returning [Result](group-01-result-error-handling.md#result) from `CheckLockoutAsync` (`:18`) and `CheckRegistrationRateLimitAsync` (`:42`) makes "account is locked out" a normal control-flow branch rather than a thrown exception.
- **Walkthrough**: five async methods in two scopes.
  - **Email-scoped (failed-login lockout):** `CheckLockoutAsync` (`:18`) returns a failure result when the email is currently locked; `IncrementFailedAttemptsAsync` (`:26`) records a failure and, per the doc comment (`:20-22`), applies **exponential-backoff lockout** once the maximum is exceeded; `ResetFailedAttemptsAsync` (`:33`) clears the counter after a successful login.
  - **IP-scoped (registration flood):** `CheckRegistrationRateLimitAsync` (`:42`) and `IncrementRegistrationCountAsync` (`:49`) throttle account creation per client IP. Both accept a nullable `ipAddress` and **skip** the check when it is null, so a host that cannot resolve the caller IP degrades to no limit rather than blocking everyone; `CheckRegistrationRateLimitAsync` returns `Result.Success()` in that case (doc comment, `:36-37`).

  All five take a `CancellationToken` with a `default` argument, per convention.
- **Why it's built this way**: keeping the protection policy behind an interface lets the shared authentication workflow compose it in while the concrete cache mechanics stay in the implementation; the null-IP skip keeps the limiter from becoming an availability hazard ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:78`), which calls all five across its login and registration flows: `CheckLockoutAsync` (`:131`), `IncrementFailedAttemptsAsync` on both the unknown-email and wrong-password branches (`:146`, `:161`), `ResetFailedAttemptsAsync` on success (`:178`), `CheckRegistrationRateLimitAsync` (`:197`) and `IncrementRegistrationCountAsync` (`:256`). The concrete, cache-backed [LoginProtectionService](#loginprotectionservice) (tuned by [LoginProtectionSettings](#loginprotectionsettings), bound at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:148-151`) implements it, and the framework registers that pairing at `:135`.

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
- **Where it's used**: injected into the shared [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:38`, called at `:72`, where a throttled issue is logged and still answered as success) and into [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:46`, redeemed at `:61-62`). Both apps' sealed subclasses take the same dependency, for example ADC's [ForgotPasswordHandler](group-24-identity-module.md#forgotpasswordhandler) and [ResetPasswordHandler](group-24-identity-module.md#resetpasswordhandler). The framework registers the concrete as scoped at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:158`.

### IRoleAdministrationService
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IRoleAdministrationService.cs:29` · Level 3 · interface

- **What it is**: the application-layer contract for a role-permission administration screen: list every role with its compiled and stored permissions, read one role, read the closed catalog of roles and permissions an editor may pick from, and replace one role's stored permissions (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IRoleAdministrationService.cs:29-77`).
- **Depends on**: `RolePermissionsResponse` and `PermissionCatalogResponse` (both in `MMCA.Common.Application.Auth.Administration`), and [Result](group-01-result-error-handling.md#result) and its generic form.
- **Concept introduced: an editor's writable set is a strict subset of its readable catalog.** `[Rubric §11, Security]` assesses whether an administrative surface can grant more than it should. The remarks on `GetCatalogAsync` (`:311-315`) state that the permission list it returns is the **compiled** catalog, so an editor built from that response can never submit anything `SetStoredPermissionsAsync` would refuse as unknown, and the parameter doc on `SetStoredPermissionsAsync` (`:324-328`) adds the one hard exclusion: no submitted list may include `AdministrationPermissions.ManageRoles`, so a role editor can never grant a role the permission to edit roles.
- **Walkthrough**: four methods.
  - `ListRolesAsync(CancellationToken cancellationToken = default)` (`:297`) returns one `RolePermissionsResponse` per known role, ordered by role name.
  - `GetRoleAsync(string role, CancellationToken cancellationToken = default)` (`:305`) reads one role's compiled and stored permissions, matched case-insensitively, or a not-found failure.
  - `GetCatalogAsync(CancellationToken cancellationToken = default)` (`:318`) returns the two closed sets, roles and permissions, an editor renders from, both sorted ordinally.
  - `SetStoredPermissionsAsync(string role, IReadOnlyList<string> permissions, string? changedBy = null, CancellationToken cancellationToken = default)` (`:332-336`) replaces a role's stored permissions and invalidates the cached snapshot, recording an optional `changedBy` principal name on the rows it creates.
- **Why it's built this way**: separating the compiled catalog (`GetCatalogAsync`) from the writable operation (`SetStoredPermissionsAsync`), and stating the `ManageRoles` exclusion as a contract obligation rather than leaving it to each implementation, keeps every host's role editor equally safe against granting itself the permission that edits roles.
- **Where it's used**: implemented by `StoredPermissionRoleAdministrationService` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`); consumed by `RolesAdminControllerBase` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/RolesAdminControllerBase.cs`) and, through it, by each app's admin roles controller, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AdminRolesController.cs`; registered through `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### IUserAdministrationService<TUserDto>
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IUserAdministrationService.cs:24` · Level 3 · interface

- **What it is**: the application-layer contract for an account administration screen: list accounts paged and filtered, read one account, lock or unlock an account, and replace an account's roles (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IUserAdministrationService.cs:24-70`).
- **Depends on**: [UserAdministrationQuery](#useradministrationquery) (the list filter), `PagedCollectionResult<TUserDto>`, the `UserIdentifierType` alias, and [Result](group-01-result-error-handling.md#result) and its generic form. Generic over `TUserDto`, the app's shape for one row of the admin account list.
- **Concept introduced: locking an account is a workflow, not a flag flip.** `[Rubric §11, Security]` assesses whether an administrative action actually removes access rather than merely marking it removed. The remarks on `SetLockedAsync` (`:380-384`) state the obligation directly: an implementation that locks an account should also revoke its live refresh sessions, or the lock only takes effect once the current access token expires, and name [IRefreshSessionStore](#irefreshsessionstore) and [RefreshSessionRevocation](#refreshsessionrevocation)'s `RevokeAllAsync` as what the framework's own credential-rotation paths use for exactly that.
- **Walkthrough**: four methods.
  - `ListAsync(UserAdministrationQuery query, CancellationToken cancellationToken = default)` (`:365-367`) returns one page of `TUserDto`, with pagination metadata.
  - `GetAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:375`) reads one account, or a not-found failure.
  - `SetLockedAsync(UserIdentifierType userId, bool locked, CancellationToken cancellationToken = default)` (`:390`) locks or unlocks an account.
  - `SetRolesAsync(UserIdentifierType userId, IReadOnlyList<string> roles, CancellationToken cancellationToken = default)` (`:399-402`) replaces the complete set of roles an account holds.
- **Why it's built this way**: generic over `TUserDto` so each app's admin list can carry app-specific columns without the framework knowing about them, while the lock/unlock contract's remarks pin the one security-relevant behavior (session revocation on lock) as a documented obligation rather than leaving it to whichever app implements the interface first.
- **Where it's used**: consumed by `UsersAdminControllerBase` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs`); implemented by each app's `UserAdministrationService`, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Administration/UserAdministrationService.cs`, and registered through `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs`.

### IRefreshSessionStore
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:21` · Level 4 · interface

- **What it is**: persistence for [RefreshSession](#refreshsession) rows, the multi-device replacement for the single plaintext refresh-token column a user aggregate used to carry (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:5-7`). Sessions are added, looked up by token hash or by id, listed per user, rotated, and saved.
- **Depends on**: [RefreshSession](#refreshsession) from `MMCA.Common.Domain.Auth` (`:1`) and the `UserIdentifierType` alias. The shipped implementation is [EFRefreshSessionStore](group-07-persistence-ef-core.md#efrefreshsessionstore); the test doubles are [InMemoryRefreshSessionStore](group-28-testing-infrastructure.md#inmemoryrefreshsessionstore) and [FakeRefreshSessionStore](group-28-testing-infrastructure.md#fakerefreshsessionstore).
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
- **Where it's used**: registered as scoped against the EF implementation at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:166`, with the comment (`:143-144`) noting the lifetime is deliberate: scoped, like the unit of work it shares a `DbContext` with, so a login and its session insert commit together. Consumed throughout [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (injected at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:81`, exposed to subclasses at `:88`) for single-device sign-out (`:348-350`), session listing (`:404`), targeted revocation (`:441`), reuse resolution (`:592-594`), rotation (`:682-684`), family revocation (`:708`) and cap eviction (`:725`).

### SoftDeletedUserCache
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17` · Level 4 · class (static)

- **What it is**: the shared cache contract for the **soft-deleted user marker** (BR-133): the key shape, the marker lifetime, and a one-call helper that writes it. The API middleware reads the marker on every authenticated request; the module that soft-deletes a user writes it (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:6-9`).
- **Depends on**: [ICacheService](group-09-caching.md#icacheservice) from `MMCA.Common.Application.Interfaces` (`:2`), the `UserIdentifierType` alias, and `System.Globalization.CultureInfo` (BCL, `:1`).
- **Concept introduced: revoking a stateless credential without a per-request lookup.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access, and `[Rubric §12, Performance & Scalability]` assesses whether such a concern is factored so both ends share one definition. A JWT is a bearer credential: signature validation never asks "is this account still active?", so soft-deleting a user leaves an already-issued access token passing validation until it expires ([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)). The textbook fixes (a deny-list, or an account-status query on every request) reintroduce exactly the per-request state that stateless JWT was chosen to avoid. This type is the middle path: a short-lived cache marker written at deletion time and read cheaply on the hot path.

  The `remarks` (`:11-16`) explain why the constants live in the **Application** layer rather than next to the middleware that reads them: a downstream application deleting an account has to write the exact same key the middleware reads, and a private constant in the presentation layer is unreachable from an application-layer command handler. Same reasoning as [IdempotencyHeaders](#idempotencyheaders), applied one layer up.
- **Walkthrough**: three static members, no state.
  - `MarkerDuration => TimeSpan.FromSeconds(30)` (`:29`). The remarks (`:22-28`) justify the number rather than leaving it magic: the marker only has to cover the window between the delete committing and the next token validation, because once it expires the validator query is the source of truth again and gives the same answer. Short-lived access tokens (15 minutes, the BR-205 default on [ITokenService](#itokenservice)) bound the rest of the exposure, so a longer marker would buy nothing and would keep stale entries alive for users who were never deleted.
  - `KeyFor(UserIdentifierType userId)` (`:42-43`) builds `user:deleted:{userId}` through `string.Create(CultureInfo.InvariantCulture, ...)`. The remarks (`:36-41`) name the bug this prevents: an identifier renders differently under some cultures (digit shapes, group separators), so a culture-sensitive key would be written under one request's culture and missed under another, silently letting a deleted user keep making requests. This is a case where the analyzer rule about culture-invariant formatting is guarding a security property, not just a formatting nicety.
  - `MarkDeletedAsync(ICacheService cache, UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:53-61`) null-guards the cache (`:58`) and writes `true` under `KeyFor(userId)` for `MarkerDuration` (`:60`). It returns the task without awaiting, so there is no extra async state machine for a one-call passthrough.
- **Why it's built this way**: publishing the key shape and the TTL as framework API is what keeps the writer and the reader honest, and it is a precondition for the module boundary in [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html): Identity owns the delete, every service hosts the middleware, and the only thing they share is a cache entry rather than a database. `[Rubric §7, Microservices Readiness]` applies directly: an extracted service can enforce the revocation without a reference to the Identity database.
- **Where it's used**: read by [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which builds the key (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:85`), short-circuits with 401 when the marker is `true` (`:102-105`), and on a miss falls back to the validator query (`:113-115`) and caches **that** answer, deleted or not, for the same `MarkerDuration` (`:132`). Written by the shared delete workflow itself, ahead of either app's post-commit tail: `DeleteUserHandlerBase.HandleAsync` calls `SoftDeletedUserCache.MarkDeletedAsync` right after the erasure commits (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:142-144`) and swallows a cache fault (`:146-149`) so a failed marker cannot turn a successful erasure into an error the caller would retry.
- **Caveats / not-in-source**: the marker is best effort on both ends by design. The middleware fails **open** on a cache outage, falling through to the validator query (`:95-100`) and proceeding if that is also unavailable (`:118-125`), and the writer logs and continues on a cache fault. The exposure that leaves is bounded by the access-token lifetime, which is the trade-off ADR-047 accepts explicitly. ADC's handler is the only writer in the source tree today; MMCA.Store soft-deletes users without writing the marker, so there the middleware's own validator-query fallback is what enforces BR-133.

### AuthenticationValidators
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:16` · Level 5 · class (sealed)

- **What it is**: a tiny **parameter object** that bundles the three FluentValidation validators the authentication workflow needs (login, registration, refresh) into one injectable dependency.
- **Depends on**: FluentValidation's `IValidator<T>` (NuGet, `:1`) over the request DTOs [LoginRequest](#loginrequest), [RegisterRequest](#registerrequest), and [RefreshTokenRequest](#refreshtokenrequest) (all in `MMCA.Common.Shared.Auth`, `:2`).
- **Concept introduced: the parameter object as a constructor-arity guardrail.** `[Rubric §1, SOLID]` assesses whether a class stays a single, cohesive responsibility rather than sprawling into a god class, and `[Rubric §15, Best Practices & Code Quality]` assesses whether cross-cutting dependencies are grouped so a class can grow without exploding its constructor. The doc comment (`:6-11`) states the exact motive: collapsing three closely-related dependencies into one keeps the app's `AuthenticationService` **below the application-service constructor-arity ceiling** (a god-class analyzer guardrail) without giving up per-request validation. Because the request DTOs already live in `MMCA.Common.Shared.Auth`, the bundle is app-agnostic, which is why it could be hoisted out of the apps into the framework. The pressure is real rather than theoretical: even with the bundle, ADC's subclass constructor takes nine parameters (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:46-55`).
- **Walkthrough**: a primary constructor takes the three `IValidator<T>` instances (`:16-19`), and three get-only properties surface them by name: `Login` (`:22`), `Register` (`:25`), and `Refresh` (`:28`), each assigned from its matching constructor parameter. There is no logic here; the type exists purely to shrink the dependency footprint of its consumer.
- **Why it's built this way**: a `sealed` grouping type with get-only properties is the cheapest way to fold three cohesive dependencies into one constructor slot, so the workflow base can validate each request shape without pushing its constructor over the arity limit; DI resolves the three underlying validators and composes them into this one object. Two of the three ([LoginRequestValidator](#loginrequestvalidator), [RefreshTokenRequestValidator](#refreshtokenrequestvalidator)) come from the framework assembly, while `IValidator<RegisterRequest>` is satisfied by the app's own `RegisterRequestValidator`, so the bundle is the point where framework and app validation meet.
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (constructor parameter at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:80`), whose `LoginAsync`, `RegisterAsync`, and `RefreshTokenAsync` call `validators.Login` (`:124`), `validators.Register` (`:190`), and `validators.Refresh` (`:270`) respectively before doing any work. It is registered by each app's Identity module rather than by the framework, since one of its three dependencies is app-owned: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:36` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:42`, both `TryAddScoped<AuthenticationValidators>()`.

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

### RefreshSessionRevocation
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionRevocation.cs:17` · Level 5 · class (internal static)

- **What it is**: a single shared helper, `RevokeAllAsync`, that revokes every un-revoked refresh session a user holds. Used wherever a credential-rotation path needs to make sure a stale token cannot keep authenticating after the event that should have invalidated it.
- **Depends on**: [IRefreshSessionStore](#irefreshsessionstore) (nullable: a host that never registered one, because refresh sessions are opt-in, is a no-op), [RefreshSession](#refreshsession) (`.Revoke`, `RefreshSession.ReasonSignedOut`), and the BCL `TimeProvider`.
- **Concept introduced: a credential-rotation event is a call site, not a feature flag.** `[Rubric §11, Security]` assesses whether changing a credential actually invalidates the sessions issued under the old one. Because refresh sessions are opt-in ([RefreshSessionSettings](#refreshsessionsettings)`.Enabled`), a change-password or reset-password handler cannot assume a store exists; the doc comment states this directly (`:426-428`), and `refreshSessions is null` (`:439-442`) is checked first so the call degrades to a no-op rather than throwing, meaning the same handler code runs unchanged on a host that never enabled the feature.
- **Walkthrough**: one static method, `RevokeAllAsync(IRefreshSessionStore? refreshSessions, TimeProvider? timeProvider, UserIdentifierType userId, CancellationToken cancellationToken)` (`:433-437`). It returns immediately on a null store (`:439-442`) or an empty session list (`:446-449`), otherwise stamps `now` from the supplied `timeProvider` or `TimeProvider.System` (`:444`), calls `session.Revoke(now, RefreshSession.ReasonSignedOut)` on every un-revoked session in a loop (`:451-454`), and saves once (`:456`).
- **Why it's built this way**: `internal static` with no instance state keeps the helper a one-line call from any handler that needs it, and centralizing the null-store check here means every caller gets the same opt-in-safe behavior instead of re-deriving it.
- **Where it's used**: the documented mechanism behind [IUserAdministrationService<TUserDto>](#iuseradministrationservicetuserdto)'s `SetLockedAsync` obligation (see that type); also `ChangePasswordHandlerBase` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs`) and `ResetPasswordHandlerBase` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs`).

### AuthenticationServiceBase<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74` · Level 8 · class (abstract)

- **What it is**: the **shared authentication workflow** (login, registration, refresh-token rotation, per-device and global revocation, session listing) hoisted once into the framework, generic over the app's `User` aggregate. It realises [IAuthenticationService](#iauthenticationservice) and leaves the genuinely app-specific decisions to a small set of `abstract` and `virtual` hooks a sealed subclass overrides.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and [IRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (persistence, G07), [ITokenService](#itokenservice), [IPasswordHasher](#ipasswordhasher), [ILoginProtectionService](#iloginprotectionservice), [AuthenticationValidators](#authenticationvalidators), [IRefreshSessionStore](#irefreshsessionstore), `IOptions<`[RefreshSessionSettings](#refreshsessionsettings)`>` (the eight required constructor parameters, `:75-82`), and two optional ones added since: an [ITwoFactorAuthenticator](#itwofactorauthenticator)`?` and `IOptions<`[EmailConfirmationSettings](#emailconfirmationsettings)`>?` (`:83-84`, both default `null` so every existing subclass keeps compiling untouched), the [IAuthUser](#iauthuser) credential contract plus [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint (`:85`) and, where a host adopts confirmation, [IEmailConfirmableUser](#iemailconfirmableuser) (matched in `CheckEmailConfirmed`), [RefreshSession](#refreshsession) (the session aggregate it creates and revokes), [Email](group-02-domain-building-blocks.md#email) (normalizing the login and register address), [ClaimsPrincipalExtensions](#claimsprincipalextensions) (`principal.GetUserId()` and, new, `principal.FindMultiFactorMethod()`), [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error), the request and response DTOs, and the BCL `TimeProvider` (injected at `:79`, never `DateTime.UtcNow`, so the clock is testable).
- **Concept introduced: the Template Method that de-duplicates a whole vertical slice.** `[Rubric §2, Design Patterns]` assesses idiomatic pattern use: this is a textbook **Template Method**, the invariant sequence of an operation living in the base while the variable steps are deferred to subclass hooks. `[Rubric §15, Best Practices & Code Quality]` (DRY across services) and `[Rubric §1, SOLID]` also apply: the doc comment (`:14-19`) records that the app Identity modules previously duplicated this workflow at roughly 70 to 95 percent line-identity, so a fix to the lockout order or the rotation logic is written once. `[Rubric §11, Security]`: the base encodes the security posture directly, validate first, an [ILoginProtectionService](#iloginprotectionservice) lockout and rate-limit gate ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)), an untracked-then-tracked dual fetch ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)), and refresh-token rotation with **reuse detection** ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), BR-205/206). `[Rubric §7, Microservices Readiness]`: the workflow depends only on ports, so it runs unchanged whether the Identity module is in-monolith or its own service.

  **The session model is the other concept to absorb before reading the code** (`:35-47`). Refresh tokens are not a column on the user: every issue opens its own [RefreshSession](#refreshsession) row, the store holds only `RefreshSession.HashToken` digests, and rotation revokes the presented session and links it to its successor. Presenting an already-rotated token therefore lands on a revoked row, which is the reuse signal that revokes the user's whole live family (BR-206). Two requests presenting the same live token at the same instant get the same treatment, because the rotation is claimed atomically through `IRefreshSessionStore.TryRotateAsync` and the loser is answered as a replay rather than handed a second successor. An expired session is **not** a reuse signal and fails alone. A per-user cap evicts the oldest live session on a new sign-in so one account cannot grow the table without bound.
- **Walkthrough** (members in teaching order):
  - **Constructor and protected accessors** (`:74-86`): a primary constructor takes the eight required collaborators plus the two optional ones; a private field wraps the injected token service in a [SessionStampingTokenService](#sessionstampingtokenservice) (`:93`); a private `_multiFactorMethod` field (`:105`) is the base's own arming state for the second-factor claim, separate from and forwarded into the wrapper's `CurrentMultiFactorMethod`; protected read-only properties re-expose `UnitOfWork` (`:108`), the *wrapped* `TokenService` (`:120`, whose remarks explain that minting through this property is what puts `sid` on the token), `TimeProvider` (`:123`), `RefreshSessions` (`:126`), and a `Repository` resolved lazily as `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:129`).
  - **Lifetimes and cap**: `virtual` `AccessTokenLifetime` and `RefreshTokenLifetime` read through to [ITokenService](#itokenservice) (which derives them from `Jwt:AccessTokenExpirationMinutes` and `Jwt:RefreshTokenExpirationDays`), falling back to the BR-205 defaults of 15 minutes and 7 days on a non-positive value, meaning a hand-written test double or a misconfigured host. `virtual MaxActiveSessionsPerUser` reads `RefreshSessions:MaxActiveSessionsPerUser`.
  - **`LoginAsync`** (`:156-251`): validate the request, check lockout (ADR-029 and BR-212), normalize the raw email into an [Email](group-02-domain-building-blocks.md#email) value object so the EF predicate compares same-typed converted values (an invalid address yields a null value object that simply matches no user, which is the invalid-credentials answer anyway). **Step 1** is an *untracked* fetch via the `FindUntrackedByEmailAsync` hook to verify credentials without change-tracker overhead. The null check now also calls `HasStoredCredential(untracked)` (`:186`, private helper at `:890`): an account with no stored password material, the shape an external-OAuth account carries (ADR-036), can never be reached by password login, and both branches answer the identical generic 401 with the identical `BurnPasswordVerificationCost(request.Password)` call (`:188`, private helper at `:898`) so the two cases cost the same time and are indistinguishable to a timing observer, before `IncrementFailedAttemptsAsync`. `passwordHasher.VerifyPassword` runs next and fails the same way on a wrong password. Only after the password check does the app gate (`ValidateLoginCandidateAsync`) run, deliberately reordered: reaching it now proves the caller owns the account, so its distinct status message (for example a deactivated-account rejection) is told to the account's owner rather than to anyone sweeping addresses, and running it before the password check (the old order) made account state readable with no credential at all. Two more gates follow the same rule, for the same reason: `CheckEmailConfirmed(untracked)` (`:215`, hook at `:641-651`), off unless the host both supplied `EmailConfirmationSettings.RequireConfirmedEmail` and the app's `User` implements [IEmailConfirmableUser](#iemailconfirmableuser), and `ChallengeSecondFactorAsync(untracked.Id, request.TwoFactorCode, cancellationToken)` (`:221-222`, hook at `:665-671`), which with no [ITwoFactorAuthenticator](#itwofactorauthenticator) registered answers `TwoFactorOutcome.NotEnrolled` outright at no extra cost. **Step 2** is a *tracked* re-fetch by id, purely about the instance the app's `CreateAccessToken` hook mints from, and the second lookup is what turns a race that deleted the account between the two steps into a clean 404. Then `ResetFailedAttemptsAsync`, and `_multiFactorMethod = MultiFactorMethodFor(secondFactor.Value)` (`:242`, private helper at `:679-688`, mapping a verified TOTP or recovery code to the `mfa` claim value and any unrecognized outcome to `null`) arms the field in a `try`/`finally` around `IssueTokensAsync` so the claim lands only on this response and disarms whether or not the call throws.
  - **`RegisterAsync`** (`:254-331`): validate, IP rate-limit (ADR-029 and BR-213), reject a duplicate email through the `EmailExistsAsync` hook, hash the password, build the user through the `CreateUser` hook, `AddAsync` and `SaveChangesAsync`, run the `OnUserRegisteredAsync` post-commit hook to pick up the instance the first access token is minted from, increment the IP registration count, and open the session last: the session row carries the user id, which a store-generated key only has once the insert has run.

    The save is wrapped in a deliberately **broad** `catch (Exception)` whose comment is the teaching material. The email lookup above is a check-then-act: two concurrent registrations for the same address both pass it, and the loser only fails on the insert, against the unique index every consumer puts on `Email` (ADC unfiltered, Store filtered on `IsDeleted`). Without the catch, that race surfaces as a generic 500 instead of the 409 a serialized pair would have produced. The catch cannot name `DbUpdateException`, because Application has no EF Core dependency by layer rule, so the **re-check is what narrows it**: if the address exists now, the concurrent registration is the cause and the caller gets the same conflict the serial path returns through the shared `EmailAlreadyExistsFailure()` helper; anything else rethrows untouched and still reaches the exception middleware. The re-check passes `CancellationToken.None` on purpose: it has to run even when the caller's token is what aborted the save, or a cancelled save could never be classified.
  - **`RefreshTokenAsync`** (`:334-413`): validate, pull claims from the *expired* JWT via `tokenService.GetPrincipalFromExpiredToken` (signature still checked, only lifetime skipped), read the identifier with `principal.GetUserId()` (rides the standard `sub` claim, also accepts the `NameIdentifier` form the bearer handler maps it to, and parses through `IParsable` so the identifier alias can change shape without editing this file), load the tracked user, run the refresh app gate, resolve the session behind the presented token, rotate it, and answer with a token pair whose access token carries the **successor's** `sid`, a client's current-device marker following the rotation instead of pointing at the session the rotation just revoked. Since the second-factor addition, the step-up the user already performed is carried across the rotation too: `_multiFactorMethod = principal.FindMultiFactorMethod()` (`:398`) reads the `mfa` claim off the presented access token, whose signature was already validated, and arms it in a `try`/`finally` around the successor mint, the same disarm pattern as `LoginAsync`. Dropping it would quietly demote a signed-in session every access-token lifetime and make an `IRequiresMfa` use case unreachable without a fresh sign-in.
  - **`RevokeTokenAsync`** (`:416-454`): load the user, and when a refresh token was supplied, look up its session by hash. Only a **live session belonging to this user** identifies the device to sign out; anything else (unknown token, another account's token, an already-revoked row) leaves the caller unidentifiable, so the request degrades to revoking every live session rather than reporting success for a revocation that reached nothing.
  - **`RevokeAllSessionsAsync`** (`:457-472`): the unconditional form of the same thing.
  - **`GetSessionsAsync`** (`:481-505`): reads the same "un-revoked sessions for this user" query the cap and family revocation use, then drops expired rows in memory with `IsActiveAt(now)` and orders newest first with `Id` as the tie-break. The remarks explain why the filtering is in memory: the store returns expired-but-unrevoked rows on purpose, and a device list must not offer a user a device that can no longer authenticate.
  - **`RevokeSessionByIdAsync`** (`:519-543`): the ownership check *is* the store query, scoped to the user, so another account's id and a nonexistent id produce the same `NotFound`; an already-revoked session returns success without writing.
  - **`IssueTokensAsync`** (`:554-578`): the shared open-and-respond used by login and registration, and reusable by an app-level external-login flow. It opens the session **before** minting the access token, because the token carries the session's id, saves, and returns the response.
  - **The private mechanics**: `ResolveRotatableSessionAsync` (`:723`) is where the three rejections differ behind one identical error. An unknown hash, or one belonging to another account, is failed **alone**, because revoking the family on it would let anyone holding one of this user's expired access tokens sign them out everywhere by posting a random token. A **revoked** row means this exact token was already rotated away or signed out and has come back, which is the BR-206 reuse signal that revokes every live session. An **expired** row is an ordinary end of life and fails alone. `OpenSessionAsync` (`:762`) mints a token, creates the session, enforces the cap, and stages the insert, returning an [IssuedSession](#issuedsession). `RotateAsync` (`:801`) mints the successor and claims the rotation through `TryRotateAsync`; losing the claim is answered exactly like a replay. `RevokeLiveSessionsAsync` (`:844`) revokes without saving. `EnforceSessionCapAsync` (`:864`) revokes the oldest live sessions while the user is at or over the cap; expired-but-unrevoked rows do not count against the cap because they authenticate nobody, and age out through the retention sweep instead. `InvalidRefreshTokenError()` (`:883`) and `EmailAlreadyExistsFailure()` (`:915`) are the two shared failures that keep distinct internal paths indistinguishable to a caller.
  - **The hooks**: four are `abstract`, so a subclass must supply them. `FindUntrackedByEmailAsync` (`:585`) and `EmailExistsAsync` (`:591`) are deliberately written against the app's concrete `User` so EF translates the predicate byte-for-byte as before, and the second explicitly leaves the app to decide whether soft-deleted accounts count (`ignoreQueryFilters: true` blocks re-registration of an erased address); `CreateUser` (`:594`) runs the app's domain factory; `CreateAccessToken` (`:597`) mints the app's claim set (for example `speaker_id` versus `customer_id`). Seven `virtual` members can be overridden, up from five: `CreateAccessTokenForSession` (`:618-631`) arms the stamping wrapper (both the session and, now, the multi-factor property) around the hook call; `CheckEmailConfirmed` (`:641-651`), new, is the email-confirmation sign-in gate, off unless the host supplied `EmailConfirmationSettings.RequireConfirmedEmail` and the app's `User` implements [IEmailConfirmableUser](#iemailconfirmableuser); `ChallengeSecondFactorAsync` (`:665-671`), new, runs the second-factor challenge and, with no [ITwoFactorAuthenticator](#itwofactorauthenticator) injected, answers `TwoFactorOutcome.NotEnrolled` with no extra query, which is what keeps the feature free for an app that has not adopted it; `ValidateLoginCandidateAsync` (`:691`) and `ValidateRefreshCandidateAsync` (`:695`) add extra gates such as a deactivated-account check; `OnUserRegisteredAsync` (`:702`) runs the post-commit side-effect; and `CreateRefreshUserMissingError` (`:710`) defaults the vanished-user case to 401 (a token for a missing user is indistinguishable from an invalid one) while letting an app return 404 where its public contract already promises it.
- **Why it's built this way**: the untracked-then-tracked dual fetch keeps the common credential-verification path off the change tracker (cheaper, and soft-deleted accounts fall out via EF query filters returning the generic 401) while still giving a tracked instance to mint from ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). Per-device session rows with hashed tokens, rotation, family revocation on reuse, and a per-user cap are the BR-205/206 model ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)). Password material flows through [IAuthUser](#iauthuser)'s `PasswordHash` and `PasswordSalt` ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)), and the whole workflow depends only on abstractions, so it is identical whether the module runs in-process or as an extracted service.
- **Where it's used**: subclassed by each app's sealed [AuthenticationService](group-24-identity-module.md#authenticationservice), for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:46`, which binds `TUser = User`, adds the Attendee default role (BR-45) and the `speaker_id` claim (BR-209, built at `:275`), and re-lists `IAuthenticationService` (`:63`) so it can re-implement `RegisterAsync` and `ExternalLoginAsync` outright: ADC raises its registration side-effects inside one transactional unit rather than through the `OnUserRegisteredAsync` hook, because the identity column means the id does not exist until the first save (`AuthenticationService.cs:28-39`). MMCA.Store supplies its own subclass with a `customer_id` claim. Consumed by the Identity API controllers via the [IAuthenticationService](#iauthenticationservice) port.
- **Caveats / not-in-source**: `ExternalLoginAsync` is intentionally **not** overridden here: the base inherits the interface's default not-supported failure, and OAuth account linking stays in the app subclass because it is coupled to the app's `User` factory surface (doc comment, `:33-34`).

### EmailConfirmationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth.EmailConfirmation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/EmailConfirmationSettings.cs:10` · Level 0 · class

- **What it is**: the options class bound to the `Authentication:EmailConfirmation` configuration section (`EmailConfirmationSettings.cs:28`), controlling token lifetime, throttling, and whether an unconfirmed address blocks sign-in.
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations` (`[Range]`) and `System.Diagnostics.CodeAnalysis` (`[SuppressMessage]`) validate the bound values.
- **Concept introduced**: the config-bound settings-class shape (a `SectionName` constant plus `init`-only, range-validated properties with sane defaults) is the same one the sibling `PasswordResetSettings` uses elsewhere in this group; see it there for the general pattern rather than re-teaching it here. `[Rubric §11, Security]` (assesses whether authentication-adjacent behavior is safely configurable): every numeric knob here is range-constrained (`EmailConfirmationSettings.cs:43,50,54,58`), so a bad value in configuration fails validation instead of silently disabling throttling.
- **Walkthrough**: `ConfirmationUrl` (`EmailConfirmationSettings.cs:40`) defaults to empty rather than being `[Required]`, deliberately, per its own doc comment (`EmailConfirmationSettings.cs:30-34`): an unconfigured host still boots and degrades to a token-only, paste-in-by-hand flow. `TokenLifetimeMinutes` (line 44) defaults to 1440 (one day). `MaxValidationAttempts` (line 51) caps wrong-token guesses at 5 before the record is discarded. `MaxRequestsPerEmail` (line 55) and `RequestWindowMinutes` (line 59) throttle re-issuance per address. `RequireConfirmedEmail` (line 70) defaults to `false`.
- **Why it's built this way**: the `RequireConfirmedEmail` default is called out as load-bearing in its own remarks (`EmailConfirmationSettings.cs:64-69`): turning it on locks out every account whose address was never confirmed, so a host backfills existing rows as confirmed before flipping it, and with it off the whole feature is additive. This is the opt-in shape recorded in [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).
- **Where it's used**: read by `AuthenticationServiceBase` and `EmailConfirmationTokenService` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs`) and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`; ADC binds it via `MMCA.ADC.Identity.Application/Users/AuthenticationServiceSettings.cs` and consumes it in `SendEmailConfirmationHandler`.

### IPermissionGrantCache
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/IPermissionGrantCache.cs:21` · Level 0 · interface

- **What it is**: the read side of the in-memory snapshot of stored (database-granted, as opposed to compiled-into-code) permissions, keyed by role.
- **Depends on**: nothing first-party in its own signature; consumed alongside `IPermissionRegistry`.
- **Concept introduced**: the cache-in-front-of-a-store pattern used across this group for data that is read on every authorization check but changes rarely. `[Rubric §12, Performance & Scalability]` (assesses whether hot paths avoid a database round trip): `GetPermissions` (`IPermissionGrantCache.cs:99`) is synchronous and reads the already-loaded snapshot, so it stays off the authorization hot path's I/O.
- **Walkthrough**: `GetPermissions(string role)` (line 99) returns the role's stored permissions, matched case-insensitively, empty when the role has none or the cache has not loaded yet. `RefreshAsync` (line 107) reloads the whole snapshot from the store; called at startup, on a configured interval, and explicitly by [IPermissionGrantCacheInvalidator](#ipermissiongrantcacheinvalidator) after a grant changes.
- **Why it's built this way**: separating the read interface from the invalidation interface ([IPermissionGrantCacheInvalidator](#ipermissiongrantcacheinvalidator)) lets [LayeredPermissionRegistry](#layeredpermissionregistry), which only needs to read, depend on a narrower contract than the administration path that needs to force a reload.
- **Where it's used**: implemented by `PermissionGrantCache` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/PermissionGrantCache.cs`), read by [LayeredPermissionRegistry](#layeredpermissionregistry) (`LayeredPermissionRegistry.cs`) and `StoredPermissionRoleAdministrationService`, and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### IPermissionGrantCacheInvalidator
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/IPermissionGrantCache.cs:51` · Level 0 · interface

- **What it is**: the write-triggering half of the cache: forces a reload of one role's grants (or every role) after an administrative change.
- **Depends on**: nothing first-party in its own signature.
- **Concept**: same cache-invalidation split introduced at [IPermissionGrantCache](#ipermissiongrantcache); no new concept here.
- **Walkthrough**: `InvalidateAsync(string? role = null, ...)` (`IPermissionGrantCache.cs:136`) invalidates the cached grants and reloads them; `null` means every role.
- **Why it's built this way**: kept on a separate, narrower interface from the read side so a caller that only grants or revokes (the administration surface) depends on exactly the capability it needs.
- **Where it's used**: implemented alongside `IPermissionGrantCache` by `PermissionGrantCache.cs`, called by `StoredPermissionRoleAdministrationService.cs` after a grant or revoke, and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### PermissionGrantSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/PermissionGrantSettings.cs:9` · Level 0 · class

- **What it is**: the options class bound to `Authentication:PermissionGrants`, controlling how long a cached grant snapshot is served, which logical data source owns the grant table, and which role names the administration surface lists.
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations` (`[Range]`, `[Required]`).
- **Concept**: the same config-bound settings shape as [EmailConfirmationSettings](#emailconfirmationsettings); no new concept.
- **Walkthrough**: `CacheSeconds` (`PermissionGrantSettings.cs:171`) defaults to 300 (five minutes) and its remarks (lines 165-169) spell out the trade-off: this is the bound on how stale another replica may be after an edit, since invalidation is per process. `DataSourceName` (line 179) defaults to `"Default"`, naming the logical data source a modular host points at its Identity database. `KnownRoles` (line 191) defaults to an empty list, and its remarks (lines 185-190) explain why it must be configured: neither `IPermissionRegistry` (which knows about a role but does not enumerate roles) nor the grant table (which only knows roles that already have a grant) can list roles on its own.
- **Why it's built this way**: a five-minute cache treats a permission grant as an administrative change rather than a per-request one, trading a shorter staleness window for more database reads if lowered.
- **Where it's used**: read by `PermissionGrantCache.cs`, `PermissionGrantRefreshService.cs`, `StoredPermissionRoleAdministrationService.cs`, and `DesignTimeDbContextHelper.cs`; registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### RecoveryCodeSet
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorService.cs:84` · Level 0 · record

- **What it is**: a two-field record pairing a freshly generated set of plaintext recovery codes with their stored hashes.
- **Depends on**: nothing first-party.
- **Concept**: a plaintext/hash pair returned once, at generation time only, so the plaintext never has to be persisted or re-derived.
- **Walkthrough**: `Codes` (`ITwoFactorService.cs:85`) is the plaintext shown to the user once; `Hashes` (line 86) is what the store keeps.
- **Why it's built this way**: keeping the plaintext out of any store means a database compromise cannot recover usable recovery codes, only their hashes.
- **Where it's used**: returned by [ITwoFactorService](#itwofactorservice).`GenerateRecoveryCodes()`, consumed by `TotpTwoFactorService.cs` and exercised in `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/TwoFactorHandlerBaseTests.cs`.

### TwoFactorOutcome
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorAuthenticator.cs:47` · Level 0 · enum

- **What it is**: the result of a second-factor challenge: `NotEnrolled = 0`, `VerifiedTotp = 1`, `VerifiedRecoveryCode = 2` (`ITwoFactorAuthenticator.cs:237,240,243`).
- **Depends on**: nothing first-party.
- **Concept**: same explicitly-numbered, wire-stable outcome-enum shape used throughout the domain event taxonomy (see `DomainEntityState` in group-02); `NotEnrolled = 0` is the default/no-op value, matching that convention.
- **Walkthrough**: three values; `NotEnrolled` means the account has no active second factor so nothing was challenged, `VerifiedTotp` means a time-based code from the authenticator app verified, `VerifiedRecoveryCode` means a single-use recovery code verified and was spent.
- **Why it's built this way**: collapsing the challenge result to one enum lets `AuthenticationServiceBase` decide, in one switch, whether to continue sign-in unchanged (`NotEnrolled`) or stamp an `mfa` claim on the issued token (the two verified cases).
- **Where it's used**: returned by [ITwoFactorAuthenticator](#itwofactorauthenticator).`ChallengeAsync`, read by `AuthenticationServiceBase.cs` (7 sites) and `TwoFactorAuthenticator.cs` (7 sites), and by the disable/regenerate handler bases.

### TwoFactorSettings
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/TwoFactorSettings.cs:15` · Level 0 · class

- **What it is**: the options class bound to `Authentication:TwoFactor`, controlling the TOTP parameters (issuer, digits, period, clock-skew window) and the recovery-code and secret sizing.
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations` (`[Range]`, `[Required]`, `[StringLength]`).
- **Concept**: the same config-bound settings shape as [EmailConfirmationSettings](#emailconfirmationsettings); no new concept.
- **Walkthrough**: `Issuer` (`TwoFactorSettings.cs:275`) defaults to `"MMCA"` and labels the account in the authenticator app. `Digits` (line 279) defaults to 6. `PeriodSeconds` (line 283) defaults to 30. `VerificationWindowSteps` (line 295) defaults to 1, and its remarks (lines 285-293) explain the trade-off: one step widens acceptance to roughly ninety seconds to tolerate clock skew, while a larger window multiplies how many codes are live at once for an attacker guessing. `RecoveryCodeCount` (line 299) defaults to 10. `RecoveryCodeByteLength` (line 306) defaults to 10 bytes (eighty bits). `SecretByteLength` (line 310) defaults to 20 bytes, the RFC 4226 recommendation.
- **Why it's built this way**: every size and window is a documented security/usability trade-off rather than an arbitrary constant, per [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).
- **Where it's used**: read by `TotpTwoFactorService.cs` (2 sites) and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### ITwoFactorService
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorService.cs:16` · Level 1 · interface

- **What it is**: the TOTP/authenticator-app abstraction: mints secrets, builds the provisioning URI, verifies codes, and generates/hashes/matches recovery codes.
- **Depends on**: [RecoveryCodeSet](#recoverycodeset) (return type of `GenerateRecoveryCodes`).
- **Concept introduced**: a service interface that isolates the cryptographic mechanics of TOTP (RFC 6238-style time-based codes) from the account-state orchestration that lives in [ITwoFactorAuthenticator](#itwofactorauthenticator). `[Rubric §1, SOLID]` (assesses single-responsibility separation): this interface only knows about codes and secrets, never about a user account or a store.
- **Walkthrough**: `GenerateSecret()` (`ITwoFactorService.cs:337`) mints a fresh Base32 secret. `BuildProvisioningUri(secret, accountName)` (line 352) builds the `otpauth://totp/...` URI an authenticator app scans as a QR code; it is deliberately returned as `string` rather than `System.Uri` (the `[SuppressMessage]` at lines 348-351 explains that round-tripping through `Uri` would re-normalize the percent-encoding the app parses). `VerifyCode(secret, code)` (line 361) checks a code within the configured window. `GenerateRecoveryCodes()` (line 368) returns a fresh [RecoveryCodeSet](#recoverycodeset). `HashRecoveryCode(code)` (line 376) hashes one plaintext code the way the store keeps it. `TryMatchRecoveryCode(code, storedHashes, out matchedHash)` (line 385) compares in fixed time to avoid a timing side-channel on which stored hash matched.
- **Why it's built this way**: keeping code verification, secret generation, and recovery-code hashing behind one narrow interface means [ITwoFactorAuthenticator](#itwofactorauthenticator) and the handler bases never touch a raw cryptographic primitive directly.
- **Where it's used**: implemented by `TotpTwoFactorService` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TotpTwoFactorService.cs`), consumed by the enrollment/regeneration handler bases in `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/` and by `TwoFactorAuthenticator.cs`, and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### LayeredPermissionRegistry
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/LayeredPermissionRegistry.cs:30` · Level 1 · class

- **What it is**: an `IPermissionRegistry` decorator that unions the compiled-into-code permission set with the stored (database-granted) set, so a role's effective permissions are "compiled OR granted", never a replacement of one by the other.
- **Depends on**: `IPermissionRegistry` (the inner, compiled registry), [IPermissionGrantCache](#ipermissiongrantcache) (the stored-grant cache).
- **Concept introduced**: the decorator pattern applied to a registry lookup. `[Rubric §2, Design Patterns]` (assesses whether a pattern is used idiomatically and solves a real problem): `LayeredPermissionRegistry` wraps `inner` without changing its contract, adding a second data source transparently to every caller of `IPermissionRegistry`.
- **Walkthrough**: the type is a primary-constructor class taking `inner` and `grants` (`LayeredPermissionRegistry.cs:406-408`). `GetPermissions(role)` (lines 411-428) reads both layers; when the stored set is empty it returns the compiled set as-is (no allocation), and only when both layers contribute does it materialize a `HashSet<string>` union, per the comment at lines 421-423: this call is a reporting path (administration surface, diagnostics), not the hot authorization path. `HasPermission(roles, permission)` (lines 431-442) is that hot path: it short-circuits on the compiled registry first (`inner.HasPermission`), and only falls through to a per-role stored-grant lookup (`grants.GetPermissions(role).Contains(permission)`) when the compiled check fails; the caller's `roles` sequence is materialized once (line 438) because both passes would otherwise enumerate it twice.
- **Why it's built this way**: separating the always-cheap compiled check from the stored-grant fallback keeps the common case (a permission granted in code) allocation-free and single-pass, per [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html), which records the opt-in database-grant layer as additive on top of the existing compiled registry.
- **Where it's used**: registered as the `IPermissionRegistry` implementation in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs` (3 sites) when database grants are enabled; exercised directly in `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/LayeredPermissionRegistryTests.cs`.

### EmailConfirmationErrors
> MMCA.Common.Application · `MMCA.Common.Application.Auth.EmailConfirmation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/EmailConfirmationErrors.cs:9` · Level 2 · class

- **What it is**: the static `Error`-factory class for the email-confirmation flow: one factory for a sign-in refused because the address is unconfirmed, one for every failing token redemption.
- **Depends on**: `Error` (the Result-pattern error type taught in the primer).
- **Concept**: the same named-code-plus-factory-method convention used by every `*Errors` class in this codebase (see [AuthErrorCodes](#autherrorcodes) for the general shape); no new concept here.
- **Walkthrough**: `EmailNotConfirmedCode` (`EmailConfirmationErrors.cs:466`) and `InvalidTokenCode` (line 469) are the two error codes. `EmailNotConfirmed(source)` (lines 479-482) returns `Error.Unauthorized`, distinct from `Auth.InvalidCredentials` so a UI can offer to resend the link. `InvalidToken(source)` (lines 487-490) is the single rejection every failing redemption (unknown, expired, mismatched, or attempt-capped token) collapses to.
- **Why it's built this way**: the doc comment on `EmailNotConfirmed` (lines 474-478) explains it is reachable only after the password has already been proved, so the message can safely tell the account owner what is wrong rather than help an address sweeper enumerate valid accounts; `InvalidToken` collapsing every failure mode to one message denies an attacker any signal about which reason a redemption failed for.
- **Where it's used**: raised by `ConfirmEmailHandlerBase.cs` (2 sites) and `AuthenticationServiceBase.cs`, and by `EmailConfirmationTokenService.cs`; asserted against in `EmailConfirmationHandlerBaseTests.cs`, `EmailConfirmationTokenServiceTests.cs`, and ADC's `ConfirmEmailHandlerTests.cs`.

### TwoFactorErrors
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/TwoFactorErrors.cs:15` · Level 2 · class

- **What it is**: the static `Error`-factory class for the two-factor flow: challenge-required, challenge-invalid, not-enrolled, and enrollment-missing.
- **Depends on**: `Error`.
- **Concept**: same convention as [EmailConfirmationErrors](#emailconfirmationerrors); no new concept.
- **Walkthrough**: four codes (`TwoFactorErrors.cs:514,517,520,523`). `TwoFactorRequired(source)` (lines 528-531) is `Error.Unauthorized`, asking the caller to supply a code or a recovery code. `TwoFactorInvalid(source)` (lines 541-544) is also `Error.Unauthorized`; its remarks (lines 536-540) note it is deliberately the same message for a wrong TOTP code and a wrong recovery code, since telling them apart would leak whether a presented value was recovery-code shaped. `TwoFactorNotEnrolled(source)` (lines 549-552) and `TwoFactorEnrollmentMissing(source)` (lines 557-560) are both `Error.Conflict`, for an action attempted on an account with no active factor and on an enrollment that was never started, respectively.
- **Why it's built this way**: `Conflict` versus `Unauthorized` is used to distinguish "your account state does not support this action" from "your credentials did not verify", matching the semantics the rest of the auth surface uses for those two error kinds.
- **Where it's used**: raised by `ConfirmTwoFactorEnrollmentHandlerBase.cs` (2 sites), `TwoFactorAuthenticator.cs` (2 sites), `DisableTwoFactorHandlerBase.cs`, and `RegenerateRecoveryCodesHandlerBase.cs`; asserted in `TwoFactorHandlerBaseTests.cs`, `AuthenticationServiceIdentityCompletionsTests.cs`, and `TwoFactorAuthenticatorTests.cs`.

### IEmailConfirmationTokenService
> MMCA.Common.Application · `MMCA.Common.Application.Auth.EmailConfirmation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/EmailConfirmation/IEmailConfirmationTokenService.cs:15` · Level 3 · interface

- **What it is**: the token-lifecycle abstraction for email confirmation: issue a token for an address, validate and consume one presented back.
- **Depends on**: `UserIdentifierType` (the module's identifier-type alias), `Result<T>`.
- **Concept**: an issue/validate-and-consume token contract, mirroring the shape `IPasswordResetTokenService` uses elsewhere in this group; no new concept.
- **Walkthrough**: `IssueAsync(email, userId, cancellationToken)` (`IEmailConfirmationTokenService.cs:594`) replaces any token already outstanding for that address, so there is one active token per address, and fails only when the per-address request throttle ([EmailConfirmationSettings](#emailconfirmationsettings).`MaxRequestsPerEmail`/`RequestWindowMinutes`) has been exceeded. `ValidateAndConsumeAsync(email, token, cancellationToken)` (line 607) validates against the outstanding token and consumes it on success so it never redeems twice, collapsing unknown/expired/mismatched/attempt-capped failures to the single [EmailConfirmationErrors](#emailconfirmationerrors).`InvalidToken` error.
- **Why it's built this way**: consuming on success is what makes redemption single-use; collapsing every failure reason to one error, per its own doc comment (lines 603-606), denies an attacker signal about why a guess failed.
- **Where it's used**: implemented by `EmailConfirmationTokenService` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs`), consumed by `SendEmailConfirmationHandlerBase.cs` and `ConfirmEmailHandlerBase.cs`, and by ADC's `SendEmailConfirmationHandler.cs`/`ConfirmEmailHandler.cs`; registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### ITwoFactorAuthenticator
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorAuthenticator.cs:24` · Level 3 · interface

- **What it is**: the account-level orchestration for the second-factor challenge at sign-in, one level above [ITwoFactorService](#itwofactorservice)'s pure cryptographic operations.
- **Depends on**: `UserIdentifierType`, [TwoFactorOutcome](#twofactoroutcome), [TwoFactorErrors](#twofactorerrors), `Result<T>`.
- **Concept**: the service-orchestrates-over-a-crypto-primitive layering also seen with [IEmailConfirmationTokenService](#iemailconfirmationtokenservice) versus its store; no new concept.
- **Walkthrough**: `ChallengeAsync(userId, code, cancellationToken)` (`ITwoFactorAuthenticator.cs:644-647`) returns [TwoFactorOutcome](#twofactoroutcome).`NotEnrolled` when the account has no active second factor (sign-in continues unchanged, no `mfa` claim), the verified outcome when a code satisfies the challenge, or a failure: [TwoFactorErrors](#twofactorerrors).`TwoFactorRequiredCode` when a code was needed and none arrived, [TwoFactorErrors](#twofactorerrors).`TwoFactorInvalidCode` when one arrived and did not verify (doc comment lines 636-643).
- **Why it's built this way**: returning an outcome enum rather than a bare boolean lets `AuthenticationServiceBase` distinguish "no second factor configured" from "verified", which matters for whether it stamps an `mfa` claim on the issued token.
- **Where it's used**: implemented by `TwoFactorAuthenticator` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs`), called from `AuthenticationServiceBase.cs` (2 sites) and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### ITwoFactorStore
> MMCA.Common.Application · `MMCA.Common.Application.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorStore.cs:24` · Level 3 · interface

- **What it is**: the persistence abstraction for one account's two-factor state: enrollment lifecycle, recovery-code replacement, and single recovery-code consumption.
- **Depends on**: `UserIdentifierType`, `ITwoFactorUserState` (the read shape, taught elsewhere in this group), `Result`.
- **Concept**: a two-phase enrollment (start, then complete) so an abandoned setup cannot lock an account out; the same two-phase shape a reader has already seen in other enrollment-style flows in this group.
- **Walkthrough**: `GetAsync(userId, cancellationToken)` (`ITwoFactorStore.cs:678`) returns `null` only when the account itself does not exist; an account that never enrolled still returns a state with `IsTwoFactorEnabled = false`. `StartEnrollmentAsync(userId, secret, cancellationToken)` (line 688) stores a freshly minted secret WITHOUT activating the factor, per its remarks (lines 681-683), so an abandoned enrollment cannot lock the user out. `CompleteEnrollmentAsync(userId, recoveryCodeHashes, cancellationToken)` (lines 698-701) activates the factor and stores the first recovery-code hashes, called only after a code from the stored secret has verified. `DisableAsync(userId, cancellationToken)` (line 710) turns the factor off and clears the secret and recovery codes, so a later re-enrollment starts from a fresh secret. `ReplaceRecoveryCodesAsync(userId, recoveryCodeHashes, cancellationToken)` (lines 720-723) replaces the whole set, never appends, since regeneration exists to invalidate a list the user believes compromised. `ConsumeRecoveryCodeAsync(userId, recoveryCodeHash, cancellationToken)` (lines 737-740) removes one hash to spend it, and its remarks (lines 728-731) flag this as security-critical: it must persist before the sign-in it authorized is answered, or the same code could sign in twice.
- **Why it's built this way**: splitting `StartEnrollmentAsync`/`CompleteEnrollmentAsync` prevents a half-finished enrollment from ever becoming an active, un-verified second factor.
- **Where it's used**: implemented and called by `TwoFactorAuthenticator.cs` (2 sites) through the enrollment/disable/regenerate handler bases in `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/`, and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### IPermissionGrantStore
> MMCA.Common.Application · `MMCA.Common.Application.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Permissions/IPermissionGrantStore.cs:16` · Level 4 · interface

- **What it is**: the persistence abstraction behind the stored-grant layer: read every grant, read one role's grants, grant a permission, revoke a permission.
- **Depends on**: `PermissionGrant` (the persisted grant row), `Result`.
- **Concept**: an idempotent grant/revoke pair, so a click repeated by an administration UI is not an error; no new concept beyond that idempotency guarantee.
- **Walkthrough**: `GetAllAsync(cancellationToken)` (`IPermissionGrantStore.cs:768`) reads every stored row, used to build the in-memory snapshot the authorization path reads. `GetPermissionsAsync(role, cancellationToken)` (line 776) reads one role's stored permissions for the administration surface. `GrantAsync(role, permission, grantedBy, cancellationToken)` (lines 787-791) grants a permission, succeeding and writing nothing when the role already has it stored (doc comment lines 778-780). `RevokeAsync(role, permission, cancellationToken)` (line 805) removes a stored grant, also idempotent; its remarks (lines 796-800) are explicit that this removes only the STORED grant, never a compiled-into-code one, which is exactly what keeps a data edit from disabling an endpoint the code guarantees.
- **Why it's built this way**: the "stored grant is additive, never subtractive over compiled permissions" rule enforced here is the same invariant [LayeredPermissionRegistry](#layeredpermissionregistry).`HasPermission` implements: the compiled check always wins first, and revoking a stored grant can never take away a compiled-in permission.
- **Where it's used**: implemented by `EFPermissionGrantStore` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFPermissionGrantStore.cs`), read by `PermissionGrantCache.cs` (2 sites) to build the [IPermissionGrantCache](#ipermissiongrantcache) snapshot, called by [IRoleAdministrationService](#iroleadministrationservice)'s implementation `StoredPermissionRoleAdministrationService.cs` (2 sites), and registered in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`.

### IPasswordHasher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:6` · Level 0 · interface

- **What it is**: the password-security port. Two methods: hash a plaintext password into a separated `(byte[] Hash, byte[] Salt)` pair, and verify a plaintext against a stored hash plus salt.
- **Depends on**: nothing first-party, BCL only (`byte[]`). Its Infrastructure adapter is [PasswordHasher](#passwordhasher).
- **Concept introduced: hash and salt kept apart.** `[Rubric §11, Security]` assesses credential handling. Returning the hash and the salt as two distinct `byte[]` members (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:11`) rather than one concatenated blob keeps the storage contract explicit: the caller persists two columns, and `VerifyPassword` (`:18`) is unambiguous about what it re-derives and compares. Because the algorithm and its parameters live entirely behind this interface, they can be strengthened without touching a single Application handler ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) sets the current hashing policy, applied inside [PasswordHasher](#passwordhasher)).
- **Walkthrough**: `(byte[] Hash, byte[] Salt) HashPassword(string password)` (`:11`) returns a named value tuple the caller stores as two fields. `bool VerifyPassword(string password, byte[] hash, byte[] salt)` (`:18`) re-derives from the supplied salt and compares. The interface declares no iteration count, algorithm identifier, or format version: every one of those is the concrete's business.
- **Why it's built this way**: a two-method port is the `[Rubric §1, SOLID]` dependency-inversion story in miniature. Swapping the key-derivation function or raising the iteration count is an Infrastructure change, invisible to the register, login, and change-password use cases that only ever see this contract.
- **Where it's used**: constructor-injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:77`), which calls `VerifyPassword` on the login path (`:159`) and `HashPassword` on registration (`:210`); into the shared [ChangePasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand), which verifies the current password (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:79`) before hashing the new one (`:61`); into [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand), which hashes the replacement after the token redeems (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:94`); and into the per-app Identity services, handlers and seeders that derive from those, for example ADC's [AuthenticationService](group-24-identity-module.md#authenticationservice) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:49`), its `ChangePasswordHandler` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:26`) and its module seeder (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:34`, which needs the hasher because seed data carries plaintext credentials).

### ISoftDeletedUserValidator
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7` · Level 0 · interface

- **What it is**: a single-method port that answers "has this account been soft-deleted?", called after JWT authentication to reject a soft-deleted user who still holds a valid, unexpired token (BR-133, named in the type comment at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:4`).
- **Depends on**: BCL plus the solution-wide `UserIdentifierType` alias (`:15`). See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) for the alias convention and [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for soft-delete versus erasure. The generic implementation is [SoftDeletedUserValidator<TUser>](group-14-module-system-composition.md#softdeleteduservalidatortuser).
- **Concept introduced: closing the stateless-token window.** `[Rubric §11, Security]` assesses whether revocation is timely. A JWT is stateless: once signed it stays valid until `exp`, even if the account behind it was deleted a minute later. This port lets middleware re-ask the question on every authenticated request and fail the request when the answer is yes, with no per-handler code. The comment at `:5` states the second motive: the interface is declared in Application and implemented against the app's own `User` aggregate precisely so the middleware never takes a cross-module domain reference. That is the same dependency inversion as the other ports in this group, applied to a cross-module read.
- **Walkthrough**: one member, `Task<bool> IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:15`). One question, one answer, cancellable.
- **Where it's used**: [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware) resolves it lazily from the request scope (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75` calls `context.RequestServices.GetService<ISoftDeletedUserValidator>()`, so a host that registers no implementation simply skips the check; the reason is stated at `:43`) and queries it on a cache miss (`:113-115`). Both apps register the shared generic against their own user type: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:43`, both as `TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()`.

### ITokenService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:8` · Level 0 · interface

- **What it is**: the token-minting port called by the login and refresh use cases. It builds a signed JWT access token from explicit identity facts, generates an opaque refresh token, publishes the two token lifetimes, and recovers the `ClaimsPrincipal` from an expired-but-validly-signed access token.
- **Depends on**: `System.Security.Claims` (BCL, `:1`) and the `UserIdentifierType` alias. Its Infrastructure adapter is [TokenService](#tokenservice), which signs with the RSA key surfaced by [IJwksProvider](#ijwksprovider); [SessionStampingTokenService](#sessionstampingtokenservice) is a second, internal implementation that decorates the first.
- **Concept introduced: token creation as an Infrastructure detail.** `[Rubric §3, Clean Architecture]` assesses whether library-specific types stay out of the inner layers: the handlers call this contract and never see `System.IdentityModel.Tokens.Jwt`. `GetPrincipalFromExpiredToken` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:48`) is the linchpin of the refresh flow: it validates the signature while deliberately ignoring lifetime, so an expired access token can still identify the user whose tokens are being rotated, returning `null` when the token is invalid (`:47`).
- **Walkthrough**: `GenerateAccessToken(UserIdentifierType userId, string email, string role, string fullName, IEnumerable<Claim>? additionalClaims = null)` (`:17-22`) takes the minimum claim set as typed parameters rather than a ready-made principal, with an escape hatch for module-specific claims. `GenerateRefreshToken()` (`:26`) returns a cryptographically random base64 string. Two **default interface members** publish the lifetimes: `AccessTokenLifetime` (`:33`, defaulting to 15 minutes) and `RefreshTokenLifetime` (`:40`, defaulting to 7 days), both documented as the BR-205 baseline. The comments at `:28-32` and `:35-39` explain the split: the real implementation derives both from the bound JWT settings, so the expiry reported to a client matches the token's actual `exp`, while the defaults keep hand-written test doubles on the baseline instead of forcing every double to implement two more members. That derivation is visible in the concrete: `TimeSpan.FromMinutes(_jwtSettings.AccessTokenExpirationMinutes)` and `TimeSpan.FromDays(_jwtSettings.RefreshTokenExpirationDays)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:152` and `:129`). `GetPrincipalFromExpiredToken(string token)` (`:48`) closes the set.
- **Why it's built this way**: the explicit-parameter overload is a `[Rubric §11, Security]` guardrail. The token's contents are a deliberate list, not whatever claims happened to ride in on an inbound principal. Surfacing the lifetimes through the same port removes the duplication where a caller would hard-code an expiry that could drift from the signed `exp`. Note the consumer still guards: [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) falls back to the same 15-minute and 7-day baselines when an implementation reports a non-positive lifetime (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:137-146`).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`AuthenticationServiceBase.cs:76`), which reads the expired principal on refresh (`:278`), mints refresh tokens when opening and rotating sessions (`:627`, `:667`), and re-exposes a *wrapped* instance to subclasses through its `TokenService` property (`:82`). Each app's Identity service mints from that property, for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:150-151` (access token plus the `speaker_id` claim). The rotated pair produced here is what [CookieSessionRefresher](#cookiesessionrefresher) later exchanges on the browser's behalf.

### ITwoFactorUserState
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ITwoFactorUserState.cs:27` · Level 0 · interface

- **What it is**: the two-factor enrollment surface an Identity module's `User` aggregate exposes: whether the second factor is active, the Base32 shared secret enrollment is derived from, and the hashes of the account's unspent recovery codes (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ITwoFactorUserState.cs:29-40`).
- **Depends on**: nothing first-party beyond the BCL `IReadOnlyCollection<string>` (`:1`).
- **Concept introduced: two-factor state read through a capability interface, not the concrete `User`.** `[Rubric §1, SOLID]` assesses interface segregation: a shared handler that needs to know whether TOTP is enrolled never needs the rest of the app's `User` shape, so it depends on this narrow contract instead. `[Rubric §11, Security]` assesses the shape of the stored secret itself: `TwoFactorSecret` (`:35`) is nullable, meaning "no enrollment started" is representable without a sentinel value, and `TwoFactorRecoveryCodeHashes` (`:42`) holds hashes, not the plaintext codes a user was shown once at generation time.
- **Walkthrough**: `bool IsTwoFactorEnabled` (`:29`) gates whether a code is demanded at sign-in. `string? TwoFactorSecret` (`:35`) is the Base32 shared secret, `null` until enrollment begins. `IReadOnlyCollection<string> TwoFactorRecoveryCodeHashes` (`:42`) is empty both before enrollment and after every recovery code has been spent, which the doc comment (`:38-39`) states is a state the user recovers from by regenerating rather than an error condition.
- **Why it's built this way**: keeping this state on its own interface, separate from [IAuthUser](#iauthuser) and [IPasswordChangeableUser](#ipasswordchangeableuser), lets an app opt into two-factor without every existing `User` aggregate needing new members it never populates. See [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) for the opt-in model this interface belongs to.
- **Where it's used**: the generic constraint on [BeginTwoFactorEnrollmentHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#begintwofactorenrollmenthandlerbasetuser-tcommand) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/BeginTwoFactorEnrollmentHandlerBase.cs`), and it is the state [ITwoFactorStore](#itwofactorstore) reads and writes against the concrete `User`.

### IAuthUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:16` · Level 0 · interface

- **What it is**: the deliberately minimal **credential** surface an Identity module's `User` aggregate exposes to the shared [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) workflow. Two properties, both password material. It is the contract that lets the framework's authentication plumbing verify and replace a password without knowing anything app-specific about the user (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:3-8`).
- **Depends on**: nothing first-party; the BCL only (`byte[]`). Implemented transitively through [IPasswordChangeableUser](#ipasswordchangeableuser) by each app's `User` aggregate (see [User](group-24-identity-module.md#user)).
- **Concept introduced: the inverted user contract.** Rather than the shared auth workflow depending on a concrete `User` class, `User` implements a small interface the framework owns. Profile fields, roles, linked aggregates, and claim sources stay app-specific: the shared workflow reaches those only through per-app hooks (`CreateAccessToken`, `CreateUser`), never through this contract (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:6-8`). `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion, and this is a textbook case: the interface is exactly the credential surface and nothing more. `[Rubric §11, Security]` assesses credential handling, and the whole security-relevant surface of a `User` aggregate is now readable in five lines.
- **Concept: a contract that got smaller on purpose.** The `<para>` block (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`) is the most instructive part of the file, because it records what is deliberately **absent**. Refresh tokens used to be members here: one plaintext `RefreshToken` column plus its expiry, per user. Two problems followed from that shape, and both are named in source. One user row could hold one token, so signing in on a phone signed the same account out of a laptop. And the column held a **usable bearer credential** in the users table, so a database read was enough to mint access tokens. Both are gone: sessions are rows in [RefreshSession](#refreshsession), hashed at rest and reached through [IRefreshSessionStore](#irefreshsessionstore), so this interface covers passwords only ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). `[Rubric §15, Best Practices & Code Quality]` applies to the removal itself: shrinking a framework contract is a breaking change for every consumer, and it was taken because the alternative was a security and UX defect baked into the contract shape.
- **Walkthrough**: two members, both `byte[]` and both read-only.
  - `byte[] PasswordHash` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:20`), the PBKDF2 hash produced by [IPasswordHasher](#ipasswordhasher).
  - `byte[] PasswordSalt` (`:23`), the salt paired with it.
  - Both sit inside a scoped `#pragma warning disable CA1819` (`:18`, restored on `:24`) that knowingly returns arrays, to mirror [IPasswordHasher](#ipasswordhasher)'s `byte[]` tuple and the EF-mapped `varbinary` columns rather than force a defensive copy on every read. The suppression's justification is written on the disable line itself, which is the convention this codebase uses everywhere it takes an analyzer exception.
  - There is no mutator. Writing new material is the separate capability [IPasswordChangeableUser](#ipasswordchangeableuser) adds, so an aggregate that only ever authenticates never exposes a way to change its own password.
- **Why it's built this way**: keeping the contract in Domain and keeping it small is what makes the shared auth workflow reusable across Store and ADC (both `User` aggregates satisfy it) while each aggregate stays free to model everything else its own way. See [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) for the password-material policy, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) for the dual-fetch auth model this contract feeds, and [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) for the refresh-token move.
- **Where it's used**: it is half the generic constraint on the shared login and registration workflow, `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IAuthUser` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:85`), which reads both properties on the login path (`:159`) and writes the pair on registration (`:210`). It is also the base of [IPasswordChangeableUser](#ipasswordchangeableuser), and the shape hand-written test doubles copy (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:1034`).
- **Caveats / not-in-source**: the doc comment on `PasswordSalt` still says the salt's length selects the verify algorithm (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:22`). That was true while [PasswordHasher](#passwordhasher) also verified a legacy HMAC-SHA512 format; the current implementation has one algorithm and one salt size (`SaltSize = 32`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:15`, with no legacy branch) per [ADR-102](https://ivanball.github.io/docs/adr/102-pbkdf2-only-password-hashing.html). The comment is stale; the code is the contract.

### IPasswordChangeableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11` · Level 3 · interface

- **What it is**: the password-rotation surface an Identity module's `User` aggregate exposes to the shared [ChangePasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) workflow. It is one method on top of [IAuthUser](#iauthuser) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:5-9`).
- **Depends on**: [IAuthUser](#iauthuser) (its base interface, `:11`) and [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`:1`).
- **Concept: capability interfaces layered by workflow.** `[Rubric §1, SOLID]` assesses interface segregation, and this is the pattern applied twice over: a `User` that only ever authenticates satisfies [IAuthUser](#iauthuser); a `User` whose app offers self-service password change implements this one and gets `PasswordHash` and `PasswordSalt` along with it, because the workflow must verify the current credential before writing the new one (the XML comment states exactly this reason, `:7-9`). Inheritance here encodes a real dependency between capabilities rather than a taxonomy. `[Rubric §4, DDD]` also applies: the method returns [Result](group-01-result-error-handling.md#result), so the aggregate can refuse the change (an invariant failure) instead of the handler assuming success.
- **Walkthrough**: one member, `Result ChangePassword(byte[] newPasswordHash, byte[] newPasswordSalt)` (`:19`). The aggregate receives already-hashed material, never a plaintext password: hashing is the handler's job via [IPasswordHasher](#ipasswordhasher), so no plaintext ever reaches the Domain layer or an EF change tracker.
- **Why it's built this way**: keeping the hash-and-salt pair as the parameter shape mirrors [IAuthUser](#iauthuser)'s two properties and [IPasswordHasher](#ipasswordhasher)'s tuple return, so the whole chain from handler to aggregate speaks one vocabulary. See [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html).
- **Where it's used**: as the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IPasswordChangeableUser` on the shared change-password workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:42`), which verifies the current password (`:55`), hashes the new one (`:61`), and calls `ChangePassword` with the result (`:62`). The forgot-password sibling, [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand), calls the same member on the redeem path after [IPasswordResetTokenService](#ipasswordresettokenservice) has identified the account (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:94-95`). Both apps' [User](group-24-identity-module.md#user) aggregates declare it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34-35`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:29-30`), which is also how they pick up [IAuthUser](#iauthuser).

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
  - **Derived state**: `IsRevoked => RevokedAt is not null` (`:95`) and `IsActiveAt(DateTime utcNow) => !IsRevoked && ExpiresAt > utcNow` (`:99`). Passing the instant in rather than reading a clock keeps the type free of ambient time, which is what makes it directly unit-testable (see [RefreshSessionTests](group-28-testing-infrastructure.md#refreshsessiontests)).
  - **`Create(...)`** (`:112-145`), the factory returning `Result<RefreshSession>` in the framework's standard shape (see the primer on factory methods and the [Result](group-01-result-error-handling.md#result) pattern). Two guards: a blank token fails with `RefreshSession.TokenRequired` (`:120-126`), and an expiry at or before creation fails with `RefreshSession.ExpiryInPast` (`:128-134`), both `Error.Validation`. On success it hashes the token on the way in (`:139`), so **the plaintext never reaches a property**, and truncates the two optional capture fields to their column widths (`:142-143`). Truncating in the factory rather than trusting the caller is what keeps an oversized `User-Agent` header from turning a login into a database error.
  - **`HashToken(string refreshToken)`** (`:160-164`): `Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)))`, guarded by `ArgumentException.ThrowIfNullOrWhiteSpace` (`:162`). The `<remarks>` (`:151-157`) is the one piece of this file to read twice: the encoding is **part of the contract, not an implementation detail**, because a consumer's data migration has to reproduce it exactly to carry existing tokens over. It even gives the T-SQL equivalent, `CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), Token)), 2)`, and explains both halves of why it matches: style 2 emits upper-case hex with no `0x` prefix, and the `varchar` conversion is what makes the hashed bytes UTF-8 rather than SQL Server's default UTF-16. `[Rubric §8, Data Architecture]` and `[Rubric §34, Architecture Governance & Documentation]` both apply here: a hash format that a migration must reproduce is a published contract, and it is documented as one.
  - **`Revoke(DateTime revokedAt, string reason, string? replacedByTokenHash = null)`** (`:174-189`): the only mutator. It is **idempotent by refusal** (`:166-169`), returning `Error.Invariant("RefreshSession.AlreadyRevoked", ...)` when the session is already revoked (`:176-182`) rather than silently overwriting, so the first reason and instant recorded are the ones kept. That matters for forensics: a session revoked by reuse detection must not have that reason overwritten by a later sign-out. On success it stamps the instant, the truncated reason, and the successor hash (`:184-186`).
  - `Truncate` (`:191-192`) is the shared private helper, returning the value unchanged when it is null, empty, or already short enough.
- **Why it's built this way**: [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) records the move from one plaintext refresh-token column on the user row to a session table, and [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) the rotation-and-reuse-detection model the chain implements. Keeping the class free of audit stamps and soft-delete is deliberate rather than an omission, and keeping `Create`/`Revoke` as the only ways in and out means every row in the table was validated and every revoked row carries a reason.
- **Where it's used**: [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) is the main consumer. It hashes a presented token to look the session up (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:432`, `:593`), creates one per login (`:628`) and per rotation (`:668`), revokes on sign-out (`:360`, `:367`, `:385`, `:456`), revokes the live family on reuse detection (`:603`, `:691`), and evicts the oldest session with `ReasonSessionCap` when a user exceeds `RefreshSessions:MaxActiveSessionsPerUser` (`:733`, documented at `:111`). Rotation itself is a claim rather than a plain mutation: [IRefreshSessionStore](#irefreshsessionstore)`.TryRotateAsync` revokes with `ReasonRotated` and links the successor (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:104`; the EF implementation does it as a conditional `ExecuteUpdate`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:129`, `:142`). The table is mapped through `ApplyRefreshSessionConfiguration` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:896`), and the account-deletion path deliberately does **not** revoke sessions (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:103-107`): the refresh flow re-fetches the user through the soft-delete query filter, so an erased account's sessions stop working the moment the delete commits.

### IEmailConfirmableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IEmailConfirmableUser.cs:22` · Level 3 · interface

- **What it is**: the email-confirmation surface an Identity module's `User` aggregate exposes: whether the address has been proved, and a method that marks it confirmed (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IEmailConfirmableUser.cs:24-32`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions`.
- **Concept introduced: idempotent confirmation by contract.** `[Rubric §4, DDD]` assesses whether an aggregate enforces its own invariants rather than trusting the caller, and `ConfirmEmail()`'s doc comment (`:26-30`) states the requirement directly: implementations should be idempotent, so redeeming a second token for an address that is already confirmed is an ordinary duplicate outcome, not a fault. That reading matters because a user can legitimately click an old confirmation link twice (a second tab, a forwarded email), and the workflow must not turn that into an error.
- **Walkthrough**: `bool IsEmailConfirmed` (`:24`) is the current state. `Result ConfirmEmail()` (`:32`) returns a success result, or the aggregate's own invariant failure, and takes no parameters: the token itself is verified upstream by [IEmailConfirmationTokenService](#iemailconfirmationtokenservice) before this method is ever called.
- **Why it's built this way**: keeping confirmation as its own capability interface, alongside [ITwoFactorUserState](#itwofactoruserstate) and [IUserPreferences](#iuserpreferences), lets an app that does not require email confirmation skip implementing it, consistent with the opt-in model of [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html).
- **Where it's used**: the generic constraint on [SendEmailConfirmationHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#sendemailconfirmationhandlerbasetuser-tcommand) and [ConfirmEmailHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#confirmemailhandlerbasetuser-tcommand), and by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser), which reads `IsEmailConfirmed` on the login path.

### PermissionGrant
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/PermissionGrant.cs:24` · Level 3 · class (sealed)

- **What it is**: one row granting a single `area:capability` permission to a single role, with an audit trail of when and by whom it was created (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/PermissionGrant.cs:24-94`).
- **Depends on**: [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error), both from `MMCA.Common.Shared.Abstractions`. Persisted through [IPermissionGrantStore](#ipermissiongrantstore) and its EF adapter, and read into [IPermissionCatalog](#ipermissioncatalog)/[IPermissionRegistry](#ipermissionregistry) at runtime.
- **Concept introduced: two comparison conventions pinned by comment, not by type.** `[Rubric §11, Security]` assesses authorization correctness, and this class carries the two rules an authorization decision depends on directly on the properties: `Role` (`:188`) is compared case-insensitively everywhere it is read, matching `PermissionRegistry` and `RoleValue`; `Permission` (`:194`) is compared ordinally, matching the compiled registry. Getting either comparison wrong would make a grant silently not match the token it was meant to authorize.
- **Walkthrough**: `RoleMaxLength = 64` (`:176`) and `PermissionMaxLength = 128` (`:179`) are published column widths. `Id` (`:182`) defaults to a fresh `Guid`. `Role` and `Permission` (`:188`, `:194`) are `required init`-only strings. `GrantedAt` (`:197`) is `required`; `GrantedBy` (`:203`) is optional and documented as informational only, never part of an authorization decision, so a row written by a migration with no principal is still honored. `Create(string role, string permission, DateTime grantedAt, string? grantedBy = null)` (`:213-242`) is the only constructor path: it fails validation with `PermissionGrant.RoleInvalid` when the role is blank or over 64 characters (`:219-225`), and `PermissionGrant.PermissionInvalid` when the permission is blank or over 128 (`:227-233`), then trims both before storing.
- **Why it's built this way**: validating length and blankness in the factory rather than trusting the caller keeps an oversized or empty value from reaching the database as a constraint violation instead of a `[Rubric §4, DDD]`-shaped `Result` failure. Grouping the two comparison conventions on the type that stores the data, rather than leaving them implicit in the store or the registry, is what keeps every reader consistent.
- **Where it's used**: written and read by [EFPermissionGrantStore](group-07-persistence-ef-core.md#efpermissiongrantstore) and [StoredPermissionRoleAdministrationService](#storedpermissionroleadministrationservice), mapped by [PermissionGrantModelBuilderExtensions](group-07-persistence-ef-core.md#permissiongrantmodelbuilderextensions), and cited by [AdministrationRequestValidators](#administrationrequestvalidators) when validating admin requests that set role permissions.

### IErasableUser
> MMCA.Common.Domain · `MMCA.Common.Domain.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30` · Level 4 · interface

- **What it is**: the erasure surface an Identity module's `User` aggregate exposes to the shared [DeleteUserHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) workflow: soft-delete the row, then irreversibly anonymize the personal data it still holds (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:6-9`).
- **Depends on**: [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) (its base, contributing `Result Anonymize()`, `:1` and `:30`) and [Result](group-01-result-error-handling.md#result) (`:2`).
- **Concept introduced: why a `Delete()` that already exists on the base entity is redeclared here.** This is the most instructive comment in the file and it is worth reading in full (`:11-29`). [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) already has a `Delete()`. But an app's `User` may **hide** it (`public new Result Delete()`) to couple account-specific behavior to deletion. A hidden method is not an override, and C# member lookup on a generic type parameter prefers the members of its **class** constraint, so a shared workflow writing `user.Delete()` would bind to the base implementation and silently skip the app's version. Because the app `User` lists this interface in its own base list, the interface map resolves to the most derived `Delete()` declared on the app type, so invoking it **through the interface** forces interface dispatch and reaches exactly the member the app intended. `[Rubric §1, SOLID]` (Liskov: the hidden method is exactly the substitutability hazard this closes) and `[Rubric §15, Best Practices & Code Quality]` both apply, and this is a case where a language rule, not a style preference, dictates the design. The second paragraph (`:25-28`) adds the compile-time guarantee: the base entity deliberately does **not** implement this interface, so a consumer that forgets to declare it fails the generic constraint at compile time rather than losing behavior at run time.
- **Walkthrough**: one declared member, `Result Delete()` (`:37`), documented as soft-delete plus whatever the app couples to deletion (`:32-34`), returning a failure when the account is already deleted (`:36`). Inherited from [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) is `Result Anonymize()`, which must be idempotent. The two-step order is visible in the caller: cast once to the interface (`IErasableUser erasable = user;`, `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:114`, with the reason spelled out at `:88-92`), `erasable.Delete()` first (`:94`), the app's own tail hook next (`OnAfterSoftDeleteAsync`, `:101`), then `erasable.Anonymize()` (`:108`), each short-circuiting on failure.
- **Why it's built this way**: soft-delete alone hides a row but retains its personal data, so it does not satisfy an erasure request; anonymize-in-place overwrites the personal fields while keeping the row so foreign keys and the audit trail survive ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). Splitting the two into separate members lets the workflow run app-specific work between them, which the handler documents as the only point where an app can both read the personal data and know the delete succeeded (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:41-42`). `[Rubric §30, Compliance, Privacy & Data Governance]` assesses exactly this: an erasure path that does not destroy referential integrity.
- **Where it's used**: the generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IErasableUser` on the shared delete-user workflow (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:62`), implemented by each app's [User](group-24-identity-module.md#user) aggregate (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34-35`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:29-30`).
- **Caveats / not-in-source**: the interface's own comment says an app typically hides `Delete()` to revoke the refresh token (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:16`, `:34`). That phrasing predates the move to [RefreshSession](#refreshsession) rows and no longer describes either app. ADC is the only consumer that hides the method, and its version calls `base.Delete()` and raises a `UserDeleted` domain event (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:443-452`), with the XML comment there stating outright that sessions are not touched and do not need to be. MMCA.Store does not hide `Delete()` at all. The load-bearing lesson (interface dispatch over a possibly-hidden base member) is unchanged; the example in the comment is stale.

### ICurrentUserService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:9` · Level 8 · interface

- **What it is**: the Application layer's read-only window onto the authenticated caller: the raw `ClaimsPrincipal`, a strongly-typed `UserId`, the caller's first role, the full role set, a generic typed-claim reader, and a role-membership helper. It answers "who is calling?" without any handler ever touching `HttpContext`.
- **Depends on**: `System.Security.Claims` and `IParsable<T>` (BCL, `:1`) plus the solution-wide `UserIdentifierType` alias (`:15`); see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to). Its adapter is [CurrentUserService](#currentuserservice) in Infrastructure.
- **Concept introduced: the caller-identity port with behavior on the interface.** `[Rubric §3, Clean Architecture]` assesses whether inner layers stay free of transport types, and `[Rubric §1, SOLID]` (interface segregation) whether a contract exposes only what its clients need. A handler must know the caller to run ownership checks and to stamp audit fields, but it must not depend on `IHttpContextAccessor`, which would drag ASP.NET Core into the Application project. This interface is that inversion, and the adapter is the only place the accessor appears (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/CurrentUserService.cs:17`, `:25`). What makes it worth studying is the use of **default interface members**: `Roles` (`:45-64`) and `IsInRole` (`:88-89`) ship real implementations on the contract, so every implementer and every hand-written test double inherits correct multi-role behavior instead of re-deriving it.
- **Walkthrough**: `ClaimsPrincipal User` (`:12`) exposes the full principal for advanced inspection. `UserIdentifierType? UserId` (`:15`) is the typed identifier, nullable because an unauthenticated request has no user. `string? Role` (`:22`) is documented as the **first** role claim only, with the remarks at `:18-21` steering callers to `Roles` or `IsInRole` for membership checks. `Roles` (`:45-64`) is the interesting member: it reads every role claim, accepting each claim type the JWT middleware may produce (`ClaimTypes.Role` when inbound claim mapping is on, or the raw `role` / `roles` claim when it is off, `:50-53`), falls back to a single-element list built from `Role` when the principal yields nothing (`:62`), and null-guards `User` even though the property is declared non-nullable (`:49`). The long remarks at `:27-44` justify both accommodations from the nature of a default interface member: it runs against *every* implementation, including a hand-written double or a mock that stubs only `Role`, where reading claims alone would have reported no roles and silently turned an authorization check into a denial, and dereferencing a null principal would have turned it into a `NullReferenceException`. Claims win when present, so a genuine multi-role principal is still read in full. `T? GetClaimValue<T>(string claimType) where T : struct, IParsable<T>` (`:73-74`) parses a named claim into any parsable value type and returns `null` when the claim is missing or unparseable, which is how a module reads its own claim (the doc names `speaker_id`, `:68`) without Common ever knowing that claim exists. `IsInRole(string roleName)` (`:88-89`) is `Roles.Any(role => string.Equals(role, roleName, StringComparison.OrdinalIgnoreCase))`.
- **Why it's built this way**: the remarks at `:82-87` record the reasoning behind `IsInRole` checking every claim rather than comparing against `Role`. Comparing against the first role alone matched only whichever role happened to be listed first, which is latent today because tokens carry a single role, and would have surfaced silently as an authorization denial the moment a second role was added. Typing `UserId` as the per-app alias instead of a generic parameter keeps the interface concrete and easy to mock while staying correct for each app. `[Rubric §11, Security]` and `[Rubric §15, Best Practices & Code Quality]` both apply.
- **Where it's used**: registered as scoped against [CurrentUserService](#currentuserservice) at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:296`. It supplies the `Roles` set the CQRS authorization decorators check permissions against (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/AuthorizationCommandDecorator.cs:32`, and its query twin; see [group 05](group-05-cqrs-pipeline.md)); it is how audit fields get their actor, since [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory) passes `_currentUserService.UserId` into every save (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:66`, used at `:248`, `:291`, `:330`, `:352` and `:414`); and it backs the ownership check in [OwnerOrAdminFilter](#owneroradminfilter) and the framework's account controllers.
- **Caveats / not-in-source**: `Role` deliberately reports only the first role claim; treat it as a display value and use `Roles` or `IsInRole` for any decision.

### EmailConfirmationEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:169` · Level 0 · record (internal sealed)

- **What it is**: the cached confirmation record behind the email-confirmation flow: what [EmailConfirmationTokenService](#emailconfirmationtokenservice) writes into the cache when a confirmation token is issued, and reads back when one is redeemed. It is `internal sealed`, declared as a second type at the bottom of its service's file (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:169-173`).
- **Depends on**: nothing first-party except the `UserIdentifierType` alias (the per-module `global using` identifier alias, [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Four positional parameters, all BCL primitives.
- **Concept**: the same cache-DTO rule [PasswordResetEntry](#passwordresetentry) demonstrates: a value round-tripped through `System.Text.Json` in a distributed cache must be a JSON primitive, so the token digest travels as Base64 text (`TokenHashBase64`, `:170`) rather than as `byte[]`, and the expiry as Unix seconds (`ExpiresAtUnixSeconds`, `:173`) rather than as `DateTimeOffset`. `[Rubric §11, Security]` applies through the same member name convention: `TokenHashBase64`, never `Token`, so the record cannot hold the redeemable secret it guards.
- **Walkthrough**: four members, the same shape as [PasswordResetEntry](#passwordresetentry):
  - `string TokenHashBase64` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:170`): the SHA-256 digest of the issued token, Base64-encoded. Validation re-hashes the presented token and compares digests.
  - `UserIdentifierType UserId` (`:171`): the account the token confirms.
  - `int FailedAttempts` (`:172`): wrong tokens presented against this record so far.
  - `long ExpiresAtUnixSeconds` (`:173`): when the record expires; a failed-attempt rewrite recaches with the **remaining** lifetime computed from this field so a wrong guess cannot extend how long the token stays redeemable (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:138-151`).
- **Why it's built this way**: being a `record` gives the `with` expression the attempt-counter rewrite relies on (`entry with { FailedAttempts = attempts }`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:150`). Being `internal` keeps the cache layout out of the package's public API.
- **Where it's used**: written by `IssueAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:67-73`), read by `ValidateAndConsumeAsync` (`:85`), and rewritten by `RecordFailedAttemptAsync` (`:148-151`). It appears nowhere else.

### IJwksProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` · Level 0 · interface

- **What it is**: the abstraction that returns the active `JsonWebKeySet` served at `/.well-known/jwks.json`. Implementations materialize the public signing key(s) in the JWK format that other services consume to validate access tokens (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:5-10`).
- **Depends on**: `Microsoft.IdentityModel.Tokens.JsonWebKeySet` (NuGet, `:1`). Implemented by [RsaJwksProvider](#rsajwksprovider); configured by [JwksSettings](group-08-auth.md#jwkssettings) and served by [JwksEndpointExtensions](group-12-api-hosting-mapping.md#jwksendpointextensions).
- **Concept introduced: publishing a public key instead of sharing a secret.** `[Rubric §11, Security]` assesses key management and blast radius, and `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a rewrite. In an extracted-service topology, symmetric HS256 would require every service to hold the same secret, so any one compromised service can mint tokens for all of them. The asymmetric alternative ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) keeps the RSA private key inside the Identity service and publishes only the public key at a well-known URL; peers fetch it and validate signatures without ever being able to sign. `IJwksProvider` is how the Identity API obtains that public key set to serve.
- **Walkthrough**: a single synchronous member, `JsonWebKeySet GetJsonWebKeySet()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:19`). Synchronous is the deliberate shape because key material is resolved once and cached in-process by the implementation. The doc comment sets a contract that the implementation must honor: return an **empty** key set rather than throwing when no signing key is configured (`:13-17`), so `/.well-known/jwks.json` stays a valid, pollable URL even in a host where JWKS publishing is off.
- **Why it's built this way**: an interface here lets tests inject a pre-built key set with no file IO, and the empty-set contract makes the endpoint safe to map unconditionally instead of behind a feature check.
- **Where it's used**: registered as `services.TryAddSingleton<IJwksProvider, RsaJwksProvider>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:186`) immediately after the `JwksSettings` options binding (`:165-168`); the JWKS minimal-API endpoint calls it, and consuming services fetch the resulting document through `AddForwardedJwtBearer` at startup (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:9`).

### JwksSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: the `Jwks` section that controls whether an Identity service publishes a JSON Web Key Set at `/.well-known/jwks.json`, and where its RSA public key comes from (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:5-9`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[StringLength]` (BCL, `:1`) only. Consumed by [RsaJwksProvider](#rsajwksprovider) and [TokenService](#tokenservice) through `IOptions<JwksSettings>`.
- **Concept introduced: key distribution as configuration.** `[Rubric §11, Security]` assesses how trust is established between services. In a single-process monolith the issuer and the validator can share one symmetric secret. Once a module is extracted, the validator must obtain the issuer's *public* key without sharing anything secret, which is what a JWKS document is for ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §7, Microservices Readiness]`: the framework ships the endpoint always and the key set empty, so nothing about a deployment changes until a host flips `Enabled`. The `kid` contract is the subtle part: `KeyId` is published as the JWK `kid` and must match the `kid` header on tokens the issuer signs (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:13-14`, restated on the property itself at `:28-32`), otherwise a validator holding a correct key set still cannot pick the right key. [TokenService](#tokenservice) closes that loop by taking these same options and stamping `KeyId` onto every RS256 token it signs (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:58-63`, `:57`, `:67`).
- **Walkthrough**:
  - `SectionName = "Jwks"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:20`).
  - `Enabled` (`:26`), defaulting to `false` with the rationale spelled out inline (`:22-25`): existing HMAC-only deployments must not start advertising an RSA key set by accident.
  - `KeyId` (`:34`), `[StringLength(64)]` (`:33`), defaulting to `"default"`.
  - `RsaPublicKeyPem` (`:41`) and `RsaPublicKeyPath` (`:47`), documented as mutually exclusive (`:36-40`, `:43-46`); the path form exists for keys mounted as a secret rather than inlined in configuration.
  - The consuming logic, worth reading alongside: [RsaJwksProvider](#rsajwksprovider)`.BuildKeySet` returns an EMPTY `JsonWebKeySet` when `Enabled` is false (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:29-32`) and again when neither PEM source resolves (`:36-39`); otherwise it imports the PEM, stamps `KeyId` onto the `RsaSecurityKey` (`:41-47`) and tags the JWK `use=sig`, `alg=RS256` (`:50-51`). `ResolvePem` prefers the inline value over the file (`:58-74`), and the key set is built once behind a `Lazy<JsonWebKeySet>` in `PublicationOnly` mode (`:21-22`) so that one transient IO failure reading the PEM is retried rather than cached forever (`:17-21`).
- **Why it's built this way**: default-off plus an empty key set means the endpoint is safe to map unconditionally, and two key sources cover both "inline it in configuration" and "mount it as a secret" without a second code path in the provider.
- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:182-185`), immediately followed by the [IJwksProvider](#ijwksprovider) registration (`:183`). [TokenService](#tokenservice) takes it as an optional constructor dependency and falls back to `new JwksSettings().KeyId` when it is absent (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:80`).

### JwtSigningAlgorithm
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:21` · Level 0 · enum

- **What it is**: a two-value enum selecting how access tokens are signed and validated: symmetric HMAC or asymmetric RSA.
- **Depends on**: nothing. Referenced by [JwtSettings](#jwtsettings), [TokenService](#tokenservice), and the API-layer authentication wiring.
- **Concept introduced: the deployment shape encoded as one configuration value.** `[Rubric §11, Security]` assesses key management: HS256 requires every validator to hold the *signing* key, which is acceptable only while issuer and validators share a process. RS256 splits the pair, the issuer holds the private key and peers validate against the JWKS endpoint, so no peer ever holds the signing key ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). `[Rubric §7, Microservices Readiness]`: making this a configuration value rather than a compile-time choice is what lets the same binaries run both topologies, and the type's own doc says RS256 is also the right choice for a monolith that intends to extract later, because the token format does not change when it does (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:8-12`). The operational consequence is stated just as plainly: switching a running deployment between the two invalidates every existing token, a hard cutover (`:17-18`).
- **Walkthrough**: `HS256 = 0` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:24`) and `RS256 = 1` (`:27`), both with explicit ordinals.
  - The default is RS256, and where that default lives is worth being precise about. The enum's zero value is HS256, so a configuration binder that saw an *invalid* value would land there; but a host that simply omits `Jwt:SigningAlgorithm` never has the property set at all, and [JwtSettings](#jwtsettings)'s own initializer holds (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`). The default is a property initializer, not the enum ordinal.
  - [TokenService](#tokenservice) branches on the value once, in its constructor, and caches the resulting credentials (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:77-87`), with the RSA and HMAC builders at `:194` and `:180`. Each builder throws a named `InvalidOperationException` when its key material is missing (`:184`, `:200`).
  - The API layer branches on the same value when configuring in-process JWT bearer validation: `BuildValidationParameters` takes the RSA path for RS256 (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:209-232`) and, when the public key is absent, throws a message that points the reader at `AddForwardedJwtBearer` for services that fetch the key through JWKS at runtime instead (`:211-215`).
- **Why it's built this way**: both members stay because they encode deployment shapes rather than a compatibility level (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:5-6`). A single-process monolith that will never be split skips RSA key management entirely; everything else gets the algorithm that survives extraction.
- **Where it's used**: [JwtSettings.SigningAlgorithm](#jwtsettings) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`) and its conditional validation (`:72`, `:79`), [TokenService](#tokenservice), and `BuildValidationParameters` in the API startup extensions (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:207`).

### LoginProtectionSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: strongly typed, `[Range]`-validated configuration for brute-force login lockout and registration rate limiting, bound from the `LoginProtection` configuration section (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:5-7`).
- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]` (BCL, `:1`). Consumed by [LoginProtectionService](#loginprotectionservice) through `IOptions<LoginProtectionSettings>`.
- **Concept**: `[Rubric §11, Security]` assesses whether brute-force defenses exist and are tunable, and this settings class is where the policy numbers live rather than being hard-coded into a handler. `[Rubric §15, Best Practices & Code Quality]` also applies in a small way: five `init`-only properties with defaults mean an app that configures nothing still gets a safe policy, and an app that configures one value inherits the rest.
- **Walkthrough**: `const string SectionName = "LoginProtection"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:12`) names the bound section. Two concerns follow.
  - Account lockout: `MaxFailedAttempts` (default 5, `[Range(1, 100)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:17-18`), `MaxLockoutSeconds` (default 300, `[Range(1, 3600)]`, `:23-24`), `FailedAttemptWindowMinutes` (default 30, `[Range(1, 1440)]`, `:30-31`). The window comment (`:26-29`) is load-bearing for understanding the service: the attempt counter resets by cache expiration, not by a sweep job.
  - Registration rate limiting: `MaxRegistrationsPerIpPerHour` (default 10, `[Range(1, 10000)]`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:36-37`) and `RegistrationRateLimitWindowMinutes` (default 60, `[Range(1, 1440)]`, `:42-43`).
- **Why it's built this way**: `sealed` with `init`-only properties gives an immutable options object. Every property carries a `[Range]`, and the registration wires `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:148-151`), so an obviously unsafe value such as `MaxFailedAttempts = 0` fails the host at startup instead of quietly disabling lockout until someone notices in production. The `MaxLockoutSeconds` upper bound of 3600 is also what lets [LoginProtectionService](#loginprotectionservice) reason about its shift-clamp safely.
- **Where it's used**: bound and validated in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:148-151`) immediately before [LoginProtectionService](#loginprotectionservice) is registered (`:135`). Its sibling [PasswordResetSettings](#passwordresetsettings) is bound in exactly the same shape two lines later (`:137-140`), as is [RefreshSessionSettings](#refreshsessionsettings) (`:145-148`).

### PasswordResetEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:160` · Level 0 · record (internal sealed)

- **What it is**: the cached reset record behind the forgot-password flow: what [PasswordResetTokenService](#passwordresettokenservice) writes into the cache when a reset token is issued, and reads back when one is redeemed. It is `internal sealed`, declared as a second type at the bottom of its service's file (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:160-164`).
- **Depends on**: nothing first-party except the `UserIdentifierType` alias (the per-module `global using` identifier alias taught in the primer, [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Four positional parameters, all BCL primitives.
- **Concept introduced: a cache DTO is constrained by its serializer, not by your domain.** `[Rubric §8, Data Architecture]` assesses whether each store is given a shape it can actually round-trip, and this four-line record is a compact lesson in that. The XML comment states the rule directly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:151-155`): the cache round-trips values through `System.Text.Json`, so **every member is a JSON primitive**. A value object such as [Email](group-02-domain-building-blocks.md#email) or a raw `byte[]` here would not survive a distributed backing store, which is why the token digest is carried as Base64 text (`:172`) and the expiry as Unix seconds (`:175`) rather than as `byte[]` and `DateTimeOffset`. `[Rubric §11, Security]` also applies through one member name: `TokenHashBase64`, not `Token`. The record is structurally incapable of holding the secret it guards.
- **Walkthrough**: four members, in the order they matter.
  - `string TokenHashBase64` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:161`): Base64 of the SHA-256 of the issued token, never the token itself (`:167`). Validation re-hashes the presented token and compares digests, so the cache never holds redeemable material.
  - `UserIdentifierType UserId` (`:173`): the account the token redeems to (`:168`). Storing the id in the record is what lets redemption resolve the user without a second lookup by email.
  - `int FailedAttempts` (`:174`): wrong tokens presented against this record so far (`:169`), the counter the attempt cap is enforced against.
  - `long ExpiresAtUnixSeconds` (`:175`): when the record expires (`:170`). This one exists for a specific reason explained at the rewrite site: when a failed attempt bumps the counter, the record is re-cached with the **remaining** lifetime computed from this field, so a wrong guess cannot extend how long the token stays redeemable (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:127`, `:146-152`).
- **Why it's built this way**: being a `record` gives the non-destructive `with` expression that the attempt-counter update relies on (`entry with { FailedAttempts = attempts }`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:139`), so the rewrite is a copy rather than a mutation. Being `internal` keeps a cache-layout detail out of the package's public API: nothing outside the Infrastructure assembly should be able to construct or read one. See [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) for why the reset lifecycle lives in the cache at all.
- **Where it's used**: written by `IssueAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:71-77`), read by `ValidateAndConsumeAsync` (`:100`), and rewritten by `RecordFailedAttemptAsync` (`:148-152`). It appears nowhere else.

### AuthenticationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared` · `MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15` · Level 0 · record struct

- **What it is**: a device-aware authentication request shape for mobile/MAUI clients. It carries device metadata (id, form factor, platform, model, manufacturer, name, type) alongside the user's email so that sessions and tokens can be tracked per device (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-5`).
- **Depends on**: nothing first-party. Eight positional `string` parameters and the BCL only.
- **Concept**: an immutable `readonly record struct` request DTO. The `readonly record struct` gives value-based equality and a compact, copy-by-value payload for something that crosses the wire once per login, and the eight positional parameters (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`) show the same request shape scaling from bare credentials to a credential-plus-context payload. `[Rubric §11, Security]` assesses credential handling and session management: capturing device identity at authentication time is the precondition for per-device session tracking, which is what the XML doc states the type exists for (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:4-5`).
- **Walkthrough**: the whole type is one positional constructor with eight `string` members (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:15-23`): `DeviceId`, `Email`, `DeviceFormFactor`, `DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceName`, `DeviceType`. Note that `Email` is the plain `string` here and not the [Email](group-02-domain-building-blocks.md#email) value object: this is a transport shape, and normalization happens further in. It is also the only type in the root `MMCA.Common.Shared` namespace; the rest of the auth request family lives under `MMCA.Common.Shared.Auth`.
- **Why it's built this way**: a struct record keeps a small, short-lived login payload allocation-free while still giving structural equality and a `with`-expression copy for free; every member being `string` keeps it trivially serializable by any client transport.
- **Caveats / not-in-source**: this type has **no first-party consumer in the workspace source today**. A search across all four .NET repos finds `AuthenticationRequest` only in its own declaration file, so the device fields are a published contract awaiting a caller rather than an active login path. The per-device story that did ship is [RefreshSession](#refreshsession), which captures IP and user-agent rather than these eight fields; treat the device-metadata contract as documented intent (`MMCA.Common/Source/Core/MMCA.Common.Shared/AuthenticationRequest.cs:3-5`), not as shipped behavior.

### JwtSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `Jwt` section: issuer, audience, signing algorithm, the key material for whichever algorithm is selected, and the two token lifetimes. It adds the piece attributes cannot express, algorithm-aware validation of the key material.
- **Depends on**: [JwtSigningAlgorithm](#jwtsigningalgorithm) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`), which is what puts it at Level 1, plus `System.ComponentModel.DataAnnotations` for `[Required]` and, critically, for the `IValidatableObject` interface (`:1`, `:16`).
- **Concept introduced: `IValidatableObject` for conditional requirements.** Attributes describe a property in isolation, so they cannot say "this one is required only when that one has a particular value". `IValidatableObject` is the options-validation extension point for exactly that case: the type implements a single `Validate` method that yields one `ValidationResult` per failure, and `.ValidateDataAnnotations()` runs it alongside the attribute checks. This class is the framework's canonical example, and says so in its own doc (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:13-14`).
  `[Rubric §11, Security]` assesses credential handling. The HS256 branch does not merely check that a secret is present, it checks the length: fewer than 32 characters fails, and the message explicitly tells the operator to replace the placeholder with a real secret from user-secrets or environment variables (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:72-77`). That is deliberate: a short or shipped-placeholder HMAC key is the failure mode that would otherwise reach production silently.
  `[Rubric §15, Best Practices & Code Quality]` assesses fail-fast posture. Registration pairs the bind with `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:146-149`), so both the attribute checks and `Validate` run at boot, not on the first token issued ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Walkthrough**: one static field, eight `init` properties, one method.
  - `SectionName = "Jwt"` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:19`).
  - `SigningAlgorithm` (`:30`): defaults to [JwtSigningAlgorithm](#jwtsigningalgorithm)`.RS256`, and the remarks give the reason (`:24-29`): asymmetric signing is what lets a validator verify a token without holding the key that mints one, so a host that never sets `Jwt:SigningAlgorithm` gets the algorithm that survives extraction. A single-host monolith opts into HS256 explicitly.
  - `SecretForKey` (`:37`), `RsaPrivateKeyPem` (`:43`), `RsaPublicKeyPem` (`:50`): none carries `[Required]`, because whether it is required is decided in `Validate`. The docs are specific about the split: the private key is what an issuer signs with, the public key is what an in-process validator verifies with, and a service that fetches the key through JWKS at runtime leaves the public key unset (`:45-49`).
  - `Issuer` (`:54`) and `Audience` (`:58`): both `[Required]` (`:53`, `:57`), because they matter in every mode.
  - `AccessTokenExpirationMinutes` (`:61`), default `15`; `RefreshTokenExpirationDays` (`:64`), default `7`. The short-access-plus-long-refresh split of [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), expressed as defaults rather than as required configuration.
  - `Validate(ValidationContext)` (`:70-85`): an iterator method with two independent checks. Under HS256, `SecretForKey.Length < 32` yields a failure naming `SecretForKey` (`:72-77`); under RS256, a null or whitespace `RsaPrivateKeyPem` yields a failure naming `RsaPrivateKeyPem` (`:79-84`). Note the asymmetry: the private key is enforced here, the public key is not, because a service that only validates fetches it through JWKS.
  - The in-process validator enforces the other half at wiring time instead: `BuildValidationParameters` throws when RS256 is selected with no `RsaPublicKeyPem`, and the message points at `AddForwardedJwtBearer` for services that should fetch the key at runtime (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:211-215`).
- **Why it's built this way**: keeping the conditional rule in code next to the properties it constrains, rather than in the registration call, means every host that binds this section gets the same guarantee without repeating it. The algorithm switch is a hard cutover that invalidates every existing token (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:17-18`), so failing the boot on a half-configured section is much cheaper than discovering it at the first sign or the first validation.
- **Where it's used**: bound in `AddCommonAuthentication` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:146-149`), which then re-reads the section eagerly to build the token validation parameters at wiring time (`:154-157`); consumed by [TokenService](#tokenservice) through `IOptions<JwtSettings>`, which branches on the algorithm once in the constructor and caches the credentials (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:64-88`).

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
- **Why it's built this way**: exporting only the public parameters guarantees the private key can never reach the JWKS document even by accident. The inline-PEM-or-path pair supports both secrets-manager injection (env var or config) and a volume-mounted key file, which are the two deployment shapes the framework's samples use. `sealed`, and registered singleton (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:186`) so the cache is process-wide.
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
  `[Rubric §11, Security]` assesses credential-at-rest protection, and this type is where the
  framework makes its whole stance on it. Four decisions are visible in source and each one answers a
  specific attack. A per-credential 32-byte salt drawn from a CSPRNG
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:15`, `:31`) means two
  users who pick the same password get different stored hashes, so a precomputed rainbow table buys an
  attacker nothing. A 600,000-iteration work factor
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:24`, OWASP 2023
  guidance for PBKDF2-HMAC-SHA512) makes each guess in an offline cracking run cost real CPU time,
  which is the only defense once a dump has left the building. `FixedTimeEquals` (`:64`) compares
  the full buffer regardless of where the first byte differs, so the *duration* of a failed login
  carries no information about how close the guess was. And `VerifyPassword` rejects any `hash`/`salt`
  pair that is not exactly `HashSize`/`SaltSize` bytes before comparing anything
  (`:55-58`): the inline comment records that the check closes a real hole, an account created through
  external OAuth ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)) carries
  an empty hash and salt, and the previous code derived an empty hash from an empty salt and compared
  two empty spans, which `FixedTimeEquals` answers `true` for: any password verified successfully
  against such a row.
  `[Rubric §15, Best Practices & Code Quality]` applies to the
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
    three arguments for null/empty/whitespace (`:45-47`), then rejects any `hash`/`salt` pair whose
    length is not exactly `HashSize`/`SaltSize` bytes, returning `false` immediately (`:55-58`). Only
    canonical PBKDF2-shaped material reaches the comparison; a row that is not something this hasher
    ever produced verifies nothing. It then recomputes the derivation over the *stored* salt at the
    fixed `HashSize` (`:60`), and returns
    `CryptographicOperations.FixedTimeEquals(computedHash, hash)` (`:64`).
  - `ComputePbkdf2Hash(string password, byte[] salt, int outputLength)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:68-74`) is the
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:304`); the type is
  stateless, so a singleton is safe. Consumers reach it through the port:
  [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser) takes it as a constructor
  parameter (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:77`),
  verifies on login (`:159`, and a failure there increments the brute-force counter at `:160`) and
  hashes on registration (`:210`);
  [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand)
  verifies the current password then re-hashes the new one
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:38`,
  `:55`, `:61`); and
  [`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
  only hashes
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:45`,
  `:79`), because possession of the reset token stands in for knowledge of the old password.
- **Caveats / not-in-source**: `VerifyPassword` returns a plain `bool`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:43`), so there is no
  "this row was derived with a lower work factor, rehash it" signal on the successful-login path.
  Verification recomputes with the current `Iterations` constant (`:61`), so raising it invalidates
  previously stored hashes, and nothing in this file or its call sites migrates them.

### TokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:26` · Level 2 · class

- **What it is**: the JWT issuer. It mints signed access tokens carrying the user id, email, role and
  display name (plus any extra claims a caller supplies), generates opaque random refresh tokens,
  projects both configured lifetimes as `TimeSpan`s, and re-reads an already-expired access token
  during the refresh flow. It signs with RSA-SHA256 or HMAC-SHA256, decided once at construction from
  configuration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:13-25`).
- **Depends on**: [`ITokenService`](#itokenservice) (the port it implements) and `IDisposable`;
  [`JwtSettings`](group-08-auth.md#jwtsettings),
  [`JwtSigningAlgorithm`](group-08-auth.md#jwtsigningalgorithm) and
  [`JwksSettings`](group-08-auth.md#jwkssettings), all bound through
  `IOptions<T>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:64-68`);
  [`IPermissionRegistry`](#ipermissionregistry), a required constructor dependency (`:29`, `:66`)
  that supplies the role-to-permission map baked into every access token.
  Externals: `System.IdentityModel.Tokens.Jwt` (`JwtSecurityToken`, `JwtSecurityTokenHandler`),
  `Microsoft.IdentityModel.Tokens` (`SigningCredentials`, `SecurityKey`, `TokenValidationParameters`),
  `System.Security.Cryptography` (`RSA`, `RandomNumberGenerator`), and `TimeProvider` for the clock.
- **Concept introduced: asymmetric issuance, and one deliberate hole in validation.**
  `[Rubric §11, Security]` assesses token issuance and algorithm-confusion defense, and two choices
  here are worth reading slowly. First, `GetPrincipalFromExpiredToken` sets `ValidateLifetime = false`
  on purpose (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:172`) under
  a narrowly scoped `#pragma warning disable CA5404` (`:171`, restored at `:173`) whose comment states
  why: the refresh flow's whole job is reading claims out of a token that has already expired. Every
  other check stays on (`:168-170`). Second, the algorithm is pinned twice: `ValidAlgorithms` limits
  validation to the one algorithm this instance was built for (`:177`), and the token header's `alg` is
  re-compared with an ordinal string comparison *after* validation succeeds (`:186-187`). That pair is
  the defense against algorithm substitution, where an attacker takes the RSA *public* key (which is
  published on purpose) and presents it as an HMAC shared secret.
  `[Rubric §7, Microservices Readiness]` applies to the algorithm switch itself: RS256, the default,
  lets an extracted service validate a token without ever holding the issuer's private key, because it
  fetches the public key from the JWKS document that [`RsaJwksProvider`](#rsajwksprovider) publishes
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). HS256 remains
  available for a single-process monolith, where issuer and validator are the same host and a shared
  secret costs nothing (`:16-23`). `[Rubric §14, Testability]` shows up in the constructor: the clock
  is an injected `TimeProvider` with a `TimeProvider.System` fallback (`:67`), so a test can assert
  `iat`/`nbf`/`exp` without waiting for wall-clock time to pass. A third, `[Rubric §20, Policy and
  Enforcement Points]` concept sits in `GenerateAccessToken` itself: every access token now carries one
  [`AuthClaimTypes`](#authclaimtypes)`.Permission` claim per permission
  [`IPermissionRegistry`](#ipermissionregistry) grants the token's role (`:119-131`), so a client can
  gate its own surface on a capability rather than a role name it would otherwise have to know. A host
  that declared no grants resolves [`UnconfiguredPermissionRegistry`](#unconfiguredpermissionregistry),
  which grants nothing, and its tokens simply carry no permission claims (`:46-52`, the constructor's
  own doc comment on the parameter).
- **Walkthrough**
  - Fields (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:28-38`): the
    settings snapshot, the injected `IPermissionRegistry` (`:29`), the `TimeProvider`, the
    `SigningCredentials` used to sign, the `SecurityKey` and algorithm string used to validate, and two
    nullable owned `RSA` handles. The comment at `:35-36` explains why `IDisposable` is on the class at
    all: `RsaSecurityKey` does not own the `RSA` it wraps, so something has to.
  - The constructor
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:64-88`) takes
    `IPermissionRegistry permissionRegistry` as a required parameter, null-guarded alongside
    `jwtOptions` (`:70-71`) and assigned to `_permissionRegistry` (`:74`). It materializes all key
    material exactly once, so no token operation re-parses a PEM. For `JwtSigningAlgorithm.RS256` it
    builds RSA credentials and pins `SecurityAlgorithms.RsaSha256` (`:78-81`); the key id it passes is
    `jwksSettings?.Value.KeyId` falling back to a default `JwksSettings` instance (`:80`), which is how
    the same `kid` ends up on both the token and the published JWK
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:45`). Otherwise it
    builds HMAC credentials and pins `HmacSha256` (`:85-86`).
  - `GenerateAccessToken(userId, email, role, fullName, additionalClaims)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:91-134`) reads the
    clock once (`:98`), then builds six claims (`:104-112`): `sub` (the user id, formatted with
    `CultureInfo.InvariantCulture`), `jti` (a fresh GUID, so a token is individually identifiable),
    `iat` as Unix seconds, and the standard name, email and role claims. The comment at `:100-103` is a
    design note worth internalizing: `sub` is the *only* carrier of the user id. A duplicate custom
    claim used to ride alongside it, which meant two values that could disagree and two claim names
    every reader had to know; readers now go through
    [`ClaimsPrincipalExtensions`](#claimsprincipalextensions) instead. Caller-supplied claims are
    appended (`:114-117`). Then, before the token is assembled, permission claims are added
    (`:119-131`): `alreadyClaimed` collects any `Permission` claim value already present in `claims`
    (`:123-126`), and every permission `_permissionRegistry.GetPermissions(role)` returns that is not
    already in that set is appended, ordered ordinally for a deterministic token per role (`:128-131`).
    A `JwtSecurityToken` is then assembled with issuer, audience, `notBefore` from the injected clock and
    `expires` at `now + AccessTokenExpirationMinutes`, and serialized.
  - `GenerateRefreshToken()`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:145-149`) returns 64
    CSPRNG bytes Base64-encoded. It is not a JWT and carries no claims: it is an opaque bearer string
    whose only property is being unguessable, and the store it is compared against is what gives it
    meaning.
  - `AccessTokenLifetime` and `RefreshTokenLifetime`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:152`, `:155`) project
    the configured minutes and days, so callers computing an expiry timestamp never re-read settings
    and never disagree with the token just minted.
  - `GetPrincipalFromExpiredToken(string token)`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:164-198`) builds the
    validation parameters described above (`:166-178`), validates (`:184`), applies the
    post-validation `alg` re-check and returns `null` when the token is not a `JwtSecurityToken` or the
    header disagrees (`:186-190`), and swallows every exception into `null` (`:194-197`). A malformed,
    forged, or wrong-issuer token therefore produces a plain "no principal" answer rather than a parser
    exception leaking to the caller.
  - `Dispose()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:201-205`)
    releases both owned `RSA` handles.
  - `BuildHmacCredentials`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:207-219`) throws
    `InvalidOperationException` when `SecretForKey` is missing (`:209-213`) and Base64-decodes it into
    a `SymmetricSecurityKey` used for both signing and validation (`:215-217`).
  - `BuildRsaCredentials`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:221-276`) throws when
    `RsaPrivateKeyPem` is missing (`:225-229`), imports the private key (`:231-234`), and stamps the
    key id on the signing key (`:240`) so every RS256 token carries a `kid` header. The comment at
    `:236-239` gives the reason: a validator reading the published JWKS selects the key by name, and
    without a `kid` it has to try every published key, which stops working the moment a rotation
    publishes two. The validation key prefers the configured `RsaPublicKeyPem` and otherwise derives
    the public parameters from the private key (`:249-257`), so an issuer configured with only a
    private key still validates its own tokens during refresh; it carries the same key id (`:262`).
    Both nested `try`/`catch` blocks dispose the partially built `RSA` before rethrowing (`:265-269`,
    `:271-275`), so a bad PEM does not leak a native handle. Because all of this runs in the
    constructor, missing or malformed key material fails at host startup, not on the first login.
- **Why it's built this way**:
  [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) records the
  asymmetric-issuance rationale. The DI lifetime deserves its own read at the registration site
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:297-303`): the comment
  there records that a scoped lifetime disposed the underlying `RSA` at end-of-request while the static
  `CryptoProviderCache` in `Microsoft.IdentityModel.Tokens` still held the cached
  `AsymmetricSignatureProvider` wrapping it, throwing `ObjectDisposedException` on the next RS256 sign.
  Singleton is correct because the constructor depends only on singleton options and the service is
  stateless afterwards. Baking permission claims into the token itself, rather than having a client
  call back to look them up, is the same shape
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) establishes
  for permission-based authorization: the permission set travels with the credential.
- **Where it's used**: registered as `services.TryAddSingleton<ITokenService, TokenService>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:303`), which resolves
  [`IPermissionRegistry`](#ipermissionregistry) from the container alongside the JWT options, and
  consumed through the port by [`AuthenticationServiceBase<TUser>`](#authenticationservicebasetuser): the
  lifetime feeds the response's expiry
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:137-138`, with a
  15-minute floor when the setting is non-positive), the refresh flow reads the expired token (`:278`),
  and refresh tokens are minted at `:627` and `:667`. That base also wraps this service in a private
  `SessionStampingTokenService` pass-through
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:936`) which
  appends the [`AuthClaimTypes`](#authclaimtypes)`.SessionId` (`sid`) claim through the
  `additionalClaims` parameter when a session is armed (`:782-800`, the claim added at `:797`), so
  per-device session identity is layered on without this type knowing about sessions at all. The `sub`
  claim it writes is what [`CurrentUserService`](#currentuserservice) and
  [`ClaimBasedUserIdProvider`](#claimbaseduseridprovider) read back.
- **Caveats / not-in-source**: nothing here rotates or reloads key material. The keys are read once in
  the constructor
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:64-88`) and the
  instance is a singleton, so a key change takes a host restart. Refresh-token storage, rotation and
  revocation are not in this file either: it only produces the random string.

### EmailIdentity
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailIdentity.cs:12` · Level 5 · class (internal static)

- **What it is**: the one shared address-normalization helper for every cache key this module builds from an email address. `internal static string Normalize(string? email)` runs the supplied address through [Email](group-02-domain-building-blocks.md#email)`.Create` and returns the normalized value; a malformed address (which never matches a user but can still mint a key) falls back to the same trim-and-lowercase shape so its attempts collapse onto one key too (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailIdentity.cs:14-21`, `:22-31`).
- **Depends on**: the [Email](group-02-domain-building-blocks.md#email) value object (`:41`) only.
- **Concept introduced: one normalizer, extracted out from under three copies.** `[Rubric §15, Best Practices & Code Quality]` assesses whether a proven idiom is reused or reinvented per call site. [LoginProtectionService](#loginprotectionservice), [PasswordResetTokenService](#passwordresettokenservice) and [EmailConfirmationTokenService](#emailconfirmationtokenservice) each used to carry their own private `NormalizeIdentity` method, identical byte for byte, with each one's doc comment pointing at another as "the reason". `EmailIdentity.Normalize` is that method pulled out to one place: the three services now call it instead of copying it, so the normalization rule (and the scoped `#pragma warning disable CA1308` that documents why lowercasing is safe here) exists in exactly one file.
- **Walkthrough**: a single method. `Normalize(string? email)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailIdentity.cs:22-31`) returns `string.Empty` for a null, empty or whitespace-only input (`:24-25`); otherwise it calls `Email.Create(email)` and returns the normalized `Value` on success, or `email.Trim().ToLowerInvariant()` on failure (`:27-29`), under `#pragma warning disable CA1308` (`:28-30`) because that fallback intentionally matches `Email`'s own RFC 5321 lowercase normalization.
- **Why it's built this way**: `internal static` keeps the helper out of the package's public API, since it exists purely to keep the three token/lockout services' cache keys consistent with each other and with the [Email](group-02-domain-building-blocks.md#email) value object's own normalization, not to be a general-purpose utility.
- **Where it's used**: `LoginProtectionKey`-style builders in [LoginProtectionService](#loginprotectionservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs`, 2 call sites), [PasswordResetTokenService](#passwordresettokenservice) (2 call sites) and [EmailConfirmationTokenService](#emailconfirmationtokenservice) (2 call sites); unit-tested directly by `EmailIdentityTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/EmailIdentityTests.cs`).

### EmailConfirmationTokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:35` · Level 6 · class (sealed)

- **What it is**: the [IEmailConfirmationTokenService](#iemailconfirmationtokenservice) implementation: the email-confirmation token lifecycle, issue a single-use token for an address, throttle how often one address can ask, hash the token at rest, cap wrong guesses, and consume the token on a successful redeem (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:35-37`).
- **Depends on**: `IEmailConfirmationTokenService` (the Application port it implements); [EmailConfirmationSettings](group-08-auth.md#emailconfirmationsettings) via `IOptions<>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:37`, snapshotted at `:41`); [ICacheService](group-09-caching.md#icacheservice) (`:36`); [EmailConfirmationEntry](#emailconfirmationentry), its cached record; [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); [EmailIdentity](#emailidentity), the shared normalizer, at the two key builders (`:125`, `:127`); and from the BCL `SHA256`, `RandomNumberGenerator`, `CryptographicOperations`, and `System.Buffers.Text.Base64Url`.
- **Concept introduced: the same cache-backed token pattern, applied a third time.** `[Rubric §11, Security]` assesses credential issuance and redemption; `[Rubric §15, Best Practices & Code Quality]` assesses whether a proven idiom is reused or reinvented per flow. This type is structurally the same shape as [PasswordResetTokenService](#passwordresettokenservice): hash the token at rest, throttle issuance per address, cap validation attempts, and consume both the token and the request counter together on success. The `TokenKey` doc comment says so directly, citing [PasswordResetTokenService](#passwordresettokenservice) as the precedent for normalizing the cache key the same way [Email](group-02-domain-building-blocks.md#email) normalizes the lookup value (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:117-124`), and both key builders now call [EmailIdentity](#emailidentity)`.Normalize` instead of a private copy of the same helper (`:125`, `:127`). The same read-modify-write gap [LoginProtectionService](#loginprotectionservice) documents on its own throttle is inherited here too: the comment at the top of `IssueAsync` names it explicitly (`:49-50`).
- **Walkthrough**
  - `TokenByteLength = 32` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:39`) is the only constant; `_settings` is the snapshotted `EmailConfirmationSettings` (`:41`).
  - `IssueAsync(string email, UserIdentifierType userId, CancellationToken)` (`:44-76`): increments the per-email request counter with the configured `RequestWindowMinutes` TTL (`:51-54`) and fails with `Authentication.ConfirmationThrottled` once the count exceeds `MaxRequestsPerEmail` (`:56-62`). It then mints 32 CSPRNG bytes rendered with `Base64Url.EncodeToString` (`:64`), builds an [EmailConfirmationEntry](#emailconfirmationentry) holding the Base64 digest of the token, the user id, a zero attempt count, and the absolute expiry as Unix seconds (`:67-71`), caches it under the token key with the configured lifetime (`:73`), and returns the raw token to the caller (`:75`); the raw token is never written anywhere else.
  - `ValidateAndConsumeAsync(string email, string token, CancellationToken)` (`:79-115`): loads the entry and returns `InvalidToken()` when there is none (`:84-89`); a `FormatException` decoding the stored Base64 removes the unreadable record rather than leaving it to expire (`:91-101`); the comparison is `CryptographicOperations.FixedTimeEquals` over the two digests (`:103`), with `token ?? string.Empty` so a null token hashes rather than throwing; a mismatch records a failed attempt and returns the same generic failure (`:104-107`). On a match it removes **both** the token key and the address's request counter (`:109-112`), so a confirmed address is not left throttled out of a later legitimate request, and returns the entry's `UserId` (`:114`).
  - `TokenKey`, `RequestKey`, `HashToken` (`:117-130`): `TokenKey` and `RequestKey` each call [EmailIdentity](#emailidentity)`.Normalize` (`:125`, `:127`), producing `emailconfirm:token:{normalized}` and `emailconfirm:req:{normalized}` keys; `HashToken` is the shared SHA-256 helper (`:129-130`).
  - `RecordFailedAttemptAsync` (`:132-153`): computes `attempts = entry.FailedAttempts + 1` and the remaining lifetime from `ExpiresAtUnixSeconds` (`:137-138`). At `MaxValidationAttempts`, or once the remaining lifetime is non-positive, it deletes the record (`:140-144`); otherwise it rewrites the entry with `entry with { FailedAttempts = attempts }` at the **remaining** TTL, not a fresh one (`:146-152`).
  - `InvalidToken()` (`:155-157`) is the single failure factory built from `EmailConfirmationErrors.InvalidToken`, so unknown, expired, mismatched and attempt-capped tokens collapse to one error rather than giving an oracle for which addresses have an outstanding confirmation.
- **Why it's built this way**: reusing the pattern [PasswordResetTokenService](#passwordresettokenservice) established, rather than a bespoke implementation, is what keeps a third token lifecycle (login lockout, password reset, email confirmation) auditable as one idiom instead of three. [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) frames identity-completion flows like this one as opt-in per host.
- **Where it's used**: registered `services.TryAddScoped<IEmailConfirmationTokenService, EmailConfirmationTokenService>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:75`), directly after the `EmailConfirmationSettings` binding (`:69-70`).
- **Caveats / not-in-source**: the per-email request throttle is a read-modify-write on the distributed cache, the same gap [LoginProtectionService](#loginprotectionservice) documents on its own counters: concurrent requests can undercount, which loosens the throttle but never tightens it. The failed-attempt rewrite has the same property against the attempt cap.

### LoginProtectionService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19` · Level 6 · class (sealed)

- **What it is**: the cache-backed brute-force and rate-limiting service: exponential-backoff account lockout after repeated login failures, plus a per-IP registration rate limit (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:9-18`).
- **Depends on**: [ILoginProtectionService](#iloginprotectionservice) (the Application port); [LoginProtectionSettings](#loginprotectionsettings) via `IOptions<>` (`:21`, snapshotted at `:23`); [ICacheService](group-09-caching.md#icacheservice) (`:20`); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`:4`); [EmailIdentity](#emailidentity), the shared normalizer, at the two key builders (`:34`, `:36`).
- **Concept introduced: counter keys must be normalized the same way the lookup is.** `[Rubric §11, Security]` assesses brute-force protection and rate limiting; `[Rubric §12, Performance & Scalability]` assesses whether it is one shared service rather than logic copied per endpoint. Two mechanisms in this file deserve close reading.
  - **Key normalization** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:34-36`, documented at `:25-33`): `LockoutKey` and `AttemptsKey` each call [EmailIdentity](#emailidentity)`.Normalize(email)` (`:34`, `:36`) rather than carrying a private copy of the normalizer. Without normalization, the counter keys would be built from raw request input while the user lookup runs against the normalized value object, so `User@x.com`, `user@x.com` and `" user@x.com "` resolve to one account but get **independent** attempt counters, and an attacker defeats the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) backoff just by varying capitalization; a malformed address (which never matches a user but still increments a counter) falls back to the same trim-and-lowercase shape so its attempts collapse onto one key too. [EmailIdentity](#emailidentity) is where that trim-and-lowercase fallback and its scoped `#pragma warning disable CA1308` now live; [PasswordResetTokenService](#passwordresettokenservice) and [EmailConfirmationTokenService](#emailconfirmationtokenservice) call the same helper rather than each keeping their own copy.
  - **The lockout curve** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:69-79`): `excessAttempts = newCount - MaxFailedAttempts` (`:71`) drives `lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), MaxLockoutSeconds)` (`:77`), doubling the lockout per excess failure (1s, 2s, 4s, and so on) up to the configured cap. The inner `Math.Min(excessAttempts, 30)` clamps the shift exponent, and the comment explains why (`:73-76`): C# masks an `int` shift count to five bits, so `1 << 31` is negative and `1 << 32` wraps back to `1`, which would silently shrink the lockout for a sufficiently persistent attacker. Since `1 << 30` already exceeds the `[Range(1, 3600)]` cap on [LoginProtectionSettings](#loginprotectionsettings)`.MaxLockoutSeconds`, deep excess always lands on the cap.
- **Walkthrough**
  - Key builders: `LockoutKey` produces `login:lockout:{normalized}` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:34`), `AttemptsKey` produces `login:attempts:{normalized}` (`:36`), `RegistrationKey` produces `registration:ip:{ipAddress}` (`:125`, and note this one is **not** normalized: an IP literal is already canonical).
  - `CheckLockoutAsync(string email, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:39-50`): reads the boolean lockout key (`:42`) and returns `Error.Unauthorized("Auth.TooManyAttempts", ...)` when set, otherwise `Result.Success()` (`:44-49`). A cache miss is treated as not locked out (`?? false`), so a cache outage fails open on lockout rather than locking everyone out.
  - `IncrementFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:53-80`): increments the attempts key with the `FailedAttemptWindowMinutes` TTL (`:64-67`), and once the count reaches `MaxFailedAttempts` writes the lockout key with the exponential TTL (`:69-78`).
  - `ResetFailedAttemptsAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:83-87`): removes both keys on a successful login (`:85-86`).
  - `CheckRegistrationRateLimitAsync(string? ipAddress, ...)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:90-106`): a null or empty IP is unrestricted (`:92-95`); otherwise it compares the per-IP count against `MaxRegistrationsPerIpPerHour` and fails with `Auth.RegistrationRateLimitExceeded` (`:100-105`).
  - `IncrementRegistrationCountAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:109-123`): no-ops on a missing IP (`:111-114`) and otherwise increments the per-IP counter with the `RegistrationRateLimitWindowMinutes` TTL (`:119-122`). The comment (`:116-118`) notes the TTL is refreshed on every write, so the window slides rather than staying anchored to the first registration, which only ever tightens the limit.
- **Why it's built this way**: reusing [ICacheService](group-09-caching.md#icacheservice) (Redis in production, in-memory fallback) instead of a bespoke store keeps the service thin and lets counters expire naturally by TTL rather than needing a sweep job; `IOptions<>` keeps every threshold configurable per environment ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). Registered scoped (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:152`).
- **Where it's used**: injected into [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:78`), which calls all five members across its login and registration flows: the lockout check (`:131`), an increment on both the unknown-user and wrong-password branches (`:146`, `:161`), the reset on success (`:178`), and the registration rate-limit check and increment (`:197`, `:256`). Incrementing on the unknown-user branch as well as the wrong-password branch is what keeps the endpoint from becoming a user-enumeration oracle by timing or by lockout behavior.
- **Caveats / not-in-source**: the increment is documented in source as **not atomic** on the distributed cache today (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:55-63`). [DistributedCacheService](group-09-caching.md#distributedcacheservice)`.IncrementAsync` is a read-modify-write, because the Redis `INCR` it used to issue wrote a plain string key while `IDistributedCache` reads entries back as hashes, and the mismatch made the counter unreadable (`WRONGTYPE`). The accepted cost: genuinely parallel attempts can overwrite each other's increments, so a concurrent burst can stay under `MaxFailedAttempts`. Sequential guessing, which is what a credential-stuffing run against one account looks like, still trips the lockout. The comment names the two ways to close the gap (a Lua script that increments within the hash layout, or moving counters off `IDistributedCache`); neither is implemented today.

### PasswordResetTokenService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26` · Level 6 · class (sealed)

- **What it is**: the [IPasswordResetTokenService](#ipasswordresettokenservice) implementation, and the whole forgot-password token lifecycle in one file: issue a single-use token for an address, throttle how often one address can ask, hash the token at rest, cap wrong guesses, and consume the token on a successful redeem (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:12-24`).
- **Depends on**: [IPasswordResetTokenService](#ipasswordresettokenservice) (the Application port, `:5`); [PasswordResetSettings](#passwordresetsettings) via `IOptions<>` (`:28`, snapshotted at `:32`); [ICacheService](group-09-caching.md#icacheservice) (`:6`, `:27`); [PasswordResetEntry](#passwordresetentry) (its cached record); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`:7`); [EmailIdentity](#emailidentity), the shared normalizer, at the two key builders (`:40`, `:42`); and from the BCL `SHA256`, `RandomNumberGenerator`, `CryptographicOperations`, and `System.Buffers.Text.Base64Url` (`:1-3`).
- **Concept introduced: a reset token is a bearer credential, so treat it like a password.** `[Rubric §11, Security]` assesses credential issuance and redemption; `[Rubric §8, Data Architecture]` assesses picking the right store for the right lifetime. Four properties are designed in, and the class doc lists all four up front (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:15-24`).
  - **Hashed at rest.** Only `SHA256.HashData(...)` of the token is stored (`:44-45`, `:72`), so a cache dump does not hand out working reset links. Like [RefreshSession](#refreshsession) and unlike a password, a reset token is high-entropy (32 random bytes, `:30`, `:68`) and short-lived, which is why a plain digest is sufficient here where [PasswordHasher](#passwordhasher) needs 600,000 PBKDF2 iterations: there is no dictionary to run against a 256-bit random value.
  - **One active token per email.** The key is derived purely from the address (`:40`), so `SetAsync` overwrites (`:77`) and an older link stops working the moment a newer one is requested.
  - **Attempt cap.** Wrong tokens are counted on the record and the record is discarded at `MaxValidationAttempts` (`:129-133`), which turns the token into a credential you cannot grind at.
  - **No schema change, no sweeper.** The whole lifecycle rides [ICacheService](group-09-caching.md#icacheservice), so expiry is the cache TTL rather than a background job over a table ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). Compare [LoginProtectionService](#loginprotectionservice), which reaches the same conclusion for lockout counters.
- **Walkthrough**
  - Primary constructor takes `ICacheService cacheService` and `IOptions<PasswordResetSettings> settings` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26-28`), snapshotting `settings.Value` into `_settings` (`:32`). `TokenByteLength = 32` (`:30`) is the only other constant.
  - `TokenKey` and `RequestKey` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:40-42`) each call [EmailIdentity](#emailidentity)`.Normalize(email)` rather than carrying a private normalizer, and the doc comment cites [LoginProtectionService](#loginprotectionservice) as the origin of the rule (`:34-39`): keys built from raw request input would give `User@x.com` and `user@x.com` independent tokens **and** independent request counters while resolving to one account. `TokenKey` produces `pwdreset:token:{normalized}` (`:40`) and `RequestKey` produces `pwdreset:req:{normalized}` (`:42`). `HashToken` is the shared SHA-256 helper (`:44-45`).
  - `IssueAsync(string email, UserIdentifierType userId, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:48-80`): throttle first. It increments the per-email request counter with the `RequestWindowMinutes` TTL (`:55-58`) and fails with `Error.Unauthorized("Auth.ResetThrottled", ...)` once the count exceeds `MaxRequestsPerEmail` (`:60-66`). Only then does it mint the token: 32 CSPRNG bytes rendered with `Base64Url.EncodeToString` (`:68`, URL-safe because the token travels in a query string), builds a [PasswordResetEntry](#passwordresetentry) holding the Base64 digest, the user id, a zero attempt count and the absolute expiry as Unix seconds (`:71-75`), caches it under the token key with the configured lifetime (`:77`), and returns the **raw** token to the caller to email (`:79`). The raw token exists only in that return value: it is never written anywhere.
  - `ValidateAndConsumeAsync(string email, string token, CancellationToken)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:83-119`): loads the entry (`:88-89`) and returns `InvalidToken()` when there is none (`:90-93`). A `FormatException` decoding the stored Base64 removes the unreadable record rather than leaving it to expire (`:96-105`). The comparison is `CryptographicOperations.FixedTimeEquals` over the two digests (`:107`), the same timing-side-channel defense [PasswordHasher](#passwordhasher) uses, with `token ?? string.Empty` so a null token hashes rather than throwing. A mismatch records a failed attempt and returns the same generic failure (`:108-111`). On a match it removes **both** the token key and the address's request counter (`:115-116`), so a successful reset does not leave the user throttled out of a later legitimate request (`:113-114`), and returns the entry's `UserId` (`:118`).
  - `RecordFailedAttemptAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:121-142`): computes `attempts = entry.FailedAttempts + 1` and the remaining lifetime from `ExpiresAtUnixSeconds` (`:126-127`). At `MaxValidationAttempts`, or once the remaining lifetime is non-positive, it deletes the record (`:129-133`). Otherwise it rewrites the entry with `entry with { FailedAttempts = attempts }` and a TTL of the **remaining** seconds, not a fresh lifetime (`:135-141`), because a wrong guess must not be able to extend how long the token stays redeemable.
  - `InvalidToken()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:144-148`) is the single failure factory: unknown, expired, mismatched and attempt-capped all collapse to one `Auth.InvalidResetToken` error with one message. That uniformity is deliberate: distinct errors would make the endpoint an oracle for which addresses have an outstanding reset.
- **Why it's built this way**: [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) records the decision. It extends [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) (the cache-backed protection idiom reused here) and sits beside [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html), which decided how a password is stored but not how a user who has lost one gets a new one. Keeping the token out of the database is what makes the feature additive: no migration, no new table, and nothing to reap.
- **Where it's used**: registered `services.TryAddScoped<IPasswordResetTokenService, PasswordResetTokenService>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:158`), directly after the `PasswordResetSettings` binding (`:137-140`). [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand) calls `IssueAsync` and emails the resulting link (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:73`); [ResetPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand) calls `ValidateAndConsumeAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:76-78`) **before** the save, because leaving the token live until the write succeeds would open a replay window, and a token burned by a later invariant failure only costs the user one more reset request (`:58-60`). It is unit-tested by [PasswordResetTokenServiceTests](group-28-testing-infrastructure.md#passwordresettokenservicetests).
- **Caveats / not-in-source**: the per-email request throttle inherits [LoginProtectionService](#loginprotectionservice)'s non-atomic increment, and the source says so where it matters (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:53-54`): concurrent requests can undercount, which loosens the throttle but never tightens it. The failed-attempt rewrite is a read-modify-write too, so a burst of simultaneous wrong guesses can lose increments against the attempt cap; sequential guessing still trips it.

### AdministrationPermissions
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:15` · Level 0 · class (static)

- **What it is**: the two permission-string constants the framework's own administration
  controllers gate on, `ManageUsers` (value `"users:manage"`) and `ManageRoles` (value
  `"roles:manage"`)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:15-33`).
- **Depends on**: nothing first-party; it is a plain `const string` holder consumed by the
  permission-authorization pipeline.
- **Concept introduced, the framework shipping its own permission vocabulary for the
  administration surface it also ships.** `[Rubric §11, Security]` assesses the authorization
  model for built-in capabilities. `UsersAdminControllerBase` and `RolesAdminControllerBase` are
  framework code, so they need permission names that exist before any consuming app declares its
  own; `ManageUsers` and `ManageRoles` are those names, defined once so the base controllers and
  every host that wires a role to them agree on the string.
- **Walkthrough**: two `public const string` fields, each documented with the operation it
  gates: `ManageUsers` (`AdministrationPermissions.cs:17-18`) for listing, inspecting, locking,
  unlocking, and re-roling accounts; `ManageRoles` (`AdministrationPermissions.cs:20-21`) for
  listing roles and editing their stored permission grants.
- **Why it's built this way**: part of the opt-in identity completions
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)):
  `UsersAdminControllerBase<TUserDto>` and `RolesAdminControllerBase` ship gated on these two
  constants so a host adopting the built-in administration screens grants a role
  `AdministrationPermissions.ManageUsers`/`ManageRoles` rather than inventing its own strings.
- **Where it's used**: `RolesAdminControllerBase` and `UsersAdminControllerBase` require
  `[HasPermission(AdministrationPermissions.ManageRoles)]` / `[HasPermission(AdministrationPermissions.ManageUsers)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/RolesAdminControllerBase.cs`,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs`);
  `StoredPermissionRoleAdministrationService` grants and reads them against the layered registry
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`);
  `RoleAdminEdit.razor.cs` checks them client-side before rendering the edit UI
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminEdit.razor.cs`);
  ADC's `IdentityPermissions` re-exports both names alongside its own conference permissions
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs`),
  and `IdentityUIModule` grants `ManageUsers`/`ManageRoles` to the Organizer role
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs`).

### AuthClaimTypes
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:9` · Level 0 · class (static)

- **What it is**: the claim-type name constants the framework's own token vocabulary rests on,
  sitting alongside the standard `System.Security.Claims.ClaimTypes` values
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:5-9`).
- **Depends on**: nothing first-party at runtime. Its doc comments point at
  [IPermissionRegistry](#ipermissionregistry) for the role-derived half of the permission model
  (`AuthClaimTypes.cs:14`) and at
  [ClaimsPrincipalExtensions](#claimsprincipalextensions)`.FindUserIdValue` for the reader that
  papers over claim-name mapping (`AuthClaimTypes.cs:31`).
- **Concept introduced, a claim vocabulary owned by the framework rather than by each reader.**
  `[Rubric §11, Security]` assesses how authentication and authorization are modeled and which facts a
  principal is allowed to carry; `[Rubric §15, Best Practices & Code Quality]` assesses single points of change. A
  claim type is just a string, so writer and reader agreeing on it is a convention with no compiler
  behind it. Putting all three names in one `const` holder is what makes the token issuer and every
  reader provably agree.
  - `Permission` (`AuthClaimTypes.cs:24`, value `"permission"`) carries a single granted capability,
    honored **in addition to** the permissions a role confers through
    [IPermissionRegistry](#ipermissionregistry) (`AuthClaimTypes.cs:11-14`). The doc comment now
    states that [TokenService](#tokenservice) itself is the emitter (`AuthClaimTypes.cs:15-21`):
    every access token it mints carries one `Permission` claim per permission the role's registry
    entry grants, sorted ordinally so the same role always produces the same token shape. That is
    what lets a client decide what to show (a navigation entry gating on a required permission)
    without knowing any role name, while server-side checks still go through the registry, so a
    host that mints tokens some other way loses nothing. This makes the model in
    [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) backward
    compatible with plain role checks: a token still authorizes correctly if a reader ignores the
    claim entirely.
  - `Subject` (`AuthClaimTypes.cs:34`, value `"sub"`) is the single authoritative carrier of the user
    identifier in every token the framework mints. The doc comment states the trap that follows
    (`AuthClaimTypes.cs:26-33`): one value reaches readers under two different claim types, because
    the JWT bearer handler maps inbound `sub` onto `ClaimTypes.NameIdentifier` while a handler that
    materializes an identity straight from a token's claims leaves the raw `sub` in place.
  - `SessionId` (`AuthClaimTypes.cs:47`, value `"sid"`) is the RFC 7519 / OpenID Connect session id:
    the identifier of the refresh session the access token was minted for, which is to say the
    *device* behind the token (`AuthClaimTypes.cs:36-40`). It is **additive, never required**
    (`AuthClaimTypes.cs:41-45`): rotation mints a new session and therefore a new `sid`, a token
    issued before the claim shipped simply carries none, and nothing validates it. A missing or
    unparsable value degrades to "no current session known", never to a rejected token.
  - `MultiFactor` (`AuthClaimTypes.cs:60`, value `"mfa"`) is an RFC 8176 (`amr`)-style claim
    asserting that the access token was minted after a second authentication factor was presented
    (`AuthClaimTypes.cs:49-59`). **Presence is the assertion, not the value**: readers ask whether
    the claim exists (`ClaimsPrincipalExtensions.HasMultiFactor`), the value exists for audit and for
    UI copy such as "you signed in with a recovery code". A token issued for an account with no
    second factor carries no `mfa` claim at all, which is why a request marked `IRequiresMfa` denies
    such a caller rather than degrading to a role check. `MultiFactorMethodTotp` (`AuthClaimTypes.cs:63`,
    value `"otp"`) and `MultiFactorMethodRecoveryCode` (`AuthClaimTypes.cs:66`, value `"recovery"`)
    are the only two values `MultiFactor` carries: which second-factor method satisfied the
    challenge.
- **Walkthrough**: six `public const string` fields and nothing else. `const` rather than
  `static readonly` so the values are usable in attribute arguments and in patterns that require
  compile-time constants, the same reason [RoleNames](#rolenames) uses `const`.
- **Why it's built this way**:
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) makes the
  permission layer opt-in,
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html) adds the
  per-device session identity that `sid` names, and the opt-in two-factor completion
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)) adds `mfa`
  and its two method values. Keeping the claim types as shared constants means the writer and the
  reader cannot drift apart on a string.
- **Where it's used**:
  - `Permission` is written by [TokenService](#tokenservice) itself, one claim per permission the
    injected `IPermissionRegistry` grants the token's role, sorted ordinally and deduplicated against
    any permission claim the caller already supplied
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:119-131`), and is read
    by [PermissionAuthorizationHandler](#permissionauthorizationhandler), which checks
    `context.User.HasClaim(AuthClaimTypes.Permission, requirement.Permission)` before falling back to
    the registry
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:30-31`),
    and by [ClaimsPrincipalExtensions](#claimsprincipalextensions)`.HasPermissionClaim`.
  - `Subject` is written by [TokenService](#tokenservice) as `JwtRegisteredClaimNames.Sub`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:106`, with the
    one-carrier rationale at `:88-91`) and read through
    [ClaimsPrincipalExtensions](#claimsprincipalextensions) by
    [CurrentUserService](#currentuserservice), [ClaimBasedUserIdProvider](#claimbaseduseridprovider),
    the [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), and the rate-limit
    partitioner.
  - `SessionId` is stamped by the private
    [SessionStampingTokenService](#sessionstampingtokenservice) decorator inside
    [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:972`) and read
    back by `FindSessionId` for the "my sessions" endpoint
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:187`).
  - `MultiFactor` and its two method values are stamped by the sign-in flow after a second factor
    verifies, and read through
    [ClaimsPrincipalExtensions](#claimsprincipalextensions)`.HasMultiFactor`/`FindMultiFactorMethod`
    by any use case marked `IRequiresMfa`.
- **Caveats / not-in-source**: the `Permission` claim is now written by every token the framework
  mints (`TokenService.cs:119-131`), which supersedes the older behavior where no shipped token
  issuer wrote it; a reader depending on `Permission` being absent from real tokens would be wrong
  today. The registry lookup remains the authoritative check either way, since the claim path is
  additive.

### AuthErrorCodes
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthErrorCodes.cs:12` · Level 0 · class (static)

- **What it is**: one error-code constant, `EmailAlreadyExists` (value `"Auth.EmailAlreadyExists"`),
  returned when registration is refused because the address already belongs to an account
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthErrorCodes.cs:12-20`).
- **Depends on**: nothing first-party; consumed as an `Error` code string.
- **Concept introduced, one code for two different failure paths.** `[Rubric §15, Best Practices &
  Code Quality]` assesses whether a caller-facing contract stays stable across an implementation
  detail. Both the up-front existence check and the unique-index race recovery during registration
  return this same code, so the two paths stay indistinguishable to the caller
  (`AuthErrorCodes.cs:14-15`). The registration UI keys its "sign in instead" guidance on this code.
- **Walkthrough**: a single `public const string EmailAlreadyExists` field.
- **Why it's built this way**: a race between the pre-check and the database's unique constraint is
  possible under concurrent registration attempts; returning the same code from both paths means the
  caller-facing behavior does not depend on which path lost the race.
- **Where it's used**: returned by `AuthenticationServiceBase`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`) and asserted
  by the registration form's tests
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs`).

### IPermissionCatalog
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionCatalog.cs:24` · Level 0 · interface

- **What it is**: the read-only enumeration half of the permission model: every role the compiled
  registry grants something to, and every permission it grants to anyone, both sorted ordinally
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionCatalog.cs:24-31`).
- **Depends on**: nothing first-party; it is a companion abstraction to
  [IPermissionRegistry](#ipermissionregistry).
- **Concept introduced, separating "does this role grant that permission" from "what roles and
  permissions exist at all".** `[Rubric §1, SOLID]` applies to interface segregation:
  [IPermissionRegistry](#ipermissionregistry) answers a per-request authorization question,
  `IPermissionCatalog` answers an administration-screen enumeration question, and a consumer that
  only needs to render a permission-grant matrix does not have to depend on the authorization
  interface at all.
- **Walkthrough**: two get-only properties, `Roles` and `Permissions`, both
  `IReadOnlyList<string>`.
- **Why it's built this way**: [PermissionRegistry](#permissionregistry) already holds the closed set
  of roles and permissions compiled into the host, so the catalog is a second, narrower interface
  the same class implements explicitly, rather than a second source of truth that could drift.
- **Where it's used**: implemented explicitly by [PermissionRegistry](#permissionregistry); read by
  `StoredPermissionRoleAdministrationService`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`),
  `PermissionCatalogResponse`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/PermissionCatalogResponse.cs`), and
  `AuthorizationExtensions`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs`);
  registered alongside [IPermissionRegistry](#ipermissionregistry) in both `MMCA.Common.Application`
  and `MMCA.Common.Infrastructure` `DependencyInjection.cs`.

### IPermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:14` · Level 0 · interface

- **What it is**: the abstraction that maps roles to the fine-grained permissions they grant, and the
  single place that knows which roles confer which capabilities
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:3-14`).
- **Depends on**: nothing first-party; its remarks reference [RoleNames](#rolenames) for the
  case-insensitivity rule.
- **Concept introduced, permission (capability) authorization over role checks.** `[Rubric §11,
  Security]` assesses the authorization model, and `[Rubric §1, SOLID]` assesses dependency inversion:
  endpoints depend on an abstraction, not on a role name. Instead of scattering
  `[Authorize(Roles = "Organizer")]` across endpoints, code authorizes against a *permission* (a
  capability such as `sessions:manage`) and this registry translates a principal's roles into the
  permissions they hold. The payoff is decoupling: adding a role or reshaping who-can-do-what is a
  registry change, not an edit to every endpoint (`IPermissionRegistry.cs:4-7`). The remarks also fix
  the comparison rules (`IPermissionRegistry.cs:9-13`): role lookups are case-insensitive, permission
  values are compared ordinally, and implementations are expected to be immutable and thread-safe.
  Those three sentences are what let the implementation be a frozen, lock-free structure.
- **Walkthrough**: two members. `GetPermissions(string role)` (`IPermissionRegistry.cs:21`) returns
  the permission set for a role, or an empty set for an unknown role, never a throw
  (`IPermissionRegistry.cs:16-18`). `HasPermission(IEnumerable<string> roles, string permission)`
  (`IPermissionRegistry.cs:29`) answers whether *any* of a principal's roles grants the permission:
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13`).

### IUserAdminDTO
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Administration/IUserAdminDTO.cs:15` · Level 0 · interface

- **What it is**: the shape the built-in user-administration list page renders a row from: account
  id, email, role, and a locked flag
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Administration/IUserAdminDTO.cs:15-31`).
- **Depends on**: the solution-wide `UserIdentifierType` alias for `UserId`.
- **Concept introduced, an app-supplied DTO shape behind a framework-defined contract.** `[Rubric
  §1, SOLID]` assesses dependency inversion for a UI component shipped by the framework but rendering
  app-owned data. `UserAdminList.razor.cs` cannot know each app's concrete user-list DTO, so it
  depends on this interface instead; each app's own list DTO implements it. `IsLocked` is
  deliberately one boolean over two different underlying representations: the doc comment states ADC
  reads it off `LockedOn is not null` while Store reads it off `!IsActive`
  (`IUserAdminDTO.cs:20-24`), so the list page renders identically regardless of which lockout model
  the app uses.
- **Walkthrough**: four get-only properties: `UserId` (the identifier the detail route and every
  administration call key on), `Email` (the row's primary label), `Role` (the account's single
  role), and `IsLocked` (whether the account is shut out of sign-in).
- **Why it's built this way**: the built-in administration UI is framework code shared by every
  consumer, so it can only render through an abstraction each app's own user-list projection
  implements.
- **Where it's used**: consumed by `UserAdminList.razor.cs`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminList.razor.cs`) and
  registered by `MMCA.Common.UI`'s `DependencyInjection.cs`; implemented by ADC's
  `UserListDTO`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserListDTO.cs`).

### ClaimsPrincipalExtensions
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:18` · Level 1 · class (static)

- **What it is**: the one place the framework reads identity claims off a `ClaimsPrincipal`: the raw
  user-id value, the parsed user id, the caller's roles, an explicit permission claim, the
  refresh-session id, and whether a second authentication factor was presented
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:6-18`).
- **Depends on**: [AuthClaimTypes](#authclaimtypes) for the claim names it reads
  (`ClaimsPrincipalExtensions.cs:28` `Subject`, `:98` `Permission`, `:112` `SessionId`, `:129,139`
  `MultiFactor`); the solution-wide `UserIdentifierType` alias; BCL `System.Security.Claims` and
  `System.Globalization` (`ClaimsPrincipalExtensions.cs:1-2`).
- **Concept introduced, one reader for a claim that arrives under two names.** `[Rubric §11,
  Security]` assesses whether identity resolution is correct and uniform, and `[Rubric §15,
  Best Practices & Code Quality]` assesses whether a fragile detail is centralized or copy-pasted. The trap is
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
- **Walkthrough**: eight extension methods, all null-tolerant by construction (every parameter is
  `ClaimsPrincipal?`, so a null principal yields null, empty, or false rather than throwing).
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
  - `GetRoleValues(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:59-67`) returns every role
    value the principal carries under any of three claim types: the standard `ClaimTypes.Role` URI,
    or the raw `role`/`roles` claim an identity provider emits with inbound-claim mapping off. The
    remarks mark it SECURITY: it is the framework's **one** definition of "the caller's roles",
    because the narrower BCL `ClaimsPrincipal.IsInRole(string)` sees only the identity's own role
    claim type and can therefore disagree with the authorization handler about who is privileged.
  - `HasRole(this ClaimsPrincipal?, string)` (`ClaimsPrincipalExtensions.cs:75-77`) is
    `GetRoleValues().Contains(role, StringComparer.OrdinalIgnoreCase)`, guarded against a blank role.
  - `HasPermissionClaim(this ClaimsPrincipal?, string)` (`ClaimsPrincipalExtensions.cs:94-97`) checks
    for an [AuthClaimTypes](#authclaimtypes)`.Permission` claim matching the given permission,
    independently of role. The remarks mark it SECURITY too: both authorization gates, the HTTP
    policy handler and the CQRS pipeline gate, read it, so a grant the minting host stored and
    emitted as a claim is honored identically at both boundaries; in a multi-service deployment the
    claim is the only way such a grant reaches a service that does not own the grant table. It is
    additive, never a denial: a principal without the claim still passes on a role the registry
    grants.
  - `FindSessionId(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:109-113`) reads the `sid`
    claim and `Guid.TryParse`s it. The remarks make the degradation explicit (`:50-54`): `null` is an
    ordinary answer, not an error, because tokens issued before `sid` shipped carry no such claim, and
    every reader treats its absence as "the caller's own session is unknown". Nothing authenticates on
    this value.
  - `HasMultiFactor(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:127-129`) is
    `principal?.FindFirst(AuthClaimTypes.MultiFactor) is not null`. The remarks mark it SECURITY:
    presence is the whole test, and absence denies rather than falling back to a role check, because
    only the sign-in flow stamps the claim, and only after a code verified.
  - `FindMultiFactorMethod(this ClaimsPrincipal?)` (`ClaimsPrincipalExtensions.cs:137-139`) returns the
    value of the `MultiFactor` claim, or `null` when the principal carries none, for audit and UI copy
    such as "signed in with a recovery code".
- **Why it's built this way**: [TokenService](#tokenservice) records the other half of the story in a
  comment (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:100-103`): a
  duplicate custom user-id claim used to ride alongside `sub`, which meant two values that could
  disagree and two claim names every reader had to know. Collapsing the writer to one claim
  (`TokenService.cs:106`) is only safe because one reader absorbs the mapping difference, which is this
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
  the opt-in "UserPolicy" rate-limit partition keys on `httpContext.User?.Identity?.Name` directly
  rather than on `GetUserId()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:171-175`);
  [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase) uses `FindSessionId()` to
  tell the session list which row is the caller's own
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:187`);
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser) uses `GetUserId()` on the
  principal recovered from an expired access token during rotation
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:355-358`); and
  [TestPrincipal](group-28-testing-infrastructure.md#testprincipal) writes `sub` precisely so test
  principals resolve the same way real ones do
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:19,27`);
  `GetRoleValues`/`HasRole` back the CQRS pipeline's `Authorization` decorator gate; `HasPermissionClaim`
  backs both the HTTP `PermissionAuthorizationHandler` and the CQRS gate so a claim-carried grant is
  honored identically at either boundary; `HasMultiFactor` backs the CQRS gate's `IRequiresMfa` check.
- **Caveats / not-in-source**: MMCA.Store's Sales UI module defines its own unrelated
  `ClaimsPrincipalExtensions` in a different namespace
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Extensions/ClaimsPrincipalExtensions.cs:9`);
  do not confuse the two when reading a `using` list. Also note `GetUserId` returns a nullable value
  type, so `is { } userId` pattern-matching (as ADC's Blazor pages use) is the idiomatic call shape,
  not a `!` dereference.

### PermissionRegistry
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Permissions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:16` · Level 1 · class (sealed)

- **What it is**: the immutable, thread-safe implementation of
  [IPermissionRegistry](#ipermissionregistry) and, since the catalog interface shipped, of
  [IPermissionCatalog](#ipermissioncatalog) too, backed by a frozen role-to-permissions map
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:16-20`).
- **Depends on**: [IPermissionRegistry](#ipermissionregistry) and
  [IPermissionCatalog](#ipermissioncatalog); `System.Collections.Frozen`
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
  (`PermissionRegistry.cs:34-37`).
- **Walkthrough**: a shared empty `FrozenSet` sentinel and the frozen map field, plus two
  `IReadOnlyList<string>` backing fields for the catalog, `_roles` and `_permissions`
  (`PermissionRegistry.cs:19-23`). The constructor (`PermissionRegistry.cs:30`) guards its argument,
  freezes the supplied map with the two comparers (`PermissionRegistry.cs:34`), then materializes
  `_roles` (the map's keys, ordinally sorted) and `_permissions` (every permission across every role,
  deduplicated and ordinally sorted) once, at construction (`PermissionRegistry.cs:41-48`); the
  comment explains why: the registry is immutable, so computing the sorted lists once avoids
  re-sorting the whole map on every request an administration screen makes. `Roles` and
  `Permissions` (`PermissionRegistry.cs:55,58`) implement [IPermissionCatalog](#ipermissioncatalog)
  **explicitly**, with a comment explaining that the catalog's `Permissions` and the registry's
  `GetPermissions(role)` answer different questions, so a caller holding the concrete type should not
  have to tell them apart (also Sonar CA1721); the catalog is meant to be consumed through the
  `IPermissionCatalog` interface. `GetPermissions` (`PermissionRegistry.cs:61-65`) returns the
  matching set, or the shared sentinel on a null or unknown role, so it never allocates and never
  throws: the empty-set-on-miss contract from the interface, made literal. `HasPermission`
  (`PermissionRegistry.cs:67`) guards its inputs (`PermissionRegistry.cs:70-71`), then walks the
  principal's roles and returns on the first role whose set contains the permission
  (`PermissionRegistry.cs:73-83`), so the common case of a matching first role costs one dictionary
  probe and one set probe.
- **Why it's built this way**: freezing at construction trades a one-time build cost for fast,
  allocation-free, lock-free concurrent reads, which suits a startup-built structure hit on every
  authorized request
  ([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)). Adding
  [IPermissionCatalog](#ipermissioncatalog) to the same class rather than a second type means the
  administration screen's "what roles and permissions exist" question is answered from the exact
  data structure the authorization question is answered from, so the two cannot drift apart.
- **Where it's used**: constructed by [PermissionRegistryBuilder](#permissionregistrybuilder)`.Build`
  and registered as the [IPermissionRegistry](#ipermissionregistry) singleton in
  [AuthorizationExtensions](#authorizationextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:69-71`);
  read by [PermissionAuthorizationHandler](#permissionauthorizationhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:14,31`);
  its [IPermissionCatalog](#ipermissioncatalog) side is read by
  `StoredPermissionRoleAdministrationService` and exposed through `PermissionCatalogResponse`.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:114-137`);
  modules reach it through `AddPermissions(...)`, which is deliberately safe to call once per module
  (`AuthorizationExtensions.cs:96-111`), as MMCA.ADC's Conference, Engagement, and Identity modules
  each do
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:41-50`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:58-61`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:44-47`).
- **Caveats / not-in-source**: the lazy build means a `Grant` call made after the first
  [IPermissionRegistry](#ipermissionregistry) resolve would silently not take effect; the API doc says
  to call before the host is built (`AuthorizationExtensions.cs:99`), but nothing enforces it at
  runtime.

### RoleValue

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:26` · Level 3 · class (abstract)

- **What it is**: the abstract base for a role value object. It stores one canonical string, gives it
  case-insensitive value equality and hashing, and offers a shared validation helper against a
  per-app set of known role names
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:6-26`).
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`
  (`RoleValue.cs:2`), plus `System.Collections.Frozen` from the BCL (`RoleValue.cs:1`). Its doc
  comments point at [`RoleNames`](#rolenames) for the canonical strings (`RoleValue.cs:9`) and at
  `ICurrentUserService.IsInRole` for the comparison semantics it matches (`RoleValue.cs:17`).
  Conceptually a value object (see [`ValueObject`](group-02-domain-building-blocks.md#valueobject))
  but deliberately not derived from that base, for a reason the next bullet unpacks.
- **Concept introduced, a value object as an abstract class with type-guarded equality.**
  `[Rubric §4, Domain-Driven Design]` assesses whether identity-less concepts are modeled as value
  objects rather than bare primitives, and `[Rubric §1, SOLID]` applies to how an open hierarchy is
  left safe to extend. A role has no database identity: two "Organizer" values are the same role, so
  the type is defined by its value, which is exactly the value-object shape. Two design decisions
  make this base unusual, and both are written into the source:
  1. **No `IEquatable<T>` on the base** (`RoleValue.cs:18-24`). The remarks cite Sonar S4035: an
     unsealed type implementing `IEquatable<T>` breaks the equality contract, because a subclass
     instance compared through the base-typed interface can report an equality the derived type
     would reject. Instead equality is the plain `object.Equals` override, and it is type-guarded:
     `GetType() == other.GetType()` before the value comparison (`RoleValue.cs:91-94`), so a role of
     one concrete type is never equal to a same-valued role of another. A *sealed* derived type is
     then free to layer a strongly-typed `IEquatable<TSelf>` plus `==`/`!=` on top, which is what
     ADC's `UserRole` does
     (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:18,78-84`).
  2. **It does not derive from [`ValueObject`](group-02-domain-building-blocks.md#valueobject)**, and
     that is a fitness-rule consequence, not an oversight. `ValueObjectsAreImmutableSealedInShared`
     requires every concrete class whose base type starts with
     `MMCA.Common.Shared.ValueObjects.ValueObject` to be sealed, immutable, *and* to live in the
     Shared layer
     (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Immutability.cs:56-72`).
     A concrete role type lives in its app's Domain layer
     (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:6`), so deriving
     from `ValueObject` would fail that rule in every app. Keeping the base in `MMCA.Common.Shared`
     with its own equality also keeps it dependency-free and therefore usable from Blazor WebAssembly
     and UI code as well as Domain (`RoleValue.cs:12-17`). The same trade-off is made by
     [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration), whose
     own remarks name `RoleValue` as the shipped precedent
     (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:34`).

  `[Rubric §11, Security]` applies too, because role strings arrive as JWT claim values whose casing
  is not under this codebase's control. Every comparison here is `OrdinalIgnoreCase`, so an
  authorization check does not silently miss on `"organizer"` against `"Organizer"`.
- **Walkthrough**: a get-only `Value` (`RoleValue.cs:29`) assigned by the protected constructor
  (`RoleValue.cs:33`), so an instance is immutable and only a derived type can create one. The static
  `Validate(role, knownRoles, source)` (`RoleValue.cs:43`) null-guards the supplied set
  (`RoleValue.cs:45`), then returns `Result.Success()` when the role is known, otherwise a
  [`Result`](group-01-result-error-handling.md#result) failure carrying an
  [`Error`](group-01-result-error-handling.md#error) of kind `Invariant`, coded `User.Role.Invalid`,
  with the caller's method name as `source` and `role` as `target` (`RoleValue.cs:47-53`). The
  membership test is the private `IsKnown` (`RoleValue.cs:64-66`) and it is more careful than it
  first looks: the fast path is the supplied set's own `Contains` (correct and O(1) for the intended
  `OrdinalIgnoreCase` sets, with a `role ?? string.Empty` coalesce so a null role becomes a clean
  failure rather than a `NullReferenceException`), and a miss falls back to an explicit
  case-insensitive `Any` scan, so a set built with the *default* ordinal comparer still validates
  case-insensitively as the contract promises (`RoleValue.cs:56-63`). Role sets hold a handful of
  entries, so the fallback is negligible and only ever runs on a miss. The protected generic
  `BuildLookup<TRole>(params TRole[] roles)` (`RoleValue.cs:76`) freezes the supplied singletons into
  a case-insensitive `FrozenDictionary` keyed by `Value` (`RoleValue.cs:81-84`), so a derived type
  can back its `FromString`/`IsValid` members with interned instances instead of re-allocating on
  every parse. `ToString` returns the value (`RoleValue.cs:88`), and `GetHashCode` uses the
  ordinal-ignore-case hash (`RoleValue.cs:97`) so it stays consistent with `Equals`, which is the
  contract any dictionary or `HashSet` key depends on.
- **Why it's built this way**: the abstract-class-plus-type-guard shape is how you share equality
  behavior across an open hierarchy of value objects without violating the equality contract, and the
  S4035 rationale is documented inline (`RoleValue.cs:18-24`) so a future reader does not
  "helpfully" add `IEquatable<T>` to the base. The comparer-agnostic `IsKnown` fallback exists
  because `Validate` accepts any `IReadOnlySet<string>`: the type cannot see how the caller built the
  set, so it enforces its own promise instead of trusting the caller's comparer. That behavior is
  pinned by test, including the default-comparer case
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Auth/RoleValueTests.cs:24`), the
  `OrdinalIgnoreCase` case (`RoleValueTests.cs:36`), a null role (`RoleValueTests.cs:65`), and a null
  role set throwing (`RoleValueTests.cs:73`).
- **Where it's used**: the two apps consume it differently, and the difference is instructive.
  ADC derives a full sealed value object, [`UserRole`](group-24-identity-module.md#userrole), which
  fixes three roles (Organizer, Attendee, ContentEditor), interns them through `BuildLookup`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:21-34`), exposes
  `FromString` returning a `Result<UserRole>` and `IsValid` over that frozen lookup
  (`UserRole.cs:52-66`), and adds a case-insensitive `IsOrganizer` for raw claim strings
  (`UserRole.cs:76`) plus the sealed-type `IEquatable<UserRole>` and `==`/`!=` operators the base
  leaves to subclasses (`UserRole.cs:78-90`). Store's `UserRole` is a **static class**, not a
  subclass: it fixes Admin and Customer as string properties over an `OrdinalIgnoreCase` set and
  calls the shared `RoleValue.Validate` helper for its `IsValid`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserRole.cs:14,26-30,37`), so
  it inherits the rule set (case-insensitive membership, the `User.Role.Invalid` code) without
  inheriting the type. Both key their known-role sets off the [`RoleNames`](#rolenames) constants,
  and [`PermissionRegistryBuilder`](#permissionregistrybuilder) keeps its role keys on the same
  case-insensitive comparer to match
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistryBuilder.cs:11`).

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

### ConfirmEmailRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/EmailConfirmationRequests.cs:19` · Level 0 · record struct (readonly)

- **What it is**: `(string Email, string Token)`, the payload that redeems a single-use
  email-confirmation token
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/EmailConfirmationRequests.cs:14-21`).
- **Depends on**: nothing first-party. It pairs with
  [SendEmailConfirmationRequest](#sendemailconfirmationrequest), which triggers the mail this one
  redeems.
- **Concept**: the `readonly record struct` request shape from [LoginRequest](#loginrequest).
  `[Rubric §11, Security]`: like [ResetPasswordRequest](#resetpasswordrequest), the address and token
  are carried in the URI **fragment**, so ADC's confirm-email page reads them client-side and posts
  them here; neither value ever reaches a server log or a `Referer` header, per the controller action's
  own doc comment
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/EmailConfirmationController.cs:65-67`).
- **Walkthrough**: two positional parameters (`EmailConfirmationRequests.cs:19-21`); no body.
- **Where it's used**: shape-validated by
  [ConfirmEmailRequestValidator](#confirmemailrequestvalidator); handled through
  `ConfirmEmailCommand`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ConfirmEmail/ConfirmEmailCommand.cs`)
  by the shared
  [ConfirmEmailHandlerBase](group-14-module-system-composition.md#confirmemailhandlerbase); exposed by
  ADC's `EmailConfirmationController`'s anonymous, rate-limited, idempotent `POST confirm-email`
  (`EmailConfirmationController.cs:72-82`), which answers 204 on success; posted by ADC's
  `EmailConfirmationService` UI client.
- **Caveats / not-in-source**: email confirmation is send-only in ADC today
  (`Authentication:EmailConfirmation:RequireConfirmedEmail` stays `false` everywhere), so redeeming this
  request updates the stored confirmation state but never gates sign-in; Store does not wire this
  endpoint.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:204,212`).
- **Caveats / not-in-source**: both applications now wire this vertical. ADC has a
  [ForgotPasswordCommand](group-24-identity-module.md#forgotpasswordcommand)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:12-13`)
  and a derived controller
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/PasswordResetController.cs:36`);
  Store has the same pair
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:11`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/PasswordResetController.cs:33`).

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
- **Walkthrough**: two positional parameters (`LoginRequest.cs:8-10`), plus an init-only
  `TwoFactorCode` property carrying the second-factor code when the account has two-factor
  authentication enabled, either the authenticator-app code or a single-use recovery code
  (`LoginRequest.cs:8-15,20-24`). The doc remark explains why it is a property rather than a third
  positional parameter: a positional parameter would widen the generated `Deconstruct`, a source break
  for any caller that destructures a login request, while a property leaves the constructor, the
  deconstruction, and the JSON shape of every existing caller untouched, and a client that never sends
  the field simply leaves it `null` (`LoginRequest.cs:16-19`). Omitting it on the first attempt is the
  normal flow: sign-in answers `Authentication.TwoFactorRequired` when the account needs a code and
  none arrived, and the client retries the same credentials with the code filled in
  (`LoginRequest.cs:21-23`).
- **Where it's used**: shape-validated by [LoginRequestValidator](#loginrequestvalidator), which is
  deliberately minimal (non-empty plus address shape) so that no field-level 400 hints at which half
  of the credential was wrong
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:6-10,15-20`);
  then handled by [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)`.LoginAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:156-157`), which
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
  blank code (`OAuthControllerBase.cs:185-188`), looks the code up in
  [ICacheService](group-09-caching.md#icacheservice) (`OAuthControllerBase.cs:190-198`), and then
  removes it so a replayed code cannot mint a second token pair (`OAuthControllerBase.cs:200-201`); an
  unknown, burned, or expired code all return the same HTTP 400 with a deliberately non-specific
  message (`OAuthControllerBase.cs:206-209`). The action is also marked `[NonIdempotent]` with the
  reason inline: replaying a stored response would defeat the burn and let a leaked code mint the same
  tokens again (`OAuthControllerBase.cs:178`).
- **Where it's used**: the body of the OAuth `exchange` endpoint
  (`OAuthControllerBase.cs:177,181-183`), called by the UI's `/auth/oauth-complete` page after the
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:334-335`), which
  rejects an unreadable token or a principal with no usable user id with an `Auth.InvalidToken`
  failure before it ever looks at the refresh token (`AuthenticationServiceBase.cs:351-352,358-362`);
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:76-78`).
  The anti-enumeration discipline that governs the forgot half continues here in a different form:
  an unknown, expired, mismatched or attempt-capped token and a vanished account all collapse to one
  `Auth.InvalidResetToken` 401 with the same message, so the response distinguishes none of them
  (`ResetPasswordHandlerBase.cs:18-23,79-83,88-92,116-120`). One ordering decision is worth
  internalizing: the token is consumed *before* the save, and the comment says why
  (`ResetPasswordHandlerBase.cs:73-75`), because leaving it live until the write succeeds would open a
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
  out (`ResetPasswordHandlerBase.cs:94-95,101,109-110`); posted by
  [AuthUIService](group-15-common-ui-framework.md#authuiservice)'s `ResetPasswordAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:221,231`). ADC
  carries it in a [ResetPasswordCommand](group-24-identity-module.md#resetpasswordcommand) marked
  `ICacheInvalidating`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:15-16`);
  Store carries its own, without that marker
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:12`).

### SendEmailConfirmationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/EmailConfirmationRequests.cs:12` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Email)` that asks for a fresh confirmation link to
  be emailed to an address
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/EmailConfirmationRequests.cs:3-12`).
- **Depends on**: nothing first-party. It is the anti-enumeration sibling of
  [ForgotPasswordRequest](#forgotpasswordrequest): the doc comment says this endpoint is anonymous by
  necessity (an unconfirmed account may not be able to sign in at all) and answered identically whether
  or not the address holds an account, for the same reason the forgot-password endpoint is
  (`EmailConfirmationRequests.cs:6-9`).
- **Concept**: see [ForgotPasswordRequest](#forgotpasswordrequest) for the anti-enumeration contract
  this reuses; not re-taught here.
- **Walkthrough**: one positional `string Email` (`EmailConfirmationRequests.cs:12`); no body.
- **Where it's used**: shape-validated by
  [SendEmailConfirmationRequestValidator](#sendemailconfirmationrequestvalidator); bound as the body of
  ADC's anonymous, rate-limited, idempotent `POST send-email-confirmation` action, which returns
  `202 Accepted` on every well-formed request
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/EmailConfirmationController.cs:46-61`);
  carried by `SendEmailConfirmationCommand`
  (`EmailConfirmationController.cs:58`), handled by the shared
  [SendEmailConfirmationHandlerBase](group-14-module-system-composition.md#sendemailconfirmationhandlerbase).
  ADC's own `AuthController.RegisterAsync` schedules the send as part of registration rather than
  calling this endpoint directly.

### SetRolePermissionsRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/AdministrationRequests.cs:23` · Level 0 · record (sealed)

- **What it is**: `(IReadOnlyList<string> Permissions)`, the payload that replaces the complete set of
  stored permission grants for one role
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/AdministrationRequests.cs:14-23`).
- **Depends on**: nothing first-party.
- **Concept introduced, replace rather than add/remove.** `[Rubric §9, API & Contract Design]`: the doc
  remark explains the shape choice, a replace rather than an add/remove pair makes the request
  idempotent (re-submitting the same list is a no-op), and these are the **stored** grants only:
  permissions compiled into the host's `IPermissionRegistry` are not editable and are not returned
  here, so an operator can never remove a capability the code depends on by editing data
  (`AdministrationRequests.cs:17-20`).
- **Walkthrough**: one positional `IReadOnlyList<string> Permissions` on a `sealed record`
  (`AdministrationRequests.cs:23`); no body.
- **Where it's used**: bound as the body of
  [RolesAdminControllerBase](group-12-api-hosting-mapping.md#rolesadmincontrollerbase)'s
  `SetPermissions` action
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/RolesAdminControllerBase.cs:145`);
  shape-validated by
  [SetRolePermissionsRequestValidator](#setrolepermissionsrequestvalidator), which requires a non-null
  list and validates each entry
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/AdministrationRequestValidators.cs:30,37,39`);
  consumed by [IRoleAdministrationService](#iroleadministrationservice) and posted by the Common UI's
  `RoleAdminService`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/RoleAdminService.cs`).

### SetUserRolesRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/AdministrationRequests.cs:12` · Level 0 · record (sealed)

- **What it is**: `(IReadOnlyList<string> Roles)`, the payload that replaces the complete set of roles
  an account holds
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/AdministrationRequests.cs:3-12`).
- **Depends on**: nothing first-party.
- **Concept**: the same replace-not-patch shape as
  [SetRolePermissionsRequest](#setrolepermissionsrequest); see that section for the idempotency
  rationale. The doc remark restates it in this type's own terms: the administration UI edits a list,
  and a replace makes re-submitting the same list a no-op, where an add/remove pair would need the
  caller to know what the account already held (`AdministrationRequests.cs:6-9`).
- **Walkthrough**: one positional `IReadOnlyList<string> Roles` on a `sealed record`
  (`AdministrationRequests.cs:12`); no body.
- **Where it's used**: bound as the body of
  [UsersAdminControllerBase<TUserDto>](group-12-api-hosting-mapping.md#usersadmincontrollerbasetuserdto)'s
  `SetRoles` action
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs:177`);
  shape-validated by
  [SetUserRolesRequestValidator](#setuserrolesrequestvalidator), which requires a non-null list and
  validates each entry
  (`AdministrationRequestValidators.cs:11,18,20`); consumed by
  [IUserAdministrationService<TUserDto>](#iuseradministrationservicetuserdto) and posted by the Common
  UI's `UserAdminService`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Administration/UserAdminService.cs`).

### TwoFactorCodeRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Requests` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/TwoFactorCodeRequest.cs:16` · Level 0 · record struct (readonly)

- **What it is**: a single-field request `(string Code)`, the live-code proof shared by every
  two-factor action that has to be proved with a code: confirming enrollment, disabling the second
  factor, and regenerating the recovery codes
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/TwoFactorCodeRequest.cs:3-16`).
- **Depends on**: nothing first-party.
- **Concept introduced, one payload for three actions.** `[Rubric §9, API & Contract Design]` and
  `[Rubric §11, Security]`: the doc remark explains why one shape serves three actions rather than
  three identical ones, the code is the whole request body in each case and the account is taken from
  the authenticated caller, never from the request; disable and regenerate demand a code for the same
  reason enrollment does, so whoever holds a stolen access token still cannot strip the account's
  second factor with it (`TwoFactorCodeRequest.cs:7-11`). Each of the three handler bases enforces the
  shared shape through the same generic constraint,
  `where TCommand : IUserScopedCommand<TwoFactorCodeRequest>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/ConfirmTwoFactorEnrollmentHandlerBase.cs:33`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/DisableTwoFactorHandlerBase.cs:33`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/RegenerateRecoveryCodesHandlerBase.cs:35`).
- **Walkthrough**: one positional `string Code` (`TwoFactorCodeRequest.cs:16`); no body.
- **Where it's used**: shape-validated by
  [TwoFactorCodeRequestValidator](#twofactorcoderequestvalidator)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/TwoFactorCodeRequestValidator.cs:16,23`);
  handled by the three `IUserScopedCommand<TwoFactorCodeRequest>` handler bases above, each layered
  over [ITwoFactorService](#itwofactorservice) and
  [ITwoFactorAuthenticator](#itwofactorauthenticator).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:594`). Note
  that `Password` is a plain `string` on the contract and never travels past the hashing call:
  `RegisterAsync` turns it into a hash and salt pair, and that pair, not the password, is what
  reaches `CreateUser` and the aggregate (`AuthenticationServiceBase.cs:280-281`).
  `[Rubric §11, Security]`.
- **Where it's used**:
  [`AuthenticationServiceBase<TUser>.RegisterAsync`](#authenticationservicebasetuser)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:254-255`), the
  `register` endpoint on [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase),
  which binds it `[FromBody]` on an anonymous, rate-limited, idempotent POST
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:93-102`), and
  each app's register form. The two apps' `CreateUser` overrides show why the address is optional:
  Store passes `request.Address` straight into `User.Create`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:52-60`),
  while ADC ignores it entirely and creates the user from email, names, hash, salt, and the default
  `UserRole.Attendee`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:140-147`).

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:192-195`).
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

### FeatureFlagLifetime

> MMCA.Common.Shared · `MMCA.Common.Shared.FeatureFlags` · `MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagLifetime.cs:9` · Level 0 · enum

- **What it is**: the two-value lifetime a feature flag declares itself as, `Permanent` or `Temporary`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagLifetime.cs:9-22`).
- **Depends on**: nothing; consumed by [`FeatureFlagAttribute`](#featureflagattribute) and
  [`FeatureFlagDescriptor`](#featureflagdescriptor).
- **Concept introduced, the flag with a stated exit.** `[Rubric §31, Technical Debt Management]`
  assesses whether a temporary decision carries its own expiry rather than accumulating silently.
  `Permanent` is "a capability a host chooses to run with or without (push notifications, a
  data-subject export endpoint)" and must NOT carry a removal date (`FeatureFlagLifetime.cs:11-15`);
  `Temporary` "exists only until a migration, rollout or experiment finishes", must carry a removal
  date, and the build fails once that date has passed (`:17-21`). The enforcement itself lives on
  [`FeatureFlagAttribute`](#featureflagattribute) and the governance architecture rule that reads it.
- **Walkthrough**: two members, `Permanent` (`FeatureFlagLifetime.cs:15`) and `Temporary` (`:21`), each
  documented inline with the consequence it carries.
- **Why it's built this way**: [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)
  is the feature-flag management scheme this lifetime enforces.
- **Where it's used**: the `Lifetime` argument every `[FeatureFlag]` attribute application supplies,
  across `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/EngagementFeatures.cs`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs`,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs`, and
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs`; read back by
  [`FeatureFlagRegistry`](#featureflagregistry)`.Describe` into each
  [`FeatureFlagDescriptor`](#featureflagdescriptor)`.Lifetime`, and by the governance architecture rule
  that fails a `Temporary` flag past its `RemoveBy` date
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs`).

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

### ModuleNameConventions

> MMCA.Common.Shared · `MMCA.Common.Shared.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:10` · Level 0 · class (static)

- **What it is**: one function, `GetModuleName(Type)`, that reads a CLR type's namespace and returns
  the module that owns it, following the workspace naming convention `MMCA.{App}.{Module}.{Layer}`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:10-51`).
  `MMCA.Store.Sales.Domain.Orders` gives `"Sales"`; `MMCA.ADC.Conference.Application.Sessions` gives
  `"Conference"`; a type outside that shape gives `null`.
- **Depends on**: nothing first-party; `System.Array.FindIndex`/`Array.Exists` and `string.Split` (BCL).
- **Concept introduced, convention over configuration, with the convention hoisted to one function.**
  `[Rubric §15, Best Practices & Code Quality]` assesses whether a rule two subsystems must agree on has one
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:89`,
  `.../LoggingCommandDecorator.cs:76`) and push it into the log scope
  (`LoggingQueryDecorator.cs:31,82`, `LoggingCommandDecorator.cs:26,69`). Because the field is `static`
  on a closed generic, the namespace parse happens once per query or command type rather than per
  execution, which the doc comment calls out (`LoggingQueryDecorator.cs:84-88`). On the persistence
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

### PermissionCatalogResponse

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/PermissionCatalogResponse.cs:22` · Level 0 · record (sealed)

- **What it is**: the full permission catalog for the admin role editor: every registered role name and
  every registered permission name, unpaired
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/PermissionCatalogResponse.cs:22-24`).
- **Depends on**: nothing first-party at compile time.
- **Concept**: a reference-data response, distinct from [`RolePermissionsResponse`](#rolepermissionsresponse)
  which pairs one role with its grants. This one is the lookup lists a role editor needs to populate a
  picker before a role has been chosen.
- **Walkthrough**: two positional parameters on a `sealed record`, `Roles` and `Permissions`, both
  `IReadOnlyList<string>` (`PermissionCatalogResponse.cs:22-24`); no body.
- **Why it's built this way**: [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)
  is the role/permission administration surface this response is part of.
- **Where it's used**: built by
  [`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice)`.GetCatalogAsync`
  from the registered roles and the compiled `PermissionRegistry`'s `Permissions`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:80-89`);
  declared as the 200 response of `GET .../catalog` on
  [`RolesAdminControllerBase`](group-12-api-hosting-mapping.md#rolesadmincontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/RolesAdminControllerBase.cs:99-102`);
  fetched client-side by [`RoleAdminService`](group-15-common-ui-framework.md#roleadminservice) for the
  role admin pages.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:501`), and the
  interface documents that passing `null` simply marks no row as current
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IAuthenticationService.cs:89-93`).
- **Where it's used**: produced by
  [AuthenticationServiceBase<TUser>](#authenticationservicebasetuser)`.GetSessionsAsync`, which
  reads unrevoked sessions from [IRefreshSessionStore](#irefreshsessionstore), filters to those active
  at the current instant, orders newest-first, and projects each into this record
  (`AuthenticationServiceBase.cs:481-504`); returned by the `GET my-sessions` endpoint on
  [AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase), which supplies the
  caller's own session via `User.FindSessionId()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:175-187`);
  fetched client-side by [AuthUIService](group-15-common-ui-framework.md#authuiservice)`.GetSessionsAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:239,246`) and
  rendered by the [Sessions](group-15-common-ui-framework.md#sessions) page, which uses `IsCurrent` to
  disable the revoke action on the caller's own row
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:38,108-110,179`).
- **Caveats / not-in-source**: `IpAddress` and `UserAgent` are whatever the client sent at issue time
  and are stored verbatim; nothing in this type or the projection validates, geolocates, or
  canonicalizes them, so a spoofed user-agent shows up as-is in the device list.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:179`,
  acquiring at `:182` or, under a budget, `:189`), so the nullable handle can carry "no lock was taken"
  as a value rather than as a separate flag.

### RolePermissionsResponse

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RolePermissionsResponse.cs:19` · Level 0 · record (sealed)

- **What it is**: one role's permission picture: its name, the permissions its registered policies
  compile to, and the permissions actually stored as an override, side by side
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/RolePermissionsResponse.cs:19-22`).
- **Depends on**: nothing first-party at compile time; it is the response shape
  [`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice) builds from
  `PermissionRegistry` and its permission-grant store.
- **Concept**: `RegisteredPermissions` versus `StoredPermissions` is the diff a role editor renders:
  the compiled default from code-registered policies against whatever an administrator has overridden
  in the database. Carrying both, rather than one merged list, is what lets the UI show which
  permissions are the framework default and which were changed.
- **Walkthrough**: three positional parameters on a `sealed record`, `Role`, `RegisteredPermissions`,
  `StoredPermissions` (`RolePermissionsResponse.cs:19-22`); no body.
- **Why it's built this way**: no ADR is specific to this response shape; it follows the same DTO
  convention (`sealed record`, positional, immutable) as every response in this group.
- **Where it's used**: built three times by
  [`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice), once per
  role for the list view
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:70-72`),
  once for a single-role read (`:116`), and once after a permissions update (`:190`); declared as the
  200 response of the list, get, and set-permissions endpoints on
  [`RolesAdminControllerBase`](group-12-api-hosting-mapping.md#rolesadmincontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/RolesAdminControllerBase.cs:77-143`);
  consumed by [`RoleAdminService`](group-15-common-ui-framework.md#roleadminservice) and rendered on
  ADC's role list and role edit pages.

### TwoFactorRecoveryCodesResponse

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/TwoFactorResponses.cs:41` · Level 0 · record (sealed)

- **What it is**: the one-time list of recovery codes handed back after two-factor enrollment is
  confirmed or after codes are regenerated
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/TwoFactorResponses.cs:41`).
- **Depends on**: nothing first-party at compile time.
- **Concept**: shown to the user exactly once, at the moment it is minted; nothing in the type marks
  that, the "show once" rule is procedural, not enforced by the shape.
- **Walkthrough**: a single positional parameter, `RecoveryCodes` (`IReadOnlyList<string>`), no body
  (`TwoFactorResponses.cs:41`).
- **Why it's built this way**: follows the same DTO convention as its siblings in this file.
- **Where it's used**: produced by
  `ConfirmTwoFactorEnrollmentHandlerBase.HandleAsync` after a successful enrollment
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/ConfirmTwoFactorEnrollmentHandlerBase.cs:72`)
  and by `RegenerateRecoveryCodesHandlerBase.HandleAsync` after a code regeneration
  (`.../TwoFactor/RegenerateRecoveryCodesHandlerBase.cs:76`), both wrapping the codes returned from the
  two-factor store.
- **Caveats / not-in-source**: nothing in the response marks the codes as single-display; the UI, not
  this type, is responsible for not persisting or re-showing them.

### TwoFactorSetupResponse

> MMCA.Common.Shared · `MMCA.Common.Shared.Auth.Responses` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/TwoFactorResponses.cs:27` · Level 0 · record struct (readonly)

- **What it is**: the payload of beginning two-factor enrollment: the TOTP shared key and the
  provisioning URI an authenticator app scans as a QR code
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/TwoFactorResponses.cs:27-29`).
- **Depends on**: nothing first-party; follows the `readonly record struct` DTO shape
  [`AuthenticationResponse`](#authenticationresponse) introduces.
- **Concept**: the same value-type carrier convention as [`AuthenticationResponse`](#authenticationresponse);
  no new concept.
- **Walkthrough**: two positional parameters, `SharedKey` and `ProvisioningUri`, no body
  (`TwoFactorResponses.cs:27-29`).
- **Why it's built this way**: value semantics for a small, short-lived response, consistent with the
  rest of this file's auth DTOs.
- **Where it's used**: produced by `BeginTwoFactorEnrollmentHandlerBase.HandleAsync` at the end of a
  successful enrollment start
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/BeginTwoFactorEnrollmentHandlerBase.cs:89`).

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

### FeatureFlagAttribute

> MMCA.Common.Shared · `MMCA.Common.Shared.FeatureFlags` · `MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32` · Level 1 · class (sealed)

- **What it is**: the attribute a `*Features` constant class applies to each flag field, carrying a
  [`FeatureFlagLifetime`](#featureflaglifetime), an optional `RemoveBy` date, and an optional `Owner`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32-67`).
- **Depends on**: [`FeatureFlagLifetime`](#featureflaglifetime); `System.Attribute`, `System.DateOnly`,
  `System.Globalization.CultureInfo` (BCL).
- **Concept introduced, self-describing metadata a reflection scan can enforce.** `[Rubric §31,
  Technical Debt Management]` assesses whether a "temporary" label is actually checkable. `RemoveBy`
  is a `string?` rather than a `DateOnly?` because "an attribute argument must be a compile-time
  constant" (`FeatureFlagAttribute.cs:44`), so `TryParseRemoveBy` (`:60-66`) is what turns the
  constant string back into a real date for the check, parsed strictly against
  `RemoveByFormat = "yyyy-MM-dd"` (`:35,63`). `Owner` exists purely for the failure message:
  "Carried into the failure message, so an expired flag names someone" (`:50`), which is what
  lets [`FeatureFlagRegistry`](#featureflagregistry) and the governance architecture rule point at a
  person rather than an anonymous build break.
- **Walkthrough**: a primary constructor takes `lifetime` (`:32`), stored read-only as `Lifetime`
  (`:38`). `RemoveBy` and `Owner` are `init`-only properties (`:46,52`), settable only as named
  attribute arguments. `TryParseRemoveBy` is the one static method: a thin wrapper over
  `DateOnly.TryParseExact` with `DateTimeStyles.None` (`:60-66`), so a malformed date fails to parse
  rather than being silently coerced.
- **Why it's built this way**: [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)
  is the flag lifecycle this attribute encodes: pairing every flag with an explicit permanent/temporary
  choice and, for temporary ones, a checkable expiry.
- **Where it's used**: applied to every flag field in the `*Features` constant classes; read by
  [`FeatureFlagRegistry`](#featureflagregistry)`.Describe` via `GetCustomAttribute<FeatureFlagAttribute>`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs`) and by the
  governance architecture rule that fails the build on an expired `Temporary` flag
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs`).

### FeatureFlagDescriptor

> MMCA.Common.Shared · `MMCA.Common.Shared.FeatureFlags` · `MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:17` · Level 1 · record (sealed)

- **What it is**: one row of [`FeatureFlagRegistry`](#featureflagregistry)`.Describe`'s output: a
  flag's field name, wire name, and the [`FeatureFlagLifetime`](#featureflaglifetime)/`RemoveBy`/`Owner`
  its `[FeatureFlag]` attribute carries, if any
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:17-22`).
- **Depends on**: [`FeatureFlagLifetime`](#featureflaglifetime).
- **Concept**: `Lifetime`, `RemoveBy`, and `Owner` are all nullable (`:20-22`) because a flag field is
  legal without the `[FeatureFlag]` attribute at all: the descriptor still reports the field and its
  constant value, just with no lifecycle metadata attached. That is what lets the governance rule and
  the inventory both work off one uniform shape whether or not every flag has opted in to the attribute.
- **Walkthrough**: five positional parameters and no body (`FeatureFlagRegistry.cs:17-22`):
  `FieldName` (the CLR field), `FlagName` (the constant's string value), then the three
  attribute-sourced, nullable fields.
- **Why it's built this way**: [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)
  is the scheme this record inventories.
- **Where it's used**: produced by [`FeatureFlagRegistry`](#featureflagregistry)`.Describe`, one per
  flag field; not referenced outside the defining file otherwise.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:247-250`).
  [`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) cites the
  same reasoning in its own doc comment (`InProcessDistributedLock.cs:20`).
- **Caveats / not-in-source**: .NET randomizes string hash codes per process, so the stripe a given key
  lands on differs between runs. That is invisible to correctness (any key consistently maps to one
  stripe *within* a process) but it means collision behavior cannot be reproduced across processes.

### FeatureFlagRegistry

> MMCA.Common.Shared · `MMCA.Common.Shared.FeatureFlags` · `MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:35` · Level 2 · class (static)

- **What it is**: the reflection scanner that turns a set of `*Features` constant classes into a flat,
  ordered list of [`FeatureFlagDescriptor`](#featureflagdescriptor) rows, given the assemblies to scan
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:35-124`).
- **Depends on**: [`FeatureFlagDescriptor`](#featureflagdescriptor), [`FeatureFlagAttribute`](#featureflagattribute);
  `System.Reflection` (BCL).
- **Concept introduced, the flag inventory built entirely by convention.** `[Rubric §31, Technical Debt
  Management]` assesses whether the set of flags in play is discoverable rather than tribal knowledge.
  A `*Features` class is recognized purely by shape: `IsFeatureClass` requires a `static, abstract,
  sealed` type (the C# pattern for a static class) whose name ends in `FeatureClassSuffix = "Features"`
  (`:38,77,81-82`); `FlagFields` then takes only its `public const string` fields (`:91,95-97`). No
  registration call, no central list to keep in sync: adding a flag is adding a `const string` field to
  the module's `*Features` class.
- **Walkthrough**:
  - `Describe(IEnumerable<Assembly>)` (`:46`) scans every loadable type across the given assemblies,
    filters to feature classes, flattens to their flag fields, maps each to a descriptor, and orders
    the result by `FlagName` with `StringComparer.Ordinal` (`:50-55`) so the inventory is
    deterministic regardless of assembly load order.
  - `Describe(Assembly)` (`:64`) is the single-assembly overload, delegating to the collection one
    (`:68`).
  - `LoadableTypes` (`:112`) guards `Assembly.GetTypes()` against `ReflectionTypeLoadException`,
    falling back to the subset of types that did load via `ex.Types.OfType<Type>()` (`:118-121`), so
    one broken type in an assembly does not blank out every flag in it.
  - The private `Describe(FieldInfo)` (`:100`) reads the optional [`FeatureFlagAttribute`](#featureflagattribute)
    with `inherit: false` (`:102`) and the field's raw constant value via `GetRawConstantValue()`,
    defaulting to an empty string (`:106`).
- **Why it's built this way**: [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)
  is the convention this registry executes; scanning by name suffix rather than a marker interface
  keeps a `*Features` class a plain constant holder with no base type or registration boilerplate.
- **Where it's used**: `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/FeatureFlags/FeatureFlagRegistryTests.cs`
  exercises `Describe`, `IsFeatureClass`, and `FlagFields` directly; the governance architecture rule
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs`)
  calls `Describe` across the loaded module assemblies to enforce the `Temporary`/`RemoveBy` expiry
  rule.
- **Caveats / not-in-source**: `FeatureClassSuffix` is a public constant (`"Features"`) but nothing
  enforces that every constant class ending in that suffix is actually meant to hold flags; a
  coincidentally-named class would be scanned as one.

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

### IdempotencyHeaders

> MMCA.Common.Shared · `MMCA.Common.Shared.Http` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13` · Level 0 · class (static)

- **What it is**: the two HTTP header names of the idempotency protocol, as `const string`s:
  `Idempotency-Key` (the request header a client sends) and `X-Idempotent-Replay` (the response header
  a server appends when it served a cached body)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19,25`).
- **Depends on**: nothing.
- **Concept introduced, the shared wire-literal.** `[Rubric §15, Best Practices & Code Quality]` assesses whether a
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

### MessageHeaders

> MMCA.Common.Shared · `MMCA.Common.Shared.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Messaging/MessageHeaders.cs:22` · Level 0 · class (static)

- **What it is**: four `const string` message-broker header names carried on every outbound message:
  the tenant the publishing scope was resolved to, the publishing user's identifier, that user's
  roles as a comma-separated list, and the correlation id of the interaction that produced the
  message (`MessageHeaders.cs:25-38`).
- **Depends on**: nothing; BCL-free constants only.
- **Concept introduced, the cross-layer wire literal for a broker envelope.** Same placement rule
  [`ConcurrencyETag`](#concurrencyetag) and [`IdempotencyHeaders`](#idempotencyheaders) follow for an
  HTTP header, applied here to a message-broker header: the publisher and the consumer are separate
  assemblies that must agree on a literal, so it lives once in Shared. `[Rubric §10, Messaging &
  Integration]` assesses whether cross-service metadata (tenant, actor, correlation) travels
  explicitly on the envelope rather than being inferred on the consuming side; `[Rubric §15, Best
  Practices & Code Quality]` covers the single-source-of-truth angle.
- **Walkthrough**: a static class with four const fields: `TenantId = "MMCA-Tenant-Id"` (`:28`),
  `UserId = "MMCA-User-Id"` (`:31`), `UserRoles = "MMCA-User-Roles"` (`:34`), and
  `CorrelationId = "MMCA-Correlation-Id"` (`:37`). Each doc comment states when the header is absent:
  `TenantId` for a tenant-less publish, `UserId` for work raised by the system rather than a user,
  `UserRoles` when the actor holds none.
- **Why it's built this way**: [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)
  and [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) are the governing
  records; the multi-tenancy model relies on the tenant header traveling with every message rather
  than being re-derived on the consuming side.
- **Where it's used**: `BrokerMessageBus` sets these headers on publish
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs`), and
  `ConsumerOriginRestore` reads them back to rehydrate the tenant/actor context for a handler
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/ConsumerOriginRestore.cs`).
  Framework coverage is `BrokerMessageBusTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/BrokerMessageBusTests.cs`) and
  `IntegrationEventConsumerContextTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/IntegrationEventConsumerContextTests.cs`).

### StronglyTypedIdValueParserDelegate<TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedId.cs:161` · Level 0 · delegate

- **What it is**: an internal `TryParse`-shaped delegate,
  `bool (string? s, IFormatProvider? provider, out TValue value)` (`StronglyTypedId.cs:158-162`), the
  signature [`StronglyTypedIdValueParser<TValue>`](#stronglytypedidvalueparsertvalue) binds a concrete
  parser method to.
- **Depends on**: nothing beyond the closing generic constraint `TValue : notnull`.
- **Concept introduced**: none on its own; it exists so `StronglyTypedIdValueParser<TValue>` can cache
  a bound method as a typed field instead of an untyped `Delegate`.
- **Where it's used**: bound once per closed `TValue` by
  [`StronglyTypedIdValueParser<TValue>`](#stronglytypedidvalueparsertvalue)'s `Build()`, and invoked by
  [`StronglyTypedId`](#stronglytypedid).`TryParse`.

### StronglyTypedIdValueParser<TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedId.cs:173` · Level 1 · class (static)

- **What it is**: the per-closed-`TValue` cache of a parser delegate, exposed as the single static
  field `Instance` (`StronglyTypedId.cs:173-221`).
- **Depends on**: [`StronglyTypedIdValueParserDelegate<TValue>`](#stronglytypedidvalueparserdelegatetvalue).
- **Concept introduced, the two supported primitive shapes.** A wrapped primitive parses one of two
  ways: `string` takes the identity path, the route segment IS the value (`ParseString`, `:112-116`),
  and every other supported primitive implements `IParsable<T>` and is bound through reflection to
  `ParseParsable<TParsable>` (`:118-129`). `Build()` (`:95`) returns `null` for a `TValue` that is
  neither, which is what lets [`StronglyTypedId.CanParseValues<TValue>()`](#stronglytypedid) answer
  "unsupported" without throwing.
- **Walkthrough**: `Instance` (`:89`) runs `Build()` once, at type-initialization time for the closed
  generic. `Build()` checks `typeof(TValue) == typeof(string)` first (`:99-100`), then tests
  `IParsable<>.MakeGenericType(typeof(TValue)).IsAssignableFrom(typeof(TValue))` (`:102-103`) and
  returns `null` when neither holds. For the `IParsable` branch it reflects the private
  `ParseParsable` method off itself, closes it over `TValue`, and binds it with `CreateDelegate`
  (`:105-109`), a `[SuppressMessage]`d use of reflection the comment justifies: bound once per closed
  generic, never per request (`:91-94`).
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html) is the
  governing record for the opt-in strongly typed identifier feature this class supports.
- **Where it's used**: exclusively by [`StronglyTypedId`](#stronglytypedid).`TryParse`
  (`StronglyTypedId.cs:258-259`); nothing outside the defining file references it directly.

### IStronglyTypedId<TSelf, TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60` · Level 2 · interface

- **What it is**: the opt-in contract a value-type identifier implements to become a "strongly typed
  id": a wrapper struct carrying one primitive `TValue`, parsable from route/query text the same way
  the primitive itself is. `TSelf` is the curiously-recurring self type, `TValue` the wrapped
  primitive (`IStronglyTypedId.cs:60-63`).
- **Depends on**: `IParsable<TSelf>` from the BCL, the interface it extends (`IStronglyTypedId.cs:60`);
  its two default methods delegate to [`StronglyTypedId`](#stronglytypedid).`Parse`/`TryParse`.
- **Concept introduced, strongly typed identifiers as an opt-in alternative to the identifier-type-alias
  convention.** Where a module's usual identifier is a `global using OrderId = ...` alias over the
  primitive (no compile-time distinction between an `OrderId` and any other `Guid`), a type
  implementing this interface is a real value type the compiler tells apart from `Guid` or `int`, at
  the cost of writing the wrapper. `[Rubric §4, DDD]` assesses whether identity is modeled as a
  first-class value rather than a primitive; `[Rubric §9, API & Contract Design]` covers whether
  route/query binding for the stronger type is as seamless as for the primitive it replaces, which is
  exactly what the two default interface methods buy: a wrapper writes only `From`, and route-model
  binding works through the inherited `IParsable<TSelf>.Parse`/`TryParse`.
- **Walkthrough**: `Value` (`:155`) exposes the wrapped primitive. `static abstract TSelf From(TValue
  value)` (`:162`) is the one member an implementation must write, wrapping a primitive into the
  identifier. The two remaining members are default implementations of `IParsable<TSelf>`, so a
  wrapper never writes them: `Parse` (`:172-173`) and `TryParse` (`:184-188`) both delegate straight to
  [`StronglyTypedId`](#stronglytypedid)'s static `Parse`/`TryParse` overloads, closed over
  `TSelf, TValue`.
- **Why it's built this way**:
  [ADR-085](https://ivanball.github.io/docs/adr/085-identifier-type-aliases-revisited.html) revisits
  the plain-alias identifier convention, and
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html) records the
  strongly-typed alternative as opt-in rather than a replacement: a module keeps its `global using`
  aliases by default and reaches for this interface only where the extra compile-time safety is worth
  the wrapper.
- **Where it's used**: implemented by identifier structs registered with
  [`StronglyTypedIdRegistry`](#stronglytypedidregistry); the constraint
  `where TSelf : struct, IStronglyTypedId<TSelf, TValue>` recurs across
  [`StronglyTypedId`](#stronglytypedid),
  [`StronglyTypedIdMappings<TSelf, TValue>`](#stronglytypedidmappingstself-tvalue),
  [`StronglyTypedIdTypeConverter<TSelf, TValue>`](#stronglytypedidtypeconvertertself-tvalue) and
  [`StronglyTypedIdConverter<TSelf, TValue>`](#stronglytypedidconvertertself-tvalue). Framework
  coverage: `StronglyTypedIdFixtures`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StronglyTypedIdFixtures/StronglyTypedIdFixtures.cs`)
  and `TestIdentifiers`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/TestIdentifiers.cs`) supply test
  implementations.

### StronglyTypedId

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedId.cs:19` · Level 2 · class (static)

- **What it is**: the static toolkit behind
  [`IStronglyTypedId<TSelf, TValue>`](#istronglytypedidtself-tvalue): parsing (`Parse`/`TryParse`),
  reflection-based type detection (`GetValueType`/`IsStronglyTypedId`/`TryDescribe`), and a capability
  check (`CanParseValues`) (`StronglyTypedId.cs:19-149, 210`).
- **Depends on**: [`StronglyTypedIdValueParser<TValue>`](#stronglytypedidvalueparsertvalue) for the
  actual parsing, [`IStronglyTypedId<TSelf, TValue>`](#istronglytypedidtself-tvalue) as the generic
  constraint on every method. BCL: `ConcurrentDictionary<Type, Type?>` as a process-lifetime cache
  (`:217`).
- **Concept introduced**: none new; this is the mechanism
  [`IStronglyTypedId<TSelf, TValue>`](#istronglytypedidtself-tvalue) introduces, made concrete.
- **Walkthrough**:
  - `ValueTypeCache` (`:217`) is a `ConcurrentDictionary<Type, Type?>` caching the wrapped primitive per
    identifier type, with a `null` entry for every type that is not one; the doc comment notes it is
    bounded by the number of CLR types the process loads, unlike a query-string keyed cache a caller
    could grow (`:213-216`).
  - `Parse<TSelf, TValue>(string, IFormatProvider?)` (`:231`) is the `IParsable.Parse` leg: it
    null-guards (`:235`), then throws `FormatException` when `TryParse` fails (`:237-240`), naming the
    offending text and target type in the message.
  - `TryParse<TSelf, TValue>(string?, IFormatProvider?, out TSelf)` (`:254`) fetches
    [`StronglyTypedIdValueParser<TValue>`](#stronglytypedidvalueparsertvalue).`Instance`, invokes it
    with the invariant culture as the default provider (`:259`), and on success calls `TSelf.From(value)`
    (`:261`) to wrap the parsed primitive. A `null` `Instance` (an unsupported `TValue`) falls through to
    `false` (`:265-266`).
  - `CanParseValues<TValue>()` (`:276`) is a one-line capability check over the same `Instance`.
  - `GetValueType(Type)` (`:288`) and `IsStronglyTypedId(Type)` (`:299`) answer "does this type
    implement the contract for itself" via `ResolveValueType` (`:326`), which walks
    `type.GetInterfaces()` for a closed `IStronglyTypedId<,>` whose first generic argument equals the
    type being asked about (`:328-336`): the same self-referencing guard `EnumerationJsonConverterFactory`
    applies elsewhere in the framework, per the doc comment (`:283-284`).
  - `TryDescribe(Type, out Type?, out Type?)` (`:309`) unwraps `Nullable<T>` first (`:316`) so a caller
    inspecting an `OrderId?` property gets the same answer as one inspecting `OrderId`.
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html) is the
  governing record; [ADR-085](https://ivanball.github.io/docs/adr/085-identifier-type-aliases-revisited.html)
  records why this sits alongside, not instead of, the plain-alias convention.
- **Where it's used**: `IStronglyTypedId.cs` calls `Parse`/`TryParse` through the default interface
  methods; `StronglyTypedIdJsonConverterFactory`'s `CanConvert`/`CreateConverter` call
  `IsStronglyTypedId`/`GetValueType`; `StronglyTypedIdTypeConverter.ConvertFrom` calls `TryParse`;
  `StronglyTypedIdFilterStrategy` and `StronglyTypedIdRegistry` call the type-detection surface.
  Framework coverage is `StronglyTypedIdTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdTests.cs`, 13 call
  sites).

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
  The `[Rubric §15, Best Practices & Code Quality]` reading is that this is a knowingly accepted duplication, priced
  against giving Shared a reference to the API package.

### StronglyTypedIdConverter<TSelf, TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdJsonConverterFactory.cs:38` · Level 3 · class

- **What it is**: a private nested `JsonConverter<TSelf>`, one per closed identifier type, created by
  [`StronglyTypedIdJsonConverterFactory`](#stronglytypedidjsonconverterfactory)
  (`StronglyTypedIdJsonConverterFactory.cs:38-70`).
- **Depends on**: `System.Text.Json.Serialization.JsonConverter<T>` from the BCL;
  [`StronglyTypedId`](#stronglytypedid).`TryParse` for the dictionary-key path.
- **Concept introduced**: none new; the JSON leg of the wrap/unwrap pattern
  [`StronglyTypedIdMappings<TSelf, TValue>`](#stronglytypedidmappingstself-tvalue) applies for manual
  DTO mapping.
- **Walkthrough**: `Read` (`:364`) deserializes the wrapped primitive and calls `TSelf.From` (`:366-368`),
  so `default` stands in for a `null` primitive rather than throwing. `Write` (`:371`) serializes
  `value.Value` directly. `WriteAsPropertyName` (`:379`) and `ReadAsPropertyName` (`:387`) handle the
  identifier-as-dictionary-key case: the wrapped primitive becomes the JSON member name via
  `Convert.ToString` (`:382-383`), and reading it back throws `JsonException` on failure rather than
  silently defaulting (`:390-391`), documented as making `Dictionary<OrderId, T>` serialize exactly
  like `Dictionary<int, T>`.
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html).
- **Where it's used**: instantiated by
  [`StronglyTypedIdJsonConverterFactory`](#stronglytypedidjsonconverterfactory).`CreateConverter` via
  `Activator.CreateInstance`; nothing outside the defining file references it directly. Framework
  coverage is `StronglyTypedIdSerializationTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdSerializationTests.cs`).

### StronglyTypedIdMappings<TSelf, TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdMappings.cs:31` · Level 3 · class (static)

- **What it is**: four small static conversion helpers between a wrapped identifier and its primitive,
  nullable and non-nullable, meant to be called from a manual DTO mapper
  (`StronglyTypedIdMappings.cs:31-54`).
- **Depends on**: [`IStronglyTypedId<TSelf, TValue>`](#istronglytypedidtself-tvalue) as the generic
  constraint.
- **Concept introduced**: none new; the manual-mapping convention (Mapperly / manual DTO mapping)
  applied to strongly typed identifiers, so a hand-written mapper does not repeat the wrap/unwrap
  logic per identifier type.
- **Walkthrough**: `ToValue(TSelf)` (`:419`) and `ToIdentifier(TValue)` (`:424`) are the plain
  non-nullable pair. `ToNullableValue(TSelf?)` (`:429`) and `ToNullableIdentifier(TValue?)` (`:434`)
  preserve "not set" as `null` on both sides of the mapping rather than defaulting to a zero value,
  which would be indistinguishable from a real identifier of `default`.
- **Where it's used**: `StronglyTypedIdMapperTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Mapping/StronglyTypedIdMapperTests.cs`) plus
  one further call site not covered by this pass.

### StronglyTypedIdTypeConverter<TSelf, TValue>

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdTypeConverter.cs:21` · Level 3 · class

- **What it is**: a `System.ComponentModel.TypeConverter` for one closed identifier type, letting the
  BCL conversion pipeline (model binding, some UI frameworks) treat the identifier like its wrapped
  primitive (`StronglyTypedIdTypeConverter.cs:21-69`).
- **Depends on**: [`StronglyTypedId`](#stronglytypedid).`TryParse` for the string-to-identifier path;
  `System.ComponentModel.TypeConverter` from the BCL.
- **Concept introduced**: none new; the `TypeConverter` leg of the wrap/unwrap pattern
  [`StronglyTypedIdConverter<TSelf, TValue>`](#stronglytypedidconvertertself-tvalue) applies for JSON.
- **Walkthrough**: `CanConvertFrom`/`CanConvertTo` (`:461, 467`) accept `string` and `TValue` in addition
  to whatever the base converter accepts. `ConvertFrom` (`:473`) pattern-matches: `null` passes
  through, a `TValue` wraps via `TSelf.From`, a parsable `string` wraps via
  `StronglyTypedId.TryParse`, and an unparsable `string` throws `FormatException` naming the text and
  target type (`:474-482`). `ConvertTo` (`:485`) unwraps a `TSelf` to its `TValue` or to a
  culture-formatted string, and null-guards `destinationType` explicitly rather than delegating that
  check to the base class (`:500-502`).
- **Where it's used**: registered per identifier type by
  [`StronglyTypedIdTypeConverters`](#stronglytypedidtypeconverters).`Register`. Framework coverage is
  `StronglyTypedIdTypeConverterTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdTypeConverterTests.cs`).

### StronglyTypedIdJsonConverterFactory

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdJsonConverterFactory.cs:22` · Level 4 · class

- **What it is**: a `JsonConverterFactory` that detects any strongly typed identifier and hands
  `System.Text.Json` a closed [`StronglyTypedIdConverter<TSelf, TValue>`](#stronglytypedidconvertertself-tvalue)
  for it, so no per-identifier-type converter registration is needed
  (`StronglyTypedIdJsonConverterFactory.cs:22-71`).
- **Depends on**: [`StronglyTypedId`](#stronglytypedid).`IsStronglyTypedId`/`GetValueType` for
  detection; [`StronglyTypedIdConverter<TSelf, TValue>`](#stronglytypedidconvertertself-tvalue),
  instantiated reflectively.
- **Concept introduced**: none new; the JSON registration point for the strongly-typed-id feature.
- **Walkthrough**: `CanConvert(Type)` (`:527`) delegates straight to `StronglyTypedId.IsStronglyTypedId`.
  `CreateConverter(Type, JsonSerializerOptions)` (`:530`) resolves the wrapped `TValue` with
  `GetValueType`, returns `null` when it is not an identifier, and otherwise `MakeGenericType`s the
  nested converter and instantiates it with `Activator.CreateInstance` (`:532-538`).
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html).
- **Where it's used**: registered in `MMCA.Common.API`'s `DependencyInjection`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs`) and consulted by
  `StronglyTypedIdSchemaTransformer`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/OpenApi/StronglyTypedIdSchemaTransformer.cs`).
  Framework coverage is `StronglyTypedIdSerializationTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdSerializationTests.cs`).

### StronglyTypedIdTypeConverters

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdTypeConverter.cs:82` · Level 4 · class (static)

- **What it is**: the registration surface for
  [`StronglyTypedIdTypeConverter<TSelf, TValue>`](#stronglytypedidtypeconvertertself-tvalue): register
  one identifier type explicitly, or scan an assembly and register every identifier type it declares
  (`StronglyTypedIdTypeConverter.cs:82-155`).
- **Depends on**: [`StronglyTypedId`](#stronglytypedid).`GetValueType`/`IsStronglyTypedId` for
  detection; [`StronglyTypedIdTypeConverter<TSelf, TValue>`](#stronglytypedidtypeconvertertself-tvalue),
  attached via `TypeDescriptor.AddAttributes`.
- **Concept introduced**: none new; the assembly-scan companion to the per-type converter.
- **Walkthrough**: `Register(Type)` (`:600`) resolves the wrapped value type or throws
  `ArgumentException` naming the offending type (`:604-607`), builds the closed
  `StronglyTypedIdTypeConverter<,>` and attaches it with
  `TypeDescriptor.AddAttributes(identifierType, new TypeConverterAttribute(converterType))` (`:611`).
  `RegisterAll(params Assembly[])` (`:619`) calls `Register` for every candidate `GetIdentifierTypes`
  yields and returns the count. `GetIdentifierTypes(Assembly)` (`:643`) tolerates a partially loadable
  assembly: it catches `ReflectionTypeLoadException` and falls back to the partial `Types` array
  (`:649-656`), the doc comment noting this matches the tolerance the architecture map's
  loadable-types helper applies elsewhere, then filters to non-generic value types satisfying
  `IsStronglyTypedId` (`:658-664`).
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html).
- **Where it's used**: called from `MMCA.Common.Infrastructure`'s `DependencyInjection`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`) and by
  [`StronglyTypedIdRegistry`](#stronglytypedidregistry) for its own assembly-scan constructor.
  Framework coverage is `StronglyTypedIdTypeConverterTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdTypeConverterTests.cs`)
  plus `StronglyTypedIdApiTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Identifiers/StronglyTypedIdApiTests.cs`).

### StronglyTypedIdRegistry

> MMCA.Common.Shared · `MMCA.Common.Shared.Identifiers` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdRegistry.cs:22` · Level 5 · class

- **What it is**: an instance-level catalog of the strongly typed identifier types a host declares,
  built once by scanning assemblies or by an explicit list, and reused wherever a host needs to
  enumerate them (`StronglyTypedIdRegistry.cs:22-75`).
- **Depends on**: [`StronglyTypedIdTypeConverters`](#stronglytypedidtypeconverters).`GetIdentifierTypes`
  for the scan constructor; [`StronglyTypedId`](#stronglytypedid).`IsStronglyTypedId`/`GetValueType`
  for validation and description.
- **Concept introduced**: none new; this is the top of the strongly-typed-id stack, the object a host
  DI registration actually holds.
- **Walkthrough**: the assembly-scan constructor (`:692`) deduplicates the input assemblies, flattens
  `GetIdentifierTypes` across them, deduplicates the result, and orders it by `FullName` (`:696-703`)
  for a stable enumeration order across runs. The explicit-list constructor (`:712`) validates every
  entry with `IsStronglyTypedId` and throws `ArgumentException` naming the first offender
  (`:718-724`) rather than silently accepting a non-identifier type. `IdentifierTypes` (`:730`)
  exposes the ordered result. `Describe()` (`:737`) pairs each identifier type with its wrapped
  primitive via `GetValueType`, using the null-forgiving `!` because every entry already passed
  validation.
- **Why it's built this way**:
  [ADR-115](https://ivanball.github.io/docs/adr/115-strongly-typed-identifiers-opt-in.html).
- **Where it's used**: constructed and consulted by `MMCA.Common.Infrastructure`'s
  `DependencyInjection`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`) and by
  `StronglyTypedIdModelConfiguration`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/StronglyTypedIdModelConfiguration.cs`)
  and `ApplicationDbContext`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs`)
  for EF value-converter wiring. Framework coverage is `StronglyTypedIdTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/StronglyTypedIdTests.cs`).

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

### ConfirmEmailRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/EmailConfirmationRequestValidators.cs:25` · Level 1 · class

- **What it is**: the validator for redeeming an email-confirmation link: `Email` must be non-empty and a
  valid address, `Token` must be non-empty
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/EmailConfirmationRequestValidators.cs:30-35`).
- **Depends on**: `ConfirmEmailRequest`; `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: the same "validation that deliberately stops short" posture
  [`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator) introduces: shape only, no lookup
  of whether the token is live or already consumed. `[Rubric §11, Security]`: token validity is a
  database read guarded by hashing and expiry
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Interfaces/IEmailConfirmationTokenService.cs`
  usage in the consuming handler), not a shape a validator can decide, so putting that check here would
  either duplicate the lookup or race it.
- **Walkthrough**: a block-bodied constructor with two independent `RuleFor` chains
  (`EmailConfirmationRequestValidators.cs:30-35`), each carrying an explicit `WithMessage`, sharing the
  file with [`SendEmailConfirmationRequestValidator`](#sendemailconfirmationrequestvalidator).
- **Why it's built this way**: email confirmation is one of the opt-in identity completions
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)): a host calls
  `AddEmailConfirmation(config)` to register the feature, and sign-in gating only kicks in when
  `RequireConfirmedEmail` is configured and the `User` implements `IEmailConfirmableUser`
  (`MMCA.Common/CLAUDE.md`, "Identity completions" section).
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`) and reached through
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  for any command implementing `ICommandWithRequest<ConfirmEmailRequest>`, the constraint
  `ConfirmEmailHandlerBase<TUser, TCommand>` declares
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/ConfirmEmailHandlerBase.cs:38`).
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/CommandValidatorCoverageTests.cs` asserts
  every command that carries a request has a validator registered, which is the only reference to this
  type outside its defining assembly.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`) picks up every validator
  in `MMCA.Common.Application`, with the comment explaining why it must happen here rather than in the
  per-module scan (`DependencyInjection.cs:45-47`). The resolved `IValidator<ForgotPasswordRequest>` is
  then consumed indirectly: an app's forgot-password command implements
  `ICommandWithRequest<ForgotPasswordRequest>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:43`),
  and
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  bridges the command's `Request` property to this validator
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:37-39`),
  auto-registered for every such command at
  `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ModuleScanning.cs:119-135`.

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
  `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48` (which names this class in
  its comment, `DependencyInjection.cs:45`), then injected as `IValidator<LoginRequest>` into
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

### PrivacyFeatures

> MMCA.Common.Shared · `MMCA.Common.Shared.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:8` · Level 1 · class (static)

- **What it is**: one `const string` naming the feature flag that gates the data-subject export
  surface, `Privacy.DataExport`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:12`).
- **Depends on**: `FeatureFlagAttribute` and `FeatureFlagLifetime` (both
  `MMCA.Common.Shared.FeatureFlags`), which the const now carries.
- **Concept introduced, the feature flag as a shared, self-declaring constant.** `[Rubric §30, Compliance
  / Privacy / Data Governance]` assesses how the codebase handles data-subject rights and how
  deliberately those surfaces are turned on. `[Rubric §9, API & Contract Design]` assesses whether
  concerns like feature gating are applied uniformly rather than ad hoc. A data-subject access endpoint
  returns a complete dossier of one person's personal data, so it is the last endpoint that should
  default to reachable. Naming the flag once, in the assembly every layer can see, lets the attribute
  that gates the controller and the host configuration that enables it refer to the same string. The
  flag's own evaluation is the `Microsoft.FeatureManagement` `[FeatureGate]` attribute, whose behavior is
  not this type's concern; see
  [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html). What the const also
  now declares is its own lifecycle: `[FeatureFlag(FeatureFlagLifetime.Permanent, Owner = "MMCA.Common")]`
  (`PrivacyFeatures.cs:11`) marks it as a flag that is never expected to be removed, which is the same
  governance annotation `NotificationFeatures` carries
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:11`).
- **Walkthrough**: a `static class` containing a single
  `[FeatureFlag(FeatureFlagLifetime.Permanent, Owner = "MMCA.Common")] public const string DataExport =
  "Privacy.DataExport";` (`PrivacyFeatures.cs:8-13`). The dotted name is a namespace convention for the
  flag key, not C# syntax: it is one opaque string as far as the feature manager is concerned. The
  attribute takes the lifetime as a positional argument and `Owner` as a named one; a `Permanent` flag
  must not name a `RemoveBy` date, unlike a `Temporary` one
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:10-11`).
- **Why it's built this way**:
  [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) makes the whole export
  capability opt-in and records the gate explicitly: a host that has not turned the feature on gets a
  404 from the endpoint rather than an unauthorized-looking 403
  (`Website/docs-src/adr/076-data-subject-export.md:124`). The `[FeatureFlag]` annotation is the later,
  codebase-wide discipline that makes every flag self-reporting: `FeatureFlagLifecycleTestsBase` fails
  the build on a flag that carries no declaration or on a `Temporary` one past its `RemoveBy`
  (`MMCA.Common/CLAUDE.md`, "FeatureGate" bullet), and `FeatureFlagRegistry` reports the same inventory
  at runtime.
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
  ADC has no other DSAR surface" (`MMCA.ADC/.../appsettings.json:17-19`). The `[FeatureFlag]` declaration
  is read by `FeatureFlagLifecycleTests` and `FeatureFlagRegistryTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs`,
  `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/FeatureFlags/FeatureFlagRegistryTests.cs`).
- **Caveats / not-in-source**: those two `appsettings.json` files are the only places in the workspace
  that declare the flag. Both apps deploy the endpoint from their Identity **service** host, so the
  deployed path is covered, but any other host that mounted the controller would serve a 404 until it
  added its own `FeatureManagement` entry.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`, named in the comment at
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`) and reached through
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  for any command implementing `ICommandWithRequest<ResetPasswordRequest>`, the constraint
  [`ResetPasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#resetpasswordhandlerbasetuser-tcommand)
  declares
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:52`).
  The request arrives at
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:108`),
  which is why a policy failure surfaces as the documented `400`
  (`PasswordResetAuthControllerBase.cs:104`) while a bad token collapses to `401`
  (`PasswordResetAuthControllerBase.cs:97,105`).

### SendEmailConfirmationRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/EmailConfirmationRequestValidators.cs:11` · Level 1 · class

- **What it is**: the validator for requesting a confirmation email: `Email` must be non-empty and a
  valid address, nothing else
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/EmailConfirmationRequestValidators.cs:14-16`).
- **Depends on**: `SendEmailConfirmationRequest`; `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: the same shape-only posture as
  [`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator): the field is checked for
  well-formedness, not for whether it belongs to an account. `[Rubric §11, Security]` applies for the
  same reason a resend-confirmation endpoint is a candidate for the same account-enumeration trap a
  forgot-password endpoint is.
- **Walkthrough**: an expression-bodied constructor with a single `RuleFor(x =>
  x.Email).NotEmpty().EmailAddress()` chain (`EmailConfirmationRequestValidators.cs:14-16`), sharing the
  file with [`ConfirmEmailRequestValidator`](#confirmemailrequestvalidator).
- **Why it's built this way**: email confirmation is one of the identity completions
  [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) added, all opt-in
  through `AddEmailConfirmation(config)`.
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`).
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/CommandValidatorCoverageTests.cs` is the
  only reference to this type outside its defining assembly, asserting the command that carries this
  request has a validator registered.

### TwoFactorCodeRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/TwoFactorCodeRequestValidator.cs:16` · Level 1 · class

- **What it is**: the validator for a submitted two-factor code: `Code` must be non-empty and no longer
  than `MaxCodeLength`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/TwoFactorCodeRequestValidator.cs:22-24`).
- **Depends on**: `TwoFactorCodeRequest`; `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: presence and a length ceiling only, the shape-only posture
  [`ForgotPasswordRequestValidator`](#forgotpasswordrequestvalidator) introduced, applied here to bound
  input size rather than to avoid an enumeration oracle. `[Rubric §11, Security]`: whether a TOTP code or
  a recovery code was presented is not decided here; both shapes are short strings, so the validator can
  only reject the obviously wrong length, and the doc comment names 64 as the ceiling
  (`TwoFactorCodeRequestValidator.cs:17`).
- **Walkthrough**: `public const int MaxCodeLength = 64;` (`:17`) followed by an expression-bodied
  constructor chaining `NotEmpty().MaximumLength(MaxCodeLength)` on `Code` (`:22-24`). The constant is
  public so a caller (or a test) can reference the same ceiling rather than re-guessing it.
- **Why it's built this way**: two-factor authentication is one of the opt-in identity completions
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)); the actual
  decision between a TOTP match and a recovery-code match happens downstream in
  [`TwoFactorAuthenticator`](#twofactorauthenticator), not in this validator.
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`).
- **Caveats / not-in-source**: no first-party or test reference to this type appears outside its
  defining file; the assembly scan is the only wiring visible in source.

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

### TotpTwoFactorService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TotpTwoFactorService.cs:35` · Level 2 · class

- **What it is**: the RFC 6238 TOTP implementation of `ITwoFactorService`: secret generation,
  provisioning-URI construction, code verification, and recovery-code generation/hashing/matching
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TotpTwoFactorService.cs:35-312`).
- **Depends on**: [`ITwoFactorService`](group-08-auth.md#itwofactorservice) (the contract it implements);
  `TwoFactorSettings` (`MMCA.Common.Shared`) injected as `IOptions<TwoFactorSettings>`; `RecoveryCodeSet`
  (`MMCA.Common.Shared`) as its return shape; `OtpDotNet` (`Base32Encoding`, `KeyGeneration`, `Totp`,
  `VerificationWindow`, `OtpHashMode`, NuGet); `System.Security.Cryptography`
  (`RandomNumberGenerator`, `SHA256`, `CryptographicOperations.FixedTimeEquals`).
- **Concept introduced, constant-time comparison for a secret the caller does not control the timing
  of.** `[Rubric §11, Security]` assesses whether the codebase avoids timing side channels around secret
  comparison. `TryMatchRecoveryCode` never exits its scan early on a match: the loop "runs to the end so
  the answer takes the same time whichever code in the list was presented"
  (`TotpTwoFactorService.cs:293-294`), and each comparison itself goes through
  `CryptographicOperations.FixedTimeEquals` rather than `==` or `SequenceEqual` (`:295`). A byte-for-byte
  comparison that stops at the first differing byte leaks how many leading bytes an attacker guessed
  correctly across repeated attempts; a fixed-time comparison over a full linear scan removes that
  channel entirely.
- **Walkthrough**: `internal sealed class` constructed with `IOptions<TwoFactorSettings> settings`
  (`:35`), caching `.Value` once (`:37`).
  - `GenerateSecret()` returns a Base32-encoded random key sized by `_settings.SecretByteLength`
    (`:40-41`). Base32 rather than Base64: "the alphabet has no case ambiguity and no characters a user
    has to guess at while copying a code off paper" (`:251-252`), the same rationale repeated at the
    recovery-code site.
  - `BuildProvisioningUri` URL-escapes the issuer and account name and formats the standard `otpauth://`
    URI a QR code encodes, with algorithm, digit count, and period read from settings (`:44-56`).
  - `VerifyCode` decodes the stored Base32 secret, catching `ArgumentException` and returning `false`
    rather than throwing when the stored value is not valid Base32: "a stored secret that is not Base32
    can never mint a code, so it verifies nothing. That is a data fault, not a caller fault"
    (`:229-231`). It then builds a `Totp` with the configured step, hash mode, and digit count, and
    checks the normalized code against a verification window of `_settings.VerificationWindowSteps` steps
    on each side of now (`:215-240`), tolerating clock drift between the server and the user's
    authenticator app.
  - `GenerateRecoveryCodes` produces `_settings.RecoveryCodeCount` codes, each a Base32-encoded random
    byte string with the `=` padding trimmed, alongside their SHA-256 hashes computed by
    `HashRecoveryCode` (`:244-262`). Only the hashes and the caller-facing codes are returned; nothing
    persists the plaintext codes here.
  - `HashRecoveryCode` normalizes the code (strips non-alphanumerics, upper-cases) then SHA-256-hashes it
    (`:265-270`).
  - `TryMatchRecoveryCode` normalizes and hashes the presented code once, then fixed-time-compares it
    against every stored hash, returning the matched hash (not the code) through an `out` parameter
    (`:273-302`).
  - `NormalizeCode` is the shared helper both verification paths route through: it strips whitespace and
    separators a user types or a password manager inserts and upper-cases what remains, "so a code is
    matched the way it was generated" (`:304-311`).
- **Why it's built this way**: two-factor authentication is opt-in
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)), registered by
  `AddTwoFactorAuthentication(config)`; `MMCA.Common/CLAUDE.md` notes Otp.NET is scoped to
  Infrastructure only, which is why this type, rather than anything in Application, is what actually
  calls into the library.
- **Where it's used**: registered in DI
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`) as the `ITwoFactorService`
  implementation behind `AddTwoFactorAuthentication(config)`, and consumed by
  [`TwoFactorAuthenticator`](#twofactorauthenticator) for both TOTP and recovery-code verification.
- **Caveats / not-in-source**: `internal sealed`, so it is reached only through the `ITwoFactorService`
  abstraction; a consumer cannot construct or type-check against this class directly.

### SetRolePermissionsRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/AdministrationRequestValidators.cs:30` · Level 4 · class

- **What it is**: the validator for replacing a role's stored permission grants: `Permissions` must be
  non-null, and each entry must be non-empty and within `PermissionGrant.PermissionMaxLength`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/AdministrationRequestValidators.cs:34-40`).
- **Depends on**: `SetRolePermissionsRequest`; [`PermissionGrant`](group-08-auth.md#permissiongrant) (for
  `PermissionMaxLength`); `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: shape validation for a role-administration write, the same posture the request validators
  earlier in this group establish, but the field it guards is a collection rather than a scalar.
  `[Rubric §11, Security]`: an empty `Permissions` list is deliberately legal, and the doc comment on the
  rule states why: it "is how an operator undoes every grant. It never removes what the host compiled
  in" (`AdministrationRequestValidators.cs:37-38`). What this validator refuses is `null`, a malformed
  request, not an empty intent; and it bounds each entry's length so a caller cannot smuggle an
  oversized string into a permission name.
- **Walkthrough**: a block-bodied constructor with `RuleFor(x =>
  x.Permissions).NotNull()` (`:39`) followed by `RuleForEach(x =>
  x.Permissions).NotEmpty().MaximumLength(PermissionGrant.PermissionMaxLength)` (`:41-44`), each stage
  carrying an explicit `WithMessage`. It shares its file with
  [`SetUserRolesRequestValidator`](#setuserrolesrequestvalidator), the sibling that guards role
  assignment rather than permission grants.
- **Why it's built this way**: what a stored permission grant is layered over, and why the compiled
  `AdministrationPermissions.ManageRoles` permission can never itself become a stored grant, is
  [`StoredPermissionRoleAdministrationService`](#storedpermissionroleadministrationservice)'s concern,
  not this validator's; this type only decides whether the *shape* of a replacement list is acceptable.
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`).
- **Caveats / not-in-source**: no first-party or test reference to this type appears outside its
  defining file.

### SetUserRolesRequestValidator

> MMCA.Common.Application · `MMCA.Common.Application.Auth.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/AdministrationRequestValidators.cs:11` · Level 4 · class

- **What it is**: the validator for replacing a user's role list: `Roles` must be non-null, and each
  entry must be non-empty and within `PermissionGrant.RoleMaxLength`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/AdministrationRequestValidators.cs:15-21`).
- **Depends on**: `SetUserRolesRequest`; [`PermissionGrant`](group-08-auth.md#permissiongrant) (for
  `RoleMaxLength`); `FluentValidation`'s `AbstractValidator<T>`.
- **Concept**: the mirror of
  [`SetRolePermissionsRequestValidator`](#setrolepermissionsrequestvalidator) one level up in the same
  file: an empty list is a legitimate intent (stripping every role from an account) while `null` is a
  malformed body. The doc comment draws the same line: "What is rejected is a null list, which is a
  malformed body rather than an intent" (`AdministrationRequestValidators.cs:18-19`).
- **Walkthrough**: `RuleFor(x => x.Roles).NotNull()` (`:20`) followed by `RuleForEach(x =>
  x.Roles).NotEmpty().MaximumLength(PermissionGrant.RoleMaxLength)` (`:22-25`), each with an explicit
  `WithMessage`.
- **Why it's built this way**: the same administration surface
  [`SetRolePermissionsRequestValidator`](#setrolepermissionsrequestvalidator) guards; both validators
  keep the shape check separate from the business rule (which roles/permissions actually exist), which
  is decided downstream by the role-administration service.
- **Where it's used**: registered by the assembly scan
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:48`).
- **Caveats / not-in-source**: no first-party or test reference to this type appears outside its
  defining file.

### TwoFactorAuthenticator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs:25` · Level 4 · class

- **What it is**: the `ITwoFactorAuthenticator` implementation that turns a raw code plus a user's
  stored two-factor state into one of four challenge outcomes
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs:25-448`).
- **Depends on**: [`ITwoFactorService`](group-08-auth.md#itwofactorservice) (code verification and
  recovery-code matching); [`ITwoFactorStore`](group-08-auth.md#itwofactorstore) (loading state and
  consuming a recovery code); [`TwoFactorErrors`](group-08-auth.md#twofactorerrors);
  [`TwoFactorOutcome`](group-08-auth.md#twofactoroutcome); the framework's `Result<T>`; the
  `UserIdentifierType` alias.
- **Concept introduced, a challenge is answered with an outcome enum, not a bare boolean.** `[Rubric §1,
  SOLID]` and `[Rubric §11, Security]` both bear on the shape of `ChallengeAsync`'s return: `Result<TwoFactorOutcome>`
  distinguishes "not enrolled" (a success carrying `TwoFactorOutcome.NotEnrolled`, not a failure) from a
  missing code, an invalid code, and the two ways a valid one can be accepted, `VerifiedTotp` versus
  `VerifiedRecoveryCode`. Collapsing those five states into one boolean would force the caller to
  re-derive which one happened from side effects, and a login path that cannot tell "not enrolled" from
  "denied" cannot decide whether to prompt for enrollment or reject the sign-in.
- **Walkthrough**: `internal sealed class` taking `ITwoFactorService` and `ITwoFactorStore` as primary
  constructor parameters (`:25-27`), implementing `ChallengeAsync(userId, code, cancellationToken)`.
  - Loads the user's `state` from the store first (`:34`). If the state is missing or
    `IsTwoFactorEnabled` is false, the challenge succeeds trivially with `NotEnrolled`: "an account that
    never enrolled, and an account whose row vanished between the password check and here, are both
    'nothing to challenge'" (`:36-38`).
  - An enrolled account with no presented code fails with `TwoFactorErrors.TwoFactorRequired` (`:44-47`).
  - The code is checked first against the stored TOTP secret via `ITwoFactorService.VerifyCode`; a match
    returns `VerifiedTotp` (`:49-52`).
  - Failing that, it is checked against the stored recovery-code hashes via
    `ITwoFactorService.TryMatchRecoveryCode`; no match fails with `TwoFactorErrors.TwoFactorInvalid`
    (`:54-59`).
  - A recovery-code match is then **consumed**, not just verified: `store.ConsumeRecoveryCodeAsync`
    persists the redemption, and if that persistence fails, the whole challenge is answered as a failure
    rather than a success: "letting the sign-in through would hand out a code that is still live"
    (`:65-69`). Only a successfully persisted consumption returns `VerifiedRecoveryCode`.
- **Why it's built this way**: this is the runtime half of the opt-in two-factor feature
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)); the recovery
  code's one-time-use property is only real if consumption and the outcome it produces are atomic, which
  is why the failure path is checked before the outcome is returned rather than after.
- **Where it's used**: registered in DI
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`) as the
  `ITwoFactorAuthenticator` behind `AddTwoFactorAuthentication(config)`; the resolved instance is passed
  to `AuthenticationServiceBase`, which answers `Authentication.TwoFactorRequired` or mints the `mfa`
  claim depending on the outcome (`MMCA.Common/CLAUDE.md`, "Identity completions" section).

### StoredPermissionRoleAdministrationService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Auth.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:45` · Level 5 · class

- **What it is**: the `IRoleAdministrationService` implementation that lets an operator list roles, read
  or replace a role's stored permissions, and view the compiled permission catalog, layered over the
  code-compiled permission registry
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:45-652`).
- **Depends on**: [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) (the compiled grants);
  [`IPermissionCatalog`](group-08-auth.md#ipermissioncatalog) (the closed list of declared permissions);
  [`IPermissionGrantStore`](group-08-auth.md#ipermissiongrantstore) (persisted grants);
  [`IPermissionGrantCache`](group-08-auth.md#ipermissiongrantcache) and
  [`IPermissionGrantCacheInvalidator`](group-08-auth.md#ipermissiongrantcacheinvalidator);
  `PermissionGrantSettings` (`KnownRoles`) via `IOptions<T>`;
  [`AdministrationPermissions`](group-08-auth.md#administrationpermissions) (`ManageRoles`); the
  framework's `Result<T>` and `Error` factories.
- **Concept introduced, a layered grant surface that refuses to let stored data override the permission
  that guards it.** `[Rubric §11, Security]` assesses whether an authorization surface can be used to
  escalate its own access, and `[Rubric §4, DDD]`/`[Rubric §1, SOLID]` the separation between the
  compiled and stored halves of a permission set. `SetStoredPermissionsAsync` refuses to grant
  `AdministrationPermissions.ManageRoles` from a stored row, and the error message states the two-sided
  reason: granting it from a data row would make access to role administration itself a matter of data,
  while deleting the row "would lock every operator out of the screen that could restore it"
  (`StoredPermissionRoleAdministrationService.cs:562-568`). That permission is only ever compiled in,
  through a host's own permission registry.
- **Walkthrough**: constructed with the registry, catalog, store, cache, invalidator, and settings as
  primary constructor parameters (`:45-51`).
  - `ListRolesAsync` groups all stored grants by role, case-insensitively (`:60-64`), unions the result
    with the compiled and configured role universes via the private `RoleUniverse` helper (`:66`), and
    returns one `RolePermissionsResponse` per role pairing its compiled permissions (`CompiledPermissions`)
    with its stored ones (`:68-77`).
  - `GetCatalogAsync` returns every known role alongside the full compiled `catalog.Permissions`
    deliberately, not whatever happens to be stored: "widening it with whatever happens to be stored
    would let one typo legitimize itself" (`:88-90`).
  - `GetRoleAsync` treats a role as not found only when it has no stored grants, no compiled permissions,
    and is named in neither `KnownRoles` nor the catalog's role list, so "a role the host has never
    named ... does not exist as far as this surface is concerned" rather than reporting it as an empty,
    plausible-looking role (`:107-110`).
  - `SetStoredPermissionsAsync` trims and de-duplicates the desired set (`:135-137`), rejects
    `ManageRoles` as above, rejects any permission absent from `catalog.Permissions` with the unknown
    names listed in the error (`:151-163`), then diffs the desired set against the currently stored one:
    grants what is newly desired, revokes what was dropped, short-circuiting on the first store failure
    either way (`:168-187`), and finally invalidates the role's permission cache (`:189`) before
    returning the fresh `RolePermissionsResponse`.
  - The private `RoleUniverse` helper unions the compiled catalog's roles, the configured `KnownRoles`,
    and whatever roles the store's own rows name, case-insensitively and sorted (`:216-224`).
  - The private `CompiledPermissions` helper reads "through the SAME registry the authorization path
    uses" and subtracts what the cache already reports, so the two lists a role response carries stay
    disjoint (`:238-244,246-251`).
- **Why it's built this way**:
  [ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html) documents
  `AddStoredPermissionGrants(config)` as the opt-in that layers a `PermissionGrant` table over the
  compiled registry; `MMCA.Common/CLAUDE.md`'s Authorization section describes the same union-only
  layering through
  [`LayeredPermissionRegistry`](group-08-auth.md#layeredpermissionregistry) "without changing the
  decorators' contract", the principle this service's `ManageRoles` refusal exists to protect.
- **Where it's used**: registered in DI
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`) behind
  `AddStoredPermissionGrants(config)` as the `IRoleAdministrationService` implementation; consumed
  through `RolesAdminControllerBase`, which is itself gated on
  `AdministrationPermissions.ManageRoles` (`MMCA.Common/CLAUDE.md`, "Identity completions" section).
- **Caveats / not-in-source**: `internal sealed`, so it is reached only through the
  `IRoleAdministrationService` abstraction.

### ClaimBasedUserIdProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:11` · Level 8 · class

- **What it is**: a two-line SignalR `IUserIdProvider` that tells the hub infrastructure which user a
  connection belongs to, by reading the identity claim off the connection's principal
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:6-10`).
- **Depends on**: `Microsoft.AspNetCore.SignalR` (`IUserIdProvider`, `HubConnectionContext`) and
  [`ClaimsPrincipalExtensions`](#claimsprincipalextensions) for `FindUserIdValue`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs:1-2`).
- **Concept**: `[Rubric §11, Security]` assesses that identity is derived from the validated token and
  never from client-supplied input, and `[Rubric §9, API & Contract Design]` assesses whether that derivation
  is centralized once. SignalR keys its user-targeted sends on whatever string an `IUserIdProvider`
  returns; the built-in provider reads `ClaimTypes.NameIdentifier`. This framework mints the user id
  only into `sub` (see [`TokenService`](#tokenservice),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:106`), and whether that
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:106`). Keeping the whole
  provider to one delegating line is what makes that three-way agreement checkable at a glance.
- **Where it's used**: registered as
  `services.TryAddSingleton<IUserIdProvider, ClaimBasedUserIdProvider>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:67`), in the
  same block that swaps the null notification implementations for the SignalR-backed ones (`:64-66`). SignalR's
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:296`), the claim walk
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:296`). The
  highest-traffic consumer is
  [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), which takes it as a
  constructor dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:50`,
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
