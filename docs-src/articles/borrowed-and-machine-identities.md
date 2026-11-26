# Borrowed and Machine Identities: Read-Only View-As and OAuth Client Credentials

> Series: MMCA.Common · Article #54 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-137 · ADR-140 ·
> Status: grounded in `Website/docs-src/adr/137-read-only-view-as-support-access.md`,
> `Website/docs-src/adr/140-machine-clients-oauth-client-credentials.md`,
> `MMCA.Common/.../API/Middleware/ViewAsGuardMiddleware.cs`,
> `.../Application/UseCases/Decorators/ViewAsCommandDecorator.cs`,
> `.../Application/Auth/ViewAs/ViewAsService.cs`, `.../Domain/Auth/ViewAsGrant.cs`,
> `.../Application/Auth/ViewAs/ViewAsSettings.cs`, `.../API/SessionCookies/ViewAsOverlayCookie.cs`,
> `.../API/Controllers/MachineClients/MachineTokenControllerBase.cs`,
> `.../Application/Auth/MachineClients/MachineClientService.cs`,
> `.../Application/Auth/MachineClients/MachineClientSettings.cs`,
> `.../API/Authorization/RefuseMachineClientsAttribute.cs`, `.../Shared/Auth/AuthClaimTypes.cs`,
> `.../Shared/Auth/Permissions/AdministrationPermissions.cs`, `.../Application/DependencyInjection.cs`,
> `.../API/Startup/Pipeline/MiddlewarePipelineBuilder.cs`, and MMCA.ADC's four service
> `appsettings.json` files, AppHost and Identity module.
> No em dashes.

**Subtitle:** Every token in a framework built around interactive sign-in names a person who just
proved who they are. Two callers do not fit that shape: a support user who needs to see one
account's screen, and a program that needs to call an API with nobody at the keyboard. Here is how
MMCA.Common mints both as ordinary tokens, bounds what each can do with a claim, a middleware step and
a decorator, and makes each one refuse the other.

---

A user writes in: "my schedule page is empty." The support engineer opens the same page and it is
full. The two of them spend twenty minutes on screenshots, because the engineer cannot see what the
user sees without the user's password, and the user should never send it.

A month later a partner asks for a nightly export. Every token-issuing path in the framework is an
interactive sign-in, and access tokens last 15 minutes, so the fastest available answer is to paste a
person's token into a cron job. It works until the next morning.

Both requests end in the same place if you are careless: a token that says "this is user 4182" when
it is not. The support view writes a preference change in the user's name, and the audit trail
records the user doing something they never did. The program's token carries an administrator's role
because that was the account somebody had to hand, and it can do anything an administrator can, at
3 a.m., from a server nobody watches.

This article is about the two identities MMCA.Common mints outside interactive sign-in. **ADR-137**
is the borrowed one: a read-only, reasoned, 15-minute view of another account that the account
holder can see. **ADR-140** is the machine one: the OAuth 2.0 client credentials grant, backed by a
service-account user whose role is the whole of its authority. They share a design rule. Each
produces a token every service already knows how to validate, and each carries a claim that the rest
of the system reads to narrow what the token may do.

The series has covered the pieces both plug into. [Article 16](jwks-cross-service-auth.md) covers how
every service validates the same tokens through JWKS, and the service tokens services attach to each
other's calls. [Article 52](identity-completions.md) covers the user and role administration
controllers the view-as grant action lives on, and the `mfa` claim whose absence matters below.

## Why it matters

Rubric §11 (Security) asks that authentication be centralized, that authorization be enforced at the
right layer rather than in the UI, and that permissions follow least privilege. Both callers in this
article are the usual places those properties break. Support access is where teams ship a "log in as"
button that writes, and machine access is where they ship a long-lived API key with an administrator
behind it. A framework that owns sign-in for several apps has to answer both, or each app answers
them alone.

## The MMCA answer, part one: view-as is a token that cannot write

**The grant is a permission, a reason and a row.** `POST {userId}/view-as` on
`UsersAdminControllerBase` requires `users:view-as` (`AdministrationPermissions.ViewAsUsers`) on top of
the class-level `users:manage`, and takes a reason of 10 to 500 characters
(`ViewAsGrant.ReasonMinLength` and `ReasonMaxLength`). `ViewAsService.StartAsync` validates the reason
and refuses the caller's own account before any lookup, then refuses a missing or deleted account, a
machine client's service account, a locked account, and any account whose role itself holds
`users:view-as`, so staff cannot view each other. A host that enabled view-as but registered no
`IViewAsSubjectResolver` refuses every grant with `ViewAs.NotConfigured`.

