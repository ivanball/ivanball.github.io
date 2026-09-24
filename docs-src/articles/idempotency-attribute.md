# Idempotency in one attribute: safe retries for HTTP APIs

> Series: MMCA.Common · Article #18 (deep-dive) · Pillar P2 · Group G12 · Rubric §9,§29 · ADR-017 ·
> Status: grounded in `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs`,
> `Website/docs-src/adr/017-request-idempotency.md`, `Website/docs-src/onboarding/group-12-api-hosting-mapping.md`,
> and `Website/docs-src/governance/common-ArchitectureScorecard.md` (§6, §9, §10, §29). No em dashes.

**Subtitle:** Clients retry. Resilient HTTP handlers retry harder. A `POST` that creates a resource must
survive being sent twice. Here is the whole thing in one `[Idempotent]` attribute, formalized in ADR-017,
plus the matching consumer-side inbox that handles the same problem on the broker.

---

A user taps "Place order." The request goes out. The phone's connection hiccups for two seconds, the
client sees no response, and it retries. Your server received both requests. It just created two orders.

This is not an exotic failure. It is the *default* behavior of every retrying client and every resilient
HTTP handler in your stack. The whole point of a Polly retry policy (ADR-009 wires one onto every
outbound client) is to resend a request that did not visibly succeed. The policy cannot tell "the server
never got it" from "the server got it and the response got lost." So it resends, and if your `POST` is
not idempotent, the retry that was supposed to save you just double-charged a customer.

The fix is a contract: the client attaches a key that says "this is the same logical request," and the
server promises that the same key produces the same single effect. In MMCA.Common that contract is one
attribute.

## Why it matters

The non-idempotent `POST` is a quiet, expensive bug. It does not throw. It does not log an error. It
produces a second perfectly valid-looking row. You find out when finance reconciles, or when a customer
complains about a duplicate charge, and by then the originating request is long gone from the logs.

And the pressure toward retries only increases as you harden the system. Add a resilience handler to your
HTTP clients and you have *more* automatic retries, not fewer. Resilience and idempotency are two halves
of the same coin: retries make the system robust to transient failure *only if* the operations being
retried are safe to repeat. Idempotency is what makes "just retry it" a safe instruction.

## The mechanism: one attribute, one header

You mark an action `[Idempotent]`:

```csharp
[Idempotent]
[HttpPost]
public Task<IActionResult> CreateAsync([FromBody] CreateOrderRequest request) => ...
```

The generic create action in the framework's controller bases carries `[Idempotent]` by default, so most
write endpoints get it for free. The attribute is a `ServiceFilterAttribute`, which means the real work
happens in a filter resolved from DI (so it can depend on scoped services like the cache). The attribute
itself is a one-line marker.

The runtime contract is:

1. The client supplies an `Idempotency-Key` header (a value it generates per logical request, the same
   value across its own retries).
2. On the **first** request with a given key, the action runs, and its response (status code plus JSON
   body) is serialized into an `IdempotencyRecord`, together with a SHA-256 hash of the request body
   that produced it, and cached.
3. On a subsequent request with the same key **and the same body**, within the retention window, the
   cached response is replayed verbatim, with an extra header `X-Idempotent-Replay: true`, and **the
   action does not run again**.
4. On a request that reuses the key with a **different** body, nothing is replayed and nothing runs:
   the caller gets a `422 Unprocessable Entity` `ProblemDetails` saying the key was already used with a
   different request body.
5. No `Idempotency-Key` header means the action just runs normally. Idempotency is opt-in per request.

The cache window defaults to **24 hours** (bound from an `IdempotencySettings` section, range-guarded to a
one-week maximum, validated at startup). A first-call `201 Created` replays as a `201`, not a generic
`200`, because the record captures the original status code as well as the body.

