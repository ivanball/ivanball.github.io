# One preference, two switches: shipping i18n and dark mode on a single cookie-and-profile pipeline

> Series: MMCA.Common · Article #38 (deep-dive) · Pillar P2/P5 · Group G15 · Rubric §27 · ADR-027/028 ·
> Status: grounded in `Website/docs-src/adr/027-multi-locale-i18n.md`, `Website/docs-src/adr/028-dark-theme-mode.md`,
> `MMCA.Common.Shared/Globalization/SupportedCultures.cs`,
> `MMCA.Common.API/Localization/ErrorLocalizer.cs`,
> `MMCA.Common.UI/Theme/ThemeService.cs`. No em dashes.

**Subtitle:** A user picking Spanish and a user picking dark mode are doing the same thing: stating a per-user preference that has to survive a page refresh, three render modes, and a trip across the Gateway. So they should share one persistence path, not two. Here is how a culture choice and a theme choice ride the same cookie, the same profile column, and the same login reconciliation.

---

Most teams bolt i18n and dark mode onto a Blazor app late, and both go badly the same way. The strings turn out to be hardcoded in a hundred views, so "add Spanish" becomes a hundred edits. The error messages are worse, because they come back from the API already rendered in English, so even a fully translated front end shows "Phone number is required" in the wrong language the moment a form fails. And the theme, the supposedly easy one, flips per browser tab and forgets the choice on refresh, because the toggle wrote to a field in memory that did not outlive the circuit.

Three symptoms, one missing idea. A locale and a theme are not two features. They are two instances of the same feature: a small per-user preference that has to be readable before the first paint, consistent across the static-server render, the interactive Server circuit, and the WebAssembly client, and durable across a refresh and across devices. The hard part was never the translation files or the second color palette. The hard part is making one decision flow through everything without a flash of the wrong state.

MMCA.Common ships these two as exactly that: one preference pipeline, used twice. ADR-027 added multi-locale internationalization (it supersedes ADR-011, which records single-locale as a deliberate, revisitable non-goal), and ADR-028 added the day/dark theme toggle on top of the same machinery. The theme ADR does not invent its own persistence. It reuses the cookie, the profile column, and the login reconciliation that i18n built.

## Why it matters

Count the places a preference has to be true at once. The static prerender pass renders HTML on the server before any JavaScript runs. The interactive Server circuit takes over. Then in an `InteractiveAuto` app, WebAssembly downloads and takes over again. If the preference lives only in the WASM runtime, the first two passes render in the wrong language or the wrong theme and then snap. If it lives only on the server, the WASM client cannot read it before it paints. The only state every one of those runtimes can read before first paint is a non-HttpOnly cookie, which is why the cookie, not a service field, is the source of truth.

Then there is the Gateway. The UI talks to cross-origin REST services behind a YARP gateway that does not forward the culture cookie to the services. So a backend validation failure would localize against the service's default culture, not the user's, unless the UI deliberately carries the culture forward on every call. A preference that stops at the browser is not actually a preference; it has to reach the edge that produces the error text.

Theme has the identical shape. Different runtimes, same need to agree before first paint, same need to persist past a refresh and follow the user to another device. Building a second, subtly different mechanism for it would be two places to get the prerender handoff wrong instead of one.

## The MMCA answer: one preference pipeline, used twice

### Internationalization, keyed on a code you already have

Supported cultures are an explicit allowlist, not an open-ended capability. `SupportedCultures` (`MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`) holds `Default = "en-US"` (`:12`) and `All = [Default, "es"]` (`:18`), with an `IsSupported` guard (`:35`) that matches case-insensitively. That one list is the single allowlist the request-localization options, the culture switcher, and the profile guard all read, so they cannot drift apart. Adding a locale is adding one entry here plus the translated resource files, not new infrastructure.

Strings are externalized to `.resx` co-located with the type that uses them and looked up through `IStringLocalizer<T>`, so a view asks for `L["Common.Button.Save"]` rather than carrying English inline. That is the ordinary part. The interesting part is the errors, because errors are produced on the server and a translated client cannot fix them.

