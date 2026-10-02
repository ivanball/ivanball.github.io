# Self-ordering modules: discovered, Kahn-ordered, and extractable

> Series: MMCA.Common · Article #14 (deep-dive) · Pillar P2 · Group G14 · Rubric §7 ·
> Status: grounded in `MMCA.Common/AGENTS.md` ("Module System"),
> `MMCA.Common.Application/Modules/*`, `.../Settings/ModulesSettings.cs`, `.../DependencyInjection.cs` and
> `.../DependencyInjection.ModuleScanning.cs`, `MMCA.Common.API/Startup/ModuleHostExtensions.cs` and
> `ModuleHostContext.cs` source, the reference hosts `MMCA.ADC.{Conference,Engagement,Identity,Notification}.Service/Program.cs`,
> `MMCA.ADC.Engagement.API/EngagementModule.cs`, `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs`,
> `MMCA.ADC/AGENTS.md`, `MMCA.Helpdesk/AGENTS.md`, and
> ADR-059 (the `IModule` contract and reflection-based module composition). No em dashes.

**Subtitle:** A module declares its name and its dependencies. The framework discovers every module,
sorts them with Kahn's algorithm, and registers them in an order where a dependency always exists
before the code that wraps it. The same code boots as a monolith or as a fleet of services.

---

Most "modular" .NET codebases have a `Program.cs` that looks like this:

```csharp
services.AddIdentityModule();
services.AddConferenceModule();   // no dependencies
services.AddEngagementModule();   // needs Conference
services.AddNotificationModule(); // needs Identity
```

It works until someone reorders two lines, or adds a module that depends on a module registered
later, or disables one module in one environment and forgets that three other registrations assumed it
was there. The dependency order between modules is real, it matters for correctness, and it is encoded
nowhere except the sequence of lines a human typed. That is a fragile place to keep an invariant.

## Why ordering is a correctness concern, not a style one

In MMCA.Common the registration order is not cosmetic. The CQRS pipeline wraps command and query
handlers with decorators (logging, caching, validation, transactions) using Scrutor's `TryDecorate`,
which wraps registrations that **already exist** in the container. If a module's concrete handlers are
not registered before the decorators run, there is nothing to wrap and the cross-cutting behavior
silently does not apply. So "register A before B" is not a preference. It is the difference between a
handler that gets a transaction and one that does not.

The honest problem with the hand-ordered list is that it makes a human responsible for a graph
property. Humans are bad at topological sorts done in their head, especially as the module count grows
and dependencies become transitive. The fix is to let each module declare what it needs and let the
framework compute the order.

## A module declares intent, not position

A module in MMCA.Common is an `IModule`. The contract is deliberately small:

```csharp
public interface IModule
{
    string Name { get; }
    IReadOnlyList<string> Dependencies => [];     // default-implemented
    bool RequiresDependencies => false;           // default-implemented
    void Register(IServiceCollection services, IConfigurationBuilder configuration,
                  ApplicationSettings applicationSettings);
    void RegisterDisabledStubs(IServiceCollection services) { } // default empty body
}
```

Three of the five members ship with default implementations, so a minimal module implements only
`Name` and `Register`. A real one is barely more than a dozen lines: ADC's `ConferenceModule` declares
its name, forwards `Register` to an `AddConferenceModule(applicationSettings)` extension method,
declares no dependencies (it is a foundational module the others build on), and (optionally) implements
`RegisterDisabledStubs`. A module that *does* depend on another, like `EngagementModule`, simply adds
`Dependencies => ["Conference"]` with `RequiresDependencies => true`. The module never says "register me
third." It says "my name is Engagement and I depend on Conference." Position is derived, not declared.

## The engine: ModuleLoader and Kahn's algorithm

`ModuleLoader` is the piece that turns those declarations into an order. Its `DiscoverAndRegister`
method scans the assemblies the host names in a required `moduleAssemblies` parameter, instantiates
every concrete `IModule` (and every `IModuleSeeder`) it finds there, and then runs **Kahn's topological
sort** over the declared `Dependencies`. The host names those assemblies explicitly on purpose: an
`AppDomain` scan only sees assemblies that are already loaded, so a module assembly that is referenced
but never touched by a code path would be silently absent from discovery.

