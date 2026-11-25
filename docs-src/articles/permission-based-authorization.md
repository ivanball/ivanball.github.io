# Permission-based authorization: capabilities over role checks

> Series: MMCA.Common · Article #24 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-020 ·
> Status: grounded in `Website/docs-src/adr/020-permission-based-authorization.md`, the
> `MMCA.Common.Shared/Auth/Permissions` + `MMCA.Common.API/Authorization` + `MMCA.Common.UI/Authorization`
> source, the framework `TokenService` permission claims, the `NamedPermissionsAreGranted` fitness rule,
> and the ADC and Store adoption. No em dashes.

**Subtitle:** `[Authorize(Roles = "Organizer")]` couples every endpoint to a role name. The day you need
a role that can do *most* of what an organizer does but not all of it, you are editing attributes across
the codebase. Here is the capability layer that turns that into a one-line grant.

---

You start with roles, because roles are what the framework hands you. An endpoint that only organizers
may call gets `[Authorize(Policy = "RequireOrganizer")]`, and that policy calls `RequireRole("Organizer")`.
Clean enough. You add `RequireAttendee`, `RequireAdmin`, `RequireAuthenticated`, and for a while the
mapping from "who is allowed" to "which attribute" is obvious.

Then the requirement arrives that role checks cannot express cleanly. You need a *content editor*: someone
who may curate the session catalog but must not manage events, rooms, feedback questions, or the organizer
session-selection workflow. An organizer can do all of those. The new role can do exactly one slice of them.

Now look at your options with role-name checks. You can add `ContentEditor` to every
`[Authorize(Roles = "Organizer")]` on the endpoints they *should* reach, and remember to leave it off the
ones they should not, across every controller. Or you can grant `ContentEditor` the `Organizer` role and
quietly over-permit them. Both are wrong. The first is an edit-everywhere sweep that drifts the moment
someone forgets one attribute; the second hands out capabilities you specifically decided to withhold.

The deeper problem is that the endpoint says the wrong thing. `[Authorize(Roles = "Organizer")]` declares
*who*, not *what*. It never states which capability the route actually exercises, so the same capability
guarded in five places drifts into five slightly different role lists.

## Why it matters

Authorization that is coupled to role names has a fixed failure mode: reshaping who-can-do-what means
touching endpoints. Every time the org chart of your application changes (a new role, a narrower role, a
capability that moves from one role to another), you are not changing a policy in one place, you are
sweeping attributes across controllers and hoping the test suite catches the one you missed.

What you want instead is for an endpoint to declare the **capability** it requires (a fine-grained,
named permission like `conference:sessions:manage`) and for the question of *which roles confer that
capability* to live in exactly one place. Then adding a content editor with a strict subset of the
organizer's powers is a single grant edit, not an endpoint hunt, at every layer that checks capabilities. The route keeps saying what it does;
only the grant table changes.

That is RBAC with one level of indirection: roles still exist, but endpoints depend on permissions, and
a registry maps the two. Permissions are the one authorization model MMCA.Common ships: an endpoint states
the capability it needs, the registry maps roles to capabilities, and no policy name has to be
pre-registered per role.

## The MMCA answer: a registry, a builder, an attribute, and the gates that read them

The capability layer is a small set of parts, and the design goal running through all of them is that the
mechanism grants nothing until a host opts in.

**The registry is the single source of truth.** `IPermissionRegistry` (in
`MMCA.Common.Shared.Auth.Permissions`) answers one question:
`HasPermission(IEnumerable<string> roles, string permission)`, does any of these roles grant this
capability? The implementation, `PermissionRegistry`, holds an immutable
`FrozenDictionary<string, FrozenSet<string>>` from role name to its granted permissions. Role keys are
compared case-insensitively (`OrdinalIgnoreCase`); permission values are compared ordinally. The same
class is also the host's `IPermissionCatalog`, exposing the closed set of roles and permissions the code
compiled in, so an administration screen enumerates the compiled map itself rather than a hand-kept second
list. It is the one place that knows the role-to-capability mapping, so no API endpoint's authorization
attribute names a role: no controller in either app carries `[Authorize(Roles = ...)]`. ADC's 28
conference management pages state a capability as well: they carry
`[HasPagePermission(ConferencePermissions.X)]` from `MMCA.Common.UI`, a claim-only check of the same
capability their API enforces. The remaining routable pages are a separate layer that the registry does
not govern: ADC's 14 other organizer pages (feature flags, the two feedback pages, check-in, attendance,
points, tickets, and the user, role, support-access and machine-client administration) carry
`[Authorize(Roles = RoleNames.Organizer)]`, and Store's 19 admin pages `[Authorize(Roles = RoleNames.Admin)]`.
(Endpoint code may still read a role for a business rule rather than a gate: ADC's
live-poll, question and bookmark controllers pass an organizer flag from `IsInRole(RoleNames.Organizer)`
to their handlers for the organizer bypass.)

