# ADR-059: The IModule Contract and Reflection-Based Module Composition

## Status
Accepted (2026-07-28; revised 2026-08-14). Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-19: ADC Conference and Engagement gain module conformance tests, so seven of the eight modules are checked (only Helpdesk Tickets is not).
Revised 2026-10-21: ADC `ConferenceModule` registers three stubs (adding the `IUserConferenceExportService` export stub), `DisabledEventLiveValidationService` fails open across five members, the empty-export stub list names the Conference and Store Catalog export stubs, and host anchors are refreshed.
Revised 2026-10-26: service-host anchors refreshed after the host Program.cs files moved (no behavior change).
Revised 2026-10-28: the Trade-offs list of undeclared cross-module gRPC edges grows from two to five consuming modules (ADC Engagement, Notification and Identity join ADC Conference and Store Identity), the ADR-008 reading is corrected (only `ModuleLoader` is its Context; the `Disabled*` stubs belong to its Strangler Fig step), and anchors are refreshed.
Amended 2026-11-12: the composed service-host call (`AddMmcaServiceHost` / `UseMmcaServiceHostAsync`, package `MMCA.Common.ServiceHost`) owns the host registration order around `AddMmcaApplicationPipeline`, every Store and ADC service host calls it, and the host anchors are re-pointed into its options.
Amended 2026-11-17: the UI heads read the same `Modules` switch with the same rule (a module missing from configuration is off), and the Blazor server head forwards its enabled flags to the WebAssembly client through `/client-config`, so one switch decides a module's UI on every head (MMCA.Common v1.301.0). See the Revision (2026-11-17) at the end.
Revised 2026-11-23: ADC `EngagementModule` registers three stubs (adding `IPendingTicketInvitationService`) and ADC `IdentityModule` two (adding `IVerifiedUserLookupService`), the Trade-offs list of silently degrading stubs names both, the undeclared gRPC edges add Engagement's verified-user lookup client into Identity and Identity's ticket-invitation client into Engagement (still five consuming modules), and anchors are refreshed.

## Context
The framework's headline claim is that an application is built as a modular monolith and later
extracted into services without rewriting business logic. ADR-008 states the extracted shape in one
sentence, "Each service is the monolith with one module enabled"
(`Website/docs-src/adr/008-service-extraction-topology.md:51`). It treats `ModuleLoader` as
**pre-existing context** before deciding the extraction topology (`:30`), and relies on the
`Disabled*` stubs in its Strangler Fig extraction step, where the combined host keeps running with
the extracted module turned off (`:57-59`). ADR-006 decides the database axis
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
- **Discovery is a reflection scan over the assemblies the host names.** `moduleAssemblies` is a
  required parameter of `DiscoverAndRegister`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:59-65`), with the reason
  written onto the parameter itself (`:49-54`): an ambient scan sees only assemblies already loaded,
  so a module assembly that is referenced but not yet touched by any code path would be silently
  absent from discovery. `ModuleLoader` scans what it is given (`ModuleLoader.cs:74-97`), keeps every
  concrete non-abstract, non-interface `IModule` type and instantiates each through
  `Activator.CreateInstance` (`ModuleLoader.cs:99-102`), and does the same for `IModuleSeeder`,
  keyed case-insensitively by `ModuleName` (`ModuleLoader.cs:104-107`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModuleSeeder.cs:8-19`). A scan failure is
  not fatal but logs at Error: a `ReflectionTypeLoadException` from `GetTypes()` keeps the types that
  did load, so the assembly's loadable modules still register (`ModuleLoader.cs:81-88,354-355`), and
  any other exception drops that assembly (`ModuleLoader.cs:89-95,351-352`); both paths are pinned by
  `ModuleLoaderTests.cs:223-255`.
