# ADR-135: One Application Namespace Isolates Shared Infrastructure Keyspaces

## Status
Accepted (2026-10-26). Revised 2026-10-28: the Redis output-cache store is now a fifth namespaced
keyspace (its `InstanceName` defaults to the cache key prefix), and the cache anchors are refreshed.

## Context
Several framework subsystems write into infrastructure that more than one deployed application can
point at: Redis (distributed cache entries, distributed-lock keys, distributed rate-limit counters,
output-cache entries and tag sets, the SignalR backplane) and the message broker (consumer queue
and endpoint names). A keyspace that is shared by accident is a correctness and a security
problem, not a tidiness one, and nothing in the infrastructure itself warns when two applications
collide in it.

The resolver's own remarks record the failure this decision closes (SEC-Common-53,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:14-19`).
Two MMCA hosts on one Redis or one broker shared every keyspace by default: the cache prefix
defaulted to empty, the lock keys reused it, the broker endpoint prefix was optional, and the SignalR
backplane had no prefix knob. Because `NotificationHub` ships in the framework, its backplane channel
name is identical in every consumer, so a user-targeted push or a live-channel event published in one
application reached the other application's clients holding the same numeric user id
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:50-55`).
The same shape put two applications' consumers on the same queue names
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:90-93`).

Until now the decision lived only as revision lines spread across the ADRs that own each keyspace
(see Related). This record states it once.

## Decision
One resolver, `ApplicationNamespace`, names the shared-infrastructure keyspaces of five subsystems
(distributed cache and lock keys, distributed rate-limit counters, the Redis output-cache store, the
SignalR backplane, broker endpoint names), and isolation is the default rather than an opt-in.

- **One resolver, one precedence.** `ApplicationNamespace.Resolve`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:53`)
  returns the explicit `Application:Namespace` value when set (`:31`, `:55-59`), otherwise the host
  application name from `IHostEnvironment.ApplicationName` or, when no environment is passed or its
  name is blank, the `applicationName` configuration key (`:40`, `:61-65`), otherwise the constant
  `app` (`:34`, `:67`).
- **The value is sanitized for every consumer at once.** `Sanitize` replaces each run of characters
  outside `[a-zA-Z0-9_-]` with `-`, trims leading and trailing dashes, and returns `app` when nothing
  survives (`ApplicationNamespace.cs:42-43`, `:77-83`), so one value is legal as a Redis key part, a
  SignalR channel prefix and a MassTransit queue name.
- **Never empty.** Every branch of `Resolve` yields a non-empty string (`ApplicationNamespace.cs:46-48`,
  `:67`), so a host that configures nothing still gets its own keyspace.
- **Distributed cache and distributed lock keys.** `CacheKeyNamespace.From(IServiceProvider)` uses an
  explicit `Cache:KeyPrefix` when set and otherwise `"{namespace}:"`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:73-88`, the
  `Resolve` call at `:83`). That one namespace is passed to `DistributedCacheService`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:83`, `:88`),
  to `RedisDistributedLock` (`:111-112`) and to the opt-in `HybridCacheService` (`:189`, `:195`).
  The in-process `MemoryCacheService` takes no prefix, because its keyspace is private to the
  process (`:92-95`).
- **Redis output-cache store.** `AddCaching` post-configures `RedisOutputCacheOptions.InstanceName`
  to the same `CacheKeyNamespace` prefix when the host left it empty, and keeps an `InstanceName` a
  host set explicitly (`DependencyInjection.Caching.cs:66-73`, the keep-explicit check at `:69`).
  The registration comment records that the store prefixes both its value keys and its tag keys
  with that name, so tag eviction sees the same key shape (`:60-65`); no test pins that key shape. `AddInfrastructure` calls `AddCaching`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:140`), so no consumer
  change is needed: `AddRedisOutputCaching` still registers the store with the connection string
  alone (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:99`) and
  the isolation is applied downstream. The registration is inert when no store is registered.
  `OutputCacheNamespaceTests` pins the namespace default, the `Cache:KeyPrefix` override and the
  kept explicit value
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Caching/OutputCacheNamespaceTests.cs:41`,
  `:51`, `:61`). The store is adopted by
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:202` and
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:105`.
- **Distributed rate-limit counters.** `RateLimitKeyNamespace` uses `Cache:KeyPrefix` without its
  trailing colon when set, otherwise the resolved namespace
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:220-226`,
  the `Resolve` call at `:224`), and qualifies each Redis counter key as
  `{namespace}:{scope}:{key}` (`:275`).
- **SignalR Redis backplane.** When a `redis` connection string is present, the backplane
  `ChannelPrefix` is the resolved namespace
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:56-58`).
  There is no subsystem-specific override here: `Application:Namespace` is the only knob.
