# ADR-026: Two-Tier Caching: a Swappable `ICacheService` Substrate plus an HTTP Output-Cache Edge

## Status
Accepted (2026-06-27, amended 2026-07-10, 2026-07-23, 2026-07-25).

## Context
The framework needs caching in two distinct places. Inside the application pipeline, query results
are memoized and invalidated on mutation (the Caching decorators of ADR-014, keyed by
`IQueryCacheable` / `ICacheInvalidating`), and a brute-force counter backs login protection
(ADR-019). At the HTTP edge, public/anonymous read endpoints want their responses served without
touching a handler at all. These two needs have different lifetimes, different invalidation models,
and different failure tolerances, so a single cache primitive does not fit both.

The application-pipeline need also has to survive the monolith-to-services move (ADR-006/008): the
same handler code runs in a single process (where an in-process cache is correct and cheapest) and in
a scaled-out container app (where each replica's private memory cache would drift and a shared store
is needed). We did not want handlers to know which deployment they are in.

This ADR records the caching decisions themselves. ADR-014 owns the decorator *ordering* and the
marker interfaces; this ADR owns the *substrate, the two tiers, and the invalidation semantics* they
sit on.

## Decision
Cache in two tiers, each with its own substrate.

### Tier 1: an application `ICacheService` substrate with a runtime memory-or-distributed swap
- **One abstraction.** `ICacheService` (`MMCA.Common.Application/Interfaces/ICacheService.cs`) exposes
  `GetAsync` / `SetAsync` / `RemoveAsync` / `RemoveByPrefixAsync`. Application code (the ADR-014
  Caching decorators, `LoginProtectionService`) depends only on this interface, never on a concrete
  cache or on Redis.
