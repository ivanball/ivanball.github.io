# ADR-033: Resource-Ownership Authorization (Row-Level + Action Filter)

## Status
Accepted (2026-07-02, revised 2026-07-25, 2026-08-01, 2026-08-31). Revised 2026-10-01 (the fail-closed owner gate and the per-record ownership check are now framework code in `OwnershipHelper`; see Revision below).

## Context
ADR-020 added a permission (capability) layer over RBAC: it answers "what may this **role** do",
resolving a role to a permission so an endpoint can require a capability instead of a role name. It
explicitly scoped out the orthogonal question, "is this **my** order", recording that "per-resource
ownership (a customer may read only their own data) stays a separate concern (`OwnerOrAdminFilter`),
and a route needing both composes the two" (`020-permission-based-authorization.md:159-160`).

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
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31`) is a sealed
  `IAsyncActionFilter` whose primary constructor takes `ICurrentUserService` and
  `IOptions<OwnerOrAdminFilterOptions>`. Its ownership vocabulary comes from
  `OwnerOrAdminFilterOptions`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:13`). The two
  parameter names keep the framework's conventional defaults: `OwnerClaimType` `"customer_id"`
  (`OwnerOrAdminFilterOptions.cs:16`) and `OwnerParameterName` `"id"`
  (`OwnerOrAdminFilterOptions.cs:31`). `BypassRole` has no default and is `[Required]`
  (`OwnerOrAdminFilterOptions.cs:23-24`), validated by data annotations on first resolve, because the
  framework knows no role names: a host that applies the filter without naming a role from its own
  role constants fails loudly instead of silently bypassing for nobody. It short-circuits to the
  action for the bypass role
  (`OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole)`, `OwnerOrAdminFilter.cs:43`);
  otherwise it reads the caller's owner claim via `GetClaimValue<int>(settings.OwnerClaimType)`
  (`OwnerOrAdminFilter.cs:49`) and returns `ForbidResult` (HTTP 403) if the claim is missing
  (`OwnerOrAdminFilter.cs:51`, `OwnerOrAdminFilter.cs:53`) or if the requested owner parameter resolves
  to an int that does not equal the claim (`OwnerOrAdminFilter.cs:73`, `OwnerOrAdminFilter.cs:75`).
  `TryGetOwnerParameter` reads that parameter from a **route value**
  (`/customers/{id}`) or, when the route lacks it, from a **model-bound query/body argument**
  (`?userId=42`), so the guard also covers list/query routes that carry the owner as a bound
  argument, not only route ids. It is registered scoped by `AddAPI`
  (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`) and applied as
  `[ServiceFilter(typeof(OwnerOrAdminFilter))]`, at class level (Store) or per action (ADC's
  `BookmarksController.cs:85`, `:106`).
- **Collection ownership specification.** `OwnershipHelper`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:11`) is a static helper.
  `GetOwnershipSpecification<TSpec, TId>` returns `null` for the bypass role (`OwnershipHelper.cs:48`),
  and otherwise reads the caller's id claim (`GetClaimValue<TId>(claimType)`, `OwnershipHelper.cs:51`)
  and builds a `Specification` via the supplied factory (`OwnershipHelper.cs:52`); a convenience
  overload defaults the claim to `"customer_id"` (`OwnershipHelper.cs:65`, `OwnershipHelper.cs:70`). The
  returned spec is a `Specification<TEntity, TId>` (`Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`)
  whose `Criteria` expression (`Specification.cs:23`) the existing query pipeline (`IEntityQueryService`)
  translates to SQL, so a non-admin list query returns only the caller's rows. A `null` spec (bypass
  role) applies no filter.
- **Framework gates for the ambiguous `null` and for one record.** The same helper ships
  `RequireResolvableOwner<TId>` (`OwnershipHelper.cs:91-104`), which succeeds for the bypass role or a
  parsable owner claim and otherwise returns `Error.Forbidden` (a 403, `OwnershipHelper.cs:174-175`),
  and `ValidateOwnershipAsync<TId>` (`OwnershipHelper.cs:133-157`), the per-mutation check: the bypass
  role passes without a lookup (`OwnershipHelper.cs:146`), a missing owner claim is refused with
  `Error.Forbidden` before any lookup (`OwnershipHelper.cs:151-153`), and a caller who does not own the
  record gets `Error.NotFound`, a 404 (`OwnershipHelper.cs:167-171`), supplied by a caller-provided
  existence predicate.
