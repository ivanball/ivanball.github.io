# ADR-047: Runtime Revocation of Soft-Deleted Users' Active Sessions

## Status
Accepted (2026-07-15).

## Context
Soft-delete is the framework's default deletion model (ADR-005): `AuditableBaseEntity.Delete()` sets
`IsDeleted = true` and EF global query filters hide the row, but the record survives for audit,
referential integrity, and undelete. Deactivating a user account is therefore a soft-delete, not a
row removal.

Authentication is stateless JWT (ADR-004): Identity mints an access token, and every service
validates it by signature and expiry without a per-request lookup against the account store. That is
exactly what makes it scale, and it is also the problem here. A JWT is a bearer credential that stays
valid until it expires; nothing in signature validation asks "is this account still active?" So when
an administrator soft-deletes a user, that user's already-issued access token keeps passing
validation on every service until it expires on its own. The same gap applies to the SSR session
cookie that carries the JWT for fresh browser GETs (ADR-022): the cookie handler populates
`HttpContext.User` from a token the API already issued, so a deleted user's prerender path also stays
authenticated until the token lifetime runs out.

Closing that gap the textbook way (a token deny-list or a per-request account-status check) reintroduces
exactly the stateful, per-request store lookup that stateless JWT was chosen to avoid. We wanted the
deletion to take effect quickly without paying a database round trip on every authenticated request,
and without coupling every extracted service to the Identity database.

## Decision
Add a shared-pipeline middleware, `SoftDeletedUserMiddleware`
(`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`, BR-133), that
rejects an authenticated caller with HTTP 401 once the caller's account has been soft-deleted, backed
by a short cache so the account-status lookup is not paid on every request.

- **It runs after authentication, before authorization.** `UseCommonMiddlewarePipeline` registers it
  at `Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:109`, immediately after
  `UseAuthentication` / `UseRateLimiter`
  (`WebApplicationExtensions.cs:96,108`) and before `UseAuthorization`
  (`WebApplicationExtensions.cs:110`), so `HttpContext.User` is already populated and the check gates
  every downstream endpoint.
- **Anonymous requests pass straight through.** When `ICurrentUserService.UserId` is null the
  middleware calls the next delegate and returns without any lookup
  (`SoftDeletedUserMiddleware.cs:65-73`), so unauthenticated traffic pays nothing.
- **The account-status check is an abstraction, implemented once in the framework.**
  `ISoftDeletedUserValidator`
  (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7`)
  exposes a single `IsUserSoftDeletedAsync(userId, ...)` method
  (`ISoftDeletedUserValidator.cs:15`). One shared generic implementation,
  `SoftDeletedUserValidator<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19-34`), runs
  the filter-bypassing existence query
  `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, ...)`
  (`SoftDeletedUserValidator.cs:30-33`) against whichever aggregate it is closed over
  (`TUser : AuditableAggregateRootEntity<UserIdentifierType>`, `SoftDeletedUserValidator.cs:20`). Each
  app closes it over its own `User` at registration and writes no subclass of its own
  (`services.TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()` at
  `MMCA.ADC.Identity.Application/DependencyInjection.cs:35` and
  `MMCA.Store.Identity.Application/DependencyInjection.cs:41`). The query bypasses the soft-delete
  global query filter deliberately, because a plain read would hide the very row it needs to find.
- **A 30-second cache amortizes the lookup.** The key shape and the marker lifetime live in a shared
  class rather than inside the middleware, because a module that deletes an account has to write the
  exact key the middleware reads and a private constant in the presentation layer is unreachable from
  an application-layer handler. `SoftDeletedUserCache.MarkerDuration` is `TimeSpan.FromSeconds(30)`
  (`Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`), and
  `SoftDeletedUserCache.KeyFor(userId)` builds `user:deleted:{userId}` under the invariant culture
  (`SoftDeletedUserCache.cs:42-43`). The middleware builds that key
  (`SoftDeletedUserMiddleware.cs:85`) and reads it from `ICacheService` first (`:91`): a cached `true`
  short-circuits to 401 with no database call (`:102-106`); a cache miss runs the validator once
  (`:114-116`), caches the boolean for `MarkerDuration` (`:131-133`), and 401s if deleted (`:143-147`);
  a cached `false` falls through to the next delegate (`:150`). So a given user costs at most one
  status query per 30-second window per cache scope, not one per request.
- **The check fails open.** Every external call on the path is wrapped: a cache read failure is logged
  and falls through to the validator query (`SoftDeletedUserMiddleware.cs:93-100`), a validator failure
  is logged and the request proceeds (`:118-125`), and a failed cache write only costs the next request
  another lookup (`:135-140`). The class states the reasoning in its own remarks (`:16-30`): failing
  closed would turn any cache or database blip into a total outage for every authenticated request,
  because this middleware sits on the hot path of all of them, while failing open leaves a residual
  exposure bounded by the 15-minute access-token lifetime and by the refresh-token revocation the
  deletion already performed.
- **It no-ops in services that do not host Identity.** The validator is resolved lazily via
  `context.RequestServices.GetService<ISoftDeletedUserValidator>()`
  (`SoftDeletedUserMiddleware.cs:75`) rather than as an `InvokeAsync` parameter. In an extracted
  service that does not host Identity (for example Store's Catalog or Sales service), no
  implementation is registered, so the middleware passes the request through
  (`SoftDeletedUserMiddleware.cs:76-83`): Identity is the source of truth and already validated the
  token upstream. Resolving it as a constructor/parameter dependency would instead 500 every request
  in those services. MMCA.Helpdesk wires the same pipeline
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:111`) but hosts only a Tickets module and
  registers no validator, so it takes the same no-op path.

