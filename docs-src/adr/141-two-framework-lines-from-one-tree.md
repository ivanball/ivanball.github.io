# ADR-141: Two .NET Framework Lines From One Source Tree (net10.0 and net11.0)

## Status
Accepted (2026-11-10); amended 2026-11-11 (decision 8: the MAUI head follows the application
switch). Builds on [ADR-016](016-lockstep-versioning-masstransit-pin.md): the lockstep
release policy is unchanged, and one package version now carries assets for two target frameworks.
Revised 2026-11-23: decision 5 reversed (EF Core and Npgsql now follow the framework, 11.0.0 on
`net11.0` since v1.315.0), the rollback line's cross-major EF Core gap added to the open items, and
anchors refreshed.

## Context
.NET 11 shipped on 2026-11-10. The workspace had one target framework, `net10.0`, named once per
repo. Three forces met on that day:

- MMCA.ADC wants the newer runtime in production, and MMCA.Store and MMCA.Helpdesk are not moving
  yet, so the framework packages must serve consumers on either framework from one release.
- The owner's decision is that .NET 10 stays a permanent, first-class second line rather than a
  migration step, in one branch, with no long-lived release branch per framework.
- The .NET 11 SDK adds analyzer rules that fail untouched `net10.0` code (CA1307 on single-character
  string calls, the Blazor BL0012, BL0013 and BL0016 rules, IDE0005 on a using that became
  implicit), so a repo cannot take the SDK without an analyzer pass in the same change.

Two facts found on a throwaway spike branch constrain the design. `Npgsql.EntityFrameworkCore.PostgreSQL`
had only a release candidate for EF Core 11, and that candidate pins EF Core to exactly its own
version. And the C# 15 `union` and `closed` features compile for `net11.0` only, because `net10.0`
lacks the runtime types the compiler needs.

## Decision