- **The bypass role is the single override on both.** `OwnershipHelper.IsAdmin`
  (`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:18`) compares
  `ICurrentUserService.Role` (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:22`)
  to its `bypassRole` argument (`"Admin"` by default) case-insensitively (`OwnershipHelper.cs:21`). Both
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
`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:50` and
`MMCA.Store/.../Identity.API/Controllers/CustomersController.cs:35` as a `[ServiceFilter]`. The
ownership specification scopes list/get queries:
`ShoppingCartsController` builds a `ShoppingCartByCustomerSpecification`
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:65-67`,
`MMCA.Store/.../Sales.Application/ShoppingCarts/Specifications/ShoppingCartByCustomerSpecification.cs:19`,
which filters by `Id` because a cart is keyed by customer, `ShoppingCartByCustomerSpecification.cs:24`)
and hands it to every read through one `GetReadSpecificationAsync` override
(`ShoppingCartsController.cs:200-202`), so the list, the paged list, the by-id read and every page the CSV
export streams are narrowed by the same expression rather than by a copy per action.
`OrdersController` builds an `OrdersByCustomerSpecification` through a private
`GetOwnershipSpecification()` method
(`MMCA.Store/.../Sales.API/Controllers/OrdersController.cs:66-68`,
`MMCA.Store/.../Sales.Application/Orders/Specifications/OrdersByCustomerSpecification.cs:13`, filtering
by `CustomerId`, `OrdersByCustomerSpecification.cs:18`), passed as `specification:
GetOwnershipSpecification()` into each query (`OrdersController.cs:102`, `OrdersController.cs:140`,
`OrdersController.cs:174`) and into its CSV export through a `GetExportSpecification` override
(`OrdersController.cs:241-242`). `OrdersController` does not use the class-level filter for its
mutating routes; it runs an explicit per-mutation ownership check, a private `ValidateOwnershipAsync`
(`OrdersController.cs:379-395`) that delegates to `OwnershipHelper.ValidateOwnershipAsync`
(`OrdersController.cs:383`), which lets the bypass role through via `IsAdmin`
(`OwnershipHelper.cs:146`). The only ownership logic the controller supplies is the existence predicate
(`OrdersController.cs:387-389`). Its two denial branches return different statuses on purpose:

- **Missing owner claim** (the caller carries no `customer_id`, checked at `OwnershipHelper.cs:151-153`):
  `Error.Forbidden`, a 403 (`OwnershipHelper.cs:174-175`). Nothing was looked up, so there is no
  resource whose existence a 403 could leak; this matches the filter's own missing-claim `ForbidResult`.
- **Owner mismatch** (the claim is present but the order is someone else's, the existence check at
  `OrdersController.cs:387-389`): `Error.NotFound`, a 404 rather than a 403
  (`OwnershipHelper.cs:167-171`), so the response does not reveal that another customer's order exists.

