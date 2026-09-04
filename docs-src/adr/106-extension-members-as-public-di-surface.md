# ADR-106: C# Extension Members as the Public DI Registration Surface

## Status
Accepted (2026-09-01).

## Context
Every host in this workspace boots the same way: a `Program.cs` calls a short list of `Add*` methods
on `IServiceCollection`, one per layer, and all of the framework's wiring sits behind those names.
MMCA.Helpdesk's web host is the minimal case, calling `services.AddApplication()`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:66`),
`services.AddInfrastructure(builder.Configuration)` (`:67`), `services.AddAPI(modulesSettings)`
(`:89`) and `services.AddApplicationDecorators()` (`:120`).

What is unusual is how those methods are declared. None of them is a classic static extension method
with a `this` parameter. Each is a member of a C# `extension(T)` block: `AddApplication` is written
as `public IServiceCollection AddApplication()` inside `extension(IServiceCollection services)`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:29`, method at `:35`), and
`AddInfrastructure`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:55`, method at `:63`),
`AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:27`, method at
`:44`) and `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:28`,
method at `:34`) take the identical shape. The framework says so on the types themselves:
Infrastructure's DI class documents itself as using "C# preview extension types to add methods
directly to `IServiceCollection`" (`Infrastructure/DependencyInjection.cs:50-51`) and UI's repeats it
for `AddUIShared` (`UI/DependencyInjection.cs:24`).

Compiling that requires a preview language version, and every repo in the workspace sets one:
`LangVersion preview` in `MMCA.Common/Directory.Build.props:6`, `MMCA.Store/Directory.Build.props:15`,
`MMCA.ADC/Directory.Build.props:9` and `MMCA.Helpdesk/Directory.Build.props:10`, each beside the same
`net10.0` target (`:3`, `:6`, `:6`, `:7`) and the same `TreatWarningsAsErrors` (`:7`, `:16`, `:10`,
`:11`). It is a solution-wide property in a `Directory.Build.props`, not a per-project opt-in that a
leaf csproj could decline.

This is therefore not a stylistic preference confined to one file. It is the shape of the entire
public registration surface of packages published to nuget.org and GitHub Packages under ADR-053,
frozen member by member by the ADR-015 public-API gate, and repeated by every consumer that writes
its own module registration. A language feature compiled under `preview` sits underneath all of it,
and nothing in the code records that as a decision with a stated cost and a stated way out. This
record does.

## Decision
**The framework's public dependency-injection surface is written as C# extension members:
`extension(T)` blocks inside `public static class` types, compiled under `LangVersion preview` in all
four repos and shipped to both registries in that form. The compiler-emitted classic static extension
method is what keeps the choice reversible, and the public-API baselines record both shapes.**

1. **Preview is a workspace-wide language version, not a local opt-in.** All four repos set
   `LangVersion` to `preview` in their root `Directory.Build.props`
   (`MMCA.Common/Directory.Build.props:6`, `MMCA.Store/Directory.Build.props:15`,
   `MMCA.ADC/Directory.Build.props:9`, `MMCA.Helpdesk/Directory.Build.props:10`), so every project in
   every solution compiles at it. None of the four `global.json` files pins an SDK: each contains
   only the Microsoft Testing Platform runner (`MMCA.Common/global.json:1-5`, and the Store, ADC and
   Helpdesk files are identical), so the compiler that interprets `preview` is whichever 10.0.x SDK
   is installed.

