# MMCA Business Specification Document

## 1. System Overview

MMCA is an **e-commerce platform** built with .NET 10.0 using DDD and Clean Architecture. The business logic is organized as modules (Catalog, Sales, Identity) that have been extracted into per-module service hosts behind a YARP Gateway. It enables customers to browse a product catalog, manage shopping carts, place orders, and process payments. Administrators manage the product catalog, inventory, and order fulfillment.

The system operates in the **online retail / e-commerce** domain, supporting the full purchase lifecycle from product browsing through payment and delivery.

**Major Business Areas:**
- **Product Catalog Management** — categories, products, and product variants with pricing
- **Shopping & Ordering** — cart management, checkout, order placement
- **Payment Processing** — Stripe-integrated checkout with webhook confirmation
- **Inventory Management** — stock tracking per product variant
- **Customer Identity & Authentication** — registration, login, JWT-based sessions

**Technical Stack:**
- .NET 10.0 (LangVersion: preview), Blazor Server + WebAssembly hybrid (InteractiveAuto), MudBlazor UI
- SQL Server (primary, via Aspire), SQLite, Cosmos DB (alternative, via strategy pattern)
- Stripe payment gateway, PBKDF2-HMAC-SHA512 password hashing, JWT authentication
- .NET Aspire orchestration (SQL Server container + Gateway :6001 + 3 service hosts + UI)

---

## 2. Core Business Entities

### 2.1 Category
**Description:** A classification grouping for products. Supports hierarchical (parent-child) structures for nested categorization (e.g., "Jewelry" > "Rings").

**Key Properties:**
| Property | Description |
|----------|-------------|
| Name | Display name (max 255 chars, required) |
| ParentCategoryId | Optional reference to a parent category |

**Relationships:**
- A Category may have one parent Category (self-referencing hierarchy)
- A Category contains zero or more Products

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Categories/Category.cs`

---

### 2.2 Product
**Description:** A saleable item in the catalog. Products have descriptive attributes and belong to a category. Each product has one or more purchasable variants.

**Key Properties:**
| Property | Description |
|----------|-------------|
| Name | Product name (max 100 chars, required) |
| Description | Detailed description (max 4,000 chars, optional) |
| Brand | Manufacturer or brand name (max 100 chars, optional, no whitespace-only) |
| CategoryId | Category this product belongs to (optional) |

**Relationships:**
- A Product belongs to zero or one Category
- A Product contains one or more Product Variants

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs`

---

### 2.3 Product Variant
**Description:** A specific purchasable configuration of a product (e.g., "Gold Ring - Size 7"). Variants carry the actual price and SKU used for inventory and order processing.

**Key Properties:**
| Property | Description |
|----------|-------------|
| SKU | Stock-keeping unit identifier (max 50 chars, globally unique, optional) |
| Price | Unit price as Money (amount + currency, must be non-negative) |

**Relationships:**
- A Product Variant belongs to exactly one Product
- A Product Variant has zero or one Inventory Item
- A Product Variant can appear in Shopping Cart Items and Order Lines

**Source:** `Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs`

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
**Description:** A confirmed purchase transaction created when a customer checks out their shopping cart. Orders track payment status and progress through a defined lifecycle.

**Key Properties:**
| Property | Description |
|----------|-------------|
| CustomerId | The customer who placed the order |
| Total | Calculated order total (Money value, sum of all line totals) |
| Status | Current lifecycle stage (see state machine below) |
| StripeSessionId | Payment gateway session reference |
| StripePaymentIntentId | Payment confirmation reference |

**Relationships:**
- An Order belongs to one Customer
- An Order contains one or more Order Lines

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs`

---

### 2.7 Order Line
**Description:** A single item within an order, capturing the product variant, quantity, and price at time of purchase.

**Key Properties:**
| Property | Description |
|----------|-------------|
| ProductVariantId | The product variant ordered |
| Quantity | Units ordered (must be positive) |
| UnitPrice | Price per unit at time of order (Money) |
| LineTotal | Computed: UnitPrice x Quantity |

**Relationships:**
- Belongs to exactly one Order

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderLine.cs`

---

### 2.8 Inventory Item
**Description:** Tracks available stock for a specific product variant. One inventory record per product variant (the inventory item ID equals the product variant ID).

