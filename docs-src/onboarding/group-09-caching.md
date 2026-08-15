# 9. Caching

**What this group covers.** Caching in this codebase is small, deliberate, and woven into the CQRS
pipeline rather than scattered across handlers. The group is eight types: one port the Application
layer depends on ([`ICacheService`](#icacheservice)), three Infrastructure adapters that implement it
([`MemoryCacheService`](#memorycacheservice), [`DistributedCacheService`](#distributedcacheservice),
and the opt-in two-level [`HybridCacheService`](#hybridcacheservice)), the shared Redis prefix-eviction
helper the last two both run ([`RedisPrefixScanner`](#redisprefixscanner)), a static TTL-policy factory
([`CacheOptions`](#cacheoptions)), and the optional key-namespace pair
([`CacheKeyPrefixOptions`](#cachekeyprefixoptions) plus its internal applier
[`CacheKeyNamespace`](#cachekeynamespace)) that keeps two services sharing one Redis instance out of
each other's keyspace. No handler ever talks to Redis or `IMemoryCache` directly: the read-through and
invalidate-on-write behavior lives in two pipeline decorators taught in
[Group 5, CQRS Pipeline](group-05-cqrs-pipeline.md). This chapter is the cache's own machinery, the
contract, the three backends, the scanner, the TTL policy, and the namespace, plus how they plug into
that pipeline.

**The contract.** [`ICacheService`](#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10`) is a textbook Clean
Architecture port/adapter split (see [primer §1](00-primer.md#1-the-big-picture)): the interface lives
in `MMCA.Common.Application`, all three implementations live in `MMCA.Common.Infrastructure`, and
application code compiles against the interface alone. It declares six members. Four are abstract:
`GetAsync<T>` returning `T?` with `null` for a miss (`ICacheService.cs:17`), `SetAsync<T>` with an
optional `TimeSpan?` TTL (`ICacheService.cs:26`), `RemoveAsync` for one key (`ICacheService.cs:36`),
and `RemoveByPrefixAsync` for bulk eviction by key prefix (`ICacheService.cs:42`). Two are **default
interface members** with working bodies, so each one shipped without breaking an implementer:
`IncrementAsync` (`ICacheService.cs:59`) is a read-modify-write counter (`ICacheService.cs:61-64`) that
gives the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
brute-force and rate-limit counters one entry point instead of scattered get-then-set pairs, and
`GetOrCreateAsync<T>` (`ICacheService.cs:99`) folds read, per-key stripe, double-check, factory and
write into one call (`ICacheService.cs:108-123`) using the process-wide `CacheKeyLocks` table
(`ICacheService.cs:142-146`), cross-referenced in
[Group 5](group-05-cqrs-pipeline.md#cachekeylocks). Its XML doc is explicit about two limits that
matter: it caches whatever the factory returned, failed [`Result`](group-01-result-error-handling.md#result)
included, which is exactly why the caching decorators do not route through it, and its stampede
protection is per process (`ICacheService.cs:80-97`). `RemoveByPrefixAsync` is the load-bearing member:
it is what lets a single write evict every cached read it could have staled, and it is why the backends
had to be built rather than used off the shelf (`IMemoryCache` has no key enumeration, `IDistributedCache`
has no prefix delete). [Rubric §3, Clean Architecture] assesses whether dependencies point inward and
infrastructure stays replaceable; this is that rule in one file, since the only thing Application knows
about caching is six method signatures.

**Backend selection happens once, at the composition root.** `AddCaching(IConfiguration?)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:164`, called from
`AddInfrastructure` at `DependencyInjection.cs:119`) always calls `AddMemoryCache()`
(`DependencyInjection.cs:166`), binds the `Cache` section to
[`CacheKeyPrefixOptions`](#cachekeyprefixoptions) when configuration was supplied
(`DependencyInjection.cs:172`), then registers [`ICacheService`](#icacheservice) through
`TryAddSingleton` with a factory that probes the container (`DependencyInjection.cs:175-189`). If an
`IDistributedCache` is registered **and it is not the default `MemoryDistributedCache`**
(`DependencyInjection.cs:178`), meaning a real out-of-process store such as the Redis cache Aspire
wires, the factory builds a [`DistributedCacheService`](#distributedcacheservice) with whatever
`IConnectionMultiplexer` and `ILogger` it can resolve plus the bound key namespace
(`DependencyInjection.cs:180-184`); otherwise it falls back to a
[`MemoryCacheService`](#memorycacheservice) over the registered `IMemoryCache`
(`DependencyInjection.cs:188`). The same method registers the
[`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that the API idempotency filter pairs
with the cache, Redis-backed when a multiplexer is present and process-local otherwise
(`DependencyInjection.cs:195-209`). A single-process monolith therefore caches in-process for free, and
the identical application code uses Redis the moment a distributed cache is present: no flag, no
per-environment branch in a handler. This is the same "abstraction in Application, transport chosen at
the edge" pattern the message bus and gRPC clients use, which is what [Rubric §7, Microservices
Readiness] looks for (can a module move to its own process without a code change) and part of what
[Rubric §12, Performance and Scalability] rewards (the scaled-out deployment gets a shared cache
without touching business code).

**A third substrate, opt in and explicit.** `AddCommonHybridCache(Action<HybridCacheOptions>?)`
(`DependencyInjection.cs:248`) registers `HybridCache` with the framework's own defaults (the
[`CacheOptions.DefaultDuration`](#cacheoptions) TTL and a capped local expiration,
`DependencyInjection.cs:250-262`) and then swaps the cache implementation for
[`HybridCacheService`](#hybridcacheservice). The swap is deliberately `RemoveAll<ICacheService>()`
followed by `AddSingleton` (`DependencyInjection.cs:266-279`) rather than `TryAdd`, so the call wins
whether it runs before or after `AddInfrastructure`; the source is equally explicit that this also
removes a host's own bespoke `ICacheService`, so calling it is a statement that the two-level cache is
the cache (`DependencyInjection.cs:236-241`). All seven deployed service hosts call it, inside the same
"is Redis configured" branch that registers the distributed cache: ADC Conference at
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:164` and Store Catalog at
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:107`, with the other five alongside
them. Without Redis the branch does not run and the host keeps the auto-selected substrate, which is
the point: an L1 in front of an in-process L2 buys nothing ([ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)).

**The in-process adapter.** [`MemoryCacheService`](#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:18`) wraps
`IMemoryCache` and carries one side structure: a `ConcurrentDictionary<string, object>` of live keys
(`MemoryCacheService.cs:31`), because `IMemoryCache` cannot enumerate its own keys and without that
shadow index `RemoveByPrefixAsync` (`MemoryCacheService.cs:128-138`) would be impossible. Keeping the
cache and the index in agreement is the whole design. Every mutation takes that key's stripe from a
per-instance [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MemoryCacheService.cs:38`) and touches the cache before the table
(`MemoryCacheService.cs:101-105`), because ordering alone cannot close the window: track-then-write
lets a concurrent removal drop the record between the steps, and write-then-track lets a removal run
entirely between them, both leaving a live entry nothing can find. The post-eviction callback is
deliberately lock-free, since `IMemoryCache` queues it to the thread pool, and it removes the record
only while the record is still its own, comparing the entry token by reference and skipping
`EvictionReason.Replaced` outright (`MemoryCacheService.cs:93-99`). `GetAsync` also matches on the
stored object rather than using the generic `TryGetValue<T>` overload (`MemoryCacheService.cs:46`), so
a key reused under a different `T` surfaces as a clean miss instead of an `InvalidCastException`.

**The out-of-process adapter.** [`DistributedCacheService`](#distributedcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:18`)
serializes values to UTF-8 JSON via `System.Text.Json` (`DistributedCacheService.cs:135-139`) and
stores them through `IDistributedCache`. Prefix eviction is where it earns its keep: when an
`IConnectionMultiplexer` is available it hands the namespace-qualified pattern and a raw
`KeyDeleteAsync` to [`RedisPrefixScanner`](#redisprefixscanner)
(`DistributedCacheService.cs:98-104`). When no multiplexer is registered, prefix eviction cannot run at
all, and rather than failing silently the class logs a warning **once**, guarded by an
`Interlocked.Exchange` flag (`DistributedCacheService.cs:55`, `DistributedCacheService.cs:89-90`) and
naming the fix (`AddRedisClient`), because a permanently dead invalidation is a steady state that must
not flood the log on every command; the anomalous "multiplexer with no servers" case and a per-server
failure each get their own message (`DistributedCacheService.cs:102-103`). All three are compile-time
`LoggerMessage` sources (`DistributedCacheService.cs:141-148`). That warn-once-versus-warn-always split
is a small but real [Rubric §13, Observability and Operability] decision: §13 assesses whether an
operator can tell what the system is doing, and a cache whose invalidation quietly does nothing is
exactly the failure mode that hides from dashboards. The class also **overrides** `IncrementAsync`
(`DistributedCacheService.cs:127-133`) while keeping the same non-atomic read-modify-write shape, and
the comment above it (`DistributedCacheService.cs:108-126`) is worth reading: Redis `INCR` would be
atomic but writes a Redis *string*, while `StackExchangeRedisCache` stores every entry as a Redis
*hash*, so an `INCR`-written counter makes the next read fail with `WRONGTYPE`. Readability of the
counter wins over atomicity, and [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)
records the resulting undercount as an accepted position, not an open defect.

**One scanner, two callers.** [`RedisPrefixScanner`](#redisprefixscanner)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisPrefixScanner.cs:24`) is the shared
eviction engine. `RemoveMatchingAsync` (`RedisPrefixScanner.cs:53`) filters the multiplexer's servers
to the non-replicas (`RedisPrefixScanner.cs:64`), because keys are spread across primaries and scanning
only the first would leave the rest alive until their TTL, while a delete against a replica is rejected
outright. Each server is scanned inside its own try/catch so one unreachable node is logged and skipped
instead of aborting invalidation on the healthy ones, and cancellation is deliberately not caught
(`RedisPrefixScanner.cs:71-83`). `ScanAndDeleteAsync` (`RedisPrefixScanner.cs:92`) walks
`server.KeysAsync(pattern: ...)` and issues **one single-key delete per match**
(`RedisPrefixScanner.cs:105-115`): under Redis cluster policy a multi-key `DEL` must not span hash
slots and StackExchange.Redis answers a cross-slot command by throwing, so batching the keys of a
prefix would fault the invalidation rather than speed it up. Round trips still stay bounded by keeping
`DeleteBatchSize` = 512 deletes in flight and awaiting them as a group (`RedisPrefixScanner.cs:27`).
The delete itself is a caller-supplied callback and the log messages stay with the caller
(`RedisPrefixScanner.cs:10-23`), which is precisely what lets the two services share the scan while
removing keys differently.

**The two-level cache.** [`HybridCacheService`](#hybridcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:37`) puts an
in-process L1 in front of the registered distributed L2 and lets the platform's `HybridCache` supply
serialization, L1 promotion and stampede protection. Its structural decision is the **disjoint
keyspace**: every key is written as `{prefix}hc:{key}` (`HybridCacheService.cs:47`,
`HybridCacheService.cs:286`), so the payload layout `HybridCache` writes can never meet the UTF-8 JSON
[`DistributedCacheService`](#distributedcacheservice) writes at one key. That is the `WRONGTYPE`
lesson from `IncrementAsync` generalized: an entry in the other format is simply a clean miss, including
while a rolling deploy runs both builds (`HybridCacheService.cs:18-29`). Because a host switching over
inherits live entries in the old shape, `RemoveByPrefixAsync` runs the scanner **twice**, once over
`{prefix}hc:{key}*` deleting through `HybridCache.RemoveAsync` so this process's L1 copy goes with the
L2 entry, and once over the legacy `{prefix}{key}*` with raw deletes
(`HybridCacheService.cs:189-205`). Reads are fail-soft: a fault is logged, answered as a miss, and the
offending entry is dropped best-effort so the next write repopulates it
(`HybridCacheService.cs:96-115`, `HybridCacheService.cs:315-325`). `IncrementAsync` is the one member
that bypasses L1 on **both** legs (`HybridCacheService.cs:71-76`, `HybridCacheService.cs:232-253`), and
the reasoning is a [Rubric §11, Security] point rather than a performance one: a counter cached
per replica would let one process read its own stale count and write it back, so a brute-force limiter
could be held near its starting value indefinitely by a steady stream of attempts against a single
replica. Its faults are deliberately not swallowed either, since a counter that silently reads zero
resets the limit it exists to enforce (`HybridCacheService.cs:228-230`). `GetOrCreateAsync` overrides
the interface default with `HybridCache`'s own implementation (`HybridCacheService.cs:264-281`).
Replica L1 staleness after an invalidation is bounded by `LocalCacheDefault`, 30 seconds
(`HybridCacheService.cs:54`), not by the eviction, and the source names that as the accepted cost of
the L1 hit rate.

**The key namespace and the TTL policy.** [`CacheKeyPrefixOptions`](#cachekeyprefixoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28`) binds the `Cache`
configuration section (`CacheKeyPrefix.cs:31`) and carries one setting, `KeyPrefix`, defaulting to
empty (`CacheKeyPrefix.cs:37`). [`CacheKeyNamespace`](#cachekeynamespace) (`CacheKeyPrefix.cs:41`) is
the internal applier: a `None` instance for the untouched case (`CacheKeyPrefix.cs:44`), a `From`
factory that tolerates an unregistered options section (`CacheKeyPrefix.cs:50-54`), and `Qualify`
(`CacheKeyPrefix.cs:57`) which prepends the prefix. Both Redis-capable adapters honor it and apply it
*inside* the adapter rather than through `RedisCacheOptions.InstanceName`; the rationale in the source
(`CacheKeyPrefix.cs:14-22`) is precise, since `InstanceName` is prepended below this abstraction where
the SCAN cannot see it, so prefix eviction would search for `product:*` while the stored keys were
`svc:product:*` and evict nothing, silently. [`MemoryCacheService`](#memorycacheservice) ignores
prefixes entirely because a per-process keyspace is private by construction (`CacheKeyPrefix.cs:23-26`).
TTL policy is centralized the same way: [`CacheOptions`](#cacheoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9`) exposes a
deliberately short **30-second** `DefaultDuration` (`CacheOptions.cs:17`) as a bare `TimeSpan`, so
implementations that do not speak `DistributedCacheEntryOptions` still default to the same policy, plus
`DefaultExpiration` (`CacheOptions.cs:22`) and `Create(TimeSpan?)` (`CacheOptions.cs:32`) for the ones
that do. The short default is a staleness guard: caching is opt-in and conservative, and a read earns a
longer life only by asking for one. One policy object with many call sites is the
[Rubric §10, Cross-Cutting] habit this framework applies everywhere.

**How it fires at runtime.** Nothing above runs unless a use case opts in, via two marker interfaces
consumed by the CQRS decorator pipeline (`FeatureGate` then `Logging` then `Caching` then `Validating`
then `Transactional` then handler for commands, and the same chain without the last two for queries;
registered at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:96` and
`DependencyInjection.cs:101`, taught in [Group 5](group-05-cqrs-pipeline.md)). On the **read** path,
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
tests the query for [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) and passes straight
through when it is absent
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:69-70`).
When present it scopes the key to the resolved tenant through
[`TenantCacheKey`](group-05-cqrs-pipeline.md#tenantcachekey) (`CachingQueryDecorator.cs:63-64`, so two
tenants can never share an entry), takes a lock-free fast path on a hit
(`CachingQueryDecorator.cs:79-84`), and on a miss acquires a per-key stripe from the process-wide
[`QueryCacheKeyLocks`](group-05-cqrs-pipeline.md#querycachekeylocks) (`CachingQueryDecorator.cs:89`),
re-checks, records the miss on [`CqrsMetrics`](group-05-cqrs-pipeline.md#cqrsmetrics) exactly once
(`CachingQueryDecorator.cs:104`), and only then runs the inner handler. The lock table is a fixed-width
[`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`, 256 stripes by
default at `KeyedSemaphoreStripe.cs:25`), which bounds memory no matter how many parameterized cache
keys the process sees. Every cache call is fail-open: a read fault is logged and treated as a miss
(`CachingQueryDecorator.cs:155-170`) and a populate fault returns the result uncached
(`CachingQueryDecorator.cs:116-122`), so a cache outage degrades reads instead of turning cacheable
queries into 500s, which is the [Rubric §29, Resilience] posture in miniature. Results are stored only
when they are not a failed [`Result`](group-01-result-error-handling.md#result)
(`CachingQueryDecorator.cs:109`). On the **write** path,
[`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
runs the inner handler first and then, only if the command implements
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), the prefix is non-blank (a blank
prefix is the opt-out, and the guard is load-bearing since an empty prefix would evict the whole cache)
and the result is not a failure, evicts the tenant-scoped prefix with `CancellationToken.None`
(`.../Decorators/CachingCommandDecorator.cs:76-89`). It then schedules a second eviction five seconds
later (`CachingCommandDecorator.cs:60`, `CachingCommandDecorator.cs:96`, `CachingCommandDecorator.cs:113-126`)
to catch a read that began before the commit and repopulated the entry with pre-write state. Because
the Caching decorator sits outside the Transactional one, eviction runs after the transaction
committed: against persisted state, never in-flight state, and never at all when the write failed.

**Two tiers, not one.** These eight types are only **Tier 1** of the caching story that
[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records. Tier 2 is a separate
HTTP output-cache edge: `MMCA.Common.API` always calls `app.UseOutputCache()` in the shared middleware
pipeline (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:111`)
but ships no policies, so each host opts in with its own `AddOutputCache(...)`. The read-heavy public
services declare real cacheable policies through
[`OutputCacheOptionsExtensions`](group-12-api-hosting-mapping.md#outputcacheoptionsextensions) and its
`AddPublicEndpointPolicy`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:20`), backed
by [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy),
which caches GET and HEAD regardless of an `Authorization` header
([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
Both adopters back that edge with Redis when Redis is configured
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:156`), so the two tiers ride the same
Redis instance from opposite ends: Tier 1 through `IDistributedCache` or `HybridCache`, Tier 2 through
the output-cache store. Tier 2 belongs to [Group 12, API Hosting](group-12-api-hosting-mapping.md); it
is named here only so you do not confuse the two when you meet `[OutputCache]` on a controller.

**Adoption reality, so you read the code with the right expectations.** Prefix invalidation against
Redis is live in the deployed services: every service host registers `AddRedisClient("redis")`
immediately alongside `AddRedisDistributedCache("redis")` inside one connection-string conditional
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:138`, `:140` and `:145`;
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:94` and `:99`), precisely so the
multiplexer the SCAN needs is present. Write-side adoption is broad: dozens of commands across ADC
Conference, Engagement and Identity and across Store Catalog, Sales and Identity implement
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), for example
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/UseCases/Update/UpdateSponsorCommand.cs`.
Read-side adoption is not: ADC's [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`,
key at `:26-35`, a 30-second `CacheDuration` at `:38`) is the only
[`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) implementation in either application, so
most invalidation traffic currently evicts entries no query wrote. The substrate's other production
consumers are not decorators at all:
[`LoginProtectionService`](group-08-auth.md#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:20`) injects
[`ICacheService`](#icacheservice) for its brute-force and rate-limit counters
(`LoginProtectionService.cs:75`, `LoginProtectionService.cs:130`), covered in
[Group 8, Authentication and Authorization](group-08-auth.md), and
[`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) resolves it per request to
store and replay responses
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:142`). Three honest
caveats round this out. No host in the workspace sets `Cache:KeyPrefix` today, so
[`CacheKeyNamespace`](#cachekeynamespace) resolves to `None` everywhere and the feature is available
rather than exercised. The stampede lock is per process
(`CachingQueryDecorator.cs:186-191`): across replicas over a shared Redis you get at most one handler
execution per replica, not one cluster-wide, which is deliberate (a distributed lock is not attempted)
and harmless because the duplicated writes carry equal content. And `GetOrCreateAsync` has no
first-party caller outside tests today: it is a published extension point plus the member
[`HybridCacheService`](#hybridcacheservice) overrides.

**What the cache is not.** This is a request-result read-through cache for query handlers plus a
counter store and an idempotency record store, not a session store and not a write-behind buffer;
cross-source consistency in this codebase is the outbox's job
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), not the cache's. The
short default TTL and the two failure-skipping rules (never cache a failed result, never invalidate on
a failed command) mean the layer errs toward correctness over hit rate, which is the right default for
an opt-in cache bolted onto a database-per-service system. The unit tests for these types, including
the Redis-backed [`DistributedCacheServiceRedisTests`](group-27-testing-infrastructure.md#distributedcacheserviceredistests)
and [`HybridCacheServiceRedisTests`](group-27-testing-infrastructure.md#hybridcacheserviceredistests),
are catalogued in [Group 27, Testing and Quality Infrastructure](group-27-testing-infrastructure.md).

### CacheKeyPrefixOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28` · Level 0 · class (public sealed, options)

- **What it is**: the bound options object for one setting, `Cache:KeyPrefix`, the namespace prepended to every cache key written through [DistributedCacheService](#distributedcacheservice), [HybridCacheService](#hybridcacheservice) and the Redis distributed lock. It exists so several services sharing one Redis instance cannot read each other's entries by accidentally choosing the same key.
- **Depends on**: nothing first-party. It is a plain options POCO bound by `Microsoft.Extensions.Options` / `IConfiguration` (BCL). Its value is turned into behavior by [CacheKeyNamespace](#cachekeynamespace), which is what the cache adapters actually hold.
- **Concept introduced, keyspace isolation for a shared cache** `[Rubric §7, Microservices Readiness]`. §7 assesses whether a module keeps working, and keeps its data to itself, once it is lifted into its own process next to its siblings. A cache instance is exactly the kind of shared infrastructure that survives extraction unchanged, so the isolation a private process gave you for free has to be re-created explicitly: the class doc (`CacheKeyPrefix.cs:5-12`) states the failure mode plainly, two services that pick the same key for different data will serve each other's values. Giving each service a prefix such as `"conference:"` restores the separation. `[Rubric §11, Security]`, §11 assesses whether the system prevents data reaching a caller who should not see it; a cross-service key collision is a data-exposure bug wearing a performance-feature costume, and this option is the control that prevents it.
- **Walkthrough**
  - `SectionName` (`CacheKeyPrefix.cs:31`), `const string` = `"Cache"`. This is the configuration section, so the setting a host writes is `Cache:KeyPrefix`.
  - `KeyPrefix` (`CacheKeyPrefix.cs:37`), `string` with `{ get; init; }` and a default of `string.Empty`. Empty is the deliberate default: it leaves keys exactly as callers wrote them, which is the correct behavior for a host that owns its cache outright and does not share it.
- **Why it's built this way**: the class remarks (`CacheKeyPrefix.cs:13-27`) record the decision that makes this type necessary rather than redundant. Redis has a built-in equivalent, `RedisCacheOptions.InstanceName`, and it was rejected: `InstanceName` is prepended by `IDistributedCache` *below* this framework's abstraction, where prefix invalidation cannot see it. The SCAN that backs `RemoveByPrefixAsync` matches raw Redis keys, so it would search for `product:*` while the stored keys were `svc:product:*` and evict nothing, silently. Applying the prefix inside the adapter instead keeps get, set, remove and prefix eviction working from one key shape. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the same reasoning (`026-caching-strategy.md:173-174`).
- **Where it's used**: bound in `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:172`) via `services.Configure<CacheKeyPrefixOptions>(configuration.GetSection(CacheKeyPrefixOptions.SectionName))`, and only when a non-null `IConfiguration` was passed (`DependencyInjection.cs:170`). `AddInfrastructure` always passes one (`DependencyInjection.cs:119`), so a host composing through the normal entry point gets the binding; a test calling the parameterless `AddCaching()` overload does not. The bound options are then read once per registration through [CacheKeyNamespace](#cachekeynamespace)`.From`, at three sites: the distributed cache factory (`DependencyInjection.cs:183`), the Redis lock factory (`DependencyInjection.cs:202`) and the opt-in hybrid factory (`DependencyInjection.cs:272`).
- **Caveats / not-in-source**: [MemoryCacheService](#memorycacheservice) never sees the prefix, because a per-process keyspace is private by construction and a prefix would add nothing (`CacheKeyPrefix.cs:23-26`). Also worth knowing before you go looking for a live example: no checked-in `appsettings*.json` in the four repos sets `Cache:KeyPrefix`, so the effective prefix everywhere today is the empty default, and the option is a capability that is wired but not yet exercised.

---

### CacheOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9` · Level 0 · class (public static)

- **What it is**: the framework's TTL policy in one place. It exposes the default cache lifetime both as a bare `TimeSpan` and as a ready-made `DistributedCacheEntryOptions`, so no adapter and no caller hand-builds expiry options.
- **Depends on**: `Microsoft.Extensions.Caching.Distributed.DistributedCacheEntryOptions` (ASP.NET Core, NuGet). Indirectly fed by the per-query [IQueryCacheable](group-05-cqrs-pipeline.md#iquerycacheable) `CacheDuration`, which arrives as the `expiration` argument when a cacheable query's result is stored.
- **Concept introduced, TTL as the freshness dial** `[Rubric §12, Performance & Scalability]`. §12 assesses whether the system bounds staleness and avoids unbounded growth. The deliberately short 30-second default (`CacheOptions.cs:17`) is the conservative knob: a cached read is served for at most 30 seconds before falling through to the source, so a query that never declares its own duration cannot serve dangerously stale data. Callers that can tolerate more staleness widen the window per query. `[Rubric §10, Cross-Cutting Concerns]`, §10 assesses whether concerns like caching, logging and validation live in one place instead of being re-decided per handler; TTL policy here is one property in one file rather than a `TimeSpan.FromSeconds(30)` scattered through call sites.
- **Walkthrough**
  - `DefaultDuration` (`CacheOptions.cs:17`), a `static TimeSpan` property = `TimeSpan.FromSeconds(30)`. Its doc (`CacheOptions.cs:11-16`) explains why the bare `TimeSpan` exists alongside the options object: [HybridCacheService](#hybridcacheservice) expresses expiry in `HybridCacheEntryOptions`, its own type, and would otherwise have needed a second hard-coded 30 seconds. One number, two shapes.
  - `DefaultExpiration` (`CacheOptions.cs:22-25`), a property returning a *fresh* `DistributedCacheEntryOptions` on each access, with `AbsoluteExpirationRelativeToNow = DefaultDuration`. It is a property, not a shared static field, so two callers can never alias and mutate the same options instance.
  - `Create(TimeSpan? expiration)` (`CacheOptions.cs:32-35`), expression-bodied: a new options object carrying the caller's `AbsoluteExpirationRelativeToNow` when `expiration` is non-null, otherwise `DefaultExpiration`. A null duration therefore reads as "use the 30s default", which is exactly the meaning of the optional `TimeSpan?` on [ICacheService](#icacheservice)`.SetAsync`.
- **Why it's built this way**: a static factory (no instance, no shared mutable state) makes TTL policy a single, allocation-cheap decision point. Choosing *absolute* expiration over sliding means an entry's lifetime is bounded no matter how often it is read, which is the safer default for read-through query caching: a hot key cannot keep itself alive indefinitely on stale data. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the short default as the backstop that lets prefix invalidation stay best-effort without the system becoming incorrect (`026-caching-strategy.md:59`).
- **Where it's used**: [DistributedCacheService](#distributedcacheservice)`.SetAsync` calls `CacheOptions.Create(expiration)` for every write (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:47`). [HybridCacheService](#hybridcacheservice) uses `DefaultDuration` directly as the fallback TTL in `WriteOptions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:297`), and `AddCommonHybridCache` seeds `HybridCacheOptions.DefaultEntryOptions.Expiration` from the same property (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:257`). [MemoryCacheService](#memorycacheservice) does **not** route through this type at all; it builds `MemoryCacheEntryOptions` inline. Unit-tested by [CacheOptionsTests](group-27-testing-infrastructure.md#cacheoptionstests).
- **Caveats / not-in-source**: do not read the 30 seconds as a universal cache floor. Because [MemoryCacheService](#memorycacheservice) bypasses this type, an in-process entry set with a null TTL has no time-based expiry at all (`MemoryCacheService.cs:72-75`) and leaves only capacity pressure or an explicit removal to clear it.

---

### RedisPrefixScanner
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisPrefixScanner.cs:24` · Level 0 · class (internal static)

- **What it is**: the one implementation of "evict every Redis key matching this pattern". It SCANs each non-replica server and deletes every match, and both Redis-capable cache adapters call it instead of carrying their own copy of the loop.
- **Depends on**: `StackExchange.Redis` (`IConnectionMultiplexer`, `IServer`, `RedisKey`, `RedisException`) as its only external, plus the BCL. It is called by [DistributedCacheService](#distributedcacheservice) and [HybridCacheService](#hybridcacheservice); it references neither of them, so the dependency points one way.
- **Concept introduced, parameterizing the parts that differ instead of forking the algorithm** `[Rubric §1, SOLID]` and `[Rubric §2, Design Patterns]`. §1 assesses single responsibility and dependency direction; §2 assesses whether the code reaches for a known shape rather than improvising. The two callers need the same scan and different deletes, so the delete is a `Func<RedisKey, Task>` callback (`RedisPrefixScanner.cs:56`) rather than a fixed `KeyDeleteAsync`: [DistributedCacheService](#distributedcacheservice) deletes the raw Redis key, while [HybridCacheService](#hybridcacheservice) routes the delete back through `HybridCache.RemoveAsync` so its own in-process L1 copy dies with the L2 entry (`RedisPrefixScanner.cs:11-17`). Logging is parameterized the same way, as two `Action` hooks (`:57-58`), because each service owns its own compile-time `LoggerMessage` definitions and its own notion of the prefix being evicted (`:18-22`). `[Rubric §14, Testability]`, §14 assesses whether behavior can be exercised without standing up the world: folding the scan into one internal helper means the Redis-tier tests that cover one adapter cover the algorithm for both (`:6-8`).
- **Walkthrough**
  - `DeleteBatchSize` (`RedisPrefixScanner.cs:27`), `const int` = `512`. Read it carefully: it is the number of single-key deletes kept **in flight** at once, not the number of keys packed into one command.
  - `RemoveMatchingAsync(connectionMultiplexer, pattern, deleteAsync, onNoServers, onServerFailed, cancellationToken)` (`:53-84`), the entry point. It first collects every non-replica server, `[.. connectionMultiplexer.GetServers().Where(s => !s.IsReplica)]` (`:64`). Every primary is scanned, not just the first one the multiplexer reports, because keys are distributed across primaries and scanning one leaves the others' entries alive until their TTL expires; replicas are skipped because their keyspace mirrors a primary already scanned and a delete against a replica is rejected (`:42-46`). An empty server list invokes `onNoServers()` and returns (`:65-69`). Otherwise each server is scanned inside its **own** try/catch (`:71-83`) whose filter admits only `RedisException`, `RedisCommandException` and `TimeoutException` (`:77`), so one unreachable node is logged through `onServerFailed(Describe(server), ex)` and skipped while the healthy nodes still get invalidated. Cancellation is deliberately not caught (`:80`).
  - `ScanAndDeleteAsync(server, pattern, deleteAsync, cancellationToken)` (`:92-119`), the per-server loop. It allocates `new List<Task>(DeleteBatchSize)` (`:103`), enumerates `server.KeysAsync(pattern: pattern)` under `.WithCancellation(cancellationToken)` (`:105-107`), issues one delete per key without awaiting it (`:109`), and awaits the group with `Task.WhenAll` whenever the list reaches 512 (`:110-114`), with a final flush for the remainder (`:117-118`).
  - `Describe(server)` (`:122-123`), `server.EndPoint?.ToString() ?? "unknown"`: a stable identifier for log output that tolerates an unknown endpoint.
- **Why it's built this way**: the comment at `:98-102` is the part to internalize. Deletes go out one key at a time because a multi-key `DEL` must not span hash slots under Redis cluster policy, and StackExchange.Redis answers a cross-slot multi-key command by **throwing** rather than under-deleting. The keys behind one cache prefix hash to arbitrary slots, so batching them into a single command would fault the entire invalidation instead of speeding it up. Single-key deletes are always slot-safe, and the round-trip cost is contained by keeping 512 of them in flight rather than awaiting each one. The per-server try/catch is the same fail-soft posture the rest of this group takes: `[Rubric §29, Resilience]` assesses whether a partial infrastructure failure degrades instead of cascading, and here a failing node costs you the freshness of the keys it holds, nothing more.
- **Where it's used**: exactly two call sites in [DistributedCacheService](#distributedcacheservice)`.RemoveByPrefixAsync` (`DistributedCacheService.cs:98-104`) and three in [HybridCacheService](#hybridcacheservice)`.RemoveByPrefixAsync`, counting its dual-pattern pass (`HybridCacheService.cs:189-195` and `:199-205`). Exercised against a real Redis by [DistributedCacheServiceRedisTests](group-27-testing-infrastructure.md#distributedcacheserviceredistests) and [HybridCacheServiceRedisTests](group-27-testing-infrastructure.md#hybridcacheserviceredistests), which run in the dedicated `redis-integration` CI job over Testcontainers rather than in the unit loop.
- **Caveats / not-in-source**: `KeysAsync` (SCAN) is O(keyspace) on the Redis side. That is acceptable at invalidation cadence and is not a hot-path operation. Nothing here reports how many keys it removed, so the only evidence a scan ran at all is the absence of the warning hooks firing.

---

### CacheKeyNamespace
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:41` · Level 1 · class (internal sealed)

- **What it is**: the tiny behavioral half of [CacheKeyPrefixOptions](#cachekeyprefixoptions). It holds a resolved prefix string and exposes one operation, `Qualify`, that turns a caller-supplied cache key into the key actually stored. Living in the same file as the options class keeps the setting and its only interpretation together.
- **Depends on**: [CacheKeyPrefixOptions](#cachekeyprefixoptions) (only as the input to its `From` factory) and `Microsoft.Extensions.Options.IOptions<T>` (BCL). Consumed by [DistributedCacheService](#distributedcacheservice), [HybridCacheService](#hybridcacheservice) and [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock).
- **Concept introduced, the null object as a configuration default** `[Rubric §15, Best Practices & Code Quality]`. §15 assesses whether the code avoids incidental complexity and defensive noise. Rather than making every call site ask "is a prefix configured?", the unconfigured case is represented by a real instance, `None`, whose `Qualify` returns the key unchanged. There is one branch (`CacheKeyPrefix.cs:58`) instead of a null check at every use. `[Rubric §14, Testability]`, §14 assesses whether behavior can be exercised without standing up the world: because the type is a plain object that both adapters take as an optional constructor parameter, a unit test passes `new CacheKeyNamespace("svc:")` directly and asserts on the qualified key with no configuration system involved (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:421`, and the same shape throughout `HybridCacheServiceTests.cs:77-94`).
- **Walkthrough**: primary constructor `CacheKeyNamespace(string prefix)` (`CacheKeyPrefix.cs:41`).
  - `None` (`:44`), a `static` property initialised to `new(string.Empty)`. One shared, immutable instance meaning "leave keys alone".
  - `Prefix` (`:47`), get-only, initialised with `prefix ?? string.Empty`, so a null argument degrades to the no-op prefix rather than throwing later inside `string.Concat`.
  - `From(IOptions<CacheKeyPrefixOptions>? options)` (`:50-54`), the composition-root factory. It tolerates a **null options object** (the `?` is deliberate: the registrations resolve it with `GetService`, not `GetRequiredService`, so an unbound `Cache` section yields null), reads `options?.Value.KeyPrefix`, and returns `None` when that is null or empty. Both "no configuration section" and "section present but empty prefix" land on the same no-op path.
  - `Qualify(string key)` (`:57-58`), expression-bodied: returns `key` unchanged when `Prefix.Length == 0`, otherwise `string.Concat(Prefix, key)`. No separator is inserted, so the configured prefix must carry its own delimiter (`"conference:"`, not `"conference"`).
- **Why it's built this way**: `internal sealed` because it is an implementation detail of the Infrastructure caching adapters, never part of the package's public surface. Splitting an `init`-only options POCO from this behavior object keeps the configuration contract (bindable, public) separate from the runtime helper (internal, immutable, allocation-free on the common path). Resolving the prefix once at construction rather than per call also means the options are read a single time for the lifetime of the singleton.
- **Where it's used**: built in three DI factories and passed as a constructor argument: to [DistributedCacheService](#distributedcacheservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:183-184`), to [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock) (`:202-203`), and to [HybridCacheService](#hybridcacheservice) in the opt-in hybrid path (`:272-278`). Inside each adapter it lands in a `_keys` field with a `?? CacheKeyNamespace.None` fallback (`DistributedCacheService.cs:28`, `HybridCacheService.cs:82`). The in-process branch of `AddCaching()` constructs [MemoryCacheService](#memorycacheservice) with no namespace at all (`DependencyInjection.cs:188`), and the comment above it says why: the keyspace is private to the process.
- **Caveats / not-in-source**: because `Qualify` is applied inside the adapter and not by Redis, keys written by any code path that bypasses [ICacheService](#icacheservice) and talks to `IDistributedCache` directly would land unprefixed. Nothing in the framework does that today, but it is the invariant the design depends on.

---

### ICacheService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10` · Level 3 · interface

- **What it is**: the Application layer's cache port. Get by key, set with an optional TTL, remove by exact key, remove every key matching a prefix, increment a counter, and get-or-create with stampede protection. It hides whether the backing store is Redis, a SQL distributed cache, an in-process `IMemoryCache`, or a two-level `HybridCache`.
- **Depends on**: BCL types at the signature level (`Task`, `CancellationToken`, `TimeSpan?`) plus [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from `MMCA.Common.Shared.Concurrency`, which the default `GetOrCreateAsync` body uses through the [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) holder (`ICacheService.cs:1`, `:142-146`). Implemented by [MemoryCacheService](#memorycacheservice), [DistributedCacheService](#distributedcacheservice) and [HybridCacheService](#hybridcacheservice).
- **Concept introduced, dependency inversion for infrastructure** `[Rubric §3, Clean Architecture]`. §3 assesses whether business code depends on abstractions while concrete technology sits at the edges. The Application layer *defines* this contract; the Infrastructure layer *implements* it. Handlers, decorators and the auth services never see `StackExchange.Redis` or `Microsoft.Extensions.Caching`; they program against this interface and the container decides which adapter they get. **Second concept, the default interface member as a non-breaking extension point** `[Rubric §16, Maintainability]`. §16 assesses whether the codebase can absorb change without a ripple. Two members here ship with bodies, `IncrementAsync` (`:59`) and `GetOrCreateAsync` (`:99`). Every existing implementer keeps compiling and inherits working behavior, while a store with a better primitive overrides. That is how the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) counters, and later the whole [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) two-level substrate, were added to a *published package contract* without a breaking change. `[Rubric §12, Performance & Scalability]`, `RemoveByPrefixAsync` (`:42`) is the member that makes *scoped* invalidation possible: one mutation evicts a whole family of cached query results without enumerating individual keys.
- **Walkthrough**: members in declaration order.
  - `Task<T?> GetAsync<T>(string key, CancellationToken)` (`:17`), returns `default` / `null` on a miss.
  - `Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken)` (`:26-30`). A null `expiration` means "use the implementation's default TTL", resolved through [CacheOptions](#cacheoptions) on both distributed paths.
  - `Task RemoveAsync(string key, CancellationToken)` (`:36`), single-key eviction.
  - `Task RemoveByPrefixAsync(string prefix, CancellationToken)` (`:42`), bulk eviction of every key starting with `prefix`. This is what [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) invokes after a successful mutation.
  - `async Task<long> IncrementAsync(string key, TimeSpan expiration, CancellationToken)` (`:59-65`), a **default implementation**: read the current value as `long?` (0 on a miss), add one, write it back with `expiration`, return the new value. The doc (`:44-58`) is explicit about why it exists: rate-limit and brute-force counters ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)) built from a raw `GetAsync` + `SetAsync` pair let concurrent requests overwrite each other's increments and undercount, so the read-modify-write is at least centralised in one auditable place, and a store with a native counter primitive can override.
  - `async Task<T> GetOrCreateAsync<T>(string key, Func<CancellationToken, Task<T>> factory, TimeSpan? expiration = null, CancellationToken)` (`:99-124`), the second default implementation and the more interesting one. It null-guards the factory (`:105`), takes a **lock-free fast path on a hit** (`:108-110`), and only on a miss acquires the key's stripe from [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) (`:112`), re-reads under the lock (`:116-118`, the double-check that lets waiters see the value the winner just wrote), then runs the factory and stores its result (`:120-121`). That is the same read-through-with-stampede-protection shape [CachingQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult) applies to cacheable queries, made available to any caller.
  - [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) (`:142-146`), the non-generic holder for the fixed-width [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) that the default `GetOrCreateAsync` uses. It is deliberately a **separate** table from the query decorator's `QueryCacheKeyLocks` (`:137-140`): different call sites over different keys, and sharing stripes would only widen the unrelated-key collisions striping already tolerates.
- **Why it's built this way**: keeping the port in `MMCA.Common.Application` rather than Infrastructure is what lets the CQRS decorators, which also live in Application, depend on caching without dragging a Redis reference into the business layers. The optional `TimeSpan? expiration` lets callers override the global TTL without a second overload. The two defaulted members follow the precedent [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) names explicitly (`077-hybridcache-substrate.md:55-65`): a default interface member is how this package grows a capability that no consumer has to react to. Note the honest boundary the `GetOrCreateAsync` remarks draw (`:80-98`): caching is **unconditional** there, so a failed [Result](group-01-result-error-handling.md#result) would be cached, which is exactly why the caching decorators do NOT route through this member and keep their own read/execute/write sequence.
- **Where it's used**: both caching decorators take `ICacheService` by constructor injection (`CachingQueryDecorator.cs:36`, `CachingCommandDecorator.cs:34`). Outside the pipeline, [LoginProtectionService](group-08-auth.md#loginprotectionservice) calls `IncrementAsync` for failed logins and per-IP registrations (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:75` and `:130`); [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) writes the soft-deleted marker with `SetAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:60`), read back by `SoftDeletedUserMiddleware` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:60`); [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter) stores and replays the cached response record (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:363` and `:439`, default expiration 24 hours at `:82`); and `OAuthControllerBase` takes it as a constructor dependency (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:34`). Exactly one implementation is live per host: `AddCaching()` registers one via `TryAddSingleton` (`DependencyInjection.cs:175`), and `AddCommonHybridCache()` replaces it (`:266-267`). The default `GetOrCreateAsync` body is covered by [CacheServiceGetOrCreateTests](group-27-testing-infrastructure.md#cacheservicegetorcreatetests).
- **Caveats / not-in-source**: `IncrementAsync` is **not atomic** on any shipped implementation. The default body is a read-modify-write, and both distributed adapters override it with the same shape rather than Redis `INCR`, for the storage-format reason spelled out in the [DistributedCacheService](#distributedcacheservice) section. Stampede protection in `GetOrCreateAsync` is likewise **per process** (`:88-91`): with several replicas over one shared cache the factory can still run once per replica, and a cluster-wide guarantee would need a distributed lock, which is deliberately not attempted here.

---

### DistributedCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:18` · Level 4 · class (internal sealed partial)

- **What it is**: the out-of-process implementation of [ICacheService](#icacheservice), backed by ASP.NET Core's `IDistributedCache` (Redis in the deployed services, or a SQL Server distributed cache). Values cross the wire as UTF-8 JSON, every key is namespaced through [CacheKeyNamespace](#cachekeynamespace), and prefix eviction runs Redis SCAN when an `IConnectionMultiplexer` is available.
- **Depends on**: [ICacheService](#icacheservice) (implemented), [CacheKeyNamespace](#cachekeynamespace) (optional constructor parameter), [CacheOptions](#cacheoptions) (every write), [RedisPrefixScanner](#redisprefixscanner) (prefix eviction). Externals: `Microsoft.Extensions.Caching.Distributed.IDistributedCache`, `ILogger<T>`, `System.Text.Json.JsonSerializer` (BCL) and `StackExchange.Redis.IConnectionMultiplexer` (NuGet, optional).
- **Concept introduced, reaching past an abstraction that cannot express what you need** `[Rubric §12, Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`. §7 assesses whether shared state survives a module moving into its own process: a *distributed* cache is shared across replicas and across extracted services, so cached reads stay coherent when a service scales out. The design point worth internalising is that `IDistributedCache` has **no key-enumeration API**; you cannot ask it for every key starting with X. This adapter therefore takes the optional raw `IConnectionMultiplexer` alongside the abstraction and uses server-side SCAN to satisfy `RemoveByPrefixAsync`, accepting a Redis-specific dependency for exactly one operation while every other operation stays store-agnostic. `[Rubric §13, Observability & Operability]`, §13 assesses whether the system makes its own degraded states visible: when the multiplexer is absent the class does not silently swallow the missed invalidation, it warns once, so a dead eviction path shows up in logs instead of as unexplained stale data.
- **Walkthrough**: primary constructor (`DistributedCacheService.cs:18-22`), `IDistributedCache cache` and `ILogger<DistributedCacheService> logger` required, `IConnectionMultiplexer? connectionMultiplexer = null` and `CacheKeyNamespace? keyNamespace = null` optional. The class is `partial` so the `[LoggerMessage]` source generator can emit its log methods.
  - `_keys` (`:28`), the resolved [CacheKeyNamespace](#cachekeynamespace), defaulting to `CacheKeyNamespace.None`.
  - `GetAsync<T>` (`:31-36`), fetches the raw `byte[]` via `cache.GetAsync(_keys.Qualify(key), ...)`; returns `default` on null (a miss), else `Deserialize<T>`.
  - `SetAsync<T>` (`:39-48`), serializes to bytes and writes with `cache.SetAsync(_keys.Qualify(key), bytes, CacheOptions.Create(expiration), ...)` (`:47`). That is the single call site turning the caller's optional `TimeSpan?` into a `DistributedCacheEntryOptions`.
  - `RemoveAsync` (`:51-52`), expression-bodied passthrough on the qualified key.
  - `_noMultiplexerWarned` (`:55`), an `int` flag flipped once via `Interlocked.Exchange` so the missing-multiplexer warning fires exactly once per process rather than on every mutating command.
  - `RemoveByPrefixAsync` (`:82-105`). If `connectionMultiplexer` is null (`:84`) it logs the no-op once, guarded by `Interlocked.Exchange(ref _noMultiplexerWarned, 1) == 0` (`:89-90`), and returns; entries then expire on TTL alone. Otherwise it delegates the whole scan to [RedisPrefixScanner](#redisprefixscanner)`.RemoveMatchingAsync` (`:98-104`), passing the namespaced pattern `$"{_keys.Qualify(prefix)}*"` (`:100`, note the prefix is namespaced too, which is the entire reason the namespace lives here rather than in `RedisCacheOptions.InstanceName`), a raw `KeyDeleteAsync` as the per-key delete over a lazily resolved `IDatabase` (`:96`, `:101`, so a host whose multiplexer reports no scannable server never asks for a database), and its own two log hooks (`:102-103`).
  - `IncrementAsync` (`:127-133`), an **override** of the [ICacheService](#icacheservice) default that keeps the same read-modify-write shape. The remarks (`:108-126`) are the important read. Redis `INCR` would be atomic, which is what the member was added for, but `INCR` writes a Redis **string** while `StackExchangeRedisCache` stores every entry as a Redis **hash** (`absexp` / `sldexp` / `data`, read back with `HMGET`). Mixing the two at one key makes the next read fail with `WRONGTYPE`, which surfaces as a 500 on whatever endpoint owns the counter (registration and login, in the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) case). A counter has to live in the same storage format as the reads that consult it, so readability was chosen over atomicity.
  - `Deserialize<T>` / `Serialize<T>` (`:135-139`), private static JSON helpers: `SerializeToUtf8Bytes(value)` and `Deserialize<T>(bytes)!` (null-forgiving, since the BCL signature is nominally nullable).
  - `LogPrefixEvictionNoMultiplexer` / `LogPrefixEvictionNoServer` / `LogPrefixEvictionServerFailed` (`:141-148`), `[LoggerMessage]` `Warning`-level partial methods. The first names the fix explicitly ("Register a Redis client (AddRedisClient) to enable prefix eviction"), and the third states the blast radius ("the remaining servers are still processed, so entries on this one are bounded only by their TTL"), which is the difference between a log line and an actionable one.
- **Why it's built this way**: UTF-8 JSON keeps cached payloads engine-agnostic and inspectable from any Redis client. The optional multiplexer is the pragmatic compromise the [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) / [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) extraction path demands: the cache contract must work whether the deployment has Redis (full prefix eviction) or only a fallback distributed store (single-key operations), so prefix eviction *degrades to a no-op* rather than throwing, and the 30-second TTL from [CacheOptions](#cacheoptions) becomes the staleness backstop. Warn-once keeps that degradation from being invisible without flooding the log. Lifting the scan into [RedisPrefixScanner](#redisprefixscanner) came with the two-level cache: two adapters that evict differently should still share one eviction algorithm. `internal sealed partial`: `partial` for the generated log methods, `internal sealed` because it is only ever resolved through the [ICacheService](#icacheservice) registration.
- **Where it's used**: selected by `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:175-189`). The `TryAddSingleton<ICacheService>` factory builds this implementation **only when** an `IDistributedCache` is present and is not the default `MemoryDistributedCache` (`:178`), resolving the optional `IConnectionMultiplexer` (`:180`), an `ILogger` with a `NullLogger` fallback (`:181-182`) and the [CacheKeyNamespace](#cachekeynamespace) (`:183`); otherwise it falls back to [MemoryCacheService](#memorycacheservice). Downstream it is consumed only through the interface. Covered by [DistributedCacheServiceTests](group-27-testing-infrastructure.md#distributedcacheservicetests) and, against a real Redis, [DistributedCacheServiceRedisTests](group-27-testing-infrastructure.md#distributedcacheserviceredistests).
- **Caveats / not-in-source**: all seven deployed services now call `AddCommonHybridCache()` after their Redis registration (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:164`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:107`), so this adapter is no longer the one the container hands out in those hosts: it is the default for any host that registers a real distributed cache and does *not* opt in, and it remains the writer of the legacy keyspace that [HybridCacheService](#hybridcacheservice) still evicts. `IncrementAsync` here is not atomic (see the walkthrough); [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the possible undercount as accepted rather than outstanding.

---

### HybridCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:37` · Level 4 · class (internal sealed partial)

- **What it is**: the two-level implementation of [ICacheService](#icacheservice), backed by `Microsoft.Extensions.Caching.Hybrid.HybridCache`: an in-process L1 in front of the host's registered `IDistributedCache` L2, with serialization, L1 promotion and stampede protection supplied by the platform. It is opt-in per host through `AddCommonHybridCache` (`HybridCacheService.cs:12-15`).
- **Depends on**: [ICacheService](#icacheservice) (implemented), [CacheKeyNamespace](#cachekeynamespace) (optional constructor parameter), [CacheOptions](#cacheoptions) (`DefaultDuration` as the fallback TTL), [RedisPrefixScanner](#redisprefixscanner) (both eviction passes). Externals: `HybridCache` / `HybridCacheEntryOptions` / `HybridCacheEntryFlags` (NuGet), `ILogger<T>` and `StackExchange.Redis.IConnectionMultiplexer` (optional).
- **Concept introduced, two serialization formats must never share one keyspace** `[Rubric §8, Data Architecture]` and `[Rubric §16, Maintainability]`. §8 assesses whether stored data has one owner and one shape; §16 assesses whether a change can be rolled out without a coordinated flag day. Every key this service writes carries a `hc:` segment inside the configured prefix, `{prefix}hc:{key}` (`:19`, `:47`, `:286`), which is the structural form of the `WRONGTYPE` lesson recorded on [DistributedCacheService](#distributedcacheservice)`.IncrementAsync`. `HybridCache` writes its own payload layout, not the UTF-8 JSON the older adapter writes, so letting the two meet at one key would reproduce that production failure at *every* key rather than at one counter. With the keyspaces disjoint, an old-format entry is simply invisible to this service (a clean miss) and a new-format entry is invisible to the old one, **including while a rolling deploy runs both** (`:18-29`). [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) records the rejected alternative, a payload discriminator in one keyspace, and why "impossible" beat "unlikely" (`077-hybridcache-substrate.md:36-53`). `[Rubric §12, Performance & Scalability]`, the whole point of L1 is removing a network hop and a JSON deserialize from every read of a small hot value.
- **Walkthrough**: primary constructor (`:37-41`), same shape as the distributed adapter but over `HybridCache hybrid`.
  - `KeyspaceSegment` (`:47`), `internal const string` = `"hc:"`, applied *inside* the configured namespace.
  - `LocalCacheDefault` (`:54`), `internal static readonly TimeSpan` = 30 seconds. It is both the default L1 lifetime and the **ceiling** applied to every entry, and `AddCommonHybridCache` seeds `HybridCacheOptions` from the same field (`DependencyInjection.cs:258`).
  - `ReadOnlyOptions` (`:62-65`) and `CounterReadOptions` (`:71-76`), two static option objects. The first sets `HybridCacheEntryFlags.DisableUnderlyingData`, which tells `HybridCache` not to invoke the factory and not to write anything, so a miss stays a miss while an L2 hit is still promoted into L1. The second adds `DisableLocalCacheRead | DisableLocalCacheWrite` for the counter path.
  - `_keys` (`:82`) and `_noMultiplexerWarned` (`:85`), identical in role to their counterparts on [DistributedCacheService](#distributedcacheservice).
  - `GetAsync<T>` (`:96-115`), calls `hybrid.GetOrCreateAsync` with a `static` no-op factory and `ReadOnlyOptions` (`:102-107`), which is how you perform a plain read through an API whose primary shape is get-or-create. It is **fail-soft** (`:88-95`): any exception that is not `OperationCanceledException` is logged at warning and answered as a miss (`:109-114`), and the offending entry is dropped best-effort through `SelfHealAsync` so the next write repopulates it instead of the process failing the same read forever.
  - `SetAsync<T>` (`:125-130`), one call to `hybrid.SetAsync` with the options `WriteOptions(expiration)` builds.
  - `RemoveAsync` (`:134-135`), `hybrid.RemoveAsync`, which clears this process's L1 copy along with the L2 entry.
  - `RemoveByPrefixAsync` (`:158-206`), the substantial method, and the one place the keyspace split costs something. After the same warn-once no-multiplexer guard (`:160-168`), it runs [RedisPrefixScanner](#redisprefixscanner) **twice** over two disjoint patterns: this service's `$"{HybridKey(prefix)}*"` (`:189-195`), whose per-key delete routes back through `hybrid.RemoveAsync` so L1 dies with L2 (`:192`), and the legacy `$"{_keys.Qualify(prefix)}*"` that [DistributedCacheService](#distributedcacheservice) wrote (`:199-205`), deleted raw because nothing holds those in an L1 (`:202`). A local `noServersLogged` closure collapses the two passes' "no servers" reports into one log line (`:175-183`), since both share one multiplexer. The dual pass is not cosmetic: a host switching on this feature inherits live entries under the old shape, and the 24-hour idempotency records outlive any deploy window (`:139-147`).
  - `IncrementAsync` (`:232-253`), a read-modify-write like the distributed adapter's, and deliberately **not** routed through this class's own `GetAsync` / `SetAsync` because both legs must bypass L1 (`:236-241`, `:245-250`). The reason (`:218-226`) is the sharpest argument in this group: a counter is the one value whose correctness depends on every replica seeing the same number, so an L1 copy would let a process read its own stale count and write it back, and a brute-force counter could then be held near its starting value indefinitely by a steady stream of attempts against one replica. That is a security control silently weakened by a cache optimization. Faults are also **not** swallowed here, unlike `GetAsync` (`:227-230`): a counter that silently reads as zero would reset the limit it exists to enforce.
  - `GetOrCreateAsync<T>` (`:264-281`), an override of the interface default that hands the work to `HybridCache`'s own primitive, which folds the double-check and the stampede protection into one call and additionally deduplicates concurrent callers before they reach L2. The factory is passed as **state** rather than captured (`:272-277`), so the delegate stays `static` and no closure is allocated per call.
  - `HybridKey` (`:286`), `WriteOptions` (`:295-305`) and `SelfHealAsync` (`:315-325`), the private helpers. `WriteOptions` is where the L1 ceiling is applied: `LocalCacheExpiration = ttl < LocalCacheDefault ? ttl : LocalCacheDefault` (`:302`), so a long-lived entry does not sit in another replica's memory for its whole TTL after an invalidation that process never saw.
- **Why it's built this way**: [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) is the record. Opt-in rather than default keeps the release non-breaking: a host that never calls `AddCommonHybridCache` gets a byte-identical registration to before, and a memory-only host would gain nothing from an L1 in front of an L1 anyway (`DependencyInjection.cs:222-227`). The registration deliberately uses `RemoveAll` + `Add` rather than `TryAdd` so it wins in either call order (`:264-267`), with the honest warning that `RemoveAll` does not distinguish the framework's registration from a host's own custom [ICacheService](#icacheservice) (`:236-241`). `[Rubric §29, Resilience]` shows up in the fail-soft read: the cache is an optimization, never the system of record, so an unreadable entry costs a database round trip rather than a failed request.
- **Where it's used**: registered only by `AddCommonHybridCache` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:248-282`), which all seven deployed service hosts call inside their Redis-conditional block (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:164`, `MMCA.ADC.Engagement.Service/Program.cs:124`, `MMCA.ADC.Identity.Service/Program.cs:144`, `MMCA.ADC.Notification.Service/Program.cs:127`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:107`, `MMCA.Store.Sales.Service/Program.cs:124`, `MMCA.Store.Identity.Service/Program.cs:113`). Everything downstream still talks to [ICacheService](#icacheservice) and is unaware. Covered by [HybridCacheServiceTests](group-27-testing-infrastructure.md#hybridcacheservicetests), the registration semantics by [AddCommonHybridCacheTests](group-27-testing-infrastructure.md#addcommonhybridcachetests), and the storage format against a real Redis by [HybridCacheServiceRedisTests](group-27-testing-infrastructure.md#hybridcacheserviceredistests).
- **Caveats / not-in-source**: replica L1 staleness after an invalidation is bounded by `LocalCacheDefault` (30 seconds), not by the eviction, because only the evicting process's L1 is cleared (`:30-35`). That is the accepted cost of the L1 hit rate, and it is the same order as the 5-second delayed re-invalidation [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) already performs (`CachingCommandDecorator.cs:60`, `:96`). The legacy eviction pass is a migration affordance with no expiry date encoded anywhere in source: nothing removes it automatically once the old-format entries have aged out.

---

### MemoryCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:18` · Level 4 · class (internal sealed)

- **What it is**: the in-process implementation of [ICacheService](#icacheservice), backed by `IMemoryCache`. Because `IMemoryCache` exposes no way to enumerate its keys, this service maintains its own `ConcurrentDictionary<string, object>` tracking table so it can honor `RemoveByPrefixAsync`, the one capability the BCL memory cache lacks. The cache and that table are two structures that have to agree, so every mutation of a key runs under that key's lock stripe (`MemoryCacheService.cs:8-17`).
- **Depends on**: `IMemoryCache` / `MemoryCacheEntryOptions` and `ConcurrentDictionary<TKey, TValue>` (both BCL), plus [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from `MMCA.Common.Shared.Concurrency` (`:4`, `:38`) for the per-key mutual exclusion. Implements [ICacheService](#icacheservice) and overrides **neither** default member, so it inherits the non-atomic `IncrementAsync` and the stripe-plus-double-check `GetOrCreateAsync`.
- **Concept introduced, a shadow index to back-fill a missing API** `[Rubric §12, Performance & Scalability]`. §12 assesses cheap reads and sound invalidation; an in-process cache is the lowest-latency option available but is *not shared* across instances, so it is correct for a single-process monolith or for genuinely per-instance data and wrong for anything else. The teachable mechanic is the shadow index: `IMemoryCache` is a black box with no key listing, so the service mirrors every live key into `_keys` and keeps that mirror honest with a **post-eviction callback**, so an entry that expires or is dropped under memory pressure prunes its own tracking record instead of leaking. `[Rubric §10, Cross-Cutting Concerns]`, it presents the identical [ICacheService](#icacheservice) surface as the distributed adapters, so swapping backends changes nothing for callers. **Second concept, an invariant that write ordering cannot buy you** `[Rubric §15, Best Practices & Code Quality]`. §15 assesses everyday craftsmanship, including whether comments explain *why* rather than *what*. The `SetAsync` remarks (`:55-63`) are the worked example: with two structures to update, track-then-write lets a concurrent removal drop the tracking record between the two steps, and write-then-track lets a removal run entirely between them; both leave a live entry nothing can find. Neither order closes the window, so the class buys the invariant with mutual exclusion instead, and says so in the code rather than leaving the next reader to rediscover it.
- **Walkthrough**: primary constructor injection (`:18`), `IMemoryCache cache`.
  - `_keys` (`:31`), `new ConcurrentDictionary<string, object>(StringComparer.Ordinal)`. The value is **load-bearing**: it is the tracking token of the cache entry the record belongs to, a plain `object` compared by reference (`:20-30`). It exists so a post-eviction callback, which necessarily runs after its own entry may already have been superseded, can remove only its OWN record and never the record of a newer live entry. `Ordinal` comparison matches the ordinal prefix test below.
  - `_keyLocks` (`:38`), a [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) serializing the paired mutation of the cache and `_keys` for one key. It is **per instance rather than static** (`:33-37`): the tracking table belongs to this service instance, so two instances have nothing to serialize against each other.
  - `GetAsync<T>` (`:41-52`), calls `cache.TryGetValue(key, out var stored)` and then **type-checks the stored object** with `stored is T typed` (`:46`) before returning it, wrapped in `Task.FromResult` (there is no real async work; `IMemoryCache` is synchronous). It takes no lock: it touches only the cache. The pattern match is deliberate (`:43-45`): the generic `TryGetValue<T>` overload performs an unchecked `(T)stored` cast and throws `InvalidCastException` when a key is reused under a different `T`, so matching on the stored object turns a type mismatch (or a stored null) into a clean miss.
  - `SetAsync<T>` (`:64-106`), the method that establishes the invariant the class rests on. It builds `MemoryCacheEntryOptions` (`:70`) and sets `AbsoluteExpirationRelativeToNow` **only when** `expiration.HasValue` (`:72-75`), so there is no 30-second floor on this path: an unset TTL means no time-based expiry, unlike the distributed paths. It mints this entry's identity, `var token = new object()` (`:78`), and registers the post-eviction callback (`:93-99`) with that token as the callback **state**. The callback body **skips `EvictionReason.Replaced`** (`:97`) and removes through the `KeyValuePair` overload, `_keys.TryRemove(new KeyValuePair<string, object>(evictedKey.ToString()!, state!))`, which deletes the record only while the tracked value is still this entry's own token. The comment (`:80-92`) explains the shape: the callback stays deliberately **lock-free** because `IMemoryCache` queues it to the thread pool, and waiting on a stripe from a pool thread would stall the pool behind whichever caller holds it; running lock-free means it can land when the key already carries a newer live entry, so the token check is what stops it untracking an entry that is still cached (live but invisible to `RemoveByPrefixAsync`, clearable only by its TTL). Only then does the write happen, under the key's stripe: `using (await _keyLocks.AcquireAsync(key, cancellationToken)...)` (`:101`), `cache.Set(key, value, options)` (`:103`), `_keys[key] = token` (`:104`).
  - `RemoveAsync` (`:110-117`), the same stripe and the same order (`:109`): acquire (`:112`), `cache.Remove` (`:114`), then `_keys.TryRemove(key, out _)` (`:115`).
  - `RemoveByPrefixAsync` (`:128-138`), iterates `_keys.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))` (`:130`) and removes each key from both stores under its own stripe (`:132-136`). Two details from the remarks (`:120-127`): the candidate list is a **snapshot**, because `ConcurrentDictionary.Keys` already copies, so it is enumerated outside every lock; and each stripe is released before the next one is taken, never accumulated across the loop, because distinct keys can map to the same stripe and to different stripes in a different relative order, so holding several at once would let two prefix removals block on each other and deadlock. This is what lets the in-process backend satisfy the same prefix-eviction contract Redis gets from SCAN.
- **Why it's built this way**: a parallel key index is the only way to give `IMemoryCache` a prefix-removal capability without replacing it, and the two guards on the callback (skip `Replaced`, and match the token) are what keep that index from drifting in either direction: a naive key set would accumulate phantom keys as entries expired, while a naive callback would delete records for entries that are still live. The stripe then covers what neither guard can, the window between the two writes that any single-threaded reading of the code hides. Striping rather than a semaphore per key is a bounded-memory choice made once in [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) and reused here. The class is `internal sealed` because it is only ever resolved through the [ICacheService](#icacheservice) registration.
- **Where it's used**: the fallback branch of `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:188`). `AddCaching()` always calls `AddMemoryCache()` first (`:166`), so when no real distributed cache is registered this is the [ICacheService](#icacheservice) the container hands out, and a host with no Redis behaves as a single-instance cached monolith with the full interface intact. Consumed through the interface by both CQRS caching decorators, [LoginProtectionService](group-08-auth.md#loginprotectionservice), [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) and [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter). Unit-tested by [MemoryCacheServiceTests](group-27-testing-infrastructure.md#memorycacheservicetests), which pins the concurrency behavior deterministically rather than racing for it: the test takes the key's own stripe first, then asserts that a `SetAsync` and a `RemoveByPrefixAsync` both park on it (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:180`) and that `RemoveAsync` waits on the same stripe as `SetAsync` (`:213`).
- **Caveats / not-in-source**: the cache is per-process, so two replicas hold independent and potentially divergent copies until each entry's TTL or an explicit eviction reconciles them. That is why the distributed adapters exist for scaled-out deployments, and why [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) lists per-replica memory mode as a trade-off rather than a supported multi-replica posture (`026-caching-strategy.md:113-115`). `_keys` is unbounded in the sense that only eviction prunes it, so a cache key embedding a high-cardinality value grows the table alongside the cache itself. Two limits of the locking are worth knowing: the stripe is per service instance, so the invariant holds for the singleton the container registers and not across two hand-constructed instances sharing one `IMemoryCache`; and `RemoveByPrefixAsync` works from a snapshot, so a key written after the snapshot is taken is simply not a candidate for that call. Finally, the per-key stripe and the tracking token are documented only in the source comments cited above, not in a decision record.


---
[⬅ Authentication & Authorization](group-08-auth.md)  •  [Index](00-index.md)  •  [Notifications (Push + In-App Inbox + Email) ➡](group-10-notifications.md)