2. **Twenty-three `extension(IServiceCollection services)` blocks are the DI surface.** Measured on
   2026-09-04 across `MMCA.Common/Source`, there are 23 such blocks in 23 files, spread over ten
   packages: Application (`Application/DependencyInjection.cs:29`,
   `Application/Notifications/DependencyInjection.cs:29`), Infrastructure
   (`Infrastructure/DependencyInjection.cs:55`), API (`API/DependencyInjection.cs:27`,
   `API/Authentication/ExternalAuthExtensions.cs:30`,
   `API/Authorization/AuthorizationExtensions.cs:14`,
   `API/Caching/OutputCacheEvictionExtensions.cs:95`, `API/Startup/MiniProfilerExtensions.cs:11`,
   `API/Startup/WebApplicationBuilderExtensions.cs:238`), UI (`UI/DependencyInjection.cs:28`,
   `UI/Notifications/DependencyInjection.cs:14`,
   `UI/Services/Capabilities/DependencyInjection.cs:25`), UI.Web
   (`UI.Web/DependencyInjection.cs:16`), UI.Maui (`UI.Maui/DependencyInjection.cs:34`), Grpc
   (`Grpc/DependencyInjection.cs:17`), Aspire (`Aspire/Extensions.cs:381`,
   `Aspire/GatewayCorsExtensions.cs:18`, `Aspire/Security/SecurityHeaders.cs:212`,
   `Aspire/Gateway/GatewayRateLimitingExtensions.cs:179`,
   `Aspire/Gateway/GatewayHealthCheckExtensions.cs:96`), Gateway
   (`Gateway/RateLimiting/GatewayRoutePolicyExtensions.cs:29`) and Testing
   (`Testing/Support/FeatureManagementTestExtensions.cs:12`,
   `Testing/Support/RateLimiterTestExtensions.cs:13`).
   A plain text search finds 26 occurrences of that exact receiver, because three of them are
   analyzer-suppression justification strings rather than declarations
   (`Infrastructure/DependencyInjection.cs:870`, `:893`, `:932`).

3. **The idiom reaches well past DI.** The same measurement finds 83 `extension` blocks across 66
   files under `MMCA.Common/Source`. Receivers include `WebApplicationBuilder`
   (`API/Startup/ModuleHostExtensions.cs:24`, `Aspire/Logging/SerilogHostExtensions.cs:29`),
   `WebApplication` (`API/Startup/WebApplicationExtensions.cs:37`), `IEndpointRouteBuilder`
   (`API/Startup/Endpoints/JwksEndpointExtensions.cs:22`,
   `API/SessionCookies/SessionCookieEndpoints.cs:20`),
   `IApplicationBuilder` (`Gateway/ForwardedHeadersExtensions.cs:25`),
   `IDistributedApplicationBuilder` and `IResourceBuilder<ProjectResource>`
   (`Aspire.Hosting/Extensions.cs:126`, `:340`, `:410`), `IPage` and `ILocator`
   (`Testing.E2E/Infrastructure/PageExtensions.cs:62`, `:335`), `Type`, `Assembly` and
   `PropertyInfo` (`Testing.Architecture/RuleHelpers.cs:16`, `:40`, `:114`), and generic receivers
   such as `IReadRepository<TEntity, TIdentifierType>`
   (`Application/Extensions/ReadRepositoryExtensions.cs:12`).

4. **Module composition is registered through one of these blocks.** `AddModuleHost` binds the two
   settings sections, builds the `ModuleLoader` and registers it as a singleton, and it is an
   extension member on `WebApplicationBuilder` (`API/Startup/ModuleHostExtensions.cs:24`, method at
   `:51`). The `IModule` contract of ADR-059 therefore reaches a host through the same surface this
   record describes.

5. **Consumers write them too.** The idiom is not confined to the framework: MMCA.ADC declares 20
   blocks across 20 files under `Source` (14 module DI classes, the four service-contract packages,
   `AppHost/BrokerSelection.cs` and
   `Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs`),
   MMCA.Store 16 across 16, and MMCA.Helpdesk 3 across 3
   (`Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs` and
   its `.API` and `.Infrastructure` siblings). The reference seed teaches the shape by using it.

6. **The call site is indistinguishable from a classic extension method.** A host writes
   `services.AddApplication();` (`Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:66`), and the
   same holds for every other entry point. Nothing about the declaration style is visible to the
   caller.

7. **The public-API gate records every extension member twice.** RS0016 and RS0017 stay at error
   severity and every packable Source project declares its surface in `PublicAPI.Shipped.txt`
   (`MMCA.Common/Directory.Build.props:77-92`, gate item group at `:86`, rules described at
   `:78-79`). For an extension member the baseline holds a container line plus a member line, and a
   separate classic static line carrying a `this` parameter. `AddApplication` appears as
   `MMCA.Common.Application.DependencyInjection.extension(...IServiceCollection!).AddApplication()`
   (`Application/PublicAPI.Shipped.txt:64`, container at `:63`) and as
   `static MMCA.Common.Application.DependencyInjection.AddApplication(this ...IServiceCollection! services)`
   (`:701`). Across the repo there are 187 `.extension` lines in 13 `PublicAPI.Shipped.txt` files and
   58 in 11 `PublicAPI.Unshipped.txt` files, covering 14 packages. Gateway's whole surface is still
   unshipped: its `PublicAPI.Shipped.txt` contains only `#nullable enable`, and both shapes of
   `UseCommonForwardedHeaders` sit in `Gateway/PublicAPI.Unshipped.txt:12` and `:98`.

