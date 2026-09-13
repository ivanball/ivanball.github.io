# ADR-116: Identity Completions Ship as Opt-In Base Classes, Not as Framework Features

## Status
Accepted (2026-09-09). Layers stored permission grants over
[ADR-020](020-permission-based-authorization.md)'s compiled registry and extends the shared sign-in
workflow of [ADR-050](050-jwt-refresh-token-rotation.md) with optional collaborators.

## Context
The framework already owns the hard, uniform parts of identity. `AuthenticationServiceBase<TUser>`
carries login, registration, refresh-token rotation with reuse detection and revocation
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74`), the apps
subclass it and supply hooks for the pieces that are genuinely theirs (their `User` factory, their
claim set, their lookups). Password reset ships the same way: a cache-backed, hashed-at-rest,
single-use token service
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26`,
[ADR-091](091-cache-backed-password-reset.md)) plus two handler bases the apps derive from.
Authorization is a compiled role-to-permission map behind `IPermissionRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:13`,
[ADR-020](020-permission-based-authorization.md)), consulted by the CQRS authorization decorators and
by the `[HasPermission]` policy handler.

Four things that a production identity module needs were still missing, and every consumer either
lived without them or would have written its own: a second authentication factor, email
confirmation, permission grants an operator can edit without a deploy, and a user and role
administration API.

The obvious way to add them is as framework features: a concrete `TwoFactorService` with its own
tables, a confirmation flow with its own pages, an admin area. That shape is wrong for this
framework for three reasons the existing code already demonstrates.

**The user row is the app's, not the framework's.** Store's `User`
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs`) and ADC's differ in
their role model, their profile fields, their linked aggregates and their invariants. Every existing
identity hoist reaches the app's aggregate through a narrow contract (`IAuthUser`,
`IPasswordChangeableUser`, `IErasableUser`) precisely because a framework-owned user table would
either be too thin to use or force fields an app has no column for.

**Sign-in is a chain no consumer can afford to have changed under it.** ADC and Store both run their
production sign-in through the shared base. A new mandatory step in that chain is a behaviour change
in a deployed system, and the framework's own history says so: the 1.188.0 release needed an
`UPGRADING.md` section with eight items (`MMCA.Common/UPGRADING.md:35`), one of which (the fallback
authorization policy) broke unannotated endpoints.

**Pages are where apps diverge most.** The framework ships credential pages in `MMCA.Common.UI`, and
their existence is already the exception rather than the rule. A two-factor enrollment page has to
render a QR code, present recovery codes once, and fit an app's layout and copy; two consumers have
not yet asked for the same one.

## Decision
**The four identity completions ship as opt-in extension points: contracts and abstract bases in
Application, implementations in Infrastructure behind their own `Add*` calls, and OPTIONAL
constructor arguments where the shared sign-in workflow has to learn a new step. A consumer that
adopts none of them observes no change at all. Pages stay in the consumers until two of them want the
same one.**

1. **Two-factor is a contract plus a challenge, not a feature.** `ITwoFactorService`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/TwoFactor/ITwoFactorService.cs:16`) is
   stateless cryptography: secrets, provisioning URIs, code verification inside a configured skew
   window, and recovery codes returned as a `RecoveryCodeSet` of plaintext plus hashes (`:84`).
   `ITwoFactorStore` (`.../Auth/TwoFactor/ITwoFactorStore.cs:24`) is the persistence the consumer
   implements over its own `User`, which exposes `ITwoFactorUserState`
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/ITwoFactorUserState.cs:27`). The framework ships
   no user table and no migration for this.

2. **The sign-in hook is an optional constructor argument, and its absence is a no-op.**
   `AuthenticationServiceBase` gained `ITwoFactorAuthenticator? twoFactor = null` and
   `IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null`
   (`.../Auth/AuthenticationServiceBase.cs:83-84`), the shape `ChangePasswordHandlerBase` established
   for `IRefreshSessionStore`. `ChallengeSecondFactorAsync` answers `NotEnrolled` outright when no
   authenticator was supplied (`:665`), so an unadopted consumer pays not even a query, and every
   existing subclass keeps compiling because it simply passes fewer arguments.

3. **The step-up assertion is a claim, and presence is the whole test.** A verified challenge stamps
   the `amr`-style `mfa` claim (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:55`)
   with the method that satisfied it (`:58`, `:61`), through the same pass-through token service that
   already stamps `sid` (`.../Auth/AuthenticationServiceBase.cs:621`), so the app's
   `CreateAccessToken` hook keeps its signature. `IRequiresMfa`
   (`.../UseCases/Markers/IRequiresMfa.cs:28`) is checked by the decorators through the shared
   `AuthorizationGate` (`.../UseCases/Decorators/AuthorizationGate.cs:52`), which reads the claim via
   `ClaimsPrincipalExtensions.HasMultiFactor`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:107`) rather than
   widening `ICurrentUserService`. Absence denies; there is no "this account has no second factor so
   let it through" branch.

4. **Email confirmation reuses the password-reset design and gates nothing by default.**
   `IEmailConfirmationTokenService`
   (`.../Auth/EmailConfirmation/IEmailConfirmationTokenService.cs:15`) mirrors
   `IPasswordResetTokenService` member for member, and the implementation
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:35`)
   mirrors its record shape, hashing, attempt cap and throttle, under its own `emailconfirm:` key
   prefix so issuing a confirmation link cannot invalidate an outstanding reset link.
   `RequireConfirmedEmail` defaults to false
   (`.../Auth/EmailConfirmation/EmailConfirmationSettings.cs:55`, under the
   `Authentication:EmailConfirmation` section at `:13`), because turning it on locks out every
   existing account whose address was never confirmed. The existing `IEmailSender` is reused; no
   mail abstraction ships with this.

