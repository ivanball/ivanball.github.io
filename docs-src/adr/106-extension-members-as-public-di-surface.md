# ADR-106: C# Extension Members as the Public DI Registration Surface

## Status
Accepted (2026-09-01; counts re-measured 2026-10-01). Revised 2026-10-06: counts re-measured against current source, and ADC's broker selection is now credited to the framework rather than to an ADC block. Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
Every host in this workspace boots the same way: a `Program.cs` calls a short list of `Add*` methods
on `IServiceCollection`, one per layer, and all of the framework's wiring sits behind those names.
MMCA.Helpdesk's web host is the smallest of them, calling `services.AddApplication()`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`),
`services.AddInfrastructure(builder.Configuration)` (`:79`), `services.AddAPI(modulesSettings)`
(`:101`) and `services.AddApplicationDecorators()` (`:132`). Even that host is not four calls any
more: its capability opt-ins arrive through the same surface, as
`services.AddAuditTrail(builder.Configuration)` (`:90`),
`services.AddScheduledJobs(builder.Configuration)` (`:91`),
`services.AddMultiTenancy(builder.Configuration)` (`:92`),
`services.AddErrorResources<TicketsErrorResources>()` (`:106`) and
`services.AddBrokerMessaging(builder.Configuration)` (`:130`). Every one of them is an `Add*` name on
`IServiceCollection`.

What is unusual is how those methods are declared. None of them is a classic static extension method
with a `this` parameter. Each is a member of a C# `extension(T)` block: `AddApplication` is written
as `public IServiceCollection AddApplication()` inside `extension(IServiceCollection services)`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:26`, method at `:32`), and
`AddInfrastructure`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:49`, method at `:57`),
`AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:28`, method at
`:45`) and `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:33`,
method at `:39`) take the identical shape. The framework says so on the types themselves:
Infrastructure's DI class documents itself as using "C# preview extension types to add methods
directly to `IServiceCollection`" (`Infrastructure/DependencyInjection.cs:40-41`) and UI's repeats it
for `AddUIShared` (`UI/DependencyInjection.cs:29`).

Compiling that requires a preview language version, and every repo in the workspace sets one:
`LangVersion preview` in `MMCA.Common/Directory.Build.props:6`, `MMCA.Store/Directory.Build.props:9`,
`MMCA.ADC/Directory.Build.props:9` and `MMCA.Helpdesk/Directory.Build.props:12`, each beside the same
`net10.0` target (`:3`, `:6`, `:6`, `:9`) and the same `TreatWarningsAsErrors` (`:7`, `:10`, `:10`,
`:13`). It is a solution-wide property in a `Directory.Build.props`, not a per-project opt-in that a
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
   (`MMCA.Common/Directory.Build.props:6`, `MMCA.Store/Directory.Build.props:9`,
   `MMCA.ADC/Directory.Build.props:9`, `MMCA.Helpdesk/Directory.Build.props:12`), so every project in
   every solution compiles at it. None of the four `global.json` files pins an SDK: each contains
   only the Microsoft Testing Platform runner (`MMCA.Common/global.json:1-5`, and the Store, ADC and
   Helpdesk files are identical), so the compiler that interprets `preview` is whichever 10.0.x SDK
   is installed.

