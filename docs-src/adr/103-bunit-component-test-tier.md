# ADR-103: bUnit Component-Test Tier as a Shipped Package

## Status
Accepted (2026-08-31). Revised 2026-09-03: one trade-off overstated how far the `AngleSharp` advisory
pin travels. See Revision (2026-09-03) at the end. Revised 2026-09-19: four drifted facts refreshed
(the `bunit` pin, the `TestPrincipal` role shorthand, the helper's call-site count, and the lockstep
package count). See Revision (2026-09-19) at the end. Revised 2026-10-01 (the base now registers the
real authorization service, so a component test can assert a role denial; see Revision below).
Revised 2026-10-06: the helper's call-site count refreshed and two omitted registrations recorded (the
base's `ViewerTimeZone` default and the ADC Conference subclass's inert event lookup). See Revision
(2026-10-06) at the end. Revised 2026-10-07: anchors refreshed after the v1.233.0 release. See Revision
(2026-10-07) at the end.

## Context
Three test tiers in this workspace are decided in writing and one is not. ADR-015 gates **structure**
with NetArchTest. ADR-058 ships the **runtime conformance** suites as abstract bases in
`MMCA.Common.Testing` and scopes itself explicitly to contracts that only a booted host can prove
(`058-runtime-conformance-suites-as-a-package.md:12-16,24-27`). ADR-063 and ADR-092 ship the **browser**
tier as Playwright contracts and deploy gates (WCAG 2.1 AA scans, Core Web Vitals budgets). Between a
plain unit test over a handler and a Playwright run against a live stack sits the **component** tier:
render one Blazor page or component in process, drive it, assert on its markup. That tier exists in
three of the four code repos with a Blazor UI and was recorded nowhere. ADR-101 names the `Testing.*` packages only
to keep them out of the metapackage (`101-common-metapackage.md:55`), which decides their packaging
and nothing about the tier itself.

A component test is cheap to write and expensive to set up, and the expensive part is not per test.
It is a fixed set of choices that is the same answer in every repo: which bUnit line, which component
vendor's services, whether JSInterop is strict or loose, how a principal reaches both
`<AuthorizeView>` and a page that injects `AuthenticationStateProvider` directly, how
`IStringLocalizer<T>` resolves for ADR-027 markup, and when the renderer info is set. Getting one of
them wrong does not fail as a setup error: it fails as what looks like a bug in the page under test.
An unresolvable `IToastService`, a viewport that no browser answers so the card/grid choice comes down
to timing, or a test double silently replaced by the framework default because its registration ran
after the bUnit provider was frozen.

## Decision
Ship the component-test tier as a package. `MMCA.Common.Testing.UI`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/MMCA.Common.Testing.UI.csproj:3`) is one of the
`MMCA.Common.*` packages released in lockstep (`MMCA.Common/FACTS.md:19,42`), and its `BunitComponentTestBase`
fixes every choice above once, in one file.

- **bUnit v2, with the version-specific symbols isolated to this base.** The base derives from bUnit
  v2's `BunitContext`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:38`),
  and its remarks state why: v2 is the line compatible with xUnit v3 and Microsoft Testing Platform,
  and derived test classes call `RenderUnderTest` / `RenderAs` and never touch the version-specific
  symbols, so a move off that line changes this file and no other
  (`BunitComponentTestBase.cs:30-35`). The line is pinned at `bunit` 2.11.3 in each repo's central
  package file (`MMCA.Common/Directory.Packages.props:234-235`,
  `MMCA.ADC/Directory.Packages.props:32`, `MMCA.Store/Directory.Packages.props:54`), and the
  package carries a direct `AngleSharp` pin because central package management does not pin
  transitives (`MMCA.Common.Testing.UI.csproj:15-17`).
- **MudBlazor services plus the ADR-067 facades, registered once.** The constructor calls
  `Services.AddMudServices()` (`BunitComponentTestBase.cs:47`) and then
  `Services.AddCommonUiFacades()` (`:54`), which is the same call the production shell makes from
  `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:159`). That
  call registers `IToastService` -> `MudToastService` and `IAppDialogService` -> `MudAppDialogService`
  with `TryAdd` (`DependencyInjection.cs:227-230`), so a component test resolves the vendor-neutral
  facades and exercises the real Mud-backed path, and a test that wants a recording double registers
  one afterwards (last registration wins, `BunitComponentTestBase.cs:49-53`).
