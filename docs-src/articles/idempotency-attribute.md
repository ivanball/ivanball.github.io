# Idempotency in one attribute: safe retries for HTTP APIs

> Series: MMCA.Common · Article #18 (deep-dive) · Pillar P2 · Group G12 · Rubric §9,§29 · ADR-017 ·
> Status: grounded in `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyRecord.cs`,
> `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs`,
> `Website/docs-src/adr/017-request-idempotency.md`, `Website/docs-src/onboarding/group-12-api-hosting-mapping.md`,
> and `Website/docs-src/governance/common-ArchitectureScorecard.md` (§6, §9, §10, §29). No em dashes.

**Subtitle:** Clients retry, and not every client's retry policy knows which verbs are safe to resend. A `POST` that creates a resource must
survive being sent twice. Here is the whole thing in one `[Idempotent]` attribute, formalized in ADR-017,
plus the matching consumer-side inbox that handles the same problem on the broker.

---

A user taps "Place order." The request goes out. The phone's connection hiccups for two seconds, the
client sees no response, and it retries. Your server received both requests. It just created two orders.

This is not an exotic failure. It is the *default* behavior of every retrying client. A mobile app's retry
loop, or a partner integration whose Polly policy retries every verb, exists to resend a request that did
not visibly succeed. Neither can tell "the server never got it" from "the server got it and the response
got lost." So it resends, and if your `POST` is not idempotent, the retry that was supposed to save you
just double-charged a customer.

The fix is a contract: the client attaches a key that says "this is the same logical request," and the
server promises that the same key produces the same single effect. In MMCA.Common that contract is one
attribute.

## Why it matters

The non-idempotent `POST` is a quiet, expensive bug. It does not throw. It does not log an error. It
produces a second perfectly valid-looking row. You find out when finance reconciles, or when a customer
complains about a duplicate charge, and by then the originating request is long gone from the logs.

And the pressure toward retries only increases as systems get hardened. A stock resilience handler retries
every verb unless it is told otherwise, which is exactly why MMCA's own outbound handlers switch the retry
off for `POST` and `PATCH` (ADR-009), and why the framework's UI client retries a `POST` only when it
carries an `Idempotency-Key` held constant across the attempts. A server cannot assume every caller is that
careful, and the ones that are still need the server to honor the key. Resilience and idempotency are two halves
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
2. On the **first** request with a given key, the action runs, and its response (status code, JSON body,
   and the `Location` and `ETag` headers a client may act on) is serialized into an `IdempotencyRecord`,
   together with a SHA-256 hash of the request body that produced it, and cached.
3. On a subsequent request with the same key **and the same body**, within the retention window, the
   cached response is replayed verbatim, with an extra header `X-Idempotent-Replay: true`, and **the
   action does not run again**.
4. On a request that reuses the key with a **different** body, nothing is replayed and nothing runs:
   the caller gets a `422 Unprocessable Entity` `ProblemDetails` saying the key was already used with a
   different request body.
5. No `Idempotency-Key` header means the action just runs normally. Idempotency is opt-in per request.

The cache window defaults to **24 hours** (bound from an `IdempotencySettings` section, range-guarded to a
one-week maximum, validated at startup). A first-call `201 Created` replays as a `201` that still points at
the created resource, not as a generic `200`, because the record captures the original status code and its
`Location` header as well as the body.

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
user id (the `sub` claim, falling back to the mapped name-identifier claim) or, for an unauthenticated call,
`anon:{remote address}` (`anon:unknown` when there is no address). The four parts are joined with a newline,
which an HTTP header value cannot carry, so the client's key cannot be crafted to spill into a neighboring
part and forge a different tuple. That is a security property before it is anything else. Keying on the bare client value makes the key space global: two callers who happen to
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
the same replica. Both deployed apps autoscale to more than one, so two duplicates arriving at different
replicas both miss the cache, both execute, and the second overwrites the first's stored response. That is exactly
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
results are skipped: the record carries a status code, a JSON body, the `Location` and `ETag` headers, and
the hash of the request that produced them, and nothing else.)

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
  inbox row, unsaved, in the consume scope's unit of work, so a handler that calls `SaveChangesAsync`
  through that same scope's context commits the row in the same transaction as its own mutations. The
  framework's own handlers do not take that path: they derive from `ScopedIntegrationEventHandlerBase`,
  which opens a DI scope of its own per delivery, so their saves never carry the staged row. For them the
  row is written by `CompleteAsync(...)` once every handler has succeeded, which makes their mutations
  and the inbox row two transactions: a crash between the two redelivers the event. A handler that throws
  has the staged row abandoned before the rethrow, so the redelivery is not mistaken for a duplicate, as
  long as the row is still unsaved. If an earlier same-scope handler's save already committed it, the
  abandon cannot take it back: the store logs that case, the redelivery is skipped as a duplicate, and the
  handlers that had not yet run never run. A consume that reaches the end calls `CompleteAsync(...)` to
  persist whatever is still unsaved.
