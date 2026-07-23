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
[`UseDatabaseAttribute`](#usedatabaseattribute)); and the whole **Settings** family,
[`ApplicationSettings`](#applicationsettings) / [`ModulesSettings`](#modulessettings) /
[`ModuleSettings`](#modulesettings) in Application, and the Infrastructure bindings
([`ConnectionStringSettings`](#connectionstringsettings), [`DataSourcesSettings`](#datasourcessettings),
[`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](#outboxsettings), the JWT/JWKS group,
[`SmtpSettings`](#smtpsettings), [`PushNotificationSettings`](#pushnotificationsettings)). The detailed
per-type sections follow; this overview shows how they fit together at runtime.

`[Rubric §7, Microservices Readiness]` (assesses whether modules can be enabled, disabled, and
deployed independently with minimal coupling) is the lens this whole chapter is built around, the
module system is *the* boundary that lets MMCA.ADC run as either a single monolith host or four
separate service processes from the **same module code**, configuration-switched. `[Rubric §10,
Cross-Cutting Concerns]` and `[Rubric §3, Clean Architecture]` also run throughout: composition is
where the inward-pointing dependency rule gets physically realized (Infrastructure references
Application references Domain references Shared), and where cross-cutting concerns are registered once
for every module rather than per-feature. The two ADRs that explain *why* this shape exists are
ADR-008 (service-extraction topology) and ADR-006 (database-per-service).

## The module contract and the boundary it creates

A **module** is the unit of cohesion above a feature slice, Conference, Engagement, Identity,
Notification. Each one implements [`IModule`](#imodule)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7`): a display `Name`
(`IModule.cs:12`), an optional `Dependencies` list of other module names (`IModule.cs:17`), a
`RequiresDependencies` flag (`IModule.cs:23`), and one `Register(services, configuration,
applicationSettings)` method (`IModule.cs:28`) that wires *all* of that module's services. The
interface ships three default-implemented members (`Dependencies => []`, `RequiresDependencies =>
false`, and an empty-bodied `RegisterDisabledStubs` at `IModule.cs:34`), so a minimal module only
implements `Name` and `Register`. ADC's modules are deliberately thin, `ConferenceModule`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:15`) is barely more
than a dozen lines: its `Register` just forwards to an `AddConferenceModule(applicationSettings)`
extension method (`ConferenceModule.cs:28-29`), and its `RegisterDisabledStubs`
(`ConferenceModule.cs:21-25`) registers a `DisabledSessionBookmarkValidationService` and a
`DisabledEventLiveValidationService` so a host that *disables* Conference still has those cross-module
contract types resolvable in DI.

That last detail is the crux of the extraction boundary. `RegisterDisabledStubs` plus
`RequiresDependencies` is what makes the same module code boot in two topologies. When Conference runs
in its own service the Engagement module is *disabled* in that host's config, yet Conference's
`GetSessionBookmarkCountHandler` still needs Engagement's `IBookmarkCountService`, so the disabled
Engagement module contributes a stub, and the host then *replaces* that stub with a typed gRPC client
pointed at the real Engagement process. Application code never learns which path it got; the transport
choice lives entirely at the composition edge (ADR-008). `[Rubric §2, Design Patterns]` applies here,
this is a clean strategy/null-object pairing (real service vs. disabled stub vs. remote client) rather
than scattered `if (moduleEnabled)` checks.

## Discovery and Kahn-ordered registration

[`ModuleLoader`](#moduleloader)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15`) is the engine. Its
`DiscoverAndRegister` method scans every loaded assembly via `AppDomain.CurrentDomain.GetAssemblies()`
(guarding each `GetTypes()` call against `ReflectionTypeLoadException` so one broken assembly does not
abort the scan, `ModuleLoader.cs:60-73`), instantiates every concrete [`IModule`](#imodule) and
[`IModuleSeeder`](#imoduleseeder) it finds (`ModuleLoader.cs:75-83`), then runs **Kahn's topological
sort** (`ModuleLoader.cs:193-243`) over the modules' declared `Dependencies`. Kahn's algorithm is BFS
over a dependency graph: compute each module's in-degree (count of unprocessed dependencies), seed a
queue with the zero-in-degree modules, and as each is emitted decrement its dependents' in-degrees,
enqueuing any that reach zero. If fewer modules come out than went in, the remainder form a cycle and
the loader throws with the offending names (`ModuleLoader.cs:235-240`). The payoff is an ordering where
a module's DI registrations always exist *before* any dependent registers, which matters because the
CQRS decorator pipeline (next section) wraps handlers that must already be in the container.

For each sorted module the loader checks
[`ModulesSettings.IsModuleEnabled`](#modulessettings) (`ModuleLoader.cs:90`); a disabled module gets
`RegisterDisabledStubs` called and is recorded in `DisabledModuleNames`
(`ModuleLoader.cs:92-95`), while an enabled one runs `ValidateModuleDependencies` then
`RegisterEnabledModule` (`ModuleLoader.cs:98-99`). Registration is also where **per-module
configuration** is loaded by convention: before calling `module.Register(...)` the loader adds
`modules.{name}.json` (and `modules.{name}.{environment}.json` when an environment name is passed) to
the configuration builder (`ModuleLoader.cs:154-161`), so a module can ship its own config file.
Dependency validation (`ModuleLoader.cs:108-141`) is microservice-aware: a dependency that is disabled
in-process but listed in that consumer's [`ModuleSettings`](#modulesettings) `RemoteDependencies` is
treated as *satisfied remotely* (the host will wire a gRPC client), and only a `RequiresDependencies =
true` module with a genuinely unsatisfied dependency throws (`ModuleLoader.cs:122-130`). Every step
emits a structured `[LoggerMessage]`-generated log (`ModuleLoader.cs:245-261`), so the startup log
tells you exactly which modules loaded, in what order, and how long each took.

A subtlety worth stating against the source: the loader is **not** called from inside
`AddApplication()`. Each host's `Program.cs` constructs a `ModuleLoader`, calls `DiscoverAndRegister`
directly, then registers the loader instance itself as a singleton, see
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:239-244`. After discovery the loader
also drives startup data via `SeedAllAsync` (`ModuleLoader.cs:177-183`), which invokes each enabled
module's [`IModuleSeeder.SeedAsync`](#imoduleseeder) in registration order (this is how Identity seeds
its default admin user). `IModuleSeeder` is a tiny two-member interface, `ModuleName` (matched
case-insensitively to an [`IModule`](#imodule) `Name`) and `SeedAsync(serviceProvider,
cancellationToken)`, deliberately separate from `IModule` so seeding runs *after* the whole container
is built and a real `IServiceProvider` exists.

## The two composition roots and the ordering they enforce

Service registration itself lives in two static [`DependencyInjection`](#dependencyinjection) classes,
each using a C# `extension(IServiceCollection services)` block (see
[primer §4](../00-primer.md#4-c-build-and-code-style-conventions) for the `extension(T)` syntax). The
**Application** root
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:21`) exposes `AddApplication()`
(core services: the domain-event dispatcher, navigation-metadata provider, query pipeline, and the
common validators, `DependencyInjection.cs:29-43`), `ScanModuleApplicationServices<TMarker>()` (the
Scrutor convention scan that a module's `AddXModule` calls to register its event handlers, DTO/request
mappers, command/query handlers, and FluentValidation validators by assembly,
`DependencyInjection.cs:115-179`), and `AddApplicationDecorators()`. The **Infrastructure** root
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:38`) exposes
`AddInfrastructure(configuration)` (`DependencyInjection.cs:48`), which binds nearly every settings
type in this chapter, registers the persistence stack (the data-source resolver/registry, the
DbContext factories, repositories, unit of work), caching, auth, and the outbox hosted services, plus
the optional `AddBrokerMessaging` (`DependencyInjection.cs:372`), `AddPushNotifications`
(`DependencyInjection.cs:253`), and the typed-client helper
`AddTypedServiceClient<TInterface, TImplementation>(serviceName)` (`DependencyInjection.cs:441`) that
swaps an in-process abstraction for a cross-process transport.

The **order** of these calls is a hard contract in exactly one respect, and it is the reason
`AddApplicationDecorators()` must come *last*. Decorators are registered with **Scrutor's
`TryDecorate`**, which wraps *existing* registrations (`DependencyInjection.cs:94-103`), so the
concrete handlers from every module must already be in the container, or there is nothing to wrap.
Beyond that, the relative position of `AddInfrastructure` and `AddAPI` is not load-bearing. `[Rubric
§6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` (open/closed) live here: cross-cutting behavior is
added by wrapping, not by editing handlers. `AddApplicationDecorators` also encodes the **execution
order** via `TryDecorate`'s reverse-registration rule (registered innermost-first,
`DependencyInjection.cs:94-103`), so the command pipeline ends up
`FeatureGate → Logging → Caching → Validating → Transactional → handler`, and queries
`FeatureGate → Logging → Caching → handler`. The decorator types themselves
(e.g. [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
[`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult))
are documented in the CQRS-pipeline chapter; this chapter only owns the *wiring* of them. An optional
profiling pair is registered separately by an opt-in `AddApplicationProfiling()`
(`DependencyInjection.cs:186-192`), not by `AddApplicationDecorators()`.

## Assembly anchors

Several pieces of machinery need a `Type` whose `Assembly` identifies a layer: Scrutor's
`FromAssemblyOf<T>()` scans, FluentValidation's `AddValidatorsFromAssemblyContaining<T>()`, and
NetArchTest's per-package anchor. That is what the [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) pairs are, one per layer (Domain, Application, Infrastructure),
each a trivial `static class AssemblyReference` holding `Assembly` / `AssemblyName` statics
(`AssemblyReference.cs:7-8`) plus a non-static `class ClassReference` (`AssemblyReference.cs:11`) used
where a generic constraint forbids a static type. `AddApplication` scans the common validators via
`AddValidatorsFromAssemblyContaining<ClassReference>()`
(`MMCA.Common.Application/DependencyInjection.cs:40`), and `AddInfrastructure` Scrutor-scans entity
configurations via `FromAssemblyOf<ClassReference>()`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:106-110`). They are deliberately behavior-free;
their whole job is to *name an assembly* for the scanning and governance tooling.

## Configuration binding, the Settings family

Everything a host operator tunes arrives as a strongly-typed settings object bound from an
`appsettings.json` section, each carrying a `static readonly string SectionName` so the section name
lives next to the shape it binds. The pattern in `AddInfrastructure` is uniform:
`services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
(e.g. `ConnectionStringSettings` at
`MMCA.Common.Infrastructure/DependencyInjection.cs:60-63`), so misconfiguration **fails fast at
startup**, not lazily on first use. `[Rubric §13, Observability & Operability]` and `[Rubric §15, Best
Practices]` apply: `ValidateOnStart` plus DataAnnotations ranges (e.g.
[`OutboxSettings`](#outboxsettings) `BatchSize` is `[Range(1, 1000)]`, `OutboxSettings.cs:16-17`) turn
config typos into immediate, descriptive boot failures.

The Application-layer settings drive composition itself: [`ApplicationSettings`](#applicationsettings)
(`UseMiniProfiler`, `MaxPageSize` default 500, `DatabaseInitStrategy` default `"Migrate"`,
`ApplicationSettings.cs:12-18`) is passed by value into every `IModule.Register`, and it is fronted by
the `IApplicationSettings` interface so consumers depend on the abstraction (registered as a singleton
over `IOptions<ApplicationSettings>` at `MMCA.Common.Application/DependencyInjection.cs:31`).
[`ModulesSettings`](#modulessettings) *is* a `Dictionary<string, ModuleSettings>` (section `"Modules"`,
`ModulesSettings.cs:7`) whose `IsModuleEnabled` / `IsDependencyRemote` helpers
(`ModulesSettings.cs:18-32`) the loader queries; [`ModuleSettings`](#modulesettings) carries the
per-module `Enabled` flag (default `true`, `ModuleSettings.cs:9`) and the `RemoteDependencies` list
(`ModuleSettings.cs:38`) that flips a dependency from "in-process" to "satisfied by an extracted
service". The Infrastructure settings cover the rest of the platform:
[`ConnectionStringSettings`](#connectionstringsettings) (the `Default` source, only
`SQLServerConnectionString` is `[Required]`, `ConnectionStringSettings.cs:24-25`);
[`DataSourcesSettings`](#datasourcessettings) / [`DataSourceEntrySettings`](#datasourceentrysettings)
(the named logical to physical source map for database-per-service, note `DataSourcesSettings` is built
*directly* from a `Get<Dictionary<...>>` rather than the options pipeline at
`MMCA.Common.Infrastructure/DependencyInjection.cs:68-70`, because a root-level dictionary section does
not bind through `AddOptions`, and its constructor rejects a reserved `"Default"` key at
`DataSourcesSettings.cs:34-39`); [`MessageBusSettings`](#messagebussettings) with its
[`MessageBusProvider`](#messagebusprovider) enum (`InProcess` / `RabbitMq` / `AzureServiceBus`,
`MessageBusSettings.cs:68-84`) that `AddBrokerMessaging` switches on; [`OutboxSettings`](#outboxsettings)
(batch size, polling/processing intervals, retention) consumed by the
[`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor); the JWT/JWKS group
([`JwtSettings`](#jwtsettings) / [`IJwtSettings`](#ijwtsettings) with its algorithm-aware
`IValidatableObject.Validate`, `JwtSettings.cs:16`, the [`JwtSigningAlgorithm`](#jwtsigningalgorithm)
enum, and [`JwksSettings`](#jwkssettings)) backing token signing and cross-service validation (ADR-004);
and [`SmtpSettings`](#smtpsettings) / [`PushNotificationSettings`](#pushnotificationsettings) for the
email and SignalR-push pipelines.

## The two routing attributes

Two attributes, both in `MMCA.Common.Infrastructure`, both `Inherited = true` so they ride down a
configuration class hierarchy, encode *where an entity is stored* declaratively, the per-entity half of
the database-per-service strategy (ADR-006).
[`UseDataSourceAttribute`](#usedatasourceattribute) (`UseDataSourceAttribute.cs:12-17`) names the
**engine** ([`DataSource`](group-07-persistence-ef-core.md#datasource): SQL Server / Cosmos / SQLite)
and is carried by the provider-specific configuration base classes, so choosing a base class chooses
the engine with no change to the entity (see
[primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
[`UseDatabaseAttribute`](#usedatabaseattribute) (`UseDatabaseAttribute.cs:22-26`) names the **logical
database** *on* that engine; its documented resolution order (`UseDatabaseAttribute.cs:9-14`) is the
attribute value, then the module name derived from the entity's namespace (the segment before
`Domain`), then `"Default"`. The persistence runtime
([`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry),
[`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver),
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)) reads these attributes up front
to map each entity to a physical source; those types are documented in the persistence chapter, but the
*markers* that feed them live here because they are part of how a module declares its composition.

## End-to-end: one host's boot

Reading `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs` top to bottom shows the whole
chapter cooperating. The host binds and validates [`ApplicationSettings`](#applicationsettings)
(`Program.cs:118-124`), calls `AddApplication()` then `AddInfrastructure(builder.Configuration)`
(`Program.cs:220-221`), binds [`ModulesSettings`](#modulessettings) and calls `AddAPI(modulesSettings)`
(`Program.cs:224-233`), then constructs a [`ModuleLoader`](#moduleloader) and calls
`DiscoverAndRegister(services, configuration, applicationSettings, modulesSettings, environmentName)`
before registering the loader as a singleton (`Program.cs:239-244`). Because this is the *Conference*
service, only the Conference module is `Enabled` in its config, every other discovered module takes the
`RegisterDisabledStubs` path. The host then patches the cross-process edges: it replaces the disabled
Engagement stub with a real gRPC client (`AddEngagementBookmarkCountClient()`, `Program.cs:254`) and
calls `AddBrokerMessaging(builder.Configuration, ...)` (`Program.cs:271-272`) so
[`MessageBusSettings`](#messagebussettings) `Provider` decides whether
[`IMessageBus`](group-04-events-outbox.md#imessagebus) stays the in-process implementation or becomes
the MassTransit-backed broker. Only then comes `AddApplicationDecorators()` (`Program.cs:274`), last,
so the decorators wrap the now-registered Conference handlers. Finally
`app.Services.InitializeDatabaseAsync(applicationSettings, moduleLoader)` (`Program.cs:295`) applies
migrations and runs the module seeders the loader collected. The exact same module assemblies, dropped
into a monolith host with all four modules `Enabled`, would Kahn-sort into one in-process graph with no
gRPC clients, which is precisely the reversibility ADR-008 is after.

### AssemblyReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` · Level 0 · class (static)
>
> *Also covers the identical Domain-layer copy:* MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8`.

- **What it is**: a tiny static class exposing the assembly that contains it plus that assembly's simple name, for use as a stable "anchor" when something needs to say *"scan the assembly this type lives in."* The framework ships one in every layer/module; this section covers the two copies in `MMCA.Common.Application` and `MMCA.Common.Domain` (byte-for-byte identical apart from namespace and the Domain copy's XML doc).

  | Type | File:Line | Notes (what differs) |
  |------|-----------|----------------------|
  | `AssemblyReference` (Application) | `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:5` | no XML doc |
  | `AssemblyReference` (Domain) | `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8` | carries the XML doc that states the Scrutor-scanning / architecture-test rationale |

- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies, that purity is why it sits at Level 0.

- **Concept introduced, assembly-marker types for convention scanning.** `[Rubric §2, Design Patterns]` assesses whether recurring problems are solved with recognised patterns; the marker (or "anchor") type is the idiomatic way to hand an `Assembly` to a scanner without coupling to an incidental concrete class. `[Rubric §1, SOLID]` (DIP): registration code depends on a deliberate token, not on `typeof(SomeRandomHandler).Assembly`, so renaming or moving any real type never breaks the scan. The same anchor is also consumed by the architecture-fitness maps (`CommonArchitectureMap`/`AdcArchitectureMap`, [group-25](group-27-testing-infrastructure.md)), one anchor type per package pins that package's assembly via `typeof(...AssemblyReference).Assembly` (this replaced the old `PackageAssemblies` test helper, now removed).

- **Walkthrough**: two `public static readonly` fields resolved once at type-initialization: `Assembly` via `typeof(AssemblyReference).Assembly`, and `AssemblyName` via `Assembly.GetName().Name` with a `?? string.Empty` null-coalescing fallback so the field is never null even if the runtime returns no simple name. The two copies differ only by the Domain copy's XML doc pushing the lines down: `Assembly`/`AssemblyName` sit at `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:7`/`:8` in the Application copy and at `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:10`/`:11` in the Domain copy.

- **Why it's built this way**: a purpose-built anchor decouples scanning from any business type; the pattern repeats in every package so each assembly is self-describing without cross-layer references (see the per-module copies in [`group-22`](group-22-engagement-module.md#assemblyreference) and [`group-23`](group-24-identity-module.md#assemblyreference)).

- **Where it's used**: DI registration via [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection) and `AddValidatorsFromAssemblyContaining<…>()`; the NetArchTest architecture tests' assembly pinning.

---

### ClassReference
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` · Level 0 · class
>
> *Also covers the identical Domain-layer copy:* MMCA.Common.Domain · `MMCA.Common.Domain` · `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:18`.

- **What it is**: the non-static companion to [`AssemblyReference`](#assemblyreference): an empty, instantiable class used wherever a *generic type parameter* needs an assembly anchor and a static class won't satisfy the constraint.

  | Type | File:Line | Notes (what differs) |
  |------|-----------|----------------------|
  | `ClassReference` (Application) | `MMCA.Common/Source/Core/MMCA.Common.Application/AssemblyReference.cs:11` | no XML doc |
  | `ClassReference` (Domain) | `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:18` | XML doc states it is the anchor "when `AssemblyReference` cannot be used (e.g., generic type constraints that require a non-static class)" |

- **Depends on**: nothing first-party; nothing from the BCL beyond `object`.

- **Concept**: the companion half of the marker pattern introduced under [`AssemblyReference`](#assemblyreference). C# **static classes cannot be used as generic type arguments**, but several registration helpers are constrained to an instantiable reference type, notably [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection), whose `TAssemblyMarker : class` constraint forbids a static type. `ClassReference` fills that slot without weakening `AssemblyReference`'s static-ness. `[Rubric §33, Developer Experience]` assesses how easy the inner loop is: a single conventional token (`ScanModuleApplicationServices<ClassReference>()`) is the entire registration ceremony a new module needs.

- **Walkthrough**: `public class ClassReference { }` (Application `:11`, Domain `:18`), no members. It exists purely as a `where T : class` type argument; its only meaningful property is the assembly it belongs to (read via `typeof(ClassReference).Assembly` inside the scanner).

- **Why it's built this way**: keeping a separate non-static anchor sidesteps the static-class generic-argument restriction while leaving `AssemblyReference` static (and therefore impossible to instantiate accidentally). Every module's `Application` assembly defines its own `ClassReference`, so each module scans itself by passing its local copy.

- **Where it's used**: as the `TAssemblyMarker` argument in [`ScanModuleApplicationServices<TAssemblyMarker>()`](#dependencyinjection); the root [`AddApplication()`](#dependencyinjection) passes the Application-layer `ClassReference` to `AddValidatorsFromAssemblyContaining<ClassReference>()` to pick up framework-level validators (e.g. `LoginRequestValidator`).

---

### IApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/IApplicationSettings.cs:7` · Level 0 · interface

- **What it is**: a cross-cutting settings *contract* with three global knobs: `UseMiniProfiler` (enables the MiniProfiler query-profiling decorator), `MaxPageSize` (the upper bound enforced on every paginated list query), and `DatabaseInitStrategy` (`"Migrate"` | `"EnsureCreated"` | `"None"`).

- **Depends on**: BCL only. Implemented by [`ApplicationSettings`](#applicationsettings) (Level 1). `[Rubric §10, Cross-Cutting Concerns]`, `[Rubric §8, Data Architecture]`.

- **Concept introduced, typed settings interfaces over raw `IConfiguration`.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether configuration is centralised and typed rather than reading magic-string keys all over the codebase. Instead of injecting `IConfiguration`, the Application layer declares a typed contract; the concrete `ApplicationSettings` implements it and is registered via the options pattern. Services depend on `IApplicationSettings`, which makes settings trivially stubbable in tests and resolvable as a singleton. The three properties each gate a real behaviour: `DatabaseInitStrategy` is the production safety guard the XML doc spells out, `"Migrate"` applies pending EF migrations at startup, `"EnsureCreated"` is the legacy create-without-migrations path, and `"None"` *throws if pending migrations exist* so an environment where a DBA applies schema out-of-band fails fast rather than running against a stale database.

- **Walkthrough**: three `{ get; init; }` members (lines 10, 13, 23). `init`-only accessors mean the binder sets them once at startup and the object is immutable thereafter (safe to share as a singleton). The XML doc on `DatabaseInitStrategy` (lines 15–23) enumerates the three accepted string values and their intent.

- **Why it's built this way**: separating the interface (Application layer) from the concrete class lets higher layers inject the abstraction while only the composition root knows the implementation, the dependency-inversion shape the primer describes for ports/adapters ([primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).

- **Where it's used**: the root [`AddApplication()`](#dependencyinjection) registers it via `TryAddSingleton<IApplicationSettings>(sp => sp.GetRequiredService<IOptions<ApplicationSettings>>().Value)` (`DependencyInjection.cs:31`); consumed by the query pipeline (`MaxPageSize` clamping), the startup database-initialization path (`DatabaseInitStrategy`), and the profiling-decorator registration (`UseMiniProfiler`).

---

### IModuleSeeder
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8` · Level 0 · interface

- **What it is**: the Application-layer contract for seeding a module's initial data at startup: `ModuleName` declares ownership, and `SeedAsync` receives an `IServiceProvider` so the seeder can resolve whatever services it needs. Implementations are auto-discovered by [`ModuleLoader`](#moduleloader) and run, in module-dependency order, after every module has registered.

- **Depends on**: BCL only (`Task`, `IServiceProvider`, `CancellationToken`). `[Rubric §3, Clean Architecture]`.

- **Concept introduced, seeding at the right layer.** `[Rubric §3, Clean Architecture]` assesses whether each concern lives in the layer that owns it. An *Application* seeder populates data through service interfaces (e.g. dispatching commands) and never touches `DbContext`; a seeder that genuinely needs direct EF access implements the Infrastructure-layer [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder) instead. The `IServiceProvider` parameter is deliberate: the seeder is held by the singleton `ModuleLoader`, so it must create its own DI scope inside `SeedAsync` rather than capture scoped services, handing it the provider rather than a concrete dependency is what keeps that scoping correct.

- **Walkthrough**: `string ModuleName { get; }` (line 13) must match the corresponding [`IModule.Name`](#imodule) so the loader can correlate a seeder to its module and place it in topological order; `Task SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)` (line 18) is the single work method, called only for *enabled* modules.

- **Where it's used**: each module that needs reference data provides one implementation (e.g. the ADC Identity module's seeder that creates the default admin user). [`ModuleLoader`](#moduleloader) discovers them during `DiscoverAndRegister`, keeps the ones whose module is enabled, and invokes them in order from `SeedAllAsync`.

---

### ModuleSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:6` · Level 0 · class (sealed)

- **What it is**: the per-module configuration record bound from `Modules:{Name}` in `appsettings.json`. `Enabled` (default `true`) controls whether the module's full service tree is registered; `RemoteDependencies` lists dependency module names that are satisfied by an *extracted remote service* rather than an in-process module.

- **Depends on**: BCL only (`List<string>`, options binding). `[Rubric §7, Microservices Readiness]`.

- **Concept introduced, the module-extraction seam expressed as configuration.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. ADR-008 ("service-extraction topology") is the *why*: when, say, Catalog is extracted, the host sets `"Catalog": { "Enabled": false }` and any module that still depends on it adds `"RemoteDependencies": [ "Catalog" ]`. [`ModuleLoader`](#moduleloader) then skips the strict `RequiresDependencies` check for that name and lets the disabled module's `RegisterDisabledStubs` put the contract type in DI; the host afterwards `Replace`s the stub with a real gRPC client adapter (the XML doc, lines 11–36, walks through exactly this with a Catalog/Sales example). So extraction becomes a config + wiring change, not a code change.

- **Walkthrough**: `bool Enabled { get; init; } = true` (line 9), `init`-only, so it can't be mutated after binding. `List<string> RemoteDependencies { get; set; } = []` (line 38), note this one is `set`, not `init`, because ASP.NET Core's `IConfiguration` binder needs a settable collection to populate; the resulting `CA2227` ("collection properties should be read-only") analyzer warning is suppressed with an inline `#pragma` (lines 37–39) and an explanatory comment, an acknowledged, documented trade-off rather than an oversight.

- **Why it's built this way**: a plain POCO bound by the options pattern keeps the configuration model decoupled from the module infrastructure; the `Enabled` flag also lets a deployment disable a whole module without deleting code.

- **Where it's used**: aggregated by [`ModulesSettings`](#modulessettings) (the `"Modules"` dictionary) and read for every discovered [`IModule`](#imodule) by [`ModuleLoader`](#moduleloader) during composition.

---

### ApplicationSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:6` · Level 1 · class (sealed)

- **What it is**: the concrete global-settings class bound from the `"ApplicationSettings"` configuration section. It implements [`IApplicationSettings`](#iapplicationsettings) and supplies the defaults: `UseMiniProfiler` (false), `MaxPageSize` (500), `DatabaseInitStrategy` (`"Migrate"`).

- **Depends on**: [`IApplicationSettings`](#iapplicationsettings) (Level 0, the interface it implements). BCL only otherwise.

- **Concept introduced, options-pattern settings classes.** `[Rubric §10, Cross-Cutting Concerns]` assesses centralised, typed configuration rather than per-service copy-paste. Every settings class in the framework follows the same shape: a `static readonly string SectionName` names its config section (so `Configure<ApplicationSettings>(config.GetSection(ApplicationSettings.SectionName))` avoids a magic string), and `init` properties capture the bound values so the object is immutable after startup. `ApplicationSettings` is the simplest exemplar, pure binding plus defaults, no `[Required]`/validation logic (the more complex validating variant shows up in `JwtSettings`/`OutboxSettings` elsewhere).

- **Walkthrough**: `SectionName = "ApplicationSettings"` (line 9); three `init` properties carrying their defaults via `<inheritdoc />` from the interface: `UseMiniProfiler` (line 12, defaults to `false`), `MaxPageSize = 500` (line 15), `DatabaseInitStrategy = "Migrate"` (line 18). Because the implemented interface is Level 0, this concrete class lands at Level 1.

- **Why it's built this way**: `static SectionName` keeps registration DRY; `init` immutability means the bound instance is safe to share as a singleton after startup (which is exactly how [`AddApplication()`](#dependencyinjection) registers it).

- **Where it's used**: passed by value into every [`IModule.Register(…, applicationSettings)`](#imodule) call; injected into [`ModuleLoader`](#moduleloader), the MiniProfiler-extension wiring, and the ADC module `DependencyInjection` facades.

---

### ModulesSettings
> MMCA.Common.Application · `MMCA.Common.Application.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7` · Level 1 · class (sealed)

- **What it is**: a `Dictionary<string, ModuleSettings>` subclass bound from the `"Modules"` configuration section, with two helper methods over the map: `IsModuleEnabled(moduleName)` and `IsDependencyRemote(consumerModule, dependencyModule)`.

- **Depends on**: [`ModuleSettings`](#modulesettings) (Level 0, the per-module entry/value type). `[Rubric §7, Microservices Readiness]`.

- **Concept**: the same [options-pattern](#applicationsettings) shape, but realised by *subclassing the dictionary* so that `appsettings.json` can express an arbitrary `{ moduleName → settings }` map without a hand-written model class for every module. `[Rubric §7, Microservices Readiness]`: `IsDependencyRemote` is the extracted-service hook, when a module's dependency is met by a remote gRPC service rather than an in-process module, this returns true and [`ModuleLoader`](#moduleloader) bypasses the strict `RequiresDependencies` startup check for that name.

- **Walkthrough**: `SectionName = "Modules"` (line 10). `IsModuleEnabled` (lines 18–19): `TryGetValue` then check `settings.Enabled`, note a module *absent* from configuration is treated as **disabled**, not enabled. `IsDependencyRemote` (lines 30–32): `TryGetValue` for the consumer, then `settings.RemoteDependencies.Contains(dependencyModule, StringComparer.OrdinalIgnoreCase)`, case-insensitive so deployment config need not match casing exactly.

- **Where it's used**: consumed by [`ModuleLoader`](#moduleloader) during topological registration (the enable check and the remote-dependency bypass), and by the API layer's controller-feature provider to restrict which module controllers are discovered.

---

### IModule
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7` · Level 2 · interface

- **What it is**: the contract every pluggable module implements: a `Name`, an optional `Dependencies` list, a `RequiresDependencies` flag, a `Register` method that wires the module's services, and an optional `RegisterDisabledStubs` method for the cross-module stubs used when the module is switched off.

- **Depends on**: [`ApplicationSettings`](#applicationsettings) (Level 1, passed into `Register`); `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`) and `Microsoft.Extensions.Configuration` (`IConfigurationBuilder`) (externals).

- **Concept introduced, the module system and topological registration.** `[Rubric §5, Vertical Slice]` assesses whether features cluster into cohesive, self-contained boundaries, a *module* (Conference, Engagement, Identity, Notification) is the top-level cohesion unit, and each registers *all* of its own services (handlers, EF configs, repositories, validators) through one `Register(services, configuration, settings)` call. `[Rubric §7, Microservices Readiness]` assesses independent deployability: modules declare `Dependencies` by *name* (string), so [`ModuleLoader`](#moduleloader) can compute a safe startup order without compile-time references between modules. When a dependency is disabled and `RequiresDependencies = false` (the default), the depended-on module is expected to register stub implementations via `RegisterDisabledStubs` so cross-module interfaces stay resolvable, precisely the mechanism that lets the Conference service boot with [`DisabledBookmarkCountService`](group-22-engagement-module.md#disabledbookmarkcountservice) standing in for the real Engagement [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice).

- **Walkthrough**: five members, three of them with **default interface implementations** so a minimal module need only supply `Name` and `Register`: `Name` (line 12, required); `Dependencies => []` (line 17, default empty); `RequiresDependencies => false` (line 23, default tolerant); `Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (line 28, required); `RegisterDisabledStubs(IServiceCollection) { }` (line 34, default no-op). Note `Register` takes an `IConfigurationBuilder` (not a built `IConfiguration`) so a module can *add its own configuration sources* before its services bind them, which is exactly what the loader exploits to inject per-module JSON files.

- **Why it's built this way**: see MMCA.Common `CLAUDE.md` ("Module System") and ADR-008: making `IModule` the single seam means extraction is a deployment/topology concern, not a rewrite. Default interface members keep the common case ceremony-free while leaving the extraction hooks available.

- **Where it's used**: implemented by every ADC module (`ConferenceModule`, `EngagementModule`, `IdentityModule`, `NotificationModule`, all Level 3). Discovered, sorted, and invoked by [`ModuleLoader`](#moduleloader) (Level 3).

---

### ModuleLoader
> MMCA.Common.Application · `MMCA.Common.Application.Modules` · `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:15` · Level 3 · class (sealed, partial)

- **What it is**: the engine of the module system: it reflects over all loaded assemblies to find every [`IModule`](#imodule) (and [`IModuleSeeder`](#imoduleseeder)) implementation, sorts the modules into dependency order with **Kahn's topological sort**, then registers each enabled module into the DI container while wiring stubs for the disabled ones.

- **Depends on**: [`IModule`](#imodule) (Level 2), [`IModuleSeeder`](#imoduleseeder) (Level 0), [`ApplicationSettings`](#applicationsettings) (Level 1), [`ModulesSettings`](#modulessettings) (Level 1). Externals: `IServiceCollection`/`IConfigurationBuilder`, `Microsoft.Extensions.Logging` (source-generated `[LoggerMessage]` methods), `System.Diagnostics.Stopwatch`, `System.Reflection`.

- **Concept introduced, Kahn's topological sort for DI registration ordering.** `[Rubric §2, Design Patterns]` assesses use of the right algorithm for the problem: ordering items so each appears after everything it depends on is textbook topological sort, and `TopologicalSort` (line 193) implements the BFS-based Kahn variant. `[Rubric §7, Microservices Readiness]`: the loader is what makes partial enablement (one module per service host) work. `[Rubric §16, Maintainability]`: modules name their dependencies as strings and the loader resolves/sorts at startup, so adding a module is purely additive (implement `IModule`, optionally `IModuleSeeder`, no central registration list to edit).

- **Walkthrough**
  - State (lines 17–25): three private lists, `_enabledModules`, `_seeders`, `_disabledModuleNames`, surfaced as the read-only `EnabledModules` and `DisabledModuleNames` properties. `Logger` (line 31) is an `init`-only `ILogger<ModuleLoader>` defaulting to `NullLogger` so the loader runs silently unless a host supplies one.
  - `DiscoverAndRegister` (line 50): enumerates `AppDomain.CurrentDomain.GetAssemblies()` and calls `GetTypes()` on each inside a `try/catch` (lines 63–72) that logs and skips assemblies which throw `ReflectionTypeLoadException` (missing transitive references) rather than aborting the whole scan. It instantiates every concrete `IModule` (lines 75–78) and every `IModuleSeeder` into an `OrdinalIgnoreCase` dictionary keyed by `ModuleName` (lines 80–83), then runs `TopologicalSort`.
  - Per-module loop (lines 88–105): a disabled module (per [`ModulesSettings.IsModuleEnabled`](#modulessettings)) calls `module.RegisterDisabledStubs(services)`, records its name, and `continue`s; an enabled module runs `ValidateModuleDependencies` then `RegisterEnabledModule`, and, if a matching seeder exists, appends it to `_seeders`.
  - `ValidateModuleDependencies` (line 108): computes the module's disabled dependencies, subtracts those declared remote via [`ModulesSettings.IsDependencyRemote`](#modulessettings), and, only if a genuinely unsatisfied dependency remains *and* `RequiresDependencies` is true, throws `InvalidOperationException` with a remediation message (lines 122–130). Otherwise it logs a warning per unsatisfied-but-tolerated dependency and an info line per remote-satisfied one.
  - `RegisterEnabledModule` (line 143): before calling `module.Register`, it adds the conventional per-module JSON config files `modules.{name}.json` and (if an environment name was supplied) `modules.{name}.{environment}.json` to the `IConfigurationBuilder` (lines 154–161), lower-cased via `ToLowerInvariant` with a `CA1308` suppression for the file-naming convention. It times the `Register` call with a `Stopwatch` and logs the elapsed ms.
  - `SeedAllAsync` (line 177): awaits each collected seeder's `SeedAsync` in registration (i.e. topological) order, with `ConfigureAwait(false)`.
  - `TopologicalSort` (line 193): builds `inDegree` and reverse-adjacency (`dependents`) maps (all `OrdinalIgnoreCase`), **ignoring dependencies on modules that weren't discovered** (line 208, those are deferred to registration-time validation), seeds a `Queue<string>` with the zero-in-degree modules, and drains it, decrementing dependents as it goes. If fewer modules are emitted than exist, the remainder form a cycle and it throws `InvalidOperationException` naming the cyclic modules (lines 235–240).

- **Why it's built this way**: convention-over-configuration: discovery + sort means no manual ordering and no module-registration list to keep in sync. The `[LoggerMessage]` source-generated partial methods (lines 245–261) give allocation-free structured diagnostics of exactly which modules loaded, in what order, with which (un)satisfied dependencies, and how long each `Register` took, directly serving `[Rubric §13, Observability & Operability]`.

- **Where it's used**: driven from each service host's composition root (around `AddApplication()`); ADC's four service hosts each run exactly one module, while a monolith host would discover and register all four through this one loader.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application` · `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:21` · Level 9 · class (static, C# `extension(IServiceCollection)`)

- **What it is**: the composition-root extension class that assembles the framework's entire Application layer into the DI container. It exposes four `IServiceCollection` extension methods: `AddApplication()`, `AddApplicationDecorators()`, `ScanModuleApplicationServices<TAssemblyMarker>()`, and `AddApplicationProfiling()`. Every consuming host calls these (in a specific order) before wiring Infrastructure.

- **Depends on**: `[Rubric §1, SOLID]` (DIP via DI): the core singletons `IDomainEventDispatcher`/`DomainEventDispatcher`, `INavigationMetadataProvider`/`NavigationMetadataProvider`, `IEntityQueryPipeline`/`EntityQueryPipeline`; the settings bridge [`IApplicationSettings`](#iapplicationsettings) ← [`ApplicationSettings`](#applicationsettings); the marker [`ClassReference`](#classreference); the open-generic handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the five command decorators [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult), [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult), [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult), [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult); the three query decorators [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult), [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult), [`FeatureGateQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult); the profiling decorators [`ProfilingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#profilingcommanddecoratortcommand-tresult)/[`ProfilingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#profilingquerydecoratortquery-tresult); the scanned contract families [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), and the request-validator bridge [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest). Externals: `FluentValidation` (`AddValidatorsFromAssemblyContaining`), **Scrutor** (`Scan`, `TryDecorate`, `TryAdd*`), `Microsoft.Extensions.Options`.

- **Concept introduced, the CQRS decorator pipeline wiring order (Scrutor `TryDecorate`).** `[Rubric §6, CQRS & Event-Driven]` assesses whether cross-cutting handler concerns are applied uniformly; `[Rubric §2, Design Patterns]` the Decorator pattern itself (the individual decorators are taught in [`group-05`](group-05-cqrs-pipeline.md)). **Scrutor's `TryDecorate` applies decorators in reverse registration order**: the *last* registered call becomes the *outermost* wrapper. `AddApplicationDecorators` (line 89) registers the five command decorators in this source order: Transactional, Validating, Caching, Logging, FeatureGate (lines 94–98), which produces the execution nesting documented in the method's own XML doc (lines 53–61):

  ```
  FeatureGateCommandDecorator        (outermost, short-circuits if the feature flag is off)
    → LoggingCommandDecorator        (measures full pipeline duration of enabled features)
      → CachingCommandDecorator      (invalidates cache only AFTER the transaction commits)
        → ValidatingCommandDecorator (short-circuits with Result.Failure before any transaction)
          → TransactionalCommandDecorator (wraps the handler in a DB transaction if ITransactional)
            → ConcreteHandler        (the actual business logic)
  ```

  Queries get the lighter three-deep chain `FeatureGate → Logging → Caching → ConcreteHandler` (lines 101–103), no validation or transaction, because queries don't mutate. This file is the one place where the register-order/execute-order inversion must be kept in mind, and the doc comment does so explicitly. The ordering is not arbitrary (the XML doc's "design rationale", lines 73–86): feature gating is outermost so disabled features cost nothing; validation sits *outside* the transaction so malformed commands never open one; cache invalidation sits *outside* validation so cache is only cleared after a valid, committed mutation; on a business `Result.IsFailure` the transaction still commits (nothing mutated) but cache invalidation is skipped; on an exception the transaction rolls back and propagates.

- **Concept introduced, `ScanModuleApplicationServices<TAssemblyMarker>()`, the convention scanner.** `[Rubric §14, Testability]` (handler registration is exercisable in isolation via a real host) and `[Rubric §5, Vertical Slice]` (one call wires a whole module's slice types). Lines 115–179 run **seven Scrutor passes** over the one marker assembly, each with the correct lifetime: domain event handlers (`IDomainEventHandler<>`, **singleton**: they create their own scopes), integration event handlers (`IIntegrationEventHandler<>`, **singleton**), DTO mappers (`IEntityDTOMapper<,,>`, **scoped**, registered `AsSelfWithInterfaces`), request mappers (`IEntityRequestMapper<,,>`, **scoped**), command handlers (`ICommandHandler<,>`, **scoped**), query handlers (`IQueryHandler<,>`, **scoped**), and FluentValidation validators (`AddValidatorsFromAssemblyContaining<TAssemblyMarker>`). After the passes, a reflection loop (lines 162–176) finds every command implementing `ICommandWithRequest<TRequest>` and `TryAddTransient`s a `CommandRequestValidator<TCommand, TRequest>` (line 175) so a command that embeds its own request DTO gets a bridging validator for free (`TryAdd*` so an explicit `IValidator<TCommand>` registered by the earlier `AddValidatorsFromAssemblyContaining` pass always wins).

- **Walkthrough**
  - `AddApplication()` (line 29): `TryAddSingleton` for [`IApplicationSettings`](#iapplicationsettings) (resolved from `IOptions<ApplicationSettings>`), `IDomainEventDispatcher`, [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline); then `AddValidatorsFromAssemblyContaining<ClassReference>()` to register framework-level validators (e.g. `LoginRequestValidator`, `RefreshTokenRequestValidator`) that module scans wouldn't reach (line 40, with the explanatory comment).
  - `AddApplicationDecorators()` (line 89): the five command + three query `TryDecorate` calls described above. Per the XML doc and the CLAUDE.md DI sequence, this **must** run *after* every module's `ScanModuleApplicationServices` so Scrutor has concrete handlers to wrap.
  - `ScanModuleApplicationServices<TAssemblyMarker>()` (line 115): the seven-pass scanner described above.
  - `AddApplicationProfiling()` (line 186): optional, `TryDecorate`s `ProfilingCommandDecorator<,>`/`ProfilingQueryDecorator<,>` on top, used when `IApplicationSettings.UseMiniProfiler` is on.

- **Why it's built this way**: `[Rubric §3, Clean Architecture]`: registration lives in a static `DependencyInjection.cs` at the composition root, so domain and Application types never reference the container. The pervasive `TryAdd*` / `TryDecorate` pattern lets a consuming app override any framework default simply by registering its own implementation first. The `extension(IServiceCollection services)` block (line 23) is the C# 14 preview extension-member syntax the framework uses for all DI registration, see [primer §4](../00-primer.md#c-extensiont-types-read-this-once).

- **Where it's used**: called from every consuming host (`MMCA.ADC.*.Service/Program.cs`, the Gateway, test fixtures) following the canonical sequence in MMCA.Common `CLAUDE.md`: `AddApplication()` → one `ScanModuleApplicationServices<…ClassReference>()` per module → `AddApplicationDecorators()` (last) → Infrastructure → API. Module-level `DependencyInjection` classes (e.g. the ADC Conference/Engagement/Identity composition roots) are the callers of `ScanModuleApplicationServices<ClassReference>()`.

- **Caveats / not-in-source**: there are several other `DependencyInjection` classes across the framework and ADC (Infrastructure, API, UI, Grpc, Notifications, and each ADC module) with the same name but different namespaces and methods; this section covers only the **MMCA.Common.Application root** at `DependencyInjection.cs:21`. The sibling Notifications root (`Notifications/DependencyInjection.cs`) and the per-layer/per-module roots are documented in their own groups.

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

- **Concept introduced, declarative database-per-service routing.** `[Rubric §8, Data Architecture]` assesses how the model maps to physical stores; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out with its own database (ADR-006). The attribute's XML doc (`UseDatabaseAttribute.cs:9-14`) spells out the three-step resolution order for an entity's logical name: (1) this attribute on the concrete configuration class (inherited); (2) the module name derived from the entity namespace, the segment before `Domain`; (3) the literal `"Default"`, the top-level `ConnectionStrings` section. A logical name with no `DataSources` entry (or whose connection string equals the top-level one) collapses onto the `Default` physical source (`UseDatabaseAttribute.cs:15-17`), so a host that configures nothing behaves exactly like a single-database monolith. This "convention with an explicit override" shape is the load-bearing idea: most modules never apply the attribute and ride the namespace convention.

- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Class, Inherited = true, AllowMultiple = false)]` (`UseDatabaseAttribute.cs:21`). `Inherited = true` is deliberate: annotating a per-module configuration base class propagates the database assignment to every derived configuration, so a module can pin all its entities to one database in a single place. `AllowMultiple = false` forbids an ambiguous second assignment.
  - Primary-constructor parameter `name` (`UseDatabaseAttribute.cs:22`), the logical name (for example `"Conference"`).
  - `Name` get-only property (`UseDatabaseAttribute.cs:25`) initialized from that parameter, the value the resolver reads.

- **Why it's built this way**: an attribute keeps the database choice declarative and co-located with the entity configuration rather than buried in a registration method, and `Inherited = true` turns per-module assignment into one annotation instead of one per entity (ADR-006, database per microservice).

- **Where it's used**: applied on concrete EF entity type configuration classes in the modules; read up front by the eager [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) so routing does not depend on a model having been built.

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

- **Why it's built this way**: keeping the engine on an attribute (inherited from a provider base class) means an entity's engine and database are both declarative metadata the registry can scan up front, which is what lets routing happen without first building an EF model (ADR-006).

- **Where it's used**: on the per-engine `EntityTypeConfiguration*` base classes and, through inheritance, every concrete configuration under them; read by [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice) / [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry).

---

### DependencyInjection
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:37` · Level 9 · class (static, extension)

- **What it is**: the single composition root for the entire Infrastructure layer. A static class whose body is one C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:39`) adding the layer's registration methods directly onto `IServiceCollection`: `AddInfrastructure(IConfiguration)`, `AddCaching()`, `AddServices()`, `AddEntityConfigurationAssembly(Assembly)`, `AddNotificationInfrastructure()`, `AddPushNotifications(IConfiguration)`, `AddNativePushNotifications(IConfiguration)`, `AddAzureBlobFileStorage(IConfiguration)`, `AddBrokerMessaging(IConfiguration, Action?)`, and `AddTypedServiceClient<TInterface, TImplementation>(string)`.

- **Depends on**: nearly every Infrastructure type below it, wired by interface. Persistence: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory), [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory), [`DataSourceService`](group-07-persistence-ef-core.md#datasourceservice), [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), [`DefaultEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#defaultentityconfigurationassemblyprovider), [`EFRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efrepositorytentity-tidentifiertype), [`RepositoryFactory`](group-07-persistence-ef-core.md#repositoryfactory), [`UnitOfWork`](group-07-persistence-ef-core.md#unitofwork). Messaging/outbox: [`IMessageBus`](group-04-events-outbox.md#imessagebus)/[`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus)/[`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus), [`IEventBus`](group-04-events-outbox.md#ieventbus), [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice), [`EfInboxStore`](group-04-events-outbox.md#efinboxstore). Cross-cutting: [`ICacheService`](group-09-caching.md#icacheservice), [`IJwksProvider`](group-08-auth.md#ijwksprovider)/[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider), [`TokenService`](group-08-auth.md#tokenservice), [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). Settings: [`DataSourcesSettings`](#datasourcessettings), [`MessageBusSettings`](#messagebussettings), [`OutboxSettings`](#outboxsettings). Externals: MassTransit v8 (pinned by policy), StackExchange.Redis, `Microsoft.AspNetCore.SignalR`, `Microsoft.Azure.NotificationHubs`, `Azure.Storage.Blobs` / `Azure.Identity`, `Microsoft.Extensions.Http.Resilience`.

- **Concept introduced, the mega-composition-root plus the swap-at-the-edge extraction pattern.** `[Rubric §3, Clean Architecture]` assesses whether wiring lives at the edge rather than in the core: every concrete Infrastructure choice is registered here, not in Application or Domain. `[Rubric §10, Cross-Cutting]` and `[Rubric §7, Microservices Readiness]`: the method bodies are the framework's default posture, and each optional channel (broker, push, native push, blob storage) is a separate opt-in method a host layers on, so the same package runs as a monolith or as an extracted service without recompiling the core. The default everywhere is `TryAdd*` (`DependencyInjection.cs:49-135`, `178-209`), meaning a host can pre-register its own implementation and the framework will not clobber it; the one place the code intentionally uses `Replace` instead is the broker swap (below).

- **Walkthrough** (in registration order):
  - **`AddInfrastructure` (`DependencyInjection.cs:47-142`)** is the entry point. It binds the settings sections through the options pipeline with `.ValidateDataAnnotations().ValidateOnStart()` (`ConnectionStringSettings` at `DependencyInjection.cs:59-62`, `SmtpSettings` at `73-76`, [`OutboxSettings`](#outboxsettings) at `113-116`, `LoginProtectionSettings` at `118-121`, [`MessageBusSettings`](#messagebussettings) at `124-127`, `JwksSettings` at `129-132`), then registers the persistence stack, caching, and the two hosted outbox services ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) and [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) at `DependencyInjection.cs:136-137`).
  - **The named-data-sources note (`DependencyInjection.cs:65-69`)** is load-bearing: [`DataSourcesSettings`](#datasourcessettings) is built directly from `configuration.GetSection(...).Get<Dictionary<...>>()` rather than through `AddOptions`, because a root-level dictionary section does not bind through the options pipeline. This is the kind of detail the source comment preserves.
  - **The physical-factory warning (`DependencyInjection.cs:79-85`)**: [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) is scoped (one per request) and [`PhysicalDbContextFactory`](group-07-persistence-ef-core.md#physicaldbcontextfactory) is a singleton that must **never** be converted to EF context pooling, because each raw context carries per-source constructor state that pooling would silently reuse across databases.
  - **The Scrutor scan (`DependencyInjection.cs:105-109`)** discovers every `IEntityTypeConfigurationBase<,>` in the Infrastructure assembly via `FromAssemblyOf<ClassReference>()` (`DependencyInjection.cs:106`) and registers each as its implemented interfaces, scoped to match the DbContext lifetime, closing the loop back to [`ClassReference`](#classreference).
  - **`AddCaching` (`DependencyInjection.cs:149-168`)** is a Redis-or-memory probe resolved once as a singleton: if an `IDistributedCache` is registered and is not the no-op `MemoryDistributedCache` (`DependencyInjection.cs:156`), it wraps the real distributed cache (and any `IConnectionMultiplexer`) in `DistributedCacheService`; otherwise it falls back to `MemoryCacheService` (`DependencyInjection.cs:164`).
  - **`AddServices` (`DependencyInjection.cs:174-212`)** registers the small services and encodes a subtle lifetime lesson: [`TokenService`](group-08-auth.md#tokenservice) is a **singleton** (`DependencyInjection.cs:186`) with a six-line comment explaining why (`DependencyInjection.cs:180-185`): a scoped lifetime disposed the RSA handle at end-of-request while IdentityModel's static `CryptoProviderCache` still held the cached signature provider wrapping it, throwing `ObjectDisposedException` on the next RS256 sign. `[Rubric §11, Security]` (correct signing-key lifecycle). It also sets the default [`IMessageBus`](group-04-events-outbox.md#imessagebus) to [`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) (`DependencyInjection.cs:194`) and wires the inert no-op defaults for push (`DependencyInjection.cs:198-199`), native push (ADR-044, `203-204`), and file storage (ADR-045, `208`) so hosts can register the opt-in methods unconditionally.
  - **`AddBrokerMessaging` (`DependencyInjection.cs:372-421`)** is the extraction pivot. It reads [`MessageBusSettings.Provider`](#messagebussettings): on `InProcess` it returns immediately (`DependencyInjection.cs:381-384`), leaving the in-process bus in place; otherwise it calls `AddMassTransit` and then **`Replace`s** the scoped [`IMessageBus`](group-04-events-outbox.md#imessagebus) with [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus) (`DependencyInjection.cs:401`) and [`IEventBus`](group-04-events-outbox.md#ieventbus) with `BrokerEventBus` (`DependencyInjection.cs:407`), the deliberate exception to the `TryAdd` rule, because the in-process bus must not run alongside the broker. It also chooses the consumer-side [`IInboxStore`](group-04-events-outbox.md#efinboxstore) implementation from `settings.EnableInbox` (`DependencyInjection.cs:411-418`).
  - **Transport wiring (`DependencyInjection.cs:475-550`)** is factored into two private static helpers (`ResolveBrokerConnectionString` at `475-484`, `ConfigureBrokerTransport` at `504-550`) outside the extension block to keep `AddBrokerMessaging`'s cyclomatic complexity below the analyzer threshold; both carry a justified `IDE0051` suppression (`DependencyInjection.cs:471-474`, `500-503`) documenting a Roslyn false positive where SDK 10.0.201+ cannot see references crossing the extension-block boundary. `[Rubric §29, Resilience & Business Continuity]`: every receive endpoint gets an exponential-backoff `UseMessageRetry` policy (`DependencyInjection.cs:519-523`, `536-540`); `UseDelayedRedelivery` is intentionally not wired, with a comment explaining the Aspire RabbitMQ container lacks the delayed-message-exchange plugin (`DependencyInjection.cs:494-499`).
  - **`AddTypedServiceClient` (`DependencyInjection.cs:441-458`)** wires a typed `HttpClient` to Aspire service discovery (`http://{serviceName}`, `DependencyInjection.cs:451-452`), attaches [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) (`DependencyInjection.cs:453`) so the inbound bearer token flows downstream, and adds the standard Polly resilience handler (`DependencyInjection.cs:456`); the doc notes gRPC is preferred for service-to-service contracts.

- **Why it's built this way**: the `extension(IServiceCollection)` syntax keeps every Infrastructure registration in one file without a proliferation of static helper classes, and pushing all concrete choices into one composition root at the layer edge is what keeps Application and Domain free of framework references (ADR-006 for the database-per-service wiring, ADR-007/ADR-008 for the broker/extraction path). See the DI-sequence note in `MMCA.Common/CLAUDE.md`: hosts call `AddApplicationDecorators()` last so Scrutor can decorate handlers already registered, but the relative position of `AddInfrastructure` is not otherwise ordering-sensitive.

- **Where it's used**: called from each service host's `Program.cs` (the reference apps and the extracted `MMCA.ADC.*` service hosts) after `AddApplication()`; the optional methods (`AddBrokerMessaging`, `AddPushNotifications`, `AddNativePushNotifications`, `AddAzureBlobFileStorage`) are added by the specific hosts that need those channels.

- **Caveats / not-in-source**: the exact set of consuming `Program.cs` files is in the downstream apps (MMCA.ADC / MMCA.Store / MMCA.Helpdesk), not in this repository, so the precise call sites are Not determinable from source here.

### DataSourceEntrySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourceEntrySettings.cs:19` · Level 0 · class (sealed)

- **What it is**: configuration for **one named (logical) data source** under the `DataSources`
  section, typically a module name like `"Conference"`. Properties mirror
  [`IConnectionStringSettings`](#iconnectionstringsettings) exactly, and any property left empty
  falls back to the corresponding top-level `ConnectionStrings` value.
- **Depends on**: nothing first-party (BCL only, `init`-only `string` properties). It is consumed
  by [`DataSourcesSettings`](#datasourcessettings) (the dictionary that holds these entries) and read
  by [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver).
- **Concept introduced, per-source connection overrides for database-per-service.**
  `[Rubric §8, Data Architecture]` (assesses deliberate persistence: which database an entity lives
  in, migrations, connection management). `[Rubric §7, Microservices Readiness]` (assesses whether a
  module can be lifted into its own service). This type is the configuration half of ADR-006: a module
  earns its own physical SQL database simply by adding a `DataSources:Sales` entry with its own
  `SQLServerConnectionString` (and optionally its own `SQLServerMigrationsAssembly`). Crucially, the
  **fallback is the monolith**: a module that omits an entry, or whose connection string equals the
  top-level value, collapses onto the `Default` physical source, so a host with no `DataSources`
  config behaves exactly like a single-database monolith (one context, one change tracker, FK
  constraints intact). That collapse logic lives in
  [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver), not here.
- **Walkthrough**: five `init`-only properties, all defaulting to `string.Empty`
  (`DataSourceEntrySettings.cs:22-37`): `CosmosConnectionString`, `CosmosDatabaseName`,
  `SqliteConnectionString`, `SQLServerConnectionString`, and `SQLServerMigrationsAssembly`. The
  doc-comment example (lines 9-18) shows a real `DataSources:Conference` entry. The
  `SQLServerMigrationsAssembly` override is what lets each database have its own migrations project
  (one migrations assembly per database, see ADR-006's design-time note).
- **Why it's built this way**: sealed and `init`-only for the same reason as every settings type
  here: immutable after binding, no inheritance surprises. The empty-string default (rather than
  `null`) makes "did the operator set this?" a simple `IsNullOrEmpty` check at fallback time.
- **Where it's used**: held by [`DataSourcesSettings.Sources`](#datasourcessettings); read by
  [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) when collapsing logical
  names to physical [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey)s.

### FileStorageSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/FileStorageSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: blob file-storage configuration bound from the `FileStorage` section (ADR-045). It
  carries two mutually-preferred auth paths (a managed-identity `ServiceUri` for production, a
  `ConnectionString` for local development) plus the target container name.
- **Depends on**: `System.Uri` (BCL) only, no first-party dependency. Consumed by the
  `AddAzureBlobFileStorage` extension, which decides between
  [`AzureBlobFileStorageService`](group-07-persistence-ef-core.md#azureblobfilestorageservice) and the
  no-op [`NullFileStorageService`](group-07-persistence-ef-core.md#nullfilestorageservice) behind the
  [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) abstraction.
- **Concept introduced, managed-identity-first storage configuration.** `[Rubric §11, Security]`
  (assesses secret handling and identity): production sets `ServiceUri` and authenticates via
  `DefaultAzureCredential`, so no storage secret is committed to configuration at all; the
  `ConnectionString` path exists only for local development (e.g. Azurite). `[Rubric §10,
  Cross-Cutting Concerns]` (centralized, feature-detected infrastructure): when **neither**
  `ServiceUri` nor `ConnectionString` is set the section is treated as incomplete and
  `AddAzureBlobFileStorage` leaves the unconfigured default in place rather than throwing, so a host
  that never uploads files needs no `FileStorage` section.
- **Walkthrough**: `SectionName = "FileStorage"` (line 13). Three `init` properties: `ServiceUri`
  (`Uri?`, line 16), the blob service endpoint (e.g. `https://myaccount.blob.core.windows.net`) used
  with `DefaultAzureCredential`; `ConnectionString` (`string?`, line 19), the local-dev alternative;
  and `ContainerName` (`string?`, line 22), the container all blobs live in (documented as required).
- **Why it's built this way**: sealed and `init`-only for immutability after binding. Preferring
  `ServiceUri` + managed identity over a connection string keeps production credential-free, and the
  nullable properties let the "incomplete section leaves the default in place" behaviour be a simple
  null check at wiring time.
- **Where it's used**: read by `AddAzureBlobFileStorage` in Infrastructure DI; drives which
  [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) implementation is
  registered.

### IConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IConnectionStringSettings.cs:6` · Level 0 · interface

- **What it is**: the **top-level connection-string contract**, bound from the `ConnectionStrings`
  configuration section. It declares one string property per supported storage engine (Cosmos,
  SQLite, SQL Server) plus the SQL Server migrations-assembly name.
- **Depends on**: nothing first-party (the interface is BCL-only; concrete binding goes through
  `Microsoft.Extensions.Options`). Conceptually paired with
  [`DataSourceEntrySettings`](#datasourceentrysettings), which provides per-database overrides over
  these defaults.
- **Concept introduced, the multi-engine, single-default connection contract.**
  `[Rubric §8, Data Architecture]` (assesses deliberate, engine-aware persistence). The framework
  supports three storage engines simultaneously; `IConnectionStringSettings` is the **default** source
  every logical database falls back to. Any logical database with no `DataSources:*` override (or
  whose override is empty) uses these values, which is what collapses the whole application onto a
  single physical database, preserving monolith behaviour with zero configuration change (see
  [`DataSourceEntrySettings`](#datasourceentrysettings) for the per-source side, and ADR-006 for the
  whole strategy).
- **Walkthrough**: five `get; init;` properties (`IConnectionStringSettings.cs:9-24`):
  `CosmosConnectionString`, `CosmosDatabaseName`, `SqliteConnectionString`,
  `SQLServerConnectionString`, and `SQLServerMigrationsAssembly`. `init` (not `set`) enforces
  immutability after binding. The doc comment on `SQLServerMigrationsAssembly` notes EF defaults to
  the `DbContext` assembly when the value is empty.
- **Why it's built this way**: an *interface* (not a concrete class) lets consuming code depend on
  the abstraction `[Rubric §1, SOLID]` (DIP: depend on the contract, not the binding type), so tests
  and alternate hosts can supply lightweight implementations without a full configuration stack. The
  concrete binding type is [`ConnectionStringSettings`](#connectionstringsettings).
- **Where it's used**: [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver)
  and [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory); any component needing
  the default SQL Server or Cosmos connection string.

### IPushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IPushNotificationSettings.cs:6` · Level 0 · interface

- **What it is**: the minimal configuration contract for the SignalR push-notification feature: an
  on/off toggle and the hub endpoint path. Bound from the `PushNotifications` configuration section.
- **Depends on**: nothing first-party. Consumed by
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender) and
  surfaces the path at which [`NotificationHub`](group-10-notifications.md#notificationhub) is mapped.
- **Concept introduced, feature-toggled cross-cutting infrastructure.**
  `[Rubric §10, Cross-Cutting Concerns]` (assesses whether infrastructure concerns are centralized
  and configurable rather than scattered). A single `Enabled` flag lets a host turn the whole push
  pipeline on or off; when it is `false`,
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender)
  short-circuits without error (the fallback being the no-op
  [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender)).
- **Walkthrough**: two `get; init;` members (`IPushNotificationSettings.cs:9-12`): `Enabled` (bool)
  and `HubPath` (the URL path where [`NotificationHub`](group-10-notifications.md#notificationhub) is
  mapped, e.g. `/hubs/notifications`).
- **Why it's built this way**: an interface keeps the push abstraction testable; the concrete type
  is [`PushNotificationSettings`](#pushnotificationsettings).
- **Where it's used**: Infrastructure DI for SignalR;
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender).

### ISmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ISmtpSettings.cs:6` · Level 0 · interface

- **What it is**: the strongly-typed SMTP configuration contract, bound from the `Smtp`
  configuration section. The `To` property is a default recipient used by no-argument `SendAsync`
  overloads.
- **Depends on**: nothing first-party (the email-sending implementation that consumes it lives in
  the Notification modules of the downstream apps).
- **Concept introduced**: same "interface contract over bindable settings" idea as
  [`IConnectionStringSettings`](#iconnectionstringsettings); `[Rubric §10, Cross-Cutting Concerns]`.
- **Walkthrough**: seven `get; init;` properties (`ISmtpSettings.cs:9-27`): `Host`, `Port`,
  `Username`, `Password`, `EnableSsl`, `From`, and the fallback `To`. The doc comment on `To` (line
  26) notes it is "the default recipient used by the no-argument `SendAsync` overload", so simple
  notification mails can be sent without a per-call recipient.
- **Why it's built this way**: interface keeps the email abstraction testable; consuming apps
  implement it via the concrete [`SmtpSettings`](#smtpsettings) and may add app-specific properties.
- **Where it's used**: email-sender service implementations in the Notification modules of ADC (and
  Store).

### JwksSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwksSettings.cs:17` · Level 0 · class (sealed)

- **What it is**: configuration for the **JWKS (JSON Web Key Set) endpoint** and the RSA public-key
  material the Identity service publishes at `/.well-known/jwks.json`. When `Enabled` is `false` (the
  default), `RsaJwksProvider` resolves to an empty key set and the endpoint returns `{"keys":[]}`,
  so the setting is safe to omit in HMAC-only deployments.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[StringLength]`). Drives which
  [`IJwksProvider`](group-08-auth.md#ijwksprovider) is registered
  ([`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) vs. the empty no-op); pairs with
  [`JwtSigningAlgorithm`](#jwtsigningalgorithm).
- **Concept introduced, cross-service token validation via JWKS (ADR-004).**
  `[Rubric §11, Security]` (assesses key management and authN correctness). `[Rubric §7,
  Microservices Readiness]`. When modules are extracted into separate services they cannot share a
  symmetric HMAC secret without spreading the blast radius of a compromise across every service.
  Instead the Identity service holds only the RSA *private* key and publishes the matching *public*
  key as a JWK document; extracted services fetch it and validate tokens against it (the dual-fetch /
  discovery story of ADR-004). `JwksSettings` is what populates that document.
- **Walkthrough**: `SectionName = "Jwks"` (line 20). `Enabled` defaults to `false` (line 26) so an
  existing HMAC deployment does not start advertising an RSA key set by accident. `KeyId` (line 34,
  `[StringLength(64)]`) defaults to `"default"` and is published as the JWK `kid` claim, it **must
  match** the `kid` header of every token the Identity service signs, so consumers pick the right key.
  `RsaPublicKeyPem` (inline) and `RsaPublicKeyPath` (file) are mutually exclusive (lines 41, 47).
- **Why it's built this way**: the safe `Enabled = false` default means turning on RS256 is an
  explicit, reviewable change, not a silent one. The dual PEM-or-path option supports both
  secrets-manager injection (inline PEM in an environment variable) and volume-mounted PEM files
  (Kubernetes / Azure Container Apps secret volumes).
- **Where it's used**: [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) and the Infrastructure
  DI that chooses which [`IJwksProvider`](group-08-auth.md#ijwksprovider) to register based on
  `Enabled`.

### JwtSigningAlgorithm

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSigningAlgorithm.cs:18` · Level 0 · enum

- **What it is**: selects between HMAC-SHA256 (`HS256`) and RSA-SHA256 (`RS256`) for JWT signing and
  validation, mapping the microservice-extraction phase to a single configuration value.
- **Depends on**: nothing first-party. Pairs with [`JwksSettings`](#jwkssettings) (RS256 enables the
  JWKS path) and is carried by [`IJwtSettings`](#ijwtsettings) / [`JwtSettings`](#jwtsettings).
- **Concept introduced, the symmetric to asymmetric signing migration switch.**
  `[Rubric §11, Security]`, `[Rubric §7, Microservices Readiness]`. `HS256` (value `0`) is the
  default: a shared symmetric key (`JwtSettings.SecretForKey`) works fine when the issuer and every
  validator live in the same process or behind a single deployment boundary. `RS256` (value `1`) is
  the target for Phase 1+ extraction, the Identity service signs with its RSA private key, every
  other service validates with the public key fetched via JWKS (see [`JwksSettings`](#jwkssettings)).
  The doc comment (lines 11-16) flags that switching `HS256` to `RS256` invalidates all existing tokens
  (a hard cutover), plan a maintenance window.
- **Walkthrough**: two members with explicit values: `HS256 = 0` (line 21), `RS256 = 1` (line 24).
  The numeric values are intentional so JSON/config binding works without string parsing.
- **Why it's built this way**: an enum (not a magic string) gives exhaustive `switch` coverage and
  prevents config typos.
- **Where it's used**: [`IJwtSettings.SigningAlgorithm`](#ijwtsettings) /
  [`JwtSettings`](#jwtsettings); Infrastructure DI for authentication picks the correct `SecurityKey`
  type from it; [`JwksSettings`](#jwkssettings)'s enabling decision.

### MessageBusProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:68` · Level 0 · enum

- **What it is**: selects the message-bus transport: in-process dispatch for the monolith, RabbitMQ
  for development microservice deployments, or Azure Service Bus for production. Defined in the same
  file as [`MessageBusSettings`](#messagebussettings).
- **Depends on**: nothing first-party. It is the discriminator on
  [`MessageBusSettings.Provider`](#messagebussettings); the transport it selects is one of the
  [`IMessageBus`](group-04-events-outbox.md#imessagebus) implementations
  ([`InProcessMessageBus`](group-04-events-outbox.md#inprocessmessagebus) /
  [`BrokerMessageBus`](group-04-events-outbox.md#brokermessagebus)).
- **Concept introduced, the transport-selection extension point.**
  `[Rubric §7, Microservices Readiness]` (assesses whether transport is swappable without touching
  application code). The same [`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction is
  backed by implementations chosen by this enum: `InProcess` dispatches integration events
  directly in-process (no broker, no network, no serialization);
  `RabbitMq`/`AzureServiceBus` route through MassTransit so the *same* consumers run unchanged against
  either broker. Flipping this value moves the bus from in-process to a broker with no code change,
  the extraction extension point of ADRs 003/007/008. Recall the **MassTransit v8 pin** (primer §3): v9 needs a
  commercial license and crashes broker-enabled hosts at startup, so the broker providers are tied to
  the v8-pinned package.
- **Walkthrough**: three members (`MessageBusSettings.cs:73-83`): `InProcess = 0` (default, safe for
  single-host deployments), `RabbitMq = 1`, `AzureServiceBus = 2`. Numeric values make config binding
  work without string parsing; `InProcess` is `0` so an unconfigured deployment defaults to the
  simplest option.
- **Why it's built this way**: see "Concept introduced". An enum keeps the choice exhaustive and
  type-checked at the binding site.
- **Where it's used**: [`MessageBusSettings.Provider`](#messagebussettings); Infrastructure DI
  selects the matching [`IMessageBus`](group-04-events-outbox.md#imessagebus) implementation; the
  Aspire `WithBroker` extension sets `MessageBus__Provider` to `RabbitMq`/`AzureServiceBus`.

### NativePushSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/NativePushSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: native (mobile) push delivery configuration bound from the `NativePush` section
  (ADR-044). It carries an on/off toggle plus the Azure Notification Hubs connection string and hub
  name.
- **Depends on**: nothing first-party (BCL strings only). Consumed by the native-push wiring, which
  selects between
  [`AzureNotificationHubNativePushSender`](group-07-persistence-ef-core.md#azurenotificationhubnativepushsender)
  and the no-op [`NullNativePushSender`](group-07-persistence-ef-core.md#nullnativepushsender) behind
  the [`INativePushSender`](group-07-persistence-ef-core.md#inativepushsender) abstraction; the
  matching device-registrar is
  [`AzureNotificationHubDeviceRegistrar`](group-07-persistence-ef-core.md#azurenotificationhubdeviceregistrar).
- **Concept introduced, inert-by-default feature-flagged infrastructure.**
  `[Rubric §10, Cross-Cutting Concerns]` (assesses centralized, configuration-driven infrastructure):
  the pipeline ships with `Enabled` `false`, so a hub can be provisioned before the platform
  credentials (FCM v1 service account, APNs auth key) are uploaded and only then switched on by
  configuration alone, with no redeploy. `[Rubric §11, Security]`: the connection string is documented
  as a full Listen+Send+Manage rule, so it belongs in a secret store rather than `appsettings.json`.
- **Walkthrough**: `SectionName = "NativePush"` (line 12). Three properties: `Enabled` (bool, line
  15) gating whether native push is active; `ConnectionString` (`string?`, line 18), the Azure
  Notification Hubs connection string; and `HubName` (`string?`, line 21), the notification hub name
  within the namespace.
- **Why it's built this way**: sealed and `init`-only for immutability after binding. Defaulting
  `Enabled` to `false` is what lets the pipeline ship inert and be turned on purely by configuration
  once credentials are in place.
- **Where it's used**: read by the native-push registration in Infrastructure DI; drives which
  [`INativePushSender`](group-07-persistence-ef-core.md#inativepushsender) implementation is
  registered.

### ConnectionStringSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ConnectionStringSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete settings type bound from the `ConnectionStrings` section,
  implementing [`IConnectionStringSettings`](#iconnectionstringsettings). Only
  `SQLServerConnectionString` is `[Required]` because SQL Server is the default engine.
- **Depends on**: [`IConnectionStringSettings`](#iconnectionstringsettings) (the contract it fills);
  `System.ComponentModel.DataAnnotations` (`[Required]`).
- **Concept introduced, the "interface + bindable concrete + `SectionName`" settings shape.** This
  is the recurring pattern across this group: an interface declares the contract (consumers depend on
  it via `IOptions<T>` / DI) and a sealed concrete class supplies the bindable, defaulted properties
  plus a `static readonly string SectionName`. `[Rubric §10, Cross-Cutting Concerns]` (centralized,
  validated configuration). The single `[Required]` on `SQLServerConnectionString` (line 24) means an
  app that forgets its primary connection string fails options validation at startup, not at the first
  query.
- **Walkthrough**: `SectionName = "ConnectionStrings"` (line 12); five `init` properties matching
  [`IConnectionStringSettings`](#iconnectionstringsettings). Note the lone non-empty default:
  `CosmosDatabaseName = "AtlDevCon"` (line 18), the ADC Cosmos database name. (Recall from primer §2
  that the Cosmos path is a supported-but-largely-dormant engine extension point; SQL Server is the only
  adopted production engine.)
- **Why it's built this way**: sealed and `init`-only for immutability after binding; only the truly
  required value is annotated so the optional engines stay optional.
- **Where it's used**: bound in Infrastructure DI; consumed wherever
  [`IConnectionStringSettings`](#iconnectionstringsettings) is injected
  ([`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver),
  [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)).

### DataSourcesSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the holder for the named-source dictionary bound from the `DataSources` section:
  a `IReadOnlyDictionary<string, `[`DataSourceEntrySettings`](#datasourceentrysettings)`>` keyed by
  **logical** source name (e.g. `"Conference"`).
- **Depends on**: [`DataSourceEntrySettings`](#datasourceentrysettings) (the value type);
  [`DataSourceKey.DefaultName`](group-07-persistence-ef-core.md#datasourcekey) (the reserved name it
  forbids). It is built and consumed by
  [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver).
- **Concept introduced, fail-fast validation of dictionary-shaped configuration.**
  `[Rubric §8, Data Architecture]`, `[Rubric §7, Microservices Readiness]` (the per-module database
  registry of ADR-006). Unlike the other settings here, this type is **built directly from
  configuration in `AddInfrastructure`** rather than through the options pipeline, the doc comment
  (lines 8-11) notes root-level dictionary sections do not bind cleanly through `IOptions<T>`. Its
  constructor (lines 23-41) enforces two invariants at construction time: no empty/whitespace logical
  name, and the reserved name `Default` (case-insensitive, matched against
  [`DataSourceKey.DefaultName`](group-07-persistence-ef-core.md#datasourcekey)) may **not** appear,
  because the `Default` source is configured via the top-level `ConnectionStrings`, not here. A
  violation throws `InvalidOperationException` immediately, so misconfiguration is caught at startup.
- **Walkthrough**: `SectionName = "DataSources"` (line 16). The constructor accepts an optional
  `IReadOnlyDictionary<string, DataSourceEntrySettings>?`, defaulting to an empty
  ordinal-comparer dictionary when null (line 25), then validates every key (lines 27-40). The single
  `Sources` property (line 44) exposes the validated map read-only.
- **Why it's built this way**: sealed; an explicit constructor (rather than `init` setters) is what
  lets it validate eagerly and reject reserved/empty names before any database routing happens. An
  empty dictionary is the legitimate "single-database monolith" case.
- **Where it's used**: registered as a singleton and consumed by
  [`DataSourceResolver`](group-07-persistence-ef-core.md#datasourceresolver) to collapse logical names
  to physical [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey)s.

### IJwtSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10` · Level 1 · interface

- **What it is**: the JWT authentication contract, bound from the `Jwt` section. It supports both
  symmetric (HMAC) and asymmetric (RSA) signing via [`JwtSigningAlgorithm`](#jwtsigningalgorithm),
  plus issuer/audience and token-lifetime settings.
- **Depends on**: [`JwtSigningAlgorithm`](#jwtsigningalgorithm) (the `SigningAlgorithm` property's
  type). (Note the filename is `IJwSettings.cs`, a missing `t`, but the interface is `IJwtSettings`.)
- **Concept introduced, the dual-mode signing contract.** `[Rubric §11, Security]`. The interface
  exposes *both* key families so a single deployment can choose its mode: `SecretForKey` (HMAC) for
  HS256, and `RsaPrivateKeyPem` / `RsaPublicKeyPem` for RS256. The doc comment (lines 4-8) ties this
  to the extraction migration: switching deployments from HMAC to RSA is what lets the Identity service
  sign tokens that other services validate via JWKS without sharing a symmetric secret (ADR-004).
- **Walkthrough**: eight `get; init;` members (`IJwSettings.cs:16-49`): `SigningAlgorithm`,
  `SecretForKey`, the nullable `RsaPrivateKeyPem` / `RsaPublicKeyPem` (kept in user-secrets / Key
  Vault, never `appsettings.json`, per the doc comment on line 27), `Issuer`, `Audience`,
  `AccessTokenExpirationMinutes`, and `RefreshTokenExpirationDays`. The RSA public key's doc note
  (lines 31-37) records that the Identity service *also* exposes it via `/.well-known/jwks.json` so
  other services fetch it with `AddForwardedJwtBearer`.
- **Why it's built this way**: an interface lets [`TokenService`](group-08-auth.md#tokenservice) and
  the authentication setup depend on the abstraction `[Rubric §1, SOLID]` (DIP); the concrete
  [`JwtSettings`](#jwtsettings) adds the algorithm-conditional validation.
- **Where it's used**: implemented by [`JwtSettings`](#jwtsettings); injected into
  [`TokenService`](group-08-auth.md#tokenservice) and the JWT-bearer authentication setup.
- **Caveats / not-in-source**: `AddForwardedJwtBearer` referenced in the doc comment is the
  consumer-side JWKS fetch extension (Infrastructure/API auth, a separate group); only its name
  appears here.

### MessageBusSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:11` · Level 1 · class (sealed)

- **What it is**: configuration for the cross-service message bus, bound from the `MessageBus`
  section. It selects the transport via [`MessageBusProvider`](#messagebusprovider) and carries broker
  connection details, queue-naming prefix, retry policy, and the idempotency-inbox toggle.
- **Depends on**: [`MessageBusProvider`](#messagebusprovider) (the `Provider` discriminator);
  `System.ComponentModel.DataAnnotations` (`[StringLength]`, `[Range]`). Configures the
  [`IMessageBus`](group-04-events-outbox.md#imessagebus) implementation chosen at registration.
- **Concept introduced, transport-agnostic broker configuration + the consumer inbox toggle.**
  `[Rubric §7, Microservices Readiness]`, `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §29,
  Resilience & Business Continuity]`. The retry trio (`RetryLimit`, `RetryMinIntervalSeconds`,
  `RetryMaxIntervalSeconds`, lines 42-56) configures MassTransit's `UseMessageRetry` with exponential
  backoff before a faulted message is dead-lettered to the `_error` queue, the broker-side resilience
  policy. `EnableInbox` (line 64, default `false`) turns on consumer-side idempotency: when set,
  `IntegrationEventConsumer` dedups already-processed messages via an `InboxMessages` table (which the
  consuming database must have, apply the `AddInboxMessages` migration). This is the consumer
  complement to the outbox: at-least-once delivery means a message can arrive twice, and the inbox is
  how the consumer drops the duplicate (see [`IInboxStore`](group-04-events-outbox.md#iinboxstore)).
- **Walkthrough**: `SectionName = "MessageBus"` (line 14). `Provider` defaults to
  [`MessageBusProvider.InProcess`](#messagebusprovider) (line 17). `ConnectionString` (nullable, line
  26) is read directly so it can come from any source (the doc notes Aspire injects it via
  `ConnectionStrings:rabbitmq` / `ConnectionStrings:messaging`). `EndpointPrefix`
  (`[StringLength(64)]`, line 34) namespaces queues per service (e.g. `store-catalog`) so multiple
  services coexist on one broker. Retry properties are `[Range]`-bounded (lines 42-56). `EnableInbox`
  (line 64) defaults `false`.
- **Why it's built this way**: sealed `init` settings with `[Range]`/`[StringLength]` validation so
  misconfiguration fails at startup. Keeping `ConnectionString` a plain property (not pulled from a
  fixed key) decouples it from any one configuration provider.
- **Where it's used**: Infrastructure DI for the message bus: selects the
  [`IMessageBus`](group-04-events-outbox.md#imessagebus) implementation, configures MassTransit retry,
  and decides whether to register the EF-backed
  [`IInboxStore`](group-04-events-outbox.md#iinboxstore).

### PushNotificationSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PushNotificationSettings.cs:6` · Level 1 · class (sealed)

- **What it is**: the concrete push-notification settings bound from the `PushNotifications` section,
  implementing [`IPushNotificationSettings`](#ipushnotificationsettings).
- **Depends on**: [`IPushNotificationSettings`](#ipushnotificationsettings) (the contract it fills).
- **Concept introduced**: same "interface + bindable concrete + `SectionName`" shape introduced at
  [`ConnectionStringSettings`](#connectionstringsettings); `[Rubric §10, Cross-Cutting Concerns]`.
  `[Rubric §26, Front-End Security]` is touched by the channel-key guard below: the hub validates the
  client-supplied channel key against a regex before joining a SignalR group, so a client cannot
  subscribe to an arbitrary group name.
- **Walkthrough**: `SectionName = "PushNotifications"` (line 9); `Enabled` (bool, defaults `false`)
  and `HubPath` defaulting to `"/hubs/notifications"` (line 15), so the hub maps at a sensible path
  even when no override is supplied. It also adds `ChannelKeyPattern` (line 23, defaulting to
  `^(event|session):[0-9]+$`), the regex a channel key must match before a client may join or leave a
  channel via the notification hub. Per its doc comment it is declared **on the concrete class only**
  (not on [`IPushNotificationSettings`](#ipushnotificationsettings)) so the interface stays unchanged
  and existing implementers do not take a breaking change.
- **Why it's built this way**: sealed `init` for immutability; the sensible `HubPath` default keeps
  the section optional, and putting the new `ChannelKeyPattern` only on the concrete type is a
  deliberate non-breaking extension of the settings surface.
- **Where it's used**: Infrastructure DI for SignalR;
  [`SignalRPushNotificationSender`](group-10-notifications.md#signalrpushnotificationsender) and the
  [`NotificationHub`](group-10-notifications.md#notificationhub) group-join guard.

### SmtpSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/SmtpSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the concrete SMTP settings bound from the `Smtp` section, implementing
  [`ISmtpSettings`](#ismtpsettings) and validated via data annotations on startup.
- **Depends on**: [`ISmtpSettings`](#ismtpsettings) (the contract it fills);
  `System.ComponentModel.DataAnnotations` (`[Range]`).
- **Concept introduced**: same interface/concrete settings shape as
  [`ConnectionStringSettings`](#connectionstringsettings); `[Rubric §10, Cross-Cutting Concerns]`.
- **Walkthrough**: `SectionName = "Smtp"` (line 12) and a named constant `DefaultSmtpPort = 25`
  (line 15). Seven `init` properties matching [`ISmtpSettings`](#ismtpsettings), defaulting string
  fields to `string.Empty`; `Port` is `[Range(1, 65535)]` and defaults to `DefaultSmtpPort` (lines
  21-22) so an out-of-range port fails validation at startup.
- **Why it's built this way**: sealed `init`; the `[Range]` on `Port` and the named default constant
  keep the wire-level config honest and self-documenting.
- **Where it's used**: bound in Infrastructure DI; injected into the email sender services of the
  Notification modules.

### JwtSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Settings` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:16` · Level 2 · class (sealed)

- **What it is**: the concrete JWT configuration bound from the `Jwt` section, implementing
  [`IJwtSettings`](#ijwtsettings) and `IValidatableObject`. It supports both symmetric (HS256,
  `SecretForKey`) and asymmetric (RS256, `RsaPrivateKeyPem`/`RsaPublicKeyPem`) signing, with
  validation that is **conditional on the selected algorithm**.
- **Depends on**: [`IJwtSettings`](#ijwtsettings) (Level 1),
  [`JwtSigningAlgorithm`](#jwtsigningalgorithm) (Level 0); `System.ComponentModel.DataAnnotations`
  (`[Required]`, `IValidatableObject`).
- **Concept introduced, algorithm-aware options validation.** `[Rubric §11, Security]` (assesses
  key management, algorithm selection, and validation correctness). `[Rubric §10, Cross-Cutting
  Concerns]` (centralized, validated config). Implementing `IValidatableObject.Validate` (line 51)
  hooks into ASP.NET Core options validation: for HS256 it requires `SecretForKey` to be **at least 32
  characters** (lines 53-58), for RS256 it requires a non-empty `RsaPrivateKeyPem` (lines 60-65). This
  catches the silent-misconfiguration trap a flat `[Required]` cannot, a 2-character placeholder
  secret would otherwise be accepted. The HS256 error message (line 56) even names the fix ("Replace
  the placeholder value ... via user-secrets or environment variables"), documenting the secure practice
  inline.
- **Walkthrough**: `SectionName = "Jwt"` (line 19); eight `init` properties (lines 22-45) with
  production-safe defaults (`SigningAlgorithm = HS256`, `AccessTokenExpirationMinutes = 15`,
  `RefreshTokenExpirationDays = 7`); `Issuer` and `Audience` are `[Required]` (lines 34, 38); `Validate`
  (lines 51-66) is the algorithm-conditional check.
- **Why it's built this way**: sealed `init` for immutability; `IValidatableObject` (rather than
  attribute-only validation) is the only way to express "which key is required depends on another
  property's value."
- **Where it's used**: injected into [`TokenService`](group-08-auth.md#tokenservice) and the
  JWT-bearer authentication setup in the web-application builder extensions.

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
  events. This type is the knob set for the at-least-once outbox pattern (ADR-003): `MaxRetries`
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

- **Why it's built this way**: the defaults encode the framework's out-of-the-box posture (ADR-003
  outbox, ADR-006 database-per-service): a monolith with no `Outbox` section gets a working
  at-least-once processor writing to its single default database, while a multi-service deployment
  overrides `PollingIntervalSeconds`, `DataSource`, and `DatabaseName` to tune cost and routing. The
  `[Range]` guards give fail-fast validation at bind time rather than a bad value surfacing mid-cycle.

- **Where it's used**: consumed by the outbox background services
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (drain and dispatch) and
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (retention purge), which
  read these values to size batches, pace retries, choose the write target, and schedule cleanup over
  the [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) rows.


---
[⬅ gRPC & Inter-Service Contracts](group-13-grpc-contracts.md)  •  [Index](00-index.md)  •  [Common UI Framework (MudBlazor components, theme, base pages) ➡](group-15-common-ui-framework.md)
