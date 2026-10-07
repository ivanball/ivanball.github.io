# ADR-027: Multi-Locale Internationalization (Supersedes ADR-011)

## Status
Accepted (2026-06-27, amended 2026-07-02, 2026-07-03, 2026-07-09, 2026-07-29, and 2026-09-15: the MudBlazor localization interceptor is replaced so no dependency assigns the current culture on a hybrid head; corrected 2026-08-01: the pseudo-locale CI gate is required on all three browser engines, and the hybrid applier sets only the thread defaults; revised 2026-10-01: four statements corrected to match the code; revised 2026-10-06: displayed times follow the viewer's clock except a conference schedule, which follows the event's own time zone (Decision 11), and client-synthesized HTTP failures localize by error code). **Supersedes [ADR-011](011-single-locale-i18n.md)** (single-locale by design).

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
   resource base name is its full type name and the `.resx` lives next to it (`ChangePasswordCard.razor` ->
   `ChangePasswordCard.resx` / `ChangePasswordCard.es.resx` under
   `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/`; a `*.Resources.SharedResource`
   marker for cross-cutting chrome, which pages such as `Login.razor` inject instead of owning a pair). Keys
   are dotted and stable (`Nav.Home`, `Common.Button.Cancel`). Parameterized text uses **composite format
   keys** (`"Error loading {0}."`) consumed as `L["Common.Error.Load", entity]`: never string
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
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:62-70`,
   localization at `:66`), and `ProblemDetailsResultReader` reads those machine fields back on the
   client (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:373-385`).
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
   renders `/login`, `/register`, `/forgot-password`, `/reset-password`, and `/components` under it
   (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/PseudoLocalizationE2ETests.cs:31`),
   asserting (a) the bracket sentinel appears (every displayed string made the resource round-trip;
   the sentinel check is retried up to three times, `:40`) and (b) the page does not overflow
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
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:19-29`, the
   pass-through lookup at `:376-385`). The one exception is a failure the client synthesized itself,
   with no server-phrased message to pass through (a bodiless HTTP status, a transport failure, a
   client timeout): `LocalizeError` looks that up by its error **code** instead (`Http.{status}`, then
   the generic `Http.Status` format, `Http.TransportFailure`, `Http.Timeout`), falling back to the
   English message when no key exists (`:339-365`, the code branches at `:346-362`).
   `ErrorMessages.LoadError` / `SaveError` / `DeleteError` cover the narrow
   remainder, and the type says so: they are for the exceptions a page can still raise on its own
   behalf (a JS-interop failure, a mapping bug, a callback the page supplied), never for a server
   answer (`.../MMCA.Common.UI/Pages/Common/ErrorMessages.cs:14-22`). Every one of them renders the
   localized template for its entity noun; the exception's own `Message` reaches the resource as a
   second format argument that the shipped templates deliberately ignore, because raw exception text
   is neither localizable nor safe to surface (`:49-65`).

   `NavItem` carries a required `TitleResource` type in positional slot 4
   (`.../MMCA.Common.UI/Common/NavItem.cs:20`): the shared `NavMenu` treats `Title` and `Group` as
   resource keys resolved against it per circuit at render time, so module nav menus follow the
   active culture, and a key the resource type does not declare renders as the raw string rather
   than as a blank entry (`:13-18`). MudBlazor's own component chrome localizes through
   `ResxMudLocalizer` over the `MudTranslations` resource pair (MudBlazor's own `LanguageResource`
   keys as of v9.6.0, en + es, `.../MMCA.Common.UI/Resources/MudTranslations.cs:7-8`), registered in `AddUIShared` and covered by the same completeness gate.

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

    **The thread-defaults-only rule binds the dependencies too (amended 2026-09-15).** The rule
    above only holds if NO code on the render path assigns `CurrentCulture`/`CurrentUICulture`, and
    MudBlazor 9.7+ does: its `DefaultLocalizationInterceptor` reads the built-in English strings by
    assigning `CurrentUICulture` to the invariant culture and then assigning the previous value back
    (so it never probes for a `MudBlazor.resources` satellite under a non-English culture). The
    restore is itself an `AsyncLocal` write, so the calling thread leaves that read carrying an
    explicit culture. On a hybrid head the renderer dispatches on the process's main thread, which
    nothing ever resets, and the first MudBlazor chrome string a page rendered (a pager label, the
    notification badge, a dialog close button) pinned the app to its launch language: the applier set
    the defaults to `es`, the WebView reloaded, and every render still resolved `en-US`. Anonymous
    landing pages render almost no MudBlazor chrome while signed-in pages do, which is why it surfaced
    as "switching works signed out but not signed in"; a web head never sees it because request
    localization sets the culture per request and a browser reload discards the WASM runtime.
    `AddUIShared` therefore replaces the interceptor with `InvariantMudLocalizationInterceptor`
    (`MudBlazor.Services.AddLocalizationInterceptor`, replace semantics, so registration order against
    `AddMudServices` does not matter): the same resolution order as the default (an English UI culture
    or no `MudLocalizer` reads the built-ins; any other culture asks `ResxMudLocalizer` and falls back
    to the built-in string), with the built-ins read through a `ResourceManager` under an explicit
    invariant culture, which is what the swap was for, without any culture assignment. A canary test
    (`InvariantMudLocalizationInterceptorTests`) asserts that MudBlazor's default still writes the
    `AsyncLocal`, so the replacement is retired the day upstream stops. The general rule for the
    hybrid head: audit every dependency on the render path for `set_CurrentUICulture` /
    `set_CurrentCulture` (the shipped assemblies name the setter in their string heap, so a grep of
    the trimmed output finds callers) before trusting a culture switch to land.

    Precedence mirrors the web deliberately: the persisted choice (the cookie's analogue), then the
    device locale (`Accept-Language`'s analogue), then `SupportedCultures.Default`. Matching a device
    locale needs the same language fallback request localization does, so
    `SupportedCultures.ResolveClosest` supplies it for the hybrid head (`es-MX` resolves to `es`), and it
    never returns the pseudo locale
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:51`, called from
    `.../MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:43`); web heads keep the parent-culture
    matching of ASP.NET request localization (`UseCommonRequestLocalization`,
    `.../MMCA.Common.API/Startup/WebApplicationExtensions.cs:73-93`). The active culture still reaches the services as `Accept-Language`: the
    hybrid head already shares `CultureDelegatingHandler` through `AddUIShared`, so once
    `CurrentUICulture` is right, localized backend errors follow with no extra wiring.

11. **Displayed times follow the viewer's clock, except a schedule, which follows the event's own
    zone (added 2026-10-06).** Instants are stored and serialized in UTC. `MMCA.Common.UI` renders
    them on the viewer's clock through `ViewerTimeZone`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Culture/ViewerTimeZone.cs:18`, registered
    by `AddUIShared` at `.../MMCA.Common.UI/DependencyInjection.cs:190`): it reads the browser's IANA
    zone once per scope through JS interop and resolves it with `TimeZoneInfo` (`:49-87`, `:122-125`);
    until then, during SSR prerender, on a host without JS, or for an id the runtime does not know,
    every conversion uses UTC (`:32`). The server's own zone is never used, because on Blazor Server
    and during prerender `DateTime.ToLocalTime` is the server's clock (`:13-16`). Formatting uses
    `CurrentCulture` (`:112-113`), so Decision 7 still governs the shape of the string. Common's own
    pages use it (notifications, sessions), and so do Store's (`ReviewList`, `ProductReviewsPanel`,
    `OrderSummaryPanel`, for example
    `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/OrderSummaryPanel.razor.cs:24`)
    and ADC's non-schedule pages (points, check-ins, user administration). Helpdesk source references
    no `ViewerTimeZone` of its own; the Common pages it hosts carry the rule.

    A conference schedule is the one place-bound fact: a session starts at 10:00 in the venue's zone
    for everyone, wherever they read it. MMCA.ADC therefore shows schedule times in the event's own
    IANA zone. Session times are wall-clock local to that zone in the DTOs, never UTC
    (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/HappeningNow/SessionReminderPlanner.cs:32-39`,
    which converts them to instants only to schedule reminders); the live window is computed from the
    event's zone (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:66-76`,
    zone lookup at `:74`), and the UI carries that zone in `LiveEventContext`
    (`.../MMCA.ADC.Engagement.UI/Services/SessionLive/LiveEventContext.cs:13-31`), whose
    `ToEventLocal` puts the current instant on the event's clock to compare with the schedule. The rule:
    a schedule is shown in the event zone; everything else is viewer-relative.

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