**1. Libraries multi-target; applications switch.**
MMCA.Common names its frameworks once, in `MMCA.Common/build/Frameworks.props:23-24`
(`MmcaNetVersions` = `net10.0;net11.0`, `MmcaDefaultNet` = `net11.0`), and every packaged library and
its tests build for both (`MMCA.Common/Directory.Build.props:7`). Projects that are run rather than
referenced build for the newest framework only (`Frameworks.props:27`); the benchmark harness is
held on the oldest because no stable BenchmarkDotNet recognizes `net11.0` (`Frameworks.props:33`).
The one MAUI package derives its platform targets from the same list, so it carries the four MAUI
platforms once per framework
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/MMCA.Common.UI.Maui.csproj:18`).

An application does not multi-target. MMCA.ADC has one switch, `MmcaNet`, defaulting to `net11.0`
and overridable by `-p:MmcaNet=net10.0` or an environment variable
(`MMCA.ADC/Directory.Build.props:17`, `:41-42`). Its hosts publish with no `-f` and each service
writes one committed OpenAPI document, so an application builds for exactly one framework at a time.

**2. Version-specific code is forward-only.**
Only `#if NET11_0_OR_GREATER` with the existing code as the `#else` branch, never `#if NET10_0`
(`Frameworks.props:11-17`). Retiring a framework is then: remove it from the list and delete the
`#else` branches. The two PRs that introduced the policy needed one conditional each
(`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:44`,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:125`); everything else was written in a form
valid on both frameworks. MMCA.Common now carries ten such conditionals in eight files: three in
source (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:75`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationHandler.cs:4`,
`:98`) and seven in tests. The `Program.cs:125` block is the only one in MMCA.ADC.

**3. The public API is identical on both frameworks.**
No new gate is needed for this. Every packable project except `MMCA.Common.UI.Maui` carries one
`PublicAPI.Shipped.txt` checked by RS0016 and RS0017 at error severity
(`MMCA.Common/Directory.Build.props:138-155`, the exclusion at `:148`), and the analyzer runs once
per target framework against that same file. A member present on one framework only fails the build
on the other. `MMCA.Common.UI.Maui` is outside the gate (`:144-146`), so its surface on its eight
targets is not checked this way. A deliberate framework-only member would need a per-framework
PublicAPI file; none exists.

**4. A package that follows the framework takes its version from a property.**
`MmcaFrameworkVersion` (10.0.15 / 11.0.0) covers ASP.NET Core and the runtime
`Microsoft.Extensions.*` packages; `MmcaOpenApiVersion` (2.13.1 / 3.11.1) covers `Microsoft.OpenApi`;
`MmcaMauiVersion` (10.0.130 / 11.0.10), `MmcaMauiToolkitVersion` (16.0.0 / 17.0.0) and
`MmcaAndroidBiometricVersion` (1.1.0.30 / 1.1.0.33) cover the MAUI train. `MmcaEfCoreVersion` and
`MmcaNpgsqlVersion` (decision 5), `MmcaExtensionsVersion`, `MmcaAspNetOAuthVersion` and
`MmcaSerilogAspNetCoreVersion` follow the same pattern (`MMCA.Common/Directory.Packages.props:45-68`).
Never a second `PackageVersion` item. A consumer that pins the same packages mirrors the properties
(`MMCA.ADC/Directory.Packages.props:38-53`).

**5. EF Core and Npgsql follow the framework (reversed 2026-11-23).**
`MmcaEfCoreVersion` is 10.0.15 on `net10.0` and 11.0.0 on `net11.0`, and `MmcaNpgsqlVersion` is
10.0.4 and 11.0.0 (`MMCA.Common/Directory.Packages.props:47-48`, `:59-60`). A `net11.0` host runs
EF Core 11; a `net10.0` host runs EF Core 10. This shipped as a breaking change for `net11.0`
consumers in v1.315.0 (`MMCA.Common/CHANGELOG.md:7-9`). MMCA.ADC mirrors the EF Core property
(`MMCA.ADC/Directory.Packages.props:40`, `:48`) and pins no Npgsql package.

**6. Both lines are gated.**
MMCA.Common's test projects run on both frameworks, one CI leg per framework
(`build-and-test-tfm`, `MMCA.Common/.github/workflows/ci.yml:100`, `:110`). MMCA.ADC adds a
required check, `build-and-test-net10` (`MMCA.ADC/.github/workflows/deploy.yml:559`), which restores from a second
lock file set (`packages.net10.0.lock.json`, `MMCA.ADC/Directory.Build.props:89`), builds with
analyzers at error severity, runs the same suites, and fails if the build did not target `net10.0`.

**7. The second line is deployable.**
`deploy.yml` takes a `runtime` input (`MMCA.ADC/.github/workflows/deploy.yml:23`, `:38`). Each
Dockerfile selects one of two digest-pinned runtime stages from one build argument
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Dockerfile:9`, `:20`, `:22`, `:24`). A build for
the second line pushes its commit tag only, never `:latest`, and uses its own build cache reference.