**Key Properties:**
| Property | Description |
|----------|-------------|
| AvailableQuantity | Units currently in stock (must be >= 0) |
| IsOutOfStock | Computed: true when AvailableQuantity equals 0 |

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
| Email | Email address (max 100 chars, unique, required) |
| Address | Optional mailing address (value object) |

**Relationships:**
- A Customer is linked 1:1 with a User account
- A Customer has one Shopping Cart
- A Customer has zero or more Orders

**Source:** `Source/Modules/Identity/MMCA.Store.Identity.Domain/Customers/Customer.cs`

---

### 2.10 User
**Description:** An authentication account with credentials and role-based access. Users are either administrators or customers.

**Key Properties:**
| Property | Description |
|----------|-------------|
| Email | Login email (unique, required) |
| PasswordHash / PasswordSalt | Securely stored credentials (PBKDF2-HMAC-SHA512, 600,000 iterations) |
| Role | "Admin" or "Customer" |
| RefreshToken / RefreshTokenExpiry | Session refresh mechanism (7-day expiry) |
| IsActive | Account active status |
| CustomerId | Link to Customer profile (for Customer role) |

**Relationships:**
- A User with "Customer" role is linked 1:1 to a Customer entity
- Admin users have no Customer record

**Source:** `Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs`

---

### 2.11 Value Objects

| Value Object | Properties | Validation | Source |
|-------------|-----------|-----------|--------|
| **Money** | Amount (decimal), Currency (Currency) | Cannot have negative amount; currency mismatch on add | `MMCA.Common.Shared/ValueObjects/Money.cs` |
| **Currency** | Code (string) | Must be "USD" or "EUR" | `MMCA.Common.Shared/ValueObjects/Currency.cs` |
| **Address** | AddressLine1 (required, max 200), AddressLine2, City, State, ZipCode, Country | AddressLine1 required; all fields have max lengths | `MMCA.Common.Shared/ValueObjects/Address.cs` |

---

## 3. Business Workflows

### 3.1 Customer Registration

**Trigger:** A new user submits registration with first name, last name, email, and password.

**Steps:**
1. Validate registration request (email format, password requirements)
2. Verify email is not already registered (uniqueness check)
3. Hash the password using PBKDF2-HMAC-SHA512 (600,000 iterations) with a per-user salt
4. Create a User entity with "Customer" role
5. Generate JWT access token (15 min, with claims: sub, jti, iat, user_id, email, role, customer_id) and refresh token (7-day expiry, 64-byte random)
6. **Domain event `UserRegistered` is published**, which triggers automatic Customer creation:
   - A new Customer entity is created with the same name, email, and address
   - The User is linked to the newly created Customer via `CustomerId`
7. Return authentication tokens to the caller

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs` (RegisterAsync)
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/DomainEventHandlers/UserRegisteredHandler.cs`

---

### 3.2 Customer Login

**Trigger:** A registered user submits email and password.

**Steps:**
1. Validate login request
2. Look up user by email
3. Verify password using PBKDF2-HMAC-SHA512 with constant-time comparison (legacy HMAC-SHA512 hashes still verify via salt-length detection)
4. Verify user is active
5. Generate new access token and refresh token
6. Update refresh token expiry (7 days from now)
7. Return authentication response with both tokens

**Implemented in:**
- `Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs` (LoginAsync)

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

**Trigger:** A customer initiates checkout on their active shopping cart.

**Steps:**
1. Fetch the customer's shopping cart with all items
2. Retrieve current unit prices for all product variants from the Catalog module (cross-module call)
3. Fetch inventory items for all product variants
4. Execute the checkout domain service which:
   a. Validates the cart is not empty
   b. Validates inventory exists for every item in the cart
   c. **Decrements inventory** for each item (reserves stock)
   d. Creates Order Lines with current prices (price snapshot at time of purchase)
   e. Creates the Order with status `PendingPayment`
   f. Transitions the cart to `CheckedOut` status
5. Persist the new Order
6. Return the Order details

