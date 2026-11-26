# The self-invalidating cache that lives in the pipeline, not your handlers

> Series: MMCA.Common · Article #19 (deep-dive) · Pillar P2 · Group G09 · Rubric §10,§12 · ADR-026, ADR-040,
> ADR-073, ADR-077, ADR-135 ·
> Status: grounded in `Website/docs-src/onboarding/group-09-caching.md`, `MMCA.Common/AGENTS.md` (the CQRS
> Decorator Pipeline section), `Website/docs-src/governance/common-ArchitectureScorecard.md` (§10, §12),
> `Website/docs-src/adr/026-caching-strategy.md`,
> `Website/docs-src/adr/040-authenticated-output-caching-for-public-reads.md`,
> `Website/docs-src/adr/073-multi-tenancy-model.md` (the cache-key slice only),
> `Website/docs-src/adr/077-hybridcache-substrate.md`, and
> `Website/docs-src/adr/135-application-namespace-keyspace-isolation.md`. No em dashes.

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

The prefix carries one rule of its own: it is empty or it ends at a `:` boundary (`"Catalog:Products:"`,
never `"Catalog:Prod"`), and every shipped store rejects anything else with an `ArgumentException`. The
rule is what lets the shared store invalidate without walking its keyspace, as the backend section below
shows, and enforcing it in every store means a prefix behaves the same on a laptop and in production.

The two specialized reads each close a gap a plain `GetAsync` leaves open. `TryGetAsync` reports
presence separately from the value, because for a value type a miss and a cached `default` (`0`,
`false`, `Guid.Empty`) look identical. The default member infers presence from a non-null `GetAsync`
result, which is exact for reference and nullable types, and both shipped stores override it with
a real presence check. `HybridCache` has no presence-reporting read, so the hybrid store asks for the
entry with a factory that throws a tagged miss: a hit never calls it, and the thrown sentinel reads as
not found, so a cached `0` or `false` still counts as a hit.
`GetFromSharedStoreAsync` reads the shared store and never a process-local copy, for values whose change
on one replica must be visible on every other replica at once: single-use records (an OAuth exchange
code, a password-reset or email-confirmation token, the last accepted second-factor time step), the
registration counter read, Store's guest-checkout throttle counter read, and the two flags whose removal must be seen everywhere (the login lockout
flag and the soft-deleted-user marker). The hybrid backend below is the store that overrides it.
(`IncrementAsync` is the single entry point for the brute-force and rate-limit counters of ADR-029
instead of a read-then-write pair at each call site. The memory backend keeps the interface default and
the hybrid backend overrides it, both with the same read-modify-write shape rather than a Redis `INCR`,
because the distributed cache stores every entry as a Redis hash and an `INCR` string at the same key
would fail the next read with `WRONGTYPE`: the member buys one call site, not atomicity. The hybrid
override keeps both legs on L2, so no replica counts from a stale local copy.)

`GetOrCreateAsync` is the most interesting of the default members, because of who does *not* use
it. Its default body is get, then take a per-key lock from a process-wide stripe, double-check, run the
factory, store the result; the hybrid store overrides it with `HybridCache`'s own call, which folds the
same double-check and stampede protection into one call and keeps the same guarantees (unconditional
storage, protection per process), so the hybrid store overrides all four default members. That is the
read-through shape the query decorator below implements, offered to the callers that are not queries. The decorators still do not route through it, and
the interface says so in its own remarks: `GetOrCreateAsync` caches whatever the factory returns,
unconditionally, including a failed `Result`. The decorator must not, so it keeps its own
read/execute/write sequence. A convenience helper that quietly relaxes a correctness rule is worth having
only if the code that depends on the rule stays off it.

`ICacheService` is defined in the Application layer; the concrete backend is chosen by DI at the
composition root. Handlers and decorators never see `StackExchange.Redis` or
`Microsoft.Extensions.Caching` directly. That is a textbook Clean Architecture port/adapter split: the
business code programs against the contract, the transport is a deployment concern.

## One contract, two backends

`AddCaching()` registers the in-process backend and no other cache backend. A host that wires a shared store
states it: any host with a distributed L2 calls `AddCommonHybridCache()`, which replaces that
registration in either call order. A host that registers a real distributed cache (an `IDistributedCache`
that is not the default `MemoryDistributedCache`, typically Redis) without that call does not fall back
to memory: resolving `ICacheService` throws an `InvalidOperationException` that names the missing call,
because a silent in-process fallback would make single-use records, counters and the lockout flag
per-replica. No flag, no per-environment branch in application code, and no way to end up on the wrong
backend quietly:

