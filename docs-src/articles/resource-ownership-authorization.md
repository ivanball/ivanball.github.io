# Resource-ownership authorization: which rows you may touch, not just which actions

> Series: MMCA.Common · Article #29 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-033 ·
> Status: grounded in `Website/docs-src/adr/033-resource-ownership-authorization.md`, the
> `MMCA.Common.API/Authorization` source (`OwnerOrAdminFilter`, `AllowMissingOwnerAttribute`,
> `OwnershipHelper` including `RequireResolvableOwner` and `ValidateOwnershipAsync`), the
> `EntityControllerBase.GetReadSpecificationAsync` and `GetExportSpecification` hooks with the
> fail-closed `AllowUnscopedExport` export rule, the `MMCA.Common.Domain` `Specification` base, and the
> MMCA.Store and MMCA.ADC adoptions. No em dashes.

**Subtitle:** Article 24 covered what a role or permission lets you *do*. It said, explicitly, that
"a customer may read only their own order" is a different concern. This is that concern. RBAC answers
which action; ownership answers which rows, and the two are not the same check.

---

Picture the role check passing. A request arrives with a valid token, the principal carries the
`Customer` role, and your policy says a customer may call `GET /orders/{id}`. Authorization succeeds.
Nothing is wrong with the role check. It answered the question it was built to answer: is this caller
allowed to read orders. It is allowed.

Now substitute the id. Customer A, fully authenticated, requests `GET /orders/9817`, an order that
belongs to customer B. The role check passes again, because the role check never looked at the id. It
cannot. A role is a property of the principal: "this person may read orders." It says nothing about
*which* orders, because "which" is not a fact about the principal at all. It is a relation between the
principal and a specific row.

That is the axis RBAC structurally cannot express, and Article 24 said so out loud. Its trade-offs
section named the gap directly: "A customer may read only their own order is a different concern (an
`OwnerOrAdminFilter`), and a route that needs both composes the two." The permission layer decoupled
endpoints from role names and then stopped, on purpose. This article is the mechanism it pointed at.

## Why it matters

The failure mode here has a name, and it is not obscure. The OWASP API Security Top 10 lists Broken
Object Level Authorization (the modern label for the classic Insecure Direct Object Reference, IDOR) as
API1, the number-one risk to web APIs. The shape is always the same: the endpoint authenticates the
caller, authorizes the *action*, and then trusts an id from the URL without checking that the row behind
that id belongs to the caller. Increment the integer, read someone else's invoice.

What makes it so common is that it hides behind a green light. Every role check passes. Every test that
asserts "a customer can read an order" passes. The hole only appears when the order in the URL is not the
caller's, and that is exactly the case a who-can-do-what test rarely sets up. You do not get a stack
trace. You get a 200 with the wrong customer's data in it.

So the missing axis is not a nicety layered on top of RBAC. It is the half of authorization that the
role model was never designed to carry, and leaving it implicit is how a perfectly "authorized" endpoint
leaks across tenants.

## The MMCA answer: two enforcement points, one bypass

The first instinct is to look for a single ownership abstraction. There is not one, and ADR-033 is
explicit about why: there are two genuinely different problems wearing one name.

A single-resource route (`GET /orders/{id}`, `GET /customers/{id}`) has an id in the URL. The job is to
reject one request when that id is not the caller's. A collection route (`GET /orders`,
`GET /shoppingcarts`) has no id to check. The job is to narrow the result set to the caller's own rows
before it is ever returned. Reject-one and filter-many cannot be the same mechanism: a filter cannot
narrow a list without re-running the query, and a query predicate cannot 403 a single bad id. MMCA.Common
ships one piece for each, keyed on the same claim, sharing the same bypass role, and a third piece that
exists only because the filter refuses to guess: an attribute an action uses to declare that it has no
owner parameter to compare. Beside the collection helper sit two fail-closed checks, so a controller
that scopes by ownership does not hand-write its own gate either.