- **A host names one marker assembly per module it runs.** `AddModuleHost` takes that list as its
  first parameter and hands it to the loader it builds
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:51-53,84-90`),
  and its `RegisterModules` step runs `DiscoverAndRegister` over exactly that list
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostContext.cs:66-76`). The service
  hosts pass the list as `MmcaServiceHostOptions.ModuleAssemblies`, which the composed call hands to
  `AddModuleHost` and refuses when empty
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:67-72,100-102`):
  Store (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:38`,
  `MMCA.Store.Identity.Service/Program.cs:43`, `MMCA.Store.Sales.Service/Program.cs:58`) and
  ADC (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:89`,
  `MMCA.ADC.Conference.Service/Program.cs:89`, `MMCA.ADC.Engagement.Service/Program.cs:65`,
  `MMCA.ADC.Notification.Service/Program.cs:65`) each name the single assembly of the one module
  that host enables, so an extracted service's scan surface equals its own module. Helpdesk calls
  `DiscoverAndRegister` with its one module assembly inside a `Register` step of its
  `AddMmcaApplicationPipeline` call
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:138`, the step at `:142-150`), and the
  unit tests name their own assembly the same way
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:42-49`).
- **A composed service-host call owns the host registration order.** `AddMmcaServiceHost`
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:63`) runs, in
  this order: the `ConfigureConfigurationSources` callback first, so every eager bind sees a vault
  value (`:74-77`); the Kestrel endpoints with the health-probe listener (`:79`); Serilog, then the
  service defaults, then the `AfterServiceDefaults` callback (`:82-84`); Redis caching, the optional
  Redis output cache and the two-level cache (`:89-95`); the module host, whose loader logs through
  a bootstrap logger factory (`:99-102`); the infrastructure health checks with a database required
  (`:104`); CORS, API versioning and rate limiting (`:106-108`); the output cache with a no-cache base
  policy, then the `ConfigureOutputCache` callback (`:110-114`); response compression, the OpenAPI
  3.1 pin on the `v1` document and `AddCommonOpenApi()` (`:116-128`); forwarded JWT validation, or
  in-process validation when the host selects `ServiceHostAuthentication.TokenIssuer` (`:130-141`);
  the exception handlers, `AddInfrastructure` and `AddAPI` (`:143-145`); the `ConfigureServices`
  callback (`:147`); the `RegisterBrokerTransports` callback, because `AddBrokerMessaging` picks its
  transport while it registers (`:149-150`); `AddMmcaApplicationPipeline` (`:152`); and last the gRPC
  service defaults and the per-module health checks, which can only see the modules discovery found
  (`:154-157`). The pipeline BODY stays the host's: the call passes the required `ConfigurePipeline`
  callback, with the module host, into `AddMmcaApplicationPipeline` (`:152`,
  `MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/MmcaServiceHostOptions.cs:30-35`), so the
  module scans, `moduleHost.RegisterModules` (and through it `ModuleLoader.DiscoverAndRegister`), the
  typed gRPC clients and the broker registration run inside the pipeline in the order the host writes
  (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:129-139`). The decorators-last
  rule is therefore unchanged: the pipeline still runs the decorators after that body and seals, and
  the composed call documents that nothing registered after it may add a command or query handler
  (`ServiceHostBuilderExtensions.cs:53-57`). `UseMmcaServiceHostAsync`
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostApplicationExtensions.cs:43`)
  applies the matching middleware and endpoint order: the OpenAPI registration check (`:50`),
  database migration and seeding before anything is mapped (`:53`), the health endpoints (`:55`), the
  shared middleware pipeline (`:56`), the OpenAPI document (`:57`), the gRPC reflection service in
  Development only (`:59-64`), and disposal of the bootstrap logger factory on `ApplicationStopped`
  (`:68`); the host maps its own gRPC services, hubs and MCP endpoint after it (`:12-13`).
- **The composed call deliberately leaves two things to the host.** It does not register the OpenAPI
  document: the host keeps its own `builder.Services.AddOpenApi();` line, because the XML-comment
  generator attaches a project's controller summaries only at an `AddOpenApi` call site compiled in
  that project (`ServiceHostBuilderExtensions.cs:118-128`), and `UseMmcaServiceHostAsync` fails
  startup with `InvalidOperationException` when no `v1` document is registered
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostOpenApi.cs:24-37`); every adopter
  keeps the line (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:30`). And it makes
  no vendor call: Key Vault, the Azure Monitor exporter and a cloud broker transport enter only
  through the callbacks (`ServiceHostBuilderExtensions.cs:20-25`, `MmcaServiceHostOptions.cs:62-84`),
  under the boundary ADR-134 records.
- **The composed call is opt-in.** It is one package over the same registrations, and a host that
  keeps calling `AddModuleHost`, the individual registrations and `AddMmcaApplicationPipeline` in
  that order is still correct. Helpdesk composes by hand without `AddModuleHost`: it builds its own
  `ModuleLoader` and calls `DiscoverAndRegister` inside its own pipeline
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:124-128`, `:138`, `:142`), with its own
  `AddForwardedJwtBearer` call (`:53`), and has no `AddModuleHost` or `AddMmcaServiceHost` call. Every
  Store and ADC service host calls it on that branch, one citation each: Store
  Catalog (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`), Identity
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:37`) and Sales
  (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:51`); ADC Identity
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:82`), Conference
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`), Engagement
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:58`) and Notification
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:58`). `IModule`,
  `ModuleLoader` and the `Disabled*` stubs are untouched by it. The forwarded-JWT audience rule
  counts a composed host that does not select `ServiceHostAuthentication.TokenIssuer` as a
  forwarded-JWT host, since the composed call makes the guarded `AddForwardedJwtBearer` call itself
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Api/ArchitectureRules.ForwardedJwt.cs:8,10,20-23`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Api/ForwardedJwtAudienceTestsBase.cs:7-11`);
  the two token issuers select it (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:67`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:120`).
- **Registration order is a Kahn topological sort over the declared names.** The loader sorts before
  it registers anything (`ModuleLoader.cs:110`); the sort builds an in-degree map plus a reverse
  adjacency list, seeds a queue with the zero-in-degree modules, and drains it
  (`ModuleLoader.cs:284-334`), so a dependency's DI registrations are always in the container before
  a dependent's `Register` runs. A declared name that no discovered module supplies is skipped while
  building the graph and never blocks the sort (`ModuleLoader.cs:299-300`).
- **A cycle is a startup failure that names the cycle.** If fewer modules come out of the sort than
  went in, the remainder is circular and the loader throws `InvalidOperationException` listing them
  (`ModuleLoader.cs:326-331`); `ModuleLoaderTests.cs:71-83` asserts both the message and the member
  names.
