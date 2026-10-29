# ADR-028: Day/Dark Theme Mode

## Status
Accepted (2026-06-27; revised 2026-07-15; revised 2026-08-31; revised 2026-10-01).
Revised 2026-10-06: the first-paint flash is scoped to web heads and the MAUI first-frame mode source is recorded.
Revised 2026-10-19: the MAUI host pre-paint script ships from MMCA.Common.UI (`theme-prepaint.js`, v1.246.0) and both MAUI heads load it.
Revised 2026-10-21: the Android status-bar fallback is recorded as part of the shared `theme-prepaint.js` (Store's host page has no inline script), the per-consumer `MauiHostShellTests` theme host-page fitness tests are credited at their actual scope (only Store's checks the pre-paint script), and the `BrandColorTokenTests` coverage claim is stated as what it checks.
Revised 2026-10-26: startup initialization is recorded as `InitializeAtStartupAsync` behind a best-effort interop guard, with a known MAUI native value authoritative over the WebView cookie for the Blazor startup mode (not the host pre-paint), and the dark palette background check is credited as a literal rather than a `BrandColors` pin.
Revised 2026-10-28: the opt-in `ColorModeStamp` document attribute (`Layout:StampColorModeOnDocument`) is recorded as a post-render step of the theme lifecycle, and the `MmcaThemeProviders` startup and interactivity-marker anchors are refreshed.

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
   `MmcaThemeProviders` (`MmcaThemeProviders.razor:56`) and every `ThemeToggle` (`ThemeToggle.razor:16`)
   subscribe to, so the shared providers component and the app-bar toggle stay in sync; the layout
   itself subscribes to nothing. First-visit default is the OS `prefers-color-scheme`, read
   via a small JS interop call (`theme.js` `systemPrefersDark()` ->
   `window.matchMedia('(prefers-color-scheme: dark)')`), used only when no cookie/profile value exists.

