# ADR-026: Two-Tier Caching: a Swappable `ICacheService` Substrate plus an HTTP Output-Cache Edge

## Status
Accepted (2026-06-27, amended 2026-07-10, 2026-07-23, 2026-07-25, 2026-08-14). **Amended by
[ADR-077](077-hybridcache-substrate.md) (2026-08-13)**: Tier 1's substrate gains a third, opt-in
implementation (`HybridCacheService`, L1 plus L2) writing under a disjoint `hc:` keyspace. The default
path is unchanged; see the Revision (2026-08-13) below. Revised 2026-08-18: **Tier 2 stops being
per-process**. An `OutputCacheEvictionRequested` integration event lets a mutation in one service evict
another service's output cache over the existing outbox, broker and inbox path, per tag and
best-effort, on a new `MMCA.Common.OutputCache` meter. Tier 1 is untouched by that change, which is the
mirror image of ADR-077's Tier-1-only amendment; see the Revision (2026-08-18) at the end. Revised
2026-08-23: the counter trade-off now records that `ICacheService`'s own `<remarks>` still anticipates a
Redis `INCR` override that no implementation provides, so a reader who starts at the interface is not
left with the opposite conclusion; anchors re-verified throughout. Amended 2026-09-01: an **optional
third tier on the client** is recorded, `IUiReadCache`, a per-circuit read-through cache over the API
client whose keys are the relative URL (path plus the full query) so they line up with Tier 2's
`QueryKeys = "*"` policy. It is shipped and DI-registered, but opt-in per UI service and passed by no
consumer app today; both server tiers are unchanged. See the Revision (2026-09-01) at the end.

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
- **The backing store is chosen at startup, not in code (amended by ADR-077).** `AddCaching()`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:215`, called from `AddInfrastructure`) registers
  `DistributedCacheService` when a real `IDistributedCache` is present (one that is not the in-memory
  `MemoryDistributedCache`, i.e. Aspire registered Redis), and otherwise `MemoryCacheService`. The
  monolith with no distributed cache gets in-process caching for free; a host that wires Redis gets the
  distributed store with no application-code change. This is the same "monolith now, scale or extract
  later" extension point as `InProcessMessageBus` vs `BrokerMessageBus` (ADR-003/006/008). Since
  ADR-077 a third implementation exists, `HybridCacheService` (L1 in-process plus L2 distributed), and
  it is the one substrate that is **not** auto-selected: a host opts into it explicitly with
  `AddCommonHybridCache(...)`, which replaces the registration this call made. With no such call the
  two-way swap above is exactly what it was.
- **Prefix invalidation, implemented per store.** `IMemoryCache` has no key-enumeration API, so
  `MemoryCacheService` tracks live keys in a `ConcurrentDictionary` (kept in sync by a post-eviction
  callback) to support `RemoveByPrefixAsync`. `DistributedCacheService` serializes values as UTF-8 JSON
  and, when an `IConnectionMultiplexer` is resolvable, enumerates matching Redis keys to delete them;
  when no multiplexer is registered it treats prefix removal as a no-op and relies on the TTL backstop
  below.
- **A short default TTL bounds staleness.** The 30 seconds is one figure with one home:
  `CacheOptions.DefaultDuration` (`= TimeSpan.FromSeconds(30)`,
  `MMCA.Common.Infrastructure/Caching/CacheOptions.cs:23`), a bare `TimeSpan` so that an
  implementation which does not speak `DistributedCacheEntryOptions` (`HybridCacheService`, whose
  entry options are its own type, ADR-077) defaults to the same policy instead of hard-coding a
  second 30 seconds. `CacheOptions.DefaultExpiration` is that duration expressed as an absolute
  expiration (`AbsoluteExpirationRelativeToNow = DefaultDuration`,
  `MMCA.Common.Infrastructure/Caching/CacheOptions.cs:28-31`); callers may override per entry. The
  short default means even a prefix invalidation that cannot reach every replica (memory mode, or
  distributed mode without a multiplexer) self-heals within seconds.

### Tier 2: an HTTP output-cache edge
- **The pipeline always enables it; policies are opt-in per host.** `MMCA.Common.API` calls
  `app.UseOutputCache()` in the shared middleware pipeline, which is a builder of named steps rather
  than a run of inline calls: the step is registered at
  `MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs:138` under the name
  `MiddlewarePipelineStepNames.OutputCache` (`MMCA.Common.API/Startup/MiddlewarePipelineStepNames.cs:65`).
  The pipeline ships no policies. Each service
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
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:140`) and Store Catalog
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:96`) both call
  `builder.Services.AddStackExchangeRedisOutputCache(...)`. `AddOutputCache` registers its store with
  `TryAdd`, so the explicit registration wins regardless of call order, and with no Redis configured the
  in-memory store still applies, which is correct at a single replica. ADR-040's 2026-07-25 amendment
  makes the shared store the expected posture for any multi-replica deployment. The practical effect is
  that both tiers ride the same Redis instance: Tier 1 through `IDistributedCache`, Tier 2 through the
  output-cache store.

### An optional third tier on the client (amended 2026-09-01)
Two tiers are what this ADR decides. A third one exists in the framework as a capability a UI host may
switch on, and it is recorded here so a reader is not surprised by it in the UI package.

- **`IUiReadCache` caches in front of the API client, not in front of a handler.** The interface
  (`MMCA.Common.UI/Services/Caching/IUiReadCache.cs:32`) is `TryGetFresh` (`:42`), `Set` (`:51`),
  `InvalidatePrefix` (`:59`) and `Clear` (`:66`); the default implementation
  (`MMCA.Common.UI/Services/Caching/UiReadCache.cs:18`) is a lock-guarded dictionary with lazy expiry,
  registered scoped by `AddUIShared` (`MMCA.Common.UI/DependencyInjection.cs:57`, `TryAddScoped`),
  which is one instance per Blazor Server circuit and one per app lifetime on WebAssembly and MAUI.
- **The key is the relative URL, path plus the full query, deliberately the same key shape Tier 2
  uses.** `PublicEndpointOutputCachePolicy` sets `CacheVaryByRules.QueryKeys = "*"`
  (`MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:81`), so mirroring it means the two
  layers agree on what "the same read" is: a filter, page or sort change misses on both sides instead
  of being answered stale by one of them (`MMCA.Common.UI/Services/EntityServiceBase.cs:229`).
- **Freshness is stated in configuration.** `UiReadCacheOptions`
  (`MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:13`, bound from the `UiReadCache` section,
  `:16`) carries an `Enabled` kill switch (`:24`), a 60-second `DefaultTtl` (`:32`) and per-route-prefix
  TTL overrides (`:41`). The longest matching prefix wins (`UiReadCache.cs:120-135`, the length
  comparison at `:127`), so a nested route can state a stricter budget than the endpoint above it
  whatever order configuration enumerates in.
- **Successes only, prefix invalidation on write, clear on sign-out.** `GetCachedAsync`
  (`MMCA.Common.UI/Services/EntityServiceBase.cs:241`) stores a value only when the read succeeded
  (`:262-264`), so a transient outage or a 404 is never pinned in front of the user; a successful write
  drops this endpoint's whole prefix (`InvalidateOnSuccess`, `:281`, calling
  `InvalidatePrefix(Endpoint)` at `:285`); and `AuthUIService` empties the cache on sign-out and on an
  unrefreshable session (`MMCA.Common.UI/Services/Auth/AuthUIService.cs:127` and `:156`), which is what
  keeps one account's reads from outliving its session where the scope does.
- **Shipped and registered, adopted by no app.** `EntityServiceBase` takes the cache as an optional
  constructor parameter defaulting to `null` (`MMCA.Common.UI/Services/EntityServiceBase.cs:47`,
  exposed as the protected `ReadCache` property at `:58`); with `null` every read goes to the API and
  the class behaves exactly as it did before the cache existed (`:248`). No UI service in ADC, Store or
  Helpdesk passes it: a search of all four repositories finds `IUiReadCache` only inside MMCA.Common's
  own source and tests. This tier is therefore a capability the framework offers, not a posture the
  apps are in.

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
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:124,129`, Notification
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:98,103`, Engagement
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:95,100`, Identity
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:116,121`; Store Catalog
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:73,78`, Sales
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:89,94`, Identity
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:78,83`). Those seven are the
  whole set: a sweep of both repos' `Source/` trees for `AddRedisDistributedCache` /
  `AddRedisClient` finds no eighth registration. So whenever Redis is
  configured, prefix-based invalidation against Redis is live and cached entries are evicted on write; the
  30s TTL is now the backstop only for the no-Redis case (memory mode), where prefix removal self-heals
  within seconds instead. Single-key `RemoveAsync` is unaffected in either mode.