The `ViewAsGrant` row is written **before** the token is minted, so no token exists without its audit
record, and each new grant sweeps rows older than `ViewAs:RetentionDays` (default 90, `[Range(1,
3650)]`) instead of running a hosted service in every process.

**The token is minted by the raw signer.** `ViewAsService` calls
`ITokenService.GenerateShortLivedAccessToken` directly, not the session-stamping wrapper the sign-in
workflow uses, so the token carries no `sid` and no `mfa` claim and opens no refresh session. It
carries the viewed account's standard claims plus two more: `act_sub`, the staff user, and `vag`, the
grant id (`AuthClaimTypes.ViewAsActor` and `AuthClaimTypes.ViewAsGrant`). Its lifetime is the smaller
of 15 minutes (`ViewAsGrant.MaxLifetime`) and the configured access-token lifetime. Nothing renews it.

**Presence of `act_sub` makes the request read-only, enforced twice.** The two layers exist because
the writes live in two places. Several writes never pass through a command handler at all (sign-in,
refresh, password and preference changes, device registration), so a check in the CQRS pipeline
alone would leave them open; and a command can be reached from a GET handler or a hub method, so a
check on the HTTP method alone would leave those open.

The HTTP layer is `ViewAsGuardMiddleware`, the `ViewAsGuard` step of the shared pipeline, added
whether or not view-as is enabled. A request without `act_sub` passes after one claim lookup. For a
view-as request the guard answers in order:

1. While `ViewAs:Enabled` is false (it defaults to false), 401, so a token minted before the switch
   was turned off reaches nothing.
2. Any method other than GET, HEAD or OPTIONS, 403, unless it is a POST to the one action marked as
   the end-view endpoint or to an endpoint the host marked `ViewAsReadOnlyEndpointAttribute` (gRPC is
   always POST).
3. The grant must still be live, else 401. On the host that holds the grant store this is one
   uncached primary-key read per view-as request, because a cached "live" answer on one replica would
   outlive an End handled on another. On a service without the store it is the token's own expiry
   plus a grant-ended marker in the shared cache.

Every failure on that path is a refusal. A store error, a missing `IViewAsService`, a missing cache or
an unreadable cache all answer 401. That is a deliberate contrast with `SoftDeletedUserMiddleware`,
which fails open, and the remarks on the class give the reason: the exposure here is one staff user's
support session, so an outage costs a support view, never a write in someone else's name.

The command layer is `ViewAsCommandDecorator`, registered last with `TryDecorate` so it runs first:
the outermost decorator of the standard command pipeline, wrapped only by the optional MiniProfiler
decorator that `AddApplicationProfiling` adds when `UseMiniProfiler` is on. While the caller carries `act_sub` it returns `Auth.ViewAsReadOnly`
(Forbidden) and the command does no feature-flag lookup, permission check, logging, validation or
transaction work. Queries carry no view-as decorator.

**The browser never holds the token, and the staff user's own session survives.** On a web host
behind the same-origin proxy, a successful grant writes a separate HttpOnly overlay cookie,
`mmca_view_as` (`ViewAsOverlayCookie.Name`), whose `Max-Age` is the token's remaining life. While it
is live its token replaces the session bearer for forwarded calls except sign-in and sign-out; it is
deleted on end, sign-out, a successful sign-in, expiry, or an upstream 401. The staff user's session
cookies are never touched, so ending the view lands them back in their own account. MAUI heads do not
offer view-as.

**The account holder can tell.** The grant row is the audit record and the user-visible record at
once: the viewed user's sign-in history merges each grant as a "Viewed by support" row, and a support
access log (`ViewAsGrantsAdminControllerBase` plus the routeless `SupportAccessLog` component) answers
who viewed whom, why, when and how it ended. One write serves the operator and the account holder, so
the two cannot disagree.

## The MMCA answer, part two: a machine client is a service-account user

**The decision that makes everything else cheap: a program gets a user id.** Audit stamps, ownership
rules and the per-user rate-limit partition all key on the token's integer `sub`. A separate client
principal type would need a second id space in each of them, and a client id would collide with a
user id. So each machine client is backed one to one by its own service-account user, created by the
consumer's `IServiceAccountProvisioner` over the app's own user aggregate, because MMCA.Common owns no
user table. `IAuthUser.IsServiceAccount` is a defaulted member, so an app that never adopts machine
clients implements nothing.

