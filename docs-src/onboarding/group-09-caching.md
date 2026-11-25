# 9. Caching

**What this group covers.** Caching in this codebase is small, deliberate, and woven into the CQRS
pipeline rather than scattered across handlers. The group is twelve types: one port the Application
layer depends on ([`ICacheService`](#icacheservice)), two Infrastructure adapters that implement it
(the in-process [`MemoryCacheService`](#memorycacheservice) and the two-level
[`HybridCacheService`](#hybridcacheservice), the one cache service over a shared Redis), the prefix
rule both adapters enforce ([`CachePrefixContract`](#cacheprefixcontract)), the generation-token
engine that lets the two-level cache invalidate a prefix without walking the keyspace
([`CachePrefixGenerations`](#cacheprefixgenerations) and its per-boundary
[`RememberedToken`](#rememberedtoken)), a static TTL-policy factory ([`CacheOptions`](#cacheoptions))
with the bound settings object that reproduces its defaults from configuration
([`CacheSettings`](#cachesettings)), the key-namespace pair
([`CacheKeyPrefixOptions`](#cachekeyprefixoptions) plus its internal applier
[`CacheKeyNamespace`](#cachekeynamespace)) that keeps two applications sharing one Redis instance out
of each other's keyspace by default, and the hook every framework Redis connection runs before it
connects ([`IRedisConfigurationOptionsConfigurator`](#iredisconfigurationoptionsconfigurator) and its
options-pipeline bridge
[`RedisConfigurationOptionsPostConfigure`](#redisconfigurationoptionspostconfigure)). No handler ever
talks to Redis or `IMemoryCache` directly: the read-through and invalidate-on-write behavior lives in
two pipeline decorators taught in [Group 5, CQRS Pipeline](group-05-cqrs-pipeline.md). This chapter
is the cache's own machinery, the contract, the two backends, the prefix rule and the generation
tokens, the TTL policy and its configuration object, the namespace and the connection hook, plus how
they plug into that pipeline.

**The contract.** [`ICacheService`](#icacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10`) is a textbook Clean
Architecture port/adapter split (see [primer §1](00-primer.md#1-the-big-picture)): the interface lives
in `MMCA.Common.Application`, both implementations live in `MMCA.Common.Infrastructure`, and
application code compiles against the interface alone. It declares eight members. Four are abstract:
`GetAsync<T>` returning `T?` with `null` for a miss (`ICacheService.cs:17`), `SetAsync<T>` with an
optional `TimeSpan?` TTL (`ICacheService.cs:79`), `RemoveAsync` for one key (`ICacheService.cs:89`),
and `RemoveByPrefixAsync` for bulk eviction by key prefix (`ICacheService.cs:113`). Four are **default
interface members** with working bodies, so each one shipped without breaking an implementer.
`TryGetAsync<T>` (`ICacheService.cs:34`) reports presence separately from the value, because for a
value-type `T` a `GetAsync` miss answers `default(T)` and cannot be told apart from a cached `0` or
`false` (`ICacheService.cs:19-23`); the default infers presence from a non-null value
(`ICacheService.cs:36-37`), and the shipped stores override it with a real presence check
(`ICacheService.cs:30-32`). `GetFromSharedStoreAsync<T>` (`ICacheService.cs:69`) reads past any
process-local copy, for values whose change on one replica must be visible on every other one at once
(`ICacheService.cs:40-46`): single-use records (an OAuth exchange code, a password-reset or
email-confirmation token, a second-factor time step), the counters `IncrementAsync` maintains, since a
store with a local tier increments in the shared store and a local copy would pin the first count it
saw (`ICacheService.cs:54-57`), and flags another replica can set or clear, the login lockout flag and
the soft-deleted-user marker (`ICacheService.cs:58-59`). Everything read many times stays on
`GetAsync` and loses only the local hit rate by coming here (`ICacheService.cs:59-61`);
the default simply calls `GetAsync`, which is exact for a store with no local tier
(`ICacheService.cs:64-66`). `IncrementAsync` (`ICacheService.cs:133`) is a read-modify-write counter
(`ICacheService.cs:135-138`) that gives the
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
brute-force and rate-limit counters one entry point instead of scattered get-then-set pairs; its doc
states plainly that it is not atomic in any shipped implementation (the default and
`HybridCacheService` both read then write, so concurrent increments can undercount,
`ICacheService.cs:115-120`) and that none overrides it with Redis `INCR`, because the distributed
cache stores entries as Redis hashes and an `INCR` string at the same key would fail the next read
with `WRONGTYPE` (`ICacheService.cs:126-132`); [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)
records the resulting undercount as an accepted position, not an open defect.
`GetOrCreateAsync<T>` (`ICacheService.cs:173`) folds read, per-key stripe, double-check, factory and
write into one call (`ICacheService.cs:178-199`), taking presence from `TryGetAsync` on both checks so
a cached `default(T)` counts as a hit (`ICacheService.cs:181-193`), using the process-wide
`CacheKeyLocks` table (`ICacheService.cs:217-221`), cross-referenced in
[Group 5](group-05-cqrs-pipeline.md#cachekeylocks). Its XML doc is explicit about two limits that
matter: it caches whatever the factory returned, failed [`Result`](group-01-result-error-handling.md#result)
included, which is exactly why the caching decorators do not route through it, and its stampede
protection is per process (`ICacheService.cs:154-171`). `RemoveByPrefixAsync` is the load-bearing member:
it is what lets a single write evict every cached read it could have staled. Its argument has a
contract: the prefix must be empty (every entry) or end at a `:` boundary, so `"MMCA.Sample.Event:"`
is accepted and `"MMCA.Sample.Ev"` is rejected with an `ArgumentException` (`ICacheService.cs:91-112`).
That boundary rule is what lets the two-level store invalidate with one write instead of enumerating
keys (`ICacheService.cs:101-105`), and the backends had to be built rather than used off the shelf
because neither primitive offers it (`IMemoryCache` has no key enumeration, and `HybridCache`'s tag
invalidation does not reach a replica that has already met the tag, as the generation-token section
below explains). [Rubric §3, Clean Architecture] assesses whether dependencies point inward and
infrastructure stays replaceable; this is that rule in one file, since the only thing Application knows
about caching is eight method signatures.

**Backend selection happens once, at the composition root, and refuses to guess.** `AddCaching(IConfiguration?)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:30`, called from
`AddInfrastructure` at `DependencyInjection.cs:141`) always calls `AddMemoryCache()`
(`DependencyInjection.Caching.cs:32`), then binds the shared `Cache` configuration section three ways when
configuration was supplied (`DependencyInjection.Caching.cs:44-57`): to
[`CacheKeyPrefixOptions`](#cachekeyprefixoptions) for the key namespace
(`DependencyInjection.Caching.cs:46`), to [`CacheSettings`](#cachesettings)
for the TTL policy, validated at start-up (`DependencyInjection.Caching.cs:48-51`), and to
[`QueryCachePipelineSettings`](group-14-module-system-composition.md#querycachepipelinesettings) for
the one knob the Application-layer query decorator needs (`DependencyInjection.Caching.cs:53-56`, defined in
that layer because it cannot reference Infrastructure). Without configuration both settings objects are
still registered at their defaults (`DependencyInjection.Caching.cs:58-62`), so `IOptions<T>` always resolves.
It also post-configures the Redis output-cache store, when one is registered, with the same key
namespace as its `InstanceName` unless a host set one, so two applications on one Redis do not share
output-cache entries or tag sets (`DependencyInjection.Caching.cs:64-77`).
[`ICacheService`](#icacheservice) itself is registered through `TryAddSingleton` with a factory
(`DependencyInjection.Caching.cs:79-99`) that has only one answer to give: a
[`MemoryCacheService`](#memorycacheservice) over the registered `IMemoryCache`, handed the bound cache
settings (`DependencyInjection.Caching.cs:96-98`). If the factory finds a real out-of-process
`IDistributedCache` registered (anything but the default `MemoryDistributedCache`), it throws an
`InvalidOperationException` that names `AddCommonHybridCache` and its guarded form instead
(`DependencyInjection.Caching.cs:86-93`), because falling back to the in-process cache would silently
make single-use records, counters and the lockout flag per-replica (`DependencyInjection.Caching.cs:81-85`).
A shared store is served by the two-level cache only. The same method registers the
[`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that the five in-framework callers
pair with the cache (the API idempotency filter, password-reset token redemption, the two-factor
authenticator, `OAuthControllerBase` when given a lock, and passkey challenges,
`DependencyInjection.Caching.cs:101-108`), [Redis-backed](group-14-module-system-composition.md#redisdistributedlock) when a
multiplexer is present and [process-local](group-14-module-system-composition.md#inprocessdistributedlock)
otherwise (`DependencyInjection.Caching.cs:109-123`). A single-process monolith therefore caches in-process for
free, and the identical application code uses Redis the moment the host wires it: no flag,
no per-environment branch in a handler. This is the same "abstraction in Application, transport chosen
at the edge" pattern the message bus and gRPC clients use, which is what [Rubric §7, Microservices
Readiness] looks for (can a module move to its own process without a code change) and part of what
[Rubric §12, Performance and Scalability] rewards (the scaled-out deployment gets a shared cache
without touching business code).

**The shared-store substrate is explicit.** `AddCommonHybridCache(Action<HybridCacheOptions>?)`
(`DependencyInjection.Caching.cs:162`) is required for, and intended for, hosts with a distributed
L2 (`DependencyInjection.Caching.cs:137-140`). It calls `AddHybridCache()`
(`DependencyInjection.Caching.cs:164`) and then configures `HybridCacheOptions` through the options
pipeline rather than through the `AddHybridCache` callback (`DependencyInjection.Caching.cs:170-184`),
because the TTL policy comes from the bound [`CacheSettings`](#cachesettings) and the callback has no
service provider to read it from; the framework sets `Expiration` from `DefaultDuration` and
`LocalCacheExpiration` from `LocalCacheDuration` (falling back to
`HybridCacheService.LocalCacheDefault`) at `DependencyInjection.Caching.cs:177-181`, and the host's own hook
runs last so it can override anything (`DependencyInjection.Caching.cs:183`). The swap of the cache
implementation is deliberately `RemoveAll<ICacheService>()` followed by `AddSingleton`
(`DependencyInjection.Caching.cs:186-205`) rather than `TryAdd`, so the call wins whether it runs before or
after `AddInfrastructure`; the source is equally explicit that this also removes a host's own bespoke
`ICacheService`, so calling it is a statement that the two-level cache is the cache
(`DependencyInjection.Caching.cs:150-153`). The factory hands the new service the optional
`IConnectionMultiplexer` that holds the generation tokens, the host's key namespace, the bound
settings and the cross-service namespace (`DependencyInjection.Caching.cs:189-204`). `AddCommonHybridCache`
has no guard of its own, so the framework also ships the guarded form,
`AddCommonHybridCacheWhenRedisConfigured(IConfiguration, string)` (`DependencyInjection.Caching.cs:226`),
which calls it only when the `redis` connection string (the default `connectionName`) is non-empty
(`DependencyInjection.Caching.cs:232-235`) and otherwise leaves the registration untouched. Service
hosts do not make these calls by hand: the composed start-up `AddMmcaServiceHost`
(`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:65`) runs
`AddRedisCaching()`, then `AddRedisOutputCaching()` when the host asks for it, then the guarded hybrid
call (`ServiceHostBuilderExtensions.cs:91-97`), and both deployed applications compose through it
(ADC Conference at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`, Store Catalog
at `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`). Without Redis the guard
declines and the host keeps the in-process substrate, which is the point: an L1 in front of an
in-process L2 buys nothing (`DependencyInjection.Caching.cs:215-217`,
[ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)).

**The in-process adapter.** [`MemoryCacheService`](#memorycacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:19`) wraps
`IMemoryCache`, takes the bound [`CacheSettings`](#cachesettings) (framework defaults when none is
passed, `MemoryCacheService.cs:25`) so an entry written without an expiration gets the same
`DefaultDuration` every other store applies (`MemoryCacheService.cs:84`), and carries one side structure: a `ConcurrentDictionary<string, object>` of live keys
(`MemoryCacheService.cs:38`), because `IMemoryCache` cannot enumerate its own keys and without that
shadow index `RemoveByPrefixAsync` (`MemoryCacheService.cs:144-148`) would be impossible. Keeping the
cache and the index in agreement is the whole design. Every mutation takes that key's stripe from a
per-instance [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe)
(`MemoryCacheService.cs:45`) and touches the cache before the table
(`MemoryCacheService.cs:111-115`), because ordering alone cannot close the window: track-then-write
lets a concurrent removal drop the record between the steps, and write-then-track lets a removal run
entirely between them, both leaving a live entry nothing can find. The post-eviction callback is
deliberately lock-free, since `IMemoryCache` queues it to the thread pool, and it removes the record
only while the record is still its own, comparing the entry token by reference and skipping
`EvictionReason.Replaced` outright (`MemoryCacheService.cs:103-109`). Prefix removal walks a snapshot
of the tracked keys and takes one stripe at a time, never accumulating handles, so two prefix removals
cannot deadlock on each other's stripes (`MemoryCacheService.cs:130-136`,
`MemoryCacheService.cs:154-164`). `GetAsync` also matches on the
stored object rather than using the generic `TryGetValue<T>` overload (`MemoryCacheService.cs:53`), so
a key reused under a different `T` surfaces as a clean miss instead of an `InvalidCastException`, and
it overrides `TryGetAsync` with the same type-matched lookup so presence is real rather than inferred
from a non-null value (`MemoryCacheService.cs:62-64`).

**One prefix rule, enforced by both stores.** [`CachePrefixContract`](#cacheprefixcontract)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixContract.cs:8`) is the
argument contract of `RemoveByPrefixAsync` in one internal static class: the boundary character `:`
(`CachePrefixContract.cs:11`) and `EnsureBoundary`, which throws `ArgumentNullException` for `null`
and `ArgumentException` for a non-empty prefix that does not end with it
(`CachePrefixContract.cs:17-27`). Both adapters call it first,
[`MemoryCacheService`](#memorycacheservice) at `MemoryCacheService.cs:146` and
[`HybridCacheService`](#hybridcacheservice) at `HybridCacheService.cs:335`. The in-process store could
honor a mid-segment prefix, and that is exactly why it checks anyway: a prefix only the in-process
store accepts would otherwise first fail in production on the two-level cache
(`MemoryCacheService.cs:137-141`). On the write path the caching command decorator treats that
exception as a bug in the command rather than a transient fault, logging it at Error and skipping the
delayed retry, which would fail identically
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:76-83`).

**Prefix invalidation by generation token.** [`CachePrefixGenerations`](#cacheprefixgenerations)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixGenerations.cs:69`) is how the
two-level cache evicts a prefix without walking the keyspace. Every invalidation boundary of a key, the
empty root and each prefix ending at a `:` (`A:B:C` yields `""`, `A:` and `A:B:`,
`CachePrefixGenerations.cs:240-259`), carries a generation token, and `SuffixAsync` folds the non-empty
tokens in force into the key the entry is stored under (`CachePrefixGenerations.cs:149-202`,
`CachePrefixGenerations.cs:264-272`), after a `|` separator (`CachePrefixGenerations.cs:79`). A key
whose boundaries were never invalidated keeps its plain shape (`CachePrefixGenerations.cs:141-143`).
`InvalidateAsync` (`CachePrefixGenerations.cs:217`) replaces one token, so every entry written under
the old token simply stops being addressed and expires on its own TTL
(`CachePrefixGenerations.cs:8-14`): one Redis write whatever the size of the keyspace. The source
records why this is not `HybridCache.RemoveByTagAsync`: in Microsoft.Extensions.Caching.Hybrid
10.11.0 each process reads a tag's invalidation timestamp once and never refreshes it, so a replica
that has already met the tag never learns of a later invalidation (`CachePrefixGenerations.cs:17-25`);
the Redis-tier `HybridCacheCrossInstanceInvalidationTests`
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Redis.Tests/HybridCacheCrossInstanceInvalidationTests.cs:22`)
pins the property this class provides instead. Tokens are 64 random bits, hex encoded
(`CachePrefixGenerations.cs:276`), not `INCR` counters, so concurrent invalidations need no atomicity
(`CachePrefixGenerations.cs:27-29`). They live under `{namespace}hcg:{prefix}`
(`CachePrefixGenerations.cs:76`, `CachePrefixGenerations.cs:281`), a segment disjoint from the cache
entries, with no TTL, so Redis holds one short string per distinct invalidated prefix
(`CachePrefixGenerations.cs:43-45`). Each process remembers the tokens it has seen as a
[`RememberedToken`](#rememberedtoken) (`CachePrefixGenerations.cs:417`), a private record struct of the
token, the tick count it must be refreshed after, a monotonic version stamp and whether this process
stored it by invalidating. A remembered token is reused without a read for one local cache duration,
then still served while one background read per boundary refreshes it
(`CachePrefixGenerations.cs:175-183`), for up to `RetentionMultiplier` = 10 local durations, five
minutes at the default (`CachePrefixGenerations.cs:81-86`); concurrent readers of one boundary share a
single in-flight read (`CachePrefixGenerations.cs:107-108`, `CachePrefixGenerations.cs:291-297`), and
long-expired entries are swept once per 1024 inserts (`CachePrefixGenerations.cs:92`,
`CachePrefixGenerations.cs:394-401`). The invalidating process adopts its new token locally before the
Redis write, so it stops serving the prefix even if the write fails
(`CachePrefixGenerations.cs:234-237`), and the version snapshot taken before any read means a read
that began before that invalidation can never put the old token back
(`CachePrefixGenerations.cs:167-169`, `CachePrefixGenerations.cs:387-392`). Another replica therefore
sees an invalidation within one local duration plus one refresh round trip
(`CachePrefixGenerations.cs:37-46`). The failure posture is spelled out too: a failed token read never
fails the cache call, it answers with the last token this process knew or the empty baseline
(`CachePrefixGenerations.cs:357-370`), and the baseline is deliberate, since the lockout flag, the
failure counters and the idempotency records sit under boundaries nobody invalidates, so lockout and
rate limits keep working on a cold replica during an outage; the cost, a cold replica addressing
pre-invalidation entries of an invalidated prefix during a partial outage, is stated beside it
(`CachePrefixGenerations.cs:52-67`), as is the matching caveat that a lost generation key brings back
only the baseline, never an older non-baseline token (`CachePrefixGenerations.cs:29-35`). Without a
multiplexer the tokens live in this process only (`CachePrefixGenerations.cs:110-111`), which is exact
for a single-process host, and the first such invalidation logs one warning naming `AddRedisCaching`
(`CachePrefixGenerations.cs:224-231`, `CachePrefixGenerations.cs:409`). That warn-once-versus-silent
choice is a small but real [Rubric §13, Observability and Operability] decision: an invalidation that
quietly reaches no other replica is exactly the failure mode that hides from dashboards. This is also
why `Cache:LocalCacheDuration`, when set, must be at least one second: it bounds how long a token is
reused, so zero would turn every cache call into a Redis read
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:42-47`).

**The two-level cache.** [`HybridCacheService`](#hybridcacheservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:55`) puts an
in-process L1 in front of the registered distributed L2 and lets the platform's `HybridCache` supply
serialization, L1 promotion and stampede protection. It builds its own
[`CachePrefixGenerations`](#cacheprefixgenerations) from the multiplexer, the namespace and the local
duration (`HybridCacheService.cs:167-171`). Its structural decision is the **disjoint
keyspace**: every key is written as `{prefix}hc:{key}` plus any generation suffix
(`HybridCacheService.cs:61`, `HybridCacheService.cs:440-449`), so an entry can never meet a value
another writer put on the same server, a host's own `IDistributedCache` use or the `hcg:` generation
keys, in a format it cannot parse (`HybridCacheService.cs:19-24`). `RemoveByPrefixAsync` checks the
boundary contract and replaces one generation token; nothing is scanned or deleted
(`HybridCacheService.cs:318-337`). Reads are fail-soft: a fault is logged,
answered as a miss, and the offending entry is dropped best-effort so the next write repopulates it
(`HybridCacheService.cs:183-202`, `HybridCacheService.cs:479-489`). Two members bypass L1 entirely,
and both share one options instance that disables the L1 read and the L1 write
(`SharedStoreReadOptions`, `HybridCacheService.cs:92-97`), because both are values whose correctness
depends on every replica seeing the same thing; the reasoning is a [Rubric §11, Security] point rather
than a performance one. `GetFromSharedStoreAsync` overrides the interface default so a single-use
record (an OAuth exchange code, a password-reset or email-confirmation token, the last accepted
second-factor time step) consumed on one replica is a miss on every other replica at once rather than
usable a second time for up to the local expiration (`HybridCacheService.cs:35-39`,
`HybridCacheService.cs:266-285`); it stays fail-soft like `GetAsync`, and for such a record a miss is a
refusal, the safe direction. The same path serves a counter read without an increment and the reads
whose correctness depends on seeing a removal at once, the login lockout flag and the
soft-deleted-user marker (`HybridCacheService.cs:40-46`). Its single-use callers are
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:332`),
[`PasswordResetTokenService`](group-08-auth.md#passwordresettokenservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:128`),
[`EmailConfirmationTokenService`](group-08-auth.md#emailconfirmationtokenservice)
(`.../Auth/EmailConfirmationTokenService.cs:95`) and
[`TwoFactorAuthenticator`](group-08-auth.md#twofactorauthenticator)
(`.../Auth/TwoFactor/TwoFactorAuthenticator.cs:197`); the others are
[`LoginProtectionService`](group-08-auth.md#loginprotectionservice) for the lockout flag and the
registration count (`.../Auth/LoginProtectionService.cs:82`, `LoginProtectionService.cs:213`) and
[`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:95`). That
last record is also the one key outside the host's namespace: a
[`CrossServiceCacheKeys`](group-05-cqrs-pipeline.md#crossservicecachekeys) key is qualified with the
cross-service namespace every service of a deployment shares and carries no generation suffix, so the
record Identity writes is the record every other service reads (`HybridCacheService.cs:48-53`,
`HybridCacheService.cs:442-445`).
`IncrementAsync` bypasses L1 on **both** legs
(`HybridCacheService.cs:362-383`): a counter cached per replica would let one process read its own
stale count and write it back, so a brute-force limiter could be held near its starting value
indefinitely by a steady stream of attempts against a single replica. Its faults are deliberately not
swallowed, unlike the reads, since a counter that silently reads zero resets the limit it exists to
enforce (`HybridCacheService.cs:357-360`). `TryGetAsync` is overridden too
(`HybridCacheService.cs:224-249`), because the interface default would report a value-type miss as
found and `HybridCache` has no presence-reporting read: presence is read from whether `HybridCache`
had to call the factory, which on a miss throws a `KeyNotFoundException` tagged with a private
marker (`HybridCacheService.cs:64`, `HybridCacheService.cs:420-425`) that the method catches as "not
found" (`HybridCacheService.cs:239-242`). A thrown sentinel rather than a flag the factory sets,
because a concurrent read of the key joins the first caller's in-flight lookup and never runs its own
factory, while the exception reaches every joined caller (`HybridCacheService.cs:207-215`). The probe
carries its own `PresenceProbeOptions` (`HybridCacheService.cs:106-109`), whose flags no other call
uses, since `HybridCache` joins only callers with identical flags and a `GetOrCreateAsync` in flight
on the same key must never be handed that miss (`HybridCacheService.cs:218-220`); faults stay
fail-soft as on `GetAsync` (`HybridCacheService.cs:243-248`). `GetOrCreateAsync` overrides
the interface default with `HybridCache`'s own implementation (`HybridCacheService.cs:394-413`).
Replica staleness after an invalidation is bounded by the local expiration, the shorter of the
entry's TTL and `Cache:LocalCacheDuration` (30 seconds by default,
`HybridCacheService.cs:71`, `HybridCacheService.cs:458-469`), the same window in which another replica
picks up a replaced generation token (`HybridCacheService.cs:26-32`), and the source names that as the
accepted cost of the L1 hit rate.

**The key namespace and the TTL policy.** [`CacheKeyPrefixOptions`](#cachekeyprefixoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:30`) binds the `Cache`
configuration section (`CacheKeyPrefix.cs:33`) and carries two settings. `KeyPrefix` still defaults
to empty (`CacheKeyPrefix.cs:45`), but empty does not mean "no prefix": it means take the
framework's per-application default, and a host sets the value explicitly only to pin a keyspace two
hosts of the same application must share (`CacheKeyPrefix.cs:35-40`). The reason is recorded on the
property itself: it used to default to no prefix at all, so two applications sharing one
Redis shared one keyspace for both cache entries and distributed locks, silently
(`CacheKeyPrefix.cs:41-44`). `CrossServiceKeyPrefix` (`CacheKeyPrefix.cs:55`) names the keyspace of
the cross-service records, defaulting to the token audience (`Jwt:Audience`), which every service
accepting the same tokens shares and two applications do not (`CacheKeyPrefix.cs:47-54`).
[`CacheKeyNamespace`](#cachekeynamespace) (`CacheKeyPrefix.cs:59`) is the internal applier. It keeps a
`None` instance for the untouched case (`CacheKeyPrefix.cs:65`) and an options-taking `From` overload
that tolerates an unregistered section (`CacheKeyPrefix.cs:71-75`), but the composition root calls the
container-taking overload (`CacheKeyPrefix.cs:85-100`), which returns the configured prefix when a host
set one (`CacheKeyPrefix.cs:89-93`) and otherwise builds `{application namespace}:` from
[`ApplicationNamespace.Resolve`](group-14-module-system-composition.md#applicationnamespace)
(`CacheKeyPrefix.cs:95-99`). That resolver reads `Application:Namespace`, falls back to the host's
application name, and falls back again to the literal `app`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:60-74`,
keys at `ApplicationNamespace.cs:38` and `ApplicationNamespace.cs:41`), so the resolved prefix is never
empty and isolation is automatic rather than opt-in. `CrossServiceFrom` resolves the second namespace
the same way: configured value, then the sanitized audience, then this host's own namespace
(`CacheKeyPrefix.cs:116-130`). `Qualify` (`CacheKeyPrefix.cs:133-134`) prepends a prefix. The same
namespace instance is handed to the Redis distributed lock registered beside the cache
(`DependencyInjection.Caching.cs:116-117`) and becomes the output-cache store's `InstanceName`
(`DependencyInjection.Caching.cs:70-77`), so one application's cache entries, generation keys, lock
keys and output-cache entries carry one prefix. The two-level cache applies it *inside* the adapter
rather than through `RedisCacheOptions.InstanceName`; the rationale in the source
(`CacheKeyPrefix.cs:16-24`) is precise, since `InstanceName` is prepended by `IDistributedCache` below
this abstraction, where the generation keys written directly to Redis would not carry it, so two
applications on one server would share invalidation tokens while keeping separate entries.
[`MemoryCacheService`](#memorycacheservice) ignores prefixes entirely because a per-process keyspace
is private by construction (`CacheKeyPrefix.cs:25-28`).
TTL policy is centralized the same way: [`CacheOptions`](#cacheoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:15`) exposes a
deliberately short **30-second** `DefaultDuration` (`CacheOptions.cs:23`) as a bare `TimeSpan`, so
implementations that do not speak `DistributedCacheEntryOptions` still default to the same policy, plus
`DefaultExpiration` (`CacheOptions.cs:28`) and `Create(TimeSpan?)` (`CacheOptions.cs:38`) for callers
that do. Those values are the hard-coded framework defaults and the single source of truth for the
configurable path as well: [`CacheSettings`](#cachesettings)
defaults `DefaultDuration` to `CacheOptions.DefaultDuration`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:34`), so a host that
configures nothing behaves exactly as it did before that section existed. The short default is a
staleness guard: caching is opt-in and conservative, and a read earns a longer life only by asking for
one. One policy object with many call sites is the [Rubric §12, Performance & Scalability] habit this framework
applies everywhere.

**One hook for every Redis connection.** [`IRedisConfigurationOptionsConfigurator`](#iredisconfigurationoptionsconfigurator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/IRedisConfigurationOptionsConfigurator.cs:30`)
has a single member, `Configure(ConfigurationOptions)` (`IRedisConfigurationOptionsConfigurator.cs:34`),
that adjusts the StackExchange.Redis options of a connection before it connects: a token credential, a
client certificate, a timeout (`IRedisConfigurationOptionsConfigurator.cs:5-9`). It reaches every Redis
connection the framework opens, the Redis client and the distributed cache over it, the output-cache
store, the SignalR backplane and the PING health check's own connection, each running every registered
configurator once on its own options instance parsed from the connection string
(`IRedisConfigurationOptionsConfigurator.cs:10-15`). It runs synchronously, may run more than once
per process, and throwing from it fails that connection, which is the place to reject a connection
string it cannot serve (`IRedisConfigurationOptionsConfigurator.cs:25-29`). With none registered every
connection is made from the connection string exactly as before
(`IRedisConfigurationOptionsConfigurator.cs:20-23`). Registration is
`AddRedisConfigurationOptionsConfigurator` (`DependencyInjection.Caching.cs:253`), idempotent per
configurator type (`DependencyInjection.Caching.cs:257`), and it also adds the bridge
[`RedisConfigurationOptionsPostConfigure`](#redisconfigurationoptionspostconfigure)
(`DependencyInjection.Caching.cs:259-261`;
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisConfigurationOptionsPostConfigure.cs:15`),
an `IPostConfigureOptions<ConfigurationOptions>` that runs every configurator on each options instance
the options system builds, for every name (`RedisConfigurationOptionsPostConfigure.cs:21-29`). The
bridge is what lets MMCA.Common.Aspire, which may not reference this package, reach the configurators:
both sides name only a StackExchange.Redis type and the options abstractions
(`RedisConfigurationOptionsPostConfigure.cs:6-13`). The shipped adapter is the Azure one, which
registers a configurator from its own call
(`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:252`), keeping the
vendor credential out of the core packages as
[ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html) requires.

**How it fires at runtime.** Nothing above runs unless a use case opts in, via two marker interfaces
consumed by the CQRS decorator pipeline (`ViewAs` then `FeatureGate` then `Authorization` then
`Logging` then `Caching` then `Validating` then `Timeout` then `Transactional` then handler for
commands, and the same chain without `ViewAs` and `Transactional` for queries; the order is documented at
`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:77-101`, Authorization sits
outside Caching so a denied request neither reads nor populates the cache
(`DependencyInjection.cs:110-112`), and the two caching decorators are registered at
`DependencyInjection.cs:155` and `DependencyInjection.cs:164`, taught in
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
`Timeout.InfiniteTimeSpan` on [`CacheSettings`](#cachesettings) at `CacheSettings.cs:62`): when a
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
and the result is not a failure, invalidates the tenant-scoped prefix with `CancellationToken.None`
(`.../Decorators/CachingCommandDecorator.cs:59-75`); a prefix that breaks the boundary contract is
logged at Error and not retried (`CachingCommandDecorator.cs:76-83`), and any other fault is logged
without failing the committed command (`CachingCommandDecorator.cs:84-89`). It then schedules a
second invalidation five seconds later (`CachingCommandDecorator.cs:45`, `CachingCommandDecorator.cs:97`,
`CachingCommandDecorator.cs:107-112`) to catch a read that began before the commit and repopulated the
entry with pre-write state. Because the Caching decorator sits outside the Transactional one, eviction
runs after the transaction committed: against persisted state, never in-flight state, and never at all
when the write failed.

**Two tiers, not one.** These twelve types are only **Tier 1** of the caching story that
[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records. Tier 2 is a separate
HTTP output-cache edge: `MMCA.Common.API` always runs `app.UseOutputCache()` as a named step in the
shared middleware pipeline
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:139-141`, see
[`MiddlewarePipelineBuilder`](group-12-api-hosting-mapping.md#middlewarepipelinebuilder)) but ships no
policies, so each host opts in with its own output-cache configuration. The read-heavy public services
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
Both adopters back that edge with Redis by setting `UseRedisOutputCaching`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:129`;
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:53`), which the composed host turns
into `AddRedisOutputCaching()` (`ServiceHostBuilderExtensions.cs:92-95`), so the two tiers ride the same
Redis instance from opposite ends: Tier 1 through `HybridCache`, Tier 2 through
the output-cache store. There is **no third tier on the client**: ADR-026 records that the optional
client-side read cache was removed in MMCA.Common v1.301.0, so a UI service read in
[`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
is a plain GET through the retry pipeline, `SendGetAsync<T>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:226`), and any
client-side memoization is an application decision that belongs to
[Group 15, Common UI Framework](group-15-common-ui-framework.md). Tier 2 belongs to
[Group 12, API Hosting](group-12-api-hosting-mapping.md); both are named here only so you do not
confuse them with Tier 1 when you meet `[OutputCache]` on a controller.

**Adoption reality, so you read the code with the right expectations.** Prefix invalidation against
Redis is live in the deployed services: the composed host registers the Aspire Redis integration
through [`RedisCachingExtensions`](group-16-aspire-orchestration.md#rediscachingextensions), whose
`AddRedisCaching()` brings the `IConnectionMultiplexer` the generation tokens live on along with the
distributed cache, and then the hybrid substrate through the framework's connection-string guard
(`ServiceHostBuilderExtensions.cs:91-97`). Write-side adoption is
broad: about forty types across ADC's Conference, Engagement and Identity modules implement
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), for example
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:18`
with its aggregate-scoped `CachePrefix` at `:21`. Read-side adoption is not: no ADC query implements
[`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable). Its one hot public read,
[`GetNowNextQuery`](group-18-conference-application.md#getnownextquery), opts out on purpose and
relies on a Redis-backed output-cache policy instead
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:10-12`), so
the write-side query-cache invalidation currently replaces tokens for prefixes no ADC query wrote under. The substrate's other production
consumers are not decorators at all:
[`LoginProtectionService`](group-08-auth.md#loginprotectionservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:38`) injects
[`ICacheService`](#icacheservice) for its brute-force and rate-limit counters
(`LoginProtectionService.cs:140`, `LoginProtectionService.cs:242`), reading the lockout flag and the
registration count back through `GetFromSharedStoreAsync` (`LoginProtectionService.cs:82`,
`LoginProtectionService.cs:213`), covered in
[Group 8, Authentication and Authorization](group-08-auth.md), the password-reset and
email-confirmation token services, which count requests through `IncrementAsync`
(`PasswordResetTokenService.cs:68`, `EmailConfirmationTokenService.cs:58`) and redeem their single-use
records through `GetFromSharedStoreAsync` as described above, and
[`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) resolves it per request to
store and replay responses
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:141`). The key
namespace is live in both deployed applications, and the two pin it differently. ADC's services share
one keyspace: `Cache:KeyPrefix` is `adc:` alongside `Application:Namespace` `adc`, pinned to exactly
what the namespace resolves to so a host rename cannot move it
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:53-62`, rationale at `:45-52`
and `:56-59`). Store goes the other way: its services share `Application:Namespace` `store` for the
broker topics but keep separate Redis keyspaces, so Catalog pins `store-catalog:`
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/appsettings.json:39-44`, rationale at `:29-38`),
a value the per-application default would not have produced.
[`CacheKeyNamespace.None`](#cachekeynamespace) is therefore only the constructor fallback the adapter
uses when no namespace is passed, not the deployed state. Two honest caveats round this out. The stampede
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
fail-open by design (`CacheSettings.cs:12-17`): no value there can turn a cache outage or a slow
populate into an error. The unit tests for these types, including the Redis-backed
[`HybridCacheServiceRedisTests`](group-29-testing-infrastructure.md#per-project-test-rollup)
and [`HybridCacheCrossInstanceInvalidationTests`](group-29-testing-infrastructure.md#per-project-test-rollup),
are catalogued in [Group 27, Testing and Quality Infrastructure](group-29-testing-infrastructure.md).

### CacheKeyPrefixOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:30` · Level 0 · class (public sealed, options)

- **What it is**: the bound options object for two settings in the `Cache` section. `Cache:KeyPrefix` is
  the namespace prepended to every cache key written through [HybridCacheService](#hybridcacheservice),
  to the Redis distributed lock and to the Redis output-cache store; `Cache:CrossServiceKeyPrefix` is
  the namespace of the few keys one service writes and another reads. It exists so several
  applications sharing one Redis instance cannot read each other's entries by accidentally choosing
  the same key. Leaving either unset does not mean "no prefix": the empty value is a signal to fall
  back to a framework default (`CacheKeyPrefix.cs:35-45`, `:47-55`).
- **Depends on**: nothing first-party for the options object itself; it is a plain POCO bound by
  `Microsoft.Extensions.Options` / `IConfiguration` (BCL). Its values are turned into behavior by
  [CacheKeyNamespace](#cachekeynamespace), which is what the cache adapters actually hold, and which
  falls back to [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace) when
  `KeyPrefix` is unset (`CacheKeyPrefix.cs:95-99`) and to the token audience when
  `CrossServiceKeyPrefix` is unset (`CacheKeyPrefix.cs:126-129`).
- **Concept introduced, keyspace isolation for a shared cache, on by default.** `[Rubric §7,
  Microservices Readiness]` assesses whether a module keeps working, and keeps its data to itself, once
  it is lifted into its own process next to its siblings. A cache instance is exactly the kind of
  shared infrastructure that survives extraction unchanged, so the isolation a private process gave you
  for free has to be re-created explicitly. Set `KeyPrefix` explicitly to pin a shared keyspace across
  hosts of the *same* application, or leave it unset and let
  [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace) derive a distinct
  keyspace per application automatically. `[Rubric §11, Security]` assesses whether the system prevents
  data reaching a caller who should not see it; SEC-Common-53 (`CacheKeyPrefix.cs:41-44`) records that
  this option used to default to no prefix at all, so two applications sharing one Redis silently shared
  one keyspace for both cache entries and distributed locks. Isolation is now automatic rather than
  opt-in. The second setting handles the opposite need: a record such as the soft-deleted-user marker
  ([CrossServiceCacheKeys](group-05-cqrs-pipeline.md#crossservicecachekeys)) must be addressed
  identically by every service of one deployment even though each service has its own `KeyPrefix`.
- **Walkthrough**
  - `SectionName` (`CacheKeyPrefix.cs:33`), `const string` = `"Cache"`. The same section carries the
    TTL policy ([CacheSettings](#cachesettings)) and the query pipeline's populate-lock knob
    ([QueryCachePipelineSettings](group-14-module-system-composition.md#querycachepipelinesettings)),
    all three bound side by side in `AddCaching`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:44-62`).
  - `KeyPrefix` (`CacheKeyPrefix.cs:45`, doc at `CacheKeyPrefix.cs:35-44`), `string` with
    `{ get; init; }` and a default of `string.Empty`. An empty value tells
    [CacheKeyNamespace](#cachekeynamespace)`.From(IServiceProvider)` to resolve the per-application
    default (`"{application namespace}:"`). Setting it explicitly is for the narrower case, pinning a
    keyspace two hosts of the *same* application must share.
  - `CrossServiceKeyPrefix` (`CacheKeyPrefix.cs:55`, doc at `CacheKeyPrefix.cs:47-54`), `string`,
    default `string.Empty`. Empty means "use the token audience (`Jwt:Audience`)", which every service
    accepting the same tokens shares and two applications do not, falling back to the host's own
    namespace when no audience is configured. The doc is explicit that a value set here must be the
    SAME on every service of the deployment (`CacheKeyPrefix.cs:52-53`).
- **Why it's built this way**: the class remarks (`CacheKeyPrefix.cs:16-28`) record why this type
  exists rather than Redis's built-in `RedisCacheOptions.InstanceName`: `InstanceName` is prepended by
  `IDistributedCache` *below* this framework's abstraction, where the cache adapter cannot see it, so
  applying the prefix inside the adapter keeps get, set, remove and prefix invalidation working from one
  key shape. [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the same
  reasoning (`026-caching-strategy.md:420-421`). The output-cache store is the one place
  `InstanceName` is safe, because that store prefixes its value and tag keys itself; `AddCaching`
  therefore post-configures `RedisOutputCacheOptions.InstanceName` from the same namespace unless a host
  set one (`DependencyInjection.Caching.cs:64-77`).
- **Where it's used**: bound in `AddCaching()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:46`) via
  `services.Configure<CacheKeyPrefixOptions>(configuration.GetSection(CacheKeyPrefixOptions.SectionName))`,
  and only when a non-null `IConfiguration` was passed (`DependencyInjection.Caching.cs:44`).
  `AddInfrastructure` always passes one
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:141`), so a host composing
  through the normal entry point gets the binding; a test calling the parameterless `AddCaching()`
  overload does not. The bound options are read through
  [CacheKeyNamespace](#cachekeynamespace): `From(IServiceProvider)` at the output-cache post-configure
  (`DependencyInjection.Caching.cs:75`), the Redis lock factory (`DependencyInjection.Caching.cs:116`)
  and the hybrid cache factory (`DependencyInjection.Caching.cs:194`), and `CrossServiceFrom` once, for
  the hybrid cache's cross-service namespace (`DependencyInjection.Caching.cs:204`).
- **Caveats / not-in-source**: [MemoryCacheService](#memorycacheservice) never sees either prefix,
  because a per-process keyspace is private by construction (`CacheKeyPrefix.cs:25-28`,
  `DependencyInjection.Caching.cs:95`). Because the empty default resolves through
  [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace), every host that
  never sets `Cache:KeyPrefix` still gets a non-empty, per-application prefix at runtime.

### CacheOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheOptions.cs:15` · Level 0 · class (public static)

- **What it is**: the framework's hard-coded TTL default in one place. It exposes the default cache
  lifetime both as a bare `TimeSpan` and as a ready-made `DistributedCacheEntryOptions`, so no store
  and no caller re-types the number.
- **Depends on**: `Microsoft.Extensions.Caching.Distributed.DistributedCacheEntryOptions` (ASP.NET
  Core, NuGet). It is the seed value for [CacheSettings](#cachesettings)`.DefaultDuration`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:34`), and it is
  indirectly fed by the per-query [IQueryCacheable](group-05-cqrs-pipeline.md#iquerycacheable)
  `CacheDuration`, which arrives as the `expiration` argument when a cacheable query's result is
  stored.
- **Concept introduced, TTL as the freshness dial.** `[Rubric §12, Performance & Scalability]` assesses
  whether the system bounds staleness and avoids unbounded growth. The deliberately short 30-second
  default (`CacheOptions.cs:23`) is the conservative knob: a cached read is served for at most 30
  seconds before falling through to the source, so a query that never declares its own duration cannot
  serve dangerously stale data. Callers that can tolerate more staleness widen the window per query.
  The same category also asks whether concerns like caching live in one place instead of being
  re-decided per handler; TTL policy here is one property in one file rather than a
  `TimeSpan.FromSeconds(30)` scattered through call sites.
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
    `DefaultExpiration`. A null duration therefore reads as "use the 30s default", the same meaning as
    the optional `TimeSpan?` on [ICacheService](#icacheservice)`.SetAsync`.
- **Why it's built this way**: a static class (no instance, no shared mutable state) makes the default a
  single, allocation-cheap decision point. Choosing *absolute* expiration over sliding means an entry's
  lifetime is bounded no matter how often it is read, which is the safer default for read-through query
  caching: a hot key cannot keep itself alive indefinitely on stale data. The class remarks
  (`CacheOptions.cs:9-14`) name the split: these are the framework defaults and the source of truth for
  the values, while per-host tuning goes through the bindable `Cache` section
  ([CacheSettings](#cachesettings)), whose every property defaults to what this class exposes so the
  configured and hard-coded paths cannot drift.
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the short default as
  the backstop behind best-effort invalidation (`026-caching-strategy.md:42`).
- **Where it's used**: `DefaultDuration` seeds [CacheSettings](#cachesettings)`.DefaultDuration`
  (`CacheSettings.cs:34`), which is what both shipped stores actually read at runtime
  ([HybridCacheService](#hybridcacheservice) at `HybridCacheService.cs:460`,
  [MemoryCacheService](#memorycacheservice) at `MemoryCacheService.cs:84`). Unit-tested by
  [CacheOptionsTests](group-29-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: neither shipped store builds `DistributedCacheEntryOptions`, so
  `Create` and `DefaultExpiration` have no first-party production caller; they remain on the published
  package surface and are exercised only by tests (`CacheOptionsTests.cs`, `CacheSettingsTests.cs`).

### CachePrefixContract
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixContract.cs:8` · Level 0 · class (internal static)

- **What it is**: the argument contract of [ICacheService](#icacheservice)`.RemoveByPrefixAsync` as
  one guard method: a prefix is either empty (every entry) or ends at a `:` boundary
  (`CachePrefixContract.cs:3-7`).
- **Depends on**: BCL only (`ArgumentNullException`, `ArgumentException`).
- **Concept introduced, one contract enforced identically by every backend.** `[Rubric §15, Best
  Practices & Code Quality]` assesses whether behavior is predictable rather than incidental. The
  two-level store can only invalidate at `:` boundaries (see
  [CachePrefixGenerations](#cacheprefixgenerations)); the in-process store could honor any prefix.
  Checking the same rule in both means a prefix that only one store could serve fails in a unit test
  against the memory cache rather than first in production on the two-level cache
  (`MemoryCacheService.cs:137-141`).
- **Walkthrough**
  - `Boundary` (`CachePrefixContract.cs:11`), `internal const char` = `':'`.
  - `EnsureBoundary(string prefix)` (`CachePrefixContract.cs:17-27`): null-checks the prefix
    (`:19`), then throws `ArgumentException` when it is non-empty and its last character is not
    `Boundary` (`:21-26`), with a message giving `'MMCA.Sample.Event:'` as the expected shape.
- **Why it's built this way**: the interface documents the rule (`ICacheService.cs:92-112`), but a
  documented rule is only uniform if one piece of code enforces it; a shared `internal static` guard
  keeps the two stores from drifting.
- **Where it's used**: the first statement of `RemoveByPrefixAsync` in
  [HybridCacheService](#hybridcacheservice) (`HybridCacheService.cs:335`) and
  [MemoryCacheService](#memorycacheservice) (`MemoryCacheService.cs:146`).

### IRedisConfigurationOptionsConfigurator
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/IRedisConfigurationOptionsConfigurator.cs:30` · Level 0 · interface

- **What it is**: an extension point that adjusts the StackExchange.Redis `ConfigurationOptions` of
  every Redis connection the framework opens, before it connects: a token credential, a client
  certificate, a timeout (`IRedisConfigurationOptionsConfigurator.cs:5-9`).
- **Depends on**: `StackExchange.Redis.ConfigurationOptions` (NuGet). Bridged into the options pipeline
  by [RedisConfigurationOptionsPostConfigure](#redisconfigurationoptionspostconfigure).
- **Concept introduced, a vendor-neutral hook for vendor-specific connection auth.** `[Rubric §7,
  Microservices Readiness]` assesses whether infrastructure choices stay at the edges. The core package
  names only a StackExchange.Redis type; an adapter package (for example
  [AzureRedisEntraAuthenticationConfigurator](group-28-common-cloud-provider-adapters.md#azureredisentraauthenticationconfigurator))
  supplies the Entra token logic and registers itself, so the core never references a cloud SDK
  ([ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)).
- **Walkthrough**: one member, `void Configure(ConfigurationOptions options)`
  (`IRedisConfigurationOptionsConfigurator.cs:34`), given options already parsed from the connection
  string. The remarks (`:24-28`) state the contract: it runs synchronously inside the options pipeline,
  may run more than once per process (once per connection point), and throwing from it fails that
  connection, which is the place to reject a connection string the configurator cannot serve.
- **Why it's built this way**: the connections it reaches are spread across packages: the Redis client
  and distributed cache, the output-cache store, the SignalR backplane and the `redis` PING health check
  (`IRedisConfigurationOptionsConfigurator.cs:11-18`). Routing them all through one registered
  interface, run once per connection on that connection's own options instance, keeps a credential
  change a single registration rather than four. With none registered, every connection is made from
  the connection string exactly as before (`:20-22`).
- **Where it's used**: registered through `AddRedisConfigurationOptionsConfigurator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:253-264`), which
  `TryAddEnumerable`s the instance (idempotent per type, `:257`) plus the post-configure bridge
  (`:260-261`). Read by
  [RedisConfigurationOptionsPipeline](group-16-aspire-orchestration.md#redisconfigurationoptionspipeline)
  in MMCA.Common.Aspire and by the push-notification backplane registration
  (`DependencyInjection.Notifications.cs`); implemented by
  [AzureRedisEntraAuthenticationConfigurator](group-28-common-cloud-provider-adapters.md#azureredisentraauthenticationconfigurator).

### RememberedToken
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixGenerations.cs:417` · Level 0 · record struct (private readonly, nested in CachePrefixGenerations)

- **What it is**: the value [CachePrefixGenerations](#cacheprefixgenerations) remembers per
  invalidation boundary: the token, the tick count after which it must be refreshed, a monotonic version
  stamp, and whether this process stored it by invalidating the prefix
  (`CachePrefixGenerations.cs:412-417`).
- **Depends on**: nothing; four positional members (`string Token`, `long ExpiresAt`, `long Version`,
  `bool FromInvalidation`).
- **Concept introduced**: none of its own; it carries the "an older read never overwrites a newer
  invalidation" rule taught on [CachePrefixGenerations](#cacheprefixgenerations). `ExpiresAt` is in
  `Environment.TickCount64` units (`:414`), and `Version` plus `FromInvalidation` are what the
  `AddOrUpdate` merge in `Remember` compares (`CachePrefixGenerations.cs:389-392`).
- **Why it's built this way**: a `readonly record struct` keeps the dictionary value immutable and
  allocation-free, so an update is a whole-value swap inside `ConcurrentDictionary.AddOrUpdate`.
- **Where it's used**: only inside the defining class, as the value type of `_remembered`
  (`CachePrefixGenerations.cs:105`), built in `Remember` (`:385`) and read in `SuffixAsync`
  (`:175-184`) and `FallbackToken` (`:369-370`).

### CacheKeyNamespace
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:59` · Level 1 · class (internal sealed)

- **What it is**: the behavioral half of [CacheKeyPrefixOptions](#cachekeyprefixoptions). It holds a
  resolved prefix string and exposes one operation, `Qualify`, that turns a caller-supplied cache key
  into the key actually stored, plus the factories that decide which prefix applies. Living in the same
  file as the options class keeps the settings and their only interpretation together.
- **Depends on**: [CacheKeyPrefixOptions](#cachekeyprefixoptions),
  [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace) (`Resolve` and
  `Sanitize`), [JwtSettings](group-08-auth.md#jwtsettings) (only for the `Jwt:Audience` key name,
  `CacheKeyPrefix.cs:62`), and `IOptions<T>` / `IConfiguration` / `IHostEnvironment` (BCL). Consumed
  by [HybridCacheService](#hybridcacheservice), [CachePrefixGenerations](#cacheprefixgenerations) and
  [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock).
- **Concept introduced, the null object as a configuration default, with a non-empty fallback.**
  `[Rubric §15, Best Practices & Code Quality]` assesses whether the code avoids incidental complexity
  and defensive noise. Rather than making every call site ask "is a prefix configured?", the no-prefix
  case is a real instance, `None`, whose `Qualify` returns the key unchanged: one branch
  (`CacheKeyPrefix.cs:133-134`) instead of a null check at every use. `[Rubric §11, Security]` assesses
  whether the system prevents data reaching a caller who should not see it: the composition-root
  factory, `From(IServiceProvider)`, turns an unset `Cache:KeyPrefix` into a non-empty,
  per-application prefix (SEC-Common-53, `CacheKeyPrefix.cs:77-81`) rather than into `None`, so
  cross-application key collisions are closed by construction. `[Rubric §14, Testability]` assesses
  whether behavior can be exercised without standing up the world: the type is a plain object the
  cache takes as an optional constructor parameter, so a test passes `new CacheKeyNamespace("svc:")`
  directly (the shape used throughout `HybridCacheServiceTests.cs`).
- **Walkthrough**: primary constructor `CacheKeyNamespace(string prefix)` (`CacheKeyPrefix.cs:59`).
  - `AudienceConfigurationKey` (`CacheKeyPrefix.cs:62`), a private static string built as
    `"Jwt:Audience"` from `JwtSettings.SectionName` and `nameof(JwtSettings.Audience)`, so a rename of
    either cannot silently break the lookup.
  - `None` (`CacheKeyPrefix.cs:65`), a `static` property initialised to `new(string.Empty)`: one shared
    immutable instance meaning "leave keys alone", used when a caller constructs
    [HybridCacheService](#hybridcacheservice) without a namespace (`HybridCacheService.cs:164`).
  - `Prefix` (`CacheKeyPrefix.cs:68`), get-only, initialised with `prefix ?? string.Empty`, so a null
    argument degrades to the no-op prefix rather than throwing later inside `string.Concat`.
  - `From(IOptions<CacheKeyPrefixOptions>? options)` (`CacheKeyPrefix.cs:71-75`): tolerates a null
    options object, reads `KeyPrefix`, and returns `None` when it is null or empty. The plain,
    options-only overload; production DI code does not call it.
  - `From(IServiceProvider serviceProvider)` (`CacheKeyPrefix.cs:85-100`), the overload the DI
    factories call. It returns `new CacheKeyNamespace(configured)` when `Cache:KeyPrefix` is set
    (`CacheKeyPrefix.cs:89-93`); otherwise it resolves
    [ApplicationNamespace](group-14-module-system-composition.md#applicationnamespace)`.Resolve` against
    the container's `IConfiguration` and `IHostEnvironment` and returns
    `"{applicationNamespace}:"` (`CacheKeyPrefix.cs:95-99`). Because `ApplicationNamespace.Resolve`
    never returns empty (`ApplicationNamespace.cs:54-55`), this overload never returns `None`.
  - `CrossServiceFrom(IServiceProvider serviceProvider)` (`CacheKeyPrefix.cs:116-130`), the namespace
    for [CrossServiceCacheKeys](group-05-cqrs-pipeline.md#crossservicecachekeys). Three-step
    fallback: the configured `Cache:CrossServiceKeyPrefix` (`:120-124`); otherwise the `Jwt:Audience`
    value run through `ApplicationNamespace.Sanitize` plus `:`; otherwise, with no audience,
    `From(serviceProvider)`, the host's own namespace (`:126-129`). The remarks (`:110-115`) give the
    reason the audience is the default: it names exactly the set of services that must see a
    cross-service record, since every service of a deployment accepts the same audience while its
    `Application:Namespace` and `Cache:KeyPrefix` differ, and a different application accepts a
    different audience.
  - `Qualify(string key)` (`CacheKeyPrefix.cs:133-134`), expression-bodied: returns `key` unchanged when
    `Prefix.Length == 0`, otherwise `string.Concat(Prefix, key)`. No separator is inserted for an
    explicit prefix, so a configured `Cache:KeyPrefix` must carry its own delimiter (`"conference:"`,
    not `"conference"`); the fallback paths add the `:` themselves.
- **Why it's built this way**: `internal sealed` because it is an implementation detail of the
  Infrastructure caching code, never part of the package's public surface. Splitting an `init`-only
  options POCO from this behavior object keeps the configuration contract (bindable, public) separate
  from the runtime helper (internal, immutable, allocation-free on the common path). Resolving the
  prefix once at construction rather than per call means the options (and, on the fallback paths, the
  application name or audience) are read a single time for the lifetime of the singleton.
- **Where it's used**: `From(IServiceProvider)` in three registrations in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs`: the Redis
  output-cache `InstanceName` post-configure (`:75`), the
  [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock) factory (`:116`)
  and the [HybridCacheService](#hybridcacheservice) factory (`:194`); `CrossServiceFrom` once, as the
  hybrid cache's cross-service namespace (`:204`). Inside the hybrid cache the namespace lands in
  `_keys` with a `?? CacheKeyNamespace.None` fallback (`HybridCacheService.cs:164`), and the same
  instance is handed to [CachePrefixGenerations](#cacheprefixgenerations) so the generation keys live
  in the same namespace as the entries (`HybridCacheService.cs:167-171`). The in-process branch of
  `AddCaching()` constructs [MemoryCacheService](#memorycacheservice) with no namespace at all
  (`DependencyInjection.Caching.cs:95-98`), because the keyspace is private to the process.
- **Caveats / not-in-source**: because `Qualify` is applied inside the cache service and not by Redis,
  a key written by code that bypasses [ICacheService](#icacheservice) and talks to `IDistributedCache`
  directly lands unprefixed. Nothing in the framework's cache path does that, but it is the invariant
  the design depends on. An explicitly configured `CrossServiceKeyPrefix` that differs between two
  services of one deployment silently splits the cross-service keyspace; nothing in source checks that
  the value matches across hosts.

### CacheSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:24` · Level 1 · class (public sealed, options)

- **What it is**: the `Cache` section's TTL policy: the default entry lifetime, the ceiling on the
  in-process copy of a two-level entry, and how long a cache miss waits for the per-key populate lock
  before giving up.
- **Depends on**: [CacheOptions](#cacheoptions), whose `DefaultDuration` seeds this class's own default
  (`CacheSettings.cs:34`), which is what puts it at Level 1, plus `Timeout` and
  `System.ComponentModel.DataAnnotations.RangeAttribute` from the BCL. Consumed by both
  [ICacheService](#icacheservice) implementations ([HybridCacheService](#hybridcacheservice),
  [MemoryCacheService](#memorycacheservice)).
- **Concept introduced, fail-open configuration.** `[Rubric §29, Resilience & Business Continuity]`
  assesses whether a degraded dependency degrades the answer. The class doc states the invariant for
  the whole section: the cache is an optimization, never the system of record, so no value here can
  turn a cache outage or a slow populate into an error. A miss, an unreachable cache, or an expired
  `PopulateLockTimeout` all degrade the request to an uncached read that still runs the real handler
  and still answers correctly (`CacheSettings.cs:12-17`). `[Rubric §12, Performance & Scalability]`:
  the populate lock is stampede protection, and giving it a finite timeout trades that protection for
  a latency bound, which is exactly the tradeoff the remarks spell out (`:55-61`).

  `[Rubric §15, Best Practices & Code Quality]`: the defaults are not re-typed literals. `DefaultDuration`
  initializes from [CacheOptions](#cacheoptions)`.DefaultDuration` (`CacheSettings.cs:34`, defined as
  30 seconds at `CacheOptions.cs:23`), so the configured path and the hard-coded path cannot drift
  apart, and a host that configures nothing behaves as it did before the section existed
  (`CacheSettings.cs:5-9`).
- **Concept, one configuration section read by two layers.** The `Cache` section is shared three ways:
  this class, [CacheKeyPrefixOptions](#cachekeyprefixoptions) for the key namespaces, and the
  Application layer's
  [QueryCachePipelineSettings](group-14-module-system-composition.md#querycachepipelinesettings), which
  reads the same `Cache:PopulateLockTimeout` key from a layer that cannot reference this assembly
  (`CacheSettings.cs:18-22`; the Application type declares `SectionName = "Cache"` at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:23` and the
  same `Timeout.InfiniteTimeSpan` default at `:29`). `[Rubric §3, Clean Architecture]`: the dependency
  rule forbids Application from referencing Infrastructure, so the duplication is not an accident, it
  is the price of keeping the layer boundary intact while both views read one operator-facing key.
- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "Cache"` (`CacheSettings.cs:27`).
  - `DefaultDuration` (`:34`), the absolute TTL applied when a caller supplies no expiration.
    [HybridCacheService](#hybridcacheservice) uses it as the fallback TTL (`HybridCacheService.cs:460`)
    and [MemoryCacheService](#memorycacheservice) does the same (`MemoryCacheService.cs:84`).
  - `LocalCacheDuration` (`:47`), nullable, the ceiling on the L1 copy of a two-level entry so a
    replica that never sees an invalidation still re-reads L2 within the window. Null keeps the
    built-in 30-second ceiling (`HybridCacheService.cs:71`), and the effective L1 lifetime is the
    shorter of the ceiling and the entry's own TTL (`HybridCacheService.cs:466`). It carries a
    `[Range]` of one second up to `TimeSpan.MaxValue` (`:46`), validated at startup, because the same
    value bounds how long a prefix-invalidation generation token is reused without a Redis read
    (`HybridCacheService.cs:167-171`): zero would turn every cache call into a Redis read
    (`CacheSettings.cs:41-44`). [MemoryCacheService](#memorycacheservice) has no L1 and ignores it.
  - `PopulateLockTimeout` (`:62`), defaulting to `Timeout.InfiniteTimeSpan`: waiters block until the
    one request holding the lock has populated the entry. A finite value bounds that wait and lets the
    waiter proceed uncached, and the remarks note that zero or a negative value means no bound, exactly
    like the default (`:55-61`).
  - Both cache services take the options as an OPTIONAL constructor parameter and fall back to a fresh
    instance (`HybridCacheService.cs:166`; `MemoryCacheService.cs:19`, `:25`), so a service
    constructed outside the container still gets the framework defaults.
- **Why it's built this way**: registration guarantees `IOptions<CacheSettings>` always resolves. When
  configuration is available the section is bound and validated
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:48-51`,
  `ValidateDataAnnotations` plus fail-fast `ValidateOnStart`, see
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)); when the
  parameterless overload is used, `AddOptions<CacheSettings>()` is still called so the defaults
  materialize instead of failing the host (`DependencyInjection.Caching.cs:60`, rationale at `:38-43`).
  The same values are then projected into `HybridCache`'s own option type through the options pipeline
  rather than the `AddHybridCache` callback, because the callback has no service provider to read the
  bound section from, and the host's own hook still runs last so it can override anything the framework
  set (`DependencyInjection.Caching.cs:166-184`,
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)).
- **Where it's used**: [MemoryCacheService](#memorycacheservice) and
  [HybridCacheService](#hybridcacheservice) receive it through `IOptions<CacheSettings>`
  (`DependencyInjection.Caching.cs:98`, `:203`), and the `HybridCacheOptions` projection reads it at
  `:171-181`. [LoginProtectionService](group-08-auth.md#loginprotectionservice) also reads it. Its
  defaults and binding are pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/CacheSettingsTests.cs`.

### RedisConfigurationOptionsPostConfigure
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisConfigurationOptionsPostConfigure.cs:15` · Level 1 · class (internal sealed)

- **What it is**: the options-pipeline bridge that runs every registered
  [IRedisConfigurationOptionsConfigurator](#iredisconfigurationoptionsconfigurator) on each
  `ConfigurationOptions` instance the options system builds, for every name, after the instance has
  been parsed and bound (`RedisConfigurationOptionsPostConfigure.cs:5-12`).
- **Depends on**: [IRedisConfigurationOptionsConfigurator](#iredisconfigurationoptionsconfigurator)
  (an `IEnumerable` of them), `IPostConfigureOptions<T>` (BCL) and `ConfigurationOptions`
  (StackExchange.Redis).
- **Concept introduced, reaching a package without referencing it.** `[Rubric §3, Clean
  Architecture]` assesses whether dependencies point the right way. MMCA.Common.Aspire must not
  reference this package, yet its Redis client and output-cache options have to run the configurators.
  Both sides name only a StackExchange.Redis type and the options abstractions, so this class is the
  meeting point: Aspire's Redis client reads its options from the pipeline, and
  [RedisConfigurationOptionsPipeline](group-16-aspire-orchestration.md#redisconfigurationoptionspipeline)
  applies the same post-configure steps to the options it parses itself.
- **Walkthrough**: primary constructor taking the configurators; `_configurators`
  (`RedisConfigurationOptionsPostConfigure.cs:18`) snapshots them into an array once. `PostConfigure`
  (`:21-29`) ignores the name, null-checks the options and calls `Configure` on each configurator in
  registration order.
- **Why it's built this way**: `IPostConfigureOptions` runs after binding, so a configurator always sees
  the values parsed from the connection string and can override them; the name is ignored because a
  credential applies to every connection, not to one named client.
- **Where it's used**: registered by `AddRedisConfigurationOptionsConfigurator` through
  `TryAddEnumerable` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:260-261`),
  so registering several configurators adds the bridge once.

### CachePrefixGenerations
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixGenerations.cs:69` · Level 2 · class (internal sealed partial)

- **What it is**: prefix invalidation for [HybridCacheService](#hybridcacheservice) without walking the
  keyspace. Every invalidation boundary of a key (the empty root, then each prefix ending at `:`)
  carries a generation token, and the tokens in force are folded into the key the entry is stored
  under. Invalidating a prefix replaces its token, so every entry written under the old token stops
  being addressed and expires on its own TTL (`CachePrefixGenerations.cs:8-14`).
- **Depends on**: [CacheKeyNamespace](#cachekeynamespace) (the generation keys share the entries'
  namespace) and [RememberedToken](#rememberedtoken) (nested). Externals:
  `StackExchange.Redis.IConnectionMultiplexer` (optional), `ConcurrentDictionary`,
  `RandomNumberGenerator`, `ILogger` (BCL/NuGet).
- **Concept introduced, generation tokens as O(1) invalidation.** `[Rubric §12, Performance &
  Scalability]` assesses whether cost stays flat as data grows. A SCAN-and-delete invalidation costs
  time proportional to the keyspace; here an invalidation is one Redis write whatever the keyspace size
  (`HybridCacheService.cs:26-32`). The remarks record three design choices:
  - **Why not `HybridCache.RemoveByTagAsync`** (`CachePrefixGenerations.cs:17-24`): in
    Microsoft.Extensions.Caching.Hybrid 10.11.0 each process reads a tag's invalidation timestamp once
    and keeps it for its lifetime, so another replica that already saw the tag never learns of a later
    invalidation. `HybridCacheCrossInstanceInvalidationTests` pins the property this class provides
    instead.
  - **Tokens, not counters** (`:26-34`): a fresh random value rather than an `INCR`, so concurrent
    invalidations need no atomicity and a lost generation key can never come back at an older
    non-baseline token. It can come back at the baseline: a lost `hcg:` key re-addresses entries
    written before that prefix's first invalidation until their TTL.
  - **Staleness bound** (`:36-46`): a token is reused without a read for one local cache duration
    (`Cache:LocalCacheDuration`, 30 seconds by default), then served while one background read
    refreshes it, so another replica's invalidation is seen within one local duration plus one round
    trip.

  `[Rubric §29, Resilience & Business Continuity]`: a failed token read never fails the cache call. It
  answers with the last token this process knew or, for a boundary it never saw, the empty baseline
  (`CachePrefixGenerations.cs:51-65`). The baseline is chosen deliberately over a random token: the
  lockout flag, failure counters and registration throttles live under boundaries nobody invalidates,
  so the baseline keeps them in the keyspace every replica shares and rate limits keep working on a cold
  replica during an outage, where a random fallback would fail open. The remarks state the cost plainly:
  in a partial outage a cold replica can address pre-invalidation entries of a prefix that was
  invalidated, until their TTL.
- **Walkthrough**
  - Constants: `KeyspaceSegment = "hcg:"` (`CachePrefixGenerations.cs:76`), disjoint from the entries'
    `hc:`; `SuffixSeparator = '|'` (`:79`); `RetentionMultiplier = 10` (`:86`, a remembered token is
    kept ten local durations past expiry, five minutes at the default); `TokenSeparator = '.'` (`:89`);
    `SweepInterval = 1024` (`:92`).
  - State: `_remembered` (`:105`, boundary to [RememberedToken](#rememberedtoken)), `_inFlight`
    (`:108`, one shared read per boundary), `_processLocal` (`:111`, the authoritative tokens when there
    is no Redis), and `_version` (`:114`), the monotonic stamp that stops an older read overwriting a
    newer invalidation.
  - Constructor (`:124-138`): null-checks `keys` and `logger`, clamps the local duration at zero and
    derives `_retentionMs` from it.
  - `SuffixAsync(key, ct)` (`:149-202`): computes the key's `Boundaries`, then without Redis reads
    `_processLocal` directly (`:157-165`). With Redis it snapshots `_version` before deciding what to
    read (`:169`), serves a remembered token at once and, if it is past `ExpiresAt` but within
    retention, fires one background refresh (`:175-184`); unknown boundaries are read and awaited, and
    only the caller's own cancellation ends that wait (`:195-198`). `Compose` (`:264-272`) folds the
    non-empty tokens into `|tok1.tok2`, or returns an empty string so an untouched key keeps its plain
    shape.
  - `InvalidateAsync(prefix, ct)` (`:217-238`): mints a token (`NewToken`, 64 random bits, `:276`).
    Without Redis it writes `_processLocal` and warns once that invalidation is process-local
    (`:224-232`). With Redis it adopts the token locally first (`:236`), so this process stops serving
    the prefix even if the write fails, then `StringSetAsync` on `GenerationKey(prefix)` (`:237`,
    key built at `:281`), whose failure propagates to the caller.
  - `Boundaries(key)` (`:246-259`): `""`, then every prefix ending at `:`; for `A:B:C` that is `""`,
    `A:` and `A:B:`.
  - `ReadShared` / `ReadIntoAsync` / `ReadAndRememberAsync` / `ReadFailed` (`:291-361`): one read per
    boundary is published before it starts (`:291-297`), always completes with a token (the fallback if
    anything escapes, `:308-323`), and any read failure, including a cancellation raised inside the
    Redis client, is logged and answered with `FallbackToken` (`:333-361`, `:369-370`).
  - `Remember` (`:382-404`): stores a [RememberedToken](#rememberedtoken) for one local duration, but an
    `AddOrUpdate` merge keeps an existing token this process stored by invalidating the prefix when its
    version is newer than the read's snapshot (`:389-392`); every 1024th insert sweeps entries past
    retention (`:394-401`).
- **Why it's built this way**: random tokens remove the need for atomic Redis operations, the
  local-first adoption means an invalidation is never lost for the invalidating process, and the shared
  in-flight read keeps a burst of concurrent callers on one round trip.
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) records the switch from SCAN
  to the generation-token write (`026-caching-strategy.md:1140-1141`), and
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) its scope, that tokens
  fold only into `hc:` keys (`077-hybridcache-substrate.md:68-69`).
- **Where it's used**: constructed once per [HybridCacheService](#hybridcacheservice) in its
  constructor with the multiplexer, the host namespace and `LocalCacheDuration ?? LocalCacheDefault`
  (`HybridCacheService.cs:167-171`), and called from `HybridKeyAsync` (`HybridCacheService.cs:447`) and
  `RemoveByPrefixAsync` (`HybridCacheService.cs:336`). Unit-tested by `CachePrefixGenerationsTests`.
- **Caveats / not-in-source**: generation keys carry no TTL, so Redis holds one short string per
  distinct invalidated prefix (`CachePrefixGenerations.cs:44-46`); the remarks recommend a `volatile-*`
  eviction policy so they are not evicted (`:32-34`). Whether a given deployment's Redis is configured
  that way is not determinable from source.

### ICacheService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:10` · Level 4 · interface

- **What it is**: the Application layer's cache port. Get by key, look a key up and report presence
  separately from the value, read straight from the shared backing store, set with an optional TTL,
  remove by exact key, remove every key under a `:`-bounded prefix, increment a counter, and
  get-or-create with stampede protection. It hides whether the backing store is an in-process
  `IMemoryCache` or a two-level `HybridCache` over Redis.
- **Depends on**: BCL types at the signature level (`Task`, `CancellationToken`, `TimeSpan?`, value
  tuples) plus [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from
  `MMCA.Common.Shared.Concurrency`, which the default `GetOrCreateAsync` body uses through the
  [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) holder (`ICacheService.cs:1`,
  `ICacheService.cs:217-221`). Implemented by [MemoryCacheService](#memorycacheservice) and
  [HybridCacheService](#hybridcacheservice).
- **Concept introduced, dependency inversion for infrastructure.** `[Rubric §3, Clean Architecture]`
  assesses whether business code depends on abstractions while concrete technology sits at the edges.
  The Application layer *defines* this contract; the Infrastructure layer *implements* it. Handlers,
  decorators and the auth services never see `StackExchange.Redis` or `Microsoft.Extensions.Caching`;
  they program against this interface and the container decides which adapter they get. **Second
  concept, the default interface member as a non-breaking extension point.** `[Rubric §15,
  Best Practices & Code Quality]` assesses whether the codebase can absorb change without a ripple. Four
  members here ship with bodies: `TryGetAsync` (`ICacheService.cs:34`), `GetFromSharedStoreAsync`
  (`ICacheService.cs:69`), `IncrementAsync` (`ICacheService.cs:133`) and `GetOrCreateAsync`
  (`ICacheService.cs:173`). Every existing implementer keeps compiling and inherits working behavior,
  while a store with a better primitive overrides. That is how the
  [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)
  counters, the whole
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) two-level substrate,
  and the shared-store read for single-use records were added to a *published package contract*
  without a breaking change. `[Rubric §12, Performance & Scalability]`: `RemoveByPrefixAsync`
  (`ICacheService.cs:113`) is the member that makes *scoped* invalidation possible, so one mutation
  invalidates a whole family of cached query results without enumerating individual keys.
- **Walkthrough**: members in declaration order.
  - `Task<T?> GetAsync<T>(string key, CancellationToken)` (`ICacheService.cs:17`), returns `default` /
    `null` on a miss.
  - `async Task<(bool Found, T? Value)> TryGetAsync<T>(string key, CancellationToken)`
    (`ICacheService.cs:34-38`), a **default implementation**. It exists for a value-type `T`, where
    `GetAsync` answers a miss with `default(T)` (`0`, `false`, `Guid.Empty`) that cannot be told apart
    from a cached `default(T)` (`ICacheService.cs:19-24`). The default body infers presence from a
    non-null `GetAsync` result (`ICacheService.cs:36-37`), which is exact for reference and nullable
    types; both shipped stores override it with a real presence check.
  - `Task<T?> GetFromSharedStoreAsync<T>(string key, CancellationToken)` (`ICacheService.cs:69-70`),
    a **default implementation** that simply calls `GetAsync`. It reads from the shared backing store,
    bypassing any process-local copy, and is meant for values whose change on one replica must be
    visible to every other replica at once: single-use records (an OAuth exchange code, a
    password-reset or email-confirmation token, a second-factor time step), counters maintained by
    `IncrementAsync` (a registration rate-limit count), and flags that another replica can clear or set
    (the login lockout flag, the soft-deleted-user marker) (`ICacheService.cs:40-47`). The remarks
    give the usage rule: read the record through this member, then remove it; read a counter through it
    too, because a store with a process-local tier increments in the shared store and a local copy would
    pin the first count it saw; read a cross-replica flag through it so a set or clear on one replica
    takes effect on every replica at once; everything else, a value read many times such as a query
    result or a replay cache, stays on `GetAsync` and loses only the local hit rate by coming here
    (`ICacheService.cs:52-62`). The default is exact for a store with no process-local tier;
    [HybridCacheService](#hybridcacheservice) overrides it (`ICacheService.cs:63-67`).
  - `Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken)`
    (`ICacheService.cs:79-83`). A null `expiration` means "use the implementation's default TTL",
    resolved from [CacheSettings](#cachesettings) on both shipped stores (whose own default is
    [CacheOptions](#cacheoptions)`.DefaultDuration`).
  - `Task RemoveAsync(string key, CancellationToken)` (`ICacheService.cs:89`), single-key eviction.
  - `Task RemoveByPrefixAsync(string prefix, CancellationToken)` (`ICacheService.cs:113`), bulk
    invalidation of every key starting with `prefix`. The prefix must end at a `:` boundary (for example
    `"MMCA.Sample.Event:"`, the shape every `ICacheInvalidating.CachePrefix` takes) or be empty to remove
    every entry; a prefix that stops mid-segment is rejected with `ArgumentException`
    (`ICacheService.cs:92-97`, `:112`). The remarks give the reason: the two-level store keeps one
    generation token per `:` boundary, so invalidating a prefix is one write that a mid-segment prefix
    could not express, and every shipped store enforces the rule (through
    [CachePrefixContract](#cacheprefixcontract)) so behavior does not depend on the backend. Callers
    that must not clear the whole cache guard against an empty prefix themselves
    (`ICacheService.cs:100-111`). This is what
    [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
    invokes after a successful mutation.
  - `async Task<long> IncrementAsync(string key, TimeSpan expiration, CancellationToken)`
    (`ICacheService.cs:133-139`), a **default implementation**: read the current value as `long?` (0 on a
    miss), add one, write it back with `expiration`, return the new value. The doc
    (`ICacheService.cs:115-121`) is explicit that it serves rate-limit and brute-force counters
    ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html))
    and that it is **not atomic in any shipped implementation**: the default member (which
    [MemoryCacheService](#memorycacheservice) inherits) and [HybridCacheService](#hybridcacheservice)
    are both a read-modify-write of a get and a set, so concurrent requests can overwrite each other's
    increments and undercount. The remarks add that no shipped store overrides it with Redis `INCR`,
    because the distributed cache stores entries as Redis hashes and an `INCR` string at the same key
    would fail the next read with `WRONGTYPE` (`ICacheService.cs:126-132`).
  - `async Task<T> GetOrCreateAsync<T>(string key, Func<CancellationToken, Task<T>> factory, TimeSpan?
    expiration = null, CancellationToken)` (`ICacheService.cs:173-199`), the last default
    implementation and the most interesting one. It null-guards the factory (`ICacheService.cs:179`),
    takes a **lock-free fast path on a hit** (`ICacheService.cs:183-185`), and only on a miss acquires
    the key's stripe from [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks)
    (`ICacheService.cs:187`), re-reads under the lock (`ICacheService.cs:191-193`, the double-check that
    lets waiters see the value the winner just wrote), then runs the factory and stores its result
    (`ICacheService.cs:195-196`). Both reads go through `TryGetAsync`, not a null test, so a cached
    `default(T)` of a value type counts as a hit and a miss still runs the factory
    (`ICacheService.cs:181-182`). That is the same read-through-with-stampede-protection shape
    [CachingQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
    applies to cacheable queries, made available to any caller.
  - [CacheKeyLocks](group-05-cqrs-pipeline.md#cachekeylocks) (`ICacheService.cs:217-221`), the
    non-generic holder for the fixed-width
    [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) that the default `GetOrCreateAsync`
    uses. It is deliberately a **separate** table from the query decorator's `QueryCacheKeyLocks`
    (`ICacheService.cs:213-215`): different call sites over different keys, and sharing stripes would
    only widen the unrelated-key collisions striping already tolerates.
- **Why it's built this way**: keeping the port in `MMCA.Common.Application` rather than Infrastructure
  is what lets the CQRS decorators, which also live in Application, depend on caching without dragging
  a Redis reference into the business layers. The optional `TimeSpan? expiration` lets callers override
  the global TTL without a second overload. The four defaulted members follow the precedent
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) names explicitly: a
  default interface member is how this package grows a capability that no consumer has to react to.
  `GetFromSharedStoreAsync` makes the single-use-record rule a named member rather than a convention, so
  a caller states "this read must not be answered from a replica's own memory" at the call site.
  Note the honest boundary the `GetOrCreateAsync` remarks draw (`ICacheService.cs:154-172`): caching is
  **unconditional** there, so a failed [Result](group-01-result-error-handling.md#result) would be
  cached, which is exactly why the caching decorators do NOT route through this member and keep their
  own read/execute/write sequence.
- **Where it's used**: both caching decorators take `ICacheService` by constructor injection
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:45`,
  `.../CachingCommandDecorator.cs:35`). Outside the pipeline,
  [LoginProtectionService](group-08-auth.md#loginprotectionservice) calls `IncrementAsync` for failed
  logins and per-IP registrations
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:140` and `:170`),
  and reads the lockout flag and the registration counter through `GetFromSharedStoreAsync`
  (`LoginProtectionService.cs:82` and `:141`);
  [PasswordResetTokenService](group-08-auth.md#passwordresettokenservice) uses it for the per-email
  request counter, the token write and the token read, the last through `GetFromSharedStoreAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:68`, `:90`,
  `:128`); [EmailConfirmationTokenService](group-08-auth.md#emailconfirmationtokenservice) follows the
  same shape
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/EmailConfirmationTokenService.cs:58`, `:75`,
  `:90`); [TwoFactorAuthenticator](group-08-auth.md#twofactorauthenticator) reads the last accepted
  time step through `GetFromSharedStoreAsync` and writes the new one with `SetAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TwoFactor/TwoFactorAuthenticator.cs:197`
  and `:113`); [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) writes the soft-deleted
  marker with `SetAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:91`),
  read back through `GetFromSharedStoreAsync` by
  [SoftDeletedUserMiddleware](group-12-api-hosting-mapping.md#softdeletedusermiddleware)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:95`);
  [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter) resolves it per request
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:141`) to store and
  replay the cached response record (`IdempotencyFilter.cs:361` and `:450`, default expiration 24 hours
  at `:81`); and [OAuthControllerBase](group-12-api-hosting-mapping.md#oauthcontrollerbase) takes it as
  a constructor dependency
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:58`), writing the
  exchange-code entry with `SetAsync` (`OAuthControllerBase.cs:249`) and redeeming it through
  `GetFromSharedStoreAsync` (`OAuthControllerBase.cs:332`). Exactly one implementation is live per
  host: `AddCaching()` registers [MemoryCacheService](#memorycacheservice) via `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:79`), and
  `AddCommonHybridCache()` replaces it (`DependencyInjection.Caching.cs:188-189`). The default
  `GetOrCreateAsync` body is covered by
  [CacheServiceGetOrCreateTests](group-29-testing-infrastructure.md#per-project-test-rollup).
- **Caveats / not-in-source**: `IncrementAsync` is **not atomic** on any shipped implementation (see
  above). Stampede protection in `GetOrCreateAsync` is likewise **per process**
  (`ICacheService.cs:161-165`): with several replicas over one shared cache the factory can still run
  once per replica, and a cluster-wide guarantee would need a distributed lock, which is deliberately
  not attempted here. `GetOrCreateAsync` has no first-party caller outside tests today: it is a
  published extension point plus the member [HybridCacheService](#hybridcacheservice) overrides. And
  `TryGetAsync` is overridden by both shipped stores, so only a hand-written implementation inherits the
  null-inference default that cannot distinguish a value-type miss from a cached `default(T)`.

### HybridCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:55` · Level 5 · class (internal sealed partial)

- **What it is**: the two-level implementation of [ICacheService](#icacheservice), backed by
  `Microsoft.Extensions.Caching.Hybrid.HybridCache`: an in-process L1 in front of the host's registered
  `IDistributedCache` L2, with serialization, L1 promotion and stampede protection supplied by the
  platform. It is the one cache a host with a distributed L2 runs; a host without one keeps
  [MemoryCacheService](#memorycacheservice) (`HybridCacheService.cs:13-16`).
- **Depends on**: [ICacheService](#icacheservice) (implemented),
  [CacheKeyNamespace](#cachekeynamespace) (two optional constructor parameters),
  [CacheSettings](#cachesettings) (optional, the TTL and L1 ceiling), [CacheOptions](#cacheoptions)
  (the value those settings default to), [CachePrefixGenerations](#cacheprefixgenerations) (prefix
  invalidation), [CachePrefixContract](#cacheprefixcontract) (the prefix guard) and
  [CrossServiceCacheKeys](group-05-cqrs-pipeline.md#crossservicecachekeys). Externals: `HybridCache` /
  `HybridCacheEntryOptions` / `HybridCacheEntryFlags` (NuGet), `ILogger<T>` and
  `StackExchange.Redis.IConnectionMultiplexer` (optional).
- **Concept introduced, a disjoint keyspace for one serialization format.** `[Rubric §8, Data
  Architecture]` assesses whether stored data has one owner and one shape. Every entry this service
  writes carries an `hc:` segment inside the configured prefix, `{prefix}hc:{key}`
  (`HybridCacheService.cs:61`), so an entry can never meet a value another writer put in the same server
  (a host's own `IDistributedCache` use, or the `hcg:` generation keys) in a format it cannot parse
  (`HybridCacheService.cs:19-24`). [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)
  records the origin, a since-removed sibling adapter whose payload layout differed and a rolling deploy
  where both served one Redis, and why the rule still holds without it
  (`077-hybridcache-substrate.md:54-57`), plus the rejected alternative, a payload discriminator in one
  keyspace (`077-hybridcache-substrate.md:60-62`). `[Rubric §12, Performance & Scalability]`: the point
  of L1 is removing a network hop and a deserialize from every read of a small hot value, and prefix
  invalidation costs one Redis write via [CachePrefixGenerations](#cacheprefixgenerations) rather than a
  keyspace walk (`HybridCacheService.cs:26-32`). **Second concept, knowing which reads must skip the
  fast tier.** `[Rubric §11, Security]`: an L1 copy is only safe for a value that tolerates being stale
  on one replica for the local expiration. A counter and a single-use record (an OAuth exchange code, a
  password-reset or email-confirmation token, the last accepted second-factor time step) do not, so
  both read from L2 alone (`HybridCacheService.cs:35-46`), as do the reads that must see a removal at
  once (the login lockout flag and the soft-deleted-user marker). **Third concept, cross-service keys.**
  A record one service writes and another reads (the soft-deleted-user marker) is qualified with the
  cross-service namespace every service of a deployment shares, and carries no generation token, so a
  record Identity writes is the record every other service reads (`HybridCacheService.cs:49-52`).
- **Walkthrough**
  - `KeyspaceSegment` (`HybridCacheService.cs:61`), `internal const string` = `"hc:"`, applied *inside*
    the configured namespace.
  - `MissMarker` (`HybridCacheService.cs:64`), the `Exception.Data` key that tags the presence probe's
    miss.
  - `LocalCacheDefault` (`HybridCacheService.cs:71`), `internal static readonly TimeSpan` = 30 seconds.
    It is the default L1 lifetime, the **ceiling** applied to every entry, and the default lifetime of
    a remembered generation token. `AddCommonHybridCache` seeds `HybridCacheOptions` from the same field
    when the host configured no `Cache:LocalCacheDuration`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:180`).
  - `ReadOnlyOptions` (`HybridCacheService.cs:79-82`) and `SharedStoreReadOptions`
    (`HybridCacheService.cs:92-97`), two static option objects. The first sets
    `HybridCacheEntryFlags.DisableUnderlyingData`, which tells `HybridCache` not to invoke the factory
    and not to write anything, so a miss stays a miss while an L2 hit is still promoted into L1. The
    second adds `DisableLocalCacheRead | DisableLocalCacheWrite`, a read answered by L2 alone with no
    L1 promotion, shared by the counter read in `IncrementAsync` and by `GetFromSharedStoreAsync`
    (`HybridCacheService.cs:84-91`). A third object, `PresenceProbeOptions`
    (`HybridCacheService.cs:106-109`), carries only `DisableDistributedCacheWrite` and exists for
    `TryGetAsync`, below.
  - Fields `_hybrid`, `_logger` (`HybridCacheService.cs:111-112`), `_keys` (`:119`), `_crossServiceKeys`
    (`:127`), `_settings` (`:134`) and `_generations` (`:137`).
  - Constructor (`HybridCacheService.cs:151-172`): null-checks `hybrid` and `logger`; `_keys` falls back
    to `CacheKeyNamespace.None`, `_crossServiceKeys` to `_keys`, `_settings` to `new CacheSettings()`
    (`:164-166`); then builds [CachePrefixGenerations](#cacheprefixgenerations) over the optional
    multiplexer, `_keys` and `LocalCacheDuration ?? LocalCacheDefault` (`:167-171`). A null multiplexer
    keeps the generation tokens in this process.
  - `HybridKeyAsync` (`HybridCacheService.cs:440-449`), the key builder every member goes through. A
    cross-service key (`CrossServiceCacheKeys.IsCrossService`) is qualified with `_crossServiceKeys`
    and no suffix (`:442-445`); every other key gets the generation suffix and `_keys`, producing
    `{prefix}hc:{key}|{tokens}` (`:447-448`). The remarks (`:434-438`) say why cross-service keys skip
    the suffix: generation tokens are per namespace, so a prefix wipe in one service would otherwise move
    its copy away from the others'.
  - `GetAsync<T>` (`HybridCacheService.cs:183-202`), calls `_hybrid.GetOrCreateAsync` with a `static`
    no-op factory and `ReadOnlyOptions`, which is how you perform a plain read through an API whose
    primary shape is get-or-create. It is **fail-soft** (`HybridCacheService.cs:175-182`): any exception
    that is not `OperationCanceledException` is logged at warning and answered as a miss
    (`HybridCacheService.cs:196-201`), and the offending entry is dropped best-effort through
    `SelfHealAsync` so the next write repopulates it.
  - `TryGetAsync<T>` (`HybridCacheService.cs:224-249`), an **override** of the
    [ICacheService](#icacheservice) default. `HybridCache` has no presence-reporting read, so presence
    is read from whether it had to call the factory. The factory is `static _ => throw CacheMiss()`: a
    hit never calls it, and a miss throws a `KeyNotFoundException` that
    `catch ... when (ex.Data.Contains(MissMarker))` turns into `(false, default)`
    (`HybridCacheService.cs:239-242`). `CacheMiss()` (`HybridCacheService.cs:420-425`) builds the tagged
    exception, so a `KeyNotFoundException` raised anywhere else cannot be mistaken for a miss. A thrown
    sentinel rather than a flag the factory sets, because a concurrent read of the same key joins the
    first caller's in-flight lookup and never runs its own factory, while the exception reaches every
    joined caller. `PresenceProbeOptions` makes this read's flags unique, and `HybridCache` only joins
    callers with identical flags, so a `GetOrCreateAsync` in flight on the same key can never be handed
    that miss (`HybridCacheService.cs:218-222`). Other faults are fail-soft like `GetAsync`
    (`HybridCacheService.cs:243-248`).
  - `GetFromSharedStoreAsync<T>` (`HybridCacheService.cs:266-285`), an **override** of the
    [ICacheService](#icacheservice) default: the same no-op-factory read as `GetAsync`, but with
    `SharedStoreReadOptions` (`HybridCacheService.cs:275`), so the answer always comes from L2 and
    nothing is promoted into this replica's memory. A removal on another replica is seen immediately,
    which is what keeps a single-use record single-use (`HybridCacheService.cs:254-257`). It is
    fail-soft exactly like `GetAsync` (`HybridCacheService.cs:279-284`); for a single-use record a miss
    is a refusal, which is the safe direction (`HybridCacheService.cs:260-264`).
  - `SetAsync<T>` (`HybridCacheService.cs:295-303`), one call to `_hybrid.SetAsync` with the options
    `WriteOptions(expiration)` builds.
  - `RemoveAsync` (`HybridCacheService.cs:312-316`), `_hybrid.RemoveAsync`, which clears this process's
    L1 copy along with the L2 entry. Other replicas' L1 copies are not reached and keep serving the
    removed value until they expire, up to `Cache:LocalCacheDuration` (30 seconds by default); a read
    that must see the removal everywhere goes through `GetFromSharedStoreAsync`
    (`HybridCacheService.cs:306-311`).
  - `RemoveByPrefixAsync` (`HybridCacheService.cs:333-337`), a non-async method: it runs
    [CachePrefixContract](#cacheprefixcontract)`.EnsureBoundary` (`:335`) and returns
    `_generations.InvalidateAsync(prefix, ...)` directly (`:336`). Nothing is scanned or deleted: the
    replaced token stops every entry under the prefix being addressed, here at once and on other
    replicas within `Cache:LocalCacheDuration`, and the orphaned entries expire on their own TTL
    (`HybridCacheService.cs:321-325`). Without a multiplexer the invalidation reaches this process only,
    warned once (`:327-330`).
  - `IncrementAsync` (`HybridCacheService.cs:362-383`), a read-modify-write deliberately **not** routed
    through this class's own `GetAsync` / `SetAsync` because both legs must bypass L1 (`:366-371` reads
    with `SharedStoreReadOptions`, `:375-380` writes with the two disable flags). The reason
    (`HybridCacheService.cs:349-355`) is the sharpest argument in this group: a counter is the one
    value whose correctness depends on every replica seeing the same number, so an L1 copy would let a
    process read its own stale count and write it back, and a brute-force counter could then be held
    near its starting value indefinitely by a steady stream of attempts against one replica. That is a
    security control silently weakened by a cache optimization, so `[Rubric §11, Security]` is the
    category that decided this member, not §12. Faults are also **not** swallowed here, unlike
    `GetAsync` (`HybridCacheService.cs:358-359`): a counter that silently reads as zero would reset the
    limit it exists to enforce.
  - `GetOrCreateAsync<T>` (`HybridCacheService.cs:394-413`), an override of the interface default that
    hands the work to `HybridCache`'s own primitive, which folds the double-check and the stampede
    protection into one call and additionally deduplicates concurrent callers before they reach L2. The
    factory is passed as **state** rather than captured (`HybridCacheService.cs:404-412`), so the
    delegate stays `static` and no closure is allocated per call.
  - `WriteOptions` (`HybridCacheService.cs:458-469`) and `SelfHealAsync`
    (`HybridCacheService.cs:479-489`), the private helpers. `WriteOptions` is where both dials meet:
    `ttl = expiration ?? _settings.DefaultDuration` (`:460`),
    `localCeiling = _settings.LocalCacheDuration ?? LocalCacheDefault` (`:461`), and
    `LocalCacheExpiration = ttl < localCeiling ? ttl : localCeiling` (`:466`), so a long-lived entry does
    not sit in another replica's memory for its whole TTL after an invalidation that process never saw.
- **Why it's built this way**:
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) is the record. It is the
  only cache service over a shared store: `AddCaching`'s fallback factory throws, naming the call, when
  a non-memory `IDistributedCache` is registered without `AddCommonHybridCache`, because silently
  falling back to the in-process cache would make single-use records, counters and the lockout flag
  per-replica (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:81-93`).
  The registration deliberately uses `RemoveAll` + `Add` rather than `TryAdd` so it wins in either call
  order (`DependencyInjection.Caching.cs:186-189`), with the honest warning that `RemoveAll` does not
  distinguish the framework's registration from a host's own custom [ICacheService](#icacheservice)
  (`DependencyInjection.Caching.cs:150-153`). Generation tokens replace `HybridCache.RemoveByTagAsync`
  for the cross-replica reason recorded on [CachePrefixGenerations](#cacheprefixgenerations).
  `[Rubric §29, Resilience]` shows up in the fail-soft read: the cache is an optimization, never the
  system of record, so an unreadable entry costs a database round trip rather than a failed request.
- **Where it's used**: registered only by `AddCommonHybridCache`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:162-208`), which
  passes the host namespace (`:194`) and `CacheKeyNamespace.CrossServiceFrom(sp)` (`:204`).
  `AddCommonHybridCacheWhenRedisConfigured` calls it only when the `redis` connection string is
  configured (`DependencyInjection.Caching.cs:226-238`), and the composed service-host start-up calls
  that guard
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:97`).
  Everything downstream still talks to [ICacheService](#icacheservice) and is unaware. Covered by
  [HybridCacheServiceTests](group-29-testing-infrastructure.md#per-project-test-rollup), the
  registration semantics by
  [AddCommonHybridCacheTests](group-29-testing-infrastructure.md#per-project-test-rollup), and against
  a real Redis by
  [HybridCacheServiceRedisTests](group-29-testing-infrastructure.md#per-project-test-rollup) and
  `HybridCacheCrossInstanceInvalidationTests` (cross-replica invalidation).
- **Caveats / not-in-source**: replica staleness after a removal or an invalidation is bounded by the
  local expiration (30 seconds by default, `Cache:LocalCacheDuration` to change it), not by the call
  itself, because only the calling process's L1 and remembered tokens change at once
  (`HybridCacheService.cs:28-32`). That is the same order as the delayed re-invalidation
  [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult)
  already performs. It does not apply to counters or to reads made through `GetFromSharedStoreAsync`,
  which never touch L1; a caller that reads a single-use record through plain `GetAsync` instead still
  gets the L1 window, so the protection depends on the call site choosing the right member.
  `TryGetAsync` reports a miss through a caught `KeyNotFoundException`, so it is the correctness path
  for value types, not the hot path. Because the keyspace is disjoint, a host that switches substrate
  starts cold: entries another writer put in the server are invisible here and age out on their own
  TTL, which ADR-077 records as a cost rather than a correctness problem
  (`077-hybridcache-substrate.md:65-68`).

### MemoryCacheService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Caching` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:19` · Level 5 · class (internal sealed)

- **What it is**: the in-process implementation of [ICacheService](#icacheservice), backed by
  `IMemoryCache`. Because `IMemoryCache` exposes no way to enumerate its keys, this service maintains
  its own `ConcurrentDictionary<string, object>` tracking table so it can honor `RemoveByPrefixAsync`,
  the one capability the BCL memory cache lacks. The cache and that table are two structures that have
  to agree, so every mutation of a key runs under that key's lock stripe
  (`MemoryCacheService.cs:9-18`).
- **Depends on**: `IMemoryCache` / `MemoryCacheEntryOptions` and `ConcurrentDictionary<TKey, TValue>`
  (both BCL), [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) from
  `MMCA.Common.Shared.Concurrency` (`MemoryCacheService.cs:5`, `:45`) for the per-key mutual exclusion,
  [CachePrefixContract](#cacheprefixcontract) for the prefix guard, and the optional
  [CacheSettings](#cachesettings) (`MemoryCacheService.cs:19`, `:25`) for the default TTL. Implements
  [ICacheService](#icacheservice) and overrides `TryGetAsync` but **none** of the other default members,
  so it inherits the non-atomic `IncrementAsync`, the stripe-plus-double-check `GetOrCreateAsync` and
  the `GetAsync`-backed `GetFromSharedStoreAsync` (exact here, since there is no shared store beyond
  this process). It takes no [CacheKeyNamespace](#cachekeynamespace).
- **Concept introduced, a shadow index to back-fill a missing API.** `[Rubric §12, Performance &
  Scalability]` assesses cheap reads and sound invalidation; an in-process cache is the lowest-latency
  option available but is *not shared* across instances, so it is correct for a single-process monolith
  or for genuinely per-instance data and wrong for anything else. The teachable mechanic is the shadow
  index: `IMemoryCache` is a black box with no key listing, so the service mirrors every live key into
  `_keys` and keeps that mirror honest with a **post-eviction callback**, so an entry that expires or
  is dropped under memory pressure prunes its own tracking record instead of leaking. It presents the
  identical [ICacheService](#icacheservice) surface as [HybridCacheService](#hybridcacheservice),
  including the same prefix boundary rule, so swapping backends changes nothing for callers. **Second
  concept, an invariant that write ordering cannot buy you.** `[Rubric §15, Best Practices & Code
  Quality]` assesses everyday craftsmanship, including whether comments explain *why* rather than
  *what*. The `SetAsync` remarks (`MemoryCacheService.cs:67-75`) are the worked example: with two
  structures to update, track-then-write lets a concurrent removal drop the tracking record between the
  two steps, and write-then-track lets a removal run entirely between them; both leave a live entry
  nothing can find. Neither order closes the window, so the class buys the invariant with mutual
  exclusion instead, and says so in the code rather than leaving the next reader to rediscover it.
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
    expires on the configured default exactly as on the two-level path. It mints this entry's identity,
    `var token = new object()` (`MemoryCacheService.cs:88`), and registers the post-eviction callback
    (`MemoryCacheService.cs:103-109`) with that token as the callback **state**. The callback body
    **skips `EvictionReason.Replaced`** (`MemoryCacheService.cs:106`) and removes through the
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
  - `RemoveByPrefixAsync` (`MemoryCacheService.cs:144-148`), a non-async wrapper: it runs
    [CachePrefixContract](#cacheprefixcontract)`.EnsureBoundary` (`:146`), so a prefix that does not end
    at `:` throws here exactly as it would on the two-level cache (`MemoryCacheService.cs:137-141`), then
    returns `RemoveMatchingAsync` (`:147`).
  - `RemoveMatchingAsync` (`MemoryCacheService.cs:154-164`), iterates `_keys.Keys.Where(k =>
    k.StartsWith(prefix, StringComparison.Ordinal))` (`MemoryCacheService.cs:156`) and removes each key
    from both stores under its own stripe (`MemoryCacheService.cs:158-162`). Two details from the
    remarks (`MemoryCacheService.cs:130-136`): the candidate list is a **snapshot**, because
    `ConcurrentDictionary.Keys` already copies, so it is enumerated outside every lock; and each stripe
    is released before the next one is taken, never accumulated across the loop, because distinct keys
    can map to the same stripe and to different stripes in a different relative order, so holding
    several at once would let two prefix removals block on each other and deadlock.
- **Why it's built this way**: a parallel key index is the only way to give `IMemoryCache` a
  prefix-removal capability without replacing it, and the two guards on the callback (skip `Replaced`,
  and match the token) are what keep that index from drifting in either direction: a naive key set
  would accumulate phantom keys as entries expired, while a naive callback would delete records for
  entries that are still live. The stripe then covers what neither guard can, the window between the
  two writes that any single-threaded reading of the code hides. Striping rather than a semaphore per
  key is a bounded-memory choice made once in
  [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) and reused here. Taking
  [CacheSettings](#cachesettings) gives both stores one TTL policy, so a caller's omitted expiration
  means the same thing whichever adapter the host resolved. The class is `internal sealed` because it
  is only ever resolved through the [ICacheService](#icacheservice) registration.
- **Where it's used**: the factory registered by `AddCaching()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:96-98`), which
  passes the optional `IOptions<CacheSettings>` (`DependencyInjection.Caching.cs:98`). `AddCaching()`
  always calls `AddMemoryCache()` first (`DependencyInjection.Caching.cs:32`). The factory only returns
  this service when no distributed cache, or only the in-memory `MemoryDistributedCache`, is registered;
  a real distributed cache without `AddCommonHybridCache` makes it throw instead
  (`DependencyInjection.Caching.cs:86-93`). A host with no Redis therefore behaves as a single-instance
  cached monolith with the full interface intact. Consumed through the interface by both CQRS caching
  decorators, [LoginProtectionService](group-08-auth.md#loginprotectionservice),
  [PasswordResetTokenService](group-08-auth.md#passwordresettokenservice),
  [SoftDeletedUserCache](group-08-auth.md#softdeletedusercache) and
  [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter). Unit-tested by
  [MemoryCacheServiceTests](group-29-testing-infrastructure.md#per-project-test-rollup), which pins the
  default-TTL behavior
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:26`), the
  value-type `GetOrCreateAsync` miss that depends on `TryGetAsync` (`MemoryCacheServiceTests.cs:40`),
  and the concurrency behavior deterministically rather than racing for it: the test takes the key's
  own stripe first, then asserts that a `SetAsync` and a `RemoveByPrefixAsync` both park on it
  (`MemoryCacheServiceTests.cs:246`) and that `RemoveAsync` waits on the same stripe as `SetAsync`
  (`MemoryCacheServiceTests.cs:279`).
- **Caveats / not-in-source**: the cache is per-process, so two replicas hold independent and
  potentially divergent copies until each entry's TTL or an explicit eviction reconciles them. That is
  why [HybridCacheService](#hybridcacheservice) exists for scaled-out deployments, and why
  [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html) treats per-replica memory
  mode as a trade-off rather than a supported multi-replica posture. `_keys` is unbounded in the sense
  that only eviction prunes it, so a cache key embedding a high-cardinality value grows the table
  alongside the cache itself. Two limits of the locking are worth knowing: the stripe is per service
  instance, so the invariant holds for the singleton the container registers and not across two
  hand-constructed instances sharing one `IMemoryCache`; and `RemoveMatchingAsync` works from a
  snapshot, so a key written after the snapshot is taken is simply not a candidate for that call.


---
[⬅ Authentication & Authorization](group-08-auth.md)  •  [Index](00-index.md)  •  [Notifications (Push + In-App Inbox + Email) ➡](group-10-notifications.md)
