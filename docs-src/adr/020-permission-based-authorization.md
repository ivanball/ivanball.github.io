# ADR-020: Permission-Based Authorization Layered over Roles

## Status
Accepted (2026-06-25, amended 2026-07-10 and 2026-08-23).
Revised 2026-09-07 (a fallback policy requiring an authenticated caller is on by default, so
anonymity has to be declared explicitly, and a fitness base enumerates endpoints that declare
nothing at all).
Revised 2026-09-09: [ADR-116](116-identity-completions-opt-in.md) layers OPTIONAL stored grants over the compiled
registry, through a decorator that unions a `(Role, Permission)` table into it with no deny row and a
cached per-role snapshot behind the synchronous read, so the compiled map stays the floor and a data
edit can only widen a role.
Revised 2026-09-19: capability counts re-enumerated from source. ADC's Conference module now defines
eleven permissions (`ActivitiesManage` and `SessionAssetsManage` added) and its `ContentManagement`
curation subset now carries seven members; MMCA.Store now defines eleven across its three modules,
Catalog having grown to six with `PricingManage` and `ReviewsModerate`.
Revised 2026-09-25: ADC's `IdentityPermissions.All` holds only the capability ADC defines
(`identity:users:read`) and its grant map names the framework's `ManageUsers` and `ManageRoles` beside
it, the declaration shape Store already used; the effective grants are unchanged. Grant-site citations
refreshed (both apps now declare grants in a Shared-project `*PermissionGrants` map).
Revised 2026-10-01: the role-vocabulary paragraph records where a host-supplied role string reaches
framework code beyond `AddPermissions(...)`.
Revised 2026-10-06: ADC's Conference module defines twelve permissions (`SpeakersLink` added,
Organizer-only), and the explicit-authorization-decision fitness gate is on by default with all four
repos held to it.
Revised 2026-10-26: the Decision paragraph names Store's `RolesManage` alias (outside `All`) and
records that both Identity grant maps name the framework administration capabilities by value,
partly through aliases; the ADC Notification registration anchor refreshed.
Revised 2026-10-28: anchors refreshed after edits to `NavMenu.razor` and
`ClaimsPrincipalExtensions.cs` moved the navigation-filter and `HasPermissionClaim` lines.
Revised 2026-11-04: Blazor pages gate on a capability with `[HasPagePermission(p)]`, the page-side
twin of `NavItem.RequiredPermission`; ADC's conference management pages adopt it.
Revised 2026-11-23: grant counts re-enumerated (ADC Engagement defines four permissions, ADC
Identity aliases four framework administration capabilities, and both apps' grant maps add framework
`ManageFeatures` or `ViewAuditTrail`), and the role-level second-factor setting is recorded as a
host-supplied role string that withholds a listed role, and the permission claims it alone carried,
from a validated bearer principal without MFA.
## Context
The default answer in ASP.NET Core is pure role-based access control (RBAC): an endpoint declares
`[Authorize(Policy = "RequireOrganizer")]` against a named policy that calls `RequireRole(...)`, and a
framework offering that model ships one such policy per role name it expects its hosts to use. That
couples every guarded endpoint to a role *name*, and it has two concrete failure modes:

- **Reshaping who-can-do-what means editing endpoints.** Splitting a coarse role into a narrower one
  (for example, a content editor who may curate the session catalog but not manage events, rooms, or
  the organizer session-selection workflow) forces either touching every affected `[Authorize]`
  attribute or granting the new role more than it should have.
- **The capability a route needs is implicit.** "Requires Organizer" does not say *which* capability
  the route exercises, so the same capability guarded in several places drifts.

Endpoints should depend on **capabilities** (fine-grained permissions) rather than role names, with
the role-to-capability mapping declared in one place, and a host should be free to invent whatever
roles its domain needs without the framework having an opinion on their names.

## Decision
Authorize on **capabilities resolved from roles**: a permission layer over RBAC, and the framework's
one authorization model. Nothing is pre-registered per role name.

