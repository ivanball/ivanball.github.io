# ADR-028: Day/Dark Theme Mode

## Status
Accepted (2026-06-27; revised 2026-07-15; revised 2026-08-31; revised 2026-10-01).
Revised 2026-10-06: the first-paint flash is scoped to web heads and the MAUI first-frame mode source is recorded.
Revised 2026-10-19: the MAUI host pre-paint script ships from MMCA.Common.UI (`theme-prepaint.js`, v1.246.0) and both MAUI heads load it.
Revised 2026-10-21: the Android status-bar fallback is recorded as part of the shared `theme-prepaint.js` (Store's host page has no inline script), the per-consumer `MauiHostShellTests` theme host-page fitness tests are credited at their actual scope (only Store's checks the pre-paint script), and the `BrandColorTokenTests` coverage claim is stated as what it checks.
Revised 2026-10-26: startup initialization is recorded as `InitializeAtStartupAsync` behind a best-effort interop guard, with a known MAUI native value authoritative over the WebView cookie for the Blazor startup mode (not the host pre-paint), and the dark palette background check is credited as a literal rather than a `BrandColors` pin.
Revised 2026-10-28: the opt-in `ColorModeStamp` document attribute (`Layout:StampColorModeOnDocument`) is recorded as a post-render step of the theme lifecycle, and the `MmcaThemeProviders` startup and interactivity-marker anchors are refreshed.
Revised 2026-10-31: all three Store heads, the MAUI head included, opt in to `Layout:StampColorModeOnDocument`, the MAUI head's `store.css` link is recorded beside the pre-paint route, and the Store and `theme.js` anchors are refreshed.
Revised 2026-11-23: the MAUI host pre-paint now takes the native `MmcaTheme` user-agent token first on a session's first page (Android, iOS, MacCatalyst) and reads localStorage before the cookie, can stamp `data-mmca-color-mode` before first paint (Store's MAUI head opts in), and also sets the navigation-bar fallback; ADC's `MauiHostShellTests` now requires the pre-paint script and ADC's host `app.css` fallback is gone, the Store WASM client's opt-in arrives through `/client-config`, `ColorModeStamp` catches its failures inline, and anchors are refreshed.

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
   component (`MMCA.Common.UI/Layout/MainLayout.razor:17`), which owns the four Mud providers plus the
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
   (`ThemeService.cs:53-56`); it deliberately does **not** run during SSR prerender, so the bound
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
   `MauiInitialThemeModeSource` (`MMCA.Common.UI.Maui/DependencyInjection.cs:69`), and
   `MmcaThemeProviders.OnInitialized` seeds `_isDarkMode` from it before subscribing
   (`MmcaThemeProviders.razor:50`), so the first frame paints in the stored mode. A known native
   value is authoritative at startup: `InitializeAtStartupAsync` (`ThemeService.cs:72-73`) routes it
   to `InitializeFromNativeAsync`, which adopts it without a JS read (`ThemeService.cs:82-84`) and
   then reseeds the WebView cookie/localStorage with it (`ThemeService.cs:90`), so on MAUI a known
   native value, not the cookie, decides the Blazor startup mode. When the source returns no value
   (null means unknown, `MmcaThemeProviders.razor:48-50`) MAUI takes the same cookie/JS path as a web
   head (`ThemeService.cs:53-56`). Web heads register no source and keep the post-render JS path.
   Before Blazor renders at all, the host page itself is seeded by a framework-shipped pre-paint
   script: `MMCA.Common.UI/wwwroot/theme-prepaint.js`, a classic synchronous script whose theme
   block (`theme-prepaint.js:22-77`) stamps `<html data-mmca-theme="dark|light">` (`:73`). It takes
   the native `MmcaTheme/<dark|light>` user-agent token first (`:34-42`), but only on the first page
   of a WebView session, marked through `sessionStorage` (`:36`, `:39`); then localStorage
   (`:46-52`), then the `mmca_theme` cookie (`:54-67`), then the OS scheme (`:69-71`). The token is
   appended by `MainPageBase` (`MMCA.Common.UI.Maui/MainPageBase.cs:200-212`) on Android
   (`:138-145`) and on iOS and MacCatalyst (`:190-197`), and only when a native value is stored, so
   on those platforms a cold launch's host surface follows the native store even when the WebView's
   lazily flushed storage disagrees; elsewhere, and on a later reload in the same session, it
   follows localStorage, then the cookie. The matching rules in
   Common's `app.css` (`MMCA.Common.UI/wwwroot/app.css:100-126`) paint the host surface in that mode
   until `MmcaThemeProviders` marks the page interactive (`data-mmca-interactive`,
   `MmcaThemeProviders.razor:90-106`); every selector requires `data-mmca-theme`, so web heads, which
   do not load the script, are untouched. Both MAUI heads load it as the first script in `<head>`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/wwwroot/index.html:8`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/wwwroot/index.html:15`), and neither head carries an
   inline script. The same file also carries a second, non-theme block (`theme-prepaint.js:87-97`):
   the system-bar fallbacks that turn the `MmcaStatusBar/<px>` user-agent token into
   `--mmca-status-bar-fallback` (`:88-91`) and the `MmcaNavigationBar/<px>` token into
   `--mmca-navigation-bar-fallback` (`:93-96`), both appended on Android
   (`MainPageBase.cs:139-140`). Each head carries a repo-local fitness
   test, `MauiHostShellTests.HostPage_DoesNotPaintALightBackgroundBeforeTheThemeApplies`, that fails
   when the host page would paint the default light surface before the theme applies. Store's
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Ui/MauiHostShellTests.cs:36-64`)
   accepts any one of three routes (`:62`): a transparent `html`/`body`, a
   `prefers-color-scheme: dark` aware one that also paints a page background (`:49`), or the
   pre-paint seed, which holds when the script runs ahead of every stylesheet, Common's `app.css` is
   linked, and no host-local `html`/`body` rule paints a background outside a `data-mmca-theme`
   selector (`:55-60`). Store's host `app.css` has
   no `html`/`body` rule, so the seed is the route in use there. The MAUI head also links Store's
   `store.css` after `app.css` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/wwwroot/index.html:21`),
   whose `body` rule paints `var(--casa-page)`
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/wwwroot/store.css:117-118`); Common's
   `html[data-mmca-theme=...] body` selectors (`MMCA.Common.UI/wwwroot/app.css:110`, `:115`, `:124`)
   are more specific than that bare `body` selector, so the pre-paint seed still wins. The test reads
   only the inline styles and the head's own `app.css` (`MauiHostShellTests.cs:40-41`, `:163`), so it
   does not see `store.css`. ADC's
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Ui/MauiHostShellTests.cs:43-83`)
   requires the pre-paint route itself: `theme-prepaint.js` loaded as a classic script (`:54-56`) in
   `<head>` (`:59`) ahead of the first stylesheet (`:60-63`), and Common's `app.css` linked
   (`:65-67`); it then checks only inline `<style>` blocks for a light `html`/`body` background
   (`:69-82`). Because the script-tag assertion is unconditional, removing `theme-prepaint.js` from
   ADC's `index.html` fails the test. The head's own linked stylesheets
   (`_content/MMCA.ADC.Conference.UI/adc-ui.css` and `MMCA.ADC.UI.styles.css`,
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/wwwroot/index.html:11-12`) are not read by the test. After marking
   the page interactive, `OnAfterRenderAsync` also calls the opt-in `ColorModeStamp.ApplyAsync`
   (`MmcaThemeProviders.razor:76`, and again after every theme change at `:127`, inside
   `RerenderSafeAsync`, `:115-137`): with `Layout:StampColorModeOnDocument` set (a `bool` that
   defaults to false, `LayoutSettings.cs:51`) it stamps
   `<html data-mmca-color-mode="light|dark">` for an app's own stylesheet (`ColorModeStamp.cs:24-35`),
   best-effort: it catches `JSException`, `JSDisconnectedException` and `InvalidOperationException`
   inline (`ColorModeStamp.cs:37`) rather than through `ThemeInterop.TryAsync`. It is deliberately a
   separate attribute (`theme.js:91-93`, `:96`) from the pre-paint `data-mmca-theme` (stamped at
   `theme-prepaint.js:73`) and runs only after an interactive render, so it does not close the
   web-head first-paint flash. A MAUI head can stamp it before the first paint as well: when the
   script tag carries `data-stamp-color-mode` (`theme-prepaint.js:15-21`, `:26`), the pre-paint also
   stamps `data-mmca-color-mode` with the same mode (`:74-76`; documented at `LayoutSettings.cs:45-47`).
   All three Store heads opt in. The server web head sets it in its `Layout` section
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:26-32`, `:31`), and the WASM
   client, which carries no `Layout` section of its own
   (`MMCA.Store.UI.Web.Client/wwwroot/appsettings.json:8-9`), receives it through `/client-config`,
   which forwards `LayoutSettings` (`MMCA.Common.UI.Web/ClientConfig/ClientConfigUiSections.cs:39`;
   `MMCA.Store.UI.Web/appsettings.json:23-25`). The MAUI head sets it too
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/appsettings.json:21`) and loads the pre-paint script
   with `data-stamp-color-mode` (`MMCA.Store.UI/wwwroot/index.html:15`). `store.css`, which the MAUI
   head links too (`MMCA.Store.UI/wwwroot/index.html:21`), keys its dark roles on the attribute
   (`MMCA.Store.UI.Web/wwwroot/store.css:89-94`), so on the Store web heads those roles share the
   post-interactive timing, while on the Store MAUI head they apply in the first frame. Store's
   `MauiHostShellTests.HostPage_PrepaintScriptOptsIntoTheColorModeStamp` (`MauiHostShellTests.cs:132-146`)
   pins that opt-in. ADC and Helpdesk do not opt in.

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
  `#1A2027` (`:117`), not against `BrandColors.DarkBackground`. The surface colors are restated by hand in
  three places no test compares to `BrandColors.LightBackground`/`DarkBackground` (`BrandColors.cs:66`,
  `:136`): the pre-paint tokens `--mmca-prepaint-background-light/dark`
  (`MMCA.Common.UI/wwwroot/app.css:96-97`, whose comment at `:93-95` says they mirror the values a
  head's `MainPage.xaml` uses natively) and the native page background of each MAUI head
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml:8`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MainPage.xaml:8`, both
  `AppThemeBinding Light=#FAFBFC, Dark=#1A2027`), so those copies can drift unnoticed.
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

