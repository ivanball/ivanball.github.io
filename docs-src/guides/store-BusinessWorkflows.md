# MMCA Business Workflow Analysis

## Workflow List Summary

| # | Workflow | Entry Point | Module |
|---|---------|-------------|--------|
| 1 | User Registration | `POST /auth/register` | Identity |
| 2 | User Login | `POST /auth/login` | Identity |
| 3 | Token Refresh | `POST /auth/refresh` | Identity |
| 4 | Token Revocation | `POST /auth/revoke` | Identity |
| 5 | Change Password | `PUT /auth/password` | Identity |
| 6 | Change Customer Name | `PUT /customers/{id}/name` | Identity |
| 7 | Change Customer Address | `PUT /customers/{id}/address` | Identity |
| 8 | Change Customer Email | `PUT /customers/{id}/email` | Identity |
| 9 | Create Customer | `POST /customers` | Identity |
| 10 | Delete Customer | `DELETE /customers/{id}` | Identity |
| 11 | Create Category | `POST /categories` | Catalog |
| 12 | Rename Category | `PUT /categories/{id}/name` | Catalog |
| 13 | Assign Parent Category | `PUT /categories/{id}/parentcategory` | Catalog |
| 14 | Delete Category | `DELETE /categories/{id}` | Catalog |
| 15 | Create Product | `POST /products` | Catalog |
| 16 | Rename Product | `PUT /products/{id}/name` | Catalog |
| 17 | Change Product Description | `PUT /products/{id}/description` | Catalog |
| 18 | Change Product Brand | `PUT /products/{id}/brand` | Catalog |
| 19 | Assign Category to Product | `PUT /products/{id}/category` | Catalog |
| 20 | Delete Product | `DELETE /products/{id}` | Catalog |
| 21 | Add Product Variant | `POST /products/{id}/productvariants` | Catalog |
| 22 | Remove Product Variant | `DELETE /products/{id}/productvariants/{variantId}` | Catalog |
| 23 | Change Variant SKU | `PUT /products/{id}/productvariants/{variantId}/sku` | Catalog |
| 24 | Change Variant Price | `PUT /products/{id}/productvariants/{variantId}/price` | Catalog |
| 25 | Add Item to Cart | `POST /shoppingcarts/{id}/shoppingcartitems` | Sales |
| 26 | Change Cart Item Quantity | `PUT /shoppingcarts/{id}/shoppingcartitems/{variantId}/quantity` | Sales |
| 27 | Remove Cart Item | `DELETE /shoppingcarts/{id}/shoppingcartitems/{variantId}` | Sales |
| 28 | Clear Cart | `PUT /shoppingcarts/{id}/clear` | Sales |
| 29 | Checkout (Cart to Order) | `PUT /shoppingcarts/{id}/checkout` | Sales |
| 30 | Create Stripe Checkout Session | `POST /orders/{id}/checkout` | Sales |
| 31 | Stripe Payment Webhook | `POST /payments/webhook` | Sales |
| 32 | Manual Admin Payment | `PUT /orders/{id}/pay` | Sales |
| 33 | Deliver Order | `PUT /orders/{id}/deliver` | Sales |
| 34 | Cancel Order | `PUT /orders/{id}/cancel` | Sales |
| 35 | Increase Inventory | `PUT /inventoryitems/{id}/increaseinventory` | Sales |
| 36 | Decrease Inventory | `PUT /inventoryitems/{id}/decreaseinventory` | Sales |
| 37 | Set Inventory | `PUT /inventoryitems/{id}/setinventory` | Sales |

---

## 1. Identity Module Workflows

### 1.1 User Registration

**Entry Point:** `POST /auth/register` — `AuthController.RegisterAsync()` — AllowAnonymous

**Execution Path:**

