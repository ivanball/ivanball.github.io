# ADR-106: C# Extension Members as the Public DI Registration Surface

## Status
Accepted (2026-09-01; counts re-measured 2026-10-01). Revised 2026-10-06: counts re-measured against current source, and ADC's broker selection is now credited to the framework rather than to an ADC block. Revised 2026-10-07: anchors refreshed after the v1.233.0 release. Revised 2026-10-19: the Helpdesk host examples re-pointed after the host moved to `AddMmcaApplicationPipeline`. Revised 2026-10-21: counts re-measured (42 DI blocks, 117 extension blocks, 300 baseline lines), the Trade-offs package count made precise (17 packages with a baselined extension surface), and anchors refreshed. Revised 2026-10-26: counts re-measured after the cloud adapter packages landed (46 DI blocks over sixteen packages, 127 extension blocks, 307 shipped baseline lines plus 17 unshipped, 20 packages with a baselined extension surface, 30 CA1708 suppressions), and anchors refreshed. Revised 2026-10-28: the v1.264.0 release promoted every unshipped extension line (326 shipped baseline lines in 20 files, none unshipped), a PWA endpoint block raised the framework count to 128 extension blocks in 107 files, and anchors refreshed. Revised 2026-11-23: Common, Store and ADC compile the blocks under `LangVersion 15.0` (only Helpdesk keeps `preview` in its root props) on an SDK pinned to 11.0.100 with latestFeature roll-forward, so the preview framing is retired; counts re-measured (55 DI blocks over seventeen packages, 154 framework and 42 consumer extension blocks under `Source`, 396 shipped baseline lines in 24 packages, 40 CA1708 and eleven IDE0051 suppressions), and anchors refreshed.

