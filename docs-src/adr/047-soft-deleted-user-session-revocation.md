# ADR-047: Runtime Revocation of Soft-Deleted Users' Active Sessions

## Status
Accepted (2026-07-15). Revised 2026-08-07 (validator hoisted into a shared generic, the 30-second
constant moved, the two apps revoke at different speeds). Revised 2026-08-23: the pipeline
registration moved out of `WebApplicationExtensions` into the named-step `MiddlewarePipelineBuilder`
(ADR-079), and a tenant-resolution step (ADR-073) now sits between authentication and rate limiting.
Revised 2026-09-03 (MMCA.Common 1.185.0): the deleted-marker write was lifted out of the apps into
`DeleteUserHandlerBase`, so the revocation window is now uniform across every consumer and the
per-app asymmetry the 2026-08-07 revision recorded is gone.

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

- **It runs after authentication, before authorization.** That position is data in a named-step
  pipeline builder (ADR-079), not a hand-ordered sequence of `Use*` calls:
  `UseCommonMiddlewarePipeline`
  (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:46`) delegates to the
  private `ApplyPipeline` helper (`WebApplicationExtensions.cs:138`), which seeds the framework steps
  from `MiddlewarePipelineBuilder.CreateDefault()` (`WebApplicationExtensions.cs:140`;
  `Source/Presentation/MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs:31-156`). This middleware
  is the `SoftDeletedUserFilter` step (`MiddlewarePipelineStepNames.cs:59`), applied as
  `app.UseMiddleware<SoftDeletedUserMiddleware>()` at `MiddlewarePipelineBuilder.cs:130`. Four
  consecutive steps fix its place: `UseAuthentication` (`:110`), then `TenantResolutionMiddleware`
  (`:118`, ADR-073, which has to sit immediately after authentication because its claim strategy
  reads `HttpContext.User`), then `UseRateLimiter` (`:126`, ADR-019), then this middleware (`:130`),
  and only after it `UseAuthorization` (`:134`). So `HttpContext.User` is already populated when the
  check runs, and the check still gates every downstream endpoint. The order is frozen by a fitness
  function rather than by a comment: `MiddlewarePipelineOrderTestsBase.ExpectedStepNames` asserts
  `SoftDeletedUserFilter` between `RateLimiting` and `Authorization`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/MiddlewarePipelineOrderTestsBase.cs:51-53`).
  `MiddlewarePipelineBuilder.Build()`'s startup-validated invariants (`MiddlewarePipelineBuilder.cs:257-280`)
  do not name this step, so a host that moves it through the configure overload is caught by that
  fitness function, not at startup.
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
  `MMCA.Store.Identity.Application/DependencyInjection.cs:44`). The query bypasses the soft-delete
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
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:130`) but hosts only a Tickets module and
  registers no validator, so it takes the same no-op path.

`SoftDeletedUserMiddlewareTests`
(`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs`)
covers the branches: anonymous pass-through, no-validator pass-through with no cache call, a live
non-deleted pass, a live deleted 401, a cached-deleted 401 with no database call, and a cached
non-deleted pass with no database call.

**The marker write is part of the shared erasure workflow, so the window is uniform.** Without a
marker the revocation is passive: a soft-deleted account's still-valid tokens keep working until the
cached status expires (at most the 30-second marker lifetime, once the account has been queried at
least once in that window) instead of until the token itself expires. Writing the marker at delete
time collapses that to the next request. That write is not left to each app's delete handler: it is a
step of `DeleteUserHandlerBase.HandleAsync`, the shared account-erasure workflow in
`MMCA.Common.Application`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:137-149`),
so every app that derives from the base gets the identical revocation window with no per-app code.

- **The base requires the cache to do it.** `ICacheService` is a constructor parameter of the base
  (`DeleteUserHandlerBase.cs:58-61`), so an app cannot derive from it and silently skip the marker;
  the compiler asks for the dependency.
- **It runs after the commit and before the app's tail.** The order is
  `SaveChangesAsync` (`:135`), then `SoftDeletedUserCache.MarkDeletedAsync(cacheService,
  command.UserId, cancellationToken)` (`:142-144`; `SoftDeletedUserCache.MarkDeletedAsync` at
  `SoftDeletedUserCache.cs:53-61`), then the queued `afterCommit` actions (`:151-154`). The base's own
  remarks give the reason (`:31-36`): the app's tail is unbounded work (deleting a blob, calling
  storage) that can be slow or throw, and every second it takes is a second the deleted account's
  token still works, so revoking first bounds the exposure to the cache round trip regardless of what
  the app queued behind it.
- **It is best effort, and deliberately so.** A non-cancellation exception is caught and logged as a
  warning via `UserUseCaseLog.SoftDeletedMarkerFailed`
  (`DeleteUserHandlerBase.cs:146-149`; `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:23`)
  rather than failing an erasure that has already committed irreversibly. A failed write costs only
  the shortening: revocation falls back to the passive 30-second window, exactly as it behaved before
  the marker existed (`DeleteUserHandlerBase.cs:24-29`).