```
AuthController.RegisterAsync()
  -> AuthenticationService.RegisterAsync()
    -> Repository: check email uniqueness
    -> PasswordHasher.HashPassword() (PBKDF2-HMAC-SHA512, 600k iterations, per-user salt)
    -> User.Create() factory method
    -> Repository.AddAsync() + UnitOfWork.SaveChangesAsync()
    -> [Domain Event] UserRegisteredHandler
      -> Customer.Create() (creates linked customer profile)
      -> User.LinkCustomer(customerId)
    -> TokenService.GenerateTokens()
```

**Business Steps:**

1. Validate registration input (email, password, first name, last name, optional address)
2. Check email is not already registered
3. Hash password with PBKDF2-HMAC-SHA512 (600,000 iterations, per-user salt)
4. Create User aggregate (IsActive=true, Role="Customer")
5. Persist user — triggers `UserRegistered` domain event
6. Domain event handler creates Customer profile and links it to User
7. Generate access token (15 min, JWT with claims: sub, jti, iat, user_id, email, role, customer_id) + refresh token (7 days, 64-byte random)
8. Return authentication response with tokens

**Decision Points:**

- Email already exists -> Conflict error
- Role="Admin" -> no Customer profile created; Role="Customer" -> Customer auto-created

**State Changes:**

- Creates `User` (Active, with RefreshToken and RefreshTokenExpiry)
- Creates `Customer` (linked via User.CustomerId)

**Domain Events:** `UserRegistered` -> triggers `CustomerCreated`

---

### 1.2 User Login

**Entry Point:** `POST /auth/login` — `AuthController.LoginAsync()` — AllowAnonymous

**Execution Path:**

```
AuthController.LoginAsync()
  -> AuthenticationService.LoginAsync()
    -> Repository: find User by email
    -> PasswordHasher.VerifyPassword() (constant-time comparison)
    -> Check User.IsActive
    -> TokenService.GenerateTokens()
    -> Update User.RefreshToken + RefreshTokenExpiry
    -> UnitOfWork.SaveChangesAsync()
```

**Business Steps:**

1. Look up user by email
2. Verify password against stored hash+salt
3. Verify user is active
4. Generate new access + refresh tokens
5. Store refresh token on user entity
6. Return tokens

**Decision Points:**

- Email not found -> Unauthorized
- Password mismatch -> Unauthorized
- User deactivated -> Unauthorized

**State Changes:** `User.RefreshToken` and `User.RefreshTokenExpiry` updated

---

### 1.3 Token Refresh

**Entry Point:** `POST /auth/refresh` — AllowAnonymous

**Execution Path:**

```
AuthController.RefreshAsync()
  -> TokenService.GetPrincipalFromExpiredToken() (validates structure, allows expired)
  -> Extract user_id claim -> fetch User
  -> Validate RefreshToken matches + not expired + user active
  -> Generate new tokens -> update User.RefreshToken
  -> SaveChangesAsync()
```

**Decision Points:**

- Invalid/expired refresh token -> Unauthorized
- User deactivated -> Unauthorized

**State Changes:** Refresh token rotated on User entity

---

### 1.4 Token Revocation

**Entry Point:** `POST /auth/revoke` — Requires Authorization

**Business Steps:** Clears `User.RefreshToken` and `User.RefreshTokenExpiry` to null.

---

### 1.5 Change Password

**Entry Point:** `PUT /auth/password` — Requires Authorization

**Execution Path:**

```
AuthController.ChangePasswordAsync()
  -> ChangePasswordHandler.Handle()
    -> Verify current password
    -> Hash new password
    -> User.ChangePassword() -> publishes UserPasswordChanged
    -> SaveChangesAsync()
```

**Decision Points:** Current password incorrect -> Bad Request

---

### 1.6 Customer Profile Management

| Workflow | Endpoint | Domain Method | Event |
|----------|----------|---------------|-------|
| Change Name | `PUT /customers/{id}/name` | `Customer.ChangeName()` | `CustomerNameChanged` |
| Change Address | `PUT /customers/{id}/address` | `Customer.ChangeAddress()` | `CustomerAddressChanged` |
| Change Email | `PUT /customers/{id}/email` | `Customer.ChangeEmail()` | `CustomerEmailChanged` |