- **A central registry maps roles to permissions.** `IPermissionRegistry` / `PermissionRegistry`
  (`MMCA.Common.Shared.Auth.Permissions`) answer "does any of these roles grant this permission?" from an
  immutable `FrozenDictionary` snapshot. It is the single place that knows which roles confer which
  capabilities, so endpoints stay decoupled from role names (role keys compared case-insensitively,
  permission values ordinally).
- **Modules declare grants additively.** `AddPermissions(builder => builder.Grant(role, ...))`
  (`MMCA.Common.API`) accumulates grants into one shared `PermissionRegistryBuilder`; grants from
  different modules union, so each module declares only the permissions it owns. The registry is
  built lazily on first resolve, after every module has contributed.
- **Endpoints require a capability, not a role.** `[HasPermission("conference:sessions:manage")]`
  (a `HasPermissionAttribute : AuthorizeAttribute`) names the capability. It maps to an on-demand
  authorization policy named `perm:{permission}`: `PermissionPolicyProvider` materializes that policy
  (`RequireAuthenticatedUser()` + a `PermissionRequirement`) the first time it is requested, so there
  is no per-permission named-policy registration. Every non-`perm:` policy name falls through to
  `DefaultAuthorizationPolicyProvider` (`PermissionPolicyProvider.cs:35-38`), so a policy a host
  registers itself still resolves the usual way; the framework registers none.
- **Two grant sources.** `PermissionAuthorizationHandler` succeeds when the principal carries the
  permission directly (an explicit `AuthClaimTypes.Permission` claim, `"permission"`) **or** holds a
  role the registry grants it (roles gathered from `ClaimTypes.Role`, `"role"`, or `"roles"` so it
  works whether or not inbound-claim mapping is on). Baking permissions into the token is therefore
  optional: role-derived resolution is the default.
- **Grants are the host's to declare.** `AddAuthorizationPolicies()`
  (`MMCA.Common.API/Authorization/AuthorizationExtensions.cs:30`) wires the handler, the policy
  provider, an empty shared registry and the role-level second-factor requirement (`:84`, inert
  while its role list is empty), so any host that configures authentication gets the mechanism for
  free; it grants nothing beyond explicit claims until a host calls `AddPermissions(...)`.
- **Framework-owned endpoints state a capability too.** The notification endpoints that ship in
  `MMCA.Common.API` carry `[HasPermission(NotificationPermissions.Manage)]`
  (`Controllers/Notifications/NotificationsController.cs:29`, the `notifications:manage` constant at
  `MMCA.Common.Shared/Notifications/NotificationPermissions.cs:10`), so which of a host's roles may
  broadcast is a grant that host makes rather than a role name the framework picked. ADC grants it to
  `Organizer` alone (`MMCA.ADC.Notification.Shared/Authorization/NotificationPermissionGrants.cs:38`,
  applied from `MMCA.ADC.Notification.API/DependencyInjection.cs:46`).

