# Self-ordering modules: discovered, Kahn-ordered, and extractable

> Series: MMCA.Common · Article #14 (deep-dive) · Pillar P2 · Group G14 · Rubric §7 ·
> Status: grounded in `MMCA.Common/AGENTS.md` ("Module System"),
> `MMCA.Common.Application/Modules/*`, `.../Settings/ModulesSettings.cs`, `.../DependencyInjection.cs` and
> `.../DependencyInjection.ModuleScanning.cs`, `MMCA.Common.API/Startup/ModuleHostExtensions.cs` and
> `ModuleHostContext.cs` source, `MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs` and
> `MmcaServiceHostOptions.cs`, the reference hosts `MMCA.ADC.{Conference,Engagement,Identity,Notification}.Service/Program.cs`,
> `MMCA.Store.{Catalog,Identity,Sales}.Service/Program.cs`, `MMCA.Helpdesk.Web/Program.cs`,
> `MMCA.ADC.Engagement.API/EngagementModule.cs`, `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs`,
> `MMCA.ADC/AGENTS.md`, `MMCA.Helpdesk/AGENTS.md`, and
> ADR-059 (the `IModule` contract and reflection-based module composition). No em dashes.

**Subtitle:** A module declares its name and its dependencies. The framework discovers every module,
sorts them with Kahn's algorithm, and registers them in an order where a dependency always registers
before the modules that need it. The same code boots as a monolith or as a fleet of services.

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
registers. The decorator precondition is a separate, coarser guarantee: every module's handlers, in
whatever order, must be registered before the decorators run at all, and that comes from where
discovery sits in the application pipeline (below), not from the sort.

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
// In each ADC and Store service host's Program.cs (host-specific options elided). The host names its
// module assemblies and its pipeline steps; MMCA.Common.ServiceHost's AddMmcaServiceHost does the rest.
var host = builder.AddMmcaServiceHost(new()
{
    ModuleAssemblies = [typeof(ConferenceModule).Assembly],   // the module assemblies, named explicitly

    // Discovery is a step of the application pipeline, so every module handler lands in the
    // container before the decorators close over it.
    ConfigurePipeline = (pipeline, moduleHost) => pipeline
        .Register(moduleHost.RegisterModules),
});