Email change includes uniqueness check across customers.

### 1.7 Customer CRUD (Admin)

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Create Customer | `POST /customers` | Authenticated | Idempotent via `[Idempotent]` attribute |
| Delete Customer | `DELETE /customers/{id}` | Authenticated | Soft delete (IsDeleted=true), publishes `CustomerDeleted` |
| Get Customer | `GET /customers/{id}` | Authenticated | Only GetById exposed; GetAll/Paged/Lookup not exposed |

---

## 2. Catalog Module Workflows

### 2.1 Category Management

#### Create Category

**Entry Point:** `POST /categories` — Admin only, `[Idempotent]`

```
CategoriesController.CreateAsync()
  -> CreateCategoryHandler
    -> CategoryCreateRequestValidator (name: required, max 255)
    -> Category.Create(id, name, parentCategoryId?) -> publishes CategoryCreated
    -> Repository.AddAsync() + SaveChangesAsync()
```

**Response:** 201 Created with `CategoryDTO`

#### Rename Category

**Entry Point:** `PUT /categories/{id}/name` — Admin only

```
CategoriesController.RenameAsync()
  -> RenameCategoryHandler
    -> Validate name (max 255)
    -> Fetch category -> category.Rename(name)
    -> Only updates if name differs (case-insensitive comparison)
    -> Publishes CategoryNameChanged if changed
    -> Cache invalidation
```

#### Assign Parent Category

**Entry Point:** `PUT /categories/{id}/parentcategory` — Admin only

Sets or clears `ParentCategoryId` to establish hierarchy. No domain event raised.

#### Delete Category

**Entry Point:** `DELETE /categories/{id}` — Admin only

Soft delete (`IsDeleted=true`). Publishes `CategoryDeleted`.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /categories` | AllowAnonymous | Returns all categories (capped at MaxPageSize) |
| `GET /categories/paged` | AllowAnonymous | Paginated with filters, sorting, field projection |
| `GET /categories/lookup` | AllowAnonymous | Returns ID + name pairs for dropdowns |
| `GET /categories/{id}` | AllowAnonymous | Single category with optional FK/children includes |

---

### 2.2 Product Management

#### Create Product

**Entry Point:** `POST /products` — Admin only, `[Idempotent]`

```
ProductsController.CreateAsync()
  -> CreateProductHandler
    -> Validate: name (required, max 100), description (max 4000), brand (max 100, no whitespace if provided)
    -> Product.Create() factory -> publishes ProductCreated
    -> Repository.AddAsync() + SaveChangesAsync()
```

#### Update Operations

| Workflow | Endpoint | Validation | Event |
|----------|----------|-----------|-------|
| Rename | `PUT /products/{id}/name` | Max 100, required | `ProductNameChanged` |
| Change Description | `PUT /products/{id}/description` | Max 4000, nullable | None |
| Change Brand | `PUT /products/{id}/brand` | Max 100, no whitespace | None |
| Assign Category | `PUT /products/{id}/category` | Nullable FK | None |

#### Delete Product

**Entry Point:** `DELETE /products/{id}` — Admin only. Soft delete, publishes `ProductDeleted`.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /products` | AllowAnonymous | Returns all products (capped at MaxPageSize) |
| `GET /products/paged` | AllowAnonymous | Paginated with filters, sorting, field projection |
| `GET /products/lookup` | AllowAnonymous | Returns ID + name pairs for dropdowns |
| `GET /products/{id}` | AllowAnonymous | Single product with optional FK/children includes |

---

### 2.3 Product Variant Management

#### Add Product Variant

**Entry Point:** `POST /products/{id}/productvariants` — Admin only