Kahn's algorithm is breadth-first search over a dependency graph:

1. Compute each module's in-degree: the count of dependencies it is still waiting on.
2. Seed a queue with every zero-in-degree module (the ones that depend on nothing).
3. Emit a module from the queue, then decrement the in-degree of each module that depended on it.
   Any dependent that reaches zero gets enqueued.
4. Repeat until the queue is empty.

The output is an ordering where every module appears after all of its dependencies. Because the loader
registers modules in that order, a dependency's DI registrations always exist before any dependent
registers, which is exactly the precondition the decorator pipeline needs.

There is a built-in correctness check that the hand-ordered list could never give you: if fewer modules
come out of the sort than went in, the leftovers form a **dependency cycle**, and the loader throws with
the offending module names. A circular dependency between modules becomes a loud, named startup failure
instead of a subtle runtime surprise.

The scan is also defensive. Each `GetTypes()` call sits inside a guard with two catches. A
`ReflectionTypeLoadException` (the shape a missing transitive reference produces) still carries every
type that did load, so the loader keeps those and the assembly's loadable modules still register; any
other exception drops that one assembly. Both paths log at Error, because a module that silently fails
to register is an outage that looks like a configuration choice, and neither aborts discovery of the
rest. And every step emits a structured `[LoggerMessage]`-generated log line, so the startup log tells
you precisely which modules loaded, in what order, and how long each took. When something is wrong, you
read it, you do not guess it.

```csharp
// In each host's Program.cs. AddModuleHost binds and validates ApplicationSettings and
// ModulesSettings, builds the ModuleLoader and registers it as a singleton. It deliberately does
// not run discovery itself.
using var loggerFactory = SerilogHostExtensions.CreateBootstrapLoggerFactory();
var moduleHost = builder.AddModuleHost(
    [typeof(ConferenceModule).Assembly],      // the module assemblies, named explicitly
    loggerFactory.CreateLogger<ModuleLoader>());

// Discovery is a step of the application pipeline, so every module handler lands in the container
// before the decorators close over it.
services.AddMmcaApplicationPipeline(pipeline => pipeline
    .Register(moduleHost.RegisterModules));
```

A subtlety worth stating because it is easy to assume otherwise: discovery is **not** something
`AddApplication()` does for you, and the host does not call `DiscoverAndRegister` by hand either.
`AddModuleHost` captures the configuration, the bound settings, the environment name and the module
assemblies, and hands back a `ModuleHostContext` whose `RegisterModules` method is the delegate that
calls `DiscoverAndRegister` with all six of them. Registering that delegate as a pipeline step is what
puts the modules in the right place in the sequence. The loader stays a singleton, which is how it also
drives startup seeding through `SeedAllAsync` (which invokes each enabled module's
`IModuleSeeder.SeedAsync` once a real `IServiceProvider` exists, for example to seed a default admin
user).

## Disabling a module without breaking its consumers

Here is the part that turns this from a tidy registration trick into an extraction mechanism. A host can
disable a module through configuration. `ModulesSettings` binds the `"Modules"` config section (it is a
`Dictionary<string, ModuleSettings>`), and `ModuleSettings` carries a per-module `Enabled` flag
(default `true`) plus a `RemoteDependencies` list. A module the section does not list at all counts as
disabled, so enabling a module is always an explicit line of configuration.

```json
{
  "Modules": {
    "Conference":   { "Enabled": true },
    "Engagement":   { "Enabled": false, "RemoteDependencies": [] }
  }
}
```

