# Permission-based authorization: capabilities over role checks

> Series: MMCA.Common · Article #24 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-020 ·
> Status: grounded in `Website/docs-src/adr/020-permission-based-authorization.md`, the
> `MMCA.Common.Shared/Auth/Permissions` + `MMCA.Common.API/Authorization` source, the framework
> `TokenService` permission claims, and the ADC and Store adoption. No em dashes.

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
compiled in, so an administration screen enumerates the compiled map itself rather than a hand-kept second
list. It is the one place that knows the role-to-capability mapping, so endpoints never name a role.

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
`ClaimTypes.Role`, `"role"`, and `"roles"`, so it works whether or not inbound-claim mapping is on; the
CQRS gate reads the same three claim types through `ICurrentUserService.Roles`. `HasPermissionClaim(...)`
is the single definition of "the token itself grants this", and both gates call it. The framework's
`TokenService` writes that claim at sign-in: every access token carries one `permission` claim for each
permission the minting host's registry grants the account's role. Both apps' Identity hosts apply every
module's grant map before minting (`AddTokenPermissionGrants()`), so a service that does not own a
module's grant map, the CQRS gate in that service, and the Blazor navigation all read the capability from
the token rather than from a registry they do not hold.

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
user account confers a speaker identity); its Engagement module defines three (among them `engagement:live:manage`, granted to
`Organizer`, gating the conference-day live-poll management endpoints); its Notification module grants the
framework's own `notifications:manage` to `Organizer`; and its Identity module defines three, two of which
alias the framework-owned `users:manage` and `roles:manage` from `AdministrationPermissions` so the shared
administration controller bases can carry their own `[HasPermission]`. MMCA.Store defines eleven of its own
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
   back to role-derived resolution if it does not. Whether you emit permission claims at sign-in is then a
   minting decision, not an endpoint change, and emitting them lets a service that holds no grant table
   still answer the question.
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