```
ProductVariantsController.CreateAsync()
  -> AddVariantHandler
    -> Validate: SKU (max 50), Price (positive Money)
    -> IProductVariantService.SkuExistsAsync() -> global SKU uniqueness check
    -> Fetch Product with variants
    -> product.AddProductVariant(variantId, sku, price)
      -> ProductVariant.Create() validates price not negative
      -> Publishes ProductVariantAdded
    -> SaveChangesAsync()
```

**Cross-Module:** SKU uniqueness checked via `IProductVariantService`

#### Change Variant SKU

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/sku` — Admin only

SKU uniqueness verified globally (excluding current variant). Publishes `ProductVariantSkuChanged` if changed.

#### Change Variant Price

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/price` — Admin only

Price must be positive. Publishes `ProductVariantPriceChanged` if changed.

#### Remove Product Variant

**Entry Point:** `DELETE /products/{id}/productvariants/{variantId}` — Admin only

Soft delete on variant. Publishes `ProductVariantRemoved`.

---

## 3. Sales Module Workflows

### 3.1 Shopping Cart

#### Add Item to Cart

**Entry Point:** `POST /shoppingcarts/{customerId}/shoppingcartitems` — Authenticated (owner or admin via `OwnerOrAdminFilter`)

```
ShoppingCartsController.CreateShoppingCartItemAsync()
  -> AddItemHandler
    -> Validate quantity > 0
    -> IProductVariantService.ExistsAsync() [cross-module: Catalog]
    -> Fetch ShoppingCart by CustomerId
    -> If no cart exists -> ShoppingCart.Create(customerId) -> ShoppingCartCreated event
    -> If cart is CheckedOut -> shoppingCart.Reactivate() (clears items, resets to Active)
    -> shoppingCart.AddShoppingCartItem(variantId, quantity)
      -> If item already in cart -> IncreaseQuantity -> ShoppingCartItemQuantityAdjusted
      -> If new item -> ShoppingCartItem.Create() -> ShoppingCartItemAdded
    -> SaveChangesAsync()
```

**Decision Points:**

- Product variant doesn't exist -> NotFound
- Quantity not positive -> Invariant error
- Cart checked out -> auto-reactivated (all old items cleared)

#### Change Item Quantity

**Entry Point:** `PUT /shoppingcarts/{id}/shoppingcartitems/{variantId}/quantity`

Validates cart is Active, item exists, quantity > 0. Publishes `ShoppingCartItemQuantityAdjusted`.

#### Remove Item

**Entry Point:** `DELETE /shoppingcarts/{id}/shoppingcartitems/{variantId}`

Validates cart is Active. Soft-deletes item. Publishes `ShoppingCartItemRemoved`.

#### Clear Cart

**Entry Point:** `PUT /shoppingcarts/{id}/clear`

Deletes all items. Publishes `ShoppingCartCleared`.

#### Get Cart

**Entry Point:** `GET /shoppingcarts/{id}` — Authenticated + OwnerOrAdmin

Returns the customer's cart with optional children (items). Returns an empty DTO (not 404) if no cart exists (lazy cart pattern).

#### Shopping Cart Status State Machine

```
Active --(MarkAsCheckedOut)--> CheckedOut
  ^                                |
  +----(Reactivate on AddItem)-----+
        (clears all items)
```

---

### 3.2 Checkout (Cart to Order) — Primary Business Workflow

**Entry Point:** `PUT /shoppingcarts/{customerId}/checkout` — Authenticated, marked `ITransactional` and `ICacheInvalidating`

```
ShoppingCartsController.CheckOutAsync()
  -> CheckOutHandler
    -> Fetch ShoppingCart with items
    -> Collect productVariantIds from cart items
    -> IProductVariantService.GetUnitPricesAsync(ids) [cross-module: Catalog]
    -> Fetch InventoryItems for all variants
    -> CheckOutDomainService.Execute():
        1. Validate cart not empty
        2. Validate inventory exists for all items
        3. For each item: inventoryItem.DecreaseInventory(quantity)
           -> Validates sufficient stock
           -> Publishes InventoryAdjusted
        4. Build order items (variant + price + quantity)
        5. Order.Create(customerId, items) -> publishes OrderPlaced
        6. shoppingCart.MarkAsCheckedOut() -> publishes ShoppingCartCheckedOut
    -> Repository.AddAsync(order)
    -> SaveChangesAsync()
    -> Return OrderDTO
```