**The token endpoint is a base of its own.** `MachineTokenControllerBase` is an abstract controller
whose sealed subclass in the app routes it at `auth/token`. Its one action is a POST that is
`[AllowAnonymous]` (the secret is the credential), throttled by the `auth-ip` rate-limit policy as login
is, marked `[NonIdempotent]` so the replay cache never holds a bearer token at rest, and form-encoded
with `grant_type=client_credentials`. The client authenticates with HTTP Basic or with `client_id` and
`client_secret` form fields. The response is RFC 6749 on the wire, not Problem Details: `access_token`,
`token_type` and `expires_in`, or `invalid_client` (401, with a `WWW-Authenticate: Basic` header),
`unsupported_grant_type` or `invalid_request` (400), every answer carrying `Cache-Control: no-store`.
While machine clients are off the action answers 404, so a consumer can inherit the base before it
turns the feature on. Putting the action on `AuthControllerBase` instead would have changed every
consumer's committed OpenAPI documents for a feature none of them had enabled.

**The token is person-shaped.** `MachineClientService.IssueTokenAsync` checks the grant type, finds the
client and checks its secret, then reads the service account through the provisioner on **every**
mint, so a deleted or locked account stops the client at once. It mints through the same raw
`GenerateShortLivedAccessToken` view-as uses, adding `client_id` and `token_use=machine`
(`AuthClaimTypes.ClientId`, `TokenUse`, `TokenUseMachine`). The `sub` is the service account and the
permission claims are its role's, baked in exactly as for a person. It carries no refresh token, no
`sid`, no `auth_time` and no `mfa`, so a use case that requires a second factor refuses it with no
special case. `MachineClients:AccessTokenMinutes` defaults to 15 and is validated from 1 to 15.

**Revocation reuses a marker every service already reads.** `RevokeAsync` saves the row's
`RevokedOn` first, so no new token is minted, then writes the soft-deleted-user marker for the service
account, sized by `SoftDeletedUserCache.MarkerDurationFor` to the longer of the machine token's
lifetime and the host's access-token lifetime. Every service's `SoftDeletedUserMiddleware` then
answers 401 to the tokens the client already holds. The 15-minute cap is what keeps a token from
outliving the marker that is meant to stop it.

**Turning it on is two switches and a class.** `MachineClients:Enabled` defaults to false, and an
enabled host needs both the `AddMachineClients` call and its own `IServiceAccountProvisioner`; ADR-140
records a settings validator and a startup tripwire that fail each half-configuration.

## How each refuses the other

The two features meet at one permission, `users:view-as`, and the refusal runs in both directions.

**A machine client can never hold `users:view-as`.** `MachineClientService` keeps four forbidden
permissions, `users:view-as`, `users:manage`, `roles:manage` and `clients:manage`, and checks the
backing role against them at create (before the service account is provisioned, so a refused create
leaves no orphan) and again at every mint, because a role can gain a permission after the client
exists. A program holding `users:view-as` could read as any user; that power is reserved for a named
staff member giving a reason. The other three are the escalation paths: administering people,
granting its own role anything, and minting further clients for itself.

**View-as can never borrow a machine identity.** `ViewAsService` refuses a service account as a target
with `ViewAs.TargetIsServiceAccount` (Forbidden): there is no person behind it to support.

**And view-as refuses its own holders.** The same role check that keeps `users:view-as` off a machine
client keeps it off a view target: an account whose role holds it answers `ViewAs.TargetIsStaff`. No
lateral access between staff, and no chain from one borrowed identity to another, because a grant
request made under a view-as token is a POST the guard refuses.

**Endpoints where a person takes part refuse machines outright.** A machine client holds what its
role holds, so an endpoint that asks only for a signed-in caller (casting a vote, saving a bookmark,
checking in) is open to every machine client whatever its role. `[RefuseMachineClients]` is an
authorization filter that answers 403 with `MachineClients.EndpointRefused` to any request carrying
`token_use=machine` and leaves every other caller to `[Authorize]` and the permission attributes.
Declared on a controller it covers every action, permission-gated ones included.

