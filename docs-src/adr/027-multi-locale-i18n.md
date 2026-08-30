# ADR-027: Multi-Locale Internationalization (Supersedes ADR-011)

## Status
Accepted (2026-06-27, amended 2026-07-02, 2026-07-03, 2026-07-09, and 2026-07-29; corrected 2026-08-01: the pseudo-locale CI gate is required on all three browser engines, and the hybrid applier sets only the thread defaults). **Supersedes [ADR-011](011-single-locale-i18n.md)** (single-locale by design).

## Context
ADR-011 recorded single-locale (en-US) as a deliberate, *revisitable* non-goal and sketched what
re-introducing i18n would entail. That revisit has now happened: the framework adds first-class
internationalization so consumers can serve en-US and Spanish (`es`), with the structure to add more
locales later. ADR-011's own "if multi-locale is ever required" scope is the blueprint this ADR
implements; ADR-011 is now superseded, not deleted (the history matters).

The hard part is not translation files: it is making one culture decision flow consistently through a
Blazor `InteractiveAuto` app (SSR prerender → InteractiveServer circuit → InteractiveWebAssembly client)
*and* through the cross-origin REST services behind the Gateway, without a flash of the wrong language or
a prerender/hydration mismatch. The Result pattern (ADR-013) already gives every `Error` a stable
machine `Code`, which makes server-side error localization a keyed lookup rather than a rewrite.

## Decision

1. **Supported cultures are an explicit allowlist: `en-US` (default) + `es`.** Adding a locale is adding a
   `.es.resx` sibling set and one allowlist entry, not new infrastructure.

2. **Strings are externalized to `.resx`, co-located with the type that uses them, looked up by
   `IStringLocalizer<T>`.** `AddLocalization()` is registered with **no `ResourcesPath`** so a type's
   resource base name is its full type name and the `.resx` lives next to it (`Login.razor` →
   `Login.resx` / `Login.es.resx`; a `*.Resources.SharedResource` marker for cross-cutting chrome). Keys
   are dotted and stable (`Nav.Home`, `Common.Button.Save`). Parameterized text uses **composite format
   keys** (`"Error loading {0}. {1}"`) consumed as `L["Common.Error.Load", entity, detail]`: never string
   concatenation. The `.resx` compile to **satellite assemblies** that pack into the NuGet packages
   automatically (no `.csproj` change) and flow identically via `local.props` source mode.

3. **Backend user-facing error text is localized server-side at the HTTP edge, keyed by `Error.Code`.**
   `IErrorLocalizer` (`MMCA.Common.API/Localization`) maps an error's stable `Code` to a localized string
   against `CurrentUICulture`, falling back to the error's existing English `Message` when no resource key
   exists. It is applied at the single Result→ProblemDetails projection point
   (`ErrorHttpMapping.BuildErrorsExtension`, used by `ApiControllerBase.HandleFailure` and
   `UnhandledResultFailureFilter`). **Domain, handler, and `Result` signatures do not change**: they stay
   culture-agnostic; only the edge speaks a culture. Modules register their own resource sources
   (`ErrorResourceSource`) additively; Common registers its own in `AddAPI`. FluentValidation rules carry
   stable `.WithErrorCode("<Area>.<Field>.<Rule>")` codes so validation errors localize through the same
   mechanism.

4. **Only the human-facing `message` is localized; every machine field crosses the wire verbatim.**
   `ErrorHttpMapping.BuildErrorsExtension` localizes `Message` by the stable `Code` and leaves
   `Code`, `Type`, `Source` and `Target` untranslated
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:61-69`,
   localization at `:65`), and `ProblemDetailsResultReader` reads those machine fields back on the
   client (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:342-354`).
   Updated 2026-08-27: the client no longer branches on the ProblemDetails `title` at all. The
   removed `ServiceExceptionHelper` matched three fixed English title strings, which coupled the
   client to wording that could never be translated without breaking it; the reader matches the
   structured `errors` array instead, so the only reason `title` stayed English is gone
   ([ADR-013](013-result-pattern.md)).

5. **One culture cookie is the single source of truth across SSR + Server + WASM.** UI hosts run
   `UseRequestLocalization([en-US, es])` with a `CookieRequestCultureProvider` so SSR prerender renders in
   the right culture; a `/culture/set` endpoint writes the standard ASP.NET culture cookie and forces a
   full reload; the WASM client reads the same cookie on startup (`MmcaCultureBootstrap.SetBrowserCultureAsync`) and sets
   `CultureInfo.DefaultThreadCurrent[UI]Culture` before `RunAsync()`, so prerender and hydration agree.
   The UI forwards the active culture to the API as `Accept-Language` (`CultureDelegatingHandler` on the
   `"APIClient"`), because the cross-origin Gateway does not carry the cookie to the services: that header
   is what makes backend errors come back localized. **This decision covers Blazor Web heads only**; a MAUI
   Blazor Hybrid head has no request pipeline for any of it to run in, which is Decision 10.