- **`MemoryCacheService`** is the single-instance fast path. Because `IMemoryCache` cannot enumerate its
  own keys, it maintains a side `ConcurrentDictionary` key set so it can satisfy `RemoveByPrefixAsync`,
  and keeps that index honest with a post-eviction callback so expired entries prune themselves rather
  than leaking.
- **`HybridCacheService`** puts an in-process L1 in front of the distributed L2, over
  `Microsoft.Extensions.Caching.Hybrid`, so a repeat read inside one replica never leaves the process
  while invalidation still crosses replicas. It is the only cache service over a shared store, and its
  prefix invalidation never walks the keyspace: every `:` boundary of a key (the empty root, then each
  prefix ending at `:`) carries a generation token, the tokens in force are folded into the key an entry
  is stored under, and `RemoveByPrefixAsync` replaces one token. That is one Redis write whatever the
  size of the keyspace. Nothing is scanned or deleted: every entry written under the old token simply
  stops being addressed, and the orphaned entries expire on their own TTL. It is a generation token
  rather than `HybridCache`'s own tag invalidation for a reason worth knowing: a process reads a tag's
  invalidation timestamp once, the first time it meets the tag, and never refreshes it, so another
  replica that has already seen the tag never learns of the invalidation. This is the cache with a Redis
  backplane the architecture scorecard carries in its §10 row as related cross-cutting evidence,
  scored under §5, §6, §9, §12, §17 and §29, and whose substrate is recorded in ADR-026: a single-host
  monolith caches in-process for free, and the same code uses a shared Redis once the hybrid backend is
  registered, so cached reads stay coherent when a module is scaled out or extracted into its own
  service.