2. **Forty-one `extension(IServiceCollection services)` blocks are the DI surface.** Measured on
   2026-10-06 across `MMCA.Common/Source`, there are 41 such blocks in 41 files, spread over thirteen
   packages: Application (`Application/DependencyInjection.cs:26`,
   `Application/DependencyInjection.ModuleScanning.cs:15`, `Application/DependencyInjection.Crud.cs:16`,
   `Application/DependencyInjection.Extensibility.cs:11`,
   `Application/Notifications/DependencyInjection.cs:29`), Infrastructure
   (`Infrastructure/DependencyInjection.cs:49`, `Infrastructure/DependencyInjection.Caching.cs:19`,
   `Infrastructure/DependencyInjection.Auth.cs:19`, `Infrastructure/DependencyInjection.Messaging.cs:19`,
   `Infrastructure/DependencyInjection.Jobs.cs:15`,
   `Infrastructure/DependencyInjection.Notifications.cs:19`), AI (`AI/DependencyInjection.cs:79`,
   `AI/Guardrails/GuardrailServiceCollectionExtensions.cs:19`), AI.OpenAI
   (`AI.OpenAI/DependencyInjection.cs:19`), AI.Anthropic (`AI.Anthropic/DependencyInjection.cs:19`), API
   (`API/DependencyInjection.cs:28`,
   `API/Authentication/ExternalAuthExtensions.cs:30`,
   `API/Authorization/AuthorizationExtensions.cs:16`,
   `API/Caching/OutputCacheEvictionExtensions.cs:95`, `API/Startup/MiniProfilerExtensions.cs:11`,
   `API/Startup/WebApplicationBuilderExtensions.cs:32`,
   `API/Startup/WebApplicationBuilderExtensions.Authentication.cs:27`,
   `API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:321`), UI (`UI/DependencyInjection.cs:33`,
   `UI/Notifications/DependencyInjection.cs:14`,
   `UI/Services/Capabilities/DependencyInjection.cs:25`), UI.Web
   (`UI.Web/DependencyInjection.cs:22`, `UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:43`,
   `UI.Web/Hardening/UiRateLimitingExtensions.cs:166`,
   `UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:39`), UI.Maui
   (`UI.Maui/DependencyInjection.cs:36`), Grpc
   (`Grpc/DependencyInjection.cs:27`), Aspire (`Aspire/Extensions.cs:113`,
   `Aspire/GatewayCorsExtensions.cs:18`, `Aspire/Security/SecurityHeaders.cs:260`,
   `Aspire/Gateway/GatewayRateLimitingExtensions.cs:258`,
   `Aspire/Gateway/GatewayHealthCheckExtensions.cs:97`), Gateway
   (`Gateway/RateLimiting/GatewayRoutePolicyExtensions.cs:40`) and Testing
   (`Testing/Support/FeatureManagementTestExtensions.cs:12`,
   `Testing/Support/RateLimiterTestExtensions.cs:13`,
   `Testing/Fixtures/CrossServiceHostIsolation.cs:32`).
   A plain text search finds 45 occurrences of that exact receiver, because four of them are
   analyzer-suppression justification strings rather than declarations
   (`Infrastructure/DependencyInjection.Messaging.cs:201`, `:224`, `:263`,
   `Infrastructure/DependencyInjection.Jobs.cs:145`).

3. **The idiom reaches well past DI.** The same measurement finds 112 `extension` blocks across 92
   files under `MMCA.Common/Source`. Receivers include `WebApplicationBuilder`
   (`API/Startup/ModuleHostExtensions.cs:24`, `Aspire/Logging/SerilogHostExtensions.cs:29`),
   `WebApplication` (`API/Startup/WebApplicationExtensions.cs:37`), `IEndpointRouteBuilder`
   (`API/Startup/Endpoints/JwksEndpointExtensions.cs:22`,
   `API/SessionCookies/SessionCookieEndpoints.cs:21`),
   `IApplicationBuilder` (`Gateway/ForwardedHeadersExtensions.cs:25`),
   `IDistributedApplicationBuilder` and `IResourceBuilder<ProjectResource>`
   (`Aspire.Hosting/Extensions.cs:126`, `:340`, `:410`), `IPage` and `ILocator`
   (`Testing.E2E/Infrastructure/PageExtensions.cs:62`, `:360`), `Assembly`, `Type` and
   `PropertyInfo` (`Testing.Architecture/RuleHelpers.cs:16`, `:48`, `:122`), and generic receivers
   such as `IReadRepository<TEntity, TIdentifierType>`
   (`Application/Extensions/ReadRepositoryExtensions.cs:12`).

4. **Module composition is registered through one of these blocks.** `AddModuleHost` binds the two
   settings sections, builds the `ModuleLoader` and registers it as a singleton, and it is an
   extension member on `WebApplicationBuilder` (`API/Startup/ModuleHostExtensions.cs:24`, method at
   `:51`). The `IModule` contract of ADR-059 therefore reaches a host through the same surface this
   record describes.

5. **Consumers write them too.** The idiom is not confined to the framework: MMCA.ADC declares 20
   blocks across 20 files under `Source` (14 module DI classes, the four service-contract packages,
   `Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs` and
   `Services/MMCA.ADC.Identity.Service/Authorization/TokenPermissionGrants.cs`; the web-host hardening
   registrations live in the framework at `UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:43` and
   `UI.Web/Hardening/UiRateLimitingExtensions.cs:166`, and broker selection in
   `Aspire.Hosting/BrokerSelection.cs`),
   MMCA.Store 18 across 18, and MMCA.Helpdesk 3 across 3
   (`Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs` and
   its `.API` and `.Infrastructure` siblings). The reference seed teaches the shape by using it.