8. **One extension property exists in the whole surface, and it emits a different classic shape.**
   `IsIdValueGenerated` is declared as an extension property on `Type`
   (`Domain/Extensions/EntityTypeExtensions.cs:11`) and is recorded as
   `...EntityTypeExtensions.extension(System.Type!).IsIdValueGenerated.get -> bool`
   (`Domain/PublicAPI.Shipped.txt:68`) with the classic counterpart
   `static ...EntityTypeExtensions.get_IsIdValueGenerated(System.Type! entityType) -> bool` (`:224`).
   A method emits `Name(this T x)`; a property emits `get_Name(T x)`. Those are different members.

9. **The MAUI package uses the idiom but sits outside the gate.** `MMCA.Common.UI.Maui` declares two
   blocks (`UI.Maui/DependencyInjection.cs:34` on `IServiceCollection`,
   `UI.Maui/HostingDependencyInjection.cs:17` on `MauiAppBuilder`) and is the one project excluded
   from the public-API analyzer, because it lives outside `MMCA.Common.slnx` and builds only on the
   windows MAUI job (`MMCA.Common/Directory.Build.props:86`, reason at `:82-85`, naming ADR-042). Its
   extension surface is therefore unbaselined.

10. **Analyzer fallout is carried as documented suppressions, not by changing the code shape.**
    CA1708 ("identifiers should differ by more than case") fires on the compiler-generated grouping
    members of an `extension(T)` block and is suppressed at the type with an explicit
    false-positive justification in 17 files, 16 of them under `MMCA.Common/Source` (for example
    `Gateway/ForwardedHeadersExtensions.cs:19-22`, `UI/Extensions/MoneyExtensions.cs:10-13`) and one
    in an ADC E2E page object. IDE0051 ("unused private member") misses calls that cross from inside
    a block to a private member of the containing class on SDK 10.0.201 and later, and is suppressed
    three times in one file with that reason spelled out
    (`Infrastructure/DependencyInjection.cs:867`, `:890`, `:929`).

