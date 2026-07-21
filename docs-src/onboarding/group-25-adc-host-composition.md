# 25. ADC Application Host, UI Shell & Cross-Module Composition

**What this chapter covers.** Every ADC module described so far, Conference, Engagement,
Identity, Notification, is *consumed* somewhere. This chapter is that somewhere: the **client
tier** of ADC, the code that turns the shared per-module Razor Class Libraries
(`MMCA.ADC.{Module}.UI`) and the framework UI package
([`MMCA.Common.UI`](group-15-common-ui-framework.md)) into actually running applications and
composes every conference module into one coherent shell. Two application shapes are built from
the same component set: a **Blazor Web** app (Server prerender plus a WebAssembly client) and a
**.NET MAUI Blazor Hybrid** native app for Android, iOS, macOS (Catalyst), and Windows. The types
this group owns are deliberately thin: the [`ADCHome`](#adchome) landing page and its page-local
carrier records, the [`ADCHomePageContent`](#adchomepagecontent) home-content adapter, the MAUI
[`MauiTokenStorageService`](#mauitokenstorageservice), the MAUI-head-only composition types
([`DeviceUIModule`](#deviceuimodule), [`AppActionsInitializer`](#appactionsinitializer),
[`MauiPublicLinkBuilder`](#mauipubliclinkbuilder), [`NowNextWidgetProvider`](#nownextwidgetprovider),
[`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity)), and the MAUI bootstrap
chain ([`MauiProgram`](#mauiprogram), [`App`](#app), [`MainPage`](#mainpage), and the per-OS entry
points [`MainActivity`](#mainactivity)/[`MainApplication`](#mainapplication)/[`AppDelegate`](#appdelegate)/
the iOS [`Program`](#program)/the WinUI [`App`](#app)). The heavy lifting lives below them in the
modules and in [`MMCA.Common.UI`](group-15-common-ui-framework.md); this chapter is about **wiring
and hosting**, the half of "UI architecture" the modules cannot do for themselves.

**Three hosts, one shared component set.** The central idea, taught in
[primer §2, "Write-once UI, render everywhere"](00-primer.md#2-architectural-styles-this-codebase-commits-to),
is that a page is authored **once** as a Razor component in a module's UI library and then rendered
by every host without per-platform reimplementation. There are three host projects under
`MMCA.ADC/Source/Hosts/UI/`: `MMCA.ADC.UI.Web` (the Blazor **Server** host, SSR prerender plus the
interactive Server circuit), `MMCA.ADC.UI.Web.Client` (the Blazor **WebAssembly** client, compiled
to run in the browser), and `MMCA.ADC.UI` (the **.NET MAUI** host, which packages the same
components into a native app that renders them in a `BlazorWebView`). `[Rubric §18, UI Architecture]`
assesses cohesive, composable components and a clean host/shell split; `[Rubric §22, Responsive &
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
render an app-specific landing page, and [`ADCHomePageContent`](#adchomepagecontent) points it at
ADC's [`ADCHome`](#adchome) (web copy `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:8`, MAUI
copy `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8`, both returning `typeof(ADCHome)` and the
"Atlanta Developers Conference" page title). **Token storage**:
[`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) abstracts where JWTs
live; this group supplies the MAUI implementation
[`MauiTokenStorageService`](#mauitokenstorageservice), while the browser hosts get
[`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice) and
[`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice) from G15. **Form
factor**, OAuth provider availability
([`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings)), the deep-link dispatcher
([`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher)), and the
[`IFormFactor`](group-26-device-capability-layer.md#iformfactor) reporting all sit behind Common
interfaces described in [Group 15](group-15-common-ui-framework.md) and the
[Group 26 device-capability layer](group-26-device-capability-layer.md).

**The landing page: a two-tier content model.** [`ADCHome`](#adchome) is the conference landing
page: a live countdown, the keynote, a track grid, sponsor tiers, and venue/directions. It is
authored **twice**, once for the web hosts
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:13`, shared by Server prerender and WASM
interactive) and once for MAUI (`MMCA.ADC.UI/Pages/ADCHome.razor.cs:13`), because each host tree
compiles the component into its own render pipeline; the duplication is structural, not a design
preference. Its data splits into two tiers, and the page-local records model that split. **Dynamic**
data (the published event's name, dates, venue) is fetched from the anonymous `events` API into
[`ADCEventInfo`](#adceventinfo) (`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:209`,
`MMCA.ADC.UI/Pages/ADCHome.razor.cs:178`), wrapped by the
[`ADCCollectionResult`](#adccollectionresult) envelope
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:207`, `MMCA.ADC.UI/Pages/ADCHome.razor.cs:176`),
with [`EventPhase`](#eventphase) (`Upcoming`/`Live`/`Ended`,
`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:30`, `MMCA.ADC.UI/Pages/ADCHome.razor.cs:29`) driving
the countdown state machine. Rather than pinning the oldest seeded event, `LoadEventAsync` selects
the live-or-next event through Conference's
[`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:137`). **Static** data that changes once per
conference year, the [`KeynoteSpeakerInfo`](#keynotespeakerinfo)
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:315`, `MMCA.ADC.UI/Pages/ADCHome.razor.cs:284`), the
twelve-entry [`ConferenceTrackInfo`](#conferencetrackinfo) grid
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:316`, `MMCA.ADC.UI/Pages/ADCHome.razor.cs:285`), and
the [`SponsorInfo`](#sponsorinfo)/[`SponsorTierInfo`](#sponsortierinfo) lists
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:317-318`, `MMCA.ADC.UI/Pages/ADCHome.razor.cs:286-287`),
is baked into the binary as `static readonly` fields (`ADCHome.razor.cs:222,234,263`). The payoff is
resilience: keynote, tracks, and sponsors render immediately from memory even when the event-date
API is slow or cold, and a `catch (HttpRequestException)` falls back to hard-coded defaults
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:148-151,161`) rather than failing the page.
`[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance]` are both at
play: the page owns minimal state, separates fetched from authored content, and degrades gracefully.

**Prerender safety and the two `ADCHome` copies.** The web copy of `ADCHome` guards its
initialization with `if (!RendererInfo.IsInteractive)`
(`MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:74`): during SSR prerender it skips both the backend
fetch and the countdown arming, because an un-timed server-side call to a cold or unreachable backend
would otherwise block the prerender (and therefore the page load and the post-login
`NavigateTo("/")`) indefinitely. The static fallback renders immediately; the interactive pass loads
the real event and arms a **single one-shot** phase timer for the `Live -> Ended` flip
(`ArmPhaseTimerForEventEnd`, `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:100-115`), rather than
ticking the whole page every second (the per-second countdown now lives in a `HomeCountdown` child
render fence). The MAUI copy has **no** `IsInteractive` guard
(`MMCA.ADC.UI/Pages/ADCHome.razor.cs:64-67`) because the `BlazorWebView` is always interactive and
never prerenders. This is a real, verifiable difference between the two files and the reason the "one
component, two hosts" story is not literally one source file here.

**Internationalization of the shell (ADR-027).** The landing page is a small, honest case study in
where localization applies and where it deliberately does not. UI **chrome** (the fallback event
description, the hero date format, the sponsor-tier heading and its singular/plural word order)
resolves through the `IStringLocalizer` `L[...]` indexer keyed by resource strings, so it follows the
selected culture (`ADCHome.razor.cs:39,194,302-312`), matching the multi-locale en-US + es stance of
ADR-027 (see [primer §6's §27 note](00-primer.md#6-the-34-category-architecture-evaluation-lens)).
Editorial **content**, the conference brand name "Atlanta Developers Conference"
(`ADCHome.razor.cs:37`), the postal venue address (`ADCHome.razor.cs:40-41`), and the keynote bio,
track catalog, and sponsor names (`ADCHome.razor.cs:220-289`), stays English and is annotated in
source with explicit `// i18n: allow` comments explaining the exemption. `[Rubric §27,
Internationalization & Localization]` assesses externalized strings and culture-aware formatting;
this page shows the framework's rule in miniature: localize the chrome, exempt the branded/editorial
data on purpose, and mark the exemption in source. The same `TitleResource` convention flows into the
MAUI shell nav item, where [`DeviceUIModule`](#deviceuimodule) declares its Device-settings entry
with a resource key rather than a literal (`MMCA.ADC.UI/DeviceUIModule.cs:22-25`).

**The MAUI bootstrap chain and the device-capability layer (ADR-042).** The MAUI side is a thin
shell around the shared components, but its composition is where this group does most of its work.
Every platform entry point does nothing but call [`MauiProgram`](#mauiprogram)`.CreateMauiApp()`:
[`MainActivity`](#mainactivity) is the Android launcher activity
(`MMCA.ADC.UI/Platforms/Android/MainActivity.cs:28`) and [`MainApplication`](#mainapplication)
forwards to `CreateMauiApp()` (`MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10,17`);
[`AppDelegate`](#appdelegate) (`MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:17`) and the iOS
[`Program`](#program) (`MMCA.ADC.UI/Platforms/iOS/Program.cs:8`) do the same on iOS; the WinUI
[`App`](#app) (`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8`) on Windows. `MauiProgram.CreateMauiApp`
(`MMCA.ADC.UI/MauiProgram.cs:29,35`) builds the entire DI/configuration graph. Because MAUI does not
auto-load `appsettings.json` from disk, it reads it from an **embedded resource**
(`MauiProgram.cs:49-58`), then registers MudBlazor, the CommunityToolkit (required by the ADR-042
Wave 4 speech-to-text capability, `MauiProgram.cs:42`), the shared UI (`AddUIShared`,
`MauiProgram.cs:67`), the native device capabilities (`UseMauiDeviceCapabilities`, ADR-042,
`MauiProgram.cs:72`), the [`ADCHomePageContent`](#adchomepagecontent) home content
(`MauiProgram.cs:74`), the conditionally-enabled module UIs (gated by
[`UIModuleConfiguration`](group-15-common-ui-framework.md#uimoduleconfiguration) so a build can ship
a subset of modules, `MauiProgram.cs:77-87`), and the MAUI flavors of the token, refresh, and
form-factor services ([`MauiTokenStorageService`](#mauitokenstorageservice) at `MauiProgram.cs:99`,
[`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher) at
`MauiProgram.cs:100`, `AddMauiFormFactor()` at `MauiProgram.cs:105`). The MAUI head also registers
its own composition pieces: [`DeviceUIModule`](#deviceuimodule) as an
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) contributing the Device-settings page plus
the shared `DeepLinkListener` / `BiometricGate` layout components (`MauiProgram.cs:95`), and
[`AppActionsInitializer`](#appactionsinitializer) as an `IMauiInitializeService` that sets localized
home-screen quick actions after build (`MauiProgram.cs:96`). The cross-platform [`App`](#app)
(`MMCA.ADC.UI/App.xaml.cs:7`) creates the single window hosting [`MainPage`](#mainpage), and
`MainPage` (`MMCA.ADC.UI/MainPage.xaml.cs:13`) hosts the `BlazorWebView` and intercepts the
hardware/gesture back button (`OnBackButtonPressed`, `MainPage.xaml.cs:18`), forwarding it to the
WebView's own history via
[`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge)
(`MainPage.xaml.cs:48`) and quitting only when there is nowhere left to go back to
(`MainPage.xaml.cs:49-52`). `[Rubric §25, Navigation, Routing & IA]` shows up in that bridge: native
back must map onto in-app navigation, not OS app-switching, or the native experience feels broken.
`MainActivity`'s `ConfigurationChanges` attribute (`MainActivity.cs:17-21`) is the other native
subtlety: it stops Android from destroying the activity (and with it the Blazor circuit and all
component state) on rotation or dark-mode toggle.

**Deep links, App Links, OAuth, and the home-screen widget (ADR-042 / ADR-043).** Several MAUI-head
types exist to bring the platform's native entry surfaces back into the same in-app navigation the
WebView already runs. [`MainActivity`](#mainactivity) receives verified Android **App Links** (https
URLs on the public web host, `MainActivity.cs:22-27`) and publishes their path/query to
[`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher)
(`MainActivity.cs:48-63`); the iOS [`AppDelegate`](#appdelegate) does the equivalent for Universal
Links, and [`WebAuthenticatorCallbackActivity`](#webauthenticatorcallbackactivity) receives the
custom-scheme OAuth completion redirect (`atldevcon://oauth-complete`,
`MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19-21`) so MAUI's
`WebAuthenticator` can resume the pending social-login flow. [`AppActionsInitializer`](#appactionsinitializer)
maps the three home-screen quick actions to routes (`RouteFor`,
`MMCA.ADC.UI/Services/AppActionsInitializer.cs:40-46`) that `MauiProgram.HandleAppAction` publishes
into the same dispatcher (`MauiProgram.cs:132-145`). The Android home-screen
[`NowNextWidgetProvider`](#nownextwidgetprovider) is a self-contained best-effort surface: on each
update it fetches the anonymous, 60-second-cached `Events/now-next` snapshot into its local
[`NowNextSnapshot`](#nownextsnapshot)/[`NowNextSession`](#nownextsession) records
(`MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:23,110-135`), renders one "Now" and one
"Next" line, and taps back into `MainActivity`'s deep-link path; it never throws, keeping the last
rendered content on any failure (`NowNextWidgetProvider.cs:58-63`). Shared/copied links must point at
the public web app rather than the WebView origin, so [`MauiPublicLinkBuilder`](#mauipubliclinkbuilder)
overrides Conference's [`IPublicLinkBuilder`](group-21-conference-ui.md#ipubliclinkbuilder) to resolve
against the pinned `PublicSite:BaseUrl` (`MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13-32`). These
paths lean on the "last registration wins" DI ordering that `MauiProgram` documents at each override
site.

**Host security: platform-appropriate token handling.** The token-storage implementations are a
compact study in **secret handling matched to the threat model**. On the browser hosts the
high-value *refresh* token is never exposed to JavaScript; it stays in an HttpOnly cookie and is
exchanged through the same-origin proxy (see G15's
[`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice) and
[`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice)). On MAUI, which
has no DOM and therefore no XSS surface, [`MauiTokenStorageService`](#mauitokenstorageservice) stores
both tokens in OS **SecureStorage**, the platform secure enclave (Android Keystore, iOS Keychain,
Windows DPAPI, `MMCA.ADC.UI/Services/MauiTokenStorageService.cs:5-12`) under fixed key names.
`[Rubric §11, Security]` (at-rest secret handling) and `[Rubric §26, Front-End Security]` (no token
reachable from page JS) are both directly embodied; the deeper design note is
`MMCA.ADC/TokenStorageDesignNote.md`. One deliberate development-only relaxation lives in
`MauiProgram`: a `#if DEBUG` block installs a `SocketsHttpHandler` that bypasses SSL certificate
validation (`MauiProgram.cs:107-127`) so a MAUI device on the LAN can reach the API over the ASP.NET
dev cert; it is scoped to DEBUG and annotated inline, not a production path. The Blazor host's
Content-Security-Policy is provided by
[`BlazorCspPolicyProvider`](group-15-common-ui-framework.md#blazorcsppolicyprovider), fed to the
framework's [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware)
over the [`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider) boundary
(ADR-023).

**How it all fits at runtime.** A request to the Blazor Web host renders the shared layout from
[`MMCA.Common.UI`](group-15-common-ui-framework.md); the navbar is composed from each enabled
module's UI descriptor (Conference, Engagement, Identity, Notification), and `/` renders
[`ADCHome`](#adchome) through [`ADCHomePageContent`](#adchomepagecontent). The page fetches the
live-or-next event for its countdown and renders static content immediately; the interactive Server
circuit or the WASM runtime takes over after prerender, auth state flows through
[`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider)
reading whichever [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) the
host registered, and outbound API calls carry the access token with proactive refresh. On MAUI the
same component tree runs inside a `BlazorWebView` with SecureStorage-backed tokens, the native
back-button bridge, deep-link/App-Link entry, quick actions, and the home-screen widget, all funneled
into one dispatcher. In every case the application talks to the backend **only through the YARP
Gateway**: the same boundary that makes the modules independently extractable (ADR-007 gRPC
extraction, ADR-008 service-extraction topology) also makes the UI host-agnostic. The client points
at one origin, and the Gateway routes to whichever service owns the endpoint. That is the unifying
theme of this chapter: **thin hosts over shared components, talking to one gateway, with every
platform difference pushed behind a Common interface.**

### NowNextSession
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:135` · Level 0 · record (sealed, private)

- **What it is** - a tiny wire-shape record for one session row rendered by the Android home-screen widget: `Title`, an optional `RoomName`, and a `StartsAtLocal` timestamp. It is a private nested type of [`NowNextWidgetProvider`](#nownextwidgetprovider).
- **Depends on** - only the BCL (`string`, `DateTime`). No first-party types.
- **Concept introduced** - **local mirror of a server DTO.** The widget deliberately does not reference the `Conference.Shared` assembly just to deserialize one payload; instead it declares its own record whose property names match the JSON the server sends (`NowNextWidgetProvider.cs:131-132` explains this). `System.Text.Json` populates it by name from the `Events/now-next` response.
- **Walkthrough** - the positional record (line 135) is consumed only by `FormatRow` (`NowNextWidgetProvider.cs:102-108`), which formats `StartsAtLocal` as `HH:mm` (invariant culture), appends the room in parentheses when present, and adds a `+N` suffix when more than one session shares the slot.
- **Why it's built this way** - keeping the widget's dependency surface to the BCL plus the Android SDK avoids pulling a module-shared contract assembly into a `BroadcastReceiver` that runs in a minimal process. The property-name coupling to the server DTO is the trade-off, documented inline.
- **Where it's used** - the `Now` and `Next` lists on [`NowNextSnapshot`](#nownextsnapshot); read by `NowNextWidgetProvider.BuildViews`/`FormatRow`.

### WebAuthenticatorCallbackActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` · Level 0 · class

- **What it is** - the Android activity that catches the custom-scheme OAuth completion redirect and hands control back to MAUI's `WebAuthenticator`. After the Identity service finishes a social login it redirects the system browser to `atldevcon://oauth-complete?code=...`; Android routes that URI here, and the base class resumes the pending `AuthenticateAsync` with the captured query parameters (ADR-043).
- **Depends on** - `Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity` (base class), the Android SDK activity/intent attributes. No first-party types.
- **Concept introduced** - **custom-scheme OAuth return on mobile.** Unlike the web heads (which get an HTTP redirect), a native app receives the OAuth result through a registered URI scheme. The `[IntentFilter]` (lines 15-18) declares the app as a handler for `ActionView` intents whose `DataScheme` is `atldevcon`, with the `Default` and `Browsable` categories so a browser can launch it. `NoHistory = true` and `LaunchMode.SingleTop` (line 14) keep the callback out of the back stack and reuse the existing task. `[Rubric §26 - Front-End Security]` assesses how client auth flows avoid token leakage: the scheme is an allowlisted return target, and the class body only holds the constant.
- **Walkthrough** - the class is behavior-free by design (lines 19-22): the whole contract lives in the attributes, and `CallbackScheme = "atldevcon"` (line 21) must stay in lockstep with `OAuth:MobileRedirectScheme` in `appsettings.json` and the Identity service's `OAuth:AllowedReturnUrlSchemes` allowlist (documented in the class summary, lines 10-12).
- **Why it's built this way** - subclassing the MAUI base activity is the framework-sanctioned way to receive the redirect; all the app supplies is the scheme and the intent-filter metadata. Keeping the scheme constant next to the filter makes the three-place coupling (app, config, Identity allowlist) easy to keep aligned during a cutover.
- **Where it's used** - invoked by the Android OS during the OAuth flow started from the social-login buttons wired in [`MauiProgram`](#mauiprogram); not called from managed code.

### NowNextSnapshot
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:133` · Level 1 · record (sealed, private)

- **What it is** - the deserialized `Events/now-next` payload the widget renders: an `EventName`, an `IsLive` flag, and two lists of [`NowNextSession`](#nownextsession) (`Now` and `Next`). Like its sibling it is a private nested record on [`NowNextWidgetProvider`](#nownextwidgetprovider) and a local mirror of the server `NowNextDTO` (see the note at `NowNextWidgetProvider.cs:131-132`).
- **Depends on** - [`NowNextSession`](#nownextsession); BCL `List<T>`, `string`, `bool`.
- **Concept introduced** - reuses the **local mirror of a server DTO** idea introduced by [`NowNextSession`](#nownextsession); no new pattern.
- **Walkthrough** - produced by `FetchSnapshotAsync` via `JsonSerializer.Deserialize<NowNextSnapshot>(json, JsonSerializerOptions.Web)` (`NowNextWidgetProvider.cs:128`), which uses the web (camelCase) naming policy. `BuildViews` (lines 70-100) reads `EventName` into the header text view and takes the first entry of `Now`/`Next` (falling back to a "nothing scheduled" string) for the two body lines. `IsLive` is carried on the record but not consumed by the current render path.
- **Why it's built this way** - one flat record keeps the deserialize-then-render path allocation-light and independent of the Conference module contracts.
- **Where it's used** - returned by `NowNextWidgetProvider.FetchSnapshotAsync`; consumed by `NowNextWidgetProvider.BuildViews`.
- **Caveats / not-in-source** - `IsLive` is deserialized but no code branch reads it today; whether a future render uses it is Not determinable from source.

### MainPage
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:13` · Level 2 · class (partial)

- **What it is** - the single MAUI `ContentPage` that hosts the `BlazorWebView` control (defined in the paired XAML). Its one job beyond hosting is to intercept the platform back gesture (Android hardware back, iOS edge swipe) and forward it to the WebView's own Blazor history stack, only exiting the app when the WebView has nowhere left to go.
- **Depends on** - [`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge) (the shared back-navigation helper), `Microsoft.JSInterop.IJSRuntime`, MAUI's `ContentPage`/`BlazorWebView`/`MainThread`/`Application`.
- **Concept introduced** - **bridging a native gesture into Blazor navigation.** In a Blazor Hybrid host the OS back button is a native event, but the user's mental "back" is a Blazor route change inside the WebView. `OnBackButtonPressed` (lines 18-23) returns `true` to consume the native gesture and kicks off async handling off the UI thread. Because `BlazorWebView` only exposes the synchronous `Action<IServiceProvider>` dispatch overload, `HandleBackAsync` (lines 25-59) captures the renderer-scoped `IJSRuntime` through a `TaskCompletionSource` (lines 32-33, 61-62) and then runs the interop outside the dispatch context. `[Rubric §25 - Navigation & IA]` assesses a coherent navigation model: this makes one back affordance drive the in-app history rather than dumping the user out of the app. `[Rubric §18 - UI Architecture]` is engaged too, since the native shell and the web content share one navigation contract.
- **Walkthrough** - `MainPage()` (line 15) just calls `InitializeComponent()`. `HandleBackAsync` dispatches `CaptureJsRuntime` into the WebView (line 33); if dispatch fails, or the runtime is null, or `MauiBackNavigationBridge.HandleBackPressedAsync` reports `AtRoot` (lines 48-52), it calls `QuitApp`. Every failure path is wrapped in a `catch` (lines 54-58) that quits cleanly, since a not-yet-hydrated WebView or a failed interop should exit rather than hang. `QuitApp` marshals `Application.Current?.Quit()` back onto the main thread (lines 64-68).
- **Why it's built this way** - the `TaskCompletionSource` hop is a direct consequence of the dispatch overload MAUI offers; running interop inside the synchronous dispatch would deadlock. Quitting on any exception keeps the gesture from silently doing nothing on an unhydrated view.
- **Where it's used** - instantiated by [`App`](#app) as the content of the single window; it is the visual root for every platform head.

### App
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:7` · Level 3 · class (partial)

- **What it is** - the cross-platform MAUI `Application` root. It creates the single window that hosts [`MainPage`](#mainpage) (and therefore the Blazor WebView).
- **Depends on** - [`MainPage`](#mainpage); MAUI's `Application`/`Window`/`IActivationState`.
- **Concept introduced** - **the MAUI application object.** One `App` per process owns the window graph; here `CreateWindow` (line 11) returns a single `Window` wrapping a fresh `MainPage`, titled `"MMCA.ADC.UI"`. Compare with the per-platform entry points ([`AppDelegate`](#appdelegate), [`MainApplication`](#mainapplication), [`Program`](#program)) that boot the framework and then defer to this shared class.
- **Walkthrough** - `App()` (line 9) calls `InitializeComponent()` (the XAML-generated partial); `CreateWindow` (line 11) is the only override and simply constructs the window. No lifecycle hooks or DI wiring live here (that is all in [`MauiProgram`](#mauiprogram)).
- **Why it's built this way** - keeping `App` to a single-window factory concentrates all composition in `MauiProgram` and all navigation in `MainPage`, so the application root stays trivial and platform-agnostic.
- **Where it's used** - named as the app type in `builder.UseMauiApp<App>()` (`MauiProgram.cs:39`); instantiated by the MAUI framework after each platform head calls `CreateMauiApp()`.

### DeviceUIModule
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:18` · Level 3 · class (sealed)

- **What it is** - the MAUI-head-only UI module (ADR-042 Wave 2). It contributes the Device settings page plus its nav item and registers the layout components that turn native device events into in-app behavior. Web heads never register it, so none of its pages or components exist there.
- **Depends on** - [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the shared UI-module contract), [`NavItem`](group-15-common-ui-framework.md#navitem); the local `AppLockKeyMigration`, the shared `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener` layout components (from `MMCA.Common.UI.Components.Capabilities`); `System.Reflection`, MudBlazor `Icons`.
- **Concept introduced** - **UI modules as a composition unit.** [`IUIModule`](group-15-common-ui-framework.md#iuimodule) lets each module contribute nav items, layout components, and its own assembly to the shared router; the shared router's `AppAssembly` is `MMCA.Common.UI` and each module's `Assembly` (line 32) is added to `AdditionalAssemblies` so its `[Route]` pages resolve. `NavItems` (lines 22-25) exposes a single `Device settings` entry; per ADR-027 its `Title` is a resource **key** (`"Nav.DeviceSettings"`) resolved at render time by the shared `NavMenu` against the co-located `DeviceUIModule.resx` pair (`TitleResource: typeof(DeviceUIModule)`). `LayoutComponentTypes` (line 30) lists components the shared layout renders once, ordered deliberately: `AppLockKeyMigration` first (so the E7 preference-key rename lands before `BiometricGate` first reads `DevicePreferenceKeys.AppLockEnabled`), then `DeepLinkListener`, `BiometricGate`, and `PushRegistrationListener`. `[Rubric §18 - UI Architecture]` assesses how features compose into the shell: this is the extension point that lets a device-only capability slot into a shared Blazor UI without the web heads knowing. `[Rubric §27 - i18n]` is touched by the resource-key nav title (localization deferred to render time).
- **Walkthrough** - the three auto-properties are the whole surface: `NavItems` (line 22), `LayoutComponentTypes` (line 30), and `Assembly` (line 32). There is no constructor logic; the module is a declarative manifest consumed by the shared UI shell.
- **Why it's built this way** - registering device concerns through the same [`IUIModule`](group-15-common-ui-framework.md#iuimodule) contract the business modules use keeps the MAUI head from special-casing composition; the ordered `LayoutComponentTypes` encodes a real initialization dependency (key migration before the gate reads the key).
- **Where it's used** - registered as a singleton `IUIModule` in [`MauiProgram`](#mauiprogram) (`MauiProgram.cs:95`); its components render inside the shared MMCA.Common.UI layout.

### MainActivity
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:28` · Level 3 · class

- **What it is** - the Android launcher activity for the MAUI host. It does two jobs: declare which configuration changes it handles in-process (so Android does not restart the activity and tear down the Blazor circuit), and receive verified https App Links (ADR-043), publishing their route to the shared deep-link dispatcher for in-app navigation.
- **Depends on** - [`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) (resolved from `IPlatformApplication.Current.Services`), MAUI's `MauiAppCompatActivity`, the Android intent/activity SDK.
- **Concept introduced** - **Android `ConfigurationChanges` and Blazor circuit preservation.** By default Android destroys and recreates an activity on orientation, theme, or density changes; for a `BlazorWebView` that destruction tears down the whole Blazor circuit and loses component state. The `[Activity(... ConfigurationChanges = ScreenSize | Orientation | UiMode | ScreenLayout | SmallestScreenSize | Density)]` attribute (lines 17-21) tells Android the activity handles those events itself, so no recreation happens. The second concept is **verified App Links**: the `[IntentFilter]` (lines 22-27) claims `https` URLs on `PublicWebHost` with `AutoVerify = true`, which requires a live `assetlinks.json` carrying the Play App Signing fingerprint on that host. `[Rubric §25 - Navigation & IA]` and `[Rubric §22 - Responsive/Cross-Browser]` both apply: deep links land the user on the right in-app route, and the config-change handling keeps the single WebView UI stable across device rotations.
- **Walkthrough** - `PublicWebHost` (line 32) is a constant that must match `PublicSite:BaseUrl` in the embedded `appsettings.json` (a custom-domain cutover touches only these two spots, ADR-043). `OnCreate` (lines 35-39) and `OnNewIntent` (lines 42-46) both call `PublishDeepLink`, covering cold start and warm re-entry. `PublishDeepLink` (lines 48-63) ignores anything that is not an `ActionView` intent with data, reconstructs `path` plus optional `?query` (line 61), and publishes the route through [`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher); the dispatcher buffers one route across cold starts until the shared `DeepLinkListener` drains it.
- **Why it's built this way** - the config-changes list is not boilerplate: dropping any entry silently reintroduces an activity restart that only shows up on a physical device rotation or theme switch. Routing both intent callbacks through one helper keeps cold-start and warm-start deep links identical.
- **Where it's used** - the Android launcher (`MainLauncher = true`, line 19); also the explicit target of the widget's tap `PendingIntent` in [`NowNextWidgetProvider`](#nownextwidgetprovider) (`NowNextWidgetProvider.cs:92`).

### NowNextWidgetProvider
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:23` · Level 4 · class (sealed)

- **What it is** - the Android home-screen `AppWidgetProvider` (ADR-042 Wave 8) that renders a "Now / Next" card. On each update it fetches the anonymous, 60s-cached `GET Events/now-next` snapshot (the id-less form, where the server picks the live-or-next published event) and renders one "Now" and one "Next" line. It never throws: a failed fetch leaves the previous `RemoteViews` in place.
- **Depends on** - [`NowNextSnapshot`](#nownextsnapshot) and [`NowNextSession`](#nownextsession) (its private records), [`MainActivity`](#mainactivity) (the tap target), `IConfiguration` (resolved from `IPlatformApplication.Current.Services` for the gateway URL), `System.Net.Http.HttpClient`, `System.Text.Json`, the Android widget SDK.
- **Concept introduced** - **best-effort background rendering under a platform time budget.** `OnUpdate` (lines 25-36) must return fast, so it calls `GoAsync()` (line 34) to keep the broadcast alive while the snapshot downloads, then fires `UpdateWidgetsAsync` without awaiting. The platform enforces a ~10s budget, far above one cached GET. `UpdateWidgetsAsync` (lines 38-68) wraps everything in a `try/catch` that swallows all exceptions (the `CA1031` suppression at line 58 is justified inline: a widget update is best-effort, the last rendering stays) and always calls `pendingResult?.Finish()` in `finally`. `[Rubric §29 - Resilience & Business Continuity]` assesses graceful degradation: a network or parse failure degrades to the stale card rather than an error. `[Rubric §23 - Front-End Performance]` is engaged by leaning on the server's 60s cache and an 8s client timeout rather than any local polling loop.
- **Walkthrough** - `BuildViews` (lines 70-100) inflates the `nownext_widget` layout, sets the event-name text, and fills the Now/Next lines via `FormatRow`, showing a localized "nothing scheduled" string when a list is empty (lines 79-84). It then builds an **explicit** tap intent targeting [`MainActivity`](#mainactivity) with `ActionView` and an app-internal `https://app.internal/happening-now` URI (lines 89-97); the `S1075` suppression is justified (an app-internal route, not an external address), and only the URI path is consumed by the deep-link publisher. `FormatRow` (lines 102-108) formats time as `HH:mm` invariant, appends room in parentheses, and adds `+N` for extra concurrent sessions. `FetchSnapshotAsync` (lines 110-129) reads `Api:ApiEndpoint` from configuration, builds a short-lived `HttpClient` with an 8s timeout, GETs `Events/now-next`, and deserializes with `JsonSerializerOptions.Web`, returning `null` on any missing config, non-success status, or absent endpoint.
- **Why it's built this way** - a widget runs in a minimal broadcast process where throwing would be user-visible as a broken card, so every path is null-guarded and every failure returns quietly to keep the prior render. The `GoAsync`/`Finish` pairing is the Android-sanctioned way to do async work from a receiver without an ANR.
- **Where it's used** - registered via `[BroadcastReceiver]`/`[IntentFilter]`/`[MetaData]` (lines 20-22) and driven by the Android `AppWidgetManager`; its tap routes into [`MainActivity`](#mainactivity)'s deep-link path.
- **Caveats / not-in-source** - the widget layout ids and string resources (`Resource.Layout.nownext_widget`, `Resource.Id.*`, `Resource.String.*`) resolve against generated Android resources not shown here.

### MauiProgram
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:29` · Level 9 · class (static)

- **What it is** - the composition root for the MAUI Blazor Hybrid app. `CreateMauiApp` builds the shared DI/configuration graph that runs Blazor components inside a native WebView on Android, iOS, MacCatalyst, and Windows: it loads embedded configuration, registers MudBlazor and the shared UI services, conditionally registers each module's UI, and wires MAUI-specific auth, form-factor, and device-capability services.
- **Depends on** - the shared UI registrations `AddUIShared` / `UseMauiDeviceCapabilities`, [`UIModuleConfiguration`](group-15-common-ui-framework.md#uimoduleconfiguration), [`IOAuthUISettings`](group-15-common-ui-framework.md#ioauthuisettings) and its `ConfigurationOAuthUISettings` impl, [`IHomePageContent`](group-15-common-ui-framework.md#ihomepagecontent) / [`ADCHomePageContent`](#adchomepagecontent), [`IUIModule`](group-15-common-ui-framework.md#iuimodule) / [`DeviceUIModule`](#deviceuimodule), [`AppActionsInitializer`](#appactionsinitializer), [`MauiTokenStorageService`](#mauitokenstorageservice) / [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), [`ITokenRefresher`](group-15-common-ui-framework.md#itokenrefresher) / [`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher), [`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider), [`MauiPublicLinkBuilder`](#mauipubliclinkbuilder), [`App`](#app); externals MudBlazor, CommunityToolkit.Maui, `MMCA.Common.UI.Maui`, the module UI packages, `SocketsHttpHandler`.
- **Concept introduced** - **registration-order-sensitive composition on top of `TryAdd` defaults.** The shared framework registers safe defaults via `TryAdd`, so this host must place its overrides at the right point in the sequence, because the last plain `Add` wins. Three deliberate orderings appear: `IOAuthUISettings` is registered **before** `AddUIShared` (lines 65-67) so the shell's `TryAdd` default does not shadow it; `UseMauiDeviceCapabilities` runs **after** `AddUIShared` (line 72) so its plain `Add` registrations override the framework's `TryAdd` null capability defaults; and the [`MauiPublicLinkBuilder`](#mauipubliclinkbuilder) is registered **after** `AddConferenceUI` (line 91) so shared/copied links carry the public web URL, not the WebView origin. `[Rubric §18 - UI Architecture]` assesses how the UI host is composed: one shared component graph parameterized per platform head. `[Rubric §22 - Responsive/Cross-Browser]` applies because the same Blazor code targets four platforms from this single builder. `[Rubric §11 - Security]` and `[Rubric §17 - DevOps]` cover the `#if DEBUG` block.
- **Walkthrough** - the builder chain (lines 38-47) sets `UseMauiApp<App>()`, `UseMauiCommunityToolkit()` (required by the speech-to-text capability, ADR-042 Wave 4), a font, and `ConfigureEssentials(... OnAppAction(HandleAppAction))` for home-screen quick actions (ADR-042 Wave 2). Because MAUI does not auto-load config files, lines 50-58 read `MMCA.ADC.UI.appsettings.json` from the executing assembly's manifest resource stream and add it to configuration. Then: `AddMauiBlazorWebView()` and `AddMudServices()` (lines 60-61); the pre-shared `IOAuthUISettings` override (line 65); `AddUIShared` (line 67); `UseMauiDeviceCapabilities()` (line 72, also wiring `Plugin.LocalNotification` and the notification-tap deep-link bridge); the `ADCHomePageContent` landing content (line 74); the four conditional module registrations gated by `UIModuleConfiguration.IsModuleEnabled` (lines 77-87); the public-link override (line 91); the MAUI-only [`DeviceUIModule`](#deviceuimodule) and [`AppActionsInitializer`](#appactionsinitializer) (lines 95-96); the auth stack ([`MauiTokenStorageService`](#mauitokenstorageservice), [`DirectApiTokenRefresher`](group-15-common-ui-framework.md#directapitokenrefresher), [`JwtAuthenticationStateProvider`](group-15-common-ui-framework.md#jwtauthenticationstateprovider), `AddAuthorizationCore`, lines 99-102); and `AddMauiFormFactor()` (line 105). The `#if DEBUG` block (lines 107-127) adds developer tools and debug logging and, notably, replaces the `APIClient` primary handler with a `SocketsHttpHandler` whose `RemoteCertificateValidationCallback` always returns true, so the app can reach the WebAPI over LAN using the localhost dev cert (the `S4830`/`CA5359` suppression is scoped to Debug and explained inline: Android's native SSL layer rejects the dev cert before the managed callback fires). `HandleAppAction` (lines 132-145) maps an app-action id to a route via `AppActionsInitializer.RouteFor` and publishes it into the ADR-042 deep-link dispatcher.
- **Why it's built this way** - the embedded-resource config load is forced by MAUI's lack of on-disk config discovery; the ordering comments encode real `TryAdd`-vs-`Add` precedence rules that are easy to break silently. Scoping the certificate-bypass to `#if DEBUG` keeps an intentionally insecure LAN convenience out of every shipped build.
- **Where it's used** - called by every platform head: [`MainApplication`](#mainapplication) (Android), [`AppDelegate`](#appdelegate) (iOS/MacCatalyst), and the Windows `App`; it is the one place all UI DI is assembled for the mobile/desktop shells.
- **Caveats / not-in-source** - the actual set of enabled modules depends on the embedded `appsettings.json` values read by `UIModuleConfiguration.IsModuleEnabled`; those runtime values are Not determinable from source.

### AppDelegate
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:17` · Level 10 · class

- **What it is** - the iOS/MacCatalyst application delegate. It boots MAUI by returning [`MauiProgram`](#mauiprogram)'s app, and it receives Universal Links (ADR-043): https URLs on the public web host arrive via `ContinueUserActivity` and are published to the shared deep-link dispatcher for in-app navigation.
- **Depends on** - [`MauiProgram`](#mauiprogram), [`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher), MAUI's `MauiUIApplicationDelegate`, `Foundation`/`UIKit`.
- **Concept introduced** - **iOS Universal Links vs Android App Links.** Same product concept as [`MainActivity`](#mainactivity)'s App Links, different platform plumbing: iOS delivers the tapped web URL as an `NSUserActivity` of type `BrowsingWeb`, and the app must carry the associated-domains entitlement plus a live `apple-app-site-association` file on the host. `[Rubric §25 - Navigation & IA]` applies (deep links resolve to in-app routes on iOS just as on Android).
- **Walkthrough** - `CreateMauiApp` (line 20) delegates to `MauiProgram.CreateMauiApp()`. `ContinueUserActivity` (lines 23-41) checks for a `BrowsingWeb` activity with a non-null `WebPageUrl` (line 28), reconstructs the `path` plus optional `?query` (line 32), publishes it through [`IDeepLinkDispatcher`](group-26-device-capability-layer.md#ideeplinkdispatcher) and returns `true`, otherwise defers to the base implementation.
- **Why it's built this way** - mirroring the Android deep-link path through one shared dispatcher means the in-app navigation logic is written once (in the shared `DeepLinkListener`), with each platform delegate only translating its native event.
- **Where it's used** - the iOS entry point [`Program`](#program) passes this type to `UIApplication.Main`; also the MacCatalyst head.

### MainApplication
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` · Level 10 · class

- **What it is** - the Android `MauiApplication` subclass: the process-level Android application object that boots MAUI by returning [`MauiProgram`](#mauiprogram)'s app.
- **Depends on** - [`MauiProgram`](#mauiprogram); MAUI's `MauiApplication`, the Android runtime interop (`IntPtr`, `JniHandleOwnership`).
- **Concept introduced** - reuses the **MAUI cross-platform bootstrapper** pattern (see [`App`](#app)): each platform provides a thin entry that calls the shared `MauiProgram`. No new concept.
- **Walkthrough** - the `(IntPtr, JniHandleOwnership)` constructor (lines 12-15) is the Android JNI-marshalling ctor required by the runtime; `CreateMauiApp` (line 17) delegates to `MauiProgram.CreateMauiApp()`. The `[Application]` attribute (line 9) marks it as the Android application class.
- **Why it's built this way** - Android instantiates the application object before any activity, so this is where MAUI must be created; keeping it a one-line delegate concentrates composition in [`MauiProgram`](#mauiprogram).
- **Where it's used** - the Android runtime instantiates it at process start; it constructs the DI graph that [`MainActivity`](#mainactivity) and [`NowNextWidgetProvider`](#nownextwidgetprovider) later resolve services from.

### Program
> MMCA.ADC.UI · `MMCA.ADC.UI` · `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Program.cs:8` · Level 11 · class (static)

- **What it is** - the iOS native entry point. `Main` launches the UIKit application with [`AppDelegate`](#appdelegate) as the delegate type.
- **Depends on** - [`AppDelegate`](#appdelegate); `UIKit.UIApplication`.
- **Concept introduced** - **the iOS managed `Main`.** Unlike Android (where the OS instantiates [`MainApplication`](#mainapplication)) iOS starts from a classic `Main`; `UIApplication.Main(args, null, typeof(AppDelegate))` (lines 10-11) hands control to UIKit and names the delegate that will call `CreateMauiApp`. `[Rubric §22 - Responsive/Cross-Browser]` applies loosely (one codebase, multiple platform launchers).
- **Walkthrough** - a single static `Main(string[] args)` (lines 10-11); no other members.
- **Why it's built this way** - the MAUI iOS template requires an explicit `Main` that names the `AppDelegate`; there is nothing to customize here.
- **Where it's used** - the iOS process entry point; it never runs on other platforms.

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