**Modules declare grants additively.** `AddPermissions(...)` accumulates into a shared
`PermissionRegistryBuilder`. Each `Grant(string role, params string[] permissions)` unions the new
permissions into that role's set (`HashSet.UnionWith`), so grants from different modules combine and each
module declares only the permissions it owns. The registry is built lazily on first resolve, after every
module has contributed. A module hands the call a named `Apply` method rather than an inline lambda, which
puts the whole map for that module in one readable, testable place.

```csharp
// ADC Conference module registration: one line, pointing at the module's own grant map.
services.AddPermissions(ConferencePermissionGrants.Apply);

// ConferencePermissionGrants.Apply: the entire role-to-capability map for the module.
public static void Apply(PermissionRegistryBuilder permissions)
{
    // Organizer holds every Conference capability, plus the framework's feature-flag capability.
    permissions.Grant(RoleNames.Organizer, [.. ConferencePermissions.All, AdministrationPermissions.ManageFeatures]);

    // Content editors get ONLY the catalog-curation subset: no event structure, rooms,
    // questions, session selection, or speaker-account linking. The distinction role checks
    // cannot express lives in this one grant, not scattered across per-endpoint
    // [Authorize(Roles = ...)] lists.
    permissions.Grant(RoleNames.ContentEditor, [.. ConferencePermissions.ContentManagement]);
}
```

**Endpoints require a capability, not a role.** `[HasPermission("conference:sessions:manage")]` (a
`HasPermissionAttribute : AuthorizeAttribute`) names the capability. It maps to an on-demand policy named
`perm:{permission}` (`PermissionPolicy.NameFor`). `PermissionPolicyProvider` materializes that policy the
first time it is asked for (a `RequireAuthenticatedUser()` plus a `PermissionRequirement`), so there is no
per-permission policy registration. Every policy name that does not start with `perm:` falls through to
the `DefaultAuthorizationPolicyProvider`, so a host that hand-registers a named policy still gets it.

**The handler accepts two grant sources.** `PermissionAuthorizationHandler` succeeds when the principal
either carries the permission directly as a claim, or holds a role the registry grants it.

```csharp
// PermissionAuthorizationHandler: one evaluation, two ways to satisfy a capability.
internal static bool Holds(ClaimsPrincipal user, IPermissionRegistry? permissionRegistry, string permission) =>
    user.Identity?.IsAuthenticated == true
    && (user.HasPermissionClaim(permission)
        || permissionRegistry?.HasPermission(user.GetRoleValues(), permission) == true);

// HandleRequirementAsync
if (Holds(context.User, permissionRegistry, requirement.Permission))
{
    context.Succeed(requirement);
}
```

Both reads are framework-wide definitions rather than local helpers. `GetRoleValues()` gathers roles from
`ClaimTypes.Role`, `"role"`, and `"roles"`, so it works whether or not inbound-claim mapping is on; the
CQRS gate reads the same three claim types through `ICurrentUserService.Roles`. `HasPermissionClaim(...)`
is the single definition of "the token itself grants this": the HTTP handler and the CQRS gate call it
beside the registry check, and the Blazor page policy and navigation filter call it alone, because a UI
head holds no registry. The framework's
`TokenService` writes that claim at sign-in: every access token carries one `permission` claim for each
permission the minting host's registry grants the account's role. Both apps' Identity hosts apply every
module's grant map before minting (`AddTokenPermissionGrants()`), so a service that does not own a
module's grant map and the CQRS gate in that service both read the capability from the token rather than
from a registry they do not hold. The Blazor navigation reads it on both sides of a menu click: ADC's ten
conference management entries carry `RequiredPermission` with the same capability their pages require,
the framework's push-notifications link is gated on `notifications:manage`, and the feature-flag,
support-access and machine-client entries state a capability beside their role. ADC's remaining organizer
entries (check-in, attendance, points, tickets, users, roles) gate on the `Organizer` role, and Store's
admin entries on `Admin`.

