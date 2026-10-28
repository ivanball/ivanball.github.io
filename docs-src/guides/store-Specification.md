# MMCA Business Specification Document

_As of: 2026-10-28 (MMCA.Store #236, MMCA.Common v1.265.1)._

## 1. System Overview

MMCA is an **e-commerce platform** built with .NET 10.0 using DDD and Clean Architecture. The business logic is organized as modules (Catalog, Sales, Identity), each running as its own service host behind a YARP Gateway. The storefront is branded **C.A.S.A Boutique**. It enables shoppers to browse a product catalog, fill a bag, check out with or without an account, and pay; customers additionally keep a server-side cart, an order history and a profile. Administrators manage the product catalog, inventory, order fulfillment, user accounts and role permissions.

The system operates in the **online retail / e-commerce** domain, supporting the full purchase lifecycle from product browsing through payment and delivery.

**Major Business Areas:**
- **Product Catalog Management**: categories, products, and product variants with pricing and promotions
- **Shopping & Ordering**: cart management, customer checkout, guest checkout (no account), order placement
- **Shipping & Tax**: a flat shipping rate with a free-shipping threshold, optional Stripe Tax sales tax, a shipping label per order
- **Payment Processing**: Stripe-integrated checkout with webhook confirmation, a per-order payment deadline, and a reconciliation sweep
- **Order Fulfilment**: carrier shipment tracking from payment through delivery
- **Inventory Management**: stock tracking per product variant
- **Product Reviews**: verified-purchase star ratings and reviews, with moderation
- **Customer Identity & Authentication**: registration, login, multi-device refresh sessions, password reset, email confirmation
- **Administration**: user accounts (lock, unlock, change role) and role-to-permission grants

**Technical Stack:**
- .NET 10.0 (LangVersion: preview), Blazor Server + WebAssembly hybrid (InteractiveAuto), MudBlazor UI, installable web app (manifest plus service worker)
- SQL Server, one database per service (`Store_Catalog`, `Store_Identity`, `Store_Sales`)
- Stripe payment gateway and Stripe Tax, PBKDF2-HMAC-SHA512 password hashing, JWT authentication
- .NET Aspire orchestration (SQL Server container, Redis, a message broker, MailDev, the Stripe CLI, Gateway :6001, 3 service hosts, UI :6002)

---

## 2. Core Business Entities

### 2.1 Category
**Description:** A classification grouping for products. Supports hierarchical (parent-child) structures for nested categorization (e.g., "Jewelry" > "Rings").

**Key Properties:**
| Property | Description |
|----------|-------------|
| Name | Display name (max 255 chars, required, unique among non-deleted categories) |
| ParentCategoryId | Optional reference to a parent category |

**Relationships:**
- A Category may have one parent Category (self-referencing hierarchy)
- A Category contains zero or more Products

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Categories/Category.cs`

---

### 2.2 Product
**Description:** A saleable item in the catalog. Products have descriptive attributes and belong to a category. A product is sold through its purchasable variants; creating a product does not require one.

**Key Properties:**
| Property | Description |
|----------|-------------|
| Name | Product name (max 100 chars, required) |
| Description | Detailed description (max 4,000 chars, optional) |
| Brand | Manufacturer or brand name (max 100 chars, optional, no whitespace-only) |
| CategoryId | Category this product belongs to (optional) |
| RatingSummary | Derived average star rating and review count over the product's published reviews (Section 2.11); zero until the first review |

**Relationships:**
- A Product belongs to zero or one Category
- A Product contains zero or more Product Variants
- A Product has zero or more Product Images (at most 10, Section 3.10)

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs`

---

### 2.3 Product Variant
**Description:** A specific purchasable configuration of a product (e.g., "Gold Ring - Size 7"). Variants carry the actual price and SKU used for inventory and order processing.

**Key Properties:**
| Property | Description |
|----------|-------------|
| SKU | Stock-keeping unit identifier (max 50 chars, globally unique, optional) |
| Price | LIST unit price as Money (amount + currency, must be non-negative). A discount never rewrites it, so clearing the discount restores the original price with no bookkeeping |
| Discount | Optional promotional pricing as an owned `VariantDiscount` value object: either a percentage off or a fixed special price, with an optional activation window (inclusive start, exclusive end, either bound open) and an optional storefront label (max 50 chars) |
| Effective price | Derived, never stored: `GetEffectivePrice(now)` returns the list price with the discount applied when the window covers that instant, and the list price otherwise |

**Relationships:**
- A Product Variant belongs to exactly one Product
- A Product Variant has zero or one Inventory Item
- A Product Variant can appear in Shopping Cart Items and Order Lines

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs`,
`Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/VariantDiscount.cs`

---

### 2.4 Shopping Cart
**Description:** A temporary collection of items a customer intends to purchase. Each customer has exactly one shopping cart (the cart ID equals the customer ID).

**Key Properties:**
| Property | Description |
|----------|-------------|
| Status | Active or CheckedOut |
| ShoppingCartItems | Collection of items in the cart |

**Relationships:**
- A Shopping Cart belongs to exactly one Customer (1:1 relationship, ID = CustomerId)
- A Shopping Cart contains zero or more Shopping Cart Items

A shopper who has not signed in has no Shopping Cart aggregate: their bag lives on the device (variant ids and quantities only) and is merged into the server cart when they sign in (Section 11.2).

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/ShoppingCarts/ShoppingCart.cs`

---

### 2.5 Shopping Cart Item
**Description:** A line item in a shopping cart, representing a desired quantity of a specific product variant.

**Key Properties:**
| Property | Description |
|----------|-------------|
| ProductVariantId | The product variant being added |
| Quantity | Number of units desired (must be positive) |

**Relationships:**
- Belongs to exactly one Shopping Cart
- References one Product Variant (cross-module)

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/ShoppingCarts/ShoppingCartItem.cs`

---

### 2.6 Order
**Description:** A confirmed purchase transaction created when a customer checks out their shopping cart, or when a shopper with no account places a guest order. Orders track payment status and progress through a defined lifecycle.

**Key Properties:**
| Property | Description |
|----------|-------------|
| CustomerId | The customer who placed the order, or null for a guest order (`Order.cs:49`) |
| IsGuest | Computed: true when CustomerId is null (`Order.cs:52`) |
| CustomerName | The customer's full name frozen at checkout (the guest's name on a guest order), max 201 characters. Marked `[Pii]` |
| ContactEmail | The guest's email, where a guest order's mail goes; null on a customer's order, whose address Identity owns. Max 100 characters. Marked `[Pii]` (`Order.cs:59`) |
| ContactPhone | Optional contact phone given at checkout for the carrier, max 30 characters. Marked `[Pii]` |
| ShippingAddress / BillingAddress | Frozen at checkout exactly as entered (Address value objects); billing equals shipping when the shopper says so. Marked `[Pii]` |
| ShippingLabel | The label generated when the order was placed, attached only when the order has a shipping address (value object) |
| GuestAccessTokenHash | Hex SHA-256 of a guest order's private access token; null on a customer's order and once a guest order is claimed into an account (`Order.cs:90`) |
| Subtotal | The sum of all line totals: what the merchandise costs before shipping and tax |
| ShippingCost / TaxAmount | The shipping and sales tax charged, zero when free or when none applies |
| TaxCalculationId | The tax provider's id for the calculation behind TaxAmount, or null when none was made |
| Total | What the order charges: Subtotal + ShippingCost + TaxAmount. The amount the payment session asks for and a payment has to match (`Order.cs:111`) |
| TotalSavings | Computed: the sum of every line's Savings, in the order's currency. Zero when nothing on the order was discounted. Derived on read, never persisted |
| Status | Current lifecycle stage (see state machine below) |
| LineCount | The number of lines the order was created with, denormalized for list views |
| StripeSessionId | Payment gateway session reference |
| StripePaymentIntentId | Payment confirmation reference (`"manual-admin-override"` for a manual payment) |
| InventoryRestored | The idempotency marker for the compensation that returns stock after a cancellation |
| Shipment | The parcel the order left with (carrier, tracking number, dates), or null before it ships (value object) |
| FulfilledPublishedOn | When the `OrderFulfilled` integration event was published for this order; the idempotency marker the startup backfill sweeps on |

**Relationships:**
- An Order belongs to one Customer, or to no account (a guest order) until it is claimed
- An Order contains one or more Order Lines

**Erasure:** the aggregate is `IAnonymizable`: anonymizing clears CustomerName, ContactEmail, ContactPhone and both addresses (`Order.cs:432`).

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs`,
`Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderCharges.cs`,
`Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderDelivery.cs`

---

### 2.7 Order Line
**Description:** A single item within an order, capturing the product variant, quantity, and price at time of purchase.

**Key Properties:**
| Property | Description |
|----------|-------------|
| ProductVariantId | The product variant ordered |
| Quantity | Units ordered (must be positive) |
| UnitPrice | Price per unit actually charged at time of order (Money) |
| ListPrice | The undiscounted price the charge was struck from (Money), frozen alongside UnitPrice. Equal to UnitPrice when no promotion was in force |
| PromotionLabel | The storefront name of the promotion that moved the price (max 50 characters), or null when none was in force or the one in force carried no label |
| LineTotal | Computed: UnitPrice x Quantity |
| Savings | Computed: (ListPrice - UnitPrice) x Quantity, in the line's currency. Zero when the line was not discounted. Derived on read, never persisted |

**Relationships:**
- Belongs to exactly one Order

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderLine.cs`,
`Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderLinePricing.cs`

---

### 2.8 Inventory Item
**Description:** Tracks available stock for a specific product variant. One inventory record per product variant (the inventory item ID equals the product variant ID).

**Key Properties:**
| Property | Description |
|----------|-------------|
| AvailableQuantity | Units currently in stock (must be >= 0) |
| IsOutOfStock | Computed: true when AvailableQuantity equals 0 |
| Sku / ProductId / ProductName | Catalog labels copied across the database boundary (SKU max 50, product name max 100), so the inventory grid can sort and filter on them. Written from the `ProductVariantChanged` and `ProductInfoChanged` integration events, the create, set and bulk-set paths, and a startup backfill (`InventoryItem.cs:33`, `:47`) |

**Relationships:**
- One Inventory Item per Product Variant (1:1 relationship, ID = ProductVariantId)

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/Inventory/InventoryItem.cs`

---

### 2.9 Customer
**Description:** A registered buyer with personal information and optional mailing address.

**Key Properties:**
| Property | Description |
|----------|-------------|
| FirstName | First name (max 100 chars, required) |
| LastName | Last name (max 100 chars, required) |
| Email | Email address (Email value object, max 100 chars, unique, required) |
| Address | Optional mailing address (value object) |

Every field is marked `[Pii]`.

**Relationships:**
- A Customer is linked 1:1 with a User account
- A Customer has one Shopping Cart
- A Customer has zero or more Orders

**Erasure:** the aggregate is `IAnonymizable`: `Anonymize()` sets the name to "Deleted Account", replaces the email with a `deleted-{id}@anonymized.invalid` placeholder, clears the address and raises `CustomerErased`, which carries the erasure into Sales and Catalog.

**Source:** `Source/Modules/Identity/MMCA.Store.Identity.Domain/Customers/Customer.cs`

---

### 2.10 User
**Description:** An authentication account with credentials and role-based access. Users are either administrators or customers, and each account holds exactly one role.

**Key Properties:**
| Property | Description |
|----------|-------------|
| Email | Login email (Email value object, unique, required). Marked `[Pii]` |
| PasswordHash / PasswordSalt | Securely stored credentials: PBKDF2-HMAC-SHA512 at 210,000 iterations for new hashes, with the work factor stored in each hash; the earlier 600,000-iteration format still verifies and is upgraded at the next sign-in (`PasswordHasher.cs:34`, `:37`) |
| Role | "Admin" or "Customer" |
| IsActive | Account active status; "locked" in the administration surface maps onto this flag |
| IsEmailConfirmed | Whether the account redeemed an email-confirmation token (`User.cs:60`). Recorded, not enforced: sign-in does not require it |
| CustomerId | Link to Customer profile (for Customer role) |
| PreferredCulture / PreferredTheme | UI preferences that follow the account across devices |

Refresh tokens are not part of this aggregate: each signed-in device holds its own row in the framework's `RefreshSessions` table, hashed at rest ([ADR-097](../adr/097-multi-device-refresh-sessions.md)).

**Relationships:**
- A User with "Customer" role is linked 1:1 to a Customer entity
- Admin users have no Customer record

**Erasure:** `Anonymize()` replaces the email with a `deleted-{id}@anonymized.invalid` placeholder, clears the credentials and deactivates the account.

**Source:** `Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs`

---

### 2.11 Value Objects

| Value Object | Properties | Validation | Source |
|-------------|-----------|-----------|--------|
| **Money** | Amount (decimal), Currency (Currency) | A currency is required (`Money.NoCurrency`); adding two amounts in different currencies fails (`Money.CurrencyMismatch`). Non-negativity is enforced by the owning entity's invariants (prices and charges), not by Money itself | `MMCA.Common.Shared/ValueObjects/Financial/Money.cs` |
| **Currency** | Code (string) | Must be "USD" or "EUR" | `MMCA.Common.Shared/ValueObjects/Financial/Currency.cs` |
| **Address** | AddressLine1 (required, max 200), AddressLine2 (max 200), City (max 100), State (max 100), ZipCode (max 20), Country (max 100) | AddressLine1 required; all fields have max lengths | `MMCA.Common.Shared/ValueObjects/Contact/Address.cs`, `AddressInvariants.cs` |
| **Email** | Value (string) | Trimmed and validated as an email address at creation | `MMCA.Common.Shared/ValueObjects/Contact/Email.cs` |
| **ShippingLabel** | LabelNumber, TrackingNumber, CarrierName, ServiceLevel, CreatedOn | Every field present and at most 100 characters; the ship-to is the order's own frozen ShippingAddress | `Sales.Shared/Orders/ShippingLabel.cs` |
| **Shipment** | Carrier, TrackingNumber, ShippedOn, EstimatedDeliveryOn, TrackingUrl, plus the computed TrackingLink | Tracking number required, max 100; estimated delivery cannot precede the ship date; a caller-supplied tracking URL is accepted only for carrier `Other` and must be absolute https, max 500 | `Sales.Shared/Orders/Shipment.cs` |
| **RatingSummary** | AverageRating (decimal, 0 to 5), ReviewCount | Derived, never edited by hand: recomputed as AVG/COUNT over the product's published, non-deleted reviews. Stored as `decimal(3,2)` | `Catalog.Shared/Products/RatingSummary.cs` |

---

### 2.12 Product Review

**Description:** A shopper's review of a product: a star rating plus optional headline and text, written by a customer who received the product. Every review is a verified purchase by construction, so the aggregate carries no "verified" flag of its own.

**Key Properties:**
| Property | Description |
|----------|-------------|
| ProductId | The reviewed product |
| CustomerId | The customer who wrote it |
| OrderId | The delivered order that entitled them to write it |
| Rating | Star rating, 1 through 5 |
| Title / Body | Optional headline and text. Marked `[Pii]` |
| ReviewerName | Display name frozen at submission from the caller's token, so a later profile rename does not rewrite published content. Marked `[Pii]` |
| Status | `Published` (the state every review is created in) or `Hidden` (moderator action) |

**Relationships:**
- One review per (customer, product); the entitling order is recorded on the row
- Counted into the product's `RatingSummary` while published and not deleted

**Erasure:** the aggregate is `IAnonymizable` ([ADR-005](../adr/005-soft-delete-vs-erasure.md)). Anonymizing clears the reviewer name, title and body and **keeps the rating**, because a bare star with no name and no words identifies nobody while removing it would silently rewrite every product average an erasure touched.

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Reviews/ProductReview.cs`

---

### 2.13 Verified Purchase

**Description:** Catalog's own record that a customer received a product: one row per (order, product). It is the entitlement behind a review, so "verified purchase" is answerable without a query into Sales.

**Key Properties:**
| Property | Description |
|----------|-------------|
| ProductId | The product the customer received |
| CustomerId | The customer who received it |
| OrderId | The delivered order the entitlement came from |
| DeliveredOn | When the order was marked delivered (UTC) |

**Relationships:**
- Written only by the consumer of Sales' `OrderFulfilled` integration event; nothing else creates one and nothing revokes one (delivery is terminal, so an entitlement earned stays earned)
- Unique on (OrderId, ProductId), which is the database-level backstop for an at-least-once redelivery

Carries no personal data (three identifiers and a date), so it is deliberately neither audited nor anonymizable, and it is deliberately not repeated in the data-subject export: it is a derived copy of order facts Sales already owns and already exports.

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Reviews/VerifiedPurchase.cs`

---

## 3. Business Workflows

### 3.1 Customer Registration

**Trigger:** A new user submits registration with first name, last name, email, and password.

**Steps:**
1. Validate registration request (email format, password requirements) and apply the registration rate limit
2. Verify email is not already registered (uniqueness check)
3. Hash the password using PBKDF2-HMAC-SHA512 (210,000 iterations) with a per-user salt
4. Create a User entity with "Customer" role
5. **Domain event `UserRegistered` is published**, which drives two independent handlers:
   - `UserRegisteredHandler` creates a Customer with the same name, email, and address and links the User to it via `CustomerId`, both in one transaction. When a Customer with that email already exists (typically created by an administrator) the account is deliberately left unlinked, because registration does not prove ownership of the address; an administrator links it by hand (Section 3.15)
   - `UserRegisteredEmailConfirmationHandler` schedules the confirmation email as the `Identity.SendEmailConfirmation` internal command (Section 3.14)
6. Re-read the user untracked so the first token already carries the `customer_id` claim
7. Issue a JWT access token (15 min; claims `sub`, `jti`, `iat`, name, email, role, `customer_id` when linked, `sid`, and one `permission` claim per capability the role holds) and a refresh token (7 days) stored as its own refresh-session row
8. Return authentication tokens to the caller (HTTP 201)

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs` (over the framework's `AuthenticationServiceBase<User>`)
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/DomainEventHandlers/UserRegisteredHandler.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/DomainEventHandlers/UserRegisteredEmailConfirmationHandler.cs`

---

### 3.2 Customer Login

**Trigger:** A registered user submits email and password.

**Steps:**
1. Validate login request and check the lockout state for the address ([ADR-029](../adr/029-authentication-brute-force-protection.md))
2. Look up user by email
3. Verify password using PBKDF2-HMAC-SHA512 with constant-time comparison; a miss counts as a failed attempt
4. Verify user is active (`Auth.UserDeactivated`, checked after the password so only the account owner learns it, `AuthenticationService.cs:112`)
5. Reset the failed-attempt counter and issue a new access token plus a new refresh-session row (one per signed-in device)
6. Upgrade the stored hash when it is in the earlier format or at another iteration count; a rehash failure never fails a sign-in that already succeeded
7. Return authentication response with both tokens

**Token refresh** (`POST /Auth/refresh`) rotates the presented refresh token and treats a token that was already rotated as reuse ([ADR-050](../adr/050-jwt-refresh-token-rotation.md)); the deactivated-account gate runs on refresh too, so a locked account stops refreshing immediately. A signed-in user can list their sessions (`GET /Auth/my-sessions`) and sign one device out (`POST /Auth/revoke/{sessionId}`) or the current one (`POST /Auth/revoke`).

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs` (over the framework's `AuthenticationServiceBase<User>`)
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs`

---

### 3.3 Add Item to Shopping Cart

**Trigger:** An authenticated customer adds a product variant to their cart.

**Steps:**
1. Validate the request (quantity must be positive)
2. Verify the product variant exists in the Catalog (cross-module check via `IProductVariantService`)
3. Fetch or create the customer's shopping cart
4. If the cart was previously checked out, reactivate it (clears all old items, sets status back to Active)
5. If the same product variant already exists in the cart, increase its quantity
6. Otherwise, add a new cart item
7. Persist changes

**Business Rules Applied:**
- Cart must be in Active status to accept items (or will be reactivated)
- Product variant must exist in the catalog
- Quantity must be greater than zero
- Duplicate variants merge (quantities are combined)
- Reactivation clears all previous items

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/AddItem/AddItemHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Domain/ShoppingCarts/ShoppingCart.cs` (AddShoppingCartItem)

---

### 3.4 Checkout (Cart to Order)

**Trigger:** A customer (or an admin on the customer's behalf) checks out an active shopping cart
with `PUT /ShoppingCarts/{id}/checkout`. The optional body carries the shipping address, the billing
address and a phone; an empty body checks out with no addresses and therefore no shipping label, which
is how the admin cart page checks a cart out on a customer's behalf.

**Steps:**
1. Fetch the customer's shopping cart with all items, and validate the delivery addresses (a missing
   billing address takes the shipping address) before any cross-service call
2. Retrieve current pricing for all product variants from the Catalog module (cross-module call): the
   effective price, the list price it was struck from, and the active promotion's label. Reject the
   checkout if any variant is missing from the price map (it was soft-deleted between cart-add and
   checkout), naming the offending variant. Resolve the customer's display name from Identity (best
   effort)
3. Quote the charges: a flat shipping rate waived at the free-shipping threshold, and sales tax when tax
   is enabled and a ship-to address is known (Section 3.16)
4. Inside one retriable transaction, fetch inventory items for all product variants and execute the
   checkout domain service, which:
   a. Validates the cart is not empty
   b. Validates inventory exists for every item in the cart
   c. Runs a **fail-fast sufficiency check** per item against the loaded snapshot
   d. Creates Order Lines with the current pricing triple (price snapshot at time of purchase)
   e. Creates the Order with status `PendingPayment`, the frozen customer name, addresses and phone
   f. Transitions the cart to `CheckedOut` status
5. Apply the quoted shipping and tax to the order (`Order.ApplyCharges`), refuse the checkout when the
   bag changed between the quote and the order (`Order.Charges.BagChanged`, `OrderQuoteApplier.cs:28`),
   and refuse a total below what the payment provider can charge (`CheckOutHandler.cs:188`)
6. In the same transaction: the order insert, the **atomic conditional inventory decrements**, the cart
   transition, then the shipping label (only when the order has a shipping address; a label failure is
   logged, never fatal) and the order's payment deadline (Section 3.17)
7. Return the Order details

**Business Rules Applied:**
- Cart must contain at least one item
- Every product variant must still exist in the Catalog module
- All product variants must have corresponding inventory records
- Sufficient inventory must be available for each item
- Prices are locked at checkout time (not at cart-add time)
- The order total is Subtotal + ShippingCost + TaxAmount, and it must be chargeable by the payment provider
- The price locked is the **effective** price: Catalog resolves each variant's list price against any
  active discount at the instant of the call, so the order line, the receipt and the Stripe total all
  carry the discounted amount and Sales never reasons about promotions
  ([ADR-112](../adr/112-catalog-owned-effective-pricing.md))
- The list price and the promotion label are frozen beside the effective price on the same line, so
  the order can say what it saved later without asking Catalog again. Only the effective price is
  money owed: the line total, the order total and the Stripe amount all follow from it alone
- The write phase is atomic, but the command is **deliberately not `ITransactional`**: the handler
  opens the transaction itself so the cross-module price fetch stays outside it and cross-service
  latency never extends lock hold time

**Concurrency:** the domain service's sufficiency check reads a point-in-time snapshot and is only a
fail-fast. The real oversell guard is `IInventoryAllocationService.DecrementAsync`, which issues one
atomic conditional `UPDATE` per variant: a row that no longer has enough stock matches zero rows, the
Result fails, and the whole transaction rolls back. Because that path uses `ExecuteUpdateAsync` it
bypasses the save pipeline, so **no `InventoryAdjusted` domain event is raised on checkout**.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutPreflight.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/PlacedOrderFinalizer.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/CheckOutDomainService.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Inventory/InventoryAllocationService.cs`

---

### 3.5 Payment Processing (Stripe)

**Trigger:** After checkout, the customer initiates payment for a pending order
(`POST /Orders/{id}/checkout`); a guest pays through `POST /Orders/guest/{id}/checkout` with the
order's access token, which runs the same use case (Section 3.18).

**Steps:**
1. Fetch the order with its order lines and check it is payable before Stripe is called: a
   `PendingPayment` order, or a `PaymentFailed` order on retry, gets a new session; a
   `PaymentInitiated` order resumes the session it is waiting on rather than opening a second one (a
   session Stripe already reports paid, with an amount and currency `PaymentProof` accepts as this
   order's total, marks the order `Paid` with no webhook, while a paid session with a mismatched amount
   is logged for an operator and leaves the order unchanged; an expired session is retired through
   `PaymentFailed` first); every other status is refused
2. Call Stripe API to create a checkout session (converts Money to smallest currency unit: cents). The
   session carries the subtotal, shipping and tax, which must add up to the order total
   (`Payment.Stripe.ChargesDoNotAddUp`, `StripePaymentService.cs:153`), and it expires when the order's
   unpaid window closes, clamped to what Stripe accepts (`StripePaymentService.cs:166`)
3. Transition order status to `PaymentInitiated`
4. Store the Stripe session ID on the order
5. Return the checkout URL for the customer to complete payment

**Webhook Confirmation (asynchronous):**
1. Stripe sends a webhook notification to `POST /Payments/webhook`
2. System verifies the webhook signature with Stripe's `EventUtility.ValidateSignature()` against
   either trusted signing secret (the runtime one and the configured `Stripe:WebhookSecret`), then
   parses the body as a separate step with `EventUtility.ParseEvent()`
   (`StripePaymentService.cs:644`, `:374`)
3. Based on event type:
   - `checkout.session.completed` -> Mark order as `Paid`, store payment intent ID, but only when the
     session is paid and the amount and currency it collected match the order total (`PaymentProof`,
     the one rule every path that marks an order paid from provider data applies)
   - `checkout.session.expired` -> Mark order as `PaymentFailed`
   - `payment_intent.payment_failed` -> a declined card on a session that is still open: logged only,
     the order status does not move, so the customer can retry on the same session
   - Any other event type is acknowledged and ignored
4. Idempotent: skips processing if order is already in the appropriate terminal state
5. After the commit, `OrderPaidHandler` schedules the `Sales.SendOrderPaidEmail` internal command, and
   `OrderPaymentFailedSagaHandler` schedules `Sales.SendOrderPaymentFailedEmail` (and re-arms the
   payment deadline, Section 3.17); both emails go to the order's recipient. `OrderPaymentFailed` is
   raised only by `Order.MarkAsPaymentFailed`, from `PaymentInitiated`, on three paths: the
   `checkout.session.expired` webhook, the payment reconciliation sweep finding the session expired,
   and a resumed checkout finding it expired (which sends the retry email just before the replacement
   session opens). A declined card (`payment_intent.payment_failed`) never raises it

In production `StripeWebhookRegistrationService` verifies (or creates) the Stripe webhook endpoint at
startup; locally the Stripe CLI started by the Aspire AppHost forwards events to the Gateway.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Interfaces/PaymentProof.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs`

---

### 3.6 Order Cancellation

**Trigger:** A customer or admin cancels an order (`PUT /Orders/{id}/cancel`, mandatory `If-Match`),
or a guest cancels from the private link (`POST /Orders/guest/{id}/cancel`, Section 3.18), which runs
the same use case. The order's payment deadline (Section 3.17) and the reconciliation sweep reach the
same `Cancelled` state, the same compensation and the same notice.

**Steps:**
1. Fetch the order with its order lines
2. Validate the order is in a cancellable state (PendingPayment, PaymentInitiated, or PaymentFailed)
3. For a `PaymentInitiated` order, retire the Stripe checkout session first, so the hosted page can no
   longer take money; a session Stripe reports already paid refuses the cancellation (the order needs a
   refund, not a cancel)
4. Transition order status to `Cancelled` and persist. The cancellation commits on its own; no
   inventory work happens inside this transaction.
5. **After the commit**, the `OrderCancelled` domain event drives `OrderCancelledSagaHandler`, which
   runs in its own DI scope and restores inventory for each order line
6. Independently of the saga, `OrderCancelledHandler` schedules the `Sales.SendOrderCancelledEmail`
   internal command with the event's `OrderCancellationReason` (`OrderCancelledHandler.cs:36-41`). The
   email goes to the order's recipient (the customer, or a guest's contact email): `Requested` reads as
   "Order Cancelled", and `PaymentExpired` (the deadline and the sweep) as "Your unpaid order
   expired" with its items released (`SendOrderCancelledEmailInternalCommandHandler.cs:54-78`)

**Business Rules Applied:**
- Orders in PendingPayment, PaymentInitiated, or PaymentFailed can be cancelled
- Paid, shipped or delivered orders cannot be cancelled (no refund workflow)
- The customer page and the guest page both ask for confirmation before cancelling
  (`OrderSummaryPanel.razor.cs:187-191`, `GuestOrderDetail.Lifecycle.razor.cs:57-65`)
- The reason is not stored: it rides the event and the email command row only
  (`OrderCancellationReason.cs:3-12`)
- Inventory is restored by a compensating handler, not inline ([ADR-054](../adr/054-saga-compensation-and-reconciliation.md))
- Restoration is idempotent under at-least-once redelivery: `Order.InventoryRestored` is the marker,
  and it is committed by the same `SaveChangesAsync` as the inventory increases. The order's rowversion
  token makes two concurrent deliveries mutually exclusive; the loser fails and the outbox retry then
  sees the committed marker.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderCancelledHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/LifecycleEmails/SendOrderCancelledEmailInternalCommandHandler.cs`

---

### 3.7 Manual Payment Override

**Trigger:** An administrator manually marks an order as paid (e.g., for cash payments or payment system issues): `PUT /Orders/{id}/pay`, `sales:orders:manage` permission, mandatory `If-Match`.

**Steps:**
1. Fetch the order
2. Validate order status allows manual payment (PendingPayment, PaymentInitiated, or PaymentFailed)
3. For a `PaymentInitiated` order, retire the Stripe checkout session first; when Stripe reports that
   session already paid, the order is marked paid with the real payment intent instead of the override;
   when the expire call fails and a re-read does not show the session paid or expired (including a
   re-read that shows it still open), the override is refused with HTTP 400
   (`Order.Pay.SessionStillPayable`), because proceeding risks a double charge
4. Set payment intent ID to `"manual-admin-override"`
5. Transition status to `Paid`
6. Persist changes

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Pay/PayOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs` (MarkAsPaidManually)

---

### 3.8 Order Shipping and Delivery

**Trigger:** An administrator records that a paid order left with a carrier, corrects what was
recorded, or confirms the order arrived.

**Ship (`PUT /Orders/{id}/ship`, `OrdersManage` permission, mandatory `If-Match`):**
1. Fetch the order
2. Validate status is `Paid` (the only state that may ship)
3. Build the `Shipment` value object: carrier, tracking number, ship date, optional estimated delivery
4. Transition status to `Shipped` and raise `OrderShipped`
5. Persist changes; `OrderShippedHandler` schedules the `Sales.SendOrderShippedEmail` internal command, which emails the order's recipient (the customer, or a guest's contact email) the carrier, the tracking number and the tracking link

**Correct the shipment (`PUT /Orders/{id}/shipment`, `OrdersManage` permission, mandatory `If-Match`):**
Same request body, because the shipment is a value object and a correction replaces it whole rather
than patching a field. Allowed from `Shipped` only, and the status does not move. `OrderShipped` is
raised again on purpose, so a customer who was told the wrong tracking number gets the right one. The
two verbs stay separate endpoints deliberately: `ship` must refuse an already-shipped order, the
correction must refuse an order that never shipped, and folding them together would make "silently
re-ship" indistinguishable from "fix the tracking number".

**Deliver (`PUT /Orders/{id}/deliver`, `OrdersManage` permission, mandatory `If-Match`):**
1. Fetch the order
2. Validate status is `Paid` or `Shipped` (the carrier leg is optional; see the state machine)
3. Transition status to `Delivered`, stamp `FulfilledPublishedOn`, and raise the in-process
   `OrderDelivered` domain event; on a customer's order also raise the `OrderFulfilled` integration
   event carrying the delivered line snapshot. A guest order has no account to hold a verified
   purchase, so it raises no `OrderFulfilled` (`Order.cs:756`)
4. Persist changes; `OrderFulfilled` leaves through the outbox and Catalog turns it into the
   verified-purchase entitlements behind product reviews (Section 3.13)
5. After the commit, `OrderDeliveredHandler` schedules the `Sales.SendOrderDeliveredEmail` internal
   command (`OrderDeliveredHandler.cs:32-34`), which tells the order's recipient (the customer, or a
   guest's contact email) that the order was delivered
   (`SendOrderDeliveredEmailInternalCommandHandler.cs:43-58`)

**Tracking links:** for UPS, FedEx, USPS and DHL the public link is computed from the carrier's own
template plus the tracking number, so the URL is written down in exactly one place; only the `Other`
carrier accepts a caller-supplied absolute https URL, and supplying one for a known carrier is
refused rather than stored as a second copy that could contradict the template.

**Backfill:** `OrderFulfilledBackfillService` is a settings-gated, bounded one-shot startup sweep that
publishes `OrderFulfilled` for orders that reached `Delivered` before the event existed, which is the
only way those customers can ever review what they demonstrably bought. `Order.FulfilledPublishedOn`
is the marker: the sweep selects only Delivered orders where it is still null, and the marker and the
outbox row commit in the same unit of work, so a run converges, every later start is a no-op, and a
host that dies mid-sweep resumes where it stopped.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Ship/ShipOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/UpdateShipment/UpdateShipmentHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Deliver/DeliverOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/OrderFulfillmentController.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderShippedHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/SendOrderShippedEmailInternalCommandHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderDeliveredHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/LifecycleEmails/SendOrderDeliveredEmailInternalCommandHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/Backfill/OrderFulfilledBackfillService.cs`

---

### 3.9 Payment Verification (webhook backstop)

**Trigger:** The customer (or an admin) asks the system to re-check a payment whose webhook never
arrived, typically from a "Retry / check payment" affordance on the order.

**Steps:**
1. Validate ownership (owner or admin) for `PUT /Orders/{id}/verify-payment`
2. Query Stripe directly for the order's checkout session
3. If Stripe reports the session paid and its amount and currency match the order total
   (`PaymentProof`), mark the order `Paid` exactly as the webhook path would
4. If the order is already `Paid`, or is not in a verifiable state, succeed without changes

**Business Rules Applied:**
- Webhooks are the fast path but are not guaranteed; this is the reconciliation backstop that keeps a
  paid customer from sitting in `PaymentInitiated` indefinitely ([ADR-054](../adr/054-saga-compensation-and-reconciliation.md))
- The operation is idempotent by construction: it converges the order onto whatever Stripe says
- `PaymentReconciliationService` is the scheduled backstop behind it: every `PollIntervalMinutes`
  (10) it reconciles `PaymentInitiated` orders older than `StuckAgeMinutes` (30) against Stripe (paid
  -> `MarkAsPaid`, expired -> `MarkAsPaymentFailed`) and cancels stranded `PendingPayment` and
  `PaymentFailed` orders past the same window, with the `PaymentExpired` reason
  (`PaymentReconciliationService.cs:274`)

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/VerifyPayment/VerifyPaymentHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs`

---

### 3.10 Product Images

**Trigger:** An administrator manages the image collection on a product; any visitor views one.

Behind the `CatalogFeatures.ProductImages` feature gate. Image binaries are stored as rows in the
Catalog database (`ProductImageData`, written through `ProductImageStorageService`), NOT in managed
blob storage: [ADR-045](../adr/045-managed-file-storage-and-avatars.md) records the BR-116 amendment
for MMCA.ADC avatars and MMCA.Store does not adopt it here. `IProductImageStorageService` is
deliberately storage-agnostic, so moving to blob storage later is an infrastructure swap rather than
a handler change. Uploads are capped at 6 MB of request body
(the 5 MB domain constraint plus multipart overhead). Reads are anonymous and output-cached for 300
seconds; every mutation evicts the products cache. The routes form one collection set under
`/Products/{productId}/images`: `GET .../{imageId}` (anonymous), `POST` (upload, `[Idempotent]`),
`DELETE .../{imageId}` and `PUT .../order` (reorder, mandatory `If-Match`), all mutations under
`catalog:product-images:manage`. A product holds at most 10 images
(`ProductImageInvariants.cs:29`). Reordering reassigns display order from the supplied id list, and
the first id becomes the primary image.

**Implemented in:**
- `Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ProductImagesController.cs`

---

### 3.11 Data Subject Rights (GDPR/CCPA)

**Trigger:** A user exports or erases their own account data; an administrator does it on their behalf.

Export returns the personal data held for the user in a portable JSON format. Erasure deletes the
account and irreversibly anonymizes its personal data, which is distinct from the soft-delete used for
ordinary lifecycle ([ADR-005](../adr/005-soft-delete-vs-erasure.md)). Both endpoints authorize the
owner or an Admin, enforced in the handlers rather than by a controller-wide policy.

| Endpoint | Purpose |
|----------|---------|
| `GET /Users/{userId}/export` | Portable JSON of the personal data held for the user, aggregating the Sales section (orders, cart) and the Catalog section (reviews) over gRPC, best effort |
| `DELETE /Users/{userId}` | Erase the account: soft-delete and anonymize the User and its linked Customer in one unit of work, revoke and anonymize every refresh session; the `CustomerErased` integration event carries the erasure into Sales and Catalog |

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersDataExportController.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/UsersController.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs`

---

### 3.12 Password Reset

**Trigger:** A customer who cannot sign in asks for a reset link from `/forgot-password`, then sets a new password on `/reset-password`.

**Steps (request):**
1. `POST /Auth/forgot-password` with `{ "email": "..." }`. The request validator checks the shape of the address only
2. Look up the account behind the address without tracking it
3. Increment the per-address request counter and check it against the rolling-hour throttle
4. Mint a 256-bit single-use token, store only its SHA-256 hash under the address with the configured TTL, and hand the raw token back
5. Email the reset link (`{PasswordReset:ResetUrl}#email=...&token=...`) plus the raw token, so a client that cannot follow a deep link can have the token entered by hand. The address and token ride in the URL fragment, which a browser never sends to a server, so the live token stays out of access logs, telemetry and `Referer` headers (`ForgotPasswordHandlerBase.cs:155`)
6. Return **HTTP 202 Accepted**, which is also what an unknown address, a throttled address and a failed email send return: the response never discloses whether an address holds an account

**Steps (reset):**
1. `POST /Auth/reset-password` with `{ "email": "...", "token": "...", "newPassword": "..." }`. The new password goes through the same strength rules registration uses
2. Validate the presented token against the stored hash in constant time and **consume** it before any write, so it cannot be redeemed twice
3. Revoke every live refresh session on the account (persisted before the password is applied), because a reset is the remediation for a suspected intruder
4. Load the account, hash the new password (PBKDF2-HMAC-SHA512), and apply it through the aggregate (`User.ChangePassword`, which raises `UserPasswordChanged`)
5. Persist, then clear the account's login brute-force counters so a customer who was locked out can sign in immediately
6. Return **HTTP 204 No Content**. Every rejection (unknown, expired, replayed, mismatched or attempt-capped token, or an unresolvable account) collapses to one generic `Auth.InvalidResetToken` **HTTP 401**

Both endpoints are anonymous by necessity (the caller has lost the credential), carry the `auth-ip` per-IP rate limit that login and register carry, and are `[Idempotent]`. They come from the framework's `PasswordResetAuthControllerBase`, bound to Store's commands by a controller routed to the same `Auth` prefix, which the Gateway's `/Auth/{**catch-all}` route already forwards.

**No schema change:** the token lifecycle lives entirely in the cache, so expired tokens are reaped by cache TTL rather than by a sweeper and the feature ships without a migration. A cache eviction invalidates outstanding tokens, which costs the user one more request. See [ADR-091](../adr/091-cache-backed-password-reset.md).

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/PasswordResetController.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs`

---

### 3.13 Product Reviews

**Trigger:** A customer who received a product rates it; anyone reads the ratings; a moderator hides
a review that should not be public.

**Aggregates:** `ProductReview` (Section 2.12) and `VerifiedPurchase` (Section 2.13), both in the
Catalog module, with the derived `RatingSummary` on `Product`.

**Entitlement (the verified-purchase rule):** a review can only be written by a customer who holds a
`VerifiedPurchase` for the product. Those rows are minted by Catalog's consumer of Sales'
`OrderFulfilled` integration event, one per (order, product): the event names variants, because that
is all Sales knows, and Catalog resolves them to products and de-duplicates, so the entitlement is
"you received this product", not "you received this variant". A variant Catalog cannot resolve is
logged and skipped rather than failing the whole order's entitlements. Delivered, not Paid, is the
trigger on purpose: it is terminal and never reversed, so an entitlement never needs revoking.

**Submission rules:** the submit handler enforces the two checks the aggregate cannot make for
itself, because both read rows outside it: no entitlement fails with `Review.NotVerifiedPurchase`,
and a second review of the same product by the same customer fails with `Review.AlreadyReviewed`
rather than landing as a unique-index violation. The entitling row also supplies the order the review
is filed against (the lowest order id, the earliest entitlement). The reviewing customer and the
frozen display name both come from the caller's validated token, never from the body.

**Rating summary:** every review transition (submitted, revised, hidden, unhidden, anonymized,
removed) raises the `ProductReviewChanged` domain event, and the handler **recomputes** the product's
average and count from its published, non-deleted reviews rather than adjusting them incrementally,
so a lost or redelivered event still converges on the right numbers.

**Moderation:** reviews publish immediately (there is no approval queue). A moderator holding the
`catalog:reviews:moderate` permission can hide a review and restore it; hidden reviews leave the
storefront and drop out of the rating summary. Hide and unhide are conditional writes on the same
terms as every other review write ([ADR-035](../adr/035-optimistic-concurrency.md)), so
two moderators acting on the same stale list cannot silently overwrite each other.

**Erasure:** Catalog consumes Identity's `CustomerErased` and anonymizes every review that customer
wrote, soft-deleted and hidden rows included. The name, title and body are cleared and the rating is
kept ([ADR-005](../adr/005-soft-delete-vs-erasure.md), PRIVACY.md section 5). Because the rating does
not move, erasure disturbs no product average.

**Export:** the reviews a customer wrote are a section of the data-subject export document, served by
Catalog through the `IUserCatalogExportService` cross-module contract and aggregated by Identity's
`GET /Users/{userId}/export` (Section 3.11). Hidden reviews are included: a moderator's decision does
not stop the text from being the subject's own data. The verified-purchase rows are deliberately not
exported, because they duplicate order facts Sales already exports.

**Endpoints:**

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /Reviews/by-product/{productId}/paged` | Anonymous | Published reviews of one product, newest first, page size capped server-side. Returns `PublicProductReviewDTO`, which declares no `CustomerId` and no `OrderId`: a pseudonymous key kept through anonymization would re-attach every anonymized review to one subject (ADR-005). The caller's `sortColumn` is validated against that same type. Output-cached under the shared `ProductsCache` policy |
| `GET /Reviews/by-product/{productId}/mine` | Authenticated customer | The caller's eligibility: `HasPurchased`, `CanReview` (the entitlement minus an existing review), and their own review when there is one |
| `POST /Reviews/by-product/{productId}` | Authenticated customer | Submit. `[Idempotent]` (`Idempotency-Key` header) |
| `PUT /Reviews/{id}` | Owner or Admin | Revise the rating and text. Mandatory `If-Match` |
| `DELETE /Reviews/{id}` | Owner or Admin | Withdraw (soft delete). Unconditional: a delete has no field to lose to a concurrent edit |
| `PUT /Reviews/{id}/hide`, `PUT /Reviews/{id}/unhide` | `catalog:reviews:moderate` | Moderation. Mandatory `If-Match` |
| `GET /Reviews/paged` | `catalog:reviews:moderate` | The moderation list: every review whatever its status, filterable and sortable. Never cached |

A caller who is not the owner is answered 404 rather than 403, so the existence of another customer's
review id cannot be probed for. Every mutation evicts the `catalog:products` and `catalog:categories`
output-cache tags, because a review moves the stars the product reads carry and a category read can
embed its products. The Gateway forwards `/Reviews/**` to the
Catalog cluster (`catalog-reviews` route).

**Field rules:** rating 1 to 5, title at most 120 characters, body at most 2,000, frozen reviewer
name at most 201; title and body are both optional and a review with neither is a bare star rating.

**Implemented in:**
- `Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ReviewsController.cs`
- `Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ReviewEligibilityController.cs`
- `Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ReviewModerationController.cs`
- `Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/UseCases/`
- `Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/IntegrationEventHandlers/OrderFulfilledHandler.cs`
- `Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/IntegrationEventHandlers/CustomerErasedHandler.cs`
- `Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/DomainEventHandlers/ProductReviewChangedHandler.cs`

---

### 3.14 Email Confirmation

**Trigger:** A new account registers (the confirmation email is scheduled automatically), or a user
asks for a fresh link and then redeems it.

**Steps:**
1. `UserRegisteredEmailConfirmationHandler` schedules the `Identity.SendEmailConfirmation` internal
   command, so the mail survives a host that dies between the 201 and the SMTP call; a scheduling
   failure is logged, never thrown ([ADR-114](../adr/114-internal-commands-durable-job-queue.md))
2. `POST /Auth/send-email-confirmation` re-sends the link. Every outcome (malformed or unknown address,
   already confirmed, throttled, failed send) answers **HTTP 202**, so the response never discloses
   which addresses hold accounts
3. The link is `{Authentication:EmailConfirmation:ConfirmationUrl}#email=...&token=...`, the token
   single-use and carried in the URL fragment
4. `POST /Auth/confirm-email` redeems the token, calls `User.ConfirmEmail()` (idempotent: an already
   confirmed account succeeds unchanged) and raises `UserEmailConfirmed` the first time; **HTTP 204**

**Business Rules Applied:**
- Confirmation is recorded, not enforced: `Authentication:EmailConfirmation:RequireConfirmedEmail` is
  `false` in the Identity service settings, so an unconfirmed account still signs in
  ([ADR-116](../adr/116-identity-completions-opt-in.md))
- Both endpoints are anonymous, `[Idempotent]` and throttled by the `auth-ip` rate limit

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/EmailConfirmationController.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandler.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/EmailConfirmation/ConfirmEmailHandler.cs`

---

### 3.15 User and Role Administration

**Trigger:** An operator locks, unlocks or re-roles an account, edits which permissions a role holds,
or repairs the link between an account and a customer profile.

| Endpoint | Permission | Behavior |
|----------|------------|----------|
| `GET /Admin/Users/paged` | `users:manage` | The user roster through the generic paged entity contract over `UserDTO`, page size capped at 100 (`AdminUsersController.cs:63`) |
| `GET /Admin/Users/{userId}` | `users:manage` | One account |
| `GET /Admin/Users/{userId}/sessions` | `users:manage` | The account's refresh sessions |
| `POST /Admin/Users/{userId}/lock` | `users:manage` | `User.Deactivate()` (raises `UserDeactivated`), then revoke every live refresh session (`UserAdministrationService.cs:72`, `:82`) |
| `POST /Admin/Users/{userId}/unlock` | `users:manage` | `User.Reactivate()` (raises `UserReactivated`) |
| `PUT /Admin/Users/{userId}/roles` | `users:manage` | Exactly one role (`User.Role.ExactlyOne` otherwise); `User.ChangeRole()` raises `UserRoleChanged`, then every live session is revoked. Assigning the role the account already holds is a no-op success (`UserAdministrationService.cs:103`, `:134`) |
| `GET /Admin/Roles`, `GET /Admin/Roles/catalog`, `GET /Admin/Roles/{role}` | `roles:manage` | The roles with their compiled and stored grants, and the catalog of every permission an endpoint checks |
| `PUT /Admin/Roles/{role}/permissions` | `roles:manage` | Replaces the role's STORED grants only |
| `PUT /Users/{userId}/customer-link` | `identity:users:manage` | Manual counterpart to the registration link: both records must carry the same address, neither may be linked already, and both must still exist |

**Business Rules Applied:**
- "Locked" maps onto `User.IsActive`, so a lock takes effect through the login and refresh gates
  (`Auth.UserDeactivated`), and the session revocation makes it bite immediately rather than at the
  next refresh
- Lock and unlock are `[NonIdempotent]` state setters: a replay re-evaluates the account and answers
  `User.AlreadyDeactivated` or `User.AlreadyActive` (409) rather than a cached 204
- `roles:manage` is granted in compiled code and never from a stored row, because it protects the very
  screen that edits stored rows ([ADR-020](../adr/020-permission-based-authorization.md))

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AdminUsersController.cs` (over the framework's `UsersAdminControllerBase`)
- `Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AdminRolesController.cs` (over the framework's `RolesAdminControllerBase`)
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Administration/UserAdministrationService.cs`
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/LinkCustomer/LinkUserCustomerHandler.cs`

---

### 3.16 Shipping, Tax and Quotes

**Trigger:** The cart drawer or checkout page asks what a bag costs (`POST /Orders/quote`), and every
checkout prices the bag the same way before it places the order.

**Rules:**
- **Shipping** is a flat `Shipping:FlatRate` (5.99) waived once the merchandise subtotal reaches
  `Shipping:FreeShippingThreshold` (50) (`ShippingSettings.cs:16`, `:20`)
- **Sales tax** comes from Stripe Tax on the merchandise and the shipping, tax-exclusive, and only when
  `Tax:Enabled` is on (off by default) and a ship-to address is known; otherwise tax is zero. Once on, a
  failed calculation fails the quote, so checkout never charges a guessed tax (`TaxSettings.cs:18`)
- A quote is anonymous and `[NonIdempotent]`: it writes nothing and reserves nothing, and checkout prices
  the bag again when the order is placed. The response carries the subtotal, shipping, tax (null when
  not calculated), total, the free-shipping threshold and the amount still needed for free shipping
- **Shipping label:** every order with a shipping address gets a label at placement from
  `IShippingLabelProvider`. The registered provider is a mock carrier that issues an invented label
  number (`CASA-{order}-{random}`) and a tracking number starting with `MOCK`, with no network call

**Best sellers:** `GET /Orders/best-sellers?count=8` (anonymous, `count` 1 to 24) ranks variants by units
sold on orders that were actually paid for (Paid, Shipped or Delivered) in the last 90 days, returning
variant ids and unit counts only (`GetBestSellingVariantsHandler.cs:23`). The storefront home page
resolves them to products through the catalog.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/OrderQuotesController.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Quote/GetOrderQuoteHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Charges/OrderChargesCalculator.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeTaxCalculator.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Shipping/MockShippingLabelProvider.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/BestSellersController.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/BestSellers/GetBestSellingVariantsHandler.cs`

---

### 3.17 Payment Deadline (Expire Unpaid Order)

**Trigger:** Every placed order (customer or guest) is given a payment deadline: checkout schedules the
`Sales.ExpireUnpaidOrder` internal command in the same transaction that places the order, and
`OrderPaymentFailedSagaHandler` re-arms it from the moment of every failed payment, so a failed payment
hands the shopper the whole retry window again.

**Steps (when the command runs):**
1. Load the order; an order that is gone, or is no longer `PendingPayment` or `PaymentFailed`, is a
   no-op success (`ExpireUnpaidOrderInternalCommandHandler.cs:61`)
2. Re-derive the due instant from the order's own `LastModifiedOn ?? CreatedOn` rather than the
   schedule time, so an older deadline left behind by a re-arm runs as a no-op (`:67`)
3. Still unpaid and past the window: `Order.MarkAsCancelled(OrderCancellationReason.PaymentExpired)`
   (`ExpireUnpaidOrderInternalCommandHandler.cs:78`), which raises `OrderCancelled`;
   `OrderCancelledSagaHandler` returns the stock checkout committed, and the shopper is emailed that the
   unpaid order expired (Section 3.6)
4. A concurrency conflict (a webhook moved the order first) completes successfully: the concurrent writer wins

**Business Rules Applied:**
- The window is `UnpaidOrderExpiry:Minutes` (30, `Enabled: true`) (`UnpaidOrderExpirySettings.cs:34`, `:43`)
- The Stripe checkout session expires at the same moment, so the hosted page stops taking money when
  the deadline cancels the order (Section 3.5)
- `PaymentReconciliationService` keeps the same window and is the backstop for a deadline that was
  never written (Section 3.9)

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutDeadlineScheduler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs`

---

### 3.18 Guest Checkout

**Trigger:** A shopper who has not signed in buys without an account, from the bag kept on their device.

**Endpoints:** every action but the claim is anonymous; the order's private access token travels in a
request header, and every refusal (wrong token, a customer's order, an already claimed order, an order
that does not exist) answers the same 404, so the endpoints cannot be used to learn which order numbers
exist.

| Endpoint | Auth | Behavior |
|----------|------|----------|
| `POST /Orders/guest` | Anonymous, `[Idempotent]`, `auth-ip` rate limit | Place the order; 201 with the order and its access token |
| `GET /Orders/guest/{id}` | Anonymous + access token | Read the order |
| `POST /Orders/guest/{id}/checkout` | Anonymous + access token, `[Idempotent]` | Open or resume the Stripe session (the same use case as Section 3.5) |
| `POST /Orders/guest/{id}/claim` | Authenticated + access token, `[NonIdempotent]` | Move the order into the signed-in customer's account |
| `POST /Orders/guest/{id}/cancel` | Anonymous + access token, mandatory `If-Match`, `[NonIdempotent]` | Cancel an unpaid order (the same use case as Section 3.6); every refusal answers 404 |
| `POST /Orders/guest/lookup` | Anonymous, `[Idempotent]`, `auth-ip` rate limit | Ask for a new private link by order number and checkout email; always 202 |

**Steps (place order):**
1. Map and validate the delivery details (a shipping address is required for a guest)
2. Price the lines from the catalog and quote shipping and tax, outside the transaction, exactly as the
   customer checkout does (Section 3.4)
3. Mint the access token: 32 random bytes, base64url (`GuestCheckOutHandler.cs:62`, `GuestOrderLinks.cs:19-20`)
4. In one retriable transaction: inventory snapshot and fail-fast sufficiency check,
   `Order.CreateForGuest()` (guest name required, contact email validated, only the token's SHA-256
   hash kept), apply the charges, refuse an unchargeable total, insert, take the atomic inventory
   decrements, save, then attach the shipping label and arm the payment deadline (Section 3.17)
5. After the commit, email the "order received" message carrying the private link (the token in the
   URL fragment). It is sent inline rather than as an internal command, because a command row would put
   the plaintext token back at rest; a send failure is logged and does not fail the checkout
6. Return the order and the token

**Claim:** the token is checked against the stored hash in constant time, then `Order.ClaimForCustomer()`
sets `CustomerId`, clears `GuestAccessTokenHash` (the account, not the link, is the credential from
then on) and raises `OrderChanged` with the `Updated` state (`Order.cs:600`, `:614`).

**Cancel:** the guest order page offers Cancel while the order is `PendingPayment`, `PaymentInitiated`
or `PaymentFailed`, after a confirmation (`GuestOrderDetail.razor.cs:61-65`). The endpoint reads the
order through the token, then runs `CancelOrderCommand` exactly as a customer's cancel does (Section
3.6), and answers any failure, a status that can no longer be cancelled included, with 404
(`GuestOrdersController.cs:163-186`).

**Find my order (a lost link):**
1. The guest gives the order number and the checkout email on `/orders/find`
2. The request matches only an unclaimed guest order whose contact email equals the given one,
   trimmed and compared case-insensitively (`Order.cs:555-559`)
3. On a match, schedule the `Sales.SendGuestOrderLink` internal command, which carries the order id
   only (`RequestGuestOrderLinkHandler.cs:44-46`)
4. Every outcome, a failure to schedule included, answers the same 202, so the endpoint reveals
   neither which orders exist nor who placed them (`RequestGuestOrderLinkHandler.cs:16-21`)
5. The command mints a new token, replaces the stored hash through `Order.ReplaceGuestAccessToken()`,
   emails the new link to the order's own contact email, and saves only after the send succeeded; a
   missing order, a claimed order or an unconfigured storefront origin changes nothing
   (`SendGuestOrderLinkInternalCommandHandler.cs:54-99`). The saved hash retires every earlier link
   (`Order.cs:571-591`)

**The device bag:** placing a guest order keeps the browser bag and remembers the order id with the
lines it was placed with (`GuestCartStore.cs:13-21`, `:104-111`). Once the guest order page sees the
order paid, or the Stripe success return on an order that is neither `Cancelled` nor `PaymentFailed`,
exactly those quantities are subtracted, so items added since survive
(`GuestOrderDetail.Lifecycle.razor.cs:23-43`). At sign-in the bag is settled the same way before it
merges into the account cart: subtracted when that order is paid, shipped, delivered, claimed or its
link replaced, kept whole when it was cancelled, left alone while it is unpaid
(`CartStateService.cs:635-681`).

**Downstream differences for a guest order:** the payment, shipping, payment-failed, delivered and
cancelled emails go to the order's `ContactEmail` (`OrderRecipient.cs:37-39`), and delivery raises no `OrderFulfilled`, so a guest purchase
earns no review entitlement unless it is claimed before delivery.

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/GuestOrdersController.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/GuestCheckout/GuestCheckOutHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/GuestCheckout/GuestOrderPlacedNotifier.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/GuestOrders/ClaimGuestOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/GuestOrders/GetGuestOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/RecoverGuestOrder/RequestGuestOrderLinkHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/SendGuestOrderLinkInternalCommandHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.UI/Services/ShoppingCarts/GuestCartStore.cs`

---

## 4. Order Status State Machine

```
                  InitiatePayment                     MarkAsPaid
 PendingPayment ------------------> PaymentInitiated -------------> Paid -----Ship-----> Shipped
       |                              |          ^                   |                     |
       |         MarkAsPaymentFailed  |          | InitiatePayment   | MarkAsDelivered     | MarkAsDelivered
       |                              v          | (retry)           | (no carrier leg)    |
       |                          PaymentFailed -+                   v                     |
       |                              |                          Delivered <---------------+
       |  MarkAsCancelled             |  MarkAsCancelled
       +-----------------> Cancelled <+  (PaymentInitiated cancels the same way)

 MarkAsPaidManually (admin) reaches Paid from PendingPayment, PaymentInitiated or PaymentFailed.
 MarkAsPaid (webhook, verify-payment, reconciliation sweep) reaches Paid from PaymentInitiated only.
 UpdateShipment is a self-transition on Shipped: it replaces the recorded shipment and
 re-raises OrderShipped without moving the status.
```

**Cancellable States:** PendingPayment, PaymentInitiated, PaymentFailed. `Shipped` is deliberately NOT
cancellable, for the same reason `Paid` is not: the goods and the money have both already moved.
**Shippable States:** Paid (only)
**Shipment-correctable States:** Shipped (only)
**Deliverable States:** Paid, Shipped. The carrier leg is optional: a fulfilment with no tracking to
record still goes Paid -> Delivered directly, which is why Paid keeps both outgoing edges.
**Manual Payment States:** PendingPayment, PaymentInitiated, PaymentFailed
**Payment-initiating States:** PendingPayment, PaymentFailed (a `PaymentInitiated` order resumes its existing session instead)
**Payment-failure States:** PaymentInitiated (only)
**Terminal States:** Cancelled, Delivered

The Cancelled edges are taken by a customer or admin cancel (Section 3.6), by the order's own payment
deadline (Section 3.17, from `PendingPayment` or `PaymentFailed`) and by the reconciliation sweep
(Section 3.9); all three land in the same `OrderCancelled` compensation. Each state is its own
`IOrderState` class under `Sales.Domain/Orders/States/`, selected from the order's `Status`.

The `OrderStatus` numeric values are persisted and travel on the `user_sales_export` gRPC contract, so
members are only ever appended: `Shipped` is last in the enum even though it sits mid-lifecycle.

---

## 5. Business Rules

### 5.1 Product & Catalog Rules

| Rule | Description | Location |
|------|-------------|----------|
| Category name required | Category names cannot be empty or whitespace | `CategoryInvariants.cs` |
| Category name max length | Max 255 characters | `CategoryInvariants.cs` |
| Category name uniqueness | Category names must be unique (database-enforced) | `CategoryConfiguration.cs` |
| Category delete guards | A category with products assigned (`Category.HasProducts`) or with child categories (`Category.HasChildCategories`) cannot be deleted; the operator decides where a subtree goes rather than it being reparented | `Category.cs:87`, `CategoryInvariants.cs:37`, `:53` |
| No parent cycles | A category cannot be its own parent (`Category.SelfReferencing`), and assigning a parent walks the ancestor chain to refuse a multi-level cycle | `CategoryInvariants.cs`, `CategoryAssignParentUpdateHandler.cs` |
| Image limit | A product holds at most 10 images, each at most 5 MB | `ProductImageInvariants.cs:29` |
| Product name required | Product names cannot be empty or whitespace | `ProductInvariants.cs` |
| Product name max length | Max 100 characters | `ProductInvariants.cs` |
| Description max length | Max 4,000 characters | `ProductInvariants.cs` |
| Brand not whitespace | If a brand is provided, it cannot be only whitespace | `ProductInvariants.cs` |
| Brand max length | Max 100 characters | `ProductInvariants.cs` |
| Price must be non-negative | Product variant prices must have Amount >= 0 | `ProductInvariants.cs` |
| SKU max length | Max 50 characters | `ProductInvariants.cs` |
| SKU global uniqueness | SKUs must be globally unique across all product variants (null allowed for multiple variants without SKUs) | `AddVariantHandler.cs`, `ProductVariantConfiguration.cs` |
| Review rating range | A review rating must be between 1 and 5 stars | `ProductReviewInvariants.cs` |
| Review title max length | Max 120 characters (optional field) | `ProductReviewInvariants.cs` |
| Review body max length | Max 2,000 characters (optional field) | `ProductReviewInvariants.cs` |
| Reviewer name max length | Max 201 characters; frozen at submission from the caller's token and never revisable | `ProductReviewInvariants.cs`, `ProductReview.cs` |
| Verified purchase required | Only a customer holding a `VerifiedPurchase` for the product may review it (`Review.NotVerifiedPurchase`) | `SubmitReviewHandler.cs` |
| One review per customer and product | A second review of the same product by the same customer is refused (`Review.AlreadyReviewed`) rather than hitting the unique index | `SubmitReviewHandler.cs`, `ProductReviewConfiguration.cs` |
| Entitlement is per product, not per variant | Delivered lines naming several variants of one product mint a single entitlement row | `OrderFulfilledHandler.cs` |
| Rating summary is derived | `Product.RatingSummary` is recomputed (AVG/COUNT) over published, non-deleted reviews on every review change, never adjusted incrementally | `ProductReviewChangedHandler.cs` |
| Hidden reviews do not count | A hidden review leaves the storefront and drops out of the product's rating summary | `PublishedReviewsSpecification.cs` |
| Review erasure keeps the rating | Anonymizing a review clears the name, title and body and retains the star rating | `ProductReview.Anonymize()` |
| Discount percentage range | A percentage discount must be greater than 0 and less than 100 | `VariantDiscount.cs` |
| Special price is positive | A special price amount must be greater than 0 | `VariantDiscount.cs` |
| Special price currency matches | A special price must be quoted in the same currency as the list price | `VariantDiscount.cs` |
| Special price below list price | A special price must sit strictly below the variant's list price | `VariantDiscount.cs`, `ProductVariant.SetDiscount()` |
| Discount window ordered | When both bounds are given, the end must be after the start; the start is inclusive and the end exclusive, and a null bound leaves that side open | `VariantDiscount.cs` |
| Discount label max length | Max 50 characters (optional, trimmed at construction) | `VariantDiscount.cs` |
| Effective price stays positive | Applying a discount must leave an amount greater than zero, so a zero-priced variant cannot carry one | `VariantDiscount.cs` |
| Percentage rounding | A percentage result is rounded to two decimals, away from zero | `VariantDiscount.ApplyTo()` |
| Price change re-validates the discount | Changing a discounted variant's list price fails when the stored discount no longer resolves against the new price; the admin clears the discount first | `ProductVariant.cs` |
| Product-wide discount is all or nothing | A discount applied across a product is validated against every active variant before any variant is touched | `Product.SetDiscountOnAllVariants()` |
| Product-wide discount needs a variant | A product with no active variant to discount is refused (`Product.NoActiveVariants`, a 400) rather than silently succeeding on an empty set | `ProductInvariants.cs`, `Product.SetDiscountOnAllVariants()` |
| Discounting is a separate permission | Setting or clearing a discount requires `catalog:pricing:manage`, not the broader variant-management permission | `CatalogPermissions.cs`, `ProductVariantsController.cs` |

### 5.2 Shopping Cart Rules

| Rule | Description | Location |
|------|-------------|----------|
| Cart must be active | Items can only be added/removed/changed when cart is Active | `ShoppingCartInvariants.cs` |
| Positive quantity | Item quantities must be greater than zero | `ShoppingCartInvariants.cs` |
| Non-empty for checkout | Cart must contain at least one item to check out | `ShoppingCartInvariants.cs` |
| Variant must exist | Product variant must exist in catalog before adding to cart | `AddItemHandler.cs` |
| Duplicate merging | Adding a variant already in cart increases its quantity | `ShoppingCart.cs` |
| Reactivation on add | Adding items to a checked-out cart reactivates it and clears all old items | `AddItemHandler.cs` |

### 5.3 Order Rules

| Rule | Description | Location |
|------|-------------|----------|
| Orders via checkout only | Orders can only be created through the shopping cart checkout or the guest checkout | `CheckOutHandler.cs`, `GuestCheckOutHandler.cs` |
| Guest order identity | A guest order needs the guest's name (`Order.GuestName.Required`) and a valid contact email of at most 100 characters (`Order.ContactEmail.Invalid`); the access token is exactly 43 characters (32 bytes, base64url) and only its 64-character hex SHA-256 hash is stored | `OrderInvariants.cs:147`, `:153`, `:162`, `:168` |
| Contact phone length | The optional checkout phone is at most 30 characters | `OrderInvariants.cs:150` |
| Guest access by token only | Reading, paying for, cancelling or claiming a guest order requires its access token, compared in constant time; every refusal answers 404 | `Order.cs:541`, `GetGuestOrderHandler.cs`, `ClaimGuestOrderHandler.cs`, `GuestOrdersController.cs:163-186` |
| Claim only a guest order | Only a guest order can be claimed into an account (`Order.Claim.NotAGuestOrder`); claiming clears the token hash | `Order.cs:600` |
| A link request reveals nothing | Asking for a new guest order link answers the same success whether or not the number and email matched, and the link goes only to the address already on the order | `RequestGuestOrderLinkHandler.cs:16-21`, `SendGuestOrderLinkInternalCommandHandler.cs:60-82` |
| A new link retires the old | Replacing a guest order's token keeps only the new hash, so every earlier link stops opening the order; only an unclaimed guest order has a token to replace (`Order.GuestAccessToken.NotAGuestOrder`) | `Order.cs:571-591` |
| Charges before payment | Shipping and tax can only be applied while the order is `PendingPayment` with no payment session (`Order.Charges.PaymentStarted`); neither charge can be negative | `Order.cs:485`, `OrderInvariants.cs` |
| Total is the sum of its parts | `Total = Subtotal + ShippingCost + TaxAmount`, and a payment session whose subtotal, shipping and tax do not add up to the total is refused | `Order.cs:485`, `StripePaymentService.cs:153` |
| Bag unchanged since the quote | Checkout refuses an order whose subtotal differs from the quote it was charged from (`Order.Charges.BagChanged`, 409) | `OrderQuoteApplier.cs:28` |
| Chargeable total | A total below the payment provider's minimum (`Stripe:MinimumChargeAmount`, 0.50) is refused before anything is written (`Order.Total.BelowMinimumCharge`) | `CheckOutHandler.cs:188`, `StripeSettings.cs:55` |
| Payment matches the order | An order is marked paid from provider data only when the session is paid and its amount and currency match the order total | `PaymentProof.cs:26` |
| Shipping label needs an address | A label attaches once, and only to an order with a shipping address | `Order.cs:450` |
| Non-empty order | Orders must contain at least one order line | `OrderInvariants.cs` |
| Positive line quantity | Order line quantities must be greater than zero | `OrderInvariants.cs` |
| Non-negative line price | Order line unit prices cannot be negative | `OrderInvariants.cs` |
| List price not below unit price | An order line's frozen list price cannot be negative and cannot sit below the price actually charged | `OrderInvariants.cs` |
| List price currency matches | The frozen list price must be quoted in the same currency as the unit price | `OrderInvariants.cs` |
| Promotion label max length | Max 50 characters, the same bound the Catalog discount label carries; null means no promotion was in force | `OrderInvariants.cs` |
| Cancellation restriction | Only PendingPayment, PaymentInitiated, or PaymentFailed orders can be cancelled | `States/*State.cs` (`CanMarkAsCancelled`) |
| Payment initiation restriction | Payment can only be initiated from PendingPayment or PaymentFailed states | `PendingPaymentState.cs`, `PaymentFailedState.cs` |
| Payment confirmation restriction | Only PaymentInitiated orders can be marked as paid from provider data (webhook, verify-payment, reconciliation) | `PaymentInitiatedState.cs` |
| Manual payment restriction | Manual payment allowed from PendingPayment, PaymentInitiated, or PaymentFailed | `States/*State.cs` (`CanMarkAsPaidManually`) |
| Delivery restriction | Only Paid or Shipped orders can be marked as delivered | `PaidState.cs`, `ShippedState.cs` |
| Shipping restriction | Only Paid orders can ship; a Shipped order re-shipping would silently replace a tracking number the customer was already told | `PaidState.cs`, `ShippedState.cs` |
| Shipment correction restriction | Only a Shipped order's shipment can be corrected: there is nothing to correct before it ships, and after delivery the record is history | `IOrderState.cs`, `DeliveredState.cs` |
| Shipped is not cancellable | Cancellation is refused from Shipped exactly as it is from Paid | `ShippedState.cs` |
| Shipment replaces whole | A correction replaces the entire `Shipment` value object rather than patching a field, and re-raises `OrderShipped` so the customer is re-notified | `Order.UpdateShipment()` |
| Tracking number required | A shipment must carry a tracking number, max 100 characters | `Shipment.cs` (`ShipmentInvariants`) |
| Estimated delivery not before shipping | The estimated delivery date cannot fall before the day the parcel shipped (same-day is allowed) | `Shipment.cs` (`ShipmentInvariants`) |
| Tracking URL only for `Other` | A caller-supplied absolute https tracking URL (max 500) is accepted only for carrier `Other`; every known carrier's link is computed from its template | `Shipment.cs` (`ShipmentInvariants`), `Carrier.cs` (`CarrierTrackingUrls`) |
| Fulfilment published once | `Order.FulfilledPublishedOn` is stamped in the same unit of work that raises `OrderFulfilled`, so the startup backfill can never re-publish for an order | `Order.cs`, `OrderFulfilledBackfillService.cs` |
| Inventory restoration | Cancelling an order restores all order line quantities to inventory, once, after the cancellation commits | `OrderCancelledSagaHandler.cs`, `InventoryRestorationDomainService.cs` |
| Unpaid orders expire | An order still `PendingPayment` or `PaymentFailed` when its window (30 minutes) closes is cancelled and its stock returned | `ExpireUnpaidOrderInternalCommandHandler.cs:61`, `UnpaidOrderExpirySettings.cs:43` |
| Fulfilment notice for accounts only | Delivery raises `OrderFulfilled` only for an order that belongs to a customer | `Order.cs:756` |
| Price snapshot | Order lines capture the effective price, the list price it was struck from and the promotion label at checkout time, not the current catalog price | `CheckOutDomainService.cs`, `OrderLinePricing.cs` |
| Savings are derived | `OrderLine.Savings` and `Order.TotalSavings` are computed from the frozen pair on every read and never stored, so no column can disagree with the prices it restates | `OrderLine.cs`, `Order.cs` |

### 5.4 Inventory Rules

| Rule | Description | Location |
|------|-------------|----------|
| Non-negative stock | Available quantity can never go below zero | `InventoryItemInvariants.cs` |
| Positive adjustment | Increase/decrease amounts must be positive | `InventoryItemInvariants.cs` |
| Sufficient stock | Decreasing inventory requires sufficient available quantity | `InventoryItemInvariants.cs` |
| Variant must exist | Inventory can only be created or adjusted for existing product variants (`Inventory.InvalidProductVariant`), checked across the module boundary | `InventoryProductVariantGuard.cs`, `BulkSetInventoryHandler.cs` |
| Bulk set bounds | A bulk set carries 1 to 500 items with no duplicate variant | `BulkSetInventoryRequestValidator.cs` |
| Seed never resets live stock | Startup seeding lifts only a row still at zero; any other count is live stock | `SalesModuleDbSeeder.cs:97` |

### 5.5 Identity & Authentication Rules

| Rule | Description | Location |
|------|-------------|----------|
| Unique email (User) | User emails must be unique | `UserConfiguration.cs` |
| Unique email (Customer) | Customer emails must be unique | `CustomerConfiguration.cs` |
| Valid role | User roles must be either "Admin" or "Customer" (case-insensitive, `User.Role.Invalid`) | `UserInvariants.cs`, `UserRole.cs` |
| Exactly one role | An administrator role change names exactly one role (`User.Role.ExactlyOne`) | `UserAdministrationService.cs:103` |
| Deactivated accounts refused | Login and token refresh refuse an inactive account (`Auth.UserDeactivated`) | `AuthenticationService.cs:112` |
| Credential and privilege changes end sessions | Locking an account, changing its role, changing the password and resetting it revoke every live refresh session | `UserAdministrationService.cs:82`, `:134`, `ResetPasswordHandlerBase.cs` |
| Lock and unlock are state setters | Locking a locked account (`User.AlreadyDeactivated`) or unlocking an active one (`User.AlreadyActive`) is a 409 | `User.cs:229`, `:257` |
| Email confirmation is recorded, not enforced | `RequireConfirmedEmail` is false, so an unconfirmed account signs in | `User.cs:60`, `EmailConfirmationSettings.cs:55` |
| Registration never auto-links an existing profile | A Customer that already holds the registering address is left unlinked until an administrator links it | `UserRegisteredHandler.cs`, `LinkUserCustomerHandler.cs` |
| Access token expiry | Access tokens expire after 15 minutes (configurable) | `JwtSettings.cs:66` |
| Refresh token expiry | Refresh tokens expire after 7 days (configurable); each device holds its own rotating session | `JwtSettings.cs:73` |
| Auto customer creation | Registering as a Customer automatically creates a linked Customer entity | `UserRegisteredHandler.cs` |
| Admin no customer | Admin users do not get an associated Customer record | `UserRegisteredHandler.cs` |
| Name required | Customer first name and last name cannot be empty or whitespace | `CustomerInvariants.cs` |
| Email required | Customer email cannot be empty or whitespace | `CustomerInvariants.cs` |
| Address line 1 required | If address is provided, AddressLine1 is required | `AddressInvariants.cs` |
| Reset request anti-enumeration | `POST /Auth/forgot-password` answers 202 for every well-formed address: unknown address, throttled address and failed email send are logged server-side and reported as accepted. Only a malformed address returns 400 | `ForgotPasswordHandler.cs`, `ForgotPasswordRequestValidator` |
| Reset token strength | 256-bit Base64Url token, single-use, SHA-256 hashed at rest, compared in constant time, one active token per address (a new request overwrites the old) | `PasswordResetTokenService` |
| Reset token expiry | Tokens expire after `PasswordReset:TokenLifetimeMinutes` (default 30) | `PasswordResetSettings` |
| Reset attempt cap | The token record is discarded after `PasswordReset:MaxValidationAttempts` wrong guesses (default 5); a wrong guess is rewritten with the remaining lifetime, never a fresh one | `PasswordResetTokenService` |
| Reset request throttle | Maximum `PasswordReset:MaxRequestsPerEmail` requests per address per `RequestWindowMinutes` (default 3 per hour); over-limit still answers 202 and sends nothing | `PasswordResetTokenService` |
| Reset clears lockout | A successful reset clears the account's login brute-force counters and its reset-request counter | `ResetPasswordHandler.cs` |
| Reset password strength | The new password goes through the same strength rules as registration, so a reset cannot bypass the complexity policy | `ResetPasswordRequestValidator` |

---

## 6. Use Cases

### Customer-Facing

| Use Case | Actor | Description |
|----------|-------|-------------|
| Register | Anonymous | Create a new customer account with email and password |
| Login | Anonymous | Authenticate with email and password to receive JWT tokens |
| Refresh session | Any authenticated | Obtain new tokens using a valid refresh token (rotated on every use) |
| Revoke session | Any authenticated | Invalidate the current refresh token to end the session |
| Manage devices | Any authenticated | List the signed-in devices (refresh sessions) and sign one out |
| Confirm email | Anonymous | Redeem the confirmation link sent at registration, or ask for a fresh one |
| Request password reset | Anonymous | Ask for a reset link by email; always accepted for a well-formed address |
| Reset password | Anonymous | Set a new password by redeeming the single-use token from the reset email |
| Visit the storefront home | Anonymous | Hero, category tiles, a Best Sellers row and the store information pages |
| Browse catalog | Anonymous | View categories, products, and product variants with pricing; search name and description, filter by category or to what is on sale now, sort by name, newest, price or rating |
| View product detail | Anonymous | See product details, variants, pricing, and add to cart |
| Add item to cart | Anonymous or Customer | Add a product variant with quantity to the bag: a signed-out shopper's bag lives on the device, a customer's in the server cart |
| See what the bag costs | Anonymous or Customer | Subtotal, shipping, the amount still needed for free shipping and, once an address is entered, sales tax (`POST /Orders/quote`) |
| Change cart item quantity | Customer | Update the quantity of an item already in cart (+/- controls) |
| Remove item from cart | Customer | Remove a product variant from shopping cart, with an Undo that puts it back |
| Clear cart | Customer | Remove all items from shopping cart, after a confirmation |
| Checkout | Customer | Confirm the shipping and billing addresses on `/checkout` and convert the shopping cart into an order (reserves inventory) |
| Guest checkout | Anonymous | Place an order from the device bag with a name, an email and the addresses; receive a private order link |
| View guest order | Anonymous (access token) | Open the order from its private link: items, addresses, status, tracking and totals; pay for it |
| Claim guest order | Customer | Create an account from the guest order page and move the order into it |
| Cancel guest order | Anonymous (access token) | Cancel an unpaid guest order from its private link, after a confirmation (restores inventory) |
| Find my order | Anonymous | Ask for a new private link to a guest order by order number and checkout email; the link is emailed to the order's own address and replaces the old one |
| Initiate payment | Customer or guest | Start (or resume) the Stripe checkout session for a pending order |
| Resume an abandoned payment | Customer | Pick an order left in `PendingPayment` or `PaymentInitiated` back up after backing out of Stripe Checkout |
| View my orders | Customer | List all orders belonging to the authenticated customer as order cards (order number, status, date placed, item count, total); reached from the nav menu or the profile page's "My orders" link |
| View order detail | Customer | See order status, lines, payment information, and the carrier/tracking details once the order ships. A discounted line shows the struck list price and the promotion label, and the order shows a "you saved" total |
| Read product reviews | Anonymous | See a product's star rating and the published reviews of it |
| Write a product review | Customer | Rate and review a product from a delivered order (one review per product) |
| Revise a review | Customer | Change the rating or wording of their own review |
| Withdraw a review | Customer | Remove their own review |
| Cancel order | Customer | Cancel a pending/initiated/failed order after a confirmation (restores inventory, emails a cancellation notice) |
| Update profile | Customer | Change name, address (the state picked from the US postal regions), or password via profile page (email change is not offered in the UI) |
| Change password | Customer | Update account password via profile page |
| Change preferences | Any authenticated | Persist the UI culture and theme to the account |
| Export my data | Account owner | Download the personal data held for the account as JSON |
| Erase my account | Account owner | Delete the account and anonymize its personal data |

### Administrator-Facing

| Use Case | Actor | Description |
|----------|-------|-------------|
| Manage categories | Admin | Create, rename, assign parent, delete categories |
| Manage products | Admin | Create, rename, update description/brand/category of products |
| Manage product variants | Admin | Add/remove variants, change SKU and list price (the list price is what the variant editor edits; promotional pricing is a separate use case) |
| Manage discounts | Pricing manager (`catalog:pricing:manage`) | Set or clear promotional pricing on one variant (a percentage off or a special price, with an optional window and label), or apply one discount across every active variant of a product in a single all-or-nothing write |
| Manage inventory | Admin | Increase, decrease, or set stock levels per variant |
| Mark order as paid | Admin | Manually override payment for an order |
| Ship order | Admin | Record the carrier, tracking number and estimated delivery on a paid order; the customer is emailed the tracking link |
| Correct tracking details | Admin | Replace the shipment recorded on a shipped order and re-notify the customer |
| Mark order as delivered | Admin | Confirm order has been delivered (from Paid or Shipped) |
| Moderate reviews | Moderator (`catalog:reviews:moderate`) | Browse every review whatever its status, hide one, restore a hidden one |
| View all orders | Admin | View orders across all customers with filtering/pagination |
| Cancel order | Admin | Cancel any cancellable order |
| View all shopping carts | Admin | Browse customer shopping carts with status |
| View cart details | Admin | See cart contents, manage items, check out on the customer's behalf (no addresses, no shipping label) |
| Manage customers | Admin | Create, view, edit, delete and export customer profiles |
| Manage users | Admin (`users:manage`) | Browse accounts, lock (deactivate) and unlock (reactivate) one, change its role, list its sessions |
| Manage roles | Admin (`roles:manage`) | View each role's permissions and edit its stored grants |
| Link user to customer | Admin (`identity:users:manage`) | Attach an existing customer profile to an account that registration left unlinked |
| Bulk set inventory | Admin | Set the stock of up to 500 variants in one request |
| Export data | Admin | CSV export of products, customers, orders and carts |
| Act for an account owner | Admin | Export or erase another account's personal data |

---

## 7. Domain Events and State Changes

Most mutations raise a single `{Entity}Changed` lifecycle event carrying a `DomainEntityState`
discriminator (`Added`, `Updated`, `Deleted`) rather than one event per verb
([ADR-083](../adr/083-crud-lifecycle-event-taxonomy.md)). Those events derive from
`EntityChangedEvent<TId>`; the remaining ones are business events that name a specific transition and
derive from `BaseDomainEvent`. The **Kind / State** column below says which is which, and the states
a given event actually reaches. Every event listed is a real record type under the module's
`Domain/{Aggregate}/DomainEvents/` folder.

### Catalog Events

| Event | Kind / State | Trigger | Business Meaning |
|-------|--------------|---------|-----------------|
| `CategoryChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `Category.Create`; `Category.Rename` (only if the name actually differs); `Category.Delete` (soft delete) | A product classification becomes available, is relabelled, or is withdrawn |
| `ProductChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `Product.Create`; `Product.Rename` (only if the name actually differs); `Product.Delete` (soft delete) | An item becomes available for sale, is relabelled, or is withdrawn. Description, brand and category reassignment raise no event |
| `ProductImageChanged` | State-carrying business event: `Added`, `Updated`, `Deleted` (carries the image id, null on a reorder) | `Product.AddProductImage`; `Product.ReorderProductImages` (`Updated`); `Product.RemoveProductImage` | The product's image gallery changed |
| `ProductReviewChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `ProductReview.Create`; `Revise`, `Hide`, `Unhide` and `Anonymize` (all `Updated`); `ProductReview.Delete` | `ProductReviewChangedHandler` recomputes the product's rating summary from the published, non-deleted reviews |

Variant-level changes raise no Catalog domain event at all: adding, removing, re-pricing and
re-SKU-ing a variant all signal through the `ProductVariantChanged` **integration** event described
below. Setting a variant discount, clearing one, and applying one across a whole product do the same,
each raising `ProductVariantChanged` with the `Updated` state and the variant's **list** price. The
event contract does not grow a discount field: its consumers denormalize catalog labels and stock rows
and none of them price anything, so a consumer that ever needs what a shopper pays asks
`IProductVariantService.GetUnitPricesAsync`, which answers with the effective price, the list price it
was struck from and the active promotion's label
([ADR-112](../adr/112-catalog-owned-effective-pricing.md)).

### Sales Events

| Event | Kind / State | Trigger | Business Meaning |
|-------|--------------|---------|-----------------|
| `ShoppingCartChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `ShoppingCart.Create`; `ShoppingCart.Clear` (`Updated`); `ShoppingCart.Delete` (soft delete) | The customer's cart is opened, emptied, or removed |
| `ShoppingCartItemChanged` | State-carrying business event: `Added`, `Updated`, `Deleted` (carries the old and new quantity) | `AddShoppingCartItem` (`Added` for a new variant, `Updated` when a duplicate add raises the quantity); `ChangeShoppingCartItemQuantity` (`Updated`); `RemoveShoppingCartItem` (soft delete) | Line-level movement in the cart |
| `ShoppingCartCheckedOut` | Business event | `ShoppingCart.MarkAsCheckedOut` | Customer committed to purchase |
| `OrderChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `Order.Create` and `Order.CreateForGuest` at checkout (`Added`); `Order.ClaimForCustomer` when a guest order moves into an account and `Order.ReplaceGuestAccessToken` when a guest asks for a new link (`Updated`); `Order.Delete` (soft delete) | A purchase order is recorded, claimed into an account, given a new guest link, or its record is withdrawn |
| `OrderPaymentInitiated` | Business event (carries the Stripe session id) | `Order.InitiatePayment` | Customer directed to payment |
| `OrderPaid` | Business event (carries the total, the order's total savings, and a snapshot of every order line including its list price and promotion label) | `Order.MarkAsPaid` (webhook, verify-payment, reconciliation) and `Order.MarkAsPaidManually` | Revenue collected; `OrderPaidHandler` schedules the payment confirmation email (`Sales.SendOrderPaidEmail` internal command) |
| `OrderPaymentFailed` | Business event | `Order.MarkAsPaymentFailed` | `OrderPaymentFailedSagaHandler` schedules the "you can retry" email (`Sales.SendOrderPaymentFailedEmail`) and re-arms the order's payment deadline from now |
| `OrderShipped` | Business event (carries carrier, tracking number, tracking link, ship date and estimated delivery date) | `Order.Ship`, and again on `Order.UpdateShipment` for every correction to the recorded shipment | `OrderShippedHandler` schedules the shipping email (`Sales.SendOrderShippedEmail`) with the carrier, tracking number and tracking link, re-sending on a correction |
| `OrderDelivered` | Business event | `Order.MarkAsDelivered` | Fulfillment completed; raised alongside the `OrderFulfilled` integration event on a customer's order. `OrderDeliveredHandler` schedules the delivery email (`Sales.SendOrderDeliveredEmail`) |
| `OrderCancelled` | Business event (carries the `OrderCancellationReason`: `Requested` or `PaymentExpired`) | `Order.MarkAsCancelled` | `OrderCancelledSagaHandler` restores the inventory taken at checkout; `OrderCancelledHandler` schedules the cancellation email (`Sales.SendOrderCancelledEmail`), worded by the reason |
| `InventoryItemChanged` | Lifecycle: `Added`, `Deleted` (no `Updated` is raised) | `InventoryItem.Create`; `InventoryItem.Delete` (soft delete) | A variant becomes trackable, or stops being tracked |
| `InventoryAdjusted` | Business event (carries the old and new available quantity) | `InventoryItem.SetInventory`, only when the quantity actually changes; `IncreaseInventory` and `DecreaseInventory` reach it through that method | Available quantity updated |

### Identity Events

| Event | Kind / State | Trigger | Business Meaning |
|-------|--------------|---------|-----------------|
| `UserRegistered` | Business event (carries the email, name, role and address) | `User.Create` | `UserRegisteredHandler` creates the linked `Customer` profile for non-admin accounts; `UserRegisteredEmailConfirmationHandler` schedules the confirmation email |
| `UserPasswordChanged` | Business event | `User.ChangePassword`, reached by both the change-password and the password-reset workflows | Security credentials rotated. No handler: the event is an extension point |
| `UserDeactivated` | Business event | `User.Deactivate`, reached by `POST /Admin/Users/{userId}/lock` | User can no longer sign in or refresh. No handler |
| `UserReactivated` | Business event | `User.Reactivate`, reached by `POST /Admin/Users/{userId}/unlock` | A deactivated account is back in service. No handler |
| `UserRoleChanged` | Business event (carries the previous and the new role) | `User.ChangeRole`, only when the role actually differs | Privilege change announced rather than only stamped on the audited row. No handler |
| `UserEmailConfirmed` | Business event | `User.ConfirmEmail`, the first time only | The account proved it receives mail at its address. No handler |
| `CustomerChanged` | Lifecycle: `Added`, `Updated`, `Deleted` | `Customer.Create`; `ChangeName`, `ChangeEmail` and `ChangeAddress` (all `Updated`, and only when the value actually differs); `Customer.Delete` (soft delete) | The customer profile is established, corrected, or withdrawn |

### Integration Events (cross-service)

The events above are in-process domain events. These four cross the service boundary through the
outbox and the message broker, and each one is a signal for the consumer to create or refresh a
denormalized copy IT owns, never a prompt to query back into the publisher ([ADR-006](../adr/006-database-per-service.md)).
Contracts live in the publisher's Shared layer, so a consumer never references the publisher's Domain.
Their payloads are frozen by `IntegrationEventContractTests` in the architecture test project, which
fails on any member added, removed or retyped without a new contract version.

| Event | Contract name | Payload (frozen) | Publisher -> Consumer | Business meaning |
|-------|---------------|------------------|-----------------------|------------------|
| `ProductVariantChanged` | `Catalog.ProductVariantChanged.v1` | `State`, `ProductId`, `ProductVariantId`, `Sku`, `Price`, `ProductName` | Catalog -> Sales: raised by `Product` for `Updated` and `Deleted`; for `Added`, `AddVariantHandler` schedules the `Catalog.PublishProductVariantChanged` internal command after the save, so the publish is durable. Consumer `ProductVariantChangedHandler` | Variant lifecycle; Sales auto-creates the zero-stock inventory record and refreshes its denormalized SKU/product sort labels. `Price` is always the **list** price |
| `ProductInfoChanged` | `Catalog.ProductInfoChanged.v1` | `State`, `ProductId`, `Name` | Catalog -> Sales: raised by `Product.Rename` and `Product.Delete`. Consumer `ProductInfoChangedHandler` | A product rename or delete fans out to those same labels on every inventory row of the product |
| `OrderFulfilled` | `Sales.OrderFulfilled.v1` | `OrderId`, `CustomerId`, `DeliveredOn`, `Lines` (variant id and quantity) | Sales -> Catalog: raised by `Order.MarkAsDelivered` and `Order.RepublishFulfillment`, for a customer's order only (a guest order has no account to entitle). Consumer `OrderFulfilledHandler` | A delivered order, with its line snapshot; Catalog turns it into the verified-purchase entitlements behind product reviews |
| `CustomerErased` | `Identity.CustomerErased.v1` | `CustomerId` | Identity -> Sales **and** Catalog: raised by `Customer.Anonymize`. Consumers: a `CustomerErasedHandler` in each of Sales and Catalog | Sales clears the frozen customer name on retained orders; Catalog anonymizes the customer's reviews, keeping the ratings ([ADR-005](../adr/005-soft-delete-vs-erasure.md)) |

---

## 8. External Integrations

### 8.1 Stripe Payment Gateway

**Purpose:** Processes online customer payments for orders.

**Business Impact:** Enables the system to collect payments from customers and confirm payment success or failure asynchronously via webhooks.

**Integration Points:**
- **Checkout Session Creation**: Creates hosted payment pages with order details, converting internal Money values to Stripe's smallest currency unit (cents). Maps order lines to Stripe line items with product name, quantity, and unit amount, plus the order's shipping and tax; the session expires with the order's unpaid window.
- **Session status and expiry**: Reads a session's status (verify-payment, reconciliation, resume) and expires a session when an order leaves `PaymentInitiated` by cancellation or manual payment.
- **Webhook Processing**: Receives payment status notifications, verifies the signature (`EventUtility.ValidateSignature()`) against either trusted secret, then parses the event (`EventUtility.ParseEvent()`). Handles `checkout.session.completed`, `checkout.session.expired`, and `payment_intent.payment_failed` events. `StripeWebhookRegistrationService` verifies or creates the webhook endpoint at startup when `WebhookBaseUrl` is set.
- **Stripe Tax**: `StripeTaxCalculator` calculates sales tax on the merchandise and the shipping from the ship-to address, only while `Tax:Enabled` is on (Section 3.16).
- **Resilience**: every Stripe call runs under a retry (3 attempts) and a circuit breaker (`Payment.Stripe.CircuitOpen` while open).
- **Error Handling**: Stripe API errors return `Result.Failure` with codes `"Payment.Stripe.SessionCreationFailed"`, `"Payment.Stripe.SessionRetrievalFailed"`, `"Payment.Stripe.SessionExpirationFailed"`, `"Payment.Stripe.UnsupportedCurrency"` and `"Payment.Stripe.ChargesDoNotAddUp"`. Signature verification failures return `"Payment.SignatureVerification.Failed"`.
- **Configuration**: Stripe API key (`SecretKey`), webhook secret (`WebhookSecret`), `WebhookBaseUrl` and `MinimumChargeAmount` (0.50) configured per environment via `StripeSettings` (user secrets recommended).

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs`,
`Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeTaxCalculator.cs`,
`Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs`

### 8.2 SMTP Email Service

**Purpose:** Infrastructure for sending email notifications.

**Business Impact:** Provides the capability for system-to-user communication.

**Configuration:**
- Host, Port (default 25), Username, Password, EnableSsl, From, To (the `Smtp` section)
- The service hosts point at `localhost:1025` (MailDev, started by the Aspire AppHost) in their default settings

**Source:** `MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs`, `MMCA.Common.Infrastructure/Mail/SmtpSettings.cs`

**Consumers:** every email goes through `IEmailSender`:

| Email | Sent by | Delivery |
|-------|---------|----------|
| Password reset (Section 3.12) | `ForgotPasswordHandler` | Inline; a send failure is logged and the request still answers 202, because reporting it would be an enumeration oracle, and the token stays live so the customer can retry |
| Email confirmation (Section 3.14) | `SendEmailConfirmationHandler` | The `Identity.SendEmailConfirmation` internal command at registration; inline on a re-send request |
| Order received, guest only (Section 3.18) | `GuestOrderPlacedNotifier` | Inline after the commit, because only the token's hash is stored; best effort |
| Payment confirmation | `SendOrderPaidEmailInternalCommandHandler` | The `Sales.SendOrderPaidEmail` internal command scheduled by `OrderPaidHandler` |
| Shipping and tracking (re-sent on every correction) | `SendOrderShippedEmailInternalCommandHandler` | The `Sales.SendOrderShippedEmail` internal command scheduled by `OrderShippedHandler` |
| Payment failed, you can retry | `SendOrderPaymentFailedEmailInternalCommandHandler` | The `Sales.SendOrderPaymentFailedEmail` internal command scheduled by `OrderPaymentFailedSagaHandler` |
| Delivered (Section 3.8) | `SendOrderDeliveredEmailInternalCommandHandler` | The `Sales.SendOrderDeliveredEmail` internal command scheduled by `OrderDeliveredHandler` |
| Cancelled, or unpaid order expired (Section 3.6) | `SendOrderCancelledEmailInternalCommandHandler` | The `Sales.SendOrderCancelledEmail` internal command scheduled by `OrderCancelledHandler`, carrying the cancellation reason |
| Your order link, guest only (Section 3.18) | `SendGuestOrderLinkInternalCommandHandler` | The `Sales.SendGuestOrderLink` internal command scheduled by `RequestGuestOrderLinkHandler`; the token is minted in the handler, so the row holds the order id only |

No email goes out when a signed-in customer places an order: the payment confirmation is the customer's receipt (Section 14.1).

The five order lifecycle emails (payment, shipping, payment failed, delivered, cancelled) resolve their recipient through `OrderRecipient`: a customer's address is looked up in Identity through `ICustomerService` (so mail follows a later address change), a guest order uses its own frozen `ContactEmail`. Scheduling them as durable internal commands keeps the mail alive across a host that dies after the order transition committed ([ADR-114](../adr/114-internal-commands-durable-job-queue.md)).

### 8.3 Shipping Label Provider

**Purpose:** Issues the shipping label every order with a ship-to address gets at placement.

**Integration Points:** `IShippingLabelProvider`. The registered implementation is `MockShippingLabelProvider`: it issues a label the moment the order is created, with an invented label number (`CASA-{order}-{random}`) and a 20-character tracking number that starts with `MOCK`, and makes no network call. A real carrier integration replaces the provider, not the `ShippingLabel` shape.

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Shipping/MockShippingLabelProvider.cs`

---

## 9. Authorization Model

Authorization is capability-based ([ADR-020](../adr/020-permission-based-authorization.md)): an endpoint
is anonymous, requires any signed-in user (`[Authorize]`), or names the capability it needs with
`[HasPermission(...)]`; ownership of a record is a separate check layered on top. There are no
role-named policies.

| Gate | Access Level | Where it applies |
|------|-------------|-------------|
| Anonymous | No auth required | Catalog browsing (GET categories, products, the storefront product page, the variant lookup, product images), published product reviews (`GET /Reviews/by-product/{productId}/paged`), login, registration, token refresh, password reset, email confirmation, the order quote, best sellers, guest checkout and the guest order endpoints (read, pay and cancel require the order's access token instead), the guest link request (202 whether or not the order matched), payment webhooks |
| Authenticated | Any logged-in user | Shopping cart operations, order viewing and paying (own), cancelling an own order, profile management, preferences, session management, writing, revising and withdrawing own reviews, claiming a guest order |
| Permission | A role granted the capability | Catalog, inventory and fulfilment management, manual payment, review moderation, customer, user and role administration (table below) |

**Permissions:** each module declares its capabilities in `{Module}Permissions` and grants them to roles
in `{Module}PermissionGrants` (Shared layer), applied both by the module's own API registration and by
the token-minting host. Admin holds every one; Customer holds none. The token carries one `permission`
claim per capability its role holds, so a client gates its own surface on a capability rather than a
role name.

| Module | Permission | Guards |
|--------|-----------|--------|
| Catalog | `catalog:categories:manage` | Category create, rename, re-parent, delete |
| Catalog | `catalog:products:manage` | Product create, delete, attribute edits, CSV export |
| Catalog | `catalog:product-variants:manage` | Variant add, remove, SKU and list price |
| Catalog | `catalog:product-images:manage` | Image upload, delete, reorder |
| Catalog | `catalog:pricing:manage` | Variant and product-wide discounts |
| Catalog | `catalog:reviews:moderate` | `GET /Reviews/paged`, `PUT /Reviews/{id}/hide`, `PUT /Reviews/{id}/unhide` |
| Sales | `sales:orders:manage` | `pay`, `ship`, `shipment`, `deliver`, the order lookup |
| Sales | `sales:inventory:manage` | Every `/InventoryItems` endpoint |
| Sales | `sales:shopping-carts:manage` | The shopping cart lookup |
| Identity | `identity:customers:manage` | Customer list, lookup, export, create, delete |
| Identity | `identity:users:manage` | `PUT /Users/{userId}/customer-link` |
| Identity (framework) | `users:manage` | `/Admin/Users` |
| Identity (framework) | `roles:manage` | `/Admin/Roles`; granted in compiled code only, never from a stored row |

Beyond the compiled grants, an operator can attach further STORED grants to a role through
`PUT /Admin/Roles/{role}/permissions` (Section 3.15).

**Writing a review needs a customer profile, not a role.** The reviews controller resolves the caller
through the `customer_id` claim and fails closed when the token carries none; admins are deliberately
not exempted, because writing a review is an act by a customer and an admin account with no customer
profile has nothing to write one as.

**Ownership Enforcement** ([ADR-033](../adr/033-resource-ownership-authorization.md)):
- `OwnerOrAdminFilter` guards the shopping cart and customer controllers: the route parameter `id` must
  match the caller's `customer_id` claim, or the caller holds the Admin role. It denies by default when
  the owner cannot be resolved and returns 403 Forbidden.
- Orders scope every query to the caller through `OrdersByCustomerSpecification` and check ownership on
  every mutation; a resolvable caller who does not own the order is answered 404, not 403, so another
  customer's order ids cannot be probed. A caller with no resolvable `customer_id` is refused outright.
- Data-subject export and erasure authorize the owner or an Admin inside the handlers.

**JWT Claims:** Access tokens contain: `sub`, `jti`, `iat`, name (the linked customer's display name, never the email), `email`, `role`, `customer_id` (when applicable), `sid` (the refresh session) and one `permission` claim per capability (`TokenService.cs:116-121`, `:141`).

**Service-to-service calls:** the Identity customer gRPC service requires either an end user's JWT or a
service token minted with the shared `Grpc:ServiceToken` signing key, because the order emails run
from the anonymous Stripe webhook with no user token to forward.

---

## 10. Cross-Module Communication

The system enforces strict module boundaries. Modules communicate only through shared interface contracts:

| Interface | Provider Module | Consumer Module | Purpose |
|-----------|----------------|-----------------|---------|
| `IProductVariantService` | Catalog | Sales | Verify variant existence (one or a batch), check SKU uniqueness, fetch unit pricing (effective price, list price and promotion label), get ID by SKU, and fetch the denormalizable catalog labels (product id and name, SKU) for a batch of variants |
| `ICustomerService` | Identity | Sales | Resolve customer contact details for the order notification emails and the display name frozen on an order at checkout |
| `IUserSalesExportService` | Sales | Identity | The orders section of the data-subject export document |
| `IUserCatalogExportService` | Catalog | Identity | The product-reviews section of the same document |

Across process boundaries these interfaces are satisfied by gRPC clients, resolved through service
discovery ([ADR-007](../adr/007-grpc-extraction.md)). The contracts are four `.proto` files:
`product_variants.proto` (`Exists`, `SkuExists`, `GetIdBySku`, `GetUnitPrices`, `GetExistingIds`,
`GetCatalogInfo`), `user_catalog_export.proto`, `customer_service.proto` (`GetContactInfoById`) and
`user_sales_export.proto`, in the `MMCA.Store.{Module}.Contracts` projects. Both export edges out of Identity are
**best-effort**: an unreachable peer degrades that one section of the export rather than failing the
export, so neither carries a startup wait.

**Confirmed behaviors:**
- Sales module cannot directly access Catalog domain entities
- When a provider module is disabled, a stub is registered in its place (`DisabledProductVariantService`, `DisabledCustomerService`, `DisabledUserSalesExportService`, `DisabledUserCatalogExportService`)
- Sales module declares hard dependencies on Catalog and Identity (`RequiresDependencies = true`): it will not start without them (`SalesModule.cs:30`, `:37`)
- Asynchronous edges travel as the four integration events of Section 7 through the outbox and the message broker (RabbitMQ locally, Azure Service Bus in production)
- Module discovery uses reflection; registration follows topological dependency order (Kahn's algorithm)

---

## 11. User Interface

### 11.1 Technology

The UI is a **Blazor Server + WebAssembly hybrid** (`InteractiveAuto` render mode) using **MudBlazor** component library, branded **C.A.S.A Boutique**. It supports multiple hosting targets:
- **Web** (Server + WASM): `Source/Hosts/UI/MMCA.Store.UI.Web`
- **WebAssembly Client**: `Source/Hosts/UI/MMCA.Store.UI.Web.Client`
- **MAUI** (iOS, Android, macOS, Windows): `Source/Hosts/UI/MMCA.Store.UI`

The web head is an **installable web app**: it serves `manifest.webmanifest` and maps the framework
service worker, which supplies an offline page (`MMCA.Store.UI.Web/Program.cs:281`,
[ADR-136](../adr/136-installable-web-app-service-worker.md)).

### 11.2 Shopping Cart UX

The shopping cart is exclusively accessible through a **380px right-side drawer** (CartDrawer), opened via the bag icon in the top app bar. There is no dedicated cart page.

**Features:**
- Quantity +/- controls per item when cart is Active
- Remove individual items at once, with an Undo in the toast that restores the variant at its quantity
- Clear all items, after a confirmation
- Subtotal plus a free-shipping line ("X away from free shipping" or "Free shipping") from the server quote (`POST /Orders/quote`)
- "Checkout & Pay" button navigates to the checkout page (`/checkout`)
- "Checked Out" chip and read-only mode for checked-out carts
- Empty state with "Browse Products" navigation
- "Continue Shopping" link to catalog

**State Management:** The `ICartStateService` manages cart state centrally. It enriches cart items with product names and SKUs from the Catalog API (the batch `/Products/variant-lookup` endpoint) after each refresh. A shopper who has not signed in shops against `GuestCartStore`: variant ids and quantities only, kept on the device, with nothing priced or personal stored. When the shopper signs in, the device cart moves into the server cart (`MergeGuestCartAsync`), after the lines of a guest order the bag was placed as are settled (Section 3.18). One `CartButton` serves every shopper: it is a public app bar component (`SalesUIModule.cs:33`), which the framework renders for every visitor (MMCA.Common v1.265.0), and it reads the device cart for a signed-out shopper and the server cart for a customer.

### 11.3 Checkout and Guest Orders

The checkout page (`/checkout`) provides:
- Shipping address and billing address (billing equals shipping by default) plus an optional phone; the summary shows the quote, with sales tax once the address is complete
- For a signed-in customer: the saved profile address pre-fills the form, the cart becomes the order (`PUT /ShoppingCarts/{id}/checkout`), then the Stripe session opens
- For a signed-out shopper: sign in or register and return to `/checkout`, or continue as a guest with a name and an email; the device cart becomes a guest order (`POST /Orders/guest`), the private token is remembered on the device, the device cart is kept with the order and its lines remembered, and the guest goes on to pay

The guest order page (`/orders/guest/{id}`) opens from the private link (the token in the URL fragment): the items, addresses, status, date placed, tracking and totals, a pay action, a thank-you block once paid, Cancel order while unpaid (after a confirmation), and an offer to create an account from the order's own details, which signs in and claims that order. Once the order is paid, its lines leave the device bag. A link that does not open the order points to find my order (`/orders/find`), where the order number and the checkout email ask for a new link by email; the page always shows the same confirmation.

The customer's order page (`/orders/{id}`) shows the date placed in its summary and, once the Stripe return confirms payment, the same thank-you block (order number, date, where the receipt went, what happens next). `/orders` lists a customer's orders as cards (order number, status, date placed, item count, total) and keeps the data grid for an administrator.

`OrphanOrderRecovery` (a content-header component) detects an order left in `PendingPayment` or `PaymentInitiated` after the shopper backed out of Stripe Checkout and offers to resume it.

### 11.4 Storefront and Catalog Browse

The home page (`/`, `StoreHome`) shows the hero, category tiles, a Special Offers banner to `/catalog?sale=true` while something is on sale, a Best Sellers row fed by `GET /Orders/best-sellers`, and the store perks. The information pages are `/shipping`, `/returns`, `/contact`, `/privacy`, `/terms` (one `StoreInfo` page) and `/about`; the contact page's support email line is left out while the setting is empty. The footer on every page links the shop, find my order and the five information pages.

The catalog browse page (`/catalog`) runs on the anonymous `GET /Products/storefront` endpoint (`ProductsController.cs:96-118`) and provides:
- Product grid with a search over the product name or description (`?q=`), also reached from the search box in the app bar on every page
- Category filter dropdown (`?category=`)
- An On sale toggle (`?sale=true`) keeping products with a discount in force now
- Sort by name (ascending or descending), newest, price (low to high or high to low, by the lowest effective price any variant sells at now) or top rated (`?sort=`, `StorefrontProductSort.cs:13-32`)
- Clear filters, and up to four best sellers, when a filtered search finds nothing
- Star rating and review count on each card, read straight off the product's denormalized `RatingSummary` so a grid of cards costs no per-card aggregate query
- Effective-price range per card, with a sale badge and the struck-through list price when any variant on the card carries an active discount
- Quick "Add to Cart" per variant, shown to signed-out shoppers too
- "View Details" navigation to product detail page

The product detail page (`/catalog/{id}`) shows:
- Breadcrumbs (Home > Shop > the product's category > the product's name, `CatalogProductDetail.razor.cs:53-67`)
- Product description, brand, category
- Variant choice, price, quantity selector, and "Add to Cart". A discounted variant shows the effective price beside the struck-through list price and a sale badge, and carries an accessible "Was X, now Y" label so a screen reader hears both numbers rather than the visual strike alone
- "Buy Now" (adds the variant and opens `/checkout`)
- Information sections (materials, care, shipping, returns)
- A reviews section (anchor `#reviews`) listing the published reviews, plus the review editor for a signed-in customer who is eligible to write or revise one

### 11.5 Navigation Structure

**Sidebar** (role-based, dynamically populated from `IUIModule` registrations; Home comes from the framework navigation):
- Customer: Home, Shop, My Orders, My Profile
- Admin: Home, Shop, Categories, Products, Reviews, Inventory, Shopping Carts, Orders, Customers, Users, Roles, My Profile

**Top App Bar**: the shop search and the bag icon with badge count for every visitor (each module's `PublicAppBarComponentTypes`, also in the mobile quick-actions row), then user email and Logout button (authenticated) or Login/Register buttons (anonymous)

**Administration pages:** `/users` and `/users/{id}` (lock, unlock, change role), `/roles` and `/roles/{role}` (edit stored grants), alongside the catalog, inventory, cart, order and customer pages. The profile page (`/profile`) links to the customer's orders ("My orders") and the device list ("Manage devices"), picks the state from the US postal regions, and carries the "Your data" card for export and erasure.

### 11.6 Module Registration

UI modules implement `IUIModule` (providing `NavItems` and `Assembly` for route discovery, plus optional component slots: Store's Catalog module contributes the shop search to `PublicAppBarComponentTypes`, the footer links and the not-found content; its Sales module contributes the cart button to `PublicAppBarComponentTypes`, the cart drawer as a layout component and the orphan-order banner as a content header; [ADR-067](../adr/067-ui-module-shell-composition.md)). Modules can be conditionally enabled via `UIModuleConfiguration.IsModuleEnabled(configuration, moduleName)`.

---

## 12. Cross-Cutting Infrastructure

### 12.1 Command/Query Pipeline Decorators

Every command and query handler runs inside the framework's decorator pipeline, listed here from the
outermost wrapper inward (`MMCA.Common.Application/DependencyInjection.cs:134-148`).

| Decorator | Marker | Behavior |
|-----------|--------|----------|
| `ProfilingCommandDecorator` / `ProfilingQueryDecorator` | (all) | Records MiniProfiler step (when `UseMiniProfiler=true`; registered after the pipeline, so outermost) |
| `FeatureGateCommandDecorator` / `FeatureGateQueryDecorator` | `IFeatureGated` | Refuses the request while its feature flag is off |
| `AuthorizationCommandDecorator` / `AuthorizationQueryDecorator` | `IRequiresPermission` | Refuses the request when none of the caller's roles grants the permission |
| `LoggingCommandDecorator` / `LoggingQueryDecorator` | (all) | Structured logging around the handler |
| `CachingCommandDecorator` | `ICacheInvalidating` | Invalidates cache entries by prefix on successful command execution |
| `CachingQueryDecorator` | `IQueryCacheable` | Caches query results |
| `ValidatingCommandDecorator` / `ValidatingQueryDecorator` | (all with a validator) | Runs the FluentValidation rules before the handler |
| `TimeoutCommandDecorator` / `TimeoutQueryDecorator` | `IHasTimeout` | Applies a per-request execution budget |
| `TransactionalCommandDecorator` | `ITransactional` | Wraps command in database transaction (begin/commit/rollback); innermost |

### 12.2 Idempotency

The `IdempotencyFilter` (applied via `[Idempotent]` on create and checkout endpoints) caches the first response for a given `Idempotency-Key` header value for 24 hours (`IdempotencyFilter.cs:81`). Duplicate requests receive the cached response with an `X-Idempotent-Replay: true` header. The cache key binds the caller's identity, the HTTP method and the route template, and a key reused with a different request body is answered 422 rather than replayed. Concurrent duplicates are serialized by a distributed lock when the host registers one (both deployed apps run more than one replica) and by a per-process keyed lock otherwise; a cache or lock fault degrades to executing without the guarantee rather than failing the request. Endpoints that must re-evaluate state on every call are marked `[NonIdempotent]` with a reason.

### 12.3 Exception Handling

Five exception handlers (registered as middleware in priority order):
1. **OperationCanceledExceptionHandler** -> HTTP 499
2. **DomainExceptionHandler** -> HTTP 400
3. **DbUpdateExceptionHandler** -> HTTP 409 Conflict (a concurrency conflict is counted on its own metric)
4. **ValidationExceptionHandler** (FluentValidation) -> HTTP 400 with grouped errors
5. **GlobalExceptionHandler** -> HTTP 500 (catch-all)

### 12.4 Data Storage

Each service owns its database and outbox ([ADR-006](../adr/006-database-per-service.md)): Catalog,
Identity and Sales each read the `DataSources:{Module}` connection (`Store_Catalog`, `Store_Identity`,
`Store_Sales`) and migrate through their own `MMCA.Store.Migrations.SqlServer.{Module}` assembly. Every
Store data source is SQL Server; the framework's `IDbContextFactory` strategy also supports SQLite and
Cosmos DB engines, which no Store data source selects. Entity types are routed to data sources via the
`[UseDataSource]` attribute, and the `IDataSourceService` caches entity-to-datasource mappings.

### 12.5 Optimistic Concurrency

Conditional writes carry `[SupportsIfMatch]`: the response to a read carries an ETag, the `If-Match`
header is mandatory on the guarded mutation, a stale tag is answered **412 Precondition Failed** and a
missing one **428 Precondition Required** (`SupportsIfMatchAttribute.cs:16`,
[ADR-035](../adr/035-optimistic-concurrency.md)). It guards the rename, re-parent, attribute, SKU, price
and discount edits, image reordering, inventory increase and decrease, the order transitions (pay, ship,
shipment, deliver, cancel), review revision and moderation, and the customer profile edits.

### 12.6 Internal Commands and the Outbox

Work that must survive a host restart after the triggering transaction committed is scheduled as a
durable internal command row and run by the framework's processor
([ADR-114](../adr/114-internal-commands-durable-job-queue.md)). Store defines nine:
`Catalog.PublishProductVariantChanged`, `Identity.SendEmailConfirmation`, `Sales.ExpireUnpaidOrder`,
`Sales.SendOrderPaidEmail`, `Sales.SendOrderShippedEmail`, `Sales.SendOrderPaymentFailedEmail`,
`Sales.SendOrderDeliveredEmail`, `Sales.SendOrderCancelledEmail` and `Sales.SendGuestOrderLink`. Each
handler is idempotent and treats "nothing left to do" as success. Integration events leave through each
service's transactional outbox.

---

## 13. Testing

### 13.1 Test Structure

All test projects run on Microsoft Testing Platform with xUnit v3. Counts from
`git ls-files 'Tests/*.csproj'` (27 projects).

| Type | Projects | Description |
|------|----------|-------------|
| **Unit** | 18 module projects (Domain, Application, Infrastructure, API, Shared and UI for each of Catalog, Sales and Identity) plus 2 host projects (Gateway, UI.Web) | Entity creation, invariants, domain events, handlers, mappers, validators, controllers, bUnit component tests |
| **Architecture** | 1 project (63 `*Tests.cs` files) | NetArchTest: layer dependencies, module isolation, domain purity, naming conventions, folder width, and `IntegrationEventContractTests`, which freezes every integration event payload |
| **Integration** | 3 per-service projects (Catalog, Sales, Identity) | Each boots one service host via `WebApplicationFactory` against a throwaway SQL Server database (LocalDB by default, the server named by `STORE_TEST_SQL_BASE` in CI) with Respawn resetting data between tests, JWT token generation, full HTTP endpoint testing, OpenAPI baseline checks. Runs via `MMCA.Store.Integration.slnf` in the pull-request-only `integration-tests` job, a required PR check that is not in the deploy job's `needs` |
| **Cross-service / broker** | 2 projects (CrossService, ServiceBusEmulator) | Testcontainers-backed tiers run by the weeknight `cross-service-tests.yml`, never inside the deploy chain: the integration-event round trips (`ProductVariantChanged`, `OrderFulfilled`) between real service hosts, and the Azure Service Bus emulator transport. Their recency gates the deploy: the `cross-service-freshness` step needs a run within 5 days in which both the `cross-service` and `servicebus-emulator-smoke` jobs succeeded |
| **E2E** | 1 project (33 `*Tests.cs` files) | Playwright, page objects, Blazor wait helpers: full user journeys including checkout, Buy Now, Stripe payment, orphaned-order recovery, password reset, role administration, accessibility, phone viewport, the installable web app and web vitals |

### 13.2 Key Test Scenarios

- Full customer journey: Register -> Browse -> Add to Cart -> Checkout -> Admin Pay -> Deliver
- Order lifecycle: all state transitions including cancellation with inventory restoration
- Cart operations: add, change quantity, remove, clear, checkout
- Authorization: anonymous, customer, admin role enforcement
- Cross-module: Catalog -> Sales pricing, inventory validation, and the integration-event round trips

---

## 14. Missing or Unclear Business Logic

### 14.1 No Email When a Signed-In Customer Places an Order
**Observation:** Email goes out for the password reset and the email confirmation (Sections 3.12, 3.14), the guest's order-received message and a guest's replacement order link (Section 3.18), the payment confirmation (which prints a struck "Was" amount and the promotion label on a discounted line and a "You saved" total when the order saved anything), the shipping notice (re-sent on every shipment correction), the payment-failed notice, the delivery notice (`OrderDeliveredHandler`) and the cancellation notice (`OrderCancelledHandler`). The cancellation notice covers all three cancellation paths, worded by the event's `OrderCancellationReason`: a customer, guest or administrator cancel reads as a cancellation, and the payment deadline (`Sales.ExpireUnpaidOrder`) or the payment reconciliation sweep reads as an unpaid order that expired (`SendOrderCancelledEmailInternalCommandHandler.cs:54-56`). The delivery and cancellation notices go to customers and guests alike (`OrderRecipient`). A signed-in customer gets no email when the order is placed (`OrderChanged` with the `Added` state); that absence is deliberate: the payment confirmation is the customer's receipt.
**Recommendation:** None; the signed-in order-placed email is deliberately absent, and this entry records the decision so the absence is not mistaken for a gap.

### 14.2 No Return/Refund Workflow
**Observation:** Cancellation is possible only from `PendingPayment`, `PaymentInitiated` and `PaymentFailed`. Once an order is `Paid` it can only move forward: to `Shipped` or straight to `Delivered`, then from `Shipped` to `Delivered`, with shipment corrections allowed while `Shipped`. `Delivered` and `Cancelled` are terminal. No return, refund or exchange workflow exists, and the payment service has no refund operation. A cancel that finds the Stripe session already paid is refused with a message saying the order must be refunded instead, which the system cannot do, so any refund happens outside the system and the order keeps its paid status.
**Recommendation:** Clarify whether returns/refunds are in scope and whether Stripe refund integration is needed.

### 14.3 No Inventory Check at Cart-Add Time
**Observation:** When a customer adds an item to the cart, the system verifies the product variant exists but does **not** check if inventory is available. Stock is checked and reserved only at checkout (an atomic conditional decrement), and the cart shows no stock indicator; only the administrator inventory pages show in-stock and out-of-stock status.
**Recommendation:** This may be intentional (allowing customers to add items that are temporarily out of stock) or may warrant a stock availability indicator on the cart.

### 14.4 A Customer's Failed or Cancelled Order Does Not Restore the Bag
**Observation:** A guest's device bag is not affected: guest checkout keeps it and takes the ordered lines out only once the order is paid (Section 3.18), so an abandoned, failed, expired or cancelled guest order leaves the bag as it was. A signed-in customer's server cart behaves differently. The cart turns `CheckedOut` when checkout creates the order, before payment. The next add reactivates it and soft-deletes the previous lines (`ShoppingCart.Reactivate`), which is correct for an order that goes on to be paid, because those lines have become the order. When the order's payment fails, its payment deadline expires or it is cancelled, the lines are not returned to the bag: the shopper rebuilds it by hand. A `PaymentFailed` order can still be paid again from the order itself, but a cancelled or expired one cannot.
**Recommendation:** Decide whether a cancellation (and possibly a payment failure) should restore the order's lines to a customer's bag, which would be a handler on `OrderCancelled` or `OrderPaymentFailed`, or whether starting over is the intended recovery.

### 14.5 Prices Can Change Between Bag and Checkout Without Notice
**Observation:** Product variant prices can be changed at any time by administrators, and a cart line stores no price: every line is priced at checkout, not at cart-add time. The cart drawer and the checkout page show a server quote at the prices current when it was drawn, but checkout does not compare against that displayed quote. It builds a fresh quote from the prices it fetches in the same request, and `Order.Charges.BagChanged` compares the order against that fresh quote, so it fires only when the bag's contents change during the checkout request itself (an item added in another tab), never on a price change. A price that moved after the shopper last saw the drawer is charged at the new amount with nothing flagged; the Stripe payment page is the only place the final amount appears before payment.
**Recommendation:** Decide whether checkout should carry the displayed quote (or its subtotal) and refuse or re-confirm when the charge differs, and whether the bag should mark lines whose price moved since they were added, which needs the add-time price stored on the cart line.

### 14.6 One Parcel Per Order
**Observation:** Delivery tracking exists (Section 3.8): an order carries a single `Shipment` value object with a carrier, a tracking number and the two dates. An order that physically leaves in two parcels can therefore only record one of them, and correcting the recorded shipment replaces it rather than adding to it.
**Recommendation:** A second parcel needs the shipment to become a collection on the order, which is the same modelling change 14.7 asks for; clarify whether split shipments are a real business case before making it.

### 14.7 No Partial Order Fulfillment
**Observation:** Orders are delivered as a whole: there is no concept of partial shipments or split deliveries, and `Shipped` applies to the order rather than to individual lines.
**Recommendation:** Clarify if partial fulfillment is a future requirement.

### 14.8 Shipping Labels Come From a Mock Carrier
**Observation:** Every order with a ship-to address gets a `ShippingLabel` at placement, but the only registered `IShippingLabelProvider` is `MockShippingLabelProvider`, which invents a `CASA-` label number and a `MOCK` tracking number with no carrier call. The label and the shipment the admin records when shipping (Section 3.8) are separate records: nothing carries the label's tracking number into the shipment, which the admin types into the ship dialog. The dialog pre-fills only from an already-recorded shipment, when correcting one, never from the label.
**Recommendation:** Decide on a carrier integration and whether the label's tracking number should seed the recorded shipment.

### 14.9 Sales Tax Is Off by Default
**Observation:** `Tax:Enabled` defaults to false (`TaxSettings.cs:18`) and no appsettings or infrastructure file sets the `Tax` section, so every quote and every order carries zero tax until Stripe Tax and the store's registrations are activated on the account.
**Recommendation:** Confirm the tax registrations and the go-live date for collecting sales tax.

### 14.10 Email Confirmation Is Not Enforced
**Observation:** Accounts are sent a confirmation link and `IsEmailConfirmed` is recorded, but `RequireConfirmedEmail` is false, so an unconfirmed account signs in and checks out exactly like a confirmed one. Registration also deliberately leaves an account unlinked from an existing Customer with the same address, which an administrator must link by hand (`PUT /Users/{userId}/customer-link`).
**Recommendation:** Decide whether confirmation should gate sign-in (or the automatic link to an existing profile) before turning the setting on.

### 14.11 Guest Purchases Earn No Review Entitlement Unless Claimed
**Observation:** A guest order raises no `OrderFulfilled` at delivery, so a guest who never creates an account cannot review what they bought, and a guest who claims the order only after it was delivered stays without the entitlement: delivery stamps `FulfilledPublishedOn` even though it published nothing, the claim raises no fulfilment, and the backfill sweep skips an order whose `FulfilledPublishedOn` is already stamped. A guest who claims the order before delivery does earn the entitlement, because delivery reads the order's customer at that moment.
**Recommendation:** Confirm whether a claim after delivery should publish the fulfilment for the new account.

---

## 15. Seed Data (Initial System State)

The system seeds the following data at startup, each module only when it is enabled and only when its
configuration flag is on:

**Users** (when `Seeding:IncludeSampleUsers` is true, `IdentityModuleSeeder.cs:28`):
- Admin: one seeded administrator account (Admin role, no Customer record; credentials are environment-specific and not published)
- Customer: one seeded demo customer account (Customer role)

**Catalog** (when `Seeding:IncludeSampleCatalog` is true, `CatalogModuleSeeder.cs:27`):
- Categories: "Jewelry" (id=1), "Watches" (id=2)
- Product: "Gold Ring" (id=11, description "18K Gold Ring", brand: "WhatNot", category: Jewelry)
- Variants: "Gold Ring - Size 6" ($15.00), "Gold Ring - Size 7" ($15.50), "Gold Ring - Size 8" ($16.00): all USD, the SKU doubling as the variant name (`CatalogModuleDbSeeder.cs:166-168`)

**Inventory** (Sales, under the same `Seeding:IncludeSampleCatalog` flag): 100 units per variant for all 3 Gold Ring sizes (`SalesModuleDbSeeder.cs:135-137`). Sales resolves each SKU to its variant id through Catalog's gRPC service and skips a SKU when Catalog is unreachable; the `ProductVariantChanged` event creates the row later.

**Seeding is idempotent**: the Identity and Catalog seeders check for existing data via `ExistsAsync()` before inserting. The inventory seeder creates a missing row and lifts an existing row only while it still holds zero, because any other count is live stock (`SalesModuleDbSeeder.cs:97`).

---

*This specification is derived entirely from the source code. All business rules, workflows, and behaviors described above are confirmed implementations traceable to the referenced source files. Last updated: 2026-10-28.*
