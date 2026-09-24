# Permission-based authorization: capabilities over role checks

> Series: MMCA.Common · Article #24 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-020 ·
> Status: grounded in `Website/docs-src/adr/020-permission-based-authorization.md`, the
> `MMCA.Common.Shared/Auth/Permissions` + `MMCA.Common.API/Authorization` source, and the ADC and
> Store adoption. No em dashes.

**Subtitle:** `[Authorize(Roles = "Organizer")]` couples every endpoint to a role name. The day you need
a role that can do *most* of what an organizer does but not all of it, you are editing attributes across
the codebase. Here is the capability layer that turns that into a one-line grant.

---

You start with roles, because roles are what the framework hands you. An endpoint that only organizers
may call gets `[Authorize(Policy = "RequireOrganizer")]`, and that policy calls `RequireRole("Organizer")`.
Clean enough. You add `RequireAttendee`, `RequireAdmin`, `RequireAuthenticated`, and for a while the
mapping from "who is allowed" to "which attribute" is obvious.

Then the requirement arrives that role checks cannot express cleanly. You need a *content editor*: someone
who may curate the session catalog but must not manage events, rooms, the question queue, or the organizer
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
organizer's powers is a single grant edit, not an endpoint hunt. The route keeps saying what it does;
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
compiled in, so an administration screen enumerates a projection of the map that authorizes rather than a
second list that can drift from it. It is the one place that knows the role-to-capability mapping, so
endpoints never name a role.

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
    permissions.Grant(RoleNames.Organizer, [.. ConferencePermissions.All]);

    // Content editors get ONLY the catalog-curation subset: no event structure, rooms,
    // questions, or session selection. The distinction role checks cannot express lives
    // in this one grant, not scattered across per-endpoint [Authorize(Roles = ...)] lists.
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
// PermissionAuthorizationHandler.HandleRequirementAsync: two ways to satisfy a capability.
if (context.User.Identity?.IsAuthenticated != true)
{
    return Task.CompletedTask;
}