- **Broker endpoint names.** Unless `MessageBus:PreserveDefaultEndpointNames` is set, the endpoint
  name formatter takes `MessageBus:EndpointPrefix` when set and otherwise the resolved namespace
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:98-105`, the
  `Resolve` call at `:101`; the settings at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:80`, `:90`).
- **When to set the override.** Set `Application:Namespace` only when two hosts of the SAME
  application must share a keyspace (a web head and a worker draining one backplane), and keep it
  different everywhere else (`ApplicationNamespace.cs:22-25`). The subsystem keys remain for
  pinning narrower scopes: `MessageBus:EndpointPrefix` pins the broker endpoints alone, while
  `Cache:KeyPrefix` (`CacheKeyPrefix.cs:36-41`) pins four Redis keyspaces together, the cache and
  lock keys (`CacheKeyPrefix.cs:77-80`), the rate-limit counters
  (`WebApplicationBuilderExtensions.RateLimiting.cs:222-225`) and the output-cache `InstanceName`
  (`DependencyInjection.Caching.cs:71`). Only an explicit `RedisOutputCacheOptions.InstanceName`, set
  in code, pins the output cache alone (`DependencyInjection.Caching.cs:69`).

Adoption differs per consumer. Every MMCA.ADC service pins `Application:Namespace` to `adc` and
`Cache:KeyPrefix` to `adc:`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:38`, `:45`; likewise the
Identity, Engagement and Notification services at `appsettings.json:46`, `:58`, `:72`), so its four
services deliberately share one keyspace. Every MMCA.Store service pins its own value
(`store-sales`, `store-identity`, `store-catalog`) with a matching `Cache:KeyPrefix`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:52`, `:55`; the Identity and
Catalog services at `appsettings.json:42`, `:45`), so a project rename cannot move a keyspace
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:39-43`). Both ADC and Store
also set `MessageBus:PreserveDefaultEndpointNames` to `true` in every service
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:62`,
`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:69`), so no deployed ADC or
Store host prefixes its broker endpoints: their live queues and subscriptions keep MassTransit's
default names, and each runs one application per broker namespace
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:45-50`). MMCA.Helpdesk sets
none of these keys, so it takes the default resolution.

## Rationale
- **One name, not one default per subsystem.** Each subsystem already had, or needed, its own
  prefix setting. Deriving all of them from one value means a host that is isolated for caching is
  also isolated in the output cache, on the backplane and on the broker, and an operator who needs
  two hosts to share a keyspace changes one key rather than remembering one per subsystem.
- **The safe state needs no configuration.** The host application name is distinct per deployed app
  and is available without configuration (`ApplicationNamespace.cs:22-23`), so isolation does not
  depend on an operator remembering a setting; the collision that the default used to permit was
  silent.
- **Sharing is the deliberate act.** Two hosts of one application that must cooperate (a backplane
  they both drain, a lock both contend on) are the case that needs a decision, so that case carries
  the explicit setting.
- **Tested as a contract.** `ApplicationNamespaceTests` pins the precedence, the host-key fallback,
  the never-empty rule, per-application distinctness, and the cache default and its explicit
  override (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Configuration/ApplicationNamespaceTests.cs:31`,
  `:41`, `:49`, `:57`, `:65`, `:84`, `:94`).

## Trade-offs
- **Adopting the default renames resources.** Cache and lock keys gain a prefix (a cold cache after
  deploy), the backplane moves channel, and an unset `EndpointPrefix` yields prefixed queue names;
  the CHANGELOG entry tells hosts to set `Application:Namespace` where two hosts of one application
  must share a keyspace and to drain old broker queues on cutover
  (`MMCA.Common/CHANGELOG.md:2410-2417`). Output-cache entries and tag keys gain the same prefix, so
  the output cache also starts cold on the first deploy (`MMCA.Common/CHANGELOG.md:47`).
  `MessageBus:PreserveDefaultEndpointNames` keeps MassTransit's unprefixed names for a deployment
  that cannot rename its queues and subscriptions (`DependencyInjection.Messaging.cs:95-97`).
