# 14. Module System, Composition & Configuration

**What this chapter covers.** This is the wiring layer, the code that turns a pile of layered
assemblies into a running host. It answers three questions a new host author asks: *how does the
process discover and assemble its modules?*, *in what order does DI get built so decorators wrap the
right handlers?*, and *where do the dozens of `appsettings.json` knobs land as typed objects?* The
cast is small but load-bearing: the [`IModule`](#imodule) contract and its
[`IModuleSeeder`](#imoduleseeder) sidekick; the [`ModuleLoader`](#moduleloader) that discovers and
Kahn-sorts them; the two `extension(IServiceCollection)` [`DependencyInjection`](#dependencyinjection)
composition roots (Application and Infrastructure); the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) assembly anchors that Scrutor and the architecture tests pin to;
the two data-source attributes ([`UseDataSourceAttribute`](#usedatasourceattribute),
[`UseDatabaseAttribute`](#usedatabaseattribute)); the whole **Settings** family,
[`ApplicationSettings`](#applicationsettings) / [`ModulesSettings`](#modulessettings) /
[`ModuleSettings`](#modulesettings) in Application plus the Infrastructure bindings
([`ConnectionStringSettings`](#connectionstringsettings), [`DataSourcesSettings`](#datasourcessettings),
[`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](#outboxsettings),
[`PersistenceSettings`](#persistencesettings), the JWT/JWKS group, [`SmtpSettings`](#smtpsettings),
[`PushNotificationSettings`](#pushnotificationsettings), [`NativePushSettings`](#nativepushsettings),
[`FileStorageSettings`](#filestoragesettings)) and the opt-in feature sections
([`SchedulerSettings`](#schedulersettings), [`AuditTrailSettings`](#audittrailsettings),
[`TenancySettings`](#tenancysettings)); the cross-replica locking pair
([`RedisDistributedLock`](#redisdistributedlock), [`InProcessDistributedLock`](#inprocessdistributedlock));
the host-scoped job runner ([`ScheduledJobRunner`](#scheduledjobrunner)); and the shared **Users**
use-case bases that two apps compose into their own Identity modules. The detailed per-type sections
follow; this overview shows how the pieces fit together at runtime.

`[Rubric §7, Microservices Readiness]` (assesses whether modules can be enabled, disabled, and
deployed independently with minimal coupling) is the lens this whole chapter is built around: the
module system is *the* boundary that lets MMCA.ADC run as either a single monolith host or four
separate service processes from the **same module code**, configuration-switched. `[Rubric §10,
Cross-Cutting Concerns]` and `[Rubric §3, Clean Architecture]` also run throughout: composition is
where the inward-pointing dependency rule gets physically realized (Infrastructure references
Application references Domain references Shared), and where cross-cutting concerns are registered once
for every module rather than per-feature. The two ADRs that explain *why* this shape exists are
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (service-extraction
topology) and [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
(database-per-service).

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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:342-350`). Application code never
learns which path it got; the transport choice lives entirely at the composition edge
([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §2,
Design Patterns]` applies here: this is a clean strategy / null-object pairing (real service, disabled
stub, remote client) rather than scattered `if (moduleEnabled)` checks.

## Discovery and Kahn-ordered registration

[`ModuleLoader`](#moduleloader)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15`) is the engine. Its
`DiscoverAndRegister` comes in two overloads: the short one (`ModuleLoader.cs:52`) scans
`AppDomain.CurrentDomain.GetAssemblies()`, and the explicit-assemblies overload
(`ModuleLoader.cs:73`) takes the list to scan, which its own doc comment recommends for hosts because
the AppDomain scan only sees assemblies already loaded, so a referenced-but-untouched module assembly
is silently absent from discovery (`ModuleLoader.cs:61-65`). Either way the scan guards each
`GetTypes()` call against a throwing assembly so one bad reference does not abort the whole pass
(`ModuleLoader.cs:86-99`), then instantiates every concrete [`IModule`](#imodule) via
`Activator.CreateInstance` (`ModuleLoader.cs:101-104`) and every concrete
[`IModuleSeeder`](#imoduleseeder) into a case-insensitive dictionary keyed by `ModuleName`
(`ModuleLoader.cs:106-109`).

Ordering is **Kahn's topological sort** (`ModuleLoader.cs:286-336`) over the modules' declared
`Dependencies`. Kahn's algorithm is BFS over a dependency graph: compute each module's in-degree
(count of unprocessed dependencies, `ModuleLoader.cs:291`), build the reverse adjacency list of
dependents (`ModuleLoader.cs:294-307`), seed a queue with the zero-in-degree modules
(`ModuleLoader.cs:310-311`), and as each is emitted decrement its dependents' in-degrees, enqueuing
any that reach zero (`ModuleLoader.cs:320-323`). A dependency name that was never discovered is
skipped rather than treated as an edge (`ModuleLoader.cs:301-302`); validation catches it later. If
fewer modules come out than went in, the remainder form a cycle and the loader throws with the
offending names (`ModuleLoader.cs:328-333`). The payoff is an ordering where a module's DI
registrations always exist *before* any dependent registers, which matters because the CQRS decorator
pipeline (below) can only wrap handlers that are already in the container.

For each sorted module the loader checks [`ModulesSettings.IsModuleEnabled`](#modulessettings)
(`ModuleLoader.cs:116`). A disabled module gets `RegisterDisabledStubs` called, has the exact service
descriptors that call added recorded (`ModuleLoader.cs:122-124`), and is listed in
`DisabledModuleNames` (`ModuleLoader.cs:126`); an enabled one runs `ValidateModuleDependencies` then
`RegisterEnabledModule` (`ModuleLoader.cs:130-131`) and contributes its seeder if one was found
(`ModuleLoader.cs:133-136`). Registration is also where **per-module configuration** is loaded by
convention: before calling `module.Register(...)` the loader adds `modules.{name}.json` and, when an
environment name is passed, `modules.{name}.{environment}.json` to the configuration builder
(`ModuleLoader.cs:189-193`), so a module can ship its own config file. Dependency validation
(`ModuleLoader.cs:140-173`) is microservice-aware: a dependency that is disabled in-process but listed
in that consumer's [`ModuleSettings`](#modulesettings) `RemoteDependencies` is treated as *satisfied
remotely*, and only a `RequiresDependencies = true` module with a genuinely unsatisfied dependency
throws, with an error message that spells out the three ways to fix it
(`ModuleLoader.cs:154-162`). Every step emits a `[LoggerMessage]`-generated structured log
(`ModuleLoader.cs:338-357`), so the startup log tells you exactly which modules loaded, in what order,
and how long each took (`ModuleLoader.cs:195-198`).

Trusting configuration is not quite enough, so the loader offers a second, post-build gate:
`ValidateRemoteDependencies(serviceProvider)` (`ModuleLoader.cs:216-238`) walks every remote-declared
dependency, resolves each service type the disabled module's stub had registered, throws when one does
not resolve at all, and logs a warning when it still resolves to the stub implementation
(`ModuleLoader.cs:240-261`). That converts a forgotten gRPC-client registration from a first-request
mystery into a startup failure. It is a capability, not a habit: today only
`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs` calls it, and no
ADC or Store host does. `[Rubric §13, Observability & Operability]` is the category at play in both
this method and the log messages above.

A subtlety worth stating against the source: the loader is **not** called from inside
`AddApplication()`. Each host's `Program.cs` constructs a [`ModuleLoader`](#moduleloader), hands it a
logger, calls `DiscoverAndRegister` directly, then registers the loader instance itself as a singleton
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:335-340`). After discovery the
loader also drives startup data through `SeedAllAsync` (`ModuleLoader.cs:270-276`), which invokes each
collected [`IModuleSeeder.SeedAsync`](#imoduleseeder) in registration order.
[`IModuleSeeder`](#imoduleseeder)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8`) is a two-member
interface, `ModuleName` (`IModuleSeeder.cs:13`, matched case-insensitively against an
[`IModule`](#imodule) `Name`) and `SeedAsync(serviceProvider, cancellationToken)`
(`IModuleSeeder.cs:18`), deliberately separate from `IModule` so seeding runs *after* the whole
container is built and a real `IServiceProvider` exists.

## The two composition roots and the ordering they enforce

Service registration itself lives in two static [`DependencyInjection`](#dependencyinjection) classes,
each using a C# `extension(IServiceCollection services)` block (see
[primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the `extension(T)` syntax). The
**Application** root
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:22`) exposes `AddApplication()`
(`DependencyInjection.cs:30`), which fronts [`ApplicationSettings`](#applicationsettings) with its
[`IApplicationSettings`](#iapplicationsettings) abstraction (`DependencyInjection.cs:32`), registers
the core singletons ([`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) at
`:34`, [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) at `:40`,
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider) at
`:42`, [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline) at `:43`),
and pulls in the framework's own FluentValidation validators by assembly (`DependencyInjection.cs:48`).
The upcaster registry is registered unconditionally on purpose: with no upcasters it is an empty
registry whose operations are the identity, so both delivery paths can depend on it without a null
check (`DependencyInjection.cs:36-40`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)), and individual
upcasters accumulate through `AddEventUpcaster<TSource, TTarget, TUpcaster>()`
(`DependencyInjection.cs:283-290`).

The Application root also owns `ScanModuleApplicationServices<TAssemblyMarker>()`
(`DependencyInjection.cs:140-213`), the Scrutor convention scan every module's `AddXModule` calls:
domain-event and integration-event handlers as singletons (`DependencyInjection.cs:144-155`), DTO
mappers, the opt-in
[`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
projectors and request mappers scoped (`DependencyInjection.cs:157-176`), command and query handlers
scoped (`DependencyInjection.cs:178-188`), validators from the module assembly
(`DependencyInjection.cs:190`), and finally a reflection pass that `TryAdd`s a
`CommandRequestValidator<,>` for every command implementing `ICommandWithRequest<T>`
(`DependencyInjection.cs:194-210`) so an explicit validator still wins.

The **Infrastructure** root
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:40`) exposes
`AddInfrastructure(configuration)` (`DependencyInjection.cs:50`), which binds most of the settings
types in this chapter, registers the three save interceptors as singletons
(`DependencyInjection.cs:57-63`), the persistence stack (data-source service and resolver, entity
registry, the scoped and singleton context factories, repositories, unit of work,
`DependencyInjection.cs:52-109`), Scrutor-scans the framework's own EF entity configurations
(`DependencyInjection.cs:113-117`), adds caching (`DependencyInjection.cs:119`), enrolls a startup
validator that fails the host on a bad upcaster graph (`DependencyInjection.cs:160-161`), and adds the
two outbox hosted services (`DependencyInjection.cs:164-165`). Optional add-ons sit alongside it:
`AddPushNotifications` (`DependencyInjection.cs:541`), `AddNativePushNotifications`
(`DependencyInjection.cs:576`), `AddAzureBlobFileStorage` (`DependencyInjection.cs:608`),
`AddBrokerMessaging` (`DependencyInjection.cs:660`), and the typed-client helper
`AddTypedServiceClient<TInterface, TImplementation>(serviceName)` (`DependencyInjection.cs:734`) that
swaps an in-process abstraction for an HTTP transport.

`AddCaching` (`MMCA.Common.Infrastructure/DependencyInjection.cs:177`) also registers this chapter's
one cross-replica primitive: an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that
resolves to [`RedisDistributedLock`](#redisdistributedlock) when the host has an
`IConnectionMultiplexer` registered, and to the warn-once
[`InProcessDistributedLock`](#inprocessdistributedlock) otherwise
(`MMCA.Common.Infrastructure/DependencyInjection.cs:208-222`). The Redis implementation is the
standard `SET key token NX PX ttl` acquire
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:66-68`) with a
compare-and-delete release script (`RedisDistributedLock.cs:36-37`), handing back a
[`RedisLockHandle`](#redislockhandle) that releases exactly its own acquisition, once
(`RedisDistributedLock.cs:88-98`); the fallback is exclusive only inside one process, which is exactly
what its warning says out loud
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:75`), and
its [`InProcessLockHandle`](#inprocesslockhandle) simply removes the key from a
`ConcurrentDictionary` (`InProcessDistributedLock.cs:79-91`). A multi-replica host that registers no
Redis client therefore gets one execution of the guarded section per replica. `[Rubric §29, Resilience]`
and `[Rubric §12, Performance & Scalability]` both touch this pair: the degradation is deliberate,
announced, and never silent.

The **order** of these calls is a hard contract in exactly one respect, and it is the reason
`AddApplicationDecorators()` (`MMCA.Common.Application/DependencyInjection.cs:110`) must come *last*.
Decorators are registered with **Scrutor's `TryDecorate`**, which wraps *existing* registrations, so
every module's concrete handlers must already be in the container or there is nothing to wrap. Beyond
that, the relative position of `AddInfrastructure` and `AddAPI` is not load-bearing. `[Rubric §6, CQRS
& Event-Driven]` and `[Rubric §1, SOLID]` (open/closed) live here: cross-cutting behavior is added by
wrapping, not by editing handlers. `AddApplicationDecorators` also encodes the **execution order** via
`TryDecorate`'s reverse-registration rule (registered innermost first,
`MMCA.Common.Application/DependencyInjection.cs:115-128`), so the command pipeline ends up
`FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Transactional -> handler`
and the query pipeline `FeatureGate -> Authorization -> Logging -> Caching -> Timeout -> handler`
([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The rationale for
each position is written out in the method's own doc comment
(`MMCA.Common.Application/DependencyInjection.cs:84-107`): authorization sits outside caching so a
denied request neither reads nor populates the cache, validation sits outside the transaction so an
invalid command never opens one, and the timeout budget sits inside validation and outside the
transaction so it covers the database work and cancels it rather than leaving it open. The decorator
types themselves (for example
[`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
[`AuthorizationCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#authorizationcommanddecoratortcommand-tresult)
and [`TimeoutCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#timeoutcommanddecoratortcommand-tresult))
are documented in the CQRS-pipeline chapter; this chapter owns only the *wiring* of them. An optional
MiniProfiler pair is registered separately by an opt-in `AddApplicationProfiling()`
(`MMCA.Common.Application/DependencyInjection.cs:297-303`), never by `AddApplicationDecorators()`.

## Opt-in platform features are composed the same way

Four capabilities are registered beside the roots rather than inside them, and they share one
discipline: **registering a feature is not the same as turning it on.** `AddScheduledJobs(configuration)`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:317`) binds
[`SchedulerSettings`](#schedulersettings) and enrolls [`ScheduledJobRunner`](#scheduledjobrunner)
through `TryAddEnumerable` rather than `AddHostedService`, precisely so two modules calling it cannot
start two runners racing for the same rows (`DependencyInjection.cs:324-328`); individual jobs arrive
through `AddScheduledJob<TJob>()` (`DependencyInjection.cs:352-357`), each registered scoped so the
runner can resolve it in a fresh scope per execution. `AddAuditTrail(configuration)`
(`DependencyInjection.cs:388`) binds [`AuditTrailSettings`](#audittrailsettings), adds the
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
and the [`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader) that projects
[`AuditTrailEntryDTO`](#audittrailentrydto) rows, and contributes its own retention job
(`DependencyInjection.cs:390-404`), which only actually runs when the host also enabled the scheduler.
`AddMultiTenancy(configuration)` (`DependencyInjection.cs:437`) binds
[`TenancySettings`](#tenancysettings) and registers
[`TenancySettingsValidator`](#tenancysettingsvalidator) as an `IValidateOptions<TenancySettings>`
(`DependencyInjection.cs:439-446`); note what it does *not* do, because that is the design:
[`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor) and
[`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) are registered unconditionally by
`AddInfrastructure` and `AddServices` (`DependencyInjection.cs:63`, `:465`) and stay inert until a
tenant is resolved, so the framework can never sit in the half-wired state where entities carry
[`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity) but the write-side guard is off
([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Finally
`AddUserDataExportSection<TSection>()` (`MMCA.Common.Application/DependencyInjection.cs:240-246`)
accumulates [`IUserDataExportSection`](#iuserdataexportsection) contributors into the one
`IEnumerable` the export handler fans out over; ADC's Identity module registers two of them
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`). The
governing ADRs are [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html),
[ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html), ADR-073 and
[ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html); `[Rubric §30,
Compliance & Data Governance]` is the category the trail and the export both serve.

[`ScheduledJobRunner`](#scheduledjobrunner)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:39`) is the one
of these with real runtime machinery, and it reuses the outbox's idioms wholesale. It is a
`BackgroundService` that returns immediately (after one log line) when `Scheduler:Enabled` is false
(`ScheduledJobRunner.cs:77-83`), waits out a 15-second startup delay so migrations finish first
(`ScheduledJobRunner.cs:69`, `:87`), then loops: reconcile the `ScheduledJobs` rows against the
registered jobs, claim due rows with a lease, execute, stamp the outcome, and smart-wait until the
earliest upcoming occurrence capped at `Scheduler:PollingIntervalSeconds`
(`ScheduledJobRunner.cs:94-126`). A claim attempt is a single filtered `ExecuteUpdateAsync` against the
still-unleased predicate, so two racing replicas both issue it and exactly one matches
(`ScheduledJobRunner.cs:429-439`); it returns a [`JobClaim`](#jobclaim) carrying either this replica's
lock token or `null` when another replica won the row (`ScheduledJobRunner.cs:447`), which is what
makes an occurrence run exactly once across a scaled host. The persisted row is
[`ScheduledJobEntry`](#scheduledjobentry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20`), deliberately
not an auditable entity: it is framework bookkeeping with an explicit claim lease instead of a
concurrency token (`ScheduledJobEntry.cs:10-13`). [`SchedulerMetrics`](#schedulermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16`) publishes the
`MMCA.Common.Scheduler` meter with a run counter tagged by job and outcome
(`SchedulerMetrics.cs:28-31`) and a duration histogram (`SchedulerMetrics.cs:39-42`), the same shape
[`BrokerMetrics`](#brokermetrics)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`) uses for the
`MMCA.Common.Broker` meter's fault and circuit-open counters (`BrokerMetrics.cs:30`, `:42`). So
`[Rubric §13, Observability & Operability]` is covered by instruments rather than by log scraping.

## Assembly anchors

Several pieces of machinery need a `Type` whose `Assembly` identifies a layer: Scrutor's
`FromAssemblyOf<T>()` scans, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`, and
NetArchTest's per-package anchor. That is what the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) pairs are, one per layer (Domain, Application, Infrastructure),
each a trivial `static class AssemblyReference` holding `Assembly` / `AssemblyName` statics
(`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8-12`) beside a non-static `class
ClassReference` (`AssemblyReference.cs:18`) for the places a generic constraint forbids a static type.
`AddApplication` uses the Application pair for the common validators
(`MMCA.Common.Application/DependencyInjection.cs:48`) and `AddInfrastructure` uses the Infrastructure
pair to scan entity configurations (`MMCA.Common.Infrastructure/DependencyInjection.cs:113-117`). They
are deliberately behavior-free; their whole job is to *name an assembly* for the scanning and
governance tooling.

## Configuration binding, the Settings family

Everything a host operator tunes arrives as a strongly-typed settings object bound from an
`appsettings.json` section, each carrying a `static readonly string SectionName` so the section name
lives next to the shape it binds. The pattern in `AddInfrastructure` is uniform:
`services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
(for example [`ConnectionStringSettings`](#connectionstringsettings) at
`MMCA.Common.Infrastructure/DependencyInjection.cs:67-70`), so misconfiguration **fails fast at
startup** rather than lazily on first use
([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)), and the
concrete class is then usually fronted by an interface singleton so consumers depend on the
abstraction ([`IConnectionStringSettings`](#iconnectionstringsettings) at `DependencyInjection.cs:71`,
[`ISmtpSettings`](#ismtpsettings) at `DependencyInjection.cs:85`,
[`IJwtSettings`](#ijwtsettings) at `DependencyInjection.cs:65`,
[`IPushNotificationSettings`](#ipushnotificationsettings) at `DependencyInjection.cs:547`).
`[Rubric §13, Observability & Operability]` and `[Rubric §15, Best Practices]` apply: `ValidateOnStart`
plus DataAnnotations ranges (for example [`OutboxSettings`](#outboxsettings) `BatchSize` is
`[Range(1, 1000)]` with a default of 50,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:16-17`) turn a config
typo into an immediate, descriptive boot failure.

The Application-layer settings drive composition itself. [`ApplicationSettings`](#applicationsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:8`) carries
`UseMiniProfiler`, `MaxPageSize` (default 500), `MaxExportRows` (`[Range(1, 10_000_000)]`, default
100,000) and `DatabaseInitStrategy` (default `"Migrate"`, `ApplicationSettings.cs:14-32`), and is
passed by value into every `IModule.Register`. [`ModulesSettings`](#modulessettings) *is* a
`Dictionary<string, ModuleSettings>` bound from the `"Modules"` section
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7-10`) whose
`IsModuleEnabled` and `IsDependencyRemote` helpers (`ModulesSettings.cs:18-32`) the loader queries;
note that a module absent from configuration is treated as **disabled** (`ModulesSettings.cs:19`).
[`ModuleSettings`](#modulesettings) carries the per-module `Enabled` flag (default `true`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:9`) and the
`RemoteDependencies` list (`ModuleSettings.cs:38`) that flips a dependency from "in-process" to
"satisfied by an extracted service".

The Infrastructure settings cover the rest of the platform:
[`ConnectionStringSettings`](#connectionstringsettings) (the `Default` source; only
`SQLServerConnectionString` is `[Required]`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ConnectionStringSettings.cs:24-25`);
[`DataSourcesSettings`](#datasourcessettings) with its per-entry
[`DataSourceEntrySettings`](#datasourceentrysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourceEntrySettings.cs:19`), the
logical-to-physical source map for database-per-service, built *directly* from
`Get<Dictionary<...>>` rather than through the options pipeline
(`MMCA.Common.Infrastructure/DependencyInjection.cs:75-77`) because a root-level dictionary section
does not bind that way, with a constructor that rejects a reserved `"Default"` key
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:34-39`);
[`MessageBusSettings`](#messagebussettings) and its [`MessageBusProvider`](#messagebusprovider) enum
(`InProcess` / `RabbitMq` / `AzureServiceBus`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:116-132`) that
`AddBrokerMessaging` switches on, short-circuiting entirely for `InProcess`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:669-672`) and otherwise `Replace`-ing both
[`IMessageBus`](group-04-events-outbox.md#imessagebus) and
[`IEventBus`](group-04-events-outbox.md#ieventbus) with their broker-backed counterparts
(`DependencyInjection.cs:689-695`); [`OutboxSettings`](#outboxsettings) (batch size, retries, polling
and processing intervals, lease, retention) consumed by the
[`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor);
[`PersistenceSettings`](#persistencesettings), whose single `CommandTimeoutSeconds` defaults to the 30
seconds the framework applied implicitly before the section existed
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:21-22`); the
JWT/JWKS group ([`JwtSettings`](#jwtsettings) with its algorithm-aware `IValidatableObject.Validate`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:51-66`, the
[`JwtSigningAlgorithm`](#jwtsigningalgorithm) enum
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSigningAlgorithm.cs:18`), the
[`IJwtSettings`](#ijwtsettings) abstraction
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10`), and
[`JwksSettings`](#jwkssettings), whose `Enabled` defaults to `false` so an HMAC-only deployment does not
start advertising a key set by accident,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwksSettings.cs:26`); and the delivery
channels, [`SmtpSettings`](#smtpsettings), [`PushNotificationSettings`](#pushnotificationsettings),
[`NativePushSettings`](#nativepushsettings)
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) and
[`FileStorageSettings`](#filestoragesettings)
([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)). The last
two follow a different discipline on purpose: their `Add*` methods bind the section and then **no-op**
when it is disabled or incomplete (`MMCA.Common.Infrastructure/DependencyInjection.cs:581-587` and
`:613-624`), so a host registers them unconditionally and a deployment switches the channel on by
configuration alone. One binding is deliberately elsewhere: `JwtSettings` is bound by the API layer's
`AddCommonAuthentication`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:536-541`),
while Infrastructure only registers the `IJwtSettings` facade over the resulting options
(`MMCA.Common.Infrastructure/DependencyInjection.cs:65`), so a host that skips authentication never
pays for a JWT section it does not have.

The three opt-in feature sections follow the same shape with one extra rule worth reading closely.
[`SchedulerSettings`](#schedulersettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:16`) and
[`AuditTrailSettings`](#audittrailsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/AuditTrailSettings.cs:16`) each make
`Enabled` (default `false`) the *single* gate over both the behavior and whether the backing table is
mapped into the model at all (`SchedulerSettings.cs:10-26`, `AuditTrailSettings.cs:10-26`), so a host
that never opts in keeps exactly the migrations it had. Their tunables are ranged the same way
(`PollingIntervalSeconds` default 30, `LeaseSeconds` default 300, `SchedulerSettings.cs:33-43`;
`RetentionDays` default 90, `AuditTrailSettings.cs:37-38`), and per-job retiming lives in
[`ScheduledJobOverrideSettings`](#scheduledjoboverridesettings) bound from `Scheduler:Jobs:{Name}`
(`SchedulerSettings.cs:60`, `:66-75`). [`TenancySettings`](#tenancysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:50`) adds the
collection-binding subtlety: `ResolutionOrder` and `ExcludedPathPrefixes` bind as *empty* lists and the
framework reads `EffectiveResolutionOrder` / `EffectiveExcludedPathPrefixes` instead
(`TenancySettings.cs:76-77`, `:106-107`), because the configuration binder ADDS to a pre-populated
collection rather than replacing it, so a non-empty default would leave a host running the framework's
entries as well (`TenancySettings.cs:41-48`). Its per-tenant database routing is pure configuration:
[`TenantEntrySettings`](#tenantentrysettings) (`TenancySettings.cs:121`) keys
[`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings) (`TenancySettings.cs:138`) by
**physical** data source name, and [`TenancySettingsValidator`](#tenancysettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettingsValidator.cs:23`) fails
the boot when an override names a source that does not exist
(`TenancySettingsValidator.cs:93-104`) or declares no connection string at all
(`TenancySettingsValidator.cs:76-86`), and when the resolution order names
[`TenantResolutionStrategy`](#tenantresolutionstrategy) `Host`, which is defined but not implemented
(`TenancySettings.cs:22-27`, `TenancySettingsValidator.cs:54-65`). Every one of those failures is a
misconfiguration that would otherwise surface as silent cross-tenant behavior, which is exactly the bug
class tenancy exists to prevent, so it is worth a failed boot
(`TenancySettingsValidator.cs:8-12`). `[Rubric §11, Security]` is the category there.

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
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
[`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38`),
the erasure workflow behind
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html),
[`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49`),
the data-subject access workflow, and the password-recovery pair
[`ForgotPasswordHandlerBase<TUser, TCommand>`](#forgotpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:35`)
and [`ResetPasswordHandlerBase<TUser, TCommand>`](#resetpasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:30`),
which run the token issue-and-redeem flow described in
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) over
`IPasswordResetTokenService` and answer identically whether or not the address holds an account
(`ResetPasswordHandlerBase.cs:20-21`).

Each base is generic in the app's `User` aggregate and in the app's own command or query record, and
reads that record only through the small contracts in this group:
[`IUserScopedRequest`](#iuserscopedrequest) (`UserId`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8`),
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) (adds the embedded payload,
`IUserScopedCommand.cs:13`), and [`IUserOwnedRequest`](#iuserownedrequest) (adds `CurrentUserId` and
`CurrentUserRole`, `IUserOwnedRequest.cs:8`). The commands stay app-side precisely because the two apps
disagree on their pipeline attributes: ADC marks the password-change command `ICacheInvalidating` and
Store does not (`ChangePasswordHandlerBase.cs:17-20`). Note that
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) is deliberately *not*
`ICommandWithRequest<TRequest>`: implementing the latter also opts a command into automatic
`CommandRequestValidator` registration, which is a per-app decision, so implementing this one alone
changes no pipeline behavior (`IUserScopedCommand.cs:6-11`).

The export base is the most instructive of the seven, because it is where the container-level and
handler-level composition meet. It authorizes through
[`UserOwnershipRule.CheckOwnership`](#userownershiprule)
(`ExportUserDataHandlerBase.cs:81-90`), reads the account through `GetReadRepository`
(`ExportUserDataHandlerBase.cs:92-93`), asks the subclass for the app-specific subject snapshot
(`:100`), and then fans out **sequentially** over every injected
[`IUserDataExportSection`](#iuserdataexportsection) (`:104-108`), sequential on purpose because the
sections share one scoped `DbContext` and because registration order is the published order of the
document. A section that throws degrades to an envelope reporting `Available = false` rather than
failing the export, which is the contract
[`UserDataExportSectionResult`](#userdataexportsectionresult) encodes with its `Complete` / `Unavailable`
factories
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:73-101`),
with the caller-safe default text in [`UserDataExportSectionDefaults`](#userdataexportsectiondefaults)
(`IUserDataExportSection.cs:105-113`). The result is a
[`UserDataExportDTO`](group-08-auth.md#userdataexportdto) that is PII by design and is therefore never
logged or cached (`ExportUserDataHandlerBase.cs:43-45`).

Around those bases sit the small shared pieces: [`UserOwnershipRule`](#userownershiprule)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21`), the
owner-or-privileged-role decision returning a `Forbidden`
[`Error`](group-01-result-error-handling.md#error) or `null` (`UserOwnershipRule.cs:38-54`) with the
privileged-role test passed in already evaluated because each app owns its own role vocabulary;
[`UserUseCaseLog`](#userusecaselog)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:11`), a non-generic
`[LoggerMessage]` holder so every subclass emits identical text while the log category still comes from
the subclass's own `ILogger<T>` (`UserUseCaseLog.cs:13-29`);
[`SoftDeletedUserValidator<TUser>`](#softdeleteduservalidatortuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19`), which answers
[`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) with one
query-filter-bypassing existence check (`SoftDeletedUserValidator.cs:30-33`); and
[`GetUserPreferencesQuery`](#getuserpreferencesquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`),
the one request record that *was* byte-identical in both apps and so became shared. `[Rubric §16,
Maintainability]` and `[Rubric §1, SOLID]` are the categories here: the variation points are explicit
generic parameters and `protected virtual` hooks, so an app extends behavior without forking the
workflow.

## End-to-end: one host's boot

Reading `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs` top to bottom shows the whole
chapter cooperating. The host binds and validates [`ApplicationSettings`](#applicationsettings) and
also reads the section eagerly for the value it must pass around (`Program.cs:170-176`), calls
`AddApplication()` then `AddInfrastructure(builder.Configuration)` (`Program.cs:308-309`), opts into the
scheduler and the audit trail (`Program.cs:313`, `:317`), binds
[`ModulesSettings`](#modulessettings) and calls `AddAPI(modulesSettings)` (`Program.cs:320-329`), then
constructs a [`ModuleLoader`](#moduleloader) with a Serilog-backed logger and calls
`DiscoverAndRegister(services, configuration, applicationSettings, modulesSettings, environmentName)`
before registering the loader as a singleton (`Program.cs:335-340`). Because this is the *Conference*
service, only the Conference module is `Enabled` in its configuration; every other discovered module
takes the `RegisterDisabledStubs` path. The host then patches the cross-process edges: it replaces the
disabled Engagement stub with a real gRPC client (`AddEngagementBookmarkCountClient()`,
`Program.cs:350`) and calls `AddBrokerMessaging(builder.Configuration, ...)` (`Program.cs:371`) so
[`MessageBusSettings`](#messagebussettings) `Provider` decides whether
[`IMessageBus`](group-04-events-outbox.md#imessagebus) stays in-process or becomes the
MassTransit-backed broker. Only then comes `AddApplicationDecorators()` (`Program.cs:375`), last, so
the decorators wrap the now-registered Conference handlers. Finally
`app.Services.InitializeDatabaseAsync(applicationSettings, moduleLoader)` (`Program.cs:396`) applies
migrations and runs the module seeders the loader collected. The exact same module assemblies, dropped
into a monolith host with every module `Enabled`, would Kahn-sort into one in-process graph with no
gRPC clients, which is precisely the reversibility
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is after.

### AssemblyReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the assembly that contains it plus that assembly's simple name, for use as a stable anchor when something needs to say *"scan the assembly this type lives in."* This section covers the **Application-layer** copy; the framework ships a near-identical copy in every layer package, and the copies that belong to other groups get their own sections there.

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, and that purity is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems are solved with recognised patterns; the marker (or anchor) type is the idiomatic way to hand an `Assembly` to a scanner without coupling to an incidental concrete class. `[Rubric §1, SOLID]` (DIP): registration code depends on a deliberate, meaningless token rather than on `typeof(SomeRandomHandler).Assembly`, so renaming or moving any real type never breaks the scan. Repeating the identical `AssemblyReference` + [`ClassReference`](#classreference) pair in every package keeps each assembly self-describing with no cross-layer reference at all.

- **Walkthrough**: two `public static readonly` fields resolved once at type-initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:7`); `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` null-coalescing fallback (`AssemblyReference.cs:8`), so the field is never null even if the runtime reports no simple name. The Application copy carries no XML doc; the Domain copy is byte-identical in body but documents the type as existing "for Scrutor assembly-scanning registration and architecture tests" (`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:5-7`, fields at `:10-11`).

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and one per package means an assembly can be named without referencing anything inside it. The per-module Application assemblies follow the same convention (see the module copies in [group-22](group-22-engagement-module.md#assemblyreference) and [group-23](group-24-identity-module.md#assemblyreference)).

- **Where it's used**: as the assembly source for Scrutor scans and FluentValidation discovery, usually through its non-static companion (next section) because those helpers are generic.

- **Caveats / not-in-source**: the architecture-fitness map does **not** route through `AssemblyReference` for this layer. `CommonArchitectureMap` pins one anchor type per package, and for six of the seven mapped layers that anchor is a real type (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`); only the UI layer uses a dedicated marker, `UISharedAssemblyReference` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:21-27`).

---

### AuditTrailEntryDTO
> MMCA.Common.Application · `MMCA.Common.Application.Auditing` · `MMCA.Common/Source/Core/MMCA.Common.Application/Auditing/AuditTrailEntryDTO.cs:12` · Level 0 · record (sealed)

- **What it is**: the read-side projection of one recorded change in an entity's history: which entity, which property, the before and after values, the operation, who changed it, when, and under what correlation id. It is what [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader) hands back, and it is deliberately smaller than the infrastructure row it projects.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (`global using UserIdentifierType = int;`, `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`, the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)) and BCL types (`Guid`, `DateTime`, `string`). Nothing else first-party: the persisted counterpart [`AuditTrailEntry`](group-07-persistence-ef-core.md#audittrailentry) lives in Infrastructure and is never referenced from here, which is why the DTO sits at Level 0.

- **Concept introduced, the read-model DTO that deliberately narrows its source row.** `[Rubric §9, API and Contract Design]` assesses whether the shape a consumer sees is designed rather than leaked: the class-level remarks state the intent outright, "deliberately minimal in v1: it carries what a 'who changed what, and when' view needs and nothing an infrastructure table happens to also store" (`AuditTrailEntryDTO.cs:6-11`). `[Rubric §3, Clean Architecture]`: declaring the DTO in the **Application** layer is what lets the reader contract live above Infrastructure while the EF entity stays below it, so no consumer of the trail takes a persistence dependency. `[Rubric §30, Compliance, Privacy and Data Governance]` is the sharpest edge here: values are the invariant string forms captured at save time, and a value that belonged to a property carrying `PiiAttribute` reads as the redaction placeholder on **both** sides (`AuditTrailEntryDTO.cs:8-11`), because the interceptor that writes the row substitutes `PiiRedactor.RedactedToken` for `OldValue` and `NewValue` before persisting (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:309-310`). Personal data never reaches the table, so it cannot leak through this DTO either.

- **Walkthrough**: ten `init` properties on a `sealed record`, so the type gets structural equality and immutability from the compiler. Four are `required`, and that is the contract: `Id` (`:15`), `EntityType`, the full CLR type name of the changed entity (`:18`), `EntityKey`, the invariant string form of its primary key (`:21`), and `Operation`, one of `Added` / `Modified` / `Deleted` (`:36`), plus `ChangedOn`, the UTC instant (`:45`). The nullable ones each encode a real case: `PropertyName` is null on the summary row of a create or delete (`:24-27`), `OldValue` and `NewValue` are null when there is no value on that side (`:30`, `:33`), `ChangedBy` is null when the save carried no identity such as a background service or a seeder (`:38-42`), and `CorrelationId` is null when the change was recorded outside a traced request (`:48`).

- **Why it's built this way**: [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) is the decision record for the trail feature. A `record` rather than a class means a test can compare two projections by value, and the `required` markers make the four facts that every row must carry a compile-time obligation rather than a runtime null check.

- **Where it's used**: the return element of `IAuditTrailReader.GetForEntityAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IAuditTrailReader.cs:37`), and materialized by the single implementation `AuditTrailReader`, which projects it directly inside the EF `Select` so only these ten columns leave the database (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:67-79`).

- **Caveats / not-in-source**: no shipped endpoint or page returns this DTO. The reader's own remarks say so explicitly, "the framework ships the read, not the exposure ... because who may see an entity's history is an application decision" (`IAuditTrailReader.cs:10-15`), so today the only non-test consumer is the reader implementation itself.

---

### ClassReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference): an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern introduced under [`AssemblyReference`](#assemblyreference). C# **static classes cannot be used as generic type arguments**, and several registration helpers are constrained to an instantiable reference type, notably [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection), whose `where TAssemblyMarker : class` constraint (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:116`) forbids a static type. `ClassReference` fills that slot without weakening `AssemblyReference`'s static-ness. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token (`ScanModuleApplicationServices<ClassReference>()`) is the entire registration ceremony a new module needs.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11`). No members. Its only meaningful property is the assembly it belongs to, read by the scanner through `typeof(TAssemblyMarker).Assembly` (`DependencyInjection.cs:160`) or Scrutor's `FromAssemblyOf<TAssemblyMarker>()`. The Domain copy documents the same role, "anchor type used for assembly resolution when `AssemblyReference` cannot be used (e.g., generic type constraints that require a non-static class)" (`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:14-18`).

- **Why it's built this way**: keeping a separate non-static anchor sidesteps the static-class generic-argument restriction while leaving `AssemblyReference` static (and therefore impossible to instantiate accidentally). Every module's Application assembly defines its own `ClassReference`, so each module scans itself by passing its local copy.

- **Where it's used**: as the `TAssemblyMarker` argument in [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection); the three ADC module composition roots all call `services.ScanModuleApplicationServices<ClassReference>()` with their own local copy (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:47`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:112`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:82`). The framework root [`AddApplication()`](#dependencyinjection) passes the Application-layer copy to `AddValidatorsFromAssemblyContaining<ClassReference>()` (`DependencyInjection.cs:40`).

---

### IApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/IApplicationSettings.cs:7` · Level 0 · interface

- **What it is**: a cross-cutting settings *contract* with four global knobs: `UseMiniProfiler` (enables MiniProfiler tracing), `MaxPageSize` (the upper bound the API applies to list queries), `MaxExportRows` (the ceiling on a single CSV export), and `DatabaseInitStrategy` (`"Migrate"` | `"EnsureCreated"` | `"None"`).

- **Depends on**: BCL only. Implemented by [`ApplicationSettings`](#applicationsettings) (Level 1).

- **Concept introduced, typed settings interfaces over raw `IConfiguration`.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether configuration is centralised and typed rather than read as magic-string keys all over the codebase. Instead of injecting `IConfiguration`, the Application layer declares a typed contract, the concrete class implements it, and the composition root registers the bridge. Services depend on `IApplicationSettings`, which makes settings trivially stubbable in tests and resolvable as a singleton. `[Rubric §8, Data Architecture]` shows up in the last knob: the XML doc (`IApplicationSettings.cs:22-30`) enumerates the three accepted strings, and `"None"` is the production setting that *fails startup* when the schema is behind rather than silently migrating it. `[Rubric §12, Performance and Scalability]` is the reason the two ceiling knobs are here at all: both exist to stop one caller from turning a request into a full-table scan.

- **Walkthrough**: four `{ get; init; }` members: `UseMiniProfiler` (`IApplicationSettings.cs:10`), `MaxPageSize` (`:13`), `MaxExportRows` (`:20`), `DatabaseInitStrategy` (`:30`). `init`-only accessors mean the binder sets them once at startup and the object is immutable afterwards, which is what makes the singleton registration safe. The two ceilings are documented as composing rather than duplicating: the export endpoint page-loops the query service at `MaxPageSize` per page, so `MaxExportRows` bounds the whole file and not one page (`:15-19`).

- **Why it's built this way**: separating the interface (Application layer) from the concrete class lets higher layers inject the abstraction while only the composition root knows the implementation, the dependency-inversion shape the primer describes for ports and adapters ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

- **Where it's used**: registered by [`AddApplication()`](#dependencyinjection) as `TryAddSingleton<IApplicationSettings>(sp => sp.GetRequiredService<IOptions<ApplicationSettings>>().Value)` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:31`). Each knob has a distinct consumer. `MaxPageSize` is read per request by `EntityControllerBase`, which falls back to `500` when no settings are registered (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:56-61`) and clamps every paged request with `Math.Min(pageSize, MaxPageSize)` (`:154`). `MaxExportRows` is read the same way, with a `DefaultMaxExportRows = 100_000` constant used both when no settings exist and when a host configures a non-positive value (`EntityControllerBase.cs:76-82`, `:430`), and it bounds the CSV page loop (`:249-250`, [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)). `UseMiniProfiler` gates the MiniProfiler wiring (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:18`) and the profiling repository wrappers (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:33`, `:57`). `DatabaseInitStrategy` drives the startup switch in [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:74-89`), where an unrecognised value throws with the list of valid ones.

---

### IModuleSeeder
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8` · Level 0 · interface

- **What it is**: the Application-layer contract for seeding a module's initial data at startup. `ModuleName` declares ownership and `SeedAsync` receives an `IServiceProvider` so the seeder can resolve whatever it needs. Implementations are auto-discovered by [`ModuleLoader`](#moduleloader) and run, in module-dependency order, after every module has registered.

- **Depends on**: BCL only (`Task`, `IServiceProvider`, `CancellationToken`).

- **Concept introduced, seeding at the right layer.** `[Rubric §3, Clean Architecture]` assesses whether each concern lives in the layer that owns it. An *Application* seeder populates data through service interfaces and never touches a `DbContext`; a seeder that genuinely needs direct EF access implements the Infrastructure-layer [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder) instead. The `IServiceProvider` parameter is deliberate: the loader holds the seeder for the lifetime of composition, so passing the provider (rather than a concrete scoped dependency) is what lets the caller control scoping. `[Rubric §7, Microservices Readiness]`: seeding is a **separate** contract from [`IModule`](#imodule), so a module that needs no reference data implements nothing extra, and an extracted service seeds only its own module.

- **Walkthrough**: `string ModuleName { get; }` (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:13`) must match the corresponding [`IModule.Name`](#imodule) so the loader can correlate a seeder to its module and keep it in topological position; `Task SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)` (`:18`) is the single work method, and the XML doc states it is called only for enabled modules (`:16`).

- **Where it's used**: discovered by [`ModuleLoader.DiscoverAndRegister`](#moduleloader) into a case-insensitive dictionary keyed by `ModuleName` (`ModuleLoader.cs:106-109`) and kept only when the matching module is enabled (`ModuleLoader.cs:133-136`). The actual invocation happens at host startup: [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) calls `moduleLoader.SeedAllAsync(scope.ServiceProvider, cancellationToken)` after schema initialization and tenant-database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:98`). Seeding deliberately runs on the default scope only, not once per tenant, and the comment above the call gives the reason: no module declares which seeders apply per tenant, and running one twice against a shared database is worse than not running it per tenant at all (`:94-97`).

---

### ModuleSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:6` · Level 0 · class (sealed)

- **What it is**: the per-module configuration entry bound from `Modules:{Name}` in `appsettings.json`. `Enabled` (default `true`) controls whether the module's service tree is registered; `RemoteDependencies` lists dependency module names that are satisfied by an *extracted remote service* rather than an in-process module.

- **Depends on**: BCL only (`List<string>` plus the options binder).

- **Concept introduced, the module-extraction boundary expressed as configuration.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the *why*: when Catalog is extracted, the host sets `"Catalog": { "Enabled": false }`, and any module that still depends on it adds `"RemoteDependencies": [ "Catalog" ]`. [`ModuleLoader`](#moduleloader) then treats that dependency as satisfied, lets the disabled module's `RegisterDisabledStubs` put the contract type into DI, and the host afterwards replaces the stub with a real gRPC client adapter. The XML doc walks exactly this Catalog/Sales example, including the sample JSON (`ModuleSettings.cs:11-36`). So extraction becomes a configuration plus wiring change, not a code change.

- **Walkthrough**: `bool Enabled { get; init; } = true` (`ModuleSettings.cs:9`), `init`-only so it cannot be mutated after binding. `List<string> RemoteDependencies { get; set; } = []` (`:38`), and note this one is `set`, not `init`, because the `IConfiguration` binder needs a settable collection to populate; the resulting `CA2227` ("collection properties should be read only") analyzer error is suppressed with an inline `#pragma` plus an explanatory comment (`:37-39`), an acknowledged and documented trade-off rather than an oversight.

- **Why it's built this way**: a plain POCO bound by the options pattern keeps the configuration model decoupled from the module infrastructure, and the `Enabled` flag lets a deployment switch off a whole module without deleting code.

- **Where it's used**: as the value type of [`ModulesSettings`](#modulessettings) (the `"Modules"` dictionary), read for every discovered [`IModule`](#imodule) by [`ModuleLoader`](#moduleloader) during composition.

---

### ApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:8` · Level 1 · class (sealed)

- **What it is**: the concrete global-settings class bound from the `"ApplicationSettings"` configuration section. It implements [`IApplicationSettings`](#iapplicationsettings) and supplies the defaults.

- **Depends on**: [`IApplicationSettings`](#iapplicationsettings) (Level 0, the interface it implements) and `System.ComponentModel.DataAnnotations` for one `[Range]` attribute. BCL only otherwise.

- **Concept introduced, options-pattern settings classes.** `[Rubric §10, Cross-Cutting Concerns]` assesses centralised, typed configuration rather than per-service copy-paste. Every settings class in the framework follows the same shape: a `static readonly string SectionName` names its configuration section (so `Configure<ApplicationSettings>(config.GetSection(ApplicationSettings.SectionName))` avoids a magic string), and `init` properties capture the bound values so the object is immutable after startup. `ApplicationSettings` is the simplest exemplar of that shape, with defaults inline and one range check.

- **Walkthrough**: `SectionName = "ApplicationSettings"` (`ApplicationSettings.cs:11`); four `init` properties carrying `<inheritdoc />` from the interface. `UseMiniProfiler` takes the implicit `false` default (`:14`); `MaxPageSize = 500` (`:17`); `MaxExportRows = 100_000` (`:29`), the one property on this class carrying a validation attribute, `[Range(1, 10_000_000)]` (`:28`); `DatabaseInitStrategy = "Migrate"` (`:32`). The remarks on `MaxExportRows` explain both the number and the limits of the attribute (`:20-27`): 100,000 rows is roughly a 10 to 25 MB file for a typical grid DTO, large enough that no real operational export hits the cap and small enough that one caller cannot pin a request thread to a full-table scan; the `[Range]` is honored only by hosts that opt into `ValidateDataAnnotations` on the options binding, so the export endpoint independently falls back to its own default when a host configures a non-positive value. Because the implemented interface is Level 0, this concrete class lands at Level 1.

- **Why it's built this way**: `static SectionName` keeps registration DRY, and `init` immutability makes the bound instance safe to share as the singleton [`AddApplication()`](#dependencyinjection) registers it as. Validating a bound value with an attribute rather than a hand-written guard is what makes the ceiling declarative, while the endpoint-side fallback means an un-validating host still cannot produce an unbounded export.

- **Where it's used**: passed **by value** into every [`IModule.Register(services, configuration, applicationSettings)`](#imodule) call (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:28`), so a module reads global settings without resolving anything from the container; handed to [`ModuleLoader.DiscoverAndRegister`](#moduleloader) by each service host (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:318` and `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:245`).

---

### ModulesSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7` · Level 1 · class (sealed)

- **What it is**: a `Dictionary<string, ModuleSettings>` subclass bound from the `"Modules"` configuration section, with two helper methods over the map: `IsModuleEnabled(moduleName)` and `IsDependencyRemote(consumerModule, dependencyModule)`.

- **Depends on**: [`ModuleSettings`](#modulesettings) (Level 0, the entry/value type).

- **Concept**: the same [options-pattern](#applicationsettings) shape, but realised by *subclassing the dictionary* so `appsettings.json` can express an arbitrary map of module name to settings without a hand-written model class per module. `[Rubric §7, Microservices Readiness]`: `IsDependencyRemote` is the extracted-service hook, and when a module's dependency is met by a remote service rather than an in-process module, it returns true and [`ModuleLoader`](#moduleloader) treats the dependency as satisfied.

- **Walkthrough**: `SectionName = "Modules"` (`ModulesSettings.cs:10`). `IsModuleEnabled` (`:18-19`) is `TryGetValue` followed by `settings.Enabled`, so a module *absent* from configuration is treated as **disabled**, not enabled, which the XML doc states explicitly (`:14`). `IsDependencyRemote` (`:30-32`) does `TryGetValue` for the consumer, then `settings.RemoteDependencies.Contains(dependencyModule, StringComparer.OrdinalIgnoreCase)`, case-insensitive so deployment configuration need not match casing exactly.

- **Why it's built this way**: subclassing `Dictionary<,>` rather than wrapping one keeps the binder's job trivial (the section is literally a map) while still giving the two questions the loader asks a named, testable home instead of leaving `TryGetValue` chains scattered through composition code.

- **Where it's used**: consumed by [`ModuleLoader`](#moduleloader) for both the enable check and the remote-dependency bypass (`ModuleLoader.cs:116`, `:147`, `:151`, `:228`), and by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) in the API layer to restrict which module controllers are discovered (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:29`); it is also the optional first parameter of `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:44`).

---

### IModule
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7` · Level 2 · interface

- **What it is**: the contract every pluggable module implements: a `Name`, an optional `Dependencies` list, a `RequiresDependencies` flag, a `Register` method that wires the module's services, and an optional `RegisterDisabledStubs` method for the cross-module stubs used when the module is switched off.

- **Depends on**: [`ApplicationSettings`](#applicationsettings) (Level 1, passed into `Register`); externally `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`) and `Microsoft.Extensions.Configuration` (`IConfigurationBuilder`).

- **Concept introduced, the module system as a single composition contract.** `[Rubric §5, Vertical Slice]` assesses whether features cluster into cohesive, self-contained boundaries: a module (Conference, Engagement, Identity, Notification) is the top-level cohesion unit, and it registers *all* of its own services (handlers, EF configurations, repositories, validators) through one `Register` call. `[Rubric §7, Microservices Readiness]` assesses independent deployability: modules declare dependencies by *name* (string), so [`ModuleLoader`](#moduleloader) can compute a safe startup order with no compile-time reference between modules. When a dependency is disabled and `RequiresDependencies` is left at its `false` default, the depended-on module registers stubs through `RegisterDisabledStubs` so cross-module interfaces stay resolvable, which is precisely what lets the Conference service boot with [`DisabledBookmarkCountService`](group-22-engagement-module.md#disabledbookmarkcountservice) standing in for Engagement's [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice).

- **Walkthrough**: five members, three of them with **default interface implementations**, so a minimal module supplies only `Name` and `Register`. `string Name { get; }` (`IModule.cs:12`, required); `IReadOnlyList<string> Dependencies => []` (`:17`, default empty); `bool RequiresDependencies => false` (`:23`, default tolerant); `void Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:28`, required); `void RegisterDisabledStubs(IServiceCollection services) { }` (`:34`, default no-op). Note that `Register` takes an `IConfigurationBuilder`, not a built `IConfiguration`, so a module can add its own configuration sources before its services bind them, which is exactly what the loader exploits to inject per-module JSON files.

- **Why it's built this way**: [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) is the decision record for this contract, and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is the topology it enables ("each service is the monolith with one module enabled"). Making `IModule` the single composition boundary means extraction is a deployment concern rather than a rewrite, and default interface members keep the common case ceremony-free while leaving the extraction hooks available.

- **Where it's used**: implemented by every module's API project (for example [`ConferenceModule`](group-20-conference-api-grpc.md#conferencemodule), [`EngagementModule`](group-22-engagement-module.md#engagementmodule), [`IdentityModule`](group-24-identity-module.md#identitymodule), [`NotificationModule`](group-10-notifications.md#notificationmodule)). Discovered, sorted, and invoked by [`ModuleLoader`](#moduleloader).

---

### ModuleLoader
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15` · Level 3 · class (sealed, partial)

- **What it is**: the engine of the module system. It reflects over assemblies to find every [`IModule`](#imodule) and [`IModuleSeeder`](#imoduleseeder) implementation, sorts the modules into dependency order with **Kahn's topological sort**, registers each enabled module into the DI container while recording stub registrations for the disabled ones, and afterwards can verify against the built container that every remote-declared dependency was actually re-wired.

- **Depends on**: [`IModule`](#imodule) (Level 2), [`IModuleSeeder`](#imoduleseeder) (Level 0), [`ApplicationSettings`](#applicationsettings) (Level 1), [`ModulesSettings`](#modulessettings) (Level 1). Externals: `IServiceCollection` / `ServiceDescriptor` / `IConfigurationBuilder`, `Microsoft.Extensions.Logging` (source-generated `[LoggerMessage]` methods, `NullLogger<T>`), `System.Diagnostics.Stopwatch`, `System.Reflection`.

- **Concept introduced, Kahn's topological sort for DI registration ordering.** `[Rubric §2, Design Patterns]` assesses use of the right algorithm for the problem: ordering items so each appears after everything it depends on is textbook topological sort, and `TopologicalSort` (`ModuleLoader.cs:286`) implements the BFS-based Kahn variant. `[Rubric §7, Microservices Readiness]`: the loader is what makes partial enablement (one module per service host) work at all. `[Rubric §16, Maintainability]`: modules name their dependencies as strings and the loader resolves and sorts them at startup, so adding a module is purely additive, with no central registration list to edit. `[Rubric §13, Observability and Operability]`: seven `[LoggerMessage]` partial methods (`:338-357`) give allocation-free structured diagnostics of which modules loaded, in what order, with which satisfied or unsatisfied dependencies, and how long each `Register` took.

- **Walkthrough**
  - **State** (`ModuleLoader.cs:17-27`): three private lists, `_enabledModules`, `_seeders`, `_disabledModuleNames`, the first and third surfaced as the read-only `EnabledModules` (`:24`) and `DisabledModuleNames` (`:27`) properties. A fourth field, `_stubRegistrations` (`:20`), is a case-insensitive `Dictionary<string, List<ServiceDescriptor>>` recording exactly which descriptors each disabled module's stub registration added; `_modulesSettings` (`:21`) caches the settings for the post-build validation pass. `Logger` (`:33`) is an `init`-only `ILogger<ModuleLoader>` defaulting to `NullLogger<ModuleLoader>.Instance`, so the loader runs silently unless a host supplies one.
  - **Two `DiscoverAndRegister` overloads.** The five-parameter overload (`:52-59`) simply forwards with `moduleAssemblies: null`; the six-parameter overload (`:73`) takes the assemblies to scan explicitly. The XML doc recommends the explicit form in hosts (`:61-65`), because the AppDomain scan only sees assemblies **already loaded**, so a module assembly that is referenced but never touched by any code path is silently absent from discovery.
  - **Discovery** (`:86-109`): enumerates `moduleAssemblies ?? AppDomain.CurrentDomain.GetAssemblies()` and calls `GetTypes()` on each inside a `try/catch` (`:89-98`) that logs and skips assemblies which throw (for example `ReflectionTypeLoadException` from a missing transitive reference) rather than aborting the whole scan. It then instantiates every concrete, non-abstract, non-interface `IModule` via `Activator.CreateInstance` (`:101-104`) and every `IModuleSeeder` into an `OrdinalIgnoreCase` dictionary keyed by `ModuleName` (`:106-109`).
  - **Per-module loop** (`:114-137`): for a module disabled per [`ModulesSettings.IsModuleEnabled`](#modulessettings), it logs, snapshots `services.Count`, calls `module.RegisterDisabledStubs(services)`, stores the newly appended descriptors under the module's name (`:122-124`), records the name, and continues. An enabled module runs `ValidateModuleDependencies` then `RegisterEnabledModule`, and if a seeder with a matching name exists it is appended to `_seeders` (`:133-136`).
  - **`ValidateModuleDependencies`** (`:140`): computes the module's disabled dependencies (`:146-148`), subtracts those declared remote via [`ModulesSettings.IsDependencyRemote`](#modulessettings) (`:150-152`), and throws `InvalidOperationException` only if a genuinely unsatisfied dependency remains *and* `RequiresDependencies` is true; the message spells out the three remediations, enable the module, disable this one, or add the name to `Modules:{Name}:RemoteDependencies` (`:154-162`). Otherwise it logs a warning per unsatisfied-but-tolerated dependency (`:164-167`) and an information line per remote-satisfied one (`:169-172`).
  - **`RegisterEnabledModule`** (`:175`): before calling `module.Register`, it adds the conventional per-module JSON configuration files `modules.{name}.json` and, when an environment name was supplied, `modules.{name}.{environment}.json`, both optional and `reloadOnChange: true` (`:189-193`); the name is lower-cased with `ToLowerInvariant` under a documented `CA1308` suppression for the file-naming convention (`:186-188`). It times the `Register` call with a `Stopwatch` and logs the elapsed milliseconds (`:195-199`).
  - **`ValidateRemoteDependencies`** (`:216`): the post-build half of the extraction story. Given the built root provider, it creates a scope (`:223`) and, for every enabled module and every dependency that module declared remote, looks up the descriptors the disabled peer's stubs added and calls `ValidateRemoteDependencyStubs` (`:225-237`). That helper (`:240`) skips open generics, resolves each stub's `ServiceType`, and **throws** with a remediation message if it does not resolve at all (`:248-253`); if it resolves but is still the stub implementation type, it only logs a warning (`:255-259`), because a best-effort dependency may intentionally keep its stub. Configuration trust alone is not enough: a typo in a `RemoteDependencies` entry or a forgotten `AddTypedGrpcClient` would otherwise surface as a first-request failure or a silent no-op instead of at startup (`:202-215`).
  - **`SeedAllAsync`** (`:270`): awaits each collected seeder's `SeedAsync` in registration (that is, topological) order, with `ConfigureAwait(false)` (`:272-275`).
  - **`TopologicalSort`** (`:286`): builds `modulesByName`, `inDegree`, and a reverse-adjacency `dependents` map, all `OrdinalIgnoreCase` (`:288-294`); while building the graph it **ignores dependencies on modules that were not discovered** (`:301-302`), deferring those to registration-time validation. It seeds a `Queue<string>` with the zero-in-degree modules (`:310-311`) and drains it, decrementing each dependent's in-degree and enqueuing at zero (`:314-325`). If fewer modules were emitted than exist, the remainder form a cycle, and it throws `InvalidOperationException` naming them (`:328-333`).

- **Why it's built this way**: convention over configuration. Discovery plus sort means no manual ordering and no module-registration list to keep in sync, which is the decision recorded in [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) (a disabled module is represented by **stub registrations** rather than by absence, so a dependent always resolves something).

- **Where it's used**: constructed directly in each service host's composition root, with a real logger attached through the `init` property, then handed the configuration builder, settings, and environment name, and finally registered as a singleton so startup code can call `SeedAllAsync` later. All four ADC services do this identically (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:314-319` and `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:260-264`), as do Store's three (for example `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:241-245`, `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:225-229`). Each of those hosts enables exactly one module in configuration; a monolith host would discover and register all of them through the same loader.

- **Caveats / not-in-source**: two capabilities exist but have no production caller today. Every ADC and Store host calls the five-parameter `DiscoverAndRegister` (the AppDomain scan), not the explicit-assemblies overload its own XML doc recommends. And `ValidateRemoteDependencies` is exercised only by `ModuleLoaderTests` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:132`, `:145`, `:159`); no `Program.cs` in this workspace calls it after `builder.Build()`. The tests are also the only caller of the explicit-assemblies overload (`ModuleLoaderTests.cs:42`), which their own header comment says is deliberate (`:14`).

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:21` · Level 9 · class (static, C# `extension(IServiceCollection)`)

- **What it is**: the composition-root extension class that assembles the framework's entire Application layer into the DI container. It exposes five `IServiceCollection` extension methods: `AddApplication()`, `AddApplicationDecorators()`, `ScanModuleApplicationServices<TAssemblyMarker>()`, `AddUserDataExportSection<TSection>()`, and `AddApplicationProfiling()`. Every consuming host calls these, in a specific order, before wiring Infrastructure.

- **Depends on**: the core singletons `IDomainEventDispatcher` / [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline); the settings bridge [`IApplicationSettings`](#iapplicationsettings) over [`ApplicationSettings`](#applicationsettings); the marker [`ClassReference`](#classreference); the open-generic handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the five command decorators [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult), [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult), [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult), [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult); the three query decorators [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult), [`FeatureGateQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult); the optional [`ProfilingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#profilingcommanddecoratortcommand-tresult) and [`ProfilingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#profilingquerydecoratortquery-tresult); the scanned contract families [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype); the request-validator bridge [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest); and the export contributor contract [`IUserDataExportSection`](#iuserdataexportsection). Externals: **FluentValidation** (`AddValidatorsFromAssemblyContaining`, `IValidator<>`), **Scrutor** (`Scan`, `TryDecorate`), `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAdd*`, `TryAddEnumerable`), `Microsoft.Extensions.Options`.

- **Concept introduced, the CQRS decorator pipeline wiring order (Scrutor `TryDecorate`).** `[Rubric §6, CQRS and Event-Driven]` assesses whether cross-cutting handler concerns are applied uniformly; `[Rubric §2, Design Patterns]` covers the Decorator pattern itself (the individual decorators are taught in [group-05](group-05-cqrs-pipeline.md)). **Scrutor's `TryDecorate` applies decorators in reverse registration order**: the *last* registered call becomes the *outermost* wrapper. `AddApplicationDecorators` (`DependencyInjection.cs:89`) registers the five command decorators in source order Transactional, Validating, Caching, Logging, FeatureGate (`:94-98`), which produces the execution nesting its own XML doc draws (`:53-61`):

  ```
  FeatureGateCommandDecorator        (outermost, short-circuits if the feature flag is off)
    -> LoggingCommandDecorator       (measures full pipeline duration of enabled features)
      -> CachingCommandDecorator     (invalidates cache only AFTER the transaction commits)
        -> ValidatingCommandDecorator (short-circuits with Result.Failure before any transaction)
          -> TransactionalCommandDecorator (wraps the handler in a DB transaction if ITransactional)
            -> ConcreteHandler       (the actual business logic)
  ```

  Queries get the lighter three-deep chain FeatureGate, Logging, Caching, handler (`:101-103`), with no validation and no transaction because queries do not mutate. This file is the one place where the register-order versus execute-order inversion has to be held in mind, and the comments on each line say so. The ordering is not arbitrary; the XML doc's design rationale (`:72-86`) gives the reasons: feature gating is outermost so disabled features cost nothing, logging sits inside it so it measures only enabled executions, validation sits *outside* the transaction so malformed commands never open one, cache invalidation sits *outside* validation so cache is cleared only after a valid committed mutation, a business `Result.IsFailure` rolls the transaction back and skips invalidation, and an exception rolls back and propagates through every decorator. The same order is the decision recorded in [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).

- **Concept introduced, `ScanModuleApplicationServices<TAssemblyMarker>()`, the convention scanner.** `[Rubric §5, Vertical Slice]` (one call wires a whole module's slice types) and `[Rubric §14, Testability]` (handler registration is reproducible in a test host with the same one call). Lines `:119-156` run **seven passes** over the single marker assembly, each with a deliberate lifetime: domain event handlers (`IDomainEventHandler<>`, **singleton**, because they create their own scopes, `:119-123`), integration event handlers (`IIntegrationEventHandler<>`, **singleton**, `:126-130`), DTO mappers (`IEntityDTOMapper<,,>`, **scoped**, registered `AsSelfWithInterfaces`, `:132-136`), request mappers (`IEntityRequestMapper<,,>`, **scoped**, `:138-142`), command handlers (`ICommandHandler<,>`, **scoped**, `:144-148`), query handlers (`IQueryHandler<,>`, **scoped**, `:150-154`), and FluentValidation validators (`:156`). After the passes, a reflection loop (`:160-176`) finds every type in the assembly implementing `ICommandWithRequest<TRequest>`, constructs `CommandRequestValidator<TCommand, TRequest>` and `IValidator<TCommand>` with `MakeGenericType`, and `TryAddTransient`s the pair (`:171-175`), so a command that embeds its own request DTO gets a bridging validator for free. `TryAdd` is load-bearing here: an explicit `IValidator<TCommand>` picked up by the earlier `AddValidatorsFromAssemblyContaining` pass always wins, which the inline comment states (`:158-159`).

- **Concept introduced, the accumulating contributor registration.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether data-subject obligations are met by design: `AddUserDataExportSection<TSection>()` (`:206`) is how each module contributes the slice of a person's data it owns to one export document ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). The mechanism is two lines, `TryAddScoped<TSection>()` then `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`:209-210`), and both halves matter. `TryAddEnumerable` de-duplicates by *implementation type*, so registering the same section twice adds it once while two different sections both survive, which a plain `AddScoped` would not guarantee. **Scoped**, not singleton, so a section runs inside the request's unit of work and may take repositories or gRPC clients (`:196-198`). Registration order is the order the sections appear in the export document (`:190-194`).

- **Walkthrough**
  - `AddApplication()` (`:29`): `TryAddSingleton` for [`IApplicationSettings`](#iapplicationsettings) resolved from `IOptions<ApplicationSettings>` (`:31`), then `IDomainEventDispatcher`, `INavigationMetadataProvider`, and `IEntityQueryPipeline` (`:33-35`); finally `AddValidatorsFromAssemblyContaining<ClassReference>()` (`:40`) to register the framework's own validators (the comment names `LoginRequestValidator` and `RefreshTokenRequestValidator`), which a module-level scan would never reach because it only scans the module's own assembly (`:37-39`).
  - `AddApplicationDecorators()` (`:89`): the five command plus three query `TryDecorate` calls described above. It **must** run after every module's `ScanModuleApplicationServices` so Scrutor has concrete handlers to wrap, which the XML doc states (`:46-47`) and MMCA.Common `CLAUDE.md` repeats as the one load-bearing ordering rule.
  - `ScanModuleApplicationServices<TAssemblyMarker>()` (`:115`, constrained `where TAssemblyMarker : class` at `:116`): the seven-pass scanner plus the request-validator loop.
  - `AddUserDataExportSection<TSection>()` (`:206`, constrained `where TSection : class, IUserDataExportSection` at `:207`): the accumulating contributor registration. The export handler itself needs no registration here: apps subclass [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) in their own Application assembly and the scanner above picks the subclass up as an `IQueryHandler` like any other (`:199-204`).
  - `AddApplicationProfiling()` (`:219`): optional, `TryDecorate`s `ProfilingCommandDecorator<,>` and `ProfilingQueryDecorator<,>` on top (`:221-222`), for use with `IApplicationSettings.UseMiniProfiler`.

- **Why it's built this way**: `[Rubric §3, Clean Architecture]`: registration lives in a static `DependencyInjection.cs` at the composition root, so domain and Application types never reference the container. The pervasive `TryAdd*` and `TryDecorate` pattern lets a consuming app override any framework default simply by registering its own implementation first. The whole class body is a single `extension(IServiceCollection services)` block (`:23`), the C# preview extension-member syntax the framework uses for all DI registration, see [primer §4](00-primer.md#c-extensiont-types-read-this-once).

- **Where it's used**: called from every consuming host in the canonical sequence, `AddApplication()`, then one `ScanModuleApplicationServices<ClassReference>()` per module (issued from each module's own composition root), then `AddApplicationDecorators()` last. In ADC the two framework calls bracket the module registration in each service's `Program.cs` (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:287` and `:349`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:229` and `:303`), with the [`ModuleLoader`](#moduleloader) call in between; Store's hosts follow the identical shape (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:197` and `:248`). `AddUserDataExportSection<TSection>()` is called by ADC's Identity module for its two cross-module sections (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`) and by Store's `IdentityModule` for its one (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`).

- **Caveats / not-in-source**: several other classes named `DependencyInjection` exist across the framework and the apps (Infrastructure, API, Grpc, UI, Notifications, and one per module) with the same name but different namespaces and methods. This section covers only the **MMCA.Common.Application root** at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:21`; the others are documented in their own groups. `AddApplicationProfiling()` has no caller in any host in this workspace.

### AssemblyReference
> MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8` · Level 0 · class (static)

- **What it is**: the Domain layer's assembly-marker anchor. A static class holding the assembly it lives in and that assembly's simple name, so anything that needs to say "the MMCA.Common.Domain assembly" can say it through a type that exists for no other reason. Its XML doc names the two intended consumers: Scrutor assembly-scanning registration and architecture tests (`AssemblyReference.cs:5-7`).

- **Depends on**: `System.Reflection.Assembly` (BCL, imported at `AssemblyReference.cs:1`). Nothing first-party, which is why it sits at Level 0. Note that Domain is the innermost layer above `MMCA.Common.Shared`, so this marker could not depend on anything else even if it wanted to.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems reach for a recognised, deliberate shape. When registration code or a fitness test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form: it is far more stable than pointing at a real business type that may later move to another project or be renamed. `[Rubric §1, SOLID]` (DIP): the scan depends on a stable, meaningless token rather than on a concrete domain type. The same two-type pair repeats verbatim in every layer package (`MMCA.Common.Application/AssemblyReference.cs:5`, `MMCA.Common.Infrastructure/AssemblyReference.cs:5`, `MMCA.Common.API/AssemblyReference.cs:8`), so each assembly is self-describing with no cross-layer reference; those sibling copies have their own sections in this chapter and in [Group 12](group-12-api-hosting-mapping.md).

- **Walkthrough**: two `public static readonly` fields, both resolved once at type initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:10`), a self-reference so the field can never point at the wrong assembly. `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:11`), so the field is non-null even in the pathological case where the runtime reports no simple name.

- **Why it's built this way**: `static readonly` rather than a property means the reflection call happens once per process, and the self-referencing `typeof` makes the anchor refactor-proof: moving the file inside the project changes nothing, and moving it out of the project is exactly the case you would want to notice.

- **Where it's used**: nothing inside MMCA.Common references the Domain copy today. The Application copy backs `AddValidatorsFromAssemblyContaining<ClassReference>()` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:40`) and the Infrastructure copy backs the entity-configuration scan `FromAssemblyOf<ClassReference>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:114`); the Domain layer registers nothing by convention, so its marker stays available rather than exercised.

- **Caveats / not-in-source**: the XML doc names architecture tests as a consumer, but the per-repo architecture maps anchor the Domain layer with `typeof(MMCA.Common.Domain.Entities.BaseEntity<>).Assembly` instead (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:16`, and identically in the Helpdesk and ECommerce maps). Whether a downstream consumer outside this workspace scans through this anchor is Not determinable from source here.

---

### ClassReference
> MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:18` · Level 0 · class

- **What it is**: the non-static companion to the Domain layer's `AssemblyReference`, an empty instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class cannot satisfy the constraint.

- **Depends on**: nothing first-party, and nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught in the preceding section. C# static classes cannot be used as generic type arguments, so any helper constrained to an instantiable reference type (Scrutor's `FromAssemblyOf<T>()`, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`) is handed `ClassReference` instead. The XML doc says exactly that: an anchor for assembly resolution when `AssemblyReference` cannot be used, for example under generic type constraints requiring a non-static class (`AssemblyReference.cs:14-17`). `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token means "this assembly" in every package, so wiring a new scan never involves hunting for a suitable real type.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`AssemblyReference.cs:18`). No members, no constructor, no interface. Deliberately not `sealed` and not `static`, because both would defeat its purpose as a generic argument for helpers that may construct it.

- **Where it's used**: as with its static twin, the Domain copy has no call site inside MMCA.Common; the Application and Infrastructure copies are the ones the composition roots scan through (`MMCA.Common.Application/DependencyInjection.cs:40`, `MMCA.Common.Infrastructure/DependencyInjection.cs:114`).

---

### IUserScopedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8` · Level 0 · interface

- **What it is**: a one-member shape interface saying "this command or query targets a single user account". It exposes exactly `UserIdentifierType UserId { get; }` and nothing else.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (`global using UserIdentifierType = int;` in `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`, the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Nothing else, first-party or external.

- **Concept introduced, shape interfaces instead of shared request records.** `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion together, and this is the smallest possible instance of both: the shared Users use-case bases need one fact about the incoming message (which account it addresses), so that fact, and only that fact, becomes the contract. The XML doc states the motivation directly (`IUserScopedRequest.cs:3-7`): each app keeps its own command or query record, with its own [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) choice and its own docs, and simply adds this interface. `[Rubric §16, Maintainability]`: hoisting the *behavior* into a base class while leaving the *record* app-side is what let ADC and Store share the handlers without either app losing a per-app pipeline decision.

- **Walkthrough**: a single interface with a single get-only property (`IUserScopedRequest.cs:11`). There is no base interface and no default member, so implementing it is free for a `record` that already has a `UserId` positional parameter.

- **Where it's used**: extended by [`IUserOwnedRequest`](#iuserownedrequest) and [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest), both Level 1 in this chapter. Implemented directly by the one shared query record in the framework, [`GetUserPreferencesQuery`](#getuserpreferencesquery) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`).

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

- **What it is**: a non-generic holder for the four compile-time-generated log messages emitted by the shared Users use-case bases: password changed, preferences changed, account erased, and a degraded data-export section.

- **Depends on**: `Microsoft.Extensions.Logging` (`ILogger`, `[LoggerMessage]`, imported at `UserUseCaseLog.cs:1`) and the `UserIdentifierType` alias. No first-party types.

- **Concept introduced, source-generated logging in a non-generic holder.** `[Rubric §13, Observability and Operability]` assesses whether diagnostics are structured, cheap, and consistent. `[LoggerMessage]` is a Roslyn source generator: it emits a strongly typed, allocation-free log call with a pre-compiled message template, so nothing is boxed or formatted when the level is disabled. The subtle part is *where* the methods live. Putting them on a generic base class would produce one generated logger per closed generic type; declaring them once in a plain static holder means every app subclass writes the identical message text, while the **log category** still comes from the `ILogger<THandler>` the subclass injects, so filtering by handler behaves exactly as it did before the shared bases existed (`UserUseCaseLog.cs:5-10`). `[Rubric §16, Maintainability]`: one place to change the wording of a security-relevant or privacy-relevant event.

- **Walkthrough**: four `internal static partial void` declarations, each attributed with a level and a template.
  - `PasswordChanged`, `Information`, "User {UserId} password changed" (`UserUseCaseLog.cs:13-14`).
  - `PreferencesChanged`, `Information` (`UserUseCaseLog.cs:16-17`).
  - `UserErased`, `Information`, "User {UserId} account deleted and personal data anonymized" (`UserUseCaseLog.cs:19-20`).
  - `ExportSectionUnavailable`, **`Warning`**, "Data-subject export section {Section} unavailable for user {UserId}; export continues with Available=false" (`UserUseCaseLog.cs:22-23`). This is the only one that takes an `Exception`, and it takes it in the generator's conventional second position (after `ILogger`, before the template arguments), so the failure detail is attached to the log entry rather than interpolated into the message.
  - Every method takes the `ILogger` as its first parameter, which is what lets a generic base pass its own injected logger into a non-generic holder. The class is `internal`, so none of this is public package surface.

- **Why it's built this way**: the wording of `UserErased` records the erasure model rather than a hard delete, the framework default in [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (the row survives soft-deleted while personal fields are anonymized). `ExportSectionUnavailable` is at `Warning` and not `Error` on purpose: a degraded section is an expected, handled outcome of a best-effort fan-out, and the request itself still succeeds.

- **Where it's used**: [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) calls `PasswordChanged` after a successful save (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:66`); [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) calls `PreferencesChanged` (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:59`); [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) calls `UserErased` (`.../DeleteUser/DeleteUserHandlerBase.cs:116`); [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) calls `ExportSectionUnavailable` from its per-section catch (`.../ExportUserData/ExportUserDataHandlerBase.cs:190`).

---

### IUserOwnedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus the authenticated caller. It adds `CurrentUserId` and the caller's (nullable) role claim, which is exactly the input the shared owner-or-privileged-role check needs.

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface) and the `UserIdentifierType` alias.

- **Concept introduced, carrying the caller inside the message.** `[Rubric §11, Security]` assesses whether authorization decisions are made deliberately and consistently rather than ad hoc. In this codebase resource-ownership authorization exists on two levels: at the API level as an action filter plus a specification ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)), and at the handler level as this interface plus [`UserOwnershipRule`](#userownershiprule). The controller projects the caller's claims into the command or query, and the handler decides. Putting the caller *in the message* rather than injecting a current-user service into the handler keeps the handler a pure function of its input, which is what makes the shared bases unit-testable with no HTTP context (`[Rubric §14, Testability]`).

- **Walkthrough**: two added members. `UserIdentifierType CurrentUserId { get; }` (`IUserOwnedRequest.cs:11`) is the authenticated caller. `string? CurrentUserRole { get; }` (`IUserOwnedRequest.cs:14`) is the role claim, explicitly nullable because a token may carry no role at all. `UserId` is inherited, so an implementing record must expose both the target and the caller.

- **Why it's built this way**: the XML doc names the goal (`IUserOwnedRequest.cs:3-7`), a single uniformly applied owner-or-privileged-role check across the account-deletion and data-export use cases in both apps. The role itself is deliberately *not* interpreted here: each app owns its own role vocabulary, so the interface carries the raw claim string and the rule takes an already-evaluated boolean.

- **Where it's used**: the type constraint on all three consumers of the ownership rule: [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) (`.../DeleteUser/DeleteUserHandlerBase.cs:42`), [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`.../ExportUserData/ExportUserDataHandlerBase.cs:55`), and the API-layer [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:63`). It is also the parameter type of [`UserOwnershipRule.CheckOwnership`](#userownershiprule). Implemented app-side by each export query (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:15`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:16`) and by each delete command.

---

### IUserScopedCommand<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:13` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus an embedded request payload. A command implementing it says "I target this user, and here is the DTO the caller sent".

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface). Nothing external.

- **Concept, covariant shape interfaces and the deliberate non-overlap with `ICommandWithRequest<TRequest>`.** The type parameter is declared `out TRequest` (`IUserScopedCommand.cs:13`), so `IUserScopedCommand<DerivedRequest>` is usable where `IUserScopedCommand<BaseRequest>` is expected. The more instructive part is the XML doc's warning (`IUserScopedCommand.cs:6-11`): this interface is **deliberately separate** from [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), even though both expose a `Request` property, because `ICommandWithRequest` *also* opts the command into automatic [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) registration (see `ScanModuleApplicationServices` in [`DependencyInjection`](#dependencyinjection)). That is a per-app decision: ADC and Store agree on it for the password change and disagree on it for preferences. A command may implement both; implementing this one alone changes no pipeline behavior. `[Rubric §1, SOLID]`: two interfaces because there are two responsibilities, shape versus pipeline opt-in, even though they would collapse neatly into one.

- **Walkthrough**: one added member, `TRequest Request { get; }` (`IUserScopedCommand.cs:16`), on top of the inherited `UserId`.

- **Why it's built this way**: the split is what lets one shared handler base read any app's command uniformly while each app keeps its own validation and cache-invalidation posture. Store's change-password command implements both interfaces (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:13`) while its preferences command implements only this one (`.../ChangePreferences/ChangePreferencesCommand.cs:12`); ADC's equivalents add `ICacheInvalidating` on top (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15`, `.../ChangePreferences/ChangePreferencesCommand.cs:15`).

- **Where it's used**: the constraint on [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) (`.../ChangePassword/ChangePasswordHandlerBase.cs:29`) and [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:27`), and the two constraints on [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:47-48`), where the base reads the app-supplied command back only through this interface.

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

- **Where it's used**: the return type of `IUserDataExportSection.ExportAsync` (`IUserDataExportSection.cs:38`), consumed by [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery)'s `RunSectionAsync`, which copies its four fields into a [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`ExportUserDataHandlerBase.cs:177-183`). Produced by every concrete section, for example Store's `SalesUserDataExportSection` returning `Complete` with an empty payload for an account with no linked customer (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:45`).

---

### IUserDataExportSection
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:20` · Level 2 · interface

- **What it is**: the contributor contract for a data-subject export. One implementation is one module (or one cross-service peer client) that holds personal data keyed by user and can hand it over on request.

- **Depends on**: [`UserDataExportSectionResult`](#userdataexportsectionresult) (Level 1, its return type) and the `UserIdentifierType` alias. Nothing external beyond `Task` and `CancellationToken`.

- **Concept introduced, the accumulating-registration extension point.** `[Rubric §5, Vertical Slice]` assesses whether a feature's pieces cluster inside the boundary that owns them: the export document is assembled centrally, but *what each module contributes* is written and registered by that module, so adding personal data to a module means adding one section, not editing a central projection. `[Rubric §7, Microservices Readiness]`: a section may be backed by an in-process repository read or by a gRPC client to an extracted peer, and the export handler cannot tell the difference. `[Rubric §30, Compliance, Privacy and Data Governance]`: this is the mechanism by which "all personal data we hold about you" stays complete as modules are added, which is the obligation [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) exists to discharge. `[Rubric §29, Resilience]`: sections are explicitly **best-effort**, and the contract says so in its own remarks (`IUserDataExportSection.cs:8-14`): a throwing section degrades to `Available = false` and the export still succeeds, because one unreachable peer must never deny a data subject the rest of their data.

- **Walkthrough**: two members.
  - `string SectionName { get; }` (`IUserDataExportSection.cs:27`), the stable name the section is published under in the document ("Engagement", "Sales"). The doc calls it part of the contract rather than a label to reword, because it appears verbatim in the package a data subject reads.
  - `Task<UserDataExportSectionResult> ExportAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`IUserDataExportSection.cs:38-40`). Its doc states the tolerance explicitly: throwing is permitted, and the handler degrades the section, but returning `UserDataExportSectionResult.Unavailable` is preferred where the reason is known (`:34-37`).
  - Registration is a separate one-liner: `AddUserDataExportSection<TSection>()` does `TryAddScoped<TSection>()` plus `TryAddEnumerable(ServiceDescriptor.Scoped<IUserDataExportSection, TSection>())` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:206-212`). `TryAddEnumerable` is the load-bearing call: registrations **accumulate** across modules while the same type registered twice is added once, and registration order becomes document order (`DependencyInjection.cs:187-198`). The lifetime is **scoped**, so a section runs inside the request's unit of work and may take scoped dependencies.

- **Why it's built this way**: the alternative, a central export handler that knows every module's data, would couple the Identity module to every other module and would break the moment one of them was extracted into its own service. Fan-out over an injected `IEnumerable<IUserDataExportSection>` keeps that knowledge inside each module and turns extraction into a change of what the section calls, not of who contributes.

- **Where it's used**: injected as `IEnumerable<IUserDataExportSection>` into [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) (`ExportUserDataHandlerBase.cs:51`). Implemented by [`EngagementUserDataExportSection`](group-24-identity-module.md#engagementuserdataexportsection) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/EngagementUserDataExportSection.cs:20`) and [`NotificationUserDataExportSection`](group-24-identity-module.md#notificationuserdataexportsection) (`.../NotificationUserDataExportSection.cs:19`), both registered in that order (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`), and by Store's `SalesUserDataExportSection` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:24`), registered by its Identity module (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:40`).

- **Caveats / not-in-source**: whether a given section's peer is reachable in a given environment is a deployment fact, not a source fact. The source settles only that an unreachable peer degrades one section.

---

### UserOwnershipRule
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21` · Level 2 · class (static)

- **What it is**: a single static method encoding the self-service authorization rule shared by every use case that acts on one account on behalf of its owner: the caller must be the account owner, or hold the app's privileged role. It returns `null` when allowed and a ready-made [`Error`](group-01-result-error-handling.md#error) when not.

- **Depends on**: [`IUserOwnedRequest`](#iuserownedrequest) (Level 1, the parameter type), plus [`Error`](group-01-result-error-handling.md#error) and [`ErrorType`](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions` (imported at `UserOwnershipRule.cs:1`).

- **Concept introduced, the "return the error, do not throw" authorization helper.** `[Rubric §11, Security]` assesses whether authorization is uniform and auditable. The idiom being hoisted here (caller is not the owner and has no bypass role, therefore forbidden) had been written out four times across the two apps, in account deletion and data export in each, which the XML doc records as the motivation (`UserOwnershipRule.cs:9-14`). `[Rubric §2, Design Patterns]`: it is deliberately a **plain static helper**, not a base class or a decorator, because at the time of the hoist the two data-export handlers were expected to stay app-level and still needed the identical decision and the identical error shape. `[Rubric §1, SOLID]`: the role test arrives **already evaluated** as a `bool`, so the helper never learns either app's role vocabulary (`UserRole.IsOrganizer` in ADC versus `UserRole.IsAdmin` in Store), and both are case-insensitive on the app side because a role claim may carry any casing (`UserOwnershipRule.cs:15-19`). This is the Application-layer counterpart to the API-layer ownership axis of [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html); that ADR records the filter and specification forms and does not name this helper.

- **Walkthrough**: one method, `static Error? CheckOwnership(IUserOwnedRequest request, bool callerHasPrivilegedRole, string code, string message, string source)` (`UserOwnershipRule.cs:38-43`). It guards with `ArgumentNullException.ThrowIfNull(request)` (`:45`), then evaluates one conditional expression: if `request.CurrentUserId == request.UserId || callerHasPrivilegedRole`, return `null` (allowed); otherwise return `Error.Forbidden(...)` with the caller-supplied `code`, `message`, and `source`, and with `target` fixed to `nameof(IUserOwnedRequest.UserId)` (`:47-53`). Fixing the target while parameterising code, message, and source is what keeps the error payload identical to the four hand-written copies it replaced, since each of those reported its own handler name as the source.

- **Why it's built this way**: returning `Error?` rather than throwing keeps the caller on the framework's [Result pattern](group-01-result-error-handling.md#result) ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)): the handler wraps it as `Result.Failure(forbidden)` and the API layer maps it to 403 through the usual error mapping, with no exception unwinding on an expected authorization outcome.

- **Where it's used**: both shared account-scoped bases call it first thing in `HandleAsync`. [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) passes `HasDeletePrivilege(command.CurrentUserRole)` and the code `"User.DeleteForbidden"` (`.../DeleteUser/DeleteUserHandlerBase.cs:62-65`); [`ExportUserDataHandlerBase<TUser, TQuery>`](#exportuserdatahandlerbasetuser-tquery) passes `HasExportPrivilege(query.CurrentUserRole)` and the code `"User.ExportForbidden"` with the message "You can only export your own account data." (`.../ExportUserData/ExportUserDataHandlerBase.cs:81-86`). Both pass their own `HandlerName` as the source, so the error still names the concrete app handler.

---

### ExportUserDataHandlerBase<TUser, TQuery>
> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ExportUserData` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49` · Level 8 · class (abstract, generic)

- **What it is**: the shared data-subject export workflow (GDPR/CCPA access and portability). It authorizes the caller, loads the account read-only, asks the subclass for the app's own snapshot of that account, fans out best-effort over every registered [`IUserDataExportSection`](#iuserdataexportsection), and assembles one JSON-ready package the data subject can be handed.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and, through it, [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype); [`IUserDataExportSection`](#iuserdataexportsection) (injected as an `IEnumerable`); [`IUserOwnedRequest`](#iuserownedrequest) (the `TQuery` constraint) and [`UserOwnershipRule`](#userownershiprule); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (the `TUser` constraint); [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (the contract it implements); [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); the Shared-layer DTOs [`UserDataExportDTO`](group-08-auth.md#userdataexportdto) and [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` and `:61`); and [`UserUseCaseLog`](#userusecaselog). Externals: `TimeProvider` and `ILogger` (both injected through the primary constructor, `ExportUserDataHandlerBase.cs:50-53`).

- **Concept introduced, the template-method handler that owns the workflow and delegates only what is genuinely app-specific.** `[Rubric §2, Design Patterns]` assesses deliberate pattern use: this is Template Method applied to a use case, with exactly three extension points (one abstract role check, one abstract projection, one virtual tail) and everything else fixed. `[Rubric §16, Maintainability]`: the two apps previously carried near-identical export handlers; hoisting the workflow left each subclass with the two decisions that actually differ. `[Rubric §30, Compliance, Privacy and Data Governance]`: the assembled document is **PII by design**, so its class doc states it must never be logged or cached, and notes that the caching query decorator is not applicable because the query implements no [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) (`ExportUserDataHandlerBase.cs:42-45`). `[Rubric §29, Resilience]`: the fan-out degrades per section rather than failing, since a data-subject request carries a legal deadline ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)). `[Rubric §14, Testability]`: because authorization arrives inside the query and time arrives as `TimeProvider`, the whole workflow is exercised with mocks and no host (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:17`).

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

- **Where it's used**: subclassed in each app's Identity Application assembly, where the convention scanner picks the concrete subclass up as an ordinary `IQueryHandler` with no extra registration (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:199-204`). ADC's `ExportUserDataHandler` closes it over `User` and `ExportUserDataQuery` and overrides only the two abstract members (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:30-44`, privilege = `UserRole.IsOrganizer`); Store's does the same with its own `User` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:39`). Behaviour is pinned by `ExportUserDataHandlerBaseTests`, including a section that throws and a section that cancels (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:309` and `:320`).

- **Caveats / not-in-source**: the framework also ships an abstract `[FeatureGate]`-d endpoint, [`DataExportControllerBase<TQuery>`](group-12-api-hosting-mapping.md#dataexportcontrollerbasetquery) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:60`), but neither app subclasses it: both kept their own export endpoints on top of this handler base, which the ADR records as an unadopted part of the decision.

---

### SoftDeletedUserValidator<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19` · Level 8 · class (sealed, generic)

- **What it is**: the one shared implementation of [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator). It answers a single question, "does a row for this user exist **and** is it soft-deleted", in one query that deliberately bypasses the global soft-delete query filter.

- **Depends on**: [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (the interface it implements, from `MMCA.Common.Application.Interfaces.Infrastructure`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (injected via primary constructor), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (obtained from the unit of work), and [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint. Its Level 8 position is inherited from that repository and unit-of-work chain, not from any complexity of its own.

- **Concept introduced, closing a generic over the app's aggregate instead of subclassing.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access: stateless JWT means a token stays valid until it expires, so [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) (BR-133) adds a middleware that rejects an authenticated caller whose account has since been soft-deleted, and this class is the lookup behind it. `[Rubric §8, Data Architecture]`: the check must see rows the rest of the application cannot, so it passes `ignoreQueryFilters: true` to punch through the soft-delete global filter for this one predicate. `[Rubric §16, Maintainability]`: because the type is generic over `TUser` rather than abstract, an app supplies only a type argument at registration and needs **no** per-app subclass (`SoftDeletedUserValidator.cs:11-17`).

- **Walkthrough**: a primary-constructor class taking `IUnitOfWork unitOfWork`, constrained `where TUser : AuditableAggregateRootEntity<UserIdentifierType>` (`SoftDeletedUserValidator.cs:19-20`). The single method `IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken cancellationToken = default)` (`:23-25`) resolves the repository through `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:27`), then returns `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, cancellationToken: cancellationToken)` with `ConfigureAwait(false)` (`:30-33`). Note it is `GetRepository` off the unit of work rather than a constructor-injected `IRepository<,>`, which is the framework-wide rule for repository access, and the predicate is written against the open type parameter but closes over the concrete entity at run time, so EF translates it exactly as a hand-written app query would.

- **Why it's built this way**: one query answers both halves of the question (exists and is deleted), so the middleware pays a single round trip and cannot mistake "unknown user" for "deleted user". Expressing the predicate against `TUser` keeps the framework free of any reference to an app's `User` aggregate while still producing a fully translated EF query.

- **Where it's used**: registered per app, closed over that app's `User` aggregate: `services.TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()` in `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:35` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:41`. The consumer is [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which resolves the interface **lazily** per request via `context.RequestServices.GetService<ISoftDeletedUserValidator>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75`), so a host that registers no validator degrades to a no-op instead of failing. Each app also pins the behaviour directly, for example `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:34`.

### AssemblyReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class that exposes the assembly it lives in plus that assembly's simple name. It is the Infrastructure layer's assembly-marker anchor, a deliberate, business-free type whose only job is to name "this assembly" for convention-based scanning.

- **Depends on**: `System.Reflection.Assembly` (BCL) only (`AssemblyReference.cs:1`). No first-party dependencies, which is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems use recognised patterns; when a registration or test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form, far more stable than `typeof(SomeRandomHandler).Assembly` pointing at a real class that might move or be renamed. `[Rubric §1, SOLID]` (DIP): registration code depends on a stable, meaningless token rather than a concrete business type, so refactoring real Infrastructure types never breaks a scan. The same shape (`AssemblyReference` + [`ClassReference`](#classreference)) repeats in every layer package (Application, Domain, API, and here in Infrastructure) so each assembly is self-describing without any cross-layer reference.

- **Walkthrough**: two `public static readonly` fields resolved once at type initialization (`AssemblyReference.cs:7-8`): `Assembly` via `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), and `AssemblyName` via `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:8`) so the field is never null even when the runtime reports no simple name.

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and repeating the identical shape in every package keeps each assembly self-describing without cross-layer references.

- **Where it's used**: the Scrutor entity-configuration scan inside [`DependencyInjection`](#dependencyinjection)`.AddInfrastructure` uses `FromAssemblyOf<ClassReference>()` (the non-static companion, below); the NetArchTest architecture maps pin this assembly through the same anchor.

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

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the recording sites resolve nothing from DI. The meter name is duplicated as a **literal** in MMCA.Common.Aspire (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:168`) because that package has no reference to Infrastructure, and the doc records that duplication rather than letting the next reader discover it (`BrokerMetrics.cs:8-11`). The comment above the Aspire list states the operational consequence: these instruments are inert in a host that stays on the in-process bus (`Extensions.cs:155-163`).

- **Where it's used**: [`FaultIntegrationEventConsumer<TEvent>`](group-07-persistence-ef-core.md#faultintegrationeventconsumertevent) adds to `FaultCounter` right after logging the fault (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/FaultIntegrationEventConsumer.cs:51-53`), and [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) adds to `CircuitOpenCounter` on the `BrokenCircuitException` branch of its publish path (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:573-579`), where the surrounding comment explains why the counter is per row while the log line is per cycle (`OutboxProcessor.cs:567-572`, `:581-585`). Both recording sites are pinned by tests that listen on the meter name: `FaultIntegrationEventConsumerTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/FaultIntegrationEventConsumerTests.cs:89`) and `OutboxProcessorTests` (`.../Persistence/OutboxProcessorTests.cs:577`).

---

### ClassReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference) in the Infrastructure layer, an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught under [`AssemblyReference`](#assemblyreference). C# static classes cannot be used as generic type arguments, so any registration helper constrained to an instantiable reference type (for example Scrutor's `FromAssemblyOf<T>()`) is handed `ClassReference` instead of `AssemblyReference`. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token stands in for "this assembly" everywhere, so a developer wiring a new scan never has to hunt for a suitable real type.

- **Walkthrough**: a single-line body-less type declaration at `AssemblyReference.cs:11` (`public class ClassReference;`). No members.

- **Where it's used**: [`DependencyInjection`](#dependencyinjection)`.AddInfrastructure` calls `services.Scan(scan => scan.FromAssemblyOf<ClassReference>()...)` (`DependencyInjection.cs:113-117`, the anchor itself at `:114`) to discover every `IEntityTypeConfigurationBase<,>` in the Infrastructure assembly and register it as its implemented interfaces with a scoped lifetime.

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

### JobClaim
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:447` · Level 0 · record (private nested, sealed)

- **What it is**: the result of one attempt to claim a due job row: which row was due, the occurrence it was due at, the cron expression to compute the next occurrence from, and the claim token, which is null when a different replica won the row.

- **Depends on**: nothing first-party. BCL only (`string`, `DateTime`, `Guid?`). It exists solely as the return shape of [`ScheduledJobRunner`](#scheduledjobrunner)`.TryClaimNextDueAsync`.

- **Concept introduced, three answers in one return value.** A claim attempt has three outcomes, not two: nothing was due, something was due and this replica took it, or something was due and another replica took it first. `[Rubric §15, Best Practices & Code Quality]` assesses whether the code makes illegal states hard to express: the method returns `JobClaim?`, so `null` is "nothing due" and a non-null instance with a null `LockToken` is "lost the race" (`ScheduledJobRunner.cs:398-401`). Collapsing the latter two into one `null` would have cost the caller the ability to mark that name as attempted for this cycle and move on, which is exactly what stops the loop spinning on a row this replica will never own (`ScheduledJobRunner.cs:382-391`). A positional record gets that shape in one line with value equality and no mutable state.

- **Walkthrough**: four positional members, each documented (`ScheduledJobRunner.cs:442-447`): `JobName`, `DueOn` (the occurrence the row was due at, used for the lag metric), `CronExpression` (what the next occurrence is computed from, read from the row rather than recomputed from settings so an in-flight schedule change cannot retarget a run in progress), and `Guid? LockToken`. It is constructed once, at `ScheduledJobRunner.cs:439`, where the token is passed as `claimed == 0 ? null : lockToken`: the count of rows the claiming `ExecuteUpdateAsync` actually matched IS the race result.

- **Why it's built this way**: `private sealed record` keeps a purely internal carrier invisible to the package's public surface, so it costs nothing in API compatibility terms while still giving the claim path a named, immutable shape ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: returned by `TryClaimNextDueAsync` (`ScheduledJobRunner.cs:402-440`) and consumed by `RunDueJobsAsync` (`ScheduledJobRunner.cs:365-393`).

---

### RedisLockHandle
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:88` · Level 0 · class (private nested, sealed)

- **What it is**: the release token for a [`RedisDistributedLock`](#redisdistributedlock) acquisition. Disposing it runs a compare-and-delete Lua script that removes the Redis key only while it still carries this acquisition's token.

- **Depends on**: nothing first-party. Externals: StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`) and `Microsoft.Extensions.Logging`; `Interlocked` for the latch. Same handle shape as [`InProcessLockHandle`](#inprocesslockhandle), with real asynchronous work in the release.

- **Concept**: the owner-token release, the half of the `SET NX PX` lock that keeps it honest (the acquire half is taught under [`RedisDistributedLock`](#redisdistributedlock)). `[Rubric §13, Observability & Operability]` assesses whether a system reports its own degradation: a release that finds nothing to delete is exactly the case where the guarded section outran its time-to-live and stopped being exclusive, so the handle logs a warning naming the key rather than swallowing it.

- **Walkthrough**: the primary constructor captures the `IDatabase`, the already-qualified `RedisKey`, this acquisition's `RedisValue` token, and a logger (`RedisDistributedLock.cs:88-92`), with the same `int _released` latch (`RedisDistributedLock.cs:94`). `DisposeAsync` (`RedisDistributedLock.cs:96-113`) returns immediately when the latch was already set (`RedisDistributedLock.cs:98-101`); otherwise it evaluates `ReleaseScript` with that key and token (`RedisDistributedLock.cs:103-105`). The script is `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end` (`RedisDistributedLock.cs:36-37`), one round trip that compares and deletes atomically on the server. A `0` result means the key was already gone or is owned by someone else now, so there is nothing to release and `LogLockAlreadyExpired` warns (`RedisDistributedLock.cs:109-112`, message text at `RedisDistributedLock.cs:84`).

- **Why it's built this way**: a plain `DEL` would let a caller whose lock had already expired free the *next* holder's lock, which is precisely the double execution the lock exists to prevent (`RedisDistributedLock.cs:32-34`). Doing the comparison inside a Lua script makes compare-and-delete atomic server-side instead of a racy get-then-delete from the client ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).

- **Where it's used**: constructed by `RedisDistributedLock.TryAcquireAsync` (`RedisDistributedLock.cs:72`). `RedisDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:15`) asserts the acquire/release pairing against a mocked `IDatabase`, including the qualified key the handle deletes (`RedisDistributedLockTests.cs:17-18`).

---

### ScheduledJobEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20` · Level 0 · class (sealed)

- **What it is**: the persisted schedule and last-run record for one registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob): one row per job name, upserted by [`ScheduledJobRunner`](#scheduledjobrunner) on every cycle. It carries both the schedule (expression, next occurrence) and the claim lease that makes a multi-replica host safe.

- **Depends on**: nothing first-party and nothing beyond `string`, `DateTime` and `Guid` from the BCL, which is why it is Level 0.

- **Concept introduced, the framework bookkeeping entity.** `[Rubric §4, DDD]` assesses whether the domain model stays a model of the business: this class is deliberately **not** an `IAuditableEntity` and not an aggregate root, exactly like [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), because it is framework bookkeeping rather than domain state (`ScheduledJobEntry.cs:8-14`). The consequences are concrete: no soft-delete flag, so no global query filter applies to it; no audit stamps, so the save interceptors have nothing to write (which is why the runner can call a plain `SaveChangesAsync` with no user id, `ScheduledJobRunner.cs:316-318`); and no concurrency token, because its concurrency control is the explicit claim lease instead. `[Rubric §8, Data Architecture]`: the table is **host-scoped** and lives in the `Default` data source only, unlike the outbox, which exists once per physical source (`ScheduledJobEntry.cs:15-18`). Jobs belong to a host, not to a database. `[Rubric §11, Security]` by omission: it also carries no user data, which is what keeps it in the audit trail's framework-entity exclusion set alongside the outbox and inbox rows (`Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:113-119`, this type at `:118`).

- **Walkthrough**, in the order the runner touches them:
  - `JobName` (`ScheduledJobEntry.cs:26`), `required` and `init`-only: the primary key, matching `IScheduledJob.Name`, so a job has exactly one schedule row per host.
  - `CronExpression` (`ScheduledJobEntry.cs:34`), `required` with a setter: the five-field UTC expression currently in force, which is either the job's code default or the `Scheduler:Jobs:{Name}:Cron` override. The runner compares it against the resolved expression every cycle and recomputes the next occurrence only when it changed.
  - `NextRunOn` (`ScheduledJobEntry.cs:40`): the UTC instant the job next becomes due. A row whose expression cannot be parsed is parked at `DateTime.MaxValue` so it is never claimed, which is how one bad cron string in configuration fails just that job.
  - `LastRunOn` (`:43`), `LastOutcome` (`:50`, one of `Succeeded`, `Failed`, `Skipped`), `LastError` (`:57`, truncated to the column width and cleared on success so the column always describes the LAST outcome rather than the last failure ever seen), and `LastDurationMs` (`:60`): the operator-facing run record.
  - `LockedUntil` (`:67`) and `LockToken` (`:74`): the claim lease. Other replicas skip a row with an unexpired lease, so an occurrence runs once even with several replicas polling; the claiming replica stamps its outcome only on a row still carrying its own token, so a replica whose lease expired mid-execution cannot overwrite the record of the replica that took over.

- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) chose to apply the outbox's proven claim-lease idiom to cron rather than adopt Hangfire or Quartz.NET, so the row shape is deliberately the minimum that idiom needs: a due time, a lease, and a token.

- **Where it's used**: mapped by [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext)`.ConfigureScheduler` (`Persistence/DbContexts/ApplicationDbContext.cs:538-563`), which is **gated**: the entity is mapped only when the host set `Scheduler:Enabled` and this context targets the `Default` source (`ApplicationDbContext.cs:530-543`), so a host that never opted in keeps exactly the model, and the migrations, it had before the scheduler shipped. The mapping sets `ToTable("ScheduledJobs", "dbo")` (`:547`), the `JobName` key (`:548`), column widths matching the entity's documented truncation (`:549-552`), and one index on `NextRunOn` with the two lease columns as included columns (`:559-561`), deliberately NOT filtered to unlocked rows, because the poll must also find rows whose lease has expired (that is how a dead replica's work is reclaimed, `ApplicationDbContext.cs:554-558`). Every read and write of the row lives in [`ScheduledJobRunner`](#scheduledjobrunner).

---

### SchedulerMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument set for the recurring job scheduler: one meter carrying a run counter, an execution-duration histogram, and a schedule-lag histogram, all emitted by [`ScheduledJobRunner`](#scheduledjobrunner).

- **Depends on**: `System.Diagnostics.Metrics` (BCL) only (`SchedulerMetrics.cs:1`). Nothing first-party.

- **Concept introduced, the one-meter-per-feature instrument holder.** `[Rubric §13, Observability & Operability]` assesses whether a running system can be understood from outside: a background loop is invisible by construction (no request, no response code), so the only evidence that a schedule is healthy is telemetry. The three instruments here are chosen to answer the three operator questions: is it running, how long does it take, and is it on time. `[Rubric §31, Cost/FinOps]` shows up in the same design: the per-occurrence start and finish lines are logged at `Debug` rather than `Information` precisely because a busy schedule would otherwise double the runner's steady-state log volume (`ScheduledJobRunner.cs:578-585`), and the numbers an operator alerts on come from these metrics instead. A host exports them by registering the `MeterName` meter; the Aspire service defaults (`ConfigureOpenTelemetry`) already do (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:167`), and the doc records that the name is duplicated as a literal there because that package has no reference to Infrastructure (`SchedulerMetrics.cs:5-14`).

- **Walkthrough**:
  - `MeterName = "MMCA.Common.Scheduler"` (`SchedulerMetrics.cs:19`) and the single static `Meter` built from it (`:21`). The class doc is explicit that one meter serves every scheduler instrument and that a second `Meter` with this name must never be created (`SchedulerMetrics.cs:11-14`), since duplicate meters are a classic source of double-counted telemetry. [`BrokerMetrics`](#brokermetrics) repeats the same shape for the broker transport.
  - `RunCounter` (`SchedulerMetrics.cs:28-31`), `scheduler.job.runs`, tagged by `job` and `outcome`: the failure rate of a schedule is this counter split by outcome.
  - `DurationHistogram` (`:39-42`), `scheduler.job.duration` in **seconds**, tagged by `job`, measured around the job's own `ExecuteAsync` only so it excludes claim and bookkeeping cost. Its stated purpose is the lease relationship: a job whose duration approaches `Scheduler:LeaseSeconds` is about to lose its claim mid-run (`SchedulerMetrics.cs:33-38`).
  - `LagHistogram` (`:50-53`), `scheduler.job.lag` in seconds, the interval between an occurrence becoming due and actually starting. It is floored at zero, and a value near the polling interval is normal for an occurrence that landed just after a cycle (`SchedulerMetrics.cs:44-49`).

- **Why it's built this way**: `internal static readonly` instruments created once at type initialization means the runner records without resolving anything from DI, and keeping the meter name a constant on the same type is what lets a test assert against it. `SchedulerMetricsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerMetricsTests.cs:13`) pins the instrument surface.

- **Where it's used**: [`ScheduledJobRunner`](#scheduledjobrunner)`.ExecuteClaimedJobAsync` records the lag before invoking the job (`ScheduledJobRunner.cs:466-467`) and the duration plus the outcome-tagged count after it returns (`ScheduledJobRunner.cs:471-474`).

---

### UseDatabaseAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:22` · Level 0 · class (sealed attribute)

- **What it is**: a declarative attribute placed on an entity type configuration class to name the **logical data source (database)** that entity targets. It is the "which database" half of the database-per-microservice routing story; the sibling [`UseDataSourceAttribute`](#usedatasourceattribute) is the "which engine" half.

- **Depends on**: `System.Attribute` (BCL) only. Its resolved logical name is consumed downstream by the data-source machinery ([`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)) and mapped to a connection string through the `DataSources` configuration entries modelled by [`DataSourceEntrySettings`](#datasourceentrysettings) / [`DataSourcesSettings`](#datasourcessettings).

- **Concept introduced, declarative database-per-service routing.** `[Rubric §8, Data Architecture]` assesses how the model maps to physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The attribute's XML doc (`UseDatabaseAttribute.cs:8-18`) spells out the three-step resolution order for an entity's logical name: (1) this attribute on the concrete configuration class (inherited); (2) the module name derived from the entity namespace, the segment before `Domain`; (3) the literal `"Default"`, the top-level `ConnectionStrings` section. A logical name with no `DataSources` entry (or whose connection string equals the top-level one) collapses onto the `Default` physical source (`UseDatabaseAttribute.cs:15-17`), so a host that configures nothing behaves exactly like a single-database monolith. This "convention with an explicit override" shape is the load-bearing idea: most modules never apply the attribute and ride the namespace convention.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDatabaseAttribute.cs:21`). `Inherited = true` is deliberate: annotating a per-module configuration base class propagates the database assignment to every derived configuration, so a module can pin all its entities to one database in a single place. `AllowMultiple = false` forbids an ambiguous second assignment.
  - Primary-constructor parameter `name` (`UseDatabaseAttribute.cs:22`), the logical name (for example `"Conference"`, the example the doc itself uses at `:20`).
  - `Name` get-only property (`UseDatabaseAttribute.cs:25`) initialized from that parameter, the value the resolver reads.

- **Why it's built this way**: an attribute keeps the database choice declarative and co-located with the entity configuration rather than buried in a registration method, and `Inherited = true` turns per-module assignment into one annotation instead of one per entity ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database per microservice).

- **Where it's used**: applied on concrete EF entity type configuration classes in the modules; read up front by the eager [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) so routing does not depend on a model having been built.

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

- **Where it's used**: registered by `AddCaching` in the Infrastructure composition root when no `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:206-208`, inside the `IDistributedLock` factory at `:195-209`; see [`DependencyInjection`](#dependencyinjection)), which covers MMCA.Helpdesk, local single-process runs, and tests. Behavior is pinned by `InProcessDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/InProcessDistributedLockTests.cs:12`).

---

### UseDataSourceAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13` · Level 1 · class (sealed attribute)

- **What it is**: the companion attribute to [`UseDatabaseAttribute`](#usedatabaseattribute). Where that one names the logical database, this one declares the **database engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): `CosmosDB`, `Sqlite`, or SQL Server) an entity type configuration targets. It is Level 1 rather than Level 0 because, unlike the pure-BCL `UseDatabaseAttribute`, it references the first-party `DataSource` enum.

- **Depends on**: the [`DataSource`](group-07-persistence-ef-core.md#datasource) enum (from `MMCA.Common.Application.Interfaces.Infrastructure`, imported at `UseDataSourceAttribute.cs:1`) and `System.Attribute` (BCL).

- **Concept**: engine selection for the multi-engine persistence layer, the sibling of the logical-name routing introduced under [`UseDatabaseAttribute`](#usedatabaseattribute). `[Rubric §8, Data Architecture]` again: the framework supports SQL Server, Cosmos, and SQLite simultaneously, and this attribute is how a configuration announces which engine's rules apply. In practice it is carried on the provider-specific configuration base classes (`EntityTypeConfigurationSQLServer/Cosmos/Sqlite`), so a concrete configuration inherits its engine, while `UseDatabaseAttribute` selects which database on that engine.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDataSourceAttribute.cs:12`), same inheritance and single-use semantics as `UseDatabaseAttribute` so a provider base class propagates the engine to derived configurations.
  - Primary-constructor parameter `dataSource` (`UseDataSourceAttribute.cs:13`) of type [`DataSource`](group-07-persistence-ef-core.md#datasource).
  - `DataSource` get-only property (`UseDataSourceAttribute.cs:16`) exposing the chosen engine. The XML doc (`UseDataSourceAttribute.cs:5-10`) records that it is read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) at model-building time to populate the entity-to-data-source cache that [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork) uses to route each entity to the correct [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).

- **Why it's built this way**: keeping the engine on an attribute (inherited from a provider base class) means an entity's engine and database are both declarative metadata the registry can scan up front, which is what lets routing happen without first building an EF model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: on the per-engine `EntityTypeConfiguration*` base classes and, through inheritance, every concrete configuration under them; read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) / [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry).

---

### RedisDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:24` · Level 2 · class (internal, sealed, partial)

- **What it is**: the cross-replica [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock), implemented as the standard `SET key token NX PX ttl` Redis lock against a single Redis instance.

- **Depends on**: `IConnectionMultiplexer` and the rest of StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`), `ILogger<RedisDistributedLock>`, and an optional [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) (`RedisDistributedLock.cs:24-27`), which is what puts this type at Level 2 rather than Level 1. It returns its nested [`RedisLockHandle`](#redislockhandle).

- **Concept**: the acquire half of the lock taught in two pieces with [`RedisLockHandle`](#redislockhandle). `[Rubric §12, Performance & Scalability]` assesses scale-out correctness: moving the lock into Redis is what makes "only one of these runs at a time" true across replicas instead of true per process, which is the whole reason the abstraction exists (see [`InProcessDistributedLock`](#inprocessdistributedlock) for the degraded alternative). `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses failure behavior: the expiry carried on the `SET` is the crash guard (a holder that dies releases by expiry rather than wedging the key forever, `RedisDistributedLock.cs:12-17`), and the class documents that it is deliberately **single-instance, not Redlock** (`RedisDistributedLock.cs:19-23`), inheriting Redis's failover behavior, which is exactly why the contract is documented as best-effort.

- **Walkthrough**:
  - **State.** `KeyPrefix` is `"lock:"` (`RedisDistributedLock.cs:30`) so lock entries cannot collide with cache entries in a shared instance. `ReleaseScript` (`RedisDistributedLock.cs:36-37`) is the compare-and-delete Lua taught under [`RedisLockHandle`](#redislockhandle). `PollInterval` is 50 ms (`RedisDistributedLock.cs:40`); unlike the in-process poll, each retry here is a network round trip. `_keys` falls back to `CacheKeyNamespace.None` when no namespace was injected (`RedisDistributedLock.cs:42`), so the `Cache:KeyPrefix` option (when configured) qualifies lock keys the same way it qualifies cache keys.
  - **Argument guards.** `TryAcquireAsync` (`RedisDistributedLock.cs:45-82`) applies the same three checks as the in-process implementation: non-blank key, `ttl` greater than zero, non-negative `wait` (`RedisDistributedLock.cs:51-53`).
  - **Key and token.** The physical key is `_keys.Qualify(string.Concat("lock:", key))` (`RedisDistributedLock.cs:55`). The token is a fresh `Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)` minted **per acquisition** (`RedisDistributedLock.cs:59`); the release script matches on it, and that is what makes a release owner-scoped instead of "delete whatever is there now" (`RedisDistributedLock.cs:57-58`).
  - **The acquire loop** (`RedisDistributedLock.cs:64-81`). `StringSetAsync(redisKey, token, ttl, keepTtl: false, When.NotExists, CommandFlags.None)` (`RedisDistributedLock.cs:66-68`) is a single atomic conditional set carrying the expiry, so exactly one replica can win a key. On success it returns a [`RedisLockHandle`](#redislockhandle) closing over the database, key, token, and logger (`RedisDistributedLock.cs:70-73`); once `Stopwatch.GetElapsedTime(startedAt) >= wait` it returns `null` (`RedisDistributedLock.cs:75-78`); otherwise it delays one `PollInterval` and retries (`RedisDistributedLock.cs:80`).

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) (revised 2026-08-01) replaced the process-local guard around the idempotency filter's execute-then-store window with this, because a striped semaphore stops serializing anything once a service runs more than one replica. Choosing the one-instance `SET NX PX` lock over Redlock is a stated trade: simpler, dependent on a single Redis, and paired with a contract that tells callers never to lean on it for an invariant persistence can enforce.

- **Where it's used**: selected by `AddCaching` whenever an `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:198-204`, see [`DependencyInjection`](#dependencyinjection)), passing the same [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) the distributed cache gets (`DependencyInjection.cs:202`). The one in-framework caller is the API [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter); `RedisDistributedLockTests` covers the acquire and release commands against a mocked `IDatabase`.

- **Caveats / not-in-source**: whether a given deployed environment actually supplies the `redis` connection string is an infrastructure/config fact, not a source fact, so "which implementation is live in environment X" is Not determinable from source here; the source only settles that the presence of a registered `IConnectionMultiplexer` decides it.

---

### ScheduledJobRunner
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Scheduling` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:39` · Level 8 · class (sealed, partial, BackgroundService)

- **What it is**: the framework's recurring job scheduler. A `BackgroundService` that runs the host's registered [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) implementations on their cron schedules, using a persistent job store ([`ScheduledJobEntry`](#scheduledjobentry)) and the outbox processor's claim-lease idiom so an occurrence executes exactly once across every replica.

- **Depends on**: `IServiceScopeFactory`, `ILogger<ScheduledJobRunner>`, `IOptions<SchedulerSettings>` ([`SchedulerSettings`](#schedulersettings)), [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), and an optional `TimeProvider` (`ScheduledJobRunner.cs:39-44`). At run time it resolves [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) per cycle (`:214`) and works against [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext); it emits through [`SchedulerMetrics`](#schedulermetrics) and returns its claim results as [`JobClaim`](#jobclaim). Externals: EF Core (`ExecuteUpdateAsync`), `Microsoft.Extensions.Hosting`, and **Cronos**, aliased as `CronSchedule` (`ScheduledJobRunner.cs:12`).

- **Concept introduced, the claim-lease scheduler.** `[Rubric §29, Resilience & Business Continuity]` assesses whether work survives failure: a schedule that lives in a timer dies with the process, so the schedule lives in a table and the loop only reads it. `[Rubric §12, Performance & Scalability]` assesses scale-out: an interval-driven hosted service runs on **every** replica, so scaling a service to three instances silently triples a purge. The fix is the outbox's claim: a single `ExecuteUpdateAsync` that stamps `LockedUntil` and `LockToken` over a `Where` admitting only unleased-or-expired rows, where the count of matched rows IS the race result (`ScheduledJobRunner.cs:427-439`). Two replicas both issue that update and exactly one matches. `[Rubric §13, Observability & Operability]`: every branch that a human would need to explain later has a `[LoggerMessage]` line, including the ones that do nothing (disabled scheduler, duplicate job name, lease lost). `[Rubric §14, Testability]`: the injected `TimeProvider` plus an `internal` `RunCycleAsync` mean a test drives one whole cycle deterministically without waiting on wall-clock timers (`ScheduledJobRunner.cs:204-205`).

- **Walkthrough**:
  - **State and constants.** `_settings` snapshots `IOptions<SchedulerSettings>.Value` once (`ScheduledJobRunner.cs:46`), and `_timeProvider` falls back to `TimeProvider.System` (`:47`). The three outcome strings `Succeeded`, `Failed` and `Skipped` are named constants (`:50`, `:53`, `:59`), `MaxErrorLength` is 2048 and matches the `LastError` column width (`:62`), `StartupDelay` is 15 seconds so the host finishes module registration and migration before the first cycle touches the table (`:69`), and `MinimumWait` is one second, the floor that stops an overdue row hot-looping the runner (`:72`).
  - **`ExecuteAsync` (`:75-127`), the loop.** It returns immediately when `Scheduler:Enabled` is false, after one log line (`:77-83`), so a disabled scheduler is visible in the logs of a host that expected it without costing a line per cycle. Then the startup delay (`:85-92`), then forever: run a cycle, and swallow exceptions in two distinct ways. `OperationCanceledException` during shutdown breaks the loop (`:101-105`); any other exception is logged and the loop waits out the interval (`:106-111`), because one bad cycle (an unreachable database, a model mismatch) must not take the scheduler down for the life of the process.
  - **The smart wait.** `ComputeWaitTime` (`:138-152`) is a pure static function: the polling interval when nothing is registered, otherwise the time until the earliest upcoming occurrence, floored at `MinimumWait` and capped at the configured interval. This is the same "sleep until there is something to do" shape [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) uses, and it is what keeps an idle scheduler from polling on a fixed tick.
  - **`RunCycleAsync` (`:205-228`).** One DI scope per cycle. It resolves the registered jobs (`:208`), returns early when there are none (`:209-212`), takes the context for the `Default` logical source on the configured engine through [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (`:214-216`), reconciles registrations, runs due jobs, and finally reads back the earliest `NextRunOn` across the registered names (`:221-227`) which becomes the next wait.
  - **`ResolveRegisteredJobs` (`:235-250`)** groups `GetServices<IScheduledJob>()` by `Name` (ordinal) and keeps the first of each group, logging a collision rather than throwing (`:243-246`). Two jobs sharing a name would share one schedule row, and the design choice is that one mis-registered module must not stop every other job.
  - **`SyncRegistrationsAsync` (`:259-320`)** reconciles the table against the registered jobs. It reads the stored expressions once (`:267-271`), and for each job compares the resolved expression against the stored one: **unchanged means leave the row alone** (`:279-285`), with the comment naming the bug that would otherwise appear, recomputing `NextRunOn` every cycle would push every schedule forward forever and nothing would ever fire. A changed expression goes through the set-based `UpdateScheduleAsync` (`:326-358`) so a row another replica is currently executing is not disturbed by the change tracker; a new job is inserted (`:299-311`). An unparsable expression parks the row at `DateTime.MaxValue` and records `Skipped` instead of throwing (`:287-308`, and on the update path at `:348-357`).
  - **`ResolveCronExpression` (`:162-166`)** is the configuration override point: `Scheduler:Jobs:{Name}:Cron` when present and non-blank, otherwise the job's compiled-in default. `TryGetNextOccurrence` (`:176-197`) wraps Cronos and catches exactly `CronFormatException` and `ArgumentException` (`:189`), converting a malformed expression into a parked row plus an error message rather than a crashed runner.
  - **`RunDueJobsAsync` (`:365-393`)** claims and runs one row at a time, tracking an `attempted` set so each name is tried at most once per cycle (`:370-382`). A [`JobClaim`](#jobclaim) with a null `LockToken` means another replica won that row, so it is skipped rather than retried (`:384-391`).
  - **`TryClaimNextDueAsync` (`:402-440`)** reads the earliest due, unleased row (`:409-416`), mints a `Guid` token and a lease of `Scheduler:LeaseSeconds` from now (`:423-424`), then issues the conditional claim update described above (`:429-437`).
  - **`ExecuteClaimedJobAsync` (`:454-512`)** records the lag (floored at zero so a clock adjustment cannot publish a negative duration, `:464-467`), invokes the job, records duration and the outcome-tagged counter (`:469-474`), then computes the next occurrence **from the instant execution finished, not from the occurrence that just ran** (`:476-480`). That is the missed-run policy: a host down for a day runs each job once on startup and returns to cadence instead of replaying a backlog. The final stamp is guarded by the claim token (`:489-503`): a replica whose lease expired mid-execution matches nothing, logs `LogLeaseLost` and drops its stale outcome (`:505-509`) rather than overwriting the current holder's record.
  - **`InvokeJobAsync` (`:519-551`)** resolves the job in a **fresh** DI scope (`:523-525`), exactly like a request, so a job body gets scoped services (a unit of work, repositories, handlers) and the long-lived runner never captures a scoped dependency. A missing job returns `Skipped` with a message (`:527-531`); a cancellation during host shutdown is rethrown so the row stays leased and the occurrence is retried when the lease expires rather than being recorded as a failure it never was (`:539-545`); any other exception is logged and recorded as `Failed` (`:546-550`), so the schedule still advances and a permanently failing job cannot hot-loop.
  - **Log levels are a cost decision.** The per-occurrence start and completion lines are `Debug` (`:581-585`) with the reason stated inline (a busy schedule would otherwise double this runner's steady-state log volume, `[Rubric §31, Cost/FinOps]`, `:578-580`), while every failure line stays `Error` or `Warning` (`:557-591`).

- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) records the decision to extend the durable polling loop already in production instead of adopting Hangfire or Quartz.NET, on the grounds that the missing piece was a cron expression, not a product, and that every extracted service host ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)) would otherwise have to reason about a new dependency. Cron parsing is the one thing bought rather than built (Cronos, MIT, zero-dependency).

- **Where it's used**: registered by `AddScheduledJobs` through `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` (`DependencyInjection.cs:314-315`), deliberately not `AddHostedService`, since the latter appends a descriptor per call and two modules calling it would run two runners racing for the same rows (`DependencyInjection.cs:311-313`). The framework's own scheduled job is [`AuditTrailCleanupJob`](group-07-persistence-ef-core.md#audittrailcleanupjob), registered by `AddAuditTrail` (`DependencyInjection.cs:391`). `ScheduledJobRunnerTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/ScheduledJobRunnerTests.cs:22`) drives whole cycles through the internal entry point via a shared `SchedulerTestHarness` (`.../Scheduling/SchedulerTestHarness.cs:28`), and `SchedulerModelGateTests` (`.../Scheduling/SchedulerModelGateTests.cs:26`) pins the model gate.

- **Caveats / not-in-source**: which hosts actually call `AddScheduledJobs` and set `Scheduler:Enabled` lives in the downstream apps, not in this repository, so the set of deployments running a schedule today is Not determinable from source here.

---

### DependencyInjection
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:40` · Level 11 · class (static, extension)

- **What it is**: the single composition root for the entire Infrastructure layer. A static class whose body is one C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:42-739`) adding the layer's fifteen registration methods directly onto `IServiceCollection`: `AddInfrastructure(IConfiguration)` (`:50`), `AddCaching(IConfiguration?)` (`:164`), `AddCommonHybridCache(Action<HybridCacheOptions>?)` (`:248`), `AddScheduledJobs(IConfiguration)` (`:304`), `AddScheduledJob<TJob>()` (`:339`), `AddAuditTrail(IConfiguration)` (`:375`), `AddMultiTenancy(IConfiguration)` (`:424`), `AddServices()` (`:442`), `AddEntityConfigurationAssembly(Assembly)` (`:496`), `AddNotificationInfrastructure()` (`:513`), `AddPushNotifications(IConfiguration)` (`:528`), `AddNativePushNotifications(IConfiguration)` (`:563`), `AddAzureBlobFileStorage(IConfiguration)` (`:595`), `AddBrokerMessaging(IConfiguration, Action?)` (`:647`), and `AddTypedServiceClient<TInterface, TImplementation>(string)` (`:721`).

- **Depends on**: nearly every Infrastructure type below it, wired by interface. Persistence: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory), [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice), [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), [`DefaultEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#defaultentityconfigurationassemblyprovider), [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype), [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory), [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork), [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor). Messaging/outbox: [`IMessageBus`](group-04-events-outbox.md#imessagebus)/[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)/[`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`IEventBus`](group-04-events-outbox.md#ieventbus)/[`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`EfInboxStore`](group-04-events-outbox.md#efinboxstore)/[`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore)/[`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice). Cross-cutting: [`ICacheService`](group-09-caching.md#icacheservice) with [`DistributedCacheService`](group-09-caching.md#distributedcacheservice)/[`MemoryCacheService`](group-09-caching.md#memorycacheservice)/[`HybridCacheService`](group-09-caching.md#hybridcacheservice), [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) with [`RedisDistributedLock`](#redisdistributedlock)/[`InProcessDistributedLock`](#inprocessdistributedlock), [`IJwksProvider`](group-08-auth.md#ijwksprovider)/[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider), [`TokenService`](group-08-auth.md#tokenservice), [`ScheduledJobRunner`](#scheduledjobrunner), [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader)/[`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader), [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). Settings: [`ConnectionStringSettings`](#connectionstringsettings), [`DataSourcesSettings`](#datasourcessettings), [`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](#outboxsettings), [`PersistenceSettings`](#persistencesettings), [`SmtpSettings`](#smtpsettings), [`JwksSettings`](#jwkssettings), [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), [`SchedulerSettings`](#schedulersettings), [`AuditTrailSettings`](#audittrailsettings), [`TenancySettings`](#tenancysettings). Externals: MassTransit v8 (pinned by policy), StackExchange.Redis, `Microsoft.Extensions.Caching.Hybrid`, `Microsoft.AspNetCore.SignalR`, `Microsoft.Azure.NotificationHubs`, `Azure.Storage.Blobs` / `Azure.Identity`, `Microsoft.Extensions.Http.Resilience`.

- **Concept introduced, the mega-composition-root plus the swap-at-the-edge extraction pattern.** `[Rubric §3, Clean Architecture]` assesses whether wiring lives at the edge rather than in the core: every concrete Infrastructure choice is registered here, not in Application or Domain. `[Rubric §10, Cross-Cutting]` and `[Rubric §7, Microservices Readiness]`: the method bodies are the framework's default posture, and each optional capability (broker, scheduler, audit trail, tenancy, hybrid cache, push, native push, blob storage) is a separate opt-in method a host layers on, so the same package runs as a monolith or as an extracted service without recompiling the core. The default everywhere is `TryAdd*`, meaning a host can pre-register its own implementation and the framework will not clobber it; the two places that deliberately break that rule are the broker swap (`Replace`, `:676` and `:682`) and `AddCommonHybridCache` (`RemoveAll`, `:266`), and both say so in a comment. `[Rubric §17, DevOps]`: registering a capability is consistently NOT the same as enabling it, the scheduler and the audit trail both stay inert until their `Enabled` flag is true (`:298-302`, `:356-362`), so a host ships the registration and an environment turns it on.

- **Walkthrough** (in registration order):
  - **`AddInfrastructure` (`:50-157`)** is the entry point. It registers the model-facing singletons and the three EF save interceptors as singletons because they are stateless with per-save state in a `ConditionalWeakTable` keyed by context (`:55-63`), including [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor), which is registered unconditionally so a host can never leave the write-side tenancy guard half-wired (`:60-63`). It then binds the settings sections through the options pipeline with `.ValidateDataAnnotations().ValidateOnStart()`: [`ConnectionStringSettings`](#connectionstringsettings) (`:67-70`), [`SmtpSettings`](#smtpsettings) (`:81-84`), [`PersistenceSettings`](#persistencesettings) (`:123-126`), [`OutboxSettings`](#outboxsettings) (`:128-131`), [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings) (`:133-136`), [`MessageBusSettings`](#messagebussettings) (`:139-142`) and [`JwksSettings`](#jwkssettings) (`:144-147`), each followed where relevant by a singleton adapter that unwraps `IOptions<T>` onto the matching settings interface (`:65`, `:71`, `:85`). It finishes with the outbox signal plus the two hosted outbox services (`:150-152`) and a call to `AddServices()` (`:154`).
  - **The named-data-sources note (`:73-77`)** is load-bearing: [`DataSourcesSettings`](#datasourcessettings) is built directly from `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` rather than through `AddOptions`, because a root-level dictionary section does not bind through the options pipeline. The resolver and the eager entity registry follow immediately (`:78-79`).
  - **The physical-factory warning (`:87-93`)**: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is scoped (one per request) and [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory) is a singleton that must **never** be converted to EF context pooling, because each raw context carries per-source constructor state that pooling would silently reuse across databases.
  - **The Scrutor scan (`:113-117`)** discovers every `IEntityTypeConfigurationBase<,>` in the Infrastructure assembly via `FromAssemblyOf<ClassReference>()` (`:114`) and registers each as its implemented interfaces, scoped to match the DbContext lifetime, closing the loop back to [`ClassReference`](#classreference).
  - **`AddCaching` (`:164-212`)** does two probes in one method. The cache: if an `IDistributedCache` is registered and is not the no-op `MemoryDistributedCache` (`:178`), it builds [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) over it plus any `IConnectionMultiplexer` and the optional `Cache:KeyPrefix` namespace (`:180-184`); otherwise [`MemoryCacheService`](group-09-caching.md#memorycacheservice) (`:188`), where the keyspace is private to the process so no prefix is needed. The lock: [`RedisDistributedLock`](#redisdistributedlock) when a multiplexer resolves (`:198-204`), [`InProcessDistributedLock`](#inprocessdistributedlock) otherwise (`:206-208`). The comment explains why the lock is registered next to the cache at all (`:191-194`): its one in-framework caller, the API idempotency filter, pairs the two, since the lock guards the execute-then-store window the cache entry closes.
  - **`AddCommonHybridCache` (`:248-282`)** is the opt-in two-level cache ([ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)). It configures `HybridCache` with the framework's own TTL policy expressed in HybridCache's option type (`:250-262`), then deliberately does `RemoveAll<ICacheService>()` before `AddSingleton` (`:264-279`) so the call wins whether it runs before or after `AddInfrastructure`. The remarks are honest about the cost of that choice (`:236-241`): `RemoveAll` does not distinguish the framework's registration from a host's own custom `ICacheService`, so calling this is a statement that the two-level cache IS the cache.
  - **`AddScheduledJobs` (`:304-318`) and `AddScheduledJob<TJob>` (`:339-345`)** wire the recurring-job feature ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)). The first binds [`SchedulerSettings`](#schedulersettings) with validation (`:306-309`) and registers [`ScheduledJobRunner`](#scheduledjobrunner) via `TryAddEnumerable` rather than `AddHostedService` (`:311-315`), so a host or two modules calling it twice cannot run two runners racing for the same rows. The second registers one job scoped, both as the concrete type and into the accumulating `IEnumerable<IScheduledJob>` (`:342-343`); the doc spells out that the job is scoped because the runner resolves it in a fresh scope per execution and it must hold no state between runs (`:332-337`).
  - **`AddAuditTrail` (`:375-394`)** binds [`AuditTrailSettings`](#audittrailsettings) (`:377-380`), registers the trail interceptor as a singleton for the same statelessness reason as the other three (`:382-384`), the scoped reader (`:386`), and, notably, `AddScheduledJob<AuditTrailCleanupJob>()` (`:391`). Registering the retention job here rather than in `AddScheduledJobs` keeps the two features independent, and the remarks state the operational consequence plainly (`:363-369`): without the scheduler the trail still records every change and nothing is ever purged, so `AuditTrail:RetentionDays` is inert.
  - **`AddMultiTenancy` (`:424-436`)** binds [`TenancySettings`](#tenancysettings) and adds its validator through `TryAddEnumerable` so two modules calling it do not run the same validation twice (`:431-433`). What it switches on is *resolution*, not isolation: the filter, the interceptor and `ITenantContext` are always present and inert until a tenant resolves (`:402-414`), and a `Tenancy:Tenants:{id}:DataSources:{sourceName}` override naming a source that does not exist fails startup rather than silently falling back to the shared database (`:415-422`).
  - **`AddServices` (`:442-487`)** registers the small services and encodes a subtle lifetime lesson: [`TokenService`](group-08-auth.md#tokenservice) is a **singleton** (`:461`) with a six-line comment explaining why (`:455-460`): a scoped lifetime disposed the RSA handle at end-of-request while IdentityModel's static `CryptoProviderCache` still held the cached signature provider wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. `[Rubric §11, Security]` (correct signing-key lifecycle). It also sets the default [`IMessageBus`](group-04-events-outbox.md#imessagebus) to [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) (`:469`) and the default [`IEventBus`](group-04-events-outbox.md#ieventbus) to [`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus) (`:463`), registers `ITenantContext` unconditionally with the reasoning inline (`:448-452`), and wires the inert no-op defaults for push (`:473-474`), native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), `:476-479`) and file storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), `:481-483`) so hosts can call the opt-in methods unconditionally.
  - **The opt-in channels.** `AddPushNotifications` (`:528-551`) binds and adapts the settings (`:530-535`), adds SignalR, adds the Redis backplane only when a `redis` connection string exists (`:539-543`), and replaces the null senders (`:546-547`). `AddNativePushNotifications` (`:563-583`) and `AddAzureBlobFileStorage` (`:595-623`) both re-read their section eagerly with `.Get<T>()` (`:568`, `:600`) because the decision whether to register at all has to be made at composition time, and both return early on an incomplete section (`:569-574`, `:601-611`), which is what makes an unconfigured environment a no-op instead of a startup crash. The absolute-URI check at `:606-607` is worth copying: an empty-string `ServiceUri` binds to a *relative* `Uri`, so only `{ IsAbsoluteUri: true }` counts.
  - **`AddBrokerMessaging` (`:647-701`)** is the extraction pivot. It reads [`MessageBusSettings`](#messagebussettings)`.Provider`, falling back to `new MessageBusSettings()` when the section is absent (`:653-654`); on `InProcess` it returns immediately (`:656-659`), leaving the in-process bus in place; otherwise it calls `AddMassTransit` (`:663-672`) and then **`Replace`s** the scoped [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`:676`) and [`IEventBus`](group-04-events-outbox.md#ieventbus) with `BrokerEventBus` (`:682`), the deliberate exception to the `TryAdd` rule, because the in-process bus must not run alongside the broker. It also chooses the consumer-side inbox store from `settings.EnableInbox`: [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) when on (`:686-689`), and when off the [`NoOpInboxStore`](group-04-events-outbox.md#noopinboxstore) **plus** an [`InboxDisabledWarningService`](group-04-events-outbox.md#inboxdisabledwarningservice) hosted service (`:690-698`). That second registration is the whole point of the branch: a disabled dedup store looks exactly like an enabled one until a duplicate side effect reaches a customer, so the posture costs one startup Warning to make visible (`:694-696`).
  - **Transport wiring (`:741-876`)** is factored into three private static helpers outside the extension block: `ResolveBrokerConnectionString` (`:755-764`), `ConfigureBrokerTransport` (`:794-863`) and `BuildRedeliveryIntervals` (`:873-876`). The first two carry a justified `IDE0051` suppression (`:751-754`, `:790-793`) documenting a Roslyn false positive where SDK 10.0.201+ cannot see references crossing the extension-block boundary; the extraction itself exists to keep `AddBrokerMessaging`'s cyclomatic complexity below the analyzer threshold (`:771-772`). Connection-string precedence is explicit (`:741-750`): `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq` (what Aspire injects), then `ConnectionStrings:messaging`; without that fallback MassTransit would default to `localhost:5672` and never reach the Aspire-allocated container port.
  - **Two levels of retry, and one asymmetry between transports.** `[Rubric §29, Resilience & Business Continuity]`: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy driven by [`MessageBusSettings`](#messagebussettings) (`:822-827` for RabbitMQ, `:849-854` for Azure Service Bus). Above it sits second-level `UseDelayedRedelivery`, which reschedules a message through the broker over `RedeliveryIntervalsSeconds` (one minute, ten minutes, one hour by default) so an outage measured in hours does not dead-letter the event; it is registered *before* `UseMessageRetry` so the retry filter stays innermost and every immediate attempt is exhausted first (`:775-780`). The asymmetry is deliberate and documented (`:781-788`): Azure Service Bus schedules messages natively, so redelivery is applied **unconditionally** there (`:839-847`), while RabbitMQ needs the `rabbitmq_delayed_message_exchange` plugin that the Aspire development container does not ship, so it is gated behind `EnableDelayedRedelivery`, default false (`:809-820`). `BuildRedeliveryIntervals` drops non-positive entries and the caller skips the filter entirely on an empty array (`:865-876`), because a zero interval would schedule an immediate redelivery and turn the second level into a hot loop.
  - **`AddTypedServiceClient` (`:721-738`)** wires a typed `HttpClient` to Aspire service discovery (`http://{serviceName}`, `:731-732`), attaches [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) (`:728`, `:733`) so the inbound bearer token flows downstream, and adds the standard Polly resilience handler (`:736`); the `S5332` suppression at `:730` documents the deliberate cleartext in-cluster address, and the doc notes gRPC is preferred for service-to-service contracts (`:710-715`).

- **Why it's built this way**: the `extension(IServiceCollection)` syntax keeps every Infrastructure registration in one file without a proliferation of static helper classes, and pushing all concrete choices into one composition root at the layer edge is what keeps Application and Domain free of framework references ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the database-per-service wiring, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the broker/extraction path). See the DI-sequence note in `MMCA.Common/CLAUDE.md`: hosts call `AddApplicationDecorators()` last so Scrutor can decorate handlers already registered, but the relative position of `AddInfrastructure` is not otherwise ordering-sensitive, and `AddCommonHybridCache` is explicitly documented as order-independent in both directions (`:228-235`).

- **Where it's used**: called from each service host's `Program.cs` (the reference apps and the extracted `MMCA.ADC.*` service hosts) after `AddApplication()`; the optional methods (`AddScheduledJobs`, `AddAuditTrail`, `AddMultiTenancy`, `AddCommonHybridCache`, `AddBrokerMessaging`, `AddPushNotifications`, `AddNativePushNotifications`, `AddAzureBlobFileStorage`) are added by the specific hosts that need those capabilities. `AddScheduledJobsTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:16`) pins the double-registration behavior of the scheduler pair.

- **Caveats / not-in-source**: the exact set of consuming `Program.cs` files is in the downstream apps (MMCA.ADC / MMCA.Store / MMCA.Helpdesk), not in this repository, so the precise call sites are Not determinable from source here.

### DataSourceEntrySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourceEntrySettings.cs:19` · Level 0 · class (sealed)

- **What it is**: the shape of ONE named entry under the `DataSources` configuration section, the per-logical-source counterpart to the top-level `ConnectionStrings` block. It carries a connection string per engine plus two per-source overrides (Cosmos database name, SQL Server migrations assembly).

- **Depends on**: nothing first-party and nothing beyond `string` from the BCL, which is why it sits at Level 0. It is aggregated by [DataSourcesSettings](#datasourcessettings) and read by [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver).

- **Concept introduced, configuration as the physical-topology dial.** `[Rubric §8, Data Architecture]` assesses how the logical model maps onto physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database. The declarative half of that story is [UseDatabaseAttribute](#usedatabaseattribute), which names a *logical* source on an entity configuration. This class is the other half: it says what that logical name physically means in a given deployment. Nothing in the code decides the topology; the same compiled assemblies run as a one-database monolith or as N separate databases depending on how many entries exist here. `[Rubric §16, Maintainability]`: because every property defaults to `string.Empty` (`DataSourceEntrySettings.cs:22-37`), a partially filled entry is legal and each empty value simply falls back to the top-level `ConnectionStrings` value, so a host adds a database by adding one JSON object and nothing else.

- **Walkthrough**: five `{ get; init; }` properties, all defaulting to `string.Empty`.
  - `CosmosConnectionString` (`DataSourceEntrySettings.cs:22`) and `CosmosDatabaseName` (`DataSourceEntrySettings.cs:25`), the Cosmos pair; the database name falls back to the top-level `CosmosDatabaseName` when empty ([DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) applies that fallback at `DataSourceResolver.cs:114-116` and again at `:196-198`).
  - `SqliteConnectionString` (`DataSourceEntrySettings.cs:28`), the SQLite path ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) polyglot persistence).
  - `SQLServerConnectionString` (`DataSourceEntrySettings.cs:31`), the production engine's connection string.
  - `SQLServerMigrationsAssembly` (`DataSourceEntrySettings.cs:37`), the EF Core migrations assembly for THIS source. Leaving it empty is not free: the resolver falls back to the top-level value (`DataSourceResolver.cs:189-191`) and logs a warning saying that applying another database's migrations to a separate database is almost always a mistake (`DataSourceResolver.cs:278`).
  - The XML doc carries a worked `appsettings.json` example for a `Conference` source (`DataSourceEntrySettings.cs:9-18`), which is the fastest way to see the intended shape.

- **Why it's built this way**: `init`-only properties make a bound entry immutable after startup, and the "empty means inherit" rule is what keeps the single-database default intact: an app that configures no `DataSources` section behaves exactly as it did before the section existed ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: bound as the value type of the dictionary that [DependencyInjection](#dependencyinjection) reads with `configuration.GetSection(DataSourcesSettings.SectionName).Get<Dictionary<string, DataSourceEntrySettings>>()` (`DependencyInjection.cs:75-77`); consumed by [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) when it classifies logical names into physical sources (`DataSourceResolver.cs:97-104`).

---

### FileStorageSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/FileStorageSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the `FileStorage` configuration section for Azure Blob Storage: an endpoint (production, managed identity) or a connection string (local Azurite), plus the container every blob lives in.

- **Depends on**: `System.Uri` (BCL) only. Its consumers are the Azure SDK types (`BlobServiceClient`, `DefaultAzureCredential`) wired in [DependencyInjection](#dependencyinjection).

- **Concept introduced, the incomplete-section no-op.** `[Rubric §11, Security]` assesses how credentials are handled: the production path sets `ServiceUri` and authenticates with `DefaultAzureCredential`, so no storage key exists to leak, while `ConnectionString` is documented as the local-development alternative (`FileStorageSettings.cs:15-19`). `[Rubric §33, Developer Experience]`: `AddAzureBlobFileStorage` is written so that an incomplete section is a no-op rather than a startup crash, which lets a host call it unconditionally and lets an environment opt in with configuration alone. `[Rubric §15, Best Practices]`: note the deliberate absolute-URI check at `DependencyInjection.cs:606-607`, an empty-string `ServiceUri` binds to a *relative* `Uri`, so a truthiness test would have accepted a useless value; only `{ IsAbsoluteUri: true }` counts, and the comment in the code says exactly that.

- **Walkthrough**:
  - `SectionName = "FileStorage"` (`FileStorageSettings.cs:13`), the same static section-name convention every settings class in this namespace follows.
  - `ServiceUri` (`FileStorageSettings.cs:16`), nullable `Uri`, the blob service endpoint.
  - `ConnectionString` (`FileStorageSettings.cs:19`), nullable, the Azurite alternative.
  - `ContainerName` (`FileStorageSettings.cs:22`), documented as required; the registration bails out when it is blank (`DependencyInjection.cs:601-604`) and again when neither an absolute `ServiceUri` nor a connection string is present (`DependencyInjection.cs:608-611`).

- **Walkthrough of its one consumer**: `AddAzureBlobFileStorage` binds the options (`DependencyInjection.cs:597-598`), re-reads the section eagerly with `.Get<FileStorageSettings>()` (`DependencyInjection.cs:600`) because the decision to register at all has to be made at composition time, then registers a singleton `BlobContainerClient` built from either the URI plus `DefaultAzureCredential` or the connection string (`DependencyInjection.cs:613-619`) and swaps [IFileStorageService](group-07-persistence-ef-core.md#ifilestorageservice) to [AzureBlobFileStorageService](group-07-persistence-ef-core.md#azureblobfilestorageservice) (`DependencyInjection.cs:620`).

- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) introduced managed file storage; shipping the pipeline inert and switching it on by configuration means an environment can be provisioned before its storage account exists, and the [NullFileStorageService](group-07-persistence-ef-core.md#nullfilestorageservice) default keeps the container resolvable in the meantime.

- **Caveats**: unlike most sections here this one is bound WITHOUT `.ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:597-598`), deliberately, since "incomplete" is a supported state rather than a misconfiguration. That is the one sanctioned departure from the fail-fast binding contract ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).

---

### IConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IConnectionStringSettings.cs:6` · Level 0 · interface

- **What it is**: the abstraction over the top-level `ConnectionStrings` section: one connection string per supported engine, the Cosmos database name, and the SQL Server migrations assembly. It describes the `Default` physical data source, the one every unmapped logical name collapses onto.

- **Depends on**: nothing. Implemented by [ConnectionStringSettings](#connectionstringsettings).

- **Concept introduced, settings interfaces alongside the options pattern.** ASP.NET Core's own idiom is to inject `IOptions<T>` of a concrete class. This codebase adds a thin interface per settings group and registers a singleton adapter that unwraps the options for it (`DependencyInjection.cs:71`). `[Rubric §1, SOLID]` (DIP + ISP): a consumer that needs connection strings depends on a five-member contract it can hand-implement in a test, not on `IOptions<ConnectionStringSettings>` plus a live configuration tree. `[Rubric §14, Testability]`: this is what lets [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) take `IConnectionStringSettings` directly in its constructor (`DataSourceResolver.cs:34`) and be unit tested with a stub. `[Rubric §3, Clean Architecture]`: the interface still lives in Infrastructure, not Application, because connection strings are an infrastructure concern; nothing above this layer ever sees it. [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) records the general rule: expose a settings type through a read-only interface when it must be read outside the binding layer, so the options pipeline does not leak.

- **Walkthrough**: five `{ get; init; }` members, all `string`: `CosmosConnectionString` (`IConnectionStringSettings.cs:9`), `CosmosDatabaseName` (`:12`), `SqliteConnectionString` (`:15`, documented as typically a file path), `SQLServerConnectionString` (`:18`), and `SQLServerMigrationsAssembly` (`:24`, documented to fall back to the DbContext assembly when empty). Note `init` accessors on an *interface*: any implementation must be settable at construction and frozen afterwards, which is exactly what configuration binding does.

- **Why it's built this way**: one interface per section keeps consumers narrow, and the `init`-only shape encodes the fact that settings are startup state, not mutable state ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) depends on these values being stable for the process lifetime, since the resolver classifies sources once).

- **Where it's used**: [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) is the primary consumer (`DataSourceResolver.cs:34`, `:77`, `:97`, `:143`, `:174`, `:262`); the DI adapter is registered at `DependencyInjection.cs:71`.

---

### IPushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IPushNotificationSettings.cs:6` · Level 0 · interface

- **What it is**: the two-member contract for the `PushNotifications` section: whether the SignalR push pipeline is on, and the hub's endpoint path.

- **Depends on**: nothing. Implemented by [PushNotificationSettings](#pushnotificationsettings).

- **Concept**: the same settings-interface-over-options pattern taught under [IConnectionStringSettings](#iconnectionstringsettings). What is worth noticing here is what the interface deliberately does NOT carry: the concrete class adds a `ChannelKeyPattern` member that [NotificationHub](group-10-notifications.md#notificationhub) reads through `IOptions<PushNotificationSettings>` (`NotificationHub.cs:64`), not through this interface. `[Rubric §9, API & Contract Design]` assesses whether published contracts evolve compatibly; adding a member to a shipped public interface is a source-breaking change for every downstream implementer, so a new knob lands on the concrete class and its consumer takes the concrete options type instead.

- **Walkthrough**: `Enabled` (`IPushNotificationSettings.cs:9`) and `HubPath` (`:12`), both `{ get; init; }`.

- **Where it's used**: registered as a singleton adapter over the bound options inside `AddPushNotifications` (`DependencyInjection.cs:534-535`); the SignalR senders ([SignalRPushNotificationSender](group-10-notifications.md#signalrpushnotificationsender), [SignalRLiveChannelPublisher](group-10-notifications.md#signalrlivechannelpublisher)) are registered in the same call (`DependencyInjection.cs:546-547`).

---

### ISmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ISmtpSettings.cs:6` · Level 0 · interface

- **What it is**: the contract for the `Smtp` section: host, port, credentials, TLS toggle, and the default sender/recipient addresses.

- **Depends on**: nothing. Implemented by [SmtpSettings](#smtpsettings).

- **Concept**: another instance of the settings-interface pattern from [IConnectionStringSettings](#iconnectionstringsettings). `[Rubric §14, Testability]` is the payoff: [SmtpEmailSender](group-10-notifications.md#smtpemailsender) takes `ISmtpSettings` in its primary constructor (`SmtpEmailSender.cs:12`) and copies each value into a readonly field at construction (`SmtpEmailSender.cs:14-20`), so a test hands it a plain object with no configuration system in play. `[Rubric §11, Security]`: `Password` is a plain `string` on the contract (`ISmtpSettings.cs:18`), so it is only ever as safe as the configuration provider that supplies it (user-secrets or Key Vault, not a committed `appsettings.json`).

- **Walkthrough**: `Host` (`ISmtpSettings.cs:9`), `Port` documented as 1-65535 (`:12`), `Username` (`:15`), `Password` (`:18`), `EnableSsl` (`:21`), `From` (`:24`), and `To`, documented as the default recipient used by the no-argument `SendAsync` overload (`:27`).

- **Where it's used**: [SmtpEmailSender](group-10-notifications.md#smtpemailsender), the [IEmailSender](group-10-notifications.md#iemailsender) implementation; the DI adapter is registered at `DependencyInjection.cs:85`.

---

### JwksSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwksSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: the `Jwks` section that controls whether an Identity service publishes a JSON Web Key Set at `/.well-known/jwks.json`, and where its RSA public key comes from.

- **Depends on**: `System.ComponentModel.DataAnnotations` (`[StringLength]`) only. Consumed by [RsaJwksProvider](group-08-auth.md#rsajwksprovider) through `IOptions<JwksSettings>`.

- **Concept introduced, key distribution as configuration.** `[Rubric §11, Security]` assesses how trust is established between services. In the monolith, issuer and validator share one process and one symmetric secret. Once a module is extracted, the validator must obtain the issuer's *public* key without sharing anything secret, which is what a JWKS document is for ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §7, Microservices Readiness]`: the framework ships the endpoint always and the key set empty, so nothing about a monolith deployment changes until a host flips `Enabled`. The `kid` contract is the subtle part: `KeyId` is published as the JWK `kid` and MUST match the `kid` header on tokens the issuer signs (`JwksSettings.cs:13-14`), otherwise a validator holding a correct key set still cannot pick the right key.

- **Walkthrough**:
  - `SectionName = "Jwks"` (`JwksSettings.cs:20`).
  - `Enabled` (`JwksSettings.cs:26`), defaulting to `false` with the rationale spelled out inline: existing HMAC-only deployments must not start advertising an RSA key set by accident.
  - `KeyId` (`JwksSettings.cs:34`), `[StringLength(64)]` (`:33`), defaulting to `"default"`.
  - `RsaPublicKeyPem` (`JwksSettings.cs:41`) and `RsaPublicKeyPath` (`:47`), documented as mutually exclusive; the path form exists for keys mounted as a secret rather than inlined in configuration.
  - The consuming logic, worth reading alongside: `RsaJwksProvider.BuildKeySet` returns an EMPTY `JsonWebKeySet` when `Enabled` is false (`RsaJwksProvider.cs:30-32`) and again when neither PEM source resolves (`:35-38`); otherwise it imports the PEM, stamps `KeyId` onto the `RsaSecurityKey` (`RsaJwksProvider.cs:44-47`) and tags the JWK `use=sig`, `alg=RS256` (`:50-51`). `ResolvePem` prefers the inline value over the file (`RsaJwksProvider.cs:58-70`), and the key set itself is built once behind a `Lazy<JsonWebKeySet>` (`RsaJwksProvider.cs:22`).

- **Why it's built this way**: default-off plus an empty key set means the endpoint is safe to map unconditionally (`WebApplicationExtensions.cs:116-118` documents that Identity services are the ones that flip it on), and two key sources cover both "inline it in configuration" and "mount it as a secret" without a second code path in the provider.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` at `DependencyInjection.cs:144-147`, immediately followed by the [IJwksProvider](group-08-auth.md#ijwksprovider) registration (`DependencyInjection.cs:148`).

---

### JwtSigningAlgorithm

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSigningAlgorithm.cs:18` · Level 0 · enum

- **What it is**: a two-value enum selecting how access tokens are signed and validated: symmetric HMAC or asymmetric RSA.

- **Depends on**: nothing. Referenced by [IJwtSettings](#ijwtsettings), [JwtSettings](#jwtsettings), [TokenService](group-08-auth.md#tokenservice), and the API-layer authentication wiring.

- **Concept introduced, the monolith-to-microservice auth switch.** `[Rubric §11, Security]` assesses key management: HS256 requires every validator to hold the *signing* key, which is acceptable only while issuer and validators share a process. RS256 splits the pair, the issuer holds the private key and validators fetch the public key, which is the precondition for extracting a service ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). `[Rubric §7, Microservices Readiness]`: making this a configuration value rather than a compile-time choice is what lets the same binaries run both topologies. The type's own XML doc states the operational consequence plainly: switching HS256 to RS256 invalidates all existing tokens, a hard cutover (`JwtSigningAlgorithm.cs:14-15`).

- **Walkthrough**: `HS256 = 0` (`JwtSigningAlgorithm.cs:21`), explicitly the default so that an unset configuration value binds to the backwards-compatible option; `RS256 = 1` (`:24`). The explicit ordinals matter because a bound enum from configuration falls back to `0`.

- **Where it's used**: [TokenService](group-08-auth.md#tokenservice) branches on it in its constructor to build credentials (`TokenService.cs:53-61`, with the HMAC and RSA builders at `:166` and `:180-181`); the API layer branches on it when configuring JWT bearer validation (`WebApplicationBuilderExtensions.cs:436`), where selecting RS256 without an `RsaPublicKeyPem` throws a message pointing at `AddForwardedJwtBearer` instead (`WebApplicationBuilderExtensions.cs:438-441`).

---

### MessageBusProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:68` · Level 0 · enum

- **What it is**: the transport selector for the cross-service message bus. It lives in the same file as [MessageBusSettings](#messagebussettings), immediately below it.

- **Depends on**: nothing.

- **Concept**: the transport-choice-at-the-edge invariant. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` both hinge on application code never naming a broker: handlers publish through [IMessageBus](group-04-events-outbox.md#imessagebus), and only this enum plus the registration that reads it decide whether that lands in-process or on a wire. The three values are also a deployment ladder: monolith, dev microservices, production microservices.

- **Walkthrough**: `InProcess = 0` (`MessageBusSettings.cs:73`), the modular-monolith default served by [InProcessMessageBus](group-04-events-outbox.md#inprocessmessagebus); `RabbitMq = 1` (`:78`), MassTransit on RabbitMQ for development and tests; `AzureServiceBus = 2` (`:83`), MassTransit on Azure Service Bus for production. `AddBrokerMessaging` returns without touching the container when the value is `InProcess` (`DependencyInjection.cs:656-658`), and the transport configuration switches on it to pick `UsingRabbitMq` (`DependencyInjection.cs:784-787`) or `UsingAzureServiceBus` (`:803-804`).

- **Why it's built this way**: a zero-valued `InProcess` means an absent `MessageBus` section binds to the monolith behavior, so adding the section is opt-in rather than mandatory ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html)).

- **Where it's used**: [MessageBusSettings.Provider](#messagebussettings) (`MessageBusSettings.cs:17`), and the two `AddBrokerMessaging` branches cited above.

---

### NativePushSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/NativePushSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the `NativePush` section for OS-level push delivery through Azure Notification Hubs: an on/off flag, the hub connection string, and the hub name.

- **Depends on**: nothing first-party; its values feed `Microsoft.Azure.NotificationHubs.NotificationHubClient`.

- **Concept**: the same ship-inert, enable-by-configuration shape taught under [FileStorageSettings](#filestoragesettings), with a concrete operational reason attached. `[Rubric §17, DevOps]` assesses whether deployment and enablement can be sequenced independently: the XML doc records that a hub is provisioned with `Enabled` false until the FCM v1 service account and APNs auth key are uploaded to it (`NativePushSettings.cs:4-7`), so infrastructure lands before credentials do and neither step blocks a release. `[Rubric §29, Resilience]`: the disabled path leaves [NullNativePushSender](group-07-persistence-ef-core.md#nullnativepushsender) in place rather than failing startup, so a missing credential degrades the channel instead of the host.

- **Walkthrough**: `SectionName = "NativePush"` (`NativePushSettings.cs:12`); `Enabled` (`:15`); nullable `ConnectionString`, documented as a Listen+Send+Manage rule (`:18`); nullable `HubName` (`:21`). `AddNativePushNotifications` binds the options (`DependencyInjection.cs:565-566`), then re-reads the section eagerly and returns early unless all three are present (`DependencyInjection.cs:568-574`); only then does it register the hub client (`:576-578`) and swap [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) and [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) to their Azure implementations (`DependencyInjection.cs:579-580`).

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) chose a configuration-gated channel precisely so hosts can register it unconditionally.

- **Where it's used**: `AddNativePushNotifications` (`DependencyInjection.cs:563-583`) and, through it, [AzureNotificationHubNativePushSender](group-07-persistence-ef-core.md#azurenotificationhubnativepushsender).

---

### PersistenceSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the `Persistence` section, currently a single knob: the SQL command timeout applied to every command the SQL Server context issues.

- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Range]`) only.

- **Concept introduced, the defaults-preserve-history rule for new settings sections.** `[Rubric §16, Maintainability]` assesses whether change is additive; the class doc states the policy directly: every property defaults to the value the framework applied implicitly before the section existed, so the section is optional in `appsettings.json` (`PersistenceSettings.cs:6-8`). `[Rubric §12, Performance & Scalability]`: the 30-second default is the previous implicit ADO.NET behavior, and the doc names the case for raising it (reporting-style workloads whose queries legitimately run longer than half a minute, `PersistenceSettings.cs:16-19`). Making that value configurable rather than constant is the difference between "tune it in an environment" and "cut a release".

- **Walkthrough**: `SectionName = "Persistence"` (`PersistenceSettings.cs:13`); `CommandTimeoutSeconds` with `[Range(1, 600)]` (`:21`) defaulting to `30` (`:22`). The consuming side is defensive in a way worth copying: [SQLServerDbContext](group-07-persistence-ef-core.md#sqlserverdbcontext) resolves the options with `GetService<IOptions<PersistenceSettings>>()?.Value ?? new PersistenceSettings()` (`SQLServerDbContext.cs:36-37`), so a context built outside the full DI graph (a design-time factory, a test) still gets the documented default rather than a null reference, and applies it via `sql.CommandTimeout(...)` (`SQLServerDbContext.cs:56`).

- **Why it's built this way**: a `[Range]`-validated option bound with `ValidateOnStart` turns a typo into a startup failure rather than a per-query surprise ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).

- **Where it's used**: bound at `DependencyInjection.cs:123-126`; read by [SQLServerDbContext](group-07-persistence-ef-core.md#sqlserverdbcontext).

---

### ScheduledJobOverrideSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:66` · Level 0 · class (sealed)

- **What it is**: one entry under `Scheduler:Jobs:{Name}`, the per-job override that lets a deployment retime a recurring job without touching code. Today it carries exactly one member, the cron expression.

- **Depends on**: nothing. It is the value type of [SchedulerSettings](#schedulersettings)`.Jobs` (`SchedulerSettings.cs:60`) and is read by [ScheduledJobRunner](#scheduledjobrunner).

- **Concept introduced, code default plus configuration override.** An [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob) ships with a `CronExpression` compiled into it, which is the right default because the job's author knows what cadence the work needs. An operator who has to change that cadence for one environment should not need a release. `[Rubric §17, DevOps]` assesses whether operational behavior can be changed without a code change; this pair is the minimal answer: an absent entry leaves the compiled-in schedule in force, and a present, non-blank `Cron` replaces it (`SchedulerSettings.cs:55-59`, `:68-73`). `[Rubric §16, Maintainability]`: the override is keyed by `IScheduledJob.Name`, the job's own stable identity, so configuration and code agree on one name rather than on a class name that refactoring would break.

- **Walkthrough**: a single `string? Cron { get; init; }` (`SchedulerSettings.cs:74`). The whole mechanism lives in the reader, not in this type: `ScheduledJobRunner.ResolveCronExpression` looks the job up by name and takes the override only when it is present AND non-blank, otherwise the job's own expression (`ScheduledJobRunner.cs:162-166`). Blank-means-absent matters, because a JSON key set to `""` is a common way to try to "clear" a value and would otherwise produce an unparseable schedule.

- **Why it's built this way**: the runner treats a changed expression as a schedule rewrite. On each cycle it compares the resolved expression against the one stored on the [ScheduledJobEntry](#scheduledjobentry) row (`ScheduledJobRunner.cs:273-280`), leaves the row untouched when they match (recomputing every cycle would push the next occurrence forward forever and nothing would ever fire, `:282-284`), and otherwise recomputes the next occurrence from the current instant and updates the row (`:287-297`). So an operator edit is picked up on the next cycle, with no restart, which is what makes the override useful in the first place ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

- **Where it's used**: [ScheduledJobRunner](#scheduledjobrunner) only, through `SchedulerSettings.Jobs`.

- **Caveats**: an override that does not parse is not rejected at startup, unlike the range-checked scalar settings in this namespace. The runner logs the parse failure and records the job as skipped (`ScheduledJobRunner.cs:287-290`, `:301-306`), so a bad cron string is an observable non-run rather than a failed boot.

---

### TenantDataSourceOverrideSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:138` · Level 0 · class (sealed)

- **What it is**: one tenant's connection override for one physical data source, bound from `Tenancy:Tenants:{tenantId}:DataSources:{sourceName}`. It is the entire configuration surface of database-per-tenant.

- **Depends on**: nothing. It is the value type of [TenantEntrySettings](#tenantentrysettings)`.DataSources` (`TenancySettings.cs:129`), validated by [TenancySettingsValidator](#tenancysettingsvalidator) and consumed by [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory).

- **Concept introduced, two isolation models behind one switch.** `[Rubric §8, Data Architecture]` assesses how tenant data is partitioned. Shared-schema isolation (a `TenantId` column plus a global query filter and [TenantSaveChangesInterceptor](group-07-persistence-ef-core.md#tenantsavechangesinterceptor)) needs no entry here at all: the type's sibling doc says declaring a tenant is only required for the database-per-tenant case (`TenancySettings.cs:109-114`). Adding an entry upgrades exactly one source for exactly one tenant to its own database, and every other source stays shared. `[Rubric §11, Security]`: the strongest isolation available (a separate database) becomes a configuration decision per tenant per source rather than an architectural fork, which is what [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) set out to make possible.

  The deliberate omission teaches as much as the members: there is no migrations-assembly override, because a tenant database has the same schema as the shared one (`TenancySettings.cs:132-137`). One schema, N connection strings.

- **Walkthrough**: four nullable `{ get; init; }` strings, one per engine plus the Cosmos database name.
  - `SQLServerConnectionString` (`TenancySettings.cs:141`), `SqliteConnectionString` (`:144`), `CosmosConnectionString` (`:147`).
  - `CosmosDatabaseName` (`:153`), optional: when omitted the shared source's database name is kept, which is how one Cosmos account can serve per-tenant accounts.
  - The read path is a record `with` clone, and it is the interesting part. `DbContextFactory.ResolveTenantOverride` bails out unless there is a resolved tenant, bound tenancy settings, an entry for that tenant, and an entry for that source name (`DbContextFactory.cs:150-156`), picks the connection string for the source's engine through `TenancySettingsValidator.ConnectionStringFor` (`DbContextFactory.cs:158`, resolver at `TenancySettingsValidator.cs:122-129`), and returns null when the tenant overrides this source on a different engine only (`DbContextFactory.cs:159-163`). Otherwise it clones the shared [PhysicalDataSource](group-07-persistence-ef-core.md#physicaldatasource) with the new connection string and, if supplied, the new Cosmos database name (`DbContextFactory.cs:165-172`).
  - The clone keeps the ORIGINAL `DataSourceKey`, and the comment above it explains why (`DbContextFactory.cs:142-147`): EF's model cache is keyed on that key, so replacing only the connection string is what lets one compiled model serve every tenant's database.

- **Why it's built this way**: `[Rubric §12, Performance & Scalability]` is the reason for the key-preserving clone. A per-tenant `DataSourceKey` would build and cache a separate EF model per tenant, which multiplies startup cost and memory by the tenant count for no schema difference.

- **Where it's used**: [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory) at context-creation time, and [TenancySettingsValidator](#tenancysettingsvalidator) at startup, which rejects an entry that declares no connection string at all (`TenancySettingsValidator.cs:76-86`) and an entry whose key is not a real physical source name (`:93-104`). The second check exists because the alternative is a silent fall back to the shared database, which is precisely the failure database-per-tenant is bought to prevent.

- **Caveats**: an override is keyed by **physical** source name (the name [IDataSourceResolver](group-07-persistence-ef-core.md#idatasourceresolver) produces), not the logical name a module uses. That distinction is invisible in a single-database host, where everything collapses onto `Default`.

---

### TenantResolutionStrategy

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:6` · Level 0 · enum

- **What it is**: how the request pipeline looks for the tenant on an inbound request: from a signed claim, from a request header, or (declared but not implemented) from the host name.

- **Depends on**: nothing. Ordered into a list by [TenancySettings](#tenancysettings)`.ResolutionOrder` (`TenancySettings.cs:73`), checked by [TenancySettingsValidator](#tenancysettingsvalidator), and switched on by [TenantResolutionMiddleware](group-12-api-hosting-mapping.md#tenantresolutionmiddleware).

- **Concept introduced, trusted versus asserted identity of a tenant.** `[Rubric §11, Security]` assesses whether an authorization-relevant value can be forged by the caller. The two implemented members are not equivalent and the XML doc says so. `Claim` reads the tenant from the authenticated principal (`TenancySettings.cs:8-13`): the claim was signed by the token issuer, so a caller cannot pick its own tenant. `Header` reads it from a request header (`:15-20`): that is fine for service-to-service calls behind a trusted gateway, and a public edge honoring it lets any caller name any tenant. The default order is claim first, then header (`TenancySettings.cs:56-57`), so the trustworthy source always wins when both are present.

- **Walkthrough**: three members with explicit ordinals.
  - `Claim = 0` (`TenancySettings.cs:13`), read via `context.User?.FindFirst(settings.ClaimType)?.Value` (`TenantResolutionMiddleware.cs:111`); the claim type defaults to `tenant_id` (`TenancySettings.cs:83`).
  - `Header = 1` (`:20`), read via `context.Request.Headers[settings.HeaderName].FirstOrDefault()` (`TenantResolutionMiddleware.cs:112`); the header defaults to `X-Tenant-Id` (`TenancySettings.cs:89`).
  - `Host = 2` (`:27`), which maps to `null` in the middleware switch (`TenantResolutionMiddleware.cs:113`) and is skipped rather than guessed at (`TenantResolutionMiddleware.cs:101`).

- **Concept, a declared-but-unimplemented member that cannot silently no-op.** `[Rubric §9, API & Contract Design]`: the member exists so the configuration contract is stable when host-based resolution ships (`TenancySettings.cs:22-26`). `[Rubric §15, Best Practices]`: selecting it is not accepted quietly. [TenancySettingsValidator](#tenancysettingsvalidator) walks the effective resolution order and fails options validation with a message naming the two usable values (`TenancySettingsValidator.cs:54-64`), so the host refuses to boot instead of resolving nothing on every request. That is the fail-fast configuration contract ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)) applied to a value data annotations cannot express.

- **Why it's built this way**: shipping the enum member ahead of the implementation keeps the JSON contract additive, and pairing it with a boot-time rejection removes the only real risk of doing that.

- **Where it's used**: [TenantResolutionMiddleware](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) (`:111-113`), [TenancySettings.EffectiveResolutionOrder](#tenancysettings) (`TenancySettings.cs:76-77`), and [TenancySettingsValidator](#tenancysettingsvalidator) (`:58`).

---

### AuditTrailSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/AuditTrailSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `AuditTrail` section: whether entity change history is recorded at all, how long a row is kept, and which engine's `Default` database the read surface queries.

- **Depends on**: [DataSource](group-07-persistence-ef-core.md#datasource) from `MMCA.Common.Application.Interfaces.Infrastructure` (`AuditTrailSettings.cs:2`), which is what puts it at Level 1, plus `System.ComponentModel.DataAnnotations` for `[Range]`.

- **Concept introduced, a settings flag that gates the MODEL, not just behavior.** Most feature flags in this codebase decide whether code runs. This one also decides whether a table exists. `Enabled` is read in `ApplicationDbContext.OnConfiguring` with `GetService`, not `GetRequiredService`, and the result is cached in a field that the model builder consults (`ApplicationDbContext.cs:271`), so a host that leaves it false has exactly the model it had before the trail shipped and its migrations never see an `AuditTrailEntries` table (`AuditTrailSettings.cs:10-15`). `[Rubric §16, Maintainability]` assesses whether adopting a framework version is additive: this is what makes an opt-in feature genuinely free for a host that does not want it, since a mapped-but-empty table would still have to be migrated. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether the system can answer "who changed this, and when": the trail is that answer, and it is off by default because recording history is a data-governance decision an application makes deliberately ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)).

  `[Rubric §31, Cost/FinOps]`: the doc on `Enabled` states the cost being avoided directly, a table plus a write per change (`AuditTrailSettings.cs:22-24`). Marking entities with `IAuditedEntity` is the second gate and, as `AddAuditTrail`'s remarks put it, that is where the write volume is actually decided (`DependencyInjection.cs:370-373`).

- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "AuditTrail"` (`AuditTrailSettings.cs:19`).
  - `Enabled` (`:26`), defaulting to `false`. Read by [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) for the model gate (`ApplicationDbContext.cs:271`) and re-checked by the cleanup job before it does any work (`AuditTrailCleanupJob.cs:72-75`).
  - `RetentionDays` (`:38`), `[Range(1, 3650)]` (`:37`), default `90`. [AuditTrailCleanupJob](group-07-persistence-ef-core.md#audittrailcleanupjob) turns it into a cutoff instant (`AuditTrailCleanupJob.cs:77`) and purges from every relational source in use, skipping Cosmos (`:79-80`).
  - `DataSource` (`:46`), default `DataSource.SQLServer`. Note the asymmetry the doc calls out (`AuditTrailSettings.cs:40-45`): rows are WRITTEN to every relational source alongside the data they describe, and this value only says which source the v1 reader looks in. [AuditTrailReader](group-07-persistence-ef-core.md#audittrailreader) resolves it against `DataSourceKey.DefaultName` (`AuditTrailReader.cs:54`) and returns empty when the entity type is not in that model (`AuditTrailReader.cs:56`).

- **Why it's built this way**: `[Rubric §13, Observability & Operability]`. Retention is deliberately NOT self-driving: `AddAuditTrail` registers [AuditTrailCleanupJob](group-07-persistence-ef-core.md#audittrailcleanupjob) (`DependencyInjection.cs:391`) but a job only runs when the host also calls `AddScheduledJobs` and sets `Scheduler:Enabled` (`DependencyInjection.cs:363-368`). Without the scheduler the trail still records everything and `RetentionDays` is inert, which is a documented state rather than a surprise. Registering the job in `AddAuditTrail` rather than in `AddScheduledJobs` keeps the two features independent (`DependencyInjection.cs:388-390`).

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` at `DependencyInjection.cs:377-380`; read by [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), [AuditTrailReader](group-07-persistence-ef-core.md#audittrailreader) (`:38-40`), and [AuditTrailCleanupJob](group-07-persistence-ef-core.md#audittrailcleanupjob) (`:52`, `:60`). Design-time tooling supplies it by hand so a migration can be generated with the table on or off (`DesignTimeDbContextHelper.cs:87-88`). The recording itself is [AuditTrailSaveChangesInterceptor](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor), registered as a singleton at `DependencyInjection.cs:384` and resolved by the context with `GetService` so its absence reads as "not registered" (`ApplicationDbContext.cs:258-261`).

---

### ConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ConnectionStringSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete class bound from the top-level `ConnectionStrings` section, implementing [IConnectionStringSettings](#iconnectionstringsettings). It describes the `Default` physical data source.

- **Depends on**: [IConnectionStringSettings](#iconnectionstringsettings) (the reason it is Level 1) and `System.ComponentModel.DataAnnotations` for `[Required]`.

- **Concept introduced, validate-on-start as a fail-fast gate.** `[Rubric §15, Best Practices & Code Quality]` assesses whether misconfiguration is caught early. `AddOptions<T>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:67-70`) is the pattern every validated settings class in this namespace uses, and [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) makes it the required form: the annotations are evaluated during host startup, not lazily on first resolution, so a host with no SQL Server connection string fails to start with a named error instead of throwing inside the first request. `ValidateOnStart()` is the load-bearing call; without it the same annotations run on first use, which is the exact failure the contract exists to prevent. `[Rubric §13, Observability & Operability]`: a startup failure is far easier to diagnose in a deployment than an intermittent request-time exception.

- **Walkthrough**:
  - `SectionName = "ConnectionStrings"` (`ConnectionStringSettings.cs:12`), reusing ASP.NET Core's own conventional section so `GetConnectionString(...)` and this class read the same data.
  - `CosmosConnectionString` (`ConnectionStringSettings.cs:15`), empty by default.
  - `CosmosDatabaseName` (`:18`), the one property with a non-empty default, `"AtlDevCon"`.
  - `SqliteConnectionString` (`:21`), empty by default.
  - `SQLServerConnectionString` (`:25`), the only `[Required]` member (`:24`); the class doc explains why, SQL Server is the default data source (`ConnectionStringSettings.cs:6-7`).
  - `SQLServerMigrationsAssembly` (`:28`), empty by default, which makes EF fall back to the DbContext assembly.

- **Why it's built this way**: requiring exactly one engine's connection string keeps polyglot persistence opt-in ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) while still failing fast on the engine every deployment actually uses.

- **Where it's used**: bound and adapted to the interface at `DependencyInjection.cs:67-71`; read by [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) as the `Default` identity that named sources are compared against (`DataSourceResolver.cs:100`).

- **Caveats**: the `"AtlDevCon"` Cosmos default (`ConnectionStringSettings.cs:18`) is an application-specific name (the ADC conference database) baked into a framework package; every other default in this namespace is neutral.

---

### DataSourcesSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the bound `DataSources` section as a whole, a read-only dictionary of logical source name to [DataSourceEntrySettings](#datasourceentrysettings). It is the configuration input to database-per-microservice routing.

- **Depends on**: [DataSourceEntrySettings](#datasourceentrysettings) and `DataSourceKey.DefaultName` from the Application layer ([DataSourceKey](group-07-persistence-ef-core.md#datasourcekey)).

- **Concept introduced, a settings class that validates in its own constructor.** Most settings types here are inert bags validated by data annotations. This one is different, and the reason is stated in its own doc: a root-level *dictionary* section does not bind through the options pipeline, so [DependencyInjection](#dependencyinjection) builds the instance by hand from `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` and registers it as a singleton (`DataSourcesSettings.cs:8-11`, `DependencyInjection.cs:73-77`). With no options pipeline there is no `ValidateOnStart`, so the constructor becomes the fail-fast gate. `[Rubric §15, Best Practices & Code Quality]`: rejecting a reserved name at construction is the same guarantee `ValidateOnStart` would have given, implemented where the type can enforce it itself. `[Rubric §8, Data Architecture]`: the reserved-name rule protects a real invariant, `Default` is configured through the top-level `ConnectionStrings` section, and letting someone also declare a `DataSources:Default` entry would create two competing definitions of the same physical source.

- **Walkthrough**:
  - `SectionName = "DataSources"` (`DataSourcesSettings.cs:16`).
  - The constructor takes an optional `IReadOnlyDictionary<string, DataSourceEntrySettings>?` (`DataSourcesSettings.cs:23`) and substitutes an empty ordinal-comparer dictionary when it is null (`:25`), so "no `DataSources` section" is a first-class state rather than a null check at every call site.
  - It then walks every key (`DataSourcesSettings.cs:27-40`) and throws `InvalidOperationException` twice: on a blank or whitespace name (`:29-32`), and on any name equal to `DataSourceKey.DefaultName` under `OrdinalIgnoreCase` (`:34-39`). The second message is unusually good operator guidance, it names the offending entry and tells the reader that the `Default` source is configured via the top-level `ConnectionStrings` section, so remove or rename the entry.
  - `Sources` (`DataSourcesSettings.cs:44`), the get-only dictionary the resolver reads.

- **Why it's built this way**: throwing during host construction is the earliest possible point at which a duplicate `Default` definition can be caught; the alternative is a routing bug that surfaces as data landing in the wrong database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: constructed and registered as a singleton in `AddInfrastructure` (`DependencyInjection.cs:75-77`), immediately before [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) and [EntityDataSourceRegistry](group-07-persistence-ef-core.md#entitydatasourceregistry) (`DependencyInjection.cs:78-79`); consumed by the resolver's constructor (`DataSourceResolver.cs:35`) and its classification pass (`DataSourceResolver.cs:98`, `:104`).

- **Caveats**: the key comparison for *reservation* is `OrdinalIgnoreCase` (`DataSourcesSettings.cs:34`) while the default backing dictionary uses `StringComparer.Ordinal` (`:25`). The dictionary that configuration binding actually supplies is created by the binder, so its comparer is not determined by this file.

### IJwtSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10` · Level 1 · interface

- **What it is**: the contract for the `Jwt` configuration section. It carries both signing modes
  (an HMAC secret and an RSA key pair), the issuer and audience claim values, and the two token
  lifetimes (`IJwSettings.cs:10-50`).

- **Depends on**: [`JwtSigningAlgorithm`](#jwtsigningalgorithm) (the enum that selects the mode,
  `IJwSettings.cs:16`), which is what puts this interface at Level 1. Implemented by
  [`JwtSettings`](#jwtsettings) (`JwtSettings.cs:16`). No externals.

- **Concept**: the settings-interface pattern already taught under
  [`IConnectionStringSettings`](#iconnectionstringsettings), applied here to the one section whose
  members are *conditionally* required. The interface deliberately carries no validation attributes
  at all: which of `SecretForKey`, `RsaPrivateKeyPem` and `RsaPublicKeyPem` is mandatory depends on
  the value of `SigningAlgorithm`, and a data annotation cannot express that, so the check lives on
  the concrete [`JwtSettings`](#jwtsettings) as an `IValidatableObject` (`JwtSettings.cs:16`,
  `:51-66`).

  `[Rubric §11: Security]` assesses credential handling. Two facts are encoded in the contract
  itself. The doc for `RsaPrivateKeyPem` records the operational rule that the key lives in
  user-secrets or Key Vault and never in `appsettings.json` (`IJwSettings.cs:27`), and the whole
  interface is `init`-only, so once options are materialized nothing in the process can rewrite the
  signing key.

  `[Rubric §7: Microservices Readiness]` assesses whether a boundary can be crossed without a
  rewrite. `RsaPublicKeyPem` is doubly used: an in-process validator reads it directly, and the
  Identity service also publishes it at `/.well-known/jwks.json` so extracted services can validate
  tokens they did not issue (`IJwSettings.cs:32-37`). That is what makes the HMAC-to-RSA switch a
  configuration change rather than a code change ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).

- **Walkthrough**: eight `init`-only members, no methods.
  - `SigningAlgorithm` (`IJwSettings.cs:16`): the mode selector, documented as defaulting to
    `JwtSigningAlgorithm.HS256` for backwards compatibility.
  - `SecretForKey` (`:22`): the Base64-encoded HMAC-SHA256 key, required under HS256.
  - `RsaPrivateKeyPem` (`:29`) and `RsaPublicKeyPem` (`:37`): nullable PEM strings, required under
    RS256 for issuers and for in-process validators respectively.
  - `Issuer` (`:40`) and `Audience` (`:43`): the two claim values every validator compares against.
  - `AccessTokenExpirationMinutes` (`:46`) and `RefreshTokenExpirationDays` (`:49`): the two
    lifetimes, in different units, matching the short-access-token plus long-refresh-token split
    ([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)).

- **Why it's built this way**: one interface spanning both algorithms means
  [`TokenService`](group-08-auth.md#tokenservice) takes a single dependency and branches internally
  on `SigningAlgorithm` in its constructor (`TokenService.cs:53-63`), instead of the host having to
  register a different service per deployment topology.

- **Where it's used**: adapted from the bound options and registered as a singleton in
  `AddInfrastructure` (`DependencyInjection.cs:65`), then consumed by
  [`TokenService`](group-08-auth.md#tokenservice), which stores it in `_jwtSettings`
  (`TokenService.cs:25`, constructor `:47`) and hands it to `BuildHmacCredentials`
  (`TokenService.cs:166`) or `BuildRsaCredentials` (`:181`) once, at construction.

- **Caveats**: the file is named `IJwSettings.cs` while the type is `IJwtSettings`
  (`IJwSettings.cs:10`). The compiler does not care, but a filename-based search for the type will
  miss it.

---

### MessageBusSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:11` · Level 1 · class (sealed)

- **What it is**: the `MessageBus` section: which transport to use, how to reach the broker, how to
  namespace its queues, how hard to retry a failing consumer, and whether the consumer-side
  idempotency inbox is on (`MessageBusSettings.cs:11-65`).

- **Depends on**: [`MessageBusProvider`](#messagebusprovider), the transport enum declared in the
  same file (`MessageBusSettings.cs:68-84`). Externals: `System.ComponentModel.DataAnnotations` for
  the `[StringLength]` and `[Range]` guards (`:1`).

- **Concept introduced: retry policy as configuration rather than code.**
  `[Rubric §29: Resilience & Business Continuity]` assesses whether transient failures are absorbed
  before they turn into lost messages. Every broker receive endpoint gets an exponential-backoff
  `UseMessageRetry` built from three properties of this class, on both transports
  (`DependencyInjection.cs:794-798` for RabbitMQ, `:811-815` for Azure Service Bus), so a consumer
  that fails on a transient dependency is retried in-process instead of dead-lettering on the first
  exception. The remarks are equally instructive about what is deliberately absent: only in-process
  retry is configured, **not** `UseDelayedRedelivery`, because on RabbitMQ that needs the
  delayed-message-exchange plugin the Aspire container does not ship
  (`DependencyInjection.cs:769-774`).

  `[Rubric §7: Microservices Readiness]` assesses whether several services can share infrastructure
  without colliding. `EndpointPrefix` exists so multiple services can live on one broker without
  fighting over queue names (`MessageBusSettings.cs:28-34`).

  `[Rubric §6: CQRS & Event-Driven]` assesses reliability of event delivery. `EnableInbox` turns on
  consumer-side deduplication, the receiving counterpart to the outbox
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).

- **Walkthrough**: one static field then six `init` properties.
  - `SectionName = "MessageBus"` (`MessageBusSettings.cs:14`).
  - `Provider` (`:17`): defaults to `MessageBusProvider.InProcess`, so the modular monolith is the
    zero-configuration case.
  - `ConnectionString` (`:26`): nullable, and only the FIRST of three sources.
    `ResolveBrokerConnectionString` prefers it, then falls back to `ConnectionStrings:rabbitmq` and
    `ConnectionStrings:messaging` (`DependencyInjection.cs:750-759`), which is what Aspire injects
    via `WithReference(broker)`. Without that fallback MassTransit would default to
    `localhost:5672` and miss the Aspire-allocated container port (`DependencyInjection.cs:743-744`).
  - `EndpointPrefix` (`:34`) with `[StringLength(64)]` (`:33`): when it is set, `AddBrokerMessaging`
    switches on the kebab-case endpoint name formatter (`DependencyInjection.cs:665-668`).
  - `RetryLimit` (`:43`) with `[Range(0, 20)]` (`:42`), default `5`; `0` disables retries and a
    faulted message goes straight to the `_error` queue.
  - `RetryMinIntervalSeconds` (`:50`) with `[Range(0, 300)]`, default `1`, and
    `RetryMaxIntervalSeconds` (`:56`) with `[Range(0, 3600)]`, default `30`: the floor and the cap of
    the exponential backoff.
  - `EnableInbox` (`:64`), default `false`. The doc names the operational precondition: dedup runs
    through an `InboxMessages` table in the consumer's own database, so the `AddInboxMessages`
    migration must be applied first (`MessageBusSettings.cs:58-63`). `AddBrokerMessaging` registers
    the EF-backed store when it is on and a no-op store when it is off
    (`DependencyInjection.cs:686-693`), so consumer behavior is unchanged until the table exists.
    [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) reads the same flag to
    decide whether to purge inbox rows (`OutboxCleanupService.cs:51`).

- **Why it's built this way**: defaulting `EnableInbox` to false and swapping in a no-op store keeps
  a feature that requires a schema migration from breaking a host that has not run it
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)); defaulting
  `Provider` to `InProcess` keeps the monolith the zero-configuration case
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddInfrastructure` (`DependencyInjection.cs:139-142`), and re-read eagerly by
  `AddBrokerMessaging`, which falls back to `new MessageBusSettings()` when the section is absent
  (`DependencyInjection.cs:653-654`), short-circuits on `InProcess` (`:656-659`), and otherwise
  replaces [`IMessageBus`](group-04-events-outbox.md#imessagebus) with
  [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`:676`) and
  [`IEventBus`](group-04-events-outbox.md#ieventbus) with `BrokerEventBus` (`:682`), so publishing
  goes through the outbox and [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) becomes
  the only delivery channel.

- **Caveats**: MassTransit is pinned to major version 8 by policy across this workspace, and the
  retry configuration above is written against that API surface.

---

### PushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PushNotificationSettings.cs:6` · Level 1 · class (sealed)

- **What it is**: the concrete `PushNotifications` section. It implements
  [`IPushNotificationSettings`](#ipushnotificationsettings) and adds one member the interface does
  not carry: the regular expression a SignalR channel key must match
  (`PushNotificationSettings.cs:6-24`).

- **Depends on**: [`IPushNotificationSettings`](#ipushnotificationsettings)
  (`IPushNotificationSettings.cs:6-13`). No externals, and notably no data annotations.

- **Concept introduced: allow-listing client-supplied group names.** `[Rubric §11: Security]` and
  `[Rubric §26: Front-End Security]` both apply. A hub method that takes a channel key and calls
  `Groups.AddToGroupAsync` is joining a SignalR group named by the *client*; with no constraint, a
  caller could join any group the server publishes to and receive another tenant's or another
  event's traffic. `ChannelKeyPattern` is that constraint, defaulting to `"^(event|session):[0-9]+$"`
  (`PushNotificationSettings.cs:23`), so only `event:` and `session:` keys with a numeric suffix are
  accepted.

  `[Rubric §9: API & Contract Design]` assesses how additive changes are made. The property is
  declared on the concrete class only, precisely so
  [`IPushNotificationSettings`](#ipushnotificationsettings) stays unchanged and no downstream
  implementer breaks (`PushNotificationSettings.cs:17-22`). The consumer therefore takes
  `IOptions<PushNotificationSettings>` rather than the interface.

- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "PushNotifications"` (`PushNotificationSettings.cs:9`).
  - `Enabled` (`:12`) and `HubPath`, defaulting to `"/hubs/notifications"` (`:15`), both inherited
    from the interface (`IPushNotificationSettings.cs:9`, `:12`).
  - `ChannelKeyPattern` (`:23`). Enforcement lives in
    [`NotificationHub`](group-10-notifications.md#notificationhub): `EnsureValidChannelKey` pulls a
    `Regex` from a cache keyed on the pattern string (`NotificationHub.cs:63-65`) and throws
    `HubException("Invalid channel key.")` on an empty or non-matching key (`NotificationHub.cs:67-70`),
    and both `JoinChannelAsync` (`:46`) and `LeaveChannelAsync` (`:57`) call it before touching
    `Groups`. The regex is built with a one-second match timeout
    (`NotificationHub.cs:31`, `:65`), so a pathological configured pattern cannot hang the
    connection, and the cache is a `ConcurrentDictionary` so join and leave do not recompile the
    regex per call (`NotificationHub.cs:33-34`).

- **Why it's built this way**: a configurable pattern rather than a hard-coded one lets each
  application define its own channel taxonomy without forking the hub, while the shipped default is
  restrictive rather than permissive.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` and adapted to the
  interface in `AddPushNotifications` (`DependencyInjection.cs:530-535`), which then registers
  SignalR, optionally adds the Redis backplane when a `redis` connection string is present
  (`:539-543`), and replaces the null sender with
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender) (`:546`).
  The pattern itself is read only by [`NotificationHub`](group-10-notifications.md#notificationhub).

---

### SchedulerSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `Scheduler` section for the recurring-job runner: the on switch, the fallback
  poll interval, the row-claim lease, which engine holds the `ScheduledJobs` table, and a
  per-job cron override map. Every property has a default, so a host that opts in needs only
  `Scheduler:Enabled` (`SchedulerSettings.cs:6-9`).

- **Depends on**: [`DataSource`](group-07-persistence-ef-core.md#datasource), the engine enum,
  imported from `MMCA.Common.Application.Interfaces.Infrastructure` (`SchedulerSettings.cs:2`,
  `:52`), and [`ScheduledJobOverrideSettings`](#scheduledjoboverridesettings), the one-property
  record-like class declared in the same file (`:66-75`). Externals:
  `System.ComponentModel.DataAnnotations` for `[Range]` (`:1`).

- **Concept introduced: one setting that gates both the behavior and the schema.** Most feature
  flags gate behavior. `Enabled` also decides whether the `ScheduledJobs` table is mapped into the
  EF model at all: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext)
  reads `IOptions<SchedulerSettings>` with `GetService` (not `GetRequiredService`) and treats an
  absent registration as disabled, then requires the physical source to be the default one
  (`ApplicationDbContext.cs:263-268`). The consequence is the one worth learning: a host that leaves
  the flag false has exactly the model it had before the scheduler shipped, so its migrations never
  see the table (`SchedulerSettings.cs:10-15`).

  `[Rubric §16: Maintainability]` assesses whether adopting a framework feature is additive. Because
  registration and activation are separate (`AddScheduledJobs` binds and registers the runner, but
  the runner returns immediately unless `Enabled` is true, `ScheduledJobRunner.cs:77`), a host can
  ship the registration and turn the scheduler on per environment
  (`DependencyInjection.cs:298-302`).

  `[Rubric §29: Resilience & Business Continuity]` assesses safe behavior under replication.
  `LeaseSeconds` is what makes multiple replicas safe: a replica claims a job row for that many
  seconds and other replicas skip claimed rows, so no occurrence runs twice; if the claiming replica
  dies mid-execution, the row becomes claimable again once the lease expires
  (`SchedulerSettings.cs:36-43`, applied at `ScheduledJobRunner.cs:424`).

  `[Rubric §31: Cost/FinOps]` assesses idle-cost defaults. `PollingIntervalSeconds` is a *bound* on
  the smart wait, not a hot loop: the runner normally sleeps until the earliest due job and uses this
  value only to cap that sleep and to notice a configuration-driven schedule change
  (`SchedulerSettings.cs:28-34`, `ScheduledJobRunner.cs:116`).

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
    against `DataSourceKey.DefaultName` (`ScheduledJobRunner.cs:216`).
  - `Jobs` (`:60`): a get-only `Dictionary<string, ScheduledJobOverrideSettings>` keyed by
    [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob)`.Name` and bound from
    `Scheduler:Jobs:{Name}`. `ResolveCronExpression` takes the override only when the entry exists
    **and** its `Cron` is non-blank, otherwise the job's compiled-in expression stands
    (`ScheduledJobRunner.cs:162-166`). A changed expression is picked up on the next cycle: the
    runner rewrites the stored value and recomputes the next occurrence
    (`ScheduledJobRunner.cs:278-352`).

- **Why it's built this way**: a persistent, database-backed cron scheduler with per-row leases is
  the decision recorded in [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html);
  everything in this class is the operator-facing surface of it. Defaulting every property means the
  section is optional, which is the same fail-soft-on-absence, fail-fast-on-bad-value posture
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes:
  the `[Range]` guards run under `ValidateOnStart`, so a bad value fails the boot rather than the
  first cycle.

- **Where it's used**: bound with validation in `AddScheduledJobs`
  (`DependencyInjection.cs:306-309`), which registers the runner through
  `TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ScheduledJobRunner>())` rather than
  `AddHostedService` precisely so two calls cannot start two runners racing for the same rows
  (`DependencyInjection.cs:311-315`). Read by `ScheduledJobRunner` (`ScheduledJobRunner.cs:42`,
  `:46`) and by [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) for
  the table gate (`ApplicationDbContext.cs:266-268`); the design-time helper supplies a default
  instance so `dotnet ef` can build a model without a host
  (`DesignTimeDbContextHelper.cs:82`).

---

### SmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SmtpSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete `Smtp` section implementing [`ISmtpSettings`](#ismtpsettings),
  validated by data annotations at startup (`SmtpSettings.cs:5-8`).

- **Depends on**: [`ISmtpSettings`](#ismtpsettings) (`ISmtpSettings.cs:6-28`). Externals:
  `System.ComponentModel.DataAnnotations` for `[Range]` (`SmtpSettings.cs:1`).

- **Concept**: the validate-on-start gate taught under
  [`ConnectionStringSettings`](#connectionstringsettings), here guarding a numeric range rather than
  a required value. `[Rubric §15: Best Practices & Code Quality]` assesses whether avoidable
  failures are moved earlier. `[Range(1, 65535)]` on `Port` (`SmtpSettings.cs:21`) means a
  configuration typo such as `0` or `70000` fails the host at boot with a named error instead of
  surfacing as a socket exception the first time the application tries to send mail. Note also the
  named constant instead of a magic number: `DefaultSmtpPort = 25` is a public `static readonly`
  field (`:15`) used as the property's own default (`:22`), so the value is discoverable and
  testable rather than inlined.

- **Walkthrough**: two static fields then the seven interface members.
  - `SectionName = "Smtp"` (`SmtpSettings.cs:12`) and `DefaultSmtpPort = 25` (`:15`).
  - `Host` (`:18`), `Port` (`:22`), `Username` (`:25`), `Password` (`:28`), `EnableSsl` (`:31`,
    defaulting to `false`), `From` (`:34`), `To` (`:37`). Every string defaults to `string.Empty`,
    so an absent section binds cleanly and fails later at send time; only `Port` is range-checked.
    `To` is the default recipient used by the no-argument `SendAsync` overload
    (`ISmtpSettings.cs:26`).

- **Why it's built this way**: annotations plus `ValidateOnStart` cost one line at registration and
  move an entire class of misconfiguration from run time to boot, the contract
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) describes.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` and adapted to
  [`ISmtpSettings`](#ismtpsettings) in `AddInfrastructure` (`DependencyInjection.cs:81-85`);
  consumed by [`SmtpEmailSender`](group-10-notifications.md#smtpemailsender), which takes the
  interface as a primary-constructor parameter (`SmtpEmailSender.cs:12`).

- **Caveats**: `EnableSsl` is honored as configured, and nothing in these settings forces TLS on, so
  requiring it in a deployed environment is a configuration responsibility. The SMTP client
  construction carries a documented `S5332` suppression because local development targets MailDev,
  which does not offer TLS (`SmtpEmailSender.cs:29`).

---

### TenantEntrySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:121` · Level 1 · class (sealed)

- **What it is**: one declared tenant, bound from `Tenancy:Tenants:{tenantId}`. It holds exactly one
  member: that tenant's per-data-source connection overrides
  (`TenancySettings.cs:118-130`).

- **Depends on**: [`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings), the value
  type of its dictionary (`TenancySettings.cs:129`, declared at `:138`). Held by
  [`TenancySettings`](#tenancysettings)`.Tenants` (`:115`).

- **Concept introduced: declaring a tenant is only required for the database-per-tenant case.** This
  is the single most important thing to read off this class, and it is stated in its own doc
  (`TenancySettings.cs:109-114`). A shared-schema tenant needs **no** entry here at all, because its
  isolation comes from the global query filter and the tenant save interceptor, both of which are
  always registered (`DependencyInjection.cs:60-63`). Configuration is therefore only how a tenant
  is *promoted* to its own database.

  `[Rubric §8: Data Architecture]` assesses how deliberately data is partitioned. The dictionary is
  keyed by **physical** data source name (the name
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) produces, for example
  `Default` or `Conference`), and the key choice is load-bearing enough that
  [`TenancySettingsValidator`](#tenancysettingsvalidator) fails the boot on a key that does not
  round-trip. A tenant can override some sources and share others: a source with an entry is routed
  to the tenant's own database, a source without one stays shared
  (`TenancySettings.cs:123-128`).

- **Walkthrough**: one member.
  - `DataSources` (`TenancySettings.cs:129`): a get-only
    `Dictionary<string, TenantDataSourceOverrideSettings>`, bound from
    `Tenancy:Tenants:{tenantId}:DataSources:{sourceName}`. Get-only is the correct shape for a bound
    dictionary: the configuration binder populates an existing instance rather than assigning a new
    one.

- **Why it's built this way**: keeping the per-tenant overrides one level below the tenant, rather
  than flattening connection strings onto the tenant entry, is what lets a single tenant be
  physically separated on one source while remaining shared on the others, which is the mixed model
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) records.

- **Where it's used**: read by
  [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)`.ResolveTenantOverride`,
  which looks up the current tenant then the requested source and clones the shared
  `PhysicalDataSource` with the tenant's connection string while keeping the ORIGINAL
  `DataSourceKey`, so one compiled EF model serves every tenant's database
  (`DbContextFactory.cs:148-173`). Also expanded by `TenantDataSourceTargets.Expand`, which turns
  the shared sources plus every (tenant, overridden source) pair into the list the outbox and
  cleanup background services sweep (`TenantDataSourceTargets.cs:66-76`), and validated per entry by
  [`TenancySettingsValidator`](#tenancysettingsvalidator) (`TenancySettingsValidator.cs:71-106`).

---

### JwtSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:16` · Level 2 · class (sealed)

- **What it is**: the concrete `Jwt` section. It implements [`IJwtSettings`](#ijwtsettings) and adds
  the piece the interface cannot express: algorithm-aware validation of the key material
  (`JwtSettings.cs:16`, `:51-66`).

- **Depends on**: [`IJwtSettings`](#ijwtsettings) and, through it,
  [`JwtSigningAlgorithm`](#jwtsigningalgorithm) (`JwtSettings.cs:16`, `:22`). Externals:
  `System.ComponentModel.DataAnnotations` for `[Required]` and, critically, for the
  `IValidatableObject` interface (`:1`).

- **Concept introduced: `IValidatableObject` for conditional requirements.** Attributes describe a
  property in isolation, so they cannot say "this one is required only when that one has a
  particular value". `IValidatableObject` is the options-validation extension point for exactly that
  case: the type implements a single `Validate` method that yields one `ValidationResult` per
  failure, and `.ValidateDataAnnotations()` runs it alongside the attribute checks. This class is
  the framework's canonical example (`JwtSettings.cs:12-14`).

  `[Rubric §11: Security]` assesses credential handling. The HS256 branch does not merely check that
  a secret is present, it checks the length: fewer than 32 characters fails, and the message
  explicitly tells the operator to replace the placeholder with a real secret from user-secrets or
  environment variables (`JwtSettings.cs:53-58`). That is deliberate: a short or shipped-placeholder
  HMAC key is the failure mode that would otherwise reach production silently.

  `[Rubric §15: Best Practices & Code Quality]` assesses fail-fast posture. Registration pairs the
  bind with `.ValidateDataAnnotations().ValidateOnStart()`
  (`WebApplicationBuilderExtensions.cs:346-349`), so both the attribute checks and `Validate` run at
  boot, not on the first token issued
  ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).

- **Walkthrough**: one static field, eight `init` properties, one method.
  - `SectionName = "Jwt"` (`JwtSettings.cs:19`).
  - `SigningAlgorithm` (`:22`): defaults to `JwtSigningAlgorithm.HS256`, which is what makes the
    monolith the zero-configuration case.
  - `SecretForKey` (`:25`), `RsaPrivateKeyPem` (`:28`), `RsaPublicKeyPem` (`:31`): none carry
    `[Required]`, because whether they are required is decided in `Validate`.
  - `Issuer` (`:35`) and `Audience` (`:39`): both `[Required]` (`:34`, `:38`), because they matter in
    every mode.
  - `AccessTokenExpirationMinutes` (`:42`): default `15`. `RefreshTokenExpirationDays` (`:45`):
    default `7`. The short-access-plus-long-refresh split of
    [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html), expressed as
    defaults rather than as required configuration.
  - `Validate(ValidationContext)` (`:51-66`): an iterator method with two independent checks. Under
    HS256, `SecretForKey.Length < 32` yields a failure naming `SecretForKey` (`:53-58`); under
    RS256, a null or whitespace `RsaPrivateKeyPem` yields a failure naming `RsaPrivateKeyPem`
    (`:60-65`). Note the asymmetry against the interface docs: the private key is enforced here, the
    public key is not, because a service that only *validates* remotely fetches the key through JWKS
    rather than configuring it.

- **Why it's built this way**: keeping the conditional rule in code next to the properties it
  constrains, rather than in the registration call, means every host that binds this section gets the
  same guarantee without repeating it. The HMAC-to-RSA switch is a hard cutover that invalidates
  every existing token (`JwtSigningAlgorithm.cs:11-16`), so failing the boot on a half-configured
  RS256 host is strictly better than issuing tokens nobody can validate
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).

- **Where it's used**: bound with validation in `AddCommonAuthentication`
  (`WebApplicationBuilderExtensions.cs:346-349`), which then re-reads the section eagerly to build
  the JWT bearer `TokenValidationParameters`, throwing when the section is missing entirely
  (`:354-357`). The same registration installs the `OnMessageReceived` event that lifts the token
  out of the `access_token` query string for `/hubs` requests, because SignalR WebSocket connections
  cannot send headers (`:359-375`). An adapter exposes the bound instance as
  [`IJwtSettings`](#ijwtsettings) for [`TokenService`](group-08-auth.md#tokenservice)
  (`DependencyInjection.cs:65`).

---

### OutboxSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:10` · Level 2 · class (sealed)

- **What it is**: the `Outbox` section, tuning the outbox background processor and its cleanup
  companion. Every property has a default, so the section is optional and a host with no `Outbox`
  configuration still runs a working outbox (`OutboxSettings.cs:6-9`).

- **Depends on**: [`DataSource`](group-07-persistence-ef-core.md#datasource) (the engine enum) and
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) (for its `DefaultName` constant),
  both imported through `MMCA.Common.Application.Interfaces.Infrastructure`
  (`OutboxSettings.cs:2`, `:48`, `:57`). Externals: `System.ComponentModel.DataAnnotations` for the
  `[Range]` attributes (`:1`).

- **Concept introduced: options binding with a static `SectionName`.** Note the convention that runs
  through every settings class in this group: `public static readonly string SectionName = "Outbox";`
  (`OutboxSettings.cs:13`) is the single source of truth for the section name, referenced at the bind
  call instead of duplicating the literal. The properties are `init`-only, so once materialized from
  configuration they are immutable for the process lifetime.

  `[Rubric §6: CQRS & Event-Driven]` assesses how reliably state changes turn into dispatched events.
  This is the knob set for the at-least-once outbox
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)): `MaxRetries`
  (`:21`) caps attempts, and `ProcessingDelaySeconds` (`:40`) bounds the duplicate-dispatch window.
  The in-process path (save aggregate and outbox row, dispatch, mark processed) must complete inside
  that delay or the processor may re-dispatch the same event, which is why handlers must be
  idempotent regardless (`:33-38`).

  `[Rubric §29: Resilience & Business Continuity]` assesses behavior under replication and repeated
  failure. Three properties carry the weight. `LeaseSeconds` (`:82`) claims a batch for a replica so
  concurrent replicas never double-dispatch, and expires so a dead replica's rows become claimable
  again (`:75-81`, applied at `OutboxProcessor.cs:422`). `RetryBackoffBaseSeconds` (`:99`) makes the
  retry cadence explicit: attempt `n` waits `base * 2^(n-1)`, multiplied by a jitter factor in
  [0.8, 1.2] so rows that failed together do not retry in lockstep, then capped at `LeaseSeconds`
  (`:84-89`, implemented at `OutboxProcessor.cs:569-576`). The remark is worth reading as a design
  lesson: before this setting existed the claim was simply never cleared on failure, so the real
  retry cadence was an accident of the lease (300s) rather than a decision (`:90-97`).

  `[Rubric §31: Cost/FinOps]` assesses cost-relevant defaults. `PollingIntervalSeconds` (`:31`) is a
  fallback, not a hot loop (`:23-29`): with signal-based wakeup the processor wakes immediately on
  new entries and otherwise smart-waits until the earliest pending message becomes eligible, so
  deployed environments set it high (300 in this workspace) to cut idle SQL polling without adding
  latency for real traffic.

  `[Rubric §8: Data Architecture]` assesses how deliberately data is routed. The
  `DataSource` / `DatabaseName` pair (`:48`, `:57`) names where integration events published via
  [`IEventBus`](group-04-events-outbox.md#ieventbus) are written, defaulting to the top-level
  connection strings so single-database behavior is preserved. It is a per-write target, not a global
  switch: the doc is explicit that the *processor* still drains the outbox table of every relational
  physical source in use (`:53-56`).

- **Walkthrough**: one static field then ten `init` properties, eight of them `[Range]`-validated.
  - `SectionName` (`OutboxSettings.cs:13`): static readonly `"Outbox"`, the bind key.
  - `BatchSize` (`:16-17`): `[Range(1, 1000)]`, default `50`; messages per cycle, used both to size
    the fetch (`OutboxProcessor.cs:401`) and to decide whether more eligible work remains
    (`OutboxProcessor.cs:315`, `:335`).
  - `MaxRetries` (`:20-21`): `[Range(1, 20)]`, default `5`; attempts before a message is treated as
    dead-lettered and excluded from the poll (`OutboxProcessor.cs:345`, `:398`, `:535`).
  - `PollingIntervalSeconds` (`:30-31`): `[Range(1, 3600)]`, default `2`; the fallback interval.
  - `ProcessingDelaySeconds` (`:39-40`): `[Range(0, 600)]`, default `5`; the eligibility delay,
    applied as a cutoff on `OccurredOn` (`OutboxProcessor.cs:255`).
  - `DataSource` (`:48`): default `DataSource.SQLServer`; must be a relational provider (SQL Server
    or SQLite), since the outbox is a table.
  - `DatabaseName` (`:57`): default `DataSourceKey.DefaultName`; the logical source name paired with
    `DataSource`.
  - `RetentionDays` (`:64-65`): `[Range(0, 3650)]`, default `7`; days a **processed** message is kept
    before purge, with `0` disabling purging entirely, the pre-1.x behavior
    (`OutboxCleanupService.cs:57`).
  - `CleanupIntervalHours` (`:72-73`): `[Range(1, 168)]`, default `6`; the purge sweep cadence,
    ignored when `RetentionDays` is `0` (`OutboxCleanupService.cs:63`).
  - `LeaseSeconds` (`:81-82`): `[Range(10, 3600)]`, default `300`; the batch claim window.
  - `RetryBackoffBaseSeconds` (`:98-99`): `[Range(1, 3600)]`, default `10`; the exponential-backoff
    base described above.
  - `DeadLetterRetentionDays` (`:107-108`): `[Range(0, 3650)]`, default `0`, which falls back to
    `RetentionDays`. Set it higher to keep exhausted payloads around for diagnosis and manual replay;
    the cleanup service keys the dead-letter cutoff on `OccurredOn`, since those rows never got a
    `ProcessedOn` (`OutboxCleanupService.cs:117-133`).

- **Why it's built this way**: the defaults encode the framework's out-of-the-box posture
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) outbox,
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service):
  a monolith with no `Outbox` section gets a working at-least-once processor writing to its single
  default database, while a multi-service deployment overrides `PollingIntervalSeconds`,
  `DataSource` and `DatabaseName` to tune cost and routing. The `[Range]` guards give fail-fast
  validation at bind time rather than a bad value surfacing mid-cycle.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in
  `AddInfrastructure` (`DependencyInjection.cs:128-131`). Consumed by
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (`OutboxProcessor.cs:53`) and
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice)
  (`OutboxCleanupService.cs:43`) for batching, retry pacing and retention, and by both event buses
  to pick the write target when publishing an integration event (`InProcessEventBus.cs:27`,
  `BrokerEventBus.cs:34`) and by `EfInboxStore` (`EfInboxStore.cs:21`).

---

### TenancySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:50` · Level 2 · class (sealed)

- **What it is**: the `Tenancy` section, bound by `AddMultiTenancy(configuration)`: whether tenant
  resolution runs, how the tenant is found on a request, whether a request without one is rejected,
  which paths bypass resolution, and which tenants are declared for database-per-tenant routing
  (`TenancySettings.cs:30-34`).

- **Depends on**: [`TenantResolutionStrategy`](#tenantresolutionstrategy) (the strategy enum in the
  same file, `:6-28`) and [`TenantEntrySettings`](#tenantentrysettings) (the value type of `Tenants`,
  `:115`). No externals, and deliberately no data annotations: the checks that matter here are
  relational, so they live in [`TenancySettingsValidator`](#tenancysettingsvalidator).

- **Concept introduced: "empty means the default" for bound collections.** This is a genuine
  configuration-binder trap and the class documents it explicitly (`TenancySettings.cs:41-48`). The
  .NET configuration binder **adds** to a pre-populated collection rather than replacing it. If
  `ResolutionOrder` shipped pre-filled with `[Claim, Header]`, a host that configured its own order
  would end up running the framework's entries as well. The resolution is a pair of properties: the
  bound list starts empty (`:73`, `:103`), and the framework reads a computed
  `Effective*` projection that substitutes a private static default when the bound list is empty
  (`:76-77`, `:106-107`).

  `[Rubric §11: Security]` assesses where trust boundaries are drawn. The two implemented strategies
  are not equivalent and the enum says so: `Claim` is the trustworthy source because the claim was
  signed by the token issuer, so a caller cannot pick its own tenant (`:8-13`), while `Header` is
  intended for service-to-service calls behind a trusted gateway, and a public edge that honors it
  lets any caller name any tenant (`:15-20`). The default order tries `Claim` first
  (`:56-57`). `RequireTenant` defaults to `true` and is documented as failing closed, because with
  tenancy switched on an unscoped request would read across every tenant (`:91-96`).

  `[Rubric §16: Maintainability]` assesses whether a new capability is additive for existing hosts.
  `Enabled` gates **resolution**, not isolation: the global query filter and the save interceptor are
  always registered and are inert whenever no tenant is resolved
  (`:35-40`, `DependencyInjection.cs:60-63`). A host that never enables tenancy keeps exactly the
  behavior it had before tenancy shipped, and a host that does enable it can never accidentally leave
  the write-side guard off.

- **Walkthrough**: one public static field, two private static defaults, then six members.
  - `SectionName = "Tenancy"` (`TenancySettings.cs:53`).
  - `DefaultResolutionOrder` (`:56-57`): private static `[Claim, Header]`.
    `DefaultExcludedPathPrefixes` (`:60-61`): private static `["/health", "/alive", "/.well-known"]`,
    the probe and discovery endpoints that must answer before any tenant exists.
  - `Enabled` (`:67`): default `false`.
  - `ResolutionOrder` (`:73`) get-only list plus `EffectiveResolutionOrder` (`:76-77`), the
    empty-means-default projection.
  - `ClaimType` (`:83`), default `"tenant_id"`, and `HeaderName` (`:89`), default `"X-Tenant-Id"`,
    the two per-strategy lookup keys. `HeaderName` is only honored when `Header` is in the order.
  - `RequireTenant` (`:96`): default `true`.
  - `ExcludedPathPrefixes` (`:103`) plus `EffectiveExcludedPathPrefixes` (`:106-107`), the same
    projection shape.
  - `Tenants` (`:115`): a get-only `Dictionary<string, TenantEntrySettings>` bound from
    `Tenancy:Tenants:{tenantId}`, needed only for database-per-tenant.

- **Why it's built this way**: shared-schema isolation plus optional database-per-tenant promotion is
  the model [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) records, and
  this class is its whole operator-facing surface. Defaulting `Enabled` to false while keeping the
  filter and interceptor always-on is what makes the feature safe to ship into an existing host, and
  keeping every relational check in a separate `IValidateOptions<T>` (rather than in attributes) is
  what lets the validator reach the resolved data sources.

- **Where it's used**: bound with validation in `AddMultiTenancy`, alongside the
  `TryAddEnumerable` registration of [`TenancySettingsValidator`](#tenancysettingsvalidator)
  (`DependencyInjection.cs:426-433`). Read at request time by
  [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware), which
  short-circuits when disabled or on an excluded path (`TenantResolutionMiddleware.cs:62`), walks
  `EffectiveResolutionOrder` reading the claim or the header (`:107-112`), and returns
  `400 Bad Request` when nothing resolved and `RequireTenant` is on (`:75`). Read at persistence time
  by [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) for per-tenant connection
  routing (`DbContextFactory.cs:45`, `:148-173`), and by the background services through
  `TenantDataSourceTargets.Expand` so they sweep every tenant database too
  (`OutboxProcessor.cs:58`, `OutboxCleanupService.cs:48`, `AuditTrailCleanupJob.cs:55`,
  `TenantDataSourceTargets.cs:49-79`). All of those take the options as **nullable**, so a host that
  never called `AddMultiTenancy` resolves `null` and behaves exactly as before.

---

### TenancySettingsValidator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettingsValidator.cs:23` · Level 4 · class (sealed, internal)

- **What it is**: the startup validator for [`TenancySettings`](#tenancysettings). It rejects a
  resolution order naming an unimplemented strategy, and rejects a per-tenant data-source override
  that declares no connection string or names a source that does not exist
  (`TenancySettingsValidator.cs:23-47`).

- **Depends on**: [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) as an
  **optional** primary-constructor parameter (`:23`), plus
  [`DataSource`](group-07-persistence-ef-core.md#datasource) and
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) (`:3-4`, `:27-28`), and the two
  settings shapes [`TenancySettings`](#tenancysettings) and
  [`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings). Externals:
  `Microsoft.Extensions.Options` for `IValidateOptions<T>` and `ValidateOptionsResult` (`:2`), and
  `System.Globalization` for the `CultureInfo.InvariantCulture` message formatting (`:1`, `:79`).

- **Concept introduced: `IValidateOptions<T>` when validation needs other services.**
  [`JwtSettings`](#jwtsettings) showed `IValidatableObject`, which is the right tool when a rule only
  involves the settings object itself. This class is the other half of the options-validation story:
  `IValidateOptions<T>` is a DI-resolved service, so it can inject collaborators. Here that
  collaborator is the data-source resolver, which is the only thing that knows whether `Conference`
  is a real physical source in this host. Registration is
  `TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<TenancySettings>, TenancySettingsValidator>())`
  (`DependencyInjection.cs:432-433`): `TryAddEnumerable` because two modules calling
  `AddMultiTenancy` must not run the same validation twice (`DependencyInjection.cs:431`).

  `[Rubric §11: Security]` assesses whether misconfiguration can degrade silently. The class doc
  states the rationale outright: every failure here would otherwise surface as silent cross-tenant
  behavior at run time, which is exactly the class of bug tenancy exists to prevent, so it is worth a
  failed boot (`TenancySettingsValidator.cs:8-13`). The concrete danger is the override key: an
  unknown logical name resolves to `Default`, so a typo'd source name would quietly leave that
  tenant on the shared database instead of its own (`:112-116`).

  `[Rubric §15: Best Practices & Code Quality]` assesses the quality of failure messages. Each
  message names the exact configuration path that is wrong and tells the operator what to do:
  the missing-connection-string message lists the three acceptable properties and notes that removing
  the entry keeps the source shared (`:78-85`); the unknown-source message explains that override
  keys are physical names (`:95-104`); the `Host` strategy message names the two supported values
  (`:60-63`).

- **Walkthrough**: one static field, the interface method, three private helpers, one internal
  helper.
  - `Engines` (`:27-28`): private static `[SQLServer, Sqlite, CosmosDB]`, the engines an override can
    carry a connection string for.
  - `Validate(string? name, TenancySettings options)` (`:31-47`): null-guards the options, collects
    failures into a list, runs the resolution-order check once and the tenant check per declared
    tenant, then returns `ValidateOptionsResult.Success` or `Fail(failures)`. Note that it
    accumulates **all** failures rather than returning on the first, so one boot attempt reports the
    whole set.
  - `ValidateResolutionOrder` (`:54-65`): walks `EffectiveResolutionOrder` (so the framework default
    is validated too, not just an explicitly configured order) and fails on
    `TenantResolutionStrategy.Host`. That enum member exists so the configuration contract is stable
    for when host-based resolution ships, but selecting it today must not read as "resolve nothing"
    (`:49-53`, and the enum's own doc at `TenancySettings.cs:22-27`).
  - `ValidateTenant` (`:71-106`): for each `(sourceName, override)` pair, computes which engines the
    override actually declares a connection string for. Zero engines is a failure and the loop moves
    on (`:76-86`). If `resolver` is null the source-existence check is skipped entirely (`:88-91`),
    which is what makes the validator usable in a container that never registered persistence
    (`:14-18`). Otherwise every declared engine whose source name is unknown produces a failure
    (`:93-104`).
  - `DeclaredEngines` (`:109-110`): a collection expression over `Engines` filtered by
    `ConnectionStringFor` being non-blank.
  - `IsKnownPhysicalSource` (`:117-119`): the round-trip test. `Default` always passes; otherwise the
    name must survive `resolver.ResolveLogical(engine, sourceName).Name` unchanged, because an
    unknown logical name collapses onto `Default` and therefore comes back different.
  - `ConnectionStringFor(DataSource, TenantDataSourceOverrideSettings)` (`:122-129`): `internal
    static`, a switch expression mapping engine to the matching connection-string property. It is
    `internal` rather than private because it is reused outside validation, which is the detail worth
    noting next.

- **Why it's built this way**: the engine-to-property mapping is needed in three places (validation,
  target expansion, and connection routing), so it lives once here and the runtime paths call back
  into the validator's `ConnectionStringFor` rather than re-implementing the switch
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Making the resolver
  optional rather than required is what keeps the validator constructible in a host that binds
  tenancy without registering `AddInfrastructure`, at the cost of skipping the source-existence
  check there; the strategy and connection-string checks still run.

- **Where it's used**: registered by `AddMultiTenancy` with `ValidateOnStart` on the options
  (`DependencyInjection.cs:426-433`). Its `ConnectionStringFor` helper is called at run time by
  `TenantDataSourceTargets.Expand` when deciding whether a (tenant, source) pair is really overridden
  (`TenantDataSourceTargets.cs:71`) and by
  [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)`.ResolveTenantOverride` when
  cloning the physical source for a tenant (`DbContextFactory.cs:158`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/AddMultiTenancyTests.cs`,
  which asserts the registration shape (`:98`) and drives the validator both with and without a
  resolver (`:168`, `:206`).

- **Caveats**: the type is `internal`, so it is not part of the framework's public API and a
  consumer cannot subclass or replace it; a host needing extra tenancy rules registers its own
  additional `IValidateOptions<TenancySettings>`.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:145-150`).

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
  in its `GET preferences` action (`UserAccountAuthControllerBase.cs:150`) and handled by
  [`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
  (`GetUserPreferencesHandlerBase.cs:33-35`). Both apps' `AuthController` take the closed handler
  interface as a constructor dependency
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:34`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:32`), and
  both architecture suites use it as the *query* specimen when asserting decorator ordering
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:28`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:27`).

---

### ChangePasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24` · Level 8 · class (abstract)

- **What it is**: the shared password-rotation workflow for an authenticated user. Load the account,
  verify the current password against the stored hash, hash the new one, let the aggregate apply its
  own invariants, and persist only if the aggregate accepted the change
  (`ChangePasswordHandlerBase.cs:24`, `:42-70`).

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
  text (`ChangePasswordHandlerBase.cs:11-15`). Hoisting them needed two variation points, and each is
  a separate generic parameter for a separate reason. `TUser` varies because each app owns its own
  `User` aggregate and the framework must never reference either; the *capability* it needs is named
  by an interface constraint instead, so the base can call `ChangePassword` without knowing the type
  (`IPasswordChangeableUser.cs:19`). `TCommand` varies because the command record carries
  app-specific **pipeline** policy: ADC's `ChangePasswordCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15`,
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
  (`ChangePasswordHandlerBase.cs:16-21`).

- **Where it's used**: subclassed once per app, each subclass empty apart from the constructor
  forwarding
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:17`,
  `:21`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:16`,
  `:20`). Both subclasses are picked up as scoped command handlers by
  `ScanModuleApplicationServices<TAssemblyMarker>()` (see [`DependencyInjection`](#dependencyinjection))
  and are then wrapped by the decorator pipeline. The workflow is pinned directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:15`,
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
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:3-10`). A naive handler
  that passed both fields straight to the aggregate would clear whichever one the caller omitted. The
  merge therefore happens in exactly one place, at the call into the aggregate:
  `command.Request.Culture ?? user.PreferredCulture` and the matching line for the theme (`:53-55`).
  The domain interface documents the same contract from its side, so an aggregate author knows that
  `UpdatePreferences` always receives both values fully resolved (`IUserPreferences.cs:18-25`).

  `[Rubric §16: Maintainability]` assesses whether a rule has one home. Before the hoist this merge
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
  (`UserAccountAuthControllerBase.cs:125-131`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:16`
  through a test subclass (`:108-109`).

---

### DeleteUserHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38` · Level 8 · class (abstract)

- **What it is**: the shared account-erasure workflow: authorize owner-or-privileged-role, soft-delete
  the account, run the app's tail hook, irreversibly anonymize the personal data in place, save, then
  drain a post-commit queue (`DeleteUserHandlerBase.cs:38`, `:55-119`). It is the most extensible of
  the seven Users bases: one abstract member and one virtual hook.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and an `ILogger`
  (`:38-40`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:40`). Constraints: `TUser` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  implementing [`IErasableUser`](group-08-auth.md#ierasableuser) (`:41`), and `TCommand` is an
  [`IUserOwnedRequest`](#iuserownedrequest) (`:42`), not an
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest): this workflow needs the
  *caller* as well as the target, and carries no request payload. It also uses
  [`UserOwnershipRule`](#userownershiprule), [`Error`](group-01-result-error-handling.md#error) and
  [`UserUseCaseLog`](#userusecaselog). Externals: `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: anonymize-in-place erasure, and why the row survives.** Soft-delete
  (`IsDeleted = true`) hides a row but keeps its personal data, so it does not by itself satisfy a
  GDPR/CCPA erasure request; hard-deleting the row would break cross-context scalar references and
  destroy the audit trail. The framework's answer is the pair
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) plus
  [`IErasableUser`](group-08-auth.md#ierasableuser): keep the row, overwrite the personal fields with
  non-identifying placeholders, and require `Anonymize()` to be idempotent
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22-31`). This handler is
  where that policy becomes a sequence
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).

  **Concept introduced: interface dispatch as a correctness device.** The comment at `:83-87` is one
  of the most instructive in the framework. An app's `User` may *hide* the base entity's `Delete()`
  with `public new Result Delete()` to add account-specific behavior such as revoking the refresh
  token. A hidden method is not an override, and member lookup on a generic type parameter prefers the
  members of its **class** constraint, so a bare `user.Delete()` inside this base would bind to
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)`.Delete()`
  and silently skip the app's version. The workflow therefore assigns the user to an
  `IErasableUser` local first and calls through the interface (`:88-89`), because the interface map
  resolves to the most derived `Delete()` the app type declares. The interface's own remarks record
  the same reasoning from the contract side, including the deliberate choice not to implement it on
  the base entity so a forgetful consumer fails the generic constraint at compile time rather than
  losing behavior at run time (`IErasableUser.cs:11-28`).

  **Concept introduced: the post-commit queue.** `OnAfterSoftDeleteAsync` receives an
  `ICollection<Func<CancellationToken, Task>> afterCommit` (`:145`). Work that must not happen unless
  the erasure actually commits (deleting a blob, writing a cache marker) is *enqueued* rather than run
  inline, and the base drains the queue in order after `SaveChangesAsync` (`:111-114`). The subtle
  benefit named in the docs is that the override can hand values it captured before anonymization to a
  post-commit closure without parking them in mutable handler state (`:22-27`), which matters because
  handlers are scoped and a field would be a shared mutable across the whole request.

  `[Rubric §30: Compliance, Privacy & Data Governance]` assesses whether a data-subject erasure
  request is actually satisfiable. The sequence here is the mechanism behind both apps' published
  erasure promise: soft-delete, then irreversible anonymization, in one transaction (`:10-15`).

  `[Rubric §11: Security]` assesses authorization placement. The very first thing the method does,
  before it touches the repository, is the ownership check (`:62-71`), so an unauthorized caller
  cannot even confirm that an account id exists. The privileged-role test is passed in already
  evaluated because each app owns its own role vocabulary (`UserOwnershipRule.cs:15-19`).

  `[Rubric §1: SOLID]` assesses the template-method shape. The invariant order (authorize, load,
  delete, tail, anonymize, save, post-commit) is fixed by the base; only the two hooks vary.

- **Walkthrough**: two protected members, the handler method, and two hooks.
  - Primary constructor (`:38-40`): `unitOfWork`, `logger`. `UnitOfWork` (`:45`) is protected
    specifically so a tail hook can reach further aggregates.
  - `HandlerName` (`:52`): the same `GetType().Name` default that preserves the pre-hoist error
    `source`.
  - `HandleAsync(TCommand, CancellationToken)` (`:55-119`):
    - Authorization first (`:62-67`) through
      [`UserOwnershipRule.CheckOwnership`](#userownershiprule) (`UserOwnershipRule.cs:38`), with the
      code `"User.DeleteForbidden"` and a message the caller sees; a non-null return is the failure
      (`:68-71`).
    - Load through the write repository (`:73-74`); `Error.NotFound` when absent (`:77`).
    - `IErasableUser erasable = user; erasable.Delete()` (`:88-89`) with the dispatch rationale above;
      a failure returns immediately (`:90-93`).
    - Allocate the `afterCommit` list and call `OnAfterSoftDeleteAsync` (`:95-96`); a failed tail
      aborts before anything is persisted (`:97-100`).
    - `erasable.Anonymize()` (`:103`), also short-circuiting on failure (`:104-107`).
    - `SaveChangesAsync` (`:109`), then the post-commit drain in order (`:111-114`), then the
      `UserUseCaseLog.UserErased` log (`:116`) and `Result.Success()` (`:118`).
  - `HasDeletePrivilege(string? currentUserRole)` (`:127`): `protected abstract`. Deliberately
    abstract rather than virtual-defaulting-to-false, so adopting the base forces an explicit answer
    about which role bypasses ownership.
  - `OnAfterSoftDeleteAsync(user, command, afterCommit, cancellationToken)` (`:142-147`): `protected
    virtual`, defaulting to `Task.FromResult(Result.Success())`. Its position is load-bearing and
    documented: it runs **after** `Delete()` and **before** `Anonymize()` (`:29-34`), which is the only
    point where an override can both read personal data that anonymization is about to erase and
    enlist further aggregates in the same unit of work. Running it before `Delete()` would let a
    cascaded aggregate's error mask the account's own `AlreadyDeleted` error.

- **Why it's built this way**: the hook contract was derived from what the two apps actually needed,
  and both uses are visible in their overrides. ADC's override
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:46-88`)
  captures the avatar blob name *before* anonymization clears the URL (`DeleteUserHandler.cs:54`),
  raises the cross-service `UserDeleted` domain event on the aggregate so its outbox row is written by
  the very save that commits the erasure (`:62`), and queues the soft-deleted-user cache marker and
  the blob deletion as post-commit actions (`:68-84`).
  Store instead cascades in the same unit of work, erasing the linked `Customer` that holds its
  name/email/address PII and returning the Customer's own failure untouched so nothing is persisted
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:35-60`).
  One hook covers both because it can do work inline *and* schedule work for after the commit.

- **Where it's used**: subclassed once per app
  (`MMCA.ADC/.../DeleteUser/DeleteUserHandler.cs:28`, `:34`, with `HasDeletePrivilege` returning
  `UserRole.IsOrganizer(...)` at `:42-43`; `MMCA.Store/.../DeleteUser/DeleteUserHandler.cs:20`, `:23`,
  with `UserRole.IsAdmin(...)` at `:26-27`). Covered directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:14`, whose
  fixture user type is `TestHidingDeleteUser`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:96`, closed
  over at `DeleteUserHandlerBaseTests.cs:195-196`) precisely so the hidden-`Delete()` dispatch rule
  above is a regression test rather than a comment.

- **Caveats**: post-commit actions run after the erasure has already succeeded, so each one owns its
  own failure handling; the base does not wrap them (`:111-114`, and see the documented expectation at
  `:135-139`). ADC's override wraps its cache-marker action in a try/catch for exactly that reason
  (`MMCA.ADC/.../DeleteUser/DeleteUserHandler.cs:70-79`). Both apps' `DeleteUserCommand` records are
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), so the cache prefix they carry
  is invalidated by the decorator after the handler returns success, outside this class.

---

### ForgotPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ForgotPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:35` · Level 8 · class (abstract)

- **What it is**: the shared start-a-password-reset workflow: parse the submitted address, resolve the
  account behind it, mint a single-use token, and email it. Every outcome returns
  `Result.Success()` (`ForgotPasswordHandlerBase.cs:35`, `:51-100`).

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
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:6-16`).

  `[Rubric §11: Security]` assesses whether a public endpoint leaks facts about who holds an account.
  The leak surface is wider than the HTTP response, and the code closes it in three places. The result
  is uniform (`:62`, `:70`, `:77`, `:95`). The controller turns every one of them into the same
  `202 Accepted`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:82-93`).
  And the rejection log deliberately carries a reason string but no address and no account id, so the
  log does not become the oracle the response is not
  (`UserUseCaseLog.cs:34-37`). Only the paths that already proved an account exists log a user id
  (`UserUseCaseLog.cs:25-32`).

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
  `:79-80`). That split is why the handler's only reaction to a throttled request is a log line: it
  never learns which limit fired. The command record stays app-side for the same reason it does in the
  ChangePassword hoist, and the base reads it only through `ICommandWithRequest<ForgotPasswordRequest>`
  (`:27-31`).

- **Where it's used**: subclassed once per app, each override implementing the address lookup as an
  untracked `GetAllAsync` filtered on the `Email` value object
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:20`,
  `:26`, `:29-37`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:21`,
  `:27`, `:34-46`). Reached over HTTP through
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand),
  whose `POST forgot-password` action is `[AllowAnonymous]`, rate-limited by the auth-IP policy and
  `[Idempotent]` (`PasswordResetAuthControllerBase.cs:75-93`). Pinned by six tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:20`
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
  (`UserAccountAuthControllerBase.cs:45`, `:57`, `:149-150`). Pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:14`
  through a test subclass (`:87-88`), and by each app's own handler tests.

- **Caveats**: the soft-delete global query filter applies to this read like any other, so a
  soft-deleted account resolves to `null` and returns `NotFound` rather than its stored preferences.
  That behavior comes from the persistence layer, not from anything in this class.

---

### ResetPasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ResetPassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:30` · Level 8 · class (abstract)

- **What it is**: the shared complete-a-password-reset workflow: redeem the single-use token, hash the
  new password, let the aggregate apply its invariants, persist, then clear the account's lockout so
  the user can sign in immediately with the new credential (`ResetPasswordHandlerBase.cs:30`,
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
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:111`).

  **Concept introduced: one error for every rejection.** Unlike the authenticated change-password
  path, which can afford a specific `Auth.InvalidCurrentPassword`, this anonymous endpoint collapses
  an unknown token, an expired token, a mismatched token, an attempt-capped token and a vanished
  account into a single `Auth.InvalidResetToken` (`:95-99`, produced at `:67` and `:77`). The private
  `InvalidToken()` factory exists so there is exactly one construction site and no way for a future
  edit to make two branches distinguishable by accident.

  `[Rubric §11: Security]` assesses whether an anonymous endpoint leaks account state. Two mechanisms
  do the work here: the uniform error above, and a rejection log that names only a reason string,
  never an address or an account id (`:66`, `:75`, and `UserUseCaseLog.cs:34-37`). The
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:7-23`).

- **Where it's used**: subclassed once per app as an empty, name-preserving class
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:18`,
  `:24-29`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:20`,
  `:26-31`). Reached over HTTP through the `POST reset-password` action on
  [`PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>`](group-12-api-hosting-mapping.md#passwordresetauthcontrollerbasetforgotpasswordcommand-tresetpasswordcommand)
  (`PasswordResetAuthControllerBase.cs:99-118`), which answers `204 No Content` on success. Pinned by
  five tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:18`
  through a test subclass (`:176-181`), covering both generic-error paths, the happy path, the
  aggregate rejection and the consume-before-save ordering (`:28`, `:48`, `:64`, `:85`, `:111`).

- **Caveats**: the two apps differ on cache policy exactly as they do for change-password: ADC's
  `ResetPasswordCommand` is
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a prefix built from its
  own `User` type
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:15`,
  `:18`) and Store's is not, which is the reason the command record stays app-side. The lockout clear
  at `:89` runs after the save and is not part of the transaction: if it throws, the password has
  already changed. Not determinable from source: whether any deployment configures a
  `ResetFailedAttemptsAsync` implementation that can fail in a way the caller would notice, since the
  contract returns a bare `Task` with no result (`ILoginProtectionService.cs:33`).


---
[⬅ gRPC & Inter-Service Contracts](group-13-grpc-contracts.md)  •  [Index](00-index.md)  •  [Common UI Framework (MudBlazor components, theme, base pages) ➡](group-15-common-ui-framework.md)