The Result pattern (ADR-013) already gives every `Error` a stable machine `Code`. That turns server-side error localization into a keyed lookup instead of a rewrite. `IErrorLocalizer` (`MMCA.Common.API/Localization/IErrorLocalizer.cs:9`) declares a single method, `Localize(string code, string fallbackMessage)` (`:17`). The default implementation, `ErrorLocalizer` (`MMCA.Common.API/Localization/ErrorLocalizer.cs:11`), walks an ordered set of registered `ErrorResourceSource`s (`ErrorResourceSource.cs:12`), Common first then modules, looks the code up against the current UI culture, and returns the original English message untouched when no source has the key (`ErrorLocalizer.cs:32`). An untranslated code degrades gracefully to English; it never throws.

This happens at one place, the single Result-to-ProblemDetails projection point. `ErrorHttpMapping.BuildErrorsExtension` (`MMCA.Common.API/Middleware/ErrorHttpMapping.cs:61`) projects each error, and only the human-readable `Message` is run through the localizer, keyed by `Code` (`:65`); the machine fields (`Code`, `Type`, `Source`, `Target`) stay verbatim so clients can still branch on them. A `null` localizer leaves the English message unchanged. Domain code, handlers, and `Result` signatures never change. They stay culture-agnostic. Only the edge speaks a culture.

One cookie ties the runtimes together. The UI hosts run `UseRequestLocalization` over the `SupportedCultures` list with a cookie provider, so the static prerender already renders in the right culture. The WASM client reads the same cookie on startup through `MmcaCultureBootstrap.SetBrowserCultureAsync` (`MMCA.Common.UI/Services/Culture/MmcaCultureBootstrap.cs:22`) and sets the thread culture before the app runs, so prerender and hydration agree. And `CultureDelegatingHandler` (`MMCA.Common.UI/Services/Culture/CultureDelegatingHandler.cs:13`) stamps the active culture onto every outgoing API call as an `Accept-Language` header (`:24`), which is the channel that makes the cross-origin services return their errors in the chosen language. The `CultureSwitcher` component (`MMCA.Common.UI/Globalization/CultureSwitcher.razor:9`) iterates `OfferedCultures` (`:13`) to render the menu: `SupportedCultures.All` plus a Development-only pseudo-localization locale (`:24-27`, ADR-027 §8) that surfaces hard-coded strings and truncation and never ships to production.

The runtime channel is the cookie; the cross-device source of truth is the profile. A user's chosen culture persists to the Identity `User` aggregate as `PreferredCulture` (in the consumer apps' Identity module, for example `MMCA.ADC.Identity.Domain/Users/User.cs:108`, validated by `UserInvariants.EnsurePreferredCultureIsValid`, invoked inside `UpdatePreferences` at `:333`). On login the cookie is set from the profile; an authenticated switch writes both; an anonymous user gets only the cookie.

### Theme, riding the same rails

Now the payoff. The theme toggle does not build any of that again.

`MMCATheme` (`MMCA.Common.UI/Theme/MMCATheme.cs:9`) defines a complete `PaletteDark` (`:56`) next to `PaletteLight` (`:13`), and ADR-028 is what wires those dark surfaces to a live toggle. `MainLayout` renders one dedicated `MmcaThemeProviders` component (`MMCA.Common.UI/Layout/MainLayout.razor:14`), and that component is where the provider binds two-way against that complete theme: `<MudThemeProvider Theme="@Theme" @bind-IsDarkMode="_isDarkMode" />` (`MMCA.Common.UI/Theme/MmcaThemeProviders.razor:12`). `Theme` is an optional component parameter that defaults to `MMCATheme.Instance` (`:34`), so the framework palette is what every host gets by default and an app that wants its own brand passes a derived `MudTheme` instead of duplicating the whole provider block. No new palette work.