Adoption is asymmetric and that is intentional: a module declares as many capabilities as its own
surface needs. ADC's Conference module defines twelve (`ConferencePermissions.cs:12-55`, enumerated in
`All` at `:58-72`; the twelfth, `SpeakersLink` at `:55`, is Organizer-only and deliberately kept out of
the curation subset), including a curation subset (`ContentManagement` at `:79-88`: sessions, speakers,
categories, sponsors, partners, activities, session assets) granted to the app's own `ContentEditor` role constant
(`MMCA.ADC.Conference.Shared/Authorization/ConferencePermissionGrants.cs:54`), while `Organizer` holds
the whole set plus the framework's `AdministrationPermissions.ManageFeatures` (`:53`, applied from
`MMCA.ADC.Conference.API/DependencyInjection.cs:45`); its Engagement module defines four
(`engagement:live:manage` gating the conference-day live-poll management endpoints,
`engagement:checkin:manage` gating QR badge check-in and the attendance rollup,
`engagement:points:view-overview` gating the organizer points rollup, and
`engagement:tickets:manage` for the ticket roster, at `EngagementPermissions.cs:17`, `:24`, `:31`,
`:38`, all four in `All` at `:41-47`), granted to `Organizer` together with `ManageFeatures`
(`EngagementPermissionGrants.cs:42`); and its Identity module defines `identity:users:read`, the only
member of its `IdentityPermissions.All`
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:13`, `All` at `:73-76`). Four
framework administration capabilities are aliased there (`UsersManage` at `:26`, `RolesManage` at
`:41`, `UsersViewAs` at `:52`, `ClientsManage` at `:64`) but stay out of `All`, because `All` lists
only the capabilities ADC itself defines; the module's grant map hands `Organizer` the module set
plus those four by name and the framework's `AdministrationPermissions.ViewAuditTrail`
(`IdentityPermissionGrants.cs:42-51`, applied from
`MMCA.ADC.Identity.API/DependencyInjection.cs:49`). MMCA.Store defines eleven of its own across three
modules: six in Catalog (`CatalogPermissions.cs:12-36`), three in Sales
(`SalesPermissions.cs:12-18`) and two in Identity (`IdentityPermissions.cs:14` and `:21`, `All` at
`:38`; a third constant, `RolesManage` at `:35`, aliases the framework's `ManageRoles` and stays
out of `All`), each module granting its whole set plus the framework's
`AdministrationPermissions.ViewAuditTrail` to its own `Admin` role constant from a grant map in its
Shared project (`CatalogPermissionGrants.cs:31`, `SalesPermissionGrants.cs:31`,
`IdentityPermissionGrants.cs:35-37`) that its API registration passes to `AddPermissions(...)`
(`MMCA.Store.Catalog.API/DependencyInjection.cs:45`, `MMCA.Store.Sales.API/DependencyInjection.cs:52`,
`MMCA.Store.Identity.API/DependencyInjection.cs:66`). Both Identity grant maps name the framework
administration capabilities beside the module's own `All` explicitly, by value rather than always by
the framework constant: ADC names its four through its aliases next to
`AdministrationPermissions.ViewAuditTrail` (`IdentityPermissionGrants.cs:46-50`), and Store names
`AdministrationPermissions.ManageUsers` and `ViewAuditTrail` directly and `ManageRoles` through its
`RolesManage` alias (`IdentityPermissionGrants.cs:37`). The registry, handler and
policy provider are covered by framework tests, and the ADC grant tables (Conference, Engagement and
Identity) by dedicated grant tests
(`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Shared.Tests/Authorization/IdentityPermissionGrantsTests.cs:24`,
`:49`).

**Role vocabulary is the app's, not the framework's.** MMCA.Common declares no role names at all: a
role string reaches framework code only when a host supplies it, as the key it hands to
`AddPermissions(...)` or as a role-valued setting on a framework gate. The framework's own
navigation entries gate on `NavItem.RequiredPermission`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:20`, matched against the
`permission` claim at `.../UI/Layout/NavMenu.razor.cs:127`), the notification entry on
`NotificationPermissions.Manage`
(`.../UI/Notifications/NotificationUIModule.cs:20`). The role-valued settings are all host-supplied
and empty by default: the signed-in-devices entry narrows to `LayoutSettings.SessionsNavRequiredRole`
when one is configured (`.../UI/Common/Settings/LayoutSettings.cs:39`, checked with `IsInRole` at
`.../UI/Layout/NavMenu.razor.cs:120-121`), a host's own `NavItem.RequiredRole` is honoured (`:125`),
the roles that must present a second factor are a host-supplied list
(`Authorization:MultiFactor:RequiredForRoles`,
`.../API/Authorization/MultiFactor/MultiFactorAuthorizationSettings.cs:34`), the
owner-or-admin bypass role is required configuration a host supplies
(`OwnerOrAdminFilterOptions.BypassRole`, `.../API/Authorization/OwnerOrAdminFilterOptions.cs:24`;
[ADR-033](033-resource-ownership-authorization.md)), the public output-cache policy takes its bypass
roles as an argument (`.../API/Caching/OutputCacheOptionsExtensions.cs:34`), and the UI test
helper takes the role as an argument
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:41`). So each app
owns its `RoleNames` constants in its Identity module's Shared project and each module's grants map
those constants to that module's permissions.

**Access tokens carry the capabilities, and both gates honour them.** `TokenService` resolves the
host's `IPermissionRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:74`) and writes one
`permission` claim (`AuthClaimTypes.Permission`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:24`) per permission granted to the
token's role, ordinally ordered and never duplicating a claim the caller already supplied
(`TokenService.cs:163-171`); stored grants ([ADR-116](116-identity-completions-opt-in.md)) ride along
because the registry it resolves is the layered one. The HTTP policy handler evaluates the same
capability through the registry, and the CQRS `AuthorizationGate` passes a request whose permission
the registry grants to the caller's roles OR that the principal carries as a claim
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/AuthorizationGate.cs:46-48`,
over `ClaimsPrincipalExtensions.HasPermissionClaim`, `.../Shared/Auth/ClaimsPrincipalExtensions.cs:95`).
One qualification: when a host lists a role under `Authorization:MultiFactor:RequiredForRoles` and
the session carries no `mfa` claim, the API withholds that role, and the permission claims it alone
carried, from the validated bearer principal, marking each with `MultiFactorWithheldRole` /
`MultiFactorWithheldPermission` (`.../Shared/Auth/AuthClaimTypes.cs:78-96`); the token still carries
them, but the request's principal goes without them until a second factor is presented.

That claim is what makes the model work when the modules run as separate services. The host that mints
tokens (the Identity service) has to register every module's compiled grants, so a token carries the
full permission set rather than only the Identity module's; stored grants live in that one host and
reach the other services through the claims alone. A module therefore declares its role-to-permission
grants in its own Shared project and registers them twice: in its own host, and in the Identity host.
A permission change is visible after the next sign-in, exactly like a role change.

## Rationale
- **Capabilities decouple endpoints from roles.** A route says what it *does*
  (`conference:sessions:manage`), and who may do it is a registry decision, so adding `ContentEditor`
  with a strict subset of the organizer's capabilities is a grant change, not an endpoint sweep. That
  subset is exactly the distinction role checks cannot express cleanly and is what makes the
  indirection earn its keep.
- **One place to read and change policy.** Grants live in module registration, not scattered across
  controllers; the registry is immutable and thread-safe once built.
- **Grants compose per module.** The per-module union means no module needs to know another's
  permissions, and a module that declares none contributes nothing, so a host takes the model on
  module by module rather than in one sweep.

## Trade-offs
- **It is still RBAC, not ABAC.** The model resolves role to permission; it does not evaluate
  resource or attribute conditions. Per-resource ownership ("a customer may read only their own
  data") stays a separate concern (`OwnerOrAdminFilter`), and a route needing both composes the two.
- **Another indirection to keep honest.** A capability check is only as good as its grant; a missing
  or wrong `Grant(...)` silently denies or over-permits. The registry tests are the mitigation, but
  the mapping is declared in code and is not enforced by a fitness rule.
- **Opt-in per endpoint.** A route that should state a capability but carries a bare `[Authorize]` is
  authenticated-only, and nothing flags it: the same audit-the-inventory caveat as ADR-005
  (`IAnonymizable`) and ADR-017 (`[Idempotent]`). Some routes are deliberately in that category (a
  signed-in user managing their own device installations, `DevicesController.cs:25`), which is what
  makes the inventory a judgement call rather than a rule a test could assert.
- **Grants must be registered before the host is built.** The registry is built once on first
  resolve; an `AddPermissions(...)` call after it has been materialized is not seen. Permission
  strings are also stringly-typed, mitigated by exposing them as constants (for example
  `ConferencePermissions`).

## Revision (2026-09-07)
Permission-based authorization is unchanged. What changed is the **default for an endpoint that
declares nothing** (SEC-Common-16 / SEC-ADC-03).

1. **An undecorated endpoint now requires an authenticated caller.** `AddAuthorizationPolicies`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:25`,
   and the configurable overload at `:60`) registers `FallbackAuthorizationHandler`
   (`:81`; class at
   `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:15`)
   and sets `AuthorizationOptions.FallbackPolicy` from the bound options (`:86-89`).
   `FallbackAuthorizationOptions.Enabled` defaults to `true`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:52`).
   Framework and static surfaces are exempt by path prefix rather than by attribute:
   `DefaultExemptPathPrefixes` (`:21`) covers the Blazor framework files and circuit, static asset
   roots, health probes and well-known documents, and a host can extend the list through
   `ExemptPathPrefixes` (`:61`). The documented opt-out is
   `AddAuthorizationPolicies(options => options.Enabled = false)` (`AuthorizationExtensions.cs:43`).
2. **The rule this makes explicit: declare anonymity.** Public means `[AllowAnonymous]` or
   `.AllowAnonymous()` on the endpoint, not the absence of an attribute. The framework's own public
   surface says so (the `OAuthControllerBase` challenge and completion actions, the credential and
   landing pages in `MMCA.Common.UI`, the Aspire health endpoints). A YARP gateway is the one host
   that cannot express it as an attribute: a proxied route carries no endpoint metadata of its own,
   so a public route declares `"AuthorizationPolicy": "anonymous"` in its route config. A Blazor page
   is unaffected at the component level, because `AuthorizeRouteView` reads attributes and ignores
   the fallback policy.
3. **A fitness gate that can see the undecorated case.** `AnonymousEndpointTestsBase` already
   allow-listed endpoints marked `[AllowAnonymous]`; it now also enumerates every concrete controller
   and routable page carrying **no** authorization attribute at all and asserts that set against a
   second allow-list: `Endpoints_DeclareAnAuthorizationDecision`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Api/AnonymousEndpointTestsBase.cs:118`),
   opted into per repo through `RequireExplicitAuthorizationDecision` (`:68`, default `false`), with
   the allow-list at `:76` and a staleness check at `:141`. MMCA.Common holds itself to it. The
   opt-in is deliberate: a consumer adopting the fallback policy fixes its endpoints first and turns
   the gate on last, and until then the runtime behaviour is already the safe one.

