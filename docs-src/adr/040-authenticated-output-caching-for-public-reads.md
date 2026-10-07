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
(2026-08-31): ADC's public-policy set gained `ActivitiesCache`, and `NowNextCache` remains the only
policy without the bypass audience. Revised 2026-09-10: Store's `CustomerErasedHandler` publishes
`OutputCacheEvictionRequested` and the Catalog host registers both eviction halves (see the
Revision (2026-09-10)). Revised 2026-09-25: ADC's public-policy set is twelve and
eleven pass the bypass audience (the site-wide `ConferencePublicCache` and `BookmarkCountsCache`
among them); Store's `ProductsCache` runs a 60-second TTL because a variant's effective price moves
on the clock; both hosts register the Redis output-cache store unconditionally through the
framework wrapper; anchors refreshed (see the Revision (2026-09-25) at the end). Revised
2026-10-01: anchors only (see the Revision (2026-10-01)). Revised 2026-10-06: ADC bookmark eviction
is raised by a paced hosted processor, the admin-freshness driver is broker-round-trip latency rather
than unevicted writes, and ADC Conference scales to four replicas in conference mode (see the
Revision (2026-10-06)). Revised 2026-10-07: the Decision now records the policy's tenant vary
rule (the key varies by the resolved tenant) and its wide `HasRole` bypass check, and anchors are
refreshed after the v1.233.0 release (see the Revision (2026-10-07)).

## Context

The framework's read-scaling design leans on ASP.NET Core output caching: anonymous-readable
endpoints (`[AllowAnonymous]` GETs like event/session/speaker catalogs) carry named policies with
tag-based eviction, primed by startup warmup and load-tested by k6. Five minutes is the usual TTL,
but it is a default, not a rule: a payload that cannot wait five minutes takes a shorter one. Three
of Store Catalog's four policies run five minutes
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:152`, `:153`, `:162`), while
`ProductsCache` runs 60 seconds because each variant's effective price moves on the clock when a
discount window opens or closes, with no mutation to evict on (`:159`, the reasoning at
`:154-158`). ADC runs two 60-second policies (`NowNextCache`, a clock-dependent now-and-next
snapshot, and `BookmarkCountsCache`, written by another service;
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:286,300`).