**A `null` specification means two different things, so the collection reads gate on it.** Store's two
row-scoped controllers each carry a private `RequireResolvableOwner()` wrapper
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:79-84`, `OrdersController.cs:80-85`)
that delegates to the shared `OwnershipHelper.RequireResolvableOwner` (`OwnershipHelper.cs:91-104`) and
maps a failure through `HandleFailure`.
`OwnershipHelper.GetOwnershipSpecification` returns `null` both for an admin (scoping deliberately
skipped) and for a non-admin whose `customer_id` claim cannot be resolved, and only the first may query
unscoped. The gate lets the bypass role and any caller with a resolvable claim through, and answers
everyone else with `Error.Forbidden`, a 403 through the same `Result`/HTTP edge as the rest
(`OwnershipHelper.cs:101-103`, `:174-175`). It runs on every collection read and
on the CSV export (`ShoppingCartsController.cs:100`, `:120`, `:182`; `OrdersController.cs:95`, `:129`,
`:166`, `:229`). This is the concrete mitigation for the "claim-based ownership trusts the token"
trade-off below: claim-less Customer tokens are issuable in practice, because customer linking on
registration can fail without failing the registration itself, so "no claim" is treated as deny rather
than as no scoping.

Every host that applies the filter configures its vocabulary, because the bypass role is required
configuration rather than a framework default. MMCA.ADC's Engagement module is the worked example.
`AddModuleEngagementAPI`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/DependencyInjection.cs:43`) calls
`services.Configure<OwnerOrAdminFilterOptions>(...)` (`DependencyInjection.cs:45`) to point the shared
filter at ADC's own ownership terms: `ClaimTypes.NameIdentifier` as the owner claim
(`DependencyInjection.cs:53`), its own `Organizer` role constant as the bypass role
(`DependencyInjection.cs:54`), and the `userId`
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
| `ShoppingCartsController.GetAllAsync` (both overloads, `:94`, `:109`) | `ShoppingCartByCustomerSpecification` through `GetReadSpecificationAsync` already narrows the rows to the caller, plus the `RequireResolvableOwner()` gate (`:100`, `:120`) |
| `ShoppingCartsController.GetAllForLookupAsync` (`:139`) | `[HasPermission(SalesPermissions.ShoppingCartsManage)]` (`:138`) |
| `ShoppingCartsController.ExportAsync` (`:174`) | the same `GetReadSpecificationAsync` scoping the list endpoints read, plus the `RequireResolvableOwner()` gate (`:182`) |
| `CustomersController.GetAllAsync` (both overloads, `:53`, `:65`), `GetAllForLookupAsync` (`:82`) | `[HasPermission(IdentityPermissions.CustomersManage)]` (`:52`, `:64`, `:81`) |
| `CustomersController.ExportAsync` (`:114`) | `[HasPermission(IdentityPermissions.CustomersManage)]` (`:113`) |
| `CustomersController.DeleteAsync` (`:148`) | `[HasPermission(IdentityPermissions.CustomersManage)]` (`:146`, `[AllowMissingOwner]` at `:147`), so an owner cannot plain soft-delete their Customer row and skip the anonymizing erasure (ADR-005, `:140-143`) |

Store states each of those guards as a capability, never as a role name: an endpoint requires what it
does and the module's grant table decides who holds it (ADR-020).

`CustomersController.CreateAsync` was inherited without its own policy and had been relying on the
filter failing open. Deny-by-default closes that, but only incidentally, because the action happens to
carry no owner parameter; it now states its own guard,
`[HasPermission(IdentityPermissions.CustomersManage)]` (`CustomersController.cs:131`) beside the
`[AllowMissingOwner]` opt-out (`CustomersController.cs:132`), matching the admin-gated create page that
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
  `SpecificationExtensions.cs:48`, building an `AndSpecification`, `Specification.cs:81`) rather than
  introducing a parallel query path.

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
  gate recorded in Adoption, but the helper's return value is still ambiguous by itself
  (`OwnershipHelper.cs:46-52`), so every new collection read still opts in to the gate rather than
  inheriting it; the opt-in is one call to the shared `OwnershipHelper.RequireResolvableOwner`, not a
  copy kept per controller.