- **Distributed mode pays serialization and a network hop.** Values cross the wire as JSON; large or
  hot objects cost more than the in-process path.
- **Counter increments are not atomic, and that is the accepted position.**
  `ICacheService.IncrementAsync` is a default interface member implemented as a read-modify-write
  (`MMCA.Common.Application/Interfaces/ICacheService.cs:59`), and `DistributedCacheService` overrides it
  with the same read-modify-write shape rather than Redis `INCR`
  (`MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:146-152`). The reason is a storage
  format mismatch, documented at the implementation
  (`MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:127-145`): `INCR` writes a Redis
  string, while `StackExchangeRedisCache` stores every entry as a Redis hash (`absexp` / `sldexp` /
  `data`, read back with `HMGET`). An `INCR`-written counter therefore makes the next read of that key
  fail with `WRONGTYPE`, which surfaces as a 500 on whatever endpoint owns the counter (registration and
  login, in the ADR-029 case). A counter has to live in the same storage format as the reads that
  consult it, so readability wins over atomicity here: the ADR-029 brute-force and rate-limit counters
  can undercount under genuinely concurrent increments, and an occasional lost increment is the accepted
  cost of a counter that is always readable. One caveat for a reader who goes to the interface first:
  its `<remarks>` still anticipates the opposite outcome (backing stores that can do better with Redis
  `INCR` override it, `MMCA.Common.Application/Interfaces/ICacheService.cs:54-57`). No implementation
  does, and the one that could deliberately does not, for the storage-format reason above. Read that
  comment as an option the framework declined, not as a description of a shipped override; the
  implementation's own `<remarks>` is the accurate one.
