# ADR-017: HTTP Request Idempotency via Client-Supplied Keys

## Status
Accepted. Revised 2026-08-01: the guard around execute-and-store is now an `IDistributedLock` resolved
from DI (Redis-backed wherever a connection multiplexer is registered, which is every deployed service
host), with the striped semaphore kept only as the no-lock-registered fallback, and body-less 2xx
results (204/`NoContent()`) are cached and replayed as well as `ObjectResult` bodies. See Decision and
Trade-offs.

## Context
Write endpoints (POST / PUT / PATCH) are exposed to **client retries and double-submits**: a flaky
network, an impatient user double-clicking, or a resilience pipeline re-issuing a request can cause the
same logical operation to execute twice (e.g. two orders, two payments). The `Result` pattern (ADR-013)
and domain invariants stop *invalid* states, but they do not stop a *valid* operation from being applied
twice when the second call is a genuine duplicate of the first.

This is a different concern from the **handler idempotency** of ADR-003: that is about domain-event
*consumers* tolerating at-least-once delivery from the outbox. ADR-017 is about the **inbound HTTP edge**
deduplicating *client* requests before the use case runs at all.

## Decision
Provide opt-in, client-driven request idempotency as an MVC action filter in `MMCA.Common.API`.

- **Opt-in per action.** `[Idempotent]` (`IdempotentAttribute`, a `ServiceFilterAttribute` resolving
  `IdempotencyFilter` from DI) marks an action. Nothing is deduplicated unless the action declares it.
- **Client supplies the key.** The caller sends an `Idempotency-Key` header. If the header is absent or
  blank, the action runs normally with **no** deduplication: the key is the client's assertion that "two
  requests with this key are the same operation."
- **The key is scoped to the caller and the endpoint, not taken bare.** The cache key is
  `idempotency:{SHA-256(subject | method | route template | client key)}`, where the subject is the
  caller's `user_id` claim or, unauthenticated, `anon:{remote address}`. Keying on the bare
  client-supplied value made the key space global: two callers who happened to choose the same value
  shared an entry, so one user's serialized response body was replayed to another, and because
  services can share a single cache instance the collision also reached across endpoints and across
  services. Hashing keeps the stored key bounded regardless of what the client sends.
- **Cache-backed replay.** The first response (status code + serialized body) is stored via
  `ICacheService` for a bounded window (default 24h, configurable via
  `IdempotencySettings.CacheExpirationHours`). `ICacheService` resolves to the distributed (Redis) store
  when the host wires one and otherwise to an in-process memory cache (ADR-026), so cross-instance /
  cross-restart replay holds only when a distributed backing is configured. A later request with the same
  key replays the cached response and adds an `X-Idempotent-Replay: true` header so clients can tell a
  replay from a fresh execution.
- **The lock spans execute-and-store, and it is an `IDistributedLock` when one is registered.** The
  filter takes a fast-path cache read (no lock), then holds a lock across the re-check, the action, and
  the store, so a duplicate cannot slip in between the action finishing and its response reaching the
  cache. The lock is whatever `IDistributedLock` DI resolves, and `AddInfrastructure` -> `AddCaching`
  registers one unconditionally: `RedisDistributedLock` when an `IConnectionMultiplexer` is present,
  the process-local `InProcessDistributedLock` (which warns once that it is degraded) otherwise. The
  Redis lock is the single-instance `SET key token NX PX ttl` acquire with a compare-and-delete release
  script, held for a 30s time-to-live with a 5s wait for the current holder. A duplicate that cannot
  acquire within that wait, and finds nothing cached when it gives up, gets **409 Conflict** with a
  retry-with-the-same-key `ProblemDetails`: the original is still running somewhere, so executing would
  be the double write this filter exists to prevent.