- **Enablement is configuration, and absence means off.** `ModulesSettings` binds the `Modules`
  section as a name-to-`ModuleSettings` dictionary
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7,10`), and
  `IsModuleEnabled` returns true only when the key exists **and** `Enabled` is true
  (`ModulesSettings.cs:18-19`). A module missing from configuration is therefore treated as disabled,
  even though `ModuleSettings.Enabled` itself defaults to `true`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:9`); `ModuleLoaderTests.cs:300-306`
  pins that behavior.
- **The UI heads read the same switch with the same rule.** A UI head registers a module's UI only
  when `UIModuleConfiguration.IsModuleEnabled(configuration, name)` says so
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:28`), which
  applies the service hosts' rule: the `Modules:{name}` key must exist and its `Enabled` must not be
  false (`:34`). The Blazor server head forwards the resolved flags (and nothing else from the section)
  to the WebAssembly client as the `modules` section of `/client-config`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:98`,
  built by `BuildModulesSection` at `:124-128`), which the client loads into configuration before it registers modules, so the
  interactive client registers exactly the modules its server head rendered. `Modules` is a reserved
  client-config section name (`ClientConfigBuilder.cs:52`). A MAUI head has no server head and reads its
  own `Modules` section. One difference remains: the UI rule reads `IConfiguration`, whose keys are
  case-insensitive, while `ModulesSettings` is a plain dictionary (see Trade-offs).
- **Disabled means stubs, not absence.** For a disabled module the loader calls
  `RegisterDisabledStubs` and never calls `Register`, snapshots the descriptors that call appended so
  they can be validated later, and records the name (`ModuleLoader.cs:114-126`). The stubs are
  null-object implementations of the owning module's cross-module contracts, shipped in that module's
  `*.Shared` project: `DisabledProductVariantService` answers `false` for existence checks, `null` for
  the SKU lookup, an empty collection for the batch existence query and an empty dictionary for the
  batch price and catalog-info queries
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/DisabledProductVariantService.cs:10-50`);
  `DisabledCustomerService` returns `null`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Customers/DisabledCustomerService.cs:8-15`);
  `DisabledSessionBookmarkValidationService` returns `Result.Success()` plus an empty session-id
  collection, which deliberately skips the BR-49 / BR-91 eligibility checks
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30-39`);
  `DisabledEventLiveValidationService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/Live/DisabledEventLiveValidationService.cs:23-76`)
  fails open across all five of the members it has grown to: an always-open live window for an event
  (`:25-27`) and for a session (`:29-43`), every sponsor reported as belonging to a published event
  under a default id and an empty name (`:45-51`), a room's own id echoed back as the current
  session with an empty title (`:53-64`), and an empty overlapping-session set, so a per-time-slot
  rule is skipped rather than rejecting every check-in (`:66-75`).
  The dependent's code path does not branch on "is the module here": it resolves the interface and
  gets a documented degraded answer.
- **`Dependencies` declares the graph; `RequiresDependencies` decides whether a gap is fatal.** The
  loader computes the module's disabled dependencies, then narrows them to "unsatisfied" by removing
  any name the consumer listed under `Modules:{Module}:RemoteDependencies`
  (`ModuleLoader.cs:144-150`, `ModulesSettings.cs:30-32`,
  `ModuleSettings.cs:37`). With `RequiresDependencies = true` an unsatisfied dependency throws at
  startup with remediation text naming the three options (`ModuleLoader.cs:152-160`); with the
  default `false` the loader logs a warning and the module runs against the stub
  (`ModuleLoader.cs:162-165,345-346`). Only the strict branch is under test:
  `ModuleLoaderTests.cs:87-97` asserts that a `RequiresDependencies = true` module with an
  unsatisfied disabled dependency throws, and `ModuleLoaderTests.cs:118-128` asserts that the same
  strictness passes once that dependency is declared under `RemoteDependencies`. The default `false`
  warn-and-continue path has no test of its own.
- **Per-module configuration arrives by naming convention.** Immediately before `Register`, the
  loader adds `modules.{name}.json` and, when the host passes an environment name,
  `modules.{name}.{environment}.json`, both optional and reload-on-change
  (`ModuleLoader.cs:187-191`), so a module can carry its own configuration file without a host edit.
- **Composition also shapes the HTTP surface, seeding and health.** `AddAPI(modulesSettings)`
  installs `ModuleControllerFeatureProvider`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:45,70-74`), which removes
  from MVC discovery any controller whose assembly name or namespace contains a `.{ModuleName}.`
  token for a disabled module, so those endpoints are never mapped instead of mapping and then
  failing with a 500
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:33-53,60-82`).
  Seeders run only for enabled modules and in registration order (`ModuleLoader.cs:131-134,268-274`),
  invoked from startup database initialization
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:51-54,137`).
  `AddModuleHealthChecks` publishes one `module-{Name}` check per module, Healthy when enabled and
  Degraded when disabled (`DependencyInjection.cs:220-242`).
- **A remote-dependency validator exists but is not wired.** `ValidateRemoteDependencies` re-resolves
  every service type a disabled dependency's stub registered, throwing when it no longer resolves and
  warning when it still resolves to the stub type (`ModuleLoader.cs:214-259`). It is exercised only by
  unit tests (`ModuleLoaderTests.cs:132-178`); **no host calls it today**, so a forgotten gRPC client
  registration is still a silent stub at the first request rather than a startup failure.

