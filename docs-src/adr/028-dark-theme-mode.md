# ADR-028: Day/Dark Theme Mode

## Status
Accepted (2026-06-27; revised 2026-07-15; revised 2026-08-31; revised 2026-10-01).
Revised 2026-10-06: the first-paint flash is scoped to web heads and the MAUI first-frame mode source is recorded.

## Context
`MMCATheme` (`MMCA.Common.UI/Theme/MMCATheme.cs`) has always defined a complete, brand-tuned `PaletteDark`
alongside `PaletteLight`, but `MudThemeProvider` was hard-wired to light: no `@ref`, no `IsDarkMode`
binding, no toggle, no persistence. Dark mode was designed and then never connected. This ADR connects it.

The mechanics are the same ones ADR-027 solves for locale: a Blazor `InteractiveAuto` app must agree on the
theme across SSR prerender, the InteractiveServer circuit, and the InteractiveWebAssembly client to avoid a
flash of the wrong theme (FOUC) on load. So the theme toggle reuses the i18n persistence machinery (cookie +
localStorage + profile) rather than inventing a parallel one; the matching no-flash SSR bootstrap is the
intended end state but is not yet wired for theme on web heads (see Decision 3).

## Decision

1. **Bind the existing theme.** The shared `MainLayout` renders a single `<MmcaThemeProviders />`
   component (`MMCA.Common.UI/Layout/MainLayout.razor:16`), which owns the four Mud providers plus the
   Day/Dark lifecycle in one place. Inside that component `MudThemeProvider` is bound with
   `Theme="@Theme"` and `@bind-IsDarkMode`
   (`MMCA.Common.UI/Theme/MmcaThemeProviders.razor:14`), a two-way binding to that component's own
   `_isDarkMode` field (`MmcaThemeProviders.razor:38`); no `@ref` is used. `Theme` is a `MudTheme`
   parameter whose default is the already-complete `MMCATheme.Instance`
   (`MmcaThemeProviders.razor:36`), so a consuming app that needs its own brand passes a derived
   `MudTheme` instead of duplicating the provider block. The layout no longer holds the provider
   markup or the `_isDarkMode` field itself. No new palette work.

2. **A `ThemeService` (`MMCA.Common.UI`) owns the preference**, registered in `AddUIShared`. It holds the
   current mode, reads/writes a **non-HttpOnly cookie + localStorage**, and raises a change event that
   `MmcaThemeProviders` (`MmcaThemeProviders.razor:52`) and every `ThemeToggle` (`ThemeToggle.razor:16`)
   subscribe to, so the shared providers component and the app-bar toggle stay in sync; the layout
   itself subscribes to nothing. First-visit default is the OS `prefers-color-scheme`, read
   via a small JS interop call (`theme.js` `systemPrefersDark()` ->
   `window.matchMedia('(prefers-color-scheme: dark)')`), used only when no cookie/profile value exists.

