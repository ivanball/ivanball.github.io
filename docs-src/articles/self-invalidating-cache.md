# The self-invalidating cache that lives in the pipeline, not your handlers

> Series: MMCA.Common · Article #19 (deep-dive) · Pillar P2 · Group G09 · Rubric §10,§12 · ADR-026, ADR-040,
> ADR-073, ADR-077 ·
> Status: grounded in `Website/docs-src/onboarding/group-09-caching.md`, `MMCA.Common/AGENTS.md` (the CQRS
> Decorator Pipeline section), `Website/docs-src/governance/common-ArchitectureScorecard.md` (§10, §12),
> `Website/docs-src/adr/026-caching-strategy.md`,
> `Website/docs-src/adr/040-authenticated-output-caching-for-public-reads.md`,
> `Website/docs-src/adr/073-multi-tenancy-model.md` (the cache-key slice only), and
> `Website/docs-src/adr/077-hybridcache-substrate.md`. No em dashes.

**Subtitle:** A read-through cache is easy. Keeping it correct is the hard part. Here is a cache where a
write invalidates the reads it staled automatically, because invalidation lives in the pipeline instead
of in every handler.

---

Adding a cache is the easy 80%. Here is the read path almost everyone writes first:

```csharp
var cached = await _cache.GetAsync<ProductDto>(key);
if (cached is not null) { return cached; }
var product = await LoadProduct(id);
await _cache.SetAsync(key, product);
return product;
```

Reasonable. The hard 20% is the *other* side: the moment something changes the product, every cached read
of it is now a lie. So you start sprinkling `RemoveAsync` calls into your write handlers. The update
handler evicts one key. The bulk-import handler forgets. The price-change command evicts the product but
not the paged product list it appears in. Six months later you are debugging "the price updated in the
database but the API still shows the old one," and the cause is a missing eviction in a handler nobody
thought to touch.

Cache invalidation is famously one of the two hard problems in computer science. It gets *harder* when you
scatter it across every command handler that might stale a read. So MMCA.Common does not put it there. It
puts it in the pipeline.

## Why invalidation belongs in the pipeline, not the handler

A handler's job is one use case. The fact that succeeding at that use case happens to stale some cached
reads is a cross-cutting concern, not part of the use case. Tie the two together and you get the failure
mode above: invalidation is correct only in the handlers where someone remembered it.

The fix is the same Decorator-pattern move the whole CQRS pipeline is built on (covered in the pipeline
deep-dive). The cache logic lives in two decorators that wrap *every* command and query, and a handler
opts into caching by implementing a marker interface, not by calling the cache. The read path caches. The
write path invalidates. The handler does neither.

## The cache abstraction

The whole subsystem is small and deliberate. The Application layer depends on one port:

```csharp
public interface ICacheService
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct);
    Task<(bool Found, T? Value)> TryGetAsync<T>(string key, CancellationToken ct);   // presence, not just value
    Task<T?> GetFromSharedStoreAsync<T>(string key, CancellationToken ct);           // never a local copy
    Task SetAsync<T>(string key, T value, TimeSpan? expiration = null, CancellationToken ct = default);
    Task RemoveAsync(string key, CancellationToken ct);
    Task RemoveByPrefixAsync(string prefix, CancellationToken ct);   // the load-bearing one
    Task<long> IncrementAsync(string key, TimeSpan expiration, CancellationToken ct);
    Task<T> GetOrCreateAsync<T>(string key, Func<CancellationToken, Task<T>> factory,
                                TimeSpan? expiration = null, CancellationToken ct = default);
}
```

Four cache operations, two specialized reads, a counter primitive, and one composed read-through helper.
`RemoveByPrefixAsync` is the member that earns its keep. It is what lets a single write evict a whole *family* of cached reads
(every paged and filtered view under one prefix) in one call, without enumerating individual keys. It is
also why the backends had to be hand-built rather than pulled off the shelf: `IMemoryCache` has no key
enumeration, and `IDistributedCache` has no prefix delete. Four of the eight are default interface
members, so a hand-written implementer keeps compiling when one is added.

The two specialized reads each close a gap a plain `GetAsync` leaves open. `TryGetAsync` reports
presence separately from the value, because for a value type a miss and a cached `default` (`0`,
`false`, `Guid.Empty`) look identical. The default member infers presence from a non-null `GetAsync`
result, which is exact for reference and nullable types; the memory and distributed stores override it
with a real presence check, and the hybrid store does not, so through the hybrid backend a value-type
miss still reads as found.
`GetFromSharedStoreAsync` reads the shared store and never a process-local copy, for values whose change
on one replica must be visible on every other replica at once: single-use records (an OAuth exchange
code, a password-reset or email-confirmation token, the last accepted second-factor time step), the
registration counter read, and the two flags whose removal must be seen everywhere (the login lockout
flag and the soft-deleted-user marker). The hybrid backend below is the store that overrides it.
(`IncrementAsync` is the single entry point for the brute-force and rate-limit counters of ADR-029
instead of a read-then-write pair at each call site. The distributed and hybrid backends both override
it, each with the same read-modify-write shape rather than a Redis `INCR`, because `StackExchangeRedisCache`
stores every entry as a Redis hash (`absexp`, `sldexp`, `data`) and an `INCR` string at the same key
would fail the next read: the override buys one call site, not atomicity. The hybrid override keeps
both legs on L2, so no replica counts from a stale local copy.)

`GetOrCreateAsync` is the most interesting of the default members, because of who does *not* use
it. It is get, then take a per-key lock from a process-wide stripe,
double-check, run the factory, store the result. That is the read-through shape the query decorator below
implements, offered to the callers that are not queries. The decorators still do not route through it, and
the interface says so in its own remarks: `GetOrCreateAsync` caches whatever the factory returns,
unconditionally, including a failed `Result`. The decorator must not, so it keeps its own
read/execute/write sequence. A convenience helper that quietly relaxes a correctness rule is worth having
only if the code that depends on the rule stays off it.

`ICacheService` is defined in the Application layer; the concrete backend is chosen by DI at the
composition root. Handlers and decorators never see `StackExchange.Redis` or
`Microsoft.Extensions.Caching` directly. That is a textbook Clean Architecture port/adapter split: the
business code programs against the contract, the transport is a deployment concern.

## One contract, three backends

`AddCaching()` picks a backend by probing the container. If a real distributed cache is registered (an
`IDistributedCache` that is not the default `MemoryDistributedCache`, typically Redis wired by Aspire), it
builds a `DistributedCacheService`. Otherwise it falls back to a `MemoryCacheService` over the in-process
`IMemoryCache`. No flag, no per-environment branch in application code:

- **`MemoryCacheService`** is the single-instance fast path. Because `IMemoryCache` cannot enumerate its
  own keys, it maintains a side `ConcurrentDictionary` key set so it can satisfy `RemoveByPrefixAsync`,
  and keeps that index honest with a post-eviction callback so expired entries prune themselves rather
  than leaking.
- **`DistributedCacheService`** is the out-of-process adapter, serializing values to UTF-8 JSON. When a
  Redis `IConnectionMultiplexer` is available, prefix eviction reaches past `IDistributedCache` to the raw
  connection and uses server-side `SCAN` to find and delete matching keys (that scan lives in a shared
  `RedisPrefixScanner`, because two backends need it). This is the cache with a Redis
  backplane the architecture scorecard carries in its §10 row as related cross-cutting evidence,
  scored under §5, §6, §9, §12, §17 and §29, and whose
  substrate is recorded in ADR-026: a single-host monolith caches in-process for free, and the
  same code transparently uses a shared Redis once the distributed cache is present, so cached reads stay
  coherent when a module is scaled out or extracted into its own service.

That auto-swap covers two of the three implementations. The third sits outside the probe, which
deliberately never selects it, so a host has to ask for it by name:

- **`HybridCacheService`** puts an in-process L1 in front of the distributed L2, over
  `Microsoft.Extensions.Caching.Hybrid`, so a repeat read inside one replica never leaves the process
  while invalidation still crosses replicas through L2. It is opt-in: a host calls `AddCommonHybridCache()`
  and that call replaces whatever `ICacheService` was registered, in either call order. Its defining
  constraint is a keyspace rule, not a performance one. `HybridCache` writes its own payload layout, which
  is not the UTF-8 JSON the distributed adapter writes, so it writes under a disjoint `hc:` keyspace: an
  old-format entry is simply invisible to the new service and vice versa, including while a rolling deploy
  runs both. That rule generalizes a real failure this framework already shipped once, a Redis `INCR`
  counter written as a string and read back by a hash-shaped path, which answered `WRONGTYPE` and
  surfaced as a 500 on the endpoints owning the counter (registration and login). Two serialization formats must never share one keyspace, so the second
  writer gets its own.

Be honest about what "opt-in" means in a deployed system: all seven ADC and Store services call
`AddCommonHybridCacheWhenRedisConfigured(builder.Configuration)`, a framework helper that registers the
hybrid backend only when the Redis connection string is set (with no Redis L2 the hybrid tier would be a
plain in-memory cache, which the memory fallback already is). So whenever Redis is configured, the
effective Tier-1 substrate in production is the hybrid one, not the distributed adapter, and the
memory-or-Redis swap is what a host gets when it does *not* state a preference. The contract that makes that
substitution a one-line change is the point. Nothing in any handler, decorator, or query changes.

A short, conservative default TTL keeps the cache erring toward correctness over hit-rate: 30 seconds.
The constant sits in one place (`CacheOptions.DefaultDuration`, a bare `TimeSpan`) precisely so the
hybrid backend, whose entry options are a different type entirely, defaults to the same policy instead of
hard-coding the figure a second time, and one binding layer sits above it: `CacheSettings.DefaultDuration`
is bound from the `Cache` configuration section, defaults to that same constant, and is what all three
backends (memory, distributed and hybrid) actually read, so a host can retune the figure without any
two of them disagreeing. A query only earns a longer life when it explicitly declares one.

## The read path: opt in by marker interface

A query caches by implementing `IQueryCacheable` (it supplies the cache key and the retention duration).
The `CachingQueryDecorator` does the read-through:

```csharp
public sealed record GetProductQuery(int ProductId) : IQueryCacheable
{
    public string CacheKey => $"Catalog:Products:{ProductId}";
    public TimeSpan CacheDuration => TimeSpan.FromMinutes(5);
}
```

On a hit, the decorator returns the cached value and the handler never runs, with no lock on that fast
path. On a miss it takes a per-key lock from a fixed-width stripe shared process-wide, re-checks the
cache, and only then runs the inner handler and stores the result, **but only when the `Result` is not a
failure**, so error states are never cached. That double-check is stampede protection: when a hot key
expires under load, one request per process runs the handler and the waiters are served the entry it just
wrote. The guarantee is per process, not cluster-wide, and deliberately so: a shared-cache deployment
gets at most one execution per instance, which is harmless duplication rather than a distributed lock.
The wait on that lock is itself bounded and fail-open: `QueryCachePipelineSettings.PopulateLockTimeout`
(bound from `Cache:PopulateLockTimeout`, unbounded by default) arms a linked cancellation budget, and a
waiter that exhausts it logs at Debug, counts a miss, and runs the query uncached instead of failing,
while a genuine cancellation still propagates. Stampede protection is an optimization, so it degrades
like one. A query that does not implement the interface is passed straight through, paying nothing.

## The write path: invalidate on success, outside the transaction

A command invalidates by implementing `ICacheInvalidating`, which exposes a `CachePrefix`. The
`CachingCommandDecorator` runs the inner handler first, then evicts:

```csharp
public sealed record UpdateProductCommand(int ProductId, decimal NewPrice)
    : ICacheInvalidating, ITransactional
{
    public string CachePrefix => "Catalog:Products";
}
```

The decorator calls `RemoveByPrefixAsync("Catalog:Products")` only when **three conditions** hold: the
command implements `ICacheInvalidating`, its `CachePrefix` is not blank, *and* the `Result` is not a
failure. The blank-prefix guard is not a formality: `RemoveByPrefixAsync("")` would evict the entire
cache, so an empty or whitespace prefix is the deliberate opt-out for a command that carries a defaulted
prefix. Two consequences follow that matter:

- **Failed commands skip invalidation.** If the write did not persist, there is nothing stale to evict, so
  the cache is left intact. (This is the same business-failure rule the transactional decorator follows:
  a failed `Result` rolls the transaction back, exactly like an exception, and skips invalidation.)
- **Invalidation runs outside the transaction boundary.** Because the caching decorator sits *outside* the
  transactional decorator in the pipeline, eviction happens after the inner transaction has committed.
  Eviction is against committed state, never in-flight state. You can never evict valid cache for a
  mutation that then rolls back.

That prefix eviction clears every read the mutation could have staled. The price change under
`"Catalog:Products"` drops the single-product read *and* every paged and filtered product list cached
under that prefix, in one operation. The handler that changed the price did not name a single cache key.