**Business Steps:**

1. Validate cart exists and has items
2. Fetch current prices from Catalog module
3. Validate and decrement inventory for all items
4. Create Order aggregate with OrderLines (price snapshot at time of purchase)
5. Transition cart to CheckedOut status
6. Persist everything in a single transaction (`ITransactional`)

**Decision Points:**

- Cart empty -> Validation error
- Product variant price not found -> Error
- Insufficient inventory -> Invariant error
- Inventory record missing -> NotFound (specific missing variant ID reported)

**State Changes:**

- Creates `Order` (status: PendingPayment) with `OrderLine` children
- Decrements `InventoryItem.AvailableQuantity` for each item
- `ShoppingCart.Status` -> CheckedOut

**Domain Events:** `OrderPlaced`, `InventoryAdjusted` (per item), `ShoppingCartCheckedOut`

---

### 3.3 Order Lifecycle

#### Order Status State Machine

```
                    +------------------------------------------+
                    |                                          |
                    v                                          |
PendingPayment --> PaymentInitiated --> Paid -----------> Delivered
    |                    |               ^
    |                    |               |
    |                    v        (MarkAsPaidManually)
    |              PaymentFailed --------+
    |                    |
    |                    v (retry)
    |              PaymentInitiated
    |                    |
    v                    v
 Cancelled <------- Cancelled
(from PendingPayment, PaymentInitiated, or PaymentFailed)
```

**Terminal States:** Cancelled, Delivered

#### Create Stripe Checkout Session

**Entry Point:** `POST /orders/{id}/checkout` — Authenticated (owner or admin)

```
OrdersController.CreateCheckoutSessionAsync()
  -> CreateCheckoutSessionHandler
    -> Fetch Order with OrderLines
    -> IPaymentService.CreateCheckoutSessionAsync()
      -> StripePaymentService creates Stripe Checkout Session
      -> Converts Money to smallest currency unit (amount * 100)
      -> Sets success/cancel URIs, stores orderId in metadata
      -> Returns sessionId + checkoutUri
    -> order.InitiatePayment(sessionId)
      -> Validates status is PendingPayment or PaymentFailed
      -> Validates order not empty
      -> Sets StripeSessionId, status -> PaymentInitiated
      -> Publishes OrderPaymentInitiated
    -> SaveChangesAsync()
    -> Return sessionId + checkoutUri
```

**External Interaction:** Stripe API — creates payment session with order line items

#### Stripe Payment Webhook

**Entry Point:** `POST /payments/webhook` — AllowAnonymous, `ITransactional`, `ICacheInvalidating`

```
PaymentsController.HandleWebhookAsync()
  -> ProcessPaymentWebhookHandler
    -> IPaymentService.ParseWebhookEvent() (Stripe signature verification)
    -> Route by event type:

      checkout.session.completed:
        -> Find Order by StripeSessionId
        -> Idempotent: if already Paid, return success
        -> order.MarkAsPaid(paymentIntentId)
        -> Status -> Paid, publishes OrderPaid

      checkout.session.expired / payment_intent.payment_failed:
        -> Find Order by StripeSessionId
        -> Idempotent: if already PaymentFailed or Cancelled, return success
        -> order.MarkAsPaymentFailed()
        -> Status -> PaymentFailed, publishes OrderPaymentFailed

      Other events: silently ignored (returns success)
```

**Idempotency:** Already-paid or already-failed orders return success without modification.

**Controller behavior:** Returns 400 only for signature verification failures; returns 200 for all other cases (including handler errors) to prevent Stripe retries.

#### Manual Admin Payment

**Entry Point:** `PUT /orders/{id}/pay` — Admin only

