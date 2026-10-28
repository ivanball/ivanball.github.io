# Responsive Design & Cross-Browser Support (rubric §22)

_As of: 2026-10-28 (framework v1.265.1)._

This document is the **supported-device and browser matrix** for the shared `MMCA.Common.UI`
component library. It makes the responsive contract explicit (rubric section 22) so consumers know which
viewports, touch-target sizes, and browser engines the framework targets and gates.

## Breakpoints

The framework keeps C# viewport detection and CSS media queries aligned around two thresholds: the
MudBlazor `960px` grid-vs-card switch and the CSS `1024px` desktop floor.

| Layer | Constant / query | Threshold | Purpose |
|-------|------------------|-----------|---------|
| C# (MudBlazor) | `BreakpointConstants.IsMobileBreakpoint` (`Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:16`) | `Xs`/`Sm`, i.e. `< 960px` | Switches list pages between desktop data grids and mobile card layouts (`DataGridListPageBase` sets `IsMobile` from the viewport breakpoint) |
| CSS | `@media (max-width: 1023.98px)` (`wwwroot/app.css`) | `<= 1023.98px` | Mobile data-grid behaviors (column hiding, pager wrap, horizontal scroll), 48px touch targets, mobile snackbar z-index |
| CSS | `@media (max-width: 1023.98px)` (`Layout/MainLayout.razor.css`) | `<= 1023.98px` | Hamburger navigation: the app bar is hidden (its actions move to the NavMenu top row) and content padding tightens |
| CSS | `@media (min-width: 1024px)` (`Layout/MainLayout.razor.css`, `Layout/NavMenu.razor.css`, `wwwroot/app.css`) | `>= 1024px` | Persistent sidebar (nav toggler and backdrop hidden), desktop auth-page top margin, desktop full-bleed margins |

> The C# `960px` mobile cutoff and the CSS `1023.98px` cutoff intentionally differ: `960px` is the
> MudBlazor grid-vs-card switch, while the `1023.98px` band carries the hamburger navigation and the
> broader "small-screen polish" rules (touch targets, pager wrap). The persistent sidebar starts at the
> `1024px` desktop floor.

## Supported devices

| Class | Reference width | Layout |
|-------|-----------------|--------|
| Phone | 360-599px | Card lists, hamburger navigation, stacked forms, 48px touch targets |
| Tablet | 600-959px | Card lists (still mobile per the 960px cutoff), hamburger navigation, wrapping pagers |
| Small laptop / landscape tablet | 960-1023px | Data grids, hamburger navigation, small-screen polish (touch targets, pager wrap) |
| Laptop / desktop | 1024px and up | Data grids, persistent sidebar, multi-column detail layouts |
| Large desktop | 1920px and up | No dedicated breakpoint; detail cards stay capped by `--mmca-content-max-width` (700px) |

## Touch targets

Interactive controls on mobile surfaces meet a **48px minimum hit area** (Material Design),
exceeding both WCAG 2.5.8 Target Size (Minimum, AA, 24px) and WCAG 2.5.5 Target Size (Enhanced,
AAA, 44px).

- The shared, opt-in `.mmca-touch-target` utility class (defined in `wwwroot/app.css`) guarantees a
  48px box on any control that adds it. The mobile media query also enforces the 48px minimum on
  icon buttons across the shared mobile surfaces (cart drawer, mobile cards, data-grid pager), so
  the rule is a **general affordance** rather than scoped to one component.
- Enforced by `ComponentsPageE2ETests.ComponentsPage_TouchTarget_MeetsMinimumSizeOnMobileViewport`
  (a phone-viewport Playwright bounding-box assertion).

## Grid density

`DataGridListPageBase<TDto>` exposes a `DenseGrid` property and a `ToggleDensity()` method. Derived
list pages bind `Dense="@DenseGrid"` on their `MudDataGrid` and surface a toggle. The chosen density
is persisted alongside paging/sort/filter state (URL query key `d`, in-memory state service, and
sessionStorage), so it survives navigation, refresh, and shareable links. Round-trip is covered by
`ListPageStateServiceTests` and `ListPageQueryStateServiceTests`.

## Browser matrix

The shared UI is tested against three Playwright engines in CI (`.github/workflows/ci.yml`,
`ui-e2e` job): a real-browser axe (WCAG 2.1 AA) + render smoke against the backend-less gallery host.

| Engine | Represents | CI status |
|--------|------------|-----------|
| Chromium | Chrome, Edge (Chromium) | **Required merge gate** |
| Firefox | Firefox | **Required merge gate** (promoted from advisory 2026-07-12) |
| WebKit | Safari | **Required merge gate** (promoted from advisory 2026-07-16) |

All three engines run on every CI pass and surface their results independently
(`fail-fast: false`); each was promoted to a blocking gate once observed reliably green
(Firefox on 2026-07-12, WebKit on 2026-07-16 after 11 consecutive green main runs).
The framework targets current evergreen versions of these browsers; no legacy/IE support.