**Business Rules Applied:**
- Cart must contain at least one item
- All product variants must have corresponding inventory records
- Sufficient inventory must be available for each item
- Prices are locked at checkout time (not at cart-add time)
- This is an atomic (transactional) operation (`ITransactional`)

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Domain/Services/CheckOutDomainService.cs`

---

### 3.5 Payment Processing (Stripe)

**Trigger:** After checkout, the customer initiates payment for a pending order.

**Steps:**
1. Fetch the order with its order lines
2. Call Stripe API to create a checkout session (converts Money to smallest currency unit — cents)
3. Transition order status to `PaymentInitiated`
4. Store the Stripe session ID on the order
5. Return the checkout URL for the customer to complete payment

**Webhook Confirmation (asynchronous):**
1. Stripe sends a webhook notification to `POST /payments/webhook`
2. System verifies the webhook signature using Stripe's `EventUtility.ConstructEvent()`
3. Based on event type:
   - `checkout.session.completed` -> Mark order as `Paid`, store payment intent ID
   - `checkout.session.expired` or `payment_intent.payment_failed` -> Mark order as `PaymentFailed`
4. Idempotent: skips processing if order is already in the appropriate terminal state

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/StripePaymentService.cs`

---

### 3.6 Order Cancellation

**Trigger:** A customer or admin cancels an order.

**Steps:**
1. Fetch the order with its order lines
2. Validate the order is in a cancellable state (PendingPayment, PaymentInitiated, or PaymentFailed)
3. Transition order status to `Cancelled`
4. **Restore inventory**: for each order line, increase inventory by the ordered quantity
5. Persist changes

**Business Rules Applied:**
- Orders in PendingPayment, PaymentInitiated, or PaymentFailed can be cancelled
- Paid or delivered orders cannot be cancelled (no refund workflow)
- Inventory is automatically restored upon cancellation

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs`

---

### 3.7 Manual Payment Override

**Trigger:** An administrator manually marks an order as paid (e.g., for cash payments or payment system issues).

**Steps:**
1. Fetch the order
2. Validate order status allows manual payment (PendingPayment, PaymentInitiated, or PaymentFailed)
3. Set payment intent ID to `"manual-admin-override"`
4. Transition status to `Paid`
5. Persist changes

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Pay/PayOrderHandler.cs`
- `Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs` (MarkAsPaidManually)

---

### 3.8 Order Delivery

**Trigger:** An administrator marks a paid order as delivered.

**Steps:**
1. Fetch the order
2. Validate order status is `Paid`
3. Transition status to `Delivered`
4. Persist changes

**Implemented in:**
- `Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Deliver/DeliverOrderHandler.cs`

---

## 4. Order Status State Machine

```
                    +------------------------------------------+
                    |                                          |
                    v                                          |
 +-----------------+----+    InitiatePayment    +--------------+------+
 |   PendingPayment     |--------------------->|  PaymentInitiated    |
 +----------------------+                      +---------------------+
        |       ^                                    |           |
        |       |                                    |           |
        |       +------------ PaymentFailed <--------+           |
        |                    (can retry)                         |
        |                         |                              |
   MarkAsCancelled           MarkAsCancelled               MarkAsPaid
        |                         |                       (webhook or manual)
        v                         v                              |
 +--------------+                                    +-----------+-----+
 |  Cancelled   | <---- MarkAsCancelled ------------ |      Paid       |
 +--------------+   (from PaymentInitiated)          +-----------------+
                                                             |
                                                        MarkAsDelivered
                                                             |
                                                             v
                                                     +-----------------+
                                                     |    Delivered    |
                                                     +-----------------+
```

**Cancellable States:** PendingPayment, PaymentInitiated, PaymentFailed
**Manual Payment States:** PendingPayment, PaymentInitiated, PaymentFailed
**Terminal States:** Cancelled, Delivered

---

## 5. Business Rules

### 5.1 Product & Catalog Rules