Validates status allows manual payment (PendingPayment, PaymentInitiated, or PaymentFailed). Sets `StripePaymentIntentId = "manual-admin-override"`, status -> Paid. Publishes `OrderPaid`.

#### Deliver Order

**Entry Point:** `PUT /orders/{id}/deliver` — Admin only

Validates status is Paid. Status -> Delivered. Publishes `OrderDelivered`.

#### Cancel Order

**Entry Point:** `PUT /orders/{id}/cancel` — Owner or Admin

```
OrdersController.CancelAsync()
  -> CancelOrderHandler
    -> Fetch Order with OrderLines
    -> order.MarkAsCancelled()
      -> Validates status is PendingPayment, PaymentInitiated, or PaymentFailed
      -> Status -> Cancelled, publishes OrderCancelled
    -> For each OrderLine:
      -> IncreaseInventoryHandler restores stock
      -> Publishes InventoryAdjusted per item
    -> SaveChangesAsync()
```

**Inventory Impact:** All reserved inventory is restored on cancellation.

#### Order Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /orders` | Authenticated | Customers see only own orders (OrdersByCustomerSpecification); admins see all |
| `GET /orders/paged` | Authenticated | Paginated with same ownership filter |
| `GET /orders/{id}` | Authenticated | Single order with optional includes |

---

### 3.4 Inventory Management

| Workflow | Endpoint | Auth | Behavior |
|----------|----------|------|----------|
| Increase | `PUT /inventoryitems/{id}/increaseinventory` | Admin | Adds quantity, validates > 0 |
| Decrease | `PUT /inventoryitems/{id}/decreaseinventory` | Admin | Subtracts, validates sufficient stock |
| Set | `PUT /inventoryitems/{id}/setinventory` | Admin | Absolute set (creates if not exists) |
| Get By ID | `GET /inventoryitems/{id}` | Admin | Single inventory item |

All mutation operations validate product variant exists via `IProductVariantService.ExistsAsync()` and publish `InventoryAdjusted` events when quantity changes.

**Note:** GetAll, GetPaged, and Lookup endpoints are not exposed on the InventoryItems controller (only GetById is overridden).

---

## 4. UI Workflows

### 4.1 Customer Shopping Experience (UI-Side)

The UI provides a complete shopping experience through the CartDrawer component and Blazor pages.

#### Cart Drawer (Sole Cart Interface)

The CartDrawer is the only cart UI — there is no dedicated cart page. It is a 380px right-side temporary drawer accessible from any page via the cart icon in the top app bar.

**Features:**
- View cart items with product name, SKU, and quantity
- Quantity +/- controls per item (when cart is Active)
- Remove individual items (when cart is Active)
- Clear all items
- Checkout & Pay (creates order + Stripe session, redirects to payment)
- "Checked Out" chip display when cart is not Active
- Read-only quantity display when cart is CheckedOut
- "Continue Shopping" navigation to catalog
- Empty cart state with "Browse Products" link

**State Management:** `ICartStateService` singleton manages cart state centrally — all cart operations go through this service which refreshes the cart DTO after each mutation and notifies subscribers via `OnChange` event. Cart items are enriched with product names and SKUs from the Catalog API.

#### Catalog Browse & Product Detail

- `/catalog` — Product grid with name search, category filter, name/newest sort, quick "Add to Cart" per variant
- `/catalog/{id}` — Product detail with breadcrumbs, variant list, quantity selector, "Add to Cart" button, "Buy Now" (direct Stripe checkout)

#### Order Management

- `/orders` — MudDataGrid listing orders with ID, customer, total, status chips, item count
- `/orders/{id}` — Two-column layout: order summary (status, total, payment/delivery actions) + order lines

### 4.2 Admin UI Workflows