- **Loose JSInterop.** `JSInterop.Mode = JSRuntimeMode.Loose` (`:56`) so MudBlazor components that
  probe JS during render return default values instead of throwing (`:18-19`).
- **A mutable `AuthenticationStateProvider` that serves both consumption paths.** One
  `MutableAuthenticationStateProvider` instance is held by the base (`:43`), registered as the
  `AuthenticationStateProvider` singleton (`:64`), and implemented over a settable principal that
  notifies listeners (`:173-185`). `RenderAs` sets the principal and also adds the cascading
  `AuthenticationState`, so `<AuthorizeView>` and a directly injecting page agree (`:140-152`);
  `SetUser` changes it mid-test without a new render root (`:132`); the default is anonymous
  (`:41`, `:134-138`). Authorization is the real service: after `AddAuthorizationCore` (`:57`) the
  base registers `DefaultAuthorizationService` explicitly, because bUnit pre-registers a placeholder
  that throws and `AddAuthorizationCore` only TryAdds (`:59-63`). It evaluates what a view builds (its
  `Roles` and the default deny-anonymous policy), so a component test can assert a role denial
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/BunitComponentTestBaseAuthorizationTests.cs:16`).
  Principals come from
  the shipped `TestPrincipal` factory, which writes the user id under both `sub` and
  `ClaimTypes.NameIdentifier` because a real principal reaches a page under either name
  (`Infrastructure/TestPrincipal.cs:7,22-32`), plus an `InRole(role, userId)` shorthand for a
  single-role principal. The framework declares no role vocabulary of its own, so a test names the
  role its app uses (`TestPrincipal.cs:41`).
- **Open-generic `IStringLocalizer` for ADR-027 markup.** `Services.AddLogging()` and
  `Services.AddLocalization()` (`BunitComponentTestBase.cs:69-70`) let every component test render
  localized markup against the neutral resources in the component's own assembly with no per-test
  setup (`:66-68`). The base also registers `TimeProvider.System` with `TryAdd`, so a test that drives
  time registers its own clock (`:72-76`), and registers the `ViewerTimeZone` service the
  notification and session pages format instants with, also with `TryAdd`; under loose JSInterop its
  browser read returns null, so those pages render in UTC unless a test sets up the `getTimeZone`
  call itself (`:78-81`).
- **`SetRendererInfo` behind one helper, because its call ordering is load-bearing.**
  `ConfigureDataGridListPageHost` (`:111-129`) registers the list-page state services (`:116-117`),
  substitutes MudBlazor's `IBrowserViewportService` with an inert double so `IsMobile` stays
  deterministically false (`:121`, which is why `Moq` is a package dependency rather than a
  hand-written stub, `MMCA.Common.Testing.UI.csproj:19-23`), adds bUnit's persistent component state
  for the prerender boundary (`:125`), and calls `SetRendererInfo` **last** (`:128`). The rule is
  written where the helper is: `SetRendererInfo` builds and freezes the bUnit service provider, so any
  registration made after it is silently ignored and the page resolves the framework default instead
  of the test's double (`:89-93`). Thirty-two test files across MMCA.Common, MMCA.ADC and MMCA.Store
  call the helper today (three in MMCA.Common, nineteen in MMCA.ADC, ten in MMCA.Store); its comment
  records the fifteen hand-rolled copies of the block that the extraction replaced (`:92-93`).
- **The rest of the harness ships with it.** `RenderMudProviders` renders the popover, dialog and
  snackbar providers into the test's render root and returns handles (`:154-165`, `:168-171`);
  `BunitInteractionExtensions` expresses clicks and text reads over accessible text rather than CSS
  paths (`Infrastructure/BunitInteractionExtensions.cs:12-34`); `MarkupSnapshot` is a dependency-free
  golden-markup comparison that normalizes MudBlazor's per-render GUIDs
  (`Infrastructure/MarkupSnapshot.cs:21`); and the HTTP-facing doubles cover the UI service layer
  (`Infrastructure/UiHttpServiceHarness.cs:12`, `Infrastructure/CapturingHttpMessageHandler.cs:20`,
  `Infrastructure/StubTokenStorageService.cs:13`, `Infrastructure/HttpTestDoubles.cs:12`,
  `Infrastructure/ErrorSummaryExtensions.cs:10`).
- **Adoption is a thin repo-local subclass, or the shipped base directly.** Six consumer test projects take the
  package reference: ADC Conference, Identity and Engagement
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/MMCA.ADC.Conference.UI.Tests.csproj:12`,
  `.../Identity/MMCA.ADC.Identity.UI.Tests/MMCA.ADC.Identity.UI.Tests.csproj:12`,
  `.../Engagement/MMCA.ADC.Engagement.UI.Tests/MMCA.ADC.Engagement.UI.Tests.csproj:11`) and Store
  Catalog, Sales and Identity
  (`MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.UI.Tests/MMCA.Store.Catalog.UI.Tests.csproj:12`,
  `.../Sales/MMCA.Store.Sales.UI.Tests/MMCA.Store.Sales.UI.Tests.csproj:12`,
  `.../Identity/MMCA.Store.Identity.UI.Tests/MMCA.Store.Identity.UI.Tests.csproj:12`); MMCA.Common's
  own UI tests take it by project reference
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/MMCA.Common.UI.Tests.csproj:27`). Each repo's
  subclass carries only what its head owns and nothing shared: Store Catalog's is an empty declaration
  (`MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.UI.Tests/BunitTestBase.cs:11`), ADC
  Conference's adds the ADR-042 device-capability defaults, inert configuration and the services its
  pages inject (public link builder, session schedule, HTTP client settings, an inert session-asset
  service, an inert event lookup), plus a `TimeProvider.System` registration (`:45`) that repeats the
  base's own TryAdd default
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:24-68`), and
  MMCA.Common's adds the layout-chrome services only its own tests render
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/BunitTestBase.cs:25-42`). ADC Engagement has
  no subclass: its test classes derive from `BunitComponentTestBase` directly
  (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/SessionLiveQuestionPanelTests.cs:20`).