| Rule | Description | Location |
|------|-------------|----------|
| Category name required | Category names cannot be empty or whitespace | `CategoryInvariants.cs` |
| Category name max length | Max 255 characters | `CategoryInvariants.cs` |
| Category name uniqueness | Category names must be unique (database-enforced) | `CategoryConfiguration.cs` |
| Product name required | Product names cannot be empty or whitespace | `ProductInvariants.cs` |
| Product name max length | Max 100 characters | `ProductInvariants.cs` |
| Description max length | Max 4,000 characters | `ProductInvariants.cs` |
| Brand not whitespace | If a brand is provided, it cannot be only whitespace | `ProductInvariants.cs` |
| Brand max length | Max 100 characters | `ProductInvariants.cs` |
| Price must be non-negative | Product variant prices must have Amount >= 0 | `ProductInvariants.cs` |
| SKU max length | Max 50 characters | `ProductInvariants.cs` |
| SKU global uniqueness | SKUs must be globally unique across all product variants (null allowed for multiple variants without SKUs) | `AddVariantHandler.cs`, `ProductVariantConfiguration.cs` |

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
| Orders via checkout only | Orders can only be created through the shopping cart checkout process | `CheckOutHandler.cs` |
| Non-empty order | Orders must contain at least one order line | `OrderInvariants.cs` |
| Positive line quantity | Order line quantities must be greater than zero | `OrderInvariants.cs` |
| Non-negative line price | Order line unit prices cannot be negative | `OrderInvariants.cs` |
| Cancellation restriction | Only PendingPayment, PaymentInitiated, or PaymentFailed orders can be cancelled | `OrderInvariants.cs` |
| Payment initiation restriction | Payment can only be initiated from PendingPayment or PaymentFailed states | `OrderInvariants.cs` |
| Payment confirmation restriction | Only PaymentInitiated orders can be marked as paid (via webhook) | `OrderInvariants.cs` |
| Manual payment restriction | Manual payment allowed from PendingPayment, PaymentInitiated, or PaymentFailed | `OrderInvariants.cs` |
| Delivery restriction | Only Paid orders can be marked as delivered | `OrderInvariants.cs` |
| Inventory restoration | Cancelling an order restores all order line quantities to inventory | `CancelOrderHandler.cs` |
| Price snapshot | Order lines capture the unit price at checkout time, not current catalog price | `CheckOutDomainService.cs` |

### 5.4 Inventory Rules

| Rule | Description | Location |
|------|-------------|----------|
| Non-negative stock | Available quantity can never go below zero | `InventoryItemInvariants.cs` |
| Positive adjustment | Increase/decrease amounts must be positive | `InventoryItemInvariants.cs` |
| Sufficient stock | Decreasing inventory requires sufficient available quantity | `InventoryItemInvariants.cs` |
| Variant must exist | Inventory can only be created for existing product variants | `AdjustInventoryHandler.cs` |

### 5.5 Identity & Authentication Rules

| Rule | Description | Location |
|------|-------------|----------|
| Unique email (User) | User emails must be unique | `UserConfiguration.cs` |
| Unique email (Customer) | Customer emails must be unique | `CustomerConfiguration.cs` |
| Valid role | User roles must be either "Admin" or "Customer" | `UserInvariants.cs` |
| Access token expiry | Access tokens expire after 15 minutes (configurable) | `JwtSettings` |
| Refresh token expiry | Refresh tokens expire after 7 days (configurable) | `JwtSettings` |
| Auto customer creation | Registering as a Customer automatically creates a linked Customer entity | `UserRegisteredHandler.cs` |
| Admin no customer | Admin users do not get an associated Customer record | `UserRegisteredHandler.cs` |
| Name required | Customer first name and last name cannot be empty or whitespace | `CustomerInvariants.cs` |
| Email required | Customer email cannot be empty or whitespace | `CustomerInvariants.cs` |
| Address line 1 required | If address is provided, AddressLine1 is required | `AddressInvariants.cs` |

---

## 6. Use Cases

### Customer-Facing

| Use Case | Actor | Description |
|----------|-------|-------------|
| Register | Anonymous | Create a new customer account with email and password |
| Login | Anonymous | Authenticate with email and password to receive JWT tokens |
| Refresh session | Any authenticated | Obtain new tokens using a valid refresh token |
| Revoke session | Any authenticated | Invalidate refresh token to end session |
| Browse catalog | Anonymous | View categories, products, and product variants with pricing |
| View product detail | Anonymous | See product details, variants, pricing, and add to cart |
| Add item to cart | Customer | Add a product variant with quantity to shopping cart (via drawer) |
| Change cart item quantity | Customer | Update the quantity of an item already in cart (+/- controls) |
| Remove item from cart | Customer | Remove a product variant from shopping cart |
| Clear cart | Customer | Remove all items from shopping cart |
| Checkout | Customer | Convert shopping cart into an order (reserves inventory) |
| Initiate payment | Customer | Start Stripe checkout session for a pending order |
| View my orders | Customer | List all orders belonging to the authenticated customer |
| View order detail | Customer | See order status, lines, and payment information |
| Cancel order | Customer | Cancel a pending/initiated/failed order (restores inventory) |
| Update profile | Customer | Change name, address, or password via profile page (email change is not offered in the UI) |
| Change password | Customer | Update account password via profile page |

