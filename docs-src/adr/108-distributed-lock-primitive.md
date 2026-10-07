# ADR-108: Cross-Replica Mutual Exclusion via IDistributedLock

## Status
Accepted (2026-09-03). Revised 2026-09-19 (the second consumer moved: ADC's AI scoring pass now runs
as the internal command `ScoreEventSessionsInternalCommandHandler` under
[ADR-114](114-internal-commands-durable-job-queue.md), taking the lock as a constructor dependency
rather than resolving it from a service scope; and adoption is now three call sites rather than two,
the third being ADC's question submit path). Revised 2026-09-25 (point 12 now grounds the
absence of a lock in MMCA.Store and MMCA.Helpdesk on the rule in points 2 and 11 rather than on
current state alone; the outbox and scheduler claim-lease anchors and the question-submit key
anchor were re-pinned). Revised 2026-10-01 (adoption is four call sites, the fourth being the
framework's password-reset token redemption, and the key namespace now defaults to the host's
application namespace; see Revision below). Revised 2026-10-06: ADC's service ceiling is now
2 replicas by default and 4 in conference mode, and the Redis lock suite has seven cases, not six.
Revised 2026-10-07: adoption is five call sites, the fifth being the framework's OAuth exchange-code
redemption in `OAuthControllerBase`, which ADC's OAuth controller wires with the lock.

## Context
Both deployed apps run more than one replica of every service. ADC's Conference container app
(`MMCA.ADC/infra/main.bicep:1922`) scales with `minReplicas: 1` and
`maxReplicas: conferenceScaledMaxReplicas` (scale at `:2067`), which is 2 by default and 4 in
conference mode (`:192`); Identity and Engagement scale the same way (`:1914`, `:2202`) and
Notification at a fixed `maxReplicas: 2` (`:2388`). Anything in the framework that
relies on "only one of these runs at a time" therefore runs once per replica unless the exclusion
lives somewhere all the replicas can see.

The in-process tools do not reach that far. A `SemaphoreSlim`, or the striped `KeyedSemaphoreStripe`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`), serializes
callers inside one process only. The framework already had a second, stronger answer for durable
queue work: a database claim-lease. `OutboxProcessor` stamps `LockedUntil` and a `LockToken` in a
conditional `ExecuteUpdateAsync` so exactly one replica wins a row
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:330`,
claim at `:357-361`), and `ScheduledJobRunner` does the same on `ScheduledJobEntry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:410`, claim at
`:437-445`). That pattern needs a row to claim.