That design was silently inert for the traffic that matters. The shared UI HttpClient pipeline
attaches the stored Bearer token to every outgoing API request via `AuthDelegatingHandler`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:34-40`; a
request that sets the `SkipBearer` option, which the token-refresh POST does, passes through
untouched, `:18-22`, `:29`), including reads of public endpoints whose payload is identical for
every caller. ASP.NET Core's
built-in default output-cache policy refuses both cache lookup and cache storage for any request
carrying an `Authorization` header (or an authenticated identity). The result: every logged-in
user bypassed the output cache on every read, and on conference day (when every attendee is
logged in) 100% of agenda/session/speaker reads landed on Basic-tier SQL. The gap was invisible
in load evidence because the k6 scripts of the time and the warmup requests were anonymous, which
is exactly the traffic slice the default policy still cached.

Two ways out were considered:

1. Route public reads through a second, unauthenticated named HttpClient in the UI.
2. Replace the default policy server-side for the affected endpoints.

Option 1 bifurcates the UI's HTTP stack (two clients, two resilience pipelines, per-call-site
decisions that silently regress when someone picks the wrong client) and still leaves any other
authenticated caller (mobile hosts, cross-service calls, curl with a token) uncached.

## Decision

`MMCA.Common.API` ships `PublicEndpointOutputCachePolicy`, an `IOutputCachePolicy` that mirrors
the built-in default policy with two deliberate departures, one relaxation and one tightening. The
relaxation: it does not disable cache lookup or storage when the request carries an
`Authorization` header or an authenticated identity
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:83-90`). It
enforces the same response-side guards (GET/HEAD only; never store `Set-Cookie` responses or
non-200s), varies the cache key by every query-string parameter (`CacheVaryByRules.QueryKeys =
"*"`, the same rule as the default policy; a raw `IOutputCachePolicy` registration replaces the
whole default chain, so the policy must restate it), and takes the expiration and eviction tags
as constructor arguments. The tightening, which the default policy lacks: when a tenant has
been resolved for the request, the key varies by `ITenantContext.TenantId` under
`VaryByValues["t"]`, so one tenant's rows are never served to another from the shared entry
(`PublicEndpointOutputCachePolicy.cs:98-106`,
the key constant at `:50`). An unresolved tenant (a single-tenant host, a background call) adds
nothing, and the vary rule is a backstop, not a license: a caller-dependent payload still must not
use this policy (`:37-42`).

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
identity-shaped variance. Membership is checked with the framework's wide `HasRole` extension
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:75-77`, which reads
`ClaimTypes.Role` plus bare `role`/`roles` claims and compares case-insensitively, `:59-67`), not
the BCL `ClaimsPrincipal.IsInRole`, which matches only the identity's own role claim type: against an identity provider
that emits bare `role`/`roles` claims, `IsInRole` would miss the bypass while the permission
handler granted the elevated payload, and that response would be stored under the shared public
key (`PublicEndpointOutputCachePolicy.cs:137-142`).

That audience is declared ONCE and shared, never restated per policy. ADC keeps it in
`ConferenceReadAudience.PrivilegedRoles`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:34-38`)
and the API-layer visibility check reads the same list
(`CurrentUserServiceExtensions.IsPrivilegedConferenceReader`,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:24`).
Two lists naming different roles would put a privileged payload in the shared public entries and
serve it to everyone, so the single declaration is the guard, not a convention. Nor is the bypass a
narrow exception in practice: eleven of ADC's twelve public policies pass it
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:269-300`, the array at `:268`),
the exception being `NowNextCache` (`:286`), whose published-data payload is identical for every
role. Breadth has a second driver that role-shaped variance does not cover: the admin surfaces read
back right after mutating, and a write that never touches a controller (the BR-207 speaker
auto-link, an Engagement bookmark) evicts only by publishing `OutputCacheEvictionRequested`, a
broker round trip that is prompt but not instant (`Program.cs:253-259`), so a cached stale row
version makes the next save throw `DbUpdateConcurrencyException` (`Program.cs:260-262`).

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
  ADC's Conference service and Store's Catalog service both run `minReplicas: 1` with an HTTP scale
  rule at 50 concurrent requests and a ceiling of at least two replicas (Store `maxReplicas: 2`,
  `MMCA.Store/infra/main.bicep:1715`; ADC `conferenceScaledMaxReplicas`,
  `MMCA.ADC/infra/main.bicep:2067`, which is 2 normally and 4 with `conferenceMode` on, `:192`), so
  every `EvictByTagAsync` reached only the replica that handled the mutation and the others kept
  serving the pre-edit payload for the full 5-minute TTL.

  **Be precise about when this bites: it is a LATENT defect, not a continuously active one.** Both
  services sat at one live replica at ordinary traffic when the running apps were checked on
  2026-07-25. That is a runtime observation, not a repo fact: the committed Bicep pins only the
  allowed range (`minReplicas: 1` up to the ceilings above), so re-checking the live count means looking at
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
  registration rather than new infrastructure. Both hosts make it through the framework wrapper
  `AddRedisOutputCaching()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:91`), which
  holds the framework's single `AddStackExchangeRedisOutputCache` call (`:99`) and no-ops when the
  connection string is blank (`:94`), so each host calls it unconditionally, top-level, before
  `AddOutputCache`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:195`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:99`), leaning on the framework
  behavior their comments state: `AddOutputCache` registers its store with `TryAdd` (ADC
  `Program.cs:191-192`, Store `Program.cs:96-97`), so an explicit Redis registration wins regardless
  of call order (only the Store comment spells out that consequence). Read that as framework
  behavior per those host comments; nothing in these repos verifies it.

  A single-replica service may still use the in-memory store: with one replica there is no
  propagation problem to solve. The rule is about replica count, not about environment.

