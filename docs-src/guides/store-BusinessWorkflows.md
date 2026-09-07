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
| 38 | Bulk Set Inventory | `PUT /inventoryitems/bulk-setinventory` | Sales |
| 39 | Verify Payment (webhook backstop) | `PUT /orders/{id}/verify-payment` | Sales |
| 40 | Upload Product Image | `POST /products/{productId}/images` | Catalog |
| 41 | Delete Product Image | `DELETE /products/{productId}/images/{imageId}` | Catalog |
| 42 | Reorder Product Images | `PUT /products/{productId}/images/order` | Catalog |
| 43 | Read Product Image | `GET /products/{productId}/images/{imageId}` | Catalog |
| 44 | Change UI Preferences | `PUT /auth/preferences` | Identity |
| 45 | Export Personal Data | `GET /users/{userId}/export` | Identity |
| 46 | Erase User Account | `DELETE /users/{userId}` | Identity |
| 47 | Ship Order | `PUT /orders/{id}/ship` | Sales |
| 48 | Correct Shipment | `PUT /orders/{id}/shipment` | Sales |
| 49 | Submit Product Review | `POST /reviews/by-product/{productId}` | Catalog |
| 50 | Revise Product Review | `PUT /reviews/{id}` | Catalog |
| 51 | Withdraw Product Review | `DELETE /reviews/{id}` | Catalog |
| 52 | Hide Product Review | `PUT /reviews/{id}/hide` | Catalog |
| 53 | Unhide Product Review | `PUT /reviews/{id}/unhide` | Catalog |
| 54 | Set Variant Discount | `PUT /products/{id}/productvariants/{variantId}/discount` | Catalog |
| 55 | Clear Variant Discount | `DELETE /products/{id}/productvariants/{variantId}/discount` | Catalog |
| 56 | Discount All Variants | `PUT /products/{id}/discount` | Catalog |

---

## 1. Identity Module Workflows

### 1.1 User Registration

**Entry Point:** `POST /auth/register`, `AuthController.RegisterAsync()`, AllowAnonymous

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
5. Persist user: triggers `UserRegistered` domain event
6. Domain event handler creates Customer profile and links it to User
7. Generate access token (15 min, JWT with claims: sub, jti, iat, user_id, email, role, customer_id) + refresh token (7 days, 64-byte random)
8. Return authentication response with tokens

**Decision Points:**

- Email already exists -> Conflict error
- Role="Admin" -> no Customer profile created; Role="Customer" -> Customer auto-created

**State Changes:**

- Creates `User` (Active, with RefreshToken and RefreshTokenExpiry)
- Creates `Customer` (linked via User.CustomerId)

**Domain Events:** `UserRegistered` -> `UserRegisteredHandler` creates the linked `Customer`, which raises `CustomerChanged` with the `Added` state

---

### 1.2 User Login

**Entry Point:** `POST /auth/login`, `AuthController.LoginAsync()`, AllowAnonymous

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

**Entry Point:** `POST /auth/refresh`, AllowAnonymous

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

**Entry Point:** `POST /auth/revoke`, Requires Authorization

**Business Steps:** Clears `User.RefreshToken` and `User.RefreshTokenExpiry` to null.

---

### 1.5 Change Password

**Entry Point:** `PUT /auth/password`, Requires Authorization

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
| Change Name | `PUT /customers/{id}/name` | `Customer.ChangeName()` | `CustomerChanged` (`Updated`) |
| Change Address | `PUT /customers/{id}/address` | `Customer.ChangeAddress()` | `CustomerChanged` (`Updated`) |
| Change Email | `PUT /customers/{id}/email` | `Customer.ChangeEmail()` | `CustomerChanged` (`Updated`) |

Email change includes uniqueness check across customers.

### 1.7 Customer CRUD (Admin)

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Create Customer | `POST /customers` | Admin | Idempotent via `[Idempotent]` attribute |
| Delete Customer | `DELETE /customers/{id}` | Admin | Soft delete (IsDeleted=true), raises `CustomerChanged` with the `Deleted` state |
| Get Customer | `GET /customers/{id}` | Authenticated | Owner or admin |
| List Customers | `GET /customers` | Admin | All customers |
| List Customers (paged) | `GET /customers/paged` | Admin | Paged |
| Customer Lookup | `GET /customers/lookup` | Admin | Id/name pairs for pickers |

The controller is `[Authorize(RequireAuthenticated)]` with the collection reads and the create/delete
actions individually raised to `[Authorize(RequireAdmin)]`.

### 1.8 UI Preferences

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Read preferences | `GET /auth/preferences` | Authenticated | Stored UI culture/theme, read at login so the choice follows the account across devices |
| Change preferences | `PUT /auth/preferences` | Authenticated | Persists culture ([ADR-027](../adr/027-multi-locale-i18n.md)) and theme ([ADR-028](../adr/028-dark-theme-mode.md)) |

### 1.9 Data Subject Rights (GDPR/CCPA)