5. **Stored grants union with the compiled registry and can never deny.** `PermissionGrant`
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/PermissionGrant.cs:24`) is a flat
   `(Role, Permission)` row with no soft-delete flag
   (`.../Infrastructure/Persistence/Auth/PermissionGrantModelBuilderExtensions.cs:30`). The DI call is
   the whole opt-in: `AddStoredPermissionGrants(configuration)` registers the marker
   `PermissionGrantModelGate`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/PermissionGrantModelGate.cs:19`,
   `.../Infrastructure/DependencyInjection.cs:543`), and `ApplicationDbContext` resolves that marker
   with `GetService` and maps the table only when it is present AND this context instance targets the
   physical source named by `Authentication:PermissionGrants:DataSourceName`
   (`.../Persistence/DbContexts/ApplicationDbContext.cs:910-915`). No consumer calls the model-builder
   extension by hand, a host that never opts in keeps a byte-identical model, and the other databases
   in an opted-in host stay unchanged because one database owns the rows (the refresh-session
   precedent).
   `LayeredPermissionRegistry` (`.../Auth/Permissions/LayeredPermissionRegistry.cs:30`) decorates
   whatever `IPermissionRegistry` the host already registered and adds the stored set to the compiled
   one. There is no deny row: a stored edit can only widen a role, so the effective permission set
   never depends on evaluation order and a data change can never disable an endpoint the code
   guarantees.

6. **The authorization read stays synchronous, so the cache is part of the contract.**
   `IPermissionRegistry.HasPermission` is synchronous and sits on the hot path of every gated request.
   Rather than block on I/O there, the grants are held as a per-role `IMemoryCache` snapshot behind
   `IPermissionGrantCache` (`.../Auth/Permissions/IPermissionGrantCache.cs:21`), rebuilt by a hosted
   service on `Authentication:PermissionGrants:CacheSeconds`
   (`.../Auth/Permissions/PermissionGrantSettings.cs:12`, `:23`) and immediately by
   `IPermissionGrantCacheInvalidator` (`.../Auth/Permissions/IPermissionGrantCache.cs:51`) after an
   edit. A cold cache grants nothing, which is the safe direction, and the compiled layer answers
   from the first request either way.

7. **The administration API is two controller bases over two services, one of which ships filled in.**
   `UsersAdminControllerBase<TUserDto>`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs:49`)
   takes a consumer-implemented `IUserAdministrationService<TUserDto>`
   (`.../Auth/Administration/IUserAdministrationService.cs:24`), because only the app knows its user
   table. `RolesAdminControllerBase` takes `IRoleAdministrationService`
   (`.../Auth/Administration/IRoleAdministrationService.cs:23`), which the framework CAN implement in
   full because both halves are framework-owned, so `AddStoredPermissionGrants` registers a default.
   Both bases are gated on capabilities, not role names
   (`.../Controllers/Administration/UsersAdminControllerBase.cs:48`,
   `.../Controllers/Administration/RolesAdminControllerBase.cs:43`), against
   `AdministrationPermissions.ManageUsers` / `ManageRoles`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:18`,
   `:21`). The roles base serves three reads and one write, the third read being the catalog an editor
   draws from: `GetCatalogAsync` on the literal route `catalog`, which takes precedence over the
   `{role}` template so no role named "catalog" can shadow it
   (`.../Controllers/Administration/RolesAdminControllerBase.cs:98`, `:102`), returning
   `PermissionCatalogResponse`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Responses/PermissionCatalogResponse.cs:22`) over
   `IRoleAdministrationService.GetCatalogAsync`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Administration/IRoleAdministrationService.cs:58`).
   A consumer routes its subclass at `Admin/Roles`, so the catalog read is `GET Admin/Roles/catalog`.