## Revision (2026-10-01)
No decision or rationale changed: the framework still declares no role names and still gates its own
endpoints and navigation on capabilities. The role-vocabulary paragraph now records accurately where a
host-supplied role string reaches framework code beyond `AddPermissions(...)`: the optional
`LayoutSettings.SessionsNavRequiredRole`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:39`, read at
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:249-250`), a host's
`NavItem.RequiredRole` (`NavMenu.razor:254`), `OwnerOrAdminFilterOptions.BypassRole`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:24`) and
the output-cache bypass roles
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:34`).
Citations refreshed: the registry namespace (`MMCA.Common.Shared.Auth.Permissions`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/PermissionRegistry.cs:3`),
`AuthorizationExtensions.cs:25`, `NavMenu.razor:256`, and `TokenService.cs:73` and `:133-141`.

## Revision (2026-10-06)
- ADC's Conference module now defines twelve permissions, not eleven: `SpeakersLink`
  (`conference:speakers:link`, `ConferencePermissions.cs:55`) is granted to `Organizer` through `All`
  (`:58-72`, `ConferencePermissionGrants.cs:47`) and kept out of `ContentManagement` (`:79-88`, still
  seven members). The Decision paragraph is updated.
- The explicit-authorization-decision gate recorded in the 2026-09-07 revision is on by default, not
  opt-in: `RequireExplicitAuthorizationDecision` defaults to `true`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Api/AnonymousEndpointTestsBase.cs:69`)
  and a repo opts out by overriding it to `false` (early return at `:121-125`). All four repos hold
  themselves to it, each overriding it to `true` explicitly: MMCA.Common
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:71`),
  MMCA.ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs:139`),
  MMCA.Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Api/AnonymousEndpointTests.cs:86`)
  and MMCA.Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/AnonymousEndpointTests.cs:45`).
  Current locations in that base: `Endpoints_DeclareAnAuthorizationDecision` at `:119`, the
  `EndpointsWithoutAuthorizationAttribute` allow-list at `:77`, the staleness check
  `UndecoratedAllowList_HasNoStaleEntries` at `:137`.