`SoftDeletedUserMiddlewareTests`
(`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs`)
covers the branches: anonymous pass-through, no-validator pass-through with no cache call, a live
non-deleted pass, a live deleted 401, a cached-deleted 401 with no database call, and a cached
non-deleted pass with no database call.

The effect is a **bounded revocation window**, not instant revocation, and the two apps sit at
different points inside it. Where nothing writes the marker at delete time, a soft-deleted account's
still-valid tokens keep working only until the cached status expires (at most the 30-second marker
lifetime once the account has been queried at least once in that window), instead of until the token
itself expires. That is MMCA.Store today: its `DeleteUserHandler.OnAfterSoftDeleteAsync`
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:35-60`)
erases the linked `Customer` and writes no marker, so revocation there is bounded only by that passive
window. MMCA.ADC's handler writes one: after the erasure commits it queues
`SoftDeletedUserCache.MarkDeletedAsync(cacheService, command.UserId, ct)` as an after-commit callback
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:68-80`,
the call at `:72-74`; `SoftDeletedUserCache.MarkDeletedAsync` at `SoftDeletedUserCache.cs:53-61`), so
the next request bearing an already-issued token is rejected without waiting for the window to elapse.
The write is best effort: a cache fault is logged and swallowed (`DeleteUserHandler.cs:76-79`)
rather than failing an erasure that already committed, which drops ADC back to the same
passive bound Store lives with.

## Rationale
- **Bounds the stateless-JWT revocation gap cheaply.** Stateless JWT (ADR-004) has no built-in
  revocation, so a deactivated account would otherwise stay usable for the full remaining token
  lifetime. A 30-second cached check turns "valid until the token expires" into "rejected within
  about 30 seconds," which is the point of the middleware.
- **The cache is what keeps it stateless-friendly.** Checking account status on every request would
  put a database read back in the hot path of every authenticated call, the cost stateless JWT was
  meant to avoid. Caching the boolean for 30 seconds keeps the lookup rate at most once per user per
  window, so the common case stays a cache hit.
- **The validator abstraction keeps the middleware in the framework.** The middleware lives in
  `MMCA.Common.API` and depends only on `ISoftDeletedUserValidator`, so it needs no reference to any
  app's `User` entity. The query itself is generic over the app's aggregate
  (`SoftDeletedUserValidator<TUser>`), so each Identity module supplies only the type argument and the
  registration, not a copy of the query.
- **Lazy resolution is what makes it safe everywhere.** One pipeline runs in Identity-hosting and
  non-Identity hosts alike; resolving the validator lazily lets the same middleware gate real
  requests where Identity lives and stay inert where it does not, without a per-host pipeline
  variant.

## Trade-offs
- **Revocation is bounded, not immediate.** A soft-deleted user whose status is cached as not-deleted
  keeps passing until that cache entry expires (up to 30 seconds), unless the deleting handler wrote
  the marker itself. Shrinking the window costs more database lookups; lengthening it widens the
  exposure. 30 seconds is the chosen balance, and it is a compile-time value
  (`SoftDeletedUserCache.MarkerDuration`, `SoftDeletedUserCache.cs:29`), not configurable per host
  today.
- **Writing the marker on delete is per-app, not framework-wide.** The framework supplies the shared
  key and TTL (`SoftDeletedUserCache.MarkDeletedAsync`, `SoftDeletedUserCache.cs:53-61`), but nothing
  calls it on an application's behalf. ADC's `DeleteUserHandler` calls it
  (`MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:68-80`); Store's does
  not (`MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:35-60`), so the
  two apps genuinely revoke at different speeds from the same middleware.
