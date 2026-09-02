# ADR-103: bUnit Component-Test Tier as a Shipped Package

## Status
Accepted (2026-08-31).

## Context
Three test tiers in this workspace are decided in writing and one is not. ADR-015 gates **structure**
with NetArchTest. ADR-058 ships the **runtime conformance** suites as abstract bases in
`MMCA.Common.Testing` and scopes itself explicitly to contracts that only a booted host can prove
(`058-runtime-conformance-suites-as-a-package.md:22-25`). ADR-063 and ADR-092 ship the **browser**
tier as Playwright contracts and deploy gates (WCAG 2.1 AA scans, Core Web Vitals budgets). Between a
plain unit test over a handler and a Playwright run against a live stack sits the **component** tier:
render one Blazor page or component in process, drive it, assert on its markup. That tier exists in
all three code repos with a UI and was recorded nowhere. ADR-101 names the `Testing.*` packages only
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
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/MMCA.Common.Testing.UI.csproj:3-4`) is one of the
17 packages released in lockstep (`MMCA.Common/FACTS.md:19,37`), and its `BunitComponentTestBase`
fixes every choice above once, in one file.

- **bUnit v2, with the version-specific symbols isolated to this base.** The base derives from bUnit
  v2's `BunitContext`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:37`),
  and its remarks state why: v2 is the line compatible with xUnit v3 and Microsoft Testing Platform,
  and derived test classes call `RenderUnderTest` / `RenderAs` and never touch the version-specific
  symbols, so a move off that line changes this file and no other
  (`BunitComponentTestBase.cs:29-34`). The line is pinned at `bunit` 2.9.0 in each repo's central
  package file (`MMCA.Common/Directory.Packages.props:205-206`,
  `MMCA.ADC/Directory.Packages.props:31-32`, `MMCA.Store/Directory.Packages.props:51-52`), and the
  package carries a direct `AngleSharp` pin because central package management does not pin
  transitives (`MMCA.Common.Testing.UI.csproj:13-15`).
- **MudBlazor services plus the ADR-067 facades, registered once.** The constructor calls
  `Services.AddMudServices()` (`BunitComponentTestBase.cs:46`) and then
  `Services.AddCommonUiFacades()` (`:53`), which is the same call the production shell makes from
  `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:106`). That
  call registers `IToastService` -> `MudToastService` and `IAppDialogService` -> `MudAppDialogService`
  with `TryAdd` (`DependencyInjection.cs:158-163`), so a component test resolves the vendor-neutral
  facades and exercises the real Mud-backed path, and a test that wants a recording double registers
  one afterwards (last registration wins, `BunitComponentTestBase.cs:48-52`).
- **Loose JSInterop.** `JSInterop.Mode = JSRuntimeMode.Loose` (`:55`) so MudBlazor components that
  probe JS during render return default values instead of throwing (`:17-19`).
- **A mutable `AuthenticationStateProvider` that serves both consumption paths.** One
  `MutableAuthenticationStateProvider` instance is held by the base (`:42`), registered as the
  `AuthenticationStateProvider` singleton (`:58`), and implemented over a settable principal that
  notifies listeners (`:162-174`). `RenderAs` sets the principal and also adds the cascading
  `AuthenticationState`, so `<AuthorizeView>` and a directly injecting page agree (`:130-141`);
  `SetUser` changes it mid-test without a new render root (`:120-121`); the default is anonymous
  (`:39-40`, `:123-127`). Authorization is permissive but real: `IsAuthenticatedAuthorizationService`
  succeeds for an authenticated identity and fails otherwise (`:57`, `:176-186`). Principals come from
  the shipped `TestPrincipal` factory, which writes the user id under both `sub` and
  `ClaimTypes.NameIdentifier` because a real principal reaches a page under either name
  (`Infrastructure/TestPrincipal.cs:7,22-32`), plus an `Organizer` shorthand (`TestPrincipal.cs:35-36`).
- **Open-generic `IStringLocalizer` for ADR-027 markup.** `Services.AddLogging()` and
  `Services.AddLocalization()` (`BunitComponentTestBase.cs:63-64`) let every component test render
  localized markup against the neutral resources in the component's own assembly with no per-test
  setup (`:60-62`).
- **`SetRendererInfo` behind one helper, because its call ordering is load-bearing.**
  `ConfigureDataGridListPageHost` (`:100-118`) registers the list-page state services (`:105-106`),
  substitutes MudBlazor's `IBrowserViewportService` with an inert double so `IsMobile` stays
  deterministically false (`:110`, which is why `Moq` is a package dependency rather than a
  hand-written stub, `MMCA.Common.Testing.UI.csproj:17-21`), adds bUnit's persistent component state
  for the prerender boundary (`:114`), and calls `SetRendererInfo` **last** (`:117`). The rule is
  written where the helper is: `SetRendererInfo` builds and freezes the bUnit service provider, so any
  registration made after it is silently ignored and the page resolves the framework default instead
  of the test's double (`:78-82`). Nineteen test files across MMCA.Common, MMCA.ADC and MMCA.Store
  call the helper today; its comment records the fifteen hand-rolled copies of the block that the
  extraction replaced (`:81-82`).