if (context.User.HasPermissionClaim(requirement.Permission)
    || permissionRegistry.HasPermission(context.User.GetRoleValues(), requirement.Permission))
{
    context.Succeed(requirement);
}
```

Both reads are framework-wide definitions rather than local helpers. `GetRoleValues()` gathers roles from
`ClaimTypes.Role`, `"role"`, and `"roles"`, so it works whether or not inbound-claim mapping is on, and it
is the framework's single definition of "the caller's roles", so no other reader can disagree with the
handler about who is privileged. `HasPermissionClaim(...)` is the single definition of "the token itself
grants this". Baking a `permission` claim into the token is therefore optional: role-derived resolution is
the default, and a token that already carries explicit permissions short-circuits the registry lookup.

**The same registry gates use cases, not just routes.** A command or query that implements
`IRequiresPermission` is checked by `AuthorizationGate.Evaluate` inside the CQRS decorator pipeline,
against that same registry and that same claim read, returning a `Forbidden` error rather than throwing.
So a capability holds at the HTTP boundary and at the application boundary from one declaration, which
matters for a handler reachable from more than one entry point.

## Inert until adopted

The piece that makes this safe to add to a framework everyone consumes is that wiring it confers nothing
until a host grants something. `AddAuthorizationPolicies()` always registers the handler (via
`TryAddEnumerable`), the policy provider (via `Replace`), and an empty registry, which is bound as both
`IPermissionRegistry` and `IPermissionCatalog` so the two contracts can never answer from different maps.
The same call also installs a fail-closed fallback policy, so an endpoint that declares no authorization
metadata at all requires an authenticated caller and a deliberate anonymous route says so with
`[AllowAnonymous]`. The capability mechanism itself still confers nothing beyond explicit claims until a
host calls `AddPermissions(...)`, and any policy name that is not a `perm:` name is delegated untouched.

Adoption is a per-module decision, and every module in both real apps has made it. ADC's Conference module
defines eleven capabilities, including the seven-member `ContentManagement` subset granted to its own
`ContentEditor` role; its Engagement module defines three (among them `engagement:live:manage`, granted to
`Organizer`, gating the conference-day live-poll management endpoints); its Notification module grants the
framework's own `notifications:manage` to `Organizer`; and its Identity module defines three, two of which
alias the framework-owned `users:manage` and `roles:manage` from `AdministrationPermissions` so the shared
administration controller bases can carry their own `[HasPermission]`. MMCA.Store defines eleven of its own
across Catalog, Sales and Identity, each module granting its whole set to its own `Admin` role from its own
`AddPermissions(...)` call. The role vocabulary stays the application's throughout: MMCA.Common declares no
role names at all. The registry, the catalog, the handler and the policy provider carry nineteen unit tests
between them (`PermissionRegistryTests`, `PermissionCatalogTests`, `PermissionAuthorizationHandlerTests`,
`PermissionPolicyProviderTests`), and the ADC grant maps carry dedicated grant tests of their own.

## Trade-offs, honestly

The capability indirection earns its keep on exactly the content-editor case, but it is still RBAC, and
the §11 review is explicit about the edges.

- **It is RBAC, not ABAC.** The model resolves role to permission; it does not evaluate resource or
  attribute conditions. "A customer may read only their own order" is a different concern (an
  `OwnerOrAdminFilter`), and a route that needs both composes the two. If most of your rules are
  per-resource ownership, a capability registry is not the tool you are missing.
- **A grant is only as good as the person who wrote it.** A missing or wrong `Grant(...)` silently denies
  or over-permits. The framework unit tests plus each app's own grant tests are the mitigation, but the
  mapping is declared in code and is *not* enforced by a fitness rule, unlike the layer dependencies
  elsewhere in this framework. That is an honest asymmetry with the project's own "make it a build
  failure" thesis.
- **Opt-in per endpoint.** A route that carries a plain `[Authorize]` states no capability and gets none
  of the benefit. This is the same audit-the-inventory caveat that soft-delete erasure and the
  `[Idempotent]` attribute carry: the mechanism is only as complete as your coverage of it.
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
   back to role-derived resolution if it does not. That keeps tokens small by default and lets you push
   permissions into the token later without changing endpoints.
5. **Make it inert until used.** Register the mechanism with an empty registry so the feature is free to
   ship and confers nothing until a module actually grants a capability.

The takeaway: **an endpoint should declare the capability it needs, and the mapping from roles to
capabilities should live in exactly one editable place. Then the role you did not foresee is a one-line
grant, not a sweep across every `[Authorize]` you ever wrote.**

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

*Notes: re-verified against source this run (MMCA.Common v1.205.0, `FACTS.md:14`). 2026-09-19 audit pass:
the permission types moved into `MMCA.Common.Shared.Auth.Permissions`, the registry gained a second
contract, a second gate reads it, and both real apps adopt it, so the section heading, the registry
paragraph, the registration code block, the handler code block, the inert-until-adopted paragraph, the
adoption paragraph, the test count and three trade-off bullets were rewritten; the `RoleNames` and
`GetRoles` citations were wrong and are replaced. Verified names and anchors: `IPermissionRegistry`
(interface at `Source/Core/MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:14`,
`GetPermissions(string)` at `:21`, `HasPermission(IEnumerable<string>, string)` at `:29`),
`PermissionRegistry : IPermissionRegistry, IPermissionCatalog` (`Auth/Permissions/PermissionRegistry.cs:16`)
with the `FrozenDictionary<string, FrozenSet<string>>` field at `:20`, built `OrdinalIgnoreCase` over
ordinal sets at `:33-36`; `IPermissionCatalog.Roles` / `.Permissions`
(`Auth/Permissions/IPermissionCatalog.cs:24,27,30`); `PermissionRegistryBuilder.Grant(string, params string[])`
unioning via `HashSet.UnionWith` (`Auth/Permissions/PermissionRegistryBuilder.cs:8,25,34`);
`AdministrationPermissions.ManageUsers = "users:manage"` and `ManageRoles = "roles:manage"`
(`Auth/Permissions/AdministrationPermissions.cs:15,18,21`); `HasPermissionAttribute : AuthorizeAttribute`
with `Permission` (`MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13,21`);
`PermissionPolicy.Prefix = "perm:"` + `NameFor` (`PermissionPolicy.cs:12,17`);
`PermissionPolicyProvider.GetPolicyAsync` (`:31`), non-`perm:` fall-through to
`DefaultAuthorizationPolicyProvider` (`:35-38`), on-demand `RequireAuthenticatedUser` +
`PermissionRequirement` build (`:41-45`); `PermissionRequirement.Permission`
(`PermissionRequirement.cs:10,21`); `PermissionAuthorizationHandler` (`:13`) with the two-source body at
`:24-33` (`context.User.HasPermissionClaim(...)` OR
`permissionRegistry.HasPermission(context.User.GetRoleValues(), ...)`): the file is 37 lines and has no
`GetRoles` member. `ClaimsPrincipalExtensions.GetRoleValues()` reads `ClaimTypes.Role` / `"role"` /
`"roles"` and is documented as the framework's one definition of the caller's roles
(`MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:59-67`); `HasPermissionClaim` is the one definition
of an explicit grant (`:94-97`). CQRS gate: `AuthorizationGate.Evaluate`
(`MMCA.Common.Application/UseCases/Decorators/AuthorizationGate.cs:40`) checks `IRequiresPermission`
against the same registry and claim read at `:46-48`, returning `Error.Forbidden` at `:52-55`; marker at
`UseCases/Markers/IRequiresPermission.cs:34,41`. Registration:
`AddAuthorizationPolicies(Action<FallbackAuthorizationOptions>?)`
(`MMCA.Common.API/Authorization/AuthorizationExtensions.cs:60`) registers the handler via
`TryAddEnumerable`, the provider via `Replace` and the shared registry at `:68-72`, then the fallback
handler and the fail-closed `AuthorizationOptions.FallbackPolicy` at `:74-91`; `EnsurePermissionRegistry`
binds both `IPermissionRegistry` and `IPermissionCatalog` to the one built instance at `:133-134`; the
"permissions are the one authorization model" statement is at `:20-22`. Adoption: `ConferencePermissions`
carries eleven constants at `:12-47`, enumerated in `All` at `:50-63`, with the seven-member
`ContentManagement` subset (sessions, speakers, categories, sponsors, partners, activities, session assets)
at `:70-79` (`MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs`); granted by
`ConferencePermissionGrants.Apply`, Organizer gets `All` at `:47` and ContentEditor gets
`ContentManagement` at `:48`, registered as `services.AddPermissions(ConferencePermissionGrants.Apply)`
(`MMCA.ADC.Conference.API/DependencyInjection.cs:43`). `RoleNames` is ADC-owned and holds only `Organizer`,
`Attendee` and `ContentEditor` (`MMCA.ADC.Identity.Shared/Authorization/RoleNames.cs:23,26,33`): there is
no `Admin` role in ADC and no `RoleNames` type in MMCA.Common. `EngagementPermissionGrants.Apply` grants
`Organizer` the three Engagement capabilities (`EngagementPermissionGrants.cs:37`, registered at
`MMCA.ADC.Engagement.API/DependencyInjection.cs:61`); `NotificationPermissionGrants.Apply` grants
`Organizer` `NotificationPermissions.Manage` (`NotificationPermissionGrants.cs:38`); ADC
`IdentityPermissions` defines three, `UsersRead = "identity:users:read"` at `:13` plus `UsersManage` and
`RolesManage` aliasing `AdministrationPermissions` at `:25,38`, enumerated in `All` at `:41-46`
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs`). Store has adopted the layer:
`services.AddPermissions(CatalogPermissionGrants.Apply)`
(`MMCA.Store.Catalog.API/DependencyInjection.cs:45`) and
`services.AddPermissions(SalesPermissionGrants.Apply)` (`MMCA.Store.Sales.API/DependencyInjection.cs:52`);
`Website/docs-src/adr/020-permission-based-authorization.md:70-86` records the eleven Store permissions
across three modules and the dedicated ADC grant tests, and `:63-68` the framework-owned endpoints that
carry `[HasPermission]` themselves. Nineteen unit tests re-counted this run: 6 `[Fact]` in
`Tests/Core/MMCA.Common.Shared.Tests/Auth/Permissions/PermissionRegistryTests.cs`, 6 in
`PermissionCatalogTests.cs` beside it, 4 in
`Tests/Presentation/MMCA.Common.API.Tests/Authorization/PermissionAuthorizationHandlerTests.cs` and 3 in
`PermissionPolicyProviderTests.cs`. RBAC-not-ABAC framing per
`Website/docs-src/governance/common-ArchitectureScorecard.md:91` §11 (Weight 3, Maturity 4, Impl 8, 12/24).
Published package count per `MMCA.Common/FACTS.md:19`. The registration block is the real ADC shape; the
handler block is verbatim from `PermissionAuthorizationHandler.cs:24-33`.*

- Full series index: https://ivanball.github.io/writing.html