**8. The MAUI head follows the application switch (2026-11-11).**
MMCA.ADC's mobile head targets `$(MmcaNet)-android` and the other platforms
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MMCA.ADC.UI.csproj:8`), so the store build comes from the
default `net11.0` line and the second line still proves the head compiles on `net10.0`. The head has
a lock file per line like every other project. The Android target API level is pinned per line,
37 on `net11.0` and 36 on `net10.0` (`MMCA.ADC.UI.csproj:69-70`): each Android workload accepts only
its own level, and the .NET 11 one rejects 36.0 outright (NETSDK1140). Targeting 37 for the store
build, instead of compiling against 37 while still declaring 36, was the owner's choice.

## Rationale
One tree and one release line keep ADR-016 intact: there is still one version to bump and one sweep.
Multi-targeting is the right tool for a library, where each consumer picks an asset, and the wrong
one for an application, where the artifact (an image, a contract file) is singular. The forward-only
conditional makes the cost of the second line proportional to the number of places the frameworks
really differ: two when the policy landed, eleven conditional blocks across both repos today
(decision 2).

## Trade-offs
- MMCA.Common's test run roughly doubles, and both repos carry more lock file content (MMCA.ADC
  carries two sets).
- The two lines no longer share an EF Core major (decision 5). A `runtime=net10.0` rollback runs
  EF Core 10 against databases the `net11.0` line migrated with EF Core 11, and
  `build-and-test-net10` omits the EF model-drift gate
  (`MMCA.ADC/.github/workflows/deploy.yml:555-558`).
- The Blazor WebAssembly payload grew with the .NET 11 runtime: MMCA.ADC's compressed budget went
  from 5900 KB to 6510 KB (`MMCA.ADC/.github/workflows/deploy.yml:645`).
- The MAUI package builds eight targets instead of four, and its Android bindings need a version
  per framework (decision 4). `Xamarin.Firebase.Messaging` is held at 124.1.2 on both: the newer
  release fails restore on either MAUI line.
- The store build and the second line declare different Android target levels (decision 8), so a
  device pass on one line does not cover the other's Android behaviour.
- One analyzer rule is suppressed on the head's windows target only: the .NET 11 WinRT analyzer
  rejects a collection expression whose target is a read-only interface (CsWinRT1032), and the
  spellings that avoid it trip other rules.
- One toolchain: a repo that builds MMCA.Common from source needs the .NET 11 SDK. All four repos
  pin 11.0.100 (`MMCA.Store/global.json:3`); MMCA.Store and MMCA.Helpdesk still target `net10.0`
  (`MMCA.Store/Directory.Build.props:14`, `MMCA.Helpdesk/Directory.Build.props:9`).
- Both frameworks reach end of support on the same date, so the second line buys consumer choice,
  not a longer support window.

## Alternatives rejected
- **Hold the MAUI head on `net10.0`, or fix it on `net11.0` regardless of the switch**
  (2026-11-11). The hold needed a list of the projects the head references, each built for both
  frameworks; fixing it on `net11.0` keeps that list, mirrored, on the second line. Following the
  switch deletes the list. Revisit only if a `net10.0` mobile build must be made impossible.
- **Compile against Android API 37 but keep declaring target 36** (2026-11-11). It builds (one
  suppressed warning, XA1006) and would have changed the .NET version only. Rejected by the owner's
  decision in favor of one level per line; the cost is that the first `net11.0` store build also
  opts into Android 17 behaviour and needs the full device checklist.
- **Multi-target the application hosts** (2026-11-10). `dotnet publish` in the Dockerfiles passes
  no framework, and the build-time OpenAPI writer has one output path per host. Revisit only if a
  host ever needs to ship both frameworks in one artifact.
- **A long-lived branch per framework** (2026-11-10). Every fix would land twice. Rejected by the
  owner's decision; revisit only if the two lines diverge enough that shared source stops paying.
- **EF Core 11 on `net11.0`** (2026-11-10; superseded 2026-11-23). The only Npgsql provider was
  `11.0.0-rc.3`, which pins EF Core to that release candidate and fails restore against 11.0.0
  (NU1608). No longer rejected: a stable provider 11.0.0 exists, and the option is now decision 5.
- **`Result<T>` as a C# 15 union** (2026-11-10). Unions compile for `net11.0` only, so the type
  every handler returns would differ per framework, against decision 3. Revisit when `net10.0` is
  retired, with its own specification.
- **One OpenAPI document for both frameworks by normalizing the comparison** (2026-11-10).
  ASP.NET Core 11 stamps a different patch version, sorts tags and defaults to OpenAPI 3.2.
  MMCA.Common keeps one baseline per framework. The composed service-host start-up pins the
  specification version to 3.1
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:125-127`),
  and MMCA.ADC commits the default line's output only. The build-time generator ignores that option
  and is passed the version explicitly (`MMCA.ADC/Directory.Build.props:245`).
- **A cross-framework public-API fitness test** (2026-11-10). Redundant with decision 3: the
  existing analyzer already compares each framework against one file. Revisit when a per-framework
  PublicAPI file is introduced.
- **Disabling package pruning to clear the `net11.0` audit finding** (2026-11-10). It works but
  inflates every lock file. A `NuGetAuditSuppress` pair is used instead, for a finding that is
  `net11.0`-only. MMCA.Common declares the pair unconditionally, because NuGet requires identical
  suppressions across target frameworks (NU1105) (`MMCA.Common/Directory.Build.props:80-87`);
  MMCA.ADC, which builds one framework at a time, conditions its copy on `net11.0`
  (`MMCA.ADC/Directory.Build.props:322-325`). Both are removed when a
  `System.Security.Cryptography.Pkcs` 11.0.1 exists; the pin still follows `MmcaFrameworkVersion`
  (`MMCA.Common/Directory.Packages.props:285`).

