# MMCA Business Workflow Analysis

_As of: 2026-10-28._

**Authorization notation.** Endpoints state a capability with `[HasPermission(...)]`, never a role
name. Each module grants its whole capability set to the Admin role in compiled code
(`CatalogPermissionGrants.cs:29`, `SalesPermissionGrants.cs:30`, `IdentityPermissionGrants.cs:35`),
so "Admin" in the tables below means "a caller holding the named permission", which by default is
an Admin. `[Authorize]` with no policy is the plain authenticated gate.

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
| 57 | Forgot Password | `POST /auth/forgot-password` | Identity |
| 58 | Reset Password | `POST /auth/reset-password` | Identity |
| 59 | Send Email Confirmation | `POST /auth/send-email-confirmation` | Identity |
| 60 | Confirm Email | `POST /auth/confirm-email` | Identity |
| 61 | Revoke One Session | `POST /auth/revoke/{sessionId}` | Identity |
| 62 | Link User to Customer | `PUT /users/{userId}/customer-link` | Identity |
| 63 | Lock User | `POST /admin/users/{userId}/lock` | Identity |
| 64 | Unlock User | `POST /admin/users/{userId}/unlock` | Identity |
| 65 | Change User Role | `PUT /admin/users/{userId}/roles` | Identity |
| 66 | Edit Role Permissions | `PUT /admin/roles/{role}/permissions` | Identity |
| 67 | Quote Bag (subtotal, shipping, tax) | `POST /orders/quote` | Sales |
| 68 | Guest Checkout | `POST /orders/guest` | Sales |
| 69 | Guest Order Payment | `POST /orders/guest/{id}/checkout` | Sales |
| 70 | Claim Guest Order | `POST /orders/guest/{id}/claim` | Sales |
| 71 | Expire Unpaid Order | `Sales.ExpireUnpaidOrder` internal command (no HTTP surface) | Sales |
| 72 | Cancel Guest Order | `POST /orders/guest/{id}/cancel` | Sales |
| 73 | Request Guest Order Link | `POST /orders/guest/lookup` | Sales |
| 74 | Browse Storefront Products | `GET /products/storefront` | Catalog |
| 75 | Best Sellers | `GET /orders/best-sellers` | Sales |

---

## 1. Identity Module Workflows

### 1.1 User Registration

**Entry Point:** `POST /auth/register`, `AuthController.RegisterAsync()`, AllowAnonymous, `auth-ip`
rate-limit policy, `[NonIdempotent]` (a replay would hand back tokens minted for an earlier call)

**Execution Path:**

```
AuthController.RegisterAsync()  (201 Created)
  -> AuthenticationService.RegisterAsync()   [AuthenticationServiceBase<User> in MMCA.Common]
    -> validate request, registration rate limit (ADR-029)
    -> EmailExistsAsync() -> Conflict when taken
    -> PasswordHasher.HashPassword() (PBKDF2-HMAC-SHA512, 210,000 iterations, per-user salt)
    -> CreateUser() -> User.Create() factory (default role Customer)
    -> Repository.AddAsync() + UnitOfWork.SaveChangesAsync()
    -> [Domain Event] UserRegisteredHandler (own DI scope, one transaction)
      -> Customer.Create() + User.LinkCustomer(customerId)
    -> [Domain Event] UserRegisteredEmailConfirmationHandler
      -> schedules Identity.SendEmailConfirmation (internal command, ADR-114)
    -> OnUserRegisteredAsync(): untracked re-fetch so the first token carries customer_id
    -> IssueTokensAsync(): access token + a new refresh session row
```

**Business Steps:**

1. Validate registration input (email, password, first name, last name, optional address)
2. Check email is not already registered
3. Hash password with PBKDF2-HMAC-SHA512 (210,000 iterations, per-user salt; `PasswordHasher.cs:34`)
4. Create User aggregate (IsActive=true, Role="Customer")
5. Persist user: triggers `UserRegistered` domain event
6. `UserRegisteredHandler` creates the Customer profile and links it to the User
7. `UserRegisteredEmailConfirmationHandler` schedules the confirmation email (1.10)
8. Issue an access token (15 min) and a refresh token (7 days, `RefreshTokenExpirationDays`) stored as
   its own refresh-session row ([ADR-097](../adr/097-multi-device-refresh-sessions.md))
9. Return the authentication response with tokens

**Decision Points:**

- Email already exists -> Conflict error
- Role="Admin" -> no Customer profile created; Role="Customer" -> Customer auto-created
- A Customer profile with the registering address already exists (typically created by an admin) ->
  the account is deliberately left UNLINKED, because registration does not prove ownership of the
  address; an admin links it through `PUT /users/{userId}/customer-link` (1.11,
  `UserRegisteredHandler.cs:21-26`)

**State Changes:**

- Creates `User` (Active) and one refresh session
- Creates `Customer` (linked via User.CustomerId) unless the address collides

**Domain Events:** `UserRegistered` -> `UserRegisteredHandler` creates the linked `Customer`, which raises `CustomerChanged` with the `Added` state

---

### 1.2 User Login

**Entry Point:** `POST /auth/login`, `AuthControllerBase.LoginAsync()` (MMCA.Common, inherited by
`AuthController`), AllowAnonymous, `auth-ip` rate-limit policy, `[NonIdempotent]`

**Execution Path:**

```
AuthController.LoginAsync()
  -> AuthenticationServiceBase.LoginAsync()
    -> validate request
    -> loginProtection.CheckLockoutAsync()   (ADR-029 exponential-backoff lockout)
    -> FindUntrackedByEmailAsync()            (soft-deleted accounts excluded)
    -> PasswordHasher.VerifyPassword()        (constant-time; failed attempt counted on a miss)
    -> ValidateLoginCandidateAsync()          (Store gate: deactivated account rejected)
    -> tracked re-fetch by id
    -> ResetFailedAttemptsAsync()
    -> IssueTokensAsync()                     (access token + new refresh session row)
    -> RehashPasswordIfNeededAsync()          (best effort, after the tokens are issued)
```

**Business Steps:**

1. Check the lockout state for the address
2. Look up user by email (untracked)
3. Verify password against stored hash+salt
4. Verify user is active (checked AFTER the password, so only the account owner learns it is
   deactivated)
5. Issue new access + refresh tokens; the refresh token lives in its own session row, not on the
   user
6. Upgrade the stored hash when the hasher reports `NeedsRehash` (the `User` implements
   `IPasswordRehashableUser`); a rehash failure never fails a sign-in that already succeeded
   (`AuthenticationServiceBase.cs:237`, `:676`)
7. Return tokens

**Decision Points:**

- Locked out -> refused before any lookup
- Email not found -> Unauthorized
- Password mismatch -> Unauthorized (failed attempt counted)
- User deactivated -> Unauthorized

**State Changes:** a new refresh session row; the password hash when a rehash is due; the
failed-attempt counter reset

---

### 1.3 Token Refresh

**Entry Point:** `POST /auth/refresh`, AllowAnonymous, `[NonIdempotent]`

**Execution Path:**

```
AuthControllerBase.RefreshAsync()
  -> AuthenticationServiceBase.RefreshTokenAsync()
    -> read claims from the expired access token (signature validated, lifetime skipped)
    -> fetch User from the sub claim
    -> ValidateRefreshCandidateAsync()   (Store gate: deactivated account rejected)
    -> session issuer resolves the presented refresh token, with reuse detection, and rotates it
```

**Decision Points:**

- Invalid/expired refresh token -> Unauthorized
- A refresh token that was already rotated is presented again -> treated as reuse
  ([ADR-050](../adr/050-jwt-refresh-token-rotation.md))
- A refresh token a concurrent request rotated less than `RefreshSessions:ReuseGraceSeconds` (10
  seconds by default) ago -> 409 Conflict (`Auth.RefreshSuperseded`) with nothing revoked; the client
  retries with the winner's token rather than signing out
- User deactivated -> Unauthorized

**State Changes:** the refresh session is rotated (the presented token retired, a successor issued)

---

### 1.4 Token and Session Revocation

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Revoke all my sessions | `POST /auth/revoke` | Authenticated | Signs the account out on every device (the endpoint has no body to name one device); `[NonIdempotent]`: every call must reach the session store |
| List my sessions | `GET /auth/my-sessions` | Authenticated | One row per signed-in device ([ADR-097](../adr/097-multi-device-refresh-sessions.md)); the Profile page links to it ("Manage devices") |
| Revoke one session | `POST /auth/revoke/{sessionId}` | Authenticated | Signs one device out; ownership is checked by the session store, so another account's session id answers 404 exactly as an unknown one does; an already-revoked session also answers 404 (`Auth.SessionAlreadyRevoked`) |

All three come from `AuthControllerBase` in MMCA.Common and are inherited unchanged by `AuthController`.

---

### 1.5 Change Password

**Entry Point:** `PUT /auth/password`, Requires Authorization (`UserAccountAuthControllerBase`)

**Execution Path:**

```
AuthController.ChangePasswordAsync()
  -> ChangePasswordHandler (workflow in ChangePasswordHandlerBase, MMCA.Common)
    -> account with no stored credential -> Unauthorized
    -> loginProtection.CheckLockoutAsync("password-change:{userId}")   (ADR-029)
    -> Verify current password (a miss counts a failed attempt)
    -> ResetFailedAttemptsAsync()
    -> Hash new password
    -> User.ChangePassword() -> raises UserPasswordChanged
    -> revoke every live refresh session on the account
    -> SaveChangesAsync()
```

**Decision Points:** Current password incorrect -> Unauthorized (`ChangePasswordHandler.cs:12`).
Repeated misses lock the change-password path out through the same exponential backoff as sign-in,
on a per-account counter kept separate from the sign-in counter, so the endpoint is not an
unthrottled password oracle for a session holder and a lockout here does not block sign-in.

---

### 1.6 Customer Profile Management

| Workflow | Endpoint | Domain Method | Event |
|----------|----------|---------------|-------|
| Change Name | `PUT /customers/{id}/name` | `Customer.ChangeName()` | `CustomerChanged` (`Updated`) |
| Change Address | `PUT /customers/{id}/address` | `Customer.ChangeAddress()` | `CustomerChanged` (`Updated`) |
| Change Email | `PUT /customers/{id}/email` | `Customer.ChangeEmail()` | `CustomerChanged` (`Updated`) |

All three are owner-or-admin (`OwnerOrAdminFilter`) and conditional: `[SupportsIfMatch]` makes the
`If-Match` header mandatory, 412 on a stale token, 428 when absent
([ADR-035](../adr/035-optimistic-concurrency.md)). Email change refuses an address already held by
another user account or another customer profile (400 `Identity.Customer.EmailInUse`), and a caller
without `identity:customers:manage` (the owner path) may only set the contact address to the sign-in
email of the user linked to that customer (400 `Identity.Customer.EmailMustMatchLogin`);
`CustomerChangeEmailUpdateHandler` holds both checks.

### 1.7 Customer CRUD (Admin)

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Create Customer | `POST /customers` | `identity:customers:manage` | Idempotent via `[Idempotent]` attribute |
| Delete Customer | `DELETE /customers/{id}` | `identity:customers:manage` | Soft delete (IsDeleted=true), raises `CustomerChanged` with the `Deleted` state |
| Get Customer | `GET /customers/{id}` | Authenticated | Owner or admin |
| List Customers | `GET /customers` | `identity:customers:manage` | All customers |
| List Customers (paged) | `GET /customers/paged` | `identity:customers:manage` | Paged |
| Customer Lookup | `GET /customers/lookup` | `identity:customers:manage` | Id/name pairs for pickers |
| Export Customers | `GET /customers/export` | `identity:customers:manage` | CSV streamed to the response body; unscoped by design (`AllowUnscopedExport`) |