The module inventory is small and explicit. **MMCA.Store has three:** `CatalogModule` (leaf, stubs
`IProductVariantService` and `IUserCatalogExportService`,
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:15-48`, the stubs at
`:31-32`), `IdentityModule`
(leaf, stubs `ICustomerService`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:16-47`, the stub at
`:27-28`) and `SalesModule`, which declares `["Catalog", "Identity"]` with
`RequiresDependencies = true` and publishes one cross-module contract of its own,
`IUserSalesExportService` stubbed by `DisabledUserSalesExportService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:25-94`, the stub registration at
`:47-48`,
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Exports/DisabledUserSalesExportService.cs:7-12`).
Store has two data-subject export edges into Identity, Sales and Catalog, which is why Store's
`IdentityModule.Register` adds both `AddUserDataExportSection<SalesUserDataExportSection>()` and
`AddUserDataExportSection<CatalogUserDataExportSection>()`
(`MMCA.Store.Identity.API/IdentityModule.cs:40,45`). **MMCA.ADC has four:**
`IdentityModule` (leaf, stubs `IAttendeeQueryService` and `IVerifiedUserLookupService`,
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13-28`, the stubs at
`:21-22`), `ConferenceModule`
(no declared dependencies, three stubs including the `IUserConferenceExportService` export contract,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:16-32`, the stubs at
`:24-26`),
`EngagementModule` (`["Conference"]`, strict, three stubs including the
`IPendingTicketInvitationService` invitation contract,
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:15-37`, the stubs at
`:33-35`) and
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
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:27-34`), then registers typed
gRPC clients for the two contracts in the pipeline steps after `moduleHost.RegisterModules`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:130,134-135`); because the host names
only its own module assembly, the peer modules are never discovered there and their stubs are never
registered. ADC Engagement declares
`["Conference"]` remote (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/appsettings.json:44-52`,
the list at `:49`) and ADC Notification declares `["Identity"]` remote
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:27-35`, the list at `:33`),
while ADC Conference and ADC Identity each enable one module and declare nothing remote
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:21-26`,
`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:30-33`). Those declarations
cover only the peers a module lists in `Dependencies`. Every ADC host also wires at least one peer
gRPC client it declares nowhere: Conference wires Engagement's `IBookmarkCountService`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:358`), Engagement wires
Notification's live-channel client and Identity's verified-user lookup client
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:220-221`), Notification wires
Conference's event-live validation client
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:120`), and Identity wires the
Engagement, Notification and Conference export clients and Engagement's ticket-invitation client
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:303-306`). The Trade-offs record
those undeclared edges.

## Rationale
- **Reflection discovery keeps hosts out of the module registration business.** A host names the
  assemblies and gets whatever `IModule` types they contain: no per-module registration call, no
  ordering to get right, and no hand-maintained handler list to keep in step with the module
  (`ModuleLoader.cs:99-102`). Naming the assemblies is what makes the set discovery sees a property of
  the composition root rather than of whatever the runtime happened to load (`ModuleLoader.cs:49-54`).
- **Topological order replaces registration luck.** Cross-module registration depends on ordering,
  and declaring `Dependencies` makes that ordering explicit and machine-checked instead of implicit
  in the order the host happens to call things (`ModuleLoader.cs:110,284-334`).
- **Null-object stubs are what make extraction a hosting change.** Because a disabled module still
  puts its contract type in the container, the dependent module's Application and Domain code has no
  branch for "peer not present", which is precisely why a module's non-hosting layers are identical
  in-process and extracted (`ModuleLoader.cs:121`, `CatalogModule.cs:31-32`). An extracted host,
  which never discovers its peers, registers a real cross-process adapter for the same contract
  instead (`Sales.Service/Program.cs:134-135`).
- **Two strictness levels, chosen per module.** A module that genuinely cannot function without a
  peer opts into `RequiresDependencies = true` and fails fast (`SalesModule.cs:38`,
  `EngagementModule.cs:24`, `NotificationModule.cs:24`); everything else tolerates a missing peer and
  degrades, which is the safer default for a module whose cross-module call is advisory.
- **`RemoteDependencies` keeps strictness usable after extraction.** Without it, every strict module
  would have to be relaxed to run in its own service, losing the check in the very topology that
  needs it most; instead the operator states the dependency is satisfied out of process
  (`ModuleSettings.cs:11-37`, `ModuleLoader.cs:148-150`).
- **Composition lives in configuration, so one build serves N deployments.** The same assemblies run
  as a combined host or as a set of single-module services with no code change; the only difference
  is the `Modules` section each host reads (`ModulesSettings.cs:10`, plus the per-service
  `appsettings.json` blocks cited above).

## Trade-offs
- **The composition root has to name every module assembly.** Discovery scans exactly the list it is
  handed (`ModuleLoader.cs:59-65`), so adding a module to a host is a third edit beside the project
  reference and the `Modules` configuration entry: the assembly list in that host's `Program.cs`
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:38`). An assembly left out
  of the list contributes nothing, and the module surfaces as "disabled" (absence equals disabled,
  `ModulesSettings.cs:18-19`), not as an error. The trade is deliberate: an ambient scan would make
  the same omission depend on whether some code path happened to load the assembly first
  (`ModuleLoader.cs:49-54`).