Both endpoints authorize the account owner **or** an Admin, enforced in the handlers rather than by a
controller-wide policy ([ADR-005](../adr/005-soft-delete-vs-erasure.md)).

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Export personal data | `GET /users/{userId}/export` | Owner or Admin | Portable JSON of the personal data held for the user (access/portability) |
| Erase account | `DELETE /users/{userId}` | Owner or Admin | Deletes the account and irreversibly anonymizes its personal data; distinct from the soft-delete used for ordinary lifecycle |

---

## 2. Catalog Module Workflows

### 2.1 Category Management

#### Create Category

**Entry Point:** `POST /categories`, Admin only, `[Idempotent]`

```
CategoriesController.CreateAsync()
  -> CreateCategoryHandler
    -> CategoryCreateRequestValidator (name: required, max 255)
    -> Category.Create(id, name, parentCategoryId?) -> raises CategoryChanged (Added)
    -> Repository.AddAsync() + SaveChangesAsync()
```

**Response:** 201 Created with `CategoryDTO`

#### Rename Category

**Entry Point:** `PUT /categories/{id}/name`, Admin only

```
CategoriesController.RenameAsync()
  -> RenameCategoryHandler
    -> Validate name (max 255)
    -> Fetch category -> category.Rename(name)
    -> Only updates if name differs (case-insensitive comparison)
    -> Raises CategoryChanged (Updated) if changed
    -> Cache invalidation
```

#### Assign Parent Category

**Entry Point:** `PUT /categories/{id}/parentcategory`, Admin only

Sets or clears `ParentCategoryId` to establish hierarchy. No domain event raised.

#### Delete Category

**Entry Point:** `DELETE /categories/{id}`, Admin only

Soft delete (`IsDeleted=true`). Raises `CategoryChanged` with the `Deleted` state.

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

**Entry Point:** `POST /products`, Admin only, `[Idempotent]`

```
ProductsController.CreateAsync()
  -> CreateProductHandler
    -> Validate: name (required, max 100), description (max 4000), brand (max 100, no whitespace if provided)
    -> Product.Create() factory -> raises ProductChanged (Added)
    -> Repository.AddAsync() + SaveChangesAsync()
```

#### Update Operations

| Workflow | Endpoint | Validation | Event |
|----------|----------|-----------|-------|
| Rename | `PUT /products/{id}/name` | Max 100, required | `ProductChanged` (`Updated`) plus the `ProductInfoChanged` integration event (`Updated`) |
| Change Description | `PUT /products/{id}/description` | Max 4000, nullable | None |
| Change Brand | `PUT /products/{id}/brand` | Max 100, no whitespace | None |
| Assign Category | `PUT /products/{id}/category` | Nullable FK | None |

#### Delete Product

**Entry Point:** `DELETE /products/{id}`, Admin only. Soft delete, raises `ProductChanged` with the `Deleted` state plus the `ProductInfoChanged` integration event (`Deleted`).

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /products` | AllowAnonymous | Returns all products (capped at MaxPageSize) |
| `GET /products/paged` | AllowAnonymous | Paginated with filters, sorting, field projection |
| `GET /products/lookup` | AllowAnonymous | Returns ID + name pairs for dropdowns |
| `GET /products/variant-lookup` | AllowAnonymous | Returns `ProductVariantCartInfoDTO` rows: the variant detail the cart UI needs without a per-variant round trip |
| `GET /products/{id}` | AllowAnonymous | Single product with optional FK/children includes |

---

### 2.3 Product Variant Management

#### Add Product Variant

**Entry Point:** `POST /products/{id}/productvariants`, Admin only

```
ProductVariantsController.CreateAsync()
  -> AddVariantHandler
    -> Validate: SKU (max 50), Price (positive Money)
    -> IProductVariantService.SkuExistsAsync() -> global SKU uniqueness check
    -> Fetch Product with variants
    -> product.AddProductVariant(variantId, sku, price)
      -> ProductVariant.Create() validates price not negative
      -> Raises no Catalog domain event
    -> SaveChangesAsync()
    -> IEventBus.PublishAsync(ProductVariantChanged, Added) after the commit
```

**Cross-Module:** SKU uniqueness checked via `IProductVariantService`

#### Change Variant SKU

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/sku`, Admin only

SKU uniqueness verified globally (excluding current variant). Raises the `ProductVariantChanged` integration event with the `Updated` state if changed.

#### Change Variant Price

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/price`, Admin only

Price must be positive. Raises the `ProductVariantChanged` integration event with the `Updated` state if changed. The price edited here is
the LIST price. A variant that carries a discount re-validates it against the new price and the
change is refused when the pair would be inconsistent (a special price no longer below the list
price, or a percentage leaving nothing), so the discount is cleared first.

#### Set Variant Discount

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/discount`, `catalog:pricing:manage`

```
ProductVariantsController.SetDiscountAsync()
  -> SetProductVariantDiscountCommand (If-Match product ETag + VariantRowVersion in the body)
    -> VariantDiscountRules validates kind, percentage, special price, window order, label
    -> ProductVariantSetDiscountRequest.ToDiscount()
      -> VariantDiscount.CreatePercentage() / CreateSpecialPrice() -> Result<VariantDiscount>
    -> product.SetProductVariantDiscount(variantId, discount)
      -> ProductVariant.SetDiscount() runs VariantDiscount.ApplyTo(Price) first
      -> Publishes ProductVariantChanged (Updated) with the LIST price
    -> SaveChangesAsync()
  -> Evicts the catalog:products output-cache tag
```