When the loader reaches a disabled module it does not skip it. It calls that module's
`RegisterDisabledStubs(services)` and records the name in `DisabledModuleNames`. This is the crux. A
disabled Engagement module still contributes stub registrations for the cross-module interfaces other
modules depend on: `EngagementModule` registers `DisabledBookmarkCountService` as its
`IBookmarkCountService`. So in a host that names the Engagement assembly but disables the module,
Conference's `GetSessionBookmarkCountsHandler` still resolves `IBookmarkCountService`, because the
disabled module left a `Disabled*` stub behind.

That is a clean strategy plus null-object pairing (real service, disabled stub, or remote client) rather
than `if (moduleEnabled)` checks scattered through the call sites. The handler does not know or care
which of the three it got.

Dependency validation is microservice-aware to match. A dependency that is disabled in-process but
listed in this host's `ModuleSettings.RemoteDependencies` is treated as satisfied remotely (the host
will wire a typed gRPC client to the extracted peer), and only a module with `RequiresDependencies =
true` and a genuinely unsatisfied dependency throws at startup. Because a remote declaration is
configuration the loader takes on trust, it also offers `ValidateRemoteDependencies(IServiceProvider)`,
an opt-in check a host runs against the built provider: every service type a remote-declared
dependency's disabled stubs registered must resolve (a miss throws), and one that still resolves to the
stub logs a warning. The loader also loads per-module configuration by convention: before calling
`module.Register(...)` it adds `modules.{name}.json` (and the environment-specific variant) to the
configuration builder, so a module can ship its own config file.

## Convention scanning: what a module's Register actually wires

Modules do not hand-register every handler. `ScanModuleApplicationServices<TAssemblyMarker>()` is the
Scrutor-based convention scan that a module's `Add{X}Module` calls to register, by assembly, every kind
of application service a slice ships:

- **Domain event handlers and integration event handlers** as **singletons**.
- **Command and query handlers** as **scoped** services (one per request).
- **DTO mappers, DTO projectors, and request mappers** as **scoped** services (three separate scans,
  not one). The projector scan is optional and opt-in: an entity that ships an `IEntityDTOProjector`
  gets server-side projection on its list reads, one that does not keeps materialize-then-map.
- **Update appliers** as **scoped** services, in two flavors scanned side by side: the request-shaped
  `IEntityUpdateApplier<,,>` and the command-aware `IEntityUpdateCommandApplier<,,,>` for an update that
  also depends on state the request body does not carry. They are the write-side twin of the request
  mappers, so the generic update handler never has to know a field name.
- **FluentValidation validators** discovered from the same assembly, plus an auto-registered validator
  for any command that embeds a request via `ICommandWithRequest<T>`.

The full registration sequence the framework documents is a hard contract because of the decorator rule
described earlier, and `AddMmcaApplicationPipeline` is the call that composes it: it runs
`AddApplication()`, then your callback, then `AddApplicationDecorators()`, and then **seals** the
collection.

```csharp
services.AddInfrastructure(configuration);    // repos, UoW, DbContexts, caching, outbox
services.AddAPI(moduleHost.ModulesSettings);  // controllers, idempotency, error mapping

// AddApplication() runs first, inside this call; AddApplicationDecorators() runs last, inside it.
services.AddMmcaApplicationPipeline(pipeline => pipeline
    .Register(moduleHost.RegisterModules)     // every discovered module, in Kahn order
    .ScanModule<ModuleBClassRef>());          // or a single module named by its marker type
```

`AddApplicationDecorators()` is last on purpose. The concrete handlers from every module must already be
in the container, or `TryDecorate` has nothing to wrap. Sealing is what makes that checkable instead of
hopeful: a `ScanModuleApplicationServices` (or `AddEntityCrud`, or `AddEntityUpdate`) call that arrives
after the decorators throws an `InvalidOperationException` naming the caller, rather than quietly
registering a handler nothing wraps, and `VerifyDecoratorPipeline()` hands a fitness test the same
assertion over a fully composed collection. Registrations that are not handlers, such as infrastructure,
API, telemetry and options, sit outside the call because their order relative to the decorators does not
matter. The Kahn ordering inside `DiscoverAndRegister` guarantees the modules themselves go in
dependency order; the pipeline guarantees the decorators go on top of all of them.