- **Stubs degrade silently by design.** A stub answers success-shaped defaults: an always-open live
  window (`DisabledEventLiveValidationService.cs:27,36-43`), a passing bookmark validation
  (`DisabledSessionBookmarkValidationService.cs:33-34`), zero counts
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/DisabledBookmarkCountService.cs:7-23`),
  an empty attendee list
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7-12`),
  an empty verified-user list
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledVerifiedUserLookupService.cs:7-14`),
  no pending ticket invitation
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Tickets/Invitations/DisabledPendingTicketInvitationService.cs:8-13`),
  empty exports
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Exports/DisabledUserEngagementExportService.cs:7-12`,
  `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7-12`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Exports/DisabledUserConferenceExportService.cs:7-12`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Exports/DisabledUserSalesExportService.cs:10-11`,
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Exports/DisabledUserCatalogExportService.cs:7-12`).
  The export stubs are the sharpest case: because the stub answers successfully, the consuming
  section reports itself `Complete` with nothing in it rather than unavailable
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ExportUserData/SalesUserDataExportSection.cs:52-56`),
  so a data-subject export assembled while a module is disabled reads as a complete document.
  A wrongly disabled module therefore produces plausible wrong answers rather than an error, and the
  only startup signal is a Degraded `module-{Name}` health check plus a log line
  (`DependencyInjection.cs:232-239`, `ModuleLoader.cs:336-337,345-346`).
- **The dependency graph is a hand-written declaration, not a derived fact.** Five modules consume a
  peer over gRPC without listing it in `Dependencies`. ADC Conference consumes Engagement's
  `IBookmarkCountService` (`ConferenceModule.cs:16-32` versus `Conference.Service/Program.cs:358`).
  ADC Engagement declares only `["Conference"]`, and lists only Conference under `RemoteDependencies`,
  yet its host wires Notification's live-channel client and Identity's verified-user lookup client
  (`EngagementModule.cs:21` versus
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:220-221`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/appsettings.json:49`). ADC Notification declares
  only `["Identity"]`, and lists only Identity under `RemoteDependencies`, yet its host wires
  Conference's event-live validation client (`NotificationModule.cs:21` versus
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:120`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:31-34`). ADC
  `IdentityModule` declares no `Dependencies` yet its host wires the Engagement, Notification and
  Conference export clients and Engagement's ticket-invitation client
  (`MMCA.ADC.Identity.API/IdentityModule.cs:13-28` versus
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:303-306`). Store Identity consumes
  the Sales and Catalog export services while its `IdentityModule` declares no `Dependencies` at all
  (`MMCA.Store.Identity.API/IdentityModule.cs:16-47` versus
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:132-133`). Neither the
  topological sort nor the `RequiresDependencies` check knows about those edges. Nothing derives
  `Dependencies` from the interfaces a module actually resolves. What is pinned is the declaration
  against a written expectation: `ModuleConformanceTestsBase<TModule>` asserts `Name`, `Dependencies`,
  `RequiresDependencies` (read through the `IModule` interface, so a leaf module is checked against
  the framework defaults too) and what `RegisterDisabledStubs` puts in the container
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ModuleConformanceTestsBase.cs:21-64`).
  That turns a silent edit of a declaration into a red test, but it is opt-in per module and seven of
  the eight subclass it today: every Store module (Catalog, Identity and Sales) and every ADC module
  (Conference, Engagement, Identity and Notification,
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/ConferenceModuleTests.cs:10`,
  `MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.API.Tests/EngagementModuleTests.cs:10`).
  Only Helpdesk Tickets has no subclass, so its declaration alone is still unchecked.
- **The one guard against a forgotten cross-process rewire is unadopted.** `ValidateRemoteDependencies`
  was written for exactly the "typo'd or forgotten `AddTypedGrpcClient`" failure
  (`ModuleLoader.cs:200-213`, the text at `:205`), and no host calls it, so that failure still shows
  up as a stub no-op at request time.
- **Names are strings, and they are not all matched the same way.** The loader's own maps key on
  `Name` case-insensitively: the stub snapshot, the seeder lookup and the sort graph
  (`ModuleLoader.cs:21,107,286-292`). The configuration lookup is ordinal and case-sensitive:
  `ModulesSettings` is a `Dictionary<string, ModuleSettings>` with no comparer and `IsModuleEnabled`
  is a plain `TryGetValue` (`ModulesSettings.cs:7,18-19`), so a `Modules` key whose casing differs
  from `Name` reads as absent and therefore disabled. Renaming a module without updating every
  dependent's `Dependencies` list and every host's `Modules` section likewise yields a module treated
  as disabled with, at worst, a warning.
- **Controller filtering does not read "disabled" the way the loader does.** The provider builds its
  disabled set from the entries **present** in the `Modules` section whose `Enabled` is false
  (`ModuleControllerFeatureProvider.cs:36-39`), while the loader treats a module missing from that
  section as disabled (`ModulesSettings.cs:18-19`). A module simply left out of configuration
  therefore gets no `Register` call and none of its services, yet keeps its controllers mapped: the
  map-then-500-on-request case this provider exists to prevent
  (`ModuleControllerFeatureProvider.cs:19-25`). Every host today enumerates its whole module set and
  pins each disabled peer to `"Enabled": false`
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/appsettings.json:20-24`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:21-26`; the Helpdesk seed has
  only the one module to list, `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:13-15`),
  so the divergence is latent rather than live. The accepted position is that a host enumerates its
  modules rather than leaning on the absence rule.
- **Controller filtering is coupled to assembly and namespace naming.** A disabled module's
  controllers are found by a `.{ModuleName}.` substring test on the assembly name or namespace
  (`ModuleControllerFeatureProvider.cs:60-82`), so a project that does not follow the
  `MMCA.{Repo}.{Module}.{Layer}` convention keeps its endpoints mapped while its services are absent.
- **Every module is constructed by `Activator.CreateInstance`** (`ModuleLoader.cs:101`), so a module
  type needs a public parameterless constructor and cannot take injected dependencies; anything a
  module needs at registration time has to arrive through the `Register` parameters.

## Revision (2026-10-01)
The decision is unchanged; four statements are corrected against the code and the citations are
re-anchored. A `GetTypes()` failure is no longer a skip: a `ReflectionTypeLoadException` keeps the
types that did load and logs at Error, and only any other exception drops the assembly
(`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:81-93,349-353`,
`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:223-255`). Module
names are not matched case-insensitively everywhere: the `Modules` configuration lookup is an
ordinal `TryGetValue` (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModulesSettings.cs:7,18-19`).
An extracted host never discovers its peers, so it registers gRPC clients rather than replacing peer
stubs (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:131-133,244-245`). Store's
inventory grew a Catalog export contract: `CatalogModule` stubs `IUserCatalogExportService`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:31-32`) and Identity adds
a Catalog export section (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/IdentityModule.cs:45`),
an undeclared edge now named beside the ADC one. `DisabledAttendeeQueryService` is listed as an
empty attendee list rather than an export, and the ADR-015 isolation base is cited at its new
`Bases/Layering/` path.

## Revision (2026-10-06)
- No content change: the decision, the module inventory and every behavioral statement still match
  the code.
- Anchors re-verified against current source: the Store and ADC service hosts' module-assembly lists,
  the Sales gRPC clients (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:246-247`),
  the Store Identity export clients (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:265,276`),
  the ADC Conference bookmark-count client (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:416`),
  the seeding call (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:124`)
  and `ModuleIsolationTestsBase` (`:8-40`, now seven facts). The Sales host assembly list cited in
  the 2026-10-01 revision is now at `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:132-134`.

## Revision (2026-10-07)
Re-verified against current source. The decision, the module inventory and every behavioral
statement are unchanged: `AddModuleHealthChecks` still publishes one Healthy `module-{Name}` check per
enabled module and one Degraded check per disabled module, startup database initialization still runs
the module seeders, and ADC Conference still wires Engagement's `IBookmarkCountService` client without
declaring Engagement in `Dependencies`. Only line numbers moved.

1. Anchors re-verified against current source: the ADC Conference `AddModuleHost` call
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:371-373`), the ADC Conference
   bookmark-count client (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:418`), the
   `InitializeDatabaseAsync` signature and its seeding call
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:51-54,137`;
   line 124 is now the pending-migrations check, so the 2026-10-06 `:124` seeding anchor is stale), and
   `AddModuleHealthChecks` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:212-234`,
   the Degraded branch at `:224-231`).

## Revision (2026-10-19)
No decision changed. The Trade-offs count of declaration-checked modules moves from five of eight to
seven of eight: ADC adds `ConferenceModuleTests`, which pins `Conference` with no dependencies and
`RequiresDependencies` false
(`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/ConferenceModuleTests.cs:9`, `:11`,
`:15`, `:17`), and `EngagementModuleTests`, which pins `Engagement` depending on `Conference` with
`RequiresDependencies` true
(`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.API.Tests/EngagementModuleTests.cs:9`, `:11`,
`:13`, `:15`). Helpdesk Tickets is the one module still unchecked. The undeclared Conference-to-Engagement
gRPC edge recorded in the 2026-10-07 revision is unchanged, and the new test pins that declaration as it
stands rather than resolving it.

Same date, separately: the Helpdesk host no longer calls `DiscoverAndRegister` as a bare statement.
It runs inside a `Register` step of `services.AddMmcaApplicationPipeline(...)`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:121`, step `:125-133`), so discovery sits
between `AddApplication()` and `AddApplicationDecorators()` by construction. The scan input is
unchanged (one named assembly, `typeof(TicketsModule).Assembly` at `:132`); the Decision's dead
`:116-124` anchor is re-pointed.

