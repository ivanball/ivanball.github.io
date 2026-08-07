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
[`FileStorageSettings`](#filestoragesettings)); the cross-replica locking pair
([`RedisDistributedLock`](#redisdistributedlock), [`InProcessDistributedLock`](#inprocessdistributedlock));
and the shared **Users** use-case bases that two apps compose into their own Identity modules. The
detailed per-type sections follow; this overview shows how the pieces fit together at runtime.

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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:295-303`). Application code never
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
pipeline (next section) can only wrap handlers that are already in the container.

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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:287-293`). After discovery the
loader also drives startup data through `SeedAllAsync` (`ModuleLoader.cs:270-276`), which invokes each
collected [`IModuleSeeder.SeedAsync`](#imoduleseeder) in registration order.
[`IModuleSeeder`](#imoduleseeder)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8`) is a two-member
interface, `ModuleName` (matched case-insensitively against an [`IModule`](#imodule) `Name`) and
`SeedAsync(serviceProvider, cancellationToken)`, deliberately separate from `IModule` so seeding runs
*after* the whole container is built and a real `IServiceProvider` exists.

## The two composition roots and the ordering they enforce

Service registration itself lives in two static [`DependencyInjection`](#dependencyinjection) classes,
each using a C# `extension(IServiceCollection services)` block (see
[primer §4](00-primer.md#4-c-build-and-code-style-conventions) for the `extension(T)` syntax). The
**Application** root
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:20`) exposes `AddApplication()`
(`DependencyInjection.cs:28`), which fronts [`ApplicationSettings`](#applicationsettings) with its
[`IApplicationSettings`](#iapplicationsettings) abstraction (`DependencyInjection.cs:30`), registers
the three core singletons ([`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher),
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider),
[`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline),
`DependencyInjection.cs:32-34`), and pulls in the framework's own FluentValidation validators by
assembly (`DependencyInjection.cs:39`). It also owns `ScanModuleApplicationServices<TAssemblyMarker>()`
(`DependencyInjection.cs:114-178`), the Scrutor convention scan every module's `AddXModule` calls:
domain-event and integration-event handlers as singletons (`DependencyInjection.cs:118-129`), DTO and
request mappers scoped (`DependencyInjection.cs:131-141`), command and query handlers scoped
(`DependencyInjection.cs:143-153`), validators from the module assembly (`DependencyInjection.cs:155`),
and finally a reflection pass that `TryAdd`s a `CommandRequestValidator<,>` for every command
implementing `ICommandWithRequest<T>` (`DependencyInjection.cs:159-175`) so an explicit validator still
wins. The **Infrastructure** root
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:38`) exposes
`AddInfrastructure(configuration)` (`DependencyInjection.cs:48`), which binds most of the settings
types in this chapter, registers the persistence stack (data-source service and resolver, entity
registry, the scoped and singleton context factories, repositories, unit of work,
`DependencyInjection.cs:50-102`), Scrutor-scans the framework's own EF entity configurations
(`DependencyInjection.cs:106-110`), adds caching (`DependencyInjection.cs:112`), and enrolls the two
outbox hosted services (`DependencyInjection.cs:143-145`). Optional add-ons sit alongside it:
`AddPushNotifications` (`DependencyInjection.cs:290`), `AddNativePushNotifications`
(`DependencyInjection.cs:325`), `AddAzureBlobFileStorage` (`DependencyInjection.cs:357`),
`AddBrokerMessaging` (`DependencyInjection.cs:409`), and the typed-client helper
`AddTypedServiceClient<TInterface, TImplementation>(serviceName)` (`DependencyInjection.cs:478`) that
swaps an in-process abstraction for an HTTP transport with JWT forwarding and the standard Polly
pipeline.

`AddCaching` (`MMCA.Common.Infrastructure/DependencyInjection.cs:157`) also registers this chapter's
one cross-replica primitive: an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) that
resolves to [`RedisDistributedLock`](#redisdistributedlock) when the host has an
`IConnectionMultiplexer` registered, and to the warn-once
[`InProcessDistributedLock`](#inprocessdistributedlock) otherwise
(`MMCA.Common.Infrastructure/DependencyInjection.cs:188-202`). The Redis implementation is the
standard `SET key token NX PX ttl` lock with a compare-and-delete release script
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:36-37`,
`RedisDistributedLock.cs:66-72`); the fallback is exclusive only inside one process, which is exactly
what its warning says out loud
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:75`), so a
multi-replica host that registers no Redis client gets one execution of the guarded section per
replica.

The **order** of these calls is a hard contract in exactly one respect, and it is the reason
`AddApplicationDecorators()` (`MMCA.Common.Application/DependencyInjection.cs:88`) must come *last*.
Decorators are registered with **Scrutor's `TryDecorate`**, which wraps *existing* registrations, so
every module's concrete handlers must already be in the container or there is nothing to wrap. Beyond
that, the relative position of `AddInfrastructure` and `AddAPI` is not load-bearing. `[Rubric §6, CQRS
& Event-Driven]` and `[Rubric §1, SOLID]` (open/closed) live here: cross-cutting behavior is added by
wrapping, not by editing handlers. `AddApplicationDecorators` also encodes the **execution order** via
`TryDecorate`'s reverse-registration rule (registered innermost first,
`MMCA.Common.Application/DependencyInjection.cs:93-102`), so the command pipeline ends up
`FeatureGate -> Logging -> Caching -> Validating -> Transactional -> handler` and the query pipeline
`FeatureGate -> Logging -> Caching -> handler`
([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The decorator types
themselves (for example
[`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult)
and [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult))
are documented in the CQRS-pipeline chapter; this chapter owns only the *wiring* of them. An optional
MiniProfiler pair is registered separately by an opt-in `AddApplicationProfiling()`
(`MMCA.Common.Application/DependencyInjection.cs:185-191`), never by `AddApplicationDecorators()`.

## Assembly anchors

Several pieces of machinery need a `Type` whose `Assembly` identifies a layer: Scrutor's
`FromAssemblyOf<T>()` scans, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`, and
NetArchTest's per-package anchor. That is what the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) pairs are, one per layer (Domain, Application, Infrastructure),
each a trivial `static class AssemblyReference` holding `Assembly` / `AssemblyName` statics
(`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8-12`) beside a non-static `class
ClassReference` (`AssemblyReference.cs:18`) for the places a generic constraint forbids a static type.
`AddApplication` uses the Application pair for the common validators
(`MMCA.Common.Application/DependencyInjection.cs:39`) and `AddInfrastructure` uses the Infrastructure
pair to scan entity configurations (`MMCA.Common.Infrastructure/DependencyInjection.cs:106-110`). They
are deliberately behavior-free; their whole job is to *name an assembly* for the scanning and
governance tooling.

## Configuration binding, the Settings family

Everything a host operator tunes arrives as a strongly-typed settings object bound from an
`appsettings.json` section, each carrying a `static readonly string SectionName` so the section name
lives next to the shape it binds. The pattern in `AddInfrastructure` is uniform:
`services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
(for example [`ConnectionStringSettings`](#connectionstringsettings) at
`MMCA.Common.Infrastructure/DependencyInjection.cs:60-63`), so misconfiguration **fails fast at
startup** rather than lazily on first use, and the concrete class is then usually fronted by an
interface singleton so consumers depend on the abstraction ([`IConnectionStringSettings`](#iconnectionstringsettings)
at `DependencyInjection.cs:64`, [`ISmtpSettings`](#ismtpsettings) at `DependencyInjection.cs:78`,
[`IJwtSettings`](#ijwtsettings) at `DependencyInjection.cs:58`,
[`IPushNotificationSettings`](#ipushnotificationsettings) at `DependencyInjection.cs:296`).
`[Rubric §13, Observability & Operability]` and `[Rubric §15, Best Practices]` apply: `ValidateOnStart`
plus DataAnnotations ranges (for example [`OutboxSettings`](#outboxsettings) `BatchSize` is
`[Range(1, 1000)]` with a default of 50,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:16-17`) turn a config
typo into an immediate, descriptive boot failure.

The Application-layer settings drive composition itself. [`ApplicationSettings`](#applicationsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:6`) carries
`UseMiniProfiler`, `MaxPageSize` (default 500) and `DatabaseInitStrategy` (default `"Migrate"`,
`ApplicationSettings.cs:12-18`) and is passed by value into every `IModule.Register`.
[`ModulesSettings`](#modulessettings) *is* a `Dictionary<string, ModuleSettings>` bound from the
`"Modules"` section
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
[`DataSourceEntrySettings`](#datasourceentrysettings), the logical-to-physical source map for
database-per-service, built *directly* from `Get<Dictionary<...>>` rather than through the options
pipeline (`MMCA.Common.Infrastructure/DependencyInjection.cs:68-70`) because a root-level dictionary
section does not bind that way, with a constructor that rejects a reserved `"Default"` key
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:34-39`);
[`MessageBusSettings`](#messagebussettings) and its [`MessageBusProvider`](#messagebusprovider) enum
(`InProcess` / `RabbitMq` / `AzureServiceBus`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:68-84`) that
`AddBrokerMessaging` switches on, short-circuiting entirely for `InProcess`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:418-421`) and otherwise `Replace`-ing both
[`IMessageBus`](group-04-events-outbox.md#imessagebus) and
[`IEventBus`](group-04-events-outbox.md#ieventbus) with their broker-backed counterparts
(`DependencyInjection.cs:438-444`); [`OutboxSettings`](#outboxsettings) (batch size, polling and
processing intervals, lease, retry backoff, retention) consumed by the
[`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor);
[`PersistenceSettings`](#persistencesettings), whose single `CommandTimeoutSeconds` defaults to the 30
seconds the framework applied implicitly before the section existed
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:21-22`); the
JWT/JWKS group ([`JwtSettings`](#jwtsettings) with its algorithm-aware `IValidatableObject.Validate`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:51-66`, the
[`JwtSigningAlgorithm`](#jwtsigningalgorithm) enum, the [`IJwtSettings`](#ijwtsettings) abstraction, and
[`JwksSettings`](#jwkssettings), whose `Enabled` defaults to `false` so an HMAC-only deployment does not
start advertising a key set by accident,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwksSettings.cs:26`); and the delivery
channels, [`SmtpSettings`](#smtpsettings), [`PushNotificationSettings`](#pushnotificationsettings),
[`NativePushSettings`](#nativepushsettings)
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) and
[`FileStorageSettings`](#filestoragesettings)
([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)). The last
two follow a different discipline on purpose: their `Add*` methods bind the section and then **no-op**
when it is disabled or incomplete (`MMCA.Common.Infrastructure/DependencyInjection.cs:330-336` and
`:362-373`), so a host registers them unconditionally and a deployment switches the channel on by
configuration alone. One binding is deliberately elsewhere: `JwtSettings` is bound by the API layer's
`AddCommonAuthentication`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:318-321`),
while Infrastructure only registers the `IJwtSettings` facade over the resulting options
(`MMCA.Common.Infrastructure/DependencyInjection.cs:58`), so a host that skips authentication never
pays for a JWT section it does not have.

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
and Store each own an Identity module, and four of their account use cases had drifted into
line-identical copies, so the workflow was hoisted into abstract bases that each app subclasses:
[`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23`),
[`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21`),
and [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38`),
the erasure workflow behind
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html). Each base is generic in
the app's `User` aggregate and in the app's own command record, and reads that record only through the
small contracts in this group: [`IUserScopedRequest`](#iuserscopedrequest) (`UserId`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8`),
[`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) (adds the embedded payload,
`IUserScopedCommand.cs:13`), and [`IUserOwnedRequest`](#iuserownedrequest) (adds `CurrentUserId` and
`CurrentUserRole`, `IUserOwnedRequest.cs:8`). The commands stay app-side precisely because the two apps
disagree on their pipeline attributes: ADC marks the password-change command `ICacheInvalidating` and
Store does not (`ChangePasswordHandlerBase.cs:16-21`). Around that sit the small shared pieces:
[`UserOwnershipRule`](#userownershiprule)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21`), the owner-or-privileged-role
decision returning a `Forbidden` [`Error`](group-01-result-error-handling.md#error) or `null`
(`UserOwnershipRule.cs:38-54`) with the privileged-role test passed in already evaluated because each
app owns its own role vocabulary; [`UserUseCaseLog`](#userusecaselog)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:11`), a
non-generic `[LoggerMessage]` holder so every subclass emits identical text while the log category still
comes from the subclass's own `ILogger<T>`;
[`SoftDeletedUserValidator<TUser>`](#softdeleteduservalidatortuser)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19`), which answers [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) with one
query-filter-bypassing `ExistsAsync` (`SoftDeletedUserValidator.cs:30-33`); and
[`GetUserPreferencesQuery`](#getuserpreferencesquery)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`),
the one request record that *was*
byte-identical in both apps and so became shared. `[Rubric §16, Maintainability]` and `[Rubric §1,
SOLID]` are the categories here: the variation points are explicit generic parameters and `protected
virtual` hooks, so an app extends behavior without forking the workflow.

## End-to-end: one host's boot

Reading `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs` top to bottom shows the whole
chapter cooperating. The host binds and validates [`ApplicationSettings`](#applicationsettings) and
also reads the section eagerly for the value it must pass around (`Program.cs:153-159`), calls
`AddApplication()` then `AddInfrastructure(builder.Configuration)` (`Program.cs:269-270`), binds
[`ModulesSettings`](#modulessettings) and calls `AddAPI(modulesSettings)` (`Program.cs:273-282`), then
constructs a [`ModuleLoader`](#moduleloader) with a Serilog-backed logger and calls
`DiscoverAndRegister(services, configuration, applicationSettings, modulesSettings, environmentName)`
before registering the loader as a singleton (`Program.cs:287-293`). Because this is the *Conference*
service, only the Conference module is `Enabled` in its configuration; every other discovered module
takes the `RegisterDisabledStubs` path. The host then patches the cross-process edges: it replaces the
disabled Engagement stub with a real gRPC client (`AddEngagementBookmarkCountClient()`,
`Program.cs:303`) and calls `AddBrokerMessaging(builder.Configuration, ...)` (`Program.cs:320-321`) so
[`MessageBusSettings`](#messagebussettings) `Provider` decides whether
[`IMessageBus`](group-04-events-outbox.md#imessagebus) stays in-process or becomes the
MassTransit-backed broker. Only then comes `AddApplicationDecorators()` (`Program.cs:323`), last, so
the decorators wrap the now-registered Conference handlers. Finally
`app.Services.InitializeDatabaseAsync(applicationSettings, moduleLoader)` (`Program.cs:344`) applies
migrations and runs the module seeders the loader collected. The exact same module assemblies, dropped
into a monolith host with every module `Enabled`, would Kahn-sort into one in-process graph with no
gRPC clients, which is precisely the reversibility
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) is after.

### AssemblyReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the assembly that contains it plus that assembly's simple name, for use as a stable anchor when something needs to say *"scan the assembly this type lives in."* This section covers the **Application-layer** copy; the framework ships a byte-identical copy in every layer package, and the Domain and Infrastructure copies get their own sections in this chapter.

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, and that purity is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems are solved with recognised patterns; the marker (or anchor) type is the idiomatic way to hand an `Assembly` to a scanner without coupling to an incidental concrete class. `[Rubric §1, SOLID]` (DIP): registration code depends on a deliberate, meaningless token rather than on `typeof(SomeRandomHandler).Assembly`, so renaming or moving any real type never breaks the scan. Repeating the identical `AssemblyReference` + [`ClassReference`](#classreference) pair in every package keeps each assembly self-describing with no cross-layer reference at all.

- **Walkthrough**: two `public static readonly` fields resolved once at type-initialization. `Assembly` is `typeof(AssemblyReference).Assembly` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:7`); `AssemblyName` is `Assembly.GetName().Name` with a `?? string.Empty` null-coalescing fallback (`AssemblyReference.cs:8`), so the field is never null even if the runtime reports no simple name. The Application copy carries no XML doc; the Domain copy documents the same two fields as existing "for Scrutor assembly-scanning registration and architecture tests" (`MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:5-6`).

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and one per package means an assembly can be named without referencing anything inside it. The per-module Application assemblies follow the same convention (see the module copies in [group-22](group-22-engagement-module.md#assemblyreference) and [group-23](group-24-identity-module.md#assemblyreference)).

- **Where it's used**: as the assembly source for Scrutor scans and FluentValidation discovery, usually through its non-static companion (next section) because those helpers are generic.

- **Caveats / not-in-source**: the architecture-fitness map does **not** route through `AssemblyReference` for this layer. `CommonArchitectureMap` pins one anchor type per package, and for six of the seven layers that anchor is a real type (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`); only the UI layer uses a dedicated marker, `UISharedAssemblyReference` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:21-27`).

---

### ClassReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference): an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern introduced under [`AssemblyReference`](#assemblyreference). C# **static classes cannot be used as generic type arguments**, and several registration helpers are constrained to an instantiable reference type, notably [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection), whose `where TAssemblyMarker : class` constraint (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:115`) forbids a static type. `ClassReference` fills that slot without weakening `AssemblyReference`'s static-ness. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token (`ScanModuleApplicationServices<ClassReference>()`) is the entire registration ceremony a new module needs.

- **Walkthrough**: a single body-less type declaration, `public class ClassReference;` (`MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11`). No members. Its only meaningful property is the assembly it belongs to, read by the scanner through `typeof(TAssemblyMarker).Assembly` (`DependencyInjection.cs:159`) or Scrutor's `FromAssemblyOf<TAssemblyMarker>()`.

- **Why it's built this way**: keeping a separate non-static anchor sidesteps the static-class generic-argument restriction while leaving `AssemblyReference` static (and therefore impossible to instantiate accidentally). Every module's Application assembly defines its own `ClassReference`, so each module scans itself by passing its local copy.

- **Where it's used**: as the `TAssemblyMarker` argument in [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection); the three ADC module composition roots all call `services.ScanModuleApplicationServices<ClassReference>()` with their own local copy (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:39`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:106`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:71`). The framework root [`AddApplication()`](#dependencyinjection) passes the Application-layer copy to `AddValidatorsFromAssemblyContaining<ClassReference>()` (`DependencyInjection.cs:39`).

---

### IApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/IApplicationSettings.cs:7` · Level 0 · interface

- **What it is**: a cross-cutting settings *contract* with three global knobs: `UseMiniProfiler` (enables MiniProfiler tracing), `MaxPageSize` (the upper bound the API applies to list queries), and `DatabaseInitStrategy` (`"Migrate"` | `"EnsureCreated"` | `"None"`).

- **Depends on**: BCL only. Implemented by [`ApplicationSettings`](#applicationsettings) (Level 1).

- **Concept introduced, typed settings interfaces over raw `IConfiguration`.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether configuration is centralised and typed rather than read as magic-string keys all over the codebase. Instead of injecting `IConfiguration`, the Application layer declares a typed contract, the concrete class implements it, and the composition root registers the bridge. Services depend on `IApplicationSettings`, which makes settings trivially stubbable in tests and resolvable as a singleton. `[Rubric §8, Data Architecture]` shows up in the third knob: the XML doc (`IApplicationSettings.cs:15-22`) enumerates the three accepted strings, and `"None"` is the production setting that *fails startup* when the schema is behind rather than silently migrating it.

- **Walkthrough**: three `{ get; init; }` members: `UseMiniProfiler` (`IApplicationSettings.cs:10`), `MaxPageSize` (`:13`), `DatabaseInitStrategy` (`:23`). `init`-only accessors mean the binder sets them once at startup and the object is immutable afterwards, which is what makes the singleton registration safe.

- **Why it's built this way**: separating the interface (Application layer) from the concrete class lets higher layers inject the abstraction while only the composition root knows the implementation, the dependency-inversion shape the primer describes for ports and adapters ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

- **Where it's used**: registered by [`AddApplication()`](#dependencyinjection) as `TryAddSingleton<IApplicationSettings>(sp => sp.GetRequiredService<IOptions<ApplicationSettings>>().Value)` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:30`). Each knob has a distinct consumer: `MaxPageSize` is read by `EntityControllerBase` and clamps every paged request with `Math.Min(pageSize, MaxPageSize)` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:50-55`, `:127`); `UseMiniProfiler` gates the MiniProfiler wiring (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:18`) and the profiling repository wrappers (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:33`, `:57`); `DatabaseInitStrategy` drives the startup switch in [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:70-85`), where an unrecognised value throws with the list of valid ones.

---

### IModuleSeeder
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8` · Level 0 · interface

- **What it is**: the Application-layer contract for seeding a module's initial data at startup. `ModuleName` declares ownership and `SeedAsync` receives an `IServiceProvider` so the seeder can resolve whatever it needs. Implementations are auto-discovered by [`ModuleLoader`](#moduleloader) and run, in module-dependency order, after every module has registered.

- **Depends on**: BCL only (`Task`, `IServiceProvider`, `CancellationToken`).

- **Concept introduced, seeding at the right layer.** `[Rubric §3, Clean Architecture]` assesses whether each concern lives in the layer that owns it. An *Application* seeder populates data through service interfaces and never touches a `DbContext`; a seeder that genuinely needs direct EF access implements the Infrastructure-layer [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder) instead. The `IServiceProvider` parameter is deliberate: the loader holds the seeder for the lifetime of composition, so passing the provider (rather than a concrete scoped dependency) is what lets the caller control scoping. `[Rubric §7, Microservices Readiness]`: seeding is a **separate** contract from [`IModule`](#imodule), so a module that needs no reference data implements nothing extra, and an extracted service seeds only its own module.

- **Walkthrough**: `string ModuleName { get; }` (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:13`) must match the corresponding [`IModule.Name`](#imodule) so the loader can correlate a seeder to its module and keep it in topological position; `Task SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)` (`:18`) is the single work method, and the XML doc states it is called only for enabled modules (`:16`).

- **Where it's used**: discovered by [`ModuleLoader.DiscoverAndRegister`](#moduleloader) into a case-insensitive dictionary keyed by `ModuleName` (`ModuleLoader.cs:106-109`) and kept only when the matching module is enabled (`ModuleLoader.cs:133-136`). The actual invocation happens at host startup: [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) calls `moduleLoader.SeedAllAsync(scope.ServiceProvider, cancellationToken)` after schema initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:87`).

---

### IUserScopedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedRequest.cs:8` · Level 0 · interface

- **What it is**: a one-member shape interface saying "this command or query targets a single user account". It exposes exactly `UserIdentifierType UserId { get; }` and nothing else.

- **Depends on**: the solution-wide identifier alias `UserIdentifierType` (`global using UserIdentifierType = int;` in `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`, the convention recorded in [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)). Nothing else, first-party or external.

- **Concept introduced, shape interfaces instead of shared request records.** `[Rubric §1, SOLID]` assesses interface segregation and dependency inversion together, and this is the smallest possible instance of both: the shared Users use-case bases in this framework need one fact about the incoming message (which account it addresses), so that fact, and only that fact, becomes the contract. The XML doc states the motivation directly (`IUserScopedRequest.cs:3-7`): each app keeps its own command or query record, with its own `ICacheInvalidating` choice and its own docs, and simply adds this interface. `[Rubric §16, Maintainability]`: hoisting the *behavior* into a base class while leaving the *record* app-side is what let ADC and Store share the handlers without either app losing a per-app pipeline decision. Compare [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), which is the same technique used one layer up to select decorator behavior.

- **Walkthrough**: a single interface with a single get-only property (`IUserScopedRequest.cs:11`). There is no base interface and no default member, so implementing it is free for a `record` that already has a `UserId` positional parameter.

- **Where it's used**: extended by [`IUserOwnedRequest`](#iuserownedrequest) and [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) (both Level 1 in this chapter). Implemented directly by the one shared query record in the framework, [`GetUserPreferencesQuery`](#getuserpreferencesquery) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5`).

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

### UserUseCaseLog
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserUseCaseLog.cs:11` · Level 0 · class (internal static partial)

- **What it is**: a non-generic holder for the three compile-time-generated log messages emitted by the shared Users use-case bases: password changed, preferences changed, and account erased.

- **Depends on**: `Microsoft.Extensions.Logging` (`ILogger`, `[LoggerMessage]`) and the `UserIdentifierType` alias. No first-party types.

- **Concept introduced, source-generated logging in a non-generic holder.** `[Rubric §13, Observability and Operability]` assesses whether diagnostics are structured, cheap, and consistent. `[LoggerMessage]` is a Roslyn source generator: it emits a strongly typed, allocation-free `Log` call with a pre-compiled message template, so nothing is boxed or formatted when the level is disabled. The subtle part is *where* the methods live. Putting them on a generic base class would produce one generated logger per closed generic type; declaring them once in a plain static holder means every app subclass writes the identical message text, while the **log category** still comes from the `ILogger<THandler>` the subclass injects, so filtering by handler behaves exactly as it did before the shared bases existed (`UserUseCaseLog.cs:5-10`). `[Rubric §16, Maintainability]`: one place to change the wording of a security-relevant event.

- **Walkthrough**: three `internal static partial void` declarations, each attributed with a level and a template. `PasswordChanged` at `Information`, message `"User {UserId} password changed"` (`UserUseCaseLog.cs:13-14`); `PreferencesChanged` at `Information` (`:16-17`); `UserErased` at `Information`, message `"User {UserId} account deleted and personal data anonymized"` (`:19-20`). Every method takes the `ILogger` as its first parameter, which is what lets a generic base pass its own injected logger into a non-generic holder. The class is `internal`, so it is not part of the package's public surface.

- **Why it's built this way**: the wording of `UserErased` records the erasure model rather than a hard delete, which is the framework default recorded in [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html): the row survives soft-deleted while the personal fields are anonymized.

- **Where it's used**: [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) calls `UserUseCaseLog.PasswordChanged(logger, command.UserId)` after a successful save (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:66`); [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) calls `PreferencesChanged` (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:59`); [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) calls `UserErased` (`.../DeleteUser/DeleteUserHandlerBase.cs:116`).

---

### ApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:6` · Level 1 · class (sealed)

- **What it is**: the concrete global-settings class bound from the `"ApplicationSettings"` configuration section. It implements [`IApplicationSettings`](#iapplicationsettings) and supplies the defaults.

- **Depends on**: [`IApplicationSettings`](#iapplicationsettings) (Level 0, the interface it implements). BCL only otherwise.

- **Concept introduced, options-pattern settings classes.** `[Rubric §10, Cross-Cutting Concerns]` assesses centralised, typed configuration rather than per-service copy-paste. Every settings class in the framework follows the same shape: a `static readonly string SectionName` names its configuration section (so `Configure<ApplicationSettings>(config.GetSection(ApplicationSettings.SectionName))` avoids a magic string), and `init` properties capture the bound values so the object is immutable after startup. `ApplicationSettings` is the simplest exemplar: pure binding plus defaults, with no validation attributes.

- **Walkthrough**: `SectionName = "ApplicationSettings"` (`ApplicationSettings.cs:9`); three `init` properties carrying `<inheritdoc />` from the interface, `UseMiniProfiler` with the implicit `false` default (`:12`), `MaxPageSize = 500` (`:15`), and `DatabaseInitStrategy = "Migrate"` (`:18`). Because the implemented interface is Level 0, this concrete class lands at Level 1.

- **Why it's built this way**: `static SectionName` keeps registration DRY, and `init` immutability makes the bound instance safe to share as the singleton [`AddApplication()`](#dependencyinjection) registers it as.

- **Where it's used**: passed **by value** into every [`IModule.Register(services, configuration, applicationSettings)`](#imodule) call (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:28`), so a module reads global settings without resolving anything from the container; handed to [`ModuleLoader.DiscoverAndRegister`](#moduleloader) by each ADC service host (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:292`).

---

### IUserOwnedRequest
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus the authenticated caller. It adds `CurrentUserId` and the caller's (nullable) role claim, which is exactly the input the shared owner-or-privileged-role check needs.

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface); the `UserIdentifierType` alias.

- **Concept introduced, carrying the caller inside the message.** `[Rubric §11, Security]` assesses whether authorization decisions are made deliberately and consistently rather than ad hoc. In this codebase, resource-ownership authorization exists on two levels. At the API level it is an action filter and a specification ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html), `OwnerOrAdminFilter` / `OwnershipHelper`). At the handler level it is this interface plus [`UserOwnershipRule`](#userownershiprule): the controller projects the caller's claims into the command, and the handler decides. Putting the caller *in the message* rather than injecting `ICurrentUserService` into the handler keeps the handler a pure function of its input, which is what makes the shared bases unit-testable without an HTTP context (`[Rubric §14, Testability]`).

- **Walkthrough**: two added members. `UserIdentifierType CurrentUserId { get; }` (`IUserOwnedRequest.cs:11`) is the authenticated caller. `string? CurrentUserRole { get; }` (`:14`) is the role claim, explicitly nullable because a token may carry no role at all. `UserId` is inherited from the base interface, so an implementing record must expose both the target and the caller.

- **Why it's built this way**: the XML doc names the goal (`IUserOwnedRequest.cs:3-7`), a single uniformly applied owner-or-privileged-role check across the account-deletion and data-export use cases in both apps. The role itself is deliberately *not* interpreted here: each app owns its own role vocabulary, so the interface carries the raw claim string and the rule takes the already-evaluated boolean.

- **Where it's used**: the type constraint on [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) (`where TCommand : IUserOwnedRequest`, `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:42`) and the parameter type of [`UserOwnershipRule.CheckOwnership`](#userownershiprule). Implemented by each app's own delete command: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:14` (which also marks itself `ICacheInvalidating`) and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:17`.

---

### IUserScopedCommand<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:13` · Level 1 · interface

- **What it is**: [`IUserScopedRequest`](#iuserscopedrequest) plus an embedded request payload. A command implementing it says "I target this user, and here is the DTO the caller sent".

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (Level 0, its base interface).

- **Concept, covariant shape interfaces and the deliberate non-overlap with `ICommandWithRequest<TRequest>`.** The type parameter is declared `out TRequest` (`IUserScopedCommand.cs:13`), so `IUserScopedCommand<DerivedRequest>` is usable where `IUserScopedCommand<BaseRequest>` is expected. The more instructive part is the XML doc's warning (`:6-11`): this interface is **deliberately separate** from [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), even though both expose a `Request` property, because `ICommandWithRequest` *also* opts the command into automatic [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) registration (see [`ScanModuleApplicationServices`](#dependencyinjection)). That is a per-app decision: ADC and Store agree on it for the password change and disagree on it for preferences. A command may implement both; implementing this one alone changes no pipeline behavior. `[Rubric §1, SOLID]`: two interfaces because there are two responsibilities, shape versus pipeline opt-in, even though they would collapse neatly into one.

- **Walkthrough**: one added member, `TRequest Request { get; }` (`IUserScopedCommand.cs:16`), on top of the inherited `UserId`.

- **Why it's built this way**: the split is what lets a single shared handler base read any app's command uniformly while each app keeps its own validation and cache-invalidation posture. Store's change-password command implements both interfaces (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:13`) while its preferences command implements only this one (`.../ChangePreferences/ChangePreferencesCommand.cs:12`); ADC's equivalents add `ICacheInvalidating` on top (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15`, `.../ChangePreferences/ChangePreferencesCommand.cs:15`).

- **Where it's used**: the constraint on [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:29`) and [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand) (`.../ChangePreferences/ChangePreferencesHandlerBase.cs:27`), and the two constraints on [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:47-48`), where the base reads the app-supplied command back only through this interface.

---

### ModulesSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7` · Level 1 · class (sealed)

- **What it is**: a `Dictionary<string, ModuleSettings>` subclass bound from the `"Modules"` configuration section, with two helper methods over the map: `IsModuleEnabled(moduleName)` and `IsDependencyRemote(consumerModule, dependencyModule)`.

- **Depends on**: [`ModuleSettings`](#modulesettings) (Level 0, the entry/value type).

- **Concept**: the same [options-pattern](#applicationsettings) shape, but realised by *subclassing the dictionary* so `appsettings.json` can express an arbitrary map of module name to settings without a hand-written model class per module. `[Rubric §7, Microservices Readiness]`: `IsDependencyRemote` is the extracted-service hook, and when a module's dependency is met by a remote service rather than an in-process module, it returns true and [`ModuleLoader`](#moduleloader) treats the dependency as satisfied.

- **Walkthrough**: `SectionName = "Modules"` (`ModulesSettings.cs:10`). `IsModuleEnabled` (`:18-19`) is `TryGetValue` followed by `settings.Enabled`, so a module *absent* from configuration is treated as **disabled**, not enabled, which the XML doc states explicitly (`:14`). `IsDependencyRemote` (`:30-32`) does `TryGetValue` for the consumer, then `settings.RemoteDependencies.Contains(dependencyModule, StringComparer.OrdinalIgnoreCase)`, case-insensitive so deployment configuration need not match casing exactly.

- **Where it's used**: consumed by [`ModuleLoader`](#moduleloader) for both the enable check and the remote-dependency bypass (`ModuleLoader.cs:116`, `:147`, `:151`, `:228`), and by [`ModuleControllerFeatureProvider`](group-12-api-hosting-mapping.md#modulecontrollerfeatureprovider) in the API layer to restrict which module controllers are discovered.

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

### UserOwnershipRule
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UserOwnershipRule.cs:21` · Level 2 · class (static)

- **What it is**: a single static method encoding the self-service authorization rule shared by every use case that acts on one account on behalf of its owner: the caller must be the account owner, or hold the app's privileged role. It returns `null` when allowed and a ready-made [`Error`](group-01-result-error-handling.md#error) when not.

- **Depends on**: [`IUserOwnedRequest`](#iuserownedrequest) (Level 1, the parameter type), [`Error`](group-01-result-error-handling.md#error) and [`ErrorType`](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions` (`UserOwnershipRule.cs:1`).

- **Concept introduced, the "return the error, do not throw" authorization helper.** `[Rubric §11, Security]` assesses whether authorization is uniform and auditable. The idiom being hoisted here (caller is not the owner and has no bypass role, therefore forbidden) had been written out four times across the two apps, in account deletion and data export in each, which the XML doc records as the motivation (`UserOwnershipRule.cs:9-14`). `[Rubric §2, Design Patterns]`: it is deliberately a **plain static helper**, not a base class or a decorator, because the data-export handlers stay app-level (their projections are entirely app-specific) yet still need the identical decision and the identical error shape. `[Rubric §1, SOLID]`: the role test arrives **already evaluated** as a `bool`, so the helper never learns either app's role vocabulary (`UserRole.IsOrganizer` in ADC versus `UserRole.IsAdmin` in Store). This is the Application-layer counterpart to the API-layer ownership axis of [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html); that ADR records the filter and specification forms and does not name this helper.

- **Walkthrough**: one method, `static Error? CheckOwnership(IUserOwnedRequest request, bool callerHasPrivilegedRole, string code, string message, string source)` (`UserOwnershipRule.cs:38-43`). It guards the argument with `ArgumentNullException.ThrowIfNull(request)` (`:45`), then evaluates a single conditional expression: if `request.CurrentUserId == request.UserId || callerHasPrivilegedRole`, return `null` (allowed); otherwise return `Error.Forbidden(...)` with the caller-supplied `code`, `message`, and `source`, and with `target` fixed to `nameof(IUserOwnedRequest.UserId)` (`:47-53`). Fixing the target while parameterising code, message, and source is what keeps the error payload identical to the four hand-written copies it replaced, since each of those reported its own handler name as the source.

- **Why it's built this way**: returning `Error?` rather than throwing keeps the caller on the framework's [Result pattern](group-01-result-error-handling.md#error) ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)): the handler wraps it as `Result.Failure(forbidden)` and the API layer maps it to 403 through the usual error mapping, with no exception unwinding on an expected authorization outcome.

- **Where it's used**: [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) calls it first thing in `HandleAsync`, passing `HasDeletePrivilege(command.CurrentUserRole)`, the code `"User.DeleteForbidden"`, and its own `HandlerName` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:62-71`).

- **Caveats / not-in-source**: the XML doc names data export as the other use case the rule was hoisted for, but no export handler calls it today. ADC's `ExportUserDataHandler` still performs the equivalent check inline (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:38-45`), so the only production caller in source right now is the delete base above.

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
  - **`RegisterEnabledModule`** (`:175`): before calling `module.Register`, it adds the conventional per-module JSON configuration files `modules.{name}.json` and, when an environment name was supplied, `modules.{name}.{environment}.json`, both optional and `reloadOnChange: true` (`:186-193`); the name is lower-cased with `ToLowerInvariant` under a documented `CA1308` suppression for the file-naming convention (`:186-188`). It times the `Register` call with a `Stopwatch` and logs the elapsed milliseconds (`:195-199`).
  - **`ValidateRemoteDependencies`** (`:216`): the post-build half of the extraction story. Given the built root provider, it creates a scope (`:223`) and, for every enabled module and every dependency that module declared remote, looks up the descriptors the disabled peer's stubs added and calls `ValidateRemoteDependencyStubs` (`:225-237`). That helper (`:240`) skips open generics, resolves each stub's `ServiceType`, and **throws** with a remediation message if it does not resolve at all (`:248-253`); if it resolves but is still the stub implementation type, it only logs a warning (`:255-259`), because a best-effort dependency may intentionally keep its stub. Configuration trust alone is not enough: a typo in a `RemoteDependencies` entry or a forgotten `AddTypedGrpcClient` would otherwise surface as a first-request failure or a silent no-op instead of at startup (`:202-215`).
  - **`SeedAllAsync`** (`:270`): awaits each collected seeder's `SeedAsync` in registration (that is, topological) order, with `ConfigureAwait(false)` (`:272-275`).
  - **`TopologicalSort`** (`:286`): builds `modulesByName`, `inDegree`, and a reverse-adjacency `dependents` map, all `OrdinalIgnoreCase` (`:288-294`); while building the graph it **ignores dependencies on modules that were not discovered** (`:301-302`), deferring those to registration-time validation. It seeds a `Queue<string>` with the zero-in-degree modules (`:310-311`) and drains it, decrementing each dependent's in-degree and enqueuing at zero (`:314-325`). If fewer modules were emitted than exist, the remainder form a cycle, and it throws `InvalidOperationException` naming them (`:328-333`).

- **Why it's built this way**: convention over configuration. Discovery plus sort means no manual ordering and no module-registration list to keep in sync, which is the decision recorded in [ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) (a disabled module is represented by **stub registrations** rather than by absence, so a dependent always resolves something).

- **Where it's used**: constructed directly in each service host's composition root, with a real logger attached through the `init` property, then handed the configuration builder, settings, and environment name. All four ADC services do this identically (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:288-292` and `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:236-240`), as do Store's three (for example `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:210-214`). Each of those hosts enables exactly one module in configuration; a monolith host would discover and register all of them through the same loader.

- **Caveats / not-in-source**: two capabilities exist but have no production caller today. Every ADC and Store host calls the five-parameter `DiscoverAndRegister` (the AppDomain scan), not the explicit-assemblies overload its own XML doc recommends. And `ValidateRemoteDependencies` is exercised only by `ModuleLoaderTests` (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:132`, `:145`, `:159`); no `Program.cs` in this workspace calls it after `builder.Build()`.

---

### SoftDeletedUserValidator<TUser>
> MMCA.Common.Application · `MMCA.Common.Application.Users` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19` · Level 8 · class (sealed, generic)

- **What it is**: the one shared implementation of [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator). It answers a single question, "does a row for this user exist **and** is it soft-deleted", in one query that deliberately bypasses the global soft-delete query filter.

- **Depends on**: [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (the interface it implements, from `MMCA.Common.Application.Interfaces.Infrastructure`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (injected via primary constructor), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (obtained from the unit of work), and [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TUser` constraint. Its Level 8 position is inherited from that repository/unit-of-work chain, not from any complexity of its own.

- **Concept introduced, closing a generic over the app's aggregate instead of subclassing.** `[Rubric §11, Security]` assesses whether a revoked principal actually loses access: stateless JWT means a token stays valid until it expires, so [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) (BR-133) adds a middleware that rejects an authenticated caller whose account has since been soft-deleted, and this class is the lookup behind it. `[Rubric §8, Data Architecture]`: the check must see rows the rest of the application cannot, so it passes `ignoreQueryFilters: true` to punch through the soft-delete global filter for this one predicate. `[Rubric §16, Maintainability]`: because the type is generic over `TUser` rather than abstract, an app supplies only a type argument at registration and needs **no** per-app subclass (`SoftDeletedUserValidator.cs:11-17`).

- **Walkthrough**: a primary-constructor class taking `IUnitOfWork unitOfWork`, constrained `where TUser : AuditableAggregateRootEntity<UserIdentifierType>` (`SoftDeletedUserValidator.cs:19-20`). The single method `IsUserSoftDeletedAsync(UserIdentifierType userId, CancellationToken)` (`:23-25`) resolves the repository through `unitOfWork.GetRepository<TUser, UserIdentifierType>()` (`:27`), then returns `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, cancellationToken)` with `ConfigureAwait(false)` (`:30-33`). Note it is `GetRepository` off the unit of work rather than a constructor-injected `IRepository<,>`, which is the framework-wide rule for repository access, and the predicate is written against the open type parameter but closes over the concrete entity at run time, so EF translates it exactly as a hand-written app query would.

- **Why it's built this way**: one query answers both halves of the question (exists and is deleted), so the middleware pays a single round trip and cannot mistake "unknown user" for "deleted user". Expressing the predicate against `TUser` keeps the framework free of any reference to an app's `User` aggregate while still producing a fully translated EF query.

- **Where it's used**: registered per app, closed over that app's `User` aggregate: `services.TryAddScoped<ISoftDeletedUserValidator, SoftDeletedUserValidator<User>>()` in `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:34` and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:41`. The consumer is [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware), which resolves the interface **lazily** per request via `context.RequestServices.GetService<ISoftDeletedUserValidator>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:75`), so a host that registers no validator degrades to a no-op instead of failing.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:20` · Level 9 · class (static, C# `extension(IServiceCollection)`)

- **What it is**: the composition-root extension class that assembles the framework's entire Application layer into the DI container. It exposes four `IServiceCollection` extension methods: `AddApplication()`, `AddApplicationDecorators()`, `ScanModuleApplicationServices<TAssemblyMarker>()`, and `AddApplicationProfiling()`. Every consuming host calls these, in a specific order, before wiring Infrastructure.

- **Depends on**: the core singletons `IDomainEventDispatcher` / [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline); the settings bridge [`IApplicationSettings`](#iapplicationsettings) over [`ApplicationSettings`](#applicationsettings); the marker [`ClassReference`](#classreference); the open-generic handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the five command decorators [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult), [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult), [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult), [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult); the three query decorators [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult), [`FeatureGateQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult); the optional [`ProfilingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#profilingcommanddecoratortcommand-tresult) and [`ProfilingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#profilingquerydecoratortquery-tresult); the scanned contract families [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype); and the request-validator bridge [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest). Externals: **FluentValidation** (`AddValidatorsFromAssemblyContaining`, `IValidator<>`), **Scrutor** (`Scan`, `TryDecorate`), `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAdd*`), `Microsoft.Extensions.Options`.

- **Concept introduced, the CQRS decorator pipeline wiring order (Scrutor `TryDecorate`).** `[Rubric §6, CQRS and Event-Driven]` assesses whether cross-cutting handler concerns are applied uniformly; `[Rubric §2, Design Patterns]` covers the Decorator pattern itself (the individual decorators are taught in [group-05](group-05-cqrs-pipeline.md)). **Scrutor's `TryDecorate` applies decorators in reverse registration order**: the *last* registered call becomes the *outermost* wrapper. `AddApplicationDecorators` (`DependencyInjection.cs:88`) registers the five command decorators in source order Transactional, Validating, Caching, Logging, FeatureGate (`:93-97`), which produces the execution nesting its own XML doc draws (`:52-60`):

  ```
  FeatureGateCommandDecorator        (outermost, short-circuits if the feature flag is off)
    -> LoggingCommandDecorator       (measures full pipeline duration of enabled features)
      -> CachingCommandDecorator     (invalidates cache only AFTER the transaction commits)
        -> ValidatingCommandDecorator (short-circuits with Result.Failure before any transaction)
          -> TransactionalCommandDecorator (wraps the handler in a DB transaction if ITransactional)
            -> ConcreteHandler       (the actual business logic)
  ```

  Queries get the lighter three-deep chain FeatureGate, Logging, Caching, handler (`:100-102`), with no validation and no transaction because queries do not mutate. This file is the one place where the register-order versus execute-order inversion has to be held in mind, and the comments on each line say so. The ordering is not arbitrary; the XML doc's design rationale (`:71-85`) gives the reasons: feature gating is outermost so disabled features cost nothing, logging sits inside it so it measures only enabled executions, validation sits *outside* the transaction so malformed commands never open one, cache invalidation sits *outside* validation so cache is cleared only after a valid committed mutation, a business `Result.IsFailure` rolls the transaction back and skips invalidation, and an exception rolls back and propagates through every decorator. The same order is the decision recorded in [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).

- **Concept introduced, `ScanModuleApplicationServices<TAssemblyMarker>()`, the convention scanner.** `[Rubric §5, Vertical Slice]` (one call wires a whole module's slice types) and `[Rubric §14, Testability]` (handler registration is reproducible in a test host with the same one call). Lines `:118-155` run **seven passes** over the single marker assembly, each with a deliberate lifetime: domain event handlers (`IDomainEventHandler<>`, **singleton**, because they create their own scopes, `:117-122`), integration event handlers (`IIntegrationEventHandler<>`, **singleton**, `:125-129`), DTO mappers (`IEntityDTOMapper<,,>`, **scoped**, registered `AsSelfWithInterfaces`, `:131-135`), request mappers (`IEntityRequestMapper<,,>`, **scoped**, `:137-141`), command handlers (`ICommandHandler<,>`, **scoped**, `:143-147`), query handlers (`IQueryHandler<,>`, **scoped**, `:149-153`), and FluentValidation validators (`:155`). After the passes, a reflection loop (`:161-175`) finds every type in the assembly implementing `ICommandWithRequest<TRequest>`, constructs `CommandRequestValidator<TCommand, TRequest>` and `IValidator<TCommand>` with `MakeGenericType`, and `TryAddTransient`s the pair (`:170-174`), so a command that embeds its own request DTO gets a bridging validator for free. `TryAdd` is load-bearing here: an explicit `IValidator<TCommand>` picked up by the earlier `AddValidatorsFromAssemblyContaining` pass always wins.

- **Walkthrough**
  - `AddApplication()` (`:28`): `TryAddSingleton` for [`IApplicationSettings`](#iapplicationsettings) resolved from `IOptions<ApplicationSettings>` (`:30`), then `IDomainEventDispatcher`, `INavigationMetadataProvider`, and `IEntityQueryPipeline` (`:32-34`); finally `AddValidatorsFromAssemblyContaining<ClassReference>()` (`:39`) to register the framework's own validators (the comment names `LoginRequestValidator` and `RefreshTokenRequestValidator`), which a module-level scan would never reach because it only scans the module's own assembly (`:36-38`).
  - `AddApplicationDecorators()` (`:88`): the five command plus three query `TryDecorate` calls described above. It **must** run after every module's `ScanModuleApplicationServices` so Scrutor has concrete handlers to wrap, which the XML doc states (`:45-46`) and MMCA.Common `CLAUDE.md` repeats as the one load-bearing ordering rule.
  - `ScanModuleApplicationServices<TAssemblyMarker>()` (`:114`, constrained `where TAssemblyMarker : class` at `:115`): the seven-pass scanner plus the request-validator loop.
  - `AddApplicationProfiling()` (`:185`): optional, `TryDecorate`s `ProfilingCommandDecorator<,>` and `ProfilingQueryDecorator<,>` on top (`:187-188`), for use with `IApplicationSettings.UseMiniProfiler`.

- **Why it's built this way**: `[Rubric §3, Clean Architecture]`: registration lives in a static `DependencyInjection.cs` at the composition root, so domain and Application types never reference the container. The pervasive `TryAdd*` and `TryDecorate` pattern lets a consuming app override any framework default simply by registering its own implementation first. The whole class body is a single `extension(IServiceCollection services)` block (`:22`), the C# preview extension-member syntax the framework uses for all DI registration, see [primer §4](00-primer.md#c-extensiont-types-read-this-once).

- **Where it's used**: called from every consuming host in the canonical sequence, `AddApplication()`, then one `ScanModuleApplicationServices<ClassReference>()` per module (issued from each module's own composition root), then `AddApplicationDecorators()` last. In ADC the two framework calls bracket the module registration in each service's `Program.cs` (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:269` and `:323`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:213` and `:279`), with the [`ModuleLoader`](#moduleloader) call in between.

- **Caveats / not-in-source**: several other classes named `DependencyInjection` exist across the framework and the apps (Infrastructure, API, Grpc, UI, Notifications, and one per module) with the same name but different namespaces and methods. This section covers only the **MMCA.Common.Application root** at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:20`; the others are documented in their own groups.

### AssemblyReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class that exposes the assembly it lives in plus that assembly's simple name. It is the Infrastructure layer's assembly-marker anchor, a deliberate, business-free type whose only job is to name "this assembly" for convention-based scanning.

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, which is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems use recognised patterns; when a registration or test needs "every type in this assembly", handing the scanner a purpose-built anchor (`typeof(AssemblyReference).Assembly`) is the idiomatic form, far more stable than `typeof(SomeRandomHandler).Assembly` pointing at a real class that might move or be renamed. `[Rubric §1, SOLID]` (DIP): registration code depends on a stable, meaningless token rather than a concrete business type, so refactoring real Infrastructure types never breaks a scan. The same shape (`AssemblyReference` + [`ClassReference`](#classreference)) repeats in every layer package (Application, Domain, API, and here in Infrastructure) so each assembly is self-describing without any cross-layer reference.

- **Walkthrough**: two `public static readonly` fields resolved once at type-initialization (`AssemblyReference.cs:7-8`): `Assembly` via `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), and `AssemblyName` via `Assembly.GetName().Name` with a `?? string.Empty` fallback (`AssemblyReference.cs:8`) so the field is never null even when the runtime reports no simple name.

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type, and repeating the identical shape in every package keeps each assembly self-describing without cross-layer references.

- **Where it's used**: the Scrutor entity-configuration scan inside [`DependencyInjection.AddInfrastructure`](#dependencyinjection) uses `FromAssemblyOf<ClassReference>()` (the non-static companion, next); the NetArchTest architecture maps pin this assembly through the same anchor.

---

### ClassReference
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference) in the Infrastructure layer, an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class will not satisfy the constraint.

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern taught under [`AssemblyReference`](#assemblyreference). C# static classes cannot be used as generic type arguments, so any registration helper constrained to an instantiable reference type (for example Scrutor's `FromAssemblyOf<T>()`) is handed `ClassReference` instead of `AssemblyReference`. `[Rubric §33, Developer Experience]` assesses how conventional the inner loop is: one token stands in for "this assembly" everywhere, so a developer wiring a new scan never has to hunt for a suitable real type.

- **Walkthrough**: a single-line body-less type declaration at `AssemblyReference.cs:11` (`public class ClassReference;`). No members.

- **Where it's used**: [`DependencyInjection.AddInfrastructure`](#dependencyinjection) calls `services.Scan(scan => scan.FromAssemblyOf<ClassReference>()...)` (`DependencyInjection.cs:106`) to discover every EF `IEntityTypeConfigurationBase<,>` in the Infrastructure assembly through this anchor.

---

### UseDatabaseAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:22` · Level 0 · class (sealed attribute)

- **What it is**: a declarative attribute placed on an entity type configuration class to name the **logical data source (database)** that entity targets. It is the "which database" half of the database-per-microservice routing story; the sibling [`UseDataSourceAttribute`](#usedatasourceattribute) is the "which engine" half.

- **Depends on**: `System.Attribute` (BCL) only. Its resolved logical name is consumed downstream by the data-source machinery ([`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)) and mapped to a connection string through the `DataSources` configuration entries modelled by [`DataSourceEntrySettings`](#datasourceentrysettings) / [`DataSourcesSettings`](#datasourcessettings).

- **Concept introduced, declarative database-per-service routing.** `[Rubric §8, Data Architecture]` assesses how the model maps to physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The attribute's XML doc (`UseDatabaseAttribute.cs:9-14`) spells out the three-step resolution order for an entity's logical name: (1) this attribute on the concrete configuration class (inherited); (2) the module name derived from the entity namespace, the segment before `Domain`; (3) the literal `"Default"`, the top-level `ConnectionStrings` section. A logical name with no `DataSources` entry (or whose connection string equals the top-level one) collapses onto the `Default` physical source (`UseDatabaseAttribute.cs:15-17`), so a host that configures nothing behaves exactly like a single-database monolith. This "convention with an explicit override" shape is the load-bearing idea: most modules never apply the attribute and ride the namespace convention.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDatabaseAttribute.cs:21`). `Inherited = true` is deliberate: annotating a per-module configuration base class propagates the database assignment to every derived configuration, so a module can pin all its entities to one database in a single place. `AllowMultiple = false` forbids an ambiguous second assignment.
  - Primary-constructor parameter `name` (`UseDatabaseAttribute.cs:22`), the logical name (for example `"Conference"`).
  - `Name` get-only property (`UseDatabaseAttribute.cs:25`) initialized from that parameter, the value the resolver reads.

- **Why it's built this way**: an attribute keeps the database choice declarative and co-located with the entity configuration rather than buried in a registration method, and `Inherited = true` turns per-module assignment into one annotation instead of one per entity ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database per microservice).

- **Where it's used**: applied on concrete EF entity type configuration classes in the modules; read up front by the eager [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) so routing does not depend on a model having been built.

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

- **Where it's used**: constructed by `RedisDistributedLock.TryAcquireAsync` (`RedisDistributedLock.cs:72`). `RedisDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:15`) asserts the acquire/release pairing against a mocked `IDatabase`.

---

### UseDataSourceAttribute
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13` · Level 1 · class (sealed attribute)

- **What it is**: the companion attribute to [`UseDatabaseAttribute`](#usedatabaseattribute). Where that one names the logical database, this one declares the **database engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): `CosmosDB`, `Sqlite`, or SQL Server) an entity type configuration targets. It is Level 1 rather than Level 0 because, unlike the pure-BCL `UseDatabaseAttribute`, it references the first-party `DataSource` enum.

- **Depends on**: the [`DataSource`](group-07-persistence-ef-core.md#datasource) enum (from `MMCA.Common.Application.Interfaces.Infrastructure`, imported at `UseDataSourceAttribute.cs:1`) and `System.Attribute` (BCL).

- **Concept**: engine selection for the multi-engine persistence layer, the sibling of the logical-name routing introduced under [`UseDatabaseAttribute`](#usedatabaseattribute). `[Rubric §8, Data Architecture]` again: the framework supports SQL Server, Cosmos, and SQLite simultaneously, and this attribute is how a configuration announces which engine's rules apply. In practice it is carried on the provider-specific configuration base classes (`EntityTypeConfigurationSQLServer/Cosmos/Sqlite`), so a concrete configuration inherits its engine, while `UseDatabaseAttribute` selects which database on that engine.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDataSourceAttribute.cs:12`), same inheritance and single-use semantics as `UseDatabaseAttribute` so a provider base class propagates the engine to derived configurations.
  - Primary-constructor parameter `dataSource` (`UseDataSourceAttribute.cs:13`) of type [`DataSource`](group-07-persistence-ef-core.md#datasource).
  - `DataSource` get-only property (`UseDataSourceAttribute.cs:16`) exposing the chosen engine. The XML doc (`UseDataSourceAttribute.cs:5-9`) records that it is read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) at model-building time to populate the entity-to-source cache that [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork) uses to route each entity to the correct [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).

- **Why it's built this way**: keeping the engine on an attribute (inherited from a provider base class) means an entity's engine and database are both declarative metadata the registry can scan up front, which is what lets routing happen without first building an EF model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: on the per-engine `EntityTypeConfiguration*` base classes and, through inheritance, every concrete configuration under them; read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) / [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry).

---

### InProcessDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:31` · Level 1 · class (internal, sealed, partial)

- **What it is**: the fallback [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) for a host with no Redis connection registered. It serializes callers inside this one process, and it says so in the log the first time anybody uses it.

- **Depends on**: [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) (the contract it implements, from `MMCA.Common.Application.Interfaces`, imported at `InProcessDistributedLock.cs:4`), `ILogger<InProcessDistributedLock>` injected through the primary constructor (`InProcessDistributedLock.cs:31`), and its own nested [`InProcessLockHandle`](#inprocesslockhandle). BCL: `ConcurrentDictionary`, `Interlocked`, `Stopwatch`, `Task.Delay`.

- **Concept introduced, the degraded implementation that announces itself.** `[Rubric §12, Performance & Scalability]` assesses whether the design survives horizontal scale-out: each replica gets its own instance of this class and therefore its own held-key table, so with more than one replica a section guarded by this lock **still runs once per replica** (`InProcessDistributedLock.cs:12-14`). That is correct for a single-replica deployment, for local development, and for tests, and wrong for anything else, which is why the fallback is not silent. `[Rubric §13, Observability & Operability]` assesses whether an operator can see a degraded mode: the first acquisition emits a `[LoggerMessage]`-generated warning that names both the cause and the fix (`InProcessDistributedLock.cs:75-76`, "no `IConnectionMultiplexer` is registered ... Register a Redis client (`AddRedisClient`) to make it exclusive across replicas").

- **Walkthrough**:
  - **State.** `PollInterval` is 25 ms (`InProcessDistributedLock.cs:34`), the gap between acquisition attempts while waiting for a holder. `_held` is a `ConcurrentDictionary<string, byte>` with `StringComparer.Ordinal` (`InProcessDistributedLock.cs:36`), used as a set: the value byte is a placeholder and only key presence matters. `_degradationWarned` is the warn-once flag (`InProcessDistributedLock.cs:39`).
  - **Guards and the warning.** `TryAcquireAsync` (`InProcessDistributedLock.cs:42-73`) rejects a blank key, a non-positive `ttl`, and a negative `wait` (`InProcessDistributedLock.cs:48-50`), then flips the flag with `Interlocked.Exchange(ref _degradationWarned, 1) == 0` so a steady state warns once rather than per request (`InProcessDistributedLock.cs:52-55`).
  - **The acquire loop** (`InProcessDistributedLock.cs:59-72`). `_held.TryAdd(key, 0)` is the atomic test-and-set: it succeeds only for the caller that inserts the key, and that caller gets an [`InProcessLockHandle`](#inprocesslockhandle) (`InProcessDistributedLock.cs:61-63`). Otherwise, if `Stopwatch.GetElapsedTime(startedAt) >= wait` the method returns `null` (`InProcessDistributedLock.cs:66-69`), which is what makes `wait: TimeSpan.Zero` a single non-blocking attempt exactly as the contract promises. Otherwise it awaits `Task.Delay(PollInterval, cancellationToken)` and retries (`InProcessDistributedLock.cs:71`).
  - **Exact keys, not stripes.** The remarks explain the one design choice that differs from [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (`InProcessDistributedLock.cs:19-24`): stripes let two unrelated keys share a semaphore, which is harmless for a caller that waits indefinitely but not for a *bounded* wait, where the false sharing turns into a spurious "held elsewhere" answer for a key nobody holds. The table stays bounded by the number of locks held right now, not by every key the process has ever seen, because the handle removes the entry on release.
  - **`ttl` is accepted and ignored** (`InProcessDistributedLock.cs:26-29`). It is validated (`InProcessDistributedLock.cs:49`) but never used: the TTL exists to bound a holder that died without releasing, and here the holder is a task in this process, so if the process dies the table dies with it.

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) makes the lock a registration rather than an optional dependency, so a host always resolves *something*; this type is the honest floor of that guarantee. Logging the degradation once, instead of silently behaving like a lock, is what keeps "we have a distributed lock" from becoming a false belief in a multi-replica deployment.

- **Where it's used**: registered by `AddCaching` in the Infrastructure composition root when no `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:192-194`, see [`DependencyInjection`](#dependencyinjection)), which covers MMCA.Helpdesk, local single-process runs, and tests. Behaviour is pinned by `InProcessDistributedLockTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Concurrency/InProcessDistributedLockTests.cs:12`); the selection logic itself is covered in `DependencyInjectionTests`.

---

### RedisDistributedLock
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Concurrency` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:24` · Level 2 · class (internal, sealed, partial)

- **What it is**: the cross-replica [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock), implemented as the standard `SET key token NX PX ttl` Redis lock against a single Redis instance.

- **Depends on**: `IConnectionMultiplexer` and the rest of StackExchange.Redis (`IDatabase`, `RedisKey`, `RedisValue`, `RedisResult`), `ILogger<RedisDistributedLock>`, and an optional [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) (`RedisDistributedLock.cs:24-27`), which is what puts this type at Level 2 rather than Level 1. It returns its nested [`RedisLockHandle`](#redislockhandle).

- **Concept**: the acquire half of the lock taught in two pieces with [`RedisLockHandle`](#redislockhandle). `[Rubric §12, Performance & Scalability]` assesses scale-out correctness: moving the lock into Redis is what makes "only one of these runs at a time" true across replicas instead of true per process, which is the whole reason the abstraction exists (see [`InProcessDistributedLock`](#inprocessdistributedlock) for the degraded alternative). `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses failure behaviour: the expiry carried on the `SET` is the crash guard (a holder that dies releases by expiry rather than wedging the key forever), and the class documents that it is deliberately **single-instance, not Redlock** (`RedisDistributedLock.cs:19-22`), inheriting Redis's failover behaviour, which is exactly why the contract is documented as best-effort.

- **Walkthrough**:
  - **State.** `KeyPrefix` is `"lock:"` (`RedisDistributedLock.cs:30`) so lock entries cannot collide with cache entries in a shared instance. `ReleaseScript` (`RedisDistributedLock.cs:36-37`) is the compare-and-delete Lua taught under [`RedisLockHandle`](#redislockhandle). `PollInterval` is 50 ms (`RedisDistributedLock.cs:40`); unlike the in-process poll, each retry here is a network round trip. `_keys` falls back to `CacheKeyNamespace.None` when no namespace was injected (`RedisDistributedLock.cs:42`), so the `Cache:KeyPrefix` option (when configured) qualifies lock keys the same way it qualifies cache keys.
  - **Argument guards.** `TryAcquireAsync` (`RedisDistributedLock.cs:45-82`) applies the same three checks as the in-process implementation: non-blank key, `ttl` greater than zero, non-negative `wait` (`RedisDistributedLock.cs:51-53`).
  - **Key and token.** The physical key is `_keys.Qualify("lock:" + key)` (`RedisDistributedLock.cs:55`). The token is a fresh `Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)` minted **per acquisition** (`RedisDistributedLock.cs:59`); the release script matches on it, and that is what makes a release owner-scoped instead of "delete whatever is there now" (`RedisDistributedLock.cs:57-58`).
  - **The acquire loop** (`RedisDistributedLock.cs:64-81`). `StringSetAsync(redisKey, token, ttl, keepTtl: false, When.NotExists, CommandFlags.None)` (`RedisDistributedLock.cs:66-68`) is a single atomic conditional set carrying the expiry, so exactly one replica can win a key. On success it returns a [`RedisLockHandle`](#redislockhandle) closing over the database, key, token, and logger (`RedisDistributedLock.cs:70-73`); once `Stopwatch.GetElapsedTime(startedAt) >= wait` it returns `null` (`RedisDistributedLock.cs:75-78`); otherwise it delays one `PollInterval` and retries (`RedisDistributedLock.cs:80`).

- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) (revised 2026-08-01) replaced the process-local guard around the idempotency filter's execute-then-store window with this, because a striped semaphore stops serializing anything once a service runs more than one replica. Choosing the one-instance `SET NX PX` lock over Redlock is a stated trade: simpler, dependent on a single Redis, and paired with a contract that tells callers never to lean on it for an invariant persistence can enforce.

- **Where it's used**: selected by `AddCaching` whenever an `IConnectionMultiplexer` is resolvable (`DependencyInjection.cs:183-190`, see [`DependencyInjection`](#dependencyinjection)), passing the same [`CacheKeyNamespace`](group-09-caching.md#cachekeynamespace) the distributed cache gets. Every deployed ADC and Store service host registers `AddRedisDistributedCache("redis")` plus `AddRedisClient("redis")` when a `redis` connection string is present (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:116-124`), so those hosts get this implementation. The one in-framework caller is the API [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter); `RedisDistributedLockTests` covers the acquire and release commands against a mocked `IDatabase`.

- **Caveats / not-in-source**: whether a given deployed environment actually supplies the `redis` connection string is an infrastructure/config fact, not a source fact, so "which implementation is live in environment X" is Not determinable from source here; the source only settles that the connection string decides it.

---

### DependencyInjection
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:38` · Level 9 · class (static, extension)

- **What it is**: the single composition root for the entire Infrastructure layer. A static class whose body is one C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:39`) adding the layer's registration methods directly onto `IServiceCollection`: `AddInfrastructure(IConfiguration)`, `AddCaching()`, `AddServices()`, `AddEntityConfigurationAssembly(Assembly)`, `AddNotificationInfrastructure()`, `AddPushNotifications(IConfiguration)`, `AddNativePushNotifications(IConfiguration)`, `AddAzureBlobFileStorage(IConfiguration)`, `AddBrokerMessaging(IConfiguration, Action?)`, and `AddTypedServiceClient<TInterface, TImplementation>(string)`.

- **Depends on**: nearly every Infrastructure type below it, wired by interface. Persistence: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory), [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice), [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), [`DefaultEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#defaultentityconfigurationassemblyprovider), [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype), [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory), [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork). Messaging/outbox: [`IMessageBus`](group-04-events-outbox.md#imessagebus)/[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)/[`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`IEventBus`](group-04-events-outbox.md#ieventbus), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), [`EfInboxStore`](group-04-events-outbox.md#efinboxstore). Cross-cutting: [`ICacheService`](group-09-caching.md#icacheservice), [`IJwksProvider`](group-08-auth.md#ijwksprovider)/[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider), [`TokenService`](group-08-auth.md#tokenservice), [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). Settings: [`DataSourcesSettings`](#datasourcessettings), [`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](#outboxsettings). Externals: MassTransit v8 (pinned by policy), StackExchange.Redis, `Microsoft.AspNetCore.SignalR`, `Microsoft.Azure.NotificationHubs`, `Azure.Storage.Blobs` / `Azure.Identity`, `Microsoft.Extensions.Http.Resilience`.

- **Concept introduced, the mega-composition-root plus the swap-at-the-edge extraction pattern.** `[Rubric §3, Clean Architecture]` assesses whether wiring lives at the edge rather than in the core: every concrete Infrastructure choice is registered here, not in Application or Domain. `[Rubric §10, Cross-Cutting]` and `[Rubric §7, Microservices Readiness]`: the method bodies are the framework's default posture, and each optional channel (broker, push, native push, blob storage) is a separate opt-in method a host layers on, so the same package runs as a monolith or as an extracted service without recompiling the core. The default everywhere is `TryAdd*` (`DependencyInjection.cs:49-135`, `178-209`), meaning a host can pre-register its own implementation and the framework will not clobber it; the one place the code intentionally uses `Replace` instead is the broker swap (below).

- **Walkthrough** (in registration order):
  - **`AddInfrastructure` (`DependencyInjection.cs:47-142`)** is the entry point. It binds the settings sections through the options pipeline with `.ValidateDataAnnotations().ValidateOnStart()` (`ConnectionStringSettings` at `DependencyInjection.cs:59-62`, `SmtpSettings` at `73-76`, [`OutboxSettings`](#outboxsettings) at `113-116`, `LoginProtectionSettings` at `118-121`, [`MessageBusSettings`](#messagebussettings) at `124-127`, `JwksSettings` at `129-132`), then registers the persistence stack, caching, and the two hosted outbox services ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) and [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) at `DependencyInjection.cs:136-137`).
  - **The named-data-sources note (`DependencyInjection.cs:65-69`)** is load-bearing: [`DataSourcesSettings`](#datasourcessettings) is built directly from `configuration.GetSection(...).Get<Dictionary<...>>()` rather than through `AddOptions`, because a root-level dictionary section does not bind through the options pipeline. This is the kind of detail the source comment preserves.
  - **The physical-factory warning (`DependencyInjection.cs:79-85`)**: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is scoped (one per request) and [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory) is a singleton that must **never** be converted to EF context pooling, because each raw context carries per-source constructor state that pooling would silently reuse across databases.
  - **The Scrutor scan (`DependencyInjection.cs:105-109`)** discovers every `IEntityTypeConfigurationBase<,>` in the Infrastructure assembly via `FromAssemblyOf<ClassReference>()` (`DependencyInjection.cs:106`) and registers each as its implemented interfaces, scoped to match the DbContext lifetime, closing the loop back to [`ClassReference`](#classreference).
  - **`AddCaching` (`DependencyInjection.cs:149-168`)** is a Redis-or-memory probe resolved once as a singleton: if an `IDistributedCache` is registered and is not the no-op `MemoryDistributedCache` (`DependencyInjection.cs:156`), it wraps the real distributed cache (and any `IConnectionMultiplexer`) in `DistributedCacheService`; otherwise it falls back to `MemoryCacheService` (`DependencyInjection.cs:164`).
  - **`AddServices` (`DependencyInjection.cs:174-212`)** registers the small services and encodes a subtle lifetime lesson: [`TokenService`](group-08-auth.md#tokenservice) is a **singleton** (`DependencyInjection.cs:186`) with a six-line comment explaining why (`DependencyInjection.cs:180-185`): a scoped lifetime disposed the RSA handle at end-of-request while IdentityModel's static `CryptoProviderCache` still held the cached signature provider wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. `[Rubric §11, Security]` (correct signing-key lifecycle). It also sets the default [`IMessageBus`](group-04-events-outbox.md#imessagebus) to [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) (`DependencyInjection.cs:194`) and wires the inert no-op defaults for push (`DependencyInjection.cs:198-199`), native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), `203-204`), and file storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), `208`) so hosts can register the opt-in methods unconditionally.
  - **`AddBrokerMessaging` (`DependencyInjection.cs:372-421`)** is the extraction pivot. It reads [`MessageBusSettings.Provider`](#messagebussettings): on `InProcess` it returns immediately (`DependencyInjection.cs:381-384`), leaving the in-process bus in place; otherwise it calls `AddMassTransit` and then **`Replace`s** the scoped [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`DependencyInjection.cs:401`) and [`IEventBus`](group-04-events-outbox.md#ieventbus) with `BrokerEventBus` (`DependencyInjection.cs:407`), the deliberate exception to the `TryAdd` rule, because the in-process bus must not run alongside the broker. It also chooses the consumer-side [`IInboxStore`](group-04-events-outbox.md#efinboxstore) implementation from `settings.EnableInbox` (`DependencyInjection.cs:411-418`).
  - **Transport wiring (`DependencyInjection.cs:475-550`)** is factored into two private static helpers (`ResolveBrokerConnectionString` at `475-484`, `ConfigureBrokerTransport` at `504-550`) outside the extension block to keep `AddBrokerMessaging`'s cyclomatic complexity below the analyzer threshold; both carry a justified `IDE0051` suppression (`DependencyInjection.cs:471-474`, `500-503`) documenting a Roslyn false positive where SDK 10.0.201+ cannot see references crossing the extension-block boundary. `[Rubric §29, Resilience & Business Continuity]`: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy (`DependencyInjection.cs:519-523`, `536-540`); `UseDelayedRedelivery` is intentionally not wired, with a comment explaining the Aspire RabbitMQ container lacks the delayed-message-exchange plugin (`DependencyInjection.cs:494-499`).
  - **`AddTypedServiceClient` (`DependencyInjection.cs:441-458`)** wires a typed `HttpClient` to Aspire service discovery (`http://{serviceName}`, `DependencyInjection.cs:451-452`), attaches [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) (`DependencyInjection.cs:453`) so the inbound bearer token flows downstream, and adds the standard Polly resilience handler (`DependencyInjection.cs:456`); the doc notes gRPC is preferred for service-to-service contracts.

- **Why it's built this way**: the `extension(IServiceCollection)` syntax keeps every Infrastructure registration in one file without a proliferation of static helper classes, and pushing all concrete choices into one composition root at the layer edge is what keeps Application and Domain free of framework references ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the database-per-service wiring, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the broker/extraction path). See the DI-sequence note in `MMCA.Common/CLAUDE.md`: hosts call `AddApplicationDecorators()` last so Scrutor can decorate handlers already registered, but the relative position of `AddInfrastructure` is not otherwise ordering-sensitive.

- **Where it's used**: called from each service host's `Program.cs` (the reference apps and the extracted `MMCA.ADC.*` service hosts) after `AddApplication()`; the optional methods (`AddBrokerMessaging`, `AddPushNotifications`, `AddNativePushNotifications`, `AddAzureBlobFileStorage`) are added by the specific hosts that need those channels.

- **Caveats / not-in-source**: the exact set of consuming `Program.cs` files is in the downstream apps (MMCA.ADC / MMCA.Store / MMCA.Helpdesk), not in this repository, so the precise call sites are Not determinable from source here.

### DataSourceEntrySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourceEntrySettings.cs:19` · Level 0 · class (sealed)

- **What it is**: the shape of ONE named entry under the `DataSources` configuration section, the per-logical-source counterpart to the top-level `ConnectionStrings` block. It carries a connection string per engine plus two per-source overrides (Cosmos database name, SQL Server migrations assembly).

- **Depends on**: nothing first-party and nothing beyond `string` from the BCL, which is why it sits at Level 0. It is aggregated by [`DataSourcesSettings`](#datasourcessettings) and read by [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver).

- **Concept introduced, configuration as the physical-topology dial.** `[Rubric §8, Data Architecture]` assesses how the logical model maps onto physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database. The declarative half of that story is [`UseDatabaseAttribute`](#usedatabaseattribute), which names a *logical* source on an entity configuration. This class is the other half: it says what that logical name physically means in a given deployment. Nothing in the code decides the topology; the same compiled assemblies run as a one-database monolith or as N separate databases depending on how many entries exist here. `[Rubric §16, Maintainability]`: because every property defaults to `string.Empty` (`DataSourceEntrySettings.cs:22-37`), a partially filled entry is legal and each empty value simply falls back to the top-level `ConnectionStrings` value, so a host adds a database by adding one JSON object and nothing else.

- **Walkthrough**: five `{ get; init; }` properties, all defaulting to `string.Empty`.
  - `CosmosConnectionString` (`DataSourceEntrySettings.cs:22`) and `CosmosDatabaseName` (`DataSourceEntrySettings.cs:25`), the Cosmos pair; the database name falls back to the top-level `CosmosDatabaseName` when empty ([`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) applies that fallback at `DataSourceResolver.cs:114-116` and again at `:196-198`).
  - `SqliteConnectionString` (`DataSourceEntrySettings.cs:28`), the SQLite path (ADR-018 polyglot persistence).
  - `SQLServerConnectionString` (`DataSourceEntrySettings.cs:31`), the production engine's connection string.
  - `SQLServerMigrationsAssembly` (`DataSourceEntrySettings.cs:37`), the EF Core migrations assembly for THIS source. Leaving it empty is not free: the resolver logs a warning saying that applying another database's migrations to a separate database is almost always a mistake (`DataSourceResolver.cs:278`).
  - The XML doc carries a worked `appsettings.json` example for a `Conference` source (`DataSourceEntrySettings.cs:9-18`), which is the fastest way to see the intended shape.

- **Why it's built this way**: `init`-only properties make a bound entry immutable after startup, and the "empty means inherit" rule is what keeps the single-database default intact, an app that configures no `DataSources` section behaves exactly as it did before the section existed ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: bound as the value type of the dictionary that [`DependencyInjection`](#dependencyinjection) reads with `configuration.GetSection(DataSourcesSettings.SectionName).Get<Dictionary<string, DataSourceEntrySettings>>()` (`DependencyInjection.cs:68-70`); consumed by [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) when it classifies logical names into physical sources (`DataSourceResolver.cs:94-102`).

---

### FileStorageSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/FileStorageSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the `FileStorage` configuration section for Azure Blob Storage: an endpoint (production, managed identity) or a connection string (local Azurite), plus the container every blob lives in.

- **Depends on**: `System.Uri` (BCL) only. Its consumers are the Azure SDK types (`BlobServiceClient`, `DefaultAzureCredential`) wired in [`DependencyInjection`](#dependencyinjection).

- **Concept introduced, the incomplete-section no-op.** `[Rubric §11, Security]` assesses how credentials are handled: the production path sets `ServiceUri` and authenticates with `DefaultAzureCredential`, so no storage key exists to leak, while `ConnectionString` is documented as the local-development alternative (`FileStorageSettings.cs:15-19`). `[Rubric §33, Developer Experience]`: `AddAzureBlobFileStorage` is written so that an incomplete section is a no-op rather than a startup crash, which lets a host call it unconditionally and lets an environment opt in with configuration alone. `[Rubric §15, Best Practices]`: note the deliberate absolute-URI check at `DependencyInjection.cs:368-369`, an empty-string `ServiceUri` binds to a *relative* `Uri`, so a truthiness test would have accepted a useless value; only `{ IsAbsoluteUri: true }` counts.

- **Walkthrough**:
  - `SectionName = "FileStorage"` (`FileStorageSettings.cs:13`), the same static section-name convention every settings class in this namespace follows.
  - `ServiceUri` (`FileStorageSettings.cs:16`), nullable `Uri`, the blob service endpoint.
  - `ConnectionString` (`FileStorageSettings.cs:19`), nullable, the Azurite alternative.
  - `ContainerName` (`FileStorageSettings.cs:22`), documented as required; the registration bails out when it is blank (`DependencyInjection.cs:363-366`) and again when neither an absolute `ServiceUri` nor a connection string is present (`DependencyInjection.cs:370-373`).

- **Why it's built this way**: ADR-045 introduced managed file storage; shipping the pipeline inert and switching it on by configuration means an environment can be provisioned before its storage account exists, and the [`NullFileStorageService`](group-07-persistence-ef-core.md#nullfilestorageservice) default keeps the container resolvable in the meantime ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).

- **Walkthrough of its one consumer**: `AddAzureBlobFileStorage` binds the options (`DependencyInjection.cs:359-360`), re-reads the section eagerly with `.Get<FileStorageSettings>()` (`DependencyInjection.cs:362`) because the decision to register at all has to be made at composition time, then registers a singleton `BlobContainerClient` built from either the URI plus `DefaultAzureCredential` or the connection string (`DependencyInjection.cs:375-381`) and swaps [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) to [`AzureBlobFileStorageService`](group-07-persistence-ef-core.md#azureblobfilestorageservice) (`DependencyInjection.cs:382`).

- **Caveats**: unlike most sections here this one is bound WITHOUT `.ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:359-360`), deliberately, since "incomplete" is a supported state rather than a misconfiguration.

---

### IConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IConnectionStringSettings.cs:6` · Level 0 · interface

- **What it is**: the abstraction over the top-level `ConnectionStrings` section: one connection string per supported engine, the Cosmos database name, and the SQL Server migrations assembly. It describes the `Default` physical data source, the one every unmapped logical name collapses onto.

- **Depends on**: nothing. Implemented by [`ConnectionStringSettings`](#connectionstringsettings).

- **Concept introduced, settings interfaces alongside the options pattern.** ASP.NET Core's own idiom is to inject `IOptions<T>` of a concrete class. This codebase adds a thin interface per settings group and registers a singleton adapter that unwraps the options for it (`DependencyInjection.cs:64`). `[Rubric §1, SOLID]` (DIP + ISP): a consumer that needs connection strings depends on a five-member contract it can hand-implement in a test, not on `IOptions<ConnectionStringSettings>` plus a live configuration tree. `[Rubric §14, Testability]`: this is what lets [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) take `IConnectionStringSettings` directly in its constructor (`DataSourceResolver.cs:34`) and be unit tested with a stub. `[Rubric §3, Clean Architecture]`: the interface still lives in Infrastructure, not Application, because connection strings are an infrastructure concern; nothing above this layer ever sees it.

- **Walkthrough**: five `{ get; init; }` members, all `string`: `CosmosConnectionString` (`IConnectionStringSettings.cs:9`), `CosmosDatabaseName` (`:12`), `SqliteConnectionString` (`:15`, documented as typically a file path), `SQLServerConnectionString` (`:18`), and `SQLServerMigrationsAssembly` (`:24`, documented to fall back to the DbContext assembly when empty). Note `init` accessors on an *interface*: any implementation must be settable at construction and frozen afterwards, which is exactly what configuration binding does.

- **Why it's built this way**: one interface per section keeps consumers narrow, and the `init`-only shape encodes the fact that settings are startup state, not mutable state ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) depends on these values being stable for the process lifetime, since the resolver classifies sources once).

- **Where it's used**: [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) is the primary consumer (`DataSourceResolver.cs:34`, `:77`, `:97`, `:143`, `:174`, `:262`); the DI adapter is registered at `DependencyInjection.cs:64`.

---

### IPushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IPushNotificationSettings.cs:6` · Level 0 · interface

- **What it is**: the two-member contract for the `PushNotifications` section: whether the SignalR push pipeline is on, and the hub's endpoint path.

- **Depends on**: nothing. Implemented by [`PushNotificationSettings`](#pushnotificationsettings).

- **Concept**: the same settings-interface-over-options pattern taught under [`IConnectionStringSettings`](#iconnectionstringsettings). What is worth noticing here is what the interface deliberately does NOT carry: the concrete class adds a `ChannelKeyPattern` member and its XML doc states plainly that the member stays off the interface so implementers see no breaking change (`PushNotificationSettings.cs:17-22`). `[Rubric §9, API & Contract Design]` assesses whether published contracts evolve compatibly; adding a member to a shipped public interface is a source-breaking change for every downstream implementer, so a new knob lands on the concrete class and its consumer takes `IOptions<PushNotificationSettings>` instead.

- **Walkthrough**: `Enabled` (`IPushNotificationSettings.cs:9`) and `HubPath` (`:12`), both `{ get; init; }`.

- **Where it's used**: registered as a singleton adapter over the bound options inside `AddPushNotifications` (`DependencyInjection.cs:296-297`); the SignalR senders ([`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender), [`SignalRLiveChannelPublisher`](group-10-notifications.md#signalrlivechannelpublisher)) are registered in the same call (`DependencyInjection.cs:308-309`).

---

### ISmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ISmtpSettings.cs:6` · Level 0 · interface

- **What it is**: the contract for the `Smtp` section: host, port, credentials, TLS toggle, and the default sender/recipient addresses.

- **Depends on**: nothing. Implemented by [`SmtpSettings`](#smtpsettings).

- **Concept**: another instance of the settings-interface pattern from [`IConnectionStringSettings`](#iconnectionstringsettings). `[Rubric §14, Testability]` is the payoff: [`SmtpEmailSender`](group-10-notifications.md#smtpemailsender) takes `ISmtpSettings` in its primary constructor (`SmtpEmailSender.cs:12`) and copies each value into a readonly field at construction (`SmtpEmailSender.cs:14-20`), so a test hands it a plain object with no configuration system in play. `[Rubric §11, Security]`: `Password` is a plain `string` on the contract (`ISmtpSettings.cs:18`), so it is only ever as safe as the configuration provider that supplies it (user-secrets or Key Vault, not a committed `appsettings.json`).

- **Walkthrough**: `Host` (`ISmtpSettings.cs:9`), `Port` documented as 1-65535 (`:12`), `Username` (`:15`), `Password` (`:18`), `EnableSsl` (`:21`), `From` (`:24`), and `To`, documented as the default recipient used by the no-argument `SendAsync` overload (`:27`).

- **Where it's used**: [`SmtpEmailSender`](group-10-notifications.md#smtpemailsender), the [`IEmailSender`](group-10-notifications.md#iemailsender) implementation; the DI adapter is registered at `DependencyInjection.cs:78`.

---

### JwksSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwksSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: the `Jwks` section that controls whether an Identity service publishes a JSON Web Key Set at `/.well-known/jwks.json`, and where its RSA public key comes from.

- **Depends on**: `System.ComponentModel.DataAnnotations` (`[StringLength]`) only. Consumed by [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) through `IOptions<JwksSettings>`.

- **Concept introduced, key distribution as configuration.** `[Rubric §11, Security]` assesses how trust is established between services. In the monolith, issuer and validator share one process and one symmetric secret. Once a module is extracted, the validator must obtain the issuer's *public* key without sharing anything secret, which is what a JWKS document is for ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). `[Rubric §7, Microservices Readiness]`: the framework ships the endpoint always and the key set empty, so nothing about a monolith deployment changes until a host flips `Enabled`. The `kid` contract is the subtle part: `KeyId` is published as the JWK `kid` and MUST match the `kid` header on tokens the issuer signs (`JwksSettings.cs:13-14`), otherwise a validator holding a correct key set still cannot pick the right key.

- **Walkthrough**:
  - `SectionName = "Jwks"` (`JwksSettings.cs:20`).
  - `Enabled` (`JwksSettings.cs:26`), defaulting to `false` with the rationale spelled out inline: existing HMAC-only deployments must not start advertising an RSA key set by accident.
  - `KeyId` (`JwksSettings.cs:34`), `[StringLength(64)]` (`:33`), defaulting to `"default"`.
  - `RsaPublicKeyPem` (`JwksSettings.cs:41`) and `RsaPublicKeyPath` (`:47`), documented as mutually exclusive; the path form exists for keys mounted as a secret rather than inlined in configuration.
  - The consuming logic, worth reading alongside: `RsaJwksProvider.BuildKeySet` returns an EMPTY `JsonWebKeySet` when `Enabled` is false (`RsaJwksProvider.cs:30-33`) and again when neither PEM source resolves (`:36-39`); otherwise it imports the PEM, stamps `KeyId` onto the `RsaSecurityKey` (`RsaJwksProvider.cs:44-47`) and tags the JWK `use=sig`, `alg=RS256` (`:50-51`). `ResolvePem` prefers the inline value over the file (`RsaJwksProvider.cs:58-74`).

- **Why it's built this way**: default-off plus an empty key set means the endpoint is safe to map unconditionally (`WebApplicationExtensions.cs:109` documents that Identity services are the ones that flip it on), and two key sources cover both "inline it in configuration" and "mount it as a secret" without a second code path in the provider.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` at `DependencyInjection.cs:137-140`, immediately followed by the [`IJwksProvider`](group-08-auth.md#ijwksprovider) registration (`DependencyInjection.cs:141`).

---

### JwtSigningAlgorithm

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSigningAlgorithm.cs:18` · Level 0 · enum

- **What it is**: a two-value enum selecting how access tokens are signed and validated: symmetric HMAC or asymmetric RSA.

- **Depends on**: nothing. Referenced by [`IJwtSettings`](#ijwtsettings), [`JwtSettings`](#jwtsettings), [`TokenService`](group-08-auth.md#tokenservice), and the API-layer authentication wiring.

- **Concept introduced, the monolith-to-microservice auth switch.** `[Rubric §11, Security]` assesses key management: HS256 requires every validator to hold the *signing* key, which is acceptable only while issuer and validators share a process. RS256 splits the pair, the issuer holds the private key and validators fetch the public key, which is the precondition for extracting a service ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). `[Rubric §7, Microservices Readiness]`: making this a configuration value rather than a compile-time choice is what lets the same binaries run both topologies. The type's own XML doc states the operational consequence plainly: switching HS256 to RS256 invalidates all existing tokens, a hard cutover (`JwtSigningAlgorithm.cs:15-16`).

- **Walkthrough**: `HS256 = 0` (`JwtSigningAlgorithm.cs:21`), explicitly the default so that an unset configuration value binds to the backwards-compatible option; `RS256 = 1` (`:24`). The explicit ordinals matter because a bound enum from configuration falls back to `0`.

- **Where it's used**: [`TokenService`](group-08-auth.md#tokenservice) branches on it to build credentials (`TokenService.cs:53`, with the HMAC and RSA builders at `:166` and `:181`); the API layer branches on it when configuring JWT bearer validation (`WebApplicationBuilderExtensions.cs:408`), where selecting RS256 without an `RsaPublicKeyPem` throws a message pointing at `AddForwardedJwtBearer` instead (`WebApplicationBuilderExtensions.cs:413`).

---

### MessageBusProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:68` · Level 0 · enum

- **What it is**: the transport selector for the cross-service message bus. It lives in the same file as [`MessageBusSettings`](#messagebussettings), immediately below it.

- **Depends on**: nothing.

- **Concept**: the transport-choice-at-the-edge invariant. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` both hinge on application code never naming a broker: handlers publish through [`IMessageBus`](group-04-events-outbox.md#imessagebus), and only this enum plus the registration that reads it decide whether that lands in-process or on a wire. The three values are also a deployment ladder, monolith, dev microservices, production microservices.

- **Walkthrough**: `InProcess = 0` (`MessageBusSettings.cs:73`), the modular-monolith default served by [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus); `RabbitMq = 1` (`:78`), MassTransit on RabbitMQ for development and tests; `AzureServiceBus = 2` (`:83`), MassTransit on Azure Service Bus for production. `AddBrokerMessaging` returns without touching the container when the value is `InProcess` (`DependencyInjection.cs:418-421`), and `ConfigureBrokerTransport` switches on it to pick `UsingRabbitMq` (`DependencyInjection.cs:548-563`) or `UsingAzureServiceBus` (`:565-566`).

- **Why it's built this way**: a zero-valued `InProcess` means an absent `MessageBus` section binds to the monolith behavior, so adding the section is opt-in rather than mandatory ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

- **Where it's used**: [`MessageBusSettings.Provider`](#messagebussettings) (`MessageBusSettings.cs:17`), and the two `AddBrokerMessaging` branches cited above.

---

### NativePushSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/NativePushSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the `NativePush` section for OS-level push delivery through Azure Notification Hubs: an on/off flag, the hub connection string, and the hub name.

- **Depends on**: nothing first-party; its values feed `Microsoft.Azure.NotificationHubs.NotificationHubClient`.

- **Concept**: the same ship-inert, enable-by-configuration shape taught under [`FileStorageSettings`](#filestoragesettings), with a concrete operational reason attached. `[Rubric §17, DevOps]` assesses whether deployment and enablement can be sequenced independently: the XML doc records that a hub is provisioned with `Enabled` false until the FCM v1 service account and APNs auth key are uploaded to it (`NativePushSettings.cs:5-7`), so infrastructure lands before credentials do and neither step blocks a release. `[Rubric §29, Resilience]`: the disabled path leaves the null sender in place rather than failing startup, so a missing credential degrades the channel instead of the host.

- **Walkthrough**: `SectionName = "NativePush"` (`NativePushSettings.cs:12`); `Enabled` (`:15`); nullable `ConnectionString`, documented as a Listen+Send+Manage rule (`:18`); nullable `HubName` (`:21`). `AddNativePushNotifications` binds the options (`DependencyInjection.cs:327-328`), then re-reads the section eagerly and returns early unless all three are present (`DependencyInjection.cs:330-336`); only then does it register the hub client and swap [`INativePushSender`](group-07-persistence-ef-core.md#inativepushsender) and `IPushDeviceRegistrar` to their Azure implementations (`DependencyInjection.cs:338-342`).

- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) chose a configuration-gated channel precisely so hosts can register it unconditionally.

- **Where it's used**: `AddNativePushNotifications` (`DependencyInjection.cs:325-345`) and, through it, [`AzureNotificationHubNativePushSender`](group-07-persistence-ef-core.md#azurenotificationhubnativepushsender).

---

### PersistenceSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the `Persistence` section, currently a single knob: the SQL command timeout applied to every command the SQL Server context issues.

- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Range]`) only.

- **Concept introduced, the defaults-preserve-history rule for new settings sections.** `[Rubric §16, Maintainability]` assesses whether change is additive; the class doc states the policy directly, every property defaults to the value the framework applied implicitly before the section existed, so the section is optional in `appsettings.json` (`PersistenceSettings.cs:6-8`). `[Rubric §12, Performance & Scalability]`: the 30-second default is the previous implicit ADO.NET behavior, and the doc names the case for raising it (reporting-style workloads whose queries legitimately run longer than half a minute, `PersistenceSettings.cs:16-19`). Making that value configurable rather than constant is the difference between "tune it in an environment" and "cut a release".

- **Walkthrough**: `SectionName = "Persistence"` (`PersistenceSettings.cs:13`); `CommandTimeoutSeconds` with `[Range(1, 600)]` (`:21`) defaulting to `30` (`:22`). The consuming side is defensive in a way worth copying: [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) resolves the options with `GetService<IOptions<PersistenceSettings>>()?.Value ?? new PersistenceSettings()` (`SQLServerDbContext.cs:36-37`), so a context built outside the full DI graph (a design-time factory, a test) still gets the documented default rather than a null reference, and applies it via `sql.CommandTimeout(...)` (`SQLServerDbContext.cs:56`).

- **Why it's built this way**: a `[Range]`-validated option bound with `ValidateOnStart` turns a typo into a startup failure rather than a per-query surprise.

- **Where it's used**: bound at `DependencyInjection.cs:116-119`; read by [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext).

---

### ConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ConnectionStringSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete class bound from the top-level `ConnectionStrings` section, implementing [`IConnectionStringSettings`](#iconnectionstringsettings). It describes the `Default` physical data source.

- **Depends on**: [`IConnectionStringSettings`](#iconnectionstringsettings) (the reason it is Level 1) and `System.ComponentModel.DataAnnotations` for `[Required]`.

- **Concept introduced, validate-on-start as a fail-fast gate.** `[Rubric §15, Best Practices & Code Quality]` assesses whether misconfiguration is caught early. `AddOptions<T>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:60-63`) is the pattern every validated settings class in this namespace uses: the annotations are evaluated during host startup, not lazily on first resolution, so a host with no SQL Server connection string fails to start with a named error instead of throwing inside the first request. `[Rubric §13, Observability & Operability]`: a startup failure is far easier to diagnose in a deployment than an intermittent request-time exception.

- **Walkthrough**:
  - `SectionName = "ConnectionStrings"` (`ConnectionStringSettings.cs:12`), reusing ASP.NET Core's own conventional section so `GetConnectionString(...)` and this class read the same data.
  - `CosmosConnectionString` (`ConnectionStringSettings.cs:15`), empty by default.
  - `CosmosDatabaseName` (`:18`), the one property with a non-empty default, `"AtlDevCon"`.
  - `SqliteConnectionString` (`:21`), empty by default.
  - `SQLServerConnectionString` (`:25`), the only `[Required]` member (`:24`); the class doc explains why, SQL Server is the default data source (`ConnectionStringSettings.cs:6-7`).
  - `SQLServerMigrationsAssembly` (`:28`), empty by default, which makes EF fall back to the DbContext assembly.

- **Why it's built this way**: requiring exactly one engine's connection string keeps polyglot persistence opt-in ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) while still failing fast on the engine every deployment actually uses.

- **Where it's used**: bound and adapted to the interface at `DependencyInjection.cs:60-64`; read by [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) as the `Default` identity that named sources are compared against (`DataSourceResolver.cs:100`).

- **Caveats**: the `"AtlDevCon"` Cosmos default (`ConnectionStringSettings.cs:18`) is an application-specific name (the ADC conference database) baked into a framework package; every other default in this namespace is neutral.

---

### DataSourcesSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the bound `DataSources` section as a whole, a read-only dictionary of logical source name to [`DataSourceEntrySettings`](#datasourceentrysettings). It is the configuration input to database-per-microservice routing.

- **Depends on**: [`DataSourceEntrySettings`](#datasourceentrysettings) and `DataSourceKey.DefaultName` from the Application layer ([`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey), `DataSourceKey.cs:18`, the constant `"Default"`).

- **Concept introduced, a settings class that validates in its own constructor.** Most settings types here are inert bags validated by data annotations. This one is different, and the reason is stated in its own doc: a root-level *dictionary* section does not bind through the options pipeline, so [`DependencyInjection`](#dependencyinjection) builds the instance by hand from `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` and registers it as a singleton (`DataSourcesSettings.cs:8-11`, `DependencyInjection.cs:68-70`). With no options pipeline there is no `ValidateOnStart`, so the constructor becomes the fail-fast gate. `[Rubric §15, Best Practices & Code Quality]`: rejecting a reserved name at construction is the same guarantee `ValidateOnStart` would have given, implemented where the type can enforce it itself. `[Rubric §8, Data Architecture]`: the reserved-name rule protects a real invariant, `Default` is configured through the top-level `ConnectionStrings` section, and letting someone also declare a `DataSources:Default` entry would create two competing definitions of the same physical source.

- **Walkthrough**:
  - `SectionName = "DataSources"` (`DataSourcesSettings.cs:16`).
  - The constructor takes an optional `IReadOnlyDictionary<string, DataSourceEntrySettings>?` (`DataSourcesSettings.cs:23`) and substitutes an empty ordinal-comparer dictionary when it is null (`:25`), so "no `DataSources` section" is a first-class state rather than a null check at every call site.
  - It then walks every key (`DataSourcesSettings.cs:27-40`) and throws `InvalidOperationException` twice: on a blank or whitespace name (`:29-32`), and on any name equal to `DataSourceKey.DefaultName` under `OrdinalIgnoreCase` (`:34-39`). The second message is unusually good operator guidance, it names the offending entry and tells the reader that the `Default` source is configured via the top-level `ConnectionStrings` section, so remove or rename the entry.
  - `Sources` (`DataSourcesSettings.cs:44`), the get-only dictionary the resolver reads.

- **Why it's built this way**: throwing during host construction is the earliest possible point at which a duplicate `Default` definition can be caught; the alternative is a routing bug that surfaces as data landing in the wrong database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

- **Where it's used**: constructed and registered as a singleton in `AddInfrastructure` (`DependencyInjection.cs:68-70`), immediately before [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) and [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) (`DependencyInjection.cs:71-72`); consumed by the resolver's constructor (`DataSourceResolver.cs:35`) and its classification pass (`DataSourceResolver.cs:98`).

- **Caveats**: the key comparison for *reservation* is `OrdinalIgnoreCase` (`DataSourcesSettings.cs:34`) while the default backing dictionary uses `StringComparer.Ordinal` (`:25`). The dictionary that configuration binding actually supplies is created by the binder, so its comparer is not determined by this file.

---

### IJwtSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10` · Level 1 · interface

- **What it is**: the contract for the `Jwt` section, covering both signing modes (HMAC secret, RSA key pair) plus the issuer, audience, and the two token lifetimes.

- **Depends on**: [`JwtSigningAlgorithm`](#jwtsigningalgorithm), which is what puts it at Level 1. Implemented by [`JwtSettings`](#jwtsettings).

- **Concept**: the settings-interface pattern from [`IConnectionStringSettings`](#iconnectionstringsettings), applied to the one section whose members are conditionally required. `[Rubric §11, Security]`: the interface carries both a symmetric secret and an asymmetric pair, and only the subset matching `SigningAlgorithm` is meaningful, which is why the *validation* of that pairing lives on the concrete [`JwtSettings`](#jwtsettings) (an `IValidatableObject`, `JwtSettings.cs:16`) rather than in annotations here. The doc for `RsaPrivateKeyPem` records the operational rule that it is stored in user-secrets or Key Vault, not in `appsettings.json` (`IJwSettings.cs:27`). `[Rubric §7, Microservices Readiness]`: `RsaPublicKeyPem` is doubly used, in-process validation reads it directly, and the Identity service also publishes it through `/.well-known/jwks.json` for services that validate remotely (`IJwSettings.cs:33-35`).

- **Walkthrough**: `SigningAlgorithm` defaulting to HS256 by contract (`IJwSettings.cs:16`); `SecretForKey`, the Base64 HMAC key required under HS256 (`:22`); nullable `RsaPrivateKeyPem` (`:29`) and `RsaPublicKeyPem` (`:37`), required under RS256 for issuers and in-process validators respectively; `Issuer` (`:40`); `Audience` (`:43`); `AccessTokenExpirationMinutes` (`:46`); `RefreshTokenExpirationDays` (`:49`).

- **Why it's built this way**: one interface spanning both algorithms means [`TokenService`](group-08-auth.md#tokenservice) has a single dependency and branches internally (`TokenService.cs:53`), instead of the host having to pick a different service registration per topology ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).

- **Where it's used**: [`TokenService`](group-08-auth.md#tokenservice) holds it as `_jwtSettings` (`TokenService.cs:25`, constructor `:47`); the DI adapter over `IOptions<JwtSettings>` is registered at `DependencyInjection.cs:58`.

- **Caveats**: the file is named `IJwSettings.cs` while the type is `IJwtSettings` (`IJwSettings.cs:10`), a typo in the filename that is harmless to the compiler but will defeat a filename-based search for the type.

---

### MessageBusSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:11` · Level 1 · class (sealed)

- **What it is**: the `MessageBus` section: which transport to use, how to reach the broker, how to namespace its queues, how hard to retry a failing consumer, and whether the consumer-side idempotency inbox is on.

- **Depends on**: [`MessageBusProvider`](#messagebusprovider) (same file) and `System.ComponentModel.DataAnnotations`. Read by `AddBrokerMessaging` and by [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus)'s MassTransit configuration.

- **Concept introduced, retry policy as configuration rather than code.** `[Rubric §29, Resilience & Business Continuity]` assesses whether transient failures are absorbed before they become data loss. Every broker receive endpoint gets an exponential-backoff `UseMessageRetry` built from three properties here (`DependencyInjection.cs:556-560`), so a consumer that fails on a transient dependency is retried in-process instead of dead-lettering on the first exception (`DependencyInjection.cs:523-527`). The remarks are equally instructive about what is deliberately absent: only in-process retry is configured, NOT `UseDelayedRedelivery`, because on RabbitMQ that needs the delayed-message-exchange plugin the Aspire container does not ship (`DependencyInjection.cs:531-536`). `[Rubric §7, Microservices Readiness]`: `EndpointPrefix` exists so several services can share one broker without colliding on queue names (`MessageBusSettings.cs:29-31`). `[Rubric §6, CQRS & Event-Driven]`: `EnableInbox` turns on consumer-side deduplication, the receiving counterpart to the outbox ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).

- **Walkthrough**:
  - `SectionName = "MessageBus"` (`MessageBusSettings.cs:14`).
  - `Provider` (`:17`), defaulting to `MessageBusProvider.InProcess`.
  - `ConnectionString` (`:26`), nullable; the doc notes it is read directly so the value can come from any configuration source. It is only the FIRST of three sources: `ResolveBrokerConnectionString` falls back to `ConnectionStrings:rabbitmq` then `ConnectionStrings:messaging` (`DependencyInjection.cs:512-521`), which is what Aspire injects via `WithReference(broker)`. Without that fallback MassTransit would default to `localhost:5672` and miss the Aspire-allocated container port (`DependencyInjection.cs:505-506`).
  - `EndpointPrefix` (`:34`), `[StringLength(64)]` (`:33`); when set, `AddBrokerMessaging` turns on the kebab-case endpoint name formatter (`DependencyInjection.cs:427-430`).
  - `RetryLimit` (`:43`), `[Range(0, 20)]` (`:42`), default `5`; `0` disables retries and a faulted message goes to the `_error` queue.
  - `RetryMinIntervalSeconds` (`:50`), `[Range(0, 300)]`, default `1`, and `RetryMaxIntervalSeconds` (`:56`), `[Range(0, 3600)]`, default `30`, the floor and ceiling of the exponential backoff.
  - `EnableInbox` (`:64`), default `false`. The doc names the operational precondition: it dedups through an `InboxMessages` table in the consumer's database, which requires applying the `AddInboxMessages` migration first (`MessageBusSettings.cs:59-62`). `AddBrokerMessaging` registers the EF-backed inbox store when it is on and a no-op store when it is off (`DependencyInjection.cs:448-455`), so consumer behavior is unchanged until the table exists.

- **Why it's built this way**: defaulting `EnableInbox` to false and swapping in a no-op store keeps a feature that requires a schema migration from breaking a host that has not run it ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)); defaulting `Provider` to `InProcess` keeps the monolith the zero-configuration case ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

- **Where it's used**: bound with validation at `DependencyInjection.cs:132-135` and re-read eagerly by `AddBrokerMessaging` (`DependencyInjection.cs:415-416`), which falls back to `new MessageBusSettings()` when the section is absent, then replaces [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`DependencyInjection.cs:438`) and `IEventBus` with `BrokerEventBus` (`:444`) so that publishing goes through the outbox and [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) becomes the only delivery channel.

- **Caveats**: MassTransit is pinned to major version 8 by policy across this workspace; the retry configuration above is written against that API surface.

---

### PushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PushNotificationSettings.cs:6` · Level 1 · class (sealed)

- **What it is**: the concrete `PushNotifications` section, implementing [`IPushNotificationSettings`](#ipushnotificationsettings) and adding one member the interface does not carry: the regular expression a SignalR channel key must match.

- **Depends on**: [`IPushNotificationSettings`](#ipushnotificationsettings).

- **Concept introduced, allow-listing client-supplied group names.** `[Rubric §26, Front-End Security]` and `[Rubric §11, Security]` both apply. A SignalR hub method that takes a channel key and calls `Groups.AddToGroupAsync` is joining a group named by the *client*; without a constraint, a caller could join any group the server publishes to. `ChannelKeyPattern` is the allow-list, defaulting to `"^(event|session):[0-9]+$"` (`PushNotificationSettings.cs:23`), so only `event:` and `session:` keys with a numeric suffix are accepted. `[Rubric §9, API & Contract Design]`: the property is deliberately declared on the concrete class only, so that [`IPushNotificationSettings`](#ipushnotificationsettings) stays unchanged and no downstream implementer breaks (`PushNotificationSettings.cs:17-22`); the consumer takes `IOptions<PushNotificationSettings>` instead of the interface.

- **Walkthrough**: `SectionName = "PushNotifications"` (`PushNotificationSettings.cs:9`); `Enabled` (`:12`); `HubPath` defaulting to `"/hubs/notifications"` (`:15`); `ChannelKeyPattern` (`:23`). The enforcement lives in [`NotificationHub`](group-10-notifications.md#notificationhub): `EnsureValidChannelKey` pulls a compiled `Regex` from a cache keyed on the pattern (`NotificationHub.cs:63-65`) and throws `HubException("Invalid channel key.")` on an empty or non-matching key (`NotificationHub.cs:67-70`), which both `JoinChannelAsync` (`NotificationHub.cs:46`) and `LeaveChannelAsync` (`NotificationHub.cs:57`) call before touching `Groups`. The regex is constructed with a match timeout, so a pathological pattern cannot hang the connection.

- **Why it's built this way**: a configurable pattern rather than a hard-coded one lets each application define its own channel taxonomy without forking the hub, while the default is restrictive rather than permissive.

- **Where it's used**: bound with validation and adapted to the interface in `AddPushNotifications` (`DependencyInjection.cs:292-297`); read by [`NotificationHub`](group-10-notifications.md#notificationhub) and served by [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender) / [`SignalRLiveChannelPublisher`](group-10-notifications.md#signalrlivechannelpublisher) (`DependencyInjection.cs:308-309`).

---

### SmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SmtpSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete `Smtp` section implementing [`ISmtpSettings`](#ismtpsettings), validated by data annotations at startup.

- **Depends on**: [`ISmtpSettings`](#ismtpsettings) and `System.ComponentModel.DataAnnotations` for `[Range]`.

- **Concept**: the validate-on-start gate taught under [`ConnectionStringSettings`](#connectionstringsettings), here guarding a numeric range rather than a required value. `[Rubric §15, Best Practices & Code Quality]`: `[Range(1, 65535)]` on `Port` (`SmtpSettings.cs:21`) means a configuration typo such as a port of `0` or `70000` fails the host at startup with a named error instead of surfacing as a socket exception the first time the app tries to send mail. Note also the named constant instead of a magic number, `DefaultSmtpPort = 25` (`SmtpSettings.cs:15`) is a public `static readonly` field used as the property's own default (`:22`), so the value is discoverable and testable rather than inlined.

- **Walkthrough**: `SectionName = "Smtp"` (`SmtpSettings.cs:12`); `DefaultSmtpPort = 25` (`:15`); then the seven interface members, `Host` (`:18`), `Port` (`:22`), `Username` (`:25`), `Password` (`:28`), `EnableSsl` (`:31`, defaulting to `false`), `From` (`:34`), `To` (`:37`). Every string defaults to `string.Empty`, so an absent section binds cleanly and fails later at send time rather than at startup, only `Port` is range-checked.

- **Why it's built this way**: annotations plus `ValidateOnStart` cost one line at registration and move an entire class of misconfiguration from runtime to boot.

- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` and adapted to [`ISmtpSettings`](#ismtpsettings) at `DependencyInjection.cs:74-78`; consumed by [`SmtpEmailSender`](group-10-notifications.md#smtpemailsender) (`SmtpEmailSender.cs:12-20`), which snapshots the values into readonly fields at construction, meaning a later configuration reload would not reach an already-constructed sender.

- **Caveats**: `EnableSsl` is honored as configured; the SMTP client construction carries a documented `S5332` suppression because local development targets MailDev, which does not offer TLS (`SmtpEmailSender.cs:29`). Nothing in these settings forces TLS on, so requiring it in a deployed environment is a configuration responsibility.

### OutboxSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:10` · Level 2 · class (sealed)

- **What it is**: the options object bound from the `Outbox` configuration section that tunes the
  outbox background processor and its cleanup companion. Every property has a default, so the whole
  section is optional in `appsettings.json` and a host with no `Outbox` config still runs a working
  outbox (`OutboxSettings.cs:6-9`, `13`).

- **Depends on**: [`DataSource`](group-07-persistence-ef-core.md#datasource) (Level 0, the engine
  enum) and [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) (Level 1, for its
  `DefaultName` constant), both imported through `MMCA.Common.Application.Interfaces.Infrastructure`
  (`OutboxSettings.cs:2`). Externals: `System.ComponentModel.DataAnnotations` for the `[Range]`
  attributes (`OutboxSettings.cs:1`).

- **Concept introduced: options binding with a static `SectionName`.** This is the first settings
  class in this group, so note the convention: `public static readonly string SectionName = "Outbox";`
  (`OutboxSettings.cs:13`) is the single source of truth for the configuration section name, referenced
  at registration time rather than duplicating the literal `"Outbox"` string at the bind call. The
  properties are `init`-only, so once the options are materialized from configuration they are
  immutable for the process lifetime.

  `[Rubric §6: CQRS & Event-Driven]` assesses how reliably domain state changes turn into dispatched
  events. This type is the knob set for the at-least-once outbox pattern ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)): `MaxRetries`
  (`OutboxSettings.cs:21`, default 5) caps failed-message retries, and `ProcessingDelaySeconds`
  (`OutboxSettings.cs:40`, default 5) is the safety parameter that bounds the duplicate-dispatch
  window. The in-process path (save the aggregate and its outbox row, then dispatch and mark the row
  processed) must complete inside that delay or the background processor may re-dispatch the same
  event, which is why handlers are required to be idempotent regardless (`OutboxSettings.cs:33-37`).

  `[Rubric §31: Cost/FinOps]` assesses cost-relevant defaults. `PollingIntervalSeconds`
  (`OutboxSettings.cs:31`, default 2) is documented as a fallback, not a hot loop
  (`OutboxSettings.cs:23-29`): with signal-based wakeup the processor wakes immediately on new entries
  and otherwise smart-waits only until the earliest pending message becomes eligible, so deployed
  environments set this high (for example 300) to cut idle SQL polling without adding latency for real
  traffic.

  `[Rubric §8: Data Architecture]` assesses how deliberately data is partitioned and routed. The
  `DataSource` / `DatabaseName` pair (`OutboxSettings.cs:48`, `57`) names where integration events
  published via `IEventBus` are written, and its `DefaultName` default preserves single-database
  behavior. It is a per-write target, not a global switch: the comment is explicit that the outbox
  processor still drains every relational physical source the host uses (`OutboxSettings.cs:54-55`).

- **Walkthrough**: one static field then eight `init` properties, six of them `[Range]`-validated:
  - `SectionName` (`OutboxSettings.cs:13`): static readonly `"Outbox"`, the bind key.
  - `BatchSize` (`OutboxSettings.cs:16-17`): `[Range(1, 1000)]`, default 50; messages processed per
    polling cycle.
  - `MaxRetries` (`OutboxSettings.cs:20-21`): `[Range(1, 20)]`, default 5; attempts before a message
    is considered failed.
  - `PollingIntervalSeconds` (`OutboxSettings.cs:30-31`): `[Range(1, 3600)]`, default 2; the fallback
    interval / safety net described above.
  - `ProcessingDelaySeconds` (`OutboxSettings.cs:39-40`): `[Range(0, 600)]`, default 5; eligibility
    delay after message creation that bounds the duplicate-dispatch window.
  - `DataSource` (`OutboxSettings.cs:48`): `DataSource` enum, default `DataSource.SQLServer`; the
    engine of the outbox write target, which must be a relational provider (SQL Server or SQLite).
  - `DatabaseName` (`OutboxSettings.cs:57`): string, default `DataSourceKey.DefaultName`; the logical
    source name paired with `DataSource`.
  - `RetentionDays` (`OutboxSettings.cs:64-65`): `[Range(0, 3650)]`, default 7; days a processed
    message is kept before purge, with `0` disabling purging (rows kept indefinitely, the pre-1.x
    behavior) per `OutboxSettings.cs:59-62`.
  - `CleanupIntervalHours` (`OutboxSettings.cs:72-73`): `[Range(1, 168)]`, default 6; how often the
    purge sweep runs, ignored when `RetentionDays` is `0`.

- **Why it's built this way**: the defaults encode the framework's out-of-the-box posture ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)
  outbox, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service): a monolith with no `Outbox` section gets a working
  at-least-once processor writing to its single default database, while a multi-service deployment
  overrides `PollingIntervalSeconds`, `DataSource`, and `DatabaseName` to tune cost and routing. The
  `[Range]` guards give fail-fast validation at bind time rather than a bad value surfacing mid-cycle.

- **Where it's used**: consumed by the outbox background services
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (drain and dispatch) and
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (retention purge), which
  read these values to size batches, pace retries, choose the write target, and schedule cleanup over
  the [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) rows.

### GetUserPreferencesQuery

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.GetPreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5` · Level 1 · record (sealed)

- **What it is**: the one-line CQRS query that asks for a single user's stored UI preferences (culture
  and theme). It is a positional `sealed record` with exactly one member, `UserId`, and it implements
  [`IUserScopedRequest`](#iuserscopedrequest) (`GetUserPreferencesQuery.cs:5`).

- **Depends on**: [`IUserScopedRequest`](#iuserscopedrequest) (the `UserId` contract the shared Users
  use-case bases read a target account through) and the solution-wide `UserIdentifierType` alias for
  the identifier. No externals.

- **Concept introduced: a request record shared across apps, where the commands are not.** This is the
  only Users use-case request type in the framework that both applications share verbatim. The three
  sibling write operations keep an app-side command record, because ADC marks its commands
  [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a cache prefix built from
  its own `User` type (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14-19`)
  and Store does not (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:11-12`).
  The read path has no such per-app decision, so the query itself was hoisted into the framework and
  the shared controller constructs it directly (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:25-29`,
  `:150`). Reading that difference back off the declaration is the fastest way to see which parts of a
  vertical slice a framework can own and which it cannot.

  `[Rubric §6: CQRS & Event-Driven]` assesses whether reads and writes travel separate, explicitly
  modeled paths. This type is the read half of the preferences slice: a dedicated query record routed
  to a dedicated [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), never a
  method on a shared service. Note what it does **not** implement: there is no
  [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) in its base list
  (`GetUserPreferencesQuery.cs:5`), so the Caching decorator passes it straight through to the handler
  and a preference write is always immediately visible on the next read.

  `[Rubric §9: API & Contract Design]` assesses how deliberately request/response shapes are modeled.
  The query carries only the account identifier; the caller's identity is resolved by the controller
  from the authenticated principal rather than being accepted from the wire, so the query cannot be
  used to read someone else's preferences by construction.

- **Walkthrough**: a single positional parameter.
  - `UserId` (`GetUserPreferencesQuery.cs:5`): the account whose preferences to read, typed as the
    module's `UserIdentifierType` alias. Implementing `IUserScopedRequest` is what makes the record
    legible to the shared workflow (`GetUserPreferencesHandlerBase.cs:40` reads `query.UserId`).
  - The XML docs (`GetUserPreferencesQuery.cs:3-4`) tie the type to [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)
    (multi-locale i18n) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)
    (dark theme mode), the two features whose per-user choice this query returns.

- **Why it's built this way**: preferences must follow a user across devices, which means they live in
  the database rather than in browser storage, which in turn means a query. Keeping that query a record
  with one member (rather than folding the read into an existing profile query) keeps the slice
  independently cacheable, independently decorated, and independently testable.

- **Where it's used**: constructed by
  [`UserAccountAuthControllerBase`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
  in its `GET preferences` action (`UserAccountAuthControllerBase.cs:138-156`), and handled by
  [`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser) through the app
  subclasses (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13-14`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13`).
  ADC's architecture fitness suite also uses it as the representative query when asserting the
  decorator order (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:20`,
  `:27`).

### ChangePasswordHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePassword` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24` · Level 8 · class (abstract)

- **What it is**: the shared password-rotation workflow, doubly generic in the app's `User` aggregate
  and in the app's change-password command record. It verifies the current password, hashes the new
  one, lets the aggregate apply its own invariants, and persists only when the aggregate agreed
  (`ChangePasswordHandlerBase.cs:42-70`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) plus `ILogger` (constructor,
  `ChangePasswordHandlerBase.cs:24-27`); it implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  closed over [`Result`](group-01-result-error-handling.md#result) (`:27`). Its constraints pull in
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) for `TUser` (`:28`), and
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) closed over
  [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) for `TCommand` (`:29`). It writes
  its log line through [`UserUseCaseLog`](#userusecaselog) (`:66`) and its failures through
  [`Error`](group-01-result-error-handling.md#error) (`:52`, `:57-58`). Externals:
  `Microsoft.Extensions.Logging` (`:1`).

- **Concept introduced: the hoisted handler base (template method across two applications).** This is
  the first of four Users use-case bases in this group, so the shape is worth learning once. Both apps
  had a line-identical copy of this handler; only the log message text differed
  (`ChangePasswordHandlerBase.cs:11-15`). The framework cannot simply own the whole handler, because
  each app needs its own command record and its own error `source` string. The pattern that resolves
  both is a **generic abstract base with two extension points**:
  1. The command type is a type parameter constrained to a contract
     ([`IUserScopedCommand`](#iuserscopedcommandout-trequest)), so the app keeps its record with its own
     pipeline markers and the base only reads `UserId` and `Request` (`:29`, `:49`, `:55`, `:61`).
  2. `HandlerName` is a `protected virtual` property defaulting to `GetType().Name` (`:39`). Because
     the app subclass keeps the pre-hoist class name (`ChangePasswordHandler`), every error the base
     returns still reports the exact `source` string clients were already matching on (`:34-38`).

  The DI registration and pipeline behavior are unaffected by the hoist: the subclass is what
  `ScanModuleApplicationServices<TAssemblyMarker>()` discovers, and the decorators wrap the subclass.
  The same shape recurs in [`ChangePreferencesHandlerBase<TUser, TCommand>`](#changepreferenceshandlerbasetuser-tcommand),
  [`DeleteUserHandlerBase<TUser, TCommand>`](#deleteuserhandlerbasetuser-tcommand) and
  [`GetUserPreferencesHandlerBase<TUser>`](#getuserpreferenceshandlerbasetuser).

  `[Rubric §1: SOLID]` assesses whether types are open to extension and closed to modification and
  whether they depend on abstractions. The base depends on `TUser` only through
  [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser) and on `TCommand` only through
  [`IUserScopedCommand`](#iuserscopedcommandout-trequest) (`:28-29`): an app adds behavior by
  implementing those interfaces on its own types, never by editing the framework.

  `[Rubric §11: Security]` assesses credential handling and authorization. Three details matter here.
  The current password is verified before anything is written (`:55`), and a mismatch returns a
  deliberately generic `Auth.InvalidCurrentPassword` unauthorized error (`:57-58`) rather than
  distinguishing "no such user" from "wrong password" at the message level. Hashing is delegated
  entirely to [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), which returns a fresh
  `(Hash, Salt)` pair per call (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:11`),
  so a password change rotates the salt as well as the hash ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)).
  And the plaintext never reaches the aggregate: only the hash and salt bytes are handed to
  `ChangePassword` (`:61-62`).

- **Walkthrough**: a primary constructor, two protected members, one method.
  - Declaration (`ChangePasswordHandlerBase.cs:24-29`): primary constructor takes
    `IUnitOfWork unitOfWork`, `IPasswordHasher passwordHasher`, `ILogger logger`; implements
    `ICommandHandler<TCommand, Result>`. Note the logger is the non-generic `ILogger`: the subclass
    injects `ILogger<ItsOwnHandler>` so the log **category** stays the app handler's, while the message
    text lives once in [`UserUseCaseLog`](#userusecaselog) (`UserUseCaseLog.cs:5-9`).
  - `UnitOfWork` (`:32`): the captured unit of work re-exposed `protected` so an app-level extension can
    enlist further aggregates in the same save.
  - `HandlerName` (`:39`): `protected virtual`, defaults to `GetType().Name`, the error `source`.
  - `HandleAsync` (`:42-70`):
    - `ArgumentNullException.ThrowIfNull(command)` (`:46`): the one place the handler throws rather
      than returning a failure, because a null command is a programming error, not a business outcome.
    - `unitOfWork.GetRepository<TUser, UserIdentifierType>()` then `GetByIdAsync` (`:48-49`): the
      read-write repository, because this path will save.
    - Missing user returns `Error.NotFound` stamped with the handler name and the `TUser` type name as
      target (`:50-53`), so the payload names the aggregate that was missing.
    - `passwordHasher.VerifyPassword(command.Request.CurrentPassword, user.PasswordHash, user.PasswordSalt)`
      (`:55`): the current-credential check. On failure, an unauthorized `Result` (`:57-58`).
    - `passwordHasher.HashPassword(command.Request.NewPassword)` deconstructed into `(newHash, newSalt)`
      (`:61`), then `user.ChangePassword(newHash, newSalt)` (`:62`): the aggregate owns the invariant and
      returns its own [`Result`](group-01-result-error-handling.md#result).
    - Persist and log only on success (`:63-67`): `SaveChangesAsync` first, then
      `UserUseCaseLog.PasswordChanged(logger, command.UserId)`. The aggregate's failure is returned
      unchanged (`:69`), so a domain rule surfaces with the domain's own error, not a handler-invented
      one.

- **Why it's built this way**: two applications with identical code and divergent decoration is exactly
  the case a generic base solves without a shared command record. Persisting only when
  `result.IsSuccess` keeps the handler honest even outside a transaction; inside one, the
  [`TransactionalCommandDecorator`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult)
  rolls back on a `Result.Failure` too ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).
  Delegating hashing to an injected abstraction is what lets [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)
  change the algorithm without touching this workflow.

- **Where it's used**: subclassed once per application:
  [`ChangePasswordHandler`](group-24-identity-module.md#changepasswordhandler) in ADC
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:21`)
  and in Store
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:20`),
  both empty subclasses that exist only to bind the type arguments and preserve the class name. The
  base itself is covered directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:15`,
  which drives it through a local test subclass (`:123`).

### ChangePreferencesHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.ChangePreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23` · Level 8 · class (abstract)

- **What it is**: the shared preference-write workflow. It loads the user, merges the request over the
  stored values, lets the aggregate validate the result, and persists on success
  (`ChangePreferencesHandlerBase.cs:40-63`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `ILogger`
  (constructor, `:23-25`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:25`). `TUser` is constrained to
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  plus [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:26`); `TCommand` to
  [`IUserScopedCommand<out TRequest>`](#iuserscopedcommandout-trequest) over
  [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) (`:27`). Logs through
  [`UserUseCaseLog`](#userusecaselog) (`:59`).

- **Concept introduced**: none new. This is the hoisted-handler-base shape introduced in
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand): app-side
  command record behind a contract, `HandlerName` preserving the pre-hoist error `source` (`:37`).
  What is worth studying here is the **merge rule**, which is the whole reason this is a workflow and
  not a setter.

  `[Rubric §27: i18n]` assesses how deliberately localization state is modeled and persisted. The
  culture half of this command is the server-side persistence step of
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html): a returning user's language
  choice is stored on the account, so it follows them across devices rather than living only in the
  browser.

  `[Rubric §16: Maintainability]` assesses whether behavior that is easy to get wrong is expressed once.
  The null-coalescing merge (`:53-55`) is that behavior: the app bar's culture switcher sends only
  `Culture` and the theme toggle sends only `Theme`, and passing `null` straight through would clear the
  other preference. Writing the merge in exactly one place means neither app can regress it, and the
  contract is documented on the request record itself
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:3-6`) and on the
  aggregate interface (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:18-21`).

- **Walkthrough**:
  - Declaration (`ChangePreferencesHandlerBase.cs:23-27`): primary constructor `(IUnitOfWork, ILogger)`,
    no hasher (nothing here is credential material).
  - `UnitOfWork` (`:30`) and `HandlerName` (`:37`): the same two protected members as its password
    sibling.
  - `HandleAsync` (`:40-62`):
    - Null guard (`:44`), read-write repository and `GetByIdAsync` (`:46-47`), `Error.NotFound` stamped
      with handler name and `TUser` name when the account is gone (`:50`).
    - The merge and the domain call (`:53-55`):
      `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)`.
      Both fields are read off the tracked aggregate, so an omitted field is written back as the value
      it already had. The aggregate returns its own `Result`, so an invalid culture or theme fails as a
      domain rule.
    - Persist and log only on success (`:56-60`), then return the aggregate's result unchanged (`:62`).

- **Why it's built this way**: the two apps carried line-identical copies of this handler (`:11-14`),
  differing only in whether the command opts into cache invalidation, which is a property of the record
  and not of the workflow (`:16-20`). Hoisting the workflow and leaving the record app-side preserves
  ADC's `ICacheInvalidating` prefix
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14-18`)
  while Store keeps a bare command
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:11-12`).
  Theme persistence is [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html); culture
  persistence is [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).

- **Where it's used**: subclassed as
  [`ChangePreferencesHandler`](group-24-identity-module.md#changepreferenceshandler) in ADC
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17-21`,
  an empty subclass) and in Store
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:19`).
  Dispatched from
  [`UserAccountAuthControllerBase`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)'s
  `PUT preferences` action (`UserAccountAuthControllerBase.cs:117-132`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:16`.

### DeleteUserHandlerBase<TUser, TCommand>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.DeleteUser` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38` · Level 8 · class (abstract)

- **What it is**: the shared account-erasure workflow: authorize owner-or-privileged-role, soft-delete
  the account, run the app's tail, irreversibly anonymize the personal data in place, persist, then run
  the queued post-commit actions (`DeleteUserHandlerBase.cs:55-119`). It is the most extension-heavy of
  the four Users bases, with one abstract member and one virtual hook.

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `ILogger`
  (constructor, `:38-40`); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  over [`Result`](group-01-result-error-handling.md#result) (`:40`). `TUser` is constrained to
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  plus [`IErasableUser`](group-08-auth.md#ierasableuser) (`:41`), which itself extends
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable); `TCommand` to
  [`IUserOwnedRequest`](#iuserownedrequest) (`:42`). Authorization is delegated to
  [`UserOwnershipRule`](#userownershiprule) (`:62-67`) and logging to
  [`UserUseCaseLog`](#userusecaselog) (`:116`).

- **Concept introduced: erase-in-place with an ordered app tail.** Two mechanisms here appear nowhere
  else in this group and are both load-bearing.

  First, **interface dispatch as a correctness requirement**. The workflow assigns the loaded aggregate
  to a local of the interface type before calling `Delete()`:
  `IErasableUser erasable = user;` (`:88-89`). The comment above it explains why (`:83-87`): member
  lookup on a generic type parameter prefers the members of its **class** constraint, so a bare
  `user.Delete()` would bind to `AuditableBaseEntity<TId>.Delete()`. ADC's `User` **hides** that method
  (`public new Result Delete()`) to also revoke the refresh token, and a hidden method is not an
  override, so the app behavior would be silently skipped. Going through the interface makes the
  interface map resolve to the most derived `Delete()` the app type declares. This is a genuinely
  subtle C# rule and the framework encodes it once
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:13-23`); the base entity
  deliberately does not implement `IErasableUser`, so an app that forgets the interface fails the
  generic constraint at compile time instead of losing behavior at run time (`IErasableUser.cs:25-28`).

  Second, the **`afterCommit` queue**. The virtual hook receives an
  `ICollection<Func<CancellationToken, Task>>` (`:95`, `:145`) rather than running side effects inline.
  A subclass captures whatever it needs while the personal data is still intact, appends a closure, and
  the base drains the queue in order only after `SaveChangesAsync` returned (`:109-114`). That is how an
  app deletes a blob or writes a cache marker without risking the side effect firing for an erasure
  that never committed.

  `[Rubric §30: Compliance / Privacy / Data Governance]` assesses whether privacy obligations are
  implemented rather than asserted. This workflow is the code behind the "delete within 30 days"
  erasure promise: the row is soft-deleted (preserving cross-context scalar references and the audit
  trail) and its personal data is then irreversibly overwritten in place
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), which is exactly the
  compromise the ADR describes (`DeleteUserHandlerBase.cs:10-15`).

  `[Rubric §11: Security]` assesses authorization placement. The ownership decision runs first, before
  the aggregate is even loaded (`:62-71`), and the role bypass is passed in already evaluated, because
  role vocabulary is per app (ADC Organizer, Store Admin). Failing before the read means an unauthorized
  caller cannot use the handler as an existence oracle.

  `[Rubric §1: SOLID]` assesses extension without modification. Everything app-specific is a member the
  subclass supplies: `HasDeletePrivilege` (abstract, `:127`) and `OnAfterSoftDeleteAsync` (virtual,
  defaulting to success, `:142-147`).

- **Walkthrough**:
  - Declaration (`:38-42`): primary constructor `(IUnitOfWork, ILogger)`, `UnitOfWork` re-exposed
    `protected` (`:45`) precisely so the hook can enlist further aggregates, and `HandlerName` (`:52`).
  - `HandleAsync` (`:55-119`), in order:
    1. Null guard (`:59`).
    2. Ownership (`:62-71`): `UserOwnershipRule.CheckOwnership(command, HasDeletePrivilege(command.CurrentUserRole), code: "User.DeleteForbidden", ...)`
       returns `null` when allowed, otherwise the forbidden `Error` to fail with.
    3. Load through the read-write repository (`:73-74`); `Error.NotFound` if the account is gone
       (`:75-78`).
    4. Soft-delete through the interface (`:88-89`) and return the aggregate's failure unchanged if it
       refuses, for example because the account was already deleted (`:90-93`).
    5. Allocate the post-commit queue (`:95`) and run the app tail
       `OnAfterSoftDeleteAsync(user, command, afterCommit, cancellationToken)` (`:96`); a failure here
       aborts before anything is persisted (`:97-100`). The tail deliberately runs **after** `Delete()`
       so an already-deleted account fails with the account's own error rather than with a cascaded
       aggregate's (`:30-34`).
    6. `erasable.Anonymize()` (`:103`), the irreversible step, again returning its own failure if the
       aggregate refuses (`:104-107`).
    7. `SaveChangesAsync` (`:109`): soft-delete, anonymization and anything the tail enlisted commit as
       one unit of work.
    8. Drain `afterCommit` in insertion order (`:111-114`), log the erasure (`:116`), return success
       (`:118`).
  - `HasDeletePrivilege(string? currentUserRole)` (`:127`): abstract, one line per app.
  - `OnAfterSoftDeleteAsync(...)` (`:142-147`): virtual, returns success by default, documented as the
    only point where an app can both read personal data that anonymization is about to erase and enlist
    further aggregates in the same unit of work (`:20-28`).

- **Why it's built this way**: the two applications need genuinely different tails, and both are
  instructive. ADC captures the avatar blob name **before** anonymization clears the URL, then queues a
  best-effort soft-deleted cache marker and the blob delete for after the commit, swallowing a cache
  fault so it cannot turn a successful erasure into a failure the caller would retry
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:42-76`).
  Store splits authentication from profile, so its tail loads the linked `Customer` through
  `UnitOfWork.GetRepository` and deletes plus anonymizes it in the same unit of work, returning the
  Customer's own failure so nothing is persisted
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:35-60`).
  Neither could be expressed by a parameter; both fit the hook.
  [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) is the governing
  decision.

- **Where it's used**: subclassed as [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler)
  in ADC (`.../DeleteUser/DeleteUserHandler.cs:25-30`) and in Store
  (`.../DeleteUser/DeleteUserHandler.cs:20-23`). Covered directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:14`, whose
  test double is deliberately a user type that **hides** `Delete()`
  (`TestHidingDeleteUser`, `:196`), pinning the interface-dispatch behavior described above.

- **Caveats / not-in-source**: whether the whole `HandleAsync` body runs inside a database transaction
  depends on the app command implementing [`ITransactional`](group-05-cqrs-pipeline.md#itransactional),
  which is a property of the app-side record, not of this base. Neither app's `DeleteUserCommand`
  declares it in its base list
  (`MMCA.ADC/.../DeleteUser/DeleteUserCommand.cs:11-14`, `MMCA.Store/.../DeleteUser/DeleteUserCommand.cs:14-17`),
  so the atomicity you get here is the unit of work's single `SaveChangesAsync`, not a decorator
  transaction.

### GetUserPreferencesHandlerBase<TUser>

> MMCA.Common.Application · `MMCA.Common.Application.Users.UseCases.GetPreferences` · `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21` · Level 8 · class (abstract)

- **What it is**: the shared preference-read workflow, and the only one of the four Users bases that is
  generic in the user aggregate **alone**. It loads the account through the read repository and projects
  its two preference fields into a response (`GetUserPreferencesHandlerBase.cs:33-45`).

- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (constructor, `:21`);
  implements [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  closed over [`GetUserPreferencesQuery`](#getuserpreferencesquery) and
  `Result<`[`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse)`>` (`:22`). `TUser` is
  constrained to [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  plus [`IUserPreferences`](group-08-auth.md#iuserpreferences) (`:23`). No logger, no hasher: a read has
  nothing to announce.

- **Concept introduced**: none new; this is the read-side instance of the hoisted-base shape from
  [`ChangePasswordHandlerBase<TUser, TCommand>`](#changepasswordhandlerbasetuser-tcommand). Two
  differences from its write siblings are the teaching points.

  First, **only one type parameter**. Because the query record was shareable
  ([`GetUserPreferencesQuery`](#getuserpreferencesquery)), there is no `TCommand`. That is the visible
  payoff of the query having no per-app pipeline markers.

  Second, **a weaker entity constraint that follows from the repository choice**. The write bases
  constrain `TUser` to `AuditableAggregateRootEntity<TIdentifierType>` because
  `IUnitOfWork.GetRepository` requires an aggregate root
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:19-21`).
  This base uses `GetReadRepository`, which accepts any `AuditableBaseEntity<TIdentifierType>`
  (`IUnitOfWork.cs:29-31`), so its constraint relaxes to match (`:23`). Constraint strength here is a
  consequence of which repository the workflow needs, not a style choice.

  `[Rubric §12: Performance & Scalability]` assesses whether read paths avoid unnecessary work. The XML
  remark records that the two app copies disagreed on this exact point (ADC used the read repository,
  Store the write one) and that the read repository is the correct choice for a query handler, which
  never calls `SaveChangesAsync`, so Store picked up a no-tracking read when it adopted the base
  (`GetUserPreferencesHandlerBase.cs:15-19`). Hoisting a workflow is how a divergence like that gets
  resolved once instead of twice.

  `[Rubric §3: Clean Architecture]` assesses dependency direction. The handler sits in Application and
  touches persistence only through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the
  domain only through [`IUserPreferences`](group-08-auth.md#iuserpreferences): no EF type, no app type,
  nothing from a layer above.

- **Walkthrough**:
  - Declaration (`:21-23`): primary constructor `(IUnitOfWork unitOfWork)`; implements
    `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>`.
  - `HandlerName` (`:30`): the same `protected virtual` default (`GetType().Name`) the write bases use,
    so an app subclass keeping the name `GetUserPreferencesHandler` reports the identical error `source`
    (`:25-29`).
  - `HandleAsync` (`:33-45`):
    - Null guard (`:37`).
    - `unitOfWork.GetReadRepository<TUser, UserIdentifierType>()` then
      `GetByIdAsync(query.UserId, cancellationToken)` (`:39-40`).
    - A single ternary produces the outcome (`:41-44`): a missing account yields
      `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)`; otherwise
      `Result.Success(new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme))`, a manual
      two-field projection rather than a mapper ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
      A `null` field in the response means the user never chose that preference
      (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/UserPreferencesResponse.cs:3-5`).

- **Why it's built this way**: the query and the response were byte-identical in both Identity modules
  (`:10-14`), so the only thing left to parameterize was the aggregate. Keeping `HandlerName` virtual
  preserves the wire-visible error payload across the hoist, which matters because clients match on the
  `source` string
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:8-12`).

- **Where it's used**: subclassed as
  [`GetUserPreferencesHandler`](group-24-identity-module.md#getuserpreferenceshandler) in ADC
  (`.../GetPreferences/GetUserPreferencesHandler.cs:13-14`) and in Store
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13`),
  both empty. Its result is returned by
  [`UserAccountAuthControllerBase`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)'s
  `GET preferences` action (`UserAccountAuthControllerBase.cs:142-156`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:14`.


---
[⬅ gRPC & Inter-Service Contracts](group-13-grpc-contracts.md)  •  [Index](00-index.md)  •  [Common UI Framework (MudBlazor components, theme, base pages) ➡](group-15-common-ui-framework.md)