```csharp
// Illustrative of the documented shape: the two narrowing claims and where each is read.
// Condensed from ViewAsGuardMiddleware, ViewAsCommandDecorator, MachineClientService and
// RefuseMachineClientsAttribute; logging, ConfigureAwait and the no-store path are dropped.

// 1. The HTTP layer: a view-as request may only read, and only while its grant is live.
public async Task InvokeAsync(HttpContext context, ILogger<ViewAsGuardMiddleware> logger)
{
    if (!context.User.IsViewAs()) { await next(context); return; }   // one claim lookup

    var settings = context.RequestServices?.GetService<IOptions<ViewAsSettings>>()?.Value;
    if (settings is null || !settings.Enabled) { context.Response.StatusCode = 401; return; }

    if (!IsSafeMethod(context.Request.Method) && !IsEndViewAsEndpoint(context) && !IsReadOnlyEndpoint(context))
    { context.Response.StatusCode = 403; return; }

    if (!await IsGrantLiveOnThisHostAsync(context, settings.HostsGrantStore, logger))
    { context.Response.StatusCode = 401; return; }                   // store error = refused

    await next(context);
}

// 2. The command layer: outermost decorator of the standard pipeline, so a refused command does no other work.
public async Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default)
{
    if (!currentUser.User.IsViewAs())
        return await inner.HandleAsync(command, cancellationToken);

    return CreateFailure()([Error.Forbidden("Auth.ViewAsReadOnly", "Viewing as another user is read-only.")]);
}

// 3. The machine mint: the account and its role are re-read every time.
var account = await provisioner.FindAsync(client.ServiceAccountUserId, cancellationToken);
if (account is null || account.UserId != client.ServiceAccountUserId || IsForbiddenRole(account.Role))
    return invalidClient;                                            // users:view-as among the four

var token = tokenService.GenerateShortLivedAccessToken(
    account.UserId, account.Email, account.Role, account.Name,
    [new(AuthClaimTypes.ClientId, client.Id.ToString()),
     new(AuthClaimTypes.TokenUse, AuthClaimTypes.TokenUseMachine)],
    TimeSpan.FromMinutes(settings.Value.AccessTokenMinutes));

// 4. The participation guard: a person must be at the keyboard.
public void OnAuthorization(AuthorizationFilterContext context)
{
    if (context.HttpContext.User.HasClaim(AuthClaimTypes.TokenUse, AuthClaimTypes.TokenUseMachine))
        context.Result = Refusal(context.HttpContext);               // 403 MachineClients.EndpointRefused
}
```

## Where the two stand in a deployed app

MMCA.ADC is the one consumer that enables either, and the two are in different states.

**View-as is switched on in ADC.** All four service hosts set `ViewAs:Enabled` true in their base
`appsettings.json`; Identity keeps the default `HostsGrantStore` and holds the grant table, while
Conference, Engagement and Notification set `HostsGrantStore` false and read the grant-ended marker
from the shared Redis cache. ADC registers its own `IViewAsSubjectResolver` over its `User`
aggregate, grants `users:view-as` in its Identity permission grants, places `ViewAsButton` on its
organizer user detail page, and routes the support access log as `AdminViewAsGrantsController` with a
`SupportAccess` page.

**Machine clients ship switched off in ADC production.** The Identity service calls
`AddMachineClients` and implements the provisioner, but its base `appsettings.json` sets
`MachineClients:Enabled` false with `AccessTokenMinutes` 15, so `auth/token` and every
`Admin/MachineClients` route answer 404 there. Only local development turns it on, through
`appsettings.Development.json` and the AppHost's `MachineClients__Enabled`. Eight participation
controllers declare `[RefuseMachineClients]` anyway (six in Engagement, two in Conference), so the
refusal is in place before the feature is.

## Trade-offs, honestly

- **One primary-key read per view-as request, and failing closed.** Only view-as requests pay it; an
  ordinary request pays one claim lookup in the middleware and one in the decorator. An outage of the
  grant store or the shared cache ends every live support view. That is the intended direction, and
  it is still an outage.
- **A page that writes on GET does not render for a viewer.** The method rule and the decorator
  refuse it with 403. That is correct and occasionally surprising.