The controller is `[Authorize]` plus `OwnerOrAdminFilter`, with the collection reads, the export and
the create/delete actions individually raised to `[HasPermission(IdentityPermissions.CustomersManage)]`.

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

The export controller is the framework's `DataExportControllerBase`; the erasure is
`UsersController.DeleteAsync` over `DeleteUserCommand` (`ICacheInvalidating`, `IUserOwnedRequest`).

### 1.10 Password Reset and Email Confirmation

All four actions are AllowAnonymous, `[Idempotent]` and throttled by the `auth-ip` policy. They come
from the framework bases `PasswordResetAuthControllerBase` and `EmailConfirmationControllerBase`;
Store's `PasswordResetController` and `EmailConfirmationController` only bind the Store commands.

| Workflow | Endpoint | Handler | Notes |
|----------|----------|---------|-------|
| Forgot password | `POST /auth/forgot-password` | `ForgotPasswordHandler` | Anti-enumeration answer, single-use reset token, reset email through `IEmailSender` |
| Reset password | `POST /auth/reset-password` | `ResetPasswordHandler` | Redeems the token, re-hashes, clears the lockout and revokes every live refresh session on the account; one generic rejection error |
| Send email confirmation | `POST /auth/send-email-confirmation` | `SendEmailConfirmationHandler` | Re-sends the confirmation link |
| Confirm email | `POST /auth/confirm-email` | `ConfirmEmailHandler` | Marks the address confirmed, raises `UserEmailConfirmed` |

Email confirmation is send-only: `RequireConfirmedEmail` is `false` in the Identity service settings,
so `IsEmailConfirmed` is recorded and never gates sign-in.

### 1.11 User and Role Administration

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| List users (paged) | `GET /admin/users/paged` | `users:manage` | Generic paged entity path over `UserDTO`, page size capped at 100 (`AdminUsersController.cs:63`) |
| Get user | `GET /admin/users/{userId}` | `users:manage` | |
| List a user's sessions | `GET /admin/users/{userId}/sessions` | `users:manage` | |
| Lock user | `POST /admin/users/{userId}/lock` | `users:manage` | `User.Deactivate()` (raises `UserDeactivated`) and revokes every live refresh session; `[NonIdempotent]` so a replay re-evaluates state |
| Unlock user | `POST /admin/users/{userId}/unlock` | `users:manage` | `User.Reactivate()` (raises `UserReactivated`); `[NonIdempotent]` |
| Change role | `PUT /admin/users/{userId}/roles` | `users:manage` | Exactly one role (400 `User.Role.ExactlyOne` otherwise); `User.ChangeRole()` raises `UserRoleChanged` and revokes live sessions; assigning the role the account already holds is a no-op success with no revocation |
| List roles | `GET /admin/roles` | `roles:manage` | Compiled plus stored grants per role |
| Permission catalog | `GET /admin/roles/catalog` | `roles:manage` | Every permission an endpoint checks |
| Get role | `GET /admin/roles/{role}` | `roles:manage` | |
| Edit role permissions | `PUT /admin/roles/{role}/permissions` | `roles:manage` | Replaces the STORED grants only; refuses `roles:manage` itself and any permission outside the catalog (400) |
| Link user to customer | `PUT /users/{userId}/customer-link` | `identity:users:manage` | Manual counterpart to the registration link: both records must carry the same address, neither may be linked already (`LinkUserCustomerHandler`) |

The user surface is the framework's `UsersAdminControllerBase` and the role surface is
`RolesAdminControllerBase` ([ADR-116](../adr/116-identity-completions-opt-in.md),
[ADR-020](../adr/020-permission-based-authorization.md)). "Locked" maps onto the existing
`User.IsActive` flag (`UserAdministrationService.cs:72`), so it takes effect through the sign-in and
refresh gates in 1.2 and 1.3, and the session revocation (`:82`) makes it bite immediately.

---

## 2. Catalog Module Workflows

### 2.1 Category Management

#### Create Category

Every mutation on `CategoriesController` requires `catalog:categories:manage`, stated once at the
controller level; the reads opt out with `[AllowAnonymous]`.

**Entry Point:** `POST /categories`, `catalog:categories:manage`, `[Idempotent]`

```
CategoriesController.CreateAsync()
  -> CreateCategoryHandler
    -> CategoryCreateRequestValidator (name: required, max 255)
    -> a named parent must exist and not be soft-deleted -> 404 otherwise
    -> Category.Create(id, name, parentCategoryId?) -> raises CategoryChanged (Added)
    -> Repository.AddAsync() + SaveChangesAsync()
  -> evicts the catalog:categories and catalog:products output-cache tags
```

**Response:** 201 Created with `CategoryDTO`

#### Rename Category

**Entry Point:** `PUT /categories/{id}/name`, `catalog:categories:manage`, mandatory `If-Match`

```
CategoriesController.RenameAsync()
  -> RenameCategoryHandler
    -> Validate name (max 255)
    -> Fetch category -> category.Rename(name)
    -> The name is always written (a case-only edit is stored)
    -> Raises CategoryChanged (Updated) only when the name differs case-insensitively
    -> Cache invalidation + evicts the catalog:categories and catalog:products output-cache tags
```

#### Assign Parent Category

**Entry Point:** `PUT /categories/{id}/parentcategory`, `catalog:categories:manage`, mandatory `If-Match`

Sets or clears `ParentCategoryId` to establish hierarchy. No domain event raised. Three refusals:
a category named as its own parent (`Category.SelfReferencing`), a parent that does not exist or is
soft-deleted (404), and a parent whose ancestor chain leads back to this category
(`Category.CircularReference`; `CategoryAssignParentUpdateHandler` walks at most 32 ancestors and
refuses on exhaustion). Evicts the `catalog:categories` and `catalog:products` output-cache tags.

#### Delete Category

**Entry Point:** `DELETE /categories/{id}`, `catalog:categories:manage`

Soft delete (`IsDeleted=true`). Refused while products are assigned (`Category.HasProducts`) or child
categories hang beneath it (`Category.cs:87-99`); the delete handler eager-loads both for the check.
Raises `CategoryChanged` with the `Deleted` state.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /categories` | AllowAnonymous | Returns all categories (capped at MaxPageSize) |
| `GET /categories/paged` | AllowAnonymous | Paginated with filters, sorting, field projection |
| `GET /categories/lookup` | AllowAnonymous | Returns ID + name pairs for dropdowns |
| `GET /categories/{id}` | AllowAnonymous | Single category with optional FK/children includes |
| `GET /categories/export` | `catalog:categories:manage` | CSV export, inherited from `EntityControllerBase`; unscoped by design |

The anonymous reads are output-cached under the `CategoriesCache` policy.

---

### 2.2 Product Management

#### Create Product

**Entry Point:** `POST /products`, `catalog:products:manage`, `[Idempotent]`

```
ProductsController.CreateAsync()
  -> CreateProductHandler
    -> Validate: name (required, max 100), description (max 4000), brand (max 100, not whitespace-only if provided)
    -> a named category must exist and not be soft-deleted -> 404 otherwise
    -> Product.Create() factory -> raises ProductChanged (Added)
    -> Repository.AddAsync() + SaveChangesAsync()
```

#### Update Operations

| Workflow | Endpoint | Validation | Event |
|----------|----------|-----------|-------|
| Rename | `PUT /products/{id}/name` | Max 100, required | `ProductChanged` (`Updated`) plus the `ProductInfoChanged` integration event (`Updated`) |
| Change Description | `PUT /products/{id}/description` | Max 4000, nullable | None |
| Change Brand | `PUT /products/{id}/brand` | Max 100, nullable, not whitespace-only | None |
| Assign Category | `PUT /products/{id}/category` | Nullable FK; a named category must exist and not be soft-deleted (404) | None |

The four attribute edits live on `ProductAttributesController` (same `/products` prefix), which
requires `catalog:products:manage` at the controller level; each is conditional on a mandatory
`If-Match` header and evicts the `catalog:products` and `catalog:categories` output-cache tags.

#### Delete Product

**Entry Point:** `DELETE /products/{id}`, `catalog:products:manage`. Soft delete, raises `ProductChanged` with the `Deleted` state plus the `ProductInfoChanged` integration event (`Deleted`). The product's variants and images are soft-deleted with it, and a child that refuses its own delete fails the whole product delete rather than leaving an active row under a deleted product.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /products` | AllowAnonymous | Returns all products (capped at MaxPageSize) |
| `GET /products/paged` | AllowAnonymous | Paginated with filters, sorting, field projection |
| `GET /products/lookup` | AllowAnonymous | Returns ID + name pairs for dropdowns |
| `GET /products/storefront` | AllowAnonymous | One page of the public shop: `search`, `categoryId`, `onSale`, `sort`, `pageNumber`, `pageSize` (default 12, capped at MaxPageSize); returns the paged products with category, variants and images plus the `X-Pagination` header (`ProductsController.cs:96-118`) |
| `GET /products/variant-lookup` | AllowAnonymous | Returns `ProductVariantCartInfoDTO` rows: the variant detail the cart UI needs without a per-variant round trip |
| `GET /products/{id}` | AllowAnonymous | Single product with optional FK/children includes |
| `GET /products/export` | `catalog:products:manage` | CSV export (`ProductsController.cs:148-149`) |

The anonymous reads ride the `ProductsCache` output-cache policy, whose TTL is 60 seconds rather than
the 5 minutes the other Catalog policies use: a variant's effective price moves on the clock when a
discount window opens or closes, with no mutation to evict on
([ADR-040](../adr/040-authenticated-output-caching-for-public-reads.md)).

**Storefront page:** `GetStorefrontProductsHandler` runs `StorefrontProductsSpecification`. The
search matches the product name OR its description (a contains match, joined only when a term is
given), the category and on-sale filters join only when asked for, and on-sale keeps a product with
at least one variant whose discount is in force now (`StorefrontProductsSpecification.cs:70-86`).
The six orderings are typed members of `StorefrontProductSort` rather than client-chosen column names
(`StorefrontProductSort.cs:13-32`): `NameAsc` (the default), `NameDesc`, `Newest`, `PriceAsc`,
`PriceDesc` and `TopRated`. The two price orderings sort by the lowest price any variant sells at
right now, the effective price after a discount in force, restated as a translatable expression at
the caller's clock, with a product that has no variants last in both directions; `TopRated` sorts
by average rating and then review count; every ordering ends on name and id so a page boundary is
stable (`StorefrontProductsSpecification.cs:91-124`).

---

### 2.3 Product Variant Management

#### Add Product Variant

**Entry Point:** `POST /products/{id}/productvariants`, `catalog:product-variants:manage`, `[Idempotent]`

```
ProductVariantsController.CreateAsync()
  -> AddVariantHandler   (AddVariantCommand: ITransactional, ICacheInvalidating)
    -> AddVariantCommandValidator: SKU (optional, max 50), Price (required, not negative; zero allowed)
    -> IProductVariantService.SkuExistsAsync() -> global SKU uniqueness check on the SKU as stored
       (trimmed, blank stored as no SKU)
    -> Fetch Product with variants
    -> product.AddProductVariant(variantId, sku, price)
      -> ProductVariant.Create() validates price not negative
      -> Raises no Catalog domain event
    -> SaveChangesAsync()
    -> schedules Catalog.PublishProductVariantChanged (internal command, ADR-114) with the
       database-generated variant id; the transactional pipeline commits that row with the variant
```

**Response:** 201 Created with `ProductVariantDTO`, located at the parent product
(`GetProductById`); evicts the `catalog:products` and `catalog:categories` output-cache tags.