- **The backing store is chosen at startup, not in code.** `AddCaching()`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:157`, called from `AddInfrastructure`) registers
  `DistributedCacheService` when a real `IDistributedCache` is present (one that is not the in-memory
  `MemoryDistributedCache`, i.e. Aspire registered Redis), and otherwise `MemoryCacheService`. The
  monolith with no distributed cache gets in-process caching for free; a host that wires Redis gets the
  distributed store with no application-code change. This is the same "monolith now, scale or extract
  later" extension point as `InProcessMessageBus` vs `BrokerMessageBus` (ADR-003/006/008).
- **Prefix invalidation, implemented per store.** `IMemoryCache` has no key-enumeration API, so
  `MemoryCacheService` tracks live keys in a `ConcurrentDictionary` (kept in sync by a post-eviction
  callback) to support `RemoveByPrefixAsync`. `DistributedCacheService` serializes values as UTF-8 JSON
  and, when an `IConnectionMultiplexer` is resolvable, enumerates matching Redis keys to delete them;
  when no multiplexer is registered it treats prefix removal as a no-op and relies on the TTL backstop
  below.
- **A short default TTL bounds staleness.** `CacheOptions.DefaultExpiration` is a 30-second absolute
  expiration (`AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30)`,
  `MMCA.Common.Infrastructure/Caching/CacheOptions.cs:14-17`); callers may override per entry. The short default means even a prefix invalidation that
  cannot reach every replica (memory mode, or distributed mode without a multiplexer) self-heals within
  seconds.

### Tier 2: an HTTP output-cache edge
- **The pipeline always enables it; policies are opt-in per host.** `MMCA.Common.API` calls
  `app.UseOutputCache()` in the shared middleware pipeline
  (`MMCA.Common.API/Startup/WebApplicationExtensions.cs:104`), but ships no policies. Each service
  registers its own `AddOutputCache(...)`: most declare a `NoCache` base policy (Identity, Sales,
  Engagement, Notification), while the read-heavy public services declare real cacheable policies. ADC
  Conference and Store Catalog are the adopters today, with named policies and `[OutputCache]` on their
  public read controllers.
- **Public-read policies cache authenticated requests too (amended by ADR-040).** The framework UI
  attaches a Bearer token to every outgoing API request, including reads of `[AllowAnonymous]`,
  user-independent endpoints, and ASP.NET Core's built-in default output-cache policy refuses to serve
  or store a cached response for any request carrying an `Authorization` header. So the adopters do not
  cache only anonymous traffic: they register their public-read policies through
  `OutputCacheOptions.AddPublicEndpointPolicy(name, expiration, tags)`
  (`MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:20`), backed by
  `PublicEndpointOutputCachePolicy` (`MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35`),
  whose `CacheRequestAsync` caches GET/HEAD regardless of the caller's auth state
  (`MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:71-75`, via the private helpers
  `IsCacheableRequest` / `IsBypassedCaller` at
  `MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:109-113`). ADC Conference and Store Catalog
  register these policies on their public read controllers; ADR-040 records that the built-in default
  policy served 0% of logged-in (bearer-carrying) traffic on conference day.
- **The output-cache store itself is Redis-backed wherever a service runs more than one replica.**
  `AddOutputCache` defaults to a per-replica in-memory store, so a tag eviction reaches only the replica
  that served the mutation. Both adopters now register a shared store inside the same
  redis-connection-string conditional that wires Tier 1: ADC Conference
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:147`) and Store Catalog
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:98`) both call
  `builder.Services.AddStackExchangeRedisOutputCache(...)`. `AddOutputCache` registers its store with
  `TryAdd`, so the explicit registration wins regardless of call order, and with no Redis configured the
  in-memory store still applies, which is correct at a single replica. ADR-040's 2026-07-25 amendment
  makes the shared store the expected posture for any multi-replica deployment. The practical effect is
  that both tiers ride the same Redis instance: Tier 1 through `IDistributedCache`, Tier 2 through the
  output-cache store.

## Rationale
- **One substrate, swapped by environment.** Keeping `ICacheService` as the only thing application code
  sees lets the deployment decide memory vs distributed. The auto-swap (presence of a real
  `IDistributedCache`) means there is no flag to forget and no per-handler branching.
- **Two tiers because the jobs differ.** Tier 1 memoizes handler results and invalidates them precisely
  on mutation (prefix/`ICacheInvalidating`). Tier 2 skips the handler entirely for public reads at the
  HTTP edge. It began as the anonymous-traffic lever ADR-019 leans on (anonymous callers are exempt from
  the per-user rate limiter, so output caching absorbs that load instead); as amended by ADR-040 the
  adopters' public-read policies now cache authenticated (bearer-carrying) requests too, so the edge
  absorbs logged-in read load as well (the anonymous-only description is the pre-ADR-040 behavior). They
  are not unified by design: different keys, different lifetimes, different eviction.
- **TTL-bounded correctness over distributed-invalidation guarantees.** A short default TTL makes the
  cache eventually consistent cheaply, so the system stays correct-enough even where prefix invalidation
  is best-effort, rather than depending on a perfectly fan-out invalidation.

## Trade-offs
- **Memory mode is per-replica.** In the in-process store each replica caches independently; a
  scaled-out deployment that did not wire Redis would see cross-replica staleness bounded only by the
  TTL. The framework's answer is to register a distributed cache once scaled out (both apps do).
- **Distributed prefix invalidation needs the multiplexer, and every service now registers it.**
  `DistributedCacheService` can only scan-and-delete by prefix when an `IConnectionMultiplexer` is in the
  container. All seven services now register `AddRedisClient("redis")` immediately alongside
  `AddRedisDistributedCache("redis")`, gated by the same redis-connection-string conditional, precisely so
  the multiplexer is present for SCAN-based prefix eviction (ADC Conference
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:131,136`, Notification
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:106,111`, Engagement
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:96,101`, Identity
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:123,128`; Store Catalog
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:83,88`, Sales
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:82,87`, Identity
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:87,92`). So whenever Redis is
  configured, prefix-based invalidation against Redis is live and cached entries are evicted on write; the
  30s TTL is now the backstop only for the no-Redis case (memory mode), where prefix removal self-heals
  within seconds instead. Single-key `RemoveAsync` is unaffected in either mode.
- **Distributed mode pays serialization and a network hop.** Values cross the wire as JSON; large or
  hot objects cost more than the in-process path.
- **Counter increments are not atomic, and that is the accepted position.**
  `ICacheService.IncrementAsync` is a default interface member implemented as a read-modify-write
  (`MMCA.Common.Application/Interfaces/ICacheService.cs:57`), and `DistributedCacheService` overrides it
  with the same read-modify-write shape rather than Redis `INCR`
  (`MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:175-181`). The reason is a storage
  format mismatch, documented at the implementation
  (`MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:156-174`): `INCR` writes a Redis
  string, while `StackExchangeRedisCache` stores every entry as a Redis hash (`absexp` / `sldexp` /
  `data`, read back with `HMGET`). An `INCR`-written counter therefore makes the next read of that key
  fail with `WRONGTYPE`, which surfaces as a 500 on whatever endpoint owns the counter (registration and
  login, in the ADR-029 case). A counter has to live in the same storage format as the reads that
  consult it, so readability wins over atomicity here: the ADR-029 brute-force and rate-limit counters
  can undercount under genuinely concurrent increments, and an occasional lost increment is the accepted
  cost of a counter that is always readable.
