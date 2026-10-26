# ADR-112: Catalog Owns Effective Pricing; Sales Snapshots It at Checkout

## Status
Accepted (2026-09-07).

Revised 2026-09-07: an order line freezes the list price and the promotion label beside the charged
unit price, so an order answers what it saved without asking Catalog again. The two cross-service
reply contracts grow additive fields for them; the integration events are untouched.

Revised 2026-09-19: the receipt email is rendered by a durable internal command rather than inside the
`OrderPaid` domain event handler (ADR-114), and it re-reads the order's frozen pricing columns instead
of consuming the event's carried copies. The columns, the invariants and the contracts are unchanged.

Revised 2026-10-01: the products output-cache policy expires after 60 seconds, and checkout refuses an
order total the payment provider cannot charge rather than a non-positive line price.

Revised 2026-10-06: the database-per-service citation points at ADR-008 rather than ADR-005, and the
body row-version token is scoped to the two variant discount endpoints.

Revised 2026-10-21: a list-price change on a variant whose discount window has already ended is no
longer blocked by that discount; anchors refreshed after the Catalog and Sales export moves.

Revised 2026-10-26: anchors refreshed after the Catalog domain, checkout and Catalog service host
edits moved them.

## Context
MMCA.Store sells product variants, and a variant's price is one `Money` on the variant row
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs:30`).
Merchandising wants to run a sale: a percentage off, or a fixed special price, on one variant or
across a whole product, optionally bounded by a start and an end.

Two things constrain the answer. First, Catalog and Sales are separate services with separate
databases (ADR-006, ADR-008), talking over a `[ServiceContract]` interface whose purity is
build-enforced (ADR-007,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IProductVariantService.cs:34`).
Any pricing model that needs Sales to understand promotions grows that wire surface and makes the
extraction harder to reverse. Second, checkout already freezes a price: `CheckOutHandler` fetches
unit prices from Catalog through its `CheckOutPreflight` collaborator and `CheckOutDomainService`
copies them onto order lines
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:74-76`,
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutPreflight.cs:50-52`,
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/CheckOutDomainService.cs:59,116-136`).
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
nothing: `Product.SetDiscountOnAllVariants` refuses a product that has no active variant to discount
(`Product.NoActiveVariants`, an invariant error surfaced as 400) and otherwise validates the discount
against every active variant's list price before it touches any of them
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:584-612`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductInvariants.cs:114`).

**The list price is preserved and the effective price is computed in one method.**
`ProductVariant.Price` stays the list price whatever the discount says, so clearing a discount
restores the original price with no bookkeeping. `ProductVariant.GetEffectivePrice(now)` and its
static twin `ResolveEffectivePrice` are the single computation
(`ProductVariant.cs:190-191,202-210`): they return the list price when there is no discount, when the window
does not cover `now`, and when the stored pairing no longer resolves. Every caller goes through it:
the DTO mapper for the read model
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/DTOs/ProductVariantDTOMapper.cs:48-49`)
and the cross-module pricing service over its projection
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/ProductVariantService.cs:19,77-90,101`),
both against an injected `TimeProvider`.

**Sales re-fetches at checkout, stores no cart price, and freezes the whole answer.**
`IProductVariantService.GetUnitPricesAsync` replies with a `VariantUnitPrice` triple: the effective
price to charge, the list price it was struck from, and the active promotion's label
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/VariantUnitPrice.cs:32`,
`IProductVariantService.cs:104`). The label is resolved only while its discount is in force at the
instant asked, so an expired or not-yet-open window names nothing (`ProductVariantService.cs:103`).
`CheckOutPreflight` translates the triple into Sales' own `OrderLinePricing` record at the module
boundary (`CheckOutPreflight.cs:58-60`, `OrderLinePricing.cs:22`), which is what keeps `Sales.Domain` free
of any reference to `Catalog.Shared`. The three values land on `OrderLine.UnitPrice`,
`OrderLine.ListPrice` and `OrderLine.PromotionLabel` (`OrderLine.cs:30,42,49`), guarded by
`OrderInvariants.EnsureListPriceIsValid` (non-negative, same currency, never below the unit price)
and `EnsurePromotionLabelIsValid` (50 characters) (`OrderInvariants.cs:38,60,87`). Only `UnitPrice`
is money owed: the line total and the Stripe total still follow from it alone.