- Current locations for the fallback-policy facts recorded in the 2026-09-07 revision: in
  `AuthorizationExtensions.cs` the configurable overload is at `:62`, the `FallbackAuthorizationHandler`
  registration at `:82-83`, the `FallbackPolicy` assignment at `:89` and the `Enabled = false` opt-out
  documentation at `:45`; the handler class is at `Fallback/FallbackAuthorizationHandler.cs:32`, and
  `ExemptPathPrefixes` at `Fallback/FallbackAuthorizationOptions.cs:64`.
- Current `NavMenu.razor` locations for the role-vocabulary facts recorded on 2026-10-01: the permission
  filter at `:259`, `SessionsNavRequiredRole` read and checked with `IsInRole` at `:252-253`, the
  `NavItem.RequiredRole` filter at `:257`.
- Anchors in the live sections were re-verified against current source.

## Revision (2026-10-26)
Re-verified against current source. The decision, the grant model and every permission count are
unchanged; the Decision paragraph now names a Store alias it omitted and one live anchor moved. The
2026-09-07 and 2026-10-01 revisions keep their dated anchors as written; the 2026-10-06 revision
already records the current locations for both.

1. Store's Identity module carries a third constant beside its two permissions: `RolesManage`
   (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Authorization/IdentityPermissions.cs:31`)
   aliases `AdministrationPermissions.ManageRoles` and stays out of `All` (`:34-38`). Store's grant
   map names that alias rather than the framework constant, beside
   `AdministrationPermissions.ManageUsers`
   (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Authorization/IdentityPermissionGrants.cs:37`),
   while ADC names both of its aliases
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissionGrants.cs:38`).
   The effective grants are the same framework values; the Decision paragraph now says so literally.
2. Anchors re-verified against current source: the ADC Notification grant is applied from
   `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:46`.

## Revision (2026-10-28)
Re-verified against current source. The decision, the grant model, every permission count and the
navigation filtering behaviour are unchanged; only live anchors moved. The earlier dated revisions
keep their anchors as written.

1. Anchors re-verified against current source: in
   `MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor` the
   `SessionsNavRequiredRole` read and `IsInRole` check sit at `:258-259`, the `NavItem.RequiredRole`
   filter at `:263` and the `RequiredPermission` filter (over `HasPermissionClaim`) at `:265`;
   `HasPermissionClaim` is declared at
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:95`.