## Context
Every host in this workspace boots the same way: a `Program.cs` calls a short list of `Add*` methods
on `IServiceCollection`, one per layer, and all of the framework's wiring sits behind those names.
MMCA.Helpdesk's web host is the smallest of them, calling
`services.AddInfrastructure(builder.Configuration)`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`), `services.AddAPI(modulesSettings)`
(`:116`) and `services.AddMmcaApplicationPipeline(...)` (`:138`), which runs `AddApplication()`
first and `AddApplicationDecorators()` last around the host's registration steps. Even that host is
not three calls: its capability opt-ins arrive through the same surface, as
`services.AddAuditTrail(builder.Configuration)` (`:104`),
`services.AddScheduledJobs(builder.Configuration)` (`:105`),
`services.AddMultiTenancy(builder.Configuration)` (`:106`),
`services.AddErrorResources<TicketsErrorResources>()` (`:121`) and
`s.AddBrokerMessaging(builder.Configuration)` inside a pipeline `Register` step (`:156`). Every one
of them is an `Add*` name on `IServiceCollection`.

What is unusual is how those methods are declared. None of them is a classic static extension method
with a `this` parameter. Each is a member of a C# `extension(T)` block: `AddApplication` is written
as `public IServiceCollection AddApplication()` inside `extension(IServiceCollection services)`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:30`, method at `:36`), and
`AddInfrastructure`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:50`, method at `:58`),
`AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:28`, method at
`:45`) and `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:37`,
method at `:43`) take the identical shape. The framework says so on the types themselves:
Infrastructure's DI class documents itself as using "C# preview extension types to add methods
directly to `IServiceCollection`" (`Infrastructure/DependencyInjection.cs:41-42`) and UI's says it
"Uses C# extension members to add `AddUIShared`" (`UI/DependencyInjection.cs:33`).

Compiling that needs a language version that includes extension members, and every repo in the
workspace sets one solution-wide: `LangVersion 15.0` in `MMCA.Common/Directory.Build.props:18`,
`MMCA.Store/Directory.Build.props:47` and `MMCA.ADC/Directory.Build.props:50`, and `LangVersion
preview` in `MMCA.Helpdesk/Directory.Build.props:12`, each beside the same `TreatWarningsAsErrors`
(`:19`, `:48`, `:51`, `:13`). Common multi-targets `$(MmcaNetVersions)`
(`MMCA.Common/Directory.Build.props:7`), which is `net10.0;net11.0`
(`MMCA.Common/build/Frameworks.props:23`); Store and ADC target `$(MmcaNet)` (`:39`, `:42`, the ADC
`net10.0` line selected with `-p:MmcaNet=net10.0` per the comment at `MMCA.ADC/Directory.Build.props:8`)
and Helpdesk targets `net10.0` (`:9`). It is a solution-wide property in a `Directory.Build.props`
that every project in each repo's solution inherits, not a per-project opt-in. The only projects
that set their own are two MMCA.Common build tools, `build/facts/facts.csproj:13` and
`build/perfgate/perfgate.csproj:13` (both `preview`), which sit outside `MMCA.Common.slnx`, ship no
package, and are deliberately cut off from the root props by `MMCA.Common/build/Directory.Build.props:3-7`.

This is therefore not a stylistic preference confined to one file. It is the shape of the entire
public registration surface of packages published to nuget.org and GitHub Packages under ADR-053,
frozen member by member by the ADR-015 public-API gate, and repeated by every consumer that writes
its own module registration. A recent language feature sits underneath all of it, and nothing in
the code records that as a decision with a stated cost and a stated way out. This record does.

## Decision
**The framework's public dependency-injection surface is written as C# extension members:
`extension(T)` blocks inside `public static class` types, compiled under `LangVersion 15.0` in
Common, Store and ADC and `LangVersion preview` in Helpdesk, and shipped to both registries in that
form. The compiler-emitted classic static extension method is what keeps the choice reversible, and
the public-API baselines record both shapes.**

1. **The language version is a workspace-wide property, not a local opt-in.** All four repos set
   `LangVersion` in their root `Directory.Build.props`: `15.0` in Common, Store and ADC
   (`MMCA.Common/Directory.Build.props:18`, `MMCA.Store/Directory.Build.props:47`,
   `MMCA.ADC/Directory.Build.props:50`) and `preview` in Helpdesk
   (`MMCA.Helpdesk/Directory.Build.props:12`), so every project in every solution compiles at it (the two build-tool projects outside
   `MMCA.Common.slnx` named in the Context are the only ones that set their own). The
   framework's blocks compile under the released `15.0`, so they do not depend on `preview`. All four
   `global.json` files are identical: each pins the SDK to `11.0.100` with `rollForward:
   latestFeature` (`MMCA.Common/global.json:2-5`) and selects the Microsoft Testing Platform runner
   (`:6-8`), so the compiler that interprets these blocks is an 11.0 SDK at feature band 100 or later.

2. **Fifty-five `extension(IServiceCollection services)` blocks are the DI surface.** Measured on
   2026-11-23 across `MMCA.Common/Source`, there are 55 such blocks in 55 files, spread over
   seventeen packages: Application (`Application/DependencyInjection.cs:30`,
   `Application/DependencyInjection.ModuleScanning.cs:15`, `Application/DependencyInjection.Crud.cs:16`,
   `Application/DependencyInjection.Extensibility.cs:11`,
   `Application/DependencyInjection.ProcessManagers.cs:9`,
   `Application/DependencyInjection.Webhooks.cs:15`,
   `Application/Notifications/DependencyInjection.cs:29`), Infrastructure
   (`Infrastructure/DependencyInjection.cs:50`, `Infrastructure/DependencyInjection.Caching.cs:20`,
   `Infrastructure/DependencyInjection.Auth.cs:21`, `Infrastructure/DependencyInjection.Messaging.cs:17`,
   `Infrastructure/DependencyInjection.Jobs.cs:15`,
   `Infrastructure/DependencyInjection.Notifications.cs:18`,
   `Infrastructure/DependencyInjection.Persistence.cs:10`,
   `Infrastructure/DependencyInjection.FeatureFlags.cs:15`,
   `Infrastructure/DependencyInjection.MachineClients.cs:13`,
   `Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:21`), Passkeys
   (`Passkeys/PasskeysServiceCollectionExtensions.cs:12`), AI (`AI/DependencyInjection.cs:79`,
   `AI/Guardrails/GuardrailServiceCollectionExtensions.cs:19`), AI.OpenAI
   (`AI.OpenAI/DependencyInjection.cs:19`), AI.Anthropic (`AI.Anthropic/DependencyInjection.cs:19`), API
   (`API/DependencyInjection.cs:28`,
   `API/Authentication/ExternalAuthExtensions.cs:38`,
   `API/Authorization/AuthorizationExtensions.cs:21`,
   `API/Caching/OutputCacheEvictionExtensions.cs:95`, `API/Startup/MiniProfilerExtensions.cs:11`,
   `API/Startup/WebApplicationBuilderExtensions.cs:32`,
   `API/Startup/WebApplicationBuilderExtensions.Authentication.cs:27`,
   `API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:357`), UI (`UI/DependencyInjection.cs:37`,
   `UI/Notifications/DependencyInjection.cs:14`,
   `UI/Services/Capabilities/DependencyInjection.cs:26`,
   `UI/Services/Diagnostics/DependencyInjection.cs:14`, `UI/TwoFactor/DependencyInjection.cs:15`), UI.Web
   (`UI.Web/DependencyInjection.cs:22`, `UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:43`,
   `UI.Web/Hardening/UiRateLimitingExtensions.cs:208`,
   `UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:39`), UI.Maui
   (`UI.Maui/DependencyInjection.cs:37`), Grpc
   (`Grpc/DependencyInjection.cs:28`,
   `Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:25`), Aspire (`Aspire/Extensions.cs:144`,
   `Aspire/GatewayCorsExtensions.cs:18`, `Aspire/Security/SecurityHeaders.cs:260`,
   `Aspire/Gateway/GatewayRateLimitingExtensions.cs:360`,
   `Aspire/Gateway/GatewayHealthCheckExtensions.cs:97`), Gateway
   (`Gateway/RateLimiting/GatewayRoutePolicyExtensions.cs:51`), Testing
   (`Testing/Support/FeatureManagementTestExtensions.cs:12`,
   `Testing/Support/RateLimiterTestExtensions.cs:13`,
   `Testing/Support/ServiceCollectionFakeExtensions.cs:11`,
   `Testing/Fixtures/CrossServiceHostIsolation.cs:32`) and the three cloud vendor adapters, Azure
   (`Azure/AzureServiceCollectionExtensions.cs:33`), Aws (`Aws/AwsServiceCollectionExtensions.cs:32`)
   and Gcp (`Gcp/GcpServiceCollectionExtensions.cs:29`).
   A plain text search finds 59 occurrences of that exact receiver, because four of them are
   analyzer-suppression justification strings rather than declarations
   (`Infrastructure/DependencyInjection.Messaging.cs:187`, `:240`, `:263`,
   `Infrastructure/DependencyInjection.Jobs.cs:145`).

3. **The idiom reaches well past DI.** Re-measured on 2026-11-23, an anchored search finds 154
   `extension` blocks across 128 files under `MMCA.Common/Source`, generic receivers included. Receivers include `WebApplicationBuilder`
   (`API/Startup/ModuleHostExtensions.cs:24`, `Aspire/Logging/SerilogHostExtensions.cs:29`),
   `WebApplication` (`API/Startup/WebApplicationExtensions.cs:38`), `IEndpointRouteBuilder`
   (`API/Startup/Endpoints/JwksEndpointExtensions.cs:22`,
   `API/SessionCookies/SessionCookieEndpoints.cs:21`),
   `IApplicationBuilder` (`Gateway/ForwardedHeadersExtensions.cs:25`),
   `IDistributedApplicationBuilder` (`Aspire.Hosting/Extensions.cs:179`), a generic
   `IResourceBuilder<TResource>` (`:300`) and `IResourceBuilder<DotnetProjectResource>` (`:400`, `:473`,
   `:523`), `IPage` and `ILocator`
   (`Testing.E2E/Infrastructure/PageExtensions.cs:81`, `:429`), `Assembly`, `Type` and
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
   `UI.Web/Hardening/UiRateLimitingExtensions.cs:208`, and broker selection in
   `Aspire.Hosting/BrokerSelection.cs`),
   MMCA.Store 19 across 19, and MMCA.Helpdesk 3 across 3
   (`Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs` and
   its `.API` and `.Infrastructure` siblings). The reference seed teaches the shape by using it.

6. **The call site is indistinguishable from a classic extension method.** A host writes
   `services.AddInfrastructure(builder.Configuration);`
   (`Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`), and the
   same holds for every other entry point. Nothing about the declaration style is visible to the
   caller.

7. **The public-API gate records every extension member twice.** RS0016 and RS0017 stay at error
   severity (`MMCA.Common/Directory.Build.props:38`) and every packable Source project declares its
   surface in `PublicAPI.Shipped.txt` (gate comment at `MMCA.Common/Directory.Build.props:138-147`,
   rules described at `:140-141`, gate item group at `:148`). For an extension member the baseline
   holds a container line plus a member line, and a separate classic static line carrying a `this`
   parameter. `AddApplication` appears as
   `MMCA.Common.Application.DependencyInjection.extension(...IServiceCollection!).AddApplication()`
   (`Application/PublicAPI.Shipped.txt:517`, container at `:516`) and as
   `static MMCA.Common.Application.DependencyInjection.AddApplication(this ...IServiceCollection! services)`
   (`:1927`). Across the repo there are 396 `.extension` lines in 24 `PublicAPI.Shipped.txt` files
   and none in any `PublicAPI.Unshipped.txt` file, so 24 packages carry a baselined extension
   surface, all of it shipped. Gateway's surface is shipped like the rest: both shapes of
   `UseCommonForwardedHeaders` sit in `Gateway/PublicAPI.Shipped.txt:12` and `:108`, and its
   `PublicAPI.Unshipped.txt` is a single line.

8. **One extension property exists in the whole surface, and it emits a different classic shape.**
   `IsIdValueGenerated` is declared as an extension property on `Type`
   (`Domain/Extensions/EntityTypeExtensions.cs:11`) and is recorded as
   `...EntityTypeExtensions.extension(System.Type!).IsIdValueGenerated.get -> bool`
   (`Domain/PublicAPI.Shipped.txt:180`) with the classic counterpart
   `static ...EntityTypeExtensions.get_IsIdValueGenerated(System.Type! entityType) -> bool` (`:465`).
   A method emits `Name(this T x)`; a property emits `get_Name(T x)`. Those are different members.

9. **The MAUI package uses the idiom but sits outside the gate.** `MMCA.Common.UI.Maui` declares three
   blocks (`UI.Maui/DependencyInjection.cs:37` on `IServiceCollection`,
   `UI.Maui/HostingDependencyInjection.cs:17` on `MauiAppBuilder`,
   `UI.Maui/WindowLifecycleExtensions.cs:24` on `Window`) and is the one project excluded
   from the public-API analyzer, because it lives outside `MMCA.Common.slnx` and builds only on the
   windows MAUI job (`MMCA.Common/Directory.Build.props:148`, reason at `:144-146`, naming ADR-042). Its
   extension surface is therefore unbaselined.

10. **Analyzer fallout is carried as documented suppressions, not by changing the code shape.**
    CA1708 ("identifiers should differ by more than case") fires on the compiler-generated grouping
    members of an `extension(T)` block and is suppressed at the type with an explicit
    false-positive justification in 40 files, 39 of them under `MMCA.Common/Source` (for example
    `Gateway/ForwardedHeadersExtensions.cs:19-22`, `UI/Extensions/MoneyExtensions.cs:10-13`) and one
    in an ADC E2E page object
    (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/PageObjects/Conference/Events/EventFilterPageExtensions.cs:12`).
    IDE0051 ("unused private member") misses references that cross from inside a block to a private
    member of the containing class, which the justifications record against SDK 10.0.201 and later,
    and is suppressed by eleven `SuppressMessage` attributes across three files with that reason
    spelled out (`Infrastructure/DependencyInjection.Jobs.cs:144`,
    `Infrastructure/DependencyInjection.Messaging.cs:186`, `:239`, `:262`,
    `Testing.E2E/Infrastructure/PageExtensions.cs:22` at type level, `:548`, `:565`, `:580`, `:606`,
    `:625` and `:641`). `Shared/Extensions/DomainHelper.cs` carries no IDE0051 suppression; plain
    comments name the calling block member (`:77`, `:106`).