**What the order saved is derived, not stored.** `OrderLine.Savings` and `Order.TotalSavings` are
computed on read from the frozen pair and excluded from the EF mapping (`OrderLine.cs:65`,
`Order.cs:72`): a stored total could only ever disagree with the two numbers it restates. Both places
that show a saving read the frozen columns back off the order rather than off an event payload. The
receipt email is scheduled by the `OrderPaid` handler, not written by it: `OrderPaidHandler` writes a
`SendOrderPaidEmailInternalCommand` carrying the order id alone (ADR-114,
`Orders/DomainEventHandlers/OrderPaidHandler.cs:37-39`), and
`SendOrderPaidEmailInternalCommandHandler` re-reads the order with its lines
(`Orders/InternalCommands/SendOrderPaidEmailInternalCommandHandler.cs:45-48`) before rendering the
struck "Was" amount, the HTML-encoded label and the "You saved" total
(`SendOrderPaidEmailInternalCommandHandler.cs:121-123,128-131,143-146`). The order detail page renders the same
three from the order's own read model, plus an accessible "Was X, now Y" sentence
(`Sales.UI/Pages/Orders/OrderLinesPanel.razor:56,58,72,96`). Every one appears only when there is a
saving. `OrderPaid` still carries the order's `TotalSavings` and each line's `ListPrice` and
`PromotionLabel` (`Orders/DomainEvents/OrderPaid.cs:21,42`), but its one subscriber now reads only
the order id and the customer id from it.

**The wire contracts grow additive fields; the event contracts do not.** `UnitPriceEntry` gains
`list_price = 3` and `promotion_label = 4`
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Contracts/Protos/product_variants.proto:106,109`) and
the data-subject export line gains `list_price_amount = 6` and `promotion_label = 7`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Contracts/Protos/user_sales_export.proto:93,96`,
`UserSalesExportService.cs:71-72`): new numbers on existing messages, which a peer built against the
previous generation ignores. The `ProductVariantChanged` integration event keeps carrying the list
price and nothing else (`Product.cs:542-543,562-563,607-608`), so ADR-010's schema-version rule is not engaged and
ADR-083's one-lifecycle-event-per-entity taxonomy is unchanged. The two list-price columns land NOT NULL
with defaults (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260907232734_AddOrderLineListPrice.cs:28-44`)
plus a guarded backfill from the unit price (`:60-63`), and `PromotionLabel` lands nullable
(`:46-52`), add-only under ADR-057.

**The effective price must stay above zero.** Sales allows a zero line price
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderInvariants.cs:24-30`) but refuses
an order whose total the payment provider cannot charge, a zero total included, before anything is
written (`CheckOutHandler.cs:156-158`), so a discount that resolves to zero would produce a variant
that can be added to a cart and fails checkout whenever it leaves the order unchargeable. Catalog refuses that pairing at the write instead: `VariantDiscount.ApplyTo` fails with
`EffectivePriceNotPositive` (`VariantDiscount.cs:61-62,216-218,237-239`), which in practice means a
zero-priced variant cannot carry an active or scheduled discount. A discount whose window has ended
is not re-checked when the list price changes (`ProductVariant.cs:130-131`) and stays on the row
(`:138`), so a variant repriced to zero can still hold an ended one, which prices nothing.

