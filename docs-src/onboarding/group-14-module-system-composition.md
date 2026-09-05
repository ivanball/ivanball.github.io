# 14. Module System, Composition & Configuration

**What this chapter covers.** This is the wiring layer, the code that turns a pile of layered
assemblies into a running host. It answers three questions a new host author asks: *how does the
process discover and assemble its modules?*, *in what order does DI get built so the decorators wrap
the right handlers?*, and *where do the dozens of `appsettings.json` knobs land as typed objects?*
The cast is small but load-bearing: the [`IModule`](#imodule) contract and its
[`IModuleSeeder`](#imoduleseeder) sidekick; the [`ModuleLoader`](#moduleloader) that discovers and
Kahn-sorts them; the two `extension(IServiceCollection)` [`DependencyInjection`](#dependencyinjection)
composition roots (Application and Infrastructure) plus the
[`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder) and the
[`DecoratorPipelineSeal`](#decoratorpipelineseal) marker that together make the ordering rule
enforceable instead of merely documented; the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) assembly anchors that Scrutor and the architecture tests pin to;
the two data-source attributes ([`UseDataSourceAttribute`](#usedatasourceattribute),
[`UseDatabaseAttribute`](#usedatabaseattribute)); the settings types this chapter owns,
[`ApplicationSettings`](#applicationsettings) / [`ModulesSettings`](#modulessettings) /
[`ModuleSettings`](#modulesettings) / [`QueryCachePipelineSettings`](#querycachepipelinesettings) in
Application plus the Infrastructure sections [`MessageBusSettings`](#messagebussettings),
[`SmtpSettings`](#smtpsettings), [`SchedulerSettings`](#schedulersettings),
[`PushNotificationSettings`](#pushnotificationsettings), [`NativePushSettings`](#nativepushsettings)
and [`FileStorageSettings`](#filestoragesettings) (the persistence, auth, caching and outbox sections
the same root binds are documented in [group 07](group-07-persistence-ef-core.md),
[group 08](group-08-auth.md), [group 09](group-09-caching.md) and
[group 04](group-04-events-outbox.md)); the delivery implementations those sections switch between,
null-object by default and Azure-backed when configured ([`NullNativePushSender`](#nullnativepushsender),
[`NullPushDeviceRegistrar`](#nullpushdeviceregistrar),
[`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender),
[`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar),
[`NativePushPayloads`](#nativepushpayloads), [`NullFileStorageService`](#nullfilestorageservice),
[`AzureBlobFileStorageService`](#azureblobfilestorageservice),
[`ImageSharpImageProcessor`](#imagesharpimageprocessor)); the cross-replica locking pair
([`RedisDistributedLock`](#redisdistributedlock), [`InProcessDistributedLock`](#inprocessdistributedlock));
the host-scoped job runner ([`ScheduledJobRunner`](#scheduledjobrunner)) and the
[`PeriodicBackgroundService`](#periodicbackgroundservice) base the other fixed-interval sweeps derive
from; the broker-side consumers a host composes
([`FaultIntegrationEventConsumer<TEvent>`](#faultintegrationeventconsumertevent),
[`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent)) with the
boot-time [`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator); the scoped
[`TenantContext`](#tenantcontext); and the shared **Users**
use-case bases that two apps compose into their own Identity modules. The detailed per-type sections
follow; this overview shows how the pieces fit together at runtime.

`[Rubric §7, Microservices Readiness]` (assesses whether modules can be enabled, disabled, and
deployed independently with minimal coupling) is the lens this whole chapter is built around: the
module system is *the* boundary that lets MMCA.ADC run as either a single monolith host or four
separate service processes from the **same module code**, configuration-switched. `[Rubric §12,
Performance & Scalability]` and `[Rubric §3, Clean Architecture]` also run throughout: composition is
where the inward-pointing dependency rule gets physically realized (Infrastructure references
Application references Domain references Shared), and where cross-cutting concerns are registered once
for every module rather than per-feature. The ADRs that explain *why* this shape exists are
[ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) (the module
contract itself), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
(service-extraction topology), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
(database-per-service) and [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)
(the decorator pipeline whose ordering rule this chapter enforces).

## The module contract and the boundary it creates

A **module** is the unit of cohesion above a feature slice: Conference, Engagement, Identity,
Notification. Each one implements [`IModule`](#imodule)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7`): a display `Name`
(`IModule.cs:12`), an optional `Dependencies` list of other module names (`IModule.cs:17`), a
`RequiresDependencies` flag (`IModule.cs:23`), and one `Register(services, configuration,
applicationSettings)` method (`IModule.cs:28`) that wires *all* of that module's services. Three of
those five members are default-implemented on the interface (`Dependencies => []` at `IModule.cs:17`,
`RequiresDependencies => false` at `IModule.cs:23`, and an empty-bodied `RegisterDisabledStubs` at
`IModule.cs:34`), so a leaf module is just `Name` plus `Register`. ADC's modules are deliberately
thin: `ConferenceModule`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:15`) is barely more
than a dozen lines. Its `Register` forwards to an `AddConferenceModule(applicationSettings)` extension
method (`ConferenceModule.cs:28-29`), and its `RegisterDisabledStubs` (`ConferenceModule.cs:21-25`)
registers a `DisabledSessionBookmarkValidationService` and a `DisabledEventLiveValidationService` so a
host that *disables* Conference still has those cross-module contract types resolvable in DI.

That last detail is the crux of the extraction boundary. `RegisterDisabledStubs` plus
`RequiresDependencies` is what makes one module assembly boot in two topologies. When Conference runs
in its own service the Engagement module is *disabled* in that host's config, yet Conference's
`GetSessionBookmarkCountHandler` still needs Engagement's `IBookmarkCountService`, so the disabled
Engagement module contributes a stub and the host then *replaces* that stub with a typed gRPC client
pointed at the real Engagement process
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:329-333`, `:349`). Application code
never learns which path it got; the transport choice lives entirely at the composition edge
([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §2,
Design Patterns]` applies here: this is a clean strategy / null-object pairing (real service, disabled
stub, remote client) rather than scattered `if (moduleEnabled)` checks.

## Discovery and Kahn-ordered registration

[`ModuleLoader`](#moduleloader)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15`) is the engine. Its one
`DiscoverAndRegister` overload (`ModuleLoader.cs:58-64`) takes the assemblies to scan as a required
parameter: there is no AppDomain-scan convenience, and the parameter doc says why, because an
AppDomain scan only sees assemblies already loaded, so a module assembly that is referenced but not
yet touched by any code path would be silently absent from discovery (`ModuleLoader.cs:48-53`). The
scan guards each `GetTypes()` call against a throwing assembly so one bad reference logs a warning
instead of aborting the whole pass (`ModuleLoader.cs:71-84`), then instantiates every concrete
[`IModule`](#imodule) via `Activator.CreateInstance` (`ModuleLoader.cs:86-89`) and every concrete
[`IModuleSeeder`](#imoduleseeder) into a case-insensitive dictionary keyed by `ModuleName`
(`ModuleLoader.cs:91-94`).

Ordering is **Kahn's topological sort** (`ModuleLoader.cs:271-321`) over the modules' declared
`Dependencies`. Kahn's algorithm is BFS over a dependency graph: compute each module's in-degree
(count of unprocessed dependencies, `ModuleLoader.cs:276`), build the reverse adjacency list of
dependents (`ModuleLoader.cs:279-292`), seed a queue with the zero-in-degree modules
(`ModuleLoader.cs:295-296`), and as each is emitted decrement its dependents' in-degrees, enqueuing
any that reach zero (`ModuleLoader.cs:305-309`). A dependency name that was never discovered is
skipped rather than treated as an edge (`ModuleLoader.cs:286-287`); validation catches it later. If
fewer modules come out than went in, the remainder form a cycle and the loader throws with the
offending names (`ModuleLoader.cs:313-318`). The payoff is an ordering where a module's DI
registrations always exist *before* any dependent registers, which matters because the CQRS decorator
pipeline (below) can only wrap handlers that are already in the container.

For each sorted module the loader checks [`ModulesSettings.IsModuleEnabled`](#modulessettings)
(`ModuleLoader.cs:101`). A disabled module gets `RegisterDisabledStubs` called, has the exact service
descriptors that call added recorded (`ModuleLoader.cs:107-109`), and is listed in
`DisabledModuleNames` (`ModuleLoader.cs:111`); an enabled one runs `ValidateModuleDependencies` then
`RegisterEnabledModule` (`ModuleLoader.cs:115-116`) and contributes its seeder if one was found
(`ModuleLoader.cs:118-121`). Registration is also where **per-module configuration** is loaded by
convention: before calling `module.Register(...)` the loader adds `modules.{name}.json` and, when an
environment name is passed, `modules.{name}.{environment}.json` to the configuration builder
(`ModuleLoader.cs:174-178`), so a module can ship its own config file. Dependency validation
(`ModuleLoader.cs:125-158`) is microservice-aware: a dependency that is disabled in-process but listed
in that consumer's [`ModuleSettings`](#modulesettings) `RemoteDependencies` is treated as *satisfied
remotely*, and only a `RequiresDependencies = true` module with a genuinely unsatisfied dependency
throws, with an error message that spells out the three ways to fix it (`ModuleLoader.cs:139-147`).
Every step emits a `[LoggerMessage]`-generated structured log (`ModuleLoader.cs:323-342`), so the
startup log tells you exactly which modules loaded, in what order, and how long each took
(`ModuleLoader.cs:180-183`).

Trusting configuration is not quite enough, so the loader offers a second, post-build gate:
`ValidateRemoteDependencies(serviceProvider)` (`ModuleLoader.cs:201-223`) walks every remote-declared
dependency, resolves each service type the disabled module's stub had registered, throws when one does
not resolve at all, and logs a warning when it still resolves to the stub implementation
(`ModuleLoader.cs:225-246`). That converts a forgotten gRPC-client registration from a first-request
mystery into a startup failure. It is a capability, not a habit: today only
`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs` calls it, and no
ADC or Store host does. `[Rubric §13, Observability & Operability]` is the category at play in both
this method and the log messages above.

The loader is **not** called from inside `AddApplication()`, and a host no longer constructs it by
hand either. `AddModuleHost` in the API layer
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:51`) binds and
validates [`ApplicationSettings`](#applicationsettings) and [`ModulesSettings`](#modulessettings)
(`ModuleHostExtensions.cs:61-76`), constructs the [`ModuleLoader`](#moduleloader) with the host's
bootstrap logger, registers it as a singleton (`ModuleHostExtensions.cs:78-82`), and hands back a
[`ModuleHostContext`](group-12-api-hosting-mapping.md#modulehostcontext) whose `RegisterModules`
method is the discovery step
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostContext.cs:66-77`). Discovery
deliberately does *not* run inside `AddModuleHost`: it has to land inside the application pipeline
described next, and its position relative to a host's other steps is a per-host decision
(`ModuleHostContext.cs:12-19`). After discovery the loader also drives startup data through
`SeedAllAsync` (`ModuleLoader.cs:255-261`), which invokes each collected
[`IModuleSeeder.SeedAsync`](#imoduleseeder) in registration order.
[`IModuleSeeder`](#imoduleseeder)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8`) is a two-member
interface, `ModuleName` (`IModuleSeeder.cs:13`, matched case-insensitively against an
[`IModule`](#imodule) `Name`) and `SeedAsync(serviceProvider, cancellationToken)`
(`IModuleSeeder.cs:18`), deliberately separate from `IModule` so seeding runs *after* the whole
container is built and a real `IServiceProvider` exists.

## The two composition roots, and the pipeline that seals them

Service registration itself lives in two static [`DependencyInjection`](#dependencyinjection) classes,
each using a C# `extension(IServiceCollection services)` block (see
[primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the `extension(T)` syntax, and
[ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html) for why
the public DI surface is written that way). The **Application** root
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:27`) exposes `AddApplication()`
(`DependencyInjection.cs:35`), which registers the core singletons
([`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) at `:34`,
[`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) at `:40`,
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider) at
`:42`, [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline) at `:43`)
and pulls in the framework's own FluentValidation validators by assembly
(`DependencyInjection.cs:50`). Each of those four singletons is registered with `TryAddSingleton`, so
a host that registered its own first keeps it. The upcaster registry is registered unconditionally on purpose: with no upcasters it
is an empty registry whose operations are the identity, so both delivery paths can depend on it
without a null check (`DependencyInjection.cs:38-42`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)), and individual
upcasters accumulate through `AddEventUpcaster<TSource, TTarget, TUpcaster>()`
(`DependencyInjection.cs:553`).

The Application root also owns `ScanModuleApplicationServices<TAssemblyMarker>()`
(`DependencyInjection.cs:163-165`) and its `Assembly`-typed overload (`DependencyInjection.cs:181`),
the Scrutor convention scan every module's `AddXModule` call makes: domain-event and integration-event
handlers as singletons (`DependencyInjection.cs:186-198`), DTO mappers, the opt-in
[`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
projectors, request mappers and update appliers scoped (`DependencyInjection.cs:200-238`), command and
query handlers scoped (`DependencyInjection.cs:240-250`), validators from the module assembly
(`DependencyInjection.cs:252`), and finally a reflection pass that `TryAdd`s a
`CommandRequestValidator<,>` for every command implementing `ICommandWithRequest<T>`
(`DependencyInjection.cs:254-268`) so an explicit validator still wins.

The **order** of these calls is a hard contract in exactly one respect, and it is the reason
`AddApplicationDecorators()` (`MMCA.Common.Application/DependencyInjection.cs:117`) must come *last*.
Decorators are registered with **Scrutor's `TryDecorate`**, which wraps *existing* registrations, so
every module's concrete handlers must already be in the container or there is nothing to wrap, and a
handler registered afterwards runs completely unwrapped with nothing failing at startup to say so
(`DependencyInjection.cs:596-599`). Rather than leaving that as a comment, the framework enforces it.
`AddApplicationDecorators()` finishes by calling `SealPipeline`, which `TryAdd`s a singleton instance
of the private marker [`DecoratorPipelineSeal`](#decoratorpipelineseal)
(`DependencyInjection.cs:147`, `:699`, `:712-713`), and every registration entry point that
contributes handlers (`ScanModuleApplicationServices`, `AddEntityCrud`, `AddEntityUpdateVerb`,
`AddEntityUpdate`, `AddMmcaApplicationPipeline` itself) opens with `ThrowIfPipelineSealed`, which scans
the collection for that marker and throws a message naming the offending call
(`DependencyInjection.cs:717-726`). The whole sequence is available as one call,
`AddMmcaApplicationPipeline(configure)` (`DependencyInjection.cs:614-623`): it runs `AddApplication()`,
invokes the callback with a [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Application/MmcaApplicationPipelineBuilder.cs:12`) whose
`ScanModule<TAssemblyMarker>` (`:27`), `ScanModules(params Assembly[])` (`:41`) and
`Register(Action<IServiceCollection>)` (`:62`) steps are where module discovery, gRPC clients and
broker messaging go, and then closes with `AddApplicationDecorators()`. The builder's constructor is
`internal` precisely so it cannot be created outside that call, because outside it nothing keeps the
decorators last (`MmcaApplicationPipelineBuilder.cs:9-14`). A third guard, `VerifyDecoratorPipeline()`
(`DependencyInjection.cs:651`), is never called automatically: it is the hook an architecture fitness
test calls after replaying a host's own registration sequence, and it reports every
`ICommandHandler<,>` / `IQueryHandler<,>` descriptor that still carries an implementation type, which
after decoration is proof that nothing wrapped it (`DependencyInjection.cs:660-692`).
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:66` and
`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:160` are
its callers today.

`AddApplicationDecorators` also encodes the **execution order** via `TryDecorate`'s
reverse-registration rule (registered innermost first,
`MMCA.Common.Application/DependencyInjection.cs:128-145`), so the command pipeline ends up
`FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Transactional -> handler`
and the query pipeline `FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout ->
handler` ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The
rationale for each position is written out in the method's own doc comment
(`MMCA.Common.Application/DependencyInjection.cs:88-115`): authorization sits outside caching so a
denied request neither reads nor populates the cache, validation sits outside the transaction so an
invalid command never opens one, and the timeout budget sits inside validation and outside the
transaction so it covers the database work and cancels it rather than leaving it open. The decorator
types themselves (for example
[`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
[`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult)
and [`TimeoutCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#timeoutcommanddecoratortcommand-tresult))
are documented in the CQRS-pipeline chapter; this chapter owns only the *wiring* of them. An optional
MiniProfiler pair is registered separately by an opt-in `AddApplicationProfiling()`
(`MMCA.Common.Application/DependencyInjection.cs:567`), never by `AddApplicationDecorators()`.
`[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` (open/closed) live here: cross-cutting
behavior is added by wrapping, not by editing handlers.

The **Infrastructure** root
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:53`) exposes
`AddInfrastructure(configuration)` (`DependencyInjection.cs:63`), which binds most of the settings
types in this chapter, registers the three save interceptors as singletons
(`DependencyInjection.cs:67-76`), the persistence stack (data-source service and resolver, entity
registry, the scoped and singleton context factories, repositories, unit of work,
`DependencyInjection.cs:65-121`), Scrutor-scans the framework's own EF entity configurations
(`DependencyInjection.cs:124-129`), adds caching (`DependencyInjection.cs:131`), registers the refresh
session store and its retention sweep behind the same flag that maps the table
(`DependencyInjection.cs:159-172`), and enrolls a startup validator that fails the host on a bad
upcaster graph (`DependencyInjection.cs:190-191`). The outbox hosted services are **conditional**: the
method reads [`MessageBusSettings`](#messagebussettings), calls `EnsureOutboxAvailableForProvider`, and
adds [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) plus `OutboxCleanupService` only
when `IsOutboxEnabled`, otherwise registering
[`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice) so the choice is
visible in the log (`DependencyInjection.cs:201-212`,
[ADR-100](https://ivanball.github.io/docs/adr/100-outbox-opt-in-resolved-from-messaging-mode.html)).
The `OutboxMessages` table stays mapped either way, so flipping the flag is never a migration
(`DependencyInjection.cs:195-200`). Optional add-ons sit alongside the root:
`AddCommonHybridCache` (`DependencyInjection.cs:340`), `AddScheduledJobs` (`:405`), `AddAuditTrail`
(`:476`), `AddMultiTenancy` (`:525`), `AddServices` (`:543`), `AddEntityConfigurationAssembly` (`:597`),
`AddNotificationInfrastructure` (`:614`), `AddPushNotifications` (`:629`),
`AddNativePushNotifications` (`:662`), `AddAzureBlobFileStorage` (`:694`), `AddBrokerMessaging`
(`:746`) and the typed-client helper `AddTypedServiceClient<TInterface, TImplementation>(serviceName)`
(`:833`) that swaps an in-process abstraction for an HTTP transport.

`AddCaching` (`MMCA.Common.Infrastructure/DependencyInjection.cs:229`) also registers this chapter's
one cross-replica primitive: an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that
resolves to [`RedisDistributedLock`](#redisdistributedlock) when the host has an
`IConnectionMultiplexer` registered, and to the warn-once
[`InProcessDistributedLock`](#inprocessdistributedlock) otherwise
(`MMCA.Common.Infrastructure/DependencyInjection.cs:287-301`). The Redis implementation is the
standard `SET key token NX PX ttl` acquire
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:67`) with a
compare-and-delete release script (`RedisDistributedLock.cs:36-37`, evaluated at `:104`), handing back
a [`RedisLockHandle`](#redislockhandle) that releases exactly its own acquisition, once
(`RedisDistributedLock.cs:88`); the fallback is exclusive only inside one process, which is exactly
what its warning says out loud
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:74-75`),
and its [`InProcessLockHandle`](#inprocesslockhandle) simply removes the key from a
`ConcurrentDictionary` (`InProcessDistributedLock.cs:79-91`). A multi-replica host that registers no
Redis client therefore gets one execution of the guarded section per replica. `[Rubric §29,
Resilience]` and `[Rubric §12, Performance & Scalability]` both touch this pair: the degradation is
deliberate, announced, and never silent.

## Opt-in platform features are composed the same way

Four capabilities are registered beside the roots rather than inside them, and they share one
discipline: **registering a feature is not the same as turning it on.** `AddScheduledJobs(configuration)`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:405`) binds
[`SchedulerSettings`](#schedulersettings) and enrolls [`ScheduledJobRunner`](#scheduledjobrunner)
through `TryAddEnumerable` rather than `AddHostedService`, precisely so two modules calling it cannot
start two runners racing for the same rows (`DependencyInjection.cs:412-416`); individual
[`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) implementations arrive through
`AddScheduledJob<TJob>()` (`DependencyInjection.cs:440`), each registered scoped so the runner can
resolve it in a fresh scope per execution. `AddAuditTrail(configuration)`
(`DependencyInjection.cs:476`) binds [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings), adds the
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
and the [`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader) that projects
[`AuditTrailEntryDTO`](#audittrailentrydto) rows, and contributes its own retention job
(`DependencyInjection.cs:478-492`), which only actually runs when the host also enabled the scheduler.
`AddMultiTenancy(configuration)` (`DependencyInjection.cs:525`) binds
[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) and registers
[`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator) as an `IValidateOptions<TenancySettings>`
through `TryAddEnumerable` (`DependencyInjection.cs:527-535`); note what it does *not* do, because
that is the design:
[`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor) and
[`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext), whose scoped implementation
[`TenantContext`](#tenantcontext) reports `IsResolved = false` until a request calls `SetTenant`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/TenantContext.cs:17`, `:20`, registered
at `DependencyInjection.cs:553`), are registered unconditionally by
`AddInfrastructure` and `AddServices` and stay inert until a tenant is resolved, so the framework can
never sit in the half-wired state where entities carry
[`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity) but the write-side guard is off
(`DependencyInjection.cs:73-76`, `:539`,
[ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Finally
`AddUserDataExportSection<TSection>()` (`MMCA.Common.Application/DependencyInjection.cs:510`)
accumulates [`IUserDataExportSection`](#iuserdataexportsection) contributors into the one
`IEnumerable` the export handler fans out over. The governing ADRs are
[ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html),
[ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html), ADR-073 and
[ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html); `[Rubric §30, Compliance
& Data Governance]` is the category the trail and the export both serve.

[`ScheduledJobRunner`](#scheduledjobrunner)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:38`) is the one
of these with real runtime machinery, and it reuses the outbox's idioms wholesale. It is a
`BackgroundService` that returns immediately (after one log line) when `Scheduler:Enabled` is false
(`ScheduledJobRunner.cs:76-81`), waits out a 15-second startup delay so migrations finish first
(`ScheduledJobRunner.cs:68`, `:87`), then loops: run one cycle that reconciles the `ScheduledJobs` rows
against the registered jobs, claims due rows with a lease, executes and stamps the outcome
(`ScheduledJobRunner.cs:93-98`, `:200`), and smart-waits until the earliest upcoming occurrence capped
at `Scheduler:PollingIntervalSeconds` (`ScheduledJobRunner.cs:111-119`). A claim attempt is a single
filtered `ExecuteUpdateAsync` against the still-unleased predicate, so two racing replicas both issue
it and exactly one matches (`ScheduledJobRunner.cs:432-434`); it returns a [`JobClaim`](#jobclaim)
carrying either this replica's lock token or `null` when another replica won the row
(`ScheduledJobRunner.cs:446`), which is what makes an occurrence run exactly once across a scaled host.
The persisted row is [`ScheduledJobEntry`](#scheduledjobentry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20`), deliberately
not an auditable entity: it is framework bookkeeping with an explicit claim lease instead of a
concurrency token, and it is host-scoped, living in the `Default` data source only
(`ScheduledJobEntry.cs:8-19`). [`SchedulerMetrics`](#schedulermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16`) publishes the
`MMCA.Common.Scheduler` meter with a run counter tagged by job and outcome
(`SchedulerMetrics.cs:28-31`), a duration histogram (`SchedulerMetrics.cs:39-42`) and a schedule-lag
histogram (`SchedulerMetrics.cs:50`), the same shape [`BrokerMetrics`](#brokermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`) uses for the
`MMCA.Common.Broker` meter's fault and circuit-open counters (`BrokerMetrics.cs:30`, `:43`). So
`[Rubric §13, Observability & Operability]` is covered by instruments rather than by log scraping.

Two more composition-time shapes sit beside those registrations. The first is the base class the
*other* periodic sweeps derive from: [`PeriodicBackgroundService`](#periodicbackgroundservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/PeriodicBackgroundService.cs:20`)
factors the fixed-interval pattern into one place, an `IsEnabled` gate evaluated once at startup
(`PeriodicBackgroundService.cs:39`), a `StartupDelay` defaulting to 15 seconds (`:31`), then
`ExecuteCycleAsync` on an `Interval` loop (`:25`) whose failing cycle is logged and never kills the
loop, with every wait going through an injected `TimeProvider` so a test can drive it on a fake clock
(`PeriodicBackgroundService.cs:7-11`); its own doc comment records that the outbox processor
deliberately does *not* use it, because a signal-driven smart wait is not a fixed interval (`:13-15`).
The second is the broker side of `AddBrokerMessaging`. Every consumer wired through
`RegisterIntegrationEventConsumer<TEvent>` also gets a
[`FaultIntegrationEventConsumer<TEvent>`](#faultintegrationeventconsumertevent)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:26`),
which turns the `Fault<TEvent>` MassTransit publishes when a consumer exhausts its retry policy into
one structured Error log plus a `broker.fault.count` metric, and which never throws, because a fault
consumer that faulted would publish `Fault<Fault<TEvent>>` and keep re-entering itself
(`FaultIntegrationEventConsumer.cs:7-23`). A *retired* contract is bound instead to
[`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:32`),
which upcasts each message to its terminal contract through
[`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) and dispatches the
handlers registered for *that* contract, so handlers are written once against the newest event type
while producers still publishing the old one keep being delivered, with deduplication still keyed on
the original message id (`UpcastingIntegrationEventConsumer.cs:13-29`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)); registering both
consumers for one type is the documented mistake, since they would compete for one queue and run the
handlers twice (`UpcastingIntegrationEventConsumer.cs:20-22`). The upcaster graph those hops depend on
is checked at boot by [`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/EventUpcasterStartupValidator.cs:20`),
an `IHostedService` that `AddInfrastructure` enrolls through `TryAddEnumerable`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:190`): resolving the registry *is* the check,
because its constructor rejects a duplicate source, a self-mapping and a cycle, so a misconfigured
host fails to start instead of dead-lettering events hours later
(`EventUpcasterStartupValidator.cs:7-17`, `:23-29`).

## Assembly anchors

Several pieces of machinery need a `Type` whose `Assembly` identifies a layer: Scrutor's
`FromAssemblyOf<T>()` scans, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`, and
NetArchTest's per-package anchor. That is what the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) pairs are, one per layer (Domain, Application, Infrastructure),
each a trivial `static class AssemblyReference` holding `Assembly` / `AssemblyName` statics
(`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8-12`) beside a non-static `class
ClassReference` (`AssemblyReference.cs:18`) for the places a generic constraint forbids a static type.
`AddApplication` uses the Application pair for the common validators
(`MMCA.Common.Application/DependencyInjection.cs:50`) and `AddInfrastructure` uses the Infrastructure
pair to scan entity configurations (`MMCA.Common.Infrastructure/DependencyInjection.cs:124-129`). They
are deliberately behavior-free; their whole job is to *name an assembly* for the scanning and
governance tooling. A related, test-only assembly anchor lives in
[`CreateMigrationProofTable`](#createmigrationprooftable)
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests.MigrationsFixture/CreateMigrationProofTable.cs:24`):
a real EF migration for the framework's one SQLite context kept in its own tiny library, because EF
selects migrations by the `[DbContext]` they carry and a migration compiled into the test assembly
would make every test that names that assembly see a pending migration
(`CreateMigrationProofTable.cs:11-21`).

## Configuration binding, the Settings family

Everything a host operator tunes arrives as a strongly-typed settings object bound from an
`appsettings.json` section, each carrying a `static readonly string SectionName` so the section name
lives next to the shape it binds. The pattern in `AddInfrastructure` is uniform:
`services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
(for example [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) at
`MMCA.Common.Infrastructure/DependencyInjection.cs:78-81`), so misconfiguration **fails fast at
startup** rather than lazily on first use
([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)). There are
no `ISettings` facade interfaces over these types: consumers take `IOptions<T>` (or the concrete
singleton, for the two dictionary-shaped ones) directly. `[Rubric §13, Observability & Operability]`
and `[Rubric §15, Best Practices]` apply: `ValidateOnStart` plus DataAnnotations ranges (for example
[`OutboxSettings`](group-04-events-outbox.md#outboxsettings) `BatchSize` is `[Range(1, 1000)]` with a default of 50,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:15-17`) turn a config
typo into an immediate, descriptive boot failure.

The Application-layer settings drive composition itself. [`ApplicationSettings`](#applicationsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:8`) carries
`UseMiniProfiler`, `MaxPageSize` (default 500), `MaxExportRows` (`[Range(1, 10_000_000)]`, default
100,000) and `DatabaseInitStrategy` (default `"Migrate"`, `ApplicationSettings.cs:14-43`), and is
passed by value into every `IModule.Register`. [`ModulesSettings`](#modulessettings) *is* a
`Dictionary<string, ModuleSettings>` bound from the `"Modules"` section
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7-10`) whose
`IsModuleEnabled` and `IsDependencyRemote` helpers (`ModulesSettings.cs:18-32`) the loader queries;
note that a module absent from configuration is treated as **disabled** (`ModulesSettings.cs:19`).
[`ModuleSettings`](#modulesettings) carries the per-module `Enabled` flag (default `true`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:9`) and the
`RemoteDependencies` list (`ModuleSettings.cs:38`) that flips a dependency from "in-process" to
"satisfied by an extracted service", with a worked monolith-after-extraction config example on the
property itself (`ModuleSettings.cs:24-35`). One more Application-layer settings class exists for a
layering reason rather than a composition one: [`QueryCachePipelineSettings`](#querycachepipelinesettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:20`) exposes
the single `Cache:PopulateLockTimeout` knob the caching query decorator needs, because that decorator
lives in Application and Application cannot reference Infrastructure where
[`CacheSettings`](group-09-caching.md#cachesettings) binds the rest of the same section
(`QueryCachePipelineSettings.cs:4-18`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:16-20`); `AddCaching`
binds both from the same section so they cannot drift
(`MMCA.Common.Infrastructure/DependencyInjection.cs:246-254`).

The Infrastructure settings cover the rest of the platform. `AddInfrastructure` binds them here even
though several belong to other chapters by subject (persistence in
[group 07](group-07-persistence-ef-core.md), auth in [group 08](group-08-auth.md), caching in
[group 09](group-09-caching.md), the outbox in [group 04](group-04-events-outbox.md)): the binding
discipline is this chapter's, the types are theirs. Starting with the database ones,
[`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettings.cs:12`) has **no
required property at all**: SQL Server is the default engine, but a host may run entirely on SQLite or
Cosmos, and may declare its databases through the `DataSources` section instead
(`ConnectionStringSettings.cs:3-11`). What *is* required is that the host can reach some database, and
that rule spans two sections, so it cannot be a data annotation:
[`ConnectionStringSettingsValidator`](group-07-persistence-ef-core.md#connectionstringsettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettingsValidator.cs:30`)
is registered as an `IValidateOptions<ConnectionStringSettings>` via `TryAddEnumerable`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:85-86`) and passes only when the top-level section
names a database on any engine or one `DataSources` entry does
(`ConnectionStringSettingsValidator.cs:46-52`, `:56-72`), failing with a message that lists both shapes
because which one is missing depends on whether the host is a single-database monolith or a
database-per-module one (`ConnectionStringSettingsValidator.cs:38-44`).
[`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) with its per-entry
[`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:19`) is the
logical-to-physical source map for database-per-service, built *directly* from
`Get<Dictionary<...>>` rather than through the options pipeline
(`MMCA.Common.Infrastructure/DependencyInjection.cs:90-92`) because a root-level dictionary section
does not bind that way, with a constructor that rejects an empty or reserved `"Default"` key
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourcesSettings.cs:27-40`).

The rest of the platform sections follow the same discipline: [`MessageBusSettings`](#messagebussettings)
and its [`MessageBusProvider`](#messagebusprovider) enum (`InProcess` / `RabbitMq` / `AzureServiceBus`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:199-215`) that
`AddBrokerMessaging` switches on, short-circuiting entirely for `InProcess`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:755-758`) and otherwise `Replace`-ing both
[`IMessageBus`](group-04-events-outbox.md#imessagebus) and
[`IEventBus`](group-04-events-outbox.md#ieventbus) with their broker-backed counterparts
(`DependencyInjection.cs:785`, `:777`), with the whole local-emulator path for Azure Service Bus
quarantined in [`ServiceBusEmulatorSupport`](#servicebusemulatorsupport)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/ServiceBusEmulatorSupport.cs:32`) and
entered only when the resolved connection string carries `UseDevelopmentEmulator=true`, a token a real
namespace never has (`ServiceBusEmulatorSupport.cs:12-18`,
[ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html));
[`OutboxSettings`](group-04-events-outbox.md#outboxsettings) (batch size, retries, polling and processing intervals, lease,
retention) consumed by the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor);
[`PersistenceSettings`](group-07-persistence-ef-core.md#persistencesettings), whose single `CommandTimeoutSeconds` defaults to the 30
seconds the framework applied implicitly before the section existed
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/PersistenceSettings.cs:21-22`); the
JWT/JWKS group ([`JwtSettings`](group-08-auth.md#jwtsettings), the
[`JwtSigningAlgorithm`](group-08-auth.md#jwtsigningalgorithm) enum
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSigningAlgorithm.cs:21`), and
[`JwksSettings`](group-08-auth.md#jwkssettings), whose `Enabled` defaults to `false` so an HMAC-only deployment does
not start advertising an RSA key set by accident,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:22-25`); and the delivery
channels, [`SmtpSettings`](#smtpsettings), [`PushNotificationSettings`](#pushnotificationsettings),
[`NativePushSettings`](#nativepushsettings)
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) and
[`FileStorageSettings`](#filestoragesettings)
([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)). The last
two follow a stricter rule on purpose: their `Add*` methods bind the section and then **no-op** when it
is disabled or incomplete (`MMCA.Common.Infrastructure/DependencyInjection.cs:667-673` and
`:699-710`), so a host registers them unconditionally and a deployment switches the channel on by
configuration alone. What makes that safe is that `AddServices` has already registered a working
null-object default behind each of those contracts: [`NullNativePushSender`](#nullnativepushsender) and
[`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) (`DependencyInjection.cs:579-580`), and
[`NullFileStorageService`](#nullfilestorageservice) beside the real
[`ImageSharpImageProcessor`](#imagesharpimageprocessor) (`DependencyInjection.cs:584-585`). Application
code therefore always resolves something, and a configured section merely upgrades the registration to
[`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) plus
[`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar)
(`DependencyInjection.cs:678-679`), whose wire payloads and 20-tag chunking live in the pure helper
[`NativePushPayloads`](#nativepushpayloads)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:10`,
`:13`), or to [`AzureBlobFileStorageService`](#azureblobfilestorageservice)
(`DependencyInjection.cs:719`). `[Rubric §2, Design Patterns]` again: a null object, not a nullable
dependency. `AddPushNotifications` does not share the no-op rule: it always adds SignalR, adds the
Redis backplane when a `redis` connection string is present, and replaces the in-app notification
sender and live-channel publisher with their SignalR-backed implementations
(`DependencyInjection.cs:635-648`). One binding is deliberately
elsewhere: `JwtSettings` is bound by the API layer's `AddCommonAuthentication`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:541-542`),
so a host that skips authentication never pays for a JWT section it does not have.

The three opt-in feature sections follow the same shape with one extra rule worth reading closely.
[`SchedulerSettings`](#schedulersettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerSettings.cs:16`) and
[`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:16`) each make
`Enabled` (default `false`) the *single* gate over both the behavior and whether the backing table is
mapped into the model at all (`SchedulerSettings.cs:10-14`, `AuditTrailSettings.cs:10-15`), so a host
that never opts in keeps exactly the migrations it had. Their tunables are ranged the same way
(`PollingIntervalSeconds` default 30 and `LeaseSeconds` default 300, `SchedulerSettings.cs:28-43`;
`RetentionDays` default 90, `AuditTrailSettings.cs:37-38`), and per-job retiming lives in
[`ScheduledJobOverrideSettings`](#scheduledjoboverridesettings) bound from `Scheduler:Jobs:{Name}`
(`SchedulerSettings.cs:60`, `:66-74`). [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:50`) adds the
collection-binding subtlety: `ResolutionOrder` and `ExcludedPathPrefixes` bind as *empty* lists and the
framework reads `EffectiveResolutionOrder` / `EffectiveExcludedPathPrefixes` instead
(`TenancySettings.cs:76`, `:106`), because the configuration binder ADDS to a pre-populated collection
rather than replacing it, so a non-empty default would leave a host running the framework's entries as
well (`TenancySettings.cs:41-48`). Its per-tenant database routing is pure configuration:
[`TenantEntrySettings`](group-07-persistence-ef-core.md#tenantentrysettings) (`TenancySettings.cs:121`) keys
[`TenantDataSourceOverrideSettings`](group-07-persistence-ef-core.md#tenantdatasourceoverridesettings) (`TenancySettings.cs:138`) by
**physical** data source name, and [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23`) fails
the boot when an override names a source that does not exist, when it declares no connection string at
all, or when the resolution order names [`TenantResolutionStrategy`](group-07-persistence-ef-core.md#tenantresolutionstrategy) `Host`,
which is defined but not implemented (`TenancySettings.cs:21-27`). Every one of those failures is a
misconfiguration that would otherwise surface as silent cross-tenant behavior, which is exactly the bug
class tenancy exists to prevent, so it is worth a failed boot. `[Rubric §11, Security]` is the category
there.

## The two routing attributes

Two attributes, both in `MMCA.Common.Infrastructure`, both `Inherited = true` so they ride down a
configuration class hierarchy, encode *where an entity is stored* declaratively: the per-entity half of
the database-per-service strategy
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
[`UseDataSourceAttribute`](#usedatasourceattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:12-17`) names the
**engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): SQL Server, Cosmos or SQLite)
and is carried by the provider-specific configuration base classes, so choosing a base class chooses
the engine with no change to the entity (see
[primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
[`UseDatabaseAttribute`](#usedatabaseattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:21-26`) names the
**logical database** *on* that engine; its documented resolution order (`UseDatabaseAttribute.cs:9-14`)
is the attribute value, then the module name derived from the entity's namespace (the segment before
`Domain`), then `"Default"`. The persistence runtime
([`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry),
[`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver),
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)) reads these attributes up front
to map each entity to a physical source; those types are documented in the persistence chapter, but the
*markers* that feed them live here because they are part of how a module declares its composition.

## Shared user use-case bases: composition in the other direction

The chapter's last family is composition at the *handler* level rather than the container level. ADC
and Store each own an Identity module, and seven of their account use cases had drifted into
line-identical copies (or would have), so the workflow was hoisted into abstract bases that each app
subclasses:
[`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:25`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
[`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:58`),
the erasure workflow behind
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html),
[`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49`),
the data-subject access workflow, and the password-recovery pair
[`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:36`)
and [`ResetPasswordHandlerBase<TUser, TCommand>`](#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:31`),
which run the token issue-and-redeem flow described in
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) and collapse every
rejection to one `Auth.InvalidResetToken` error so the endpoint reveals nothing about which addresses
hold accounts (`ResetPasswordHandlerBase.cs:20-24`).

Each base is generic in the app's `User` aggregate and in the app's own command or query record, and
reads that record only through the small contracts in this group:
[`IUserScopedRequest`](#iuserscopedrequest) (`UserId`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8`),
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) (adds the embedded payload,
`IUserScopedCommand.cs:13`), and [`IUserOwnedRequest`](#iuserownedrequest) (adds `CurrentUserId` and
`CurrentUserRole`, `IUserOwnedRequest.cs:8`). The commands stay app-side precisely because the two apps
disagree on their pipeline attributes: ADC marks the password-change command `ICacheInvalidating` and
Store does not (`ChangePasswordHandlerBase.cs:17-22`). Note that
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) is deliberately *not*
`ICommandWithRequest<TRequest>`: implementing the latter also opts a command into automatic
`CommandRequestValidator` registration, which is a per-app decision, so implementing this one alone
changes no pipeline behavior (`IUserScopedCommand.cs:6-11`).

The export base is the most instructive of the seven, because it is where the container-level and
handler-level composition meet. It authorizes through
[`UserOwnershipRule.CheckOwnership`](#userownershiprule)
(`ExportUserDataHandlerBase.cs:81-86`), reads the account through `GetReadRepository`
(`ExportUserDataHandlerBase.cs:92-93`), asks the subclass for the app-specific subject snapshot
(`:100`), and then fans out **sequentially** over every injected
[`IUserDataExportSection`](#iuserdataexportsection) (`:103-108`), sequential on purpose because the
sections share one scoped `DbContext` and because registration order is the published order of the
document. A section that throws degrades to an envelope reporting `Available = false` rather than
failing the export, which is the contract
[`UserDataExportSectionResult`](#userdataexportsectionresult) encodes with its `Complete` /
`Unavailable` factories
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:73`,
`:91`), with the caller-safe default text in
[`UserDataExportSectionDefaults`](#userdataexportsectiondefaults) (`IUserDataExportSection.cs:105-113`).
The result is a [`UserDataExportDTO`](group-08-auth.md#userdataexportdto) that is PII by design and is
therefore never logged or cached (`ExportUserDataHandlerBase.cs:42-45`).

Around those bases sit the small shared pieces: [`UserOwnershipRule`](#userownershiprule)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21`), the
owner-or-privileged-role decision returning a `Forbidden`
[`Error`](group-01-result-error-handling.md#error) or `null` (`UserOwnershipRule.cs:38`) with the
privileged-role test passed in already evaluated because each app owns its own role vocabulary
(`UserOwnershipRule.cs:15-19`); [`UserUseCaseLog`](#userusecaselog)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:11`), a non-generic
`[LoggerMessage]` holder so every subclass emits identical text while the log category still comes from
the subclass's own `ILogger<T>` (`UserUseCaseLog.cs:13-41`);
[`SoftDeletedUserValidator<TUser>`](#softdeleteduservalidatortuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:20`), which answers
[`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) with one
query-filter-bypassing existence check (`SoftDeletedUserValidator.cs:31-34`); and
[`GetUserPreferencesQuery`](#getuserpreferencesquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`),
the one request record that *was* byte-identical in both apps and so became shared. `[Rubric §34,
Architecture Governance & Documentation]` and `[Rubric §1, SOLID]` are the categories here: the variation points are explicit
generic parameters and `protected virtual` hooks, so an app extends behavior without forking the
workflow.

## End-to-end: one host's boot

Reading `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs` top to bottom shows the whole
chapter cooperating. The host calls `AddInfrastructure(builder.Configuration)` (`Program.cs:289`), opts
into the scheduler and the audit trail (`Program.cs:293`, `:296`), then calls `AddModuleHost` with the
single assembly that declares `ConferenceModule` and a Serilog-backed
[`ModuleLoader`](#moduleloader) logger (`Program.cs:308-311`), and passes the resulting
[`ModulesSettings`](#modulessettings) to `AddAPI` (`Program.cs:313`). The whole handler-contributing
sequence then goes inside one `AddMmcaApplicationPipeline` call (`Program.cs:348-353`): step one is
`moduleHost.RegisterModules` (module discovery), step two replaces the disabled Engagement stub with a
real gRPC client (`AddEngagementBookmarkCountClient()`), and step three is `AddBrokerMessaging` with
its integration-event consumers, so [`MessageBusSettings`](#messagebussettings) `Provider` decides
whether [`IMessageBus`](group-04-events-outbox.md#imessagebus) stays in-process or becomes the
MassTransit-backed broker. Because this is the *Conference* service, only the Conference module is
`Enabled` in its configuration; every other discovered module takes the `RegisterDisabledStubs` path.
The pipeline call closes with `AddApplicationDecorators()` and seals the collection, so the decorators
wrap the now-registered Conference handlers and any later handler registration throws rather than
running bare. Afterwards the host adds module health checks from the loader (`Program.cs:365`) and
finally `app.Services.InitializeDatabaseAsync(moduleHost.ApplicationSettings, moduleHost.ModuleLoader)`
(`Program.cs:374`) applies migrations and runs the module seeders the loader collected. The exact same
module assemblies, dropped into a monolith host with every module `Enabled`, would Kahn-sort into one
in-process graph with no gRPC clients, which is precisely the reversibility
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is after.

### ApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:8` · Level 0 · class (sealed)

- **What it is**: the framework's global settings object, bound from the `"ApplicationSettings"` configuration section, with four knobs: `UseMiniProfiler` (MiniProfiler tracing), `MaxPageSize` (the ceiling the API applies to a paged list query), `MaxExportRows` (the ceiling on a single CSV export) and `DatabaseInitStrategy` (`"Migrate"` or `"None"`).

- **Depends on**: nothing first-party. `System.ComponentModel.DataAnnotations` for one `[Range]` attribute (`ApplicationSettings.cs:1`, `:32`), and the options binder at the composition root. That purity is why it sits at Level 0 despite being reachable from nearly every layer.

- **Concept introduced, options-pattern settings classes.** `[Rubric §17, DevOps & Deployment]` assesses whether configuration is centralised and typed rather than read as magic-string keys scattered through the codebase. Every settings class in the framework follows the same three-part shape, and this is the simplest exemplar of it: a `public static readonly string SectionName` naming the configuration section (`ApplicationSettings.cs:11`) so no registration site spells the section out, `init`-only properties so the object is immutable once the binder has filled it, and defaults declared inline beside the property. Consumers take `IOptions<ApplicationSettings>` from the container or receive the bound instance by value; nothing injects `IConfiguration` to read these values. `[Rubric §8, Data Architecture]` shows up in the last knob: `"Migrate"` applies pending EF Core migrations, and `"None"` is the production setting that validates and **fails startup** when the schema is behind rather than silently migrating it (`:35-42`). `[Rubric §12, Performance and Scalability]` is why the two ceiling knobs exist at all: both stop one caller from turning a single request into a full-table scan.

- **Walkthrough**: `SectionName = "ApplicationSettings"` (`:11`). `UseMiniProfiler` takes the implicit `false` default (`:14`). `MaxPageSize = 500` (`:17`). `MaxExportRows = 100_000` (`:33`) is the one property carrying a validation attribute, `[Range(1, 10_000_000)]` (`:32`), and its remarks explain both the number and the attribute's limits (`:24-31`): 100,000 rows is roughly a 10 to 25 MB file for a typical grid DTO, large enough that no real operational export hits the cap and small enough that one caller cannot pin a request thread to a full-table scan; the `[Range]` is honored only by hosts that opt into `ValidateDataAnnotations` on the options binding, so the export endpoint independently falls back to its own default when a host configures a non-positive value. The two ceilings compose rather than duplicate: the export endpoint page-loops the query service at `MaxPageSize` per page, so `MaxExportRows` bounds the whole file and not one page (`:19-23`). `DatabaseInitStrategy = "Migrate"` (`:43`).

- **Why it's built this way**: `static SectionName` keeps registration DRY, and `init` immutability makes one bound instance safe to share across the process as a singleton `IOptions<T>` value and safe to hand to every module by value. Validating a bound value with an attribute rather than a hand-written guard keeps the ceiling declarative, while the endpoint-side fallback means a host that never opts into validation still cannot produce an unbounded export.

- **Where it's used**: bound and validated by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which calls `AddOptions<ApplicationSettings>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` and then reads the section a second time to get a plain instance, throwing when the section is absent (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-67`). That instance is carried on [`ModuleHostContext.ApplicationSettings`](group-12-api-hosting-mapping.md#modulehostcontext) (`ModuleHostContext.cs:44`) and passed **by value** into every [`IModule.Register(services, configuration, applicationSettings)`](#imodule) call, so a module reads global settings without resolving anything. Each knob then has a distinct consumer: `MaxPageSize` is resolved per request by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) through `IOptions<ApplicationSettings>` with a `500` fallback when nothing is registered (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:58-64`); `MaxExportRows` the same way, with `DefaultMaxExportRows = 100_000` (`EntityControllerBase.cs:526`) used both when no settings exist and when a host configures a non-positive value (`:78-85`, `:266`, [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)); `UseMiniProfiler` gates [`MiniProfilerExtensions`](group-12-api-hosting-mapping.md#miniprofilerextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:18`) and the profiling repository wrappers in [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:34`, `:58`); `DatabaseInitStrategy` drives the startup switch in [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:92-102`), where any third value throws an exception naming the two valid ones (`:195`).

---

### AssemblyReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the assembly that contains it plus that assembly's simple name, for use as a stable anchor when something needs to say *"scan the assembly this type lives in."* This section covers the **Application-layer** copy; the framework ships a near-identical copy in every layer package, and the copies that belong to other groups get their own sections there.

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, and that purity is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems are solved with recognised patterns; the marker (or anchor) type is the idiomatic way to hand an `Assembly` to a scanner without coupling to an incidental concrete class. `[Rubric §1, SOLID]` (DIP): registration code depends on a deliberate, meaningless token rather than on `typeof(SomeRandomHandler).Assembly`, so renaming or moving any real type never breaks the scan. Repeating the identical `AssemblyReference` plus [`ClassReference`](#classreference) pair in every package keeps each assembly self-describing with no cross-layer reference at all.

- **Walkthrough**: two `public static readonly` fields resolved once at type initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:7`); `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` null-coalescing fallback (`AssemblyReference.cs:8`), so the field is never null even if the runtime reports no simple name. The Application copy carries no XML doc; the Domain copy is byte-identical in body but documents the type as existing "for Scrutor assembly-scanning registration and architecture tests" (`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:5-7`, fields at `:10-11`).

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and one per package means an assembly can be named without referencing anything inside it. The per-module Application assemblies follow the same convention (see the module copies in [group-22](group-22-engagement-module.md#assemblyreference) and [group-24](group-24-identity-module.md#assemblyreference)).

- **Where it's used**: as the assembly source for Scrutor scans and FluentValidation discovery, usually through its non-static companion (next section) because those helpers are generic.

- **Caveats / not-in-source**: the architecture-fitness map does **not** route through `AssemblyReference` for this layer. `CommonArchitectureMap` pins one anchor type per package, and for six of the seven mapped layers that anchor is a real type (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`); only the UI layer uses a dedicated marker, `UISharedAssemblyReference` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:21-27`).

---

### AuditTrailEntryDTO
> MMCA.Common.Application · `MMCA.Common.Application.Auditing` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auditing/AuditTrailEntryDTO.cs:12` · Level 0 · record (sealed)

- **What it is**: the read-side projection of one recorded change in an entity's history: which entity, which property, the before and after values, the operation, who changed it, when, and under what correlation id. It is what [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader) hands back, and it is deliberately smaller than the infrastructure row it projects.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (`global using UserIdentifierType = int;`, `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`, the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)) and BCL types (`Guid`, `DateTime`, `string`). Nothing else first-party: the persisted counterpart [`AuditTrailEntry`](group-07-persistence-ef-core.md#audittrailentry) lives in Infrastructure and is never referenced from here, which is why the DTO sits at Level 0.

- **Concept introduced, the read-model DTO that deliberately narrows its source row.** `[Rubric §9, API and Contract Design]` assesses whether the shape a consumer sees is designed rather than leaked: the class-level remarks state the intent outright, "deliberately minimal in v1: it carries what a 'who changed what, and when' view needs and nothing an infrastructure table happens to also store" (`AuditTrailEntryDTO.cs:6-11`). `[Rubric §3, Clean Architecture]`: declaring the DTO in the **Application** layer is what lets the reader contract live above Infrastructure while the EF entity stays below it, so no consumer of the trail takes a persistence dependency. `[Rubric §30, Compliance, Privacy and Data Governance]` is the sharpest edge here: values are the invariant string forms captured at save time, and a value that belonged to a property carrying [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) reads as the redaction placeholder on **both** sides (`AuditTrailEntryDTO.cs:9-11`), because the interceptor that writes the row substitutes [`PiiRedactor`](group-02-domain-building-blocks.md#piiredactor)`.RedactedToken` for `OldValue` and `NewValue` before persisting (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:309-310`). Personal data never reaches the table, so it cannot leak through this DTO either.

- **Walkthrough**: ten `init` properties on a `sealed record`, so the type gets structural equality and immutability from the compiler. Five are `required`, and that is the contract: `Id` (`:15`), `EntityType`, the full CLR type name of the changed entity (`:18`), `EntityKey`, the invariant string form of its primary key (`:21`), `Operation`, one of `Added` / `Modified` / `Deleted` (`:36`), and `ChangedOn`, the UTC instant (`:45`). The nullable ones each encode a real case: `PropertyName` is null on the summary row of a create or delete (`:23-27`), `OldValue` and `NewValue` are null when there is no value on that side (`:30`, `:33`), `ChangedBy` is null when the save carried no identity such as a background service or a seeder (`:38-42`), and `CorrelationId` is null when the change was recorded outside a traced request (`:47-48`).

- **Why it's built this way**: [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) is the decision record for the trail feature. A `record` rather than a class means a test can compare two projections by value, and the `required` markers make the five facts that every row must carry a compile-time obligation rather than a runtime null check.

- **Where it's used**: the return element of `IAuditTrailReader.GetForEntityAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IAuditTrailReader.cs:37`), and materialized by the single implementation [`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader), which projects it directly inside the EF `Select` so only these ten columns leave the database (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:66-78`).

- **Caveats / not-in-source**: no shipped endpoint or page returns this DTO. The reader's own remarks say so explicitly, "the framework ships the read, not the exposure ... because who may see an entity's history is an application decision" (`IAuditTrailReader.cs:11-14`), so today the only non-test consumer is the reader implementation itself.

---

### ClassReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference): an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern introduced under [`AssemblyReference`](#assemblyreference). C# **static classes cannot be used as generic type arguments**, and the registration helpers that take a marker are constrained to an instantiable reference type: `ScanModuleApplicationServices<TAssemblyMarker>()` declares `where TAssemblyMarker : class` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:163-164`) and so does [`MmcaApplicationPipelineBuilder.ScanModule<TAssemblyMarker>()`](#mmcaapplicationpipelinebuilder) (`MmcaApplicationPipelineBuilder.cs:27-28`). `ClassReference` fills that slot without weakening `AssemblyReference`'s static-ness. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token (`ScanModuleApplicationServices<ClassReference>()`) is the entire registration ceremony a new module needs.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11`). No members. Its only meaningful property is the assembly it belongs to, read by the scanner through `typeof(TAssemblyMarker).Assembly` (`DependencyInjection.cs:165`) before it hands that `Assembly` to the assembly-typed overload. The Domain copy documents the same role, "anchor type used for assembly resolution when `AssemblyReference` cannot be used (e.g., generic type constraints that require a non-static class)" (`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:14-18`).

- **Why it's built this way**: keeping a separate non-static anchor sidesteps the static-class generic-argument restriction while leaving `AssemblyReference` static (and therefore impossible to instantiate accidentally). Every module's Application assembly defines its own `ClassReference`, so each module scans itself by passing its local copy.

- **Where it's used**: as the `TAssemblyMarker` argument in [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection). All three ADC module composition roots call `services.ScanModuleApplicationServices<ClassReference>()` with their own local copy (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:47`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:133`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:88`), as do Store's three (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/DependencyInjection.cs:53`, `.../Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:51`, `.../Sales/MMCA.Store.Sales.Application/DependencyInjection.cs:65`) and Helpdesk's single module (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:34`). The framework root [`AddApplication()`](#dependencyinjection) passes the Application-layer copy to `AddValidatorsFromAssemblyContaining<ClassReference>()` (`DependencyInjection.cs:49`).

---

### DecoratorPipelineSeal
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:701` · Level 0 · class (private, sealed)

- **What it is**: a private, empty marker class that [`DependencyInjection`](#dependencyinjection) registers into the service collection as a singleton **instance** the moment `AddApplicationDecorators()` finishes. Its presence in the descriptor list is the record that the CQRS decorator pipeline has been closed on that collection. It is never resolved and never depended on: its only job is to be there.

- **Depends on**: nothing. It has no members and no base type beyond `object`.

- **Concept introduced, an ordering invariant enforced by a marker registration.** The framework's one hard composition rule is that `AddApplicationDecorators()` must run **after** every handler registration, because Scrutor's `TryDecorate` can only wrap registrations that already exist (see [`DependencyInjection`](#dependencyinjection) for the full pipeline). A handler registered afterwards resolves completely unwrapped: no feature gate, no authorization, no validation, no timeout, no transaction, and nothing fails at startup to say so. `[Rubric §15, Best Practices & Code Quality]` assesses whether a rule that has to be obeyed is *enforceable* rather than merely documented: instead of leaving the ordering as a comment, the framework leaves a token in the container and has every handler-contributing entry point check for it first. `[Rubric §15, Best Practices and Code Quality]`: making the marker `private` means no consumer can register, resolve, or fake it, so the signal cannot be forged from outside. `[Rubric §14, Testability]`: the same marker is what `VerifyDecoratorPipeline()` reads to tell "no handler is wrapped" apart from "some handler is not wrapped", which are two different failures with two different messages.

- **Walkthrough**
  - **Declaration**: `private sealed class DecoratorPipelineSeal;` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:701`), sitting outside the `extension(IServiceCollection)` block beside the three private helpers that use it, with its role written into the XML doc (`:694-698`).
  - **`SealPipeline`** (`:712-713`): a one-line `services.TryAddSingleton(new DecoratorPipelineSeal())`. Registering an **instance** rather than a type means nothing is ever constructed lazily, and `TryAdd` means a second call is a no-op at the descriptor level. It is called at the very end of `AddApplicationDecorators()`, after all thirteen `TryDecorate` calls (`:145`).
  - **`IsPipelineSealed`** (`:701-710`): a linear scan of the collection comparing `descriptor.ServiceType` to `typeof(DecoratorPipelineSeal)`. No provider is built, so the check is safe to run mid-composition and costs one pass over the descriptor list.
  - **`ThrowIfPipelineSealed`** (`:715-725`): the guard itself. When the marker is present it throws an `InvalidOperationException` naming the offending call and spelling out both remedies, move the call ahead of `AddApplicationDecorators()` or compose the whole sequence with `AddMmcaApplicationPipeline(...)` (`:719-723`). Every entry point that can contribute a handler opens with it: `AddApplicationDecorators` itself (`:117`, which is what makes a second call throw), `ScanModuleApplicationServices` (`:182`), `AddEntityCrud` (`:335`), `AddEntityUpdateVerb` (`:397`), `AddEntityUpdate` (`:448`) and `AddMmcaApplicationPipeline` (`:614`).
  - **The two deliberate non-guards**: `AddCommandRequestValidator<TCommand, TRequest>()` (`:475`) and `AddApplicationProfiling()` (`:565`) do not check the marker. A validator is not a handler, and the profiling pair is an outer decoration that is *supposed* to be applied on top of the closed pipeline; `ApplicationPipelineCompositionTests` pins that second case as allowed behavior (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:139-144`).
  - **Read by `VerifyDecoratorPipeline()`** (`:649-656`): before inspecting any handler descriptor it asks `IsPipelineSealed`, and when the answer is no it throws the distinct "the pipeline was never closed" message rather than listing every handler as undecorated.

- **Why it's built this way**: a marker in the collection is the only piece of state that travels with an `IServiceCollection`, which is what the guard needs, because the ordering rule is a property of *that collection* and not of the process. Registering it as an instance keeps the check allocation-free at resolution time (nothing ever resolves it) and keeps it invisible to consumers, which is why it is `private` rather than `internal`.

- **Where it's used**: only inside `DependencyInjection.cs`, by the four helpers above. Its observable effects are the exception messages tested in `ApplicationPipelineCompositionTests` (`:114-131`, `:182-188`).

- **Caveats / not-in-source**: the seal records that the decorators ran, not that they ran *correctly*. A host that registers a handler after `AddApplicationDecorators()` through a path with no guard, for example a bare `services.AddScoped<ICommandHandler<...>, ...>()`, still slips through; catching that is exactly what `VerifyDecoratorPipeline()` exists for, and it has to be called explicitly by a fitness test.

---

### IModuleSeeder
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8` · Level 0 · interface

- **What it is**: the Application-layer contract for seeding a module's initial data at startup. `ModuleName` declares ownership and `SeedAsync` receives an `IServiceProvider` so the seeder can resolve whatever it needs. Implementations are auto-discovered by [`ModuleLoader`](#moduleloader) and run, in module-dependency order, after every module has registered.

- **Depends on**: BCL only (`Task`, `IServiceProvider`, `CancellationToken`).

- **Concept introduced, seeding at the right layer.** `[Rubric §3, Clean Architecture]` assesses whether each concern lives in the layer that owns it. An *Application* seeder populates data through service interfaces and never touches a `DbContext`; a seeder that genuinely needs direct EF access implements the Infrastructure-layer [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder) instead. The `IServiceProvider` parameter is deliberate: the loader holds the seeder for the lifetime of composition, so passing the provider (rather than a concrete scoped dependency) is what lets the caller control scoping. `[Rubric §7, Microservices Readiness]`: seeding is a **separate** contract from [`IModule`](#imodule), so a module that needs no reference data implements nothing extra, and an extracted service seeds only its own module.

- **Walkthrough**: `string ModuleName { get; }` (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:13`) must match the corresponding [`IModule.Name`](#imodule) so the loader can correlate a seeder to its module and keep it in topological position; `Task SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)` (`:18`) is the single work method, and the XML doc states it is called only for enabled modules (`:16`).

- **Where it's used**: discovered by [`ModuleLoader`](#moduleloader) into a case-insensitive dictionary keyed by `ModuleName` (`ModuleLoader.cs:91-94`) and kept only when the matching module is enabled (`ModuleLoader.cs:118-121`). The actual invocation happens at host startup: [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) calls `moduleLoader.SeedAllAsync(scope.ServiceProvider, cancellationToken)` after schema initialization and tenant-database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:111`). Seeding deliberately runs on the default scope only, not once per tenant, and the comment above the call gives the reason: no module declares which seeders apply per tenant, and running one twice against a shared database is worse than not running it per tenant at all (`:107-110`). The implementations are one per data-owning module: `ConferenceModuleSeeder` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13`) and `IdentityModuleSeeder` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:15`) in ADC; `CatalogModuleSeeder` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModuleSeeder.cs:11`), `SalesModuleSeeder` (`.../Sales/MMCA.Store.Sales.API/SalesModuleSeeder.cs:14`) and `IdentityModuleSeeder` (`.../Identity/MMCA.Store.Identity.API/IdentityModuleSeeder.cs:12`) in Store.

---

### MmcaApplicationPipelineBuilder
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/MmcaApplicationPipelineBuilder.cs:12` · Level 0 · class (sealed)

- **What it is**: the small builder handed to the callback of `AddMmcaApplicationPipeline(...)`. It collects every registration that has to happen *between* `AddApplication()` and `AddApplicationDecorators()`, which is to say everything that puts a command or query handler into the container: module assembly scans, a [`ModuleLoader`](#moduleloader) run, cross-service gRPC clients, broker messaging.

- **Depends on**: [`DependencyInjection`](#dependencyinjection) (it calls `ScanModuleApplicationServices` on the collection it holds). Externals: `Microsoft.Extensions.DependencyInjection.IServiceCollection` and `System.Reflection.Assembly`.

- **Concept introduced, a builder whose constructor is the guard.** `[Rubric §33, Developer Experience]` assesses how hard the framework makes it to do the right thing by default. The ordering rule this builder exists to protect is invisible at the call site: a handler registered after the decorators is silently unwrapped. Rather than documenting the order and hoping, the framework makes the *only* way to obtain a builder be inside the call that also runs the decorators afterwards. The constructor is `internal` (`MmcaApplicationPipelineBuilder.cs:14`), and the XML doc states the reason plainly: "not constructible on its own, because outside that call there is nothing keeping the decorators last" (`:9-10`). `[Rubric §2, Design Patterns]`: this is the Builder shape used for scoping rather than for object construction, the same idea as ASP.NET Core's own `IEndpointRouteBuilder` style callbacks. `[Rubric §15, Best Practices & Code Quality]`: a host's composition root now reads as one call whose body is a list of steps, so a reviewer can see at a glance whether a registration belongs inside the pipeline.

- **Walkthrough**: four members, all trivially thin.
  - `Services` (`:19`), the collection under construction, exposed for a step that needs it directly.
  - `ScanModule<TAssemblyMarker>()` (`:27-32`, constrained `where TAssemblyMarker : class` at `:28`), which forwards to `Services.ScanModuleApplicationServices<TAssemblyMarker>()` and returns `this` for chaining. The marker is typically the module's own [`ClassReference`](#classreference).
  - `ScanModules(params Assembly[] moduleAssemblies)` (`:41-51`), the assembly-typed form for hosts that resolve their module set at runtime rather than naming a marker type per module; it null-guards the array (`:43`) and loops the assembly overload of the scanner (`:45-48`).
  - `Register(Action<IServiceCollection> register)` (`:62-68`), the escape hatch for an arbitrary step, null-guarded at `:64`. The doc names exactly what belongs here: a `ModuleLoader.DiscoverAndRegister(...)` call, cross-service gRPC clients, broker messaging, per-host handler overrides (`:53-58`).

- **Why it's built this way**: the callback shape is what makes the ordering rule structural instead of advisory. `AddMmcaApplicationPipeline` runs `AddApplication()`, invokes the callback with a freshly constructed builder, and then returns `AddApplicationDecorators()` (`DependencyInjection.cs:614-623`), so the decorators are last by construction. Everything that is not a handler registration (infrastructure, API, telemetry, options, health checks) deliberately stays *outside* the call, because its order relative to the decorators does not matter (`DependencyInjection.cs:602-603`).

- **Where it's used**: constructed in exactly one place, `AddMmcaApplicationPipeline` (`DependencyInjection.cs:620`). Every ADC and Store service host composes through it: ADC Conference (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:348-353`), Identity (`.../MMCA.ADC.Identity.Service/Program.cs:288`), Engagement (`.../MMCA.ADC.Engagement.Service/Program.cs:278`), Notification (`.../MMCA.ADC.Notification.Service/Program.cs:215`), Store Catalog (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:233`), Sales (`.../MMCA.Store.Sales.Service/Program.cs:234`) and Identity (`.../MMCA.Store.Identity.Service/Program.cs:211`). The architecture fitness tests replay the same shape, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:50-51` and `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:34`.

- **Caveats / not-in-source**: the MMCA.Helpdesk host does not use the builder. It writes the three-call sequence by hand (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:66`, `:104`, `:120`) with the ordering rule stated as a comment above it (`:65`), which is still a supported composition, just the unguarded one.

---

### ModuleSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:6` · Level 0 · class (sealed)

- **What it is**: the per-module configuration entry bound from `Modules:{Name}` in `appsettings.json`. `Enabled` (default `true`) controls whether the module's service tree is registered; `RemoteDependencies` lists dependency module names that are satisfied by an *extracted remote service* rather than an in-process module.

- **Depends on**: BCL only (`List<string>` plus the options binder).

- **Concept introduced, the module-extraction boundary expressed as configuration.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the *why*: when Catalog is extracted, the host sets `"Catalog": { "Enabled": false }`, and any module that still depends on it adds `"RemoteDependencies": [ "Catalog" ]`. [`ModuleLoader`](#moduleloader) then treats that dependency as satisfied, lets the disabled module's `RegisterDisabledStubs` put the contract type into DI, and the host afterwards replaces the stub with a real gRPC client adapter. The XML doc walks exactly this Catalog/Sales example, including the sample JSON (`ModuleSettings.cs:11-36`). Extraction therefore becomes a configuration plus wiring change, not a code change.

- **Walkthrough**: `bool Enabled { get; init; } = true` (`ModuleSettings.cs:9`), `init`-only so it cannot be mutated after binding. `List<string> RemoteDependencies { get; set; } = []` (`:38`), and note this one is `set`, not `init`, because the `IConfiguration` binder needs a settable collection to populate; the resulting `CA2227` ("collection properties should be read only") analyzer error is suppressed with an inline `#pragma` plus an explanatory comment (`:37-39`), an acknowledged and documented trade-off rather than an oversight.

- **Why it's built this way**: a plain POCO bound by the options pattern keeps the configuration model decoupled from the module infrastructure, and the `Enabled` flag lets a deployment switch off a whole module without deleting code.

- **Where it's used**: as the value type of [`ModulesSettings`](#modulessettings) (the `"Modules"` dictionary), read for every discovered [`IModule`](#imodule) by [`ModuleLoader`](#moduleloader) during composition, and enumerated directly by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) when it filters out the controllers of disabled modules (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:36-39`).

---

### QueryCachePipelineSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:20` · Level 0 · class (sealed)

- **What it is**: the Application layer's narrow view of the `Cache` configuration section, carrying exactly one knob: how long a request that missed the cache waits for the per-key populate lock before giving up and running the handler uncached.

- **Depends on**: BCL only (`TimeSpan`, `Timeout.InfiniteTimeSpan`). Bound by Infrastructure, read by [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult).

- **Concept introduced, splitting one configuration section across two layers without a layer violation.** `[Rubric §3, Clean Architecture]` assesses whether the dependency rule survives contact with real configuration. The rest of the `Cache` section (TTL policy, key prefix) is bound in Infrastructure beside `CacheSettings`, but the caching **decorator** lives in the Application layer, and Application cannot reference Infrastructure. Rather than duplicating a settings class or pushing the decorator down a layer, the framework declares this one-property class *in* Application and lets Infrastructure bind it: both types read the same `Cache:PopulateLockTimeout` key, so they cannot drift (`QueryCachePipelineSettings.cs:3-14`, and the reciprocal note on `CacheSettings` at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:18`). `[Rubric §12, Performance & Scalability]`: the same `SectionName` plus `init` shape as every other settings class here ([`ApplicationSettings`](#applicationsettings) introduces it). `[Rubric §12, Performance and Scalability]`: the knob exists for cache-stampede control, and the default deliberately preserves the strongest form of it. `[Rubric §29, Resilience and Business Continuity]`: the remarks call the behavior fail-open outright, "the value bounds how long a request waits, never whether it succeeds" (`:16-18`), which is the same posture every other cache failure takes in this framework.

- **Walkthrough**: `SectionName = "Cache"` (`:23`), the same section Infrastructure's own cache settings bind to. `DefaultPopulateLockTimeout = Timeout.InfiniteTimeSpan` (`:29`), a `static readonly` so both the settings object and a hand-constructed decorator can reach the same fallback. `TimeSpan PopulateLockTimeout { get; init; } = DefaultPopulateLockTimeout` (`:42`). The remarks spell out the trade (`:35-41`): waiting indefinitely means exactly one request per key populates the entry and the rest are served from it, whereas a finite value bounds the wait so a pathologically slow populate cannot hold a queue behind it, at the cost of several requests running the same query at once. Zero or a negative value means no bound, exactly like the default.

- **Why it's built this way**: keeping the knob in Application is what lets `CachingQueryDecorator` take it as a constructor dependency at all, and making the fallback a `static readonly` on the settings type is what lets the decorator's optional `IOptions<>` parameter degrade cleanly to framework behavior in a unit test or in a host that never called `AddCaching`.

- **Where it's used**: bound by Infrastructure's `AddCaching` path, with validation when a configuration is supplied (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:251-255`) and as a bare `AddOptions<T>()` when it is not, so `IOptions<QueryCachePipelineSettings>` always resolves to the framework defaults rather than failing the host (`:245`, comment at `:222-227`). Read by [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), which takes it as an **optional** constructor parameter (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:48`), falls back to `DefaultPopulateLockTimeout` when it is absent (`:81-82`), and on a lock timeout logs, records a cache miss and runs the inner handler without caching the result (`:84-92`). Pinned by `CacheSettingsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/CacheSettingsTests.cs:93`, `:110-111`).

---

### IModule
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7` · Level 1 · interface

- **What it is**: the contract every pluggable module implements: a `Name`, an optional `Dependencies` list, a `RequiresDependencies` flag, a `Register` method that wires the module's services, and an optional `RegisterDisabledStubs` method for the cross-module stubs used when the module is switched off.

- **Depends on**: [`ApplicationSettings`](#applicationsettings) (Level 0, passed into `Register`); externally `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`) and `Microsoft.Extensions.Configuration` (`IConfigurationBuilder`).

- **Concept introduced, the module system as a single composition contract.** `[Rubric §5, Vertical Slice]` assesses whether features cluster into cohesive, self-contained boundaries: a module (Conference, Engagement, Identity, Notification, Catalog, Sales, Tickets) is the top-level cohesion unit, and it registers *all* of its own services (handlers, EF configurations, repositories, validators) through one `Register` call. `[Rubric §7, Microservices Readiness]` assesses independent deployability: modules declare dependencies by *name* (string), so [`ModuleLoader`](#moduleloader) can compute a safe startup order with no compile-time reference between modules. When a dependency is disabled and `RequiresDependencies` is left at its `false` default, the depended-on module registers stubs through `RegisterDisabledStubs` so cross-module interfaces stay resolvable, which is precisely what lets the Conference service boot with [`DisabledBookmarkCountService`](group-22-engagement-module.md#disabledbookmarkcountservice) standing in for Engagement's [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice).

- **Walkthrough**: five members, three of them with **default interface implementations**, so a minimal module supplies only `Name` and `Register`. `string Name { get; }` (`IModule.cs:12`, required); `IReadOnlyList<string> Dependencies => []` (`:17`, default empty); `bool RequiresDependencies => false` (`:23`, default tolerant); `void Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:28`, required); `void RegisterDisabledStubs(IServiceCollection services) { }` (`:34`, default no-op). Note that `Register` takes an `IConfigurationBuilder`, not a built `IConfiguration`, so a module can add its own configuration sources before its services bind them, which is exactly what the loader exploits to inject per-module JSON files.

- **Why it's built this way**: [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) is the decision record for this contract, and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the topology it enables ("each service is the monolith with one module enabled"). Making `IModule` the single composition boundary means extraction is a deployment concern rather than a rewrite, and default interface members keep the common case ceremony-free while leaving the extraction hooks available.

- **Where it's used**: implemented by every module's API project, for example [`ConferenceModule`](group-20-conference-api-grpc.md#conferencemodule) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:15`), [`EngagementModule`](group-22-engagement-module.md#engagementmodule) (`.../Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:14`), [`IdentityModule`](group-24-identity-module.md#identitymodule) (`.../Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13`), [`NotificationModule`](group-10-notifications.md#notificationmodule) (`.../Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15`), Store's `CatalogModule` / `SalesModule` / `IdentityModule`, and Helpdesk's single `TicketsModule` (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.API/TicketsModule.cs:13`). Discovered, sorted, and invoked by [`ModuleLoader`](#moduleloader); the name is additionally pinned as a fitness rule by `ModuleConformanceTestsBase`, because renaming it silently disables the module's configuration and drops it from other modules' dependency graphs (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ModuleConformanceTestsBase.cs:42`).

---

### ModulesSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7` · Level 1 · class (sealed)

- **What it is**: a `Dictionary<string, ModuleSettings>` subclass bound from the `"Modules"` configuration section, with two helper methods over the map: `IsModuleEnabled(moduleName)` and `IsDependencyRemote(consumerModule, dependencyModule)`.

- **Depends on**: [`ModuleSettings`](#modulesettings) (Level 0, the entry/value type).

- **Concept**: the same [options-pattern](#applicationsettings) shape, but realised by *subclassing the dictionary* so `appsettings.json` can express an arbitrary map of module name to settings without a hand-written model class per module. `[Rubric §7, Microservices Readiness]`: `IsDependencyRemote` is the extracted-service hook, and when a module's dependency is met by a remote service rather than an in-process module, it returns true and [`ModuleLoader`](#moduleloader) treats the dependency as satisfied.

- **Walkthrough**: `SectionName = "Modules"` (`ModulesSettings.cs:10`). `IsModuleEnabled` (`:18-19`) is `TryGetValue` followed by `settings.Enabled`, so a module *absent* from configuration is treated as **disabled**, not enabled, which the XML doc states explicitly (`:12-15`). `IsDependencyRemote` (`:30-32`) does `TryGetValue` for the consumer, then `settings.RemoteDependencies.Contains(dependencyModule, StringComparer.OrdinalIgnoreCase)`, case-insensitive so deployment configuration need not match casing exactly.

- **Why it's built this way**: subclassing `Dictionary<,>` rather than wrapping one keeps the binder's job trivial (the section is literally a map) while still giving the two questions the loader asks a named, testable home instead of leaving `TryGetValue` chains scattered through composition code.

- **Where it's used**: bound and validated alongside [`ApplicationSettings`](#applicationsettings) by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which falls back to an empty map when the section is absent (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:69-76`) and carries it on [`ModuleHostContext`](group-12-api-hosting-mapping.md#modulehostcontext) (`ModuleHostContext.cs:47`). Consumed by [`ModuleLoader`](#moduleloader) for both the enable check and the remote-dependency bypass (`ModuleLoader.cs:101`, `:132`, `:136`, `:213`), and by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) to keep MVC from mapping a disabled module's controllers (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28-29`, `:36-41`); it is also the optional first parameter of `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:44`).

---

### ModuleLoader
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15` · Level 2 · class (sealed, partial)

- **What it is**: the engine of the module system. It reflects over the assemblies the host names to find every [`IModule`](#imodule) and [`IModuleSeeder`](#imoduleseeder) implementation, sorts the modules into dependency order with **Kahn's topological sort**, registers each enabled module into the DI container while recording stub registrations for the disabled ones, and afterwards can verify against the built container that every remote-declared dependency was actually re-wired.

- **Depends on**: [`IModule`](#imodule) (Level 1), [`IModuleSeeder`](#imoduleseeder) (Level 0), [`ApplicationSettings`](#applicationsettings) (Level 0), [`ModulesSettings`](#modulessettings) (Level 1). Externals: `IServiceCollection` / `ServiceDescriptor` / `IConfigurationBuilder`, `Microsoft.Extensions.Logging` (source-generated `[LoggerMessage]` methods, `NullLogger<T>`), `System.Diagnostics.Stopwatch`, `System.Reflection`.

- **Concept introduced, Kahn's topological sort for DI registration ordering.** `[Rubric §2, Design Patterns]` assesses use of the right algorithm for the problem: ordering items so each appears after everything it depends on is textbook topological sort, and `TopologicalSort` (`ModuleLoader.cs:271`) implements the BFS-based Kahn variant. `[Rubric §7, Microservices Readiness]`: the loader is what makes partial enablement (one module per service host) work at all. `[Rubric §15, Best Practices & Code Quality]`: modules name their dependencies as strings and the loader resolves and sorts them at startup, so adding a module is purely additive, with no central registration list to edit. `[Rubric §13, Observability and Operability]`: seven `[LoggerMessage]` partial methods (`:323-342`) give allocation-free structured diagnostics of which modules loaded, in what order, with which satisfied or unsatisfied dependencies, and how long each `Register` took.

- **Walkthrough**
  - **State** (`ModuleLoader.cs:17-21`): three private lists, `_enabledModules`, `_seeders`, `_disabledModuleNames`, the first and third surfaced as the read-only `EnabledModules` (`:24`) and `DisabledModuleNames` (`:27`) properties. A fourth field, `_stubRegistrations` (`:20`), is a case-insensitive `Dictionary<string, List<ServiceDescriptor>>` recording exactly which descriptors each disabled module's stub registration added; `_modulesSettings` (`:21`) caches the settings for the post-build validation pass. `Logger` (`:33`) is an `init`-only `ILogger<ModuleLoader>` defaulting to `NullLogger<ModuleLoader>.Instance`, so the loader runs silently unless a host supplies one.
  - **`DiscoverAndRegister`** (`:58-64`) is the single entry point, and it takes the assemblies to scan as a **required** parameter. There is no ambient-scan overload, and the XML doc gives the reason: an AppDomain scan only sees assemblies already loaded, so a module assembly that is referenced but not yet touched by any code path would be silently absent from discovery (`:48-53`).
  - **Discovery** (`:71-94`): flattens `moduleAssemblies` through `GetTypes()` inside a `try/catch` (`:74-82`) that logs and skips assemblies which throw (for example `ReflectionTypeLoadException` from a missing transitive reference) rather than aborting the whole scan. It then instantiates every concrete, non-abstract, non-interface `IModule` via `Activator.CreateInstance` (`:86-89`) and every `IModuleSeeder` into an `OrdinalIgnoreCase` dictionary keyed by `ModuleName` (`:91-94`).
  - **Per-module loop** (`:99-122`): for a module disabled per [`ModulesSettings.IsModuleEnabled`](#modulessettings), it logs, snapshots `services.Count`, calls `module.RegisterDisabledStubs(services)`, stores the newly appended descriptors under the module's name (`:107-109`), records the name, and continues. An enabled module runs `ValidateModuleDependencies` then `RegisterEnabledModule`, and if a seeder with a matching name exists it is appended to `_seeders` (`:118-121`).
  - **`ValidateModuleDependencies`** (`:125`): computes the module's disabled dependencies (`:131-133`), subtracts those declared remote via [`ModulesSettings.IsDependencyRemote`](#modulessettings) (`:135-137`), and throws `InvalidOperationException` only if a genuinely unsatisfied dependency remains *and* `RequiresDependencies` is true; the message spells out the three remediations, enable the module, disable this one, or add the name to `Modules:{Name}:RemoteDependencies` (`:139-147`). Otherwise it logs a warning per unsatisfied-but-tolerated dependency (`:149-152`) and an information line per remote-satisfied one (`:154-157`).
  - **`RegisterEnabledModule`** (`:160`): before calling `module.Register`, it adds the conventional per-module JSON configuration files `modules.{name}.json` and, when an environment name was supplied, `modules.{name}.{environment}.json`, both optional and `reloadOnChange: true` (`:174-178`); the name is lower-cased with `ToLowerInvariant` under a documented `CA1308` suppression for the file-naming convention (`:171-173`). It times the `Register` call with a `Stopwatch` and logs the elapsed milliseconds (`:180-184`).
  - **`ValidateRemoteDependencies`** (`:201`): the post-build half of the extraction story. Given the built root provider, it creates a scope (`:208`) and, for every enabled module and every dependency that module declared remote, looks up the descriptors the disabled peer's stubs added and calls `ValidateRemoteDependencyStubs` (`:210-222`). That helper (`:225`) skips open generics, resolves each stub's `ServiceType`, and **throws** with a remediation message if it does not resolve at all (`:233-238`); if it resolves but is still the stub implementation type, it only logs a warning (`:240-244`), because a best-effort dependency may intentionally keep its stub. Configuration trust alone is not enough: a typo in a `RemoteDependencies` entry or a forgotten `AddTypedGrpcClient` would otherwise surface as a first-request failure or a silent no-op instead of at startup (`:187-200`).
  - **`SeedAllAsync`** (`:255`): awaits each collected seeder's `SeedAsync` in registration (that is, topological) order, with `ConfigureAwait(false)` (`:257-260`).
  - **`TopologicalSort`** (`:271`): builds `modulesByName`, `inDegree`, and a reverse-adjacency `dependents` map, all `OrdinalIgnoreCase` (`:273-279`); while building the graph it **ignores dependencies on modules that were not discovered** (`:286-287`), deferring those to registration-time validation. It seeds a `Queue<string>` with the zero-in-degree modules (`:295-296`) and drains it, decrementing each dependent's in-degree and enqueuing at zero (`:299-310`). If fewer modules were emitted than exist, the remainder form a cycle, and it throws `InvalidOperationException` naming them (`:313-318`).

- **Why it's built this way**: convention over configuration. Discovery plus sort means no manual ordering and no module-registration list to keep in sync, which is the decision recorded in [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) (a disabled module is represented by **stub registrations** rather than by absence, so a dependent always resolves something). Making the assembly list an explicit parameter rather than an ambient scan trades one line at the host for deterministic discovery.

- **Where it's used**: constructed by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which attaches a logger when the host supplies one and registers the loader as a singleton (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:78-82`), then hands it back on a [`ModuleHostContext`](group-12-api-hosting-mapping.md#modulehostcontext) whose `RegisterModules` step is the actual `DiscoverAndRegister` call (`ModuleHostContext.cs:66-77`). Every ADC and Store service registers that step inside its application pipeline, for example ADC Conference (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:309`, `:347-348`) and Store Catalog (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:122`, `:233`). Each of those hosts enables exactly one module in configuration; the MMCA.Helpdesk monolith instead constructs the loader itself with a console logger and calls `DiscoverAndRegister` directly, naming `typeof(TicketsModule).Assembly` as the one assembly to scan (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:97-113`). Seeding runs later, from [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`DatabaseInitializationExtensions.cs:111`).

- **Caveats / not-in-source**: `ValidateRemoteDependencies` has no production caller today. It is exercised only by `ModuleLoaderTests` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:138`, `:151`, `:166`); no `Program.cs` in this workspace calls it after `builder.Build()`, so a mis-declared `RemoteDependencies` entry still surfaces at first request rather than at startup unless a host opts in.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:27` · Level 11 · class (static, C# `extension(IServiceCollection)`)

- **What it is**: the composition-root extension class that assembles the framework's entire Application layer into the DI container. Its single `extension(IServiceCollection services)` block (`:27`) exposes twelve members: `AddApplication()`, `AddApplicationDecorators()`, `ScanModuleApplicationServices<TAssemblyMarker>()` and its `Assembly` overload, `AddEntityCrud<...>()`, `AddEntityUpdateVerb<...>()`, `AddEntityUpdate<...>()`, `AddCommandRequestValidator<TCommand, TRequest>()`, `AddUserDataExportSection<TSection>()`, `AddEventUpcaster<TSource, TTarget, TUpcaster>()`, `AddApplicationProfiling()`, `AddMmcaApplicationPipeline(configure)` and `VerifyDecoratorPipeline()`. Four private helpers below the block implement the pipeline seal (`:703-740`).

- **Depends on**: the core singletons `IDomainEventDispatcher` / [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher), [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) / [`EventUpcasterRegistry`](group-03-querying-specifications.md#eventupcasterregistry), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline); the marker [`ClassReference`](#classreference); the permission registry [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) / [`UnconfiguredPermissionRegistry`](group-08-auth.md#unconfiguredpermissionregistry); the open-generic handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the seven command decorators [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), [`TimeoutCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#timeoutcommanddecoratortcommand-tresult), [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult), [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult), [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult), [`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult), [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult); the six query decorators [`TimeoutQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#timeoutquerydecoratortquery-tresult), [`ValidatingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#validatingquerydecoratortquery-tresult), [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult), [`AuthorizationQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#authorizationquerydecoratortquery-tresult), [`FeatureGateQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult); the optional [`ProfilingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#profilingcommanddecoratortcommand-tresult) and [`ProfilingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#profilingquerydecoratortquery-tresult); the scanned contract families [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#ientityupdateappliertentity-tupdaterequest-tidentifiertype), [`IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>`](group-05-cqrs-pipeline.md#ientityupdatecommandappliertentity-tupdaterequest-tidentifiertype-in-tcommand); the generic write-side handlers [`CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>`](group-05-cqrs-pipeline.md#createentityhandlertcreaterequest-tentity-tidentifiertype-tentitydto), [`UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`](group-05-cqrs-pipeline.md#updateentityhandlertentity-tentitydto-tidentifiertype-tupdaterequest), [`UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`](group-05-cqrs-pipeline.md#updateentitycommandhandlertcommand-tentity-tentitydto-tidentifiertype-tupdaterequest) and [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype) over [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype); the request-validator bridge [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) over [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest); the upcaster contract [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster); the export contributor contract [`IUserDataExportSection`](#iuserdataexportsection); the builder [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder); and the private marker [`DecoratorPipelineSeal`](#decoratorpipelineseal). Externals: **FluentValidation** (`AddValidatorsFromAssemblyContaining`, `AddValidatorsFromAssembly`, `IValidator<>`), **Scrutor** (`Scan`, `TryDecorate`), `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAdd*`, `TryAddEnumerable`), `System.Reflection`.

- **Concept introduced, the CQRS decorator pipeline wiring order (Scrutor `TryDecorate`).** `[Rubric §6, CQRS and Event-Driven]` assesses whether cross-cutting handler concerns are applied uniformly; `[Rubric §2, Design Patterns]` covers the Decorator pattern itself (the individual decorators are taught in [group-05](group-05-cqrs-pipeline.md)). **Scrutor's `TryDecorate` applies decorators in reverse registration order**: the *last* registered call becomes the *outermost* wrapper. `AddApplicationDecorators` (`DependencyInjection.cs:117`) registers the seven command decorators in source order Transactional, Timeout, Validating, Caching, Logging, Authorization, FeatureGate (`:131-137`), which produces the execution nesting its own XML doc draws (`:64-74`):

  ```
  FeatureGateCommandDecorator            (outermost, short-circuits if the feature flag is off)
    -> AuthorizationCommandDecorator     (short-circuits with Forbidden if IRequiresPermission)
      -> LoggingCommandDecorator         (measures full pipeline duration of enabled features)
        -> CachingCommandDecorator       (invalidates cache only AFTER the transaction commits)
          -> ValidatingCommandDecorator  (short-circuits with Result.Failure before any budget)
            -> TimeoutCommandDecorator   (applies the command's own budget if IHasTimeout)
              -> TransactionalCommandDecorator (DB transaction if ITransactional)
                -> ConcreteHandler       (the actual business logic)
  ```

  Queries get a six-deep chain, FeatureGate, Authorization, Logging, Caching, Validating, Timeout, handler (`:140-145`, drawn at `:78-86`). The ordering is not arbitrary, and the doc's design rationale gives a reason per position (`:88-115`): feature gating is outermost so a disabled feature costs nothing *and* answers identically for every caller rather than leaking which permission guards it; authorization sits directly inside it and outside caching, so a denied request neither reads nor populates the cache; logging measures only enabled executions; validation sits outside the transaction on the command side so a malformed command never opens one, but *inside* caching on the query side, because a cached entry can only exist because that query already passed validation once; cache invalidation sits outside validation so cache is cleared only after a valid committed mutation; and the timeout budget sits inside validation and outside the transaction so it covers the database work that actually hangs and cancels the transaction rather than leaving it open, while on the query side it is innermost so a cache hit never starts a budget. `[Rubric §11, Security]` is why the two authorization decorators are registered unconditionally with a `TryAddSingleton<IPermissionRegistry, UnconfiguredPermissionRegistry>()` fallback (`:126`, comment at `:121-125`): the pipeline cannot activate without a registry at all, so a host with no permission model still resolves every handler while a host that declared its grants keeps its own registry. The order itself is the decision recorded in [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).

- **Concept introduced, the ordering rule as an enforced invariant.** This file is the one place where register-order versus execute-order inversion has to be held in mind, and it is also where the framework stops relying on a reader holding it. `AddApplicationDecorators()` ends by sealing the collection with [`DecoratorPipelineSeal`](#decoratorpipelineseal) (`:147`), every handler-contributing entry point opens with `ThrowIfPipelineSealed` (`:119`, `:184`, `:337`, `:399`, `:450`, `:616`), and `AddMmcaApplicationPipeline(configure)` (`:614-623`) packages the whole sequence so the decorators are last by construction. `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §14, Testability]`: `VerifyDecoratorPipeline()` (`:651`) is the fitness hook that proves the result, and it works on descriptor **shape** alone, never building a provider, so a test does not have to register a double for every decorator dependency (`:635-640`).

- **Concept introduced, `ScanModuleApplicationServices`, the convention scanner.** `[Rubric §5, Vertical Slice]` (one call wires a whole module's slice types) and `[Rubric §14, Testability]` (handler registration is reproducible in a test host with the same one call). The marker overload (`:163-165`) just resolves `typeof(TAssemblyMarker).Assembly` and forwards to the `Assembly` overload (`:181`), which runs **nine Scrutor passes** over that single assembly, each with a deliberate lifetime: domain event handlers (`IDomainEventHandler<>`, **singleton**, because they create their own scopes, `:186-191`), integration event handlers (`IIntegrationEventHandler<>`, **singleton**, `:193-198`), DTO mappers (`IEntityDTOMapper<,,>`, **scoped**, `AsSelfWithInterfaces`, `:200-204`), the opt-in DTO projectors (`IEntityDTOProjector<,,>`, **scoped**, `:206-213`, so an entity that has one gets server-side projection on its list reads and one that has none keeps materialize-then-map), request mappers (`IEntityRequestMapper<,,>`, **scoped**, `:215-219`), update appliers (`IEntityUpdateApplier<,,>`, **scoped**, `:221-229`), command-aware appliers (`IEntityUpdateCommandApplier<,,,>`, **scoped**, `:231-238`), command handlers (`ICommandHandler<,>`, **scoped**, `:240-244`) and query handlers (`IQueryHandler<,>`, **scoped**, `:246-250`), followed by `AddValidatorsFromAssembly` (`:252`). After the passes, a reflection loop (`:256-270`) finds every type in the assembly implementing `ICommandWithRequest<TRequest>`, constructs `CommandRequestValidator<TCommand, TRequest>` and `IValidator<TCommand>` with `MakeGenericType`, and `TryAddTransient`s the pair (`:266-269`), so a command that embeds its own request DTO gets a bridging validator for free. `TryAdd` is load-bearing here: an explicit `IValidator<TCommand>` picked up by the earlier `AddValidatorsFromAssembly` pass always wins, which the inline comment states (`:254-255`).

- **Concept introduced, generic write-side registration.** `[Rubric §15, Best Practices & Code Quality]`: `AddEntityCrud<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>()` (`:331`) replaces the three hand-written handler classes a straightforward CRUD aggregate would otherwise need, registering `CreateEntityHandler`, `UpdateEntityHandler` and `DeleteEntityHandler` closed over the aggregate's own types plus the update command's validator bridge (`:339-353`). Two details in its doc are the teaching points (`:291-324`). First, the registrations are **closed generics, not open**, because Scrutor's `TryDecorate` wraps concrete service types: an open `ICommandHandler<,>` registration would resolve completely undecorated and `VerifyDecoratorPipeline()` could not see it (`:301-309`). Second, everything is `TryAdd`, so an aggregate that outgrows one verb registers its own handler for that verb before this call and keeps the generic pair for the other two. `AddEntityUpdateVerb<..., TApplier>()` (`:393`) registers one verb of the update path discriminated by its applier type, and `AddEntityUpdate<TCommand, ...>()` (`:444`) does the same for a derived command that carries state beside the request. All three route their validator wiring through `AddCommandRequestValidator<TCommand, TRequest>()` (`:477-483`), the explicit form of what the scan's reflection bridge does for commands it can see. [ADR-099](https://ivanball.github.io/docs/adr/099-generic-write-side-entity-commands.html) is the decision record.

- **Concept introduced, the accumulating contributor registration.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether data-subject obligations are met by design: `AddUserDataExportSection<TSection>()` (`:510`) is how each module contributes the slice of a person's data it owns to one export document ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). The mechanism is two lines, `TryAddScoped<TSection>()` then `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`:513-514`), and both halves matter. `TryAddEnumerable` de-duplicates by *implementation type*, so registering the same section twice adds it once while two different sections both survive, which a plain `AddScoped` would not guarantee. **Scoped**, not singleton, so a section runs inside the request's unit of work and may take repositories or gRPC clients (`:499-502`). Registration order is the order the sections appear in the export document (`:492-498`). `AddEventUpcaster<TSource, TTarget, TUpcaster>()` (`:553-560`) uses the identical idiom one lifetime up: `TryAddEnumerable(ServiceDescriptor.Singleton<IEventUpcaster, TUpcaster>())`, singleton because upcasters are pure functions over an event instance, with `TSource` and `TTarget` named explicitly so the compiler checks the shape at the registration site ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html), rationale at `:527-551`).

- **Walkthrough**
  - `AddApplication()` (`:35`): four `TryAddSingleton` calls, `IDomainEventDispatcher` (`:37`), `IEventUpcasterRegistry` (`:43`, registered unconditionally because with no upcasters it is an empty registry whose operations are the identity, so both delivery paths can depend on it without a null check, `:39-42`), `INavigationMetadataProvider` (`:45`) and `IEntityQueryPipeline` (`:46`), then `AddValidatorsFromAssemblyContaining<ClassReference>()` (`:51`) to register the framework's own validators, which a module-level scan would never reach because it only scans the module's own assembly (`:48-50`).
  - `AddApplicationDecorators()` (`:117`): guard, permission-registry fallback, thirteen `TryDecorate` calls, seal.
  - `ScanModuleApplicationServices<TAssemblyMarker>()` (`:163`, constrained `where TAssemblyMarker : class` at `:164`) and `ScanModuleApplicationServices(Assembly)` (`:181`, null-guarded at `:183`): the nine-pass scanner plus the request-validator loop.
  - `AddEntityCrud` / `AddEntityUpdateVerb` / `AddEntityUpdate` / `AddCommandRequestValidator` (`:331`, `:393`, `:444`, `:477`): the generic write side.
  - `AddUserDataExportSection<TSection>()` (`:510`, constrained `where TSection : class, IUserDataExportSection` at `:511`) and `AddEventUpcaster<TSource, TTarget, TUpcaster>()` (`:553`): the two accumulating registrations. The export handler itself needs no registration here: apps subclass [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) in their own Application assembly and the scanner picks the subclass up as an `IQueryHandler` like any other (`:503-508`).
  - `AddApplicationProfiling()` (`:567`): optional, `TryDecorate`s `ProfilingCommandDecorator<,>` and `ProfilingQueryDecorator<,>` on top (`:569-570`), for use with `ApplicationSettings.UseMiniProfiler`. It deliberately carries no seal guard, so it can be applied after the pipeline is closed.
  - `AddMmcaApplicationPipeline(configure)` (`:614`): guard, `AddApplication()`, invoke the callback with a new [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder), return `AddApplicationDecorators()` (`:616-622`). The `configure` callback may be null for a host with no modules (`:580-587`).
  - `VerifyDecoratorPipeline()` (`:651`): checks the seal first (`:653-658`), then walks the collection keeping the **last** non-keyed closed-generic descriptor per `ICommandHandler<,>` / `IQueryHandler<,>` service type (`:660-676`, last-registration-wins is the container's own rule), and reports every surviving entry whose `ImplementationFactory` is null (`:678-692`). The doc explains why that test is sound: `TryDecorate` rewrites a decorated registration into a factory over its own keyed copy of the original, so an implementation type still sitting on the effective registration is proof nothing wrapped it, and the outermost decorator's own type cannot be read back at all because after decoration it exists only inside a closure (`:641-649`).

- **Why it's built this way**: `[Rubric §3, Clean Architecture]`: registration lives in a static `DependencyInjection.cs` at the composition root, so domain and Application types never reference the container. The pervasive `TryAdd*` and `TryDecorate` pattern lets a consuming app override any framework default simply by registering its own implementation first. The whole class body is a single `extension(IServiceCollection services)` block (`:27`), the C# extension-member syntax the framework uses for its public DI surface ([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html), and [primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the syntax itself).

- **Where it's used**: by every consuming host. ADC and Store services call `AddMmcaApplicationPipeline` with the module-discovery step, the cross-service gRPC clients and the broker wiring inside the callback (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:348-353`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:233`); MMCA.Helpdesk writes the sequence by hand, `AddApplication()` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:66`), module discovery (`:104`), `AddApplicationDecorators()` (`:120`). `ScanModuleApplicationServices<ClassReference>()` is called from each module's own composition root (see [`ClassReference`](#classreference) for the seven call sites). `AddUserDataExportSection<TSection>()` is called by ADC's Identity module for its two cross-module sections (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`) and by Store's `IdentityModule` for its one (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`). `VerifyDecoratorPipeline()` is called by the architecture fitness tests (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:66`, `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:160`).

- **Caveats / not-in-source**: several other classes named `DependencyInjection` exist across the framework and the apps (Infrastructure, API, Grpc, UI, Notifications, and one per module) with the same name but different namespaces and methods. This section covers only the **MMCA.Common.Application root** at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:27`; the others are documented in their own groups. `AddApplicationProfiling()` has no caller in any host in this workspace: its only callers are unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DependencyInjectionTests.cs:113`, `:123`).

### AssemblyReference
> MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8` · Level 0 · class (static)

- **What it is**: the Domain layer's assembly-marker anchor. A static class holding the assembly it lives in and that assembly's simple name, so anything that needs to say "the MMCA.Common.Domain assembly" can say it through a type that exists for no other reason. Its XML doc names the two intended consumers: Scrutor assembly-scanning registration and architecture tests (`AssemblyReference.cs:5-7`).

- **Depends on**: `System.Reflection.Assembly` (BCL, imported at `AssemblyReference.cs:1`). Nothing first-party, which is why it sits at Level 0. Note that Domain is the innermost layer above `MMCA.Common.Shared`, so this marker could not depend on anything else even if it wanted to.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems reach for a recognised, deliberate shape. When registration code or a fitness test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form: it is far more stable than pointing at a real business type that may later move to another project or be renamed. `[Rubric §1, SOLID]` (DIP): the scan depends on a stable, meaningless token rather than on a concrete domain type. The same two-type pair repeats verbatim in every layer package (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5`, `MMCA.Common/Source/Presentation/MMCA.Common.API/AssemblyReference.cs:8`), so each assembly is self-describing with no cross-layer reference; those sibling copies have their own sections in this chapter and in [Group 12](group-12-api-hosting-mapping.md).

- **Walkthrough**: two `public static readonly` fields, both resolved once at type initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:10`), a self-reference so the field can never point at the wrong assembly. `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:11`), so the field is non-null even in the pathological case where the runtime reports no simple name.

- **Why it's built this way**: `static readonly` rather than a property means the reflection call happens once per process, and the self-referencing `typeof` makes the anchor refactor-proof: moving the file inside the project changes nothing, and moving it out of the project is exactly the case you would want to notice.

- **Where it's used**: nothing inside MMCA.Common references the Domain copy today. The Application copy backs `AddValidatorsFromAssemblyContaining<ClassReference>()` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51`) and the Infrastructure copy backs the entity-configuration scan `FromAssemblyOf<ClassReference>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:126`); the Domain layer registers nothing by convention, so its marker stays available rather than exercised.

- **Caveats / not-in-source**: the XML doc names architecture tests as a consumer, but the per-repo architecture maps anchor the Domain layer with `typeof(MMCA.Common.Domain.Entities.BaseEntity<>).Assembly` instead (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:22`, and identically at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/HelpdeskArchitectureMap.cs:16`). Whether a downstream consumer outside this workspace scans through this anchor is Not determinable from source here.

---

### ClassReference
> MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:18` · Level 0 · class

- **What it is**: the non-static companion to the Domain layer's `AssemblyReference`, an empty instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class cannot satisfy the constraint.

- **Depends on**: nothing first-party, and nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught in the preceding section. C# static classes cannot be used as generic type arguments, so any helper constrained to an instantiable reference type (Scrutor's `FromAssemblyOf<T>()`, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`) is handed `ClassReference` instead. The XML doc says exactly that: an anchor for assembly resolution when `AssemblyReference` cannot be used, for example under generic type constraints requiring a non-static class (`AssemblyReference.cs:14-17`). `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token means "this assembly" in every package, so wiring a new scan never involves hunting for a suitable real type.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`AssemblyReference.cs:18`). No members, no constructor, no interface. Deliberately not `sealed` and not `static`, because both would defeat its purpose as a generic argument for helpers that may construct it.

- **Where it's used**: as with its static twin, the Domain copy has no call site inside MMCA.Common; the Application and Infrastructure copies are the ones the composition roots scan through (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:51`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:126`).

---

### IUserScopedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8` · Level 0 · interface

- **What it is**: a one-member shape interface saying "this command or query targets a single user account". It exposes exactly `UserIdentifierType UserId { get; }` and nothing else.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Nothing else, first-party or external; the file has no `using` directives at all (`IUserScopedRequest.cs:1`).

- **Concept introduced, shape interfaces instead of shared request records.** `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion together, and this is the smallest possible instance of both: the shared Users use-case bases need one fact about the incoming message (which account it addresses), so that fact, and only that fact, becomes the contract. The XML doc states the motivation directly (`IUserScopedRequest.cs:3-7`): each app keeps its own command or query record, with its own [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) choice and its own docs, and simply adds this interface. `[Rubric §15, Best Practices & Code Quality]`: hoisting the *behavior* into a base class while leaving the *record* app-side is what let ADC and Store share the handlers without either app losing a per-app pipeline decision.

- **Walkthrough**: a single interface with a single get-only property (`IUserScopedRequest.cs:11`). There is no base interface and no default member, so implementing it is free for a `record` that already has a `UserId` positional parameter.

- **Where it's used**: extended by [`IUserOwnedRequest`](#iuserownedrequest) and [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest), both Level 1 in this chapter. Implemented directly by the one shared query record in the framework, [`GetUserPreferencesQuery`](#getuserpreferencesquery) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`), which is the only implementer inside MMCA.Common.

---

### UserDataExportSectionDefaults
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:105` · Level 0 · class (static)

- **What it is**: a static holder for one string constant: the sentence a data subject reads when a section of their export could not be produced and the app supplied no reason of its own.

- **Depends on**: nothing. It is a single `const string`, which is why it is Level 0 even though the export pipeline around it is not.

- **Concept introduced, the caller-safe failure message.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether privacy obligations are met in the product rather than in a policy document: a data-subject access request has a legal deadline, so a partially unavailable package that says so plainly is a better answer than a failed request ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). `[Rubric §11, Security]` assesses what leaves the trust boundary: this text reaches an end user, so it is deliberately generic and carries no exception message, stack trace, peer address, or connection string; the detail goes to the log instead, through [`UserUseCaseLog.ExportSectionUnavailable`](#userusecaselog). `[Rubric §13, Observability and Operability]`: splitting the audience in two (generic sentence out, full exception in) is the pattern, not an oversight.

- **Walkthrough**: one member, `public const string UnavailableReason` (`IUserDataExportSection.cs:112-113`), whose value is "This section could not be retrieved. The data is unchanged; the export can be requested again later." The XML doc records the intent (`IUserDataExportSection.cs:107-111`): the subject learns the section is incomplete and retryable, and learns nothing about the internal failure. `const` rather than `static readonly` because the value is compile-time and callers use it in default-parameter position and in object initializers.

- **Why it's built this way**: two call sites need the identical wording, and having them share a constant is what keeps a degraded section indistinguishable whether the section itself reported unavailability or the handler caught an exception on its behalf.

- **Where it's used**: as the fallback in [`UserDataExportSectionResult.Unavailable`](#userdataexportsectionresult) when the caller passes no reason (`IUserDataExportSection.cs:99`), and directly in [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)'s catch block when a section throws (`ExportUserDataHandlerBase.cs:196`).

---

### UserUseCaseLog
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:11` · Level 0 · class (internal static partial)

- **What it is**: a non-generic holder for the nine compile-time-generated log messages emitted by the shared Users use-case bases: password changed, preferences changed, account erased, a failed soft-deleted revocation marker, a degraded data-export section, and the four that trace the forgot-password / reset-password pair.

- **Depends on**: `Microsoft.Extensions.Logging` (`ILogger`, `[LoggerMessage]`, imported at `UserUseCaseLog.cs:1`) and the `UserIdentifierType` alias. No first-party types.

- **Concept introduced, source-generated logging in a non-generic holder.** `[Rubric §13, Observability and Operability]` assesses whether diagnostics are structured, cheap, and consistent. `[LoggerMessage]` is a Roslyn source generator: it emits a strongly typed, allocation-free log call with a pre-compiled message template, so nothing is boxed or formatted when the level is disabled. The subtle part is *where* the methods live. Putting them on a generic base class would produce one generated logger per closed generic type; declaring them once in a plain static holder means every app subclass writes the identical message text, while the **log category** still comes from the `ILogger<THandler>` the subclass injects, so filtering by handler behaves exactly as it did before the shared bases existed (`UserUseCaseLog.cs:5-10`). `[Rubric §15, Best Practices & Code Quality]`: one place to change the wording of a security-relevant or privacy-relevant event.

- **Walkthrough**: nine `internal static partial void` declarations, each attributed with a level and a template. Every method takes the `ILogger` as its first parameter, which is what lets a generic base pass its own injected logger into a non-generic holder. Three of them take an `Exception`, and the generator finds it by type wherever it sits in the signature, so the failure detail is attached to the entry rather than interpolated into the message: `ExportSectionUnavailable` and `PasswordResetEmailFailed` take it in the conventional second position (after `ILogger`, before the template arguments), while `SoftDeletedMarkerFailed` takes it last, after the `userId` its template formats (`UserUseCaseLog.cs:22-23`). The class is `internal`, so none of this is public package surface.

  | Method | File:Line | Level | Notes |
  |--------|-----------|-------|-------|
  | `PasswordChanged` | `UserUseCaseLog.cs:13-14` | Information | "User {UserId} password changed" |
  | `PreferencesChanged` | `UserUseCaseLog.cs:16-17` | Information | "User {UserId} preferences changed" |
  | `UserErased` | `UserUseCaseLog.cs:19-20` | Information | "User {UserId} account deleted and personal data anonymized" |
  | `SoftDeletedMarkerFailed` | `UserUseCaseLog.cs:22-23` | **Warning** | Takes an `Exception` in last position; "the deleted user's existing access token stays usable until it expires" |
  | `ExportSectionUnavailable` | `UserUseCaseLog.cs:25-26` | **Warning** | Takes an `Exception`; "export continues with Available=false" |
  | `PasswordResetRequested` | `UserUseCaseLog.cs:28-29` | Information | Reset email sent |
  | `PasswordResetEmailFailed` | `UserUseCaseLog.cs:31-32` | **Warning** | Takes an `Exception`; "the issued token stays valid" |
  | `PasswordResetCompleted` | `UserUseCaseLog.cs:34-35` | Information | "Password reset completed for user {UserId}" |
  | `PasswordResetRejected` | `UserUseCaseLog.cs:39-40` | Information | Takes only a `string reason`, deliberately **no** user id and no address |

- **Why it's built this way**: the wording of `UserErased` records the erasure model rather than a hard delete, the framework default in [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (the row survives soft-deleted while personal fields are anonymized). `SoftDeletedMarkerFailed` sits next to it and covers the other half of a deletion, the token revocation of [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html): the erasure is already committed when the revocation marker is written, so a cache failure there is caught and logged rather than propagated (`DeleteUserHandlerBase.cs:146-149`), and the template spells out the exact residual exposure the operator is being told about, that the deleted user's already-issued access token keeps working until it expires. Naming the consequence in the message is the point: a bare "cache write failed" would not tell an on-call engineer that a security control silently degraded. `ExportSectionUnavailable` is at `Warning` and not `Error` on purpose: a degraded section is an expected, handled outcome of a best-effort fan-out, and the request itself still succeeds. `PasswordResetRejected` is the most instructive signature in the file: the comment above it states the rule (`UserUseCaseLog.cs:37-38`), that the reset endpoints answer identically whether or not the address exists, so the log must not become the account-enumeration oracle the HTTP responses refuse to be. That is `[Rubric §11, Security]` applied to telemetry rather than to a response body, and it is why the method carries a free-text `reason` and nothing identifying. `PasswordResetEmailFailed` at `Warning` records the same split: the token was issued and stays valid, so the send failure is operationally interesting but is not a failed request.

- **Where it's used**: [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) calls `PasswordChanged` after a successful save (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:67`); [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) calls `PreferencesChanged` (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:59`); [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) calls `SoftDeletedMarkerFailed` from the catch around the revocation marker (`.../DeleteUser/DeleteUserHandlerBase.cs:148`) and `UserErased` once the post-commit tail has run (`:156`); [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) calls `ExportSectionUnavailable` from its per-section catch (`.../ExportUserData/ExportUserDataHandlerBase.cs:190`); [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand) calls `PasswordResetRejected` three times, for a malformed address, an unknown address, and a throttled request (`.../ForgotPassword/ForgotPasswordHandlerBase.cs:61`, `:69`, `:76`), then `PasswordResetEmailFailed` (`:95`) or `PasswordResetRequested` (`:99`); [`ResetPasswordHandlerBase<TUser, TCommand>`](#resetpasswordhandlerbasetuser-tcommand) calls `PasswordResetRejected` for a rejected token and an unresolvable account (`.../ResetPassword/ResetPasswordHandlerBase.cs:67`, `:76`) and `PasswordResetCompleted` on success (`:92`).

---

### IUserOwnedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus the authenticated caller. It adds `CurrentUserId` and the caller's (nullable) role claim, which is exactly the input the shared owner-or-privileged-role check needs.

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface, `IUserOwnedRequest.cs:8`) and the `UserIdentifierType` alias.

- **Concept introduced, carrying the caller inside the message.** `[Rubric §11, Security]` assesses whether authorization decisions are made deliberately and consistently rather than ad hoc. In this codebase resource-ownership authorization exists on two levels: at the API level as an action filter plus a specification ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)), and at the handler level as this interface plus [`UserOwnershipRule`](#userownershiprule). The controller projects the caller's claims into the command or query, and the handler decides. Putting the caller *in the message* rather than injecting a current-user service into the handler keeps the handler a pure function of its input, which is what makes the shared bases unit-testable with no HTTP context (`[Rubric §14, Testability]`).

- **Walkthrough**: two added members. `UserIdentifierType CurrentUserId { get; }` (`IUserOwnedRequest.cs:11`) is the authenticated caller. `string? CurrentUserRole { get; }` (`IUserOwnedRequest.cs:14`) is the role claim, explicitly nullable because a token may carry no role at all. `UserId` is inherited, so an implementing record must expose both the target and the caller.

- **Why it's built this way**: the XML doc names the goal (`IUserOwnedRequest.cs:3-7`), a single uniformly applied owner-or-privileged-role check across the account-deletion and data-export use cases in both apps. The role itself is deliberately *not* interpreted here: each app owns its own role vocabulary, so the interface carries the raw claim string and the rule takes an already-evaluated boolean.

- **Where it's used**: the type constraint on all three consumers of the ownership rule: [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) (`.../DeleteUser/DeleteUserHandlerBase.cs:42`), [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`.../ExportUserData/ExportUserDataHandlerBase.cs:55`), and the API-layer [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:62`). It is also the parameter type of [`UserOwnershipRule.CheckOwnership`](#userownershiprule). Implemented app-side by each export query (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:12`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:13`) and by each delete command, both of which pair it with `ICacheInvalidating` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:14`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:17`).

---

### IUserScopedCommand<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:13` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus an embedded request payload. A command implementing it says "I target this user, and here is the DTO the caller sent".

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface). Nothing external.

- **Concept, covariant shape interfaces and the deliberate non-overlap with `ICommandWithRequest<TRequest>`.** The type parameter is declared `out TRequest` (`IUserScopedCommand.cs:13`), so `IUserScopedCommand<DerivedRequest>` is usable where `IUserScopedCommand<BaseRequest>` is expected. The more instructive part is the XML doc's warning (`IUserScopedCommand.cs:6-11`): this interface is **deliberately separate** from [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), even though both expose a `Request` property, because `ICommandWithRequest` *also* opts the command into automatic [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) registration (see `ScanModuleApplicationServices` in [`DependencyInjection`](#dependencyinjection), `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:254`). That is a per-app decision: ADC and Store agree on it for the password change and disagree on it for preferences. A command may implement both; implementing this one alone changes no pipeline behavior. `[Rubric §1, SOLID]`: two interfaces because there are two responsibilities, shape versus pipeline opt-in, even though they would collapse neatly into one.

- **Walkthrough**: one added member, `TRequest Request { get; }` (`IUserScopedCommand.cs:16`), on top of the inherited `UserId`.

- **Why it's built this way**: the split is what lets one shared handler base read any app's command uniformly while each app keeps its own validation and cache-invalidation posture. Store's change-password command implements both interfaces (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:13`) while its preferences command implements only this one (`.../ChangePreferences/ChangePreferencesCommand.cs:12`); ADC's equivalents add `ICacheInvalidating` on top (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:16`, `.../ChangePreferences/ChangePreferencesCommand.cs:15`).

- **Where it's used**: the constraint on [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) (`.../ChangePassword/ChangePasswordHandlerBase.cs:29`) and [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:27`), and the two constraints on [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:48-49`), where the base reads the app-supplied command back only through this interface and its own doc records that the preferences *query* has no equivalent marker (`UserAccountAuthControllerBase.cs:29`).

---

### UserDataExportSectionResult
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:47` · Level 1 · record (sealed)

- **What it is**: what one [`IUserDataExportSection`](#iuserdataexportsection) hands back: either its payload, or the fact that the payload could not be produced plus a caller-safe reason.

- **Depends on**: [`UserDataExportSectionDefaults`](#userdataexportsectiondefaults) (Level 0, for the fallback reason string). BCL only otherwise (`object`, `ArgumentException`). It is the application-layer twin of the wire DTO [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) that the handler copies it into.

- **Concept introduced, "unavailable" as a first-class value rather than an exception.** `[Rubric §29, Resilience, Reliability and Business Continuity]` assesses how a system behaves when a dependency is down. In a fan-out over N contributors, an exception is the wrong currency: it either aborts the whole package or gets swallowed. Modelling the negative outcome as a *value* (`Available = false` plus a reason) means the degraded case is visible in the document the data subject receives, and the caller cannot forget to handle it. `[Rubric §2, Design Patterns]`: the two named static factories are the only construction paths, so an instance is always in one of exactly two legal shapes, the same private-construction discipline value objects use elsewhere in this codebase.

- **Walkthrough**
  - Four `init` members: `required string SectionName` (`IUserDataExportSection.cs:50`), `required bool Available` (`:53`), `object? Data` (`:60`), and `string? UnavailableReason` (`:67`). The two `required` members are the ones a result is meaningless without; the two nullable ones are mutually exclusive in practice.
  - `Data` is typed `object?` on purpose (`:55-59`): every contributor publishes its own DTO shape and the export is serialized as one JSON document, so the payload type cannot be known here. Its doc marks it **PII by design**: never log it, never cache it.
  - `UnavailableReason` (`:62-66`) is documented as reaching the data subject, so it must never carry internal exception detail.
  - `Complete(sectionName, data)` (`:73-83`) guards with `ArgumentException.ThrowIfNullOrWhiteSpace(sectionName)` (`:75`) and returns `Available = true`. Note that a `null` payload is legal here: a section that provably holds nothing for this user returns a complete result with an empty body, which is a truthful answer rather than an unknown one (`IUserDataExportSection.cs:11-14`).
  - `Unavailable(sectionName, reason = null)` (`:91-101`) applies the same name guard (`:93`) and falls back to `UserDataExportSectionDefaults.UnavailableReason` when the caller supplies none (`:99`).

- **Why it's built this way**: a `sealed record` with `init` members gives structural equality and immutability for free, which matters because these instances flow straight into a document that must not be mutated after assembly ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)).

- **Where it's used**: the return type of `IUserDataExportSection.ExportAsync` (`IUserDataExportSection.cs:38`), consumed by [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)'s `RunSectionAsync`, which copies its four fields into a [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`ExportUserDataHandlerBase.cs:177-183`). Produced by every concrete section, for example Store's `SalesUserDataExportSection` returning `Complete` with an empty payload for an account with no linked customer (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:45`) and with the mapped payload otherwise (`:56`).

---

### IUserDataExportSection
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:20` · Level 2 · interface

- **What it is**: the contributor contract for a data-subject export. One implementation is one module (or one cross-service peer client) that holds personal data keyed by user and can hand it over on request.

- **Depends on**: [`UserDataExportSectionResult`](#userdataexportsectionresult) (Level 1, its return type) and the `UserIdentifierType` alias. Nothing external beyond `Task` and `CancellationToken`.

- **Concept introduced, the accumulating-registration extension point.** `[Rubric §5, Vertical Slice]` assesses whether a feature's pieces cluster inside the boundary that owns them: the export document is assembled centrally, but *what each module contributes* is written and registered by that module, so adding personal data to a module means adding one section, not editing a central projection. `[Rubric §7, Microservices Readiness]`: a section may be backed by an in-process repository read or by a gRPC client to an extracted peer, and the export handler cannot tell the difference. `[Rubric §30, Compliance, Privacy and Data Governance]`: this is the mechanism by which "all personal data we hold about you" stays complete as modules are added, which is the obligation [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) exists to discharge. `[Rubric §29, Resilience]`: sections are explicitly **best-effort**, and the contract says so in its own remarks (`IUserDataExportSection.cs:8-14`): a throwing section degrades to `Available = false` and the export still succeeds, because one unreachable peer must never deny a data subject the rest of their data.

- **Walkthrough**: two members.
  - `string SectionName { get; }` (`IUserDataExportSection.cs:27`), the stable name the section is published under in the document ("Engagement", "Sales"). The doc calls it part of the contract rather than a label to reword, because it appears verbatim in the package a data subject reads.
  - `Task<UserDataExportSectionResult> ExportAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`IUserDataExportSection.cs:38-40`). Its doc states the tolerance explicitly: throwing is permitted, and the handler degrades the section, but returning `UserDataExportSectionResult.Unavailable` is preferred where the reason is known (`:34-37`).
  - Registration is a separate one-liner: `AddUserDataExportSection<TSection>()` does `TryAddScoped<TSection>()` plus `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:510-516`). `TryAddEnumerable` is the load-bearing call: registrations **accumulate** across modules while the same type registered twice is added once, and registration order becomes document order (`DependencyInjection.cs:492-497`). The lifetime is **scoped**, so a section runs inside the request's unit of work and may take scoped dependencies (`DependencyInjection.cs:499-502`).

- **Why it's built this way**: the alternative, a central export handler that knows every module's data, would couple the Identity module to every other module and would break the moment one of them was extracted into its own service. Fan-out over an injected `IEnumerable<IUserDataExportSection>` keeps that knowledge inside each module and turns extraction into a change of what the section calls, not of who contributes.

- **Where it's used**: injected as `IEnumerable<IUserDataExportSection>` into [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`ExportUserDataHandlerBase.cs:51`). Implemented by [`EngagementUserDataExportSection`](group-24-identity-module.md#engagementuserdataexportsection) and [`NotificationUserDataExportSection`](group-24-identity-module.md#notificationuserdataexportsection), registered in that order (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`), and by Store's `SalesUserDataExportSection` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:22`), registered by its Identity module (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`). Two more implementations exist only as test doubles that pin the degradation contract, `ThrowingSection` and `CancellingSection` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:309` and `:320`).

- **Caveats / not-in-source**: whether a given section's peer is reachable in a given environment is a deployment fact, not a source fact. The source settles only that an unreachable peer degrades one section.

---

### UserOwnershipRule
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21` · Level 2 · class (static)

- **What it is**: a single static method encoding the self-service authorization rule shared by every use case that acts on one account on behalf of its owner: the caller must be the account owner, or hold the app's privileged role. It returns `null` when allowed and a ready-made [`Error`](group-01-result-error-handling.md#error) when not.

- **Depends on**: [`IUserOwnedRequest`](#iuserownedrequest) (Level 1, the parameter type), plus [`Error`](group-01-result-error-handling.md#error) and [`ErrorType`](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions` (imported at `UserOwnershipRule.cs:1`).

- **Concept introduced, the "return the error, do not throw" authorization helper.** `[Rubric §11, Security]` assesses whether authorization is uniform and auditable. The idiom being hoisted here (caller is not the owner and has no bypass role, therefore forbidden) had been written out four times across the two apps, in account deletion and data export in each, which the XML doc records as the motivation (`UserOwnershipRule.cs:9-14`). `[Rubric §2, Design Patterns]`: it is deliberately a **plain static helper**, not a base class or a decorator, because at the time of the hoist the two data-export handlers were expected to stay app-level and still needed the identical decision and the identical error shape. `[Rubric §1, SOLID]`: the role test arrives **already evaluated** as a `bool`, so the helper never learns either app's role vocabulary (`UserRole.IsOrganizer` in ADC versus `UserRole.IsAdmin` in Store), and both are case-insensitive on the app side because a role claim may carry any casing (`UserOwnershipRule.cs:15-19`). This is the Application-layer counterpart to the API-layer ownership axis of [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html); that ADR records the filter and specification forms and does not name this helper.

- **Walkthrough**: one method, `static Error? CheckOwnership(IUserOwnedRequest request, bool callerHasPrivilegedRole, string code, string message, string source)` (`UserOwnershipRule.cs:38-43`). It guards with `ArgumentNullException.ThrowIfNull(request)` (`:45`), then evaluates one conditional expression: if `request.CurrentUserId == request.UserId || callerHasPrivilegedRole`, return `null` (allowed); otherwise return `Error.Forbidden(...)` with the caller-supplied `code`, `message`, and `source`, and with `target` fixed to `nameof(IUserOwnedRequest.UserId)` (`:47-53`). Fixing the target while parameterising code, message, and source is what keeps the error payload identical to the four hand-written copies it replaced, since each of those reported its own handler name as the source.

- **Why it's built this way**: returning `Error?` rather than throwing keeps the caller on the framework's [Result pattern](group-01-result-error-handling.md#result) ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)): the handler wraps it as `Result.Failure(forbidden)` and the API layer maps it to 403 through the usual error mapping, with no exception unwinding on an expected authorization outcome.

- **Where it's used**: both shared account-scoped bases call it first thing in `HandleAsync`. [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) passes `HasDeletePrivilege(command.CurrentUserRole)` and the code `"User.DeleteForbidden"` with the message "You can only delete your own account." (`.../DeleteUser/DeleteUserHandlerBase.cs:62-67`); [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) passes `HasExportPrivilege(query.CurrentUserRole)` and the code `"User.ExportForbidden"` with the message "You can only export your own account data." (`.../ExportUserData/ExportUserDataHandlerBase.cs:81-86`). Both pass their own `HandlerName` as the source, so the error still names the concrete app handler.

---

### ExportUserDataHandlerBase<TUser, TQuery>
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49` · Level 8 · class (abstract, generic)

- **What it is**: the shared data-subject export workflow (GDPR/CCPA access and portability). It authorizes the caller, loads the account read-only, asks the subclass for the app's own snapshot of that account, fans out best-effort over every registered [`IUserDataExportSection`](#iuserdataexportsection), and assembles one JSON-ready package the data subject can be handed.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and, through it, [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype); [`IUserDataExportSection`](#iuserdataexportsection) (injected as an `IEnumerable`); [`IUserOwnedRequest`](#iuserownedrequest) (the `TQuery` constraint) and [`UserOwnershipRule`](#userownershiprule); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (the `TUser` constraint); [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (the contract it implements); [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); the Shared-layer DTOs [`UserDataExportDTO`](group-08-auth.md#userdataexportdto) and [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` and `:61`); and [`UserUseCaseLog`](#userusecaselog). Externals: `TimeProvider` and `ILogger` (both injected through the primary constructor, `ExportUserDataHandlerBase.cs:50-53`).

- **Concept introduced, the template-method handler that owns the workflow and delegates only what is genuinely app-specific.** `[Rubric §2, Design Patterns]` assesses deliberate pattern use: this is Template Method applied to a use case, with exactly three extension points (one abstract role check, one abstract projection, one virtual tail) and everything else fixed. `[Rubric §15, Best Practices & Code Quality]`: the two apps previously carried near-identical export handlers; hoisting the workflow left each subclass with the two decisions that actually differ. `[Rubric §30, Compliance, Privacy and Data Governance]`: the assembled document is **PII by design**, so its class doc states it must never be logged or cached, and notes that the caching query decorator is not applicable because the query implements no [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) (`ExportUserDataHandlerBase.cs:42-45`). `[Rubric §29, Resilience]`: the fan-out degrades per section rather than failing, since a data-subject request carries a legal deadline ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). `[Rubric §14, Testability]`: because authorization arrives inside the query and time arrives as `TimeProvider`, the whole workflow is exercised with mocks and no host (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:17`).

- **Walkthrough**
  - **Shape and constraints** (`ExportUserDataHandlerBase.cs:49-55`): a primary-constructor abstract class taking `IUnitOfWork`, `IEnumerable<IUserDataExportSection>`, `TimeProvider`, and `ILogger`, implementing `IQueryHandler<TQuery, Result<UserDataExportDTO>>`, with `TUser : AuditableAggregateRootEntity<UserIdentifierType>` and `TQuery : IUserOwnedRequest`.
  - **`CurrentFormatVersion = "1.0"`** (`:61`) is stamped into the envelope. Its doc is precise about scope (`:57-60`): it versions the *envelope only*, so an app changing its own subject or section payloads does not move it.
  - **`UnitOfWork`** is exposed `protected` (`:64`) purely so a subject-snapshot override can read further aggregates. **`HandlerName`** is `virtual` and defaults to `GetType().Name` (`:71`), so a subclass that kept the pre-hoist class name reports the identical error payload it did before.
  - **`HandleAsync`** (`:74-122`). It null-guards the query (`:78`), then runs the ownership gate through [`UserOwnershipRule.CheckOwnership`](#userownershiprule) with `HasExportPrivilege(query.CurrentUserRole)` and the code `"User.ExportForbidden"` (`:81-90`), failing fast on rejection.
  - **The read** (`:92-98`): `unitOfWork.GetReadRepository<TUser, UserIdentifierType>()` then `GetByIdAsync`. The class doc calls this out as a deliberate change from the two pre-hoist app copies, which used the read-write repository: this is a query handler, it never saves, and a no-tracking read is the correct choice for a projection (`:37-41`). A missing account returns `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)` (`:96-97`).
  - **The subject snapshot** (`:100`): one `await` on the abstract `BuildSubjectSnapshotAsync`.
  - **The fan-out** (`:102-108`): a plain `foreach` over the injected sections, awaited one at a time. The comment states both reasons (`:102-103`): sections share the scoped unit of work and its `DbContext`, which is not thread-safe, and registration order is the published order of the document. This is the one place where the obvious "parallelize the I/O" instinct is wrong.
  - **The envelope** (`:110-117`): `FormatVersion`, `GeneratedOn = timeProvider.GetUtcNow()`, `UserId`, the subject, and the section envelopes.
  - **The tail** (`:119`): `OnExportCompletedAsync`, then `Result.Success(export)` (`:121`).
  - **`RunSectionAsync`** (`:166-199`) is the degradation boundary. It calls the section, copies the four result fields into a [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`:177-183`), and catches with the filter `when (ex is not OperationCanceledException)` (`:185`), so **cancellation is not degradation** and propagates as cancellation. On any other exception it logs through [`UserUseCaseLog.ExportSectionUnavailable`](#userusecaselog) with the full exception (`:190`) and returns an envelope with `Available = false` and the generic [`UserDataExportSectionDefaults.UnavailableReason`](#userdataexportsectiondefaults) (`:192-197`): detail to the log, nothing internal to the subject.
  - **The three extension points**: `HasExportPrivilege(string?)` (abstract, `:130`), the role that bypasses ownership; `BuildSubjectSnapshotAsync(TUser, TQuery, CancellationToken)` (abstract, `:144-147`), which fields of the account are portable personal data, asynchronous and given the query because an app may need to read a second owned aggregate (`:22-25`); and `OnExportCompletedAsync(...)` (virtual, defaulting to `Task.CompletedTask`, `:159-164`), the app's tail for an access-log row or a metric, documented as not mutating the export and as owning its own failures because the export has already succeeded (`:149-153`).

- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) records the decision, and the shape deliberately mirrors [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand): the same ownership gate through the same helper, the same privileged-role hook. The credential fields are excluded from the snapshot by contract (`:132-136`): a password hash and salt, a refresh token, and an external-provider key are secrets, not portable personal data.

- **Where it's used**: subclassed in each app's Identity Application assembly, where the convention scanner picks the concrete subclass up as an ordinary `IQueryHandler` with no extra registration (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:246-250`, and the point is spelled out in the export-section registration doc at `:501-506`). ADC's `ExportUserDataHandler` closes it over `User` and `ExportUserDataQuery` and overrides only the two abstract members (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:30`, privilege = `UserRole.IsOrganizer` at `:38`, snapshot at `:41`); Store's does the same with its own `User` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:34`). Behaviour is pinned by `ExportUserDataHandlerBaseTests`, including a section that throws (`.../ExportUserDataHandlerBaseTests.cs:138`) and a section that cancels (`:217`).

- **Caveats / not-in-source**: the framework also ships an abstract `[FeatureGate]`-d endpoint, [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:58-59`), but neither app subclasses it: both kept their own export endpoints on top of this handler base, which the ADR records as an unadopted part of the decision.

---

### SoftDeletedUserValidator<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:20` · Level 8 · class (sealed, generic)

- **What it is**: the one shared implementation of [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator). It answers a single question, "does a row for this user exist **and** is it soft-deleted", in one query that deliberately bypasses the global soft-delete query filter.

- **Depends on**: [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (the interface it implements, from `MMCA.Common.Application.Interfaces.Infrastructure.Auth`, imported at `SoftDeletedUserValidator.cs:1`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (injected via primary constructor), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (obtained from the unit of work), and [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint (`SoftDeletedUserValidator.cs:3`, `:20`). Its Level 8 position is inherited from that repository and unit-of-work chain, not from any complexity of its own.

- **Concept introduced, closing a generic over the app's aggregate instead of subclassing.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access: stateless JWT means a token stays valid until it expires, so [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) (BR-133, named in the class doc at `SoftDeletedUserValidator.cs:8`) adds a middleware that rejects an authenticated caller whose account has since been soft-deleted, and this class is the lookup behind it. `[Rubric §8, Data Architecture]`: the check must see rows the rest of the application cannot, so it passes `ignoreQueryFilters: true` to punch through the soft-delete global filter for this one predicate. `[Rubric §15, Best Practices & Code Quality]`: because the type is generic over `TUser` rather than abstract, an app supplies only a type argument at registration and needs **no** per-app subclass (`SoftDeletedUserValidator.cs:12-18`).

- **Walkthrough**: a primary-constructor class taking `IUnitOfWork unitOfWork`, constrained `where TUser : AuditableAggregateRootEntity<UserIdentifierType>` (`SoftDeletedUserValidator.cs:20-21`). The single method `IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:23-25`) resolves the repository through `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:27`), then returns `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, cancellationToken: cancellationToken)` with `ConfigureAwait(false)` (`:30-33`). Note it is `GetRepository` off the unit of work rather than a constructor-injected `IRepository<,>`, which is the framework-wide rule for repository access, and the predicate is written against the open type parameter but closes over the concrete entity at run time, so EF translates it exactly as a hand-written app query would.

- **Why it's built this way**: one query answers both halves of the question (exists and is deleted), so the middleware pays a single round trip and cannot mistake "unknown user" for "deleted user" (`SoftDeletedUserValidator.cs:30`). Expressing the predicate against `TUser` keeps the framework free of any reference to an app's `User` aggregate while still producing a fully translated EF query.

- **Where it's used**: registered per app, closed over that app's `User` aggregate: `services.TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()` in `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:35` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:43`. The consumer is [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which resolves the interface **lazily** per request via `context.RequestServices.GetService<ISoftDeletedUserValidator>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75`, rationale in its own doc at `:43`), so a host that registers no validator degrades to a no-op instead of failing. Each app also pins the behaviour directly, across the deleted, live, unknown, and cancellation cases (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:15`, tests at `:26`, `:42`, `:58`, and `:74`).

### AssemblyReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class that exposes the assembly it lives in plus that assembly's simple name. It is the Infrastructure layer's assembly-marker anchor, a deliberate, business-free type whose only job is to name "this assembly" for convention-based scanning.

- **Depends on**: `System.Reflection.Assembly` (BCL) only (`AssemblyReference.cs:1`). No first-party dependencies, which is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems use recognised patterns; when a registration or test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form, far more stable than `typeof(SomeRandomHandler).Assembly` pointing at a real class that might move or be renamed. `[Rubric §1, SOLID]` (DIP): registration code depends on a stable, meaningless token rather than a concrete business type, so refactoring real Infrastructure types never breaks a scan. The same shape (`AssemblyReference` + [`ClassReference`](#classreference-2)) repeats in every layer package (Application, Domain, API, and here in Infrastructure) so each assembly is self-describing without any cross-layer reference.

- **Walkthrough**: two `public static readonly` fields resolved once at type initialization (`AssemblyReference.cs:7-8`): `Assembly` via `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), and `AssemblyName` via `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:8`) so the field is never null even when the runtime reports no simple name.

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and repeating the identical shape in every package keeps each assembly self-describing without cross-layer references.

- **Where it's used**: the Scrutor entity-configuration scan inside [`DependencyInjection`](#dependencyinjection-1)`.AddInfrastructure` uses `FromAssemblyOf<ClassReference>()` (the non-static companion, below); the NetArchTest architecture maps pin this assembly through the same anchor.

---

### BrokerMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument set for the broker transport. One meter carrying two counters: integration events that exhausted their retries and faulted, and outbox publishes the circuit breaker refused to even attempt.

- **Depends on**: `System.Diagnostics.Metrics` (BCL) only (`BrokerMetrics.cs:1`). Nothing first-party. It is the exact same shape as [`SchedulerMetrics`](#schedulermetrics), for a different feature.

- **Concept**: the one-meter-per-feature instrument holder, taught under [`SchedulerMetrics`](#schedulermetrics). What is worth teaching here is *which two numbers* were chosen. `[Rubric §13, Observability & Operability]` assesses whether a running system can be understood from outside: broker delivery is asynchronous and out of band, so a consumer that keeps failing produces no failed HTTP response anywhere, and the only evidence is a message quietly landing in an error queue. `broker.fault.count` is therefore the natural alert target for consumer health (`BrokerMetrics.cs:25-28`). The second counter exists because the class doc insists on a distinction an operator would otherwise have to infer: a publish rejected by an open circuit **never reached the broker at all** (`BrokerMetrics.cs:35-41`), which is different from a publish that reached it and failed. `[Rubric §29, Resilience & Business Continuity]`: those rejected rows stay leased and are retried on a later cycle, so the counter measures fail-fast behavior working as designed rather than data loss.

- **Walkthrough**:
  - `MeterName = "MMCA.Common.Broker"` (`BrokerMetrics.cs:21`) and the single static `Meter` built from it (`:23`). The doc carries the same never-create-a-second-meter warning as the scheduler (`BrokerMetrics.cs:12-16`), with the failure mode spelled out: a duplicate instance publishes a parallel set of instruments under one name, and a listener enabling one silently misses the measurements recorded on the other.
  - `FaultCounter` (`BrokerMetrics.cs:30-33`), `broker.fault.count`, unit `messages`, tagged by `event_type`.
  - `CircuitOpenCounter` (`:42-45`), `broker.circuit.open.count`, same unit and tag.

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the recording sites resolve nothing from DI. The meter name is duplicated as a **literal** in MMCA.Common.Aspire (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:203`) because that package has no reference to Infrastructure, and the doc records that duplication rather than letting the next reader discover it (`BrokerMetrics.cs:8-11`). The comment above the Aspire list states the operational consequence: these instruments are inert in a host that stays on the in-process bus (`Extensions.cs:190-198`).

- **Where it's used**: [`FaultIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#faultintegrationeventconsumertevent) adds to `FaultCounter` right after logging the fault (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:50-52`), and [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) adds to `CircuitOpenCounter` on the `BrokenCircuitException` branch of its publish path (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:655-661`), where the surrounding comment explains why the counter is per row while the log line is per cycle (`OutboxProcessor.cs:649-654`, `:661-665`). Both recording sites are pinned by tests that listen on the meter name: `FaultIntegrationEventConsumerTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/FaultIntegrationEventConsumerTests.cs`) and `OutboxProcessorTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs`).

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### ClassReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference-2) in the Infrastructure layer, an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught under [`AssemblyReference`](#assemblyreference-2). C# static classes cannot be used as generic type arguments, so any registration helper constrained to an instantiable reference type (for example Scrutor's `FromAssemblyOf<T>()`) is handed `ClassReference` instead of `AssemblyReference`. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token stands in for "this assembly" everywhere, so a developer wiring a new scan never has to hunt for a suitable real type.

- **Walkthrough**: a single-line body-less type declaration at `AssemblyReference.cs:11` (`public class ClassReference;`). No members.

- **Where it's used**: [`DependencyInjection`](#dependencyinjection-1)`.AddInfrastructure` calls `services.Scan(scan => scan.FromAssemblyOf<ClassReference>()...)` (`DependencyInjection.cs:125-129`, the anchor itself at `:112`) to discover every [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientitytypeconfigurationbasetentity-tidentifiertype) in the Infrastructure assembly and register it as its implemented interfaces with a scoped lifetime.

---

### InProcessLockHandle
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:79` · Level 0 · class (private nested, sealed)

- **What it is**: the disposable release token that [`InProcessDistributedLock`](#inprocessdistributedlock) hands back on a successful acquire. Disposing it removes exactly the key that acquisition added, exactly once.

- **Depends on**: nothing first-party. BCL only: the owner's `ConcurrentDictionary<string, byte>` and the key are passed into its primary constructor; `Interlocked` provides the once-only latch, `IAsyncDisposable`/`ValueTask` the shape.

- **Concept introduced, the acquisition handle as a scope token.** `[Rubric §2, Design Patterns]` assesses whether recurring problems use recognised patterns deliberately; returning a disposable instead of exposing a `Release(key)` method is the scope-bound-resource shape the [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) contract mandates, and it is what lets `await using` release the lock even when the guarded work throws. The token is also what makes release **owner-scoped**: the handle closes over the key it added, so it cannot free anybody else's acquisition.

- **Walkthrough**: the primary constructor takes the owner's `held` dictionary and the `key` (`InProcessDistributedLock.cs:79`); a single `int _released` field (`InProcessDistributedLock.cs:81`) is the latch. `DisposeAsync` (`InProcessDistributedLock.cs:83-91`) runs `Interlocked.Exchange(ref _released, 1) == 0` and only then calls `held.TryRemove(key, out _)` (`InProcessDistributedLock.cs:85-88`), so a second disposal is a no-op and the contract's "disposal is idempotent" clause holds. It returns `ValueTask.CompletedTask` (`InProcessDistributedLock.cs:90`) because removing a key from a `ConcurrentDictionary` is synchronous, so there is no state machine to allocate.

- **Why it's built this way**: an interlocked latch rather than a plain bool because a handle can be disposed from more than one thread (an `await using` unwind plus an explicit dispose), and the removal has to happen exactly once, or a late second dispose would evict a key a different caller has since acquired.

- **Where it's used**: constructed by `InProcessDistributedLock.TryAcquireAsync` (`InProcessDistributedLock.cs:63`) and returned as the contract's `IAsyncDisposable?`; the API [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter) is the caller that disposes it.

---

### RedisLockHandle
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:88` · Level 0 · class (private nested, sealed)

- **What it is**: the release token for a [`RedisDistributedLock`](#redisdistributedlock) acquisition. Disposing it runs a compare-and-delete Lua script that removes the Redis key only while it still carries this acquisition's token.

- **Depends on**: nothing first-party. Externals: StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`) and `Microsoft.Extensions.Logging`; `Interlocked` for the latch. Same handle shape as [`InProcessLockHandle`](#inprocesslockhandle), with real asynchronous work in the release.

- **Concept**: the owner-token release, the half of the `SET NX PX` lock that keeps it honest (the acquire half is taught under [`RedisDistributedLock`](#redisdistributedlock)). `[Rubric §13, Observability & Operability]` assesses whether a system reports its own degradation: a release that finds nothing to delete is exactly the case where the guarded section outran its time-to-live and stopped being exclusive, so the handle logs a warning naming the key rather than swallowing it.

- **Walkthrough**: the primary constructor captures the `IDatabase`, the already-qualified `RedisKey`, this acquisition's `RedisValue` token, and a logger (`RedisDistributedLock.cs:88-92`), with the same `int _released` latch (`RedisDistributedLock.cs:94`). `DisposeAsync` (`RedisDistributedLock.cs:96-113`) returns immediately when the latch was already set (`RedisDistributedLock.cs:98-101`); otherwise it evaluates `ReleaseScript` with that key and token (`RedisDistributedLock.cs:103-105`). The script is `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end` (`RedisDistributedLock.cs:36-37`), one round trip that compares and deletes atomically on the server. A `0` result means the key was already gone or is owned by someone else now, so there is nothing to release and `LogLockAlreadyExpired` warns (`RedisDistributedLock.cs:109-112`, message text at `RedisDistributedLock.cs:84`).

- **Why it's built this way**: a plain `DEL` would let a caller whose lock had already expired free the *next* holder's lock, which is precisely the double execution the lock exists to prevent (`RedisDistributedLock.cs:32-34`). Doing the comparison inside a Lua script makes compare-and-delete atomic server-side instead of a racy get-then-delete from the client ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).

- **Where it's used**: constructed by `RedisDistributedLock.TryAcquireAsync` (`RedisDistributedLock.cs:72`). `RedisDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:15`) asserts the acquire/release pairing against a mocked `IDatabase`, including the qualified key the handle deletes.

---

### ServiceBusEmulatorSupport
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/ServiceBusEmulatorSupport.cs:32` · Level 0 · class (internal, static)

- **What it is**: everything the Azure Service Bus transport needs in order to run against the official local emulator instead of a real namespace, collected in one type so the production branch in `ConfigureBrokerTransport` stays a single unconditional `cfg.Host(connectionString)` (`ServiceBusEmulatorSupport.cs:8-11`). It answers two questions: is this connection string an emulator one, and if so, how do we hand MassTransit the two clients it needs.

- **Depends on**: nothing first-party. Externals: `Azure.Messaging.ServiceBus` (`ServiceBusClient`), `Azure.Messaging.ServiceBus.Administration` (`ServiceBusAdministrationClient`), and MassTransit's `IServiceBusBusFactoryConfigurator` (`ServiceBusEmulatorSupport.cs:1-4`). BCL: `Uri`, `Interlocked`, `CultureInfo`. Its one caller is [`DependencyInjection`](#dependencyinjection-1)'s private `ConfigureBrokerTransport`, and its input comes from [`MessageBusSettings`](#messagebussettings) (`ConnectionString` plus `EmulatorAdminEndpoint`).

- **Concept introduced, detection that keys off the artifact rather than the environment.** `[Rubric §17, DevOps]` assesses whether development and production run the same paths: the point of the emulator branch is that a local stack exercises the *same* transport production uses, instead of substituting RabbitMQ and discovering Service Bus specific behavior only after deployment. `[Rubric §11, Security]` assesses blast radius: the branch is entered only when the resolved connection string carries `UseDevelopmentEmulator=true`, a token a real namespace never emits, so no production deployment can reach any of this by accident. That is stated as the reason detection is not keyed off an environment name or a separate flag, either of which somebody can set in the wrong place (`ServiceBusEmulatorSupport.cs:12-18`). `[Rubric §32, Dependency & Supply-Chain]`: the whole type exists because of a pinned dependency version. MassTransit v8 has no vendor emulator mode (that shipped in v9, which the workspace excludes because it needs a commercial license), so the only way onto the emulator is the custom-clients `Host` overload, where the caller builds both the data-plane and the management-plane client itself (`ServiceBusEmulatorSupport.cs:19-30`).

- **Walkthrough**:
  - **The four pieces of state.** `EmulatorMarker` is the literal `"UseDevelopmentEmulator=true"` (`ServiceBusEmulatorSupport.cs:37`). `EmulatorEntityQuota` is one hour, the ceiling the emulator enforces on entity time-to-live and auto-delete-on-idle (`:42`). `EmulatorHostAddress` is `sb://localhost/` (`:48`) and the doc is careful about what it is: it names the bus for the `Host` overload, not a network location, because both clients are already bound to the emulator's actual ports (`:44-47`). `_entityQuotasApplied` is the once-per-process latch (`:54`).
  - **`IsEmulatorConnectionString` (`:62-64`)** is the whole detection: a null-guard and a `Contains` with `StringComparison.OrdinalIgnoreCase`, so casing in the connection string cannot smuggle a stack onto the wrong branch.
  - **`ConfigureEmulatorHost` (`:86-101`)** is the entry point. It lowers the process-global quotas (`:93`), derives the management-plane connection string (`:95`), and calls the custom-clients overload with the host address, a new `ServiceBusClient` for the data plane and a new `ServiceBusAdministrationClient` for the management plane (`:97-100`). The `CA2000` suppression above it (`:82-85`) is worth reading rather than skipping: MassTransit takes ownership of the client for the life of the bus, which is the life of the process, so disposing it here would close the connection before the first publish.
  - **`ApplyEmulatorEntityQuotas` (`:108-118`)** flips `Interlocked.Exchange(ref _entityQuotasApplied, 1) != 0` and returns early on the second call (`:110-113`), then writes three MassTransit statics down to the one-hour quota: `DefaultMessageTimeToLive`, `BasicMessageTimeToLive` and `AutoDeleteOnIdle` (`:115-117`). MassTransit v8's own defaults sit far above the emulator's ceiling (366 days TTL, 427 days auto-delete), so without this every entity it tries to provision is rejected (`:26-29`). Because these are process-global statics, the method is deliberately never reached on the real-namespace path: a production bus keeps MassTransit's defaults (`:103-107`).
  - **`BuildAdminConnectionString` (`:131-156`)** derives the management-plane string from the AMQP one by swapping in the admin endpoint's host and port. The validation is stricter than "is it an absolute URI" and says why in a comment (`:133-135`): `localhost:5300` *is* an absolute URI, with `localhost` read as the scheme and no host at all, so the check also requires the scheme to be `http` or `https` (`:136-139`). A missing or malformed endpoint throws an `InvalidOperationException` whose message names the setting, the reason (v8 needs a management client on a second port) and the fix, including that an Aspire AppHost gets it for free (`:141-143`). The rebuild itself is a split on `;` that replaces only the `Endpoint=` segment and leaves everything else in place (`:145-155`), which is what keeps the shared-access key name and value byte-identical across both clients: composing a fresh second string is one silent typo away from an admin client that cannot provision anything (`:120-126`).

- **Why it's built this way**: [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html) records the local Service Bus emulator path as part of transport selection, and [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html) records the MassTransit v8 pin that forces the custom-clients overload and the quota lowering. Keeping all of it in one internal static type is what lets the production branch of `ConfigureBrokerTransport` stay a one-liner, so a reader of the transport wiring sees the production path first and the development affordance as an explicit detour.

- **Where it's used**: `ConfigureBrokerTransport` calls `IsEmulatorConnectionString` and, on a match, `ConfigureEmulatorHost(cfg, connectionString, settings.EmulatorAdminEndpoint)` (`DependencyInjection.cs:979-983`, the production `cfg.Host(connectionString)` in the `else` at `:972`). The admin endpoint is bound from `MessageBus:EmulatorAdminEndpoint` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:49`), which an Aspire AppHost sets from the emulator resource (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:289-291`, alongside `MessageBus__Provider=AzureServiceBus` and the AMQP connection string). The test tier applies the same quota lowering from its own fixture, [`ServiceBusEmulatorFixtureBase`](group-27-testing-infrastructure.md#servicebusemulatorfixturebase) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs:74`), which pins the emulator image (`:61`). `ServiceBusEmulatorSupportTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/ServiceBusEmulatorSupportTests.cs:14`) covers marker detection including casing, the endpoint swap, the loud failure on a missing or non-HTTP admin endpoint, and the one-hour quota constant.

- **Caveats / not-in-source**: whether a given AppHost run uses the emulator or RabbitMQ is a host and environment decision, so "which transport a developer is on right now" is Not determinable from source here; the source only settles that the emulator branch is reachable exactly when the resolved connection string carries the marker.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### UseDatabaseAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:22` · Level 0 · class (sealed attribute)

- **What it is**: a declarative attribute placed on an entity type configuration class to name the **logical data source (database)** that entity targets. It is the "which database" half of the database-per-microservice routing story; the sibling [`UseDataSourceAttribute`](#usedatasourceattribute) is the "which engine" half.

- **Depends on**: `System.Attribute` (BCL) only. Its resolved logical name is consumed downstream by the data-source machinery ([`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)) and mapped to a connection string through the `DataSources` configuration entries modelled by [`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings) / [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings).

- **Concept introduced, declarative database-per-service routing.** `[Rubric §8, Data Architecture]` assesses how the model maps to physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The attribute's XML doc (`UseDatabaseAttribute.cs:8-18`) spells out the three-step resolution order for an entity's logical name: (1) this attribute on the concrete configuration class (inherited); (2) the module name derived from the entity namespace, the segment before `Domain`; (3) the literal `"Default"`, the top-level `ConnectionStrings` section. A logical name with no `DataSources` entry (or whose connection string equals the top-level one) collapses onto the `Default` physical source (`UseDatabaseAttribute.cs:15-17`), so a host that configures nothing behaves exactly like a single-database monolith. This "convention with an explicit override" shape is the load-bearing idea: most modules never apply the attribute and ride the namespace convention.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDatabaseAttribute.cs:21`). `Inherited = true` is deliberate: annotating a per-module configuration base class propagates the database assignment to every derived configuration, so a module can pin all its entities to one database in a single place. `AllowMultiple = false` forbids an ambiguous second assignment.
  - Primary-constructor parameter `name` (`UseDatabaseAttribute.cs:22`), the logical name (for example `"Conference"`, the example the doc itself uses at `:20`).
  - `Name` get-only property (`UseDatabaseAttribute.cs:25`) initialized from that parameter, the value the resolver reads.

- **Why it's built this way**: an attribute keeps the database choice declarative and co-located with the entity configuration rather than buried in a registration method, and `Inherited = true` turns per-module assignment into one annotation instead of one per entity ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database per microservice).

- **Where it's used**: applied on concrete EF entity type configuration classes in the modules; read up front by the eager [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) so routing does not depend on a model having been built.

---

### MessageBusProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:199` · Level 0 · enum

- **What it is**: the transport selector for the cross-service message bus. It lives in the same file as [MessageBusSettings](#messagebussettings), immediately below it.

- **Depends on**: nothing.

- **Concept**: the transport-choice-at-the-edge invariant. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` both hinge on application code never naming a broker: handlers publish through [IMessageBus](group-04-events-outbox.md#imessagebus), and only this enum plus the registration that reads it decide whether that lands in-process or on a wire. The three values are also a deployment ladder: monolith, dev microservices, production microservices.

- **Walkthrough**: `InProcess = 0` (`MessageBusSettings.cs:204`), the modular-monolith default served by [InProcessMessageBus](group-04-events-outbox.md#inprocessmessagebus); `RabbitMq = 1` (`:209`), MassTransit on RabbitMQ for development microservice deployments and tests; `AzureServiceBus = 2` (`:214`), MassTransit on Azure Service Bus for production.
  - `AddBrokerMessaging` re-reads the section eagerly, substituting a default instance when it is absent (`DependencyInjection.cs:738-739`), and returns without touching the container when the value is `InProcess` (`:741-744`).
  - The transport configuration then switches on the same value to pick `UsingRabbitMq` (`DependencyInjection.cs:924-927`) or `UsingAzureServiceBus` (`:956-957`), with `InProcess` as an explicit arm rather than a fall-through (`:995`).
  - The enum also gates delivery policy, not just the client type: [MessageBusSettings](#messagebussettings)`.RedeliveryIntervalsSeconds` (`MessageBusSettings.cs:195`, defaulting to `[60, 600, 3600]`) is applied unconditionally on Azure Service Bus, which has native scheduled delivery, and only when `EnableDelayedRedelivery` is set on RabbitMQ, which needs the delayed-message-exchange plugin (`:188-193`).

- **Why it's built this way**: a zero-valued `InProcess` means an absent `MessageBus` section binds to the monolith behavior, so adding the section is opt-in rather than mandatory ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Here the enum ordinal genuinely is the default path, alongside the property initializer at `MessageBusSettings.cs:17`.

- **Where it's used**: [MessageBusSettings.Provider](#messagebussettings) (`MessageBusSettings.cs:17`) and the `AddBrokerMessaging` branches cited above.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### SmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Mail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the `Smtp` section: host, port, credentials, TLS toggle, and the default sender and recipient addresses. Validated by data annotations at startup (`SmtpSettings.cs:5-8`).

- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]` (`SmtpSettings.cs:1`). Consumed by [SmtpEmailSender](group-10-notifications.md#smtpemailsender), the [IEmailSender](group-10-notifications.md#iemailsender) implementation.

- **Concept**: the validate-on-start gate taught under [ConnectionStringSettings](group-07-persistence-ef-core.md#connectionstringsettings), here guarding a numeric range rather than a cross-section rule. `[Rubric §15, Best Practices & Code Quality]` assesses whether avoidable failures are moved earlier: `[Range(1, 65535)]` on `Port` (`SmtpSettings.cs:21`) means a configuration typo such as `0` or `70000` fails the host at boot with a named error instead of surfacing as a socket exception the first time the application sends mail. Note also the named constant instead of a magic number: `DefaultSmtpPort = 25` is a `public static readonly` field (`:15`) used as the property's own default (`:22`), so the value is discoverable and testable rather than inlined. `[Rubric §11, Security]`: `Password` is a plain `string` (`:28`), so it is only ever as safe as the configuration provider that supplies it (user-secrets or Key Vault, never a committed `appsettings.json`).

- **Walkthrough**: two static fields then seven `{ get; init; }` members.
  - `SectionName = "Smtp"` (`SmtpSettings.cs:12`) and `DefaultSmtpPort = 25` (`:15`).
  - `Host` (`:18`), `Port` (`:22`), `Username` (`:25`), `Password` (`:28`), `EnableSsl` (`:31`, defaulting to `false`), `From` (`:34`), `To` (`:37`). Every string defaults to `string.Empty`, so an absent section binds cleanly; only `Port` is range-checked. `To` is documented as the default recipient used by the no-argument `SendAsync` overload (`:36-37`).
  - The consumer is deliberately plain: [SmtpEmailSender](group-10-notifications.md#smtpemailsender) takes `IOptions<SmtpSettings>` in its primary constructor and snapshots `.Value` into a readonly field (`SmtpEmailSender.cs:12-14`), then builds a fresh `SmtpClient` per send from `Host`/`Port` plus a `NetworkCredential` and `EnableSsl` (`:25-29`), and a `MailMessage` from `From` (`:32-35`).
  - `EnableSsl` carries a documented analyzer suppression at the call site: S5332 (cleartext protocol) is waived because the value comes from configuration and local development targets MailDev, which offers no TLS (`SmtpEmailSender.cs:23`, restored at `:30`).

- **Why it's built this way**: annotations plus `ValidateOnStart` cost one line at registration and move an entire class of misconfiguration from run time to boot, the contract [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure` (`DependencyInjection.cs:85-88`); read by [SmtpEmailSender](group-10-notifications.md#smtpemailsender).

---

### InProcessDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:31` · Level 1 · class (internal, sealed, partial)

- **What it is**: the fallback [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) for a host with no Redis connection registered. It serializes callers inside this one process, and it says so in the log the first time anybody uses it.

- **Depends on**: [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) (the contract it implements, from `MMCA.Common.Application.Interfaces`, imported at `InProcessDistributedLock.cs:4`), `ILogger<InProcessDistributedLock>` injected through the primary constructor (`InProcessDistributedLock.cs:31`), and its own nested [`InProcessLockHandle`](#inprocesslockhandle). BCL: `ConcurrentDictionary`, `Interlocked`, `Stopwatch`, `Task.Delay`.

- **Concept introduced, the degraded implementation that announces itself.** `[Rubric §12, Performance & Scalability]` assesses whether the design survives horizontal scale-out: each replica gets its own instance of this class and therefore its own held-key table, so with more than one replica a section guarded by this lock **still runs once per replica** (`InProcessDistributedLock.cs:11-15`). That is correct for a single-replica deployment, for local development, and for tests, and wrong for anything else, which is why the fallback is not silent. `[Rubric §13, Observability & Operability]` assesses whether an operator can see a degraded mode: the first acquisition emits a `[LoggerMessage]`-generated warning that names both the cause and the fix (`InProcessDistributedLock.cs:75-76`, "no `IConnectionMultiplexer` is registered ... Register a Redis client (`AddRedisClient`) to make it exclusive across replicas").

- **Walkthrough**:
  - **State.** `PollInterval` is 25 ms (`InProcessDistributedLock.cs:34`), the gap between acquisition attempts while waiting for a holder. `_held` is a `ConcurrentDictionary<string, byte>` with `StringComparer.Ordinal` (`InProcessDistributedLock.cs:36`), used as a set: the value byte is a placeholder and only key presence matters. `_degradationWarned` is the warn-once flag (`InProcessDistributedLock.cs:39`).
  - **Guards and the warning.** `TryAcquireAsync` (`InProcessDistributedLock.cs:42-73`) rejects a blank key, a non-positive `ttl`, and a negative `wait` (`InProcessDistributedLock.cs:48-50`), then flips the flag with `Interlocked.Exchange(ref _degradationWarned, 1) == 0` so a steady state warns once rather than per request (`InProcessDistributedLock.cs:52-55`).
  - **The acquire loop** (`InProcessDistributedLock.cs:59-72`). `_held.TryAdd(key, 0)` is the atomic test-and-set: it succeeds only for the caller that inserts the key, and that caller gets an [`InProcessLockHandle`](#inprocesslockhandle) (`InProcessDistributedLock.cs:61-63`). Otherwise, if `Stopwatch.GetElapsedTime(startedAt) >= wait` the method returns `null` (`InProcessDistributedLock.cs:66-69`), which is what makes `wait: TimeSpan.Zero` a single non-blocking attempt exactly as the contract promises. Otherwise it awaits `Task.Delay(PollInterval, cancellationToken)` and retries (`InProcessDistributedLock.cs:71`).
  - **Exact keys, not stripes.** The remarks explain the one design choice that differs from [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (`InProcessDistributedLock.cs:18-25`): stripes let two unrelated keys share a semaphore, which is harmless for a caller that waits indefinitely but not for a *bounded* wait, where the false sharing turns into a spurious "held elsewhere" answer for a key nobody holds. The table stays bounded by the number of locks held right now, not by every key the process has ever seen, because the handle removes the entry on release.
  - **`ttl` is accepted and ignored** (`InProcessDistributedLock.cs:26-29`). It is validated (`InProcessDistributedLock.cs:49`) but never used: the TTL exists to bound a holder that died without releasing, and here the holder is a task in this process, so if the process dies the table dies with it.

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) makes the lock a registration rather than an optional dependency, so a host always resolves *something*; this type is the honest floor of that guarantee. Logging the degradation once, instead of silently behaving like a lock, is what keeps "we have a distributed lock" from becoming a false belief in a multi-replica deployment.

- **Where it's used**: registered by `AddCaching` in the Infrastructure composition root when no `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:298-300`, inside the `IDistributedLock` factory at `:273-287`; see [`DependencyInjection`](#dependencyinjection-1)), which covers MMCA.Helpdesk, local single-process runs, and tests. Behavior is pinned by `InProcessDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/InProcessDistributedLockTests.cs:12`).

---

### UseDataSourceAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13` · Level 1 · class (sealed attribute)

- **What it is**: the companion attribute to [`UseDatabaseAttribute`](#usedatabaseattribute). Where that one names the logical database, this one declares the **database engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): `CosmosDB`, `Sqlite`, or SQL Server) an entity type configuration targets. It is Level 1 rather than Level 0 because, unlike the pure-BCL `UseDatabaseAttribute`, it references the first-party `DataSource` enum.

- **Depends on**: the [`DataSource`](group-07-persistence-ef-core.md#datasource) enum (from `MMCA.Common.Application.Interfaces.Infrastructure.Persistence`, imported at `UseDataSourceAttribute.cs:1`) and `System.Attribute` (BCL).

- **Concept**: engine selection for the multi-engine persistence layer, the sibling of the logical-name routing introduced under [`UseDatabaseAttribute`](#usedatabaseattribute). `[Rubric §8, Data Architecture]` again: the framework supports SQL Server, Cosmos, and SQLite simultaneously, and this attribute is how a configuration announces which engine's rules apply. In practice it is carried on the provider-specific configuration base classes (`EntityTypeConfigurationSQLServer/Cosmos/Sqlite`), so a concrete configuration inherits its engine, while `UseDatabaseAttribute` selects which database on that engine.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDataSourceAttribute.cs:12`), same inheritance and single-use semantics as `UseDatabaseAttribute` so a provider base class propagates the engine to derived configurations.
  - Primary-constructor parameter `dataSource` (`UseDataSourceAttribute.cs:13`) of type [`DataSource`](group-07-persistence-ef-core.md#datasource).
  - `DataSource` get-only property (`UseDataSourceAttribute.cs:16`) exposing the chosen engine. The XML doc (`UseDataSourceAttribute.cs:5-10`) records that it is read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) at model-building time to populate the entity-to-data-source cache that [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork) uses to route each entity to the correct [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).

- **Why it's built this way**: keeping the engine on an attribute (inherited from a provider base class) means an entity's engine and database are both declarative metadata the registry can scan up front, which is what lets routing happen without first building an EF model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: on the per-engine `EntityTypeConfiguration*` base classes and, through inheritance, every concrete configuration under them; read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) / [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry).

---

### MessageBusSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:11` · Level 1 · class (sealed)

- **What it is**: the `MessageBus` section. It selects the transport, says how to reach the broker,
  how to namespace its queues, how hard to retry a failing consumer, and whether the two
  store-and-forward guards (the transactional outbox and the consumer-side idempotency inbox) are on
  (`MessageBusSettings.cs:5-10`). Despite the name it is the single switch for the whole event
  delivery posture, not just for the wire protocol.

- **Depends on**: [MessageBusProvider](#messagebusprovider), the transport enum declared at the
  bottom of the same file (`MessageBusSettings.cs:199-215`). Externals:
  `System.ComponentModel.DataAnnotations` for the `[StringLength]` and `[Range]` guards (`:1`).

- **Concept introduced: a tri-state flag that resolves from the transport.** Two of the properties
  here are `bool?`, not `bool`, and each has a computed companion. `EnableInbox` (`:117`) is the raw
  configured value and `IsInboxEnabled` (`:125`) is what every framework component actually reads:
  `EnableInbox ?? Provider != MessageBusProvider.InProcess`. `EnableOutbox` (`:151`) and
  `IsOutboxEnabled` (`:159`) work identically. The point of the third state is that "the host said
  nothing" and "the host said false" are different facts. Unset means "let the transport decide",
  which turns both features ON for a broker and OFF in-process, and an explicit value always wins in
  both directions. That is why a settings class that could have been a bag of booleans carries
  derived properties: the resolution rule lives once, next to the data, instead of being repeated at
  every read site.

  `[Rubric §6, CQRS and Event-Driven]` assesses how reliably a state change turns into a delivered
  event. Both resolved flags default ON for a broker deliberately, and the XML doc argues the case
  rather than just stating it: broker delivery is at-least-once by contract, so an ack after a
  network blip, a redelivery after a lease expiry, or an outbox row republished after a crash all
  hand the same event to the same handlers twice, and with the inbox off every one of those becomes
  a duplicate side effect (`:98-109`, [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).
  Symmetrically, a single-process host dispatches every event inside the process that raised it, so
  the store-and-forward hop buys it two background services, a table and a poll loop for nothing
  (`:133-141`).

  `[Rubric §29, Resilience and Business Continuity]` assesses whether transient failures are absorbed
  before they become lost messages. This class configures two independent retry tiers.
  `RetryLimit` / `RetryMinIntervalSeconds` / `RetryMaxIntervalSeconds` feed the in-process
  exponential `UseMessageRetry` filter applied to every broker receive endpoint
  (`DependencyInjection.cs:947-951` for RabbitMQ, `:986-990` for Azure Service Bus).
  `EnableDelayedRedelivery` and `RedeliveryIntervalsSeconds` feed a second, broker-scheduled tier
  that sits above it, so a message that exhausts its immediate attempts is scheduled back onto the
  queue instead of dead-lettering (`:161-195`).

  `[Rubric §7, Microservices Readiness]` assesses whether several services can share infrastructure
  without colliding. `EndpointPrefix` exists so multiple services can live on one broker without
  fighting over queue names: without it, two services with a consumer of the same short type name
  derive the same kebab-case queue and become competing consumers across a service boundary, where
  each event reaches only one of them (`:51-64`).

- **Walkthrough**: one static field, seven `init` properties, and two computed properties.
  - `SectionName = "MessageBus"` (`MessageBusSettings.cs:14`), the bind key.
  - `Provider` (`:17`): defaults to `MessageBusProvider.InProcess`, so the modular monolith is the
    zero-configuration case.
  - `ConnectionString` (`:26`): nullable, and only the first of three sources.
    `ResolveBrokerConnectionString` prefers it, then falls back to `ConnectionStrings:rabbitmq` and
    `ConnectionStrings:messaging` (`DependencyInjection.cs:880-889`), which is what Aspire injects
    via `WithReference(broker)`. Without that fallback MassTransit would default to `localhost:5672`
    and miss the Aspire-allocated container port (`DependencyInjection.cs:866-875`).
  - `EmulatorAdminEndpoint` (`:49`) with `[StringLength(2048)]` (`:48`): the base address of the
    Azure Service Bus emulator's HTTP management plane. It exists only because MassTransit is pinned
    to v8, which has no vendor emulator mode; the one v8 path onto the emulator is the custom-clients
    `Host` overload that needs a data-plane client AND a management-plane client, and the emulator
    serves those on two different ports, so the management client cannot be derived from
    `ConnectionString` alone (`:33-40`). It is read only when the connection string carries
    `UseDevelopmentEmulator=true` (`DependencyInjection.cs:965-968`), a token no real namespace
    emits, so the production path is untouched (`:961-964`).
  - `EndpointPrefix` (`:67`) with `[StringLength(64)]` (`:66`): when set, `AddMassTransit` installs
    `new KebabCaseEndpointNameFormatter(settings.EndpointPrefix, includeNamespace: false)`
    (`DependencyInjection.cs:755-763`). `includeNamespace: false` is deliberate: the prefix is the
    only namespacing applied, so a queue name stays readable and survives a consumer type moving
    between folders (`:59-63`).
  - `RetryLimit` (`:76`) with `[Range(0, 20)]` (`:75`), default `5`; `0` disables retries and a
    faulted message goes straight to the `_error` queue.
  - `RetryMinIntervalSeconds` (`:83`) with `[Range(0, 300)]`, default `1`, and
    `RetryMaxIntervalSeconds` (`:89`) with `[Range(0, 3600)]`, default `30`: the floor and the cap of
    the exponential backoff.
  - `EnableInbox` (`:117`) and `IsInboxEnabled` (`:125`). `AddBrokerMessaging` registers
    [EfInboxStore](group-04-events-outbox.md#efinboxstore) when the resolved value is true and
    [NoOpInboxStore](group-04-events-outbox.md#noopinboxstore) plus a startup
    [InboxDisabledWarningService](group-04-events-outbox.md#inboxdisabledwarningservice) when it is
    false, so an opt-out is recorded in the log rather than passing silently
    (`DependencyInjection.cs:784-796`). The `InboxMessages` table is part of the shared relational
    model created by the standard migrations, so turning it on for a migrated host needs no schema
    work (`:91-97`).
  - `EnableOutbox` (`:151`) and `IsOutboxEnabled` (`:159`). `AddInfrastructure` reads the resolved
    value to decide whether to run [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) and
    [OutboxCleanupService](group-04-events-outbox.md#outboxcleanupservice) or the single
    [OutboxDisabledNoticeService](group-04-events-outbox.md#outboxdisablednoticeservice)
    (`DependencyInjection.cs:186-198`). Turning it off under a broker is not honored:
    `EnsureOutboxAvailableForProvider` throws at registration, because a broker with no outbox has
    no delivery channel at all (`DependencyInjection.cs:857-864`, argued at `:142-149`). The check
    runs in both `AddInfrastructure` (`:188`) and `AddBrokerMessaging` (`:749`) so a service host
    that wires only the broker still fails loudly. The `OutboxMessages` table stays mapped either
    way, so flipping the flag is never a migration.
  - `EnableDelayedRedelivery` (`:179`), default `false`. It gates second-level redelivery on RabbitMQ
    only, because that transport needs the `rabbitmq_delayed_message_exchange` plugin the Aspire
    development container does not ship, and enabling it against a plugin-less broker fails at bus
    start (`:167-172`, `DependencyInjection.cs:934-945`). Azure Service Bus schedules natively, so
    the flag is deliberately not consulted there and the intervals apply unconditionally
    (`:173-177`, `DependencyInjection.cs:976-984`).
  - `RedeliveryIntervalsSeconds` (`:195`): defaults to `[60, 600, 3600]`, one minute, ten minutes and
    one hour, a spread wide enough to ride out a dependency restart, a failover and a short incident
    without an operator replaying the error queue by hand (`:181-187`). `BuildRedeliveryIntervals`
    drops non-positive entries, because a zero or negative interval schedules an immediate
    redelivery, which is what `UseMessageRetry` already does and would turn the second level into a
    hot loop; when nothing survives, the caller skips the filter entirely
    (`DependencyInjection.cs:1002-1013`).

- **Why it's built this way**: resolving both guards from the transport rather than shipping fixed
  defaults is what lets one settings class serve the monolith and the extracted-service topology at
  the same time ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)),
  while keeping the at-least-once contract intact where it matters
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html),
  [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)). Refusing an
  outbox-less broker at registration rather than honoring it follows the fail-fast configuration
  contract ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)):
  the misconfiguration becomes a startup exception instead of silently dropped events.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddInfrastructure` (`DependencyInjection.cs:160-163`), then re-read eagerly in the same method to
  gate the outbox hosted services (`:186-198`). `AddBrokerMessaging` reads it again, falling back to
  `new MessageBusSettings()` when the section is absent (`:738-739`), short-circuits on `InProcess`
  (`:741-744`), and otherwise replaces [IMessageBus](group-04-events-outbox.md#imessagebus) with
  [BrokerMessageBus](group-04-events-outbox.md#brokermessagebus) (`:771`) and
  [IEventBus](group-04-events-outbox.md#ieventbus) with
  [BrokerEventBus](group-04-events-outbox.md#brokereventbus) (`:777`), so
  [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) becomes the only delivery channel.
  [InProcessEventBus](group-04-events-outbox.md#inprocesseventbus) takes the options as an OPTIONAL
  parameter and consults the resolved outbox flag to choose between writing rows and dispatching
  directly (`InProcessEventBus.cs:39`, `:80-84`), and
  [OutboxCleanupService](group-04-events-outbox.md#outboxcleanupservice) reads `IsInboxEnabled` to
  decide whether to purge inbox rows (`OutboxCleanupService.cs:58`). Emulator wiring is delegated to
  [ServiceBusEmulatorSupport](#servicebusemulatorsupport). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs`, which pins
  both resolution rules unset and explicit (`SettingsTests.cs:267-268`, `:271-273`, `:286-287`,
  `:295-297`).

- **Caveats**: MassTransit is pinned to major version 8 by workspace policy, and both the retry API
  surface above and the existence of `EmulatorAdminEndpoint` are consequences of that pin.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### RedisDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:24` · Level 2 · class (internal, sealed, partial)

- **What it is**: the cross-replica [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock), implemented as the standard `SET key token NX PX ttl` Redis lock against a single Redis instance.

- **Depends on**: `IConnectionMultiplexer` and the rest of StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`), `ILogger<RedisDistributedLock>`, and an optional [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) (`RedisDistributedLock.cs:24-27`), which is what puts this type at Level 2 rather than Level 1. It returns its nested [`RedisLockHandle`](#redislockhandle).

- **Concept**: the acquire half of the lock taught in two pieces with [`RedisLockHandle`](#redislockhandle). `[Rubric §12, Performance & Scalability]` assesses scale-out correctness: moving the lock into Redis is what makes "only one of these runs at a time" true across replicas instead of true per process, which is the whole reason the abstraction exists (see [`InProcessDistributedLock`](#inprocessdistributedlock) for the degraded alternative). `[Rubric §29, Resilience & Business Continuity]` assesses failure behavior: the expiry carried on the `SET` is the crash guard (a holder that dies releases by expiry rather than wedging the key forever, `RedisDistributedLock.cs:12-17`), and the class documents that it is deliberately **single-instance, not Redlock** (`RedisDistributedLock.cs:19-23`), inheriting Redis's failover behavior, which is exactly why the contract is documented as best-effort.

- **Walkthrough**:
  - **State.** `KeyPrefix` is `"lock:"` (`RedisDistributedLock.cs:30`) so lock entries cannot collide with cache entries in a shared instance. `ReleaseScript` (`RedisDistributedLock.cs:36-37`) is the compare-and-delete Lua taught under [`RedisLockHandle`](#redislockhandle). `PollInterval` is 50 ms (`RedisDistributedLock.cs:40`); unlike the in-process poll, each retry here is a network round trip. `_keys` falls back to `CacheKeyNamespace.None` when no namespace was injected (`RedisDistributedLock.cs:42`), so the `Cache:KeyPrefix` option (when configured) qualifies lock keys the same way it qualifies cache keys.
  - **Argument guards.** `TryAcquireAsync` (`RedisDistributedLock.cs:45-82`) applies the same three checks as the in-process implementation: non-blank key, `ttl` greater than zero, non-negative `wait` (`RedisDistributedLock.cs:51-53`).
  - **Key and token.** The physical key is `_keys.Qualify(string.Concat(KeyPrefix, key))` (`RedisDistributedLock.cs:55`). The token is a fresh `Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)` minted **per acquisition** (`RedisDistributedLock.cs:59`); the release script matches on it, and that is what makes a release owner-scoped instead of "delete whatever is there now" (`RedisDistributedLock.cs:57-58`).
  - **The acquire loop** (`RedisDistributedLock.cs:64-81`). `StringSetAsync(redisKey, token, ttl, keepTtl: false, When.NotExists, CommandFlags.None)` (`RedisDistributedLock.cs:66-68`) is a single atomic conditional set carrying the expiry, so exactly one replica can win a key. On success it returns a [`RedisLockHandle`](#redislockhandle) closing over the database, key, token, and logger (`RedisDistributedLock.cs:70-73`); once `Stopwatch.GetElapsedTime(startedAt) >= wait` it returns `null` (`RedisDistributedLock.cs:75-78`); otherwise it delays one `PollInterval` and retries (`RedisDistributedLock.cs:80`).

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) replaced the process-local guard around the idempotency filter's execute-then-store window with this, because a striped semaphore stops serializing anything once a service runs more than one replica. Choosing the one-instance `SET NX PX` lock over Redlock is a stated trade: simpler, dependent on a single Redis, and paired with a contract that tells callers never to lean on it for an invariant persistence can enforce.

- **Where it's used**: selected by `AddCaching` whenever an `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:290-296`, see [`DependencyInjection`](#dependencyinjection-1)), passing the same [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) the distributed cache gets (`DependencyInjection.cs:294`). The one in-framework caller is the API [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter); `RedisDistributedLockTests` covers the acquire and release commands against a mocked `IDatabase`.

- **Caveats / not-in-source**: whether a given deployed environment actually supplies the `redis` connection string is an infrastructure/config fact, not a source fact, so "which implementation is live in environment X" is Not determinable from source here; the source only settles that the presence of a registered `IConnectionMultiplexer` decides it.

---

### DependencyInjection
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:53` · Level 14 · class (static, extension)

- **What it is**: the single composition root for the entire Infrastructure layer. A static class whose body is one C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:55-851`) adding the layer's fifteen registration methods directly onto `IServiceCollection`: `AddInfrastructure(IConfiguration)` (`:63`), `AddCaching(IConfiguration?)` (`:229`), `AddCommonHybridCache(Action<HybridCacheOptions>?)` (`:340`), `AddScheduledJobs(IConfiguration)` (`:405`), `AddScheduledJob<TJob>()` (`:440`), `AddAuditTrail(IConfiguration)` (`:476`), `AddMultiTenancy(IConfiguration)` (`:525`), `AddServices()` (`:543`), `AddEntityConfigurationAssembly(Assembly)` (`:597`), `AddNotificationInfrastructure()` (`:614`), `AddPushNotifications(IConfiguration)` (`:629`), `AddNativePushNotifications(IConfiguration)` (`:662`), `AddAzureBlobFileStorage(IConfiguration)` (`:694`), `AddBrokerMessaging(IConfiguration, Action?)` (`:746`), and `AddTypedServiceClient<TInterface, TImplementation>(string)` (`:833`). Four private static helpers sit outside the block and below it (`:871`, `:894`, `:933`, `:1024`).

- **Depends on**: nearly every Infrastructure type below it, wired by interface. Persistence: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory), [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice), [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), [`DefaultEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#defaultentityconfigurationassemblyprovider), [`EFQueryableExecutor`](group-07-persistence-ef-core.md#efqueryableexecutor), [`SqlServerUniqueConstraintViolationDetector`](group-07-persistence-ef-core.md#sqlserveruniqueconstraintviolationdetector), [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype), [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory), [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork), [`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor), [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor). Messaging/outbox: [`IMessageBus`](group-04-events-outbox.md#imessagebus)/[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)/[`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`IEventBus`](group-04-events-outbox.md#ieventbus)/[`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus)/[`BrokerEventBus`](group-04-events-outbox.md#brokereventbus), [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), [`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice), [`OutboxAdministration`](group-04-events-outbox.md#outboxadministration), [`EfInboxStore`](group-04-events-outbox.md#efinboxstore)/[`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore)/[`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice), [`ServiceBusEmulatorSupport`](#servicebusemulatorsupport). Cross-cutting: [`ICacheService`](group-09-caching.md#icacheservice) with [`DistributedCacheService`](group-09-caching.md#distributedcacheservice)/[`MemoryCacheService`](group-09-caching.md#memorycacheservice)/[`HybridCacheService`](group-09-caching.md#hybridcacheservice), [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) with [`RedisDistributedLock`](#redisdistributedlock)/[`InProcessDistributedLock`](#inprocessdistributedlock), [`IJwksProvider`](group-08-auth.md#ijwksprovider)/[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider), [`TokenService`](group-08-auth.md#tokenservice), [`LoginProtectionService`](group-08-auth.md#loginprotectionservice), [`PasswordResetTokenService`](group-08-auth.md#passwordresettokenservice), [`EFRefreshSessionStore`](group-07-persistence-ef-core.md#efrefreshsessionstore) with [`RefreshSessionCleanupService`](group-07-persistence-ef-core.md#refreshsessioncleanupservice), [`EventUpcasterStartupValidator`](group-14-module-system-composition.md#eventupcasterstartupvalidator), [`ScheduledJobRunner`](#scheduledjobrunner), [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader)/[`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader), [`TenantContext`](group-14-module-system-composition.md#tenantcontext), [`CorrelationContext`](group-12-api-hosting-mapping.md#correlationcontext), [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). Settings: [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) with [`ConnectionStringSettingsValidator`](group-07-persistence-ef-core.md#connectionstringsettingsvalidator), [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings)/[`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings), [`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](group-04-events-outbox.md#outboxsettings), [`PersistenceSettings`](group-07-persistence-ef-core.md#persistencesettings), [`SmtpSettings`](#smtpsettings), [`JwksSettings`](group-08-auth.md#jwkssettings), [`CacheSettings`](group-09-caching.md#cachesettings), [`QueryCachePipelineSettings`](#querycachepipelinesettings), [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), [`PasswordResetSettings`](group-08-auth.md#passwordresetsettings), [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings), [`SchedulerSettings`](#schedulersettings), [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings), [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) with [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator), [`PushNotificationSettings`](#pushnotificationsettings), [`NativePushSettings`](#nativepushsettings), [`FileStorageSettings`](#filestoragesettings). Externals: MassTransit v8 (pinned by policy), StackExchange.Redis, `Microsoft.Extensions.Caching.Hybrid`, `Microsoft.AspNetCore.SignalR`, `Microsoft.Azure.NotificationHubs`, `Azure.Storage.Blobs` / `Azure.Identity`, `Microsoft.Extensions.Http.Resilience`, Scrutor.

- **Concept introduced, the mega-composition-root plus the swap-at-the-edge extraction pattern.** `[Rubric §3, Clean Architecture]` assesses whether wiring lives at the edge rather than in the core: every concrete Infrastructure choice is registered here, not in Application or Domain. `[Rubric §12, Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`: the method bodies are the framework's default posture, and each optional capability (broker, scheduler, audit trail, tenancy, hybrid cache, push, native push, blob storage) is a separate opt-in method a host layers on, so the same package runs as a monolith or as an extracted service without recompiling the core. The default everywhere is `TryAdd*`, meaning a host can pre-register its own implementation and the framework will not clobber it; the places that deliberately break that rule are the broker swap (`Replace`, `:785` and `:791`), `AddCommonHybridCache` (`RemoveAll`, `:366`), and the two push registrations that overwrite their own null defaults (`:645-646`), and each says so in a comment. `[Rubric §17, DevOps]`: registering a capability is consistently NOT the same as enabling it, the scheduler and the audit trail both stay inert until their `Enabled` flag is true (`:399-403`, `:455-463`), so a host ships the registration and an environment turns it on. `[Rubric §15, Best Practices & Code Quality]`: the two places where a misconfiguration would be silent instead throw or warn at startup, which is the running theme of this file.

- **Walkthrough** (in registration order):
  - **`AddInfrastructure` (`:63-222`)** is the entry point. It registers the model-facing singletons (`:65-66`) and the three EF save interceptors as singletons because they are stateless with per-save state in a `ConditionalWeakTable` keyed by context (`:68-76`), including [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), which is registered unconditionally so a host can never leave the write-side tenancy guard half-wired (`:73-76`).
  - **Settings binding, and the one rule annotations cannot express.** [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) binds through `AddOptions(...).ValidateDataAnnotations().ValidateOnStart()` (`:78-81`), then [`ConnectionStringSettingsValidator`](group-07-persistence-ef-core.md#connectionstringsettingsvalidator) is added through `TryAddEnumerable` (`:88-89`) with the reason inline (`:83-87`): "a host must reach some database" spans the `ConnectionStrings` section AND the `DataSources` one, so a SQLite-only host declaring its databases as named sources is legitimate while a host declaring none anywhere is not. The same `TryAddEnumerable` idiom recurs for every validator and startup check in the file, so two modules calling `AddInfrastructure` never run one validation twice.
  - **The named-data-sources note (`:91-95`)** is load-bearing: [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) is built directly from `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` rather than through `AddOptions`, because a root-level dictionary section does not bind through the options pipeline. The resolver and the eager entity registry follow immediately (`:96-97`).
  - **The physical-factory warning (`:104-110`)**: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is scoped (one per request) and [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory) is a singleton that must **never** be converted to EF context pooling, because each raw context carries per-source constructor state that pooling would silently reuse across databases. Beside them sit the stateless query executor (`:112`) and the unique-constraint classifier (`:114-117`), the latter `TryAdd`ed so a host on another engine can register its own first and keep it.
  - **The Scrutor scan (`:125-129`)** discovers every [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientitytypeconfigurationbasetentity-tidentifiertype) in the Infrastructure assembly via `FromAssemblyOf<ClassReference>()` (`:126`) and registers each as its implemented interfaces, scoped to match the DbContext lifetime, closing the loop back to [`ClassReference`](#classreference-2). `AddCaching(configuration)` is called immediately after (`:131`).
  - **The auth block (`:145-172`)** binds [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), [`PasswordResetSettings`](group-08-auth.md#passwordresetsettings) and [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings) with their scoped services, and gates one hosted service: [`RefreshSessionCleanupService`](group-07-persistence-ef-core.md#refreshsessioncleanupservice) is registered only when `RefreshSessions:Enabled` is true (`:168-172`), on the same flag that maps the table. The comment names the failure it avoids (`:165-167`): an unconditional registration would start an hourly sweep in every service of a modular host, all but one of which has no table to sweep.
  - **Startup validation of the upcaster graph (`:185-190`)**: [`EventUpcasterStartupValidator`](group-14-module-system-composition.md#eventupcasterstartupvalidator) is an `IHostedService` added through `TryAddEnumerable`, so a duplicate source, a self-map or a cycle fails the host at start rather than dead-lettering the first retired-contract message ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)).
  - **The outbox is a transport decision (`:192-212`).** [`OutboxSignal`](group-04-events-outbox.md#outboxsignal) is always registered (`:192`). Then the message-bus section is read eagerly (`:200-201`), passed to the private `EnsureOutboxAvailableForProvider` guard (`:202`), and [`MessageBusSettings`](#messagebussettings)`.IsOutboxEnabled` decides between the two hosted outbox services ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) plus [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), `:204-208`) and a single [`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice) (`:211`). The comment states the trade in full (`:194-199`): a broker deployment cannot deliver without the outbox, while a single-process host would pay two hosted services, a table and a poll loop for a hop it never takes, and the `OutboxMessages` table stays mapped either way so flipping the flag is never a migration ([ADR-100](https://ivanball.github.io/docs/adr/100-outbox-opt-in-resolved-from-messaging-mode.html)). The operator surface [`OutboxAdministration`](group-04-events-outbox.md#outboxadministration) is scoped, because it creates one child scope per data source it visits (`:214-217`). The method ends by calling `AddServices()` (`:219`).
  - **`AddCaching` (`:229-304`)** does two probes in one method, and its `IConfiguration` parameter is optional. With configuration it binds the key-prefix options plus [`CacheSettings`](group-09-caching.md#cachesettings) and the Application layer's [`QueryCachePipelineSettings`](#querycachepipelinesettings) (`:242-255`); without it, both are registered bare so `IOptions<T>` still resolves to framework defaults instead of failing a host that called the parameterless overload (`:256-260`, with the reasoning at `:233-241`). The cache: if an `IDistributedCache` is registered and is not the no-op `MemoryDistributedCache` (`:265`), it builds [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) over it plus any `IConnectionMultiplexer`, the optional [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) and the TTL settings (`:267-276`); otherwise [`MemoryCacheService`](group-09-caching.md#memorycacheservice) (`:280`), where the keyspace is private to the process so no prefix is needed. The lock: [`RedisDistributedLock`](#redisdistributedlock) when a multiplexer resolves (`:290-295`), [`InProcessDistributedLock`](#inprocessdistributedlock) otherwise (`:298-300`). The comment explains why the lock is registered next to the cache at all (`:283-286`): its one in-framework caller, the API idempotency filter, pairs the two, since the lock guards the execute-then-store window the cache entry closes.
  - **`AddCommonHybridCache` (`:340-383`)** is the opt-in two-level cache ([ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)). It calls `AddHybridCache` (`:342`), then configures `HybridCacheOptions` **through the options pipeline** rather than the `AddHybridCache` callback (`:348-362`), because the TTL policy now comes from the bound `Cache` section and the callback has no service provider to read it from (`:344-347`); the host's own hook runs last so it can override anything the framework set (`:361`). It then deliberately does `RemoveAll<ICacheService>()` before `AddSingleton` (`:364-380`) so the call wins whether it runs before or after `AddInfrastructure`. The remarks are honest about the cost of that choice (`:328-333`): `RemoveAll` does not distinguish the framework's registration from a host's own custom `ICacheService`, so calling this is a statement that the two-level cache IS the cache.
  - **`AddScheduledJobs` (`:405-419`) and `AddScheduledJob<TJob>` (`:440-446`)** wire the recurring-job feature ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)). The first binds [`SchedulerSettings`](#schedulersettings) with validation (`:407-410`) and registers [`ScheduledJobRunner`](#scheduledjobrunner) via `TryAddEnumerable` rather than `AddHostedService` (`:412-416`), so a host or two modules calling it twice cannot run two runners racing for the same rows. The second registers one job scoped, both as the concrete type and into the accumulating `IEnumerable<IScheduledJob>` (`:443-444`); the doc spells out that the job is scoped because the runner resolves it in a fresh scope per execution and it must hold no state between runs (`:433-438`).
  - **`AddAuditTrail` (`:476-495`)** binds [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) (`:478-481`), registers the trail interceptor as a singleton for the same statelessness reason as the other three (`:483-485`), the scoped reader (`:487`), and, notably, `AddScheduledJob<AuditTrailCleanupJob>()` (`:492`). Registering the retention job here rather than in `AddScheduledJobs` keeps the two features independent, and the remarks state the operational consequence plainly (`:464-470`): without the scheduler the trail still records every change and nothing is ever purged, so `AuditTrail:RetentionDays` is inert.
  - **`AddMultiTenancy` (`:525-537`)** binds [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) and adds [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator) through `TryAddEnumerable` (`:532-534`). What it switches on is *resolution*, not isolation: the filter, the interceptor and `ITenantContext` are always present and inert until a tenant resolves (`:503-510`), and a `Tenancy:Tenants:{id}:DataSources:{sourceName}` override naming a source that does not exist fails startup rather than silently falling back to the shared database (`:516-523`).
  - **`AddServices` (`:543-588`)** registers the small services and encodes a subtle lifetime lesson: [`TokenService`](group-08-auth.md#tokenservice) is a **singleton** (`:562`) with a six-line comment explaining why (`:556-561`): a scoped lifetime disposed the RSA handle at end-of-request while IdentityModel's static `CryptoProviderCache` still held the cached signature provider wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. `[Rubric §11, Security]` (correct signing-key lifecycle). It also sets the default [`IEventBus`](group-04-events-outbox.md#ieventbus) to [`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus) (`:564`) and the default [`IMessageBus`](group-04-events-outbox.md#imessagebus) to [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) (`:570`), registers [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) unconditionally with the reasoning inline (`:549-553`), and wires the inert no-op defaults for push (`:574-575`), native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), `:577-580`) and file storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), `:582-585`) so hosts can call the opt-in methods unconditionally. The image processor beside the storage default is the exception: it is dependency-free, so it is always the real one (`:585`).
  - **The opt-in channels.** `AddPushNotifications` (`:629-650`) binds the settings (`:631-634`), adds SignalR (`:636`), adds the Redis backplane only when a `redis` connection string exists (`:638-642`), and replaces the null senders (`:645-646`). `AddNativePushNotifications` (`:662-682`) and `AddAzureBlobFileStorage` (`:694-722`) both re-read their section eagerly with `.Get<T>()` (`:667`, `:699`) because the decision whether to register at all has to be made at composition time, and both return early on an incomplete section (`:668-673`, `:700-710`), which is what makes an unconfigured environment a no-op instead of a startup crash. The absolute-URI check at `:705-706` is worth copying: an empty-string `ServiceUri` binds to a *relative* `Uri`, so only `{ IsAbsoluteUri: true }` counts.
  - **`AddBrokerMessaging` (`:746-813`)** is the extraction pivot. It reads [`MessageBusSettings`](#messagebussettings), falling back to `new MessageBusSettings()` when the section is absent (`:752-753`); on `InProcess` it returns immediately (`:755-758`), leaving the in-process bus in place; otherwise it re-runs the outbox guard (`:763`, with the comment at `:760-762`: a service host that wires the broker without the full infrastructure registration must still fail loudly), resolves the connection string (`:765`), calls `AddMassTransit` (`:767-781`) and then **`Replace`s** the scoped [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`:785`) and [`IEventBus`](group-04-events-outbox.md#ieventbus) with [`BrokerEventBus`](group-04-events-outbox.md#brokereventbus) (`:791`), the deliberate exception to the `TryAdd` rule, because the in-process bus must not run alongside the broker. Inside the MassTransit callback, a configured `EndpointPrefix` installs a `KebabCaseEndpointNameFormatter` carrying that prefix with `includeNamespace: false` (`:769-777`), because every service on a shared broker would otherwise derive the same queue name from the same consumer type and collide.
  - **The inbox branch (`:798-810`)** chooses the consumer-side dedup store from `settings.IsInboxEnabled`, the resolved posture rather than the raw flag (unset means ON for a broker, `Messaging/MessageBusSettings.cs:125`): [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) scoped when on (`:800`), and when off the singleton [`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore) **plus** an [`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice) hosted service (`:804-809`). That second registration is the whole point of the branch: a disabled dedup store looks exactly like an enabled one until a duplicate side effect reaches a customer, so the posture costs one startup Warning to make visible (`:806-808`).
  - **The four private helpers (`:853-1027`)** sit outside the extension block. `EnsureOutboxAvailableForProvider` (`:871-878`) throws when a broker transport is paired with an explicitly disabled outbox, and the message says why in operational terms (`:875-876`): the outbox is the only publish path a broker deployment has, so the alternative is every cross-service event vanishing while the service looks healthy. `ResolveBrokerConnectionString` (`:894-903`) applies an explicit precedence (`:880-889`): `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq` (what Aspire injects), then `ConnectionStrings:messaging`; without that fallback MassTransit would default to `localhost:5672` and never reach the Aspire-allocated container port. `ConfigureBrokerTransport` (`:933-1014`) does the per-transport wiring. `BuildRedeliveryIntervals` (`:1024-1027`) maps the configured seconds to `TimeSpan`s, dropping non-positive entries because a zero interval would schedule an immediate redelivery and turn the second retry level into a hot loop (`:1016-1023`). The first three carry a justified `IDE0051` suppression (`:867-870`, `:890-893`, `:929-932`) documenting a Roslyn false positive: the analyzer in SDK 10.0.201+ does not see references crossing the extension-block boundary.
  - **Two levels of retry, and one asymmetry between transports.** `[Rubric §29, Resilience & Business Continuity]`: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy driven by [`MessageBusSettings`](#messagebussettings) (`:961-965` for RabbitMQ, `:1000-1004` for Azure Service Bus). Above it sits second-level `UseDelayedRedelivery`, which reschedules a message through the broker over `RedeliveryIntervalsSeconds` (one minute, ten minutes, one hour by default) so an outage measured in hours does not dead-letter the event; it is registered *before* `UseMessageRetry` so the retry filter stays innermost and every immediate attempt is exhausted first (`:913-919`). The asymmetry is deliberate and documented (`:920-927`): Azure Service Bus schedules messages natively, so redelivery is applied **unconditionally** there (`:990-998`), while RabbitMQ needs the `rabbitmq_delayed_message_exchange` plugin that the Aspire development container does not ship, so it is gated behind `EnableDelayedRedelivery`, default false (`:948-959`).
  - **The emulator detour (`:973-988`).** On the Azure Service Bus branch, the host call is not unconditional: [`ServiceBusEmulatorSupport`](#servicebusemulatorsupport)`.IsEmulatorConnectionString` decides between `ConfigureEmulatorHost(cfg, connectionString, settings.EmulatorAdminEndpoint)` (`:979-983`) and the production `cfg.Host(connectionString)` (`:986`). The comment states the property that makes this safe (`:975-978`): the emulator token no real namespace emits is the only way in, so the production path is reached byte for byte as before ([ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html)).
  - **`AddTypedServiceClient` (`:833-850`)** wires a typed `HttpClient` to Aspire service discovery (`http://{serviceName}`, `:843-844`), attaches [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) (`:840`, `:845`) so the inbound bearer token flows downstream, and adds the standard Polly resilience handler (`:848`); the `S5332` suppression at `:842` documents the deliberate cleartext in-cluster address, and the doc notes gRPC is preferred for service-to-service contracts (`:822-826`).

- **Why it's built this way**: the `extension(IServiceCollection)` syntax keeps every Infrastructure registration in one file without a proliferation of static helper classes ([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)), and pushing all concrete choices into one composition root at the layer edge is what keeps Application and Domain free of framework references ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the database-per-service wiring, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the broker/extraction path). See the DI-sequence note in `MMCA.Common/CLAUDE.md`: hosts call `AddApplicationDecorators()` last so Scrutor can decorate handlers already registered, but the relative position of `AddInfrastructure` is not otherwise ordering-sensitive, and `AddCommonHybridCache` is explicitly documented as order-independent in both directions (`:320-327`).

- **Where it's used**: called from each service host's `Program.cs` (the reference apps and the extracted `MMCA.ADC.*` service hosts) after `AddApplication()`; the optional methods (`AddScheduledJobs`, `AddAuditTrail`, `AddMultiTenancy`, `AddCommonHybridCache`, `AddBrokerMessaging`, `AddPushNotifications`, `AddNativePushNotifications`, `AddAzureBlobFileStorage`) are added by the specific hosts that need those capabilities. `AddScheduledJobsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:15`) pins the double-registration behavior of the scheduler pair.

- **Caveats / not-in-source**: the exact set of consuming `Program.cs` files is in the downstream apps (MMCA.ADC / MMCA.Store / MMCA.Helpdesk), not in this repository, so the precise call sites are Not determinable from source here.

### JobClaim
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:446` · Level 0 · record (private nested, sealed)

- **What it is**: the result of one attempt to claim a due job row: which row was due, the occurrence it was due at, the cron expression to compute the next occurrence from, and the claim token, which is null when a different replica won the row.

- **Depends on**: nothing first-party. BCL only (`string`, `DateTime`, `Guid?`). It exists solely as the return shape of [`ScheduledJobRunner`](#scheduledjobrunner)`.TryClaimNextDueAsync`.

- **Concept introduced, three answers in one return value.** A claim attempt has three outcomes, not two: nothing was due, something was due and this replica took it, or something was due and another replica took it first. `[Rubric §15, Best Practices & Code Quality]` assesses whether the code makes illegal states hard to express: the method returns `JobClaim?`, so `null` is "nothing due" and a non-null instance with a null `LockToken` is "lost the race" (`ScheduledJobRunner.cs:397-400`). Collapsing the latter two into one `null` would have cost the caller the ability to mark that name as attempted for this cycle and move on, which is exactly what stops the loop spinning on a row this replica will never own (`ScheduledJobRunner.cs:381-390`). A positional record gets that shape in one line with value equality and no mutable state.

- **Walkthrough**: four positional members, each documented (`ScheduledJobRunner.cs:441-446`): `JobName`, `DueOn` (the occurrence the row was due at, used for the lag metric), `CronExpression` (what the next occurrence is computed from, read from the row rather than recomputed from settings so an in-flight schedule change cannot retarget a run in progress), and `Guid? LockToken`. It is constructed once, at `ScheduledJobRunner.cs:438`, where the token is passed as `claimed == 0 ? null : lockToken`: the count of rows the claiming `ExecuteUpdateAsync` actually matched IS the race result.

- **Why it's built this way**: `private sealed record` keeps a purely internal carrier invisible to the package's public surface, so it costs nothing in API compatibility terms while still giving the claim path a named, immutable shape ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: returned by `TryClaimNextDueAsync` (`ScheduledJobRunner.cs:401-439`) and consumed by `RunDueJobsAsync` (`ScheduledJobRunner.cs:364-392`).

---

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:10` · Level 0 · class (internal static)

- **What it is**: the pure helper that builds the two platform-native JSON payloads Azure Notification Hubs forwards (FCM v1 for Android, APNs for iOS) and the `user:{id}` tag expressions a user-targeted send is addressed to (`NativePushPayloads.cs:10`). It holds no state and touches no hub client, which is exactly why the payload shapes and the 20-tag chunking rule can be asserted in a unit test.

- **Depends on**: `System.Text.Json` for serialization, `System.Globalization.CultureInfo` for the tag rendering, and the solution-wide `UserIdentifierType` alias. No first-party service types at all.

- **Concept introduced, the third notification channel's wire contract.** `[Rubric §9, API and Contract Design]` assesses whether the shape of a message crossing a boundary is defined in one place rather than assembled ad hoc at each call site, and `[Rubric §14, Testability]` assesses whether the parts worth testing can be tested without their infrastructure. The framework already carries a durable per-user notification inbox and a transient SignalR push; native OS-level delivery ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) is the third, and it is the only one whose payload is dictated by an external vendor. FCM v1 wants a `message` envelope with a `notification` block; APNs wants a reserved `aps` block with an `alert` inside it and any application data as sibling top-level keys. Those two shapes are the whole contract, so they live here as two string-returning functions rather than inside the sender that calls a hub client.

- **Walkthrough**
  - `MaxTagsPerExpression` is the constant `20` (`NativePushPayloads.cs:13`), and the doc above it names the reason: the hub caps a tag expression at 20 tags, so a larger audience must be chunked rather than sent as one expression.
  - `BuildFcmV1Payload(title, body, metadata)` (`NativePushPayloads.cs:16-28`) builds `notification` from the title and body, attaches `data` only when the metadata dictionary is non-empty (`:22-25`), and serializes the whole thing under a `message` root (`:27`).
  - `BuildApnsPayload(title, body, metadata)` (`NativePushPayloads.cs:31-53`) builds the `aps.alert` block, then lifts each metadata pair to a **top-level** custom key, which is where APNs expects application data. The guard at `:44-48` is the interesting line: a metadata key literally named `aps` is skipped, because writing it would clobber the alert block and produce a notification the device shows as nothing.
  - `BuildUserTagExpressions(userIds)` (`NativePushPayloads.cs:59-63`) is a three-step LINQ pipeline: map each id to its tag, `Chunk` by `MaxTagsPerExpression`, and join each chunk with ` || `. One expression per chunk, each an OR over at most 20 user tags.
  - `UserTag(userId)` (`NativePushPayloads.cs:66-67`) renders `user:{id}` with `CultureInfo.InvariantCulture` through `string.Create`. Invariant formatting is not cosmetic here: the tag stamped on an installation at registration time and the tag used to target a send at delivery time must be byte-identical, and a numeric identifier formatted under a culture with digit grouping would not be.

- **Why it's built this way**: the class doc states the intent directly (`NativePushPayloads.cs:5-9`). Keeping this pure means the vendor payload shapes are covered by fast tests that need no notification hub, no credentials, and no network, which matters for a channel that is inert by default in every environment a developer runs locally.

- **Where it's used**: only by the two Azure implementations in this group. [AzureNotificationHubNativePushSender](#azurenotificationhubnativepushsender) calls all three build members (`AzureNotificationHubNativePushSender.cs:21-24`, `:36-37`), and [AzureNotificationHubDeviceRegistrar](#azurenotificationhubdeviceregistrar) calls `UserTag` both when stamping an installation (`AzureNotificationHubDeviceRegistrar.cs:41`) and when verifying ownership before a delete (`:92`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Notifications/Push/NativePushPayloadsTests.cs`.

- **Caveats / not-in-source**: the type is `internal`, so the payload shapes are not part of the package's public surface and a consumer cannot compose against them. That is deliberate for a vendor-dictated format, but it does mean a host wanting a different payload shape replaces [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) wholesale rather than reusing this.

---

### NativePushSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the `NativePush` section for OS-level push delivery through Azure Notification Hubs: an on/off flag, the hub connection string, and the hub name.

- **Depends on**: nothing first-party; its values feed `Microsoft.Azure.NotificationHubs.NotificationHubClient`.

- **Concept**: the same ship-inert, enable-by-configuration shape taught under [FileStorageSettings](#filestoragesettings), with a concrete operational reason attached. `[Rubric §17, DevOps]` assesses whether deployment and enablement can be sequenced independently: the XML doc records that a hub is provisioned with `Enabled` false until the FCM v1 service account and APNs auth key are uploaded to it (`NativePushSettings.cs:3-8`), so infrastructure lands before credentials do and neither step blocks a release. `[Rubric §29, Resilience]`: the disabled path leaves the framework's default sender in place rather than failing startup, so a missing credential degrades the channel instead of the host.

- **Walkthrough**: `SectionName = "NativePush"` (`NativePushSettings.cs:12`); `Enabled` (`:15`); nullable `ConnectionString`, documented as a Listen+Send+Manage rule (`:18`); nullable `HubName` (`:21`).
  - `AddNativePushNotifications` binds the options (`DependencyInjection.cs:664-665`), then re-reads the section eagerly and returns early unless all three values are present, using a property pattern so an unbound section and a disabled one take the same exit (`:653-659`).
  - Only then does it register the hub client from the connection string and hub name (`:661-663`) and swap [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) and [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) to their Azure implementations (`:664-665`), among them [AzureNotificationHubNativePushSender](group-14-module-system-composition.md#azurenotificationhubnativepushsender).

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) chose a configuration-gated channel precisely so hosts can register it unconditionally.

- **Where it's used**: `AddNativePushNotifications` (`DependencyInjection.cs:662-682`).

---

### PeriodicBackgroundService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/PeriodicBackgroundService.cs:20` · Level 0 · class (public abstract partial)

- **What it is**: the base class for fixed-interval background sweeps. It contributes four things a hand-written `BackgroundService` loop usually gets wrong: an enablement gate evaluated once at startup, a startup delay so the host finishes initializing first, a loop whose cycle failures are logged without killing the loop, and every wait routed through an injected `TimeProvider` so a test can drive it with a fake clock (`PeriodicBackgroundService.cs:20-94`).

- **Depends on**: `Microsoft.Extensions.Hosting.BackgroundService` as the base, `TimeProvider` and `ILogger` as its two primary-constructor parameters (`PeriodicBackgroundService.cs:20-22`), and the `LoggerMessage` source generator for its two log methods (`:89-93`), which is what makes the class `partial`.

- **Concept introduced, the template method with an injected clock.** `[Rubric §2, Design Patterns]` assesses whether a pattern is used where it carries its weight, and this is a textbook template method: the base owns the invariant algorithm (gate, delay, loop, catch, wait) and the subclass supplies only the variable parts through `Interval`, `IsEnabled`, `StartupDelay`, and `ExecuteCycleAsync`. `[Rubric §29, Resilience and Business Continuity]` assesses whether a background component survives its own failures: the `catch` at `:73-76` is the whole answer, because an unhandled exception inside `ExecuteAsync` silently ends a hosted service for the lifetime of the process, and a reconciliation sweep that stops running is a failure nobody notices until the data is wrong. `[Rubric §14, Testability]` assesses whether time-dependent code can be tested without waiting: `Task.Delay(..., timeProvider, ...)` (`:55`, `:80`) means a `FakeTimeProvider` advances the loop instantly, which is exactly what the tests do (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/PeriodicBackgroundServiceTests.cs:23`, `:66`).

- **Walkthrough**
  - `Interval` is abstract (`PeriodicBackgroundService.cs:25`): every subclass must state its own cadence, and nothing defaults it.
  - `StartupDelay` is virtual with a 15 second default (`PeriodicBackgroundService.cs:31`). The doc says why it exists: let the application finish initializing before background work competes with it. Tests override it to shorten the wait (`PeriodicBackgroundServiceTests.cs:117`).
  - `IsEnabled` is virtual and defaults to `true` (`PeriodicBackgroundService.cs:38`). It is read **once**, at the top of `ExecuteAsync`, and a `false` logs and returns (`:47-51`), so the service occupies no thread and no timer for the rest of the process. Flipping the toggle at runtime does not restart it.
  - `ExecuteCycleAsync(stoppingToken)` is the abstract single sweep (`PeriodicBackgroundService.cs:42`), and its contract is stated in the doc comment: exceptions are logged and do not stop the loop.
  - `ExecuteAsync` (`PeriodicBackgroundService.cs:45-87`) is the algorithm. The startup delay is wrapped in its own `try` whose `catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)` returns cleanly (`:57-60`), so a host stopped during the delay does not log a shutdown as an error. The loop then runs until cancellation (`:62`), awaiting the cycle, breaking on a shutdown cancellation (`:68-72`), logging any other exception (`:73-76`), and waiting the interval under the same cancellation-aware guard (`:78-85`).
  - The two `[LoggerMessage]` methods (`PeriodicBackgroundService.cs:89-93`) are source-generated: `LogDisabled` at Information, `LogCycleError` at Error with the exception attached and a message that states the recovery ("it will retry on the next interval"). Both stamp `GetType().Name`, so the log line names the concrete sweep, not the base class.

- **Why it's built this way**: the class doc draws the boundary explicitly (`PeriodicBackgroundService.cs:12-16`): this is for periodic reconciliation and cleanup work, and it is deliberately **not** what the outbox processor uses, because the outbox's signal-driven smart wait does not fit a fixed interval. The background-work posture is [ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html), and a fixed-interval sweep is a different thing again from the cron-style recurring scheduler of [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html), which is why this base stays as small as it is.

- **Where it's used**: no production type in MMCA.Common or MMCA.ADC derives from it today. [ScheduledJobRunner](#scheduledjobrunner) is the closest relative and deliberately is **not** a subclass: it derives `BackgroundService` directly and only names this class in a doc comment, to record that its own 15 second startup delay matches this one (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:64-68`). The base is exercised directly by a `CountingSweep` test double that overrides all four extension points (`PeriodicBackgroundServiceTests.cs:103-121`).

- **Caveats / not-in-source**: nothing in this base coordinates two replicas running the same sweep, so any subclass owns that question itself. Contrast [ScheduledJobRunner](#scheduledjobrunner), which answers it with a database claim lease rather than by inheriting one.

---

### ScheduledJobEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20` · Level 0 · class (sealed)

- **What it is**: the persisted schedule and last-run record for one registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob): one row per job name, upserted by [`ScheduledJobRunner`](#scheduledjobrunner) on every cycle. It carries both the schedule (expression, next occurrence) and the claim lease that makes a multi-replica host safe.

- **Depends on**: nothing first-party and nothing beyond `string`, `DateTime` and `Guid` from the BCL, which is why it is Level 0.

- **Concept introduced, the framework bookkeeping entity.** `[Rubric §4, DDD]` assesses whether the domain model stays a model of the business: this class is deliberately **not** an `IAuditableEntity` and not an aggregate root, exactly like [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), because it is framework bookkeeping rather than domain state (`ScheduledJobEntry.cs:8-14`). The consequences are concrete: no soft-delete flag, so no global query filter applies to it; no audit stamps, so the save interceptors have nothing to write (which is why the runner can call a plain `SaveChangesAsync` with no user id, `ScheduledJobRunner.cs:313-318`); and no concurrency token, because its concurrency control is the explicit claim lease instead. `[Rubric §8, Data Architecture]`: the table is **host-scoped** and lives in the `Default` data source only, unlike the outbox, which exists once per physical source (`ScheduledJobEntry.cs:15-18`). Jobs belong to a host, not to a database. `[Rubric §11, Security]` by omission: it also carries no user data, which is what keeps it in the audit trail's framework-entity exclusion set alongside the outbox and inbox rows (`Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:113-119`, this type at `:118`).

- **Walkthrough**, in the order the runner touches them:
  - `JobName` (`ScheduledJobEntry.cs:26`), `required` and `init`-only: the primary key, matching `IScheduledJob.Name`, so a job has exactly one schedule row per host.
  - `CronExpression` (`ScheduledJobEntry.cs:34`), `required` with a setter: the five-field UTC expression currently in force, which is either the job's code default or the `Scheduler:Jobs:{Name}:Cron` override. The runner compares it against the resolved expression every cycle and recomputes the next occurrence only when it changed.
  - `NextRunOn` (`ScheduledJobEntry.cs:40`): the UTC instant the job next becomes due. A row whose expression cannot be parsed is parked at `DateTime.MaxValue` so it is never claimed, which is how one bad cron string in configuration fails just that job.
  - `LastRunOn` (`:43`), `LastOutcome` (`:50`, one of `Succeeded`, `Failed`, `Skipped`), `LastError` (`:57`, truncated to the column width and cleared on success so the column always describes the LAST outcome rather than the last failure ever seen), and `LastDurationMs` (`:60`): the operator-facing run record.
  - `LockedUntil` (`:67`) and `LockToken` (`:74`): the claim lease. Other replicas skip a row with an unexpired lease, so an occurrence runs once even with several replicas polling; the claiming replica stamps its outcome only on a row still carrying its own token, so a replica whose lease expired mid-execution cannot overwrite the record of the replica that took over.

- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) chose to apply the outbox's proven claim-lease idiom to cron rather than adopt Hangfire or Quartz.NET, so the row shape is deliberately the minimum that idiom needs: a due time, a lease, and a token.

- **Where it's used**: mapped by [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext)`.ConfigureScheduler` (`Persistence/DbContexts/ApplicationDbContext.cs:594-619`), which is **gated**: the entity is mapped only when the host set `Scheduler:Enabled` and this context targets the `Default` source (`ApplicationDbContext.cs:586-599`, the guard itself at `:596-599`), so a host that never opted in keeps exactly the model, and the migrations, it had before the scheduler shipped, and Cosmos DB never reaches the method at all (`ApplicationDbContext.cs:591-592`). The mapping sets `ToTable("ScheduledJobs", "dbo")` (`:603`), the `JobName` key (`:604`), column widths matching the entity's documented truncation (`:605-608`), and one index on `NextRunOn` with the two lease columns as included columns (`:615-617`), deliberately NOT filtered to unlocked rows, because the poll must also find rows whose lease has expired (that is how a dead replica's work is reclaimed, `ApplicationDbContext.cs:610-614`). Every read and write of the row lives in [`ScheduledJobRunner`](#scheduledjobrunner).

---

### ScheduledJobOverrideSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerSettings.cs:66` · Level 0 · class (sealed)

- **What it is**: one entry under `Scheduler:Jobs:{Name}`, the per-job override that lets a deployment retime a recurring job without touching code. Today it carries exactly one member, the cron expression.

- **Depends on**: nothing. It is the value type of [SchedulerSettings](#schedulersettings)`.Jobs` (`SchedulerSettings.cs:60`) and is read by [ScheduledJobRunner](#scheduledjobrunner).

- **Concept introduced, code default plus configuration override.** An [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob) ships with a `CronExpression` compiled into it, which is the right default because the job's author knows what cadence the work needs. An operator who has to change that cadence for one environment should not need a release. `[Rubric §17, DevOps]` assesses whether operational behavior can be changed without a code change; this pair is the minimal answer: an absent entry leaves the compiled-in schedule in force, and a present, non-blank `Cron` replaces it (`SchedulerSettings.cs:54-59`, `:68-73`). `[Rubric §15, Best Practices & Code Quality]`: the override is keyed by `IScheduledJob.Name`, the job's own stable identity, so configuration and code agree on one name rather than on a class name that refactoring would break.

- **Walkthrough**: a single `string? Cron { get; init; }` (`SchedulerSettings.cs:74`). The whole mechanism lives in the reader, not in this type: `ScheduledJobRunner.ResolveCronExpression` looks the job up by name and takes the override only when it is present AND non-blank, otherwise the job's own expression (`ScheduledJobRunner.cs:161-165`). Blank-means-absent matters, because a JSON key set to `""` is a common way to try to clear a value and would otherwise produce an unparseable schedule.

- **Why it's built this way**: the runner treats a changed expression as a schedule rewrite. On each cycle it reads the stored expressions (`ScheduledJobRunner.cs:266-272`), leaves a row untouched when the resolved expression matches (recomputing every cycle would push the next occurrence forward forever and nothing would ever fire, `:279-285`), and otherwise recomputes the next occurrence from the current instant and either updates the row with a schedule-changed log (`:293-298`) or inserts a new one (`:299-310`). So an operator edit is picked up on the next cycle, with no restart, which is what makes the override useful in the first place ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: [ScheduledJobRunner](#scheduledjobrunner) only, through `SchedulerSettings.Jobs`.

- **Caveats**: an override that does not parse is not rejected at startup, unlike the range-checked scalar settings in this namespace. The runner logs the parse failure (`ScheduledJobRunner.cs:286-290`, message at `:569-570`) and records the job with the skipped outcome and a `DateTime.MaxValue` next run (`:301-308`), so a bad cron string is an observable non-run rather than a failed boot.

---

### SchedulerMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument set for the recurring job scheduler: one meter carrying a run counter, an execution-duration histogram, and a schedule-lag histogram, all emitted by [`ScheduledJobRunner`](#scheduledjobrunner).

- **Depends on**: `System.Diagnostics.Metrics` (BCL) only (`SchedulerMetrics.cs:1`). Nothing first-party.

- **Concept introduced, the one-meter-per-feature instrument holder.** `[Rubric §13, Observability & Operability]` assesses whether a running system can be understood from outside: a background loop is invisible by construction (no request, no response code), so the only evidence that a schedule is healthy is telemetry. The three instruments here are chosen to answer the three operator questions: is it running, how long does it take, and is it on time. `[Rubric §31, Cost/FinOps]` shows up in the same design: the per-occurrence start and finish lines are logged at `Debug` rather than `Information` precisely because a busy schedule would otherwise double the runner's steady-state log volume (`ScheduledJobRunner.cs:577-584`), and the numbers an operator alerts on come from these metrics instead. A host exports them by registering the `MeterName` meter; the Aspire service defaults (`ConfigureOpenTelemetry`) already do (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:202`), and the doc records that the name is duplicated as a literal there because that package has no reference to Infrastructure (`SchedulerMetrics.cs:5-14`).

- **Walkthrough**:
  - `MeterName = "MMCA.Common.Scheduler"` (`SchedulerMetrics.cs:19`) and the single static `Meter` built from it (`:21`). The class doc is explicit that one meter serves every scheduler instrument and that a second `Meter` with this name must never be created (`SchedulerMetrics.cs:11-14`), since duplicate meters are a classic source of double-counted telemetry. [`BrokerMetrics`](#brokermetrics) repeats the same shape for the broker transport.
  - `RunCounter` (`SchedulerMetrics.cs:28-31`), `scheduler.job.runs`, unit `runs`, tagged by `job` and `outcome`: the failure rate of a schedule is this counter split by outcome.
  - `DurationHistogram` (`:39-42`), `scheduler.job.duration` in **seconds**, tagged by `job`, measured around the job's own `ExecuteAsync` only so it excludes claim and bookkeeping cost. Its stated purpose is the lease relationship: a job whose duration approaches `Scheduler:LeaseSeconds` is about to lose its claim mid-run (`SchedulerMetrics.cs:33-38`).
  - `LagHistogram` (`:50-53`), `scheduler.job.lag` in seconds, the interval between an occurrence becoming due and actually starting. It is floored at zero, and a value near the polling interval is normal for an occurrence that landed just after a cycle (`SchedulerMetrics.cs:44-49`).

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the runner records without resolving anything from DI, and keeping the meter name a constant on the same type is what lets a test assert against it. `SchedulerMetricsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerMetricsTests.cs:13`) pins the instrument surface.

- **Where it's used**: [`ScheduledJobRunner`](#scheduledjobrunner)`.ExecuteClaimedJobAsync` records the lag before invoking the job (`ScheduledJobRunner.cs:463-466`) and the duration plus the outcome-tagged count after it returns (`ScheduledJobRunner.cs:470-473`).

---

### AzureNotificationHubNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/AzureNotificationHubNativePushSender.cs:14` · Level 1 · class (public sealed partial)

- **What it is**: the real implementation of [INativePushSender](group-07-persistence-ef-core.md#inativepushsender), sending both the FCM v1 and the APNs payload for every notification through an Azure Notification Hubs client, either to a set of users (resolved by tag) or to every installation (`AzureNotificationHubNativePushSender.cs:14-44`).

- **Depends on**: `Microsoft.Azure.NotificationHubs.INotificationHubClient` and `ILogger<T>` as its two primary-constructor parameters (`AzureNotificationHubNativePushSender.cs:14-16`), [NativePushPayloads](#nativepushpayloads) for the payload and tag construction, and [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) as the contract.

- **Concept introduced, one logical notification, two platform sends.** `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses whether a capability that varies by platform is normalized behind one application-facing call. A caller says "notify these users, with this title and body"; it does not know or care which of them are on iOS. This class turns that into two hub calls per audience chunk, one per platform, and the hub decides which installations each applies to. `[Rubric §29, Resilience and Business Continuity]` applies through the delivery posture named in the class doc: native delivery is **best effort**, and the calling handler wraps it in a non-fatal catch, which is the side-effect contract of [ADR-096](https://ivanball.github.io/docs/adr/096-best-effort-side-effects.html). A push that fails does not fail the command that triggered it.

- **Walkthrough**
  - `SendToUsersAsync` (`AzureNotificationHubNativePushSender.cs:19-31`) builds each payload **once** (`:21-22`), then loops the tag expressions produced by [NativePushPayloads](#nativepushpayloads) (`:24`), awaiting an `FcmV1Notification` send and an `AppleNotification` send per chunk (`:26-27`). For an audience of 45 users that is 3 chunks and 6 hub calls, and the payload serialization happened twice in total, not twelve times.
  - `BroadcastAsync` (`AzureNotificationHubNativePushSender.cs:34-40`) is the untagged form: the same two notification types, built inline, with no tag expression, so the hub fans out to every installation it holds (`:36-37`).
  - Both paths end with the same source-generated Information log carrying the title (`AzureNotificationHubNativePushSender.cs:30`, `:39`, declared at `:42-43`). The wording is precise: the notification was *handed to* the hub. Actual delivery to a device is asynchronous and outside this process.
  - Every await uses `ConfigureAwait(false)`, which is the library policy of [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html).

- **Why it's built this way**: sending the two payloads unconditionally rather than looking up each user's platform keeps the sender free of any device registry of its own. The hub already knows each installation's platform from the registration written by [AzureNotificationHubDeviceRegistrar](#azurenotificationhubdeviceregistrar), so a payload that does not apply to a given installation is simply not delivered to it. That is the division of labour [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) records: the hub is the device registry, and this codebase stores no push tokens.

- **Where it's used**: registered only by `AddNativePushNotifications(configuration)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:662-682`), and only when the `NativePush` section is present with `Enabled: true`, a connection string, and a hub name (`:667-673`); the hub client itself is built from the connection string in the same call (`:675-677`) and this sender replaces the inert default at `:678`. MMCA.ADC's Notification module makes that call unconditionally (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:36`), so the channel is switched on by configuration alone. The consuming application code is [SendPushNotificationHandler](group-10-notifications.md#sendpushnotificationhandler) (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:31`, `:151`), where the best-effort catch lives.

- **Caveats / not-in-source**: there is no dedicated unit test file for this class under `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Notifications/Push/`; the logic it owns beyond the hub calls (payload shapes, tag chunking) is tested through [NativePushPayloads](#nativepushpayloads). Whether a given deployment has working platform credentials is a provisioning question, not determinable from source.

---

### NullNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullNativePushSender.cs:10` · Level 1 · class (public sealed)

- **What it is**: the inert default for [INativePushSender](group-07-persistence-ef-core.md#inativepushsender). Both members return `Task.CompletedTask` and do nothing else (`NullNativePushSender.cs:13-18`).

- **Depends on**: [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) only.

- **Concept introduced, the null-object default for an optional channel.** `[Rubric §1, SOLID]` assesses whether callers depend on abstractions rather than on the presence of a configured backend, and `[Rubric §15, Best Practices & Code Quality]` assesses whether the "not configured" case costs conditional code at every call site. The alternative to this class is an `INativePushSender?` that every handler null-checks, or a host that throws at resolution time when no hub is configured. Both push a deployment concern into application code. Registering a do-nothing implementation as the default means the third channel **always resolves**, the send handler is written once with no branch, and enabling native push in an environment is purely a configuration change. The same posture appears in [NullFileStorageService](#nullfilestorageservice), [NullPushDeviceRegistrar](#nullpushdeviceregistrar), and, outside this group, [NullPushNotificationSender](group-10-notifications.md#nullpushnotificationsender).

- **Walkthrough**: `SendToUsersAsync` (`NullNativePushSender.cs:13-14`) and `BroadcastAsync` (`:17-18`) are expression-bodied returns of `Task.CompletedTask`. There is no logging, deliberately: a per-notification "push was skipped" line in a host that never intends to enable the channel is noise, not signal.

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) records that the framework pipeline ships inert by default and each consumer switches it on by provisioning a hub. This class is that decision expressed in code, and the DI comment says so in one line (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:577`).

- **Where it's used**: registered by `AddInfrastructure` through `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:579`), immediately alongside [NullPushDeviceRegistrar](#nullpushdeviceregistrar) (`:580`). `AddNativePushNotifications` uses plain `AddTransient` for the Azure pair (`:678-679`), so the later registration wins and replaces this one.

- **Caveats / not-in-source**: because the swap is "last registration wins" rather than a removal, both descriptors remain in the collection when native push is enabled. Anything resolving `IEnumerable<INativePushSender>` would see the no-op as well as the real sender; no first-party code does.

---

### PushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:8` · Level 1 · class (sealed)

- **What it is**: the `PushNotifications` section: the on switch, the SignalR hub path, and the
  regular expression a channel key must match before a client may join or leave a channel
  (`PushNotificationSettings.cs:5-29`).

- **Depends on**: `NotificationScopeKey` from `MMCA.Common.Shared.Notifications` (`:1`), for the
  `Pattern` constant that supplies the default. See
  [NotificationScopeKey](group-10-notifications.md#notificationscopekey). No externals, and notably
  no data annotations: nothing here has a range or a length to enforce.

- **Concept introduced: allow-listing client-supplied group names.** `[Rubric §11, Security]` and
  `[Rubric §26, Front-End Security]` both apply. A hub method that takes a channel key and calls
  `Groups.AddToGroupAsync` is joining a SignalR group named by the CLIENT. With no constraint, a
  caller could join any group the server publishes to and receive another event's or another
  session's traffic. `ChannelKeyPattern` is that constraint (`PushNotificationSettings.cs:19-29`).

  `[Rubric §15, Best Practices & Code Quality]` shows up in where the default comes from. The property does not
  hard-code a regex: it defaults to `NotificationScopeKey.Pattern`
  (`PushNotificationSettings.cs:29`, the constant `"^(event|session):[0-9]+$"` at
  `NotificationScopeKey.cs:32`), the SAME constant the producers `NotificationScopeKey.ForEvent` and
  `ForSession` format against (`NotificationScopeKey.cs:37`, `:43`). Producer and guard therefore
  cannot drift apart by editing one of them; a host that overrides the pattern from configuration
  takes that alignment on itself, which the doc says outright (`:22-27`).

- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "PushNotifications"` (`PushNotificationSettings.cs:11`).
  - `Enabled` (`:14`): plain `bool`, default `false`.
  - `HubPath` (`:17`): defaults to `"/hubs/notifications"`.
  - `ChannelKeyPattern` (`:29`). Enforcement lives in
    [NotificationHub](group-10-notifications.md#notificationhub): `EnsureValidChannelKey` pulls a
    `Regex` out of a static `ConcurrentDictionary` cache keyed on the pattern string
    (`NotificationHub.cs:71-73`) and throws `HubException("Invalid channel key.")` on an empty or
    non-matching key (`NotificationHub.cs:75-78`); both `JoinChannelAsync` (`:46`) and
    `LeaveChannelAsync` (`:62`) call it before touching `Groups`. The compiled regex carries a
    one-second match timeout (`NotificationHub.cs:31`, `:73`), so a pathological configured pattern
    cannot hang the connection, and the cache means join and leave do not recompile per call
    (`NotificationHub.cs:33-34`).

- **Why it's built this way**: a configurable pattern rather than a hard-coded one lets each
  application define its own channel taxonomy without forking the hub, while the shipped default is
  restrictive rather than permissive. Sourcing that default from the producer's own constant is the
  cheaper half of the same idea: the safe configuration is also the zero-configuration one.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddPushNotifications` (`DependencyInjection.cs:617-620`), which then registers SignalR (`:622`),
  adds the Redis backplane when a `redis` connection string is present (`:624-628`), and replaces
  the null implementations with
  [SignalRPushNotificationSender](group-10-notifications.md#signalrpushnotificationsender) and
  [SignalRLiveChannelPublisher](group-10-notifications.md#signalrlivechannelpublisher)
  (`:631-632`). The settings object itself is injected as `IOptions<PushNotificationSettings>` and
  read only by [NotificationHub](group-10-notifications.md#notificationhub)
  (`NotificationHub.cs:72`). The default is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:347-348` and an
  override by `:352`, `:357`.

- **Caveats**: this class stands alone. There is no `IPushNotificationSettings` abstraction in the
  current source, so a consumer that wants the values takes the concrete options type.

---

### SchedulerSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `Scheduler` section for the recurring-job runner: the on switch, the fallback
  poll interval, the row-claim lease, which engine holds the `ScheduledJobs` table, and a per-job
  cron override map. Every property has a default, so a host that opts in needs only
  `Scheduler:Enabled` (`SchedulerSettings.cs:6-9`).

- **Depends on**: [DataSource](group-07-persistence-ef-core.md#datasource), the engine enum, imported
  from `MMCA.Common.Application.Interfaces.Infrastructure` (`SchedulerSettings.cs:2`, `:52`), and
  [ScheduledJobOverrideSettings](#scheduledjoboverridesettings), the one-property class declared at
  the bottom of the same file (`:66-75`). Externals:
  `System.ComponentModel.DataAnnotations` for `[Range]` (`:1`).

- **Concept introduced: one setting that gates both the behavior and the schema.** Most feature flags
  gate behavior. `Enabled` also decides whether the `ScheduledJobs` table is mapped into the EF model
  at all: [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) reads
  `IOptions<SchedulerSettings>` with `GetService` (not `GetRequiredService`) so an absent
  registration reads as disabled rather than failing every context construction, then additionally
  requires the physical source to be the default one
  (`ApplicationDbContext.cs:283-288`). The consequence is the one worth learning: a host that leaves
  the flag false has exactly the model it had before the scheduler shipped, so its migrations never
  see the table (`SchedulerSettings.cs:10-15`).

  `[Rubric §15, Best Practices & Code Quality]` assesses whether adopting a framework feature is additive. Because
  registration and activation are separate (`AddScheduledJobs` binds and registers the runner, but
  the runner returns immediately unless `Enabled` is true, `ScheduledJobRunner.cs:76`), a host can
  ship the registration and turn the scheduler on per environment
  (`DependencyInjection.cs:385-389`).

  `[Rubric §29, Resilience and Business Continuity]` assesses safe behavior under replication.
  `LeaseSeconds` is what makes multiple replicas safe: a replica claims a job row for that many
  seconds and other replicas skip claimed rows, so no occurrence runs twice; if the claiming replica
  dies mid-execution, the row becomes claimable again once the lease expires
  (`SchedulerSettings.cs:36-43`, applied at `ScheduledJobRunner.cs:423`).

  `[Rubric §31, Cost and FinOps]` assesses idle-cost defaults. `PollingIntervalSeconds` is a BOUND on
  the smart wait, not a hot loop: the runner normally sleeps until the earliest due job and uses this
  value only to cap that sleep and to notice a configuration-driven schedule change
  (`SchedulerSettings.cs:28-34`, `ScheduledJobRunner.cs:112-115`).

- **Walkthrough**: one static field, four `init` properties and one get-only dictionary.
  - `SectionName = "Scheduler"` (`SchedulerSettings.cs:19`).
  - `Enabled` (`:26`): default `false`, documented as the deliberate posture that adopting the
    framework must never add a table or a background loop to a host that did not ask for one.
  - `PollingIntervalSeconds` (`:34`): `[Range(1, 3600)]` (`:33`), default `30`.
  - `LeaseSeconds` (`:43`): `[Range(10, 3600)]` (`:42`), default `300`, documented as needing to sit
    comfortably above the longest expected job duration.
  - `DataSource` (`:52`): default `DataSource.SQLServer`. Jobs are host-scoped, so there is exactly
    one `ScheduledJobs` table per host rather than one per source, and this only names the relational
    engine that table lives on; Cosmos DB is not a valid value (`:45-51`). The runner resolves it
    against `DataSourceKey.DefaultName` (`ScheduledJobRunner.cs:215`).
  - `Jobs` (`:60`): a get-only `Dictionary<string, ScheduledJobOverrideSettings>` keyed by
    [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob)`.Name` and bound from
    `Scheduler:Jobs:{Name}`. `ResolveCronExpression` takes the override only when the entry exists
    AND its `Cron` is non-blank, otherwise the job's compiled-in expression stands
    (`ScheduledJobRunner.cs:161-165`). A changed expression is picked up on the next cycle: the
    runner compares the resolved expression against the stored one, leaves an unchanged row alone
    (recomputing it every cycle would push every schedule forward and nothing would ever fire), and
    otherwise rewrites the stored value and recomputes the next occurrence from the current instant
    (`ScheduledJobRunner.cs:275-297`).

- **Why it's built this way**: a persistent, database-backed cron scheduler with per-row leases is the
  decision recorded in
  [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html); everything in this
  class is the operator-facing surface of it. Defaulting every property makes the section optional,
  which is the same fail-soft-on-absence, fail-fast-on-bad-value posture
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes:
  the `[Range]` guards run under `ValidateOnStart`, so a bad value fails the boot rather than the
  first cycle.

- **Where it's used**: bound with validation in `AddScheduledJobs`
  (`DependencyInjection.cs:393-396`), which registers the runner through
  `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` rather than
  `AddHostedService`, precisely so two calls cannot start two runners racing for the same rows
  (`DependencyInjection.cs:398-402`). Read by
  [ScheduledJobRunner](#scheduledjobrunner) (`ScheduledJobRunner.cs:41`, `:46`) and by
  [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) for the table gate
  (`ApplicationDbContext.cs:286-288`); the design-time helper supplies a default instance so
  `dotnet ef` can build a model without a host
  ([DesignTimeDbContextHelper](group-07-persistence-ef-core.md#designtimedbcontexthelper),
  `DesignTimeDbContextHelper.cs:137-138`).

---

### AzureNotificationHubDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/AzureNotificationHubDeviceRegistrar.cs:15` · Level 4 · class (public sealed)

- **What it is**: the real implementation of [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar). It maintains device installations in Azure Notification Hubs using the installation model (client-generated stable ids, full upsert semantics) and stamps each installation with its owner's `user:{id}` tag so sends can target users rather than raw device tokens (`AzureNotificationHubDeviceRegistrar.cs:15-99`).

- **Depends on**: `INotificationHubClient` and `ILogger<T>` as its two primary-constructor parameters (`AzureNotificationHubDeviceRegistrar.cs:15-17`), [NativePushPayloads](#nativepushpayloads) for the tag, [DeviceInstallationRequest](group-10-notifications.md#deviceinstallationrequest) as the input shape, and [Result](group-01-result-error-handling.md#result) / [Error](group-01-result-error-handling.md#error).

- **Concept introduced, the hub as the only ownership store, and the existence oracle it must not become.** `[Rubric §11, Security]` assesses whether an endpoint can be used to learn something the caller is not entitled to know, and `[Rubric §9, API and Contract Design]` assesses whether the result shape is honest about what happened. Installation ids are client-generated, so nothing stops a caller from sending someone else's. The framework stores no device table of its own, so the check has to be a read-then-delete against the hub, comparing the owner tag (`AzureNotificationHubDeviceRegistrar.cs:64-74`). The subtle part is the **response**: a mismatch is reported as success, not as not-found. The interface remarks explain why (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushDeviceRegistrar.cs:28-36`): answering differently for "no such installation" and "not yours" would turn the endpoint into an existence oracle for other users' installation ids, and the caller has nothing to do with either answer.

- **Walkthrough**
  - `UpsertAsync(userId, request, ct)` (`AzureNotificationHubDeviceRegistrar.cs:20-57`) starts with the platform switch: `FCMV1` and `APNS`, compared after `ToUpperInvariant`, map to `NotificationPlatform.FcmV1` and `.Apns`, and anything else yields `null` (`:22-27`).
  - An unmapped platform returns a validation failure with code `PushDevice.UnsupportedPlatform`, and the message quotes the two accepted constants from [DeviceInstallationRequest](group-10-notifications.md#deviceinstallationrequest) (`AzureNotificationHubDeviceRegistrar.cs:28-34`). Naming the valid values in the error is what makes it actionable from a client.
  - The `Installation` is assembled with the client-supplied id, the resolved platform, the push channel, and exactly one tag, the owner stamp (`AzureNotificationHubDeviceRegistrar.cs:36-42`). `CreateOrUpdateInstallationAsync` is a full upsert, so re-registering the same device id replaces the record rather than accumulating duplicates (`:46`).
  - The upsert's catch is narrow (`MessagingException`) and translates to `PushDevice.UpsertFailed` after logging the real exception (`AzureNotificationHubDeviceRegistrar.cs:49-56`).
  - `DeleteAsync(userId, installationId, ct)` (`AzureNotificationHubDeviceRegistrar.cs:60-89`) reads the installation, checks ownership, and deletes only on a match (`:68-77`). The comment at `:64-67` also settles the concurrency question up front: a concurrent re-registration of the same id between the read and the delete is the owner's own doing, so no lock is warranted.
  - Two distinct catches follow. `MessagingEntityNotFoundException` returns success, because an unknown installation is already the desired state (`AzureNotificationHubDeviceRegistrar.cs:79-83`); a general `MessagingException` logs and returns `PushDevice.DeleteFailed` (`:84-88`).
  - `OwnedBy` (`AzureNotificationHubDeviceRegistrar.cs:91-92`) is the ownership predicate: the installation's tags contain the owner tag, compared with `StringComparer.Ordinal`. `DeleteFailed` (`:94-98`) is factored out so the failure shape is written once.

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) puts the device registry in the hub rather than in the application database, which is what removes push tokens (a credential-shaped secret) from the application's storage entirely. The cost of that choice is exactly the read-then-delete ownership check here, and the interface remarks accept it explicitly.

- **Where it's used**: registered by `AddNativePushNotifications` alongside the sender (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:679`). Called from the framework's own [DevicesController](group-10-notifications.md#devicescontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:44`, `:68`), which is what lets a client register a device without any application-specific endpoint. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Notifications/Push/AzureNotificationHubDeviceRegistrarTests.cs`.

- **Caveats / not-in-source**: an installation registered before ownership tagging existed carries no `user:` tag, and the delete path treats it exactly like someone else's (success, no delete), which is called out in the comment at `:71-72`. Nothing in this code cleans up such records.

---

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullPushDeviceRegistrar.cs:12` · Level 4 · class (public sealed)

- **What it is**: the inert default for [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar). It accepts and discards registrations so a client can call the Devices endpoints unconditionally; nothing is stored until a host enables native push (`NullPushDeviceRegistrar.cs:12-21`).

- **Depends on**: [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar), [DeviceInstallationRequest](group-10-notifications.md#deviceinstallationrequest), and [Result](group-01-result-error-handling.md#result).

- **Concept**: the null-object default introduced at [NullNativePushSender](#nullnativepushsender). Here both operations return success (`NullPushDeviceRegistrar.cs:15-16`, `:19-20`), which is the right choice for this contract specifically: a mobile client registers its device at startup as a matter of course, and failing that call in a host without a hub would surface as an error in an app whose user did nothing wrong. `[Rubric §9, API and Contract Design]` applies: the Devices endpoints keep the same response shape whether or not the channel is enabled, so no client needs a capability check.

- **Walkthrough**: `UpsertAsync` (`NullPushDeviceRegistrar.cs:15-16`) and `DeleteAsync` (`:19-20`) are both expression-bodied `Task.FromResult(Result.Success())`. There is no validation of the platform string here, unlike [AzureNotificationHubDeviceRegistrar](#azurenotificationhubdeviceregistrar), so a request that the real registrar would reject as an unsupported platform is accepted by this one.

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) ships the pipeline inert, and both halves of the channel (the sender and the registrar) have to be inert together, which is why they are registered as a pair (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:579-580`) and replaced as a pair (`:678-679`).

- **Where it's used**: registered by `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:580`) and resolved by [DevicesController](group-10-notifications.md#devicescontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:27`) in any host that has not called `AddNativePushNotifications` with an enabled section.

- **Caveats / not-in-source**: the divergence in validation strictness between this and the real registrar means a test running against the default registration cannot catch an invalid `Platform` value. That behavior is only exercised through [AzureNotificationHubDeviceRegistrar](#azurenotificationhubdeviceregistrar).

---

### ScheduledJobRunner
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:38` · Level 13 · class (sealed, partial, BackgroundService)

- **What it is**: the framework's recurring job scheduler. A `BackgroundService` that runs the host's registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) implementations on their cron schedules, using a persistent job store ([`ScheduledJobEntry`](#scheduledjobentry)) and the outbox processor's claim-lease idiom so an occurrence executes exactly once across every replica.

- **Depends on**: `IServiceScopeFactory`, `ILogger<ScheduledJobRunner>`, `IOptions<SchedulerSettings>` ([`SchedulerSettings`](#schedulersettings)), [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), and an optional `TimeProvider` (`ScheduledJobRunner.cs:38-43`). At run time it resolves [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) per cycle (`:214`) and works against [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext); it emits through [`SchedulerMetrics`](#schedulermetrics) and returns its claim results as [`JobClaim`](#jobclaim). Externals: EF Core (`ExecuteUpdateAsync`), `Microsoft.Extensions.Hosting`, and **Cronos**, aliased as `CronSchedule` (`ScheduledJobRunner.cs:11`).

- **Concept introduced, the claim-lease scheduler.** `[Rubric §29, Resilience & Business Continuity]` assesses whether work survives failure: a schedule that lives in a timer dies with the process, so the schedule lives in a table and the loop only reads it. `[Rubric §12, Performance & Scalability]` assesses scale-out: an interval-driven hosted service runs on **every** replica, so scaling a service to three instances silently triples a purge. The fix is the outbox's claim: a single `ExecuteUpdateAsync` that stamps `LockedUntil` and `LockToken` over a `Where` admitting only unleased-or-expired rows, where the count of matched rows IS the race result (`ScheduledJobRunner.cs:426-438`). Two replicas both issue that update and exactly one matches. `[Rubric §13, Observability & Operability]`: every branch that a human would need to explain later has a `[LoggerMessage]` line, including the ones that do nothing (disabled scheduler, duplicate job name, lease lost). `[Rubric §14, Testability]`: the injected `TimeProvider` plus an `internal` `RunCycleAsync` mean a test drives one whole cycle deterministically without waiting on wall-clock timers (`ScheduledJobRunner.cs:203-204`).

- **Walkthrough**:
  - **State and constants.** `_settings` snapshots `IOptions<SchedulerSettings>.Value` once (`ScheduledJobRunner.cs:45`), and `_timeProvider` falls back to `TimeProvider.System` (`:47`). The three outcome strings `Succeeded`, `Failed` and `Skipped` are named constants (`:50`, `:53`, `:59`), `MaxErrorLength` is 2048 and matches the `LastError` column width (`:62`), `StartupDelay` is 15 seconds so the host finishes module registration and migration before the first cycle touches the table (`:69`), and `MinimumWait` is one second, the floor that stops an overdue row hot-looping the runner (`:72`).
  - **`ExecuteAsync` (`:75-127`), the loop.** It returns immediately when `Scheduler:Enabled` is false, after one log line (`:77-83`), so a disabled scheduler is visible in the logs of a host that expected it without costing a line per cycle. Then the startup delay (`:85-92`), then forever: run a cycle, and swallow exceptions in two distinct ways. `OperationCanceledException` during shutdown breaks the loop (`:101-105`); any other exception is logged and the loop waits out the interval (`:106-111`), because one bad cycle (an unreachable database, a model mismatch) must not take the scheduler down for the life of the process.
  - **The smart wait.** `ComputeWaitTime` (`:138-152`) is a pure static function: the polling interval when nothing is registered, otherwise the time until the earliest upcoming occurrence, floored at `MinimumWait` and capped at the configured interval. This is the same "sleep until there is something to do" shape [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) uses, and it is what keeps an idle scheduler from polling on a fixed tick.
  - **`RunCycleAsync` (`:205-228`).** One DI scope per cycle. It resolves the registered jobs (`:208`), returns early when there are none (`:209-212`), takes the context for the `Default` logical source on the configured engine through [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (`:214-216`), reconciles registrations, runs due jobs, and finally reads back the earliest `NextRunOn` across the registered names (`:221-227`) which becomes the next wait.
  - **`ResolveRegisteredJobs` (`:235-250`)** groups `GetServices<IScheduledJob>()` by `Name` (ordinal) and keeps the first of each group, logging a collision rather than throwing (`:243-246`). Two jobs sharing a name would share one schedule row, and the design choice is that one mis-registered module must not stop every other job.
  - **`SyncRegistrationsAsync` (`:259-320`)** reconciles the table against the registered jobs. It reads the stored expressions once (`:267-271`), and for each job compares the resolved expression against the stored one: **unchanged means leave the row alone** (`:279-285`), with the comment naming the bug that would otherwise appear, recomputing `NextRunOn` every cycle would push every schedule forward forever and nothing would ever fire. A changed expression goes through the set-based `UpdateScheduleAsync` (`:326-358`) so a row another replica is currently executing is not disturbed by the change tracker; a new job is inserted (`:293-311`). An unparsable expression parks the row at `DateTime.MaxValue` and records `Skipped` instead of throwing (`:287-308`, and on the update path at `:348-357`).
  - **`ResolveCronExpression` (`:162-166`)** is the configuration override point: `Scheduler:Jobs:{Name}:Cron` when present and non-blank, otherwise the job's compiled-in default. `TryGetNextOccurrence` (`:176-197`) wraps Cronos and catches exactly `CronFormatException` and `ArgumentException` (`:189`), converting a malformed expression into a parked row plus an error message rather than a crashed runner.
  - **`RunDueJobsAsync` (`:365-393`)** claims and runs one row at a time, tracking an `attempted` set so each name is tried at most once per cycle (`:370-382`). A [`JobClaim`](#jobclaim) with a null `LockToken` means another replica won that row, so it is skipped rather than retried (`:384-391`).
  - **`TryClaimNextDueAsync` (`:402-440`)** reads the earliest due, unleased row (`:409-416`), mints a `Guid` token and a lease of `Scheduler:LeaseSeconds` from now (`:423-424`), then issues the conditional claim update described above (`:429-437`).
  - **`ExecuteClaimedJobAsync` (`:454-512`)** records the lag (floored at zero so a clock adjustment cannot publish a negative duration, `:464-467`), invokes the job, records duration and the outcome-tagged counter (`:469-474`), then computes the next occurrence **from the instant execution finished, not from the occurrence that just ran** (`:476-480`). That is the missed-run policy: a host down for a day runs each job once on startup and returns to cadence instead of replaying a backlog. The final stamp is guarded by the claim token (`:489-503`): a replica whose lease expired mid-execution matches nothing, logs `LogLeaseLost` and drops its stale outcome (`:505-509`) rather than overwriting the current holder's record.
  - **`InvokeJobAsync` (`:519-551`)** resolves the job in a **fresh** DI scope (`:523-525`), exactly like a request, so a job body gets scoped services (a unit of work, repositories, handlers) and the long-lived runner never captures a scoped dependency. A missing job returns `Skipped` with a message (`:527-531`); a cancellation during host shutdown is rethrown so the row stays leased and the occurrence is retried when the lease expires rather than being recorded as a failure it never was (`:539-545`); any other exception is logged and recorded as `Failed` (`:546-550`), so the schedule still advances and a permanently failing job cannot hot-loop.
  - **Log levels are a cost decision.** The per-occurrence start and completion lines are `Debug` (`:581-585`) with the reason stated inline (a busy schedule would otherwise double this runner's steady-state log volume, `[Rubric §31, Cost/FinOps]`, `:578-580`), while every failure line stays `Error` or `Warning` (`:557-591`).

- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) records the decision to extend the durable polling loop already in production instead of adopting Hangfire or Quartz.NET, on the grounds that the missing piece was a cron expression, not a product, and that every extracted service host ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)) would otherwise have to reason about a new dependency. Cron parsing is the one thing bought rather than built (Cronos, MIT, zero-dependency).

- **Where it's used**: registered by `AddScheduledJobs` through `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` (`DependencyInjection.cs:415-416`), deliberately not `AddHostedService`, since the latter appends a descriptor per call and two modules calling it would run two runners racing for the same rows (`DependencyInjection.cs:412-414`). The framework's own scheduled job is [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob), registered by `AddAuditTrail` (`DependencyInjection.cs:492`). `ScheduledJobRunnerTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/ScheduledJobRunnerTests.cs:21`) drives whole cycles through the internal entry point via a shared `SchedulerTestHarness` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs`), and `SchedulerModelGateTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:25`) pins the model gate.

- **Caveats / not-in-source**: which hosts actually call `AddScheduledJobs` and set `Scheduler:Enabled` lives in the downstream apps, not in this repository, so the set of deployments running a schedule today is Not determinable from source here.

---

### FileStorageSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/FileStorageSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the `FileStorage` configuration section for Azure Blob Storage: an endpoint (production, managed identity) or a connection string (local Azurite), plus the container every blob lives in.

- **Depends on**: `System.Uri` (BCL) only. Its consumers are the Azure SDK types (`BlobServiceClient`, `DefaultAzureCredential`) wired in [DependencyInjection](#dependencyinjection-1).

- **Concept introduced, the incomplete-section no-op.** `[Rubric §11, Security]` assesses how credentials are handled: the production path sets `ServiceUri` and authenticates with `DefaultAzureCredential`, so no storage key exists to leak, while `ConnectionString` is documented as the local-development alternative (`FileStorageSettings.cs:15-19`). `[Rubric §33, Developer Experience]`: `AddAzureBlobFileStorage` is written so that an incomplete section is a no-op rather than a startup crash (`DependencyInjection.cs:675-676`), which lets a host call it unconditionally and lets an environment opt in with configuration alone. `[Rubric §15, Best Practices]`: note the deliberate absolute-URI check at `DependencyInjection.cs:691-692`, an empty-string `ServiceUri` binds to a *relative* `Uri`, so a truthiness test would have accepted a useless value; only `{ IsAbsoluteUri: true }` counts, and the comment in the code says exactly that.

- **Walkthrough**:
  - `SectionName = "FileStorage"` (`FileStorageSettings.cs:13`), the same static section-name convention every settings class in this namespace follows.
  - `ServiceUri` (`:16`), nullable `Uri`, the blob service endpoint.
  - `ConnectionString` (`:19`), nullable, the Azurite alternative.
  - `ContainerName` (`:22`), documented as required; the registration bails out when it is blank (`DependencyInjection.cs:686-689`) and again when neither an absolute `ServiceUri` nor a connection string is present (`:693-696`).

- **Walkthrough of its one consumer**: `AddAzureBlobFileStorage` binds the options (`DependencyInjection.cs:682-683`), re-reads the section eagerly with `.Get<FileStorageSettings>()` (`:685`) because the decision to register at all has to be made at composition time, then registers a singleton `BlobContainerClient` built from either the URI plus `DefaultAzureCredential` or the connection string (`:698-704`) and swaps [IFileStorageService](group-07-persistence-ef-core.md#ifilestorageservice) to [AzureBlobFileStorageService](group-14-module-system-composition.md#azureblobfilestorageservice) (`:705`), replacing the [NullFileStorageService](group-14-module-system-composition.md#nullfilestorageservice) default.

- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) chose a configuration-gated storage provider so that a host registers it once and each environment decides whether it is live. Binding the options even in the no-op path (`DependencyInjection.cs:682-683`) means `IOptions<FileStorageSettings>` always resolves, so nothing downstream has to null-check the section.

- **Where it's used**: `AddAzureBlobFileStorage` (`DependencyInjection.cs:680-708`) only.

---

### GetUserPreferencesQuery

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.GetPreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5` · Level 1 · record (sealed)

- **What it is**: the one-line query that asks for a single account's stored UI preferences. It is a
  positional record with exactly one member, `UserId`, and it implements
  [`IUserScopedRequest`](#iuserscopedrequest) (`GetUserPreferencesQuery.cs:5`).

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (`IUserScopedRequest.cs:8`), and the
  `UserIdentifierType` alias, which resolves to `int` through the solution-wide global using
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`; see
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the alias convention). No
  externals.

- **Concept introduced: the one request record in this family that could be shared.** Almost
  everything else in the shared Users use cases keeps its command record app-side, because ADC and
  Store disagree on the pipeline markers those records carry: both `DeleteUserCommand` records, for
  instance, implement `ICacheInvalidating` with a `CachePrefix` built from *their own* `User` type
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:14`,
  `:17`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:17`,
  `:20`), which is a value no shared record could produce. This query carries **no** markers at all:
  it is not [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), not
  `IQueryCacheable`, not
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest).
  That absence is precisely what made it hoistable, and it is the rule worth taking away: a type
  moves into the framework when it has no app-specific policy attached to it.

  `[Rubric §9: API & Contract Design]` assesses whether the contract between layers is explicit and
  minimal. The query is the entire input contract for the read: one identifier, supplied by the
  controller from the authenticated principal rather than by the caller, so there is no way to ask for
  another account's preferences through this shape
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:146-151`).

  `[Rubric §6: CQRS & Event-Driven]` assesses the separation of reads from writes. This is the read
  half of the culture/theme pair; its write counterpart is the app-side `ChangePreferencesCommand`
  handled by [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand).
  Because it is a query, it flows through the shorter query pipeline (FeatureGate, Logging, Caching,
  handler) with no Validating and no Transactional decorator, per
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).

- **Walkthrough**: one positional parameter.
  - `UserId` (`GetUserPreferencesQuery.cs:5`): the account to read. Implementing
    [`IUserScopedRequest`](#iuserscopedrequest) is satisfied by the record's generated property, so
    the shared handler base can read the target through the interface without knowing the record type
    (`IUserScopedRequest.cs:11`).

- **Why it's built this way**: the query and its
  [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse) reply were byte-identical in
  both app Identity modules, so the handler base could be made generic in the `User` aggregate alone
  rather than also in the query type (`GetUserPreferencesHandlerBase.cs:10-14`). Preferences
  themselves are the persistence side of
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (culture) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) (theme).

- **Where it's used**: constructed by
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  in its `GET preferences` action (`UserAccountAuthControllerBase.cs:151`) and handled by
  [`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
  (`GetUserPreferencesHandlerBase.cs:33-35`). Both apps' `AuthController` take the closed handler
  interface as a constructor dependency
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:35`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:32`), and
  both architecture suites use it as the *query* specimen when asserting decorator ordering
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:30`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:28`).

---

### TenantContext

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/TenantContext.cs:11` · Level 1 · class (public sealed)

- **What it is**: the scoped holder of "which tenant is this scope running as". It starts unresolved, is set exactly once per scope, and refuses to be changed to a different value afterwards (`TenantContext.cs:6-11`).
- **Depends on**: [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) as the contract and `System.Globalization` for the exception message. Nothing else: it is a two-property object with one guarded setter.
- **Concept introduced, the ambient scope value with a write-once discipline.** `[Rubric §11, Security]` assesses whether an isolation boundary can be crossed by accident, and `[Rubric §8, Data Architecture]` assesses whether the tenancy model is enforced by the infrastructure rather than by convention. Multi-tenancy here ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is a shared-schema query filter plus database-per-tenant routing, which means the tenant value silently participates in every read (the named `Tenant` query filter), every write (the save interceptor), every tenant-scoped cache key, and the choice of physical database. Reassigning it mid-scope would therefore be catastrophic in a very quiet way: rows already tracked by the context were fetched under the old tenant, and the next save would attribute them to the new one. The exception message spells out exactly that (`TenantContext.cs:37-43`), and it ends with the remedy rather than just the complaint: start a new scope.
- **Walkthrough**
  - `TenantId` has a private setter (`TenantContext.cs:14`), so the only way to write it is through `SetTenant`.
  - `IsResolved` is `TenantId is not null` (`TenantContext.cs:17`). Note that "unresolved" is the normal, expected state for every background service, seeder, and design-time tool (`:7-9`): consumers of the value treat unresolved as "no tenancy" rather than as an error.
  - `SetTenant(tenantId)` (`TenantContext.cs:20-44`) has three branches. It null- and whitespace-guards the argument (`:22`); assigns and returns when nothing is set yet (`:24-28`); returns silently when the same value is re-asserted (`:32-35`); and throws `InvalidOperationException` on a genuine change (`:37-43`).
  - The idempotent middle branch is the load-bearing one, and the comment at `:30-31` names the scenario: the resolution middleware and a background worker that re-asserts the tenant on the same scope must not fight each other. Same value is a no-op, different value is a hard failure.
- **Why it's built this way**: the registration comment in `AddInfrastructure` explains why the class is always registered rather than opted into (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:549-553`): everything that reads it treats an unresolved tenant as "no tenancy", so an always-on registration costs one object per scope and removes a whole class of "works until someone forgets the opt-in" bug. Only `AddMultiTenancy(configuration)` turns the mechanism itself on.
- **Where it's used**: written by [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) on the request path (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:70`), and by the per-tenant background paths that create their own scope: database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:142`), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), `OutboxAdministration`, and [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob). It is read by [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) for routing, by [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), and by the caching decorators through [`TenantCacheKey`](group-05-cqrs-pipeline.md#tenantcachekey). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Context/TenantContextTests.cs`, and exercised for routing by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/DbContextFactoryTenantTests.cs`.
- **Caveats / not-in-source**: the class is not thread-safe, and does not need to be as a scoped service on a request path, but two threads sharing one scope and racing on `SetTenant` with different values is not guarded against.

---

### FaultIntegrationEventConsumer<TEvent>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:26` · Level 2 · class (public sealed partial, generic)

- **What it is**: the consumer of MassTransit's `Fault<TEvent>` message, published when the real consumer for `TEvent` exhausts its retry policy. It turns a message that would otherwise appear only as a row in the broker's `_error` queue into one structured Error log plus a `broker.fault.count` metric tagged by event type (`FaultIntegrationEventConsumer.cs:7-11`).
- **Depends on**: MassTransit's `IConsumer<Fault<TEvent>>` and `ConsumeContext<T>`, `BrokerMetrics.FaultCounter` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:30-31`), [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) as the type constraint (`FaultIntegrationEventConsumer.cs:28`), and `ILogger<T>` with the `LoggerMessage` source generator.
- **Concept introduced, observability for the failure you cannot retry any further.** `[Rubric §13, Observability and Operability]` assesses whether an operator can see a failure without going looking for it, and `[Rubric §29, Resilience and Business Continuity]` assesses whether the dead-letter path is a designed state rather than an accident. MassTransit's retry ladder ends by moving the message to an error queue and publishing a `Fault<T>`. Nobody watches an error queue, so the fault is the hook: subscribing to it converts a silent broker-side event into an application log line and a counter an alert can fire on. The poison-message posture is [ADR-087](https://ivanball.github.io/docs/adr/087-broker-poison-message-handling.html), and the metric feeds the telemetry model of [ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html).
- **Concept, the observer that must never create its own incident.** The class doc at `FaultIntegrationEventConsumer.cs:17-22` states the rule and the reasoning: a fault consumer that itself faults would publish `Fault<Fault<TEvent>>` and, on a broker with second-level redelivery enabled, keep re-entering itself. So this consumer never throws, and it never replays the original message. Both properties are visible in the body: the only guard is the `ArgumentNullException.ThrowIfNull(context)` MassTransit itself will never trip (`:33`), and after that everything is string formatting and a counter increment.
- **Walkthrough**
  - `Consume(context)` (`FaultIntegrationEventConsumer.cs:31-55`) reads the fault message (`:35`).
  - The message id is `fault.FaultedMessageId ?? fault.FaultId` (`FaultIntegrationEventConsumer.cs:39`). The comment at `:37-38` gives the operational reason for the coalesce: both are what an operator pastes into a queue browser, and one of them is always present.
  - The reasons string joins every exception message in the chain with ` | `, falling back to `<no exception detail>` on an empty array (`FaultIntegrationEventConsumer.cs:44-46`). The comment at `:41-43` is explicit that this is a deliberate summary and not a truncation bug: stack traces stay in the error queue's message headers, and the message text is what identifies the failure at a glance.
  - `LogFault` (`FaultIntegrationEventConsumer.cs:48`, declared at `:57-58`) logs at Error with the event type, the message id, and the reasons, and the message text itself explains what happened and where the message went.
  - `BrokerMetrics.FaultCounter.Add(1, ...)` (`FaultIntegrationEventConsumer.cs:50-52`) increments with an `event_type` tag, so the counter is sliceable per contract rather than being a single opaque total.
  - It returns `Task.CompletedTask` (`:54`), which acks the fault message. Nothing is retried.
- **Why it's built this way**: registration is automatic rather than opt-in. `RegisterIntegrationEventConsumer<TEvent>` adds this consumer alongside the real one unless the caller passes `registerFaultConsumer: false` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:38-46`), and `RegisterUpcastedIntegrationEventConsumer<TEvent>` does the same (`:78-86`). Defaulting to on is the right default for observability: forgetting to register the real consumer is a loud failure, forgetting to register its fault observer is a silent one.
- **Where it's used**: paired with every consumer registered through [`IntegrationEventConsumerExtensions`](group-04-events-outbox.md#integrationeventconsumerextensions). In MMCA.ADC that is the Identity service's speaker-link events, the Engagement service's set, and Conference's `UserRegistered`; in MMCA.Store it is the Sales service's `ProductVariantChanged`. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/FaultIntegrationEventConsumerTests.cs`, and by the harness suite alongside it (`.../Messaging/Consumers/IntegrationEventConsumerHarnessTests.cs`).

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EventUpcasterStartupValidator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/EventUpcasterStartupValidator.cs:20` · Level 3 · class (internal sealed)

- **What it is**: a one-method `IHostedService` whose entire job is to resolve [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) at host start, so a bad upcaster registration graph fails the host instead of dead-lettering the first retired-contract message hours later (`EventUpcasterStartupValidator.cs:7-12`).
- **Depends on**: [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) as its single primary-constructor parameter (`EventUpcasterStartupValidator.cs:20`), `Microsoft.Extensions.Hosting.IHostedService`, and [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) as the type it probes with.
- **Concept introduced, validation by construction, forced by resolution.** `[Rubric §15, Best Practices and Code Quality]` assesses whether invariants are checked at the earliest possible moment, and `[Rubric §13, Observability and Operability]` assesses whether a misconfiguration is discoverable. The validation itself does not live here: [`EventUpcasterRegistry`](group-03-querying-specifications.md#eventupcasterregistry) validates its whole registration graph in its constructor, rejecting a duplicate source, a type mapped onto itself, and a cycle, with a message naming the offenders. Since DI is lazy, that constructor might not run until the first broker message arrives. This class exists purely to make it run at start. That is the fail-fast configuration posture of [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) applied to a graph that options validation cannot express.
- **Walkthrough**
  - `StartAsync` (`EventUpcasterStartupValidator.cs:23-30`) discards the result of `upcasters.ResolveTerminalType(typeof(IIntegrationEvent))` (`:27`) and returns a completed task. The comment at `:25-26` explains why the call exists at all: the real work happened in the injected registry's constructor, and reading one member is what makes the dependency impossible to elide.
  - `StopAsync` (`EventUpcasterStartupValidator.cs:33`) is a completed task. There is nothing to unwind.
- **Why it's built this way**: the registration is the other half of the design, and its comment is explicit (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:186-190`): `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, EventUpcasterStartupValidator>())`, **not** `AddHostedService`, because two modules calling `AddInfrastructure` must not run the same validation twice. `TryAddEnumerable` de-duplicates on the implementation type, which `AddHostedService` does not. The class doc adds the cost note (`EventUpcasterStartupValidator.cs:13-17`): a host with no upcasters resolves an empty registry, and the whole mechanism costs one no-op call at start ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)).
- **Where it's used**: registered once inside `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:190`), so every host that calls it gets the check. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/EventUpcasterStartupValidatorTests.cs`.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### UpcastingIntegrationEventConsumer<TEvent>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:32` · Level 3 · class (public sealed partial, generic)

- **What it is**: the draining consumer for a **retired** integration-event contract. It binds a broker queue to the old type, upcasts each message to its terminal contract, and invokes the handlers registered for that terminal contract, so handlers are written once against the newest event type while producers still publishing the old one keep being delivered (`UpcastingIntegrationEventConsumer.cs:13-23`).
- **Depends on**: [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry), `IServiceProvider`, [`IInboxStore`](group-04-events-outbox.md#iinboxstore), and `ILogger<T>` as its four primary-constructor parameters (`UpcastingIntegrationEventConsumer.cs:32-36`); MassTransit's `IConsumer<TEvent>`; [`EventNameResolver`](group-04-events-outbox.md#eventnameresolver) for the inbox key; `System.Linq.Expressions` and `System.Collections.Concurrent` for the dispatch cache.
- **Concept introduced, contract retirement without a coordinated deploy.** `[Rubric §6, CQRS and Event-Driven]` assesses whether the event pipeline can evolve its contracts, and `[Rubric §7, Microservices Readiness]` assesses whether two services can be deployed independently. Renaming or reshaping an integration event across a distributed system normally forces a lockstep deploy, because in-flight messages of the old shape have no handler on the other side. [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html) resolves that with a registered [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster) chain plus this consumer: the old queue stays bound and drains, each message walks the upcaster chain to the terminal type, and the handler code only ever knows the newest contract. The pairing rule is a real trap and is stated in the doc (`UpcastingIntegrationEventConsumer.cs:20-22`): do **not** register both this and the plain [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent) for the same type, because they would compete for one queue and run the handlers twice.
- **Concept, dedup keyed on the original message id.** `[Rubric §12, Performance & Scalability]` assesses whether idempotency is applied uniformly rather than per handler. Idempotent consumption ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)) keys on the message id carried in the envelope. The doc (`UpcastingIntegrationEventConsumer.cs:24-28`) records that the registry preserves the envelope across every upcast hop, so the id this consumer records is the same id a plain consumer would have recorded, and a redelivery is recognised whatever contract the handlers ultimately see.
- **Walkthrough**
  - `Consume(context)` (`UpcastingIntegrationEventConsumer.cs:50-132`) reads the message and takes `integrationEvent.MessageId` **before** any upcasting (`:54-58`), which is the point of the previous paragraph.
  - The inbox key is `EventNameResolver.GetInboxName(typeof(TEvent))` (`UpcastingIntegrationEventConsumer.cs:62`), the retired contract's `[EventName]` identity when it declares one and its short type name otherwise, which is what every row written so far holds (`:60-61`).
  - `inbox.TryBeginAsync(...)` returning `false` means already processed: log at Debug and return (`UpcastingIntegrationEventConsumer.cs:66-70`). The comment at `:64-65` is worth internalizing: `TryBegin` also **stages** the inbox row in the scope's unit of work, so a handler's own `SaveChangesAsync` commits the dedup row atomically with the handler's mutations.
  - With no upcaster registered for the type, the consumer logs at Information and continues (`UpcastingIntegrationEventConsumer.cs:72-77`). This is the documented degrade path: the registry returns the instance untouched, and handlers for the original type run as usual.
  - `UpcastToTerminal` produces the terminal instance, and a type change is logged at Debug with both contract names (`UpcastingIntegrationEventConsumer.cs:79-85`).
  - Handler dispatch is non-generic because the terminal type is only known at runtime. `DispatchCache` (`UpcastingIntegrationEventConsumer.cs:45-47`) memoizes, per terminal type, the closed `IIntegrationEventHandler<>` interface and a compiled invoker (`:87-91`). `BuildInvoker` (`:142-162`) builds an expression tree that casts the two `object` parameters to their concrete types and calls the strongly-typed `HandleAsync` directly, so reflection is paid once per contract instead of once per message. The doc at `:39-44` notes this mirrors what [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) does for the in-process path.
  - The dispatch loop (`UpcastingIntegrationEventConsumer.cs:95-120`) counts handlers and awaits each invoker. Its `catch` (`:108-119`) is the failure contract: `inbox.Abandon(messageId)` discards the staged row so the redelivery is reprocessed rather than skipped as a duplicate (`:110-112`), the handler failure is logged with the handler's full type name, and the exception is **rethrown** so MassTransit applies the configured `UseMessageRetry` policy before dead-lettering (`:114-118`). `OperationCanceledException` is excluded from the catch filter, so a shutdown is not treated as a handler failure.
  - Zero handlers is an Information log, not an error (`UpcastingIntegrationEventConsumer.cs:122-127`): returning normally lets MassTransit ack the message, and the comment states plainly that the broker will not retry.
  - `inbox.CompleteAsync(...)` (`UpcastingIntegrationEventConsumer.cs:131`) persists the staged row unless a handler's own save already committed it. The comment at `:129-130` closes the loop: the message is recorded only on a successful consume, because the failure path above rethrows.
- **Why it's built this way**: the alternative to a per-retired-type consumer is version-tolerant handlers, each branching on a schema version, which spreads the migration across every handler and never gets cleaned up. Concentrating it in one registered consumer per retired contract means the retirement is visible in one place in a host's `Program.cs` and can be deleted when the old queue is drained ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) sets the versioning policy, [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html) ships the mechanism).
- **Where it's used**: registered per retired type through `RegisterUpcastedIntegrationEventConsumer<TEvent>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:78-86`), which also adds the matching [`FaultIntegrationEventConsumer<TEvent>`](#faultintegrationeventconsumertevent). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/UpcastingIntegrationEventConsumerTests.cs`.
- **Caveats / not-in-source**: no first-party host in MMCA.ADC or MMCA.Store currently calls `RegisterUpcastedIntegrationEventConsumer`; the extension point is documented on [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) and on [`OutputCacheEvictionRequested`](group-04-events-outbox.md#outputcacheevictionrequested) as the path to take when a contract is retired. Its behavior is therefore established by the test suite rather than by production traffic.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### AzureBlobFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:15` · Level 4 · class (public sealed)

- **What it is**: the Azure Blob Storage implementation of [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice). It uploads and deletes blobs inside the one container the host configured, and returns a [`Result`](group-01-result-error-handling.md#result) rather than letting a storage exception escape (`AzureBlobFileStorageService.cs:10-15`).
- **Depends on**: `Azure.Storage.Blobs.BlobContainerClient` and `ILogger<T>` as its two primary-constructor parameters (`AzureBlobFileStorageService.cs:15-17`), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) as the contract, and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) for its return shapes.
- **Concept introduced, taking the container as a dependency rather than creating it.** `[Rubric §11, Security]` assesses whether an application holds only the permissions it needs, and `[Rubric §17, DevOps]` assesses whether resource provisioning lives with infrastructure rather than in application startup. The class doc is explicit (`AzureBlobFileStorageService.cs:12-13`): the container, and crucially its public-access level, is provisioned by infrastructure and not created here. A `CreateIfNotExists` in application code would need container-management rights at runtime and would make the access level a property of whichever code path ran first. `[Rubric §13, Observability and Operability]` also applies: `RequestFailedException` is caught, logged with the exception, and translated into a domain-shaped failure whose message says nothing about Azure (`:35-42`, `:54-61`), so the operator sees the cause and the caller sees a stable error code.
- **Walkthrough**
  - `IsConfigured` is a constant `true` (`AzureBlobFileStorageService.cs:20`). Its whole purpose is to differ from the `false` on [`NullFileStorageService`](#nullfilestorageservice).
  - `UploadAsync(blobName, content, contentType, ct)` (`AzureBlobFileStorageService.cs:23-43`) resolves a blob client from the container, uploads with `BlobUploadOptions` carrying the content type as an HTTP header (`:28-31`), and returns the blob's absolute URI on success (`:33`). Setting `ContentType` at upload time is what makes the blob serve correctly when a browser fetches the URL directly.
  - Its catch is narrow: only `RequestFailedException`, the Azure SDK's own failure type (`AzureBlobFileStorageService.cs:35`). It logs and returns `Error.Failure` with code `FileStorage.UploadFailed` and a caller-safe message (`:37-41`). Anything that is not a storage failure still propagates.
  - `DeleteAsync(blobName, ct)` (`AzureBlobFileStorageService.cs:46-62`) uses `DeleteBlobIfExistsAsync`, so an unknown blob name is success, which is what the interface promises ("unknown names succeed (idempotent)", `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:24`). The same narrow catch yields code `FileStorage.DeleteFailed`.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) records blob storage as the home for binary content the databases should not hold. The registration is where the credential story lives (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:694-719`): `ServiceUri` with `DefaultAzureCredential` is the managed-identity production path, `ConnectionString` is the local Azurite path, and `ContainerName` is required for either. There is one carefully commented trap at `:706`, an empty-string `ServiceUri` binds to a **relative** `Uri`, so only `IsAbsoluteUri` counts as configured. An incomplete section returns before registering anything, which leaves the null default in place, so a host can call `AddAzureBlobFileStorage` unconditionally.
- **Where it's used**: registered by `AddAzureBlobFileStorage` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:719`), called by MMCA.ADC's Identity service host. Consumed by the avatar use cases: [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) uploads the normalized jpeg and deletes the previous blob, and [`RemoveUserAvatarHandler`](group-24-identity-module.md#removeuseravatarhandler) and [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) delete on their own paths.
- **Caveats / not-in-source**: there is no dedicated unit test file for this class under `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Storage/`. Whether the configured container is public-read or served through a signed URL is a provisioning decision and is not determinable from this source.

---

### ImageSharpImageProcessor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs:14` · Level 4 · class (public sealed)

- **What it is**: the ImageSharp implementation of [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor). It decodes an uploaded image, orients and crops it to a square, strips all metadata, and re-encodes it as JPEG, returning the bytes as a [`Result`](group-01-result-error-handling.md#result) (`ImageSharpImageProcessor.cs:9-14`).
- **Depends on**: `SixLabors.ImageSharp` (plus its `Formats.Jpeg` and `Processing` namespaces), [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor) as the contract, and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error). It takes **no** constructor dependencies, which is why it can be registered as a singleton.
- **Concept introduced, re-encoding as a sanitization boundary.** `[Rubric §11, Security]` assesses whether untrusted input is neutralized rather than merely inspected, and `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether personal data is removed where it enters. The class doc states both payoffs in one sentence (`ImageSharpImageProcessor.cs:10-12`): decoding plus a full re-encode means **only pixels survive**, so EXIF metadata (including GPS coordinates, which are PII) and any polyglot payload smuggled into the original file are discarded. This is a stronger property than validation: a file that is simultaneously a valid JPEG and a valid archive or script cannot survive a decode-and-re-encode as anything but an image. The upload-side companion is [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer), which narrows the accepted formats by magic bytes rather than by the client-declared content type.
- **Walkthrough**
  - `NormalizeToSquareJpegAsync(content, size, ct)` (`ImageSharpImageProcessor.cs:17-51`) loads the image with `Image.LoadAsync` inside a `using`, so the decoded bitmap is released deterministically (`:21`).
  - The mutation chain is `AutoOrient()` then `Resize` with `ResizeMode.Crop` to a `size` by `size` square (`ImageSharpImageProcessor.cs:25-31`). The ordering comment at `:23-24` is the kind of detail that is only learned by shipping the bug: the EXIF orientation flag has to be baked into the pixels **before** metadata is stripped, or portrait phone photos come out rotated.
  - The three metadata profiles are then nulled explicitly: EXIF, XMP, and IPTC (`ImageSharpImageProcessor.cs:33-35`). Nulling all three matters, because camera and location data can live in more than one of them.
  - Encoding is `JpegEncoder { Quality = 85 }` into a `MemoryStream`, returned as a byte array (`ImageSharpImageProcessor.cs:37-42`). The stream is disposed through `await using` with `ConfigureAwait(false)`.
  - The catch is exception-filtered to exactly two ImageSharp types, `UnknownImageFormatException` and `InvalidImageContentException` (`ImageSharpImageProcessor.cs:44-50`), and turns them into `Error.Validation` with code `Image.Undecodable`. Undecodable input is the **caller's** problem, so it is a validation error and not a server failure; anything else still propagates.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) records normalization as a framework leg rather than an application concern, so every consumer that accepts an image gets the same stripping and the same output shape. Keeping the size a parameter rather than a constant lets the calling handler own the product decision: MMCA.ADC's avatar path passes its own square size from [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler).
- **Where it's used**: registered as a singleton by `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:585`), and the comment there records why it is unconditional (`:583`): the image processor is dependency-free and always real, unlike the file storage default beside it (`:584`). Called by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) before the upload. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Storage/ImageSharpImageProcessorTests.cs`.
- **Caveats / not-in-source**: nothing here bounds the decoded image's dimensions or memory, so a decompression-bomb style input is bounded only by whatever size limit the calling handler applied before it. [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer) restricts the accepted formats to JPEG, PNG, and WebP by magic bytes, but the size guard is the handler's to write.

---

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/NullFileStorageService.cs:11` · Level 4 · class (public sealed)

- **What it is**: the unconfigured default for [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice). Uploads fail with a clear, stable error; deletes succeed, because there is nothing stored to delete (`NullFileStorageService.cs:6-11`).
- **Depends on**: [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) as the contract and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) for its returns.
- **Concept**: the null-object default introduced at [`NullNativePushSender`](#nullnativepushsender), with one instructive difference. `[Rubric §29, Resilience and Business Continuity]` assesses whether a missing capability degrades predictably. This null object is **not** uniformly silent: the two operations are treated asymmetrically because their meanings differ. A caller that wanted to store something and got nothing must be told (an upload that silently succeeded while storing nothing would leave a dangling URL in the database), whereas a caller that wanted something gone already has what it asked for.
- **Walkthrough**
  - `IsConfigured` returns `false` (`NullFileStorageService.cs:14`), the flag the interface offers so a handler can gate a feature (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:13-14`).
  - `UploadAsync` (`NullFileStorageService.cs:17-21`) returns a failed [`Result`](group-01-result-error-handling.md#result) carrying `Error.Failure` with code `FileStorage.NotConfigured`, a message naming the actual condition ("No file storage is configured for this host"), and `source` set to the type name.
  - `DeleteAsync` (`NullFileStorageService.cs:24-25`) returns success.
- **Why it's built this way**: the class doc says it directly (`NullFileStorageService.cs:7-9`), feature endpoints degrade cleanly. Because the failure is a [`Result`](group-01-result-error-handling.md#result) and not an exception ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)), an avatar upload in a host with no storage configured returns a clean error response instead of a 500, and the same code path works whether or not the deployment has provisioned a storage account ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: registered by `AddInfrastructure` through `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:584`), replaced by [`AzureBlobFileStorageService`](#azureblobfilestorageservice) when `AddAzureBlobFileStorage` finds a complete `FileStorage` section (`:719`). It is also the storage the ADC profile E2E suite runs against (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs`).
- **Caveats / not-in-source**: no first-party code currently reads `IsConfigured`; the only two declarations are the ones in this unit (`NullFileStorageService.cs:14` and `AzureBlobFileStorageService.cs:20`). Consumers today discover the unconfigured state from the failed upload result instead, so the gating flag is an available extension point rather than an exercised one.

---

### ChangePasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:25` · Level 8 · class (abstract)

- **What it is**: the shared password-rotation workflow for an authenticated user. Load the account,
  verify the current password against the stored hash, hash the new one, let the aggregate apply its
  own invariants, and persist only if the aggregate accepted the change
  (`ChangePasswordHandlerBase.cs:25`, `:42-70`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) and an `ILogger` as primary-constructor
  parameters (`:24-27`); it implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over [`Result`](group-01-result-error-handling.md#result) (`:27`). Its two constraints are
  the interesting part: `TUser` must be an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  keyed by `UserIdentifierType` **and** implement
  [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) (`:28`), and `TCommand` must
  be an [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a
  [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (`:29`). It also uses
  [`Error`](group-01-result-error-handling.md#error) and the shared
  [`UserUseCaseLog`](#userusecaselog). Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: the generic template-method handler, and the two axes it is generic over.**
  The two app Identity modules carried line-identical copies of this handler, differing only in log
  text (`ChangePasswordHandlerBase.cs:12-16`). Hoisting them needed two variation points, and each is
  a separate generic parameter for a separate reason. `TUser` varies because each app owns its own
  `User` aggregate and the framework must never reference either; the *capability* it needs is named
  by an interface constraint instead, so the base can call `ChangePassword` without knowing the type
  (`IPasswordChangeableUser.cs:19`). `TCommand` varies because the command record carries
  app-specific **pipeline** policy: ADC's `ChangePasswordCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:16`,
  `:18`) and Store's is not
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:13`),
  so a single shared record would have had to pick one behavior. The base reads the command only
  through [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest), which is deliberately
  *not*
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest):
  that marker also opts the command into automatic
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  registration, which is a per-app decision (`IUserScopedCommand.cs:6-11`).

  `[Rubric §1: SOLID]` assesses open/closed and dependency inversion. The workflow is closed for
  modification and open for extension along exactly two declared axes plus the `HandlerName` hook, and
  every collaborator is an abstraction: unit of work, hasher, logger, and the aggregate's own
  capability interface.

  `[Rubric §11: Security]` assesses credential handling. Three properties are visible in the code.
  The current password is verified **before** anything is written (`:55`), the failure is an
  `Unauthorized` error with a stable code rather than a message that distinguishes "no such user" from
  "wrong password" at this layer (`:57-58`), and nothing in the handler ever logs the plaintext, the
  hash or the salt: the success log carries only the user id (`UserUseCaseLog.cs:13-14`). Hashing
  itself is delegated to [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), whose contract returns
  a hash and a fresh salt as a tuple (`IPasswordHasher.cs:11`), the shape
  [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) fixes.

  `[Rubric §4: DDD]` assesses whether business rules live in the domain. The handler never mutates
  the user's fields: it calls `user.ChangePassword(newHash, newSalt)` (`:62`) and returns whatever
  [`Result`](group-01-result-error-handling.md#result) the aggregate produced, so an aggregate
  invariant (for example refusing rotation on a deleted account) short-circuits the save without the
  handler knowing the rule exists.

- **Walkthrough**: two protected members and one method.
  - Primary constructor (`:24-27`): `unitOfWork`, `passwordHasher`, `logger`. The logger is typed as
    the non-generic `ILogger` so a subclass can pass its own `ILogger<TAppHandler>` and keep the log
    *category* app-specific while the message text stays shared (`UserUseCaseLog.cs:5-10`).
  - `UnitOfWork` (`:32`): a `protected` pass-through over the captured parameter, exposed so an app
    subclass can enlist further aggregates in the same unit of work.
  - `HandlerName` (`:39`): `protected virtual`, defaulting to `GetType().Name`. This is the detail
    that made the hoist behavior-preserving: because each app keeps a subclass literally named
    `ChangePasswordHandler`, the `source` field on every returned error is byte-identical to what it
    was before the workflow moved (`:35-38`).
  - `HandleAsync(TCommand, CancellationToken)` (`:42-70`): null-guards the command (`:46`); takes the
    **write** repository via `GetRepository` (`:48`) because this path saves; loads by
    `command.UserId` (`:49`) and returns `Error.NotFound` stamped with the handler name and the
    aggregate type name when the account is missing (`:52`); verifies the current password and returns
    `Error.Unauthorized("Auth.InvalidCurrentPassword", ...)` on mismatch (`:55-59`); hashes the new
    password into a `(newHash, newSalt)` tuple (`:61`); calls the aggregate (`:62`); and only on
    success saves and logs (`:63-67`). The aggregate's result is returned either way (`:69`), so a
    domain failure propagates unchanged.

- **Why it's built this way**: the two apps had drifted into identical code, and identical code in two
  places is where behavior silently diverges. Hoisting it once, with app variation expressed as
  generic parameters and one virtual hook, is the standing preference for reusable infrastructure in
  this workspace. Keeping the command record app-side is not a compromise but the correct boundary:
  the record is where CQRS *pipeline* policy is declared, and that policy is genuinely per app
  (`ChangePasswordHandlerBase.cs:17-22`).

- **Where it's used**: subclassed once per app, each subclass empty apart from the constructor
  forwarding
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:18`,
  `:21`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:16`,
  `:20`). Both subclasses are picked up as scoped command handlers by
  `ScanModuleApplicationServices<TAssemblyMarker>()` (see [`DependencyInjection`](#dependencyinjection))
  and are then wrapped by the decorator pipeline. The workflow is pinned directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:16`,
  which drives it through a test double subclass (`:122-123`).

- **Caveats**: new-password strength is **not** checked here. Both apps' commands additionally
  implement `ICommandWithRequest<ChangePasswordRequest>` (`ChangePasswordCommand.cs:15` in ADC, `:13`
  in Store), which routes the payload through the Validating decorator before the handler runs, so
  the base can assume a syntactically valid request. Neither app's command implements `ITransactional`,
  so the single `SaveChangesAsync` at `:65` is the whole atomic unit.

---

### ChangePreferencesHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23` · Level 8 · class (abstract)

- **What it is**: the shared preference-write workflow. Load the account, merge the partial request
  over the stored values, let the aggregate apply its invariants, and persist on success
  (`ChangePreferencesHandlerBase.cs:23`, `:40-63`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and an `ILogger`
  (`:23-25`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:25`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:26`), and `TCommand` is an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a
  [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) (`:27`). Also uses
  [`Error`](group-01-result-error-handling.md#error) and [`UserUseCaseLog`](#userusecaselog).
  Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: null means "leave alone", and where that rule is enforced.** The request record
  is nullable in both fields on purpose: the app-bar culture switcher sends only a culture and the
  theme toggle sends only a theme
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePreferencesRequest.cs:3-10`). A naive handler
  that passed both fields straight to the aggregate would clear whichever one the caller omitted. The
  merge therefore happens in exactly one place, at the call into the aggregate:
  `command.Request.Culture ?? user.PreferredCulture` and the matching line for the theme (`:53-55`).
  The domain interface documents the same contract from its side, so an aggregate author knows that
  `UpdatePreferences` always receives both values fully resolved (`IUserPreferences.cs:18-25`).

  `[Rubric §15: Best Practices & Code Quality]` assesses whether a rule has one home. Before the hoist this merge
  existed twice; a change to it (say, adding a third preference) had to be made in two repositories in
  lockstep or the apps would drift. It now has one home and one test suite.

  `[Rubric §24: Forms, Validation & UX Safety]` assesses whether a partial update can destroy data the
  user did not touch. The null-coalescing merge is the guarantee that it cannot: switching the theme
  never wipes a stored culture, which is exactly the failure the UI's two independent controls would
  otherwise produce ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) culture,
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) theme).

- **Walkthrough**: same shape as the password base, one collaborator shorter.
  - Primary constructor (`:23-25`): `unitOfWork` and `logger`; no hasher, since nothing here is
    credential material.
  - `UnitOfWork` (`:30`) and `HandlerName` (`:37`): the same two protected members, with the same
    rationale (an app subclass named `ChangePreferencesHandler` keeps the pre-hoist error `source`,
    `:32-36`).
  - `HandleAsync(TCommand, CancellationToken)` (`:40-63`): null-guard (`:44`); write repository via
    `GetRepository` (`:46`); load by `command.UserId` (`:47`); `Error.NotFound` stamped with handler
    and aggregate names when missing (`:50`); the merged call to `user.UpdatePreferences(...)`
    (`:53-55`); and, only when the aggregate succeeded, `SaveChangesAsync` plus
    `UserUseCaseLog.PreferencesChanged` (`:56-60`). The aggregate's result is returned unchanged
    (`:62`).

- **Why it's built this way**: identical to the rationale for
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand), and with
  the same asymmetry on the command record: ADC's `ChangePreferencesCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:15`,
  `:18`) while Store's is not
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:11-12`),
  so the record stays app-side and only the payload record
  ([`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest)) is shared
  (`ChangePreferencesHandlerBase.cs:16-20`).

- **Where it's used**: subclassed by
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17`,
  `:20` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:16`,
  `:19`, both empty subclasses that exist only to fix the generic arguments and preserve the class
  name. Invoked from
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand),
  which builds the app's command through a factory hook and returns `204 No Content` on success
  (`UserAccountAuthControllerBase.cs:126-132`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:16`
  through a test subclass (`:108-109`).

---

### DeleteUserHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:58` · Level 8 · class (abstract)

- **What it is**: the shared account-erasure workflow: authorize owner-or-privileged-role, soft-delete
  the account, run the app's tail hook, irreversibly anonymize the personal data in place, save, write
  the shared soft-deleted marker that revokes the account's already-issued access tokens, then drain a
  post-commit queue (`DeleteUserHandlerBase.cs:58`, `:76-159`). It is the most extensible of
  the seven Users bases: one abstract member and one virtual hook.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an
  [`ICacheService`](group-09-caching.md#icacheservice) and an `ILogger`
  (`:58-61`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:61`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IErasableUser`](group-08-auth.md#ierasableuser) (`:62`), and `TCommand` is an
  [`IUserOwnedRequest`](#iuserownedrequest) (`:63`), not an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest): this workflow needs the
  *caller* as well as the target, and carries no request payload. It also uses
  [`UserOwnershipRule`](#userownershiprule), [`Error`](group-01-result-error-handling.md#error),
  [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) and
  [`UserUseCaseLog`](#userusecaselog). Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: anonymize-in-place erasure, and why the row survives.** Soft-delete
  (`IsDeleted = true`) hides a row but keeps its personal data, so it does not by itself satisfy a
  GDPR/CCPA erasure request; hard-deleting the row would break cross-context scalar references and
  destroy the audit trail. The framework's answer is the pair
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) plus
  [`IErasableUser`](group-08-auth.md#ierasableuser): keep the row, overwrite the personal fields with
  non-identifying placeholders, and require `Anonymize()` to be idempotent
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:24-30`). This handler is
  where that policy becomes a sequence
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).

  **Concept introduced: interface dispatch as a correctness device.** The comment at `:109-113` is one
  of the most instructive in the framework. An app's `User` may *hide* the base entity's `Delete()`
  with `public new Result Delete()` to add account-specific behavior such as revoking the refresh
  token. A hidden method is not an override, and member lookup on a generic type parameter prefers the
  members of its **class** constraint, so a bare `user.Delete()` inside this base would bind to
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)`.Delete()`
  and silently skip the app's version. The workflow therefore assigns the user to an
  `IErasableUser` local first and calls through the interface (`:114-115`), because the interface map
  resolves to the most derived `Delete()` the app type declares. The interface's own remarks record
  the same reasoning from the contract side (`IErasableUser.cs:13-23`), including the deliberate
  choice not to implement it on the base entity so a forgetful consumer fails the generic constraint
  at compile time rather than losing behavior at run time (`IErasableUser.cs:26-27`).

  **Concept introduced: the post-commit queue.** `OnAfterSoftDeleteAsync` receives an
  `ICollection<Func<CancellationToken, Task>> afterCommit` (`:187`). Work that must not happen unless
  the erasure actually commits (deleting a blob, notifying another system) is *enqueued* rather than
  run inline, and the base drains the queue in order after `SaveChangesAsync` (`:151-154`). The subtle
  benefit named in the docs is that the override can hand values it captured before anonymization to a
  post-commit closure without parking them in mutable handler state (`:41-47`), which matters because
  handlers are scoped and a field would be a shared mutable across the whole request.

  **Concept introduced: token revocation as part of the shared workflow, best effort and first.**
  Between the save and the app's tail the base writes the shared soft-deleted marker through
  [`SoftDeletedUserCache.MarkDeletedAsync`](group-08-auth.md#softdeletedusercache) (`:140-149`), which
  is what stops an erased account's already-issued access token from working before the next database
  lookup would notice ([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)).
  Two decisions are documented on the class and are worth reading as a pair (`:19-35`). It is
  **best effort**: the erasure is already committed, so a cache fault must not turn a successful,
  irreversible deletion into a failure the caller would retry, and the write is wrapped in a
  `try`/`catch` that logs a warning through `UserUseCaseLog.SoftDeletedMarkerFailed` and continues
  (`:146-149`). And it runs **before** the app's post-commit tail, because that tail is unbounded app
  work (deleting a blob, calling storage) and every second it takes is a second the deleted account's
  token still works. Owning the marker here rather than in each app's tail is what gives both apps the
  identical revocation window; the hook's own docs tell an override not to re-stamp it (`:175-181`).

  `[Rubric §30: Compliance, Privacy & Data Governance]` assesses whether a data-subject erasure
  request is actually satisfiable. The sequence here is the mechanism behind both apps' published
  erasure promise: soft-delete, then irreversible anonymization, in one transaction (`:12-18`).

  `[Rubric §11: Security]` assesses authorization placement. The very first thing the method does,
  before it touches the repository, is the ownership check (`:83-92`), so an unauthorized caller
  cannot even confirm that an account id exists. The privileged-role test is passed in already
  evaluated because each app owns its own role vocabulary (`UserOwnershipRule.cs:15-19`).

  `[Rubric §1: SOLID]` assesses the template-method shape. The invariant order (authorize, load,
  delete, tail, anonymize, save, revoke, post-commit) is fixed by the base; only the two hooks vary.

- **Walkthrough**: two protected members, the handler method, and two hooks.
  - Primary constructor (`:58-61`): `unitOfWork`, `cacheService`, `logger`. `UnitOfWork` (`:66`) is
    protected specifically so a tail hook can reach further aggregates; the cache is not exposed,
    because the only write the base makes through it is the marker.
  - `HandlerName` (`:73`): the same `GetType().Name` default that preserves the pre-hoist error
    `source`.
  - `HandleAsync(TCommand, CancellationToken)` (`:76-159`):
    - Authorization first (`:83-88`) through
      [`UserOwnershipRule.CheckOwnership`](#userownershiprule) (`UserOwnershipRule.cs:38`), with the
      code `"User.DeleteForbidden"` and a message the caller sees; a non-null return is the failure
      (`:89-92`).
    - Load through the write repository (`:94-95`); `Error.NotFound` when absent (`:98`).
    - `IErasableUser erasable = user; erasable.Delete()` (`:114-115`) with the dispatch rationale
      above; a failure returns immediately (`:116-119`). The comment there also records why
      outstanding refresh sessions are not revoked at this point: the refresh flow re-fetches the user
      through the same soft-delete query filter, so an erased account's sessions stop working the
      moment this commits (`:104-108`).
    - Allocate the `afterCommit` list and call `OnAfterSoftDeleteAsync` (`:121-122`); a failed tail
      aborts before anything is persisted (`:123-126`).
    - `erasable.Anonymize()` (`:129`), also short-circuiting on failure (`:130-133`).
    - `SaveChangesAsync` (`:135`), then the best-effort marker write (`:140-149`), then the
      post-commit drain in order (`:151-154`), then the `UserUseCaseLog.UserErased` log (`:156`) and
      `Result.Success()` (`:158`).
  - `HasDeletePrivilege(string? currentUserRole)` (`:167`): `protected abstract`. Deliberately
    abstract rather than virtual-defaulting-to-false, so adopting the base forces an explicit answer
    about which role bypasses ownership.
  - `OnAfterSoftDeleteAsync(user, command, afterCommit, cancellationToken)` (`:184-189`): `protected
    virtual`, defaulting to `Task.FromResult(Result.Success())`. Its position is load-bearing and
    documented: it runs **after** `Delete()` and **before** `Anonymize()` (`:50-54`), which is the only
    point where an override can both read personal data that anonymization is about to erase and
    enlist further aggregates in the same unit of work. Running it before `Delete()` would let a
    cascaded aggregate's error mask the account's own `AlreadyDeleted` error.

- **Why it's built this way**: the hook contract was derived from what the two apps actually needed,
  and both uses are visible in their overrides. ADC's override
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:42-70`)
  captures the avatar blob name *before* anonymization clears the URL (`DeleteUserHandler.cs:50`),
  raises the cross-service `UserDeleted` domain event on the aggregate so its outbox row is written by
  the very save that commits the erasure (`:58`), and queues only the blob deletion as a post-commit
  action, with a comment recording that the base already wrote the marker ahead of this tail
  (`:60-67`).
  Store instead cascades in the same unit of work, erasing the linked `Customer` that holds its
  name/email/address PII and returning the Customer's own failure untouched so nothing is persisted
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:41-65`).
  One hook covers both because it can do work inline *and* schedule work for after the commit.

- **Where it's used**: subclassed once per app
  (`MMCA.ADC/.../DeleteUser/DeleteUserHandler.cs:28`, `:34`, with `HasDeletePrivilege` returning
  `UserRole.IsOrganizer(...)` at `:38-39`; `MMCA.Store/.../DeleteUser/DeleteUserHandler.cs:25`, `:29`,
  with `UserRole.IsAdmin(...)` at `:32-33`). Both subclasses now take the
  [`ICacheService`](group-09-caching.md#icacheservice) purely to hand it to this base. Covered directly
  by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:17`,
  whose fixture user type is `TestHidingDeleteUser`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:96`)
  precisely so the hidden-`Delete()` dispatch rule above is a regression test rather than a comment.

- **Caveats**: post-commit actions run after the erasure has already succeeded, so each one owns its
  own failure handling; the base does not wrap them (`:151-154`, and see the documented expectation at
  `:175-181`). The one exception is the marker write the base performs itself, which it does wrap
  (`:140-149`). Both apps' `DeleteUserCommand` records are
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), so the cache prefix they carry
  is invalidated by the decorator after the handler returns success, outside this class.

---

### ForgotPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ForgotPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:36` · Level 8 · class (abstract)

- **What it is**: the shared start-a-password-reset workflow: parse the submitted address, resolve the
  account behind it, mint a single-use token, and email it. Every outcome returns
  `Result.Success()` (`ForgotPasswordHandlerBase.cs:36`, `:51-100`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordResetTokenService`](group-08-auth.md#ipasswordresettokenservice),
  [`IEmailSender`](group-10-notifications.md#iemailsender),
  `IOptions<`[`PasswordResetSettings`](group-08-auth.md#passwordresetsettings)`>` and an `ILogger`
  (`:35-40`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:40`). Constraints: `TUser` is only an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  keyed by `UserIdentifierType` (`:41`) with no capability interface at all, because the workflow
  reads nothing off the aggregate except `Id` (`:72`), and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a [`ForgotPasswordRequest`](group-08-auth.md#forgotpasswordrequest) (`:42`). It also uses
  the [`Email`](group-02-domain-building-blocks.md#email) value object (`:57`) and
  [`UserUseCaseLog`](#userusecaselog). Externals: `Microsoft.Extensions.Options`,
  `Microsoft.Extensions.Logging`, `System.Globalization` and `System.Net.WebUtility` (`:1-4`).

- **Concept introduced: the success-always handler, and anti-enumeration as a return-type decision.**
  Every other command base in this family reports its failures. This one cannot. A response that
  differs between "we sent you a reset link" and "no such account" is an account-enumeration oracle:
  anyone can walk an address list and learn which addresses are registered. So the four ways this
  workflow can fail to send anything all return `Result.Success()` and differ only in a log line: a
  malformed address (`:58-62`), an address with no account (`:66-70`), a request the token service
  throttled (`:73-77`), and an email send that threw (`:90-96`). The class remarks state the rule
  outright and name the one exception: only the request validator can produce a 400, and it inspects
  the shape of the address alone (`:20-25`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:11-16`).

  `[Rubric §11: Security]` assesses whether a public endpoint leaks facts about who holds an account.
  The leak surface is wider than the HTTP response, and the code closes it in three places. The result
  is uniform (`:62`, `:70`, `:77`, `:95`). The controller turns every one of them into the same
  `202 Accepted`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:82-93`).
  And the rejection log deliberately carries a reason string but no address and no account id, so the
  log does not become the oracle the response is not
  (`UserUseCaseLog.cs:37-40`). Only the paths that already proved an account exists log a user id
  (`UserUseCaseLog.cs:28-35`).

  `[Rubric §29: Resilience & Business Continuity]` assesses what happens when a dependency fails
  mid-workflow. A send failure is caught, logged with the exception, and swallowed (`:90-96`); the
  token has already been issued and is still valid, so the user can retry or use the link from a later
  request. The catch filter excludes `OperationCanceledException` (`:90`) so a cancelled request is
  not misreported as a delivered reset.

  `[Rubric §3: Clean Architecture]` assesses dependency direction. The workflow lives in the
  Application layer and reaches the SMTP relay, the token cache and the database only through
  interfaces; the one thing it genuinely cannot express in the framework, an address-to-account lookup
  over an app-owned `User` aggregate, is the single abstract member (`:109`).

- **Walkthrough**: two protected properties, the handler method, and four hooks.
  - Primary constructor (`:35-40`): `unitOfWork`, `tokenService`, `emailSender`, `settings`, `logger`.
  - `UnitOfWork` (`:45`): exposed so the lookup override can reach a read repository. Both apps use it
    for exactly that.
  - `Settings` (`:48`): `settings.Value`, unwrapped once so the body reads
    `Settings.TokenLifetimeMinutes` rather than `settings.Value...`.
  - `HandleAsync(TCommand, CancellationToken)` (`:51-100`): null-guard (`:55`); `Email.Create` on the
    raw string, so a malformed address never reaches the lookup (`:57-62`); `FindUntrackedByEmailAsync`
    (`:65`); `tokenService.IssueAsync(email.Value, user.Id, ...)` (`:72`), whose failure means the
    per-email throttle fired; then the send, composed from the three `Compose*` hooks and sent as HTML
    (`:83-88`); and finally the `PasswordResetRequested` log and success (`:98-99`).
  - `FindUntrackedByEmailAsync(Email, CancellationToken)` (`:109`): `protected abstract`. The only
    app-specific step, because each app's `User` stores the address differently.
  - `ComposeSubject()` (`:113`): `protected virtual`, `"Reset your password"`. Override to localize or
    rebrand.
  - `ComposeBody(string? resetLink, string token)` (`:123-134`): `protected virtual`. It carries the
    link **and** the raw token, because clients without deep linking (the MAUI head) need the token
    typed into the reset page by hand (`:115-119`). Both the link and the token go through
    `WebUtility.HtmlEncode` before interpolation into the HTML (`:128`, `:132`), and the expiry is
    rendered with `CultureInfo.InvariantCulture` (`:125`).
  - `ComposeResetLink(string email, string token)` (`:144-147`): `protected virtual`. Returns `null`
    when `PasswordResetSettings.ResetUrl` is blank, so an unconfigured host degrades to a token-only
    email rather than emailing a broken link; otherwise it appends `?email=...&token=...` with both
    values `Uri.EscapeDataString`-encoded.

- **Why it's built this way**: the reset token is deliberately not a database row. It lives in the
  distributed cache, hashed at rest, with the per-email request throttle and the per-token attempt cap
  enforced by the token service rather than by this handler
  ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html);
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:56`, `:71`,
  `:140`). That split is why the handler's only reaction to a throttled request is a log line: it
  never learns which limit fired. The command record stays app-side for the same reason it does in the
  ChangePassword hoist, and the base reads it only through `ICommandWithRequest<ForgotPasswordRequest>`
  (`:27-31`).

- **Where it's used**: subclassed once per app, each override implementing the address lookup as an
  untracked `GetAllAsync` filtered on the `Email` value object
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:21`,
  `:26`, `:29-37`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:21`,
  `:27`, `:34-46`). Reached over HTTP through
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand),
  whose `POST forgot-password` action is `[AllowAnonymous]`, rate-limited by the auth-IP policy and
  `[Idempotent]` (`PasswordResetAuthControllerBase.cs:75-93`). Pinned by six tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:21`
  through a test subclass (`:190-195`), one per rejection path plus the unconfigured-`ResetUrl`
  degradation (`:27`, `:42`, `:57`, `:79`, `:92`, `:108`).

- **Caveats**: the anonymous command carries no user identifier, which is why it implements
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  rather than [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:12-13`).
  Nothing in this workflow writes to the database, so it never calls `SaveChangesAsync`; the unit of
  work is present only to hand the subclass a read repository.

---

### GetUserPreferencesHandlerBase<TUser>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.GetPreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21` · Level 8 · class (abstract)

- **What it is**: the shared preference-read workflow, and the only query handler among the Users
  bases. Load the account through the read repository and project its two preference fields into a
  [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse)
  (`GetUserPreferencesHandlerBase.cs:21`, `:33-45`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) as its single
  primary-constructor parameter (`:21`); implements
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  closed over [`GetUserPreferencesQuery`](#getuserpreferencesquery) and
  `Result<UserPreferencesResponse>` (`:22`). One constraint: `TUser` is an
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  implementing [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:23`). Also uses
  [`Error`](group-01-result-error-handling.md#error). No logger, and no externals beyond the BCL.

- **Concept introduced: one generic parameter is enough when nothing app-specific rides on the
  request.** This is the contrast case for the command bases above. Because
  [`GetUserPreferencesQuery`](#getuserpreferencesquery) carries no pipeline markers, it could be
  shared outright, so the base is generic in the `User` aggregate **only** (`:10-14`). Note also the
  weaker entity constraint: `AuditableBaseEntity<UserIdentifierType>` rather than
  `AuditableAggregateRootEntity<...>` (`:23`), because a read needs no domain events and no aggregate
  behavior. Constraining to the least the workflow actually uses is the pattern worth copying.

  `[Rubric §6: CQRS & Event-Driven]` assesses read/write separation. The handler takes the **read**
  repository via `GetReadRepository` (`:39`) rather than `GetRepository`, and never calls
  `SaveChangesAsync`. The class remarks record that this was a genuine divergence resolved by the
  hoist: the two pre-existing app copies disagreed, ADC using the read repository and Store the write
  one, and the read repository is the correct choice for a query handler (`:15-19`).

  `[Rubric §12: Performance & Scalability]` assesses avoidable work. The read repository is the
  no-tracking path, so this query stops materializing an EF change-tracker entry for every preference
  lookup; the class doc states the consequence plainly, that Store gains a no-tracking read on
  adoption (`:17-18`). Note the related trap the workspace has hit elsewhere: a no-tracking source
  poisons a whole composed query, which is precisely why mutation handlers such as
  [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) keep
  using `GetRepository` instead.

  `[Rubric §15: Best Practices & Code Quality]` assesses consistency of error shape. The not-found
  path produces the identical `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)`
  construction the command bases use (`:42-43`), so every account use case in both apps reports a
  missing user the same way.

- **Walkthrough**: one protected member and one method.
  - Primary constructor (`:21`): `unitOfWork` only.
  - `HandlerName` (`:30`): the same `GetType().Name` default, keeping the error `source` as
    `GetUserPreferencesHandler` for clients that match on it (`:25-29`).
  - `HandleAsync(GetUserPreferencesQuery, CancellationToken)` (`:33-45`): null-guards the query
    (`:37`); resolves `GetReadRepository<TUser, UserIdentifierType>()` (`:39`); loads by
    `query.UserId` (`:40`); and returns either the stamped `Error.NotFound` failure (`:42-43`) or a
    success wrapping `new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme)`
    (`:44`). A ternary, not a branch chain: the whole method is a load and a projection.

- **Why it's built this way**: the query, the response and the workflow were all identical across the
  two apps, so this is the cleanest of the Users hoists; the only decision it had to make was which
  repository is correct for a read, and it resolved that in favor of the no-tracking one (`:15-19`).
  Preferences are read at login to reapply a returning user's culture and theme across devices
  ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html),
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), which is why the read path
  is worth keeping cheap.

- **Where it's used**: subclassed as an empty, name-preserving class in both apps
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13-14`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:12-13`).
  Consumed through the closed
  `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` interface by
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  (`UserAccountAuthControllerBase.cs:46`, `:57`, `:149-150`). Pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:14`
  through a test subclass (`:87-88`), and by each app's own handler tests.

- **Caveats**: the soft-delete global query filter applies to this read like any other, so a
  soft-deleted account resolves to `null` and returns `NotFound` rather than its stored preferences.
  That behavior comes from the persistence layer, not from anything in this class.

---

### ResetPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ResetPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:31` · Level 8 · class (abstract)

- **What it is**: the shared complete-a-password-reset workflow: redeem the single-use token, hash the
  new password, let the aggregate apply its invariants, persist, then clear the account's lockout so
  the user can sign in immediately with the new credential (`ResetPasswordHandlerBase.cs:31`,
  `:50-93`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher),
  [`IPasswordResetTokenService`](group-08-auth.md#ipasswordresettokenservice),
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an `ILogger` (`:30-35`);
  implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:35`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) (`:36`), the same
  capability [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
  requires, and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a [`ResetPasswordRequest`](group-08-auth.md#resetpasswordrequest) (`:37`). Also uses
  [`Error`](group-01-result-error-handling.md#error) and [`UserUseCaseLog`](#userusecaselog).
  Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: burn the token before the write, not after.** The token is consumed at the top
  of the method, before anything is saved (`:61-63`), and the comment explains the trade: leaving it
  live until the write succeeds opens a replay window in which the same token redeems twice, while
  burning it early costs a user whose aggregate then rejects the change one extra reset request
  (`:58-60`). Choosing the second cost is the security-over-convenience call, and it is pinned by its
  own test, `HandleAsync_ConsumesTheTokenBeforeSaving`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:112`).

  **Concept introduced: one error for every rejection.** Unlike the authenticated change-password
  path, which can afford a specific `Auth.InvalidCurrentPassword`, this anonymous endpoint collapses
  an unknown token, an expired token, a mismatched token, an attempt-capped token and a vanished
  account into a single `Auth.InvalidResetToken` (`:95-99`, produced at `:67` and `:77`). The private
  `InvalidToken()` factory exists so there is exactly one construction site and no way for a future
  edit to make two branches distinguishable by accident.

  `[Rubric §11: Security]` assesses whether an anonymous endpoint leaks account state. Two mechanisms
  do the work here: the uniform error above, and a rejection log that names only a reason string,
  never an address or an account id (`:66`, `:75`, and `UserUseCaseLog.cs:37-40`). The
  matching controller action turns every failure into the same `401`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:99-118`).

  `[Rubric §29: Resilience & Business Continuity]` assesses whether a user can recover unaided. The
  final `ResetFailedAttemptsAsync` call (`:89`) is the part that makes a reset actually usable: a user
  who reset the password *because* the brute-force lockout locked them out would otherwise still be
  locked out with a brand-new credential
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html);
  `ILoginProtectionService.cs:33`).

  `[Rubric §4: DDD]` assesses whether the rules live in the domain. As with the change-password base,
  the handler hashes and then calls `user.ChangePassword(newHash, newSalt)` (`:80`), returning the
  aggregate's own result on failure without saving or clearing the lockout (`:81-84`).

- **Walkthrough**: two protected members, the handler method, and one private helper.
  - Primary constructor (`:30-35`): `unitOfWork`, `passwordHasher`, `tokenService`, `loginProtection`,
    `logger`. Five collaborators, the widest of the Users bases, because a reset touches the token
    store, the hasher, the database and the lockout store in one pass.
  - `UnitOfWork` (`:40`) and `HandlerName` (`:47`): the same two protected members as the other bases,
    with the same rationale (an app subclass named `ResetPasswordHandler` reports that name as the
    error `source`, `:42-46`).
  - `HandleAsync(TCommand, CancellationToken)` (`:50-93`): null-guard (`:54`); redeem the token via
    `ValidateAndConsumeAsync(request.Email, request.Token, ...)` (`:61-63`) and fail generically on
    rejection (`:64-68`); take the account id the token resolved to (`:70`) and load it through the
    **write** repository (`:71-72`), failing with the same generic error if it is gone (`:73-77`);
    hash the new password (`:79`) and call the aggregate (`:80`); `SaveChangesAsync` (`:86`); clear the
    lockout (`:89`); log completion and return the aggregate's success result (`:91-92`).
  - `InvalidToken()` (`:95-99`): the single `Error.Unauthorized("Auth.InvalidResetToken", ...)`
    construction, stamped with `HandlerName`.

- **Why it's built this way**: the reset half of the recovery vertical had to share the
  change-password hoist's shape (generic in the aggregate, generic in the command, one virtual
  `HandlerName`) so that both credential-write paths report errors identically and neither app has to
  restate the workflow
  ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). The one
  ordering decision it owns, consuming before saving, is documented in the code rather than left to be
  rediscovered (`:58-60`). New-password strength is not re-checked here because
  [`ResetPasswordRequestValidator`](group-08-auth.md#resetpasswordrequestvalidator) includes the same
  `StrongPasswordRules<T>` set the registration and change-password requests use, so a reset cannot be
  a way around the complexity policy
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:12-23`).

- **Where it's used**: subclassed once per app as an empty, name-preserving class
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:19`,
  `:24-29`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:20`,
  `:26-31`). Reached over HTTP through the `POST reset-password` action on
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`PasswordResetAuthControllerBase.cs:99-118`), which answers `204 No Content` on success. Pinned by
  five tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:19`
  through a test subclass (`:176-181`), covering both generic-error paths, the happy path, the
  aggregate rejection and the consume-before-save ordering (`:28`, `:48`, `:64`, `:85`, `:111`).

- **Caveats**: the two apps differ on cache policy exactly as they do for change-password: ADC's
  `ResetPasswordCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a prefix built from its
  own `User` type
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:16`,
  `:18`) and Store's is not, which is the reason the command record stays app-side. The lockout clear
  at `:89` runs after the save and is not part of the transaction: if it throws, the password has
  already changed. Not determinable from source: whether any deployment configures a
  `ResetFailedAttemptsAsync` implementation that can fail in a way the caller would notice, since the
  contract returns a bare `Task` with no result (`ILoginProtectionService.cs:33`).

---

### CreateMigrationProofTable

> MMCA.Common.Infrastructure.Tests.MigrationsFixture · `MMCA.Common.Infrastructure.Tests.MigrationsFixture` · `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests.MigrationsFixture/CreateMigrationProofTable.cs:24` · Level 13 · class (sealed)

- **What it is**: a real, committed EF Core migration against the framework's single SQLite context.
  It creates one table, `MigrationProof`, and exists so the framework's migration-apply path can be
  proved against the kind of artifact a consumer would actually commit rather than against a mock
  (`CreateMigrationProofTable.cs:24`, `:39-47`).

- **Depends on**: [`SqliteDbContext`](group-07-persistence-ef-core.md#sqlitedbcontext), named in the
  `[DbContext]` attribute (`:22`). Externals: EF Core's `Migration` base class, `MigrationBuilder`,
  and the `DbContextAttribute` / `MigrationAttribute` pair from
  `Microsoft.EntityFrameworkCore.Migrations` and `.Infrastructure` (`:1-2`). Its project takes a
  single `ProjectReference` on `MMCA.Common.Infrastructure` and is marked `IsPackable=false`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests.MigrationsFixture/MMCA.Common.Infrastructure.Tests.MigrationsFixture.csproj:3`,
  `:6`).

- **Concept introduced: a test fixture that has to live in its own assembly.** EF Core does not
  discover migrations by convention over the whole app: it scans one nominated *migrations assembly*
  and matches the migrations in it to a context by the `[DbContext]` attribute each one carries
  (`:22`). The framework declares exactly one SQLite context class
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so any migration
  compiled into `MMCA.Common.Infrastructure.Tests` would immediately be "pending" for every other test
  in that assembly that names it as the migrations assembly. One of those tests,
  `DbContextFactoryMigrationTargetTests`, rests its whole argument on the test assembly declaring
  **none**. The two facts cannot coexist in one assembly, so the migration was given its own tiny
  library and only the tests that opt in by naming it ever see it (`:12-18`). The class remarks state
  that reasoning in the code itself.

  There is a second, smaller lesson in what the file does **not** contain. No `.Designer.cs` and no
  model snapshot accompany it: neither is needed to apply a migration at run time, and both exist only
  so `dotnet ef migrations add` can diff the next one (`:19-21`). The direct consequence shows up in
  `Up`, where the column types are written out by hand because an empty target model supplies nothing
  (`:37-38`).

  `[Rubric §14: Testability]` assesses whether the hard parts of the system can be exercised for real
  rather than asserted about. Migration application is exactly such a part: it is startup behavior
  against a live provider, and mocking it proves nothing. This fixture makes it testable by supplying
  the one input the production path needs (a committed migration in a nominated assembly) while
  isolating it from every other test through an assembly boundary.

  `[Rubric §8: Data Architecture]` assesses schema-change discipline. The two public constants are
  the contract this fixture offers its tests: the migration id recorded in `__EFMigrationsHistory`
  (`:27`) and the table name that proves the schema, not just the history row, was touched (`:30`).
  Asserting on both is what separates "EF wrote a history row" from "the schema actually changed".

  `[Rubric §17: DevOps]` assesses whether deployment behavior is verified rather than assumed. The
  `"None"` initialization strategy, which is what a deployed host runs, has to refuse to start when
  the schema is behind the code and has to name the pending migration in the failure so an operator
  knows what to apply. That guard can only be exercised against a genuinely pending, genuinely named
  migration, which is what this type provides
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:144`,
  `:168`).

- **Walkthrough**: two attributes, two constants, and the migration pair.
  - `[DbContext(typeof(SqliteDbContext))]` (`:22`): the binding EF uses to decide which context this
    migration belongs to.
  - `[Migration(MigrationId)]` (`:23`): the id EF records and reports. Passing the constant rather
    than a literal is what lets the tests assert on `CreateMigrationProofTable.MigrationId` instead of
    repeating the string.
  - `MigrationId` (`:27`): `"20260831000001_CreateMigrationProofTable"`, the timestamp-prefixed form
    EF expects and the value written into `__EFMigrationsHistory`.
  - `TableName` (`:30`): `"MigrationProof"`, the table `Up` creates and the evidence a test queries
    for.
  - `Up(MigrationBuilder)` (`:33-48`): null-guards the builder (`:35`), then a single `CreateTable`
    with an autoincrementing `long` `Id` carrying the `Sqlite:Autoincrement` annotation (`:43-44`), a
    non-null `string Name` (`:45`), and a primary key named `PK_MigrationProof` built from the same
    constant (`:47`). Every column type is stated explicitly for the empty-target-model reason above.
  - `Down(MigrationBuilder)` (`:51-56`): drops the table, so the migration is reversible and a test
    that applies it leaves nothing conceptually stranded.

- **Why it's built this way**: the framework's migration story is a production concern, not a unit
  test. `MigrateAsync()` on [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is
  the same call a host makes for the `"Migrate"` strategy
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/MigrationApplyProofTests.cs:22-26`),
  and a proof of it needs a real migration, a real SQLite file, and a real history table. Nominating
  the assembly is configuration, not code: a data source points at it through
  `DataSourceEntrySettings.SqliteMigrationsAssembly`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:43`), which
  is exactly how the tests wire this fixture in (`MigrationApplyProofTests.cs:41-42`, `:57-58`).

- **Where it's used**: by two test classes, in two different assemblies, for two different halves of
  the same behavior.
  [`MigrationApplyProofTests`](group-27-testing-infrastructure.md#migrationapplyprooftests) applies it
  through [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) and asserts the
  history row, the created table, and that nothing stays pending
  (`MigrationApplyProofTests.cs:94-106`); that asking what is pending applies nothing (`:110-120`);
  and that a second `MigrateAsync` over an up-to-date database is a no-op rather than a re-apply whose
  `CREATE TABLE` would collide (`:124-133`).
  [`DatabaseInitializationExtensionsTests`](group-27-testing-infrastructure.md#databaseinitializationextensionstests)
  uses it for the production guard in
  [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions):
  the `"None"` strategy must throw naming the pending migration and must apply nothing on the way out
  (`DatabaseInitializationExtensionsTests.cs:153-154`, `:167-174`).
  Its deliberate non-consumer is
  [`DbContextFactoryMigrationTargetTests`](group-27-testing-infrastructure.md#dbcontextfactorymigrationtargettests),
  which needs a migrations assembly that declares nothing.

- **Caveats**: the assembly is a test fixture, never shipped: `IsPackable=false`
  (`MMCA.Common.Infrastructure.Tests.MigrationsFixture.csproj:3`) and it is listed in
  `MMCA.Common.slnx` under `Tests/` (`MMCA.Common/MMCA.Common.slnx:37`), so nothing in the published
  packages carries this migration. Because there is no model snapshot, `dotnet ef migrations add`
  cannot meaningfully extend this assembly: a second migration here would have to be hand-written the
  same way.


---
[⬅ gRPC & Inter-Service Contracts](group-13-grpc-contracts.md)  •  [Index](00-index.md)  •  [Common UI Framework (MudBlazor components, theme, base pages) ➡](group-15-common-ui-framework.md)
