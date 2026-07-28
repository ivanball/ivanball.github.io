# ADR-059: The IModule Contract and Reflection-Based Module Composition

## Status
Accepted (2026-07-28).

## Context
The framework's headline claim is that an application is built as a modular monolith and later
extracted into services without rewriting business logic. ADR-008 states the extracted shape in one
sentence, "Each service is the monolith with one module enabled", and it treats `ModuleLoader` and
the `Disabled*` stubs as **pre-existing context** before deciding the extraction topology
(`Website/docs-src/adr/008-service-extraction-topology.md:29-31`). ADR-006 decides the database axis
of the same split. Neither records the composition model itself: how a module declares itself, how a
host finds it, in what order registrations run, what "disabled" does to the container, and what a
dependent resolves when its peer is not in the process. That mechanism is what makes the ADR-008
sentence true, and it had no decision record of its own. This ADR is that record.

Composition has to answer for the monolith case as well as the extracted one. MMCA.Helpdesk runs a
single module in a single host; Store and ADC run one module per service host today, and the same
module code ran in a combined host before extraction. One contract has to cover all three without
the module code knowing which shape it is running in.

## Decision
Make `IModule` the single composition contract, discover implementations by reflection, register
them in topological dependency order, and represent a disabled module by **stub registrations**
rather than by absence.

- **`IModule` is five members, three of which have defaults.** `Name` and
  `Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` are the only members a
  module must supply; `Dependencies` defaults to an empty list, `RequiresDependencies` to `false`,
  and `RegisterDisabledStubs(IServiceCollection)` to a no-op
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:7,12,17,23,28,34`). A leaf
  module is therefore two members: `TicketsModule` implements exactly `Name` and `Register`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.API/TicketsModule.cs:13-19`).
- **Discovery is a reflection scan that defaults to the whole AppDomain.** `ModuleLoader` scans
  `moduleAssemblies ?? AppDomain.CurrentDomain.GetAssemblies()`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:86`), keeps every
  concrete non-abstract, non-interface `IModule` type and instantiates each through
  `Activator.CreateInstance` (`ModuleLoader.cs:101-104`), and does the same for `IModuleSeeder`,
  keyed case-insensitively by `ModuleName` (`ModuleLoader.cs:106-109`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8-19`). An assembly that
  throws from `GetTypes()` is logged and skipped, not fatal (`ModuleLoader.cs:89-98,353-354`). An
  overload taking the assemblies explicitly exists and its own documentation calls it the preferred
  host call (`ModuleLoader.cs:61-79`), but **every host today uses the AppDomain overload**: Store
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:206`,
  `MMCA.Store.Identity.Service/Program.cs:181`, `MMCA.Store.Sales.Service/Program.cs:173`), ADC
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:225`,
  `MMCA.ADC.Conference.Service/Program.cs:270`, `MMCA.ADC.Engagement.Service/Program.cs:175`,
  `MMCA.ADC.Notification.Service/Program.cs:184`) and Helpdesk
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:81`). Only the unit tests pass assemblies
  explicitly (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:41-48`).
- **Registration order is a Kahn topological sort over the declared names.** The loader sorts before
  it registers anything (`ModuleLoader.cs:112`); the sort builds an in-degree map plus a reverse
  adjacency list, seeds a queue with the zero-in-degree modules, and drains it
  (`ModuleLoader.cs:286-336`), so a dependency's DI registrations are always in the container before
  a dependent's `Register` runs. A declared name that no discovered module supplies is skipped while
  building the graph and never blocks the sort (`ModuleLoader.cs:301-302`).
- **A cycle is a startup failure that names the cycle.** If fewer modules come out of the sort than
  went in, the remainder is circular and the loader throws `InvalidOperationException` listing them
  (`ModuleLoader.cs:328-333`); `ModuleLoaderTests.cs:71-83` asserts both the message and the member
  names.
- **Enablement is configuration, and absence means off.** `ModulesSettings` binds the `Modules`
  section as a name-to-`ModuleSettings` dictionary
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7,10`), and
  `IsModuleEnabled` returns true only when the key exists **and** `Enabled` is true
  (`ModulesSettings.cs:18-19`). A module missing from configuration is therefore treated as disabled,
  even though `ModuleSettings.Enabled` itself defaults to `true`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:9`); `ModuleLoaderTests.cs:238-244`
  pins that behavior.
- **Disabled means stubs, not absence.** For a disabled module the loader calls
  `RegisterDisabledStubs` and never calls `Register`, snapshots the descriptors that call appended so
  they can be validated later, and records the name (`ModuleLoader.cs:116-128`). The stubs are
  null-object implementations of the owning module's cross-module contracts, shipped in that module's
  `*.Shared` project: `DisabledProductVariantService` answers `false` for existence checks, `null` for
  the SKU lookup and an empty dictionary for the batch price query
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/DisabledProductVariantService.cs:10-40`);
  `DisabledCustomerService` returns `null`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Customers/DisabledCustomerService.cs:8-15`);
  `DisabledSessionBookmarkValidationService` returns `Result.Success()` plus an empty session-id
  collection, which deliberately skips the BR-49 / BR-91 eligibility checks
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30-39`);
  `DisabledEventLiveValidationService` fails open with an always-open live window
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22-43`).
  The dependent's code path does not branch on "is the module here": it resolves the interface and
  gets a documented degraded answer.