## Each module is the unit of extraction

The reason all of this is worth the machinery is that the module is also the deploy and scale boundary,
and the same self-ordering `ModuleLoader` registration runs at both ends of it. As a monolith, one host
enables every module and cross-module calls are in-process method calls: MMCA.Helpdesk is the framework's
monolith-first reference app, a single `Tickets` module exercised end to end through all five layers to
demonstrate the "build the monolith now, extract a service later" path. As a fleet, each service host
names only its own module assembly to `ModuleLoader`, so its peers are never discovered and contribute
no stubs; the host instead registers a typed gRPC client adapter for each cross-module interface it
consumes, pointed at the real, extracted peer process. MMCA.ADC runs this way: four single-module
service hosts (Identity, Conference, Engagement, Notification) behind a YARP gateway, with no combined
monolith host at all. In its Conference host, `IBookmarkCountService` resolves to a
`BookmarkCountServiceGrpcAdapter` that calls the Engagement service. The disabled-stub path serves the
other shape: a host that names a peer's assembly and switches the module off. The Domain, Application,
and Shared code is identical in every topology. The transport choice lives entirely at the composition
edge (ADR-008).

That is the payoff of declaring intent instead of position: the same self-ordering registration that
makes the monolith correct is what makes the split reversible. Nothing in Helpdesk's `TicketsModule` or
ADC's `ConferenceModule` changes when it moves from one host to its own process.

## Trade-offs, honestly

- **Reflection at startup.** Discovery calls `GetTypes()` on every assembly the host named. This is a
  startup cost, paid once, and the per-`GetTypes()` guard means a load-time exception in one assembly is
  tolerated rather than fatal. Naming the assemblies keeps the bill proportional to the module count
  instead of to everything the process happens to have loaded, but it is a list the host has to maintain:
  forget an assembly and its module is simply not there.
- **Implicit order can surprise.** The convenience of "the framework figures out the order" is also a
  cost: the order is not visible as a list of lines. The structured startup log is the mitigation, but a
  developer used to reading the order off `Program.cs` has to learn to read it off the log instead.
- **Stubs must be maintained.** `RegisterDisabledStubs` is a real obligation. Add a cross-module
  interface and forget to register a stub for it, and a host that names that module's assembly but
  disables it fails to resolve the interface the first time something asks for it. The loader does not
  check stub coverage, so this is a discipline the contract assumes.
- **Cycles are rejected, not resolved.** A dependency cycle is a hard startup failure by design. That is
  the correct behavior, but it means you cannot lean on lazy resolution to paper over a genuine circular
  design between modules.

None of these are reasons to keep the hand-ordered list. They are the cost of moving the invariant from
a human's memory into the framework.

## Apply this even without MMCA

The pattern ports cleanly to any DI container:

1. Give each module a **name and a declared dependency list**, not a hard-coded registration position.
2. **Topologically sort** before you register. Kahn's algorithm is about fifteen lines; the payoff is
   that a cycle becomes a named exception instead of a subtle bug.
3. Register decorators or pipeline behaviors **after** the things they wrap, and make that ordering a
   consequence of the sort rather than a comment. Better still, make the sequence one call that closes
   itself, so a late registration throws instead of running unwrapped.
4. For anything you might disable per-environment, register a **null-object or stub** for its public
   interfaces, so consumers resolve regardless. The branch lives at composition, not at every call site.

The takeaway: if the order between your modules matters for correctness, derive it from declared
dependencies and verify it at startup. An ordering a human types by hand is an invariant with no check.

---

**What we covered:** why module registration order is a correctness concern (the decorator pipeline
wraps existing registrations), how `IModule` lets a module declare its name and dependencies instead of
its position, how `ModuleLoader` discovers modules in the assemblies the host names and Kahn-sorts them
(rejecting cycles by name), how disabled modules register stubs so cross-module interfaces stay
resolvable, what `ScanModuleApplicationServices<T>()` wires by convention, and why the module is also
the unit of service extraction.