6. **The call site is indistinguishable from a classic extension method.** A host writes
   `services.AddApplication();` (`Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`), and the
   same holds for every other entry point. Nothing about the declaration style is visible to the
   caller.

7. **The public-API gate records every extension member twice.** RS0016 and RS0017 stay at error
   severity and every packable Source project declares its surface in `PublicAPI.Shipped.txt`
   (`MMCA.Common/Directory.Build.props:79-96`, gate item group at `:89`, rules described at
   `:81`). For an extension member the baseline holds a container line plus a member line, and a
   separate classic static line carrying a `this` parameter. `AddApplication` appears as
   `MMCA.Common.Application.DependencyInjection.extension(...IServiceCollection!).AddApplication()`
   (`Application/PublicAPI.Shipped.txt:260`, container at `:259`) and as
   `static MMCA.Common.Application.DependencyInjection.AddApplication(this ...IServiceCollection! services)`
   (`:1241`). Across the repo there are 290 `.extension` lines in 17 `PublicAPI.Shipped.txt` files,
   covering 17 packages, and none in any `PublicAPI.Unshipped.txt`. Gateway's surface is shipped like
   the rest: both shapes of `UseCommonForwardedHeaders` sit in `Gateway/PublicAPI.Shipped.txt:12` and
   `:98`, and its `PublicAPI.Unshipped.txt` is a single line.

8. **One extension property exists in the whole surface, and it emits a different classic shape.**
   `IsIdValueGenerated` is declared as an extension property on `Type`
   (`Domain/Extensions/EntityTypeExtensions.cs:11`) and is recorded as
   `...EntityTypeExtensions.extension(System.Type!).IsIdValueGenerated.get -> bool`
   (`Domain/PublicAPI.Shipped.txt:111`) with the classic counterpart
   `static ...EntityTypeExtensions.get_IsIdValueGenerated(System.Type! entityType) -> bool` (`:293`).
   A method emits `Name(this T x)`; a property emits `get_Name(T x)`. Those are different members.

9. **The MAUI package uses the idiom but sits outside the gate.** `MMCA.Common.UI.Maui` declares three
   blocks (`UI.Maui/DependencyInjection.cs:36` on `IServiceCollection`,
   `UI.Maui/HostingDependencyInjection.cs:17` on `MauiAppBuilder`,
   `UI.Maui/WindowLifecycleExtensions.cs:24` on `Window`) and is the one project excluded
   from the public-API analyzer, because it lives outside `MMCA.Common.slnx` and builds only on the
   windows MAUI job (`MMCA.Common/Directory.Build.props:89`, reason at `:85-87`, naming ADR-042). Its
   extension surface is therefore unbaselined.

10. **Analyzer fallout is carried as documented suppressions, not by changing the code shape.**
    CA1708 ("identifiers should differ by more than case") fires on the compiler-generated grouping
    members of an `extension(T)` block and is suppressed at the type with an explicit
    false-positive justification in 27 files, 26 of them under `MMCA.Common/Source` (for example
    `Gateway/ForwardedHeadersExtensions.cs:19-22`, `UI/Extensions/MoneyExtensions.cs:10-13`) and one
    in an ADC E2E page object. IDE0051 ("unused private member") misses references that cross from
    inside a block to a private member of the containing class on SDK 10.0.201 and later, and is
    suppressed nine times across four files with that reason spelled out: seven `SuppressMessage`
    attributes (`Infrastructure/DependencyInjection.Jobs.cs:144`,
    `Infrastructure/DependencyInjection.Messaging.cs:200`, `:223`, `:262`,
    `Testing.E2E/Infrastructure/PageExtensions.cs:21` at type level, `:479` and `:496`) and two
    `#pragma` pairs (`Shared/Extensions/DomainHelper.cs:79`, `:110`).