`ThemeService` (`MMCA.Common.UI/Theme/ThemeService.cs:17`) owns the preference, and it persists to the exact same kind of store i18n uses: a non-HttpOnly cookie plus localStorage, written through `theme.js`. `InitializeAsync` (`:35`) reads the stored value and, only when nothing is stored, falls back to the OS preference (`:46`). `SetDarkModeAsync` (`:54`) sets the field, persists, and raises `OnChange` (`:29`) so the app-bar toggle and the layout stay in sync; `ToggleAsync` (`:63`) just flips it. The JavaScript module is tiny: `get()` reads the cookie then localStorage (`theme.js:5`), `set()` writes a year-long `samesite=lax` cookie plus localStorage (`:23`), and `systemPrefersDark()` is one `matchMedia('(prefers-color-scheme: dark)')` call (`:33`).

The toggle ships in the shared `MainLayout` right next to the culture switcher, both in the app-bar `appbar-icon-actions` slot (`MainLayout.razor:33-36`), so every consuming host gets both controls with no per-host wiring. `ThemeToggle` (`MMCA.Common.UI/Theme/ThemeToggle.razor:7`) calls `ThemeService.ToggleAsync()` and then best-effort writes the choice to the signed-in user's profile through an optional `IUserPreferenceWriter` (`:23`), which is a no-op when anonymous. The profile column is `User.PreferredTheme` (`MMCA.ADC.Identity.Domain/Users/User.cs:111`), folded into the *same* migration and governed by the *same* login-reconciliation rule as `PreferredCulture`. One migration, one persistence model, two preferences.

## The pipeline, in one sketch

This is illustrative-of-shape, condensed from the files above to put the shared pipeline in one view, not a verbatim paste:

```csharp
// i18n: localize the error at the single edge projection, keyed by the stable Code,
// falling back to the original English message when no resource key matches.
Message = localizer is null ? e.Message : localizer.Localize(e.Code, e.Message);

// theme: same idea of a per-user preference, persisted to the same kind of cookie.
public sealed class ThemeService(IJSRuntime jsRuntime)
{
    public bool IsDarkMode { get; private set; }

    public async Task InitializeAsync()                    // OnAfterRenderAsync(firstRender), never SSR
    {
        var stored = await module.InvokeAsync<string?>("get");           // cookie, then localStorage
        IsDarkMode = stored is not null
            ? string.Equals(stored, "dark", StringComparison.OrdinalIgnoreCase)
            : await module.InvokeAsync<bool>("systemPrefersDark");        // OS default on first visit
    }
}
```

```razor
@* MainLayout.razor: it renders the provider block once via MmcaThemeProviders,
   and both controls sit in one app-bar slot. *@
<MmcaThemeProviders />
...
<span class="appbar-icon-actions">
    <CultureSwitcher />
    <ThemeToggle />
</span>

@* MmcaThemeProviders.razor: the two-way theme binding lives here now, not in MainLayout.
   Theme is an optional parameter defaulting to MMCATheme.Instance. *@
<MudThemeProvider Theme="@Theme" @bind-IsDarkMode="_isDarkMode" />
```

A culture choice and a theme choice enter the same way (a control in the same slot), persist the same way (a non-HttpOnly cookie plus a `User` profile column), and reconcile the same way on login. That is the whole thesis.

## Trade-offs, honestly