The three write endpoints are gated on `catalog:pricing:manage`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Authorization/CatalogPermissions.cs:29`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ProductVariantsController.cs:157-158,184-185`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ProductsController.cs:164-165`), a narrower
permission than variant management. All three take the product ETag in `If-Match` (ADR-035,
`ProductsController.cs:165,177`); the two variant endpoints also carry the variant row version in the
body for ADR-035's `IRowVersioned` child overload (`ProductVariantSetDiscountRequest.cs:20`,
`ProductVariantClearDiscountRequest.cs:18`), while the product-wide request carries none
(`ProductSetDiscountRequest.cs:15-34`).

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
the number to charge; it never learns what a window or a percentage is, and the two members it gets
alongside are an amount and a string for display, not rules to evaluate. That is what keeps the
change additive across the module boundary: new proto field numbers, unchanged event contracts, and a
Sales domain that still knows nothing about promotions, which is the property ADR-007 protects.

Checkout re-fetching rather than trusting a cart price is not new here, it is the existing rule
(prices lock at checkout, not at cart-add) and it happens to be exactly what a timed promotion needs:
a sale that ends between cart-add and checkout charges the list price, with no reconciliation job.

## Trade-offs
- **Cached reads lag a window boundary by up to 60 seconds.** The three write commands implement
  `ICacheInvalidating` and their controllers evict the `catalog:products` output-cache tag, so an
  admin edit is visible at once. A window that opens or closes on the clock evicts nothing, so a
  cached storefront read can show the pre-boundary price until the products cache policy's 60-second TTL expires
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:165`, comment at `:160-164`).
  Checkout is never stale because it is a live cross-service call.
- **An order line records the two prices and the promotion's name, not the promotion itself.** A line
  answers "struck from 24.99, charged at 19.99, Summer Sale", which is what the receipt, the order
  page and the data-subject export render. It does not record the discount's kind, figure or window,
  so "was that 20% off or a special price" is still unanswerable from an order after the fact: the
  label is a string frozen for display, not a reference into a promotion nobody models.
- **No coupon codes, no category-wide or basket-level promotions, no stacking.** One discount per
  variant, replaced wholesale. A future Promotion aggregate is not foreclosed: it would resolve into
  the same `ResolveEffectivePrice` call, which is the one place a price is decided.
- **A discount cannot be applied to a free variant, and the list price of a variant with an active or
  scheduled discount cannot be changed to an inconsistent value.** `ChangePrice(price, now)` fails
  rather than silently dropping the discount (`ProductVariant.cs:124-141`, the re-check at `:133` and
  the failure at `:134-135`), so an admin repricing such a variant to a value the discount no longer
  resolves against has to clear the discount first; a reprice the discount still resolves against
  succeeds and keeps it (`:138`). A
  discount whose window has already ended prices nothing and is skipped (`ProductVariant.cs:130-131`),
  so an expired promotion never blocks a list-price change. Failing loudly beats repricing a
  storefront nobody asked to reprice.
- **Two clocks answer the same question.** The DTO's `IsActive` flag and the checkout price are both
  resolved server-side against `TimeProvider`, but at different instants, so a shopper can see a sale
  price on a page and be charged list price seconds later at a window boundary. Accepted as the cost
  of not pinning a promotion into the cart.

## Revision (2026-10-01)
Two statements no longer matched the code and are corrected in place; the decision itself is
unchanged. The products output-cache policy now expires after 60 seconds rather than five minutes,
because a product payload carries a clock-dependent effective price
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:153-158`), so a window boundary
shows within a minute. The Sales order-line validator that rejected a non-positive unit price no
longer exists: the Sales domain allows a zero line price (`OrderInvariants.cs:24-30`) and checkout
instead refuses an order total the payment provider cannot charge (`CheckOutHandler.cs:155-160`).
Catalog's refusal of a discount that resolves to zero is unchanged (`VariantDiscount.cs:61-62`).
Citations were also refreshed: the Catalog price fetch and the `OrderLinePricing` translation now
live in `CheckOutPreflight` (`CheckOutPreflight.cs:50-52,58-60`), and the anchors into
`ProductVariant.cs`, `ProductVariantDTOMapper.cs`, `Product.cs`, `ProductsController.cs` and
`OrderLinesPanel.razor` were re-pointed.

## Revision (2026-10-06)
- Context and Related cited ADR-005 (soft-delete vs. right-to-erasure) for database per service; the
  citation now points at ADR-008, whose topology gives each service its own database
  (`008-service-extraction-topology.md:85`).
- The discount write endpoints no longer claim a uniform two-token rule. All three take the product
  ETag in `If-Match`; only the two variant endpoints carry `VariantRowVersion` in the body
  (`ProductVariantSetDiscountRequest.cs:20`, `ProductVariantClearDiscountRequest.cs:18`), and the
  product-wide request has none (`ProductSetDiscountRequest.cs:15-27`).
- The 60-second products cache policy recorded in the 2026-10-01 revision is now at
  `Program.cs:159` (comment at `:154-158`).
- Every `path:line` anchor in the live sections was re-verified against current source and re-pointed
  where it had moved (`ProductVariant.cs`, `ProductVariantService.cs`, `Product.cs`,
  `ProductsController.cs`, `Program.cs`, `SendOrderPaidEmailInternalCommandHandler.cs`).

## Revision (2026-10-21)
Re-verified against current source. The decision, the invariants and the wire and event contracts are
unchanged; one trade-off gained a nuance and the anchors into the Catalog domain, the Catalog
controllers and the Sales export moved.

1. `ChangePrice` now takes the current instant and skips a discount whose window has already ended
   (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs:124,130-131`,
   documented at `:116-118`), so the trade-off that a repricing admin must clear the discount first
   now applies only to repricing to an inconsistent value under an active or scheduled discount. The
   re-check against the new price is at `:133`, the failure at `:134-135`, and a consistent reprice
   keeps the discount (`:138`). The Decision's zero-price sentence is qualified the same way.
