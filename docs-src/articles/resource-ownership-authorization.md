# Resource-ownership authorization: which rows you may touch, not just which actions

> Series: MMCA.Common · Article #29 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-033 ·
> Status: grounded in `Website/docs-src/adr/033-resource-ownership-authorization.md`, the
> `MMCA.Common.API/Authorization` source (`OwnerOrAdminFilter`, `AllowMissingOwnerAttribute`,
> `OwnershipHelper`), the `EntityControllerBase.GetReadSpecificationAsync` and
> `GetExportSpecification` hooks, the `MMCA.Common.Domain` `Specification` base, and the MMCA.Store
> and MMCA.ADC adoptions. No em dashes.

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
owner parameter to compare.

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
(`033-resource-ownership-authorization.md:71-82`). An action that genuinely has no owner parameter says
so out loud with `[AllowMissingOwner]`
(`Source/Presentation/MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21`, an
`AttributeTargets.Class | AttributeTargets.Method` attribute with `Inherited = true`,
`AllowMissingOwnerAttribute.cs:20`), which the filter honors on the action or its declaring controller
through the endpoint metadata (`HasAllowMissingOwner`, `OwnerOrAdminFilter.cs:61`,
`OwnerOrAdminFilter.cs:84`). The opt-out excuses a *missing* parameter only: an action carrying a foreign
owner id is still denied, and a missing owner claim is still denied regardless.

**Collection routes get an ownership Specification.** `OwnershipHelper`
(`Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:10`) is a static helper. Its
`GetOwnershipSpecification<TSpec, TId>` (`OwnershipHelper.cs:34`) takes the bypass role as a required
argument (`OwnershipHelper.cs:38`) and returns `null` for a caller who holds it
(`OwnershipHelper.cs:45`, `OwnershipHelper.cs:47`), and otherwise reads the caller's id claim
(`GetClaimValue<TId>(claimType)`, `OwnershipHelper.cs:50`) and builds a specification through a supplied
factory (`OwnershipHelper.cs:51`); a convenience overload defaults the claim name to `"customer_id"`
(`OwnershipHelper.cs:64-69`, the literal at `:69`) and still requires the role (`:67`). The object it
hands back is a `Specification<TEntity, TIdentifierType>`
(`Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`) whose `Criteria` is an
EF-translatable expression tree (`Specification.cs:23`). That is the same specification type from Article
6: it slots straight into the existing query pipeline, which translates the predicate to SQL, so a scoped
list query returns only the caller's rows. A `null` specification (the bypass case) applies no filter,
and because these are real specifications they compose, an `AndSpecification` (`Specification.cs:81`)
ties the ownership scope to any other criteria a query already carries.