### Administrator-Facing

| Use Case | Actor | Description |
|----------|-------|-------------|
| Manage categories | Admin | Create, rename, assign parent, delete categories |
| Manage products | Admin | Create, rename, update description/brand/category of products |
| Manage product variants | Admin | Add/remove variants, change SKU and price |
| Manage inventory | Admin | Increase, decrease, or set stock levels per variant |
| Mark order as paid | Admin | Manually override payment for an order |
| Mark order as delivered | Admin | Confirm order has been delivered |
| View all orders | Admin | View orders across all customers with filtering/pagination |
| Cancel order | Admin | Cancel any cancellable order |
| View all shopping carts | Admin | Browse customer shopping carts with status |
| View cart details | Admin | See cart contents, manage items, checkout on behalf |
| Manage customers | Admin | Create, view, edit, and delete customer profiles |

---

## 7. Domain Events and State Changes

### Catalog Events

| Event | Trigger | Business Meaning |
|-------|---------|-----------------|
| CategoryCreated | Category added to catalog | New product classification available |
| CategoryDeleted | Category removed (soft delete) | Classification no longer available |
| CategoryNameChanged | Category renamed (only if name actually differs) | Classification label updated |
| ProductCreated | New product added | New item available for sale |
| ProductDeleted | Product removed (soft delete) | Item no longer available |
| ProductNameChanged | Product renamed (only if name actually differs) | Item label updated |
| ProductVariantAdded | Variant added to product | New purchasable option available |
| ProductVariantRemoved | Variant removed (soft delete) | Purchasable option discontinued |
| ProductVariantSkuChanged | SKU updated (only if actually differs) | Inventory tracking identifier changed |
| ProductVariantPriceChanged | Price updated (only if actually differs) | Item pricing adjusted |

### Sales Events

| Event | Trigger | Business Meaning |
|-------|---------|-----------------|
| ShoppingCartCreated | First item added by customer | Customer started shopping |
| ShoppingCartItemAdded | New variant added to cart | Customer interested in a product |
| ShoppingCartItemQuantityAdjusted | Quantity changed (increase on duplicate add, or explicit change) | Customer adjusted desired quantity |
| ShoppingCartItemRemoved | Item removed from cart (soft delete) | Customer no longer wants item |
| ShoppingCartCheckedOut | Checkout completed | Customer committed to purchase |
| ShoppingCartCleared | All items removed | Customer abandoned selections |
| ShoppingCartDeleted | Cart soft-deleted | Cart record removed |
| OrderPlaced | Checkout creates order | Purchase order confirmed |
| OrderPaymentInitiated | Stripe session created | Customer directed to payment |
| OrderPaid | Payment confirmed (webhook or manual) | Revenue collected |
| OrderPaymentFailed | Payment unsuccessful | Payment needs retry or cancellation |
| OrderDelivered | Admin marks delivered | Fulfillment completed |
| OrderCancelled | Order cancelled | Purchase reversed, inventory restored |
| OrderDeleted | Order soft-deleted | Order record removed |
| InventoryItemCreated | Stock record created | Variant now trackable |
| InventoryAdjusted | Stock level changed (only when quantity actually changes) | Available quantity updated |
| InventoryItemDeleted | Stock record soft-deleted | Variant no longer tracked |

### Identity Events

| Event | Trigger | Business Meaning |
|-------|---------|-----------------|
| UserRegistered | New account created | New user in the system |
| UserPasswordChanged | Password updated | Security credentials rotated |
| UserDeactivated | Account disabled | User can no longer access system |
| CustomerCreated | Auto-created on registration | Customer profile established |
| CustomerDeleted | Customer soft-deleted | Profile removed |
| CustomerNameChanged | Name updated (only if differs) | Profile information changed |
| CustomerEmailChanged | Email updated (only if differs) | Contact information changed |
| CustomerAddressChanged | Address updated (only if differs) | Shipping information changed |