Some critical sections have no such row. The API idempotency filter's window between executing an
action and storing its response is guarded by a cache entry, not a database row (ADR-017, ADR-026):
two duplicates landing on different replicas both miss the cache, both execute, and the second
overwrites the first's stored response. ADC's AI scoring pass reaches the same place from the other
side: it runs as a durable internal command (ADR-114), so each trigger does own a claimable row, but
two rows for the same event can be claimed by different replicas at the same time, and each pass
issues one paid Anthropic call per session
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:15-21`).
The exclusion the pass needs is per event, not per row.

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
   (`Application/PublicAPI.Shipped.txt:321-322`); both implementations are `internal sealed` in
   Infrastructure, so a consumer binds to the contract and never to a backend.

2. **Best-effort, stated on the type.** The contract documents itself as "a best-effort lock, not a
   consensus protocol": a holder paused past its time-to-live loses the lock without knowing it, so
   the guarded section must stay correct (if slower or duplicated) when exclusion is lost, and the
   lock is to be used "to collapse duplicate work, never as the only guard on a correctness invariant
   that persistence can enforce" (`IDistributedLock.cs:24-27`).

3. **Non-reentrant, by contract.** A caller that already holds `key` and asks again waits for itself
   and then fails to acquire (`:20-22`). There is no re-entry counter and no owner affinity.

4. **The TTL is the crash guard; the wait bounds the caller.** `ttl` is how long the lock survives
   without an explicit release, sized comfortably above the section's expected duration because work
   that outlives it is no longer protected (`:37-42`). `wait` is how long to block for a current
   holder, with `TimeSpan.Zero` making the call a single non-blocking attempt (`:43-46`). A `null`
   return means the lock was still held elsewhere when the wait elapsed (`:48-53`).

5. **Release is owner-scoped and idempotent.** A handle releases only the acquisition it represents;
   disposing a handle whose TTL already expired is a no-op rather than a release of the new holder's
   lock, and disposal is idempotent (`:55-57`). Callers dispose inside an `await using`, so release
   happens even when the guarded work throws.

6. **Redis implementation: conditional SET plus a compare-and-delete script.** `RedisDistributedLock`
   (`Infrastructure/Concurrency/RedisDistributedLock.cs:24`) acquires with a single
   `StringSetAsync(..., ttl, keepTtl: false, When.NotExists, ...)` (`:66-68`) carrying a
   per-acquisition random token (`:59`). Release evaluates a Lua script that deletes the key only when
   its stored value still equals that token (`:36-37`, run at `:113-115`), which is what makes the
   release owner-scoped. A result of 0 means the holder's TTL had already lapsed, and it is logged as
   a warning that the section was not exclusive for all of it (`:84`, `:117-122`). A fault during
   release (a Redis exception or timeout) is caught and logged as a warning rather than thrown
   (`:87-88`, `:124-129`): the release runs after the guarded work has already committed, and the
   key expires on its own TTL, so a failed release never turns completed work into a failure
   (`:106-110`). Keys carry a
   `lock:` prefix so locks cannot collide with cache entries in a shared instance (`:30`), qualified
   by the same cache key namespace the cache uses (`:55`, `CacheKeyNamespace.Qualify` at
   `Infrastructure/Caching/CacheKeyPrefix.cs:91`). Waiting polls every 50ms (`:40`). Single-instance
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
   (`Infrastructure/DependencyInjection.Caching.cs:26`, reached from `AddInfrastructure` at
   `Infrastructure/DependencyInjection.cs:140`) `TryAddSingleton`s an `IDistributedLock` (`DependencyInjection.Caching.cs:86`):
   `RedisDistributedLock` when an `IConnectionMultiplexer` resolves (`DependencyInjection.Caching.cs:88-95`),
   `InProcessDistributedLock` otherwise (`DependencyInjection.Caching.cs:97-99`).
   `TryAdd` means a host that registered its own implementation first keeps it. Both branches are
   asserted (`Infrastructure.Tests/DependencyInjectionTests.cs:81-83`, `:94-96`). In production the
   multiplexer comes from `AddRedisCaching`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:57`, client at
   `:65`), which is itself a no-op when no connection string is configured (`:59-62`).