Replaces any discount already on the variant. Returns 204; 400 on a broken invariant, 404 on an
unknown product or variant, 412 on a stale ETag, 428 when `If-Match` is missing
([ADR-035](../adr/035-optimistic-concurrency.md) two-token rule: the header carries the product's
ETag, the body carries the variant's row version).

#### Clear Variant Discount

**Entry Point:** `DELETE /products/{id}/productvariants/{variantId}/discount`, `catalog:pricing:manage`

Returns the variant to its list price, which was never rewritten, so there is nothing to restore.
Clearing a variant that carries no discount changes nothing, so clearing twice is safe. Publishes
`ProductVariantChanged` (Updated) and evicts the `catalog:products` tag. The body carries only the
variant's row version; the status codes match the set action.

#### Discount All Variants

**Entry Point:** `PUT /products/{id}/discount`, `catalog:pricing:manage`

```
ProductsController.SetDiscountAsync()
  -> SetProductDiscountCommand (If-Match product ETag)
    -> ProductSetDiscountRequest.ToDiscount() -> Result<VariantDiscount>
    -> product.SetDiscountOnAllVariants(discount)
      -> ApplyTo() is checked against EVERY active variant's list price FIRST
      -> All-or-nothing: one refusal leaves the product exactly as it was
      -> Publishes one ProductVariantChanged (Updated) per variant, each with its LIST price
    -> SaveChangesAsync()
  -> Evicts the catalog:products output-cache tag
```

A product whose variants are priced differently either takes the promotion whole or is left
untouched, so a half-discounted catalog page is not reachable.

#### Remove Product Variant

**Entry Point:** `DELETE /products/{id}/productvariants/{variantId}`, Admin only

Soft delete on variant. Raises the `ProductVariantChanged` integration event with the `Deleted` state.

### 2.4 Product Image Management

Behind the `CatalogFeatures.ProductImages` feature gate ([ADR-031](../adr/031-feature-flag-management.md)).
Image binaries live as rows in the Catalog database (`ProductImageData`), not in managed blob storage:
[ADR-045](../adr/045-managed-file-storage-and-avatars.md) is the MMCA.ADC avatar amendment and is not
adopted here, which is why the output cache below exists. Mutations require Admin;
retrieval is anonymous and output-cached for 300 seconds to keep repeated BLOB reads off the database.

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Read primary image | `GET /products/{id}/image` | Anonymous | Lowest display order; 300s response + output cache |
| Read image by id | `GET /products/{productId}/images/{imageId}` | Anonymous | Same caching |
| Upload image | `POST /products/{productId}/images` | Admin | 201 Created with `ProductImageDTO` and a Location header; 6 MB request limit covering the 5 MB domain constraint plus multipart overhead |
| Upload image (legacy) | `PUT /products/{id}/image` | Admin | The pre-collection single-image route, kept for backward compatibility; same handler as the POST above |
| Delete primary image | `DELETE /products/{id}/image` | Admin | Legacy single-image route |
| Delete image by id | `DELETE /products/{productId}/images/{imageId}` | Admin | Collection route |
| Reorder images | `PUT /products/{productId}/images/order` | Admin | Reassigns display order from the supplied id list; the first id becomes the primary image (order 0) |

Every mutation evicts the products cache so the next read reflects the change.

---

### 2.5 Product Reviews

#### Earn the Entitlement (OrderFulfilled -> VerifiedPurchase)

**Entry Point:** the `Sales.OrderFulfilled.v1` integration event, consumed by
`OrderFulfilledHandler` in its own DI scope. No HTTP surface: nothing else in the system creates a
verified purchase.

```
Sales: order.MarkAsDelivered()
  -> raises OrderDelivered (in-process) AND OrderFulfilled (integration, line snapshot)
  -> stamps Order.FulfilledPublishedOn in the same unit of work
  -> outbox row commits with the order write, then ships to the broker

Catalog: OrderFulfilledHandler
  -> resolve the event's variant ids to product ids in ONE projection
     (soft-deleted variants are not resolved: a delisted product stays unreviewable)
  -> de-duplicate: two sizes of the same shirt are one entitlement
  -> read the order's existing entitlement rows (first idempotency guard)
  -> VerifiedPurchase.Create() for each missing product, one SaveChangesAsync
```

**Idempotency:** twice over. The existing-rows read means a redelivered event inserts nothing, and the
unique `(OrderId, ProductId)` index is the backstop for two deliveries racing. Deliveries are
at-least-once, so both halves are load-bearing. A variant that does not resolve is logged and skipped
rather than thrown, because a redelivery would fail on it identically forever and take the customer's
other entitlements down with it.

**Backfill:** `OrderFulfilledBackfillService` publishes the event on startup for orders delivered
before it existed, selecting only Delivered orders whose `FulfilledPublishedOn` is still null. Bounded
per run and settings-gated (`OrderFulfilledBackfill:Enabled`).

#### Submit Review

**Entry Point:** `POST /reviews/by-product/{productId}`, authenticated customer, `[Idempotent]`

```
ReviewsController.SubmitAsync()
  -> resolve the caller: customer_id claim (fail closed with 403 when absent, admins not exempt)
  -> reviewer display name read from the token's name claim, never from the body
  -> SubmitReviewHandler
    -> VerifiedPurchase for (customer, product)?  no -> Review.NotVerifiedPurchase
    -> existing review by this customer for this product?  yes -> Review.AlreadyReviewed
    -> entitling order = lowest matching OrderId (the earliest entitlement)
    -> ProductReview.Create() -> validates rating 1..5, title <= 120, body <= 2000
       -> raises ProductReviewChanged (Added), status Published
    -> AddAsync + SaveChangesAsync
  -> evict the catalog:products output-cache tag

  (then, after commit)
  -> ProductReviewChangedHandler [own DI scope]
    -> recompute AVG/COUNT over the product's published, non-deleted reviews
    -> Product.UpdateRatingSummary(), written only when the summary actually differs
```

**Response:** 200 OK with `ProductReviewDTO`

#### Revise / Withdraw Review

**Entry Point:** `PUT /reviews/{id}` and `DELETE /reviews/{id}`, owner or Admin

Ownership is checked in the controller and a non-owner is answered **404, not 403**, so the existence
of another customer's review id cannot be probed for. The revise path is conditional
([ADR-035](../adr/035-optimistic-concurrency.md)): the `If-Match` header is mandatory and an edit
decided against a stale view answers 412. The delete is unconditional (soft delete; a delete has no
field to lose to a concurrent edit). Both raise `ProductReviewChanged`, so the rating summary is
recomputed either way. The frozen `ReviewerName` is deliberately not revisable.

#### Hide / Unhide Review (Moderation)

**Entry Point:** `PUT /reviews/{id}/hide`, `PUT /reviews/{id}/unhide`, `catalog:reviews:moderate`

Both are idempotent at the aggregate (a review already in the target status succeeds without raising a
second event) and conditional on the same `If-Match` terms, so two moderators working from the same
stale list cannot silently overwrite each other. A hidden review leaves the public list and drops out
of the product's rating summary; the moderation list still shows it.

#### Erasure

`CustomerErasedHandler` consumes Identity's `CustomerErased.v1` and anonymizes every review that
customer wrote, hidden and soft-deleted rows included: name, title and body cleared, star rating kept
([ADR-005](../adr/005-soft-delete-vs-erasure.md)). Only rows that still carry personal data are
loaded, so a redelivery finds nothing to do and churns no audit fields.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /reviews/by-product/{productId}/paged` | Anonymous | Published reviews only, whoever asks, newest first; output-cached under the shared `ProductsCache` policy, which caches regardless of auth state (a role-varying response would be served to the wrong caller) |
| `GET /reviews/by-product/{productId}/mine` | Authenticated customer | `HasPurchased` and `CanReview` as separate booleans, plus the caller's own review; the pair is what lets the UI tell "never bought it" apart from "already had their say" |
| `GET /reviews/paged` | `catalog:reviews:moderate` | Every review whatever its status, filterable and sortable; never cached |

Page sizes are capped server-side at 100. Every mutation evicts the `catalog:products` output-cache
tag as well as invalidating the application cache, because a review moves the stars the product reads
carry.

---

## 3. Sales Module Workflows

### 3.1 Shopping Cart

#### Add Item to Cart

**Entry Point:** `POST /shoppingcarts/{customerId}/shoppingcartitems`, Authenticated (owner or admin via `OwnerOrAdminFilter`)

```
ShoppingCartsController.CreateShoppingCartItemAsync()
  -> AddItemHandler
    -> Validate quantity > 0
    -> IProductVariantService.ExistsAsync() [cross-module: Catalog]
    -> Fetch ShoppingCart by CustomerId
    -> If no cart exists -> ShoppingCart.Create(customerId) -> ShoppingCartChanged (Added)
    -> If cart is CheckedOut -> shoppingCart.Reactivate() (clears items, resets to Active)
    -> shoppingCart.AddShoppingCartItem(variantId, quantity)
      -> If item already in cart -> IncreaseQuantity -> ShoppingCartItemChanged (Updated)
      -> If new item -> ShoppingCartItem.Create() -> ShoppingCartItemChanged (Added)
    -> SaveChangesAsync()
```

**Decision Points:**

- Product variant doesn't exist -> NotFound
- Quantity not positive -> Invariant error
- Cart checked out -> auto-reactivated (all old items cleared)

#### Change Item Quantity

**Entry Point:** `PUT /shoppingcarts/{id}/shoppingcartitems/{variantId}/quantity`

Validates cart is Active, item exists, quantity > 0. Raises `ShoppingCartItemChanged` with the `Updated` state, carrying the old and new quantity.

#### Remove Item

**Entry Point:** `DELETE /shoppingcarts/{id}/shoppingcartitems/{variantId}`

Validates cart is Active. Soft-deletes item. Raises `ShoppingCartItemChanged` with the `Deleted` state.

#### Clear Cart

**Entry Point:** `PUT /shoppingcarts/{id}/clear`

Deletes all items. Raises `ShoppingCartChanged` with the `Updated` state.

#### Cart Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /shoppingcarts/{id}` | Authenticated + OwnerOrAdmin | The customer's cart with optional children (items). Returns an empty DTO (not 404) when no cart exists yet (lazy cart pattern) |
| `GET /shoppingcarts` | Authenticated | Row-scoped by the ownership specification: a customer sees only their own cart, an admin sees every cart ([ADR-033](../adr/033-resource-ownership-authorization.md)) |
| `GET /shoppingcarts/paged` | Authenticated | Paged, same row-scoping |
| `GET /shoppingcarts/lookup` | Admin | Id/name pairs for pickers |

Ownership on the collection reads is enforced **in the query**, not against a route value: there is no
owner parameter to compare, so the specification narrows the rows before they are read.

#### Shopping Cart Status State Machine

```
Active --(MarkAsCheckedOut)--> CheckedOut
  ^                                |
  +----(Reactivate on AddItem)-----+
        (clears all items)
```

---

### 3.2 Checkout (Cart to Order): Primary Business Workflow

**Entry Point:** `PUT /shoppingcarts/{customerId}/checkout`, authenticated, marked `ICacheInvalidating`.
`CheckOutCommand` is **deliberately NOT `ITransactional`** (`CheckOutCommand.cs:9`): the handler opens its
own transaction around the write phase only, so the cross-module price fetch never holds database locks.

```
ShoppingCartsController.CheckOutAsync()
  -> CheckOutHandler
    -> Fetch ShoppingCart with items (tracking)
    -> Collect productVariantIds from cart items
    -> IProductVariantService.GetUnitPricesAsync(ids) [cross-module: Catalog, OUTSIDE the transaction]
    -> Reject any variant missing from the price map (soft-deleted between add and checkout)
    -> Fetch InventoryItems for all variants
    -> CheckOutDomainService.Execute():
        1. Validate cart not empty
        2. Validate inventory exists for all items
        3. Fail-fast sufficiency check per item against the point-in-time snapshot
           (NOT the oversell guard: that is the atomic decrement below)
        4. Build order items (variant + price + quantity)
        5. Order.Create(customerId, items) -> raises OrderChanged (Added)
        6. shoppingCart.MarkAsCheckedOut() -> publishes ShoppingCartCheckedOut
    -> orderRepository.AddAsync(order)
    -> unitOfWork.ExecuteInTransactionAsync:            <-- the whole write phase, one transaction
         -> IInventoryAllocationService.DecrementAsync(decrements)
              atomic conditional UPDATE per variant (ExecuteUpdateAsync); a row that no longer has
              enough stock matches zero rows and fails the Result, rolling the transaction back
         -> unitOfWork.SaveChangesAsync()               <-- order insert + cart transition
    -> Return OrderDTO
```

**Business Steps:**

1. Validate cart exists and has items
2. Fetch current prices from Catalog module, and reject variants that no longer exist
3. Fail-fast inventory sufficiency check against the loaded snapshot
4. Create Order aggregate with OrderLines (price snapshot at time of purchase)
5. Transition cart to CheckedOut status
6. Commit the write phase in one explicit transaction: atomic inventory decrements, then the order
   insert and cart transition

**Decision Points:**

- Cart empty -> Validation error
- Product variant no longer exists in Catalog -> `ProductVariant.NotFound`, naming the offending variant
- Insufficient inventory at snapshot time -> Invariant error (fail-fast)
- Insufficient inventory at commit time -> the conditional UPDATE matches no row, the transaction rolls back
- Inventory record missing -> NotFound (specific missing variant ID reported)

**State Changes:**

- Creates `Order` (status: PendingPayment) with `OrderLine` children
- Decrements `InventoryItem.AvailableQuantity` for each item
- `ShoppingCart.Status` -> CheckedOut

**Domain Events:** `OrderChanged` (`Added`), `ShoppingCartCheckedOut`.

> **No `InventoryAdjusted` on the checkout path.** The decrement runs as `ExecuteUpdateAsync`, which
> bypasses the save pipeline (and therefore the audit interceptor and domain-event dispatch) by design:
> that is what makes it a single atomic statement and the real oversell guard. `InventoryAdjusted` is
> still raised by the admin adjustment endpoints in 3.4, which go through the aggregate.

---

### 3.3 Order Lifecycle

#### Order Status State Machine

```
                    +------------------------------------------+
                    |                                          |
                    v                                          |
PendingPayment --> PaymentInitiated --> Paid --> Shipped --> Delivered
    |                    |               ^  |                   ^
    |                    |               |  +-------------------+
    |                    v        (MarkAsPaidManually)  (no carrier leg)
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

`Shipped` is an optional stop, not a mandatory one: a fulfilment with no tracking to record still goes
Paid -> Delivered directly, which is why Paid keeps both outgoing edges. Cancellation is refused from
Shipped exactly as it is from Paid. `UpdateShipment` is a self-transition on Shipped. The enum's
numeric values are persisted and travel on the `user_sales_export` gRPC contract, so `Shipped` is
appended LAST in `OrderStatus` even though it sits mid-lifecycle.

#### Create Stripe Checkout Session

**Entry Point:** `POST /orders/{id}/checkout`, Authenticated (owner or admin)

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

**External Interaction:** Stripe API: creates payment session with order line items

#### Stripe Payment Webhook

**Entry Point:** `POST /payments/webhook`, AllowAnonymous, `ITransactional`, `ICacheInvalidating`

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

**Entry Point:** `PUT /orders/{id}/pay`, Admin only

Validates status allows manual payment (PendingPayment, PaymentInitiated, or PaymentFailed). Sets `StripePaymentIntentId = "manual-admin-override"`, status -> Paid. Publishes `OrderPaid`.

#### Verify Payment (webhook backstop)

**Entry Point:** `PUT /orders/{id}/verify-payment`, owner or Admin (ownership validated in the controller)

Polls Stripe directly for the order's checkout session instead of waiting on a webhook, for the case
where webhook delivery failed or is delayed. If Stripe reports the session paid, the order is marked
Paid exactly as the webhook would have marked it; if the order is already Paid or is not in a
verifiable state, the call succeeds without changes. This is the reconciliation half of
[ADR-054](../adr/054-saga-compensation-and-reconciliation.md): the webhook is the fast path, this is
the backstop that keeps a paid customer from sitting in `PaymentInitiated` forever.

#### Ship Order

**Entry Point:** `PUT /orders/{id}/ship`, `sales:orders:manage`, mandatory `If-Match`

```
OrdersController.ShipAsync()
  -> ShipOrderHandler
    -> Shipment.Create(carrier, trackingNumber, shippedOn, estimatedDeliveryOn?, trackingUrl?)
       -> tracking number required, max 100; shippedOn normalized to UTC
       -> estimated delivery cannot precede the ship date (same day allowed)
       -> a caller-supplied https tracking URL is accepted ONLY for carrier Other
    -> order.Ship(shipment)
       -> validates status is Paid  (Shipped/Delivered/Cancelled refuse)
       -> sets Shipment, status -> Shipped, raises OrderShipped
    -> SaveChangesAsync()

  (then, after commit)
  -> OrderShippedHandler [own DI scope]
    -> ICustomerService.GetContactInfoByIdAsync() for the address
    -> IEmailSender: carrier, tracking number, tracking link, dates
    -> send failures are logged, never fatal: the transition is already committed
```

The tracking link is **computed** from the carrier's own template plus the tracking number for UPS,
FedEx, USPS and DHL, so the URL is written down in exactly one place and the client renders whatever
arrives rather than rebuilding a carrier URL of its own. Only `Carrier.Other` carries a stored URL.

**Response:** 204 No Content. 412 when the `If-Match` token is stale, 428 when the header is absent.

#### Correct Shipment

**Entry Point:** `PUT /orders/{id}/shipment`, `sales:orders:manage`, mandatory `If-Match`

Same request body as `ship`, because the shipment is a value object and a correction replaces it whole
rather than patching a field. Allowed from Shipped only; the status does not move, and `OrderShipped`
is raised again on purpose so a customer who was told the wrong tracking number gets the right one
(the notification is a re-send, not a duplicate). Kept as a separate endpoint from `ship` deliberately:
`ship` must refuse an already-shipped order and this one must refuse an order that never shipped, so
folding them together would make "silently re-ship" indistinguishable from "fix the tracking number".

#### Deliver Order

**Entry Point:** `PUT /orders/{id}/deliver`, `sales:orders:manage`, mandatory `If-Match`

Validates status is Paid **or** Shipped. Status -> Delivered, `FulfilledPublishedOn` stamped in the
same unit of work. Raises two events: the in-process `OrderDelivered`, and the `OrderFulfilled`
integration event carrying the delivered line snapshot, which Catalog turns into the verified-purchase
entitlements behind product reviews (Section 2.5). The snapshot travels on the event because the
consumer lives in another service and cannot query back ([ADR-006](../adr/006-database-per-service.md)),
which is also why callers load `OrderLines` with the aggregate.

The admin order grid searches tracking numbers: the filter name `ShipmentTrackingNumber` maps to the
scalar column the owned shipment flattens onto, so it is one server-side CONTAINS rather than a client
scan.

#### Cancel Order

**Entry Point:** `PUT /orders/{id}/cancel`, Owner or Admin

```
OrdersController.CancelAsync()
  -> CancelOrderHandler
    -> Fetch Order with OrderLines
    -> order.MarkAsCancelled()
      -> Validates status is PendingPayment, PaymentInitiated, or PaymentFailed
      -> Status -> Cancelled, publishes OrderCancelled
    -> SaveChangesAsync()          <-- cancellation commits here; no inventory work inline

  (then, after commit)
  -> OrderCancelledSagaHandler  [ADR-054 compensating action, own DI scope]
    -> Skip if order.InventoryRestored is already set (idempotent under redelivery)
    -> Restore stock for each OrderLine
    -> order.MarkInventoryRestored()
    -> ONE SaveChangesAsync commits the marker and the inventory increases together
```

**Inventory Impact:** All reserved inventory is restored on cancellation, by a **compensating handler
that runs after** the cancellation transaction, not inside it ([ADR-054](../adr/054-saga-compensation-and-reconciliation.md)).
`Order.InventoryRestored` is the idempotency marker, committed by the same `SaveChangesAsync` as the
restoration, so an at-least-once redelivery cannot double-restore; the order's rowversion token makes
two concurrent deliveries mutually exclusive. The sibling `OrderPaymentFailedSagaHandler` compensates
the payment-failure path the same way. Splitting compensation out of `CancelOrderHandler` is what lets
further compensating actions (refund, notification) be added as new handlers rather than edits.

#### Order Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /orders` | Authenticated | Customers see only own orders (OrdersByCustomerSpecification); admins see all |
| `GET /orders/paged` | Authenticated | Paginated with same ownership filter |
| `GET /orders/{id}` | Authenticated | Single order with optional includes |
| `GET /orders/lookup` | Authenticated | Id/name pairs for pickers, same ownership filter |

---

### 3.4 Inventory Management

| Workflow | Endpoint | Auth | Behavior |
|----------|----------|------|----------|
| Increase | `PUT /inventoryitems/{id}/increaseinventory` | Admin | Adds quantity, validates > 0 |
| Decrease | `PUT /inventoryitems/{id}/decreaseinventory` | Admin | Subtracts, validates sufficient stock |
| Set | `PUT /inventoryitems/{id}/setinventory` | Admin | Absolute set (creates if not exists) |
| Bulk set | `PUT /inventoryitems/bulk-setinventory` | Admin | Sets inventory for many variants in one transaction, creating the ones that do not exist; returns a `BulkSetInventoryResultDTO` |
| List | `GET /inventoryitems` | Admin | All inventory items |
| List (paged) | `GET /inventoryitems/paged` | Admin | Paged inventory items |
| Get By ID | `GET /inventoryitems/{id}` | Admin | Single inventory item |

All mutation operations validate that the product variant exists via `IProductVariantService` and
publish `InventoryAdjusted` when the quantity actually changes. `IncreaseInventory` and
`DecreaseInventory` both route through `SetInventory`, which is the single place the event is raised.

The whole controller is `[Authorize(Policy = RequireAdmin)]`; there is no anonymous inventory read.

---

## 4. UI Workflows

### 4.1 Customer Shopping Experience (UI-Side)

The UI provides a complete shopping experience through the CartDrawer component and Blazor pages.

#### Cart Drawer (Sole Cart Interface)

The CartDrawer is the only cart UI: there is no dedicated cart page. It is a 380px right-side temporary drawer accessible from any page via the cart icon in the top app bar.

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

**State Management:** `ICartStateService` singleton manages cart state centrally: all cart operations go through this service which refreshes the cart DTO after each mutation and notifies subscribers via `OnChange` event. Cart items are enriched with product names and SKUs from the Catalog API.

#### Catalog Browse & Product Detail

- `/catalog`, Product grid with name search, category filter, name/newest sort, quick "Add to Cart" per variant, and a star rating with review count on each card (read off the product's denormalized `RatingSummary`, so a grid costs no per-card aggregate query)
- `/catalog/{id}`, Product detail with breadcrumbs, variant list, quantity selector, "Add to Cart" button, "Buy Now" (direct Stripe checkout), and a reviews section (anchor `#reviews`) listing published reviews with the review editor for an eligible signed-in customer
- A discounted variant reads as a sale on both pages: the card shows a sale badge and an effective-price range, the variant card shows the effective price beside the struck-through list price, and the pair carries a "Was X, now Y" accessible label. The numbers are server-resolved, so a browser clock never decides whether a promotion is running

#### Order Management

- `/orders`, MudDataGrid listing orders with ID, customer, total, status chips (Shipped included), item count; the admin search box also matches tracking numbers
- `/orders/{id}`, Two-column layout: order summary (status, total, payment/shipping/delivery actions, and the carrier, tracking number and tracking link once the order ships) + order lines. The admin ship and correct-tracking actions open one `ShipOrderDialog`, which serves both endpoints

### 4.2 Admin UI Workflows

| Page | Route | Purpose |
|------|-------|---------|
| Categories | `/categories` | MudDataGrid: CRUD, search, pagination |
| Category Create | `/categories/create` | Form: name, parent category select |
| Category Detail | `/categories/{id}` | View/edit mode, parent link, product list |
| Products | `/products` | MudDataGrid: name, brand, category, variants |
| Product Create | `/products/create` | Form: name, description, brand, category |
| Product Detail | `/products/{id}` | View/edit product, inline variant editor (add/edit/delete); the variants table adds a Discount column showing the badge and effective price against the struck-through list price, per-row Discount and Clear discount actions opening an inline dialog, and a "Discount all variants" button that applies one discount across the whole product |
| Reviews | `/reviews` | MudDataGrid: every review whatever its status, search, hide/unhide moderation |
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
- Reviews (`/reviews`)
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
| Sales -> Identity | `ICustomerService` | `GetContactInfoByIdAsync()` | Contact details for the order paid / shipped / payment-failed emails |
| Identity -> Sales | `IUserSalesExportService` | `GetUserSalesExportAsync()` | Orders section of the data-subject export |
| Identity -> Catalog | `IUserCatalogExportService` | `GetUserCatalogExportAsync()` | Product-reviews section of the same export |
| Identity (event) | Domain Event | `UserRegisteredHandler` | Auto-creates Customer on registration |

Both export edges are **best-effort**: an unreachable peer degrades that one section rather than
failing the export, so neither carries a startup wait.

Asynchronously, four integration events cross the boundary through the outbox and the broker. Each is
the consumer's trigger to refresh a denormalized copy IT owns, never a prompt to query back into the
publisher ([ADR-006](../adr/006-database-per-service.md)):

| Event | Publisher -> Consumer | What the consumer does |
|-------|-----------------------|------------------------|
| `Catalog.ProductVariantChanged.v1` | Catalog -> Sales | Creates the zero-stock inventory record; refreshes the denormalized SKU / product sort labels |
| `Catalog.ProductInfoChanged.v1` | Catalog -> Sales | Fans a product rename or delete out to those same labels |
| `Sales.OrderFulfilled.v1` | Sales -> Catalog | Writes one `VerifiedPurchase` per delivered product (Section 2.5) |
| `Identity.CustomerErased.v1` | Identity -> Sales and Catalog | Sales clears the frozen order customer name; Catalog anonymizes the customer's reviews, keeping the ratings |

**Module dependency:** Sales declares a hard dependency on Catalog (`RequiresDependencies = true`). When Catalog is disabled, a `DisabledProductVariantService` stub is registered and Sales will fail to start.

---

## 6. External Interactions

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| **Stripe** | Payment processing | `StripePaymentService`, creates checkout sessions, handles webhooks |
| **SQL Server** | Primary persistence | Via EF Core + Aspire container orchestration |
| **SQLite / Cosmos DB** | Alternative persistence | Configurable via `IDbContextFactory` strategy |
| **SMTP** | Transactional email | `SmtpEmailSender`, driven by the password-reset handler and the Sales handlers `OrderPaidHandler`, `OrderShippedHandler` and `OrderPaymentFailedSagaHandler` |
| **Message broker** | Cross-service integration events | MassTransit over RabbitMQ locally and Azure Service Bus in production, fed by the per-service outbox |

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
8. Shipment          PUT /orders/{id}/ship         -> Admin records carrier + tracking, customer emailed
9. Delivery          PUT /orders/{id}/deliver      -> Admin marks as Delivered, OrderFulfilled published
10. Entitlement      (broker)                      -> Catalog writes one VerifiedPurchase per product
11. Review           POST /reviews/by-product/{id} -> Customer rates the product they received
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
| **No order-confirmation or delivery email** | Email handlers exist for payment, shipment and payment failure, but `OrderChanged` (`Added`) and `OrderDelivered` have no email handler, and `OrderCancelled` has only the inventory-restoring saga | Both would be an extra `IDomainEventHandler<T>` on an event that already exists, not new plumbing |
| **No full-text search** | Catalog browse offers a name-contains search box (E2E-covered); there is no full-text/fuzzy search | Consider full-text search for larger catalogs |
| **Inventory not checked during cart add** | Inventory validation only happens at checkout, not when adding to cart | Could lead to poor UX if items go out of stock between add and checkout |
| **No post-payment cancellation** | Cancellation allowed from PendingPayment, PaymentInitiated, or PaymentFailed; cannot cancel after payment succeeds | Verify if post-payment cancellation with Stripe refund is needed |
| **No customer deactivation endpoint** | `User.Deactivate()` method and `UserDeactivated` event exist in domain but no API endpoint exposes this. (Account *erasure* is exposed, see 1.9; deactivation is the separate reversible state.) | May be an admin feature not yet implemented |
| **Category deletion has no cascade check** | Deleting a category doesn't check for assigned products | Products with deleted category may have orphaned CategoryId |
| **No partial fulfillment** | Orders ship and are delivered as a whole: `Shipped` applies to the order, not to individual lines, and an order carries one `Shipment` value object | A second parcel means turning the shipment into a collection; clarify whether split shipments are a real business case first |
| **No refund compensation handler** | [ADR-054](../adr/054-saga-compensation-and-reconciliation.md) makes refunds a natural third saga handler alongside `OrderCancelledSagaHandler` and `OrderPaymentFailedSagaHandler`, but none exists | Add when post-payment cancellation lands |

---

*This document is derived from source code analysis. All workflows, decisions, and behaviors described above are confirmed implementations traceable to the referenced source files. Last updated: 2026-09-05 (order shipment tracking and product reviews).*