## Revision (2026-10-31)
Re-verified against current source. The `ColorModeStamp` step, its opt-in default and the MAUI
pre-paint route are unchanged; what moved is which Store heads opt in and what the MAUI host page
links.
1. Decision 3: all three Store heads opt in, not only the two web heads: the MAUI head sets
   `StampColorModeOnDocument` too (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/appsettings.json:21`)
   and links `store.css` (`MMCA.Store.UI/wwwroot/index.html:19`), so its dark roles follow the
   attribute as the web heads' do. The 2026-10-28 statement that both Store web heads opt in no
   longer describes the full set.
2. Decision 3: the MAUI head's `store.css` carries a `body` background rule (`store.css:117-118`),
   which Common's more specific `html[data-mmca-theme=...] body` selectors (`app.css:110`, `:115`,
   `:124`) outrank, so the pre-paint seed is still the route in use; Store's
   `MauiHostShellTests` reads only the host `app.css` and inline styles (`:24-26`).
3. Anchors re-verified against current source: the web-head opt-ins at
   `MMCA.Store.UI.Web/appsettings.json:28` and `MMCA.Store.UI.Web.Client/wwwroot/appsettings.json:27`
   (superseding `:27` and `:26`), and the deliberately distinct attribute at `theme.js:91-93` (the
   comment) and `:96` (the `COLOR_MODE_ATTRIBUTE` constant), superseding `:83-84` and `:87`;
   `store.css:89-94`, `theme-prepaint.js:42`, Store `index.html:13` and
   `MauiHostShellTests.cs:40-45`, `:47` unchanged.

## Revision (2026-11-23)
Re-verified against current source. The binding, the `ThemeService` preference model, the startup
initialization path, the web-head flash scope and the `ColorModeStamp` opt-in default are
unchanged; what moved is the MAUI host pre-paint script, the ADC host-page fitness test and the
Store opt-in mechanics.
1. Decision 3: `theme-prepaint.js` no longer reads only WebView storage. Its theme block
   (`theme-prepaint.js:22-77`) takes the native `MmcaTheme/<dark|light>` user-agent token first
   (`:34-42`) on the first page of a WebView session (`sessionStorage`, `:36`, `:39`), then
   localStorage (`:46-52`), then the cookie (`:54-67`), then the OS scheme (`:69-71`), and stamps
   `data-mmca-theme` at `:73`. `MainPageBase` appends the token on Android, iOS and MacCatalyst
   (`MMCA.Common.UI.Maui/MainPageBase.cs:138-145`, `:190-197`, `:200-212`). The statement that the
   host pre-paint reads no native value, and the cookie-before-localStorage order, no longer hold.
2. Decision 3: a `data-stamp-color-mode` attribute on the script tag (`theme-prepaint.js:15-21`,
   `:26`) makes the pre-paint also stamp `data-mmca-color-mode` (`:74-76`;
   `LayoutSettings.cs:45-47`). Store's MAUI head sets it (`MMCA.Store.UI/wwwroot/index.html:15`),
   so `store.css`'s dark roles apply there in the first frame, and Store pins it with
   `HostPage_PrepaintScriptOptsIntoTheColorModeStamp` (`MauiHostShellTests.cs:132-146`). The
   post-interactive timing still holds on the web heads.
3. Decision 3: the non-theme block (`theme-prepaint.js:87-97`) also sets
   `--mmca-navigation-bar-fallback` from `MmcaNavigationBar/<px>` (`:93-96`; `MainPageBase.cs:140`).
4. Decision 3, Rationale and Related: ADC's `MauiHostShellTests` (`:43-83`) now requires
   `theme-prepaint.js` as a classic script in `<head>` ahead of the first stylesheet (`:54-63`) and
   Common's `app.css` linked (`:65-67`), then checks only inline styles (`:69-82`); ADC's host
   `wwwroot` no longer carries an `app.css`, so its `prefers-color-scheme` fallback and its
   `#FAFBFC`/`#1A2027` copies are gone. Both consumer tests now recognize the pre-paint script; the
   2026-10-21 Status sentence that only Store's does, and the Rationale's two hand-restated places
   (now three: `app.css:96-97` and each MAUI head's `MainPage.xaml:8`, which the earlier count
   left out), are superseded.
5. Decision 3: the Store WASM client's `wwwroot/appsettings.json` has no `Layout` section
   (`:8-9`); it still opts in, through `/client-config` forwarding of `LayoutSettings`
   (`MMCA.Common.UI.Web/ClientConfig/ClientConfigUiSections.cs:39`), from the server head's
   setting (`MMCA.Store.UI.Web/appsettings.json:31`).
6. Decision 3: `ColorModeStamp` does not call `ThemeInterop.TryAsync`; it catches `JSException`,
   `JSDisconnectedException` and `InvalidOperationException` inline (`ColorModeStamp.cs:37`).
7. Anchors re-verified against current source: shared `MainLayout.razor:17` (superseding `:16`);
   `MMCA.Common.UI.Maui/DependencyInjection.cs:69` (superseding `:68`); `ThemeService.cs:53-56`,
   `:72-73`, `:82-84`, `:90` (superseding `:61-62` and `:64-79`); `MmcaThemeProviders.razor:90-106`
   and `:127` (superseding `:90-104` and `:125`); `LayoutSettings.cs:51` (superseding `:68`); Store
   `index.html:15` and `:21` (superseding `:13` and `:19`); Store `MauiHostShellTests.cs:36-64`,
   `:62`, `:55-60`, `:40-41` (superseding `:21-49`, `:47`, `:40-45`, `:24-26`);
   `MmcaThemeProviders.razor:14`, `:36`, `:38`, `:50`, `:76`, `app.css:96-97`, `:100-126`, `:110`,
   `:115`, `:124`, `BrandColors.cs:66`, `:136`, `store.css:89-94`, `:117-118`, `theme.js:91-93`,
   `:96`, ADC `index.html:8` and Store MAUI `appsettings.json:21` unchanged.

## Related
[ADR-027](027-multi-locale-i18n.md) (shares the cookie source-of-truth and the `User` preference migration,
and is the model for the theme no-flash SSR bootstrap that is not yet wired),
[ADR-022](022-browser-session-cookie-auth.md) (the SSR cookie-read pattern),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function framework; the shared
`MMCA.Common.Testing.Architecture` package carries no theme base, and the theme host-page assertion
lives in each consumer's own `MauiHostShellTests`, both of which recognize the pre-paint script, see
Decision 3).