| Page | Route | Purpose |
|------|-------|---------|
| Categories | `/categories` | MudDataGrid: CRUD, search, pagination |
| Category Create | `/categories/create` | Form: name, parent category select |
| Category Detail | `/categories/{id}` | View/edit mode, parent link, product list |
| Products | `/products` | MudDataGrid: name, brand, category, variants |
| Product Create | `/products/create` | Form: name, description, brand, category |
| Product Detail | `/products/{id}` | View/edit product, inline variant editor (add/edit/delete) |
| Inventory | `/inventory` | MudDataGrid: product name, SKU, quantity, in-stock |
| Inventory Create | `/inventory/create` | Initialize new inventory item |
| Inventory Detail | `/inventory/{id}` | Edit inventory quantity |
| Shopping Carts | `/shoppingcarts` | MudDataGrid: customer, items count, status |
| Cart Detail | `/shoppingcarts/{id}` | Admin cart view with add/remove/clear/checkout |
| Customers | `/customers` | MudDataGrid: name, email, delete |
| Customer Create | `/customers/create` | Customer creation form |
| Customer Detail | `/customers/{id}` | Customer view/edit |

### 4.3 User Profile & Auth

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Email/password form, link to register |
| Register | `/register` | Name, email, password, optional address |
| Profile | `/profile` | Edit name, address, change password |

### 4.4 Navigation Structure

**Sidebar Navigation** (role-based, dynamically populated from `IUIModule` registrations):

**Customer:**
- Home (`/`)
- Shop (`/catalog`)
- My Orders (`/orders`)
- My Profile (`/profile`)

**Admin:**
- Home (`/`)
- Categories (`/categories`)
- Products (`/products`)
- Inventory (`/inventory`)
- Shopping Carts (`/shoppingcarts`)
- Orders (`/orders`)
- Customers (`/customers`)
- My Profile (`/profile`)

**Top App Bar:**
- Shopping cart icon with badge (authenticated, opens CartDrawer)
- User email display
- Logout button (authenticated)
- Login / Register buttons (anonymous)

---

## 5. Cross-Module Interactions

| From -> To | Interface | Methods Used | Context |
|-----------|-----------|-------------|---------|
| Sales -> Catalog | `IProductVariantService` | `ExistsAsync()` | Cart item validation, inventory creation |
| Sales -> Catalog | `IProductVariantService` | `GetUnitPricesAsync()` | Checkout pricing |
| Sales -> Catalog | `IProductVariantService` | `SkuExistsAsync()` | SKU uniqueness (Catalog internal) |
| Sales -> Catalog | `IProductVariantService` | `GetIdBySkuAsync()` | Seed data inventory setup |
| Identity (event) | Domain Event | `UserRegisteredHandler` | Auto-creates Customer on registration |

**Module dependency:** Sales declares a hard dependency on Catalog (`RequiresDependencies = true`). When Catalog is disabled, a `DisabledProductVariantService` stub is registered and Sales will fail to start.

---

## 6. External Interactions

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| **Stripe** | Payment processing | `StripePaymentService` — creates checkout sessions, handles webhooks |
| **SQL Server** | Primary persistence | Via EF Core + Aspire container orchestration |
| **SQLite / Cosmos DB** | Alternative persistence | Configurable via `IDbContextFactory` strategy |
| **SMTP** | Email infrastructure | `SmtpEmailSender` — infrastructure exists but no domain event handlers trigger emails |

---

## 7. Cross-Cutting Concerns Participating in Workflows

| Concern | Implementation | Impact |
|---------|---------------|--------|
| **Transactions** | `ITransactional` marker -> `TransactionalCommandDecorator` wraps in DB transaction | Checkout, webhook processing |
| **Cache Invalidation** | `ICacheInvalidating` marker -> `CachingCommandDecorator` clears cache by prefix | All mutation commands |
| **Idempotency** | `[Idempotent]` attribute -> `IdempotencyFilter` caches response by `Idempotency-Key` header for 24h with per-key locking | All Create (POST) endpoints |
| **Authorization** | `OwnerOrAdminFilter` on cart/order endpoints | Customers access only own data |
| **Rate Limiting** | FixedWindow: 100 req/min, queue 2, oldest-first | All API endpoints |
| **Exception Handling** | Middleware chain: Domain -> Validation -> DbUpdate -> OperationCanceled -> Global | Maps errors to HTTP status codes |
| **Profiling** | `ProfilingCommandDecorator` / `ProfilingQueryDecorator` via MiniProfiler | All handlers when `UseMiniProfiler=true` |
| **API Versioning** | Header-based via `api-version` header, all controllers declare `[ApiVersion("1.0")]` | All endpoints |

