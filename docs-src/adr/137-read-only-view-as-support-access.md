# ADR-137: Read-Only View-As Support Access (Reasoned, 15 Minutes, Visible to the User)

## Status
Accepted (2026-11-07). Ships in the MMCA.Common release after v1.277.0. Off by default
(`ViewAs:Enabled`, `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsSettings.cs:28`);
a consumer opts in per host.

## Context
A support or operations user who is asked "why does my screen look like this" cannot see what one
user sees without that user's password, and MMCA had no staff access path at all. Writing one raises
four forces:

- **The account holder must be able to tell.** Access that only an operator can see is access the user
  has to take on trust. The record of it has to be somewhere the user already looks.
- **Nothing may be written in the user's name.** Several writes never pass through a command handler
  (sign-in, refresh, password and preference changes, device registration), so a check in the CQRS
  pipeline alone ([ADR-014](014-cqrs-decorator-pipeline.md)) would leave them open.
- **"Impersonating" is taken.** `ImpersonatingCurrentUserService` and `ScopedUserOverride` restore a
  background identity onto an outbox or job scope
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ImpersonatingCurrentUserService.cs:8-20`),
  which is a different thing. This feature is called view-as everywhere: permission `users:view-as`,
  claim `act_sub`, settings section `ViewAs`.
- **The staff user's own web session must survive.** On a web host behind the same-origin proxy
  ([ADR-131](131-same-origin-api-proxy.md)) the browser holds one session in HttpOnly cookies; replacing
  it would sign the staff user out of their own account.

## Decision
**A permission-gated, reasoned, at most 15-minute, never-renewed token carrying `act_sub`; reads
only, enforced at the HTTP method and at the command; each grant is a row the viewed user sees in
their sign-in history; off by default.**

1. **Permission and reason.** `POST {userId}/view-as` on `UsersAdminControllerBase`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs:137`)
   requires `users:view-as` (`:138`; `AdministrationPermissions.ViewAsUsers`,
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:27`) on
   top of the class-level `users:manage` (`UsersAdminControllerBase.cs:46`;
   `AdministrationPermissions.cs:18`). The body is `StartViewAsRequest(Reason)`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/AdministrationRequests.cs:32`), and a
   reason of 10 to 500 characters after trimming is required
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ViewAsGrant.cs:20`, `:23`, `:74-81`). The action is
   `[NonIdempotent]` (`UsersAdminControllerBase.cs:139`): every call is a new grant row.
2. **Refusals.** The caller's own account (`ViewAs.Self`, `ViewAsGrant.cs:66-72`); an account the
   consumer's resolver does not find (`ViewAs.TargetNotFound`) or reports soft-deleted
   (`ViewAs.TargetDeleted`); and an account whose role itself holds `users:view-as`
   (`ViewAs.TargetIsStaff`), so staff cannot view each other
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsService.cs:134-150`). A host
   that enabled view-as but registered no `IViewAsSubjectResolver` refuses every grant
   (`ViewAs.NotConfigured`, `:74-79`).