- **Output caching is opt-in per service.** A read-heavy service that forgets to register a real
  `AddOutputCache` policy gets no edge caching (the `NoCache` base is the safe default), the same
  audit-the-inventory caveat as other opt-in capabilities (ADR-019/020/021). Adopting a policy is only
  half the decision: the store behind it is per-replica memory unless the service registers the shared
  Redis output-cache store (Tier 2 above), which is what a multi-replica adopter needs for tag eviction
  to reach every replica (ADR-040).
- **The optional client tier is an inventory item, and the inventory is empty.** `IUiReadCache` is
  registered wherever a host calls `AddUIShared` (`MMCA.Common.UI/DependencyInjection.cs:57`), but a UI
  service reads through it only if its own constructor forwards the optional parameter
  (`MMCA.Common.UI/Services/EntityServiceBase.cs:47`), so registration on its own changes nothing and
  no build, test or startup notices the difference. That is Tier 2's audit-the-inventory caveat one
  layer further out, and it is the intended posture rather than a gap to sweep: client-side staleness
  is visible to the user, so each UI service opts in on its own read pattern or does not opt in at all.

## Related
ADR-014 (the Caching decorators and `IQueryCacheable` / `ICacheInvalidating` markers that consume this
substrate), ADR-019 (output caching as the anonymous-traffic lever, and `LoginProtectionService` is
another `ICacheService` consumer), ADR-006 / ADR-008 (the same monolith-to-services swap boundary this
substrate follows), ADR-040 (amends this ADR's Tier 2: the adopters' public-read policies cache
authenticated, bearer-carrying requests too, not only anonymous traffic, and its
`CacheVaryByRules.QueryKeys = "*"` rule is the key shape the optional client tier mirrors),
[ADR-077](077-hybridcache-substrate.md) (amends this ADR's Tier 1: the opt-in `HybridCacheService`
substrate, the disjoint `hc:` keyspace that generalizes the `WRONGTYPE` lesson recorded in the counter
trade-off above, and the L1 bypass that keeps `IncrementAsync` semantics unchanged),
[ADR-090](090-event-upcaster-registration.md) (the upcaster registration and the
`RegisterUpcastedIntegrationEventConsumer<TEvent>` sibling that a future reshape of this ADR's
`OutputCacheEvictionRequested` contract would go through).

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