The hybrid backend's defining constraint is a keyspace rule, not a performance one. Every key it writes
sits under a disjoint `hc:` segment, so an entry can never meet a value another writer put in the same
server (a host's own `IDistributedCache` use, or the generation keys under `hcg:`) in a format it cannot
parse. That rule generalizes a real failure this framework already shipped once, a Redis `INCR`
counter written as a string and read back by a hash-shaped path, which answered `WRONGTYPE` and
surfaced as a 500 on the endpoints owning the counter (registration and login). Two serialization
formats must never share one keyspace, so each writer gets its own.

Be concrete about how a deployed service gets there, because none of the seven ADC and Store services
makes these calls itself. Each is built on the composed service host, `builder.AddMmcaServiceHost(...)`,
which calls `builder.AddRedisCaching()` and then `AddCommonHybridCacheWhenRedisConfigured(configuration)`,
a framework helper that registers the hybrid backend only when the Redis connection string is set (with
no Redis L2 the hybrid tier would be a plain in-memory cache, which the memory backend already is). So
wherever Redis is configured the live substrate is the hybrid one, and the memory backend runs where it
is not: local runs, tests, and any host that wires no Redis. The contract that makes that substitution a
deployment concern is the point. Nothing in any handler, decorator, or query changes.

A short, conservative default TTL keeps a write that names no lifetime erring toward correctness over
hit-rate: 30 seconds. The constant sits in one place (`CacheOptions.DefaultDuration`, a bare `TimeSpan`)
precisely so the hybrid backend, whose entry options are a different type entirely, defaults to the same
policy instead of hard-coding the figure a second time, and one binding layer sits above it:
`CacheSettings.DefaultDuration` is bound from the `Cache` configuration section, defaults to that same
constant, and is what both backends (memory and hybrid) actually read, so a host can retune the figure
without the two disagreeing. Its reach is narrower than its name suggests. The
backends apply it only when a caller passes no expiration, and a cached query always passes one:
`IQueryCacheable.CacheDuration` is a mandatory member and the query decorator hands it to every write. So
the default governs direct `ICacheService` writes, never a decorator-cached query, which lives exactly as
long as it declares.

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

Be honest about adoption, too. No query in the deployed ADC or Store services implements
`IQueryCacheable`, and ADC pins that for its now/next feed with a test, because the 60-second output cache
is the single cache there and a decorator cache underneath would double the staleness. The Helpdesk
reference app's ticket-by-id read is the one adopter. So in the deployed services the read-heavy public
traffic is cached at the edge tier below, the Tier-1 substrate is carried by its direct consumers, and the
many ADC and Store commands that implement `ICacheInvalidating` run the write path against keys no query
decorator wrote. The pipeline is ready the moment a query opts in; today it is mostly a contract waiting
for one.

## The write path: invalidate on success, outside the transaction

A command invalidates by implementing `ICacheInvalidating`, which exposes a `CachePrefix`. The
`CachingCommandDecorator` runs the inner handler first, then evicts:

```csharp
public sealed record UpdateProductCommand(int ProductId, decimal NewPrice)
    : ICacheInvalidating, ITransactional
{
    public string CachePrefix => "Catalog:Products:";
}
```

A command that invalidates one aggregate's reads need not spell the prefix at all: implementing
`ICacheInvalidating<TEntity>` supplies `"{typeof(TEntity).FullName}:"`, the same prefix the generic CRUD
commands evict by default. That is the form a shared fitness rule expects: it flags every concrete
`ICacheInvalidating` implementer that does not take the generic form, or that declares its own
`CachePrefix` on it, unless the type is listed in `AllowedCustomPrefixTypes`. So a hand-written prefix
like the one above passes only as a deliberate, allow-listed exception.

The decorator calls `RemoveByPrefixAsync("Catalog:Products:")` only when **three conditions** hold: the
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
`"Catalog:Products:"` drops the single-product read *and* every paged and filtered product list cached
under that prefix, in one operation. The handler that changed the price did not name a single cache key.

It evicts twice, though, and the second one is the interesting part. A read that missed the cache
*before* this command committed can still be running its handler against pre-write state and repopulate
the entry a moment after the first eviction lands. So the decorator schedules a second, fire-and-forget
eviction of the same prefix five seconds later, which removes that repopulated entry. Both evictions are
best-effort and deliberately non-cancellable (they run on `CancellationToken.None`, because the command
has already committed and a client that walks away must not strand stale entries), and any failure is
logged at warning level and swallowed: a cache outage must never turn a committed command into a failed
one. Whatever the two evictions cannot clear still expires on its own TTL.

One failure is treated differently, because it is not a fault in the cache. A prefix that breaks the
boundary rule (`"Catalog:Products"`, with no trailing `:`) is rejected by the store with an
`ArgumentException`, and the decorator catches that one separately: it logs it at Error as a
misconfigured command, names the command and the prefix, and returns without scheduling the delayed
retry, since the second attempt would fail identically. The committed command still succeeds, and
nothing is invalidated, so its entries stay stale until their TTL. A typo in a prefix is a bug, and the
log level says so.

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

- **It is a prefix, not a suffix**, so prefix eviction keeps working. Evicting `t:acme:products:` removes
  that tenant's product entries and nothing else, and no command in one tenant can evict another tenant's
  cache.
- **Both decorators call the same helper**, which is what keeps reads and invalidations symmetric. A query
  cached under `t:acme:products:42` is evicted by a command whose prefix became `t:acme:products:` through
  exactly the same transformation. Scoping one side only would be worse than scoping neither: the write
  would evict a key nobody wrote.
- **With no tenant resolved, keys are byte-identical to the pre-tenancy framework.** A single-tenant host
  keeps its keyspace and no cache entry is orphaned by upgrading.

The stampede stripe locks the same scoped key, so one tenant never waits on another tenant's lock. And the
honest limit: this lives in the decorators, so code that resolves `ICacheService` directly gets no tenant
prefix at all. Today's direct consumers (login and registration counters, OAuth exchange state,
idempotency records, password-reset and email-confirmation tokens, the last accepted second-factor time
step, the soft-deleted marker, ADC's ticket-claim attempt counter and sign-in-link invitation sent marker,
Store's guest-checkout throttle counter) are keyed by subject already (a user, an invitation, a hashed
recipient address), and Store's cache of Stripe webhook signing secrets is keyed by endpoint, so they are safe by the shape of their keys rather than by a rule that would catch the
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

Two further transformations do happen, but underneath the port rather than in key design. The hybrid
backend prepends a service namespace to every key on get, set and remove, and to the generation keys its
prefix invalidation writes, so two services sharing one Redis instance cannot collide. It is bound from
`Cache:KeyPrefix`, and left unset it is not empty: the framework resolves a per-application default of
`{application namespace}:`, because an empty default would put two applications sharing one Redis into
one keyspace for both cache entries and distributed locks, silently. It is applied inside the adapter, so
an entry and the generation tokens that govern it always carry the same namespace. The in-process backend
skips it, its keyspace being private by construction. One family of keys is the deliberate exception:
cross-service keys such as the soft-deleted-user marker, which Identity writes and every other service
reads, take a namespace every service of the deployment shares (`Cache:CrossServiceKeyPrefix`, otherwise
the token audience) and carry no generation token, so they resolve to the same stored key everywhere. The
hybrid backend adds its `hc:` segment on top, for the keyspace reason above. Neither transformation
changes what your key *means*: they are keyspace hygiene applied uniformly under the contract, which is
why tenant and caller scoping stay the only places the framework decides part of your key for you.

## One application namespace for every shared keyspace