2. The migration sentence names its columns precisely: the two list-price columns are NOT NULL with
   defaults
   (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260907232734_AddOrderLineListPrice.cs:28-44`,
   rationale at `:12-18`), while `PromotionLabel` is nullable (`:46-52`).
3. Anchors re-verified against current source: `ProductVariant.cs:190-191,202-210`
   (`GetEffectivePrice`, `ResolveEffectivePrice`), `Product.cs:592-607` (`SetDiscountOnAllVariants`)
   and `:549-550,570-571,615-616` (`ProductVariantChanged` with the list price),
   `user_sales_export.proto:93,96`, `UserSalesExportService.cs:71-72`,
   `ProductVariantsController.cs:157-158,184-185`, `ProductsController.cs:164-165,177`, and
   `ProductSetDiscountRequest.cs:15-34` (still no row-version member).

## Revision (2026-10-26)
Re-verified against current source. The decision, the invariants, the 60-second products cache
policy, the chargeable-total refusal and the wire and event contracts are unchanged; only anchors in
the live sections moved. Anchors inside the earlier dated revisions stay as written.

1. Anchors re-verified against current source:
   `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:584-612`
   (`SetDiscountOnAllVariants`: empty-set guard `:590-593`, every active variant validated
   `:595-599`, apply loop `:601-609`) and `:542-543,562-563,607-608` (`ProductVariantChanged` with
   the list price only);
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/CheckOutDomainService.cs:116-136`
   (`BuildOrderItems`, frozen pricing added at `:132`) and `:59` (`Order.Create`);
   `CheckOutHandler.cs:156-158` (`EnsureChargeable` before `AddAsync`, comment `:153-155`); and
   `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:165` (`ProductsCache`,
   `TimeSpan.FromSeconds(60)`, tags `catalog` and `catalog:products`, comment `:160-164`).

## Related
- [ADR-006](006-database-per-service.md), [ADR-008](008-service-extraction-topology.md): each service
  owns its database, and cross-service copies are denormalized rather than joined.
- [ADR-007](007-grpc-extraction.md): `[ServiceContract]` purity, the rule that keeps the pricing
  method a contract and not a leak of Catalog's internals.
- [ADR-010](010-integration-event-schema-versioning.md): the event contract is unchanged, so no
  version bump and no upcaster.
- [ADR-035](035-optimistic-concurrency.md): the `If-Match` product ETag every discount endpoint takes,
  plus the `IRowVersioned` child overload the two variant endpoints use.
- [ADR-057](057-expand-contract-schema-evolution-gate.md): the discount columns are add-only.
- [ADR-083](083-crud-lifecycle-event-taxonomy.md): discount changes reuse `ProductVariantChanged` with
  the `Updated` state rather than minting a new event type.
- [ADR-114](114-internal-commands-durable-job-queue.md): the receipt that renders the struck price is
  a durable internal command, which is why it re-reads the order instead of trusting the event.
