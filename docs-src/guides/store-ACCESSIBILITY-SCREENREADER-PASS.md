# Manual Screen-Reader Pass: Runbook (§21 Accessibility)

_As of: 2026-10-28._

The automated layer (axe-core WCAG 2.1 AA scans in `Tests/E2E/MMCA.Store.E2E.Tests/Workflows/AccessibilityTests.cs`, the shared
Login/Register/Profile/password-reset bases in `MMCA.Common.Testing.E2E`, and the cart-drawer keyboard contract in `CartDrawerKeyboardTests.cs`
over the shared `KeyboardOperabilityTestsBase`) catches programmatic violations: missing labels, contrast, ARIA misuse, landmark gaps.
It cannot judge whether the experience is actually usable with a screen reader: focus order, meaningful announcements, live-region updates,
and keyboard operability beyond the cart drawer. This runbook is the manual complement the rubric (section 21) calls for. Record a dated
pass in the results table below; that record is the evidence the scorecard reads.

> Scope note: this is a manual, periodic pass (run it before a release and when a flow changes), not a CI gate. The CI a11y gate is the
> separate axe + Playwright suite: the `e2e-gate` job in `.github/workflows/deploy.yml` runs it on chromium for every deploy whose diff
> may affect the UI (UI source, but also workflows, build props, hosting, the Gateway, E2E tests, any unclassified path, and a manual dispatch), and a red leg blocks the deploy; the scheduled `e2e.yml` firefox (Monday) and webkit (Thursday) legs are advisory per
> run, but their recency gates the deploy (the `cross-browser-freshness` step). The two are complementary: automation catches
> regressions cheaply, the manual pass catches what automation cannot.

## Tools

| OS | Screen reader | Browser | Start / stop |
|----|---------------|---------|--------------|
| Windows | **NVDA** (free, nvaccess.org) | Chrome or Edge | `Ctrl`+`Alt`+`N` to start, `Insert`+`Q` to quit |
| macOS | **VoiceOver** (built in) | Safari | `Cmd`+`F5` to toggle |

Run against the app started via Aspire (`dotnet run --project Source/Hosting/MMCA.Store.AppHost`), reaching the Web UI at `https://localhost:6002`. Test with the **keyboard only** (no mouse) for the whole pass.

## What to verify on every flow

1. **Landmarks and headings.** The SR's landmark/heading list (NVDA `Insert`+`F7`) exposes a logical `banner` / `navigation` / `main` structure and a sensible `h1...hN` outline (one `h1` per page).
2. **Skip link.** The first `Tab` reaches a working "skip to main content" link (the shared `MainLayout.razor` from `MMCA.Common.UI`).
3. **Focus order.** `Tab` / `Shift`+`Tab` move in reading order; focus is always visible; menus and the data grid never trap focus, while the modal cart drawer and dialogs keep `Tab` inside until `Escape` or close returns focus to the trigger.
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
| 3 | **Profile** (`/profile`) | Name/address save confirmations announced; change-password per-field errors plus summary announced; the "Your data" card's download and delete-account results announced and its delete confirm dialog traps focus |
| 4 | **Theme + culture switch** | Toggling dark mode / `es` announces the change and does not lose focus |
| 5 | **Anonymous browse and search** (`/catalog`, `/catalog/{id}`, the app-bar search) | The app-bar search is a named `search` landmark with a labelled field, and Enter lands on `/catalog?q=...` with the showing-range count announced; product cards announce name and price (a discounted card shows the price paid plus a sale chip); on the product page a discounted variant announces both numbers as "Was X, now Y" rather than relying on the strikethrough alone; Add to Cart and Buy Now are open to anonymous visitors (their items go to the browser cart) and announce their names |
| 6 | **Shopper, cart drawer** (signed in or anonymous) | Add-to-cart announces the added item; opening the drawer from the app-bar cart button moves focus into it; quantity increase/decrease and Remove announce the result; Escape closes it and returns focus to the cart button; Checkout & Pay closes the drawer and lands on `/checkout` |
| 7 | **Shopper, orders** (`/orders`, `/orders/{id}`) | Each order card is one link announcing number, date, status, item count and total; the status chip is announced; Pay Now / Retry Payment / Resume Payment / Cancel Order buttons have names |
| 8 | **Admin catalog CRUD**, create/edit a product and its variants (`/products`), create/edit a category (`/categories`) | Required-field errors announced; the inline variant editor's fields are reachable and named; the Set discount dialog's fields are named; delete confirm dialog focus trap |
| 9 | **Admin sales review**, order actions (`/orders/{id}`), inventory adjust/set (`/inventory/{id}`), shopping carts (`/shoppingcarts`) | Mark as Paid / Ship order / Mark as Delivered have names; adjustment result announced (increase/decrease/set snackbars); In Stock / Out of Stock chips announced |
| 10 | **Admin customers**, create/edit/delete (`/customers`) | Per-field errors announced; delete confirm dialog focus trap; post-delete navigation announced |
| 11 | **Guest checkout** (`/checkout`, then `/orders/guest/{id}`) | Signed out, the "Continue as a guest" heading and the Sign in and Find your order links are reachable; contact and shipping field labels, required state and errors announced; the order-summary totals (`aria-live`) re-announce when the address changes the quote; "Continue as guest to payment" is named; on the guest order page the status message (`role="status"`) is announced, Pay now / Return to payment / Cancel order have names, and the create-account form's password errors are announced |
| 12 | **Find my order** (`/orders/find`) | Order-number and email labels, helper text and errors announced; the sent confirmation is announced through its live region (`role="status"`) |
| 13 | **Admin users, roles and reviews** (`/users`, `/users/{id}`, `/roles`, `/roles/{Role}`, `/reviews`) | Role and status chips announced; the per-row actions menu and Delete button are named per account, and the bare customer-number link announces "View customer N"; the role editor's locked (compiled) permission checkboxes announce as disabled with their hint text; review rating cells announce one rating image, not five radio buttons; Hide / Unhide / Delete review buttons have names |

## Results log

Record one row per pass. A flow with any unresolved blocker is a FAIL (open a backlog item for it).

| Date | Reviewer | SR / browser | Flows passed | Issues found (-> backlog item) |
|------|----------|--------------|--------------|--------------------------------|
| _yyyy-mm-dd_ | | NVDA / Chrome | | |

## After a pass

- File any defect as a remediation item; cross-link it from the §21 row's evidence.
- Update the dated row above so the scorecard can cite a real, current manual pass (this is what lifts the
  section 21 maturity cap, tracked as item 3 of `store-RemediationBacklog.md`).