**The same registry gates use cases, not just routes.** A command or query that implements
`IRequiresPermission` is checked by `AuthorizationGate.Evaluate` inside the CQRS decorator pipeline,
against that same registry and that same claim read, returning a `Forbidden` error rather than throwing.
So a capability holds at the HTTP boundary and at the application boundary from one declaration, which
matters for a handler reachable from more than one entry point.

## Inert until adopted

The piece that makes this safe to add to a framework everyone consumes is that wiring it confers nothing
until a host grants something. `AddAuthorizationPolicies()` always registers the handler (via
`TryAddEnumerable`), the policy provider (via `Replace`), and an empty registry, with `IPermissionRegistry`
and `IPermissionCatalog` both forwarding to that one built instance.
The same call also installs a fail-closed fallback policy, so an endpoint that declares no authorization
metadata at all requires an authenticated caller and a deliberate anonymous route says so with
`[AllowAnonymous]`. The capability mechanism itself still confers nothing beyond explicit claims until a
host calls `AddPermissions(...)`, and any policy name that is not a `perm:` name is delegated untouched.

Adoption is a per-module decision, and every module in both real apps has made it. ADC's Conference module
defines twelve capabilities, including the seven-member `ContentManagement` subset granted to its own
`ContentEditor` role (`conference:speakers:link` stays Organizer-only, because linking a speaker to a
user account confers a speaker identity); its Engagement module defines four (among them `engagement:live:manage`, granted to
`Organizer`, gating the organizer's event-wide live-poll list, while poll authoring is checked in the
handlers so a session's assigned speakers can run their own polls); its Notification module grants the
framework's own `notifications:manage` to `Organizer`; and its Identity module defines five, four of which
alias framework-owned capabilities from `AdministrationPermissions` (`ManageUsers`, `ManageRoles`,
`ViewAsUsers` and `ManageClients`) so the shared administration controller bases can carry their own
`[HasPermission]`. MMCA.Store defines eleven of its own
across Catalog, Sales and Identity, each module granting its whole set to its own `Admin` role from its own
`AddPermissions(...)` call. Both apps' Identity hosts also call `AddStoredPermissionGrants(...)`, which
decorates `IPermissionRegistry` with a `LayeredPermissionRegistry` (the compiled grants plus stored ones,
union only) while `IPermissionCatalog` keeps enumerating the compiled set. The role vocabulary stays the
application's throughout: MMCA.Common declares no role names at all. The registry, the catalog, the handler and the policy provider carry nineteen unit tests
between them (`PermissionRegistryTests`, `PermissionCatalogTests`, `PermissionAuthorizationHandlerTests`,
`PermissionPolicyProviderTests`), and the ADC grant maps carry dedicated grant tests of their own.

## Trade-offs, honestly

The capability indirection earns its keep on exactly the content-editor case, but it is still RBAC, and
the §11 review is explicit about the edges.

- **It is RBAC, not ABAC.** The model resolves role to permission; it does not evaluate resource or
  attribute conditions. "A customer may read only their own order" is a different concern (an
  `OwnerOrAdminFilter`), and a route that needs both composes the two. If most of your rules are
  per-resource ownership, a capability registry is not the tool you are missing.
- **A grant is only as good as the person who wrote it.** A missing or wrong `Grant(...)` denies or
  over-permits. Half of that is a build failure: the framework fitness rule behind
  `PermissionCoverageTestsBase`, which both apps subclass, fails the build when any permission a
  controller, page, MCP tool or menu entry names is granted to no role, so a gate nobody can pass never
  ships. The other half is not: the rule checks only that direction, so an over-permitting grant, or a
  grant to the wrong role, still compiles. The framework unit tests plus each app's own grant tests are
  the mitigation there.
- **Opt-in per endpoint.** A route that carries a plain `[Authorize]` states no capability and gets none
  of the benefit. This is the same audit-the-inventory caveat that soft-delete erasure and the
  `[Idempotent]` attribute carry: the mechanism is only as complete as your coverage of it.
- **Pages read the claim, not the registry.** In ADC the content-editor grant holds at both layers: a
  `ContentEditor` may call the session, speaker, category, sponsor, partner and activity endpoints, and
  the matching management pages and navigation entries gate on the same capabilities, so it sees and opens
  exactly the catalog screens its grant covers. The page check is claim-only, though, so it suits a host
  whose token issuer stamps permission claims; a role-only token never passes it. And the pages still
  gated on a role (ADC's conference-day, feedback and user and role administration pages, and every Store
  admin page) take a page-attribute and nav-entry edit to open to a new narrow role, which is exactly the
  sweep the API layer avoids.
- **Compiled grants are fixed at startup.** The registry is built once on first resolve, so an
  `AddPermissions(...)` call after it has materialized is not seen, which is the price of the immutable
  frozen map. Grants an operator can edit without a deploy are a separate layer on top of this one, and
  they are the subject of Article 52, "Finishing identity: second factor, email confirmation and stored
  permission grants". Permission strings are also stringly typed, mitigated by exposing them as constants
  (`ConferencePermissions`) rather than scattering literals.

None of these argue for going back to `[Authorize(Roles = ...)]` everywhere. They are the boundaries of
what a capability layer is for: it decouples endpoints from role names, and it stops there.

## Apply this even without MMCA

The pattern is portable to any policy-based authorization stack:

1. **Name capabilities, not roles, on the endpoint.** `sessions:manage` says what the route does;
   `Roles = "Organizer"` says who, and who changes more often than what.
2. **Put the role-to-capability map in one place.** A registry, a config table, a database, whatever you
   can read and change in a single edit. The whole value is that reshaping access is a grant change, not a
   controller sweep.
3. **Materialize the policy on demand.** A custom `IAuthorizationPolicyProvider` that builds a
   `perm:{name}` policy lazily means you never hand-register one policy per permission, and it can fall
   through to the default provider so any policy you do register by hand survives.
4. **Accept two grant sources.** Honor an explicit permission claim if the token carries one, and fall
   back to role-derived resolution if it does not. Whether you emit permission claims at sign-in is then a
   minting decision, not an endpoint change, and emitting them lets a service that holds no grant table
   still answer the question.
5. **Make it inert until used.** Register the mechanism with an empty registry so the feature is free to
   ship and confers nothing until a module actually grants a capability.

The takeaway: **an endpoint should declare the capability it needs, and the mapping from roles to
capabilities should live in exactly one editable place. Then, wherever the gate checks a capability, the
role you did not foresee is a one-line grant, not a sweep across every `[Authorize]` you ever wrote.**

---

**What we covered:** why role-name checks couple every endpoint to the org chart and cannot express a
narrow role like a content editor, how MMCA.Common's permission layer (an `IPermissionRegistry` of
role-to-permission grants that doubles as the `IPermissionCatalog`, an additive `AddPermissions` builder
fed by per-module grant maps, a `[HasPermission]` attribute that resolves to an on-demand `perm:` policy,
and two gates that accept an explicit claim or a role-derived grant: the HTTP handler and the CQRS
`AuthorizationGate`) decouples endpoints from roles, why it confers nothing until a host grants something,
and the honest limit that it is still RBAC, not resource-based authorization.