- **Coverage is two locales, en-US and Spanish, full stop.** Spanish (`es`) is the one added locale (`SupportedCultures.cs:18`). The mechanism is built to scale (adding a locale is one allowlist entry plus the translated `.resx`), but the shipped coverage today is exactly two. This article does not claim more, and you should not either.
- **The translation gap is gated, not hoped for.** A new English string cannot ship without its Spanish sibling: `ResourceTranslationsAreComplete` (`MMCA.Common.Testing.Architecture/Rules/Ui/ArchitectureRules.Localization.cs:23`, run as `LocalizationResourceTests`) fails the build when any base `.resx` under `Source/` lacks a complete, non-empty translation for a required culture. The rule takes the required-culture list, so it is repo-agnostic and vacuous for a single-locale repo.
- **Culture-less formatting is a build gate, not advice.** Accidentally calling `ToString()` on a date or number without a format provider is caught at compile time: `MA0076` is set to `error` severity in `.editorconfig` (`:592`), so a culture-less interpolation fails the build and must declare an explicit `IFormatProvider`. The posture is blocking: the gate fails, it does not warn.
- **The no-flash SSR bootstrap is wired for locale but not yet for theme.** This is the one honest asymmetry. Locale is flash-free because the server reads the cookie at prerender through `UseRequestLocalization`. Theme is not: `ThemeService.InitializeAsync` runs from `OnAfterRenderAsync(firstRender)` and deliberately does not run during SSR prerender (`ThemeService.cs:35`, and the doc-comment at `:11-14`), so the bound `IsDarkMode` is corrected just after hydration. The cookie is non-HttpOnly precisely so a server prerender could read it, but the server-side emit (a `data-theme` attribute or inline head script written from the cookie before Blazor hydrates) is not yet wired for theme (ADR-028, Decision 3). A brief wrong-theme flash on first paint is therefore currently possible, and closing it is tracked as follow-up.
- **Superseding ADR-011 changes the scorecard, not the scope of the world.** ADR-027 supersedes ADR-011, so multi-locale is in scope and §27 Internationalization is a scored category rather than N/A. That is a real status, and it is still two locales. Do not read "in scope" as "fully internationalized."
- **MudBlazor's own built-in component chrome is localized too.** `ResxMudLocalizer` (`MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17`), a `MudLocalizer` over the `MudTranslations` resource pair (`MMCA.Common.UI/Resources/MudTranslations.resx` + `MudTranslations.es.resx`, en and es entries for the MudBlazor built-in keys), is DI-registered in `AddUIShared` (`MMCA.Common.UI/DependencyInjection.cs:79`), so the pager, filter menus, pickers, and close buttons follow the active culture. Unknown keys fall back to MudBlazor's built-in English and `en-US` deliberately keeps the built-ins. ADR-027 records this wiring as part of the shipped i18n surface (Decision 9).
- **Per-user persistence adds a column to the consumer's Identity `User`.** The framework supplies the cookie, the localizer, the theme service, the `IUserPreferences` contract (`MMCA.Common.Domain/Auth/IUserPreferences.cs:13,16`) and the shared `CommonInvariants.EnsurePreferredCultureIsValid`/`EnsurePreferredThemeIsValid` guards (`MMCA.Common.Domain/Invariants/CommonInvariants.cs:142,158`); the `PreferredCulture`/`PreferredTheme` columns live on each app's `User` aggregate (`MMCA.ADC.Identity.Domain/Users/User.cs:108,111`), with a profile-edit surface to set them. It is one folded migration, but it is a column the consumer owns, not free.

None of these argue against the design. They argue for finishing it: wire the theme prerender read, keep the translation gate green, and be clear-eyed that "internationalized" here means en-US and Spanish, persisted correctly, not every locale on earth.

## Apply this even without MMCA

The moves port to any component framework with a server-prerender-then-client lifecycle:

1. **Treat locale and theme as the same kind of thing.** Both are small per-user preferences. Give them one persistence model: a non-HttpOnly cookie as the cross-runtime source of truth (the only state every render pass can read before first paint), and a profile column as the cross-device source of truth. Do not build two.
2. **Localize backend errors at the edge, keyed by a stable machine code.** Keep domain and handlers culture-agnostic; translate only the human-readable message at the single response-projection point, and fall back to the original message when a code has no translation so an untranslated string degrades instead of throwing.
3. **Carry the active culture to cross-origin services explicitly.** If a gateway drops your culture cookie, stamp `Accept-Language` on every outbound call, or your translated UI still shows English errors.
4. **Default theme to the OS `prefers-color-scheme`** on first visit, then let an explicit choice win and follow the user.
5. **Guard the gaps with build gates, not vigilance.** An analyzer at error severity for culture-less formatting, and a fitness test for translation completeness, turn "we should remember to translate that" into "the build will not let us forget."
6. **Be honest about the prerender flash.** An `InteractiveAuto`-style app is only truly flash-free when the server emits the preference at prerender. If you read it after first render instead, say so, because a brief flash is the cost until you wire the server-side read.