8. **Three separate DI calls, none of them in `AddInfrastructure`.**
   `AddTwoFactorAuthentication(config)`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:465`),
   `AddEmailConfirmation(config)` (`:493`) and `AddStoredPermissionGrants(config)` (`:527`) are opted
   into one at a time. Registering a service is still not the same as changing behaviour: two-factor
   only reaches sign-in once the app passes the resolved authenticator to its base constructor, and
   confirmation only gates sign-in once `RequireConfirmedEmail` is set AND the app's `User` implements
   `IEmailConfirmableUser`
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IEmailConfirmableUser.cs:22`).

9. **One new package, in Infrastructure only.** `Otp.NET` (MIT, netstandard2.0, no transitive graph)
   supplies the RFC 6238 grammar and the Base32 alphabet, which the BCL has no primitive for. It is
   referenced by `MMCA.Common.Infrastructure` alone
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:69`, used by
   `.../Auth/TwoFactor/TotpTwoFactorService.cs:35`); Application, Domain and Shared stay
   dependency-free, matching the `Cronos` precedent.

10. **Pages stay with the consumers; the administration surface ships as routeless components.** No
    enrollment page and no confirmation page ships in `MMCA.Common.UI`, and nothing the framework
    ships carries an `@page` directive: `RoleAdminList`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/RoleAdminList.razor.cs:27`)
    and `RoleAdminEdit` (`.../Pages/Administration/RoleAdminEdit.razor.cs:35`) are components the app
    routes, authorizes and links for itself (`RoleAdminList.razor.cs:12-13`). They were promoted under
    the rule the framework already applies to shared components, two consumers wanting the same one,
    and they qualify because roles and permissions are strings the framework already owns, so there is
    no app DTO to name (`.../Presentation/MMCA.Common.UI/DependencyInjection.cs:227-228`). They talk
    to the controller base through `IRoleAdminUIService`
    (`.../UI/Services/Administration/IRoleAdminUIService.cs:41`) and its typed-client implementation
    `RoleAdminService` (`.../UI/Services/Administration/RoleAdminService.cs:50-51`), registered by
    `AddRoleAdministrationUI()` (`.../UI/DependencyInjection.cs:234`). An app that serves no
    role-administration endpoints registers nothing and renders neither component.

11. **The editor draws a closed catalog, and the surface cannot be locked out from inside it.**
    `IPermissionCatalog`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionCatalog.cs:24`) is the
    compiled universe an administration screen may offer: every role the registry grants something to
    and every permission its code can grant, both sorted ordinally. It is implemented explicitly by
    `PermissionRegistry`
    (`.../Shared/Auth/Permissions/PermissionRegistry.cs:16`, `:55`, `:58`), so the same frozen map
    answers both questions while the hot authorization path keeps a registry that deliberately cannot
    enumerate; `AddPermissions` registers the one instance under both contracts
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:134`),
    and an unconfigured host falls back to `UnconfiguredPermissionRegistry`
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/UnconfiguredPermissionRegistry.cs:21`,
    registered at `.../Application/DependencyInjection.cs:132`). `SetStoredPermissionsAsync` refuses
    two things against that list
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs:139-143`,
    `:149-157`): `AdministrationPermissions.ManageRoles`, outright, because granting the key to this
    surface from a row would make access to role administration a matter of data and deleting the row
    would lock every operator out of the screen that could restore it; and any permission outside the
    catalog, because a stored row no endpoint checks is a typo rather than a silently inert grant.

12. **The token carries the permissions, so a service that never sees the grants still honours them.**
    `TokenService` takes the host's `IPermissionRegistry`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:66`) and emits one
    `AuthClaimTypes.Permission` claim (`permission`,
    `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:24`) per permission granted to
    the token's role, ordinally ordered and de-duplicated against claims the caller already supplied
    (`TokenService.cs:128-131`); because the registry it resolves is the layered one, stored grants are
    baked in alongside the compiled ones. Both authorization paths accept that claim: the CQRS
    `AuthorizationGate` passes a request whose permission the registry grants to the caller's roles OR
    that the principal carries as a claim
    (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/AuthorizationGate.cs:46-48`,
    over `ClaimsPrincipalExtensions.HasPermissionClaim`,
    `.../Shared/Auth/ClaimsPrincipalExtensions.cs:94`), and the UI gates a navigation entry on
    `NavItem.RequiredPermission`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:20`,
    `.../UI/Layout/NavMenu.razor:223-225`). The deployment consequence is a design rule, not framework
    code: where modules run as separate services, the host that mints tokens (the Identity service)
    registers every module's compiled grants so a token carries the full permission set, and the
    stored grants live only in that host, reaching the other services through the claims alone.
    Consumers therefore declare each module's role-to-permission grants in that module's Shared
    project and register them in both the module's own host and the Identity host. A permission change
    takes effect on the next sign-in, exactly like a role change.