3. **The `ViewAsGrant` row is the audit record.** There is no separate audit-event API, and the field
   audit trail ([ADR-075](075-audit-trail.md)) fires only on entity changes, so the row
   (`Id`, `StaffUserId`, `TargetUserId`, `Reason`, `GrantedAt`, `ExpiresAt`, `EndedAt`;
   `ViewAsGrant.cs:29-47`) is it. It is written before the token is minted, so no token exists without
   its row (`ViewAsService.cs:88-89`). It is a flat bookkeeping record like `RefreshSession`, with no
   soft-delete flag, so no query filter hides it from the per-request check (`ViewAsGrant.cs:10-15`).
   Rows are kept `ViewAs:RetentionDays` (default 90, `[Range(1, 3650)]`, `ViewAsSettings.cs:34-35`),
   matching the audit trail's default
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:38`),
   and swept on each new grant rather than by a hosted service (`ViewAsService.cs:88`).
4. **The token: no `sid`, no `mfa`, at most 15 minutes.** `ViewAsService` mints through the raw
   `ITokenService`, not the session-stamping wrapper the sign-in workflow uses, so the token carries
   no `sid` and no `mfa` claim and opens no refresh session (`ViewAsService.cs:16-22`). It carries the
   viewed account's standard claims plus `act_sub` (the staff user,
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:79`) and `vag` (the grant id,
   `:85`) (`ViewAsService.cs:91-102`). Its lifetime is min(15 minutes, the configured access-token
   lifetime) (`:47-50`; `ViewAsGrant.MaxLifetime`, `ViewAsGrant.cs:26`, and the clamp at `:83-86`),
   minted by `ITokenService.GenerateShortLivedAccessToken`, which the framework's `TokenService`
   honors exactly
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:118-128`).
5. **Never renewed, never chained.** Nothing mints a refresh token for it, the proxy never refreshes or
   replays it (point 9), and a grant request made under a view-as token is a non-safe method the guard
   refuses (point 6), so a view cannot start another view.
6. **The guard is always in the pipeline and fails closed.** `ViewAsGuardMiddleware` is the
   `ViewAsGuard` step, after `SoftDeletedUserFilter` and before `Authorization`, added whether or not
   view-as is enabled
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:126-133`;
   `MiddlewarePipelineStepNames.cs:65`). A request without `act_sub` passes after one claim lookup
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ViewAsGuardMiddleware.cs:52-56`). For a
   view-as request:
   - while `ViewAs:Enabled` is false, 401, so a token minted before the switch was turned off reaches
     nothing (`:60-65`);
   - any method other than GET, HEAD or OPTIONS, 403 (`:67-72`, `:84-85`), except the one action marked
     `[ViewAsEndEndpoint]` (`:87-89`, `:135-136`);
   - the grant must exist, name this staff user and this account, and be neither ended nor expired
     (`ViewAsService.cs:119-131`; `ViewAsGrant.IsActiveAt`, `ViewAsGrant.cs:101`), else 401
     (`ViewAsGuardMiddleware.cs:74-79`). The check is one uncached primary-key read per view-as request,
     because a cached "live" answer on one replica would outlive an End handled on another, and a store
     error or a missing `IViewAsService` answers 401 (`:29-34`, `:105-113`), unlike
     `SoftDeletedUserMiddleware`, which fails open ([ADR-047](047-soft-deleted-user-session-revocation.md)).
7. **The outermost command decorator.** `ViewAsCommandDecorator` refuses every command with
   `Auth.ViewAsReadOnly` (Forbidden) while the caller carries `act_sub`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ViewAsCommandDecorator.cs:36-45`),
   and is registered last, so it runs first
   (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:141`). That covers a command
   sent from a GET handler or a hub method, and a refused command does no flag, permission, logging,
   validation or transaction work. Queries carry no view-as decorator.
8. **Ending a view.** `POST auth/view-as/end` on `AuthControllerBase`, `[ViewAsEndEndpoint]` and
   `[NonIdempotent]`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:253-256`), marks
   the grant ended, so the same token is refused on its next request rather than at expiry. It answers
   404 while disabled (`:269-272`) and 400 `ViewAs.NotViewing` for a token that is not a view-as token
   (`:274-278`).
9. **Web only, through a separate overlay cookie in the same-origin proxy.** The token never reaches
   script and the staff user's session cookies are never touched:
   - The cookie is `mmca_view_as`, HttpOnly, Secure by the session cookies' rule, the proxy's
     `SessionCookieSameSite`, `Path=/`, and a `Max-Age` equal to the token's remaining life
     (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/ViewAsOverlayCookie.cs:31`,
     `:92-104`, `:118-131`).
   - **When it is written.** The proxy treats a POST whose last path segment is `view-as` as a grant
     (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:340-344`)
     and writes the cookie only from a 2xx answer (`SameOriginProxyTransformer.cs:119-121`) whose token
     parses as a JWT carrying both `act_sub` and `vag` (`:238-251`); the browser gets the same JSON with
     the token replaced by its claims-only form (`:162-184`). Any other answer passes through and no
     cookie is written.
   - **While it is live** its token replaces the session bearer for every forwarded call except sign-in
     and sign-out (`SameOriginApiProxyEndpoint.cs:405-417`), and it also answers server rendering,
     `POST /auth/session/token` and the Blazor Server handoff (`ViewAsOverlayCookie.cs:21-25`;
     `SameOriginApiProxyEndpoint.cs:441-444`; `SessionHandoffEndpoints.cs:31-33`).
   - **When it is deleted.** On end (whatever the upstream answered), on sign-out, on a successful
     sign-in, when it has already expired, and when the upstream answers 401 to its bearer
     (`SameOriginProxyTransformer.cs:133-138`). The end path is `SameOriginApiProxy:ViewAsEndPath`
     (default `auth/view-as/end`, `SameOriginApiProxySettings.cs:99`).
10. **Banner and button.** `ViewAsBanner` ("Viewing as {name}, read-only, ends in mm:ss" with End,
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/ViewAsBanner.razor.cs:13-21`;
    `SharedResource.resx:931-935`) renders nothing for an ordinary principal and sits in `MainLayout`
    above every page (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:82-83`).
    End posts through the proxy and reloads the app on the staff user's own session, as does the
    countdown reaching zero. `ViewAsButton` asks for the reason and posts the grant from the browser; it
    shows only to a principal holding `users:view-as` that is not itself viewing
    (`ViewAsButton.razor.cs:12-21`, `:52`, `:58`). A consumer places it on its own admin user page.
11. **The viewed user sees it.** The sign-in history merges each grant on the account as a
    `SignInHistoryEntryKind.ViewAs` row
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/SignInHistoryEntryKind.cs:19`;
    `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/SignInHistory.cs:55-56`, `:80-103`)
    in the same newest-first list capped at 50, with no device or address, never current, and ended
    either `ViewAsEnded` (`SignInEndReasons.cs:26`) or `Expired`.
    `SignInHistoryTable` labels it "Viewed by support"
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/SignInHistoryTable.razor.cs:71-73`;
    `SharedResource.resx:952-953`). See the sign-in history amendment of
    [ADR-097](097-multi-device-refresh-sessions.md).
