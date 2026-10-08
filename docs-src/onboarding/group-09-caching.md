# 9. Caching

**What this group covers.** Caching in this codebase is small, deliberate, and woven into the CQRS
pipeline rather than scattered across handlers. The group is nine types: one port the Application
layer depends on ([`ICacheService`](#icacheservice)), three Infrastructure adapters that implement it
([`MemoryCacheService`](#memorycacheservice), [`DistributedCacheService`](#distributedcacheservice),
and the opt-in two-level [`HybridCacheService`](#hybridcacheservice)), the shared Redis prefix-eviction
helper the last two both run ([`RedisPrefixScanner`](#redisprefixscanner)), a static TTL-policy factory
([`CacheOptions`](#cacheoptions)) with the bound settings object that reproduces its defaults from
configuration ([`CacheSettings`](#cachesettings)), and the key-namespace pair
([`CacheKeyPrefixOptions`](#cachekeyprefixoptions) plus its internal applier
[`CacheKeyNamespace`](#cachekeynamespace)) that keeps two applications sharing one Redis instance out
of each other's keyspace by default, without anyone configuring it. No handler ever talks to Redis or
`IMemoryCache` directly: the read-through and
invalidate-on-write behavior lives in two pipeline decorators taught in
[Group 5, CQRS Pipeline](group-05-cqrs-pipeline.md). This chapter is the cache's own machinery, the
contract, the three backends, the scanner, the TTL policy and its configuration object, and the
namespace, plus how they plug into that pipeline.

**The contract.** [`ICacheService`](#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10`) is a textbook Clean
Architecture port/adapter split (see [primer §1](00-primer.md#1-the-big-picture)): the interface lives
in `MMCA.Common.Application`, all three implementations live in `MMCA.Common.Infrastructure`, and
application code compiles against the interface alone. It declares eight members. Four are abstract:
`GetAsync<T>` returning `T?` with `null` for a miss (`ICacheService.cs:17`), `SetAsync<T>` with an
optional `TimeSpan?` TTL (`ICacheService.cs:75`), `RemoveAsync` for one key (`ICacheService.cs:85`),
and `RemoveByPrefixAsync` for bulk eviction by key prefix (`ICacheService.cs:91`). Four are **default
interface members** with working bodies, so each one shipped without breaking an implementer.
`TryGetAsync<T>` (`ICacheService.cs:34`) reports presence separately from the value, because for a
value-type `T` a `GetAsync` miss answers `default(T)` and cannot be told apart from a cached `0` or
`false` (`ICacheService.cs:19-23`); the default infers presence from a non-null value
(`ICacheService.cs:36-37`), and the shipped stores that can do better override it.
`GetFromSharedStoreAsync<T>` (`ICacheService.cs:65`) reads past any process-local copy, for
values whose change on one replica must be visible on every other one at once: single-use records (an
OAuth exchange code, a password-reset or email-confirmation token, a second-factor time step) and the
counters `IncrementAsync` maintains, since a store with a local tier increments in the shared store
and a local copy would pin the first count it saw (`ICacheService.cs:40-57`). Everything read many
times stays on `GetAsync` and loses only the local hit rate by coming here (`ICacheService.cs:56-57`);
the default simply calls `GetAsync`, which is exact for a store with no local tier
(`ICacheService.cs:60-62`). `IncrementAsync` (`ICacheService.cs:112`) is a read-modify-write counter
(`ICacheService.cs:114-117`) that gives the
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
brute-force and rate-limit counters one entry point instead of scattered get-then-set pairs; its doc
states plainly that it is not atomic in any shipped implementation (the default,
`DistributedCacheService` and `HybridCacheService` all read then write, so concurrent increments can
undercount) and that none overrides it with Redis `INCR` (`ICacheService.cs:93-111`), and
`GetOrCreateAsync<T>` (`ICacheService.cs:152`) folds read, per-key stripe, double-check, factory and
write into one call (`ICacheService.cs:157-178`), taking presence from `TryGetAsync` on both checks so
a cached `default(T)` counts as a hit (`ICacheService.cs:160-172`), using the process-wide
`CacheKeyLocks` table (`ICacheService.cs:196-200`), cross-referenced in
[Group 5](group-05-cqrs-pipeline.md#cachekeylocks). Its XML doc is explicit about two limits that
matter: it caches whatever the factory returned, failed [`Result`](group-01-result-error-handling.md#result)
included, which is exactly why the caching decorators do not route through it, and its stampede
protection is per process (`ICacheService.cs:133-150`). `RemoveByPrefixAsync` is the load-bearing member:
it is what lets a single write evict every cached read it could have staled, and it is why the backends
had to be built rather than used off the shelf (`IMemoryCache` has no key enumeration, `IDistributedCache`
has no prefix delete). [Rubric §3, Clean Architecture] assesses whether dependencies point inward and
infrastructure stays replaceable; this is that rule in one file, since the only thing Application knows
about caching is eight method signatures.

**Backend selection happens once, at the composition root.** `AddCaching(IConfiguration?)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:26`, called from
`AddInfrastructure` at `DependencyInjection.cs:134`) always calls `AddMemoryCache()`
(`DependencyInjection.Caching.cs:28`), then binds the shared `Cache` configuration section three ways when
configuration was supplied (`DependencyInjection.Caching.cs:39-52`): to
[`CacheKeyPrefixOptions`](#cachekeyprefixoptions) for the key namespace
(`DependencyInjection.Caching.cs:41`), to [`CacheSettings`](#cachesettings)
for the TTL policy (`DependencyInjection.Caching.cs:43-46`), and to
[`QueryCachePipelineSettings`](group-14-module-system-composition.md#querycachepipelinesettings) for
the one knob the Application-layer query decorator needs (`DependencyInjection.Caching.cs:48-51`, defined in
that layer because it cannot reference Infrastructure). Without configuration both settings objects are
still registered at their defaults (`DependencyInjection.Caching.cs:53-57`), so `IOptions<T>` always resolves.
[`ICacheService`](#icacheservice) itself is registered through `TryAddSingleton` with a factory that
probes the container (`DependencyInjection.Caching.cs:59-80`). If an `IDistributedCache` is registered **and
it is not the default `MemoryDistributedCache`** (`DependencyInjection.Caching.cs:62`), meaning a real
out-of-process store such as the Redis cache Aspire wires, the factory builds a
[`DistributedCacheService`](#distributedcacheservice) with whatever `IConnectionMultiplexer` and
`ILogger` it can resolve plus the bound key namespace and cache settings
(`DependencyInjection.Caching.cs:64-73`); otherwise it falls back to a
[`MemoryCacheService`](#memorycacheservice) over the registered `IMemoryCache`, handed the same bound
cache settings (`DependencyInjection.Caching.cs:77-79`). The same method registers the
[`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that both in-framework callers pair
with the cache, the API idempotency filter and password-reset token redemption
(`DependencyInjection.Caching.cs:82-85`), [Redis-backed](group-14-module-system-composition.md#redisdistributedlock) when a
multiplexer is present and [process-local](group-14-module-system-composition.md#inprocessdistributedlock)
otherwise (`DependencyInjection.Caching.cs:88-102`). A single-process monolith therefore caches in-process for
free, and the identical application code uses Redis the moment a distributed cache is present: no flag,
no per-environment branch in a handler. This is the same "abstraction in Application, transport chosen
at the edge" pattern the message bus and gRPC clients use, which is what [Rubric §7, Microservices
Readiness] looks for (can a module move to its own process without a code change) and part of what
[Rubric §12, Performance and Scalability] rewards (the scaled-out deployment gets a shared cache
without touching business code).

**A third substrate, opt in and explicit.** `AddCommonHybridCache(Action<HybridCacheOptions>?)`
(`DependencyInjection.Caching.cs:141`) calls `AddHybridCache()` (`DependencyInjection.Caching.cs:143`) and then
configures `HybridCacheOptions` through the options pipeline rather than through the
`AddHybridCache` callback (`DependencyInjection.Caching.cs:149-163`), because the TTL policy now comes from
the bound [`CacheSettings`](#cachesettings) and the callback has no service provider to read it
from; the framework sets `Expiration` from `DefaultDuration` and
`LocalCacheExpiration` from `LocalCacheDuration` (falling back to
`HybridCacheService.LocalCacheDefault`) at `DependencyInjection.Caching.cs:156-160`, and the host's own hook
runs last so it can override anything (`DependencyInjection.Caching.cs:162`). The swap of the cache
implementation is deliberately `RemoveAll<ICacheService>()` followed by `AddSingleton`
(`DependencyInjection.Caching.cs:167-181`) rather than `TryAdd`, so the call wins whether it runs before or
after `AddInfrastructure`; the source is equally explicit that this also removes a host's own bespoke
`ICacheService`, so calling it is a statement that the two-level cache is the cache
(`DependencyInjection.Caching.cs:130-133`). `AddCommonHybridCache` has no guard of its own, so the
framework also ships the guarded form, `AddCommonHybridCacheWhenRedisConfigured(IConfiguration, string)`
(`DependencyInjection.Caching.cs:202`), which calls it only when the `redis` connection string (the
default `connectionName`) is non-empty (`DependencyInjection.Caching.cs:208-211`) and otherwise leaves
the registration untouched. All seven deployed service hosts call that guarded form unconditionally,
right after `AddRedisCaching()`: ADC Conference at
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:204` and Store Catalog at
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:108`, with ADC Engagement, Identity
and Notification and Store Sales and Identity alongside them. Without Redis the guard declines and
the host keeps the auto-selected substrate, which is the point: an L1 in front of an in-process L2 buys
nothing (`DependencyInjection.Caching.cs:191-193`,
[ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)).

**The in-process adapter.** [`MemoryCacheService`](#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:19`) wraps
`IMemoryCache`, takes the bound [`CacheSettings`](#cachesettings) (framework defaults when none is
passed, `MemoryCacheService.cs:25`) so an entry written without an expiration gets the same
`DefaultDuration` every other store applies (`MemoryCacheService.cs:84`), and carries one side structure: a `ConcurrentDictionary<string, object>` of live keys
(`MemoryCacheService.cs:38`), because `IMemoryCache` cannot enumerate its own keys and without that
shadow index `RemoveByPrefixAsync` (`MemoryCacheService.cs:138-148`) would be impossible. Keeping the
cache and the index in agreement is the whole design. Every mutation takes that key's stripe from a
per-instance [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MemoryCacheService.cs:45`) and touches the cache before the table
(`MemoryCacheService.cs:111-115`), because ordering alone cannot close the window: track-then-write
lets a concurrent removal drop the record between the steps, and write-then-track lets a removal run
entirely between them, both leaving a live entry nothing can find. The post-eviction callback is
deliberately lock-free, since `IMemoryCache` queues it to the thread pool, and it removes the record
only while the record is still its own, comparing the entry token by reference and skipping
`EvictionReason.Replaced` outright (`MemoryCacheService.cs:103-109`). `GetAsync` also matches on the
stored object rather than using the generic `TryGetValue<T>` overload (`MemoryCacheService.cs:53`), so
a key reused under a different `T` surfaces as a clean miss instead of an `InvalidCastException`, and
it overrides `TryGetAsync` with the same type-matched lookup so presence is real rather than inferred
from a non-null value (`MemoryCacheService.cs:62-64`).

**The out-of-process adapter.** [`DistributedCacheService`](#distributedcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:19`)
serializes values to UTF-8 JSON via `System.Text.Json` (`DistributedCacheService.cs:161-165`) and
stores them through `IDistributedCache`, applying the bound TTL default when the caller supplies none
(`DistributedCacheService.cs:37`, `DistributedCacheService.cs:72`). It overrides `TryGetAsync` with a
real presence check on the stored bytes (`DistributedCacheService.cs:48-53`) and keeps the default
`GetFromSharedStoreAsync`, which is already exact here because the store has no process-local tier.
Prefix eviction is where it earns
its keep: when an `IConnectionMultiplexer` is available it hands the namespace-qualified pattern and a
raw `KeyDeleteAsync` to [`RedisPrefixScanner`](#redisprefixscanner)
(`DistributedCacheService.cs:124-130`), resolving the `IDatabase` lazily on the first delete
(`DistributedCacheService.cs:122`, `DistributedCacheService.cs:127`). When no multiplexer is
registered, prefix eviction cannot run at all, and rather than failing silently the class logs a
warning **once**, guarded by an `Interlocked.Exchange` flag (`DistributedCacheService.cs:81`,
`DistributedCacheService.cs:115-116`) and naming the fix (`AddRedisClient`), because a permanently dead
invalidation is a steady state that must not flood the log on every command; the anomalous "multiplexer
with no servers" case and a per-server failure each get their own message
(`DistributedCacheService.cs:128-129`). All three are compile-time `LoggerMessage` sources
(`DistributedCacheService.cs:167-174`). That warn-once-versus-warn-always split is a small but real
[Rubric §13, Observability and Operability] decision: §13 assesses whether an operator can tell what
the system is doing, and a cache whose invalidation quietly does nothing is exactly the failure mode
that hides from dashboards. The class also **overrides** `IncrementAsync`
(`DistributedCacheService.cs:153-159`) while keeping the same non-atomic read-modify-write shape, and
the comment above it (`DistributedCacheService.cs:134-152`) is worth reading: Redis `INCR` would be
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
(`RedisPrefixScanner.cs:105-118`): under Redis cluster policy a multi-key `DEL` must not span hash
slots and StackExchange.Redis answers a cross-slot command by throwing, so batching the keys of a
prefix would fault the invalidation rather than speed it up. Round trips still stay bounded by keeping
`DeleteBatchSize` = 512 deletes in flight and awaiting them as a group (`RedisPrefixScanner.cs:27`).
The delete itself is a caller-supplied callback and the log messages stay with the caller
(`RedisPrefixScanner.cs:10-23`), which is precisely what lets the two services share the scan while
removing keys differently.

**The two-level cache.** [`HybridCacheService`](#hybridcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:48`) puts an
in-process L1 in front of the registered distributed L2 and lets the platform's `HybridCache` supply
serialization, L1 promotion and stampede protection. Its structural decision is the **disjoint
keyspace**: every key is written as `{prefix}hc:{key}` (`HybridCacheService.cs:59`,
`HybridCacheService.cs:318`), so the payload layout `HybridCache` writes can never meet the UTF-8 JSON
[`DistributedCacheService`](#distributedcacheservice) writes at one key. That is the `WRONGTYPE`
lesson from `IncrementAsync` generalized: an entry in the other format is simply a clean miss, including
while a rolling deploy runs both builds (`HybridCacheService.cs:18-28`). `RemoveByPrefixAsync`
consequently runs the scanner over that one keyspace, `{namespace}hc:{prefix}*`, and deletes each match
through `HybridCache.RemoveAsync` rather than by raw key, so this process's L1 copy goes with the L2
entry (`HybridCacheService.cs:231-237`); a missing multiplexer warns once exactly as it does on the
single-level adapter (`HybridCacheService.cs:221-229`). Reads are fail-soft: a fault is logged,
answered as a miss, and the offending entry is dropped best-effort so the next write repopulates it
(`HybridCacheService.cs:118-137`, `HybridCacheService.cs:348-358`). Two members bypass L1 entirely,
and both share one options instance that disables the L1 read and the L1 write
(`SharedStoreReadOptions`, `HybridCacheService.cs:86-91`), because both are values whose correctness
depends on every replica seeing the same thing; the reasoning is a [Rubric §11, Security] point rather
than a performance one. `GetFromSharedStoreAsync` overrides the interface default so a single-use
record (an OAuth exchange code, a password-reset or email-confirmation token, the last accepted
second-factor time step) consumed on one replica is a miss on every other replica at once rather than
usable a second time for up to the local expiration (`HybridCacheService.cs:35-40`,
`HybridCacheService.cs:154-173`); it stays fail-soft like `GetAsync`, and for such a record a miss is a
refusal, the safe direction. The same path serves a counter read without an increment and the reads
whose correctness depends on seeing a removal at once, the login lockout flag and the
soft-deleted-user marker (`HybridCacheService.cs:40-45`). Its single-use callers are
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:273`),
[`PasswordResetTokenService`](group-08-auth.md#passwordresettokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:128`),
[`EmailConfirmationTokenService`](group-08-auth.md#emailconfirmationtokenservice)
(`.../Auth/EmailConfirmationTokenService.cs:90`) and
[`TwoFactorAuthenticator`](group-08-auth.md#twofactorauthenticator)
(`.../Auth/TwoFactor/TwoFactorAuthenticator.cs:105`); the others are
[`LoginProtectionService`](group-08-auth.md#loginprotectionservice) for the lockout flag and the
registration count (`.../Auth/LoginProtectionService.cs:59`, `LoginProtectionService.cs:141`) and
[`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:92`).
`IncrementAsync` bypasses L1 on **both** legs
(`HybridCacheService.cs:264-285`): a counter cached per replica would let one process read its own
stale count and write it back, so a brute-force limiter could be held near its starting value
indefinitely by a steady stream of attempts against a single replica. Its faults are deliberately not
swallowed, unlike the reads, since a counter that silently reads zero resets the limit it exists to
enforce (`HybridCacheService.cs:259-262`). The class does not override `TryGetAsync`, so presence there
is the interface default inferred from a non-null value. `GetOrCreateAsync` overrides
the interface default with `HybridCache`'s own implementation (`HybridCacheService.cs:296-313`).
Replica L1 staleness after an invalidation is bounded by the local expiration, the shorter of the
entry's TTL and `Cache:LocalCacheDuration` (30 seconds by default,
`HybridCacheService.cs:66`, `HybridCacheService.cs:327-338`), not by the eviction, and the source names
that as the accepted cost of the L1 hit rate.

**The key namespace and the TTL policy.** [`CacheKeyPrefixOptions`](#cachekeyprefixoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:31`) binds the `Cache`
configuration section (`CacheKeyPrefix.cs:34`) and carries one setting, `KeyPrefix`, still defaulting
to empty (`CacheKeyPrefix.cs:46`) but where empty no longer means "no prefix": it means take the
framework's per-application default, and a host sets the value explicitly only to pin a keyspace two
hosts of the same application must share (`CacheKeyPrefix.cs:36-45`). The reason the default changed
is recorded on the property itself: it used to be no prefix at all, so two applications sharing one
Redis shared one keyspace for both cache entries and distributed locks, silently
(`CacheKeyPrefix.cs:42-45`). [`CacheKeyNamespace`](#cachekeynamespace) (`CacheKeyPrefix.cs:50`) is the
internal applier. It keeps a `None` instance for the untouched case (`CacheKeyPrefix.cs:53`) and an
options-taking `From` overload that tolerates an unregistered section (`CacheKeyPrefix.cs:59-63`), but
the composition root calls the container-taking overload (`CacheKeyPrefix.cs:73-88`), which returns the
configured prefix when a host set one (`CacheKeyPrefix.cs:77-81`) and otherwise builds
`{application namespace}:` from
[`ApplicationNamespace.Resolve`](group-14-module-system-composition.md#applicationnamespace)
(`CacheKeyPrefix.cs:83-87`). That resolver reads `Application:Namespace`, falls back to the host's
application name, and falls back again to the literal `app`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:53-67`,
keys at `ApplicationNamespace.cs:31` and `ApplicationNamespace.cs:34`), so the resolved prefix is never
empty and isolation is automatic rather than opt-in (`ApplicationNamespace.cs:45-48`). `Qualify`
(`CacheKeyPrefix.cs:91-92`) prepends it. The same namespace instance is handed to the Redis distributed
lock registered beside the cache (`DependencyInjection.Caching.cs:95-96`), so one application's cache entries
and its lock keys carry one prefix. Both Redis-capable adapters honor it and apply it
*inside* the adapter rather than through `RedisCacheOptions.InstanceName`; the rationale in the source
(`CacheKeyPrefix.cs:16-25`) is precise, since `InstanceName` is prepended below this abstraction where
the SCAN cannot see it, so prefix eviction would search for `product:*` while the stored keys were
`svc:product:*` and evict nothing, silently. [`MemoryCacheService`](#memorycacheservice) ignores
prefixes entirely because a per-process keyspace is private by construction (`CacheKeyPrefix.cs:26-29`).
TTL policy is centralized the same way: [`CacheOptions`](#cacheoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:15`) exposes a
deliberately short **30-second** `DefaultDuration` (`CacheOptions.cs:23`) as a bare `TimeSpan`, so
implementations that do not speak `DistributedCacheEntryOptions` still default to the same policy, plus
`DefaultExpiration` (`CacheOptions.cs:28`) and `Create(TimeSpan?)` (`CacheOptions.cs:38`) for the ones
that do. Those values are the hard-coded framework defaults and the single source of truth for the
configurable path as well: [`CacheSettings`](#cachesettings)
defaults `DefaultDuration` to `CacheOptions.DefaultDuration`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:32`), so a host that
configures nothing behaves exactly as it did before that section existed. The short default is a
staleness guard: caching is opt-in and conservative, and a read earns a longer life only by asking for
one. One policy object with many call sites is the [Rubric §12, Performance & Scalability] habit this framework
applies everywhere.

**How it fires at runtime.** Nothing above runs unless a use case opts in, via two marker interfaces
consumed by the CQRS decorator pipeline (`FeatureGate` then `Logging` then `Caching` then `Validating`
then `Transactional` then handler for commands, and the same chain without the last two for queries;
the order is documented at
`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:63-80` and registered at
`DependencyInjection.cs:137` and `DependencyInjection.cs:145`, taught in
[Group 5](group-05-cqrs-pipeline.md)). On the **read** path,
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
tests the query for [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) and passes straight
through when it is absent
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:64-65`).
When present it scopes the key to the target user for a caller-scoped query through
[`UserCacheKey`](group-05-cqrs-pipeline.md#usercachekey) and then to the resolved tenant through
[`TenantCacheKey`](group-05-cqrs-pipeline.md#tenantcachekey) (`CachingQueryDecorator.cs:58-59`, so two
tenants or two users can never share an entry), takes a lock-free fast path on a hit
(`CachingQueryDecorator.cs:74-79`), and on a miss acquires a per-key stripe from the process-wide
[`QueryCacheKeyLocks`](group-05-cqrs-pipeline.md#querycachekeylocks) (`CachingQueryDecorator.cs:185`),
re-checks (`CachingQueryDecorator.cs:100-105`), records the miss on
[`CqrsMetrics`](group-05-cqrs-pipeline.md#cqrsmetrics) exactly once (`CachingQueryDecorator.cs:113`),
and only then runs the inner handler. That stripe wait is itself bounded by
`Cache:PopulateLockTimeout` (`CachingQueryDecorator.cs:84-85`, default
`Timeout.InfiniteTimeSpan` on [`CacheSettings`](#cachesettings) at `CacheSettings.cs:57`): when a
finite budget elapses the waiter logs, counts a miss, and runs the query itself uncached rather than
queueing behind a pathologically slow populate (`CachingQueryDecorator.cs:87-96`,
`CachingQueryDecorator.cs:179-198`). The lock table is a fixed-width
[`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`, 256 stripes by
default at `KeyedSemaphoreStripe.cs:25`), which bounds memory no matter how many parameterized cache
keys the process sees. Every cache call is fail-open: a read fault is logged and treated as a miss
(`CachingQueryDecorator.cs:208-223`) and a populate fault returns the result uncached
(`CachingQueryDecorator.cs:120-131`), so a cache outage degrades reads instead of turning cacheable
queries into 500s, which is the [Rubric §29, Resilience] posture in miniature. Results are stored only
when they are not a failed [`Result`](group-01-result-error-handling.md#result)
(`CachingQueryDecorator.cs:118`). On the **write** path,
[`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
runs the inner handler first and then, only if the command implements
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), the prefix is non-blank (a blank
prefix is the opt-out, and the guard is load-bearing since an empty prefix would evict the whole cache)
and the result is not a failure, evicts the tenant-scoped prefix with `CancellationToken.None`
(`.../Decorators/CachingCommandDecorator.cs:59-72`). It then schedules a second eviction five seconds
later (`CachingCommandDecorator.cs:43`, `CachingCommandDecorator.cs:79`,
`CachingCommandDecorator.cs:96-109`) to catch a read that began before the commit and repopulated the
entry with pre-write state. Because the Caching decorator sits outside the Transactional one, eviction
runs after the transaction committed: against persisted state, never in-flight state, and never at all
when the write failed.

**Two tiers, not one.** These nine types are only **Tier 1** of the caching story that
[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records. Tier 2 is a separate
HTTP output-cache edge: `MMCA.Common.API` always runs `app.UseOutputCache()` as a named step in the
shared middleware pipeline
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:131-133`, see
[`MiddlewarePipelineBuilder`](group-12-api-hosting-mapping.md#middlewarepipelinebuilder)) but ships no
policies, so each host opts in with its own `AddOutputCache(...)`. The read-heavy public services
declare real cacheable policies through
[`OutputCacheOptionsExtensions`](group-12-api-hosting-mapping.md#outputcacheoptionsextensions) and its
`AddPublicEndpointPolicy`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:20`), backed
by [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
(`.../Caching/PublicEndpointOutputCachePolicy.cs:35`), which caches GET and HEAD regardless of an
`Authorization` header (`PublicEndpointOutputCachePolicy.cs:110`,
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)),
and evict it across replicas through the
[`OutputCacheEvictionRequested`](group-04-events-outbox.md#outputcacheevictionrequested) integration
event and its [`OutputCacheEvictionHandler`](group-12-api-hosting-mapping.md#outputcacheevictionhandler).
Both adopters back that edge with Redis when Redis is configured
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:196`;
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:100`), so the two tiers ride the same
Redis instance from opposite ends: Tier 1 through `IDistributedCache` or `HybridCache`, Tier 2 through
the output-cache store. ADR-026 also records an optional **third tier on the client**,
[`IUiReadCache`](group-15-common-ui-framework.md#iuireadcache), a per-circuit read-through cache over
the API client; it is a framework capability rather than a posture every UI host adopts, and it belongs
to [Group 15, Common UI Framework](group-15-common-ui-framework.md). Tier 2 belongs to
[Group 12, API Hosting](group-12-api-hosting-mapping.md); both are named here only so you do not
confuse them with Tier 1 when you meet `[OutputCache]` on a controller.

**Adoption reality, so you read the code with the right expectations.** Prefix invalidation against
Redis is live in the deployed services: every service host registers the Aspire Redis integration
through [`RedisCachingExtensions`](group-16-aspire-orchestration.md#rediscachingextensions), whose
`AddRedisCaching()` brings the `IConnectionMultiplexer` the SCAN needs along with the distributed cache
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:185`;
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:89`), and the hybrid substrate is
registered through the framework's connection-string guard
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:204`). Write-side adoption is
broad: about forty types across ADC's Conference, Engagement and Identity modules implement
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), for example
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:18`
with its aggregate-scoped `CachePrefix` at `:21`. Read-side adoption is not: no ADC query implements
[`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable). Its one hot public read,
[`GetNowNextQuery`](group-18-conference-application.md#getnownextquery), opts out on purpose and
relies on a Redis-backed output-cache policy instead
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:10-12`), so
the write-side query-cache invalidation currently evicts entries no ADC query wrote. The substrate's other production
consumers are not decorators at all:
[`LoginProtectionService`](group-08-auth.md#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:28`) injects
[`ICacheService`](#icacheservice) for its brute-force and rate-limit counters
(`LoginProtectionService.cs:89`, `LoginProtectionService.cs:170`), reading the lockout flag and the
registration count back through `GetFromSharedStoreAsync` (`LoginProtectionService.cs:59`,
`LoginProtectionService.cs:141`), covered in
[Group 8, Authentication and Authorization](group-08-auth.md), the password-reset and
email-confirmation token services, which count requests through `IncrementAsync`
(`PasswordResetTokenService.cs:68`, `EmailConfirmationTokenService.cs:53`) and redeem their single-use
records through `GetFromSharedStoreAsync` as described above, and
[`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) resolves it per request to
store and replay responses
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:141`). The key
namespace is live in both deployed applications, and the two pin it differently: ADC's four service
hosts all set `Cache:KeyPrefix` to `adc:` alongside `Application:Namespace` `adc`, because they share
one Redis and one Service Bus namespace and must agree on the keyspace they already share
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:44-45`, rationale at `:30-42`),
while each Store service pins its own
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/appsettings.json:45`, rationale at `:29-33`).
Each of those values restates what the per-application default would already have produced, so the
setting pins the keyspace against a rename rather than turning the feature on, and
[`CacheKeyNamespace.None`](#cachekeynamespace) is now only the constructor fallback the adapters use
when no namespace is passed, not the deployed state. Two honest caveats round this out. The stampede
lock is per process
(`CachingQueryDecorator.cs:239-245`): across replicas over a shared Redis you get at most one handler
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
an opt-in cache bolted onto a database-per-service system. Everything in the bound `Cache` section is
fail-open by design (`CacheSettings.cs:10-15`): no value there can turn a cache outage or a slow
populate into an error. The unit tests for these types, including the Redis-backed
[`DistributedCacheServiceRedisTests`](group-28-testing-infrastructure.md#per-project-test-rollup)
and [`HybridCacheServiceRedisTests`](group-28-testing-infrastructure.md#per-project-test-rollup),
are catalogued in [Group 27, Testing and Quality Infrastructure](group-28-testing-infrastructure.md).

### CacheKeyPrefixOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:31` · Level 0 · class (public sealed, options)

- **What it is**: the bound options object for one setting, `Cache:KeyPrefix`, the namespace prepended
  to every cache key written through [DistributedCacheService](#distributedcacheservice),
  [HybridCacheService](#hybridcacheservice) and the Redis distributed lock. It exists so several
  services sharing one Redis instance cannot read each other's entries by accidentally choosing the
  same key. Leaving it unset no longer means "no prefix": the empty value is a signal to fall back to
  the framework's own per-application default (`CacheKeyPrefix.cs:37-40`).
- **Depends on**: nothing first-party for the options object itself; it is a plain POCO bound by
  `Microsoft.Extensions.Options` / `IConfiguration` (BCL). Its value is turned into behavior by
  [CacheKeyNamespace](#cachekeynamespace), which is what the cache adapters actually hold, and which
  now falls back to [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace) when this option
  is unset (`CacheKeyPrefix.cs:37-40`).
- **Concept introduced, keyspace isolation for a shared cache, on by default.** `[Rubric §7,
  Microservices Readiness]` assesses whether a module keeps working, and keeps its data to itself, once
  it is lifted into its own process next to its siblings. A cache instance is exactly the kind of
  shared infrastructure that survives extraction unchanged, so the isolation a private process gave you
  for free has to be re-created explicitly. This option is one of two ways to get it: set it explicitly
  to pin a shared keyspace across hosts of the *same* application, or leave it unset and let
  [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace) derive a distinct keyspace per
  application automatically (`CacheKeyPrefix.cs:37-40`). `[Rubric §11, Security]` assesses whether the
  system prevents data reaching a caller who should not see it; SEC-Common-53
  (`CacheKeyPrefix.cs:90-92`) records that this option used to default to no prefix at all, so two
  applications sharing one Redis silently shared one keyspace for both cache entries and distributed
  locks. Isolation is now automatic rather than opt-in.
- **Walkthrough**
  - `SectionName` (`CacheKeyPrefix.cs:34`), `const string` = `"Cache"`. This is the configuration
    section, so the setting a host writes is `Cache:KeyPrefix`. The same section carries the TTL policy
    ([CacheSettings](group-09-caching.md#cachesettings)) and the query pipeline's
    populate-lock knob ([QueryCachePipelineSettings](group-14-module-system-composition.md#querycachepipelinesettings)),
    all three bound side by side in `AddCaching`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:39-57`).
  - `KeyPrefix` (`CacheKeyPrefix.cs:46`, doc at `CacheKeyPrefix.cs:36-45`), `string` with
    `{ get; init; }` and a default of `string.Empty`. The property default is unchanged, but its meaning
    changed: an empty value now tells
    [CacheKeyNamespace](#cachekeynamespace)`.From(IServiceProvider)` to resolve the framework's
    per-application default (`"{application namespace}:"`) rather than leaving keys unprefixed. Setting
    it explicitly is for the narrower case, pinning a keyspace two hosts of the *same* application must
    share.
- **Why it's built this way**: the class remarks (`CacheKeyPrefix.cs:16-29`) record the decision that
  makes this type necessary rather than redundant. Redis has a built-in equivalent,
  `RedisCacheOptions.InstanceName`, and it was rejected: `InstanceName` is prepended by
  `IDistributedCache` *below* this framework's abstraction, where prefix invalidation cannot see it.
  The SCAN that backs `RemoveByPrefixAsync` matches raw Redis keys, so it would search for `product:*`
  while the stored keys were `svc:product:*` and evict nothing, silently. Applying the prefix inside
  the adapter instead keeps get, set, remove and prefix eviction working from one key shape.
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the same reasoning
  (`026-caching-strategy.md:235-238`).
- **Where it's used**: bound in `AddCaching()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:41`) via
  `services.Configure<CacheKeyPrefixOptions>(configuration.GetSection(CacheKeyPrefixOptions.SectionName))`,
  and only when a non-null `IConfiguration` was passed (`DependencyInjection.Caching.cs:39`).
  `AddInfrastructure` always passes one
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:140`), so a host composing through the
  normal entry point gets the binding; a test calling the parameterless `AddCaching()` overload does
  not. The bound options are no longer read directly at the call sites; instead
  [CacheKeyNamespace](#cachekeynamespace)`.From(IServiceProvider)` resolves them (and the
  per-application fallback) once per registration, at three sites: the distributed cache factory
  (`DependencyInjection.Caching.cs:67`), the Redis lock factory (`DependencyInjection.Caching.cs:95`) and
  the opt-in hybrid factory (`DependencyInjection.Caching.cs:173`).
- **Caveats / not-in-source**: [MemoryCacheService](#memorycacheservice) never sees the prefix, because
  a per-process keyspace is private by construction and a prefix would add nothing
  (`CacheKeyPrefix.cs:26-29`). The prior caveat here, that no checked-in `appsettings*.json` sets
  `Cache:KeyPrefix` so the effective prefix is empty everywhere, no longer holds: because the empty
  default now resolves through
  [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace), every host that never sets
  `Cache:KeyPrefix` still gets a non-empty, per-application prefix at runtime.

### CacheOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:15` · Level 0 · class (public static)

- **What it is**: the framework's hard-coded TTL policy in one place. It exposes the default cache
  lifetime both as a bare `TimeSpan` and as a ready-made `DistributedCacheEntryOptions`, so no adapter
  and no caller hand-builds expiry options.
- **Depends on**: `Microsoft.Extensions.Caching.Distributed.DistributedCacheEntryOptions` (ASP.NET
  Core, NuGet). It is the seed value for
  [CacheSettings](group-09-caching.md#cachesettings)`.DefaultDuration`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:32`), and it is
  indirectly fed by the per-query [IQueryCacheable](group-05-cqrs-pipeline.md#iquerycacheable)
  `CacheDuration`, which arrives as the `expiration` argument when a cacheable query's result is
  stored.
- **Concept introduced, TTL as the freshness dial.** `[Rubric §12, Performance & Scalability]` assesses
  whether the system bounds staleness and avoids unbounded growth. The deliberately short 30-second
  default (`CacheOptions.cs:23`) is the conservative knob: a cached read is served for at most 30
  seconds before falling through to the source, so a query that never declares its own duration cannot
  serve dangerously stale data. Callers that can tolerate more staleness widen the window per query.
  `[Rubric §12, Performance & Scalability]` assesses whether concerns like caching, logging and validation
  live in one place instead of being re-decided per handler; TTL policy here is one property in one
  file rather than a `TimeSpan.FromSeconds(30)` scattered through call sites.
- **Walkthrough**
  - `DefaultDuration` (`CacheOptions.cs:23`), a `static TimeSpan` property = `TimeSpan.FromSeconds(30)`.
    Its doc (`CacheOptions.cs:17-22`) explains why the bare `TimeSpan` exists alongside the options
    object: [HybridCacheService](#hybridcacheservice) expresses expiry in `HybridCacheEntryOptions`,
    its own type, and would otherwise have needed a second hard-coded 30 seconds. One number, two
    shapes.
  - `DefaultExpiration` (`CacheOptions.cs:28-31`), a property returning a *fresh*
    `DistributedCacheEntryOptions` on each access, with `AbsoluteExpirationRelativeToNow =
    DefaultDuration`. It is a property, not a shared static field, so two callers can never alias and
    mutate the same options instance.
  - `Create(TimeSpan? expiration)` (`CacheOptions.cs:38-41`), expression-bodied: a new options object
    carrying the caller's `AbsoluteExpirationRelativeToNow` when `expiration` is non-null, otherwise
    `DefaultExpiration`. A null duration therefore reads as "use the 30s default", which is exactly the
    meaning of the optional `TimeSpan?` on [ICacheService](#icacheservice)`.SetAsync`.
- **Why it's built this way**: a static factory (no instance, no shared mutable state) makes TTL policy
  a single, allocation-cheap decision point. Choosing *absolute* expiration over sliding means an
  entry's lifetime is bounded no matter how often it is read, which is the safer default for
  read-through query caching: a hot key cannot keep itself alive indefinitely on stale data. The class
  remarks (`CacheOptions.cs:9-14`) name the split that came later: these are the framework defaults and
  the source of truth for the values, while per-host tuning goes through the bindable `Cache` section
  ([CacheSettings](group-09-caching.md#cachesettings)), whose every property defaults
  to what this class exposes so the configured and hard-coded paths cannot drift.
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the short default as
  the backstop that lets prefix invalidation stay best-effort without the system becoming incorrect
  (`026-caching-strategy.md:62`).
- **Where it's used**: [DistributedCacheService](#distributedcacheservice)`.SetAsync` calls
  `CacheOptions.Create(expiration ?? _settings.DefaultDuration)` for every write
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:72`), which
  is the only first-party call site of `Create`. `DefaultDuration` seeds
  [CacheSettings](group-09-caching.md#cachesettings)`.DefaultDuration`
  (`CacheSettings.cs:32`), which is what both distributed adapters actually read at runtime.
  [MemoryCacheService](#memorycacheservice) does **not** route through this type at all; it builds
  `MemoryCacheEntryOptions` inline. Unit-tested by
  [CacheOptionsTests](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: `DefaultExpiration` has no first-party caller outside `Create` itself
  (`CacheOptions.cs:41`) and its test; it is a published convenience on the package surface. And do not
  read the 30 seconds as a universal cache floor: because [MemoryCacheService](#memorycacheservice)
  bypasses this type, an in-process entry set with a null TTL has no time-based expiry at all
  (`MemoryCacheService.cs:72-75`) and leaves only capacity pressure or an explicit removal to clear it.

### RedisPrefixScanner
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisPrefixScanner.cs:24` · Level 0 · class (internal static)

- **What it is**: the one implementation of "evict every Redis key matching this pattern". It SCANs
  each non-replica server and deletes every match, and both Redis-capable cache adapters call it
  instead of carrying their own copy of the loop.
- **Depends on**: `StackExchange.Redis` (`IConnectionMultiplexer`, `IServer`, `RedisKey`,
  `RedisException`) as its only external, plus the BCL. It is called by
  [DistributedCacheService](#distributedcacheservice) and [HybridCacheService](#hybridcacheservice); it
  references neither of them, so the dependency points one way.
- **Concept introduced, parameterizing the parts that differ instead of forking the algorithm.**
  `[Rubric §1, SOLID]` assesses single responsibility and dependency direction; `[Rubric §2, Design
  Patterns]` assesses whether the code reaches for a known shape rather than improvising. The two
  callers need the same scan and different deletes, so the delete is a `Func<RedisKey, Task>` callback
  (`RedisPrefixScanner.cs:56`) rather than a fixed `KeyDeleteAsync`:
  [DistributedCacheService](#distributedcacheservice) deletes the raw Redis key, while
  [HybridCacheService](#hybridcacheservice) routes the delete back through `HybridCache.RemoveAsync` so
  its own in-process L1 copy dies with the L2 entry (`RedisPrefixScanner.cs:11-17`). Logging is
  parameterized the same way, as two `Action` hooks (`RedisPrefixScanner.cs:57-58`), because each
  service owns its own compile-time `LoggerMessage` definitions and its own notion of the prefix being
  evicted (`RedisPrefixScanner.cs:18-22`). `[Rubric §14, Testability]` assesses whether behavior can be
  exercised without standing up the world: folding the scan into one internal helper means the
  Redis-tier tests that cover one adapter cover the algorithm for both
  (`RedisPrefixScanner.cs:6-8`).
- **Walkthrough**
  - `DeleteBatchSize` (`RedisPrefixScanner.cs:27`), `const int` = `512`. Read it carefully: it is the
    number of single-key deletes kept **in flight** at once, not the number of keys packed into one
    command.
  - `RemoveMatchingAsync(connectionMultiplexer, pattern, deleteAsync, onNoServers, onServerFailed,
    cancellationToken)` (`RedisPrefixScanner.cs:53-84`), the entry point. It first collects every
    non-replica server, `[.. connectionMultiplexer.GetServers().Where(s => !s.IsReplica)]`
    (`RedisPrefixScanner.cs:64`). Every primary is scanned, not just the first one the multiplexer
    reports, because keys are distributed across primaries and scanning one leaves the others' entries
    alive until their TTL expires; replicas are skipped because their keyspace mirrors a primary
    already scanned and a delete against a replica is rejected (`RedisPrefixScanner.cs:42-46`). An
    empty server list invokes `onNoServers()` and returns (`RedisPrefixScanner.cs:65-69`). Otherwise
    each server is scanned inside its **own** try/catch (`RedisPrefixScanner.cs:71-83`) whose filter
    admits only `RedisException`, `RedisCommandException` and `TimeoutException`
    (`RedisPrefixScanner.cs:77`), so one unreachable node is logged through
    `onServerFailed(Describe(server), ex)` and skipped while the healthy nodes still get invalidated.
    Cancellation is deliberately not caught (`RedisPrefixScanner.cs:80`).
  - `ScanAndDeleteAsync(server, pattern, deleteAsync, cancellationToken)`
    (`RedisPrefixScanner.cs:92-119`), the per-server loop. It allocates `new List<Task>(DeleteBatchSize)`
    (`RedisPrefixScanner.cs:103`), enumerates `server.KeysAsync(pattern: pattern)` under
    `.WithCancellation(cancellationToken)` (`RedisPrefixScanner.cs:105-107`), issues one delete per key
    without awaiting it (`RedisPrefixScanner.cs:109`), and awaits the group with `Task.WhenAll` whenever
    the list reaches 512 (`RedisPrefixScanner.cs:110-114`), with a final flush for the remainder
    (`RedisPrefixScanner.cs:117-118`).
  - `Describe(server)` (`RedisPrefixScanner.cs:122-123`), `server.EndPoint?.ToString() ?? "unknown"`: a
    stable identifier for log output that tolerates an unknown endpoint.
- **Why it's built this way**: the comment at `RedisPrefixScanner.cs:98-102` is the part to internalize.
  Deletes go out one key at a time because a multi-key `DEL` must not span hash slots under Redis
  cluster policy, and StackExchange.Redis answers a cross-slot multi-key command by **throwing** rather
  than under-deleting. The keys behind one cache prefix hash to arbitrary slots, so batching them into a
  single command would fault the entire invalidation instead of speeding it up. Single-key deletes are
  always slot-safe, and the round-trip cost is contained by keeping 512 of them in flight rather than
  awaiting each one. The per-server try/catch is the same fail-soft posture the rest of this group
  takes: `[Rubric §29, Resilience]` assesses whether a partial infrastructure failure degrades instead
  of cascading, and here a failing node costs you the freshness of the keys it holds, nothing more.
- **Where it's used**: exactly two call sites, one per Redis-capable adapter:
  [DistributedCacheService](#distributedcacheservice)`.RemoveByPrefixAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:124-130`) and
  [HybridCacheService](#hybridcacheservice)`.RemoveByPrefixAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:231-237`).
  Exercised against a real Redis by
  [DistributedCacheServiceRedisTests](group-28-testing-infrastructure.md#per-project-test-rollup)
  and [HybridCacheServiceRedisTests](group-28-testing-infrastructure.md#per-project-test-rollup),
  which live in a separate `MMCA.Common.Infrastructure.Redis.Tests` project over Testcontainers rather
  than in the unit loop.
- **Caveats / not-in-source**: `KeysAsync` (SCAN) is O(keyspace) on the Redis side. That is acceptable
  at invalidation cadence and is not a hot-path operation. Nothing here reports how many keys it
  removed, so the only evidence a scan ran at all is the absence of the warning hooks firing.

### CacheKeyNamespace
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:50` · Level 1 · class (internal sealed)

- **What it is**: the tiny behavioral half of [CacheKeyPrefixOptions](#cachekeyprefixoptions). It holds
  a resolved prefix string and exposes one operation, `Qualify`, that turns a caller-supplied cache key
  into the key actually stored. Living in the same file as the options class keeps the setting and its
  only interpretation together.
- **Depends on**: [CacheKeyPrefixOptions](#cachekeyprefixoptions) (only as the input to its `From`
  factory) and `Microsoft.Extensions.Options.IOptions<T>` (BCL). Consumed by
  [DistributedCacheService](#distributedcacheservice), [HybridCacheService](#hybridcacheservice) and
  [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock).
- **Concept introduced, the null object as a configuration default, now with a non-empty fallback.**
  `[Rubric §15, Best Practices & Code Quality]` assesses whether the code avoids incidental complexity
  and defensive noise. Rather than making every call site ask "is a prefix configured?", the
  unconfigured case is represented by a real instance, `None`, whose `Qualify` returns the key
  unchanged. There is one branch (`CacheKeyPrefix.cs:91-92`) instead of a null check at every use.
  `[Rubric §11, Security]` assesses whether the system prevents data reaching a caller who should not
  see it: the composition-root factory, `From(IServiceProvider)`, is what turns an unset
  `Cache:KeyPrefix` into a non-empty, per-application prefix (SEC-Common-53,
  `CacheKeyPrefix.cs:65-69`) rather than into `None`, so cross-application key collisions are closed
  by construction rather than by a host remembering to configure a prefix. `[Rubric §14, Testability]`
  assesses whether behavior can be exercised without standing up the world: because the type is a plain
  object that both adapters take as an optional constructor parameter, a unit test passes
  `new CacheKeyNamespace("svc:")` directly and asserts on the qualified key with no configuration
  system involved
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:450`,
  and the same shape throughout `HybridCacheServiceTests.cs:79-96`).
- **Walkthrough**: primary constructor `CacheKeyNamespace(string prefix)` (`CacheKeyPrefix.cs:50`).
  - `None` (`CacheKeyPrefix.cs:53`), a `static` property initialised to `new(string.Empty)`. One
    shared, immutable instance meaning "leave keys alone"; still used directly wherever a caller wants
    no prefix at all (for example [MemoryCacheService](#memorycacheservice)'s registration), but no
    longer what an unconfigured `Cache:KeyPrefix` resolves to through `From(IServiceProvider)`.
  - `Prefix` (`CacheKeyPrefix.cs:56`), get-only, initialised with `prefix ?? string.Empty`, so a null
    argument degrades to the no-op prefix rather than throwing later inside `string.Concat`.
  - `From(IOptions<CacheKeyPrefixOptions>? options)` (`CacheKeyPrefix.cs:59-63`), the original
    factory: tolerates a **null options object**, reads `options?.Value.KeyPrefix`, and returns `None`
    when that is null or empty. It is still the plain, options-only overload used directly by tests;
    production DI code no longer calls it.
  - `From(IServiceProvider serviceProvider)` (`CacheKeyPrefix.cs:73-88`), the overload the DI
    factories now call. It null-checks `serviceProvider`, reads the bound `CacheKeyPrefixOptions` off
    it, and returns `new CacheKeyNamespace(configured)` when `Cache:KeyPrefix` is set
    (`CacheKeyPrefix.cs:77-81`); otherwise it resolves
    [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace)`.Resolve` against
    the container's `IConfiguration` and `IHostEnvironment` and returns
    `new CacheKeyNamespace($"{applicationNamespace}:")` (`CacheKeyPrefix.cs:83-87`). Because
    `ApplicationNamespace.Resolve` never returns empty (`ApplicationNamespace.cs:47-48`), this overload
    never returns `None`.
  - `Qualify(string key)` (`CacheKeyPrefix.cs:91-92`), expression-bodied: returns `key` unchanged when
    `Prefix.Length == 0`, otherwise `string.Concat(Prefix, key)`. No separator is inserted for an
    explicit prefix, so a caller-configured `Cache:KeyPrefix` must carry its own delimiter
    (`"conference:"`, not `"conference"`); the per-application fallback path adds the `:` itself.
- **Why it's built this way**: `internal sealed` because it is an implementation detail of the
  Infrastructure caching adapters, never part of the package's public surface. Splitting an `init`-only
  options POCO from this behavior object keeps the configuration contract (bindable, public) separate
  from the runtime helper (internal, immutable, allocation-free on the common path). Keeping the
  options-only `From(IOptions<T>?)` overload alongside the new `From(IServiceProvider)` overload lets
  the isolation policy (container-resolved, needs `IConfiguration`/`IHostEnvironment`) live next to the
  narrower, easily-unit-tested construction path rather than forcing every caller through a full
  service provider. Resolving the prefix once at construction rather than per call also means the
  options (and, on the fallback path, the application name) are read a single time for the lifetime of
  the singleton.
- **Where it's used**: built via `From(IServiceProvider)` in three DI factories and passed as a
  constructor argument: to [DistributedCacheService](#distributedcacheservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:67`), to
  [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock)
  (`DependencyInjection.Caching.cs:95`), and to [HybridCacheService](#hybridcacheservice) in the opt-in
  hybrid path (`DependencyInjection.Caching.cs:173`). Inside each adapter it lands in a `_keys` field
  with a `?? CacheKeyNamespace.None` fallback (`DistributedCacheService.cs:30`,
  `HybridCacheService.cs:97`). The in-process branch of `AddCaching()` constructs
  [MemoryCacheService](#memorycacheservice) with no namespace at all
  (`DependencyInjection.Caching.cs:76-77`), and the comment above it says why: the keyspace is private
  to the process, so neither the explicit prefix nor the per-application fallback is needed there.
- **Caveats / not-in-source**: because `Qualify` is applied inside the adapter and not by Redis, keys
  written by any code path that bypasses [ICacheService](#icacheservice) and talks to
  `IDistributedCache` directly would land unprefixed. Nothing in the framework does that today, but it
  is the invariant the design depends on. Also worth knowing: the per-application default changes the
  effective Redis key for every host that never set `Cache:KeyPrefix`, so an existing deployment
  upgrading past SEC-Common-53 starts writing under a new prefix; that is the intended fix, but it means
  entries written under the old, unprefixed keys are not found or invalidated by the new prefixed reads
  and simply age out under the TTL policy ([CacheOptions](#cacheoptions) /
  [CacheSettings](group-09-caching.md#cachesettings)).

### CacheSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:22` · Level 1 · class (public sealed, options)

- **What it is**: the `Cache` section's TTL policy: the default entry lifetime, the ceiling on the
  in-process copy of a two-level entry, and how long a cache miss waits for the per-key populate lock
  before giving up.
- **Depends on**: [CacheOptions](#cacheoptions), whose `DefaultDuration` seeds this class's own default
  (`CacheSettings.cs:32`), which is what puts it at Level 1, plus `Timeout` from the BCL. Consumed by
  [ICacheService](#icacheservice) implementations ([HybridCacheService](#hybridcacheservice),
  [DistributedCacheService](#distributedcacheservice)).
- **Concept introduced, fail-open configuration.** `[Rubric §29, Resilience & Business Continuity]`
  assesses whether a degraded dependency degrades the answer. The class doc states the invariant for
  the whole section: the cache is an optimization, never the system of record, so no value here can
  turn a cache outage or a slow populate into an error. A miss, an unreachable cache, or an expired
  `PopulateLockTimeout` all degrade the request to an uncached read that still runs the real handler
  and still answers correctly (`CacheSettings.cs:10-15`). `[Rubric §12, Performance & Scalability]`:
  the populate lock is stampede protection, and giving it a finite timeout trades that protection for
  a latency bound, which is exactly the tradeoff the remarks spell out (`:50-56`).

  `[Rubric §15, Best Practices & Code Quality]`: the defaults are not re-typed literals. `DefaultDuration`
  initializes from [CacheOptions](#cacheoptions)`.DefaultDuration` (`CacheSettings.cs:32`, defined as
  30 seconds at `CacheOptions.cs:23`), so the configured path and the hard-coded path cannot drift
  apart, and a host that configures nothing behaves as it did before the section existed
  (`CacheSettings.cs:3-7`).
- **Concept, one configuration section read by two layers.** The `Cache` section is shared three ways:
  this class, [CacheKeyPrefixOptions](#cachekeyprefixoptions) for the key namespace, and the
  Application layer's
  [QueryCachePipelineSettings](group-14-module-system-composition.md#querycachepipelinesettings), which
  reads the same `Cache:PopulateLockTimeout` key from a layer that cannot reference this assembly
  (`CacheSettings.cs:16-20`; the Application type declares `SectionName = "Cache"` at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:23` and the
  same `Timeout.InfiniteTimeSpan` default at `:29`). `[Rubric §3, Clean Architecture]`: the dependency
  rule forbids Application from referencing Infrastructure, so the duplication is not an accident, it
  is the price of keeping the layer boundary intact while both views read one operator-facing key.
- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "Cache"` (`CacheSettings.cs:25`).
  - `DefaultDuration` (`:32`), the absolute TTL applied when a caller supplies no expiration.
    [HybridCacheService](#hybridcacheservice) uses it as the fallback TTL (`HybridCacheService.cs:329`)
    and [DistributedCacheService](#distributedcacheservice) does the same
    (`DistributedCacheService.cs:72`).
  - `LocalCacheDuration` (`:42`), nullable, the ceiling on the L1 copy of a two-level entry so a
    replica that never sees an invalidation still re-reads L2 within the window. Null keeps the
    built-in 30-second ceiling (`HybridCacheService.cs:66`), and the effective L1 lifetime is the
    shorter of the ceiling and the entry's own TTL (`:271-272`). The single-level cache services have
    no L1 and ignore it.
  - `PopulateLockTimeout` (`:57`), defaulting to `Timeout.InfiniteTimeSpan`: waiters block until the
    one request holding the lock has populated the entry. A finite value bounds that wait and lets the
    waiter proceed uncached, and the remarks note that zero or a negative value means no bound, exactly
    like the default (`:50-56`).
  - Both cache services take the options as an OPTIONAL constructor parameter and fall back to a fresh
    instance (`HybridCacheService.cs:53`, `:89`; `DistributedCacheService.cs:24`, `:37`), so a service
    constructed outside the container still gets the framework defaults.
- **Why it's built this way**: registration guarantees `IOptions<CacheSettings>` always resolves. When
  configuration is available the section is bound and validated
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:43-46`, fail-fast
  via `ValidateOnStart`, see
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)); when the
  parameterless overload is used, `AddOptions<CacheSettings>()` is still called so the defaults
  materialize instead of failing the host (`DependencyInjection.Caching.cs:55`, rationale at `:30-38`).
  The same values are then projected into `HybridCache`'s own option type through the options pipeline rather than the
  `AddHybridCache` callback, because the callback has no service provider to read the bound section
  from, and the host's own hook still runs last so it can override anything the framework set
  (`DependencyInjection.Caching.cs:149-163`,
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)).
- **Where it's used**: [DistributedCacheService](#distributedcacheservice) and
  [HybridCacheService](#hybridcacheservice) receive it through `IOptions<CacheSettings>`
  (`DependencyInjection.Caching.cs:73`, `:176`), and the `HybridCacheOptions` projection reads it at
  `:151-156`. Its defaults and binding are pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/CacheSettingsTests.cs`.

### ICacheService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10` · Level 3 · interface

- **What it is**: the Application layer's cache port. Get by key, look a key up and report presence
  separately from the value, read straight from the shared backing store, set with an optional TTL,
  remove by exact key, remove every key matching a prefix, increment a counter, and get-or-create with
  stampede protection. It hides whether the backing store is Redis, a SQL distributed cache, an
  in-process `IMemoryCache`, or a two-level `HybridCache`.
- **Depends on**: BCL types at the signature level (`Task`, `CancellationToken`, `TimeSpan?`, value
  tuples) plus [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from
  `MMCA.Common.Shared.Concurrency`, which the default `GetOrCreateAsync` body uses through the
  [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) holder (`ICacheService.cs:1`,
  `ICacheService.cs:195-199`). Implemented by [MemoryCacheService](#memorycacheservice),
  [DistributedCacheService](#distributedcacheservice) and [HybridCacheService](#hybridcacheservice).
- **Concept introduced, dependency inversion for infrastructure.** `[Rubric §3, Clean Architecture]`
  assesses whether business code depends on abstractions while concrete technology sits at the edges.
  The Application layer *defines* this contract; the Infrastructure layer *implements* it. Handlers,
  decorators and the auth services never see `StackExchange.Redis` or `Microsoft.Extensions.Caching`;
  they program against this interface and the container decides which adapter they get. **Second
  concept, the default interface member as a non-breaking extension point.** `[Rubric §15,
  Best Practices & Code Quality]` assesses whether the codebase can absorb change without a ripple. Four
  members here ship with bodies: `TryGetAsync` (`ICacheService.cs:34`), `GetFromSharedStoreAsync`
  (`ICacheService.cs:65`), `IncrementAsync` (`ICacheService.cs:112`) and `GetOrCreateAsync`
  (`ICacheService.cs:152`). Every existing implementer keeps compiling and inherits working behavior,
  while a store with a better primitive overrides. That is how the
  [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
  counters, the whole
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) two-level substrate,
  and later the shared-store read for single-use records were added to a *published package contract*
  without a breaking change. `[Rubric §12, Performance & Scalability]`: `RemoveByPrefixAsync`
  (`ICacheService.cs:91`) is the member that makes *scoped* invalidation possible, so one mutation
  evicts a whole family of cached query results without enumerating individual keys.
- **Walkthrough**: members in declaration order.
  - `Task<T?> GetAsync<T>(string key, CancellationToken)` (`ICacheService.cs:17`), returns `default` /
    `null` on a miss.
  - `async Task<(bool Found, T? Value)> TryGetAsync<T>(string key, CancellationToken)`
    (`ICacheService.cs:34-38`), a **default implementation**. It exists for a value-type `T`, where
    `GetAsync` answers a miss with `default(T)` (`0`, `false`, `Guid.Empty`) that cannot be told apart
    from a cached `default(T)` (`ICacheService.cs:19-24`). The default body infers presence from a
    non-null `GetAsync` result (`ICacheService.cs:36-37`), which is exact for reference and nullable
    types; [MemoryCacheService](#memorycacheservice) and
    [DistributedCacheService](#distributedcacheservice) override it with a real presence check.
  - `Task<T?> GetFromSharedStoreAsync<T>(string key, CancellationToken)` (`ICacheService.cs:65-66`),
    a **default implementation** that simply calls `GetAsync`. It reads from the shared backing store,
    bypassing any process-local copy, and is meant for values whose change on one replica must be
    visible to every other replica at once: single-use records (an OAuth exchange code, a
    password-reset or email-confirmation token, a second-factor time step) and counters maintained by
    `IncrementAsync`, such as a registration rate-limit count (`ICacheService.cs:40-44`). The remarks
    give the usage rule: read the record through this member, then remove it; read a counter through it
    too, because a store with a process-local tier increments in the shared store and a local copy would
    pin the first count it saw; everything read many times stays on `GetAsync`
    (`ICacheService.cs:51-59`). The default is exact for a store with no
    process-local tier; [HybridCacheService](#hybridcacheservice) overrides it
    (`ICacheService.cs:59-62`).
  - `Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken)`
    (`ICacheService.cs:75-79`). A null `expiration` means "use the implementation's default TTL",
    resolved from [CacheSettings](group-09-caching.md#cachesettings) on all three shipped stores
    (whose own default is [CacheOptions](#cacheoptions)`.DefaultDuration`).
  - `Task RemoveAsync(string key, CancellationToken)` (`ICacheService.cs:85`), single-key eviction.
  - `Task RemoveByPrefixAsync(string prefix, CancellationToken)` (`ICacheService.cs:91`), bulk eviction
    of every key starting with `prefix`. This is what
    [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
    invokes after a successful mutation.
  - `async Task<long> IncrementAsync(string key, TimeSpan expiration, CancellationToken)`
    (`ICacheService.cs:112-118`), a **default implementation**: read the current value as `long?` (0 on a
    miss), add one, write it back with `expiration`, return the new value. The doc
    (`ICacheService.cs:93-111`) is explicit that it serves rate-limit and brute-force counters
    ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html))
    and that it is **not atomic in any shipped implementation**: the default member,
    `DistributedCacheService` and `HybridCacheService` are all a `GetAsync` + `SetAsync`
    read-modify-write, so concurrent requests can overwrite each other's increments and undercount
    (`ICacheService.cs:93-100`). The remarks add that no shipped store overrides it with Redis `INCR`,
    because the distributed cache stores entries as Redis hashes and an `INCR` string at the same key
    would fail the next read with `WRONGTYPE` (`ICacheService.cs:105-110`).
  - `async Task<T> GetOrCreateAsync<T>(string key, Func<CancellationToken, Task<T>> factory, TimeSpan?
    expiration = null, CancellationToken)` (`ICacheService.cs:152-178`), the last default
    implementation and the most interesting one. It null-guards the factory (`ICacheService.cs:158`),
    takes a **lock-free fast path on a hit** (`ICacheService.cs:162-164`), and only on a miss acquires
    the key's stripe from [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks)
    (`ICacheService.cs:166`), re-reads under the lock (`ICacheService.cs:170-172`, the double-check that
    lets waiters see the value the winner just wrote), then runs the factory and stores its result
    (`ICacheService.cs:174-175`). Both reads go through `TryGetAsync`, not a null test, so a cached
    `default(T)` of a value type counts as a hit and a miss still runs the factory
    (`ICacheService.cs:160-161`). That is the same read-through-with-stampede-protection shape
    [CachingQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
    applies to cacheable queries, made available to any caller.
  - [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) (`ICacheService.cs:195-199`), the
    non-generic holder for the fixed-width
    [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) that the default `GetOrCreateAsync`
    uses. It is deliberately a **separate** table from the query decorator's `QueryCacheKeyLocks`
    (`ICacheService.cs:191-193`): different call sites over different keys, and sharing stripes would
    only widen the unrelated-key collisions striping already tolerates.
- **Why it's built this way**: keeping the port in `MMCA.Common.Application` rather than Infrastructure
  is what lets the CQRS decorators, which also live in Application, depend on caching without dragging
  a Redis reference into the business layers. The optional `TimeSpan? expiration` lets callers override
  the global TTL without a second overload. The four defaulted members follow the precedent
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) names explicitly: a
  default interface member is how this package grows a capability that no consumer has to react to.
  `GetFromSharedStoreAsync` makes the single-use-record rule a named member rather than a convention, so
  a caller states "this read must not be answered from a replica's own memory" at the call site.
  Note the honest boundary the `GetOrCreateAsync` remarks draw (`ICacheService.cs:133-151`): caching is
  **unconditional** there, so a failed [Result](group-01-result-error-handling.md#result) would be
  cached, which is exactly why the caching decorators do NOT route through this member and keep their
  own read/execute/write sequence.
- **Where it's used**: both caching decorators take `ICacheService` by constructor injection
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:45`,
  `.../CachingCommandDecorator.cs:35`). Outside the pipeline,
  [LoginProtectionService](group-08-auth.md#loginprotectionservice) calls `IncrementAsync` for failed
  logins and per-IP registrations
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:89` and `:170`),
  and reads the lockout flag and the registration counter through `GetFromSharedStoreAsync`
  (`LoginProtectionService.cs:59` and `:141`);
  [PasswordResetTokenService](group-08-auth.md#passwordresettokenservice) uses it for the per-email
  request counter, the token write and the token read, the last through `GetFromSharedStoreAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:68`, `:90`,
  `:128`); [EmailConfirmationTokenService](group-08-auth.md#emailconfirmationtokenservice) follows the
  same shape
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:53`, `:75`,
  `:90`); [TwoFactorAuthenticator](group-08-auth.md#twofactorauthenticator) reads the last accepted
  time step through `GetFromSharedStoreAsync` and writes the new one with `SetAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs:105`
  and `:113`); [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) writes the soft-deleted
  marker with `SetAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:63`),
  read back through `GetFromSharedStoreAsync` by
  [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:92`);
  [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter) resolves it per request
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:141`) to store and
  replay the cached response record (`IdempotencyFilter.cs:361` and `:450`, default expiration 24 hours
  at `:81`); and [OAuthControllerBase](group-12-api-hosting-mapping.md#oauthcontrollerbase) takes it as
  a constructor dependency
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:52`), writing the
  exchange-code entry with `SetAsync` (`OAuthControllerBase.cs:190`) and redeeming it through
  `GetFromSharedStoreAsync` (`OAuthControllerBase.cs:273`). Exactly one implementation is live per
  host: `AddCaching()` registers one via `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:59`), and
  `AddCommonHybridCache()` replaces it (`DependencyInjection.Caching.cs:167-168`). The default
  `GetOrCreateAsync` body is covered by
  [CacheServiceGetOrCreateTests](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: `IncrementAsync` is **not atomic** on any shipped implementation. The
  default body is a read-modify-write, and both distributed adapters override it with the same shape
  rather than Redis `INCR`, for the storage-format reason spelled out in the
  [DistributedCacheService](#distributedcacheservice) section. Stampede protection in
  `GetOrCreateAsync` is likewise **per process** (`ICacheService.cs:141-143`): with several replicas over
  one shared cache the factory can still run once per replica, and a cluster-wide guarantee would need
  a distributed lock, which is deliberately not attempted here. `GetOrCreateAsync` has no first-party
  caller outside tests today: it is a published extension point plus the member
  [HybridCacheService](#hybridcacheservice) overrides. And `TryGetAsync` is overridden only by
  [MemoryCacheService](#memorycacheservice) and [DistributedCacheService](#distributedcacheservice):
  [HybridCacheService](#hybridcacheservice) inherits the null-inference default, which is harmless for
  its own `GetOrCreateAsync` (overridden, so it never calls `TryGetAsync`) but means a direct
  `TryGetAsync` of a value type on that store cannot distinguish a miss from a cached `default(T)`.

### DistributedCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:19` · Level 4 · class (internal sealed partial)

- **What it is**: the out-of-process implementation of [ICacheService](#icacheservice), backed by
  ASP.NET Core's `IDistributedCache` (Redis in the deployed services, or a SQL Server distributed
  cache). Values cross the wire as UTF-8 JSON, every key is namespaced through
  [CacheKeyNamespace](#cachekeynamespace), and prefix eviction runs Redis SCAN when an
  `IConnectionMultiplexer` is available.
- **Depends on**: [ICacheService](#icacheservice) (implemented),
  [CacheKeyNamespace](#cachekeynamespace) (optional constructor parameter),
  [CacheSettings](group-09-caching.md#cachesettings) (optional, the TTL policy),
  [CacheOptions](#cacheoptions) (every write) and [RedisPrefixScanner](#redisprefixscanner) (prefix
  eviction). Externals: `Microsoft.Extensions.Caching.Distributed.IDistributedCache`, `ILogger<T>`,
  `System.Text.Json.JsonSerializer` (BCL) and `StackExchange.Redis.IConnectionMultiplexer` (NuGet,
  optional).
- **Concept introduced, reaching past an abstraction that cannot express what you need.** `[Rubric §7,
  Microservices Readiness]` assesses whether shared state survives a module moving into its own
  process: a *distributed* cache is shared across replicas and across extracted services, so cached
  reads stay coherent when a service scales out. The design point worth internalising is that
  `IDistributedCache` has **no key-enumeration API**; you cannot ask it for every key starting with X.
  This adapter therefore takes the optional raw `IConnectionMultiplexer` alongside the abstraction and
  uses server-side SCAN to satisfy `RemoveByPrefixAsync`, accepting a Redis-specific dependency for
  exactly one operation while every other operation stays store-agnostic, which is also the `[Rubric
  §12, Performance & Scalability]` trade this class exists to make. `[Rubric §13, Observability &
  Operability]` assesses whether the system makes its own degraded states visible: when the multiplexer
  is absent the class does not silently swallow the missed invalidation, it warns once, so a dead
  eviction path shows up in logs instead of as unexplained stale data.
- **Walkthrough**: primary constructor (`DistributedCacheService.cs:19-24`), `IDistributedCache cache`
  and `ILogger<DistributedCacheService> logger` required, `IConnectionMultiplexer? connectionMultiplexer
  = null`, `CacheKeyNamespace? keyNamespace = null` and `IOptions<CacheSettings>? cacheSettings = null`
  optional. The class is `partial` so the `[LoggerMessage]` source generator can emit its log methods.
  - `_keys` (`DistributedCacheService.cs:30`), the resolved
    [CacheKeyNamespace](#cachekeynamespace), defaulting to `CacheKeyNamespace.None`.
  - `_settings` (`DistributedCacheService.cs:37`), the bound `Cache` section or
    `new CacheSettings()` when a host built the service without one (direct construction in tests). The
    fallback reproduces [CacheOptions](#cacheoptions)`.DefaultDuration` exactly
    (`DistributedCacheService.cs:32-36`), so an unconfigured host writes the TTL it always did.
  - `GetAsync<T>` (`DistributedCacheService.cs:40-45`), fetches the raw `byte[]` via
    `cache.GetAsync(_keys.Qualify(key), ...)`; returns `default` on null (a miss), else
    `Deserialize<T>`.
  - `TryGetAsync<T>` (`DistributedCacheService.cs:48-53`), an **override** of the
    [ICacheService](#icacheservice) default that reads the same raw bytes and decides presence from
    them: `null` bytes are `(false, default)`, anything else is `(true, Deserialize<T>(bytes))`
    (`DistributedCacheService.cs:52`). Presence is therefore a property of the stored entry, not of the
    deserialized value, so a cached `0` or `false` is a hit.
  - `SetAsync<T>` (`DistributedCacheService.cs:61-74`), serializes to bytes and writes with
    `cache.SetAsync(_keys.Qualify(key), bytes, CacheOptions.Create(expiration ??
    _settings.DefaultDuration), ...)` (`DistributedCacheService.cs:72`). That single line is where the
    caller's optional `TimeSpan?`, the configured default and the hard-coded framework default all
    collapse into one `DistributedCacheEntryOptions`.
  - `RemoveAsync` (`DistributedCacheService.cs:77-78`), expression-bodied passthrough on the qualified
    key.
  - `_noMultiplexerWarned` (`DistributedCacheService.cs:81`), an `int` flag flipped once via
    `Interlocked.Exchange` so the missing-multiplexer warning fires exactly once per process rather
    than on every mutating command.
  - `RemoveByPrefixAsync` (`DistributedCacheService.cs:108-131`). If `connectionMultiplexer` is null
    (`DistributedCacheService.cs:110`) it logs the no-op once, guarded by `Interlocked.Exchange(ref
    _noMultiplexerWarned, 1) == 0` (`DistributedCacheService.cs:115-116`), and returns; entries then
    expire on TTL alone. Otherwise it delegates the whole scan to
    [RedisPrefixScanner](#redisprefixscanner)`.RemoveMatchingAsync`
    (`DistributedCacheService.cs:124-130`), passing the namespaced pattern
    `$"{_keys.Qualify(prefix)}*"` (`DistributedCacheService.cs:126`, note the prefix is namespaced too,
    which is the entire reason the namespace lives here rather than in
    `RedisCacheOptions.InstanceName`), a raw `KeyDeleteAsync` as the per-key delete over a lazily
    resolved `IDatabase` (`DistributedCacheService.cs:127` and `:122`, so a host whose multiplexer
    reports no scannable server never asks for a database), and its own two log hooks
    (`DistributedCacheService.cs:128-129`).
  - `IncrementAsync` (`DistributedCacheService.cs:153-159`), an **override** of the
    [ICacheService](#icacheservice) default that keeps the same read-modify-write shape. The remarks
    (`DistributedCacheService.cs:133-152`) are the important read. Redis `INCR` would be atomic, which
    is what the member was added for, but `INCR` writes a Redis **string** while
    `StackExchangeRedisCache` stores every entry as a Redis **hash** (`absexp` / `sldexp` / `data`,
    read back with `HMGET`). Mixing the two at one key makes the next read fail with `WRONGTYPE`, which
    surfaces as a 500 on whatever endpoint owns the counter (registration and login, in the
    [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
    case). A counter has to live in the same storage format as the reads that consult it, so
    readability was chosen over atomicity.
  - `Deserialize<T>` / `Serialize<T>` (`DistributedCacheService.cs:161-165`), private static JSON
    helpers: `SerializeToUtf8Bytes(value)` and `Deserialize<T>(bytes)!` (null-forgiving, since the BCL
    signature is nominally nullable).
  - `LogPrefixEvictionNoMultiplexer` / `LogPrefixEvictionNoServer` / `LogPrefixEvictionServerFailed`
    (`DistributedCacheService.cs:167-174`), `[LoggerMessage]` `Warning`-level partial methods. The
    first names the fix explicitly ("Register a Redis client (AddRedisClient) to enable prefix
    eviction"), and the third states the blast radius ("the remaining servers are still processed, so
    entries on this one are bounded only by their TTL"), which is the difference between a log line and
    an actionable one.
- **Why it's built this way**: UTF-8 JSON keeps cached payloads engine-agnostic and inspectable from
  any Redis client. The optional multiplexer is the pragmatic compromise the
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) /
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) extraction path
  demands: the cache contract must work whether the deployment has Redis (full prefix eviction) or only
  a fallback distributed store (single-key operations), so prefix eviction *degrades to a no-op* rather
  than throwing, and the 30-second TTL becomes the staleness backstop. Warn-once keeps that degradation
  from being invisible without flooding the log. Lifting the scan into
  [RedisPrefixScanner](#redisprefixscanner) came with the two-level cache: two adapters that evict
  differently should still share one eviction algorithm. The class has no process-local tier, so it
  keeps the [ICacheService](#icacheservice) default for `GetFromSharedStoreAsync`: every read already
  comes from the shared store. `internal sealed partial`: `partial` for the generated log methods,
  `internal sealed` because it is only ever resolved through the [ICacheService](#icacheservice)
  registration.
- **Where it's used**: selected by `AddCaching()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:59-80`). The
  `TryAddSingleton<ICacheService>` factory builds this implementation **only when** an
  `IDistributedCache` is present and is not the default `MemoryDistributedCache`
  (`DependencyInjection.Caching.cs:62`), resolving the optional `IConnectionMultiplexer`
  (`DependencyInjection.Caching.cs:64`), an `ILogger` with a `NullLogger` fallback
  (`DependencyInjection.Caching.cs:65-66`), the [CacheKeyNamespace](#cachekeynamespace)
  (`DependencyInjection.Caching.cs:67`) and the optional
  [CacheSettings](group-09-caching.md#cachesettings)
  (`DependencyInjection.Caching.cs:73`); otherwise it falls back to
  [MemoryCacheService](#memorycacheservice). Downstream it is consumed only through the interface.
  Covered by
  [DistributedCacheServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup) and,
  against a real Redis,
  [DistributedCacheServiceRedisTests](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: all seven deployed service hosts call
  `AddCommonHybridCacheWhenRedisConfigured`, which registers the two-level cache only when the `redis`
  connection string is present
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:201-213`; for
  example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:204`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:108`), so this adapter is not the
  one the container hands out in those hosts when Redis is configured: it is the default for any host
  that registers a real distributed cache and does *not* opt in. `IncrementAsync` here is not atomic
  (see the walkthrough);
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the possible
  undercount as accepted rather than outstanding.

### HybridCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:48` · Level 4 · class (internal sealed partial)

- **What it is**: the two-level implementation of [ICacheService](#icacheservice), backed by
  `Microsoft.Extensions.Caching.Hybrid.HybridCache`: an in-process L1 in front of the host's registered
  `IDistributedCache` L2, with serialization, L1 promotion and stampede protection supplied by the
  platform. It is opt-in per host through `AddCommonHybridCache` (`HybridCacheService.cs:13-16`).
- **Depends on**: [ICacheService](#icacheservice) (implemented),
  [CacheKeyNamespace](#cachekeynamespace) (optional constructor parameter),
  [CacheSettings](group-09-caching.md#cachesettings) (optional, the TTL and L1
  ceiling), [CacheOptions](#cacheoptions) (the value those settings default to) and
  [RedisPrefixScanner](#redisprefixscanner) (prefix eviction). Externals: `HybridCache` /
  `HybridCacheEntryOptions` / `HybridCacheEntryFlags` (NuGet), `ILogger<T>` and
  `StackExchange.Redis.IConnectionMultiplexer` (optional).
- **Concept introduced, two serialization formats must never share one keyspace.** `[Rubric §8, Data
  Architecture]` assesses whether stored data has one owner and one shape; `[Rubric §15,
  Best Practices & Code Quality]` assesses whether a change can be rolled out without a coordinated flag day. Every
  key this service writes carries a `hc:` segment inside the configured prefix, `{prefix}hc:{key}`
  (`HybridCacheService.cs:20`, `:55`, `:307`), which is the structural form of the `WRONGTYPE` lesson
  recorded on [DistributedCacheService](#distributedcacheservice)`.IncrementAsync`. `HybridCache`
  writes its own payload layout, not the UTF-8 JSON the older adapter writes, so letting the two meet
  at one key would reproduce that production failure at *every* key rather than at one counter. With
  the keyspaces disjoint, an entry written by the other service is simply invisible to this one (a
  clean miss) and vice versa, so two hosts can share one Redis without either being able to read a
  payload it cannot parse (`HybridCacheService.cs:19-27`).
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) adds the case the code
  comment does not spell out, a rolling deploy where both builds serve traffic against one Redis
  (`077-hybridcache-substrate.md:54-56`), records the rejected alternative, a payload discriminator in
  one keyspace, and why "impossible" beat "unlikely"
  (`077-hybridcache-substrate.md:58-61`); it also states the consequence this code implements, that
  prefix eviction "scans the `hc:` keyspace and nothing else"
  (`077-hybridcache-substrate.md:66-67`). `[Rubric §12, Performance & Scalability]`: the whole point of
  L1 is removing a network hop and a JSON deserialize from every read of a small hot value. **Second
  concept, knowing which reads must skip the fast tier.** `[Rubric §11, Security]`: an L1 copy is only
  safe for a value that tolerates being stale on one replica for the local expiration. A counter and a
  single-use record (an OAuth exchange code, a password-reset or email-confirmation token, the last
  accepted second-factor time step) do not, so both read from L2 alone (`HybridCacheService.cs:35-46`).
  A counter is incremented through `IncrementAsync`, which reads and writes L2 only, and a caller that
  reads a counter without incrementing it (the registration rate-limit check in
  [LoginProtectionService](group-08-auth.md#loginprotectionservice)) reads it through
  `GetFromSharedStoreAsync` too, as do the reads that must see a removal at once (the login lockout flag
  and the soft-deleted-user marker) (`HybridCacheService.cs:40-46`).
- **Walkthrough**: primary constructor (`HybridCacheService.cs:48-53`), the same shape as the
  distributed adapter but over `HybridCache hybrid`.
  - `KeyspaceSegment` (`HybridCacheService.cs:59`), `internal const string` = `"hc:"`, applied *inside*
    the configured namespace.
  - `LocalCacheDefault` (`HybridCacheService.cs:66`), `internal static readonly TimeSpan` = 30 seconds.
    It is both the default L1 lifetime and the **ceiling** applied to every entry, and
    `AddCommonHybridCache` seeds `HybridCacheOptions` from the same field when the host configured no
    `Cache:LocalCacheDuration`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:159`).
  - `ReadOnlyOptions` (`HybridCacheService.cs:74-77`) and `SharedStoreReadOptions`
    (`HybridCacheService.cs:86-91`), two static option objects. The first sets
    `HybridCacheEntryFlags.DisableUnderlyingData`, which tells `HybridCache` not to invoke the factory
    and not to write anything, so a miss stays a miss while an L2 hit is still promoted into L1. The
    second adds `DisableLocalCacheRead | DisableLocalCacheWrite`, a read answered by L2 alone with no
    L1 promotion, shared by the two reads whose correctness depends on every replica seeing the same
    value: the counter read in `IncrementAsync` and `GetFromSharedStoreAsync`
    (`HybridCacheService.cs:79-85`).
  - `_keys` (`HybridCacheService.cs:97`), `_settings` (`HybridCacheService.cs:104`) and
    `_noMultiplexerWarned` (`HybridCacheService.cs:107`), identical in role to their counterparts on
    [DistributedCacheService](#distributedcacheservice).
  - `GetAsync<T>` (`HybridCacheService.cs:118-137`), calls `hybrid.GetOrCreateAsync` with a `static`
    no-op factory and `ReadOnlyOptions` (`HybridCacheService.cs:124-129`), which is how you perform a
    plain read through an API whose primary shape is get-or-create. It is **fail-soft**
    (`HybridCacheService.cs:110-117`): any exception that is not `OperationCanceledException` is logged
    at warning and answered as a miss (`HybridCacheService.cs:131-136`), and the offending entry is
    dropped best-effort through `SelfHealAsync` so the next write repopulates it instead of the process
    failing the same read forever.
  - `GetFromSharedStoreAsync<T>` (`HybridCacheService.cs:154-173`), an **override** of the
    [ICacheService](#icacheservice) default. It is the same no-op-factory read as `GetAsync`, but with
    `SharedStoreReadOptions` (`HybridCacheService.cs:163`), so the answer always comes from L2 and
    nothing is promoted into this replica's memory: a removal on another replica is seen immediately,
    which is what keeps a single-use record single-use (`HybridCacheService.cs:140-145`). It is
    fail-soft exactly like `GetAsync` (`HybridCacheService.cs:167-172`); for a single-use record a miss
    is a refusal, which is the safe direction (`HybridCacheService.cs:147-151`).
  - `SetAsync<T>` (`HybridCacheService.cs:183-188`), one call to `hybrid.SetAsync` with the options
    `WriteOptions(expiration)` builds.
  - `RemoveAsync` (`HybridCacheService.cs:197-198`), `hybrid.RemoveAsync`, which clears this process's
    L1 copy along with the L2 entry. Other replicas' L1 copies are not reached and keep serving the
    removed value until they expire, up to `Cache:LocalCacheDuration` (30 seconds by default); a read that
    must see the removal everywhere goes through `GetFromSharedStoreAsync`.
  - `RemoveByPrefixAsync` (`HybridCacheService.cs:219-238`). After the same warn-once no-multiplexer
    guard (`HybridCacheService.cs:221-229`) it runs [RedisPrefixScanner](#redisprefixscanner) once,
    over this service's own pattern `$"{HybridKey(prefix)}*"` (`HybridCacheService.cs:233`), which is
    the one keyspace this service writes and therefore the one it evicts. The per-key delete routes
    back through `hybrid.RemoveAsync` rather than a raw `KeyDeleteAsync`
    (`HybridCacheService.cs:234`): a raw delete would clear L2 and leave this process's own L1 copy
    serving the value it just invalidated (`HybridCacheService.cs:199-201`). The same remarks note that
    other replicas' L1 copies of the matched keys are not reached and persist until they expire, up to
    `Cache:LocalCacheDuration` (30 seconds by default).
  - `IncrementAsync` (`HybridCacheService.cs:264-285`), a read-modify-write like the distributed
    adapter's, and deliberately **not** routed through this class's own `GetAsync` / `SetAsync` because
    both legs must bypass L1 (`HybridCacheService.cs:268-273` reads with `SharedStoreReadOptions`,
    `:266-271` writes with the two disable flags). The reason
    (`HybridCacheService.cs:251-258`) is the sharpest argument in this group: a counter is the one
    value whose correctness depends on every replica seeing the same number, so an L1 copy would let a
    process read its own stale count and write it back, and a brute-force counter could then be held
    near its starting value indefinitely by a steady stream of attempts against one replica. That is a
    security control silently weakened by a cache optimization, so `[Rubric §11, Security]` is the
    category that decided this member, not §12. Faults are also **not** swallowed here, unlike
    `GetAsync` (`HybridCacheService.cs:260-261`): a counter that silently reads as zero would reset the
    limit it exists to enforce.
  - `GetOrCreateAsync<T>` (`HybridCacheService.cs:296-313`), an override of the interface default that
    hands the work to `HybridCache`'s own primitive, which folds the double-check and the stampede
    protection into one call and additionally deduplicates concurrent callers before they reach L2. The
    factory is passed as **state** rather than captured (`HybridCacheService.cs:304-312`), so the
    delegate stays `static` and no closure is allocated per call.
  - `HybridKey` (`HybridCacheService.cs:318`), `WriteOptions` (`HybridCacheService.cs:327-338`) and
    `SelfHealAsync` (`HybridCacheService.cs:348-358`), the private helpers. `WriteOptions` is where
    both dials meet: `ttl = expiration ?? _settings.DefaultDuration`
    (`HybridCacheService.cs:329`), `localCeiling = _settings.LocalCacheDuration ?? LocalCacheDefault`
    (`HybridCacheService.cs:330`), and `LocalCacheExpiration = ttl < localCeiling ? ttl : localCeiling`
    (`HybridCacheService.cs:335`), so a long-lived entry does not sit in another replica's memory for
    its whole TTL after an invalidation that process never saw.
- **Why it's built this way**:
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) is the record. Opt-in
  rather than default keeps the release non-breaking: a host that never calls `AddCommonHybridCache`
  gets a byte-identical registration to before, and a memory-only host would gain nothing from an L1 in
  front of an L1 anyway
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:114-120`). The
  registration deliberately uses `RemoveAll` + `Add` rather than `TryAdd` so it wins in either call
  order (`DependencyInjection.Caching.cs:165-168`), with the honest warning that `RemoveAll` does not
  distinguish the framework's registration from a host's own custom
  [ICacheService](#icacheservice) (`DependencyInjection.Caching.cs:129-134`). `[Rubric §29, Resilience]`
  shows up in the fail-soft read: the cache is an optimization, never the system of record, so an
  unreadable entry costs a database round trip rather than a failed request.
- **Where it's used**: registered only by `AddCommonHybridCache`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:141-184`), which all
  seven deployed service hosts reach through `AddCommonHybridCacheWhenRedisConfigured`, the guard that
  calls it only when the `redis` connection string is configured
  (`DependencyInjection.Caching.cs:201-213`): `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:204`,
  `MMCA.ADC.Engagement.Service/Program.cs:116`, `MMCA.ADC.Identity.Service/Program.cs:138`,
  `MMCA.ADC.Notification.Service/Program.cs:119`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:108`,
  `MMCA.Store.Sales.Service/Program.cs:113`, `MMCA.Store.Identity.Service/Program.cs:102`. Everything
  downstream still talks to [ICacheService](#icacheservice) and is unaware. Covered by
  [HybridCacheServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup), the
  registration semantics by
  [AddCommonHybridCacheTests](group-28-testing-infrastructure.md#per-project-test-rollup), and the
  storage format against a real Redis by
  [HybridCacheServiceRedisTests](group-28-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: replica L1 staleness after an invalidation is bounded by the local
  expiration (30 seconds by default, `Cache:LocalCacheDuration` to change it), not by the eviction,
  because only the evicting process's L1 is cleared (`HybridCacheService.cs:29-34`). That is the
  accepted cost of the L1 hit rate, and it is the same order as the 5-second delayed re-invalidation
  [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
  already performs
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:45`
  and `:81`). It does not apply to counters or to reads made through `GetFromSharedStoreAsync`
  (single-use records, the registration counter read, the lockout flag and the soft-deleted-user
  marker), which never touch L1; a caller that reads a single-use record through plain `GetAsync` instead still gets
  the L1 window, so the protection depends on the call site choosing the right member. `TryGetAsync`
  is not overridden here, so it uses the [ICacheService](#icacheservice) null-inference default.
  Because the keyspaces are disjoint, a host that switches substrate starts cold: entries
  another [ICacheService](#icacheservice) implementation wrote are invisible here and age out on their
  own TTL, which ADR-077 records as a cost rather than a correctness problem
  (`077-hybridcache-substrate.md:61-65`).

### MemoryCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:19` · Level 4 · class (internal sealed)

- **What it is**: the in-process implementation of [ICacheService](#icacheservice), backed by
  `IMemoryCache`. Because `IMemoryCache` exposes no way to enumerate its keys, this service maintains
  its own `ConcurrentDictionary<string, object>` tracking table so it can honor `RemoveByPrefixAsync`,
  the one capability the BCL memory cache lacks. The cache and that table are two structures that have
  to agree, so every mutation of a key runs under that key's lock stripe
  (`MemoryCacheService.cs:9-18`).
- **Depends on**: `IMemoryCache` / `MemoryCacheEntryOptions` and `ConcurrentDictionary<TKey, TValue>`
  (both BCL), [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from
  `MMCA.Common.Shared.Concurrency` (`MemoryCacheService.cs:5`, `:45`) for the per-key mutual exclusion,
  and the optional [CacheSettings](group-09-caching.md#cachesettings) (`MemoryCacheService.cs:19`,
  `:25`) for the default TTL. Implements [ICacheService](#icacheservice) and overrides `TryGetAsync`
  but **none** of the other default members, so it inherits the non-atomic `IncrementAsync`, the
  stripe-plus-double-check `GetOrCreateAsync` and the `GetAsync`-backed `GetFromSharedStoreAsync`
  (exact here, since there is no shared store beyond this process). It takes no
  [CacheKeyNamespace](#cachekeynamespace).
- **Concept introduced, a shadow index to back-fill a missing API.** `[Rubric §12, Performance &
  Scalability]` assesses cheap reads and sound invalidation; an in-process cache is the lowest-latency
  option available but is *not shared* across instances, so it is correct for a single-process monolith
  or for genuinely per-instance data and wrong for anything else. The teachable mechanic is the shadow
  index: `IMemoryCache` is a black box with no key listing, so the service mirrors every live key into
  `_keys` and keeps that mirror honest with a **post-eviction callback**, so an entry that expires or
  is dropped under memory pressure prunes its own tracking record instead of leaking. `[Rubric §12,
  Performance & Scalability]`: it presents the identical [ICacheService](#icacheservice) surface as the
  distributed adapters, so swapping backends changes nothing for callers. **Second concept, an
  invariant that write ordering cannot buy you.** `[Rubric §15, Best Practices & Code Quality]` assesses
  everyday craftsmanship, including whether comments explain *why* rather than *what*. The `SetAsync`
  remarks (`MemoryCacheService.cs:67-75`) are the worked example: with two structures to update,
  track-then-write lets a concurrent removal drop the tracking record between the two steps, and
  write-then-track lets a removal run entirely between them; both leave a live entry nothing can find.
  Neither order closes the window, so the class buys the invariant with mutual exclusion instead, and
  says so in the code rather than leaving the next reader to rediscover it.
- **Walkthrough**: primary constructor injection (`MemoryCacheService.cs:19`), `IMemoryCache cache`
  required and `IOptions<CacheSettings>? settings = null` optional.
  - `_settings` (`MemoryCacheService.cs:25`), the bound `Cache` section or `new CacheSettings()` when a
    host built the service without one. It supplies the expiration of an entry written without one, as
    every other store does (`MemoryCacheService.cs:21-24`).
  - `_keys` (`MemoryCacheService.cs:38`), `new ConcurrentDictionary<string,
    object>(StringComparer.Ordinal)`. The value is **load-bearing**: it is the tracking token of the
    cache entry the record belongs to, a plain `object` compared by reference
    (`MemoryCacheService.cs:27-37`). It exists so a post-eviction callback, which necessarily runs
    after its own entry may already have been superseded, can remove only its OWN record and never the
    record of a newer live entry. `Ordinal` comparison matches the ordinal prefix test below.
  - `_keyLocks` (`MemoryCacheService.cs:45`), a
    [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) serializing the paired mutation of
    the cache and `_keys` for one key. It is **per instance rather than static**
    (`MemoryCacheService.cs:40-44`): the tracking table belongs to this service instance, so two
    instances have nothing to serialize against each other.
  - `GetAsync<T>` (`MemoryCacheService.cs:48-59`), calls `cache.TryGetValue(key, out var stored)` and
    then **type-checks the stored object** with `stored is T typed` (`MemoryCacheService.cs:53`) before
    returning it, wrapped in `Task.FromResult` (there is no real async work; `IMemoryCache` is
    synchronous). It takes no lock: it touches only the cache. The pattern match is deliberate
    (`MemoryCacheService.cs:50-52`): the generic `TryGetValue<T>` overload performs an unchecked
    `(T)stored` cast and throws `InvalidCastException` when a key is reused under a different `T`, so
    matching on the stored object turns a type mismatch (or a stored null) into a clean miss.
  - `TryGetAsync<T>` (`MemoryCacheService.cs:62-64`), an **override** of the
    [ICacheService](#icacheservice) default with the same type-checked lookup, returning `(true,
    typed)` on a match and `(false, default)` otherwise. Presence comes from `TryGetValue` itself, so a
    cached `0` or `false` is a hit, which is what lets the inherited `GetOrCreateAsync` cache a
    value-type `default(T)` instead of re-running its factory.
  - `SetAsync<T>` (`MemoryCacheService.cs:76-116`), the method that establishes the invariant the class
    rests on. It builds `MemoryCacheEntryOptions` with `AbsoluteExpirationRelativeToNow = expiration ??
    _settings.DefaultDuration` (`MemoryCacheService.cs:82-85`), so an entry written without a TTL
    expires on the configured default exactly as on the distributed paths. It mints this entry's
    identity, `var token = new object()` (`MemoryCacheService.cs:88`), and registers the post-eviction
    callback (`MemoryCacheService.cs:103-109`) with that token as the callback **state**. The callback
    body **skips `EvictionReason.Replaced`** (`MemoryCacheService.cs:106`) and removes through the
    `KeyValuePair` overload, `_keys.TryRemove(new KeyValuePair<string, object>(evictedKey.ToString()!,
    state!))` (`MemoryCacheService.cs:107`), which deletes the record only while the tracked value is
    still this entry's own token. The comment (`MemoryCacheService.cs:90-102`) explains the shape: the
    callback stays deliberately **lock-free** because `IMemoryCache` queues it to the thread pool, and
    waiting on a stripe from a pool thread would stall the pool behind whichever caller holds it;
    running lock-free means it can land when the key already carries a newer live entry, so the token
    check is what stops it untracking an entry that is still cached (live but invisible to
    `RemoveByPrefixAsync`, clearable only by its TTL). Only then does the write happen, under the key's
    stripe: `using (await _keyLocks.AcquireAsync(key, cancellationToken)...)`
    (`MemoryCacheService.cs:111`), `cache.Set(key, value, options)` (`MemoryCacheService.cs:113`),
    `_keys[key] = token` (`MemoryCacheService.cs:114`).
  - `RemoveAsync` (`MemoryCacheService.cs:120-127`), the same stripe and the same order
    (`MemoryCacheService.cs:119`): acquire (`:122`), `cache.Remove` (`:124`), then `_keys.TryRemove(key,
    out _)` (`:125`).
  - `RemoveByPrefixAsync` (`MemoryCacheService.cs:138-148`), iterates `_keys.Keys.Where(k =>
    k.StartsWith(prefix, StringComparison.Ordinal))` (`MemoryCacheService.cs:140`) and removes each key
    from both stores under its own stripe (`MemoryCacheService.cs:142-146`). Two details from the
    remarks (`MemoryCacheService.cs:130-137`): the candidate list is a **snapshot**, because
    `ConcurrentDictionary.Keys` already copies, so it is enumerated outside every lock; and each stripe
    is released before the next one is taken, never accumulated across the loop, because distinct keys
    can map to the same stripe and to different stripes in a different relative order, so holding
    several at once would let two prefix removals block on each other and deadlock. This is what lets
    the in-process backend satisfy the same prefix-eviction contract Redis gets from SCAN.
- **Why it's built this way**: a parallel key index is the only way to give `IMemoryCache` a
  prefix-removal capability without replacing it, and the two guards on the callback (skip `Replaced`,
  and match the token) are what keep that index from drifting in either direction: a naive key set
  would accumulate phantom keys as entries expired, while a naive callback would delete records for
  entries that are still live. The stripe then covers what neither guard can, the window between the
  two writes that any single-threaded reading of the code hides. Striping rather than a semaphore per
  key is a bounded-memory choice made once in
  [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) and reused here. Taking
  [CacheSettings](group-09-caching.md#cachesettings) gives all three stores one TTL policy, so a
  caller's omitted expiration means the same thing whichever adapter the host resolved. The class is
  `internal sealed` because it is only ever resolved through the [ICacheService](#icacheservice)
  registration.
- **Where it's used**: the fallback branch of `AddCaching()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:77-79`), which
  passes the optional `IOptions<CacheSettings>` (`DependencyInjection.Caching.cs:79`). `AddCaching()`
  always calls `AddMemoryCache()` first (`DependencyInjection.Caching.cs:28`), so when no real
  distributed cache is registered this is the [ICacheService](#icacheservice) the container hands out,
  and a host with no Redis behaves as a single-instance cached monolith with the full interface intact.
  Consumed through the interface by both CQRS caching decorators,
  [LoginProtectionService](group-08-auth.md#loginprotectionservice),
  [PasswordResetTokenService](group-08-auth.md#passwordresettokenservice),
  [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) and
  [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter). Unit-tested by
  [MemoryCacheServiceTests](group-28-testing-infrastructure.md#per-project-test-rollup), which pins the
  default-TTL behavior
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:26`), the
  value-type `GetOrCreateAsync` miss that depends on `TryGetAsync` (`MemoryCacheServiceTests.cs:40`),
  and the concurrency behavior deterministically rather than racing for it: the test takes the key's
  own stripe first, then asserts that a `SetAsync` and a `RemoveByPrefixAsync` both park on it
  (`MemoryCacheServiceTests.cs:218`) and that `RemoveAsync` waits on the same stripe as `SetAsync`
  (`MemoryCacheServiceTests.cs:251`).
- **Caveats / not-in-source**: the cache is per-process, so two replicas hold independent and
  potentially divergent copies until each entry's TTL or an explicit eviction reconciles them. That is
  why the distributed adapters exist for scaled-out deployments, and why
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) lists per-replica memory
  mode as a trade-off rather than a supported multi-replica posture
  (`026-caching-strategy.md:163`). `_keys` is unbounded in the sense that only eviction prunes it, so a
  cache key embedding a high-cardinality value grows the table alongside the cache itself. Two limits
  of the locking are worth knowing: the stripe is per service instance, so the invariant holds for the
  singleton the container registers and not across two hand-constructed instances sharing one
  `IMemoryCache`; and `RemoveByPrefixAsync` works from a snapshot, so a key written after the snapshot
  is taken is simply not a candidate for that call. Finally, the per-key stripe and the tracking token
  are documented only in the source comments cited above, not in a decision record.


---
[⬅ Authentication & Authorization](group-08-auth.md)  •  [Index](00-index.md)  •  [Notifications (Push + In-App Inbox + Email) ➡](group-10-notifications.md)