---

## 8. External Integrations

### 8.1 Stripe Payment Gateway

**Purpose:** Processes online customer payments for orders.

**Business Impact:** Enables the system to collect payments from customers and confirm payment success or failure asynchronously via webhooks.

**Integration Points:**
- **Checkout Session Creation**: Creates hosted payment pages with order details, converting internal Money values to Stripe's smallest currency unit (cents). Maps order lines to Stripe line items with product name, quantity, and unit amount.
- **Webhook Processing**: Receives and verifies payment status notifications using Stripe's signature verification (`EventUtility.ConstructEvent()`). Handles `checkout.session.completed`, `checkout.session.expired`, and `payment_intent.payment_failed` events.
- **Error Handling**: Stripe API errors return `Result.Failure` with code `"Payment.Stripe.SessionCreationFailed"`. Signature verification failures return `"Payment.SignatureVerification.Failed"`.
- **Configuration**: Stripe API key (`SecretKey`) and webhook secret (`WebhookSecret`) configured per environment via `StripeSettings` (user secrets recommended).

**Source:** `Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/StripePaymentService.cs`

### 8.2 SMTP Email Service

**Purpose:** Infrastructure for sending email notifications.

**Business Impact:** Provides the capability for system-to-user communication.

**Configuration:**
- Host, Port (default 25), Username, Password, EnableSsl, From, To
- Default: `localhost:25` with SSL disabled

**Source:** `Source/Common/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs`

**Note:** While the email service infrastructure is fully implemented, no domain event handlers currently trigger email sending. This may be planned functionality.

---

## 9. Authorization Model

| Policy | Access Level | Description |
|--------|-------------|-------------|
| Anonymous | No auth required | Catalog browsing (GET categories, products), login, registration, payment webhooks |
| RequireAuthenticated | Any logged-in user | Shopping cart operations, order viewing (own), profile management |
| RequireCustomer | Customer role | Customer-specific operations |
| RequireAdmin | Admin role | Catalog management, inventory management, manual payment, delivery confirmation |

**Ownership Enforcement:** The `OwnerOrAdminFilter` validates that the route parameter `id` (CustomerIdentifierType) matches the authenticated user's customer ID, or that the user has the Admin role. Applied to shopping cart and order endpoints. Returns 403 Forbidden if unauthorized.

**JWT Claims:** Access tokens contain: `sub`, `jti`, `iat`, `user_id`, `email`, `role`, and `customer_id` (when applicable).

---

## 10. Cross-Module Communication

The system enforces strict module boundaries. Modules communicate only through shared interface contracts:

| Interface | Provider Module | Consumer Module | Purpose |
|-----------|----------------|-----------------|---------|
| `IProductVariantService` | Catalog | Sales | Verify variant existence, check SKU uniqueness, fetch unit prices, get ID by SKU |