**Single-resource routes get an action filter.** `OwnerOrAdminFilter`
(`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31`) is a sealed
`IAsyncActionFilter` whose primary constructor takes `ICurrentUserService` and an
`IOptions<OwnerOrAdminFilterOptions>` (`OwnerOrAdminFilter.cs:32-33`), so the vocabulary it enforces is
host-configurable. It short-circuits to the action for a caller in the bypass role
(`OwnerOrAdminFilter.cs:43`, passing the configured `settings.BypassRole`); otherwise it reads the
caller's owner claim via `GetClaimValue<int>(settings.OwnerClaimType)` (`OwnerOrAdminFilter.cs:49`;
`OwnerClaimType` defaults to `customer_id`, `OwnerOrAdminFilterOptions.cs:16`) and returns a
`ForbidResult` (HTTP 403) if that claim is missing (`OwnerOrAdminFilter.cs:51`,
`OwnerOrAdminFilter.cs:53`) or if the requested owner parameter resolves to an int that does not equal
the claim (`OwnerOrAdminFilter.cs:73`, `OwnerOrAdminFilter.cs:75`). That parameter
(`OwnerParameterName`, default `id`, `OwnerOrAdminFilterOptions.cs:31`) is read from either a route
value (`OwnerOrAdminFilter.cs:95-97`) or, when absent from the route, a model-bound query or body
argument (`OwnerOrAdminFilter.cs:102-104`), by `TryGetOwnerParameter` (`OwnerOrAdminFilter.cs:93`,
called at `OwnerOrAdminFilter.cs:57`), both parses invariant-culture. Only a matching owner value falls
through to the action (`OwnerOrAdminFilter.cs:79`). It is registered as a scoped service by `AddAPI`
(`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`, `AddAPI` declared at `:45`) and
applied per controller as `[ServiceFilter(typeof(OwnerOrAdminFilter))]`.

**The framework names no roles, so the host must.** `BypassRole` is `[Required]` with no default
(`OwnerOrAdminFilterOptions.cs:23-24`), and `AddAPI` registers the options with
`ValidateDataAnnotations()` and deliberately not `ValidateOnStart()` (`DependencyInjection.cs:91-92`,
the rationale at `:87-90`): validating at startup would fail every host that never applies the filter,
so the data-annotation message lands on first resolve, in front of the host that actually uses it. A
host that applies the filter without naming a role gets that failure rather than a silent bypass for
nobody.

**And when there is nothing to compare, the filter denies.** That is the interesting default, because the
obvious one is wrong. If `TryGetOwnerParameter` cannot resolve the parameter (absent, not an int, or
carried inside a bound model), the request gets a `ForbidResult` (`OwnerOrAdminFilter.cs:57`,
`OwnerOrAdminFilter.cs:63`). Falling through to the action instead would read "nothing to compare" as
"nothing to enforce", which silently stops guarding any action whose parameter is optional or not an
integer: the guard disappears with no error, no exception and nothing for a who-can-do-what test to
catch. ADR-033 records deny-by-default as the deliberate choice
(`033-resource-ownership-authorization.md:80-91`). An action that genuinely has no owner parameter says
so out loud with `[AllowMissingOwner]`
(`Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21`, an
`AttributeTargets.Class | AttributeTargets.Method` attribute with `Inherited = true`,
`AllowMissingOwnerAttribute.cs:20`), which the filter honors on the action or its declaring controller
through the endpoint metadata (`HasAllowMissingOwner`, `OwnerOrAdminFilter.cs:61`,
`OwnerOrAdminFilter.cs:84`). The opt-out excuses a *missing* parameter only: an action carrying a foreign
owner id is still denied, and a missing owner claim is still denied regardless.

**Collection routes get an ownership Specification.** `OwnershipHelper`
(`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:11`) is a static helper. Its
`GetOwnershipSpecification<TSpec, TId>` (`OwnershipHelper.cs:35`) takes the bypass role as a required
argument (`OwnershipHelper.cs:39`) and returns `null` for a caller who holds it
(`OwnershipHelper.cs:46`, `OwnershipHelper.cs:48`), and otherwise reads the caller's id claim
(`GetClaimValue<TId>(claimType)`, `OwnershipHelper.cs:51`) and builds a specification through a supplied
factory (`OwnershipHelper.cs:52`); a convenience overload defaults the claim name to `"customer_id"`
(`OwnershipHelper.cs:65-70`, the literal at `:70`) and still requires the role (`:68`). The object it
hands back is a `Specification<TEntity, TIdentifierType>`
(`Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`) whose `Criteria` is an
EF-translatable expression tree (`Specification.cs:23`). That is the same specification type from Article
6: it slots straight into the existing query pipeline, which translates the predicate to SQL, so a scoped
list query returns only the caller's rows. A `null` specification (the bypass case) applies no filter,
and because these are real specifications they compose, an `AndSpecification` (`Specification.cs:81`)
ties the ownership scope to any other criteria a query already carries.