---

## 8. End-to-End Customer Journey

```
1. Register          POST /auth/register        -> User + Customer created, tokens issued
2. Browse Catalog    GET /products               -> View products with variants and prices
3. Add to Cart       POST /shoppingcarts/{id}/shoppingcartitems  -> Cart created/updated
4. Adjust Cart       PUT/DELETE cart items        -> Modify quantities or remove items
5. Checkout          PUT /shoppingcarts/{id}/checkout  -> Order created, inventory reserved
6. Pay               POST /orders/{id}/checkout   -> Stripe session created, redirect to payment
7. Payment Complete  POST /payments/webhook        -> Stripe confirms, order marked Paid
8. Delivery          PUT /orders/{id}/deliver      -> Admin marks as Delivered
```

**Alternative Flows:**

- Payment fails -> Order status `PaymentFailed` -> customer can retry (create new Stripe session)
- Cancel order -> Status `Cancelled` (from PendingPayment, PaymentInitiated, or PaymentFailed) -> inventory restored
- Cart reactivation -> Checked-out cart auto-reactivated on next add-item (all old items cleared)
- Manual payment -> Admin bypasses Stripe, sets `StripePaymentIntentId = "manual-admin-override"`

---

## 9. Potentially Missing or Incomplete Workflows

| Observation | Evidence | Recommendation |
|-------------|----------|----------------|
| **No refund workflow** | Order can be cancelled only before payment completes (PendingPayment/PaymentInitiated/PaymentFailed); no refund logic for Paid orders | Verify if refunds are handled externally via Stripe dashboard or if a refund workflow is planned |
| **No order editing** | Once checkout completes, order lines cannot be modified | Confirm if this is intentional or if order amendment is planned |
| **No email notifications** | `SmtpEmailSender` infrastructure exists but no domain event handlers trigger email sending | Verify if notifications are planned (order confirmation, shipment, etc.) |
| **No full-text search** | Catalog browse offers a name-contains search box (E2E-covered); there is no full-text/fuzzy search | Consider full-text search for larger catalogs |
| **Inventory not checked during cart add** | Inventory validation only happens at checkout, not when adding to cart | Could lead to poor UX if items go out of stock between add and checkout |
| **No post-payment cancellation** | Cancellation allowed from PendingPayment, PaymentInitiated, or PaymentFailed — cannot cancel after payment succeeds | Verify if post-payment cancellation with Stripe refund is needed |
| **No customer deactivation endpoint** | `User.Deactivate()` method and `UserDeactivated` event exist in domain but no API endpoint exposes this | May be an admin feature not yet implemented |
| **Category deletion has no cascade check** | Deleting a category doesn't check for assigned products | Products with deleted category may have orphaned CategoryId |
| **No InventoryItem list endpoint** | InventoryItemsController only exposes GetById, not GetAll/GetPaged | UI InventoryItemList page likely fetches data through a different mechanism or needs this endpoint |
| **No partial fulfillment** | Orders are delivered as a whole — no concept of partial shipments or split deliveries | Clarify if partial fulfillment is a future requirement |
| **No delivery tracking** | `MarkAsDelivered` is a binary admin action with no tracking number, carrier, or ETA | Consider whether shipping/tracking details are needed |

---

*This document is derived from source code analysis. All workflows, decisions, and behaviors described above are confirmed implementations traceable to the referenced source files. Last updated: 2026-03-18.*
