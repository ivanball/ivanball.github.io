# ADR-077: HybridCache as an Opt-In `ICacheService` Substrate (Amends ADR-026)

## Status
Accepted (2026-08-13). **Amends [ADR-026](026-caching-strategy.md)**: Tier 1's substrate gains a third
implementation beside `MemoryCacheService` and `DistributedCacheService`. It is opt-in through
`AddCommonHybridCache(...)`; with no call the default path is byte-identical to today, so the release is
non-breaking.

**Scope note (2026-08-18).** This record is Tier 1 only: the Status and Context sections above scope it to
ADR-026's Tier 1 substrate, and the Related entry for ADR-040 leaves the Tier 2 output-cache edge untouched.
The cross-service output-cache eviction shipped on 2026-08-18
(`OutputCacheEvictionRequested` plus a per-tag handler on the `MMCA.Common.OutputCache` meter) is a
**Tier 2** change and is recorded in [ADR-026](026-caching-strategy.md)'s Revision (2026-08-18). It
touches neither the `hc:` keyspace, the L1/L2 split, nor anything else decided here: the hybrid
substrate and the output-cache edge remain separate invalidation models.

**Revised (2026-08-31).** `HybridCacheService` takes a fifth optional constructor parameter,
`IOptions<CacheSettings>? cacheSettings`, which the opt-in registration supplies: the service reads its
default and local-cache durations from the bound `Cache` section instead of from hardcoded constants. The
decision is unchanged (disjoint keyspace, opt-in registration, L1 bypass on the counter path); only the
recorded constructor shape and the source anchors are.

## Context
[ADR-026](026-caching-strategy.md) settled Tier 1 as one abstraction (`ICacheService`) over two
implementations chosen at startup: in-process memory when no real `IDistributedCache` is present, Redis
otherwise. That swap is still right, but in the deployed shape a scaled-out service pays a network hop and
a JSON deserialize for **every** cache read, including reads of small, hot, rarely changing values that
every replica wants. `Microsoft.Extensions.Caching.Hybrid` shipped a two-level cache (an in-process L1 in
front of the distributed L2) that removes exactly that cost.

Adopting it is not a drop-in replacement, because ADR-026 also records a production failure that
constrains the design. `ICacheService.IncrementAsync` is a read-modify-write rather than Redis `INCR`
because of a storage-format mismatch documented at the implementation
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:127-145`, override
at `:146`): `INCR` writes a Redis string while `StackExchangeRedisCache` stores every entry as a Redis
hash, so an `INCR`-written counter answers `WRONGTYPE` on the next read and surfaces as a 500 on the
endpoint that owns the counter. A second cache implementation writing a different payload shape into the
same keys is the same failure with a different author, and a rolling deploy guarantees both writers are
live at once.

Two further constraints came out of the code rather than the record: the caching decorators of
[ADR-014](014-cqrs-decorator-pipeline.md) cache only **successful** `Result`s, and the
[ADR-029](029-authentication-brute-force-protection.md) login counters read a value other replicas
increment. Neither survives a naive port onto `HybridCache`'s get-or-create and local cache.

## Decision
Ship `HybridCacheService` as a third `ICacheService` implementation, opt-in per host, under a disjoint
keyspace.

### Two serialization formats never share one keyspace
This is the structural rule the design is built around, and everything else follows from it. The
`WRONGTYPE` failure ADR-026 records is a class of bug, not an incident: whenever two writers with different
payload shapes address one key, one of them eventually reads what the other wrote. `HybridCacheService`
therefore writes under `{prefix}hc:{key}`, disjoint from the keyspace `DistributedCacheService` uses, so an
old-format and a new-format entry can never cross-read, including during a rolling deploy where both
versions serve traffic against one Redis.

The alternative considered was a payload discriminator: one keyspace, with each reader detecting and
skipping a foreign shape. It lost because it makes the failure unlikely rather than impossible, and because
the detection code is exercised only during the migration window it was written for. A disjoint keyspace
needs no detection: a reader that cannot see the other format cannot mis-read it. The cost of the split is
that a key belongs to exactly one substrate: entries another `ICacheService` implementation wrote are
invisible here and age out on their own TTL (the 30-second ADR-026 default for decorator entries, longer
only where a caller asked for longer, and 24 hours for the idempotency records of
[ADR-017](017-request-idempotency.md)). A host that changes substrate therefore starts cold, which is a
cost rather than a correctness problem. Prefix eviction follows the same rule: it scans the `hc:` keyspace
and nothing else, so what this substrate writes is exactly what it evicts.

### `ICacheService` gains a default `GetOrCreateAsync`
`ICacheService`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs`, `GetAsync` at `:17`,
`SetAsync` at `:26`, `RemoveAsync` at `:36`, `RemoveByPrefixAsync` at `:42`) gains
`GetOrCreateAsync<T>(key, factory, expiration?, cancellationToken)` as a **default interface member**,
following the `IncrementAsync` precedent at `:59` precisely because that precedent proved the shape is
non-breaking: no existing implementer, in the framework or in a consumer, has to change. The default
implementation is get, then take the key's stripe from a `KeyedSemaphoreStripe` holder (the
`QueryCacheKeyLocks` pattern), double-check, call the factory, set. Every backing store therefore gets the
process-local stampede protection the query decorator already has, and `HybridCacheService` can override
the member with its native two-level primitive.