**One bypass role, on both.** Both points call `OwnershipHelper.IsAdmin` (`OwnershipHelper.cs:18`), which
compares `ICurrentUserService.Role`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:22`) to the
`bypassRole` its caller supplies, case-insensitively (`OwnershipHelper.cs:21`). That parameter has no
default value, and the XML doc says why: the framework declares no role names
(`OwnershipHelper.cs:13-17`, the sentence at `:16`). MMCA.Store names its own `RoleNames.Admin` at both
points: as the filter's `BypassRole` in each module that applies it
(`MMCA.Store/.../Sales.API/DependencyInjection.cs:50`, `MMCA.Store/.../Identity.API/DependencyInjection.cs:64`)
and as the helper's argument in each controller (`OrdersController.cs:68`). One predicate, consulted by
the filter and by the helper, so a privileged caller sees and touches any resource through either path
and you do not maintain two definitions of "may see everything."

**The helper also owns the two fail-closed checks.** A `null` from `GetOwnershipSpecification` means two
different things: the caller holds the bypass role, or the caller's owner claim cannot be resolved, and
only the first may read unscoped. `RequireResolvableOwner<TId>` (`OwnershipHelper.cs:91-104`) tells them
apart: it succeeds for the bypass role or a parsable owner claim and otherwise fails with
`Error.Forbidden`, a 403 (`OwnershipHelper.cs:101-103`, the error built at `:174-175`).
`ValidateOwnershipAsync<TId>` (`OwnershipHelper.cs:133-157`) is the per-record check for a mutation: the
bypass role passes without a lookup (`:146`), a missing owner claim fails with the same 403 before any
lookup (`:151-153`), and a caller who does not own the record gets `Error.NotFound`, a 404
(`:167-171`), so the existence of someone else's record cannot be probed. Both take the claim type and
the bypass role from the caller, exactly as the rest of the helper does, so a host's vocabulary flows
through unchanged.

Notice the deliberately different failure shapes. The single-resource filter denies with a 403
`ForbidResult`. The ownership specification never 403s: it returns a filtered, possibly empty, result
set, and the only 403 on a collection read comes from the separate resolvable-owner gate, never from the
query. Both flow through the caller's normal `Result`/HTTP edge, not exceptions.

```csharp
// Illustrative of shape: the enforcement points, assembled from the real members.

// (1) Single-resource: the filter's core check (OwnerOrAdminFilter.cs:43-79), options-driven.
var settings = options.Value;   // OwnerOrAdminFilterOptions: OwnerClaimType, BypassRole, OwnerParameterName

if (OwnershipHelper.IsAdmin(currentUserService, settings.BypassRole))
{
    await next().ConfigureAwait(false);   // bypass-role short-circuit, both points share this predicate
    return;
}

var ownerId = currentUserService.GetClaimValue<int>(settings.OwnerClaimType);   // default claim: customer_id
if (ownerId is null) { context.Result = new ForbidResult(); return; }   // 403: no claim

// OwnerParameterName (default "id") is read from a route value OR a model-bound query/body argument.
if (!TryGetOwnerParameter(context, settings.OwnerParameterName, out var requestedId))
{
    // Deny by default: nothing to compare is not nothing to enforce. An action with no owner
    // parameter opts out explicitly with [AllowMissingOwner] and names the guard that replaces this.
    if (!HasAllowMissingOwner(context))
    {
        context.Result = new ForbidResult();   // 403: unresolvable owner parameter
    }
    else
    {
        await next().ConfigureAwait(false);
    }

    return;
}

if (requestedId != ownerId.Value)
{
    context.Result = new ForbidResult();   // 403: requested owner is not the caller's
    return;
}

await next().ConfigureAwait(false);   // only a matching owner value gets here

// (2) Collection: row-scope the list query with an ownership Specification (a controller).
//     The bypass role gets null (no filter); everyone else gets a spec the query translates to SQL.
//     BypassRole is required and has no default, so the host names it (Store: RoleNames.Admin).
private OrdersByCustomerSpecification? GetOwnershipSpecification() =>
    OwnershipHelper.GetOwnershipSpecification(
        currentUserService, id => new OrdersByCustomerSpecification(id), RoleNames.Admin);

// (3) The fail-closed gate every collection read runs first: null means "bypass role" OR
//     "unresolvable claim", and only the first may read unscoped. The helper answers the second with 403.
private ObjectResult? RequireResolvableOwner() =>
    OwnershipHelper.RequireResolvableOwner<CustomerIdentifierType>(
        currentUserService, StoreClaimTypes.CustomerId, RoleNames.Admin, nameof(OrdersController), nameof(Order))
        is { IsFailure: true } gate
        ? HandleFailure(gate.Errors)
        : null;