6. **A user's chosen culture is persisted to the Identity profile (`User.PreferredCulture`).** The DB value
   is the cross-device source of truth; the cookie is the runtime channel. On login the cookie is set from
   the profile; an authenticated switch persists to both DB and cookie; anonymous users get the cookie only.

7. **Display formatting is culture-aware; machine boundaries stay invariant.** UI rendering of dates /
   numbers uses `CurrentCulture`. `InvariantCulture` is retained where the string is a machine contract
   (JWT timestamps, EF/grid filter parsing, URL/query state, claims, value-object canonical strings).
   Hygiene against accidental culture-less formatting is **enforced as a build gate** (since 2026-06-29):
   the Meziantou analyzer `MA0076` (implicit culture-sensitive `ToString` in interpolation) is set to
   `error` severity in `.editorconfig`, so a culture-less interpolation fails the build and must declare an
   explicit `IFormatProvider` (`CultureInfo.InvariantCulture` at machine boundaries, `CurrentCulture` for
   UI display). This closes the prior "advisory only" follow-up.

8. **Translation completeness is a fitness gate (ADR-015).** `ResourceTranslationsAreComplete`
   (`MMCA.Common.Testing.Architecture`, run as `LocalizationResourceTests` against `SupportedCultures.All`)
   fails the build if any base `.resx` under `Source/` lacks a complete, non-empty sibling for a required
   culture, so a new English string cannot ship without its Spanish translation. Coverage is **verified,
   not assumed**, closing the prior "no missing-key/translation-coverage gate" follow-up. The rule is opt-in
   and repo-agnostic (it takes the required-culture list), so the consumer apps can adopt the same gate for
   their module `.resx`.

   **Locale-addition governance.** Adding a locale is a bounded, gated process: (a) add the culture to
   `SupportedCultures.All`; (b) add the `.<culture>.resx` sibling for every base `.resx`; (c) the coverage
   fitness gate then refuses to build until every key is translated. No other infrastructure change is
   needed: `UseRequestLocalization`, the culture switcher, and the Identity `User.PreferredCulture` guard
   all read `SupportedCultures`, so they cannot drift from the allowlist.

   **Development-only pseudo-localization.** A Windows-standard pseudo-locale, `qps-Ploc`
   (`SupportedCultures.PseudoLocale`), is available as a developer diagnostic and is deliberately kept out of
   `SupportedCultures.All` so the coverage gate never demands a `.qps-Ploc.resx` sibling. It is offered only
   when the host runs in Development: `UseCommonRequestLocalization` adds it to the request-localization
   allowlist under `IsDevelopment()`, and `MapCultureEndpoint` honors it from the culture switcher only under
   the same guard. When it is the active UI culture, a `PseudoStringLocalizerFactory` decorator (registered
   unconditionally, inert under every other culture) runtime-transforms every resolved resource string
   (accents, padding, and a bracket sentinel) so that hard-coded strings, truncation, and string
   concatenation become visible without translating anything. Outside Development it is never offered and the
   decorator stays inert, so it is a build-and-test aid, not a production culture.

   **The pseudo pass is also a required CI gate (since 2026-07-03).** The backend-less gallery host
   (test-only, never packaged) enables `qps-Ploc` unconditionally, and `PseudoLocalizationE2ETests`
   renders `/login`, `/register`, and `/components` under it, asserting (a) the bracket sentinel
   appears (every displayed string made the resource round-trip) and (b) the page does not overflow
   horizontally under the ~40% expansion (the layout-tolerance criterion). The gate is **required on
   all three browser engines**, not just one: `ui-e2e` is a `chromium, firefox, webkit` matrix whose
   legs are each a required merge check, and the run step executes the whole E2E project on every leg
   with no per-class or per-browser filter (only coverage collection is chromium-only). A leak-guard
   test asserts the sentinel is absent under `en-US`. Production hosts are unchanged: they keep
   `qps-Ploc` Development-only.

