# ADR-020: Permission-Based Authorization Layered over Roles

## Status
Accepted (2026-06-25, amended 2026-07-10 and 2026-08-23).

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
  (`MMCA.Common.Shared.Auth`) answer "does any of these roles grant this permission?" from an
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
  (`MMCA.Common.API/Authorization/AuthorizationExtensions.cs:23`) wires the handler, the policy
  provider, and an empty shared registry, so any host that configures authentication gets the
  mechanism for free; it grants nothing beyond explicit claims until a host calls
  `AddPermissions(...)`.
- **Framework-owned endpoints state a capability too.** The notification endpoints that ship in
  `MMCA.Common.API` carry `[HasPermission(NotificationPermissions.Manage)]`
  (`Controllers/Notifications/NotificationsController.cs:29`, the `notifications:manage` constant at
  `MMCA.Common.Shared/Notifications/NotificationPermissions.cs:10`), so which of a host's roles may
  broadcast is a grant that host makes rather than a role name the framework picked. ADC grants it to
  `Organizer` alone (`MMCA.ADC.Notification.API/DependencyInjection.cs:38`).

Adoption is asymmetric and that is intentional: a module declares as many capabilities as its own
surface needs. ADC's Conference module defines nine (`ConferencePermissions.cs:12-36`, enumerated in
`All` at `:39-50`), including a curation subset (`ContentManagement` at `:57-64`: sessions, speakers,
categories, sponsors, activities) granted to `RoleNames.ContentEditor`
(`MMCA.ADC.Conference.API/DependencyInjection.cs:50`); its Engagement module defines three
(`engagement:live:manage` gating the conference-day live-poll management endpoints,
`engagement:checkin:manage` gating QR badge check-in and the attendance rollup, and
`engagement:points:view-overview` gating the organizer points rollup, at
`EngagementPermissions.cs:16`, `:23`, `:30`), each granted to `Organizer` and `Admin`; and its
Identity module defines `identity:users:read`. MMCA.Store defines nine of its own across three
modules: four in Catalog (`CatalogPermissions.cs:12-21`), three in Sales
(`SalesPermissions.cs:12-18`) and two in Identity (`IdentityPermissions.cs:12-15`), each module
granting its whole set to `RoleNames.Admin` from its own `AddPermissions(...)` call
(`MMCA.Store.Catalog.API/DependencyInjection.cs:41`, `MMCA.Store.Sales.API/DependencyInjection.cs:40`,
`MMCA.Store.Identity.API/DependencyInjection.cs:42`). The registry, handler and policy provider are
covered by framework tests, and the ADC grant tables (Conference and Engagement) by dedicated grant
tests.

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
  signed-in user managing their own device installations, `DevicesController.cs:24`), which is what
  makes the inventory a judgement call rather than a rule a test could assert.
- **Grants must be registered before the host is built.** The registry is built once on first
  resolve; an `AddPermissions(...)` call after it has been materialized is not seen. Permission
  strings are also stringly-typed, mitigated by exposing them as constants (for example
  `ConferencePermissions`).

## Related
ADR-004 (the authenticated principal and claims this keys on, including the optional `permission`
claim), ADR-008 (each extracted service authorizes independently, so the registry is wired per
service host), ADR-013 / ADR-014 (capability checks at the edge keep the handlers thin).