Binding the body to the key is why the filter runs at two pipeline stages rather than one. It is an
`IAsyncResourceFilter` as well as an `IAsyncActionFilter`: the resource stage runs before model binding,
which is the last point at which the request body can still be made re-readable, so that is where it calls
`EnableBuffering`, and only for requests that actually carry the key header, so ordinary traffic pays
nothing. The action stage then hashes the buffered body and binds the hash to the cached record. Replaying
a stored response to a request carrying a different payload would tell the client its new write succeeded
when nothing ran, which is the failure the hash exists to prevent. The answer is a `422` rather than a
`409` because the filter already spends 409 on "the original is still in flight", which is a
retry-with-the-same-key situation, while key reuse with a different body is not retryable at all until the
client picks a new key. Two details keep this honest: a body stream that cannot be rewound hashes as empty
rather than throwing (such a request stays exactly as idempotent as it was before), and every stored record
carries the hash of the body that produced it, so the compare on replay is ordinal and total: there is no
hash-less record and therefore no path that replays without checking the payload.

One thing that contract does not say out loud: the client's key is not the cache key. The filter derives
`idempotency:{SHA-256(subject | method | route template | client key)}`, where the subject is the caller's
`user_id` claim or, for an unauthenticated call, `anon:{remote address}`. That is a security property before
it is anything else. Keying on the bare client value makes the key space global: two callers who happen to
pick the same value share an entry, so one user's serialized response body gets replayed to another, and
because services can share a single cache instance the collision reaches across endpoints and across
services too. Hashing also keeps the stored key bounded no matter what the client sends.

## The concurrency detail that actually matters

The interesting part is not "cache the response." It is what happens when two duplicates arrive *at the
same time*, before the first has finished. A naive cache check would let both pass the empty-cache test
and both execute, which defeats the entire purpose precisely in the burst case that retries produce.

So the filter takes a lock, and the lock spans the whole execute-and-store window rather than just the
cache check. That span is the part people get wrong: if you release after the cache miss, a duplicate slips
in between the action finishing and its response reaching the cache, and you are back to two executions.
The lock it takes is an `IDistributedLock` resolved from DI:

```text
1. Hash the request body, then read the cache without a lock (fast path). A hit whose stored hash
   matches replays; a hit whose stored hash differs answers 422. Either way, done.
2. Miss -> try to acquire the distributed lock on the cache key (30s time-to-live, 5s wait).
3. Acquired -> re-check the cache (the previous holder may have finished while we waited).
4. Still a miss -> run the action, store the response plus the body hash, release on dispose.
5. Not acquired within the wait -> re-check once. A hit replays; a miss returns 409 Conflict.
```

The fast-path read is lock-free, so the common case (a unique key, no contention) pays almost nothing. A
burst of concurrent duplicates collapses into a single execution rather than a race.

Why a *distributed* lock and not a semaphore: a per-process lock only serializes duplicates that land on
the same replica. Both deployed apps run more than one, so two duplicates arriving at different replicas
both miss the cache, both execute, and the second overwrites the first's stored response. That is exactly
the double write the filter exists to prevent, and no amount of in-memory cleverness fixes it.

`AddCaching()` (called by `AddInfrastructure`) registers the lock unconditionally, right next to the cache,
because the two are a pair: the lock guards the window that the cache entry closes. With an
`IConnectionMultiplexer` registered you get `RedisDistributedLock`, the standard `SET key token NX PX ttl`
acquire with a compare-and-delete Lua release so a handle can only ever release its own acquisition. With
no multiplexer you get `InProcessDistributedLock`, which warns once that locking is process-local and
therefore degraded. The contract itself is honest about what it is: best-effort, not reentrant, and not a
consensus protocol, so a section that outruns its time-to-live is no longer exclusive.

Step 5 is the interesting one. When the lock is held elsewhere, the 5 second wait expires and nothing is
cached, the original is still running somewhere (or its replica died mid-action). The only two options left
are to execute concurrently, which is the defect, or to tell the caller the request is in flight. It gets a
`409 Conflict` `ProblemDetails` saying to retry with the same key: retryable, honest, and not a duplicate
write. The wait is sized so the common case never reaches this, because a duplicate that arrives while the
original is still running usually waits it out and replays the stored response instead.