- **`Dependencies` declares the graph; `RequiresDependencies` decides whether a gap is fatal.** The
  loader computes the module's disabled dependencies, then narrows them to "unsatisfied" by removing
  any name the consumer listed under `Modules:{Module}:RemoteDependencies`
  (`ModuleLoader.cs:146-152`, `ModulesSettings.cs:30-32`,
  `ModuleSettings.cs:38`). With `RequiresDependencies = true` an unsatisfied dependency throws at
  startup with remediation text naming the three options (`ModuleLoader.cs:154-162`); with the
  default `false` the loader logs a warning and the module runs against the stub
  (`ModuleLoader.cs:164-167,347-348`). Both branches are covered
  (`ModuleLoaderTests.cs:87-97,118-128`).
- **Per-module configuration arrives by naming convention.** Immediately before `Register`, the
  loader adds `modules.{name}.json` and, when the host passes an environment name,
  `modules.{name}.{environment}.json`, both optional and reload-on-change
  (`ModuleLoader.cs:186-193`), so a module can carry its own configuration file without a host edit.
- **Composition also shapes the HTTP surface, seeding and health.** `AddAPI(modulesSettings)`
  installs `ModuleControllerFeatureProvider`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:42,52-56`), which removes
  from MVC discovery any controller whose assembly name or namespace contains a `.{ModuleName}.`
  token for a disabled module, so those endpoints are never mapped instead of mapping and then
  failing with a 500
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:33-53,60-82`).
  Seeders run only for enabled modules and in registration order (`ModuleLoader.cs:133-136,270-276`),
  invoked from startup database initialization
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:28-31,87`).
  `AddModuleHealthChecks` publishes one `module-{Name}` check per module, Healthy when enabled and
  Degraded when disabled (`DependencyInjection.cs:169-188`).
- **A remote-dependency validator exists but is not wired.** `ValidateRemoteDependencies` re-resolves
  every service type a disabled dependency's stub registered, throwing when it no longer resolves and
  warning when it still resolves to the stub type (`ModuleLoader.cs:216-261`). It is exercised only by
  unit tests (`ModuleLoaderTests.cs:132-177`); **no host calls it today**, so a forgotten gRPC client
  registration is still a silent stub at the first request rather than a startup failure.

The module inventory is small and explicit. **MMCA.Store has three:** `CatalogModule` (leaf, stubs
`IProductVariantService`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:13-30`), `IdentityModule`
(leaf, stubs `ICustomerService`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:14-31`) and
`SalesModule`, which declares `["Catalog", "Identity"]` with `RequiresDependencies = true` and
publishes no cross-module contract of its own
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:17-46`). **MMCA.ADC has four:**
`IdentityModule` (leaf, stubs `IAttendeeQueryService`,
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13-25`), `ConferenceModule`
(no declared dependencies, two stubs,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:15-30`),
`EngagementModule` (`["Conference"]`, strict, two stubs,
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:14-35`) and
`NotificationModule` (`["Identity"]`, strict, one stub,
`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15-36`).
**MMCA.Helpdesk has exactly one, `TicketsModule`**: the single-module seed, a leaf that overrides
none of the three defaulted members, ships no `Disabled*` stub and no `IModuleSeeder`, and is enabled
by the one host with `"Tickets": { "Enabled": true }`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:13-15`). Seeders exist for five of
the eight modules (Store Catalog, Identity, Sales; ADC Identity, Conference).