3. **Theme is restored after first render (from the cookie/localStorage, or on MAUI from a known
   native value): the no-flash SSR bootstrap is outstanding.** `MmcaThemeProviders.OnAfterRenderAsync(firstRender)` calls
   `ThemeService.InitializeAtStartupAsync` (`MmcaThemeProviders.razor:69`), which on a web head (no
   native value) runs `ThemeService.InitializeAsync` to read the persisted value via JS interop
   (`ThemeService.cs:61-62`); it deliberately does **not** run during SSR prerender, so the bound
   `IsDarkMode` is corrected just after hydration. The call is wrapped in `ThemeInterop.TryAsync`,
   which swallows `JSException`, `JSDisconnectedException` and `InvalidOperationException`
   (`ThemeInterop.cs:19-30`), so a failure of one of those three types keeps the initial mode rather
   than killing the circuit; any other exception type (an interop call timeout's
   `TaskCanceledException`, for example) is not caught and escapes `OnAfterRenderAsync`. The
   cookie-as-single-source-of-truth persistence of ADR-027 is reused (on MAUI a known native value
   outranks the cookie at startup, below), but the *server-side* prerender read that makes locale flash-free (a `data-theme`
   attribute / inline `<head>` script emitted from the cookie before Blazor hydrates) is **not yet wired for
   theme**. On web heads a brief wrong-theme flash on first paint is therefore currently possible;
   emitting the theme server-side at prerender to close it is tracked as follow-up. MAUI heads do not
   wait for JS: `MMCA.Common.UI.Maui` registers `IInitialThemeModeSource` as
   `MauiInitialThemeModeSource` (`MMCA.Common.UI.Maui/DependencyInjection.cs:68`), and
   `MmcaThemeProviders.OnInitialized` seeds `_isDarkMode` from it before subscribing
   (`MmcaThemeProviders.razor:50`), so the first frame paints in the stored mode. A known native
   value is authoritative at startup: `InitializeFromNativeAsync` adopts it without a JS read and
   then reseeds the WebView cookie/localStorage with it (`ThemeService.cs:64-79`), so on MAUI a known
   native value, not the cookie, decides the Blazor startup mode. When the source returns no value
   (null means unknown, `MmcaThemeProviders.razor:48-50`) MAUI takes the same cookie/JS path as a web
   head (`ThemeService.cs:61-62`). The host-page pre-paint described next reads no native value, so
   until the page is interactive the host surface follows the WebView cookie/localStorage even when
   the native store disagrees. Web heads register no source and keep the post-render JS path. Before Blazor renders at all, the host page itself is
   seeded by a framework-shipped pre-paint script: `MMCA.Common.UI/wwwroot/theme-prepaint.js`, a
   classic synchronous script that stamps `<html data-mmca-theme="dark|light">` from the `mmca_theme`
   cookie, then localStorage, then the OS scheme (`theme-prepaint.js:14-43`). The matching rules in
   Common's `app.css` (`MMCA.Common.UI/wwwroot/app.css:100-126`) paint the host surface in that mode
   until `MmcaThemeProviders` marks the page interactive (`data-mmca-interactive`,
   `MmcaThemeProviders.razor:90-104`); every selector requires `data-mmca-theme`, so web heads, which
   do not load the script, are untouched. Both MAUI heads load it as the first script in `<head>`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/wwwroot/index.html:8`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/wwwroot/index.html:13`), and neither head carries an
   inline script. The same file also carries a second, non-theme block: the Android status-bar
   height fallback that turns the `MmcaStatusBar/<px>` user-agent token into
   `--mmca-status-bar-fallback` (`theme-prepaint.js:45-56`). Each head carries a repo-local fitness
   test, `MauiHostShellTests.HostPage_DoesNotPaintALightBackgroundBeforeTheThemeApplies`, that fails
   when the host page would paint the default light surface before the theme applies, but only
   Store's knows about the pre-paint script. Store's
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Ui/MauiHostShellTests.cs:21-49`)
   accepts any one of three routes (`:47`): a transparent `html`/`body`, a
   `prefers-color-scheme: dark` aware one, or the pre-paint seed, which holds when the script runs
   ahead of every stylesheet, Common's `app.css` is linked, and no host-local `html`/`body` rule
   paints a background outside a `data-mmca-theme` selector (`:40-45`). Store's host `app.css` has
   no `html`/`body` rule, so the seed is the route in use there. ADC's
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Ui/MauiHostShellTests.cs:42-58`)
   accepts only the first two routes (`:56`) and does not check the script: ADC's host `app.css`
   keeps a `prefers-color-scheme` aware `html`/`body` fallback surface
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/wwwroot/app.css:26-36`), so the test passes through that
   rule and removing `theme-prepaint.js` from ADC's `index.html` would not fail it. After marking
   the page interactive, `OnAfterRenderAsync` also calls the opt-in `ColorModeStamp.ApplyAsync`
   (`MmcaThemeProviders.razor:76`, and again after every theme change at `:125`): with
   `Layout:StampColorModeOnDocument` set (off by default, `LayoutSettings.cs:68`) it stamps
   `<html data-mmca-color-mode="light|dark">` for an app's own stylesheet, best-effort through
   `ThemeInterop.TryAsync` (`ColorModeStamp.cs:24-35`). It is deliberately a separate attribute
   (`theme.js:83-84`, `:87`) from the pre-paint `data-mmca-theme` (stamped at
   `theme-prepaint.js:42`) and runs only after an interactive render, so it does not close the
   web-head first-paint flash. Both Store web heads opt in
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:27`,
   `MMCA.Store.UI.Web.Client/wwwroot/appsettings.json:26`) and `store.css` keys its dark roles on
   the attribute (`MMCA.Store.UI.Web/wwwroot/store.css:89-94`), so those roles share that
   post-interactive timing; ADC and Helpdesk do not opt in.

4. **The toggle ships in the shared `MainLayout`**, next to the i18n culture switcher, in the app-bar
   `appbar-icon-actions` slot, so every consumer gets both controls without per-host wiring.