- Tag eviction reaches directly only the caches the mutating process can address; crossing a
  service boundary takes an explicit eviction event. Since [ADR-026](026-caching-strategy.md)'s
  Revision (2026-08-18), a mutation owned by a DIFFERENT service can request eviction through
  `OutputCacheEvictionRequested` over the existing outbox, broker and inbox path, best-effort and
  per tag. ADC's bookmark counts, written by Engagement and read through Conference, now use
  exactly that: `UserSessionBookmarkCacheEvictionHandler`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:37`)
  only signals a request (`:56`), and the hosted `BookmarkCacheEvictionProcessor` raises the event
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:71`),
  paced to at most one broadcast per 10-second `PacingWindow` per replica (`:46`) so a burst of
  stars cannot keep the tag permanently cold. The Conference host consumes it
  (`AddOutputCacheEvictionHandler()` at
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:306`, and
  `RegisterOutputCacheEvictionConsumer()` at
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/ConferenceBrokerConsumers.cs:37`, wired
  through `AddBrokerMessaging` at `Program.cs:419`), keeping the short TTL as the backstop for a
  lost or late event rather than the only defense (`BookmarkCountsCache`, 60 seconds,
  `Program.cs:300`). A payload that changes on the clock still has no mutation to evict on, so a
  short TTL remains its whole answer (`NowNextCache`, 60 seconds, ADC `Program.cs:286`; Store's
  `ProductsCache`, 60 seconds, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:159`, whose discount
  edits still evict the `catalog:products` tag at once but whose discount windows open and close with
  no write at all). When adding a cached endpoint, check
  which process owns every write that can change its payload, and whether time alone changes it.
- Cache hit rate becomes meaningful for authenticated load tests; k6 scripts that log in now
  exercise the same cache path as anonymous ones.

## Revision (2026-09-10)

**Store now uses the cross-service eviction path too, and the first case is an Application-layer
handler rather than a controller.** The trade-off above says to check which process owns every write
that can change a cached payload. Store's anonymous review list failed that check in a way the
controller-side eviction could not reach.

Catalog's `CustomerErasedHandler` consumes Identity's `CustomerErased` and clears the reviewer's
name, title and body while keeping the star rating (ADR-005 erasure across a database boundary),
looping the reviews at
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/IntegrationEventHandlers/CustomerErasedHandler.cs:89-96`
and saving at `:98`. Those three fields are exactly what the cached public list returns
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Reviews/PublicProductReviewDTO.cs:45`,
`:48`, `:51`), so before this change an erasure kept being served under the pre-erasure name for up
to the full five-minute TTL, on every replica. Store's eviction lived entirely in API controllers,
and an Application-layer handler has no `IOutputCacheStore` to call.

The answer is the one ADC already uses: publish the eviction rather than perform it. The handler
raises `OutputCacheEvictionRequested` for the `catalog:products` tag after the save
(`CustomerErasedHandler.cs:113`, the tag constant at `:59`, inside the publish block at `:108-115`),
wrapped in `BestEffort.ExecuteAsync` so a broker fault degrades the erasure to TTL-bounded staleness
instead of failing the consume and re-delivering it.

**Both halves are registered, because one alone is silently inert.**
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs` calls
`AddOutputCacheEvictionHandler()` at `:179` and `RegisterOutputCacheEvictionConsumer()` at `:286`.
The first registers the handler that evicts; the second subscribes the host to the message. A host
with only the handler never receives the event, and a host with only the consumer receives it and
does nothing, and neither mistake produces an error, only a cache that quietly stops being evicted.
The mechanism itself is framework code and needed no change
(`MMCA.Common/Source/Core/MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:111`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:108-110`).

**Unchanged and deliberate: Store registers no `bypassRoles` overload.** Its four public policies take
the no-bypass form (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:153-164`),
which is correct rather than an omission. The bypass exists for a privileged audience that reads the
same cached endpoint and needs to see more than it caches; Store has no such audience, because its
anonymous review list serves published rows only and moderator visibility is a separate,
permission-gated, uncached surface. Adding a bypass would be adding a partition nothing reads.

## Revision (2026-09-25)

**Store's `ProductsCache` TTL is 60 seconds, because its payload moves on the clock.** A product
payload carries each variant's effective price, and a discount window opening or closing changes
that price with no write to evict on, so under a five-minute TTL a cached product kept the old
price for up to five minutes past the window's edge. This record already gives a clock-dependent
payload a short TTL as its whole answer (Status, and the eviction trade-off above, with ADC's
`NowNextCache` as the precedent), and Store now applies it: `ProductsCache` expires after 60
seconds (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:161`, the reasoning at
`:156-160`). Discount edits still evict `catalog:products` immediately; `CatalogCache`,
`CategoriesCache` and `ProductImagesCache` keep five minutes (`:154`, `:155`, `:164`). The Context
now states the TTL mix.

**Both hosts register the shared output-cache store the same way.** ADC Conference and Store
Catalog each call the framework's `AddRedisOutputCaching()` unconditionally, top-level
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:193`,
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:98`), relying on the wrapper's own
blank-connection-string no-op
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:94`). The
multi-replica trade-off above now cites the wrapper rather than a per-host branch.

**ADC's public-policy count is twelve, and eleven pass the bypass audience.** The set is
`ConferencePublicCache` and `EventsCache` (`:268`, `:269`), eight more five-minute policies
(`:275-282`), `NowNextCache` (`:285`) and `BookmarkCountsCache` (`:297`); only `NowNextCache` omits
`adminBypassRoles`. The Decision's count and every ADC Conference anchor are refreshed. The
`bypassRoles` asymmetry between the two apps is unchanged and stays sanctioned, for the reason the
2026-09-10 revision gives.

## Revision (2026-10-01)

No decision or rationale changed. Citations in Context, Decision and Trade-offs are re-anchored to
the current hosts: ADC Conference `Program.cs` (the `adminBypassRoles` array at `:265`, the twelve
public policies at `:266-295` with `NowNextCache` at `:283` and `BookmarkCountsCache` at `:295`,
the `DbUpdateConcurrencyException` reasoning at `:257-258`, `AddRedisOutputCaching()` at `:194`,
`AddOutputCacheEvictionHandler()` at `:301`, `RegisterOutputCacheEvictionConsumer()` at `:413`) and
Store Catalog `Program.cs` (`CatalogCache` `:151`, `CategoriesCache` `:152`, `ProductsCache` `:158`
with its reasoning at `:153-157`, `ProductImagesCache` `:161`). The twelve/eleven bypass count and
Store's four no-bypass policies are unchanged. The Trade-offs wording on the `TryAdd` comments is
narrowed: the ADC comment (`Program.cs:190-191`) states only that `AddOutputCache` registers its
store with `TryAdd`, and only the Store comment (`Program.cs:95-96`) adds that the explicit
registration wins regardless of order. One observation, not a change: Store's `CatalogCache`
(`Program.cs:151`) is registered but no `[OutputCache(PolicyName = "CatalogCache")]` references it
in Store `Source`, so of the four Store policies three back endpoints. The earlier Revision sections
keep the anchors they were written with.

## Revision (2026-10-06)

- **ADC bookmark eviction is raised by a paced processor, not the handler.**
  `UserSessionBookmarkCacheEvictionHandler` only signals a request
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:56`);
  the hosted `BookmarkCacheEvictionProcessor` publishes `OutputCacheEvictionRequested`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:71`)
  at most once per 10-second `PacingWindow` per replica (`:46`). Trade-offs updated.