```

## How MMCA.Store wires it

This is not framework-only theory. MMCA.Store turns both points on in production. The filter guards the
shopping-cart and customer-profile controllers as a class-level
`[ServiceFilter(typeof(OwnerOrAdminFilter))]`
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:50`,
`MMCA.Store/.../Identity.API/Controllers/CustomersController.cs:35`). The ownership specification scopes
the list and read queries: `ShoppingCartsController` builds a `ShoppingCartByCustomerSpecification`
through a private `GetOwnershipSpecification()` method (`ShoppingCartsController.cs:65-67`) that filters
by `Id`, because a cart is keyed by its customer
(`ShoppingCartByCustomerSpecification.cs:24`, `cart => cart.Id.Equals(customerId)`), and `OrdersController`
builds an `OrdersByCustomerSpecification` the same way
(`OrdersController.cs:66-68`) that filters by `CustomerId`
(`OrdersByCustomerSpecification.cs:18`, `order => order.CustomerId.Equals(customerId)`), passing it into
each of its three query call sites (`OrdersController.cs:102`, `:140`, `:174`). Both hand the helper
Store's own `RoleNames.Admin`, because the framework offers no role name to fall back on.

Because both filtered controllers apply the filter at class level, deny-by-default forced an audit of
every action on them. The actions with no owner parameter carry `[AllowMissingOwner]`, and so does one
that has one: ten application sites across the two, each next to the guard that replaces or backs up
the parameter check. Four are on `ShoppingCartsController` (`ShoppingCartsController.cs:92`, `:107`,
`:136`, `:172`): the two cart list overloads are narrowed to the caller by the controller's
`GetReadSpecificationAsync` override, so ownership is enforced in the query rather than on a route value,
the lookup endpoint is gated by `[HasPermission(SalesPermissions.ShoppingCartsManage)]` (`:138`), and the
CSV export is row-scoped the same way the lists are (more on that below). Six are on `CustomersController`
(`CustomersController.cs:53`, `:65`, `:82`, `:114`, `:135`, `:150`), all of them gated by
`[HasPermission(IdentityPermissions.CustomersManage)]` (`:55`, `:67`, `:84`, `:116`, `:134`, `:149`), a
capability rather than a role name (ADR-020). `CreateAsync` is the telling one: its remarks say that a
guard which holds by accident is one a later signature change can remove without anyone noticing
(`CustomersController.cs:127-132`). `DeleteAsync` is the odd one out, because it does take a route `id`:
without the override the owner would reach the inherited delete through the filter, and a plain
soft-delete of the Customer row skips the anonymizing erasure (ADR-005), so the override puts the action
behind the management capability and the owner erases through the user-deletion path instead
(`CustomersController.cs:142-147`).

`OrdersController` is the instructive one. It does *not* wear the class-level filter, because an order has
its own id and a separate foreign-key owner, so comparing the route `id` directly to `customer_id` would
be wrong. Instead its mutating endpoints run a per-record ownership check: a private
`ValidateOwnershipAsync` (`OrdersController.cs:386-402`) that delegates to
`OwnershipHelper.ValidateOwnershipAsync` (`OrdersController.cs:390`) with Store's `customer_id` claim and
`RoleNames.Admin` (`:392-393`). The only ownership logic the controller supplies is the existence
predicate, an order with this id whose `CustomerId` is the caller's (`OrdersController.cs:394-396`). The
helper then splits into two denial shapes on purpose. A caller carrying no `customer_id` claim at all gets
`Error.Forbidden`, a 403 (`OwnershipHelper.cs:151-153`): nothing was looked up, so there is no resource
whose existence a 403 could leak, and this matches the filter's own missing-claim `ForbidResult`. Only an
owner *mismatch*, where the claim is present but the order is someone else's, returns `Error.NotFound`, a
**404 rather than a 403** (`OwnershipHelper.cs:167-171`), so the response does not reveal that another
customer's order exists (the rationale is in the helper's remarks, `OwnershipHelper.cs:110-115`, and in
the wrapper's own summary, `OrdersController.cs:381-385`). That is the same axis, fitted to a resource
whose owning id is not its route id by a single predicate.

