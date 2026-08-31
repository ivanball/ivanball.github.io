# ADR-033: Resource-Ownership Authorization (Row-Level + Action Filter)

## Status
Accepted (2026-07-02, revised 2026-07-25, 2026-08-01, 2026-08-31).

## Context
ADR-020 added a permission (capability) layer over RBAC: it answers "what may this **role** do",
resolving a role to a permission so an endpoint can require a capability instead of a role name. It
explicitly scoped out the orthogonal question, "is this **my** order", recording that "per-resource
ownership (a customer may read only their own data) stays a separate concern (`OwnerOrAdminFilter`),
and a route needing both composes the two" (`020-permission-based-authorization.md:92-93`).

That carve-out names a mechanism that already ships in framework code but had no decision record of
its own. RBAC and permissions are principal-scoped: a customer with the Customer role may read orders,
but that role says nothing about *which* orders. Two endpoint shapes need a different, resource-scoped
check that the role/permission model cannot express:

- **Single-resource routes** (`GET /orders/{id}`, `GET /customers/{id}`): the id in the URL identifies
  one resource, and a non-admin caller must be denied if that resource is not theirs.
- **Collection/list routes** (`GET /orders`, `GET /shoppingcarts`): there is no id to check; the result
  set itself must be narrowed to the caller's own rows rather than returning everyone's data.

These are different problems (reject-one vs filter-many) and cannot be one mechanism. This ADR records
the shipped resource-ownership axis that sits beside ADR-020, not inside it.

## Decision
Provide a row/resource-level ownership axis in `MMCA.Common.API` (the `Authorization` folder), with two
enforcement points keyed on the caller's owner claim (`customer_id` by default) and a configurable
bypass role (`Admin` by default).

- **Single-resource action filter.** `OwnerOrAdminFilter`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:30`) is a sealed
  `IAsyncActionFilter` whose primary constructor takes `ICurrentUserService` and
  `IOptions<OwnerOrAdminFilterOptions>`. Its ownership vocabulary comes from
  `OwnerOrAdminFilterOptions`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11`), whose defaults
  reproduce the original hard-coded behavior: `OwnerClaimType` `"customer_id"`
  (`OwnerOrAdminFilterOptions.cs:14`), `BypassRole` `"Admin"` (`OwnerOrAdminFilterOptions.cs:17`), and
  `OwnerParameterName` `"id"` (`OwnerOrAdminFilterOptions.cs:24`), so a host that configures nothing
  behaves exactly as before. It short-circuits to the action for the bypass role
  (`OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole)`, `OwnerOrAdminFilter.cs:42`);
  otherwise it reads the caller's owner claim via `GetClaimValue<int>(settings.OwnerClaimType)`
  (`OwnerOrAdminFilter.cs:48`) and returns `ForbidResult` (HTTP 403) if the claim is missing
  (`OwnerOrAdminFilter.cs:50`, `OwnerOrAdminFilter.cs:52`) or if the requested owner parameter resolves
  to an int that does not equal the claim (`OwnerOrAdminFilter.cs:72`, `OwnerOrAdminFilter.cs:74`).
  `TryGetOwnerParameter` reads that parameter from a **route value**
  (`/customers/{id}`) or, when the route lacks it, from a **model-bound query/body argument**
  (`?userId=42`), so the guard also covers list/query routes that carry the owner as a bound
  argument, not only route ids. It is registered scoped by `AddAPI`
  (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:78`) and applied per controller as
  `[ServiceFilter(typeof(OwnerOrAdminFilter))]`.
- **Collection ownership specification.** `OwnershipHelper`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10`) is a static helper.
  `GetOwnershipSpecification<TSpec, TId>` returns `null` for the bypass role (`OwnershipHelper.cs:47`),
  and otherwise reads the caller's id claim (`GetClaimValue<TId>(claimType)`, `OwnershipHelper.cs:50`)
  and builds a `Specification` via the supplied factory (`OwnershipHelper.cs:51`); a convenience
  overload defaults the claim to `"customer_id"` (`OwnershipHelper.cs:63`, `OwnershipHelper.cs:67`). The
  returned spec is a `Specification<TEntity, TId>` (`Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`)
  whose `Criteria` expression (`Specification.cs:23`) the existing query pipeline (`IEntityQueryService`)
  translates to SQL, so a non-admin list query returns only the caller's rows. A `null` spec (bypass
  role) applies no filter.