**Confirmed behaviors:**
- Sales module cannot directly access Catalog domain entities
- When Catalog module is disabled, a stub `DisabledProductVariantService` is registered
- Sales module declares a hard dependency on Catalog (`RequiresDependencies = true`) — it will not start without Catalog
- Module discovery uses reflection; registration follows topological dependency order (Kahn's algorithm)

---

## 11. User Interface

### 11.1 Technology

The UI is a **Blazor Server + WebAssembly hybrid** (`InteractiveAuto` render mode) using **MudBlazor** component library. It supports multiple hosting targets:
- **Web** (Server + WASM): `Source/UI/Hosts/MMCA.Store.UI.Web`
- **WebAssembly Client**: `Source/UI/Hosts/MMCA.Store.UI.Web.Client`
- **MAUI** (iOS, Android, macOS, Windows): `Source/UI/Hosts/MMCA.Store.UI`

### 11.2 Shopping Cart UX

The shopping cart is exclusively accessible through a **380px right-side drawer** (CartDrawer), opened via the cart icon in the top app bar. There is no dedicated cart page.

**Features:**
- Quantity +/- controls per item when cart is Active
- Remove individual items, clear all items
- "Checkout & Pay" button triggers order creation + Stripe redirect
- "Checked Out" chip and read-only mode for checked-out carts
- Empty state with "Browse Products" navigation
- "Continue Shopping" link to catalog

**State Management:** The `ICartStateService` singleton manages cart state centrally. It enriches cart items with product names and SKUs from the Catalog API after each refresh.

### 11.3 Catalog Browse

The catalog browse page (`/catalog`) provides:
- Product grid with search by name
- Category filter dropdown
- Sort by name or price
- Quick "Add to Cart" buttons per variant
- "View Details" navigation to product detail page

The product detail page (`/catalog/{id}`) shows:
- Breadcrumbs (Home > Catalog > Product)
- Product description, brand, category
- Variant list with SKU, price, quantity selector, and "Add to Cart"
- "Buy Now" option (direct Stripe checkout for single variant)

### 11.4 Navigation Structure

**Sidebar** (role-based, dynamically populated from `IUIModule` registrations):
- Customer: Home, Shop, My Orders, My Profile
- Admin: Home, Categories, Products, Inventory, Shopping Carts, Orders, Customers, My Profile

**Top App Bar**: Cart icon with badge count, user email, Logout button (authenticated) or Login/Register buttons (anonymous)

### 11.5 Module Registration

UI modules implement `IUIModule` (providing `NavItems` and `Assembly` for route discovery). Modules can be conditionally enabled via `UIModuleConfiguration.IsModuleEnabled(configuration, moduleName)`.

---

## 12. Cross-Cutting Infrastructure

### 12.1 Command/Query Pipeline Decorators

| Decorator | Marker | Behavior |
|-----------|--------|----------|
| `TransactionalCommandDecorator` | `ITransactional` | Wraps command in database transaction (begin/commit/rollback) |
| `CachingCommandDecorator` | `ICacheInvalidating` | Invalidates cache entries by prefix on successful command execution |
| `ProfilingCommandDecorator` | (all commands) | Records MiniProfiler step (when `UseMiniProfiler=true`) |
| `ProfilingQueryDecorator` | (all queries) | Records MiniProfiler step (when `UseMiniProfiler=true`) |

### 12.2 Idempotency

The `IdempotencyFilter` (applied via `[Idempotent]` attribute on Create endpoints) caches the first response for a given `Idempotency-Key` header value for 24 hours. Duplicate requests receive the cached response with an `X-Idempotent-Replay: true` header. Per-key `SemaphoreSlim` locking prevents concurrent duplicate execution.

### 12.3 Exception Handling

Five exception handlers (registered as middleware in priority order):
1. **DomainExceptionHandler** -> HTTP 400
2. **ValidationExceptionHandler** (FluentValidation) -> HTTP 400 with grouped errors
3. **DbUpdateExceptionHandler** -> HTTP 409 Conflict
4. **OperationCanceledExceptionHandler** -> HTTP 499
5. **GlobalExceptionHandler** -> HTTP 500 (catch-all)

### 12.4 Multi-Database Strategy

The `IDbContextFactory` implements a strategy pattern supporting three data sources:
- **SQL Server** (default, via Aspire container)
- **SQLite** (alternative)
- **Cosmos DB** (alternative, no transaction support)

Entity types are routed to data sources via `[UseDataSource]` attribute on EF configurations. The `IDataSourceService` caches entity-to-datasource mappings.

---

## 13. Testing

### 13.1 Test Structure

| Type | Projects | Description |
|------|----------|-------------|
| **Unit** | 15 projects (per module per layer + common) | Entity creation, invariants, domain events, handlers, mappers, validators |
| **Architecture** | 1 project (12 test files) | NetArchTest.Rules: layer dependencies, module isolation, domain purity, naming conventions |
| **Integration** | 3 per-service projects (Catalog, Sales, Identity) | Each boots one service host via `WebApplicationFactory`; Testcontainers.MsSql + Respawn for DB reset (or a real SQL Server via `STORE_TEST_SQL_BASE`), JWT token generation, full HTTP endpoint testing. Runs via `MMCA.Store.Integration.slnf` and gates deploy. The old combined single-host `MMCA.Store.IntegrationTests` has been removed. |
| **E2E** | 1 project | Playwright (Chromium), page objects, Blazor wait helpers, full user journey tests |

### 13.2 Key Test Scenarios

- Full customer journey: Register -> Browse -> Add to Cart -> Checkout -> Admin Pay -> Deliver
- Order lifecycle: all state transitions including cancellation with inventory restoration
- Cart operations: add, change quantity, remove, clear, checkout
- Authorization: anonymous, customer, admin role enforcement
- Cross-module: Catalog -> Sales pricing, inventory validation

---

## 14. Missing or Unclear Business Logic

### 14.1 No Email Notifications on Events
**Observation:** The SMTP email service infrastructure is implemented, but no domain event handlers trigger email notifications for events like order confirmation, payment receipt, or shipping notification.
**Recommendation:** Clarify whether email notifications are planned or intentionally omitted.

### 14.2 No Return/Refund Workflow
**Observation:** Once an order reaches `Paid` or `Delivered` status, there are no further state transitions available. No return, refund, or exchange workflow exists. Cancellation is only possible before payment succeeds.
**Recommendation:** Clarify whether returns/refunds are in scope and whether Stripe refund integration is needed.

### 14.3 No Inventory Check at Cart-Add Time
**Observation:** When a customer adds an item to the cart, the system verifies the product variant exists but does **not** check if inventory is available. Inventory is only validated at checkout.
**Recommendation:** This may be intentional (allowing customers to add items that are temporarily out of stock) or may warrant a stock availability indicator on the cart.

### 14.4 Cart Reactivation Clears All Items
**Observation:** When a customer adds an item to a previously checked-out cart, all previous items are deleted and the cart is reactivated empty (with only the new item). The business intent behind clearing the cart rather than preserving previous items is unclear.
**Recommendation:** Confirm this is the desired behavior — some systems prefer to retain unchecked-out items.

### 14.5 No Price Change Protection
**Observation:** Product variant prices can be changed at any time by administrators. If a customer has items in their cart and prices change before checkout, the customer will be charged the new price (prices are fetched at checkout, not at cart-add time).
**Recommendation:** Determine if customers should be notified of price changes or if cart items should display price warnings.

### 14.6 Delivery Tracking Absent
**Observation:** The `MarkAsDelivered` transition exists but there is no tracking number, carrier information, or estimated delivery date. Delivery is a binary admin action.
**Recommendation:** Consider whether shipping/tracking details are needed for the business use case.

### 14.7 No Partial Order Fulfillment
**Observation:** Orders are delivered as a whole — there is no concept of partial shipments or split deliveries.
**Recommendation:** Clarify if partial fulfillment is a future requirement.

### 14.8 No Customer/User Deactivation Endpoint
**Observation:** `User.Deactivate()` method and `UserDeactivated` domain event exist in the domain model, but no API endpoint or UI action exposes this functionality.
**Recommendation:** May be an admin feature not yet implemented.

### 14.9 Category Deletion Has No Cascade Check
**Observation:** Deleting a category doesn't check for assigned products. Products with a deleted category may have an orphaned `CategoryId`.
**Recommendation:** Consider validating no products reference the category before deletion, or cascading the nullification.

### 14.10 Inventory List Endpoint Not Exposed
**Observation:** The `InventoryItemsController` only exposes `GetById` — the `GetAll`, `GetPaged`, and `Lookup` endpoints from the base class are not overridden. The UI `InventoryItemList` page may need these endpoints.
**Recommendation:** Verify how the inventory list page fetches its data and whether list endpoints should be added.

---

## 15. Seed Data (Initial System State)

The system seeds the following data at startup:

**Users:**
- Admin: one seeded administrator account (Admin role, no Customer record; credentials are environment-specific and not published)
- Customer: one seeded demo customer account (Customer role)

**Catalog:**
- Categories: "Jewelry" (id=1), "Watches" (id=2)
- Product: "Gold Ring" (id=11, brand: "WhatNot", category: Jewelry)
- Variants: "Gold Ring - Size 6" ($15.00), "Gold Ring - Size 7" ($15.50), "Gold Ring - Size 8" ($16.00) — all USD

**Inventory:** 100,000 units per variant (for all 3 Gold Ring sizes)

**Seeding is idempotent** — seeders check for existing data via `ExistsAsync()` before inserting, and only run for enabled modules.

---

*This specification is derived entirely from the source code. All business rules, workflows, and behaviors described above are confirmed implementations traceable to the referenced source files. Last updated: 2026-03-18.*