**One bypass role, on both.** Both points call `OwnershipHelper.IsAdmin` (`OwnershipHelper.cs:17`), which
compares `ICurrentUserService.Role`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:22`) to the
`bypassRole` its caller supplies, case-insensitively (`OwnershipHelper.cs:20`). That parameter has no
default value, and the XML doc says why: the framework declares no role names
(`OwnershipHelper.cs:13-15`). MMCA.Store passes its own `RoleNames.Admin` at both points
(`OrdersController.cs:67`, `OrdersController.cs:69-71`). One predicate, consulted by the filter and by
the helper, so a privileged caller sees and touches any resource through either path and you do not
maintain two definitions of "may see everything."

Notice the two deliberately different failure shapes. The single-resource filter denies with a 403
`ForbidResult`. The collection path never 403s: it returns a filtered, possibly empty, result set. Both
flow through the caller's normal `Result`/HTTP edge, not exceptions.

```csharp
// Illustrative of shape: the two enforcement points, assembled from the real members.

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
```

## How MMCA.Store wires it

This is not framework-only theory. MMCA.Store turns both points on in production. The filter guards the
shopping-cart and customer-profile controllers as a class-level
`[ServiceFilter(typeof(OwnerOrAdminFilter))]`
(`MMCA.Store/.../Sales.API/Controllers/ShoppingCartsController.cs:50`,
`MMCA.Store/.../Identity.API/Controllers/CustomersController.cs:35`). The ownership specification scopes
the list and read queries: `ShoppingCartsController` builds a `ShoppingCartByCustomerSpecification`
through a private `GetOwnershipSpecification()` method (`ShoppingCartsController.cs:67-69`) that filters
by `Id`, because a cart is keyed by its customer
(`ShoppingCartByCustomerSpecification.cs:24`, `cart => cart.Id.Equals(customerId)`), and `OrdersController`
builds an `OrdersByCustomerSpecification` the same way
(`OrdersController.cs:69-71`) that filters by `CustomerId`
(`OrdersByCustomerSpecification.cs:18`, `order => order.CustomerId.Equals(customerId)`), passing it into
each of its three query call sites (`OrdersController.cs:110`, `:148`, `:182`). Both hand the helper
Store's own `RoleNames.Admin`, because the framework offers no role name to fall back on.

Because both filtered controllers apply the filter at class level, deny-by-default forced an audit of
every action on them, and the ones with no owner parameter carry `[AllowMissingOwner]`: nine
application sites across the two, each with a comment naming the guard that replaces the parameter check.
Four are on `ShoppingCartsController` (`ShoppingCartsController.cs:99`, `:114`, `:143`, `:179`): the two
cart list overloads are narrowed to the caller by the controller's `GetReadSpecificationAsync` override,
so ownership is enforced in the query rather than on a route value, the lookup endpoint is gated by
`[HasPermission(SalesPermissions.ShoppingCartsManage)]` (`:145`), and the CSV export is row-scoped the
same way the lists are (more on that below). Five are on `CustomersController`
(`CustomersController.cs:50`, `:62`, `:79`, `:111`, `:132`), all of them gated by
`[HasPermission(IdentityPermissions.CustomersManage)]` (`:52`, `:64`, `:81`, `:113`, `:131`), a capability
rather than a role name (ADR-020). The last of those, `CreateAsync`, is the telling one: its remarks say
that a guard which holds by accident is one a later signature change can remove without anyone noticing
(`CustomersController.cs:124-129`).

`OrdersController` is the instructive one. It does *not* wear the class-level filter, because an order has
its own id and a separate foreign-key owner, so comparing the route `id` directly to `customer_id` would
be wrong. Instead it runs an explicit per-mutation ownership check, `ValidateOwnershipAsync`
(`OrdersController.cs:507`), which reuses the same `OwnershipHelper.IsAdmin` bypass through its `IsAdmin`
property (`OrdersController.cs:67`) and then splits into two denial shapes on purpose. A caller carrying no
`customer_id` claim at all gets `Error.Forbidden`, a 403 (`OrdersController.cs:515`,
`OrdersController.cs:517-521`): nothing was looked up, so there is no resource whose existence a 403 could
leak, and this matches the filter's own missing-claim `ForbidResult`. Only an owner *mismatch*, where the
claim is present but the order is someone else's, returns `Error.NotFound`, a **404 rather than a 403**
(`OrdersController.cs:530-532`), so the response does not reveal that another
customer's order exists (the rationale is in the method's own summary, `OrdersController.cs:502-506`).
That is the same axis, hand-fit to a resource whose owning id is not its route id.

The query endpoints carry a third guard the mutating check does not need, and both filtered controllers
carry it. `RequireResolvableOwner` (`OrdersController.cs:83-93`) runs before the query on both
`GetAllAsync` overloads and `GetByIdAsync` (call sites at `OrdersController.cs:103`, `:137`, `:174`). It
exists because `GetOwnershipSpecification()` returns `null` for two different reasons, a bypass-role
caller (scoping deliberately skipped) or a caller whose `customer_id` claim cannot be resolved, and only
the first may run unscoped. `RequireResolvableOwner` rejects the second with the same `Error.Forbidden`,
a 403, before the query ever runs, mirroring the missing-claim branch of `ValidateOwnershipAsync` for
reads and lists too. `ShoppingCartsController` carries an identically named gate
(`ShoppingCartsController.cs:81-91`, called at `:107`, `:127` and `:189`), even though its class-level
filter already refuses a claim-less caller through the missing-claim branch: a guard that holds by
accident is one a later change can remove without anyone noticing, so the collection reads state it
themselves. Both controllers' class-level doc comments name the pair that fail closed
(`OrdersController.cs:38-45`, `ShoppingCartsController.cs:35-44`).

The CSV export is where the two mechanisms meet, and the hook that joins them scopes every read. Without
a scoping hook the framework export would query with `specification: null`, and a Customer-role token
would read every customer's rows, so the gate is an extension point rather than a blanket role lock:
`EntityControllerBase.GetReadSpecificationAsync()`
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:597-599`) is virtual and
supplies the specification for every read action, both `GetAllAsync` overloads, `GetAllForLookupAsync`,
`GetByIdAsync` and `ExportAsync` (summary at `EntityControllerBase.cs:562-567`). It defaults to
`GetExportSpecification()` (`EntityControllerBase.cs:626`), itself virtual and `null`, so a controller
that overrides neither queries unscoped. The export resolves the hook once per request, so the same
instance filters every page it streams (`EntityControllerBase.cs:263-264`), and a scoped `GetByIdAsync`
that filters a row out answers 404 rather than 403, because a "forbidden" would confirm the id exists
(`EntityControllerBase.cs:588-590`). `ShoppingCartsController` overrides the read hook
(`ShoppingCartsController.cs:207-209`, summary `:194-198`) and `OrdersController` overrides the export
hook (`OrdersController.cs:249-250`, summary `:242-247`), both returning the same
`GetOwnershipSpecification()` their list endpoints use, so it is the query and not the role that keeps one
customer out of another's rows, and each export still runs the `RequireResolvableOwner` gate
(`OrdersController.cs:237`, `ShoppingCartsController.cs:189`) that rejects the other caller a `null` can
stand for. `CustomersController` deliberately does not follow. Its collection reads are not row-scoped,
they are gated by the customer-management capability, so there is no ownership specification to reproduce,
and relaxing the export would make it more permissive than the list it mirrors
(`CustomersController.cs:87-102`, the gate at `:113`). The hook exists to make an export match its list
endpoints: where the list is scoped by a query, so is the export, and where the list is gated by a
capability, so is the export.

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
(`MMCA.ADC/.../Conference.API/Controllers/Events/EventQuestionAnswersController.cs:85-90`,
`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:107-112`). Same
filter, same helper, different words, because the words are options rather than literals.

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
  caller must never read a missing claim as the bypass role. The validated principal is load-bearing.