- **The bypass role is the single override on both.** `OwnershipHelper.IsAdmin`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:17`) compares
  `ICurrentUserService.Role` (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:22`)
  to its `bypassRole` argument (`"Admin"` by default) case-insensitively (`OwnershipHelper.cs:20`). Both
  enforcement points consult it, so a caller in the bypass role sees and touches any resource through
  either path.
- **The filter denies by default.** When the owner parameter cannot be resolved (absent, non-int, or
  carried inside a bound model whose `ToString()` does not parse), the request is rejected. The
  filter originally fell through to the action in that case, which meant it silently stopped
  guarding any action whose parameter was optional or not an int: "nothing to compare" was being
  read as "nothing to enforce". An action that legitimately has no owner parameter opts out with
  `[AllowMissingOwner]`
  (`Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs`), honored on the
  action or its controller through the endpoint metadata. The attribute is an assertion that the
  action is guarded some other way, so each application site must name that guard: an ownership
  specification that already narrows the rows, or its own authorization policy. The opt-out excuses
  only a *missing* parameter; an action carrying a foreign owner id is still denied, and a missing
  owner claim is still denied regardless.
- **Two failure shapes, by design.** The single-resource filter denies with 403 (`ForbidResult`); the
  collection path never 403s, it returns a filtered (possibly empty) result set. Both flow through the
  caller's normal `Result`/HTTP edge (ADR-013), not exceptions.

**Applying the filter at controller level covers every action on that controller**, including ones
inherited from `EntityControllerBase` / `AggregateRootEntityControllerBase`. Adding it is therefore an
audit of the whole controller, not just of the routes that motivated it.

**Adoption.** MMCA.Store wires both in production. The filter guards
`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:49` and
`MMCA.Store/.../Identity.API/Controllers/CustomersController.cs:34` as a `[ServiceFilter]`. The
ownership specification scopes list/get queries:
`ShoppingCartsController` builds a `ShoppingCartByCustomerSpecification`
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:66`,
`MMCA.Store/.../Sales.Application/ShoppingCarts/Specifications/ShoppingCartByCustomerSpecification.cs:19`,
which filters by `Id` because a cart is keyed by customer, `ShoppingCartByCustomerSpecification.cs:24`)
and hands it to every read through one `GetReadSpecificationAsync` override
(`ShoppingCartsController.cs:206`), so the list, the paged list, the by-id read and every page the CSV
export streams are narrowed by the same expression rather than by a copy per action.
`OrdersController` builds an `OrdersByCustomerSpecification` through a private
`GetOwnershipSpecification()` method
(`MMCA.Store/.../Sales.API/Controllers/OrdersController.cs:64-66`,
`MMCA.Store/.../Sales.Application/Orders/Specifications/OrdersByCustomerSpecification.cs:13`, filtering
by `CustomerId`, `OrdersByCustomerSpecification.cs:18`), passed as `specification:
GetOwnershipSpecification()` into each query (`OrdersController.cs:105`, `OrdersController.cs:143`,
`OrdersController.cs:177`) and into its CSV export through a `GetExportSpecification` override
(`OrdersController.cs:244-245`). `OrdersController` does not use the class-level filter for its
mutating routes; it runs an explicit per-mutation ownership check, `ValidateOwnershipAsync`
(`OrdersController.cs:414`), that reuses `OwnershipHelper.IsAdmin` through its `IsAdmin` property
(`OrdersController.cs:62`) to let the bypass role through. Its two denial branches return different
statuses on purpose:

- **Missing owner claim** (the caller carries no `customer_id`, checked at `OrdersController.cs:422`):
  `Error.Forbidden`, a 403 (`OrdersController.cs:424-428`). Nothing was looked up, so there is no
  resource whose existence a 403 could leak; this matches the filter's own missing-claim `ForbidResult`.
- **Owner mismatch** (the claim is present but the order is someone else's, the existence check at
  `OrdersController.cs:431-433`): `Error.NotFound`, a 404 rather than a 403
  (`OrdersController.cs:437-439`), so the response does not reveal that another customer's order exists.

**A `null` specification means two different things, so the collection reads gate on it.** Store's two
row-scoped controllers each carry a private `RequireResolvableOwner()`
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:80`, `OrdersController.cs:78-88`).
`OwnershipHelper.GetOwnershipSpecification` returns `null` both for an admin (scoping deliberately
skipped) and for a non-admin whose `customer_id` claim cannot be resolved, and only the first may query
unscoped. The gate lets the bypass role and any caller with a resolvable claim through, and answers
everyone else with `Error.Forbidden`, a 403 through the same `Result`/HTTP edge as the rest
(`ShoppingCartsController.cs:82-89`, `OrdersController.cs:80-87`). It runs on every collection read and
on the CSV export (`ShoppingCartsController.cs:106`, `:126`, `:188`; `OrdersController.cs:98`, `:132`,
`:169`, `:232`). This is the concrete mitigation for the "claim-based ownership trusts the token"
trade-off below: claim-less Customer tokens are issuable in practice, because customer linking on
registration can fail without failing the registration itself, so "no claim" is treated as deny rather
than as no scoping.