- The posture is resolved from the transport. `MessageBusSettings.EnableInbox` is a nullable bool left
  unset by default, and `IsInboxEnabled` reads that as on for a broker and off for the in-process
  provider, which has no redelivery to dedup. An explicit value wins in both directions: a host that sets
  `MessageBus:EnableInbox=false` gets the no-op store plus one startup warning recording the opt-out.

The retry half is wired too: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy
(`MessageBusSettings.RetryLimit`), and the consumer rethrows on handler failure so MassTransit applies it
before dead-lettering. So the honest framing is: the HTTP write path is idempotent-by-attribute (the
scorecard credits the filter under §9 and §10, where the §10 row, scored Implementation 9, lists the
filter taking a distributed lock with the stripe as fallback among its evidence, while §29 covers the Polly
handlers and the outbox's graceful degradation), and the broker consumer path dedups by `MessageId` by
default on any broker transport. That dedup is at-least-once-with-dedup, not exactly-once: the crash
window above still redelivers an event whose handlers already committed, so handlers must stay safe to
repeat with the inbox on. The remaining discipline is treating the explicit opt-out as a decision with a
cost, and writing every handler to be safe to repeat.

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
  `StatusCodeResult` is cached. Failures are not, and neither are redirects or file results. Of the response
  headers, only `Location` and `ETag` travel with the record; any other header the original wrote is not
  replayed.
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
- **The inbox narrows the consumer-side duplicate problem; it does not remove it.** The inbox above
  resolves on for a broker and off for the in-process provider, and a host can override either way with
  `MessageBus:EnableInbox`. Wherever it resolves off, every duplicate reaches your handlers; wherever it
  resolves on, a crash between a handler's commit and the inbox write still redelivers the event once
  more. Either way, every consumer's idempotency is code you own and test.
- **Partial failure across the handlers of one event cuts both ways.** A handler that saves through the
  consume scope's own context commits the inbox row with it, so a later handler that then fails is not
  retried: the redelivery is skipped as a duplicate. Handlers built on `ScopedIntegrationEventHandlerBase`
  save on their own scope and leave the row to `CompleteAsync`, so a failure among them redelivers the
  event to every handler, including the ones that already committed. Ordering and partial failure across
  handlers of one event are therefore yours to reason about.

None of these are reasons to skip idempotent writes. They are the reasons to make the key contract
explicit and to write your broker consumers defensively.

## Apply this even without MMCA

The pattern ports to any HTTP stack:

1. Accept an **`Idempotency-Key` header** on write endpoints and require clients to keep it stable across
   retries.
2. **Cache the first response** (status, body, and the headers a client acts on, such as `Location`) for a
   bounded window and replay it verbatim for duplicates. Key the entry on a hash of caller identity plus
   method plus route plus the client's key, never on the bare client value: otherwise two callers who pick
   the same string read each other's responses. **Store a hash of the request body with the record** and
   compare it before replaying, so a key reused with a different payload is refused rather than answered
   with a success that never happened.
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

**What we covered:** why a retrying client turns a non-idempotent `POST` into a double-write, how
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

*Notes: re-verified in source 2026-10-08 at framework v1.233.0 (`MMCA.Common/FACTS.md:4,14`). **Corrected this
pass (2026-10-08):** (a) Opener and "Why it matters": MMCA's own resilience handlers never replay a POST or PATCH
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:56-63`, `DisableFor` at `:63`; typed-client handler
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:170-177`, `DisableFor` at `:177`;
recorded in `Website/docs-src/adr/009-resilience-and-recovery-objectives.md:47,97`), and the UI client base retries a
POST or PATCH only when it carries an `Idempotency-Key` (`IsReplaySafe`,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:124-148`), which
`EntityServiceBase` stamps on creates and holds across attempts (`.../Services/Api/EntityServiceBase.cs:18`, `:174`).
The opener's "ADR-009 wires one onto every outbound client" retry premise and the "more automatic retries" sentence
are reframed around a client or third-party retry policy; the subtitle and recap follow. (b) Inbox bullet: the
framework's handlers derive from `ScopedIntegrationEventHandlerBase`, which opens its own scope
(`MMCA.Common/Source/Core/MMCA.Common.Application/DomainEvents/ScopedIntegrationEventHandlerBase.cs:51`), so their
saves never carry the staged row; `CompleteAsync` writes it after every handler succeeds
(`IntegrationEventConsumer.cs:77-81`, `:123`; `EfInboxStore.cs:16-25`; ADR-021 Revision 2026-10-06,
`Website/docs-src/adr/021-consumer-inbox-idempotency.md:29-32`, `:78-91`). (c) Handlers must be idempotent with the
inbox on too (`IntegrationEventConsumer.cs:80-81`; ADR-021 `:78-80`, `:90-91`): the section close and the transport
trade-off bullet are rewritten. (d) The several-handlers trade-off is narrowed to same-scope handlers and gains the
`ScopedIntegrationEventHandlerBase` full-redelivery case (`EfInboxStore.cs:96-114`, log-and-false `:101-108`;
`IInboxStore.cs:57-62`). (e) Replicas: both apps run `minReplicas: 1` and autoscale to two or more
(`MMCA.ADC/infra/main.bicep:1916`, `:2390`; `MMCA.Store/infra/main.bicep:1591`, `:1978-1979`), so "run more than one"
becomes "autoscale to more than one". (f) Newline separator: narrowed to the client key, since an HTTP header value
cannot carry a newline; the source comment (`IdempotencyFilter.cs:548`) asserts it for every component, but nothing
validates the subject claim or the decoded-path route fallback (`:544-546`). **Earlier pass (2026-10-02):** (1) `IdempotencyRecord` is `(int StatusCode, string ResponseBody, string RequestBodyHash,
string? Location = null, string? ETag = null)`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyRecord.cs:21-26`; hash doc `:9-13`,
header docs `:14-20`). `BuildRecord` (`.../Idempotency/IdempotencyFilter.cs:463-501`) stores the ETag the action
wrote (`:468-469`) on both cached shapes (`:483-488`, `:495`) and the `Location` of a `Created`,
`CreatedAtRoute` or `CreatedAtAction` result (`ResolveLocation` `:507-528`); `TryReplayAsync` (`:352-404`)
re-emits both (`:386-392`). Tested at `Tests/Presentation/MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:590`
(Location) and `:601` (ETag). The body statements that the record holds only status, body and hash, and that a
replayed 201 lacks its `Location`, are rewritten. (2) The cache-key subject is `FindUserIdValue()`
(`IdempotencyFilter.cs:541`), which reads `sub` then `ClaimTypes.NameIdentifier`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`), else `anon:{ip}` or
`anon:unknown` (`IdempotencyFilter.cs:541-542`); the components are joined with a newline (`:548-549`) and
SHA-256 hashed under the `idempotency:` prefix (`:550-552`, prefix `:76`) in `BuildCacheKey` (`:539-553`), with
the SECURITY rationale in the class remarks (`:60-66`). The earlier `user_id` claim wording is removed. (3) Inbox
abandon: the consumer calls `inbox.Abandon(...)` and ignores its result
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:102`).
`EfInboxStore.Abandon` (`.../Persistence/Inbox/EfInboxStore.cs:96-114`) returns false and logs when a handler's
save already committed the row (`:101-108`), and the contract says the redelivery is then treated as a duplicate
and the remaining handlers do not run again (`.../Persistence/Inbox/IInboxStore.cs:57-62`). The inbox bullet is
narrowed and a trade-off bullet added. (4) §10 attribution: the scorecard no longer records a twenty-fifth-wave 8
to 9 lift. The §10 row (`Website/docs-src/governance/common-ArchitectureScorecard.md:74`, Implementation 9) lists
`IdempotencyFilter` resolving an `IDistributedLock` among its evidence, so the body says that instead of "on the
strength of". (5) ADR-017 was revised 2026-10-01 (`Website/docs-src/adr/017-request-idempotency.md:13-15`,
Revision `:203-215`) and documents the caller-scoped `sub` subject (`:36-46`), Location and ETag replay
(`:53-55`), the body binding and 422 (`:56-61`) and the fail-open behavior (`:73-76`, `:124-127`); the previous
ledger note that the ADR did not cover these is retired. **Re-anchored in `IdempotencyFilter.cs`:** class
`IAsyncActionFilter, IAsyncResourceFilter` `:68-69`; two-stage remarks `:45-51`; fail-open remarks `:54-58`;
`KeyLocks` `:91` (xmldoc `:83-90`); 30s time-to-live `:98`; 5s wait `:105`; `EmptyBodyHash` `:111-112`;
`OnResourceExecutionAsync` `:120-126` (buffering only with a key, `:122-123`); fast path `:144`;
`IDistributedLock` from DI `:149`, stripe fallback when null `:150-154`; `ReadIdempotencyKey` `:164-171`;
`ComputeRequestBodyHashAsync` `:183-194` (non-seekable stream takes the empty hash, `:186-187`);
`ExecuteUnderProcessLockAsync` `:200-215` (acquire `:207`); distributed acquire `:250-252`; lock fault
`:254-260` (rationale `:234-236`); 409 path `:262-274`; double-check `:279` then execute-and-store `:282`
(`ExecuteAndStoreAsync` `:287-296`); `InFlightDuplicateResult` `:302-311`; `BodyMismatchResult` `:323-332`
(422-not-409 rationale `:318-322`); cache read fault `:363-368`; ordinal hash compare `:373`;
`X-Idempotent-Replay` `:384`; bare-status replay `:394-395`; store fault `:452-456`; `IsSuccess` `:530`. Faults
count on `idempotency.degraded` (`.../Idempotency/IdempotencyMetrics.cs:47`, conflict kinds `:24,29`). Tests:
same body `IdempotencyFilterTests.cs:816`, different body `:850` (422 asserted `:874`), body-less `:883`,
resource stage `:916` and `:931`, cache read and store faults `:948` and `:980`, distributed-lock facts `:672`,
`:712`, `:747`, `:783`; no test exercises the lock-acquisition-fault path. **Unchanged and re-confirmed:**
`IdempotentAttribute` is a `ServiceFilterAttribute` (`.../Idempotency/IdempotentAttribute.cs:16`); the generic
create action carries it (`.../Controllers/AggregateRootEntityControllerBase.cs:60`);
`IdempotencySettings.CacheExpirationHours` defaults to 24 with `[Range(1, 168)]`
(`.../Idempotency/IdempotencySettings.cs:15-16`). The Infrastructure DI registration is split into partials:
`AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:57`) calls
`AddCaching` at `:140`, and `AddCaching` (`.../DependencyInjection.Caching.cs:26`) registers the lock through
`TryAddSingleton<IDistributedLock>` (`:88-102`; `RedisDistributedLock` `:96`, `InProcessDistributedLock`
`:101`). The Redis acquire is `SET ... NX PX` (`.../Concurrency/RedisDistributedLock.cs:11`, `When.NotExists` at
`:67`), single-instance and not Redlock (`:20`), with a Lua compare-and-delete release script (`:37`); the
in-process fallback warns once (`.../Concurrency/InProcessDistributedLock.cs:75`). Contract:
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDistributedLock.cs:30` (not reentrant `:20`,
best-effort and not consensus `:24`). Stripe: `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22`
(width 256 `:25`, acquire `:60`, the `Releaser` only releases `:78-85`), class doc `:8-16`. Inbox posture:
`MessageBusSettings.EnableInbox` is `bool?` (`.../Messaging/MessageBusSettings.cs:133`), `IsInboxEnabled`
`:141`, `RetryLimit` default 5 `:92`; registration `.../DependencyInjection.Messaging.cs:108-124`
(`EfInboxStore` `:110`, `NoOpInboxStore` `:118`, `InboxDisabledWarningService` `:123`); `UseMessageRetry`
`:292` and `:332`. Consumer: `TryBeginAsync` `IntegrationEventConsumer.cs:82` (staging rationale `:77-81`),
rethrow `:109`, `CompleteAsync` `:123`. `InboxMessages` table
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:725`) with a
unique `MessageId` index (`:728-730`) inside `ConfigureInbox` (`:722`, invoked `:427`). ADR-021
(`Website/docs-src/adr/021-consumer-inbox-idempotency.md:8`, revised 2026-10-06 and 2026-10-07, `:29-33`). At-least-once outbox delivery
from ADR-003. Scorecard: evidence stamp 2026-10-07 at v1.233.0 (`common-ArchitectureScorecard.md:5`), Maturity
96.6% (317/328) `:9`, Implementation 86.0% (705/820) `:10`; §6 credits the inbox consumer `:70`, §9 the filter
`:73`, §10 the filter's `IDistributedLock` `:74`, §29 the Polly handlers plus outbox degradation `:93`. NOT
RESOLVED this pass: the header lists Rubric §9,§29 while the grounding line and this ledger cite §6, §9, §10 and
§29; the scorecard supports all four credits, and the header cell is left as written because this run was not
authorized to change header cells.*

- Full series index: https://ivanball.github.io/writing.html
