# ADR-040: Authenticated output caching for public reads

## Status

Accepted (2026-07-10). Amended (2026-07-10): explicit query-string variance parity with the
built-in default policy (the initial release accidentally dropped it, collapsing every query
variant of a path onto one cache entry), plus an opt-in `bypassRoles` escape hatch for endpoints
whose payload is elevated for one privileged role. Amended (2026-07-25): a shared Redis-backed
output-cache store is now the expected posture for any multi-replica deployment; the per-replica
in-memory store is the single-replica case, not the accepted default (see Trade-offs). Amended
(2026-08-01): the bypass is a shared, singly-declared privileged read AUDIENCE, not one role (ADC
names two, `Organizer` and `ContentEditor`, and the API-layer visibility check reads the same
list), and it now backs almost every public policy rather than a lone exception; five minutes is
the usual TTL, not the rule, since a clock-dependent or cross-service payload takes a shorter one
(see Decision and Trade-offs). Amended (2026-08-14): ADC's public-policy set grew to ten with
`SponsorsCache`, and nine of the ten now pass the bypass audience; `NowNextCache` remains the only
policy without it. Amended (2026-08-19): the cross-service eviction limit in
Trade-offs is narrowed by [ADR-026](026-caching-strategy.md)'s Revision (2026-08-18): a mutation in
another service can now request this host's tag eviction over the outbox, broker and inbox path via
`OutputCacheEvictionRequested`, best-effort and per tag, and ADC's bookmark counts now pair that
event with their short TTL rather than relying on the TTL alone (see Trade-offs). Amended
(2026-08-31): ADC's public-policy set is eleven with `ActivitiesCache`, and ten of the eleven pass
the bypass audience; `NowNextCache` remains the only policy without it.

## Context

The framework's read-scaling design leans on ASP.NET Core output caching: anonymous-readable
endpoints (`[AllowAnonymous]` GETs like event/session/speaker catalogs) carry named policies with
tag-based eviction, primed by startup warmup and load-tested by k6. Five minutes is the usual TTL
and every Store Catalog policy uses it
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:141-146`), but it is a default,
not a rule: ADC runs two 60-second policies whose payload cannot wait five minutes (`NowNextCache`,
a clock-dependent now-and-next snapshot, and `BookmarkCountsCache`, written by another service;
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:229,241`).

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
Use it when the payload is identical for every caller EXCEPT a privileged read audience (ADC's
audience is two roles, `Organizer` and `ContentEditor`, who see unpublished rows per BR-108).
Per-user payloads remain out of scope: bypass roles handle role-shaped variance, not
identity-shaped variance.

That audience is declared ONCE and shared, never restated per policy. ADC keeps it in
`ConferenceReadAudience.PrivilegedRoles`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:26-30`)
and the API-layer visibility check reads the same list
(`CurrentUserServiceExtensions.IsPrivilegedConferenceReader`,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:25`).
Two lists naming different roles would put a privileged payload in the shared public entries and
serve it to everyone, so the single declaration is the guard, not a convention. Nor is the bypass a
narrow exception in practice: ten of ADC's eleven public policies pass it
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:213-241`), the exception being
`NowNextCache`, whose published-data payload is identical for every role. Breadth has a second
driver that role-shaped variance does not cover: the admin surfaces read back right after mutating
and not every write path evicts tags, so a cached stale row version makes the next save throw
`DbUpdateConcurrencyException` (`Program.cs:204-205`).

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
  ADC's Conference service and Store's Catalog service both run `minReplicas: 1, maxReplicas: 2`
  with an HTTP scale rule at 50 concurrent requests, so every `EvictByTagAsync` reached only the
  replica that handled the mutation and the other kept serving the pre-edit payload for the full
  5-minute TTL.

  **Be precise about when this bites: it is a LATENT defect, not a continuously active one.** Both
  services sat at one live replica at ordinary traffic when the running apps were checked on
  2026-07-25. That is a runtime observation, not a repo fact: the committed Bicep pins only the
  allowed range (`minReplicas: 1, maxReplicas: 2`), so re-checking the live count means looking at
  Azure again. At one replica there is nothing to propagate. The staleness appears only once the scale rule adds the second
  replica, which is to say under exactly the load the cache exists to absorb: ADC conference day
  (~67 peak concurrent) and a Store traffic spike. At that point an organizer renaming a session,
  or an admin repricing a product, sees the change apply to roughly half of subsequent reads at
  random. Each replica also fills its own copy, doubling cold-database traffic on the Basic-tier
  databases this policy protects, and in Store's case a few multi-megabyte image entries per
  replica crowd out the product and category JSON that matters most.

  A defect that only surfaces at peak is a worse one to carry, not a lesser one: it cannot be
  reproduced in the steady state and it arrives when there is least room to diagnose it.

  Both apps had Redis provisioned and already wired as `IDistributedCache`, so closing this was a
  registration (`AddStackExchangeRedisOutputCache`) rather than new infrastructure. Both hosts put
  that registration in the same Redis-connection-string branch as `AddRedisDistributedCache` rather
  than next to `AddOutputCache`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:140`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:96`), leaning on the framework
  behavior their comments state (`Program.cs:136` and `:93`): `AddOutputCache` registers
  its store with `TryAdd`, so an explicit Redis registration wins regardless of call order. Read that as
  framework behavior per those host comments; nothing in these repos verifies it.

  A single-replica service may still use the in-memory store: with one replica there is no
  propagation problem to solve. The rule is about replica count, not about environment.

- Tag eviction reaches directly only the caches the mutating process can address; crossing a
  service boundary takes an explicit eviction event. Since [ADR-026](026-caching-strategy.md)'s
  Revision (2026-08-18), a mutation owned by a DIFFERENT service can request eviction through
  `OutputCacheEvictionRequested` over the existing outbox, broker and inbox path, best-effort and
  per tag. ADC's bookmark counts, written by Engagement and read through Conference, now use
  exactly that: `UserSessionBookmarkCacheEvictionHandler`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:43`,
  raising the event at `:77`) with the Conference host consuming it (`AddOutputCacheEvictionHandler()`
  at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:247`,
  `RegisterOutputCacheEvictionConsumer()` at `:350`), keeping the short TTL as the backstop for a lost
  or late event rather than the only defense (`BookmarkCountsCache`, 60 seconds, `Program.cs:241`).
  A payload that changes on the clock still has no mutation to evict on, so a short TTL remains its
  whole answer (`NowNextCache`, 60 seconds, `Program.cs:229`). When adding a cached endpoint, check
  which process owns every write that can change its payload, and whether time alone changes it.
- Cache hit rate becomes meaningful for authenticated load tests; k6 scripts that log in now
  exercise the same cache path as anonymous ones.