## Revision (2026-10-01)
No decision or rationale changed; four statements were corrected to match the code and several
citations were refreshed. Decision 2: the composite-key example now matches the shipped
`Common.Error.Load` value `"Error loading {0}."` (`.../MMCA.Common.UI/Resources/SharedResource.resx:82-83`),
which takes the entity noun alone as Decision 9 states, and the example key is `Common.Button.Cancel`
(`:268`) because no `Common.Button.Save` key exists. Decision 8: the pseudo-locale gate scans five pages,
not three (`PseudoLocalizationE2ETests.cs:31`), and retries the sentinel check (`:40`). Decision 9: the
`MudTranslations` pair mirrors MudBlazor `LanguageResource` keys as of v9.6.0 (`MudTranslations.cs:7-8`)
while the pin is 9.11.0 (`MMCA.Common/Directory.Packages.props:180`), so it is no longer described as
covering every key of the pinned version. Decision 10: `SupportedCultures.ResolveClosest` is called only by
the hybrid head (`MauiCultureStore.cs:43`); web heads use request localization's own parent-culture
fallback (`WebApplicationExtensions.cs:73-93`). Refreshed anchors: `ProblemDetailsResultReader.cs:344-356`
(was 342-354), `ResultUiExtensions.cs:329-338` (was 325-334), `NavItem.cs:20` and `:13-18` (were 16 and 9-14).

## Revision (2026-10-06)
- Decision 11 added: displayed instants follow the viewer's clock (`ViewerTimeZone`, UTC fallback
  during prerender, the server zone never used), while an ADC conference schedule follows the event's
  own IANA zone; Store and ADC non-schedule pages use the viewer clock, Helpdesk inherits it from the
  Common pages.
- Decision 9: client-synthesized failures (a bodiless HTTP status, a transport failure, a timeout)
  localize by error code (`Http.{status}`, `Http.Status`, `Http.TransportFailure`, `Http.Timeout`)
  before the message pass-through; the earlier text described pass-through only.
- Decision 2: the co-location example is now `ChangePasswordCard.razor` with its `.resx` pair; no
  `Login.resx` exists (`Login.razor:22` injects `IStringLocalizer<SharedResource>`).
- A stray closing code fence at the end of the file was removed.
- Anchors re-verified against current source: `ErrorHttpMapping.cs:62-70` / `:66` (were 61-69 / 65),
  `ProblemDetailsResultReader.cs:373-385` (the 2026-10-01 `:344-356` is stale), `ResultUiExtensions.cs:19-29`
  and `:376-385` (the 2026-10-01 `:329-338` is stale); the MudBlazor 9.11.0 pin recorded above now sits
  at `MMCA.Common/Directory.Packages.props:176`.

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