- **The admin-freshness driver for the broad bypass is restated.** Application-layer writes now do
  request eviction, so the reason is that their eviction is a broker round trip (prompt, not
  instant), not that some writes never evict
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:251-259`). Decision updated.
- **ADC Conference's replica ceiling is conditional.** `conferenceScaledMaxReplicas` is 2 normally
  and 4 with `conferenceMode` on (`MMCA.ADC/infra/main.bicep:191`, used at `:2033`); Store Catalog
  stays at `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:1715`). Trade-offs updated.
- **The anonymous-load-evidence sentence in Context is now past tense.** One k6 script now logs in
  and sends a Bearer token (`MMCA.ADC/Tests/Load/k6/conference-day-attendee-load.js:107`, `:157`),
  so "the k6 scripts are anonymous" no longer holds for every script.
- **Correction to the 2026-09-10 revision.** The cached anonymous review list does not return the
  reviewer name: `PublicProductReviewDTO` deliberately carries none
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Reviews/PublicProductReviewDTO.cs:8`,
  `:16-18`). Of the erased fields it returns `Title` (`:45`) and `Body` (`:48`); `:51` is
  `Status`. The list rides `ProductsCache`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ReviewsController.cs:90`),
  so the pre-erasure window is bounded by its 60-second TTL, not five minutes. The eviction
  publish that revision describes is unaffected.
- **The `RegisterOutputCacheEvictionConsumer` anchors moved.** The framework method is at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:158-160`;
  Store Catalog calls `AddOutputCacheEvictionHandler()` at `Program.cs:177` and
  `RegisterOutputCacheEvictionConsumer()` at `:290`.