- **Apps are told not to write it themselves.** The `afterCommit` parameter's own documentation says
  the base already wrote the marker ahead of the tail, so a subclass must not queue a second write
  (`DeleteUserHandlerBase.cs:175-181`).

Both deployed apps therefore revoke at the same speed. After the 1.185.0 sweep MMCA.ADC's
`DeleteUserHandler`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs`)
keeps only its avatar-blob tail, its hand-rolled after-commit marker closure and its local
`LogSoftDeletedMarkerFailed` partial having been deleted in favour of the base's; MMCA.Store's
handler (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs`)
keeps its linked-`Customer` cascade and gains the marker behavior purely by forwarding the new
`ICacheService` constructor parameter to the base. Neither app contains a marker write.

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
- **The marker only covers erasures that go through the shared base.** The framework now both
  supplies the key and TTL (`SoftDeletedUserCache.MarkDeletedAsync`, `SoftDeletedUserCache.cs:53-61`)
  and calls it on the app's behalf (`DeleteUserHandlerBase.cs:142-144`), so no app can forget it. What
  the base cannot cover is a soft-delete that never reaches it: an administrative `IsDeleted = true`
  applied by a migration, a support script or any handler other than a `DeleteUserHandlerBase`
  subclass writes no marker, and those deletions still revoke only at the passive 30-second bound.
  Uniformity here is uniformity across the *erasure use case*, not across every path that can set the
  flag.
- **A cache fault silently degrades the window rather than failing.** The write is swallowed and
  logged at Warning (`DeleteUserHandlerBase.cs:146-149`), which is the right trade for an
  already-committed irreversible erasure, but it means the shortened window is a best-effort property:
  the caller gets a success result either way, and only the log says whether revocation was actually
  accelerated.
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
SSR session cookie carries the same JWT into the prerender path this middleware also gates), ADR-079
(the shared named-step HTTP pipeline that now owns this middleware's registration and its order),
ADR-073 (multi-tenancy, whose `TenantResolutionMiddleware` step sits between authentication and the
rate limiter, ahead of this one), ADR-019 (the rate limiter that runs immediately before it, for its
own authentication-dependent reason).

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
   `MMCA.Store.Identity.Application/DependencyInjection.cs:44`, from `:39`). The behavior of the query
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
   the pipeline registration (`WebApplicationExtensions.cs:109`, with `:96,108` and `:110` around it,
   both superseded on 2026-08-23, see below), `ISoftDeletedUserValidator.cs:7,15`, the Helpdesk no-op
   path (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:111`, superseded below), and
   `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs`.

## Revision (2026-08-23)
Re-verified against current source. The decision, the cache design, the fail-open policy and the
per-app asymmetry are all unchanged; what moved is where the middleware's position is expressed, and
one new neighbour now sits ahead of it.

1. **The registration left `WebApplicationExtensions.cs` entirely.** That file no longer calls
   `UseAuthentication`, `UseRateLimiter`, `UseMiddleware<SoftDeletedUserMiddleware>` or
   `UseAuthorization` at all: `UseCommonMiddlewarePipeline` (`WebApplicationExtensions.cs:46`, and the
   configure overload at `:58`) only routes into the private `ApplyPipeline` helper (`:138`), which
   seeds `MiddlewarePipelineBuilder.CreateDefault()` (`:140`). Every `:96`, `:108`, `:109` and `:110`
   anchor the Decision and the 2026-08-07 revision carried is therefore dead. The step registrations
   now live in `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs`:
   `UseAuthentication` at `:110`, `UseRateLimiter` at `:126`,
   `UseMiddleware<SoftDeletedUserMiddleware>()` at `:130`, `UseAuthorization` at `:134`. The behavior
   is what it was; the order became data in a named-step builder (ADR-079).
2. **A tenant-resolution step now runs between authentication and rate limiting.**
   `TenantResolutionMiddleware` is applied at `MiddlewarePipelineBuilder.cs:118` under the
   `TenantResolution` step name (ADR-073), so the current run of steps is Authentication (`:110`),
   TenantResolution (`:118`), RateLimiting (`:126`), SoftDeletedUserFilter (`:130`), Authorization
   (`:134`). The ADR's own claim, that the check runs after authentication and before authorization,
   still holds exactly; it is simply no longer adjacent to `UseAuthentication`. That new step follows
   the same opt-in, inert-unless-configured posture this middleware established, and its own comment
   names this middleware as the precedent (`MiddlewarePipelineBuilder.cs:114-117`).
3. **The order is now held by a fitness function.**
   `MiddlewarePipelineOrderTestsBase.ExpectedStepNames`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/MiddlewarePipelineOrderTestsBase.cs:38-58`) lists
   `SoftDeletedUserFilter` between `RateLimiting` and `Authorization` (`:51-53`), so a reorder fails a
   test. Note the limit: `MiddlewarePipelineBuilder.Build()` validates four load-bearing adjacencies at
   startup (`MiddlewarePipelineBuilder.cs:257-280`) and none of them names this step, so a host that
   moves it with the configure overload gets no startup error, only the fitness-function failure.