**Next in the series:** browser session-cookie auth for Blazor SSR, the join point that lets an `[Authorize]`
page survive an F5 without a non-validating scheme becoming your security boundary.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-020 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-020 (permission-based authorization): `Website/docs-src/adr/020-permission-based-authorization.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Security, Authorization*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`; findings from the
2026-11-25 `/update-medium` audit, each re-read at source in this pass). Changes in this pass: (1) the
page layer: 28 ADC conference management pages carry `[HasPagePermission(...)]` (Grep of ADC `*.razor`,
28 files under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/`), the attribute at
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Authorization/HasPagePermissionAttribute.cs:19`, claim-only
per `:8-15`, policy handler `MMCA.Common.UI/Authorization/PagePermissionAuthorizationHandler.cs:22`; ADR-020
revision 2026-11-04 at `Website/docs-src/adr/020-permission-based-authorization.md:317-333`. The "37
Organizer pages" count became 14 (Grep: `FeatureFlagList.razor:2`, `OrganizerEventFeedback.razor:2`,
`OrganizerSessionFeedback.razor:2`, `CheckInScan.razor:2`, `OrganizerAttendance.razor:2`,
`OrganizerPointsOverview.razor:2`, `TicketInsights.razor:2`, `TicketRoster.razor:2`, Identity
`RoleEdit.razor:2`, `RoleList.razor:2`, `MachineClients.razor:2`, `SupportAccess.razor:2`,
`UserDetail.razor:2`, `UserList.razor:2`); Store's 19 admin pages carry `[Authorize(Roles =
RoleNames.Admin)]` and none carries `[HasPagePermission]` or a `RequiredPermission` (Grep of
`MMCA.Store/Source`, e.g. `MMCA.Store.Catalog.UI/Pages/Products/ProductList.razor:4`). (2) Navigation:
ADC's ten management entries gate on `RequiredPermission: ConferencePermissions.X`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:79-88`, rationale
`:26-28`); feature flags carry role plus `ManageFeatures` (`:92`), support access and machine clients
role plus permission (`MMCA.ADC.Identity.UI/IdentityUIModule.cs:39,44`); Engagement entries and Users /
Roles stay role-only (`EngagementUIModule.cs:39-42`, `IdentityUIModule.cs:28,34`); the nav filter calls
`HasPermissionClaim` at `MMCA.Common.UI/Layout/NavMenu.razor.cs:127`. (3) "both gates call
`HasPermissionClaim`" widened to the page and nav checks; the single definition is still
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:95`, the two dual-source
gates are `PermissionAuthorizationHandler.cs:31` and `AuthorizationGate.cs:48`. (4) The "not enforced by a
fitness rule" trade-off is closed: `ArchitectureRules.NamedPermissionsAreGranted`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Api/ArchitectureRules.PermissionCoverage.cs:49`,
forward direction only per `:39-40`), subclassed by
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/PermissionCoverageTests.cs:35` and
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Api/PermissionCoverageTests.cs:34`; the bullet
now states the unchecked reverse direction. (5) The "governs the API, not the pages" trade-off became
"pages read the claim, not the registry": ContentEditor reaches the catalog pages (the page code-behinds
name `ContentEditor`, Grep of `MMCA.ADC.Conference.UI`, e.g. `Pages/Speakers/SpeakerList.razor.cs`). (6) The
grant code block's Organizer line matches
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissionGrants.cs:53`
(ContentEditor `:54`, the block still omits `ArgumentNullException.ThrowIfNull` at `:51`), registered at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:45`. (7) The handler
code block shows the shared `Holds` evaluation
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:29-32`)
and the `HandleRequirementAsync` call (`:42-45`); semantics unchanged. (8) Engagement defines four
permissions, not three (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Authorization/EngagementPermissions.cs:17,24,31,38`,
`All` `:41-47`). (9) Identity defines five, four of them framework aliases
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:13,26,41,52,64`,
`All` `:73-76`). Anchors moved: ADC `MMCA.ADC.Identity.Service/Program.cs` `AddTokenPermissionGrants`
`:242`, `AddStoredPermissionGrants` `:250`; Store `MMCA.Store.Identity.Service/Program.cs` `:107` and
`:111`. Carried from the 2026-11-25 audit's confirmed set without a fresh read in this pass: the
nineteen framework unit tests (6 + 6 + 4 + 3 across the four test classes), the Engagement Organizer
grant (`EngagementPermissionGrants.cs:42`) and the live-poll gate (`LivePollsController.cs:152`, plain
`[Authorize]` at `:40`), the Notification grant, Store's eleven permissions, and the registry, builder,
policy-provider, `TokenService`, `LayeredPermissionRegistry` and fallback-policy statements. Earlier
passes (2026-10-02, 2026-10-08, 2026-10-22, 2026-10-29) established the token-claim paragraph, the
twelve Conference capabilities with the Organizer-only `SpeakersLink`, the single-endpoint scope of
`engagement:live:manage`, the `IsInRole` organizer-bypass reads in ADC controllers, and the
`AddStoredPermissionGrants` layering; their anchors are superseded by the ones above where they moved.
RBAC-not-ABAC framing per `Website/docs-src/governance/common-ArchitectureScorecard.md` section 11.*

- Full series index: https://ivanball.github.io/writing.html
