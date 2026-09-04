# ADR-108: Cross-Replica Mutual Exclusion via IDistributedLock

## Status
Accepted (2026-09-03).

## Context
Both deployed apps run more than one replica of every service. ADC's Conference container app is
declared with `minReplicas: 1, maxReplicas: 2` (`MMCA.ADC/infra/main.bicep:1223`, scale at `:1349`),
and its peers are declared the same way (`:1215`, `:1476`, `:1641`). Anything in the framework that
relies on "only one of these runs at a time" therefore runs once per replica unless the exclusion
lives somewhere all the replicas can see.

The in-process tools do not reach that far. A `SemaphoreSlim`, or the striped `KeyedSemaphoreStripe`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`), serializes
callers inside one process only. The framework already had a second, stronger answer for durable
queue work: a database claim-lease. `OutboxProcessor` stamps `LockedUntil` and a `LockToken` in a
conditional `ExecuteUpdateAsync` so exactly one replica wins a row
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:464`,
claim at `:475-483`), and `ScheduledJobRunner` does the same on `ScheduledJobEntry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:423`, claim at
`:428-436`). That pattern needs a row to claim.

Some critical sections have no such row. The API idempotency filter's window between executing an
action and storing its response is guarded by a cache entry, not a database row (ADR-017, ADR-026):
two duplicates landing on different replicas both miss the cache, both execute, and the second
overwrites the first's stored response. ADC's AI scoring pass had the same shape, and its previous
guard was a cache counter released in a `finally`, which a killed replica left stuck at 1 until an
operator cleared it by hand
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:162-174`).

ADR-017 records how the idempotency filter uses a distributed lock. Nothing records the primitive
itself: what it does and deliberately does not promise, what it degrades to, and when to reach for it
rather than for a claim-lease row. This record does.

## Decision
**The framework ships one cross-replica mutual-exclusion primitive, `IDistributedLock`: a
non-reentrant, TTL-bounded, explicitly best-effort lock with an owner-scoped idempotent release,
backed by single-instance Redis where a connection exists and by a warn-once process-local fallback
where it does not. It collapses duplicate work; it never carries a correctness invariant that
persistence can enforce.**

1. **One contract, one method.** `IDistributedLock`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDistributedLock.cs:30`) exposes only
   `TryAcquireAsync(string key, TimeSpan ttl, TimeSpan wait, CancellationToken)` returning
   `Task<IAsyncDisposable?>` (`:59-63`). The interface is public and frozen in the API baseline
   (`Application/PublicAPI.Shipped.txt:91-92`); both implementations are `internal sealed` in
   Infrastructure, so a consumer binds to the contract and never to a backend.

2. **Best-effort, stated on the type.** The contract documents itself as "a best-effort lock, not a
   consensus protocol": a holder paused past its time-to-live loses the lock without knowing it, so
   the guarded section must stay correct (if slower or duplicated) when exclusion is lost, and the
   lock is to be used "to collapse duplicate work, never as the only guard on a correctness invariant
   that persistence can enforce" (`IDistributedLock.cs:23-28`).

3. **Non-reentrant, by contract.** A caller that already holds `key` and asks again waits for itself
   and then fails to acquire (`:19-22`). There is no re-entry counter and no owner affinity.

4. **The TTL is the crash guard; the wait bounds the caller.** `ttl` is how long the lock survives
   without an explicit release, sized comfortably above the section's expected duration because work
   that outlives it is no longer protected (`:36-42`). `wait` is how long to block for a current
   holder, with `TimeSpan.Zero` making the call a single non-blocking attempt (`:43-46`). A `null`
   return means the lock was still held elsewhere when the wait elapsed (`:48-53`).

5. **Release is owner-scoped and idempotent.** A handle releases only the acquisition it represents;
   disposing a handle whose TTL already expired is a no-op rather than a release of the new holder's
   lock, and disposal is idempotent (`:54-58`). Callers dispose inside an `await using`, so release
   happens even when the guarded work throws.

