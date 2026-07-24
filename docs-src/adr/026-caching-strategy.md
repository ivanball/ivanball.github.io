# ADR-026: Two-Tier Caching: a Swappable `ICacheService` Substrate plus an HTTP Output-Cache Edge

## Status
Accepted (2026-06-27, amended 2026-07-10, 2026-07-23).

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
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:150`, called from `AddInfrastructure`) registers
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
  expiration; callers may override per entry. The short default means even a prefix invalidation that
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
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:112,117`, Notification
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:99,104`, Engagement
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:88,93`, Identity
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:109,114`; Store Catalog
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:72,77`, Sales
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:76,81`, Identity
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:77,82`). So whenever Redis is
  configured, prefix-based invalidation against Redis is live and cached entries are evicted on write; the
  30s TTL is now the backstop only for the no-Redis case (memory mode), where prefix removal self-heals
  within seconds instead. Single-key `RemoveAsync` is unaffected in either mode.
- **Distributed mode pays serialization and a network hop.** Values cross the wire as JSON; large or
  hot objects cost more than the in-process path.
- **Output caching is opt-in per service.** A read-heavy service that forgets to register a real
  `AddOutputCache` policy gets no edge caching (the `NoCache` base is the safe default), the same
  audit-the-inventory caveat as other opt-in capabilities (ADR-019/020/021).

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
3. **`ICacheService.IncrementAsync`.** A default interface member (so no implementer breaks) with a
   Redis `INCR` override, added for the ADR-029 counters whose read-modify-write could lose
   concurrent increments.

The query-cache stampede lock also moved to a fixed-width `KeyedSemaphoreStripe`. The previous
per-key dictionary was documented as bounded by the set of distinct cache keys, which holds only for
parameterless keys; any `CacheKey` embedding a user id or filter value grew it without bound.
