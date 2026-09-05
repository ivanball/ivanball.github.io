# 25. ADC Application Host, UI Shell & Cross-Module Composition

**What this chapter covers.** Every ADC module described so far (Conference, Engagement, Identity,
Notification) is *consumed* somewhere. This chapter is that somewhere: the **client tier** of ADC,
the code that turns the shared per-module Razor Class Libraries (`MMCA.ADC.{Module}.UI`) and the
framework UI packages ([`MMCA.Common.UI`](group-15-common-ui-framework.md) and its MAUI companion)
into running applications, and composes every conference module into one shell. Two application
shapes are built from the same component set: a **Blazor Web** app (Server prerender plus a
WebAssembly client) and a **.NET MAUI Blazor Hybrid** native app for Android, iOS, macOS (Catalyst),
and Windows. The types this group owns are deliberately thin: the two
[`ADCHomePageContent`](#adchomepagecontent) home-content adapters (one per head), the MAUI-only
services ([`AppActionRouteMap`](#appactionroutemap), [`AppActionsInitializer`](#appactionsinitializer)),
the MAUI-head composition and native entry surfaces ([`DeviceUIModule`](#deviceuimodule),
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity),
[`NowNextWidgetProvider`](#nownextwidgetprovider) with its local
[`NowNextSnapshot`](#nownextsnapshot) and [`NowNextSession`](#nownextsession) records), and the MAUI
bootstrap chain ([`MauiProgram`](#mauiprogram), the cross-platform [`App`](#app),
[`MainPage`](#mainpage), and the per-OS entry points [`MainActivity`](#mainactivity),
[`MainApplication`](#mainapplication), [`AppDelegate`](#appdelegate), the iOS
[`Program`](#program), and the WinUI [`App`](#app)). The heavy lifting lives below them in the
modules, in [`MMCA.Common.UI`](group-15-common-ui-framework.md), and in the
[device-capability layer](group-26-device-capability-layer.md); this chapter is about **wiring and
hosting**, the half of "UI architecture" the modules cannot do for themselves. File paths in this
chapter are given as the unit table gives them, relative to `MMCA.ADC/Source/Hosts/UI/`.

**Three hosts, one shared component set.** The central idea, taught in
[primer §2, "Write-once UI, render everywhere"](00-primer.md#2-architectural-styles-this-codebase-commits-to),
is that a page is authored **once** as a Razor component in a module's UI library and then rendered
by every host without per-platform reimplementation. There are three host projects under
`MMCA.ADC/Source/Hosts/UI/`: `MMCA.ADC.UI.Web` (the Blazor **Server** host, SSR prerender plus the
interactive Server circuit), `MMCA.ADC.UI.Web.Client` (the Blazor **WebAssembly** client, compiled
to run in the browser), and `MMCA.ADC.UI` (the **.NET MAUI** host, which packages the same
components into a native app and renders them in a `BlazorWebView`). Read the three composition
roots side by side (`MMCA.ADC.UI.Web/Program.cs:31-103`, `MMCA.ADC.UI.Web.Client/Program.cs:23-82`,
`MMCA.ADC.UI/MauiProgram.cs:53-198`) and the family resemblance is obvious: the same MudBlazor
registration, the same `AddUIShared(builder.Configuration)`, the same four conditional module
registrations, then a short tail of host-specific adapters. `[Rubric §18, UI Architecture]` assesses
cohesive, composable components and a clean host/shell split; `[Rubric §22, Responsive &
Cross-Browser/Device]` assesses that one UI renders correctly across browsers and devices. Both are
embodied by this single-component-set, multi-host design: adding a platform is "add a host that
references the shared libraries", not "fork the UI". The MAUI head makes the point literally in
XAML: its `BlazorWebView` mounts the shared `MMCA.Common.UI` `Routes` component at `#app`
(`MMCA.ADC.UI/MainPage.xaml:17-21`), the same router the browser heads run.

**The shared-vs-host boundary: interfaces in Common, implementations per host.** The reason one
component can run in three places is that everything platform-specific hides behind interfaces
declared in [`MMCA.Common.UI`](group-15-common-ui-framework.md). A component never asks "am I on
MAUI?"; it asks an injected abstraction, and each host supplies the adapter. `[Rubric §1, SOLID]`
(Dependency Inversion) and `[Rubric §3, Clean Architecture]` are visible right here: the shared
library defines the contracts, the host supplies the adapters, and the framework depends on nothing
host-specific. **Home-page content**:
[`IHomePageContent`](group-15-common-ui-framework.md#ihomepagecontent) lets the shared `/` route
render an app-specific landing page, and each head registers its own
[`ADCHomePageContent`](#adchomepagecontent) (web `MMCA.ADC.UI.Web/Program.cs:63` and
`MMCA.ADC.UI.Web.Client/Program.cs:51`, MAUI `MMCA.ADC.UI/MauiProgram.cs:124`). **Token storage**:
[`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) abstracts where JWTs
live, and each head picks its implementation in one line: `AddCommonMauiTokenStorage()` on MAUI
(`MMCA.ADC.UI/MauiProgram.cs:163`, backed by the framework's
[`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice)),
`AddCommonServerTokenStorage()` on the Server head (`MMCA.ADC.UI.Web/Program.cs:76`, backed by
[`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice)), and an
explicit [`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice)
registration in the browser client (`MMCA.ADC.UI.Web.Client/Program.cs:54`). The refresher behind
[`ITokenRefresher`](group-15-common-ui-framework.md#itokenrefresher) splits the same way: the two
browser heads use
[`SameOriginProxyTokenRefresher`](group-15-common-ui-framework.md#sameoriginproxytokenrefresher)
(`MMCA.ADC.UI.Web/Program.cs:77`, `MMCA.ADC.UI.Web.Client/Program.cs:55`) while MAUI, which has no
same-origin proxy to lean on, uses
[`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher)
(`MMCA.ADC.UI/MauiProgram.cs:164`). **Form factor** is the same story in three registration lines:
`AddCommonWebFormFactor()`, `AddWasmFormFactor()`, and `AddMauiFormFactor()`
(`MMCA.ADC.UI.Web/Program.cs:96`, `MMCA.ADC.UI.Web.Client/Program.cs:82`,
`MMCA.ADC.UI/MauiProgram.cs:169`), all satisfying the same
[`IFormFactor`](group-26-device-capability-layer.md#iformfactor) contract. OAuth button availability
([`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings), satisfied by
[`ConfigurationOAuthUISettings`](group-15-common-ui-framework.md#configurationoauthuisettings) in
all three heads) and the device-capability layer
([`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) and its siblings,
`AddBrowserDeviceCapabilities()` on the web heads versus `UseMauiDeviceCapabilities()` on MAUI) work
the same way and are described in [Group 15](group-15-common-ui-framework.md) and the
[Group 26 device-capability layer](group-26-device-capability-layer.md).

**Registration order is load-bearing.** A detail worth internalizing before reading any host's
composition root: `AddUIShared` installs its defaults with `TryAdd`, so an override must be
registered either *before* it (to pre-empt the `TryAdd`) or *after* it (so "last registration
wins"). [`MauiProgram`](#mauiprogram) states the whole contract once, as a numbered comment block
above the registration sequence, so the per-call comments can stay short
(`MMCA.ADC.UI/MauiProgram.cs:78-93`). Direction one:
[`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings) is registered **before**
`AddUIShared` on every head, because a `TryAdd` already satisfied by an earlier plain `Add` is a
no-op, and that is what makes the head's implementation win and the social-login buttons appear
(`MMCA.ADC.UI/MauiProgram.cs:99,101`, `MMCA.ADC.UI.Web/Program.cs:55-56`,
`MMCA.ADC.UI.Web.Client/Program.cs:44-45`). Direction two: everything that overrides a shared
null/neutral default goes **after** it, which covers `UseMauiDeviceCapabilities()`
(`MauiProgram.cs:104`), the push token providers `AddMauiPushDeviceTokenProvider()`
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html),
`MauiProgram.cs:120`), `UseCommonBarcodeScanner(...)` for badge-check-in QR scanning
(`MauiProgram.cs:151-153`), and `AddBrowserDeviceCapabilities()` on the web heads
(`MMCA.ADC.UI.Web/Program.cs:61`, `MMCA.ADC.UI.Web.Client/Program.cs:49`). Direction three: a module
that registers its own default with a plain `Add` must be beaten the same way, which is why
`AddCommonMauiPublicLinkBuilder()` (the framework's MAUI
[`IPublicLinkBuilder`](group-15-common-ui-framework.md#ipubliclinkbuilder), so a copied link points
at the public web site rather than at the WebView origin) stays after every module registration
(`MauiProgram.cs:141`). The Blazor host runs the same play with its dynamic Content-Security-Policy
provider: `AddCommonBlazorCsp()`, backed by
[`BlazorCspPolicyProvider`](group-15-common-ui-framework.md#blazorcsppolicyprovider), is registered
*before* `AddCommonSecurityHeaders(...)` so it wins over the static default
(`MMCA.ADC.UI.Web/Program.cs:102-103`), feeding the framework's
[`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) over the
[`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider) boundary. The MAUI
comment block also records the one ordering-insensitive call in the sequence,
`UseMmcaMauiErrorHandling()` (`MauiProgram.cs:106-111`), which installs last-chance
`AppDomain.UnhandledException` and `TaskScheduler.UnobservedTaskException` handlers at build time so
an uncaught managed exception is logged rather than silently killing the app: a small but real
`[Rubric §13, Observability & Operability]` contribution on a platform with no server-side log sink.

**Which modules are in the build is configuration, not code.** All three heads gate every module UI
behind
[`UIModuleConfiguration`](group-15-common-ui-framework.md#uimoduleconfiguration)`.IsModuleEnabled`
(`MMCA.ADC.UI/MauiProgram.cs:127-137`, `MMCA.ADC.UI.Web/Program.cs:82-92`,
`MMCA.ADC.UI.Web.Client/Program.cs:61-71`), reading the `Modules` section (all four enabled in the
MAUI head's embedded settings, `MMCA.ADC.UI/appsettings.json:8-13`), so a deployment can ship
Conference-only, or Conference plus Engagement, without touching source. That is the client-side
mirror of the server-side module system in [Group 14](group-14-module-system-composition.md): each
enabled module contributes its [`IUIModule`](group-15-common-ui-framework.md#iuimodule) descriptor,
and the shell composes nav items, routable assemblies, and layout components from whatever is
registered. On the web host the composition is explicit at the end of `Program.cs`: every registered
`IUIModule`'s `Assembly` is concatenated with the three shared UI assemblies, deduplicated, and
handed to `MapRazorComponents<App>().AddAdditionalAssemblies(...)`
(`MMCA.ADC.UI.Web/Program.cs:198-212`). This is the group's cleanest
`[Rubric §15, Best Practices & Code Quality]` and `[Rubric §25, Navigation, Routing & IA]` moment: routes and
navigation are *discovered* from the enabled module set rather than maintained in a central list.

**The landing page and the two content adapters.** The conference landing page itself is **not**
owned by this group: `ADCHome` lives once in Conference's UI library and is documented in
[Group 21](group-21-conference-ui.md#adchome). What this group owns are the two thin adapters that
point the shared `/` route at it, and they are near twins. The web adapter returns the shared
component directly, aliased at the using site
(`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:2,13`); the MAUI adapter returns a local
`ADCHome.razor` wrapper (`MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`) whose entire body is one
element, the shared Conference component rendered with no parameters
(`MMCA.ADC.UI/Pages/ADCHome.razor:6`). Both heads serve the speaker images from their own site root,
so no image base path is overridden and the MAUI head simply carries its copy of the ADC-only
editorial assets under `wwwroot/images/speakers` rather than pushing them into the shared RCL
(`MMCA.ADC.UI/Pages/ADCHome.razor:1-5`). Both adapters return the same page title, "Atlanta
Developers Conference", carrying an explicit `// i18n: allow` comment that marks the brand name as a
deliberate localization exemption (`MMCA.ADC.UI/Pages/ADCHomePageContent.cs:12`,
`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:15`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). That the two adapters
differ only in *which* type they name is a good measure of how far the write-once story actually
goes.

**The MAUI bootstrap chain
([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).** Every
platform entry point does nothing but call [`MauiProgram`](#mauiprogram)`.CreateMauiApp()`:
[`MainApplication`](#mainapplication) on Android
(`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [`AppDelegate`](#appdelegate) plus the iOS
[`Program`](#program) on iOS (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:23`,
`MMCA.ADC.UI/Platforms/iOS/Program.cs:10-11`), and the WinUI [`App`](#app) on Windows
(`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`), while [`MainActivity`](#mainactivity) is the
Android launcher activity (`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:21-25`). `CreateMauiApp`
(`MMCA.ADC.UI/MauiProgram.cs:53`) builds the entire DI and configuration graph. Because MAUI does
not auto-load `appsettings.json` from disk, it reads the file from an **embedded resource** and
layers it into the builder's configuration (`MauiProgram.cs:66-74`); before that it composes the
MAUI builder chain itself, registering the app type, the CommunityToolkit required by the ADR-042
speech-to-text capability, the OpenSans font, and the `OnAppAction` handler
(`MauiProgram.cs:54-63`). Then come the BlazorWebView and MudBlazor services
(`MauiProgram.cs:92-93`), the shared UI (`MauiProgram.cs:99`), the native capabilities
(`MauiProgram.cs:104`), the home content (`MauiProgram.cs:122`), the module UIs
(`MauiProgram.cs:125-135`), and the MAUI flavors of the token, refresh, and auth-state services
(`MauiProgram.cs:161-164`). The head also registers its own two composition pieces:
[`DeviceUIModule`](#deviceuimodule) as an [`IUIModule`](group-15-common-ui-framework.md#iuimodule)
contributing the Device settings [`NavItem`](group-15-common-ui-framework.md#navitem) plus five
layout components (`MauiProgram.cs:157`, `MMCA.ADC.UI/DeviceUIModule.cs:23-33`), and
[`AppActionsInitializer`](#appactionsinitializer) as an `IMauiInitializeService` that sets localized
home-screen quick actions after build (`MauiProgram.cs:158`). The cross-platform [`App`](#app)
(`MMCA.ADC.UI/App.xaml.cs:11`) creates the single window hosting [`MainPage`](#mainpage), and
`MainPage` (`MMCA.ADC.UI/MainPage.xaml.cs:12`) is a two-member class: `InitializeComponent()` and a
`HostWebView` override returning the XAML-declared `BlazorWebView`
(`MMCA.ADC.UI/MainPage.xaml.cs:14,17`). Everything about the platform back gesture lives in the
framework base [`MainPageBase`](group-26-device-capability-layer.md#mainpagebase)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/MainPageBase.cs:20`), which consumes the
gesture (`MainPageBase.cs:30-35`), forwards it to the WebView's own history through
[`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge)
(`MainPageBase.cs:69`), and quits only when the WebView reports it is at the root
(`MainPageBase.cs:70-73`). `[Rubric §25, Navigation, Routing & IA]` shows up in that bridge: native
back must map onto in-app navigation, not OS app-switching, or the native experience feels broken.
`MainActivity`'s `ConfigurationChanges` attribute (`MainActivity.cs:25`) is the other native
subtlety: it stops Android from destroying the activity (and with it the Blazor render tree and all
component state) on rotation or a dark-mode toggle.

**Native entry surfaces all funnel into one dispatcher
([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) /
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).**
Several MAUI-head types exist for one purpose: to bring the platform's native entry points back into
the same in-app navigation the WebView already runs. [`MainActivity`](#mainactivity) declares an
`IntentFilter` for verified Android **App Links** (https URLs on the pinned public web host,
`MainActivity.cs:26-31,39`) plus a second filter for the Essentials app-action intent
(`MainActivity.cs:32-34`), and publishes the incoming URL's path plus query to
[`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) from both `OnCreate`
and `OnNewIntent` through one private helper (`MainActivity.cs:42-46,58-63,65-80`); its `OnResume`
and `OnNewIntent` overrides also forward to `EssentialsPlatform` so a cold-start shortcut tap
actually raises `OnAppAction` (`MainActivity.cs:49-55,61`). [`AppDelegate`](#appdelegate) does the
equivalent for iOS Universal Links in `ContinueUserActivity`
(`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:26-44`), forwards shortcut taps to Essentials in
`PerformActionForShortcutItem` (`AppDelegate.cs:63-67`), and carries the two fixed UIKit selectors
that publish the APNs device token (or a null on failure) into the framework's `ApnsTokenBridge`
(`AppDelegate.cs:52-59`,
[ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)). The custom-scheme
OAuth completion redirect (`atldevcon://`) lands on
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity)
(`MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:14-21`) so MAUI's
`WebAuthenticator` can resume the pending social-login flow. Home-screen quick actions are split
across two types on purpose:
[`AppActionsInitializer`](#appactionsinitializer) owns the platform half (checking
`AppActions.Current.IsSupported`, resolving three localized titles, and setting the actions
fire-and-forget so startup can never block on them,
`MMCA.ADC.UI/Services/AppActionsInitializer.cs:25-39,41-51`), while
[`AppActionRouteMap`](#appactionroutemap) owns the pure id-to-route mapping and references no
`Microsoft.Maui.*` API at all (`MMCA.ADC.UI/Services/AppActionRouteMap.cs:22,49-63`).
`MauiProgram.HandleAppAction` calls `AppActionRouteMap.RouteFor(action.Id)` and publishes the result
into the same dispatcher (`MauiProgram.cs:213-226`). The Android home-screen
[`NowNextWidgetProvider`](#nownextwidgetprovider) is a self-contained, best-effort surface: on each
update it fetches the anonymous `Events/now-next` snapshot into its local
[`NowNextSnapshot`](#nownextsnapshot) and [`NowNextSession`](#nownextsession) records
(`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:109-128,132,134`), renders one "Now" and
one "Next" line, and taps back into `MainActivity`'s deep-link path
(`NowNextWidgetProvider.cs:85-96`); it never throws, keeping the last rendered content on any
failure (`NowNextWidgetProvider.cs:57-62`), which with the widget's own 8-second HTTP timeout
(`NowNextWidgetProvider.cs:119`) is a compact `[Rubric §29, Resilience]` statement about an optional
surface. The web side of the link association is served by the Blazor host, which maps the App Links
and Universal Links association documents from configuration
(`MMCA.ADC.UI.Web/Program.cs:180-191`), and the applinks components mirror the same Blazor routes
the app uses: identical URLs on web and device, no route translation table.

**Testability of a head that has no test project.** No MAUI target framework in this workspace has a
test project, so the ordering contract inside `MauiProgram` is verified by review rather than by a
fitness test, and the file says so (`MMCA.ADC.UI/MauiProgram.cs:90-93`). The response is a rule
rather than a shrug: anything expressible without a MAUI type belongs *outside* the MAUI-targeted
file. [`AppActionRouteMap`](#appactionroutemap) is the worked example. It is deliberately MAUI-free
(`AppActionRouteMap.cs:9-20`), which lets it compile under a plain `net10.0` target, and it is
linked into `MMCA.ADC.Engagement.UI.Tests` as a `<Compile Include>` item and asserted directly
(`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/MMCA.ADC.Engagement.UI.Tests.csproj:26-28`,
`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Services/AppActionRouteMapTests.cs:22-47`).
Its route constants come from the modules' own published path constants
([`EngagementRoutePaths`](group-22-engagement-module.md#engagementroutepaths) and
[`NotificationRoutePaths`](group-15-common-ui-framework.md#notificationroutepaths),
`AppActionRouteMap.cs:58-60`), with one literal for the "my schedule" case because it is the session
list route carrying a `mine=true` filter rather than a route of its own
(`AppActionRouteMap.cs:33-38`). `[Rubric §14, Testability]` is exactly this: pushing the decidable
logic out of an untestable host so it can be asserted where a test runner exists.

**Host security: platform-appropriate token handling.** The token-storage choices are a compact
study in secret handling matched to the threat model. On the browser heads the high-value *refresh*
token is never exposed to JavaScript: it stays in an HttpOnly cookie and is exchanged through a
same-origin proxy refresher (`MMCA.ADC.UI.Web/Program.cs:77`,
`MMCA.ADC.UI.Web.Client/Program.cs:55`), and the Server head additionally runs a cookie-backed SSR
authentication scheme,
[`SessionCookieAuthenticationHandler`](group-08-auth.md#sessioncookieauthenticationhandler), plus an
SSR validate-or-refresh step ahead of authentication, so `[Authorize]` component routes survive F5
and open-in-new-tab (`MMCA.ADC.UI.Web/Program.cs:69-74,141-144`). On MAUI, which has no DOM and
therefore no XSS surface, the framework's
[`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice) stores both
tokens in OS SecureStorage, the platform secure enclave (Android Keystore, iOS Keychain, Windows
DPAPI). `[Rubric §11, Security]` (at-rest secret handling) and `[Rubric §26, Front-End Security]` (no
token reachable from page JS) are both directly embodied; the deeper design note is
`MMCA.ADC/TokenStorageDesignNote.md`. One deliberate development-only relaxation lives in
`MauiProgram`: a `#if DEBUG` block installs a `SocketsHttpHandler` that bypasses SSL certificate
validation (`MauiProgram.cs:169-196`) so a MAUI device on the LAN can reach the API over the ASP.NET
dev cert. It is scoped to DEBUG, analyzer-suppressed inline with a justification
(`MauiProgram.cs:186,195`), and not a production path; the same comment block records that this
second `AddHttpClient("APIClient")` call only appends a primary-handler factory, so the shared
90-second request budget registered by `AddUIShared` survives the override
(`MauiProgram.cs:180-185`).

**Localization and theming of the shell
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) /
[ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).** All three heads share one
localization stance and each implements its own half of it. The Blazor Server host sets
`CurrentUICulture` from the culture cookie *before* SSR prerender and exposes a culture-switch
endpoint (`MMCA.ADC.UI.Web/Program.cs:127,172`); the WASM client mirrors the same cookie into the
browser thread culture through
[`MmcaCultureBootstrap`](group-15-common-ui-framework.md#mmcaculturebootstrap) before the app runs,
so there is no locale flash or prerender/hydration mismatch
(`MMCA.ADC.UI.Web.Client/Program.cs:88`). On MAUI the same convention flows into composition:
[`DeviceUIModule`](#deviceuimodule) declares its nav item with a resource **key** and a
`TitleResource` type rather than a literal (`MMCA.ADC.UI/DeviceUIModule.cs:21-26`),
[`AppActionsInitializer`](#appactionsinitializer) resolves quick-action titles through an
`IStringLocalizer` before handing them to the OS
(`MMCA.ADC.UI/Services/AppActionsInitializer.cs:34,45-50`), and the handful of strings that must
resolve *before* `Build()` (so before any service provider or `IStringLocalizer` exists) are read by
`MauiProgram` straight from a `ResourceManager` over the co-located `MauiProgram.resx` pair
(`MMCA.ADC.UI/MauiProgram.cs:46-47,212-213`). `[Rubric §27, Internationalization & Localization]`
assesses externalized strings and culture-aware formatting; the rule this codebase follows is
"localize the chrome, exempt the branded and editorial data on purpose, and mark the exemption in
source", which is exactly what the two `ADCHomePageContent` adapters do with the conference brand
name. Theming crosses the same boundary on MAUI: `DeviceUIModule`'s layout list includes the shared
`NativeThemeSync` component so MAUI's own `AppTheme` follows the in-app Blazor theme preference
instead of tracking the OS independently (`DeviceUIModule.cs:28-33`), and `MainPage.xaml` pins the
pre-paint native page background to the light and dark surface colors with an `AppThemeBinding` so
nothing flashes white before the WebView renders (`MMCA.ADC.UI/MainPage.xaml:8,10-15`).

**How it all fits at runtime.** A request to the Blazor Web host renders the shared layout from
[`MMCA.Common.UI`](group-15-common-ui-framework.md); the navbar is composed from each enabled
module's `IUIModule` descriptor, and `/` renders the Conference landing page through
[`ADCHomePageContent`](#adchomepagecontent). After prerender, the interactive Server circuit or the
downloaded WASM runtime takes over; auth state flows through
[`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider)
reading whichever [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) the
host registered, and the WASM client discovers its API endpoint at startup from the Server host's
`/client-config` endpoint instead of having it baked into the static bundle
(`MMCA.ADC.UI.Web/Program.cs:148-167`, `MMCA.ADC.UI.Web.Client/Program.cs:31-37`), with exactly one
retry on a cold start and a loud failure after that (`MMCA.ADC.UI.Web.Client/Program.cs:127-139`)
and a discarded token-hydration warm-up overlapping first render
(`MMCA.ADC.UI.Web.Client/Program.cs:95,104-121`). On MAUI the same component tree runs inside a
`BlazorWebView` with SecureStorage-backed tokens, the framework back-button bridge, App Link and
Universal Link entry, OAuth callback resumption, quick actions, and the home-screen widget, all
funneled into one deep-link dispatcher. In every case the application talks to the backend **only
through the YARP Gateway**: the same boundary that makes the modules independently extractable
([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction,
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
service-extraction topology) also makes the UI host-agnostic. The client points at one origin
(`Api:ApiEndpoint`, pinned in the MAUI head's embedded `MMCA.ADC.UI/appsettings.json:18-20`), and
the Gateway routes to whichever service owns the endpoint. That is the unifying theme of this
chapter: **thin hosts over shared components, talking to one gateway, with every platform difference
pushed behind a Common interface.**

### NowNextSession

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:134` · Level 0 · record (sealed, private)

- **What it is**: a tiny wire-shape record for one session row rendered by the Android home-screen widget: `Title`, an optional `RoomName`, and a `StartsAtLocal` timestamp. It is a private nested type of [NowNextWidgetProvider](#nownextwidgetprovider), declared at the very bottom of that file.
- **Depends on**: only the BCL (`string`, `DateTime`). No first-party types.
- **Concept introduced, the local mirror of a server DTO.** The widget deliberately does not reference the `MMCA.ADC.Conference.Shared` assembly just to deserialize one payload; instead it declares its own record whose property names match the JSON the server sends. The inline comment at `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` states exactly that. `System.Text.Json` populates it by name from the `Events/now-next` response, whose server-side shape is [NowNextDTO](group-17-conference-domain.md#nownextdto) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs`). The coupling is by property name only, which is the price of the decoupling.
- **Walkthrough**: the positional record (`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:134`) is consumed only by `FormatRow` (`:100-107`), which formats `StartsAtLocal` as `HH:mm` under `CultureInfo.InvariantCulture` (`:102`), appends the room in parentheses when it is non-blank (`:103`), and adds a `+N` suffix when more than one session shares the slot (`:104`).
- **Why it's built this way**: keeping the widget's dependency surface to the BCL plus the Android SDK avoids pulling a module-shared contract assembly into a `BroadcastReceiver` that runs in a minimal process. The property-name coupling to the server DTO is the trade-off, documented inline rather than left implicit.
- **Where it's used**: the `Now` and `Next` lists on [NowNextSnapshot](#nownextsnapshot); read by `NowNextWidgetProvider.BuildViews` and `FormatRow`.

### ADCHomePageContent

> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` · Level 1 · class (sealed)
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` · Level 10 · class (sealed)

Two same-named classes, one per head family, both implementing [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) with the identical two-property shape. They are taught together because the shape *is* the lesson; the only difference is which component each one points the shared shell at.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `ADCHomePageContent` (web heads) | `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` | `ComponentType` is the shared Conference.UI landing page itself, reached through the `SharedADCHome` using-alias (`:2`, `:13`). |
| `ADCHomePageContent` (MAUI head) | `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` | `ComponentType` is the head-local `MMCA.ADC.UI.Pages.ADCHome` razor wrapper (`:10`), which renders the same shared component one level down (`MMCA.ADC.UI/Pages/ADCHome.razor:6`). |

- **What it is**: each head's binding of the framework's home-page extension point. It tells the shared `Home.razor` shell which component to render as the landing page and what title to show.
- **Depends on**: [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) (implemented by both, `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:1`, `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:1`) and [ADCHome](group-21-conference-ui.md#adchome) from `MMCA.ADC.Conference.UI`, reached directly on the web side and through the local wrapper on the MAUI side.
- **Concept introduced, app-supplied content for a shared shell.** The framework ships one generic home shell; each host app registers a single `IHomePageContent` that hands the shell a `ComponentType` and a `PageTitle`. The dependency is inverted: the shared shell never references an ADC page. [Rubric §18, UI Architecture] assesses how a reusable shell is specialized per app, and here the entire specialization is two properties. [Rubric §2, Design Patterns] applies as well, since this is a minimal strategy/adapter sitting at a UI boundary.
- **Walkthrough**: both classes are two expression-bodied properties and no state. `ComponentType` selects the landing component (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:13`, `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`); `PageTitle => "Atlanta Developers Conference"` is identical on both (`:15` and `:12` respectively) and carries an explicit `i18n: allow` marker because the conference brand name is deliberately not localized. The web class summary notes that the shared component's default image base path already matches the web head's site-root assets (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:6-10`), so no parameters are passed. The MAUI wrapper exists for the mirror-image reason: its comment records that both heads serve speaker images from their own site root, the MAUI head carrying its copy under `wwwroot/images/speakers`, and that the shared component carries the Web head's countdown fence (the self-ticking `HomeCountdown` child) for both heads, so no base-path override is needed there either (`MMCA.ADC.UI/Pages/ADCHome.razor:1-5`).
- **Why it's built this way**: pointing at the Conference module's component instead of duplicating a landing page means the web and MAUI heads render the same marketing surface, and a change to the conference home lands everywhere at once. The MAUI head keeps its one-line wrapper so head-specific editorial assets stay in ADC rather than migrating into the shared `MMCA.Common.UI` RCL.
- **Where it's used**: registered as a singleton `IHomePageContent` by all three heads: the WebAssembly client (`MMCA.ADC.UI.Web.Client/Program.cs:51`), the Blazor Server host (`MMCA.ADC.UI.Web/Program.cs:63`), and [MauiProgram](#mauiprogram) (`MMCA.ADC.UI/MauiProgram.cs:124`, resolving the `MMCA.ADC.UI.Pages` class imported at `:20`).

### NowNextSnapshot

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:132` · Level 1 · record (sealed, private)

- **What it is**: the deserialized `Events/now-next` payload the widget renders: an `EventName`, an `IsLive` flag, and two lists of [NowNextSession](#nownextsession) (`Now` and `Next`). Like its sibling it is a private nested record on [NowNextWidgetProvider](#nownextwidgetprovider).
- **Depends on**: [NowNextSession](#nownextsession); BCL `List<T>`, `string`, `bool`.
- **Concept introduced**: reuses the **local mirror of a server DTO** idea introduced by [NowNextSession](#nownextsession) (the shared comment at `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` covers both records). No new pattern.
- **Walkthrough**: produced by `FetchSnapshotAsync` via `JsonSerializer.Deserialize<NowNextSnapshot>(json, JsonSerializerOptions.Web)` (`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:126`), which applies the web (camelCase) naming policy so the record's PascalCase members bind to the server's JSON. `BuildViews` (`:67-98`) reads `EventName` into the header text view (`:70`) and takes the first entry of `Now` and `Next`, substituting a localized "nothing scheduled" string for an empty `Now` list and an empty string for an empty `Next` list (`:76-81`).
- **Why it's built this way**: one flat record keeps the deserialize-then-render path allocation-light and independent of the Conference module contracts.
- **Where it's used**: returned by `NowNextWidgetProvider.FetchSnapshotAsync`; consumed by `NowNextWidgetProvider.BuildViews`.
- **Caveats / not-in-source**: `IsLive` is declared on the record (`:132`) and deserialized, but no code path in this file reads it; whether a future render uses it is not determinable from source. Note also that the [NowNextSnapshot](group-22-engagement-module.md#nownextsnapshot) in the Engagement module is an unrelated same-named type, not this one.

### DeviceUIModule

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/DeviceUIModule.cs:19` · Level 3 · class (sealed)

- **What it is**: the MAUI-head-only UI module ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 2). It contributes the Device settings page plus its nav item, and it registers the layout components that turn native device events into in-app behavior. Web heads never register it, so none of its pages or components exist there.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (implements) and [NavItem](group-15-common-ui-framework.md#navitem); the local `AppLockKeyMigration` component from `MMCA.ADC.UI.Components` (`MMCA.ADC.UI/Components/AppLockKeyMigration.razor`), the shared `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener` components from `MMCA.Common.UI.Components.Capabilities`, and `NativeThemeSync` from `MMCA.Common.UI.Maui.Components` (`MMCA.ADC.UI/DeviceUIModule.cs:2-6`); `System.Reflection` and MudBlazor `Icons`.
- **Concept introduced, UI modules as a composition unit.** [IUIModule](group-15-common-ui-framework.md#iuimodule) lets each module contribute nav items, layout components, and its own assembly to the shared router. The shared router's `AppAssembly` is `MMCA.Common.UI`, so a module's `Assembly` (`MMCA.ADC.UI/DeviceUIModule.cs:35`) has to reach `AdditionalAssemblies` before its `[Route]` pages resolve at all (class summary, `:11-18`). `NavItems` (`:23-26`) exposes one Device settings entry whose title is a resource **key** (`"Nav.DeviceSettings"`) rather than display text, resolved at render time by the shared `NavMenu` against the co-located `DeviceUIModule.resx` pair via the `typeof(DeviceUIModule)` resource marker ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), comment at `:21-22`; the resx pair is `MMCA.ADC.UI/DeviceUIModule.resx` and `MMCA.ADC.UI/DeviceUIModule.es.resx`). [Rubric §18, UI Architecture] assesses how features compose into a shell: this is the extension point that lets a device-only capability slot into a shared Blazor UI without the web heads knowing it exists. [Rubric §27, i18n] is touched by deferring the nav title to a resource lookup instead of hardcoding English.
- **Walkthrough**: three get-only auto-properties are the entire surface. `NavItems` (`MMCA.ADC.UI/DeviceUIModule.cs:23`) holds the single nav entry pointing at `/settings/device` with the `AppSettingsAlt` icon (`:25`). `LayoutComponentTypes` (`:33`) lists five components the shared layout renders once each, in a deliberate order: `AppLockKeyMigration` first so the E7 preference-key rename lands before `BiometricGate` performs its first read of [DevicePreferenceKeys](group-26-device-capability-layer.md#devicepreferencekeys)`.AppLockEnabled` (comment at `:28-30`), then `DeepLinkListener`, `BiometricGate`, `PushRegistrationListener`, and finally `NativeThemeSync`, which per the same comment drives MAUI's own `AppTheme` from the Blazor theme preference so the native chrome stops tracking the OS independently of the in-app toggle ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html), `:30-32`). `Assembly` (`:35`) returns this project's assembly. There is no constructor logic: the module is a declarative manifest.
- **Why it's built this way**: registering device concerns through the same [IUIModule](group-15-common-ui-framework.md#iuimodule) contract the business modules use keeps the MAUI head from special-casing composition, and the ordered `LayoutComponentTypes` encodes real initialization dependencies (the key migration before the gate, the theme bridge alongside them) rather than an arbitrary list.
- **Where it's used**: registered as a singleton `IUIModule` in [MauiProgram](#mauiprogram) (`MMCA.ADC.UI/MauiProgram.cs:159`); its components render inside the shared `MMCA.Common.UI` layout.

### MainPage

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/MainPage.xaml.cs:12` · Level 3 · class (partial)

- **What it is**: the single MAUI content page that hosts the `BlazorWebView` control declared in the paired XAML. It is a six-line class body: it derives from the framework's [MainPageBase](group-26-device-capability-layer.md#mainpagebase) and hands it the WebView instance to work with.
- **Depends on**: [MainPageBase](group-26-device-capability-layer.md#mainpagebase) from `MMCA.Common.UI.Maui` (base class, `MMCA.ADC.UI/MainPage.xaml.cs:2,12`) and `Microsoft.AspNetCore.Components.WebView.Maui.BlazorWebView` (`:1,17`).
- **Concept introduced, bridging a native gesture into Blazor navigation.** In a Blazor Hybrid host the OS back button is a native event, but the user's mental model of "back" is a route change inside the WebView. The class summary records the contract (`MMCA.ADC.UI/MainPage.xaml.cs:6-11`): the platform back-button gesture (Android hardware back, iOS swipe) is handled by [MainPageBase](group-26-device-capability-layer.md#mainpagebase), which forwards it to the WebView's internal history stack and exits the app only when the WebView has nowhere left to go. [Rubric §25, Navigation & IA] assesses whether the app presents one coherent navigation model: a single back affordance drives in-app history instead of dumping the user out of the app. [Rubric §15, Best Practices & Code Quality] applies to the shape of this file: the back-navigation mechanism lives once in the shared framework package and every app head contributes only its WebView reference.
- **Walkthrough**: two members. The constructor (`MMCA.ADC.UI/MainPage.xaml.cs:14`) is an expression body calling `InitializeComponent()`. `HostWebView` (`:17`) is the one member the base requires an override for, returning the `blazorWebView` field generated from the paired XAML. That is the entire class: no event handlers, no interop, no lifecycle overrides.
- **Why it's built this way**: the back-gesture handling was hoisted into `MMCA.Common.UI.Maui` so both the framework's own hybrid heads and this app share one implementation. Reducing the app-side page to a `HostWebView` property makes the extension point obvious and leaves nothing here to drift.
- **Where it's used**: constructed by [App](#app) as the content of the single window (`MMCA.ADC.UI/App.xaml.cs:11`); it is the visual root on every platform head.
- **Caveats / not-in-source**: the `blazorWebView` field returned at `MMCA.ADC.UI/MainPage.xaml.cs:17` is generated from the paired `MainPage.xaml`, which is not part of this file; the back-navigation logic itself lives in [MainPageBase](group-26-device-capability-layer.md#mainpagebase) and is taught in [Group 26](group-26-device-capability-layer.md).

### App

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/App.xaml.cs:7` · Level 4 · class (partial)

- **What it is**: the cross-platform MAUI `Application` root. It creates the single window that hosts [MainPage](#mainpage), and therefore the Blazor WebView. (The Windows head has its own separate `App` class deriving from `MauiWinUIApplication` at `MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8`, which forwards to `MauiProgram.CreateMauiApp()` at `:16`.)
- **Depends on**: [MainPage](#mainpage); MAUI's `Application`, `Window`, and `IActivationState`.
- **Concept introduced, the MAUI application object.** One `App` per process owns the window graph. Here `CreateWindow` (`MMCA.ADC.UI/App.xaml.cs:11`) returns a single `Window` wrapping a fresh `MainPage`, titled `"MMCA.ADC.UI"`. Contrast this with the per-platform entry points ([AppDelegate](#appdelegate), [MainApplication](#mainapplication), [Program](#program)), which boot the framework and then defer to this shared class.
- **Walkthrough**: two members only. The constructor (`MMCA.ADC.UI/App.xaml.cs:9`) calls `InitializeComponent()` from the XAML-generated partial, and `CreateWindow(IActivationState?)` (`:11`) is the sole override. There are no lifecycle hooks and no DI wiring; that all lives in [MauiProgram](#mauiprogram).
- **Why it's built this way**: keeping `App` to a single-window factory concentrates composition in `MauiProgram` and navigation in `MainPage`, so the application root stays trivial and platform-agnostic.
- **Where it's used**: named as the app type in `builder.UseMauiApp<App>()` (`MMCA.ADC.UI/MauiProgram.cs:57`); the MAUI framework instantiates it after each platform head calls `CreateMauiApp()`.

### AppActionRouteMap

> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC.UI/Services/AppActionRouteMap.cs:22` · Level 6 · class (internal, static)

- **What it is**: the pure lookup from a home-screen quick-action id (the long-press app-icon shortcuts, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 2) to the app-relative route that activation should navigate to. It holds the three action-id constants, one literal route, and a single `RouteFor` switch.
- **Depends on**: [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) and [NotificationRoutePaths](group-15-common-ui-framework.md#notificationroutepaths) for the route constants (`MMCA.ADC.UI/Services/AppActionRouteMap.cs:1-2`). Nothing else: no BCL beyond `string`, and pointedly no `Microsoft.Maui.*` type at all.
- **Concept introduced, extracting the testable core out of a platform-bound file.** The MAUI head multi-targets the platform TFMs and has no test project in this workspace (`MMCA.Common`'s own `UI.Maui` package sets the same precedent). Rather than leave the id-to-route decision untested inside a MAUI-only class, the decision is isolated into a type that references **no** MAUI API, so it compiles under a plain `net10.0` target and can be pulled into an existing test project as a linked compile item. That is exactly what happens: `MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/MMCA.ADC.Engagement.UI.Tests.csproj:28` declares `<Compile Include="...\AppActionRouteMap.cs" Link="Linked\AppActionRouteMap.cs" />`, and `MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Services/AppActionRouteMapTests.cs:20` asserts every branch including the unknown-id and blank-id cases (`:44`, `:52`). [Rubric §14, Testability] assesses whether logic is reachable by a test without its hosting infrastructure: this file is the textbook move, an untestable TFM forced a boundary and the boundary turned out to be the right design anyway. [Rubric §1, SOLID] applies through the single responsibility, mapping and nothing else. [Rubric §25, Navigation & IA] applies because these three ids are OS-level jump points into deep in-app routes.
- **Walkthrough**
  - The three id constants (`MMCA.ADC.UI/Services/AppActionRouteMap.cs:25`, `:28`, `:31`) are `happening_now`, `my_schedule`, and `notifications`, the ids the platform reports back on activation.
  - `MyScheduleRoute` (`:38`) is `"/conference/sessions?mine=true"`, a literal rather than a `ConferenceRoutePaths` constant. The doc comment (`:33-37`) explains why: it is the session-list route carrying a filter, not a route of its own.
  - `RouteFor(string? actionId)` (`:49-63`) returns `null` for a null, empty, or whitespace id (`:51-54`), then switches to [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths)`.HappeningNow` (which resolves to `/happening-now`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/EngagementRoutePaths.cs:11`), `MyScheduleRoute`, or [NotificationRoutePaths](group-15-common-ui-framework.md#notificationroutepaths)`.NotificationInbox` (`/notifications/inbox`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NotificationRoutePaths.cs:12`), with `_ => null` for anything unrecognized (`:56-62`). The parameter is nullable and whitespace-tolerant on purpose: the value crosses a platform boundary, so it is never assumed to be well formed (`:44-47`).
- **Why it's built this way**: the file-level comment (`:9-20`) states the contract for future edits directly: keep every MAUI dependency (`AppActions.Current`, the localized titles, the dispatcher lookup) on the caller side in [AppActionsInitializer](#appactionsinitializer) and [MauiProgram](#mauiprogram) so this file stays linkable. It even explains why those two callers are named in prose instead of by `cref`: this file also compiles inside the test project, where the MAUI-bound types are absent and a `cref` would not resolve.
- **Where it's used**: called by `MauiProgram.HandleAppAction` on activation (`MMCA.ADC.UI/MauiProgram.cs:217`), and its id constants are re-exported by [AppActionsInitializer](#appactionsinitializer) (`MMCA.ADC.UI/Services/AppActionsInitializer.cs:20-22`) so the registration side and the activation side cannot drift apart.

### AppActionsInitializer

> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC.UI/Services/AppActionsInitializer.cs:18` · Level 7 · class (sealed)

- **What it is**: a MAUI startup service that publishes the three home-screen quick actions once the app is built, with titles resolved from the co-located resx pair. It is the *registration* half of the quick-action feature; the *activation* half lives in [MauiProgram](#mauiprogram), and the id-to-route decision both halves depend on lives in [AppActionRouteMap](#appactionroutemap).
- **Depends on**: `IMauiInitializeService` (the MAUI hosting contract it implements, `MMCA.ADC.UI/Services/AppActionsInitializer.cs:18`), `IStringLocalizer<AppActionsInitializer>` (`:1`, `:34`), MAUI Essentials' `AppActions`/`AppAction`/`FeatureNotSupportedException`, [AppActionRouteMap](#appactionroutemap) for the ids (`:20-22`), and [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) indirectly, as the destination the resolved routes are published into (`:2`, class summary at `:8-11`).
- **Concept introduced, native quick actions as a navigation entry point.** [Rubric §25, Navigation & IA] assesses whether an app exposes coherent first-class entry points: the three shortcuts are OS-level jump points into deep routes, reachable without opening the app first. [Rubric §27, i18n] applies because the shortcut labels are resolved from `MMCA.ADC.UI/Services/AppActionsInitializer.resx` (and its `.es.resx` sibling) through the injected localizer at registration time (`:47-49`), so they follow the selected language rather than shipping as English literals. [Rubric §29, Resilience & Business Continuity] is touched lightly: every failure mode here degrades to "no shortcuts appear" rather than to a broken launch.
- **Walkthrough**
  - The three `internal const` ids (`MMCA.ADC.UI/Services/AppActionsInitializer.cs:20-22`) are aliases of the [AppActionRouteMap](#appactionroutemap) constants, not independent literals, so registration and routing cannot fall out of sync.
  - `Initialize(IServiceProvider services)` (`:25-39`): null-guards the provider (`:27`), returns immediately when `AppActions.Current.IsSupported` is false (`:29-32`), resolves the localizer (`:34`), then starts `SetActionsAsync` **fire-and-forget** with a discard (`:38`) so a slow or failing shortcut registration can never block or fail app startup. The inline comment states that intent at `:36-37`.
  - `SetActionsAsync(IStringLocalizer<AppActionsInitializer>)` (`:41-58`): builds the three `AppAction`s with localized titles and the `appicon` icon (`:45-50`), awaits `AppActions.Current.SetAsync` (`:51`), and catches `FeatureNotSupportedException` (`:53-57`) because some launchers report support and then reject the call at runtime, in which case the shortcuts simply do not appear.
- **Why it's built this way**: registration and activation are deliberately split. This initializer sets the shortcuts and their titles; [MauiProgram](#mauiprogram) wires `ConfigureEssentials(essentials => essentials.OnAppAction(HandleAppAction))` (`MMCA.ADC.UI/MauiProgram.cs:65`) to the activation path. Both ends resolve the same route table and publish into the [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) deep-link dispatcher, which buffers a cold-start activation until the shared `DeepLinkListener` renders (class summary, `MMCA.ADC.UI/Services/AppActionsInitializer.cs:8-11`). The class summary also records why the mapping was moved out (`:12-16`): what remains here is only the part that genuinely needs the platform.
- **Where it's used**: registered as a singleton `IMauiInitializeService` in [MauiProgram](#mauiprogram) (`MMCA.ADC.UI/MauiProgram.cs:160`), which is what makes MAUI run `Initialize` during `Build()`.
- **Caveats / not-in-source**: whether a given launcher actually surfaces the shortcuts is runtime platform behavior, not determinable from source; the code only handles the explicit rejection case.

### MainActivity

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/MainActivity.cs:35` · Level 9 · class

- **What it is**: the Android launcher activity for the MAUI host. It does three jobs: declare which configuration changes it handles in-process (so Android does not restart the activity and tear down the Blazor WebView), receive verified https App Links ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)) and publish their route to the shared deep-link dispatcher, and forward the MAUI app-action intent to Essentials so quick-action taps actually raise `OnAppAction`.
- **Depends on**: [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (resolved from `IPlatformApplication.Current.Services`, `MMCA.ADC.UI/Platforms/Android/MainActivity.cs:4`, `:79`), MAUI's `MauiAppCompatActivity` and the `Microsoft.Maui.ApplicationModel.Platform` Essentials helper aliased as `EssentialsPlatform` (`:5`), and the Android intent/activity SDK.
- **Concept introduced, `ConfigurationChanges` and WebView preservation.** By default Android destroys and recreates an activity on orientation, theme, or density changes; for a `BlazorWebView` that destruction tears down the hosted component tree and loses UI state. The `[Activity(... ConfigurationChanges = ScreenSize | Orientation | UiMode | ScreenLayout | SmallestScreenSize | Density)]` attribute (`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:21-25`) tells Android the activity handles those events itself, so no recreation happens. The second concept is **verified App Links**: the first `[IntentFilter]` (`:26-31`) claims `https` URLs on `PublicWebHost` with `AutoVerify = true`, which only takes effect if a live `assetlinks.json` carrying the Play App Signing fingerprint is served from that host (class summary, `:17-19`). The third is the **app-action intent filter** (`:32-34`) paired with the `OnResume`/`OnNewIntent` forwarding: without both, a launcher shortcut tap resolves to nothing (`:14-17`). [Rubric §25, Navigation & IA] applies because deep links and shortcuts both land the user on the right in-app route; [Rubric §22, Responsive/Cross-Browser] applies because the config-change handling is what keeps the single WebView UI stable across rotations and theme switches.
- **Walkthrough**: `PublicWebHost` (`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:39`) is a compile-time constant naming the production UI container-app host, and it must match `PublicSite:BaseUrl` in the embedded `appsettings.json` (`MMCA.ADC.UI/appsettings.json:21-22`), so a custom-domain cutover touches only those two spots (comment at `:37-38`). `OnCreate` (`:42-46`) calls `PublishDeepLink(Intent)` after the base call, covering cold start. `OnResume` (`:49-55`) calls `EssentialsPlatform.OnResume(this)` so Essentials can process a pending app-action intent on a cold-start shortcut launch (`:53`). `OnNewIntent` (`:58-63`) forwards to `EssentialsPlatform.OnNewIntent(intent)` and then publishes any deep link, covering warm re-entry. `PublishDeepLink` (`:65-80`) ignores anything that is not an `ActionView` intent carrying data (`:67-70`), ignores a blank path (`:72-76`), reassembles `path` plus optional `?query` (`:78`), and publishes the route through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:79`), which buffers one route across a cold start until the shared `DeepLinkListener` drains it.
- **Why it's built this way**: the config-changes list is not boilerplate; dropping any entry silently reintroduces an activity restart that only shows up on a physical device rotation or theme switch. Routing both intent callbacks through one helper keeps cold-start and warm-start deep links behaviorally identical, and the Essentials forwarding is required plumbing rather than a choice.
- **Where it's used**: the Android launcher (`MainLauncher = true`, `MMCA.ADC.UI/Platforms/Android/MainActivity.cs:23`); it is also the explicit target of the widget's tap `PendingIntent` in [NowNextWidgetProvider](#nownextwidgetprovider) (`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:89`).
- **Caveats / not-in-source**: whether Android has actually verified the App Link association depends on the live `assetlinks.json` on the production host, which is an operational fact outside this repo (the class summary points at `Docs/MobileReleaseRunbook.md`, `:18-19`).

### WebAuthenticatorCallbackActivity

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` · Level 9 · class

- **What it is**: the Android activity that catches the custom-scheme OAuth completion redirect and hands control back to MAUI's `WebAuthenticator`. After the Identity service's `CompleteAsync` finishes a social login it redirects the system browser to `atldevcon://oauth-complete?code=...`, Android routes that URI here, and the base class resumes the pending `AuthenticateAsync` with the captured parameters ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html), documented at `MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:7-13`).
- **Depends on**: `Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity` (base class, `:19`) and the Android SDK activity/intent attributes (`:1-3`). No first-party types.
- **Concept introduced, custom-scheme OAuth return on mobile.** Unlike the web heads, which get an ordinary HTTP redirect back to an origin the browser already trusts, a native app receives the OAuth result through a registered URI scheme. The `[IntentFilter]` (`:15-18`) declares the app as a handler for `ActionView` intents whose `DataScheme` is the `CallbackScheme` constant, with the `Default` and `Browsable` categories so a browser can launch it. `NoHistory = true` and `LaunchMode.SingleTop` (`:14`) keep the callback out of the back stack and reuse the existing task instead of stacking a second one. [Rubric §26, Front-End Security] assesses how client auth flows avoid token leakage: the scheme is an allowlisted return target and the class body holds nothing but a constant, so there is no place here for a code or token to be logged or mishandled. [Rubric §11, Security] applies to the same allowlist coupling on the server side.
- **Walkthrough**: the class is behavior-free by design (`:19-22`): the whole contract lives in the attributes, and `CallbackScheme = "atldevcon"` (`:21`) must stay in lockstep with `OAuth:MobileRedirectScheme` in the embedded `appsettings.json` (`MMCA.ADC.UI/appsettings.json:43`, which is `"atldevcon"`) and with the Identity service's `OAuth:AllowedReturnUrlSchemes` allowlist (class summary, `:11-12`).
- **Why it's built this way**: subclassing the MAUI base activity is the framework-sanctioned way to receive the redirect; all the app supplies is the scheme and the intent-filter metadata. Keeping the scheme constant next to the filter makes the three-place coupling (app attribute, app config, Identity allowlist) easy to keep aligned during a cutover.
- **Where it's used**: invoked by the Android OS during the OAuth flow enabled by the [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) registration in [MauiProgram](#mauiprogram) (`MMCA.ADC.UI/MauiProgram.cs:99`); it is never called from managed code.

### NowNextWidgetProvider

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:22` · Level 10 · class (sealed)

- **What it is**: the Android home-screen `AppWidgetProvider` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8) that renders a "Now / Next" card. On each update it fetches the anonymous, cached `GET Events/now-next` snapshot (the id-less form, where the server picks the live-or-next published event) and renders one "Now" and one "Next" line. It never throws: a failed fetch leaves the previous `RemoteViews` in place (class summary, `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:11-18`). The endpoint it calls is `[AllowAnonymous]` and output-cached under the `NowNextCache` policy (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventsController.cs:186-188`).
- **Depends on**: [NowNextSnapshot](#nownextsnapshot) and [NowNextSession](#nownextsession) (its private records), [MainActivity](#mainactivity) (the tap target, `:88`), `IConfiguration` resolved from `IPlatformApplication.Current.Services` (`:112`), `System.Net.Http.HttpClient`, `System.Text.Json`, and the Android widget SDK.
- **Concept introduced, best-effort background rendering under a platform time budget.** `OnUpdate` (`:24-35`) must return fast, so after null-guarding its three arguments (`:26-29`) it calls `GoAsync()` (`:33`) to keep the broadcast alive while the snapshot downloads, then starts `UpdateWidgetsAsync` without awaiting it (`:34`); the comment at `:31-32` records that the platform budget is roughly 10s, far above one cached GET. `UpdateWidgetsAsync` (`:37-66`) wraps the whole flow in a `try`/`catch` that swallows every exception, with the `CA1031` suppression justified inline (`:56-58`: a widget update is best-effort and the last rendering stays), and always calls `pendingResult?.Finish()` in `finally` (`:62-65`). [Rubric §29, Resilience & Business Continuity] assesses graceful degradation: a network or parse failure degrades to the stale card rather than to a visible error. [Rubric §23, Front-End Performance] is engaged by leaning on the server's output cache and a short client timeout instead of any local polling loop.
- **Walkthrough**: `BuildViews` (`:67-98`) inflates the `nownext_widget` layout (`:69`), sets the event-name text (`:70`), reads three localized strings from Android resources (`:72-74`), and fills the Now/Next lines through `FormatRow`, showing the "nothing scheduled" string when `Now` is empty and an empty string when `Next` is empty (`:76-81`). It then builds an **explicit** tap intent targeting [MainActivity](#mainactivity) with `ActionView` and the app-internal `https://app.internal/happening-now` URI (`:86-91`); the `S1075` hardcoded-URI suppression is justified because this is an app-internal route rather than an external address, and only the URI *path* is consumed by the deep-link publisher, which makes the host part a placeholder (`:83-85`). The `PendingIntent` is created `UpdateCurrent | Immutable` (`:92-93`) and attached to the widget root (`:94`). `FormatRow` (`:100-107`) does the invariant `HH:mm` formatting described under [NowNextSession](#nownextsession). `FetchSnapshotAsync` (`:109-127`) reads `Api:ApiEndpoint` from configuration (`:112`, whose value is the gateway base URL at `MMCA.ADC.UI/appsettings.json:19`), returns `null` when it is missing (`:113-116`), builds a short-lived `HttpClient` with an 8s timeout (`:118`), GETs the relative `Events/now-next` (`:119`), returns `null` on a non-success status (`:120-123`), and otherwise deserializes with `JsonSerializerOptions.Web` (`:126`).
- **Why it's built this way**: a widget runs in a minimal broadcast process where an unhandled exception is user-visible as a broken card, so every path is null-guarded and every failure returns quietly to preserve the prior render. The `GoAsync`/`Finish` pairing is the Android-sanctioned way to do async work from a receiver without triggering an ANR.
- **Where it's used**: registered through `[BroadcastReceiver]`, `[IntentFilter]`, and `[MetaData]` (`:19-21`) and driven by the Android `AppWidgetManager`; its tap routes into [MainActivity](#mainactivity)'s deep-link path.
- **Caveats / not-in-source**: the widget layout and string ids (`Resource.Layout.nownext_widget`, `Resource.Id.*`, `Resource.String.*`) resolve against generated Android resources declared under `Platforms/Android/Resources`, not in this file. The comment at `:110-111` asserts that [MainApplication](#mainapplication) has already initialized MAUI by the time a receiver runs in this process; the code still bails quietly if configuration turns out to be unresolvable.

### MauiProgram

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/MauiProgram.cs:37` · Level 11 · class (static)

- **What it is**: the composition root for the MAUI Blazor Hybrid app. `CreateMauiApp` builds the DI and configuration graph that runs Blazor components inside a native WebView on Android, iOS, macOS (Catalyst), and Windows: it loads embedded configuration, registers MudBlazor and the shared UI services, conditionally registers each module's UI, opts into push and the camera barcode scanner, and wires the MAUI-specific auth, form-factor, and device-capability services.
- **Depends on**: the shared registrations `AddUIShared`, `UseMauiDeviceCapabilities`, `UseMmcaMauiErrorHandling`, `AddMauiPushDeviceTokenProvider`, `AddCommonMauiPublicLinkBuilder`, `AddCommonMauiTokenStorage`, `AddMauiFormFactor`, and `UseCommonBarcodeScanner`; [UIModuleConfiguration](group-15-common-ui-framework.md#uimoduleconfiguration), [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) with [ConfigurationOAuthUISettings](group-15-common-ui-framework.md#configurationoauthuisettings), [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) with [ADCHomePageContent](#adchomepagecontent), [IUIModule](group-15-common-ui-framework.md#iuimodule) with [DeviceUIModule](#deviceuimodule), [AppActionsInitializer](#appactionsinitializer) and [AppActionRouteMap](#appactionroutemap), [MauiTokenStorageService](group-26-device-capability-layer.md#mauitokenstorageservice), [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) with [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider), [IPublicLinkBuilder](group-15-common-ui-framework.md#ipubliclinkbuilder), [IBarcodeScannerService](group-26-device-capability-layer.md#ibarcodescannerservice), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), and [App](#app); externals MudBlazor, CommunityToolkit.Maui, the `MMCA.Common.UI.Maui` package, the four module UI packages, `System.Resources.ResourceManager`, and `SocketsHttpHandler`.
- **Concept introduced, registration-order-sensitive composition on top of `TryAdd` defaults.** The shared framework registers safe defaults with `TryAdd`, so this host must place each override at the right point in the sequence: a later plain `Add` wins, and a `TryAdd` no-ops once something is already present. This file states the rule once, as a three-clause **ordering contract** at `MMCA.ADC.UI/MauiProgram.cs:78-93`, so the per-call comments below it can stay short. Clause 1: `IOAuthUISettings` goes *before* `AddUIShared`, because `AddUIShared` `TryAdd`-registers `DefaultOAuthUISettings` and a `TryAdd` already satisfied by an earlier plain `Add` is a no-op. Clause 2: everything that *overrides* a shared default goes *after* `AddUIShared`. Clause 3: a module that registers its own default with a plain `Add` must be overridden the same way, which is why `AddCommonMauiPublicLinkBuilder` stays after every module registration. The same comment block records the enforcement gap honestly: no MAUI TFM has a test project in this workspace, so this ordering is verified by review rather than by a fitness test, and anything expressible without a MAUI type belongs outside this file instead, with [AppActionRouteMap](#appactionroutemap) named as the pattern to follow (`:90-93`). [Rubric §18, UI Architecture] assesses how the UI host is composed: one shared component graph parameterized per platform head. [Rubric §22, Responsive/Cross-Browser] applies because the same Blazor code targets four platforms from this single builder. [Rubric §14, Testability] is where this file is weakest by its own admission, and it compensates by exporting logic rather than by pretending otherwise. [Rubric §11, Security] and [Rubric §17, DevOps] both bear on the `#if DEBUG` block below.
- **Walkthrough**
  - Conditional `using` (`MMCA.ADC.UI/MauiProgram.cs:11-16`): `Microsoft.Extensions.Logging` is imported inside `#if DEBUG` because its only consumer is the DEBUG-only `AddDebug()` call; left unconditional it trips IDE0005 in Release, where warnings are errors, which fails the Release publish for Google Play (comment at `:12-14`). A small but load-bearing consequence of the repo-wide `TreatWarningsAsErrors`.
  - `StartupResources` (`:46-47`): a static `ResourceManager` over `MMCA.ADC.UI.MauiProgram`, needed because some startup strings must resolve **before** `Build()`, when no service provider and therefore no `IStringLocalizer` exists yet (doc comment at `:39-45`). It is the same co-located resx convention every other localized string in this head uses (`MMCA.ADC.UI/MauiProgram.resx` and its `.es.resx` sibling), read through the resource manager instead of the localizer.
  - Builder chain (`:55-65`): `UseMauiApp<App>()` (`:57`), `UseMauiCommunityToolkit()` (`:60`, required by the speech-to-text capability, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4, and the toolkit analyzer insists the call sits in the app's own chain, `:58-59`), a font registration (`:61`), and `ConfigureEssentials(essentials => essentials.OnAppAction(HandleAppAction))` for home-screen quick actions (`:62-65`).
  - Configuration (`:67-76`): MAUI does not auto-load config files, so the executing assembly's `MMCA.ADC.UI.appsettings.json` manifest resource stream is read (`:68-69`) and added through `AddJsonStream` (`:73`), guarded by a null check on the stream (`:70`).
  - Core UI services: `AddMauiBlazorWebView()` and `AddMudServices()` (`:94-95`), then the pre-shared `IOAuthUISettings` override (`:99`, whose comment at `:97-98` notes it enables the social login buttons that the [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html) broker then routes through the system browser), `AddUIShared(builder.Configuration)` (`:101`), and `UseMauiDeviceCapabilities()` (`:106`, which also wires `Plugin.LocalNotification` and the notification-tap deep-link bridge).
  - `UseMmcaMauiErrorHandling()` (`:113`) installs last-chance handlers for `AppDomain.UnhandledException` and `TaskScheduler.UnobservedTaskException` so a managed exception nobody caught is logged instead of silently killing the app. Its comment (`:108-112`) flags that, unlike its neighbours, this call is ordering-insensitive: the handlers are installed when the app is *built*, so a logging provider registered after this line is still picked up. [Rubric §13, Observability & Operability] is the category this call serves.
  - `AddMauiPushDeviceTokenProvider()` (`:122`) registers the credentialed push token providers ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): the framework picks FCM on Android and APNs on iOS/MacCatalyst, and its plain `Add` beats the `TryAdd` null default. The comment (`:115-121`) records that the registration is config-gated (with `Push:Fcm` blank and `Push:Apns:Enabled` false, both providers yield null and the pipeline stays inert) and that the platform wiring stays app-side: the `POST_NOTIFICATIONS` declaration in `AndroidManifest.xml` and the two iOS callbacks on [AppDelegate](#appdelegate).
  - `IHomePageContent` landing content (`:124`), then module registration (`:126-137`): four `if` blocks gated on `UIModuleConfiguration.IsModuleEnabled(builder.Configuration, "...")` add the Identity (`:127-128`), Conference (`:130-131`), Engagement (`:133-134`), and Notification (`:136-137`) UI packages.
  - `AddCommonMauiPublicLinkBuilder()` (`:143`) overrides the browser-origin [IPublicLinkBuilder](group-15-common-ui-framework.md#ipubliclinkbuilder) default so shared and copied links carry the public web URL rather than the WebView's internal origin; the framework builder resolves against `PublicSite:BaseUrl` from the embedded appsettings (`:139-142`), the same key that must match [MainActivity](#mainactivity)'s `PublicWebHost`. It stays *after* the module registrations by ordering-contract clause 3.
  - `UseCommonBarcodeScanner(...)` (`:153-155`) enables camera QR scanning for badge check-in, passing **deferred** `cancelText`/`cameraDescription` delegates that call `StartupText`. The comment (`:145-152`) separates the two reasons for its position: it must sit after `AddUIShared` (a real DI requirement, since that is the call which `TryAdd`s the null `IBarcodeScannerService`) but sitting below `AddEngagementUI` is convention rather than a requirement, because Engagement owns the check-in surface but registers no scanner of its own. The same comment explains why the call stays opt-in: it brings in the ZXing handlers, so a head that never scans ships neither the handler nor the camera permission.
  - MAUI-only composition and services: the [DeviceUIModule](#deviceuimodule) singleton (`:159`) and the [AppActionsInitializer](#appactionsinitializer) `IMauiInitializeService` (`:160`); the auth stack of `AddCommonMauiTokenStorage()` (`:163`, the framework helper that binds [MauiTokenStorageService](group-26-device-capability-layer.md#mauitokenstorageservice) to the platform secure store), [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher) (`:164`), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider) (`:165`) and `AddAuthorizationCore()` (`:166`); and `AddMauiFormFactor()` (`:169`).
  - The `#if DEBUG` block (`:171-198`) adds Blazor WebView developer tools (`:172`) and debug logging (`:173`), then appends a `SocketsHttpHandler` primary handler to the `APIClient` whose `RemoteCertificateValidationCallback` always returns true (`:189-196`), so the app can reach the API over LAN using the localhost dev cert. The `S4830`/`CA5359` suppression is scoped to Debug and explained inline (`:175-180`): Android's native SSL layer rejects the dev cert at the Java level, for hostname verification of `localhost` against a LAN IP, before the managed callback would ever fire, so the managed TLS stack is used instead. A second comment (`:182-187`) records that this repeat `AddHttpClient("APIClient")` call only **appends** a primary-handler factory, so the client-configure delegates from `AddUIShared` still run and the 90 second `HttpClient.Timeout` they pin survives; a future edit that replaced rather than added would silently fall back to the BCL's uncoordinated 100 second default.
  - `StartupText(string key, string fallback)` (`:212-213`) reads one string from `StartupResources` under `CultureInfo.CurrentUICulture`, falling back to the supplied literal if the key is ever dropped from the resx. The remarks (`:207-211`) record that since MMCA.Common v1.147.0 the scanner registration takes deferred delegates, so this runs once per scan, after [MauiCultureInitializer](group-26-device-capability-layer.md#mauicultureinitializer) has restored the persisted culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): the scan page follows the in-app language choice, not the device locale at process start.
  - `HandleAppAction(AppAction action)` (`:215-228`) maps the action id to a route via [AppActionRouteMap](#appactionroutemap)`.RouteFor` (`:217`), returns when the id is unknown (`:218-221`), and otherwise publishes the route into [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:225-227`), which buffers it on cold start and dispatches it live otherwise (`:223-224`).
- **Why it's built this way**: the embedded-resource config load is forced by MAUI's lack of on-disk config discovery. The stated ordering contract exists because `TryAdd`-versus-`Add` precedence is invisible at the call site and easy to break silently during a refactor, and because no test can catch a regression on this TFM. The deferred `StartupText` delegates exist because eager evaluation at registration time would freeze the scanner's chrome to whatever culture was current before the persisted language was restored. Scoping the certificate bypass to `#if DEBUG` keeps an intentionally insecure LAN convenience out of every shipped build.
- **Where it's used**: called by every platform head: [MainApplication](#mainapplication) on Android (`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [AppDelegate](#appdelegate) on iOS (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:23`), the MacCatalyst delegate (`MMCA.ADC.UI/Platforms/MacCatalyst/AppDelegate.cs:14`), and the WinUI `App` (`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`). It is the one place all UI DI is assembled for the mobile and desktop shells.
- **Caveats / not-in-source**: which modules are actually enabled depends on the embedded `appsettings.json` values read by `UIModuleConfiguration.IsModuleEnabled`, and whether the push providers activate depends on the `Push:*` values; those runtime values are not determinable from this file.

### AppDelegate

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:20` · Level 12 · class

- **What it is**: the iOS application delegate. It boots MAUI by returning [MauiProgram](#mauiprogram)'s app, receives Universal Links ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)), carries the two APNs registration callbacks ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), and forwards home-screen quick-action taps to Essentials.
- **Depends on**: [MauiProgram](#mauiprogram), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), the framework's `ApnsTokenBridge` from `MMCA.Common.UI.Maui.Capabilities.Notifications` (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:2`), MAUI's `MauiUIApplicationDelegate` and the `Microsoft.Maui.ApplicationModel.Platform` Essentials helper aliased as `EssentialsPlatform` (`:5`), and `Foundation`/`UIKit`.
- **Concept introduced, iOS Universal Links next to Android App Links.** The product concept matches [MainActivity](#mainactivity)'s App Links but the plumbing differs: iOS delivers the tapped web URL as an `NSUserActivity` of type `BrowsingWeb`, and the app must carry the associated-domains entitlement plus a live `apple-app-site-association` file on that host (class summary, `:11-15`). A second concept lands here too, **the fixed-selector native callback**: `RegisteredForRemoteNotifications` and `FailedToRegisterForRemoteNotifications` (`:52-59`) are bound by the Objective-C registrar to *this instance* through their `[Export]` selectors, so they cannot be static and their signatures are dictated by UIKit, which is why the `CA1822` "make static" analyzer is suppressed around exactly those two members (`:50`, `:60`). [Rubric §25, Navigation & IA] applies because deep links resolve to in-app routes on iOS exactly as on Android, through the same dispatcher. [Rubric §3, Clean Architecture] applies to the push split: only these two platform hooks stay app-side, and everything downstream of them lives in the framework (`:46-49`).
- **Walkthrough**: `CreateMauiApp` (`:23`) delegates to `MauiProgram.CreateMauiApp()`. `ContinueUserActivity` (`:26-44`) checks for a `BrowsingWeb` activity with a non-null `WebPageUrl` (`:31-32`), reassembles `path` plus optional `?query` (`:35`), and when the result is non-blank publishes it through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) and returns `true` (`:36-40`); every other case defers to the base implementation (`:43`). The two APNs hooks publish into the framework's `ApnsTokenBridge`: success hands over the device token as a lowercase hex string (`:53-54`), failure publishes `null` (`:57-59`) so the framework's `ApnsPushDeviceTokenProvider`, which awaits that rendezvous, is unblocked rather than left hanging when there is no entitlement or no network. `PerformActionForShortcutItem` (`:63-67`) forwards to `EssentialsPlatform.PerformActionForShortcutItem`; without that override the app opens on a shortcut tap but `OnAppAction` never fires and no navigation happens (`:15-17`). The `[Register("AppDelegate")]` attribute (`:19`) is what makes the type visible to the Objective-C runtime.
- **Why it's built this way**: mirroring the Android deep-link path through one shared dispatcher means the in-app navigation logic is written once in the shared `DeepLinkListener`, and each platform delegate only translates its native event into a route string. The same principle governs push: the delegate publishes a token into a bridge and the framework owns everything after that, so the app-side surface is two one-line methods.
- **Where it's used**: [Program](#program) passes this type to `UIApplication.Main` (`MMCA.ADC.UI/Platforms/iOS/Program.cs:11`). MacCatalyst compiles a separate same-named delegate under `MMCA.ADC.UI/Platforms/MacCatalyst/AppDelegate.cs:12` that forwards `CreateMauiApp` (`:14`) and `PerformActionForShortcutItem` (`:17-21`) but does **not** handle Universal Links or APNs, so those two paths taught here are iOS-only.

### MainApplication

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` · Level 12 · class

- **What it is**: the Android `MauiApplication` subclass, the process-level Android application object that boots MAUI by returning [MauiProgram](#mauiprogram)'s app.
- **Depends on**: [MauiProgram](#mauiprogram); MAUI's `MauiApplication` and the Android runtime interop types `IntPtr` and `JniHandleOwnership` (`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:1-2`).
- **Concept introduced**: reuses the **per-platform bootstrapper** pattern (see [App](#app)), where each platform provides a thin entry that calls the shared `MauiProgram`. No new concept.
- **Walkthrough**: the `[Application]` attribute (`:9`) marks it as the Android application class. The `(IntPtr handle, JniHandleOwnership ownership)` constructor (`:12-15`) is the JNI-marshalling constructor the Android runtime requires and simply forwards to the base. `CreateMauiApp` (`:17`) delegates to `MauiProgram.CreateMauiApp()`.
- **Why it's built this way**: Android instantiates the application object before any activity, so this is the earliest point where MAUI can be created; keeping it a one-line delegate concentrates composition in [MauiProgram](#mauiprogram).
- **Where it's used**: the Android runtime instantiates it at process start; it constructs the DI graph that [MainActivity](#mainactivity) and [NowNextWidgetProvider](#nownextwidgetprovider) later resolve services from via `IPlatformApplication.Current`.

### Program

> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC.UI/Platforms/iOS/Program.cs:8` · Level 13 · class (static)

- **What it is**: the iOS native entry point. `Main` launches the UIKit application with [AppDelegate](#appdelegate) as the delegate type.
- **Depends on**: [AppDelegate](#appdelegate); `UIKit.UIApplication` (`MMCA.ADC.UI/Platforms/iOS/Program.cs:1`).
- **Concept introduced, the iOS managed `Main`.** Unlike Android, where the OS instantiates [MainApplication](#mainapplication), iOS starts from a classic `Main`. `UIApplication.Main(args, null, typeof(AppDelegate))` (`:10-11`) hands control to UIKit and names the delegate that will call `CreateMauiApp`. [Rubric §22, Responsive/Cross-Browser] applies loosely: one codebase, one launcher per platform.
- **Walkthrough**: a single static `Main(string[] args)` (`:10-11`) and no other members.
- **Why it's built this way**: the MAUI iOS template requires an explicit `Main` that names the `AppDelegate`; there is nothing app-specific to customize here.
- **Where it's used**: the iOS process entry point; it never runs on the other platform heads. The MacCatalyst head has its own parallel `Program`/`AppDelegate` pair under `MMCA.ADC.UI/Platforms/MacCatalyst/`.

### App
> MMCA.ADC.UI · `MMCA.ADC.UI.WinUI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8` · Level 12 · class (partial)

- **What it is**: the Windows (WinUI 3) entry point of the MAUI head, and a *different* type from the cross-platform [App](#app-1) taught earlier in this chapter. Same simple name, different namespace (`MMCA.ADC.UI.WinUI`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:4`), different base class, and it compiles only into the Windows target framework. Its whole job is to hand control to [MauiProgram](#mauiprogram).
- **Depends on**: [MauiProgram](#mauiprogram); MAUI's `MauiWinUIApplication` base class and the `MauiApp` it returns. Its XAML half lives beside it in `Platforms/Windows/App.xaml`, whose root element is a `maui:MauiWinUIApplication` with `x:Class="MMCA.ADC.UI.WinUI.App"` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml:1-6`), which is what makes the C# half `partial` and supplies `InitializeComponent()`.
- **Concept introduced**: no new pattern. This is the fourth instance of the **per-platform bootstrapper** shape already seen in [MainApplication](#mainapplication) (Android), [AppDelegate](#appdelegate) and [Program](#program) (iOS): every platform head implements whatever its OS demands as an application object, then delegates to the one shared `CreateMauiApp()`. What is worth pausing on here is the **name collision**: `MMCA.ADC.UI.App` is the MAUI `Application` that owns the window graph, while `MMCA.ADC.UI.WinUI.App` is the *Windows App SDK* application object that hosts the MAUI runtime on Windows. Both exist in the same assembly on the Windows build, disambiguated only by namespace. The file carries no `using` directives at all: `MauiProgram` resolves because `MMCA.ADC.UI.WinUI` is nested inside `MMCA.ADC.UI` for name lookup, and the MAUI types resolve through the SDK's implicit global usings (`ImplicitUsings` is `enable` at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MMCA.ADC.UI.csproj:21`). [Rubric §22, Responsive/Cross-Browser] assesses whether one codebase genuinely serves every form factor rather than forking per device; this file is the Windows leg of that claim, with the shared Blazor UI reached through exactly the same builder every other head calls. [Rubric §33, Developer Experience] applies too: the Windows leg is opt-in by machine, so a macOS or Linux contributor never has to install the Windows App SDK to build the MAUI project (see the TFM condition below).
- **Walkthrough**: three lines of authored code, in order.
  - `namespace MMCA.ADC.UI.WinUI;` (`App.xaml.cs:4`), file-scoped and deliberately distinct from the shared `MMCA.ADC.UI` namespace so the two `App` types can coexist.
  - `public partial class App : MauiWinUIApplication` (`:8`). `MauiWinUIApplication` is MAUI's Windows application base, resolved from the `Microsoft.Maui` namespace that the paired XAML imports as `xmlns:maui="using:Microsoft.Maui"` (`App.xaml:5`). It owns the Windows-side application lifecycle and calls back into the `CreateMauiApp()` override below when it needs the MAUI app instance; the internals of that base class live in the MAUI SDK, not in this repository.
  - The constructor `public App() => InitializeComponent();` (`:14`) is an expression body calling the XAML-generated initializer. Its doc comment (`:10-13`) names it precisely: "the first line of authored code executed, and as such is the logical equivalent of `main()` or `WinMain()`". The actual process `Main` is generated by the WinUI XAML build tooling, not written here.
  - `protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();` (`:16`) is the single override and the only application-specific behavior in the file. It returns the fully composed `MauiApp` built at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:53`, which is where `UseMauiApp<App>()` (`MauiProgram.cs:57`) names the *cross-platform* [App](#app-1) as the MAUI application root. So the Windows `App` boots the MAUI runtime, and the MAUI runtime then instantiates the other `App`, which creates the window hosting [MainPage](#mainpage) and the Blazor WebView.
- **Why it's built this way**: the Windows App SDK requires a XAML-declared `Application` subclass as the packaged/unpackaged app object, so this file cannot be avoided; keeping it to a constructor plus a one-line override means the Windows head adds zero divergent composition. Every service registration, configuration read, and module wiring stays in [MauiProgram](#mauiprogram), which is what keeps the [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) capability layer (native overrides on device, fallbacks elsewhere) a single composition point rather than four. The surrounding project settings are what make the Windows leg optional and desktop-shaped: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MMCA.ADC.UI.csproj:8` appends `net10.0-windows10.0.19041.0` to `TargetFrameworks` only under `$([MSBuild]::IsOSPlatform('windows'))`, so on any other OS this file is not compiled at all; `:36` sets `WindowsPackageType` to `None` (unpackaged, plain `.exe` distribution); and `:41-42` pin the supported and minimum Windows platform to `10.0.17763.0`. The two side-car manifests complete the Windows identity: `Platforms/Windows/app.manifest:11-14` declares PerMonitorV2 DPI awareness and long-path awareness, and `Platforms/Windows/Package.appxmanifest` carries the still-templated packaged identity (`:9`, `maui-package-name-placeholder`, publisher `CN=User Name`) with the `runFullTrust` restricted capability (`:43`).
- **Where it's used**: never from managed application code. The WinUI runtime instantiates it as the process application object on the Windows head; it is the Windows counterpart of [MainApplication](#mainapplication) on Android and [AppDelegate](#appdelegate) on iOS. Nothing in the repository references `MMCA.ADC.UI.WinUI` outside the three Windows platform files themselves (`App.xaml.cs:4`, `App.xaml:2,6`, `app.manifest:3`).
- **Caveats / not-in-source**: `InitializeComponent()` and the WinUI-generated `Main` are emitted by the XAML compiler from `App.xaml` at build time and are not present in the repository, so the exact startup sequence between process start and the `App` constructor is not determinable from source. The `Package.appxmanifest` values are the unmodified MAUI template placeholders; because `WindowsPackageType` is `None` (`MMCA.ADC.UI.csproj:36`) that manifest is not the shipping identity for the current unpackaged build, but whether a packaged Windows artifact is ever produced is not determinable from this project file alone.


---
[⬅ ADC Identity Module (Users, Profiles, GDPR Export/Erasure)](group-24-identity-module.md)  •  [Index](00-index.md)  •  [Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters) ➡](group-26-device-capability-layer.md)
