# ADR-063: WCAG 2.1 AA Accessibility as a Shipped Test Contract and CI Gate

## Status
Accepted (2026-08-01). Revised 2026-08-14: refreshed the `E2ETestBase` helper line anchors (explanatory
comments were added above `ScanGridAsync`), the two consumer suite scan counts (ADC now 31, Store now 23),
and the MMCA.Helpdesk pin location. Revised 2026-08-23: the forgot-password vertical
([ADR-091](091-cache-backed-password-reset.md)) added a fourth asserting Identity workflow base and three
gallery assertions, so the base count, the gallery count (now eleven assertions across seven classes), and
both consumer subclass counts are updated, along with a correction to ADC's grid/strict split; no decision
changed. Revised 2026-08-31: a signed-in devices/sessions page scan joined the gallery (now twelve
assertions across eight classes), and the `PageExtensions`, ADC/Store `deploy.yml`, and MMCA.Helpdesk pin
line anchors are refreshed; no decision changed.

## Context
Accessibility was documented before it was enforced. The narrative guide
([common-ACCESSIBILITY.md](../guides/common-ACCESSIBILITY.md), rubric section 21) named WCAG 2.1 AA
as the target for the shared `MMCA.Common.UI` surface and listed the pages that had been checked, but
a guide cannot fail a build. That left three open problems.

First, the **target itself was ambiguous**. "Run axe" is not a contract: axe ships advisory
"best-practice" rules alongside the WCAG rule sets, so two repos running the same tool with different
options measure different things and disagree about whether a page passes.

Second, **conformance is a property of rendered pixels and the accessibility tree**, not of code
structure. ADR-015's fitness functions gate structure (layer references, purity) and ADR-058's
conformance bases gate a booted host's runtime contracts (ProblemDetails, OpenAPI, security headers).
Neither can see a contrast ratio or a missing accessible name. This tier needs a real browser engine,
which means it belongs in the E2E package rather than in either of those.

Third, **the regressions are silent and come from shared values**. A theme token changed for visual
reasons can drop a filled button's label under the 4.5:1 floor across every consuming app at once,
and nobody notices until a user reports it. Accessibility only stays true if the check runs on the
same schedule as the code that can break it.

## Decision
Ship WCAG 2.1 AA as a **named, versioned test contract in `MMCA.Common.Testing.E2E`**, assert it from
the package's own workflow bases, and wire it as a required merge check and a deploy gate.

- **One named target, shipped in the package.** `AxeOptions.Wcag21Aa`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:17`) pins every
  scan to a `RunOnly` tag list of exactly `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (`:22`): levels A
  and AA across WCAG 2.0 and 2.1. axe's "best-practice" rules are deliberately outside the target
  (`:12-15`), so the gate fails only on conformance violations, never on advisories.
- **A violation is a thrown test failure, not a report.**
  `AssertNoAccessibilityViolationsAsync(AxeRunOptions?)`
  (`.../Testing.E2E/Infrastructure/PageExtensions.cs:307`) runs axe and, on any violation, throws
  `AccessibilityViolationException` (`:330`; the type is
  `.../Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`) carrying each rule's impact,
  id, help text, and the offending markup compacted to one line per node (`:320-328`), so a red gate
  points at the element rather than at a dashboard.
- **The package's Identity workflow bases assert it, so a consumer inherits the scan.** Four bases carry
  the assertion, so a subclass gets a login-page, register-page, profile-page, forgot-password-page, and
  reset-password-page a11y test with no test code of its own:
  `.../Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:83`,
  `UserRegistrationTestsBase.cs:91`, `ProfileManagementTestsBase.cs:180`, and
  `PasswordResetTestsBase.cs` (class at `:17`, the two scans asserting at `:88` and `:99`, added with the
  password-recovery flow of [ADR-091](091-cache-backed-password-reset.md)) each call the assert with
  `AxeOptions.Wcag21Aa`.
- **Consumer page scans go through two helpers that make strictness explicit.** On
  `.../Testing.E2E/Infrastructure/E2ETestBase.cs`, `ScanAsync()` (`:293`) waits for any loading bar to
  clear and asserts the strict options (`:296`); `ScanGridAsync()` (`:283`) additionally waits for a
  seeded data row before scanning and asserts with the one recorded exception (`:288`). Which helper a
  page uses is the declaration of which rule set applies to it.