9. **First consumer: the idempotency filter's execute-then-store window.** `IdempotencyFilter`
   resolves the lock with `GetService` on the slow path
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:149`) and runs
   the guarded section under it (`:239`) with a 30s TTL (`:98`) and a 5s wait (`:105`). A duplicate
   that cannot acquire within the wait re-checks the cache; finding nothing, it gets 409 Conflict
   rather than a second execution (`:262-271`, result at `:302-311`). A lock backend that faults is
   treated differently from a lock that is held: the action runs unguarded and the degradation is
   counted, so a Redis blip does not become a write outage (`:254-260`). With no lock registered the
   filter falls back to its striped semaphore (`:200`, stripe at `:91`).

10. **Second consumer: ADC's AI scoring pass.** `ScoreEventSessionsInternalCommandHandler` takes the
    lock as a primary-constructor dependency rather than resolving it from a service scope
    (`ScoreEventSessionsInternalCommandHandler.cs:49`) and claims the event with
    `TryAcquireAsync(ClaimKey(eventId), ClaimTimeToLive, ClaimWait, ...)` (`:83-85`), where the key is
    `scoring:inflight:{eventId}` (`:123-124`), the TTL is 15 minutes (`:61`) and the wait is
    `TimeSpan.Zero` (`:68`), so a duplicate trigger logs and reports success rather than queueing
    behind the pass already covering the same work (`:87-91`). The `await using` on the handle releases
    on success, on failure, and by TTL when the replica is killed mid-pass.

11. **The choose-between rule.** Work that already owns a durable row uses the claim-lease: the
    outbox and the scheduler both stamp `LockedUntil` plus a `LockToken` in a conditional update whose
    predicate is the exclusion (`OutboxProcessor.cs:357-361`, `ScheduledJobRunner.cs:437-445`), which
    survives a Redis outage and needs no extra dependency. `IDistributedLock` is for a section whose
    state is not a row it can conditionally update: a cache entry, an external paid API call, a pass
    over rows it does not own. Inventing a row purely to hold a lease is not the answer for those, and
    neither is holding a database transaction open across the work.

12. **Adoption is exactly these five call sites.** The third is ADC's question submit cap:
    `SubmitQuestionHandler` takes the lock as a constructor dependency
    (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:34`)
    and serializes the per-(session, user) open-question cap, whose count-then-insert is not one
    atomic statement, under a claim keyed `session-question:submit:{sessionId}:{userId}` (`:108`,
    taken at `:148`) with a 30 second TTL (`:49`) and a 2 second wait (`:57`); a submit that cannot
    get in within the wait is answered with the same cap failure the count itself would have
    returned, so contention never surfaces as a fault. The fourth is the framework's password-reset
    token redemption: `PasswordResetTokenService` takes the lock as a constructor dependency
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:36`) and
    runs the read, compare and remove of one token under `lock:{tokenKey}` (`:106-117`) with a 10
    second TTL (`:41`) and a 5 second wait (`:43`), so two concurrent redemptions of one token do not
    both succeed while the lock holds (best-effort per point 2: a holder paused past the TTL, or a host
    on the process-local fallback of point 7, is not excluded across replicas); a redemption that cannot take the lock is answered as an invalid token (`:109-112`).
    The fifth is the framework's OAuth exchange-code redemption: `OAuthControllerBase` takes an
    optional lock as its fourth constructor argument
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:54`) and, when
    one is supplied, reads and burns the single-use code under `lock:{cacheKey}` (`:253-264`) with a
    10 second TTL (`:80`) and a 5 second wait (`:81`); a redeem that cannot take the lock is answered
    as an invalid code (`:256-259`), and with no lock the read-then-burn runs unlocked, single-use per
    replica only (`:245-248`). ADC's `OAuthController` passes the lock through
    (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:25`).
    No other MMCA.Common component, and nothing in MMCA.Store or MMCA.Helpdesk, takes a lock today.
    The primitive is shipped and registered in every host that calls `AddInfrastructure`, and used in
    five places. That an application takes no lock
    of its own is the rule applied, not a gap to close: a lock is reached for only when there is
    duplicate work to collapse that persistence cannot guard (point 2), and work that owns a durable
    row takes the claim-lease instead (point 11). An adoption difference between the two apps is
    therefore sanctioned by points 2 and 11, and this point only records where the rule currently
    lands.

## Rationale
- **The degraded mode had to be visible, not silent.** Registering nothing when Redis is absent would
  push a null check onto every caller, and registering a no-op lock would make a multi-replica host
  quietly non-exclusive. The warn-once fallback keeps the DI resolution total and puts one line in the
  log naming both the condition and the fix (`InProcessDistributedLock.cs:75`).
- **A handle makes release structural.** Returning `IAsyncDisposable?` rather than a boolean plus a
  `ReleaseAsync(key)` means the release cannot be skipped on a throw path and cannot be aimed at the
  wrong acquisition. A counter taken on entry and released in a `finally` gets both of those wrong,
  and a process killed between the two leaves the guard stuck until an operator clears it.
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
  it. ADC's scoring handler names the condition that defeats it: Conference runs more than one replica and the
  framework's processor polls on each of them
  (`ScoreEventSessionsInternalCommandHandler.cs:15-17`).
- **No renewal.** Nothing extends a TTL mid-section. A section that outlives its TTL silently loses
  exclusion; Redis notices only after the fact, when the release script returns 0 and logs
  (`RedisDistributedLock.cs:84`), and the in-process fallback cannot notice at all because it ignores
  `ttl`.
- **Waiting is polling, not notification.** Both implementations sleep and retry (50ms and 25ms,
  `RedisDistributedLock.cs:40`, `InProcessDistributedLock.cs:34`), so wake-up is granular and a long
  wait costs round trips: a 5s idempotency wait is up to about 100 conditional SET attempts.
- **ADC deliberately shares one key namespace across its services.** `lock:` separates locks from
  cache entries, and the cache key namespace separates hosts: an explicit `Cache:KeyPrefix` wins,
  otherwise the prefix defaults to `Application:Namespace` or, when that is unset, the host's
  `IHostEnvironment.ApplicationName` (`CacheKeyPrefix.cs:46`, `:73-88`;
  `Infrastructure/Configuration/ApplicationNamespace.cs:53-68`), so by default each extracted service
  host gets its own prefix. ADC overrides that: all four ADC services set `Application:Namespace` to
  `adc` and the same `Cache:KeyPrefix` of `adc:`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:38`, `:45`, and the same in the
  Identity, Engagement and Notification service hosts) and share one Redis instance
  (`MMCA.ADC/infra/main.bicep:1434`, injected per app as `ConnectionStrings__redis` at `:1759`,
  `:1999`, `:2136`, `:2290`). Two ADC
  services choosing the same logical key would collide, and today only the callers' key shapes
  prevent it.