- **The rest of the harness ships with it.** `RenderMudProviders` renders the popover, dialog and
  snackbar providers into the test's render root and returns handles (`:148-154`, `:157-160`);
  `BunitInteractionExtensions` expresses clicks and text reads over accessible text rather than CSS
  paths (`Infrastructure/BunitInteractionExtensions.cs:12-34`); `MarkupSnapshot` is a dependency-free
  golden-markup comparison that normalizes MudBlazor's per-render GUIDs
  (`Infrastructure/MarkupSnapshot.cs:21`); and the HTTP-facing doubles cover the UI service layer
  (`Infrastructure/UiHttpServiceHarness.cs:12`, `Infrastructure/CapturingHttpMessageHandler.cs:19`,
  `Infrastructure/StubTokenStorageService.cs:13`, `Infrastructure/HttpTestDoubles.cs:12`,
  `Infrastructure/ErrorSummaryExtensions.cs:10`).
- **Adoption is one thin repo-local subclass per test project.** Six consumer test projects take the
  package reference: ADC Conference, Identity and Engagement
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/MMCA.ADC.Conference.UI.Tests.csproj:12`,
  `.../Identity/MMCA.ADC.Identity.UI.Tests/MMCA.ADC.Identity.UI.Tests.csproj:12`,
  `.../Engagement/MMCA.ADC.Engagement.UI.Tests/MMCA.ADC.Engagement.UI.Tests.csproj:11`) and Store
  Catalog, Sales and Identity
  (`MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.UI.Tests/MMCA.Store.Catalog.UI.Tests.csproj:12`,
  `.../Sales/MMCA.Store.Sales.UI.Tests/MMCA.Store.Sales.UI.Tests.csproj:12`,
  `.../Identity/MMCA.Store.Identity.UI.Tests/MMCA.Store.Identity.UI.Tests.csproj:12`); MMCA.Common's
  own UI tests take it by project reference
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/MMCA.Common.UI.Tests.csproj:25`). Each repo's
  subclass carries only what its head owns and nothing shared: Store Catalog's is an empty declaration
  (`MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.UI.Tests/BunitTestBase.cs:11`), ADC
  Conference's adds the ADR-042 device-capability defaults and inert configuration
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:19-46`), and
  MMCA.Common's adds the layout-chrome services only its own tests render
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/BunitTestBase.cs:15-46`).

All six consumer projects sit in the gating CI subset, so the tier runs on every pull request rather
than on a schedule (`MMCA.ADC/MMCA.ADC.CI.slnf:43,49,55`,
`MMCA.Store/MMCA.Store.CI.slnf:40,46,52`). MMCA.Helpdesk has no UI test project (its three test
projects are Tickets domain, Tickets application, and architecture), so the tier is adopted exactly
where a Blazor UI exists.

## Rationale
- **The setup is what a component test gets wrong, so the setup is what the framework should own.**
  Every item in the Decision is a choice with one correct answer per repo and a failure mode that
  reads as a defect in the page under test. Shipping them as a base class turns "remember the six
  rules" into "inherit the base", the same invariant-over-discipline posture ADR-015 takes for
  structure and ADR-058 takes for runtime contracts.
- **One freeze rule, one call site.** The `SetRendererInfo` ordering constraint cannot be enforced by
  the compiler, so the next best thing is to have exactly one place that gets it right and a helper
  name that says when to call it (`BunitComponentTestBase.cs:74-82`).
- **The version boundary is a single file.** Isolating `BunitContext` and `Render<T>` behind
  `RenderUnderTest` / `RenderAs` means a bUnit line change is a framework edit, not a sweep across
  every UI test class in three repos (`:29-34`).
- **Test-time and run-time resolve the same facades.** Because the base calls the production
  `AddCommonUiFacades` rather than registering its own doubles (`:53`,
  `MMCA.Common.UI/DependencyInjection.cs:106,158-163`), a component test asserts against the real
  toast and dialog implementations ADR-067 put behind those interfaces, and a test that wants to
  assert on a toast opts into a double explicitly.
- **A package matches how every other shipped test tier is delivered.** Runtime conformance
  (ADR-058), accessibility (ADR-063) and web vitals (ADR-092) all ship as consumable contracts rather
  than as copied snippets, and a package inherits the lockstep release policy (ADR-016) so the tier
  moves with the framework it tests (`FACTS.md:15-17`).

## Trade-offs
- **Loose JSInterop proves nothing about JS.** A component test can render a component that calls a
  JS module which does not exist, because the loose mode answers with defaults
  (`BunitComponentTestBase.cs:55`). Only the browser tier (ADR-063, ADR-092) catches that.
- **Authorization in this tier answers on authentication, not on policy.** The shipped double succeeds
  for any authenticated principal (`:176-186`), so a component test cannot assert a permission
  denial; permission behavior belongs to the handler and API tiers.
- **The frozen-provider rule is a convention, not a compiler error.** Nothing fails a test that
  registers a service after `SetRendererInfo`; the symptom is the framework default resolving quietly
  in place of the double (`:78-82`), which is exactly the failure the helper exists to prevent and
  cannot prevent for a test that bypasses it.
- **Nothing enforces adoption.** No fitness rule requires a UI test project to subclass the shared
  base, so a new project can still re-derive the block; the only inventory is a search.
- **The base pulls MudBlazor and Moq into every consuming test project**
  (`MMCA.Common.Testing.UI.csproj:16,21`), so a repo that wanted a different mocking library in its UI
  tests still takes Moq transitively, and a non-MudBlazor UI could not use this base at all.
- **The bUnit version is pinned per repo, not by the package.** The package references `bunit` without
  a version (`MMCA.Common.Testing.UI.csproj:13`) and each consumer's central package file names the
  number (`MMCA.Common/Directory.Packages.props:206`, `MMCA.ADC/Directory.Packages.props:32`,
  `MMCA.Store/Directory.Packages.props:52`), so three files have to agree, and the AngleSharp advisory
  pin has to be repeated the same way.

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