- **Two hosts of one application need the override.** If they run under different application
  names, the default separates keyspaces that are meant to be shared, so a backplane message or a
  lock held by one is invisible to the other until `Application:Namespace` is set on both.
- **The fallback is shared.** A host whose application name is unavailable resolves to `app`
  (`ApplicationNamespace.cs:34`), and two such hosts on one Redis or broker share a keyspace again.
  The backplane and broker call sites pass no `IHostEnvironment`
  (`DependencyInjection.Notifications.cs:56`, `DependencyInjection.Messaging.cs:101`), so they read
  the name from the `applicationName` configuration key (`ApplicationNamespace.cs:40`, `:61-65`)
  and depend on the host having populated it; a host that leaves the key unset and sets no
  `Application:Namespace` resolves to `app` there.
- **Sanitization can merge names.** Distinct raw names that differ only in characters outside
  `[a-zA-Z0-9_-]` sanitize to the same value (`ApplicationNamespace.cs:81`).

## Revision (2026-10-28)
Re-verified against current source. The resolver, its precedence, sanitization, the rate-limit,
backplane and broker keyspaces, and the per-consumer adoption are unchanged. What moved is the
Redis output-cache store, which is now namespaced like the cache and lock keys.

1. The Redis output-cache store is a fifth covered keyspace. `AddCaching` post-configures
   `RedisOutputCacheOptions.InstanceName` to `CacheKeyNamespace.From(sp).Prefix` when it is empty
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:66-73`), and
   `AddInfrastructure` calls `AddCaching`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:140`). The Decision
   intro now names five subsystems, a Decision bullet records the store, Context lists it among the
   Redis users, and the Trade-offs bullet "The output cache is not covered" is removed. The test
   anchors are `OutputCacheNamespaceTests.cs:41`, `:51`, `:61`; the CHANGELOG fix entry is
   `MMCA.Common/CHANGELOG.md:47`.
2. The Rationale heading "One name, not four defaults" becomes "One name, not one default per
   subsystem", since the output cache follows `Cache:KeyPrefix` and no new MMCA configuration key
   was added for it (an explicit `RedisOutputCacheOptions.InstanceName` set in code is still kept,
   `DependencyInjection.Caching.cs:69`).
3. "Adopting the default renames resources" now also records that the output cache starts cold under
   the new prefix (`MMCA.Common/CHANGELOG.md:47`).
4. Anchors re-verified against current source: `DependencyInjection.Caching.cs:67` -> `:83`, `:88`
   (`DistributedCacheService`); `:95-96` -> `:111-112` (`RedisDistributedLock`); `:173` -> `:189`,
   `:195` (`HybridCacheService`); `:76` -> `:92-95` (`MemoryCacheService`);
   `MMCA.Common/CHANGELOG.md:2367-2374` -> `:2410-2417` (the SEC-Common-53 entry).

## Related
- [ADR-019](019-rate-limiting.md) (Layered Rate Limiting): owns the distributed rate-limit counter
  keyspace qualified by the namespace.
- [ADR-021](021-consumer-inbox-idempotency.md) (Consumer-Side Inbox): owns the consumer endpoint and
  queue names whose default `MessageBus:EndpointPrefix` is the namespace.
- [ADR-024](024-push-notifications.md) (Two-Channel User Notifications): owns `NotificationHub` and
  the SignalR Redis backplane channel the namespace prefixes.
- [ADR-039](039-live-channel-push.md) (Live channel push): owns the live-channel events that ride the
  same notification hub backplane.
- [ADR-108](108-distributed-lock-primitive.md) (Cross-Replica Mutual Exclusion via
  `IDistributedLock`): owns the Redis lock keyspace, which shares the cache key namespace.
- [ADR-114](114-internal-commands-durable-job-queue.md) (Internal Commands): owns durable deferred
  work on the outbox machinery; it links here for the application-namespace decision, and no
  internal-command code calls the resolver directly.