- **It is opt-in, so the risk moved rather than vanished.** Neither point is automatic. A controller that
  omits the `[ServiceFilter]`, or a query that forgets to pass the ownership specification, leaks across
  customers silently. The two-point split sharpens the risk: one route can guard its mutations and forget
  to scope its list, or the reverse. Inside a controller that *does* wear the filter, deny-by-default
  makes a forgotten guard fail closed and visible: an unresolvable owner parameter 403s rather than
  slipping through, so every exemption is a declared `[AllowMissingOwner]` you have to justify in review.
  That is a better failure mode, not a solved problem, because the attribute is an assertion the compiler
  cannot check. This is the same audit-the-inventory caveat the permission layer and the idempotency
  filter carry, and it is honest to name it.
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
role name the host supplies, why the
filter denies when it cannot resolve an owner parameter and how `[AllowMissingOwner]` makes each exemption
explicit, how MMCA.Store wires all of it (why `OrdersController` splits its denials, 403 for a missing
claim and 404 for someone else's order, instead of using the class filter, and how both Sales controllers
row-scope their CSV export through the `GetReadSpecificationAsync` and `GetExportSpecification` hooks
rather than gating it to a role), and the honest limits: it is
claim-trusting not ABAC, it trusts the token (ADR-004), and it is opt-in so a controller that never
applies it still leaks.

**Next in the series:** defending the API edge, rate limiting for authenticated callers and brute-force
protection for the anonymous auth surface.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-033 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-033 (resource-ownership authorization): `Website/docs-src/adr/033-resource-ownership-authorization.md` in the docs site.

*Tags: .NET, C Sharp, Security, Software Architecture, Web API*