### `HybridCacheService`
A new `internal sealed partial class HybridCacheService : ICacheService`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:37`) implements the
interface over `HybridCache`. It takes its dependencies through a primary constructor,
`(HybridCache hybrid, ILogger<HybridCacheService> logger, IConnectionMultiplexer? connectionMultiplexer = null, CacheKeyNamespace? keyNamespace = null, IOptions<CacheSettings>? cacheSettings = null)`
(`:37-42`), the last three optional because a host without Redis still resolves the service, prefix eviction
is the only operation that needs the multiplexer, and a directly constructed instance falls back to
`new CacheSettings()` (`:90`) for its TTL policy. The registration passes all three explicitly rather than
leaving them to the container, the settings included (`DependencyInjection.cs:365`), so a registered service
reads its durations from the bound `Cache` section rather than from the defaults. It is `partial` for the
`LoggerMessage` source generator (`:303-316`), not because the type is split across hand-written files.

- **`GetAsync` is a read that never writes.** It calls `HybridCache.GetOrCreateAsync` with
  `HybridCacheEntryFlags.DisableUnderlyingData` (a shipped 9.0 GA API), which suppresses the factory and
  writes nothing on a miss. This is the call that earns the feature: an L2 hit is promoted into the calling
  replica's L1, so the next read of that key costs no hop. The call is wrapped fail-soft: any fault logs a
  warning, self-heal-deletes the key, and returns the default.
- **`SetAsync` maps expiration to both levels**, with `LocalCacheExpiration` set to
  `min(local default, expiration)`, the local default being the 30 seconds `CacheOptions.DefaultDuration`
  declares. A shorter caller TTL applies at both levels; a longer one still leaves the L1 copy bounded at
  30 seconds.
- **`IncrementAsync` bypasses L1 on both legs** (`DisableLocalCacheRead | DisableLocalCacheWrite`), keeping
  today's L2-only read-modify-write semantics exactly. A counter served from a replica's local cache
  ignores the other replicas' increments, which on the ADR-029 brute-force path means a lockout that never
  triggers. ADR-026 accepted an occasional lost increment; it did not accept a counter that reads its own
  stale copy for up to 30 seconds.
- **`RemoveByPrefixAsync` reuses the existing SCAN machinery**, extracted out of `DistributedCacheService`
  into a shared internal `RedisPrefixScanner`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/RedisPrefixScanner.cs`) that both services
  call, so both evict through one implementation and the existing Redis-tier tests over
  `DistributedCacheService` prove the extraction is behavior-identical. The scan pattern is the
  caller's prefix qualified into this keyspace, `{namespace}hc:{prefix}*`
  (`HybridCacheService.cs:162-181`), this service's own keyspace and no other. The
  delete is a caller-supplied callback, and here it is `hybrid.RemoveAsync` rather than a raw key delete,
  because a raw delete would clear L2 and leave the calling replica's L1 copy serving the value it just
  invalidated.

### The caching decorators keep their own stampede logic
`CachingQueryDecorator` deliberately does **not** route through `GetOrCreateAsync`. It caches only
successful `Result`s, and `HybridCache.GetOrCreateAsync` cannot express "store this outcome but not that
one" without also caching failures, which would turn a transient handler failure into a cached one for the
entry's lifetime. Switching buys nothing anyway: HybridCache's stampede protection is process-local,
exactly like the stripe the decorator holds. The decorators keep their read/execute/write sequence and get
the L1 benefit for free, because their reads go through `GetAsync`.

### Registration is one opt-in call
`AddCommonHybridCache(Action<HybridCacheOptions>? configure = null)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:326`) calls `AddHybridCache` with
defaults matching `CacheOptions` (`LocalCacheExpiration` 30 seconds), then `RemoveAll<ICacheService>()`
(`:352`) and an `AddSingleton<ICacheService>` **factory** (`:353`), not the two-generic-argument
`AddSingleton<ICacheService, HybridCacheService>` form: the lambda resolves the logger (falling back to
`NullLogger` when none is registered), the optional `IConnectionMultiplexer`, the `CacheKeyNamespace` and the
`IOptions<CacheSettings>` itself and hands them to the constructor, rather than leaving the optional
parameters to the container. Remove-then-add makes the call order-independent against `AddInfrastructure`,
whose `AddCaching` registers its substrate with `TryAddSingleton` (`:248`): the opt-in wins either way.

### Tags are deferred
`HybridCache.RemoveByTagAsync` would eventually retire prefix invalidation and its SCAN cost, and it is not
in this release: adopting tags means every cache-writing call site declares its tags, a public-contract
sweep across three repos, while the prefix model has production history. The keyspace decision above is
what makes a later tag adoption possible without a second format collision.