- **The filter assumes the owner parameter equals the owning id.** `OwnerOrAdminFilter` compares its
  configured owner parameter, resolved from either a route value or a model-bound argument, against the
  configured owner claim (`OwnerOrAdminFilter.cs:73`). That holds where the resource is keyed by the
  owner (the cart, the customer profile, a user's own bookmarks) but not where a resource has a separate
  id and a foreign-key owner; those (orders) need the spec or an explicit per-id check instead.
- **This is ownership, not ABAC.** It answers "is this row mine" against a single id claim with an admin
  override; it does not evaluate arbitrary resource attributes, hierarchies, or delegated access. A
  richer policy would be a different mechanism, not a parameter on this one.

## Related
ADR-020 (the role/permission RBAC layer this complements, and whose explicit
`020-permission-based-authorization.md:159-160` scope-out this fills), ADR-034 (the generic entity query
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
   `CustomersController.CreateAsync` (`CustomersController.cs:131`).
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

## Revision (2026-09-10)

**ADC adopts both enforcement points, so the "Engagement Bookmarks only" framing above is no longer
the whole inventory.** The Adoption text describes ADC through the action-filter half alone; its
Conference module carries the row-level half as well, on the canonical shape rather than an inline
variant of it.

1. **Two Conference controllers resolve the specification through the shared helper.**
   `EventQuestionAnswersController` overrides `GetExportSpecification()` and resolves it through
   `OwnershipHelper.GetOwnershipSpecification`
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:85-90`,
   the call at `:86`), and `SessionQuestionAnswersController` does the same
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:107-112`,
   the call at `:108`). Both take the two-generic overload in
   `MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:34`, yielding an
   `OwnedByUserSpecification` for an attendee and `null` for an Organizer. Because
   `EntityControllerBase.GetReadSpecificationAsync` defaults to `GetExportSpecification`, the override
   scopes every read on those controllers, not only the export.
2. **Both fail closed on an unresolvable owner.** Each controller carries the same private
   `RequireResolvableOwner()` gate Store's row-scoped controllers use
   (`EventQuestionAnswersController.cs:104-117`, called at `:126`, `:144`, `:155` and `:169`;
   `SessionQuestionAnswersController.cs:126-139`, called at `:148`, `:166`, `:177` and `:191`). That
   is the answer to the ambiguous `null` recorded in the 2026-08-31 revision: the helper returns
   `null` for an Organizer bypass and for a claim-less non-Organizer, and only the first may read
   unscoped, so the second gets 403 instead of an unscoped read.
3. **The gate is a per-controller method, not framework code.** `RequireResolvableOwner` exists four
   times, once per row-scoped controller: `MMCA.Store/.../OrdersController.cs:82`,
   `MMCA.Store/.../ShoppingCartsController.cs:80`, and ADC's two above. Nothing in MMCA.Common
   declares it. Four identical copies of a fail-closed authorization gate is the kind of duplication
   that eventually diverges in one copy, so it is named here as a candidate for extraction rather
   than as the settled shape.
4. **One Store site is adjacent, not a fifth adopter.** Catalog's `ReviewsController` uses
   `OwnershipHelper.IsAdmin` (`MMCA.Store/.../ReviewsController.cs:72`) and scopes through its own
   `ResolveOwner()` (`:373-374`) rather than through `GetOwnershipSpecification`, so it belongs to the
   helper's audience without being an instance of the row-level pattern this record describes.

## Revision (2026-10-01)
The fail-closed gate this record named as a candidate for extraction (Revision 2026-09-10, item 3) is
now framework code. MMCA.Common v1.216.0 (`MMCA.Common/CHANGELOG.md:26`) adds two members to
`OwnershipHelper`: `RequireResolvableOwner<TId>` (`OwnershipHelper.cs:91-104`), the "bypass role or
resolvable owner claim" gate that answers the ambiguous `null` with a 403, and
`ValidateOwnershipAsync<TId>` (`OwnershipHelper.cs:133-157`), the per-record check (bypass role passes,
missing claim 403 at `:151-153`, non-owner 404 at `:167-171`). The four row-scoped controllers keep a
private `RequireResolvableOwner()` only as a thin wrapper that delegates to the helper
(`ShoppingCartsController.cs:79-84`, `OrdersController.cs:80-85`, and ADC's
`EventQuestionAnswersController.cs:128-136` and `SessionQuestionAnswersController.cs:128-136`, called at
`:145`, `:163`, `:174`, `:188` in each), and Store's `OrdersController.ValidateOwnershipAsync` and
Catalog's `ReviewsController` (`ReviewsController.cs:290`) delegate to the helper's per-record check,
so the `IsAdmin` property on `OrdersController` no longer exists. This supersedes Revision 2026-09-10,
item 4: `ReviewsController` no longer calls `OwnershipHelper.IsAdmin` directly (its only helper use is
`ReviewsController.cs:290`), and its `ResolveOwner()` is now declared at `ReviewsController.cs:246`
(called at `:142`), so the `:72` and `:373-374` anchors there are historical. The statuses (403 for a missing claim,
404 for a non-owner) are unchanged. Decision, Adoption and the claim-based-ownership trade-off now
describe the helper. Also refreshed: the `OwnershipHelper` anchors, the `AddAPI` registration
(`DependencyInjection.cs:85`), the filter's application sites (class level in Store, per action on
ADC's `BookmarksController.cs:85`, `:106`), the Store controller anchors, the `And` composition
(`SpecificationExtensions.cs:48`), and the ADR-020 carve-out quote
(`020-permission-based-authorization.md:159-160`). The deny-by-default table gains
`CustomersController.DeleteAsync` (`CustomersController.cs:145-148`), which carries
`[HasPermission(IdentityPermissions.CustomersManage)]` and `[AllowMissingOwner]` so an owner cannot
soft-delete their Customer row without the anonymizing erasure (ADR-005).