- Anchors in Context, Decision and Trade-offs were re-verified against current source (ADC
  Conference `Program.cs` array `:266`, policies `:267-298`, `NowNextCache` `:284`,
  `BookmarkCountsCache` `:298`, `AddRedisOutputCaching()` `:195` with its comment `:191-192`; Store
  Catalog `Program.cs` policies `:152`, `:153`, `:159` (reasoning `:154-158`), `:162`,
  `AddRedisOutputCaching()` `:99` with its comment `:96-97`; `IsPrivilegedConferenceReader` at
  `CurrentUserServiceExtensions.cs:24`). Store's `CatalogCache` (`:152`) is still unreferenced.

## Revision (2026-10-07)

Re-verified against current source. The decision, the strict apply-only-to-identity-independent
contract, the twelve/eleven ADC bypass count, Store's four no-bypass policies and the three
60-second TTLs (ADC `NowNextCache` and `BookmarkCountsCache`, Store `ProductsCache`) are unchanged. What moved: the Decision now records two properties of the policy it did not
mention, and the ADC Conference and Bicep anchors shifted after the v1.233.0 release.

1. **The cache key varies by the resolved tenant.** `PublicEndpointOutputCachePolicy` stamps
   `ITenantContext.TenantId` into `VaryByValues["t"]` when a tenant is resolved
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:98-106`,
   the key constant at `:50`, the class-level SECURITY (tenancy) note at `:37-42`), so the policy is
   not only a relaxation of the default: it adds a tenancy tightening the default lacks. Decision
   updated.
2. **The bypass check is the wide `HasRole` read, not `IsInRole`** (`:137-142`), so an identity
   provider emitting bare `role`/`roles` claims cannot get an elevated response stored under the
   shared key. Decision updated.
3. **`AuthDelegatingHandler` has a `SkipBearer` opt-out.** It attaches the stored Bearer only when
   no `Authorization` header is set (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:34-40`),
   and a request carrying the `SkipBearer` option (the token-refresh POST) passes through untouched
   (`:18-22`, `:29`). Context updated; the reads the policy targets still carry the token.
4. Anchors re-verified against current source: ADC Conference `Program.cs` (`adminBypassRoles`
   array `:268`, the twelve public policies `:269-300`, `NowNextCache` `:286`,
   `BookmarkCountsCache` `:300`, the broker-round-trip reasoning `:253-259`, the
   `DbUpdateConcurrencyException` sentence `:260-262`, `AddRedisOutputCaching()` `:195` with its
   `TryAdd` comment `:191-192`, `AddOutputCacheEvictionHandler()` `:306`, `AddBrokerMessaging` with
   `ConferenceBrokerConsumers.Register` `:419`); `RegisterOutputCacheEvictionConsumer()` at
   `ConferenceBrokerConsumers.cs:37`; `MMCA.ADC/infra/main.bicep` (`conferenceScaledMaxReplicas`
   defined at `:192`, the Conference scale rule at `:2067`); Store Catalog `Program.cs` (policies
   `:152`, `:153`, `:159` with reasoning `:154-158`, `:162`, `AddRedisOutputCaching()` `:99`) and
   `MMCA.Store/infra/main.bicep:1715`; `RedisCachingExtensions.cs:91`, `:94`, `:99`. The earlier
   Revision sections keep the anchors they were written with.