Every anchor in this entry was correct on 2026-08-07 and has since drifted, the `CacheOptions`
citation in item 2 included: read the whole entry as the state on that date, and the 2026-08-14
entry below for the current anchors.

## Revision (2026-08-13)
Tier 1 is amended by [ADR-077](077-hybridcache-substrate.md), which is where the decision and its
trade-offs are recorded. The three points that change the reading of this record:

1. **A third substrate, opted into rather than auto-selected.** `HybridCacheService` (L1 in-process
   plus L2 distributed, `Microsoft.Extensions.Caching.Hybrid`) joins `MemoryCacheService` and
   `DistributedCacheService`. `AddCaching()`'s presence-of-a-real-`IDistributedCache` swap still
   decides between the original two; `AddCommonHybridCache(...)` replaces the result. A host that does
   not call it gets byte-identical behavior to this record as written.
2. **The counter trade-off above is generalized into a keyspace rule.** The `WRONGTYPE` incident
   documented in Trade-offs (a Redis `INCR` string read back by the hash-shaped
   `StackExchangeRedisCache` path) is a class of bug, not one occurrence: two serialization formats
   must never share one keyspace. The hybrid substrate therefore writes under a disjoint
   `{prefix}hc:{key}` keyspace, so a cross-format read cannot happen at all, and prefix eviction scans
   that one keyspace: what this substrate writes is exactly what it evicts. The non-atomic
   read-modify-write `IncrementAsync` position is unchanged, and the hybrid implementation bypasses L1
   on both legs precisely to keep it unchanged.
3. **Nothing in Tier 2 moves.** The output-cache edge, its policies and its Redis-backed store are
   untouched by ADR-077.

## Revision (2026-08-14)
One substrate correction plus a line-anchor re-verification. No decision and no behavior changed.

1. **The 30-second default now has a named home, `CacheOptions.DefaultDuration`.** Tier 1 described
   the default TTL as `DefaultExpiration`'s literal `TimeSpan.FromSeconds(30)`. `CacheOptions` has
   since gained a `DefaultDuration` property (`CacheOptions.cs:17`), a bare `TimeSpan` added for the
   ADR-077 `HybridCacheService`, whose entry options are `HybridCacheEntryOptions` rather than
   `DistributedCacheEntryOptions` and so could not have reused `DefaultExpiration` without
   hard-coding the figure a second time. `DefaultExpiration` now reads
   `AbsoluteExpirationRelativeToNow = DefaultDuration` (`CacheOptions.cs:22-25`). The value is still
   30 seconds and every claim built on it still holds; there is now one place to change it.
2. **The seven paired Redis registrations are confirmed exhaustive.** Previous revisions re-anchored
   the seven named services one by one without ever asking whether an eighth had appeared. A sweep of
   both repos' `Source/` trees for `AddRedisDistributedCache` / `AddRedisClient` returns exactly these
   fourteen call sites, so "all seven services" is a verified count, not an assumption. The Trade-offs
   entry now says so.
3. **`AddCaching`.** Now at `MMCA.Common.Infrastructure/DependencyInjection.cs:164` (from `:157`);
   line 157 is now the closing brace of the preceding method.
4. **Tier 2.** `app.UseOutputCache()` moved to `WebApplicationExtensions.cs:111` (from `:104`). ADC
   Conference's `AddStackExchangeRedisOutputCache(...)` moved to `Program.cs:156` (from `:147`) and
   Store Catalog's to `Program.cs:117` (from `:98`).
5. **Trade-offs, the seven paired Redis registrations.** All seven moved: ADC Conference to
   `Program.cs:140,145` (from `:131,136`), Notification to `Program.cs:114,119` (from `:106,111`),
   Engagement to `Program.cs:111,116` (from `:96,101`), Identity to `Program.cs:131,136` (from
   `:123,128`); Store Catalog to `Program.cs:94,99` (from `:83,88`), Sales to `Program.cs:111,116`
   (from `:82,87`), Identity to `Program.cs:100,105` (from `:87,92`).
6. **Counter anchors.** `DistributedCacheService`'s `IncrementAsync` is now at
   `DistributedCacheService.cs:127-133` (from `:175-181`) and the storage-format-mismatch `<remarks>`
   documenting it at `DistributedCacheService.cs:108-126` (from `:156-174`), a move of about 48 lines
   up. The read-modify-write behavior and the reason for it are unchanged. `ICacheService.cs:57` and
   the Tier 2 policy anchors (`OutputCacheOptionsExtensions.cs:20`,
   `PublicEndpointOutputCachePolicy.cs:35`, `:71-75`, `:109-113`) were re-checked and are unchanged.