The per-service configuration is where "the monolith with one module enabled" becomes literal. Store
Catalog enables `Catalog` and disables both peers with no remote declarations
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/appsettings.json:20-24`); Store Sales enables
`Sales` and declares `["Catalog", "Identity"]` as `RemoteDependencies`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:20-27`), then replaces the two
stubs with typed gRPC clients after the loader returns
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:176-183`). ADC Engagement declares
`["Conference"]` remote (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/appsettings.json:22-30`)
and ADC Notification declares `["Identity"]` remote
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:27-35`), while ADC
Conference enables one module and declares nothing remote
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:20-25`) even though it wires
Engagement's `IBookmarkCountService` as a gRPC client
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:274-281`), because
`ConferenceModule` never declares Engagement in `Dependencies`.

## Rationale
- **Reflection discovery keeps hosts out of the module registry business.** A host calls one method
  and gets whatever modules its assembly graph contains; adding a module is a project reference plus
  a configuration entry, not an edit to a hand-maintained list in every host
  (`ModuleLoader.cs:86,101-104`).
- **Topological order replaces registration luck.** Cross-module registration depends on ordering,
  and declaring `Dependencies` makes that ordering explicit and machine-checked instead of implicit
  in the order the host happens to call things (`ModuleLoader.cs:112,286-336`).
- **Null-object stubs are what make extraction a hosting change.** Because a disabled module still
  puts its contract type in the container, the dependent module's Application and Domain code has no
  branch for "peer not present", which is precisely why a module's non-hosting layers are identical
  in-process and extracted (`ModuleLoader.cs:123`, `CatalogModule.cs:24-25`). The host then
  overwrites the stub with a real cross-process adapter (`Sales.Service/Program.cs:176-183`).
- **Two strictness levels, chosen per module.** A module that genuinely cannot function without a
  peer opts into `RequiresDependencies = true` and fails fast (`SalesModule.cs:30`,
  `EngagementModule.cs:23`, `NotificationModule.cs:24`); everything else tolerates a missing peer and
  degrades, which is the safer default for a module whose cross-module call is advisory.
- **`RemoteDependencies` keeps strictness usable after extraction.** Without it, every strict module
  would have to be relaxed to run in its own service, losing the check in the very topology that
  needs it most; instead the operator states the dependency is satisfied out of process
  (`ModuleSettings.cs:11-38`, `ModuleLoader.cs:150-152`).
- **Composition lives in configuration, so one build serves N deployments.** The same assemblies run
  as a combined host or as a set of single-module services with no code change; the only difference
  is the `Modules` section each host reads (`ModulesSettings.cs:10`, plus the per-service
  `appsettings.json` blocks cited above).

## Trade-offs
- **The AppDomain scan is the fragile default and the one everybody uses.** The loader's own
  documentation warns that the AppDomain scan sees only assemblies already loaded, so a referenced
  but untouched module assembly is silently absent from discovery (`ModuleLoader.cs:61-65`), and no
  host passes assemblies explicitly today. A missing module surfaces as "disabled" (absence equals
  disabled, `ModulesSettings.cs:18-19`), not as an error.
- **Stubs degrade silently by design.** A stub answers success-shaped defaults: an always-open live
  window (`DisabledEventLiveValidationService.cs:26,35-42`), a passing bookmark validation
  (`DisabledSessionBookmarkValidationService.cs:33-34`), zero counts
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/DisabledBookmarkCountService.cs:7-18`),
  empty exports
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Exports/DisabledUserEngagementExportService.cs:7-12`,
  `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7-12`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7-12`).
  A wrongly disabled module therefore produces plausible wrong answers rather than an error, and the
  only startup signal is a Degraded `module-{Name}` health check plus a log line
  (`DependencyInjection.cs:181-188`, `ModuleLoader.cs:338-339,347-348`).
- **The dependency graph is a hand-written declaration, not a derived fact.** ADC Conference consumes
  Engagement's `IBookmarkCountService` over gRPC without listing Engagement in `Dependencies`
  (`ConferenceModule.cs:15-30` versus `Conference.Service/Program.cs:274-281`), so neither the
  topological sort nor the `RequiresDependencies` check knows about that edge. Nothing enforces that
  `Dependencies` matches the interfaces a module actually resolves.
- **The one guard against a forgotten cross-process rewire is unadopted.** `ValidateRemoteDependencies`
  was written for exactly the "typo'd or forgotten `AddTypedGrpcClient`" failure
  (`ModuleLoader.cs:202-215`), and no host calls it, so that failure still shows up as a stub no-op at
  request time.
- **Names are strings, matched case-insensitively across three places.** The module dictionary, the
  configuration lookup and the seeder lookup all key on `Name`
  (`ModuleLoader.cs:20,109,288-294`), so renaming a module without updating every dependent's
  `Dependencies` list and every host's `Modules` section yields a module treated as disabled with, at
  worst, a warning.
- **Controller filtering is coupled to assembly and namespace naming.** A disabled module's
  controllers are found by a `.{ModuleName}.` substring test on the assembly name or namespace
  (`ModuleControllerFeatureProvider.cs:60-82`), so a project that does not follow the
  `MMCA.{Repo}.{Module}.{Layer}` convention keeps its endpoints mapped while its services are absent.
- **Every module is constructed by `Activator.CreateInstance`** (`ModuleLoader.cs:103`), so a module
  type needs a public parameterless constructor and cannot take injected dependencies; anything a
  module needs at registration time has to arrive through the `Register` parameters.

## Related
ADR-008 (the extraction topology that consumes this model: "a service is the monolith with one module
enabled" is a statement about `ModuleLoader` plus the `Disabled*` stubs, cited there as pre-existing
context), ADR-006 (the database axis of the same split; a module's data source is orthogonal to its
composition), ADR-007 (the typed gRPC clients that replace a disabled module's stubs at the host
level), ADR-014 (`AddApplicationDecorators()` must run after every module's handler scan, which is why
module registration is a distinct, ordered startup step), ADR-015 (the module-isolation fitness
functions that keep cross-module traffic on the `*.Shared` contracts this model registers,
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8-16`).