9. **User-visible literals are kept out of markup and code-behind by a second fitness gate, and
   composed sentences are banned.** `LocalizedTextConventionTestsBase`
   (`MMCA.Common.Testing.Architecture`, subclassed by every repo) scans `Source/**/*.razor{,.cs}` and
   fails the build on hard-coded snackbar messages, page `Title` properties, literal `<PageTitle>`
   markup, literal breadcrumb labels, and `NavItem` rows that carry no `TitleResource`; deliberate
   literals (brand names) are exempted per line with an `i18n: allow` marker. Snackbar text uses
   **whole-sentence keys in the page's own resource pair** (`Snackbar.Created` = "Event created
   successfully." / "Evento creado correctamente."). The framework deliberately offers no
   `Success(entity, action)` helper that composes a sentence from an entity noun and a verb:
   fragment composition cannot translate, because Spanish agreement makes the verb depend on the
   noun ("Evento creado" against "Sesion creada"), so one shared template cannot serve both nouns.
   The shared `Common.Error.Load/Save/Delete` templates take the entity noun alone and never append
   raw `ex.Message`, which is neither localizable nor safe to surface
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:49-65`).

   **Carve-out (2026-07-09, narrowed 2026-08-27): a server message is shown verbatim, and the
   channel that carries it is now the `Result`.** The rule the carve-out exists for is unchanged:
   text the API produced is curated domain wording already localized server-side to the request
   culture (Decision 3, carried by the Decision 5 `Accept-Language` forwarding), so showing it
   verbatim gives the user the actual business rule ("This action is only available while the event
   is live.") instead of a generic failure toast, while raw exception text stays suppressed.

   What changed is where that text arrives. UI HTTP services no longer throw for a server answer,
   so the wording reaches the page inside a failed `Result` and is rendered by
   `ResultUiExtensions.LocalizedErrorMessage` / `NotifyOnFailure` / `OnFailureSetError`, or by the
   shared `ErrorSummary` component, each resolving every message as a resource key **with
   pass-through** so an already-translated server message renders as-is and a client-side message
   that happens to be a key gets translated
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:17-23`, the lookup
   at `:325-334`). `ErrorMessages.LoadError` / `SaveError` / `DeleteError` cover the narrow
   remainder, and the type says so: they are for the exceptions a page can still raise on its own
   behalf (a JS-interop failure, a mapping bug, a callback the page supplied), never for a server
   answer (`.../MMCA.Common.UI/Pages/Common/ErrorMessages.cs:14-22`). Every one of them renders the
   localized template for its entity noun; the exception's own `Message` reaches the resource as a
   second format argument that the shipped templates deliberately ignore, because raw exception text
   is neither localizable nor safe to surface (`:49-65`).

   `NavItem` carries a required `TitleResource` type in positional slot 4
   (`.../MMCA.Common.UI/Common/NavItem.cs:16`): the shared `NavMenu` treats `Title` and `Group` as
   resource keys resolved against it per circuit at render time, so module nav menus follow the
   active culture, and a key the resource type does not declare renders as the raw string rather
   than as a blank entry (`:9-14`). MudBlazor's own component chrome localizes through
   `ResxMudLocalizer` over the `MudTranslations` resource pair (all built-in keys of the pinned
   MudBlazor version, en + es), registered in `AddUIShared` and covered by the same completeness gate.