- **The view is of standard claims only.** The token is minted from `ViewAsSubject` (subject, email,
  role, display name and the role's permissions). A claim an app adds through its own sign-in path is
  not reproduced, so a page that depends on one can render differently for the viewer.
- **`ViewAsReadOnlyEndpointAttribute` is an assertion nobody checks.** A host that marks a gRPC
  method read-only is promising it performs no write; the command decorator still refuses a command
  however it was reached, but a write that bypasses commands would pass.
- **A multi-service host needs one shared cache.** With a cache per service, a view ended on Identity
  keeps working on the others until its token expires: at most 15 minutes, still read-only.
- **A machine identity is a user row.** It shows up wherever the app lists users unless the app
  filters on `IsServiceAccount`.
- **Machine revocation is as fast as the soft-deleted check, and that check fails open.** Outstanding
  tokens are refused within the marker's window, not instantly, and `SoftDeletedUserMiddleware` lets a
  request through on a cache or validator error. The 15-minute token cap bounds the worst case.
- **No refresh token for programs.** A program asks for a new token when one expires, one request per
  quarter hour per program at the default. A refresh token would be a second long-lived credential
  beside the secret it already holds.
- **`[RefuseMachineClients]` is opt-in per endpoint.** The framework refuses only the four escalation
  permissions; deciding which endpoints need a person is the app's job, and declared at class level
  the attribute also refuses a machine client on the organizer actions inside those controllers.
- **Creating a machine client asks for no recent interactive sign-in.** ADR-140 lists step-up at
  client creation as a precondition for turning the feature on in production, which is one reason it
  stays off in ADC.

## Apply this even without MMCA

1. **Mint borrowed and machine identities as ordinary tokens.** If every service already validates one
   token format, a support view and a program should arrive in that format, so no service grows a
   second validation path.
2. **Mark the borrowed token with a claim whose presence narrows it.** `act_sub` present means
   read-only everywhere; nothing has to remember to check a flag that defaults to "write".
3. **Enforce read-only at both places writes live.** The HTTP method catches the writes that never
   become commands; a command decorator at the front of the pipeline catches the commands reached from a read.
4. **Write the audit row before the token, and show it to the account holder.** Access only an
   operator can see is access the user takes on trust.
5. **Fail closed where the exposure is small.** A support view that cannot prove its grant is live
   should stop, because the cost is one support session.
6. **Give a program a user id, not a new kind of principal.** Audit, ownership and rate limiting all
   keep working when the caller is a row in the same table.
7. **Re-check the backing role at every mint.** A role can gain a permission after the credential was
   issued; a check at creation alone is a check that expires.
8. **Name the permissions that can never back a program.** Impersonation and the three escalation
   paths (managing users, managing roles, minting clients) belong to people.
9. **Let an endpoint say a person must be present.** A role grants capabilities; it cannot express
   "this vote must be cast by a human". An attribute on the endpoint can.

The rule of thumb: **a token that does not belong to the person at the keyboard should carry a claim
that says so, and every layer that can write should read it.**

---

**What we covered:** why a support view and a program both end in a token that names somebody else,
how view-as mints a 15-minute, unrenewed token carrying `act_sub` and `vag` behind a permission, a
reason and an audit row written first, how `ViewAsGuardMiddleware` and the outermost
`ViewAsCommandDecorator` enforce read-only where the two kinds of write live, how the `mmca_view_as`
overlay cookie keeps the staff user's own session intact, how `MachineTokenControllerBase` serves the
client credentials grant at `auth/token` for a service-account user with no refresh, `sid` or `mfa`,
how four forbidden permissions and `[RefuseMachineClients]` bound a program's reach, how the
`users:view-as` role guard makes each feature refuse the other, and where MMCA.ADC stands on both.

**Next in the series:** Article 55, "Your App as an MCP Server: Read-Only Tools Over the Queries You
Already Govern."

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-137 and ADR-140 behind these
patterns, or `dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision records: `Website/docs-src/adr/137-read-only-view-as-support-access.md` and
  `Website/docs-src/adr/140-machine-clients-oauth-client-credentials.md`
- The full 34-category scorecard, §11 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 53, "One Framework, Three Clouds: A Cloud-Neutral Core With Vendor Adapter Packages."
Next: Article 55, "Your App as an MCP Server: Read-Only Tools Over the Queries You Already Govern."*

*Tags: .NET, C Sharp, Authentication, Security, OAuth*

*Notes: verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`, per the run's
shared anchor facts); every type, member, default and adopter claim below was read with path:line
this run. New article (2026-11-25). The code block is illustrative of the documented shape rather
than a compilable extract: it splices `ViewAsGuardMiddleware.InvokeAsync` (`:53-88`, logging calls
and the `ArgumentNullException` guard dropped, braces condensed, literal status codes in place of
`StatusCodes.Status401Unauthorized` / `Status403Forbidden`), `ViewAsCommandDecorator.HandleAsync`
(`:36-45`), the account re-read and mint inside `MachineClientService.IssueTokenAsync` (`:97-115`,
the claims array inlined and the `lifetime` local inlined) and
`RefuseMachineClientsAttribute.OnAuthorization` (`:40-50`, the early return folded into one `if`) into
one listing, with every `ConfigureAwait(false)` dropped. Control flow, member names, claim names and
error codes are faithful. Flag (2026-11-25): the brief stated both features ship switched off in ADC
production; the source shows view-as switched ON in all four ADC service hosts (see the adoption
bullet), so the article says so and states only machine clients as off.*
- *Verifier fixes (2026-11-25): `ViewAsCommandDecorator` is the outermost decorator of the standard
  command pipeline (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:159`),
  wrapped by `ProfilingCommandDecorator` when `AddApplicationProfiling` runs (`:179-182`, `:181`);
  ADC is the one consumer that "enables" view-as or machine clients rather than "carries" them,
  because MMCA.Store's Identity service lists the inherited `/Admin/Users/{userId}/view-as` route
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/openapi/MMCA.Store.Identity.Service.json:1841`)
  and sets no `ViewAs` section, so the action answers 404
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs:178-180`);
  the revocation marker sizing through `MarkerDurationFor` was already stated and is confirmed at
  `MachineClientService.cs:231-233`, no change; both footer lines now quote the exact titles of
  Article 53 (`cloud-neutral-vendor-adapters.md:1`) and Article 55 (`app-as-mcp-server.md:1`),
  replacing the earlier flag that the Article 55 title was unavailable.*
- *ADR-137 (`Website/docs-src/adr/137-read-only-view-as-support-access.md`), Accepted 2026-11-07,
  revised 2026-11-23 (`:3-8`): the four forces including writes that never pass through a command
  handler (`:17-19`) and the staff session that must survive (`:25-27`); the decision statement
  (`:30-32`); permission and reason (`:34-43`); refusals (`:44-55`); the grant row as audit record,
  written before the token, retention 90 swept on each grant (`:56-67`); the token with no `sid`, no
  `mfa`, at most 15 minutes (`:68-77`); never renewed, never chained (`:78-80`); the guard always in
  the pipeline after `SoftDeletedUserFilter` and before `Authorization`, failing closed, unlike the
  fail-open `SoftDeletedUserMiddleware` (`:81-102`); the outermost decorator (`:103-109`); ending a
  view (`:110-115`); the overlay cookie, its write, use and deletion rules (`:116-138`); MAUI
  excluded (`:221-222`); the user-visible sign-in history row "Viewed by support" (`:147-156`); off
  by default (`:157-166`); rationale (`:168-177`); trade-offs: one primary-key read, write-on-GET
  403, standard claims only (`:179-192`); the multi-service revision, `HostsGrantStore`, the
  `viewas:ended:{grantId}` marker and the shared-cache requirement (`:224-253`); the support access
  log revision, `ViewAsGrantsAdminControllerBase` and `SupportAccessLog` (`:255-333`); the read-only
  gRPC endpoint revision and the unchecked assertion (`:335-356`).*
- *ADR-140 (`Website/docs-src/adr/140-machine-clients-oauth-client-credentials.md`), Accepted
  2026-11-08, amended 2026-11-12, revised 2026-11-23 (`:3-17`): only a person could obtain a token,
  15-minute access tokens (`:20-24`); JWKS validation shared by every service (`:28-30`); audit,
  ownership and rate limiting keyed on an integer user id (`:31-34`); Common owns no user entity
  (`:35-38`); the decision statement (`:45-47`); the one-to-one service account and
  `IAuthUser.IsServiceAccount` defaulted false (`:49-55`); the settings validator and the startup
  tripwire (`:65-73`); the token endpoint as its own base and why not on `AuthControllerBase`
  (`:74-84`); the person-shaped token and `IRequiresMfa` refusing it (`:85-95`); the 1-15 minute
  range and the marker-duration rule (`:96-104`); revocation through the soft-deleted marker
  (`:111-114`); the four refused permissions and their reasons (`:115-124`); rationale (`:140-151`);
  trade-offs: a machine identity is a user row, revocation through the marker's cache that fails open,
  no refresh token (`:153-164`); alternatives rejected (`:166-177`); ADC consequences (`:183-230`);
  `[RefuseMachineClients]`, ADC's eight controllers and the class-level limit (`:231-259`); the
  production precondition on step-up at client creation (`:260-262`).*
- *`ViewAsGuardMiddleware`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ViewAsGuardMiddleware.cs:42`): the
  two-rule summary (`:13-33`); fail-closed remarks with the one-staff-session reason and the uncached
  read (`:34-40`); `InvokeAsync` (`:53-88`): the `act_sub` pass-through (`:57-62`), the disabled 401
  (`:64-72`), the method rule and its two exemptions (`:74-79`), the grant check 401 (`:81-85`);
  `IsGrantLiveOnThisHostAsync` with a missing `IViewAsService` refused (`:94-104`); `IsSafeMethod`
  GET/HEAD/OPTIONS (`:106-107`); `IsEndViewAsEndpoint` (`:109-111`); `IsReadOnlyEndpoint` (`:117-119`);
  the store lookup failing closed on an exception (`:135-143`); the no-store path: expiry (`:169-174`),
  missing cache (`:176-181`), the shared-store marker read (`:185-192`) and an exception refused
  (`:196-200`); `ViewAsEndEndpointAttribute` (`:244-245`). Registered as the `ViewAsGuard` step by
  `app.UseMiddleware<ViewAsGuardMiddleware>()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:133`;
  step position per ADR-137 `:81-85`).*