- **The striped semaphore is the fallback for a host that registers no lock.** Without an
  `IDistributedLock` the filter serializes on a striped `SemaphoreSlim` (`KeyedSemaphoreStripe`, the
  same double-check pattern), which is correct for a single replica and for tests. Striping is
  deliberate: a dictionary of one semaphore per key forces a choice between two defects, since removing
  the entry when the last holder releases lets a caller wait on a semaphore no longer in the table while
  a second creates a fresh one (both then execute, defeating the lock), and never removing it lets a
  caller-supplied key grow the table without bound. A fixed stripe width has neither problem.
- **Only cache deterministic success shapes.** A **2xx** response is cached when it is representable as
  a status code plus an optional JSON body: an `ObjectResult` (200/201/202 with a payload), or a
  body-less `StatusCodeResult` such as the 204 from `NoContent()`, which is stored with an empty body
  and replayed as a bare status code rather than as JSON with no content. Redirects, file results, and
  failures are not replayed. Caching a failure would replay it for the whole retention window, so a
  client retrying the same key after a transient 500 would keep receiving that 500 for 24 hours instead
  of the retry actually executing. The body-less case was originally skipped, which left every command
  answering `NoContent()` with nothing stored at all: the writes most likely to be retried were the ones
  idempotency did not actually cover.

## Rationale
- **Safety at the edge, not in every handler.** Deduplication lives in one filter, so a handler stays a
  thin use case (ADR-014) and does not grow ad-hoc "did I already do this?" checks.
- **Client owns the identity of an operation.** Only the caller knows that a retry is the *same*
  operation; a server-generated key cannot distinguish a retry from a legitimately-similar new request.
- **Distributed-cache backing (when configured)** makes replays work across instances and across a
  service restart within the window, matching the database-per-service / multi-host deployment (ADR-006,
  ADR-008); with the in-memory fallback (ADR-026) the replay is per-instance and lost on restart.
- **Invariant-friendly default.** Absent header ⇒ no behavior change, so adding `[Idempotent]` is a safe,
  additive annotation.

## Trade-offs
- **Cross-instance mutual exclusion follows Redis, so it is a deployment property, not a guarantee.**
  Every ADC and Store service host registers a Redis `IConnectionMultiplexer` when a `redis` connection
  string is present, and the Azure templates inject one into every service container, so the deployed
  lock is the Redis one and two simultaneous duplicates landing on *different* replicas are genuinely
  serialized. A host with no multiplexer (Helpdesk, a single-replica local run, tests) falls back to the
  process-local lock or the striped semaphore, and there duplicates on different instances can both miss
  the cache and execute, with a configured distributed cache making the *replay* consistent afterward
  but not providing mutual exclusion. Even with Redis the lock is best-effort by design (one instance,
  not Redlock, and a section that outruns the 30s time-to-live is no longer exclusive for the remainder),
  so for exactly-once the operation itself should still be naturally idempotent or guarded by a unique
  constraint.
- **Bounded window.** Replays only work within the retention window (default 24h); a duplicate after
  expiry re-executes.
- **Response-shape coupling.** Only a 2xx `ObjectResult` or a body-less 2xx `StatusCodeResult` is cached,
  and the cached body is the serialized value, so an endpoint whose response depends on per-request state
  (other than the body) will replay the original, not a freshly-computed response. Response headers are
  not part of the record either, so a replayed 201 does not carry the original `Location`.
- **A key is only ever replayed to the caller that produced it.** Scoping to the subject means a
  client that retries under a different identity (a rotated anonymous address, or a token exchange
  between the first attempt and the retry) misses the cache and re-executes. That is the correct
  trade against replaying one caller's response to another.
- **Opt-in.** An action that should be idempotent but is missing `[Idempotent]` gets no protection: the
  same audit-the-inventory caveat as ADR-005's `IAnonymizable`.

## Related
ADR-003 (handler idempotency for outbox/event consumers, a distinct concern), ADR-013 (Result is the
response the filter caches/replays), ADR-014 (the filter keeps the handler thin), ADR-009 (the resilience
pipeline that re-issues requests is the main source of the duplicates this filter absorbs), ADR-026 (the
`ICacheService` substrate whose distributed-vs-memory backing determines cross-instance replay).
