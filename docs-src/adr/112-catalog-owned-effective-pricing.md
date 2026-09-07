# ADR-112: Catalog Owns Effective Pricing; Sales Snapshots It at Checkout

## Status
Accepted (2026-09-07).

## Context
MMCA.Store sells product variants, and a variant's price is one `Money` on the variant row
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs:26`).
Merchandising wants to run a sale: a percentage off, or a fixed special price, on one variant or
across a whole product, optionally bounded by a start and an end.

Two things constrain the answer. First, Catalog and Sales are separate services with separate
databases (ADR-005, ADR-006), talking over a `[ServiceContract]` interface whose purity is
build-enforced (ADR-007,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IProductVariantService.cs:34`).
Any pricing model that needs Sales to understand promotions grows that wire surface and makes the
extraction harder to reverse. Second, checkout already freezes a price: `CheckOutHandler` fetches
unit prices from Catalog and `CheckOutDomainService` copies them onto order lines
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:65-67`,
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/CheckOutDomainService.cs:113-121`).
The cart stores quantities, not money.

The tempting shape is a Promotion aggregate with its own lifecycle, targets and precedence rules.
That is a pricing engine, and it puts the question "what does this cost" in a third place that both
Catalog and Sales would have to consult.

## Decision
**Promotional pricing is a variant-level owned value object, not an aggregate.** `VariantDiscount`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/VariantDiscount.cs:26`) is a
sealed record deriving from `ValueObject`: a `Kind` (percentage or special price), the figure, an
optional inclusive-start / exclusive-end window, and an optional label capped at 50 characters. It
has no identity, it is replaced wholesale, and it is flattened onto the variant's row as nullable
columns
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:45-93`,
migration `20260907185422_AddProductVariantDiscounts`, add-only per ADR-057). Product-level
discounting is fan-out over the same value object, all or
nothing: `Product.SetDiscountOnAllVariants` validates the discount against every active variant's
list price before it touches any of them
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:583-606`).

**The list price is preserved and the effective price is computed in one method.**
`ProductVariant.Price` stays the list price whatever the discount says, so clearing a discount
restores the original price with no bookkeeping. `ProductVariant.GetEffectivePrice(now)` and its
static twin `ResolveEffectivePrice` are the single computation
(`ProductVariant.cs:164-184`): they return the list price when there is no discount, when the window
does not cover `now`, and when the stored pairing no longer resolves. Every caller goes through it:
the DTO mapper for the read model
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/DTOs/ProductVariantDTOMapper.cs:40-41`)
and the cross-module pricing service over its projection
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/ProductVariantService.cs:84-90`),
both against an injected `TimeProvider`.

**Sales re-fetches at checkout and stores no cart price.** `IProductVariantService.GetUnitPricesAsync`
returns the effective price rather than the list price, so `CheckOutHandler`, `CheckOutDomainService`
and `Order.Create` are unchanged: the discounted amount lands on `OrderLine.UnitPrice`, and the
receipt and the Stripe total follow from it. Neither the gRPC contract nor the
`ProductVariantChanged` integration event grows a field: the event keeps carrying the list price
(`Product.cs:545-546`), which is what its consumers denormalize, so ADR-010's schema-version rule is
not engaged and ADR-083's one-lifecycle-event-per-entity taxonomy is unchanged.

**The effective price must stay above zero.** Sales' order-line validator rejects a non-positive unit
price
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Validation/OrderLineValidationRules.cs:33`),
so a discount that resolves to zero would produce a variant that can be added to a cart and never
checked out. Catalog refuses that pairing at the write instead: `VariantDiscount.ApplyTo` fails with
`EffectivePriceNotPositive` (`VariantDiscount.cs:61-62,216-218,237-239`), which in practice means a
zero-priced variant cannot carry a discount at all.

The three write endpoints are gated on `catalog:pricing:manage`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Authorization/CatalogPermissions.cs:29`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ProductVariantsController.cs:150-151,177-178`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ProductsController.cs:248-249`), a narrower
permission than variant management, and follow ADR-035's two-token rule: the product ETag in
`If-Match`, the variant row version in the body.

## Rationale
A discount that belongs to exactly one variant, is replaced rather than edited, and has no life of
its own once the variant is gone is a value object by every test we apply elsewhere
([ADR-068](068-value-objects-as-validated-primitives.md)). Making
it an aggregate would buy independent identity nobody asked for and an extra join on the hot read
path.

Keeping the list price is what makes "clear the discount" a one-line operation and what lets the
storefront show a struck-through original. A model that overwrote the price would have to store the
old one somewhere anyway, which is the same field with worse naming.

Putting the computation in the domain, and having the cross-service method return its result, keeps
the pricing decision inside the service that owns pricing. Sales asks what a variant costs and gets
the number to charge; it never learns what a window or a percentage is. That is what leaves the wire
contract and the event contract untouched: the feature is entirely additive across the module
boundary, which is the property ADR-007 exists to protect.

Checkout re-fetching rather than trusting a cart price is not new here, it is the existing rule
(prices lock at checkout, not at cart-add) and it happens to be exactly what a timed promotion needs:
a sale that ends between cart-add and checkout charges the list price, with no reconciliation job.

## Trade-offs
- **Cached reads lag a window boundary by up to five minutes.** The three write commands implement
  `ICacheInvalidating` and their controllers evict the `catalog:products` output-cache tag, so an
  admin edit is visible at once. A window that opens or closes on the clock evicts nothing, so a
  cached storefront read can show the pre-boundary price until the tag's five-minute TTL expires
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:155`). Checkout is never stale
  because it is a live cross-service call.
- **Order lines record neither the list price nor the promotion name.** A line carries one number, the
  amount charged. "This was 20% off Summer Sale" is not answerable from an order after the fact.
  Deliberate: adding those fields is an order-schema change, and nothing today asks the question.
- **No coupon codes, no category-wide or basket-level promotions, no stacking.** One discount per
  variant, replaced wholesale. A future Promotion aggregate is not foreclosed: it would resolve into
  the same `ResolveEffectivePrice` call, which is the one place a price is decided.
- **A discount cannot be applied to a free variant, and a discounted variant's list price cannot be
  changed to an inconsistent value.** `ChangePrice` fails rather than silently dropping the discount
  (`ProductVariant.cs:106-122`), so an admin repricing a variant on sale has to clear the discount
  first. Failing loudly beats repricing a storefront nobody asked to reprice.
- **Two clocks answer the same question.** The DTO's `IsActive` flag and the checkout price are both
  resolved server-side against `TimeProvider`, but at different instants, so a shopper can see a sale
  price on a page and be charged list price seconds later at a window boundary. Accepted as the cost
  of not pinning a promotion into the cart.

## Related
- [ADR-005](005-soft-delete-vs-erasure.md), [ADR-006](006-database-per-service.md): each service owns
  its database, and cross-service copies are denormalized rather than joined.
- [ADR-007](007-grpc-extraction.md): `[ServiceContract]` purity, the rule that keeps the pricing
  method a contract and not a leak of Catalog's internals.
- [ADR-010](010-integration-event-schema-versioning.md): the event contract is unchanged, so no
  version bump and no upcaster.
- [ADR-035](035-optimistic-concurrency.md): the two-token concurrency contract the discount endpoints
  follow.
- [ADR-057](057-expand-contract-schema-evolution-gate.md): the discount columns are add-only.
- [ADR-083](083-crud-lifecycle-event-taxonomy.md): discount changes reuse `ProductVariantChanged` with
  the `Updated` state rather than minting a new event type.