## Revision (2026-10-21)
Re-verified against current source. The decision, the strictness rules and the undeclared
Conference-to-Engagement gRPC edge are unchanged (`ConferenceModule` still declares no
`Dependencies`); the Conference module's stub set and the live-validation stub grew, and the host
anchors moved (by one to eight lines; the Store Sales gRPC client block gained a `:241` anchor).

1. `ConferenceModule` registers three stubs, not two: `ISessionBookmarkValidationService`,
   `IEventLiveValidationService` and the data-subject export contract `IUserConferenceExportService`
   backed by `DisabledUserConferenceExportService`
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:24-26`, class at
   `:16-32`;
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Exports/DisabledUserConferenceExportService.cs:7-12`).
   `ConferenceModuleTests.AssertDisabledStubs` asserts all three
   (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/ConferenceModuleTests.cs:20-46`,
   the export stub at `:42-45`).
2. `DisabledEventLiveValidationService` has five fail-open members: the fifth,
   `GetOverlappingSessionIdsAsync`, answers an empty overlapping-session set
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/Live/DisabledEventLiveValidationService.cs:65-74`,
   class at `:23-75`).
3. The Trade-offs list of empty-export stubs now names the two it omitted:
   `DisabledUserConferenceExportService` (above) and Store's `DisabledUserCatalogExportService`
   (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Exports/DisabledUserCatalogExportService.cs:7-12`).
4. Anchors re-verified against current source: the `AddModuleHost` calls in Store Identity
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:120-122`), Store Sales
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:133-135`), ADC Identity
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:266-268`), ADC Conference
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:373-375`), ADC Engagement
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:214-216`) and ADC Notification
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:196-198`); the Store Sales
   gRPC clients registered after `.Register(moduleHost.RegisterModules)`
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:241,247-248`); the Store Identity
   export clients (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:273,284`); the
   ADC Conference bookmark-count client
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:420`); and the
   `ConferenceModuleTests` class (`ConferenceModuleTests.cs:10`, with `ExpectedName` at `:12`,
   `ExpectedDependencies` at `:16` and `ExpectedRequiresDependencies` at `:18`).