- **Failing open is a deliberate availability-over-strictness trade.** A cache or database failure on
  this path lets the request through instead of rejecting it
  (`SoftDeletedUserMiddleware.cs:93-100`, `:118-125`), so while either store is unhealthy a deleted
  user keeps being served for the remaining lifetime of an already-issued access token. The
  alternative, failing closed, would convert the same blip into a 401 for every authenticated request
  in the application.
- **The no-op posture trusts upstream validation.** In a service with no validator registered, a
  soft-deleted user's token is accepted for its full lifetime at that service, on the assumption that
  Identity is the source of truth and the token was validated upstream. Only Identity-hosting hosts
  actually enforce the revocation; extracted non-Identity services do not re-check.
- **Cache-scope-dependent.** The window is per cache scope: with a distributed cache the revocation
  is shared across replicas, but with a per-instance memory cache each instance carries its own
  30-second window, so the effective revocation lag is per replica.
- **Enforcement depends on registration.** An Identity-hosting service that fails to register
  `ISoftDeletedUserValidator` silently degrades to the no-op path, the same audit-the-inventory
  caveat other opt-in framework capabilities carry (ADR-005).

## Related
ADR-005 (soft-delete is the deletion model whose still-authenticated tokens this middleware revokes;
deleting a user is a soft-delete, not a row removal), ADR-004 (the stateless RS256/JWKS validation
that has no built-in revocation, which this bounds without a per-request store lookup), ADR-022 (the
SSR session cookie carries the same JWT into the prerender path this middleware also gates).

## Revision (2026-08-07)
Re-verified against current source. The decision is unchanged, but three things it described have
moved: the validator implementation, the home of the 30-second constant, and the claim that both apps
revoke at the same speed.

1. **The per-app validators were hoisted into one shared generic.** The ADR cited a
   filter-bypassing existence query duplicated in each app
   (`MMCA.ADC.Identity.Application/Users/SoftDeletedUserValidator.cs:10,21-24` and the Store
   equivalent). Neither file exists now. The query lives once in the framework as
   `SoftDeletedUserValidator<TUser>`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19-34`, its own
   remarks at `:11-17` stating no per-app subclass is needed), closed over each app's `User` at
   registration (`MMCA.ADC.Identity.Application/DependencyInjection.cs:35`, from `:32`;
   `MMCA.Store.Identity.Application/DependencyInjection.cs:41`, from `:39`). The behavior of the query
   is what it was; only its location changed.
2. **The 30-second value moved out of the middleware.** There is no `CacheDuration` member in
   `SoftDeletedUserMiddleware` any more. The figure is
   `SoftDeletedUserCache.MarkerDuration => TimeSpan.FromSeconds(30)`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`), referenced by
   the middleware's cache write at `SoftDeletedUserMiddleware.cs:132`. The extraction is what lets a
   delete handler write the same key and TTL the middleware reads (`SoftDeletedUserCache.cs:42-43`,
   `:53-61`).
3. **The fail-open policy is now recorded.** The middleware wraps its cache read, validator query and
   cache write in handlers that let the request proceed on failure
   (`SoftDeletedUserMiddleware.cs:93-100`, `:118-125`, `:135-140`), a trade-off argued in the class's
   own remarks (`:16-30`). The ADR asserted neither the behavior nor the reasoning before; both are now
   in the Decision and Trade-offs sections.
4. **The uniform revocation window was wrong for ADC.** ADC's `DeleteUserHandler` writes the deleted
   marker in an after-commit callback
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:68-80`),
   so its revocation lands on the next request rather than after the passive window. Store's handler
   does not
   (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:35-60`),
   so Store is the app the original "at most 30 seconds" wording actually described. The asymmetry is
   stated in the Decision and carried as its own trade-off.
5. **Line anchors re-verified.** The middleware class declaration is at
   `SoftDeletedUserMiddleware.cs:31` (from `:15`; lines 1-30 are usings plus the class remarks), the
   null-`UserId` pass-through at `:65-73` (from `:43-51`), the lazy validator resolution at `:75` (from
   `:53`) with its no-validator pass-through at `:76-83` (from `:54-61`), the key build at `:85` and
   cache read at `:91` (from `:63-66`), the cached-`true` 401 at `:102-106` (from `:66-71`), the
   cache-miss validator call at `:114-116` with the cache write at `:131-133` and the deleted-401 at
   `:143-147` (from `:73-84`), and the fall-through at `:150` (from `:86`). Unchanged and re-checked:
   the pipeline registration (`WebApplicationExtensions.cs:109`, with `:96,108` and `:110` around it),
   `ISoftDeletedUserValidator.cs:7,15`, the Helpdesk no-op path
   (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:111`), and
   `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs`.