## Consequences
- A consumer adopting `net11.0` needs: the SDK pin, an analyzer pass, the per-framework version
  properties, and, if it keeps the second line, a second lock file set excluded from the default
  content globs (`MMCA.ADC/Directory.Build.props:95`); without that exclusion the Web and Razor
  SDKs publish the file and fail on a duplicate path.
- A lock file regeneration in MMCA.ADC is two restores, the second with `-p:MmcaNet=net10.0`.
- A build compiler server left running across MAUI or second-line builds can report a wall of
  Razor errors on a clean tree; `dotnet build-server shutdown` clears it.
- Open: the first `net11.0` mobile build has not run on a device and has not been uploaded to a
  store. The `runtime=net10.0` deploy path has not been exercised against production, and with
  decision 5 that path would now run EF Core 10 against databases migrated by EF Core 11, a
  cross-major combination no gate covers (`MMCA.ADC/.github/workflows/deploy.yml:21`, `:555-558`).

## Revision (2026-11-23)
Re-verified against current source. Decisions 1 and 6 to 8 hold as written; decisions 2 to 4
hold in substance, with the text corrections in items 3 to 5; decision 5 is reversed, and several
anchors moved.

1. Decision 5 reversed. Its exit condition (a stable Npgsql provider 11.0.0) is met: the `net11.0`
   group sets `MmcaEfCoreVersion` and `MmcaNpgsqlVersion` to 11.0.0, while `net10.0` stays on
   10.0.15 and 10.0.4 (`MMCA.Common/Directory.Packages.props:47-48`, `:59-60`). Shipped as a
   breaking change in v1.315.0 (`MMCA.Common/CHANGELOG.md:7-9`); MMCA.ADC mirrors EF Core 11.0.0
   on `net11.0` (`MMCA.ADC/Directory.Packages.props:48`). The trade-off, the rejected alternative and
   the open item that depended on the hold are updated to match.
2. The two lines no longer share an EF Core major. The `build-and-test-net10` job still omits the
   EF model-drift gate on the premise that EF Core is the same on both
   (`MMCA.ADC/.github/workflows/deploy.yml:555-558`), and a `runtime=net10.0` rollback would run
   EF Core 10 against databases the `net11.0` line migrated. Added to Trade-offs and Open.
3. Decision 2: the conditional count moved. MMCA.Common has ten `#if NET11_0_OR_GREATER` blocks in
   eight files (source: `WebApplicationBuilderExtensions.cs:75`, `FallbackAuthorizationHandler.cs:4`,
   `:98`); MMCA.ADC has one (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:125`). Rationale
   updated to match.
4. Decision 3: `MMCA.Common.UI.Maui` is excluded from the PublicAPI gate
   (`MMCA.Common/Directory.Build.props:144-148`), so "every packable project" is narrowed.
5. Decision 4: `MmcaOpenApiVersion` is 2.13.1 / 3.11.1, and the list now names the other per-line
   properties (`MMCA.Common/Directory.Packages.props:45-68`).
6. The OpenAPI 3.1 pin lives in MMCA.Common's composed service-host start-up, not in each ADC
   `Program.cs` (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:125-127`;
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:80` keeps a bare `AddOpenApi()`).
7. The audit suppression pair is unconditional in MMCA.Common (NU1105) and `net11.0`-only in
   MMCA.ADC (`MMCA.Common/Directory.Build.props:80-87`, `MMCA.ADC/Directory.Build.props:322-325`).
   Its removal condition is not met (`MMCA.Common/Directory.Packages.props:285`).
8. The SDK pin and the target framework are cited separately: `MMCA.Store/global.json:3` is the
   pin, `MMCA.Store/Directory.Build.props:14` and `MMCA.Helpdesk/Directory.Build.props:9` the target.
9. Anchors re-verified against current source: `MMCA.ADC/Directory.Build.props:17`, `:41-42`,
   `:89`, `:95`, `:245`; `MMCA.ADC/Directory.Packages.props:38-53`;
   `MMCA.ADC/.github/workflows/deploy.yml:559`, `:645`;
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Dockerfile:9`, `:20`, `:22`, `:24`;
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MMCA.ADC.UI.csproj:69-70`;
   `MMCA.Common/Directory.Build.props:138-155`; `MMCA.Common/.github/workflows/ci.yml:100`, `:110`.