7. **The 2026-08-07 anchor claim is annotated rather than removed**, consistent with how every
   preceding revision treated its predecessor: the anchors it recorded were correct on 2026-08-07 and
   have since drifted again.

Items 1, 3, 4 and 6 of this entry were correct on 2026-08-14 and have since drifted, and item 4's
`WebApplicationExtensions.cs` home no longer exists at all: read the entry as the state on that date,
and the 2026-08-23 entry below for the current anchors.

## Revision (2026-08-18)
Every previous revision moved Tier 1. This one moves **Tier 2**, and it is the first change to the
output-cache edge since [ADR-040](040-authenticated-output-caching-for-public-reads.md).

Tier 2 as decided here is per-process by construction: each host calls `UseOutputCache`, owns its own
policies, and evicts by tag through its own `IOutputCacheStore`. In a database-per-service deployment
(ADR-006/008) the thing that invalidates a cached read frequently happens somewhere else: a mutation in
one service makes another service's cached public read wrong, and that service has no way to hear about
it. The eviction call and the write that requires it were in different processes, so the only
invalidation that crossed a boundary was the expiry clock.

### An integration event carries the eviction
`OutputCacheEvictionRequested`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29`) is
a sealed record over `BaseIntegrationEvent` whose only own member is
`IReadOnlyList<string> Tags { get; init; } = []` (`:37`), inheriting `SchemaVersion => 1`
(`.../DomainEvents/BaseIntegrationEvent.cs:32`) and therefore ADR-010's versioning contract. It is the
**first concrete integration event the framework itself ships**: a repository-wide search of `Source/`
finds no other, every prior hit being the interface, the abstract base or generic plumbing. Until now
the framework provided the delivery machinery and consumers provided all the messages.

**`Tags` defaulting to empty is a safety decision, not a formality.** An empty list means evict
nothing, so a message that arrives malformed, from an older producer, or with a property the consumer
cannot bind, degrades to a no-op instead of to a cache-wide flush. The failure mode of the default is a
stale response, which the TTL already bounds; the alternative default would have made a deserialization
accident indistinguishable from an intentional purge.

Delivery reuses the whole existing path rather than adding a channel: the producing service raises the
event, ADR-003's outbox persists and publishes it, ADR-066's broker carries it, and ADR-021's inbox
dedups the redelivery. Nothing about eviction is transactional or exactly-once, and it does not need to
be: evicting twice is free, and evicting late is what a TTL is for.

### The consumer side is two registrations in two packages
`RegisterOutputCacheEvictionConsumer(bool registerFaultConsumer = true)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:108-110`)
is the MassTransit-side shorthand for `RegisterIntegrationEventConsumer<OutputCacheEvictionRequested>()`,
so it inherits ADR-087's fault consumer by default. It now sits below a sibling in that same file,
`RegisterUpcastedIntegrationEventConsumer<TEvent>` (`:78-90`), the
[ADR-090](090-event-upcaster-registration.md) registration a host adds while a retired contract still
drains from a queue. The two are alternatives on one event, never both: registering a plain and an
upcasting consumer for the same type puts two consumers on one queue. `AddOutputCacheEvictionHandler()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:111`)
registers the handler itself, through `TryAddEnumerable` (`:115-117`). They are in different packages
because the two halves are genuinely different concerns (broker registration is Infrastructure, output
caching is API), and **a host that calls only one gets silence**: the consumer without the handler
receives and discards, the handler without the consumer is never invoked.

`OutputCacheEvictionHandler`
(`.../MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:32`) loops the tags, skips blank ones, and
catches per tag so one failing tag cannot abandon the rest (`:44-63`), rethrowing only
`OperationCanceledException` so a stopping host is not counted as a cache failure. Failures increment
`cache.eviction.failed`, tagged `cache_tag`, on a new meter `MMCA.Common.OutputCache`
(`.../Caching/OutputCacheMetrics.cs:19`, instrument at `:29-37`), subscribed by the Aspire defaults
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:169`).