11. **A fitness function has to know the emitted shape.** The `DomainThrowsOnlyArgumentGuards` rule
    (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:71`) walks IL and would
    otherwise flag the skeleton members an `extension(T)` block leaves in a Domain assembly, whose
    `NotSupportedException` nobody typed. It skips any method carrying
    `System.Runtime.CompilerServices.ExtensionMarkerAttribute` (constant at `:8`, filter at `:92`,
    predicate at `:179-182`, documented at `:161-178`).

12. **The exit path is a mechanical rewrite that does not reach callers.** If the feature changed
    shape, each block would be flattened back to classic static extension methods: a
    `public R M(...)` inside `extension(T x)` becomes `public static R M(this T x, ...)`, with the
    method names, parameters and return types unchanged. That is exactly the form the baselines
    already record on their `static ...(this ...)` lines
    (`Application/PublicAPI.Shipped.txt:1241-1253`), so the public API a
    consumer binds to would not move and no `Program.cs` line would change. The single exception is
    the extension property in Decision point 8, whose classic form is `get_IsIdValueGenerated(Type)`
    rather than a `this`-marked method.

## Rationale
- **One `Add*` name per layer is the point of the surface.** A host reads as a list of layers
  (`Program.cs:78`, `:79`, `:101`, `:132`), and grouping the registrations by receiver in a single
  block is what keeps the declaration site organized by what it extends rather than by a repeated
  `this IServiceCollection services` parameter on every method.
- **The compiler already emits the classic shape, so the exposure is smaller than the word "preview"
  suggests.** Both forms are in the baseline for every extension member, which is direct evidence
  that the shipped metadata still contains an ordinary static extension method. The choice is about
  a declaration syntax, not about a new binding mechanism reaching consumers.
- **The public-API gate turns that into a reviewable diff.** RS0016 and RS0017 at error severity
  (`Directory.Build.props:26`) mean any change to an extension member, including one caused by a
  compiler change to the emitted shape, shows up as a text diff in `PublicAPI.Shipped.txt` before a
  package is published, which is the same protection ADR-015 gives every other member.
- **Consistency across four repos beats a mixed idiom.** With 112 blocks in the framework and 41 more
  across ADC, Store and Helpdesk, a partial adoption would mean a reader has to know which of two
  declaration styles a given `Add*` uses. The property is set once per repo in
  `Directory.Build.props` and the shape is uniform.
- **The suppressions are cheaper than the alternative.** Twenty-seven type-level CA1708 suppressions and
  nine IDE0051 ones are a bounded, documented cost. The alternative under `TreatWarningsAsErrors`
  plus `CodeAnalysisTreatWarningsAsErrors` (`Directory.Build.props:7`, `:13`) would be lowering an
  analyzer's severity repo-wide, which hides real hits along with the false ones.

## Trade-offs
- **A preview language feature under a floating SDK is a moving target.** No `global.json` pins an
  SDK version and CI installs `dotnet-version: '10.0.x'` (`MMCA.Common/.github/workflows/ci.yml:101`
  and ten more, `release.yml:50`, `:186`), so the compiler and the analyzers that interpret these
  blocks can change on any patch release with no repo edit. That is not hypothetical: the IDE0051
  suppressions record behavior that differs between SDK 10.0.201 and the 10.0.104 the same comment
  names (`Infrastructure/DependencyInjection.Messaging.cs:224`).
- **Method to property inside a block is a binary break, and it does not look like one.** Both are
  members of the same block and the source edit is two words, but the emitted classic member changes
  from `Name(this T)` to `get_Name(T)` (`Domain/PublicAPI.Shipped.txt:111` beside `:293`, against
  `Application/PublicAPI.Shipped.txt:260` beside `:1241`). RS0017 catches the removal at build time in
  MMCA.Common; a consumer that had already compiled against the old member does not get that warning.
- **Analyzers do not fully understand the shape.** CA1708 is wrong on every block it flags (27
  type-level suppressions) and IDE0051 is wrong across the block boundary (nine more). Each
  suppression is a place where a genuine future hit on that type is silenced too, and the IDE0051
  ones carry an explicit "remove this once Roslyn fixes it" that nothing enforces.
- **Anything reflecting over the assemblies has to special-case the marker attribute.** The
  architecture fitness rule already does
  (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:8`, `:179-182`). Any future
  rule, source generator or documentation tool that walks methods in a framework assembly inherits
  the same requirement, and the failure mode is a false positive on a body no developer wrote.
- **The public-API baselines are roughly doubled for this surface.** 290 shipped
  `.extension` lines sit alongside their `static ...(this ...)` counterparts, so a single new
  registration method costs two or three baseline lines instead of one, and a reviewer reading a
  baseline diff sees the same member twice.
- **The one package with no gate is the one with the least coverage.** `MMCA.Common.UI.Maui`'s three
  blocks (`UI.Maui/DependencyInjection.cs:36`, `UI.Maui/HostingDependencyInjection.cs:17`,
  `UI.Maui/WindowLifecycleExtensions.cs:24`) are
  excluded from RS0016/RS0017 (`Directory.Build.props:89`), so a reshape there would reach a
  published package without the text diff that protects the other eighteen.