5. **The choice is persisted to the Identity profile (`User.PreferredTheme`)**, in the *same* migration and
   with the *same* login-reconciliation rule as `User.PreferredCulture` (ADR-027): DB is the cross-device
   source of truth, the cookie is the runtime channel (on MAUI a known native value reseeds it when
   Blazor initializes, Decision 3); on login the cookie is set from the profile, an
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
- **The palette already existed**, so the cost is wiring + persistence, not design. `BrandColorTokenTests`
  guards the C# to CSS sync of the five `Primary*`/`Secondary*` brand tokens
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:34-50`), fails on
  a raw `Primary*`/`Secondary*` hex in any MMCA.Common.UI stylesheet outside an `app.css` token
  definition (`:52-92`), and pins the theme palettes to `BrandColors` on the C# side: the light
  primary and the secondary family, including `PaletteDark.Secondary` (`:94-110`), and the dark
  palette's primary (`:118`). The dark palette's background is asserted against the literal
  `#1A2027` (`:117`), not against `BrandColors.DarkBackground`. The surface colors are restated by hand in two
  places no test compares to `BrandColors.LightBackground`/`DarkBackground` (`BrandColors.cs:66`,
  `:136`): the pre-paint tokens `--mmca-prepaint-background-light/dark`
  (`MMCA.Common.UI/wwwroot/app.css:96-97`) and the `#FAFBFC`/`#1A2027` fallbacks in ADC's host
  `app.css` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/wwwroot/app.css:28`, `:34`), so either copy can
  drift unnoticed.
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

## Revision (2026-10-19)
- Decision 3 now describes the MAUI host pre-paint as framework machinery. Store's host-local inline
  theme script and its `app.css` rules moved into MMCA.Common.UI v1.246.0 as `theme-prepaint.js` plus
  the `data-mmca-theme` rules in the shared `app.css` (`:100-126`), and ADC's MAUI head, which had no
  pre-paint seed, adopts the same script (`MMCA.ADC.UI/wwwroot/index.html:8`), so a dark-mode cold
  launch no longer flashes white on either head. Store keeps only its status-bar fallback inline.
- The `MmcaThemeProviders` read of `IInitialThemeModeSource` is re-cited at `MmcaThemeProviders.razor:50`
  (was `:47`); the registration at `MMCA.Common.UI.Maui/DependencyInjection.cs:68` is unchanged.

## Revision (2026-10-21)
Re-verified against current source. The binding, the `ThemeService` preference model, the MAUI
first-frame source and the web-head flash scope are unchanged; what moved is the Store host page,
which no longer carries any inline script, and the fitness-test coverage of the theme host wiring.
1. Decision 3: Store's Android status-bar fallback is no longer an inline script in its host page;
   it ships in Common's `theme-prepaint.js:45-56` beside the theme block, and Store's `index.html`
   loads only external scripts (`:13`, `:27-29`). The 2026-10-19 note that Store keeps its
   status-bar fallback inline no longer holds.
2. Decision 3 and Related: each consumer guards its theme host page with a repo-local
   `MauiHostShellTests` fitness test, superseding the 2026-10-06 statement that no fitness test
   asserts theme wiring. Only Store's (`MMCA.Store.Architecture.Tests/Ui/MauiHostShellTests.cs:21-49`)
   recognizes the pre-paint script, as one of three accepted routes (`:40-47`); ADC's
   (`MMCA.ADC.Architecture.Tests/Ui/MauiHostShellTests.cs:42-58`) passes on its host `app.css`
   `prefers-color-scheme` fallback (`MMCA.ADC.UI/wwwroot/app.css:26-36`) and does not check the
   script. The shared `MMCA.Common.Testing.Architecture` package still has no theme base.
3. Rationale: `BrandColorTokenTests` is now described at its actual scope: the five
   `Primary*`/`Secondary*` C# to CSS tokens (`BrandColorTokenTests.cs:34-50`), the raw brand-hex
   scan over the MMCA.Common.UI stylesheets (`:52-92`), and the C#-side palette checks
   (`:94-119`). The surface colors restated by hand in the pre-paint tokens (`app.css:96-97`) and
   in ADC's host `app.css` (`:28`, `:34`) are not compared to `BrandColors.cs:66` and `:136` by
   any test.
4. Anchors re-verified against current source: `MmcaThemeProviders.razor:56` (`OnChange`,
   superseding `:52`), Store `index.html:13` (superseding `:15`); `MmcaThemeProviders.razor:14`,
   `:36`, `:38`, `:50`, `:77-99`, ADC `index.html:8`, `app.css:100-126` and
   `theme-prepaint.js:14-43` unchanged.

## Revision (2026-10-26)
Re-verified against current source. The binding, the web-head flash scope and the MAUI host
pre-paint script are unchanged; what the ADR had not recorded is the startup initialization path,
which routes through a native-aware entry point and a best-effort guard, and on MAUI lets a known
native value take precedence over the cookie in the `ThemeService` preference model.
1. Decision 3: `OnAfterRenderAsync(firstRender)` calls `ThemeService.InitializeAtStartupAsync`
   (`MmcaThemeProviders.razor:67`), not `InitializeAsync` directly. With no native value (every web
   head) it runs `InitializeAsync` (`ThemeService.cs:61-62`), so the web-head JS read is unchanged.
2. Decision 3 and Decision 5: when an `IInitialThemeModeSource` returns a value (MAUI),
   `InitializeFromNativeAsync` adopts it without a JS read and reseeds the WebView cookie/localStorage
   with it (`ThemeService.cs:64-79`), so a known native value, not the cookie, decides the Blazor
   startup mode on MAUI. A null native value (unknown, `MmcaThemeProviders.razor:48-50`) falls back
   to the cookie/JS path, and the host pre-paint (`theme-prepaint.js:18-42`) still reads only the
   cookie, localStorage and OS scheme. Decision 3's heading and its ADR-027 reuse sentence are
   qualified to match.
3. Decision 3: the startup call is wrapped in `ThemeInterop.TryAsync`, which swallows `JSException`,
   `JSDisconnectedException` and `InvalidOperationException` (`ThemeInterop.cs:26`), so a failure of
   those types keeps the initial mode; any other exception type (an interop timeout's
   `TaskCanceledException`) is not caught.
4. Rationale: `BrandColorTokenTests` pins the dark palette's primary to `BrandColors.PrimaryLight`
   (`BrandColorTokenTests.cs:118`) but its background to the literal `#1A2027` (`:117`), not to
   `BrandColors.DarkBackground`; the earlier wording credited both to `BrandColors`.