- *`ViewAsCommandDecorator<TCommand, TResult>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ViewAsCommandDecorator.cs:21`):
  the summary on the second layer and the outermost position (`:8-18`); `HandleAsync` with the
  `IsViewAs` pass-through and the `Auth.ViewAsReadOnly` Forbidden refusal (`:36-45`); registered
  through `services.TryDecorate(typeof(ICommandHandler<,>), typeof(ViewAsCommandDecorator<,>))`, the
  "outermost" comment on the line
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:159`).*
- *`ViewAsService`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsService.cs:42`): the raw-signer
  remark, no `sid`/`mfa`, `act_sub` and `vag`, min(15 minutes, configured lifetime), nothing renews it
  (`:16-23`); no lateral access, service accounts and locked accounts (`:24-29`); optional
  `IViewAsSubjectResolver` and `ICurrentUserService` (`:48-49`); `Lifetime` (`:55-58`); `StartAsync`
  (`:66`): self and reason before any lookup (`:75-80`), `ViewAs.NotConfigured` (`:82-87`), the
  retention sweep (`:101`), the row added before the mint (`:102`), the two claims and
  `GenerateShortLivedAccessToken` (`:104-115`); `IsGrantActiveAsync` (`:132-144`); `Refuse`
  (`:165-196`): `ViewAs.TargetNotFound` (`:169`), `ViewAs.TargetDeleted` (`:174`),
  `ViewAs.TargetIsServiceAccount` Forbidden (`:177-181`), `ViewAs.TargetLocked` (`:187-190`),
  `ViewAs.TargetIsStaff` Forbidden on a role holding `users:view-as` (`:192-195`).*
