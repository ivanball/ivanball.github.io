# ADR-091: Cache-Backed Password Reset

## Status
Accepted (2026-08-22). Extends [ADR-029](029-authentication-brute-force-protection.md) (the
cache-backed login-protection idiom this record reuses) and [ADR-032](032-password-hashing.md) (which
decided how a password is stored, never how a user who has lost one gets a new one). The existing
authentication chain is untouched: this is an additive sibling, not a revision.

## Context
Both consumer apps shipped authenticated password *change* (`PUT /Auth/password`) and nothing for a
user who cannot sign in at all. The recorded fallback in MMCA.ADC's specification was for an organizer
to delete the account so the attendee could re-register, which is a support burden, destroys the
user's engagement history, and is not a posture a second consumer (MMCA.Store, where an account owns
orders) can adopt at all.

Three shapes were available for the reset credential:

1. **Database columns on the user row** (`ResetTokenHash`, `ResetTokenExpiresAt`, `ResetAttempts`):
   the conventional choice, and the one that costs a migration in every consumer, adds three columns
   to the hottest entity in the system, and needs a sweeper to reap expired rows because expiry is
   not a property the store enforces.
2. **A self-contained signed payload** (an ASP.NET Core Data Protection token, or a short-lived JWT):
   no storage at all, but single-use is then unimplementable without a store anyway, since a signed
   token that has not expired stays valid however many times it is redeemed. Bolting a revocation
   list back on reintroduces the store while keeping the payload's opacity problems.
3. **A cache record keyed by the address**, which is exactly the substrate
   [ADR-029](029-authentication-brute-force-protection.md) already chose for login lockout and
   registration caps, and [ADR-026](026-caching-strategy.md) already guarantees is present in every
   host.

The endpoint contract carried its own decision. A naive forgot-password endpoint that answers 404 for
an unknown address is an account-enumeration oracle: an attacker with a list of addresses learns
which ones are registered, at any rate the anonymous limiter allows. So does a 400 on a throttled
address, and so does a 500 when the SMTP hop is down.

## Decision
1. **The reset token is a cache record, not a schema change.** `IPasswordResetTokenService`
   (`Source/Core/MMCA.Common.Application/Auth/IPasswordResetTokenService.cs`) is two methods,
   `IssueAsync(email, userId)` and `ValidateAndConsumeAsync(email, token)`, both returning `Result`.
   The implementation (`Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs`)
   writes one `pwdreset:token:{email}` record and one `pwdreset:req:{email}` counter through
   `ICacheService`, deliberately mirroring `LoginProtectionService` down to the address
   normalization, the key-builder shape, the `IncrementAsync` throttle and the disclosed
   read-modify-write race. Expiry is the cache TTL: there is no sweeper and no reaper job, because
   there is no row to reap.
2. **The token's security properties are in the service, not in the caller.** 256 bits from
   `RandomNumberGenerator`, Base64Url-encoded; only its SHA-256 is stored, so a cache dump hands out
   no working links; comparison is `CryptographicOperations.FixedTimeEquals`; issuing overwrites, so
   one address has at most one live token; a wrong guess increments an attempt counter and rewrites
   the record with its **remaining** lifetime rather than a fresh one, so guessing cannot extend the
   window; the record is discarded at `MaxValidationAttempts`. Every bound lives in
   `PasswordResetSettings` (section `PasswordReset`, `[Range]`-validated and `ValidateOnStart` per
   [ADR-070](070-fail-fast-configuration-contract.md)): 30-minute TTL, 5 validation attempts, 3
   requests per address per 60-minute window, plus an optional `ResetUrl`.
3. **The anti-enumeration contract lives in the handler base, where it cannot be forgotten.**
   `ForgotPasswordHandlerBase` returns `Result.Success()` on every path: malformed address, no
   account, throttled, and failed send each log a reason and report success. `ResetPasswordHandlerBase`
   collapses every rejection (unknown, expired, mismatched, attempt-capped token, and an account that
   no longer resolves) into one `Auth.InvalidResetToken` error, which the edge maps to 401. A
   consumer therefore inherits the property rather than re-deriving it; the only app-specific member
   on the forgot base is `FindUntrackedByEmailAsync`, because each app's `User` stores its address
   differently.
