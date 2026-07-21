# Manual Screen-Reader Pass: Runbook (§21 Accessibility)

The automated layer (axe-core WCAG 2.1 AA scans in `Tests/E2E/MMCA.ADC.E2E.Tests/AccessibilityTests.cs`
plus the shared Login/Register/Profile bases in `MMCA.Common.Testing.E2E`) catches programmatic
violations: missing labels, contrast, ARIA misuse, landmark gaps. It cannot judge whether the experience
is actually usable with a screen reader: focus order, meaningful announcements, live-region updates, and
keyboard operability. This runbook is the manual complement the rubric (§21) calls for. Record a dated
pass in the results table below; that record is the evidence the scorecard reads.

> Scope note: this is a manual, periodic pass (run it before a release and when a flow changes), not a CI
> gate. The CI a11y gate is the separate axe + E2E merge-gate promotion tracked in `RemediationBacklog.md`
> (TD-06/TD-07). The two are complementary: automation catches regressions cheaply, the manual pass catches
> what automation cannot.

## Tools

| OS | Screen reader | Browser | Start / stop |
|----|---------------|---------|--------------|
| Windows | **NVDA** (free, nvaccess.org) | Chrome or Edge | `Ctrl`+`Alt`+`N` to start, `Insert`+`Q` to quit |
| macOS | **VoiceOver** (built in) | Safari | `Cmd`+`F5` to toggle |

Run against the app started via Aspire (`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`), reaching
the UI through the Gateway. Test with the **keyboard only** (no mouse) for the whole pass.

## What to verify on every flow

1. **Landmarks and headings.** The SR's landmark/heading list (NVDA `Insert`+`F7`) exposes a logical
   `banner` / `navigation` / `main` structure and a sensible `h1...hN` outline (one `h1` per page).
2. **Skip link.** The first `Tab` reaches a working "skip to main content" link (`MainLayout.razor`).
3. **Focus order.** `Tab` / `Shift`+`Tab` move in reading order; focus is always visible; no focus is
   trapped (you can always `Tab` back out of menus, dialogs, the data grid).
4. **Accessible names.** Every control announces a meaningful name plus role (icon-only buttons announce
   their `aria-label`, not "button"; links announce their destination, not "link").
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
| 3 | **Profile** (`/profile`) | Change-password per-field errors plus summary announced; delete-account confirm dialog focus trap |
| 4 | **Theme + culture switch** | Toggling dark mode / `es` announces the change and does not lose focus |
| 5 | **Anonymous browse** (`/events`, `/sessions`, `/speakers`) | Grid navigation; "view" links announce the target |
| 6 | **Attendee**, bookmark a session | Bookmark toggle announces on/off state |
| 7 | **Speaker dashboard**, "My Sessions" | Empty/loaded state announced |
| 8 | **Organizer admin**, create/edit an event | Required-field errors, unsaved-changes guard prompt announced |

## Results log

Record one row per pass. A flow with any unresolved blocker is a FAIL (open a backlog item for it).

| Date | Reviewer | SR / browser | Flows passed | Issues found (-> backlog item) |
|------|----------|--------------|--------------|--------------------------------|
| _yyyy-mm-dd_ | | NVDA / Chrome | | |

## After a pass

- File any defect as a remediation item; cross-link it from the §21 row's evidence.
- Update the dated row above so the scorecard can cite a real, current manual pass (this is what lifts the
  "no manual screen-reader pass is evidenced" §21 deduction).