- *`ViewAsGrant`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ViewAsGrant.cs`): `ReasonMinLength = 10` (`:21`),
  `ReasonMaxLength = 500` (`:24`), `MaxLifetime = TimeSpan.FromMinutes(15)` (`:30`).
  `ViewAsSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsSettings.cs`): `Enabled`
  (`:40`, default false), `[Range(1, 3650)]` on `RetentionDays` (`:55`; default 90 per ADR-137
  `:64`). `ViewAsOverlayCookie.Name = "mmca_view_as"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/ViewAsOverlayCookie.cs:31`).*
- *`AuthClaimTypes`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs`): `ViewAsActor = "act_sub"`
  with the presence-makes-it-read-only remark (`:113-122`); `ViewAsGrant = "vag"` (`:128`);
  `ClientId = "client_id"` (`:134`); `TokenUse = "token_use"`, only machine tokens carry it
  (`:136-140`); `TokenUseMachine = "machine"`, no refresh token, `sid`, `auth_time` or `mfa`
  (`:142-146`). `AdministrationPermissions`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs`):
  `ManageUsers = "users:manage"` (`:18`), `ManageRoles = "roles:manage"` (`:21`),
  `ViewAsUsers = "users:view-as"` (`:27`), `ManageClients = "clients:manage"` (`:40`).*
- *`MachineTokenControllerBase`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/MachineClients/MachineTokenControllerBase.cs:40`):
  the sealed subclass at `auth/token` (`:16-20`); off means 404 (`:22-26`); RFC 6749 on the wire,
  Basic or form fields, the three error codes, `Cache-Control: no-store` (`:27-33`); anonymous and
  throttled by `RateLimitPolicyAuthIp` (`:34-38`); `[HttpPost]`, `[NonIdempotent]` with the
  replay-cache reason, `[AllowAnonymous]`, `[EnableRateLimiting]`, form `[Consumes]` (`:45-49`); the
  404 when `IMachineClientService.IsEnabled` is not true (`:57-60`); `no-store` and `Pragma`
  (`:62-64`); `ReadClientCredentials` (`:85-108`); `TokenError` (`:115-124`); `InvalidClient` with
  `WWW-Authenticate: Basic` and 401 (`:126-131`).*
