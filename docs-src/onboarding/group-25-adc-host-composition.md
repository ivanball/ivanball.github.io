# 25. ADC Application Host, UI Shell & Cross-Module Composition

**What this chapter covers.** Every ADC module described so far, Conference, Engagement, Identity,
Notification, is *consumed* somewhere. This chapter is that somewhere: the **client tier** of ADC,
the code that turns the shared per-module Razor Class Libraries (`MMCA.ADC.{Module}.UI`) and the
framework UI package ([`MMCA.Common.UI`](group-15-common-ui-framework.md)) into actually running
applications, and composes every conference module into one coherent shell. Two application shapes
are built from the same component set: a **Blazor Web** app (Server prerender plus a WebAssembly
client) and a **.NET MAUI Blazor Hybrid** native app for Android, iOS, macOS (Catalyst), and
Windows. The types this group owns are deliberately thin: the two
[`ADCHomePageContent`](#adchomepagecontent) home-content adapters, the MAUI-only services
([`MauiTokenStorageService`](#mauitokenstorageservice),
[`MauiPublicLinkBuilder`](#mauipubliclinkbuilder),
[`AppActionsInitializer`](#appactionsinitializer)), the MAUI-head composition and native entry
surfaces ([`DeviceUIModule`](#deviceuimodule),
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity),
[`NowNextWidgetProvider`](#nownextwidgetprovider) with its local
[`NowNextSnapshot`](#nownextsnapshot)/[`NowNextSession`](#nownextsession) records), and the MAUI
bootstrap chain ([`MauiProgram`](#mauiprogram), [`App`](#app), [`MainPage`](#mainpage), and the
per-OS entry points [`MainActivity`](#mainactivity), [`MainApplication`](#mainapplication),
[`AppDelegate`](#appdelegate), the iOS [`Program`](#program), and the WinUI [`App`](#app)). The
heavy lifting lives below them in the modules and in
[`MMCA.Common.UI`](group-15-common-ui-framework.md); this chapter is about **wiring and hosting**,
the half of "UI architecture" the modules cannot do for themselves. File paths in this chapter are
given as the unit table gives them, relative to `MMCA.ADC/Source/Hosts/UI/`.

**Three hosts, one shared component set.** The central idea, taught in
[primer §2, "Write-once UI, render everywhere"](00-primer.md#2-architectural-styles-this-codebase-commits-to),
is that a page is authored **once** as a Razor component in a module's UI library and then rendered
by every host without per-platform reimplementation. There are three host projects under
`MMCA.ADC/Source/Hosts/UI/`: `MMCA.ADC.UI.Web` (the Blazor **Server** host, SSR prerender plus the
interactive Server circuit), `MMCA.ADC.UI.Web.Client` (the Blazor **WebAssembly** client, compiled
to run in the browser), and `MMCA.ADC.UI` (the **.NET MAUI** host, which packages the same
components into a native app and renders them in a `BlazorWebView`). Read the three composition
roots side by side (`MMCA.ADC.UI.Web/Program.cs:33-90`, `MMCA.ADC.UI.Web.Client/Program.cs:31-68`,
`MMCA.ADC.UI/MauiProgram.cs:59-104`) and the family resemblance is obvious: the same MudBlazor
registration, the same `AddUIShared(builder.Configuration)`, the same four conditional module
registrations, then a short tail of host-specific adapters. `[Rubric §18, UI Architecture]` assesses
cohesive, composable components and a clean host/shell split; `[Rubric §22, Responsive &
Cross-Browser/Device]` assesses that one UI renders correctly across browsers and devices. Both are
embodied by this single-component-set, multi-host design: adding a platform is "add a host that
references the shared libraries," not "fork the UI."

**The shared-vs-host boundary: interfaces in Common, implementations per host.** The reason one
component can run in three places is that everything platform-specific hides behind interfaces
declared in [`MMCA.Common.UI`](group-15-common-ui-framework.md). A component never asks "am I on
MAUI?"; it asks an injected abstraction, and each host supplies the adapter. `[Rubric §1, SOLID]`
(Dependency Inversion) and `[Rubric §3, Clean Architecture]` are visible right here: the shared
library defines the *ports*, the host defines the *adapters*, and the framework depends on nothing
host-specific. **Home-page content**:
[`IHomePageContent`](group-15-common-ui-framework.md#ihomepagecontent) lets the shared `/` route
render an app-specific landing page, and each head registers its own
[`ADCHomePageContent`](#adchomepagecontent) (web `MMCA.ADC.UI.Web/Program.cs:50` and
`MMCA.ADC.UI.Web.Client/Program.cs:43`, MAUI `MMCA.ADC.UI/MauiProgram.cs:73`). **Token storage**:
[`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) abstracts where JWTs
live; this group supplies the MAUI implementation
[`MauiTokenStorageService`](#mauitokenstorageservice)
(`MMCA.ADC.UI/MauiProgram.cs:98`), while the browser heads get
[`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice)
(via `AddCommonServerTokenStorage()`, `MMCA.ADC.UI.Web/Program.cs:63`) and
[`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice)
(`MMCA.ADC.UI.Web.Client/Program.cs:46`). **Form factor** is the same story with three registration
lines: `AddCommonWebFormFactor()`, `AddWasmFormFactor()`, and `AddMauiFormFactor()`
(`MMCA.ADC.UI.Web/Program.cs:83`, `MMCA.ADC.UI.Web.Client/Program.cs:68`,
`MMCA.ADC.UI/MauiProgram.cs:104`), all satisfying the same
[`IFormFactor`](group-26-device-capability-layer.md#iformfactor) contract. OAuth button availability
([`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings), satisfied by
[`ConfigurationOAuthUISettings`](group-15-common-ui-framework.md#configurationoauthuisettings) in
all three heads) and the device-capability layer
([`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) and friends,
`AddBrowserDeviceCapabilities()` on the web heads versus `UseMauiDeviceCapabilities()` on MAUI) work
the same way and are described in [Group 15](group-15-common-ui-framework.md) and the
[Group 26 device-capability layer](group-26-device-capability-layer.md).

**Registration order is load-bearing.** A detail worth internalizing before reading any host's
composition root: `AddUIShared` installs its defaults with `TryAdd`, so an override must be
registered either *before* it (to pre-empt the `TryAdd`) or *after* the module registrations (so
"last registration wins"). Both directions appear here and both are annotated in source.
[`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings) is registered **before**
`AddUIShared` on every head so the social-login buttons appear
(`MMCA.ADC.UI/MauiProgram.cs:62-66`); `UseMauiDeviceCapabilities()` and
`AddBrowserDeviceCapabilities()` run **after** it so their plain `Add` registrations beat the null
defaults (`MMCA.ADC.UI/MauiProgram.cs:68-71`, `MMCA.ADC.UI.Web/Program.cs:45-48`); and
[`MauiPublicLinkBuilder`](#mauipubliclinkbuilder) is registered **after** `AddConferenceUI()` so it
displaces Conference's browser-origin default of
[`IPublicLinkBuilder`](group-21-conference-ui.md#ipubliclinkbuilder)
(`MMCA.ADC.UI/MauiProgram.cs:88-90`). Similarly, the Blazor host registers its dynamic
Content-Security-Policy provider (`AddCommonBlazorCsp()`, backed by
[`BlazorCspPolicyProvider`](group-15-common-ui-framework.md#blazorcsppolicyprovider)) *before*
`AddCommonSecurityHeaders(...)` so it wins over the static default
(`MMCA.ADC.UI.Web/Program.cs:89-90`), feeding the framework's
[`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) over the
[`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider) boundary.

**Which modules are in the build is configuration, not code.** All three heads gate every module UI
behind [`UIModuleConfiguration`](group-15-common-ui-framework.md#uimoduleconfiguration)`.IsModuleEnabled`
(`MMCA.ADC.UI/MauiProgram.cs:76-86` and the matching blocks in the two web hosts), so a deployment
can ship Conference-only, or Conference plus Engagement, without touching source. That is the
client-side mirror of the server-side module system in
[Group 14](group-14-module-system-composition.md): each enabled module contributes its
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) descriptor, and the shell composes nav
items, routable assemblies, and layout components from whatever is registered. On the web host the
composition is explicit at the end of `Program.cs`: every registered `IUIModule`'s `Assembly` is
concatenated with the shared UI assemblies, deduplicated, and handed to
`MapRazorComponents<App>().AddAdditionalAssemblies(...)`
(`MMCA.ADC.UI.Web/Program.cs:172-186`). This is the group's cleanest
`[Rubric §16, Maintainability]` and `[Rubric §25, Navigation, Routing & IA]` moment: routes and
navigation are *discovered* from the enabled module set rather than maintained in a central list.

**The landing page and the two content adapters.** The conference landing page itself is **not**
owned by this group any more: `ADCHome` lives once in Conference's UI library and is documented in
[Group 21](group-21-conference-ui.md#adchome). What this group owns are the two thin adapters that
point the shared `/` route at it. The web adapter returns the shared component directly, aliased at
the using site (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:2,13`), because the Web head's
site-root asset paths already match the component's defaults. The MAUI adapter returns a local
`ADCHome.razor` wrapper (`MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`) whose entire body is one
element: the shared Conference component with `ImageBasePath="_content/MMCA.Common.UI/images"`
(`MMCA.ADC.UI/Pages/ADCHome.razor:5`), because MAUI serves those images out of the Razor Class
Library content root instead of the site root. Both adapters return the same page title,
"Atlanta Developers Conference," carrying an explicit `// i18n: allow` comment marking the brand
name as a deliberate localization exemption (ADR-027). That one-parameter difference is the whole
per-head divergence of the landing page, and it is a good measure of how far the write-once story
actually goes.

**The MAUI bootstrap chain (ADR-042).** Every platform entry point does nothing but call
[`MauiProgram`](#mauiprogram)`.CreateMauiApp()`: [`MainApplication`](#mainapplication) on Android
(`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [`AppDelegate`](#appdelegate) plus the iOS
[`Program`](#program) on iOS (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:19`,
`MMCA.ADC.UI/Platforms/iOS/Program.cs:10-11`), and the WinUI [`App`](#app) on Windows
(`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`), while
[`MainActivity`](#mainactivity) is the Android launcher activity
(`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:27`). `CreateMauiApp`
(`MMCA.ADC.UI/MauiProgram.cs:34`) builds the entire DI and configuration graph. Because MAUI does
not auto-load `appsettings.json` from disk, it reads it from an **embedded resource**
(`MauiProgram.cs:48-57`), then registers the BlazorWebView and MudBlazor, the CommunityToolkit
(required by the ADR-042 speech-to-text capability, `MauiProgram.cs:41`), the shared UI
(`MauiProgram.cs:66`), the native device capabilities (`MauiProgram.cs:71`), the home content
(`MauiProgram.cs:73`), the module UIs (`MauiProgram.cs:76-86`), and the MAUI flavors of the token,
refresh, and auth-state services (`MauiProgram.cs:98-101`). The MAUI head also registers its own
composition pieces: [`DeviceUIModule`](#deviceuimodule) as an
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) contributing the Device settings nav item
plus four shared layout components (`MauiProgram.cs:94`,
`MMCA.ADC.UI/DeviceUIModule.cs:22-30`), and [`AppActionsInitializer`](#appactionsinitializer) as an
`IMauiInitializeService` that sets localized home-screen quick actions after build
(`MauiProgram.cs:95`). The cross-platform [`App`](#app) (`MMCA.ADC.UI/App.xaml.cs:11`) creates the
single window hosting [`MainPage`](#mainpage), and `MainPage` (`MMCA.ADC.UI/MainPage.xaml.cs:13`)
hosts the `BlazorWebView` and intercepts the hardware/gesture back button
(`MainPage.xaml.cs:18-23`), forwarding it to the WebView's own history via
[`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge)
(`MainPage.xaml.cs:48`) and quitting only when there is nowhere left to go back to
(`MainPage.xaml.cs:49-52`). `[Rubric §25, Navigation, Routing & IA]` shows up in that bridge: native
back must map onto in-app navigation, not OS app-switching, or the native experience feels broken.
`MainActivity`'s `ConfigurationChanges` attribute (`MainActivity.cs:16-20`) is the other native
subtlety: it stops Android from destroying the activity (and with it the Blazor render tree and all
component state) on rotation or dark-mode toggle.

**Native entry surfaces all funnel into one dispatcher (ADR-042 / ADR-043).** Several MAUI-head
types exist for one purpose: to bring the platform's native entry points back into the same in-app
navigation the WebView already runs. [`MainActivity`](#mainactivity) declares an `IntentFilter` for
verified Android **App Links** (https URLs on the pinned public web host,
`MainActivity.cs:21-31`) and publishes their path plus query to
[`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) from both `OnCreate`
and `OnNewIntent` (`MainActivity.cs:34-62`); [`AppDelegate`](#appdelegate) does the equivalent for
iOS Universal Links in `ContinueUserActivity`
(`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:22-40`); and
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity) receives the custom-scheme
OAuth completion redirect (`atldevcon://`,
`MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:14-21`) so MAUI's
`WebAuthenticator` can resume the pending social-login flow.
[`AppActionsInitializer`](#appactionsinitializer) maps three home-screen quick actions to routes
(`RouteFor`, `MMCA.ADC.UI/Services/AppActionsInitializer.cs:39-45`) that `MauiProgram.HandleAppAction`
publishes into the same dispatcher (`MauiProgram.cs:131-144`). The Android home-screen
[`NowNextWidgetProvider`](#nownextwidgetprovider) is a self-contained, best-effort surface: on each
update it fetches the anonymous `Events/now-next` snapshot into its local
[`NowNextSnapshot`](#nownextsnapshot) and [`NowNextSession`](#nownextsession) records
(`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:109-134`), renders one "Now" and one "Next"
line, and taps back into `MainActivity`'s deep-link path
(`NowNextWidgetProvider.cs:85-96`); it never throws, keeping the last rendered content on any failure
(`NowNextWidgetProvider.cs:57-62`). Sharing and copying links is the mirror-image problem, and
[`MauiPublicLinkBuilder`](#mauipubliclinkbuilder) solves it by resolving against the pinned
`PublicSite:BaseUrl` from the embedded configuration
(`MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:18-32`), so a link copied inside the app opens the
public web app rather than a WebView-internal origin. The web side of that association is served by
the Blazor host, which maps the App Links and Universal Links association documents from
configuration (`MMCA.ADC.UI.Web/Program.cs:158-165`), and the applink components mirror the same
Blazor routes the app uses: identical URLs on web and device, no route translation table.

**Host security: platform-appropriate token handling.** The token-storage implementations are a
compact study in **secret handling matched to the threat model**. On the browser heads the
high-value *refresh* token is never exposed to JavaScript: it stays in an HttpOnly cookie and is
exchanged through a same-origin proxy refresher (`SameOriginProxyTokenRefresher`,
`MMCA.ADC.UI.Web/Program.cs:64`, `MMCA.ADC.UI.Web.Client/Program.cs:47`), and the Server head
additionally runs a cookie-backed SSR authentication scheme so `[Authorize]` component routes survive
F5 and open-in-new-tab (`MMCA.ADC.UI.Web/Program.cs:56-62,128`). On MAUI, which has no DOM and
therefore no XSS surface, [`MauiTokenStorageService`](#mauitokenstorageservice) stores both tokens in
OS **SecureStorage**, the platform secure enclave (Android Keystore, iOS Keychain, Windows DPAPI),
under two fixed key names (`MMCA.ADC.UI/Services/MauiTokenStorageService.cs:11-12,16-29`).
`[Rubric §11, Security]` (at-rest secret handling) and `[Rubric §26, Front-End Security]` (no token
reachable from page JS) are both directly embodied; the deeper design note is
`MMCA.ADC/TokenStorageDesignNote.md`. One deliberate development-only relaxation lives in
`MauiProgram`: a `#if DEBUG` block installs a `SocketsHttpHandler` that bypasses SSL certificate
validation (`MauiProgram.cs:106-126`) so a MAUI device on the LAN can reach the API over the ASP.NET
dev cert; it is scoped to DEBUG, analyzer-suppressed inline with a justification, and not a
production path.

**Localization of the shell (ADR-027).** All three heads share one localization stance and each
implements its own half of it. The Blazor Server host sets `CurrentUICulture` from the culture cookie
*before* SSR prerender and exposes a culture-switch endpoint
(`MMCA.ADC.UI.Web/Program.cs:114,150`); the WASM client mirrors the same cookie into the browser
thread culture before the app runs, so there is no locale flash or prerender/hydration mismatch
(`MMCA.ADC.UI.Web.Client/Program.cs:74`). On MAUI the same convention flows into composition:
[`DeviceUIModule`](#deviceuimodule) declares its nav item with a resource **key** and a
`TitleResource` type rather than a literal (`MMCA.ADC.UI/DeviceUIModule.cs:22-25`), and
[`AppActionsInitializer`](#appactionsinitializer) resolves quick-action titles through an
`IStringLocalizer` before handing them to the OS
(`MMCA.ADC.UI/Services/AppActionsInitializer.cs:31,51-57`). `[Rubric §27, Internationalization &
Localization]` assesses externalized strings and culture-aware formatting; the rule this codebase
follows is "localize the chrome, exempt the branded and editorial data on purpose, and mark the
exemption in source," which is exactly what the two `ADCHomePageContent` adapters do with the
conference brand name.

**How it all fits at runtime.** A request to the Blazor Web host renders the shared layout from
[`MMCA.Common.UI`](group-15-common-ui-framework.md); the navbar is composed from each enabled
module's `IUIModule` descriptor, and `/` renders the Conference landing page through
[`ADCHomePageContent`](#adchomepagecontent). After prerender, the interactive Server circuit or the
downloaded WASM runtime takes over; auth state flows through
[`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider)
reading whichever [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) the
host registered, and the WASM client discovers its API endpoint at startup from the Server host's
`/client-config` endpoint instead of having it baked into the static bundle
(`MMCA.ADC.UI.Web/Program.cs:135-145`, `MMCA.ADC.UI.Web.Client/Program.cs:27-29`). On MAUI the same
component tree runs inside a `BlazorWebView` with SecureStorage-backed tokens, the native
back-button bridge, App Link and Universal Link entry, OAuth callback resumption, quick actions, and
the home-screen widget, all funneled into one deep-link dispatcher. In every case the application
talks to the backend **only through the YARP Gateway**: the same boundary that makes the modules
independently extractable (ADR-007 gRPC extraction, ADR-008 service-extraction topology) also makes
the UI host-agnostic. The client points at one origin, and the Gateway routes to whichever service
owns the endpoint. That is the unifying theme of this chapter: **thin hosts over shared components,
talking to one gateway, with every platform difference pushed behind a Common interface.**

### NowNextSession
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:134` · Level 0 · record (sealed, private)

- **What it is**: a tiny wire-shape record for one session row rendered by the Android home-screen widget: `Title`, an optional `RoomName`, and a `StartsAtLocal` timestamp. It is a private nested type of [NowNextWidgetProvider](#nownextwidgetprovider).
- **Depends on**: only the BCL (`string`, `DateTime`). No first-party types.
- **Concept introduced, local mirror of a server DTO.** The widget deliberately does not reference the `Conference.Shared` assembly just to deserialize one payload; instead it declares its own record whose property names match the JSON the server sends (the inline comment at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` says exactly this). `System.Text.Json` populates it by name from the `Events/now-next` response.
- **Walkthrough**: the positional record (`NowNextWidgetProvider.cs:134`) is consumed only by `FormatRow` (`NowNextWidgetProvider.cs:101-107`), which formats `StartsAtLocal` as `HH:mm` under `CultureInfo.InvariantCulture` (`:103`), appends the room in parentheses when it is non-blank (`:104`), and adds a `+N` suffix when more than one session shares the slot (`:105`).
- **Why it's built this way**: keeping the widget's dependency surface to the BCL plus the Android SDK avoids pulling a module-shared contract assembly into a `BroadcastReceiver` that runs in a minimal process. The property-name coupling to the server DTO is the trade-off, documented inline.
- **Where it's used**: the `Now` and `Next` lists on [NowNextSnapshot](#nownextsnapshot); read by `NowNextWidgetProvider.BuildViews` and `FormatRow`.

### WebAuthenticatorCallbackActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` · Level 0 · class

- **What it is**: the Android activity that catches the custom-scheme OAuth completion redirect and hands control back to MAUI's `WebAuthenticator`. After the Identity service's `CompleteAsync` finishes a social login it redirects the system browser to `atldevcon://oauth-complete?code=...`; Android routes that URI here, and the base class resumes the pending `AuthenticateAsync` with the captured parameters (ADR-043, documented at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:7-13`).
- **Depends on**: `Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity` (base class) and the Android SDK activity/intent attributes. No first-party types.
- **Concept introduced, custom-scheme OAuth return on mobile.** Unlike the web heads (which get an ordinary HTTP redirect), a native app receives the OAuth result through a registered URI scheme. The `[IntentFilter]` (`WebAuthenticatorCallbackActivity.cs:15-18`) declares the app as a handler for `ActionView` intents whose `DataScheme` is the `CallbackScheme` constant, with the `Default` and `Browsable` categories so a browser can launch it. `NoHistory = true` and `LaunchMode.SingleTop` (`:14`) keep the callback out of the back stack and reuse the existing task. [Rubric §26, Front-End Security] assesses how client auth flows avoid token leakage: the scheme is an allowlisted return target and the class body holds nothing but the constant, so there is no place for a token to be logged or mishandled here.
- **Walkthrough**: the class is behavior-free by design (`WebAuthenticatorCallbackActivity.cs:19-22`): the whole contract lives in the attributes, and `CallbackScheme = "atldevcon"` (`:21`) must stay in lockstep with `OAuth:MobileRedirectScheme` in the embedded `appsettings.json` and the Identity service's `OAuth:AllowedReturnUrlSchemes` allowlist (class summary, `:11-12`).
- **Why it's built this way**: subclassing the MAUI base activity is the framework-sanctioned way to receive the redirect; all the app supplies is the scheme and the intent-filter metadata. Keeping the scheme constant next to the filter makes the three-place coupling (app, config, Identity allowlist) easy to keep aligned during a cutover.
- **Where it's used**: invoked by the Android OS during the OAuth flow enabled by the [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) registration in [MauiProgram](#mauiprogram) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:64`); it is never called from managed code.

### ADCHomePageContent
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` · Level 1 · class (sealed)

- **What it is**: the ADC web heads' binding of the framework's [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) extension point. It tells the shared `Home.razor` shell which component to render as the landing page and what title to show.
- **Depends on**: [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) (implements, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:1,11`) and [ADCHome](group-21-conference-ui.md#adchome) from `MMCA.ADC.Conference.UI`, imported through the `SharedADCHome` using-alias (`:2`).
- **Concept introduced, app-supplied content for a shared shell.** The framework ships one generic home shell; each host app registers a single `IHomePageContent` that hands the shell a `ComponentType` and a `PageTitle`. The dependency is inverted, the shared shell never references an ADC page. [Rubric §18, UI Architecture] assesses how a reusable shell is specialized per app: this is the whole specialization, two properties. [Rubric §2, Design Patterns] applies as well, since this is a minimal strategy/adapter at a UI boundary.
- **Walkthrough**: two expression-bodied properties and no state. `ComponentType => typeof(SharedADCHome)` (`ADCHomePageContent.cs:13`) points the shell at the Conference module's shared landing component rather than a page owned by this project; `PageTitle => "Atlanta Developers Conference"` (`:15`) carries an explicit `i18n: allow` marker because the conference brand name is deliberately not localized. The class summary notes that `ADCHome`'s default image base path already matches the web head's site-root assets (`:6-9`), which is why no parameters are passed.
- **Why it's built this way**: pointing at the Conference module's component instead of duplicating a landing page means the web and MAUI heads render the same marketing surface, and a change to the conference home lands everywhere at once.
- **Where it's used**: registered as a singleton `IHomePageContent` by both web heads, the WebAssembly client (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:43`) and the Blazor Server host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:50`, which imports `MMCA.ADC.UI.Web.Client.Pages` at `:11`). The MAUI head registers a separate same-named class from `MMCA.ADC.UI.Pages` instead (`MauiProgram.cs:73`).

### AppActionsInitializer
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/AppActionsInitializer.cs:15` · Level 1 · class (sealed)

- **What it is**: a MAUI startup service that publishes the three home-screen quick actions (the long-press app-icon shortcuts) once the app is built, with localized titles, and that owns the lookup mapping an action id back to an in-app route.
- **Depends on**: `IMauiInitializeService` (the MAUI hosting contract it implements), `IStringLocalizer<AppActionsInitializer>`, MAUI Essentials' `AppActions`/`AppAction`/`FeatureNotSupportedException`; route constants from [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) and [NotificationRoutePaths](group-15-common-ui-framework.md#notificationroutepaths); its published routes travel through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher).
- **Concept introduced, native quick actions as a navigation entry point.** [Rubric §25, Navigation & IA] assesses whether the app exposes coherent first-class entry points: the three shortcut ids (`happening_now`, `my_schedule`, `notifications`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/AppActionsInitializer.cs:17-19`) are OS-level jump points into deep routes, not in-app links. [Rubric §27, i18n] applies because the shortcut labels are resolved from the co-located resx pair through the injected localizer at registration time (`:53-55`), so they follow the selected language rather than shipping as English literals.
- **Walkthrough**
  - `Initialize(IServiceProvider services)` (`AppActionsInitializer.cs:22-36`): null-guards the provider (`:24`), returns immediately when `AppActions.Current.IsSupported` is false (`:26-29`), resolves the localizer (`:31`), then starts `SetActionsAsync` **fire-and-forget** with a discard (`:35`) so a slow or failing shortcut registration can never block or fail app startup (the inline comment states this at `:33-34`).
  - `RouteFor(string actionId)` (`AppActionsInitializer.cs:39-45`): an `internal static` switch expression mapping each id to its app-relative route, `EngagementRoutePaths.HappeningNow`, the literal `/conference/sessions?mine=true`, and `NotificationRoutePaths.NotificationInbox`, returning `null` for anything unknown. This is the lookup the activation handler in [MauiProgram](#mauiprogram) calls.
  - `SetActionsAsync(IStringLocalizer<AppActionsInitializer>)` (`AppActionsInitializer.cs:47-64`): builds the three `AppAction`s with localized titles and the `appicon` icon (`:51-56`), awaits `AppActions.Current.SetAsync`, and catches `FeatureNotSupportedException` (`:59-63`) because some launchers report support and then reject the call at runtime, in which case the shortcuts simply do not appear.
- **Why it's built this way**: registration and activation are deliberately split. This initializer sets the shortcuts and their titles, while [MauiProgram](#mauiprogram) wires `ConfigureEssentials(... OnAppAction(HandleAppAction))` to `RouteFor`; both ends publish the resolved route into the ADR-042 deep-link dispatcher, which buffers a cold-start activation until the shared `DeepLinkListener` renders (class summary, `AppActionsInitializer.cs:8-14`).
- **Where it's used**: registered as a singleton `IMauiInitializeService` in [MauiProgram](#mauiprogram) (`MauiProgram.cs:95`) so MAUI runs `Initialize` during startup; `RouteFor` is called from `MauiProgram.HandleAppAction` (`MauiProgram.cs:133`).
- **Caveats / not-in-source**: whether a given launcher actually surfaces the shortcuts is a runtime platform behavior, not determinable from source; the code only handles the rejection case.

### MauiPublicLinkBuilder
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [IPublicLinkBuilder](group-21-conference-ui.md#ipubliclinkbuilder). It turns a relative path into an absolute URL rooted at the public web app, so a link the user shares or copies from the device points at the public site rather than the WebView's internal origin.
- **Depends on**: [IPublicLinkBuilder](group-21-conference-ui.md#ipubliclinkbuilder) (implements), `Microsoft.Extensions.Configuration.IConfiguration`, `System.Uri`.
- **Concept introduced, per-head override of a shared UI service.** On a browser head the default builder can resolve against the current origin, but a MAUI WebView's origin is an internal shell address that is meaningless once pasted into a message. This head therefore substitutes a base URL pinned in configuration. [Rubric §25, Navigation & IA] assesses whether links resolve to real destinations, and [Rubric §26, Front-End Security] is touched because the shared link is bound to one configured host instead of whatever origin the WebView happens to report. The override only works because it is registered after the module registrations in [MauiProgram](#mauiprogram) (last plain `Add` wins, class summary at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:6-12`).
- **Walkthrough**
  - The constructor (`MauiPublicLinkBuilder.cs:18-24`) reads `PublicSite:BaseUrl` from the embedded configuration and **throws `InvalidOperationException` when it is missing or blank** (`:21-23`), a fail-fast that stops a misconfigured build from silently emitting broken share links. The parsed value is stored in the readonly `_baseUrl` field (`:15`) as an absolute `Uri`.
  - `BuildAbsolute(string relativePath)` (`MauiPublicLinkBuilder.cs:27-32`) guards against a null or whitespace path with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:29`), then combines the path onto the base via the `Uri(baseUri, relative)` constructor (`:31`).
- **Why it's built this way**: the same `PublicSite:BaseUrl` value also backs the Android App Link host constant in [MainActivity](#mainactivity), so one configuration key defines "the public site" for both outbound share links and inbound deep links.
- **Where it's used**: registered as scoped in [MauiProgram](#mauiprogram) (`MauiProgram.cs:90`), deliberately after `AddConferenceUI()`; consumed by the Conference UI's share and copy-link surfaces in [Group 21](group-21-conference-ui.md).

### MauiTokenStorageService
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiTokenStorageService.cs:9` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice). It persists the JWT access token and refresh token in the platform secure store through MAUI's `SecureStorage`.
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (implements), MAUI Essentials' `SecureStorage`.
- **Concept introduced, at-rest token protection on the device head.** [Rubric §11, Security] and [Rubric §26, Front-End Security] assess where credentials live at rest and who can read them. The browser heads are limited to what the browser offers, but the device head can hand the tokens to the OS: `SecureStorage.Default` routes to the platform-specific protected store (Android Keystore, iOS Keychain, Windows DPAPI, per the class summary at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiTokenStorageService.cs:5-8`), so the tokens are encrypted at rest by the platform rather than by app code.
- **Walkthrough**: two fixed key constants, `auth_access_token` and `auth_refresh_token` (`MauiTokenStorageService.cs:11-12`). `GetAccessTokenAsync` (`:14-18`) and `GetRefreshTokenAsync` (`:20-24`) each read one key via `SecureStorage.Default.GetAsync`, returning `null` when absent. `SetTokensAsync` (`:26-30`) writes both keys in sequence. `ClearTokensAsync` (`:32-37`) calls the synchronous `Remove` for both keys and returns `Task.CompletedTask`, so the method is async in signature only.
- **Why it's built this way**: keeping one `ITokenStorageService` contract across every head means the shared auth pipeline (refresh, state provider, HTTP handler) is head-agnostic and only the storage backend swaps. ADC's private `TokenStorageDesignNote.md` records the cross-head storage rationale.
- **Where it's used**: registered as scoped in [MauiProgram](#mauiprogram) (`MauiProgram.cs:98`), alongside [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher) and [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider); consumed by the shared auth services in [Group 15](group-15-common-ui-framework.md).

### NowNextSnapshot
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:132` · Level 1 · record (sealed, private)

- **What it is**: the deserialized `Events/now-next` payload the widget renders: an `EventName`, an `IsLive` flag, and two lists of [NowNextSession](#nownextsession) (`Now` and `Next`). Like its sibling it is a private nested record on [NowNextWidgetProvider](#nownextwidgetprovider).
- **Depends on**: [NowNextSession](#nownextsession); BCL `List<T>`, `string`, `bool`.
- **Concept introduced**: reuses the **local mirror of a server DTO** idea introduced by [NowNextSession](#nownextsession) (the shared comment at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` covers both records). No new pattern.
- **Walkthrough**: produced by `FetchSnapshotAsync` via `JsonSerializer.Deserialize<NowNextSnapshot>(json, JsonSerializerOptions.Web)` (`NowNextWidgetProvider.cs:127`), which applies the web (camelCase) naming policy so the record's PascalCase members bind to the server's JSON. `BuildViews` (`:69-99`) reads `EventName` into the header text view (`:72`) and takes the first entry of `Now` and `Next`, substituting a localized "nothing scheduled" string for an empty `Now` list and an empty string for an empty `Next` list (`:78-83`).
- **Why it's built this way**: one flat record keeps the deserialize-then-render path allocation-light and independent of the Conference module contracts.
- **Where it's used**: returned by `NowNextWidgetProvider.FetchSnapshotAsync`; consumed by `NowNextWidgetProvider.BuildViews`.
- **Caveats / not-in-source**: `IsLive` is declared on the record and deserialized, but no code path in this file reads it; whether a future render uses it is not determinable from source.

### MainPage
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:13` · Level 2 · class (partial)

- **What it is**: the single MAUI `ContentPage` that hosts the `BlazorWebView` control declared in the paired XAML. Beyond hosting, its one job is to intercept the platform back gesture (Android hardware back, iOS edge swipe) and forward it to the WebView's own Blazor history, exiting the app only when the WebView has nowhere left to go.
- **Depends on**: [MauiBackNavigationBridge](group-15-common-ui-framework.md#mauibacknavigationbridge) (the shared back-navigation helper), `Microsoft.JSInterop.IJSRuntime`, and MAUI's `ContentPage`, `BlazorWebView`, `MainThread`, and `Application`.
- **Concept introduced, bridging a native gesture into Blazor navigation.** In a Blazor Hybrid host the OS back button is a native event, but the user's mental model of "back" is a route change inside the WebView. `OnBackButtonPressed` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:18-23`) returns `true` to consume the native gesture and starts the async handling off the UI thread. Because `BlazorWebView` only exposes the synchronous `Action<IServiceProvider>` dispatch overload, `HandleBackAsync` captures the renderer-scoped `IJSRuntime` through a `TaskCompletionSource` (`:32-33`, `:61-62`) and then runs the interop outside the dispatch context. [Rubric §25, Navigation & IA] assesses whether the app presents one coherent navigation model: here a single back affordance drives in-app history instead of dumping the user out. [Rubric §18, UI Architecture] applies too, since the native shell and the web content share one navigation contract.
- **Walkthrough**: `MainPage()` (`MainPage.xaml.cs:15`) only calls `InitializeComponent()`. `HandleBackAsync` (`:25-59`) dispatches `CaptureJsRuntime` into the WebView (`:33`); if dispatch returns false (`:35-39`), or the captured runtime is null (`:41-46`), or [MauiBackNavigationBridge](group-15-common-ui-framework.md#mauibacknavigationbridge)`.HandleBackPressedAsync` reports `AtRoot` (`:48-52`), it calls `QuitApp`. A bare `catch` (`:54-58`) quits as well, on the reasoning that a not-yet-hydrated WebView or a failed interop should exit cleanly rather than leave the gesture doing nothing. `CaptureJsRuntime` (`:61-62`) resolves `IJSRuntime` from the dispatched provider into the completion source, and `QuitApp` (`:64-68`) marshals `Application.Current?.Quit()` back onto the main thread.
- **Why it's built this way**: the `TaskCompletionSource` hop is a direct consequence of the dispatch overload MAUI offers; awaiting interop inside that synchronous dispatch would deadlock. Treating every failure as "quit" keeps the back gesture deterministic.
- **Where it's used**: constructed by [App](#app) as the content of the single window (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:11`); it is the visual root on every platform head.
- **Caveats / not-in-source**: the `blazorWebView` field referenced at `MainPage.xaml.cs:33` is generated from the paired `MainPage.xaml`, which is not part of this file.

### App
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:7` · Level 3 · class (partial)

- **What it is**: the cross-platform MAUI `Application` root. It creates the single window that hosts [MainPage](#mainpage), and therefore the Blazor WebView.
- **Depends on**: [MainPage](#mainpage); MAUI's `Application`, `Window`, and `IActivationState`.
- **Concept introduced, the MAUI application object.** One `App` per process owns the window graph. Here `CreateWindow` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:11`) returns a single `Window` wrapping a fresh `MainPage`, titled `"MMCA.ADC.UI"`. Contrast this with the per-platform entry points ([AppDelegate](#appdelegate), [MainApplication](#mainapplication), [Program](#program)), which boot the framework and then defer to this shared class.
- **Walkthrough**: two members only. The constructor (`App.xaml.cs:9`) calls `InitializeComponent()` from the XAML-generated partial, and `CreateWindow(IActivationState?)` (`:11`) is the sole override. There are no lifecycle hooks and no DI wiring; that all lives in [MauiProgram](#mauiprogram).
- **Why it's built this way**: keeping `App` to a single-window factory concentrates composition in `MauiProgram` and navigation in `MainPage`, so the application root stays trivial and platform-agnostic.
- **Where it's used**: named as the app type in `builder.UseMauiApp<App>()` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:38`); the MAUI framework instantiates it after each platform head calls `CreateMauiApp()`.

### DeviceUIModule
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:18` · Level 3 · class (sealed)

- **What it is**: the MAUI-head-only UI module (ADR-042 Wave 2). It contributes the Device settings page plus its nav item, and it registers the layout components that turn native device events into in-app behavior. Web heads never register it, so none of its pages or components exist there.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (implements) and [NavItem](group-15-common-ui-framework.md#navitem); the local `AppLockKeyMigration` component plus the shared `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener` components from `MMCA.Common.UI.Components.Capabilities`; `System.Reflection` and MudBlazor `Icons`.
- **Concept introduced, UI modules as a composition unit.** [IUIModule](group-15-common-ui-framework.md#iuimodule) lets each module contribute nav items, layout components, and its own assembly to the shared router. The shared router's `AppAssembly` is `MMCA.Common.UI`, so a module's `Assembly` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:32`) has to be added to `AdditionalAssemblies` before its `[Route]` pages resolve at all (class summary, `:10-17`). `NavItems` (`:22-25`) exposes one `Device settings` entry whose `Title` is a resource **key** (`"Nav.DeviceSettings"`) rather than display text, resolved at render time by the shared `NavMenu` against the co-located `DeviceUIModule.resx` pair via `TitleResource: typeof(DeviceUIModule)` (ADR-027, comment at `:20-21`). [Rubric §18, UI Architecture] assesses how features compose into a shell: this is the extension point that lets a device-only capability slot into a shared Blazor UI without the web heads knowing it exists. [Rubric §27, i18n] is touched by deferring the nav title to a resource lookup.
- **Walkthrough**: three get-only auto-properties are the entire surface. `NavItems` (`DeviceUIModule.cs:22`) holds the single nav entry pointing at `/settings/device` with the `AppSettingsAlt` icon. `LayoutComponentTypes` (`:30`) lists four components the shared layout renders once each, in a deliberate order: `AppLockKeyMigration` first so the E7 preference-key rename lands before `BiometricGate` performs its first read of `DevicePreferenceKeys.AppLockEnabled` (comment at `:27-29`), then `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener`. `Assembly` (`:32`) returns this project's assembly. There is no constructor logic: the module is a declarative manifest.
- **Why it's built this way**: registering device concerns through the same [IUIModule](group-15-common-ui-framework.md#iuimodule) contract the business modules use keeps the MAUI head from special-casing composition, and the ordered `LayoutComponentTypes` encodes a real initialization dependency rather than an arbitrary list.
- **Where it's used**: registered as a singleton `IUIModule` in [MauiProgram](#mauiprogram) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:94`); its components render inside the shared `MMCA.Common.UI` layout.

### MainActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:27` · Level 3 · class

- **What it is**: the Android launcher activity for the MAUI host. It does two jobs: declare which configuration changes it handles in-process (so Android does not restart the activity and tear down the Blazor circuit), and receive verified https App Links (ADR-043), publishing their route to the shared deep-link dispatcher for in-app navigation.
- **Depends on**: [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (resolved from `IPlatformApplication.Current.Services`), MAUI's `MauiAppCompatActivity`, and the Android intent/activity SDK.
- **Concept introduced, `ConfigurationChanges` and Blazor circuit preservation.** By default Android destroys and recreates an activity on orientation, theme, or density changes; for a `BlazorWebView` that destruction tears down the whole Blazor circuit and loses component state. The `[Activity(... ConfigurationChanges = ScreenSize | Orientation | UiMode | ScreenLayout | SmallestScreenSize | Density)]` attribute (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:16-20`) tells Android the activity handles those events itself, so no recreation happens. The second concept is **verified App Links**: the `[IntentFilter]` (`:21-26`) claims `https` URLs on `PublicWebHost` with `AutoVerify = true`, which only works if a live `assetlinks.json` carrying the Play App Signing fingerprint is served from that host (class summary, `:12-14`). [Rubric §25, Navigation & IA] applies because deep links land the user on the right in-app route, and [Rubric §22, Responsive/Cross-Browser] applies because the config-change handling is what keeps the single WebView UI stable across rotations and theme switches.
- **Walkthrough**: `PublicWebHost` (`MainActivity.cs:31`) is a compile-time constant that must match `PublicSite:BaseUrl` in the embedded `appsettings.json`, so a custom-domain cutover touches only these two places (`:29-30`). `OnCreate` (`:34-38`) and `OnNewIntent` (`:41-45`) both call `PublishDeepLink`, covering cold start and warm re-entry with identical behavior. `PublishDeepLink` (`:47-62`) ignores anything that is not an `ActionView` intent carrying data (`:49-52`), ignores a blank path (`:54-58`), reassembles `path` plus optional `?query` (`:60`), and publishes the route through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:61`), which buffers one route across a cold start until the shared `DeepLinkListener` drains it.
- **Why it's built this way**: the config-changes list is not boilerplate, dropping any entry silently reintroduces an activity restart that only shows up on a physical device rotation or theme switch. Routing both intent callbacks through one helper keeps cold-start and warm-start deep links behaviorally identical.
- **Where it's used**: the Android launcher (`MainLauncher = true`, `MainActivity.cs:18`); it is also the explicit target of the widget's tap `PendingIntent` in [NowNextWidgetProvider](#nownextwidgetprovider) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:91`).

### NowNextWidgetProvider
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:22` · Level 4 · class (sealed)

- **What it is**: the Android home-screen `AppWidgetProvider` (ADR-042 Wave 8) that renders a "Now / Next" card. On each update it fetches the anonymous, 60s-cached `GET Events/now-next` snapshot (the id-less form, where the server picks the live-or-next published event) and renders one "Now" and one "Next" line. It never throws: a failed fetch leaves the previous `RemoteViews` in place (class summary, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:11-18`).
- **Depends on**: [NowNextSnapshot](#nownextsnapshot) and [NowNextSession](#nownextsession) (its private records), [MainActivity](#mainactivity) (the tap target), `IConfiguration` resolved from `IPlatformApplication.Current.Services`, `System.Net.Http.HttpClient`, `System.Text.Json`, and the Android widget SDK.
- **Concept introduced, best-effort background rendering under a platform time budget.** `OnUpdate` (`NowNextWidgetProvider.cs:24-35`) must return fast, so after null-guarding its three arguments (`:26-29`) it calls `GoAsync()` (`:33`) to keep the broadcast alive while the snapshot downloads, then starts `UpdateWidgetsAsync` without awaiting (`:34`); the comment at `:31-32` records that the platform budget is roughly 10s, far above one cached GET. `UpdateWidgetsAsync` (`:37-67`) wraps the whole flow in a `try`/`catch` that swallows every exception, with the `CA1031` suppression justified inline (`:57-59`, a widget update is best-effort and the last rendering stays), and always calls `pendingResult?.Finish()` in `finally` (`:63-66`). [Rubric §29, Resilience & Business Continuity] assesses graceful degradation: a network or parse failure degrades to the stale card rather than a visible error. [Rubric §23, Front-End Performance] is engaged by leaning on the server's cache and a short client timeout instead of any local polling loop.
- **Walkthrough**: `BuildViews` (`NowNextWidgetProvider.cs:69-99`) inflates the `nownext_widget` layout, sets the event-name text (`:72`), reads three localized strings (`:74-76`), and fills the Now/Next lines through `FormatRow`, showing the "nothing scheduled" string when `Now` is empty and an empty string when `Next` is empty (`:78-83`). It then builds an **explicit** tap intent targeting [MainActivity](#mainactivity) with `ActionView` and the app-internal `https://app.internal/happening-now` URI (`:88-96`); the `S1075` suppression is justified because this is an app-internal route rather than an external address, and only the URI path is consumed by the deep-link publisher (`:85-87`). The `PendingIntent` is created `UpdateCurrent | Immutable` (`:94-95`). `FormatRow` (`:101-107`) does the invariant `HH:mm` formatting described under [NowNextSession](#nownextsession). `FetchSnapshotAsync` (`:109-128`) reads `Api:ApiEndpoint` from configuration (`:113`), returns `null` when it is missing (`:114-117`), builds a short-lived `HttpClient` with an 8s timeout (`:119`), GETs the relative `Events/now-next` (`:120`), returns `null` on a non-success status (`:121-124`), and otherwise deserializes with `JsonSerializerOptions.Web` (`:127`).
- **Why it's built this way**: a widget runs in a minimal broadcast process where an unhandled exception is user-visible as a broken card, so every path is null-guarded and every failure returns quietly to preserve the prior render. The `GoAsync`/`Finish` pairing is the Android-sanctioned way to do async work from a receiver without triggering an ANR.
- **Where it's used**: registered through `[BroadcastReceiver]`, `[IntentFilter]`, and `[MetaData]` (`NowNextWidgetProvider.cs:19-21`) and driven by the Android `AppWidgetManager`; its tap routes into [MainActivity](#mainactivity)'s deep-link path.
- **Caveats / not-in-source**: the widget layout and string ids (`Resource.Layout.nownext_widget`, `Resource.Id.*`, `Resource.String.*`) resolve against generated Android resources declared in `Platforms/Android/Resources`, not in this file. The comment at `:111-112` asserts that `MainApplication` has already initialized MAUI by the time a receiver runs in this process; the code still bails quietly if configuration is unresolvable.

### MauiProgram
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:28` · Level 9 · class (static)

- **What it is**: the composition root for the MAUI Blazor Hybrid app. `CreateMauiApp` builds the DI and configuration graph that runs Blazor components inside a native WebView on Android, iOS, MacCatalyst, and Windows: it loads embedded configuration, registers MudBlazor and the shared UI services, conditionally registers each module's UI, and wires the MAUI-specific auth, form-factor, and device-capability services.
- **Depends on**: the shared registrations `AddUIShared` and `UseMauiDeviceCapabilities`, [UIModuleConfiguration](group-15-common-ui-framework.md#uimoduleconfiguration), [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) with [ConfigurationOAuthUISettings](group-15-common-ui-framework.md#configurationoauthuisettings), [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent), [IUIModule](group-15-common-ui-framework.md#iuimodule) with [DeviceUIModule](#deviceuimodule), [AppActionsInitializer](#appactionsinitializer), [MauiTokenStorageService](#mauitokenstorageservice) for [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice), [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) with [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider), [MauiPublicLinkBuilder](#mauipubliclinkbuilder), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), and [App](#app); externals MudBlazor, CommunityToolkit.Maui, the `MMCA.Common.UI.Maui` package, the three module UI packages, and `SocketsHttpHandler`.
- **Concept introduced, registration-order-sensitive composition on top of `TryAdd` defaults.** The shared framework registers safe defaults with `TryAdd`, so this host must place each override at the right point in the sequence, because a later plain `Add` wins and a `TryAdd` no-ops once something is present. Three orderings in this file are deliberate and commented: `IOAuthUISettings` is registered **before** `AddUIShared` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:62-64`) so the shell's `TryAdd` default cannot shadow it; `UseMauiDeviceCapabilities()` runs **after** `AddUIShared` (`:68-71`) so its plain `Add` registrations override the framework's null capability defaults; and [MauiPublicLinkBuilder](#mauipubliclinkbuilder) is registered **after** `AddConferenceUI()` (`:88-90`) so shared links carry the public web URL rather than the WebView origin. [Rubric §18, UI Architecture] assesses how the UI host is composed, one shared component graph parameterized per platform head. [Rubric §22, Responsive/Cross-Browser] applies because the same Blazor code targets four platforms from this single builder. [Rubric §11, Security] and [Rubric §17, DevOps] both bear on the `#if DEBUG` block below.
- **Walkthrough**
  - Builder chain (`MauiProgram.cs:36-46`): `UseMauiApp<App>()`, `UseMauiCommunityToolkit()` (required by the speech-to-text capability, ADR-042 Wave 4, and the toolkit analyzer insists the call sits in the app's own chain, `:39-40`), a font registration, and `ConfigureEssentials(essentials => essentials.OnAppAction(HandleAppAction))` for home-screen quick actions (`:43-46`).
  - Configuration (`MauiProgram.cs:48-57`): MAUI does not auto-load config files, so the executing assembly's `MMCA.ADC.UI.appsettings.json` manifest resource stream is read and added through `AddJsonStream`, guarded by a null check on the stream.
  - Core UI services: `AddMauiBlazorWebView()` and `AddMudServices()` (`:59-60`), then the pre-shared `IOAuthUISettings` override (`:64`), `AddUIShared(builder.Configuration)` (`:66`), `UseMauiDeviceCapabilities()` (`:71`, which also wires `Plugin.LocalNotification` and the notification-tap deep-link bridge), and the `IHomePageContent` landing content (`:73`).
  - Module registration (`MauiProgram.cs:75-86`): four `if` blocks gated on `UIModuleConfiguration.IsModuleEnabled(builder.Configuration, "...")` add the Identity, Conference, Engagement, and Notification UI packages.
  - Head-specific overrides and services: the public-link override (`:90`), the MAUI-only [DeviceUIModule](#deviceuimodule) (`:94`) and [AppActionsInitializer](#appactionsinitializer) (`:95`), the auth stack of [MauiTokenStorageService](#mauitokenstorageservice), [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider) and `AddAuthorizationCore()` (`:98-101`), and `AddMauiFormFactor()` (`:104`).
  - The `#if DEBUG` block (`MauiProgram.cs:106-126`) adds Blazor WebView developer tools and debug logging, then replaces the `APIClient` primary handler with a `SocketsHttpHandler` whose `RemoteCertificateValidationCallback` always returns true (`:117-124`), so the app can reach the WebAPI over LAN using the localhost dev cert. The `S4830`/`CA5359` suppression is scoped to Debug and explained inline (`:110-116`): Android's native SSL layer rejects the dev cert at the Java level before the managed callback would ever fire, so the managed TLS stack is used instead.
  - `HandleAppAction(AppAction action)` (`MauiProgram.cs:131-144`) maps the action id to a route via `AppActionsInitializer.RouteFor` (`:133`), returns when the id is unknown (`:134-137`), and otherwise publishes the route into [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:141-143`), which buffers it on cold start.
- **Why it's built this way**: the embedded-resource config load is forced by MAUI's lack of on-disk config discovery, and the ordering comments encode real `TryAdd`-versus-`Add` precedence rules that are easy to break silently during a refactor. Scoping the certificate bypass to `#if DEBUG` keeps an intentionally insecure LAN convenience out of every shipped build.
- **Where it's used**: called by every platform head, [MainApplication](#mainapplication) on Android (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [AppDelegate](#appdelegate) on iOS and MacCatalyst (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:19`), and the Windows `App` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`). It is the one place all UI DI is assembled for the mobile and desktop shells.
- **Caveats / not-in-source**: which modules are actually enabled depends on the embedded `appsettings.json` values read by `UIModuleConfiguration.IsModuleEnabled`; those runtime values are not determinable from this file.

### AppDelegate
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:16` · Level 10 · class

- **What it is**: the iOS and MacCatalyst application delegate. It boots MAUI by returning [MauiProgram](#mauiprogram)'s app, and it receives Universal Links (ADR-043): https URLs on the public web host arrive through `ContinueUserActivity` and are published to the shared deep-link dispatcher for in-app navigation.
- **Depends on**: [MauiProgram](#mauiprogram), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), MAUI's `MauiUIApplicationDelegate`, and `Foundation`/`UIKit`.
- **Concept introduced, iOS Universal Links next to Android App Links.** The product concept matches [MainActivity](#mainactivity)'s App Links but the plumbing differs: iOS delivers the tapped web URL as an `NSUserActivity` of type `BrowsingWeb`, and the app must carry the associated-domains entitlement plus a live `apple-app-site-association` file on that host (class summary, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:9-13`). [Rubric §25, Navigation & IA] applies: deep links resolve to in-app routes on iOS exactly as on Android, through the same dispatcher.
- **Walkthrough**: `CreateMauiApp` (`AppDelegate.cs:19`) delegates to `MauiProgram.CreateMauiApp()`. `ContinueUserActivity` (`:22-40`) checks for a `BrowsingWeb` activity with a non-null `WebPageUrl` (`:27-28`), reassembles `path` plus optional `?query` (`:31`), and when the result is non-blank publishes it through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) and returns `true` (`:32-36`); every other case defers to the base implementation (`:39`). The `[Register("AppDelegate")]` attribute (`:15`) is what makes the type visible to the Objective-C runtime.
- **Why it's built this way**: mirroring the Android deep-link path through one shared dispatcher means the in-app navigation logic is written once in the shared `DeepLinkListener`, and each platform delegate only translates its native event into a route string.
- **Where it's used**: [Program](#program) passes this type to `UIApplication.Main` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:11`); the MacCatalyst head uses the same delegate.

### MainApplication
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` · Level 10 · class

- **What it is**: the Android `MauiApplication` subclass, the process-level Android application object that boots MAUI by returning [MauiProgram](#mauiprogram)'s app.
- **Depends on**: [MauiProgram](#mauiprogram); MAUI's `MauiApplication` and the Android runtime interop types `IntPtr` and `JniHandleOwnership`.
- **Concept introduced**: reuses the **per-platform bootstrapper** pattern (see [App](#app)), where each platform provides a thin entry that calls the shared `MauiProgram`. No new concept.
- **Walkthrough**: the `[Application]` attribute (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:9`) marks it as the Android application class. The `(IntPtr handle, JniHandleOwnership ownership)` constructor (`:12-15`) is the JNI-marshalling constructor the Android runtime requires and simply forwards to the base. `CreateMauiApp` (`:17`) delegates to `MauiProgram.CreateMauiApp()`.
- **Why it's built this way**: Android instantiates the application object before any activity, so this is the earliest point where MAUI can be created; keeping it a one-line delegate concentrates composition in [MauiProgram](#mauiprogram).
- **Where it's used**: the Android runtime instantiates it at process start; it constructs the DI graph that [MainActivity](#mainactivity) and [NowNextWidgetProvider](#nownextwidgetprovider) later resolve services from via `IPlatformApplication.Current`.

### Program
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:8` · Level 11 · class (static)

- **What it is**: the iOS native entry point. `Main` launches the UIKit application with [AppDelegate](#appdelegate) as the delegate type.
- **Depends on**: [AppDelegate](#appdelegate); `UIKit.UIApplication`.
- **Concept introduced, the iOS managed `Main`.** Unlike Android, where the OS instantiates [MainApplication](#mainapplication), iOS starts from a classic `Main`. `UIApplication.Main(args, null, typeof(AppDelegate))` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:10-11`) hands control to UIKit and names the delegate that will call `CreateMauiApp`. [Rubric §22, Responsive/Cross-Browser] applies loosely: one codebase, one launcher per platform.
- **Walkthrough**: a single static `Main(string[] args)` (`Program.cs:10-11`) and no other members.
- **Why it's built this way**: the MAUI iOS template requires an explicit `Main` that names the `AppDelegate`; there is nothing app-specific to customize here.
- **Where it's used**: the iOS process entry point; it never runs on the other platform heads.

### ADCEventInfo
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:178` · Level 0 · record

- **What it is**: A private, sealed, deserialization-only projection of the public events API response, holding the fields the landing page needs to drive its countdown and venue block. It is not shared with any other page.
- **Depends on**: BCL only: `int`, `string`, `DateOnly` (`ADCHome.razor.cs:178-186`). Consumed inside [ADCHome](#adchome) and wrapped by [ADCCollectionResult](#adccollectionresult).
- **Concept introduced**: **Page-local API projection.** Rather than reuse a shared event DTO, the page declares its own positional record with exactly the fields it reads, so the anonymous `events` endpoint's shape stays private to this one component. `[Rubric §18, UI Architecture]`, which assesses how UI concerns are structured: here the page owns a narrow read model instead of leaking a cross-cutting contract.
- **Walkthrough**: Eight positional members (`ADCHome.razor.cs:179-186`): `Id`, `Name`, `Description?`, `StartDate`, `EndDate`, `TimeZone`, `VenueAddress?`, `VenueMapUrl?`. `StartDate`/`EndDate`/`TimeZone` feed `UpdateCountdown()`'s time-zone conversion (`ADCHome.razor.cs:121-155`); `VenueAddress` (with its own fallback) builds the Google Maps search URL (`ADCHome.razor.cs:40-43`). The nullable members allow a partial or absent event to fall back to hardcoded defaults.
- **Why it's built this way**: Keeping the projection private prevents accidental reuse and keeps the wire shape a page detail. Its deserialization is driven by `JsonSerializerDefaults.Web` options (`ADCHome.razor.cs:15`).
- **Where it's used**: Deserialized in `LoadEventAsync()` via `GetFromJsonAsync<ADCCollectionResult>` (`ADCHome.razor.cs:80`), then reduced to a single featured event by [CurrentEventSelector](group-17-conference-domain.md#currenteventselector).

### ConferenceTrackInfo
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:285` · Level 0 · record

- **What it is**: A private, sealed record for one conference track in the static track catalog rendered on the landing page.
- **Depends on**: BCL `string` only (`ADCHome.razor.cs:285`). Icon values come from MudBlazor's `Icons.Material.*` constants (NuGet).
- **Concept introduced**: **Hardcoded editorial content records.** The track grid changes at most once per conference year, so the twelve tracks are declared as a `private static readonly` array (`ADCHome.razor.cs:203-229`) rather than fetched. This is the static half of the page's two-tier content model (see [ADCEventInfo](#adceventinfo) for the dynamic half). `[Rubric §18, UI Architecture]`: content that rarely changes is compiled in, avoiding a CMS dependency.
- **Walkthrough**: Three positional members (`ADCHome.razor.cs:285`): `Name`, `Icon` (a MudBlazor icon constant such as `Icons.Material.Filled.Psychology`, `ADCHome.razor.cs:205`), and `Topics` (a comma-separated description string). Each element of the `Tracks` array is passed to `<MudIcon>` and the track card in the Razor markup.
- **Why it's built this way**: A code-resident catalog keeps the track grid rendering instantly and independent of the API. An `i18n: allow` comment (`ADCHome.razor.cs:189-190`) documents that this English-only editorial data is intentionally not localized while the UI chrome around it is.
- **Where it's used**: The `Tracks` static array in [ADCHome](#adchome) (`ADCHome.razor.cs:203`).

### EventPhase
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:29` · Level 0 · enum

- **What it is**: A private enum with three states, `Upcoming`, `Live`, and `Ended`, that classifies where the conference sits relative to now and drives the countdown timer's behavior.
- **Depends on**: Nothing (`ADCHome.razor.cs:29-34`).
- **Concept introduced**: **Derived UI state as an enum.** The phase is not stored; it is recomputed every tick from the event window, keeping render logic a pure function of the current time. `[Rubric §19, State Management]`, which assesses how transient UI state is modeled: here a single enum field replaces several booleans and makes the render branch exhaustive.
- **Walkthrough**: `UpdateCountdown()` sets `_phase` (`ADCHome.razor.cs:146-154`): if the start instant is still in the future it is `Upcoming`; otherwise `Live` while now is before the computed end instant, else `Ended`. `OnTimerTick` stops the one-second timer via `_countdownTimer?.Change(-1, -1)` once the phase reaches `Ended` (`ADCHome.razor.cs:114-118`), and `OnInitializedAsync` never starts the timer if the event already ended (`ADCHome.razor.cs:69-72`).
- **Why it's built this way**: Encoding the countdown lifecycle as one value keeps timer start/stop decisions and template branches in sync and avoids ticking forever after the conference ends.
- **Where it's used**: The `_phase` field of [ADCHome](#adchome).

### KeynoteSpeakerInfo
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:284` · Level 0 · record

- **What it is**: A private, sealed record carrying the static keynote-speaker content (name, title, talk title, and multi-paragraph bio) for the landing page's keynote section.
- **Depends on**: BCL `string` / `string[]` only (`ADCHome.razor.cs:284`).
- **Concept introduced**: Same hardcoded editorial-content pattern as [ConferenceTrackInfo](#conferencetrackinfo); the single keynote is a `private static readonly` instance (`ADCHome.razor.cs:191-201`).
- **Walkthrough**: Four positional members (`ADCHome.razor.cs:284`): `Name`, `Title`, `TalkTitle`, and `BioParagraphs` (`string[]`). Modeling the bio as an array lets the Razor template render each paragraph in its own element rather than splitting one blob of text.
- **Why it's built this way**: The keynote changes once per conference cycle, so it lives in code alongside the tracks and sponsors under the same `i18n: allow` editorial exemption (`ADCHome.razor.cs:189-190`).
- **Where it's used**: The `Keynote` static field in [ADCHome](#adchome) (`ADCHome.razor.cs:191`).

### SponsorInfo
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:287` · Level 0 · record

- **What it is**: A private, sealed record for a single sponsor: display name, logo URL, and link URL.
- **Depends on**: BCL `string` only (`ADCHome.razor.cs:287`).
- **Concept introduced**: Same hardcoded editorial-content pattern as [ConferenceTrackInfo](#conferencetrackinfo). Because the logo and link URLs are literal external constants, the whole `SponsorTiers` array carries a documented `S1075` suppression (`URIs should not be hardcoded`) at `ADCHome.razor.cs:231`, a deliberate analyzer exception, not a smell.
- **Walkthrough**: Three positional members (`ADCHome.razor.cs:287`): `Name`, `LogoUrl`, `Url`. Instances are nested inside each [SponsorTierInfo](#sponsortierinfo) in the `SponsorTiers` array (`ADCHome.razor.cs:232-258`); tiers with no confirmed sponsors carry an empty list (Gold and Silver, `ADCHome.razor.cs:249-250`).
- **Where it's used**: Nested within [SponsorTierInfo](#sponsortierinfo) and rendered by [ADCHome](#adchome).

### ADCCollectionResult
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:176` · Level 1 · record

- **What it is**: A private, sealed record that is the deserialization envelope for the events API, wrapping the returned list of [ADCEventInfo](#adceventinfo).
- **Depends on**: [ADCEventInfo](#adceventinfo) (`ADCHome.razor.cs:176`), plus BCL `List<T>`. It is Level 1 because it composes the Level-0 projection.
- **Concept introduced**: **Collection envelope projection.** The public collection endpoint returns an object with an `Items` array rather than a bare array, so the page declares a matching one-member wrapper. `[Rubric §9, API & Contract Design]`, which assesses how contracts are shaped at boundaries: the client mirrors the server envelope narrowly instead of importing a shared paged-result type.
- **Walkthrough**: A single positional member, `List<ADCEventInfo>? Items` (`ADCHome.razor.cs:176`). `LoadEventAsync()` deserializes into it and coalesces a null `Items` to an empty array before selection (`ADCHome.razor.cs:80-89`).
- **Why it's built this way**: A dedicated envelope keeps deserialization total: a missing or empty payload flows through as an empty list and the page falls back to its hardcoded defaults rather than throwing.
- **Where it's used**: The `GetFromJsonAsync<ADCCollectionResult>` call inside [ADCHome](#adchome) (`ADCHome.razor.cs:80`).

### SponsorTierInfo
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:286` · Level 1 · record

- **What it is**: A private, sealed record grouping sponsors into a named, color-coded tier (for example Platinum, Gold, Silver, Swag) for the sponsor wall.
- **Depends on**: [SponsorInfo](#sponsorinfo) via `IReadOnlyList<SponsorInfo>` (`ADCHome.razor.cs:286`), plus BCL `string`. Composing the Level-0 sponsor record makes this Level 1.
- **Concept introduced**: Same hardcoded editorial-content pattern as [ConferenceTrackInfo](#conferencetrackinfo), one level up: a tier owns its own list of sponsors so the wall can render tier headings and swatches.
- **Walkthrough**: Three positional members (`ADCHome.razor.cs:286`): `Name`, `Color` (a hex swatch such as `#E5E4E2`), and `Sponsors`. The `SponsorTiers` array declares four tiers (`ADCHome.razor.cs:232-258`). Two helpers key off the tier: `GetTierIcon` maps the tier name to a MudBlazor icon (`ADCHome.razor.cs:260-267`), and `GetTierHeading` builds a localized "`<tier> <label>`" heading, choosing singular/plural and sponsor/partner wording for the Swag tier via a tuple switch and resource lookups (`ADCHome.razor.cs:271-282`).
- **Why it's built this way**: `GetTierHeading` runs the visible tier labels through the `L[...]` localizer (ADR-027) so word order and pluralization follow the selected language, while the sponsor names themselves stay editorial content (`ADCHome.razor.cs:269-270`). `[Rubric §27, i18n]`, which assesses localization readiness: the chrome around the sponsor data is localized even though the data is not.
- **Where it's used**: The `SponsorTiers` static array in [ADCHome](#adchome) (`ADCHome.razor.cs:232`).

### ADCHome
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor.cs:13` · Level 7 · class

- **What it is**: The sealed partial code-behind for the ADC conference landing page: a hero with a live countdown, the keynote section, the twelve-track grid, the sponsor wall, and the venue/location block. It fetches the featured event to drive the countdown and composes all the record types above.
- **Depends on**: [ADCCollectionResult](#adccollectionresult), [ADCEventInfo](#adceventinfo), [EventPhase](#eventphase), [KeynoteSpeakerInfo](#keynotespeakerinfo), [ConferenceTrackInfo](#conferencetrackinfo), [SponsorTierInfo](#sponsortierinfo), [SponsorInfo](#sponsorinfo) (all declared in this file), and [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) from the Conference shared layer (`ADCHome.razor.cs:84`). Externals: `IHttpClientFactory`, `System.Threading.Timer`, `TimeZoneInfo`, `System.Text.Json` (BCL), MudBlazor `Icons`, and the injected `L` localizer (`ADCHome.razor.cs:1-5`).
- **Concept introduced**: **Timer-driven Blazor countdown with disciplined disposal.** The page is a self-contained stateful component: it opens a `CancellationTokenSource`, loads data, then ticks a one-second `Timer`, and it implements `IDisposable` to tear all of that down. `[Rubric §19, State Management]`, which assesses lifecycle and transient state: the component cancels its in-flight fetch, stops and disposes the timer, and guards ticks with a `_disposed` flag so a late callback cannot touch a torn-down component (`ADCHome.razor.cs:106-119`, `166-173`). `[Rubric §18, UI Architecture]`: the two-tier content model (fetched event versus hardcoded editorial data) keeps the page rendering even when the API is slow or unavailable.
- **Walkthrough**:
  - Fields (`ADCHome.razor.cs:15-27`): static `ApiJsonOptions` (web JSON defaults) and `EventStartTime` (08:00), plus per-instance `_cts`, `_countdownTimer`, `_timeRemaining`, `_phase`, `_event`, `_isLoading`, and `_disposed`.
  - `OnInitializedAsync` (`ADCHome.razor.cs:64-73`): creates the `_cts`, awaits `LoadEventAsync`, and starts the one-second timer only when the phase is not already `Ended`.
  - `LoadEventAsync` (`ADCHome.razor.cs:75-104`): fetches `events` through the named `APIClient`, then calls `CurrentEventSelector.SelectCurrentOrNext(...)` to feature the live-or-next event instead of an arbitrary first item; it swallows `OperationCanceledException` (disposed mid-load) and `HttpRequestException` (API down) so the fallback defaults render, and always clears `_isLoading` and refreshes the countdown in `finally`.
  - `UpdateCountdown` (`ADCHome.razor.cs:121-155`): converts the event's local start/end (using its `TimeZone`, defaulting to `America/New_York`) to UTC via `TimeZoneInfo`, falling back to treating the values as UTC on `TimeZoneNotFoundException`, then sets `_timeRemaining` and `_phase`.
  - `OnTimerTick` (`ADCHome.razor.cs:106-119`): returns immediately if disposed, recomputes the countdown, marshals a re-render with `InvokeAsync(StateHasChanged)`, and halts the timer once `Ended`.
  - Presentation helpers: `HeroTitleParts` splits the event name to accent the keyword between "Atlanta " and " Conference" (`ADCHome.razor.cs:50-62`); `FormatEventDate` formats the date with a resource-supplied pattern under `CurrentCulture` (`ADCHome.razor.cs:157-164`); `GetTierIcon` and `GetTierHeading` back the sponsor wall (`ADCHome.razor.cs:260-282`).
  - `Dispose` (`ADCHome.razor.cs:166-173`): sets `_disposed`, cancels and disposes the `_cts`, and stops and disposes the timer.
- **Why it's built this way**: Cancellation plus the `_disposed` guard prevent the classic Blazor bug where a background timer or an in-flight HTTP call calls back into a disposed component. Routing event selection through the shared `CurrentEventSelector` keeps the "which event is featured" rule identical across clients (an unordered `FirstOrDefault` would pin the oldest seeded event, `ADCHome.razor.cs:82-83`). Formatting and tier headings go through the `L[...]` localizer so the chrome honors ADR-027 while the editorial content stays English-only.
- **Where it's used**: Exposed as the home component through [ADCHomePageContent](#adchomepagecontent), and referenced by its WebAssembly twin in `MMCA.ADC.UI.Web.Client` (a structural duplicate compiled for the browser render path).
- **Caveats / not-in-source**: The Razor markup (`ADCHome.razor`) is not part of this unit; this code-behind file is the ground truth for the page's data and lifecycle logic.

### ADCHomePageContent
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` · Level 8 · class

- **What it is**: A sealed adapter that plugs the ADC landing page into the shared host shell by implementing the framework's home-page content contract: it names the component type and the page title.
- **Depends on**: [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) from `MMCA.Common.UI` (`ADCHomePageContent.cs:1,8`) and [ADCHome](#adchome) via `typeof` (`ADCHomePageContent.cs:10`).
- **Concept introduced**: **App-supplied content for a shared shell.** The shared `Home.razor` shell does not hardcode any app's landing page; each app registers an `IHomePageContent` that tells the shell which component to render and what title to show. `[Rubric §2, Design Patterns]`, which assesses pattern use at boundaries: this is a small strategy/adapter that keeps the shell app-agnostic and the ADC-specific landing page in the ADC UI project.
- **Walkthrough**: Two get-only members: `ComponentType => typeof(ADCHome)` (`ADCHomePageContent.cs:10`) hands the shell the component to render, and `PageTitle => "Atlanta Developers Conference"` (`ADCHomePageContent.cs:12`) supplies the title (an `i18n: allow` brand name).
- **Why it's built this way**: Inverting the dependency (app implements the Common contract, Common consumes it) lets the same shell host Store, ADC, and Helpdesk without any app reference, satisfying the framework's "build once, compose per app" boundary.
- **Where it's used**: Registered in the ADC UI host's DI as the `IHomePageContent` implementation, resolved by the shared `Home.razor` shell (MAUI host); the WebAssembly client project carries its own structural twin.

### ADCEventInfo
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:209` · Level 0 · record

- **What it is**: the private wire-shape the [`ADCHome`](#adchome) landing page deserializes each published event into, the subset of the Conference `/events` response the countdown and hero actually read (`Id`, `Name`, `Description`, `StartDate`, `EndDate`, `TimeZone`, `VenueAddress`, `VenueMapUrl`).
- **Depends on**: nothing first-party (BCL `DateOnly`). It is a `private sealed record` nested inside `ADCHome`.
- **Concept**: a component-local read model. `[Rubric §9, API & Contract Design]` (assesses tight, purpose-shaped client contracts): rather than pull the full server DTO into the client, the page declares only the eight fields it renders, so a change to unrelated event fields cannot break the landing page. `[Rubric §18, UI Architecture]` (a page owns its own view model).
- **Walkthrough**: a positional record with eight components (`ADCHome.razor.cs:209-217`). `Description`, `VenueAddress`, and `VenueMapUrl` are nullable so the fallback getters on the page can substitute defaults; `StartDate`/`EndDate` are `DateOnly` and `TimeZone` a string, the three inputs `UpdateCountdown` needs to compute UTC boundaries (`ADCHome.razor.cs:161-171`).
- **Why it's built this way**: keeping it `private` to the page means it is an implementation detail, never a shared contract; `System.Text.Json` (`JsonSerializerDefaults.Web`) binds it by property name off the `events` payload.
- **Where it's used**: the element type of [`ADCCollectionResult.Items`](#adccollectionresult), selected down to one featured event by [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) in `ADCHome.LoadEventAsync` (`ADCHome.razor.cs:133-142`).

### ConferenceTrackInfo
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:316` · Level 0 · record

- **What it is**: a three-field content record (`Name`, `Icon`, `Topics`) describing one conference track card on the landing page.
- **Depends on**: nothing first-party; `Icon` values come from MudBlazor's `Icons.Material.Filled.*` constants (a NuGet string catalog).
- **Concept**: static editorial content held in code. `[Rubric §18, UI Architecture]` and `[Rubric §27, Internationalization]`: the twelve `Tracks` entries (`ADCHome.razor.cs:234-260`) are the same English-only catalog the API would serve, marked `// i18n: allow` at the array declaration (`ADCHome.razor.cs:220-221`); the localized chrome wraps this content rather than translating it.
- **Walkthrough**: a positional `private sealed record` (`ADCHome.razor.cs:316`). `Icon` carries a MudBlazor material-icon path string (e.g. `Icons.Material.Filled.Psychology`); `Topics` is a single comma-joined string rendered under each track name.
- **Where it's used**: the static `Tracks` array field on [`ADCHome`](#adchome) (`ADCHome.razor.cs:234`), rendered by the page's Razor markup.

### EventPhase
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:30` · Level 0 · enum

- **What it is**: the three-state lifecycle the landing page uses to decide what to show relative to the featured event's start/end: `Upcoming`, `Live`, `Ended`.
- **Depends on**: nothing first-party. It is a `private enum` nested in [`ADCHome`](#adchome).
- **Concept**: UI state as an explicit enum rather than a tangle of booleans. `[Rubric §19, State Management]` (assesses a single, legible source of view state): the page computes one `_phase` field from the clock and branches its hero, countdown, and timer arming off it instead of scattering `now < start` comparisons through the markup.
- **Walkthrough**: three members, `Upcoming`, `Live`, `Ended` (`ADCHome.razor.cs:32-34`). It is assigned in exactly one place, the `now switch` inside `UpdateCountdown` (`ADCHome.razor.cs:180-185`): before start is `Upcoming`, before end is `Live`, otherwise `Ended`. `ArmPhaseTimerForEventEnd` only schedules its one-shot re-render while `_phase == EventPhase.Live` (`ADCHome.razor.cs:102`).
- **Where it's used**: entirely within [`ADCHome`](#adchome); it never crosses the component boundary.

### KeynoteSpeakerInfo
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:315` · Level 0 · record

- **What it is**: a four-field content record for the featured keynote (`Name`, `Title`, `TalkTitle`, `BioParagraphs`), where `BioParagraphs` is a `string[]` rendered as the multi-paragraph abstract.
- **Depends on**: nothing first-party.
- **Concept**: see [`ConferenceTrackInfo`](#conferencetrackinfo), the same static-editorial-content pattern. The single `Keynote` instance (`ADCHome.razor.cs:222-232`) is `// i18n: allow` conference content, not localized chrome.
- **Walkthrough**: a positional `private sealed record` (`ADCHome.razor.cs:315`); `BioParagraphs` is an array so the markup can emit one block per paragraph without splitting a single string.
- **Where it's used**: the static `Keynote` field on [`ADCHome`](#adchome) (`ADCHome.razor.cs:222`).

### SponsorInfo
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:318` · Level 0 · record

- **What it is**: a single sponsor's display data: `Name`, `LogoUrl`, and the outbound `Url` its logo links to.
- **Depends on**: nothing first-party.
- **Concept**: the leaf of the sponsor content tree. `[Rubric §26, Front-End Security]` touches this lightly: the logo and link URLs are hardcoded external constants (an S1075 analyzer suppression is applied at the `SponsorTiers` field, `ADCHome.razor.cs:262`), a deliberate trade for editorial content that never comes from user input.
- **Walkthrough**: a positional `private sealed record` (`ADCHome.razor.cs:318`), constructed inline inside the `SponsorTiers` initializer (e.g. `ADCHome.razor.cs:267-278`).
- **Where it's used**: held in the `Sponsors` list of each [`SponsorTierInfo`](#sponsortierinfo).

### ADCCollectionResult
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:207` · Level 1 · record

- **What it is**: the tiny envelope the page deserializes the `/events` response into, a single nullable `Items` list of [`ADCEventInfo`](#adceventinfo).
- **Depends on**: [`ADCEventInfo`](#adceventinfo) (Level 0).
- **Concept**: a client-side projection of the framework's paged collection contract. `[Rubric §9, API & Contract Design]`: the server returns a richer collection shape, but the page only needs `Items`, so it declares a one-property record that binds that field and ignores the rest.
- **Walkthrough**: `private sealed record ADCCollectionResult(List<ADCEventInfo>? Items)` (`ADCHome.razor.cs:207`). `Items` is nullable; the caller coalesces it to an empty array before selection (`result?.Items ?? []`, `ADCHome.razor.cs:139`).
- **Where it's used**: the type argument of the `GetFromJsonAsync<ADCCollectionResult>("events", …)` call in `ADCHome.LoadEventAsync` (`ADCHome.razor.cs:133`).

### AppActionsInitializer
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/AppActionsInitializer.cs:16` · Level 1 · class (sealed)

- **What it is**: a MAUI startup service that publishes the three home-screen quick actions (long-press app-icon shortcuts) once the app is built, with localized titles, and maps each action id to an in-app route.
- **Depends on**: `IMauiInitializeService` (the MMCA.Common.UI initialization contract it implements), `IStringLocalizer<AppActionsInitializer>` (BCL localization), `AppActions`/`AppAction`/`FeatureNotSupportedException` (MAUI Essentials); route constants from [`EngagementRoutePaths`](group-22-engagement-module.md#engagementroutepaths) and [`NotificationRoutePaths`](group-15-common-ui-framework.md#notificationroutepaths). Its titles/routes feed the [`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) path documented in the class comment.
- **Concept introduced, native quick actions as a navigation surface.** `[Rubric §25, Navigation & IA]` (assesses first-class entry points into the app): the three shortcuts (`happening_now`, `my_schedule`, `notifications`, `AppActionsInitializer.cs:18-20`) are OS-level deep-link jump points, not in-app links. `[Rubric §27, Internationalization]`: their titles are resolved from the resx pair via the injected localizer at build time (`AppActionsInitializer.cs:54-56`), so the shortcut labels follow the selected language.
- **Walkthrough**
  - `Initialize(IServiceProvider)` (`AppActionsInitializer.cs:23`): null-guards, short-circuits when `AppActions.Current.IsSupported` is false (`:27-30`), resolves the localizer, then fires `SetActionsAsync` **fire-and-forget** (`_ =`, `:36`) so a slow or failing shortcut registration can never block or fail app startup (the inline comment states exactly this, `:34-35`).
  - `RouteFor(string actionId)` (`AppActionsInitializer.cs:40`): a `switch` mapping each id to its app-relative route (`EngagementRoutePaths.HappeningNow`, a literal `/conference/sessions?mine=true`, `NotificationRoutePaths.NotificationInbox`), returning `null` for an unknown id. This is the lookup the activation handler in `MauiProgram` calls.
  - `SetActionsAsync` (`AppActionsInitializer.cs:48`): builds the three `AppAction`s and calls `AppActions.Current.SetAsync`, catching `FeatureNotSupportedException` because some launchers report support then reject at runtime (`:60-64`).
- **Why it's built this way**: registration (titles) and activation (routing) are split, the initializer sets the shortcuts, [`MauiProgram`](#mauiprogram) wires `OnAppAction` to `RouteFor`, and both publish the resolved route to the shared deep-link dispatcher, which buffers cold-start activations until the listener renders (class comment, `AppActionsInitializer.cs:9-15`). ADR-042 (the MAUI head) is the governing decision.
- **Where it's used**: registered as an `IMauiInitializeService` in the MAUI head's DI; its `RouteFor` is invoked by the `ConfigureEssentials(e => e.OnAppAction(...))` handler in [`MauiProgram`](#mauiprogram).

### MauiPublicLinkBuilder
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [`IPublicLinkBuilder`](group-21-conference-ui.md#ipubliclinkbuilder): it turns a relative path into an absolute URL rooted at the public web app, so a shared or copied link points at the public site, not the WebView's internal origin.
- **Depends on**: [`IPublicLinkBuilder`](group-21-conference-ui.md#ipubliclinkbuilder) (implements), `IConfiguration` (BCL), `System.Uri`.
- **Concept**: platform-specific override of a UI service. `[Rubric §26, Front-End Security]`/`[Rubric §25, Navigation & IA]`: on the browser head the default builder resolves against the current origin, but a MAUI WebView's origin is an internal shell address that is meaningless when pasted elsewhere, so this head substitutes the pinned public base URL. It is registered **after** the module registrations in `MauiProgram` so last-registration-wins replaces the browser default (class comment, `MauiPublicLinkBuilder.cs:6-12`).
- **Walkthrough**
  - Constructor (`MauiPublicLinkBuilder.cs:18`): reads `PublicSite:BaseUrl` from the embedded appsettings and **throws `InvalidOperationException` if it is missing or blank** (`:20-23`), a fail-fast so a misconfigured build cannot silently emit broken share links. The same mechanism pins the gateway endpoint.
  - `BuildAbsolute(string relativePath)` (`MauiPublicLinkBuilder.cs:27`): guards against a null/blank path, then combines it onto `_baseUrl` via the `Uri(baseUri, relative)` constructor (`:29-31`).
- **Where it's used**: injected wherever the Conference UI builds shareable links (the `IPublicLinkBuilder` consumers in [Group 21](group-21-conference-ui.md)); only the MAUI head registers this variant.

### MauiTokenStorageService
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiTokenStorageService.cs:9` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), persisting the JWT access and refresh tokens in the platform secure enclave via MAUI `SecureStorage`.
- **Depends on**: [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (implements), MAUI `SecureStorage` (Essentials).
- **Concept introduced, at-rest token protection on the device head.** `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` (assess where credentials live at rest): the browser client keeps tokens in the circuit/local storage, but the MAUI head can do better, `SecureStorage` routes to the platform-specific secure enclave (Android Keystore, iOS Keychain, Windows DPAPI, per the class comment, `MauiTokenStorageService.cs:5-8`), so tokens are encrypted at rest by the OS.
- **Walkthrough**: two fixed key constants (`auth_access_token`, `auth_refresh_token`, `MauiTokenStorageService.cs:11-12`). `GetAccessTokenAsync`/`GetRefreshTokenAsync` (`:14`, `:20`) read via `SecureStorage.Default.GetAsync`; `SetTokensAsync` (`:26`) writes both; `ClearTokensAsync` (`:32`) removes both and returns `Task.CompletedTask` (the remove call is synchronous).
- **Why it's built this way**: keeping the same `ITokenStorageService` interface across heads means the shared auth pipeline is head-agnostic; only the storage backend swaps. See `TokenStorageDesignNote.md` for the cross-head storage rationale.
- **Where it's used**: registered as the `ITokenStorageService` in the MAUI head's DI; consumed by the shared auth/token-refresh services in [Group 15](group-15-common-ui-framework.md).

### SponsorTierInfo
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:317` · Level 1 · record

- **What it is**: a sponsor tier grouping, its `Name`, a `Color` swatch, and the `Sponsors` list of [`SponsorInfo`](#sponsorinfo) shown in that band.
- **Depends on**: [`SponsorInfo`](#sponsorinfo) (Level 0).
- **Concept**: the one-to-many parent of the sponsor content tree. `[Rubric §20, Design System & Theming]` (assesses consistent visual tokens): each tier carries its own hex `Color` and is paired with a material icon by the page's `GetTierIcon` switch (`ADCHome.razor.cs:291-298`), keeping tier styling data-driven.
- **Walkthrough**: `private sealed record SponsorTierInfo(string Name, string Color, IReadOnlyList<SponsorInfo> Sponsors)` (`ADCHome.razor.cs:317`). The four tiers are declared in the static `SponsorTiers` array (`ADCHome.razor.cs:263-289`); Gold and Silver ship with empty sponsor lists today. The page turns a tier plus its count into a localized "<tier> <label>" heading via `GetTierHeading` (`ADCHome.razor.cs:302-313`), whose singular/plural and partner-vs-sponsor wording is resource-driven (ADR-027).
- **Where it's used**: the static `SponsorTiers` field on [`ADCHome`](#adchome) (`ADCHome.razor.cs:263`).

### ADCHome
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:13` · Level 7 · class (sealed partial)

- **What it is**: the code-behind for the ADC conference landing page, a `sealed partial` component implementing `IDisposable` that fetches the featured published event, drives a countdown timer, and renders the hero, keynote, tracks, sponsors, and venue map.
- **Depends on**: [`ADCEventInfo`](#adceventinfo)/[`ADCCollectionResult`](#adccollectionresult) (its API models), [`EventPhase`](#eventphase), the content records [`KeynoteSpeakerInfo`](#keynotespeakerinfo)/[`ConferenceTrackInfo`](#conferencetrackinfo)/[`SponsorTierInfo`](#sponsortierinfo)/[`SponsorInfo`](#sponsorinfo), and [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) for the "current-or-next" pick. Externals: `IHttpClientFactory`, `System.Threading.Timer`, `TimeZoneInfo`, MudBlazor, and the injected `IStringLocalizer` (`L`).
- **Concept introduced, a prerender-safe, render-fenced Blazor page.** `[Rubric §23, Front-End Performance]` (assesses avoiding wasted server work and wasted re-renders). Two decisions stand out. First, `OnInitializedAsync` **skips the backend fetch during SSR prerender** (`if (!RendererInfo.IsInteractive)`, `ADCHome.razor.cs:74-79`): an un-timed server-side call to a cold or unreachable backend would block the prerender, and therefore the page load and the post-login `NavigateTo("/")`, indefinitely, so the static fallback renders now and the interactive pass loads the real event. Second, the per-second ticking lives in a child countdown component (a render fence); this page only arms a **single one-shot timer** for the `Live -> Ended` flip (`ArmPhaseTimerForEventEnd`, `ADCHome.razor.cs:100-115`) instead of re-rendering the whole page every second for the entire event. `[Rubric §29, Resilience & Business Continuity]`: a failed fetch (`HttpRequestException`) or a disposed component (`OperationCanceledException`) falls through to hardcoded fallback defaults rather than erroring (`ADCHome.razor.cs:144-157`). `[Rubric §27, Internationalization]`: user-facing chrome resolves through `L[...]` and the date pattern itself is a resource (`FormatEventDate`, `ADCHome.razor.cs:188-195`, ADR-027).
- **Walkthrough**
  - Fields (`ADCHome.razor.cs:15-28`): a static `JsonSerializerOptions` (Web defaults), a static 08:00 `EventStartTime`, a `CancellationTokenSource`, the one-shot `_phaseTimer`, the computed `_startUtc`/`_endUtc`, `_phase`, the loaded `_event`, and `_isLoading`/`_disposed` flags.
  - Presentation helpers: `EventName`/`EventDescription`/`VenueAddress`/`MapSearchUrl` (`ADCHome.razor.cs:37-44`) coalesce the loaded event against brand defaults; `HeroTitleParts` (`:51`) splits the name to accent the keyword between "Atlanta " and " Conference".
  - `OnInitializedAsync` (`ADCHome.razor.cs:65`): creates the CTS, takes the prerender fast path, otherwise awaits `LoadEventAsync` then arms the end-of-event timer.
  - `LoadEventAsync` (`ADCHome.razor.cs:128`): resolves the named `"APIClient"` HttpClient, `GetFromJsonAsync<ADCCollectionResult>("events", …)`, then narrows to one event with `CurrentEventSelector.SelectCurrentOrNext(...)` (`:137-142`) so an unordered `FirstOrDefault` cannot pin the oldest seeded event; the `finally` always clears `_isLoading` and recomputes the countdown.
  - `UpdateCountdown` (`ADCHome.razor.cs:159`): converts the event's local start/end (or 2026-10-17 defaults) to UTC via `TimeZoneInfo`, falling back to the local values if the zone id is unknown (`:173-177`), then assigns `_phase` from the `now switch` (`:180-185`).
  - `OnCountdownElapsedAsync` (`:89`) and `OnEventEnded` (`:117`) recompute and re-render on the `Upcoming -> Live` and `Live -> Ended` transitions; `Dispose` (`:197`) sets `_disposed`, cancels/disposes the CTS, and disposes the timer.
  - Static content: the single `Keynote`, twelve `Tracks`, and four `SponsorTiers` (`ADCHome.razor.cs:222-289`), plus the `GetTierIcon`/`GetTierHeading` helpers.
- **Why it's built this way**: the landing page must render instantly and identically whether the backend is warm, cold, or down, and must never wedge the prerender that gates login navigation; pushing the tick into a child fence and the fetch behind an interactivity check delivers both.
- **Where it's used**: exposed to the shared `Home.razor` shell by [`ADCHomePageContent`](#adchomepagecontent), which names it as its `ComponentType`.
- **Caveats / not-in-source**: the per-second countdown rendering and the `OnCountdownElapsedAsync` trigger live in the child countdown component's markup, not in this file; only the `Live -> Ended` one-shot is wired here.

### ADCHomePageContent
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:8` · Level 8 · class (sealed)

- **What it is**: the ADC binding of the framework's [`IHomePageContent`](group-15-common-ui-framework.md#ihomepagecontent) extension point, it tells the shared `Home.razor` shell which component to render as the app's landing page and what browser title to use.
- **Depends on**: [`IHomePageContent`](group-15-common-ui-framework.md#ihomepagecontent) (implements), [`ADCHome`](#adchome) (the component it points at).
- **Concept introduced, app-supplied content into a shared shell.** `[Rubric §18, UI Architecture]` and `[Rubric §2, Design Patterns]` (assess a reusable shell that host apps specialize): the framework ships a generic `Home.razor` shell; each app registers one `IHomePageContent` that hands the shell a `ComponentType` to render and a `PageTitle`. This inverts the dependency, the shared shell never references the ADC page directly.
- **Walkthrough**: two expression-bodied properties, `ComponentType => typeof(ADCHome)` (`ADCHomePageContent.cs:10`) and `PageTitle => "Atlanta Developers Conference"` (`:12`, an `// i18n: allow` brand name). No state, no logic.
- **Why it's built this way**: keeping the shell app-agnostic means the Web/WASM heads reuse one landing shell and only the plugged-in content differs per app.
- **Where it's used**: registered as the `IHomePageContent` for the ADC Web client and resolved by the shared `Home.razor` shell in [Group 15](group-15-common-ui-framework.md).
- **Caveats / not-in-source**: the prior tier edition described a paired MAUI `ADCHomePageContent` in `MMCA.ADC.UI`; this unit's source is the single WASM-client class in `MMCA.ADC.UI.Web.Client`, which references the same [`ADCHome`](#adchome) component.

### App
> MMCA.ADC.UI · `MMCA.ADC.UI.WinUI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8` · Level 10 · class (partial)

- **What it is**: the WinUI (Windows) platform entry point for the MAUI head, a `partial` class deriving from `MauiWinUIApplication` that supplies the Windows-specific application object and builds the shared MAUI app.
- **Depends on**: `MauiWinUIApplication` (MAUI Windows), and [`MauiProgram`](#mauiprogram) (whose `CreateMauiApp()` builds the shared DI/configuration graph).
- **Concept, the per-platform MAUI bootstrapper.** `[Rubric §22, Responsive & Cross-Browser]` (assesses multiple platform targets from shared code): MAUI centralizes the DI/config graph in one `MauiProgram`; each platform provides a thin entry point that calls it. This is the Windows counterpart to the Android/iOS/macOS entry points, each is a few lines that defer to the same `CreateMauiApp()`.
- **Walkthrough**: the constructor calls `InitializeComponent()` (`App.xaml.cs:14`, the logical `main()` per its doc comment), and the override `CreateMauiApp() => MauiProgram.CreateMauiApp()` (`:16`) returns the shared app. Nothing else, all app composition lives in [`MauiProgram`](#mauiprogram).
- **Why it's built this way**: `partial` because the `App.xaml` markup generates the other half; deriving from `MauiWinUIApplication` lets the Windows shell host the cross-platform MAUI app with a minimal per-platform surface.
- **Where it's used**: the WinUI runtime instantiates it as the Windows application object; it is the Windows sibling of the Android/iOS/macOS heads.
- **Caveats / not-in-source**: the prior tier edition described `App` as inheriting `Application` and holding a `MainPage` reference; the current WinUI class inherits `MauiWinUIApplication` and only overrides `CreateMauiApp()` (verified at `App.xaml.cs:8-17`).


---
[⬅ ADC Identity Module (Users, Profiles, GDPR Export/Erasure)](group-24-identity-module.md)  •  [Index](00-index.md)  •  [Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters) ➡](group-26-device-capability-layer.md)
