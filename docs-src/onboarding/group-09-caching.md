# 9. Caching

**What this group covers.** Caching in this codebase is small, deliberate, and woven into the CQRS
pipeline rather than scattered across handlers. The group is six types: one port the Application layer
depends on ([`ICacheService`](#icacheservice)), two Infrastructure adapters that implement it
([`MemoryCacheService`](#memorycacheservice) and [`DistributedCacheService`](#distributedcacheservice)),
a static TTL-policy factory ([`CacheOptions`](#cacheoptions)), and the optional key-namespace pair
([`CacheKeyPrefixOptions`](#cachekeyprefixoptions) plus its internal applier
[`CacheKeyNamespace`](#cachekeynamespace)) that keeps two services sharing one Redis instance out of
each other's keyspace. No handler ever talks to Redis or `IMemoryCache` directly: the read-through and
invalidate-on-write behavior lives in two pipeline decorators taught in
[Group 5, CQRS Pipeline](group-05-cqrs-pipeline.md). This chapter is the cache's own machinery, the
contract, the two backends, the TTL policy, and the namespace, plus how they plug into that pipeline.

**The contract.** [`ICacheService`](#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:8`) is a textbook Clean
Architecture port/adapter split (see [primer §1](00-primer.md#1-the-big-picture)): the interface lives
in `MMCA.Common.Application`, both implementations live in `MMCA.Common.Infrastructure`, and
application code compiles against the interface alone. It declares five members. Four are abstract:
`GetAsync<T>` returning `T?` with `null` for a miss (`ICacheService.cs:15`), `SetAsync<T>` with an
optional `TimeSpan?` TTL (`ICacheService.cs:24`), `RemoveAsync` for one key (`ICacheService.cs:34`),
and `RemoveByPrefixAsync` for bulk eviction by key prefix (`ICacheService.cs:40`). The fifth,
`IncrementAsync` (`ICacheService.cs:57`), is a **default interface member**: it ships a working
read-modify-write body (`ICacheService.cs:59-62`) so adding it broke no implementer, and it exists to
give the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) brute-force and rate-limit counters a single entry point instead of scattering
get-then-set pairs. `RemoveByPrefixAsync` is the load-bearing one: it is what lets a single write evict
every cached read it could have staled, and it is why both backends had to be built rather than used
off the shelf (`IMemoryCache` has no key enumeration, `IDistributedCache` has no prefix delete).
`[Rubric §3, Clean Architecture]` assesses whether dependencies point inward and infrastructure stays
replaceable; this is that rule in one file, since the only thing Application knows about caching is
five method signatures.

**Backend selection happens once, at the composition root.** `AddCaching(IConfiguration?)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:149`, called from
`AddInfrastructure` at `DependencyInjection.cs:111`) always calls `AddMemoryCache()`
(`DependencyInjection.cs:151`), binds the `Cache` section to
[`CacheKeyPrefixOptions`](#cachekeyprefixoptions) when configuration was supplied
(`DependencyInjection.cs:157`), then registers [`ICacheService`](#icacheservice) through
`TryAddSingleton` with a factory that probes the container (`DependencyInjection.cs:160-174`). If an
`IDistributedCache` is registered **and it is not the default `MemoryDistributedCache`**
(`DependencyInjection.cs:163`), meaning a real out-of-process store such as the Redis cache Aspire
wires, the factory builds a [`DistributedCacheService`](#distributedcacheservice) with whatever
`IConnectionMultiplexer` and `ILogger` it can resolve plus the bound key namespace
(`DependencyInjection.cs:165-169`); otherwise it falls back to a
[`MemoryCacheService`](#memorycacheservice) over the registered `IMemoryCache`
(`DependencyInjection.cs:173`). A single-process monolith therefore caches in-process for free, and the
identical application code uses Redis the moment a distributed cache is present: no flag, no
per-environment branch in a handler. This is the same "abstraction in Application, transport chosen at
the edge" extension point the message bus and gRPC clients use, which is what
`[Rubric §7, Microservices Readiness]` looks for (can a module move to its own process without a code
change) and part of what `[Rubric §12, Performance & Scalability]` rewards (the scaled-out deployment
gets a shared cache without touching business code).

**The in-process adapter.** [`MemoryCacheService`](#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:12`) wraps
`IMemoryCache` and carries one side structure: a `ConcurrentDictionary<string, byte>` of live keys
(`MemoryCacheService.cs:19`), because `IMemoryCache` cannot enumerate its own keys and without that
shadow index `RemoveByPrefixAsync` (`MemoryCacheService.cs:79-85`) would be impossible. Two details
keep the index honest. `SetAsync` registers a post-eviction callback that removes the tracking record
on eviction but **deliberately skips `EvictionReason.Replaced`** (`MemoryCacheService.cs:55-59`):
`IMemoryCache` queues those callbacks to the thread pool, so an overwrite fires the old entry's
callback asynchronously and it could land after the replacement was tracked, leaving an entry that is
live in the cache but invisible to prefix eviction and clearable only by its TTL. And the key is
tracked *before* the value is written (`MemoryCacheService.cs:63-64`), so a concurrent
`RemoveByPrefixAsync` can never observe a cached entry that is not yet in the table. `GetAsync` also
matches on the stored object rather than using the generic `TryGetValue<T>` overload
(`MemoryCacheService.cs:27`), so a key reused under a different `T` surfaces as a clean miss instead of
an `InvalidCastException`.

**The out-of-process adapter.** [`DistributedCacheService`](#distributedcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:17`)
serializes values to UTF-8 JSON via `System.Text.Json` (`DistributedCacheService.cs:130-134`) and
stores them through `IDistributedCache`. Prefix eviction is where it earns its keep: when an
`IConnectionMultiplexer` is available it runs a Redis `SCAN` over
`server.KeysAsync(pattern: "{qualified prefix}*")` and deletes the matches in batches of
`DeleteBatchSize` = 512 (`DistributedCacheService.cs:24`, `DistributedCacheService.cs:84-99`), one
round trip per batch rather than one per key, so a large invalidation does not stall the mutating
command that triggered it. When no multiplexer is registered, prefix eviction cannot run at all, and
rather than failing silently the class logs a warning **once** (guarded by an `Interlocked.Exchange`
flag at `DistributedCacheService.cs:57` and `DistributedCacheService.cs:72`) naming the fix
(`AddRedisClient`), because a permanently dead invalidation is a steady state that must not flood the
log on every command; the anomalous "multiplexer with no servers" case logs every time
(`DistributedCacheService.cs:78-81`). Both messages are compile-time `LoggerMessage` sources
(`DistributedCacheService.cs:136-140`). That warn-once-versus-warn-always split is a small but real
`[Rubric §13, Observability & Operability]` decision: §13 assesses whether an operator can tell what
the system is doing, and a cache whose invalidation quietly does nothing is exactly the failure mode
that hides from dashboards. The class also **overrides** `IncrementAsync`
(`DistributedCacheService.cs:122-128`) while keeping the same non-atomic read-modify-write shape, and
the long comment above it (`DistributedCacheService.cs:104-121`) is worth reading: Redis `INCR` would
be atomic but writes a Redis *string*, while `StackExchangeRedisCache` stores every entry as a Redis
*hash*, so an `INCR`-written counter makes the next read fail with `WRONGTYPE`. Readability of the
counter wins over atomicity, and [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the resulting undercount as an accepted position, not
an open defect.

**The key namespace.** [`CacheKeyPrefixOptions`](#cachekeyprefixoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28`) binds the `Cache`
configuration section (`CacheKeyPrefix.cs:31`) and carries one setting, `KeyPrefix`, defaulting to
empty (`CacheKeyPrefix.cs:37`). [`CacheKeyNamespace`](#cachekeynamespace) (`CacheKeyPrefix.cs:41`) is
the internal applier: a `None` instance for the untouched case (`CacheKeyPrefix.cs:44`), a `From`
factory that tolerates an unregistered options section (`CacheKeyPrefix.cs:50-54`), and `Qualify`
(`CacheKeyPrefix.cs:57`) which prepends the prefix. Only
[`DistributedCacheService`](#distributedcacheservice) honors it, and it applies the prefix *inside* the
adapter (`DistributedCacheService.cs:30`, then at every call site: `DistributedCacheService.cs:35`,
`:49`, `:54`, `:84`) rather than through Redis `RedisCacheOptions.InstanceName`. The rationale in the
source (`CacheKeyPrefix.cs:14-22`) is precise: `InstanceName` is prepended *below* this abstraction,
where the SCAN cannot see it, so prefix eviction would search for `product:*` while the stored keys
were `svc:product:*` and evict nothing, silently.
[`MemoryCacheService`](#memorycacheservice) ignores prefixes entirely because a per-process keyspace is
private by construction (`CacheKeyPrefix.cs:23-26`).

**The TTL policy.** [`CacheOptions`](#cacheoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9`) is a static factory so
neither adapter nor any caller hand-builds expiry options. `DefaultExpiration` is a deliberately short
**30-second** absolute window (`CacheOptions.cs:14-17`) and `Create(TimeSpan?)` returns the caller's
TTL or that default when the argument is `null` (`CacheOptions.cs:24-27`). The short default is a
staleness guard: caching is opt-in and conservative, and a read earns a longer life only by asking for
one. Only [`DistributedCacheService`](#distributedcacheservice) routes through it
(`DistributedCacheService.cs:49`); [`MemoryCacheService`](#memorycacheservice) builds its
`MemoryCacheEntryOptions` inline and applies an expiration only when the caller supplied one
(`MemoryCacheService.cs:42-47`), so the 30-second floor is distributed-cache policy, not a universal
one. Centralizing TTL rather than sprinkling `TimeSpan.FromSeconds(30)` through handlers is the
`[Rubric §10, Cross-Cutting]` habit this framework applies everywhere: one policy object, many call
sites.

**How it fires at runtime.** Nothing above runs unless a use case opts in, via two marker interfaces
consumed by the CQRS decorator pipeline (`FeatureGate → Logging → Caching → Validating →
Transactional → Handler` for commands, `FeatureGate → Logging → Caching → Handler` for queries;
registered at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:95` and
`DependencyInjection.cs:100`, taught in [Group 5](group-05-cqrs-pipeline.md)). On the **read** path,
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
tests the query for [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) and passes straight
through when it is absent
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:23-24`).
When present it takes a lock-free fast path on a hit (`CachingQueryDecorator.cs:27-30`); on a miss it
acquires a per-key stripe from the process-wide
[`QueryCacheKeyLocks`](group-05-cqrs-pipeline.md#querycachekeylocks)
(`CachingQueryDecorator.cs:35`, `CachingQueryDecorator.cs:77-81`), re-checks the cache, and only then
runs the inner handler, so one expired hot key produces one handler execution per process instead of a
stampede. The lock table is a fixed-width
[`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`, 256 stripes by
default at `KeyedSemaphoreStripe.cs:25`), which bounds memory no matter how many parameterized cache
keys the process sees. Results are stored only when they are not a failed
[`Result`](group-01-result-error-handling.md#result) (`CachingQueryDecorator.cs:45-49`), so error
states never enter the cache. On the **write** path,
[`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
runs the inner handler first and then, only if the command implements
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) **and** the result is not a
failure, calls `RemoveByPrefixAsync(command.CachePrefix)`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:23-30`).
Because the Caching decorator sits outside the Transactional one, eviction runs after the transaction
committed: against persisted state, never in-flight state, and never at all when the write failed.

**Two tiers, not one.** These six types are only **Tier 1** of the caching story that
[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records. Tier 2 is a separate
HTTP output-cache edge: `MMCA.Common.API` always calls `app.UseOutputCache()` in the shared middleware
pipeline (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:104`)
but ships no policies, so each host opts in with its own `AddOutputCache(...)`. Most services declare a
`NoCache` base policy; the read-heavy public services (ADC Conference, Store Catalog) declare real
cacheable policies through
[`OutputCacheOptionsExtensions`](group-12-api-hosting-mapping.md#outputcacheoptionsextensions)`.AddPublicEndpointPolicy`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:20`), backed
by [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy),
which caches GET/HEAD regardless of an `Authorization` header
([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
Both adopters back that edge with Redis when Redis is configured
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:129`,
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:88`), so the two tiers ride the same
Redis instance from opposite ends: Tier 1 through `IDistributedCache`, Tier 2 through the output-cache
store. Tier 2 belongs to [Group 12, API Hosting](group-12-api-hosting-mapping.md); it is named here
only so you do not confuse the two when you meet `[OutputCache]` on a controller.

**Adoption reality, so you read the code with the right expectations.** Prefix invalidation against
Redis is live in the deployed services: all seven service hosts register `AddRedisClient("redis")`
immediately alongside `AddRedisDistributedCache("redis")` inside the same connection-string conditional
(for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:113` and `:118`,
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:73` and `:78`), precisely so the
multiplexer the SCAN needs is present. Write-side adoption is broad (dozens of commands across ADC
Conference, Store Catalog and Sales, Store and ADC Identity, and Helpdesk Tickets implement
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)), but read-side adoption is not:
ADC's [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`,
key at `:26-35`, a 30-second `CacheDuration` at `:38`) is the only production
[`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) implementation in the workspace, so most
of the invalidation traffic currently evicts entries no query wrote. The other production consumer of
this substrate is not a decorator at all: `LoginProtectionService`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:20`) injects
[`ICacheService`](#icacheservice) and calls `IncrementAsync` for its brute-force and rate-limit counters
(`LoginProtectionService.cs:75`, `LoginProtectionService.cs:130`), covered in
[Group 8, Authentication & Authorization](group-08-auth.md). Two honest caveats round this out. First,
no host in the workspace sets `Cache:KeyPrefix` today, so
[`CacheKeyNamespace`](#cachekeynamespace) resolves to `None` everywhere and the feature is available
rather than exercised. Second, the stampede lock is per process
(`CachingQueryDecorator.cs:70-75`): across replicas over a shared Redis you get at most one handler
execution per replica, not one cluster-wide, which is deliberate (a distributed lock is not attempted)
and harmless because the duplicated writes carry equal content.

**What the cache is not.** This is a request-result read-through cache for query handlers plus a
counter store, not a session store and not a write-behind buffer; cross-source consistency in this
codebase is the outbox's job
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), not the cache's. The
short default TTL and the two failure-skipping rules (never cache a failed result, never invalidate on
a failed command) mean the layer errs toward correctness over hit rate, which is the right default for
an opt-in cache bolted onto a database-per-service system. The unit tests for these types, including
the Redis-backed `DistributedCacheServiceRedisTests`, are catalogued in
[Group 27, Testing & Quality Infrastructure](group-27-testing-infrastructure.md).

### CacheKeyPrefixOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28` · Level 0 · class (public sealed, options)

- **What it is**: the bound options object for one setting, `Cache:KeyPrefix`, the namespace prepended to every cache key written through [DistributedCacheService](#distributedcacheservice). It exists so several services sharing one Redis instance cannot read each other's entries by accidentally choosing the same key.
- **Depends on**: nothing first-party. It is a plain options POCO bound by `Microsoft.Extensions.Options` / `IConfiguration` (BCL). Its value is turned into behavior by [CacheKeyNamespace](#cachekeynamespace), which is what [DistributedCacheService](#distributedcacheservice) actually holds.
- **Concept introduced, keyspace isolation for a shared cache** `[Rubric §7, Microservices Readiness]`. §7 assesses whether a module keeps working, and keeps its data to itself, once it is lifted into its own process next to its siblings. A cache instance is exactly the kind of shared infrastructure that survives extraction unchanged, so the isolation that a private process gave you for free has to be re-created explicitly: the class doc (lines 5-12) states the failure mode plainly, two services that pick the same key for different data will serve each other's values. Giving each service a prefix such as `"conference:"` restores the separation. `[Rubric §11, Security]`, §11 assesses whether the system prevents data reaching a caller who should not see it; a cross-service key collision is a data-exposure bug wearing a performance-feature costume, and this option is the control that prevents it.
- **Walkthrough**
  - `SectionName` (line 31), `const string` = `"Cache"`. This is the configuration section, so the setting a host writes is `Cache:KeyPrefix`.
  - `KeyPrefix` (line 37), `string` with `{ get; init; }` and a default of `string.Empty`. Empty is the deliberate default: it leaves keys exactly as callers wrote them, which is the correct behavior for a host that owns its cache outright and does not share it.
- **Why it's built this way**: the class remarks (lines 13-27) record the decision that makes this type necessary rather than redundant. Redis has a built-in equivalent, `RedisCacheOptions.InstanceName`, and it was rejected: `InstanceName` is prepended by `IDistributedCache` *below* this framework's abstraction, where prefix invalidation cannot see it. The SCAN in [DistributedCacheService.RemoveByPrefixAsync](#distributedcacheservice) matches raw Redis keys, so it would search for `product:*` while the stored keys were `svc:product:*` and evict nothing, silently. Applying the prefix inside the adapter instead keeps get, set, remove and prefix eviction all working from one key shape. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)'s 2026-07-24 revision records the same reasoning.
- **Where it's used**: bound in `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:157`) via `services.Configure<CacheKeyPrefixOptions>(configuration.GetSection(CacheKeyPrefixOptions.SectionName))`, and only when a non-null `IConfiguration` was passed. `AddInfrastructure` always passes one (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:111`), so a host that composes through the normal entry point gets the binding; a test calling the parameterless `AddCaching()` overload does not. The bound options are then read once, at `ICacheService` construction, through [CacheKeyNamespace.From](#cachekeynamespace) (`DependencyInjection.cs:168`).
- **Caveats / not-in-source**: only the distributed path honors the prefix. [MemoryCacheService](#memorycacheservice) never sees it, because a per-process keyspace is private by construction and a prefix would add nothing (class remarks, lines 23-26). Also worth knowing before you go looking for a live example: no checked-in `appsettings*.json` in the four repos sets `Cache:KeyPrefix`, so the effective prefix everywhere today is the empty default, and the option is a capability that is wired but not yet exercised.

---

### CacheOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9` · Level 0 · class (public static)

- **What it is**: a static factory for `DistributedCacheEntryOptions` carrying a 30-second default TTL. It centralises the cache-expiry policy so the distributed-cache adapter never constructs entry options inline.
- **Depends on**: `Microsoft.Extensions.Caching.Distributed.DistributedCacheEntryOptions` (ASP.NET Core, NuGet). Indirectly fed by the per-query [IQueryCacheable](group-05-cqrs-pipeline.md#iquerycacheable) `CacheDuration`, which arrives as the `expiration` argument when a cacheable query's result is stored.
- **Concept introduced, TTL as the freshness dial** `[Rubric §12, Performance & Scalability]`. §12 assesses whether the system bounds staleness and avoids unbounded growth. The deliberately short 30-second default (lines 14-17) is the conservative knob: a cached read is served for at most 30 seconds before falling through to the source, so a query that never declares its own duration cannot serve dangerously stale data. Callers that can tolerate more staleness widen the window per query via `IQueryCacheable.CacheDuration`. `[Rubric §10, Cross-Cutting Concerns]`, §10 assesses whether concerns like caching, logging and validation live in one place instead of being re-decided per handler; TTL policy here is one property in one file rather than a `TimeSpan.FromSeconds(30)` scattered through call sites.
- **Walkthrough**
  - `DefaultExpiration` (lines 14-17), a property returning a *fresh* `DistributedCacheEntryOptions` on each access, with `AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30)`. It is a property, not a shared static field, so two callers can never alias and mutate the same options instance.
  - `Create(TimeSpan? expiration)` (lines 24-27), expression-bodied: returns a new options object with the caller's `AbsoluteExpirationRelativeToNow` when `expiration` is non-null, otherwise hands back `DefaultExpiration`. A null duration therefore reads as "use the 30s default", which is exactly the meaning of the optional `TimeSpan?` on [ICacheService](#icacheservice).`SetAsync`.
- **Why it's built this way**: a static factory (no instance, no shared mutable state) makes TTL policy a single, allocation-cheap decision point. Choosing *absolute* expiration over sliding means an entry's lifetime is bounded no matter how often it is read, which is the safer default for read-through query caching: a hot key cannot keep itself alive indefinitely on stale data. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the short default as the backstop that lets prefix invalidation be best-effort without the system becoming incorrect.
- **Where it's used**: exactly one production call site, [DistributedCacheService](#distributedcacheservice)`.SetAsync`, which calls `CacheOptions.Create(expiration)` to build the entry options for every write (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:49`). [MemoryCacheService](#memorycacheservice) does **not** route through this factory; it builds `MemoryCacheEntryOptions` directly, so this governs the distributed path only. Unit-tested by `CacheOptionsTests` ([Group 25, Testing Infrastructure](group-27-testing-infrastructure.md#cacheoptionstests)).
- **Caveats / not-in-source**: do not read the 30 seconds as a universal cache floor. Because [MemoryCacheService](#memorycacheservice) bypasses this factory, an in-process entry set with a null TTL has no time-based expiry at all and leaves only capacity pressure or an explicit removal to clear it.

---

### ICacheService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:8` · Level 0 · interface

- **What it is**: the Application layer's cache port. Get by key, set with an optional TTL, remove by exact key, remove every key matching a prefix, and increment a counter. It hides whether the backing store is Redis, a SQL distributed cache, or an in-process `IMemoryCache`.
- **Depends on**: BCL only at the interface level (`Task`, `CancellationToken`, `TimeSpan?`). Implemented by [MemoryCacheService](#memorycacheservice) and [DistributedCacheService](#distributedcacheservice). Consumed by the two CQRS caching decorators alongside their marker interfaces [IQueryCacheable](group-05-cqrs-pipeline.md#iquerycacheable) (key-based read-through) and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (prefix eviction after a mutation), and directly by [LoginProtectionService](group-08-auth.md#loginprotectionservice).
- **Concept introduced, dependency inversion for infrastructure** `[Rubric §3, Clean Architecture]`. §3 assesses whether business code depends on abstractions while concrete technology sits at the edges. The Application layer *defines* this contract; the Infrastructure layer *implements* it. Handlers, decorators and `LoginProtectionService` never see `StackExchange.Redis` or `Microsoft.Extensions.Caching`; they program against this interface and the container decides which adapter they get. `[Rubric §12, Performance & Scalability]`, `RemoveByPrefixAsync` (line 40) is the member that makes *scoped* invalidation possible: one mutation can evict a whole family of cached query results (every `Catalog:Products:*` page, say) without enumerating individual keys. **Second concept, the default interface member as a non-breaking extension point.** `IncrementAsync` (line 57) ships with a body. Any existing implementer keeps compiling and inherits working behavior, while a store with a better primitive can override. This is how the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) counters got a single entry point without a breaking change to a published package contract.
- **Walkthrough**: members in declaration order.
  - `Task<T?> GetAsync<T>(string key, CancellationToken)` (line 15), returns `default` / `null` on a miss; `T` is the deserialized value type.
  - `Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken)` (line 24). `expiration` defaults to `null`, meaning "use the implementation's default TTL"; the distributed adapter resolves that through [CacheOptions](#cacheoptions).
  - `Task RemoveAsync(string key, CancellationToken)` (line 34), single-key eviction.
  - `Task RemoveByPrefixAsync(string prefix, CancellationToken)` (line 40), bulk eviction of every key starting with `prefix`. This is what [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) invokes after a successful mutation.
  - `async Task<long> IncrementAsync(string key, TimeSpan expiration, CancellationToken)` (lines 57-63), a **default implementation** in the interface body: read the current value as `long?` (defaulting to 0 on a miss), add one, write it back with `expiration`, return the new value. The doc (lines 42-56) is explicit about why it exists at all: rate-limit and brute-force counters ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)) built from a raw `GetAsync` + `SetAsync` pair let concurrent requests overwrite each other's increments and undercount, so the read-modify-write is at least centralised here in one auditable place, and implementations with a native counter primitive can override.
- **Why it's built this way**: the optional `TimeSpan? expiration` lets callers override the global TTL without a second overload, and `null` reads naturally as "use the configured default". Keeping the port in `MMCA.Common.Application` rather than Infrastructure is what lets the CQRS decorators, which also live in Application, depend on caching without dragging a Redis reference into the business layers. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) owns the substrate decision; [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) owns the decorator ordering that consumes it.
- **Where it's used**: both caching decorators take `ICacheService` by constructor injection (the query decorator calls `GetAsync` / `SetAsync`, the command decorator calls `RemoveByPrefixAsync`). [LoginProtectionService](group-08-auth.md#loginprotectionservice) is the non-decorator consumer, calling `IncrementAsync` for failed logins and per-IP registrations (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:75` and `:130`), `SetAsync` for the lockout flag (`:89`), `GetAsync` for the registration count (`:109`) and `RemoveAsync` to clear both keys on a successful login (`:96-97`). Exactly one implementation is registered behind this interface, by `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:160-174`) via `TryAddSingleton`.
- **Caveats / not-in-source**: `IncrementAsync` is **not atomic** on either shipped implementation. The default body here is a read-modify-write, and [DistributedCacheService](#distributedcacheservice) overrides it with the same shape rather than Redis `INCR`, for a storage-format reason spelled out in that section. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the resulting undercount under genuinely concurrent increments as the accepted position, not an open defect.

---

### CacheKeyNamespace
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:41` · Level 1 · class (internal sealed)

- **What it is**: the tiny behavioral half of [CacheKeyPrefixOptions](#cachekeyprefixoptions). It holds a resolved prefix string and exposes one operation, `Qualify`, that turns a caller-supplied cache key into the key actually stored. Living in the same file as the options class (`CacheKeyPrefix.cs`) keeps the setting and its only interpretation together.
- **Depends on**: [CacheKeyPrefixOptions](#cachekeyprefixoptions) (only as the input to its `From` factory) and `Microsoft.Extensions.Options.IOptions<T>` (BCL). Consumed by [DistributedCacheService](#distributedcacheservice).
- **Concept introduced, the null object as a configuration default** `[Rubric §15, Best Practices & Code Quality]`. §15 assesses whether the code avoids incidental complexity and defensive noise. Rather than making every call site ask "is a prefix configured?", the unconfigured case is represented by a real instance, `None`, whose `Qualify` returns the key unchanged. There is one branch (line 58) instead of a null check at every use. `[Rubric §14, Testability]`, §14 assesses whether behavior can be exercised without standing up the world: because the type is a plain object that [DistributedCacheService](#distributedcacheservice) takes as an optional constructor parameter, a unit test can pass `new CacheKeyNamespace("svc:")` directly and assert on the qualified key with no configuration system involved (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:262`).
- **Walkthrough**: primary constructor `CacheKeyNamespace(string prefix)` (line 41).
  - `None` (line 44), a `static` property initialised to `new(string.Empty)`. One shared, immutable instance meaning "leave keys alone".
  - `Prefix` (line 47), get-only, initialised from the constructor parameter with `prefix ?? string.Empty`, so a null argument degrades to the no-op prefix rather than throwing later inside `string.Concat`.
  - `From(IOptions<CacheKeyPrefixOptions>? options)` (lines 50-54), the composition-root factory. It tolerates a **null options object** (the `?` is deliberate: `AddCaching()` resolves it with `GetService`, not `GetRequiredService`, so an unbound `Cache` section yields null), reads `options?.Value.KeyPrefix`, and returns `None` when that is null or empty, otherwise a new instance. Both "no configuration section" and "section present but empty prefix" therefore land on the same no-op path.
  - `Qualify(string key)` (lines 57-58), expression-bodied: returns `key` unchanged when `Prefix.Length == 0`, otherwise `string.Concat(Prefix, key)`. No separator is inserted, so the configured prefix must carry its own delimiter (`"conference:"`, not `"conference"`).
- **Why it's built this way**: `internal sealed` because it is an implementation detail of the Infrastructure caching adapter, never part of the package's public surface. The split between an `init`-only options POCO and this behavior object keeps the configuration contract (bindable, public) separate from the runtime helper (internal, immutable, allocation-free on the common path). Resolving the prefix once at `ICacheService` construction rather than per call also means the options are read a single time for the lifetime of the singleton.
- **Where it's used**: built once in `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:168`) and passed as the fourth constructor argument to [DistributedCacheService](#distributedcacheservice) (`:169`). Inside that adapter it is stored in the `_keys` field with a `?? CacheKeyNamespace.None` fallback (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:30`) and applied on every get, set, remove and SCAN pattern. The in-process branch of `AddCaching()` (`DependencyInjection.cs:173`) constructs [MemoryCacheService](#memorycacheservice) with no namespace at all.
- **Caveats / not-in-source**: because `Qualify` is applied inside the adapter and not by Redis, keys written by any code path that bypasses [ICacheService](#icacheservice) and talks to `IDistributedCache` directly would land unprefixed. Nothing in the framework does that today, but it is the invariant the design depends on.

---

### MemoryCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:18` · Level 1 · class (internal sealed)

- **What it is**: the in-process implementation of [ICacheService](#icacheservice), backed by `IMemoryCache`. Because `IMemoryCache` exposes no way to enumerate its keys, this service maintains its own `ConcurrentDictionary<string, object>` tracking table so it can honor `RemoveByPrefixAsync`, the one capability the BCL memory cache lacks. The cache and that table are two structures that have to agree, so every mutation of a key runs under that key's lock stripe (class doc, lines 8-17).
- **Depends on**: `Microsoft.Extensions.Caching.Memory.IMemoryCache` / `MemoryCacheEntryOptions` and `System.Collections.Concurrent.ConcurrentDictionary<TKey, TValue>` (both BCL), plus [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from `MMCA.Common.Shared.Concurrency` (using at line 4, field at line 38) for the per-key mutual exclusion. Implements [ICacheService](#icacheservice), and inherits its default `IncrementAsync` rather than overriding it.
- **Concept introduced, a shadow index to back-fill a missing API** `[Rubric §12, Performance & Scalability]`. §12 assesses cheap reads and sound invalidation; an in-process cache is the lowest-latency option available but is *not shared* across instances, so it is correct for a single-process monolith or for genuinely per-instance data and wrong for anything else. The teachable mechanic is the shadow index: `IMemoryCache` is a black box with no key listing, so the service mirrors every live key into `_keys` and keeps that mirror honest with a **post-eviction callback**, so an entry that expires or is dropped under memory pressure prunes its own tracking record instead of leaking. `[Rubric §10, Cross-Cutting Concerns]`, it presents the identical [ICacheService](#icacheservice) surface as the distributed adapter, so swapping backends changes nothing for callers. **Second concept, an invariant that write ordering cannot buy you** `[Rubric §15, Best Practices & Code Quality]`. §15 assesses everyday craftsmanship, including whether comments explain *why* rather than *what*. The `SetAsync` remarks (lines 55-63) are the worked example: with two structures to update, track-then-write lets a concurrent removal drop the tracking record between the two steps, and write-then-track lets a removal run entirely between them; both leave a live entry nothing can find. Neither order closes the window, so the class buys the invariant with mutual exclusion instead, and says so in the code rather than leaving the next reader to rediscover it.
- **Walkthrough**: primary constructor injection (line 18), `IMemoryCache cache`.
  - `_keys` (line 31), `new ConcurrentDictionary<string, object>(StringComparer.Ordinal)`. The value is **load-bearing**: it is the tracking token of the cache entry the record belongs to, a plain `object` compared by reference (field doc, lines 20-30). It exists so a post-eviction callback, which necessarily runs after its own entry may already have been superseded, can remove only its OWN record and never the record of a newer live entry. `Ordinal` comparison matches the ordinal prefix test below, avoiding culture-sensitive surprises.
  - `_keyLocks` (line 38), a [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) that serializes the paired mutation of the cache and `_keys` for one key. It is **per instance rather than static** (field doc, lines 33-37): the tracking table belongs to this service instance, so two instances have nothing to serialize against each other.
  - `GetAsync<T>` (lines 41-52), calls `cache.TryGetValue(key, out var stored)` and then **type-checks the stored object** with `stored is T typed` (line 46) before returning it, wrapped in `Task.FromResult` (there is no real async work; `IMemoryCache` is synchronous). It takes no lock: it touches only the cache. The pattern match is deliberate, and the comment at lines 43-45 says why: the generic `TryGetValue<T>` overload performs an unchecked `(T)stored` cast and throws `InvalidCastException` when a key is reused under a different `T`, so matching on the stored object turns a type mismatch (or a stored null) into a clean miss instead of an exception.
  - `SetAsync<T>` (lines 64-106), the method that establishes the invariant the class rests on. It builds `MemoryCacheEntryOptions` (line 70) and sets `AbsoluteExpirationRelativeToNow` **only when** `expiration.HasValue` (lines 72-75), so there is no 30-second floor on this path: an unset TTL means no time-based expiry, unlike the distributed path's [CacheOptions](#cacheoptions). It then mints this entry's identity, `var token = new object()` (line 78), and registers the post-eviction callback (lines 93-99) with that token as the callback **state**. The callback body (lines 94-98) does two things: it **skips `EvictionReason.Replaced`** (line 96), and it removes through the `KeyValuePair` overload, `_keys.TryRemove(new KeyValuePair<string, object>(evictedKey.ToString()!, state!))` (line 97), which deletes the record only while the tracked value is still this entry's own token. The comment at lines 80-92 explains the shape: the callback stays deliberately **lock-free** because `IMemoryCache` queues it to the thread pool, and waiting on a stripe from a pool thread would stall the pool behind whichever caller holds it; running lock-free means it can land when the key already carries a newer live entry, so the token check is what stops it untracking an entry that is still cached (live but invisible to `RemoveByPrefixAsync`, clearable only by its TTL). The `Replaced` skip keeps that common case cheap without depending on the callback's timing at all. Only then does the write happen, under the key's stripe: `using (await _keyLocks.AcquireAsync(key, cancellationToken)...)` (line 101), `cache.Set(key, value, options)` (line 103), `_keys[key] = token` (line 104). Cache first, table second, and every other mutating member takes the same lock in the same order. The remarks (lines 55-63) are explicit that the order is a convention for consistency, not the thing that makes it correct: mutual exclusion is.
  - `RemoveAsync` (lines 110-117), the same stripe and the same order (remarks, line 109): acquire (line 112), `cache.Remove` (line 114), then `_keys.TryRemove(key, out _)` (line 115).
  - `RemoveByPrefixAsync` (lines 128-138), iterates `_keys.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))` (line 130) and removes each key from both stores under its own stripe (lines 132-136). Two details from the remarks (lines 120-127): the candidate list is a **snapshot**, because `ConcurrentDictionary.Keys` already copies, so it is enumerated outside every lock; and each stripe is released before the next one is taken, never accumulated across the loop, because distinct keys can map to the same stripe (and to different stripes in a different relative order), so holding several at once would let two prefix removals block on each other and deadlock. This is what lets the in-process backend satisfy the same prefix-eviction contract Redis gets from SCAN.
- **Why it's built this way**: a parallel key index is the only way to give `IMemoryCache` a prefix-removal capability without replacing it, and the two guards on the callback (skip `Replaced`, and match the token) are what keep that index from drifting in either direction: a naive key set would accumulate phantom keys as entries expired, while a naive callback would delete records for entries that are still live. The stripe then covers what neither guard can, the window between the two writes that any single-threaded reading of the code hides. Striping rather than a semaphore per key is a bounded-memory choice made once in [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) and reused here. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)'s 2026-07-24 revision records the tracking dictionary and the `Replaced` exclusion as a correctness fix, not a micro-optimisation. The class is `internal sealed` because it is only ever resolved through the [ICacheService](#icacheservice) registration and never referenced by name outside Infrastructure.
- **Where it's used**: the fallback branch of `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:174`). `AddCaching()` always calls `AddMemoryCache()` first (`:152`), and when no real distributed cache is registered this is the `ICacheService` the container hands out, so a host with no Redis behaves as a single-instance cached monolith with the full interface intact. Consumed through the interface by both CQRS caching decorators and by [LoginProtectionService](group-08-auth.md#loginprotectionservice). Unit-tested by `MemoryCacheServiceTests` ([Group 25, Testing Infrastructure](group-27-testing-infrastructure.md#memorycacheservicetests)), which pins the concurrency behavior deterministically rather than racing for it: the test takes the key's own stripe first, then asserts that a `SetAsync` and a `RemoveByPrefixAsync` both park on it and that the entry ends up either gone or present **and** tracked (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:180`), and that `RemoveAsync` waits on the same stripe as `SetAsync` (`:213`).
- **Caveats / not-in-source**: the cache is per-process, so two replicas hold independent and potentially divergent copies until each entry's TTL or an explicit eviction reconciles them. That is exactly why the distributed adapter exists for scaled-out deployments, and why [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) lists per-replica memory mode as a trade-off rather than a supported multi-replica posture. `_keys` is unbounded in the sense that only eviction prunes it, so a cache key embedding a high-cardinality value grows the table alongside the cache itself. Two limits of the locking are worth knowing before you rely on it: the stripe is per service instance, so the invariant holds for the singleton the container registers and not across two hand-constructed instances sharing one `IMemoryCache`; and `RemoveByPrefixAsync` works from a snapshot, so a key written after the snapshot is taken is simply not a candidate for that call. Finally, ADR-026 does not describe the per-key stripe or the tracking token inside this service: its 2026-07-24 note about moving to a `KeyedSemaphoreStripe` is about the query-cache stampede lock, so the rationale for both lives in the source comments cited above rather than in a decision record.

---

### DistributedCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:18` · Level 2 · class (internal sealed partial)

- **What it is**: the out-of-process implementation of [ICacheService](#icacheservice), backed by ASP.NET Core's `IDistributedCache` (Redis in the deployed services, or a SQL Server distributed cache). Values cross the wire as UTF-8 JSON. Every key is namespaced through [CacheKeyNamespace](#cachekeynamespace), and prefix eviction is implemented with Redis SCAN when an `IConnectionMultiplexer` is available.
- **Depends on**: [ICacheService](#icacheservice) (implemented), [CacheKeyNamespace](#cachekeynamespace) (optional constructor parameter), [CacheOptions](#cacheoptions) (every write). Externals: `Microsoft.Extensions.Caching.Distributed.IDistributedCache`, `Microsoft.Extensions.Logging.ILogger<T>`, `System.Text.Json.JsonSerializer` (BCL) and `StackExchange.Redis.IConnectionMultiplexer` (NuGet, optional).
- **Concept introduced, reaching past an abstraction that cannot express what you need** `[Rubric §12, Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`. §7 assesses whether shared state survives a module moving into its own process: a *distributed* cache is shared across replicas and across extracted services, so cached reads stay coherent when a service scales out. The design point worth internalising is that `IDistributedCache` has **no key-enumeration API**; you cannot ask it for every key starting with X. This adapter therefore takes the optional raw `IConnectionMultiplexer` alongside the abstraction and uses server-side SCAN to satisfy `RemoveByPrefixAsync`, accepting a Redis-specific dependency for exactly one operation while every other operation stays store-agnostic. `[Rubric §13, Observability & Operability]`, §13 assesses whether the system makes its own degraded states visible: when the multiplexer is absent the class does not silently swallow the missed invalidation, it warns once (see the walkthrough), so a dead eviction path shows up in logs instead of as unexplained stale data.
- **Walkthrough**: primary constructor (lines 17-21), `IDistributedCache cache` and `ILogger<DistributedCacheService> logger` required, `IConnectionMultiplexer? connectionMultiplexer = null` and `CacheKeyNamespace? keyNamespace = null` optional. The class is `partial` so the `[LoggerMessage]` source generator can emit its log methods.
  - `DeleteBatchSize` (line 24), `const int` = `512`, the number of keys deleted per Redis round trip during prefix invalidation.
  - `_keys` (line 30), the resolved [CacheKeyNamespace](#cachekeynamespace), defaulting to `CacheKeyNamespace.None` when none was injected.
  - `GetAsync<T>` (lines 33-38), fetches the raw `byte[]` via `cache.GetAsync(_keys.Qualify(key), ...)`; returns `default` on a null (miss), else `Deserialize<T>`.
  - `SetAsync<T>` (lines 41-50), serializes the value to bytes and writes with `cache.SetAsync(_keys.Qualify(key), bytes, CacheOptions.Create(expiration), ...)` (line 49). That is the single call site turning the caller's optional `TimeSpan?` into a `DistributedCacheEntryOptions` through [CacheOptions](#cacheoptions).
  - `RemoveAsync` (lines 53-54), expression-bodied passthrough to `cache.RemoveAsync` on the qualified key.
  - `_noMultiplexerWarned` (line 57), an `int` flag flipped once via `Interlocked.Exchange` so the missing-multiplexer warning fires exactly once per process rather than on every mutating command.
  - `RemoveByPrefixAsync` (lines 65-100), the substantial method. If `connectionMultiplexer` is null (line 67) it logs the no-op once through `LogPrefixEvictionNoMultiplexer`, guarded by `Interlocked.Exchange(ref _noMultiplexerWarned, 1) == 0` (lines 72-73), and returns; entries then expire on TTL alone. If a multiplexer is present but reports no servers (lines 78-82) it logs `LogPrefixEvictionNoServer` with the prefix and returns, unguarded, because that state is anomalous rather than a steady state. Otherwise it takes the first server, issues `server.KeysAsync(pattern: $"{_keys.Qualify(prefix)}*")` (line 84, note the prefix is namespaced too, which is the whole reason the namespace lives here and not in `RedisCacheOptions.InstanceName`), and `await foreach`-accumulates matches into a `List<RedisKey>`. Each time the batch reaches `DeleteBatchSize` it flushes with `db.KeyDeleteAsync([.. batch])` and clears (lines 91-95), with a final flush for the remainder (lines 98-99). Enumeration honors the `CancellationToken` via `WithCancellation` (line 88).
  - `IncrementAsync` (lines 122-128), an **override** of the [ICacheService](#icacheservice) default that keeps the same read-modify-write shape: read as `long?`, add one, write back with the TTL. The remarks (lines 102-121) are the important read. Redis `INCR` would be atomic, which is what the member was added for, but `INCR` writes a Redis **string** while `StackExchangeRedisCache` stores every entry as a Redis **hash** (`absexp` / `sldexp` / `data`, read back with `HMGET`). Mixing the two at one key makes the next read fail with `WRONGTYPE`, which surfaces as a 500 on whatever endpoint owns the counter (registration and login, in the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) case). A counter has to live in the same storage format as the reads that consult it, so readability was chosen over atomicity.
  - `Deserialize<T>` / `Serialize<T>` (lines 130-134), private static JSON helpers: `SerializeToUtf8Bytes(value)` and `Deserialize<T>(bytes)!` (null-forgiving, since the BCL signature is nominally nullable).
  - `LogPrefixEvictionNoMultiplexer` / `LogPrefixEvictionNoServer` (lines 136-140), `[LoggerMessage]` `Warning`-level partial methods. The first message names the fix explicitly ("Register a Redis client (AddRedisClient) to enable prefix eviction"), which is the difference between a log line and an actionable one.
- **Why it's built this way**: UTF-8 JSON keeps cached payloads engine-agnostic and human-inspectable in a Redis client. The optional multiplexer is the pragmatic compromise the [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) / [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) extraction path demands: the cache contract must work whether the deployment has Redis (full prefix eviction) or only a fallback distributed store (single-key operations), so prefix eviction *degrades to a no-op* rather than throwing, and the 30-second TTL from [CacheOptions](#cacheoptions) becomes the staleness backstop. Warn-once is the observability guard-rail that keeps that degradation from being invisible without flooding the log. Batching deletes in blocks of 512 keeps a large invalidation from stalling the mutating command on one round trip per key. `internal sealed partial`: `partial` for the generated log methods, `internal sealed` because it is only resolved through the [ICacheService](#icacheservice) registration.
- **Where it's used**: selected by `AddCaching()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:160-174`). The `TryAddSingleton<ICacheService>` factory constructs this implementation **only when** an `IDistributedCache` is present and is not the default `MemoryDistributedCache` (line 163), resolving the optional `IConnectionMultiplexer` (`:165`), an `ILogger` with a `NullLogger` fallback (`:166-167`) and the [CacheKeyNamespace](#cachekeynamespace) (`:168`); otherwise it falls back to [MemoryCacheService](#memorycacheservice). Downstream it is consumed only through the interface, by [CachingQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) and [LoginProtectionService](group-08-auth.md#loginprotectionservice). Covered by `DistributedCacheServiceTests` and, against a real Redis, `DistributedCacheServiceRedisTests` ([Group 25, Testing Infrastructure](group-27-testing-infrastructure.md#distributedcacheservicetests)).
- **Caveats / not-in-source**: `KeysAsync` (SCAN) is O(keyspace) on the Redis side, fine at invalidation cadence but not a hot-path operation, and it targets only the *first* server returned by `GetServers()`, so a multi-node Redis cluster would need more than this. On the no-multiplexer branch, the earlier caveat that production ran without one is **no longer true**: all seven deployed services register `AddRedisClient("redis")` immediately after `AddRedisDistributedCache("redis")` under the same connection-string conditional (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:113` and `:118`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:73` and `:78`), so SCAN-based prefix eviction is live wherever Redis is configured, and the 30-second TTL is now the backstop only for memory mode. Finally, `IncrementAsync` here is not atomic (see the walkthrough); [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the possible undercount as accepted rather than outstanding.


---
[⬅ Authentication & Authorization](group-08-auth.md)  •  [Index](00-index.md)  •  [Notifications (Push + In-App Inbox + Email) ➡](group-10-notifications.md)
