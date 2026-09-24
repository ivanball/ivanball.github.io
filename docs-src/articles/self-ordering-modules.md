# Self-ordering modules: discovered, Kahn-ordered, and extractable

> Series: MMCA.Common · Article #14 (deep-dive) · Pillar P2 · Group G14 · Rubric §7 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` ("Module System" + "DI Registration Sequence"),
> `MMCA.Common.Application/Modules/*` + `.../DependencyInjection.cs` and
> `MMCA.Common.API/Startup/ModuleHostExtensions.cs` source, the reference hosts
> `MMCA.ADC.Conference.Service/Program.cs`, `MMCA.ADC/CLAUDE.md`, `MMCA.Helpdesk/CLAUDE.md`, and
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

The scan is also defensive. Each `GetTypes()` call sits inside a try/catch (a
`ReflectionTypeLoadException` raised by a missing transitive reference is the case it exists for), so a
broken assembly contributes no types and logs why instead of aborting discovery of the rest. And every
step emits a structured `[LoggerMessage]`-generated log line, so the startup log tells you precisely
which modules loaded, in what order, and how long each took. When something is wrong, you read it, you
do not guess it.

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
(default `true`) plus a `RemoteDependencies` list.

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
modules depend on. So when Conference's `GetSessionBookmarkCountHandler` asks the container for
Engagement's `IBookmarkCountService`, resolution still succeeds, because the disabled module left a
`Disabled*` stub behind.

That is a clean strategy plus null-object pairing (real service, disabled stub, or remote client) rather
than `if (moduleEnabled)` checks scattered through the call sites. The handler does not know or care
which of the three it got.

Dependency validation is microservice-aware to match. A dependency that is disabled in-process but
listed in this host's `ModuleSettings.RemoteDependencies` is treated as satisfied remotely (the host
will wire a typed gRPC client to the extracted peer), and only a module with `RequiresDependencies =
true` and a genuinely unsatisfied dependency throws at startup. The loader also loads per-module
configuration by convention: before calling `module.Register(...)` it adds `modules.{name}.json` (and
the environment-specific variant) to the configuration builder, so a module can ship its own config
file.

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
runs the same `ModuleLoader` with only its own module enabled (`Modules:{Module}:Enabled=true`); the
disabled peers contribute their stubs, and the host then replaces a stub with a typed gRPC client pointed
at the real, extracted peer process. MMCA.ADC runs this way today: four single-module service hosts
(Identity, Conference, Engagement, Notification) behind a YARP gateway, with no combined monolith host at
all. The Domain, Application, and Shared code is identical in both topologies. The transport choice lives
entirely at the composition edge (ADR-008).

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
  interface and forget to register a stub for it, and a host that disables that module fails to resolve.
  This is caught at startup rather than in production, but it is a discipline the contract assumes.
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