All six consumer projects sit in the gating CI subset, so the tier runs on every pull request rather
than on a schedule (`MMCA.ADC/MMCA.ADC.CI.slnf:43,50,56`,
`MMCA.Store/MMCA.Store.CI.slnf:40,46,52`). MMCA.Helpdesk has a Blazor UI host on MudBlazor and
`MMCA.Common.UI` (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/MMCA.Helpdesk.UI.Web.csproj:1,3,11`)
but no UI test project (its three test projects are Tickets domain, Tickets application, and
architecture), so the tier is adopted in three of the four repos with a Blazor UI.

## Rationale
- **The setup is what a component test gets wrong, so the setup is what the framework should own.**
  Every item in the Decision is a choice with one correct answer per repo and a failure mode that
  reads as a defect in the page under test. Shipping them as a base class turns "remember the six
  rules" into "inherit the base", the same invariant-over-discipline posture ADR-015 takes for
  structure and ADR-058 takes for runtime contracts.
- **One freeze rule, one call site.** The `SetRendererInfo` ordering constraint cannot be enforced by
  the compiler, so the next best thing is to have exactly one place that gets it right and a helper
  name that says when to call it (`BunitComponentTestBase.cs:84-103`).
- **The version boundary is a single file.** Isolating `BunitContext` and `Render<T>` behind
  `RenderUnderTest` / `RenderAs` means a bUnit line change is a framework edit, not a sweep across
  every UI test class in three repos (`:30-35`).
- **Test-time and run-time resolve the same facades.** Because the base calls the production
  `AddCommonUiFacades` rather than registering its own doubles (`:54`,
  `MMCA.Common.UI/DependencyInjection.cs:159,227-230`), a component test asserts against the real
  toast and dialog implementations ADR-067 put behind those interfaces, and a test that wants to
  assert on a toast opts into a double explicitly.
- **A package matches how every other shipped test tier is delivered.** Runtime conformance
  (ADR-058), accessibility (ADR-063) and web vitals (ADR-092) all ship as consumable contracts rather
  than as copied snippets, and a package inherits the lockstep release policy (ADR-016) so the tier
  moves with the framework it tests (`FACTS.md:15-17`).

## Trade-offs
- **Loose JSInterop proves nothing about JS.** A component test can render a component that calls a
  JS module which does not exist, because the loose mode answers with defaults
  (`BunitComponentTestBase.cs:56`). Only the browser tier (ADR-063, ADR-092) catches that.
- **Authorization in this tier answers on what the view declares, not on the permission registry.**
  The real `DefaultAuthorizationService` evaluates a view's `Roles` and the default deny-anonymous
  policy (`:59-63`), so a component test can assert a role denial, but a render never runs the
  application's permission checks; permission behavior belongs to the handler and API tiers.
- **The frozen-provider rule is a convention, not a compiler error.** Nothing fails a test that
  registers a service after `SetRendererInfo`; the symptom is the framework default resolving quietly
  in place of the double (`:89-93`), which is exactly the failure the helper exists to prevent and
  cannot prevent for a test that bypasses it.
- **Nothing enforces adoption.** No fitness rule requires a UI test project to subclass the shared
  base, so a new project can still re-derive the block; the only inventory is a search.
- **The base pulls MudBlazor and Moq into every consuming test project**
  (`MMCA.Common.Testing.UI.csproj:18,23`), so a repo that wanted a different mocking library in its UI
  tests still takes Moq transitively, and a non-MudBlazor UI could not use this base at all.
- **The bUnit version is pinned per repo, not by the package.** The package references `bunit` without
  a version (`MMCA.Common.Testing.UI.csproj:15`), and every consuming test project references `bunit`
  directly as well
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/MMCA.ADC.Conference.UI.Tests.csproj:10`),
  so each repo's central package file names the number
  (`MMCA.Common/Directory.Packages.props:235`, `MMCA.ADC/Directory.Packages.props:32`,
  `MMCA.Store/Directory.Packages.props:54`) and three files have to agree. The `AngleSharp` advisory
  pin does not spread that way: it is named once, in `MMCA.Common/Directory.Packages.props:240`, and
  reaches consumers transitively through the package's own direct reference
  (`MMCA.Common.Testing.UI.csproj:17`).