11. **A fitness function has to know the emitted shape.** The `DomainThrowsOnlyArgumentGuards` rule
    (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:67`) walks IL and would
    otherwise flag the skeleton members an `extension(T)` block leaves in a Domain assembly, whose
    `NotSupportedException` nobody typed. It skips any method carrying
    `System.Runtime.CompilerServices.ExtensionMarkerAttribute` (constant at `:8`, filter at `:88`,
    predicate at `:174-178`, documented at `:157-173`).

12. **The exit path is a mechanical rewrite that does not reach callers.** If the feature changed
    shape, each block would be flattened back to classic static extension methods: a
    `public R M(...)` inside `extension(T x)` becomes `public static R M(this T x, ...)`, with the
    method names, parameters and return types unchanged. That is exactly the form the baselines
    already record on their `static ...(this ...)` lines
    (`Application/PublicAPI.Shipped.txt:701-705`, `:706`, `:707`, `:717`), so the public API a
    consumer binds to would not move and no `Program.cs` line would change. The single exception is
    the extension property in Decision point 8, whose classic form is `get_IsIdValueGenerated(Type)`
    rather than a `this`-marked method.

## Rationale
- **One `Add*` name per layer is the point of the surface.** A host reads as a list of layers
  (`Program.cs:66`, `:67`, `:89`, `:120`), and grouping the registrations by receiver in a single
  block is what keeps the declaration site organized by what it extends rather than by a repeated
  `this IServiceCollection services` parameter on every method.
- **The compiler already emits the classic shape, so the exposure is smaller than the word "preview"
  suggests.** Both forms are in the baseline for every extension member, which is direct evidence
  that the shipped metadata still contains an ordinary static extension method. The choice is about
  a declaration syntax, not about a new binding mechanism reaching consumers.
- **The public-API gate turns that into a reviewable diff.** RS0016 and RS0017 at error severity
  (`Directory.Build.props:78-79`) mean any change to an extension member, including one caused by a
  compiler change to the emitted shape, shows up as a text diff in `PublicAPI.Shipped.txt` before a
  package is published, which is the same protection ADR-015 gives every other member.
- **Consistency across four repos beats a mixed idiom.** With 83 blocks in the framework and 39 more
  across ADC, Store and Helpdesk, a partial adoption would mean a reader has to know which of two
  declaration styles a given `Add*` uses. The property is set once per repo in
  `Directory.Build.props` and the shape is uniform.
- **The suppressions are cheaper than the alternative.** Seventeen type-level CA1708 suppressions and
  three IDE0051 ones are a bounded, documented cost. The alternative under `TreatWarningsAsErrors`
  plus `CodeAnalysisTreatWarningsAsErrors` (`Directory.Build.props:7`, `:13`) would be lowering an
  analyzer's severity repo-wide, which hides real hits along with the false ones.

## Trade-offs
- **A preview language feature under a floating SDK is a moving target.** No `global.json` pins an
  SDK version and CI installs `dotnet-version: '10.0.x'` (`MMCA.Common/.github/workflows/ci.yml:82`
  and seven more, `release.yml:24`, `:108`), so the compiler and the analyzers that interpret these
  blocks can change on any patch release with no repo edit. That is not hypothetical: the IDE0051
  suppressions record behavior that differs between SDK 10.0.201 and the 10.0.104 the same comment
  names (`Infrastructure/DependencyInjection.cs:870`).
- **Method to property inside a block is a binary break, and it does not look like one.** Both are
  members of the same block and the source edit is two words, but the emitted classic member changes
  from `Name(this T)` to `get_Name(T)` (`Domain/PublicAPI.Shipped.txt:68` beside `:224`, against
  `Application/PublicAPI.Shipped.txt:64` beside `:701`). RS0017 catches the removal at build time in
  MMCA.Common; a consumer that had already compiled against the old member does not get that warning.
- **Analyzers do not fully understand the shape.** CA1708 is wrong on every block it flags (17
  type-level suppressions) and IDE0051 is wrong across the block boundary (three more). Each
  suppression is a place where a genuine future hit on that type is silenced too, and the IDE0051
  ones carry an explicit "remove this once Roslyn fixes it" that nothing enforces.
- **Anything reflecting over the assemblies has to special-case the marker attribute.** The
  architecture fitness rule already does
  (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:8`, `:174-178`). Any future
  rule, source generator or documentation tool that walks methods in a framework assembly inherits
  the same requirement, and the failure mode is a false positive on a body no developer wrote.
- **The public-API baselines are roughly doubled for this surface.** 187 shipped and 58 unshipped
  `.extension` lines sit alongside their `static ...(this ...)` counterparts, so a single new
  registration method costs two or three baseline lines instead of one, and a reviewer reading a
  baseline diff sees the same member twice.
- **The one package with no gate is the one with the least coverage.** `MMCA.Common.UI.Maui`'s two
  blocks (`UI.Maui/DependencyInjection.cs:34`, `UI.Maui/HostingDependencyInjection.cs:17`) are
  excluded from RS0016/RS0017 (`Directory.Build.props:86`), so a reshape there would reach a
  published package without the text diff that protects the other thirteen.
- **The declaration reads as an instance method that is not one.**
  `public IServiceCollection AddApplication()` (`Application/DependencyInjection.cs:35`) has no
  visible receiver parameter; the receiver comes from the enclosing block header six lines up. That
  is the ergonomic benefit and the readability cost in the same line, and it is why three suppression
  justifications had to explain the block boundary in prose rather than point at a rule.

## Related
[ADR-015](015-architecture-fitness-functions.md) (the RS0016/RS0017 baseline that freezes both
emitted shapes of every extension member, and the fitness-rule tier that had to learn about
`ExtensionMarkerAttribute`), [ADR-059](059-module-contract-and-composition.md) (the `IModule`
contract, whose host-side composition is registered through the `AddModuleHost` extension member),
[ADR-053](053-dual-registry-package-publishing.md) (the dual-registry publish that ships this surface
to nuget.org and GitHub Packages), [ADR-016](016-lockstep-versioning-masstransit-pin.md) (lockstep
versioning: a reshape of this surface lands in every package at one version and every consumer bumps
in one pass), [ADR-042](042-device-capability-abstraction.md) (the MAUI record named by the
`Directory.Build.props` exclusion that leaves `MMCA.Common.UI.Maui` outside the public-API gate),
[ADR-101](101-common-metapackage.md) (the metapackage a host installs to get most of these `Add*`
names in one `PackageReference`).