The takeaway: **a culture switch and a theme switch are the same problem wearing different icons. Persist them on one cookie-and-profile pipeline, localize errors at the one edge that produces them, and gate the gaps with the build. You get two user-facing features for not much more than one mechanism, and the one place the flash is not yet solved is the one place you can point at honestly.**

---

**What we covered:** why late i18n and late dark mode fail the same way, how `SupportedCultures` (en-US + Spanish) anchors an allowlist that the request-localization options, the culture switcher, and the profile guard all share, how `IErrorLocalizer` / `ErrorLocalizer` localize backend errors at the single `ErrorHttpMapping.BuildErrorsExtension` edge keyed by the stable `Error.Code`, how one non-HttpOnly cookie plus `CultureDelegatingHandler`'s `Accept-Language` plus `MmcaCultureBootstrap` keep SSR, Server, and WASM in agreement, how `ThemeService` and a bound `MudThemeProvider` against `MMCATheme.Instance` reuse that exact cookie-and-profile machinery for dark mode, and where the design is honestly unfinished (the theme no-flash SSR read).

**Next in the series:** build your first module the MMCA way, end to end.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the ADRs behind this pattern, or `dotnet add package MMCA.Common.UI` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-027 (multi-locale i18n) and ADR-028 (day/dark theme): `Website/docs-src/adr/` in the docs site.

*Tags: .NET, Blazor, C Sharp, Software Architecture, Programming*