MMCA.ADC's Engagement module is the first host to configure the filter's vocabulary rather than take
the defaults. `AddModuleEngagementAPI`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:43`) calls
`services.Configure<OwnerOrAdminFilterOptions>(...)` (`DependencyInjection.cs:45`) to point the shared
filter at ADC's own ownership terms: `ClaimTypes.NameIdentifier` as the owner claim
(`DependencyInjection.cs:53`), the `Organizer` bypass role (`RoleNames.Organizer`,
`Source/Core/MMCA.Common.Shared/Auth/RoleNames.cs:15`, `DependencyInjection.cs:54`), and the `userId`
query argument its Bookmarks list endpoints bind (`DependencyInjection.cs:55`). ADC's token carries the
user id in `sub` alone; the JWT bearer handler maps inbound `sub` onto `ClaimTypes.NameIdentifier`, so
that is the type the principal the filter inspects actually carries (`DependencyInjection.cs:47-52`).
The filter type is unchanged; only the options differ, which is exactly what the options object exists
for. The Bookmarks
**delete** keeps a separate DB-backed inline ownership check that returns 404-not-403 (the same
per-mutation, existence-hiding pattern Store's `OrdersController` uses).

**The deny-by-default audit.** Both Store controllers apply the filter at class level, so every action
on them was reviewed and the ones with no owner parameter now carry `[AllowMissingOwner]` with the
guard that replaces the check named at each site:

| Action | Guard that replaces the parameter check |
| --- | --- |
| `ShoppingCartsController.GetAllAsync` (both overloads, `:98`, `:113`) | `ShoppingCartByCustomerSpecification` through `GetReadSpecificationAsync` already narrows the rows to the caller, plus the `RequireResolvableOwner()` gate (`:106`, `:126`) |
| `ShoppingCartsController.GetAllForLookupAsync` (`:142`) | `[HasPermission(SalesPermissions.ShoppingCartsManage)]` (`:144`) |
| `ShoppingCartsController.ExportAsync` (`:178`) | the same `GetReadSpecificationAsync` scoping the list endpoints read, plus the `RequireResolvableOwner()` gate (`:188`) |
| `CustomersController.GetAllAsync` (both overloads, `:49`, `:61`), `GetAllForLookupAsync` (`:78`) | `[HasPermission(IdentityPermissions.CustomersManage)]` (`:51`, `:63`, `:80`) |
| `CustomersController.ExportAsync` (`:110`) | `[HasPermission(IdentityPermissions.CustomersManage)]` (`:112`) |

Store states each of those guards as a capability, never as a role name: an endpoint requires what it
does and the module's grant table decides who holds it (ADR-020).

`CustomersController.CreateAsync` was inherited without its own policy and had been relying on the
filter failing open. Deny-by-default closes that, but only incidentally, because the action happens to
carry no owner parameter; it now states its own guard,
`[HasPermission(IdentityPermissions.CustomersManage)]` (`CustomersController.cs:130`) beside the
`[AllowMissingOwner]` opt-out (`CustomersController.cs:131`), matching the admin-gated create page that
is its only caller (`CustomersController.cs:124-127`). ADC's `BookmarksController` needs no annotation:
both filtered actions bind a `[Required]` non-nullable `userId`, so model validation rejects a missing
value before the filter runs.

## Rationale
- **Reject-one and filter-many are genuinely two mechanisms.** A single-resource route has an id to
  compare, so a short action filter that 403s on a mismatch is the cheapest correct guard. A collection
  route has no id; narrowing it means pushing a predicate into the query, which a filter cannot do
  without re-running the query itself. Forcing both through one abstraction would either over-fetch then
  post-filter (leaky, and breaks paging counts) or fail to scope lists at all.
- **Ownership lives beside RBAC, not inside it.** Role/permission resolution (ADR-020) is a property of
  the principal; ownership is a relation between the principal and a specific row. Keeping them separate
  lets a route compose both (require a capability *and* own the resource) without either model growing a
  resource-condition concept it was not designed for.
- **A `Specification` composes with the existing pipeline.** The row-scope is expressed as a
  `Specification<TEntity, TId>` whose `Criteria` is an EF-translatable expression
  (`Specification.cs:9`, `Specification.cs:23`), so it slots into `IEntityQueryService` alongside
  filtering, sorting, paging, and projection (and can be `And`-composed with other specs,
  `Specification.cs:62`) rather than introducing a parallel query path.

## Trade-offs
- **Opt-in per controller/handler.** Neither point is automatic: a controller that forgets the
  `[ServiceFilter]` or omits the ownership spec from a query leaks across customers, the same
  audit-the-inventory caveat as ADR-019 / ADR-020 / ADR-021. The two-enforcement-point split also means
  one route can guard mutations but forget to scope its list (or vice versa).
- **Claim-based ownership trusts the token.** Both points key on the configured owner claim
  (`customer_id` by default) being present and correct, so their correctness depends entirely on the
  upstream token validation (ADR-004); a missing claim 403s (filter) or yields a `null` spec (helper,
  which for a non-admin returns `null` and therefore no scoping, so callers must not treat a missing
  claim as "admin"). Store's two row-scoped controllers close that with the `RequireResolvableOwner()`
  gate recorded in Adoption, but the helper's return value is still ambiguous by itself, so every new
  collection read has to add the same gate rather than inherit it.
- **The filter assumes the owner parameter equals the owning id.** `OwnerOrAdminFilter` compares its
  configured owner parameter, resolved from either a route value or a model-bound argument, against the
  configured owner claim (`OwnerOrAdminFilter.cs:72`). That holds where the resource is keyed by the
  owner (the cart, the customer profile, a user's own bookmarks) but not where a resource has a separate
  id and a foreign-key owner; those (orders) need the spec or an explicit per-id check instead.
- **This is ownership, not ABAC.** It answers "is this row mine" against a single id claim with an admin
  override; it does not evaluate arbitrary resource attributes, hierarchies, or delegated access. A
  richer policy would be a different mechanism, not a parameter on this one.

## Related
ADR-020 (the role/permission RBAC layer this complements, and whose explicit
`020-permission-based-authorization.md:92-93` scope-out this fills), ADR-034 (the generic entity query
pipeline / `IEntityQueryService` the collection-scoping `Specification` slots into), ADR-013 (failures
surface as `Result`/HTTP at the edge, the filter as a 403 `ForbidResult`), ADR-004 (the validated
principal and owner claim both enforcement points trust), ADR-078 (the CSV export endpoint, whose
per-controller scoping hook is what lets an export inherit the same ownership specification as the list
it mirrors).

## Revision (2026-07-25)
An audit against the code. No behavior changed; the ADR text did.

1. **The per-mutation check's failure shape was described as one branch, and it is two.**
   `ValidateOwnershipAsync` was recorded as deliberately returning 404 rather than 403. That is true
   only of the owner-mismatch branch. The missing-claim branch returns `Error.Forbidden` (403), which
   leaks nothing because no lookup has happened yet. Adoption now states each branch separately.
2. **Refreshed line anchors** for `OwnerOrAdminFilter` (the class doc comment grew and the
   deny-by-default `[AllowMissingOwner]` fallback was inserted between the claim check and the
   owner comparison, so the mismatch citations moved further than the rest), `ICurrentUserService.Role`,
   both Store ownership specifications, `OrdersController`, and the ADR-020 carve-out quote.

## Revision (2026-08-01)
Anchor-only correction. No behavior changed; `OrdersController` was refactored (a constructor
parameter added, `GetOwnershipSpecification()` and the `IsAdmin` property extracted,
`ValidateOwnershipAsync` moved) since the 2026-07-25 pass, which shifted every line anchor pointing
into it. Refreshed: `GetOwnershipSpecification()` (now `OrdersController.cs:64-66`), its three call
sites (`OrdersController.cs:105`, `:143`, `:177`), `ValidateOwnershipAsync` (now
`OrdersController.cs:431`) and the `IsAdmin` property it reads (`OrdersController.cs:62`), the
missing-owner-claim `Error.Forbidden` branch (`OrdersController.cs:439`, `:441-446`), and the
owner-mismatch `Error.NotFound` branch (`OrdersController.cs:454`, `:454-456`).
`OrdersByCustomerSpecification.cs:13` and `:18` were re-checked and are unchanged.

## Revision (2026-08-31)
Behavior changed on both adopters since the 2026-08-01 pass, so this is not an anchor refresh.

1. **The ambiguous `null` specification is now gated.** `OwnershipHelper.GetOwnershipSpecification`
   returns `null` for an admin and for a non-admin whose owner claim cannot be resolved, and Store's
   collection reads used to run unscoped in both cases. Both row-scoped controllers now carry a
   `RequireResolvableOwner()` gate that 403s the second caller (`ShoppingCartsController.cs:80`,
   `OrdersController.cs:78-88`). Recorded in Adoption and referenced from the claim-based-ownership
   trade-off it answers.
2. **The Store guards are capabilities, not a role policy.** The deny-by-default table named a
   `RequireAdmin` policy; that identifier no longer exists anywhere in MMCA.Store source. The
   annotated actions state `[HasPermission(SalesPermissions.ShoppingCartsManage)]` and
   `[HasPermission(IdentityPermissions.CustomersManage)]` instead (ADR-020), including
   `CustomersController.CreateAsync` (`CustomersController.cs:130`).
3. **The table was two rows short.** Both CSV exports carry `[AllowMissingOwner]` and were missing:
   `ShoppingCartsController.ExportAsync` (`:178`), guarded by the `GetReadSpecificationAsync` row
   scoping plus the fail-closed gate, and `CustomersController.ExportAsync` (`:110`), guarded by the
   customer-management capability. Sales exports read the caller's own ownership specification through
   `GetReadSpecificationAsync` (`ShoppingCartsController.cs:206`) and `GetExportSpecification`
   (`OrdersController.cs:244-245`), so an export matches the list endpoint it mirrors (the ADR-078
   follow-up); the Customers export stays capability-gated, because its list endpoints are not row
   scoped and there is no ownership specification to reproduce.
4. **ADC's owner claim is `ClaimTypes.NameIdentifier`, not `user_id`.** The token carries the user id
   in `sub` alone and the JWT bearer handler maps it onto `ClaimTypes.NameIdentifier`, which is what
   the Engagement module configures (`DependencyInjection.cs:53`). The `user_id` wording was wrong,
   not merely mis-anchored.
5. **Refreshed anchors**: the ADR-020 carve-out quote (now
   `020-permission-based-authorization.md:92-93`, and the stale `ADRs/` path prefix dropped, since the
   ADRs are canonical under `Website/docs-src/adr/`), `CustomersController` `[ServiceFilter]` (`:34`),
   `ValidateOwnershipAsync` (`OrdersController.cs:414`) with its `Error.Forbidden` (`:422`, `:424-428`)
   and `Error.NotFound` (`:431-433`, `:437-439`) branches, and the ADC Engagement registration
   (`DependencyInjection.cs:43`, `:45`, `:54`, `:55`).