### Packaging and adoption
`Microsoft.Extensions.Caching.Hybrid` is pinned in `Directory.Packages.props` and referenced by
`MMCA.Common.Infrastructure`, with lock files regenerated across the solution **and** the out-of-slnx Redis
tests project ([ADR-038](038-supply-chain-provenance.md)). In the sweep, ADC and Store call
`AddCommonHybridCache` in the hosts that already register Redis; MMCA.Helpdesk does not (no Redis, so it
stays on the memory substrate).

## Rationale
- **The disjoint keyspace is the decision; everything else is implementation.** Rather than trusting a
  second implementation to write a shape compatible with the first, this record removes the possibility of
  the two shapes meeting. A cache key belongs to exactly one writer's format.
- **A default interface member is the only non-breaking way to widen this interface.** `IncrementAsync`
  proved it: implementers inherit working behavior, and the one with something better overrides it.
- **`DisableUnderlyingData` makes `GetAsync` honest.** Without it, mapping `GetAsync` onto a get-or-create
  API would need a factory that fabricates a value, or would write on a read. The flag turns get-or-create
  into a pure read while keeping the L1 promotion that is the point of adopting HybridCache.
- **The counter path is excluded rather than tuned.** A short `LocalCacheExpiration` would have made the
  counters "mostly right", the wrong property for the control that decides whether an account is locked.
  Bypassing L1 on both legs keeps ADR-029's semantics identical to what shipped.
- **Fail-soft matches the existing substrate's posture.** ADR-026 already treats prefix invalidation as
  best-effort with a TTL backstop; a faulting read returning a miss is the same trade.
- **Opt-in keeps the release non-breaking and the monolith cheap.** A host with no Redis gains nothing from
  a two-level cache over an in-process one, so automatic adoption would add a dependency and a second cache
  layer to hosts that cannot benefit.
- **Extracting the scanner guarantees one eviction behavior.** Two SCAN implementations would drift, and
  the drift would be silent (entries surviving an invalidation), the hardest kind of cache bug to see.

## Trade-offs
- **Invalidation does not reach other replicas' L1 immediately.** A remove evicts the L2 entry and the
  calling replica's L1; every other replica keeps its copy for up to `LocalCacheExpiration` (30 seconds).
  The command decorator's delayed 5-second re-invalidation already tolerates a comparable race, but this is
  a second and longer staleness window that did not exist before.
- **OAuth state and nonce records inherit that window.** A value consulted to reject a replay can be served
  from a stale local copy, so the residual replay exposure is bounded by `LocalCacheExpiration`, not by the
  record's removal.
- **`AddCommonHybridCache` overwrites a host's own `ICacheService`.** `RemoveAll<ICacheService>()` is what
  makes the call order-independent, and it is also indiscriminate: a host that registered a custom
  implementation loses it silently. Deliberate, and a sharp edge for anyone who had one.
- **A key belongs to exactly one substrate, so changing substrate costs a cold cache.** Entries another
  `ICacheService` implementation wrote are invisible here, and neither a read nor a prefix eviction reaches
  them: they age out on their own TTL, and until they do Redis holds both keyspaces at once.
- **Fail-soft turns a broken cache into database load, quietly.** A warning log per fault is the only
  signal; the endpoint keeps answering while the database absorbs the traffic the cache used to.
- **The counter path gets none of the benefit.** `IncrementAsync` opting out of L1 leaves ADR-029's hot
  path exactly as expensive as before: correct, and an uneven benefit across the interface.
- **A wider public contract, even when non-breaking.** `GetOrCreateAsync` is a member three repos now
  inherit, and it caches unconditionally (failures included, unlike the decorators), so a caller who
  assumes decorator semantics can misuse it.
- **Deferring tags leaves SCAN as the only bulk-eviction tool.** Prefix invalidation remains an O(keyspace)
  operation per invalidation, on every non-replica server.

## Related
[ADR-026](026-caching-strategy.md) (amended by this record: its Tier 1 substrate gains a third
implementation, its 30-second default TTL becomes the local-cache bound as well, its prefix-invalidation
model gains a second and disjoint keyspace, and its `IncrementAsync` storage-format trade-off is the
specific case this keyspace decision generalizes), [ADR-014](014-cqrs-decorator-pipeline.md) (the caching
decorators, which keep their own stampede protection and their cache-only-success rule and take the L1 win
through `GetAsync`), [ADR-029](029-authentication-brute-force-protection.md) (the brute-force and rate-limit
counters that force `IncrementAsync` to bypass L1 on both legs), [ADR-017](017-request-idempotency.md) (the
24-hour idempotency records, the longest-lived entries this substrate's prefix eviction has to reach),
[ADR-040](040-authenticated-output-caching-for-public-reads.md) (the Tier 2 output-cache edge, untouched by
this record: its own store, its own tag eviction), [ADR-038](038-supply-chain-provenance.md) (the lock-file
and vulnerability-audit obligations a new package pin carries, out-of-slnx projects included),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release and one-pass consumer sweep
that carries this to ADC, Store, and Helpdesk).