12. **Off by default.** `ViewAsSettings` binds the `ViewAs` section with `ValidateOnStart`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:186-191`). While
    `Enabled` is false the grant and end actions answer 404 (`UsersAdminControllerBase.cs:155-158`;
    `AuthControllerBase.cs:269-272`), the `ViewAsGrants` table is in no model
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:951-956`),
    the store answers as if no grant existed (`EFViewAsGrantStore.cs:19-21`, `:51-54`), and the guard
    refuses every view-as token (point 6).

## Rationale
- **Two layers because the writes live in two places.** The HTTP method check covers every endpoint,
  including the auth writes that never become commands; the decorator covers a command reached by any
  other path. Either alone leaves a gap.
- **The grant row doubles as the user-visible record.** One write serves the operator's audit and the
  account holder's history, so the two cannot disagree.
- **Fail closed is cheap here.** The exposure is one staff user's support session, not every user's
  every request, so an outage costs a support view, never a write in someone else's name.
- **A short, unrenewable token bounds the damage of a leak** to at most 15 minutes of reads, and End
  shortens it to the next request.

## Trade-offs
- **One primary-key read per view-as request.** Only view-as requests pay it; an ordinary request pays
  one claim lookup in the middleware and one in the decorator.
- **A read path that writes as a side effect answers 403 under view-as.** That is the intended failure,
  but it means a page that writes on GET does not render for a staff viewer.
- **Standard claims only.** The token is minted from `ViewAsSubject` (`sub`, email, role, display name,
  and the role's permissions;
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/ViewAs/ViewAsSubject.cs:6-20`); claims an app
  adds through its own sign-in path are not reproduced, so a page that depends on one can render
  differently for the viewer.
- **A hand-written `ITokenService` ignores the 15-minute lifetime.** The interface default mints with
  the configured lifetime
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:29-34`,
  `:42-49`); the guard still refuses the token once its grant expires.

## Alternatives rejected
- **Full impersonation with writes** (2026-11-07). It falsifies the audit trail (every row would name
  the user, not the staff member) and would need the actor carried through the outbox and the broker
  hop. Support needs to see, not to act.
- **Reusing the `Impersonating*` types** (2026-11-07). They mean background identity restore onto a
  non-request scope; overloading the name would make both harder to reason about.
- **Logging grants only** (2026-11-07). Logs are not user-visible, so the account holder could not
  tell that support looked.

## Consequences
- **One migration per consumer that enables it.** The `ViewAsGrants` table with indexes
  `IX_ViewAsGrants_TargetUserId_GrantedAt` and `IX_ViewAsGrants_GrantedAt`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/ViewAsGrantModelBuilderExtensions.cs:15`,
  `:18`, `:21`, `:33-48`), scaffolded with `DesignTimeDbContextOptions.EnableViewAsGrants = true`
  (`MMCA.Common/UPGRADING.md:98-103`). A consumer that leaves it off adds nothing.
- **A privacy disclosure for any consumer that enables it**, stating that staff can view an account
  read-only and that the account holder sees each view (`ViewAsSettings.cs:16-19`).
- **Consumer wiring.** Register an `IViewAsSubjectResolver` over the app's users, grant `users:view-as`
  to the staff role that also holds `users:manage`, and place `ViewAsButton` on the admin user page
  (`MMCA.Common/UPGRADING.md:104-112`).
- **Binary-breaking constructors.** `AuthSessionIssuer` and `UserSessionsAdministrationService` gain an
  optional trailing `IViewAsGrantStore` (`AuthSessionIssuer.cs:60`;
  `UserSessionsAdministrationService.cs:20`). Source that constructs them by hand still compiles, but
  the old constructors are removed from the public API
  (`MMCA.Common/Source/Core/MMCA.Common.Application/PublicAPI.Unshipped.txt:77-78`), so an assembly
  compiled against them must be rebuilt.
- **App-specific claims are not reproduced** in the view-as token (see Trade-offs).
- **MAUI is excluded.** The overlay lives in the web proxy; MAUI heads do not offer view-as
  (`MMCA.Common/UPGRADING.md:112`).

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator pipeline the view-as decorator now heads),
[ADR-020](020-permission-based-authorization.md) (the `users:view-as` permission),
[ADR-047](047-soft-deleted-user-session-revocation.md) (the fail-open middleware this guard deliberately does not copy),
[ADR-075](075-audit-trail.md) (the field audit trail the grant row complements),
[ADR-079](079-shared-http-middleware-pipeline.md) (the named middleware steps `ViewAsGuard` joins),
[ADR-097](097-multi-device-refresh-sessions.md) (the sign-in history the grants appear in),
[ADR-116](116-identity-completions-opt-in.md) (the user administration controller the grant action lives on),
[ADR-131](131-same-origin-api-proxy.md) (the proxy that carries the overlay cookie).