### When the cache or the lock is down

A lock that is *held* and a lock that *faults* are different cases, and the filter answers them
differently. A cache read that throws, a cache write that throws, and a lock acquisition that throws are
all caught, logged, counted on an `idempotency.degraded` metric, and swallowed: the action runs without the
idempotency guarantee instead of failing. The rationale is in the filter's own class docs. Deduplication is
an optimization over a client retry that was going to happen anyway, so a cache outage must not become an
outage of every write endpoint carrying the attribute. When the lock is held elsewhere there is a holder
executing this same key right now, so waiting and then answering 409 is meaningful; when the backend
faults there is no holder to wait for and no stored answer to replay, so refusing would turn a Redis blip
into a write outage. A store that faults is swallowed for the same reason from the other end: the action
already ran, and failing after it would hand the client an error it would retry, producing the exact
duplicate the filter exists to prevent. The honest cost is that duplicates can execute twice for the
duration of the outage, which is what the metric is for: alert on it, do not assume the guarantee held.

The striped lock table is the right shape for its job: it is
the fallback for a host that registers no `IDistributedLock` at all, which in practice means a
single-replica host or a test. There, duplicates of the same key hash to the same stripe and serialize
correctly. The striping is the deliberate part. The obvious shape, one `SemaphoreSlim` per key in a
`ConcurrentDictionary`, forces a choice between two defects, and the framework's own class docs say so:
remove the entry when the last holder releases and you open a window where one caller waits on a
semaphore that is no longer in the table while a second caller creates a fresh one (both then run
concurrently, which is exactly what the lock exists to prevent); never remove it and a caller-supplied
idempotency key grows the table without bound. A fixed 256 stripes has neither problem. The cost is that
two unrelated keys can share a stripe and briefly serialize against each other, which is harmless here
because every caller re-checks its own key's cache entry after acquiring.

(One detail worth knowing: what gets cached is a **2xx** result that a status code plus an optional JSON
body can represent. That is an `ObjectResult` (200/201/202 with a payload) or a body-less `StatusCodeResult`
such as the 204 from `NoContent()`, which stores an empty body and replays as a bare status code rather
than as JSON with no content. Non-2xx results are deliberately not stored, because replaying a transient
500 for the whole retention window is worse than letting the retry actually execute. Redirects and file
results are skipped: the record carries a status code, a JSON body, and the hash of the request that
produced them, and nothing else.)

## The same problem shows up on the broker, and the inbox is the matching mechanism

HTTP retries are one source of duplicates. The other is the message broker.

MMCA.Common's outbox gives **at-least-once** delivery: an event may be published twice (the publish
succeeded but the "mark processed" step did not), never zero times. At-least-once is the correct,
durable guarantee. But it has a direct consequence: **any consumer of a broker event can receive the same
event twice, and must be idempotent to be correct.**

The `[Idempotent]` attribute solves this *for the HTTP edge*: a retried `POST` is deduplicated by its
idempotency key. The broker side has its own answer, a durable **inbox**: the consumer-side
counterpart to the HTTP filter, documented in ADR-021 and credited on the scorecard's §6 row as a
genuinely idempotent inbox consumer (dedup by `MessageId` via `IInboxStore`):

- `IInboxStore` (`EfInboxStore` for the real EF implementation, `NoOpInboxStore` when it is turned off)
  records each handled message by its `MessageId` in an `InboxMessage` table with a unique index.
- `IntegrationEventConsumer` calls `TryBeginAsync(MessageId, eventType)` before invoking handlers: a
  message the inbox already holds is skipped and acked, never reapplied. `TryBegin` also *stages* the
  inbox row, unsaved, in the scope's unit of work, so a handler that calls `SaveChangesAsync` on that
  same scope commits the row in the same transaction as its own mutations. A handler that throws has the
  staged row abandoned before the rethrow, so the redelivery is not mistaken for a duplicate; a consume
  that reaches the end calls `CompleteAsync(...)` to persist whatever is still unsaved.