## Revision (2026-11-04)
A Blazor page gates on a capability with `[HasPagePermission(p)]` from `MMCA.Common.UI`, usable in
every UI head. `AddUIShared` registers one `page-perm:<p>` policy per permission declared on a
component in `MMCA.Common.UI` or a registered UI module's assembly, discovered when the
authorization options are first built, so a host adds a guarded page with no registration call. The
policy requires an authenticated caller and checks `HasPermissionClaim`, the same check
`NavItem.RequiredPermission` makes, so a menu entry and the page it opens agree. It reads the claim
only, because a UI head has no permission registry; it suits a host whose token issuer stamps
permission claims, as ADC's Identity host does. ADC's conference management pages carry
`[HasPagePermission(ConferencePermissions.X)]` with the capability their API enforces, so a
ContentEditor opens exactly the catalog pages its grant covers.

Rejected: reusing the API's `[HasPermission]`, because MMCA.Common.UI may not reference the API
package and the MAUI head never loads it; and a UI policy provider for the `perm:` prefix, because
`AddAuthorizationPolicies` installs the API provider with `Replace` and the two would compete in a
web host that wires both. The distinct `page-perm:` prefix falls through the API provider to the
default one, which reads the registered policy.

## Revision (2026-11-23)
Re-verified against current source. The decision, the grant model, the fallback policy and the
explicit-authorization-decision gate are unchanged; several grant tables grew and one host-supplied
role setting was missing from the Decision. The earlier dated revisions keep their anchors as written.