## Revision (2026-10-26)
Re-verified against current source. The decision, the module inventory, the strictness rules and both
undeclared gRPC edges are unchanged: `ConferenceModule` and Store's `IdentityModule` still declare no
`Dependencies`, each extracted host still names only its own module assembly in a three-line
`AddModuleHost` call, and the Store Sales gRPC clients are still registered after the loader. Only
line numbers in the service hosts moved (by six to eleven lines).

1. Anchors re-verified against current source: the `AddModuleHost` calls in Store Catalog
   (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:131-133`), Store Identity
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:126-128`), Store Sales
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:139-141`), ADC Identity
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:272-274`), ADC Conference
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:379-381`), ADC Engagement
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:220-222`) and ADC Notification
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:202-204`); the Store Sales
   gRPC clients registered after `.Register(moduleHost.RegisterModules)`
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:252,258-259`); the Store Identity
   export clients (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:284,295`); and
   the ADC Conference bookmark-count client
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:431`). The host anchors in the
   2026-10-01, 2026-10-06, 2026-10-07 and 2026-10-21 revisions are left as written and are superseded
   by these.

## Revision (2026-10-28)
Re-verified against current source. The decision, the module inventory, the strictness rules, the
health-check behavior and the stub behavior are unchanged: `AddModuleHealthChecks` still publishes
one Healthy `module-{Name}` check per enabled module and one Degraded check per disabled module,
`SalesModule` still declares `["Catalog", "Identity"]` with `RequiresDependencies = true`, and the ADC
Identity host still names only the `IdentityModule` assembly. The record of undeclared gRPC edges
was incomplete, and the ADR-008 reading was half right.

1. The Trade-offs list of undeclared cross-module gRPC edges names three more consumers beside ADC
   Conference and Store Identity. ADC Engagement declares only `["Conference"]`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:20`) yet its host
   wires `AddNotificationLiveChannelClient`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:303`). ADC Notification declares
   only `["Identity"]`
   (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:21`) and
   lists only Identity under `RemoteDependencies`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:31-34`) yet its host
   wires `AddConferenceEventLiveValidationClient`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:242`). ADC `IdentityModule`
   declares no `Dependencies`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13-25`) yet its host
   wires the Engagement, Notification and Conference export clients
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:342-344`). The 2026-10-26
   revision's "both undeclared gRPC edges" is left as written and is superseded by this item. The
   Decision's per-service configuration paragraph no longer presents ADC Conference as the only host
   wiring an undeclared peer client: it names all four ADC hosts and the ADC Identity `Modules` block
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:30-33`).
2. ADR-008 treats only `ModuleLoader` as Context
   (`Website/docs-src/adr/008-service-extraction-topology.md:30`); the `Disabled*` stubs appear in its
   Decision, in the Strangler Fig extraction step (`:57-59`), and its "one module enabled" sentence is at
   `:51`. The Context paragraph and the Related entry now say so.
3. Anchors re-verified against current source: `AddModuleHealthChecks`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:217-239`, the Degraded
   loop at `:229-236`); `SalesModule`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:24-99`, `RequiresDependencies`
   at `:37`, the stub registration at `:46-47`); the always-open live windows in
   `DisabledEventLiveValidationService`
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/Live/DisabledEventLiveValidationService.cs:27,36-43`);
   and the ADC Identity `AddModuleHost` call
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:273-275`). The anchors in the
   2026-10-07 and 2026-10-26 revisions are left as written and are superseded by these.

## Revision (2026-11-17)
The UI half of module enablement now follows this ADR's rule (MMCA.Common #758, the UI drift wave,
v1.301.0; plan in the workspace `Docs/Planning/Drift/UiProjects-plan.md`, item A10).

1. **The rule was inverted on the UI side.** Before this change `UIModuleConfiguration.IsModuleEnabled`
   treated a module missing from configuration as enabled, the opposite of `ModulesSettings`, so the
   same `Modules` section could mean two things depending on which host read it.