4. **Helpdesk anchor corrected.** `app.UseCommonMiddlewarePipeline()` is at
   `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:130`, after `var app = builder.Build();`
   (`:124`) and `app.MapDefaultEndpoints()` (`:129`); the `:111` and `:117` anchors earlier drafts
   carried are both dead. The substance is unchanged: Helpdesk wires the shared pipeline,
   registers no `ISoftDeletedUserValidator`, and takes the no-op path.
5. **Re-checked and unchanged**: `SoftDeletedUserMiddleware.cs:31` (class declaration), `:65-73`
   (anonymous pass-through), `:75` and `:76-83` (lazy resolution, no-validator pass-through), `:85`,
   `:91`, `:102-106`, `:114-116`, `:131-133`, `:143-147`, `:150` (the cache/validator path), `:93-100`,
   `:118-125`, `:135-140` (fail-open handlers), `ISoftDeletedUserValidator.cs:7,15`,
   `SoftDeletedUserValidator.cs:19-34` with its constraint at `:20` and query at `:30-33`,
   `SoftDeletedUserCache.cs:29,42-43,53-61`, the two registrations
   (`MMCA.ADC.Identity.Application/DependencyInjection.cs:35`,
   `MMCA.Store.Identity.Application/DependencyInjection.cs:44`), the two delete handlers
   (ADC `DeleteUserHandler.cs:68-80`, Store `DeleteUserHandler.cs:35-60`), and
   `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs`.

## Revision (2026-09-03, MMCA.Common 1.185.0)
Re-verified against current source. The middleware, the cache design, the 30-second window and the
fail-open policy are all unchanged. What changed is who writes the deleted marker, and with it the
central asymmetry this record has carried since 2026-08-07.

1. **The marker write moved into the framework.** `DeleteUserHandlerBase.HandleAsync` now writes it
   itself, between `SaveChangesAsync` and the app's post-commit tail
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:137-149`,
   the call at `:142-144`). The base's remarks argue the ordering (`:31-36`): the app's tail is
   unbounded work, and every second of it is a second a deleted account's token still works, so the
   revocation goes first and the exposure is bounded by the cache round trip alone.
2. **`ICacheService` became a required constructor parameter.** The base is now
   `DeleteUserHandlerBase<TUser, TCommand>(IUnitOfWork unitOfWork, ICacheService cacheService,
   ILogger logger)` (`DeleteUserHandlerBase.cs:58-61`). This is a breaking constructor change for
   every subclass, and it is the mechanism that makes the guarantee real: an app cannot derive from
   the base and quietly omit the marker, because the compiler asks for the dependency.
3. **The window is uniform, so the "two apps revoke at different speeds" claim is retired.** Item 4
   of the 2026-08-07 revision and the trade-off that restated it are superseded. ADC's hand-rolled
   after-commit closure and its local `LogSoftDeletedMarkerFailed` partial were deleted from
   `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs`,
   leaving only its avatar-blob tail; Store gained the behavior without writing any marker code, by
   adding an `ICacheService` parameter to
   `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs`
   and forwarding it to the base. Both landed in the 1.185.0 consumer sweep.
4. **Best effort is now a framework property rather than an app one.** The base catches any
   non-cancellation exception from the write and logs it at Warning through
   `UserUseCaseLog.SoftDeletedMarkerFailed`
   (`DeleteUserHandlerBase.cs:146-149`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:23`), for the reason the
   remarks give (`:24-29`): the erasure is already committed and irreversible, so a cache fault must
   not turn it into a failure the caller would retry. On failure the revocation falls back to the
   passive 30-second bound.
5. **Subclasses are told not to duplicate it.** The `afterCommit` parameter's documentation states
   that the base already wrote the marker ahead of the tail
   (`DeleteUserHandlerBase.cs:175-181`), so a second write from an app hook is a documented mistake
   rather than a silent duplicate.
6. **Store registration anchor corrected.** `ISoftDeletedUserValidator` is registered at
   `MMCA.Store.Identity.Application/DependencyInjection.cs:44`; the `:46` anchor the Decision and both
   earlier revisions carried is dead. ADC's is unchanged at
   `MMCA.ADC.Identity.Application/DependencyInjection.cs:35`.
7. **Re-checked and unchanged**: `SoftDeletedUserMiddleware.cs:31`, `:65-73`, `:75`, `:76-83`, `:85`,
   `:91`, `:102-106`, `:114-116`, `:131-133`, `:143-147`, `:150`, `:93-100`, `:118-125`, `:135-140`,
   `ISoftDeletedUserValidator.cs:7,15`, `SoftDeletedUserValidator.cs:19-34`,
   `SoftDeletedUserCache.cs:29,42-43,53-61`, and the pipeline anchors in
   `MiddlewarePipelineBuilder.cs` (`:110,118,126,130,134`).