*Notes: re-verified against source 2026-10-08 (MMCA.Common v1.233.0, `FACTS.md:14`; findings
`Docs/Planning/Quality/medium-apply-2026-10-08/24-permission-based-authorization.json`). Changes in this
pass: ADC's Conference module "defines eleven capabilities" became twelve, with the Organizer-only
`SpeakersLink` (`conference:speakers:link`) named as the one outside the content-editor subset
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:55`,
its Organizer-only rationale `:49-54`, `All` listing twelve at `:58-72`, the seven-member
`ContentManagement` at `:79-88`). The 2026-10-02 anchors below were re-read on 2026-10-08 and corrected
in place where they moved: ADC `Program.cs` `AddTokenPermissionGrants` `:269` to `:280` and
`AddStoredPermissionGrants` `:276` to `:287`; `AddStoredPermissionGrants` declared at
`DependencyInjection.Auth.cs:139` with the `TryDecorate<IPermissionRegistry, LayeredPermissionRegistry>`
at `:170` (the old `:139-149` range no longer reaches it); `AuthorizationExtensions.cs` forwarding
`:133-134` to `:135-136` and handler/provider registration `:68` to `:70-72`; `QuestionsManage` `:26`
to `:27`; `ContentManagement` `:70` to `:79-88`. Re-read and unchanged: `TokenService.cs:129-141` and
`:30`, `LayeredPermissionRegistry.cs:12,30,49`, `AuthorizationGate.cs:40,46-48,52`,
`ClaimsPrincipalExtensions.cs:59-67,75-77,94-97`, `ICurrentUserService.cs:45`,
`AuthorizationExtensions.cs:20-22`, `PermissionPolicyProvider.cs:35`,
`PermissionAuthorizationHandler.cs:24-33` (block still verbatim), `IPermissionRegistry.cs:29`,
`PermissionRegistry.cs:16`, `PermissionRegistryBuilder.cs:34`, `IdentityPermissions.cs:13,26,41,49`,
`IdentityPermissionGrants.cs:36`, `ConferencePermissionGrants.cs:47-48`, `EngagementPermissionGrants.cs:37`,
`NotificationPermissionGrants.cs:38`, Store `Program.cs:213,220` and Store `AddPermissions` `:66`/`:45`/`:52`.
Not re-read in this pass: ADC `TokenPermissionGrants.cs`, the ADR-020 and scorecard anchors, and the
nineteen-test count (carried from the 2026-10-02 audit). Prior pass: re-verified against source
2026-10-02 (MMCA.Common v1.221.0). That run's
changes: the token paragraph said baking a `permission` claim into the token was optional and role-derived
resolution the default; the framework `TokenService` emits one claim per granted permission into every
access token (`MMCA.Common.Infrastructure/Auth/TokenService.cs:129-141`, registry field at `:30`), and both
Identity hosts apply every module's grant map before minting (ADC
`MMCA.ADC.Identity.Service/Program.cs:280`, the map at `Authorization/TokenPermissionGrants.cs:16-24,44-45`;
Store `MMCA.Store.Identity.Service/Program.cs:213`), so the paragraph and Apply-this step 4 ("keeps tokens
small by default") were rewritten. The claim that `GetRoleValues` is the only role reader was narrowed: the
CQRS gate reads `ICurrentUserService.Roles`
(`MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:45-62`), a separate
default member over the same three claim types with a single-`Role` fallback. The claim that the registry
and catalog "can never answer from different maps" was narrowed to the base wiring, because both Identity
hosts call `AddStoredPermissionGrants` (ADC `Program.cs:287`, Store `Program.cs:220`), which decorates
`IPermissionRegistry` with `LayeredPermissionRegistry` while the catalog stays compiled
(`MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:139`, decorated at `:170`; union-only at
`MMCA.Common.Application/Auth/Permissions/LayeredPermissionRegistry.cs:12,30,49`). "The question queue"
became "feedback questions" to match `QuestionsManage` (`ConferencePermissions.cs:27`). Anchors re-read
in that run: `GetRoleValues` (`MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:59-67`), `HasRole`
(`:75-77`), `HasPermissionClaim` (`:94-97`); `AuthorizationGate.Evaluate`
(`MMCA.Common.Application/UseCases/Decorators/AuthorizationGate.cs:40`) checks the registry then the claim
at `:46-48` and returns `Error.Forbidden` at `:52-55`; `AddAuthorizationPolicies` "one authorization model"
statement at `MMCA.Common.API/Authorization/AuthorizationExtensions.cs:20-22`, with both contracts
forwarding to one built `PermissionRegistry` at `:135-136`; ADC `IdentityPermissions`
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs`): `UsersRead` at `:13`, the
`UsersManage` / `RolesManage` aliases at `:26,41`, `All` at `:49-52` holding only `UsersRead` (the aliases
are granted by name in `IdentityPermissionGrants.cs:36-38`). Confirmed by the 2026-10-02 audit and carried:
`IPermissionRegistry.HasPermission` (`MMCA.Common.Shared/Auth/Permissions/IPermissionRegistry.cs:29`);
`PermissionRegistry : IPermissionRegistry, IPermissionCatalog` (`PermissionRegistry.cs:16`);
`PermissionRegistryBuilder.Grant` unioning via `HashSet.UnionWith` (`PermissionRegistryBuilder.cs:34`);
`PermissionPolicyProvider` non-`perm:` fall-through (`MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:35`);
`PermissionAuthorizationHandler` two-source body at `PermissionAuthorizationHandler.cs:24-33` (the handler
block is verbatim); handler and provider registration at `AuthorizationExtensions.cs:70-72`;
`ConferencePermissionGrants.Apply` (Organizer `All` at `:47`, ContentEditor `ContentManagement` at `:48`),
`ConferencePermissions` twelve constants with the seven-member `ContentManagement` subset at `:79-88`;
`EngagementPermissionGrants.cs:37`; `NotificationPermissionGrants.cs:38`; Store `AddPermissions` in all
three modules (`MMCA.Store.Identity.API/DependencyInjection.cs:66`, Catalog `:45`, Sales `:52`) and its
eleven permissions; no role names in MMCA.Common. ADR context:
`Website/docs-src/adr/020-permission-based-authorization.md` records the Store permissions at `:90-97`, the
ADC grant tests at `:100-103` and the framework-owned endpoints at `:67-73`; its `:60-61` still calls the
token claim optional (ADR drift, not edited here). Nineteen unit tests (6 `PermissionRegistryTests`, 6
`PermissionCatalogTests`, 4 `PermissionAuthorizationHandlerTests`, 3 `PermissionPolicyProviderTests`, all
`[Fact]`), per the audit. RBAC-not-ABAC framing per
`Website/docs-src/governance/common-ArchitectureScorecard.md:75` section 11 (Weight 3, Maturity 4, Impl 8, 12/24);
that row's own test count is stale against the nineteen. The registration block is the real ADC shape.*

- Full series index: https://ivanball.github.io/writing.html