*Notes: verified this run against MMCA.Common v1.205.0 source. i18n: `SupportedCultures` (`Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`, `Default="en-US"` `:12`, `All=[Default,"es"]` `:18`, `PseudoLocale="qps-Ploc"` `:28`, `IsSupported` `:35`); `IErrorLocalizer` (`Source/Presentation/MMCA.Common.API/Localization/IErrorLocalizer.cs:9`, `Localize` `:17`); `ErrorLocalizer` (`.../ErrorLocalizer.cs:11`, English fallback `:32`); `ErrorResourceSource` (`.../ErrorResourceSource.cs:12`); `ErrorHttpMapping.BuildErrorsExtension` (`.../Middleware/ErrorHttpMapping.cs:61`, localizes `Message` keyed by `Code` `:65`); `CultureDelegatingHandler` (`.../UI/Services/Culture/CultureDelegatingHandler.cs:13`, reads `CurrentUICulture.Name` `:20`, writes the `Accept-Language` header `:24`); `MmcaCultureBootstrap.SetBrowserCultureAsync` (`.../UI/Services/Culture/MmcaCultureBootstrap.cs:22`); `CultureSwitcher` (`.../UI/Globalization/CultureSwitcher.razor:9`, iterates `OfferedCultures` `:13` = `SupportedCultures.All` plus the Development-only `PseudoLocale`, `:24-27`); MudBlazor built-in chrome localized via `ResxMudLocalizer` (`.../UI/Globalization/ResxMudLocalizer.cs:17`, a `MudLocalizer` over `IStringLocalizer<MudTranslations>`) backed by `MudTranslations.resx` + `MudTranslations.es.resx` (`.../UI/Resources/`), DI-registered `TryAddTransient<MudLocalizer, ResxMudLocalizer>()` at `.../UI/DependencyInjection.cs:79`, inside `AddUIShared` (`:36`). theme: `ThemeService` (`.../UI/Theme/ThemeService.cs:17`, `OnChange` `:29`, `InitializeAsync` `:35`, OS fallback `:46`, `SetDarkModeAsync` `:54`, `ToggleAsync` `:63`, SSR caveat in the class doc-comment `:11-14`); `theme.js` (`.../UI/wwwroot/theme.js`, `get` `:5`, `set` cookie+localStorage `:23`, `systemPrefersDark` `:33`); `MMCATheme` (`.../UI/Theme/MMCATheme.cs:9`, `PaletteLight` `:13`, `PaletteDark` `:56`); `MainLayout` (`.../UI/Layout/MainLayout.razor`, renders `<MmcaThemeProviders />` `:14`, both controls `CultureSwitcher`/`ThemeToggle` `:33-36`; MainLayout is 114 lines and has NO `OnAfterRenderAsync`); the provider two-way binding and the first-render init live in the dedicated `MmcaThemeProviders` component (`.../UI/Theme/MmcaThemeProviders.razor:12` `<MudThemeProvider Theme="@Theme" @bind-IsDarkMode="_isDarkMode" />`, with `[Parameter] public MudTheme Theme { get; set; } = MMCATheme.Instance;` at `:34`; `OnInitialized` wires `ThemeService.OnChange` at `:39`; `OnAfterRenderAsync(bool firstRender)` init `:41-52` calling `ThemeService.InitializeAsync()` at `:46`); `ThemeToggle` (`.../UI/Theme/ThemeToggle.razor:7`, `IUserPreferenceWriter` `:23`). gates: `MA0076 = error` (`MMCA.Common/.editorconfig:592`); `ResourceTranslationsAreComplete` (`.../Testing.Architecture/Rules/Ui/ArchitectureRules.Localization.cs:23`), run as `LocalizationResourceTests` (`Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/LocalizationResourceTests.cs:12`). framework-side preference contract: `IUserPreferences` (`Source/Core/MMCA.Common.Domain/Auth/IUserPreferences.cs:13,16`) and `CommonInvariants.EnsurePreferredCultureIsValid`/`EnsurePreferredThemeIsValid` (`.../Domain/Invariants/CommonInvariants.cs:142,158`); the columns themselves live in the consumer Identity module, e.g. `MMCA.ADC.Identity.Domain/Users/User.cs` (`PreferredCulture` `:108`, `PreferredTheme` `:111`), validated inside `User.UpdatePreferences` (`:330`) via `UserInvariants.EnsurePreferredCultureIsValid` invoked at `:333` / `EnsurePreferredThemeIsValid` at `:334`. ADR-027 supersedes ADR-011; ADR-028 reuses ADR-027's cookie/profile machinery and records the theme no-flash SSR read as not wired (Decision 3, verified this run: `ThemeService.InitializeAsync` runs from `MmcaThemeProviders.OnAfterRenderAsync(firstRender)` `MmcaThemeProviders.razor:41-52`, not during SSR). `MA0076` is error-severity (a build gate) and translation coverage is fitness-gated; the MudBlazor built-in-localization follow-up is CLOSED (2026-07-03, ADR-027 Decision 9 + Trade-offs entry `Website/docs-src/adr/027-multi-locale-i18n.md:246-249`), delivered by `ResxMudLocalizer` over the `MudTranslations` en+es pair. Two claims rest on ADRs rather than on source read this run, and the body was left as the ADRs state it: the completeness of the `MudTranslations` pair against MudBlazor's own key list (`027-multi-locale-i18n.md:157-158`, keys not enumerated here) and the login reconciliation that sets the cookie from the profile (`Website/docs-src/adr/028-dark-theme-mode.md:50-53`; no such code found in MMCA.Common or in the ADC consumer this run). The two code blocks are illustrative composition sketches condensed from source, not verbatim files. 2026-09-19 audit sweep: the UI project was reorganized into feature folders, so `CultureSwitcher.razor` moved to `UI/Globalization/`, `MmcaCultureBootstrap.cs` and `CultureDelegatingHandler.cs` to `UI/Services/Culture/`, and `ThemeService.cs`, `ThemeToggle.razor` and `MmcaThemeProviders.razor` to `UI/Theme/`, while `ArchitectureRules.Localization.cs` moved under `Rules/Ui/`; every anchor above was re-pinned against those paths (`ErrorHttpMapping` `:47`->`:61` and `:51`->`:65`, `PaletteDark` `:48`->`:56`, `MmcaThemeProviders` `:11`->`:12`, `:22`->`:34`, `:27`->`:39`, `:29-38`->`:41-52`, `:34`->`:46`, `ThemeService` +1 throughout, `DependencyInjection` `:55`->`:79`, ADC `User.cs` `:100,103`->`:108,111` and `:288`/`:291`/`:292`->`:330`/`:333`/`:334`, the ADR-027 trade-off entry `:196-199`->`:246-249`, MainLayout 111->114 lines).*

- Full series index: https://ivanball.github.io/writing.html