It evicts twice, though, and the second one is the interesting part. A read that missed the cache
*before* this command committed can still be running its handler against pre-write state and repopulate
the entry a moment after the first eviction lands. So the decorator schedules a second, fire-and-forget
eviction of the same prefix five seconds later, which removes that repopulated entry. Both evictions are
best-effort and deliberately non-cancellable (they run on `CancellationToken.None`, because the command
has already committed and a client that walks away must not strand stale entries), and any failure is
logged at warning level and swallowed: a cache outage must never turn a committed command into a failed
one. Whatever the two evictions cannot clear still expires on its own TTL.

## Swallowing a failure is a discipline, not a `catch`

That swallow is the right call here and a dangerous habit everywhere else, so the framework gives it a
name: `BestEffort.ExecuteAsync(operation, logger, action, ct)`, for a side effect that must never fail
its caller. It awaits the action, and turns any non-cancellation failure into exactly one Warning log
plus one increment of `besteffort.dispatch.failed` on a `MMCA.Common.BestEffort` meter, tagged by the
operation name. Three details are what separate it from a bare `catch (Exception)`:

- **Cancellation is rethrown, not swallowed.** When the caller's own token is the reason the action
  stopped, the `OperationCanceledException` propagates, so a host shutdown or an abandoned request
  unwinds promptly instead of being recorded as a spurious failure. A side effect that must outlive the
  request passes `CancellationToken.None` itself, exactly as the eviction above does.
- **The failure is counted, not just logged.** A side effect that has quietly stopped working shows up
  as a metric an operator can alert on, rather than only as a warning in a log nobody reads.
- **The operation name is a metric tag**, so it has to be a short low-cardinality constant. That is a
  real constraint on the caller, and it is the price of the signal.

Be honest about its reach: it is a helper, not a rule the compiler enforces, and the two caching
decorators still hand-roll the same shape against their own logger. The API package does route through
it: its best-effort tag-eviction extension, `TryEvictTagsAsync`, wraps each `EvictByTagAsync` in
`BestEffort.ExecuteAsync` under `CancellationToken.None`, so the posture crosses the package boundary
rather than stopping at the Application layer (its sibling `EvictTagsAsync` is the plain variant: it
evicts on the caller's token and lets a failure propagate). The cross-service eviction consumer in the edge-tier section below is the one caller
that still hand-rolls the swallow, log and count, against its own `cache.eviction.failed` instrument. The
portable part is the shape, not the call site. Log once, count once, never rethrow, except cancellation.

## The two key transformations the pipeline applies

Everything above treats the query's `CacheKey` and the command's `CachePrefix` as literal strings. At the
decorator layer there are two exceptions, and they are the parts of key design the framework refuses to
leave to you, because getting either wrong leaks data rather than merely serving it late: tenant scoping
and caller scoping. The query decorator composes them in one expression,
`TenantCacheKey.Scope(tenantContext, UserCacheKey.Scope(cacheable, cacheable.CacheKey))`. Take the
tenant one first.

`ICacheService` is a singleton and cannot observe a scoped tenant, so a key that two tenants both compute
would serve one tenant's rows to the other. That is not a stale-cache bug, it is a data-leak bug. So
isolation is applied one layer up, where the key is computed: both decorators take an optional
`ITenantContext` and run the key or prefix through a single helper, `TenantCacheKey.Scope`, which returns
`t:{tenantId}:{key}` when a tenant is resolved and the untouched key when none is. Three properties fall
out of that shape:

- **It is a prefix, not a suffix**, so prefix eviction keeps working. Evicting `t:acme:products` removes
  that tenant's product entries and nothing else, and no command in one tenant can evict another tenant's
  cache.
- **Both decorators call the same helper**, which is what keeps reads and invalidations symmetric. A query
  cached under `t:acme:products` is evicted by a command whose prefix became `t:acme:products` through
  exactly the same transformation. Scoping one side only would be worse than scoping neither: the write
  would evict a key nobody wrote.
- **With no tenant resolved, keys are byte-identical to the pre-tenancy framework.** A single-tenant host
  keeps its keyspace and no cache entry is orphaned by upgrading.

The stampede stripe locks the same scoped key, so one tenant never waits on another tenant's lock. And the
honest limit: this lives in the decorators, so code that resolves `ICacheService` directly gets no tenant
prefix at all. Today's direct consumers (login and registration counters, OAuth exchange state,
idempotency records, password-reset and email-confirmation tokens, the last accepted second-factor time
step, the soft-deleted marker) are keyed by subject already, so they are safe by the shape of their keys rather than by a rule that would catch the
next one. The rest of the tenancy model (resolution middleware, the named query filter, the write
interceptor, database-per-tenant routing) is ADR-073's, and belongs to the multi-tenancy deep-dive.

The second transformation answers the parameter that is never on the request: who is asking. A query
implementing `IUserScopedRequest` (a "my orders" or "my profile" read) has its key scoped to the caller
by `UserCacheKey.Scope`, which appends `:u:{UserId}` unless the query opts out of caller scoping by also
implementing `ISharedQueryCache`. Without it, two users compute one key against one shared cache and the
second is served the first's rows for the whole cache duration. That marker is a *suffix*, and the
asymmetry with the tenant prefix is deliberate: a caller segment inserted ahead of the key would put
every user's entry outside the prefix an invalidating command computes, so nothing would ever be evicted.
Appended, the prefix stays intact and one command still clears every caller's copy. Over-eviction across
users is harmless; the leak it closes is not.

Two further transformations do happen, but underneath the port rather than in key design. The
distributed and hybrid backends prepend a service namespace to every key on get, set, remove *and* the
prefix scan, so two services sharing one Redis instance cannot collide. It is bound from
`Cache:KeyPrefix`, and left unset it is not empty: the framework resolves a per-application default of
`{application namespace}:`, because an empty default would put two applications sharing one Redis into
one keyspace for both cache entries and distributed locks, silently. It is applied inside the adapter
rather than through `RedisCacheOptions.InstanceName` precisely so prefix eviction still matches the keys
that were actually written. The in-process backend skips it, its keyspace being private by construction.
The hybrid backend adds its `hc:` segment on top, for the serialization-format reason above. Neither
transformation changes what your key *means*: they are keyspace hygiene applied uniformly under the
contract, which is why tenant and caller scoping stay the only places the framework decides part of your
key for you.

## What the cache is, and is not

This is a request-result read-through cache for query handlers. It is not a session store and not a
write-behind buffer. The cross-source consistency mechanism in this framework is the outbox (ADR-003,
ADR-006), not the cache. The short default TTL and the failure-skipping rules are the right defaults for
an opt-in cache layered onto a database-per-service system: it errs toward correctness over hit-rate.