- **The declaration reads as an instance method that is not one.**
  `public IServiceCollection AddApplication()` (`Application/DependencyInjection.cs:32`) has no
  visible receiver parameter; the receiver comes from the enclosing block header six lines up. That
  is the ergonomic benefit and the readability cost in the same line, and it is why seven suppression
  justifications and two inline comments had to explain the block boundary in prose rather than point
  at a rule (`Infrastructure/DependencyInjection.Jobs.cs:145`,
  `Infrastructure/DependencyInjection.Messaging.cs:201`, `:224`, `:263`,
  `Testing.E2E/Infrastructure/PageExtensions.cs:22`, `:480`, `:497`,
  `Shared/Extensions/DomainHelper.cs:78`, `:109`).

## Revision (2026-10-01)
No decision or rationale changed: the framework's DI surface is still written as `extension(T)`
blocks compiled under `LangVersion preview`, and both emitted shapes are still baselined. The
counts and citations were re-measured against MMCA.Common v1.216.0. The Application and
Infrastructure DI classes are now split into partial files, so the `extension(IServiceCollection
services)` blocks number 39 over thirteen packages (adding `AI.OpenAI/DependencyInjection.cs:19`
and `AI.Anthropic/DependencyInjection.cs:19`), and the four IDE0051 justification strings moved to
`Infrastructure/DependencyInjection.Messaging.cs:195`, `:218`, `:257` and
`Infrastructure/DependencyInjection.Jobs.cs:145`. The ADC web-host hardening registrations moved
into the framework (`UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:43`,
`UI.Web/Hardening/UiRateLimitingExtensions.cs:150`), so ADC now declares 21 blocks in 21 files and
the framework 107 in 88. Every `.extension` baseline line is shipped (279 in 17
`PublicAPI.Shipped.txt` files, none unshipped), including Gateway's
(`Gateway/PublicAPI.Shipped.txt:12`, `:98`). UI.Maui gained a third block
(`UI.Maui/WindowLifecycleExtensions.cs:24`), CA1708 is suppressed in 26 files and IDE0051 in eight
places across four files, and the line anchors for `Directory.Build.props` in Store and Helpdesk,
the public-API baselines, the `DomainThrowsOnlyArgumentGuards` rule and the CI workflows were
refreshed.

## Revision (2026-10-06)
No decision or rationale changed; the counts and one attribution were corrected against current source.
- The `extension(IServiceCollection services)` blocks number 41 in 41 files (still thirteen packages),
  adding `UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:39` and
  `Testing/Fixtures/CrossServiceHostIsolation.cs:32`; a text search finds 45 hits, the four extra being
  the justification strings now at `Infrastructure/DependencyInjection.Messaging.cs:201`, `:224`, `:263`
  and `Infrastructure/DependencyInjection.Jobs.cs:145`.
- The framework declares 112 `extension` blocks in 92 files (the count includes generic-receiver blocks).
- ADC declares 20 blocks in 20 files: `AppHost/BrokerSelection.cs` is gone from ADC and broker selection
  lives in the framework at `Aspire.Hosting/BrokerSelection.cs`. Store declares 18 in 18; Helpdesk is
  unchanged at 3, so consumers add 41.
- The shipped baselines hold 290 `.extension` lines in 17 files, still none unshipped.
- CA1708 is suppressed in 27 files (26 in MMCA.Common, one in ADC). IDE0051 is suppressed in nine places
  across four files: seven attributes (a third in `Testing.E2E/Infrastructure/PageExtensions.cs` at
  `:496`) and the two `#pragma` pairs.
- Every remaining line anchor in Context, Decision, Rationale and Trade-offs was re-verified against
  current source and moved where the code moved.

## Revision (2026-10-07)
Re-verified against current source. No decision, rationale, count or trade-off changed: the DI surface
is still written as `extension(T)` blocks under `LangVersion preview` and both emitted shapes are still
baselined. Only line anchors moved after the v1.233.0 release.
1. Anchors re-verified against current source: the `AddApplication` extension member is at
   `MMCA.Common/Source/Core/MMCA.Common.Application/PublicAPI.Shipped.txt:260` (container at `:259`) and
   its classic static form at `:1241`, so the classic `DependencyInjection` block runs `:1241-1253`
   (ending at `VerifyDecoratorPipeline`); `dotnet-version: '10.0.x'` in
   `MMCA.Common/.github/workflows/release.yml` is at `:50` and `:186`.

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