*Notes: re-verified every type, behavior and line against MMCA.Common v1.205.0 and the consumer sources
this run. Two corrections are content rather than anchors. First, the framework declares no role names:
`OwnerOrAdminFilterOptions.BypassRole` is `[Required]` with no default and `OwnershipHelper.IsAdmin`
takes the bypass role from its caller, so the prior "default `Admin`" wording was wrong, not merely
mis-anchored. Second, `EntityControllerBase` scopes every read action through `GetReadSpecificationAsync`,
with `GetExportSpecification` as its default, so the hook is not export-only. Everything else is anchor
drift. `OwnerOrAdminFilter`: sealed `IAsyncActionFilter` whose primary constructor takes
`ICurrentUserService` and `IOptions<OwnerOrAdminFilterOptions>`
(`Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:31`, parameters `:32`-`:33`);
bypass-role short-circuit passing `settings.BypassRole` (`:43`, `await next()` at `:45`),
`GetClaimValue<int>(settings.OwnerClaimType)` (`:49`), 403 `ForbidResult` on a missing claim
(`:51`,`:53`). **Deny by default**: when `TryGetOwnerParameter` fails (`:57`) the request is forbidden
(`:63`) unless `HasAllowMissingOwner` (`:61`, defined `:84`-`:85`, reading
`context.ActionDescriptor.EndpointMetadata`) finds the opt-out, in which case it calls `await next()`
(`:67`); a resolved-but-mismatched owner parameter is forbidden (`:73`,`:75`); only a match falls through
(`:79`). The owner value is resolved by `TryGetOwnerParameter` (`:93`) from a route value (`:95`-`:97`)
or, failing that, from a model-bound query/body argument (`:102`-`:104`), both parsed with
`CultureInfo.InvariantCulture` (comment `:89`-`:92`). `AllowMissingOwnerAttribute` is the third public
piece: a sealed `Attribute` (`AllowMissingOwnerAttribute.cs:21`) with
`[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]`
(`:20`), documented as an assertion that another guard applies, to be named in a comment at each site
(`:15`-`:18`). `OwnerOrAdminFilterOptions` carries `OwnerClaimType` (default `customer_id`,
`OwnerOrAdminFilterOptions.cs:16`), `BypassRole` (`[Required]`, initialized to `string.Empty`,
`:23`-`:24`, documented `:18`-`:22`) and `OwnerParameterName` (default `id`, `:31`). `AddAPI` (declared
`DependencyInjection.cs:45`) registers the filter scoped (`:85`) and the options with
`ValidateDataAnnotations()` but deliberately not `ValidateOnStart()` (`:91`-`:92`, rationale `:87`-`:90`).
`OwnershipHelper`: static (`OwnershipHelper.cs:10`); `IsAdmin(ICurrentUserService, string bypassRole)`
takes the role with no default (`:17`, doc `:13`-`:15`) and compares `ICurrentUserService.Role`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ICurrentUserService.cs:22`) to it
with `OrdinalIgnoreCase` (`:20`); `GetOwnershipSpecification<TSpec,TId>` (`:34`-`:40`, `bypassRole`
parameter `:38`) returns null for the bypass role (`:45`,`:47`), reads `GetClaimValue<TId>(claimType)`
(`:50`) and builds through the factory (`:51`); the `customer_id` convenience overload is `:64`-`:69`
(the literal at `:69`, its required `bypassRole` at `:67`). `Specification<TEntity,TIdentifierType>` is
abstract with an EF-translatable `Criteria` (`Specification.cs:15`,`:23`), and
`AndSpecification<TEntity,TIdentifierType>` is declared at `:81`. Store adoption:
`[ServiceFilter(typeof(OwnerOrAdminFilter))]` on `ShoppingCartsController.cs:50` and
`CustomersController.cs:35`; `ShoppingCartByCustomerSpecification` filters by `Id` (built by the private
`GetOwnershipSpecification()` at `ShoppingCartsController.cs:67`-`:69` with `RoleNames.Admin`, consumed
once through the `GetReadSpecificationAsync` override at `:207`-`:209`;
`ShoppingCartByCustomerSpecification.cs:24`); `OrdersByCustomerSpecification` filters by `CustomerId`
(`OrdersController.cs:69`-`:71`, passed at `:110`,`:148`,`:182`; `OrdersByCustomerSpecification.cs:18`).
NINE `[AllowMissingOwner]` application sites, all in Store:
`ShoppingCartsController.cs:99`,`:114`,`:143`,`:179` (the two list overloads and the export are row-scoped
by `GetReadSpecificationAsync` per the comments at `:94`-`:96`, `:113` and `:177`-`:178`; lookup is gated
by `[HasPermission(SalesPermissions.ShoppingCartsManage)]` at `:145`) and
`CustomersController.cs:50`,`:62`,`:79`,`:111`,`:132` (all gated by
`[HasPermission(IdentityPermissions.CustomersManage)]` at `:52`,`:64`,`:81`,`:113`,`:131`, a capability
rather than a role name; the `CreateAsync` remarks at `:124`-`:129` state why the guard is declared rather
than left to the filter). `OrdersController` runs `ValidateOwnershipAsync` (`:507`, summary `:502`-`:506`)
reusing `OwnershipHelper.IsAdmin` through its `IsAdmin` property (`:67`) with TWO denial shapes:
`Error.Forbidden`/403 when the `customer_id` claim is missing (`:515`,`:517`-`:521`) and
`Error.NotFound`/404 only on an owner mismatch (`:530`-`:532`). Its query actions also run a third guard,
`RequireResolvableOwner` (`:83`-`:93`, summary `:73`-`:82`), called at the three query call sites (`:103`,
`:137`, `:174`) and a fourth time in the export override (`:237`); the class doc comment (`:34`-`:46`,
fail-closed paragraph `:38`-`:45`) names both checks as the pair that fail closed. `ShoppingCartsController`
carries the identically named gate (`:81`-`:91`, called at `:107`, `:127`, `:189`) with the same rationale
in its class doc comment (`:32`-`:45`, fail-closed paragraph `:35`-`:44`). Read scoping:
`EntityControllerBase.GetReadSpecificationAsync` is virtual and covers every read action
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:597`-`:599`, summary
`:562`-`:567`, the 404-not-403 note at `:588`-`:590`), defaulting to the virtual `GetExportSpecification()`
which returns null (`:626`); the export resolves it once per request (`:263`-`:264`).
`ShoppingCartsController` overrides the read hook (`:207`-`:209`, summary `:194`-`:198`) and
`OrdersController` overrides the export hook (`:249`-`:250`, summary `:242`-`:247`, with the
v1.150.0-Admin-gate-to-v1.151.0-row-scope rationale at `:202`-`:220`), both returning
`GetOwnershipSpecification()`. `CustomersController.ExportAsync` stays gated by the customer-management
capability (`:87`-`:102`, the gate at `:113`) because its collection reads are gated the same way rather
than row-scoped. ADC adoption, both halves: `OwnerOrAdminFilter` guards the two Bookmarks GET endpoints as
`[ServiceFilter(typeof(OwnerOrAdminFilter))]`
(`MMCA.ADC/.../Engagement.API/Controllers/BookmarksController.cs:85`, with `[HttpGet]` at `:84`, and
`:106`, with `[HttpGet("session-ids")]` at `:105`); the POST-create (`[HttpPost]` at `:50`) is an inline
non-Organizer check (`:64`-`:71`, `request.UserId != callerId.Value` at `:67`, `Forbidden` return at
`:69`), not the filter. It is configured with `options.OwnerClaimType = ClaimTypes.NameIdentifier`
(`Engagement.API/DependencyInjection.cs:53`, the `sub`-to-`NameIdentifier` mapping explained at
`:47`-`:52`), `RoleNames.Organizer` as the bypass (`:54`) and `userId` as the parameter (`:55`), inside
`AddModuleEngagementAPI` (declared `:43`, `services.Configure<OwnerOrAdminFilterOptions>` at `:45`).
The row-level half: `EventQuestionAnswersController` overrides `GetExportSpecification()` through
`OwnershipHelper.GetOwnershipSpecification` with `ClaimTypes.NameIdentifier` and `RoleNames.Organizer`
(`MMCA.ADC/.../Conference.API/Controllers/Events/EventQuestionAnswersController.cs:85`-`:90`), and
`SessionQuestionAnswersController` does the same
(`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:107`-`:112`). The
single code block is illustrative-of-shape, assembled from the real members: the filter excerpt mirrors
the options-driven `OwnerOrAdminFilter.cs:43-79` and the controller method is `OrdersController.cs:69-71`.
Broken Object Level Authorization / IDOR as OWASP API1 is industry framing, not a code claim, and the
Article 24 trade-offs quotation was not re-opened this run. ADR:
`Website/docs-src/adr/033-resource-ownership-authorization.md` (deny-by-default at `:71`-`:82`; the
two-status split at `:112`-`:120`, intro `:112`-`:113`, the 403 missing-claim bullet `:115`-`:117`, the
404 owner-mismatch bullet `:118`-`:120`; the `[AllowMissingOwner]` audit table at `:156`-`:162`; the
"a null specification means two different things" block on `RequireResolvableOwner` at `:122`-`:134`; ADC's
adoption of both halves in the Revision (2026-09-10) at `:278`-`:302`). The ADR's own per-file anchors are
themselves stale, citing `ValidateOwnershipAsync` at `OrdersController.cs:414` and the export override at
`:244`-`:245`, so every consumer anchor above is read from the controller source rather than from the ADR.*

- Full series index: https://ivanball.github.io/writing.html