3. **Theme is restored from the cookie/localStorage after first render: the no-flash SSR bootstrap is
   outstanding.** `ThemeService.InitializeAsync` reads the persisted value via JS interop from
   `OnAfterRenderAsync(firstRender)` and deliberately does **not** run during SSR prerender, so the bound
   `IsDarkMode` is corrected just after hydration. The cookie-as-single-source-of-truth persistence of
   ADR-027 is reused, but the *server-side* prerender read that makes locale flash-free (a `data-theme`
   attribute / inline `<head>` script emitted from the cookie before Blazor hydrates) is **not yet wired for
   theme**. On web heads a brief wrong-theme flash on first paint is therefore currently possible;
   emitting the theme server-side at prerender to close it is tracked as follow-up. MAUI heads do not
   wait for JS: `MMCA.Common.UI.Maui` registers `IInitialThemeModeSource` as
   `MauiInitialThemeModeSource` (`MMCA.Common.UI.Maui/DependencyInjection.cs:68`), and
   `MmcaThemeProviders.OnInitialized` seeds `_isDarkMode` from it before subscribing
   (`MmcaThemeProviders.razor:47`), so the first frame paints in the stored mode. Web heads register
   no source and keep the post-render JS path. Store's MAUI head also carries a host-local pre-paint
   inline script that sets `data-mmca-theme` from the `mmca_theme` cookie or localStorage
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/wwwroot/index.html:16-43`), consumed by its `app.css`
   (`app.css:34-44`) so the host page background starts in the right mode.

4. **The toggle ships in the shared `MainLayout`**, next to the i18n culture switcher, in the app-bar
   `appbar-icon-actions` slot, so every consumer gets both controls without per-host wiring.

5. **The choice is persisted to the Identity profile (`User.PreferredTheme`)**, in the *same* migration and
   with the *same* login-reconciliation rule as `User.PreferredCulture` (ADR-027): DB is the cross-device
   source of truth, the cookie is the runtime channel; on login the cookie is set from the profile, an
   authenticated toggle writes both, anonymous users get cookie/localStorage only.

6. **Helpdesk is brought into line.** Its host's custom `MainLayout` used a bare `<MudThemeProvider />`
   (not even `MMCATheme`); it now renders the framework's `<MmcaThemeProviders />`
   (`MMCA.Helpdesk.UI.Web/Components/Layout/MainLayout.razor:10`) plus `<CultureSwitcher />` and
   `<ThemeToggle />` in its own `MudAppBar` (`MainLayout.razor:27-28`), so the theme, the bound
   `IsDarkMode` and the whole lifecycle come from the shared component rather than being restated in
   the host. As an `InteractiveServer`-only host it has no WASM boundary, but it still reads the
   cookie for consistency.

## Rationale
- **Reusing the i18n cookie/profile machinery** means one persistence model for both user preferences,
  instead of two subtly different ones. Theme and locale are the same shape of problem, so the no-flash SSR
  bootstrap built for locale is the template theme will follow when it is wired.
- **The palette already existed**, so the cost is wiring + persistence, not design, and `BrandColorTokenTests`
  already guards the C# to CSS token sync, so the dark surfaces stay on-brand.
- **Defaulting to the OS preference** respects the user's system setting on first visit while letting an
  explicit choice win and follow them across devices.

## Trade-offs
- **The same FOUC hazard as locale is not yet closed for theme on web heads.** The SSR
  `data-theme`/inline-script read is unimplemented (Decision 3), so the first paint can briefly flash the
  wrong theme before the post-render JS interop corrects it; there is no free no-flash for InteractiveAuto.
  MAUI heads avoid it through `IInitialThemeModeSource` (Decision 3).
- **Helpdesk's custom layout** is still wired separately because it does not inherit Common's
  `MainLayout`, but the obligation is now two component tags (`<MmcaThemeProviders />` plus
  `<ThemeToggle />`) rather than a provider block and its lifecycle: the layout's own comment
  (`MMCA.Helpdesk.UI.Web/Components/Layout/MainLayout.razor:8-9`) records that the four Mud providers
  and the Day/Dark lifecycle belong to `MmcaThemeProviders` and that the layout carries only Helpdesk
  chrome. Future hosts that fork the layout inherit that same two-tag obligation.
- **Per-user persistence adds a column** to the Identity `User` (folded into the ADR-027 migration, so no
  extra migration), and a profile-edit surface.

## Revision (2026-10-01)
Anchor refresh only: no decision or rationale changed. The snackbar live-region wrapper above the
`@code` block moved the `MmcaThemeProviders` members, so the `Theme` parameter, the `_isDarkMode` field
and the `OnChange` subscription are re-cited at `MmcaThemeProviders.razor:34`, `:36` and `:39`. Helpdesk's
`MainLayout` gained a skip-nav link and app-bar accessibility comments, so its ownership comment,
`<MmcaThemeProviders />` and the `<CultureSwitcher />` / `<ThemeToggle />` pair are re-cited at
`MainLayout.razor:8-9`, `:10` and `:27-28`.

## Revision (2026-10-06)
- Decision 3 and Trade-offs scope the first-paint wrong-theme flash to web heads and record the MAUI
  path: `IInitialThemeModeSource` registered by `MMCA.Common.UI.Maui/DependencyInjection.cs:68` and read
  in `MmcaThemeProviders.razor:47`, plus Store's MAUI host pre-paint script
  (`MMCA.Store.UI/wwwroot/index.html:16-43`).
- Related no longer credits ADR-015 with a theme host-wiring assertion: no fitness test asserts theme
  wiring today.
- Two non-ASCII arrows in Decision 2 and Rationale replaced with plain text.
- Anchors re-verified against current source: shared `MainLayout.razor:16`; `MmcaThemeProviders.razor:14`
  (provider), `:36` (`Theme`), `:38` (`_isDarkMode`) and `:52` (`OnChange`), superseding the `:34`, `:36`,
  `:39` recorded on 2026-10-01. Helpdesk anchors (`:8-9`, `:10`, `:27-28`) and `ThemeToggle.razor:16`
  unchanged.

## Related
[ADR-027](027-multi-locale-i18n.md) (shares the cookie source-of-truth and the `User` preference migration,
and is the model for the theme no-flash SSR bootstrap that is not yet wired),
[ADR-022](022-browser-session-cookie-auth.md) (the SSR cookie-read pattern),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function framework; no theme host-wiring
assertion exists in it today).