The `{application namespace}` in that backend prefix is not a cache setting. It comes from
`ApplicationNamespace.Resolve`, the one resolver that names the shared-infrastructure keyspaces of five
subsystems (ADR-135): distributed cache and lock keys, distributed rate-limit counters, the Redis
output-cache store, the SignalR Redis backplane channel, and the message broker's topic names. Each of
those fails the same way. Two applications pointed at one Redis or one broker share any keyspace that
carries no prefix, and neither Redis nor the broker warns. The backplane makes the cost concrete: the
framework ships `NotificationHub`, so its channel name is identical in every consumer, and with no prefix a
user-targeted push published by one application reaches the other application's clients holding the same
numeric user id.

The resolver has one precedence: an explicit `Application:Namespace` when set, otherwise the host's
application name (`IHostEnvironment.ApplicationName`, or the `applicationName` configuration key when no
environment is passed or its name is blank), otherwise the constant `app`. It sanitizes the result once for every consumer,
replacing each run of characters outside `[a-zA-Z0-9_-]` with `-` and trimming the ends, because a Redis
key tolerates almost anything while a broker queue or topic name and a SignalR channel prefix do not. It never
returns an empty string, so isolation is the default rather than an opt-in. Each subsystem derives its
keyspace from that one value:

```csharp
var ns = ApplicationNamespace.Resolve(configuration, environment); // Application:Namespace, app name, "app"

// cache, lock and Redis output-cache keys  "{ns}:"                unless Cache:KeyPrefix is set
// distributed rate-limit counters          "{ns}:{scope}:{key}"   Cache:KeyPrefix, trimmed, when set
// SignalR Redis backplane                  ChannelPrefix = ns     no narrower knob
// broker topics                            prefixed with ns       Application:Namespace must be set explicitly
```

The output cache shows why one name beats one default per subsystem. `AddCaching` post-configures
`RedisOutputCacheOptions.InstanceName` to the same prefix the cache keys use whenever the host left it
empty, and keeps one a host set explicitly. The store prefixes both its value keys and its tag keys with
that name, so the cross-service tag eviction later in this article still matches what was written. The
in-process memory backend takes no prefix, its keyspace being private to the process.

The broker is the one subsystem that refuses the fallback. Every broker topic is prefixed with the
namespace, so a per-service value would put publishers and consumers on different topics and lose
integration events silently; a host on a real broker therefore fails at registration when
`Application:Namespace` is not set explicitly, rather than deriving it from its own application name.

The override exists for the opposite case: two hosts of the same application that must share a keyspace,
such as a web head and a worker draining one backplane. Both deployed apps pin their keyspaces rather
than derive them. ADC sets `Application:Namespace` to `adc` and `Cache:KeyPrefix` to `adc:` in all four of
its services, so they share one keyspace on purpose. Store sets `Application:Namespace` to `store` in all
three of its services, so their broker topics meet, and gives each service its own `Cache:KeyPrefix`
(`store-catalog:`, `store-identity:`, `store-sales:`), so a project rename cannot move a cache keyspace
and cost a cold cache. Because an explicit `Cache:KeyPrefix` wins, the cache, lock, output-cache and
rate-limit keyspaces of those services come from that setting, and the resolved namespace drives the
SignalR backplane and the broker topic prefix. The resolver's default is what a host that configures none
of these keys gets. Two limits stay honest. The fallback `app` is shared, and the backplane call site
passes no host environment, so it depends on the `applicationName` configuration key being populated (a
broker host never reaches the fallback, since it must set the namespace). And sanitizing can merge two
raw names that differ only in characters it replaces.

## What the cache is, and is not

This is a request-result read-through cache for query handlers. It is not a session store and not a
write-behind buffer. The cross-source consistency mechanism in this framework is the outbox (ADR-003,
ADR-006), not the cache. Lifetimes declared per query, a short fallback TTL for writes that name none, and
the failure-skipping rules are the right defaults for an opt-in cache layered onto a database-per-service
system: it errs toward correctness over hit-rate.

ADR-026 decides two tiers, and this `ICacheService` substrate is the first. The second is an HTTP
output-cache edge (`app.UseOutputCache()`, with per-host opt-in policies) that lets a public read
endpoint skip the handler entirely. Both are server tiers; nothing caches API responses on the client.
The edge tier is host-configured rather than part of the pipeline, but it hides a correctness trap
sharp enough to earn the section that follows.

## The edge tier: caching authenticated reads without leaking identity