- **Output caching is opt-in per service.** A read-heavy service that forgets to register a real
  `AddOutputCache` policy gets no edge caching (the `NoCache` base is the safe default), the same
  audit-the-inventory caveat as other opt-in capabilities (ADR-019/020/021). Adopting a policy is only
  half the decision: the store behind it is per-replica memory unless the service registers the shared
  Redis output-cache store (Tier 2 above), which is what a multi-replica adopter needs for tag eviction
  to reach every replica (ADR-040).

## Related
ADR-014 (the Caching decorators and `IQueryCacheable` / `ICacheInvalidating` markers that consume this
substrate), ADR-019 (output caching as the anonymous-traffic lever, and `LoginProtectionService` is
another `ICacheService` consumer), ADR-006 / ADR-008 (the same monolith-to-services swap boundary this
substrate follows), ADR-040 (amends this ADR's Tier 2: the adopters' public-read policies cache
authenticated, bearer-carrying requests too, not only anonymous traffic).

## Revision (2026-07-24)
Three substrate corrections from a code review.

1. **An optional key namespace (`Cache:KeyPrefix`).** Services sharing one cache instance also share
   one keyspace, and nothing stopped two of them choosing the same key for different data. The prefix
   is applied inside `DistributedCacheService` rather than through `RedisCacheOptions.InstanceName`
   deliberately: `InstanceName` is prepended below this abstraction, where prefix invalidation cannot
   see it, so the SCAN in `RemoveByPrefixAsync` would look for `product:*` while the stored keys were
   `svc:product:*` and evict nothing, silently. Applying it here keeps get, set, remove, the SCAN
   pattern and the Redis counter working from one key shape. `MemoryCacheService` ignores it: its
   keyspace is private to the process by construction.
2. **Prefix invalidation survives an overwrite.** `MemoryCacheService` tracks live keys in a side
   dictionary because `IMemoryCache` cannot enumerate, and its post-eviction callback removed the key
   for *every* eviction reason. `IMemoryCache` queues those callbacks to the thread pool, so
   overwriting a live key fired the old entry's callback asynchronously and it could land after the
   replacement was tracked, deleting the tracking record for an entry that was still cached. That
   entry was then live but invisible to `RemoveByPrefixAsync` and clearable only by its TTL. The
   callback now skips `EvictionReason.Replaced`; genuine evictions still clean up.
3. **`ICacheService.IncrementAsync`.** A default interface member (so no implementer breaks), added as
   the single entry point for the ADR-029 counters. It is a read-modify-write, and
   `DistributedCacheService` deliberately keeps that shape rather than reaching for Redis `INCR`: see
   the counter trade-off above for the storage-format reason and why the non-atomicity is accepted.

The query-cache stampede lock also moved to a fixed-width `KeyedSemaphoreStripe`. The previous
per-key dictionary was documented as bounded by the set of distinct cache keys, which holds only for
parameterless keys; any `CacheKey` embedding a user id or filter value grew it without bound.

## Revision (2026-07-25)
An audit against the code. No behavior changed; the ADR text did.

1. **The `IncrementAsync` entry above was wrong.** It described a Redis `INCR` override. There is no
   such override, and none is intended: both the default interface member and
   `DistributedCacheService`'s implementation are read-modify-write, because a counter written by
   `INCR` (a Redis string) cannot be read back by the hash-shaped `StackExchangeRedisCache` path that
   consults it. The resulting non-atomicity is recorded in Trade-offs as the accepted position, not as
   an open defect.
2. **Tier 2 now records the output-cache store, not just the policies.** ADC Conference and Store
   Catalog back the output cache with Redis when Redis is configured, so tag eviction crosses replicas;
   the in-memory store remains the single-replica case. This tracks ADR-040's 2026-07-25 amendment.
3. **Refreshed line anchors** for `AddCaching` and for the two adopters' paired Redis registrations.
   That refresh did not hold: four of the per-service citations it covered no longer matched the code
   when the ADR was next swept, so read this item as the state on 2026-07-25 only. The 2026-07-28
   entry below re-anchored them.

## Revision (2026-07-28)
Line anchors only, re-verified against the current source. No decision, no behavior, and no
substantive prose changed.

1. **Tier 2.** Store Catalog's `AddStackExchangeRedisOutputCache(...)` is at `Program.cs:90`; the
   previously cited `:88` had become a line inside the comment above the call. ADC Conference's
   `Program.cs:129` was re-checked and still holds.