2. **The WebAssembly client never saw the server head's switch.** It read its own static
   `wwwroot/appsettings.json` (ADC's had no `Modules` section at all), and `/client-config` did not
   forward the section, so a module disabled on the server head was rendered on prerender and came back
   once the page went interactive. `/client-config` now carries the head's resolved flags, so the
   client registers the same set.
3. **Consumers.** ADC and Store list every module in each server and MAUI head; Store's redundant
   WebAssembly `Modules` section is deleted. A UI head that gates registration on the switch must list
   every module it registers, because a missing key is now off.
4. **Decision** gains the bullet "The UI heads read the same switch with the same rule".

## Revision (2026-11-23)
Re-verified against current source. The decision, the strictness rules, discovery, the sort, the
health-check and seeding behavior and the five fail-open members of
`DisabledEventLiveValidationService` are unchanged, and five modules still consume a peer over gRPC
without declaring it. Two ADC modules grew a stub, two undeclared gRPC edges were missing from the
record, and line numbers moved.

1. ADC `EngagementModule` registers three stubs, not two: `IBookmarkCountService`,
   `IUserEngagementExportService` and `IPendingTicketInvitationService` backed by
   `DisabledPendingTicketInvitationService`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:33-35`, class at
   `:15-37`), which answers that no invitation stands
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Tickets/Invitations/DisabledPendingTicketInvitationService.cs:8-13`).
2. ADC `IdentityModule` is still a leaf with no `Dependencies` but registers two stubs:
   `IAttendeeQueryService` and `IVerifiedUserLookupService` backed by
   `DisabledVerifiedUserLookupService`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:21-22`, class at
   `:13-28`), which returns an empty list
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledVerifiedUserLookupService.cs:7-14`).
   The Trade-offs list of silently degrading stubs now names both new stubs.
3. The record of undeclared gRPC edges gains two entries. The ADC Engagement host also wires
   `AddIdentityVerifiedUserLookupClient`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:221`) while `EngagementModule`
   declares only `["Conference"]` (`EngagementModule.cs:21`) and the host lists only Conference
   under `RemoteDependencies`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/appsettings.json:49`). The ADC Identity
   host also wires `AddEngagementTicketInvitationClient`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:306`). Both consuming modules
   were already on the list, so the count of five stands.
4. Anchors re-verified against current source: `ModuleLoader`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs`: scan `:74-97`,
   instantiation `:99-102`, seeders `:104-107`, sort call `:110`, disabled branch `:114-126` with the
   stub call at `:121`, seeder add `:131-134`, dependency check `:144-150`, strict throw `:152-160`,
   warning loop `:162-165`, module JSON `:187-191`, `ValidateRemoteDependencies` `:214-259` with its
   doc at `:200-213`, `SeedAllAsync` `:268-274`, `TopologicalSort` `:284-334` with the cycle throw at
   `:326-331`, and the log methods at `:336-337`, `:345-346`, `:351-352` and `:354-355`); the
   service-host `AddOpenApi`, `AddMmcaServiceHost` and `ModuleAssemblies` lines (Store Catalog
   `:30`, `:32`, `:38`; Store Identity `:35`, `:37`, `:43`; Store Sales `:49`, `:51`, `:58`; ADC
   Identity and Conference `:80`, `:82`, `:89`; ADC Engagement and Notification `:56`, `:58`,
   `:65`); the token issuers
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:67`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:120`); the Store Sales pipeline
   body (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:129-139`, the gRPC clients
   at `:134-135`); the peer gRPC clients (ADC Conference `:358`, Engagement `:220-221`, Notification
   `:120`, Identity `:303-306`, Store Identity `:132-133`); `/client-config`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:98`,
   `BuildModulesSection` at `:124-128`; `ClientConfigBuilder.cs:52`); `SalesModule`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:25-94`, `Dependencies` at
   `:31`, `RequiresDependencies` at `:38`, the stub at `:47-48`); `EngagementModule`
   `Dependencies` at `:21` and `RequiresDependencies` at `:24`; the ADC Engagement `Modules` block
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/appsettings.json:44-52`);
   `DisabledEventLiveValidationService` (class `:23-76`, room member `:53-64`, overlapping sessions
   `:66-75`); the `AddAPI` feature-provider registration and `AddModuleHealthChecks`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:70-74`, `:220-242`, the
   Degraded loop at `:232-239`); `ModuleSettings.RemoteDependencies`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:37`, its doc at
   `:11-36`); and `EngagementModuleTests`
   (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.API.Tests/EngagementModuleTests.cs:10`).
   The anchors in earlier revisions are left as written and are superseded by these.

## Related
ADR-008 (the extraction topology that consumes this model: "Each service is the monolith with one
module enabled" is a statement about `ModuleLoader`, cited there as pre-existing context, plus the
`Disabled*` stubs its Strangler Fig step relies on), ADR-006 (the database axis of the same split;
a module's data source is orthogonal to its composition), ADR-007 (the typed gRPC clients that replace a disabled module's stubs at the host
level), ADR-014 (`AddApplicationDecorators()` must run after every module's handler scan, which is why
module registration is a distinct, ordered startup step, and the step the composed
`AddMmcaServiceHost` call keeps as a host callback), ADR-134 (the cloud vendor boundary that keeps
vendor registrations out of the composed service-host call and in its callbacks), ADR-015 (the module-isolation fitness
functions that keep cross-module traffic on the `*.Shared` contracts this model registers,
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ModuleIsolationTestsBase.cs:8-40`).