6. **Redis implementation: conditional SET plus a compare-and-delete script.** `RedisDistributedLock`
   (`Infrastructure/Concurrency/RedisDistributedLock.cs:24`) acquires with a single
   `StringSetAsync(..., ttl, keepTtl: false, When.NotExists, ...)` (`:66-68`) carrying a
   per-acquisition random token (`:59`). Release evaluates a Lua script that deletes the key only when
   its stored value still equals that token (`:36-37`, run at `:103-105`), which is what makes the
   release owner-scoped. A result of 0 means the holder's TTL had already lapsed, and it is logged as
   a warning that the section was not exclusive for all of it (`:84`, `:109-111`). Keys carry a
   `lock:` prefix so locks cannot collide with cache entries in a shared instance (`:30`), qualified
   by the same cache key namespace the cache uses (`:55`, `CacheKeyNamespace.Qualify` at
   `Infrastructure/Caching/CacheKeyPrefix.cs:57`). Waiting polls every 50ms (`:40`). Single-instance
   semantics are deliberate: "this is the one-Redis lock, not Redlock" (`:19-23`).

7. **The fallback is process-local and says so once.** With no Redis client registered,
   `InProcessDistributedLock` (`Infrastructure/Concurrency/InProcessDistributedLock.cs:31`) serializes
   through a `ConcurrentDictionary` keyed on the exact key (`:36`, `:61`), polling every 25ms (`:34`).
   `ttl` is accepted and ignored: the holder is a task in this process, and if the process dies the
   table dies with it (`:26-29`). The first acquisition logs one warning naming the degradation and
   the fix (`:52-55`, message at `:75`), latched through `Interlocked` so a steady state warns once
   rather than per request (`:38-39`). It keys on the exact key rather than on hashed stripes because
   a bounded wait would turn stripe false-sharing into a spurious "held elsewhere" for a key nobody
   holds (`:18-25`).

8. **Registration rides with the cache, and is unconditional.** `AddCaching`
   (`Infrastructure/DependencyInjection.cs:229`, reached from `AddInfrastructure` at `:131`)
   `TryAddSingleton`s an `IDistributedLock` (`:287`): `RedisDistributedLock` when an
   `IConnectionMultiplexer` resolves (`:289-295`), `InProcessDistributedLock` otherwise (`:298-300`).
   `TryAdd` means a host that registered its own implementation first keeps it. Both branches are
   asserted (`Infrastructure.Tests/DependencyInjectionTests.cs:75`, `:87`). In production the
   multiplexer comes from `AddRedisCaching`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:57`, client at
   `:65`), which is itself a no-op when no connection string is configured (`:59-62`).

9. **First consumer: the idempotency filter's execute-then-store window.** `IdempotencyFilter`
   resolves the lock with `GetService` on the slow path
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:148`) and runs
   the guarded section under it (`:238`) with a 30s TTL (`:97`) and a 5s wait (`:104`). A duplicate
   that cannot acquire within the wait re-checks the cache; finding nothing, it gets 409 Conflict
   rather than a second execution (`:263-270`, result at `:301`). A lock backend that faults is
   treated differently from a lock that is held: the action runs unguarded and the degradation is
   counted, so a Redis blip does not become a write outage (`:253-259`). With no lock registered the
   filter falls back to its striped semaphore (`:199`, stripe at `:90`).

10. **Second consumer: ADC's AI scoring pass.** `SessionScoringProcessor` resolves the lock from a
    service scope (`SessionScoringProcessor.cs:175`) and claims the event with
    `TryAcquireAsync(ClaimKey(eventId), ClaimTimeToLive, ClaimWait, ...)` (`:178`), where the key is
    `scoring:inflight:{eventId}` (`:101-102`), the TTL is 15 minutes (`:85`) and the wait is
    `TimeSpan.Zero` (`:92`), so a duplicate trigger skips the run rather than queueing behind it
    (`:181-188`). The `await using` on the handle releases on success, on failure, and by TTL when the
    replica is killed mid-pass.

11. **The choose-between rule.** Work that already owns a durable row uses the claim-lease: the
    outbox and the scheduler both stamp `LockedUntil` plus a `LockToken` in a conditional update whose
    predicate is the exclusion (`OutboxProcessor.cs:475-483`, `ScheduledJobRunner.cs:428-436`), which
    survives a Redis outage and needs no extra dependency. `IDistributedLock` is for a section whose
    state is not a row it can conditionally update: a cache entry, an external paid API call, a pass
    over rows it does not own. Inventing a row purely to hold a lease is not the answer for those, and
    neither is holding a database transaction open across the work.

12. **Adoption is exactly these two call sites.** No other MMCA.Common component, and nothing in
    MMCA.Store or MMCA.Helpdesk, takes a lock today. The primitive is shipped and registered in every
    host that calls `AddInfrastructure`, and used in two places.