10. **Applying a culture is host-specific, behind `ICultureApplier`; a hybrid head switches in process
    (amended 2026-07-29).** Decisions 5 and 6 are written around a request pipeline: a cookie, request
    localization, an SSR re-render. A MAUI Blazor Hybrid head has none of them. Its `BlazorWebView`
    serves the app off a local scheme and every path is resolved by the Blazor `Router`, so the shared
    culture switcher's navigation to `/culture/set` matched no page and rendered the **not-found page**:
    the switcher was inert on Android, and the login path (which routes through the same endpoint to
    apply a stored `User.PreferredCulture`) dropped the user on that page right after a successful
    sign-in. Nothing on a hybrid head reads a culture cookie, so writing one could not have helped.

    The mechanism is therefore an extension point, not a hard-coded URL. `ICultureApplier`
    (`MMCA.Common.UI`) is what the switcher and the login page call; `AddUIShared` `TryAdd`s the web
    implementation (`EndpointCultureApplier`, the Decision 5 endpoint round trip, unchanged), and
    `MMCA.Common.UI.Maui` registers `MauiCultureApplier` after it. The hybrid applier persists the
    choice to device preferences, sets `CultureInfo.DefaultThreadCurrent[UI]Culture` and
    **deliberately nothing else** (never the calling thread's `CurrentCulture`/`CurrentUICulture`:
    those setters write to an `AsyncLocal` that flows with the `ExecutionContext` and is restored
    ahead of the thread defaults every time that context is re-entered, so assigning one at startup
    would pin the app to its launch language and a later switch would never take), then force-loads
    the return path: resource strings resolve from `CurrentUICulture` at render time and Blazor has
    no API to re-render a whole tree in place, so re-booting the Blazor app inside the WebView (the
    .NET process, and the culture, survive) is what makes the switch visible. `MauiCultureInitializer`
    (an `IMauiInitializeService`, so it runs inside `MauiAppBuilder.Build()` before any window exists)
    restores the persisted culture at startup through that same thread-defaults-only path, the hybrid
    counterpart to the WASM `MmcaCultureBootstrap`. Both are wired by
    `UseMauiDeviceCapabilities()` so no head can be left half-configured, with `UseMauiCulture()`
    separately callable.

    Precedence mirrors the web deliberately: the persisted choice (the cookie's analogue), then the
    device locale (`Accept-Language`'s analogue), then `SupportedCultures.Default`. Matching a device
    locale needs the same language fallback request localization does, so
    `SupportedCultures.ResolveClosest` now owns it for both (`es-MX` resolves to `es`), and it never
    returns the pseudo locale. The active culture still reaches the services as `Accept-Language`: the
    hybrid head already shares `CultureDelegatingHandler` through `AddUIShared`, so once
    `CurrentUICulture` is right, localized backend errors follow with no extra wiring.

## Rationale
- **Keying error localization on the existing `Error.Code` is the cheapest correct extension point.** The codes are
  already stable and already cross the wire; localizing at the edge keeps the Result pattern pure and means
  an untranslated code degrades gracefully to its English message instead of throwing.
- **A single cookie avoids the InteractiveAuto split-brain.** SSR and WASM run in different runtimes; the
  only state both can read before first paint is a non-HttpOnly cookie, so it is the source of truth.
- **Co-located `.resx` with no `ResourcesPath`** makes the resource base name predictable (the full type
  name) and packs cleanly through the lockstep NuGet pipeline (ADR-016) without per-project MSBuild tweaks.
- **A shared component may not assume a shared host.** The switcher looked correct and worked in every
  web head, which is exactly why the hybrid gap survived: the mechanism was a string literal in a
  component, so nothing in the type system or the tests could notice that one head does not serve that
  URL. Putting the mechanism behind an interface the head supplies makes the difference explicit, the
  same argument ADR-042 makes for device capabilities.

## Trade-offs
- **Every view and every user-facing message is touched**: a large, mostly mechanical sweep, accepted as
  the cost ADR-011 always named.
- **WASM Spanish formatting needs ICU globalization data** (not `InvariantGlobalization`), a payload cost
  on the client bundle.
- **Mixed-language responses are possible during rollout**: an untranslated code falls back to English by
  design, so coverage is incremental rather than all-or-nothing within a release.
- **A hybrid culture switch costs a WebView reload** (Decision 10), where a web head costs an HTTP round
  trip. It re-boots the Blazor app rather than re-rendering in place, so client-side page state is lost,
  accepted because switching language is rare and deliberate. The reload cannot be exercised by the
  bUnit or E2E tiers (neither runs a `BlazorWebView`), so the coverage here is the delegation and the
  resolution order; the reload itself is verified on a device.
- **MudBlazor's own built-in component text** may need a `MudLocalizer` for full coverage; tracked as a
  follow-up rather than blocking. **Closed 2026-07-03:** `ResxMudLocalizer` + the `MudTranslations`
  resource pair now localize the MudBlazor chrome (Decision 9); unknown keys still fall back to
  MudBlazor's built-in English, and `en-US` deliberately keeps the built-ins.

## Related
[ADR-011](011-single-locale-i18n.md) (superseded), [ADR-013](013-result-pattern.md) (the `Error.Code`
this localizes on), [ADR-015](015-architecture-fitness-functions.md) (the i18n gates now live here: the `MA0076` culture-less
formatting build gate and the `ResourceTranslationsAreComplete` translation-coverage fitness rule),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (satellite assemblies ship in the lockstep release),
[ADR-022](022-browser-session-cookie-auth.md) (the SSR cookie pattern this mirrors),
[ADR-028](028-dark-theme-mode.md) (the theme toggle that shares this cookie/profile/bootstrap machinery,
and which needs no hybrid equivalent: it persists through JS localStorage, which a `BlazorWebView` has),
[ADR-042](042-device-capability-abstraction.md) (the head-supplies-the-implementation pattern Decision 10
follows).
```