- **Exactly one recorded exception exists, and it is a value, not a switch.**
  `AxeOptions.Wcag21AaExceptMudPagerCombobox` (`AxeOptions.cs:35`) carries the same four WCAG tags
  (`:40`) and disables a single rule, `aria-input-field-name` (`:44`). It exists for pages whose only
  combobox is MudBlazor's own `MudTablePager` "rows per page" select: MudBlazor 9.6.0 mirrored combobox
  semantics onto the MudSelect presenter but gives the pager's select no accessible name, and
  `MudTablePager` exposes no `Label`/`aria-label` parameter, so it is not fixable from app markup
  (`:26-33`). Every other WCAG 2.1 AA rule still runs on those pages.
- **Common gates it cross-browser as a required merge check.** The `ui-e2e` job
  (`MMCA.Common/.github/workflows/ci.yml:228`) builds the out-of-slnx gallery plus E2E project and runs
  the axe scans across a `chromium, firefox, webkit` matrix (`:237`), one engine per leg via
  `E2E_BROWSER` (`:298`), with `fail-fast: false` so each engine reports independently (`:235`). All
  three contexts block merges (`MMCA.Common/CONTRIBUTING.md:63-64`, enumerated in the branch-protection
  payload at `:174-176`).
- **Both deployed apps gate the deploy on it.** `MMCA.ADC/.github/workflows/deploy.yml:636` and
  `MMCA.Store/.github/workflows/deploy.yml:592` call the reusable `e2e.yml` workflow chromium-only
  (ADC `:638`, Store `:594`) against the full Aspire stack, and the `deploy` job waits on that gate
  (ADC `:992`, Store `:941`).