2. **Trade-offs, the seven paired Redis registrations.** Three moved: ADC Identity to
   `Program.cs:108,113` (from `:109,114`), Store Catalog to `Program.cs:75,80` (from `:73,78`), and
   Store Identity to `Program.cs:79,84` (from `:77,82`). The other four were re-checked and are
   unchanged: ADC Conference `:113,118`, ADC Notification `:99,104`, ADC Engagement `:88,93`, Store
   Sales `:76,81`. `AddCaching` at `MMCA.Common.Infrastructure/DependencyInjection.cs:149` is also
   unchanged, as are the Tier 2 policy anchors in `MMCA.Common.API` and the counter anchors in
   `ICacheService` / `DistributedCacheService`.
3. **The 2026-07-25 anchor claim is annotated rather than removed**, so the history stays readable
   without asserting an accuracy it no longer had.

## Revision (2026-08-01)
Line anchors only, re-verified against the current source. No decision, no behavior, and no
substantive prose changed.

1. **`AddCaching`.** Now at `MMCA.Common.Infrastructure/DependencyInjection.cs:150` (from `:149`); the
   previous line is the `<returns>` doc comment above the declaration, not the declaration itself.
2. **Tier 2.** Store Catalog's `AddStackExchangeRedisOutputCache(...)` moved again, to `Program.cs:96`
   (from the 2026-07-28 anchor of `:90`, itself a correction of an earlier `:88`). ADC Conference's
   moved to `Program.cs:135` (from `:129`).
3. **Trade-offs, the seven paired Redis registrations.** All seven shifted by the same six lines: ADC
   Conference to `Program.cs:119,124` (from `:113,118`), Notification to `Program.cs:105,110` (from
   `:99,104`), Engagement to `Program.cs:94,99` (from `:88,93`), Identity to `Program.cs:114,119` (from
   `:108,113`); Store Catalog to `Program.cs:81,86` (from `:75,80`), Sales to `Program.cs:82,87` (from
   `:76,81`), Identity to `Program.cs:85,90` (from `:79,84`).
4. **Counter anchors.** `DistributedCacheService`'s `IncrementAsync` override is now at
   `DistributedCacheService.cs:175-181` (from `:122-128`), and the storage-format-mismatch `<remarks>`
   documenting it is now at `DistributedCacheService.cs:156-174` (from `:104-121`). The old line range
   for both now falls inside the unrelated `RemoveByPrefixAsync` / `ScanAndDeleteAsync` SCAN logic.
5. **The 2026-07-28 anchor claim is annotated rather than removed**, consistent with how that revision
   itself treated the 2026-07-25 entry: the anchors it recorded were correct on 2026-07-28 and have
   since drifted again.

## Revision (2026-08-07)
Line anchors only, re-verified against the current source. No decision, no behavior, and no
substantive prose changed.

1. **`AddCaching`.** Now at `MMCA.Common.Infrastructure/DependencyInjection.cs:157` (from `:150`);
   line 150 is now the closing brace of the preceding method. The registration behavior it describes
   (`DistributedCacheService` when a real, non-`MemoryDistributedCache` `IDistributedCache` is
   present, `MemoryCacheService` otherwise) is unchanged.
2. **The 30-second default TTL now cites its source.** The figure was asserted without an anchor;
   it is verified and the anchor added
   (`MMCA.Common.Infrastructure/Caching/CacheOptions.cs:14-17`, `TimeSpan.FromSeconds(30)`).
3. **Tier 2.** ADC Conference's `AddStackExchangeRedisOutputCache(...)` moved to `Program.cs:147`
   (from `:135`) and Store Catalog's to `Program.cs:98` (from `:96`).
4. **Trade-offs, the seven paired Redis registrations.** Six moved: ADC Conference to
   `Program.cs:131,136` (from `:119,124`), Notification to `Program.cs:106,111` (from `:105,110`),
   Engagement to `Program.cs:96,101` (from `:94,99`), Identity to `Program.cs:123,128` (from
   `:114,119`); Store Catalog to `Program.cs:83,88` (from `:81,86`), Identity to `Program.cs:87,92`
   (from `:85,90`). Store Sales was re-checked and is unchanged at `:82,87`. The Tier 2 policy
   anchors in `MMCA.Common.API` (`WebApplicationExtensions.cs:104`,
   `OutputCacheOptionsExtensions.cs:20`, `PublicEndpointOutputCachePolicy.cs:35`, `:71-75`,
   `:109-113`) and the counter anchors (`ICacheService.cs:57`,
   `DistributedCacheService.cs:156-174` and `:175-181`) were re-checked and are unchanged.
5. **The 2026-08-01 anchor claim is annotated rather than removed**, consistent with how the two
   preceding revisions treated their predecessors: the anchors it recorded were correct on
   2026-08-01 and have since drifted again.