## Rationale
- **The degraded mode had to be visible, not silent.** Registering nothing when Redis is absent would
  push a null check onto every caller, and registering a no-op lock would make a multi-replica host
  quietly non-exclusive. The warn-once fallback keeps the DI resolution total and puts one line in the
  log naming both the condition and the fix (`InProcessDistributedLock.cs:75`).
- **A handle makes release structural.** Returning `IAsyncDisposable?` rather than a boolean plus a
  `ReleaseAsync(key)` means the release cannot be skipped on a throw path and cannot be aimed at the
  wrong acquisition. That is exactly what the ADC cache counter it replaced got wrong.
- **The owner token is the whole of release correctness.** Deleting without the comparison would let a
  caller whose lock already expired free the next holder's lock, which is the double execution the
  lock exists to prevent (`RedisDistributedLock.cs:32-37`).
- **Registering it beside the cache keeps one Redis decision.** The lock and the cache read the same
  `IConnectionMultiplexer` and the same key namespace, so a host has one thing to configure and the
  two degrade together rather than in different directions.
- **Single-instance Redis is the honest ceiling.** Redlock would add a quorum of independent instances
  to run, monitor and pay for, for a primitive whose contract already says the guarded section must
  survive losing exclusion.

## Trade-offs
- **Failover can hand the same key to two holders.** The lock inherits Redis's failover behavior
  (`RedisDistributedLock.cs:19-23`), so a primary loss between acquire and replicate is a window in
  which two replicas both believe they hold the key. That is why point 2 is a contract term and not a
  caveat.
- **The fallback is correct only at one replica.** A multi-replica host with no Redis connection gets
  per-replica exclusion from `InProcessDistributedLock`, and after the first warning nothing repeats
  it. ADC's scoring processor names this as its floor (`SessionScoringProcessor.cs:171-174`).
- **No renewal.** Nothing extends a TTL mid-section. A section that outlives its TTL silently loses
  exclusion; Redis notices only after the fact, when the release script returns 0 and logs
  (`RedisDistributedLock.cs:84`), and the in-process fallback cannot notice at all because it ignores
  `ttl`.
- **Waiting is polling, not notification.** Both implementations sleep and retry (50ms and 25ms,
  `RedisDistributedLock.cs:40`, `InProcessDistributedLock.cs:34`), so wake-up is granular and a long
  wait costs round trips: a 5s idempotency wait is up to about 100 conditional SET attempts.
- **The key namespace is available but unused.** `lock:` separates locks from cache entries, and the
  configurable `Cache:KeyPrefix` would separate service from service (`CacheKeyPrefix.cs:28-37`), but
  no deployed host sets it, while all four ADC services share one Redis instance
  (`MMCA.ADC/infra/main.bicep:855`, injected per app at `:1092`, `:1292`, `:1415`, `:1561`). Two
  services choosing the same logical key would collide, and today only the callers' key shapes prevent
  it.
- **409 is a real cost to a caller.** The idempotency filter answers a duplicate whose original is
  still in flight with a conflict rather than a longer wait (`IdempotencyFilter.cs:263-270`), so the
  client has to retry. That is deliberate, but it is behavior the TTL and wait pairing tunes rather
  than removes.
- **Two consumers is a thin evidence base.** The contract's edges (TTL loss, wait expiry, idempotent
  disposal) are exercised by unit tests against a mocked `IDatabase`
  (`Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:22-40`, six cases) and by the
  in-process tests, not against a live Redis under failover. The behavior most likely to matter in
  production is the behavior least covered.

## Related
[ADR-017](017-request-idempotency.md) (the HTTP idempotency filter, the first consumer, whose
409-on-lock-miss this record explains), [ADR-026](026-caching-strategy.md) (the cache registration
this lock is registered beside, and the source of the `IConnectionMultiplexer` and key namespace it
shares), [ADR-003](003-outbox-dual-dispatch.md) (the outbox claim-lease: the row-based alternative for
durable queue work), [ADR-074](074-recurring-job-scheduler.md) (the scheduler, which applies that same
claim-lease to cron rows), [ADR-052](052-background-job-execution.md) (in-process background work,
which is per-replica by design and names a distributed lock as the point at which it should become a
real job), [ADR-006](006-database-per-service.md) (database-per-service, which is why a shared database
is not itself the exclusion boundary).