One deliberate non-reuse: the handler does **not** route through the `BestEffort.ExecuteAsync` helper
that shipped in the same release. `BestEffort` lives in the Application layer and counts on its own
`MMCA.Common.BestEffort` meter, which the API package cannot reach without either a layer-crossing
reference or a duplicated meter name; the handler therefore hand-rolls the same swallow-log-count shape
against its own instrument. That is a small duplication chosen over a worse coupling, and it is the
reason two "best effort" counters exist in one release.

### What this revision costs
- **Cross-service eviction is asynchronous and unordered relative to the write.** The stale window is
  at least an outbox poll plus broker delivery plus the consumer's own scheduling, so a reader can
  observe the old response after the writer's transaction has committed. Tier 2 was always
  eventually-consistent; this makes the eventual explicit and measurable rather than bounded by the TTL
  alone.
- **The tag vocabulary is a shared string contract nothing validates.** The producer names a tag the
  consumer's policies must also name. A typo evicts nothing and **counts nothing**, because evicting an
  unknown tag succeeds: the failure counter sees only faults, never misses, so the most likely error is
  the one with no signal.
- **`cache.eviction.failed` has no alert and no runbook section.** It joins the counters ADR-087 also
  left unwired ([ADR-062](062-slo-alerting-as-code.md)), so a service quietly failing every eviction is
  visible only to someone already looking at the meter.
- **The two-call registration is an inventory item.** Nothing fails a build, a test or a startup when a
  host wires one half, and both halves are opt-in per host on top of that.
- **The framework now owns a wire contract.** `OutputCacheEvictionRequested` is a published shape that
  ADR-010's rules apply to, so a future field is an additive change with an upcaster or a new type,
  never a reshape, and that obligation now sits on the framework rather than only on consumers.
- **Tier 1 and Tier 2 remain separate invalidation models.** A single mutation may need a Tier 1 prefix
  invalidation and a Tier 2 tag eviction, and nothing coordinates them; ADR-077 moved one, this
  revision moves the other, and they still do not meet.

## Revision (2026-08-23)
One correction of substance plus a line-anchor re-verification. No decision and no behavior changed.

1. **The counter trade-off now names the contradiction a reader will hit.** `ICacheService`'s
   `<remarks>` on `IncrementAsync` says that backing stores which can do better with Redis `INCR`
   override it (`MMCA.Common.Application/Interfaces/ICacheService.cs:54-57`). Nothing does. The only
   store that could, `DistributedCacheService`, deliberately keeps the read-modify-write and documents
   why at its own implementation (`DistributedCacheService.cs:107-133`). The Revision (2026-07-25)
   already recorded that no `INCR` override exists or is intended, but this ADR never said that the
   interface comment still points the other way, so a reader starting from the interface reached the
   opposite conclusion. Trade-offs now says which of the two comments describes shipped behavior. The
   source comment is unchanged by this entry; only the ADR is.
2. **Tier 2's `UseOutputCache` call has a new home, and a different shape of home.**
   `app.UseOutputCache()` is no longer an inline call in
   `MMCA.Common.API/Startup/WebApplicationExtensions.cs` (it is not in that file at all). The shared
   middleware pipeline is now assembled from named steps: the output-cache step is at
   `MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs:138`, named by
   `MiddlewarePipelineStepNames.OutputCache`
   (`MMCA.Common.API/Startup/MiddlewarePipelineStepNames.cs:64`). The decision is untouched, the
   pipeline still always enables output caching and still ships no policies, but the citation now
   points at a builder rather than at a sequence of calls.
3. **The eviction event's method surface gained an ADR-090 sibling.**
   `RegisterOutputCacheEvictionConsumer` moved to
   `IntegrationEventConsumerExtensions.cs:108-110` (from `:68-70`) because
   `RegisterUpcastedIntegrationEventConsumer<TEvent>` (`:78-90`) was added above it, the registration
   [ADR-090](090-event-upcaster-registration.md) defines for draining a retired contract. The
   2026-08-18 revision predates it and did not mention it; the consumer paragraph now does, including
   that the two are alternatives on one event rather than a pair. ADR-090 is added to Related.