- **409 is a real cost to a caller.** The idempotency filter answers a duplicate whose original is
  still in flight with a conflict rather than a longer wait (`IdempotencyFilter.cs:262-271`), so the
  client has to retry. That is deliberate, but it is behavior the TTL and wait pairing tunes rather
  than removes.
- **Five consumers is a thin evidence base.** The contract's edges (TTL loss, wait expiry, idempotent
  disposal) are exercised by unit tests against a mocked `IDatabase`
  (`Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:60-202`, seven cases) and by the
  in-process tests, not against a live Redis under failover. The behavior most likely to matter in
  production is the behavior least covered.

## Revision (2026-10-01)
Two statements no longer matched the code. First, adoption grew to four call sites: the framework's
own `PasswordResetTokenService` takes `IDistributedLock` as a constructor dependency
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:36`) and
serializes each token redemption under it (`:106-117`), so point 12 and the Trade-offs consumer count
now name four sites, and "no other MMCA.Common component takes a lock" now means beyond the
idempotency filter and password reset. MMCA.Store and MMCA.Helpdesk still take none. Second, the cache
key namespace is no longer empty by default: an unset `Cache:KeyPrefix` now falls back to
`Application:Namespace` or, when that is unset, the host's `IHostEnvironment.ApplicationName` (`Infrastructure/Caching/CacheKeyPrefix.cs:73-88`,
`Infrastructure/Configuration/ApplicationNamespace.cs:53-68`), and the four ADC services set an
explicit shared `adc:` prefix (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:45`),
so the Trade-offs bullet now describes per-host separation by default that ADC deliberately
overrides with one shared keyspace, rather than absent separation; the
service-to-service collision risk inside ADC is unchanged. The primitive, its contract, both
implementations and the choose-between rule are unchanged. Anchors were re-pinned for `AddCaching`
(now in `DependencyInjection.Caching.cs`), the idempotency filter, the scoring handler, the
scheduler claim, `CacheKeyNamespace.Qualify`, the `IDistributedLock` remarks, the public API
baseline and the ADC Bicep replica and Redis declarations.

## Revision (2026-10-06)
- Context: ADC's Conference, Identity and Engagement container apps no longer declare a literal
  `maxReplicas: 2`; they scale to `conferenceScaledMaxReplicas` (`MMCA.ADC/infra/main.bicep:191`),
  2 by default and 4 in conference mode, and only Notification keeps a fixed 2 (`:2341`). The
  multi-replica premise is unchanged, and the Trade-offs fallback bullet now says "more than one
  replica" rather than "two replicas".
- Trade-offs: `RedisDistributedLockTests` now holds seven cases (`:60` to `:202`), not six; the old
  `:22-40` range was fixture setup.
- Anchors were re-verified against current source and re-pinned for the public API baseline,
  `AddInfrastructure`, the DI tests, the Redis release script, the scoring handler, the outbox
  claim, and the ADC Bicep Redis resource and injections.

## Revision (2026-10-07)
Re-verified against current source. The primitive, its contract, the in-process implementation, the
registration and the choose-between rule are unchanged; adoption grew by one framework call site,
and the Redis release now absorbs its own faults.
1. Point 12 and the Trade-offs consumer count now name five call sites, not four. The fifth is
   `OAuthControllerBase`, which takes an optional `IDistributedLock`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:54`) and,
   when given one, reads and burns the single-use exchange code under `lock:{cacheKey}`
   (`:253-264`, 10 second TTL at `:80`, 5 second wait at `:81`); ADC's `OAuthController` supplies it
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:25`).
   MMCA.Store and MMCA.Helpdesk still take no lock and declare no `OAuthControllerBase` subclass.
2. Anchors re-verified against current source: the public API baseline
   (`Application/PublicAPI.Shipped.txt:321-322`), the outbox claim (`OutboxProcessor.cs:330`,
   conditional update at `:357-361`), and the ADC Bicep Conference app (`main.bicep:1922`), its scale
   (`:2067`), `conferenceScaledMaxReplicas` (`:192`), the Identity and Engagement scale lines
   (`:1914`, `:2202`), Notification's fixed ceiling (`:2388`), the Redis resource (`:1434`) and its
   per-app `ConnectionStrings__redis` environment injections (`:1759`, `:1999`, `:2136`, `:2290`).
3. Point 6 now records that a fault during the Redis release is caught and logged as a warning
   instead of propagating (`RedisDistributedLock.cs:87-88`, `:124-129`), so a failed release never
   fails work that already committed; the key still expires on its TTL.

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
