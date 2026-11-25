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
[`SmtpSettings`](#smtpsettings), [`SchedulerSettings`](#schedulersettings) and
[`PushNotificationSettings`](#pushnotificationsettings) (the persistence, auth, caching and outbox
sections the same root binds are documented in [group 07](group-07-persistence-ef-core.md),
[group 08](group-08-auth.md), [group 09](group-09-caching.md) and
[group 04](group-04-events-outbox.md)); the cloud-neutral null-object defaults a vendor adapter
package replaces ([`NullNativePushSender`](#nullnativepushsender),
[`NullPushDeviceRegistrar`](#nullpushdeviceregistrar),
[`NullFileStorageService`](#nullfilestorageservice)) with the vendor-free
[`NativePushPayloads`](#nativepushpayloads) builder the push adapters share; the two startup
posture checks, [`StartupConfigurationSummaryService`](#startupconfigurationsummaryservice) and
[`CloudAdapterTripwire`](#cloudadaptertripwire) with its carrier
[`CloudAdapterTripwireOptions`](#cloudadaptertripwireoptions), plus the
[`ChannelJoinAuthorizerMissingWarningService`](#channeljoinauthorizermissingwarningservice) that
names an open push-channel posture once; the broker transport boundary
([`IBrokerTransport`](#ibrokertransport), [`MessageBusProviders`](#messagebusproviders),
[`BrokerTransportContext`](#brokertransportcontext),
[`BrokerTransportPolicies`](#brokertransportpolicies)), the transport-neutral broker model it is
written against ([`BrokerTopology`](#brokertopology), [`BrokerSubscription`](#brokersubscription),
[`BrokerConsumerKind`](#brokerconsumerkind), [`BrokerNaming`](#brokernaming),
[`BrokerHeaders`](#brokerheaders), [`BrokerWire`](#brokerwire),
[`OutgoingBrokerMessage`](#outgoingbrokermessage), [`IncomingBrokerMessage`](#incomingbrokermessage),
[`IBrokerPublisher`](#ibrokerpublisher), [`IBrokerReceivePipeline`](#ibrokerreceivepipeline) and the
[`BrokerDisposition`](#brokerdisposition) family [`Completed`](#completed) /
[`Redeliver`](#redeliver) / [`DeadLetter`](#deadletter)), and the two built-in transports
[`RabbitMqBrokerTransport`](#rabbitmqbrokertransport) and
[`PostgreSqlBrokerTransport`](#postgresqlbrokertransport) with their internals; the cross-replica
locking pair ([`RedisDistributedLock`](#redisdistributedlock),
[`InProcessDistributedLock`](#inprocessdistributedlock)); the host-scoped job runner
([`ScheduledJobRunner`](#scheduledjobrunner)), the [`ExceptionChain`](#exceptionchain) renderer
background work records its failures with, and the
[`PeriodicBackgroundService`](#periodicbackgroundservice) base the other fixed-interval sweeps derive
from; the broker-side consumer machinery a host composes
([`IBrokerConsumerBuilder`](#ibrokerconsumerbuilder) and its
[`BrokerConsumerBuilder`](#brokerconsumerbuilder), the
[`BrokerReceivePipeline`](#brokerreceivepipeline) behind
[`IBrokerMessageConsumer`](#ibrokermessageconsumer), and
[`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent) with its
[`UpcastDispatch`](#upcastdispatch) cache) with the boot-time
[`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator); the scoped
[`TenantContext`](#tenantcontext) and the ambient-context carriers that let a hop off the request
call stack act as the identity that queued the work ([`AmbientOrigin`](#ambientorigin) with its
published [`OriginSnapshot`](#originsnapshot) and [`RestoreHandle`](#restorehandle),
[`ScopedUserOverride`](#scopeduseroverride),
[`ImpersonatingCurrentUserService`](#impersonatingcurrentuserservice),
[`ConsumerOriginRestore`](#consumeroriginrestore)); the internal-command queue a host composes for
deferred work ([`IInternalCommand`](#iinternalcommand),
[`IInternalCommandScheduler`](#iinternalcommandscheduler),
[`IInternalCommandAdministration`](#iinternalcommandadministration) with its
[`InternalCommandDeadLetter`](#internalcommanddeadletter) projection, the
[`InternalCommandNameAttribute`](#internalcommandnameattribute) that keeps a rename from orphaning
rows and the [`InternalCommandExecution`](#internalcommandexecution) marker (with its
[`Scope`](#scope) handle) that tells a handler it is running on the durable path, plus the
ready-made commands the framework ships on it,
[`IDeleteBlobInternalCommand`](#ideleteblobinternalcommand) handled by
[`DeleteBlobInternalCommandHandlerBase<TCommand>`](#deleteblobinternalcommandhandlerbasetcommand),
and [`DeleteUserPushInstallationsInternalCommand`](#deleteuserpushinstallationsinternalcommand)
handled by
[`DeleteUserPushInstallationsInternalCommandHandler`](#deleteuserpushinstallationsinternalcommandhandler));
the two resolvers that answer a composition question a plain settings property answered badly,
[`ApplicationNamespace`](#applicationnamespace) and
[`SmtpTransportSecurity`](#smtptransportsecurity); and the shared **Users**
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
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:16`) is barely more
than a dozen lines. Its `Register` forwards to an `AddConferenceModule(applicationSettings)` extension
method (`ConferenceModule.cs:30-31`), and its `RegisterDisabledStubs` (`ConferenceModule.cs:22-27`)
registers a `DisabledSessionBookmarkValidationService` and a `DisabledEventLiveValidationService` so a
host that *disables* Conference still has those cross-module contract types resolvable in DI.

That last detail is the crux of the extraction boundary. `RegisterDisabledStubs` plus
`RequiresDependencies` is what makes one module assembly boot in two topologies. When Conference runs
in its own service, that host names only the Conference module's assembly, so Engagement does not run
there and no Engagement stub is ever registered, yet Conference's `GetSessionBookmarkCountHandler`
still needs Engagement's `IBookmarkCountService`. The host's pipeline therefore registers a typed gRPC
client pointed at the real Engagement process with a `Replace` registration, which displaces a
disabled stub where a host has one and otherwise simply adds the adapter
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:332-336`, `:359`). Application code
never learns which path it got; the transport choice lives entirely at the composition edge
([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §2,
Design Patterns]` applies here: this is a clean strategy / null-object pairing (real service, disabled
stub, remote client) rather than scattered `if (moduleEnabled)` checks.

## Discovery and Kahn-ordered registration

[`ModuleLoader`](#moduleloader)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:16`) is the engine. Its one
`DiscoverAndRegister` overload (`ModuleLoader.cs:59-65`) takes the assemblies to scan as a required
parameter: there is no AppDomain-scan convenience, and the parameter doc says why, because an
AppDomain scan only sees assemblies already loaded, so a module assembly that is referenced but not
yet touched by any code path would be silently absent from discovery (`ModuleLoader.cs:49-54`). The
scan guards each `GetTypes()` call so one bad reference never aborts the whole pass: a
`ReflectionTypeLoadException` keeps every type that did load, so one unloadable type does not make the
assembly's modules vanish, and any other failure drops just that assembly; both shapes log at Error,
because a module that silently fails to register is an outage that looks like a configuration choice
(`ModuleLoader.cs:69-97`). It then instantiates every concrete
[`IModule`](#imodule) via `Activator.CreateInstance` (`ModuleLoader.cs:99-102`) and every concrete
[`IModuleSeeder`](#imoduleseeder) into a case-insensitive dictionary keyed by `ModuleName`
(`ModuleLoader.cs:104-107`).

Ordering is **Kahn's topological sort** (`ModuleLoader.cs:284-334`) over the modules' declared
`Dependencies`. Kahn's algorithm is BFS over a dependency graph: compute each module's in-degree
(count of unprocessed dependencies, `ModuleLoader.cs:289`), build the reverse adjacency list of
dependents (`ModuleLoader.cs:292-305`), seed a queue with the zero-in-degree modules
(`ModuleLoader.cs:308-309`), and as each is emitted decrement its dependents' in-degrees, enqueuing
any that reach zero (`ModuleLoader.cs:318-322`). A dependency name that was never discovered is
skipped rather than treated as an edge (`ModuleLoader.cs:299-300`); validation catches it later. If
fewer modules come out than went in, the remainder form a cycle and the loader throws with the
offending names (`ModuleLoader.cs:326-331`). The payoff is an ordering where a module's DI
registrations always exist *before* any dependent registers, which matters because the CQRS decorator
pipeline (below) can only wrap handlers that are already in the container.

For each sorted module the loader checks [`ModulesSettings.IsModuleEnabled`](#modulessettings)
(`ModuleLoader.cs:114`). A disabled module gets `RegisterDisabledStubs` called, has the exact service
descriptors that call added recorded (`ModuleLoader.cs:120-122`), and is listed in
`DisabledModuleNames` (`ModuleLoader.cs:124`); an enabled one runs `ValidateModuleDependencies` then
`RegisterEnabledModule` (`ModuleLoader.cs:128-129`) and contributes its seeder if one was found
(`ModuleLoader.cs:131-134`). Registration is also where **per-module configuration** is loaded by
convention: before calling `module.Register(...)` the loader adds `modules.{name}.json` and, when an
environment name is passed, `modules.{name}.{environment}.json` to the configuration builder
(`ModuleLoader.cs:187-191`), so a module can ship its own config file. Dependency validation
(`ModuleLoader.cs:138-171`) is microservice-aware: a dependency that is disabled in-process but listed
in that consumer's [`ModuleSettings`](#modulesettings) `RemoteDependencies` is treated as *satisfied
remotely*, and only a `RequiresDependencies = true` module with a genuinely unsatisfied dependency
throws, with an error message that spells out the three ways to fix it (`ModuleLoader.cs:152-160`).
Every step emits a `[LoggerMessage]`-generated structured log (`ModuleLoader.cs:336-358`), so the
startup log tells you exactly which modules loaded, in what order, and how long each took
(`ModuleLoader.cs:193-196`).

Trusting configuration is not quite enough, so the loader offers a second, post-build gate:
`ValidateRemoteDependencies(serviceProvider)` (`ModuleLoader.cs:214-236`) walks every remote-declared
dependency, resolves each service type the disabled module's stub had registered, throws when one does
not resolve at all, and logs a warning when it still resolves to the stub implementation
(`ModuleLoader.cs:238-259`). That converts a forgotten gRPC-client registration from a first-request
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
`SeedAllAsync` (`ModuleLoader.cs:268-274`), which invokes each collected
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:28`) exposes `AddApplication()`
(`DependencyInjection.cs:36`), which registers the core singletons
([`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) at `:34`,
[`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) at `:40`,
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider) at
`:42`, [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline) at `:43`)
and pulls in the framework's own FluentValidation validators by assembly
(`DependencyInjection.cs:59`). Each of those four singletons is registered with `TryAddSingleton`, so
a host that registered its own first keeps it. The upcaster registry is registered unconditionally on purpose: with no upcasters it
is an empty registry whose operations are the identity, so both delivery paths can depend on it
without a null check (`DependencyInjection.cs:39-43`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)), and individual
upcasters accumulate through `AddEventUpcaster<TSource, TTarget, TUpcaster>()`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Extensibility.cs:81`).

The Application root also owns `ScanModuleApplicationServices<TAssemblyMarker>()`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ModuleScanning.cs:28-30`) and its
`Assembly`-typed overload (`DependencyInjection.ModuleScanning.cs:46`),
the Scrutor convention scan every module's `AddXModule` call makes: domain-event and integration-event
handlers as singletons (`DependencyInjection.ModuleScanning.cs:51-63`), DTO mappers, the opt-in
[`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
projectors, request mappers and update appliers scoped (`DependencyInjection.ModuleScanning.cs:65-103`), command and
query handlers scoped (`DependencyInjection.ModuleScanning.cs:105-115`), validators from the module assembly
(`DependencyInjection.ModuleScanning.cs:117`), and finally a reflection pass that `TryAdd`s a
`CommandRequestValidator<,>` for every command implementing `ICommandWithRequest<T>`
(`DependencyInjection.ModuleScanning.cs:119-135`) so an explicit validator still wins.

The **order** of these calls is a hard contract in exactly one respect, and it is the reason
`AddApplicationDecorators()` (`MMCA.Common.Application/DependencyInjection.cs:132`) must come *last*.
Decorators are registered with **Scrutor's `TryDecorate`**, which wraps *existing* registrations, so
every module's concrete handlers must already be in the container or there is nothing to wrap, and a
handler registered afterwards runs completely unwrapped with nothing failing at startup to say so
(`DependencyInjection.cs:208-211`). Rather than leaving that as a comment, the framework enforces it.
`AddApplicationDecorators()` finishes by calling `SealPipeline`, which `TryAdd`s a singleton instance
of the private marker [`DecoratorPipelineSeal`](#decoratorpipelineseal)
(`DependencyInjection.cs:169`, `:294`, `:307-308`), and every registration entry point that
contributes handlers (`ScanModuleApplicationServices`, `AddEntityCrud`, `AddEntityUpdateVerb`,
`AddEntityUpdate`, `AddMmcaApplicationPipeline` itself) opens with `ThrowIfPipelineSealed`, which scans
the collection for that marker and throws a message naming the offending call
(`DependencyInjection.cs:329-338`). The whole sequence is available as one call,
`AddMmcaApplicationPipeline(configure)` (`DependencyInjection.cs:226-235`): it runs `AddApplication()`,
invokes the callback with a [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Application/MmcaApplicationPipelineBuilder.cs:12`) whose
`ScanModule<TAssemblyMarker>` (`:27`), `ScanModules(params Assembly[])` (`:41`) and
`Register(Action<IServiceCollection>)` (`:62`) steps are where module discovery, gRPC clients and
broker messaging go, and then closes with `AddApplicationDecorators()`. The builder's constructor is
`internal` precisely so it cannot be created outside that call, because outside it nothing keeps the
decorators last (`MmcaApplicationPipelineBuilder.cs:9-14`). A third guard, `VerifyDecoratorPipeline()`
(`DependencyInjection.cs:263`), is never called automatically: it is the hook an architecture fitness
test calls after replaying a host's own registration sequence, and it reports every
`ICommandHandler<,>` / `IQueryHandler<,>` descriptor that still carries an implementation type, which
after decoration is proof that nothing wrapped it (`DependencyInjection.cs:272-304`).
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:68` and
`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:160` are
its callers today.

`AddApplicationDecorators` also encodes the **execution order** via `TryDecorate`'s
reverse-registration rule (registered innermost first,
`MMCA.Common.Application/DependencyInjection.cs:149-167`), so the command pipeline ends up
`FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Transactional -> handler`
and the query pipeline `FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout ->
handler` ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The
rationale for each position is written out in the method's own doc comment
(`MMCA.Common.Application/DependencyInjection.cs:102-130`): authorization sits outside caching so a
denied request neither reads nor populates the cache, validation sits outside the transaction so an
invalid command never opens one, and the timeout budget sits inside validation and outside the
transaction so it covers the database work and cancels it rather than leaving it open. The decorator
types themselves (for example
[`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
[`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult)
and [`TimeoutCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#timeoutcommanddecoratortcommand-tresult))
are documented in the CQRS-pipeline chapter; this chapter owns only the *wiring* of them. An optional
MiniProfiler pair is registered separately by an opt-in `AddApplicationProfiling()`
(`MMCA.Common.Application/DependencyInjection.cs:198`), never by `AddApplicationDecorators()`; the composed
service host makes that call after the sealed pipeline when `ApplicationSettings:UseMiniProfiler` is true
(`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:162-165`).
`[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` (open/closed) live here: cross-cutting
behavior is added by wrapping, not by editing handlers.

The **Infrastructure** root
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:48`) exposes
`AddInfrastructure(configuration)` (`DependencyInjection.cs:58`), which binds most of the settings
types in this chapter, registers the three save interceptors as singletons
(`DependencyInjection.cs:62-71`), the persistence stack (data-source service and resolver, entity
registry, the scoped and singleton context factories, repositories, unit of work,
`DependencyInjection.cs:60-131`), Scrutor-scans the framework's own EF entity configurations
(`DependencyInjection.cs:134-139`), adds caching (`DependencyInjection.cs:141`), registers the refresh
session store and its retention sweep behind the same flag that maps the table
(`DependencyInjection.cs:169-213`), and enrolls three startup checks through `TryAddEnumerable`, so a
host whose modules each call `AddInfrastructure` still runs each once: a validator that fails the host
on a bad upcaster graph (`DependencyInjection.cs:230-231`), the one-line
[`StartupConfigurationSummaryService`](#startupconfigurationsummaryservice) (`:214-215`), and the
[`CloudAdapterTripwire`](#cloudadaptertripwire) carried through `ValidateOnStart` by
[`CloudAdapterTripwireOptions`](#cloudadaptertripwireoptions) (`:221-223`), both described in the
settings section below. The outbox hosted services are **conditional**: the
method reads [`MessageBusSettings`](#messagebussettings), calls `EnsureOutboxAvailableForProvider`, and
adds [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) plus `OutboxCleanupService` only
when `IsOutboxEnabled`, otherwise registering
[`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice) so the choice is
visible in the log (`DependencyInjection.cs:256-268`,
[ADR-100](https://ivanball.github.io/docs/adr/100-outbox-opt-in-resolved-from-messaging-mode.html)).
The `OutboxMessages` table stays mapped either way, so flipping the flag is never a migration
(`DependencyInjection.cs:250-255`). It closes by composing the internal-command queue
(`AddInternalCommands`, `DependencyInjection.cs:275`), running `AddServices()` (`:254`) and then
layering the impersonation decorator over whatever `ICurrentUserService` that left registered
(`:256-263`), both described two sections below. Optional add-ons sit alongside the root:
the class is `partial`, split by concern across sibling files, so
`AddCommonHybridCache` (`DependencyInjection.Caching.cs:158`), `AddScheduledJobs`
(`DependencyInjection.Jobs.cs:37`), `AddTwoFactorAuthentication` (`DependencyInjection.Auth.cs:40`),
`AddEmailConfirmation` (`:68`), `AddLegalAcceptance` (`:104`), `AddStoredPermissionGrants` (`:139`),
`AddAuditTrail` (`DependencyInjection.Jobs.cs:108`), `AddMultiTenancy` (`DependencyInjection.cs:320`),
`AddServices` (`:315`), `AddEntityConfigurationAssembly` (`:373`), `AddStronglyTypedIds` (`:401`),
`AddNpgsqlDataSourceConfigurator` (`DependencyInjection.Persistence.cs:24`),
`AddNotificationInfrastructure` (`DependencyInjection.Notifications.cs:23`), `AddPushNotifications`
(`:38`), and the broker pair `AddBrokerMessaging` (`DependencyInjection.Messaging.cs:48`) and
`AddBrokerTransport` (`:159`), the registration call an adapter package's transport goes through.
Native push, file storage and a non-built-in broker are not registered by any method of this class:
each arrives from a vendor adapter package that replaces a core default (see
[group 28](group-28-common-cloud-provider-adapters.md)).

`AddCaching` (`MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:30`) also registers this chapter's
one cross-replica primitive: an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that
resolves to [`RedisDistributedLock`](#redisdistributedlock) when the host has an
`IConnectionMultiplexer` registered, and to the warn-once
[`InProcessDistributedLock`](#inprocessdistributedlock) otherwise
(`MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:109-123`). The Redis implementation is the
standard `SET key token NX PX ttl` acquire
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:67`) with a
compare-and-delete release script (`RedisDistributedLock.cs:36-37`, evaluated at `:114`), handing back
a [`RedisLockHandle`](#redislockhandle) that releases exactly its own acquisition, once
(`RedisDistributedLock.cs:91`, `:101`). That release runs after the guarded work has already
committed, so a Redis fault there is logged rather than thrown and the key falls back to expiring on
its TTL, and a release that finds the key already gone logs that the section was not exclusive
(`RedisDistributedLock.cs:106-129`); the fallback is exclusive only inside one process, which is exactly
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
(`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:36`) binds
[`SchedulerSettings`](#schedulersettings) and enrolls [`ScheduledJobRunner`](#scheduledjobrunner)
through `TryAddEnumerable` rather than `AddHostedService`, precisely so two modules calling it cannot
start two runners racing for the same rows (`DependencyInjection.Jobs.cs:44-48`); individual
[`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) implementations arrive through
`AddScheduledJob<TJob>()` (`DependencyInjection.Jobs.cs:72`), each registered scoped so the runner can
resolve it in a fresh scope per execution. `AddAuditTrail(configuration)`
(`DependencyInjection.Jobs.cs:108`) binds [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings), adds the
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
and the [`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader) that projects
the trail's rows, and contributes its own retention job
(`DependencyInjection.Jobs.cs:110-124`), which only actually runs when the host also enabled the scheduler.
`AddMultiTenancy(configuration)` (`DependencyInjection.cs:320`) binds
[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) and registers
[`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator) as an `IValidateOptions<TenancySettings>`
through `TryAddEnumerable` (`DependencyInjection.cs:322-330`); note what it does *not* do, because
that is the design:
[`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor) and
[`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext), whose scoped implementation
[`TenantContext`](#tenantcontext) reports `IsResolved = false` until a request calls `SetTenant`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/TenantContext.cs:25`, `:28`, registered
at `DependencyInjection.cs:348`) unless it was constructed inside a background hop, in which case it
starts with the tenant that hop restored (`TenantContext.cs:19`, see the deferred-work section below),
are registered unconditionally by
`AddInfrastructure` and `AddServices` and stay inert until a tenant is resolved, so the framework can
never sit in the half-wired state where entities carry
[`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity) but the write-side guard is off
(`DependencyInjection.cs:68-71`, `:315`,
[ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Finally
`AddUserDataExportSection<TSection>()` (`MMCA.Common.Application/DependencyInjection.Extensibility.cs:38`)
accumulates [`IUserDataExportSection`](#iuserdataexportsection) contributors into the one
`IEnumerable` the export handler fans out over. The governing ADRs are
[ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html),
[ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html), ADR-073 and
[ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html); `[Rubric §30, Compliance
& Data Governance]` is the category the trail and the export both serve.

[`ScheduledJobRunner`](#scheduledjobrunner)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:40`) is the one
of these with real runtime machinery, and it reuses the outbox's idioms wholesale. It is a
`BackgroundService` that returns immediately (after one log line) when `Scheduler:Enabled` is false
(`ScheduledJobRunner.cs:86-91`), waits out a 15-second startup delay so migrations finish first
(`ScheduledJobRunner.cs:70`, `:95`), then loops: run one cycle that reconciles the `ScheduledJobs` rows
against the registered jobs, claims due rows with a lease, executes and stamps the outcome
(`ScheduledJobRunner.cs:103-108`, `:213`), and smart-waits until the earliest upcoming occurrence capped
at `Scheduler:PollingIntervalSeconds` (`ScheduledJobRunner.cs:123-131`). A claim attempt is a single
filtered `ExecuteUpdateAsync` against the still-unleased predicate, so two racing replicas both issue
it and exactly one matches (`ScheduledJobRunner.cs:438-448`); it returns a [`JobClaim`](#jobclaim)
carrying either this replica's lock token or `null` when another replica won the row
(`ScheduledJobRunner.cs:450`), which is what makes an occurrence run exactly once across a scaled host.
The persisted row is [`ScheduledJobEntry`](#scheduledjobentry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20`), deliberately
not an auditable entity: it is framework bookkeeping with an explicit claim lease instead of a
concurrency token, and it is host-scoped, living in the `Default` data source only
(`ScheduledJobEntry.cs:8-19`), on whichever relational engine `Scheduler:DataSource` names (SQL Server
unless set, and never Cosmos because the table is relational, `SchedulerSettings.cs:48-55`), which
each cycle resolves before touching the table (`ScheduledJobRunner.cs:226-227`). [`SchedulerMetrics`](#schedulermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16`) publishes the
`MMCA.Common.Scheduler` meter with a run counter tagged by job and outcome
(`SchedulerMetrics.cs:28-31`), a duration histogram (`SchedulerMetrics.cs:39-42`) and a schedule-lag
histogram (`SchedulerMetrics.cs:50`), the same shape [`BrokerMetrics`](#brokermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`) uses for the
`MMCA.Common.Broker` meter's fault and circuit-open counters (`BrokerMetrics.cs:30`, `:43`). So
`[Rubric §13, Observability & Operability]` is covered by instruments rather than by log scraping.

Two more composition-time shapes sit beside those registrations. The first is the base class the
*other* periodic sweeps derive from: [`PeriodicBackgroundService`](#periodicbackgroundservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hosting/Background/PeriodicBackgroundService.cs:20`)
factors the fixed-interval pattern into one place, an `IsEnabled` gate evaluated once at startup
(`PeriodicBackgroundService.cs:38`), a `StartupDelay` defaulting to 15 seconds (`:31`), then
`ExecuteCycleAsync` on an `Interval` loop (`:25`, `:50`) whose failing cycle is logged and never kills
the loop (through an overridable `LogCycleFailure`, `:45-46`, so a derived sweep can keep its own
message and the event id its dashboards and tests key on, `:40-43`), with every wait going through an injected `TimeProvider` so a test can drive it on a fake clock
(`PeriodicBackgroundService.cs:7-11`); its own doc comment records that the outbox processor
deliberately does *not* use it, because a signal-driven smart wait is not a fixed interval (`:13-15`).
The second is the broker side of `AddBrokerMessaging`. There is no per-consumer fault consumer: a
message whose handlers exhaust every retry and redelivery is dead-lettered by the framework's receive
pipeline, which logs it and counts `broker.fault.count` at that point
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerConsumerBuilder.cs:11-13`;
the pipeline is described in the broker section below). A *retired* contract is bound instead to
[`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:29`)
through `RegisterUpcastedIntegrationEventConsumer<TEvent>`, which upcasts each message to its terminal
contract through
[`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) and dispatches the
handlers registered for *that* contract, so handlers are written once against the newest event type
while producers still publishing the old one keep being delivered, with deduplication still keyed on
the original message id (`UpcastingIntegrationEventConsumer.cs:10-25`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)). Registering both
kinds for one type is refused at registration rather than left to run the handlers twice
(`UpcastingIntegrationEventConsumer.cs:18-19`, enforced at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:51-58`).
Because the terminal type is known only at runtime, handler resolution goes through
[`UpcastDispatch`](#upcastdispatch)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastDispatch.cs:15`), which
caches the closed handler interface and a compiled invoker per terminal type so reflection stays off
the per-message path (`UpcastDispatch.cs:7-14`, used at `UpcastingIntegrationEventConsumer.cs:97`).
The upcaster graph those hops depend on
is checked at boot by [`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/EventUpcasterStartupValidator.cs:20`),
an `IHostedService` that `AddInfrastructure` enrolls through `TryAddEnumerable`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:231`): resolving the registry *is* the check,
because its constructor rejects a duplicate source, a self-mapping and a cycle, so a misconfigured
host fails to start instead of dead-lettering events hours later
(`EventUpcasterStartupValidator.cs:7-17`, `:23-29`).

## Deferred work, and the context that travels with it

The last two things `AddInfrastructure` composes are a queue for work a request wants done later, and
the machinery that lets whatever drains a queue act as the identity that filled it.
`AddInternalCommands` (`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:141`, called at
`DependencyInjection.cs:275`) binds `InternalCommandsSettings`, registers the origin capture, the
scheduler and the operator surface scoped (`DependencyInjection.Jobs.cs:160-161`, `:166`), and then
takes the outbox's posture deliberately: the table is mapped either way, and `InternalCommands:Enabled`
decides only whether the processor and its retention sweep run (`DependencyInjection.Jobs.cs:174-177`)
or a disabled-notice hosted service says so once in the log (`:179`, rationale at `:130-139`).

[`IInternalCommand`](#iinternalcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommand.cs:38`) is the
whole application-side contract, a marker over `ICommand<Result>` with **no second handler
interface**: a deferred command is executed by the same `ICommandHandler<TCommand, TResult>` a
synchronous one is, so every decorator (feature gate, authorization, logging, validation, timeout,
transaction) applies to the deferred execution exactly as it does inline (`IInternalCommand.cs:11-16`).
The two rules that follow from a row in a table are stated on the interface itself: the payload must
round-trip through `System.Text.Json`, and execution is at-least-once because a host that dies between
the handler's commit and the row's stamp re-runs the row once the lease expires, so handlers must be
idempotent (`IInternalCommand.cs:19-29`). [`IInternalCommandScheduler`](#iinternalcommandscheduler)
(`IInternalCommandScheduler.cs:16`) writes the row on the **caller's own unit of work**: scheduling
from inside an `ITransactional` command commits with the aggregate change or rolls back with it
(`IInternalCommandScheduler.cs:9-14`), which is the outbox's atomicity guarantee applied to
work the host wants to do rather than to a message it wants to publish. With a transaction active the
row is only enrolled, and when no later save follows the transactional pipeline saves it just before
the commit; with none active the row is saved at once, flushing whatever else is pending on that
context (`IInternalCommandScheduler.cs:34-43`). Both overloads return
`Result<Guid>` (`IInternalCommandScheduler.cs:45-48`, `:59-62`), the handle the administration surface
takes. A row stores the command's assembly-qualified CLR name unless
[`InternalCommandNameAttribute`](#internalcommandnameattribute)
(`InternalCommandNameAttribute.cs:25`) declares a stable identity, the internal-command twin of
`EventNameAttribute` on the outbox side, with the same drain-then-rename caveat because the attribute
changes only what *new* rows store (`InternalCommandNameAttribute.cs:12-17`).
[`IInternalCommandAdministration`](#iinternalcommandadministration)
(`IInternalCommandAdministration.cs:17`) is the operator half: count the pending backlog, page the
dead letters as [`InternalCommandDeadLetter`](#internalcommanddeadletter) rows
(`IInternalCommandAdministration.cs:99`) whose command payload is deliberately *not* projected because
it can carry personal data (`:86-89`), requeue them (attempts reset, the lease and dead-letter stamp
cleared, `LastError` kept on purpose, `:48-53`), and purge completed rows on demand. Every method
returns a `Result`, because an unknown source name is an expected failure an admin screen renders
rather than an exception. `[Rubric §13, Observability & Operability]` and `[Rubric §29, Resilience]`
are the categories: without this surface, a command that exhausted its attempts has no way back into
execution except hand-edited production SQL.

The framework ships one ready-made use of the queue, for the case an inline call handles worst:
deleting a blob that a committed change left orphaned.
[`IDeleteBlobInternalCommand`](#ideleteblobinternalcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IDeleteBlobInternalCommand.cs:21`)
adds a single `BlobName` (`IDeleteBlobInternalCommand.cs:24`) to
[`IInternalCommand`](#iinternalcommand), because a delete run in the post-commit tail is best effort
(a storage outage, a deploy or a crash leaks the blob with nothing left that knows about it) while a
row scheduled on the same unit of work survives all three (`IDeleteBlobInternalCommand.cs:9-13`). An
implementation is a small record carrying only the name, with an
[`InternalCommandNameAttribute`](#internalcommandnameattribute) so a later rename cannot strand rows
in flight (`IDeleteBlobInternalCommand.cs:16-18`).
[`DeleteBlobInternalCommandHandlerBase<TCommand>`](#deleteblobinternalcommandhandlerbasetcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/DeleteBlobInternalCommandHandlerBase.cs:28`)
is the idempotent handler the at-least-once rule asks for: a successful delete completes the row, a
`NotFound` answer is already the state the command asks for and so also returns `Result.Success()`
instead of retrying forever, and any other failure is returned unchanged so the processor's backoff
retries it (`DeleteBlobInternalCommandHandlerBase.cs:45-64`, rationale at `:13-18`). A consumer
derives one sealed subclass per command, so the handler scan registers a closed
`ICommandHandler<TCommand, Result>` that the decorators wrap, and overrides only `BlobKind` (default
`"Blob"`, `DeleteBlobInternalCommandHandlerBase.cs:38`) to label its log lines (`:20-23`). ADC does
this twice, for avatars
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteAvatarBlob/DeleteAvatarBlobInternalCommandHandler.cs:20`)
and for session assets
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/DeleteSessionAssetBlob/DeleteSessionAssetBlobInternalCommandHandler.cs:20`);
Store has no subclass. The storage side is
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html).

Context propagation is the other half, and it is one helper rather than one per mechanism.
[`AmbientOrigin`](#ambientorigin)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:21`) is the single place
the framework captures and restores the five values a hop off the call stack needs (user id, roles,
permission claims, tenant, correlation id), so a deferred command, an outbox row and a broker message
all carry the same set the same way (`AmbientOrigin.cs:10-19`). Roles travel as one comma-separated
value bounded by the column width, `MaxRolesLength = 512` (`AmbientOrigin.cs:40`), keeping only the
whole leading roles that fit, because cutting a name mid-word would restore a role nobody holds
(`AmbientOrigin.cs:55-60`); the flattener is null-tolerant on purpose, because
`ICurrentUserService.Roles` is a default interface member that hand written test doubles routinely
leave unstubbed and a null there must read as "no roles", never as a capture that throws inside a
save (`AmbientOrigin.cs:47-53`). Permission claims are the opposite trade: `FlattenPermissions`
(`AmbientOrigin.cs:110`) writes them as a JSON array at full fidelity, because a dropped permission
would deny a deferred command the inline request was allowed to run and no delimiter is safe for an
arbitrary permission name (`AmbientOrigin.cs:97-107`), and `ParsePermissions` (`:135`) reads a
malformed value back as no permissions rather than failing the hop (`:128-132`). The `mfa` claim is
deliberately not carried: a step-up proves a live interaction, so an `IRequiresMfa` command cannot run
deferred (`AmbientOrigin.cs:163-167`). The capture sites are the internal-command
origin capture
([`InternalCommandOriginCapture`](group-07-persistence-ef-core.md#internalcommandorigincapture),
`.../Persistence/InternalCommands/InternalCommandOriginCapture.cs:34`), the outbox writer
(`.../Persistence/DbContexts/Factory/DbContextFactory.cs:158`) and the broker publisher
(`.../Messaging/BrokerMessageBus.cs:105`); the restore sites are the internal-command processor
(`.../Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:483`), the
[`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
(`.../Persistence/Outbox/Processing/OutboxProcessor.cs:508`) and the consumers.

`Restore` (`AmbientOrigin.cs:254`) does two things. It writes the captured values onto the scope it was
given, tenant first because the tenant routes the scoped context factory, then the principal, then the
correlation id (`AmbientOrigin.cs:268-277`); the principal is always overwritten or cleared so a reused
scope cannot let one message's user answer for the next, while the tenant is set only when the scope has
not already resolved a different one, because a tenant cannot change within a scope
(`AmbientOrigin.cs:214-224`, `:294-303`). And it **publishes** what the scope ended up with as an
[`OriginSnapshot`](#originsnapshot)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:353`) on an `AsyncLocal`
(`AmbientOrigin.cs:26`, read through `Current` at `:34`, published at `:279-285`), returning a
[`RestoreHandle`](#restorehandle) (`AmbientOrigin.cs:340`) whose `Dispose` puts back whatever origin
was published before (`AmbientOrigin.cs:265-266`, `:287`, `:342`). The publication exists because integration
event handlers are singletons that open their own scope from the root factory, a scope the direct
restore never reaches; so [`TenantContext`](#tenantcontext), [`ScopedUserOverride`](#scopeduseroverride)
and [`CorrelationContext`](group-12-api-hosting-mapping.md#correlationcontext) seed themselves from
`Current` once, when constructed (`AmbientOrigin.cs:230-241`, `TenantContext.cs:19`,
`ScopedUserOverride.cs:30`, `CorrelationContext.cs:13`), and a handler's own scope still runs as the
original interaction. The snapshot is a six-value record (user id, roles, permission claims, tenant,
correlation id, authentication type, `AmbientOrigin.cs:353-359`) whose `BuildPrincipal` (`:363`)
rebuilds the claims principal through the same `AmbientOrigin.BuildPrincipal` the direct restore uses
(`AmbientOrigin.cs:179-206`, `:271`): the user id as `sub`, each role as a role claim and each
permission as a permission claim, so deferred work is granted exactly as the inline request was
(`AmbientOrigin.cs:154-160`). `Suppress` (`AmbientOrigin.cs:331`) withdraws the published
origin behind the same handle type for the one place an explicit choice must win over an enclosing hop,
[`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets)
`CreateTenantScope` (`.../Persistence/DataSources/TenantDataSourceTargets.cs:105`). Every restore site
holds the handle for the whole row or message (`using var origin`, for example
`UpcastingIntegrationEventConsumer.cs:68`), so the next one cannot inherit it.

A restore lands in [`ScopedUserOverride`](#scopeduseroverride)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ScopedUserOverride.cs:27`), a per-scope
carrier holding the principal that did not arrive over HTTP (`ScopedUserOverride.cs:30`, set at `:36`).
The principal itself is never a live ambient value: a scope created during a hop copies the published
origin once, at construction, and owns that copy from then on, so nothing is shared or mutated across
scopes, and an HTTP request (which never publishes an origin) resolves an empty carrier and reads
straight through to the HTTP principal (`ScopedUserOverride.cs:17-26`). It exposes `Clear()` (`:50`)
because the outbox processor keeps one scope for a whole batch and without an explicit clear a row
raised by a user would answer for every later row raised by the system
(`ScopedUserOverride.cs:42-49`). The carrier is read by
[`ImpersonatingCurrentUserService`](#impersonatingcurrentuserservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ImpersonatingCurrentUserService.cs:20`),
which **decorates** rather than replaces whatever
[`ICurrentUserService`](group-08-auth.md#icurrentuserservice) the host registered: with no override
every member reads straight through to the inner service, so an HTTP request behaves exactly as it did
before the decorator existed (`ImpersonatingCurrentUserService.cs:25-35`), and claim values are parsed
in the invariant culture exactly as `CurrentUserService` writes them (`:46-50`). `AddInfrastructure`
applies it with Scrutor's `TryDecorate` *after* `AddServices()` has run its own
`TryAddScoped`, guarded on the presence of the `ScopedUserOverride` registration so a host whose
modules each call `AddInfrastructure` does not stack one wrapper per call
(`DependencyInjection.cs:279-286`). The broker side of the same restore is
[`ConsumerOriginRestore`](#consumeroriginrestore)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/ConsumerOriginRestore.cs:20`),
the one step of the restore that knows about a transport (`ConsumerOriginRestore.cs:13-19`): its
`Apply` (`ConsumerOriginRestore.cs:31`) reads the headers `BrokerMessageBus` stamped (user id, roles,
permissions, tenant, correlation id) from the delivered message's string dictionary, hands them to
`AmbientOrigin.Restore`, and returns the restore handle the consumer holds for the whole consume
(`ConsumerOriginRestore.cs:45-52`, the permissions header at `:49`). It is shared by every consumer
the receive pipeline dispatches to, both
[`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent)
(`.../Messaging/Consumers/IntegrationEventConsumer.cs:76`) and
[`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent)
(`UpcastingIntegrationEventConsumer.cs:64`), each calling it before the inbox is touched because under
database-per-tenant the restored tenant routes the inbox store (`UpcastingIntegrationEventConsumer.cs:59-63`),
so a message reaching a retired contract is restored exactly as one reaching the current contract. The
user id is transported as text and parsed back, and a malformed value is treated as a publisher bug
that yields no identity rather than a reason to fail the consume (`ConsumerOriginRestore.cs:35-43`);
every broker header is a string in the first place, so a broker that widens or retypes application
properties cannot change what the receiver reads
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerHeaders.cs:3-7`).
`[Rubric §11, Security]` is the lens: the identity a background
execution acts as is captured from the request that queued it, never assumed or elevated.

## The broker transport boundary

`AddBrokerMessaging`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:63`) owns
everything that is the same on every broker and hands only the byte-moving part to one
[`IBrokerTransport`](#ibrokertransport)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:22`).
The transports are framework code with no third-party messaging library underneath
([ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)), and the
contract states the division itself: the framework owns the topology, the wire format, the receive
pipeline (origin restore, inbox, retry, redelivery and dead-letter decisions), the outbox-only publish
path and the tracing, while a transport publishes an outgoing message to a topic, delivers each message
on the host's queue to the receive pipeline, and carries out the disposition the pipeline returns
(`IBrokerTransport.cs:7-15`). RabbitMQ and PostgreSQL are built in and every other transport ships in
an adapter package, so the core packages never reference a vendor SDK (`IBrokerTransport.cs:16-20`).
The contract is three members: a `Name` compared case-insensitively against `MessageBus:Provider`
(`IBrokerTransport.cs:28`), a `MaxRedeliveryDelay` that is `null` when the broker has no delay cap
(`:35`; Amazon SQS caps a message delay at 15 minutes, `:30-34`), and `Register(services, context)`
(`:51`), which adds a singleton [`IBrokerPublisher`](#ibrokerpublisher) and a hosted receiver for the
host's queue, and which runs while `AddBrokerMessaging` runs so a missing namespace or connection
string throws at startup rather than at the first publish (`IBrokerTransport.cs:37-47`).
[`IBrokerPublisher`](#ibrokerpublisher)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerPublisher.cs:9`) is called
only by `BrokerMessageBus`, which the outbox processor drains through, so a publish the broker did not
accept must throw and surface to the outbox's retry and circuit breaker (`IBrokerPublisher.cs:3-8`,
`PublishAsync` at `:18`).
[`MessageBusProviders`](#messagebusproviders)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:10`)
names the three values the core handles itself, `InProcess` (the default when the setting is absent,
`MessageBusProviders.cs:16`), `RabbitMq` (`:19`) and `PostgreSql` (`:27`), and keeps a small map from
the adapter-supplied names (`AzureServiceBus`, `AmazonSqs`) to the package and call that provide them,
used only to make the registration error actionable (`MessageBusProviders.cs:29-39`).
`ResolveBrokerTransport` constructs a built-in transport directly, otherwise takes the last registered
`IBrokerTransport` whose name matches, otherwise throws naming the package to reference (or the
`AddBrokerTransport` call to make) and the available providers
(`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:199-232`); an adapter therefore calls
`AddBrokerTransport` (`:174`, a `TryAddEnumerable` singleton that rejects an empty name, `:178-183`)
before the host calls `AddBrokerMessaging`.

The registration order inside `AddBrokerMessaging` is a sequence of startup guards. It returns at once
for `InProcess` (`DependencyInjection.Messaging.cs:72`), fails a broker paired with an explicitly
disabled outbox because the outbox is a broker host's only publish path (`:80`, rationale at
`:234-255`), resolves the transport (`:84`), and then requires `Application:Namespace` (`:89`,
`:257-281`): every topic is prefixed with it, so services that fell back to their own application
names would publish and subscribe on different topics and lose every cross-service event with no error
anywhere. Consumers are declared next. The `configureConsumers` callback receives an
[`IBrokerConsumerBuilder`](#ibrokerconsumerbuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerConsumerBuilder.cs:16`)
with two calls, `RegisterIntegrationEventConsumer<TEvent>` (`:26`) and, for a retired contract,
`RegisterUpcastedIntegrationEventConsumer<TEvent>` (`:40`). There is one queue per host, so two
services consuming the same event never compete for one queue and there is no per-consumer endpoint
configuration to get wrong (`IBrokerConsumerBuilder.cs:9-14`). The internal
[`BrokerConsumerBuilder`](#brokerconsumerbuilder)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:12`)
records one [`BrokerSubscription`](#brokersubscription)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerSubscription.cs:11`) per
event, tagged with its [`BrokerConsumerKind`](#brokerconsumerkind) (`BrokerConsumerKind.cs:4`) and
named through [`BrokerNaming`](#brokernaming) (`BrokerNaming.cs:13`), throws on a second registration
of the same event in either kind (`BrokerConsumerBuilder.cs:47-58`), and maps each subscription to the
closed `IntegrationEventConsumer<TEvent>` or `UpcastingIntegrationEventConsumer<TEvent>`
(`BrokerConsumerBuilder.cs:36-45`), which `AddBrokerMessaging` registers scoped
(`DependencyInjection.Messaging.cs:105`). The collected subscriptions become the host's
[`BrokerTopology`](#brokertopology)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerTopology.cs:10`): the
application namespace, the one queue (`MessageBus:QueueName` or the application name,
`DependencyInjection.Messaging.cs:94-96`) and the subscriptions in registration order, with a
constructor that rejects a duplicate event name a second time (`BrokerTopology.cs:25-34`). A host that
consumes nothing still has a topology: it publishes, and its transport creates no queue
(`BrokerTopology.cs:7-8`). The method then registers the receive pipeline (`:109`), `Replace`s the bus
interfaces (`:119`, `:125`) and the inbox store (`:132-147`), and calls `transport.Register` last, so
the transport sees every framework registration above it (`:150-158`).

The transport receives a [`BrokerTransportContext`](#brokertransportcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportContext.cs:11`):
the topology, also registered as a singleton so a hosted receiver can take it from DI
(`BrokerTransportContext.cs:34-38`), the bound [`MessageBusSettings`](#messagebussettings) (`:41`), the
connection string resolved from `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq`, then
`ConnectionStrings:messaging`, or `null` so the transport keeps its own default host (`:43-48`), and
the configuration for transport-specific keys (`:51`).

Every delivered message goes through one [`IBrokerReceivePipeline`](#ibrokerreceivepipeline)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerReceivePipeline.cs:16`),
whose single `ProcessAsync` takes an [`IncomingBrokerMessage`](#incomingbrokermessage)
(`IncomingBrokerMessage.cs:11`) and returns a [`BrokerDisposition`](#brokerdisposition)
(`IBrokerReceivePipeline.cs:22`). Its implementation,
[`BrokerReceivePipeline`](#brokerreceivepipeline)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:26`),
restores the publisher's trace context as the parent of a Consumer span, resolves the subscription from
the event-name header, deserializes the body, and runs the subscription's consumer (inbox, origin
restore, handlers) through the non-generic [`IBrokerMessageConsumer`](#ibrokermessageconsumer)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IBrokerMessageConsumer.cs:12`)
with in-process exponential retry, each attempt in a fresh DI scope (`BrokerReceivePipeline.cs:12-19`).
The disposition is a closed record family (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerDisposition.cs:8`):
[`Completed`](#completed) (`:14`, shared as `Complete` at `:11`), [`Redeliver`](#redeliver) carrying a
delay and the next redelivery count (`:24`), and [`DeadLetter`](#deadletter) carrying a reason and a
detail (`:33`); a transport applies it and decides nothing itself, because retry counts, intervals and
dead-letter policy live once, in the pipeline (`BrokerDisposition.cs:3-7`). An unknown event name or a
body that does not deserialize is dead-lettered at once as `unknown-event` or `poison`
(`BrokerReceivePipeline.cs:29`, `:32`, `:124-144`); a message whose retries all fail is redelivered
while intervals remain (`:166`) and is dead-lettered as `handler-failed` after that (`:35`, `:176`),
with one Error log and one `broker.fault.count` increment at that point (`:17-19`). It never throws for
a handler or payload failure: only the host's own cancellation escapes, and the transport then leaves
the message unacknowledged so the broker delivers it again (`BrokerReceivePipeline.cs:20-23`). On the
wire, [`OutgoingBrokerMessage`](#outgoingbrokermessage) (`OutgoingBrokerMessage.cs:13`) is what a
publisher sends, [`BrokerHeaders`](#brokerheaders) (`BrokerHeaders.cs:8`) names the transport-level
headers (event name, the message id the inbox dedupes on, the redelivery count, W3C trace context,
`:10-29`), and [`BrokerWire`](#brokerwire)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerWire.cs:12`) holds the two pieces
both hops must agree on: the `MMCA.Common.Messaging` trace source (`BrokerWire.cs:19`) and body JSON
options identical to the outbox payload's, so an event that round-trips through the outbox
round-trips through the broker in the same shape (`:27-37`).

[`BrokerTransportPolicies`](#brokertransportpolicies)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:16`)
holds the receive-side policies as pure functions of `MessageBusSettings`, so the pipeline and every
transport read one definition (`BrokerTransportPolicies.cs:3-8`). `RetryDelay` (`:27`) doubles
`RetryMinIntervalSeconds` per retry up to `RetryMaxIntervalSeconds`, so the defaults wait 1, 2, 4, 8 and
16 seconds (`:18-23`). `BuildRedeliveryIntervals` (`:52`, `:65`) maps the second-level intervals
(one minute, ten minutes, one hour by default, `MessageBusSettings.cs:190`), drops non-positive entries
because a zero interval would turn the second level into a hot loop, and clamps each to the
transport's `MaxRedeliveryDelay` (`BrokerTransportPolicies.cs:42-75`); the pipeline reads the clamped
set once, at construction (`BrokerReceivePipeline.cs:72`). In-process retry absorbs a blip measured in
seconds, redelivery an outage measured in minutes or hours, and every in-process retry is exhausted
before a redelivery is asked for (`BrokerTransportPolicies.cs:9-15`). The backpressure knobs,
`ResolvePrefetchCount` (`:85`) and `ResolveConcurrentMessageLimit` (`:98`), are range-guarded in code
rather than by `[Range]`, because `AddBrokerMessaging` binds the section with
`Get<MessageBusSettings>()`, which never runs DataAnnotations, and a value of zero or less leaves the
transport's own default in place (`:77-82`).

Two transports are built in, written against the same contract an adapter implements.
[`RabbitMqBrokerTransport`](#rabbitmqbrokertransport)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqBrokerTransport.cs:24`)
runs on RabbitMQ.Client. Its topology, named by [`RabbitMqNames`](#rabbitmqnames)
(`RabbitMqNames.cs:19`), is a durable fanout exchange per topic, one durable queue per host bound to
the exchange of every event it consumes, `{queue}-error` for dead letters, and a
`{queue}-delay-{seconds}s` queue per redelivery interval whose message time to live returns each
message to the host queue, so delayed redelivery needs no broker plugin; publishes are persistent and
confirmed, and connections recover automatically (`RabbitMqBrokerTransport.cs:11-17`). `Register`
(`:33-61`) adds a [`RabbitMqPublisher`](#rabbitmqpublisher) (`RabbitMqPublisher.cs:10`) over a
[`RabbitMqChannelOperations`](#rabbitmqchanneloperations) (`RabbitMqChannelOperations.cs:12`) and a
[`RabbitMqConnectionSource`](#rabbitmqconnectionsource) (`RabbitMqConnectionSource.cs:11`) with a
[`RabbitMqProvisioner`](#rabbitmqprovisioner) (`RabbitMqProvisioner.cs:16`), returns early when the
topology has no subscriptions (`RabbitMqBrokerTransport.cs:46-49`), and otherwise adds a hosted
[`RabbitMqReceiver`](#rabbitmqreceiver) (`RabbitMqReceiver.cs:21`) whose concurrency is
`ConcurrentMessageLimit` or else the processor count and whose prefetch is `PrefetchCount` or else
twice the concurrency (`RabbitMqBrokerTransport.cs:88-105`). The connection string must be an
`amqp://` or `amqps://` URI or registration throws; with none the client's `localhost:5672` default
applies (`:19-21`, `:70-86`). [`RabbitMqDispositionApplier`](#rabbitmqdispositionapplier)
(`RabbitMqDispositionApplier.cs:21`), [`RabbitMqHeaders`](#rabbitmqheaders) (`RabbitMqHeaders.cs:11`)
and [`IRabbitMqOperations`](#irabbitmqoperations) (`IRabbitMqOperations.cs:9`) complete the internal
set. [`PostgreSqlBrokerTransport`](#postgresqlbrokertransport)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:36`)
keeps topics, queues and delayed redeliveries in three tables of one PostgreSQL database, defined by
[`PostgreSqlTransportSql`](#postgresqltransportsql) (`PostgreSqlTransportSql.cs:24`), and is core
rather than an adapter because any PostgreSQL is the broker (`PostgreSqlBrokerTransport.cs:10-15`). A
publish inserts one row per subscribed queue in one statement and wakes the receivers with
`pg_notify`; a receiver claims rows with `FOR UPDATE SKIP LOCKED` under a renewed lease and falls back
to polling; a redelivery pushes the row's `visible_after` out, so there is no delay cap; and a dead
letter moves the row to `{schema}.dead_letters` (`PostgreSqlBrokerTransport.cs:16-22`). `Register`
(`:61-94`) adds the [`PostgreSqlMessageStore`](#postgresqlmessagestore) (`PostgreSqlMessageStore.cs:16`)
singleton and the [`PostgreSqlPublisher`](#postgresqlpublisher) (`PostgreSqlPublisher.cs:13`), then the
[`PostgreSqlSchemaMigrator`](#postgresqlschemamigrator) (`PostgreSqlSchemaMigrator.cs:12`) when
`MigrateOnStartup` is on, ahead of the receiver because hosted services start in registration order
(`PostgreSqlBrokerTransport.cs:75-79`), and finally the [`PostgreSqlReceiver`](#postgresqlreceiver)
(`PostgreSqlReceiver.cs:23`) with its [`PostgreSqlReceiverOptions`](#postgresqlreceiveroptions)
(`PostgreSqlReceiverOptions.cs:11`, `PostgreSqlBrokerTransport.cs:86-93`);
[`IPostgreSqlMessageStore`](#ipostgresqlmessagestore) (`IPostgreSqlMessageStore.cs:10`),
[`PostgreSqlClaimedMessage`](#postgresqlclaimedmessage) (`PostgreSqlClaimedMessage.cs:14`) and
[`PostgreSqlDispositionApplier`](#postgresqldispositionapplier) (`PostgreSqlDispositionApplier.cs:17`)
complete the set. Unlike RabbitMQ there is no default host, so a missing connection string fails
registration (`PostgreSqlBrokerTransport.cs:111-117`). Its own keys bind from `MessageBus:PostgreSql`
into [`PostgreSqlTransportSettings`](#postgresqltransportsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlTransportSettings.cs:8`,
`:11`): a `Schema` and `Role` that both default to `transport` (`PostgreSqlTransportSettings.cs:14`,
`:38-42`) and `MigrateOnStartup`, on by default (`:36`), which a host whose database user cannot create
a role and a schema turns off, creating the schema out of band with the same idempotent DDL
(`:30-35`). When an `INpgsqlDataSourceConfigurator` is registered (an RDS, Cloud SQL or Entra token
provider), the transport runs on the same shared `NpgsqlDataSource` the PostgreSQL contexts use for
that connection string, the startup migration included (`PostgreSqlBrokerTransport.cs:30-34`,
`:103-109`). `[Rubric §7, Microservices Readiness]` and `[Rubric §2, Design Patterns]` are the lenses:
the broker is a strategy chosen by configuration, behind one contract, with the vendor code outside the
core ([ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html),
[ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)).

## Assembly anchors

Several pieces of machinery need a `Type` whose `Assembly` identifies a layer: Scrutor's
`FromAssemblyOf<T>()` scans, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`, and
the architecture rules' per-package anchor. That is what the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) pairs are, one per layer (Application, Infrastructure),
each a trivial `static class AssemblyReference` holding `Assembly` / `AssemblyName` statics
(`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5-9`) beside a non-static `class
ClassReference` (`AssemblyReference.cs:11`) for the places a generic constraint forbids a static type.
`AddApplication` uses the Application pair for the common validators
(`MMCA.Common.Application/DependencyInjection.cs:59`) and `AddInfrastructure` uses the Infrastructure
pair to scan entity configurations (`MMCA.Common.Infrastructure/DependencyInjection.cs:134-139`). They
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
`MMCA.Common.Infrastructure/DependencyInjection.cs:73-76`), so misconfiguration **fails fast at
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
`RemoteDependencies` list (`ModuleSettings.cs:37`) that flips a dependency from "in-process" to
"satisfied by an extracted service", with a worked monolith-after-extraction config example on the
property itself (`ModuleSettings.cs:24-35`). One more Application-layer settings class exists for a
layering reason rather than a composition one: [`QueryCachePipelineSettings`](#querycachepipelinesettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:20`) exposes
the single `Cache:PopulateLockTimeout` knob the caching query decorator needs, because that decorator
lives in Application and Application cannot reference Infrastructure where
[`CacheSettings`](group-09-caching.md#cachesettings) binds the rest of the same section
(`QueryCachePipelineSettings.cs:4-18`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:18-22`); `AddCaching`
binds both from the same section so they cannot drift
(`MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:48-56`).

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
(`MMCA.Common.Infrastructure/DependencyInjection.cs:83-84`) and passes only when the top-level section
names a database on any engine or one `DataSources` entry does
(`ConnectionStringSettingsValidator.cs:47-53`, `:56-72`), failing with a message that lists both shapes
because which one is missing depends on whether the host is a single-database monolith or a
database-per-module one (`ConnectionStringSettingsValidator.cs:38-45`).
[`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) with its per-entry
[`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:19`) is the
logical-to-physical source map for database-per-service, built *directly* from
`Get<Dictionary<...>>` rather than through the options pipeline
(`MMCA.Common.Infrastructure/DependencyInjection.cs:86-90`) because a root-level dictionary section
does not bind that way, with a constructor that rejects an empty or reserved `"Default"` key
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourcesSettings.cs:27-40`).

The rest of the platform sections follow the same discipline: [`MessageBusSettings`](#messagebussettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:13`), whose
`Provider` is a plain string defaulting to [`MessageBusProviders`](#messagebusproviders)`.InProcess`
(`MessageBusSettings.cs:25`) rather than an enum, because any value beyond the three built-in names
selects a transport an adapter package registers (the boundary is described in its own section
below). The same `Provider` resolves the inbox and outbox defaults, both on for any broker and off for
`InProcess` unless set explicitly (`MessageBusSettings.cs:142`, `:185`). `AddBrokerMessaging`
short-circuits entirely for `InProcess`
(`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:72-75`) and otherwise `Replace`s both
[`IMessageBus`](group-04-events-outbox.md#imessagebus) and
[`IEventBus`](group-04-events-outbox.md#ieventbus) with their broker-backed counterparts
(`DependencyInjection.Messaging.cs:119`, `:125`,
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
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:30-33`); and the delivery
channels, [`SmtpSettings`](#smtpsettings) and
[`PushNotificationSettings`](#pushnotificationsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:8`,
section `PushNotifications`, with the hub path defaulting to `/hubs/notifications` and a
`MaxConnectionsPerUser` of 20, `PushNotificationSettings.cs:11`, `:25`, `:50`), bound with
`ValidateOnStart` by `AddPushNotifications`
(`MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:43-46`). OS-level push
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) and managed file
storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html))
have no settings type and no implementation in the core packages at all, because the core is
cloud-neutral: `AddServices` registers a null-object default behind each contract,
[`NullNativePushSender`](#nullnativepushsender) and
[`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) (`DependencyInjection.cs:377-378`) and
[`NullFileStorageService`](#nullfilestorageservice) (`DependencyInjection.cs:385`), each through
`TryAdd`, and a vendor adapter package (`MMCA.Common.Azure`, `MMCA.Common.Aws` or `MMCA.Common.Gcp`)
replaces it when its own section is enabled and complete (`DependencyInjection.cs:373-376`,
`:356-358`; the adapters are in [group 28](group-28-common-cloud-provider-adapters.md)). Image
normalization is deliberately not a framework service: decoding needs a native image library every
consumer of the package would otherwise carry (`DependencyInjection.cs:382-384`). Application code
therefore always resolves something. What the core does keep is the vendor-free half of push,
[`NativePushPayloads`](#nativepushpayloads)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:13`),
pure `System.Text.Json` builders for the FCM v1 message and the APNs alert (`NativePushPayloads.cs:20`,
`:42`) that the Notification Hubs and SNS adapters send, while the FCM adapter maps the same fields
onto FirebaseAdmin's typed message, so one notification looks the same whichever cloud delivered it
(`NativePushPayloads.cs:5-12`). `[Rubric §2, Design Patterns]` again: a null object, not a nullable
dependency. `AddPushNotifications` does not share that adapter shape: it always adds SignalR, adds the
Redis backplane when a `redis` connection string is present, replaces the in-app notification
sender and live-channel publisher with their SignalR-backed implementations, and `Replace`s
SignalR's default user-id provider with the claim-based one, because `AddSignalR` has already
registered its own and a `TryAdd` would never take effect
(`DependencyInjection.Notifications.cs:45-67`).

A null-object default is right for a host that never switched a channel on and wrong for one that did,
so `AddInfrastructure` closes the gap with a startup tripwire.
[`CloudAdapterTripwire`](#cloudadaptertripwire)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:32`) is an
`IValidateOptions` over the empty
[`CloudAdapterTripwireOptions`](#cloudadaptertripwireoptions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwireOptions.cs:8`),
a type whose only job is to ride `ValidateOnStart` so the check runs with the other startup validators
before any hosted service starts (`CloudAdapterTripwireOptions.cs:3-7`). When `NativePush:Enabled` is
true (`CloudAdapterTripwire.cs:35`) and `INativePushSender` still resolves, in a scope, to
`NullNativePushSender`, the host fails with a message naming each adapter package, its registration
call and the keys it needs (`CloudAdapterTripwire.cs:62-82`); otherwise a deployment that lost the
adapter call would start, pass its health checks and silently drop every push
(`CloudAdapterTripwire.cs:16-22`). File storage is deliberately not checked, because a `FileStorage`
section is routinely shared configuration and so does not declare intent, and a host that does store
files without an adapter is not silent anyway: `NullFileStorageService` fails every upload with
`FileStorage.NotConfigured` (`CloudAdapterTripwire.cs:24-29`). Beside it,
[`StartupConfigurationSummaryService`](#startupconfigurationsummaryservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/StartupConfigurationSummaryService.cs:35`)
is an `IHostedService` that writes one Information line at start naming the posture the host actually
resolved: the MMCA.Common version stamped on the assembly at build time, the release tag or `0.0.0-dev` (`StartupConfigurationSummaryService.cs:49-52`),
the configured database engines, the bus provider with its `EnableDelayedRedelivery` value, the cache
mode and the tenancy mode (`StartupConfigurationSummaryService.cs:55-74`). It logs names and flags
only, deriving the engines from whether a connection string is set and never from its text
(`StartupConfigurationSummaryService.cs:20-23`), and it names the cache tier without resolving
`ICacheService`, so a Redis-backed host does not open its connection at startup (`:93-104`). It also
emits the one Warning a RabbitMQ host with delayed redelivery off needs, because a handler failure
that outlasts the in-process retries then dead-letters instead of being rescheduled
(`StartupConfigurationSummaryService.cs:82-85`, `:25-30`). `[Rubric §13, Observability & Operability]`
covers both: "which version, which bus, which cache?" is answered by the first lines of the log. One
binding is deliberately
elsewhere: `JwtSettings` is bound by the API layer's `AddCommonAuthentication`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-137`),
so a host that skips authentication never pays for a JWT section it does not have.

The three opt-in feature sections follow the same shape with one extra rule worth reading closely.
[`SchedulerSettings`](#schedulersettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerSettings.cs:16`) and
[`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:16`) each make
`Enabled` (default `false`) the *single* gate over both the behavior and whether the backing table is
mapped into the model at all (`SchedulerSettings.cs:10-14`, `AuditTrailSettings.cs:10-15`), so a host
that never opts in keeps exactly the migrations it had. Their tunables are ranged the same way
(`PollingIntervalSeconds` default 30 and `LeaseSeconds` default 300, `SchedulerSettings.cs:28-46`;
`RetentionDays` default 90, `AuditTrailSettings.cs:37-38`), and per-job retiming lives in
[`ScheduledJobOverrideSettings`](#scheduledjoboverridesettings) bound from `Scheduler:Jobs:{Name}`
(`SchedulerSettings.cs:63`, `:66-74`). [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:51`) adds the
collection-binding subtlety: `ResolutionOrder` and `ExcludedPathPrefixes` bind as *empty* lists and the
framework reads `EffectiveResolutionOrder` / `EffectiveExcludedPathPrefixes` instead
(`TenancySettings.cs:82`, `:106`), because the configuration binder ADDS to a pre-populated collection
rather than replacing it, so a non-empty default would leave a host running the framework's entries as
well (`TenancySettings.cs:42-49`). Its per-tenant database routing is pure configuration:
[`TenantEntrySettings`](group-07-persistence-ef-core.md#tenantentrysettings) (`TenancySettings.cs:127`) keys
[`TenantDataSourceOverrideSettings`](group-07-persistence-ef-core.md#tenantdatasourceoverridesettings) (`TenancySettings.cs:144`) by
**physical** data source name, and [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:24`) fails
the boot when an override names a source that does not exist, when it declares no connection string at
all, or when the resolution order names [`TenantResolutionStrategy`](group-07-persistence-ef-core.md#tenantresolutionstrategy) `Host`,
which is defined but not implemented (`TenancySettings.cs:22-28`). Every one of those failures is a
misconfiguration that would otherwise surface as silent cross-tenant behavior, which is exactly the bug
class tenancy exists to prevent, so it is worth a failed boot. `[Rubric §11, Security]` is the category
there.

Two composition questions are answered by a small **resolver** rather than by a settings property,
because a bound property cannot distinguish "configured false" from "never configured" and the safe
answer differs by environment. [`ApplicationNamespace`](#applicationnamespace)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:35`) is the
one name every piece of *shared* infrastructure is namespaced by: Redis cache keys, distributed-lock
keys, distributed rate-limit counter keys, the Redis output-cache `InstanceName`, the SignalR Redis
backplane channel prefix and the broker's endpoint prefix (`ApplicationNamespace.cs:7-12`). It
resolves the explicit `Application:Namespace` key when set (`:32`, `:54-60`), otherwise the host's
application name, otherwise the `"app"` fallback (`:35`), and sanitizes the result to characters that
are safe in a Redis key, a channel name and a queue name (`:43-44`). Composition reads it where the
shared resource is wired: `AddPushNotifications` for the backplane channel prefix
(`MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:59`), `AddBrokerMessaging` for the
endpoint prefix when `MessageBus:EndpointPrefix` is blank (`DependencyInjection.Messaging.cs:100-102`),
and the cache-key builder
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:95`). The default is
per-application rather than empty because two hosts pointed at one Redis or one broker otherwise share
every keyspace, and `NotificationHub` ships *in the framework*, so its backplane channel name is
identical in every consumer and a user-targeted push in one application reaches the other
application's clients holding the same numeric user id (`ApplicationNamespace.cs:15-26`).
[`SmtpTransportSecurity`](#smtptransportsecurity)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpTransportSecurity.cs:26`) has the same
three-step shape for TLS: the explicit `Smtp:EnableSsl` key, then configuration, then secure unless
the host says it is Development (`SmtpTransportSecurity.cs:29`, `:37-49`). `SmtpEmailSender` resolves
it once at construction (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:57`)
through the overload that also logs one startup warning when a non-Development host turned TLS off for
a configured relay, so that decision is visible in the logs of the deployment that made it
(`SmtpTransportSecurity.cs:51-58`). Development keeps the permissive default because local development
targets MailDev, which offers no TLS (`SmtpTransportSecurity.cs:21-25`). `[Rubric §11, Security]`
covers both: the secure value is the one you get by configuring nothing.

## The two routing attributes

Two attributes, both in `MMCA.Common.Infrastructure`, both `Inherited = true` so they ride down a
configuration class hierarchy, encode *where an entity is stored* declaratively: the per-entity half of
the database-per-service strategy
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
[`UseDataSourceAttribute`](#usedatasourceattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13-18`) names the
**engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): SQL Server, PostgreSQL, Cosmos or SQLite)
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
and Store each own an Identity module, and thirteen of their account use cases had drifted into
line-identical copies (or would have), so the workflow was hoisted into abstract bases that each app
subclasses:
[`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:55`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:22`),
[`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:19`),
[`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:96`),
the erasure workflow behind
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html),
[`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49`),
the data-subject access workflow, and the password-recovery pair
[`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:37`)
and [`ResetPasswordHandlerBase<TUser, TCommand>`](#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:42`),
which run the token issue-and-redeem flow described in
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) and collapse every
rejection to one `Auth.InvalidResetToken` error so the endpoint reveals nothing about which addresses
hold accounts (`ResetPasswordHandlerBase.cs:20-22`). Both password-writing bases also revoke every
live refresh session on the account, so a stolen refresh chain cannot outlive the remediation the
user just performed, and both persist that revocation **before** the password save, so a revoke
failure throws while the password is still unchanged and the user simply retries
(`ChangePasswordHandlerBase.cs:43-45`, `:122-129`; `ResetPasswordHandlerBase.cs:36-39`, `:100-108`,
where the revoke also stands when the aggregate then rejects the new password;
[ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). The
change-password base also throttles a wrong current password through its own
`password-change:{userId}` failed-attempt counter, keyed apart from sign-in so that lockout never
locks the owner out of signing in (`ChangePasswordHandlerBase.cs:47-52`). The two email-sending bases
compose their messages through [`UserEmailResources`](#useremailresources)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/Emails/UserEmailResources.cs:15`), which reads
its `.resx` siblings through a plain `ResourceManager` because the Application layer references no
`Microsoft.Extensions.Localization` (`UserEmailResources.cs:8-14`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). `InRecipientCulture`
runs the composition under the recipient's stored `PreferredCulture`, resolved to the closest
supported culture, and puts the request's culture back afterwards (`UserEmailResources.cs:29-45`);
`Get` throws on a missing key rather than sending a blank line (`:50-52`), and `Plural` picks the
`.One` / `.Other` form the UI resources use (`:64-65`). The call sites are
`ForgotPasswordHandlerBase.cs:82` and `SendEmailConfirmationHandlerBase.cs:111`, and the subject stays a
`protected virtual` hook an app can override (`ForgotPasswordHandlerBase.cs:114`,
`SendEmailConfirmationHandlerBase.cs:154`).

Six more bases cover the account-security workflows a host opts into with
`AddTwoFactorAuthentication` (`MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:47`) and
`AddEmailConfirmation` (`:68`). The two-factor four are a deliberate two-step enrollment:
[`BeginTwoFactorEnrollmentHandlerBase<TCommand>`](#begintwofactorenrollmenthandlerbasetcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/BeginTwoFactorEnrollmentHandlerBase.cs:41`)
mints a secret and stores it **without** activating the factor, so an authenticator that was never
really keyed cannot lock the owner out, and re-running it on an enrolled account fails rather than
silently re-keying a live secret (`BeginTwoFactorEnrollmentHandlerBase.cs:14-25`);
[`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>`](#confirmtwofactorenrollmenthandlerbasetcommand)
(`ConfirmTwoFactorEnrollmentHandlerBase.cs:39`) verifies a time-based code (a recovery code cannot
confirm an enrollment, because the step exists to prove the app holds the secret) and generates the
first recovery-code set in the same call that activates the factor, so an account is never in the
state "second factor on, no way back in" (`ConfirmTwoFactorEnrollmentHandlerBase.cs:15-24`);
[`DisableTwoFactorHandlerBase<TCommand>`](#disabletwofactorhandlerbasetcommand)
(`DisableTwoFactorHandlerBase.cs:36`) demands a live factor to turn the factor **off**, because
otherwise whoever holds a stolen access token can strip the control that would have stopped them, and
here a recovery code *is* accepted since a user who lost the device is exactly who needs it
(`DisableTwoFactorHandlerBase.cs:14-24`); and
[`RegenerateRecoveryCodesHandlerBase<TCommand>`](#regeneraterecoverycodeshandlerbasetcommand)
(`RegenerateRecoveryCodesHandlerBase.cs:36`) replaces the whole set rather than appending to it, so a
list the user believes is copied stops working (`RegenerateRecoveryCodesHandlerBase.cs:15-24`). The
three bases that check a code after sign-in (confirm, disable, regenerate) share one per-account
failed-attempt budget, keyed by [`TwoFactorAttemptKey`](#twofactorattemptkey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/TwoFactorAttemptKey.cs:15`)
as `two-factor:{userId}` (`TwoFactorAttemptKey.cs:20-21`), so a wrong code on any of them counts
against the same lockout, while staying separate from the email-keyed sign-in counter and the
change-password one so a lockout here cannot lock the owner out of signing in
(`TwoFactorAttemptKey.cs:5-14`; used at `ConfirmTwoFactorEnrollmentHandlerBase.cs:75`,
`DisableTwoFactorHandlerBase.cs:54`, `RegenerateRecoveryCodesHandlerBase.cs:57`). The
email-confirmation pair mirrors the password-recovery pair's privacy rule:
[`SendEmailConfirmationHandlerBase<TUser, TCommand>`](#sendemailconfirmationhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:51`)
returns success for every outcome, including an unknown, already-confirmed, throttled or unsendable
address, so the response carries no signal about which addresses hold accounts
(`SendEmailConfirmationHandlerBase.cs:22-29`), and
[`ConfirmEmailHandlerBase<TUser, TCommand>`](#confirmemailhandlerbasetuser-tcommand)
(`ConfirmEmailHandlerBase.cs:33`) collapses every rejection to one
`Authentication.InvalidConfirmationToken` error and consumes the token **before** the save, matching
`ResetPasswordHandlerBase`, because leaving it live until the write succeeds opens a replay window
(`ConfirmEmailHandlerBase.cs:16-26`). Like the other bases these take the app's command record as a
type parameter and read it only through this group's small contracts, and the aggregate constraint is
the capability the workflow needs rather than a concrete type (`IEmailConfirmableUser` on
`ConfirmEmailHandlerBase.cs:37`).

Each base is generic in the app's `User` aggregate and in the app's own command or query record, and
reads that record only through the small contracts in this group:
[`IUserScopedRequest`](#iuserscopedrequest) (`UserId`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8`),
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) (adds the embedded payload,
`IUserScopedCommand.cs:14`), and [`IUserOwnedRequest`](#iuserownedrequest) (adds `CurrentUserId` and
`CurrentUserRole`, `IUserOwnedRequest.cs:8`). The commands stay app-side precisely because the two apps
disagree on their pipeline attributes: ADC marks the password-change command `ICacheInvalidating` and
Store does not (`ChangePasswordHandlerBase.cs:18-37`). Note that
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) is deliberately *not*
`ICommandWithRequest<TRequest>`: implementing the latter also opts a command into automatic
`CommandRequestValidator` registration, which is a per-app decision, so implementing this one alone
changes no pipeline behavior (`IUserScopedCommand.cs:6-12`). That choice has a consequence the
framework answers with a shared validator:
[`ChangePreferencesCommandValidatorBase<TCommand>`](#changepreferencescommandvalidatorbasetcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommandValidatorBase.cs:29`)
is a *command* validator, because a validator over the request record would never run for a command
that carries its payload through `IUserScopedCommand`, and it is abstract because module scanning
registers validators from the app assemblies only, so each app declares a one-line sealed subclass
(`ChangePreferencesCommandValidatorBase.cs:14-20`). It requires the request and rejects an unsupported
culture or a theme other than light or dark, while a `null` field passes as "leave unchanged"
(`ChangePreferencesCommandValidatorBase.cs:42-60`, `:8-13`), and it reads the accepted values from the
same definitions the aggregate enforces, so the rejection moves in front of the handler without a
second definition of what is valid (`:22-27`).

The export base is the most instructive of the thirteen, because it is where the container-level and
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:20`), the
owner-or-privileged-role decision returning a `Forbidden`
[`Error`](group-01-result-error-handling.md#error) or `null` (`UserOwnershipRule.cs:37`) with the
privileged-role test passed in already evaluated because each app owns its own role vocabulary
(`UserOwnershipRule.cs:14-18`), while each base is itself a `partial` class that declares its own
`[LoggerMessage]` audit lines (for example `ChangePasswordHandlerBase.cs:147`);
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
chapter cooperating. The host calls `AddInfrastructure(builder.Configuration)` (`Program.cs:354`), opts
into the scheduler and the audit trail (`Program.cs:358`, `:350`), then calls `AddModuleHost` with the
single assembly that declares `ConferenceModule` and a Serilog-backed
[`ModuleLoader`](#moduleloader) logger (`Program.cs:378-381`), and passes the resulting
[`ModulesSettings`](#modulessettings) to `AddAPI` (`Program.cs:383`). The whole handler-contributing
sequence then goes inside one `AddMmcaApplicationPipeline` call (`Program.cs:415-421`): step one is
`moduleHost.RegisterModules` (module discovery), step two replaces the disabled Engagement stub with a
real gRPC client (`AddEngagementBookmarkCountClient()`), and step three is `AddBrokerMessaging` with
its integration-event consumers, so [`MessageBusSettings`](#messagebussettings) `Provider` decides
whether [`IMessageBus`](group-04-events-outbox.md#imessagebus) stays the default
[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:366`) or is replaced by the
framework's own [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) over the
[`IBrokerTransport`](#ibrokertransport) registered for that provider name
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:72-75`, `:84`,
`:119`). Because this is the *Conference* service, only the Conference module is
`Enabled` in its configuration; every other discovered module takes the `RegisterDisabledStubs` path.
The pipeline call closes with `AddApplicationDecorators()` and seals the collection, so the decorators
wrap the now-registered Conference handlers and any later handler registration throws rather than
running bare. Afterwards the host adds module health checks from the loader (`Program.cs:444`) and
finally `app.Services.InitializeDatabaseAsync(moduleHost.ApplicationSettings, moduleHost.ModuleLoader)`
(`Program.cs:457`) applies migrations and runs the module seeders the loader collected. The exact same
module assemblies, dropped into a monolith host with every module `Enabled`, would Kahn-sort into one
in-process graph with no gRPC clients, which is precisely the reversibility
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is after.

### AssemblyReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the assembly that contains it plus that assembly's simple name, for use as a stable anchor when something needs to say *"scan the assembly this type lives in."* This section covers the **Application-layer** copy; the framework ships a near-identical copy in every layer package, and the copies that belong to other groups get their own sections there.

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, and that purity is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems are solved with recognised patterns; the marker (or anchor) type is the idiomatic way to hand an `Assembly` to a scanner without coupling to an incidental concrete class. `[Rubric §1, SOLID]` (DIP): registration code depends on a deliberate, meaningless token rather than on `typeof(SomeRandomHandler).Assembly`, so renaming or moving any real type never breaks the scan. Repeating the identical `AssemblyReference` plus [`ClassReference`](#classreference) pair in every package keeps each assembly self-describing with no cross-layer reference at all.

- **Walkthrough**: two `public static readonly` fields resolved once at type initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:7`); `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` null-coalescing fallback (`AssemblyReference.cs:8`), so the field is never null even if the runtime reports no simple name. The Application copy carries no XML doc, and neither does the one other Core copy, in Infrastructure, which is identical apart from its namespace (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5-8`).

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and one per package means an assembly can be named without referencing anything inside it. The per-module Application assemblies follow the same convention (see the module copies in [group-22](group-22-engagement-module.md#assemblyreference) and [group-24](group-24-identity-module.md#assemblyreference)).

- **Where it's used**: as the assembly source for Scrutor scans and FluentValidation discovery, usually through its non-static companion (next section) because those helpers are generic.

- **Caveats / not-in-source**: the architecture-fitness map does **not** route through `AssemblyReference` for this layer. `CommonArchitectureMap` pins one anchor type per package, and for six of the seven mapped layers that anchor is a real type (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`); only the UI layer uses a dedicated marker, `UISharedAssemblyReference` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:21-27`).

---

### ClassReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference): an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern introduced under [`AssemblyReference`](#assemblyreference). C# **static classes cannot be used as generic type arguments**, and the registration helpers that take a marker are constrained to an instantiable reference type: `ScanModuleApplicationServices<TAssemblyMarker>()` declares `where TAssemblyMarker : class` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:188-189`) and so does [`MmcaApplicationPipelineBuilder.ScanModule<TAssemblyMarker>()`](#mmcaapplicationpipelinebuilder) (`MmcaApplicationPipelineBuilder.cs:27-28`). `ClassReference` fills that slot without weakening `AssemblyReference`'s static-ness. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token (`ScanModuleApplicationServices<ClassReference>()`) is the entire registration ceremony a new module needs.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11`). No members. Its only meaningful property is the assembly it belongs to, read by the scanner through `typeof(TAssemblyMarker).Assembly` (`DependencyInjection.cs:190`) before it hands that `Assembly` to the assembly-typed overload. The Infrastructure copy declares the same undocumented, body-less type (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:11`).

- **Why it's built this way**: keeping a separate non-static anchor sidesteps the static-class generic-argument restriction while leaving `AssemblyReference` static (and therefore impossible to instantiate accidentally). Every module's Application assembly defines its own `ClassReference`, so each module scans itself by passing its local copy.

- **Where it's used**: as the `TAssemblyMarker` argument in [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection). All three ADC module composition roots call `services.ScanModuleApplicationServices<ClassReference>()` with their own local copy (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:80`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:147`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:94`), as do Store's three (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/DependencyInjection.cs:53`, `.../Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:51`, `.../Sales/MMCA.Store.Sales.Application/DependencyInjection.cs:65`) and Helpdesk's single module (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:34`). The framework root [`AddApplication()`](#dependencyinjection) passes the Application-layer copy to `AddValidatorsFromAssemblyContaining<ClassReference>()` (`DependencyInjection.cs:49`).

---

### DecoratorPipelineSeal
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:313` · Level 0 · class (private, sealed)

- **What it is**: a private, empty marker class that [`DependencyInjection`](#dependencyinjection) registers into the service collection as a singleton **instance** the moment `AddApplicationDecorators()` finishes. Its presence in the descriptor list is the record that the CQRS decorator pipeline has been closed on that collection. It is never resolved and never depended on: its only job is to be there.

- **Depends on**: nothing. It has no members and no base type beyond `object`.

- **Concept introduced, an ordering invariant enforced by a marker registration.** The framework's one hard composition rule is that `AddApplicationDecorators()` must run **after** every handler registration, because Scrutor's `TryDecorate` can only wrap registrations that already exist (see [`DependencyInjection`](#dependencyinjection) for the full pipeline). A handler registered afterwards resolves completely unwrapped: no feature gate, no authorization, no validation, no timeout, no transaction, and nothing fails at startup to say so. `[Rubric §15, Best Practices & Code Quality]` assesses whether a rule that has to be obeyed is *enforceable* rather than merely documented: instead of leaving the ordering as a comment, the framework leaves a token in the container and has every handler-contributing entry point check for it first. `[Rubric §15, Best Practices and Code Quality]`: making the marker `private` means no consumer can register, resolve, or fake it, so the signal cannot be forged from outside. `[Rubric §14, Testability]`: the same marker is what `VerifyDecoratorPipeline()` reads to tell "no handler is wrapped" apart from "some handler is not wrapped", which are two different failures with two different messages.

- **Walkthrough**
  - **Declaration**: `private sealed class DecoratorPipelineSeal;` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:313`), sitting outside the `extension(IServiceCollection)` block beside the three private helpers that use it, with its role written into the XML doc (`:694-698`).
  - **`SealPipeline`** (`:712-713`): a one-line `services.TryAddSingleton(new DecoratorPipelineSeal())`. Registering an **instance** rather than a type means nothing is ever constructed lazily, and `TryAdd` means a second call is a no-op at the descriptor level. It is called at the very end of `AddApplicationDecorators()`, after all thirteen `TryDecorate` calls (`:145`).
  - **`IsPipelineSealed`** (`:701-710`): a linear scan of the collection comparing `descriptor.ServiceType` to `typeof(DecoratorPipelineSeal)`. No provider is built, so the check is safe to run mid-composition and costs one pass over the descriptor list.
  - **`ThrowIfPipelineSealed`** (`:715-725`): the guard itself. When the marker is present it throws an `InvalidOperationException` naming the offending call and spelling out both remedies, move the call ahead of `AddApplicationDecorators()` or compose the whole sequence with `AddMmcaApplicationPipeline(...)` (`:719-723`). Every entry point that can contribute a handler opens with it: `AddApplicationDecorators` itself (`:117`, which is what makes a second call throw), `ScanModuleApplicationServices` (`:182`), `AddEntityCrud` (`:335`), `AddEntityUpdateVerb` (`:397`), `AddEntityUpdate` (`:448`) and `AddMmcaApplicationPipeline` (`:614`).
  - **The two deliberate non-guards**: `AddCommandRequestValidator<TCommand, TRequest>()` (`:475`) and `AddApplicationProfiling()` (`:565`) do not check the marker. A validator is not a handler, and the profiling pair is an outer decoration that is *supposed* to be applied on top of the closed pipeline; `ApplicationPipelineCompositionTests` pins that second case as allowed behavior (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:139-144`).
  - **Read by `VerifyDecoratorPipeline()`** (`:649-656`): before inspecting any handler descriptor it asks `IsPipelineSealed`, and when the answer is no it throws the distinct "the pipeline was never closed" message rather than listing every handler as undecorated.

- **Why it's built this way**: a marker in the collection is the only piece of state that travels with an `IServiceCollection`, which is what the guard needs, because the ordering rule is a property of *that collection* and not of the process. Registering it as an instance keeps the check allocation-free at resolution time (nothing ever resolves it) and keeps it invisible to consumers, which is why it is `private` rather than `internal`.

- **Where it's used**: only inside `DependencyInjection.cs`, by the four helpers above. Its observable effects are the exception messages tested in `ApplicationPipelineCompositionTests` (`:114-131`, `:182-188`).

- **Caveats / not-in-source**: the seal records that the decorators ran, not that they ran *correctly*. A host that registers a handler after `AddApplicationDecorators()` through a path with no guard, for example a bare `services.AddScoped<ICommandHandler<...>, ...>()`, still slips through; catching that is exactly what `VerifyDecoratorPipeline()` exists for, and it has to be called explicitly by a fitness test.

---

### InternalCommandDeadLetter
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandAdministration.cs:99` · Level 0 · record (sealed)

- **What it is**: the read-model row [`IInternalCommandAdministration`](#iinternalcommandadministration)`.ListDeadLettersAsync` hands back for one internal-command row whose retry attempts are exhausted and that will never run again without an explicit requeue.

- **Depends on**: BCL types only (`Guid`, `string`, `DateTime`, the nullable `string?` and `DateTime?`). Nothing first-party, which is why it sits at Level 0 despite being the return shape of a Level 3 interface.

- **Concept introduced, a narrow read projection over an operational queue.** `[Rubric §13, Observability and Operability]` assesses whether an operator gets exactly what a triage screen needs: `DataSource` names which relational source the row lives in, `CommandType` and `ScheduledOn`/`CreatedOn` say what was supposed to run and when, `Attempts` and `LastError` say why it stopped, and `DeadLetteredOn` says when it stopped mattering. `[Rubric §3, Clean Architecture]`: declaring the record in Application, the same layer as [`IInternalCommandAdministration`](#iinternalcommandadministration), keeps the administration contract free of an Infrastructure/EF dependency.

- **Walkthrough**: eight positional parameters on a `sealed record` (`IInternalCommandAdministration.cs:99-107`): `Id` (`Guid`), `DataSource` (`string`), `CommandType` (`string`), `ScheduledOn` (`DateTime`), `CreatedOn` (`DateTime`), `Attempts` (`int`), `LastError` (`string?`, null only when a row was dead-lettered without ever throwing, for example after `MaxAttempts` was lowered), `DeadLetteredOn` (`DateTime?`).

- **Why it's built this way**: a positional record gives structural equality for free, which the type's only production consumer, `ListDeadLettersAsync`'s materialization, does not need but a test comparing expected rows does.

- **Where it's used**: the element type of `Task<Result<IReadOnlyList<InternalCommandDeadLetter>>>` returned by [`IInternalCommandAdministration.ListDeadLettersAsync`](#iinternalcommandadministration) (`IInternalCommandAdministration.cs:42`), implemented by `InternalCommandAdministration` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandAdministration.cs`).

- **Caveats / not-in-source**: no shipped UI or API endpoint renders this type in this workspace; it is consumed only by the administration implementation and its tests.

---

### InternalCommandNameAttribute
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/InternalCommandNameAttribute.cs:25` · Level 0 · class (sealed)

- **What it is**: an attribute that gives an [`IInternalCommand`](#iinternalcommand) implementation a stable, explicit serialization identity, stored in place of its CLR type name so the command can be renamed or moved without breaking rows already persisted.

- **Depends on**: `System.Attribute` only.

- **Concept introduced, a stable wire identity decoupled from the CLR type name.** `[Rubric §29, Reliability and Resilience]`: a durable job queue persists a command's type identity alongside its serialized payload, and a CLR type name is not a safe long-term identity, a rename or a namespace move changes it and orphans every already-scheduled row. `InternalCommandNameAttribute` breaks that coupling: the constructor validates and stores an explicit `Name` (`:58`, `Validated` helper at `:66-70`) that a resolver looks up independently of the type's runtime name.

- **Walkthrough**: `public sealed class InternalCommandNameAttribute(string name) : Attribute` (`:25`), a primary-constructor attribute with one member, `public string Name { get; } = Validated(name);` (`:58`). `Validated` (`:66-70`) calls `ArgumentException.ThrowIfNullOrWhiteSpace(name)` before returning it, so a blank identity fails at attribute-application time (effectively at the first resolution, since attribute arguments are evaluated lazily) rather than silently landing in storage where it could never be resolved back to a type.

- **Why it's built this way**: rejecting an empty name at construction, rather than allowing it and failing later at lookup, moves the failure to the earliest possible point and keeps `InternalCommandNameResolver` free of a null/blank branch.

- **Where it's used**: read by `InternalCommandNameResolver` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandNameResolver.cs`) to translate between a command's declared name and its CLR type, and by `InternalCommandMessage` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandMessage.cs`) when persisting a scheduled row. [`IInternalCommand`](#iinternalcommand) implementations are expected to carry it, though the interface itself does not enforce that at compile time.

- **Caveats / not-in-source**: nothing in the `IInternalCommand` interface contract requires this attribute; a command with no `InternalCommandNameAttribute` falls back to whatever `InternalCommandNameResolver` does for an unnamed type, not documented at this type's own declaration site.

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

- **Why it's built this way**: the callback shape is what makes the ordering rule structural instead of advisory. `AddMmcaApplicationPipeline` runs `AddApplication()`, invokes the callback with a freshly constructed builder, and then returns `AddApplicationDecorators()` (`MMCA.Common.Application/DependencyInjection.cs:226-235`), so the decorators are last by construction. Everything that is not a handler registration (infrastructure, API, telemetry, options, health checks) deliberately stays *outside* the call, because its order relative to the decorators does not matter (`MMCA.Common.Application/DependencyInjection.cs:214-215`).

- **Where it's used**: constructed in exactly one place, `AddMmcaApplicationPipeline` (`MMCA.Common.Application/DependencyInjection.cs:226`). Every ADC and Store service host composes through it, by way of the `ConfigurePipeline` callback it hands to `AddMmcaServiceHost`: ADC Conference (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:357-360`), Identity (`.../MMCA.ADC.Identity.Service/Program.cs:288`), Engagement (`.../MMCA.ADC.Engagement.Service/Program.cs:278`), Notification (`.../MMCA.ADC.Notification.Service/Program.cs:215`), Store Catalog (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:106-112`), Sales (`.../MMCA.Store.Sales.Service/Program.cs:234`) and Identity (`.../MMCA.Store.Identity.Service/Program.cs:211`). The architecture fitness tests replay the same shape, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:52-53` and `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:34`.

- **Caveats / not-in-source**: the MMCA.Helpdesk host does not use the builder. It writes the three-call sequence by hand (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:66`, `:104`, `:120`) with the ordering rule stated as a comment above it (`:65`), which is still a supported composition, just the unguarded one.

---

### Scope
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/InternalCommandExecution.cs:49` · Level 0 · class (private, sealed, nested)

- **What it is**: the disposable handle [`InternalCommandExecution`](#internalcommandexecution)`.Begin()` returns. Disposing it puts the ambient "running a scheduled internal command" flag back to the value it held before the scope opened.

- **Depends on**: `System.IDisposable` and the enclosing class's private `AsyncLocal<bool> Active` field (`InternalCommandExecution.cs:23`). Nothing else, which is why it sits at Level 0.

- **Concept**: the restore-on-dispose scope, taught under [`InternalCommandExecution`](#internalcommandexecution). This type is only the "restore" half.

- **Walkthrough**: a primary-constructor class, `private sealed class Scope(bool previous) : IDisposable` (`InternalCommandExecution.cs:49`), whose single member `Dispose()` assigns the captured `previous` back to `Active.Value` (`:51`). It holds no other state, so exactly two instances are ever needed, and the enclosing class creates both once as static fields: `OutermostScope = new Scope(previous: false)` (`:45`) and `NestedScope = new Scope(previous: true)` (`:47`).

- **Why it's built this way**: because the only thing a handle has to remember is one boolean, the two possible handles are preallocated and shared, so opening a scope around every internal-command dispatch allocates nothing. Disposing a shared instance is safe because `Dispose()` writes a constant rather than releasing a resource, and a second `Dispose()` writes the same value again.

- **Where it's used**: only as the return value of `InternalCommandExecution.Begin()` (`InternalCommandExecution.cs:42`). It is `private`, so no caller can name or construct it.

- **Caveats / not-in-source**: the many usage sites the inventory attributes to `Scope` are name collisions with unrelated members called `Scope` (check-in scopes, metadata scopes); the only real consumer of this nested class is the enclosing `Begin()`.

---

### InternalCommandExecution
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/InternalCommandExecution.cs:21` · Level 1 · class (static)

- **What it is**: an ambient marker that answers one question for code deep inside a handler: "is this flow executing a scheduled internal command right now?" The internal-command processor turns it on around each dispatch, and a handler that one command type serves on two paths reads it to tell the durable path from an inline one (`InternalCommandExecution.cs:3-6`).

- **Depends on**: its nested handle [`Scope`](#scope) and `System.Threading.AsyncLocal<bool>` (BCL). The marker exists for [`IInternalCommand`](#iinternalcommand) work scheduled through [`IInternalCommandScheduler`](#iinternalcommandscheduler), but it references neither.

- **Concept introduced, an ambient execution-path flag over `AsyncLocal<T>`.** `AsyncLocal<T>` stores a value in the `ExecutionContext`, so it flows into every `await` continuation and child task started from the flow that set it, and a change made inside an async method does not leak back out to the caller's context. The class doc names this as the same mechanism `QueryTagScope` uses (`:8-9`). `[Rubric §29, Reliability and Resilience]` assesses whether failures are surfaced to the mechanism that can recover from them: the case this exists for is an anonymous HTTP endpoint that must answer success whatever happens (anti-enumeration), while the same command, run from the durable queue, must report a transient failure so the row is retried instead of acknowledged (`:14-18`). `[Rubric §2, Design Patterns]`: the alternative would be a second command type or a payload flag; an ambient context keeps one command and one handler and lets only the execution path differ. The doc also states the inheritance rule on purpose: a command dispatched inline from inside a running internal command inherits the marker, which is correct, because its failure fails the row that is running (`:10-11`).

- **Walkthrough**
  - `Active` (`:23`): the private `static readonly AsyncLocal<bool>`, `false` by default.
  - `IsActive` (`:30`): reads `Active.Value`. It is `false` for a request, a background service, or a test that dispatches a handler directly (`:25-29`).
  - `Begin()` (`:38-43`): captures the current value, sets `Active.Value = true`, and returns the preallocated [`Scope`](#scope) that restores what it captured: `NestedScope` when the flag was already on, `OutermostScope` otherwise (`:42`, fields at `:45`, `:47`). Restoring the previous value rather than writing `false` is what lets nested scopes unwind correctly (`:33-35`).

- **Why it's built this way**: the doc says the processor opens the scope and "nothing else should" (`:9-10`), so the flag means exactly one thing. Two shared handle instances make the per-dispatch cost a field read and two writes. [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html) is the decision record for the durable queue the marker belongs to.

- **Where it's used**: opened by [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor) with `using var execution = InternalCommandExecution.Begin();` immediately before it dispatches a row (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:556`). Read by [`SendEmailConfirmationHandlerBase<TUser, TCommand>`](#sendemailconfirmationhandlerbasetuser-tcommand) twice: a throttle refusal returns its failure only on the durable path (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:99`), and the catch that swallows an SMTP failure is filtered with `!InternalCommandExecution.IsActive` so the exception propagates and the row is retried (`:116`). Covered by `InternalCommandProcessorTests` and `EmailConfirmationHandlerBaseTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/InternalCommands/Processing/InternalCommandProcessorTests.cs`, `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/EmailConfirmationHandlerBaseTests.cs`).

- **Caveats / not-in-source**: nothing enforces "only the processor calls `Begin()`": the method is `public`, and the restriction is a documented convention (`:9-10`).

---

### IInternalCommand
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommand.cs:38` · Level 3 · interface

- **What it is**: the marker contract for a unit of deferred work in the internal-command durable job queue: a command that can be scheduled to run later, in-process, by [`IInternalCommandScheduler`](#iinternalcommandscheduler) instead of executing immediately on the caller's own request.

- **Depends on**: `ICommand<Result>` ([group-05](group-05-cqrs-pipeline.md#icommandtresult)), so an `IInternalCommand` is, by construction, also an ordinary CQRS command that resolves an `ICommandHandler<TCommand, Result>` and runs through the same decorator pipeline as any other command.

- **Concept introduced, deferred execution without leaving the CQRS pipeline.** `[Rubric §29, Reliability and Resilience]` assesses whether background work survives a process restart: an `IInternalCommand` scheduled through `IInternalCommandScheduler.ScheduleAsync` is durable, a row in the `InternalCommands` table, not an in-memory timer, so a host crash between scheduling and execution loses nothing. `[Rubric §6, CQRS and Event-Driven]`: because the interface only narrows `ICommand<Result>`, the framework does not need a second handler abstraction or a second decorator pipeline for deferred work; `InternalCommandProcessor` resolves and invokes `ICommandHandler<TCommand, Result>` exactly as the synchronous path does, so feature gating, authorization, validation, timeout and transaction all still apply.

- **Walkthrough**: a single-line marker, `public interface IInternalCommand : ICommand<Result>;` (`:38`), with no members of its own. The result type is fixed to plain `Result` (no payload), which the type's own doc explains is deliberate: a deferred command runs with nobody waiting synchronously for a return value, so there is nothing to hand a caller.

- **Why it's built this way**: narrowing rather than introducing a parallel handler contract keeps a command implementer's mental model single: "is this command run now or later" is a scheduling decision, not a different kind of command.

- **Where it's used**: the constraint on `IInternalCommandScheduler.ScheduleAsync`'s `command` parameter ([`IInternalCommandScheduler`](#iinternalcommandscheduler)) and on `InternalCommandDispatcher`'s resolution of `ICommandHandler<TCommand, Result>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandDispatcher.cs`). Implemented across both ADC and Store wherever a command is meant to run deferred, for example `SendEmailConfirmationCommand` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SendEmailConfirmation/SendEmailConfirmationCommand.cs`).

- **Caveats / not-in-source**: the interface itself does not require an [`InternalCommandNameAttribute`](#internalcommandnameattribute); whether an implementation needs one is a detail of `InternalCommandNameResolver`, not of this contract.

---

### IInternalCommandAdministration
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandAdministration.cs:17` · Level 3 · interface

- **What it is**: the operator-facing contract over the internal-command queue: count what is pending, list what has dead-lettered, requeue dead letters, and purge completed rows on demand rather than waiting for the retention sweep.

- **Depends on**: [`InternalCommandDeadLetter`](#internalcommanddeadletter) (Level 0, the element type of `ListDeadLettersAsync`'s result); BCL (`Guid`, `TimeSpan`, `IReadOnlyCollection<Guid>`); the framework's `Result<T>` return convention.

- **Concept introduced, an administration surface as its own contract, separate from the scheduler.** `[Rubric §13, Observability and Operability]` assesses whether an operational queue is inspectable and correctable without a direct database console: every method here answers a question an on-call engineer actually asks ("how much is backed up", "what died and why", "put it back", "clean up what finished"). `[Rubric §1, SOLID]` (ISP): this is a **separate** interface from [`IInternalCommandScheduler`](#iinternalcommandscheduler) rather than a wider one, so a host that only ever schedules work never has to satisfy or fake the administration methods, and an administration UI depends on exactly the surface it needs.

- **Walkthrough**: four methods, all `Task<Result<T>>` and all taking an optional `dataSource` filter (`null` means every source this host owns).
  - `CountPendingAsync(string? dataSource, CancellationToken)` (`:123`): counts rows not yet processed, not dead-lettered, attempts not exhausted, including rows whose scheduled instant is still in the future, because that is backlog the host has already accepted.
  - `ListDeadLettersAsync(string? dataSource, int skip, int take, CancellationToken)` (`:137-141`): a paged, oldest-first list of [`InternalCommandDeadLetter`](#internalcommanddeadletter) rows.
  - `RequeueAsync(string? dataSource, IReadOnlyCollection<Guid>? ids, CancellationToken)` (`:158-161`): resets attempts to zero and clears the dead-letter stamp and claim lease so the next poll cycle picks the row back up, deliberately **keeping** `LastError` (the doc's own reasoning: the failure reason is the first thing anyone asks after a requeue) and leaving the scheduled instant untouched so a requeued row is immediately due. `ids` null or empty requeues every dead letter in the selected scope.
  - `PurgeProcessedAsync(string? dataSource, TimeSpan olderThan, CancellationToken)` (`:175-178`): deletes completed rows older than the threshold; pending and dead-lettered rows are never touched by this call, only rows carrying a completion stamp.

- **Why it's built this way**: every method takes an explicit `dataSource` filter rather than assuming one database, consistent with the framework's database-per-module model, so an administration surface mounted on a multi-source host can scope an operation to one source or run it across all of them with the same call.

- **Where it's used**: implemented by `InternalCommandAdministration` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandAdministration.cs`) and registered in `MMCA.Common.Infrastructure`'s `DependencyInjection.cs`.

- **Caveats / not-in-source**: no shipped ADC or Store admin page in this workspace calls this interface; its only exercised path is the Infrastructure implementation and its tests.

---

### IDeleteBlobInternalCommand
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IDeleteBlobInternalCommand.cs:21` · Level 4 · interface

- **What it is**: a narrow marker interface for the one recurring shape of deferred blob cleanup: an [`IInternalCommand`](#iinternalcommand) whose only payload is the name of the blob to delete.

- **Depends on**: [`IInternalCommand`](#iinternalcommand) (Level 3), so any implementation is also schedulable through [`IInternalCommandScheduler`](#iinternalcommandscheduler) and runs through the ordinary CQRS decorator pipeline like any other internal command.

- **Concept introduced, a shared contract for a recurring deferred-cleanup shape.** `[Rubric §1, SOLID]` (ISP): rather than each caller inventing its own "delete this blob later" command shape, the interface pins the one property every such command needs, `string BlobName { get; }` (`IDeleteBlobInternalCommand.cs:24`), and leaves everything else (which container, which retry policy) to the concrete command and its handler. `[Rubric §29, Reliability and Resilience]`: naming the shape lets [`DeleteBlobInternalCommandHandlerBase<TCommand>`](#deleteblobinternalcommandhandlerbasetcommand) be written once and reused by every blob-owning feature instead of duplicating the delete-then-tolerate-not-found logic per caller.

- **Walkthrough**: a single-member interface, `public interface IDeleteBlobInternalCommand : IInternalCommand` (`:21`), narrowing `IInternalCommand` with one `string BlobName { get; }` property (`:24-25`) that names the blob to delete.

- **Why it's built this way**: keeping the interface to one property is what lets the generic handler base below be written against `TCommand : IDeleteBlobInternalCommand` with nothing else to assume about the concrete command.

- **Where it's used**: implemented by `DeleteSessionAssetBlobInternalCommand` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/DeleteSessionAssetBlob/DeleteSessionAssetBlobInternalCommand.cs`) and `DeleteAvatarBlobInternalCommand` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteAvatarBlob/DeleteAvatarBlobInternalCommand.cs`), each paired with a handler that derives from [`DeleteBlobInternalCommandHandlerBase<TCommand>`](#deleteblobinternalcommandhandlerbasetcommand).

- **Caveats / not-in-source**: the interface makes no statement about which storage container or account the blob lives in; that is resolved entirely inside whichever [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) implementation the handler was constructed with.

---

### DeleteBlobInternalCommandHandlerBase<TCommand>
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/DeleteBlobInternalCommandHandlerBase.cs:28` · Level 5 · class (abstract, partial)

- **What it is**: the reusable handler body for any [`IDeleteBlobInternalCommand`](#ideleteblobinternalcommand): delete the named blob, treat "already gone" as success rather than failure, and log every outcome distinctly.

- **Depends on**: [`IDeleteBlobInternalCommand`](#ideleteblobinternalcommand) (Level 4, the `TCommand` constraint), [`ICommandHandler<TCommand, Result>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (the contract it implements), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) (constructor dependency, `DeleteAsync`) and [`ErrorType`](group-01-result-error-handling.md#errortype) (`NotFound`, tested against the failure result). Externally, `Microsoft.Extensions.Logging` for its three source-generated `[LoggerMessage]` methods.

- **Concept introduced, a base class that turns "not found" into a non-failure.** `[Rubric §29, Reliability and Resilience]` assesses whether a retryable job queue treats an already-completed side effect as success rather than as a reason to retry forever: a blob deleted by an earlier, since-crashed attempt (or removed out of band) must not keep the internal command dead-lettering. `HandleAsync` (`DeleteBlobInternalCommandHandlerBase.cs:41-65`) checks `result.Errors.Any(e => e.Type == ErrorType.NotFound)` (`:53`) and returns `Result.Success()` in that case (`:56`) instead of propagating the storage failure. `[Rubric §15, Best Practices & Code Quality]`: the class is `abstract partial`, generic over `TCommand`, and provides one override point, `protected virtual string BlobKind => "Blob";` (`:38`), so a concrete handler needs only a class declaration and, optionally, a friendlier log label; `DeleteSessionAssetBlobInternalCommandHandler` and `DeleteAvatarBlobInternalCommandHandler` both derive from it with no additional logic of their own.

- **Walkthrough**: a primary-constructor class taking `IFileStorageService fileStorage` and `ILogger logger` (`:49-51`), constrained `where TCommand : IDeleteBlobInternalCommand` (`:53`). `HandleAsync(TCommand command, CancellationToken cancellationToken = default)` (`:62`) null-guards the command (`:64`), calls `fileStorage.DeleteAsync(command.BlobName, cancellationToken)` (`:66`), and branches three ways: success logs `LogBlobDeleted` and returns the successful `result` (`:68-72`); a `NotFound` error logs `LogBlobAlreadyGone` and returns `Result.Success()` (`:74-78`); any other error logs `LogBlobDeleteFailed` with the first error's message (or `"Unknown error"` if the error list is empty, `:84`) and returns the original failed `result` (`:80-85`). The three `[LoggerMessage]` partial methods (`:88-95`) are `Information`, `Information`, and `Warning` respectively, each interpolating `BlobKind` and `BlobName` so the log line reads naturally for whichever concrete command is running.

- **Why it's built this way**: factoring the delete-then-tolerate-not-found logic into a shared abstract base means every blob-owning feature gets the same retry-safety guarantee without re-deriving it, and the single `BlobKind` override point is enough for each concrete handler to produce its own readable log lines without overriding `HandleAsync` itself.

- **Where it's used**: `DeleteSessionAssetBlobInternalCommandHandler` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/DeleteSessionAssetBlob/DeleteSessionAssetBlobInternalCommandHandler.cs`) and `DeleteAvatarBlobInternalCommandHandler` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteAvatarBlob/DeleteAvatarBlobInternalCommandHandler.cs`) both derive from `DeleteBlobInternalCommandHandlerBase<TCommand>` closed over their own command type.

- **Caveats / not-in-source**: the class does not itself register as an `ICommandHandler`; registration happens through the ordinary [`ScanModuleApplicationServices`](#dependencyinjection) scan picking up each concrete derived handler, not through anything specific to this base class.

---

### IInternalCommandScheduler
> MMCA.Common.Application · `MMCA.Common.Application.InternalCommands` · `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandScheduler.cs:16` · Level 4 · interface

- **What it is**: the write side of the internal-command queue: schedule an [`IInternalCommand`](#iinternalcommand) to run at a future instant or after a delay, instead of running it inline on the current request.

- **Depends on**: [`IInternalCommand`](#iinternalcommand) (Level 3, the type every scheduled payload must implement) and, through its return doc, [`IInternalCommandAdministration`](#iinternalcommandadministration) (the scheduled id is the handle the administration surface operates on). BCL (`DateTimeOffset?`, `TimeSpan`).

- **Concept introduced, transaction-aware durable scheduling.** `[Rubric §29, Reliability and Resilience]`: scheduling a command is not fire-and-forget the way an in-memory `Task.Delay` would be, it is a database write that must be atomic with whatever aggregate change triggered it. The XML remarks on `ScheduleAsync` (`:34-43`) state the rule explicitly: with a transaction active on the target data source the row is only enrolled, and the caller's next save writes it; when no save follows (a command scheduled after the handler's last save), the transactional pipeline saves it just before the commit, so it still commits with the aggregate change. That pipeline refuses to commit any *other* change left unsaved, so a handler cannot lean on it to save its own work (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:16`). With no transaction active the row is saved immediately, which flushes anything else pending on that context exactly as the unit of work's own save would. `[Rubric §6, CQRS and Event-Driven]`: scheduling inside an `ITransactional` command, or right after the caller's own save, is how a scheduled command and the state change that caused it commit or roll back together.

- **Walkthrough**: two overloads, both returning `Task<Result<Guid>>` where the `Guid` is the scheduled row's id, the same id `IInternalCommandAdministration` later operates on.
  - `ScheduleAsync(IInternalCommand command, DateTimeOffset? runAt = null, CancellationToken cancellationToken = default)` (`:45-48`): `runAt` is the earliest instant the command may run, converted to UTC; `null` or already-past means "as soon as the processor next polls". The processor never runs a row before this instant but makes no promise about how quickly after it a busy queue gets there.
  - `ScheduleAsync(IInternalCommand command, TimeSpan delay, CancellationToken cancellationToken = default)` (`:59-62`): schedules after `delay` has elapsed; a delay of zero or less also means "as soon as possible".
  - Both fail when the command's payload cannot round-trip through JSON or the row cannot be written.
  - Both carry a `SuppressMessage` for analyzer rule `RS0026` (multiple public overloads with optional parameters) (`:44`, `:58`), justified as a grandfathered public overload released after the v1.152 public-API baseline: changing either signature now would be a breaking change.

- **Why it's built this way**: two overloads rather than one nullable-`DateTimeOffset` parameter give the common "run in N minutes" case a `TimeSpan` call site without the caller doing `DateTimeOffset.UtcNow.Add(...)` arithmetic itself, while the absolute-instant overload covers "run at this specific time".

- **Where it's used**: called wherever a host wants to defer a command, for example ADC's `AuthController` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs`), `DeleteUserHandler`, `RemoveUserAvatarHandler`, `SetUserAvatarHandler` (all under `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/`), and Conference's `DeleteEventHandler`, `DeleteSessionAssetHandler`, `UploadSessionAssetHandler`, `DeleteSessionHandler` (under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/`). ADC's `SessionSelectionController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs`) also takes it. Implemented by `InternalCommandScheduler` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandScheduler.cs`) and registered with `TryAddScoped` in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:156`. Referenced by [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html), [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html), [ADR-086](https://ivanball.github.io/docs/adr/086-process-manager-deferred.html), [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html) (the decision record for the internal-command queue itself) and [ADR-121](https://ivanball.github.io/docs/adr/121-ephemeral-in-process-work-queue.html).

- **Caveats / not-in-source**: the doc's transaction-aware persistence rule is stated in the interface's own XML remarks, not enforced by a compile-time type; a caller that intends transactional enrollment but is not actually inside an `ITransactional` command silently gets the immediate-save behavior instead.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Crud.cs:14` · Level 11 · class (static, C# `extension(IServiceCollection)`)

- **What it is**: the composition-root extension class that assembles the framework's entire Application layer into the DI container. The class is `partial` and its public members are split across six files, each with its own `extension(...)` block: `DependencyInjection.cs` (class at `:28`, block at `:30`: `AddApplication()`, `AddApplicationDecorators()`, `AddApplicationProfiling()`, `AddMmcaApplicationPipeline(configure)`, `VerifyDecoratorPipeline()`), `DependencyInjection.ModuleScanning.cs` (`:15`, `ScanModuleApplicationServices<TAssemblyMarker>()` and its `Assembly` overload), `DependencyInjection.Crud.cs` (class at `:14`, block at `:16`: `AddEntityCrud<...>()`, `AddEntityUpdateVerb<...>()`, `AddEntityUpdate<...>()`, `AddCommandRequestValidator<TCommand, TRequest>()`), `DependencyInjection.Extensibility.cs` (`:11`, `AddUserDataExportSection<TSection>()`, `AddEventUpcaster<TSource, TTarget, TUpcaster>()`), `DependencyInjection.ProcessManagers.cs` (`:9`, `AddProcessManagers()`) and `DependencyInjection.Webhooks.cs` (`:15`, `AddWebhookEvent<TEvent>(eventType)`, plus a second block over `MmcaApplicationPipelineBuilder` at `:86` carrying `AddWebhookDelivery()`). The five private helpers behind the pipeline seal, `DecoratorPipelineSeal`, `IsPipelineSealed`, `SealPipeline`, `ThrowIfPipelineSealed`, `FormatUndecorated`, stay in `DependencyInjection.cs` below the extension block (`:313`, `:315`, `:326`, `:329`, `:341`).

- **Depends on**: the core singletons `IDomainEventDispatcher` / [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher), [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) / [`EventUpcasterRegistry`](group-03-querying-specifications.md#eventupcasterregistry), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline); the scoped [`ISoftDeletedUserMarkerWriter`](group-08-auth.md#isoftdeletedusermarkerwriter) and the erasure's [`DeleteUserPushInstallationsInternalCommand`](#deleteuserpushinstallationsinternalcommand) / [`DeleteUserPushInstallationsInternalCommandHandler`](#deleteuserpushinstallationsinternalcommandhandler); the marker [`ClassReference`](#classreference); the permission registry [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) / [`UnconfiguredPermissionRegistry`](group-08-auth.md#unconfiguredpermissionregistry) and the parallel permission catalog fallback [`IPermissionCatalog`](group-08-auth.md#ipermissioncatalog) (also defaulted to `UnconfiguredPermissionRegistry`); the open-generic handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the eight command decorators [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), [`TimeoutCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#timeoutcommanddecoratortcommand-tresult), [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult), [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult), [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult), [`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult), [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult), [`ViewAsCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#viewascommanddecoratortcommand-tresult); the six query decorators [`TimeoutQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#timeoutquerydecoratortquery-tresult), [`ValidatingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#validatingquerydecoratortquery-tresult), [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult), [`AuthorizationQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#authorizationquerydecoratortquery-tresult), [`FeatureGateQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult); the optional [`ProfilingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#profilingcommanddecoratortcommand-tresult) and [`ProfilingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#profilingquerydecoratortquery-tresult); the scanned contract families [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#ientityupdateappliertentity-tupdaterequest-tidentifiertype), [`IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>`](group-05-cqrs-pipeline.md#ientityupdatecommandappliertentity-tupdaterequest-tidentifiertype-in-tcommand); the generic write-side handlers [`CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>`](group-05-cqrs-pipeline.md#createentityhandlertcreaterequest-tentity-tidentifiertype-tentitydto), [`UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`](group-05-cqrs-pipeline.md#updateentityhandlertentity-tentitydto-tidentifiertype-tupdaterequest), [`UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`](group-05-cqrs-pipeline.md#updateentitycommandhandlertcommand-tentity-tentitydto-tidentifiertype-tupdaterequest) and [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype) over [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype); the request-validator bridge [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) over [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest); the upcaster contract [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster); the export contributor contract [`IUserDataExportSection`](#iuserdataexportsection); the process-manager scheduler [`IProcessTimeoutScheduler`](group-04-events-outbox.md#iprocesstimeoutscheduler); the webhook fan-out [`WebhookFanOutHandler<TEvent>`](group-04-events-outbox.md#webhookfanouthandlertevent); the builder [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder); and the private marker [`DecoratorPipelineSeal`](#decoratorpipelineseal). Externals: **FluentValidation** (`AddValidatorsFromAssemblyContaining`, `AddValidatorsFromAssembly`, `IValidator<>`), **Scrutor** (`Scan`, `TryDecorate`), `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAdd*`, `TryAddEnumerable`), `Microsoft.Extensions.Options` (`IValidateOptions<>`, `ValidateOnStart`), `System.Reflection`.

- **Concept introduced, the CQRS decorator pipeline wiring order (Scrutor `TryDecorate`).** `[Rubric §6, CQRS and Event-Driven]` assesses whether cross-cutting handler concerns are applied uniformly; `[Rubric §2, Design Patterns]` covers the Decorator pattern itself (the individual decorators are taught in [group-05](group-05-cqrs-pipeline.md)). **Scrutor's `TryDecorate` applies decorators in reverse registration order**: the *last* registered call becomes the *outermost* wrapper. `AddApplicationDecorators` (`DependencyInjection.cs:132`) registers the eight command decorators in source order Transactional, Timeout, Validating, Caching, Logging, Authorization, FeatureGate, ViewAs (`:152-159`), which produces the execution nesting its own XML doc draws (`:77-88`):

  ```
  ViewAsCommandDecorator                   (outermost, short-circuits with Forbidden for a view-as caller)
    -> FeatureGateCommandDecorator         (short-circuits if the feature flag is off)
      -> AuthorizationCommandDecorator     (short-circuits with Forbidden if IRequiresPermission)
        -> LoggingCommandDecorator         (captures the duration of everything inside it)
          -> CachingCommandDecorator       (invalidates cache only AFTER the transaction commits)
            -> ValidatingCommandDecorator  (short-circuits with Result.Failure on validation errors)
              -> TimeoutCommandDecorator   (applies the command's own budget if IHasTimeout)
                -> TransactionalCommandDecorator (DB transaction if ITransactional)
                  -> ConcreteHandler       (the actual business logic)
  ```

  Queries get a six-deep chain with no view-as guard, FeatureGate, Authorization, Logging, Caching, Validating, Timeout, handler (`:162-167`, drawn at `:91-100`). The ordering is not arbitrary, and the doc's design rationale gives a reason per position (`:103-128`): the view-as guard is outermost on commands so a caller holding a read-only view-as token is refused every command before any other work ([ADR-137](https://ivanball.github.io/docs/adr/137-read-only-view-as-support-access.html)); feature gating is outermost on queries and directly inside the view-as guard on commands, so a disabled feature costs nothing *and* answers identically for every caller rather than leaking which permission guards it; authorization sits directly inside it and outside caching, so a denied request neither reads nor populates the cache; logging measures only enabled executions; validation sits outside the transaction on the command side so a malformed command never opens one, but *inside* caching on the query side, because a cached entry can only exist because that query already passed validation once; cache invalidation sits outside validation so cache is cleared only after a valid committed mutation; and the timeout budget sits inside validation and outside the transaction so it covers the database work that actually hangs and cancels the transaction rather than leaving it open, while on the query side it is innermost so a cache hit never starts a budget. `[Rubric §11, Security]` is why the two authorization decorators are registered unconditionally with a `TryAddSingleton<IPermissionRegistry, UnconfiguredPermissionRegistry>()` fallback (`:141`, comment at `:136-140`), paired with the identical `TryAddSingleton<IPermissionCatalog, UnconfiguredPermissionRegistry>()` fallback added immediately after it (`:147`, comment at `:143-146`) so an administration surface mounted on a host with no permission model renders an empty catalog list rather than failing to activate: the pipeline cannot activate without a registry at all, so a host with no permission model still resolves every handler while a host that declared its grants (`AddAuthorizationPolicies` / `AddPermissions`) keeps its own registry and its own catalog. The order itself is the decision recorded in [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).

- **Concept introduced, the ordering rule as an enforced invariant.** This file is the one place where register-order versus execute-order inversion has to be held in mind, and it is also where the framework stops relying on a reader holding it. `AddApplicationDecorators()` ends by sealing the collection with [`DecoratorPipelineSeal`](#decoratorpipelineseal) (`:169`), every handler-contributing entry point on the collection opens with `ThrowIfPipelineSealed` (`DependencyInjection.cs:134` inside `AddApplicationDecorators`, `DependencyInjection.ModuleScanning.cs:49`, `DependencyInjection.Crud.cs:80`, `:142`, `:193`, `DependencyInjection.cs:228` inside `AddMmcaApplicationPipeline`), and `AddMmcaApplicationPipeline(configure)` (`DependencyInjection.cs:226-235`) packages the whole sequence so the decorators are last by construction. The webhook delivery handler takes the other route to the same guarantee: `AddWebhookDelivery()` is an extension on `MmcaApplicationPipelineBuilder` rather than on the collection (`DependencyInjection.Webhooks.cs:86`, `:94`), so it can only run inside the pipeline callback, ahead of the decorators, and its `DeliverWebhookInternalCommandHandler` registration (`:97`) is wrapped like any other. `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §14, Testability]`: `VerifyDecoratorPipeline()` (`DependencyInjection.cs:263`) is the fitness hook that proves the result, and it works on descriptor **shape** alone, never building a provider, so a test does not have to register a double for every decorator dependency (`:247-252`).

- **Concept introduced, `ScanModuleApplicationServices`, the convention scanner.** `[Rubric §5, Vertical Slice]` (one call wires a whole module's slice types) and `[Rubric §14, Testability]` (handler registration is reproducible in a test host with the same one call). Both overloads live in `DependencyInjection.ModuleScanning.cs`. The marker overload (`:28-30`, constrained `where TAssemblyMarker : class` at `:29`) just resolves `typeof(TAssemblyMarker).Assembly` and forwards to the `Assembly` overload (`:46`, null-guarded at `:48`), which runs **nine Scrutor passes** over that single assembly, each with a deliberate lifetime: domain event handlers (`IDomainEventHandler<>`, **singleton**, because they create their own scopes, `:52-56`), integration event handlers (`IIntegrationEventHandler<>`, **singleton**, `:58-63`), DTO mappers (`IEntityDTOMapper<,,>`, **scoped**, `AsSelfWithInterfaces`, `:65-69`), the opt-in DTO projectors (`IEntityDTOProjector<,,>`, **scoped**, `:71-78`, so an entity that has one gets server-side projection on its list reads and one that has none keeps materialize-then-map), request mappers (`IEntityRequestMapper<,,>`, **scoped**, `:80-84`), update appliers (`IEntityUpdateApplier<,,>`, **scoped**, `:86-94`), command-aware appliers (`IEntityUpdateCommandApplier<,,,>`, **scoped**, `:96-103`), command handlers (`ICommandHandler<,>`, **scoped**, `:105-109`) and query handlers (`IQueryHandler<,>`, **scoped**, `:111-115`), followed by `AddValidatorsFromAssembly` (`:117`). After the passes, a reflection loop (`:121-135`) finds every type in the assembly implementing `ICommandWithRequest<TRequest>`, constructs `CommandRequestValidator<TCommand, TRequest>` and `IValidator<TCommand>` with `MakeGenericType`, and `TryAddTransient`s the pair (`:134`), so a command that embeds its own request DTO gets a bridging validator for free. `TryAdd` is load-bearing here: an explicit `IValidator<TCommand>` picked up by the earlier `AddValidatorsFromAssembly` pass always wins.

- **Concept introduced, generic write-side registration.** `[Rubric §15, Best Practices & Code Quality]`: all four members live in `DependencyInjection.Crud.cs`. `AddEntityCrud<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>()` (`:74`) replaces the three hand-written handler classes a straightforward CRUD aggregate would otherwise need, registering `CreateEntityHandler`, `UpdateEntityHandler` and `DeleteEntityHandler` closed over the aggregate's own types plus the update command's validator bridge (`:82-96`). Two details in its doc are the teaching points. First, the registrations are **closed generics, not open**, because Scrutor's `TryDecorate` wraps concrete service types: an open `ICommandHandler<,>` registration would resolve completely undecorated and `VerifyDecoratorPipeline()` could not see it. Second, everything is `TryAdd`, so an aggregate that outgrows one verb registers its own handler for that verb before this call and keeps the generic pair for the other two. `AddEntityUpdateVerb<..., TApplier>()` (`:136`) registers one verb of the update path discriminated by its applier type, and `AddEntityUpdate<TCommand, ...>()` (`:187`) does the same for a derived command that carries state beside the request. All three route their validator wiring through `AddCommandRequestValidator<TCommand, TRequest>()` (`:220`, the single `TryAddTransient` at `:223`), the explicit form of what the scan's reflection bridge does for commands it can see. [ADR-099](https://ivanball.github.io/docs/adr/099-generic-write-side-entity-commands.html) is the decision record.

- **Concept introduced, the accumulating contributor registration.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether data-subject obligations are met by design: both members live in `DependencyInjection.Extensibility.cs`. `AddUserDataExportSection<TSection>()` (`:38`) is how each module contributes the slice of a person's data it owns to one export document ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). The mechanism is two lines, `TryAddScoped<TSection>()` then `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`:41-42`), and both halves matter. `TryAddEnumerable` de-duplicates by *implementation type*, so registering the same section twice adds it once while two different sections both survive, which a plain `AddScoped` would not guarantee. **Scoped**, not singleton, so a section runs inside the request's unit of work and may take repositories or gRPC clients (`:27-29`). Registration order is the order the sections appear in the export document (`:20-26`). `AddEventUpcaster<TSource, TTarget, TUpcaster>()` (`:81-88`) uses the identical idiom one lifetime up: `TryAddEnumerable(ServiceDescriptor.Singleton<IEventUpcaster, TUpcaster>())` (`:86`), singleton because upcasters are pure functions over an event instance, with `TSource` and `TTarget` named explicitly so the compiler checks the shape at the registration site ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html), rationale at `:55-67`). `AddWebhookEvent<TEvent>(eventType)` (`DependencyInjection.Webhooks.cs:41`) applies the same `TryAddEnumerable` idiom to the singleton `WebhookFanOutHandler<TEvent>` (`:80`), after validating the type name (`:44-50`) and refusing a name already used for another type or a type already published under another name (`:52-77`); registering the same pair twice returns early (`:59-62`). [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html) is the decision record for webhooks.

- **Walkthrough**
  - `AddApplication()` (`DependencyInjection.cs:36`): four `TryAddSingleton` calls, `IDomainEventDispatcher` (`:38`), `IEventUpcasterRegistry` (`:44`, registered unconditionally because with no upcasters it is an empty registry whose operations are the identity, so both delivery paths can depend on it without a null check, `:40-43`), `INavigationMetadataProvider` (`:46`) and `IEntityQueryPipeline` (`:47`); a scoped `ISoftDeletedUserMarkerWriter` registered through a factory (`:52-54`), because a Development host validates every registration at build and only a factory defers the writer's dependencies, so a host that issues no tokens still starts (`:49-51`); `AddValidatorsFromAssemblyContaining<ClassReference>()` (`:59`) to register the framework's own validators, which a module-level scan would never reach because it only scans the module's own assembly (`:56-58`); and the handler for the erasure's durable push-installation cleanup, `DeleteUserPushInstallationsInternalCommand` (`:64`), registered here, ahead of the decorators, so a host that schedules it needs no registration of its own and the processor finds a decorated handler for the row (`:61-63`).
  - `AddApplicationDecorators()` (`:132`): guard, permission-registry fallback plus the parallel permission-catalog fallback, fourteen `TryDecorate` calls (eight command, six query), seal.
  - `ScanModuleApplicationServices<TAssemblyMarker>()` (`DependencyInjection.ModuleScanning.cs:28`, constrained `where TAssemblyMarker : class` at `:29`) and `ScanModuleApplicationServices(Assembly)` (`:46`, null-guarded at `:48`): the nine-pass scanner plus the request-validator loop.
  - `AddEntityCrud` / `AddEntityUpdateVerb` / `AddEntityUpdate` / `AddCommandRequestValidator` (`DependencyInjection.Crud.cs:74`, `:136`, `:187`, `:220`): the generic write side.
  - `AddUserDataExportSection<TSection>()` (`DependencyInjection.Extensibility.cs:38`, constrained `where TSection : class, IUserDataExportSection` at `:39`) and `AddEventUpcaster<TSource, TTarget, TUpcaster>()` (`:81`): the two accumulating registrations. The export handler itself needs no registration here: apps subclass [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) in their own Application assembly and the scanner picks the subclass up as an `IQueryHandler` like any other (`:32-36`).
  - `AddProcessManagers()` (`DependencyInjection.ProcessManagers.cs:24`): `TryAddScoped<IProcessTimeoutScheduler, ProcessTimeoutScheduler>()` plus `TryAddSingleton(TimeProvider.System)` for a host that registered no clock (`:26-27`). It registers no handler, so it carries no seal guard and may be called inside or outside the pipeline; `AddApplication()` registers none of it (`:18-22`).
  - `AddWebhookEvent<TEvent>(eventType)` (`DependencyInjection.Webhooks.cs:41`): one catalog entry, the singleton fan-out handler and the `WebhookEventCatalog` (`:79-81`). `AddWebhookDelivery()` (`:94`, on the builder): the scoped delivery handler (`:97`), `WebhookSettings` options with `ValidateOnStart` (`:98`) and an `IValidateOptions<WebhookSettings>` startup check that fails, naming `AddWebhooks(configuration)`, when the host registered no subscription store (`:99`, doc at `:88-92`).
  - `AddApplicationProfiling()` (`DependencyInjection.cs:179`): optional, `TryDecorate`s `ProfilingCommandDecorator<,>` and `ProfilingQueryDecorator<,>` on top (`:181-182`), for use with `ApplicationSettings.UseMiniProfiler`. It deliberately carries no seal guard, so it can be applied after the pipeline is closed.
  - `AddMmcaApplicationPipeline(configure)` (`:226`): guard, `AddApplication()`, invoke the callback with a new [`MmcaApplicationPipelineBuilder`](#mmcaapplicationpipelinebuilder), return `AddApplicationDecorators()` (`:228-234`). The `configure` callback may be null for a host with no modules (`:192-199`).
  - `VerifyDecoratorPipeline()` (`:263`): checks the seal first (`:265-270`), then walks the collection keeping the **last** non-keyed closed-generic descriptor per `ICommandHandler<,>` / `IQueryHandler<,>` service type (`:272-288`, last-registration-wins is the container's own rule), and reports every surviving entry whose `ImplementationFactory` is null (`:290-304`). The doc explains why that test is sound: `TryDecorate` rewrites a decorated registration into a factory over its own keyed copy of the original, so an implementation type still sitting on the effective registration is proof nothing wrapped it, and the outermost decorator's own type cannot be read back at all because after decoration it exists only inside a closure (`:253-261`).

- **Why it's built this way**: `[Rubric §3, Clean Architecture]`: registration lives in a static, `partial` `DependencyInjection` class at the composition root, so domain and Application types never reference the container. The pervasive `TryAdd*` and `TryDecorate` pattern lets a consuming app override any framework default simply by registering its own implementation first. Each file carries its own `extension(...)` block, the C# extension-member syntax the framework uses for its public DI surface ([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html), and [primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the syntax itself); the webhook file uses the same syntax to extend the builder rather than the collection.

- **Where it's used**: by every consuming host. ADC and Store services compose through `AddMmcaServiceHost` (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`), which calls `AddMmcaApplicationPipeline` with the host's pipeline callback (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:158`) and adds `AddApplicationProfiling()` only when `ApplicationSettings.UseMiniProfiler` is true (`:162-164`). MMCA.Helpdesk calls `AddMmcaApplicationPipeline` directly, with module discovery in a `Register` step (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:138`, `:142`). `ScanModuleApplicationServices<ClassReference>()` is called from each module's own composition root (see [`ClassReference`](#classreference) for the call sites). `AddUserDataExportSection<TSection>()` is called by ADC's Identity module for its three cross-module sections (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:74-76`) and by Store's `IdentityModule` for its two (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`, `:45`). `VerifyDecoratorPipeline()` is called by the architecture and composition tests (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:68`, `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ApplicationPipelineCompositionTests.cs:160`, `MMCA.Common/Tests/Hosting/MMCA.Common.ServiceHost.Tests/ServiceHostBuilderExtensionsTests.cs:210`).

- **Caveats / not-in-source**: several other classes named `DependencyInjection` exist across the framework and the apps (Infrastructure, API, Grpc, UI, Notifications, and one per module) with the same name but different namespaces and methods. This section covers only the **MMCA.Common.Application root**, whose partial declarations open at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:28` and `DependencyInjection.Crud.cs:14`; the others are documented in their own groups.

### IUserScopedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8` · Level 0 · interface

- **What it is**: a one-member shape interface saying "this command or query targets a single user account". It exposes exactly `UserIdentifierType UserId { get; }` and nothing else.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Nothing else, first-party or external; the file has no `using` directives at all (`IUserScopedRequest.cs:1`).

- **Concept introduced, shape interfaces instead of shared request records.** `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion together, and this is the smallest possible instance of both: the shared Users use-case bases need one fact about the incoming message (which account it addresses), so that fact, and only that fact, becomes the contract. The XML doc states the motivation directly (`IUserScopedRequest.cs:3-7`): each app keeps its own command or query record, with its own [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) choice and its own docs, and simply adds this interface. `[Rubric §15, Best Practices & Code Quality]`: hoisting the *behavior* into a base class while leaving the *record* app-side is what let ADC and Store share the handlers without either app losing a per-app pipeline decision.

- **Walkthrough**: a single interface with a single get-only property (`IUserScopedRequest.cs:11`). There is no base interface and no default member, so implementing it is free for a `record` that already has a `UserId` positional parameter.

- **Where it's used**: extended by [`IUserOwnedRequest`](#iuserownedrequest) and [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest), both Level 1 in this chapter. Implemented directly by the one shared query record in the framework, [`GetUserPreferencesQuery`](#getuserpreferencesquery) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`), which is the only implementer inside MMCA.Common.

---

### ApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:8` · Level 0 · class (sealed)

- **What it is**: the framework's global settings object, bound from the `"ApplicationSettings"` configuration section, with four knobs: `UseMiniProfiler` (MiniProfiler tracing), `MaxPageSize` (the ceiling the API applies to a paged list query), `MaxExportRows` (the ceiling on a single CSV export) and `DatabaseInitStrategy` (`"Migrate"` or `"None"`).

- **Depends on**: nothing first-party. `System.ComponentModel.DataAnnotations` for one `[Range]` attribute (`ApplicationSettings.cs:1`, `:32`), and the options binder at the composition root. That purity is why it sits at Level 0 despite being reachable from nearly every layer.

- **Concept introduced, options-pattern settings classes.** `[Rubric §17, DevOps & Deployment]` assesses whether configuration is centralised and typed rather than read as magic-string keys scattered through the codebase. Every settings class in the framework follows the same three-part shape, and this is the simplest exemplar of it: a `public static readonly string SectionName` naming the configuration section (`ApplicationSettings.cs:11`) so no registration site spells the section out, `init`-only properties so the object is immutable once the binder has filled it, and defaults declared inline beside the property. Consumers take `IOptions<ApplicationSettings>` from the container or receive the bound instance by value; nothing injects `IConfiguration` to read these values. `[Rubric §8, Data Architecture]` shows up in the last knob: `"Migrate"` applies pending EF Core migrations, and `"None"` is the production setting that validates and **fails startup** when the schema is behind rather than silently migrating it (`:35-42`). `[Rubric §12, Performance and Scalability]` is why the two ceiling knobs exist at all: both stop one caller from turning a single request into a full-table scan.

- **Walkthrough**: `SectionName = "ApplicationSettings"` (`:11`). `UseMiniProfiler` takes the implicit `false` default (`:14`). `MaxPageSize = 500` (`:17`). `MaxExportRows = 100_000` (`:33`) is the one property carrying a validation attribute, `[Range(1, 10_000_000)]` (`:32`), and its remarks explain both the number and the attribute's limits (`:24-31`): 100,000 rows is roughly a 10 to 25 MB file for a typical grid DTO, large enough that no real operational export hits the cap and small enough that one caller cannot pin a request thread to a full-table scan; the `[Range]` is honored only by hosts that opt into `ValidateDataAnnotations` on the options binding, so the export endpoint independently falls back to its own default when a host configures a non-positive value. The two ceilings compose rather than duplicate: the export endpoint page-loops the query service at `MaxPageSize` per page, so `MaxExportRows` bounds the whole file and not one page (`:19-23`). `DatabaseInitStrategy = "Migrate"` (`:43`).

- **Why it's built this way**: `static SectionName` keeps registration DRY, and `init` immutability makes one bound instance safe to share across the process as a singleton `IOptions<T>` value and safe to hand to every module by value. Validating a bound value with an attribute rather than a hand-written guard keeps the ceiling declarative, while the endpoint-side fallback means a host that never opts into validation still cannot produce an unbounded export.

- **Where it's used**: bound and validated by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which calls `AddOptions<ApplicationSettings>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` and then reads the section a second time to get a plain instance, throwing when the section is absent (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-67`). That instance is carried on [`ModuleHostContext.ApplicationSettings`](group-12-api-hosting-mapping.md#modulehostcontext) (`ModuleHostContext.cs:44`) and passed **by value** into every [`IModule.Register(services, configuration, applicationSettings)`](#imodule) call, so a module reads global settings without resolving anything. Each knob then has a distinct consumer: `MaxPageSize` is resolved per request by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) through `IOptions<ApplicationSettings>` with a `500` fallback when nothing is registered (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:58-64`); `MaxExportRows` the same way, with `DefaultMaxExportRows = 100_000` (`EntityControllerBase.cs:513`) used both when no settings exist and when a host configures a non-positive value (`:78-85`, `:266`, [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)); `UseMiniProfiler` gates [`MiniProfilerExtensions`](group-12-api-hosting-mapping.md#miniprofilerextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:28`) and the profiling repository wrappers in [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:34`, `:58`); `DatabaseInitStrategy` drives the startup switch in [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:105-115`), where any third value throws an exception naming the two valid ones (`:195`).

---

### ModuleSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:6` · Level 0 · class (sealed)

- **What it is**: the per-module configuration entry bound from `Modules:{Name}` in `appsettings.json`. `Enabled` (default `true`) controls whether the module's service tree is registered; `RemoteDependencies` lists dependency module names that are satisfied by an *extracted remote service* rather than an in-process module.

- **Depends on**: BCL only (`List<string>` plus the options binder).

- **Concept introduced, the module-extraction boundary expressed as configuration.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the *why*: when Catalog is extracted, the host sets `"Catalog": { "Enabled": false }`, and any module that still depends on it adds `"RemoteDependencies": [ "Catalog" ]`. [`ModuleLoader`](#moduleloader) then treats that dependency as satisfied, lets the disabled module's `RegisterDisabledStubs` put the contract type into DI, and the host afterwards replaces the stub with a real gRPC client adapter. The XML doc walks exactly this Catalog/Sales example, including the sample JSON (`ModuleSettings.cs:11-36`). Extraction therefore becomes a configuration plus wiring change, not a code change.

- **Walkthrough**: `bool Enabled { get; init; } = true` (`ModuleSettings.cs:9`), `init`-only so it cannot be mutated after binding. `List<string> RemoteDependencies { get; set; } = []` (`:37`), and note this one is `set`, not `init`, because the `IConfiguration` binder needs a settable collection to populate. No inline suppression is needed: `CA2227` ("collection properties should be read only") is switched off repo-wide in `MMCA.Common/.editorconfig:352-353`, whose comment gives the same reason (DTOs and bound settings need setters).

- **Why it's built this way**: a plain POCO bound by the options pattern keeps the configuration model decoupled from the module infrastructure, and the `Enabled` flag lets a deployment switch off a whole module without deleting code.

- **Where it's used**: as the value type of [`ModulesSettings`](#modulessettings) (the `"Modules"` dictionary), read for every discovered [`IModule`](#imodule) by [`ModuleLoader`](#moduleloader) during composition, and enumerated directly by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) when it filters out the controllers of disabled modules (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:36-39`).

---

### QueryCachePipelineSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/QueryCachePipelineSettings.cs:20` · Level 0 · class (sealed)

- **What it is**: the Application layer's narrow view of the `Cache` configuration section, carrying exactly one knob: how long a request that missed the cache waits for the per-key populate lock before giving up and running the handler uncached.

- **Depends on**: BCL only (`TimeSpan`, `Timeout.InfiniteTimeSpan`). Bound by Infrastructure, read by [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult).

- **Concept introduced, splitting one configuration section across two layers without a layer violation.** `[Rubric §3, Clean Architecture]` assesses whether the dependency rule survives contact with real configuration. The rest of the `Cache` section (TTL policy, key prefix) is bound in Infrastructure beside `CacheSettings`, but the caching **decorator** lives in the Application layer, and Application cannot reference Infrastructure. Rather than duplicating a settings class or pushing the decorator down a layer, the framework declares this one-property class *in* Application and lets Infrastructure bind it: both types read the same `Cache:PopulateLockTimeout` key, so they cannot drift (`QueryCachePipelineSettings.cs:3-14`, and the reciprocal note on `CacheSettings` at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheSettings.cs:20`). `[Rubric §12, Performance & Scalability]`: the same `SectionName` plus `init` shape as every other settings class here ([`ApplicationSettings`](#applicationsettings) introduces it). `[Rubric §12, Performance and Scalability]`: the knob exists for cache-stampede control, and the default deliberately preserves the strongest form of it. `[Rubric §29, Resilience and Business Continuity]`: the remarks call the behavior fail-open outright, "the value bounds how long a request waits, never whether it succeeds" (`:16-18`), which is the same posture every other cache failure takes in this framework.

- **Walkthrough**: `SectionName = "Cache"` (`:23`), the same section Infrastructure's own cache settings bind to. `DefaultPopulateLockTimeout = Timeout.InfiniteTimeSpan` (`:29`), a `static readonly` so both the settings object and a hand-constructed decorator can reach the same fallback. `TimeSpan PopulateLockTimeout { get; init; } = DefaultPopulateLockTimeout` (`:42`). The remarks spell out the trade (`:35-41`): waiting indefinitely means exactly one request per key populates the entry and the rest are served from it, whereas a finite value bounds the wait so a pathologically slow populate cannot hold a queue behind it, at the cost of several requests running the same query at once. Zero or a negative value means no bound, exactly like the default.

- **Why it's built this way**: keeping the knob in Application is what lets `CachingQueryDecorator` take it as a constructor dependency at all, and making the fallback a `static readonly` on the settings type is what lets the decorator's optional `IOptions<>` parameter degrade cleanly to framework behavior in a unit test or in a host that never called `AddCaching`.

- **Where it's used**: bound by Infrastructure's `AddCaching` path, with validation when a configuration is supplied (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:53-56`) and as a bare `AddOptions<T>()` when it is not, so `IOptions<QueryCachePipelineSettings>` always resolves to the framework defaults rather than failing the host (`:56`, comment at `:33-38`). Read by [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), which takes it as an **optional** constructor parameter (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:48`), falls back to `DefaultPopulateLockTimeout` when it is absent (`:81-82`), and on a lock timeout logs, records a cache miss and runs the inner handler without caching the result (`:84-92`). Pinned by `CacheSettingsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/CacheSettingsTests.cs:101`, `:110-111`).

---

### IModuleSeeder
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8` · Level 0 · interface

- **What it is**: the Application-layer contract for seeding a module's initial data at startup. `ModuleName` declares ownership and `SeedAsync` receives an `IServiceProvider` so the seeder can resolve whatever it needs. Implementations are auto-discovered by [`ModuleLoader`](#moduleloader) and run, in module-dependency order, after every module has registered.

- **Depends on**: BCL only (`Task`, `IServiceProvider`, `CancellationToken`).

- **Concept introduced, seeding at the right layer.** `[Rubric §3, Clean Architecture]` assesses whether each concern lives in the layer that owns it. An *Application* seeder populates data through service interfaces and never touches a `DbContext`; a seeder that genuinely needs direct EF access implements the Infrastructure-layer [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder) instead. The `IServiceProvider` parameter is deliberate: the loader holds the seeder for the lifetime of composition, so passing the provider (rather than a concrete scoped dependency) is what lets the caller control scoping. `[Rubric §7, Microservices Readiness]`: seeding is a **separate** contract from [`IModule`](#imodule), so a module that needs no reference data implements nothing extra, and an extracted service seeds only its own module.

- **Walkthrough**: `string ModuleName { get; }` (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:13`) must match the corresponding [`IModule.Name`](#imodule) so the loader can correlate a seeder to its module and keep it in topological position; `Task SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)` (`:18`) is the single work method, and the XML doc states it is called only for enabled modules (`:16`).

- **Where it's used**: discovered by [`ModuleLoader`](#moduleloader) into a case-insensitive dictionary keyed by `ModuleName` (`ModuleLoader.cs:104-107`) and kept only when the matching module is enabled (`ModuleLoader.cs:131-134`). The actual invocation happens at host startup: [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) calls `moduleLoader.SeedAllAsync(scope.ServiceProvider, cancellationToken)` after schema initialization and tenant-database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:137`). Seeding deliberately runs on the default scope only, not once per tenant, and the comment above the call gives the reason: no module declares which seeders apply per tenant, and running one twice against a shared database is worse than not running it per tenant at all (`:107-110`). The implementations are one per data-owning module: `ConferenceModuleSeeder` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13`) and `IdentityModuleSeeder` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:15`) in ADC; `CatalogModuleSeeder` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModuleSeeder.cs:11`), `SalesModuleSeeder` (`.../Sales/MMCA.Store.Sales.API/SalesModuleSeeder.cs:14`) and `IdentityModuleSeeder` (`.../Identity/MMCA.Store.Identity.API/IdentityModuleSeeder.cs:12`) in Store.

---

### IUserOwnedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus the authenticated caller. It adds `CurrentUserId` and the caller's (nullable) role claim, which is exactly the input the shared owner-or-privileged-role check needs.

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface, `IUserOwnedRequest.cs:8`) and the `UserIdentifierType` alias.

- **Concept introduced, carrying the caller inside the message.** `[Rubric §11, Security]` assesses whether authorization decisions are made deliberately and consistently rather than ad hoc. In this codebase resource-ownership authorization exists on two levels: at the API level as an action filter plus a specification ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)), and at the handler level as this interface plus [`UserOwnershipRule`](#userownershiprule). The controller projects the caller's claims into the command or query, and the handler decides. Putting the caller *in the message* rather than injecting a current-user service into the handler keeps the handler a pure function of its input, which is what makes the shared bases unit-testable with no HTTP context (`[Rubric §14, Testability]`).

- **Walkthrough**: two added members. `UserIdentifierType CurrentUserId { get; }` (`IUserOwnedRequest.cs:11`) is the authenticated caller. `string? CurrentUserRole { get; }` (`IUserOwnedRequest.cs:18`) is the role claim, explicitly nullable because a token may carry no role at all. Its XML doc (`IUserOwnedRequest.cs:13-17`) fixes which claim a caller passes: the first role claim, which is the only one on the single-role tokens the framework mints, while a host that issues multi-role tokens passes its privileged role whenever the caller holds it. `UserId` is inherited, so an implementing record must expose both the target and the caller.

- **Why it's built this way**: the XML doc names the goal (`IUserOwnedRequest.cs:3-7`), a single uniformly applied owner-or-privileged-role check across the account-deletion and data-export use cases in both apps. The role itself is deliberately *not* interpreted here: each app owns its own role vocabulary, so the interface carries the raw claim string and the rule takes an already-evaluated boolean.

- **Where it's used**: the type constraint on all three consumers of the ownership rule: [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) (`.../DeleteUser/DeleteUserHandlerBase.cs:42`), [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`.../ExportUserData/ExportUserDataHandlerBase.cs:55`), and the API-layer [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:64`). It is also the parameter type of [`UserOwnershipRule.CheckOwnership`](#userownershiprule). Implemented app-side by each export query (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:12`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:13`) and by each delete command, both of which pair it with `ICacheInvalidating` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:14`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:17`).

---

### IUserScopedCommand<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:14` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus an embedded request payload. A command implementing it says "I target this user, and here is the DTO the caller sent".

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface). Nothing external.

- **Concept, covariant shape interfaces and the deliberate non-overlap with `ICommandWithRequest<TRequest>`.** The type parameter is declared `out TRequest` (`IUserScopedCommand.cs:14`), so `IUserScopedCommand<DerivedRequest>` is usable where `IUserScopedCommand<BaseRequest>` is expected. The more instructive part is the XML doc's warning (`IUserScopedCommand.cs:6-12`): this interface is **deliberately separate** from [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), even though both expose a `Request` property, because `ICommandWithRequest` *also* opts the command into automatic [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) registration (see `ScanModuleApplicationServices` in [`DependencyInjection`](#dependencyinjection), `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ModuleScanning.cs:119-131`). That is a per-app decision: ADC and Store agree on it for the password change and disagree on it for preferences. A command may implement both; implementing this one alone changes no pipeline behavior. `[Rubric §1, SOLID]`: two interfaces because there are two responsibilities, shape versus pipeline opt-in, even though they would collapse neatly into one.

- **Walkthrough**: one added member, `TRequest Request { get; }` (`IUserScopedCommand.cs:17`), on top of the inherited `UserId`.

- **Why it's built this way**: the split is what lets one shared handler base read any app's command uniformly while each app keeps its own validation and cache-invalidation posture. Store's change-password command implements both interfaces (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:13`) while its preferences command implements only this one (`.../ChangePreferences/ChangePreferencesCommand.cs:12`); ADC's equivalents add `ICacheInvalidating` on top (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:16`, `.../ChangePreferences/ChangePreferencesCommand.cs:15`).

- **Where it's used**: the constraint on [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) (`.../ChangePassword/ChangePasswordHandlerBase.cs:29`) and [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:27`), and the two constraints on [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:48-49`), where the base reads the app-supplied command back only through this interface and its own doc records that the preferences *query* has no equivalent marker (`UserAccountAuthControllerBase.cs:29`).

---

### ModulesSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7` · Level 1 · class (sealed)

- **What it is**: a `Dictionary<string, ModuleSettings>` subclass bound from the `"Modules"` configuration section, with two helper methods over the map: `IsModuleEnabled(moduleName)` and `IsDependencyRemote(consumerModule, dependencyModule)`.

- **Depends on**: [`ModuleSettings`](#modulesettings) (Level 0, the entry/value type).

- **Concept**: the same [options-pattern](#applicationsettings) shape, but realised by *subclassing the dictionary* so `appsettings.json` can express an arbitrary map of module name to settings without a hand-written model class per module. `[Rubric §7, Microservices Readiness]`: `IsDependencyRemote` is the extracted-service hook, and when a module's dependency is met by a remote service rather than an in-process module, it returns true and [`ModuleLoader`](#moduleloader) treats the dependency as satisfied.

- **Walkthrough**: `SectionName = "Modules"` (`ModulesSettings.cs:10`). `IsModuleEnabled` (`:18-19`) is `TryGetValue` followed by `settings.Enabled`, so a module *absent* from configuration is treated as **disabled**, not enabled, which the XML doc states explicitly (`:12-15`). `IsDependencyRemote` (`:30-32`) does `TryGetValue` for the consumer, then `settings.RemoteDependencies.Contains(dependencyModule, StringComparer.OrdinalIgnoreCase)`, case-insensitive so deployment configuration need not match casing exactly.

- **Why it's built this way**: subclassing `Dictionary<,>` rather than wrapping one keeps the binder's job trivial (the section is literally a map) while still giving the two questions the loader asks a named, testable home instead of leaving `TryGetValue` chains scattered through composition code.

- **Where it's used**: bound and validated alongside [`ApplicationSettings`](#applicationsettings) by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which falls back to an empty map when the section is absent (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:69-76`) and carries it on [`ModuleHostContext`](group-12-api-hosting-mapping.md#modulehostcontext) (`ModuleHostContext.cs:47`). Consumed by [`ModuleLoader`](#moduleloader) for both the enable check and the remote-dependency bypass (`ModuleLoader.cs:114`, `:132`, `:136`, `:213`), and by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) to keep MVC from mapping a disabled module's controllers (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28-29`, `:36-41`); it is also the optional first parameter of `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:45`).

---

### IModule
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7` · Level 1 · interface

- **What it is**: the contract every pluggable module implements: a `Name`, an optional `Dependencies` list, a `RequiresDependencies` flag, a `Register` method that wires the module's services, and an optional `RegisterDisabledStubs` method for the cross-module stubs used when the module is switched off.

- **Depends on**: [`ApplicationSettings`](#applicationsettings) (Level 0, passed into `Register`); externally `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`) and `Microsoft.Extensions.Configuration` (`IConfigurationBuilder`).

- **Concept introduced, the module system as a single composition contract.** `[Rubric §5, Vertical Slice]` assesses whether features cluster into cohesive, self-contained boundaries: a module (Conference, Engagement, Identity, Notification, Catalog, Sales, Tickets) is the top-level cohesion unit, and it registers *all* of its own services (handlers, EF configurations, repositories, validators) through one `Register` call. `[Rubric §7, Microservices Readiness]` assesses independent deployability: modules declare dependencies by *name* (string), so [`ModuleLoader`](#moduleloader) can compute a safe startup order with no compile-time reference between modules. When a dependency is disabled and `RequiresDependencies` is left at its `false` default, the depended-on module registers stubs through `RegisterDisabledStubs` so cross-module interfaces stay resolvable, which is precisely what lets the Conference service boot with [`DisabledBookmarkCountService`](group-22-engagement-module.md#disabledbookmarkcountservice) standing in for Engagement's [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice).

- **Walkthrough**: five members, three of them with **default interface implementations**, so a minimal module supplies only `Name` and `Register`. `string Name { get; }` (`IModule.cs:12`, required); `IReadOnlyList<string> Dependencies => []` (`:17`, default empty); `bool RequiresDependencies => false` (`:23`, default tolerant); `void Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:28`, required); `void RegisterDisabledStubs(IServiceCollection services) { }` (`:34`, default no-op). Note that `Register` takes an `IConfigurationBuilder`, not a built `IConfiguration`, so a module can add its own configuration sources before its services bind them, which is exactly what the loader exploits to inject per-module JSON files.

- **Why it's built this way**: [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) is the decision record for this contract, and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the topology it enables ("each service is the monolith with one module enabled"). Making `IModule` the single composition boundary means extraction is a deployment concern rather than a rewrite, and default interface members keep the common case ceremony-free while leaving the extraction hooks available.

- **Where it's used**: implemented by every module's API project, for example [`ConferenceModule`](group-20-conference-api-grpc.md#conferencemodule) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:16`), [`EngagementModule`](group-22-engagement-module.md#engagementmodule) (`.../Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:14`), [`IdentityModule`](group-24-identity-module.md#identitymodule) (`.../Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13`), [`NotificationModule`](group-10-notifications.md#notificationmodule) (`.../Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15`), Store's `CatalogModule` / `SalesModule` / `IdentityModule`, and Helpdesk's single `TicketsModule` (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.API/TicketsModule.cs:13`). Discovered, sorted, and invoked by [`ModuleLoader`](#moduleloader); the name is additionally pinned as a fitness rule by `ModuleConformanceTestsBase`, because renaming it silently disables the module's configuration and drops it from other modules' dependency graphs (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ModuleConformanceTestsBase.cs:42`).

---

### UserOwnershipRule
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:20` · Level 2 · class (static)

- **What it is**: a single static method encoding the self-service authorization rule shared by every use case that acts on one account on behalf of its owner: the caller must be the account owner, or hold the app's privileged role. It returns `null` when allowed and a ready-made [`Error`](group-01-result-error-handling.md#error) when not.

- **Depends on**: [`IUserOwnedRequest`](#iuserownedrequest) (Level 1, the parameter type), plus [`Error`](group-01-result-error-handling.md#error) and [`ErrorType`](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions` (imported at `UserOwnershipRule.cs:1`).

- **Concept introduced, the "return the error, do not throw" authorization helper.** `[Rubric §11, Security]` assesses whether authorization is uniform and auditable. The idiom being hoisted here (caller is not the owner and has no bypass role, therefore forbidden) had been written out four times across the two apps, in account deletion and data export in each, which the XML doc records as the motivation (`UserOwnershipRule.cs:9-14`). `[Rubric §2, Design Patterns]`: it is deliberately a **plain static helper**, not a base class or a decorator, because at the time of the hoist the two data-export handlers were expected to stay app-level and still needed the identical decision and the identical error shape. `[Rubric §1, SOLID]`: the role test arrives **already evaluated** as a `bool`, so the helper never learns either app's role vocabulary (`UserRole.IsAdmin`, or whatever the app's privileged role is), and every such test is case-insensitive on the app side because a role claim may carry any casing (`UserOwnershipRule.cs:14-18`). This is the Application-layer counterpart to the API-layer ownership axis of [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html); that ADR records the filter and specification forms and does not name this helper.

- **Walkthrough**: one method, `static Error? CheckOwnership(IUserOwnedRequest request, bool callerHasPrivilegedRole, string code, string message, string source)` (`UserOwnershipRule.cs:37-42`). It guards with `ArgumentNullException.ThrowIfNull(request)` (`:45`), then evaluates one conditional expression: if `request.CurrentUserId == request.UserId || callerHasPrivilegedRole`, return `null` (allowed); otherwise return `Error.Forbidden(...)` with the caller-supplied `code`, `message`, and `source`, and with `target` fixed to `nameof(IUserOwnedRequest.UserId)` (`:47-53`). Fixing the target while parameterising code, message, and source is what keeps the error payload identical to the four hand-written copies it replaced, since each of those reported its own handler name as the source.

- **Why it's built this way**: returning `Error?` rather than throwing keeps the caller on the framework's [Result pattern](group-01-result-error-handling.md#result) ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)): the handler wraps it as `Result.Failure(forbidden)` and the API layer maps it to 403 through the usual error mapping, with no exception unwinding on an expected authorization outcome.

- **Where it's used**: both shared account-scoped bases call it first thing in `HandleAsync`. [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) passes `HasDeletePrivilege(command.CurrentUserRole)` and the code `"User.DeleteForbidden"` with the message "You can only delete your own account." (`.../DeleteUser/DeleteUserHandlerBase.cs:62-67`); [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) passes `HasExportPrivilege(query.CurrentUserRole)` and the code `"User.ExportForbidden"` with the message "You can only export your own account data." (`.../ExportUserData/ExportUserDataHandlerBase.cs:81-86`). Both pass their own `HandlerName` as the source, so the error still names the concrete app handler.

---

### ModuleLoader
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:16` · Level 2 · class (sealed, partial)

- **What it is**: the engine of the module system. It reflects over the assemblies the host names to find every [`IModule`](#imodule) and [`IModuleSeeder`](#imoduleseeder) implementation, sorts the modules into dependency order with **Kahn's topological sort**, registers each enabled module into the DI container while recording stub registrations for the disabled ones, and afterwards can verify against the built container that every remote-declared dependency was actually re-wired.

- **Depends on**: [`IModule`](#imodule) (Level 1), [`IModuleSeeder`](#imoduleseeder) (Level 0), [`ApplicationSettings`](#applicationsettings) (Level 0), [`ModulesSettings`](#modulessettings) (Level 1). Externals: `IServiceCollection` / `ServiceDescriptor` / `IConfigurationBuilder`, `Microsoft.Extensions.Logging` (source-generated `[LoggerMessage]` methods, `NullLogger<T>`), `System.Diagnostics.Stopwatch`, `System.Reflection`.

- **Concept introduced, Kahn's topological sort for DI registration ordering.** `[Rubric §2, Design Patterns]` assesses use of the right algorithm for the problem: ordering items so each appears after everything it depends on is textbook topological sort, and `TopologicalSort` (`ModuleLoader.cs:284`) implements the BFS-based Kahn variant. `[Rubric §7, Microservices Readiness]`: the loader is what makes partial enablement (one module per service host) work at all. `[Rubric §15, Best Practices & Code Quality]`: modules name their dependencies as strings and the loader resolves and sorts them at startup, so adding a module is purely additive, with no central registration list to edit. `[Rubric §13, Observability and Operability]`: eight `[LoggerMessage]` partial methods (`:336-358`) give allocation-free structured diagnostics of which modules loaded, in what order, with which satisfied or unsatisfied dependencies, how long each `Register` took, and which assemblies failed to scan or loaded only partially (those two at `Error`, `:351-355`).

- **Walkthrough**
  - **State** (`ModuleLoader.cs:18-22`): three private lists, `_enabledModules`, `_seeders`, `_disabledModuleNames`, the first and third surfaced as the read-only `EnabledModules` (`:25`) and `DisabledModuleNames` (`:28`) properties. A fourth field, `_stubRegistrations` (`:21`), is a case-insensitive `Dictionary<string, List<ServiceDescriptor>>` recording exactly which descriptors each disabled module's stub registration added; `_modulesSettings` (`:22`) caches the settings for the post-build validation pass. `Logger` (`:34`) is an `init`-only `ILogger<ModuleLoader>` defaulting to `NullLogger<ModuleLoader>.Instance`, so the loader runs silently unless a host supplies one.
  - **`DiscoverAndRegister`** (`:59-65`) is the single entry point, and it takes the assemblies to scan as a **required** parameter. There is no ambient-scan overload, and the XML doc gives the reason: an AppDomain scan only sees assemblies already loaded, so a module assembly that is referenced but not yet touched by any code path would be silently absent from discovery (`:49-53`).
  - **Discovery** (`:74-107`): flattens `moduleAssemblies` through `GetTypes()` inside a `try` with two catches, and neither aborts the whole scan. A `ReflectionTypeLoadException` (the shape a missing transitive reference produces) is caught first (`:81-88`): it joins the non-null `LoaderExceptions` messages, logs `LogAssemblyPartiallyLoaded` at `Error`, and **keeps** every type that did load (`ex.Types.OfType<Type>()`, `:87`), so one unloadable type does not make the assembly's other modules vanish. Any other exception (`:90-95`) logs `LogAssemblyScanFailed`, also at `Error` and with the exception attached, and skips that assembly; that deliberately broad catch carries a scoped `CA1031` suppression whose comment states the rule, one unloadable assembly must not stop module discovery (`:89`, `:91`). The code comment gives the reason for `Error` rather than `Warning`: a module that silently fails to register is an outage that looks like a configuration choice (`:69-73`). It then instantiates every concrete, non-abstract, non-interface `IModule` via `Activator.CreateInstance` (`:99-102`) and every `IModuleSeeder` into an `OrdinalIgnoreCase` dictionary keyed by `ModuleName` (`:104-107`).
  - **Per-module loop** (`:112-135`): for a module disabled per [`ModulesSettings.IsModuleEnabled`](#modulessettings), it logs, snapshots `services.Count`, calls `module.RegisterDisabledStubs(services)`, stores the newly appended descriptors under the module's name (`:120-122`), records the name, and continues. An enabled module runs `ValidateModuleDependencies` then `RegisterEnabledModule`, and if a seeder with a matching name exists it is appended to `_seeders` (`:131-134`).
  - **`ValidateModuleDependencies`** (`:138`): computes the module's disabled dependencies (`:144-146`), subtracts those declared remote via [`ModulesSettings.IsDependencyRemote`](#modulessettings) (`:148-150`), and throws `InvalidOperationException` only if a genuinely unsatisfied dependency remains *and* `RequiresDependencies` is true; the message spells out the three remediations, enable the module, disable this one, or add the name to `Modules:{Name}:RemoteDependencies` (`:152-160`). Otherwise it logs a warning per unsatisfied-but-tolerated dependency (`:162-165`) and an information line per remote-satisfied one (`:167-170`).
  - **`RegisterEnabledModule`** (`:173`): before calling `module.Register`, it adds the conventional per-module JSON configuration files `modules.{name}.json` and, when an environment name was supplied, `modules.{name}.{environment}.json`, both optional and `reloadOnChange: true` (`:187-191`); the name is lower-cased with `ToLowerInvariant` under a documented `CA1308` suppression for the file-naming convention (`:184-186`). It times the `Register` call with a `Stopwatch` and logs the elapsed milliseconds (`:193-196`).
  - **`ValidateRemoteDependencies`** (`:214`): the post-build half of the extraction story. Given the built root provider, it creates a scope (`:221`) and, for every enabled module and every dependency that module declared remote, looks up the descriptors the disabled peer's stubs added and calls `ValidateRemoteDependencyStubs` (`:223-235`). That helper (`:238`) skips open generics, resolves each stub's `ServiceType`, and **throws** with a remediation message if it does not resolve at all (`:246-251`); if it resolves but is still the stub implementation type, it only logs a warning (`:253-257`), because a best-effort dependency may intentionally keep its stub. Configuration trust alone is not enough: a typo in a `RemoteDependencies` entry or a forgotten `AddTypedGrpcClient` would otherwise surface as a first-request failure or a silent no-op instead of at startup (`:200-213`).
  - **`SeedAllAsync`** (`:268`): awaits each collected seeder's `SeedAsync` in registration (that is, topological) order, with `ConfigureAwait(false)` (`:270-273`).
  - **`TopologicalSort`** (`:284`): builds `modulesByName`, `inDegree`, and a reverse-adjacency `dependents` map, all `OrdinalIgnoreCase` (`:286-292`); while building the graph it **ignores dependencies on modules that were not discovered** (`:299-300`), deferring those to registration-time validation. It seeds a `Queue<string>` with the zero-in-degree modules (`:308-309`) and drains it, decrementing each dependent's in-degree and enqueuing at zero (`:312-323`). If fewer modules were emitted than exist, the remainder form a cycle, and it throws `InvalidOperationException` naming them (`:326-331`).

- **Why it's built this way**: convention over configuration. Discovery plus sort means no manual ordering and no module-registration list to keep in sync, which is the decision recorded in [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) (a disabled module is represented by **stub registrations** rather than by absence, so a dependent always resolves something). Making the assembly list an explicit parameter rather than an ambient scan trades one line at the host for deterministic discovery.

- **Where it's used**: constructed by [`ModuleHostExtensions.AddModuleHost`](group-12-api-hosting-mapping.md#modulehostextensions), which attaches a logger when the host supplies one and registers the loader as a singleton (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:78-82`), then hands it back on a [`ModuleHostContext`](group-12-api-hosting-mapping.md#modulehostcontext) whose `RegisterModules` step is the actual `DiscoverAndRegister` call (`ModuleHostContext.cs:66-77`). Every ADC and Store service registers that step inside its application pipeline, for example ADC Conference (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:379`, `:347-348`) and Store Catalog (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:122`, `:233`). Each of those hosts enables exactly one module in configuration; the MMCA.Helpdesk monolith instead constructs the loader itself with a console logger and calls `DiscoverAndRegister` directly, naming `typeof(TicketsModule).Assembly` as the one assembly to scan (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:97-113`). Seeding runs later, from [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`DatabaseInitializationExtensions.cs:137`).

- **Caveats / not-in-source**: `ValidateRemoteDependencies` has no production caller today. It is exercised only by `ModuleLoaderTests` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:139`, `:152`, `:167`); no `Program.cs` in this workspace calls it after `builder.Build()`, so a mis-declared `RemoteDependencies` entry still surfaces at first request rather than at startup unless a host opts in.

---

### SoftDeletedUserValidator<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:20` · Level 8 · class (sealed, generic)

- **What it is**: the one shared implementation of [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator). It answers a single question, "does a row for this user exist **and** is it soft-deleted", in one query that deliberately bypasses the global soft-delete query filter.

- **Depends on**: [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (the interface it implements, from `MMCA.Common.Application.Interfaces.Infrastructure.Auth`, imported at `SoftDeletedUserValidator.cs:1`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (injected via primary constructor), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (obtained from the unit of work), and [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint (`SoftDeletedUserValidator.cs:3`, `:20`). Its Level 8 position is inherited from that repository and unit-of-work chain, not from any complexity of its own.

- **Concept introduced, closing a generic over the app's aggregate instead of subclassing.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access: stateless JWT means a token stays valid until it expires, so [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) (BR-133, named in the class doc at `SoftDeletedUserValidator.cs:8`) adds a middleware that rejects an authenticated caller whose account has since been soft-deleted, and this class is the lookup behind it. `[Rubric §8, Data Architecture]`: the check must see rows the rest of the application cannot, so it passes `ignoreQueryFilters: true` to punch through the soft-delete global filter for this one predicate. `[Rubric §15, Best Practices & Code Quality]`: because the type is generic over `TUser` rather than abstract, an app supplies only a type argument at registration and needs **no** per-app subclass (`SoftDeletedUserValidator.cs:12-18`).

- **Walkthrough**: a primary-constructor class taking `IUnitOfWork unitOfWork`, constrained `where TUser : AuditableAggregateRootEntity<UserIdentifierType>` (`SoftDeletedUserValidator.cs:20-21`). The single method `Task<bool> IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:23-25`, not `async`) resolves the repository through `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:27`), then returns the repository task directly, `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, cancellationToken: cancellationToken)` (`:30-33`), with no `await` and so no extra state machine. Note it is `GetRepository` off the unit of work rather than a constructor-injected `IRepository<,>`, which is the framework-wide rule for repository access, and the predicate is written against the open type parameter but closes over the concrete entity at run time, so EF translates it exactly as a hand-written app query would.

- **Why it's built this way**: one query answers both halves of the question (exists and is deleted), so the middleware pays a single round trip and cannot mistake "unknown user" for "deleted user" (`SoftDeletedUserValidator.cs:30`). Expressing the predicate against `TUser` keeps the framework free of any reference to an app's `User` aggregate while still producing a fully translated EF query.

- **Where it's used**: registered per app, closed over that app's `User` aggregate: `services.TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()` in `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:43` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:43`. The consumer is [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which resolves the interface **lazily** per request via `context.RequestServices.GetService<ISoftDeletedUserValidator>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:117`, rationale in its own doc at `:43`), so a host that registers no validator degrades to a no-op instead of failing. Each app also pins the behaviour directly, across the deleted, live, unknown, and cancellation cases (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:14`, tests at `:26`, `:42`, `:58`, and `:74`).

### AssemblyReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class that exposes the assembly it lives in plus that assembly's simple name. It is the Infrastructure layer's assembly-marker anchor, a deliberate, business-free type whose only job is to name "this assembly" for convention-based scanning.

- **Depends on**: `System.Reflection.Assembly` (BCL) only (`AssemblyReference.cs:1`). No first-party dependencies, which is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems use recognised patterns; when a registration or test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form, far more stable than `typeof(SomeRandomHandler).Assembly` pointing at a real class that might move or be renamed. `[Rubric §1, SOLID]` (DIP): registration code depends on a stable, meaningless token rather than a concrete business type, so refactoring real Infrastructure types never breaks a scan. The same shape (`AssemblyReference` + [`ClassReference`](#classreference-1)) repeats in every layer package (Application, Domain, API, and here in Infrastructure) so each assembly is self-describing without any cross-layer reference.

- **Walkthrough**: two `public static readonly` fields resolved once at type initialization (`AssemblyReference.cs:7-8`): `Assembly` via `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), and `AssemblyName` via `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:8`) so the field is never null even when the runtime reports no simple name.

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and repeating the identical shape in every package keeps each assembly self-describing without cross-layer references.

- **Where it's used**: the Scrutor entity-configuration scan inside [`DependencyInjection`](#dependencyinjection-1)`.AddInfrastructure` uses `FromAssemblyOf<ClassReference>()` (the non-static companion, below); the architecture maps pin this assembly through the same anchor.

---

### ClassReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference-1) in the Infrastructure layer, an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught under [`AssemblyReference`](#assemblyreference-1). C# static classes cannot be used as generic type arguments, so any registration helper constrained to an instantiable reference type (for example Scrutor's `FromAssemblyOf<T>()`) is handed `ClassReference` instead of `AssemblyReference`. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token stands in for "this assembly" everywhere, so a developer wiring a new scan never has to hunt for a suitable real type.

- **Walkthrough**: a single-line body-less type declaration at `AssemblyReference.cs:11` (`public class ClassReference;`). No members.

- **Where it's used**: [`DependencyInjection`](#dependencyinjection-1)`.AddInfrastructure` calls `services.Scan(scan => scan.FromAssemblyOf<ClassReference>()...)` (`DependencyInjection.cs:135-139`, the anchor itself at `:112`) to discover every [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientitytypeconfigurationbasetentity-tidentifiertype) in the Infrastructure assembly and register it as its implemented interfaces with a scoped lifetime.

---

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

### TwoFactorAttemptKey
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/TwoFactorAttemptKey.cs:15` · Level 0 · class (internal, static)

- **What it is**: a one-method static helper that builds the failed-attempt counter key for an account's second-factor code (`TwoFactorAttemptKey.cs:15`, `For` at `:20-21`).

- **Depends on**: the `UserIdentifierType` alias and `CultureInfo` (BCL). No first-party types, which is why it sits at Level 0.

- **Concept introduced, a separate counter namespace per credential.** `[Rubric §11, Security]` assesses whether brute-force budgets are scoped to what they protect. `For(userId)` returns `two-factor:{id}` with the id formatted by `CultureInfo.InvariantCulture` (`TwoFactorAttemptKey.cs:20-21`), so the second-factor budget is a different counter from the password-login one that [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) keeps for the same account ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)), and a culture-dependent id format cannot split one account across two keys.

- **Walkthrough**: `internal static string For(UserIdentifierType userId)` is an expression-bodied interpolation (`TwoFactorAttemptKey.cs:20-21`). Nothing else.

- **Why it's built this way**: three handlers need the identical key and a typo in one would give that endpoint its own silent, unshared budget, so the format lives once.

- **Where it's used**: [`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>`](#confirmtwofactorenrollmenthandlerbasetcommand), [`DisableTwoFactorHandlerBase<TCommand>`](#disabletwofactorhandlerbasetcommand) and [`RegenerateRecoveryCodesHandlerBase<TCommand>`](#regeneraterecoverycodeshandlerbasetcommand), each passing it to `CheckLockoutAsync`, `IncrementFailedAttemptsAsync` and `ResetFailedAttemptsAsync`. The Begin handler does not use it.

---

### UserDataExportSectionDefaults
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:105` · Level 0 · class (static)

- **What it is**: a static holder for one string constant: the sentence a data subject reads when a section of their export could not be produced and the app supplied no reason of its own.

- **Depends on**: nothing. It is a single `const string`, which is why it is Level 0 even though the export pipeline around it is not.

- **Concept introduced, the caller-safe failure message.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether privacy obligations are met in the product rather than in a policy document: a data-subject access request has a legal deadline, so a partially unavailable package that says so plainly is a better answer than a failed request ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). `[Rubric §11, Security]` assesses what leaves the trust boundary: this text reaches an end user, so it is deliberately generic and carries no exception message, stack trace, peer address, or connection string; the detail goes to the log instead, through the handler-local `ExportSectionUnavailable` source-generated log message on [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:202`). `[Rubric §13, Observability and Operability]`: splitting the audience in two (generic sentence out, full exception in) is the pattern, not an oversight.

- **Walkthrough**: one member, `public const string UnavailableReason` (`IUserDataExportSection.cs:112-113`), whose value is "This section could not be retrieved. The data is unchanged; the export can be requested again later." The XML doc records the intent (`IUserDataExportSection.cs:107-111`): the subject learns the section is incomplete and retryable, and learns nothing about the internal failure. `const` rather than `static readonly` because the value is compile-time and callers use it in default-parameter position and in object initializers.

- **Why it's built this way**: two call sites need the identical wording, and having them share a constant is what keeps a degraded section indistinguishable whether the section itself reported unavailability or the handler caught an exception on its behalf.

- **Where it's used**: as the fallback in [`UserDataExportSectionResult.Unavailable`](#userdataexportsectionresult) when the caller passes no reason (`IUserDataExportSection.cs:99`), and directly in [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)'s catch block when a section throws (`ExportUserDataHandlerBase.cs:196`).

---

### UseDataSourceAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:14` · Level 1 · class (sealed attribute)

- **What it is**: the companion attribute to [`UseDatabaseAttribute`](#usedatabaseattribute). Where that one names the logical database, this one declares the **database engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): `CosmosDB`, `Sqlite`, or SQL Server) an entity type configuration targets. It is Level 1 rather than Level 0 because, unlike the pure-BCL `UseDatabaseAttribute`, it references the first-party `DataSource` enum.

- **Depends on**: the [`DataSource`](group-07-persistence-ef-core.md#datasource) enum (from `MMCA.Common.Application.Interfaces.Infrastructure.Persistence`, imported at `UseDataSourceAttribute.cs:1`) and `System.Attribute` (BCL).

- **Concept**: engine selection for the multi-engine persistence layer, the sibling of the logical-name routing introduced under [`UseDatabaseAttribute`](#usedatabaseattribute). `[Rubric §8, Data Architecture]` again: the framework supports SQL Server, Cosmos, and SQLite simultaneously, and this attribute is how a configuration announces which engine's rules apply. In practice it is carried on the provider-specific configuration base classes (`EntityTypeConfigurationSQLServer/Cosmos/Sqlite`), so a concrete configuration inherits its engine, while `UseDatabaseAttribute` selects which database on that engine.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDataSourceAttribute.cs:13`), same inheritance and single-use semantics as `UseDatabaseAttribute` so a provider base class propagates the engine to derived configurations.
  - Primary-constructor parameter `dataSource` (`UseDataSourceAttribute.cs:14`) of type [`DataSource`](group-07-persistence-ef-core.md#datasource).
  - `DataSource` get-only property (`UseDataSourceAttribute.cs:17`) exposing the chosen engine. The XML doc (`UseDataSourceAttribute.cs:5-11`) records that it is read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) at model-building time to populate the entity-to-data-source cache that [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork) uses to route each entity to the correct [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).

- **Why it's built this way**: keeping the engine on an attribute (inherited from a provider base class) means an entity's engine and database are both declarative metadata the registry can scan up front, which is what lets routing happen without first building an EF model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: on the per-engine `EntityTypeConfiguration*` base classes and, through inheritance, every concrete configuration under them; read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) / [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry).

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
  - Registration is a separate one-liner: `AddUserDataExportSection<TSection>()` does `TryAddScoped<TSection>()` plus `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Extensibility.cs:38-44`). `TryAddEnumerable` is the load-bearing call: registrations **accumulate** across modules while the same type registered twice is added once, and registration order becomes document order (`DependencyInjection.Extensibility.cs:19-26`). The lifetime is **scoped**, so a section runs inside the request's unit of work and may take scoped dependencies (`DependencyInjection.Extensibility.cs:27-30`).

- **Why it's built this way**: the alternative, a central export handler that knows every module's data, would couple the Identity module to every other module and would break the moment one of them was extracted into its own service. Fan-out over an injected `IEnumerable<IUserDataExportSection>` keeps that knowledge inside each module and turns extraction into a change of what the section calls, not of who contributes.

- **Where it's used**: injected as `IEnumerable<IUserDataExportSection>` into [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`ExportUserDataHandlerBase.cs:51`). Implemented by [`EngagementUserDataExportSection`](group-24-identity-module.md#engagementuserdataexportsection) and [`NotificationUserDataExportSection`](group-24-identity-module.md#notificationuserdataexportsection), registered in that order (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:74-75`), and by Store's `SalesUserDataExportSection` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:22`), registered by its Identity module (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`). Two more implementations exist only as test doubles that pin the degradation contract, `ThrowingSection` and `CancellingSection` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:309` and `:320`).

- **Caveats / not-in-source**: whether a given section's peer is reachable in a given environment is a deployment fact, not a source fact. The source settles only that an unreachable peer degrades one section.

---

### BeginTwoFactorEnrollmentHandlerBase<TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/BeginTwoFactorEnrollmentHandlerBase.cs:41` · Level 4 · class (abstract)

- **What it is**: the shared start-two-factor-enrollment workflow: load the account's two-factor state,
  refuse if already enabled, resolve the account's display name, mint a fresh TOTP secret, and start the
  enrollment in the store in protected form (`BeginTwoFactorEnrollmentHandlerBase.cs:41`, `:55-101`).

- **Depends on**: [`ITwoFactorService`](group-08-auth.md#itwofactorservice),
  [`ITwoFactorStore`](group-08-auth.md#itwofactorstore),
  [`ITwoFactorSecretProtector`](group-08-auth.md#itwofactorsecretprotector) and an `ILogger` as
  primary-constructor parameters (`:41-45`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over `Result<`[`TwoFactorSetupResponse`](group-08-auth.md#twofactorsetupresponse)`>` (`:45`).
  `TCommand` is constrained to [`IUserScopedRequest`](#iuserscopedrequest) (`:46`), the narrowest of this
  family's command constraints: this workflow reads only the caller's id and carries no request payload.
  Its one audit line is a private source-generated `[LoggerMessage]` method, `TwoFactorEnrollmentStarted`
  (`:115-116`), which is why the class is declared `partial` (`:41`). Externals:
  `Microsoft.Extensions.Logging`.

- **Concept introduced: a fresh secret on every call, never a reuse.** An interrupted enrollment must not
  leave a secret live that somebody who saw the first QR code could still key an authenticator with, so
  `HandleAsync` calls `twoFactorService.GenerateSecret()` unconditionally rather than resuming a prior
  attempt (`:86`, comment at `:83-85`).

  `[Rubric §11: Security]` assesses secret-material handling. The account is checked for an
  already-enabled factor before a new secret is even generated (`:68-74`); the store never receives the
  plaintext secret, only `secretProtector.Protect(secret)` (`:88-90`); and the response carries the
  plaintext secret plus a provisioning URI built by the service, never anything the handler constructs
  itself (`:98-100`). The class remarks state the rule: only the account owner gets the plaintext key,
  once, in the response.

- **Walkthrough**: one virtual member, one method and one abstract hook.
  - `HandlerName` (`:52`): `protected virtual`, defaulting to `GetType().Name`, the same source-stamping
    pattern used by every other handler base in this family.
  - `HandleAsync(TCommand, CancellationToken)` (`:55-101`): null-guards the command (`:59`); loads the
    two-factor state (`:61`), returning `Error.NotFound` when absent (`:62-66`); returns a `Conflict`
    (`Authentication.TwoFactorAlreadyEnabled`) when already enabled (`:68-74`); resolves the account
    label through the one abstract hook (`:76`), failing `NotFound` when it comes back blank
    (`:77-81`); generates the secret (`:86`); starts the enrollment in the store with the protected
    secret (`:88-90`), propagating its failure untouched (`:91-94`); logs `TwoFactorEnrollmentStarted`
    (`:96`); and returns the plaintext secret and provisioning URI (`:98-100`).
  - `ResolveAccountNameAsync(UserIdentifierType, CancellationToken)` (`:111-113`): `protected abstract`.
    The one app-specific step, because each app's `User` exposes its authenticator label (normally the
    email) differently.

- **Why it's built this way**: enrollment, confirmation, disablement and recovery-code regeneration are
  four small, independently-testable steps rather than one wide handler, so each app subclass only ever
  forwards the app-specific lookups its use case actually needs. Each step owns its log message as a
  private `[LoggerMessage]` method, so the message text lives beside the only code that emits it.
  Protecting the secret in the base rather than in each app's store means no app store can persist it
  in plaintext by omission; the default protector is the data-protection one registered by
  `AddTwoFactorAuthentication` (see [`DependencyInjection`](#dependencyinjection-1)).

- **Where it's used**: covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/TwoFactorHandlerBaseTests.cs` through a
  test subclass, and end to end with the real protector by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/TwoFactor/TwoFactorSecretProtectionEndToEndTests.cs`.

- **Caveats**: the plaintext secret is returned to the caller in the response; it is up to the transport
  (HTTPS) and the client to keep it confidential in transit, nothing in this handler encrypts the
  response further.

---

### ConfirmTwoFactorEnrollmentHandlerBase<TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/ConfirmTwoFactorEnrollmentHandlerBase.cs:39` · Level 4 · class (abstract)

- **What it is**: the shared confirm-enrollment workflow: refuse an account whose factor is already
  active, verify the caller's first TOTP code against the pending secret under a failed-attempt budget,
  generate a batch of recovery codes, and persist the completed enrollment
  (`ConfirmTwoFactorEnrollmentHandlerBase.cs:39`, `:54-106`).

- **Depends on**: `ITwoFactorService`, [`ITwoFactorAuthenticator`](group-08-auth.md#itwofactorauthenticator),
  [`ITwoFactorStore`](group-08-auth.md#itwofactorstore),
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an `ILogger` (`:39-44`);
  implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over `Result<TwoFactorRecoveryCodesResponse>` (`:44`). `TCommand` is an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a `TwoFactorCodeRequest`
  (`:45`). Also uses [`TwoFactorErrors`](group-08-auth.md#twofactorerrors) and
  [`TwoFactorAttemptKey`](#twofactorattemptkey) (`:75`), and logs through a private source-generated
  `[LoggerMessage]` method, `TwoFactorEnabled` (`:108-109`), hence the `partial` declaration (`:39`).

- **Concept introduced: the pending secret has to still be there to confirm against, and a wrong code
  costs budget.** The handler reads the state the Begin step wrote and fails with
  `TwoFactorErrors.TwoFactorEnrollmentMissing` when there is no secret, treating an empty or zero-length
  secret the same as a missing one (`:60-65`, `TwoFactorSecret is not { Length: > 0 } secret`), so a
  confirm call that races an unstarted enrollment cannot verify against a blank value. A secret that is
  still stored on an already-active account is refused with an `Authentication.TwoFactorAlreadyEnabled`
  conflict (`:67-73`), because the secret stays stored after enrollment and a time-based code alone would
  otherwise mint a fresh recovery set (SECURITY M228, remarks at the type). The code is checked through
  `ITwoFactorAuthenticator.VerifyEnrollmentCodeAsync`, so its time step is accepted once (`:82-84`);
  a wrong code increments the per-account counter (`:87`), the lockout is checked before verifying
  (`:76-80`), and success resets the counter (`:91`), the same way a wrong current password counts in the
  change-password workflow ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)).

  `[Rubric §11: Security]` assesses brute-force resistance on secondary credentials. A stolen-token
  holder cannot enumerate six-digit codes through this endpoint without hitting the exponential lockout.
  `[Rubric §1: SOLID]` assesses open/closed. Verification and persistence (`CompleteEnrollmentAsync`)
  are delegated to collaborators, so the handler itself contains no cryptographic logic.

- **Walkthrough**: one virtual member and one method.
  - `HandlerName` (`:51`).
  - `HandleAsync(TCommand, CancellationToken)` (`:54-106`): null-guard (`:58`); load state and fail on a
    missing/empty secret (`:60-65`); refuse an already-enabled account (`:67-73`); derive the counter key
    (`:75`) and fail with the lockout errors if locked out (`:76-80`); verify the submitted code
    (`:82-84`), on failure increment the counter and return `TwoFactorErrors.TwoFactorInvalid`
    (`:85-89`); reset the counter (`:91`); generate recovery codes (`:93`); complete the enrollment with
    their hashes (`:95-101`); log `TwoFactorEnabled` (`:103`); return the plaintext codes to the caller
    once, in the response (`:105`).

- **Why it's built this way**: recovery codes are only ever returned at this one moment, on the response
  of the call that completes enrollment, because the store only ever persists their hashes (`:95-98`,
  the failure path at `:99-101`); the plaintext never touches the database.

- **Where it's used**: [`BeginTwoFactorEnrollmentHandlerBase<TCommand>`](#begintwofactorenrollmenthandlerbasetcommand)
  and this type are used together by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/TwoFactorHandlerBaseTests.cs` through a
  shared test subclass.

- **Caveats**: a failed `VerifyCode` does not clear the pending secret, so the caller can retry with a
  fresh code from the same authenticator entry without restarting enrollment.

---

### DisableTwoFactorHandlerBase<TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/DisableTwoFactorHandlerBase.cs:36` · Level 4 · class (abstract)

- **What it is**: the shared turn-off-two-factor workflow: check the per-account lockout, challenge the
  submitted code against the active factor, and disable it in the store only when the challenge succeeds
  (`DisableTwoFactorHandlerBase.cs:36`, `:50-93`).

- **Depends on**: [`ITwoFactorAuthenticator`](group-08-auth.md#itwofactorauthenticator),
  [`ITwoFactorStore`](group-08-auth.md#itwofactorstore),
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an `ILogger` (`:36-40`);
  implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:40`). `TCommand` is an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a `TwoFactorCodeRequest`
  (`:41`). Also uses [`TwoFactorErrors`](group-08-auth.md#twofactorerrors) and
  [`TwoFactorAttemptKey`](#twofactorattemptkey) (`:54`), and logs through a private source-generated
  `[LoggerMessage]` method, `TwoFactorDisabled` (`:95-96`), hence the `partial` declaration (`:36`).

- **Concept introduced: a distinguishable not-enrolled outcome, behind a lockout.** `ChallengeAsync`
  returns a `TwoFactorOutcome`, and the handler treats `NotEnrolled` as a distinct failure
  (`TwoFactorErrors.TwoFactorNotEnrolled`, `:77-80`, comment at `:74-76`) rather than an idempotent
  success: the caller just presented a code, and the code was never actually checked against anything,
  so the response says so rather than silently agreeing. Ahead of the challenge the handler consults the
  lockout for the account's counter key (`:54-59`); a challenge failure whose error code is
  `TwoFactorErrors.TwoFactorInvalidCode` increments the counter (`:64-70`), and a good challenge resets it
  (`:82`). That is the M228 hardening: a wrong code counts against the same budget as a wrong current
  password in the change-password workflow
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)).

  `[Rubric §11: Security]` assesses whether the disable path itself is gated. Disabling two-factor
  cannot happen without a live code challenge, and a stolen-token holder cannot guess codes here without
  hitting the lockout, so an attacker who only has the session cookie (and not the authenticator) cannot
  turn protection off.

- **Walkthrough**: one virtual member and one method.
  - `HandlerName` (`:47`).
  - `HandleAsync(TCommand, CancellationToken)` (`:50-93`): null-guard (`:52`); derive the counter key
    and return the lockout failure when locked out (`:54-59`); challenge the code (`:61-63`), counting a
    wrong-code failure and returning the challenge errors (`:64-72`); the `NotEnrolled` outcome fails
    distinctly (`:77-80`); reset the counter (`:82`); `DisableAsync` (`:84`), returning its failure
    unchanged (`:85-88`); log `TwoFactorDisabled` (`:90`); return success (`:92`).

- **Why it's built this way**: the challenge/store split mirrors the enrollment pair:
  `ITwoFactorAuthenticator` owns the live code check, `ITwoFactorStore` owns the persisted state, and
  this handler only sequences the two.

- **Where it's used**: covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/TwoFactorHandlerBaseTests.cs`.

- **Caveats**: disabling does not clear previously issued recovery codes from the store on its own; that
  is `ITwoFactorStore.DisableAsync`'s contract, not visible from this handler.

---

### RegenerateRecoveryCodesHandlerBase<TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.TwoFactor` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/RegenerateRecoveryCodesHandlerBase.cs:36` · Level 4 · class (abstract)

- **What it is**: the shared regenerate-recovery-codes workflow: check the per-account lockout, challenge
  the submitted code, then replace the account's whole recovery-code set
  (`RegenerateRecoveryCodesHandlerBase.cs:36`, `:51-98`).

- **Depends on**: [`ITwoFactorAuthenticator`](group-08-auth.md#itwofactorauthenticator),
  [`ITwoFactorService`](group-08-auth.md#itwofactorservice),
  [`ITwoFactorStore`](group-08-auth.md#itwofactorstore),
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an `ILogger`
  (`:36-41`), the widest primary constructor of the four TwoFactor bases; implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over `Result<TwoFactorRecoveryCodesResponse>` (`:41`). `TCommand` is an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a `TwoFactorCodeRequest`
  (`:42`). Uses [`TwoFactorAttemptKey`](#twofactorattemptkey) (`:57`) and logs through a private
  source-generated `[LoggerMessage]` method, `TwoFactorRecoveryCodesRegenerated` (`:100-101`), hence the
  `partial` declaration (`:36`).

- **Concept introduced: regeneration replaces, it does not append, and it is not a code oracle.**
  `ReplaceRecoveryCodesAsync` takes the freshly generated hash set and is expected to overwrite whatever
  codes existed before (`:87-89`), so a code from a batch the caller regenerated away is no longer valid,
  closing off an old code that may have leaked. A wrong code counts against the per-account budget
  (`:67-72`, M228, [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)),
  so the endpoint is not an unthrottled code oracle for a stolen-token holder.

  `[Rubric §11: Security]` assesses whether the regenerate path is itself gated the same way disable is:
  the lockout check (`:57-62`) and a live code challenge, with the same `NotEnrolled` distinct failure,
  have to succeed first (`:64-81`).

- **Walkthrough**: one virtual member and one method.
  - `HandlerName` (`:48`).
  - `HandleAsync(TCommand, CancellationToken)` (`:51-98`): null-guard (`:55`); derive the counter key and
    return the lockout failure when locked out (`:57-62`); challenge (`:64-66`), counting a wrong-code
    failure (`:67-75`); the `NotEnrolled` outcome fails distinctly (`:77-81`); reset the counter (`:83`);
    generate a new code batch (`:85`); replace them in the store (`:87-89`), propagating a failure
    untouched (`:90-93`); log `TwoFactorRecoveryCodesRegenerated` (`:95`); return the new plaintext codes
    (`:97`).

- **Why it's built this way**: it shares the challenge-then-store shape with
  [`DisableTwoFactorHandlerBase<TCommand>`](#disabletwofactorhandlerbasetcommand) and the
  generate-then-persist shape with
  [`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>`](#confirmtwofactorenrollmenthandlerbasetcommand),
  because regeneration is genuinely the union of the two operations.

- **Where it's used**: covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/TwoFactorHandlerBaseTests.cs`.

- **Caveats**: as with
  [`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>`](#confirmtwofactorenrollmenthandlerbasetcommand), the
  plaintext codes are returned exactly once, in this response; the store keeps only their hashes.

---

### UserSessionExportDTO
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/RefreshSessionUserDataExportSection.cs:66` · Level 5 · record (sealed)

- **What it is**: one sign-in session as the data subject receives it in the export: when it was issued, when it expires or was revoked and why, and the client and device details recorded for it, with no token hash (`RefreshSessionUserDataExportSection.cs:47-52`, `:66-79`).

- **Depends on**: [`RefreshSession`](group-08-auth.md#refreshsession) (the stored row it projects, `:84`) and [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) (applied as `[property: Pii]`, `:71-79`).

- **Concept**: the export-side projection that keeps credentials material out of a portability document. It applies the `[Pii]` marking taught in the primer (ADR-005) the same way [`RefreshSession`](group-08-auth.md#refreshsession) does, so a log redactor masks the client and device members (`:50-51`). `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether personal data is identified and handled deliberately: every member here is either a timestamp, the revocation reason, or a `[Pii]`-marked client or device field, and the token hash and the successor's token hash are simply not members (`:19-20`).

- **Walkthrough**: a positional sealed record of thirteen members (`:66-79`): `CreatedAt`, `ExpiresAt`, nullable `RevokedAt` and `RevocationReason`, then nine nullable `[Pii]` strings (`IpAddress`, `UserAgent`, `DeviceId`, `DeviceName`, `DeviceModel`, `DeviceManufacturer`, `DevicePlatform`, `DeviceFormFactor`, `DeviceType`). The one member is the static factory `From(RefreshSession)` (`:84-102`), which null-guards its argument (`:86`) and copies the fields one for one, mapping the row's `ReasonRevoked` onto `RevocationReason` (`:92`).

- **Why it's built this way**: a dedicated export shape, rather than serializing the stored row, makes "never a secret" structural: a field added to [`RefreshSession`](group-08-auth.md#refreshsession) does not reach the data subject until someone adds it here.

- **Where it's used**: produced only by [`RefreshSessionUserDataExportSection`](#refreshsessionuserdataexportsection) (`RefreshSessionUserDataExportSection.cs:43`); pinned by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UseCases/ExportUserData/RefreshSessionUserDataExportSectionTests.cs`.

---

### RefreshSessionUserDataExportSection
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/RefreshSessionUserDataExportSection.cs:28` · Level 7 · class (sealed)

- **What it is**: the framework's own data-subject export section: the account's sign-in sessions, published as the `SignInSessions` section of the export document, so the access and portability export covers the session metadata the framework itself stores (`RefreshSessionUserDataExportSection.cs:7-11`, `:28`, `:31`).

- **Depends on**: [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore) (primary-constructor parameter, `:28`), [`IUserDataExportSection`](#iuserdataexportsection) (the contract it implements), [`UserDataExportSectionResult`](#userdataexportsectionresult) and [`UserSessionExportDTO`](#usersessionexportdto).

- **Concept**: a contributor to the best-effort fan-out taught under [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery), shipped by the framework rather than an app. `[Rubric §30, Compliance, Privacy and Data Governance]`: it exports every row, revoked and expired included, because a revoked row still carries the IP address, user agent and device fields captured at issue time, so leaving it out would export less than the store holds (`:14-16`); and it never exports a token hash (`:19-20`).

- **Walkthrough**:
  - `Name` (`:31`): `public const string` `"SignInSessions"`, returned by `SectionName` (`:34`).
  - `ExportAsync(UserIdentifierType, CancellationToken)` (`:37-44`): reads every session for the account through `IRefreshSessionStore.GetAllByUserAsync` (`:41`; the store contract returns them oldest first, `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/IRefreshSessionStore.cs:58-59`), projects each through `UserSessionExportDTO.From`, and returns `UserDataExportSectionResult.Complete` (`:43`). It does no error handling of its own: a store failure propagates and the handler's `RunSectionAsync` degrades the section.

- **Why it's built this way**: the refresh-session rows are framework data, so the framework contributes their export rather than asking every app to write the same section ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html), [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)).

- **Where it's used**: registered by `AddInfrastructure` through `AddUserDataExportSection<RefreshSessionUserDataExportSection>()` right after the refresh-session store (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:175-178`), so every host that issues sessions exports them with no app code; the comment notes it is inert on a host with no export handler, because nothing resolves the section there (`:176-177`). Tested by `RefreshSessionUserDataExportSectionTests` and the registration check in `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs`.

---

### ExportUserDataHandlerBase<TUser, TQuery>
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49` · Level 8 · class (abstract partial, generic)

- **What it is**: the shared data-subject export workflow (GDPR/CCPA access and portability). It authorizes the caller, loads the account read-only, asks the subclass for the app's own snapshot of that account, fans out best-effort over every registered [`IUserDataExportSection`](#iuserdataexportsection), and assembles one JSON-ready package the data subject can be handed.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and, through it, [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype); [`IUserDataExportSection`](#iuserdataexportsection) (injected as an `IEnumerable`); [`IUserOwnedRequest`](#iuserownedrequest) (the `TQuery` constraint) and [`UserOwnershipRule`](#userownershiprule); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (the `TUser` constraint); [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (the contract it implements); [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); the Shared-layer DTOs [`UserDataExportDTO`](group-08-auth.md#userdataexportdto) and [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` and `:61`); and [`UserDataExportSectionDefaults`](#userdataexportsectiondefaults). Externals: `TimeProvider` and `ILogger` (both injected through the primary constructor, `ExportUserDataHandlerBase.cs:50-53`), plus the `[LoggerMessage]` source generator from `Microsoft.Extensions.Logging` for its one private log method (`:201-202`).

- **Concept introduced, the template-method handler that owns the workflow and delegates only what is genuinely app-specific.** `[Rubric §2, Design Patterns]` assesses deliberate pattern use: this is Template Method applied to a use case, with exactly three extension points (one abstract role check, one abstract projection, one virtual tail) and everything else fixed. `[Rubric §15, Best Practices & Code Quality]`: the two apps previously carried near-identical export handlers; hoisting the workflow left each subclass with the two decisions that actually differ. `[Rubric §30, Compliance, Privacy and Data Governance]`: the assembled document is **PII by design**, so its class doc states it must never be logged or cached, and notes that the caching query decorator is not applicable because the query implements no [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) (`ExportUserDataHandlerBase.cs:42-45`). `[Rubric §29, Resilience]`: the fan-out degrades per section rather than failing, since a data-subject request carries a legal deadline ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). `[Rubric §14, Testability]`: because authorization arrives inside the query and time arrives as `TimeProvider`, the whole workflow is exercised with mocks and no host (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:17`).

- **Walkthrough**
  - **Shape and constraints** (`ExportUserDataHandlerBase.cs:49-55`): a primary-constructor `abstract partial` class (partial so the logging source generator can supply the body of its private log method) taking `IUnitOfWork`, `IEnumerable<IUserDataExportSection>`, `TimeProvider`, and `ILogger`, implementing `IQueryHandler<TQuery, Result<UserDataExportDTO>>`, with `TUser : AuditableAggregateRootEntity<UserIdentifierType>` and `TQuery : IUserOwnedRequest`.
  - **`CurrentFormatVersion = "1.0"`** (`:61`) is stamped into the envelope. Its doc is precise about scope (`:57-60`): it versions the *envelope only*, so an app changing its own subject or section payloads does not move it.
  - **`UnitOfWork`** is exposed `protected` (`:64`) purely so a subject-snapshot override can read further aggregates. **`HandlerName`** is `virtual` and defaults to `GetType().Name` (`:71`), so an app subclass named `ExportUserDataHandler` reports that name in the error payload (`:67-70`).
  - **`HandleAsync`** (`:74-122`). It null-guards the query (`:78`), then runs the ownership gate through [`UserOwnershipRule.CheckOwnership`](#userownershiprule) with `HasExportPrivilege(query.CurrentUserRole)` and the code `"User.ExportForbidden"` (`:81-90`), failing fast on rejection.
  - **The read** (`:92-98`): `unitOfWork.GetReadRepository<TUser, UserIdentifierType>()` then `GetByIdAsync`. The class doc calls this out as a deliberate change from the two pre-hoist app copies, which used the read-write repository: this is a query handler, it never saves, and a no-tracking read is the correct choice for a projection (`:37-41`). A missing account returns `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)` (`:96-97`).
  - **The subject snapshot** (`:100`): one `await` on the abstract `BuildSubjectSnapshotAsync`.
  - **The fan-out** (`:102-108`): a plain `foreach` over the injected sections, awaited one at a time. The comment states both reasons (`:102-103`): sections share the scoped unit of work and its `DbContext`, which is not thread-safe, and registration order is the published order of the document. This is the one place where the obvious "parallelize the I/O" instinct is wrong.
  - **The envelope** (`:110-117`): `FormatVersion`, `GeneratedOn = timeProvider.GetUtcNow()`, `UserId`, the subject, and the section envelopes.
  - **The tail** (`:119`): `OnExportCompletedAsync`, then `Result.Success(export)` (`:121`).
  - **`RunSectionAsync`** (`:166-199`) is the degradation boundary. It calls the section, copies the four result fields into a [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`:177-183`), and catches with the filter `when (ex is not OperationCanceledException)` (`:185`), so **cancellation is not degradation** and propagates as cancellation. On any other exception it logs the full exception through its own private source-generated `ExportSectionUnavailable` (`:190`, declared at `:201-202` at `LogLevel.Warning` with the template "Data-subject export section {Section} unavailable for user {UserId}; export continues with Available=false") and returns an envelope with `Available = false` and the generic [`UserDataExportSectionDefaults.UnavailableReason`](#userdataexportsectiondefaults) (`:192-197`): detail to the log, nothing internal to the subject.
  - **The three extension points**: `HasExportPrivilege(string?)` (abstract, `:130`), the role that bypasses ownership; `BuildSubjectSnapshotAsync(TUser, TQuery, CancellationToken)` (abstract, `:144-147`), which fields of the account are portable personal data, asynchronous and given the query because an app may need to read a second owned aggregate (`:22-25`); and `OnExportCompletedAsync(...)` (virtual, defaulting to `Task.CompletedTask`, `:159-164`), the app's tail for an access-log row or a metric, documented as not mutating the export and as owning its own failures because the export has already succeeded (`:149-153`).

- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) records the decision, and the shape deliberately mirrors [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand): the same ownership gate through the same helper, the same privileged-role hook. The credential fields are excluded from the snapshot by contract (`:132-136`): a password hash and salt and an external-provider key are secrets, not portable personal data. Refresh-token material is not the subject snapshot's concern at all: sign-in sessions reach the export through the framework's own [`RefreshSessionUserDataExportSection`](#refreshsessionuserdataexportsection), which projects every session without its token hash. The degraded-section log is `Warning`, not `Error`, on purpose: a degraded section is an expected, handled outcome of a best-effort fan-out and the request itself still succeeds (`:201`). Declaring that log method on the class itself keeps it next to the only call site, while the log category is whatever `ILogger` the app subclass passes to the primary constructor.

- **Where it's used**: subclassed in each app's Identity Application assembly, where the convention scanner picks the concrete subclass up as an ordinary `IQueryHandler` with no extra registration (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ModuleScanning.cs:111-115`, and the point is spelled out in the export-section registration doc at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Extensibility.cs:31-36`). ADC's `ExportUserDataHandler` closes it over `User` and `ExportUserDataQuery` and overrides only the two abstract members (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:32`, privilege = `UserRole.IsOrganizer` at `:38`, snapshot at `:41`); Store's does the same with its own `User` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:34`). Behaviour is pinned by `ExportUserDataHandlerBaseTests`, including a section that throws (`.../ExportUserDataHandlerBaseTests.cs:138`) and a section that cancels (`:217`).

- **Caveats / not-in-source**: the framework also ships an abstract `[FeatureGate]`-d endpoint, [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:60-61`), but neither app subclasses it: both kept their own export endpoints on top of this handler base, which the ADR records as an unadopted part of the decision.

---

### DependencyInjection
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:19` · Level 17 · class (static, extension, partial)

- **What it is**: the single composition root for the entire Infrastructure layer. A `static partial class` split across seven files by concern (`DependencyInjection.cs`, `.Auth.cs`, `.Caching.cs`, `.Jobs.cs`, `.Messaging.cs`, `.Notifications.cs`, `.Persistence.cs`), each carrying its own C# preview `extension(IServiceCollection services)` block, so the registration surface reads as one type while the methods live next to the settings and services they wire. `DependencyInjection.cs` carries `AddInfrastructure(IConfiguration)` (`DependencyInjection.cs:58`), `AddMultiTenancy(IConfiguration)` (`:297`), `AddServices()` (`:315`), `AddEntityConfigurationAssembly(Assembly)` (`:373`) and `AddStronglyTypedIds(params Assembly[])` (`:401`), plus the internal `AddRawSqlQueryExecutor` helper below its extension block (`:426`); `.Caching.cs` carries `AddCaching(IConfiguration?)` (`DependencyInjection.Caching.cs:30`), `AddCommonHybridCache(Action<HybridCacheOptions>?)` (`:158`) and `AddCommonHybridCacheWhenRedisConfigured(IConfiguration, string)` (`:219`); `.Jobs.cs` carries `AddScheduledJobs(IConfiguration)` (`DependencyInjection.Jobs.cs:36`), `AddScheduledJob<TJob>()` (`:72`) and `AddAuditTrail(IConfiguration)` (`:108`), plus the private `AddInternalCommands` helper (`:146`); `.Notifications.cs` carries `AddNotificationInfrastructure()` (`DependencyInjection.Notifications.cs:25`) and `AddPushNotifications(IConfiguration)` (`:38`); `.Messaging.cs` carries `AddBrokerMessaging(IConfiguration, Action<IBrokerConsumerBuilder>?)` (`DependencyInjection.Messaging.cs:63-65`) and `AddBrokerTransport(IBrokerTransport)` (`:174`), plus four private static helpers below its extension block (`:199`, `:248`, `:270`, `:293`); `.Persistence.cs` carries `AddNpgsqlDataSourceConfigurator(INpgsqlDataSourceConfigurator)` (`DependencyInjection.Persistence.cs:24`); and `.Auth.cs` carries the five opt-in identity completions (`DependencyInjection.Auth.cs:19-221`). Native push and blob storage registration no longer live here: the vendor implementations are registered by the adapter packages (`DependencyInjection.cs:373-385`, [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)).

- **Depends on**: nearly every Infrastructure type below it, wired by interface. Persistence: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory), [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice), [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets), [`DefaultEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#defaultentityconfigurationassemblyprovider), [`EFQueryableExecutor`](group-07-persistence-ef-core.md#efqueryableexecutor), [`SqlServerUniqueConstraintViolationDetector`](group-07-persistence-ef-core.md#sqlserveruniqueconstraintviolationdetector), [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype), [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory), [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork), [`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor), [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), [`INpgsqlDataSourceConfigurator`](group-07-persistence-ef-core.md#inpgsqldatasourceconfigurator), [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor). Messaging/outbox: [`IMessageBus`](group-04-events-outbox.md#imessagebus)/[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)/[`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`IEventBus`](group-04-events-outbox.md#ieventbus)/[`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus)/[`BrokerEventBus`](group-04-events-outbox.md#brokereventbus), [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), [`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice), [`OutboxAdministration`](group-04-events-outbox.md#outboxadministration), [`EfInboxStore`](group-04-events-outbox.md#efinboxstore)/[`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore)/[`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice), [`IBrokerTransport`](#ibrokertransport) with [`RabbitMqBrokerTransport`](#rabbitmqbrokertransport)/[`PostgreSqlBrokerTransport`](#postgresqlbrokertransport), [`BrokerTransportContext`](#brokertransportcontext), [`MessageBusProviders`](#messagebusproviders). Cross-cutting: [`ICacheService`](group-09-caching.md#icacheservice) with [`MemoryCacheService`](group-09-caching.md#memorycacheservice)/[`HybridCacheService`](group-09-caching.md#hybridcacheservice), [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace), [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) with [`RedisDistributedLock`](#redisdistributedlock)/[`InProcessDistributedLock`](#inprocessdistributedlock), [`IJwksProvider`](group-08-auth.md#ijwksprovider)/[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider), [`TokenService`](group-08-auth.md#tokenservice), [`LoginProtectionService`](group-08-auth.md#loginprotectionservice), [`PasswordResetTokenService`](group-08-auth.md#passwordresettokenservice), [`AuthSessionIssuer`](group-08-auth.md#authsessionissuer), [`UserSessionsAdministrationService`](group-08-auth.md#usersessionsadministrationservice), [`EFRefreshSessionStore`](group-07-persistence-ef-core.md#efrefreshsessionstore) with [`RefreshSessionCleanupService`](group-07-persistence-ef-core.md#refreshsessioncleanupservice), [`TotpTwoFactorService`](group-08-auth.md#totptwofactorservice), [`TwoFactorAuthenticator`](group-08-auth.md#twofactorauthenticator), [`EmailConfirmationTokenService`](group-08-auth.md#emailconfirmationtokenservice), [`PermissionGrantModelGate`](group-07-persistence-ef-core.md#permissiongrantmodelgate), [`EFPermissionGrantStore`](group-07-persistence-ef-core.md#efpermissiongrantstore), [`PermissionGrantCache`](group-07-persistence-ef-core.md#permissiongrantcache), [`PermissionGrantRefreshService`](group-07-persistence-ef-core.md#permissiongrantrefreshservice), [`StoredPermissionRoleAdministrationService`](group-08-auth.md#storedpermissionroleadministrationservice), [`LayeredPermissionRegistry`](group-08-auth.md#layeredpermissionregistry), [`ClaimBasedUserIdProvider`](group-08-auth.md#claimbaseduseridprovider), [`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator), [`StartupConfigurationSummaryService`](#startupconfigurationsummaryservice), [`CloudAdapterTripwire`](#cloudadaptertripwire) with [`CloudAdapterTripwireOptions`](#cloudadaptertripwireoptions), [`ScheduledJobRunner`](#scheduledjobrunner), [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader)/[`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader), [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob), [`TenantContext`](#tenantcontext), [`CorrelationContext`](group-12-api-hosting-mapping.md#correlationcontext), [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender)/[`NullLiveChannelPublisher`](group-10-notifications.md#nulllivechannelpublisher), [`NullNativePushSender`](#nullnativepushsender), [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar), [`NullFileStorageService`](#nullfilestorageservice). Settings: [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) with [`ConnectionStringSettingsValidator`](group-07-persistence-ef-core.md#connectionstringsettingsvalidator), [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings)/[`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings), [`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](group-04-events-outbox.md#outboxsettings), [`PersistenceSettings`](group-07-persistence-ef-core.md#persistencesettings), [`SmtpSettings`](#smtpsettings), [`JwksSettings`](group-08-auth.md#jwkssettings), [`CacheSettings`](group-09-caching.md#cachesettings), [`QueryCachePipelineSettings`](#querycachepipelinesettings), [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), [`PasswordResetSettings`](group-08-auth.md#passwordresetsettings), [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings), [`LegalAcceptanceOptions`](group-08-auth.md#legalacceptanceoptions), [`SchedulerSettings`](#schedulersettings), [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings), [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) with [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator), [`PushNotificationSettings`](#pushnotificationsettings). Externals: `RabbitMQ.Client` for the built-in RabbitMQ transport (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:49`; there is no messaging library between the framework and the broker SDKs since MassTransit was removed in v1.316.0, [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)), StackExchange.Redis, `Microsoft.Extensions.Caching.Hybrid`, `Microsoft.AspNetCore.SignalR`, Npgsql, Scrutor. No cloud vendor SDK: those live in the adapter packages ([ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)).

- **Concept introduced, the mega-composition-root plus the swap-at-the-edge extraction pattern.** `[Rubric §3, Clean Architecture]` assesses whether wiring lives at the edge rather than in the core: every concrete Infrastructure choice is registered here, not in Application or Domain. `[Rubric §12, Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`: the method bodies are the framework's default posture, and each optional capability (broker, scheduler, audit trail, tenancy, hybrid cache, push, the identity completions) is a separate opt-in method a host layers on, so the same package runs as a monolith or as an extracted service without recompiling the core. The default everywhere is `TryAdd*`, meaning a host can pre-register its own implementation and the framework will not clobber it; the places that deliberately break that rule are the broker swap (`Replace`, `DependencyInjection.Messaging.cs:119` and `:125`), `AddCommonHybridCache` (`RemoveAll`, `DependencyInjection.Caching.cs:188`), and `AddPushNotifications`, which appends the SignalR senders over their null defaults (`DependencyInjection.Notifications.cs:76-77`) and `Replace`s SignalR's own `IUserIdProvider` (`:67`), and each says so in a comment. `[Rubric §17, DevOps]`: registering a capability is consistently NOT the same as enabling it: the scheduler and the audit trail both stay inert until their `Enabled` flag is true (`DependencyInjection.Jobs.cs:31-33`, `:89-92`), and the internal-command processor runs only under `InternalCommands:Enabled` (`:174-183`), so a host ships the registration and an environment turns it on. `[Rubric §15, Best Practices & Code Quality]`: the places where a misconfiguration would be silent instead throw or warn at startup, which is the running theme of this file.

- **Walkthrough** (in registration order):
  - **`AddInfrastructure` (`DependencyInjection.cs:57-266`)** is the entry point. It registers the model-facing singletons (`:59-60`) and the three EF save interceptors as singletons because they are stateless with per-save state in a `ConditionalWeakTable` keyed by context (`:62-70`), including [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), which is registered unconditionally so a host can never leave the write-side tenancy guard half-wired (`:67-70`). It registers [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets) once (`:96`), the set of databases the framework table sweeps (outbox, internal commands, audit trail) visit, and binds [`SmtpSettings`](#smtpsettings) with validation (`:98-101`). The raw-SQL executor goes through the internal `AddRawSqlQueryExecutor` helper (`:116`), which registers `IRawSqlQueryExecutor` only when the default source is on a relational engine, so a Cosmos-default host fails at resolution rather than on its first statement (`:416-426`); it is scoped because it reaches the scope's own context through `IDbContextFactory`, sharing the caller's connection and any open transaction (`:113-115`). `IConcurrencyConflictDetector`/`EfCoreConcurrencyConflictDetector` is `TryAddSingleton` (`:126`), the sibling classifier to the unique-constraint detector for a save rejected by a moved concurrency token. Near the end it calls the private `AddInternalCommands` helper (`:252`, [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)), then `AddServices()` (`:254`), then decorates `ICurrentUserService` with [`ImpersonatingCurrentUserService`](#impersonatingcurrentuserservice) via `TryDecorate` (`:256-263`), guarded on whether [`ScopedUserOverride`](#scopeduseroverride) is already registered so a host whose modules each call `AddInfrastructure` does not stack one decorator per call.
  - **Settings binding, and the one rule annotations cannot express.** [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) binds through `AddOptions(...).ValidateDataAnnotations().ValidateOnStart()` (`:72-75`), then [`ConnectionStringSettingsValidator`](group-07-persistence-ef-core.md#connectionstringsettingsvalidator) is added through `TryAddEnumerable` (`:82-83`) with the reason inline (`:77-81`): "a host must reach some database" spans the `ConnectionStrings` section AND the `DataSources` one, so a SQLite-only host declaring its databases as named sources is legitimate while a host declaring none anywhere is not. The same `TryAddEnumerable` idiom recurs for every validator and startup check in the file, so two modules calling `AddInfrastructure` never run one validation twice.
  - **The named-data-sources note (`:85-89`)** is load-bearing: [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) is built directly from `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` rather than through `AddOptions`, because a root-level dictionary section does not bind through the options pipeline. The resolver and the eager entity registry follow immediately (`:91-92`).
  - **The physical-factory warning (`:103-109`)**: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is scoped (one per request) and [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory) is a singleton that must **never** be converted to EF context pooling, because each raw context carries per-source constructor state that pooling would silently reuse across databases. Beside them sit the stateless query executor (`:111`) and the unique-constraint classifier (`:118-121`), the latter `TryAdd`ed so a host on another engine can register its own first and keep it.
  - **The Scrutor scan (`:132-138`)** discovers every [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientitytypeconfigurationbasetentity-tidentifiertype) in the Infrastructure assembly via `FromAssemblyOf<ClassReference>()` (`:135`) and registers each as its implemented interfaces, scoped to match the DbContext lifetime, closing the loop back to [`ClassReference`](#classreference-1). `AddCaching(configuration)` is called immediately after (`:140`), followed by the `PersistenceSettings` and `OutboxSettings` bindings (`:144-152`).
  - **The auth block (`:154-190`)** binds [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), [`PasswordResetSettings`](group-08-auth.md#passwordresetsettings) and [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings) with their scoped services, registers [`AuthSessionIssuer`](group-08-auth.md#authsessionissuer) scoped (it issues, rotates and revokes the token pair, `:174-176`) and the administrator's read-only [`UserSessionsAdministrationService`](group-08-auth.md#usersessionsadministrationservice) scoped (`:178-180`), and gates one hosted service: [`RefreshSessionCleanupService`](group-07-persistence-ef-core.md#refreshsessioncleanupservice) is registered only when `RefreshSessions:Enabled` is true (`:186-190`), on the same flag that maps the table. The comment names the failure it avoids (`:182-185`): an unconditional registration would start a periodic sweep (every `CleanupIntervalHours`, default 6) in every service of a modular host, all but one of which has no table to sweep. [`MessageBusSettings`](#messagebussettings) and [`JwksSettings`](group-08-auth.md#jwkssettings) with [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) follow (`:192-201`).
  - **Three startup checks (`:203-223`)**, each added through `TryAddEnumerable`. [`EventUpcasterStartupValidator`](#eventupcasterstartupvalidator) (`:207-208`) fails the host at start on a duplicate source, a self-map or a cycle rather than dead-lettering the first retired-contract message ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)). [`StartupConfigurationSummaryService`](#startupconfigurationsummaryservice) (`:214-215`) writes one Information line per host start naming the resolved posture (version, engines, bus, cache, tenancy) plus the RabbitMQ delayed-redelivery-off Warning (`:210-213`). [`CloudAdapterTripwire`](#cloudadaptertripwire) validates [`CloudAdapterTripwireOptions`](#cloudadaptertripwireoptions) on start (`:221-223`): an enabled `NativePush` section whose sender still resolves to the inert core default means the vendor adapter call is missing, so the host fails naming the call instead of running with pushes dropped (`:217-220`).
  - **The outbox is a transport decision (`:225-250`).** [`OutboxSignal`](group-04-events-outbox.md#outboxsignal) is always registered (`:225`). Then the message-bus section is read eagerly (`:233-234`), passed to the private `EnsureOutboxAvailableForProvider` guard (`:235`), and [`MessageBusSettings`](#messagebussettings)`.IsOutboxEnabled` decides between the two hosted outbox services ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) plus [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), `:237-241`) and a single [`OutboxDisabledNoticeService`](group-04-events-outbox.md#outboxdisablednoticeservice) (`:244`). The comment states the trade in full (`:227-232`): a broker deployment cannot deliver without the outbox, while a single-process host would pay two hosted services, a table and a poll loop for a hop it never takes, and the `OutboxMessages` table stays mapped either way so flipping the flag is never a migration ([ADR-100](https://ivanball.github.io/docs/adr/100-outbox-opt-in-resolved-from-messaging-mode.html)). The operator surface [`OutboxAdministration`](group-04-events-outbox.md#outboxadministration) is scoped, because it creates one child scope per data source it visits (`:247-250`).
  - **`AddInternalCommands` (`DependencyInjection.Jobs.cs:141-179`)** mirrors the outbox posture: it binds `InternalCommandsSettings`, registers the signal, the origin capture and [`IInternalCommandScheduler`](#iinternalcommandscheduler) scoped on the caller's own context factory so scheduling is atomic with the aggregate change (`:158-162`), and the operator surface [`IInternalCommandAdministration`](#iinternalcommandadministration) (`:164-167`). Only `InternalCommands:Enabled` adds [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor) plus its cleanup service; otherwise a disabled-notice service (`:174-183`). The table is mapped unconditionally, so the flag never implies a migration (`:135-138`).
  - **`AddCaching` (`DependencyInjection.Caching.cs:30-126`)** does two probes in one method, and its `IConfiguration` parameter is optional. With configuration it binds the key-prefix options plus [`CacheSettings`](group-09-caching.md#cachesettings) and the Application layer's [`QueryCachePipelineSettings`](#querycachepipelinesettings) (`:44-57`); without it, both are registered bare so `IOptions<T>` still resolves to framework defaults instead of failing a host that called the parameterless overload (`:58-62`, with the reasoning at `:34-43`). It post-configures `RedisOutputCacheOptions.InstanceName` to the same key namespace (`CacheKeyNamespace.From(sp)`, `:75`) when the host left it empty, so two applications on one Redis do not share output-cache entries or tag sets (`:64-77`, [ADR-135](https://ivanball.github.io/docs/adr/135-application-namespace-keyspace-isolation.html)). The cache (`:79-99`): `AddCaching` registers only the in-process [`MemoryCacheService`](group-09-caching.md#memorycacheservice) (`:96-98`), where the keyspace is private to the process so no prefix is needed. A shared distributed cache is served only by [`HybridCacheService`](group-09-caching.md#hybridcacheservice), which `AddCommonHybridCache` registers in place of this one (`:162-208`), so if an `IDistributedCache` is registered and is not the no-op `MemoryDistributedCache` when this factory runs, it throws an `InvalidOperationException` naming `AddCommonHybridCache` rather than silently falling back to a per-replica cache (`:86-93`). The lock: [`RedisDistributedLock`](#redisdistributedlock) when a multiplexer resolves, keyed by the [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) (`:111-118`), [`InProcessDistributedLock`](#inprocessdistributedlock) otherwise (`:120-122`). The comment explains why the lock is registered next to the cache at all (`:101-108`): all five in-framework callers pair the two (the API idempotency filter, password-reset token redemption, the two-factor authenticator's last-accepted time step, `OAuthControllerBase`'s read-and-burn of a single-use exchange code, and `PasskeyChallenges`' challenge redemption and passkey deletes).
  - **`AddCommonHybridCache` (`DependencyInjection.Caching.cs:162-208`)** is the opt-in two-level cache ([ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)). It calls `AddHybridCache` (`:160`), then configures `HybridCacheOptions` **through the options pipeline** rather than the `AddHybridCache` callback (`:166-180`), because the TTL policy comes from the bound `Cache` section and the callback has no service provider to read it from (`:162-165`); the host's own hook runs last so it can override anything the framework set (`:179`). It then deliberately does `RemoveAll<ICacheService>()` before `AddSingleton` (`:184-198`) so the call wins whether it runs before or after `AddInfrastructure`. The remarks are honest about the cost of that choice (`:147-151`): `RemoveAll` does not distinguish the framework's registration from a host's own custom `ICacheService`, so calling this is a statement that the two-level cache IS the cache. `AddCommonHybridCacheWhenRedisConfigured` (`:219-231`) is the guarded form: it calls `AddCommonHybridCache` only when the named Redis connection string (default `redis`) is set (`:225-228`), since with no L2 the hybrid tier degrades to what `MemoryCacheService` already provides (`:208-214`).
  - **`AddScheduledJobs` (`DependencyInjection.Jobs.cs:36-50`) and `AddScheduledJob<TJob>` (`:72-78`)** wire the recurring-job feature ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)). The first binds [`SchedulerSettings`](#schedulersettings) with validation (`:39-42`) and registers [`ScheduledJobRunner`](#scheduledjobrunner) via `TryAddEnumerable` rather than `AddHostedService` (`:44-48`), so a host or two modules calling it twice cannot run two runners racing for the same rows. The second registers one job scoped, both as the concrete type and into the accumulating `IEnumerable<IScheduledJob>` (`:75-76`); the doc spells out that the job is scoped because the runner resolves it in a fresh scope per execution and it must hold no state between runs (`:66-70`).
  - **`AddAuditTrail` (`DependencyInjection.Jobs.cs:107-126`)** binds [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) (`:110-113`), registers the trail interceptor as a singleton for the same statelessness reason as the other save interceptors (`:115-117`), the scoped reader (`:119`), and, notably, `AddScheduledJob<`[`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob)`>()` (`:124`). Registering the retention job here rather than in `AddScheduledJobs` keeps the two features independent, and the remarks state the operational consequence plainly (`:97-101`): without the scheduler the trail still records every change and nothing is ever purged, so `AuditTrail:RetentionDays` is inert.
  - **`AddMultiTenancy` (`DependencyInjection.cs:297-309`)** binds [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) and adds [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator) through `TryAddEnumerable` (`:305-306`). What it switches on is *resolution*, not isolation: the filter, the interceptor and `ITenantContext` are always present and inert until a tenant resolves (`:276-280`), and a `Tenancy:Tenants:{id}:DataSources:{sourceName}` override naming a source that does not exist fails startup rather than silently falling back to the shared database (`:289-294`).
  - **The five opt-in identity completions ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)), in `DependencyInjection.Auth.cs`.** `AddTwoFactorAuthentication(configuration)` (`DependencyInjection.Auth.cs:47-66`) binds `TwoFactorSettings` and registers `ITwoFactorService`/[`TotpTwoFactorService`](group-08-auth.md#totptwofactorservice) singleton (pure over its arguments, `:54-55`), [`ITwoFactorSecretProtector`](group-08-auth.md#itwofactorsecretprotector)/[`DataProtectionTwoFactorSecretProtector`](group-08-auth.md#dataprotectiontwofactorsecretprotector) singleton plus `AddDataProtection()`, so the shared secret reaches the app's store only in protected form and a multi-replica host needs the shared key ring (`:57-60`), and `ITwoFactorAuthenticator`/[`TwoFactorAuthenticator`](group-08-auth.md#twofactorauthenticator) scoped (shares the request's unit of work, `:62-63`). It registers no `ITwoFactorStore` deliberately, because the account's secret and recovery hashes belong to the consumer's own `User` aggregate (`:31-34`). Calling it together with registering the app's store arms the sign-in challenge: provided the app registers `AuthenticationValidators` by type, the container builds it with the registered authenticator and `AuthenticationServiceBase` uses it whenever its own `twoFactor` argument is null, with no change to the app's `AuthenticationService` constructor; once called, the store is required, and a host that wants enrollment without the challenge overrides `ChallengeSecondFactorAsync` (`:37-44`). `AddEmailConfirmation(configuration)` (`DependencyInjection.Auth.cs:80-95`) binds `EmailConfirmationSettings` and registers `IEmailConfirmationTokenService`/[`EmailConfirmationTokenService`](group-08-auth.md#emailconfirmationtokenservice) scoped (`:88`), plus `TimeProvider.System` through `TryAddSingleton` (`:92`), because the token service stamps expiries from the injected clock: `AddServices` registers the same clock (`DependencyInjection.cs:368`), and the `TryAdd` keeps this call self-sufficient without displacing a host's own `TimeProvider`; an unconfirmed account is refused only once `RequireConfirmedEmail` is set AND the app's `User` implements `IEmailConfirmableUser` (`DependencyInjection.Auth.cs:75-78`). `AddSignInLinks(configuration)` (`DependencyInjection.Auth.cs:107-119`) binds [`SignInLinkSettings`](group-08-auth.md#signinlinksettings) with validation (`:109-112`) and registers [`ISignInLinkTokenService`](group-08-auth.md#isigninlinktokenservice)/[`SignInLinkTokenService`](group-08-auth.md#signinlinktokenservice) scoped plus `TimeProvider.System` through `TryAddSingleton` (`:115-116`); it issues nothing on its own, since links are sent and redeemed only once the app wires the handler bases and a controller AND `Authentication:SignInLinks:Enabled` is set (`:103-106`). `AddLegalAcceptance(configuration)` (`DependencyInjection.Auth.cs:140-149`) binds [`LegalAcceptanceOptions`](group-08-auth.md#legalacceptanceoptions) from the `Legal` section and nothing else: it registers no `ILegalAcceptanceService`, because the accepted version and instant belong to the app's own `User` aggregate, so the consumer supplies that implementation plus a controller deriving from `LegalAcceptanceControllerBase`. It deliberately omits `ValidateOnStart`, unlike its siblings, since the single `Legal:CurrentTermsVersion` setting has no invalid value (`:142-144`). The options reach registration through `AuthenticationValidators` as an optional constructor argument, so with the setting unset the call changes nothing. `AddStoredPermissionGrants(configuration)` (`DependencyInjection.Auth.cs:175-219`) binds `PermissionGrantSettings` (`:177-180`); registers the [`PermissionGrantModelGate`](group-07-persistence-ef-core.md#permissiongrantmodelgate) singleton (`:183`), whose presence is what tells `ApplicationDbContext` to map the grant table for the one data source named by `Authentication:PermissionGrants:DataSourceName`; the scoped [`EFPermissionGrantStore`](group-07-persistence-ef-core.md#efpermissiongrantstore) (`:185`); one [`PermissionGrantCache`](group-07-persistence-ef-core.md#permissiongrantcache) singleton that answers as both `IPermissionGrantCache` and `IPermissionGrantCacheInvalidator`, so an edit and the reads that follow it cannot see two different snapshots (`:187-193`); `IRoleAdministrationService`/[`StoredPermissionRoleAdministrationService`](group-08-auth.md#storedpermissionroleadministrationservice) (`:195`); and the [`PermissionGrantRefreshService`](group-07-persistence-ef-core.md#permissiongrantrefreshservice) hosted service through `TryAddEnumerable`, so two modules calling it never start two refresh loops (`:197-200`). It then decorates whatever `IPermissionRegistry` is registered with [`LayeredPermissionRegistry`](group-08-auth.md#layeredpermissionregistry) via `TryDecorate` (`:205`), so it belongs AFTER `AddAuthorizationPolicies()`; when `TryDecorate` finds nothing it registers a layered registry over an empty compiled one and offers that same empty instance as `IPermissionCatalog`, so the stored layer and the administration surface still work standalone (`:202-216`).
  - **`AddServices` (`DependencyInjection.cs:315-364`)** registers the small services and encodes a subtle lifetime lesson: [`TokenService`](group-08-auth.md#tokenservice) is a **singleton** (`:334`) with a six-line comment explaining why (`:328-333`): a scoped lifetime disposed the RSA handle at end-of-request while IdentityModel's static `CryptoProviderCache` still held the cached signature provider wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. `[Rubric §11, Security]` (correct signing-key lifecycle). It also sets the default [`IEventBus`](group-04-events-outbox.md#ieventbus) to [`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus) (`:336`) and the default [`IMessageBus`](group-04-events-outbox.md#imessagebus) to [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) (`:342`), registers [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) unconditionally with the reasoning inline (`:321-325`), registers `TimeProvider.System` and `SmtpEmailSender` (`:344-345`), and wires the inert no-op defaults for push and the live channel (`:346-347`), native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), [`NullNativePushSender`](#nullnativepushsender) and [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar), `:349-354`) and file storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), [`NullFileStorageService`](#nullfilestorageservice), `:356-361`). The comments name the vendor adapter calls that swap those defaults (Azure, AWS and GCP packages) and state that image normalization is the application's own concern, because decoding needs a native image library every consumer would otherwise carry (`:356-360`).
  - **`AddPushNotifications` (`DependencyInjection.Notifications.cs:41-89`)** binds the settings (`:40-43`), adds SignalR (`:45`), adds the Redis backplane only when a `redis` connection string exists (`:47-59`) with `ChannelPrefix` set to the resolved [`ApplicationNamespace`](#applicationnamespace) (`:56-58`), because the channel derives from a hub type every consumer shares, so without it one application's pushes reached another's clients (SEC-Common-53, `:50-55`). It appends the SignalR senders over the null defaults (`:62-63`) and `Replace`s SignalR's `DefaultUserIdProvider` with [`ClaimBasedUserIdProvider`](group-08-auth.md#claimbaseduseridprovider) (`:67`), since a `TryAdd` there never took effect and a principal carrying only the raw `sub` claim got a null `UserIdentifier` (`:64-66`).
  - **`AddBrokerMessaging` (`DependencyInjection.Messaging.cs:63-161`)** is the extraction pivot. It reads [`MessageBusSettings`](#messagebussettings), falling back to `new MessageBusSettings()` when the section is absent (`:69-70`); on `InProcess` it returns immediately (`:72-75`), leaving the in-process bus in place; otherwise it re-runs the outbox guard (`:80`, with the comment at `:77-79`: a service host that wires the broker without the full infrastructure registration must still fail loudly) and resolves the [`IBrokerTransport`](#ibrokertransport) before anything is registered, so an unregistered provider fails without leaving a half-registered broker behind (`:82-84`). It then requires `Application:Namespace` (`:86-89`, SEC-Common-53): every topic is prefixed with the resolved [`ApplicationNamespace`](#applicationnamespace), so two applications on one broker never publish onto each other's topics, and the value must be explicit because the fallback (the host's own application name) differs per service, which would put publishers and consumers on different topics. The host's consumer callback runs against a [`BrokerConsumerBuilder`](#brokerconsumerbuilder) (`:90-92`), where each service calls `RegisterIntegrationEventConsumer<TEvent>()` (or `RegisterUpcastedIntegrationEventConsumer<TEvent>()` for a retired contract) per event it handles (`:54-57`), and the result becomes one [`BrokerTopology`](#brokertopology) singleton: one queue (`MessageBus:QueueName` or the application name) with one subscription per consumed event (`:94-99`, described at `:41-46`). It registers one scoped consumer per subscription, resolved by the receive pipeline from a fresh scope per attempt (`:101-106`), and the singleton [`IBrokerReceivePipeline`](#ibrokerreceivepipeline) as [`BrokerReceivePipeline`](#brokerreceivepipeline), handed the transport's `MaxRedeliveryDelay` (`:108-115`). It then **`Replace`s** the scoped [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`:119`) and [`IEventBus`](group-04-events-outbox.md#ieventbus) with [`BrokerEventBus`](group-04-events-outbox.md#brokereventbus) (`:125`), the deliberate exception to the `TryAdd` rule, because the in-process bus must not run alongside the broker ([ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html), [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)). Last, after the inbox branch below, it calls `transport.Register` with a [`BrokerTransportContext`](#brokertransportcontext) carrying the settings, the resolved connection string, the configuration and the topology (`:150-158`), so the transport sees every framework registration and adds only its [`IBrokerPublisher`](#ibrokerpublisher) and its hosted receiver (`:41-46`), and a transport configuration error throws at startup. [`PostgreSqlBrokerTransport`](#postgresqlbrokertransport) registers its schema migrator inside that `Register` call, ahead of its receiver, because hosted services start in registration order (`Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:75-79`).
  - **The inbox branch (`DependencyInjection.Messaging.cs:132-148`)** chooses the consumer-side dedup store from `settings.IsInboxEnabled`, the resolved posture rather than the raw flag (unset means ON for a broker, `:127-131`): [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) scoped when on (`:134`, with `TimeProvider.System` `TryAdd`ed for its `ProcessedOn` stamp, `:138`), and when off the singleton [`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore) (`:142`) **plus** an [`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice) hosted service (`:147`). That second registration is the whole point of the branch: a disabled dedup store looks exactly like an enabled one until a duplicate side effect reaches a customer, so the posture costs one startup Warning to make visible (`:144-146`).
  - **`AddBrokerTransport` (`DependencyInjection.Messaging.cs:174-186`)** is how an adapter package (or a host with a transport of its own) makes a provider name selectable: it rejects an empty `Name` (`:178-181`) and adds the instance through `TryAddEnumerable` (`:183`), so registering the same adapter twice is harmless, and when two transports share a name the last one registered wins. It must run BEFORE `AddBrokerMessaging`, which picks the transport while registering the broker services (`:163-170`).
  - **The four private helpers (`DependencyInjection.Messaging.cs:189-302`)** sit outside the extension block. `ResolveBrokerTransport` (`:199-232`) returns the built-in [`RabbitMqBrokerTransport`](#rabbitmqbrokertransport) or [`PostgreSqlBrokerTransport`](#postgresqlbrokertransport) for those names (`:201-209`), else the LAST adapter transport registered under the name, read straight off the collection because no provider exists yet (`:211-221`); with no match it throws naming the adapter package and its registration call when [`MessageBusProviders`](#messagebusproviders) knows one, and the available providers (`:223-231`). `EnsureOutboxAvailableForProvider` (`:248-255`) throws when a broker transport is paired with an explicitly disabled outbox, and the message says why in operational terms: the outbox is the only publish path a broker deployment has, so the alternative is every cross-service event vanishing while the service looks healthy. `EnsureApplicationNamespaceConfigured` (`:270-281`) throws when `Application:Namespace` is missing or blank, and its message carries the fix (the same value on every service, with an `appsettings.json` and an environment-variable example). `ResolveBrokerConnectionString` (`:293-302`) applies an explicit precedence: `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq` (what Aspire injects), then `ConnectionStrings:messaging`; without that fallback a transport would keep its own default host (RabbitMQ's `localhost:5672`) and never reach the Aspire-allocated container port (`:283-292`).
  - **Retry, redelivery and dead-lettering live in one receive pipeline; the transports only apply its verdict.** `[Rubric §29, Resilience & Business Continuity]`: [`BrokerReceivePipeline`](#brokerreceivepipeline)`.ProcessAsync` (`Messaging/Consumers/BrokerReceivePipeline.cs:82`) dead-letters a message that cannot be read as its event type without retrying it (`:115-144`), runs the consumer up to `RetryLimit` + 1 times, each attempt in a fresh scope, waiting [`BrokerTransportPolicies`](#brokertransportpolicies)`.RetryDelay` between attempts (`BrokerReceivePipeline.cs:180-197`, `Messaging/Transports/BrokerTransportPolicies.cs:27`), then returns a `Redeliver` disposition on the next second-level interval (`BrokerReceivePipeline.cs:165-166`), the intervals coming from `BuildRedeliveryIntervals` clamped to the transport's `MaxRedeliveryDelay` (`BrokerReceivePipeline.cs:72`, `BrokerTransportPolicies.cs:65`), and a `DeadLetter` once they are spent (`BrokerReceivePipeline.cs:170-176`). Backpressure is the one policy each transport applies itself, from `ResolvePrefetchCount` (`BrokerTransportPolicies.cs:85`) and `ResolveConcurrentMessageLimit` (`:98`); RabbitMQ defaults the concurrency to the processor count and the prefetch to twice the concurrency (`Messaging/Transports/RabbitMq/RabbitMqBrokerTransport.cs:95`, `:104-105`). The Azure Service Bus transport lives in the `MMCA.Common.Azure` adapter package (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:37`) and Amazon SQS in `MMCA.Common.Aws` (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:40`), the one transport with a redelivery cap (15 minutes, `:65`).
  - **`AddNpgsqlDataSourceConfigurator` (`DependencyInjection.Persistence.cs:24-37`)** registers an [`INpgsqlDataSourceConfigurator`](group-07-persistence-ef-core.md#inpgsqldatasourceconfigurator) through `TryAddEnumerable` (`:28`) and a keyed `NpgsqlDataSource` singleton per distinct connection string (`:32-34`), so the PostgreSQL contexts and the readiness check share one data source; adapter packages call it from their own registration method (for example `AddAwsRdsIamAuthentication`), and it is order-independent relative to `AddInfrastructure` (`:12-20`).

- **Why it's built this way**: the `extension(IServiceCollection)` syntax keeps every Infrastructure registration on one type without a proliferation of static helper classes ([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)), and pushing all concrete choices into one composition root at the layer edge is what keeps Application and Domain free of framework references ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the database-per-service wiring, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the broker/extraction path). Vendor-specific transports, push senders and storage are registered by the adapter packages against the extension points here (`AddBrokerTransport`, `AddNpgsqlDataSourceConfigurator`, the `Null*` defaults), which keeps the core free of any cloud SDK ([ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)). See the DI-sequence note in `MMCA.Common/AGENTS.md`: hosts call `AddApplicationDecorators()` last so Scrutor can decorate handlers already registered, but the relative position of `AddInfrastructure` is not otherwise ordering-sensitive, and `AddCommonHybridCache` is explicitly documented as order-independent in both directions (`DependencyInjection.Caching.cs:142-148`).

- **Where it's used**: called from each service host's `Program.cs` (the reference apps and the extracted `MMCA.ADC.*` service hosts) after `AddApplication()`; the optional methods (`AddScheduledJobs`, `AddAuditTrail`, `AddMultiTenancy`, `AddCommonHybridCache` or `AddCommonHybridCacheWhenRedisConfigured`, `AddBrokerMessaging`, `AddPushNotifications`, the identity completions) are added by the specific hosts that need those capabilities. `AddScheduledJobsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:15`) pins the double-registration behavior of the scheduler pair.

- **Caveats / not-in-source**: the exact set of consuming `Program.cs` files is in the downstream apps (MMCA.ADC / MMCA.Store / MMCA.Helpdesk), not in this repository, so the precise call sites are Not determinable from source here.

### BrokerMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument set for the broker transport. One meter carrying two counters: integration events the receive pipeline dead-lettered after every retry and redelivery failed, and outbox publishes the circuit breaker refused to even attempt (`BrokerMetrics.cs:5-11`).

- **Depends on**: `System.Diagnostics.Metrics` (BCL) only (`BrokerMetrics.cs:1`). Nothing first-party. It is the exact same shape as [`SchedulerMetrics`](#schedulermetrics), for a different feature.

- **Concept**: the one-meter-per-feature instrument holder, taught under [`SchedulerMetrics`](#schedulermetrics). What is worth teaching here is *which two numbers* were chosen. `[Rubric §13, Observability & Operability]` assesses whether a running system can be understood from outside: broker delivery is asynchronous and out of band, so a consumer that keeps failing produces no failed HTTP response anywhere, and the only evidence is a message quietly landing in the dead-letter location. `broker.fault.count` is therefore the natural alert target for consumer health (`BrokerMetrics.cs:25-29`). The second counter exists because the class doc insists on a distinction an operator would otherwise have to infer: a publish rejected by an open circuit **never reached the broker at all** (`BrokerMetrics.cs:35-41`), which is different from a publish that reached it and failed. `[Rubric §29, Resilience & Business Continuity]`: those rejected rows stay leased and are retried on a later cycle, so the counter measures fail-fast behavior working as designed rather than data loss.

- **Walkthrough**:
  - `MeterName = "MMCA.Common.Broker"` (`BrokerMetrics.cs:21`) and the single static `Meter` built from it (`:23`). The doc carries the same never-create-a-second-meter warning as the scheduler (`BrokerMetrics.cs:13-15`), with the failure mode spelled out: a duplicate instance publishes a parallel set of instruments under one name, and a listener enabling one silently misses the measurements recorded on the other.
  - `FaultCounter` (`BrokerMetrics.cs:30-33`), `broker.fault.count`, unit `messages`, tagged by `event_type` and `queue`.
  - `CircuitOpenCounter` (`:42-45`), `broker.circuit.open.count`, same unit, tagged by `event_type` only.

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the recording sites resolve nothing from DI. The meter name is duplicated as a **literal** in MMCA.Common.Aspire (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:314`) because that package has no reference to Infrastructure, and the doc records that duplication rather than letting the next reader discover it (`BrokerMetrics.cs:8-11`). The instruments only move in a host that runs a broker transport, since the in-process bus has no receive pipeline and no broker publish path.

- **Where it's used**: [`BrokerReceivePipeline`](#brokerreceivepipeline) adds to `FaultCounter` in `AfterRetriesExhausted`, once the last second-level redelivery is spent, right after its one Error log, tagging the event type and the host's queue name (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:169-174`). [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) adds to `CircuitOpenCounter` on its publish path (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:669`), where an earlier comment notes that the per-row signal stays on the metric while the log line is per cycle (`OutboxProcessor.cs:540`).

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BrokerWire
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerWire.cs:12` · Level 0 · class (internal, static)

- **What it is**: the handful of wire-format facts the publish side ([`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus)) and the receive side ([`BrokerReceivePipeline`](#brokerreceivepipeline)) must agree on: the JSON options the message body is written and read with, and the trace source both hops report on (`BrokerWire.cs:7-11`).

- **Depends on**: BCL only: `System.Diagnostics.ActivitySource` and `System.Text.Json` (`BrokerWire.cs:1-3`). Nothing first-party.

- **Concept introduced: one definition of a contract both ends of a hop share.** `[Rubric §10, Messaging & Integration Architecture]` assesses whether a message survives the trip between processes unchanged. A publisher and a consumer that each build their own serializer options can drift apart one setting at a time and only disagree in production, so both ends read the one static instance here. `[Rubric §13, Observability & Operability]`: the broker hop is where a distributed trace most often breaks, so publish and delivery report on one named source and are parented across the broker through the W3C `traceparent` header (`BrokerWire.cs:14-19`).

- **Walkthrough**:
  - `ActivitySourceName = "MMCA.Common.Messaging"` (`BrokerWire.cs:19`): one Producer span per publish and one Consumer span per delivery (`:14-18`).
  - `MessagingSystem = "mmca"` (`BrokerWire.cs:22`): the `messaging.system` tag value stamped on both spans.
  - `ActivitySource` (`BrokerWire.cs:25`): the single shared source built from the name.
  - `JsonOptions` (`BrokerWire.cs:34-37`): `ReferenceHandler.IgnoreCycles` and otherwise the System.Text.Json defaults, identical to the options `OutboxMessage` serializes its payload with, so an event that round-trips through the outbox round-trips through the broker in exactly the same shape (`:27-33`).

- **Why it's built this way**: the options are a copy, not a shared reference, because the outbox's instance is private to the persistence layer (`BrokerWire.cs:31-33`). The source name is a literal that MMCA.Common.Aspire subscribes by name, because that package has no reference to Infrastructure (`BrokerWire.cs:16-17`, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:84`).

- **Where it's used**: `BrokerMessageBus` starts the Producer span, stamps `messaging.system` and serializes the body with `JsonOptions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:70`, `:73`, `:83`); `BrokerReceivePipeline` deserializes with the same options and starts the Consumer span named after the host's queue (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:132`, `:257`, `:260`).

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### ExceptionChain
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Diagnostics` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Diagnostics/ExceptionChain.cs:25` · Level 0 · class (internal, static)

- **What it is**: a one-line renderer for an exception and its causes, used for a background job's `LastError` column, its log text and its span status (`ExceptionChain.cs:5-8`).

- **Depends on**: BCL only (`StringBuilder` from `System.Text`, `Stack<T>`, `AggregateException`) (`ExceptionChain.cs:1`).

- **Concept introduced: record the cause, not the wrapper.** `[Rubric §13, Observability & Operability]` assesses whether a failure can be diagnosed from what the system recorded. Wrapper exceptions hide the cause: `SmtpException` says only "Failure sending mail." while the server's reply sits on `InnerException`, and recording the outer message alone left 21 dead-lettered attempts in Store production (2026-11-01) with nothing to diagnose (`ExceptionChain.cs:11-14`). The answer is to walk the chain, not to store stack traces: the column and the span status are read by people, and the processors that need a stack log the exception object itself (`:20-22`).

- **Walkthrough**:
  - `MaxLevels = 8` (`ExceptionChain.cs:28`): the most levels, the outer exception included, one description renders. `Separator` is `" ---> "` (`:30`).
  - `Describe(exception)` (`ExceptionChain.cs:35-63`) starts with the outer message, then walks the causes depth first through an explicit stack (`:45-46`) until it is empty or `MaxLevels` is reached (`:48`). Each cause is appended as `" ---> {Type}: {Message}"`, except one repeating the previous message, which adds nothing and is skipped (`:53-57`). An exception with no cause renders as its bare message.
  - `PushCauses` (`ExceptionChain.cs:65-78`) pushes every inner exception of an `AggregateException` in reverse, so the first one is rendered first (`:67-73`), and otherwise the single `InnerException` (`:74-77`).

- **Why it's built this way**: an explicit stack rather than recursion keeps the walk ordered for aggregates nested inside aggregates, and the level cap keeps one pathological chain from flooding a column; callers still fit the result to their column width (`ExceptionChain.cs:17-22`).

- **Where it's used**: [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) for a failed row's error (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:647`), [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor) for a command that threw (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:500`), and [`ScheduledJobRunner`](#scheduledjobrunner) for a failed job run (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:654`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Diagnostics/ExceptionChainTests.cs`.

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
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:91` · Level 0 · class (private nested, sealed)

- **What it is**: the release token for a [`RedisDistributedLock`](#redisdistributedlock) acquisition. Disposing it runs a compare-and-delete Lua script that removes the Redis key only while it still carries this acquisition's token.

- **Depends on**: nothing first-party. Externals: StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`) and `Microsoft.Extensions.Logging`; `Interlocked` for the latch. Same handle shape as [`InProcessLockHandle`](#inprocesslockhandle), with real asynchronous work in the release.

- **Concept**: the owner-token release, the half of the `SET NX PX` lock that keeps it honest (the acquire half is taught under [`RedisDistributedLock`](#redisdistributedlock)). `[Rubric §13, Observability & Operability]` assesses whether a system reports its own degradation: a release that finds nothing to delete is exactly the case where the guarded section outran its time-to-live and stopped being exclusive, so the handle logs a warning naming the key rather than swallowing it. The same applies when the release itself fails: it is best-effort by the `IDistributedLock` contract, so the fault is logged as a warning and the holder's already-completed work is not turned into a failure.

- **Walkthrough**: the primary constructor captures the `IDatabase`, the already-qualified `RedisKey`, this acquisition's `RedisValue` token, and a logger (`RedisDistributedLock.cs:91-95`), with the same `int _released` latch (`RedisDistributedLock.cs:97`). `DisposeAsync` (`RedisDistributedLock.cs:99-130`) returns immediately when the latch was already set (`RedisDistributedLock.cs:101-104`); otherwise it evaluates `ReleaseScript` with that key and token inside a `try` (`RedisDistributedLock.cs:111-115`). The script is `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end` (`RedisDistributedLock.cs:36-37`), one round trip that compares and deletes atomically on the server. A `0` result means the key was already gone or is owned by someone else now, so there is nothing to release and `LogLockAlreadyExpired` warns (`RedisDistributedLock.cs:117-122`, message text at `RedisDistributedLock.cs:84`). Any exception from the release (a Redis fault or timeout) is caught by a deliberate broad `catch (Exception)` under a justified `CA1031` suppression (`RedisDistributedLock.cs:124-129`) and logged through `LogLockReleaseFailed` (`RedisDistributedLock.cs:87-88`) instead of propagating, because the release runs after the guarded work has already committed and the lock expires on its own time-to-live (`RedisDistributedLock.cs:106-110`). The code comment notes `RedisTimeoutException` is not a `RedisException`, hence the broad catch.

- **Why it's built this way**: a plain `DEL` would let a caller whose lock had already expired free the *next* holder's lock, which is precisely the double execution the lock exists to prevent (`RedisDistributedLock.cs:32-34`). Doing the comparison inside a Lua script makes compare-and-delete atomic server-side instead of a racy get-then-delete from the client ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).

- **Where it's used**: constructed by `RedisDistributedLock.TryAcquireAsync` (`RedisDistributedLock.cs:72`). `RedisDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:15`) asserts the acquire/release pairing against a mocked `IDatabase`, including the qualified key the handle deletes.

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

- **Where it's used**: registered by `AddCaching` in the Infrastructure composition root when no `IConnectionMultiplexer` is resolvable (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:120-122`, inside the `IDistributedLock` factory at `:84-98`; see [`DependencyInjection`](#dependencyinjection-1)), which covers MMCA.Helpdesk, local single-process runs, and tests. Behavior is pinned by `InProcessDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/InProcessDistributedLockTests.cs:12`).

---

### RedisDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:24` · Level 2 · class (internal, sealed, partial)

- **What it is**: the cross-replica [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock), implemented as the standard `SET key token NX PX ttl` Redis lock against a single Redis instance.

- **Depends on**: `IConnectionMultiplexer` and the rest of StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`), `ILogger<RedisDistributedLock>`, and an optional [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) (`RedisDistributedLock.cs:24-27`), which is what puts this type at Level 2 rather than Level 1. It returns its nested [`RedisLockHandle`](#redislockhandle).

- **Concept**: the acquire half of the lock taught in two pieces with [`RedisLockHandle`](#redislockhandle). `[Rubric §12, Performance & Scalability]` assesses scale-out correctness: moving the lock into Redis is what makes "only one of these runs at a time" true across replicas instead of true per process, which is the whole reason the abstraction exists (see [`InProcessDistributedLock`](#inprocessdistributedlock) for the degraded alternative). `[Rubric §29, Resilience & Business Continuity]` assesses failure behavior: the expiry carried on the `SET` is the crash guard (a holder that dies releases by expiry rather than wedging the key forever, `RedisDistributedLock.cs:12-17`), and the class documents that it is deliberately **single-instance, not Redlock** (`RedisDistributedLock.cs:19-23`), inheriting Redis's failover behavior, which is exactly why the contract is documented as best-effort. The release side honors the same posture: a fault while releasing is caught and logged by the handle (`RedisDistributedLock.cs:124-129`, see [`RedisLockHandle`](#redislockhandle)) rather than failing the already-committed guarded work.

- **Walkthrough**:
  - **State.** `KeyPrefix` is `"lock:"` (`RedisDistributedLock.cs:30`) so lock entries cannot collide with cache entries in a shared instance. `ReleaseScript` (`RedisDistributedLock.cs:36-37`) is the compare-and-delete Lua taught under [`RedisLockHandle`](#redislockhandle). `PollInterval` is 50 ms (`RedisDistributedLock.cs:40`); unlike the in-process poll, each retry here is a network round trip. `_keys` falls back to `CacheKeyNamespace.None` when no namespace was injected (`RedisDistributedLock.cs:42`), so the `Cache:KeyPrefix` option (when configured) qualifies lock keys the same way it qualifies cache keys.
  - **Argument guards.** `TryAcquireAsync` (`RedisDistributedLock.cs:45-82`) applies the same three checks as the in-process implementation: non-blank key, `ttl` greater than zero, non-negative `wait` (`RedisDistributedLock.cs:51-53`).
  - **Key and token.** The physical key is `_keys.Qualify(string.Concat(KeyPrefix, key))` (`RedisDistributedLock.cs:55`). The token is a fresh `Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)` minted **per acquisition** (`RedisDistributedLock.cs:59`); the release script matches on it, and that is what makes a release owner-scoped instead of "delete whatever is there now" (`RedisDistributedLock.cs:57-58`).
  - **The acquire loop** (`RedisDistributedLock.cs:64-81`). `StringSetAsync(redisKey, token, ttl, keepTtl: false, When.NotExists, CommandFlags.None)` (`RedisDistributedLock.cs:66-68`) is a single atomic conditional set carrying the expiry, so exactly one replica can win a key. On success it returns a [`RedisLockHandle`](#redislockhandle) closing over the database, key, token, and logger (`RedisDistributedLock.cs:70-73`); once `Stopwatch.GetElapsedTime(startedAt) >= wait` it returns `null` (`RedisDistributedLock.cs:75-78`); otherwise it delays one `PollInterval` and retries (`RedisDistributedLock.cs:80`).

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) replaced the process-local guard around the idempotency filter's execute-then-store window with this, because a striped semaphore stops serializing anything once a service runs more than one replica. Choosing the one-instance `SET NX PX` lock over Redlock is a stated trade: simpler, dependent on a single Redis, and paired with a contract that tells callers never to lean on it for an invariant persistence can enforce.

- **Where it's used**: selected by `AddCaching` whenever an `IConnectionMultiplexer` is resolvable (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:109-123`, see [`DependencyInjection`](#dependencyinjection-1)), passing the same [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) the distributed cache gets (`DependencyInjection.Caching.cs:83`, `:91`). The one in-framework caller is the API [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter); `RedisDistributedLockTests` covers the acquire and release commands against a mocked `IDatabase`.

- **Caveats / not-in-source**: whether a given deployed environment actually supplies the `redis` connection string is an infrastructure/config fact, not a source fact, so "which implementation is live in environment X" is Not determinable from source here; the source only settles that the presence of a registered `IConnectionMultiplexer` decides it.

---

### ApplicationNamespace
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:35` · Level 0 · class (static, partial)

- **What it is**: the single shared value every piece of shared infrastructure is namespaced by:
  Redis cache keys, distributed-lock keys, distributed rate-limit counter keys, the Redis
  output-cache `InstanceName`, the SignalR Redis backplane channel prefix, and the message broker's
  topic prefix (`ApplicationNamespace.cs:7-12`). Never empty, so isolation is automatic rather than
  a setting a host has to remember to set (`:52-56`). A broker host is the one exception to "never
  has to set it": there the value must be configured explicitly (`:28-33`).

- **Depends on**: `IConfiguration` and `IHostEnvironment` (both optional parameters), and its own
  `[GeneratedRegex]` source-generated partial property (`:49-50`). BCL only.

- **Concept**: resolution with a fallback chain rather than a required setting. `[Rubric §11,
  Security]` and `[Rubric §7, Microservices Readiness]`: two applications sharing one broker or one
  Redis instance used to share every keyspace by default, so a user-targeted push published in one
  application reached the other application's clients holding the same numeric user id
  (SEC-Common-53, `ApplicationNamespace.cs:14-21`). This type gives every consumer one namespace
  they can all agree on without each of them inventing its own default. The broker is where the
  fallback stops being safe: the host's application name differs per service, and every service
  of one application must publish and consume on the SAME topics, so a broker host has to state
  the value rather than inherit it (`:28-33`).

- **Walkthrough**: two public constants, one private constant, one generated regex, and two static
  methods.
  - `ConfigurationKey = "Application:Namespace"` (`:38`): the explicit override.
  - `Fallback = "app"` (`:41`): used only when neither configuration nor the host environment names
    the application.
  - `HostApplicationNameKey = "applicationName"` (`:47`): the key the generic host writes the
    application name to (`HostDefaults.ApplicationKey`, `:43-46`), read directly when no
    `IHostEnvironment` is at hand.
  - `Resolve(configuration, environment)` (`:60-75`): prefers the explicit `ConfigurationKey`
    (sanitized); otherwise falls back to `environment.ApplicationName`, then to the raw
    `applicationName` configuration key; otherwise returns `Fallback`. Never returns empty.
  - `Sanitize(name)` (`:84-90`): replaces every run of characters the `UnsafeCharacters` regex flags
    (`[^a-zA-Z0-9_-]+`, `:49`) with `-`, trims leading/trailing `-`, and returns `Fallback` when
    nothing survives, because a Redis key tolerates almost anything while a broker queue or topic
    name and a SignalR channel prefix do not, and the whole point is one value every one of its
    consumers accepts (`:77-81`).

- **Why it's built this way**: a value that is never empty means every consumer (cache key prefix,
  push channel prefix, rate-limit key) gets isolation whether or not a host ever sets
  `Application:Namespace`, without asking every consumer to invent its own default. Override it
  only when two hosts of the SAME application must share a keyspace, such as a web head and a
  worker draining one backplane (`ApplicationNamespace.cs:22-27`).

- **Where it's used**: read by [CacheKeyPrefixOptions](group-09-caching.md#cachekeyprefixoptions)'s
  `CacheKeyNamespace.From(IServiceProvider)` for the per-application default Redis key namespace
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:95`, with
  `Sanitize` at `:129`), by the notifications registration for the SignalR channel prefix
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:59`),
  and by the distributed rate limiter's key namespace
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:237`).
  On the broker path `AddBrokerMessaging` first calls `EnsureApplicationNamespaceConfigured`, which
  throws when `ConfigurationKey` is blank for a broker provider and names the setting to add
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:89`,
  `:270-278`), then resolves the value and hands it to the
  [BrokerConsumerBuilder](#brokerconsumerbuilder) and the [BrokerTopology](#brokertopology) that
  prefix every topic (`DependencyInjection.Messaging.cs:90-97`). The keyspace isolation decision is
  [ADR-135](https://ivanball.github.io/docs/adr/135-application-namespace-keyspace-isolation.html).
  Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Configuration/ApplicationNamespaceTests.cs`
  and `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionBrokerMessagingTests.cs`.

---

### CloudAdapterTripwireOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwireOptions.cs:8` · Level 0 · class (internal sealed, empty)

- **What it is**: an options type with no members. Its only job is to carry
  [CloudAdapterTripwire](#cloudadaptertripwire) through `ValidateOnStart`, so that check runs with
  the other startup validators, before any hosted service starts
  (`CloudAdapterTripwireOptions.cs:3-8`).

- **Depends on**: nothing. It is declared as `internal sealed class CloudAdapterTripwireOptions;`
  (`CloudAdapterTripwireOptions.cs:8`), a body-less class declaration.

- **Concept**: a marker options type used as a hook into the options validation pipeline.
  `ValidateOnStart` only runs `IValidateOptions<T>` validators for an options type somebody
  registered, so a check that validates the composed container rather than a configuration section
  still needs a `T` to hang on. An empty class is the cheapest such `T`. `[Rubric §15, Best
  Practices & Code Quality]` scores moving failures to the earliest point: this is what places the
  cloud-adapter check at boot rather than at the first dropped push.

- **Walkthrough**: there is nothing to walk; the type has no members. The behavior lives in the
  two registration lines that use it:
  `services.AddOptions<Configuration.CloudAdapterTripwireOptions>().ValidateOnStart();` and a
  `TryAddEnumerable` of `IValidateOptions<CloudAdapterTripwireOptions>` mapped to
  [CloudAdapterTripwire](#cloudadaptertripwire)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:244-246`).

- **Why it's built this way**: binding the tripwire to its own options type, rather than to an
  existing settings class, keeps the check independent of whether any particular section is
  present, and `TryAddEnumerable` keeps it to one validator even when several modules call
  `AddInfrastructure`. The fail-fast posture is
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html).

- **Where it's used**: `AddInfrastructure` (`DependencyInjection.cs:244-246`) and the validator's
  generic argument (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:32`).
  Exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Configuration/CloudAdapterTripwireTests.cs`.

---

### SmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Mail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the `Smtp` section: host, port, credentials, TLS toggle, and the default sender and recipient addresses. Validated by data annotations at startup (`SmtpSettings.cs:5-8`).

- **Depends on**: `System.ComponentModel.DataAnnotations` for `[Range]` (`SmtpSettings.cs:1`). Consumed by [SmtpEmailSender](group-10-notifications.md#smtpemailsender), the [IEmailSender](group-10-notifications.md#iemailsender) implementation.

- **Concept**: the validate-on-start gate taught under [ConnectionStringSettings](group-07-persistence-ef-core.md#connectionstringsettings), here guarding a numeric range rather than a cross-section rule. `[Rubric §15, Best Practices & Code Quality]` assesses whether avoidable failures are moved earlier: `[Range(1, 65535)]` on `Port` (`SmtpSettings.cs:21`) means a configuration typo such as `0` or `70000` fails the host at boot with a named error instead of surfacing as a socket exception the first time the application sends mail. Note also the named constant instead of a magic number: `DefaultSmtpPort = 25` is a `public static readonly` field (`:15`) used as the property's own default (`:22`), so the value is discoverable and testable rather than inlined. `[Rubric §11, Security]`: `Password` is a plain `string` (`:28`), so it is only ever as safe as the configuration provider that supplies it (user-secrets or Key Vault, never a committed `appsettings.json`).

- **Walkthrough**: two static fields then eight `{ get; init; }` members.
  - `SectionName = "Smtp"` (`SmtpSettings.cs:12`) and `DefaultSmtpPort = 25` (`:15`).
  - `Host` (`:18`), `Port` (`:22`), `Username` (`:25`), `Password` (`:28`), `EnableSsl` (`:31`, defaulting to `false`), `From` (`:34`), `To` (`:37`), `TimeoutSeconds` (`:53`, `[Range(1, 600)]`, default `30`). Every string defaults to `string.Empty`, so an absent section binds cleanly; only `Port` and `TimeoutSeconds` are range-checked. `To` is documented as the default recipient used by the no-argument `SendAsync` overload (`:36-37`).
  - `EnableSsl` no longer defaults to "off" when the key is unset: [SmtpTransportSecurity](#smtptransportsecurity) resolves the effective value, turning TLS on outside Development (SEC-Common-54); the property itself still carries a plain `false` default because it only records what the host configured, not the resolved posture (`:16-24`).
  - `TimeoutSeconds` exists because the .NET default of 100 seconds outlives most callers' own budget: a relay that accepts the TCP connection and then stops answering parks the request thread for the full 100s, and a notification burst parks one per message; 30 seconds keeps a stalled relay inside the caller's timeout instead of outliving it (`:41-49`).
  - The consumer is deliberately plain: [SmtpEmailSender](group-10-notifications.md#smtpemailsender) takes `IOptions<SmtpSettings>` in its primary constructor and snapshots `.Value` into a readonly field (`SmtpEmailSender.cs:12-14`), then builds a fresh `SmtpClient` per send from `Host`/`Port` plus a `NetworkCredential` and the resolved TLS decision (`:25-29`), and a `MailMessage` from `From` (`:32-35`).

- **Why it's built this way**: annotations plus `ValidateOnStart` cost one line at registration and move an entire class of misconfiguration from run time to boot, the contract [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes. Resolving TLS through [SmtpTransportSecurity](#smtptransportsecurity) instead of a hard-coded default keeps the failure mode fail-closed outside Development ([ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html)).

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure` (`DependencyInjection.cs:80-83`); read by [SmtpEmailSender](group-10-notifications.md#smtpemailsender).

---

### PeriodicBackgroundService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Hosting.Background` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hosting/Background/PeriodicBackgroundService.cs:20` · Level 0 · class (public abstract partial)

- **What it is**: the base class for fixed-interval background sweeps. It contributes four things a hand-written `BackgroundService` loop usually gets wrong: an enablement gate evaluated once at startup, a startup delay so the host finishes initializing first, a loop whose cycle failures are logged (through an overridable hook) without killing the loop, and every wait routed through an injected `TimeProvider` so a test can drive it with a fake clock (`PeriodicBackgroundService.cs:6-11`).

- **Depends on**: `Microsoft.Extensions.Hosting.BackgroundService` as the base, `TimeProvider` and `ILogger` as its two primary-constructor parameters (`PeriodicBackgroundService.cs:20-22`), and the `LoggerMessage` source generator for its two log methods (`:99-103`), which is what makes the class `partial`.

- **Concept introduced, the template method with an injected clock.** `[Rubric §2, Design Patterns]` assesses whether a pattern is used where it carries its weight, and this is a textbook template method: the base owns the invariant algorithm (gate, delay, loop, catch, wait) and the subclass supplies only the variable parts through `Interval`, `IsEnabled`, `StartupDelay`, `LogCycleFailure`, and `ExecuteCycleAsync`. `[Rubric §29, Resilience and Business Continuity]` assesses whether a background component survives its own failures: the broad `catch` at `:82-86`, under a `CA1031` suppression whose justification reads "One failed cycle must not stop the background service for the life of the process" (`:81`), is the whole answer, because an unhandled exception inside `ExecuteAsync` silently ends a hosted service for the lifetime of the process, and a reconciliation sweep that stops running is a failure nobody notices until the data is wrong. `[Rubric §13, Observability & Operability]` assesses whether an override can keep its own event id: `LogCycleFailure` is virtual (`:45-46`) precisely so a subclass can log its own message and event id (for a dashboard that keys on it) while still relying on the base loop to call it. `[Rubric §14, Testability]` assesses whether time-dependent code can be tested without waiting: `Task.Delay(..., timeProvider, ...)` (`:63`, `:90`) means a `FakeTimeProvider` advances the loop instantly, which is what `PeriodicBackgroundServiceTests` and its `FakeClockLoop` helper rely on (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/PeriodicBackgroundServiceTests.cs`, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/FakeClockLoop.cs`).

- **Walkthrough**
  - `Interval` is abstract (`PeriodicBackgroundService.cs:25`): every subclass must state its own cadence, and nothing defaults it.
  - `StartupDelay` is virtual with a 15 second default (`PeriodicBackgroundService.cs:31`). The doc says why it exists: let the application finish initializing before background work competes with it, and tests override it to shorten the wait (`:27-30`).
  - `IsEnabled` is virtual and defaults to `true` (`PeriodicBackgroundService.cs:38`). It is read **once**, at the top of `ExecuteAsync`, and a `false` logs and returns (`:55-59`), so the service occupies no thread and no timer for the rest of the process. Flipping the toggle at runtime does not restart it.
  - `LogCycleFailure(exception)` is virtual (`PeriodicBackgroundService.cs:45-46`): the default writes one generic Error naming the service through the generated `LogCycleError`. The doc comment spells out why it is overridable: a subclass can keep its own message and its own event id, which dashboards and tests key on (`:40-43`).
  - `ExecuteCycleAsync(stoppingToken)` is the abstract single sweep (`PeriodicBackgroundService.cs:50`), and its contract is stated in the doc comment: exceptions are logged and do not stop the loop.
  - `ExecuteAsync` (`PeriodicBackgroundService.cs:53-97`) is the algorithm. The startup delay is wrapped in its own `try` whose `catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)` returns cleanly (`:61-68`), so a host stopped during the delay does not log a shutdown as an error. The loop then runs until cancellation (`:70`), awaiting the cycle, breaking on a shutdown cancellation (`:76-80`), routing any other exception through `LogCycleFailure` (`:81-86`), and waiting the interval under the same cancellation-aware guard (`:88-95`).
  - The two `[LoggerMessage]` methods (`PeriodicBackgroundService.cs:99-103`) are source-generated: `LogDisabled` at Information, `LogCycleError` at Error with the exception attached and a message that states the recovery ("it will retry on the next interval"). Both stamp `GetType().Name`, so the log line names the concrete sweep, not the base class; `LogCycleError` is called through `LogCycleFailure` rather than directly from the loop.

- **Why it's built this way**: the class doc draws the boundary explicitly (`PeriodicBackgroundService.cs:12-16`): this is for periodic reconciliation and cleanup work, and it is deliberately **not** what the outbox processor uses, because the outbox's signal-driven smart wait does not fit a fixed interval. The background-work posture is [ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html), and a fixed-interval sweep is a different thing again from the cron-style recurring scheduler of [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html), which is why this base stays as small as it is.

- **Where it's used**: four framework sweeps derive from it: [PermissionGrantRefreshService](group-07-persistence-ef-core.md#permissiongrantrefreshservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/PermissionGrantRefreshService.cs:36`), [RefreshSessionCleanupService](group-07-persistence-ef-core.md#refreshsessioncleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:53`), [InternalCommandCleanupService](group-07-persistence-ef-core.md#internalcommandcleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandCleanupService.cs:46`) and [OutboxCleanupService](group-04-events-outbox.md#outboxcleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:50`). [ScheduledJobRunner](#scheduledjobrunner) is the closest relative and deliberately is **not** a subclass: it derives `BackgroundService` directly and only names this class in a comment (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs`).

- **Caveats / not-in-source**: nothing in this base coordinates two replicas running the same sweep, so any subclass owns that question itself. Contrast [ScheduledJobRunner](#scheduledjobrunner), which answers it with a database claim lease rather than by inheriting one.

---

### MessageBusSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the `MessageBus` section. It selects the transport, says how to reach the broker,
  which queue this host receives on and whether the transport may create its own broker entities,
  how hard to retry a failing consumer, how much work to take on at once, and whether the two
  store-and-forward guards (the transactional outbox and the consumer-side idempotency inbox) are
  on (`MessageBusSettings.cs:6-12`). Despite the name it is the single switch for the whole event
  delivery posture, not just for the wire protocol.

- **Depends on**: [MessageBusProviders](#messagebusproviders), the string constants and
  case-insensitive predicates for the built-in transport names (`MessageBusSettings.cs:2`), and, in
  its XML doc only, [IBrokerTransport](#ibrokertransport) (whose `MaxRedeliveryDelay` it names,
  `:182-189`). Externals: `System.ComponentModel.DataAnnotations` for the `[StringLength]` and
  `[Range]` guards (`:1`).

- **Concept introduced: a tri-state flag that resolves from the transport.** Two of the properties
  here are `bool?`, not `bool`, and each has a computed companion. `EnableInbox` (`:134`) is the raw
  configured value and `IsInboxEnabled` (`:142`) is what every framework component actually reads:
  `EnableInbox ?? !MessageBusProviders.IsInProcess(Provider)`. `EnableOutbox` (`:172`) and
  `IsOutboxEnabled` (`:180`) work identically. The point of the third state is that "the host said
  nothing" and "the host said false" are different facts. Unset means "let the transport decide",
  which turns both features ON for a broker and OFF in-process, and an explicit value wins (with
  the one refusal described under `EnableOutbox`). That is why a settings class that could have
  been a bag of booleans carries derived properties: the resolution rule lives once, next to the
  data, instead of being repeated at every read site.

  `[Rubric §6, CQRS and Event-Driven]` assesses how reliably a state change turns into a delivered
  event. Both resolved flags default ON for a broker deliberately, and the XML doc argues the case
  rather than just stating it: broker delivery is at-least-once by contract, so an ack after a
  network blip, a redelivery after a lease expiry, or an outbox row republished after a crash all
  hand the same event to the same handlers twice, and with the inbox off every one of those becomes
  a duplicate side effect (`:116-125`, [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).
  Symmetrically, a single-process host dispatches every event inside the process that raised it, so
  the store-and-forward hop buys it two background services, a table and a poll loop for nothing
  (`:151-156`, [ADR-100](https://ivanball.github.io/docs/adr/100-outbox-opt-in-resolved-from-messaging-mode.html)).

  `[Rubric §29, Resilience and Business Continuity]` assesses whether transient failures are absorbed
  before they become lost messages. This class configures two independent retry tiers, both run by
  the framework's own receive pipeline rather than by a broker library, so every transport behaves
  the same. `RetryLimit` / `RetryMinIntervalSeconds` / `RetryMaxIntervalSeconds` drive the
  in-process tier: [BrokerReceivePipeline](#brokerreceivepipeline) runs the consumer up to
  `RetryLimit + 1` times, each attempt in a fresh DI scope
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:179-190`),
  waiting the exponential delay [BrokerTransportPolicies](#brokertransportpolicies)`.RetryDelay`
  computes from the floor and the cap
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:27-33`).
  `RedeliveryIntervalsSeconds` drives the second tier: once the in-process attempts are spent, the
  pipeline schedules the next redelivery on the host's queue while one is left, and dead-letters
  only after the last (`BrokerReceivePipeline.cs:157-177`).

  `[Rubric §7, Microservices Readiness]` assesses whether several services can share infrastructure
  without colliding. Each host receives on ONE queue of its own, derived from its application name,
  and every event it consumes is bound to that queue, so two services consuming the same event each
  get their own copy instead of competing for one (`:56-62`). Topic names are separately prefixed
  with [ApplicationNamespace](#applicationnamespace), which a broker host must set.

- **Walkthrough**: two static members, thirteen `init` properties, and two computed properties.
  - `SectionName = "MessageBus"` (`MessageBusSettings.cs:16`), the bind key.
  - `Provider` (`:25`): a `string`, not an enum, compared case-insensitively, defaulting to
    `MessageBusProviders.InProcess`, so the modular monolith is the zero-configuration case.
    `InProcess`, `RabbitMq` and `PostgreSql` are built in; any other value names an
    [IBrokerTransport](#ibrokertransport) an adapter package registers before
    `AddBrokerMessaging` (for example `AzureServiceBus` from `MMCA.Common.Azure` through
    `AddAzureServiceBusTransport()`) (`:18-24`). When nothing is registered under the name,
    `AddBrokerMessaging` fails naming `AddBrokerTransport(...)` as the fix
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:228`).
    The transport-selection decision is
    [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html), and the
    move of vendor brokers into adapter packages is
    [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html).
  - `ConnectionString` (`:33`): nullable, and only the first of three sources.
    `ResolveBrokerConnectionString` prefers it, then falls back to `ConnectionStrings:rabbitmq` and
    `ConnectionStrings:messaging`, which is what Aspire injects via `WithReference(broker)`
    (`DependencyInjection.Messaging.cs:287-293`).
  - `EmulatorAdminEndpoint` (`:54`) with `[StringLength(2048)]` (`:53`): the base address of the
    Azure Service Bus emulator's HTTP management plane. The emulator serves the data plane (AMQP)
    and the management plane (HTTP) on two different ports, so the administration client that
    provisions topics, subscriptions and queues cannot be derived from `ConnectionString` alone
    (`:41-45`). It is read only when the connection string carries `UseDevelopmentEmulator=true`,
    and then a missing or malformed value fails at registration (`:47-51`). The reader is the Azure
    adapter, not this assembly: [AzureServiceBusTransport](group-28-common-cloud-provider-adapters.md#azureservicebustransport)
    hands it to
    [ServiceBusEmulatorSupport](group-28-common-cloud-provider-adapters.md#servicebusemulatorsupport).
  - `QueueName` (`:71`) with `[StringLength(50)]` (`:70`): the ONE queue this host receives on, or
    `null` (the default) to derive it from the host application name in lower kebab case with a
    trailing `-service` removed, so `MMCA.ADC.Engagement.Service` receives on
    `mmca-adc-engagement` (`:56-62`). `AddBrokerMessaging` hands it with the host's
    `applicationName` to [BrokerNaming](#brokernaming)`.Queue`
    (`DependencyInjection.Messaging.cs:96`). Set it explicitly only to pin a name that must survive
    a host rename; replicas share the queue as competing consumers anyway, because they run under
    the same application name (`:63-68`).
  - `ProvisionTopology` (`:84`), default `true`: whether the transport creates the topic per event,
    this host's queue and the topic-to-queue bindings, idempotently, when the receiver starts and
    on the first publish to a missing topic (`:73-77`). Set it `false` where the entities are
    provisioned out of band (infrastructure as code, or an identity that may send and receive but
    not manage), and the transport then assumes every entity exists (`:78-82`).
  - `RetryLimit` (`:94`) with `[Range(0, 20)]` (`:93`), default `5`: a message is attempted up to
    `RetryLimit + 1` times per delivery, and `0` disables in-process retries (`:86-92`).
  - `RetryMinIntervalSeconds` (`:101`) with `[Range(0, 300)]`, default `1`, and
    `RetryMaxIntervalSeconds` (`:107`) with `[Range(0, 3600)]`, default `30`: the floor and the cap
    of the doubling backoff.
  - `EnableInbox` (`:134`) and `IsInboxEnabled` (`:142`). `AddBrokerMessaging` registers
    [EfInboxStore](group-04-events-outbox.md#efinboxstore) when the resolved value is true and
    [NoOpInboxStore](group-04-events-outbox.md#noopinboxstore) plus a startup
    [InboxDisabledWarningService](group-04-events-outbox.md#inboxdisabledwarningservice) when it is
    false, so an opt-out is recorded in the log rather than passing silently
    (`DependencyInjection.Messaging.cs:134`, `:142`, `:147`). The `InboxMessages` table is part of
    the shared relational model created by the standard migrations (Cosmos hosts skip it), so
    turning it on for a migrated relational host needs no schema work (`:112-115`).
  - `EnableOutbox` (`:172`) and `IsOutboxEnabled` (`:180`). `AddInfrastructure` reads the resolved
    value to decide whether to run [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) and
    [OutboxCleanupService](group-04-events-outbox.md#outboxcleanupservice) or the single
    [OutboxDisabledNoticeService](group-04-events-outbox.md#outboxdisablednoticeservice)
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:260-267`). Turning
    it off under a broker is not honored: `EnsureOutboxAvailableForProvider` throws at
    registration, because a broker with no outbox has no delivery channel at all
    (`DependencyInjection.Messaging.cs:248-250`, argued at `MessageBusSettings.cs:159-164`), and
    `AddBrokerMessaging` runs that check itself (`DependencyInjection.Messaging.cs:80`) so a service
    host that wires only the broker still fails loudly. The `OutboxMessages` table stays part of the
    EF model either way, so flipping the flag is never a migration. With the outbox off, a handler
    failure is logged at Error and nothing retries it; each event dispatches on its own, so one
    failing handler does not stop the later events of the save (`MessageBusSettings.cs:166-169`).
  - `DefaultRedeliveryIntervalsSeconds` (`:190`), a static `[60, 600, 3600]`: one minute, ten
    minutes and one hour, a spread wide enough to ride out a dependency restart, a failover and a
    short incident without an operator replaying the dead-letter queue by hand (`:182-189`).
  - `RedeliveryIntervalsSeconds` (`:213`): nullable with no initializer, and that is on purpose:
    the configuration binder appends a configured list to an existing collection instead of
    replacing it, so a non-null default would make the defaults impossible to shorten by
    configuration (`:202-206`). A configured list REPLACES the default and is never merged with it;
    non-positive entries are dropped, so `[0]` turns second-level redelivery off (an empty array
    cannot be expressed in configuration); an interval longer than the transport's
    `MaxRedeliveryDelay` is shortened to it, which matters on Amazon SQS with its 15 minute cap
    (`:192-201`). `BuildRedeliveryIntervals` applies all three rules
    (`BrokerTransportPolicies.cs:65-71`), and `AddBrokerMessaging` passes the transport's
    `MaxRedeliveryDelay` into the pipeline that calls it (`DependencyInjection.Messaging.cs:108-115`).
    Every transport honors the result: RabbitMQ through per-interval delay queues (no broker
    plugin), PostgreSQL through the row's visibility time, Azure Service Bus and Amazon SQS through
    their native scheduling (`MessageBusSettings.cs:207-211`).
  - `PrefetchCount` (`:223`) and `ConcurrentMessageLimit` (`:232`): both nullable `int`, both
    unset by default, and both range-guarded in code rather than by `[Range]`, because the binder
    never validates this section (`:215-222`, `:225-231`). `ResolvePrefetchCount` and
    `ResolveConcurrentMessageLimit` return the value only when it is greater than zero, leaving the
    transport's own default in place otherwise (`BrokerTransportPolicies.cs:85-89`, `:98-102`).
    `PrefetchCount` caps how many messages the transport holds locally ahead of the consumer; a
    window larger than the work a consumer can finish inside its lock or lease is what turns a
    slow consumer into redeliveries, while a window of one serializes the queue (`:216-219`).
    `ConcurrentMessageLimit` caps how many messages are consumed at once from the host's queue,
    the backpressure knob for how many database connections and downstream calls a burst of events
    can open (`:226-229`).

- **Why it's built this way**: resolving both guards from the transport rather than shipping fixed
  defaults is what lets one settings class serve the monolith and the extracted-service topology at
  the same time ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)),
  while keeping the at-least-once contract intact where it matters
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html),
  [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)). Refusing an
  outbox-less broker at registration rather than honoring it follows the fail-fast configuration
  contract ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)):
  the misconfiguration becomes a startup exception instead of silently dropped events. Keeping the
  retry, redelivery and backpressure knobs here, applied once by the framework pipeline, is what
  lets a new transport inherit the whole failure policy instead of re-implementing it.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:215`),
  then read eagerly in the same method to gate the outbox hosted services (`:260-267`).
  `AddBrokerMessaging` reads it again, falling back to `new MessageBusSettings()` when the section
  is absent (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:70`),
  short-circuits on the in-process provider (`:72`), and otherwise builds the
  [BrokerTopology](#brokertopology) (`:94-97`), registers the receive pipeline with these settings
  (`:109-115`), and replaces [IMessageBus](group-04-events-outbox.md#imessagebus) with
  [BrokerMessageBus](group-04-events-outbox.md#brokermessagebus) (`:119`) and
  [IEventBus](group-04-events-outbox.md#ieventbus) with
  [BrokerEventBus](group-04-events-outbox.md#brokereventbus) (`:125`), so
  [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) becomes the only delivery channel.
  [InProcessEventBus](group-04-events-outbox.md#inprocesseventbus) reads the resolved outbox flag,
  and [OutboxCleanupService](group-04-events-outbox.md#outboxcleanupservice) reads
  `IsInboxEnabled` to decide whether to purge inbox rows. The vendor receivers
  ([AzureServiceBusTransport](group-28-common-cloud-provider-adapters.md#azureservicebustransport),
  [AmazonSqsTransport](group-28-common-cloud-provider-adapters.md#amazonsqstransport)) read the same
  instance (for example `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsReceiver.cs`). [StartupConfigurationSummaryService](#startupconfigurationsummaryservice)
  logs the resolved `Provider` and `ProvisionTopology` at start. Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/MessageBusSettingsTests.cs` and
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/BrokerTransportPoliciesTests.cs`.

- **Caveats**: no broker library sits underneath any of these settings: MassTransit is banned from
  the framework ([ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html),
  enforced by `MassTransit_MustNotBeReferenced` in
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:13`
  and the banned-assembly list in
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:16`)
  and the transports are framework code, so every knob here is honored by
  MMCA.Common's own receive pipeline and transports rather than translated into a library's API.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### SmtpTransportSecurity
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Mail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpTransportSecurity.cs:26` · Level 1 · class (static, partial)

- **What it is**: the resolver behind [SmtpSettings](#smtpsettings)`.EnableSsl`. It answers whether
  an SMTP session must negotiate TLS, treating an unset `Smtp:EnableSsl` key as "secure unless the
  host is Development" rather than as "off" (SEC-Common-54).

- **Depends on**: `IConfiguration`, `IHostEnvironment`, `ILogger`, and [SmtpSettings](#smtpsettings)
  (the second overload's parameter). `[LoggerMessage]` source generation for the warning.

- **Concept**: fail-closed configuration for a security-relevant default. `[Rubric §11, Security]`
  and `[Rubric §22, Compliance & Governance]`: leaving `Smtp:EnableSsl` unset used to mean cleartext,
  because `SmtpSettings.EnableSsl` is a plain `bool` defaulting to `false`. This type reads the raw
  configuration key rather than the bound settings object, because the settings object cannot
  distinguish "configured false" from "never configured" once binding has happened
  (`SmtpTransportSecurity.cs:39-40`); only the presence of the key in configuration can. Development
  is the one carved-out exception, consistent with the workspace's dev-only-relaxations-fail-closed
  policy ([ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html)).

- **Walkthrough**: two overloads of `Resolve` and one generated log method.
  - `Resolve(configuration, environment)` (`:37-49`): reads `Smtp:EnableSsl` (`EnableSslConfigKey =
    "Smtp:EnableSsl"`, `:29`); if it parses as a bool, that value wins; otherwise returns
    `environment?.IsDevelopment() != true`, so a null environment is also treated as non-Development
    (secure by default).
  - `Resolve(settings, configuration, environment, logger)` (`:65-84`): calls the first overload,
    and when the resolved value is `false`, the host is not Development, `settings.Host` is set, and
    a logger was supplied, emits one `LogCleartextSmtp` warning naming the config key and the SMTP
    host before returning the same resolved value.
  - `LogCleartextSmtp` (`:686-690`): `[LoggerMessage(EventId = 5401, Level = Warning)]`, message text
    states plainly that credentials and message bodies, "password-reset tokens included," travel in
    cleartext to the named host.

- **Why it's built this way**: a security-relevant default that only reveals itself the first time
  someone inspects network traffic is exactly the failure mode ADR-122 exists to close off; resolving
  from the raw configuration key rather than the bound `bool` is what lets "unset" and "explicitly
  false" resolve differently at all.

- **Where it's used**: [SmtpSettings](#smtpsettings)`.EnableSsl`'s XML doc references it as the
  resolver of record (`SmtpSettings.cs:29`); called from
  [SmtpEmailSender](group-10-notifications.md#smtpemailsender) to decide the `SmtpClient`'s TLS
  posture, and from `SensitiveDataLoggingGate` for the analogous decision on a different setting.
  Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Mail/SmtpTransportSecurityTests.cs`.

---

### CloudAdapterTripwire

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:32` · Level 4 · class (internal sealed)

- **What it is**: a startup validator that fails the host when configuration switches on a
  capability whose implementation lives in a package or registration call that never ran, so the
  inert core default is still in place (`CloudAdapterTripwire.cs:12-14`). It checks three switches:
  passkeys, machine clients and native push.

- **Depends on**: `IValidateOptions<CloudAdapterTripwireOptions>` (`CloudAdapterTripwire.cs:32`),
  with [CloudAdapterTripwireOptions](#cloudadaptertripwireoptions) as the empty carrier type; the
  root `IServiceProvider` as its single primary-constructor parameter; `IConfiguration` (resolved
  from that provider); [IPasskeyCeremony](group-08-auth.md#ipasskeyceremony),
  [IMachineClientService](group-08-auth.md#imachineclientservice),
  [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) and its core no-op
  [NullNativePushSender](#nullnativepushsender) (`:4-8`).

- **Concept introduced: a tripwire on a quiet default.** The core packages are cloud-neutral, so
  native push resolves to `NullNativePushSender` until an adapter swaps it, and that default is
  deliberately quiet: a push is dropped (`CloudAdapterTripwire.cs:16-18`). Quiet is right for a host
  that never switched push on and wrong for one that did, because a deployment that sets
  `NativePush:Enabled` but lost the adapter call would start, pass its health checks and silently
  stop delivering pushes (`:18-21`). The opt-in passkeys and machine-client features fail the same
  quiet way: an enabled section without its registration call leaves every one of their routes
  answering 404 (`:37-41`, `:44-48`). `[Rubric §13, Observability & Operability]` and `[Rubric §15,
  Best Practices & Code Quality]`: the tripwire turns each silent loss into a boot failure whose
  message names the missing call. The cloud-neutral core is
  [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html),
  native push is [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html),
  passkeys are ADR-139 and machine clients are ADR-140.

- **Walkthrough**:
  - Three internal key constants, so the tests can name them: `NativePushEnabledKey =
    "NativePush:Enabled"` (`CloudAdapterTripwire.cs:35`), `PasskeysEnabledKey = "Passkeys:Enabled"`
    (`:42`) and `MachineClientsEnabledKey = "MachineClients:Enabled"` (`:49`).
  - `Validate(name, options)` (`:52-86`) resolves `IConfiguration` and returns
    `ValidateOptionsResult.Skip` when there is none (`:54-58`), then collects failures inside a
    created scope (`:62`), so it sees each service the way a request would.
  - Passkeys (`:64-69`): fails when the switch is on and no `IPasskeyCeremony` resolves, naming
    `services.AddPasskeys(configuration)` from `MMCA.Common.Passkeys` with
    `Passkeys:RelyingPartyId` and `Passkeys:Origins`.
  - Machine clients (`:71-75`): fails when the switch is on and `IMachineClientService` is not
    registered, naming `services.AddMachineClients(configuration)` and the app's
    `IServiceAccountProvisioner`. A missing provisioner is left to the settings validator that call
    registers (`:47-48`).
  - Native push (`:77-82`): fails when the switch is on and the resolved `INativePushSender` is
    absent or still `NullNativePushSender`. The message lists the three adapter paths with their
    registration calls and required keys: `AddAzureNotificationHubsPush` from `MMCA.Common.Azure`,
    `AddAmazonSnsPush` from `MMCA.Common.Aws`, and `AddFirebaseCloudMessagingPush` from
    `MMCA.Common.Gcp`.
  - It returns `Success` when no failure was collected, otherwise `Fail(failures)` (`:85`), so one
    boot reports every missing call at once.
  - Two private helpers: `IsSwitchedOn` (`:92-93`) is true only when the key parses as `true`, and
    `IsRegistered<TService>` (`:99-100`) asks `IServiceProviderIsService` without constructing the
    service (treating an unanswerable provider as registered).

- **Why it's built this way**: a tripwire must fire on a key that declares intent, so file storage
  deliberately has no check. A `FileStorage` section is routinely shared configuration (one
  user-secrets id across every service of a solution), so a host that never stores files sees it
  too, and a host that does store files and lost its adapter call is not silent anyway:
  [NullFileStorageService](#nullfilestorageservice) fails every upload with
  `FileStorage.NotConfigured` (`CloudAdapterTripwire.cs:23-29`). Running as an options validator
  under `ValidateOnStart` places the check with the other startup validators, before any hosted
  service starts, the fail-fast contract of
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html).

- **Where it's used**: registered once in `AddInfrastructure` through `TryAddEnumerable`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:246`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Configuration/CloudAdapterTripwireTests.cs`,
  and the machine-client branch also by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/MachineClients/AddMachineClientsTests.cs`.

---

### StartupConfigurationSummaryService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/StartupConfigurationSummaryService.cs:35` · Level 11 · class (internal sealed partial, `IHostedService`)

- **What it is**: a hosted service that writes one Information line at host start naming the posture the host actually resolved: the MMCA.Common version, the database engines it configures, the message bus transport with its `ProvisionTopology` value, the cache mode and the tenancy mode. A support question ("which version, which bus, which cache?") is then answered by the first lines of the log rather than by reading the deployed configuration (`StartupConfigurationSummaryService.cs:14-19`).

- **Depends on**: six primary-constructor parameters (`StartupConfigurationSummaryService.cs:35-41`): `IOptions<ConnectionStringSettings>` ([ConnectionStringSettings](group-07-persistence-ef-core.md#connectionstringsettings)), [DataSourcesSettings](group-07-persistence-ef-core.md#datasourcessettings), `IOptions<MessageBusSettings>` ([MessageBusSettings](#messagebussettings)), `IOptions<TenancySettings>` ([TenancySettings](group-07-persistence-ef-core.md#tenancysettings)), the root `IServiceProvider`, and `ILogger<T>`. It calls [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver)`.ResolveConfiguredEngines`, and checks for `HybridCache`, `IDistributedCache` and `MemoryDistributedCache` from the Microsoft caching packages (`:2-3`).

- **Concept introduced: log the resolved posture, never the configuration text.** `[Rubric §13, Observability & Operability]` scores whether a running system can be understood from outside. Several of the settings it reports resolve from more than one source (a transport name that may be an adapter's, a cache tier picked by registrations, a tenancy mode implied by per-tenant data sources), so the configured values alone do not say what the host is doing; this line does. `[Rubric §11, Security]`: only names, enum values and flags are logged. Connection strings, keys and every other secret stay out, and the engines are derived from WHETHER a connection string is set, never from its text (`StartupConfigurationSummaryService.cs:20-23`).

- **Walkthrough**:
  - `FrameworkVersion` (`StartupConfigurationSummaryService.cs:49-52`): the `AssemblyInformationalVersionAttribute` stamped on the assembly (the release tag on a release build, the `0.0.0-dev` placeholder otherwise), or `unknown` when it is absent, computed once in a static property.
  - `StartAsync` (`:55-77`) builds the summary only when Information is enabled (`:59`), so a host that filters Information pays nothing for the engine and cache probes. It names the engines (`none` when there are none, `:61-62`), the cache mode and the tenancy mode, and writes them with the bus `Provider` and `ProvisionTopology` through the source-generated `LogConfigurationSummary` (`:66-73`, declared at `:127-137`). It writes nothing else.
  - `StopAsync` (`:80`) is a completed task.
  - `CacheMode(services)` (`:95-107`) returns `hybrid` when `HybridCache` is registered, `misconfigured` when the resolved `IDistributedCache` is not the in-memory `MemoryDistributedCache` (the host wired Redis but not the cache over it, which the `AddCaching` factory refuses on first use), and `memory` otherwise. It deliberately repeats the decision the `ICacheService` registrations make instead of resolving [ICacheService](group-09-caching.md#icacheservice), because the two-level cache resolves `IConnectionMultiplexer` and constructing it here would open a Redis-backed host's connection at startup instead of on first use; `HybridCache` is checked by registration through `IServiceProviderIsService`, and resolving `IDistributedCache` does not connect (`:82-94`).
  - `TenancyMode(settings)` (`:115-125`) returns `off` when tenancy is disabled, `database-per-tenant` when at least one tenant routes a data source to its own database, and `shared-database` otherwise.

- **Why it's built this way**: the summary is one line so it sits at the top of every log. Naming a `misconfigured` cache up front surfaces at boot a state that would otherwise fail only on the first cache use. Registration through `TryAddEnumerable` means a host whose modules each call `AddInfrastructure` still writes the summary exactly once (`StartupConfigurationSummaryService.cs:24-27`).

- **Where it's used**: registered in `AddInfrastructure` with `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, Configuration.StartupConfigurationSummaryService>())` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:238`). `CacheMode` and `TenancyMode` are `internal static` so the tests can call them directly. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Configuration/StartupConfigurationSummaryServiceTests.cs`.

- **Caveats / not-in-source**: no ADR records this service. The line is written once at start, so a setting changed at runtime through a reloadable provider is not reflected in it.

### BrokerConsumerKind
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerConsumerKind.cs:4` · Level 0 · enum

- **What it is**: says how a host consumes one subscribed integration event: `Current = 0` delivers it to the handlers of its own type, `Upcasted = 1` treats it as a retired contract that is upcast to its terminal successor first (`BrokerConsumerKind.cs:7,10`).
- **Depends on**: nothing first-party.
- **Concept**: a two-value switch carried on every [`BrokerSubscription`](#brokersubscription); the upcasting idea itself belongs to [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html) and is taught at [`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent).
- **Walkthrough**: explicit numeric values (`BrokerConsumerKind.cs:7,10`), with `Current` as the default.
- **Why it's built this way**: one subscription list serves both kinds, so the receive pipeline needs only this flag to pick the consumer type: [`BrokerConsumerBuilder`](#brokerconsumerbuilder) maps `Upcasted` to `UpcastingIntegrationEventConsumer<>` and anything else to `IntegrationEventConsumer<>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:40-44`).
- **Where it's used**: set by `RegisterIntegrationEventConsumer` (`BrokerConsumerBuilder.cs:22`) and `RegisterUpcastedIntegrationEventConsumer` (`BrokerConsumerBuilder.cs:27`), and named in the duplicate-registration error (`BrokerConsumerBuilder.cs:56`).

### BrokerDisposition
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerDisposition.cs:8` · Level 0 · record (abstract)

- **What it is**: the closed set of outcomes the framework receive pipeline hands back to a transport for one delivered message: complete it, redeliver it later, or dead-letter it.
- **Depends on**: [`BrokerHeaders`](#brokerheaders) (the redelivery-count header the `Redeliver` case documents, `BrokerDisposition.cs:18`).
- **Concept introduced, the disposition as a value.** `[Rubric §10, Messaging & Integration]` assesses whether delivery, retry and poison handling are explicit and consistent across transports; here the decision about a message is made once, in transport-neutral code, and returned as data, so every transport (RabbitMQ, PostgreSQL, Azure Service Bus, Amazon SQS) only has to *apply* a verdict it did not compute. `[Rubric §2, Design Patterns]`: an abstract record with nested sealed records is the C# shape of a discriminated union; consumers `switch` on the three cases.
- **Walkthrough**: `Complete` (`BrokerDisposition.cs:11`) is a shared singleton [`Completed`](#completed) instance; the three nested cases are [`Completed`](#completed) (`:14`), [`Redeliver`](#redeliver) (`:24`) and [`DeadLetter`](#deadletter) (`:33`). The doc comments define the contract each transport implements: `Redeliver` enqueues a delayed copy with every other header and the body unchanged, then acknowledges the original (`BrokerDisposition.cs:16-21`); `DeadLetter` moves the message to the dead-letter location with reason and detail "where the broker allows", then acknowledges it (`BrokerDisposition.cs:26-30`).
- **Why it's built this way**: retry, redelivery and dead-lettering live once in the framework pipeline and `BrokerTransportPolicies`, shared by every transport (`MMCA.Common/AGENTS.md`, Microservices Extraction Boundaries); the poison and redelivery policy is [ADR-087](https://ivanball.github.io/docs/adr/087-broker-poison-message-handling.html), and the native-transport extension point is [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html).
- **Where it's used**: produced by [`BrokerReceivePipeline`](#brokerreceivepipeline) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:82,100,166,176`) and applied by [`RabbitMqDispositionApplier`](#rabbitmqdispositionapplier), [`PostgreSqlDispositionApplier`](#postgresqldispositionapplier) and the cloud adapters' delivery handlers (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusDeliveryHandler.cs`, `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsDeliveryHandler.cs`, per the brief's usage sites).

### BrokerHeaders
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerHeaders.cs:8` · Level 0 · class (static)

- **What it is**: the header-name constants that make up the framework's wire contract on every broker.
- **Depends on**: nothing first-party.
- **Concept**: a shared wire vocabulary. `[Rubric §9, API & Contract Design]` assesses whether a contract is explicit and stable; here the message envelope is a fixed set of named headers independent of any broker SDK, so a publisher on one transport and the receive pipeline agree on names by construction.
- **Walkthrough**: `EventName = "mmca-event-name"` (`BrokerHeaders.cs:11`, the receiver resolves the subscription and CLR type from it); `MessageId = "mmca-message-id"` (`:14`, the key the inbox dedupes on); `RedeliveryCount = "mmca-redelivery-count"` (`:17`, absent means none); `ContentType = "content-type"` (`:20`) with `JsonContentType = "application/json"` (`:23`, the only body type the framework writes); `TraceParent = "traceparent"` (`:26`) and `TraceState = "tracestate"` (`:29`) for W3C trace context.
- **Why it's built this way**: the inbox key and the redelivery counter must survive any broker, so they travel as plain string headers rather than broker-native properties; inbox dedupe is [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html).
- **Where it's used**: [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) writes `EventName`, `MessageId`, `ContentType` and the trace headers (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:66-68,113,116`); [`IncomingBrokerMessage`](#incomingbrokermessage) reads `EventName` and `RedeliveryCount` (`IncomingBrokerMessage.cs:17,24`); [`BrokerReceivePipeline`](#brokerreceivepipeline) names the header in its unknown-event detail (`BrokerReceivePipeline.cs:126`).
- **Caveats / not-in-source**: the `MMCA-*` ambient-origin headers restored by the consumer are not declared here; they belong to [`AmbientOrigin`](#ambientorigin).

### Completed
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerDisposition.cs:14` · Level 0 · record (sealed, nested in `BrokerDisposition`)

- **What it is**: the [`BrokerDisposition`](#brokerdisposition) case meaning "handled, or deliberately skipped as a duplicate: acknowledge and remove it" (`BrokerDisposition.cs:13`).
- **Depends on**: [`BrokerDisposition`](#brokerdisposition).
- **Concept**: see [`BrokerDisposition`](#brokerdisposition).
- **Walkthrough**: no members; callers use the shared `BrokerDisposition.Complete` instance (`BrokerDisposition.cs:11`) rather than allocating one.
- **Where it's used**: returned when the consumer succeeds (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:100`), then matched by each transport's disposition applier.
- **Caveats / not-in-source**: several usage sites the inventory lists for the name `Completed` (for example `UsersAdminControllerBase.cs`, `OfflineWriteQueueTests.cs`) are unrelated identifiers that share the name, not this record.

### OutgoingBrokerMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/OutgoingBrokerMessage.cs:13` · Level 0 · record (sealed)

- **What it is**: a serialized integration event ready to publish: `Topic`, `EventName`, `MessageId`, `Body` and `Headers` (`OutgoingBrokerMessage.cs:13-18`).
- **Depends on**: BCL only (`ReadOnlyMemory<byte>`, `IReadOnlyDictionary<string, string>`).
- **Concept**: the transport-neutral publish envelope; its receive-side twin is [`IncomingBrokerMessage`](#incomingbrokermessage).
- **Walkthrough**: a positional record; `Body` is already-serialized bytes and `Headers` carries the [`BrokerHeaders`](#brokerheaders) entries. `EventName` and `MessageId` duplicate header values as typed fields so a transport need not parse them back.
- **Why it's built this way**: the serializer and header stamping run once in [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:86`), so each publisher only maps an envelope onto its SDK.
- **Where it's used**: the only argument of [`IBrokerPublisher`](#ibrokerpublisher)`.PublishAsync` (`IBrokerPublisher.cs:18`), and of the PostgreSQL message store ([`IPostgreSqlMessageStore`](#ipostgresqlmessagestore)).

### BrokerSubscription
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerSubscription.cs:11` · Level 1 · record (sealed)

- **What it is**: one integration event a host consumes: its wire `EventName`, CLR `EventType`, the `Topic` it is published on, and its [`BrokerConsumerKind`](#brokerconsumerkind) (`BrokerSubscription.cs:11`).
- **Depends on**: [`BrokerConsumerKind`](#brokerconsumerkind).
- **Concept**: the unit of [`BrokerTopology`](#brokertopology); a transport binds one topic per subscription to the host's queue.
- **Walkthrough**: a one-line positional record.
- **Why it's built this way**: name and topic are computed once at registration with [`BrokerNaming`](#brokernaming) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:49,60`), so the receiver never recomputes them per message.
- **Where it's used**: built by [`BrokerConsumerBuilder`](#brokerconsumerbuilder) (`BrokerConsumerBuilder.cs:60`), held by [`BrokerTopology`](#brokertopology), and looked up by [`BrokerReceivePipeline`](#brokerreceivepipeline) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:120`).

### DeadLetter
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerDisposition.cs:33` · Level 1 · record (sealed, nested in `BrokerDisposition`)

- **What it is**: the [`BrokerDisposition`](#brokerdisposition) case for a message that cannot be handled: move it to the dead-letter location with `Reason` and `Detail`, then acknowledge it (`BrokerDisposition.cs:26-33`).
- **Depends on**: [`BrokerDisposition`](#brokerdisposition).
- **Concept**: see [`BrokerDisposition`](#brokerdisposition); poison handling is [ADR-087](https://ivanball.github.io/docs/adr/087-broker-poison-message-handling.html).
- **Walkthrough**: `Reason` is a short machine-friendly string and `Detail` a nullable human-readable description (`BrokerDisposition.cs:31-32`). The pipeline uses three reasons: `unknown-event`, `poison` and `handler-failed` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:29,32,35`). An unknown event or an undeserializable body is dead-lettered immediately, since no retry can fix it (`BrokerReceivePipeline.cs:124,137,144`); a handler failure is dead-lettered only after every redelivery is spent (`BrokerReceivePipeline.cs:162-176`).
- **Where it's used**: produced by [`BrokerReceivePipeline`](#brokerreceivepipeline); applied by each transport's disposition applier or delivery handler.

### IBrokerPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerPublisher.cs:9` · Level 1 · interface

- **What it is**: the publish half of a broker transport: one method, `PublishAsync(OutgoingBrokerMessage, CancellationToken)` (`IBrokerPublisher.cs:18`).
- **Depends on**: [`OutgoingBrokerMessage`](#outgoingbrokermessage).
- **Concept**: a narrow port per transport. `[Rubric §1, SOLID]` (interface segregation, dependency inversion): the framework's bus depends on this one-method abstraction, and each transport supplies only an implementation, so adding a broker never touches the publish path.
- **Walkthrough**: the contract carries the body and every header unchanged, and when `MessageBus:ProvisionTopology` is set a missing topic is created first (`IBrokerPublisher.cs:12-13`). The returned task completes when the broker has accepted the message (`IBrokerPublisher.cs:17`).
- **Why it's built this way**: a transport registers "only its `IBrokerPublisher` and its hosted receiver"; everything else is shared framework code (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:44-46`; `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:38`). See [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html) and [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html).
- **Where it's used**: consumed by [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`BrokerMessageBus.cs:47`); implemented by [`RabbitMqPublisher`](#rabbitmqpublisher), [`PostgreSqlPublisher`](#postgresqlpublisher), and the Azure Service Bus and Amazon SQS publishers in the vendor adapters.

### IncomingBrokerMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IncomingBrokerMessage.cs:11` · Level 1 · record (sealed)

- **What it is**: a delivered message as the receive pipeline sees it: `Body`, `Headers`, and the broker's own `BrokerMessageId` (`IncomingBrokerMessage.cs:11-14`).
- **Depends on**: [`BrokerHeaders`](#brokerheaders).
- **Concept**: the receive-side envelope, the twin of [`OutgoingBrokerMessage`](#outgoingbrokermessage).
- **Walkthrough**: `EventName` (`IncomingBrokerMessage.cs:17`) reads the `mmca-event-name` header or returns `null`. `RedeliveryCount` (`IncomingBrokerMessage.cs:23-27`) parses the `mmca-redelivery-count` header with `NumberStyles.None` and the invariant culture, so an absent or malformed value (including a sign) reads as zero.
- **Why it's built this way**: tolerant parsing means a tampered or foreign header degrades to "first attempt" rather than throwing inside the receive loop. `BrokerMessageId` is kept separate from the event's own `MessageId` header because it is only used for logging the broker-side delivery (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:123,136`).
- **Where it's used**: built by each transport receiver (for example [`RabbitMqReceiver`](#rabbitmqreceiver), [`PostgreSqlReceiver`](#postgresqlreceiver)) and the vendor message mappings, then passed to [`IBrokerReceivePipeline`](#ibrokerreceivepipeline).

### Redeliver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerDisposition.cs:24` · Level 1 · record (sealed, nested in `BrokerDisposition`)

- **What it is**: the [`BrokerDisposition`](#brokerdisposition) case for a second-level redelivery: enqueue a copy visible after `Delay` with the redelivery-count header set to `RedeliveryCount`, then acknowledge the original (`BrokerDisposition.cs:16-24`).
- **Depends on**: [`BrokerDisposition`](#brokerdisposition), [`BrokerHeaders`](#brokerheaders).
- **Concept**: second-level redelivery per [ADR-087](https://ivanball.github.io/docs/adr/087-broker-poison-message-handling.html): after in-process retries fail, the message leaves the consumer and comes back later, instead of holding the delivery.
- **Walkthrough**: [`BrokerReceivePipeline`](#brokerreceivepipeline) returns it while `redeliveryCount < _redeliveryIntervals.Length`, taking the delay from the interval at the current count and incrementing the count (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:162-166`); the count read comes from [`IncomingBrokerMessage`](#incomingbrokermessage)`.RedeliveryCount` (`BrokerReceivePipeline.cs:104`).
- **Where it's used**: applied by the transport appliers and vendor delivery handlers, each with its own delay mechanism.
- **Caveats / not-in-source**: the redelivery interval values come from settings and the transport's `MaxRedeliveryDelay` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:108-113`); the defaults are not shown in these files.

### BrokerNaming
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerNaming.cs:13` · Level 2 · class (static)

- **What it is**: the deterministic naming rules for broker entities: event wire names, topics, the host queue name, length fitting, and kebab casing.
- **Depends on**: [`EventNameResolver`](group-04-events-outbox.md#eventnameresolver) (`BrokerNaming.cs:29`, for an [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) declared name); BCL `SHA256`, `StringBuilder`.
- **Concept**: naming as a pure function. `[Rubric §7, Microservices Readiness]` assesses whether services can be split and redeployed independently; because every host derives the same names from the same inputs, a publisher and a separately deployed consumer agree on topics without shared configuration.
- **Walkthrough**:
  - `EventName(Type)` (`BrokerNaming.cs:25-30`): kebab-case of the declared `[EventName]` when present, otherwise the CLR full name, so equal short names in different modules never share a topic.
  - `Topic(applicationNamespace, eventName)` (`BrokerNaming.cs:36-42`): `{kebab(namespace)}-{eventName}`.
  - `Queue(configured, applicationName)` (`BrokerNaming.cs:53-69`): the configured `MessageBus:QueueName` when set, else the kebab application name with a trailing `-service` trimmed (only when derived, and only if something remains); throws `InvalidOperationException` when neither yields a name.
  - `Fit(name, maxLength)` (`BrokerNaming.cs:80-92`): returns a name within the limit unchanged; otherwise keeps the prefix and appends `-` plus the first 8 lowercase hex digits of its SHA-256. `maxLength` must be at least 16 (`:83`).
  - `Kebab(value)` (`BrokerNaming.cs:97-130`): lowercases ASCII letters and digits, collapses every other run to one `-`, and also breaks at a lower-to-upper boundary (`UserRegistered` becomes `user-registered`, `:110-113`).
- **Why it's built this way**: topics are prefixed with the application namespace so two applications sharing a broker never publish onto each other's topics (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:86-89`). The hash suffix in `Fit` keeps two long names distinct and identical on every host (`BrokerNaming.cs:71-75`).
- **Where it's used**: [`BrokerConsumerBuilder`](#brokerconsumerbuilder) (`BrokerConsumerBuilder.cs:49,60`), [`BrokerTopology`](#brokertopology)`.TopicFor` (`BrokerTopology.cs:55`), `AddBrokerMessaging` for the queue (`DependencyInjection.Messaging.cs:96`), [`RabbitMqNames`](#rabbitmqnames), and the Azure and AWS entity-name helpers; ADC's `BrokerTopologyBicepTests` checks infrastructure names against it.

### IBrokerConsumerBuilder
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerConsumerBuilder.cs:16` · Level 2 · interface

- **What it is**: the fluent registration surface a host uses to declare which integration events it consumes from the broker.
- **Depends on**: [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) (the generic constraint).
- **Concept**: declarative subscription. `[Rubric §10, Messaging & Integration]`: a host lists its consumed events once, and the topology, the per-subscription consumer registration and the broker bindings are all derived from that list.
- **Walkthrough**: `RegisterIntegrationEventConsumer<TEvent>()` (`IBrokerConsumerBuilder.cs:26-27`) delivers each message to every `IIntegrationEventHandler<TEvent>` in the host through the inbox. `RegisterUpcastedIntegrationEventConsumer<TEvent>()` (`IBrokerConsumerBuilder.cs:40-41`) drains a retired contract, upcasting it to its terminal successor and delivering to that contract's handlers; pair it with `AddEventUpcaster<TEvent, TNew, TUpcaster>()` and a plain registration for the current contract, never register both kinds for the same type, and with no upcaster registered it degrades to ordinary dispatch (`IBrokerConsumerBuilder.cs:30-35`). Both throw `InvalidOperationException` when the type is already registered (`:25,39`).
- **Why it's built this way**: registering the same event both ways would bind two consumers to one wire name; the builder rejects it by type or by wire name (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:51-58`). Upcasting is [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html).
- **Where it's used**: implemented by [`BrokerConsumerBuilder`](#brokerconsumerbuilder), passed to the `configureConsumers` callback of `AddBrokerMessaging` (`DependencyInjection.Messaging.cs:91-92`); ADC's per-service registrations (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/ConferenceBrokerConsumers.cs`, `EngagementBrokerConsumers.cs`, `IdentityBrokerConsumers.cs`) call it.

### IBrokerReceivePipeline
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/IBrokerReceivePipeline.cs:16` · Level 2 · interface

- **What it is**: the transport-neutral handling of one delivered message: `ProcessAsync(IncomingBrokerMessage, CancellationToken)` returning a [`BrokerDisposition`](#brokerdisposition) (`IBrokerReceivePipeline.cs:22`).
- **Depends on**: [`IncomingBrokerMessage`](#incomingbrokermessage), [`BrokerDisposition`](#brokerdisposition).
- **Concept**: the split between "decide" and "apply". `[Rubric §14, Testability]` assesses whether behavior can be verified without infrastructure; because the decision is a pure function of message and handler outcome returning a value, the pipeline is unit-tested without a broker and each transport is tested only on how it applies the three dispositions.
- **Walkthrough**: one method; the cancellation token fires when the host is stopping (`IBrokerReceivePipeline.cs:20`).
- **Why it's built this way**: the framework pipeline owns trace context, origin restore, inbox, retry and dead-lettering, and a transport only receives and applies (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:44-46`; `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:13,38-40`).
- **Where it's used**: registered as a singleton [`BrokerReceivePipeline`](#brokerreceivepipeline) (`DependencyInjection.Messaging.cs:109`); called by [`RabbitMqReceiver`](#rabbitmqreceiver), [`PostgreSqlReceiver`](#postgresqlreceiver), and the Azure and AWS delivery handlers.

### BrokerTopology
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Broker` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerTopology.cs:10` · Level 3 · class (sealed)

- **What it is**: a host's complete broker shape: the application namespace topics are prefixed with, the host's queue name, and the subscriptions bound to that queue, with lookup by wire name.
- **Depends on**: [`BrokerSubscription`](#brokersubscription), [`BrokerNaming`](#brokernaming), [`BrokerHeaders`](#brokerheaders) (doc reference).
- **Concept**: one immutable description that every transport provisions from and the receive pipeline routes by. `[Rubric §13, Observability & Operability]` (as configuration safety): a duplicate subscription fails at startup, not as a silently misrouted message.
- **Walkthrough**: the constructor (`BrokerTopology.cs:19-41`) guards its arguments, rejects two subscriptions with the same event name with an `InvalidOperationException` naming both registration methods (`:25-34`), and indexes the rest in an ordinal dictionary (`:36`). `ApplicationNamespace`, `QueueName` and `Subscriptions` (registration order) are read-only properties (`:44,47,50`). `TopicFor(Type)` composes [`BrokerNaming`](#brokernaming)`.Topic` and `.EventName` (`:55`). `TryGetSubscription(eventName, out subscription)` is the per-message lookup (`:61-62`).
- **Why it's built this way**: [`BrokerConsumerBuilder`](#brokerconsumerbuilder) already rejects duplicates (`BrokerConsumerBuilder.cs:51-58`); the constructor repeats the check because the topology is public and can be built directly (as tests do).
- **Where it's used**: built once and registered as a singleton by `AddBrokerMessaging` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:94-99`), which also registers one scoped consumer per subscription (`:103-106`). Read by [`BrokerReceivePipeline`](#brokerreceivepipeline) (`BrokerReceivePipeline.cs:120`), [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`BrokerTransportContext`](#brokertransportcontext), and every receiver and provisioner.

### MessageBusProviders

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:10` · Level 0 · class (public static)

- **What it is**: the vocabulary of `MessageBus:Provider`. Three public string constants name the transports the core package ships (`InProcess`, `RabbitMq`, `PostgreSql`), three internal predicates compare a configured value against them case-insensitively, and an internal lookup table names the adapter package and registration call for the two cloud transports the framework knows about (`MessageBusProviders.cs:10-58`).

- **Depends on**: nothing first-party. BCL only (`StringComparer.OrdinalIgnoreCase`, `string.Equals`).

- **Concept introduced, transport selection as a configuration string.** `[Rubric §7, Microservices Readiness]` assesses whether the move from one process to many is a deployment change rather than a code change, and this class is where that move is spelled. The same host binary runs as a modular monolith with `InProcess` (the default when the setting is blank, `:12-16`), as a development microservice deployment on `RabbitMq` (`:18-19`), or on the built-in PostgreSQL transport against any PostgreSQL database with `PostgreSql` (`:21-27`). `[Rubric §33, Developer Experience]` assesses whether a misconfiguration tells the developer how to fix it: `KnownAdapterTransports` exists only to make the "unknown provider" error actionable, and its doc says it registers nothing (`:29-33`). The provider switch itself is [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html); the cloud-neutral split behind the adapter table is [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html).

- **Walkthrough**
  - `InProcess = "InProcess"` (`MessageBusProviders.cs:16`), `RabbitMq = "RabbitMq"` (`:19`), `PostgreSql = "PostgreSql"` (`:27`). The `PostgreSql` doc stresses that the broker is a database, not a cloud service, so any managed or self-hosted PostgreSQL serves (`:21-26`).
  - `KnownAdapterTransports` (`:34-39`) is an `OrdinalIgnoreCase` dictionary of `(Package, Registration)` pairs: `AzureServiceBus` maps to `MMCA.Common.Azure` and `services.AddAzureServiceBusTransport()` (`:37`), `AmazonSqs` to `MMCA.Common.Aws` and `services.AddAmazonSqsTransport()` (`:38`).
  - `IsInProcess(provider)` (`:44-45`) is true for a null, empty or whitespace value as well as for `InProcess`, which is what makes in-process dispatch the zero-configuration default. `IsRabbitMq` (`:50-51`) and `IsPostgreSql` (`:56-57`) are plain case-insensitive equality checks.

- **Why it's built this way**: keeping the names as constants in one place means the selection logic, the outbox default and the startup summary compare against the same strings. Keeping the adapter table internal and descriptive (a package name plus a call, never a type reference) is what lets the core package name a cloud transport in an error message without referencing its SDK, which [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html) forbids.

- **Where it's used**: `AddBrokerMessaging` returns before registering any broker service when `IsInProcess` holds (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:72`). `ResolveBrokerTransport` (`DependencyInjection.Messaging.cs:199`) returns [RabbitMqBrokerTransport](#rabbitmqbrokertransport) or [PostgreSqlBrokerTransport](#postgresqlbrokertransport) for the built-in names (`:201-208`), and otherwise builds its failure from these members: the available list starts with the three constants (`:225`) and the remedy quotes the `KnownAdapterTransports` entry when one matches (`:226`). [MessageBusSettings](#messagebussettings) resolves the inbox and outbox defaults from `IsInProcess` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:142`, `:180`), and each built-in transport returns its constant as its `Name`. [StartupConfigurationSummaryService](#startupconfigurationsummaryservice) also references the type.

- **Caveats / not-in-source**: `KnownAdapterTransports` carries only the Azure and AWS entries; a provider name for any other adapter falls through to the generic "register an `IBrokerTransport` named ..." remedy (`DependencyInjection.Messaging.cs:228`).

---

### PostgreSqlClaimedMessage

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlClaimedMessage.cs:14` · Level 0 · record (internal sealed)

- **What it is**: one row of the PostgreSQL transport's `messages` table as a receiver holds it after a claim: the row `Id`, the `LockToken` that proves the claim, the application `MessageId`, the headers, the body bytes and the `DeliveryCount` (`PostgreSqlClaimedMessage.cs:14-20`).

- **Depends on**: nothing first-party. BCL types only.

- **Concept**: the claim-under-a-lease model is taught at [IPostgreSqlMessageStore](#ipostgresqlmessagestore). What matters about this record is that `Id` and `LockToken` travel together: every settle statement matches on both, so a receiver whose lease passed to another claim changes nothing.

- **Walkthrough**
  - Six positional members (`PostgreSqlClaimedMessage.cs:15-20`). `Headers` is an `IReadOnlyDictionary<string, string>` (`:18`) and `Body` a `byte[]` (`:19`).
  - [PostgreSqlMessageStore](#postgresqlmessagestore) builds one per row the claim statement returns, stamping the one lock token it generated for the whole batch (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlMessageStore.cs:103`, `:119-125`).

- **Why it's built this way**: a positional record keeps the claim result immutable, so the receiver can hand the same instance to the pipeline, the lease renewer and the settle call without one of them changing what the others see.

- **Where it's used**: returned by `IPostgreSqlMessageStore.ClaimAsync` and passed back to every settle and renew method (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/IPostgreSqlMessageStore.cs:36-71`). [PostgreSqlReceiver](#postgresqlreceiver) tracks the in-flight ones by `Id` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlReceiver.cs:40`), and [PostgreSqlDispositionApplier](#postgresqldispositionapplier) settles them. The test double `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/FakePostgreSqlMessageStore.cs` builds them directly.

---

### PostgreSqlTransportSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlTransportSettings.cs:8` · Level 0 · class (internal sealed)

- **What it is**: the `MessageBus:PostgreSql` sub-section that tunes the built-in PostgreSQL transport: the schema the broker's tables live in, the role the migration creates and makes their owner, and whether this host runs that migration at startup (`PostgreSqlTransportSettings.cs:8-43`). Everything else (connection string, retry, redelivery, backpressure, topology provisioning) comes from the shared `MessageBus` section.

- **Depends on**: nothing first-party. Plain `init` properties read through `IConfiguration`'s `Get<T>()`.

- **Concept**: the parent section and its options shape are taught at [MessageBusSettings](#messagebussettings). `[Rubric §8, Data Architecture]` applies to the default schema: the broker can share a database with the application's own tables because its tables sit in their own `transport` schema (`:16-20`). `[Rubric §17, DevOps]` applies to `MigrateOnStartup`: the migration needs rights to create a role and a schema, so a host whose database user has neither turns the switch off and creates the schema out of band, which is safe because the DDL is idempotent (`:30-35`).

- **Walkthrough**
  - `SectionPath = "MessageBus:PostgreSql"` (`PostgreSqlTransportSettings.cs:11`) and `DefaultName = "transport"` (`:14`), the default for both the schema and the role.
  - `Schema` (`:21`) and `Role` (`:28`) are nullable; their docs state the identifier rule (a letter or underscore, then letters, digits or underscores, at most 63 characters, `:18-19`, `:27`). `EffectiveSchema` (`:39`) and `EffectiveRole` (`:42`) fall back to `DefaultName` when the configured value is null or whitespace.
  - `Role` is the role the migration creates when missing, grants to the connecting user, and makes the owner of the schema and its tables, so every service that connects as a member of it can use the transport (`:23-27`).
  - `MigrateOnStartup` (`:36`) defaults to `true`.

- **Why it's built this way**: the doc on `MigrateOnStartup` names the constraint directly (`PostgreSqlTransportSettings.cs:30-35`): creating a role and a schema is a privilege an application user often lacks, so a deployment needs a way to run the migration once from a host that has it. The type is `internal` because only the transport reads it.

- **Where it's used**: [PostgreSqlBrokerTransport](#postgresqlbrokertransport) reads it through `ReadSettings`, which falls back to a default instance when the section is absent (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:99-101`). `Register` feeds `EffectiveSchema` and `EffectiveRole` into [PostgreSqlTransportSql](#postgresqltransportsql) (`:67-68`) and uses `MigrateOnStartup` to decide whether to register [PostgreSqlSchemaMigrator](#postgresqlschemamigrator) and whether the publisher and receiver ensure the schema first (`:69-79`, `:86`). Also read by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/PostgreSqlBrokerTransportTests.cs`.

- **Caveats / not-in-source**: the section carries no validation attributes and is read with `Get<T>()`; the identifier rule is enforced later, when [PostgreSqlTransportSql](#postgresqltransportsql) is constructed during `Register` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlTransportSql.cs:35-36`), so a bad name fails at startup rather than at bind time.

---

### IPostgreSqlMessageStore

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/IPostgreSqlMessageStore.cs:10` · Level 1 · interface (internal)

- **What it is**: every database operation the PostgreSQL transport performs, as eleven async methods: create the schema, bind topics to a queue, publish, claim, the four settle outcomes (complete, redeliver, dead-letter, release), renew leases, ask when the next row is due, and listen for publish notifications (`IPostgreSqlMessageStore.cs:10-88`).

- **Depends on**: [OutgoingBrokerMessage](#outgoingbrokermessage) and [PostgreSqlClaimedMessage](#postgresqlclaimedmessage).

- **Concept introduced, a database table as a queue under leased claims.** `[Rubric §10, Messaging and Integration]` assesses whether delivery semantics are explicit rather than inherited from a vendor. Here they are spelled out in the method contracts: a claim takes up to `limit` due rows "under a lease" (`:30-36`), and every settle method returns `false` "when the lease was lost (another claim holds the row)" (`:41`, `:49`, `:57`, `:63`). A crashed receiver therefore loses nothing: its lease expires and the row becomes claimable again, which is at-least-once delivery that the inbox then dedupes ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)). `[Rubric §29, Resilience and Business Continuity]` applies to `ListenAsync`: it throws when the connection fails (`:79-81`), and the receiver falls back to polling rather than stalling.

- **Walkthrough**
  - `EnsureSchemaAsync` (`IPostgreSqlMessageStore.cs:15`) runs the migration once per process; a failed attempt is retried on the next call (`:12`).
  - `SubscribeAsync(queue, topics)` (`:22`) and `PublishAsync(message)` (`:28`): publish inserts one row per queue subscribed to the message's topic and signals those queues (`:24`).
  - `ClaimAsync(queue, limit, lease)` (`:36`) returns the claimed rows, possibly none.
  - `CompleteAsync` deletes a handled row (`:42`); `RedeliverAsync(message, delay, headers)` hides it for `delay` with new headers and releases the claim (`:50`); `DeadLetterAsync(message, reason, detail)` moves it to `dead_letters` (`:58`); `ReleaseAsync` frees the claim without settling, so the row is claimable at once (`:64`).
  - `RenewAsync(messages, lease)` (`:71`) extends the lease of every row still held; `NextDueAsync(queue)` (`:77`) returns the wait until the next claimable row, or null for an empty queue.
  - `ListenAsync(queue, notified)` (`:87`) calls `notified` per notification and once when listening starts (`:84`).

- **Why it's built this way**: putting the SQL behind an interface separates the receiver's concurrency logic from the database, so [PostgreSqlReceiver](#postgresqlreceiver) and [PostgreSqlDispositionApplier](#postgresqldispositionapplier) are unit-tested against `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/FakePostgreSqlMessageStore.cs` without a server.

- **Where it's used**: implemented by [PostgreSqlMessageStore](#postgresqlmessagestore). Consumed by [PostgreSqlReceiver](#postgresqlreceiver), [PostgreSqlPublisher](#postgresqlpublisher), [PostgreSqlSchemaMigrator](#postgresqlschemamigrator) and [PostgreSqlDispositionApplier](#postgresqldispositionapplier).

---

### BrokerTransportPolicies

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:16` · Level 2 · class (public static)

- **What it is**: the receive-side policies every broker transport shares, as pure functions of [MessageBusSettings](#messagebussettings): the exponential in-process retry delay, the second-level redelivery intervals (clamped to a transport's delay cap), and the two backpressure knobs (`BrokerTransportPolicies.cs:16-104`).

- **Depends on**: [MessageBusSettings](#messagebussettings) only. No transport library.

- **Concept introduced, one failure policy across interchangeable transports.** `[Rubric §10, Messaging and Integration]` assesses whether poison and transient failures are handled deliberately rather than by each transport's defaults, and `[Rubric §29, Resilience and Business Continuity]` assesses whether a transient fault is absorbed before it becomes a dead letter. Because [IBrokerTransport](#ibrokertransport) lets an adapter package supply the transport, the retry and redelivery numbers would otherwise be re-derived (and drift) per broker. This class is the single definition: the framework receive pipeline reads the retry delay and redelivery intervals from it, and each transport reads its backpressure values from it. In-process retry absorbs a blip measured in seconds; second-level redelivery re-enqueues the message over one minute, ten minutes and one hour by default, so an outage measured in minutes or hours does not dead-letter the event, and every in-process retry is exhausted before a redelivery is asked for (`:10-14`). Poison-message handling is [ADR-087](https://ivanball.github.io/docs/adr/087-broker-poison-message-handling.html); the library policy that keeps the transports as framework code is [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html).

- **Walkthrough**
  - `RetryDelay(settings, retryNumber)` (`BrokerTransportPolicies.cs:27-40`) rejects a retry number below 1 (`:30`), doubles `RetryMinIntervalSeconds` per retry and caps the result at `RetryMaxIntervalSeconds` (`:32-37`), with the exponent capped at 30 (`:36`). With the defaults (1 and 30 seconds) the five retries wait 1, 2, 4, 8 and 16 seconds (`:19-22`); `RetryLimit` defaults to `5` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:94`).
  - `BuildRedeliveryIntervals(settings)` (`:52-53`) delegates to the two-argument overload with no cap.
  - `BuildRedeliveryIntervals(settings, maxRedeliveryDelay)` (`:65-75`) falls back to `MessageBusSettings.DefaultRedeliveryIntervalsSeconds` when nothing is configured, drops non-positive entries (`:72`), and shortens every interval longer than the cap to the cap (`:74`). A null or non-positive cap means no cap (`:69`). A zero interval is dropped because it would redeliver immediately, which is what the in-process retry already does, and an empty result turns second-level redelivery off (`:43-48`).
  - `ResolvePrefetchCount` (`:85-90`) and `ResolveConcurrentMessageLimit` (`:98-103`) return the configured value only when it is greater than zero, otherwise null so the transport keeps its own default. The doc explains why the guard is code rather than a `[Range]` attribute: `AddBrokerMessaging` binds the section with `Get<MessageBusSettings>()`, which never runs DataAnnotations (`:77-81`).

- **Why it's built this way**: as pure functions with no transport type in their signatures, the policies can be shared by transports that have nothing else in common (an AMQP channel, a PostgreSQL table, a cloud SDK receiver), and they are trivially unit-tested. Returning null for an unset knob, rather than a framework default, leaves each broker's own sensible default in place.

- **Where it's used**: [BrokerReceivePipeline](#brokerreceivepipeline) builds its intervals with the transport's `MaxRedeliveryDelay` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:72`) and waits `RetryDelay` between attempts (`:197`). [PostgreSqlReceiverOptions](#postgresqlreceiveroptions) resolves its concurrency and claim batch from the two backpressure functions (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlReceiverOptions.cs:41-42`), as do [RabbitMqBrokerTransport](#rabbitmqbrokertransport) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqBrokerTransport.cs:95`, `:105`), `AmazonSqsReceiver` (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsReceiver.cs:75`, `:81`) and `AzureServiceBusReceiver` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusReceiver.cs:88-89`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/BrokerTransportPoliciesTests.cs`.

- **Caveats / not-in-source**: the cap clamps rather than rejects, so a configured interval longer than a broker allows (Amazon SQS caps a delay at 15 minutes, `:59-60`) runs at the cap without an error.

---

### PostgreSqlDispositionApplier

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlDispositionApplier.cs:17` · Level 2 · class (internal static)

- **What it is**: the one function that turns a [BrokerDisposition](#brokerdisposition) returned by the receive pipeline into the matching [IPostgreSqlMessageStore](#ipostgresqlmessagestore) settle call (`PostgreSqlDispositionApplier.cs:17-49`).

- **Depends on**: [IPostgreSqlMessageStore](#ipostgresqlmessagestore), [PostgreSqlClaimedMessage](#postgresqlclaimedmessage), [BrokerDisposition](#brokerdisposition) and its [Redeliver](#redeliver) and [DeadLetter](#deadletter) cases, [BrokerHeaders](#brokerheaders).

- **Concept**: the pipeline-decides, transport-acts split is taught at [IBrokerTransport](#ibrokertransport); this is the PostgreSQL transport's half of it.

- **Walkthrough**
  - `ApplyAsync(store, message, disposition, cancellationToken)` (`PostgreSqlDispositionApplier.cs:25-48`) null-guards its three references (`:31-33`) and switches on the disposition (`:35`).
  - `Redeliver` calls `RedeliverAsync` with the redelivery delay and a copy of the row's headers in which `BrokerHeaders.RedeliveryCount` is set to the new count (`:37-44`).
  - `DeadLetter` calls `DeadLetterAsync` with the reason and detail (`:45`); anything else completes the row (`:46`).
  - The result is the store's: `false` means the lease had already been lost and another claim owns the row (`:22`).

- **Why it's built this way**: carrying the redelivery count in the row's headers is what lets the next delivery's pipeline know which redelivery interval comes next, since the row itself is re-used rather than re-published. Keeping the mapping in a static function makes every branch testable without a receiver.

- **Where it's used**: [PostgreSqlReceiver](#postgresqlreceiver) calls it after each pipeline run (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlReceiver.cs:230`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlDispositionApplierTests.cs`.

---

### PostgreSqlPublisher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlPublisher.cs:13` · Level 2 · class (internal sealed)

- **What it is**: the PostgreSQL transport's [IBrokerPublisher](#ibrokerpublisher): it ensures the schema exists when this host migrates at startup, then hands the message to the store's fan-out insert (`PostgreSqlPublisher.cs:13-27`).

- **Depends on**: [IPostgreSqlMessageStore](#ipostgresqlmessagestore), [IBrokerPublisher](#ibrokerpublisher), [OutgoingBrokerMessage](#outgoingbrokermessage).

- **Concept**: the publisher contract is taught at [IBrokerPublisher](#ibrokerpublisher).

- **Walkthrough**
  - Primary constructor over the store and a `migrateOnStartup` flag (`PostgreSqlPublisher.cs:13`).
  - `PublishAsync` (`:16-26`) null-guards the message, awaits `EnsureSchemaAsync` when `migrateOnStartup` is set (`:20-23`), then `store.PublishAsync` (`:25`).

- **Why it's built this way**: the outbox processor can publish before the hosted [PostgreSqlSchemaMigrator](#postgresqlschemamigrator) has finished, and the store's `EnsureSchemaAsync` runs the migration only once per process (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlMessageStore.cs:54-67`), so awaiting it here costs nothing after the first call and closes that startup race.

- **Where it's used**: registered as the singleton `IBrokerPublisher` by [PostgreSqlBrokerTransport](#postgresqlbrokertransport) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:73`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransportTests.cs` and `BrokerTransportRegistrationTests.cs` in the same test project.

---

### PostgreSqlSchemaMigrator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlSchemaMigrator.cs:12` · Level 2 · class (internal sealed)

- **What it is**: an `IHostedService` whose `StartAsync` is the store's `EnsureSchemaAsync` and whose `StopAsync` does nothing (`PostgreSqlSchemaMigrator.cs:12-19`).

- **Depends on**: [IPostgreSqlMessageStore](#ipostgresqlmessagestore); `Microsoft.Extensions.Hosting.IHostedService`.

- **Concept**: `[Rubric §17, DevOps]`: the schema is created by the application at startup, with an opt-out at [PostgreSqlTransportSettings](#postgresqltransportsettings) for a host without the rights.

- **Walkthrough**
  - `StartAsync` (`PostgreSqlSchemaMigrator.cs:15`) returns `store.EnsureSchemaAsync(cancellationToken)`; `StopAsync` (`:18`) returns a completed task.

- **Why it's built this way**: hosted services start in registration order, and [PostgreSqlBrokerTransport](#postgresqlbrokertransport) registers this one before the receiver, so the migration finishes before the receiver starts claiming (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:75-79`).

- **Where it's used**: registered only when `MigrateOnStartup` is true (`PostgreSqlBrokerTransport.cs:76-79`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransportTests.cs`.

---

### PostgreSqlReceiverOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlReceiverOptions.cs:11` · Level 3 · record (internal sealed)

- **What it is**: the seven values [PostgreSqlReceiver](#postgresqlreceiver) runs with: concurrency, claim batch size, whether to migrate and whether to provision topology first, and the lease, renewal and poll intervals (`PostgreSqlReceiverOptions.cs:11-53`).

- **Depends on**: [MessageBusSettings](#messagebussettings), [BrokerTransportPolicies](#brokertransportpolicies).

- **Concept**: backpressure is taught at [BrokerTransportPolicies](#brokertransportpolicies); the lease model at [IPostgreSqlMessageStore](#ipostgresqlmessagestore).

- **Walkthrough**
  - Positional members (`PostgreSqlReceiverOptions.cs:12-18`).
  - `DefaultLease` is 60 seconds, "long enough to ride out a renewal missed to a database blip" (`:20-21`); `DefaultRenewInterval` is 20 seconds, a third of the lease, so one missed renewal does not lose the claim (`:23-24`); `DefaultPollInterval` is 5 seconds, the fallback when no notification arrives (`:26-27`).
  - `From(settings, migrateOnStartup)` (`:37-52`): concurrency is `MessageBus:ConcurrentMessageLimit`, else `Environment.ProcessorCount`, at least 1 (`:41`); the claim batch is `MessageBus:PrefetchCount`, else the concurrency, clamped to `[1, concurrency]` (`:42`); `ProvisionTopology` comes from the shared settings (`:48`), which default it to `true` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:84`).

- **Why it's built this way**: a batch larger than the concurrency would claim rows no worker can start, and their leases would tick while they wait, so the clamp keeps every claimed row immediately runnable. The three timings are not configuration keys; only a test adjusts them, through the internal constructor of [PostgreSqlBrokerTransport](#postgresqlbrokertransport).

- **Where it's used**: built in `PostgreSqlBrokerTransport.Register` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:86-87`) and passed to [PostgreSqlReceiver](#postgresqlreceiver). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlReceiverTests.cs`.

---

### PostgreSqlTransportSql

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlTransportSql.cs:24` · Level 3 · class (internal sealed partial)

- **What it is**: every SQL statement the PostgreSQL transport runs, built once per schema and role: the idempotent migration, subscribe, the fan-out publish, claim, the four settle statements, renew, next-due and `LISTEN`, plus the identifier validation that makes writing the schema and role names into SQL safe (`PostgreSqlTransportSql.cs:24-237`).

- **Depends on**: [BrokerNaming](#brokernaming) (to fit the notification channel name). BCL `GeneratedRegex`, `SHA256`, `BinaryPrimitives`.

- **Concept**: `[Rubric §8, Data Architecture]` applies to the three-table design: `subscriptions` binds topics to queues, `messages` holds one row per queue per publish with `visible_after` and the lease columns, and `dead_letters` keeps settled failures with a reason (`:206-234`). The claim uses `FOR UPDATE SKIP LOCKED` (`:67`), so competing receivers on several replicas take disjoint rows without blocking each other.

- **Walkthrough**
  - The constructor (`PostgreSqlTransportSql.cs:33-100`) validates the schema and role against `MessageBus:PostgreSql:Schema` and `:Role` (`:35-36`), derives `NotifyChannel` as `{schema}_messages` fitted to `MaxIdentifierLength` 63 (`:27`, `:40`), and builds each statement.
  - `Publish` (`:50-57`) inserts one `messages` row per subscribed queue in one statement and calls `pg_notify` once per distinct queue with the queue name as payload (`:57`).
  - `Claim` (`:59-72`) selects due rows (`visible_after <= now()` and no live lock), oldest first, `LIMIT @limit FOR UPDATE SKIP LOCKED`, then stamps `lock_token`, `locked_until = now() + @lease` and increments `delivery_count` (`:69`).
  - `Complete`, `Redeliver`, `DeadLetter` and `Release` (`:74-88`) all match `WHERE id = @id AND lock_token = @lock_token`, which is what makes a lost lease a no-op. `Redeliver` pushes `visible_after` out by `@delay` and replaces the headers (`:76-79`); `DeadLetter` moves the row in one `DELETE ... RETURNING` into `INSERT` (`:81-86`).
  - `Renew` (`:90-93`) extends every `(id, lock_token)` pair passed as arrays; `NextDue` (`:95-97`) returns seconds until the earliest claimable row.
  - `ValidateIdentifier` (`:159-166`) throws `InvalidOperationException` naming the key unless the value matches `^[A-Za-z_][A-Za-z0-9_]{0,62}$` (`:144`); `Quote` (`:150`) double-quotes it.
  - `BuildMigrate` (`:185-236`) takes a transaction-scoped advisory lock keyed by `MigrationLockKey` (the first eight bytes of a SHA-256 of `mmca-broker-transport:` plus the schema, `:174-175`, `:193`), creates the role if missing and grants it to the current user (`:194-203`), creates the schema owned by the role (`:204`), then `SET LOCAL ROLE` so the tables and indexes are created as, and owned by, the role (`:205-235`).

- **Why it's built this way**: the schema and role are identifiers, which cannot be passed as parameters, so they are validated to a plain-identifier pattern and quoted, and every value is a parameter; that is the justification the store records on its CA2100 suppressions (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlMessageStore.cs:18-19`). The advisory lock serializes replicas migrating the same schema at once, and owning the tables through a shared role lets each service's own database user use them once it is a member.

- **Where it's used**: constructed by `PostgreSqlBrokerTransport.Register` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:68`) and handed to [PostgreSqlMessageStore](#postgresqlmessagestore). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlTransportSqlTests.cs`.

- **Caveats / not-in-source**: the migration only creates; nothing in source drops or alters the transport tables, so a later column change would need its own migration step.

---

### BrokerTransportContext

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportContext.cs:11` · Level 4 · class (public sealed)

- **What it is**: the parameter object every [IBrokerTransport](#ibrokertransport) receives: the bound `MessageBus` section, the resolved broker connection string (or null), the application configuration for any transport-specific keys, and the [BrokerTopology](#brokertopology) this host consumes (`BrokerTransportContext.cs:11-52`).

- **Depends on**: [MessageBusSettings](#messagebussettings), [BrokerTopology](#brokertopology) and `Microsoft.Extensions.Configuration.IConfiguration`.

- **Concept**: `[Rubric §1, SOLID]` assesses whether a contract can grow without breaking its implementers. Bundling the inputs into one class keeps `IBrokerTransport.Register` at two parameters, so the framework can hand transports more context (as it did with `Topology`) without changing a signature that adapter packages implement. The transport abstraction itself is taught at [IBrokerTransport](#ibrokertransport).

- **Walkthrough**
  - The constructor (`BrokerTransportContext.cs:18-32`) null-guards `settings`, `configuration` and `topology` (`:24-26`) but deliberately not `connectionString`, which is nullable.
  - `Topology` (`:38`) is the queue this host receives on and the topics bound to it; its doc notes it is also registered as a singleton so a hosted receiver can take it from DI (`:34-37`).
  - `Settings` (`:41`) and `Configuration` (`:51`) are get-only.
  - `ConnectionString` (`:48`) is resolved, per its doc, from `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq`, then `ConnectionStrings:messaging`; null means "none is set", and the transport then keeps its own default host (`:43-47`).

- **Why it's built this way**: the null connection string is a meaningful value, not an error: a transport with a default host can fall back to it, while [PostgreSqlBrokerTransport](#postgresqlbrokertransport) rejects it because a PostgreSQL broker has no default host. The context carries the value and leaves that policy to each transport.

- **Where it's used**: built once at the end of `AddBrokerMessaging`, after the topology and the receive pipeline are registered, with the connection string from `ResolveBrokerConnectionString`, and passed to the selected transport's `Register` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:150-158`, `:293`). Read by both built-in transports and by the adapter transports [AzureServiceBusTransport](group-28-common-cloud-provider-adapters.md#azureservicebustransport) and [AmazonSqsTransport](group-28-common-cloud-provider-adapters.md#amazonsqstransport); constructed directly in `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/BrokerTransportRegistrationTests.cs`.

---

### PostgreSqlMessageStore

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlMessageStore.cs:16` · Level 4 · class (internal sealed)

- **What it is**: the Npgsql implementation of [IPostgreSqlMessageStore](#ipostgresqlmessagestore): it runs the [PostgreSqlTransportSql](#postgresqltransportsql) statements on an `NpgsqlDataSource`, serializes headers as `jsonb`, and owns the once-per-process migration (`PostgreSqlMessageStore.cs:16-301`).

- **Depends on**: [IPostgreSqlMessageStore](#ipostgresqlmessagestore), [PostgreSqlTransportSql](#postgresqltransportsql), [PostgreSqlClaimedMessage](#postgresqlclaimedmessage), [OutgoingBrokerMessage](#outgoingbrokermessage); Npgsql (`NpgsqlDataSource`, `NpgsqlDbType.Jsonb`), `System.Text.Json`.

- **Concept**: the leased-claim contract is taught at [IPostgreSqlMessageStore](#ipostgresqlmessagestore); this is its only production implementation.

- **Walkthrough**
  - The constructor (`PostgreSqlMessageStore.cs:31-39`) takes the data source, whether it owns it, and the statements. `DisposeAsync` and `Dispose` dispose the data source only when owned (`:247-262`).
  - `SerializeHeaders` and `DeserializeHeaders` (`:44-51`) map headers to and from a JSON object, read back with an ordinal comparer.
  - `EnsureSchemaAsync` (`:54-67`) starts `MigrateAsync` under a lock when no attempt exists or the last one faulted or was canceled (`:58-63`), and returns `WaitAsync(cancellationToken)` (`:65`), so a caller that gives up does not cancel the migration another caller awaits. `MigrateAsync` runs the migration in one transaction (`:265-282`).
  - `PublishAsync` (`:84-98`) binds topic, message id, `jsonb` headers, body and the notify channel (`:91-95`).
  - `ClaimAsync` (`:101-133`) generates one lock token for the batch (`:103`), reads each returned row into a [PostgreSqlClaimedMessage](#postgresqlclaimedmessage), and sorts by `Id` because `RETURNING` order is unspecified (`:130-131`).
  - `CompleteAsync`, `RedeliverAsync`, `DeadLetterAsync` and `ReleaseAsync` (`:136-173`) share `SettleAsync` (`:284-300`), which binds `id` and `lock_token` and reports success as "more than zero rows affected" (`:298`).
  - `RenewAsync` (`:176-192`) returns early for an empty set (`:179-182`) and otherwise renews all rows in one statement.
  - `ListenAsync` (`:208-244`) opens a dedicated connection, forwards notifications whose payload equals the queue (`:215-221`), issues `LISTEN`, calls `notified` once because anything published before `LISTEN` took effect raised no notification (`:229-230`), then waits on the connection until canceled (`:232-243`).

- **Why it's built this way**: borrowing a shared data source (`ownsDataSource: false`) lets a host's PostgreSQL authentication customization reach the broker connection, the migration included, while a store that created its own data source still cleans it up.

- **Where it's used**: registered as a singleton by [PostgreSqlBrokerTransport](#postgresqlbrokertransport) through `CreateStore` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:72`, `:103-109`) and resolved by the publisher, migrator and receiver. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlMessageStoreTests.cs` and, against a real server, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/PostgreSqlLeaseRenewalTests.cs`.

---

### PostgreSqlReceiver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlReceiver.cs:23` · Level 4 · class (internal sealed partial)

- **What it is**: the PostgreSQL transport's hosted receiver: a `BackgroundService` that claims due rows of this host's queue up to a concurrency limit, runs each through the framework [IBrokerReceivePipeline](#ibrokerreceivepipeline), applies the returned disposition, renews leases of in-flight rows, and wakes on `LISTEN` notifications with polling as the fallback (`PostgreSqlReceiver.cs:23-372`).

- **Depends on**: [BrokerTopology](#brokertopology), [IBrokerReceivePipeline](#ibrokerreceivepipeline), [IPostgreSqlMessageStore](#ipostgresqlmessagestore), [PostgreSqlReceiverOptions](#postgresqlreceiveroptions), [PostgreSqlDispositionApplier](#postgresqldispositionapplier), [IncomingBrokerMessage](#incomingbrokermessage).

- **Concept**: `[Rubric §29, Resilience and Business Continuity]`: every step that touches the database is wrapped so a failure is logged and retried after `RetryDelay` (5 seconds, `PostgreSqlReceiver.cs:26`) rather than ending the service, and a row that cannot be settled is released or left for its lease to expire, never lost.

- **Walkthrough**
  - State: a `SemaphoreSlim` sized to `Concurrency` (`:67`), an in-flight map by row id (`:40`), and a one-slot wake channel that drops extra writes (`:41`).
  - `ExecuteAsync` (`:78-101`) runs `PrepareAsync`, starts the listen and renew loops (`:85-86`), runs the receive loop, and on stop drains in-flight rows for up to `DrainTimeout` 10 seconds (`:32`, `:99`, `:347-356`).
  - `PrepareAsync` (`:117-152`) ensures the schema when `MigrateOnStartup` (`:123-126`) and subscribes the queue to the distinct topics of the topology when `ProvisionTopology` (`:128-134`), retrying on failure (`:142-150`).
  - `ReceiveLoopAsync` (`:154-199`) waits for one free slot, takes up to `ClaimBatchSize` more without waiting (`:158-163`), claims that many rows (`:168`), returns unused slots (`:183-186`), starts one task per row (`:188-192`), and waits for work when nothing was claimed (`:194-197`).
  - `ProcessAsync` (`:221-244`) builds an [IncomingBrokerMessage](#incomingbrokermessage) with the row id as its transport id (`:223`), runs the pipeline (`:226`), and applies the disposition with `CancellationToken.None` so a decided outcome is written even while the host stops (`:228-230`). A lost lease is logged (`:232`); a cancellation or settle failure releases the claim (`:237`, `:241-242`), and a failed release leaves the lease to expire (`:246-257`).
  - `WaitForWorkAsync` (`:259-290`) sleeps until the sooner of `PollInterval` and the queue's next due row, never less than 100 ms (`:29`, `:264-277`), and wakes early on a notification (`:283`).
  - `ListenLoopAsync` (`:292-316`) keeps a `LISTEN` open and restarts it after a failure; polling keeps the queue moving meanwhile (`:307`). `RenewLoopAsync` (`:318-345`) renews every in-flight lease each `RenewInterval`.

- **Why it's built this way**: claiming only as many rows as there are free workers keeps every lease running against work that is actually executing, and notification plus polling bounds the latency of a publish to near zero while surviving a dropped listener. Settling outside the host's token avoids reprocessing a message whose handler already succeeded.

- **Where it's used**: registered as a hosted service by [PostgreSqlBrokerTransport](#postgresqlbrokertransport) only when the topology has subscriptions (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:81-93`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlReceiverTests.cs`.

- **Caveats / not-in-source**: the drain waits at most 10 seconds (`:32`); a handler still running after that settles after the receiver is disposed, and its slot release is swallowed (`:207-218`).

---

### IBrokerTransport

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:22` · Level 5 · interface

- **What it is**: the extension point a broker transport implements: a provider `Name` that `MessageBus:Provider` selects it by, the longest redelivery delay its broker can schedule, and one `Register` call that adds its publisher and hosted receiver (`IBrokerTransport.cs:22-52`).

- **Depends on**: [BrokerTransportContext](#brokertransportcontext) and `Microsoft.Extensions.DependencyInjection.IServiceCollection`.

- **Concept introduced, a pluggable transport behind a name.** `[Rubric §2, Design Patterns]` assesses whether a variation point is expressed as a strategy rather than a switch statement, and `[Rubric §32, Dependency and Supply-Chain]` assesses whether optional vendor dependencies stay out of the core. The boundary is narrow by design: `AddBrokerMessaging` owns everything that is the same on every broker (topology, wire format, the receive pipeline with origin restore, inbox, retry, redelivery and dead-letter decisions, the outbox-only publish path, tracing), and a transport only moves bytes: it publishes an [OutgoingBrokerMessage](#outgoingbrokermessage) to a topic, delivers each message on the host's queue to [IBrokerReceivePipeline](#ibrokerreceivepipeline), and carries out the [BrokerDisposition](#brokerdisposition) the pipeline returns (`:8-14`). The core ships RabbitMQ and PostgreSQL; a cloud broker is an adapter package with one registration method, so the core packages never reference a vendor SDK (`:17-19`). Application code never sees which transport won: it publishes through [IMessageBus](group-04-events-outbox.md#imessagebus) ([ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html), [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html), [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)).

- **Walkthrough**
  - `Name` (`IBrokerTransport.cs:28`) is compared case-insensitively against `MessageBus:Provider` and is meant to be stable and vendor-shaped, for example `AzureServiceBus` (`:24-27`).
  - `MaxRedeliveryDelay` (`:35`) is the broker's delay cap, or null for none; the receive pipeline clamps every redelivery interval to it (Amazon SQS caps a delay at 15 minutes, `:30-34`).
  - `Register(services, context)` (`:51`) adds a singleton [IBrokerPublisher](#ibrokerpublisher) and a hosted receiver for `context.Topology`'s queue; with `ProvisionTopology` set, the receiver creates topics, queue and bindings idempotently before receiving and the publisher creates a missing topic on first publish (`:37-43`). It runs while `AddBrokerMessaging` runs, so a missing namespace or connection string throws at startup rather than at the first publish (`:44-47`).

- **Why it's built this way**: making the transport an instance with a name, rather than an enum the core switches on, is what lets a new broker ship without a core release, and what keeps the core free of every cloud SDK. Keeping retry and dead-letter decisions in the shared pipeline means a new transport cannot get them wrong.

- **Where it's used**: `AddBrokerTransport` rejects a blank `Name` and registers the instance with `TryAddEnumerable` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:174-183`). `ResolveBrokerTransport` (`:199`) returns a built-in for `RabbitMq` or `PostgreSql` (`:201-208`), otherwise a registered instance whose name matches, read off the service collection because the choice is made before any provider exists (`:213`); with no match it throws an `InvalidOperationException` naming the available providers and the remedy (`:225-230`). `AddBrokerMessaging` resolves the transport before registering anything (`:82-84`), passes its `MaxRedeliveryDelay` to [BrokerReceivePipeline](#brokerreceivepipeline) (`:108-115`), and calls `Register` last (`:150-158`). Implemented by [RabbitMqBrokerTransport](#rabbitmqbrokertransport), [PostgreSqlBrokerTransport](#postgresqlbrokertransport), [AzureServiceBusTransport](group-28-common-cloud-provider-adapters.md#azureservicebustransport) and [AmazonSqsTransport](group-28-common-cloud-provider-adapters.md#amazonsqstransport); registration behavior covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/BrokerTransportRegistrationTests.cs`.

- **Caveats / not-in-source**: only `ImplementationInstance` registrations are seen (`DependencyInjection.Messaging.cs:213`), so a transport registered by type or factory rather than through `AddBrokerTransport` is not found.

---

### PostgreSqlBrokerTransport

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:36` · Level 6 · class (internal sealed)

- **What it is**: the built-in [IBrokerTransport](#ibrokertransport) for `MessageBus:Provider = PostgreSql`: topics, queues and delayed redeliveries kept in three tables of one PostgreSQL database, written on Npgsql, so any PostgreSQL (Cloud SQL, Amazon RDS, Azure Database for PostgreSQL, a container) is the broker (`PostgreSqlBrokerTransport.cs:10-36`).

- **Depends on**: [IBrokerTransport](#ibrokertransport), [BrokerTransportContext](#brokertransportcontext), [PostgreSqlTransportSettings](#postgresqltransportsettings), [PostgreSqlTransportSql](#postgresqltransportsql), [PostgreSqlMessageStore](#postgresqlmessagestore), [PostgreSqlPublisher](#postgresqlpublisher), [PostgreSqlSchemaMigrator](#postgresqlschemamigrator), [PostgreSqlReceiver](#postgresqlreceiver), [PostgreSqlReceiverOptions](#postgresqlreceiveroptions), [MessageBusProviders](#messagebusproviders), [NpgsqlDataSources](group-07-persistence-ef-core.md#npgsqldatasources); Npgsql.

- **Concept**: the transport strategy is taught at [IBrokerTransport](#ibrokertransport). What is particular here is `[Rubric §7, Microservices Readiness]` without a broker service: a database is the broker, which is why this transport is core rather than an adapter ([ADR-113](https://ivanball.github.io/docs/adr/113-postgresql-as-a-first-class-engine.html), [ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)). A publish inserts one row per subscribed queue and wakes receivers with `pg_notify`; a receiver claims with `FOR UPDATE SKIP LOCKED` under a renewed lease; a redelivery pushes `visible_after` out, so there is no delay cap; a dead letter moves the row to `{schema}.dead_letters` (`:16-22`). `[Rubric §17, DevOps]` applies to the hosted-service ordering below.

- **Walkthrough**
  - `Name` returns `MessageBusProviders.PostgreSql` (`PostgreSqlBrokerTransport.cs:55`); `MaxRedeliveryDelay` is null (`:58`).
  - A public parameterless constructor (`:41-43`) and an internal one taking a function that adjusts the resolved [PostgreSqlReceiverOptions](#postgresqlreceiveroptions), which exists only so a test can shorten the lease, renewal and poll interval (`:45-52`).
  - `Register(services, context)` (`:61-94`) fails a missing connection string first (`:66`), reads [PostgreSqlTransportSettings](#postgresqltransportsettings) (`:67`), builds [PostgreSqlTransportSql](#postgresqltransportsql) from the effective schema and role (`:68`), and registers the store singleton (`:72`) and the [PostgreSqlPublisher](#postgresqlpublisher) as `IBrokerPublisher` (`:73`). When `MigrateOnStartup` holds it adds [PostgreSqlSchemaMigrator](#postgresqlschemamigrator) (`:76-79`). With no subscriptions it stops there, a publish-only host (`:81-84`); otherwise it resolves the receiver options (`:86-87`) and adds the [PostgreSqlReceiver](#postgresqlreceiver) hosted service (`:88-93`).
  - `ReadSettings` (`:99-101`) binds `MessageBus:PostgreSql`, defaulting when the section is absent.
  - `CreateStore` (`:103-109`) asks `NpgsqlDataSources.Resolve` for a shared data source for the connection string; with one the store borrows it (`:107`), without one it creates and owns its own (`:108`).
  - `RequireConnectionString` (`:111-117`) throws an `InvalidOperationException` telling the operator to set `MessageBus:ConnectionString` (or `ConnectionStrings:messaging`), because unlike RabbitMQ there is no default host (`:113-116`).

- **Why it's built this way**: hosted services start in registration order, so registering the migrator before the receiver guarantees the schema exists before the first claim (`:75`). Resolving a shared data source means a host that registers an `INpgsqlDataSourceConfigurator` (an RDS, Cloud SQL or Entra token provider) runs the transport, migration included, on the same authenticated `NpgsqlDataSource` its PostgreSQL contexts use (`:30-33`).

- **Where it's used**: instantiated by `ResolveBrokerTransport` when the provider is `PostgreSql` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:206-208`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/PostgreSql/PostgreSqlBrokerTransportTests.cs` and, against a real server, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/PostgreSqlBrokerTransportTests.cs`.

- **Caveats / not-in-source**: the startup migration needs rights to create a role and a schema; a host without them sets `MigrateOnStartup` to false and relies on another host or a deployment step to run the idempotent DDL (see [PostgreSqlTransportSettings](#postgresqltransportsettings)). Because `MaxRedeliveryDelay` is null (`:58`), every configured redelivery interval runs unclamped.

---

### IRabbitMqOperations

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/IRabbitMqOperations.cs:9` · Level 0 · interface (internal)

- **What it is**: the five broker calls the RabbitMQ transport makes outside its consume loop: declare a fanout exchange, declare a queue, check a queue exists, bind a queue to an exchange, and publish a confirmed message (`IRabbitMqOperations.cs:9-55`). The interface doc names [RabbitMqChannelOperations](#rabbitmqchanneloperations) as its one real implementation (`IRabbitMqOperations.cs:3-8`).

- **Depends on**: nothing first-party. The signatures use BCL types only (`IDictionary<string, object?>` for declaration arguments, `ReadOnlyMemory<byte>` for the body, `IReadOnlyDictionary<string, string>` for headers), so the RabbitMQ.Client types stay behind the implementation.

- **Concept introduced, a test boundary around a broker client.** `[Rubric §14, Testability]` assesses whether the logic worth testing can run without its infrastructure. The naming, provisioning and disposition rules of this transport are pure decisions about which entity to declare and which queue a copy goes to; the interface doc says it exists so those rules are "testable without a broker" (`IRabbitMqOperations.cs:4-6`). [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqDispositionApplier](#rabbitmqdispositionapplier) and [RabbitMqPublisher](#rabbitmqpublisher) take this interface rather than a channel, and the test project supplies a recording fake (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RecordingRabbitMqOperations.cs`). The consume loop itself is not behind it: [RabbitMqReceiver](#rabbitmqreceiver) talks to its consume channel directly.

- **Walkthrough**
  - `DeclareFanoutExchangeAsync(exchange)` (`IRabbitMqOperations.cs:15`): durable fanout exchange, idempotent.
  - `DeclareQueueAsync(queue, arguments)` (`:22`): durable queue, idempotent for identical arguments.
  - `EnsureQueueExistsAsync(queue)` (`:28`): a passive declaration that throws when the queue is missing.
  - `BindQueueAsync(queue, exchange)` (`:35`): binds a queue to a fanout exchange.
  - `PublishAsync(exchange, routingKey, mandatory, body, headers)` (`:48-54`): a persistent publish that completes only on the broker's confirm, throwing on a nack or, with `mandatory`, on an unroutable message (`:37-39`). `""` is the default exchange, where the routing key is a queue name (`:41-42`).

- **Why it's built this way**: every operation the transport needs before acknowledging a delivery is a confirmed, awaited call, so a fake that records the calls is enough to prove the ordering and the arguments.

- **Where it's used**: implemented by [RabbitMqChannelOperations](#rabbitmqchanneloperations); consumed by [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqPublisher](#rabbitmqpublisher) and [RabbitMqDispositionApplier](#rabbitmqdispositionapplier).

---

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:13` · Level 0 · class (public static)

- **What it is**: the pure helper that builds the two platform-native JSON payloads for OS-level push: the FCM v1 message for Android and the APNs alert for iOS (`NativePushPayloads.cs:13-68`). It holds no state and references no vendor SDK, which is why the payload shapes can be asserted in a unit test and shared by every cloud adapter.

- **Depends on**: `System.Text.Json` for serialization. No first-party service types at all.

- **Concept introduced, the third notification channel's wire contract.** `[Rubric §9, API and Contract Design]` assesses whether the shape of a message crossing a boundary is defined in one place rather than assembled ad hoc at each call site, and `[Rubric §14, Testability]` assesses whether the parts worth testing can be tested without their infrastructure. The framework already carries a durable per-user notification inbox and a transient SignalR push; native OS-level delivery ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) is the third, and it is the only one whose payload is dictated by an external vendor. FCM v1 wants a `message` envelope with a `notification` block; APNs wants a reserved `aps` block with an `alert` inside it and any application data as sibling top-level keys. The class doc (`NativePushPayloads.cs:5-12`) records how the adapters share that contract: Azure Notification Hubs forwards these payloads verbatim, SNS mobile push wraps them in its per-platform message structure, and the FCM adapter maps the same fields onto FirebaseAdmin's typed message with a test pinning the equivalence, so one notification looks the same on a device whichever cloud delivered it. `[Rubric §32, Dependency and Supply-Chain]` applies through the same doc: the helper is pure `System.Text.Json`, so the core package stays free of any push vendor SDK ([ADR-134](https://ivanball.github.io/docs/adr/134-cloud-neutral-core-vendor-adapters.html)).

- **Walkthrough**
  - `BuildFcmV1Payload(title, body, metadata)` (`NativePushPayloads.cs:20-35`) guards `title` and `body` against null (`:22-23`), builds `notification` from them (`:25-28`), attaches `data` only when the metadata dictionary is non-empty (`:29-32`), and serializes the whole thing under a `message` root (`:34`).
  - `BuildApnsPayload(title, body, metadata)` (`NativePushPayloads.cs:42-67`) applies the same null guards (`:44-45`), builds the `aps.alert` block (`:47-53`), then lifts each metadata pair to a **top-level** custom key, which is where APNs expects application data. The guard at `:58-62` is the interesting line: a metadata key literally named `aps` is skipped, because writing it would clobber the alert block and produce a notification the device shows as nothing.
  - User tags and audience chunking are not here. Those are Azure Notification Hubs concepts and live in the Azure adapter's [NativePushUserTags](group-28-common-cloud-provider-adapters.md#nativepushusertags).

- **Why it's built this way**: keeping this pure and public means the vendor payload shapes are covered by fast tests that need no notification hub, no credentials and no network, and every adapter package composes against one definition instead of carrying its own copy.

- **Where it's used**: [AzureNotificationHubNativePushSender](group-28-common-cloud-provider-adapters.md#azurenotificationhubnativepushsender) calls both builders for user-targeted sends (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/AzureNotificationHubNativePushSender.cs:35-36`) and for broadcasts (`:37-38`); [SnsPushMessage](group-28-common-cloud-provider-adapters.md#snspushmessage) calls both to fill its per-platform structure (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Notifications/SnsPushMessage.cs:29-30`). [FcmPushMessage](group-28-common-cloud-provider-adapters.md#fcmpushmessage) references the type without calling it, as the class doc describes. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Notifications/Push/NativePushPayloadsTests.cs`, with the FCM equivalence in `MMCA.Common/Tests/Hosting/MMCA.Common.Gcp.Tests/Notifications/FcmNativePushSenderTests.cs`.

- **Caveats / not-in-source**: the helper takes no options, so a host wanting a different payload shape replaces [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) rather than configuring this.

---

### RabbitMqConnectionSource

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqConnectionSource.cs:11` · Level 0 · class (internal sealed)

- **What it is**: one lazily opened RabbitMQ connection with automatic recovery (`RabbitMqConnectionSource.cs:11-115`). The publisher and the receiver each own one, so a publisher held up by broker flow control never stalls the consumer's acknowledgements (`RabbitMqConnectionSource.cs:5-9`).

- **Depends on**: RabbitMQ.Client's `ConnectionFactory` and `IConnection`; a `SemaphoreSlim` (`:14`).

- **Concept introduced, deferred connection opening.** `[Rubric §13, Observability & Operability]` assesses how a service behaves when a dependency is down. Opening is deferred to the first use, so a host whose broker is unreachable still starts and the outbox keeps what it cannot publish; a failed open is not cached, so the next call tries again (`RabbitMqConnectionSource.cs:5-7`). Recovery after the connection exists is delegated to the client.

- **Walkthrough**
  - The constructor (`RabbitMqConnectionSource.cs:21-22`) only builds the factory; nothing touches the network.
  - `CreateFactory` (`:31-47`) turns on `AutomaticRecoveryEnabled` and `TopologyRecoveryEnabled` with a 5-second `NetworkRecoveryInterval` (`:35-37`), sets the `ClientProvidedName` shown in the management UI, and applies the URI only when one is given (`:41-44`); with none the client's default `amqp://guest:guest@localhost:5672` applies (`:19`).
  - `GetConnectionAsync` (`:52-72`) returns the cached connection without locking (`:56-59`), otherwise takes the gate (`:61`) and opens with `??=` (`:65`), so concurrent first callers share one open. An exception escapes before assignment, which is why a failed open is retried.
  - `DisposeAsync` (`:75-98`) closes with a handshake and swallows a close failure on a connection the broker already dropped (`:87-92`); the synchronous `Dispose` (`:104-114`) drops the connection without the handshake. Both are idempotent through `_disposed`.

- **Why it's built this way**: one connection per role isolates publishing from consuming, and automatic topology recovery means a broker restart re-opens the connection, its channels and the consumer without transport code (`:24-26`).

- **Where it's used**: [RabbitMqBrokerTransport](#rabbitmqbrokertransport) creates one named `{queue} (publish)` for the publisher and one named `{queue} (receive)` for the receiver (`RabbitMqBrokerTransport.cs:43`, `:56`); [RabbitMqChannelOperations](#rabbitmqchanneloperations) and [RabbitMqReceiver](#rabbitmqreceiver) open channels on it.

---

### RabbitMqHeaders

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqHeaders.cs:11` · Level 0 · class (internal static)

- **What it is**: the converter between the framework's string-to-string headers and AMQP header tables (`RabbitMqHeaders.cs:11-72`).

- **Depends on**: BCL only (`Encoding.UTF8`, `CultureInfo.InvariantCulture`). The keys it carries are defined by [BrokerHeaders](#brokerheaders).

- **Concept**: the transport-neutral header contract is taught at [BrokerHeaders](#brokerheaders); this is the RabbitMQ encoding of it.

- **Walkthrough**
  - `Encode` (`RabbitMqHeaders.cs:19-30`) copies every pair into an ordinal dictionary as a string value (`:24-27`). Every value goes over the wire as an AMQP long string (`:5-8`).
  - `Decode` (`:40-71`) is the reverse, and is wider because the client hands a long string back as UTF-8 bytes. Byte arrays decode as UTF-8, strings pass through, booleans become `"true"`/`"false"`, other `IFormattable` values format invariantly, and anything else is dropped (`:55-62`). A key with the `x-` prefix (`:14`) is skipped (`:50-53`): those are headers RabbitMQ stamps itself, such as the `x-death` table a delay queue adds, so a redelivered copy never accumulates them (`:33-36`).

- **Why it's built this way**: dropping broker headers on read matters because [RabbitMqDispositionApplier](#rabbitmqdispositionapplier) republishes a copy built from the decoded headers; without the filter each trip through a delay queue would carry a growing `x-death` history.

- **Where it's used**: `Encode` by [RabbitMqChannelOperations](#rabbitmqchanneloperations) (`RabbitMqChannelOperations.cs:67`); `Decode` by [RabbitMqReceiver](#rabbitmqreceiver) (`RabbitMqReceiver.cs:209`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqHeadersTests.cs`.

---

### PushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:8` · Level 1 · class (sealed)

- **What it is**: the `PushNotifications` section: the on switch, the SignalR hub path, the
  regular expression a channel key must match before a client may join or leave a channel, and the
  per-user cap on simultaneous hub connections (`PushNotificationSettings.cs:8-66`).

- **Depends on**: `NotificationScopeKey` from `MMCA.Common.Shared.Notifications` (`:1`), for the
  `Pattern` constant that supplies the default. See
  [NotificationScopeKey](group-10-notifications.md#notificationscopekey). No externals beyond a single
  `[Range(0, 10_000)]` data annotation on `MaxConnectionsPerUser` (`PushNotificationSettings.cs:49`),
  which is what `ValidateDataAnnotations()` checks at startup.

- **Concept introduced: allow-listing client-supplied group names.** `[Rubric §11, Security]` and
  `[Rubric §26, Front-End Security]` both apply. A hub method that takes a channel key and calls
  `Groups.AddToGroupAsync` is joining a SignalR group named by the CLIENT. With no constraint, a
  caller could join any group the server publishes to and receive another event's or another
  session's traffic. `ChannelKeyPattern` is that constraint (`PushNotificationSettings.cs:27-37`).

  `[Rubric §15, Best Practices & Code Quality]` shows up in where the default comes from. The property does not
  hard-code a regex: it defaults to `NotificationScopeKey.Pattern`
  (`PushNotificationSettings.cs:37`, the constant `"^(event|session):[0-9]+$"` at
  `NotificationScopeKey.cs:32`), the SAME constant the producers `NotificationScopeKey.ForEvent` and
  `ForSession` format against (`NotificationScopeKey.cs:44`, `:43`). Producer and guard therefore
  cannot drift apart by editing one of them; a host that overrides the pattern from configuration
  takes that alignment on itself, which the doc says outright (`PushNotificationSettings.cs:33-34`).

  `[Rubric §11, Security]` also covers `MaxConnectionsPerUser`: an `[Authorize]` hub without a
  connection cap lets one authenticated user open unbounded WebSockets and exhaust the replica,
  denying live notifications to everyone else (`PushNotificationSettings.cs:39-50`). `0` opts a
  host back out of the cap entirely.

- **Walkthrough**: one static field and five `init` properties.
  - `SectionName = "PushNotifications"` (`PushNotificationSettings.cs:11`).
  - `Enabled` (`:14`): plain `bool`, default `false`.
  - `HubPath` (`:25`): defaults to `"/hubs/notifications"`. Its doc comment (`:16-24`) carries two
    couplings. The JWT bearer handlers accept the query-string `access_token` on this path (and
    under `/hubs`), and a host that moves the hub elsewhere must also set
    `RateLimiting:HubPathPrefixes`, which the rate limiter reads separately. And the shipped client,
    `NotificationHubService` in MMCA.Common.UI, connects at the default `/hubs/notifications` with no
    setting to follow a move, so changing this path also means changing the client, the gateway
    route, `RateLimiting:HubPathPrefixes` and the same-origin proxy exemption.
  - `ChannelKeyPattern` (`:37`). Enforcement lives in
    [NotificationHub](group-10-notifications.md#notificationhub): `EnsureValidChannelKey`
    (`NotificationHub.cs:174-184`) pulls a `Regex` out of a static `ConcurrentDictionary` cache keyed
    on the pattern string (`:176-178`, the cache declared at `:47`) and throws
    `HubException("Invalid channel key.")` on an empty or non-matching key (`:180-183`); both
    `JoinChannelAsync` (`:130`) and `LeaveChannelAsync` (`:147`) call it before touching `Groups`.
    The compiled regex carries a one-second match timeout (`NotificationHub.cs:44`, `:178`), so a
    pathological configured pattern cannot hang the connection, and the cache means join and leave
    do not recompile per call (`:46`).
  - `MaxConnectionsPerUser` (`:50`): `[Range(0, 10_000)]` (`:49`), default `20`; `0` disables the cap
    (`PushNotificationSettings.cs:39-42`). Tagged SEC-ADC-25 in the remarks: the hub is
    `[Authorize]` but had no `OnConnectedAsync` override, so a single valid user token could open
    unbounded WebSockets and exhaust the replica, stopping live notifications for everyone
    (`:43-48`).
  - `CloseConnectionsOnTokenExpiry` (`:65`): plain `bool`, default `false` (`:51-54`). A hub
    connection is authenticated once, when it opens, so without this a user who is locked, loses a
    role or signs out everywhere keeps receiving pushes until the connection drops. With it on, the
    connection ends with its access token; the shipped client reconnects with a fresh token, so a
    signed-in user sees one reconnect per token lifetime and a revoked user is refused. The cut-off is
    bounded by `Jwt:AccessTokenExpirationMinutes`, not immediate, and it needs no sticky ingress
    because each replica enforces it on the connections it holds (`:55-64`). `[Rubric §11, Security]`
    applies: this is the setting that bounds how long a revoked identity keeps a live channel.

- **Why it's built this way**: a configurable pattern rather than a hard-coded one lets each
  application define its own channel taxonomy without forking the hub, while the shipped default is
  restrictive rather than permissive. Sourcing that default from the producer's own constant is the
  cheaper half of the same idea: the safe configuration is also the zero-configuration one.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddPushNotifications` (`MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:43-46`), which then registers SignalR (`:45`),
  adds the Redis backplane when a `redis` connection string is present (`:47-48`, `:57`), and replaces
  the null implementations with
  [SignalRPushNotificationSender](group-10-notifications.md#signalrpushnotificationsender) and
  [SignalRLiveChannelPublisher](group-10-notifications.md#signalrlivechannelpublisher)
  (`:62-63`). The settings object itself is injected as `IOptions<PushNotificationSettings>`
  (`NotificationHub.cs:26`) and read by [NotificationHub](group-10-notifications.md#notificationhub)
  in two places: `EnsureValidChannelKey` (`:177`) and `OnConnectedAsync` (`:61-81`), which reads
  `MaxConnectionsPerUser` into `cap` (`:63`), tracks a static `ConnectionsPerUser` count keyed by
  `Context.UserIdentifier` (`:58`), and throws `HubException("Too many concurrent connections for
  this account.")` when a new connection would push the count over `cap` (`:68-75`); the rejected
  connection's slot is given back immediately so an aborted connection cannot lock the user out once
  it drains (`:71-73`). The cap is skipped when `cap <= 0` or the identifier is empty (`:66`).
  `MapNotificationHub` reads the settings to map the hub at `HubPath` only when `Enabled` is true, and
  passes `CloseConnectionsOnTokenExpiry` to SignalR's `CloseOnAuthenticationExpiration`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:24-34`). The
  default pattern is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/PushNotificationSettingsTests.cs:15-17` and an
  override by `:26`, `:31`; the connection cap itself is covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Hubs/NotificationHubConnectionCapTests.cs`.

- **Caveats**: this class stands alone. There is no `IPushNotificationSettings` abstraction in the
  current source, so a consumer that wants the values takes the concrete options type.

---

### RabbitMqChannelOperations

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqChannelOperations.cs:12` · Level 1 · class (internal sealed)

- **What it is**: the real [IRabbitMqOperations](#irabbitmqoperations): one channel with publisher confirms on a [RabbitMqConnectionSource](#rabbitmqconnectionsource), with every call serialized on that channel (`RabbitMqChannelOperations.cs:12-171`).

- **Depends on**: [IRabbitMqOperations](#irabbitmqoperations), [RabbitMqConnectionSource](#rabbitmqconnectionsource), [RabbitMqHeaders](#rabbitmqheaders), [BrokerHeaders](#brokerheaders); RabbitMQ.Client's `IChannel`, `BasicProperties` and `CreateChannelOptions`.

- **Concept introduced, publisher confirms.** `[Rubric §10, Messaging & Integration]` assesses whether a message is known to be durable before the sender forgets it. A plain AMQP publish returns as soon as the bytes leave the client; a confirmed publish completes only when the broker has taken responsibility for the message. The channel is created with both `publisherConfirmationsEnabled` and `publisherConfirmationTrackingEnabled` (`RabbitMqChannelOperations.cs:166-168`), which makes `BasicPublishAsync` await the broker's ack and throw on a nack or a mandatory return (`:5-10`). That is what lets the outbox delete a row and the receiver acknowledge an original only after its copy is safe.

- **Walkthrough**
  - Fields (`RabbitMqChannelOperations.cs:14-18`): the connection source, whether this instance owns it, a `SemaphoreSlim(1, 1)` gate and the current channel. The constructor (`:23-29`) takes `ownsConnections`, which decides whether disposal cascades to the connection.
  - The four declaration methods (`:32-50`) map one-to-one onto the client: a durable, non-auto-delete fanout exchange (`:34`), a durable, non-exclusive queue with the caller's arguments (`:40`), `QueueDeclarePassiveAsync` for the existence check (`:45`) and a binding with an empty routing key (`:50`).
  - `PublishAsync` (`:54-75`) builds `BasicProperties` with `Persistent = true`, the encoded header table, and `ContentType` and `MessageId` lifted from the framework headers when present (`:64-70`).
  - `RunAsync` (`:134-148`) takes the gate, gets a channel and runs the operation, so calls never interleave on one channel. `GetChannelAsync` (`:150-170`) reuses an open channel (`:152-155`); a channel that exists but is closed was closed by the broker (a failed passive declaration or conflicting arguments does that), which automatic recovery does not repair, so it is discarded and replaced (`:157-163`).
  - `DisposeAsync` (`:78-97`) closes the channel quietly (`CloseQuietlyAsync`, `:117-132`) and disposes the connection only when owned (`:91-94`); `Dispose` (`:100-115`) is the synchronous twin.

- **Why it's built this way**: serializing calls on one confirmed channel keeps the confirm bookkeeping simple and the ordering of declarations deterministic; replacing a broker-closed channel on the next call turns a channel-level error into one failed operation rather than a dead publisher.

- **Where it's used**: [RabbitMqBrokerTransport](#rabbitmqbrokertransport) wraps the publisher's connection in one that owns it (`RabbitMqBrokerTransport.cs:43`); [RabbitMqReceiver](#rabbitmqreceiver) creates one that does not own its connection, for declarations and disposition copies (`RabbitMqReceiver.cs:69`).

---

### NullNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullNativePushSender.cs:12` · Level 3 · class (public sealed)

- **What it is**: the inert default for [INativePushSender](group-07-persistence-ef-core.md#inativepushsender). Its one member, `SendToUsersAsync`, returns [NativePushOutcome](group-07-persistence-ef-core.md#nativepushoutcome)`.None` and does nothing else (`NullNativePushSender.cs:12-17`).

- **Depends on**: [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) and [NativePushOutcome](group-07-persistence-ef-core.md#nativepushoutcome).

- **Concept introduced, the null-object default for an optional channel.** `[Rubric §1, SOLID]` assesses whether callers depend on abstractions rather than on the presence of a configured backend, and `[Rubric §15, Best Practices & Code Quality]` assesses whether the "not configured" case costs conditional code at every call site. The alternative to this class is an `INativePushSender?` that every handler null-checks, or a host that throws at resolution time when no hub is configured. Both push a deployment concern into application code. Registering a do-nothing implementation as the default means the third channel **always resolves**, the send handler is written once with no branch, and enabling native push in an environment is purely a configuration change. The same posture appears in [NullFileStorageService](#nullfilestorageservice), [NullPushDeviceRegistrar](#nullpushdeviceregistrar), and, outside this group, [NullPushNotificationSender](group-10-notifications.md#nullpushnotificationsender).

- **Walkthrough**: `SendToUsersAsync` (`NullNativePushSender.cs:15-16`) is an expression-bodied `Task.FromResult(NativePushOutcome.None)`, the outcome of a call that attempted nothing (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/NativePushOutcome.cs:11-12`). Returning an outcome rather than `Task.CompletedTask` keeps the caller's bookkeeping uniform: [SendPushNotificationHandler](group-10-notifications.md#sendpushnotificationhandler) records the per-platform outcome on the notification row, and null counts there mean "not attempted" (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:136-141`). There is no logging, deliberately: a per-notification "push was skipped" line in a host that never intends to enable the channel is noise, not signal.

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) records that the framework pipeline ships inert by default and each consumer switches it on through a vendor adapter. This class is that decision expressed in code, and the DI comment above its registration names the three adapters that replace it (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:373-376`).

- **Where it's used**: registered by `AddInfrastructure` through `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:377`), immediately alongside [NullPushDeviceRegistrar](#nullpushdeviceregistrar) (`:378`). Each adapter uses plain `AddTransient` for its pair, so the later registration wins: `AddAzureNotificationHubsPush` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:133-134`), `AddAmazonSnsPush` (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:194-195`) and `AddFirebaseCloudMessagingPush` (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:166-167`). [CloudAdapterTripwire](#cloudadaptertripwire) also tests for this type: it treats a resolved `NullNativePushSender` as "no push adapter registered" (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:78`).

- **Caveats / not-in-source**: because the swap is "last registration wins" rather than a removal, both descriptors remain in the collection when native push is enabled. Anything resolving `IEnumerable<INativePushSender>` would see the no-op as well as the real sender; no first-party code does.

---

### RabbitMqNames

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqNames.cs:19` · Level 3 · class (internal static)

- **What it is**: the RabbitMQ entity names and declaration arguments derived from the [BrokerTopology](#brokertopology) (`RabbitMqNames.cs:19-76`): one durable fanout exchange per topic, the host's durable queue, `{queue}-error` for dead letters and `{queue}-delay-{seconds}s` per redelivery interval (`RabbitMqNames.cs:5-17`).

- **Depends on**: [BrokerNaming](#brokernaming) (`Fit`), [BrokerTopology](#brokertopology); BCL only otherwise.

- **Concept introduced, delayed redelivery without a plugin.** `[Rubric §10, Messaging & Integration]` assesses whether retry and poison handling are designed rather than left to the broker's defaults. RabbitMQ has no native delayed delivery; the usual answer is the `rabbitmq_delayed_message_exchange` plugin. This transport instead declares one queue per delay interval whose `x-message-ttl` expires every message after the interval and dead-letters it through the default exchange (`""`) back to the host queue (`RabbitMqNames.cs:70-75`). Because every message in one delay queue has the same time to live, expiry at the head keeps them in order, and because the arguments are a pure function of the name, every host declares the queue identically and a repeated declaration is a no-op (`:60-66`).

- **Walkthrough**
  - `MaxNameLength = 255` (`RabbitMqNames.cs:22`), RabbitMQ's short-string limit; every name passes through `BrokerNaming.Fit` with it, so a publisher and a consumer in different hosts compute the same entity (`:5-7`).
  - `DeadLetterReasonHeader` and `DeadLetterDetailHeader` (`:25`, `:28`): `x-mmca-dead-letter-reason` and `x-mmca-dead-letter-detail`.
  - `Exchange(topic)`, `Queue(queueName)` and `ErrorQueue(queueName)` (`:33`, `:38`, `:43`).
  - `DelaySeconds(delay)` (`:51`) rounds up to whole seconds with a floor of one, so a sub-second delay still goes through a delay queue rather than straight back to the host queue.
  - `DelayQueue(queueName, delaySeconds)` (`:57-58`) and `DelayQueueArguments` (`:70-75`): TTL `delaySeconds * 1000`, dead-letter exchange `""`, dead-letter routing key the fitted host queue name.

- **Caveats / not-in-source**: the dead-letter headers start with `x-`, the prefix [RabbitMqHeaders](#rabbitmqheaders) drops on read, so a dead-lettered copy read back by a receiver would not surface them as framework headers; they are meant for an operator inspecting the error queue.

- **Where it's used**: [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqDispositionApplier](#rabbitmqdispositionapplier), [RabbitMqPublisher](#rabbitmqpublisher) and [RabbitMqReceiver](#rabbitmqreceiver). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqNamesTests.cs`.

---

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullPushDeviceRegistrar.cs:14` · Level 4 · class (public sealed)

- **What it is**: the inert default for [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar). It accepts and discards registrations so a client can call the Devices endpoints unconditionally; nothing is stored until a host enables native push (`NullPushDeviceRegistrar.cs:14-27`).

- **Depends on**: [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar), [DeviceInstallationRequest](group-10-notifications.md#deviceinstallationrequest), and [Result](group-01-result-error-handling.md#result).

- **Concept**: the null-object default introduced at [NullNativePushSender](#nullnativepushsender). Here all three operations return success (`NullPushDeviceRegistrar.cs:17-18`, `:21-22`, `:25-26`), which is the right choice for this contract specifically: a mobile client registers its device at startup as a matter of course, and failing that call in a host without a hub would surface as an error in an app whose user did nothing wrong. `[Rubric §9, API and Contract Design]` applies: the Devices endpoints keep the same response shape whether or not the channel is enabled, so no client needs a capability check.

- **Walkthrough**: `UpsertAsync` (`NullPushDeviceRegistrar.cs:17-18`), `DeleteAsync` (`:21-22`) and `DeleteAllForUserAsync` (`:25-26`) are all expression-bodied `Task.FromResult(Result.Success())`. `DeleteAllForUserAsync` is the account-deletion path: [DeleteUserPushInstallationsInternalCommandHandler](#deleteuserpushinstallationsinternalcommandhandler) calls it (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserPushInstallationsInternalCommandHandler.cs:31`), and with no adapter there is nothing stored to remove, so success is the truthful answer. There is no validation of the platform string here, unlike [AzureNotificationHubDeviceRegistrar](group-28-common-cloud-provider-adapters.md#azurenotificationhubdeviceregistrar), so a request that the real registrar would reject as an unsupported platform is accepted by this one.

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) ships the pipeline inert, and both halves of the channel (the sender and the registrar) have to be inert together, which is why they are registered as a pair (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:377-378`) and replaced as a pair by each vendor adapter (for example `MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:133-134`).

- **Where it's used**: registered by `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:378`) and resolved by [DevicesController](group-10-notifications.md#devicescontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:27`) in any host that has not registered a push adapter (`AddAzureNotificationHubsPush`, `AddAmazonSnsPush` or `AddFirebaseCloudMessagingPush`) with an enabled section.

- **Caveats / not-in-source**: the divergence in validation strictness between this and the real registrar means a test running against the default registration cannot catch an invalid `Platform` value. That behavior is only exercised through [AzureNotificationHubDeviceRegistrar](group-28-common-cloud-provider-adapters.md#azurenotificationhubdeviceregistrar).

---

### RabbitMqProvisioner

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqProvisioner.cs:16` · Level 4 · class (internal sealed)

- **What it is**: the part of the transport that creates RabbitMQ entities, once per process and idempotently, honoring `MessageBusSettings.ProvisionTopology` (`RabbitMqProvisioner.cs:16-136`).

- **Depends on**: [IRabbitMqOperations](#irabbitmqoperations), [RabbitMqNames](#rabbitmqnames), [BrokerTopology](#brokertopology), [MessageBusSettings](#messagebussettings); `ConcurrentDictionary`.

- **Concept introduced, provisioning on or off.** `[Rubric §17, DevOps]` assesses whether infrastructure ownership is explicit. With provisioning on, every entity is declared, and a repeated declaration with the same arguments is a no-op on the broker. With it off, nothing is declared: the host queue, its error queue and every delay queue must already exist, and the receive side checks the queue it is about to publish a copy to passively, so a missing one fails the disposition (and the message is redelivered) instead of the copy being silently dropped as unroutable (`RabbitMqProvisioner.cs:5-12`).

- **Walkthrough**
  - Two ordinal `ConcurrentDictionary` sets remember declared exchanges and queues (`RabbitMqProvisioner.cs:18-19`); `ProvisionTopology` (`:22`) comes from the primary constructor.
  - `ProvisionReceiveAsync` (`:32-56`) returns at once when provisioning is off (`:37-40`), otherwise declares the host queue (`:42-43`), its error queue (`:45-47`), and for each subscription the topic's fanout exchange plus the binding to the queue (`:49-55`).
  - `EnsureExchangeAsync` (`:63-74`) declares a topic's exchange before its first publish, skipping it when provisioning is off or already declared (`:67`); `ForgetExchange` (`:81`) drops it from the set after a failed publish, so the next publish declares it again in case it was deleted out of band.
  - `EnsureErrorQueueAsync` (`:88-93`) and `EnsureDelayQueueAsync` (`:104-110`) funnel into `EnsureQueueAsync` (`:112-135`), which declares with arguments when provisioning and otherwise calls the passive `EnsureQueueExistsAsync` (`:125-132`), then caches the name (`:134`). Delay queues are therefore declared lazily, the first time an interval is used.

- **Why it's built this way**: a host that runs with least-privilege broker credentials cannot declare entities, so provisioning has to be switchable; the passive check is what keeps that mode from losing messages.

- **Where it's used**: [RabbitMqBrokerTransport](#rabbitmqbrokertransport) creates one for the publisher and one for the receiver (`RabbitMqBrokerTransport.cs:44`, `:57`); consumed by [RabbitMqPublisher](#rabbitmqpublisher), [RabbitMqReceiver](#rabbitmqreceiver) and [RabbitMqDispositionApplier](#rabbitmqdispositionapplier). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqProvisionerTests.cs`.

---

### RabbitMqDispositionApplier

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqDispositionApplier.cs:21` · Level 5 · class (internal static)

- **What it is**: the step that carries out a [BrokerDisposition](#brokerdisposition) for a delivered message, up to but not including the acknowledgement of the original, which the receiver sends once this returns (`RabbitMqDispositionApplier.cs:21-74`).

- **Depends on**: [IRabbitMqOperations](#irabbitmqoperations), [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqNames](#rabbitmqnames), [IncomingBrokerMessage](#incomingbrokermessage), [BrokerDisposition](#brokerdisposition) with [Redeliver](#redeliver), [DeadLetter](#deadletter) and [Completed](#completed), [BrokerHeaders](#brokerheaders).

- **Concept**: the disposition model is taught at [BrokerDisposition](#brokerdisposition); this is how RabbitMQ realizes it. `[Rubric §10, Messaging & Integration]` applies to the ordering: both copies are published mandatory and confirmed, so the original is acknowledged only once its copy is safely in a queue, and a failure here throws so the receiver returns the original to the queue (`RabbitMqDispositionApplier.cs:16-17`).

- **Walkthrough**: `ApplyAsync` (`RabbitMqDispositionApplier.cs:31-73`).
  - `Redeliver` (`:44-54`): ensure the delay queue for `RabbitMqNames.DelaySeconds(redeliver.Delay)` (`:46-48`), copy the headers with the new `BrokerHeaders.RedeliveryCount` (`:49-52`), and publish to the delay queue through the default exchange, mandatory (`:53`).
  - `DeadLetter` (`:56-69`): ensure the error queue (`:58`), add the reason header and, when present, the detail header (`:59-66`), and publish to `{queue}-error`, mandatory (`:68`).
  - `Completed`: nothing to publish; the acknowledgement is all there is (`:72`).

- **Where it's used**: called by [RabbitMqReceiver](#rabbitmqreceiver) for every processed delivery (`RabbitMqReceiver.cs:215`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqDispositionApplierTests.cs`.

---

### RabbitMqPublisher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqPublisher.cs:10` · Level 5 · class (internal sealed)

- **What it is**: the RabbitMQ [IBrokerPublisher](#ibrokerpublisher): it publishes each message, persistent and confirmed, to its topic's fanout exchange, declaring the exchange first when provisioning. A publish the broker did not confirm throws, so the outbox keeps the row and retries it (`RabbitMqPublisher.cs:3-8`).

- **Depends on**: [IBrokerPublisher](#ibrokerpublisher), [OutgoingBrokerMessage](#outgoingbrokermessage), [IRabbitMqOperations](#irabbitmqoperations), [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqNames](#rabbitmqnames).

- **Concept**: the publisher contract is taught at [IBrokerPublisher](#ibrokerpublisher).

- **Walkthrough**
  - The constructor (`RabbitMqPublisher.cs:18-25`) takes the operations and the provisioner.
  - `PublishAsync` (`:28-47`) maps the topic to its exchange (`:32`), ensures the exchange (`:35`), and publishes with `mandatory: false` and an empty routing key (`:39-40`): a fanout exchange with no queue bound yet means no host consumes the event, which is not an error for the publisher (`:37-38`). Any failure makes the provisioner forget the exchange before rethrowing (`:42-46`).
  - `DisposeAsync` and `Dispose` (`:50-51`, `:54`) forward to the operations when they are disposable.

- **Where it's used**: registered as the singleton `IBrokerPublisher` by [RabbitMqBrokerTransport](#rabbitmqbrokertransport) (`RabbitMqBrokerTransport.cs:42-44`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqPublisherTests.cs`.

---

### RabbitMqReceiver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqReceiver.cs:21` · Level 6 · class (internal sealed partial)

- **What it is**: the hosted service that consumes the host queue with manual acknowledgements, hands every delivery to [IBrokerReceivePipeline](#ibrokerreceivepipeline) and applies the resulting disposition before acknowledging (`RabbitMqReceiver.cs:21-263`).

- **Depends on**: `BackgroundService`, [BrokerTopology](#brokertopology), [IBrokerReceivePipeline](#ibrokerreceivepipeline), [RabbitMqConnectionSource](#rabbitmqconnectionsource), [RabbitMqChannelOperations](#rabbitmqchanneloperations), [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqDispositionApplier](#rabbitmqdispositionapplier), [RabbitMqHeaders](#rabbitmqheaders), [RabbitMqNames](#rabbitmqnames), [IncomingBrokerMessage](#incomingbrokermessage); RabbitMQ.Client's `AsyncEventingBasicConsumer`; source-generated `[LoggerMessage]` logging.

- **Concept introduced, a receiver that never stops the host.** `[Rubric §13, Observability & Operability]` assesses whether a service degrades and recovers rather than crashes. When the broker is unreachable at startup, or a channel is lost and not recovered, the receiver logs a Warning and tries again every `ReconnectDelay`; the client's automatic recovery repairs an ordinary connection loss on its own (`RabbitMqReceiver.cs:13-17`). `[Rubric §10, Messaging & Integration]` covers the delivery guarantee: a delivery is acknowledged only after its disposition copy is confirmed, and anything that fails is negatively acknowledged with requeue.

- **Walkthrough**
  - Timings: `ReconnectDelay` 5 seconds (`RabbitMqReceiver.cs:24`), `ChannelCheckInterval` 10 seconds (`:27`), `DrainTimeout` 10 seconds (`:30`). An `_inFlight` counter tracks deliveries being processed (`:41`).
  - The constructor (`:51-75`) creates its own [RabbitMqChannelOperations](#rabbitmqchanneloperations) over the receiver's connection without owning it (`:69`) and fixes the fitted queue name (`:74`).
  - `ExecuteAsync` (`:101-127`) loops `RunSessionAsync` (`:107`), returns on cancellation (`:109-112`), logs any other failure (`:113-116`) and waits `ReconnectDelay` before the next session (`:120`).
  - `RunSessionAsync` (`:146-189`) opens the connection, provisions the receive topology (`:148-149`), and when provisioning is off checks the queue passively (`:150-153`). It opens a consume channel with confirms off and `consumerDispatchConcurrency` set to the configured concurrency (`:155-160`), applies the prefetch window with `BasicQosAsync` (`:163`), and starts a consumer with `autoAck: false` (`:165-167`). It then polls every `ChannelCheckInterval`: a channel closed while the connection is open was closed by the broker, which recovery never repairs, so the session ends and a new one starts (`:170-181`). The `finally` drains and closes the channel (`:186-187`).
  - `DrainAsync` (`:191-200`) waits in 50 ms steps, up to `DrainTimeout`, for in-flight deliveries to settle.
  - `HandleAsync` (`:202-234`) builds an [IncomingBrokerMessage](#incomingbrokermessage) from the body, the decoded headers and the AMQP `MessageId`, falling back to the delivery tag (`:207-210`); runs the pipeline (`:214`); applies the disposition (`:215-216`); then acknowledges (`:217`). A cancellation during shutdown (`:219-223`) and any other failure (`:224-228`, logged at Error) both requeue the delivery. `RequeueQuietlyAsync` (`:236-247`) tolerates a closed channel, which returns unacknowledged deliveries to the queue by itself.
  - `StopAsync` and `Dispose` (`:78-89`, `:92-98`) dispose the operations and the connection; the second disposal is a no-op.
  - Five `[LoggerMessage]` methods (`:249-262`) cover consuming, session failure, channel loss, disposition failure and requeue failure.

- **Why it's built this way**: separate connections for publishing and consuming, plus prefetch equal to twice the concurrency by default, keep acknowledgements flowing while the publisher is throttled; acknowledging after the confirmed copy makes a crash between the two produce a duplicate, never a loss, which the inbox absorbs.

- **Where it's used**: registered as a hosted service by [RabbitMqBrokerTransport](#rabbitmqbrokertransport) only when the topology has subscriptions (`RabbitMqBrokerTransport.cs:46-60`).

- **Caveats / not-in-source**: the drain waits at most 10 seconds and then closes the channel anyway; deliveries still in flight at that point are returned to the queue by the broker and processed again.

---

### RabbitMqBrokerTransport

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMq/RabbitMqBrokerTransport.cs:24` · Level 7 · class (internal sealed)

- **What it is**: the built-in [IBrokerTransport](#ibrokertransport) for `MessageBus:Provider=RabbitMq`, the broker the Aspire development stack and the cross-service test tier run, written directly on RabbitMQ.Client against the same contract an adapter package implements (`RabbitMqBrokerTransport.cs:7-10`).

- **Depends on**: [IBrokerTransport](#ibrokertransport), [BrokerTransportContext](#brokertransportcontext), [BrokerTransportPolicies](#brokertransportpolicies), [MessageBusProviders](#messagebusproviders), [MessageBusSettings](#messagebussettings), [IBrokerPublisher](#ibrokerpublisher), [IBrokerReceivePipeline](#ibrokerreceivepipeline), and the RabbitMQ types of this part: [RabbitMqPublisher](#rabbitmqpublisher), [RabbitMqChannelOperations](#rabbitmqchanneloperations), [RabbitMqConnectionSource](#rabbitmqconnectionsource), [RabbitMqProvisioner](#rabbitmqprovisioner), [RabbitMqReceiver](#rabbitmqreceiver), [RabbitMqNames](#rabbitmqnames).

- **Concept**: the transport strategy is taught at [IBrokerTransport](#ibrokertransport); this is its composition root for RabbitMQ. The topology it produces (fanout exchange per topic, one queue per host, `{queue}-error`, TTL delay queues so delayed redelivery needs no plugin, persistent confirmed publishes, automatic recovery) is summarized in the class doc (`RabbitMqBrokerTransport.cs:11-17`) and taught at [RabbitMqNames](#rabbitmqnames). See [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html) and [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html).

- **Walkthrough**
  - `Name` returns `MessageBusProviders.RabbitMq` (`RabbitMqBrokerTransport.cs:27`); `MaxRedeliveryDelay` is `null` (`:30`), since a delay queue can hold any interval.
  - `Register` (`:33-61`) parses the URI and reads the topology and `ProvisionTopology` (`:38-40`), then registers a singleton `IBrokerPublisher`: a [RabbitMqPublisher](#rabbitmqpublisher) over owning [RabbitMqChannelOperations](#rabbitmqchanneloperations) on a connection named `{queue} (publish)` (`:42-44`). A host with no subscriptions stops there (`:46-49`). Otherwise it resolves concurrency and prefetch (`:51-52`) and adds a [RabbitMqReceiver](#rabbitmqreceiver) hosted service on its own `{queue} (receive)` connection with its own provisioner (`:53-60`).
  - `ParseConnectionUri` (`:70-86`) returns `null` for a blank string, so the client default `localhost:5672` applies (`:72-75`), accepts an absolute `amqp` or `amqps` URI (`:77-81`), and otherwise throws an `InvalidOperationException` naming `MessageBus:ConnectionString` and `ConnectionStrings:rabbitmq` (`:83-85`). The connection string resolution order is in the class doc (`:18-22`).
  - `ResolveConcurrency` (`:94-95`): `MessageBus:ConcurrentMessageLimit`, else `Environment.ProcessorCount`, clamped to 1..65535.
  - `ResolvePrefetchCount` (`:104-105`): `MessageBus:PrefetchCount`, else twice the concurrency, so a finished delivery's slot is refilled without a broker round trip (`:97-98`).

- **Why it's built this way**: a bad connection string fails at registration with an actionable message rather than as a runtime connection error, and separate publish and receive connections keep a throttled publisher from stalling consumer acknowledgements.

- **Where it's used**: instantiated by `ResolveBrokerTransport` when the provider is `RabbitMq` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:201-204`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Transports/RabbitMq/RabbitMqBrokerTransportTests.cs` and, against a live broker, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.RabbitMq.Tests/RabbitMqBrokerTransportTests.cs`.

---

### JobClaim
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:458` · Level 0 · record (private nested, sealed)

- **What it is**: the result of one attempt to claim a due job row: which row was due, the occurrence it was due at, the cron expression to compute the next occurrence from, and the claim token, which is null when a different replica won the row.

- **Depends on**: nothing first-party. BCL only (`string`, `DateTime`, `Guid?`). It exists solely as the return shape of [`ScheduledJobRunner`](#scheduledjobrunner)`.TryClaimNextDueAsync`.

- **Concept introduced, three answers in one return value.** A claim attempt has three outcomes, not two: nothing was due, something was due and this replica took it, or something was due and another replica took it first. `[Rubric §15, Best Practices & Code Quality]` assesses whether the code makes illegal states hard to express: the method returns `JobClaim?`, so `null` is "nothing due" and a non-null instance with a null `LockToken` is "lost the race" (`ScheduledJobRunner.cs:409-412`). Collapsing the latter two into one `null` would have cost the caller the ability to mark that name as attempted for this cycle and move on, which is exactly what stops the loop spinning on a row this replica will never own (`ScheduledJobRunner.cs:393-402`). A positional record gets that shape in one line with value equality and no mutable state.

- **Walkthrough**: four positional members, each documented (`ScheduledJobRunner.cs:453-458`): `JobName`, `DueOn` (the occurrence the row was due at, used for the lag metric), `CronExpression` (what the next occurrence is computed from, read from the row rather than recomputed from settings so an in-flight schedule change cannot retarget a run in progress), and `Guid? LockToken`. It is constructed once, at `ScheduledJobRunner.cs:450`, where the token is passed as `claimed == 0 ? null : lockToken`: the count of rows the claiming `ExecuteUpdateAsync` actually matched IS the race result.

- **Why it's built this way**: `private sealed record` keeps a purely internal carrier invisible to the package's public surface, so it costs nothing in API compatibility terms while still giving the claim path a named, immutable shape ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: returned by `TryClaimNextDueAsync` (`ScheduledJobRunner.cs:413-451`) and consumed by `RunDueJobsAsync` (`ScheduledJobRunner.cs:376-404`).

---

### ScheduledJobEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20` · Level 0 · class (sealed)

- **What it is**: the persisted schedule and last-run record for one registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob): one row per job name, upserted by [`ScheduledJobRunner`](#scheduledjobrunner) on every cycle. It carries both the schedule (expression, next occurrence) and the claim lease that makes a multi-replica host safe.

- **Depends on**: nothing first-party and nothing beyond `string`, `DateTime` and `Guid` from the BCL, which is why it is Level 0.

- **Concept introduced, the framework bookkeeping entity.** `[Rubric §4, DDD]` assesses whether the domain model stays a model of the business: this class is deliberately **not** an `IAuditableEntity` and not an aggregate root, exactly like [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), because it is framework bookkeeping rather than domain state (`ScheduledJobEntry.cs:8-14`). The consequences are concrete: no soft-delete flag, so no global query filter applies to it; no audit stamps, so the save interceptors have nothing to write (which is why the runner can call a plain `SaveChangesAsync` with no user id, `ScheduledJobRunner.cs:325-330`); and no concurrency token, because its concurrency control is the explicit claim lease instead. `[Rubric §8, Data Architecture]`: the table is **host-scoped** and lives in the `Default` data source only, unlike the outbox, which exists once per physical source (`ScheduledJobEntry.cs:15-18`). Jobs belong to a host, not to a database. `[Rubric §11, Security]` by omission: it also carries no user data, which is what keeps it in the audit trail's framework-entity exclusion set alongside the outbox and inbox rows (`Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:113-119`, this type at `:118`).

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

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerSettings.cs:69` · Level 0 · class (sealed)

- **What it is**: one entry under `Scheduler:Jobs:{Name}`, the per-job override that lets a deployment retime a recurring job without touching code. Today it carries exactly one member, the cron expression.

- **Depends on**: nothing. It is the value type of [SchedulerSettings](#schedulersettings)`.Jobs` (`SchedulerSettings.cs:63`) and is read by [ScheduledJobRunner](#scheduledjobrunner).

- **Concept introduced, code default plus configuration override.** An [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob) ships with a `CronExpression` compiled into it, which is the right default because the job's author knows what cadence the work needs. An operator who has to change that cadence for one environment should not need a release. `[Rubric §17, DevOps]` assesses whether operational behavior can be changed without a code change; this pair is the minimal answer: an absent entry leaves the compiled-in schedule in force, and a present, non-blank `Cron` replaces it (`SchedulerSettings.cs:57-62`, `:71-77`). The change needs a configuration edit and a host restart, not a release. `[Rubric §15, Best Practices & Code Quality]`: the override is keyed by `IScheduledJob.Name`, the job's own stable identity, so configuration and code agree on one name rather than on a class name that refactoring would break.

- **Walkthrough**: a single `string? Cron { get; init; }` (`SchedulerSettings.cs:78`). The whole mechanism lives in the reader, not in this type: `ScheduledJobRunner.ResolveCronExpression` looks the job up by name and takes the override only when it is present AND non-blank, otherwise the job's own expression (`ScheduledJobRunner.cs:173-177`). Blank-means-absent matters, because a JSON key set to `""` is a common way to try to clear a value and would otherwise produce an unparseable schedule.

- **Why it's built this way**: the runner treats a changed expression as a schedule rewrite. On each cycle it reads the stored expressions (`ScheduledJobRunner.cs:278-282`), leaves a row untouched when the resolved expression matches (recomputing every cycle would push the next occurrence forward forever and nothing would ever fire, `:290-296`), and otherwise recomputes the next occurrence from the current instant and either updates the row with a schedule-changed log (`:304-309`) or inserts a new one (`:310-322`). The settings themselves are read once: the runner snapshots `IOptions<SchedulerSettings>.Value` at construction (`ScheduledJobRunner.cs:47`), so an operator edit applies when the host restarts, and the first cycle after that restart performs the rewrite (`SchedulerSettings.cs:73-76`, [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: [ScheduledJobRunner](#scheduledjobrunner) only, through `SchedulerSettings.Jobs`.

- **Caveats**: an override that does not parse is not rejected at startup, unlike the range-checked scalar settings in this namespace. The runner logs the parse failure (`ScheduledJobRunner.cs:298-302`, message at `:670-671`) and records the job with the skipped outcome and a `DateTime.MaxValue` next run (insert at `:316-317`, update at `:359-368`), so a bad cron string is an observable non-run rather than a failed boot. Editing the value on a running host changes nothing until the restart.

---

### SchedulerMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument set for the recurring job scheduler: one meter carrying a run counter, an execution-duration histogram, and a schedule-lag histogram, all emitted by [`ScheduledJobRunner`](#scheduledjobrunner).

- **Depends on**: `System.Diagnostics.Metrics` (BCL) only (`SchedulerMetrics.cs:1`). Nothing first-party.

- **Concept introduced, the one-meter-per-feature instrument holder.** `[Rubric §13, Observability & Operability]` assesses whether a running system can be understood from outside: a background loop is invisible by construction (no request, no response code), so the only evidence that a schedule is healthy is telemetry. The three instruments here are chosen to answer the three operator questions: is it running, how long does it take, and is it on time. `[Rubric §31, Cost/FinOps]` shows up in the same design: the per-occurrence start and finish lines are logged at `Debug` rather than `Information` precisely because a busy schedule would otherwise double the runner's steady-state log volume (`ScheduledJobRunner.cs:679-686`), and the numbers an operator alerts on come from these metrics instead. A host exports them by registering the `MeterName` meter; the Aspire service defaults (`ConfigureOpenTelemetry`) already do (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:313`), and the doc records that the name is duplicated as a literal there because that package has no reference to Infrastructure (`SchedulerMetrics.cs:5-14`).

- **Walkthrough**:
  - `MeterName = "MMCA.Common.Scheduler"` (`SchedulerMetrics.cs:19`) and the single static `Meter` built from it (`:21`). The class doc is explicit that one meter serves every scheduler instrument and that a second `Meter` with this name must never be created (`SchedulerMetrics.cs:11-14`), since duplicate meters are a classic source of double-counted telemetry. [`BrokerMetrics`](#brokermetrics) repeats the same shape for the broker transport.
  - `RunCounter` (`SchedulerMetrics.cs:28-31`), `scheduler.job.runs`, unit `runs`, tagged by `job` and `outcome`: the failure rate of a schedule is this counter split by outcome.
  - `DurationHistogram` (`:39-42`), `scheduler.job.duration` in **seconds**, tagged by `job`, measured around the job's own `ExecuteAsync` only so it excludes claim and bookkeeping cost. Its stated purpose is the lease relationship: a job whose duration approaches `Scheduler:LeaseSeconds` is about to lose its claim mid-run (`SchedulerMetrics.cs:33-38`).
  - `LagHistogram` (`:50-53`), `scheduler.job.lag` in seconds, the interval between an occurrence becoming due and actually starting. It is floored at zero, and a value near the polling interval is normal for an occurrence that landed just after a cycle (`SchedulerMetrics.cs:44-49`).

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the runner records without resolving anything from DI, and keeping the meter name a constant on the same type is what lets a test assert against it. `SchedulerMetricsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerMetricsTests.cs:13`) pins the instrument surface.

- **Where it's used**: [`ScheduledJobRunner`](#scheduledjobrunner)`.ExecuteClaimedJobAsync` records the lag before invoking the job (`ScheduledJobRunner.cs:476-479`) and the duration plus the outcome-tagged count after it returns (`ScheduledJobRunner.cs:512-515`).

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
  the bottom of the same file (`:69-79`). Externals:
  `System.ComponentModel.DataAnnotations` for `[Range]` (`:1`).

- **Concept introduced: one setting that gates both the behavior and the schema.** Most feature flags
  gate behavior. `Enabled` also decides whether the `ScheduledJobs` table is mapped into the EF model
  at all: [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) reads
  `IOptions<SchedulerSettings>` with `GetService` (not `GetRequiredService`) so an absent
  registration reads as disabled rather than failing every context construction, then additionally
  requires the physical source to be the default one
  (`ApplicationDbContext.cs:412-417`). The consequence is the one worth learning: a host that leaves
  the flag false has exactly the model it had before the scheduler shipped, so its migrations never
  see the table (`SchedulerSettings.cs:10-15`).

  `[Rubric §15, Best Practices & Code Quality]` assesses whether adopting a framework feature is additive. Because
  registration and activation are separate (`AddScheduledJobs` binds and registers the runner, but
  the runner returns immediately unless `Enabled` is true, `ScheduledJobRunner.cs:86-92`), a host can
  ship the registration and turn the scheduler on per environment
  (`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:31-33`).

  `[Rubric §29, Resilience and Business Continuity]` assesses safe behavior under replication.
  `LeaseSeconds` is what makes multiple replicas safe: a replica claims a job row for that many
  seconds and other replicas skip claimed rows, so no occurrence runs twice; if the claiming replica
  dies mid-execution, the row becomes claimable again once the lease expires
  (`SchedulerSettings.cs:36-46`, applied at `ScheduledJobRunner.cs:435`). While a job runs, the
  holder renews its lease every half of this value (`ScheduledJobRunner.cs:575`, `:585-589`), so the
  lease no longer has to outlast the longest job; the trade-off is that a shorter lease frees a dead
  replica's row sooner at the cost of more writes and less time to retry a failed renewal before
  another replica can claim a job that is still running (`SchedulerSettings.cs:39-43`).

  `[Rubric §31, Cost and FinOps]` assesses idle-cost defaults. `PollingIntervalSeconds` is a BOUND on
  the smart wait, not a hot loop: the runner normally sleeps until the earliest due job and uses this
  value only to cap that sleep (`SchedulerSettings.cs:28-34`, `ScheduledJobRunner.cs:124-127`). The
  doc also names it as how quickly a configuration-driven schedule change is noticed, but the runner
  reads these settings once at construction (`ScheduledJobRunner.cs:47`), so in practice a changed
  setting takes effect after a host restart.

- **Walkthrough**: one static field, four `init` properties and one get-only dictionary.
  - `SectionName = "Scheduler"` (`SchedulerSettings.cs:19`).
  - `Enabled` (`:26`): default `false`, documented as the deliberate posture that adopting the
    framework must never add a table or a background loop to a host that did not ask for one.
  - `PollingIntervalSeconds` (`:34`): `[Range(1, 3600)]` (`:33`), default `30`.
  - `LeaseSeconds` (`:46`): `[Range(10, 3600)]` (`:45`), default `300`. The holder renews it every
    half lease while its job runs, so it does not need to exceed the longest job (`:36-44`).
  - `DataSource` (`:55`): default `DataSource.SQLServer`. Jobs are host-scoped, so there is exactly
    one `ScheduledJobs` table per host rather than one per source, and this only names the relational
    engine that table lives on; Cosmos DB is not a valid value (`:48-54`). The runner resolves it
    against `DataSourceKey.DefaultName` (`ScheduledJobRunner.cs:226-227`).
  - `Jobs` (`:63`): a get-only `Dictionary<string, ScheduledJobOverrideSettings>` keyed by
    [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob)`.Name` and bound from
    `Scheduler:Jobs:{Name}`. `ResolveCronExpression` takes the override only when the entry exists
    AND its `Cron` is non-blank, otherwise the job's compiled-in expression stands
    (`ScheduledJobRunner.cs:173-177`). A changed expression applies after a host restart (the runner
    snapshots the settings at construction, `ScheduledJobRunner.cs:47`): the first cycle compares the
    resolved expression against the stored one, leaves an unchanged row alone (recomputing it every
    cycle would push every schedule forward and nothing would ever fire), and otherwise rewrites the
    stored value and recomputes the next occurrence from the current instant
    (`ScheduledJobRunner.cs:289-322`).

- **Why it's built this way**: a persistent, database-backed cron scheduler with per-row leases is the
  decision recorded in
  [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html); everything in this
  class is the operator-facing surface of it. Defaulting every property makes the section optional,
  which is the same fail-soft-on-absence, fail-fast-on-bad-value posture
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes:
  the `[Range]` guards run under `ValidateOnStart`, so a bad value fails the boot rather than the
  first cycle.

- **Where it's used**: bound with validation in `AddScheduledJobs`
  (`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:38-41`), which registers the runner through
  `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` rather than
  `AddHostedService`, precisely so two calls cannot start two runners racing for the same rows
  (`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:43-47`). Read by
  [ScheduledJobRunner](#scheduledjobrunner) (`ScheduledJobRunner.cs:43`, `:47`) and by
  [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) for the table gate
  (`ApplicationDbContext.cs:415-417`); the design-time helper supplies a default instance so
  `dotnet ef` can build a model without a host
  ([DesignTimeDbContextHelper](group-07-persistence-ef-core.md#designtimedbcontexthelper),
  `DesignTimeDbContextHelper.cs:161-162`).

---

### ChannelJoinAuthorizerMissingWarningService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/ChannelJoinAuthorizerMissingWarningService.cs:16` · Level 1 · class (internal, sealed, partial, IHostedService)

- **What it is**: a one-shot startup check. When push notifications are registered and no
  [`IChannelJoinAuthorizer`](group-07-persistence-ef-core.md#ichanneljoinauthorizer) is, it logs one
  Warning saying that any authenticated caller can join any well-formed channel on the hub
  (`ChannelJoinAuthorizerMissingWarningService.cs:8-13`). It changes no join behavior.

- **Depends on**: `IServiceProviderIsService` and `ILogger<ChannelJoinAuthorizerMissingWarningService>`
  as primary-constructor parameters, implementing `IHostedService` (`:16-18`). The check names
  [`IChannelJoinAuthorizer`](group-07-persistence-ef-core.md#ichanneljoinauthorizer), and the posture
  it describes is enforced (or not) by [`NotificationHub`](group-10-notifications.md#notificationhub).
  Externals: `Microsoft.Extensions.DependencyInjection`, `.Hosting`, `.Logging` (`:1-3`).

- **Concept introduced: make an open default visible instead of closing it.** `[Rubric §11, Security]`
  assesses whether insecure postures are explicit. Channel joins stay open without an authorizer, which
  is a legitimate choice when every channel is meant for every signed-in user, so the framework does not
  refuse to boot; it states the consequence once, at startup, in a message that names the interface to
  register (`:36-39`). `[Rubric §13, Observability & Operability]`: the warning lands in the startup
  log where an operator reviewing a new deployment sees it, rather than being discoverable only by
  reading the hub.

- **Walkthrough**:
  - `StartAsync` (`:21-31`): asks `IServiceProviderIsService.IsService(typeof(IChannelJoinAuthorizer))`
    (`:25`), which answers without resolving an instance, and logs `LogNoChannelJoinAuthorizer` when the
    answer is no (`:27`). The check runs at start, not at registration, because a host may register its
    authorizer after calling `AddPushNotifications` (`:23-24`).
  - `StopAsync` (`:34`): a no-op.
  - `LogNoChannelJoinAuthorizer` (`:36-39`): a source-generated `[LoggerMessage]` at `Warning`.

- **Why it's built this way**: a hosted service is the one place that runs after the whole container is
  built, so it sees every registration regardless of call order. Push notifications and their channel
  model are described in [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).

- **Where it's used**: registered by `AddPushNotifications` with `AddHostedService`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:86`); the
  comment there notes that `AddHostedService` is a `TryAddEnumerable`, so a second call adds no second
  warning (`:83-85`).

---

### IRedeemSignInLinkCommand

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.SignInLinks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/SignInLinks/IRedeemSignInLinkCommand.cs:10` · Level 1 · interface

- **What it is**: the contract an app's redeem-sign-in-link command record satisfies so the shared
  handler and controller bases can work with it: the
  [`RedeemSignInLinkRequest`](group-08-auth.md#redeemsigninlinkrequest) plus the caller's IP and
  user-agent (`IRedeemSignInLinkCommand.cs:10-17`).

- **Depends on**: [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  closed over [`RedeemSignInLinkRequest`](group-08-auth.md#redeemsigninlinkrequest) (`:10`). No externals.

- **Concept introduced**: the same reason the other Users command records stay app-side (see
  [`GetUserPreferencesQuery`](#getuserpreferencesquery)): each app's record carries its own pipeline
  markers, ADC's for instance adds `ITransactional`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RedeemSignInLink/RedeemSignInLinkCommand.cs:19-23`).
  An interface lets the framework name the members it needs without owning the record.
  `[Rubric §9, API & Contract Design]`: the two extra members are request metadata the controller
  captures from the HTTP connection, not values the client supplies.

- **Walkthrough**: `IpAddress` (`:13`) and `UserAgent` (`:16`), both `string?`, recorded on the new
  refresh session. `Request` is inherited from `ICommandWithRequest<RedeemSignInLinkRequest>`.

- **Where it's used**: the `TCommand` constraint of
  [`RedeemSignInLinkHandlerBase<TUser, TCommand>`](#redeemsigninlinkhandlerbasetuser-tcommand)
  (`RedeemSignInLinkHandlerBase.cs:65`), which passes both members to
  `IAuthenticationService.SignInVerifiedEmailOwnerAsync` (`:112-114`); the `TRedeemCommand` constraint
  of [`SignInLinkControllerBase<TSendCommand, TRedeemCommand>`](group-12-api-hosting-mapping.md#signinlinkcontrollerbasetsendcommand-tredeemcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/SignInLinks/SignInLinkControllerBase.cs:39`),
  which fills them from `ClientIpAddress` and `ClientUserAgent` (`:51`, `:54`, `:121`). Implemented by
  ADC's `RedeemSignInLinkCommand` (cited above).

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
  rather than also in the query type (`GetUserPreferencesHandlerBase.cs:10-13`). Preferences
  themselves are the persistence side of
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (culture) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) (theme).

- **Where it's used**: constructed by
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  in its `GET preferences` action (`UserAccountAuthControllerBase.cs:151`) and handled by
  [`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
  (`GetUserPreferencesHandlerBase.cs:31-33`). Both apps' `AuthController` take the closed handler
  interface as a constructor dependency
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:36`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:32`), and
  both architecture suites use it as the *query* specimen when asserting decorator ordering
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:30`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:30`).

---

### GetUserPreferencesHandlerBase<TUser>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.GetPreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:19` · Level 8 · class (abstract)

- **What it is**: the shared preference-read workflow, and the only query handler among the Users
  bases. Load the account through the read repository and project its two preference fields into a
  [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse)
  (`GetUserPreferencesHandlerBase.cs:19`, `:31-43`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) as its single
  primary-constructor parameter (`:19`); implements
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  closed over [`GetUserPreferencesQuery`](#getuserpreferencesquery) and
  `Result<UserPreferencesResponse>` (`:20`). One constraint: `TUser` is an
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  implementing [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:21`). Also uses
  [`Error`](group-01-result-error-handling.md#error). No logger, and no externals beyond the BCL.

- **Concept introduced: one generic parameter is enough when nothing app-specific rides on the
  request.** This is the contrast case for the command bases above. Because
  [`GetUserPreferencesQuery`](#getuserpreferencesquery) carries no pipeline markers, it could be
  shared outright, so the base is generic in the `User` aggregate **only** (`:10-13`). Note also the
  weaker entity constraint: `AuditableBaseEntity<UserIdentifierType>` rather than
  `AuditableAggregateRootEntity<...>` (`:21`), because a read needs no domain events and no aggregate
  behavior. Constraining to the least the workflow actually uses is the pattern worth copying.

  `[Rubric §6: CQRS & Event-Driven]` assesses read/write separation. The handler takes the **read**
  repository via `GetReadRepository` (`:37`) rather than `GetRepository`, and never calls
  `SaveChangesAsync`. The class remarks state that the read repository is the correct choice for a
  query handler, which never saves (`:14-17`).

  `[Rubric §12: Performance & Scalability]` assesses avoidable work. The read repository is the
  no-tracking path, so this query does not materialize an EF change-tracker entry for a preference
  lookup; the class remarks state it plainly: the read is no-tracking (`:15-16`). Note the related trap the workspace has hit elsewhere: a no-tracking source
  poisons a whole composed query, which is precisely why mutation handlers such as
  [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) keep
  using `GetRepository` instead.

  `[Rubric §15: Best Practices & Code Quality]` assesses consistency of error shape. The not-found
  path produces the identical `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)`
  construction the command bases use (`:40-41`), so every account use case reports a missing user the
  same way.

- **Walkthrough**: one protected member and one method.
  - Primary constructor (`:19`): `unitOfWork` only.
  - `HandlerName` (`:28`): the same `GetType().Name` default, so an app subclass named
    `GetUserPreferencesHandler` reports that name as the error `source` (`:23-27`).
  - `HandleAsync(GetUserPreferencesQuery, CancellationToken)` (`:31-43`): null-guards the query
    (`:35`); resolves `GetReadRepository<TUser, UserIdentifierType>()` (`:37`); loads by
    `query.UserId` (`:38`); and returns either the stamped `Error.NotFound` failure (`:40-41`) or a
    success wrapping `new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme)`
    (`:42`). A ternary, not a branch chain: the whole method is a load and a projection.

- **Why it's built this way**: the query and the response are shared types, so the only decision the
  base has to make is which repository is correct for a read, and it uses the no-tracking one
  (`:10-17`).
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
  (`UserAccountAuthControllerBase.cs:46`, `:58`, `:150-151`). Pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:14`
  through a test subclass (`:87`), and by each app's own handler tests.

- **Caveats**: the soft-delete global query filter applies to this read like any other, so a
  soft-deleted account resolves to `null` and returns `NotFound` rather than its stored preferences.
  That behavior comes from the persistence layer, not from anything in this class.

---

### RedeemSignInLinkHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.SignInLinks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/SignInLinks/RedeemSignInLinkHandlerBase.cs:58` · Level 8 · class (abstract, partial)

- **What it is**: the shared redeem-a-sign-in-link workflow (ADR-116). It spends the single-use
  token, resolves the account behind the address (creating it when an invitation allows), marks the
  address confirmed, and opens a session through
  [`IAuthenticationService`](group-08-auth.md#iauthenticationservice)
  (`RedeemSignInLinkHandlerBase.cs:17-21`, `:58-318`).

- **Depends on**: five primary-constructor parameters (`:58-63`):
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`ISignInLinkTokenService`](group-08-auth.md#isigninlinktokenservice),
  [`IAuthenticationService`](group-08-auth.md#iauthenticationservice),
  `IOptions<`[`SignInLinkSettings`](group-08-auth.md#signinlinksettings)`>` and a plain `ILogger`.
  Implements [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over `TCommand` and `Result<`[`AuthenticationResponse`](group-08-auth.md#authenticationresponse)`>`
  (`:63`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  over `UserIdentifierType` (`:64`) and `TCommand` is an
  [`IRedeemSignInLinkCommand`](#iredeemsigninlinkcommand) (`:65`). Also uses
  [`Email`](group-02-domain-building-blocks.md#email),
  [`SignInLinkGrant`](group-08-auth.md#signinlinkgrant),
  [`SignInLinkProfile`](group-08-auth.md#signinlinkprofile),
  [`SignInLinkErrors`](group-08-auth.md#signinlinkerrors),
  [`IEmailConfirmableUser`](group-08-auth.md#iemailconfirmableuser),
  [`IAuthUser`](group-08-auth.md#iauthuser),
  [`PasswordCredential`](group-08-auth.md#passwordcredential) and
  [`IPasswordClearableUser`](group-08-auth.md#ipasswordclearableuser). Externals:
  `Microsoft.Extensions.Options` and `Microsoft.Extensions.Logging` (source-generated
  `[LoggerMessage]`, `:302-317`).

- **Concept introduced: spend the proof before you look anything up.** The token is validated and
  consumed (`:96-102`) before the account is resolved (`:104`), so a caller with no valid token
  learns nothing about whether an address holds an account; every rejection up to and including the
  spend collapses to one invalid-link error through `Rejected` (`:296-300`, class remarks `:24-27`).
  `[Rubric §11: Security]` assesses account-enumeration and credential-handling exposure. Beyond
  the token-first order, the audit lines carry no address (`:315-317`), and an unconfirmed account
  that holds password material has its refresh sessions revoked and its password removed when a
  link confirms it, because the link proves the mailbox, not the password set on that account
  (`:238-273`, remarks `:41-48`).
  `[Rubric §15: Best Practices & Code Quality]` assesses whether shared behavior has one owner.
  The app supplies only the lookup and the optional extension points; the order of spend, resolve,
  confirm and sign-in lives once here.

- **Walkthrough**: three protected members, four extension points, one public method.
  - `UnitOfWork` (`:68`), `Settings` (`:71`) and `HandlerName` (`:77`, the `GetType().Name`
    default reported as the error `source`).
  - `HandleAsync(TCommand, CancellationToken)` (`:80-122`): null-guards the command; rejects when
    `Settings.Enabled` is false (`:86-89`) or the address is malformed (`:91-94`); calls
    `ValidateAndConsumeAsync` and rejects a refused token (`:96-102`); resolves the account
    (`:104-108`); runs `OnEmailOwnershipProvedAsync` (`:110`); then opens the session with
    `SignInVerifiedEmailOwnerAsync(user.Id, command.IpAddress, command.UserAgent, ...)` (`:112-114`)
    and logs the purpose on success (`:116-119`).
  - `FindUntrackedByEmailAsync` (`:131`, abstract): the app's own no-tracking lookup.
  - `ProvisionUser` (`:147-148`, virtual): default returns the invalid-link failure, so account
    creation through a link is opt-in per app (remarks `:30-34`).
  - `OnUserProvisionedAsync` (`:157-158`) and `OnEmailOwnershipProvedAsync` (`:169-170`): virtual
    no-op post-save extension points.
  - `ResolveAccountAsync` (`:172-226`, private): with no account, refuses unless the grant carries a
    profile (`:183-187`), else provisions, confirms, adds, saves and calls `OnUserProvisionedAsync`
    (`:189-206`); with an account, reloads it tracked through `GetRepository` (`:209`) and confirms it
    when it is an unconfirmed `IEmailConfirmableUser` (`:216-223`).
  - `ConfirmExistingAccountAsync` (`:238-273`, private): an account with no stored password is just
    confirmed and saved (`:240-243`); a password account whose type is not `IPasswordClearableUser`
    is refused before any mutation (`:246-250`); otherwise sessions are revoked first (`:254-258`),
    then `ClearPassword` (`:260`) and the confirming save (`:266`).
  - `ConfirmAndSaveAsync` (`:279-289`) and `ConfirmIfNeeded` (`:291-294`): confirm then save, or a
    no-op success for a type that is not confirmable.

- **Why it's built this way**: the redeem path is the one that turns a mailbox proof into a session,
  so the ordering decisions (spend first, revoke before mutate, refuse before mutate) are the part
  worth not re-deriving per app; the comments at `:248` and `:252-253` state why each step precedes
  the next. Sign-in links are part of the opt-in identity completions
  ([ADR-116](https://ivanball.github.io/docs/adr/116-identity-completions-opt-in.html)), and the
  `Enabled` gate keeps a host that has not turned them on answering the generic refusal.

- **Where it's used**: subclassed by ADC's `RedeemSignInLinkHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RedeemSignInLink/RedeemSignInLinkHandler.cs:46`),
  which overrides `FindUntrackedByEmailAsync` (`:63`), `ProvisionUser` (`:83`),
  `OnUserProvisionedAsync` (`:109`) and `OnEmailOwnershipProvedAsync` (`:119`). Consumed through the
  closed `ICommandHandler<TRedeemCommand, Result<AuthenticationResponse>>` by
  [`SignInLinkControllerBase<TSendCommand, TRedeemCommand>`](group-12-api-hosting-mapping.md#signinlinkcontrollerbasetsendcommand-tredeemcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/SignInLinks/SignInLinkControllerBase.cs:37`, `:45`).
  Pinned by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/SignInLinkHandlerBaseTests.cs:31`
  through test subclasses such as `PasswordAccountRedeemHandler<TUser>` (`:686-692`).

- **Caveats**: the token is spent before the account is resolved, so a redemption that fails later
  (no account and no invitation profile, a refused password account) still consumes the link; the
  caller requests a new one. An app that overrides `ProvisionUser` returns an unsaved account: the
  workflow adds and saves it (`:201-202`).

---

### SendSignInLinkHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.SignInLinks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/SignInLinks/SendSignInLinkHandlerBase.cs:44` · Level 8 · class (abstract, partial)

- **What it is**: the shared email-me-a-sign-in-link workflow (ADR-116): resolve the account behind
  the address, mint a short-lived single-use token, and email the link. Every outcome returns
  `Result.Success()` (`SendSignInLinkHandlerBase.cs:17-21`, `:44-189`).

- **Depends on**: five primary-constructor parameters (`:44-49`):
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`ISignInLinkTokenService`](group-08-auth.md#isigninlinktokenservice),
  [`IEmailSender`](group-10-notifications.md#iemailsender),
  `IOptions<`[`SignInLinkSettings`](group-08-auth.md#signinlinksettings)`>` and a plain `ILogger`.
  Implements [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over `TCommand` and `Result` (`:49`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  over `UserIdentifierType` (`:50`); `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  closed over [`SendSignInLinkRequest`](group-08-auth.md#sendsigninlinkrequest) (`:51`), so unlike
  the redeem side it needs no extra interface. Also uses
  [`Email`](group-02-domain-building-blocks.md#email),
  [`SignInLinkPurpose`](group-08-auth.md#signinlinkpurpose) and
  [`UserEmailResources`](#useremailresources). Externals: `Microsoft.Extensions.Options`,
  `Microsoft.Extensions.Logging` (`[LoggerMessage]`, `:176-188`) and `System.Net.WebUtility`.

- **Concept introduced: success-always as anti-enumeration.** A disabled feature or missing
  `SignInUrl` (`:64-68`), a malformed address (`:70-75`), an address with no account (`:77-83`), a
  throttled token request (`:85-92`) and a failed send (`:104-110`) all log and return
  `Result.Success()`, so the response carries no signal about which addresses hold accounts (class
  remarks `:24-28`, the same rule `ForgotPasswordHandlerBase` follows).
  `[Rubric §11: Security]` assesses account-enumeration exposure. The no-account extension point
  runs inside `NotifyNoAccountAsync` (`:164-174`), which swallows and logs anything it throws other
  than a cancellation, so an override cannot reintroduce the signal through an exception; the audit
  lines carry no address (`:182`, `:186`).
  `[Rubric §27: i18n]` assesses whether user-facing text follows the user's culture. Subject and
  body are composed inside `UserEmailResources.InRecipientCulture(user, ...)` (`:99-101`), so the
  email reads in the account's stored culture rather than the request's.

- **Walkthrough**: two protected members, four extension points, one public method.
  - `UnitOfWork` (`:54`, exposed so the lookup override can reach a read repository) and
    `Settings` (`:57`).
  - `HandleAsync(TCommand, CancellationToken)` (`:60-114`): null-guards; gates on `Settings.Enabled`
    and a non-blank `SignInUrl` (`:64`); parses the address (`:70`); looks the account up untracked
    (`:77`), calling `NotifyNoAccountAsync` when there is none (`:81`); issues a token with
    `SignInLinkPurpose.SignIn` and no profile (`:85-87`); composes the link with
    `Settings.ComposeLink` (`:95`); sends the localized HTML email (`:97-102`); and logs the request
    (`:112`).
  - `FindUntrackedByEmailAsync` (`:123`, abstract): the app's own no-tracking lookup.
  - `OnNoAccountAsync` (`:139`, virtual no-op): lets an app re-issue a pending invitation for an
    address that holds none (remarks `:30-34`).
  - `ComposeSubject` (`:146`) and `ComposeBody(string)` (`:151-161`): virtual, resource-backed; the
    body HTML-encodes the link (`:158`) and states the lifetime from `SignInLifetimeMinutes`
    (`:155`, `:159`).
  - `NotifyNoAccountAsync` (`:164-174`, private): the exception-swallowing wrapper above.

- **Why it's built this way**: this path never creates an account. Creating one is what an
  invitation does, and the app issues an invitation with `SignInLinkPurpose.Invite` through
  `ISignInLinkTokenService` directly (remarks `:30-34`). A send failure after the token is issued
  leaves that token valid, so the user can retry without the caller learning anything (`:105-106`).

- **Where it's used**: subclassed by ADC's `SendSignInLinkHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SendSignInLink/SendSignInLinkHandler.cs:44`),
  which overrides `FindUntrackedByEmailAsync` (`:56`) and `OnNoAccountAsync` (`:68`). Consumed
  through the closed `ICommandHandler<TSendCommand, Result>` by
  [`SignInLinkControllerBase<TSendCommand, TRedeemCommand>`](group-12-api-hosting-mapping.md#signinlinkcontrollerbasetsendcommand-tredeemcommand)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/SignInLinks/SignInLinkControllerBase.cs:36`, `:38`, `:42`).
  Pinned by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/SignInLinkHandlerBaseTests.cs:31`
  through `TestSendSignInLinkHandler` (`:712-717`) and `NoAccountSendSignInLinkHandler` (`:737`).

- **Caveats**: unlike the redeem base it declares no `HandlerName`, because it never returns an
  error. Because every outcome is success, the HTTP response cannot be used to diagnose a missing
  email; read the `Sign-in link request not actioned ({Reason})` audit line instead (`:181-182`).

---

### ScheduledJobRunner
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:40` · Level 13 · class (sealed, partial, BackgroundService)

- **What it is**: the framework's recurring job scheduler. A `BackgroundService` that runs the host's registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) implementations on their cron schedules, using a persistent job store ([`ScheduledJobEntry`](#scheduledjobentry)) and the outbox processor's claim-lease idiom so an occurrence executes exactly once across every replica.

- **Depends on**: `IServiceScopeFactory`, `ILogger<ScheduledJobRunner>`, `IOptions<SchedulerSettings>` ([`SchedulerSettings`](#schedulersettings)), [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), and an optional `TimeProvider` (`ScheduledJobRunner.cs:40-45`). At run time it resolves [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) per cycle (`:222`) and works against [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext); it emits through [`SchedulerMetrics`](#schedulermetrics) and returns its claim results as [`JobClaim`](#jobclaim). Externals: EF Core (`ExecuteUpdateAsync`), `Microsoft.Extensions.Hosting`, and **Cronos**, aliased as `CronSchedule` (`ScheduledJobRunner.cs:13`).

- **Concept introduced, the claim-lease scheduler.** `[Rubric §29, Resilience & Business Continuity]` assesses whether work survives failure: a schedule that lives in a timer dies with the process, so the schedule lives in a table and the loop only reads it. `[Rubric §12, Performance & Scalability]` assesses scale-out: an interval-driven hosted service runs on **every** replica, so scaling a service to three instances silently triples a purge. The fix is the outbox's claim: a single `ExecuteUpdateAsync` that stamps `LockedUntil` and `LockToken` over a `Where` admitting only unleased-or-expired rows, where the count of matched rows IS the race result (`ScheduledJobRunner.cs:438-450`). Two replicas both issue that update and exactly one matches. `[Rubric §13, Observability & Operability]`: every branch that a human would need to explain later has a `[LoggerMessage]` line, including the ones that do nothing (disabled scheduler, duplicate job name, lease lost). `[Rubric §14, Testability]`: the injected `TimeProvider` plus an `internal` `RunCycleAsync` mean a test drives one whole cycle deterministically without waiting on wall-clock timers (`ScheduledJobRunner.cs:215-216`).

- **Walkthrough**:
  - **State and constants.** `_settings` snapshots `IOptions<SchedulerSettings>.Value` once (`ScheduledJobRunner.cs:47`), and `_timeProvider` falls back to `TimeProvider.System` (`:47`). The three outcome strings `Succeeded`, `Failed` and `Skipped` are named constants (`:50`, `:53`, `:59`), `MaxErrorLength` is 2048 and matches the `LastError` column width (`:62`), `StartupDelay` is 15 seconds so the host finishes module registration and migration before the first cycle touches the table (`:69`), and `MinimumWait` is one second, the floor that stops an overdue row hot-looping the runner (`:72`). `StampTimeout` is five seconds (`:80`), the budget for recording an outcome after a job has returned (see `ExecuteClaimedJobAsync` below).
  - **`ExecuteAsync` (`:83-135`), the loop.** It returns immediately when `Scheduler:Enabled` is false, after one log line (`:85-91`), so a disabled scheduler is visible in the logs of a host that expected it without costing a line per cycle. Then the startup delay (`:93-100`), then forever: run a cycle, and swallow exceptions in two distinct ways. `OperationCanceledException` during shutdown breaks the loop (`:109-113`); any other exception is logged and the loop waits out the interval (`:114-119`), because one bad cycle (an unreachable database, a model mismatch) must not take the scheduler down for the life of the process.
  - **The smart wait.** `ComputeWaitTime` (`:146-160`) is a pure static function: the polling interval when nothing is registered, otherwise the time until the earliest upcoming occurrence, floored at `MinimumWait` and capped at the configured interval. This is the same "sleep until there is something to do" shape [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) uses, and it is what keeps an idle scheduler from polling on a fixed tick.
  - **`RunCycleAsync` (`:213-236`).** One DI scope per cycle. It resolves the registered jobs (`:216`), returns early when there are none (`:217-220`), takes the context for the `Default` logical source on the configured engine through [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (`:222-224`), reconciles registrations, runs due jobs, and finally reads back the earliest `NextRunOn` across the registered names (`:229-235`) which becomes the next wait.
  - **`ResolveRegisteredJobs` (`:243-258`)** groups `GetServices<IScheduledJob>()` by `Name` (ordinal) and keeps the first of each group, logging a collision rather than throwing (`:251-254`). Two jobs sharing a name would share one schedule row, and the design choice is that one mis-registered module must not stop every other job.
  - **`SyncRegistrationsAsync` (`:267-328`)** reconciles the table against the registered jobs. It reads the stored expressions once (`:275-279`), and for each job compares the resolved expression against the stored one: **unchanged means leave the row alone** (`:287-293`), with the comment naming the bug that would otherwise appear, recomputing `NextRunOn` every cycle would push every schedule forward forever and nothing would ever fire. A changed expression goes through the set-based `UpdateScheduleAsync` (`:334-366`) so a row another replica is currently executing is not disturbed by the change tracker; a new job is inserted (`:307-319`). An unparsable expression parks the row at `DateTime.MaxValue` and records `Skipped` instead of throwing (`:295-316`, and on the update path at `:356-365`).
  - **`ResolveCronExpression` (`:170-174`)** is the configuration override point: `Scheduler:Jobs:{Name}:Cron` when present and non-blank, otherwise the job's compiled-in default. `TryGetNextOccurrence` (`:184-205`) wraps Cronos and catches exactly `CronFormatException` and `ArgumentException` (`:197`), converting a malformed expression into a parked row plus an error message rather than a crashed runner.
  - **`RunDueJobsAsync` (`:373-401`)** claims and runs one row at a time, tracking an `attempted` set so each name is tried at most once per cycle (`:378-390`). A [`JobClaim`](#jobclaim) with a null `LockToken` means another replica won that row, so it is skipped rather than retried (`:392-399`).
  - **`TryClaimNextDueAsync` (`:410-448`)** reads the earliest due, unleased row (`:417-424`), mints a `Guid` token and a lease of `Scheduler:LeaseSeconds` from now (`:431-432`), then issues the conditional claim update described above (`:437-445`).
  - **`ExecuteClaimedJobAsync` (`:462-521`)** records the lag (floored at zero so a clock adjustment cannot publish a negative duration, `:472-475`), invokes the job, records duration and the outcome-tagged counter (`:477-482`), then computes the next occurrence **from the instant execution finished, not from the occurrence that just ran** (`:484-488`). That is the missed-run policy: a host down for a day runs each job once on startup and returns to cadence instead of replaying a backlog. The final stamp is guarded by the claim token (`:497-512`): a replica whose lease expired mid-execution matches nothing, logs `LogLeaseLost` and drops its stale outcome (`:514-518`) rather than overwriting the current holder's record. That stamp runs under its own `CancellationTokenSource(StampTimeout, _timeProvider)` (`:500`, passed at `:511`) rather than the host stopping token (the source calls this "the outbox M8 shape"): the doc on `StampTimeout` (`:74-79`) explains that a completed occurrence must always advance its schedule and release its lease, or a graceful stop landing between the job and the stamp would leave the row leased and re-run work that already finished once the lease expires. Building the source from the injected `TimeProvider` keeps that budget testable on a fake clock.
  - **`InvokeJobAsync` (`:528-560`)** resolves the job in a **fresh** DI scope (`:532-534`), exactly like a request, so a job body gets scoped services (a unit of work, repositories, handlers) and the long-lived runner never captures a scoped dependency. A missing job returns `Skipped` with a message (`:536-540`); a cancellation during host shutdown is rethrown so the row stays leased and the occurrence is retried when the lease expires rather than being recorded as a failure it never was (`:548-554`); any other exception is logged and recorded as `Failed` (`:555-559`), so the schedule still advances and a permanently failing job cannot hot-loop. The two shutdown paths are deliberately different: a job interrupted mid-run is retried, while a job that ran to completion gets its stamp under `StampTimeout` regardless of the stopping token.
  - **Log levels are a cost decision.** The per-occurrence start and completion lines are `Debug` (`:586-590`) with the reason stated inline (a busy schedule would otherwise double this runner's steady-state log volume, `[Rubric §31, Cost/FinOps]`, `:583-585`), while every failure line stays `Error` or `Warning` (`:562-596`).

- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) records the decision to extend the durable polling loop already in production instead of adopting Hangfire or Quartz.NET, on the grounds that the missing piece was a cron expression, not a product, and that every extracted service host ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)) would otherwise have to reason about a new dependency. Cron parsing is the one thing bought rather than built (Cronos, MIT, zero-dependency).

- **Where it's used**: registered by `AddScheduledJobs` through `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` (`MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:46-47`), deliberately not `AddHostedService`, since the latter appends a descriptor per call and two modules calling it would run two runners racing for the same rows (`DependencyInjection.Jobs.cs:44-46`). The framework's own scheduled job is [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob), registered by `AddAuditTrail` (`DependencyInjection.Jobs.cs:124`). `ScheduledJobRunnerTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/ScheduledJobRunnerTests.cs:21`) drives whole cycles through the internal entry point via a shared `SchedulerTestHarness` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs`), and `SchedulerModelGateTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:25`) pins the model gate.

- **Caveats / not-in-source**: which hosts actually call `AddScheduledJobs` and set `Scheduler:Enabled` lives in the downstream apps, not in this repository, so the set of deployments running a schedule today is Not determinable from source here.

---

### IBrokerMessageConsumer

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IBrokerMessageConsumer.cs:12` · Level 2 · interface (internal)

- **What it is**: the non-generic entry point the receive pipeline dispatches a deserialized event through. Its one member, `ConsumeAsync(IIntegrationEvent, IReadOnlyDictionary<string, string> headers, CancellationToken)` (`IBrokerMessageConsumer.cs:19`), lets [`BrokerReceivePipeline`](#brokerreceivepipeline) call the closed consumer for a subscription's runtime type without reflection per message (`IBrokerMessageConsumer.cs:5-11`).
- **Depends on**: [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) and the BCL only. The headers arrive as a plain string dictionary, so nothing broker-specific crosses this boundary.
- **Concept introduced, a typed consumer behind a non-generic door.** `[Rubric §10, Messaging & Integration Architecture]` assesses whether the consume path is independent of the transport. The pipeline only learns the event's CLR type at run time (from the event-name header), so it cannot call a generic `ConsumeAsync<TEvent>` directly. Both consumers implement this interface **explicitly** and forward to their own typed method with one cast, so the typed API stays the public face and the pipeline resolves the consumer once per attempt as `(IBrokerMessageConsumer)scope.ServiceProvider.GetRequiredService(consumerType)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:235`).
- **Walkthrough**
  - `ConsumeAsync(integrationEvent, headers, cancellationToken)` (`IBrokerMessageConsumer.cs:19`): the task completes when every handler has run and faults when one failed (`:18`); that fault is what drives the pipeline's retry.
- **Where it's used**: implemented by [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:44`, explicit forward at `:138`) and [`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent) (`UpcastingIntegrationEventConsumer.cs:33`, explicit forward at `:140-144`); called by [`BrokerReceivePipeline`](#brokerreceivepipeline).

---

### EventUpcasterStartupValidator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/EventUpcasterStartupValidator.cs:20` · Level 3 · class (internal sealed)

- **What it is**: a one-method `IHostedService` whose entire job is to resolve [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) at host start, so a bad upcaster registration graph fails the host instead of dead-lettering the first retired-contract message hours later (`EventUpcasterStartupValidator.cs:7-12`).
- **Depends on**: [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) as its single primary-constructor parameter (`EventUpcasterStartupValidator.cs:20`), `Microsoft.Extensions.Hosting.IHostedService`, and [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) as the type it probes with.
- **Concept introduced, validation by construction, forced by resolution.** `[Rubric §15, Best Practices and Code Quality]` assesses whether invariants are checked at the earliest possible moment, and `[Rubric §13, Observability and Operability]` assesses whether a misconfiguration is discoverable. The validation itself does not live here: [`EventUpcasterRegistry`](group-03-querying-specifications.md#eventupcasterregistry) validates its whole registration graph in its constructor, rejecting a duplicate source, a type mapped onto itself, and a cycle, with a message naming the offenders. Since DI is lazy, that constructor might not run until the first broker message arrives. This class exists purely to make it run at start. That is the fail-fast configuration posture of [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) applied to a graph that options validation cannot express.
- **Walkthrough**
  - `StartAsync` (`EventUpcasterStartupValidator.cs:23-30`) discards the result of `upcasters.ResolveTerminalType(typeof(IIntegrationEvent))` (`:27`) and returns a completed task. The comment at `:25-26` explains why the call exists at all: the real work happened in the injected registry's constructor, and reading one member is what makes the dependency impossible to elide.
  - `StopAsync` (`EventUpcasterStartupValidator.cs:33`) is a completed task. There is nothing to unwind.
- **Why it's built this way**: the registration is the other half of the design, and its comment is explicit (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:227-231`): `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, EventUpcasterStartupValidator>())`, **not** `AddHostedService`, because two modules calling `AddInfrastructure` must not run the same validation twice. `TryAddEnumerable` de-duplicates on the implementation type, which `AddHostedService` does not. The class doc adds the cost note (`EventUpcasterStartupValidator.cs:13-17`): a host with no upcasters resolves an empty registry, and the whole mechanism costs one no-op call at start ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)).
- **Where it's used**: registered once inside `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:231`), so every host that calls it gets the check. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/EventUpcasterStartupValidatorTests.cs`.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### UpcastDispatch

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastDispatch.cs:15` · Level 3 · class (internal static)

- **What it is**: the dispatch cache behind [`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent). Per terminal event type it memoizes the closed [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent) interface and a compiled invoker for its `HandleAsync` (`UpcastDispatch.cs:7-14`).
- **Depends on**: [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent); externals `System.Collections.Concurrent` and `System.Linq.Expressions` (`UpcastDispatch.cs:1-2`).
- **Concept**: the compiled-invoker technique [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) uses for the in-process path, applied to the broker path. `[Rubric §12, Performance & Scalability]` assesses whether per-message cost stays flat. The terminal type is only known at run time, because it depends on which upcasters the host registered, so handler resolution is non-generic; compiling an expression once per type keeps reflection off the per-message path. The class is non-generic **on purpose**, so every closed consumer type shares one cache instead of each `UpcastingIntegrationEventConsumer<TEvent>` closure holding its own (`UpcastDispatch.cs:12-13`).
- **Walkthrough**
  - `Cache` (`UpcastDispatch.cs:17-19`): a `ConcurrentDictionary<Type, (Type ClosedHandlerType, Func<object, object, CancellationToken, Task> Invoker)>`.
  - `For(Type terminalType)` (`UpcastDispatch.cs:24-29`): `GetOrAdd` with a `static` factory that closes `IIntegrationEventHandler<>` over the type and calls `BuildInvoker`.
  - `BuildInvoker(Type eventType)` (`UpcastDispatch.cs:39-59`): looks up `HandleAsync` on the closed interface, throwing `InvalidOperationException` if it is missing (`:42-43`), then builds `(object handler, object integrationEvent, CancellationToken ct) => ((IIntegrationEventHandler<T>)handler).HandleAsync((T)integrationEvent, ct)` as an expression tree and compiles it (`:57-58`).
- **Why it's built this way**: a static field on the generic consumer would be one field per closed type; a separate non-generic class is what lets the cache be shared across every closed consumer type, as the class doc states (`UpcastDispatch.cs:12-13`).
- **Where it's used**: one call, `UpcastDispatch.For(terminalType)` in `UpcastingIntegrationEventConsumer<TEvent>.ConsumeAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:97`).

---

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/NullFileStorageService.cs:14` · Level 4 · class (public sealed)

- **What it is**: the unconfigured default for [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice). Uploads fail with a clear, stable error; deletes succeed, because there is nothing stored to delete (`NullFileStorageService.cs:6-14`).
- **Depends on**: [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) as the contract and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) for its returns.
- **Concept**: the null-object default introduced at [`NullNativePushSender`](#nullnativepushsender), with one instructive difference. `[Rubric §29, Resilience and Business Continuity]` assesses whether a missing capability degrades predictably. This null object is **not** uniformly silent: the two operations are treated asymmetrically because their meanings differ. A caller that wanted to store something and got nothing must be told (an upload that silently succeeded while storing nothing would leave a dangling URL in the database), whereas a caller that wanted something gone already has what it asked for.
- **Walkthrough**
  - `IsConfigured` returns `false` (`NullFileStorageService.cs:17`), the flag the interface offers so a handler can gate a feature (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:17-18`).
  - `UploadAsync(blobName, content, contentType, ct)` and the `FileUploadOptions` overload `UploadAsync(blobName, content, contentType, options, ct)` (`NullFileStorageService.cs:20-21`, `:22-23`) both simply return `NotConfigured()`: the extra options parameter changes nothing about a store that never stores anything. The options overload carries the same grandfathered `RS0026` suppression as its Azure sibling (`:21`), since changing a shipped public signature would be a breaking change.
  - `DeleteAsync` (`NullFileStorageService.cs:29-30`) returns success.
  - `NotConfigured()` (`NullFileStorageService.cs:32-36`) is the private helper both upload overloads share: a failed [`Result`](group-01-result-error-handling.md#result) carrying `Error.Failure` with code `FileStorage.NotConfigured`, a message naming the actual condition ("No file storage is configured for this host"), and `source` set to the type name. Factoring it out is what let the second overload's implementation be a one-line forward when `FileUploadOptions` was added to the interface.
- **Why it's built this way**: the class doc says it directly (`NullFileStorageService.cs:7-9`), feature endpoints degrade cleanly. Because the failure is a [`Result`](group-01-result-error-handling.md#result) and not an exception ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)), an avatar upload in a host with no storage configured returns a clean error response instead of a 500, and the same code path works whether or not the deployment has provisioned a storage account ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: registered by `AddInfrastructure` through `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:385`), replaced by [`AzureBlobFileStorageService`](group-28-common-cloud-provider-adapters.md#azureblobfilestorageservice) when `AddAzureBlobFileStorage` finds a complete `FileStorage` section (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:44-71`). It is also the storage the ADC profile E2E suite runs against (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs`), and both upload overloads are exercised by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Storage/FileUploadOptionsOverloadTests.cs`.
- **Caveats / not-in-source**: nothing inside MMCA.Common reads `IsConfigured`; the two declarations are the ones in this unit (`NullFileStorageService.cs:17` and `AzureBlobFileStorageService.cs:25`). The flag is exercised downstream: MMCA.ADC's [`UploadSessionAssetHandler`](group-18-conference-application.md#uploadsessionassethandler) checks it before touching storage and returns its own `SessionAsset.StorageNotConfigured` failure, whose message steers the user to add a link instead (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/UploadFile/UploadSessionAssetHandler.cs:56-62`). The avatar path still discovers the unconfigured state from the failed upload result.

---

### UserEmailResources

> MMCA.Common.Application · `MMCA.Common.Application.Users.Emails` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/Emails/UserEmailResources.cs:15` · Level 4 · class (internal static)

- **What it is**: the localization helper behind the default account emails (forgot-password and email-confirmation). It looks up subject and body text from a `.resx` set by key, formats the one/other plural form of the code-lifetime sentence, and can run the composition of an email under the recipient's stored culture (`UserEmailResources.cs:15`, `:29`, `:46-48`, `:60-61`).
- **Depends on**: `System.Resources.ResourceManager` bound to the class's own resource set (`:17`), `IUserPreferences.PreferredCulture` to read the recipient's stored language, and `SupportedCultures.ResolveClosest` to map it to the nearest supported culture (`:33`).
- **Concept introduced, the email is written in the recipient's language, not the requester's.** Text that leaves the request (an email sent to someone else's address) should honor that person's locale. `InRecipientCulture<T>(recipient, compose)` (`UserEmailResources.cs:29-44`) saves `CultureInfo.CurrentUICulture`, switches it to the recipient's resolved preference when `recipient` is an `IUserPreferences` with a non-blank `PreferredCulture`, runs `compose`, and restores the previous culture in a `finally`. Without a stored preference the request's culture stays in force. Because it sets the current UI culture, both the default `.resx` text and any app override that reads the current UI culture speak the recipient's language.
- **Walkthrough**
  - `InRecipientCulture<T>(object recipient, Func<T> compose)` (`:29-44`): the culture scope described above.
  - `Get(key)` (`:46-48`): `ResourceManager.GetString` in the current UI culture, falling back to the neutral English text when a translation is missing, and throwing `InvalidOperationException` naming the key when the key itself is absent.
  - `Plural(key, count, params args)` (`:60-61`): picks `{key}.One` when `count == 1` and `{key}.Other` otherwise, then formats with the invariant culture. It applies the same one/other split `StringLocalizerPluralExtensions` applies to the UI resources ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Why it's built this way**: the account email handlers are framework base classes, so their default copy has to be translatable without each app shipping its own resources; keeping the helper `internal static` keeps the key vocabulary private to the two handler bases while apps override `ComposeSubject` and the body builders when they want their own text.
- **Where it's used**: `ForgotPasswordHandlerBase` (`ForgotPasswordHandlerBase.cs:82`, `:117`, `:132-137`; see [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)) and `SendEmailConfirmationHandlerBase` (`SendEmailConfirmationHandlerBase.cs:111`, `:137`, `:152-157`), both under `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases`.
- **Caveats / not-in-source**: the `.resx` key list and the set of supported cultures are not read here; whether every key has a translation in every supported culture is not determinable from this source.

---

### DeleteUserPushInstallationsInternalCommand

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserPushInstallationsInternalCommand.cs:18` · Level 4 · record (public sealed)

- **What it is**: the durable instruction to delete every native-push installation an erased account owns, so a device still signed in elsewhere stops receiving pushes addressed to it (`DeleteUserPushInstallationsInternalCommand.cs:5-8`). Its whole payload is `UserId` (`:18`).
- **Depends on**: [`IInternalCommand`](#iinternalcommand) as its contract and [`InternalCommandNameAttribute`](#internalcommandnameattribute), which pins the stable queue name `"MMCA.Users.DeletePushInstallations.v1"` (`DeleteUserPushInstallationsInternalCommand.cs:17`); the `UserIdentifierType` alias.
- **Concept**: the internal command introduced at [`IInternalCommand`](#iinternalcommand) ([ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)), used here for the part of an erasure that lives outside the database. `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether erasure reaches every copy of personal data. A push installation is held by the push provider ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), outside the unit of work, so it cannot be anonymized in the same save; scheduling this command inside the erasure's unit of work makes the instruction commit with the anonymized account or roll back with it, and the processor retries it until the provider answers (`DeleteUserPushInstallationsInternalCommand.cs:9-14`).
- **Walkthrough**: a positional record with one property; the remarks note that the user id alone round-trips through JSON, as the queue requires (`:14`).
- **Where it's used**: scheduled by [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) when the subclass forwards an [`IInternalCommandScheduler`](#iinternalcommandscheduler) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:195-204`); run by [`DeleteUserPushInstallationsInternalCommandHandler`](#deleteuserpushinstallationsinternalcommandhandler).

---

### DeleteUserPushInstallationsInternalCommandHandler

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserPushInstallationsInternalCommandHandler.cs:21` · Level 5 · class (internal sealed partial)

- **What it is**: the handler that runs [`DeleteUserPushInstallationsInternalCommand`](#deleteuserpushinstallationsinternalcommand) by deleting the erased account's installations through the host's [`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar) (`DeleteUserPushInstallationsInternalCommandHandler.cs:7-10`).
- **Depends on**: [`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar) and `ILogger<T>` as primary-constructor parameters (`:21-23`); implements [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) over [`Result`](group-01-result-error-handling.md#result) (`:24`).
- **Concept**: at-least-once execution demands idempotency. The remarks spell out the contract (`DeleteUserPushInstallationsInternalCommandHandler.cs:12-17`): installations already deleted are simply no longer found, so a rerun is harmless; a failure is returned unchanged so the row stays on the processor's backoff, because a push provider outage is exactly what the durable queue exists to survive.
- **Walkthrough**
  - `HandleAsync(command, cancellationToken)` (`:27-42`): guards the command (`:29`), calls `registrar.DeleteAllForUserAsync(command.UserId, ...)` (`:31`), logs one line per outcome (`:32-39`), and returns the registrar's result as-is (`:41`).
  - `LogInstallationsDeleted` at Information and `LogInstallationsDeleteFailed` at Warning (`:44-48`), source-generated `[LoggerMessage]` methods (hence `partial`), each carrying the user id only.
- **Where it's used**: registered by `AddApplication()` with `TryAddScoped` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:64`), so a host needs no registration of its own; the internal-command processor resolves it like any other command handler, so the decorator pipeline applies. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UseCases/DeleteUser/DeleteUserPushInstallationsInternalCommandHandlerTests.cs`.
- **Caveats / not-in-source**: the command runs on the host that wrote the row. On a host with no push adapter the registrar is the inert [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) and the command completes having deleted nothing (`:15-17`), so the host that schedules it must be the one that registers the adapter.

---

### ConsumerOriginRestore

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/ConsumerOriginRestore.cs:20` · Level 6 · class (internal static)

- **What it is**: the consumer-side half of context propagation. It reads the five origin headers off a delivered message and restores them onto the per-message scope through [`AmbientOrigin.Restore`](#ambientorigin), so a broker-delivered handler sees the identity, tenant and correlation id an in-process dispatch would have seen; a message carrying no headers (an older publisher, or an event raised with no user) leaves the scope's defaults untouched (`ConsumerOriginRestore.cs:7-12`, `:22-26`).
- **Depends on**: [`AmbientOrigin`](#ambientorigin) for the actual restore, [`MessageHeaders`](group-08-auth.md#messageheaders) for the five header names, `IServiceProvider`, and the `UserIdentifierType` alias with its `TryParse`. The headers arrive as an `IReadOnlyDictionary<string, string>` (`:31`), the transport-neutral shape every transport hands the receive pipeline.
- **Concept introduced, parsing rather than trusting a typed header.** `[Rubric §10, Messaging & Integration Architecture]` assesses whether the pipeline handles transport differences correctly rather than assuming one broker's behavior. The user id is transported as text and parsed back with `UserIdentifierType.TryParse` under the invariant culture (`ConsumerOriginRestore.cs:37-43`). A malformed value is treated as a publisher bug, not a reason to fail the consume, so it simply yields no identity rather than throwing (`:35-36`).
- **Walkthrough**
  - `Apply(headers, services, authenticationType)` (`ConsumerOriginRestore.cs:31-53`) throws on null `headers` (`:33`), parses `MessageHeaders.UserId`, defaulting to null on failure (`:37-43`), and returns an `IDisposable`: the handle that withdraws the published origin, which the caller holds for the whole consume (`:30`).
  - It returns `AmbientOrigin.Restore` with that id and the remaining four headers, `UserRoles`, `UserPermissions`, `TenantId`, and `CorrelationId`, read straight through as strings (`ConsumerOriginRestore.cs:45-52`), so the handle is [`AmbientOrigin`](#ambientorigin)'s own restore handle passed through unchanged.
  - `Get(headers, name)` (`:55-56`): `TryGetValue`, null when the header is absent.
- **Why it's built this way**: keeping the header-reading and the id-parsing in this one adapter, separate from [`AmbientOrigin`](#ambientorigin) itself, means the restore logic stays transport-agnostic while this class is the one step of the restore that knows about a transport (`ConsumerOriginRestore.cs:14-18`).
- **Where it's used**: called by [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent) and [`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent) (`UpcastingIntegrationEventConsumer.cs:64`), the two consumers [`BrokerReceivePipeline`](#brokerreceivepipeline) dispatches to, both before touching the inbox, so a retired contract is restored under the same identity and tenant its plain-consumer sibling would have used. Also referenced by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/BrokerMessageBusTests.cs`.

---

### DeleteUserHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:96` · Level 8 · class (abstract)

- **What it is**: the shared account-erasure workflow: authorize owner-or-privileged-role, soft-delete
  the account, run the app's tail hook, irreversibly anonymize the personal data in place, revoke and
  anonymize the account's refresh-session rows, blank its email on the support access log, schedule
  the deletion of its native-push installations, save, write the shared soft-deleted marker that
  revokes the account's already-issued access tokens, then drain a post-save queue
  (`DeleteUserHandlerBase.cs:14-26`, `:118-229`). It exposes one abstract member and one virtual hook.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an
  [`ISoftDeletedUserMarkerWriter`](group-08-auth.md#isoftdeletedusermarkerwriter) and an `ILogger`,
  then four optional parameters that default to null: an
  [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore) (refresh sessions are opt-in), a
  `TimeProvider`, an [`IViewAsGrantStore`](group-08-auth.md#iviewasgrantstore) and an
  [`IInternalCommandScheduler`](#iinternalcommandscheduler) (`:96-103`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:103`). The session helper is the shared
  [`RefreshSessionRevocation`](group-08-auth.md#refreshsessionrevocation) (`:177-179`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IErasableUser`](group-08-auth.md#ierasableuser) (`:104`), and `TCommand` is an
  [`IUserOwnedRequest`](#iuserownedrequest) (`:105`), not an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest): this workflow needs the
  *caller* as well as the target, and carries no request payload. It also uses
  [`UserOwnershipRule`](#userownershiprule), [`Error`](group-01-result-error-handling.md#error) and
  [`DeleteUserPushInstallationsInternalCommand`](#deleteuserpushinstallationsinternalcommand), and logs
  through two private source-generated `[LoggerMessage]` methods, `UserErased` at Information
  (`:262-263`) and `SoftDeletedMarkerFailed` at Warning (`:265-266`), hence the `partial` declaration
  (`:96`). Externals: `Microsoft.Extensions.Logging` (`:1`).

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

  **Concept introduced: interface dispatch as a correctness device.** The comment at `:148-150`
  states the rule briefly: the base calls `Delete()` through an `IErasableUser` local
  (`:151-152`), so interface dispatch runs the `Delete()` the app type maps onto `IErasableUser`, and
  a `User` that forgets the interface fails the `TUser` constraint at compile time. The reason it
  matters: an app's `User` may *hide* the base entity's `Delete()` with `public new Result Delete()`.
  A hidden method is not an override, and member lookup on a generic type parameter prefers the
  members of its **class** constraint, so a bare `user.Delete()` here would bind to
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)`.Delete()`
  and silently skip the app's version. The interface's own remarks record the same reasoning from the
  contract side (`IErasableUser.cs:13-23`), including the deliberate choice not to implement it on the
  base entity (`IErasableUser.cs:18-19`).

  **Concept introduced: the post-save queue.** `OnAfterSoftDeleteAsync` receives an
  `ICollection<Func<CancellationToken, Task>> afterCommit` (`:255-260`). Work that must not happen
  unless the erasure is actually saved (deleting a blob, notifying another system) is *enqueued* rather
  than run inline, and the base drains the queue in order after the save and the marker write
  (`:221-224`). The override can hand values it captured before anonymization to a post-save closure
  without parking them in mutable handler state (`:53-55`), which matters because a scoped handler's
  field would be shared mutable state for the whole request. The class summary is precise about what
  "after" means: under an `ITransactional` command the save is not the commit, so the marker and every
  `afterCommit` action run *before* the transaction commits, and only idempotent, retry-safe work
  belongs there; anything that must survive with the erasure should be scheduled as an internal command
  inside the unit instead (`:22-25`, repeated on the parameter at `:245-252`).

  **Concept introduced: token revocation as part of the shared workflow, best effort and first.**
  Between the save and the queued actions the base writes the shared soft-deleted marker through
  `markerWriter.MarkDeletedAsync` (`:214`), which is what stops an erased account's already-issued
  access token from working before the next database lookup would notice; the API middleware reads
  [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) on every host, and on a host without
  the soft-deleted-user validator query the marker is the only thing that rejects such a token
  (`:29-32`, [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)).
  The writer sizes the marker to outlive every access token issued before the erasure, and
  `AddApplication` registers it (`:67-70`). Two decisions are documented on the class and are worth
  reading as a pair. It is **best effort** (`:33-37`): the erasure is already saved, so a cache fault
  must not turn a successful, irreversible deletion into a failure the caller would retry, and the
  write is wrapped in a `try`/`catch` (excluding `OperationCanceledException`) that logs
  `SoftDeletedMarkerFailed` and continues (`:212-219`). The warning text states the consequence: the
  Identity host still rejects the deleted user's access token, but a host without the account-status
  query accepts it until it expires (`:265-266`). And it runs **before** the queued actions (`:40-43`),
  because that tail is unbounded app work and every second it takes is a second the deleted account's
  token still works. Owning the marker here rather than in each app's tail gives both apps the
  identical revocation window; the hook's own docs tell an override not to queue a marker write
  (`:250-251`).

  **Concept introduced: personal data held beside the account is erased in the same unit.** Three
  optional steps run after the user's own `Anonymize()` and before the save, each a no-op when the
  subclass forwards nothing:
  - Refresh sessions (`:172-179`): a session stores the IP address and user agent captured at
    sign-in, on revoked rows as much as live ones. `RefreshSessionRevocation.RevokeAndAnonymizeAllAsync`
    revokes every un-revoked session and anonymizes every row; the store hands back tracked rows on the
    same context factory, so the changes commit or roll back with the erasure in the one save (`:206`).
  - The support access log (`:181-188`): `viewAsGrants.ForgetUserAsync` blanks the account's email
    snapshot on every view-as grant naming it, as staff or as the viewed account; the grant rows
    themselves stay until `ViewAs:RetentionDays` sweeps them
    ([ADR-137](https://ivanball.github.io/docs/adr/137-read-only-view-as-support-access.html)).
  - Native-push installations (`:190-204`): these live with the push provider, outside the unit of
    work, so the base schedules a
    [`DeleteUserPushInstallationsInternalCommand`](#deleteuserpushinstallationsinternalcommand) through
    the scheduler instead of calling the provider inline. The row commits with the erasure and the
    processor retries it until the provider answers
    ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html),
    [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)). A
    scheduling failure fails the erasure (`:200-203`), because a partial erasure reported as a success
    is worse than a retryable failure (`:193-194`).

  `[Rubric §30: Compliance, Privacy & Data Governance]` assesses whether a data-subject erasure
  request is actually satisfiable. The sequence here is the mechanism behind both apps' published
  erasure promise: soft-delete, then irreversible anonymization of the account and the rows beside it,
  persisted in one save (`:14-21`).

  `[Rubric §11: Security]` assesses authorization placement. The very first thing the method does,
  before it touches the repository, is the ownership check (`:124-134`), so an unauthorized caller
  cannot even confirm that an account id exists. The privileged-role test is passed in already
  evaluated because each app owns its own role vocabulary (`UserOwnershipRule.cs:14-18`).

  `[Rubric §1: SOLID]` assesses the template-method shape. The invariant order (authorize, load,
  delete, tail, anonymize, session revoke-and-anonymize, view-as forget, push-deletion schedule, save,
  token revoke, queued actions) is fixed by the base; only the two hooks vary.

- **Walkthrough**: two protected members, the handler method, two hooks and two log methods.
  - Primary constructor (`:96-103`): `unitOfWork`, `markerWriter`, `logger`, and the optional
    `refreshSessions`, `timeProvider`, `viewAsGrants` and `internalCommandScheduler`. `UnitOfWork`
    (`:108`) is protected specifically so a tail hook can enlist further aggregates.
  - `HandlerName` (`:115`): `GetType().Name` by default, so an app subclass named
    `DeleteUserHandler` reports that name as the error `source` (`:110-114`).
  - `HandleAsync(TCommand, CancellationToken)` (`:118-229`):
    - Authorization first (`:124-130`) through
      [`UserOwnershipRule.CheckOwnership`](#userownershiprule) (`UserOwnershipRule.cs:37`), with the
      code `"User.DeleteForbidden"` and a message the caller sees; a non-null return is the failure
      (`:131-134`).
    - Load through the write repository (`:136-137`); `Error.NotFound` when absent (`:140`).
    - `IErasableUser erasable = user; erasable.Delete()` (`:151-152`) with the dispatch rationale
      above; a failure returns immediately (`:153-156`). The comment there points forward to the
      session handling: refresh sessions are revoked and anonymized further down, not left to the app
      (`:145-146`).
    - Allocate the `afterCommit` list and call `OnAfterSoftDeleteAsync` (`:158-159`); a failed tail
      aborts before anything is persisted (`:160-163`).
    - `erasable.Anonymize()` (`:166`), also short-circuiting on failure (`:167-170`).
    - `RefreshSessionRevocation.RevokeAndAnonymizeAllAsync(refreshSessions, timeProvider, ...)`
      (`:177-179`), a no-op when no store was forwarded; then `ForgetUserAsync` when a grant store
      was forwarded (`:185-188`); then the push-deletion schedule when a scheduler was forwarded
      (`:195-204`).
    - `SaveChangesAsync` (`:206`), then the best-effort marker write (`:212-219`), then the queued
      actions drained in order (`:221-224`), then the `UserErased` log (`:226`) and
      `Result.Success()` (`:228`).
  - `HasDeletePrivilege(string? currentUserRole)` (`:237`): `protected abstract`. Deliberately
    abstract rather than virtual-defaulting-to-false, so adopting the base forces an explicit answer
    about which role bypasses ownership; its XML doc names `UserRole.IsAdmin(...)` only as an example
    of "whatever the app's privileged role is" (`:231-236`).
  - `OnAfterSoftDeleteAsync(user, command, afterCommit, cancellationToken)` (`:255-260`): `protected
    virtual`, defaulting to `Task.FromResult(Result.Success())`; returning a failure aborts the erasure
    before anything is persisted (`:240-241`). Its position is load-bearing and documented: it runs
    **after** `Delete()` and **before** `Anonymize()` (`:49-52`), which is the only point where an
    override can both read personal data that anonymization is about to erase and enlist further
    aggregates in the same unit of work. Running it after `Delete()` rather than before means an
    already-deleted account fails with its own `AlreadyDeleted` error rather than one raised by a
    cascaded aggregate (`:59-61`).

- **Why it's built this way**: the hook contract was derived from what the two apps actually needed,
  and both uses are visible in their overrides. ADC's override
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:53-84`)
  captures the avatar blob name *before* anonymization clears the URL (`DeleteUserHandler.cs:61`),
  raises the cross-service `UserDeleted` event on the aggregate so its outbox row is written by the
  very save that commits the erasure (`:69`), and schedules the avatar blob deletion as a durable
  internal command through [`IInternalCommandScheduler`](#iinternalcommandscheduler) inside the
  erasure transaction rather than queueing it on `afterCommit`, so an erasure that persists can never
  lose the instruction to delete the photo (`:71-81`, `:86` onward).
  Store instead cascades in the same unit of work, erasing the linked `Customer` that holds its
  name/email/address PII and returning the Customer's own failure untouched so nothing is persisted
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:56` onward).
  One hook covers both because it can do work inline *and* schedule work for after the save.

- **Where it's used**: subclassed once per app, each supplying its own privileged role to
  `HasDeletePrivilege` and forwarding what it has. ADC
  (`MMCA.ADC/.../DeleteUser/DeleteUserHandler.cs:35-43`) forwards the marker writer, the refresh-session
  store, the view-as grant store and its scheduler, with `HasDeletePrivilege` returning
  `UserRole.IsOrganizer(...)` (`:49-50`). Store (`MMCA.Store/.../DeleteUser/DeleteUserHandler.cs:36-42`)
  forwards the marker writer, the refresh-session store and the scheduler, but no grant store, with
  `UserRole.IsAdmin(...)` (`:45-46`); its own doc notes Store registers no push adapter, so the push
  command completes having deleted nothing there (`:31-35`). `AddApplication()` registers the push command's handler
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:64`). Covered directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs`, whose
  fixture user type is `TestHidingDeleteUser`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs`) precisely so
  the hidden-`Delete()` dispatch rule above is a regression test rather than a comment.

- **Caveats**: queued `afterCommit` actions run after the erasure has been saved, so each one owns its
  own failure handling; the base does not wrap them (`:221-224`, and see the documented expectation at
  `:245-252`). Under an `ITransactional` command they, and the marker, run before the commit
  (`:22-25`). The one exception to "not wrapped" is the marker write the base performs itself, which it
  does wrap (`:212-219`). Both apps' `DeleteUserCommand` records are
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), so the cache prefix they carry
  is invalidated by the decorator after the handler returns success, outside this class.

---

### UpcastingIntegrationEventConsumer<TEvent>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:29` · Level 8 · class (public sealed partial, generic)

- **What it is**: the draining consumer for a **retired** integration-event contract. It receives the old type from the host's queue, upcasts each message to its terminal contract, and invokes the handlers registered for that terminal contract, so handlers are written once against the newest event type while producers still publishing the old one (and messages already queued at the upgrade) keep being delivered (`UpcastingIntegrationEventConsumer.cs:10-20`).
- **Depends on**: [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry), `IServiceProvider`, [`IInboxStore`](group-04-events-outbox.md#iinboxstore), and `ILogger<T>` as its four primary-constructor parameters (`UpcastingIntegrationEventConsumer.cs:30-33`); implements [`IBrokerMessageConsumer`](#ibrokermessageconsumer) (`:33`); [`EventNameResolver`](group-04-events-outbox.md#eventnameresolver) for the inbox key; [`ConsumerOriginRestore`](#consumeroriginrestore) to restore the publisher's identity, tenant, and correlation id before the inbox is touched; [`UpcastDispatch`](#upcastdispatch) for the per-terminal-type handler invoker.
- **Concept introduced, contract retirement without a coordinated deploy.** `[Rubric §6, CQRS and Event-Driven]` assesses whether the event pipeline can evolve its contracts, and `[Rubric §7, Microservices Readiness]` assesses whether two services can be deployed independently. Renaming or reshaping an integration event across a distributed system normally forces a lockstep deploy, because in-flight messages of the old shape have no handler on the other side. [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html) resolves that with a registered [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster) chain plus this consumer: the old subscription stays bound and drains, each message walks the upcaster chain to the terminal type, and the handler code only ever knows the newest contract. The current contract keeps using the plain [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent), and the builder refuses to register both kinds for the same type (`UpcastingIntegrationEventConsumer.cs:17-19`; the check itself is [`BrokerConsumerBuilder`](#brokerconsumerbuilder)'s duplicate guard).
- **Concept, dedup keyed on the original message id.** `[Rubric §12, Performance & Scalability]` assesses whether idempotency is applied uniformly rather than per handler. Idempotent consumption ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)) keys on the message id carried in the envelope. The doc (`UpcastingIntegrationEventConsumer.cs:22-25`) records that the registry preserves the envelope across every upcast hop, so the id this consumer records is the same id a plain consumer would have recorded, and a redelivery is recognised whatever contract the handlers ultimately see.
- **Concept, restoring the publisher's origin before the inbox is touched.** `[Rubric §11, Security]` and `[Rubric §8, Data Architecture]` both apply here: under database-per-tenant, the inbox store's own routing depends on the tenant this restore sets. `PrincipalAuthenticationType` (`UpcastingIntegrationEventConsumer.cs:36-41`) is declared as the same constant [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent) uses, because an upcast changes the contract, never the hop the identity came back from. `ConsumeAsync` calls [`ConsumerOriginRestore.Apply`](#consumeroriginrestore) (`:59-64`) before the dedup check for exactly the reason the sibling consumer does it in the same order: a retired contract is delivered with the same headers as a current one, so a consumer that skipped this would run its handlers anonymous while its sibling did not. The returned handle is bound with `using var origin` and so held for the whole consume (`:63-64`), which lets a handler's own scope inherit the origin too.
- **Walkthrough**
  - `ConsumeAsync(integrationEvent, headers, cancellationToken)` (`UpcastingIntegrationEventConsumer.cs:51-137`) guards both arguments (`:56-57`), restores the publisher's origin first via [`ConsumerOriginRestore.Apply`](#consumeroriginrestore) (`:64`), then takes `integrationEvent.MessageId` **before** any upcasting (`:68`), which is the point of the earlier concept paragraph on dedup.
  - The inbox key is `EventNameResolver.GetInboxName(typeof(TEvent))` (`UpcastingIntegrationEventConsumer.cs:72`), the retired contract's `[EventName]` identity when it declares one and its short type name otherwise, which is what every row written so far holds (`:70-71`).
  - `inbox.TryBeginAsync(...)` returning `false` means already processed: log at Debug and return (`UpcastingIntegrationEventConsumer.cs:76-80`). `TryBegin` also **stages** the inbox row in the scope's unit of work; it is written by `CompleteAsync` once every handler has succeeded (`:74-75`), as in `IntegrationEventConsumer`.
  - With no upcaster registered for the type, the consumer logs at Information and continues (`UpcastingIntegrationEventConsumer.cs:82-87`). This is the documented degrade path: the registry returns the instance untouched, and handlers for the original type run as usual.
  - `UpcastToTerminal` produces the terminal instance, and a type change is logged at Debug with both contract names (`UpcastingIntegrationEventConsumer.cs:89-95`).
  - Handler dispatch is non-generic because the terminal type is only known at runtime: `UpcastDispatch.For(terminalType)` (`UpcastingIntegrationEventConsumer.cs:97`) returns the closed `IIntegrationEventHandler<>` interface and a compiled invoker, memoized per terminal type in [`UpcastDispatch`](#upcastdispatch), so reflection is paid once per contract instead of once per message. This mirrors what [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) does for the in-process path.
  - The dispatch loop (`UpcastingIntegrationEventConsumer.cs:101-125`) counts handlers and awaits each invoker (`:112`). Its `catch` (`:114-124`) is the failure contract: `inbox.Abandon(messageId)` discards the staged row so the redelivery is reprocessed rather than skipped as a duplicate (`:118`), the handler failure is logged with the handler's full type name, and the exception is **rethrown** (`:123`) so the receive pipeline retries in a fresh scope, then redelivers or dead-letters (`:120-121`; the mechanism is [`BrokerReceivePipeline`](#brokerreceivepipeline)). `OperationCanceledException` is excluded from the catch filter, so a shutdown is not treated as a handler failure.
  - Zero handlers is an Information log, not an error (`UpcastingIntegrationEventConsumer.cs:127-132`): returning normally completes the message, and the comment states plainly that the broker will not retry.
  - `inbox.CompleteAsync(...)` (`UpcastingIntegrationEventConsumer.cs:136`) persists the staged row unless a handler's own save already committed it. The message is recorded only on a successful consume, because the failure path above rethrows.
  - The explicit `IBrokerMessageConsumer.ConsumeAsync` (`UpcastingIntegrationEventConsumer.cs:140-144`) casts the event to `TEvent` and forwards, which is how the non-generic pipeline reaches the typed method.
- **Why it's built this way**: the alternative to a per-retired-type consumer is version-tolerant handlers, each branching on a schema version, which spreads the migration across every handler and never gets cleaned up. Concentrating it in one registered consumer per retired contract means the retirement is visible in one place in a host's broker registration and can be deleted when the old subscription is drained ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) sets the versioning policy, [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html) ships the mechanism, [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html) makes the transports framework code).
- **Where it's used**: registered per retired type through `RegisterUpcastedIntegrationEventConsumer<TEvent>` on the [`IBrokerConsumerBuilder`](#ibrokerconsumerbuilder) that `AddBrokerMessaging` hands its callback ([`BrokerConsumerBuilder`](#brokerconsumerbuilder), `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:25-27`), which maps the subscription to this closed type (`:40-42`) and has it registered scoped (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:105`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/UpcastingIntegrationEventConsumerTests.cs`.
- **Caveats / not-in-source**: no host under `MMCA.ADC/Source` calls `RegisterUpcastedIntegrationEventConsumer` (MMCA.Store was not re-checked in this pass); the extension point is documented on [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) and on [`OutputCacheEvictionRequested`](group-04-events-outbox.md#outputcacheevictionrequested) as the path to take when a contract is retired. Its behavior is therefore established by the test suite rather than by production traffic.

---

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.


### BrokerConsumerBuilder

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:12` · Level 9 · class (internal sealed)

- **What it is**: the [`IBrokerConsumerBuilder`](#ibrokerconsumerbuilder) that `AddBrokerMessaging` hands its `configureConsumers` callback. It collects one [`BrokerSubscription`](#brokersubscription) per registered event, in registration order, for the host's [`BrokerTopology`](#brokertopology) (`BrokerConsumerBuilder.cs:6-10`).
- **Depends on**: [`IBrokerConsumerBuilder`](#ibrokerconsumerbuilder), [`BrokerSubscription`](#brokersubscription), [`BrokerConsumerKind`](#brokerconsumerkind), [`BrokerNaming`](#brokernaming) for the event name and topic, [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) as the constraint, and the two consumer types it maps onto. Its one constructor argument is the resolved application namespace topics are prefixed with (`:11-12`).
- **Concept**: registration as data. `[Rubric §10, Messaging & Integration Architecture]` assesses whether the topology a host consumes is explicit and checkable. Instead of each registration wiring a transport directly, the builder only records `(EventName, EventType, Topic, Kind)` rows; the topology, the scoped consumer registrations and the receive pipeline's dispatch table are all derived from that one list, so every transport sees the same subscriptions.
- **Walkthrough**
  - `_subscriptions` and the `Subscriptions` view (`BrokerConsumerBuilder.cs:14`, `:17`), in registration order.
  - `RegisterIntegrationEventConsumer<TEvent>()` (`:20-22`) and `RegisterUpcastedIntegrationEventConsumer<TEvent>()` (`:25-27`) both call `Add` with `BrokerConsumerKind.Current` or `BrokerConsumerKind.Upcasted`, and return the builder for chaining.
  - `ConsumerTypeFor(subscription)` (`:36-45`): closes [`UpcastingIntegrationEventConsumer<TEvent>`](#upcastingintegrationeventconsumertevent) for an upcasted subscription and [`IntegrationEventConsumer<TEvent>`](group-04-events-outbox.md#integrationeventconsumertevent) otherwise (`:40-42`) over the subscription's event type.
  - `Add(eventType, kind)` (`:47-62`): resolves the event name (`:49`), then refuses a second registration whose event type **or** event name matches an existing one, throwing `InvalidOperationException` that names both and says to register each event once, current or retired, never both (`:51-57`). Otherwise it appends the subscription with its topic, `BrokerNaming.Topic(applicationNamespace, eventName)` (`:60`).
- **Why it's built this way**: the duplicate guard turns the pairing trap (a current and a retired consumer for one event would both run its handlers) into a start-up failure. Matching on the name as well as the type also catches two CLR types that declare the same `[EventName]`.
- **Where it's used**: constructed and invoked by `AddBrokerMessaging` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:91-97`), which then registers `ConsumerTypeFor(subscription)` scoped for every subscription (`:103-106`); [`BrokerReceivePipeline`](#brokerreceivepipeline) builds its dispatch table with `ConsumerTypeFor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:75-78`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Broker/BrokerTopologyTests.cs`.

---

### BrokerReceivePipeline

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/BrokerReceivePipeline.cs:26` · Level 10 · class (internal sealed partial)

- **What it is**: the framework's one [`IBrokerReceivePipeline`](#ibrokerreceivepipeline), shared by every transport. Per delivered message it starts a Consumer span parented on the publisher's trace context, resolves the subscription from the event-name header, deserializes the body, and runs the subscription's consumer with in-process retry, each attempt in a fresh DI scope; when every retry fails it asks the transport for a second-level redelivery, and once those are spent it dead-letters the message with one Error log and one `broker.fault.count` (`BrokerReceivePipeline.cs:12-19`).
- **Depends on**: [`BrokerTopology`](#brokertopology), `IServiceScopeFactory`, [`MessageBusSettings`](#messagebussettings), an optional transport redelivery-delay cap, `TimeProvider` and `ILogger<T>` (`:55-61`); [`BrokerTransportPolicies`](#brokertransportpolicies) for the retry and redelivery schedule; [`BrokerConsumerBuilder`](#brokerconsumerbuilder) for the consumer types; [`IBrokerMessageConsumer`](#ibrokermessageconsumer) to call them; [`IncomingBrokerMessage`](#incomingbrokermessage) in, [`BrokerDisposition`](#brokerdisposition) out ([`DeadLetter`](#deadletter), [`Redeliver`](#redeliver)); [`BrokerHeaders`](#brokerheaders), [`BrokerWire`](#brokerwire) (JSON options, `ActivitySource`) and [`BrokerMetrics`](#brokermetrics). Externals: `System.Text.Json`, `System.Diagnostics`.
- **Concept introduced, the transport decides how, the pipeline decides what.** `[Rubric §10, Messaging & Integration Architecture]` assesses whether retry, redelivery and dead-lettering are applied uniformly. Each transport only receives a message and applies the disposition this class returns; the policy (how many attempts, which delays, when to give up, what to log and count) lives here once ([ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)). `[Rubric §29, Resilience & Business Continuity]` assesses whether failures are classified: a delivery no retry can fix (unknown event, undeserializable body) is dead-lettered at once, while a handler failure is retried, then redelivered, then dead-lettered. The pipeline never throws for a handler or payload failure; the only exception it lets out is the `OperationCanceledException` of the host's own token, and the transport then leaves the message unacknowledged so the broker redelivers it after the restart (`:20-24`). `[Rubric §13, Observability & Operability]` applies to the span and the single dead-letter Error row.
- **Walkthrough**
  - Constants (`BrokerReceivePipeline.cs:29-38`): the dead-letter reasons `"unknown-event"`, `"poison"` and `"handler-failed"`, and `MaxDetailLength = 1024`, because brokers cap the description they store.
  - Constructor (`:55-79`): guards its arguments, builds the redelivery intervals with `BrokerTransportPolicies.BuildRedeliveryIntervals(settings, maxRedeliveryDelay)` (`:72`), and precomputes the dispatch table, event name to closed consumer type, with `BrokerConsumerBuilder.ConsumerTypeFor` under ordinal comparison (`:75-78`).
  - `ProcessAsync(message, cancellationToken)` (`:82-105`): starts the span (`:86`), rejects through `TryResolve` (`:88-92`), tags `mmca.event.name`, runs `ConsumeWithRetryAsync` (`:96`), returns `BrokerDisposition.Complete` on success (`:100`), otherwise `AfterRetriesExhausted` (`:104`).
  - `TryResolve` (`:111-150`): a missing event name or one with no subscription is dead-lettered as `unknown-event` with a Warning (`:120-127`); a `JsonException` or `NotSupportedException` from deserializing with `BrokerWire.JsonOptions` (`:132`) is dead-lettered as `poison` with the truncated message (`:134-139`), as is a body that deserializes to null (`:141-146`).
  - `ConsumeWithRetryAsync` (`:184-224`): up to `RetryLimit + 1` attempts (`:190`, `:193`), waiting `BrokerTransportPolicies.RetryDelay(settings, attempt)` on the injected clock before each retry (`:197-200`). The catch filter (`:211`) lets a cancellation of the host's own token propagate and retries anything else, a handler's own timeout included (`:213-214`); each failed non-final attempt logs a Warning (`:218`). It returns null on success or the last exception.
  - `ConsumeOnceAsync` (`:226-238`): creates a fresh async scope (`:232`), resolves the consumer as `IBrokerMessageConsumer` (`:235`) and calls it, so the inbox, origin restore and handlers of one attempt never see another attempt's tracked state.
  - `AfterRetriesExhausted` (`:156-177`): while redeliveries remain it logs a Warning and returns `Redeliver(delay, redeliveryCount + 1)` (`:162-167`); otherwise it logs one Error with every exception message in the chain (`Describe`, `:273-282`), adds one to `BrokerMetrics.FaultCounter` tagged with `event_type` and `queue` (`:171-174`), and returns `DeadLetter("handler-failed", detail)` (`:176`).
  - `StartConsumerActivity` (`:245-270`): parses `traceparent`/`tracestate` from the headers into a remote parent (`:248-255`), so the publisher's sampling decision travels with the message, and starts a `"{queue} process"` Consumer span with the OpenTelemetry messaging tags (`:257-266`).
  - Five source-generated log methods (`:287-300`).
- **Why it's built this way**: each attempt runs in a fresh scope so a failed attempt's tracked state (a staged inbox row, a dirty unit of work) cannot leak into the next one, and the second-level wait is a transport redelivery rather than an in-process delay, so a long backoff does not hold the receive call open.
- **Where it's used**: registered as the singleton `IBrokerReceivePipeline` by `AddBrokerMessaging` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:109-115`), with the selected transport's `MaxRedeliveryDelay` (`:108`) and `TimeProvider.System` when no clock is registered (`:114`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/BrokerReceivePipelineTests.cs` and `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionBrokerMessagingTests.cs`.
- **Caveats / not-in-source**: the default `RetryLimit`, the delay curve and the redelivery intervals are defined in `MessageBusSettings` and `BrokerTransportPolicies`, not read here; which transport receivers call `ProcessAsync` was not re-read for this section.

---

### ScopedUserOverride

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ScopedUserOverride.cs:27` · Level 5 · class (internal sealed)

- **What it is**: the scoped slot that lets a background scope act as a captured user. `Principal` is null by default, which means "read through to HTTP"; a caller sets it before any handler is resolved, and clears it afterward (`ScopedUserOverride.cs:27-51`).
- **Depends on**: `System.Security.Claims.ClaimsPrincipal` (BCL), and [`AmbientOrigin`](#ambientorigin) for the seed value its `Principal` initializer reads (`ScopedUserOverride.cs:30`). It is a two-member holder with no other collaborators.
- **Concept introduced, the override slot behind a decorator.** `[Rubric §11, Security]` assesses whether identity flows correctly across an async or process boundary rather than defaulting to anonymous or leaking across scopes. HTTP requests already have an ambient identity from the authentication middleware, but background work (the internal command processor, the outbox processor, a broker consumer) runs on a scope with no HTTP context at all. This class is the seam DI resolves per scope: when nothing has called `Set`, `Principal` stays null and [`ImpersonatingCurrentUserService`](#impersonatingcurrentuserservice) reads through to whatever the inner `ICurrentUserService` would have returned anyway.
- **Walkthrough**
  - `Principal` (`ScopedUserOverride.cs:30`) has a private setter, so `Set` and `Clear` are the only ways to change it after construction. Its initializer is `AmbientOrigin.Current?.BuildPrincipal()`: the scope reads the enclosing hop's published origin once, at construction, and owns its copy from then on (`ScopedUserOverride.cs:20-26`, `:30`). A scope a handler opens for itself from the root factory inside a delivery therefore starts as the original interaction, while an HTTP request (which never publishes an origin) starts null. Nothing is shared or mutated across scopes, which is the leak a live ambient override would have caused.
  - `Set(principal)` (`ScopedUserOverride.cs:36-40`) null-guards the argument and assigns it.
  - `Clear()` (`ScopedUserOverride.cs:50`) sets `Principal` back to null. Its doc comment names the scenario that makes it necessary rather than optional (`:39-46`): the outbox processor restores one captured identity per row on a scope it keeps for the whole batch, so without an explicit clear between rows, a row raised by a user would answer for every later row raised by the system.
- **Why it's built this way**: [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html) needs internal command handlers to see the identity that originally scheduled the work, through the same `ICurrentUserService` interface every other handler already depends on, rather than a parallel API only background code would use.
- **Where it's used**: written by [`AmbientOrigin.Restore`](#ambientorigin) (set or cleared on every restore) and read by [`ImpersonatingCurrentUserService`](#impersonatingcurrentuserservice). Registered per scope in `DependencyInjection.cs` (2 references). Exercised directly by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/Consumers/IntegrationEventConsumerContextTests.cs` (4), `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Outbox/Processing/OutboxProcessorContextRestoreTests.cs` (4), and `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/InternalCommands/InternalCommandTestHarness.cs` (2).
- **Caveats / not-in-source**: like [`TenantContext`](#tenantcontext), it is not thread-safe, but as a scoped service on a single logical unit of work (one HTTP request, one dequeued message, one internal command) that is not a property it needs.

---

### AmbientOrigin

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:21` · Level 5 · class (internal static)

- **What it is**: the shared helper that flattens a capturing principal's roles and permission claims for storage, rebuilds a `ClaimsPrincipal` from what was stored, restores a captured user, tenant, and correlation id onto a fresh scope, and publishes that restored origin on the async flow so scopes opened inside the hop inherit it (`AmbientOrigin.cs:21-344`). It is the one place this logic exists; everything that later replays a captured origin, an internal command row, an outbox row, a broker message, calls into it.
- **Depends on**: [`ScopedUserOverride`](#scopeduseroverride) and `ITenantContext` (from [`TenantContext`](#tenantcontext)) as the scope services it restores onto; [`OriginSnapshot`](#originsnapshot) as the published value and [`RestoreHandle`](#restorehandle) as the disposable it returns; `ICorrelationContext` for the correlation id; the `UserIdentifierType` alias; `System.Security.Claims` for `Claim`/`ClaimsIdentity`/`ClaimsPrincipal`; `System.Text.Json` for the permissions array; `AuthClaimTypes` for the subject and permission claim types.
- **Concept introduced, one flatten/rebuild pair reused across every async boundary.** `[Rubric §11, Security]` assesses whether identity propagation is centralized rather than reimplemented per call site, and `[Rubric §8, Data Architecture]` assesses whether the tenancy invariant holds even off the request path. `MaxRolesLength` (`AmbientOrigin.cs:36-40`, value 512) is the column width shared by `InternalCommands.UserRoles` and `OutboxMessages.UserRoles`; `FlattenRoles` fits the column rather than throw, by keeping only the whole leading roles that fit and dropping the trailing ones (`:74-94`): cutting a name mid-word would restore a role nobody holds and lose the real one. It is also explicitly null-tolerant even though `ICurrentUserService.Roles` is declared non-nullable, because `Roles` is a default interface member that runs against hand-written doubles and mocks that stub only the properties a caller touches (`:47-53`). A null there must read as "no roles", never as a capture that throws inside a save.
- **Concept, permissions travel at full fidelity as JSON.** Roles alone no longer describe what a principal may do, so `FlattenPermissions` (`AmbientOrigin.cs:110-126`) captures the principal's distinct `AuthClaimTypes.Permission` claims, in claim order, as a JSON array of strings, and returns null when there are none. Unlike the roles list nothing is ever dropped or cut, because the `UserPermissions` columns are unbounded and a missing permission would deny a deferred command the inline request was allowed to run (`:102-107`); JSON rather than a delimited list because nothing constrains what a permission name may contain. `ParsePermissions` (`:135-152`) reads it back and treats a malformed value as a writer bug that yields no permissions rather than failing the hop, so deferred work is authorized by its roles alone, never by more than was captured.
- **Concept, the tenant is the one value `Restore` will not overwrite.** `Restore` (`AmbientOrigin.cs:254-288`) documents an explicit asymmetry (`:213-229`): the principal and correlation id are set or cleared on every call, because a scope reused across several messages cannot let one message's user answer for the next, but `ITenantContext` is single-valued for the life of a scope by contract, since a scope whose tenant changed mid-flight has already read rows under the previous one. `Restore` therefore sets the tenant only when the scope has not already resolved a different one (`:294-303`); a host running database-per-tenant is unaffected, because its work is already one scope per tenant.
- **Concept, the restored origin is also published on the async flow.** Integration event handlers are singletons that open their own scope from the root factory, a scope that never sees the `Restore` call. `Restore` therefore also writes an [`OriginSnapshot`](#originsnapshot) into a private `AsyncLocal` (`AmbientOrigin.cs:26`, `:279-285`), exposed read-only as `Current` (`:34`). `TenantContext`, `ScopedUserOverride` and `CorrelationContext` read `Current` once, at construction, and seed themselves from it (`TenantContext.cs:19`, `ScopedUserOverride.cs:30`, `CorrelationContext.cs:13`), so a handler's own scope runs as the original interaction (`:231-241`, the "Scopes opened inside the hop inherit it" remark). The snapshot carries the tenant and correlation id the restored scope ended up with, not the raw captured ones, so a database-per-tenant scope whose tenant was already fixed hands that tenant down (`:282-283`).
- **Walkthrough**
  - `FlattenRoles(roles)` (`AmbientOrigin.cs:60-95`) joins the roles with a comma, keeps only the whole leading roles that fit `MaxRolesLength`, and returns null for a null or empty source (or when not even the first role fits).
  - `FlattenPermissions(principal)` (`AmbientOrigin.cs:110-126`) serializes the distinct permission claims to a JSON array; `ParsePermissions(userPermissions)` (`:135-152`) is its tolerant inverse.
  - `BuildPrincipal(userId, userRoles, userPermissions, authenticationType)` (`AmbientOrigin.cs:179-206`) returns null when `userId` is null, meaning no user was captured, and the execution stays anonymous rather than inventing an identity. Otherwise it builds a `sub` claim from the id, one role claim per comma-separated entry and one `AuthClaimTypes.Permission` claim per stored permission (`:202-203`), then wraps them in a `ClaimsIdentity` stamped with `authenticationType`, which is what makes `IsAuthenticated` true. The `mfa` claim is deliberately not propagated: a step-up proves a live interaction, deferred work runs later without that person present, so an `IRequiresMfa` command cannot run deferred and must run inline in the request that carried the step-up (`:161-169`).
  - `Restore(services, userId, userRoles, userPermissions, tenantId, correlationId, authenticationType)` (`AmbientOrigin.cs:254-288`) returns an `IDisposable`. It first saves the enclosing origin and withdraws it (`:265-266`), so a carrier constructed during this restore belongs to this hop and does not seed itself from the previous one. It resolves each of the three scope services with `GetService` rather than a required resolve, so a bare provider (a directly constructed test fixture) simply restores nothing rather than failing the hop (`:226-229`). It sets the tenant first via `RestoreTenant` (`:270`, `:294-303`), because it routes the scoped context factory to the right database and every repository resolved afterward reads its query filter from it; then sets or clears [`ScopedUserOverride`](#scopeduseroverride) via `RestorePrincipal` (`:271`, `:306-320`); then sets the correlation id when one was carried (`:273-277`); then publishes the new [`OriginSnapshot`](#originsnapshot), now including the permissions, and returns a [`RestoreHandle`](#restorehandle) that puts the previous origin back (`:279-287`). Callers dispose the handle when the message or row is done, so the next one cannot inherit it.
  - `Suppress()` (`AmbientOrigin.cs:331-336`) withdraws the published origin until the returned handle is disposed. It exists for the case where an explicit choice must win over an enclosing hop: its doc comment names `TenantDataSourceTargets.CreateTenantScope` (`:325-329`).
- **Why it's built this way**: centralizing flatten, rebuild, and restore in one internal static class means every caller, the internal command scheduler, the outbox processor, the broker consumers, restores context identically; a divergence in any one of them would have been a silent identity or tenant leak rather than a compile error.
- **Where it's used**: called by [`ConsumerOriginRestore`](#consumeroriginrestore) (2 references) and directly by `InternalCommandScheduler` (2), `InternalCommandProcessor` (2), `InternalCommandOriginCapture` (2), `TenantDataSourceTargets` (2, the `Suppress` caller), `BrokerMessageBus` (1), `DbContextFactory` (1), and [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (1), all under `MMCA.Common/Source/Core/MMCA.Common.Infrastructure`. The seeding readers are [`ScopedUserOverride`](#scopeduseroverride), [`TenantContext`](#tenantcontext) and `CorrelationContext`. Exercised by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Context/TenantScopeInsideARestoredHopTests.cs` (3).
- **Caveats / not-in-source**: not determinable from this source whether a host could reasonably bypass `Restore` and set the three scope services directly; every first-party caller goes through this helper. The `AsyncLocal` is the one ambient value in this design, so a caller that drops the returned handle leaves the origin published for the rest of that async flow.

---

### OriginSnapshot

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:353` · Level 5 · record (internal sealed)

- **What it is**: the immutable value [`AmbientOrigin`](#ambientorigin) publishes on the async flow while a background hop is running: the user id, roles, permissions, tenant, correlation id and authentication type the hop restored (`AmbientOrigin.cs:353-364`).
- **Depends on**: the `UserIdentifierType` alias and `System.Security.Claims.ClaimsPrincipal`; its one method calls back into `AmbientOrigin.BuildPrincipal` (`:363`).
- **Concept introduced, a snapshot instead of a shared carrier.** `[Rubric §11, Security]` assesses whether identity propagation avoids leaking across scopes. Publishing an immutable record rather than the live `ScopedUserOverride` or `TenantContext` means a scope that seeds from it copies values and then owns them; no mutable state is shared between the hop's scope and a scope a handler opens later.
- **Walkthrough**
  - Positional members (`AmbientOrigin.cs:353-359`): `UserId` (nullable, null for system-raised work), `UserRoles` (the comma-separated list), `UserPermissions` (the permission claims as a JSON array, or null), `TenantId`, `CorrelationId` (both the values the restored scope ended up with) and a non-null `AuthenticationType`.
  - `BuildPrincipal()` (`AmbientOrigin.cs:363`) rebuilds the principal from the stored id, roles and permissions, or returns null when no user was captured. `ScopedUserOverride` calls it from its initializer (`ScopedUserOverride.cs:30`).
- **Why it's built this way**: the roles and permissions stay in their flattened string forms so the snapshot carries exactly what the stored row or message header carried, and rebuilding stays in the one helper that already owns that logic.
- **Where it's used**: only inside `AmbientOrigin` (`Current`, `Restore`) and by the three seeding carriers through `Current`; no other file names the type.
- **Caveats / not-in-source**: none beyond the above.

---

### RestoreHandle

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:340` · Level 5 · class (private sealed, nested in `AmbientOrigin`)

- **What it is**: the `IDisposable` that `Restore` and `Suppress` hand back; disposing it puts the previously published origin back (`AmbientOrigin.cs:340-343`).
- **Depends on**: [`OriginSnapshot`](#originsnapshot) (the saved previous value) and the private `CurrentOrigin` `AsyncLocal` of its enclosing [`AmbientOrigin`](#ambientorigin) (`:24`).
- **Concept introduced, scoped publication through a disposable.** `[Rubric §1, SOLID]` assesses whether a lifetime is expressed by the type system rather than by a convention. The handle makes "publish for the duration of this message or row" a `using`-shaped contract: `Dispose` is the single line `CurrentOrigin.Value = previous` (`:242`), so nesting restores correctly and the next message in a reused scope cannot inherit the last one's origin.
- **Walkthrough**: a primary constructor capturing `previous` (`AmbientOrigin.cs:340`), and `Dispose` (`:242`) assigning it back. `Restore` passes the origin it displaced (`:187`) and `Suppress` passes the one it withdrew (`:236`).
- **Why it's built this way**: a private nested class keeps the `AsyncLocal` writable only from `AmbientOrigin`, while callers see only `IDisposable`.
- **Where it's used**: constructed in `Restore` and `Suppress` in the same file; callers hold it as `IDisposable`.
- **Caveats / not-in-source**: not determinable from source whether every caller disposes it on all paths; that is each caller's responsibility.

---

### TenantContext

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/TenantContext.cs:13` · Level 6 · class (public sealed)

- **What it is**: the scoped holder of "which tenant is this scope running as". It starts unresolved (unless it is created inside a background hop, below), is set exactly once per scope, and refuses to be changed to a different value afterwards (`TenantContext.cs:6-13`). A scope created while an outbox row, broker message or internal command is being delivered starts with the tenant that hop restored, so a handler that opens its own scope runs under the original tenant (`TenantContext.cs:19`).
- **Depends on**: [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) as the contract, `System.Globalization` for the exception message, and [`AmbientOrigin`](#ambientorigin) for the seed read in the constructor (`TenantContext.cs:19`). Otherwise it is a two-property object with one guarded setter.
- **Concept introduced, the ambient scope value with a write-once discipline.** `[Rubric §11, Security]` assesses whether an isolation boundary can be crossed by accident, and `[Rubric §8, Data Architecture]` assesses whether the tenancy model is enforced by the infrastructure rather than by convention. Multi-tenancy here ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is a shared-schema query filter plus database-per-tenant routing, which means the tenant value silently participates in every read (the named `Tenant` query filter), every write (the save interceptor), every tenant-scoped cache key, and the choice of physical database. Reassigning it mid-scope would therefore be catastrophic in a very quiet way: rows already tracked by the context were fetched under the old tenant, and the next save would attribute them to the new one. The exception message spells out exactly that (`TenantContext.cs:45-51`), and it ends with the remedy rather than just the complaint: start a new scope.
- **Walkthrough**
  - The public parameterless constructor (`TenantContext.cs:19`) assigns `TenantId = AmbientOrigin.Current?.TenantId`, so the value is read once at construction and null outside a hop (every HTTP request).
  - `TenantId` has a private setter (`TenantContext.cs:22`), so the only way to write it after construction is through `SetTenant`.
  - `IsResolved` is `TenantId is not null` (`TenantContext.cs:25`). Note that "unresolved" is the normal, expected state for every background service, seeder, and design-time tool (`:7-9`): consumers of the value treat unresolved as "no tenancy" rather than as an error.
  - `SetTenant(tenantId)` (`TenantContext.cs:28-52`) has three branches. It null- and whitespace-guards the argument (`:22`); assigns and returns when nothing is set yet (`:24-28`); returns silently when the same value is re-asserted (`:32-35`); and throws `InvalidOperationException` on a genuine change (`:37-43`).
  - The idempotent middle branch is the load-bearing one, and the comment at `:30-31` names the scenario: the resolution middleware and a background worker that re-asserts the tenant on the same scope must not fight each other. Same value is a no-op, different value is a hard failure.
- **Why it's built this way**: the registration comment in `AddInfrastructure` explains why the class is always registered rather than opted into (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:344-348`): everything that reads it treats an unresolved tenant as "no tenancy", so an always-on registration costs one object per scope and removes a whole class of "works until someone forgets the opt-in" bug. Only `AddMultiTenancy(configuration)` turns the mechanism itself on.
- **Where it's used**: written by [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) on the request path (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:71`), and by the per-tenant background paths that create their own scope: database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:212`), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), `OutboxAdministration`, and [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob). It is read by [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) for routing, by [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), and by the caching decorators through [`TenantCacheKey`](group-05-cqrs-pipeline.md#tenantcachekey). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Context/TenantContextTests.cs`, and exercised for routing by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/DbContextFactoryTenantTests.cs`.
- **Caveats / not-in-source**: the class is not thread-safe, and does not need to be as a scoped service on a request path, but two threads sharing one scope and racing on `SetTenant` with different values is not guarded against.

---

### ChangePreferencesCommandValidatorBase<TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommandValidatorBase.cs:29` · Level 6 · class (abstract)

- **What it is**: the shared FluentValidation rules for a change-preferences command: the request must
  be present, a supplied culture must be one the framework supports, and a supplied theme must be light
  or dark. A `null` field passes, because `null` is the documented "leave this preference unchanged"
  value (`ChangePreferencesCommandValidatorBase.cs:8-13`, `:30-70`).

- **Depends on**: FluentValidation's `AbstractValidator<TCommand>` (`:1`, `:30`); `TCommand` is
  constrained to [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a
  [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) (`:31`). The accepted values
  come from [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures)`.IsSupported`
  (`:51`, `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:35`) and
  [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (`LightTheme`/`DarkTheme`
  in the message at `:58`, `EnsurePreferredThemeIsValid` at `:67-69`;
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:16`, `:19`, `:158`).

- **Concept introduced: a command validator that borrows the aggregate's own definition of valid.**
  `[Rubric §24: Forms, Validation & UX Safety]` assesses whether bad input is rejected early, with a
  stable, client-readable reason. Each rule carries a fixed message and error code
  (`User.Preferences.Required`, `User.PreferredCulture.Invalid`, `User.PreferredTheme.Invalid`,
  `:33-40`), so a bad culture or theme is turned away before the handler runs instead of surfacing as an
  aggregate failure after a load. `[Rubric §4: DDD]` assesses whether invariants have one home. The
  validator does not restate the theme rule: `BeAKnownTheme` calls
  `CommonInvariants.EnsurePreferredThemeIsValid` and keeps only its `IsSuccess` (`:64-69`), and the
  culture rule uses the same `SupportedCultures.IsSupported` allowlist, so moving the rejection forward
  adds no second definition of what is valid (remarks at `:22-27`). Culture and theme are the ADR-027
  and ADR-028 preferences
  ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html),
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html); `:9`).

- **Walkthrough**: three private error-code constants, a protected constructor, one private helper.
  - `PreferencesRequiredCode`, `CultureInvalidCode`, `ThemeInvalidCode` (`:34`, `:37`, `:40`).
  - Constructor (`:43-62`): `RuleFor(c => c.Request).NotNull()` (`:45-46`); then, only when the
    request is present (`When`, `:48`), a culture rule gated on `Culture is not null` (`:50-54`) and a
    theme rule gated on `Theme is not null` (`:56-60`). The outer `When` is what keeps a missing request
    down to the single "required" failure rather than a cascade of null dereferences.
  - `BeAKnownTheme(string?)` (`:67-69`): delegates to the domain invariant with an empty message and
    reads only the outcome.

- **Why it's built this way**: it is a COMMAND validator rather than a request validator on purpose.
  The command carries its payload through
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest), which does not opt it into the
  automatic
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  bridge, so an `IValidator<ChangePreferencesRequest>` would never run (`:16-19`). It is abstract
  because module scanning registers validators from the app assemblies only: each app declares a
  one-line sealed subclass for its own command record, the same split as
  [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand)
  (`:19-21`). The remarks record that the app Identity modules carried near-identical copies before
  this base existed (`:12-13`).

- **Where it's used**: ADC's
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommandValidator.cs:10`
  is the one-line sealed subclass over
  [`ChangePreferencesCommand`](group-24-identity-module.md#changepreferencescommand). Pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UseCases/ChangePreferences/ChangePreferencesCommandValidatorBaseTests.cs:18`
  through an empty test subclass (`:163`): a null request yields only the required failure (`:33`),
  null fields pass (`:48`), every culture in `SupportedCultures.All` passes (`:57`), and two parity
  theories assert the validator agrees with `CommonInvariants.EnsurePreferredThemeIsValid` and
  `EnsurePreferredCultureIsValid` on edge inputs such as `"DARK"`, `" light"`, `"es-MX"` and `""`
  (`:102`, `:122`).

---

### ConfirmEmailHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.EmailConfirmation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/ConfirmEmailHandlerBase.cs:33` · Level 8 · class (abstract)

- **What it is**: the shared complete-an-email-confirmation workflow: redeem the single-use token,
  resolve the account it was issued to, treat an already-confirmed address as a success rather than a
  re-confirmation, and otherwise confirm and persist
  (`ConfirmEmailHandlerBase.cs:33`, `:50-93`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  `IEmailConfirmationTokenService` and an `ILogger` (`:33-36`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:36`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing `IEmailConfirmableUser` (`:37`), and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a `ConfirmEmailRequest` (`:38`). Also uses `EmailConfirmationErrors`, and logs through two
  private source-generated `[LoggerMessage]` methods, `EmailConfirmed` (`:95-96`) and
  `EmailConfirmationRejected` (`:100-101`), hence the `partial` declaration (`:33`).

- **Concept introduced: already-confirmed is a success that writes nothing.** A confirmation link opened
  twice, whether by a mail-client link prefetch or a user's double tap, is the most ordinary duplicate
  this feature sees, so the handler checks `user.IsEmailConfirmed` after resolving the account and
  returns success with no save when it is already true (`:77-81`, comment at `:74-76`).

  `[Rubric §11: Security]` assesses whether a rejected token leaks account state. Both rejection paths,
  an invalid or expired token and an account that no longer resolves, return the identical
  `EmailConfirmationErrors.InvalidToken(HandlerName)`, differing only in a log reason string
  (`:59-63`, `:68-72`), so the response cannot be used to distinguish "bad token" from "account gone" the
  way [`ResetPasswordHandlerBase<TUser, TCommand>`](#resetpasswordhandlerbasetuser-tcommand) closes the
  same gap for password resets. The rejection log itself carries the reason and nothing else, no
  address and no account id, as the comment on its declaration records (`:98-101`).

- **Walkthrough**: two protected members and one method.
  - `UnitOfWork` (`:41`): exposed for app-level extensions, same shape as the other Users bases.
  - `HandlerName` (`:47`): `protected virtual`, defaulting to `GetType().Name`.
  - `HandleAsync(TCommand, CancellationToken)` (`:50-93`): null-guard (`:52`); redeem the token via
    `ValidateAndConsumeAsync(request.Email, request.Token, ...)` (`:56-58`), failing generically on
    rejection (`:59-63`); load the resolved account through the write repository (`:65-67`), failing
    generically again if it is gone (`:68-72`); short-circuit on an already-confirmed address (`:77-81`);
    call `user.ConfirmEmail()` (`:83`), returning its failure untouched (`:84-87`); save (`:89`); log
    `EmailConfirmed` and return the aggregate's success result (`:91-92`).

- **Why it's built this way**: it is the confirmation half of the same email-verification vertical whose
  send side is [`SendEmailConfirmationHandlerBase<TUser, TCommand>`](#sendemailconfirmationhandlerbasetuser-tcommand);
  the two are separate handlers, not one, because sending is anonymous and always returns success while
  confirming is the one call in the vertical that actually mutates the aggregate.

- **Where it's used**: subclassed by ADC
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ConfirmEmail/ConfirmEmailHandler.cs:1`).
  Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/EmailConfirmationHandlerBaseTests.cs`.

- **Caveats**: the request validator, not this handler, is the only place a malformed token shape can
  produce a 400; everything this handler itself rejects collapses into the same generic invalid-token
  error.

---

### ForgotPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ForgotPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:37` · Level 8 · class (abstract)

- **What it is**: the shared start-a-password-reset workflow: parse the submitted address, resolve the
  account behind it, mint a single-use token, and email it. Every outcome returns
  `Result.Success()` (`ForgotPasswordHandlerBase.cs:37`, `:53-97`). The email is composed in the
  recipient's culture (`:82-85`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordResetTokenService`](group-08-auth.md#ipasswordresettokenservice),
  [`IEmailSender`](group-10-notifications.md#iemailsender),
  `IOptions<`[`PasswordResetSettings`](group-08-auth.md#passwordresetsettings)`>` and an `ILogger`
  (`:37-42`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:42`). Constraints: `TUser` is only an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  keyed by `UserIdentifierType` (`:43`) with no capability interface at all, because the workflow
  reads nothing off the aggregate itself except `Id` (`:73`) and hands the account to
  `UserEmailResources.InRecipientCulture` to pick the email culture (`:82-84`), and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a [`ForgotPasswordRequest`](group-08-auth.md#forgotpasswordrequest) (`:44`). It also uses
  the [`Email`](group-02-domain-building-blocks.md#email) value object (`:59`), and logs through three
  private source-generated `[LoggerMessage]` methods (`:157-166`), hence the `partial` declaration
  (`:37`). Externals: `System.Globalization`, `System.Net.WebUtility`, `Microsoft.Extensions.Logging`
  and `Microsoft.Extensions.Options` (`:1-4`).

- **Concept introduced: the success-always handler, and anti-enumeration as a return-type decision.**
  Every other command base in this family reports its failures. This one cannot. A response that
  differs between "we sent you a reset link" and "no such account" is an account-enumeration oracle:
  anyone can walk an address list and learn which addresses are registered. So the four ways this
  workflow can fail to send anything all return `Result.Success()` and differ only in a log line: a
  malformed address (`:59-64`), an address with no account (`:67-71`), a request the token service
  throttled (`:74-78`), and an email send that threw (`:87-93`). Each of the two `Result` checks reads
  its value through `TryGetValue(out ...)` rather than an `IsFailure` test followed by a null-forgiving
  `.Value!` (`:60`, `:74`). The class remarks state the rule
  outright and name the one exception: only the request validator can produce a 400, and it inspects
  the shape of the address alone (`:21-26`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:11-16`).

  `[Rubric §11: Security]` assesses whether a public endpoint leaks facts about who holds an account.
  The leak surface is wider than the HTTP response, and the code closes it in three places. The result
  is uniform (`:63`, `:70`, `:77`, `:92`). The controller turns every one of them into the same
  `202 Accepted`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:82-93`).
  And the rejection log, `PasswordResetRejected`, deliberately carries a reason string but no address
  and no account id, so the log does not become the oracle the response is not (`:163-166`, the
  comment at `:163-164` says so). Only the paths that already proved an account exists log a user id:
  `PasswordResetRequested` (`:157-158`) and the Warning-level `PasswordResetEmailFailed` (`:160-161`).

  `[Rubric §29: Resilience & Business Continuity]` assesses what happens when a dependency fails
  mid-workflow. A send failure is caught, logged with the exception, and swallowed (`:87-93`); the
  token has already been issued and is still valid, so the user can retry or use the link from a later
  request. The catch filter excludes `OperationCanceledException` (`:87`) so a cancelled request is
  not misreported as a delivered reset.

  `[Rubric §3: Clean Architecture]` assesses dependency direction. The workflow lives in the
  Application layer and reaches the SMTP relay, the token cache and the database only through
  interfaces; the one thing it genuinely cannot express in the framework, an address-to-account lookup
  over an app-owned `User` aggregate, is the single abstract member (`:106`).

- **Walkthrough**: two protected properties, the handler method, four hooks and three log methods.
  - Primary constructor (`:37-42`): `unitOfWork`, `tokenService`, `emailSender`, `settings`, `logger`.
  - `UnitOfWork` (`:47`): exposed so the lookup override can reach a read repository. Both apps use it
    for exactly that.
  - `Settings` (`:50`): `settings.Value`, unwrapped once so the body reads
    `Settings.TokenLifetimeMinutes` rather than `settings.Value...`.
  - `HandleAsync(TCommand, CancellationToken)` (`:53-97`): null-guard (`:57`); `Email.Create` on the
    raw string, unwrapped with `TryGetValue`, so a malformed address never reaches the lookup
    (`:59-64`); `FindUntrackedByEmailAsync` (`:66`); `tokenService.IssueAsync(email.Value, user.Id, ...)`
    (`:73`), whose failure (a `TryGetValue` miss at `:74`) means the per-email throttle fired; then the
    send, in a single call to
    `UserEmailResources.InRecipientCulture(user, ...)` that runs `ComposeSubject()` and
    `ComposeBody(ComposeResetLink(...), token)` under the account's stored culture and returns the
    `(subject, body)` pair, sent as HTML (`:82-85`); and finally the `PasswordResetRequested` log and
    success (`:95-96`).
  - `FindUntrackedByEmailAsync(Email, CancellationToken)` (`:106`): `protected abstract`. The only
    app-specific step, because each app's `User` stores the address differently.
  - `ComposeSubject()` (`:114`): `protected virtual`, now `UserEmailResources.Get("ForgotPassword.Subject")`
    rather than a hard-coded English literal. It runs with the current UI culture set to the account's
    stored preference (the request's culture when the account has none), so the default is localized
    and an override is only needed to rebrand (`:108-114`).
  - `ComposeBody(string? resetLink, string token)` (`:124-135`): `protected virtual`. It carries the
    link **and** the raw token, because clients without deep linking (the MAUI head) need the token
    typed into the reset page by hand (`:116-120`). Every visible string (link text, intro, the
    code-with-expiry line, the ignore notice) is a `UserEmailResources` lookup, the code line through
    `UserEmailResources.Plural` keyed on `Settings.TokenLifetimeMinutes` (`:129`, `:131-134`). Both the
    link and the token still go through `WebUtility.HtmlEncode` before interpolation into the HTML
    (`:129`, `:133`), and the expiry is rendered with `CultureInfo.InvariantCulture` (`:126`).
  - `ComposeResetLink(string email, string token)` (`:152-155`): `protected virtual`. Returns `null`
    when `PasswordResetSettings.ResetUrl` is blank, so an unconfigured host degrades to a token-only
    email rather than emailing a broken link; otherwise it appends `#email=...&token=...` with both
    values `Uri.EscapeDataString`-encoded, as a URL **fragment** rather than a query string.
  - `PasswordResetRequested`, `PasswordResetEmailFailed` and `PasswordResetRejected` (`:157-166`):
    `private static partial`, the three source-generated audit lines described under Security.

  **Concept introduced: the live token rides in the URL fragment, not the query string.** A fragment is
  never sent to a server, so putting the address and the single-use token there keeps them out of
  ingress access logs, out of request telemetry (`url.query` is exported unredacted), and out of any
  `Referer` header the reset page emits; the page itself reads the values from `location.hash` and
  scrubs them from the address bar (`:145-151`, remarks on `ComposeResetLink`).

- **Why it's built this way**: the reset token is deliberately not a database row. It lives in the
  distributed cache, hashed at rest, with the per-email request throttle and the per-token attempt cap
  enforced by the token service rather than by this handler
  ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html);
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:58`, `:71`,
  `:140`). That split is why the handler's only reaction to a throttled request is a log line: it
  never learns which limit fired. The command record stays app-side for the same reason it does in the
  ChangePassword hoist, and the base reads it only through `ICommandWithRequest<ForgotPasswordRequest>`
  (`:27-32`).

- **Where it's used**: subclassed once per app, each override implementing the address lookup as an
  untracked `GetAllAsync` filtered on the `Email` value object
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:21`,
  `:26`, `:29-37`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:21`,
  `:27`, `:34-46`). Reached over HTTP through
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand),
  whose `POST forgot-password` action is `[AllowAnonymous]`, rate-limited by the auth-IP policy and
  `[Idempotent]` (`PasswordResetAuthControllerBase.cs:75-93`). Pinned by six tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:22`
  through a test subclass (`:190-195`), one per rejection path plus the unconfigured-`ResetUrl`
  degradation (`:27`, `:42`, `:57`, `:79`, `:92`, `:108`).

- **Caveats**: the anonymous command carries no user identifier, which is why it implements
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  rather than [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:12-13`).
  Nothing in this workflow writes to the database, so it never calls `SaveChangesAsync`; the unit of
  work is present only to hand the subclass a read repository.

---

### ResetPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ResetPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:42` · Level 8 · class (abstract)

- **What it is**: the shared complete-a-password-reset workflow: redeem the single-use token, revoke
  every live refresh session on the account, hash the new password, let the aggregate apply its
  invariants, persist, then clear the account's lockout so the user can sign in immediately with the
  new credential (`ResetPasswordHandlerBase.cs:42`, `:66-124`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher),
  [`IPasswordResetTokenService`](group-08-auth.md#ipasswordresettokenservice),
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an `ILogger`, plus a
  required [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore) and an optional
  `TimeProvider` (`:42-49`);
  implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:49`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) (`:50`), the same
  capability [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
  requires, and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a [`ResetPasswordRequest`](group-08-auth.md#resetpasswordrequest) (`:51`). Also uses
  [`Error`](group-01-result-error-handling.md#error), and logs through two private source-generated
  `[LoggerMessage]` methods, `PasswordResetCompleted` (`:132-133`) and `PasswordResetRejected`
  (`:137-138`), hence the `partial` declaration (`:42`). Externals: `Microsoft.Extensions.Logging`.

- **Concept introduced: burn the token before the write, not after.** The token is consumed at the top
  of the method, before anything is saved (`:77-79`), and the comment explains the trade: leaving it
  live until the write succeeds opens a replay window in which the same token redeems twice, while
  burning it early costs a user whose aggregate then rejects the change one extra reset request
  (`:74-76`). Choosing the second cost is the security-over-convenience call, and it is pinned by its
  own test, `HandleAsync_ConsumesTheTokenBeforeSaving`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:113`).

  **Concept introduced: one error for every rejection.** Unlike the authenticated change-password
  path, which can afford a specific `Auth.InvalidCurrentPassword`, this anonymous endpoint collapses
  an unknown token, an expired token, a mismatched token, an attempt-capped token and a vanished
  account into a single `Auth.InvalidResetToken` (`:126-130`, produced at `:83` and `:92`). The private
  `InvalidToken()` factory exists so there is exactly one construction site and no way for a future
  edit to make two branches distinguishable by accident.

  `[Rubric §11: Security]` assesses whether an anonymous endpoint leaks account state. Two mechanisms
  do the work here: the uniform error above, and a rejection log that names only a reason string,
  never an address or an account id (`:82`, `:91`, and the declaration with its comment at
  `:135-138`). The matching controller action turns every failure into the same `401`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:99-118`).

  `[Rubric §29: Resilience & Business Continuity]` assesses whether a user can recover unaided. The
  final `ResetFailedAttemptsAsync` call (`:120`) is the part that makes a reset actually usable: a user
  who reset the password *because* the brute-force lockout locked them out would otherwise still be
  locked out with a brand-new credential
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html);
  `ILoginProtectionService.cs:33`).

  **Concept introduced: a reset is the remediation for a suspected intruder, so the intruder's session
  has to die with the old password.** Once the token is redeemed and the account loaded, and before the
  new password is even hashed, the handler revokes every live refresh session on the account through
  the required [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore), using the shared
  [`RefreshSessionRevocation`](group-08-auth.md#refreshsessionrevocation) helper (`:106-108`, comment
  at `:95-105`), the same helper
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
  uses ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). The
  order is deliberate (the comment tags it M240): the session store saves through the shared context
  factory, which saves every cached context, so a user already mutated by `ChangePassword` would ride
  along in the revoke's save. With the user still unmodified the revoke save carries only the
  sessions, and a failure between the two saves can never leave a new password with the old sessions
  alive. Revoking is always desirable on a reset, so it also stands when the aggregate then rejects
  the new password. A revoke failure throws before anything else changes, leaving the password and the
  lockout as they were, with the token already spent (the user requests a new link). Only the
  `timeProvider` parameter defaults to `null`; the base caches it in a private `_timeProvider`
  field, falling back to `TimeProvider.System` (`:53`), and a caller must supply the refresh-session
  store explicitly.

  `[Rubric §4: DDD]` assesses whether the rules live in the domain. As with the change-password base,
  the handler hashes and then calls `user.ChangePassword(newHash, newSalt)` (`:110-111`), returning the
  aggregate's own result on failure without saving or clearing the lockout (`:112-115`); the session
  revocation has already happened by then (`:106-108`).

- **Walkthrough**: two protected members, the handler method, one private helper and two log methods.
  - Primary constructor (`:42-49`): `unitOfWork`, `passwordHasher`, `tokenService`, `loginProtection`,
    `logger`, the required `refreshSessions`, and the optional `timeProvider`. Seven collaborators, one
    more than [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand),
    because a reset touches the token store, the hasher, the database, the refresh session store and
    the lockout store in one pass.
  - `UnitOfWork` (`:56`) and `HandlerName` (`:63`): the same two protected members as the other bases,
    with the same rationale (an app subclass named `ResetPasswordHandler` reports that name as the
    error `source`, `:58-62`).
  - `HandleAsync(TCommand, CancellationToken)` (`:66-124`): null-guard (`:70`); redeem the token via
    `ValidateAndConsumeAsync(request.Email, request.Token, ...)` (`:77-79`) and fail generically on
    rejection (`:80-84`); take the account id the token resolved to (`:86`) and load it through the
    **write** repository (`:87-88`), failing with the same generic error if it is gone (`:89-93`);
    revoke every refresh session (`:106-108`); hash the new password (`:110`) and call the aggregate
    (`:111`); `SaveChangesAsync` (`:117`); clear the lockout (`:120`); log `PasswordResetCompleted` and
    return the aggregate's success result (`:122-123`).
  - `InvalidToken()` (`:126-130`): the single `Error.Unauthorized("Auth.InvalidResetToken", ...)`
    construction, stamped with `HandlerName`.
  - `PasswordResetCompleted` and `PasswordResetRejected` (`:132-138`): `private static partial`, the
    source-generated audit lines.

- **Why it's built this way**: the reset half of the recovery vertical had to share the
  change-password hoist's shape (generic in the aggregate, generic in the command, one virtual
  `HandlerName`) so that both credential-write paths report errors identically and neither app has to
  restate the workflow
  ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). The one
  ordering decision it owns, consuming before saving, is documented in the code rather than left to be
  rediscovered (`:74-76`). New-password strength is not re-checked here because
  [`ResetPasswordRequestValidator`](group-08-auth.md#resetpasswordrequestvalidator) includes the same
  `StrongPasswordRules<T>` set the registration and change-password requests use, so a reset cannot be
  a way around the complexity policy
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:12-23`).

- **Where it's used**: subclassed once per app as an empty, name-preserving class
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:24`,
  `:24-29`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:20`,
  `:26-31`). Reached over HTTP through the `POST reset-password` action on
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`PasswordResetAuthControllerBase.cs:99-118`), which answers `204 No Content` on success. Pinned by
  five tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:20`
  through a test subclass (`:176-181`), covering both generic-error paths, the happy path, the
  aggregate rejection and the consume-before-save ordering (`:28`, `:48`, `:64`, `:85`, `:111`).

- **Caveats**: the two apps differ on cache policy exactly as they do for change-password: ADC's
  `ResetPasswordCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a prefix built from its
  own `User` type
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:16`,
  `:18`) and Store's is not, which is the reason the command record stays app-side. The lockout clear
  at `:120` runs last, after the revocation and the save, and is not part of the transaction: if
  it throws, the password has already changed. It clears the counter keyed by the request's email
  address (`request.Email`, `:120`), which is the sign-in counter; the separate
  `password-change:{userId}` counter that
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) keeps is not
  touched here. Not determinable from source: whether any deployment configures a
  `ResetFailedAttemptsAsync` implementation that can fail in a way the caller would notice, since the
  contract returns a bare `Task` with no result (`ILoginProtectionService.cs:33`).

---

### SendEmailConfirmationHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.EmailConfirmation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:51` · Level 8 · class (abstract)

- **What it is**: the shared start-email-confirmation workflow: parse the submitted address, resolve the
  account behind it, skip an already-confirmed address, mint a single-use token, and email it. Every
  outcome of an inline dispatch returns `Result.Success()`
  (`SendEmailConfirmationHandlerBase.cs:51`, `:67-127`), the same success-always shape as
  [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand); only when
  the command runs as a durable internal command do a throttle refusal and a failed send surface as
  failures (`:30-38`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  `IEmailConfirmationTokenService`, [`IEmailSender`](group-10-notifications.md#iemailsender),
  `IOptions<EmailConfirmationSettings>` and an `ILogger` (`:51-56`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:56`). `TUser` is only an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  keyed by `UserIdentifierType` (`:57`), with no capability interface required on the constraint itself,
  and `TCommand` is an
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  carrying a `SendEmailConfirmationRequest` (`:58`). Also uses the
  [`Email`](group-02-domain-building-blocks.md#email) value object, reads
  [`InternalCommandExecution`](#internalcommandexecution)`.IsActive` to tell the durable path from an
  inline dispatch (`:99`, `:116`), and logs through four private source-generated `[LoggerMessage]`
  methods (`:196-208`), hence the `partial` declaration (`:51`).

- **Concept introduced: an optional capability check with a safe default.** Unlike
  [`ConfirmEmailHandlerBase<TUser, TCommand>`](#confirmemailhandlerbasetuser-tcommand), which constrains
  `TUser` to `IEmailConfirmableUser`, this base does not: its `IsAlreadyConfirmed` hook pattern-matches
  the aggregate against the interface at runtime and answers `false` when it is not implemented
  (`user is Domain.Auth.IEmailConfirmableUser { IsEmailConfirmed: true }`, `:145-146`), so an app that
  has not adopted the confirmation contract still gets a working send workflow rather than a generic
  constraint it cannot satisfy.

  `[Rubric §11: Security]` assesses account-enumeration resistance, the same concern
  [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand) closes for
  password resets. On an inline dispatch a malformed address (`:71-76`), an address with no account
  (`:78-83`), an already-confirmed address (`:85-91`), a throttled token request (`:105-106`) and a
  send that threw (`:116-123`) all return the identical `Result.Success()` and differ only in a log
  reason string. The rejection log, `EmailConfirmationRejected`, carries that reason and never an
  address or account id (`:205-208`); only `EmailConfirmationRequested` (`:196-197`), the
  Warning-level `EmailConfirmationEmailFailed` (`:199-200`) and the Warning-level
  `EmailConfirmationDeferred` (`:202-203`), all reached after an account resolved, log a user id.

  **Concept introduced: success-always applies to callers, not to the durable queue.** When the
  command runs as a scheduled internal command
  ([ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)), there
  is no anonymous caller to leak to, and acknowledging a transient fault would drop the mail the queue
  exists to guarantee (`:30-38`). The handler checks
  [`InternalCommandExecution`](#internalcommandexecution)`.IsActive` in two places. A throttle refusal
  logs `EmailConfirmationDeferred` and returns `Result.Failure(tokenResult.Errors)` (`:96-103`),
  because earlier attempts that failed to send still count against the per-address window. The send's
  `catch` carries the filter `ex is not OperationCanceledException && !InternalCommandExecution.IsActive`
  (`:116`), so on the durable path the exception propagates and the processor records it and retries
  the row (`:118-120`). The permanent outcomes (malformed address, no account, already confirmed) still
  succeed on both paths, which keeps the at-least-once execution idempotent, and a retry issues a fresh
  token that replaces the undelivered one (`:35-37`).

- **Walkthrough**: two protected properties, the handler method, and five hooks (mirroring
  [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand) member for
  member, plus the already-confirmed check).
  - `UnitOfWork` (`:61`) and `Settings` (`:64`).
  - `HandleAsync(TCommand, CancellationToken)` (`:67-127`): null-guard (`:69`); `Email.Create` on the raw
    string, unwrapped with `TryGetValue` (`:71-76`); `FindUntrackedByEmailAsync` (`:78`); the
    already-confirmed short-circuit (`:85-91`); `tokenService.IssueAsync`, its token likewise read
    through `TryGetValue`, with the durable-path deferral ahead of the inline success (`:93-107`); the
    send, where one `UserEmailResources.InRecipientCulture(user, ...)` call runs `ComposeSubject()` and
    `ComposeBody(ComposeConfirmationLink(...), token)` under the account's stored culture and returns
    the `(subject, body)` pair (`:111-113`), followed by `SendAsync` (`:114`) inside the filtered
    `catch` (`:116-123`); and the `EmailConfirmationRequested` log and success (`:125-126`).
  - `FindUntrackedByEmailAsync(Email, CancellationToken)` (`:136`): `protected abstract`, the one
    app-specific lookup.
  - `IsAlreadyConfirmed(TUser)` (`:145-146`): `protected virtual`, the pattern-match default described
    above.
  - `ComposeSubject()` (`:154`): `protected virtual`,
    `UserEmailResources.Get("EmailConfirmation.Subject")`, resolved in the recipient's culture (the
    account's stored preference, or the request's culture when it has none), so an override is only
    needed to rebrand.
  - `ComposeBody(string?, string)` (`:164-175`) and `ComposeConfirmationLink(string, string)`
    (`:191-194`): `protected virtual`, carrying both the link and the raw token for the same
    no-deep-linking (MAUI) reason as the password-reset base. The body's visible strings (link text,
    intro, the code-with-expiry line via `UserEmailResources.Plural`, the ignore notice) are
    `UserEmailResources` lookups, with the link and the token `WebUtility.HtmlEncode`d (`:169`, `:173`). Like
    [`ForgotPasswordHandlerBase<TUser, TCommand>.ComposeResetLink`](#forgotpasswordhandlerbasetuser-tcommand),
    the link rides the address and token in the URL **fragment** rather than the query string for the
    same ingress-log and `Referer` reasons (`:185-190`).

- **Why it's built this way**: it is the send half of the same email-verification vertical whose
  confirm side is
  [`ConfirmEmailHandlerBase<TUser, TCommand>`](#confirmemailhandlerbasetuser-tcommand), and it repeats
  the success-always shape of [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand)
  because both are anonymous-reachable endpoints where a differing response would be an enumeration
  oracle.

- **Where it's used**: subclassed by ADC
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SendEmailConfirmation/SendEmailConfirmationHandler.cs`).
  Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/EmailConfirmationHandlerBaseTests.cs`.

- **Caveats**: nothing in this workflow writes to the database, so it never calls `SaveChangesAsync`;
  the unit of work is present only to hand the subclass a read repository, the same caveat
  [`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand) carries.

---

### ChangePasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:55` · Level 8 · class (abstract)

- **What it is**: the shared password-rotation workflow for an authenticated user. Load the account,
  reject a credential-less account, check the per-account change-password lockout, verify the current
  password against the stored hash (counting a miss against the lockout), hash the new one, let the
  aggregate apply its own invariants, and persist only if the aggregate accepted the change
  (`ChangePasswordHandlerBase.cs:55`, `:78-136`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) and an `ILogger` as primary-constructor
  parameters, plus a required
  [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore), a required
  [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice) and an optional `TimeProvider`
  (`:55-61`); it implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over [`Result`](group-01-result-error-handling.md#result) (`:61`). Its two constraints are
  the interesting part: `TUser` must be an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  keyed by `UserIdentifierType` **and** implement
  [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) (`:62`), and `TCommand` must
  be an [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a
  [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (`:63`). It also uses
  [`Error`](group-01-result-error-handling.md#error), and its audit line is a private
  source-generated `[LoggerMessage]` method, `PasswordChanged` (`:147-148`), which is why the class is
  declared `partial` (`:55`). Externals: `System.Globalization` and `Microsoft.Extensions.Logging`
  (`:1-2`).

- **Concept introduced: the generic template-method handler, and the two axes it is generic over.**
  One workflow serves both app Identity modules (`ChangePasswordHandlerBase.cs:14-17`), which needs
  two variation points, and each is a separate generic parameter for a separate reason. `TUser` varies because each app owns its own
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
  registration, which is a per-app decision (`IUserScopedCommand.cs:6-12`), and the class remarks
  record the same split (`ChangePasswordHandlerBase.cs:19-24`).

  `[Rubric §1: SOLID]` assesses open/closed and dependency inversion. The workflow is closed for
  modification and open for extension along exactly two declared axes plus the `HandlerName` hook, and
  every collaborator is an abstraction: unit of work, hasher, lockout service, refresh-session store,
  logger, and the aggregate's own capability interface.

  **Concept introduced: a credential-less account has no current password to prove, so it has no
  change-password path either.** An external-OAuth account carries an empty `PasswordHash` and
  `PasswordSalt` ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)), and the
  handler rejects that case explicitly, before the lockout check and the verify, rather than letting a
  zero-length hash compare against anything (`:91-99`).

  **Concept introduced: a wrong current password counts against a lockout, just as a failed sign-in
  does.** Without it, anyone holding a live session could use this endpoint as an unthrottled
  password oracle. The handler therefore runs the current-password check through the same
  failed-attempt counter and exponential lockout the sign-in path uses
  ([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)):
  `CheckLockoutAsync` before the verify, returning its failure as-is when the key is locked
  (`:101-106`); `IncrementFailedAttemptsAsync` on a mismatch (`:110`); and `ResetFailedAttemptsAsync` once
  the password verifies (`:115`). The counter key is `password-change:{userId}`, built by the private
  `ProtectionKey` helper with the id rendered under `CultureInfo.InvariantCulture` (`:144-145`). The
  constructor documentation gives the two reasons it is not keyed by email: `IAuthUser` exposes no
  address, and a separate key keeps a change-password lockout from locking the owner out of sign-in
  (`:47-53`, `:138-143`).

  `[Rubric §11: Security]` assesses credential handling. Four properties are visible in the code.
  Repeated guesses are throttled by the lockout above before the hasher is even called (`:101-106`). The
  current password is verified **before** anything is written (`:108`), and the failure is an
  `Unauthorized` error with a stable code rather than a message that distinguishes "no such user" from
  "wrong password" at this layer (`:95-99`, `:108-113`). Nothing in the handler ever logs the
  plaintext, the hash or the salt: the success log carries only the user id (`:147-148`). Hashing
  itself is delegated to [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), whose contract returns
  a hash and a fresh salt as a tuple (`IPasswordHasher.cs:11`), the shape
  [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) fixes. A successful change
  also revokes every live refresh session on the account through the required
  [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore), via the shared
  [`RefreshSessionRevocation`](group-08-auth.md#refreshsessionrevocation) helper (`:126-128`, comment
  at `:121-125`), so a stolen refresh chain cannot outlive the rotation that was meant to remediate it
  ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). The
  revocation is persisted **before** the explicit password save (`:130`, the M240 comment at
  `:123-125`): a revoke failure throws ahead of the save, so the user can simply retry, and that save
  also carries the already-mutated user. The pair is atomic only when the session store and the user
  repository share a data source (class remarks, `:25-36`). Only the
  `timeProvider` parameter defaults to `null`; the base caches it in a private `_timeProvider` field,
  falling back to `TimeProvider.System` (`:65`), and a caller must supply the refresh-session store and
  the lockout service explicitly.

  `[Rubric §4: DDD]` assesses whether business rules live in the domain. The handler never mutates
  the user's fields: it calls `user.ChangePassword(newHash, newSalt)` (`:118`) and returns whatever
  [`Result`](group-01-result-error-handling.md#result) the aggregate produced, so an aggregate
  invariant (for example refusing rotation on a deleted account) short-circuits the save without the
  handler knowing the rule exists.

- **Walkthrough**: two protected members, the handler method, and two private helpers.
  - Primary constructor (`:55-61`): `unitOfWork`, `passwordHasher`, `logger`, the required
    `refreshSessions` and `loginProtection`, and the optional `timeProvider`. The logger is typed as
    the non-generic `ILogger` so a subclass can pass its own `ILogger<TAppHandler>` and keep the log
    *category* app-specific while the message text stays in the base's own `[LoggerMessage]`
    declaration (ADC passes `ILogger<ChangePasswordHandler>` at
    `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:27`).
  - `UnitOfWork` (`:68`): a `protected` pass-through over the captured parameter, exposed so an app
    subclass can enlist further aggregates in the same unit of work.
  - `HandlerName` (`:75`): `protected virtual`, defaulting to `GetType().Name`. Because each app
    keeps a subclass named `ChangePasswordHandler`, that name is what the `source` field of every
    returned error reports (`:70-74`).
  - `HandleAsync(TCommand, CancellationToken)` (`:78-136`): null-guards the command (`:82`); takes the
    **write** repository via `GetRepository` (`:84`) because this path saves; loads by
    `command.UserId` (`:85`) and returns `Error.NotFound` stamped with the handler name and the
    aggregate type name when the account is missing (`:88`); rejects a credential-less account
    (`:95-99`); builds the counter key and checks the lockout (`:101-106`); verifies the current password,
    incrementing the counter and returning
    `Error.Unauthorized("Auth.InvalidCurrentPassword", ...)` on mismatch (`:108-113`); resets the
    counter (`:115`); hashes the new password into a `(newHash, newSalt)` tuple (`:117`); calls the
    aggregate (`:118`); and only on success revokes refresh sessions (`:126-128`), then saves (`:130`)
    and logs `PasswordChanged` (`:132`). The aggregate's result is returned either way (`:135`), so a
    domain failure propagates unchanged.
  - `ProtectionKey(UserIdentifierType)` (`:144-145`): `private static`, the `password-change:` counter
    key described above.
  - `PasswordChanged(ILogger, UserIdentifierType)` (`:147-148`): the source-generated Information-level
    audit line, "User {UserId} password changed".

- **Why it's built this way**: one copy of the workflow, with app variation expressed as generic
  parameters and one virtual hook, keeps the two apps from diverging silently, and it is the standing
  preference for reusable infrastructure in this workspace. Keeping the command record app-side is not
  a compromise but the correct boundary: the record is where CQRS *pipeline* policy is declared, and
  that policy is genuinely per app (`ChangePasswordHandlerBase.cs:19-24`).

- **Where it's used**: subclassed once per app, each subclass empty apart from the constructor
  forwarding, and both forward the lockout service
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:24`,
  `:30`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:28`,
  `:34`). Both subclasses are picked up as scoped command handlers by
  `ScanModuleApplicationServices<TAssemblyMarker>()` (see [`DependencyInjection`](#dependencyinjection))
  and are then wrapped by the decorator pipeline. The workflow is pinned directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:18`,
  which drives it through a test double subclass that also takes an `ILoginProtectionService`
  (`:254-260`).

- **Caveats**: new-password strength is **not** checked here. Both apps' commands additionally
  implement `ICommandWithRequest<ChangePasswordRequest>` (`ChangePasswordCommand.cs:15` in ADC, `:13`
  in Store), which routes the payload through the Validating decorator before the handler runs, so
  the base can assume a syntactically valid request. The lockout counter is reset as soon as the
  current password verifies (`:115`), before the aggregate is asked to accept the new one (`:118`), so
  an aggregate rejection after a correct password still clears the count. Neither app's command
  implements `ITransactional`, so the single `SaveChangesAsync` at `:130` is the whole atomic unit for
  the aggregate write (it runs after the session revocation, `:126-128`); the lockout counter is
  written through `ILoginProtectionService`, outside it.

---

### ChangePreferencesHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:22` · Level 8 · class (abstract)

- **What it is**: the shared preference-write workflow. Load the account, merge the partial request
  over the stored values, let the aggregate apply its invariants, and persist on success
  (`ChangePreferencesHandlerBase.cs:22`, `:39-62`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and an `ILogger`
  (`:22-24`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:24`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:25`), and `TCommand` is an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) carrying a
  [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) (`:26`). Also uses
  [`Error`](group-01-result-error-handling.md#error), and logs through a private source-generated
  `[LoggerMessage]` method, `PreferencesChanged` (`:64-65`), hence the `partial` declaration (`:22`).
  Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: null means "leave alone", and where that rule is enforced.** The request record
  is nullable in both fields on purpose: the app-bar culture switcher sends only a culture and the
  theme toggle sends only a theme
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Requests/ChangePreferencesRequest.cs:3-10`). A naive handler
  that passed both fields straight to the aggregate would clear whichever one the caller omitted. The
  merge therefore happens in exactly one place, at the call into the aggregate:
  `command.Request.Culture ?? user.PreferredCulture` and the matching line for the theme (`:52-54`).
  The domain interface documents the same contract from its side, so an aggregate author knows that
  `UpdatePreferences` always receives both values fully resolved (`IUserPreferences.cs:18-25`).

  `[Rubric §15: Best Practices & Code Quality]` assesses whether a rule has one home. This merge has
  exactly one, with one test suite, so a change to it (say, adding a third preference) is made once
  for both apps rather than in two repositories in lockstep.

  `[Rubric §24: Forms, Validation & UX Safety]` assesses whether a partial update can destroy data the
  user did not touch. The null-coalescing merge is the guarantee that it cannot: switching the theme
  never wipes a stored culture, which is exactly the failure the UI's two independent controls would
  otherwise produce ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) culture,
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) theme).

- **Walkthrough**: same shape as the password base, with fewer collaborators.
  - Primary constructor (`:22-24`): `unitOfWork` and `logger`; no hasher, lockout or session store,
    since nothing here is credential material.
  - `UnitOfWork` (`:29`) and `HandlerName` (`:36`): the same two protected members, with the same
    rationale (an app subclass named `ChangePreferencesHandler` reports that name as the error
    `source`, `:31-35`).
  - `HandleAsync(TCommand, CancellationToken)` (`:39-62`): null-guard (`:43`); write repository via
    `GetRepository` (`:45`); load by `command.UserId` (`:46`); `Error.NotFound` stamped with handler
    and aggregate names when missing (`:49`); the merged call to `user.UpdatePreferences(...)`
    (`:52-54`); and, only when the aggregate succeeded, `SaveChangesAsync` plus the
    `PreferencesChanged` log (`:55-59`). The aggregate's result is returned unchanged (`:61`).

- **Why it's built this way**: identical to the rationale for
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand), and with
  the same asymmetry on the command record: ADC's `ChangePreferencesCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:15`,
  `:18`) while Store's is not
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:11-12`),
  so the record stays app-side and only the payload record
  ([`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest)) is shared
  (`ChangePreferencesHandlerBase.cs:15-19`).

- **Where it's used**: subclassed by
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17`,
  `:20` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:16`,
  `:19`, both empty subclasses that exist only to fix the generic arguments and carry the class
  name. Invoked from
  [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand),
  which builds the app's command through a factory hook and returns `204 No Content` on success
  (`UserAccountAuthControllerBase.cs:126-132`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBaseTests.cs:16`
  through a test subclass (`:108-109`).

---

### ImpersonatingCurrentUserService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Context` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ImpersonatingCurrentUserService.cs:20` · Level 9 · class (internal sealed)

- **What it is**: the `ICurrentUserService` decorator that lets background work answer identity questions as the user who originally triggered it. Every member checks [`ScopedUserOverride.Principal`](#scopeduseroverride) first and falls through to the inner `ICurrentUserService` only when nothing was captured (`ImpersonatingCurrentUserService.cs:20-52`).
- **Depends on**: `ICurrentUserService inner` and [`ScopedUserOverride`](#scopeduseroverride) as its two primary-constructor parameters (`ImpersonatingCurrentUserService.cs:20-22`), and implements `ICurrentUserService` itself, so it is a drop-in replacement wherever the interface is consumed.
- **Concept introduced, a decorator that changes the answer, not the pipeline stage.** `[Rubric §11, Security]` assesses whether a component's identity claims are consistent with where the code is actually running. Unlike the CQRS pipeline decorators, which wrap a handler call, this decorator wraps the identity *service* itself: any code that resolves `ICurrentUserService`, whether a handler, a query-cache key builder, or an audit-field stamper, gets the captured identity automatically once [`AmbientOrigin.Restore`](#ambientorigin) has set the override, with no code path needing to know it is running outside an HTTP request.
- **Walkthrough**
  - `User` (`ImpersonatingCurrentUserService.cs:24-25`) returns `userOverride.Principal ?? inner.User`.
  - `UserId` (`ImpersonatingCurrentUserService.cs:27-29`) reads `GetUserId()` off the override principal when set, else delegates to `inner.UserId`.
  - `Role` (`ImpersonatingCurrentUserService.cs:31-35`) reads the first `ClaimTypes.Role` claim off the override principal when set, else delegates to `inner.Role`.
  - `GetClaimValue<T>(claimType)` (`ImpersonatingCurrentUserService.cs:38-52`) delegates outright to `inner.GetClaimValue<T>` when there is no override principal (`:41-44`); otherwise it reads the claim and parses it itself. The comment at `:46-48` records a real trap: claims are machine-written in the invariant culture exactly as the inner `CurrentUserService` reads them, so parsing under the ambient culture would misread decimal and `DateTime` separators.
- **Why it's built this way**: [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html) needs internal command handlers, and anything else running on a restored scope, to see the originally scheduling user through the exact same `ICurrentUserService` contract handlers already depend on. A decorator over the interface, rather than a branch inside every consumer of `ICurrentUserService`, keeps that substitution invisible to callers.
- **Where it's used**: registered in `DependencyInjection.cs` (1 reference) as the decorator over the host's real `ICurrentUserService`. Depends on [`ScopedUserOverride`](#scopeduseroverride) (1 reference, the file that declares it also references this type in return). Exercised by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/InternalCommands/InternalCommandTestHarness.cs`.
- **Caveats / not-in-source**: not determinable from this source whether every host registers this decorator or only those that process internal commands or outbox messages; the registration site itself is the authority on when it is wired in.

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
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:145`,
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:55`), which
  is exactly how the tests wire this fixture in (`MigrationApplyProofTests.cs:41-42`, `:57-58`).

- **Where it's used**: by two test classes, in two different assemblies, for two different halves of
  the same behavior.
  [`MigrationApplyProofTests`](group-29-testing-infrastructure.md#per-project-test-rollup) applies it
  through [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) and asserts the
  history row, the created table, and that nothing stays pending
  (`MigrationApplyProofTests.cs:94-106`); that asking what is pending applies nothing (`:110-120`);
  and that a second `MigrateAsync` over an up-to-date database is a no-op rather than a re-apply whose
  `CREATE TABLE` would collide (`:124-133`).
  [`DatabaseInitializationExtensionsTests`](group-29-testing-infrastructure.md#per-project-test-rollup)
  uses it for the production guard in
  [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions):
  the `"None"` strategy must throw naming the pending migration and must apply nothing on the way out
  (`DatabaseInitializationExtensionsTests.cs:154-155`, `:167-174`).
  Its deliberate non-consumer is
  [`DbContextFactoryMigrationTargetTests`](group-29-testing-infrastructure.md#per-project-test-rollup),
  which needs a migrations assembly that declares nothing.

- **Caveats**: the assembly is a test fixture, never shipped: `IsPackable=false`
  (`MMCA.Common.Infrastructure.Tests.MigrationsFixture.csproj:3`) and it is listed in
  `MMCA.Common.slnx` under `Tests/` (`MMCA.Common/MMCA.Common.slnx:37`), so nothing in the published
  packages carries this migration. Because there is no model snapshot, `dotnet ef migrations add`
  cannot meaningfully extend this assembly: a second migration here would have to be hand-written the
  same way.


---
[⬅ gRPC & Inter-Service Contracts](group-13-grpc-contracts.md)  •  [Index](00-index.md)  •  [Common UI Framework (MudBlazor components, theme, base pages) ➡](group-15-common-ui-framework.md)