4. **Remaining anchors.** `AddCaching` is now at
   `MMCA.Common.Infrastructure/DependencyInjection.cs:177` (from `:164`).
   `OutputCacheEvictionRequested`'s declaration is at `:27` and `Tags` at `:35` (from `:23` and `:31`),
   both pushed down four lines by a Frozen-contract-candidate paragraph added to the doc comment.
   `BaseIntegrationEvent.SchemaVersion` is at `:32` (from `:22`), likewise behind added doc text.
   `ICacheService`'s `IncrementAsync` declaration is at `:59` (from `:57`; `:57` is now the last line of
   the `<remarks>` discussed in item 1). Re-checked and unchanged: `CacheOptions.cs:17` and `:22-25`,
   both adopters' `AddStackExchangeRedisOutputCache` calls and all seven paired Redis registrations,
   `DistributedCacheService.cs:108-126` and `:127-133`, the Tier 2 policy anchors
   (`OutputCacheOptionsExtensions.cs:20`, `PublicEndpointOutputCachePolicy.cs:35`, `:71-75`,
   `:109-113`), `OutputCacheEvictionExtensions.cs:32` and `:36-38`, `OutputCacheEvictionHandler.cs:32`
   and `:44-63`, `OutputCacheMetrics.cs:19` and `:29-37`, and `MMCA.Common.Aspire/Extensions.cs:169`.
5. **The 2026-08-14 anchor claim is annotated rather than removed**, consistent with how every
   preceding revision treated its predecessor.

Item 4's "re-checked and unchanged" list did not hold: `CacheOptions`, both adopters'
`AddStackExchangeRedisOutputCache` calls, all seven paired Redis registrations and the
`DistributedCacheService` counter anchors have all moved since. Read items 1 and 4 as the state on
2026-08-23, and the 2026-08-31 entry below for the current anchors. Item 2's
`MiddlewarePipelineStepNames.cs:64` was an off-by-one from the start rather than drift: `:64` is the
XML doc comment and the const it names is at `:65`, corrected in the Decision by the 2026-09-01 entry
below.

## Revision (2026-08-31)
Line anchors only, re-verified against the current source. No decision, no behavior, and no
substantive prose changed.

1. **`AddCaching`.** Now at `MMCA.Common.Infrastructure/DependencyInjection.cs:215` (from `:177`);
   line 177 is now inside `AddInfrastructure`, at its `IOutboxSignal` registration. The
   presence-of-a-real-`IDistributedCache` swap it describes is unchanged.
2. **`CacheOptions`.** `DefaultDuration` is at `CacheOptions.cs:23` (from `:17`, now a line of the
   doc comment above it) and `DefaultExpiration`'s
   `AbsoluteExpirationRelativeToNow = DefaultDuration` at `:28-31` (from `:22-25`). The figure is
   still 30 seconds and still has exactly one home.
3. **Tier 2.** ADC Conference's `AddStackExchangeRedisOutputCache(...)` is at `Program.cs:140` (from
   `:156`) and Store Catalog's at `Program.cs:96` (from `:117`).
4. **Trade-offs, the seven paired Redis registrations.** All seven moved up: ADC Conference to
   `Program.cs:124,129` (from `:140,145`), Notification to `Program.cs:98,103` (from `:114,119`),
   Engagement to `Program.cs:95,100` (from `:111,116`), Identity to `Program.cs:116,121` (from
   `:131,136`); Store Catalog to `Program.cs:73,78` (from `:94,99`), Sales to `Program.cs:89,94`
   (from `:111,116`), Identity to `Program.cs:78,83` (from `:100,105`). The 2026-08-14 exhaustiveness
   check still holds: a sweep of both repos' `Source/` trees for `AddRedisDistributedCache` /
   `AddRedisClient` returns these same fourteen call sites and no eighth service.
5. **Counter anchors.** `DistributedCacheService`'s `IncrementAsync` override is now at
   `DistributedCacheService.cs:146-152` (from `:127-133`) and the storage-format-mismatch `<remarks>`
   documenting it at `:127-145` (from `:108-126`); the old range now falls inside the unrelated
   `RemoveByPrefixAsync` (its no-multiplexer warning and Redis SCAN delete). The read-modify-write
   behavior and the reason for it are unchanged, and `ICacheService.cs:54-57` / `:59` were re-checked
   and still hold, so item 1 of the 2026-08-23 entry stands as written.