**Next in the series:** event-schema versioning, so an independently deployed consumer never breaks
on an event that was silently reshaped.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-008 for the extraction topology,
or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-008 (service-extraction topology) and ADR-006 (database-per-service) in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Modular Monolith, Microservices*

*Notes: re-verified against source this run (2026-10-02 apply pass, MMCA.Common v1.221.0). Four claims
changed meaning. (1) Scan guard: `DiscoverAndRegister` scans `moduleAssemblies` at
`MMCA.Common.Application/Modules/ModuleLoader.cs:74-95` with TWO catches, a typed
`catch (ReflectionTypeLoadException ex)` at `:81-88` that keeps the loaded types
(`ex.Types.OfType<Type>()` at `:87`) and logs at Error through `LogAssemblyPartiallyLoaded`
(`:352-353`), and a broad `catch (Exception ex)` at `:89-93` that returns no types and logs at Error
through `LogAssemblyScanFailed` (`:349-350`); the rationale comment is `:69-73`. The body previously said
a broken assembly contributes no types, which holds only for the broad catch. (2) Fleet topology: every
ADC service host names ONLY its own module assembly (`MMCA.ADC.Conference.Service/Program.cs:366`,
`MMCA.ADC.Engagement.Service/Program.cs:211`, `MMCA.ADC.Identity.Service/Program.cs:255`,
`MMCA.ADC.Notification.Service/Program.cs:189`; `MMCA.ADC/AGENTS.md:43`), so peers are never discovered
and no disabled stub is registered there, even though Conference's appsettings disables Engagement
(`MMCA.ADC.Conference.Service/appsettings.json:21,24`). `AddEngagementBookmarkCountClient` is a
pipeline step at `Program.cs:412` and calls
`services.Replace(ServiceDescriptor.Scoped<IBookmarkCountService, BookmarkCountServiceGrpcAdapter>())` at
`MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:49`; the host comments at `Program.cs:34-39` and
`:385-389` state that no Engagement stub exists in this host. The body previously said the host
replaces a stub with a gRPC client; it now says the host adds the adapter and frames the stub path as the
name-and-disable shape. (3) Disabled-module example: the handler is
`GetSessionBookmarkCountsHandler` (plural, `Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsHandler.cs:17`,
`IBookmarkCountService` parameter `:19`); the stub is real (`EngagementModule.cs:30-33`, registering
`DisabledBookmarkCountService` at `:32`) and the example is now framed for a host that names the
Engagement assembly and disables it. The Conference host comments still spell the handler singular
(`Program.cs:34`, `:385`); the article follows the class. (4) "A forgotten stub is caught at startup"
was UNVERIFIABLE and is removed: no `ValidateOnBuild` appears in Common or ADC source and the loader does
not check stub coverage. Added instead: `ValidateRemoteDependencies(IServiceProvider)` at
`ModuleLoader.cs:212` (doc `:198-211`, stub capture `:118-120`, throw `:244-249`, still-stub warning
`:251-255`/`:355-356`), stated as opt-in because no ADC host calls it. Also added: a module absent from
the `Modules` section is disabled (`Settings/ModulesSettings.cs:13-19`).
Other anchors re-verified this run: `ModuleLoader` `sealed partial class` `:16`, `DisabledModuleNames`
`:28`, `Logger` (default `NullLogger`) `:34`, `moduleAssemblies` XML doc `:49-54` (the `AppDomain`
rationale), `DiscoverAndRegister` six-parameter signature `:59-65`, `IModule`/`IModuleSeeder`
instantiation `:97-105`, `TopologicalSort(allModules)` call `:108`, disabled branch `:112-123`
(`RegisterDisabledStubs` `:119`, name recorded `:122`), `ValidateModuleDependencies` `:136-169`
(remote-satisfied comment `:138-141`, throw `:150-158`), `modules.{name}.json` `:185` and the
environment variant `:188`, `SeedAllAsync` `:266`, Kahn `TopologicalSort` `:282-332` (zero-in-degree seed
`:306-307`, decrement and enqueue `:316-320`, cycle throw `:324-329`), `[LoggerMessage]` declarations
`:334-356`. `IModule` members at `IModule.cs:12,17,23,28,34`; `IModuleSeeder.ModuleName`/`SeedAsync` at
`IModuleSeeder.cs:13,18`. `ModulesSettings : Dictionary<string, ModuleSettings>` and `SectionName =
"Modules"` at `ModulesSettings.cs:7,10`; `ModuleSettings.Enabled` (default `true`) and
`RemoteDependencies` at `ModuleSettings.cs:9,38`. `AddModuleHost` at
`MMCA.Common.API/Startup/ModuleHostExtensions.cs:51` binds and validates both settings (`:62-64`,
`:70-72`), registers the loader (`:82`) and returns the `ModuleHostContext` (`:84`); it is shipped API
(`MMCA.Common.API/PublicAPI.Shipped.txt:398,564`, no longer in Unshipped).
`ModuleHostContext.RegisterModules` at `ModuleHostContext.cs:66`. The convention scan lives in
`MMCA.Common.Application/DependencyInjection.ModuleScanning.cs`: generic `:28`, `Assembly` overload `:46`,
`ThrowIfPipelineSealed` `:49`, domain event handlers `:54`, integration event handlers `:61`,
`IEntityDTOMapper<,,>` `:67`, `IEntityDTOProjector<,,>` `:76`, `IEntityRequestMapper<,,>` `:82`,
`IEntityUpdateApplier<,,>` `:92`, `IEntityUpdateCommandApplier<,,,>` `:101`, `ICommandHandler<,>` `:107`,
`IQueryHandler<,>` `:113`, `AddValidatorsFromAssembly` `:117`, `ICommandWithRequest<>` block `:119-134`
(`TryAddTransient` `:134`); `AddValidatorsFromAssemblyContaining` appears only in `AddApplication` at
`DependencyInjection.cs:48`. `AddMmcaApplicationPipeline` at `DependencyInjection.cs:207-216`
(`AddApplication()` `:211`, callback `:213`, `AddApplicationDecorators()` `:215`), remarks `:185-206` with
the non-handler note at `:195-196`, `VerifyDecoratorPipeline()` `:244`, `ThrowIfPipelineSealed` `:310`
(also called from `DependencyInjection.Crud.cs:80` for `AddEntityCrud` and `:193` for
`AddEntityUpdate`). Conference host: `AddInfrastructure` `Program.cs:340`, "deliberately does NOT run
discovery" `:356-359`, "no AppDomain scan" `:361-363`, `AddModuleHost` `:364-367`, `AddAPI` `:369`,
pipeline comment `:374-409`, `AddMmcaApplicationPipeline` `:410-413` with `RegisterModules` at `:411`;
the snippets mirror `:364-367` and `:410-411` with ADC-specific steps elided. `EngagementModule`
`Dependencies => ["Conference"]` `:20`, `RequiresDependencies => true` `:23`. Topology: ADC four
single-module hosts behind YARP, no single WebAPI host (`MMCA.ADC/AGENTS.md:7`); Helpdesk monolith-first,
one `Tickets` module, "build the monolith now, extract a service later" (`MMCA.Helpdesk/AGENTS.md:7`).
Both repos' `CLAUDE.md` are `@AGENTS.md` imports, so the grounding cites `AGENTS.md`. The header no
longer cites the "DI Registration Sequence" section of `MMCA.Common/AGENTS.md`: its text says
`AddMmcaApplicationPipeline` runs `AddInfrastructure` and `AddAPI`, which `DependencyInjection.cs:211-215`
does not; the body follows the code (source-doc drift, not fixed here). ADR-059 Decision
(`Website/docs-src/adr/059-module-contract-and-composition.md:22-25`) and the `ConferenceModule` shape are
carried as CONFIRMED by this cycle's audit, not re-read in the apply pass.*