11. **A fitness function has to know the emitted shape.** The `DomainThrowsOnlyArgumentGuards` rule
    (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:71`) walks IL and would
    otherwise flag the skeleton members an `extension(T)` block leaves in a Domain assembly, whose
    `NotSupportedException` nobody typed. It skips any method carrying
    `System.Runtime.CompilerServices.ExtensionMarkerAttribute` (constant at `:8`, filter at `:92`,
    predicate at `:184-187` with the marker clause at `:185`, documented at `:166-183`). The same
    predicate also skips explicit interface implementations on compiler-generated types, the other
    body shape no developer wrote.

12. **The exit path is a mechanical rewrite that does not reach callers.** If the feature changed
    shape, each block would be flattened back to classic static extension methods: a
    `public R M(...)` inside `extension(T x)` becomes `public static R M(this T x, ...)`, with the
    method names, parameters and return types unchanged. That is exactly the form the baselines
    already record on their `static ...(this ...)` lines
    (`Application/PublicAPI.Shipped.txt:1927-1942`), so the public API a
    consumer binds to would not move and no `Program.cs` line would change. The single exception is
    the extension property in Decision point 8, whose classic form is `get_IsIdValueGenerated(Type)`
    rather than a `this`-marked method.

## Rationale
- **One `Add*` name per layer is the point of the surface.** A host reads as a list of layers
  (`Program.cs:78`, `:116`, `:138`), and grouping the registrations by receiver in a single
  block is what keeps the declaration site organized by what it extends rather than by a repeated
  `this IServiceCollection services` parameter on every method.
- **The compiler already emits the classic shape, so the exposure is small.** Both forms are in the
  baseline for every extension member, which is direct evidence that the shipped metadata still
  contains an ordinary static extension method. The choice is about a declaration syntax, not about
  a new binding mechanism reaching consumers.
- **The public-API gate turns that into a reviewable diff.** RS0016 and RS0017 at error severity
  (`Directory.Build.props:38`) mean any change to an extension member, including one caused by a
  compiler change to the emitted shape, shows up as a text diff in `PublicAPI.Shipped.txt` before a
  package is published, which is the same protection ADR-015 gives every other member.
- **Consistency across four repos beats a mixed idiom.** With 154 blocks in the framework and 42 more
  under the `Source` trees of ADC, Store and Helpdesk (plus one in an ADC E2E page object), a partial adoption would mean a reader has to know which of two
  declaration styles a given `Add*` uses. The property is set once per repo in
  `Directory.Build.props` and the shape is uniform.
- **The suppressions are cheaper than the alternative.** Forty type-level CA1708 suppressions and
  eleven IDE0051 ones are a bounded, documented cost. The alternative under `TreatWarningsAsErrors`
  plus `CodeAnalysisTreatWarningsAsErrors` (`Directory.Build.props:19`, `:25`) would be lowering an
  analyzer's severity repo-wide, which hides real hits along with the false ones.

## Trade-offs
- **A recent language feature under a rolling SDK is a moving target.** Every `global.json` pins SDK
  `11.0.100` with `rollForward: latestFeature` (`MMCA.Common/global.json:2-5`), and CI installs both
  `10.0.x` and `11.0.x` (`MMCA.Common/.github/workflows/ci.yml:121-123` and thirteen more,
  `release.yml:57`, `:272`, with `11.0.x` alone at `:165` and `:373`, and `load-tests.yml:46`), so the
  compiler and the analyzers that interpret these blocks can move to any later 11.0 feature band or
  patch with no repo edit. Helpdesk compiles under `preview`, whose meaning moves with the SDK as
  well. That is not hypothetical: the IDE0051 suppressions record behavior that differs between SDK
  10.0.201 and the 10.0.104 the same comment names
  (`Infrastructure/DependencyInjection.Messaging.cs:187`).
- **Method to property inside a block is a binary break, and it does not look like one.** Both are
  members of the same block and the source edit is two words, but the emitted classic member changes
  from `Name(this T)` to `get_Name(T)` (`Domain/PublicAPI.Shipped.txt:180` beside `:465`, against
  `Application/PublicAPI.Shipped.txt:517` beside `:1927`). RS0017 catches the removal at build time in
  MMCA.Common; a consumer that had already compiled against the old member does not get that warning.
- **Analyzers do not fully understand the shape.** CA1708 is wrong on every block it flags (40
  type-level suppressions) and IDE0051 is wrong across the block boundary (eleven more). Each
  suppression is a place where a genuine future hit on that type is silenced too, and the IDE0051
  ones carry an explicit "remove this once Roslyn fixes it" that nothing enforces.
- **Anything reflecting over the assemblies has to special-case the marker attribute.** The
  architecture fitness rule already does
  (`Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:8`, `:184-187`). Any future
  rule, source generator or documentation tool that walks methods in a framework assembly inherits
  the same requirement, and the failure mode is a false positive on a body no developer wrote.
- **The public-API baselines are roughly doubled for this surface.** 396 shipped
  `.extension` lines sit alongside their `static ...(this ...)` counterparts, so a single new
  registration method costs two or three baseline lines instead of one, and a reviewer reading a
  baseline diff sees the same member twice.
- **The one package with no gate is the one with the least coverage.** `MMCA.Common.UI.Maui`'s three
  blocks (`UI.Maui/DependencyInjection.cs:37`, `UI.Maui/HostingDependencyInjection.cs:17`,
  `UI.Maui/WindowLifecycleExtensions.cs:24`) are
  excluded from RS0016/RS0017 (`Directory.Build.props:148`), so a reshape there would reach a
  published package without the text diff that protects the 24 packages whose extension surface is
  baselined.
- **The declaration reads as an instance method that is not one.**
  `public IServiceCollection AddApplication()` (`Application/DependencyInjection.cs:36`) has no
  visible receiver parameter; the receiver comes from the enclosing block header six lines up. That
  is the ergonomic benefit and the readability cost in the same line, and it is why eleven
  suppression justifications and two inline comments had to explain the block boundary in prose
  rather than point at a rule (`Infrastructure/DependencyInjection.Jobs.cs:145`,
  `Infrastructure/DependencyInjection.Messaging.cs:187`, `:240`, `:263`,
  `Testing.E2E/Infrastructure/PageExtensions.cs:23`, `:549`, `:566`, `:581`, `:607`, `:626`, `:642`,
  `Shared/Extensions/DomainHelper.cs:77`, `:106`).

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

## Revision (2026-10-19)
Re-verified against current source. No decision, rationale, count or trade-off changed; the Helpdesk
host the Context and Decision use as their example composes through `AddMmcaApplicationPipeline`.
1. `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs` no longer calls `services.AddApplication()`
   or `services.AddApplicationDecorators()` directly: both run inside
   `services.AddMmcaApplicationPipeline(...)` (`:121`). The Context lists `AddInfrastructure` (`:77`),
   `AddAPI` (`:99`) and the pipeline call (`:121`) instead, with the opt-ins at `:88`, `:89`, `:90`,
   `:104` and the broker registration as a `Register` step at `:139`; Decision point 6 uses the
   `AddInfrastructure` call site (`:77`) as its plain-extension example.

## Revision (2026-10-21)
Re-verified against current source. No decision, rationale or trade-off changed: the DI surface is
still written as `extension(T)` blocks under `LangVersion preview` and both emitted shapes are still
baselined. Three counts grew, one count in Trade-offs was made precise, and several anchors moved.
1. The `extension(IServiceCollection services)` blocks number 42 in 42 files (still thirteen
   packages), adding `Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:25`; a plain text
   search finds 46 hits, the four extra still being the justification strings at
   `Infrastructure/DependencyInjection.Messaging.cs:201`, `:224`, `:263` and
   `Infrastructure/DependencyInjection.Jobs.cs:145`.
2. The framework declares 117 `extension` blocks in 96 files under `MMCA.Common/Source` (anchored
   search, generic receivers included). `Aspire.Hosting/Extensions.cs` holds five of them
   (`:138`, `:253`, `:352`, `:422`, `:457`).
3. The shipped baselines hold 300 `.extension` lines (generic `.extension<T>(` lines included) in 17
   `PublicAPI.Shipped.txt` files, still none unshipped.
4. Trade-offs named "the other eighteen" projects behind the public-API gate. 21 Source projects
   carry a `PublicAPI.Shipped.txt` and are gated (every packable project except `MMCA.Common.UI.Maui`,
   `Directory.Build.props:111`), and 18 of them declare extension blocks, but the blocks in
   `Testing.Architecture` are internal (`Testing.Architecture/RuleHelpers.cs:14`), so the text diff
   protects 17 packages: the same 17 `PublicAPI.Shipped.txt` files that hold the 300 `.extension`
   lines in item 3. The text now names those 17 packages.
5. `IsCompilerSynthesized` in
   `Testing.Architecture/Rules/Domain/ArchitectureRules.DomainThrows.cs:184-187` now also skips
   explicit interface implementations on compiler-generated types; the `ExtensionMarkerAttribute`
   clause (`:185`) is unchanged.
6. Anchors re-verified against current source: `UI/DependencyInjection.cs:34` (block), `:40`
   (`AddUIShared`), `:30` (doc line); `Aspire/Extensions.cs:115`; the Helpdesk layer calls the Rationale
   cites at `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:77`, `:99`, `:121`;
   `MMCA.Common/Directory.Build.props:101-118` (gate block, rules at `:103-104`, item group and UI.Maui
   exclusion at `:111`, reason at `:107-109`); `Application/PublicAPI.Shipped.txt:1239` (classic
   `AddApplication`, block `:1239-1251` ending at `VerifyDecoratorPipeline`);
   `Domain/PublicAPI.Shipped.txt:113` and `:296`; the `DomainThrows` doc comment at `:166-183`;
   `dotnet-version: '10.0.x'` in `MMCA.Common/.github/workflows/release.yml` at `:50` and `:188` (the
   2026-10-07 entry's `:186` is superseded), plus `load-tests.yml:44`.

## Revision (2026-10-26)
Re-verified against current source. No decision or rationale changed: the DI surface is still written
as `extension(T)` blocks under `LangVersion preview` and both emitted shapes are still baselined. The
cloud vendor adapter packages (Azure, Aws, Gcp) and a persistence partial grew the framework counts
(the consumer block total and the IDE0051 count are unchanged), the
public-API baselines now hold unshipped extension lines, and several anchors moved.
1. The `extension(IServiceCollection services)` blocks number 46 in 46 files over sixteen packages,
   adding `Infrastructure/DependencyInjection.Persistence.cs:10`,
   `Azure/AzureServiceCollectionExtensions.cs:30`, `Aws/AwsServiceCollectionExtensions.cs:31` and
   `Gcp/GcpServiceCollectionExtensions.cs:28`; a plain text search finds 50 hits, the four extra still
   being the justification strings, now at `Infrastructure/DependencyInjection.Messaging.cs:187`,
   `:240`, `:263` and `Infrastructure/DependencyInjection.Jobs.cs:145`.
2. The framework declares 127 `extension` blocks in 106 files under `MMCA.Common/Source` (anchored
   search, generic receivers included); the consumer total of 41 is unchanged, so the Rationale reads
   127 plus 41.
3. The baselines hold 307 `.extension` lines in 19 `PublicAPI.Shipped.txt` files and 17 in
   `PublicAPI.Unshipped.txt` files (`Gcp` 10, `Aws` 6, `Infrastructure` 1), so "none unshipped" no
   longer holds. 25 Source projects now carry a `PublicAPI.Shipped.txt`, and 20 packages have a
   baselined extension surface (the 19 shipped files plus Gcp, whose extension lines are all
   unshipped); Trade-offs names 20.
4. CA1708 is suppressed in 30 files: 29 under `MMCA.Common/Source` (the new ones include the Azure,
   Aws and Gcp service-collection extensions) and one in ADC
   (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/PageObjects/Conference/Events/EventFilterPageExtensions.cs:12`);
   Store and Helpdesk have none. IDE0051 is still suppressed nine times across four files.
5. Anchors re-verified against current source: `Infrastructure/DependencyInjection.Messaging.cs:17`
   (block), `:186`, `:239`, `:262` (IDE0051 attributes); `Infrastructure/DependencyInjection.Notifications.cs:16`;
   `API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:342`;
   `UI.Web/Hardening/UiRateLimitingExtensions.cs:188`; `Grpc/DependencyInjection.cs:28`;
   `Aspire/Extensions.cs:136` (the 2026-10-21 entry's `:115` is superseded);
   `Aspire/Gateway/GatewayRateLimitingExtensions.cs:281`; `API/Startup/WebApplicationExtensions.cs:38`;
   `Aspire.Hosting/Extensions.cs:138`, `:353`, `:423`, `:458`; `MMCA.Common/Directory.Build.props:84-101`
   (gate comment and item group, rules described at `:86-87`, UI.Maui exclusion at `:94`, reason at
   `:90-92`); `Application/PublicAPI.Shipped.txt:1240` (classic `AddApplication`, block `:1240-1252`
   ending at `VerifyDecoratorPipeline`); `Domain/PublicAPI.Shipped.txt:115` and `:298`; the 10.0.104
   citation in Trade-offs at `Infrastructure/DependencyInjection.Messaging.cs:187`; and
   `dotnet-version: '10.0.x'` at `MMCA.Common/.github/workflows/ci.yml:101` plus twelve more.

## Revision (2026-10-28)
Re-verified against current source. No decision, rationale or trade-off changed: the DI surface is
still written as `extension(T)` blocks under `LangVersion preview` and both emitted shapes are still
baselined. The 46 `extension(IServiceCollection services)` blocks, the consumer total of 41 (ADC 20,
Store 18, Helpdesk 3) and the CA1708 and IDE0051 counts are unchanged; the v1.264.0 release moved the
baselines and added one framework block.
1. The framework declares 128 `extension` blocks in 107 files under `MMCA.Common/Source` (anchored
   search, generic receivers included). The new one is
   `UI.Web/Pwa/ServiceWorkerEndpointExtensions.cs:32`, on `IEndpointRouteBuilder`, so the DI count
   does not move; the Rationale reads 128 plus 41.
2. The release promoted every unshipped baseline line: the baselines hold 326 `.extension` lines in 20
   `PublicAPI.Shipped.txt` files (`API` 70 the largest; `Gcp` 10, `Aws` 9, `Azure` 10,
   `Infrastructure` 30), and every `PublicAPI.Unshipped.txt` holds only `#nullable enable`
   (`Gcp/PublicAPI.Unshipped.txt:1`). The 2026-10-26 entry's "17 unshipped" and "Gcp's is unshipped
   only" no longer hold; the 20 packages with a baselined extension surface are now all shipped.
   Gateway's shapes stay at `Gateway/PublicAPI.Shipped.txt:12` and `:98`.
3. Anchors re-verified against current source: `Application/PublicAPI.Shipped.txt:260` (container at
   `:259`) and the classic static `AddApplication` at `:1246`, so the classic block runs `:1246-1258`
   ending at `VerifyDecoratorPipeline` (the 2026-10-26 entry's `:1240-1252` is superseded).

## Revision (2026-11-23)
Re-verified against current source. The decision stands: the framework's DI surface is still
written as `extension(T)` blocks and both emitted shapes are still baselined. What moved is the
language and SDK footing under it, which the Context, the Decision headline, Decision point 1, the
Rationale and the first Trade-off described as `preview` on a floating 10.0.x SDK, and every count.
1. Common, Store and ADC now compile under `LangVersion 15.0`
   (`MMCA.Common/Directory.Build.props:18`, `MMCA.Store/Directory.Build.props:47`,
   `MMCA.ADC/Directory.Build.props:50`); only Helpdesk keeps `preview` in its root props
   (`MMCA.Helpdesk/Directory.Build.props:12`), and the two MMCA.Common build tools outside the
   solution (`build/facts/facts.csproj:13`, `build/perfgate/perfgate.csproj:13`) set `preview` on
   their own behind `MMCA.Common/build/Directory.Build.props:3-7`. The framework's blocks therefore compile under a
   released language version, and "compiling that requires a preview language version" no longer
   holds. The live text now names the version per repo.
2. All four `global.json` files now pin SDK `11.0.100` with `rollForward: latestFeature`
   (`MMCA.Common/global.json:2-5`) beside the Microsoft Testing Platform runner (`:6-8`), and CI
   installs `10.0.x` and `11.0.x` together (`MMCA.Common/.github/workflows/ci.yml:121-123`, fourteen
   sites in all; `release.yml:57`, `:272`, plus `11.0.x` alone at `:165`, `:373`; `load-tests.yml:46`).
   The first Trade-off now describes a pinned feature band that rolls forward within 11.0, not an
   unpinned 10.0.x SDK.
3. Common multi-targets `$(MmcaNetVersions)` (`MMCA.Common/Directory.Build.props:7`, `net10.0;net11.0`
   at `MMCA.Common/build/Frameworks.props:23`), and Store and ADC target `$(MmcaNet)`
   (`MMCA.Store/Directory.Build.props:39`, `MMCA.ADC/Directory.Build.props:42`); the Context no
   longer says every repo shares one `net10.0` target.
4. The `extension(IServiceCollection services)` blocks number 55 in 55 files over seventeen packages
   (Passkeys added), the new ones being `Application/DependencyInjection.ProcessManagers.cs:9`,
   `Application/DependencyInjection.Webhooks.cs:15`, `Infrastructure/DependencyInjection.FeatureFlags.cs:15`,
   `Infrastructure/DependencyInjection.MachineClients.cs:13`,
   `Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:21`,
   `Passkeys/PasskeysServiceCollectionExtensions.cs:12`, `Testing/Support/ServiceCollectionFakeExtensions.cs:11`,
   `UI/Services/Diagnostics/DependencyInjection.cs:14` and `UI/TwoFactor/DependencyInjection.cs:15`; a
   plain text search finds 59 hits, the four extra still being the justification strings.
5. The framework declares 154 `extension` blocks in 128 files under `MMCA.Common/Source` (anchored
   search, generic receivers included). `Aspire.Hosting/Extensions.cs` holds five, now on
   `IDistributedApplicationBuilder` (`:179`), a generic `IResourceBuilder<TResource>` (`:300`) and
   `IResourceBuilder<DotnetProjectResource>` (`:400`, `:473`, `:523`) rather than
   `IResourceBuilder<ProjectResource>`.
6. Consumers declare 42 blocks under `Source` (ADC's `Tests` tree adds one more, in
   `EventFilterPageExtensions.cs:34`): ADC 20 and Helpdesk 3 unchanged, Store 19 in 19 (up from 18). The
   Rationale reads 154 plus 42.
7. The baselines hold 396 `.extension` lines in 24 `PublicAPI.Shipped.txt` files (`API` 72 the
   largest; Passkeys, ServiceHost, Azure.Startup and Mcp newly baselined), still none unshipped, so
   24 packages carry a baselined extension surface.
8. CA1708 is suppressed in 40 files: 39 under `MMCA.Common/Source` and the same one in ADC; Store and
   Helpdesk have none. IDE0051 is suppressed by eleven `SuppressMessage` attributes across three
   files (seven in `Testing.E2E/Infrastructure/PageExtensions.cs`); `Shared/Extensions/DomainHelper.cs`
   no longer carries `#pragma` suppressions, only plain comments at `:77` and `:106`.
9. UI's DI class no longer repeats the "preview" wording: it says "Uses C# extension members"
   (`UI/DependencyInjection.cs:33`). Infrastructure's still says "C# preview extension types"
   (`Infrastructure/DependencyInjection.cs:41-42`).
10. Anchors re-verified against current source: the Helpdesk host at
    `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`, `:104`, `:105`, `:106`, `:116`,
    `:121`, `:138`, `:156`; `Application/DependencyInjection.cs:30` (method `:36`);
    `Infrastructure/DependencyInjection.cs:50` (method `:58`); `UI/DependencyInjection.cs:37` (method
    `:43`); `Infrastructure/DependencyInjection.Auth.cs:21`, `.Caching.cs:20`, `.Notifications.cs:18`;
    `API/Authentication/ExternalAuthExtensions.cs:38`; `API/Authorization/AuthorizationExtensions.cs:21`;
    `API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:357`;
    `UI/Services/Capabilities/DependencyInjection.cs:26`; `UI.Web/Hardening/UiRateLimitingExtensions.cs:208`;
    `UI.Maui/DependencyInjection.cs:37`; `Aspire/Extensions.cs:144`;
    `Aspire/Gateway/GatewayRateLimitingExtensions.cs:360`; `Gateway/RateLimiting/GatewayRoutePolicyExtensions.cs:51`;
    `Azure/AzureServiceCollectionExtensions.cs:33`, `Aws/AwsServiceCollectionExtensions.cs:32`,
    `Gcp/GcpServiceCollectionExtensions.cs:29`; `Testing.E2E/Infrastructure/PageExtensions.cs:81`
    and `:429`; `MMCA.Common/Directory.Build.props:138-147` (gate comment, rules at `:140-141`, UI.Maui
    reason at `:144-146`), `:148` (item group and UI.Maui exclusion), `:38` (RS0016/RS0017 stay at
    error), `:19` and `:25` (the two warnings-as-errors switches);
    `Application/PublicAPI.Shipped.txt:517` (container `:516`) and the classic `AddApplication` at
    `:1927`, so the classic block runs `:1927-1942` ending at `VerifyDecoratorPipeline`;
    `Gateway/PublicAPI.Shipped.txt:12` and `:108`; `Domain/PublicAPI.Shipped.txt:180` and `:465`.

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
