# ADR-017: HTTP Request Idempotency via Client-Supplied Keys

## Status
Accepted

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
  blank, the action runs normally with **no** deduplication — the key is the client's assertion that "two
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
- **Concurrency-safe within an instance.** The filter uses a fast-path cache read (no lock), then a
  striped `SemaphoreSlim` (`KeyedSemaphoreStripe`, double-check locking) so concurrent duplicates that
  arrive before the first completes are serialized rather than both executing. Striping is deliberate:
  a dictionary of one semaphore per key forces a choice between two defects, since removing the entry
  when the last holder releases lets a caller wait on a semaphore no longer in the table while a
  second creates a fresh one (both then execute, defeating the lock), and never removing it lets a
  caller-supplied key grow the table without bound. A fixed stripe width has neither problem.
- **Only cache deterministic success shapes.** Only **2xx** `ObjectResult` responses are cached;
  redirects, file results, and failures are not replayed. Caching a failure would replay it for the
  whole retention window, so a client retrying the same key after a transient 500 would keep receiving
  that 500 for 24 hours instead of the retry actually executing.

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
- **The in-process semaphore only serializes duplicates landing on the same instance.** Two simultaneous
  identical requests routed to *different* instances can both miss the cache and execute; a configured
  distributed cache makes the *replay* consistent afterward but does not provide cross-instance mutual
  exclusion. For
  exactly-once across instances, the operation itself must also be naturally idempotent or guarded by a
  unique constraint.
- **Bounded window.** Replays only work within the retention window (default 24h); a duplicate after
  expiry re-executes.
- **Response-shape coupling.** Only a 2xx `ObjectResult` is cached, and the cached body is the serialized
  value, so an endpoint whose response depends on per-request state (other than the body) will replay the
  original, not a freshly-computed response. Response headers are not part of the record either, so a
  replayed 201 does not carry the original `Location`.
- **A key is only ever replayed to the caller that produced it.** Scoping to the subject means a
  client that retries under a different identity (a rotated anonymous address, or a token exchange
  between the first attempt and the retry) misses the cache and re-executes. That is the correct
  trade against replaying one caller's response to another.
- **Opt-in.** An action that should be idempotent but is missing `[Idempotent]` gets no protection — the
  same audit-the-inventory caveat as ADR-005's `IAnonymizable`.

## Related
ADR-003 (handler idempotency for outbox/event consumers, a distinct concern), ADR-013 (Result is the
response the filter caches/replays), ADR-014 (the filter keeps the handler thin), ADR-009 (the resilience
pipeline that re-issues requests is the main source of the duplicates this filter absorbs), ADR-026 (the
`ICacheService` substrate whose distributed-vs-memory backing determines cross-instance replay).