*Notes: re-verified against source this run (2026-09-19 audit pass, MMCA.Common v1.205.0 at commit
90ffa7a). Three claims changed meaning, all in the discovery mechanism. (1) The article described
`DiscoverAndRegister` as scanning every loaded assembly via `AppDomain.CurrentDomain.GetAssemblies()`.
There is no `AppDomain` path in `ModuleLoader.cs` at all: the signature is six parameters,
`DiscoverAndRegister(services, configurationBuilder, applicationSettings, modulesSettings, string?
environmentName, IEnumerable<Assembly> moduleAssemblies)` at `ModuleLoader.cs:58-64`, with
`environmentName` carrying no default and `moduleAssemblies` required. The XML doc at
`ModuleLoader.cs:48-53` gives the reason the article states: an `AppDomain` scan only sees assemblies
already loaded, so a referenced-but-untouched module assembly would be silently absent. The guarded
`moduleAssemblies.SelectMany(a => a.GetTypes())` scan is `ModuleLoader.cs:71-84`, and its guard is a
broad `catch (Exception ex)` at `:78` that logs through `LogAssemblyScanFailed` and returns no types
(the XML comment at `:69-70` names `ReflectionTypeLoadException` as the case it exists for, so the
article says "the case it exists for" rather than claiming a typed catch); `IModule` and `IModuleSeeder`
instantiation is `:86-94`, and `TopologicalSort(allModules)` is called at `:97`.
(2) The host snippet no longer matched any host and would not compile against the six-parameter
signature. The real shape is `builder.AddModuleHost([typeof(ConferenceModule).Assembly],
loggerFactory.CreateLogger<ModuleLoader>())` (`MMCA.Common.API/Startup/ModuleHostExtensions.cs:51-53`,
public API at `MMCA.Common.API/PublicAPI.Unshipped.txt:75`), which binds and validates
`ApplicationSettings` and `ModulesSettings` (`:61-75`), builds the loader with or without the passed
logger and calls `services.AddSingleton(moduleLoader)` (`:77-82`), and returns a `ModuleHostContext`
(`:84-90`). (3) Discovery therefore runs as a pipeline step, not as a host line:
`ModuleHostContext.RegisterModules(IServiceCollection)` (`ModuleHostContext.cs:66-78`) is the delegate
that calls `DiscoverAndRegister` with the six captured arguments, and the ADC Conference host registers
it at `MMCA.ADC.Conference.Service/Program.cs:391` inside
`services.AddMmcaApplicationPipeline(...)` (`:390-395`). The host's own comments state both points:
`AddModuleHost` "deliberately does NOT run discovery" (`Program.cs:341-344`) and "there is no AppDomain
scan to fall back on" (`Program.cs:346-348`), with the `AddModuleHost` call itself at `:349-352`.
`IModule` members (`Name`, `Dependencies` default `[]`, `RequiresDependencies` default `false`,
`Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)`, `RegisterDisabledStubs`
default empty body) at `MMCA.Common.Application/Modules/IModule.cs:12,17,23,28,34`. `ModuleLoader` is a
`sealed partial class` (`ModuleLoader.cs:15`) with `Logger { get; init; } =
NullLogger<ModuleLoader>.Instance` (`:33`) and `DisabledModuleNames` (`:27`);
`SeedAllAsync(IServiceProvider, CancellationToken)` at `ModuleLoader.cs:255` (the former `:270` anchor is
now an XML `<exception>` tag on `TopologicalSort`); `IModuleSeeder.ModuleName`/`SeedAsync(...)` at
`IModuleSeeder.cs:13,18`. `ModulesSettings : Dictionary<string, ModuleSettings>`, `SectionName =
"Modules"` at `Settings/ModulesSettings.cs:7,10`; `ModuleSettings.Enabled` (init, default `true`) +
`RemoteDependencies` (`List<string>`, default `[]`) at `Settings/ModuleSettings.cs:9,38`.
`ScanModuleApplicationServices<TAssemblyMarker>()` is at
`MMCA.Common.Application/DependencyInjection.cs:169-171` and forwards to the `Assembly` overload at
`:187-279`, which runs nine Scrutor scans plus FluentValidation's assembly scan: domain event handlers
(singleton, `:193-197`), integration event handlers (singleton, `:200-204`), `IEntityDTOMapper<,,>`
(scoped, `:206-210`), `IEntityDTOProjector<,,>` (scoped, `:215-219`, optional and opt-in per entity),
`IEntityRequestMapper<,,>` (scoped, `:221-225`), `IEntityUpdateApplier<,,>` (scoped, `:231-235`),
`IEntityUpdateCommandApplier<,,,>` (scoped, `:240-244`), `ICommandHandler<,>` (scoped, `:246-250`),
`IQueryHandler<,>` (scoped, `:252-256`), then `services.AddValidatorsFromAssembly(moduleAssembly)` at
`:258` (the module scan does not use `AddValidatorsFromAssemblyContaining`, which appears only in the
framework-level `AddApplication` block at `:51`) plus `CommandRequestValidator` auto-registration for
`ICommandWithRequest<>` (block `:262-276`, `TryAddTransient` at `:275`). The two update-applier scans and
the appliers bullet in the body are added this run; the method also opens with
`ThrowIfPipelineSealed(services, nameof(ScanModuleApplicationServices))` at `:190`.
`AddMmcaApplicationPipeline(Action<MmcaApplicationPipelineBuilder>?)` at `DependencyInjection.cs:620-629`
runs `services.AddApplication()` (`:624`), invokes the callback (`:626`) and returns
`services.AddApplicationDecorators()` (`:628`); its remarks at `:598-610` state that non-handler
registrations (infrastructure, API, telemetry, options) may stay outside the call.
`ThrowIfPipelineSealed` (`:723-733`) is what throws on a late registration, naming the caller, and
`VerifyDecoratorPipeline()` (`:657`) is the fitness-test hook. The canonical sequence and the sealing
requirement are the "DI Registration Sequence" section of `MMCA.Common/CLAUDE.md` (heading `:70`,
sequence text `:72`). In the real host, `services.AddInfrastructure(builder.Configuration);` is at
`MMCA.ADC.Conference.Service/Program.cs:325` and `services.AddAPI(moduleHost.ModulesSettings);` at
`:354`; `AddApplication()` and `AddApplicationDecorators()` are not host lines at all, they are the two
ends of the `AddMmcaApplicationPipeline` call at `:390-395`, which the host comment at `:359-364`
describes. The five host anchors carried by the previous ledger (`:302`, `:303`, `:323`, `:333`, `:369`)
are all replaced; the "decorators genuinely last" claim survives, the evidence for it did not.
Topology examples: ADC runs fleet-only, four single-module service hosts
(Identity/Conference/Engagement/Notification) behind a YARP gateway, its former combined
`MMCA.ADC.WebAPI` host deleted (`MMCA.ADC/CLAUDE.md:7`); MMCA.Helpdesk is the monolith-first reference
app, one `Tickets` module built to demonstrate "build the monolith now, extract a service later"
(`MMCA.Helpdesk/CLAUDE.md:7-16`). ADR-059 records the `IModule` composition contract itself (five
members, three defaulted; reflection discovery; Kahn ordering; stub-not-absence for a disabled module)
as its own decision, since ADR-008 and ADR-006 treat `ModuleLoader` as pre-existing context rather than
deciding it (`Website/docs-src/adr/059-module-contract-and-composition.md:22-25`). Code blocks in this
article are illustrative of the documented shape: the host snippet mirrors `Program.cs:349-352` and
`:390-391` with the ADC-specific pipeline steps elided.*