6. **The eviction event.** `OutputCacheEvictionRequested`'s declaration is at `:29` and `Tags` at
   `:37` (from `:27` and `:35`), both pushed down two lines by the
   `[EventName("Common.OutputCacheEvictionRequested.v1")]` attribute now sitting on the type (`:28`)
   and the `using` it needs (`:1`). Re-checked and unchanged: `IntegrationEventConsumerExtensions.cs:108-110` and `:78-90`, and
   the Tier 2 policy anchors (`OutputCacheOptionsExtensions.cs:20`,
   `PublicEndpointOutputCachePolicy.cs:35`, `:71-75`, `:109-113`).
7. **The 2026-08-23 anchor claim is annotated rather than removed**, consistent with how every
   preceding revision treated its predecessor.

## Revision (2026-09-01)
One amendment of substance (an optional third tier is recorded) plus line anchors for the files the
2026-08-31 entry did not re-read. No behavior changed, and neither server tier changed.

1. **The eviction registration.** `AddOutputCacheEvictionHandler()` is now at
   `MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:111` (from `:32`) and its
   `TryAddEnumerable` call at `:115-117` (from `:36-38`). The class itself is still the head of the
   file (`:27`); what moved the members is a second `extension(T)` block added above the
   `extension(IServiceCollection services)` one (`:36` and `:95` respectively), holding the multi-tag
   eviction helpers `EvictTagsAsync` (`:49`) and its best-effort sibling `TryEvictTagsAsync` (`:78`)
   that a mutating controller calls after a write, plus the `EvictOperationPrefix` const they name
   their operations from (`:34`). Two `extension(T)` blocks in one static class is also why the file
   now carries a CA1708 suppression (`:23-26`). The registration behavior the citation describes,
   one handler however many callers register it, is unchanged.
2. **Re-checked and unchanged.** `OutputCacheEvictionHandler.cs:32` (the class) and `:44-63` (the
   per-tag loop with its swallow-log-count catch), `OutputCacheMetrics.cs:19` (the meter name) and
   `:29-37` (the `cache.eviction.failed` instrument plus its recorder), and
   `MMCA.Common.Aspire/Extensions.cs:169` (the meter subscription, which is the SIXTH of the seven
   chained `AddMeter` calls, not the fifth: they begin at `MMCA.Common.Outbox` on `:164` and run
   Outbox, Cqrs, Idempotency, Scheduler, Broker, OutputCache, BestEffort).
   The 2026-08-31 entry's own anchors were not re-read this pass and stand as written there.
3. **The output-cache step name was cited one line high, and always had been.**
   `MiddlewarePipelineStepNames.OutputCache` is declared at
   `MMCA.Common.API/Startup/MiddlewarePipelineStepNames.cs:65`; `:64`, the anchor the Decision and the
   Revision (2026-08-23) carried, is the XML doc comment above it. The Decision's citation is
   corrected here and the 2026-08-23 entry is annotated in place rather than rewritten.
   `MiddlewarePipelineBuilder.cs:138`, the `app.UseOutputCache()` step itself, was re-read and holds.
4. **An optional third tier is recorded: `IUiReadCache`, the client-side read-through cache.** No code
   moves with this entry; this is shipped code the ADR had never described. A new Decision subsection
   and a new Trade-offs bullet record it: per-circuit read-through over the API client, keyed by the
   relative URL so the key shape matches Tier 2's `QueryKeys = "*"`
   (`PublicEndpointOutputCachePolicy.cs:81`), a default TTL plus longest-prefix per-route overrides
   (`UiReadCacheOptions.cs:32` and `:41`), successes-only storage
   (`EntityServiceBase.cs:262-264`), prefix invalidation on a successful write (`:285`) and a clear on
   sign-out (`AuthUIService.cs:127`). It is DI-registered by `AddUIShared`
   (`MMCA.Common.UI/DependencyInjection.cs:57`) and still opt-in per service, through an optional
   constructor parameter that defaults to `null` (`EntityServiceBase.cs:47`), and **no consumer app
   passes it**: ADC, Store and Helpdesk contain no reference to the type at all. It is recorded as a
   capability and an inventory item, not as something to adopt in a sweep. The title stays
   "Two-Tier Caching" on purpose: two tiers are what this ADR decides, and the client one is optional.
5. **The 2026-08-31 anchor claim is annotated rather than removed**, consistent with how every
   preceding revision treated its predecessor.
