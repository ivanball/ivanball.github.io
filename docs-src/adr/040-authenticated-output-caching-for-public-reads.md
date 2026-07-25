# ADR-040: Authenticated output caching for public reads

## Status

Accepted (2026-07-10). Amended (2026-07-10): explicit query-string variance parity with the
built-in default policy (the initial release accidentally dropped it, collapsing every query
variant of a path onto one cache entry), plus an opt-in `bypassRoles` escape hatch for endpoints
whose payload is elevated for one privileged role. Amended (2026-07-25): a shared Redis-backed
output-cache store is now the expected posture for any multi-replica deployment; the per-replica
in-memory store is the single-replica case, not the accepted default (see Trade-offs).

## Context

The framework's read-scaling design leans on ASP.NET Core output caching: anonymous-readable
endpoints (`[AllowAnonymous]` GETs like event/session/speaker catalogs) carry named 5-minute
policies with tag-based eviction, primed by startup warmup and load-tested by k6.

That design was silently inert for the traffic that matters. The shared UI HttpClient pipeline
attaches the stored Bearer token to every outgoing API request via `AuthDelegatingHandler`,
including reads of public endpoints whose payload is identical for every caller. ASP.NET Core's
built-in default output-cache policy refuses both cache lookup and cache storage for any request
carrying an `Authorization` header (or an authenticated identity). The result: every logged-in
user bypassed the output cache on every read, and on conference day (when every attendee is
logged in) 100% of agenda/session/speaker reads landed on Basic-tier SQL. The gap was invisible
in load evidence because the k6 scripts and the warmup requests are anonymous, which is exactly
the traffic slice the default policy still cached.

Two ways out were considered:

1. Route public reads through a second, unauthenticated named HttpClient in the UI.
2. Replace the default policy server-side for the affected endpoints.

Option 1 bifurcates the UI's HTTP stack (two clients, two resilience pipelines, per-call-site
decisions that silently regress when someone picks the wrong client) and still leaves any other
authenticated caller (mobile hosts, cross-service calls, curl with a token) uncached.

## Decision

`MMCA.Common.API` ships `PublicEndpointOutputCachePolicy`, an `IOutputCachePolicy` that mirrors
the built-in default policy with one deliberate difference: it does not disable cache lookup or
storage when the request carries an `Authorization` header or an authenticated identity. It
enforces the same response-side guards (GET/HEAD only; never store `Set-Cookie` responses or
non-200s), varies the cache key by every query-string parameter (`CacheVaryByRules.QueryKeys =
"*"`, the same rule as the default policy; a raw `IOutputCachePolicy` registration replaces the
whole default chain, so the policy must restate it), and takes the expiration and eviction tags
as constructor arguments.

Hosts register it per named policy via the `OutputCacheOptions.AddPublicEndpointPolicy(name,
expiration, tags)` extension and reference it from `[OutputCache(PolicyName = ...)]` exactly like
any built-in policy. Tag-based eviction from mutating commands is unchanged.

The contract for applying it is strict: ONLY endpoints that are `[AllowAnonymous]` AND whose
response does not vary by caller identity. A cached response is served verbatim to every
subsequent caller, so a user-dependent payload behind this policy is an information-disclosure
bug, not a perf tweak.

One bounded relaxation exists for role-elevated payloads: the `AddPublicEndpointPolicy(name,
expiration, bypassRoles, tags)` overload makes callers in a bypass role skip the cache entirely
(no lookup, no storage), so they always read fresh and their elevated responses are never stored.
Use it when the payload is identical for every caller EXCEPT one privileged role (e.g. ADC
organizers see unpublished rows per BR-108). Per-user payloads remain out of scope: bypass roles
handle role-shaped variance, not identity-shaped variance.

## Rationale

- The response payload, not the request's auth state, is what determines cacheability. For a
  user-independent payload, `Authorization` is noise; refusing to cache on it turns the whole
  read-scaling mechanism off for the real workload.
- A server-side policy fixes every caller (UI, MAUI hosts, service-to-service, tooling) at the
  single point that owns the endpoint's caching semantics, instead of asking every client to
  special-case its transport.
- Constructor-parameterized expiration/tags keep the policy self-contained and testable; it does
  not depend on builder-chain internals that assume the default policy runs first.

## Trade-offs

- Consumers must audit which named policies move to `AddPublicEndpointPolicy`. Policies on
  permission-gated endpoints (e.g. an organizer dashboard) must NOT move; if such an endpoint
  needs caching, that is a separate decision with per-user vary rules.
- The output-cache store must be Redis-backed wherever the service runs more than one replica.
  **This supersedes the original trade-off, which accepted a per-replica in-memory store and its
  bounded staleness window.** That acceptance did not survive contact with the deployed topology:
  ADC's Conference service and Store's Catalog service both run `maxReplicas: 2`, so every
  `EvictByTagAsync` reached only the replica that handled the mutation and the other kept serving
  the pre-edit payload for the full 5-minute TTL. An organizer renaming a session, or an admin
  repricing a product, saw the change apply to roughly half of subsequent reads at random. Each
  replica also filled its own copy of the cache, doubling cold-database traffic on exactly the
  Basic-tier databases this policy exists to protect, and in Store's case a few multi-megabyte
  image entries per replica crowded out the product and category JSON that matters most.

  Both apps had Redis provisioned and already wired as `IDistributedCache`, so closing this was a
  registration (`AddStackExchangeRedisOutputCache`) rather than new infrastructure. Note that
  `AddOutputCache` registers its store with `TryAdd`, so an explicit Redis registration wins
  regardless of call order.

  A single-replica service may still use the in-memory store: with one replica there is no
  propagation problem to solve. The rule is about replica count, not about environment.

- Tag eviction only reaches caches the mutating process can address. A mutation owned by a
  DIFFERENT service cannot evict this one's entries at all, and no store choice fixes that: ADC's
  bookmark counts are written by Engagement and read through Conference, so they carry a short TTL
  instead of relying on eviction. When adding a cached endpoint, check which process owns every
  write that can change its payload.
- Cache hit rate becomes meaningful for authenticated load tests; k6 scripts that log in now
  exercise the same cache path as anonymous ones.