## Related
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (the runtime conformance tier this sits
below: same delivery shape, different question, and its bases need a booted host where these need
only a renderer), [ADR-063](063-accessibility-conformance-gate.md) and
[ADR-092](092-web-vitals-budget-gate.md) (the browser tier above, which owns everything loose
JSInterop and a stubbed viewport cannot see), [ADR-067](067-ui-module-shell-composition.md) (the shell
and the `IToastService` / `IAppDialogService` facades this base registers through the production
`AddCommonUiFacades` call), [ADR-027](027-multi-locale-i18n.md) (the localized markup the open-generic
`IStringLocalizer` registration lets a component test render),
[ADR-042](042-device-capability-abstraction.md) (the capability defaults a consumer subclass adds on
top), [ADR-101](101-common-metapackage.md) (why this package stays outside the `MMCA.Common`
metapackage), [ADR-015](015-architecture-fitness-functions.md) (the structural tier below) and
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release the package rides).

## Revision (2026-09-03)
**The decision and the mechanism are unchanged.** One trade-off's premise was wrong. "The bUnit
version is pinned per repo" said the `AngleSharp` advisory pin has to be repeated across the three
central package files the way the `bunit` version is. It does not. `bunit` is named in all three
(`MMCA.Common/Directory.Packages.props:206`, `MMCA.ADC/Directory.Packages.props:31`,
`MMCA.Store/Directory.Packages.props:51`) because every consuming UI test project takes a direct
`bunit` reference of its own
(`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/MMCA.ADC.Conference.UI.Tests.csproj:10`).
`AngleSharp` is named only in MMCA.Common (`MMCA.Common/Directory.Packages.props:210`), where it
versions the package's own direct reference (`MMCA.Common.Testing.UI.csproj:15`); no consumer repo
pins it in a central package file or a project file, so consumers inherit the patched version with
the package. The trade-off now says so. Citation anchors elsewhere in the record were refreshed at
the same time with no change of substance.

