# 25. ADC Application Host, UI Shell & Cross-Module Composition

**What this chapter covers.** Every ADC module described so far, Conference, Engagement, Identity,
Notification, is *consumed* somewhere. This chapter is that somewhere: the **client tier** of ADC,
the code that turns the shared per-module Razor Class Libraries (`MMCA.ADC.{Module}.UI`) and the
framework UI packages ([`MMCA.Common.UI`](group-15-common-ui-framework.md) and its MAUI companion)
into actually running applications, and composes every conference module into one coherent shell.
Two application shapes are built from the same component set: a **Blazor Web** app (Server prerender
plus a WebAssembly client) and a **.NET MAUI Blazor Hybrid** native app for Android, iOS, macOS
(Catalyst), and Windows. The types this group owns are deliberately thin: the two
[`ADCHomePageContent`](#adchomepagecontent) home-content adapters, the MAUI-only services
([`MauiPublicLinkBuilder`](#mauipubliclinkbuilder),
[`AppActionsInitializer`](#appactionsinitializer)), the MAUI-head composition and native entry
surfaces ([`DeviceUIModule`](#deviceuimodule),
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity),
[`NowNextWidgetProvider`](#nownextwidgetprovider) with its local
[`NowNextSnapshot`](#nownextsnapshot)/[`NowNextSession`](#nownextsession) records), and the MAUI
bootstrap chain ([`MauiProgram`](#mauiprogram), [`App`](#app), [`MainPage`](#mainpage), and the
per-OS entry points [`MainActivity`](#mainactivity), [`MainApplication`](#mainapplication),
[`AppDelegate`](#appdelegate), the iOS [`Program`](#program), and the WinUI [`App`](#app)). The
heavy lifting lives below them in the modules, in
[`MMCA.Common.UI`](group-15-common-ui-framework.md), and in the
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
roots side by side (`MMCA.ADC.UI.Web/Program.cs:28-91`, `MMCA.ADC.UI.Web.Client/Program.cs:21-80`,
`MMCA.ADC.UI/MauiProgram.cs:41-109`) and the family resemblance is obvious: the same MudBlazor
registration, the same `AddUIShared(builder.Configuration)`, the same four conditional module
registrations, then a short tail of host-specific adapters. `[Rubric §18, UI Architecture]` assesses
cohesive, composable components and a clean host/shell split; `[Rubric §22, Responsive &
Cross-Browser/Device]` assesses that one UI renders correctly across browsers and devices. Both are
embodied by this single-component-set, multi-host design: adding a platform is "add a host that
references the shared libraries," not "fork the UI." The MAUI head makes the point literally in
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
[`ADCHomePageContent`](#adchomepagecontent) (web `MMCA.ADC.UI.Web/Program.cs:51` and
`MMCA.ADC.UI.Web.Client/Program.cs:49`, MAUI `MMCA.ADC.UI/MauiProgram.cs:78`). **Token storage**:
[`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) abstracts where JWTs
live, and each head picks its implementation in one line:
`AddCommonMauiTokenStorage()` on MAUI (`MMCA.ADC.UI/MauiProgram.cs:103`, backed by the framework's
[`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice)),
`AddCommonServerTokenStorage()` on the Server head (`MMCA.ADC.UI.Web/Program.cs:64`, backed by
[`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice)), and an
explicit [`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice)
registration in the browser client (`MMCA.ADC.UI.Web.Client/Program.cs:52`). The refresher behind
[`ITokenRefresher`](group-15-common-ui-framework.md#itokenrefresher) splits the same way: the two
browser heads use [`SameOriginProxyTokenRefresher`](group-15-common-ui-framework.md#sameoriginproxytokenrefresher)
(`MMCA.ADC.UI.Web/Program.cs:65`, `MMCA.ADC.UI.Web.Client/Program.cs:53`) while MAUI, which has no
same-origin proxy to lean on, uses
[`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher)
(`MMCA.ADC.UI/MauiProgram.cs:104`). **Form factor** is the same story with three registration lines:
`AddCommonWebFormFactor()`, `AddWasmFormFactor()`, and `AddMauiFormFactor()`
(`MMCA.ADC.UI.Web/Program.cs:84`, `MMCA.ADC.UI.Web.Client/Program.cs:80`,
`MMCA.ADC.UI/MauiProgram.cs:109`), all satisfying the same
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
registered either *before* it (to pre-empt the `TryAdd`) or *after* the module registrations (so
"last registration wins"). Both directions appear here and both are annotated in source.
[`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings) is registered **before**
`AddUIShared` on every head so the social-login buttons appear
(`MMCA.ADC.UI/MauiProgram.cs:67-71`, `MMCA.ADC.UI.Web/Program.cs:43-44`,
`MMCA.ADC.UI.Web.Client/Program.cs:42-43`); `UseMauiDeviceCapabilities()` and
`AddBrowserDeviceCapabilities()` run **after** it so their plain `Add` registrations beat the null
defaults (`MMCA.ADC.UI/MauiProgram.cs:73-76`, `MMCA.ADC.UI.Web/Program.cs:46-49`); and
[`MauiPublicLinkBuilder`](#mauipubliclinkbuilder) is registered **after** `AddConferenceUI()` so it
displaces Conference's browser-origin default of
[`IPublicLinkBuilder`](group-21-conference-ui.md#ipubliclinkbuilder)
(`MMCA.ADC.UI/MauiProgram.cs:93-95`). Similarly, the Blazor host registers its dynamic
Content-Security-Policy provider (`AddCommonBlazorCsp()`, backed by
[`BlazorCspPolicyProvider`](group-15-common-ui-framework.md#blazorcsppolicyprovider)) *before*
`AddCommonSecurityHeaders(...)` so it wins over the static default
(`MMCA.ADC.UI.Web/Program.cs:90-91`), feeding the framework's
[`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) over the
[`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider) boundary.

**Which modules are in the build is configuration, not code.** All three heads gate every module UI
behind [`UIModuleConfiguration`](group-15-common-ui-framework.md#uimoduleconfiguration)`.IsModuleEnabled`
(`MMCA.ADC.UI/MauiProgram.cs:81-91`, `MMCA.ADC.UI.Web/Program.cs:70-80`,
`MMCA.ADC.UI.Web.Client/Program.cs:59-69`), so a deployment can ship Conference-only, or Conference
plus Engagement, without touching source. That is the client-side mirror of the server-side module
system in [Group 14](group-14-module-system-composition.md): each enabled module contributes its
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) descriptor, and the shell composes nav
items, routable assemblies, and layout components from whatever is registered. On the web host the
composition is explicit at the end of `Program.cs`: every registered `IUIModule`'s `Assembly` is
concatenated with the three shared UI assemblies, deduplicated, and handed to
`MapRazorComponents<App>().AddAdditionalAssemblies(...)`
(`MMCA.ADC.UI.Web/Program.cs:177-191`). This is the group's cleanest
`[Rubric §16, Maintainability]` and `[Rubric §25, Navigation, Routing & IA]` moment: routes and
navigation are *discovered* from the enabled module set rather than maintained in a central list.

**The landing page and the two content adapters.** The conference landing page itself is **not**
owned by this group: `ADCHome` lives once in Conference's UI library and is documented in
[Group 21](group-21-conference-ui.md#adchome). What this group owns are the two thin adapters that
point the shared `/` route at it. The web adapter returns the shared component directly, aliased at
the using site (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:2,13`). The MAUI adapter returns
a local `ADCHome.razor` wrapper (`MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`) whose entire body is
one element, the shared Conference component rendered with no parameters
(`MMCA.ADC.UI/Pages/ADCHome.razor:6`): both heads now serve the speaker images from their own site
root, so the MAUI head no longer overrides an image base path and carries its copy of the ADC-only
editorial assets under `wwwroot/images/speakers` instead of pushing them into the shared RCL
(`MMCA.ADC.UI/Pages/ADCHome.razor:1-5`). Both adapters return the same page title, "Atlanta
Developers Conference", carrying an explicit `// i18n: allow` comment marking the brand name as a
deliberate localization exemption
(`MMCA.ADC.UI/Pages/ADCHomePageContent.cs:12`,
`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:15`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). That the two adapters
now differ only in *which* type they name is a good measure of how far the write-once story
actually goes.

**The MAUI bootstrap chain ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).**
Every platform entry point does nothing but call [`MauiProgram`](#mauiprogram)`.CreateMauiApp()`:
[`MainApplication`](#mainapplication) on Android
(`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [`AppDelegate`](#appdelegate) plus the iOS
[`Program`](#program) on iOS (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:19`,
`MMCA.ADC.UI/Platforms/iOS/Program.cs:10-11`), and the WinUI [`App`](#app) on Windows
(`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`), while [`MainActivity`](#mainactivity) is the
Android launcher activity (`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:27`). `CreateMauiApp`
(`MMCA.ADC.UI/MauiProgram.cs:39`) builds the entire DI and configuration graph. Because MAUI does
not auto-load `appsettings.json` from disk, it reads it from an **embedded resource**
(`MauiProgram.cs:53-62`), then registers the BlazorWebView and MudBlazor (`MauiProgram.cs:64-65`),
the CommunityToolkit (required by the ADR-042 speech-to-text capability, `MauiProgram.cs:46`), the
shared UI (`MauiProgram.cs:71`), the native device capabilities (`MauiProgram.cs:76`), the home
content (`MauiProgram.cs:78`), the module UIs (`MauiProgram.cs:81-91`), and the MAUI flavors of the
token, refresh, and auth-state services (`MauiProgram.cs:103-105`). The MAUI head also registers its
own composition pieces: [`DeviceUIModule`](#deviceuimodule) as an
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) contributing the Device settings
[`NavItem`](group-15-common-ui-framework.md#navitem) plus five layout components
(`MauiProgram.cs:99`, `MMCA.ADC.UI/DeviceUIModule.cs:23-33`), and
[`AppActionsInitializer`](#appactionsinitializer) as an `IMauiInitializeService` that sets localized
home-screen quick actions after build (`MauiProgram.cs:100`). The cross-platform [`App`](#app)
(`MMCA.ADC.UI/App.xaml.cs:11`) creates the single window hosting [`MainPage`](#mainpage), and
`MainPage` (`MMCA.ADC.UI/MainPage.xaml.cs:12`) is now a two-member class: `InitializeComponent()`
and a `HostWebView` override returning the XAML-declared `BlazorWebView`
(`MMCA.ADC.UI/MainPage.xaml.cs:14-17`). Everything else about the platform back gesture moved up
into the framework base `MainPageBase`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/MainPageBase.cs:20`), which consumes the
gesture, forwards it to the WebView's own history through
[`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge)
(`MainPageBase.cs:69`), and quits only when the WebView reports it is at the root
(`MainPageBase.cs:70-73`). `[Rubric §25, Navigation, Routing & IA]` shows up in that bridge: native
back must map onto in-app navigation, not OS app-switching, or the native experience feels broken.
`MainActivity`'s `ConfigurationChanges` attribute (`MainActivity.cs:16-20`) is the other native
subtlety: it stops Android from destroying the activity (and with it the Blazor render tree and all
component state) on rotation or dark-mode toggle.

**Native entry surfaces all funnel into one dispatcher
([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) /
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).**
Several MAUI-head types exist for one purpose: to bring the platform's native entry points back into
the same in-app navigation the WebView already runs. [`MainActivity`](#mainactivity) declares an
`IntentFilter` for verified Android **App Links** (https URLs on the pinned public web host,
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
(`RouteFor`, `MMCA.ADC.UI/Services/AppActionsInitializer.cs:39-45`) that
`MauiProgram.HandleAppAction` publishes into the same dispatcher (`MauiProgram.cs:143-156`). The
Android home-screen [`NowNextWidgetProvider`](#nownextwidgetprovider) is a self-contained,
best-effort surface: on each update it fetches the anonymous `Events/now-next` snapshot into its
local [`NowNextSnapshot`](#nownextsnapshot) and [`NowNextSession`](#nownextsession) records
(`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:109-134`), renders one "Now" and one "Next"
line, and taps back into `MainActivity`'s deep-link path (`NowNextWidgetProvider.cs:85-96`); it never
throws, keeping the last rendered content on any failure (`NowNextWidgetProvider.cs:57-62`). Sharing
and copying links is the mirror-image problem, and [`MauiPublicLinkBuilder`](#mauipubliclinkbuilder)
solves it by resolving against the pinned `PublicSite:BaseUrl` from the embedded configuration
(`MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:18-32`), so a link copied inside the app opens the
public web app rather than a WebView-internal origin. The web side of that association is served by
the Blazor host, which maps the App Links and Universal Links association documents from
configuration (`MMCA.ADC.UI.Web/Program.cs:159-170`), and the applink components mirror the same
Blazor routes the app uses: identical URLs on web and device, no route translation table.

**Host security: platform-appropriate token handling.** The token-storage choices are a compact
study in **secret handling matched to the threat model**. On the browser heads the high-value
*refresh* token is never exposed to JavaScript: it stays in an HttpOnly cookie and is exchanged
through a same-origin proxy refresher (`MMCA.ADC.UI.Web/Program.cs:65`,
`MMCA.ADC.UI.Web.Client/Program.cs:53`), and the Server head additionally runs a cookie-backed SSR
authentication scheme, [`SessionCookieAuthenticationHandler`](group-08-auth.md#sessioncookieauthenticationhandler),
so `[Authorize]` component routes survive F5 and open-in-new-tab
(`MMCA.ADC.UI.Web/Program.cs:57-63,129`). On MAUI, which has no DOM and therefore no XSS surface,
the framework's [`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice)
stores both tokens in OS **SecureStorage**, the platform secure enclave (Android Keystore, iOS
Keychain, Windows DPAPI), under two fixed key names
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:20-23`).
`[Rubric §11, Security]` (at-rest secret handling) and `[Rubric §26, Front-End Security]` (no token
reachable from page JS) are both directly embodied; the deeper design note is
`MMCA.ADC/TokenStorageDesignNote.md`. One deliberate development-only relaxation lives in
`MauiProgram`: a `#if DEBUG` block installs a `SocketsHttpHandler` that bypasses SSL certificate
validation (`MauiProgram.cs:111-138`) so a MAUI device on the LAN can reach the API over the ASP.NET
dev cert. It is scoped to DEBUG, analyzer-suppressed inline with a justification
(`MauiProgram.cs:128,137`), and not a production path; the same comment block records that this
second `AddHttpClient("APIClient")` call only appends a primary-handler factory, so the shared
90-second request budget registered by `AddUIShared` survives the override (`MauiProgram.cs:122-127`).

**Localization and theming of the shell
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) /
[ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).** All three heads share one
localization stance and each implements its own half of it. The Blazor Server host sets
`CurrentUICulture` from the culture cookie *before* SSR prerender and exposes a culture-switch
endpoint (`MMCA.ADC.UI.Web/Program.cs:115,151`); the WASM client mirrors the same cookie into the
browser thread culture through
[`MmcaCultureBootstrap`](group-15-common-ui-framework.md#mmcaculturebootstrap) before the app runs,
so there is no locale flash or prerender/hydration mismatch
(`MMCA.ADC.UI.Web.Client/Program.cs:86`). On MAUI the same convention flows into composition:
[`DeviceUIModule`](#deviceuimodule) declares its nav item with a resource **key** and a
`TitleResource` type rather than a literal (`MMCA.ADC.UI/DeviceUIModule.cs:21-26`), and
[`AppActionsInitializer`](#appactionsinitializer) resolves quick-action titles through an
`IStringLocalizer` before handing them to the OS
(`MMCA.ADC.UI/Services/AppActionsInitializer.cs:31,51-57`). `[Rubric §27, Internationalization &
Localization]` assesses externalized strings and culture-aware formatting; the rule this codebase
follows is "localize the chrome, exempt the branded and editorial data on purpose, and mark the
exemption in source", which is exactly what the two `ADCHomePageContent` adapters do with the
conference brand name. Theming crosses the same boundary on MAUI: `DeviceUIModule`'s layout list
includes the shared `NativeThemeSync` component so MAUI's own `AppTheme` follows the in-app Blazor
theme preference instead of tracking the OS independently (`DeviceUIModule.cs:28-33`), and
`MainPage.xaml` pins the pre-paint native page background to the light and dark surface colors with
an `AppThemeBinding` so nothing flashes white before the WebView renders
(`MMCA.ADC.UI/MainPage.xaml:8,10-15`).

**How it all fits at runtime.** A request to the Blazor Web host renders the shared layout from
[`MMCA.Common.UI`](group-15-common-ui-framework.md); the navbar is composed from each enabled
module's `IUIModule` descriptor, and `/` renders the Conference landing page through
[`ADCHomePageContent`](#adchomepagecontent). After prerender, the interactive Server circuit or the
downloaded WASM runtime takes over; auth state flows through
[`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider)
reading whichever [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) the
host registered, and the WASM client discovers its API endpoint at startup from the Server host's
`/client-config` endpoint instead of having it baked into the static bundle
(`MMCA.ADC.UI.Web/Program.cs:136-146`, `MMCA.ADC.UI.Web.Client/Program.cs:29-35`), with exactly one
retry on a cold start and a loud failure after that (`MMCA.ADC.UI.Web.Client/Program.cs:94-107`). On
MAUI the same component tree runs inside a `BlazorWebView` with SecureStorage-backed tokens, the
framework back-button bridge, App Link and Universal Link entry, OAuth callback resumption, quick
actions, and the home-screen widget, all funneled into one deep-link dispatcher. In every case the
application talks to the backend **only through the YARP Gateway**: the same boundary that makes the
modules independently extractable
([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction,
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
service-extraction topology) also makes the UI host-agnostic. The client points at one origin
(`Api:ApiEndpoint`, pinned in the MAUI head's embedded `appsettings.json:19`), and the Gateway routes
to whichever service owns the endpoint. That is the unifying theme of this chapter: **thin hosts over
shared components, talking to one gateway, with every platform difference pushed behind a Common
interface.**

### NowNextSession
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:134` · Level 0 · record (sealed, private)

- **What it is**: a tiny wire-shape record for one session row rendered by the Android home-screen widget: `Title`, an optional `RoomName`, and a `StartsAtLocal` timestamp. It is a private nested type of [NowNextWidgetProvider](#nownextwidgetprovider).
- **Depends on**: only the BCL (`string`, `DateTime`). No first-party types.
- **Concept introduced, local mirror of a server DTO.** The widget deliberately does not reference the `Conference.Shared` assembly just to deserialize one payload; instead it declares its own record whose property names match the JSON the server sends (the inline comment at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` says exactly this). `System.Text.Json` populates it by name from the `Events/now-next` response, whose server-side shape is [NowNextDTO](group-17-conference-domain.md#nownextdto).
- **Walkthrough**: the positional record (`NowNextWidgetProvider.cs:134`) is consumed only by `FormatRow` (`NowNextWidgetProvider.cs:101-107`), which formats `StartsAtLocal` as `HH:mm` under `CultureInfo.InvariantCulture` (`:103`), appends the room in parentheses when it is non-blank (`:104`), and adds a `+N` suffix when more than one session shares the slot (`:105`).
- **Why it's built this way**: keeping the widget's dependency surface to the BCL plus the Android SDK avoids pulling a module-shared contract assembly into a `BroadcastReceiver` that runs in a minimal process. The property-name coupling to the server DTO is the trade-off, documented inline.
- **Where it's used**: the `Now` and `Next` lists on [NowNextSnapshot](#nownextsnapshot); read by `NowNextWidgetProvider.BuildViews` and `FormatRow`.

### WebAuthenticatorCallbackActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` · Level 0 · class

- **What it is**: the Android activity that catches the custom-scheme OAuth completion redirect and hands control back to MAUI's `WebAuthenticator`. After the Identity service's `CompleteAsync` finishes a social login it redirects the system browser to `atldevcon://oauth-complete?code=...`; Android routes that URI here, and the base class resumes the pending `AuthenticateAsync` with the captured parameters ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html), documented at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:7-13`).
- **Depends on**: `Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity` (base class) and the Android SDK activity/intent attributes. No first-party types.
- **Concept introduced, custom-scheme OAuth return on mobile.** Unlike the web heads (which get an ordinary HTTP redirect), a native app receives the OAuth result through a registered URI scheme. The `[IntentFilter]` (`WebAuthenticatorCallbackActivity.cs:15-18`) declares the app as a handler for `ActionView` intents whose `DataScheme` is the `CallbackScheme` constant, with the `Default` and `Browsable` categories so a browser can launch it. `NoHistory = true` and `LaunchMode.SingleTop` (`:14`) keep the callback out of the back stack and reuse the existing task. [Rubric §26, Front-End Security] assesses how client auth flows avoid token leakage: the scheme is an allowlisted return target and the class body holds nothing but the constant, so there is no place for a token to be logged or mishandled here.
- **Walkthrough**: the class is behavior-free by design (`WebAuthenticatorCallbackActivity.cs:19-22`): the whole contract lives in the attributes, and `CallbackScheme = "atldevcon"` (`:21`) must stay in lockstep with `OAuth:MobileRedirectScheme` in the embedded `appsettings.json` and the Identity service's `OAuth:AllowedReturnUrlSchemes` allowlist (class summary, `:11-12`).
- **Why it's built this way**: subclassing the MAUI base activity is the framework-sanctioned way to receive the redirect; all the app supplies is the scheme and the intent-filter metadata. Keeping the scheme constant next to the filter makes the three-place coupling (app, config, Identity allowlist) easy to keep aligned during a cutover.
- **Where it's used**: invoked by the Android OS during the OAuth flow enabled by the [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) registration in [MauiProgram](#mauiprogram) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:69`); it is never called from managed code.

### ADCHomePageContent
> MMCA.ADC.UI.Web.Client · `MMCA.ADC.UI.Web.Client.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` · Level 1 · class (sealed)
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` · Level 10 · class (sealed)

Two same-named classes, one per head family, both implementing [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) with the identical two-property shape. They are taught together because the shape is the lesson; the only difference is which component each one points the shell at.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `ADCHomePageContent` (web heads) | `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` | `ComponentType` is the shared Conference.UI landing page itself, imported through the `SharedADCHome` using-alias (`:2`, `:13`). |
| `ADCHomePageContent` (MAUI head) | `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` | `ComponentType` is the head-local `MMCA.ADC.UI.Pages.ADCHome` razor wrapper (`:10`), which renders the same shared component one level down (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor:6`). |

- **What it is**: each head's binding of the framework's home-page extension point. It tells the shared `Home.razor` shell which component to render as the landing page and what title to show.
- **Depends on**: [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) (implemented by both) and [ADCHome](group-21-conference-ui.md#adchome) from `MMCA.ADC.Conference.UI`, reached directly on the web side and through the local wrapper on the MAUI side.
- **Concept introduced, app-supplied content for a shared shell.** The framework ships one generic home shell; each host app registers a single `IHomePageContent` that hands the shell a `ComponentType` and a `PageTitle`. The dependency is inverted, the shared shell never references an ADC page. [Rubric §18, UI Architecture] assesses how a reusable shell is specialized per app: this is the whole specialization, two properties. [Rubric §2, Design Patterns] applies as well, since this is a minimal strategy/adapter at a UI boundary.
- **Walkthrough**: both classes are two expression-bodied properties and no state. `ComponentType` selects the landing component (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:13`, `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`); `PageTitle => "Atlanta Developers Conference"` is identical on both (`:15` and `:12` respectively) and carries an explicit `i18n: allow` marker because the conference brand name is deliberately not localized. The web class summary notes that the shared component's default image base path already matches the web head's site-root assets (`MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:6-9`), so no parameters are passed. The MAUI wrapper exists for the same reason in reverse: its comment records that both heads now serve speaker images from their own site root, the MAUI head carrying its copy under `wwwroot/images/speakers`, so no base-path override is needed either (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor:1-5`).
- **Why it's built this way**: pointing at the Conference module's component instead of duplicating a landing page means the web and MAUI heads render the same marketing surface, and a change to the conference home lands everywhere at once. The MAUI head keeps its one-line wrapper so head-specific editorial assets stay in ADC rather than migrating into the shared `MMCA.Common.UI` RCL.
- **Where it's used**: registered as a singleton `IHomePageContent` by all three heads: the WebAssembly client (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:49`), the Blazor Server host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:51`), and [MauiProgram](#mauiprogram) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:78`, resolving the `MMCA.ADC.UI.Pages` class imported at `:18`).

### AppActionsInitializer
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/AppActionsInitializer.cs:15` · Level 1 · class (sealed)

- **What it is**: a MAUI startup service that publishes the three home-screen quick actions (the long-press app-icon shortcuts) once the app is built, with localized titles, and that owns the lookup mapping an action id back to an in-app route.
- **Depends on**: `IMauiInitializeService` (the MAUI hosting contract it implements), `IStringLocalizer<AppActionsInitializer>`, MAUI Essentials' `AppActions`/`AppAction`/`FeatureNotSupportedException`; route constants from [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) and [NotificationRoutePaths](group-15-common-ui-framework.md#notificationroutepaths); its published routes travel through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher).
- **Concept introduced, native quick actions as a navigation entry point.** [Rubric §25, Navigation & IA] assesses whether the app exposes coherent first-class entry points: the three shortcut ids (`happening_now`, `my_schedule`, `notifications`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/AppActionsInitializer.cs:17-19`) are OS-level jump points into deep routes, not in-app links. [Rubric §27, i18n] applies because the shortcut labels are resolved from the co-located resx pair through the injected localizer at registration time (`:53-55`), so they follow the selected language rather than shipping as English literals.
- **Walkthrough**
  - `Initialize(IServiceProvider services)` (`AppActionsInitializer.cs:22-36`): null-guards the provider (`:24`), returns immediately when `AppActions.Current.IsSupported` is false (`:26-29`), resolves the localizer (`:31`), then starts `SetActionsAsync` **fire-and-forget** with a discard (`:35`) so a slow or failing shortcut registration can never block or fail app startup (the inline comment states this at `:33-34`).
  - `RouteFor(string actionId)` (`AppActionsInitializer.cs:39-45`): an `internal static` switch expression mapping each id to its app-relative route, `EngagementRoutePaths.HappeningNow`, the literal `/conference/sessions?mine=true`, and `NotificationRoutePaths.NotificationInbox`, returning `null` for anything unknown. This is the lookup the activation handler in [MauiProgram](#mauiprogram) calls.
  - `SetActionsAsync(IStringLocalizer<AppActionsInitializer>)` (`AppActionsInitializer.cs:47-64`): builds the three `AppAction`s with localized titles and the `appicon` icon (`:51-56`), awaits `AppActions.Current.SetAsync` (`:57`), and catches `FeatureNotSupportedException` (`:59-63`) because some launchers report support and then reject the call at runtime, in which case the shortcuts simply do not appear.
- **Why it's built this way**: registration and activation are deliberately split. This initializer sets the shortcuts and their titles, while [MauiProgram](#mauiprogram) wires `ConfigureEssentials(... OnAppAction(HandleAppAction))` to `RouteFor`; both ends publish the resolved route into the [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) deep-link dispatcher, which buffers a cold-start activation until the shared `DeepLinkListener` renders (class summary, `AppActionsInitializer.cs:8-14`).
- **Where it's used**: registered as a singleton `IMauiInitializeService` in [MauiProgram](#mauiprogram) (`MauiProgram.cs:100`) so MAUI runs `Initialize` during startup; `RouteFor` is called from `MauiProgram.HandleAppAction` (`MauiProgram.cs:145`).
- **Caveats / not-in-source**: whether a given launcher actually surfaces the shortcuts is a runtime platform behavior, not determinable from source; the code only handles the rejection case.

### MauiPublicLinkBuilder
> MMCA.ADC.UI · `MMCA.ADC.UI.Services` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [IPublicLinkBuilder](group-21-conference-ui.md#ipubliclinkbuilder). It turns a relative path into an absolute URL rooted at the public web app, so a link the user shares or copies from the device points at the public site rather than the WebView's internal origin.
- **Depends on**: [IPublicLinkBuilder](group-21-conference-ui.md#ipubliclinkbuilder) (implements, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:2,13`), `Microsoft.Extensions.Configuration.IConfiguration`, `System.Uri`.
- **Concept introduced, per-head override of a shared UI service.** On a browser head the default builder can resolve against the current origin, but a MAUI WebView's origin is an internal shell address that is meaningless once pasted into a message. This head therefore substitutes a base URL pinned in configuration. [Rubric §25, Navigation & IA] assesses whether links resolve to real destinations, and [Rubric §26, Front-End Security] is touched because the shared link is bound to one configured host instead of whatever origin the WebView happens to report. The override only works because it is registered after the module registrations in [MauiProgram](#mauiprogram) (last plain `Add` wins, class summary at `MauiPublicLinkBuilder.cs:6-12`).
- **Walkthrough**
  - The constructor (`MauiPublicLinkBuilder.cs:18-24`) reads `PublicSite:BaseUrl` from the embedded configuration (`:20`) and **throws `InvalidOperationException` when it is missing or blank** (`:21-22`), a fail-fast that stops a misconfigured build from silently emitting broken share links. The parsed value is stored in the readonly `_baseUrl` field (`:15`) as an absolute `Uri` (`:23`).
  - `BuildAbsolute(string relativePath)` (`MauiPublicLinkBuilder.cs:27-32`) guards against a null or whitespace path with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:29`), then combines the path onto the base via the `Uri(baseUri, relative)` constructor (`:31`).
- **Why it's built this way**: the same `PublicSite:BaseUrl` value also backs the Android App Link host constant in [MainActivity](#mainactivity), so one configuration key defines "the public site" for both outbound share links and inbound deep links.
- **Where it's used**: registered as scoped in [MauiProgram](#mauiprogram) (`MauiProgram.cs:95`), deliberately after `AddConferenceUI()`; consumed by the Conference UI's share and copy-link surfaces in [Group 21](group-21-conference-ui.md).

### NowNextSnapshot
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:132` · Level 1 · record (sealed, private)

- **What it is**: the deserialized `Events/now-next` payload the widget renders: an `EventName`, an `IsLive` flag, and two lists of [NowNextSession](#nownextsession) (`Now` and `Next`). Like its sibling it is a private nested record on [NowNextWidgetProvider](#nownextwidgetprovider).
- **Depends on**: [NowNextSession](#nownextsession); BCL `List<T>`, `string`, `bool`.
- **Concept introduced**: reuses the **local mirror of a server DTO** idea introduced by [NowNextSession](#nownextsession) (the shared comment at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:130-131` covers both records). No new pattern.
- **Walkthrough**: produced by `FetchSnapshotAsync` via `JsonSerializer.Deserialize<NowNextSnapshot>(json, JsonSerializerOptions.Web)` (`NowNextWidgetProvider.cs:127`), which applies the web (camelCase) naming policy so the record's PascalCase members bind to the server's JSON. `BuildViews` (`:69-99`) reads `EventName` into the header text view (`:72`) and takes the first entry of `Now` and `Next`, substituting a localized "nothing scheduled" string for an empty `Now` list and an empty string for an empty `Next` list (`:78-83`).
- **Why it's built this way**: one flat record keeps the deserialize-then-render path allocation-light and independent of the Conference module contracts.
- **Where it's used**: returned by `NowNextWidgetProvider.FetchSnapshotAsync`; consumed by `NowNextWidgetProvider.BuildViews`.
- **Caveats / not-in-source**: `IsLive` is declared on the record and deserialized, but no code path in this file reads it; whether a future render uses it is not determinable from source.

### DeviceUIModule
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:19` · Level 3 · class (sealed)

- **What it is**: the MAUI-head-only UI module ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 2). It contributes the Device settings page plus its nav item, and it registers the layout components that turn native device events into in-app behavior. Web heads never register it, so none of its pages or components exist there.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (implements) and [NavItem](group-15-common-ui-framework.md#navitem); the local `AppLockKeyMigration` component from `MMCA.ADC.UI.Components`, the shared `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener` components from `MMCA.Common.UI.Components.Capabilities`, and `NativeThemeSync` from `MMCA.Common.UI.Maui.Components` (`DeviceUIModule.cs:2-6`); `System.Reflection` and MudBlazor `Icons`.
- **Concept introduced, UI modules as a composition unit.** [IUIModule](group-15-common-ui-framework.md#iuimodule) lets each module contribute nav items, layout components, and its own assembly to the shared router. The shared router's `AppAssembly` is `MMCA.Common.UI`, so a module's `Assembly` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:35`) has to be added to `AdditionalAssemblies` before its `[Route]` pages resolve at all (class summary, `:11-18`). `NavItems` (`:23-26`) exposes one `Device settings` entry whose `Title` is a resource **key** (`"Nav.DeviceSettings"`) rather than display text, resolved at render time by the shared `NavMenu` against the co-located `DeviceUIModule.resx` pair via `TitleResource: typeof(DeviceUIModule)` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), comment at `:21-22`). [Rubric §18, UI Architecture] assesses how features compose into a shell: this is the extension point that lets a device-only capability slot into a shared Blazor UI without the web heads knowing it exists. [Rubric §27, i18n] is touched by deferring the nav title to a resource lookup.
- **Walkthrough**: three get-only auto-properties are the entire surface. `NavItems` (`DeviceUIModule.cs:23`) holds the single nav entry pointing at `/settings/device` with the `AppSettingsAlt` icon (`:25`). `LayoutComponentTypes` (`:33`) lists five components the shared layout renders once each, in a deliberate order: `AppLockKeyMigration` first so the E7 preference-key rename lands before `BiometricGate` performs its first read of [DevicePreferenceKeys](group-26-device-capability-layer.md#devicepreferencekeys)`.AppLockEnabled` (comment at `:28-30`), then `DeepLinkListener`, `BiometricGate`, `PushRegistrationListener`, and finally `NativeThemeSync`, which per the same comment drives MAUI's own `AppTheme` from the Blazor theme preference so the native chrome stops tracking the OS independently of the in-app toggle ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html), `:30-32`). `Assembly` (`:35`) returns this project's assembly. There is no constructor logic: the module is a declarative manifest.
- **Why it's built this way**: registering device concerns through the same [IUIModule](group-15-common-ui-framework.md#iuimodule) contract the business modules use keeps the MAUI head from special-casing composition, and the ordered `LayoutComponentTypes` encodes real initialization dependencies (the key migration before the gate, the theme bridge alongside them) rather than an arbitrary list.
- **Where it's used**: registered as a singleton `IUIModule` in [MauiProgram](#mauiprogram) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:99`); its components render inside the shared `MMCA.Common.UI` layout.

### MainActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:27` · Level 3 · class

- **What it is**: the Android launcher activity for the MAUI host. It does two jobs: declare which configuration changes it handles in-process (so Android does not restart the activity and tear down the Blazor circuit), and receive verified https App Links ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)), publishing their route to the shared deep-link dispatcher for in-app navigation.
- **Depends on**: [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (resolved from `IPlatformApplication.Current.Services`), MAUI's `MauiAppCompatActivity`, and the Android intent/activity SDK.
- **Concept introduced, `ConfigurationChanges` and Blazor circuit preservation.** By default Android destroys and recreates an activity on orientation, theme, or density changes; for a `BlazorWebView` that destruction tears down the whole Blazor circuit and loses component state. The `[Activity(... ConfigurationChanges = ScreenSize | Orientation | UiMode | ScreenLayout | SmallestScreenSize | Density)]` attribute (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:16-20`) tells Android the activity handles those events itself, so no recreation happens. The second concept is **verified App Links**: the `[IntentFilter]` (`:21-26`) claims `https` URLs on `PublicWebHost` with `AutoVerify = true`, which only works if a live `assetlinks.json` carrying the Play App Signing fingerprint is served from that host (class summary, `:12-14`). [Rubric §25, Navigation & IA] applies because deep links land the user on the right in-app route, and [Rubric §22, Responsive/Cross-Browser] applies because the config-change handling is what keeps the single WebView UI stable across rotations and theme switches.
- **Walkthrough**: `PublicWebHost` (`MainActivity.cs:31`) is a compile-time constant (the production UI container-app host name) that must match `PublicSite:BaseUrl` in the embedded `appsettings.json`, so a custom-domain cutover touches only these two places (`:29-30`). `OnCreate` (`:34-38`) and `OnNewIntent` (`:41-45`) both call `PublishDeepLink`, covering cold start and warm re-entry with identical behavior. `PublishDeepLink` (`:47-62`) ignores anything that is not an `ActionView` intent carrying data (`:49-52`), ignores a blank path (`:54-58`), reassembles `path` plus optional `?query` (`:60`), and publishes the route through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:61`), which buffers one route across a cold start until the shared `DeepLinkListener` drains it.
- **Why it's built this way**: the config-changes list is not boilerplate, dropping any entry silently reintroduces an activity restart that only shows up on a physical device rotation or theme switch. Routing both intent callbacks through one helper keeps cold-start and warm-start deep links behaviorally identical.
- **Where it's used**: the Android launcher (`MainLauncher = true`, `MainActivity.cs:18`); it is also the explicit target of the widget's tap `PendingIntent` in [NowNextWidgetProvider](#nownextwidgetprovider) (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:91`).

### MainPage
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:12` · Level 3 · class (partial)

- **What it is**: the single MAUI content page that hosts the `BlazorWebView` control declared in the paired XAML. It is a seven-line class: it derives from the framework's [MainPageBase](group-26-device-capability-layer.md#mainpagebase) and hands it the WebView instance to work with.
- **Depends on**: [MainPageBase](group-26-device-capability-layer.md#mainpagebase) from `MMCA.Common.UI.Maui` (base class, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:2,12`) and `Microsoft.AspNetCore.Components.WebView.Maui.BlazorWebView` (`:1,17`).
- **Concept introduced, bridging a native gesture into Blazor navigation.** In a Blazor Hybrid host the OS back button is a native event, but the user's mental model of "back" is a route change inside the WebView. The class summary records the contract (`MainPage.xaml.cs:6-11`): the platform back-button gesture (Android hardware back, iOS swipe) is handled by [MainPageBase](group-26-device-capability-layer.md#mainpagebase), which forwards it to the WebView's internal history stack and exits the app only when the WebView has nowhere left to go. [Rubric §25, Navigation & IA] assesses whether the app presents one coherent navigation model: a single back affordance drives in-app history instead of dumping the user out. [Rubric §16, Maintainability] applies to the shape of this file: the back-navigation mechanism lives once in the shared framework package and every app head contributes only its WebView reference.
- **Walkthrough**: two members. The constructor (`MainPage.xaml.cs:14`) is an expression body calling `InitializeComponent()`. `HostWebView` (`:17`) is the one abstract member the base requires, returning the `blazorWebView` field generated from the paired XAML. That is the entire class: no event handlers, no interop, no lifecycle overrides.
- **Why it's built this way**: the back-gesture handling was hoisted into `MMCA.Common.UI.Maui` so both the framework's own hybrid heads and this app share one implementation. Reducing the app-side page to a `HostWebView` property makes the extension point obvious and leaves nothing here to drift.
- **Where it's used**: constructed by [App](#app) as the content of the single window (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:11`); it is the visual root on every platform head.
- **Caveats / not-in-source**: the `blazorWebView` field returned at `MainPage.xaml.cs:17` is generated from the paired `MainPage.xaml`, which is not part of this file; the back-navigation logic itself lives in [MainPageBase](group-26-device-capability-layer.md#mainpagebase) and is taught in [Group 26](group-26-device-capability-layer.md).

### App
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:7` · Level 4 · class (partial)

- **What it is**: the cross-platform MAUI `Application` root. It creates the single window that hosts [MainPage](#mainpage), and therefore the Blazor WebView. (The Windows head has its own separate `App` class in `Platforms/Windows`, covered later in this chapter.)
- **Depends on**: [MainPage](#mainpage); MAUI's `Application`, `Window`, and `IActivationState`.
- **Concept introduced, the MAUI application object.** One `App` per process owns the window graph. Here `CreateWindow` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:11`) returns a single `Window` wrapping a fresh `MainPage`, titled `"MMCA.ADC.UI"`. Contrast this with the per-platform entry points ([AppDelegate](#appdelegate), [MainApplication](#mainapplication), [Program](#program)), which boot the framework and then defer to this shared class.
- **Walkthrough**: two members only. The constructor (`App.xaml.cs:9`) calls `InitializeComponent()` from the XAML-generated partial, and `CreateWindow(IActivationState?)` (`:11`) is the sole override. There are no lifecycle hooks and no DI wiring; that all lives in [MauiProgram](#mauiprogram).
- **Why it's built this way**: keeping `App` to a single-window factory concentrates composition in `MauiProgram` and navigation in `MainPage`, so the application root stays trivial and platform-agnostic.
- **Where it's used**: named as the app type in `builder.UseMauiApp<App>()` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:43`); the MAUI framework instantiates it after each platform head calls `CreateMauiApp()`.

### NowNextWidgetProvider
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:22` · Level 4 · class (sealed)

- **What it is**: the Android home-screen `AppWidgetProvider` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8) that renders a "Now / Next" card. On each update it fetches the anonymous, 60s-cached `GET Events/now-next` snapshot (the id-less form, where the server picks the live-or-next published event) and renders one "Now" and one "Next" line. It never throws: a failed fetch leaves the previous `RemoteViews` in place (class summary, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:11-18`).
- **Depends on**: [NowNextSnapshot](#nownextsnapshot) and [NowNextSession](#nownextsession) (its private records), [MainActivity](#mainactivity) (the tap target), `IConfiguration` resolved from `IPlatformApplication.Current.Services`, `System.Net.Http.HttpClient`, `System.Text.Json`, and the Android widget SDK.
- **Concept introduced, best-effort background rendering under a platform time budget.** `OnUpdate` (`NowNextWidgetProvider.cs:24-35`) must return fast, so after null-guarding its three arguments (`:26-29`) it calls `GoAsync()` (`:33`) to keep the broadcast alive while the snapshot downloads, then starts `UpdateWidgetsAsync` without awaiting (`:34`); the comment at `:31-32` records that the platform budget is roughly 10s, far above one cached GET. `UpdateWidgetsAsync` (`:37-67`) wraps the whole flow in a `try`/`catch` that swallows every exception, with the `CA1031` suppression justified inline (`:57-59`, a widget update is best-effort and the last rendering stays), and always calls `pendingResult?.Finish()` in `finally` (`:63-66`). [Rubric §29, Resilience & Business Continuity] assesses graceful degradation: a network or parse failure degrades to the stale card rather than a visible error. [Rubric §23, Front-End Performance] is engaged by leaning on the server's cache and a short client timeout instead of any local polling loop.
- **Walkthrough**: `BuildViews` (`NowNextWidgetProvider.cs:69-99`) inflates the `nownext_widget` layout (`:71`), sets the event-name text (`:72`), reads three localized strings (`:74-76`), and fills the Now/Next lines through `FormatRow`, showing the "nothing scheduled" string when `Now` is empty and an empty string when `Next` is empty (`:78-83`). It then builds an **explicit** tap intent targeting [MainActivity](#mainactivity) with `ActionView` and the app-internal `https://app.internal/happening-now` URI (`:88-93`); the `S1075` suppression is justified because this is an app-internal route rather than an external address, and only the URI path is consumed by the deep-link publisher (`:85-87`). The `PendingIntent` is created `UpdateCurrent | Immutable` (`:94-95`) and attached to the widget root (`:96`). `FormatRow` (`:101-107`) does the invariant `HH:mm` formatting described under [NowNextSession](#nownextsession). `FetchSnapshotAsync` (`:109-128`) reads `Api:ApiEndpoint` from configuration (`:113`), returns `null` when it is missing (`:114-117`), builds a short-lived `HttpClient` with an 8s timeout (`:119`), GETs the relative `Events/now-next` (`:120`), returns `null` on a non-success status (`:121-124`), and otherwise deserializes with `JsonSerializerOptions.Web` (`:127`).
- **Why it's built this way**: a widget runs in a minimal broadcast process where an unhandled exception is user-visible as a broken card, so every path is null-guarded and every failure returns quietly to preserve the prior render. The `GoAsync`/`Finish` pairing is the Android-sanctioned way to do async work from a receiver without triggering an ANR.
- **Where it's used**: registered through `[BroadcastReceiver]`, `[IntentFilter]`, and `[MetaData]` (`NowNextWidgetProvider.cs:19-21`) and driven by the Android `AppWidgetManager`; its tap routes into [MainActivity](#mainactivity)'s deep-link path.
- **Caveats / not-in-source**: the widget layout and string ids (`Resource.Layout.nownext_widget`, `Resource.Id.*`, `Resource.String.*`) resolve against generated Android resources declared in `Platforms/Android/Resources`, not in this file. The comment at `:111-112` asserts that [MainApplication](#mainapplication) has already initialized MAUI by the time a receiver runs in this process; the code still bails quietly if configuration is unresolvable.

### MauiProgram
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:33` · Level 11 · class (static)

- **What it is**: the composition root for the MAUI Blazor Hybrid app. `CreateMauiApp` builds the DI and configuration graph that runs Blazor components inside a native WebView on Android, iOS, MacCatalyst, and Windows: it loads embedded configuration, registers MudBlazor and the shared UI services, conditionally registers each module's UI, and wires the MAUI-specific auth, form-factor, and device-capability services.
- **Depends on**: the shared registrations `AddUIShared` and `UseMauiDeviceCapabilities`, [UIModuleConfiguration](group-15-common-ui-framework.md#uimoduleconfiguration), [IOAuthUISettings](group-15-common-ui-framework.md#ioauthuisettings) with [ConfigurationOAuthUISettings](group-15-common-ui-framework.md#configurationoauthuisettings), [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) with [ADCHomePageContent](#adchomepagecontent), [IUIModule](group-15-common-ui-framework.md#iuimodule) with [DeviceUIModule](#deviceuimodule), [AppActionsInitializer](#appactionsinitializer), [MauiTokenStorageService](group-26-device-capability-layer.md#mauitokenstorageservice) (through the framework's `AddCommonMauiTokenStorage()`), [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) with [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider), [MauiPublicLinkBuilder](#mauipubliclinkbuilder), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), and [App](#app); externals MudBlazor, CommunityToolkit.Maui, the `MMCA.Common.UI.Maui` package, the three module UI packages, and `SocketsHttpHandler`.
- **Concept introduced, registration-order-sensitive composition on top of `TryAdd` defaults.** The shared framework registers safe defaults with `TryAdd`, so this host must place each override at the right point in the sequence, because a later plain `Add` wins and a `TryAdd` no-ops once something is present. Three orderings in this file are deliberate and commented: `IOAuthUISettings` is registered **before** `AddUIShared` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:67-69`) so the shell's `TryAdd` default cannot shadow it; `UseMauiDeviceCapabilities()` runs **after** `AddUIShared` (`:73-76`) so its plain `Add` registrations override the framework's null capability defaults; and [MauiPublicLinkBuilder](#mauipubliclinkbuilder) is registered **after** `AddConferenceUI()` (`:93-95`) so shared links carry the public web URL rather than the WebView origin. [Rubric §18, UI Architecture] assesses how the UI host is composed, one shared component graph parameterized per platform head. [Rubric §22, Responsive/Cross-Browser] applies because the same Blazor code targets four platforms from this single builder. [Rubric §11, Security] and [Rubric §17, DevOps] both bear on the `#if DEBUG` block below.
- **Walkthrough**
  - Conditional `using` (`MauiProgram.cs:9-14`): `Microsoft.Extensions.Logging` is imported inside `#if DEBUG` because its only consumer is the DEBUG-only `AddDebug()` call; left unconditional it trips IDE0005 in Release, where warnings are errors, which fails the Release publish for Google Play (comment at `:10-12`). This is a small but load-bearing consequence of the repo-wide `TreatWarningsAsErrors`.
  - Builder chain (`MauiProgram.cs:41-51`): `UseMauiApp<App>()` (`:43`), `UseMauiCommunityToolkit()` (`:46`, required by the speech-to-text capability, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4, and the toolkit analyzer insists the call sits in the app's own chain, `:44-45`), a font registration (`:47`), and `ConfigureEssentials(essentials => essentials.OnAppAction(HandleAppAction))` for home-screen quick actions (`:48-51`).
  - Configuration (`MauiProgram.cs:53-62`): MAUI does not auto-load config files, so the executing assembly's `MMCA.ADC.UI.appsettings.json` manifest resource stream is read (`:55`) and added through `AddJsonStream` (`:59`), guarded by a null check on the stream (`:56`).
  - Core UI services: `AddMauiBlazorWebView()` and `AddMudServices()` (`:64-65`), then the pre-shared `IOAuthUISettings` override (`:69`), `AddUIShared(builder.Configuration)` (`:71`), `UseMauiDeviceCapabilities()` (`:76`, which also wires `Plugin.LocalNotification` and the notification-tap deep-link bridge), and the `IHomePageContent` landing content (`:78`).
  - Module registration (`MauiProgram.cs:80-91`): four `if` blocks gated on `UIModuleConfiguration.IsModuleEnabled(builder.Configuration, "...")` add the Identity, Conference, Engagement, and Notification UI packages.
  - Head-specific overrides and services: the public-link override (`:95`), the MAUI-only [DeviceUIModule](#deviceuimodule) (`:99`) and [AppActionsInitializer](#appactionsinitializer) (`:100`), the auth stack of `AddCommonMauiTokenStorage()` (`:103`, the framework helper that binds [MauiTokenStorageService](group-26-device-capability-layer.md#mauitokenstorageservice) to the platform secure store), [DirectApiTokenRefresher](group-15-common-ui-framework.md#directapitokenrefresher) (`:104`), [JwtAuthenticationStateProvider](group-15-common-ui-framework.md#jwtauthenticationstateprovider) (`:105`) and `AddAuthorizationCore()` (`:106`), and `AddMauiFormFactor()` (`:109`).
  - The `#if DEBUG` block (`MauiProgram.cs:111-138`) adds Blazor WebView developer tools (`:112`) and debug logging (`:113`), then appends a `SocketsHttpHandler` primary handler to the `APIClient` whose `RemoteCertificateValidationCallback` always returns true (`:129-136`), so the app can reach the WebAPI over LAN using the localhost dev cert. The `S4830`/`CA5359` suppression is scoped to Debug and explained inline (`:115-120`): Android's native SSL layer rejects the dev cert at the Java level before the managed callback would ever fire, so the managed TLS stack is used instead. A second comment (`:122-127`) records that this repeat `AddHttpClient("APIClient")` call only **appends** a primary-handler factory, so the client-configure delegates from `AddUIShared` still run and the 90 second `HttpClient.Timeout` they pin survives; replacing rather than adding here would silently fall back to the BCL's uncoordinated 100 second default.
  - `HandleAppAction(AppAction action)` (`MauiProgram.cs:143-156`) maps the action id to a route via `AppActionsInitializer.RouteFor` (`:145`), returns when the id is unknown (`:146-149`), and otherwise publishes the route into [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) (`:153-155`), which buffers it on cold start.
- **Why it's built this way**: the embedded-resource config load is forced by MAUI's lack of on-disk config discovery, and the ordering comments encode real `TryAdd`-versus-`Add` precedence rules that are easy to break silently during a refactor. Scoping the certificate bypass to `#if DEBUG` keeps an intentionally insecure LAN convenience out of every shipped build.
- **Where it's used**: called by every platform head, [MainApplication](#mainapplication) on Android (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:17`), [AppDelegate](#appdelegate) on iOS (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:19`), the MacCatalyst delegate (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/MacCatalyst/AppDelegate.cs:11`), and the Windows `App` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:16`). It is the one place all UI DI is assembled for the mobile and desktop shells.
- **Caveats / not-in-source**: which modules are actually enabled depends on the embedded `appsettings.json` values read by `UIModuleConfiguration.IsModuleEnabled`; those runtime values are not determinable from this file.

### AppDelegate
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:16` · Level 12 · class

- **What it is**: the iOS application delegate. It boots MAUI by returning [MauiProgram](#mauiprogram)'s app, and it receives Universal Links ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)): https URLs on the public web host arrive through `ContinueUserActivity` and are published to the shared deep-link dispatcher for in-app navigation.
- **Depends on**: [MauiProgram](#mauiprogram), [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher), MAUI's `MauiUIApplicationDelegate`, and `Foundation`/`UIKit`.
- **Concept introduced, iOS Universal Links next to Android App Links.** The product concept matches [MainActivity](#mainactivity)'s App Links but the plumbing differs: iOS delivers the tapped web URL as an `NSUserActivity` of type `BrowsingWeb`, and the app must carry the associated-domains entitlement plus a live `apple-app-site-association` file on that host (class summary, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:9-13`). [Rubric §25, Navigation & IA] applies: deep links resolve to in-app routes on iOS exactly as on Android, through the same dispatcher.
- **Walkthrough**: `CreateMauiApp` (`AppDelegate.cs:19`) delegates to `MauiProgram.CreateMauiApp()`. `ContinueUserActivity` (`:22-40`) checks for a `BrowsingWeb` activity with a non-null `WebPageUrl` (`:27-28`), reassembles `path` plus optional `?query` (`:31`), and when the result is non-blank publishes it through [IDeepLinkDispatcher](group-26-device-capability-layer.md#ideeplinkdispatcher) and returns `true` (`:32-36`); every other case defers to the base implementation (`:39`). The `[Register("AppDelegate")]` attribute (`:15`) is what makes the type visible to the Objective-C runtime.
- **Why it's built this way**: mirroring the Android deep-link path through one shared dispatcher means the in-app navigation logic is written once in the shared `DeepLinkListener`, and each platform delegate only translates its native event into a route string.
- **Where it's used**: [Program](#program) passes this type to `UIApplication.Main` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:11`). MacCatalyst compiles a separate same-named delegate under `Platforms/MacCatalyst/AppDelegate.cs:9` that only forwards `CreateMauiApp` (`:11`) and does **not** handle Universal Links, so the deep-link path taught here is iOS-only.

### MainApplication
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` · Level 12 · class

- **What it is**: the Android `MauiApplication` subclass, the process-level Android application object that boots MAUI by returning [MauiProgram](#mauiprogram)'s app.
- **Depends on**: [MauiProgram](#mauiprogram); MAUI's `MauiApplication` and the Android runtime interop types `IntPtr` and `JniHandleOwnership`.
- **Concept introduced**: reuses the **per-platform bootstrapper** pattern (see [App](#app)), where each platform provides a thin entry that calls the shared `MauiProgram`. No new concept.
- **Walkthrough**: the `[Application]` attribute (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:9`) marks it as the Android application class. The `(IntPtr handle, JniHandleOwnership ownership)` constructor (`:12-15`) is the JNI-marshalling constructor the Android runtime requires and simply forwards to the base. `CreateMauiApp` (`:17`) delegates to `MauiProgram.CreateMauiApp()`.
- **Why it's built this way**: Android instantiates the application object before any activity, so this is the earliest point where MAUI can be created; keeping it a one-line delegate concentrates composition in [MauiProgram](#mauiprogram).
- **Where it's used**: the Android runtime instantiates it at process start; it constructs the DI graph that [MainActivity](#mainactivity) and [NowNextWidgetProvider](#nownextwidgetprovider) later resolve services from via `IPlatformApplication.Current`.

### Program
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:8` · Level 13 · class (static)

- **What it is**: the iOS native entry point. `Main` launches the UIKit application with [AppDelegate](#appdelegate) as the delegate type.
- **Depends on**: [AppDelegate](#appdelegate); `UIKit.UIApplication`.
- **Concept introduced, the iOS managed `Main`.** Unlike Android, where the OS instantiates [MainApplication](#mainapplication), iOS starts from a classic `Main`. `UIApplication.Main(args, null, typeof(AppDelegate))` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:10-11`) hands control to UIKit and names the delegate that will call `CreateMauiApp`. [Rubric §22, Responsive/Cross-Browser] applies loosely: one codebase, one launcher per platform.
- **Walkthrough**: a single static `Main(string[] args)` (`Program.cs:10-11`) and no other members.
- **Why it's built this way**: the MAUI iOS template requires an explicit `Main` that names the `AppDelegate`; there is nothing app-specific to customize here.
- **Where it's used**: the iOS process entry point; it never runs on the other platform heads. The MacCatalyst head has its own parallel `Program`/`AppDelegate` pair under `Platforms/MacCatalyst`.

### ADCHomePageContent
> MMCA.ADC.UI · `MMCA.ADC.UI.Pages` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` · Level 8 · class

- **What it is**: A sealed adapter that plugs the ADC landing page into the shared host shell by implementing the framework's home-page content contract: it names the component type and the page title.
- **Depends on**: [IHomePageContent](group-15-common-ui-framework.md#ihomepagecontent) from `MMCA.Common.UI` (`ADCHomePageContent.cs:1,8`) and [ADCHome](group-21-conference-ui.md#adchome) via `typeof` (`ADCHomePageContent.cs:10`).
- **Concept introduced**: **App-supplied content for a shared shell.** The shared `Home.razor` shell does not hardcode any app's landing page; each app registers an `IHomePageContent` that tells the shell which component to render and what title to show. `[Rubric §2, Design Patterns]`, which assesses pattern use at boundaries: this is a small strategy/adapter that keeps the shell app-agnostic and the ADC-specific landing page in the ADC UI project.
- **Walkthrough**: Two get-only members: `ComponentType => typeof(ADCHome)` (`ADCHomePageContent.cs:10`) hands the shell the component to render, and `PageTitle => "Atlanta Developers Conference"` (`ADCHomePageContent.cs:12`) supplies the title (an `i18n: allow` brand name).
- **Why it's built this way**: Inverting the dependency (app implements the Common contract, Common consumes it) lets the same shell host Store, ADC, and Helpdesk without any app reference, satisfying the framework's "build once, compose per app" boundary.
- **Where it's used**: Registered in the ADC UI host's DI as the `IHomePageContent` implementation, resolved by the shared `Home.razor` shell (MAUI host); the WebAssembly client project carries its own structural twin.

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