- The posture is resolved from the transport. `MessageBusSettings.EnableInbox` is a nullable bool left
  unset by default, and `IsInboxEnabled` reads that as on for a broker and off for the in-process
  provider, which has no redelivery to dedup. An explicit value wins in both directions: a host that sets
  `MessageBus:EnableInbox=false` gets the no-op store plus one startup warning recording the opt-out.

The retry half is wired too: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy
(`MessageBusSettings.RetryLimit`), and the consumer rethrows on handler failure so MassTransit applies it
before dead-lettering. So the honest framing is: the HTTP write path is idempotent-by-attribute (the
scorecard credits the filter under §9 and §10, where §10 scores Implementation 9 on the strength of the
filter taking a distributed lock with the stripe as fallback, while §29 covers the Polly handlers and the
outbox's graceful degradation), and the broker consumer path dedups by `MessageId` by default on
any broker transport. The remaining discipline is treating the explicit opt-out as a decision with a cost,
and keeping handlers safe to repeat wherever the inbox resolves off.

## Trade-offs, honestly

- **Clients must send a stable key, from a stable identity.** Idempotency is a contract, not magic. If a
  client generates a fresh key per retry, every retry is a "new" request and the dedup never fires. And
  because the cache key includes the caller, a retry that arrives under a different identity (a token
  exchange between the attempts, a rotated anonymous address) misses and re-executes. That is the correct
  trade against replaying one caller's response to another.
- **A key reused with a different body is refused, not replayed.** The record stores a hash of the request
  that produced it, so the same key arriving with a changed payload gets a `422` instead of the earlier
  response. That is the safe answer (replaying would report success for a write that never ran), but it
  means a client that mutates its payload between attempts, adding a client-side timestamp to the body,
  say, has to mint a new key too.
- **The window is bounded.** Replay works for the retention window (default 24h, max one week). A retry
  after the window expires re-executes. Size the window to your realistic retry horizon.
- **Only successful, JSON-shaped responses replay.** A 2xx `ObjectResult` or a body-less 2xx
  `StatusCodeResult` is cached. Failures are not, and neither are redirects or file results. Response
  headers are not part of the record either, so a replayed `201` does not carry the original `Location`.
- **Cross-replica exclusivity is a deployment property, not a guarantee.** You get it where a Redis
  multiplexer is registered. A host without one falls back to the process-local lock or the stripe, and
  there two duplicates on different instances can both miss the cache and execute. Even with Redis the
  lock is best-effort by design (one instance, not Redlock), so a write worth protecting should still be
  naturally idempotent or guarded by a unique constraint.
- **A mid-flight duplicate can get a 409 instead of a replay.** If the original is still running after the
  5 second wait and nothing is cached yet, the duplicate is told to retry with the same key. A client that
  treats every non-2xx as fatal will read that as an error; it is the honest alternative to a double write.
- **The guard fails open, so the guarantee is best-effort by design.** A faulting cache or lock backend is
  counted on `idempotency.degraded` and the action runs unguarded rather than erroring. Availability wins
  deliberately, and the price is that duplicates can execute twice while the backend is down. Treat that
  metric as an alert, not a dashboard decoration.
- **Consumer-side idempotency follows the transport.** The inbox above resolves on for a broker and off
  for the in-process provider, and a host can override either way with `MessageBus:EnableInbox`. Wherever
  it resolves off, every consumer's idempotency is code you own and test.

None of these are reasons to skip idempotent writes. They are the reasons to make the key contract
explicit and to write your broker consumers defensively.

## Apply this even without MMCA

The pattern ports to any HTTP stack:

1. Accept an **`Idempotency-Key` header** on write endpoints and require clients to keep it stable across
   retries.
2. **Cache the first response** (status and body) for a bounded window and replay it verbatim for
   duplicates. Key the entry on a hash of caller identity plus method plus route plus the client's key,
   never on the bare client value: otherwise two callers who pick the same string read each other's
   responses. **Store a hash of the request body with the record** and compare it before replaying, so a
   key reused with a different payload is refused rather than answered with a success that never happened.
3. **Hold a lock across execute-and-store**, not just across the cache check, and re-check after
   acquiring. Use a lock every replica can see (`SET NX PX` with a compare-and-delete release is enough),
   because a per-process lock only serializes duplicates that land on the same instance. Answer a
   duplicate you cannot serialize with a retryable `409` rather than executing it. If you do fall back to
   an in-process lock, prefer a fixed set of striped locks over a per-key dictionary: a client-supplied
   key is unbounded, and evicting entries races.
4. **Decide, in advance, what happens when the cache or lock is down.** Failing open (run the action
   unguarded, count the degradation on a metric) keeps writes available and accepts duplicates during the
   outage; failing closed keeps the guarantee and takes the endpoint down with the cache. Either is
   defensible; having no answer means you get whichever one your exception handling stumbles into.
5. Remember that **the broker has the same problem**: at-least-once delivery means consumers will see
   duplicates, so make them idempotent (an inbox keyed on message id is the durable form).

The takeaway: **a retry is only safe if the operation it retries is idempotent. Make your writes safe to
repeat at the edge with a key, and make your event consumers safe to repeat with an inbox, because
at-least-once delivery will eventually hand you a duplicate.**

---

**What we covered:** why retrying clients and resilient handlers turn a `POST` into a double-write, how
the `[Idempotent]` attribute plus an `Idempotency-Key` header caches and replays the first response under a
distributed lock that spans execute-and-store, why the record is bound to a hash of the request body so a
reused key with a changed payload is refused instead of replayed, what the filter does when the cache or
lock itself is down, how this ties to the outbox's at-least-once delivery, and the consumer-side inbox
that handles the same duplicate problem on the broker, on by default for any broker transport.

**Next in the series:** the self-invalidating cache that lives in the same pipeline, where a write
evicts the reads it staled instead of leaving them stale.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the API-hosting chapter of the
onboarding guide, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Web API, Distributed Systems, Resilience*

*Notes: re-verified in source 2026-09-19 at framework v1.205.0 (`MMCA.Common/FACTS.md:4,14`).
`IdempotentAttribute` is a `ServiceFilterAttribute`
resolving `IdempotencyFilter` from DI (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16`);
the generic create action carries it (`.../Controllers/AggregateRootEntityControllerBase.cs:59`). **Corrected this
pass:** `IdempotencyRecord` is `(int StatusCode, string ResponseBody, string RequestBodyHash)`
(`.../Idempotency/IdempotencyRecord.cs:14`): the hash is non-nullable with no default, and its param doc states
that every record carries one (`:9-13`). `TryReplayAsync` (`.../Idempotency/IdempotencyFilter.cs:351-394`) compares
the stored hash ordinally (`:372`) and answers 422 `UnprocessableEntity` `ProblemDetails` on ANY mismatch
(`BodyMismatchResult` `:322-331`, with the 422-not-409 rationale at `:317-321`); the class remarks say the same
(`:343-344`). The earlier body sentence about a hash-less record replaying unconditionally is therefore removed:
no such record and no such path exists, and no test asserts one. **Also corrected:** the consumer-side inbox is no
longer opt-in. `MessageBusSettings.EnableInbox` is `bool?` with a null default
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:133`, doc `:107-132`) and
`IsInboxEnabled => EnableInbox ?? Provider != MessageBusProvider.InProcess` (`:141`), so the inbox is ON for a
broker transport and OFF only for the in-process provider; registration is
`.../Infrastructure/DependencyInjection.cs:1005-1021` (`EfInboxStore` `:1012`, `NoOpInboxStore` `:1016`,
`InboxDisabledWarningService` `:1021`). ADR-021 records the change
(`Website/docs-src/adr/021-consumer-inbox-idempotency.md:8`, revised 2026-08-26, "the inbox is no longer opt-in for
a broker transport"). The consumer moved and changed shape too:
`.../Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs` calls
`inbox.TryBeginAsync(MessageId, eventTypeName, ct)` (`:81`), which also STAGES the inbox row unsaved in the
scope's unit of work so a handler's own `SaveChangesAsync` commits it in the same transaction as its mutations
(`:76-80`), `inbox.Abandon(MessageId)` on handler failure (`:101`) before the rethrow (`:108`), and
`inbox.CompleteAsync(...)` at the end (`:122`). `AlreadyProcessedAsync`/`MarkProcessedAsync` still exist on
`IInboxStore` (`.../Persistence/Inbox/IInboxStore.cs:19,22`) but are not what the consumer calls. **Anchors
re-read and bumped this pass** (a systematic 2-to-4 line drift in `IdempotencyFilter.cs`): the class is declared
`IAsyncActionFilter, IAsyncResourceFilter` (`:67-68`), so it runs at both stages. The resource stage
(`OnResourceExecutionAsync` `:119-125`) calls `Request.EnableBuffering()` only when the key header is present
(header read `ReadIdempotencyKey` `:163-170`), and the action stage hashes the buffered body
(`ComputeRequestBodyHashAsync` `:182-193`; a non-seekable stream takes the zero-length `EmptyBodyHash`, `:185-186`
and `:110-111`); the two-stage rationale is in the class remarks (`:43-51`). Covered by
`Tests/Presentation/MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:705` (same body replays), `:739` (a
different body under the same key, 422 asserted at `:763`), `:772` (a body-less request, empty-payload hash
asserted at `:779`), `:805` and `:820` (the resource stage buffers only when the key header is present). The
filter fails open. A cache read (`:362-367`), a cache store (`:437-441`) and a lock ACQUISITION fault
(`:253-259`) are each logged, counted on `idempotency.degraded` (`.../Idempotency/IdempotencyMetrics.cs:47`, kinds
`:24,29`) and swallowed, and the action runs unguarded; the availability-over-guarantee reasoning is in the class
remarks (`:52-58`) and the lock-fault-is-not-lock-held distinction at `:232-236`. Tested at
`IdempotencyFilterTests.cs:837,869`. Unchanged and re-confirmed: the lock-free fast-path cache read (`:143`), the
`IDistributedLock` resolved from DI with the stripe fallback when null (`:148-156`), a 30s time-to-live and a 5s
wait (`:97`, `:104`, acquire at `:249-251`), the double-check (`:278`) then execute-and-store (`:281`, via
`ExecuteAndStoreAsync` `:286-295`), and the 409 Conflict `ProblemDetails` for a duplicate that cannot acquire
within the wait and finds nothing cached (`:261-273`, `InFlightDuplicateResult` `:301-310`). `AddCaching()`
(`.../Infrastructure/DependencyInjection.cs:259`, called by `AddInfrastructure` at `:150`, `AddInfrastructure`
itself at `:72`) registers an `IDistributedLock` unconditionally via `TryAddSingleton` (`:317-331`),
`RedisDistributedLock` when an `IConnectionMultiplexer` is present (`:320-325`) and `InProcessDistributedLock`
otherwise (`:328-330`); the Redis acquire is `SET ... NX PX` (`.../Infrastructure/Concurrency/RedisDistributedLock.cs:11,67`,
single-instance-not-Redlock at `:20`) with a Lua compare-and-delete release (`:104`), and the in-process fallback
warns once that locking is process-local (`.../Concurrency/InProcessDistributedLock.cs:75`). The contract
(best-effort, non-reentrant, owner-scoped release) is
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDistributedLock.cs:30` (remarks `:20-28`, `:54-58`).
`IdempotencyFilter.KeyLocks` is only the no-`IDistributedLock` fallback: a `KeyedSemaphoreStripe` declared at
`.../Idempotency/IdempotencyFilter.cs:90` (xmldoc `:82-89`) and acquired at `:206` inside
`ExecuteUnderProcessLockAsync` (`:199-214`), a fixed set of 256 `SemaphoreSlim` stripes indexed by the ordinal hash
of the key (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22,25,60,73`); its
class doc (`:8-16`) states it deliberately replaces the one-semaphore-per-key `ConcurrentDictionary` shape because
removal races and non-removal grows without bound. There is no removal step: the `Releaser` only releases
(`:78-86`). `X-Idempotent-Replay: true` is appended on replay (`.../IdempotencyFilter.cs:383`), and a record with an
empty body replays as a bare `StatusCodeResult` (`:384-385`). The store gate is not `ObjectResult`-only:
`BuildRecord` (`:448-474`) stores a 2xx `ObjectResult` (`:452-460`) or a body-less 2xx `StatusCodeResult` such as
the 204 from `NoContent()` (`:466-469`); non-2xx is deliberately not stored (`IsSuccess` `:476`), and redirects and
file results stay uncached. The cache key is `idempotency:{SHA-256(subject | method | route template | client key)}`
(`BuildCacheKey` `:485-498`, prefix `:75`, subject is the `user_id` claim or `anon:{remote address}` at `:487-488`),
with the SECURITY rationale in the class remarks (`:59-65`).
`IdempotencySettings.CacheExpirationHours` defaults to 24 with `[Range(1, 168)]`
(`.../Idempotency/IdempotencySettings.cs:15-16`). ADR-017 was revised 2026-08-01
(`Website/docs-src/adr/017-request-idempotency.md:4-8`; key scoping `:29-35`; the `IDistributedLock` decision
`:43-53`; the striped semaphore demoted to "the fallback for a host that registers no lock" `:54-60`; result shapes
`:61-69`; trade-offs `:83-99`), but it does NOT yet document the request-body-hash / 422 key-reuse behavior or the
fail-open degradation, so both are cited to the filter source and its tests rather than to the ADR. At-least-once
outbox delivery from ADR-003. Broker side: `IInboxStore`/`EfInboxStore`/`NoOpInboxStore` + `InboxMessage` keyed on
`MessageId` with a unique index
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:724-726`,
`IsUnique` `:725`, inside `ConfigureInbox` declared at `:718` and invoked at `:421`, with
`ToTable("InboxMessages", "dbo")` at `:721`), with exponential-backoff `UseMessageRetry` (`RetryLimit` default 5,
`.../Infrastructure/Messaging/MessageBusSettings.cs:92`, applied at
`.../Infrastructure/DependencyInjection.cs:1228` and `:1268`). Scorecard
anchors re-read this pass (the rows shifted by 8): the §6 row
(`Website/docs-src/governance/common-ArchitectureScorecard.md:86`) credits the idempotent inbox consumer (dedup by
`MessageId` via `IInboxStore`), formally documented in ADR-021; the `[Idempotent]` filter is credited under §9
(`:89`) and §10 (`:90`, retitled "Messaging & Integration Architecture" by rubric v2), and the §10 row still
records the Implementation 8 to 9 lift awarded in the twenty-fifth wave
(2026-08-01) because the filter resolves an `IDistributedLock` with the stripe as fallback; §29 (`:109`) credits the
Polly handlers plus the outbox's graceful degradation, not the `[Idempotent]` filter. The scorecard headline (`:5`)
is the thirty-sixth wave: a full 34-category two-pass evidence re-score dated 2026-09-19 at
framework v1.205.0 (git HEAD `90ffa7a`, clean tree) with no score moves and both indices unchanged at Maturity
97.0% (318/328) and Implementation 86.0% (705/820) on a Sigma-weight of 82 (`:120-121`). NOT RESOLVED this pass:
the header line lists Rubric §9,§29 while the grounding line and this ledger cite §6, §9, §10 and §29; the
scorecard supports all four credits, so the narrower header list is left exactly as written rather than guessed at.*

- Full series index: https://ivanball.github.io/writing.html