1. ADC's Engagement module defines four permissions, not three: `TicketsManage`
   (`engagement:tickets:manage`,
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Authorization/EngagementPermissions.cs:38`)
   joins the other three in `All` (`:41-47`).
2. ADC's Identity module aliases four framework administration capabilities, all outside `All`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:26`,
   `:41`, `:52`, `:64`; `All` at `:73-76`), and its grant map hands `Organizer` all four plus
   `AdministrationPermissions.ViewAuditTrail`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissionGrants.cs:42-51`).
3. Grants now add framework capabilities beside a module's own set: ADC's Conference and Engagement
   maps grant `Organizer` `AdministrationPermissions.ManageFeatures`
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissionGrants.cs:53`,
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Authorization/EngagementPermissionGrants.cs:42`),
   and every Store grant map grants `Admin` `AdministrationPermissions.ViewAuditTrail`
   (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Authorization/CatalogPermissionGrants.cs:31`,
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Authorization/SalesPermissionGrants.cs:31`,
   `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Authorization/IdentityPermissionGrants.cs:37`).
   The Decision paragraph no longer says the two Identity grant maps have the same shape.
4. `AddAuthorizationPolicies` also wires the role-level second-factor requirement
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:84`),
   driven by the host-supplied, empty-by-default `Authorization:MultiFactor:RequiredForRoles`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/MultiFactor/MultiFactorAuthorizationSettings.cs:34`).
   A listed role, and the permission claims it alone carried, are withheld from a bearer principal
   without the `mfa` claim
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/MultiFactor/MultiFactorRoleWithholding.cs:72`,
   `:81-83`, `:96`), which records them under the markers
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:89` and `:96`
   (`MultiFactorRoleWithholding.cs:87-88`). The
   role-vocabulary and access-token paragraphs now record it.
5. Anchors re-verified against current source: `AuthorizationExtensions.cs` parameterless overload
   `:30`, configurable overload `:67`, `Enabled = false` opt-out documentation `:50`,
   `FallbackAuthorizationHandler` registration `:92-93`, `FallbackPolicy` assignment `:97-103`; the
   handler class at `Fallback/FallbackAuthorizationHandler.cs:35`; `FallbackAuthorizationOptions.cs`
   `DefaultExemptPathPrefixes` `:21`, `Enabled` `:52`, `ExemptPathPrefixes` `:64`. The navigation
   filters moved to the code-behind,
   `MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor.cs`: the
   `SessionsNavRequiredRole` read and `IsInRole` check at `:120-121`, the `NavItem.RequiredRole`
   filter at `:125`, the `RequiredPermission` filter over `HasPermissionClaim` at `:127`.
   `TokenService.cs` takes `IPermissionRegistry` at `:74` and emits permission claims at `:163-171`.
   In `AnonymousEndpointTestsBase.cs`: `RequireExplicitAuthorizationDecision` (default `true`) `:73`,
   `EndpointsWithoutAuthorizationAttribute` `:81`, `Endpoints_DeclareAnAuthorizationDecision` `:123`
   with its opt-out early return at `:125-129`, `UndecoratedAllowList_HasNoStaleEntries` `:141`; each
   repo still overrides the gate to `true` explicitly (MMCA.Common
   `Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:87`, MMCA.ADC
   `Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs:143`, MMCA.Store
   `Tests/Architecture/MMCA.Store.Architecture.Tests/Api/AnonymousEndpointTests.cs:127`, MMCA.Helpdesk
   `Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/AnonymousEndpointTests.cs:52`). Grant-site
   anchors: Conference `ContentEditor` `ConferencePermissionGrants.cs:54` and its registration at
   `MMCA.ADC.Conference.API/DependencyInjection.cs:45`; ADC Identity registration at
   `MMCA.ADC.Identity.API/DependencyInjection.cs:49`; Store Identity `RolesManage` at
   `IdentityPermissions.cs:35` and `All` at `:38`; the ADC grant test
   `All_ListsOnlyTheCapabilitiesAdcDefines` at `IdentityPermissionGrantsTests.cs:49`.

## Related
ADR-004 (the authenticated principal and claims this keys on, including the optional `permission`
claim), ADR-008 (each extracted service authorizes independently, so the registry is wired per
service host), ADR-013 / ADR-014 (capability checks at the edge keep the handlers thin).