- **The gate already owns design-token decisions.** Contrast values in the shared theme are set to
  what the scan will accept, with the ratio recorded in place: light-palette `WarningContrastText`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:33`, rationale at `:29-32`,
  caught by a gated admin-order-list scan on a chip), dark-palette `PrimaryContrastText` (`:58`,
  rationale at `:55-57`, caught by the gated dark-mode scan), dark `WarningContrastText` (`:67`) and
  `ErrorContrastText` (`:71`), and the brand secondary itself, moved to Teal 700 for a 5.3:1 light
  surface ratio (`.../MMCA.Common.UI/Theme/BrandColors.cs:26`, rationale at `:22-24`).

Adoption differs per repo and is uneven on purpose. **MMCA.Common** scans its own backend-less gallery:
twelve assertions across eight classes over `GalleryAxeTestBase`
(`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryAxeTestBase.cs:14`),
covering login (`LoginPageE2ETests.cs:34`), register (`RegisterPageE2ETests.cs:36`), the primitives
showcase (`ComponentsPageE2ETests.cs:80`), both dark-mode states (`DarkModeE2ETests.cs:30,:40`), the
notification pages, one of which is the gallery's use of the pager exception
(`NotificationPagesE2ETests.cs:32`, alongside strict scans at `:44` and `:56`), and the password-recovery
pages added with [ADR-091](091-cache-backed-password-reset.md): forgot-password in both its form state and
its confirmation state, which replaces the form and is therefore a distinct rendering
(`ForgotPasswordPageE2ETests.cs:46` and `:60`), plus reset-password (`ResetPasswordPageE2ETests.cs:48`).
One gallery scan covers a signed-in page: the shared devices/sessions page
(`SessionsPageE2ETests.cs:34`, class at `:13`), which carries a real `[Authorize]`, so the test seeds the
gallery's cookie-toggled fake authentication scheme before navigating and scans the populated table, its
current-device marker, and the per-device sign-out buttons under the strict options.
**MMCA.Store** subclasses all four Identity bases
(`Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5`,
`UserRegistrationTests.cs:5`, `ProfileManagementTests.cs:5`, `PasswordResetTests.cs:5`). **MMCA.ADC**
subclasses three of the four
(`Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5`,
`UserRegistrationTests.cs:5`, `PasswordResetTests.cs:5`); its `ProfileManagementTests` derives
`E2ETestBase` directly
(`ProfileManagementTests.cs:8`) because the ADC profile page supports only password change and account
deletion, so it does not inherit the base's profile scan. Beyond the Identity bases each app carries a
dedicated suite: ADC's `Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17` holds 31 page
scans (10 through `ScanGridAsync`, 21 strict) and Store's
`Tests/E2E/MMCA.Store.E2E.Tests/Workflows/AccessibilityTests.cs:17` holds 23 (6 grid, 17 strict).
**MMCA.Helpdesk adopts none of it**: it pins the package version
(`MMCA.Helpdesk/Directory.Packages.props:84`) but no project references it, and the repo has no E2E
test project at all (`Tests/` holds only `Architecture` and `Modules`), so the seed has no browser
accessibility gate today.

## Rationale
- **A named constant is the contract.** Putting the rule set in a shipped, referenced symbol rather
  than in each repo's test setup means "what WCAG 2.1 AA means here" has exactly one definition, it
  versions with the package, and a change to it is a reviewable diff in one file instead of drift
  discovered by comparing CI logs.
- **Excluding best-practice rules is what makes the gate blockable.** A gate that can red on advisory
  findings gets demoted to advisory itself. Scoping to the four WCAG tags means every failure is a real
  conformance violation, which is the precondition for making the check required rather than informational.
- **Assert in the base, not in the consumer.** The same push-left posture as ADR-058: shipping the
  assertion inside `UserLoginTestsBase` / `UserRegistrationTestsBase` / `ProfileManagementTestsBase` /
  `PasswordResetTestsBase` means an app that adopts the Identity workflow tests cannot accidentally adopt
  them without the a11y scan. Opting out is visible (it means not subclassing the base), the way ADC's profile page is.
- **A real engine, not reflection.** Contrast, accessible names, and live-region announcement exist only
  in a rendered accessibility tree. That is why this sits in the E2E package with Playwright and not in
  the NetArchTest tier (ADR-015) or the booted-host conformance tier (ADR-058).
- **Cross-browser where it is cheap, chromium where it is expensive.** The gallery is backend-less, so
  all three engines run there and catch the cross-engine class of defect at low cost. A full Aspire-stack
  E2E leg costs roughly twenty minutes, so the deploy path runs chromium only and leans on the gallery
  matrix for engine coverage.
- **Exceptions as distinct option values, not as suppression flags.** A second constant with a different
  name forces the caller to say which contract it is scanning under, and it keeps the exception's
  justification attached to the thing being excepted rather than buried in a config file.

## Trade-offs
- **Best-practice rules are out of scope, deliberately.** Findings axe would classify as best practice
  (and anything WCAG AAA) are not measured at all, so the gate can be green on a page a specialist would
  still improve. This is the price of a blockable gate, and it is recorded on the constant itself
  (`AxeOptions.cs:12-15`).
- **One accepted exception, with real blast radius.** `Wcag21AaExceptMudPagerCombobox` disables
  `aria-input-field-name` for the whole page scan, not just for the pager node. A grid page that later
  gains a genuinely unnamed combobox of its own would pass `ScanGridAsync` (`E2ETestBase.cs:288`). The
  exception is documented as "use only where the sole combobox is a pager" (`AxeOptions.cs:33`), which is
  a convention the compiler cannot enforce. It is upstream-owned: it stands until MudBlazor labels the
  pager select.
- **Automation covers only what axe can judge.** Focus order, reading order, and announcement quality are
  not machine-checkable and are covered by the manual screen-reader checklist in
  [common-ACCESSIBILITY.md](../guides/common-ACCESSIBILITY.md), which is a periodic human pass, not a gate.
- **The deploy gate is ui-scoped and may legitimately skip.** Both apps gate `e2e-gate` on a `ui` change
  filter (ADC `deploy.yml:635`, Store `deploy.yml:591`), and `deploy` accepts `success` or `skipped` for it
  (ADC `:1022`, Store `:972`), so a backend-only or infra-only deploy ships without a browser scan. That
  is the intended cost trade (a backend change cannot alter rendered markup) with the post-deploy smoke
  gate as backstop, but it does mean "deployed" does not always mean "axe ran on this commit".
- **Consumer breadth is hand-maintained.** Nothing forces a new page into `AccessibilityTests`, so
  coverage grows by discipline: 31 scans in ADC and 23 in Store today, against far larger page inventories.
- **MMCA.Helpdesk has no accessibility gate.** The reference app demonstrates the framework's layers but
  not this contract, so a reader following the seed sees no worked example of adopting the scan.

## Related
ADR-015 (architecture fitness functions: the structural tier this parallels at the browser tier, and the
same invariant-over-discipline posture), ADR-058 (runtime conformance suites shipped as subclassable
bases in a package: the pattern this record applies to accessibility, one tier further out),
ADR-028 (dark theme: the dark palette's contrast tokens, `MMCATheme.cs:58,:67,:71`, exist in the form they
do because the gated dark-mode scan rejected the defaults), and the how-to companion
[common-ACCESSIBILITY.md](../guides/common-ACCESSIBILITY.md) (scanned-state inventory, manual
screen-reader checklist, and the tracked limitations).