ADR-026 decides two tiers, and this `ICacheService` substrate is the first. The second is an HTTP
output-cache edge (`app.UseOutputCache()`, with per-host opt-in policies) that lets a public read
endpoint skip the handler entirely. A third sits in the framework as a capability rather than a
decision: `IUiReadCache`, a read-through cache in front of the API client, registered scoped by the UI
package so it is one instance per Blazor Server circuit, and keyed on the relative URL to line up with
the edge tier's query-string variance rule. It ships and it is wired, and no consumer app switches it
on. The edge tier is host-configured rather than part of the pipeline, but it hides a correctness trap
sharp enough to earn the section that follows.

## The edge tier: caching authenticated reads without leaking identity

Tier 2 sits in front of the handler instead of inside the pipeline. `MMCA.Common.API` always calls
`app.UseOutputCache()` but ships no policies: each host opts in. A read-heavy public service (ADC's
Conference service, Store's Catalog) declares named short-TTL policies on its `[AllowAnonymous]` GET
controllers, so an anonymous agenda or speaker read is served straight from the output cache and never
reaches a query handler. Store's Catalog runs four such policies, three at 5 minutes and
`ProductsCache` at 60 seconds, because a product payload carries each variant's effective price, which
moves on the clock when a discount window opens or closes with no mutation to evict on; ADC's
Conference service runs twelve, ten at 5 minutes and two at 60 seconds where the payload turns over
faster. This is also the lever ADR-019 leans on: the global rate limiter partitions by authenticated user
and routes anonymous traffic to a `NoLimiter` partition, so output caching, not a throttle, is what
absorbs that load.

The sharp mismatch sits in ASP.NET Core's built-in default output-cache policy, which
refuses *both* cache lookup and cache storage for any request carrying an `Authorization` header or an
authenticated identity. The framework UI attaches a Bearer token to *every* outgoing API request,
including reads of these `[AllowAnonymous]`, user-independent endpoints. So the default caches the traffic
that does not matter (anonymous) and skips the traffic that does (logged-in): on a conference day, when
every attendee is signed in, 100% of the agenda, session, and speaker reads bypass the cache and hit a
Basic-tier SQL database. The gap is one load evidence cannot see, because the k6 scripts and the startup
warmup requests are anonymous, exactly the slice the default policy still caches.

You can register a raw `IOutputCachePolicy` for those endpoints, and here is the sharp edge: a raw policy
registration replaces the *whole* default chain, so you inherit none of the built-in policy's safeguards
and must restate every one by hand. Drop the query-string variance rule, for example, and every variant
of a path (search, paging, filters, field projections) collapses onto a single cache entry, so one
filter serves another filter's cached rows. Replacing a framework default is never a one-line swap; it
is a promise to re-implement everything the default did.

So the framework ships `PublicEndpointOutputCachePolicy`, an `IOutputCachePolicy` that mirrors the built-in
default except where it deliberately differs: it does not bail out on an `Authorization` header or an
authenticated identity, and it varies the cache key by the resolved tenant (`VaryByValues["t"]`, the
mirror of the `t:{tenantId}` prefix the decorators apply), because one path and query mean different rows
per tenant and the entry is shared. It re-implements the safeguards it displaced, GET/HEAD only, never
store a `Set-Cookie` response or a non-200, and vary the key by every query-string parameter
(`CacheVaryByRules.QueryKeys = "*"`, the exact rule a hand-rolled policy most easily drops). Hosts register it per named
policy via `OutputCacheOptions.AddPublicEndpointPolicy(name, expiration, tags)` and reference it from
`[OutputCache(PolicyName = ...)]` like any built-in policy.

The contract is strict, because the failure mode here is a data leak, not a slow page: apply it *only* to
endpoints that are `[AllowAnonymous]` *and* whose response does not vary by caller. A cached response is
served verbatim to every later caller, so a user-dependent payload behind this policy is an
information-disclosure bug, not a perf tweak. For a payload identical for everyone except a *privileged read
audience* (ADC organizers and content editors see unpublished rows), the `AddPublicEndpointPolicy(name,
expiration, bypassRoles, tags)` overload makes callers in a bypass role skip the cache entirely, so that
audience always reads fresh and its elevated responses are never stored. The audience is declared once and
shared, never restated per policy: ADC keeps it in a single `ConferenceReadAudience.PrivilegedRoles` list
(`Organizer`, `ContentEditor`) that both the host's bypass array and the API layer's read-visibility check
read, because two lists naming different roles would put a privileged payload into the shared public entries
and serve it to everyone. Nor is the bypass a rare exception: eleven of ADC's twelve public-read policies pass
it, and only `NowNextCache` (a 60-second now/next feed of published-only data) passes none, because its
response varies for nobody.

### Crossing a service boundary with a tag-eviction event

The edge tier's other limit is structural rather than sharp. `IOutputCacheStore` is a per-host store,
so a host can evict its own tags and nothing else. In a database-per-service system the write that
stales a cached read routinely happens somewhere else, so on its own the only invalidation that crosses
a process boundary is the expiry clock. The framework closes that distance with its first concrete
integration event, `OutputCacheEvictionRequested`, whose entire payload is a list of output-cache tags
(defaulting to empty, so a malformed or older message degrades to a no-op instead of a cache-wide
purge), and the consumer that answers it, `OutputCacheEvictionHandler`, which drops each tag from *this*
host's store through `EvictByTagAsync`. Delivery adds no channel: the owning service raises the event,
the outbox persists and publishes it, the broker carries it, the inbox dedups the redelivery. Nothing
here is transactional or exactly-once and it does not need to be, because evicting twice is free and
evicting late is what a TTL is for.

Eviction is per tag and best-effort: one failing tag does not abandon the rest, and a failure is logged
and counted on a `cache.eviction.failed` counter (meter `MMCA.Common.OutputCache`) rather than
rethrown. Rethrowing would hand the message back to the retry policy, re-evict every tag that already
succeeded, and eventually dead-letter a message whose worst outcome is an entry that expires on its own
TTL anyway. Only `OperationCanceledException` propagates, so a stopping host is not counted as a cache
failure.

ADC is the first worked case. Bookmark counts are owned by Engagement and served by Conference. Engagement's
bookmark handler subscribes to the *domain* event the aggregate raises on create, reactivate and delete
alike (the delete path runs on the framework's generic `DeleteEntityCommand` and has no handler of its
own to hook), and only raises a coalescing signal. A hosted `BookmarkCacheEvictionProcessor` drains
that signal, publishes the eviction carrying the tag `conference:sessions` inside
`BestEffort.ExecuteAsync`, then waits a ten-second pacing window before reading again. Conference
registers both halves: the handler in its service collection and the consumer inside its broker
configuration. An isolated star lands in about a broker round trip; a burst of stars at a session
changeover collapses into one trailing broadcast per window per replica, because one eviction per star
would keep that whole tag permanently cold under conference-day load. The 60-second TTL on `BookmarkCountsCache` is the backstop for
a dropped or delayed message, not the mechanism that clears the entry.

Store runs the same path from the other kind of caller. Catalog's `CustomerErasedHandler` consumes
Identity's `CustomerErased`, clears the reviewer's name, title and body while keeping the star rating,
then publishes the eviction for its `catalog:products` tag inside `BestEffort.ExecuteAsync`. That adopter
sits in an Application-layer integration-event handler rather than behind a write endpoint, which is the
shape to copy when the mutation that stales a cached read arrives as a message.

## Trade-offs, honestly

- **Cache key correctness is the consumer's responsibility.** The framework gives you read-through caching
  and prefix invalidation. It cannot know that `GetProductQuery`'s key and `UpdateProductCommand`'s prefix
  refer to the same data. If a query caches under `"Catalog:Product"` and a command invalidates
  `"Catalog:Products"`, the cache silently goes stale and nothing complains. The pipeline guarantees that
  invalidation *runs* on success; it does not guarantee that your keys and prefixes line up. That mapping
  is yours to design and test. The tenant prefix and the caller suffix above are the only exceptions, and
  they are a good model for the rule: the framework only takes over a piece of key construction when
  getting it wrong leaks data rather than merely serving it late.
- **Distributed prefix eviction needs a Redis `IConnectionMultiplexer`, and every deployed service wires
  one.** `RemoveByPrefixAsync` can scan-and-delete by prefix only when a multiplexer is in the container.
  All seven ADC and Store services reach Redis through one framework wrapper, `builder.AddRedisCaching()`,
  which registers the distributed cache and the multiplexer together and no-ops when the named connection
  string is blank, so whenever Redis is configured, prefix-based invalidation runs and cached reads are
  evicted on write. The hosts call that wrapper rather than Aspire's integrations directly, because the raw
  integrations register an untagged Redis health check that gates readiness (ADR-025). The 30-second TTL is
  the backstop only for the no-Redis case
  (in-memory mode), where prefix removal self-heals within the window instead. And when a multiplexer is
  absent, `DistributedCacheService` does not fail silently: it logs the dead invalidation once
  (`Interlocked`-guarded, so a mutating command does not flood the log) so an unwired backplane is
  observable instead of invisible. Single-key `RemoveAsync` is unaffected in either mode.
- **A cache outage degrades reads instead of failing them, and the one fail-open on the auth path has a
  bounded cost.** Every cache call in `CachingQueryDecorator` is fail-open: a failed read is logged at
  warning level and treated as a miss, so the query falls through to the inner handler and still answers
  correctly, just uncached, and it is *counted* as a miss so an outage shows up in the cache-hit metrics
  rather than hiding; a failed populate returns the handler's result uncached. Only
  `OperationCanceledException` is excluded from the guard, so a genuinely cancelled request still surfaces
  exactly as the inner handler would. A Redis outage therefore costs latency and database load, not a 500
  on every cacheable query. The same posture on the authenticated hot path is where it turns into a real
  trade-off: `SoftDeletedUserMiddleware` caches the soft-deleted marker, falls back to the validator query
  when that cache is unreachable, and proceeds open when the query fails too, rather than locking out every
  authenticated caller on one blip. The exposure that buys is bounded by access-token lifetime: tokens live
  15 minutes, and the deletion already revoked the refresh token, so the residual risk is one
  already-issued token running out its remainder while the cache or database is unhealthy. That bound is
  what makes the fail-open a deliberate choice rather than an accident of the code path.
- **Per-instance memory caches diverge, and the hybrid backend buys its L1 hit rate with a smaller
  version of the same problem.** The in-process backend is not shared across instances, so two hosts hold
  independent copies until each entry's TTL reconciles them. That is exactly why the distributed adapter
  exists for scaled-out deployments. The two-level backend narrows the window rather than closing it: an
  eviction clears L2 and the evicting process's L1, but every other replica's L1 copy survives until its
  local expiration, capped at 30 seconds by default (`Cache:LocalCacheDuration` retunes it). Single-use
  records, counters, and the flags that must clear everywhere at once (the login lockout flag and the
  soft-deleted-user marker) read through `GetFromSharedStoreAsync` or increment on L2 and skip L1
  entirely, so that window never applies to a token that must not be used twice or a flag that must not
  linger. That is a deliberate trade, and it is the same order of
  staleness as the delayed second eviction the write path already performs.
- **The edge tier trades a data-leak risk for its speed.** `PublicEndpointOutputCachePolicy` serves one
  cached response verbatim to every later caller, so it is safe only on endpoints that are
  `[AllowAnonymous]` and identity-independent. Adopting it is an audit, not a toggle: a permission-gated or
  per-user endpoint must never move onto it, and the bypass-roles overload covers role-shaped variance
  only, never per-user variance. The store behind it is the other thing to get right: `AddOutputCache`
  defaults to per-replica memory, so under scale-out a tag eviction reaches only the replica that handled
  the mutation. Both deployed adopters call the framework's `builder.AddRedisOutputCaching()`, which
  registers a Redis-backed output-cache store when the Redis connection string is set and no-ops
  otherwise, and ADR-040 makes the shared store the expected posture
  wherever a service runs more than one replica; the in-memory store is the single-replica case.
- **Cross-service tag eviction is a coherence hint, not a guarantee.** The eviction event is what lets a
  payload written by a different service be cleared from this one's edge cache at all, and that reach
  comes with four honest costs. It is asynchronous and unordered relative to the write, so the stale
  window is an outbox poll plus broker delivery plus the consumer's scheduling, and a reader can still
  observe the old response after the writer committed: keep the TTL as the floor. The tag vocabulary is a
  shared string contract nothing validates, and the producer's tag must match the consumer's policy
  exactly; a typo evicts nothing and *counts* nothing, because evicting an unknown tag succeeds, so the
  likeliest error is the one with no signal. Both registrations are opt-in per host and live in two
  different packages, and a host that wires one half gets silence rather than a build or startup error.
  And the two tiers do not meet: one mutation may need a Tier-1 prefix invalidation *and* a Tier-2 tag
  eviction, and nothing coordinates them. Before you cache an endpoint, check which process owns every
  write that can change its response. What the event buys is that "another service" is a wiring exercise
  rather than a dead end.
- **The cache path is not measured by any benchmark.** Common runs a `performance-smoke` CI job on every
  code-changing pull request (CI is deliberately pull-request-only, and a docs-only PR skips the two perf
  steps) that invokes the BenchmarkDotNet harness with `--filter "*" --job Short --exporters json`, then a
  `build/perfgate` step that verifies the results against a committed `perf-baseline.json` and fails on an
  allocation-ceiling or ratio regression, so it is a real latency-regression gate, not just a runs-clean
  smoke. It is a required merge gate too: its context is in the branch's required status checks, so a
  regression it catches blocks the merge. One caveat still keeps it from covering this design: the harness
  lives outside the `.slnx`, and its two suites benchmark the specification compiled-cache and composition
  plus the query filter/sort/shape pipeline, not these cache decorators. The caching design is sound, but
  its effect on the cache path is still not measured.

None of these are reasons to scatter invalidation back into handlers. They are the reasons to design your
keys deliberately and pick the backend that matches your topology.

## Apply this even without MMCA

The pattern ports to any stack with a decoratable handler pipeline:

1. Put the cache behind a **port** the business layer depends on (`Get`, `Set`, `Remove`,
   `RemoveByPrefix`), and choose the backend at the composition root.
2. Cache on the **read decorator**, never inside the query handler, and never cache a failure result.
3. Invalidate on the **write decorator**, on success only, and **after** the transaction commits.
4. Invalidate by **prefix**, not by enumerating keys, so one write clears every read it could have staled.
5. Accept that **key correctness is yours**: design the key-and-prefix mapping deliberately and test it.
6. If entries are scoped to anything the cache itself cannot see (a tenant, a caller, a region), apply
   that scope from **one helper both decorators call**, so reads and invalidations can never disagree,
   and pick its position by what your invalidation walks: a **prefix** when the scope should partition
   eviction too, a **suffix** when one eviction must still clear every scoped copy under one prefix.
7. When a cached response is built from data **another process owns**, do not settle for its TTL:
   broadcast the eviction as an event on the messaging path you already have, keep it per item and
   best-effort, and keep the TTL as the backstop for the message you drop.

The takeaway: **a read-through cache is a feature; a self-invalidating cache is a discipline. Move the
discipline into the pipeline and your handlers stop carrying it, one missing eviction at a time.**

---

**What we covered:** why scattering cache invalidation across handlers goes stale by omission, how
MMCA.Common's `ICacheService` port plus two pipeline decorators cache reads and invalidate writes
automatically, how one contract over three backends (memory, Redis, and the opt-in two-level hybrid every
deployed service selects) keeps the same code coherent from monolith to scaled-out service, why
invalidation runs on success outside the transaction and then runs again five seconds later, which two
pieces of key construction the framework takes over for you (the tenant prefix and the caller suffix),
why every cache call is fail-open
so an outage degrades to uncached reads instead of 500s, what `BestEffort.ExecuteAsync` makes of that
posture for any side effect that must not fail its caller, and how the HTTP edge tier caches authenticated
reads of public endpoints without leaking identity (ADR-040) and evicts across a service boundary over
an integration event instead of waiting out a TTL.

**Next in the series:** Problem Details across HTTP and gRPC, the one error-mapping table that turns
every Result failure into the same RFC 9457 shape on both transports.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the caching chapter of the onboarding
guide, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Caching, Software Architecture, Performance*

*Notes: anchors were re-read against the current tree on 2026-10-08 (framework v1.233.0,
`MMCA.Common/FACTS.md:14`, generated 2026-10-07 per `:4`) where the 2026-10-08 pass touched them; the rest
carry the 2026-10-02 reading and are marked "per the 2026-10-02 pass", and "per audit" marks an anchor
taken from an audit rather than re-read.
**2026-10-08 pass.** Six claims changed prose. (1) ADC's bookmark domain-event handler only raises a
coalescing signal (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:56`,
"Why it only raises a flag" `:20-25`); the hosted `BookmarkCacheEvictionProcessor`
(`MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:35`, registered at
`MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:24`) publishes `OutputCacheEvictionRequested`
inside `BestEffort.ExecuteAsync` (`:62-77`) and then waits `PacingWindow`, 10 seconds (`:46`, delay `:79`;
pacing rationale `:17-24`); Conference's comment says the same (`MMCA.ADC.Conference.Service/Program.cs:294-300`).
(2) `CacheSettings.DefaultDuration` is read by all three backends: `MemoryCacheService` (`IOptions<CacheSettings>`
at `MemoryCacheService.cs:19`, applied `:84`), `DistributedCacheService` (`:72`), `HybridCacheService` (`:329`).
(3) Only `MemoryCacheService` (`:62`) and `DistributedCacheService` (`:48`) override `TryGetAsync`;
`HybridCacheService` has no override and inherits the non-null inference (`ICacheService.cs:34-38`), so the
interface remark "The shipped stores override it" (`:32`) overclaims. (4) `GetFromSharedStoreAsync` also
serves the registration counter read, the login lockout flag and the soft-deleted marker (interface summary
`ICacheService.cs:40-45`, `HybridCacheService.cs:40-45`, `SoftDeletedUserMiddleware.cs:92`; ADR-077 Revision
(2026-10-07) `077-hybridcache-substrate.md:257`, item `:262-268`). (5) `HybridCacheService` also overrides
`IncrementAsync`, both legs on L2 (`HybridCacheService.cs:264`, remarks `:240-263`); the reason for
read-modify-write over `INCR` is the hash layout (`absexp`/`sldexp`/`data` read with `HMGET`,
`DistributedCacheService.cs:137-143`; interface remark `ICacheService.cs:93-99`, `:108-110`), not a JSON layout.
(6) The tag-eviction extension is named: `TryEvictTagsAsync`
(`MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:78`, `BestEffort` under `CancellationToken.None`
`:86-90`), beside the throwing `EvictTagsAsync` on the caller's token (`:49-58`). Wording: the keyspace rule's
origin reads "a real failure this framework already shipped once" instead of "a real production failure":
the shipped bug is in `MMCA.Common/CHANGELOG.md:4462-4466` (registration and the login lockout counters) and
at `DistributedCacheService.cs:140-142`; ADR-077 calls it "a class of bug, not an incident" (`:52`) yet says
ADR-026 "records a production failure" (`:31`). Whether it was hit in production is not determinable from
source. Unchanged and re-counted: twelve ADC public-read policies, eleven with the bypass; seven hosts on the
guarded hybrid helper.
**2026-10-02 pass.** Seven claims changed prose, not only an anchor. `ICacheService` has EIGHT members,
not six (`TryGetAsync` and `GetFromSharedStoreAsync` are default interface members), so the "first and
second late arrival" framing was dropped: the order in which the members arrived is not determinable from
source. All seven hosts call the framework's guarded `AddCommonHybridCacheWhenRedisConfigured(...)` with
no host-side Redis conditional. Both output-cache adopters call `AddRedisOutputCaching()` unconditionally
and rely on the wrapper's own no-op. Store's `ProductsCache` is 60 seconds. The direct-consumer list gained
the token services, the second-factor step and the soft-deleted marker. Replica L1 staleness is a
configurable default that single-use reads and counters skip. The scorecard's §10 label reads "Related
cross-cutting evidence". Header grounding moved from `MMCA.Common/CLAUDE.md` (now only an `@AGENTS.md`
import, `CLAUDE.md:3`) to `MMCA.Common/AGENTS.md` (`### CQRS Decorator Pipeline` `:76`, the Caching bullet
`:88`). The caching registrations live in `Infrastructure/DependencyInjection.Caching.cs`, so every former
`Infrastructure/DependencyInjection.cs` anchor is re-pointed below.
**Tier 1 substrate.** `ICacheService` (`MMCA.Common.Application/Interfaces/ICacheService.cs:10`) has EIGHT
members: `GetAsync` (`:17`), `TryGetAsync` (`:34-38`), `GetFromSharedStoreAsync` (`:65-66`), `SetAsync`
(`:75`), `RemoveAsync` (`:85`), `RemoveByPrefixAsync` (`:91`), `IncrementAsync` (`:112`) and
`GetOrCreateAsync<T>` (`:152`); the four with bodies are default interface members. `TryGetAsync` exists
for a value type whose miss is indistinguishable from a cached `default` (`:19-24`, override note `:29-33`),
and `MemoryCacheService` (`Infrastructure/Caching/MemoryCacheService.cs:62`) and `DistributedCacheService`
(`Infrastructure/Caching/DistributedCacheService.cs:48`) override it; `HybridCacheService` does not.
`GetFromSharedStoreAsync` bypasses any process-local copy (summary `:40-45`, remarks `:50-64`) and
`HybridCacheService` overrides it (`Infrastructure/Caching/HybridCacheService.cs:154`, class remarks
`:36-46`). `GetOrCreateAsync` takes the per-key stripe (`CacheKeyLocks.Locks` `:166`, class `:196`); its
remarks state that caching is unconditional and that "the caching decorators do NOT route through this
member" (`:135-138`). `DistributedCacheService` (`DistributedCacheService.cs:153`) and `HybridCacheService`
(`HybridCacheService.cs:264`) override `IncrementAsync` with the same read-modify-write shape rather than
Redis `INCR`; ADR-026 records the declined `INCR` in its Revision (2026-07-25) (`026-caching-strategy.md:409`).
**Backend swap.** `AddCaching` (`Infrastructure/DependencyInjection.Caching.cs:26`) binds
`CacheKeyPrefixOptions` (`:41`), builds `DistributedCacheService` (`:68`) or falls back to
`MemoryCacheService` (`:77`), and registers `RedisDistributedLock` (`:94`). `MemoryCacheService` keeps its
key set in a `ConcurrentDictionary` (`Infrastructure/Caching/MemoryCacheService.cs:38`); the SCAN eviction
lives in `RedisPrefixScanner` (`RedisPrefixScanner.cs:24`), fed the qualified pattern
(`DistributedCacheService.cs:126`); the missing-multiplexer warning is `Interlocked`-guarded (`:115`).
**Default TTL.** `CacheOptions.DefaultDuration` (`Infrastructure/Caching/CacheOptions.cs:23`);
`CacheSettings` section `:25`, `DefaultDuration` `:32`, `LocalCacheDuration` `:42` (per the 2026-10-02 pass); read by
`MemoryCacheService` (`:84`), `DistributedCacheService` (`:72`) and `HybridCacheService.WriteOptions` (`:329`,
L1 ceiling `:330`). ADR-077 "Revised (2026-08-31)" (`077-hybridcache-substrate.md:17`), keyspace-rule heading `:50`.
**Backend key namespace.** `CacheKeyPrefixOptions.SectionName` (`CacheKeyPrefix.cs:34`), the SEC-Common-53
remark (`:43`), `CacheKeyNamespace.From(IServiceProvider)` (`:73`); applied through `_keys.Qualify` on get
(`DistributedCacheService.cs:42`), set (`:70`), remove (`:78`) and the scan pattern (`:126`).
**The third backend.** `HybridCacheService` (`HybridCacheService.cs:48`), `KeyspaceSegment` `hc:` (`:59`,
rationale `:20-27`), `LocalCacheDefault` 30 seconds (`:66`), retuned by `Cache:LocalCacheDuration`
(`:30-34`), single-use reads, counters and the two flags skipping L1 (`:36-46`). `AddCommonHybridCache`
(`DependencyInjection.Caching.cs:139`, `RemoveAll<ICacheService>` so it wins in either order `:165`) and
`AddCommonHybridCacheWhenRedisConfigured` (`:200-212`, guard `:206`, rationale `:184-195`) per the
2026-10-02 pass. Call sites: ADC Conference `Program.cs:204`, Identity `:138`, Engagement `:116`,
Notification `:119`; Store Catalog `Program.cs:108`, Sales `:113`, Identity `:102` (Store per the
2026-10-02 pass). ADR-026 records the helper in its "Revised 2026-09-25" status entry
(`026-caching-strategy.md:28-32`) and Tier 1 (`:65`).
**Redis wiring.** `builder.AddRedisCaching()`: ADC Conference `:185` (rationale `:176-184`), Identity `:130`,
Engagement `:108`, Notification `:111`; Store Catalog `:89`, Sales `:104`, Identity `:93` (per the
2026-10-02 pass). Wrapper `MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:57`, blank-string no-op
`:59-61`, `DisableHealthChecks` `:64-65`; `AddRedisOutputCaching` `:91`, no-op `:94-96` (per the 2026-10-02
pass), called unconditionally at ADC Conference `:196` (comment `:187-195`) and Store Catalog `:99`. ADR-026
Trade-offs `:248`.
**Read path.** `CachingQueryDecorator` (`CachingQueryDecorator.cs:43`): `EffectiveKey` composes both key
transformations (`:59`), a hit takes no lock (`:74`), the populate-lock budget (`:87`,
`TryAcquirePopulateLockAsync` `:179`, budget-exhausted catch `:194`), the re-check (`:100`), caching only
non-failure results (`:118`, populate catch `:125`), `TryReadAsync` (`:208`, fail-open catch excluding
`OperationCanceledException` `:218`), `QueryCacheKeyLocks` (`:247`).
**Two key transformations.** `TenantCacheKey` marker `t:` (`TenantCacheKey.cs:28`); `UserCacheKey`
(`UserCacheKey.cs:26`), marker `:u:` (`:29`), applied for `IUserScopedRequest` and not `ISharedQueryCache`
(`:39`). ADR-026 Revision (2026-09-07) (`:330`). Read path, key transformations and write path anchors are per the 2026-10-02 pass. ADR-073
"Cache isolation lives in the decorators" (`073-multi-tenancy-model.md:191`) and "Cache isolation stops at
the decorator" (`:257`). Direct consumers re-read this run: `LoginProtectionService.cs:42,64,119`,
`OAuthControllerBase.cs:142,196`, `IdempotencyFilter.cs:141`, `PasswordResetTokenService.cs:128`,
`EmailConfirmationTokenService.cs:90`, `TwoFactor/TwoFactorAuthenticator.cs:105`, `SoftDeletedUserCache.cs:57`.
**Write path.** `CachingCommandDecorator` (`CachingCommandDecorator.cs:33`): the three-condition guard
(`:61-63`), eviction on `CancellationToken.None` (`:73`), the swallow (`:84`), `ReInvalidationDelay` 5
seconds (`:45`), `InvalidationFollowUp` (`:51`), `ReInvalidateAfterDelayAsync` (`:98`, delay and evict
`:102-103`, catch `:106`). Registration order: Transactional (`Application/DependencyInjection.cs:134`) then
Caching (`:137`), query Caching (`:145`), pipeline diagram (`:66-79`). A failed `Result` rolls back and
drops deferred dispatch (`Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:608`).
**Fail-open on the auth path.** `SoftDeletedUserMiddleware.cs:37`: the 15-minute access-token bound in the
class remarks (`:30`), the marker read through `GetFromSharedStoreAsync` (`:92`) and its catch (`:95`), the
validator catch (`:143`).
**BestEffort.** `BestEffort.ExecuteAsync` (`MMCA.Common.Application/Services/BestEffort.cs:45`), await
(`:57`), cancellation rethrow (`:59-63`), catch (`:65`), meter `MMCA.Common.BestEffort` (`:102`), counter
`besteffort.dispatch.failed` (`:107-108`), tagged `operation` (`:115`). `TryEvictTagsAsync`
(`MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:78`) wraps `BestEffort.ExecuteAsync` under
`CancellationToken.None` (`:86-90`).
**Edge tier.** `app.UseOutputCache()` (`MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:133`).
`PublicEndpointOutputCachePolicy`: `TenantVaryByKey` `t` (`:50`), `QueryKeys = "*"` (`:96`), the tenant stamp
(`:105`), no `Set-Cookie` and no non-200 (`:125-126`), GET/HEAD only (`:135`). The `NoLimiter` partition for
anonymous traffic is per audit (`WebApplicationBuilderExtensions.RateLimiting.cs:68`; anonymous hub
requests are metered per IP at `:58-67`, outside the HTTP reads this article discusses).
**ADC host counts.** `adminBypassRoles` built from `ConferenceReadAudience.PrivilegedRoles` (`Program.cs:269`;
source `MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:34-37` per the 2026-10-02 pass,
`Organizer` and `ContentEditor`); twelve policies at `:270-301`, ten at 5 minutes, `NowNextCache` (`:287`, 60
seconds, no bypass) and `BookmarkCountsCache` (`:301`, 60 seconds, with the bypass). ADR-040 records twelve and eleven
in its status (`040-authenticated-output-caching-for-public-reads.md:23-25`) and Revision (2026-09-25)
(`:222`, count `:243`), which closes the ADR-side follow-up the previous ledger noted. Store Catalog:
`CatalogCache` `:152`, `CategoriesCache` `:153`, `ProductsCache` 60 seconds `:159` (reason `:154-158`),
`ProductImagesCache` `:162`; ADR-040 `:224-231`, the unconditional output store `:236`, and the observation
that `CatalogCache` backs no endpoint `:262-263` (not repeated in the body).
**Cross-service edge eviction.** `OutputCacheEvictionRequested` (`MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:28-29`, `Tags` defaulting to empty `:37`). `OutputCacheEvictionHandler`
(`MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:32`), `EvictByTagAsync` (`:53`), catch (`:56`),
`RecordEvictionFailure` (`:60`); meter `MMCA.Common.OutputCache` (`OutputCacheMetrics.cs:19`),
`cache.eviction.failed` (`:29-30`) (per the 2026-10-02 pass). Conference registers the handler
(`Program.cs:307`, the "silent no-op" comment `:304-306`). ADC Engagement: the signal at
`UserSessionBookmarkCacheEvictionHandler.cs:56`, the broadcast at `BookmarkCacheEvictionProcessor.cs:62-77`.
Per audit: the Conference consumer at `ConferenceBrokerConsumers.cs:37`, Store `CustomerErasedHandler.cs:109`;
ADR-040 Revision (2026-09-10) `:181`.
**The optional third tier.** ADR-026 "### An optional third tier on the client" (`:188`); `UiReadCache`
registered scoped (`MMCA.Common.UI/DependencyInjection.cs:76`) with no reference in ADC, Store or Helpdesk
source (per audit). ADR-026 structure: Status `:3-44`, Decision `:62`, Tier 1 `:65`, Tier 2 `:128`, third
tier `:188`, Rationale `:233`, Trade-offs `:248`, Revision (2026-09-07) `:330`, Related `:365`.
**Scorecard.** `common-ArchitectureScorecard.md` evidence as of 2026-10-07 at v1.233.0 (`:5`), indices unchanged. §10 Messaging &
Integration Architecture, Maturity 4, Implementation 9 (`:74`), keeps the `AddCaching()` /
`MemoryCacheService` sentence under "Related cross-cutting evidence (scored under §5/§6/§9/§12/§17/§29)";
§12 Performance & Scalability, Maturity 4, Implementation 8 (`:76`), still cites no cache benchmark.
Maturity index 317 / 328 = 96.6% (`:9`), Implementation index 705 / 820 = 86.0% (`:10`), N/A none with all 34
rows scored (`:104`). The body states no index.
**Perf gate (per audit).** `performance-smoke` (`MMCA.Common/.github/workflows/ci.yml:310`) is a required
check ("Performance gate (BenchmarkDotNet Short + baseline verify)"), its suites are
`SpecificationBenchmarks.cs` and `QueryPipelineBenchmarks.cs`, and the Benchmarks project is outside
`MMCA.Common.slnx`; neither suite touches the cache decorators. 22 published packages
(`MMCA.Common/FACTS.md:19`) at v1.233.0 (`:14`).*

- Full series index: https://ivanball.github.io/writing.html
