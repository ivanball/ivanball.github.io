# ADR-135: One Application Namespace Isolates Shared Infrastructure Keyspaces

## Status
Accepted (2026-10-26).

## Context
Several framework subsystems write into infrastructure that more than one deployed application can
point at: Redis (distributed cache entries, distributed-lock keys, distributed rate-limit counters,
the SignalR backplane) and the message broker (consumer queue and endpoint names). A keyspace that is
shared by accident is a correctness and a security problem, not a tidiness one, and nothing in the
infrastructure itself warns when two applications collide in it.

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
One resolver, `ApplicationNamespace`, names the shared-infrastructure keyspaces of four subsystems
(distributed cache and lock keys, distributed rate-limit counters, the SignalR backplane, broker
endpoint names), and isolation is the default rather than an opt-in. The Redis output-cache store
is not one of them (see Trade-offs).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:67`), to
  `RedisDistributedLock` (`:95-96`) and to the opt-in `HybridCacheService` (`:173`). The in-process
  `MemoryCacheService` takes no prefix, because its keyspace is private to the process (`:76`).
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
  different everywhere else (`ApplicationNamespace.cs:22-25`). The subsystem keys
  (`Cache:KeyPrefix`, `MessageBus:EndpointPrefix`) remain for pinning one keyspace alone
  (`CacheKeyPrefix.cs:36-41`).

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
- **One name, not four defaults.** Each subsystem already had, or needed, its own prefix setting.
  Deriving all of them from one value means a host that is isolated for caching is also isolated on
  the backplane and on the broker, and an operator who needs two hosts to share a keyspace changes
  one key rather than remembering four.
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
  (`MMCA.Common/CHANGELOG.md:2367-2374`). `MessageBus:PreserveDefaultEndpointNames` keeps MassTransit's
  unprefixed names for a deployment that cannot rename its queues and subscriptions
  (`DependencyInjection.Messaging.cs:95-97`).
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
- **The output cache is not covered.** `AddRedisOutputCaching` registers the Redis output-cache
  store with a connection string and no instance name or namespace
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:99`), so
  output-cache entries and tag sets on a shared Redis are not isolated per application. It is
  adopted by `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:202` and
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:105`.
- **Sanitization can merge names.** Distinct raw names that differ only in characters outside
  `[a-zA-Z0-9_-]` sanitize to the same value (`ApplicationNamespace.cs:81`).

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
