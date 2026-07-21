# Manual Screen-Reader Pass: Runbook (§21 Accessibility)

The automated layer (axe-core WCAG 2.1 AA scans in `Tests/E2E/MMCA.Store.E2E.Tests/Workflows/AccessibilityTests.cs`
plus the shared Login/Register/Profile bases in `MMCA.Common.Testing.E2E`) catches programmatic
violations: missing labels, contrast, ARIA misuse, landmark gaps. It cannot judge whether the experience
is actually usable with a screen reader: focus order, meaningful announcements, live-region updates, and
keyboard operability. This runbook is the manual complement the rubric (§21) calls for. Record a dated
pass in the results table below; that record is the evidence the scorecard reads.

> Scope note: this is a manual, periodic pass (run it before a release and when a flow changes), not a CI
> gate. The CI a11y gate is the separate axe + Playwright chromium suite that already gates every deploy
> (the `e2e-gate` job in `.github/workflows/deploy.yml`). The two are complementary: automation catches
> regressions cheaply, the manual pass catches what automation cannot.

## Tools

| OS | Screen reader | Browser | Start / stop |
|----|---------------|---------|--------------|
| Windows | **NVDA** (free, nvaccess.org) | Chrome or Edge | `Ctrl`+`Alt`+`N` to start, `Insert`+`Q` to quit |
| macOS | **VoiceOver** (built in) | Safari | `Cmd`+`F5` to toggle |

Run against the app started via Aspire (`dotnet run --project Source/Hosting/MMCA.Store.AppHost`), reaching
the Web UI at `https://localhost:6002`. Test with the **keyboard only** (no mouse) for the whole pass.

## What to verify on every flow

1. **Landmarks and headings.** The SR's landmark/heading list (NVDA `Insert`+`F7`) exposes a logical
   `banner` / `navigation` / `main` structure and a sensible `h1...hN` outline (one `h1` per page).
2. **Skip link.** The first `Tab` reaches a working "skip to main content" link (the shared
   `MainLayout.razor` from `MMCA.Common.UI`).
3. **Focus order.** `Tab` / `Shift`+`Tab` move in reading order; focus is always visible; no focus is
   trapped (you can always `Tab` back out of menus, the cart drawer, dialogs, the data grid).
4. **Accessible names.** Every control announces a meaningful name plus role (icon-only buttons announce
   their `aria-label`, not "button"; links announce their destination, not "link"). Known accepted
   exception: the MudDataGrid pager's rows-per-page combobox has no accessible name (upstream MudBlazor
   9.6.0 limitation, accepted in the automated scans via `Wcag21AaExceptMudPagerCombobox`); note it,
   do not fail the flow on it.
5. **State changes announced.** Loading spinners, snackbars, validation errors, and the theme/culture
   switch are announced via a live region (`role="alert"` / `aria-live`), not silently visual-only.
6. **Forms.** Each field's label, required state, and (on submit) its error are announced, and focus moves
   to the first error; the per-form error summary is reachable.
7. **Data grid.** Rows/columns are navigable and announce header context; sort/filter/page controls have
   names and announce the result count.
8. **Dialogs.** Opening a confirm/delete dialog moves focus into it, traps focus within it while open, and
   returns focus to the trigger on close.

## Flows to cover (mirror the automated AccessibilityTests plus the role journeys)

| # | Flow | Key checks beyond axe |
|---|------|-----------------------|
| 1 | **Login** (`/login`) | Field labels and error announced; submit state announced |
| 2 | **Register** (`/register`) | Same; password-rule helper text announced |
| 3 | **Profile** (`/profile`) | Name/address save confirmations announced; change-password per-field errors plus summary announced |
| 4 | **Theme + culture switch** | Toggling dark mode / `es` announces the change and does not lose focus |
| 5 | **Anonymous browse** (`/catalog`, `/catalog/{id}`) | Product cards announce name and price; the sign-in-to-purchase affordance is announced for anonymous visitors |
| 6 | **Shopper, cart drawer** | Add-to-cart announces the added item; opening the drawer moves focus into it; quantity increase/decrease and Remove announce the result; Checkout handoff announced |
| 7 | **Shopper, orders** (`/orders`, `/orders/{id}`) | Grid navigation; the status chip is announced; Pay Now / Retry Payment / Cancel Order buttons have names |
| 8 | **Admin catalog CRUD**, create/edit a product and its variants (`/products`), create/edit a category (`/categories`) | Required-field errors announced; the inline variant editor's fields are reachable and named; delete confirm dialog focus trap |
| 9 | **Admin sales review**, inventory adjust/set (`/inventory/{id}`), shopping carts (`/shoppingcarts`) | Adjustment result announced (increase/decrease/set snackbars); In Stock / Out of Stock chips announced |
| 10 | **Admin customers**, create/edit/delete (`/customers`) | Per-field errors announced; delete confirm dialog focus trap; post-delete navigation announced |

## Results log

Record one row per pass. A flow with any unresolved blocker is a FAIL (open a backlog item for it).

| Date | Reviewer | SR / browser | Flows passed | Issues found (-> backlog item) |
|------|----------|--------------|--------------|--------------------------------|
| _yyyy-mm-dd_ | | NVDA / Chrome | | |

## After a pass

- File any defect as a remediation item; cross-link it from the §21 row's evidence.
- Update the dated row above so the scorecard can cite a real, current manual pass (this is what lifts the
  "no manual screen-reader pass is evidenced" §21 deduction).