The query endpoints carry a third guard the mutating check does not need, and both filtered controllers
carry it. Each declares a private `RequireResolvableOwner()` wrapper (`OrdersController.cs:80-85`,
`ShoppingCartsController.cs:79-84`) that delegates to `OwnershipHelper.RequireResolvableOwner` and maps a
failure through `HandleFailure`. In `OrdersController` it runs before the query on both `GetAllAsync`
overloads and `GetByIdAsync` (call sites at `OrdersController.cs:95`, `:129`, `:166`), so a claim-less
non-admin gets the 403 before the query ever runs, mirroring the missing-claim branch of the per-record
check for reads and lists too. `ShoppingCartsController` runs the same gate on its collection reads and
its export (`ShoppingCartsController.cs:100`, `:120` and `:182`), even though its class-level filter
already refuses a claim-less caller through the missing-claim branch: a guard that holds by accident is
one a later change can remove without anyone noticing, so the collection reads state it themselves. Both
controllers' class-level doc comments explain the fail-closed rule (`OrdersController.cs:40-47`,
`ShoppingCartsController.cs:35-44`).

The CSV export is where the two mechanisms meet, and the hook that joins them scopes every read.
`EntityControllerBase.GetReadSpecificationAsync()`
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:571-573`) is virtual and
supplies the specification for every read action, both `GetAllAsync` overloads, `GetAllForLookupAsync`,
`GetByIdAsync` and `ExportAsync` (summary at `EntityControllerBase.cs:535-542`). It defaults to
`GetExportSpecification()` (`EntityControllerBase.cs:601`), itself virtual and `null`. A controller that
overrides neither serves its JSON reads unscoped, but its export does not follow: when the hook resolves
to `null` the export refuses with a 403 carrying `Export.RowScopeRequired` and queries nothing
(`EntityControllerBase.cs:272-274`, the code at `:487`, the error at `:608-613`), unless the controller
opts in to whole-table exports through `AllowUnscopedExport` (`EntityControllerBase.cs:508`, `false` by
default). A forgotten scope therefore serves no rows rather than every row. The export resolves the hook
once per request, so the same instance filters every page it streams (`EntityControllerBase.cs:269-270`),
and a scoped `GetByIdAsync` that filters a row out answers 404 rather than 403, because a "forbidden"
would confirm the id exists (`EntityControllerBase.cs:562-564`). `ShoppingCartsController` overrides the
read hook (`ShoppingCartsController.cs:200-202`, summary `:187-199`) and `OrdersController` overrides the
export hook (`OrdersController.cs:241-242`, summary `:234-240`), both returning the same
`GetOwnershipSpecification()` their list endpoints use, so it is the query and not the role that keeps one
customer out of another's rows. Because that hook returns `null` for an admin, both also set
`AllowUnscopedExport` to the same `OwnershipHelper.IsAdmin` check the hook uses (`OrdersController.cs:249`,
`ShoppingCartsController.cs:209`), so only the bypass role exports the whole table, and each export still
runs the `RequireResolvableOwner` gate (`OrdersController.cs:229`, `ShoppingCartsController.cs:182`) that
rejects the other caller a `null` can stand for. `CustomersController` deliberately does not follow. Its
collection reads are not row-scoped, they are gated by the customer-management capability, so there is
no ownership specification to reproduce, and relaxing the export would make it more permissive than the
list it mirrors (`CustomersController.cs:90-105`, the gate at `:116`). It declares
`AllowUnscopedExport => true` instead (`CustomersController.cs:48`), because every caller who passes that
gate already lists every customer unscoped. The hook exists to make an export match its list endpoints:
where the list is scoped by a query, so is the export, and where the list is gated by a capability, so is
the export.

The options are what make the filter portable, and MMCA.ADC proves it on both halves. ADC applies the same
`OwnerOrAdminFilter` to its two bookmarks GET endpoints as a `[ServiceFilter(typeof(OwnerOrAdminFilter))]`
(`MMCA.ADC/.../Engagement.API/Controllers/BookmarksController.cs:85` for the `[HttpGet]` at `:84`, and
`BookmarksController.cs:106` for the `[HttpGet("session-ids")]` at `:105`), and configures
`OwnerOrAdminFilterOptions` with its own vocabulary in `AddModuleEngagementAPI`
(`Engagement.API/DependencyInjection.cs:43`, the `Configure` call at `:45`): the
`ClaimTypes.NameIdentifier` claim that the JWT bearer handler maps the token's `sub` onto (`:53`, with
the reasoning at `:47-52`), an `Organizer` bypass role (`:54`), and a `userId` query argument instead of a
route `id` (`:55`). The row-level half travels too: two Conference controllers override
`GetExportSpecification()` through the same `OwnershipHelper.GetOwnershipSpecification`, yielding an
`OwnedByUserSpecification` for an attendee and `null` for an Organizer
(`MMCA.ADC/.../Conference.API/Controllers/Events/EventQuestionAnswersController.cs:107-112`,
`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:107-112`), set
`AllowUnscopedExport` to the Organizer check (`:119` in each), and run the framework's resolvable-owner
gate through a private `RequireResolvableOwner()` wrapper (`:135-136` in each). Same filter, same helper,
different words, because the words are options rather than literals.

## Trade-offs, honestly

The §11 review is blunt about the edges of this, and they are real.

- **It is claim-trusting, not ABAC.** Both points key entirely on the configured owner claim
  (`customer_id` by default, `ClaimTypes.NameIdentifier` in ADC) being present and correct. They do not
  evaluate arbitrary resource attributes, ownership hierarchies, or delegated access. The question they
  answer is the narrow "is this row mine," with one bypass role, and nothing richer. If your rules need
  resource attributes or shared ownership, this is not that mechanism, and a parameter would not make it
  that mechanism.
- **Its correctness rests on the token.** Because the check trusts the owner claim, it is exactly as
  trustworthy as the upstream token validation that put the claim there (ADR-004). A missing claim 403s in
  the filter and yields a `null` specification in the helper, and that `null` means "no scoping," so a
  caller must never read a missing claim as the bypass role: that is what `RequireResolvableOwner` exists
  to check, and a controller still has to call it. The validated principal is load-bearing.
- **It is opt-in, so the risk moved rather than vanished.** Neither point is automatic. A controller that
  omits the `[ServiceFilter]`, or a query that forgets to pass the ownership specification, leaks across
  customers silently on its JSON reads. The two-point split sharpens the risk: one route can guard its
  mutations and forget to scope its list, or the reverse. The CSV export is the one read the framework
  closes by default (no row scope means a 403, not the whole table), but `AllowUnscopedExport` is itself
  an opt-in nothing verifies. Inside a controller that *does* wear the filter, deny-by-default makes a
  forgotten guard fail closed and visible: an unresolvable owner parameter 403s rather than slipping
  through, so every exemption is a declared `[AllowMissingOwner]` you have to justify in review. That is a
  better failure mode, not a solved problem, because the attribute is an assertion the compiler cannot
  check. This is the same audit-the-inventory caveat the permission layer and the idempotency filter
  carry, and it is honest to name it.
- **The filter compares an owner parameter, not the resource's own key.** It checks its configured
  `OwnerParameterName` (default `id`), resolved from a route value or a model-bound query or body argument,
  against the configured owner claim. That works when the parameter *is* the owning id, as for a cart or a
  customer profile keyed by the customer. It does not hold for an order, whose own id differs from its
  foreign-key owner, which is why Store's `OrdersController` reaches for the specification and an explicit
  check instead of the class filter. The comparison is still claim-trusting and not ABAC: it matches an id
  against a claim, it does not evaluate resource attributes. Pick the tool that matches how the resource is
  keyed.

None of these argue for leaving ownership implicit. They are the boundary of what a claim-trusting
ownership axis is for, and the boundary is the point.

## Apply this even without MMCA

The pattern carries to any web API, framework or not:

1. **Treat ownership as a second axis, not a corollary of the role check.** "May read orders" and "may
   read *this* order" are different questions. Answer both, explicitly, at every route that takes an id.
2. **Split reject-one from filter-many.** Single-resource routes 403 on a mismatch. Collection routes
   push an ownership predicate into the query so the list comes back already scoped. Do not try to make
   one mechanism do both: post-filtering a fetched list leaks and breaks paging counts.
3. **Express the row-scope as a composable predicate.** A specification (or any reusable, query-translatable
   predicate) lets the ownership filter ride the same query path as sorting and paging, and `And`-compose
   with whatever else the query already filters on.
4. **Give the two points one shared bypass, and let the host name it.** Define "may see everything" once,
   have both the filter and the query-scoper consult it, and keep the role name in configuration so the
   library never ships a role your application did not declare.
5. **Trust the claim only as far as you trust the token.** Ownership keyed on a claim is only as sound as
   the validation that issued it, and a missing claim must fail closed, never default to the bypass role.

The takeaway: **a passing role check is half an answer. RBAC tells you the caller may perform the action;
ownership tells you which rows the action may touch, and a route that handles user data needs both, kept
as separate, composable checks.**

---

**What we covered:** why a role check that passes can still leak another customer's data (the Broken
Object Level Authorization / IDOR risk RBAC structurally cannot see), the axis Article 24 explicitly
scoped out, how MMCA.Common fills it with two enforcement points (`OwnerOrAdminFilter` that 403s a
single-resource route whose `id` mismatches the caller's owner claim, and `OwnershipHelper` that
builds an ownership `Specification` to row-scope collection queries) sharing one `IsAdmin` bypass whose
role name the host supplies, plus the helper's two fail-closed checks (a resolvable-owner gate and a
per-record check), why the
filter denies when it cannot resolve an owner parameter and how `[AllowMissingOwner]` makes each exemption
explicit, how MMCA.Store wires all of it (why `OrdersController` splits its denials through the helper,
403 for a missing claim and 404 for someone else's order, instead of using the class filter, and how both
Sales controllers row-scope their CSV export through the `GetReadSpecificationAsync` and
`GetExportSpecification` hooks rather than gating it to a role, while the framework refuses an unscoped
export by default), and the honest limits: it is
claim-trusting not ABAC, it trusts the token (ADR-004), and it is opt-in so a controller that never
applies it still leaks.

**Next in the series:** defending the API edge, rate limiting for authenticated callers and brute-force
protection for the anonymous auth surface.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-033 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-033 (resource-ownership authorization): `Website/docs-src/adr/033-resource-ownership-authorization.md` in the docs site.

*Tags: .NET, C Sharp, Security, Software Architecture, Web API*

*Notes: 2026-10-02 refresh against MMCA.Common v1.221.0 (the consumers pin `MMCA.Common.*` 1.221.0,
`MMCA.Store/Directory.Packages.props:8`). Three corrections are content rather than anchors. First,
`OwnershipHelper` carries the two fail-closed checks itself: `RequireResolvableOwner<TId>`
(`OwnershipHelper.cs:91`-`:104`) and `ValidateOwnershipAsync<TId>` (`:133`-`:157`), added in v1.216.0 per
ADR-033 Revision 2026-10-01 (`033-resource-ownership-authorization.md:330`-`:354`, the version at
`:332`); Store's and ADC's controllers keep only thin private wrappers that delegate, and the former
`IsAdmin` property on `OrdersController` does not exist. Second, the framework export fails closed: a
null read specification without `AllowUnscopedExport` answers 403 `Export.RowScopeRequired`, so the prior
"a controller that overrides neither queries unscoped" is true of the JSON reads only, and Orders,
ShoppingCarts and both ADC question-answer controllers override `AllowUnscopedExport` to their bypass
check while `CustomersController` sets it `true`. Third, `[AllowMissingOwner]` sites went from nine to ten
(`CustomersController.DeleteAsync`, which carries a route `id`). Anchors confirmed unchanged this run (per
the 2026-10-02 audit): `OwnerOrAdminFilter`
(`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31`, parameters `:32`-`:33`,
bypass `:43`, claim `:49`, missing-claim 403 `:51`,`:53`, `TryGetOwnerParameter` call `:57`, deny `:63`,
`HasAllowMissingOwner` `:61`/`:84`, mismatch `:73`,`:75`, fall-through `:79`, resolver `:93`, route
`:95`-`:97`, bound argument `:102`-`:104`); `OwnerOrAdminFilterOptions.cs:16` (`customer_id`), `:23`-`:24`
(`[Required]` `BypassRole`), `:31` (`id`); `AllowMissingOwnerAttribute.cs:20`-`:21`; `AddAPI`
(`DependencyInjection.cs:45`, scoped filter `:85`, options `:91`-`:92`, rationale `:87`-`:90`);
`Specification.cs:15`, `:23`, `AndSpecification` `:81`; `ICurrentUserService.cs:22`;
`ShoppingCartByCustomerSpecification.cs:24`; `OrdersByCustomerSpecification.cs:18`; ADC
`BookmarksController.cs:84`-`:85`, `:105`-`:106` and `Engagement.API/DependencyInjection.cs:43`, `:45`,
`:47`-`:55`. Read this run: `OwnershipHelper` static class `:11`; `IsAdmin` `:18` (doc `:13`-`:17`,
no-role-names sentence `:16`, `OrdinalIgnoreCase` compare `:21`); `GetOwnershipSpecification<TSpec,TId>`
`:35` (`bypassRole` `:39`, bypass null `:46`,`:48`, claim `:51`, factory `:52`); `customer_id` overload
`:65`-`:70` (literal `:70`, `bypassRole` `:68`); `RequireResolvableOwner` result `:101`-`:103`;
`ValidateOwnershipAsync` remarks `:110`-`:115`, bypass `:146`, missing claim 403 `:151`-`:153`,
`CheckOwnershipAsync` 404 `:167`-`:171`; `AccessDenied` `:174`-`:175`. Store filter `BypassRole`:
`Sales.API/DependencyInjection.cs:50`, `Identity.API/DependencyInjection.cs:64`. `OrdersController`:
class doc fail-closed paragraph `:40`-`:47`; `GetOwnershipSpecification()` `:66`-`:68` (`RoleNames.Admin`
`:68`); `RequireResolvableOwner()` wrapper `:80`-`:85` (summary `:70`-`:79`), called `:95`, `:129`,
`:166` and in the export `:229`; specification passed `:102`, `:140`, `:174`; export summary `:194`-`:212`
(the v1.150.0-to-v1.151.0 rationale `:198`-`:204`); `GetExportSpecification` override `:241`-`:242`
(summary `:234`-`:240`); `AllowUnscopedExport` `:249`; `ValidateOwnershipAsync` wrapper `:386`-`:402`
(summary `:381`-`:385`, helper call `:390`, claim and role `:392`-`:393`, existence predicate
`:394`-`:396`). `ShoppingCartsController`: class doc fail-closed paragraph `:35`-`:44`; filter `:50`;
`GetOwnershipSpecification()` `:65`-`:67`; wrapper `:79`-`:84`; `[AllowMissingOwner]` `:92`, `:107`,
`:136`, `:172`; gate calls `:100`, `:120`, `:182`; lookup `[HasPermission]` `:138`;
`GetReadSpecificationAsync` override `:200`-`:202` (summary `:187`-`:199`); `AllowUnscopedExport` `:209`.
`CustomersController`: filter `:35`; `AllowUnscopedExport => true` `:48`; `[AllowMissingOwner]` `:53`,
`:65`, `:82`, `:114`, `:135`, `:150`; `[HasPermission(IdentityPermissions.CustomersManage)]` `:55`,
`:67`, `:84`, `:116`, `:134`, `:149`; export rationale `:90`-`:105`; `CreateAsync` remarks `:127`-`:132`;
`DeleteAsync` remarks `:142`-`:147`. `EntityControllerBase`
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs`): export fail-closed remarks
`:231`-`:238`; resolved once `:269`-`:270`; refusal `:272`-`:274`; `ExportRowScopeRequiredErrorCode`
`:487`; `AllowUnscopedExport` `:508` (default false, doc `:489`-`:507`); `GetReadSpecificationAsync`
`:571`-`:573` (summary `:535`-`:542`, 404-not-403 `:562`-`:564`, once-per-request `:567`-`:568`);
`GetExportSpecification` `:601`; `UnscopedExportRefused` `:608`-`:613`; `GetByIdAsync` 404 remarks
`:351`-`:353`. ADC Conference: `EventQuestionAnswersController.cs` and `SessionQuestionAnswersController.cs`
each override `GetExportSpecification()` at `:107`-`:112`, `AllowUnscopedExport` (Organizer) at `:119`,
and declare the delegating `RequireResolvableOwner()` at `:135`-`:136`. ADC Bookmarks POST-create keeps an
inline non-Organizer check (`BookmarksController.cs:50`, `callerId` `:66`, comparison `:67`, `Forbidden`
`:69`), not the filter. The single code block is illustrative-of-shape, assembled from the real members:
the filter excerpt mirrors `OwnerOrAdminFilter.cs:43-79`, the two controller members are
`OrdersController.cs:66-68` and `:80-85`. Broken Object Level Authorization / IDOR as OWASP API1 is
industry framing, not a code claim; the Article 24 trade-offs quotation was confirmed by the audit
(`permission-based-authorization.md:157`). ADR: `Website/docs-src/adr/033-resource-ownership-authorization.md`
(deny-by-default bullet `:80`-`:91`; two failure shapes `:92`-`:94`; Store adoption and the per-record
split `:100`-`:130`; the "a null specification means two different things" block `:132`-`:146`; ADC
vocabulary `:148`-`:162`; the `[AllowMissingOwner]` audit table `:164`-`:175`; Revision 2026-09-10 (ADC
both halves) `:294`-`:328`; Revision 2026-10-01 (gate and per-record check in the helper) `:330`-`:354`).
The ADR's own consumer anchors are partly stale (it cites `ValidateOwnershipAsync` at
`OrdersController.cs:379-395` and the ADC wrappers at `:128-136`), so every consumer anchor above is read
from the controller source rather than from the ADR.*

- Full series index: https://ivanball.github.io/writing.html