## Rationale
Six shapes were considered for these four capabilities, and each rejection is what produced the
opt-in posture above:

- **Ship a framework `User` entity with two-factor and confirmation columns.** Rejected for the reason
  [ADR-032](032-password-hashing.md) rejected it for password material: the two deployed apps model
  users differently, and a framework table would either be ignored or force a migration nobody wants.
  The narrow-contract approach (`IAuthUser` and friends) is already proven across both apps.
- **Make the second factor a mandatory step in `AuthenticationServiceBase`, off by configuration.**
  Rejected: a mandatory step means the query and the code path run for every consumer, and a
  misconfiguration becomes a sign-in outage. An optional collaborator that is null makes the
  unadopted case unreachable rather than merely disabled.
- **Add a `HasMultiFactor` member to `ICurrentUserService`.** Rejected: the claim is already readable
  through the principal the interface exposes, and every implementation of that interface, including
  the hand-written test doubles, would have had to grow a member.
- **Let a stored grant deny a permission.** Rejected: a deny row makes the effective permission set
  depend on evaluation order and lets a data edit silently disable an endpoint the code guarantees.
  Removing a compiled-in capability stays a code change.
- **Load stored grants per role, on demand, inside `HasPermission`.** Rejected: the contract is
  synchronous, so this means blocking I/O on the hot path of every permission-gated request. A
  snapshot with explicit invalidation trades a bounded staleness window for no I/O at all.
- **Ship concrete administration controllers rather than bases.** Rejected for the reason
  `DataExportControllerBase` is a base: a concrete controller cannot construct the app's DTO or route
  itself into the app's URL space.

## Trade-offs
- A consumer that adopts nothing sees no behaviour change and no new configuration. The only edit that
  reaches an unadopted consumer is the widened `AuthenticationServiceBase` constructor, which is
  source-compatible (the new parameters are optional) and lands in the same release as the packages
  it ships with.
- Each piece is adopted separately, and adopting one does not drag in another. Two-factor works
  without stored grants, stored grants work without the administration API, and the API works with
  the compiled registry alone.
- Every consumer that wants two-factor writes one class: `ITwoFactorStore` over its own `User`, plus
  the columns behind `ITwoFactorUserState`. That is deliberate duplication, and it is the same trade
  the framework already made for `FindUntrackedByEmailAsync`: a framework-owned user table would cost
  more than the class it saves.
- Stored grants are per-process cached, so an edit made on one replica is live there immediately and
  reaches the others within `CacheSeconds` (default 300). A cross-replica push would put a broker on
  the authorization path; the window it would close is a grant taking effect a few seconds late,
  never a revoked grant outliving the interval.
- `EFPermissionGrantStore` hard-deletes a revoked grant, so it joins the framework's short
  soft-delete allowlist ([ADR-005](005-soft-delete-vs-erasure.md)). Consumers running the same
  fitness rule against the packages have to add the type to their own `AllowedHardDeleteTypes` when
  they upgrade.
- Adopting the `PermissionGrants` table is a migration in the consumer's Identity database, as
  `RefreshSessions` was. `AddStoredPermissionGrants(configuration)` is what maps it, and only in the
  context whose physical source `Authentication:PermissionGrants:DataSourceName` names
  (`.../Persistence/DbContexts/ApplicationDbContext.cs:910-915`), so a host that never opts in gets no
  table in any of its databases and an opted-in host gets it in exactly one.
- A permission granted by a stored row reaches another service only through a token claim, so it lands
  on the holder's next sign-in rather than within `CacheSeconds`. That is the same latency a role
  change has always had, and it is the price of keeping the grant table in one host instead of
  replicating it.

## Related
[ADR-020](020-permission-based-authorization.md) (the compiled role-to-permission registry stored
grants layer over),
[ADR-091](091-cache-backed-password-reset.md) (the token-service design email confirmation mirrors),
[ADR-032](032-password-hashing.md) (the narrow-contract precedent for keeping credential material in
the app's own user row),
[ADR-050](050-jwt-refresh-token-rotation.md) (the sign-in and token-rotation pipeline the `mfa` claim
rides),
[ADR-005](005-soft-delete-vs-erasure.md) (the soft-delete allowlist the grant store joins).