- *`MachineClientService`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/MachineClientService.cs:35`):
  the raw-signer remark, no `sid`, `mfa` or `auth_time`, `client_id` and `token_use=machine`
  (`:14-21`); four refused permissions at create and every mint (`:22-26`); `ForbiddenPermissions`
  (`:47-58`); `IsEnabled` (`:61`); `IssueTokenAsync` (`:66-120`): grant-type checks (`:72-80`), client
  and secret (`:82-93`), the provisioner re-read and forbidden-role check on every mint (`:95-101`),
  the two machine claims and `GenerateShortLivedAccessToken` (`:103-115`), the `Bearer` response
  (`:119`); `CreateAsync` checking the role before provisioning (`:130-170`, check `:146-149`,
  provisioning `:160`); `RevokeAsync` saving the row first then writing the marker through
  `SoftDeletedUserCache.MarkerDurationFor` over the longer lifetime (`:211-237`, marker `:230-234`);
  `IsForbiddenRole` (`:250-254`). `MachineClientSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/MachineClients/MachineClientSettings.cs`):
  `Enabled` (`:36`, default false), `AccessTokenMinutes = MaxAccessTokenMinutes` (`:42`); the range
  check in `MachineClientSettingsValidator.cs:23` (bounds 1 and 15 per ADR-140 `:96-98`).*
- *`RefuseMachineClientsAttribute`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/RefuseMachineClientsAttribute.cs:34`):
  the summary leaving every other caller to `[Authorize]` and the permission attributes (`:13-19`);
  why it exists (`:21-26`); scope, class level covering permission-gated actions (`:27-31`);
  `ErrorCode = "MachineClients.EndpointRefused"` (`:37`); `OnAuthorization` (`:40-50`); the 403
  problem response (`:57-77`).*
- *MMCA.ADC adoption, from searches of `MMCA.ADC/Source` this run. View-as on:
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:121-124` (`Enabled` true at
  `:122`, the explanatory comment naming organizers, 15 minutes, 90-day retention, the
  Identity-holds-the-store and shared-Redis-marker topology at `:113-120`);
  `MMCA.ADC.Conference.Service/appsettings.json:68-71`, `MMCA.ADC.Engagement.Service/appsettings.json:80-83`
  and `MMCA.ADC.Notification.Service/appsettings.json:92-95` (each `Enabled` true, `HostsGrantStore`
  false); no `ViewAs` override in any other `appsettings*.json`, `*.bicep` or `*.yml` under
  `MMCA.ADC`. `IViewAsSubjectResolver` registered
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:53`) and
  implemented over `User` (`.../Users/Administration/ViewAsSubjectResolver.cs:24`);
  `IdentityPermissions.UsersViewAs` aliasing `AdministrationPermissions.ViewAsUsers`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:52`)
  granted in `IdentityPermissionGrants.cs:48`; `<ViewAsButton UserId="_user.Id" />`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserDetail/UserDetail.razor:127`);
  `AdminViewAsGrantsController : ViewAsGrantsAdminControllerBase`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AdminViewAsGrantsController.cs:20`);
  `<SupportAccessLog />` (`.../Identity.UI/Pages/Users/SupportAccess.razor:10`) and
  `AddSupportAccessLogUI()` (`.../Identity.UI/DependencyInjection.cs:41`). Machine clients off:
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:148-152` (`Enabled` false at
  `:149`, `AccessTokenMinutes` 15 at `:150`, the ships-switched-off comment at `:140-147`); on only in
  `appsettings.Development.json:39-40` and the AppHost's
  `identityService.WithEnvironment("MachineClients__Enabled", "true")`
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:488`); the `AddMachineClients` call and the
  provisioner per ADR-140 `:183-204`. `[RefuseMachineClients]` at class level on
  `Engagement.API/Controllers/BookmarksController.cs:36`, `CheckInsController.cs:41`,
  `LivePollVotingController.cs:36`, `PointsController.cs:36`, `SessionQuestionsController.cs:38`,
  `TicketsController.cs:41`, and `Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:81`
  and `Controllers/Events/EventQuestionAnswersController.cs:81`.*
- *Mapping: Pillar, Group and Rubric follow the neighbouring identity article, Article 52
  (`Website/docs-src/articles/README.md:62`, P2/P4, G08, §11); Article 16 is
  `jwks-cross-service-auth.md` (`README.md:26`) and Article 53 is `cloud-neutral-vendor-adapters.md`
  (`README.md:63`). No scorecard number is quoted in this article.*

- Full series index: https://ivanball.github.io/writing.html