5. Anchors re-verified against current source: `MarkInteractiveAsync` at
   `MmcaThemeProviders.razor:87-101` (superseding `:77-99`, which spanned the comment and stopped
   short of the method's close); `MmcaThemeProviders.razor:14`, `:36`, `:38`, `:50`, `:56`,
   `BrandColorTokenTests.cs:34-50`, `:52-92`, `:94-110` unchanged.

## Revision (2026-10-28)
Re-verified against current source. The binding, the startup initialization path, the best-effort
interop guard, the web-head flash scope and the MAUI pre-paint are unchanged; what the ADR had not
recorded is one opt-in post-render step of the `MmcaThemeProviders` lifecycle.
1. Decision 3: after `MarkInteractiveAsync`, `OnAfterRenderAsync` calls `ColorModeStamp.ApplyAsync`
   (`MmcaThemeProviders.razor:76`), and `RerenderSafeAsync` calls it again after every theme change
   (`:125`). It does nothing unless the render is interactive and
   `LayoutSettings.StampColorModeOnDocument` is true (`ColorModeStamp.cs:24`; default false,
   `LayoutSettings.cs:68`); when it is, it stamps `<html data-mmca-color-mode="light|dark">` through
   `ThemeInterop.TryAsync` (`ColorModeStamp.cs:30-35`). The attribute is deliberately distinct
   (`theme.js:83-84`, `:87`) from the pre-paint `data-mmca-theme` (`theme-prepaint.js:42`), and
   because it runs only after an interactive render it does not close the web-head first-paint
   flash. Both Store web heads opt in (`MMCA.Store.UI.Web/appsettings.json:27`,
   `MMCA.Store.UI.Web.Client/wwwroot/appsettings.json:26`) and key their dark roles on it
   (`store.css:89-94`), so those roles share that timing; ADC and Helpdesk do not opt in.
2. Anchors re-verified against current source: the `InitializeAtStartupAsync` call at
   `MmcaThemeProviders.razor:69` (superseding `:67`, now a line inside the comment block at
   `:63-68`) and
   `MarkInteractiveAsync` at `MmcaThemeProviders.razor:90-104` (superseding `:87-101`, which began
   inside the method's comment); `ThemeService.cs:61-62`, `:64-79` and `ThemeInterop.cs:19-30`
   unchanged.

## Related
[ADR-027](027-multi-locale-i18n.md) (shares the cookie source-of-truth and the `User` preference migration,
and is the model for the theme no-flash SSR bootstrap that is not yet wired),
[ADR-022](022-browser-session-cookie-auth.md) (the SSR cookie-read pattern),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function framework; the shared
`MMCA.Common.Testing.Architecture` package carries no theme base, and the theme host-page assertion
lives in each consumer's own `MauiHostShellTests`, of which only Store's checks the pre-paint script,
see Decision 3).