Tier 2 sits in front of the handler instead of inside the pipeline. `MMCA.Common.API` always calls
`app.UseOutputCache()` but ships no policies: each host opts in. A read-heavy public service (ADC's
Conference service, Store's Catalog) declares named short-TTL policies on its `[AllowAnonymous]` GET
controllers, so an anonymous agenda or speaker read is served straight from the output cache and never
reaches a query handler. Store's Catalog runs three such policies, `CategoriesCache` and
`ProductImagesCache` at 5 minutes and `ProductsCache` at 60 seconds, because a product payload carries
each variant's effective price, which moves on the clock when a discount window opens or closes with no
mutation to evict on; ADC's Conference service runs twelve output-cache policies, ten at 5 minutes and
two at 60 seconds where the payload turns over faster. This is also the lever ADR-019 leans on: the global rate limiter partitions by authenticated user
and routes anonymous traffic to a `NoLimiter` partition (anonymous SignalR hub requests are the one
exception, metered per IP), so output caching, not a throttle, is what absorbs that load.

The sharp mismatch sits in ASP.NET Core's built-in default output-cache policy, which
refuses *both* cache lookup and cache storage for any request carrying an `Authorization` header or an
authenticated identity. The framework UI attaches a Bearer token to *every* outgoing API request,
including reads of these `[AllowAnonymous]`, user-independent endpoints. So the default caches the traffic
that does not matter (anonymous) and skips the traffic that does (logged-in): on a conference day, when
every attendee is signed in, 100% of the agenda, session, and speaker reads bypass the cache and hit a
Basic-tier SQL database. Anonymous load evidence cannot see that gap: ADC's read-load k6 script and the
startup warmup requests are anonymous, exactly the slice the default policy still caches. The signed-in
case is what ADC's conference-day attendee script measures: each virtual user signs in once and sends a
Bearer token on its schedule and bookmark reads, the traffic shape that decides whether the edge tier
holds.

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
per tenant and the entry is shared. It also turns off request coalescing (`AllowLocking = false`): the
built-in default makes concurrent misses for one key wait on the first request's execution, which runs
under that request's `RequestAborted` token, so one disconnecting client would cancel the shared query
and answer 500 to every waiter. The price is that simultaneous misses each run the query once, so the
edge tier has no stampede protection inside one expiry window. It re-implements the safeguards it displaced, GET/HEAD only, never
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
and serve it to everyone. Nor is the bypass a rare exception: ten of ADC's eleven public-read policies pass
it, and only `NowNextCache` (a 60-second now/next feed of published-only data) passes none, because its
response varies for nobody. When the elevated payload is gated by a permission rather than a role, a
second constructor takes bypass permissions too: ADC's `SessionsCache` also bypasses any caller holding
`conference:session-assets:manage`, by claim, by role or by stored grant, so a grant held outside the two privileged
roles neither reads the public entry nor stores into it. The twelfth policy, `ConferenceCache`, stays on
the built-in default semantics on purpose: a permission-gated controller also references it, and a
cached hit is served before MVC's filters run, so the public policy must never back that endpoint.

### Crossing a service boundary with a tag-eviction event

The edge tier's other limit is structural rather than sharp. `IOutputCacheStore` is a per-host store,
so a host can evict its own tags and nothing else. In a database-per-service system the write that
stales a cached read routinely happens somewhere else, so on its own the only invalidation that crosses
a process boundary is the expiry clock. The framework closes that distance with its first concrete
integration event, `OutputCacheEvictionRequested`, whose entire payload is a list of output-cache tags
(defaulting to empty rather than required, so a message that arrives without the field deserializes into
a harmless no-op instead of faulting the consumer and dead-lettering), and the consumer that answers it,
`OutputCacheEvictionHandler`, which drops each named tag from *this* host's store through
`EvictByTagAsync` and skips a blank one, so no message can empty the store. Delivery adds no channel: the owning service raises the event,
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
  refer to the same data. If a query caches under `"Catalog:Product:"` and a command invalidates
  `"Catalog:Products:"`, the cache silently goes stale and nothing complains. The boundary rule catches one
  shape of mistake loudly (a prefix that stops mid-segment is logged at Error), but a well-formed prefix
  that names the wrong family passes every check. The pipeline guarantees that
  invalidation *runs* on success; it does not guarantee that your keys and prefixes line up. That mapping
  is yours to design and test. The tenant prefix and the caller suffix above are the only exceptions, and
  they are a good model for the rule: the framework only takes over a piece of key construction when
  getting it wrong leaks data rather than merely serving it late.
- **Cross-replica prefix invalidation needs a Redis `IConnectionMultiplexer`, and every deployed service
  wires one.** The multiplexer holds the generation tokens, which is what carries an invalidation to
  every replica. All seven ADC and Store services reach Redis through one framework wrapper,
  `builder.AddRedisCaching()`, called once by the composed service host, which registers the distributed
  cache and the multiplexer together and no-ops when the named connection string is blank, so whenever
  Redis is configured, prefix-based invalidation reaches every replica (against whatever a query
  decorator wrote, which in the deployed services is nothing, per the read-path section). The host calls
  that wrapper rather than Aspire's integrations directly, because the raw integrations register an
  untagged Redis health check that gates readiness (ADR-025). In-memory mode needs no multiplexer at all:
  `MemoryCacheService` removes by prefix in-process through its tracked key set. On the hybrid backend
  with no multiplexer the tokens live in the process, so an invalidation still takes effect where it ran
  but reaches no other replica, whose entries expire on their TTL alone (for a decorator-cached query, its
  declared `CacheDuration`). That does not fail silently: it is warned once (`Interlocked`-guarded, so a
  mutating command does not flood the log), so an unwired backplane is observable instead of invisible.
  One operational rule comes with the tokens: the generation keys carry no TTL, so keep them out of
  Redis eviction, because a lost key brings back the entries written before that prefix's first
  invalidation until their own TTL. Single-key `RemoveAsync` is unaffected in either mode.
- **A cache outage degrades reads instead of failing them, and the one fail-open on the auth path has a
  bounded cost.** Every cache call in `CachingQueryDecorator` is fail-open: a failed read is logged at
  warning level and treated as a miss, so the query falls through to the inner handler and still answers
  correctly, just uncached, and it is *counted* as a miss so an outage shows up in the cache-hit metrics
  rather than hiding; a failed populate returns the handler's result uncached. Only
  `OperationCanceledException` is excluded from the guard, so a genuinely cancelled request still surfaces
  exactly as the inner handler would. A Redis outage therefore costs latency and database load, not a 500
  on every cacheable query. The same posture on the authenticated hot path is where it turns into a real
  trade-off: `SoftDeletedUserMiddleware` reads the soft-deleted marker from the shared store on every
  host. On the host that registers the validator (Identity) it runs the validator query whenever no marker
  is set, the cache being unreachable included, and never caches a "not deleted" answer, so that host pays
  one shared-store read plus one query per authenticated request; a host with no validator passes a miss
  or a cache failure straight through. When the query fails too, the middleware proceeds open rather than
  locking out every authenticated caller on one blip. The exposure that buys is bounded by access-token lifetime: tokens live
  15 minutes, and on a host that registered a refresh-session store the deletion has already revoked the
  account's refresh sessions, so the residual risk is one
  already-issued token running out its remainder while the cache or database is unhealthy. That bound is
  what makes the fail-open a deliberate choice rather than an accident of the code path.
- **Per-instance memory caches diverge, and the hybrid backend buys its L1 hit rate with a smaller
  version of the same problem.** The in-process backend is not shared across instances, so two hosts hold
  independent copies until each entry's TTL reconciles them. That is exactly why a scaled-out host runs
  the hybrid backend. The two-level backend narrows the window rather than closing it: a single-key
  removal clears L2 and the removing process's L1, but every other replica's L1 copy survives until its
  local expiration, and a prefix invalidation takes effect in the invalidating process at once and on
  every other replica within one local duration plus one refresh round trip of its remembered token (in a
  partial outage, where L2 reads succeed but generation reads fail, within the outage's length plus one
  local duration). The local duration is 30 seconds by default (`Cache:LocalCacheDuration` retunes it).
  Single-use
  records, counters, and the flags that must clear everywhere at once (the login lockout flag and the
  soft-deleted-user marker) read through `GetFromSharedStoreAsync` or increment on L2 and skip L1
  entirely, so that window never applies to a token that must not be used twice or a flag that must not
  linger. That is a deliberate trade, and it is the same order of
  staleness as the delayed second eviction the write path already performs.
- **The edge tier trades a data-leak risk for its speed.** `PublicEndpointOutputCachePolicy` serves one
  cached response verbatim to every later caller, so it is safe only on endpoints that are
  `[AllowAnonymous]` and identity-independent. Adopting it is an audit, not a toggle: a permission-gated or
  per-user endpoint must never move onto it, and the bypass by role or by permission covers role- and
  permission-shaped variance only, never per-user variance. The store behind it is the other thing to get
  right: `AddOutputCache` defaults to per-replica memory, so under scale-out a tag eviction reaches only
  the replica that handled the mutation. Both deployed adopters opt in with `UseRedisOutputCaching = true`
  on the composed service host, which then calls the framework's `builder.AddRedisOutputCaching()`; that
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
automatically, how one contract over two backends (in-process memory, and the two-level hybrid every
Redis-configured service must run) keeps the same code coherent from monolith to scaled-out service, why
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

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`, 30 published
packages `:20`). Structural pass: the cache substrate was rewritten at v1.277.0 (ADR-026 Revised 2026-11-04,
`Website/docs-src/adr/026-caching-strategy.md:50-56`), so the 2026-10-29 ledger's `DistributedCacheService`
and `RedisPrefixScanner` anchors are retired; neither type exists in `MMCA.Common/Source` (Grep this run).
Paths below are under `MMCA.Common/Source/Core/` unless rooted otherwise.
**Changed this run.** (1) Backends: "three, memory-or-Redis probe plus opt-in hybrid" became "two, and any
host with a distributed L2 must run the hybrid". `AddCaching` registers only `MemoryCacheService`
(`MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:79-99`, summary `:22-28`); a non-memory
`IDistributedCache` without the hybrid call throws `InvalidOperationException` naming the call (`:86-93`,
rationale `:81-85`); `AddCommonHybridCache` is "required for, and intended for" a distributed-L2 host and the
only cache service over a shared store (`:137-139`), `RemoveAll` then add so it wins in either order
(`:142-147`, `:188-189`); ADR-026 Tier 1 `026-caching-strategy.md:95-126`. (2) Prefix invalidation is a
generation token, not a SCAN: `HybridCacheService.cs:26-32`, `RemoveByPrefixAsync` `:321-337`;
`CachePrefixGenerations.cs:8-14`, `RemoveByTagAsync` rationale `:17-24`, token-loss baseline `:27-35`,
staleness bound `:37-46`, no-multiplexer `:48-49`, warn-once `:228-229` and `:409-410`; the multiplexer holds
the tokens (`DependencyInjection.Caching.cs:156-159`). (3) Prefix boundary rule (new paragraph, the
`CachePrefix` example now `"Catalog:Products:"`, tenant examples now end in `:`): `ICacheService.cs:91-113`,
enforced at `MemoryCacheService.cs:146` and `HybridCacheService.cs:335` (`CachePrefixContract.cs:17`);
`ICacheInvalidating.cs:10-22`; `ICacheInvalidating<TEntity>` default prefix `:25-43`. (4) Decorator handling
of a malformed prefix: `CachingCommandDecorator.cs:76-83` (Error level `:131-133`, no delayed retry); the
5-second delay `:45`, `CancellationToken.None` `:73` and `:111-112`, warning swallow `:84-89`, `:114-125`
unchanged. (5) `TryGetAsync` overridden by both stores (`MemoryCacheService.cs:62` per finding, not re-read;
`HybridCacheService.cs:224-249`). (6) `IncrementAsync`: only the hybrid overrides (`HybridCacheService.cs:362-383`);
interface default `ICacheService.cs:133-139`, hash and `WRONGTYPE` reason `:129-131`; the `absexp`/`sldexp`/`data`
detail dropped with its retired anchor. (7) `CacheSettings.DefaultDuration` (`CacheSettings.cs:34`) read by two
backends: `MemoryCacheService.cs:84`, `HybridCacheService.cs:460`; constant `CacheOptions.cs:23`. (8) `hc:`
rationale: `HybridCacheService.cs:18-24`, `hcg:` `CachePrefixGenerations.cs:76`. (9) Namespace applied by the
hybrid only, to entries and generation keys (`HybridCacheService.cs:146`, `:440-449`); in-process skips it
(`DependencyInjection.Caching.cs:95`); cross-service keys `HybridCacheService.cs:48-53`, `:442-445`,
`CacheKeyPrefix.cs:55`, `:105`, `:120`, wiring `DependencyInjection.Caching.cs:196-204`. (10) Host wiring:
every service calls `AddMmcaServiceHost` (ADC Conference `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`,
Identity `:79`, Engagement `:58`, Notification `:58`; Store Catalog `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`,
Identity `:37`, Sales `:51`), which calls `AddRedisCaching` (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:91`),
`AddRedisOutputCaching` when `UseRedisOutputCaching` (`:92-94`, option `MmcaServiceHostOptions.cs:55`) and
`AddCommonHybridCacheWhenRedisConfigured` (`:97`; guard `DependencyInjection.Caching.cs:232-235`); adopters
opt in at ADC Conference `Program.cs:129` and Store Catalog `Program.cs:53`. (11) Broker naming: MassTransit
names gone (no `KebabCaseEndpointNameFormatter`, `EndpointPrefix` or `PreserveDefaultEndpointNames` in
`MMCA.Common/Source`, Grep this run); topics prefixed with the namespace and a broker host throws without an
explicit `Application:Namespace` (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:89-91`,
`:270-278`; `Configuration/ApplicationNamespace.cs:29-30`); sanitize reason now names broker queue or topic
names (`:79`), `Resolve` `:60`, `Sanitize` `:84`, `ConfigurationKey` `:38`, `Fallback` `:41`; backplane
`DependencyInjection.Notifications.cs:59` passes no environment. (12) Store keyspaces: `"Namespace": "store"`
in all three (`appsettings.json` Catalog `:40`, Identity `:40`, Sales `:50`) with `KeyPrefix` `store-catalog:`
`:43`, `store-identity:` `:43`, `store-sales:` `:53`; no `PreserveDefaultEndpointNames` in either app's
service JSON (Grep this run). ADC `"Namespace": "adc"` Conference `:54`, Identity `:48`, Engagement `:66`,
Notification `:78`, `"KeyPrefix": "adc:"` `:61`, `:55`, `:73`, `:85`. (13) Client tier removed from the body:
no `UiReadCache` in `MMCA.Common/Source` (Grep this run); ADR-026 Amended 2026-11-17 (`026-caching-strategy.md:57-61`,
heading `:248`). (14) Store Catalog policies: three (`Program.cs:59-69`: `CategoriesCache` 5 min `:60`,
`ProductsCache` 60 s `:65`, `ProductImagesCache` 5 min `:69`). (15) ADC Conference: twelve policies,
`ConferenceCache` on built-in default semantics (`Program.cs:138-144`), eleven public policies `:175-216`, ten
with `adminBypassRoles` (`:174`), `NowNextCache` none `:202`, `SessionsCache` also bypassing
`SessionAssetsManage` by permission `:181-192` (constructor `MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:92`,
check `:180-188`); ADR-026 Revised 2026-11-23 `026-caching-strategy.md:62-68`. (16) Replica staleness:
single-key removal `HybridCacheService.cs:305-316`, `LocalCacheDefault` 30 s `:71`, `WriteOptions` `:458-469`.
(17) Closing summary backend count.
**Carried, not re-read this run** (anchors as of the 2026-10-29 pass; the findings
reported these sections accurate): read path `CachingQueryDecorator.cs` (`EffectiveKey` `:58-59`, populate lock
`:87`, failure-skip `:118`, `CacheDuration` passed `:122`); key transformations `TenantCacheKey.cs:28`,
`UserCacheKey.cs:26-39`; `BestEffort.cs:45-115`, `OutputCacheEvictionExtensions.cs:49-90`; fail-open
`SoftDeletedUserMiddleware.cs:13-149`, `DeleteUserHandlerBase.cs:14-15`, `:66-69`; edge tier
`PublicEndpointOutputCachePolicy.cs` (`AllowLocking` and `QueryKeys` per that pass), `NoLimiter`
`WebApplicationBuilderExtensions.RateLimiting.cs:83-93`; cross-service eviction
`OutputCacheEvictionRequested.cs:28-37`, `OutputCacheEvictionHandler.cs:32-60`, `OutputCacheMetrics.cs:19-30`,
ADC `BookmarkCacheEvictionProcessor.cs:46`, `:62-79`, Store `CustomerErasedHandler.cs:109`; adoption
(`GetNowNextHandlerTests.cs:212`, Helpdesk `GetTicketByIdQuery.cs:23`); load scripts and warmup; the
`WRONGTYPE` incident `MMCA.Common/CHANGELOG.md:5035`; `RedisCachingExtensions.cs` blank-string no-op and
`DisableHealthChecks` (method now `:69`, `AddRedisOutputCaching` `:103`, this run); scorecard §10/§12 rows
and the perf-gate description. The body states no scorecard index.
Verifier fixes (2026-11-25): (a) `SessionsCache` bypass permission is `conference:session-assets:manage`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:47`).
(b) The fitness rule flags every concrete `ICacheInvalidating` implementer not on the generic form with no
own `CachePrefix`, unless allow-listed, so the hand-written example needs `AllowedCustomPrefixTypes`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.CacheInvalidation.cs:14-17`,
`:26-30`, `:56-59`; `Bases/Cqrs/CacheInvalidationConventionTestsBase.cs:12`, `:30`). (c) Direct consumers add
Store's guest-checkout throttle (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/GuestCheckoutThrottle.cs:63`,
`:75`, `:88`), ADC's ticket-claim counter
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Tickets/UseCases/ClaimTicket/ClaimTicketHandler.cs:64`,
`:109`) and sign-in-link invitation sent marker
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SendSignInLink/SendSignInLinkInternalCommandHandler.cs:81`,
`:115`, `:122`). (d) `GetFromSharedStoreAsync` users add the guest-checkout counter read (`GuestCheckoutThrottle.cs:75`).
(e) Prefix-invalidation window is one local duration plus one refresh round trip, and in a partial outage
the outage length plus one local duration; the 30-second figure is the local duration, not a cap
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixGenerations.cs:37-42`, `:63-65`).
(f) `AddCaching` registers no other cache backend, but also `IDistributedLock`, the cache options and the
`RedisOutputCacheOptions` post-configure (`MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:44-77`,
`:109-123`). (g) Adoption pin anchor corrected to
`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextHandlerTests.cs:212`.*

- Full series index: https://ivanball.github.io/writing.html