**Cross-Module:** SKU uniqueness checked via `IProductVariantService`. The `ProductVariantChanged`
(`Added`) integration event goes out when the scheduled internal command runs, so consumers always
see the real variant id (`AddVariantHandler.cs:19-23`).

#### Change Variant SKU

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/sku`, `catalog:product-variants:manage`, mandatory `If-Match`

SKU uniqueness verified globally (excluding current variant). Raises the `ProductVariantChanged` integration event with the `Updated` state if changed.

#### Change Variant Price

**Entry Point:** `PUT /products/{id}/productvariants/{variantId}/price`, `catalog:product-variants:manage`, mandatory `If-Match`

Price must not be negative (zero is allowed). Raises the `ProductVariantChanged` integration event with the `Updated` state if changed. The price edited here is
the LIST price. A variant that carries a discount re-validates it against the new price and the
change is refused when the pair would be inconsistent (a special price no longer below the list
price, or a percentage leaving nothing), so the discount is cleared first. A discount whose window
has already ended prices nothing and does not take part; one that is active or scheduled does.

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
  -> Evicts the catalog:products and catalog:categories output-cache tags
```

Replaces any discount already on the variant. Returns 204; 400 on a broken invariant, 404 on an
unknown product or variant, 412 on a stale ETag, 428 when `If-Match` is missing
([ADR-035](../adr/035-optimistic-concurrency.md) two-token rule: the header carries the product's
ETag, the body carries the variant's row version).

#### Clear Variant Discount

**Entry Point:** `DELETE /products/{id}/productvariants/{variantId}/discount`, `catalog:pricing:manage`

Returns the variant to its list price, which was never rewritten, so there is nothing to restore.
Clearing a variant that carries no discount changes nothing, so clearing twice is safe. Publishes
`ProductVariantChanged` (Updated) and evicts the `catalog:products` and `catalog:categories` tags. The body carries only the
variant's row version; the status codes match the set action.

#### Discount All Variants

**Entry Point:** `PUT /products/{id}/discount`, `catalog:pricing:manage`

```
ProductsController.SetDiscountAsync()
  -> SetProductDiscountCommand (If-Match product ETag)
    -> ProductSetDiscountRequest.ToDiscount() -> Result<VariantDiscount>
    -> product.SetDiscountOnAllVariants(discount)
      -> A product with NO active variant is refused first: Product.NoActiveVariants (400)
      -> ApplyTo() is checked against EVERY active variant's list price FIRST
      -> All-or-nothing: one refusal leaves the product exactly as it was
      -> Publishes one ProductVariantChanged (Updated) per variant, each with its LIST price
    -> SaveChangesAsync()
  -> Evicts the catalog:products and catalog:categories output-cache tags
```

A product whose variants are priced differently either takes the promotion whole or is left
untouched, so a half-discounted catalog page is not reachable. A product with nothing to discount,
because it has no variants yet or every one is soft-deleted, is a 400 rather than a write that
succeeds over an empty set.

#### Remove Product Variant

**Entry Point:** `DELETE /products/{id}/productvariants/{variantId}`, `catalog:product-variants:manage`

Soft delete on variant. Raises the `ProductVariantChanged` integration event with the `Deleted` state.

### 2.4 Product Image Management

Behind the `CatalogFeatures.ProductImages` feature gate ([ADR-031](../adr/031-feature-flag-management.md)).
Image binaries live as rows in the Catalog database (`ProductImageData`), not in managed blob storage:
[ADR-045](../adr/045-managed-file-storage-and-avatars.md) is the MMCA.ADC avatar amendment and is not
adopted here, which is why the output cache below exists. Mutations require
`catalog:product-images:manage` (stated at the controller level); retrieval is anonymous and
output-cached for 300 seconds to keep repeated BLOB reads off the database.

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Read image by id | `GET /products/{productId}/images/{imageId}` | Anonymous | 300s response cache plus the `ProductImagesCache` output-cache policy |
| Upload image | `POST /products/{productId}/images` | `catalog:product-images:manage` | `[Idempotent]`; 201 Created with `ProductImageDTO` and a Location header; 6 MB request limit covering the 5 MB domain constraint plus multipart overhead; JPEG, PNG, GIF or WebP only, at most 10 images per product; `UploadProductImageCommand` is `ITransactional` |
| Delete image by id | `DELETE /products/{productId}/images/{imageId}` | `catalog:product-images:manage` | |
| Reorder images | `PUT /products/{productId}/images/order` | `catalog:product-images:manage` | Mandatory `If-Match`; reassigns display order from the supplied id list, the first id becoming the primary image (order 0); `ReorderProductImagesCommand` is `ITransactional` |

Each mutation raises `ProductImageChanged` (`Added`, `Deleted` or `Updated`) on the product and
evicts the `catalog:products` and `catalog:categories` output-cache tags so the next read reflects
the change.

---

### 2.5 Product Reviews

#### Earn the Entitlement (OrderFulfilled -> VerifiedPurchase)

**Entry Point:** the `Sales.OrderFulfilled.v1` integration event, consumed by
`OrderFulfilledHandler` in its own DI scope. No HTTP surface: nothing else in the system creates a
verified purchase.

```
Sales: order.MarkAsDelivered()
  -> raises OrderDelivered (in-process) AND, for a customer's order only, OrderFulfilled
     (integration, line snapshot); a guest order has no account to hold a verified purchase
  -> stamps Order.FulfilledPublishedOn in the same unit of work
  -> outbox row commits with the order write, then ships to the broker

Catalog: OrderFulfilledHandler
  -> resolve the event's variant ids to product ids in ONE projection
     (query filters ignored, so a retired variant on a product still on sale still entitles)
  -> de-duplicate: two sizes of the same shirt are one entitlement
  -> re-read the owning products through the filtered reader: a delisted (soft-deleted) product
     is logged and skipped, so it stays unreviewable
  -> read the order's existing entitlement rows, soft-deleted ones included (first idempotency guard)
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
    -> a lost concurrency race on the product is retried in a fresh scope, three attempts in all,
       then abandoned with a warning (the next review event recomputes it)
```

**Response:** 200 OK with `ProductReviewDTO`

#### Revise / Withdraw Review

**Entry Point:** `PUT /reviews/{id}` and `DELETE /reviews/{id}`, owner or Admin

Ownership is checked in the controller and a non-owner is answered **404, not 403**, so the existence
of another customer's review id cannot be probed for. The revise path is conditional
([ADR-035](../adr/035-optimistic-concurrency.md)): the `If-Match` header is mandatory and an edit
decided against a stale view answers 412. The delete is unconditional (soft delete; a delete has no
field to lose to a concurrent edit). The owner cannot withdraw a review a moderator hid (400
`Review.HiddenByModerator`); an Admin can. Both raise `ProductReviewChanged`, so the rating summary is
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
loaded, so a redelivery finds nothing to do and churns no audit fields. Because the handler runs off
a broker message with no output-cache handle, it publishes `OutputCacheEvictionRequested` for the
`catalog:products` tag, which every replica consumes to drop the cached review list; the cache TTL
is the backstop for a message that never lands.

#### Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /reviews/by-product/{productId}/paged` | Anonymous | Published reviews only, whoever asks, newest first; served in the public review shape (no customer or order id), and a `sortColumn` outside that shape is a 400; output-cached under the shared `ProductsCache` policy, which caches regardless of auth state (a role-varying response would be served to the wrong caller) |
| `GET /reviews/by-product/{productId}/mine` | Authenticated customer | `HasPurchased` and `CanReview` as separate booleans, plus the caller's own review; the pair is what lets the UI tell "never bought it" apart from "already had their say" |
| `GET /reviews/paged` | `catalog:reviews:moderate` | Every review whatever its status, filterable and sortable; never cached |

The `/reviews` prefix is served by three controllers: `ReviewsController` (public list, submit,
revise, withdraw), `ReviewEligibilityController` (`/mine`) and `ReviewModerationController`
(moderation list, hide, unhide). Page sizes are capped server-side at 100. Every mutation evicts the
`catalog:products` and `catalog:categories` output-cache tags (a category read can embed its
products) as well as invalidating the application cache, because a review moves the stars the
product reads carry.

---

## 3. Sales Module Workflows

### 3.1 Shopping Cart

#### Add Item to Cart

The server cart belongs to a signed-in customer (the cart id IS the customer id). A shopper who has
not signed in keeps a device cart instead (4.1) and checks out through 3.5.

**Entry Point:** `POST /shoppingcarts/{customerId}/shoppingcartitems`, Authenticated (owner or admin via `OwnerOrAdminFilter`), `[Idempotent]`, 201 Created

```
ShoppingCartsController.CreateShoppingCartItemAsync()
  -> ShoppingCartItemCreateRequestValidator (pipeline): quantity > 0
  -> AddItemHandler
    -> IProductVariantService.ExistsAsync() [cross-module: Catalog]
    -> Fetch ShoppingCart by CustomerId
    -> If no cart exists -> ShoppingCart.Create(customerId) -> ShoppingCartChanged (Added)
    -> If cart is CheckedOut -> shoppingCart.Reactivate() (clears items, resets to Active)
    -> shoppingCart.AddShoppingCartItem(variantId, quantity)
      -> If item already in cart -> IncreaseQuantity -> ShoppingCartItemChanged (Updated)
      -> If new item -> ShoppingCartItem.Create() -> ShoppingCartItemChanged (Added)
    -> repository.TouchConcurrencyToken(cart)   (a line write still bumps the cart rowversion)
    -> SaveChangesAsync()
    -> lost a race (the (cart, variant) unique index, or a concurrent checkout moved the
       rowversion) -> re-run the upsert ONCE in a fresh scope
```

**Decision Points:**

- Product variant doesn't exist -> Validation error `ShoppingCart.InvalidProductVariant`
- Quantity not positive -> Validation error from the request validator (the domain invariant backs it up)
- Cart checked out -> auto-reactivated (all old items cleared)
- A concurrent add of the same variant, or a checkout that committed in between -> one retry
  against a fresh read: the twin line's quantity grows, or the checked-out cart is reactivated; a
  second failure surfaces as the shared 409

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
| `GET /shoppingcarts/lookup` | `sales:shopping-carts:manage` | Id/name pairs for pickers |
| `GET /shoppingcarts/export` | Authenticated | CSV export under the same row-scoping as the list; only an admin exports unscoped |

Ownership on the collection reads is enforced **in the query**, not against a route value: there is no
owner parameter to compare, so the specification narrows the rows before they are read. The
collection reads also fail closed on a non-admin caller whose `customer_id` claim cannot be resolved
(`RequireResolvableOwner`), rather than reading an unscoped specification.

#### Shopping Cart Status State Machine

```
Active --(MarkAsCheckedOut)--> CheckedOut
  ^                                |
  +----(Reactivate on AddItem)-----+
        (clears all items)
```

---

### 3.2 Checkout (Cart to Order): Primary Business Workflow

**Entry Point:** `PUT /shoppingcarts/{customerId}/checkout`, authenticated (owner or admin via
`OwnerOrAdminFilter`), `[Idempotent]`, marked `ICacheInvalidating`. The optional body is a
`CheckoutDeliveryRequest` (shipping address, billing address, phone); an empty body `{}` still checks
out, with no addresses and no shipping label, which is how the admin cart page checks a cart out on a
customer's behalf (`ShoppingCartsController.cs:275-286`). `CheckOutCommand` is **deliberately NOT
`ITransactional`** (`CheckOutCommand.cs:10`): the handler opens its own transaction around the write
phase only, so the cross-service reads never hold database locks.

```
ShoppingCartsController.CheckOutAsync()
  -> CheckOutHandler
    -> Fetch ShoppingCart with items (NON-tracking snapshot: only names the variants to price)
    -> CheckoutDeliveryMapper.ToDomain(delivery)       (Address invariants; missing billing = shipping)
    -> CheckOutPreflight.ResolveAsync()                [OUTSIDE the transaction, once per checkout]
         -> IProductVariantService.GetUnitPricesAsync(ids)   [cross-module: Catalog]
              each entry is effective price + list price + promotion label (VariantUnitPrice),
              translated into Sales' own OrderLinePricing at the module boundary
         -> reject any variant missing from the price map (soft-deleted between add and checkout)
         -> ICustomerService.GetContactInfoByIdAsync()       [cross-module: Identity, best effort]
    -> CheckOutPreflight.QuoteChargesAsync()            [OUTSIDE the transaction]
         -> OrderChargesCalculator: subtotal, shipping, and sales tax when a ship-to is known
    -> unitOfWork.ExecuteInTransactionAsync(WriteAsync):     <-- one retriable transaction
         -> re-read the cart (tracking) and the InventoryItems (non-tracking snapshot)
         -> CheckOutDomainService.Execute():
              1. Validate cart not empty
              2. Validate inventory exists for all items
              3. Fail-fast sufficiency check per item against the point-in-time snapshot
                 (NOT the oversell guard: that is the atomic decrement below)
              4. Build order items (variant + pricing triple + quantity)
              5. Order.Create(customerId, items, customerName, delivery) -> raises OrderChanged (Added)
              6. shoppingCart.MarkAsCheckedOut() -> raises ShoppingCartCheckedOut
         -> OrderQuoteApplier.Apply(order, quote)     -> order.ApplyCharges(shipping, tax)
         -> IPaymentService.EnsureChargeable(order.Total)   (below the provider minimum -> refused)
         -> orderRepository.AddAsync(order)
         -> IInventoryAllocationService.DecrementAsync(decrements)
              atomic conditional UPDATE per variant (ExecuteUpdateAsync); a row that no longer has
              enough stock matches zero rows and fails the Result, rolling the transaction back
         -> unitOfWork.SaveChangesAsync()              <-- order insert + cart transition
         -> PlacedOrderFinalizer.FinalizeAsync(order)
              -> IShippingLabelProvider.CreateLabelAsync() + order.AttachShippingLabel()
                 (only when the order has a shipping address; a label failure is logged, never fatal)
              -> CheckOutDeadlineScheduler.ArmAsync()  -> schedules Sales.ExpireUnpaidOrder
                 for UnpaidOrderExpiry:Minutes (30) from now, in the SAME transaction
    -> Return OrderDTO
```

**Business Steps:**

1. Validate cart exists and has items, and validate the delivery addresses before any cross-service
   call is spent
2. Fetch current pricing from Catalog module, and reject variants that no longer exist; resolve the
   customer's display name (best effort: an unreachable Identity leaves it null)
3. Quote the charges: shipping is a flat `Shipping:FlatRate` (5.99) waived once the merchandise
   subtotal reaches `Shipping:FreeShippingThreshold` (50) (`ShippingSettings.cs:16`, `:20`); sales tax
   is calculated by Stripe Tax only when `Tax:Enabled` is on and a ship-to address is known, and is
   zero otherwise (`TaxSettings.cs:18`, `OrderChargesCalculator.cs:59-81`)
4. Fail-fast inventory sufficiency check against the loaded snapshot
5. Create Order aggregate with OrderLines. Each line freezes the effective price it is charged, the
   list price that price was struck from and the active promotion's label, so the order can say what
   it saved without asking Catalog again. Only the effective price is money owed: the line total and
   the order subtotal follow from it alone. `OrderLine.Savings` and `Order.TotalSavings` are computed
   from the frozen pair on read and never stored
   ([ADR-112](../adr/112-catalog-owned-effective-pricing.md))
6. Apply the quoted shipping and tax: `Order.Total = Subtotal + ShippingCost + TaxAmount`, the amount
   the payment session asks for and a payment has to match (`Order.cs:485`)
7. Transition cart to CheckedOut status
8. Commit the write phase in one explicit transaction: the order insert, the atomic inventory
   decrements, the cart transition, the shipping label and the payment-deadline row

**Decision Points:**

- Cart empty -> Validation error
- Shipping address present but invalid -> the Address invariant errors, before any pricing
- Product variant no longer exists in Catalog -> `ProductVariant.NotFound`, naming the offending variant
- Bag changed between the quote and the order (the subtotals differ) -> `Order.Charges.BagChanged`
  Conflict, so the shopper reviews the bag (`OrderQuoteApplier.cs:25-31`)
- Total below what the payment provider can charge (including a zero total) -> refused before
  anything is written (`CheckOutHandler.cs:188`)
- Tax enabled and the tax calculation fails -> the checkout stops rather than charging a guessed tax
- Insufficient inventory at snapshot time -> Invariant error (fail-fast)
- Insufficient inventory at commit time -> the conditional UPDATE matches no row, the transaction rolls back
- Inventory record missing -> NotFound (specific missing variant ID reported)
- Commit itself fails -> surfaced as non-retriable `TransactionCommitAmbiguousException`; the
  `[Idempotent]` filter replays a client retry safely
  ([ADR-107](../adr/107-transaction-execution-contract.md))

**State Changes:**

- Creates `Order` (status: PendingPayment) with `OrderLine` children, the frozen customer name,
  shipping and billing addresses, phone, `ShippingCost`, `TaxAmount`, `TaxCalculationId` and, when
  there is a ship-to, a `ShippingLabel`
- Decrements `InventoryItem.AvailableQuantity` for each item
- `ShoppingCart.Status` -> CheckedOut
- One `Sales.ExpireUnpaidOrder` internal-command row (3.3)

**Domain Events:** `OrderChanged` (`Added`), `ShoppingCartCheckedOut`.

> **No `InventoryAdjusted` on the checkout path.** The decrement runs as `ExecuteUpdateAsync`, which
> bypasses the save pipeline (and therefore the audit interceptor and domain-event dispatch) by design:
> that is what makes it a single atomic statement and the real oversell guard. The cancellation
> restore (3.3) returns stock the same way, through `IInventoryAllocationService.IncrementAsync`.
> `InventoryAdjusted` is still raised by the admin adjustment endpoints in 3.4, which go through the
> aggregate.

---

### 3.3 Order Lifecycle

#### Order Status State Machine

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
```

Each edge is the state class's `CanMark*` guard under `Sales.Domain/Orders/States/`
(`PaymentInitiatedState.cs:13-22`, `PaidState.cs:22`, `ShippedState.cs:26`).

**Terminal States:** Cancelled, Delivered

The Cancelled edges are taken by a customer or admin cancel, by the order's own payment deadline
(`Sales.ExpireUnpaidOrder`, below) and by the reconciliation sweep; all three land in the same
`OrderCancelled` compensation.

`Shipped` is an optional stop, not a mandatory one: a fulfilment with no tracking to record still goes
Paid -> Delivered directly, which is why Paid keeps both outgoing edges. Cancellation is refused from
Shipped exactly as it is from Paid. `UpdateShipment` is a self-transition on Shipped. The enum's
numeric values are persisted and travel on the `user_sales_export` gRPC contract, so `Shipped` is
appended LAST in `OrderStatus` even though it sits mid-lifecycle.

#### Create Stripe Checkout Session

**Entry Point:** `POST /orders/{id}/checkout`, Authenticated (owner or admin, ownership validated in
the controller with a 404 for a non-owner), `[Idempotent]`. A guest order reaches the same use case
through `POST /orders/guest/{id}/checkout` (3.5).

```
OrdersController.CreateCheckoutSessionAsync()
  -> CreateCheckoutSessionHandler   (CreateCheckoutSessionCommand: ICacheInvalidating, IHasTimeout)
    -> validator: success/cancel URIs must sit on CheckoutRedirectSettings.AllowedRedirectOrigins
    -> Fetch Order with OrderLines
    -> order.CanInitiatePayment()   (status gate BEFORE any provider call)
      PendingPayment / PaymentFailed -> new session:
        -> IPaymentService.EnsureChargeable(order.Total)
        -> IPaymentService.CreateCheckoutSessionAsync(..., CheckoutSessionCharges.ForOrder(order, email))
          -> StripePaymentService: separate line items for the merchandise, shipping and sales tax,
             converted to the smallest currency unit and checked to add up to the order total;
             pre-filled payer email (guest ContactEmail, else the token's email claim);
             orderId in the session and payment-intent metadata; ExpiresAt set on the session
        -> order.InitiatePayment(sessionId) -> status PaymentInitiated, raises OrderPaymentInitiated
        -> SaveChangesAsync()
      PaymentInitiated -> resume the session it is waiting on:
        -> IPaymentService.GetCheckoutSessionStatusAsync(order.StripeSessionId)
          paid for exactly this order (PaymentProof) -> order.MarkAsPaid(), no new session
          expired                                   -> retired via MarkAsPaymentFailed, then a new session
          still open                                -> hand back the SAME checkout page
          taken but unsettled                       -> tell the customer to wait, open nothing
      Paid / Shipped / Delivered / Cancelled -> refused, no provider call
    -> Return sessionId + checkoutUri + CheckoutSessionOutcome (Redirect; AlreadyPaid and
       PaymentPending carry no checkoutUri)
```

**External Interaction:** Stripe API: creates (or reads) the hosted checkout session. A
PaymentInitiated order never re-runs `InitiatePayment`, because the webhook finds the order BY the
stored session id and a second session would orphan the first one's confirmation
(`CreateCheckoutSessionHandler.cs:65-80`, `:150`).

#### Stripe Payment Webhook

**Entry Point:** `POST /payments/webhook`, AllowAnonymous, `[NonIdempotent]` (Stripe sends no
`Idempotency-Key`; replay protection is the signature plus the order's own state),
`[RequestSizeLimit(1_000_000)]`. `ProcessPaymentWebhookCommand` is `ICacheInvalidating` and
**deliberately NOT `ITransactional`** (`ProcessPaymentWebhookCommand.cs:9`): each branch performs one
atomic `SaveChangesAsync`, and the event handlers run post-commit with no transaction held. The Gateway
exempts `/Payments` from its edge rate limiter.

```
PaymentsController.HandleWebhookAsync()
  -> read the raw body (signature verification needs the unmodified payload)
  -> ProcessPaymentWebhookHandler
    -> IPaymentService.ParseWebhookEvent() (Stripe signature verification)
    -> Route by event type:

      checkout.session.completed:
        -> Find Order by StripeSessionId
        -> Already Paid / Shipped / Delivered -> success; a DIFFERENT payment intent is logged
           as a second charge that may need a refund
        -> Already Cancelled / PaymentFailed -> success, anomaly logged
        -> PaymentProof.IsPaymentForOrder(): Stripe reports the session paid, for exactly the
           order's total in its currency; anything else is acknowledged and left for an operator
        -> order.MarkAsPaid(paymentIntentId) -> status Paid, raises OrderPaid

      checkout.session.expired:
        -> Find Order by StripeSessionId
        -> Already PaymentFailed / Cancelled -> success; already Paid -> success, anomaly logged
        -> order.MarkAsPaymentFailed() -> status PaymentFailed, raises OrderPaymentFailed

      payment_intent.payment_failed:
        -> logged only: the session is still open and the customer can submit another card

      Other events: ignored (returns success)
```

**Idempotency:** Already-transitioned orders return success without modification.

**Controller behavior:** Returns 400 only when the event was never ACCEPTED (no body, no signature
header, signature verification failed, no signing secret configured, or an unparseable payload;
`PaymentsController.cs:39`), logged at Critical so the misconfiguration surfaces before Stripe
disables the endpoint. Everything past acceptance, including an unknown order, returns 200, because a
retry would fail identically forever.

**Receipt email:** `OrderPaidHandler` schedules `SendOrderPaidEmailInternalCommand` (ADR-114,
`OrderPaidHandler.cs:38`) rather than sending inline, so an SMTP outage retries instead of losing the
receipt. The command handler re-reads the order and its lines and sends to the customer's Identity
contact, or to the guest's `ContactEmail`. A discounted line prints a struck "Was" amount above the
price charged with the label (HTML-encoded) beneath it, and the order gets a "You saved" total; each
appears only when there is a saving to show. Delivery is at-least-once by decision: a host dying
after the SMTP call re-sends.

#### Manual Admin Payment

**Entry Point:** `PUT /orders/{id}/pay`, `sales:orders:manage`, mandatory `If-Match`, no body

Validates status allows manual payment (PendingPayment, PaymentInitiated, or PaymentFailed). Sets `StripePaymentIntentId = "manual-admin-override"`, status -> Paid. Publishes `OrderPaid`. 204 on success, 412 on a stale token, 428 when the header is absent.

#### Verify Payment (webhook backstop)

**Entry Point:** `PUT /orders/{id}/verify-payment`, owner or Admin (ownership validated in the
controller). `VerifyPaymentCommand` is `IFeatureGated` on `Sales.PaymentVerification`
(`SalesFeatures.cs:23`), a permanent kill switch over the live Stripe call, and `IHasTimeout` with a
20-second budget.

Polls Stripe directly for the order's checkout session instead of waiting on a webhook, for the case
where webhook delivery failed or is delayed. If Stripe reports the session paid for exactly the order
total (`PaymentProof`), the order is marked Paid exactly as the webhook would have marked it; if the
order is already Paid or is not in a verifiable state, the call succeeds without changes. This is the
reconciliation half of [ADR-054](../adr/054-saga-compensation-and-reconciliation.md): the webhook is
the fast path, this is the backstop that keeps a paid customer from sitting in `PaymentInitiated`
forever.

#### Expire Unpaid Order (payment deadline)

**Entry Point:** the `Sales.ExpireUnpaidOrder` internal command (`ExpireUnpaidOrderInternalCommand`),
scheduled per order by checkout (3.2) and re-armed by `OrderPaymentFailedSagaHandler` on every failed
payment. No HTTP surface.

```
ExpireUnpaidOrderInternalCommandHandler
  -> load the order; gone, or in any status other than PendingPayment or PaymentFailed
     (paid, cancelled, or PaymentInitiated, which the reconciliation sweep below resolves)
     -> success (Debug log, nothing to do) (ExpireUnpaidOrderInternalCommandHandler.cs:61)
  -> re-derive the due instant from LastModifiedOn ?? CreatedOn (not from the schedule time),
     so an older deadline left behind by a re-arm runs as a no-op
  -> still unpaid and past the window -> order.MarkAsCancelled(PaymentExpired) -> raises OrderCancelled
       -> OrderCancelledSagaHandler returns the stock checkout committed
       -> OrderCancelledHandler schedules the "your unpaid order expired" email
  -> a concurrency conflict (a webhook moved the order first) -> success: the concurrent writer wins
```

The window is `UnpaidOrderExpiry:Minutes` (30, `Enabled: true` in the Sales service settings).
`PaymentReconciliationService` keeps the same window under `PaymentReconciliation:StuckAgeMinutes`
and is the backstop for a deadline that was never written: it reconciles `PaymentInitiated` orders
against Stripe (paid -> `MarkAsPaid`, expired -> `MarkAsPaymentFailed`) and expires stranded
`PendingPayment` and `PaymentFailed` orders with the same `PaymentExpired` reason
(`PaymentReconciliationService.cs:274`).

**Payment-failed path:** `OrderPaymentFailedSagaHandler` schedules
`SendOrderPaymentFailedEmailInternalCommand` (the "you can retry" notice) and re-arms the deadline
from now, so a failed payment hands the customer the whole retry window again
(`OrderPaymentFailedSagaHandler.cs:35`, `:81`).

#### Ship Order

**Entry Point:** `PUT /orders/{id}/ship`, `sales:orders:manage`, mandatory `If-Match`

The three fulfilment transitions (ship, shipment, deliver) live on `OrderFulfillmentController`,
which shares the `/orders` route prefix with `OrdersController`.

```
OrderFulfillmentController.ShipAsync()
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
    -> schedules SendOrderShippedEmailInternalCommand (order id only, ADR-114)
  -> SendOrderShippedEmailInternalCommandHandler
    -> re-reads the order and its shipment, so a correction made before the send goes out corrected
    -> recipient: ICustomerService.GetContactInfoByIdAsync(), or the guest's ContactEmail
    -> IEmailSender: carrier, tracking number, tracking link, dates
    -> a missing order, customer or shipment completes the row with a log line; an SMTP fault
       fails the row and is retried
```

The mock shipping label printed at checkout (3.2) is separate from this shipment: it is issued by
`MockShippingLabelProvider` and shown only in the admin order view.

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
same unit of work. Raises the in-process `OrderDelivered` and, for a customer's order, the
`OrderFulfilled` integration event carrying the delivered line snapshot, which Catalog turns into the
verified-purchase entitlements behind product reviews (Section 2.5). A guest order raises
`OrderDelivered` only, since it has no account to hold an entitlement (`Order.cs:743-757`). The snapshot travels on the event because the
consumer lives in another service and cannot query back ([ADR-006](../adr/006-database-per-service.md)),
which is also why callers load `OrderLines` with the aggregate.

**Delivery email:** `OrderDeliveredHandler` schedules `SendOrderDeliveredEmailInternalCommand`
(ADR-114, order id only) after the commit; a scheduling failure is logged, not thrown, because the
order is already Delivered (`OrderDeliveredHandler.cs:25-43`). The handler tells the order's
recipient (the customer through `ICustomerService`, or a guest's `ContactEmail`, `OrderRecipient`)
that the order arrived (`SendOrderDeliveredEmailInternalCommandHandler.cs:43-58`).

The admin order grid searches tracking numbers: the filter name `ShipmentTrackingNumber` maps to the
scalar column the owned shipment flattens onto, so it is one server-side CONTAINS rather than a client
scan.

#### Cancel Order

**Entry Point:** `PUT /orders/{id}/cancel`, Owner or Admin (ownership validated in the controller),
mandatory `If-Match`, no body

```
OrdersController.CancelAsync()
  -> CancelOrderHandler   (CancelOrderCommand: ICacheInvalidating)
    -> Fetch Order; refuse a stale If-Match token first (OrderConcurrency.EnsureCurrent)
    -> leaving PaymentInitiated: retire the live Stripe checkout session inline
       (PaymentSessionRetirement); a session Stripe reports PAID refuses the cancellation
    -> order.MarkAsCancelled()
      -> Validates status is PendingPayment, PaymentInitiated, or PaymentFailed
      -> Status -> Cancelled, publishes OrderCancelled
    -> SaveChangesAsync()          <-- cancellation commits here; no inventory work inline

  (then, after commit)
  -> OrderCancelledSagaHandler  [ADR-054 compensating action, own DI scope]
    -> unitOfWork.ExecuteInTransactionAsync(RestoreAsync):    <-- one transaction
      -> Skip if order.InventoryRestored is already set (idempotent under redelivery)
      -> validate the restore against a non-tracking inventory snapshot (soft-deleted rows included)
      -> order.MarkInventoryRestored() + SaveChangesAsync (the order rowversion takes the row first)
      -> IInventoryAllocationService.IncrementAsync: atomic relative UPDATE per line
      -> the marker and the stock increases commit together
  -> OrderCancelledHandler      [notification, independent of the saga]
    -> schedules SendOrderCancelledEmailInternalCommand(orderId, reason)   (ADR-114)
    -> SendOrderCancelledEmailInternalCommandHandler
      -> recipient: OrderRecipient (the customer, or the guest's ContactEmail)
      -> Requested: "Order Cancelled"; PaymentExpired: "Your unpaid order expired"
```

**Cancellation email:** every cancellation path raises the same `OrderCancelled`, which carries an
`OrderCancellationReason`: `Requested` for a customer, guest or admin cancel, `PaymentExpired` for
the payment deadline and the reconciliation sweep (`OrderCancellationReason.cs:13-23`,
`Order.cs:879`). The reason rides the event and the internal command row only; no column stores it.
`OrderCancelledHandler` schedules the notice beside the inventory saga, neither depending on the
other (`OrderCancelledHandler.cs:24-50`), and the send picks the wording from the reason, so an
order the shopper never cancelled is described as an expired unpaid order whose items were released
(`SendOrderCancelledEmailInternalCommandHandler.cs:54-78`).

**Inventory Impact:** All reserved inventory is restored on cancellation, by a **compensating handler
that runs after** the cancellation transaction, not inside it ([ADR-054](../adr/054-saga-compensation-and-reconciliation.md)).
`Order.InventoryRestored` is the idempotency marker, committed in the same transaction as the
restoration, so an at-least-once redelivery cannot double-restore; the order's rowversion token makes
two concurrent deliveries mutually exclusive. The same saga runs whatever cancelled the order: a
customer or admin here, a guest from the private link (3.5), the payment deadline, or the
reconciliation sweep. Splitting compensation out of `CancelOrderHandler` is what lets further actions
(the cancellation email above, a refund) be added as new handlers rather than edits. The one compensating step that stays inline is retiring the payment
session, because it has to answer "has this already been paid?" BEFORE the cancellation commits.

#### Order Query Endpoints

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /orders` | Authenticated | Customers see only own orders (OrdersByCustomerSpecification); admins see all |
| `GET /orders/paged` | Authenticated | Paginated with same ownership filter |
| `GET /orders/{id}` | Authenticated | Single order with optional includes |
| `GET /orders/lookup` | `sales:orders:manage` | Id/name pairs for pickers |
| `GET /orders/export` | Authenticated | CSV export under the same ownership specification; only an admin exports unscoped (`AllowUnscopedExport`) |

The query endpoints fail closed on a non-admin caller whose `customer_id` claim cannot be resolved
(`RequireResolvableOwner`), so a claim-less Customer token reads nothing rather than every order
([ADR-033](../adr/033-resource-ownership-authorization.md)). A guest order (null `CustomerId`) is
never returned to a customer by these endpoints; it is read through its private link (3.5).

---

### 3.4 Inventory Management

| Workflow | Endpoint | Auth | Behavior |
|----------|----------|------|----------|
| Increase | `PUT /inventoryitems/{id}/increaseinventory` | `sales:inventory:manage` | Adds quantity, validates > 0; mandatory `If-Match`, because a relative adjustment must not stack on a version the caller never saw |
| Decrease | `PUT /inventoryitems/{id}/decreaseinventory` | `sales:inventory:manage` | Subtracts, validates sufficient stock; mandatory `If-Match` |
| Set | `PUT /inventoryitems/{id}/setinventory` | `sales:inventory:manage` | Absolute set (creates if not exists) |
| Bulk set | `PUT /inventoryitems/bulk-setinventory` | `sales:inventory:manage` | Sets inventory for many variants in one transaction, creating the ones that do not exist; returns a `BulkSetInventoryResultDTO` |
| List | `GET /inventoryitems` | `sales:inventory:manage` | All inventory items |
| List (paged) | `GET /inventoryitems/paged` | `sales:inventory:manage` | Paged inventory items |
| Get By ID | `GET /inventoryitems/{id}` | `sales:inventory:manage` | Single inventory item |
| Lookup | `GET /inventoryitems/lookup` | `sales:inventory:manage` | Id/name pairs, inherited from `EntityControllerBase` |
| Export | `GET /inventoryitems/export` | `sales:inventory:manage` | CSV export, inherited; unscoped by design (`AllowUnscopedExport`) |

All mutation operations validate that the product variant exists through `IProductVariantService`
(`ExistsAsync` per item, `GetExistingIdsAsync` for the bulk set) and publish `InventoryAdjusted` when
the quantity actually changes. `IncreaseInventory` and `DecreaseInventory` both route through
`SetInventory`, which is the single place the event is raised (`InventoryItem.cs:140`, `:153`, `:172`).

The whole controller is `[HasPermission(SalesPermissions.InventoryManage)]`; there is no anonymous
inventory read.

---

### 3.5 Guest Checkout

A shopper who has not signed in can buy without an account. The order keeps the guest's name, email,
phone and addresses itself (`Order.CustomerId` is null, `Order.IsGuest` is true), and a private
access token is the guest's only credential for it. Every action but the claim is anonymous; the token
travels in the `GuestOrderHeaders.AccessToken` request header, and every refusal (wrong token, a
customer's order, an order already claimed, an order that does not exist) answers the same NotFound,
so the endpoints cannot be used to learn which order numbers exist (`GetGuestOrderHandler.cs:32`).

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Place guest order | `POST /orders/guest` | AllowAnonymous, `[Idempotent]`, `auth-ip` rate limit | 201 with the order and its access token (`GuestCheckoutResponse`) |
| Read guest order | `GET /orders/guest/{id}` | AllowAnonymous + access token | The order with its lines |
| Pay for guest order | `POST /orders/guest/{id}/checkout` | AllowAnonymous + access token, `[Idempotent]` | Checks the token, then runs the same `CreateCheckoutSessionCommand` as 3.3 |
| Claim into an account | `POST /orders/guest/{id}/claim` | Authenticated + access token, `[NonIdempotent]` | Moves the order into the caller's account; 403 when the account has no customer profile |
| Cancel guest order | `POST /orders/guest/{id}/cancel` | AllowAnonymous + access token, mandatory `If-Match`, `[NonIdempotent]` | Checks the token, then runs the same `CancelOrderCommand` as a customer's cancel (3.3); 204, and every refusal (a status that can no longer be cancelled included) answers 404 (`GuestOrdersController.cs:163-186`) |
| Request a new link | `POST /orders/guest/lookup` | AllowAnonymous, `[Idempotent]`, `auth-ip` rate limit | Order number and checkout email; always 202 with no body (`GuestOrdersController.cs:198-216`) |

**Place guest order:**

```
GuestOrdersController.PlaceOrderAsync()
  -> GuestCheckOutHandler   (GuestCheckOutCommand: ICacheInvalidating, NOT ITransactional)
    -> CheckoutDeliveryMapper.ToDomain(request.Delivery)   (shipping address REQUIRED for a guest)
    -> CheckOutPreflight.ResolvePricesAsync(variantIds)    [OUTSIDE the transaction]
    -> CheckOutPreflight.QuoteChargesAsync(lines, prices, shipTo)
    -> mint the access token: GuestOrderLinks.NewAccessToken(), 32 random bytes, base64url (256 bits)
    -> unitOfWork.ExecuteInTransactionAsync(WriteAsync):
         -> inventory snapshot for existence + fail-fast sufficiency
         -> CheckOutDomainService.ExecuteForGuest() -> Order.CreateForGuest()
              (guest name, contact email and token validated; only the token's SHA-256 hash is kept)
         -> OrderQuoteApplier.Apply() + IPaymentService.EnsureChargeable()
         -> AddAsync, atomic inventory decrements, SaveChangesAsync
         -> PlacedOrderFinalizer.FinalizeAsync()  (shipping label + payment deadline, as in 3.2)
    -> GuestOrderPlacedNotifier.NotifyAsync(order, token)   [after commit, best effort]
         -> "Order Received" email with the private link
            <storefront origin>/orders/guest/{id}#t=<token>
    -> Return order + token
```

The lines come from the shopper's device cart (`GuestCheckoutRequest.Lines`), not from a server cart.
The plaintext token exists only in the checkout response and in the order-received email: the order
stores `GuestAccessTokenHash`, an upper-hex SHA-256 compared in constant time (`Order.cs:528-547`), so
a database read cannot open anyone's order. That is also why the email is sent inline rather than as
an internal command, whose row would put the plaintext back at rest (`GuestOrderPlacedNotifier.cs:17-20`).
The token sits in the URL FRAGMENT, which the browser never sends to a server, so it stays out of
request logs and Referer headers.

**Claim:** `ClaimGuestOrderHandler` checks the token against the stored hash, then
`Order.ClaimForCustomer(customerId)` sets `CustomerId`, clears `GuestAccessTokenHash` (the account,
not the link, is the credential from then on) and raises `OrderChanged` (`Updated`)
(`Order.cs:600-616`). The guest order page offers this right after registering from the order's own
details.

**Cancel:** the guest order page offers Cancel while the order is unpaid (PendingPayment,
PaymentInitiated or PaymentFailed), after a confirmation (`GuestOrderDetail.razor.cs:61-65`,
`GuestOrderDetail.Lifecycle.razor.cs:50-92`). The controller reads the order through the token first,
then runs the customer's cancel use case unchanged: the live Stripe session is retired, the
cancellation saga returns the stock, and the cancellation email goes to `ContactEmail` (3.3).

**Request a new link (find my order):**

```
GuestOrdersController.RequestLinkAsync()
  -> RequestGuestOrderLinkHandler
    -> load the order; no match unless it is an UNCLAIMED guest order whose ContactEmail equals
       the given email (trimmed, case-insensitive; Order.IsGuestOrderFor)
    -> on a match: schedule SendGuestOrderLinkInternalCommand(orderId)   (ADR-114)
    -> every outcome (match, wrong email, customer's or claimed order, unknown number,
       a scheduling failure) -> Result.Success -> 202
  -> SendGuestOrderLinkInternalCommandHandler
    -> still a guest order with a contact email and a storefront origin configured, else
       success with a log line and NO token change
    -> mint a new token, Order.ReplaceGuestAccessToken() (raises OrderChanged, Updated)
    -> email "Your order link" with the new private link to the order's own ContactEmail
    -> THEN SaveChangesAsync: only after a successful send is the new hash saved
```

The handler answers the same success whatever it found, so the endpoint cannot be used to learn which
orders exist or who placed them, and the link only ever goes to the address already on the order
(`RequestGuestOrderLinkHandler.cs:16-21`, `:38-55`). The internal command carries the order id only:
the token is minted inside the handler, so no row ever holds a plaintext token. The send runs before
the save, so a transport fault fails the row with nothing saved and the link the guest already holds
keeps working; a save conflict after the send fails the row too, and the retry mints and sends a
fresh token (`SendGuestOrderLinkInternalCommandHandler.cs:17-32`, `:66-99`). Saving the new hash
retires every earlier link (`Order.cs:571-591`). Both guest emails build the link the same way
(`GuestOrderLinks.cs:19-37`).

**The device bag through guest checkout:** placing a guest order does not empty the browser bag.
Checkout remembers the order id and the lines it was placed with (`Checkout.razor.cs:294-298`,
`GuestCartStore.cs:104-111`); once the guest order page sees the order paid, or the Stripe success
return lands on an order that is neither Cancelled nor PaymentFailed, exactly those quantities are
subtracted from the bag, clamped at zero, so anything added since survives
(`GuestOrderDetail.Lifecycle.razor.cs:23-43`, `GuestCartStore.cs:128-150`). A shopper who abandons
the Stripe page comes back to the bag they left. The sign-in merge settles the same memory first
(4.1, `CartStateService.cs:635-681`).

**Downstream differences for a guest order:** the payment, shipping, payment-failed, delivered and
cancelled emails go to `ContactEmail` (`OrderRecipient.cs:23-40`), the payment confirmation points the
guest at the earlier order-received email rather than repeating the link, and delivery raises no
`OrderFulfilled`, so a guest purchase earns no review entitlement until it is claimed before delivery.

---

### 3.6 Quote and Best Sellers

| Workflow | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Quote a bag | `POST /orders/quote` | AllowAnonymous, `[NonIdempotent]` | Lines plus an optional ship-to; returns `OrderQuoteDTO` (subtotal, shipping, tax or null, total, free-shipping threshold, amount to free shipping). Writes and reserves nothing |
| Best sellers | `GET /orders/best-sellers?count=8` | AllowAnonymous | Variant ids and unit counts only, most units first; `count` 1 to 24 |

`GetOrderQuoteHandler` prices the bag through the same `CheckOutPreflight` and
`OrderChargesCalculator` checkout uses, so the figures the cart drawer and checkout page show are the
ones charged; tax is asked for only when an address comes with the request, because each calculation
is a call to the tax provider. `GetBestSellingVariantsHandler` counts units on orders that were
actually paid for (Paid, Shipped or Delivered) in the last 90 days (`GetBestSellingVariantsHandler.cs:23`,
`:37`); the storefront home page resolves the variants to products through the catalog.

---

## 4. UI Workflows

### 4.1 Customer Shopping Experience (UI-Side)

The storefront is branded C.A.S.A Boutique. The UI provides a complete shopping experience through
the CartDrawer component, the checkout page and Blazor pages, for signed-in customers and for
shoppers who never sign in. The web head is an installable web app: it serves
`manifest.webmanifest` and maps the framework service worker (`MapCommonServiceWorker()`, an offline
page; [ADR-136](../adr/136-installable-web-app-service-worker.md)).

#### Home Page

- `/`, `StoreHome`: hero, the four category tiles, the material banner and promo row, a Best Sellers
  row fed by `GET /orders/best-sellers` (3.6), the gifts feature and the shopping perks. Tiles resolve
  to real catalog categories by name, and a category that does not exist yet or has no products
  hides its tile. The Special Offers banner opens `/catalog?sale=true` and renders only while the
  storefront query with `onSale` returns at least one product (`StoreHome.razor:63-65`,
  `StoreHome.razor.cs:71-74`)
- Info pages `/shipping`, `/returns`, `/contact`, `/privacy`, `/terms` (one `StoreInfo` page) and
  `/about`, written as the store's live copy; the contact page's support email line renders only when
  the support email setting is set (`StoreInfo.razor:26-29`)
- The Store footer on every page links the shop, find my order (`/orders/find`) and the five
  information pages (`StoreFooterLinks.razor:13-19`)
- The shop search sits in the app bar for every visitor (a public app bar component,
  `CatalogUIModule.cs:31`) and sends the term to `/catalog?q=`

#### Cart Drawer (Sole Cart Interface)

The CartDrawer is the only cart UI: there is no dedicated cart page. It is a 380px right-side temporary drawer accessible from any page via the bag icon in the top app bar.

**Features:**
- View cart items with photo, product name, variant (size), unit price and line total
- Quantity +/- controls per item (when cart is Active)
- Remove individual items (when cart is Active) at once, with an Undo in the toast that puts the
  same variant back at the same quantity (`CartDrawer.razor.cs:147-210`)
- Clear all items, after a confirmation (`CartDrawer.razor.cs:212-219`)
- Subtotal plus a free-shipping line ("X away from free shipping" or "Free shipping") from the
  server quote (`POST /orders/quote`)
- Checkout & Pay, which navigates to `/checkout`
- "Checked Out" chip display when cart is not Active
- Read-only quantity display when cart is CheckedOut
- "Continue Shopping" navigation to catalog
- Empty cart state: the C.A.S.A figure, "Your bag is empty" and a Shop button that closes the
  drawer on its way to the catalog (`ShopInvite`)

**State Management:** `ICartStateService` manages cart state centrally: all cart operations go
through this service, which refreshes the cart DTO and its quote after each mutation and notifies
subscribers via the `OnChange` event. Cart items are enriched with product names, SKUs and images
from the Catalog API. A shopper who has not signed in shops against `GuestCartStore`: variant ids and
quantities only, kept on the device (`localStorage` on the web heads, app preferences on MAUI), with
nothing priced or personal stored. When the shopper signs in, the device cart moves into the server
cart (`MergeGuestCartAsync`) on whichever surface first loads the cart. A guest order the bag was
placed as is settled first: its lines are subtracted when the order is paid, shipped or delivered,
or can no longer be read (claimed into an account, or its link replaced); the order is forgotten and
the bag kept whole when it was cancelled; and both stay while it is unpaid
(`CartStateService.cs:612-681`). The bag icon (`CartButton`) is a public app bar component, so the
same button serves a signed-out shopper and a customer (`SalesUIModule.cs:31-33`).

#### Checkout Page

- `/checkout`: every shopper confirms the ship-to address (US-only: state list, ZIP or ZIP+4; the
  form stores "United States") and the billing address (billing = shipping by default) plus an
  optional phone; the summary shows the quote, with sales tax once the address is complete
- A signed-in customer's saved profile address pre-fills the form; the cart becomes the order through
  `PUT /shoppingcarts/{id}/checkout`, then the Stripe session opens
- A signed-out shopper can sign in or register (returning to `/checkout`), or continue as a guest
  with a name and an email: the device cart becomes a guest order (`POST /orders/guest`), the private
  token is remembered on the device, the device cart is kept with the order and its lines remembered
  (3.5), and the guest goes on to pay; if the payment session cannot be opened the guest lands on the
  order page instead
- `OrphanOrderRecovery` (a content-header component) detects an order left in `PendingPayment` or
  `PaymentInitiated` after the shopper backed out of Stripe Checkout and offers to resume it

#### Catalog Browse & Product Detail

- `/catalog`, Product grid on `GET /products/storefront` (2.2) with a search over name and description (`?q=`), a category filter (`?category=`), an On sale toggle (`?sale=true`), and six sorts (name A to Z and Z to A, newest, price low to high and high to low by the lowest effective variant price, top rated; `?sort=`), all kept in the URL; a filtered search with no result offers Clear filters and up to four best sellers (`CatalogBrowse.Filters.razor.cs:18`, `:77-108`); quick "Add to Cart" per variant (a single-variant product adds directly, a multi-variant product opens a variant menu; shown to signed-out shoppers too), and a star rating with review count on each card (read off the product's denormalized `RatingSummary`, so a grid costs no per-card aggregate query)
- `/catalog/{id}`, Product detail with breadcrumbs ending in the product's category and then the product's own name (`CatalogProductDetail.razor.cs:53-67`), the product name as heading, variant (size) buttons, one price, a quantity selector, "Add to Cart", "Buy Now" (adds the variant and opens `/checkout`), info sections (materials, care, shipping, returns) and a reviews section (anchor `#reviews`) listing published reviews with the review editor for an eligible signed-in customer
- A discounted variant reads as a sale on both pages: the card shows a sale badge and an effective-price range, the variant card shows the effective price beside the struck-through list price, and the pair carries a "Was X, now Y" accessible label. The numbers are server-resolved, so a browser clock never decides whether a promotion is running

#### Order Management

- `/orders`, for a customer a list of order cards (order number, status chip, date placed, item count and total, each opening the order) with a search box and Show more paging; for an admin a MudDataGrid listing orders with ID, customer, total, status chips (Shipped included), item count, where the search box also matches tracking numbers. The page picks the view by role (`OrderList.razor:24-29`, `OrderList.razor.cs:84`, `CustomerOrderList.razor:38-86`). The profile page links to it ("My orders", `Profile.razor:13-16`)
- `/orders/{id}`, Two-column layout: order summary (status, date placed, total, payment/shipping/delivery actions, and the carrier, tracking number and tracking link once the order ships) + order lines. Once the Stripe return confirms payment, a thank-you block above the summary restates the order number and date, says where the receipt went and what happens next (`OrderDetail.razor:68-73`, `OrderConfirmation.razor:8-23`). A customer's Cancel asks for confirmation first (`OrderSummaryPanel.razor.cs:187-191`). The delivery panel shows the shipping label to an admin only. The admin ship and correct-tracking actions open one `ShipOrderDialog`, which serves both endpoints
- `/orders/guest/{id}`, the guest order page opened from the private link (token in the `#t=` fragment): order number and items with photos, addresses, status, date, tracking and the full totals, pay now (or a short wait while a Stripe return is confirmed), a thank-you block once paid, Cancel order while unpaid (after a confirmation, `POST /orders/guest/{id}/cancel`), and the offer to create an account, which registers with the order's own details, signs in and claims THIS order (`POST /orders/guest/{id}/claim`). A link that does not open the order offers find my order (`GuestOrderDetail.razor:22-28`, `:42-49`, `:77-95`)
- `/orders/find`, find my order: the order number and the checkout email; the page always shows the same "check your email" confirmation, because `POST /orders/guest/lookup` answers 202 whatever it matched (3.5, `FindGuestOrder.razor.cs:43-80`)
- A discounted order line reads the same way the storefront does: the struck list price beside the price charged, a chip carrying the promotion label, and a "Was X, now Y" sentence for assistive tech since the two bare numbers are hidden from it. The order adds a "you saved" row when its total savings are above zero. Every number is the one frozen at checkout, so an order page never re-prices against a promotion that has since ended

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
| Cart Detail | `/shoppingcarts/{id}` | Admin cart view with add/remove/clear/checkout; checkout on the customer's behalf sends an empty body, so the order carries no addresses and no label |
| Customers | `/customers` | MudDataGrid: name, email, delete |
| Customer Create | `/customers/create` | Customer creation form |
| Customer Detail | `/customers/{id}` | Customer view/edit |
| Users | `/users` | The framework `UserAdminList`: roster, deactivate/reactivate (lock/unlock) and role actions |
| User Detail | `/users/{id}` | Read-only view of one account plus the same two operator actions (deactivate/reactivate, change role) |
| Roles | `/roles` | The framework `RoleAdminList`: every role with its permission grants |
| Role Edit | `/roles/{role}` | The framework `RoleAdminEdit`: edit the stored permission grants of one role |

### 4.3 User Profile & Auth

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Email/password form, link to register (framework page) |
| Register | `/register` | Name, email, password, optional address (framework page) |
| Profile | `/profile` | "My orders" link, edit name and address (the state is a picker over the US postal regions by USPS code, the same list checkout uses, `Profile.razor:68-76`), change password, "Manage devices" link to the session list, and the "Your data" card (data-subject rights, 1.9) |

### 4.4 Navigation Structure

**Sidebar Navigation** (role-based, dynamically populated from `IUIModule` registrations; Home comes
from the framework `NavMenu`):

**Customer:**
- Home (`/`)
- Shop (`/catalog`)
- My Orders (`/orders`)
- My Profile (`/profile`)

**Admin:**
- Home (`/`)
- Shop (`/catalog`)
- Categories (`/categories`)
- Products (`/products`)
- Reviews (`/reviews`)
- Inventory (`/inventory`)
- Shopping Carts (`/shoppingcarts`)
- Orders (`/orders`)
- Customers (`/customers`)
- User accounts (`/users`)
- Roles (`/roles`)
- My Profile (`/profile`)

**Top App Bar:**
- For every visitor, signed in or not (the modules' `PublicAppBarComponentTypes`, rendered by the
  framework since MMCA.Common v1.265.0, also in the mobile quick-actions row): the shop search
  (`StoreSearchBox`, `CatalogUIModule.cs:31`) and the shopping bag icon with badge opening the
  CartDrawer (`CartButton`, `SalesUIModule.cs:33`), which reads the device cart for a signed-out
  shopper and the server cart for a customer
- User email display
- Logout button (authenticated)
- Login / Register buttons (anonymous)

---

## 5. Cross-Module Interactions

| From -> To | Interface | Methods Used | Context |
|-----------|-----------|-------------|---------|
| Sales -> Catalog | `IProductVariantService` | `ExistsAsync()` | Cart item validation, inventory adjustment guard |
| Sales -> Catalog | `IProductVariantService` | `GetUnitPricesAsync()` | Checkout, guest checkout and quote pricing: effective price, list price and promotion label per variant |
| Sales -> Catalog | `IProductVariantService` | `GetExistingIdsAsync()`, `GetCatalogInfoAsync()` | Bulk inventory set (existence plus the denormalized SKU / product labels); the denormalized labels on inventory create and set and in the denormalization backfill; seeding |
| Sales -> Catalog | `IProductVariantService` | `GetIdBySkuAsync()` | Seed data inventory setup |
| Catalog (internal) | `IProductVariantService` | `SkuExistsAsync()` | SKU uniqueness on add / change SKU |
| Sales -> Identity | `ICustomerService` | `GetContactInfoByIdAsync()` | Customer display name frozen at checkout (best effort); recipient of the order paid / shipped / payment-failed / delivered / cancelled emails; the denormalization backfill |
| Identity -> Sales | `IUserSalesExportService` | `GetUserSalesExportAsync()` | Orders section of the data-subject export |
| Identity -> Catalog | `IUserCatalogExportService` | `GetUserCatalogExportAsync()` | Product-reviews section of the same export |
| Identity (event) | Domain Event | `UserRegisteredHandler`, `UserRegisteredEmailConfirmationHandler` | Auto-creates and links the Customer on registration; schedules the confirmation email |

In the extracted service hosts these interfaces resolve to typed gRPC clients from the `*.Contracts`
projects, which `Replace` both the in-process implementation and the disabled-module stub, with a
Polly retry and circuit-breaker pipeline. Calls with no user token to forward (the Stripe webhook,
payment reconciliation, the order-email internal commands) carry the HS256 service token that
Identity's `InternalCaller` policy requires.

Both export edges are **best-effort**: an unreachable peer degrades that one section rather than
failing the export, so neither carries a startup wait.

Asynchronously, four integration events cross the boundary through the outbox and the broker. Each is
the consumer's trigger to refresh a denormalized copy IT owns, never a prompt to query back into the
publisher ([ADR-006](../adr/006-database-per-service.md)):

| Event | Publisher -> Consumer | What the consumer does |
|-------|-----------------------|------------------------|
| `Catalog.ProductVariantChanged.v1` | Catalog -> Sales | Creates the zero-stock inventory record; refreshes the denormalized SKU / product sort labels |
| `Catalog.ProductInfoChanged.v1` | Catalog -> Sales | Fans a product rename or delete out to those same labels |
| `Sales.OrderFulfilled.v1` | Sales -> Catalog | Writes one `VerifiedPurchase` per delivered product (Section 2.5); raised for customer orders only |
| `Identity.CustomerErased.v1` | Identity -> Sales and Catalog | Sales clears the frozen order customer name; Catalog anonymizes the customer's reviews, keeping the ratings |

**Module dependency:** `SalesModule` declares `Dependencies => ["Catalog", "Identity"]` with
`RequiresDependencies = true`, so in a combined host both peers register and seed first. When Catalog
is disabled, `CatalogModule.RegisterDisabledStubs` registers `DisabledProductVariantService` (and
`DisabledUserCatalogExportService`), which the gRPC client registration overwrites in the Sales host.

---

## 6. External Interactions

| System | Purpose | Integration Point |
|--------|---------|-------------------|
| **Stripe** | Payment processing | `StripePaymentService`: creates and reads hosted checkout sessions (merchandise, shipping and tax as separate lines, payer email pre-filled), expires sessions on cancel, parses and verifies webhooks; `StripeWebhookRegistrationService` registers the endpoint |
| **Stripe Tax** | Sales tax | `StripeTaxCalculator` (`ITaxCalculator`): tax on the merchandise and shipping from the ship-to address, tax-exclusive prices; not called while `Tax:Enabled` is off, which is the default (`StripeTaxCalculator.cs:12-21`) |
| **Shipping label provider** | Label at order placement | `MockShippingLabelProvider` (`IShippingLabelProvider`): an invented `CASA-{order}-{random}` label number and a `MOCK...` tracking number, no network call (`MockShippingLabelProvider.cs:10-16`) |
| **SQL Server** | Primary persistence | Via EF Core + Aspire container orchestration, one database per service (`Store_Catalog`, `Store_Sales`, `Store_Identity`) |
| **SQLite / Cosmos DB** | Alternative persistence | Configurable via `IDbContextFactory` strategy |
| **SMTP** | Transactional email | `IEmailSender` (`SmtpEmailSender` from MMCA.Common), driven by the Identity password-reset and email-confirmation flows, the Sales internal-command handlers `SendOrderPaidEmailInternalCommandHandler`, `SendOrderShippedEmailInternalCommandHandler`, `SendOrderPaymentFailedEmailInternalCommandHandler`, `SendOrderDeliveredEmailInternalCommandHandler`, `SendOrderCancelledEmailInternalCommandHandler` and `SendGuestOrderLinkInternalCommandHandler`, and the inline `GuestOrderPlacedNotifier` |
| **Message broker** | Cross-service integration events | MassTransit over RabbitMQ locally and Azure Service Bus in production, fed by the per-service outbox |

---

## 7. Cross-Cutting Concerns Participating in Workflows

| Concern | Implementation | Impact |
|---------|---------------|--------|
| **Transactions** | `ITransactional` marker -> `TransactionalCommandDecorator` wraps in DB transaction; handlers that call another service first open their own via `ExecuteInTransactionAsync` around the write phase only ([ADR-107](../adr/107-transaction-execution-contract.md)) | Marker: add variant, upload image, reorder images. Explicit: cart checkout, guest checkout, order-cancelled saga. Neither: the webhook and verify-payment (one atomic `SaveChangesAsync` each) |
| **Cache Invalidation** | `ICacheInvalidating` marker -> `CachingCommandDecorator` clears cache by prefix; Catalog controllers also evict the `catalog:products` / `catalog:categories` output-cache tags | All mutation commands |
| **Internal Commands** | `IInternalCommandScheduler` writes a durable row run by the framework processor with backoff ([ADR-114](../adr/114-internal-commands-durable-job-queue.md)) | Order paid / shipped / payment-failed / delivered / cancelled emails, the replacement guest order link, `Sales.ExpireUnpaidOrder`, `Catalog.PublishProductVariantChanged`, `Identity.SendEmailConfirmation` |
| **Idempotency** | `[Idempotent]` attribute -> `IdempotencyFilter` caches response by `Idempotency-Key` header for 24h with per-key locking (`IdempotencyFilter.cs:81`); `[NonIdempotent("reason")]` marks the deliberate exceptions | Create (POST) endpoints, cart checkout, guest checkout and payment, the guest link request, forgot/reset password, email confirmation; not login, register, refresh, revoke, the webhook, the quote, the guest claim and cancel, or user lock/unlock |
| **Authorization** | `[HasPermission(...)]` capabilities granted to roles in compiled code plus stored grants ([ADR-020](../adr/020-permission-based-authorization.md)); `OwnerOrAdminFilter` on cart/customer endpoints and in-controller ownership checks (404 for a non-owner) on order endpoints; ownership specifications on collection reads ([ADR-033](../adr/033-resource-ownership-authorization.md)) | Customers access only own data |
| **Optimistic Concurrency** | `[SupportsIfMatch]`: mandatory `If-Match`, 412 on a stale token, 428 when absent ([ADR-035](../adr/035-optimistic-concurrency.md)) | Every conditional PUT and the discount DELETE |
| **Feature Flags** | `[FeatureGate]` on controllers, `IFeatureGated` on commands ([ADR-031](../adr/031-feature-flag-management.md)) | Product images (`CatalogFeatures.ProductImages`), verify payment (`Sales.PaymentVerification`) |
| **Rate Limiting** | Service-side global limiter: 300 req/min per authenticated user, fixed window, anonymous traffic exempt (`RateLimitingSettings.cs:40`); `auth-ip` policy 30 req/min per client IP (`:47`) on register, login, password reset, email confirmation, guest checkout and the guest link request; Gateway edge limiter 120 req/min per IP with `/Payments` bypassed (Gateway `appsettings.json:16-20`) | All API endpoints |
| **Exception Handling** | Registered handler chain: OperationCanceled -> Domain -> DbUpdate -> Validation -> Global (`MMCA.Common.API/DependencyInjection.cs:159-163`) | Maps errors to HTTP status codes |
| **Timeouts** | `IHasTimeout` -> `TimeoutCommandDecorator` | Create checkout session (45 s), verify payment (20 s) |
| **Profiling** | `ProfilingCommandDecorator` / `ProfilingQueryDecorator` via MiniProfiler | All handlers when `UseMiniProfiler=true` |
| **API Versioning** | Header-based via `api-version` header, all controllers declare `[ApiVersion("1.0")]`; `GET /serviceinfo` (Catalog) serves a deprecated v1.0 and a v2.0 shape from `ServiceInfoControllerBase` | All endpoints |

---

## 8. End-to-End Customer Journey

```
1. Register          POST /auth/register        -> User + Customer created, tokens issued
2. Browse Catalog    GET /products/storefront    -> Search, filter and sort products with variants and prices
3. Add to Cart       POST /shoppingcarts/{id}/shoppingcartitems  -> Cart created/updated
4. Adjust Cart       PUT/DELETE cart items        -> Modify quantities or remove items
                     POST /orders/quote           -> Subtotal, shipping, distance to free shipping
5. Checkout          PUT /shoppingcarts/{id}/checkout  -> Order created with addresses, shipping,
                                                    tax and label; inventory reserved; payment
                                                    deadline armed
6. Pay               POST /orders/{id}/checkout   -> Stripe session created, redirect to payment
7. Payment Complete  POST /payments/webhook        -> Stripe confirms, order marked Paid, receipt queued
8. Shipment          PUT /orders/{id}/ship         -> Admin records carrier + tracking, customer emailed
9. Delivery          PUT /orders/{id}/deliver      -> Admin marks as Delivered, customer emailed,
                                                     OrderFulfilled published
10. Entitlement      (broker)                      -> Catalog writes one VerifiedPurchase per product
11. Review           POST /reviews/by-product/{id} -> Customer rates the product they received
```

**Guest Journey:**

```
1. Browse + Add      device cart (GuestCartStore)  -> No account, nothing priced stored
2. Quote             POST /orders/quote            -> Totals, then tax once the address is complete
3. Place order       POST /orders/guest            -> Guest order + private token; order-received
                                                     email with the private link
4. Pay               POST /orders/guest/{id}/checkout -> Stripe session (token in a header)
5. Payment Complete  POST /payments/webhook        -> Order marked Paid, receipt to ContactEmail
6. Follow the order  GET /orders/guest/{id}        -> Status, tracking and totals from the link;
                                                     once paid, the ordered lines leave the bag
7. Optional claim    POST /orders/guest/{id}/claim -> After registering, the order joins the account
8. Lost the link     POST /orders/guest/lookup     -> Always 202; on a match a new link is emailed
                                                     and every earlier link stops working
```

**Alternative Flows:**

- Payment fails -> Order status `PaymentFailed` -> retry notice emailed, payment window restarted -> customer can retry (create new Stripe session)
- Payment never lands -> `Sales.ExpireUnpaidOrder` (or the reconciliation sweep) cancels the order after 30 minutes -> inventory restored -> "your unpaid order expired" email
- Cancel order (customer after a confirmation, guest from the private link, or admin) -> Status `Cancelled` (from PendingPayment, PaymentInitiated, or PaymentFailed) -> live Stripe session expired -> inventory restored -> cancellation email
- Cart reactivation -> Checked-out cart auto-reactivated on next add-item (all old items cleared)
- Manual payment -> Admin bypasses Stripe, sets `StripePaymentIntentId = "manual-admin-override"`
- Admin checkout on behalf -> Admin checks a customer's cart out from `/shoppingcarts/{id}` with an empty body (no addresses, no label, no tax)

---

## 9. Potentially Missing or Incomplete Workflows

| Observation | Evidence | Recommendation |
|-------------|----------|----------------|
| **No refund workflow** | Order can be cancelled only before payment completes (PendingPayment/PaymentInitiated/PaymentFailed); no refund logic for Paid orders. A second charge on an already-paid order is only logged "may require a refund" (`ProcessPaymentWebhookHandler.cs:199-200`) | Verify if refunds are handled externally via Stripe dashboard or if a refund workflow is planned |
| **No order editing** | Once checkout completes, order lines cannot be modified | Confirm if this is intentional or if order amendment is planned |
| **No email when a signed-in customer places an order** | Email exists for guest order placement (`GuestOrderPlacedNotifier`), payment, shipment, payment failure, delivery (`OrderDeliveredHandler`) and cancellation (`OrderCancelledHandler`, worded by `OrderCancellationReason`), for customers and guests alike; a customer's order gets nothing on `OrderChanged` (`Added`). The absence is a deliberate owner decision: the payment receipt is what confirms a customer's order | None; recorded so the absence is not mistaken for a gap |
| **No full-text search** | The storefront search is a contains match over the product name or description (`StorefrontProductsSpecification.cs:70-74`, E2E-covered); there is no full-text, fuzzy or ranked search | Consider full-text search for larger catalogs |
| **Inventory not checked during cart add** | Inventory validation only happens at checkout, not when adding to cart (`AddItemHandler` checks only variant existence) | Could lead to poor UX if items go out of stock between add and checkout |
| **No post-payment cancellation** | Cancellation allowed from PendingPayment, PaymentInitiated, or PaymentFailed; cannot cancel after payment succeeds | Verify if post-payment cancellation with Stripe refund is needed |
| **No partial fulfillment** | Orders ship and are delivered as a whole: `Shipped` applies to the order, not to individual lines, and an order carries one `Shipment` value object | A second parcel means turning the shipment into a collection; clarify whether split shipments are a real business case first |
| **No refund compensation handler** | [ADR-054](../adr/054-saga-compensation-and-reconciliation.md) makes refunds a natural further saga handler alongside `OrderCancelledSagaHandler` and `OrderPaymentFailedSagaHandler`, but none exists | Add when post-payment cancellation lands |
| **Shipping labels are mock only** | `MockShippingLabelProvider` is the only `IShippingLabelProvider`; the label is invented and is not linked to the `Shipment` an admin records later | Wire a real carrier provider behind the same interface when label purchase is in scope |
| **Sales tax off by default** | `TaxSettings.Enabled` defaults to false and the Sales service settings declare no `Tax` section, so every order carries zero tax until Stripe Tax is activated on the account | An owner decision plus a setting; no code change |
| **Guest orders delivered unclaimed earn no review entitlement** | `MarkAsDelivered` raises `OrderFulfilled` only when `CustomerId` is set but stamps `FulfilledPublishedOn` either way (`Order.cs:750-757`), so neither a later claim, the backfill nor `RepublishFulfillment` publishes it | Decide whether a claim after delivery should mint the entitlement |

---

*This document is derived from source code analysis. All workflows, decisions, and behaviors described above are confirmed implementations traceable to the referenced source files. Last updated: 2026-10-28.*