4. **The endpoints ship as an opt-in sibling controller base.** `PasswordResetAuthControllerBase`
   (`Source/Presentation/MMCA.Common.API/Controllers/`) exposes `POST forgot-password` (202) and
   `POST reset-password` (204), both `[AllowAnonymous]`, both `[Idempotent]`, both under the `auth-ip`
   per-IP policy from [ADR-019](019-rate-limiting.md). It is a sibling of `AuthControllerBase` rather
   than two more actions on it because both apps' `AuthController` already occupies that single
   inheritance chain; a consumer routes the new controller to the same `Auth` prefix, so the existing
   gateway route forwards it with no gateway change. Nothing about the existing auth chain changes,
   so adopting this is additive.
5. **The email is composed in the handler, with overridable hooks, and delivered best-effort.**
   `ComposeSubject`, `ComposeBody` and `ComposeResetLink` are `protected virtual`. The default body
   carries the reset link **and** the raw token, because the MAUI head cannot follow a deep link and
   its user has to type the token into the reset page. A blank `ResetUrl` degrades to the token
   alone rather than shipping a broken link. Copy is English only in this version. The send is
   awaited and its failure caught, logged and swallowed.
6. **Consumers opt in with thin wiring.** Each app adds a `ForgotPasswordCommand` /
   `ResetPasswordCommand` record, a handler that is a constructor call on the base, and a sealed
   `PasswordResetController` supplying the two command factories. Configuration is one key
   (`PasswordReset:ResetUrl`) in `appsettings.json`, in the Aspire AppHost for local runs, and as
   `PasswordReset__ResetUrl` in `infra/main.bicep` for production. MMCA.ADC and MMCA.Store both
   adopted it in v1.160.0.

## Rationale
- **No migration is the whole point.** A reset credential is short-lived by nature, and the
  expiry semantics a reset needs (a TTL, a single use, an attempt cap) are native to a cache and
  bolted on to a relational table. Choosing the cache means the feature ships to two production apps
  and a reference app without touching a schema, and the "expired token" state is enforced by the
  store instead of by a query filter someone can forget to write.
- **Reusing the login-protection idiom is a correctness argument, not a style one.** The address
  normalization in particular is load-bearing and easy to get wrong: keys built from raw request
  input give `User@x.com` and `user@x.com` independent tokens and independent counters while
  resolving to one account. Reusing the proven method removes that class of bug rather than
  re-litigating it.
- **A contract that must hold on every path belongs in the base.** Anti-enumeration is the kind of
  property that survives review and dies in the second consumer's copy of the handler. Making
  `Result.Success()` the only return of the forgot-password workflow means a subclass cannot leak the
  distinction even by accident.
- **Single-use is what rules out the signed-payload option.** The cheap-looking alternative, a Data
  Protection token with no server state, cannot express "redeemable once" without adding server
  state, at which point it has the storage cost of this design plus an opaque payload.

## Trade-offs
- **Cache eviction invalidates outstanding tokens.** A Redis restart, an eviction under memory
  pressure, or a fall back to the in-memory store on a different replica all silently kill live reset
  links. Accepted: re-requesting a link costs the user one page and one email, the failure mode is
  self-explanatory ("the link is invalid or has expired, request a new one"), and the same
  reasoning already governs login lockout state.
- **A timing oracle remains.** The response body and status code disclose nothing, but a registered
  address does more work (a database read, a cache write, an SMTP round trip) than an unregistered
  one, so the *duration* still correlates with existence. Closing that would mean either constant-time
  padding or moving the send off the request path onto the outbox. Neither is done, and this is the
  known residual of the always-202 contract rather than a defect in it.
- **Email delivery has no outbox and no retry.** A send that fails is logged and dropped. The
  transactional-email posture recorded in [ADR-024](024-push-notifications.md) is app-level and
  outside the durable notification channel, and the token surviving the failure is what makes a
  user-driven retry sufficient. A reset email that must not be lost would need the outbox, which is a
  larger decision than this record makes.
- **The request throttle undercounts under concurrency.** `IncrementAsync` is a read-modify-write on
  every backing store ([ADR-026](026-caching-strategy.md)), so simultaneous requests can slip past
  the per-address cap. It loosens the throttle and never tightens it, and the `auth-ip` limiter sits
  underneath, so the failure mode is bounded.
- **The token is consumed before the password is written.** A password change that fails a later
  aggregate invariant burns the token, costing the user one more request. The alternative, holding
  the token live until the write succeeds, opens a replay window, which is the worse of the two.
- **Copy is English only.** The composition hooks exist and the localization pass does not, so a
  Spanish-speaking user ([ADR-027](027-multi-locale-i18n.md)) reads an English reset email.