// Inside AddMmcaServiceHost: AddModuleHost binds and validates ApplicationSettings and ModulesSettings,
// builds the ModuleLoader (logging through a bootstrap logger factory) and registers it as a
// singleton, deliberately without running discovery. Later, AddMmcaApplicationPipeline hands the
// pipeline builder and that ModuleHostContext to ConfigurePipeline.
```

A subtlety worth stating because it is easy to assume otherwise: discovery is **not** something
`AddApplication()` does for you, and an ADC or Store service host calls neither `AddModuleHost` nor
`DiscoverAndRegister` by hand. Both values the host supplies are required options, and
`AddMmcaServiceHost` rejects an empty `ModuleAssemblies` list before it does anything else. It then
calls `AddModuleHost`, which captures the configuration, the bound settings, the environment name and
the module assemblies, and hands back a `ModuleHostContext` whose `RegisterModules` method is the
delegate that calls `DiscoverAndRegister` with those five values plus the `IServiceCollection` the
pipeline passes in. The host's `ConfigurePipeline` callback registers that delegate as a pipeline step,
which is what puts the modules in the right place in the sequence. Helpdesk's monolith host runs
issuer-less, and `AddMmcaServiceHost` accepts only a forwarded JWT bearer or the token issuer's own authentication, so it
composes the same step by hand: it builds its own
`ModuleLoader`, registers it as a singleton, and calls `DiscoverAndRegister` inside a pipeline
`Register` step, so discovery still runs before the decorators. The loader stays a singleton, which is how it also
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
// The order AddMmcaServiceHost runs for a service host (Helpdesk's monolith host writes it by hand).
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
2. **Topologically sort** before you register. Kahn's algorithm is short (`ModuleLoader`'s sort is about fifty lines,
   comments and braces included); the payoff is that a cycle becomes a named exception instead of a subtle bug.
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

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`). Changed this
run: (1) the ADC/Store host snippet and the paragraph after it. No ADC or Store service host calls
`AddModuleHost`, `CreateBootstrapLoggerFactory` or `AddMmcaApplicationPipeline` directly; each calls
`builder.AddMmcaServiceHost(new() { ModuleAssemblies = [...], ConfigurePipeline = (pipeline, moduleHost)
=> pipeline.Register(moduleHost.RegisterModules)... })` (ADC Conference
`MMCA.ADC.Conference.Service/Program.cs:82`, `ModuleAssemblies` `:89`, `ConfigurePipeline` `:357-360`;
Engagement `Program.cs:58,65,218-219`; Identity `Program.cs:79,86,302-303`; Notification
`Program.cs:58,65,117-118`; Store `MMCA.Store.Catalog.Service/Program.cs:32,38,111`,
`Identity.Service/Program.cs:37,43,126`, `Sales.Service/Program.cs:51,58,130`). Inside the package:
`AddMmcaServiceHost` `MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:65`, empty-list throw
`:69-74`, bootstrap logger factory `:101`, `AddModuleHost(options.ModuleAssemblies, ...)` `:102-104`,
`AddInfrastructure` `:146`, `AddAPI` `:147`, `AddMmcaApplicationPipeline(pipeline =>
options.ConfigurePipeline(pipeline, moduleHost))` `:158`; both options are `required`
(`MmcaServiceHostOptions.cs:28,35`). The Helpdesk reason clause rests on the authentication branch
(`ServiceHostBuilderExtensions.cs:132-143`: `TokenIssuer` or `AddForwardedJwtBearer`) and
`MMCA.Helpdesk/AGENTS.md` ("cannot call it ... runs issuer-less"). (2) The second snippet gains a comment
naming it as the order `AddMmcaServiceHost` runs (`:146-147,158`) and Helpdesk writes by hand. (3) The
header grounding adds `MMCA.Common.ServiceHost`, the Store hosts and the Helpdesk host. ADR-059 records
the same composition (`Website/docs-src/adr/059-module-contract-and-composition.md:9` amendment, Decision
bullet `:76`); the header ADR list is unchanged. Rejected from the findings: the "148 seed files" numeric
row names no claim in this article (neither the number nor seed files appears here). Confirmed this run,
text unchanged: `ModuleLoader` (`MMCA.Common.Application/Modules/ModuleLoader.cs`) `sealed partial class`
`:16`, `Logger` default `NullLogger` `:34`, `DiscoverAndRegister` `:59`, two catches in the scan
(`ReflectionTypeLoadException` `:81` keeping `ex.Types.OfType<Type>()` `:87`; broad `catch (Exception)`
`:90`), both logged at Error (`:351`, `:354`), `TopologicalSort(allModules)` call `:110`,
`RegisterDisabledStubs` `:121`, unsatisfied-dependency throw `:154`, `modules.{name}.json` `:187` and the
environment variant `:190`, `ValidateRemoteDependencies` `:214` (throw `:247`, still-stub warning `:357`),
`SeedAllAsync` `:268` (called from `MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:137`),
Kahn `TopologicalSort` `:284-334` (51 lines, so "about fifty lines" holds; zero-in-degree seed `:307`,
decrement and enqueue `:317-321`, cycle throw `:329`). `AddModuleHost`
`MMCA.Common.API/Startup/ModuleHostExtensions.cs:51` binds and validates both settings (`:62-64`,
`:70-72`), registers the loader (`:82`) and returns the context (`:84`); `ModuleHostContext.RegisterModules`
`ModuleHostContext.cs:66` passes five captured values plus the collection to `DiscoverAndRegister`
(`:70-76`). Helpdesk builds its own loader (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:124-128`)
and calls `DiscoverAndRegister` inside a pipeline step (`:138-150`). `AddMmcaApplicationPipeline`
`MMCA.Common.Application/DependencyInjection.cs:226-235` (`AddApplication()` `:230`, callback `:232`,
`AddApplicationDecorators()` `:234`), non-handler remark `:214-215`, `VerifyDecoratorPipeline()` `:263`,
`ThrowIfPipelineSealed` `:329`; `ScanModule<TAssemblyMarker>()` `MmcaApplicationPipelineBuilder.cs:27`.
Convention scan `DependencyInjection.ModuleScanning.cs`: generic `:28`, `Assembly` overload `:46`, sealed
check `:49`, domain and integration event handlers `:54`, `:61`, mapper `:67`, projector `:76`, request
mapper `:82`, update appliers `:92`, `:101`, command and query handlers `:107`, `:113`, validators `:117`,
`ICommandWithRequest<>` bridge `:125-134`. ADC modules: `ConferenceModule` `Name` `ConferenceModule.cs:19`,
`RegisterDisabledStubs` `:22`, `AddConferenceModule(applicationSettings)` `:31`, no `Dependencies`
override; `EngagementModule` `Dependencies => ["Conference"]` `EngagementModule.cs:21`,
`RequiresDependencies => true` `:24`, `RegisterDisabledStubs` `:31` registering
`DisabledBookmarkCountService` `:33`. Conference host comments: no Engagement stub in this host
(`Program.cs:33-38`, `:332-336`), `AddEngagementBookmarkCountClient` as a pipeline step `:359`. Left
as-is (carried from earlier passes): the forgotten-stub failure timing, since framework-default
`ValidateOnBuild` behavior is not determinable from repo source; `ModulesSettings`/`ModuleSettings`
anchors and the `GetSessionBookmarkCountsHandler` example, not re-read this run. Earlier passes:
2026-10-29, 2026-10-22 and 2026-10-02 (four claims changed meaning then: scan guard, fleet topology,
disabled-module example, forgotten-stub claim removed).*