## Revision (2026-09-19)
**The decision and the mechanism are unchanged.** Four facts had drifted since the record was
written. The `bunit` line is now pinned at 2.11.3, not 2.9.0, and all three central package files
still agree on that number (`MMCA.Common/Directory.Packages.props:233`,
`MMCA.ADC/Directory.Packages.props:31`, `MMCA.Store/Directory.Packages.props:55`). `TestPrincipal`
no longer carries an ADC-specific `Organizer` shorthand: it exposes a generic
`InRole(string role, string userId = "1")` whose remarks state that the framework declares no role
vocabulary, so a test names the role its own app uses
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:34-42`).
`ConfigureDataGridListPageHost` now has twenty-two calling test files, not nineteen (two in
MMCA.Common, twelve in MMCA.ADC, eight in MMCA.Store). The lockstep package count is no longer
restated here at all, because `MMCA.Common/FACTS.md` owns it and the number moves with every new
package. The `AngleSharp` claim from the 2026-09-03 revision was re-checked and still holds: the pin
is named only in MMCA.Common's central package file and in no consumer repo's.

## Revision (2026-10-01)
**The authorization mechanism changed; the rest of the decision is unchanged.** The base no longer
registers a permissive `IsAuthenticatedAuthorizationService`. After `AddAuthorizationCore` it registers
the real `DefaultAuthorizationService`, because bUnit pre-registers a throwing placeholder and
`AddAuthorizationCore` only TryAdds; the real service evaluates a view's `Roles` and the default
deny-anonymous policy, where a permissive double authorized every authenticated principal
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:56-62`).
A shipped test pins it: a principal outside an `<AuthorizeView>`'s role is denied
(`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/BunitComponentTestBaseAuthorizationTests.cs:16`).
The Decision bullet and the authorization trade-off now say so: a component test can assert a role
denial, and only the application's permission checks stay with the handler and API tiers.

Four facts were also corrected. The base registers `TimeProvider.System` with `TryAdd`
(`BunitComponentTestBase.cs:71-75`). `ConfigureDataGridListPageHost` has twenty-five calling test files,
not twenty-two (two in MMCA.Common, fifteen in MMCA.ADC, eight in MMCA.Store). ADC Engagement has no
repo-local subclass; its test classes derive from the shipped base directly
(`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/SessionLiveQuestionPanelTests.cs:20`).
MMCA.Helpdesk does have a Blazor UI host
(`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/MMCA.Helpdesk.UI.Web.csproj:1,3,11`) with no
component tests, so the tier is in three of the four repos with a Blazor UI, not in every one. Two
omissions are recorded here rather than added to the inventory: the package also ships shared
page-test bases under `Pages/` (`ConfirmEmailPageTestsBase`, `RoleAdminEditPageTestsBase`,
`RoleAdminListPageTestsBase`), and for them it carries `AwesomeAssertions` and `xunit.v3.extensibility.core`
into every consuming test project alongside MudBlazor and Moq (`MMCA.Common.Testing.UI.csproj:22-25`). Citation anchors in the current-state sections were
refreshed (`BunitComponentTestBase.cs`, `DependencyInjection.cs:121,181-184`, the three central
package files, `FACTS.md:42`, `MMCA.ADC.CI.slnf:43,50,56`, the ADC Conference subclass at
`BunitTestBase.cs:25-61`, ADR-058).

## Revision (2026-10-06)
**The decision and the mechanism are unchanged.** Three facts were corrected.
- `ConfigureDataGridListPageHost` has thirty-two calling test files, not twenty-five (three in
  MMCA.Common, nineteen in MMCA.ADC, ten in MMCA.Store).
- The base also registers `ViewerTimeZone` with `TryAdd`; under loose JSInterop its browser read
  returns null, so pages that format instants with it render in UTC unless a test sets up
  `getTimeZone`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:78-81`).
- The ADC Conference subclass also registers an inert `IEventLookupService`
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:67`), so its
  inventory now lists it. The facts recorded in the 2026-10-01 revision now sit at
  `BunitComponentTestBase.cs:57-63` (authorization) and `:72-76` (`TimeProvider`).

Citation anchors in the current-state sections were re-verified against current source and refreshed
(`BunitComponentTestBase.cs`, `MMCA.Common.Testing.UI.csproj`, `DependencyInjection.cs:159,227-230`,
`MMCA.Common/Directory.Packages.props:234-235,240`, `MMCA.Common.UI.Tests.csproj:27`, the ADC
Conference subclass at `BunitTestBase.cs:24-68`).

## Revision (2026-10-07)
**The decision and the mechanism are unchanged.** Re-verified against current source: `bunit` is
still pinned at 2.11.3 in all three central package files, and the `AngleSharp` pin is still named
only in MMCA.Common's. Only the MMCA.Store anchor for the `bunit` pin moved.
1. Anchors re-verified against current source: `MMCA.Store/Directory.Packages.props:54` (was `:58`,
   in the Decision bullet and the per-repo pin trade-off), `MMCA.Common/Directory.Packages.props:234-235,240`
   and `MMCA.ADC/Directory.Packages.props:32` (unchanged).
