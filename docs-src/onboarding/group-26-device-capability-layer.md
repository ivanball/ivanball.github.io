# 26. Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)

**What this group covers.** A single Blazor UI codebase in `MMCA.Common.UI` renders on three very
different heads: Blazor Server (server-side render plus interactive Server circuits), Blazor
WebAssembly (the whole component tree running in the browser), and MAUI Blazor Hybrid (the same
components inside a native shell on Android, iOS, Windows and macOS). Those heads have wildly
different access to the device: a phone can vibrate, scan a fingerprint, read a QR code with the
camera, drop a local notification and open the system share sheet; a server-rendered page can do none
of that, and a browser page can do some of it through web APIs. This group is how one component
library talks to all of that hardware without ever naming a platform type. It is a set of small,
single-capability interface **contracts** (biometrics, geolocation and geocoding, speech, push
registration, media pick, barcode scanning, clipboard, screenshot, haptics, share, external links,
external OAuth, local cache, local notifications, connectivity, battery, accessibility announcements,
deep links) plus three families of **adapters** that implement each contract per host: MAUI-native,
browser-JS-interop, and inert fallback. The head chooses which family it gets at DI composition time.
This is the [Rubric §18, UI Architecture] and [Rubric §22, Responsive/Cross-Browser] story in
miniature, and the whole design is
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)
(`Website/docs-src/adr/042-device-capability-abstraction.md`).

**The contract-per-capability shape.** Every capability is its own narrow interface in the
`MMCA.Common.UI.Services.Capabilities` namespace (form-factor detection, [IFormFactor](#iformfactor),
sits one level up in `MMCA.Common.UI.Services`). The contracts are deliberately tiny and
transport-agnostic: they speak in booleans, strings, and framework-owned types, never in a MAUI or JS
type. [IBiometricAuthenticator](#ibiometricauthenticator)
(`MMCA.Common.UI/Services/Capabilities/IBiometricAuthenticator.cs:9`) is the clearest example of the
house rule: availability and outcome are both plain `Task<bool>`
(`IBiometricAuthenticator.cs:12,19`), and every failure mode (cancellation, lockout, error) collapses
to `false`, documented right on the member (`IBiometricAuthenticator.cs:16-18`), so a caller can only
fall back to the normal credential login, never to a weaker path. Where a capability must return
structured data it does so through a framework-owned type, not a platform one: [GeoPoint](#geopoint)
(`MMCA.Common.UI/Services/Capabilities/GeoPoint.cs:9`) is a `sealed record` latitude/longitude pair
that even carries its own haversine `DistanceKmTo` helper (`GeoPoint.cs:17-29`) so shared components
never touch a platform location type. [PickedMedia](#pickedmedia)
(`MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:29`, deliberately a class rather than a
record because a record's generic `IEquatable<T>` is a generic WinRT interface that trips CsWinRT AOT
generation (CsWinRT1030) on the windows TFM, `IMediaPickerService.cs:21-24`),
[PushDeviceToken](#pushdevicetoken), and [LocalNotificationRequest](#localnotificationrequest) play
the same role for their capabilities. Keeping the contracts in the shared UI layer and the platform
types out of them is the [Rubric §1, SOLID] dependency-inversion move that makes the whole layer
swappable per host.

**Composition: safe defaults first, head overrides last.** The wiring is a two-phase, last-wins
registration and it is the load-bearing mechanism of the group. `AddUIShared` (in the wider UI group)
calls `AddDeviceCapabilityDefaults`
(`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:24`), which `TryAdd`-registers a
neutral implementation for **every** contract, so any shared component can resolve any capability on
any head and get a well-defined no-op rather than a missing-service exception
(`DependencyInjection.cs:27-65`). A head then calls its own registration **after** `AddUIShared` with
plain `Add` calls, and because the last single-service registration wins, those override the
defaults, a rule spelled out on both DI classes (`DependencyInjection.cs:8-15`,
`MMCA.Common.UI.Maui/DependencyInjection.cs:9-15`). Browser heads call
`AddBrowserDeviceCapabilities` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:78`);
native heads call `AddMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/DependencyInjection.cs:26`), which
ships in the separate MAUI-TFM package `MMCA.Common.UI.Maui`, the one package built outside
`MMCA.Common.slnx`
([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Both DI
classes use the C# `extension(IServiceCollection)` member idiom the codebase favours for registration
(see the [primer](00-primer.md#c-extensiont-types--read-this-once)). The lifetime choices are
deliberate and commented in place: the browser services are `Scoped`, one per Blazor circuit, so
per-user state never leaks across circuits (`DependencyInjection.cs:80-90`), while the MAUI services
are `Singleton` because a native head is single-user and its stateful services wrap app-global
platform events (`MMCA.Common.UI.Maui/DependencyInjection.cs:28-46`).

**Three adapter families.** Each contract has up to three implementations, split across three
namespaces. The **fallback** family lives in `MMCA.Common.UI.Services.Capabilities.Fallbacks` and is
the Null Object pattern applied wholesale ([Rubric §2, Design Patterns]):
[NullBiometricAuthenticator](#nullbiometricauthenticator)
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBiometricAuthenticator.cs:4`) simply returns
`false` from both members (`NullBiometricAuthenticator.cs:7-12`), [NullShareService](#nullshareservice),
[NullClipboardService](#nullclipboardservice) and their siblings do nothing, and
[AlwaysOnlineConnectivityStatusService](#alwaysonlineconnectivitystatusservice) reports permanent
connectivity with an event whose add/remove accessors are deliberately empty because it is never
raised
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/AlwaysOnlineConnectivityStatusService.cs:10-27`),
which is the correct answer on Blazor Server, where a lost connection tears down the circuit itself.
These are what make it safe for a shared component to call a capability unconditionally: the null
implementation answers "not available here" honestly and the component hides the corresponding
affordance. The **MAUI** family lives in `MMCA.Common.UI.Maui.Capabilities` and wraps the real
platform APIs: [MauiFormFactor](#mauiformfactor)
(`MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:12`) reads `DeviceInfo.Idiom` and
`DeviceInfo.Platform` (`MauiFormFactor.cs:15,18`), and its siblings drive Essentials, the MAUI
Community Toolkit, Plugin.LocalNotification, and ZXing.Net.MAUI.

**The browser family and its prerender-safe contract.** The **browser** family lives in
`MMCA.Common.UI.Services.Capabilities.Browser` and reaches the device through JavaScript interop, but
it never calls `IJSRuntime` directly. Every browser service depends on
[CapabilitiesJsModule](#capabilitiesjsmodule)
(`MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:12`), a lazy accessor built
over [LazyJsModule](group-15-common-ui-framework.md#lazyjsmodule) for the single
`./_content/MMCA.Common.UI/capabilities-interop.js` module (`CapabilitiesJsModule.cs:14,19`)
registered once per circuit (`DependencyInjection.cs:81`). Its `InvokeOrDefaultAsync<T>`
(`CapabilitiesJsModule.cs:26`) is the degradation contract that makes browser capabilities usable
during server-side prerender: it wraps the import-and-invoke in a `try` that swallows the entire
JS-unavailable exception family (`InvalidOperationException` for an un-hydrated prerender,
`JSDisconnectedException` for a torn-down circuit, and `JSException` for a throwing browser API) and
returns `default` (`CapabilitiesJsModule.cs:36-48`); disposal delegates to the same lazy module
(`CapabilitiesJsModule.cs:52`). So [BrowserShareService](#browsershareservice)
(`MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:8`) invoking `shareLink`
against `navigator.share` reads the nullable result as `shared == true`
(`BrowserShareService.cs:20-23`) and degrades to "did not share" during prerender instead of
throwing, exactly as the null implementation would; file sharing has no browser primitive at all, so
it answers `false` outright (`BrowserShareService.cs:27-28`). This is the
[Rubric §22, Responsive/Cross-Browser] and [Rubric §23, Front-End Performance] discipline that lets
the same component prerender on the server and hydrate in the browser without a capability check at
every call site.

**Form-factor detection across the trio.** [IFormFactor](#iformfactor)
(`MMCA.Common.UI/Services/IFormFactor.cs:7`) is the smallest capability, two strings describing the
device and platform (`IFormFactor.cs:10,13`), and it is the one contract with three genuinely
different, hoisted implementations: [WebFormFactor](#webformfactor)
(`MMCA.Common.UI.Web/Services/WebFormFactor.cs:12`) reports `"Web"` for the server head
(`WebFormFactor.cs:15`), [WasmFormFactor](#wasmformfactor)
(`MMCA.Common.UI/Services/WasmFormFactor.cs:9`) reports `"WebAssembly"` for the browser runtime
(`WasmFormFactor.cs:12`), and [MauiFormFactor](#mauiformfactor) reports the real device idiom plus
platform and version (`MauiFormFactor.cs:15,18`). Each head registers its own, and
`AddMauiFormFactor` (`MMCA.Common.UI.Maui/DependencyInjection.cs:82`) is kept deliberately separate
from the capability bundle so a head that still registers its own implementation keeps
last-registration-wins control. The trio is the concrete illustration of why the whole group exists:
identical shared components read `GetFormFactor()` and `GetPlatform()` and adapt, and the correct
answer for "what am I running on" is injected, not detected inline.

**Camera scanning, the opt-in capability.** Barcode and QR scanning is the one capability that even a
native head does not get by default, and it shows the composition rule taken one step further.
[IBarcodeScannerService](#ibarcodescannerservice)
(`MMCA.Common.UI/Services/Capabilities/IBarcodeScannerService.cs:11`) is two members, an `IsSupported`
flag and a `ScanAsync` that returns the decoded payload or `null`
(`IBarcodeScannerService.cs:14,20`); a denied permission, a cancelled scan, an unsupported head, and a
cancelled token all collapse to the same `null`, and the contract states outright that the scanned
payload is untrusted input to validate before acting on
(`IBarcodeScannerService.cs:4-9`, [Rubric §26, Front-End Security]). Browsers have no shared
camera-scanning primitive, so web heads keep [NullBarcodeScannerService](#nullbarcodescannerservice)
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBarcodeScannerService.cs:9`) and hide the button.
On MAUI the override is opt-in through `UseCommonBarcodeScanner` rather than folded into the bundle,
because a head that never scans should ship neither the ZXing camera handler nor a camera permission
declaration (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:44-49`, and the default's own comment
at `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:54-57`).
[MauiBarcodeScannerService](#mauibarcodescannerservice)
(`MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:24`) reports support on Android and
iOS only (`MauiBarcodeScannerService.cs:66-68`), pushes [BarcodeScanPage](#barcodescanpage) modally
over the current window page and pops it on every exit path
(`MauiBarcodeScannerService.cs:105-118`); the page itself is built in code rather than XAML, restricts
decoding to two-dimensional formats to cut false positives on a shaky handheld frame, and resolves a
single `TaskCompletionSource` exactly once from first decode, cancel button, back gesture, or
disappearance (`MMCA.Common.UI.Maui/Capabilities/BarcodeScanPage.cs:21,36,72-89`). The subtlest detail
is localization: the two page strings are passed as `Func<string>` delegates and invoked once per
scan, because the singleton service is constructed while the app is being built, which is before
[MauiCultureInitializer](#mauicultureinitializer) restores the user's persisted language, so resolving
the text at construction would pin the modal to the device language forever
(`MauiBarcodeScannerService.cs:16-22,80-83`; the fixed-string overload is kept for heads with no
language switcher, `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:55-70`). That is
[Rubric §27, i18n] showing up inside a device capability.

**Deep links: one funnel from native navigation into Blazor routing.** The most involved runtime flow
in this group is the deep-link path
([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html),
`Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md`).
[IDeepLinkDispatcher](#ideeplinkdispatcher)
(`MMCA.Common.UI/Services/Capabilities/IDeepLinkDispatcher.cs:10`) is the single boundary between
native navigation sources (notification taps, home-screen app actions, app links, QR scans) and the
Blazor router. Native code calls `Publish(route)` with an app-relative route; the shared
`DeepLinkListener` component (in the UI-components group) either receives it live via the
`RouteRequested` event (`IDeepLinkDispatcher.cs:13`) or drains it from a buffer after first render.
The default [DeepLinkDispatcher](#deeplinkdispatcher)
(`MMCA.Common.UI/Services/Capabilities/DeepLinkDispatcher.cs:9`) is registered as a singleton
(`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:65`) because native callers publish
into it from outside any scope, and it solves the cold-start race: when a tap launches the app before
the router exists, `Publish` finds no attached handler and stores the route in a single-entry,
last-write-wins buffer under a `Lock` (`DeepLinkDispatcher.cs:11,18-34`), and the listener drains it
via `TryConsumePending` once it renders (`DeepLinkDispatcher.cs:37-46`). The event payload is
[DeepLinkRouteEventArgs](#deeplinkrouteeventargs), a one-property `EventArgs` carrying the
app-relative route (`MMCA.Common.UI/Services/Capabilities/DeepLinkRouteEventArgs.cs:4-10`). On MAUI
the bridge is wired by [DeviceCapabilitiesInitializer](#devicecapabilitiesinitializer)
(`MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:14`), an `IMauiInitializeService` that hooks
`LocalNotificationCenter.Current.NotificationActionTapped`
(`DeviceCapabilitiesInitializer.cs:27`) and republishes the tapped notification's `ReturningData`
route into the dispatcher, skipping dismissals (`DeviceCapabilitiesInitializer.cs:30-42`). That
wiring is installed by `UseMauiDeviceCapabilities` on the `MauiAppBuilder`
(`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:29`), which also calls `UseLocalNotification()`
and registers the native capability bundle (`HostingDependencyInjection.cs:31-33`).

**Culture is applied through the same last-wins boundary.** Switching language is host-specific too,
so it hides behind [ICultureApplier](group-15-common-ui-framework.md#icultureapplier): `AddUIShared`
`TryAdd`s the web default that force-loads the server `/culture/set` endpoint, and `UseMauiCulture()`
(folded into `UseMauiDeviceCapabilities` at `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:40`,
defined at `HostingDependencyInjection.cs:116-121`) replaces it with
[MauiCultureApplier](#mauicultureapplier) plus the [MauiCultureInitializer](#mauicultureinitializer)
startup restore, because a hybrid head has no ASP.NET pipeline and would resolve that URL through the
Blazor router, matching no page and rendering not-found
(`MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:8-12`). The applier honors only the
allowlisted cultures (`MauiCultureApplier.cs:32-35`) and persists and activates the culture through
[MauiCultureStore](#mauiculturestore) before it force-loads the WebView, an order the comment calls
load-bearing (`MauiCultureApplier.cs:37-45`); the initializer restores the persisted culture inside
`MauiAppBuilder.Build()`, before any window exists, so the first render is already in the right
language (`MMCA.Common.UI.Maui/Globalization/MauiCultureInitializer.cs:14,21-22`). That is
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [Rubric §27, i18n]
meeting this group's composition rule.

**Wired-but-inert capabilities.** A recurring, honest theme in this layer is capabilities that are
fully registered but deliberately do nothing yet, because their real backing requires credentials or
a later feature wave. Native push
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html),
`Website/docs-src/adr/044-native-push-delivery.md`) registers a real
[IPushRegistrationService](#ipushregistrationservice)
(`MMCA.Common.UI/Services/Capabilities/IPushRegistrationService.cs:10`) on MAUI heads
(`MMCA.Common.UI.Maui/DependencyInjection.cs:51`), but the
[IPushDeviceTokenProvider](#ipushdevicetokenprovider) default is
[NullPushDeviceTokenProvider](#nullpushdevicetokenprovider), which always yields `null`
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushDeviceTokenProvider.cs:12-13`), so even a
native head stays registered-but-tokenless until the app supplies real FCM or APNs credentials
(`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:45-49`). The
[IExternalAuthBroker](#iexternalauthbroker)
(`MMCA.Common.UI/Services/Capabilities/IExternalAuthBroker.cs:10`) defaults to
[UnavailableExternalAuthBroker](#unavailableexternalauthbroker) so web heads keep their existing
anchor-href OAuth flow (`DependencyInjection.cs:42`), and
[MauiExternalAuthBroker](#mauiexternalauthbroker) reports `IsAvailable == false` until the head
configures `OAuth:MobileRedirectScheme`
(`MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:35,39`), which is also why it is the one
`Scoped` registration in the native bundle: it navigates through the circuit's `NavigationManager`
after the system-browser round trip (`MMCA.Common.UI.Maui/DependencyInjection.cs:57-60`). Media
picking is the same shape read the other way: [IMediaPickerService](#imediapickerservice) exposes
`IsSupported` (`MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:12`) so web heads render
a plain `InputFile` instead, "the affordance switch, not a degraded path"
(`IMediaPickerService.cs:6-7`,
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)). Biometrics
stay on their null default until the app-lock wave lands (see the
[DevicePreferenceKeys](#devicepreferencekeys) `AppLockEnabled` key,
`MMCA.Common.UI/Services/Capabilities/DevicePreferenceKeys.cs:10`). This "contract present, behavior
inert" pattern is what lets shared components be written against the full capability surface today
while the platform work ships incrementally; each null default is a truthful `IsAvailable == false`
that hides its affordance rather than a stub that lies.

**Device preferences and the per-head lifetime split.** [IDevicePreferences](#idevicepreferences)
(`MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:11`) stores per-device settings
(reminder lead time, haptics toggle, app-lock) that describe *this device* and never roam to the
server, which is why it is distinct from the server-side per-user preferences
(`IDevicePreferences.cs:4-9`). It exposes an `IsPersistent` flag (`IDevicePreferences.cs:17`) so a
head can hide device-settings UI where storage is ephemeral. The three implementations show the
lifetime story clearly: [MauiDevicePreferences](#mauidevicepreferences) persists JSON-encoded values
to native `Preferences.Default` under an `mmca.devicePrefs.` prefix
(`MMCA.Common.UI.Maui/Capabilities/MauiDevicePreferences.cs:14,24`),
[BrowserDevicePreferences](#browserdevicepreferences) persists the same shape to `localStorage`
through the shared JS module
(`MMCA.Common.UI/Services/Capabilities/Browser/BrowserDevicePreferences.cs:12,27-28`), and
[InMemoryDevicePreferences](#inmemorydevicepreferences) is registered `Scoped`
(`DependencyInjection.cs:61`) so the Blazor Server fallback holds per-circuit state in a
`ConcurrentDictionary` and reports `IsPersistent == false`
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/InMemoryDevicePreferences.cs:12,15`). Never storing
secrets here is a documented rule, tokens belong in platform secure storage
(`IDevicePreferences.cs:7`), which ties this into [Rubric §26, Front-End Security] and
[Rubric §11, Security].

**The native shell pieces that come with the package.** Two members of this group are not capability
contracts at all but the MAUI-side plumbing that ships beside them.
[MauiTokenStorageService](#mauitokenstorageservice)
(`MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:22`) is the native
[ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice), holding both tokens in
`SecureStorage` (Android Keystore, iOS Keychain, Windows DPAPI) with every call guarded so an
OS-invalidated keystore entry degrades to one clean re-login rather than an unhandled throw that
would brick the app on launch (`MauiTokenStorageService.cs:5-21`); it writes the refresh token first
and drops both on a partial failure so storage is never a mismatched pair
(`MauiTokenStorageService.cs:40-51`), and it is registered `Scoped` by
`AddCommonMauiTokenStorage()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:73-74`) to match its
browser siblings. [MainPageBase](#mainpagebase) (`MMCA.Common.UI.Maui/MainPageBase.cs:20`) is the
`ContentPage` base a hybrid head's XAML points at: it consumes the platform back gesture
(`MainPageBase.cs:30-35`), captures the renderer-scoped `IJSRuntime` out of the `BlazorWebView`
through a `TaskCompletionSource` (`MainPageBase.cs:53-62`), and forwards the press to
[MauiBackNavigationBridge](group-15-common-ui-framework.md#mauibacknavigationbridge)
(`MainPageBase.cs:69`), quitting the app only when the WebView history is at its root
(`MainPageBase.cs:70-73`). Both are [Rubric §11, Security] and [Rubric §25, Navigation & IA] concerns
that would otherwise be hand-written in every native head.

**Where this group sits.** The capability contracts are consumed by the shared Blazor components and
pages (the UI-components group), by the connectivity, battery and accessibility surfaces, and by the
deep-link and notification paths. Nothing in this group references EF Core, the API, or a message
broker: it is pure presentation-edge adaptation, sitting alongside the rest of `MMCA.Common.UI` at
the top of the dependency flow. Read it as the codebase's answer to a specific hard problem: how to
write device-aware UI once and run it on a server, in a browser, and on a phone, with the platform
differences pushed entirely into injected adapters and the shared components none the wiser. The
governing decisions are
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) (the
abstraction itself, the separate MAUI-TFM package, and the opt-in camera scanner),
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)
(deep links and the native OAuth callback),
[ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) (native push delivery),
and [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) (managed
file storage and avatars, the backing for the media-picker capability).

### BarcodeScanPage

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/BarcodeScanPage.cs:21` · Level 0 · class (internal sealed partial)

- **What it is**: the modal scan surface behind [MauiBarcodeScannerService](#mauibarcodescannerservice): a full-bleed ZXing camera reader with a cancel button underneath, built in C# rather than XAML so the package ships no compiled resource dictionary and the page stays an implementation detail of the service (`MMCA.Common.UI.Maui/Capabilities/BarcodeScanPage.cs:6-9`).
- **Depends on**: no first-party types (it is `internal`, and only its owning service constructs it). Externals: `ZXing.Net.Maui` / `ZXing.Net.Maui.Controls` for `CameraBarcodeReaderView`, `BarcodeReaderOptions` and `BarcodeDetectionEventArgs` (`BarcodeScanPage.cs:1-2`), MAUI's `ContentPage`, `Grid`, `Button` and `SemanticProperties`, and BCL `TaskCompletionSource<T>`.
- **Concept introduced**: *one completion source, many exit paths*. A camera scan can end four different ways (a decode, the cancel button, the platform back gesture, or the page simply disappearing), and every one of them must produce exactly one answer for the awaiting caller and must release the camera. The page centralizes that by owning a single `TaskCompletionSource<string?>` and routing every exit through `TrySetResult`, which is idempotent by construction: the first exit wins and the rest are silently no-ops (`BarcodeScanPage.cs:10-14`, `:72`).
  - `[Rubric §2, Design Patterns]` §2 assesses whether recognized patterns are applied deliberately rather than improvised. This is a promise/completion-source adapter over an event-driven control, the same mechanism [MauiSpeechToTextService](#mauispeechtotextservice) uses for the recognizer, applied here to a whole navigation surface.
  - `[Rubric §21, Accessibility]` §21 assesses whether every interactive surface is reachable and describable without sight. Both controls get an explicit `SemanticProperties.SetDescription` (`BarcodeScanPage.cs:43`, `:51`), and the page `Title` is the same camera description (`:64`), so a screen reader announces what the camera surface is and what the button does.
  - `[Rubric §25, Navigation & IA]` §25 assesses whether navigation state stays coherent. `OnBackButtonPressed` deliberately consumes the gesture instead of letting the platform pop, because the service owns the single `PopModalAsync` and a double pop would remove whatever page came next (`BarcodeScanPage.cs:77-80`).
- **Walkthrough**
  - `_completion` (`BarcodeScanPage.cs:23-24`): a `TaskCompletionSource<string?>` constructed with `TaskCreationOptions.RunContinuationsAsynchronously`, so the caller's continuation never runs inline on the camera callback thread.
  - `_reader` (`BarcodeScanPage.cs:26`): the `CameraBarcodeReaderView` held as a field so detection can be stopped later.
  - The constructor `BarcodeScanPage(string cancelText, string cameraDescription)` (`BarcodeScanPage.cs:28`) builds the reader with `Formats = BarcodeFormats.TwoDimensional`, `AutoRotate = true`, `Multiple = false` and `IsDetecting = true` (`:32-41`). Two-dimensional only is a deliberate accuracy choice: the affordance is a QR/DataMatrix scan, and admitting the 1D formats multiplies false positives on a shaky handheld frame (`:34-35`). It then subscribes `OnBarcodesDetected` (`:42`), sets the reader's semantic description (`:43`), creates the cancel `Button` with a 16-unit margin and its own semantic description (`:45-51`), and lays both out in a `Grid` whose first row is `GridLength.Star` (the camera) and second `GridLength.Auto` (the button) (`:53-62`). `Title` and `Content` are assigned last (`:64-65`).
  - `Completion` (`BarcodeScanPage.cs:69`): the task the service awaits; it yields the first decoded payload or `null` on any cancel.
  - `Cancel()` (`BarcodeScanPage.cs:72`): `_completion.TrySetResult(null)`. Safe to call repeatedly and from any exit path, which is what lets the three cancel routes share one method.
  - `OnBackButtonPressed()` (`BarcodeScanPage.cs:75`): cancels and returns `true` to consume the gesture (`:79-80`).
  - `OnDisappearing()` (`BarcodeScanPage.cs:84`): stops detection, cancels, then calls `base.OnDisappearing()` (`:86-88`). This is the backstop that guarantees the camera is released even if the page leaves the stack by a route the class did not anticipate.
  - `OnCancelClicked(...)` (`BarcodeScanPage.cs:91`): forwards to `Cancel()`.
  - `OnBarcodesDetected(...)` (`BarcodeScanPage.cs:93`): takes the first result with a non-blank `Value` (`:95`), returns without completing when there is none (`:96-99`), then stops detection *before* resolving (`:103-104`), because continued detection would keep raising the event against an already-completed source while the modal animates away (`:101-102`).
  - `StopDetecting()` (`BarcodeScanPage.cs:107`): unsubscribes the handler and sets `IsDetecting = false` (`:109-110`).
- **Why it's built this way**: `partial` is not stylistic here. It is required by CsWinRT1028 on the windows TFM because a `ContentPage` crosses the WinRT ABI, and the redundancy-style rules that object to it on the other three TFMs are silenced project-wide in the csproj (`BarcodeScanPage.cs:15-19`). Keeping the type `internal` means the scan surface is never part of the package's public contract: heads consume the capability through [IBarcodeScannerService](#ibarcodescannerservice) and can never take a dependency on the page's layout.
- **Where it's used**: constructed exclusively by [MauiBarcodeScannerService](#mauibarcodescannerservice) on the main thread, pushed modally, and popped by the same service (`MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:105-118`).

### MauiAccessibilityAnnouncer

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiAccessibilityAnnouncer.cs:9` · Level 1 · class (sealed)

- **What it is**: the MAUI-native adapter for [IAccessibilityAnnouncer](#iaccessibilityannouncer), pushing a spoken announcement to the platform screen reader (TalkBack, VoiceOver, Narrator) through `SemanticScreenReader.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiAccessibilityAnnouncer.cs:5-8`).
- **Depends on**: [IAccessibilityAnnouncer](#iaccessibilityannouncer) (the contract it implements); MAUI Essentials `SemanticScreenReader`; BCL `Task` and `FeatureNotSupportedException`.
- **Concept introduced**: this is the first of the fifteen MAUI adapters in this unit, so the shared shape is worth stating once. Each class implements exactly one narrow capability interface (defined in `MMCA.Common.UI.Services.Capabilities`, so shared components can depend on it from any head), wraps exactly one platform API, and is selected at DI composition time for the native head only. The adapter never branches on "which host am I": the container already answered that question.
  - `[Rubric §21, Accessibility]` §21 assesses whether non-visual users receive the same information sighted users get. This adapter routes announcements through the OS assistive layer rather than a visual-only toast, and is a deliberate silent no-op when no screen-reader integration exists.
  - `[Rubric §2, Design Patterns]` §2 assesses deliberate pattern use. Adapter plus Null Object is the pairing repeated across this entire capability family: a real platform adapter on the native head, an inert sibling everywhere else.
- **Walkthrough**: one member. `AnnounceAsync(string message, CancellationToken cancellationToken = default)` (`MauiAccessibilityAnnouncer.cs:12`) calls the synchronous `SemanticScreenReader.Default.Announce(message)` (`:16`), catches `FeatureNotSupportedException` and drops the announcement when the platform has no screen-reader integration (`:18-21`), and returns `Task.CompletedTask` (`:23`). The platform API is fire-and-forget and synchronous, so the async signature is satisfied with an already-completed task rather than an offloaded call.
- **Why it's built this way**: swallowing the not-supported exception keeps call sites unconditional, so no component ever has to ask whether a screen reader is present before describing a change. Returning a completed task avoids a needless thread hop for what is a synchronous OS call.
- **Where it's used**: registered as a singleton `IAccessibilityAnnouncer` by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:40`), which the head reaches through `UseMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:29-32`). Its siblings on the other heads are [BrowserAccessibilityAnnouncer](#browseraccessibilityannouncer) and [NullAccessibilityAnnouncer](#nullaccessibilityannouncer); consumers are live-update components announcing changes a sighted user perceives only visually.

### MauiBarcodeScannerService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:24` · Level 1 · class (sealed)

- **What it is**: the MAUI camera scanner for [IBarcodeScannerService](#ibarcodescannerservice), built on ZXing.Net.MAUI ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). It pushes [BarcodeScanPage](#barcodescanpage) modally over the current window page, resolves on the first decoded payload, and pops the page again on every exit path (`MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:5-11`).
- **Depends on**: [IBarcodeScannerService](#ibarcodescannerservice) (the contract) and [BarcodeScanPage](#barcodescanpage) (the surface it drives). Externals: MAUI `Application`, `Page`, `MainThread` and `DeviceInfo`; ZXing.Net.MAUI transitively through the page; BCL `Func<string>` and `CancellationToken.Register`.
- **Concept introduced**: *lazily resolved localized text in a singleton*. The service is constructed while the app is being built, which is **before** `MauiCultureInitializer` restores the user's persisted language ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). Capturing the cancel label and camera description as strings at that moment would pin them to the device language for the life of the process, and no later in-app language switch would ever reach them. Passing `Func<string>` delegates instead defers the resource lookup to the moment each scan page is built (`MauiBarcodeScannerService.cs:16-22`, `:80-83`). This is a general trap worth internalizing: anything captured during host construction predates culture restoration.
  - `[Rubric §27, i18n]` §27 assesses whether the app follows the user's language everywhere, not just on pages rendered after a switch. The delegate overload is the localization-correct one, and the string overload is documented as the one that stays in whatever language was active at construction (`MauiBarcodeScannerService.cs:46-52`).
  - `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy]` both bear on the camera permission. The permission belongs to the platform (Android `CAMERA`, iOS `NSCameraUsageDescription`), and a head that has not declared it, or a user who denies it, gets a scan that simply never decodes and is cancelled out of, which the contract surfaces as `null` rather than an exception (`MauiBarcodeScannerService.cs:8-11`).
  - `[Rubric §32, Dependency & Supply-Chain]` §32 assesses whether dependencies are carried only where needed. This service is registered by `UseCommonBarcodeScanner()` alone and is deliberately not folded into `UseMauiDeviceCapabilities()`, so a head that never scans ships neither the ZXing camera handler nor a camera permission declaration (`MauiBarcodeScannerService.cs:12-15`, `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:44-49`).
- **Walkthrough**
  - `_cancelText` / `_cameraDescription` (`MauiBarcodeScannerService.cs:26-27`): the two deferred text resolvers.
  - The primary constructor `MauiBarcodeScannerService(Func<string>, Func<string>)` (`MauiBarcodeScannerService.cs:37`) null-guards both delegates and stores them (`:39-43`).
  - The convenience constructor `MauiBarcodeScannerService(string, string)` (`MauiBarcodeScannerService.cs:55`) chains to the delegate overload by wrapping each value in a closure (`:56`), which is how one implementation serves both registration styles.
  - `IsSupported` (`MauiBarcodeScannerService.cs:66-68`): Android or iOS only. Mac Catalyst and Windows have cameras, but the scan affordance there is a desktop paste field in every head that uses this, and the ZXing camera view is not a supported surface on those targets (`:61-65`).
  - `ScanAsync(CancellationToken = default)` (`MauiBarcodeScannerService.cs:71`): returns `null` immediately when unsupported or already cancelled (`:73-76`), otherwise marshals to the main thread and invokes both delegates *there*, once per scan (`:82-84`). The whole body sits under a `catch`-all with an explicit CA1031 suppression whose justification is that scanning is best-effort: a missing window, a denied camera and a handler-less platform must all read as "no scan" (`:86-91`).
  - `ScanOnMainThreadAsync(...)` (`MauiBarcodeScannerService.cs:94`): resolves the host page and returns `null` if there is none (`:99-103`), constructs the page (`:105`), pushes it modally (`:109`), registers the caller's cancellation token against `scanPage.Cancel` (`:112`), awaits `Completion` (`:113`), and pops the modal in a `finally` so the page leaves the stack on every path (`:115-118`). Every await here uses `ConfigureAwait(true)` on purpose: modal navigation and the camera view are main-thread bound and this method is already on that thread (`:107-108`).
  - `CurrentPage` (`MauiBarcodeScannerService.cs:121`): reads `Application.Current?.Windows` and returns `windows[0].Page` when the collection is non-empty (`:127-128`). `Application.MainPage` is obsolete on the .NET 10 MAUI train, so the window's `Page` is the supported way to reach the active navigation stack (`:125-126`).
- **Why it's built this way**: the single `PopModalAsync` living in the service's `finally`, paired with the page consuming the hardware back gesture, means exactly one pop happens per scan no matter how the scan ended. Combining that with the page's single completion source gives the caller a plain `Task<string?>` for what is really a four-way race.
- **Where it's used**: registered as a singleton `IBarcodeScannerService` by both `UseCommonBarcodeScanner()` overloads (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:100-101`) with a plain `AddSingleton`, which only beats the `TryAddSingleton` default of [NullBarcodeScannerService](#nullbarcodescannerservice) (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:57`) because it is called last (`HostingDependencyInjection.cs:51-54`). ADC's MAUI head calls it with resource-lookup delegates for badge check-in QR scanning (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:115-117`).

### MauiBatteryStatusService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiBatteryStatusService.cs:9` · Level 1 · class (sealed partial, `IDisposable`)

- **What it is**: the MAUI adapter for [IBatteryStatusService](#ibatterystatusservice), reporting the OS energy-saver state and re-raising the platform's change event over `Battery.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiBatteryStatusService.cs:5-7`).
- **Depends on**: [IBatteryStatusService](#ibatterystatusservice); MAUI Essentials `Battery` and `EnergySaverStatus`; BCL `IDisposable` and `EventHandler`.
- **Concept introduced**: the property-plus-change-event capability shape meets a subscription-lifetime concern. This is a singleton that hooks a *static* platform event in its constructor, so it must unhook in `Dispose` or it pins itself for the life of the process.
  - `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance]` both assess whether the client adapts its workload to device constraints. Exposing the energy-saver flag lets live features throttle polling or decline to auto-join real-time channels when the OS says the device is conserving power.
- **Walkthrough**
  - The constructor (`MauiBatteryStatusService.cs:12-13`) subscribes `OnEnergySaverStatusChanged` to `Battery.Default.EnergySaverStatusChanged`, so the instance observes transitions for its whole lifetime.
  - `EnergySaverChanged` (`MauiBatteryStatusService.cs:16`): the contract's argument-free event, re-raised from the platform handler.
  - `IsEnergySaverOn` (`MauiBatteryStatusService.cs:19`): reads `Battery.Default.EnergySaverStatus == EnergySaverStatus.On` on every access, so subscribers re-read the live value instead of trusting stale event args.
  - `Dispose()` (`MauiBatteryStatusService.cs:22`): unsubscribes from the platform event.
  - `OnEnergySaverStatusChanged(...)` (`MauiBatteryStatusService.cs:24-25`): forwards the platform notification as `EnergySaverChanged` with `EventArgs.Empty`.
- **Why it's built this way**: subscribe-in-constructor and unsubscribe-in-`Dispose` is the correct lifetime for a DI singleton holding a handler on a process-lifetime static. Re-reading the property rather than caching the args keeps one source of truth for the current state, which matters because a subscriber may handle the event after another transition has already occurred.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:31`); its fallback sibling is [NullBatteryStatusService](#nullbatterystatusservice). Consumed by live and real-time components deciding whether to auto-join channels.

### MauiBiometricAuthenticator

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiBiometricAuthenticator.cs:13` · Level 1 · class (sealed)

- **What it is**: the platform-direct adapter for [IBiometricAuthenticator](#ibiometricauthenticator) ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4), driving the AndroidX `BiometricPrompt` on Android, `LAContext` on iOS and Mac Catalyst, and reporting unavailable on Windows (`MMCA.Common.UI.Maui/Capabilities/MauiBiometricAuthenticator.cs:5-12`).
- **Depends on**: [IBiometricAuthenticator](#ibiometricauthenticator); per-platform SDKs behind compilation symbols (AndroidX `BiometricManager`, `BiometricPrompt` and `FragmentActivity`; `LocalAuthentication.LAContext`); BCL `TaskCompletionSource<T>` and MAUI `MainThread`.
- **Concept introduced**: *fail-closed boolean auth gating implemented with `#if` partitioning*. Unlike every other adapter here, this class is not one implementation over a cross-platform Essentials API: the body is split three ways so each head compiles only its own SDK. The contract stays two methods regardless.
  - `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` assess whether client-side auth degrades safely. Every negative outcome (cancel, lockout, error, an unsupported head) collapses to `false`, so callers fall back to credential login and never to a weaker path.
  - `[Rubric §22, Responsive/Cross-Browser]` in its device-platform sense: the compile-time partition is what keeps a Windows build from referencing AndroidX types at all.
- **Walkthrough**
  - Android (`MauiBiometricAuthenticator.cs:15-69`): `AllowedAuthenticators` combines `BiometricWeak | DeviceCredential` (`:16-18`), so a device PIN or pattern satisfies the prompt when no biometric is enrolled. `IsAvailableAsync` (`:21`) maps `BiometricManager.CanAuthenticate` against those authenticators to `BiometricSuccess` (`:23-25`). `AuthenticateAsync` (`:29`) requires the current activity to be a `FragmentActivity` and returns `false` otherwise (`:31-34`), builds a `TaskCompletionSource<bool>` with `RunContinuationsAsynchronously` (`:36`), and on the main thread (`:38`) resolves the main executor, resolving `false` if it is null (`:40-45`), then shows a `BiometricPrompt` titled with `reason` and restricted to the same authenticators (`:47-52`). Cancellation is registered to resolve `false` (`:55`) before awaiting the completion (`:56`). The nested `AuthenticationCallback` (`:59-69`) sets `true` on success (`:62-63`) and `false` on error (`:65-66`), and deliberately does **not** complete on `OnAuthenticationFailed`, because a single bad attempt leaves the prompt up (`:68`).
  - iOS and Mac Catalyst (`MauiBiometricAuthenticator.cs:70-92`): both methods create a `using` `LAContext` and work against `LAPolicy.DeviceOwnerAuthentication` (Face ID or Touch ID with passcode fallback). `IsAvailableAsync` returns `CanEvaluatePolicy` (`:74-76`); `AuthenticateAsync` re-checks it, returns `false` when it fails (`:83-86`), and otherwise returns the `success` half of the policy evaluation tuple (`:88-91`).
  - Every other head, Windows included (`MauiBiometricAuthenticator.cs:93-101`): both methods return `Task.FromResult(false)`, because the unpackaged WinUI head cannot present `UserConsentVerifier` (`:9-10`).
- **Why it's built this way**: folding every non-success into `false` forbids a partial-success path at the call site. Allowing device credentials alongside biometrics means a user with no enrolled biometric can still pass the app lock instead of being locked out of the feature. Not completing on a single failed attempt matches the platform prompt's own retry loop, which stays on screen until the user succeeds, cancels, or is locked out.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:45`); the inert fallback is [NullBiometricAuthenticator](#nullbiometricauthenticator). Consumed by the stored-token auto-login app-lock gate, whose opt-in is persisted under a key from [DevicePreferenceKeys](#devicepreferencekeys).
- **Caveats / not-in-source**: the token store and the auto-login flow live in the head apps and the Identity layer. This class only answers "is the enrolled device owner present right now".

### MauiClipboardService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiClipboardService.cs:6` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IClipboardService](#iclipboardservice), writing text to the system clipboard over `Clipboard.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiClipboardService.cs:5`).
- **Depends on**: [IClipboardService](#iclipboardservice); MAUI Essentials `Clipboard`; BCL `FeatureNotSupportedException`.
- **Concept introduced**: best-effort capability with a *reported* outcome. Several adapters in this family swallow failure silently; this one converts it into a `bool` instead.
  - `[Rubric §18, UI Architecture]` §18 assesses whether the presentation layer gives components what they need to render honestly. The `bool` result is what lets a caller show a "copied" confirmation only when the write actually landed, rather than lying on a head with no clipboard.
- **Walkthrough**: one member. `SetTextAsync(string text, CancellationToken cancellationToken = default)` (`MauiClipboardService.cs:9`) awaits `Clipboard.Default.SetTextAsync(text)` and returns `true` (`:13-14`), or returns `false` on `FeatureNotSupportedException` (`:16-19`).
- **Why it's built this way**: reporting success rather than returning `void` makes this adapter the copy-link fallback signal for [IShareService](#ishareservice) callers on heads where a native share sheet is unavailable.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:33`), next to [BrowserClipboardService](#browserclipboardservice) and [NullClipboardService](#nullclipboardservice) on the other heads. Consumed by the copy-link fallback path of [IShareService](#ishareservice).

### MauiConnectivityStatusService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiConnectivityStatusService.cs:11` · Level 1 · class (sealed partial, `IDisposable`)

- **What it is**: the MAUI adapter for [IConnectivityStatusService](#iconnectivitystatusservice), reporting network access and re-raising the change event over `Connectivity.Current` (`MMCA.Common.UI.Maui/Capabilities/MauiConnectivityStatusService.cs:5-10`).
- **Depends on**: [IConnectivityStatusService](#iconnectivitystatusservice); MAUI Essentials `Connectivity` and `NetworkAccess`; BCL `IDisposable` and `ValueTask`.
- **Concept introduced**: offline-awareness at the UI edge, with the same singleton subscription lifetime [MauiBatteryStatusService](#mauibatterystatusservice) established.
  - `[Rubric §29, Resilience & Business Continuity]` §29 assesses graceful degradation when a dependency is unreachable. The offline banner and the request-skipping guards both read from this one flag, so degradation is decided in one place rather than per call site.
- **Walkthrough**
  - The constructor (`MauiConnectivityStatusService.cs:14-15`) subscribes `OnPlatformConnectivityChanged` to `Connectivity.Current.ConnectivityChanged`.
  - `ConnectivityChanged` (`MauiConnectivityStatusService.cs:18`): the contract event.
  - `IsOnline` (`MauiConnectivityStatusService.cs:21`): `Connectivity.Current.NetworkAccess == NetworkAccess.Internet`. This is the load-bearing detail: captive-portal ("constrained") access counts as offline, because the API gateway is unreachable there, which is exactly what the offline banner should say (`:6-9`).
  - `InitializeAsync(CancellationToken = default)` (`MauiConnectivityStatusService.cs:24`): returns `ValueTask.CompletedTask`. The native adapter subscribes in its constructor and needs no post-render listener setup, unlike the browser adapter that the contract's initialize method exists for.
  - `Dispose()` (`MauiConnectivityStatusService.cs:27`): unsubscribes. `OnPlatformConnectivityChanged` (`:29-30`) forwards the event.
- **Why it's built this way**: mapping only full `Internet` access to online (rather than "some network exists") makes the banner honest about gateway reachability. The no-op `InitializeAsync` keeps the always-ready native adapter allocation-free while still satisfying a contract shaped by the browser's needs.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:30`); siblings are [BrowserConnectivityStatusService](#browserconnectivitystatusservice) and the Blazor Server default [AlwaysOnlineConnectivityStatusService](#alwaysonlineconnectivitystatusservice). Consumed by the offline banner and request-skipping guards.

### MauiDevicePreferences

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiDevicePreferences.cs:12` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IDevicePreferences](#idevicepreferences), a typed key/value store for per-device settings backed by `Preferences.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiDevicePreferences.cs:6-11`).
- **Depends on**: [IDevicePreferences](#idevicepreferences); MAUI Essentials `Preferences`; BCL `System.Text.Json`.
- **Concept introduced**: device-scoped client state, with keys drawn from [DevicePreferenceKeys](#devicepreferencekeys) so the same setting resolves identically on every head.
  - `[Rubric §19, State Management]` §19 assesses whether each piece of state has a clear owner and lifetime. These values describe *this device* (haptics on, app lock enabled) and deliberately never roam with the account, which is why they live here rather than in a server-side profile.
  - `[Rubric §26, Front-End Security]` §26 assesses what the client persists. The XML doc is explicit that secrets never belong here: those go to `SecureStorage` (`MauiDevicePreferences.cs:9-10`).
- **Walkthrough**
  - `KeyPrefix = "mmca.devicePrefs."` (`MauiDevicePreferences.cs:14`): every key is namespaced under one prefix, mirroring the browser adapter so key/value semantics hold on every head.
  - `IsPersistent` (`MauiDevicePreferences.cs:17`): `true`, because these values survive an app restart.
  - `GetAsync<T>(string key, T fallback, CancellationToken = default)` (`MauiDevicePreferences.cs:20`): guards the key with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:22`), reads the prefixed raw string and returns `fallback` when absent (`:24-28`), then JSON-deserializes, returning `fallback` on a null result (`:33`) or on `JsonException` (`:35-38`).
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`MauiDevicePreferences.cs:42`): guards the key, then writes `JsonSerializer.Serialize(value)` under the prefixed key (`:46`).
  - `RemoveAsync(string key, CancellationToken = default)` (`MauiDevicePreferences.cs:51`): guards the key and removes the prefixed entry (`:55`).
- **Why it's built this way**: JSON-encoding every value under one prefix gives the same typed store across MAUI and browser heads with no per-type platform code, and a bad key is caught immediately while a corrupt value degrades to the caller's `fallback` rather than throwing into a render path.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:43`); siblings are [BrowserDevicePreferences](#browserdevicepreferences) and the volatile Blazor Server default [InMemoryDevicePreferences](#inmemorydevicepreferences). Read and written by device-settings screens and the app-lock gate.

### MauiExternalLinkService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiExternalLinkService.cs:10` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IExternalLinkService](#iexternallinkservice), opening external URLs in the system browser or the OS handler, because `target="_blank"` dead-ends inside a BlazorWebView (`MMCA.Common.UI.Maui/Capabilities/MauiExternalLinkService.cs:5-9`).
- **Depends on**: [IExternalLinkService](#iexternallinkservice); MAUI Essentials `Browser` and `Launcher`; BCL `Uri` and `FeatureNotSupportedException`.
- **Concept introduced**: the WebView dead-link workaround. A hybrid head renders web markup inside a native shell that has no notion of a second browser tab, so an anchor that would open a new tab on the web simply does nothing. The capability lets shared components emit one markup shape and have the host decide whether to intercept.
  - `[Rubric §25, Navigation & IA]` §25 assesses whether the user always ends up somewhere coherent. Without interception, an external link inside the WebView is a dead click; with it, the link leaves the app the way the platform expects.
  - `[Rubric §18, UI Architecture]` the branch lives once, in the adapter, not in every component that renders a link.
- **Walkthrough**
  - `InterceptsLinks` (`MauiExternalLinkService.cs:13`): `true`, telling shared components to route through `OpenAsync` rather than render a raw anchor.
  - `OpenAsync(Uri uri, CancellationToken = default)` (`MauiExternalLinkService.cs:16`): null-guards `uri` (`:18`); for `http` and `https` (compared with `Uri.UriSchemeHttp`/`Https` under `OrdinalIgnoreCase`) it uses `Browser.Default.OpenAsync(uri, BrowserLaunchMode.SystemPreferred)` and returns (`:22-27`); everything else (`mailto:`, `tel:`, `sms:`) goes to `Launcher.Default.TryOpenAsync` (`:31`), because `Browser.Default` only accepts http(s) (`:29-30`). `FeatureNotSupportedException` is swallowed: the link is a convenience, not a workflow (`:33-36`).
- **Why it's built this way**: splitting web schemes (system browser) from contact schemes (OS launcher) is what makes `mailto:` and `tel:` links work from inside the WebView, where a plain anchor would silently do nothing and the browser API would reject the scheme outright.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:38`); siblings are [BrowserExternalLinkService](#browserexternallinkservice) and [NullExternalLinkService](#nullexternallinkservice). Consumed by the shared external-link component.

### MauiFormFactor

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:12` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [IFormFactor](#iformfactor), reporting the actual device idiom and platform through `DeviceInfo` (`MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:5-11`).
- **Depends on**: [IFormFactor](#iformfactor), which lives in `MMCA.Common.UI.Services` rather than the `Capabilities` namespace (`MauiFormFactor.cs:1`); MAUI Essentials `DeviceInfo`.
- **Concept introduced**: nothing new. This implements the older [IFormFactor](#iformfactor) contract rather than a `Capabilities` interface, but it follows the same per-host adapter idea the rest of this unit uses.
  - `[Rubric §22, Responsive/Cross-Browser]` §22 assesses whether the UI adapts across device classes. This class supplies the native head's *real* idiom, where the [WebFormFactor](#webformfactor) and [WasmFormFactor](#wasmformfactor) siblings can only report a web-derived answer.
- **Walkthrough**: two members, both expression-bodied.
  - `GetFormFactor()` (`MauiFormFactor.cs:15`): `DeviceInfo.Idiom.ToString()`, which yields Phone, Tablet or Desktop.
  - `GetPlatform()` (`MauiFormFactor.cs:18`): `DeviceInfo.Platform.ToString() + " - " + DeviceInfo.VersionString`, for example Android, iOS, Windows or macOS with a version.
- **Why it's built this way**: the class was hoisted out of the app MAUI heads because it carries no app-specific state, so all native heads share one implementation instead of copy-pasting two one-line methods (`MauiFormFactor.cs:7-10`).
- **Where it's used**: registered as a singleton `IFormFactor` by `AddMauiFormFactor()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:82-83`), which is deliberately kept separate from `AddMauiDeviceCapabilities()` so heads that still register their own form factor are not double-registered. Consumed by layout and responsive components that branch on form factor.

### MauiHapticFeedbackService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiHapticFeedbackService.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IHapticFeedbackService](#ihapticfeedbackservice), firing tactile feedback over `HapticFeedback.Default` and `Vibration.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiHapticFeedbackService.cs:5-10`).
- **Depends on**: [IHapticFeedbackService](#ihapticfeedbackservice); MAUI Essentials `HapticFeedback`, `HapticFeedbackType` and `Vibration`; BCL `TimeSpan` and `OperatingSystem`.
- **Concept introduced**: *decoration, not behavior*. This is the one capability whose methods are synchronous and `void`: nobody awaits a buzz, and nothing downstream depends on whether it happened.
  - `[Rubric §18, UI Architecture]` §18 assesses whether presentation concerns stay off the correctness path. Every failure here is swallowed precisely so that a missing motor or a blocked permission can never change what the app does.
- **Walkthrough**
  - `IsSupported` (`MauiHapticFeedbackService.cs:14`): `!OperatingSystem.IsWindows()`, since Windows has no haptics.
  - `Click()` and `LongPress()` (`MauiHapticFeedbackService.cs:17`, `:20`): route to the private `Perform` with the matching `HapticFeedbackType`.
  - `Vibrate(TimeSpan duration)` (`MauiHapticFeedbackService.cs:23`): calls `Vibration.Default.Vibrate(duration)`, catching `FeatureNotSupportedException` (no motor or no platform support, `:29-32`) and `PermissionException` (the Android `VIBRATE` permission missing from the host manifest, `:33-36`).
  - `Perform(HapticFeedbackType type)` (`MauiHapticFeedbackService.cs:39`): calls `HapticFeedback.Default.Perform(type)`, catching the same two exception types (`:45-52`).
- **Why it's built this way**: synchronous `void` methods match the fire-and-forget nature of a UI micro-cue, and catching both the not-supported and the permission-missing cases means a head that forgot a manifest entry gets a silently plainer experience rather than an exception on a button click.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:34`); the no-op fallback is [NullHapticFeedbackService](#nullhapticfeedbackservice). Consumed by interactive components such as bookmark toggles and poll votes.

### MauiLocalCacheStore

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiLocalCacheStore.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [ILocalCacheStore](#ilocalcachestore), storing JSON documents as files in an `mmca-cache` folder under the app data directory (`MMCA.Common.UI.Maui/Capabilities/MauiLocalCacheStore.cs:6-10`).
- **Depends on**: [ILocalCacheStore](#ilocalcachestore); BCL `System.IO` (`File`, `Path`, `Directory`), MAUI `FileSystem`, and `System.Text.Json`.
- **Concept introduced**: last-known-good UI state for offline rendering. Unlike [IDevicePreferences](#idevicepreferences), which holds settings the user chose, this holds server data the app may need to redraw without a network.
  - `[Rubric §29, Resilience & Business Continuity]` §29 assesses degradation under dependency failure. Paired with [IConnectivityStatusService](#iconnectivitystatusservice), the on-device cache lets shared components render a snapshot when the API is unreachable instead of an empty screen.
- **Walkthrough**
  - `IsAvailable` (`MauiLocalCacheStore.cs:14`): `true`, because a native head always has a writable data directory.
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`MauiLocalCacheStore.cs:17`): guards the key (`:19`), resolves the path creating the directory (`:23`), serializes, and `File.WriteAllTextAsync`s (`:24-25`), catching `IOException` and `UnauthorizedAccessException` because a failed write only means a colder next launch (`:27-34`).
  - `GetAsync<T>(string key, CancellationToken = default)` (`MauiLocalCacheStore.cs:38`): guards the key, returns `default` when the file does not exist (`:45-48`), otherwise reads and deserializes (`:50-51`), collapsing `IOException`, `UnauthorizedAccessException` and `JsonException` to `default` (`:53-64`).
  - `RemoveAsync(string key, CancellationToken = default)` (`MauiLocalCacheStore.cs:68`): deletes the file, swallowing the same IO failures (`:74-83`).
  - `GetPath(string key, bool ensureDirectory)` (`MauiLocalCacheStore.cs:88`): builds `mmca-cache` under `FileSystem.AppDataDirectory` (`:90`), optionally creates it (`:91-94`), and maps the key to a file name through a conservative character filter that keeps ASCII letters, digits, `-` and `.` and replaces everything else with `_`, then appends `.json` (`:96-97`). The class doc notes keys are code-controlled, not user input (`:8-9`).
- **Why it's built this way**: file-per-key JSON keeps the store dependency-free (no embedded database to ship or migrate), and best-effort IO with `default` returns means a cache miss or a corrupt file degrades to a live fetch rather than surfacing an error to the user.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:44`); siblings are [BrowserLocalCacheStore](#browserlocalcachestore) and the permanently unavailable [NullLocalCacheStore](#nulllocalcachestore). Consumed by offline-capable list and schedule components.
- **Caveats / not-in-source**: the filter maps distinct keys onto the same file name when they differ only in filtered characters. Nothing in this class detects that collision; the doc comment's "keys are code-controlled" is the mitigation.

### MauiMapNavigationService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiMapNavigationService.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IMapNavigationService](#imapnavigationservice), launching the platform maps app for a street address through `Launcher` URIs (`MMCA.Common.UI.Maui/Capabilities/MauiMapNavigationService.cs:5-10`).
- **Depends on**: [IMapNavigationService](#imapnavigationservice); MAUI Essentials `Launcher`; BCL `Uri` and `OperatingSystem`.
- **Concept introduced**: address-only navigation. The capability takes a postal address, not coordinates, because the domain model carries no geo-coordinates and the OS maps app can geocode far better than the app could.
  - `[Rubric §18, UI Architecture]` and `[Rubric §30, Compliance/Privacy]`: handing the address to the OS means the app never requests a location permission and never sees where the user is, which is the cheapest possible privacy posture for a "get directions" button.
- **Walkthrough**
  - `OpenAddressAsync(string address, string? label, CancellationToken = default)` (`MauiMapNavigationService.cs:14`): guards the address (`:16`), URL-escapes it with `Uri.EscapeDataString` (`:18`), builds the platform URI (`:19`), and returns the result of `Launcher.Default.TryOpenAsync(uri)` (`:23`), or `false` on `FeatureNotSupportedException` (`:25-28`). The `label` parameter is accepted by the contract but unused by this adapter.
  - `BuildPlatformUri(string escapedQuery)` (`MauiMapNavigationService.cs:31`): `geo:0,0?q=...` on Android (`:36-39`), `https://maps.apple.com/?q=...` on iOS and Mac Catalyst (`:41-44`), and `bingmaps:?q=...` everywhere else (`:46`). The method brackets its body with a SonarAnalyzer `S1075` suppression (`:35`, `:47`) whose comment records the reasoning: these launcher URIs *are* the per-platform maps integration point, fixed by the OS rather than environment-dependent, which is what S1075 actually targets (`:33-34`).
- **Why it's built this way**: routing through the OS launcher instead of an in-app map control needs no location permission, no map SDK and no geocoding round-trip. Hard-coding the scheme per platform is correct here because these are OS contracts, and the class doc notes Android hosts must declare a `geo` intent in the manifest `<queries>` block for the launcher to resolve it (`MauiMapNavigationService.cs:9`).
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:35`); siblings are [BrowserMapNavigationService](#browsermapnavigationservice) and [NullMapNavigationService](#nullmapnavigationservice). Consumed by venue and location components.

### MauiScreenshotService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiScreenshotService.cs:10` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IScreenshotService](#iscreenshotservice), capturing the current screen to a temporary PNG through `Screenshot.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiScreenshotService.cs:5-9`).
- **Depends on**: [IScreenshotService](#iscreenshotservice); MAUI Essentials `Screenshot`, `ScreenshotFormat` and `FileSystem`; BCL `System.IO` and `Guid`.
- **Concept introduced**: *permissionless temp-file capture*. Where the file lands is the whole design.
  - `[Rubric §30, Compliance/Privacy]` and `[Rubric §26, Front-End Security]`: captures go to the platform cache directory and never the photo library, so no storage permission is prompted or held, and the OS is free to reclaim the files when it needs space.
- **Walkthrough**
  - `IsSupported` (`MauiScreenshotService.cs:13`): `Screenshot.Default.IsCaptureSupported`.
  - `CaptureToFileAsync(CancellationToken = default)` (`MauiScreenshotService.cs:16`): re-checks capture support and returns `null` early when it is unavailable (`:18-21`); otherwise captures (`:25`), builds a path of `mmca-screenshot-{guid:N}.png` under `FileSystem.CacheDirectory` (`:26`), opens the capture as a PNG stream and copies it to a created file through nested `await using` blocks that dispose both streams deterministically (`:28-36`), and returns the path (`:38`). Both `FeatureNotSupportedException` and `IOException` return `null` (`:40-47`).
- **Why it's built this way**: writing to the cache directory keeps the feature permission-free, and the nullable path return lets the share flow abort quietly when capture is unsupported or the write fails, rather than forcing every caller into a try/catch.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:42`); the unsupported fallback is [NullScreenshotService](#nullscreenshotservice). Its output path is handed straight to [IShareService](#ishareservice) for image sharing.

### MauiShareService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiShareService.cs:6` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [IShareService](#ishareservice), opening the native share sheet for a link or a local file over `Share.Default` (`MMCA.Common.UI.Maui/Capabilities/MauiShareService.cs:5`).
- **Depends on**: [IShareService](#ishareservice); MAUI Essentials `Share`, `ShareTextRequest`, `ShareFileRequest` and `ShareFile`; BCL `Uri`, `FeatureNotSupportedException` and `IOException`.
- **Concept introduced**: share with a copy-link fallback. The interface was shaped around the fact that not every head has a share sheet, so both methods answer `bool` rather than `void`.
  - `[Rubric §18, UI Architecture]`: those boolean returns are exactly what make an [IClipboardService](#iclipboardservice) copy-link a viable second choice, keeping a Share button useful on every head.
- **Walkthrough**
  - `ShareLinkAsync(string title, Uri uri, CancellationToken = default)` (`MauiShareService.cs:9`): null-guards `uri` (`:11`), requests a `ShareTextRequest` carrying `Title` and the URI string (`:15-19`), and returns `true`, or `false` on `FeatureNotSupportedException` (`:22-25`).
  - `ShareFileAsync(string title, string filePath, string contentType, CancellationToken = default)` (`MauiShareService.cs:29`): guards `filePath` (`:31`), requests a `ShareFileRequest` wrapping `new ShareFile(filePath, contentType)` (`:35-39`), and returns `true`, or `false` on `FeatureNotSupportedException` or `IOException` (`:42-49`).
- **Why it's built this way**: presenting the OS share sheet reuses the platform's own target picker, so the app never has to enumerate or authenticate against individual destinations. Reporting failure as `false` lets the calling component degrade to copy-link instead of showing an error.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:32`); siblings are [BrowserShareService](#browsershareservice) and [NullShareService](#nullshareservice). Consumes [IScreenshotService](#iscreenshotservice) output for image sharing and falls back to [IClipboardService](#iclipboardservice).

### MauiSpeechToTextService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiSpeechToTextService.cs:14` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [ISpeechToTextService](#ispeechtotextservice) ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4), driving CommunityToolkit.Maui's `SpeechToText` recognizer and owning the microphone permission flow (`MMCA.Common.UI.Maui/Capabilities/MauiSpeechToTextService.cs:7-13`).
- **Depends on**: [ISpeechToTextService](#ispeechtotextservice); `CommunityToolkit.Maui.Media.SpeechToText` (`MauiSpeechToTextService.cs:2`); BCL `CultureInfo`, `IProgress<string>` and `TaskCompletionSource<T>`.
- **Concept introduced**: *bridging an event-driven recognizer to a single awaitable call*. The toolkit exposes start/stop plus "result updated" and "result completed" events; the contract wants one `ListenAsync` that returns the final text. A `TaskCompletionSource<string?>` resolved from the completion handler is the idiomatic adapter, the same shape [BarcodeScanPage](#barcodescanpage) uses for its four exit paths.
  - `[Rubric §21, Accessibility]` and `[Rubric §24, Forms/Validation/UX Safety]`: dictation is an input affordance, so a permission denial or a recognizer failure must never wedge a form. Every negative outcome returns `null` and the affordance simply does nothing.
- **Walkthrough**
  - `IsSupported` (`MauiSpeechToTextService.cs:17`): `true`.
  - `ListenAsync(CultureInfo culture, IProgress<string>? partialResults, CancellationToken = default)` (`MauiSpeechToTextService.cs:20`): null-guards `culture` (`:25`); requests recognition permissions and returns `null` when denied (`:29-32`); creates the completion source with `RunContinuationsAsynchronously` (`:34`); declares `OnUpdated` to forward interim text to `partialResults` (`:36-37`) and `OnCompleted` to resolve the final `Text` when the recognition result is successful and `null` otherwise (`:39-40`); subscribes both (`:42-43`); starts listening with `SpeechToTextOptions` carrying the culture and `ShouldReportPartialResults` set only when a progress sink was supplied (`:46-51`); registers the caller's cancellation to resolve `null` (`:53-54`); and awaits the completion (`:55`). The `finally` unsubscribes both handlers and calls `StopListenAsync(CancellationToken.None)` (`:57-62`). `OperationCanceledException` returns `null` (`:64-67`), as does the `InvalidOperationException` or `FeatureNotSupportedException` pair matched by an exception filter (`:68-71`).
- **Why it's built this way**: the guaranteed unsubscribe-and-stop in `finally` is what prevents a leaked recognizer session across dictations, and stopping with `CancellationToken.None` means a cancelled listen still shuts the microphone down rather than abandoning it. Reporting partial results only when the caller passed an `IProgress<string>` avoids paying for interim recognition events nobody consumes.
- **Where it's used**: registered as a singleton by `AddMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:46`); the fallback is [NullSpeechToTextService](#nullspeechtotextservice). Consumed by dictation affordances on text inputs.
- **Caveats / not-in-source**: heads must chain `.UseMauiCommunityToolkit()` onto their own `UseMauiApp<T>()` call for this adapter to work; the toolkit's MCT001 analyzer requires that call to appear in the app's own builder chain, so `UseMauiDeviceCapabilities()` cannot make it on the head's behalf (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:22-27`).

### IShareService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IShareService.cs:8` · Level 0 · interface

- **What it is**: opens the platform share affordance (native share sheet on MAUI, `navigator.share` in
  browsers) for a link or a local file.
- **Depends on**: BCL only (`System.Uri`); falls back to [`IClipboardService`](#iclipboardservice).
- **Concept, share with a copy-link fallback.** `[Rubric §18, UI Architecture]`. Both methods return
  `false` when sharing is unavailable so callers can fall back to [`IClipboardService`](#iclipboardservice)
  copy-link (`IShareService.cs:4-6`). This is the pairing that makes the `bool` return on
  [`IClipboardService.SetTextAsync`](#iclipboardservice) useful.
- **Walkthrough**
  - `ShareLinkAsync(string title, Uri uri, CancellationToken = default)` (`IShareService.cs:11`): shares
    a link with a title; returns whether a share UI was presented.
  - `ShareFileAsync(string title, string filePath, string contentType, CancellationToken = default)`
    (`IShareService.cs:17`): shares a local file (e.g. a screenshot); returns whether a share UI was
    presented, and browser implementations report `false` (no local file access,
    `IShareService.cs:13-16`).
- **Why it's built this way**: the boolean-return-plus-clipboard-fallback pattern lets a Share button
  work everywhere: native heads present the sheet, browsers that lack `navigator.share` (or file
  sharing) degrade to copying the link and confirming from [`IClipboardService`](#iclipboardservice).
- **Where it's used**: implemented by [`MauiShareService`](#mauishareservice),
  [`BrowserShareService`](#browsershareservice), and [`NullShareService`](#nullshareservice); consumes
  [`IScreenshotService`](#iscreenshotservice) output for image sharing and
  [`IClipboardService`](#iclipboardservice) as its fallback.

### ISpeechToTextService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/ISpeechToTextService.cs:10` · Level 0 · interface

- **What it is**: the capability contract for dictating speech into text fields (feedback forms, live Q&A questions) through the platform recognizer (`ISpeechToTextService.cs:5-9`). Like every contract in this group it is a tiny, platform-free interface that the shared component tree depends on instead of naming a MAUI or browser recognizer type.
- **Depends on**: nothing first-party. It speaks in `System.Globalization.CultureInfo`, `System.IProgress<string>`, `System.Threading.CancellationToken`, and `Task<string?>` only, so `MMCA.Common.UI` (which references `Shared` alone, per `MMCA.Common/CLAUDE.md`) carries no dependency on any platform recognizer.
- **Concept introduced**: the contract-per-capability shape and the two-phase last-wins registration were both established in the [chapter overview](#26-device-capability-abstraction-layer-native-contracts-maui-browser--fallback-adapters) and by [IFormFactor](#iformfactor); this type reuses them for speech input. The house-rule worth noting here is the **`IsSupported` gate as an affordance switch, not a degraded path**: web and null fallbacks report `IsSupported` `false` (`ISpeechToTextService.cs:7-8`) and shared components hide the microphone button entirely rather than offering one that silently fails.
  - `[Rubric §22, Responsive / Cross-Browser]` §22 assesses whether the app adapts across the device and host matrix. Speech input is a native-only affordance here, and the interface makes that variance a single injected boolean instead of a `#if` in component markup.
  - `[Rubric §21, Accessibility]` §21 assesses inclusive input/output paths. Dictation is an accessibility affordance for text entry, offered where the platform supports it and cleanly hidden where it does not.
- **Walkthrough**: two members.
  - `IsSupported` (`ISpeechToTextService.cs:13`): whether speech recognition is available on this platform.
  - `ListenAsync(CultureInfo, IProgress<string>?, CancellationToken)` (`ISpeechToTextService.cs:20-23`): listens until the recognizer finalizes or the token cancels, streaming partial hypotheses through the `partialResults` progress sink, and returns the final transcript, or `null` on permission denial, cancellation, or recognizer failure (`ISpeechToTextService.cs:16-19`). The `null`-on-failure contract is the same never-throw discipline the whole layer follows: a caller can only fall back to typing, never to a broken path.
- **Why it's built this way**: keeping recognition behind a `Shared`-only interface lets the MAUI head supply a real recognizer while browser and null heads register an inert one, all selected at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), `Website/docs-src/adr/042-device-capability-abstraction.md`).
- **Where it's used**: registered as a singleton with the `NullSpeechToTextService` default in `AddDeviceCapabilityDefaults` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:41`); the MAUI-native override ships in the `MMCA.Common.UI.Maui` package. Consumed by shared components that offer voice input on feedback and Q&A forms.

### ITextToSpeechService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/ITextToSpeechService.cs:9` · Level 0 · interface

- **What it is**: the output counterpart to [ISpeechToTextService](#ispeechtotextservice), reading text aloud (session descriptions, announcements) through the platform speech synthesizer and matching the active UI culture's voice when one is installed (`ITextToSpeechService.cs:3-8`).
- **Depends on**: nothing first-party; `System.Threading.CancellationToken` and `Task` only.
- **Concept introduced**: nothing new; it applies the same `IsSupported` affordance switch and never-throw contract as its dictation sibling. Web and null fallbacks report `IsSupported` `false` and components hide the affordance (`ITextToSpeechService.cs:6-8`).
  - `[Rubric §21, Accessibility]` §21 assesses inclusive output. Read-aloud is an accessibility affordance offered where the platform can synthesize speech.
  - `[Rubric §27, i18n]` §27 assesses localization depth. The contract documents culture-matched voice selection with a documented fall back to the default voice when none matches the current culture (`ITextToSpeechService.cs:14-18`).
- **Walkthrough**: three members.
  - `IsSupported` (`ITextToSpeechService.cs:12`): whether synthesis is available.
  - `SpeakAsync(string, CancellationToken)` (`ITextToSpeechService.cs:19`): speaks the text and completes when playback ends; cancel the token or call `StopAsync` to interrupt.
  - `StopAsync()` (`ITextToSpeechService.cs:22`): stops any in-progress speech.
- **Why it's built this way**: same rationale as the dictation contract, one narrow capability behind a `Shared`-only interface, real on MAUI and inert elsewhere ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered with the `NullTextToSpeechService` default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:35`); MAUI overrides it. Consumed by components that read session and announcement text aloud.

### LocalNotificationRequest

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/LocalNotificationRequest.cs:15` · Level 0 · record

- **What it is**: the framework-owned value type describing one scheduled local (on-device) notification, the payload passed to [ILocalNotificationService](#ilocalnotificationservice) (`LocalNotificationRequest.cs:3-6`). It is the request record that keeps a platform notification type out of the shared contract, the same role [GeoPoint](#geopoint), [PickedMedia](#pickedmedia), and [PushDeviceToken](#pushdevicetoken) play for their capabilities.
- **Depends on**: nothing first-party; positional parameters of `int`, `string`, and `System.DateTimeOffset` only.
- **Concept introduced**: the **stable-id-as-idempotency-key** convention for on-device scheduling. The `Id` must be stable per logical subject (for example a hash of a session id) so that rescheduling replaces rather than duplicates the pending entry (`LocalNotificationRequest.cs:4-5`, `:7`). This is the local, offline analogue of the server-side idempotency key.
  - `[Rubric §9, API & Contract Design]` §9 assesses well-shaped contracts. This is a small, documented `sealed record` whose XML comments pin the meaning of every field (id stability, past-delivery being ignored, the optional deep-link route).
- **Walkthrough**: a single positional `sealed record` (`LocalNotificationRequest.cs:15-20`) with five members.
  - `Id` (`:16`): the stable platform notification id; scheduling the same id replaces the pending entry.
  - `Title` / `Body` (`:17-18`): already localized by the caller (the record does no i18n itself).
  - `DeliverAt` (`:19`): absolute delivery time; requests in the past are ignored.
  - `DeepLinkRoute` (`:20`): an optional app-relative route (for example `/conference/sessions/42`) published to [IDeepLinkDispatcher](#ideeplinkdispatcher) when the user taps the notification, wiring the reminder back into Blazor routing.
- **Why it's built this way**: a `record` gives value equality and immutability for free, and keeping it in the shared UI layer means the notification-scheduling contract never references a platform notification builder ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: the parameter of `ILocalNotificationService.ScheduleAsync` (`MMCA.Common.UI/Services/Capabilities/ILocalNotificationService.cs:22`); the MAUI implementation translates it into a native scheduled notification.
- **Caveats / not-in-source**: the record documents that past-dated requests are "ignored," but that enforcement lives in the platform implementation, not in this record. Not determinable from source here: which implementation drops them.

### PickedMedia

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:29` · Level 0 · class

- **What it is**: the framework-owned result of a photo pick or capture: a stream plus its file name and MIME type, returned by [IMediaPickerService](#imediapickerservice) (`IMediaPickerService.cs:21-28`).
- **Depends on**: nothing first-party; `System.IO.Stream` and `System.IDisposable`.
- **Concept introduced**: this is the one capability result in the layer that is deliberately a **class, not a record**, and the reason is a concrete AOT constraint worth knowing. A record's compiler-generated `IEquatable<T>` is a generic WinRT interface, which trips CsWinRT AOT generation (CsWinRT1030) on the windows TFM of `UI.Maui` (`IMediaPickerService.cs:22-25`). So where every other payload here is a `record`, this one is a `sealed class` with get-only properties to avoid that toolchain failure.
  - `[Rubric §15, Best Practices & Code Quality]` §15 assesses idiomatic, toolchain-aware code. The deviation from the record convention is documented in-place with the exact analyzer id, so the next reader does not "fix" it back into a record and break the MAUI windows build.
  - `[Rubric §12, Performance & Scalability]` §12 assesses resource handling. The type owns a `Stream` and implements `IDisposable`, so callers dispose after upload rather than holding image bytes open.
- **Walkthrough**: a primary-constructor `sealed class` implementing `IDisposable` (`IMediaPickerService.cs:29`).
  - `Content` (`:32`): the photo bytes, positioned at the start.
  - `FileName` (`:35`) and `ContentType` (`:38`): the original/generated file name and platform-reported MIME type.
  - `Dispose()` (`:41`): disposes the underlying stream.
- **Why it's built this way**: keeping the picked-photo shape as a framework type (not a MAUI `FileResult`) lets a shared avatar-upload component consume it identically on every head, while the class-over-record choice keeps the native windows AOT build green ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) for media picking, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) for the layer).
- **Where it's used**: the return type of `IMediaPickerService.PickPhotoAsync` / `CapturePhotoAsync` (`MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:15`, `:18`); shared avatar-upload UI consumes the stream and disposes it.

### PushDeviceToken

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IPushDeviceTokenProvider.cs:19` · Level 0 · record

- **What it is**: a platform push handle, the wire platform value plus the device token, returned by [IPushDeviceTokenProvider](#ipushdevicetokenprovider) (`IPushDeviceTokenProvider.cs:16-19`). It is the framework-owned value type that keeps FCM/APNs specifics out of the shared registration pipeline.
- **Depends on**: nothing first-party; two `string` positional parameters.
- **Concept introduced**: nothing new structurally; it is one more shared-UI value record like [GeoPoint](#geopoint) and [LocalNotificationRequest](#localnotificationrequest). Worth noting is the deliberately narrow wire vocabulary: `Platform` is documented as one of `fcmv1` or `apns` (`IPushDeviceTokenProvider.cs:17`), so the whole push path speaks two stable string values rather than a platform enum.
  - `[Rubric §9, API & Contract Design]` §9 assesses contract clarity. The record pins the two-field push handle shape and documents the exact platform token semantics per field.
- **Walkthrough**: a two-field `sealed record` (`IPushDeviceTokenProvider.cs:19`).
  - `Platform` (`:17`): the wire platform value (`fcmv1` or `apns`).
  - `Token` (`:18`): the FCM registration token or APNs device token.
- **Why it's built this way**: modeling the handle as a shared record means the registration pipeline ([IPushRegistrationService](#ipushregistrationservice) and the notification module) never references a Firebase or APNs type; the credentialed provider lives at the app edge ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) for native push).
- **Where it's used**: the return type of `IPushDeviceTokenProvider.GetTokenAsync` (`MMCA.Common.UI/Services/Capabilities/IPushDeviceTokenProvider.cs:13`); the push registration service forwards it to the backend.

### DeepLinkRouteEventArgs

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/DeepLinkRouteEventArgs.cs:4` · Level 1 · class

- **What it is**: the event payload carrying an app-relative route requested by a native navigation source (notification tap, home-screen action, app link, QR scan) (`DeepLinkRouteEventArgs.cs:3`). It is the argument type of the [IDeepLinkDispatcher](#ideeplinkdispatcher) `RouteRequested` event.
- **Depends on**: `System.EventArgs` (it derives from it, `DeepLinkRouteEventArgs.cs:4`); nothing first-party.
- **Concept introduced**: the classic .NET **`EventArgs`-derived payload** for a typed event. It is immutable by construction: a constructor sets the single `Route` property, which is get-only (`DeepLinkRouteEventArgs.cs:7`, `:10`).
  - `[Rubric §25, Navigation & IA]` §25 assesses coherent navigation. This type is the boundary object between native entry points and Blazor routing, carrying one thing (an app-relative route) so every native source funnels through the same shape.
- **Walkthrough**: a `sealed class : EventArgs` (`DeepLinkRouteEventArgs.cs:4`).
  - Constructor `DeepLinkRouteEventArgs(string route)` (`:7`): assigns the route.
  - `Route` (`:10`): the app-relative route to navigate to (for example `/happening-now`).
- **Why it's built this way**: a small dedicated `EventArgs` type keeps the dispatcher's event strongly typed and lets the listener component read the route without casting, part of the single-funnel deep-link design ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: raised through `IDeepLinkDispatcher.RouteRequested` (`MMCA.Common.UI/Services/Capabilities/IDeepLinkDispatcher.cs:13`) and constructed inside [DeepLinkDispatcher.Publish](#deeplinkdispatcher) (`DeepLinkDispatcher.cs:33`); consumed by the `DeepLinkListener` component in the shared layout.

### IGeocodingService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IGeocodingService.cs:9` · Level 1 · interface

- **What it is**: resolves a street address to coordinates for proximity hints such as "~3 km from the venue" (`IGeocodingService.cs:3-8`). It is the address-to-`GeoPoint` half of the location story; [IGeolocationService](#igeolocationservice) is the device-position half.
- **Depends on**: [GeoPoint](#geopoint) (its return shape); `System.Threading.CancellationToken` otherwise.
- **Concept introduced**: the **best-effort-by-contract** capability. Unsupported hosts and failed lookups both return `null` and callers simply omit the hint (`IGeocodingService.cs:5-7`), so a location feature never becomes a hard dependency on a platform geocoder. The doc comment also records a real domain fact: the model deliberately carries addresses only (no coordinates), so this service is the single place coordinates ever exist.
  - `[Rubric §29, Resilience & Business Continuity]` §29 assesses graceful degradation. The null-on-failure, hint-is-optional contract means a geocoder outage degrades to "no proximity hint," never to a broken page.
- **Walkthrough**: two members.
  - `IsSupported` (`IGeocodingService.cs:11`): whether the platform can geocode at all (web/null fallbacks report `false`).
  - `GeocodeAsync(string, CancellationToken)` (`IGeocodingService.cs:15`): returns the first coordinate match for the address, or `null`.
- **Why it's built this way**: geocoding is a native/optional concern, so it hides behind a `Shared`-only interface with a null default and a native override selected per host ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered with the `NullGeocodingService` default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:33`); consumed by venue-proximity UI.

### IGeolocationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IGeolocationService.cs:8` · Level 1 · interface

- **What it is**: a soft, one-shot device location read for the same proximity hints, the device-position sibling of [IGeocodingService](#igeocodingservice) (`IGeolocationService.cs:3-7`).
- **Depends on**: [GeoPoint](#geopoint) (its return shape); `System.Threading.CancellationToken`.
- **Concept introduced**: nothing new; it applies the same best-effort contract. Its distinct behavioral note is the **at-most-once permission prompt**: it returns the last-known position when fresh enough, otherwise a single current-position read, triggering the platform permission prompt at most once and returning `null` on denial, timeout, or any platform failure (`IGeolocationService.cs:13-18`).
  - `[Rubric §26, Front-End Security]` §26 assesses handling of sensitive capabilities. Location is permission-gated, prompted at most once, and never blocks a feature, so the app cannot nag or hard-depend on a sensitive grant.
- **Walkthrough**: two members.
  - `IsSupported` (`IGeolocationService.cs:10`): whether the platform can provide a location at all.
  - `GetCurrentOrLastKnownAsync(CancellationToken)` (`IGeolocationService.cs:18`): the fresh-last-known-or-single-read behavior described above.
- **Why it's built this way**: same per-host swappable design as its geocoding sibling; a `Shared`-only contract with a `NullGeolocationService` default ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered with the `NullGeolocationService` default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:32`); consumed alongside geocoding for proximity hints.

### ILocalNotificationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/ILocalNotificationService.cs:10` · Level 1 · interface

- **What it is**: schedules on-device notifications (session reminders) with no backend involvement (`ILocalNotificationService.cs:3-9`). It consumes [LocalNotificationRequest](#localnotificationrequest) and is a native-only capability.
- **Depends on**: [LocalNotificationRequest](#localnotificationrequest) (its schedule payload); `System.Threading.CancellationToken` and `IReadOnlyCollection<int>` otherwise.
- **Concept introduced**: the **own-the-permission-flow, never-throw-on-denial** discipline made explicit. Implementations own the platform permission flow (Android 13+ `POST_NOTIFICATIONS`, iOS notification authorization) and never throw on denial; scheduling simply becomes a no-op until permission is granted (`ILocalNotificationService.cs:6-9`, `:21`). This is distinct from the pure `IsSupported` gate: a supported platform can still be un-permissioned, and the contract makes that state safe.
  - `[Rubric §26, Front-End Security]` §26 assesses permission-gated features. Notification permission is requested explicitly and absence degrades to a silent no-op.
  - `[Rubric §24, Forms / Validation / UX Safety]` §24 assesses safe state transitions. Re-scheduling by stable id (replace, not duplicate) prevents notification spam from repeated schedules.
- **Walkthrough**: five members.
  - `IsSupported` (`ILocalNotificationService.cs:12`): whether this platform can schedule local notifications.
  - `RequestPermissionAsync(CancellationToken)` (`:19`): ensures permission, prompting if the platform requires consent and it is undecided, returning whether notifications are currently permitted.
  - `ScheduleAsync(LocalNotificationRequest, CancellationToken)` (`:22`): schedules (or replaces, by id) a pending notification; a no-op without permission.
  - `CancelAsync(IReadOnlyCollection<int>, CancellationToken)` (`:25`): cancels pending notifications by id; unknown ids are ignored.
  - `CancelAllAsync(CancellationToken)` (`:28`): cancels every pending notification scheduled by this app.
- **Why it's built this way**: on-device reminders need no server, so they are a pure native capability behind a `Shared`-only interface with a `NullLocalNotificationService` default for web/server heads ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered with the null default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:37`); the MAUI head implements real scheduling. The tapped-notification route flows into [IDeepLinkDispatcher](#ideeplinkdispatcher) via the request's `DeepLinkRoute`.

### IMediaPickerService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:9` · Level 1 · interface

- **What it is**: picks or captures a photo on native heads (avatar upload), returning [PickedMedia](#pickedmedia) or `null` (`IMediaPickerService.cs:3-8`). Implementations own the photo-library/camera permission flow and never throw.
- **Depends on**: [PickedMedia](#pickedmedia) (its result type); `System.Threading.CancellationToken`.
- **Concept introduced**: the clearest statement of the layer's **affordance switch, not degraded path** idea. Web heads keep the null default and render a plain `InputFile` instead, and the doc comment names this "the affordance switch, not a degraded path" (`IMediaPickerService.cs:6-7`): the browser does not attempt a broken native picker, it presents a different, working control.
  - `[Rubric §18, UI Architecture]` §18 assesses host-agnostic componentization. A shared avatar component branches on `IsSupported` between the native picker and `InputFile`, keeping one component tree across heads.
- **Walkthrough**: three members.
  - `IsSupported` (`IMediaPickerService.cs:12`): whether native photo picking is available on this head.
  - `PickPhotoAsync(CancellationToken)` (`:15`): opens the photo picker; returns `null` when cancelled or unavailable.
  - `CapturePhotoAsync(CancellationToken)` (`:18`): opens the camera; returns `null` when cancelled, denied, or unavailable.
- **Why it's built this way**: media pick is native-only, so it hides behind a `Shared`-only contract with a `NullMediaPickerService` default and a MAUI override ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) for media picking, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) for the layer).
- **Where it's used**: registered with the `NullMediaPickerService` default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:52`); consumed by the shared avatar-upload UI, which disposes the returned [PickedMedia](#pickedmedia) stream after upload.

### IPushDeviceTokenProvider

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IPushDeviceTokenProvider.cs:10` · Level 1 · interface

- **What it is**: supplies the platform push handle for this device, returning [PushDeviceToken](#pushdevicetoken) or `null` (`IPushDeviceTokenProvider.cs:3-9`). Apps plug in their credentialed implementation (Firebase messaging token on Android, APNs device token on iOS).
- **Depends on**: [PushDeviceToken](#pushdevicetoken) (its return shape); `System.Threading.CancellationToken`.
- **Concept introduced**: the **inert-until-credentialed** default. The out-of-box default returns `null`, which keeps the whole registration pipeline inert until real push credentials exist (`IPushDeviceTokenProvider.cs:6-9`). Even a native MAUI head stays "registered-but-tokenless" until the app supplies a credentialed provider, so no half-wired push path ships by accident.
  - `[Rubric §26, Front-End Security]` §26 assesses credential handling. Push credentials are an app-owned edge concern; the framework contract carries no keys and stays inert without them.
- **Walkthrough**: one member.
  - `GetTokenAsync(CancellationToken)` (`IPushDeviceTokenProvider.cs:13`): the current platform token, or `null` when unavailable; implementations request notification permission as needed and never throw.
- **Why it's built this way**: separating the token provider (app-owned, credentialed) from the registration service (framework-owned, [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) means the framework ships a complete push pipeline that stays dormant until an app drops in real FCM/APNs credentials.
- **Where it's used**: registered with the `NullPushDeviceTokenProvider` default (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:49`); the app overrides it once credentials exist, and [IPushRegistrationService](#ipushregistrationservice) forwards the token to the backend.

### IDeepLinkDispatcher

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IDeepLinkDispatcher.cs:10` · Level 2 · interface

- **What it is**: the single funnel between native navigation sources (notification taps, home-screen app actions, app links, QR scans) and Blazor routing (`IDeepLinkDispatcher.cs:3-9`). Native code publishes an app-relative route; the shared `DeepLinkListener` component either receives it live or drains it from a pending buffer after cold start.
- **Depends on**: [DeepLinkRouteEventArgs](#deeplinkrouteeventargs) (the event payload); `System.EventHandler<T>` otherwise.
- **Concept introduced**: the **live-event-or-buffered-cold-start** handoff, the interesting mechanic of the deep-link design. When a listener is attached the route is raised live via `RouteRequested`; when the app was cold-started by the tap (no listener yet), the route is buffered last-write-wins with capacity one for `TryConsumePending` to drain after first render (`IDeepLinkDispatcher.cs:5-9`, `:16-22`). One interface handles both the warm and cold navigation cases.
  - `[Rubric §25, Navigation & IA]` §25 assesses coherent, deep-linkable navigation. Every native entry point converges on this one contract, so routing behaves identically whether the app was already open or launched by the link.
  - `[Rubric §19, State Management]` §19 assesses where transient state lives. The pending route is a single-slot buffer owned by the dispatcher, a deliberately tiny piece of cross-render state rather than app-wide state.
- **Walkthrough**: three members.
  - `RouteRequested` (`IDeepLinkDispatcher.cs:13`): raised when a route is requested while a listener is attached; runs on the publisher's thread.
  - `Publish(string)` (`:19`): publishes a route request; with no listener attached the route is buffered (last-write-wins, capacity one).
  - `TryConsumePending(out string?)` (`:22`): atomically takes the buffered pending route, if any.
- **Why it's built this way**: cold-start taps arrive before Blazor has rendered a listener, so a buffer is required to avoid dropping the launch route; a single funnel keeps every native source consistent ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: implemented by [DeepLinkDispatcher](#deeplinkdispatcher) and consumed by the shared `DeepLinkListener` component; native publishers resolve it from the MAUI root service provider. [LocalNotificationRequest.DeepLinkRoute](#localnotificationrequest) feeds routes into it on notification tap.

### DeepLinkDispatcher

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/DeepLinkDispatcher.cs:9` · Level 3 · class

- **What it is**: the default [IDeepLinkDispatcher](#ideeplinkdispatcher): raises `RouteRequested` when a listener is attached, otherwise buffers the most recent route (capacity one) so a cold-start tap survives until the Blazor router renders (`DeepLinkDispatcher.cs:3-8`). Registered as a singleton so native callers resolve it from the MAUI root provider.
- **Depends on**: [IDeepLinkDispatcher](#ideeplinkdispatcher) (the contract it implements) and [DeepLinkRouteEventArgs](#deeplinkrouteeventargs) (what it raises); the BCL `System.Threading.Lock` type for its gate.
- **Concept introduced**: the **snapshot-then-branch race-safe event raise**, plus first use here of C# 13's `System.Threading.Lock`. `Publish` snapshots the `RouteRequested` handler into a local before checking it (`DeepLinkDispatcher.cs:22-23`), so a handler that detaches between the null check and the invoke cannot cause a torn call; if no handler is attached it stores the route under the lock (`:25-28`), otherwise it invokes the snapshot outside the lock (`:33`). The `_gate` field is a `Lock` instance (`DeepLinkDispatcher.cs:11`), the modern typed lock rather than locking on an `object`.
  - `[Rubric §19, State Management]` §19 assesses safe transient state. The single-slot `_pendingRoute` (`:12`) is read-and-cleared atomically under the lock in `TryConsumePending` (`:39-43`), so a buffered route is delivered exactly once.
  - `[Rubric §12, Performance & Scalability]` §12 assesses lock discipline. The handler is invoked outside the lock, keeping the critical section to a field assignment.
- **Walkthrough**: fields then methods.
  - `_gate` (`DeepLinkDispatcher.cs:11`) and `_pendingRoute` (`:12`): the `Lock` and the single-slot buffer.
  - `RouteRequested` event (`:15`): the implemented event.
  - `Publish(string)` (`:18-34`): validates the route with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:20`), snapshots the handler, buffers under the lock when there is no listener, else invokes with a new [DeepLinkRouteEventArgs](#deeplinkrouteeventargs).
  - `TryConsumePending(out string?)` (`:37-46`): takes and clears the pending route under the lock and returns whether one was present.
- **Why it's built this way**: native taps can arrive on any thread and either before or after the listener attaches, so the dispatcher must be both thread-safe and cold-start-safe; a singleton with a locked single-slot buffer is the minimal design that satisfies both ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered as the singleton `IDeepLinkDispatcher` in `AddDeviceCapabilityDefaults` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:60`); exercised by `DeepLinkDispatcherTests` and `DeepLinkListenerTests` (see [Group 27](group-27-testing-infrastructure.md#deeplinkdispatchertests)).

### DevicePreferenceKeys
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/DevicePreferenceKeys.cs:7` · Level 0 · class (static)

- **What it is**: a static constants holder for the string keys used with
  [`IDevicePreferences`](#idevicepreferences), so the framework's device-settings surfaces and the
  gates that read them agree on one spelling.
- **Depends on**: nothing first-party (the doc comment references [`IDevicePreferences`](#idevicepreferences)
  as the store these keys are used against, `DevicePreferenceKeys.cs:5`).
- **Concept introduced, per-device (non-roaming) preference keys.** `[Rubric §19, State Management]`
  assesses whether client state has a clear owner and scope; these keys are explicitly *device* state
  (they "describe THIS device and never roam", `DevicePreferenceKeys.cs:5`), distinct from the
  server-side per-user preferences that follow a signed-in account across devices. Centralizing the key
  strings is the small `[Rubric §16, Maintainability]` discipline that keeps a writer and a reader from
  drifting apart on a literal.
- **Walkthrough**: one member today: `AppLockEnabled = "applock.enabled"`
  (`DevicePreferenceKeys.cs:10`), whether the biometric app-lock guards stored-token auto-login. The
  doc comment ties it to the biometric app-lock feature ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4, `DevicePreferenceKeys.cs:9`).
- **Why it's built this way**: a `public const string` is compile-time inlined and usable in
  attribute/switch positions; a single owner for the key means the gate that reads it
  ([`IBiometricAuthenticator`](#ibiometricauthenticator) consumers) and the settings UI that writes it
  cannot disagree.
- **Where it's used**: read/written through [`IDevicePreferences`](#idevicepreferences) by the
  app-lock gate and device-settings screens in the head apps ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).

### GeoPoint
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/GeoPoint.cs:9` · Level 0 · record (sealed)

- **What it is**: a transport-agnostic latitude/longitude pair returned by
  [`IGeolocationService`](#igeolocationservice), with a helper to measure great-circle distance to
  another point.
- **Depends on**: BCL only (`System.Math`, `System.ArgumentNullException`).
- **Concept introduced, a platform-free geo primitive.** `[Rubric §18, UI Architecture]` assesses
  whether shared UI code stays decoupled from platform types; `GeoPoint` exists so shared components
  "never touch platform location types" (`GeoPoint.cs:5`), the MAUI `Location` / browser Geolocation
  result is mapped into this record at the adapter boundary. Being a `record` gives it value equality
  and immutability for free (the Value Object idea, see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), though it lives in the UI
  layer rather than the domain.
- **Walkthrough**
  - Positional parameters `Latitude`/`Longitude` in decimal degrees (`GeoPoint.cs:9`, documented at
    `GeoPoint.cs:7-8`).
  - `EarthRadiusKm = 6371.0` (`GeoPoint.cs:11`): the mean Earth radius constant the distance formula
    uses.
  - `DistanceKmTo(GeoPoint other)` (`GeoPoint.cs:17`): null-guards `other` with
    `ArgumentNullException.ThrowIfNull` (`GeoPoint.cs:19`), then computes the haversine great-circle
    distance in kilometers (`GeoPoint.cs:21-28`). The doc comment scopes it honestly: good enough for
    "how far is the venue" hints, not for navigation (`GeoPoint.cs:15`).
  - `ToRadians(double degrees)` (`GeoPoint.cs:31`): a private static degree-to-radian conversion, an
    expression-bodied member.
- **Why it's built this way**: keeping the math on the value type (rather than in a service) means any
  caller holding two points can compute a distance without a service dependency; the sealed record
  keeps it cheap and comparable.
- **Where it's used**: produced by [`IGeolocationService`](#igeolocationservice) implementations
  ([`MauiGeolocationService`](#mauigeolocationservice), [`NullGeolocationService`](#nullgeolocationservice))
  and consumed by proximity hints in the head apps.

### IAccessibilityAnnouncer
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IAccessibilityAnnouncer.cs:9` · Level 0 · interface

- **What it is**: a one-method contract that pushes a spoken announcement to the platform screen
  reader for events a sighted user perceives only visually (a live poll opening, a question being
  answered, the unread badge incrementing).
- **Depends on**: BCL only (`System.Threading.Tasks`, `System.Threading.CancellationToken`).
- **Concept introduced, the per-capability contract with per-host adapters.** This whole group is a
  family of narrow interfaces in `MMCA.Common.UI`, each wrapping one device capability so shared Blazor
  components can call it uniformly while three implementations (MAUI-native, browser-JS-interop, and an
  inert fallback) are chosen per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). `[Rubric §1, SOLID]` (interface
  segregation and dependency inversion: components depend on the tiny abstraction, never a platform SDK)
  and `[Rubric §2, Design Patterns]` (this is the Strategy/adapter plus Null-Object pairing repeated across
  the group). `[Rubric §21, Accessibility]` assesses whether non-visual users get equivalent information;
  this contract routes to MAUI `SemanticScreenReader` on native and an `aria-live` region in browsers
  (`IAccessibilityAnnouncer.cs:4-7`), and is a deliberate silent no-op when no assistive technology is
  active (`IAccessibilityAnnouncer.cs:7`).
- **Walkthrough**: `AnnounceAsync(string message, CancellationToken = default)`
  (`IAccessibilityAnnouncer.cs:12`): announces politely, that is, without interrupting speech already in
  progress (`IAccessibilityAnnouncer.cs:11`).
- **Why it's built this way**: a spoken-announcement need has no cross-platform BCL surface, so the
  capability is inverted behind an interface and satisfied by whichever adapter the host registers; the
  fallback keeps call sites unconditional (they never branch on "is a screen reader present").
- **Where it's used**: implemented by [`MauiAccessibilityAnnouncer`](#mauiaccessibilityannouncer),
  [`BrowserAccessibilityAnnouncer`](#browseraccessibilityannouncer), and the inert
  [`NullAccessibilityAnnouncer`](#nullaccessibilityannouncer); registered via
  [`DependencyInjection`](#dependencyinjection). Called by live-update components in the head apps.

### IBarcodeScannerService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IBarcodeScannerService.cs:11` · Level 0 · interface

- **What it is**: opens the device camera to scan a QR code or barcode and hands back the first decoded
  payload, or `null` when the scan did not produce one.
- **Depends on**: BCL only (`System.Threading.Tasks`, `System.Threading.CancellationToken`).
- **Concept introduced, the affordance switch (as opposed to a degraded path).** Most contracts in this
  group have a plausible web story, so their browser adapter does a lesser version of the same thing.
  Camera scanning has none: there is no browser primitive the framework wraps, so web heads keep the
  inert default and the UI *hides the scan button entirely* rather than offering a control that cannot
  work. The doc comment names this distinction explicitly, "the affordance switch, not a degraded path"
  (`IBarcodeScannerService.cs:6-9`), and `IsSupported` is the switch components read.
  - `[Rubric §18, UI Architecture]` assesses whether shared components can serve several hosts without
    branching on host type; a capability boolean plus a hidden affordance is that branch expressed as
    data instead of `#if` or host sniffing.
  - `[Rubric §26, Front-End Security]` assesses how untrusted client-side input is handled. The contract
    states the rule in the contract itself: "the scanned payload is untrusted input: validate it before
    acting on it" (`IBarcodeScannerService.cs:9`). A camera can decode any code that is pointed at it,
    so the decoded string is attacker-supplied by construction.
  - `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation. The implementations
    "never throw": a denied camera permission, a cancelled scan, an unsupported head, and a cancelled
    token all collapse to one `null` (`IBarcodeScannerService.cs:4-7`), so the caller has exactly one
    failure shape to handle.
- **Walkthrough**
  - `IsSupported` (`IBarcodeScannerService.cs:14`): whether camera scanning is available on this head.
    False on web heads and on any native head that did not opt in (see below).
  - `ScanAsync(CancellationToken = default)` (`IBarcodeScannerService.cs:20`): opens the camera scanner
    and returns the first decoded payload, or `null` when cancelled, denied, or unavailable
    (`IBarcodeScannerService.cs:16-19`). One call, one payload: the contract is a modal "scan one thing"
    operation, not a continuous decode stream, which is what keeps it expressible as a plain `Task`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) puts every device capability behind an interface, and the
  registration for this one is doubly conservative. The framework default is the inert
  [`NullBarcodeScannerService`](#nullbarcodescannerservice), registered with `TryAddSingleton`
  (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:57`), and the comment above it records
  that even a MAUI head keeps that default "until it asks for the camera"
  (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:54-56`). The native adapter arrives only
  through the opt-in `UseCommonBarcodeScanner(...)` builder extension
  (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:92-103`), which registers the ZXing.Net.MAUI
  handlers and overrides the registration with [`MauiBarcodeScannerService`](#mauibarcodescannerservice)
  (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:99-101`). It is deliberately *not* folded into
  `UseMauiDeviceCapabilities` so that "a head that never scans should ship neither the camera handler nor
  a camera permission declaration" (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:76-77`), a
  privacy and store-review consideration as much as a size one. The opt-in also takes the scan page's
  cancel and camera-description text, with a `Func<string>` overload
  (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:92-94`) for heads that let the user switch
  language after startup (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:59-62`).
- **Where it's used**: implemented by [`MauiBarcodeScannerService`](#mauibarcodescannerservice) (which
  drives [`BarcodeScanPage`](#barcodescanpage)) and the inert
  [`NullBarcodeScannerService`](#nullbarcodescannerservice); consumed by ADC's QR check-in scan page
  ([`CheckInScan`](group-22-engagement-module.md#checkinscan)).

### IBatteryStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IBatteryStatusService.cs:8` · Level 0 · interface

- **What it is**: exposes the platform energy-saver state (plus a change event) so live features can
  throttle themselves on a draining battery.
- **Depends on**: BCL only (`System.EventHandler`).
- **Concept, the property plus change-event capability shape.** This is the first of several
  read-a-state, react-to-changes contracts (compare [`IConnectivityStatusService`](#iconnectivitystatusservice)):
  a bool property plus an `EventHandler` that fires after it changes, handlers re-read the property.
  `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance]` assess whether the
  client adapts work to device constraints; here a component can drop a SignalR channel auto-join when
  the OS reports low-power mode (`IBatteryStatusService.cs:4-5`). Web and null fallbacks always report
  `false` and never raise the event (`IBatteryStatusService.cs:5-6`), so a non-native head simply
  behaves as "never energy-saving".
- **Walkthrough**
  - `EnergySaverChanged` (`IBatteryStatusService.cs:11`): raised after `IsEnergySaverOn` changes;
    handlers read the new value from the property rather than from event args (`IBatteryStatusService.cs:10`).
  - `IsEnergySaverOn` (`IBatteryStatusService.cs:14`): whether OS energy saver / low-power mode is
    active right now.
- **Why it's built this way**: the property-plus-event shape lets a component both read the current
  state on render and subscribe for later transitions without polling; the always-false fallback keeps
  the throttling logic branch-free on non-native heads.
- **Where it's used**: implemented by [`MauiBatteryStatusService`](#mauibatterystatusservice) and the
  fallback [`NullBatteryStatusService`](#nullbatterystatusservice); consumed by live/real-time
  components deciding whether to auto-join channels.

### IBiometricAuthenticator
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IBiometricAuthenticator.cs:9` · Level 0 · interface

- **What it is**: prompts for platform biometric or device-credential authentication (fingerprint,
  Face ID, Windows Hello) to gate stored-token auto-login behind an opt-in app lock.
- **Depends on**: BCL only.
- **Concept introduced, fail-closed boolean auth gating.** `[Rubric §11, Security]` and `[Rubric §26,
  Front-End Security]` assess whether client-side auth degrades safely. The contract is deliberately
  all-booleans (`IBiometricAuthenticator.cs:5-7`): availability and outcome are both `bool` so that on
  *any* failure the caller falls back to the normal credential login, never to a weaker path. The
  app-lock gated by this service is toggled through
  [`DevicePreferenceKeys.AppLockEnabled`](#devicepreferencekeys) ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4).
- **Walkthrough**
  - `IsAvailableAsync(CancellationToken = default)` (`IBiometricAuthenticator.cs:12`): whether a
    biometric or device-credential prompt can be presented right now.
  - `AuthenticateAsync(string reason, CancellationToken = default)` (`IBiometricAuthenticator.cs:19`):
    shows the platform prompt with a localized `reason` (`IBiometricAuthenticator.cs:15`); returns
    `true` only on positive verification, and cancellation, lockout, and errors all collapse to `false`
    (`IBiometricAuthenticator.cs:16-17`).
- **Why it's built this way**: folding cancellation/lockout/error into a single `false` keeps the call
  site's decision binary (verified or not) and forbids a partial-success path; the localized `reason`
  is required because the platform surfaces it in the system prompt.
- **Where it's used**: implemented by [`MauiBiometricAuthenticator`](#mauibiometricauthenticator) and
  the inert [`NullBiometricAuthenticator`](#nullbiometricauthenticator); consumed by the auto-login
  app-lock gate, and faked in component tests by
  [`FakeBiometricAuthenticator`](group-27-testing-infrastructure.md#fakebiometricauthenticator).
- **Caveats / not-in-source**: the actual token store and auto-login flow live in the head apps and
  the Identity layer; this contract only decides "is the user present".

### IClipboardService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IClipboardService.cs:7` · Level 0 · interface

- **What it is**: writes text to the system clipboard, returning success so a caller can confirm with
  a snackbar.
- **Depends on**: BCL only.
- **Concept, best-effort capability with a success return.** `[Rubric §18, UI Architecture]`. A single
  method wraps MAUI `Clipboard.Default` and browser `navigator.clipboard` (`IClipboardService.cs:4-5`);
  returning `bool` (rather than `void`) lets the UI acknowledge only when the write actually landed,
  which matters because browser clipboard writes can be denied by permission.
- **Walkthrough**: `SetTextAsync(string text, CancellationToken = default)` (`IClipboardService.cs:10`):
  copies `text`, returns whether the write succeeded.
- **Why it's built this way**: the boolean result is the fallback signal for [`IShareService`](#ishareservice)
  callers: when a native share sheet is unavailable, they copy the link instead and confirm from this
  return.
- **Where it's used**: implemented by [`MauiClipboardService`](#mauiclipboardservice),
  [`BrowserClipboardService`](#browserclipboardservice), and [`NullClipboardService`](#nullclipboardservice);
  the copy-link fallback path of [`IShareService`](#ishareservice).

### IConnectivityStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IConnectivityStatusService.cs:10` · Level 0 · interface

- **What it is**: reports whether the device currently has network access (with a change event and an
  explicit initialize step), so shared components can show an offline banner and skip doomed API calls.
- **Depends on**: BCL only (`System.EventHandler`, `System.Threading.Tasks.ValueTask`).
- **Concept, offline-awareness at the UI edge.** `[Rubric §29, Resilience & Business Continuity]`
  assesses graceful degradation; this contract lets the UI stay usable offline rather than hang on dead
  requests. The doc comment records the three host behaviors (`IConnectivityStatusService.cs:4-8`): MAUI
  wraps `Connectivity.Current`, WebAssembly watches `navigator.onLine`, and Blazor Server is always
  online (a dead circuit takes the whole UI down and the reconnect overlay already covers it). Extends
  the property-plus-event shape of [`IBatteryStatusService`](#ibatterystatusservice) with an
  `InitializeAsync` because the browser adapter needs explicit JS listener setup.
- **Walkthrough**
  - `ConnectivityChanged` (`IConnectivityStatusService.cs:13`): raised after `IsOnline` changes; handlers
    read the new value from the property (`IConnectivityStatusService.cs:12`).
  - `IsOnline` (`IConnectivityStatusService.cs:16`): defaults to `true` until known
    (`IConnectivityStatusService.cs:15`), so the UI starts optimistic rather than flashing an offline
    banner on first render.
  - `InitializeAsync(CancellationToken = default)` (`IConnectivityStatusService.cs:22`): starts change
    monitoring where that needs explicit setup (browser JS listeners); called from `OnAfterRenderAsync`,
    a no-op and safe to call repeatedly on every implementation (`IConnectivityStatusService.cs:19-20`).
- **Why it's built this way**: `ValueTask InitializeAsync` keeps the always-ready implementations
  allocation-free while giving the browser adapter a place to attach listeners after the first render
  (JS interop is unavailable during prerender).
- **Where it's used**: implemented by [`MauiConnectivityStatusService`](#mauiconnectivitystatusservice),
  [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice), and the Server default
  [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice); consumed by the
  offline banner and request-skipping guards, and faked in component tests by
  [`FakeConnectivityService`](group-27-testing-infrastructure.md#fakeconnectivityservice).

### IDevicePreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:11` · Level 0 · interface

- **What it is**: a small typed key/value store for per-device settings (reminder lead time, haptics
  toggle, app-lock), distinct from the server-side per-user preferences that roam with an account.
- **Depends on**: BCL only; keys come from [`DevicePreferenceKeys`](#devicepreferencekeys).
- **Concept introduced, device-scoped client state.** `[Rubric §19, State Management]` assesses whether
  state has a clear owner and lifetime. Device preferences "describe THIS device and never roam"
  (`IDevicePreferences.cs:5-6`), the counterpart to the server-side `IUserPreferenceWriter` (culture,
  theme). The doc comment sets two hard rules: never store secrets here, tokens belong in platform
  secure storage (`IDevicePreferences.cs:7`), and the supported value types are exactly `string`,
  `bool`, `int`, `long`, `double`, `DateTimeOffset` (`IDevicePreferences.cs:8-9`).
  `[Rubric §26, Front-End Security]`: the secrets prohibition keeps sensitive material off unencrypted
  preference storage.
- **Walkthrough**
  - `IsPersistent` (`IDevicePreferences.cs:17`): whether values survive an app restart; the Blazor
    Server fallback is in-memory only (`false`) and hosts hide device-settings UI when it is not
    persistent (`IDevicePreferences.cs:14-15`).
  - `GetAsync<T>(string key, T fallback, CancellationToken = default)` (`IDevicePreferences.cs:21`):
    reads a value, returning `fallback` when absent or unreadable (`IDevicePreferences.cs:19`).
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`IDevicePreferences.cs:25`):
    best-effort write, storage failures are swallowed (`IDevicePreferences.cs:23`).
  - `RemoveAsync(string key, CancellationToken = default)` (`IDevicePreferences.cs:28`): removes a
    value; unknown keys are ignored (`IDevicePreferences.cs:27`).
- **Why it's built this way**: the `IsPersistent` flag lets a host decide whether to even show
  device-settings UI (pointless when settings would evaporate on reload), and the swallow-on-failure
  writes keep a cosmetic preference from ever throwing into a render path.
- **Where it's used**: implemented by [`MauiDevicePreferences`](#mauidevicepreferences),
  [`BrowserDevicePreferences`](#browserdevicepreferences), and the in-memory Server default
  [`InMemoryDevicePreferences`](#inmemorydevicepreferences); read/written by device-settings screens and
  the app-lock gate, and faked in component tests by
  [`FakeDevicePreferences`](group-27-testing-infrastructure.md#fakedevicepreferences).

### IExternalAuthBroker
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IExternalAuthBroker.cs:10` · Level 0 · interface

- **What it is**: runs an external OAuth sign-in (Google/GitHub) through the platform's system-browser
  authenticator instead of a web redirect, because the identity providers reject embedded WebViews.
- **Depends on**: BCL only.
- **Concept, native OAuth callback capture.** `[Rubric §11, Security]` and `[Rubric §26, Front-End
  Security]`. The default broker is unavailable, which preserves the existing anchor-href redirect flow
  on web heads; the MAUI implementation drives `WebAuthenticator` against the API's OAuth endpoints and
  stores the resulting token pair (`IExternalAuthBroker.cs:4-8`). This is the client half of the native
  deep-link OAuth callback design ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)): the server redirects a single-use completion code to an
  allow-listed custom scheme so `WebAuthenticator` can capture it (never tokens over the wire).
- **Walkthrough**
  - `IsAvailable` (`IExternalAuthBroker.cs:13`): whether a native brokered sign-in exists on this host
    (false on web heads).
  - `SignInAsync(string provider, CancellationToken = default)` (`IExternalAuthBroker.cs:20`): runs the
    full brokered flow for a provider (`google`, `github`): system-browser challenge, callback capture,
    code exchange, token storage; returns whether the user ended up authenticated
    (`IExternalAuthBroker.cs:16-18`).
- **Why it's built this way**: an unavailable default means a component can attempt native brokering
  and cleanly fall back to the web anchor flow when `IsAvailable` is false, so one login page serves
  every head ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).
- **Where it's used**: implemented by [`MauiExternalAuthBroker`](#mauiexternalauthbroker) (native) and
  the fallback [`UnavailableExternalAuthBroker`](#unavailableexternalauthbroker); consumed by the login
  page's external-provider buttons.

### IExternalLinkService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IExternalLinkService.cs:9` · Level 0 · interface

- **What it is**: opens URLs outside the current UI surface (a new browser tab, or the system browser
  from inside a BlazorWebView).
- **Depends on**: BCL only (`System.Uri`).
- **Concept, the WebView dead-link workaround.** `[Rubric §18, UI Architecture]` and `[Rubric §25,
  Navigation & IA]`. A raw `target="_blank"` silently dead-ends inside a WKWebView, so shared components
  must route external links through this service (via the `ExternalLink` component) rather than raw
  anchor targets (`IExternalLinkService.cs:4-7`). The `InterceptsLinks` flag lets the component pick the
  cheapest correct rendering per host.
- **Walkthrough**
  - `InterceptsLinks` (`IExternalLinkService.cs:16`): whether links must be intercepted and opened via
    `OpenAsync` (`true` in native WebView hosts); when `false`, components may render a plain anchor with
    `target="_blank"` (`IExternalLinkService.cs:12-14`).
  - `OpenAsync(Uri uri, CancellationToken = default)` (`IExternalLinkService.cs:19`): opens the URI in
    the system browser or a new tab, best-effort (`IExternalLinkService.cs:18`).
- **Why it's built this way**: exposing `InterceptsLinks` means the browser head keeps native anchor
  semantics (middle-click, open-in-new-tab) while only WebView heads pay the interop cost ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: implemented by [`MauiExternalLinkService`](#mauiexternallinkservice),
  [`BrowserExternalLinkService`](#browserexternallinkservice), and [`NullExternalLinkService`](#nullexternallinkservice);
  consumed by the `ExternalLink` component (its fake counterpart
  [`FakeExternalLinkService`](group-27-testing-infrastructure.md#fakeexternallinkservice) backs the
  component tests) and composed over by [`BrowserMapNavigationService`](#browsermapnavigationservice).

### IHapticFeedbackService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IHapticFeedbackService.cs:8` · Level 0 · interface

- **What it is**: fires tactile feedback on interactions (bookmark toggles, poll votes). Native-only:
  the web fallback is a hidden no-op.
- **Depends on**: BCL only (`System.TimeSpan`).
- **Concept, decoration-not-behavior capability.** `[Rubric §18, UI Architecture]`. The methods are
  fire-and-forget `void` (not `Task`) and failures are swallowed because "haptics are decoration, never
  behavior" (`IHapticFeedbackService.cs:6`), so a missing or throwing vibrator can never affect what
  the app does. `IsSupported` is `false` on the web fallback (`IHapticFeedbackService.cs:4-5`).
- **Walkthrough**
  - `IsSupported` (`IHapticFeedbackService.cs:11`): whether the platform can produce haptics.
  - `Click()` (`IHapticFeedbackService.cs:14`): short feedback for taps and toggles.
  - `LongPress()` (`IHapticFeedbackService.cs:17`): stronger feedback for long-press interactions.
  - `Vibrate(TimeSpan duration)` (`IHapticFeedbackService.cs:20`): raw vibration for attention-level
    cues (for example a notification arriving while the app is foregrounded).
- **Why it's built this way**: synchronous `void` matches the fire-and-forget nature of a UI micro-cue
  (no caller waits on a buzz), and the swallow-failures rule keeps a decorative effect out of the
  correctness path.
- **Where it's used**: implemented by [`MauiHapticFeedbackService`](#mauihapticfeedbackservice) and the
  no-op [`NullHapticFeedbackService`](#nullhapticfeedbackservice); consumed by interactive components.

### ILocalCacheStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/ILocalCacheStore.cs:9` · Level 0 · interface

- **What it is**: a small on-device JSON document cache for offline UI state (an offline schedule
  snapshot), explicitly not a query cache and not for secrets.
- **Depends on**: BCL only (generic serialization happens in the implementations).
- **Concept, last-known-good UI state for offline rendering.** `[Rubric §29, Resilience & Business
  Continuity]` and `[Rubric §19, State Management]`. MAUI persists to the app data directory,
  WebAssembly to `localStorage`, and the Blazor Server fallback is unavailable (SSR always has the live
  API) (`ILocalCacheStore.cs:4-6`). The doc comment draws the boundary sharply: this is
  last-known-good UI state for offline rendering, not a general query cache and not a secret store
  (`ILocalCacheStore.cs:6-7`).
- **Walkthrough**
  - `IsAvailable` (`ILocalCacheStore.cs:12`): whether cached values survive restarts on this host.
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`ILocalCacheStore.cs:16`):
    serializes and stores a JSON-serializable document, best-effort (`ILocalCacheStore.cs:14-15`).
  - `GetAsync<T>(string key, CancellationToken = default)` (`ILocalCacheStore.cs:20`): reads and
    deserializes, or returns `default` (`ILocalCacheStore.cs:18`).
  - `RemoveAsync(string key, CancellationToken = default)` (`ILocalCacheStore.cs:23`): removes an entry;
    unknown keys are ignored (`ILocalCacheStore.cs:22`).
- **Why it's built this way**: a generic serialize/deserialize contract keeps callers from touching
  platform storage APIs, and `IsAvailable` lets a component skip offline-snapshot writes entirely on the
  Server head where they would be pointless.
- **Where it's used**: implemented by [`MauiLocalCacheStore`](#mauilocalcachestore),
  [`BrowserLocalCacheStore`](#browserlocalcachestore), and the unavailable
  [`NullLocalCacheStore`](#nulllocalcachestore); consumed by offline-schedule components.

### IMapNavigationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IMapNavigationService.cs:8` · Level 0 · interface

- **What it is**: opens the platform maps experience for a street address (native maps app on MAUI, a
  maps website in a new tab in browsers).
- **Depends on**: BCL only.
- **Concept, address-only navigation.** `[Rubric §18, UI Architecture]`. Deliberately address-based, not
  coordinate-based, because the domain model carries no geo-coordinates (`IMapNavigationService.cs:4-6`).
  That keeps the capability aligned with what the data actually holds.
- **Walkthrough**: `OpenAddressAsync(string address, string? label, CancellationToken = default)`
  (`IMapNavigationService.cs:14`): opens maps pointed at `address`, labeled `label` where the platform
  supports it; returns whether a maps UI was opened (`IMapNavigationService.cs:11-12`).
- **Why it's built this way**: returning a `bool` lets a "Directions" affordance stay hidden or degrade
  when no maps UI opened; taking a string address (not a [`GeoPoint`](#geopoint)) matches the
  address-shaped domain data and avoids a geocoding round-trip.
- **Where it's used**: implemented by [`MauiMapNavigationService`](#mauimapnavigationservice),
  [`BrowserMapNavigationService`](#browsermapnavigationservice), and [`NullMapNavigationService`](#nullmapnavigationservice);
  consumed by venue/location components.

### IPushRegistrationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IPushRegistrationService.cs:10` · Level 0 · interface

- **What it is**: client-side orchestration of native push device registration: obtains the platform
  token from [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) and syncs it to the server's
  Devices endpoint.
- **Depends on**: [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) (named by the doc comment as
  the token source the implementations wrap, `IPushRegistrationService.cs:4-5`).
- **Concept, native push registration lifecycle.** `[Rubric §6, CQRS & Event-Driven]` (the push channel
  is a delivery leg for notifications) and `[Rubric §18, UI Architecture]`. This is the client leg of
  native push delivery ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): hosts call `RegisterAsync` after sign-in and on resume, and
  `UnregisterAsync` *before* sign-out clears the tokens, because the delete call is authenticated
  (`IPushRegistrationService.cs:6-8`). The default implementation is a no-op on web heads
  (`IPushRegistrationService.cs:8`).
- **Walkthrough**
  - `IsSupported` (`IPushRegistrationService.cs:13`): whether this head can register for native push at
    all (native heads only).
  - `RegisterAsync(CancellationToken = default)` (`IPushRegistrationService.cs:20`): registers or
    refreshes this device's installation; best-effort and safe to call repeatedly; returns `false` when
    no platform token is available (unsupported head, missing credentials, permission denied) or the
    sync failed (`IPushRegistrationService.cs:16-18`).
  - `UnregisterAsync(CancellationToken = default)` (`IPushRegistrationService.cs:23`): removes the
    installation, best-effort, called while still authenticated (`IPushRegistrationService.cs:22`).
- **Why it's built this way**: ordering `UnregisterAsync` before token clearing is load-bearing: the
  server delete call is authenticated, so it must run while the credentials still exist; the
  idempotent, safe-to-repeat `RegisterAsync` tolerates the resume-driven re-calls ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Where it's used**: implemented by [`MauiPushRegistrationService`](#mauipushregistrationservice)
  (over [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider)) and the no-op
  [`NullPushRegistrationService`](#nullpushregistrationservice); driven by the head apps' sign-in and
  sign-out lifecycle and syncing to the server's Devices endpoint ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).

### IScreenshotService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IScreenshotService.cs:8` · Level 0 · interface

- **What it is**: captures the current app screen to a temporary image file, for pairing with a share
  action ("share my schedule as image").
- **Depends on**: BCL only; pairs with [`IShareService.ShareFileAsync`](#ishareservice), which the doc
  comment names directly (`IScreenshotService.cs:5`).
- **Concept, permissionless temp-file capture.** `[Rubric §26, Front-End Security]` and `[Rubric §30,
  Compliance/Privacy/Data Governance]`. Captured files land in the platform cache directory, never the
  photo library, so no storage permissions are needed (`IScreenshotService.cs:5-6`), a deliberate
  minimization that avoids prompting for (and holding) a broad permission for a one-off share.
- **Walkthrough**
  - `IsSupported` (`IScreenshotService.cs:11`): whether screen capture is available (web and null
    fallbacks report `false`).
  - `CaptureToFileAsync(CancellationToken = default)` (`IScreenshotService.cs:14`): captures the screen
    to a temp PNG and returns its path, or `null` on failure.
- **Why it's built this way**: writing to the cache directory (not the gallery) keeps the feature
  permission-free; returning a nullable path lets the share flow abort quietly when capture is
  unsupported or fails.
- **Where it's used**: implemented by [`MauiScreenshotService`](#mauiscreenshotservice) and the
  unsupported [`NullScreenshotService`](#nullscreenshotservice); its output is handed to
  [`IShareService.ShareFileAsync`](#ishareservice).

### MauiTextToSpeechService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiTextToSpeechService.cs:12` · Level 1 · class (sealed partial, `IDisposable`)

- **What it is**: the MAUI adapter for [`ITextToSpeechService`](#itexttospeechservice), speaking text over `TextToSpeech.Default` with locale matching and a cancellable in-flight utterance.
- **Depends on**: [`ITextToSpeechService`](#itexttospeechservice); MAUI Essentials `TextToSpeech`/`SpeechOptions`/`Locale`; BCL `Lock`, `CancellationTokenSource`, `CultureInfo`.
- **Concept**: single-utterance serialization plus best-effort locale selection. `[Rubric §21, Accessibility]` and `[Rubric §27, i18n]`: read-aloud is an assistive output, and the adapter picks a voice for the current UI culture, falling back to the platform default so a device without an `es` voice still speaks rather than throws.
- **Walkthrough**
  - `_gate` (`MauiTextToSpeechService.cs:14`, a `Lock`) and `_activeUtterance` (`:15`, a nullable `CancellationTokenSource`) track the one in-flight utterance.
  - `IsSupported` (`MauiTextToSpeechService.cs:18`): `true`.
  - `SpeakAsync(string text, CancellationToken = default)` (`MauiTextToSpeechService.cs:21`): guards `text`, calls `StopAsync` first so a new utterance preempts the previous (`:25`), links a fresh CTS to the caller's token and stores it under the lock (`:27-31`), then speaks with `SpeechOptions` whose `Locale` comes from `MatchLocaleAsync(CultureInfo.CurrentUICulture)` (`:35-39`). `OperationCanceledException` is expected and swallowed (`:41-44`); the `finally` clears `_activeUtterance` only if it is still this utterance and disposes the CTS (`:46-56`).
  - `StopAsync()` (`MauiTextToSpeechService.cs:60`): reads the active CTS under the lock, returns if none, else `CancelAsync`, swallowing `ObjectDisposedException` when the utterance completed concurrently (`:73-80`).
  - `Dispose()` (`MauiTextToSpeechService.cs:84`): disposes and clears any active CTS under the lock.
  - `MatchLocaleAsync(CultureInfo culture)` (`MauiTextToSpeechService.cs:93`): fetches installed locales and returns the first whose `Language` matches the culture's two-letter code, or `null` (the platform default) on no match or `FeatureNotSupportedException`.
- **Why it's built this way**: MAUI exposes no stop API, so `StopAsync` cancels the in-flight utterance's token instead; the `Lock`-guarded single-utterance state keeps overlapping `SpeakAsync` calls from talking over each other; returning `null` from locale matching lets the platform choose a voice rather than failing.
- **Where it's used**: registered for native heads; the fallback is [`NullTextToSpeechService`](#nulltexttospeechservice). Consumed by read-aloud affordances.

### MauiExternalAuthBroker
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:19` · Level 2 · class (sealed)

- **What it is**: the MAUI adapter for [`IExternalAuthBroker`](#iexternalauthbroker) ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)), running an external OAuth sign-in through the platform `WebAuthenticator` in the system browser and handing the captured completion code to the shared `/auth/oauth-complete` page.
- **Depends on**: [`IExternalAuthBroker`](#iexternalauthbroker); `NavigationManager`, `IOptions<ApiSettings>` (`ApiSettings` in `MMCA.Common.UI.Common.Settings`), `IConfiguration`; MAUI Essentials `WebAuthenticator`. This is the only Level 2 type in the unit because it composes over app configuration and navigation rather than a single platform static.
- **Concept**: native OAuth callback capture (introduced by [`IExternalAuthBroker`](#iexternalauthbroker)). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]`: identity providers reject embedded WebViews, so the flow runs in the system browser and a single-use code (never tokens) returns over a custom scheme; the shared completion page owns the exchange and token storage, keeping the sensitive step in exactly one place ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).
- **Walkthrough**
  - The constructor (`MauiExternalAuthBroker.cs:26`) null-guards `configuration`, stores `NavigationManager` and `IOptions<ApiSettings>`, and reads the callback scheme from `configuration["OAuth:MobileRedirectScheme"]` (`:35`).
  - `IsAvailable` (`MauiExternalAuthBroker.cs:39`): `true` only when the callback scheme is configured, so an unconfigured head keeps the web anchor flow.
  - `SignInAsync(string provider, CancellationToken = default)` (`MauiExternalAuthBroker.cs:42`): guards `provider`; returns `false` when unavailable (`:46-49`) or when the API base URL is missing (`:51-55`); builds `{scheme}://oauth-complete` as the callback and `{apiBase}/auth/oauth/{provider}?returnUrl=...` as the authorize URL (`:57-59`); calls `WebAuthenticator.Default.AuthenticateAsync` with those URLs (`:63-69`); returns `false` if no `code` property comes back (`:71-76`); otherwise navigates to `/auth/oauth-complete?code=...` and returns `true` (`:80-81`). `TaskCanceledException` (the user dismissed the browser) and `FeatureNotSupportedException` both return `false` (`:83-91`).
- **Why it's built this way**: an unavailable default when the scheme is unset lets a single login page attempt native brokering and cleanly fall back to the web anchor flow; delegating the code-to-token exchange to the existing `/auth/oauth-complete` page means the single-use-code contract, token storage, and auth-state refresh live in one place across all heads ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).
- **Where it's used**: registered for native heads; the fallback is [`UnavailableExternalAuthBroker`](#unavailableexternalauthbroker). Consumed by the login page's external-provider buttons.
- **Caveats / not-in-source**: the code-to-token exchange, token storage, and auth-state refresh are not in this class; they live in the shared `/auth/oauth-complete` page it navigates to.

### BrowserMapNavigationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserMapNavigationService.cs:7` · Level 1 · class (sealed)

- **What it is**: the web adapter for [`IMapNavigationService`](#imapnavigationservice). There is no maps app to launch in a browser, so it builds a Google Maps search URL for the address and hands it to [`IExternalLinkService`](#iexternallinkservice) to open in a new tab.
- **Depends on**: [`IMapNavigationService`](#imapnavigationservice) (the contract it implements) and [`IExternalLinkService`](#iexternallinkservice) (constructor-injected, `MMCA.Common.UI/Services/Capabilities/Browser/BrowserMapNavigationService.cs:15-19`); BCL `Uri` and `Uri.EscapeDataString`. Unlike every other browser adapter in this unit it takes **no** [`CapabilitiesJsModule`](#capabilitiesjsmodule): it composes over a sibling capability instead of calling JS itself.
- **Concept introduced**: **capability composition**. Most adapters in this group sit directly on one platform API; this one is built entirely out of another capability, which is why it lands at Level 1 while its JS-backed siblings sit at Level 2. The payoff is that the "open something outside the app" policy (new tab on the web, system browser on native) is decided once in [`IExternalLinkService`](#iexternallinkservice) and every consumer inherits it. `[Rubric §2, Design Patterns]` assesses whether patterns are applied with intent rather than by habit; adapter-over-adapter here avoids a second copy of the window-open rules. `[Rubric §22, Responsive/Cross-Browser]` assesses whether the app spans device classes gracefully; the same `OpenAddressAsync` call site produces a native maps intent on a phone and a maps tab in a desktop browser.
- **Walkthrough**
  - `MapsSearchUrl` (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserMapNavigationService.cs:12`): the constant `https://www.google.com/maps/search/?api=1&query=` prefix, wrapped in a scoped `#pragma warning disable S1075` (`:11`, `:13`) with a comment stating that the public Maps search endpoint IS the integration point on the web, so there is nothing environment-dependent to configure.
  - The constructor (`:18-19`) is an expression body capturing the injected [`IExternalLinkService`](#iexternallinkservice).
  - `OpenAddressAsync(string address, string? label, CancellationToken = default)` (`:22`): guards with `ArgumentException.ThrowIfNullOrWhiteSpace(address)` (`:24`), appends `Uri.EscapeDataString(address)` to the constant to build the `Uri` (`:26`), awaits `_externalLinkService.OpenAsync(uri, cancellationToken)` (`:27`), and returns `true` (`:28`). The `label` parameter is accepted for contract parity and unused here, exactly as in the MAUI sibling.
- **Why it's built this way**: the web has no address-to-map handoff of its own, so a search URL is the honest equivalent; escaping the address is what keeps a street name with `&` or `#` from truncating the query. Delegating the open (rather than calling `window.open` directly) keeps the noopener/noreferrer hardening in one place ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered scoped as `IMapNavigationService` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:90`); its siblings are [`MauiMapNavigationService`](#mauimapnavigationservice) and [`NullMapNavigationService`](#nullmapnavigationservice). Consumed by venue and location components.
- **Caveats / not-in-source**: the `true` return is unconditional. Because `OpenAsync` returns `Task` (not a success flag) and the underlying `window.open` result is discarded by [`CapabilitiesJsModule`](#capabilitiesjsmodule), a popup blocked by the browser still reports success to the caller. Not determinable from source: whether any consumer branches on that `bool` today.

### CapabilitiesJsModule
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:12` · Level 1 · class (sealed, `IAsyncDisposable`)

- **What it is**: the shared, lazily-imported accessor for `capabilities-interop.js`. Every browser capability adapter in this group goes through it, so one Blazor scope (a Server circuit or a WASM app) performs exactly one ES-module import no matter how many capabilities the page touches.
- **Depends on**: `IJSRuntime` and the `JSDisconnectedException`/`JSException` pair (`Microsoft.JSInterop`, `MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:1`); [`LazyJsModule`](group-15-common-ui-framework.md#lazyjsmodule), the framework's internal import-once helper it wraps (`:16`, `:19`); BCL `ValueTask`. Its consumers are the eight browser adapters below.
- **Concept introduced**: this is the type that makes the whole browser leg of the capability layer safe, and it teaches two ideas at once.
  - **Prerender-safe JS interop**. A Blazor component's first render can happen on the server with no browser attached (SSR prerender) and a Server circuit can be torn down mid-call. Calling into JS in either state throws. Rather than making every adapter (and every component) test for it, this class catches the whole JS-unavailable family and returns `default`, so a capability call during prerender is simply a no-op that yields `null`/`false`.
  - **Import once per scope**. An ES-module import is a network fetch plus an evaluation; doing it per capability call would be wasteful and would race. [`LazyJsModule`](group-15-common-ui-framework.md#lazyjsmodule) caches the imported `IJSObjectReference`, and registering this class **scoped** (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:81`) makes that cache per-circuit.

  `[Rubric §23, Front-End Performance]` assesses whether the client avoids redundant work on the critical path; one shared module import instead of nine is exactly that. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation; a disconnected circuit degrades a capability call to a silent `default` rather than an unhandled exception in a render path. `[Rubric §10, Cross-Cutting]` applies because this is the single place the degradation policy is written, instead of nine copies of the same try/catch.
- **Walkthrough**
  - `ModulePath` (`MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:14`): `./_content/MMCA.Common.UI/capabilities-interop.js`, the static-web-asset path the RCL publishes.
  - The constructor (`:19`) builds the inner [`LazyJsModule`](group-15-common-ui-framework.md#lazyjsmodule) over the host's `IJSRuntime`; nothing is imported yet.
  - `InvokeOrDefaultAsync<T>(string identifier, object?[] args, CancellationToken)` (`:26-49`): the single entry point. It awaits `GetOrImportAsync(cancellationToken)` (`:33`, the import happens here on first use) and then `module.InvokeAsync<T>(identifier, cancellationToken, args)` (`:34`). Three catch arms return `default`: `InvalidOperationException` for interop not yet available (SSR prerender before hydration, `:36-40`), `JSDisconnectedException` for a torn-down circuit (`:41-44`), and `JSException` for a browser API that itself threw (`:45-48`).
  - `DisposeAsync()` (`:52`) forwards to the inner module's disposal, releasing the `IJSObjectReference` when the scope ends.
- **Why it's built this way**: the nullable-returning signature is the load-bearing choice. Because every export is invoked as `InvokeOrDefaultAsync<bool?>` or `<string?>`, adapters can distinguish "JS said no" (`false`) from "JS never ran" (`null`), which is how [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice) knows to retry its subscription after hydration. The class doc records that this mirrors [`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge)'s degradation contract, so both interop boundaries behave identically ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered scoped by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:81`) and injected into [`BrowserShareService`](#browsershareservice), [`BrowserClipboardService`](#browserclipboardservice), [`BrowserExternalLinkService`](#browserexternallinkservice), [`BrowserAccessibilityAnnouncer`](#browseraccessibilityannouncer), [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice), [`BrowserDevicePreferences`](#browserdevicepreferences), and [`BrowserLocalCacheStore`](#browserlocalcachestore).
- **Caveats / not-in-source**: it swallows the JS failure without logging (it takes no `ILogger`), so a genuinely broken export is indistinguishable at runtime from an unsupported browser API.

### MauiCultureStore
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Globalization` · `MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:19` · Level 1 · class (internal static)

- **What it is**: the one place a MAUI Blazor Hybrid head stores, resolves, and activates the UI culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). It is three static methods over `Preferences.Default` and the `CultureInfo` thread defaults, shared by [`MauiCultureApplier`](#mauicultureapplier) (the user switching language) and [`MauiCultureInitializer`](#mauicultureinitializer) (the startup restore).
- **Depends on**: [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (`MMCA.Common.Shared.Globalization`, `MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:2`); MAUI Essentials `Preferences.Default`; BCL `System.Globalization.CultureInfo` (`:1`).
- **Concept introduced**: **culture as process state instead of request state**, and the `AsyncLocal` trap that comes with it. On a web head the culture is per request: a cookie is written, `CookieRequestCultureProvider` reads it, and ASP.NET sets the culture inside that request's own execution context. A hybrid head has no request pipeline at all, so there is exactly one process and one ambient culture. The type doc (`:6-17`) records why this class bypasses [`IDevicePreferences`](#idevicepreferences) even though that contract exists in the same package: `IDevicePreferences` is async-only and the startup restore runs from the synchronous `IMauiInitializeService.Initialize` hook, so routing one side through the async store would give a single value two storage paths. `[Rubric §27, i18n]` assesses whether the app can genuinely operate in more than one language, including persistence of the user's choice; this is where the hybrid head's choice survives a restart. `[Rubric §19, State Management]` assesses whether state has one owner and one lifetime; the whole point of this class is that the culture has exactly one.
- **Walkthrough**
  - `PreferenceKey = "mmca.culture"` (`MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:25`): deliberately outside the `mmca.devicePrefs.` prefix that [`MauiDevicePreferences`](#mauidevicepreferences) uses, because this value never goes through that store. The doc warns that changing the key silently resets every installed app to the device locale (`:21-24`).
  - `Save(string culture)` (`:29`): a one-line `Preferences.Default.Set`, best-effort like the rest of the layer.
  - `Resolve()` (`:37-44`): reproduces the web heads' precedence order without a request. It reads the stored value (`:39`), returns it when `SupportedCultures.IsSupported(stored)` (the cookie's analogue, `:41-42`), and otherwise falls back to `SupportedCultures.ResolveClosest(CultureInfo.CurrentUICulture.Name)`, which is the `Accept-Language` analogue: an `es-MX` device lands on `es` (`:43`). A non-matching device locale falls through to the framework default inside `ResolveClosest`.
  - `ApplyToProcess(string culture)` (`:68-74`): constructs the `CultureInfo` and assigns **only** `CultureInfo.DefaultThreadCurrentCulture` and `DefaultThreadCurrentUICulture` (`:72-73`).
- **Why it's built this way**: the `ApplyToProcess` doc (`:46-65`) carries the single most load-bearing explanation in this unit. Assigning `CultureInfo.CurrentCulture`/`CurrentUICulture` writes to an `AsyncLocal`, so the value flows with the `ExecutionContext` and is restored every time that context is re-entered, outranking the thread defaults. The startup restore runs before any window exists, so the context it would write to is the ancestor of every later dispatch including the Blazor renderer's; a later switch could then set the defaults to `es` and still re-render forever in the launch language. Setting only the thread defaults means no thread ever materializes a culture of its own, so one switch takes effect everywhere at once. A web head never meets this because request localization sets the culture inside each request's own context.
- **Where it's used**: called by [`MauiCultureApplier`](#mauicultureapplier) (`Save` then `ApplyToProcess`) and by [`MauiCultureInitializer`](#mauicultureinitializer) (`ApplyToProcess(Resolve())`). It is `internal`, so nothing outside the `MMCA.Common.UI.Maui` package can reach it.

### MauiTokenStorageService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Services` · `MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:22` · Level 1 · class (sealed)

- **What it is**: the native-head implementation of [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), keeping the access and refresh tokens in MAUI `SecureStorage` (Android Keystore, iOS Keychain, Windows DPAPI) with every single call wrapped so an OS-invalidated entry can never crash the app.
- **Depends on**: [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (`MMCA.Common.UI.Services.Auth`, `MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:1`); MAUI Essentials `SecureStorage.Default`; BCL `Task`.
- **Concept introduced**: **fail-to-signed-out**, the recovery posture for platform secure storage. Keystore and Keychain entries are invalidated by the OS on its own schedule: an Android backup restored onto a new device, a security patch that rotates the master key, a biometric enrolment change. The raw APIs then throw a platform-specific exception rather than returning nothing, and an unhandled throw in a token read happens on launch, which bricks the app until it is reinstalled (`:8-13`). The class therefore turns every failure into the one state that is always recoverable by the user: signed out. `[Rubric §11, Security]` assesses whether credentials are protected at rest with platform-appropriate mechanisms; using the enclave-backed store rather than plain preferences is that. `[Rubric §26, Front-End Security]` assesses client-side credential handling specifically; the invariant that a failed write leaves **no** tokens (never a stale pair) is the security-relevant half. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation; one clean re-login is the designed worst case.
- **Walkthrough**
  - `AccessTokenKey` / `RefreshTokenKey` (`MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:24-25`): the two `auth_*` entry names.
  - `GetAccessTokenAsync()` / `GetRefreshTokenAsync()` (`:28`, `:31`): thin forwards to the private `GetAsync`.
  - `SetTokensAsync(string accessToken, string refreshToken)` (`:34-53`): writes the **refresh** token first, then the access token, with both writes inside one `try` (`:40-44`). Any failure drops both entries via `TryRemove` and rethrows (`:46-52`). The inline comment (`:36-39`) records the bug this shape fixes: a failing refresh write used to escape before the guard was entered, leaving the OLD pair in place, so the app held a stale access token it believed was current until a manual sign-out.
  - `ClearTokensAsync()` (`:56-63`): two `TryRemove` calls and a completed task, never throwing. The comment states the reasoning plainly (`:58-59`): an entry that cannot be deleted is one the OS already invalidated, which is the outcome the caller asked for.
  - `GetAsync(string key)` (`:69-85`): returns `SecureStorage.Default.GetAsync(key)`, and on any exception removes the entry and returns `null` (`:76-84`), so the next write starts from a clean key. The catch is a bare `catch` under a scoped `#pragma warning disable CA1031` (`:75`, `:77`) because the thrown type differs per OS and none of them are recoverable here. The comment also records that nothing in the MAUI head takes an `ILogger`, so the swallow is documented in code rather than reported (`:79-81`).
  - `SetAsync(string key, string value)` (`:91-104`): writes, and on failure removes the key and retries the write **once** (`:101-102`). A second failure propagates, because a caller must never believe a token was persisted when it was not.
  - `TryRemove(string key)` (`:107-120`): best-effort delete; a delete that itself throws is already the goal, and the next `SetAsync` overwrites the entry anyway (`:117-118`).
- **Why it's built this way**: the asymmetry between reads and writes is the design. A failed read is survivable by returning `null` (which [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) already documents as "no token stored"), so it is swallowed. A failed write is not survivable silently, so it propagates, but only after the storage has been forced into the clean signed-out state. Remove-then-retry on write is the concrete remedy for the common cause: an entry whose encryption key the OS rotated cannot be overwritten in place but can be recreated.
- **Where it's used**: registered scoped as [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) by `AddCommonMauiTokenStorage()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:73-74`); the doc notes the lifetime is scoped rather than singleton deliberately, to match the browser siblings so component code sees one lifetime on every head. Those siblings are [`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice) and [`ServerTokenStorageService`](group-15-common-ui-framework.md#servertokenstorageservice).

### BrowserAccessibilityAnnouncer
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserAccessibilityAnnouncer.cs:8` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`IAccessibilityAnnouncer`](#iaccessibilityannouncer). Where the native head calls the OS screen-reader API directly, the browser has no such API, so this writes the message into a visually hidden `aria-live="polite"` region that every screen reader already monitors.
- **Depends on**: [`IAccessibilityAnnouncer`](#iaccessibilityannouncer) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (constructor-injected, `MMCA.Common.UI/Services/Capabilities/Browser/BrowserAccessibilityAnnouncer.cs:10-13`); the `announce` export of `capabilities-interop.js` (`MMCA.Common.UI/wwwroot/capabilities-interop.js:73`).
- **Concept introduced**: the **live region** as the web's equivalent of a screen-reader announce call. The JS side (`capabilities-interop.js:52-71`) creates one `div` on first use with `aria-live="polite"` and `role="status"`, styled inline (absolute, 1px, `clip-path: inset(50%)`) so it is invisible but not hidden from assistive tech, and appended to `document.body`. `announce` clears the region's text before setting it after a 50 ms timeout (`:76-80`) so that repeating the same message is re-announced rather than ignored as an unchanged node. `[Rubric §21, Accessibility]` assesses whether non-visual users receive information a sighted user gets from a purely visual change; this is the single mechanism the whole web head uses for that. `[Rubric §18, UI Architecture]` applies because the live region is created by the capability layer rather than by each page's markup, so no component has to remember to render one.
- **Walkthrough**: the constructor captures the shared module (`BrowserAccessibilityAnnouncer.cs:13`). `AnnounceAsync(string message, CancellationToken = default)` (`:16-19`) is one awaited `InvokeOrDefaultAsync<bool?>("announce", [message], cancellationToken)` whose result is discarded: the contract returns `Task`, and there is no useful caller response to "the announcement did not land".
- **Why it's built this way**: routing through [`CapabilitiesJsModule`](#capabilitiesjsmodule) means an announcement fired during prerender (before any DOM exists) is a silent no-op instead of an exception, which matters because announcements are typically triggered from lifecycle methods that also run server-side. Creating the region lazily in JS keeps the RCL free of any required markup or stylesheet.
- **Where it's used**: registered scoped as `IAccessibilityAnnouncer` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:86`); siblings are [`MauiAccessibilityAnnouncer`](#mauiaccessibilityannouncer) and [`NullAccessibilityAnnouncer`](#nullaccessibilityannouncer). Consumed by components announcing live updates.

### BrowserClipboardService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserClipboardService.cs:4` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`IClipboardService`](#iclipboardservice), writing text to the system clipboard through `navigator.clipboard.writeText`.
- **Depends on**: [`IClipboardService`](#iclipboardservice) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserClipboardService.cs:6-9`); the `copyText` export (`MMCA.Common.UI/wwwroot/capabilities-interop.js:25`).
- **Concept introduced**: the group's **tri-state to bool collapse**, worth stating once because six adapters below repeat it. [`CapabilitiesJsModule`](#capabilitiesjsmodule) returns `bool?`: `true` (the browser did it), `false` (the browser refused), or `null` (JS never ran). Adapters whose contract returns `bool` collapse the last two with `== true`, so "not attempted" and "attempted and failed" are equally honest answers to "did the copy land". `[Rubric §18, UI Architecture]` assesses whether the UI can tell the user the truth about what happened; the boolean is what lets a caller show a "copied" snackbar only on a real success.
- **Walkthrough**: the constructor captures the module (`BrowserClipboardService.cs:9`). `SetTextAsync(string text, CancellationToken = default)` (`:12-18`) invokes `copyText` with the text (`:14-16`) and returns `copied == true` (`:17`). On the JS side, `copyText` returns `false` up front when `navigator.clipboard` is absent (an insecure context or an older browser) and catches a rejected `writeText` (a denied permission) to `false` (`capabilities-interop.js:26-34`).
- **Why it's built this way**: the Clipboard API is permission-gated and unavailable over plain HTTP, so a `bool` return rather than a throw lets the copy-link affordance simply do nothing visible where it is unsupported.
- **Where it's used**: registered scoped as `IClipboardService` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:84`); siblings are [`MauiClipboardService`](#mauiclipboardservice) and [`NullClipboardService`](#nullclipboardservice). It is the copy-link fallback for [`IShareService`](#ishareservice) callers.

### BrowserConnectivityStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserConnectivityStatusService.cs:11` · Level 2 · class (sealed, `IAsyncDisposable`)

- **What it is**: the web adapter for [`IConnectivityStatusService`](#iconnectivitystatusservice), reporting `navigator.onLine` and raising the contract's change event from the window `online`/`offline` listeners. It is the most involved browser adapter in the unit because the browser pushes events back into .NET rather than being polled.
- **Depends on**: [`IConnectivityStatusService`](#iconnectivitystatusservice), [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserConnectivityStatusService.cs:13`, `:18`), and `DotNetObjectReference<T>` plus `[JSInvokable]` (`Microsoft.JSInterop`, `:1`); the `watchOnline`/`unwatchOnline` exports (`MMCA.Common.UI/wwwroot/capabilities-interop.js:92`, `:112`).
- **Concept introduced**: **JS-to-.NET callbacks and their lifetime**. Everything else in this group calls one way, from .NET into the browser. Here the browser must notify .NET when the network state flips, which means handing JS a `DotNetObjectReference` wrapping this instance, exposing a `[JSInvokable]` method for it to call, and disposing that reference when the scope ends or it leaks the object for the life of the circuit. It also introduces the group's **deferred initialization** shape: the adapter cannot subscribe during prerender, so it starts optimistic and subscribes later. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation under a partial outage; the offline banner and request-skipping guards read from here. `[Rubric §19, State Management]` assesses ownership of client state; `IsOnline` has a private setter and one mutation path, so no consumer can desynchronize it.
- **Walkthrough**
  - Fields (`BrowserConnectivityStatusService.cs:13-15`): the shared module, a nullable `_selfReference` (the `DotNetObjectReference` handed to JS), and a `_watching` flag.
  - `ConnectivityChanged` (`:21`) and `IsOnline { get; private set; } = true` (`:24`): the contract members. The `true` initializer is the deliberate optimistic default the class doc calls out (`:7-9`): before `InitializeAsync` runs there is no way to ask the browser, and assuming offline would flash a false banner on every first render.
  - `InitializeAsync(CancellationToken = default)` (`:27-47`): returns immediately when already `_watching` (`:29-32`), lazily creates `_selfReference` with `??=` (`:34`), and invokes `watchOnline` passing that reference (`:35-37`). The return value is the tri-state: `null` means JS was unavailable (prerender), so the method returns **without** setting `_watching`, leaving the subscription to be retried on a later call (`:39-43`). Otherwise it latches `_watching = true` and applies the reported state (`:45-46`).
  - `OnBrowserConnectivityChanged(bool isOnline)` (`:50-51`): the `[JSInvokable]` callback target, documented as not for app code. On the JS side both the `online` and `offline` window listeners call the same `notify` closure, which reads `navigator.onLine` fresh and swallows a rejected invoke when the component is gone (`capabilities-interop.js:95-103`).
  - `DisposeAsync()` (`:54-63`): calls `unwatchOnline` only when it actually subscribed, with `CancellationToken.None` (teardown must not be cancelled, `:58`), then disposes and nulls `_selfReference` (`:61-62`).
  - `UpdateStatus(bool isOnline)` (`:65-74`): the single mutation path. It returns early when the value is unchanged (`:67-70`), so the event fires only on a real transition, then sets `IsOnline` and raises `ConnectivityChanged` (`:72-73`).
- **Why it's built this way**: the class doc instructs callers to invoke `InitializeAsync` from `OnAfterRenderAsync` (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserConnectivityStatusService.cs:8-9`), which is the first lifecycle point where JS is guaranteed available; the `null`-means-retry path is what makes a call from a too-early lifecycle method harmless rather than permanently broken. `watchOnline` itself calls `unwatchOnline` first (`capabilities-interop.js:93`), so a double subscribe cannot stack listeners. The change-only event contract keeps the offline banner from re-rendering on every duplicate browser event.
- **Where it's used**: registered scoped as `IConnectivityStatusService` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:87`); siblings are [`MauiConnectivityStatusService`](#mauiconnectivitystatusservice) and the Server default [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Caveats / not-in-source**: `navigator.onLine` reports link-layer connectivity, not gateway reachability, so a captive-portal network reads as online here. The MAUI sibling deliberately differs by mapping only full `Internet` access to online.

### BrowserDevicePreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserDevicePreferences.cs:10` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`IDevicePreferences`](#idevicepreferences), a typed key/value store for per-device settings backed by `localStorage` with JSON-encoded values under the `mmca.devicePrefs.` prefix.
- **Depends on**: [`IDevicePreferences`](#idevicepreferences) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserDevicePreferences.cs:14`, `:17`); BCL `System.Text.Json` (`:1`); the `storageGet`/`storageSet`/`storageRemove` exports (`MMCA.Common.UI/wwwroot/capabilities-interop.js:130`, `:138`, `:147`).
- **Concept introduced**: **cross-head storage parity by convention**. This adapter and [`MauiDevicePreferences`](#mauidevicepreferences) independently agree on the same key prefix and the same encoding (one JSON document per value), so a setting written by a component behaves identically on either head with no per-type platform code. `[Rubric §19, State Management]` assesses whether state has a clear owner and lifetime; these values describe one device or browser profile and never roam to the server. `[Rubric §26, Front-End Security]` applies by exclusion: `localStorage` is readable by any script on the origin, which is why the contract's doc keeps secrets out of it and tokens live in [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) instead.
- **Walkthrough**
  - `KeyPrefix = "mmca.devicePrefs."` (`BrowserDevicePreferences.cs:12`) and the injected module (`:14-17`).
  - `IsPersistent => true` (`:20`): values survive a session on the same browser profile.
  - `GetAsync<T>(string key, T fallback, CancellationToken = default)` (`:23-44`): guards the key (`:25`), reads the prefixed raw string (`:27-29`), returns `fallback` when it is `null` (which covers both "absent" and "JS unavailable", `:30-33`), then `JsonSerializer.Deserialize<T>` inside a `try`, returning `fallback` on a null result or a `JsonException` (`:35-43`).
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`:47-55`): guards the key, serializes to JSON, and invokes `storageSet` with the prefixed key; the `bool?` result is discarded.
  - `RemoveAsync(string key, CancellationToken = default)` (`:58-65`): guards and invokes `storageRemove`.
- **Why it's built this way**: `ArgumentException.ThrowIfNullOrWhiteSpace(key)` is the one place this class does throw, because an empty key is a programming error, not an environment condition. Everything environmental (Safari Private Browsing, an iframe with storage disabled, a corrupt value) degrades to the caller's `fallback`, so a preferences read can never break a render path. Discarding the write result is consistent: there is no useful UI response to "the browser refused to persist your preference".
- **Where it's used**: registered scoped as `IDevicePreferences` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:88`); siblings are [`MauiDevicePreferences`](#mauidevicepreferences) and the in-memory Server default [`InMemoryDevicePreferences`](#inmemorydevicepreferences). Keys come from [`DevicePreferenceKeys`](#devicepreferencekeys).

### BrowserExternalLinkService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserExternalLinkService.cs:8` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`IExternalLinkService`](#iexternallinkservice). On the web an anchor already works, so it reports `InterceptsLinks => false` and only handles **programmatic** opens (the maps fallback) through `window.open`.
- **Depends on**: [`IExternalLinkService`](#iexternallinkservice) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserExternalLinkService.cs:10`, `:13`); the `openExternal` export (`MMCA.Common.UI/wwwroot/capabilities-interop.js:37`); BCL `Uri`.
- **Concept introduced**: the `InterceptsLinks` **capability flag**, the group's answer to "should the component render a plain anchor or route through the service". A native head inside a `BlazorWebView` must intercept, because `target="_blank"` dead-ends there; a browser head must not, because intercepting would replace working native anchor behavior (middle-click, open-in-new-tab, the browser's own popup policy) with a worse imitation. `[Rubric §25, Navigation & IA]` assesses whether navigation is coherent and predictable across the app; one flag lets a single `ExternalLink` component be correct on both heads. `[Rubric §26, Front-End Security]` applies to the JS side: `window.open(url, '_blank', 'noopener,noreferrer')` (`capabilities-interop.js:39`) prevents the opened page from reaching back through `window.opener` and strips the referrer.
- **Walkthrough**: the constructor captures the module (`BrowserExternalLinkService.cs:13`). `InterceptsLinks => false` (`:16`). `OpenAsync(Uri uri, CancellationToken = default)` (`:19-26`) null-guards `uri` (`:21`) and invokes `openExternal` with `uri.ToString()` (`:23-25`), discarding the result because the contract returns `Task`.
- **Why it's built this way**: leaving anchors alone on the web is the cheaper and more correct default; the programmatic path exists only for callers like [`BrowserMapNavigationService`](#browsermapnavigationservice) that have no anchor to click.
- **Where it's used**: registered scoped as `IExternalLinkService` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:85`); siblings are [`MauiExternalLinkService`](#mauiexternallinkservice) and [`NullExternalLinkService`](#nullexternallinkservice). Consumed by the `ExternalLink` component and by [`BrowserMapNavigationService`](#browsermapnavigationservice).
- **Caveats / not-in-source**: a popup blocker can make `window.open` return `null` while the JS still reports `true` (`capabilities-interop.js:37-44` only catches a throw), so an open silently blocked by the browser is not detected.

### BrowserLocalCacheStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserLocalCacheStore.cs:10` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`ILocalCacheStore`](#ilocalcachestore), holding last-known-good JSON snapshots in `localStorage` under the `mmca.localCache.` prefix so a page can still render something when the API is unreachable.
- **Depends on**: [`ILocalCacheStore`](#ilocalcachestore) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserLocalCacheStore.cs:14`, `:17`); BCL `System.Text.Json` (`:1`); the same three `storage*` exports [`BrowserDevicePreferences`](#browserdevicepreferences) uses.
- **Concept introduced**: nothing new mechanically (it is the storage shape [`BrowserDevicePreferences`](#browserdevicepreferences) introduces), but the **separation of the two stores under different prefixes** is the point: preferences are the user's settings and should never be evicted to make room for a stale schedule snapshot, while cache entries are disposable. The class doc records the practical ceiling: browsers cap `localStorage` around 5 MB, so callers keep documents lean (`:7-8`). `[Rubric §29, Resilience & Business Continuity]` assesses whether the client degrades usefully when a dependency is down; this store is what an offline view renders from. `[Rubric §23, Front-End Performance]` applies because a warm snapshot removes a blocking fetch from first paint.
- **Walkthrough**
  - `KeyPrefix = "mmca.localCache."` (`BrowserLocalCacheStore.cs:12`); `IsAvailable => true` (`:20`), since a browser head always has `localStorage` to attempt (a refusal degrades per call rather than being predicted here).
  - `SetAsync<T>(...)` (`:23-31`): guards the key, `JsonSerializer.Serialize`, invokes `storageSet`, discards the result. A failed write only means a colder next visit.
  - `GetAsync<T>(...)` (`:34-54`): guards the key, reads the raw string, returns `default` when it is `null` (`:41-44`), and deserializes inside a `try` that maps `JsonException` to `default` (`:46-53`). The `JsonException` arm is what makes a schema change survivable: a document written by an older version of the app that no longer deserializes is treated as a cache miss, not an error.
  - `RemoveAsync(...)` (`:57-64`): guards and invokes `storageRemove`.
- **Why it's built this way**: `default` on every failure means a cache miss and a corrupt entry are the same event to the caller: fetch live. Storing pre-serialized strings from C# (the JS helpers deliberately treat values as opaque raw strings, `capabilities-interop.js:127-128`) keeps all typing on the .NET side, so the same `T` round-trips identically on every head.
- **Where it's used**: registered scoped as `ILocalCacheStore` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:89`); siblings are [`MauiLocalCacheStore`](#mauilocalcachestore) (file-per-key on disk) and the unavailable [`NullLocalCacheStore`](#nulllocalcachestore).
- **Caveats / not-in-source**: nothing here evicts or expires entries, and `IsAvailable` is a constant rather than a probe, so a quota-exhausted profile still reports available and simply fails each write.

### BrowserShareService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:8` · Level 2 · class (sealed)

- **What it is**: the web adapter for [`IShareService`](#ishareservice), opening the browser's native share sheet through the Web Share API for links, and declining file sharing outright.
- **Depends on**: [`IShareService`](#ishareservice) and [`CapabilitiesJsModule`](#capabilitiesjsmodule) (`MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:10`, `:13`); the `shareLink` export (`MMCA.Common.UI/wwwroot/capabilities-interop.js:12`); BCL `Uri`.
- **Concept introduced**: **partial capability implementation**, the third posture in this group alongside "real" and "inert". Web Share exists but covers only part of the contract, so one method is genuinely implemented and the other returns a hard `false` rather than pretending. That honest `false` is what lets a Share button on desktop Firefox fall back to copy-link instead of appearing to work and doing nothing. `[Rubric §22, Responsive/Cross-Browser]` assesses behavior across browsers that do not agree on a feature; the class doc names the exact gaps (desktop Firefox, insecure contexts, `:5-6`). `[Rubric §18, UI Architecture]` applies because the boolean return is the contract that makes a fallback affordance possible at all.
- **Walkthrough**
  - The constructor captures the module (`BrowserShareService.cs:13`).
  - `ShareLinkAsync(string title, Uri uri, CancellationToken = default)` (`:16-24`): null-guards `uri` (`:18`), invokes `shareLink` with the title and the URI string (`:20-22`), and returns `shared == true` (`:23`). On the JS side, `shareLink` returns `false` when `navigator.share` is absent and catches the dismissal/permission rejections (`AbortError`, `NotAllowedError`) to `false` (`capabilities-interop.js:13-22`), so a user who closes the share sheet is reported as "not shared".
  - `ShareFileAsync(string title, string filePath, string contentType, CancellationToken = default)` (`:27-28`): `Task.FromResult(false)`, unconditionally. A browser has no local file path to share.
- **Why it's built this way**: collapsing "user dismissed" into `false` alongside "unsupported" is the same simplification the clipboard adapter makes, and it is right here because both outcomes mean the link was not shared. Returning a constant `false` for files, rather than throwing `NotSupportedException`, keeps the contract uniform so callers branch on a value instead of catching.
- **Where it's used**: registered scoped as `IShareService` by `AddBrowserDeviceCapabilities()` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:83`); siblings are [`MauiShareService`](#mauishareservice) and [`NullShareService`](#nullshareservice), with [`IClipboardService`](#iclipboardservice) as the fallback path.

### MauiCultureApplier
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Globalization` · `MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:22` · Level 2 · class (sealed)

- **What it is**: the hybrid-head implementation of [`ICultureApplier`](group-15-common-ui-framework.md#icultureapplier) ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). When the user picks a language, it persists and activates the choice in process and force-reloads the `BlazorWebView` so every component re-renders under the new culture.
- **Depends on**: [`ICultureApplier`](group-15-common-ui-framework.md#icultureapplier) (the contract), [`MauiCultureStore`](#mauiculturestore) (persistence plus activation), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (the allowlist), and `NavigationManager` (primary-constructor parameter, `MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:1-3`, `:22`).
- **Concept introduced**: **force-load as a re-render mechanism**. The class doc (`:13-19`) explains the reasoning: resource strings are resolved from `CultureInfo.CurrentUICulture` at render time, and Blazor exposes no API to re-render an entire component tree in place, so a full reload is the only way to make the switch visible everywhere at once. Inside a `BlazorWebView` this is cheap in a way it is not on the web: the force-load re-boots the Blazor app inside the WebView while the .NET process (and therefore the culture just set) stays alive. It also introduces the **head-specific replacement of a shared default**: the web default [`EndpointCultureApplier`](group-15-common-ui-framework.md#endpointcultureapplier) navigates to the server `/culture/set` endpoint, which on a hybrid head is resolved by the Blazor `Router`, matches no page, and renders the not-found page (`:8-12`). `[Rubric §27, i18n]` assesses whether language is a first-class, switchable concern; this is the switch. `[Rubric §18, UI Architecture]` applies because one language-switcher component works on every head purely by resolving a different `ICultureApplier`.
- **Walkthrough**: `ApplyAsync(string culture, string returnPath, CancellationToken = default)` (`MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:25`) guards the culture string (`:27`), then checks `SupportedCultures.IsSupported(culture)` and returns a completed task unchanged when it fails (`:32-35`), which is exact parity with the web endpoint's allowlist behavior. The comment at `:29-31` records that the pseudo locale is unreachable here: the switcher only offers it when `IHostEnvironment` reports Development, and a MAUI head registers no such service. It then calls `MauiCultureStore.Save(culture)` and `MauiCultureStore.ApplyToProcess(culture)` (`:41-42`), resolves the target as `returnPath` or `/` when blank (`:44`), and calls `navigation.NavigateTo(target, forceLoad: true)` (`:45`), returning `Task.CompletedTask` (`:47`).
- **Why it's built this way**: the ordering comment (`:37-40`) is the load-bearing part: persist and activate BEFORE the reload, so the new culture is already the process default when the tree re-renders. Doing it the other way would reload under the old culture. The comment also points at [`MauiCultureStore.ApplyToProcess`](#mauiculturestore)'s remarks for why assigning `CurrentUICulture` here would pin the app to its startup language for the rest of the session.
- **Where it's used**: registered scoped as `ICultureApplier` by `UseMauiCulture()` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:118`), which is itself already called by `UseMauiDeviceCapabilities` and must run after `AddUIShared` so the plain `Add` overrides that `TryAdd` default (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:106-114`). Consumed by the shared language-switcher UI.

### MauiCultureInitializer
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Globalization` · `MMCA.Common.UI.Maui/Globalization/MauiCultureInitializer.cs:14` · Level 2 · class (sealed)

- **What it is**: the startup half of hybrid-head localization ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): an `IMauiInitializeService` that restores the persisted culture while the app is being built, before any window or page exists.
- **Depends on**: [`MauiCultureStore`](#mauiculturestore) (`Resolve` plus `ApplyToProcess`) and the MAUI `IMauiInitializeService` hook (`MMCA.Common.UI.Maui/Globalization/MauiCultureInitializer.cs:14`, `:21-22`).
- **Concept introduced**: the **pre-window initialization hook**. `IMauiInitializeService.Initialize` runs inside `MauiAppBuilder.Build()`, so it is the earliest point at which app code can set process state, and the class doc names the two consequences that make it the right place (`:5-8`): the very first Blazor render already happens under the correct culture (no flash of the wrong language), and the user does not have to re-pick their language on every launch. It is the hybrid counterpart to the WASM head's [`MmcaCultureBootstrap`](group-15-common-ui-framework.md#mmcaculturebootstrap). `[Rubric §27, i18n]` assesses end-to-end language support including startup; without this, a hybrid head has no culture state of its own and always starts at the device locale, which is why persisting the choice in [`MauiCultureApplier`](#mauicultureapplier) alone is not enough (`:9-12`).
- **Walkthrough**: one member. `Initialize(IServiceProvider services)` (`MMCA.Common.UI.Maui/Globalization/MauiCultureInitializer.cs:21-22`) is an expression body calling `MauiCultureStore.ApplyToProcess(MauiCultureStore.Resolve())`. The `services` parameter is unused, and the remarks say why (`:17-20`): the culture lives in device preferences and process state, both reachable without DI, so the parameter belongs to the interface rather than to this restore.
- **Why it's built this way**: running before the container is meaningfully usable is exactly what forces [`MauiCultureStore`](#mauiculturestore) to read `Preferences.Default` directly rather than through the async [`IDevicePreferences`](#idevicepreferences) contract; the two constraints (synchronous hook, pre-window timing) are what shape the whole storage design. This same timing is why other singletons built during app construction must resolve their localized strings lazily rather than at construction: `MauiBarcodeScannerService`'s doc records the identical hazard (`MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:17-21`).
- **Where it's used**: registered as a singleton `IMauiInitializeService` by `UseMauiCulture()` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:119`), alongside [`MauiCultureApplier`](#mauicultureapplier). MAUI invokes it; nothing in app code calls it directly.

### AlwaysOnlineConnectivityStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/AlwaysOnlineConnectivityStatusService.cs:7` · Level 1 · class (sealed)

- **What it is**: the default [`IConnectivityStatusService`](#iconnectivitystatusservice) for any head with no better answer: it reports the device permanently online and never raises a change event. The class summary states the reasoning directly, that this is the *correct* behavior for Blazor Server, where a lost connection tears down the circuit itself (`AlwaysOnlineConnectivityStatusService.cs:3-6`).
- **Depends on**: [`IConnectivityStatusService`](#iconnectivitystatusservice) only. Externals: BCL `EventHandler` and `ValueTask`.
- **Concept introduced, the neutral capability default.** This is the first of the sixteen fallback implementations in this unit, so the shared shape is worth teaching once. Every device capability in this group is a narrow interface that shared Blazor components inject directly, and a component cannot ask "am I on MAUI or in a browser" without becoming host-aware. So the framework guarantees that *every* contract always resolves: `AddDeviceCapabilityDefaults()` `TryAdd`-registers one of these fallbacks for each interface (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:24-65`), and a head that can do better calls a plain `Add` afterwards, so last-registration-wins swaps in the real implementation with no component change (`DependencyInjection.cs:9-14`). Note the vocabulary distinction this class draws: most siblings are Null Objects (they report the capability absent), but this one is a *neutral* default that asserts a genuinely true value on its target host, which is why it is named `AlwaysOnline...` rather than `Null...`.
  - Also worth reading closely: the `ConnectivityChanged` event is declared with explicit empty `add`/`remove` accessors (`AlwaysOnlineConnectivityStatusService.cs:10-21`) rather than as a field-like event. Subscribing therefore compiles and costs nothing, but the instance never stores a delegate, so this process-lifetime singleton can never root a subscriber component. A field-like event would have kept every disposed component alive until it unsubscribed.
  - `[Rubric §2, Design Patterns]` assesses whether classic patterns are used where they earn their keep. Null Object plus Adapter is the pairing that runs through this whole capability family: one inert default, one platform adapter per head.
  - `[Rubric §1, SOLID]` assesses SOLID adherence. Liskov substitutability is the entire mechanism here, since a component holds only the interface and cannot tell which implementation it received.
  - `[Rubric §22, Responsive / Cross-Browser]` assesses graceful behavior across heads and browsers. One shared component tree runs unchanged on Blazor Server, WebAssembly and MAUI precisely because the container, not the component, answers the "what can this device do" question.
- **Walkthrough**
  - `ConnectivityChanged` (`AlwaysOnlineConnectivityStatusService.cs:10-21`): accessor-only event, both bodies documented no-ops ("Never raised: connectivity is constant on this host").
  - `IsOnline` (`AlwaysOnlineConnectivityStatusService.cs:24`): a constant `true`.
  - `InitializeAsync(CancellationToken)` (`AlwaysOnlineConnectivityStatusService.cs:27`): returns `ValueTask.CompletedTask`. The contract asks callers to invoke this from `OnAfterRenderAsync` and promises it is a safe repeat call on every implementation (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/IConnectivityStatusService.cs:18-22`); here there is nothing to start.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). On Blazor Server the render tree lives on the server, so "the device went offline" is not a state the UI can render: the circuit drops and the framework reconnect overlay takes over. Reporting a fabricated offline state would double up on that overlay, so the honest answer for this host is a constant `true`.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:27`); overridden by [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice) in `AddBrowserDeviceCapabilities()` (`DependencyInjection.cs:87`) and by [`MauiConnectivityStatusService`](#mauiconnectivitystatusservice) on native heads. The visible consumer is the shared `OfflineBanner` component, which renders nothing while `IsOnline` is true (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Capabilities/OfflineBanner.razor:12-17`, `:27-28`). Both bUnit bases register it explicitly so component tests get a deterministic online state (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/BunitTestBase.cs:34`, `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:32`), and `CapabilityFallbackTests` asserts `IsOnline` stays true across `InitializeAsync` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Capabilities/CapabilityFallbackTests.cs:63-71`).

### InMemoryDevicePreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/InMemoryDevicePreferences.cs:10` · Level 1 · class (sealed)

- **What it is**: the default [`IDevicePreferences`](#idevicepreferences), a working key/value store that keeps its values in a dictionary and loses them when the scope ends. It is honest about that through `IsPersistent`, which hosts consult to hide device-settings UI that would not survive a restart (`InMemoryDevicePreferences.cs:5-9`).
- **Depends on**: [`IDevicePreferences`](#idevicepreferences). Externals: BCL `ConcurrentDictionary<TKey, TValue>` (`InMemoryDevicePreferences.cs:1`), `StringComparer.Ordinal`, `ArgumentException.ThrowIfNullOrWhiteSpace`.
- **Concept introduced, the fallback that carries state, and the one scoped registration.** Every other default in this unit is stateless and registered as a singleton. This one holds a dictionary, and that single difference changes its lifetime: `AddDeviceCapabilityDefaults()` registers it with `TryAddScoped`, with the reason spelled out in the call site, so the Blazor Server fallback holds per-circuit (per-user) state and never cross-user state (`DependencyInjection.cs:59-61`). A singleton here would be a real defect: one user's reminder lead time or haptics toggle would become everyone's. The second idea worth taking away is the difference between a *capability* failure and a *programming* error. This family never throws when the device cannot do something, but a blank preference key is a caller bug, so all three methods guard it with `ArgumentException.ThrowIfNullOrWhiteSpace` and do throw (`InMemoryDevicePreferences.cs:20`, `:30`, `:39`).
  - `[Rubric §19, State Management]` assesses where client state lives and how long it survives. This class makes the volatility explicit through `IsPersistent` instead of pretending durability, so a feature can decide whether to offer a setting at all.
  - `[Rubric §11, Security]` assesses handling of sensitive data. Scoping to the circuit is the isolation boundary, and the contract reinforces the rule that secrets never belong here: tokens go to platform secure storage (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:26-33`).
  - `[Rubric §14, Testability]` assesses how easily behavior can be exercised without infrastructure. Because it is a real, dependency-free implementation rather than a no-op, downstream tests use it directly as a preferences double.
- **Walkthrough**
  - `_values` (`InMemoryDevicePreferences.cs:12`): a `ConcurrentDictionary<string, object?>` built with `StringComparer.Ordinal`. Ordinal comparison means preference keys are exact byte-for-byte matches, never culture-folded.
  - `IsPersistent` (`InMemoryDevicePreferences.cs:15`): constant `false`.
  - `GetAsync<T>(string key, T fallback, CancellationToken)` (`InMemoryDevicePreferences.cs:18`): guards the key (`:20`), then returns the stored value only when the entry exists *and* the boxed value pattern-matches `T` (`stored is T typed`, `:22`); anything else yields `fallback` (`:22-24`). That type test is what implements the contract's "returns fallback when absent or unreadable" rule.
  - `SetAsync<T>(string key, T value, CancellationToken)` (`InMemoryDevicePreferences.cs:28`): guards the key, assigns through the indexer (an upsert), and returns `Task.CompletedTask` (`:30-33`).
  - `RemoveAsync(string key, CancellationToken)` (`InMemoryDevicePreferences.cs:37`): guards the key and calls `TryRemove` with a discard, so an unknown key is silently ignored as the contract requires (`:39-42`).
  - Every method is synchronous under an async signature: the interface is `Task`-shaped because the persistent implementations do real I/O, and this one satisfies it with already-completed tasks rather than an offloaded call.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Device preferences describe *this device* and deliberately never roam, which is why they are separate from the server-side per-user preferences (`IDevicePreferences.cs:26-30`). A Blazor Server circuit is not a device and has no durable per-device store, so the truthful default is a volatile one plus a flag that lets the UI adapt.
- **Where it's used**: `TryAddScoped` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:61`); overridden by [`BrowserDevicePreferences`](#browserdevicepreferences) (localStorage) in `AddBrowserDeviceCapabilities()` (`DependencyInjection.cs:88`) and by [`MauiDevicePreferences`](#mauidevicepreferences) on native heads. ADC's Engagement UI tests instantiate it as the preferences double for [`SessionReminderCoordinator`](group-22-engagement-module.md#sessionremindercoordinator) and [`SessionBookmarkUIService`](group-22-engagement-module.md#sessionbookmarkuiservice) (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Services/SessionReminderCoordinatorTests.cs:21`, `.../SessionBookmarkUIServiceTests.cs:124`), and `CapabilityFallbackTests` covers the round trip plus the not-persistent flag (`CapabilityFallbackTests.cs:89-102`).
- **Caveats / not-in-source**: values are stored boxed as `object?`, so a `GetAsync<int>` against a key written as `string` returns the fallback rather than reporting a type mismatch (`InMemoryDevicePreferences.cs:22`). The interface enumerates the supported value types (`IDevicePreferences.cs:31-32`); nothing in this class enforces that list.

### NullAccessibilityAnnouncer
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullAccessibilityAnnouncer.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IAccessibilityAnnouncer`](#iaccessibilityannouncer): screen-reader announcements are accepted and dropped (`NullAccessibilityAnnouncer.cs:3`).
- **Depends on**: [`IAccessibilityAnnouncer`](#iaccessibilityannouncer); BCL `Task`.
- **Concept**: the same neutral-default shape taught under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice), in its smallest possible form. Note there is no `IsSupported` probe on this contract, so a component cannot branch on availability and does not need to: announcing is fire-and-forget by design.
  - `[Rubric §21, Accessibility]` assesses whether non-visual users receive the information sighted users get. This default is the *absence* of that channel, which is why both real heads implement it: [`BrowserAccessibilityAnnouncer`](#browseraccessibilityannouncer) writes into an `aria-live` region and [`MauiAccessibilityAnnouncer`](#mauiaccessibilityannouncer) pushes to the OS screen reader. A head that keeps this default silently loses live-region announcements.
- **Walkthrough**: one member. `AnnounceAsync(string message, CancellationToken)` (`NullAccessibilityAnnouncer.cs:7`) ignores both arguments and returns `Task.CompletedTask`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Call sites stay unconditional: a component announces a change without first checking whether an assistive channel exists, and the container decides whether that announcement goes anywhere.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:36`); overridden on both web (`DependencyInjection.cs:86`) and native heads, so in practice only a head that calls neither override keeps it. Asserted non-throwing in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:155`).

### NullBarcodeScannerService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBarcodeScannerService.cs:9` · Level 1 · class (sealed)

- **What it is**: the no-op camera scanner for [`IBarcodeScannerService`](#ibarcodescannerservice). Browsers have no shared camera-scanning primitive the framework can rely on, so web heads keep this default and simply hide the scan button, and the native override ships in `MMCA.Common.UI.Maui` as an opt-in (`NullBarcodeScannerService.cs:3-8`).
- **Depends on**: [`IBarcodeScannerService`](#ibarcodescannerservice); BCL `Task`.
- **Concept introduced, the default that survives even on the capable host.** Most fallbacks in this unit are replaced automatically on the head that can do the job. This one is not: `UseMauiDeviceCapabilities()` deliberately leaves it alone, and a MAUI head keeps this null scanner until it separately calls `UseCommonBarcodeScanner()`, because pulling in the camera adapter also means shipping a camera permission declaration (`DependencyInjection.cs:54-57`). "Unsupported" here therefore encodes two different situations behind one flag: the platform cannot scan, or the app chose not to.
  - `[Rubric §22, Responsive / Cross-Browser]` assesses graceful degradation across heads. The `IsSupported` flag is what lets one shared page render a scan button on a phone and omit it in a browser without host detection.
  - `[Rubric §11, Security]` assesses least-privilege posture. Keeping the camera adapter opt-in means an app that never scans requests no camera permission at all.
- **Walkthrough**
  - `IsSupported` (`NullBarcodeScannerService.cs:12`): constant `false`; components hide the affordance.
  - `ScanAsync(CancellationToken)` (`NullBarcodeScannerService.cs:15-16`): returns `Task.FromResult<string?>(null)`, ignoring the token. That is deliberate and pinned by a test: even a pre-cancelled token must come back as a plain `null` rather than an `OperationCanceledException`, because the contract is that the scan affordance is simply absent, not that a scan was interrupted (`CapabilityFallbackTests.cs:123-137`).
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). A cancelled-token exception would force every caller into a `try`/`catch` for a case that is not an error, so the null result carries both "no camera" and "no scan happened" uniformly.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:57`). [`MauiBarcodeScannerService`](#mauibarcodescannerservice) replaces it only for heads that opt in through `UseCommonBarcodeScanner()`.

### NullBatteryStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBatteryStatusService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IBatteryStatusService`](#ibatterystatusservice): energy saver is never reported active (`NullBatteryStatusService.cs:3`).
- **Depends on**: [`IBatteryStatusService`](#ibatterystatusservice); BCL `EventHandler`.
- **Concept**: the property-plus-change-event capability shape, reduced to its inert form. It uses the same accessor-only event trick introduced under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice): subscription compiles, no delegate is retained, nothing is ever raised, and therefore this singleton cannot leak subscribers.
  - `[Rubric §12, Performance & Scalability]` assesses whether work adapts to constraints. Answering `false` means "do not throttle", which is the right default on a desktop browser or a server-rendered circuit where there is no battery to conserve.
- **Walkthrough**
  - `EnergySaverChanged` (`NullBatteryStatusService.cs:7-18`): explicit empty `add`/`remove`, documented as never raised because there is no battery state on this host.
  - `IsEnergySaverOn` (`NullBatteryStatusService.cs:21`): constant `false`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). A live feature asks this before deciding to poll or auto-join a real-time channel; on a host with no power constraint the honest answer is "not conserving", so the feature runs at full fidelity.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:39`); [`MauiBatteryStatusService`](#mauibatterystatusservice) is the native override, and there is no browser implementation, so web heads keep this default. Covered in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:148`).

### NullBiometricAuthenticator
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBiometricAuthenticator.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IBiometricAuthenticator`](#ibiometricauthenticator): biometrics unavailable, so hosts hide the app-lock toggle (`NullBiometricAuthenticator.cs:3`).
- **Depends on**: [`IBiometricAuthenticator`](#ibiometricauthenticator); BCL `Task`.
- **Concept**: *fail closed*. Most defaults in this unit degrade toward "nothing happens", which is safe because nothing was being protected. This one degrades toward "authentication did not succeed", which is the only safe direction for a security gate: `AuthenticateAsync` returns `false`, never `true`, so a caller that skips the availability probe and treats the result as a grant still cannot unlock anything.
  - `[Rubric §11, Security]` assesses whether security decisions default to denial. Both members return `false`, so an absent capability can never be mistaken for a passed check.
  - `[Rubric §1, SOLID]` assesses substitutability. The distinction matters here: a Null Object must preserve the *semantics* of the contract, and for an authenticator that means denial, not a convenient success.
- **Walkthrough**
  - `IsAvailableAsync(CancellationToken)` (`NullBiometricAuthenticator.cs:7-8`): `Task.FromResult(false)`; the UI hides the app-lock setting.
  - `AuthenticateAsync(string reason, CancellationToken)` (`NullBiometricAuthenticator.cs:11-12`): `Task.FromResult(false)`, ignoring the reason string that a real prompt would display.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). App lock is a native-only affordance, and web heads already sit behind the normal auth pipeline, so the framework does not simulate a biometric prompt in a browser.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:40`); [`MauiBiometricAuthenticator`](#mauibiometricauthenticator) is the only override. Both members are asserted false in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:143-144`).

### NullClipboardService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullClipboardService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IClipboardService`](#iclipboardservice): the clipboard is unavailable, and the call reports failure rather than pretending success (`NullClipboardService.cs:3`).
- **Depends on**: [`IClipboardService`](#iclipboardservice); BCL `Task`.
- **Concept**: the boolean *outcome* return, as opposed to the boolean `IsSupported` *probe* used by most siblings. This contract has no probe: a copy either worked or it did not, and the caller reacts to the answer it gets. Returning `false` is what lets a component show "copy failed, select the text manually" instead of a misleading "copied" toast.
  - `[Rubric §24, Forms / Validation / UX Safety]` assesses whether the UI tells the truth about what happened. Reporting the failure keeps the user informed rather than silently discarding their action.
- **Walkthrough**: one member. `SetTextAsync(string text, CancellationToken)` (`NullClipboardService.cs:7-8`) returns `Task.FromResult(false)`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Clipboard write is permission-gated and can fail on real hosts too (a non-secure browser context, for example), so the contract already has a failure path and the null default simply takes it always.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:29`); overridden by [`BrowserClipboardService`](#browserclipboardservice) (`DependencyInjection.cs:84`) and [`MauiClipboardService`](#mauiclipboardservice). Covered in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:26-28`).

### NullExternalLinkService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullExternalLinkService.cs:7` · Level 1 · class (sealed)

- **What it is**: the default [`IExternalLinkService`](#iexternallinkservice): no link interception, so components render plain anchors with `target="_blank"`, which the class summary notes is the correct behavior on web heads even without JavaScript (`NullExternalLinkService.cs:3-6`).
- **Depends on**: [`IExternalLinkService`](#iexternallinkservice); BCL `Uri` and `Task`.
- **Concept introduced, the flag that is a routing switch rather than a capability probe.** `InterceptsLinks` does not mean "I can open links"; it means "route clicks through me instead of letting the browser handle them". The shared `ExternalLink` component reads it and builds an `EventCallback` only when it is true, otherwise leaving the click handler as `default` so the plain `MudLink` with `target="_blank"` and `rel="noopener noreferrer"` handles the navigation natively (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Capabilities/ExternalLink.razor:10-15`, `:31-34`). With this default in place, `OpenAsync` is therefore never called, which is why its inert body is harmless.
  - `[Rubric §25, Navigation & IA]` assesses whether navigation stays coherent across surfaces. This flag exists because `target="_blank"` silently dead-ends inside a WebView, so the native head must intercept while the web head must not (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/IExternalLinkService.cs:55-59`).
  - `[Rubric §26, Front-End Security]` assesses outbound-link hygiene. The `rel="noopener noreferrer"` that protects the opener lives in the component, not here, and it is exactly the path this default leaves in charge (`ExternalLink.razor:14`).
- **Walkthrough**
  - `InterceptsLinks` (`NullExternalLinkService.cs:10`): constant `false`, the "let the anchor do its job" answer.
  - `OpenAsync(Uri uri, CancellationToken)` (`NullExternalLinkService.cs:13`): returns `Task.CompletedTask`, dropping the URI. Reached only if a caller ignores `InterceptsLinks` and calls it anyway.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). The framework routes every external link through one component so the WebView problem is solved once; on hosts without that problem the cheapest correct behavior is the browser's own.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:34`); overridden by [`BrowserExternalLinkService`](#browserexternallinkservice) (`DependencyInjection.cs:85`) and by [`MauiExternalLinkService`](#mauiexternallinkservice), which is the implementation that actually sets `InterceptsLinks` to true. `CapabilityFallbackTests` asserts the flag is false and `OpenAsync` does not throw (`CapabilityFallbackTests.cs:150`, `:156`).

### NullHapticFeedbackService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullHapticFeedbackService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IHapticFeedbackService`](#ihapticfeedbackservice): no haptics hardware, so every call is a no-op (`NullHapticFeedbackService.cs:3`).
- **Depends on**: [`IHapticFeedbackService`](#ihapticfeedbackservice); BCL `TimeSpan`.
- **Concept**: the one *synchronous* capability contract in this unit. Its members return `void`, not `Task`, because a haptic tick is a fire-and-forget hardware pulse that no caller ever waits on. That shape lets a component call `Haptics.Click()` inline in an event handler without an `await`, and this default makes doing so free everywhere.
  - `[Rubric §18, UI Architecture]` assesses separation of presentation concerns. Feedback intent ("this was a click", "this was a long press") lives in the component; how, or whether, the device expresses it lives behind the interface.
- **Walkthrough**
  - `IsSupported` (`NullHapticFeedbackService.cs:7`): constant `false`, so a settings page can hide a haptics toggle.
  - `Click()` (`NullHapticFeedbackService.cs:10-13`), `LongPress()` (`:16-19`) and `Vibrate(TimeSpan duration)` (`:22-25`): three empty bodies, each carrying the explanatory comment "No haptics on this host" so the emptiness reads as deliberate rather than unfinished.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Haptics are pure enhancement, never the carrier of information, so silently doing nothing is a complete implementation of the contract on a host without a vibrator.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:30`); [`MauiHapticFeedbackService`](#mauihapticfeedbackservice) is the native override and there is no browser implementation, so web heads keep this. `CapabilityFallbackTests` asserts all three calls are silent and non-throwing (`CapabilityFallbackTests.cs:30-43`).

### NullLocalCacheStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullLocalCacheStore.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`ILocalCacheStore`](#ilocalcachestore): nothing is cached and reads return `default` (`NullLocalCacheStore.cs:3`).
- **Depends on**: [`ILocalCacheStore`](#ilocalcachestore); BCL `Task`.
- **Concept**: the *write-succeeds, read-misses* fallback. `SetAsync` completes normally while `GetAsync` still answers `null`, which is deliberately not a contradiction: a cache write is advisory, and every caller must already handle a miss because a real cache can evict at any moment. Treating a completed write as a promise of a later hit would be a bug against any cache implementation, not just this one.
  - `[Rubric §29, Resilience & Business Continuity]` assesses degradation when a dependency is absent. Offline-first features stay compilable and runnable on a host with no local storage; they just never serve a cached document.
  - `[Rubric §12, Performance & Scalability]` assesses avoidable work. `IsAvailable` lets a feature skip building and serializing a cache payload it knows will be discarded.
- **Walkthrough**
  - `IsAvailable` (`NullLocalCacheStore.cs:7`): constant `false`.
  - `SetAsync<T>(string key, T value, CancellationToken)` (`NullLocalCacheStore.cs:10-11`): returns `Task.CompletedTask`, discarding the value.
  - `GetAsync<T>(string key, CancellationToken)` (`NullLocalCacheStore.cs:14-15`): returns `Task.FromResult<T?>(default)`, so reference types read back as `null` and value types as zero.
  - `RemoveAsync(string key, CancellationToken)` (`NullLocalCacheStore.cs:18`): `Task.CompletedTask`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Offline caching is a per-head capability (browser `localStorage`, native file or preference storage), and a Blazor Server circuit has no client-side store it can reach without JavaScript, so the default is the empty cache.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:43`); overridden by [`BrowserLocalCacheStore`](#browserlocalcachestore) (`DependencyInjection.cs:89`) and [`MauiLocalCacheStore`](#mauilocalcachestore). `CapabilityFallbackTests` writes then reads back `null` to pin the behavior (`CapabilityFallbackTests.cs:104-112`).

### NullMapNavigationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullMapNavigationService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IMapNavigationService`](#imapnavigationservice): no maps integration, so opening an address reports failure (`NullMapNavigationService.cs:3`).
- **Depends on**: [`IMapNavigationService`](#imapnavigationservice); BCL `Task`.
- **Concept**: an outcome-returning fallback in the same shape as [`NullClipboardService`](#nullclipboardservice), with no `IsSupported` probe. A `false` answer is the component's cue to leave the address as plain text rather than a tappable "open in maps" affordance.
- **Walkthrough**: one member. `OpenAddressAsync(string address, string? label, CancellationToken)` (`NullMapNavigationService.cs:7-8`) returns `Task.FromResult(false)`, ignoring both the address and the optional pin label.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Launching a map is a platform handoff (a native maps app, or a maps URL in a new tab), and a head that has neither should not fabricate one.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:31`); overridden by [`BrowserMapNavigationService`](#browsermapnavigationservice) (`DependencyInjection.cs:90`) and [`MauiMapNavigationService`](#mauimapnavigationservice). Covered in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:142`).

### NullPushRegistrationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushRegistrationService.cs:7` · Level 1 · class (sealed)

- **What it is**: the no-op push registration for [`IPushRegistrationService`](#ipushregistrationservice). Its summary explains why that is sufficient rather than a gap: web heads receive real-time notifications over the SignalR hub while the page is open and have no OS-level installation to manage (`NullPushRegistrationService.cs:3-6`).
- **Depends on**: [`IPushRegistrationService`](#ipushregistrationservice); BCL `Task`.
- **Concept**: the *two-half* capability. Native push needs both a registration service and a token provider, and the framework defaults both to inert but replaces them at different times: `MMCA.Common.UI.Maui` overrides this registration service, while the token provider stays [`NullPushDeviceTokenProvider`](#nullpushdevicetokenprovider) until the app supplies real FCM/APNs credentials, so even a native head is registered-but-tokenless out of the box (`DependencyInjection.cs:45-49`). Reading those two defaults together is what makes the push pipeline's staged activation legible.
  - `[Rubric §22, Responsive / Cross-Browser]` assesses per-head behavior. Web heads are not degraded here, they use a different delivery channel entirely (the SignalR hub), so `IsSupported` false means "no OS registration to do", not "no notifications".
- **Walkthrough**
  - `IsSupported` (`NullPushRegistrationService.cs:10`): constant `false`; the notification-settings UI hides the native-push toggle.
  - `RegisterAsync(CancellationToken)` (`NullPushRegistrationService.cs:13`): `Task.FromResult(false)`, reporting that no registration was established.
  - `UnregisterAsync(CancellationToken)` (`NullPushRegistrationService.cs:16`): `Task.CompletedTask`. Unregistering something that was never registered is a success, not a failure, which is why the two members differ in return shape.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), cited in the class summary (`NullPushRegistrationService.cs:4`). Native push delivery is an additional channel layered on the existing hub, so the absence of a device registration must never be treated as the absence of notifications.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:48`), directly beside its token-provider counterpart (`:49`); [`MauiPushRegistrationService`](#mauipushregistrationservice) is the native override.
- **Caveats / not-in-source**: unlike its siblings this class has no case in `CapabilityFallbackTests`; its behavior is covered only through the DI defaults and the native override's own tests.

### NullScreenshotService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullScreenshotService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IScreenshotService`](#iscreenshotservice): screen capture unavailable (`NullScreenshotService.cs:3`).
- **Depends on**: [`IScreenshotService`](#iscreenshotservice); BCL `Task`.
- **Concept**: probe-plus-nullable-result, the same pairing as [`NullBarcodeScannerService`](#nullbarcodescannerservice): `IsSupported` steers the UI and the operation still answers safely for a caller that ignores it. The returned `string?` is a file path, so `null` means "no file was written" and there is nothing for the caller to clean up.
- **Walkthrough**
  - `IsSupported` (`NullScreenshotService.cs:7`): constant `false`.
  - `CaptureToFileAsync(CancellationToken)` (`NullScreenshotService.cs:10-11`): returns `Task.FromResult<string?>(null)`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Capturing the screen is a native-only operation with privacy weight, and there is no browser equivalent the framework wires, so this default is what every web head runs.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:38`); [`MauiScreenshotService`](#mauiscreenshotservice) is the only override. Covered in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:145`).

### NullShareService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullShareService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`IShareService`](#ishareservice): the platform share sheet is unavailable, and the summary names the intended consequence, callers fall back to copy-link (`NullShareService.cs:3`).
- **Depends on**: [`IShareService`](#ishareservice); BCL `Uri` and `Task`.
- **Concept**: a fallback whose `false` return is a *hand-off signal* between two capabilities. A share button that gets `false` from `ShareLinkAsync` is expected to copy the URL through [`IClipboardService`](#iclipboardservice) instead, so the two contracts compose into one user-visible affordance that behaves sensibly wherever it lands, including on a host where both are null (there the copy also reports failure and the UI says so).
  - `[Rubric §18, UI Architecture]` assesses how presentation decisions are layered. The share-or-copy choice lives in the component, driven by a returned outcome rather than by host detection.
- **Walkthrough**
  - `ShareLinkAsync(string title, Uri uri, CancellationToken)` (`NullShareService.cs:7-8`): `Task.FromResult(false)`.
  - `ShareFileAsync(string title, string filePath, string contentType, CancellationToken)` (`NullShareService.cs:11-12`): `Task.FromResult(false)`. Note it takes a path plus a MIME type rather than a stream, so the null implementation owns no resource and has nothing to dispose.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). `navigator.share` is not universally available even in browsers, so the contract already had to model "sharing did not happen" as an ordinary outcome; the null default is that outcome, always.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:28`); overridden by [`BrowserShareService`](#browsershareservice) (`DependencyInjection.cs:83`) and [`MauiShareService`](#mauishareservice). Both members are asserted false in `CapabilityFallbackTests` (`CapabilityFallbackTests.cs:14-21`).

### NullSpeechToTextService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullSpeechToTextService.cs:6` · Level 1 · class (sealed)

- **What it is**: the default [`ISpeechToTextService`](#ispeechtotextservice): no recognizer, so components hide the microphone (`NullSpeechToTextService.cs:5`).
- **Depends on**: [`ISpeechToTextService`](#ispeechtotextservice); externals `System.Globalization.CultureInfo` (`NullSpeechToTextService.cs:1`) and BCL `IProgress<T>`.
- **Concept**: the fallback for a *streaming* contract. `ListenAsync` normally reports interim transcripts through an `IProgress<string>` callback while the user speaks and returns the final text at the end. The null implementation simply never invokes the progress reporter and returns `null`, so a caller bound to partial results receives nothing at all rather than an empty-string flicker, and the final `null` reads as "nothing was recognized".
  - `[Rubric §21, Accessibility]` assesses alternative input paths. Voice entry is an accessibility affordance, and this default is where it is absent, which is why `IsSupported` exists to hide the microphone rather than leaving a dead button on the form.
- **Walkthrough**
  - `IsSupported` (`NullSpeechToTextService.cs:9`): constant `false`.
  - `ListenAsync(CultureInfo culture, IProgress<string>? partialResults, CancellationToken)` (`NullSpeechToTextService.cs:12-16`): returns `Task.FromResult<string?>(null)`, ignoring the requested recognition culture and never calling back into `partialResults`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Speech recognition is a platform service with a microphone permission attached, so an unavailable recognizer must be an ordinary, prompt-free `null` rather than an exception a form has to handle.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:41`); [`MauiSpeechToTextService`](#mauispeechtotextservice) is the native override. ADC registers it explicitly in a bUnit test so the live-channel page renders without a recognizer (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Pages/LiveChannelJoinTests.cs:58-59`), and `CapabilityFallbackTests` pins the `null` result (`CapabilityFallbackTests.cs:146-147`).

### NullTextToSpeechService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullTextToSpeechService.cs:4` · Level 1 · class (sealed)

- **What it is**: the default [`ITextToSpeechService`](#itexttospeechservice): no synthesizer, so components hide the affordance (`NullTextToSpeechService.cs:3`).
- **Depends on**: [`ITextToSpeechService`](#itexttospeechservice); BCL `Task`.
- **Concept**: the read-aloud counterpart to [`NullSpeechToTextService`](#nullspeechtotextservice), and the one place in this unit where a *stop* operation has to stay safe. `StopAsync` completes normally even though nothing was ever speaking, because the caller's teardown path (a component disposing while audio might be playing) must not need to know whether playback ever started.
  - `[Rubric §21, Accessibility]` assesses alternative output paths. Read-aloud is distinct from the screen-reader channel behind [`IAccessibilityAnnouncer`](#iaccessibilityannouncer): this one is user-invoked content playback, and it is simply absent on hosts that keep this default.
- **Walkthrough**
  - `IsSupported` (`NullTextToSpeechService.cs:7`): constant `false`.
  - `SpeakAsync(string text, CancellationToken)` (`NullTextToSpeechService.cs:10`): `Task.CompletedTask`, discarding the text.
  - `StopAsync()` (`NullTextToSpeechService.cs:13`): `Task.CompletedTask`. It takes no cancellation token, matching the contract: stopping is itself the cancellation.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Synthesis is a platform service with no framework-wired browser equivalent, and the affordance is an enhancement, so the inert default costs the feature nothing but the button.
- **Where it's used**: `TryAddSingleton` in `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:35`); [`MauiTextToSpeechService`](#mauitexttospeechservice) is the native override. `CapabilityFallbackTests` asserts `IsSupported` is false and that both calls are non-throwing (`CapabilityFallbackTests.cs:149`, `:153-154`).

### NullGeocodingService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullGeocodingService.cs:4` · Level 2 · class

- **What it is** - the inert default for [`IGeocodingService`](#igeocodingservice): a geocoder that geocodes nothing. It reports itself unsupported and hands back `null` for every address, which is exactly the "no coordinate hint available" state the contract is designed around.
- **Depends on** - implements [`IGeocodingService`](#igeocodingservice); returns [`GeoPoint`](#geopoint)`?`. No other first-party or external dependency beyond `System.Threading.Tasks` (`Task.FromResult`).
- **Concept introduced - the null-object capability fallback.** This is the first of five inert "Null…" defaults in this unit, so teach the shape once here. Every device capability in this group is an interface (biometrics, geolocation, media picking, push, and so on), and shared Blazor components resolve those interfaces directly. But a plain web head has no native geocoder, and a prerendering circuit has no JavaScript yet, so *something* must be in the container or resolution throws. The framework fills the container with a Null-Object implementation for every contract (the [Null Object pattern](00-primer.md#3-conventions-and-idioms): a real, substitutable instance whose methods do nothing observable rather than a `null` reference). The two moving parts here are the `IsSupported` flag (a component reads it and hides the affordance) and the operation itself (a component that ignores `IsSupported` and calls anyway still gets a safe, `null` answer, never an exception). `AddDeviceCapabilityDefaults` `TryAdd`-registers this class as a singleton (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:33`), and a native or richer head later overrides it with a plain `Add`, so last-registration-wins swaps the real implementation in without the shared component knowing.
  - [Rubric §2 - Design Patterns] §2 assesses whether classic patterns are applied where they earn their keep; this is a textbook Null Object, a do-nothing implementation that removes null-checks from every caller.
  - [Rubric §1 - SOLID] §1 assesses SOLID adherence; the substitutability here is Liskov and Dependency-Inversion in practice, components depend on the abstraction and any implementation (null or native) satisfies it interchangeably.
  - [Rubric §22 - Responsive / Cross-Browser] §22 assesses graceful behavior across heads and browsers; the null default is what lets one shared component tree run unchanged on web, where geocoding does not exist.
- **Walkthrough** - `sealed class` implementing the interface (`NullGeocodingService.cs:4`). `IsSupported => false` (`NullGeocodingService.cs:7`) tells callers to omit the distance hint entirely. `GeocodeAsync` (`NullGeocodingService.cs:10`) ignores its `address` and `cancellationToken` arguments and returns `Task.FromResult<GeoPoint?>(null)`, an already-completed task, so there is no allocation of a real async state machine and no thread hop.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) (device capability abstraction). The domain model deliberately stores addresses, not coordinates, so geocoding is a pure presentation-time convenience; making the unsupported case a first-class `null` (rather than an exception or a feature flag the caller must check) keeps proximity hints optional everywhere.
- **Where it's used** - registered by `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:33`) and resolved by any component that shows a "distance from venue" hint. The MAUI head replaces it with `MauiGeocodingService`; there is no browser override, so web heads keep this null default.

### NullGeolocationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullGeolocationService.cs:4` · Level 2 · class

- **What it is** - the inert default for [`IGeolocationService`](#igeolocationservice): no location source. It reports unsupported and returns `null` for the current position, so a caller simply omits any proximity hint.
- **Depends on** - implements [`IGeolocationService`](#igeolocationservice); returns [`GeoPoint`](#geopoint)`?`. Same null-object shape as [`NullGeocodingService`](#nullgeocodingservice) (see there for the pattern).
- **Concept introduced** - none new; this is the sibling of [`NullGeocodingService`](#nullgeocodingservice) for the "where is *this device*" half of the location story (geocoding turns an address into a point, geolocation reads the device's own point). The same [Rubric §1 - SOLID], [Rubric §2 - Design Patterns], and [Rubric §22 - Responsive / Cross-Browser] notes apply.
- **Walkthrough** - `sealed class` (`NullGeolocationService.cs:4`). `IsSupported => false` (`NullGeolocationService.cs:7`). `GetCurrentOrLastKnownAsync` (`NullGeolocationService.cs:10`) returns `Task.FromResult<GeoPoint?>(null)`; because it never touches the platform it also never fires the OS permission prompt that the real contract warns about, which is the desired behavior on a head that cannot honor it.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). Location is opt-in and best-effort by contract (permission denial and timeout also yield `null`), so a head with no location provider is just the permanent version of that same "no fix" outcome.
- **Where it's used** - registered by `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:32`). The MAUI head overrides it with `MauiGeolocationService`; web heads keep this default (there is no browser geolocation implementation in `AddBrowserDeviceCapabilities`).

### NullLocalNotificationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullLocalNotificationService.cs:4` · Level 2 · class

- **What it is** - the inert default for [`ILocalNotificationService`](#ilocalnotificationservice): on-device notification scheduling is unavailable. It denies permission and swallows every schedule/cancel call, and hosts read `IsSupported` to hide the reminder-settings UI entirely.
- **Depends on** - implements [`ILocalNotificationService`](#ilocalnotificationservice); accepts [`LocalNotificationRequest`](#localnotificationrequest) and `IReadOnlyCollection<int>` ids. Null-object shape shared with the geo siblings above.
- **Concept introduced** - none new, but note the two-signal contract this default has to satisfy cleanly. Scheduling notifications is native-only (no browser equivalent that the framework wires), so the default has to make both the *capability probe* and the *actions* safe: `IsSupported` false steers the UI, and the action methods are no-ops so a caller that skips the probe still cannot crash. Same [Rubric §2 - Design Patterns] and [Rubric §22 - Responsive / Cross-Browser] framing as [`NullGeocodingService`](#nullgeocodingservice).
- **Walkthrough** - `sealed class` (`NullLocalNotificationService.cs:4`). `IsSupported => false` (`NullLocalNotificationService.cs:7`). `RequestPermissionAsync` returns `Task.FromResult(false)` (`NullLocalNotificationService.cs:10`), reporting permission as not granted so callers never attempt to schedule. `ScheduleAsync` (`NullLocalNotificationService.cs:14`), `CancelAsync` (`NullLocalNotificationService.cs:18`), and `CancelAllAsync` (`NullLocalNotificationService.cs:22`) each return `Task.CompletedTask`, doing nothing with their arguments.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html). The real contract already specifies that scheduling without permission is a no-op, so the null default is that rule taken to its limit (permission is never granted, therefore nothing is ever scheduled), which keeps reminder features degradable to nothing on web without any conditional code in the feature.
- **Where it's used** - registered by `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:37`); overridden by `MauiLocalNotificationService` on native heads. Web and Server heads keep this default.

### NullMediaPickerService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullMediaPickerService.cs:7` · Level 2 · class

- **What it is** - the no-op default for [`IMediaPickerService`](#imediapickerservice) (avatar photo pick/capture). It reports the native picker unavailable and returns `null` from both operations, which for web heads means "render a plain `InputFile` instead," not a degraded experience.
- **Depends on** - implements [`IMediaPickerService`](#imediapickerservice); returns [`PickedMedia`](#pickedmedia)`?`. Same null-object shape as the siblings above.
- **Concept introduced** - the "affordance switch, not a degraded path" nuance. Unlike geocoding (which simply vanishes when unsupported), media picking has a full web alternative: the browser's own `<InputFile>`. So `IsSupported` false here does not mean "you cannot upload a photo," it means "do not draw the *native* picker button; the component draws the standard file input instead." The null default's job is only to signal that switch. Same [Rubric §2 - Design Patterns] and [Rubric §1 - SOLID] framing as [`NullGeocodingService`](#nullgeocodingservice); additionally [Rubric §18 - UI Architecture], which assesses how presentation concerns are separated, is visible here because the choice between native picker and `InputFile` is driven by a resolved capability rather than by host-detection code inside the component.
- **Walkthrough** - `sealed class` (`NullMediaPickerService.cs:7`). `IsSupported => false` (`NullMediaPickerService.cs:10`). `PickPhotoAsync` (`NullMediaPickerService.cs:13`) and `CapturePhotoAsync` (`NullMediaPickerService.cs:17`) both return `Task.FromResult<PickedMedia?>(null)`. Because they return `null` rather than a live `PickedMedia`, there is no `Stream` to dispose, matching the "dispose after upload" ownership rule the real type documents.
- **Why it's built this way** - [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) (managed file storage and avatars), cited directly in the class summary (`NullMediaPickerService.cs:4`). Web avatar upload rides on `InputFile`, so the native picker abstraction exists only to give MAUI heads a camera/library flow; making the default inert keeps the shared avatar component host-agnostic.
- **Where it's used** - registered by `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:52`); overridden by `MauiMediaPickerService` on native heads. Web and Server heads keep this default and fall back to `InputFile`.

### NullPushDeviceTokenProvider

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushDeviceTokenProvider.cs:9` · Level 2 · class

- **What it is** - a push token provider that never produces a token: [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) implemented to always return `null`. It is the default *everywhere*, including native heads, until an app plugs in a credentialed Firebase/APNs provider.
- **Depends on** - implements [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider); returns [`PushDeviceToken`](#pushdevicetoken)`?`. Null-object shape shared with the siblings above, but note the different default reach (see below).
- **Concept introduced - inert-but-wired, distinct from unsupported.** The earlier nulls in this unit mean "this head cannot do X." This one is subtler: it is the default even on native heads that *can* receive push, because push also needs external credentials (an FCM/APNs key) that a plain build does not carry. Returning `null` leaves the entire registration pipeline present and correctly ordered but dormant, which is precisely the state a build without push credentials should sit in. Swapping in a real provider (a plain `Add` after the defaults) activates the pipeline with no other change. Note there is no `IsSupported` probe on this contract at all; token presence *is* the signal. Same [Rubric §2 - Design Patterns] framing as [`NullGeocodingService`](#nullgeocodingservice); [Rubric §7 - Microservices Readiness / composition] is loosely relevant in that the token source is a pluggable edge dependency the app supplies rather than framework-baked.
- **Walkthrough** - `sealed class` (`NullPushDeviceTokenProvider.cs:9`). A single method, `GetTokenAsync` (`NullPushDeviceTokenProvider.cs:12`), returns `Task.FromResult<PushDeviceToken?>(null)`. There is deliberately no `IsSupported` member; the contract has none.
- **Why it's built this way** - [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) (native push delivery), cited in the class summary (`NullPushDeviceTokenProvider.cs:4`). The registration path is split into two overridable pieces on purpose: `MMCA.Common.UI.Maui` overrides the *registration service* while the *token provider* stays null until the app supplies real credentials, so even native heads are registered-but-tokenless out of the box (`DependencyInjection.cs:45`).
- **Where it's used** - registered by `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:49`), alongside [`NullPushRegistrationService`](#nullpushregistrationservice). Consumed by the push registration flow; an app overrides it once real FCM/APNs credentials exist.

### WebFormFactor

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common.UI.Web/Services/WebFormFactor.cs:12` · Level 1 · class (sealed)

- **What it is**: the Blazor Server implementation of [`IFormFactor`](#iformfactor), the one-interface contract that lets shared UI ask which host it is running on. It reports the literal string `"Web"` because this code executes on the server, during SSR prerender and in interactive Server render mode.
- **Depends on**: first-party, only the [`IFormFactor`](#iformfactor) contract it implements, imported from `MMCA.Common.UI.Services` (`WebFormFactor.cs:1,12`). Externals: `System.Environment` (BCL) for the OS description. The type holds no app-specific state, which is exactly why it was hoisted out of the individual Blazor Web hosts into the shared package (`WebFormFactor.cs:7-9`).
- **Concept introduced**: **host-selected capability implementation**, in its smallest possible form. One interface, and a different concrete class registered per host at DI composition time, is the mechanism the entire device-capability layer is built on; `IFormFactor` shows it with a two-method contract and no platform API at all. The three bodies are this class for Blazor Server, [`WasmFormFactor`](#wasmformfactor) in MMCA.Common.UI for WebAssembly, and [`MauiFormFactor`](#mauiformfactor) in MMCA.Common.UI.Maui for the native head; the XML doc names all three so a reader lands on the family from any member (`WebFormFactor.cs:8-9`). Consuming components depend only on the interface, and the host composition root picks the body.
  - `[Rubric §18, UI Architecture]` §18 assesses how cleanly presentation concerns are layered and how portable components are across render hosts. A one-method contract with three swappable bodies keeps every consuming component host-agnostic.
  - `[Rubric §22, Responsive / Cross-Browser]` §22 assesses how the app adapts to device and environment. `GetFormFactor()` is the coarse signal a component branches on when server-rendered behavior must differ from WASM or native.
- **Walkthrough**: the class is `sealed` and stateless (`WebFormFactor.cs:12`). `GetFormFactor()` returns the constant `"Web"` (`WebFormFactor.cs:15`); it is a constant rather than a probe because Blazor Server always executes this code server-side, so there is nothing to detect. `GetPlatform()` returns `Environment.OSVersion.ToString()` (`WebFormFactor.cs:18`), the server OS description.
- **Why it's built this way**: prerender and interactive Server render both run on the server, so no reliable client-device signal exists at this layer; answering `"Web"` plus the server OS is the honest answer for this host rather than a guess about the browser. Keeping the type stateless and app-neutral is what allowed it to move up into `MMCA.Common.UI.Web` and be shared by every Blazor Web host ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered by the Blazor Server host through `AddCommonWebFormFactor()`, which binds `IFormFactor` to this class as a singleton (`MMCA.Common.UI.Web/DependencyInjection.cs:47-48`); the same XML doc points the WASM client at `AddWasmFormFactor()` from MMCA.Common.UI instead (`MMCA.Common.UI.Web/DependencyInjection.cs:43-45`). Resolved by any shared component that injects [`IFormFactor`](#iformfactor) to branch on the current host.
- **Caveats / not-in-source**: `GetPlatform()` reports the *server* OS, not the browser or the client device. Do not read it as a client fingerprint.

### MainPageBase

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/MainPageBase.cs:20` · Level 2 · class (abstract)

- **What it is**: the base `ContentPage` for a MAUI Blazor Hybrid head whose XAML hosts a single `BlazorWebView`. It intercepts the platform back gesture (Android hardware back, iOS swipe) and forwards it into the WebView's own history stack, quitting the app only when the WebView has nowhere left to go (`MainPageBase.cs:7-11,20`).
- **Depends on**: first-party, [`MauiBackNavigationBridge`](group-15-common-ui-framework.md#mauibacknavigationbridge) and its [`BackNavigationResult`](group-15-common-ui-framework.md#backnavigationresult) return type, imported from `MMCA.Common.UI.Services.Navigation` (`MainPageBase.cs:3,69`). Externals: `ContentPage`, `MainThread` and `Application.Current` (MAUI), `Microsoft.AspNetCore.Components.WebView.Maui.BlazorWebView` (`MainPageBase.cs:1`), and `Microsoft.JSInterop.IJSRuntime` (`MainPageBase.cs:2`).
- **Concept introduced**: **a native gesture routed into web history.** A hybrid head has two navigation stacks that know nothing about each other: the native page stack and the WebView's `history`. Without this base, Android's back button pops the native stack, and since a hybrid head has exactly one page that means the app exits no matter how deep the Blazor router has navigated. This type turns the native gesture into a question asked of the web stack first, and treats "exit the app" as the answer of last resort.
  - `[Rubric §25, Navigation & IA]` §25 assesses whether navigation intent is modeled coherently across every entry point. Funnelling the hardware gesture through the same history the Blazor router drives keeps one navigation model instead of two competing ones.
  - `[Rubric §18, UI Architecture]` §18 assesses how much host-specific plumbing leaks into app code. Because the base owns the whole interception, a head adopts it in two edits: point the XAML root element at this type, and override `HostWebView` to return the `x:Name`d control (`MainPageBase.cs:12-18`).
  - `[Rubric §29, Resilience & Business Continuity]` §29 assesses graceful behavior at edge states. Every failure path here (WebView not hydrated, dispatch refused, interop threw) ends in a clean quit rather than a swallowed gesture or an unhandled exception.
- **Walkthrough**: `HostWebView` is an abstract protected property (`MainPageBase.cs:27`): the XAML-generated `x:Name` field is private to the derived partial class, so the base can only reach the control through an override. `OnBackButtonPressed()` (`MainPageBase.cs:30-35`) starts `HandleBackAsync()` without awaiting it and returns `true`, which consumes the gesture immediately and moves the decision off the UI thread. `HandleBackAsync()` (`MainPageBase.cs:46`) then bridges a synchronous API to async work: `BlazorWebView` only exposes the `Action<IServiceProvider>` dispatch overload, so the method creates a `TaskCompletionSource<IJSRuntime?>` (`MainPageBase.cs:53`), calls `HostWebView.TryDispatchAsync(...)` with the tiny `CaptureJsRuntime` callback that resolves the renderer-scoped `IJSRuntime` into that source (`MainPageBase.cs:37-38,54`), and awaits the task outside the dispatch context (`MainPageBase.cs:62`). Two guards quit early: dispatch refused (`MainPageBase.cs:56-60`) and a null `IJSRuntime` (`MainPageBase.cs:63-67`). Otherwise it delegates to `MauiBackNavigationBridge.HandleBackPressedAsync(jsRuntime)` and quits only when the returned result reports `AtRoot` (`MainPageBase.cs:69-73`). Quitting is a two-hop helper: `QuitApp()` marshals back with `MainThread.BeginInvokeOnMainThread` (`MainPageBase.cs:40-41`) and `QuitOnMainThread()` calls `Application.Current?.Quit()` (`MainPageBase.cs:43-44`). A deliberate catch-all wraps the whole body with CA1031 suppressed and the reason inline, the interop failure modes differ per platform and none of them are recoverable here, degrading to a clean exit (`MainPageBase.cs:75-81`).
- **Why it's built this way**: the bridge itself lives in `MMCA.Common.UI` so the JS interop module ships with the shared UI package, and this page is the thin native adapter over it. The bridge reports `Handled`/`AtRoot` rather than navigating on its own, precisely so the native side decides what "no history left" means, and it already converts its own interop failures into `AtRoot: true`, so both layers agree on the fail-safe direction: when in doubt, treat the WebView as being at its root. Owning no XAML of its own keeps the base adoptable by any head regardless of what that head's page declares (`MainPageBase.cs:12-18`).
- **Where it's used**: both MAUI heads derive from it. ADC names the base in code-behind (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml.cs:12-17`), and Store's code-behind declares no base at all because the XAML root element supplies it, leaving only the `HostWebView` override (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MainPage.xaml.cs:10-16`).
- **Caveats / not-in-source**: whether a given gesture reaches `OnBackButtonPressed` at all is platform behavior, not visible here (the class doc states Android hardware back and the iOS swipe, `MainPageBase.cs:9-11`). Not determinable from source in this unit: the `tryGoBack()` JavaScript helper that actually inspects the history stack; it is a JS asset shipped with MMCA.Common.UI, not C#.

### DependencyInjection

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/DependencyInjection.cs:16` · Level 3 · class (static)

- **What it is**: the service-level registration surface for the MAUI native device-capability layer ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). It binds every capability contract the framework backs natively to its MAUI implementation (`AddMauiDeviceCapabilities()`), and adds two deliberately separate opt-ins: OS-SecureStorage token storage (`AddCommonMauiTokenStorage()`) and the native [`IFormFactor`](#iformfactor) (`AddMauiFormFactor()`).
- **Depends on**: first-party, the capability contract set in `MMCA.Common.UI.Services.Capabilities` with their `Maui*` bodies in `MMCA.Common.UI.Maui.Capabilities`, plus `MMCA.Common.UI.Services` and `MMCA.Common.UI.Services.Auth` for [`IFormFactor`](#iformfactor) and [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (`DependencyInjection.cs:1-5`). Externals: `IServiceCollection` as the extended type.
- **Concept introduced**: **`extension(IServiceCollection)` registration blocks, and lifetime choice as documented intent.** The class is `static` (`DependencyInjection.cs:16`) and every member lives inside an `extension(IServiceCollection services)` block (`DependencyInjection.cs:18`), the C# preview extension-member syntax this codebase uses for DI registration everywhere (see the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)); the methods appear as instance methods on `IServiceCollection` at the call site. Two lifetimes appear here and the code explains both: **singleton** for the capability services because a MAUI head is single-user and the stateful ones (connectivity, battery) wrap app-global platform events (`DependencyInjection.cs:28-29`), and **scoped** for [`IExternalAuthBroker`](#iexternalauthbroker), which navigates through the circuit's `NavigationManager` after a system-browser round trip (`DependencyInjection.cs:57-59`), and for token storage so component code sees one lifetime across every head (`DependencyInjection.cs:68-71`).
  - `[Rubric §1, SOLID]` §1 assesses dependency inversion in practice. Every consumer depends on a capability interface and never on a MAUI type, which is what makes the browser and fallback adapters in this group drop-in substitutes.
  - `[Rubric §10, Cross-Cutting]` §10 assesses whether infrastructure concerns are composed in one place instead of scattered. A single extension method carries the entire native binding set, so a head's `MauiProgram` stays short and no capability can be silently forgotten.
- **Walkthrough**: `AddMauiDeviceCapabilities()` (`DependencyInjection.cs:26`) registers seventeen capability contracts as singletons in one block (`DependencyInjection.cs:30-46`): connectivity, battery, share, clipboard, haptics, map navigation, geolocation, geocoding, external links, text-to-speech, accessibility announcer, local notifications, screenshot, device preferences, local cache, biometrics, and speech-to-text. Three further registrations carry conditions and are commented for it. [`IPushRegistrationService`](#ipushregistrationservice) is bound to [`MauiPushRegistrationService`](#mauipushregistrationservice) but yields nothing until the app registers a credentialed [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider), so it is wired-but-inert out of the box ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), `DependencyInjection.cs:48-51`). [`IMediaPickerService`](#imediapickerservice) is bound to [`MauiMediaPickerService`](#mauimediapickerservice), whose capture path prompts for the camera permission the head must declare, Android `CAMERA` plus the iOS usage strings ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), `DependencyInjection.cs:53-55`). [`IExternalAuthBroker`](#iexternalauthbroker) is `AddScoped` to [`MauiExternalAuthBroker`](#mauiexternalauthbroker) and stays inert (`IsAvailable == false`) until the head configures `OAuth:MobileRedirectScheme` and registers the platform callback (`DependencyInjection.cs:57-60`). The method returns `services` for chaining (`DependencyInjection.cs:61`). `AddCommonMauiTokenStorage()` (`DependencyInjection.cs:73-74`) binds `ITokenStorageService` to [`MauiTokenStorageService`](#mauitokenstorageservice), which keeps both tokens in the platform secure enclave and guards every read and write so an OS-invalidated keystore entry degrades to one clean re-login instead of a launch-time throw (`DependencyInjection.cs:65-71`). `AddMauiFormFactor()` (`DependencyInjection.cs:82-83`) binds [`IFormFactor`](#iformfactor) to [`MauiFormFactor`](#mauiformfactor) as a singleton.
- **Why it's built this way**: the class doc is explicit that these are plain `Add` calls (not `TryAdd`) and must run **after** `AddUIShared`, so the native bodies override the shared fallback defaults under last-registration-wins (`DependencyInjection.cs:10-14`). That is the whole selection mechanism of [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): the shared package always `TryAdd`-registers an inert default so the DI graph resolves on every host, and a native head simply overwrites the entries it can do better. Splitting token storage and form factor into their own methods (`DependencyInjection.cs:64-83`) preserves that same override control per concern for a head that wants its own implementation. Token storage is scoped rather than singleton purely to match its browser siblings, `AddCommonServerTokenStorage()` in MMCA.Common.UI.Web and the WASM [`WasmTokenStorageService`](group-15-common-ui-framework.md#wasmtokenstorageservice), so component code depends on one lifetime everywhere (`DependencyInjection.cs:68-71`).
- **Where it's used**: called by [`HostingDependencyInjection`](#hostingdependencyinjection)'s `UseMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:32`), the builder-level entry point the class doc steers heads toward (`DependencyInjection.cs:10-12`). `AddCommonMauiTokenStorage()` and `AddMauiFormFactor()` are called directly by each MAUI head: ADC at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:125,131` and Store at `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:88,94`.
- **Caveats / not-in-source**: "wired but inert" is a real runtime state for push registration, media capture, and external auth. Registration does not imply the capability works without the extra host configuration each comment names. Not determinable from source in this unit: the bodies of the individual `Maui*Service` implementations, which the other units of this group cover.

### DeviceCapabilitiesInitializer

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:14` · Level 3 · class (sealed)

- **What it is**: a MAUI startup hook that bridges local-notification taps into Blazor routing. It implements `IMauiInitializeService`, so its `Initialize` runs while the MAUI app is being built, and it forwards the route carried by a tapped reminder to the shared [`IDeepLinkDispatcher`](#ideeplinkdispatcher).
- **Depends on**: first-party, [`IDeepLinkDispatcher`](#ideeplinkdispatcher) from `MMCA.Common.UI.Services.Capabilities` (`DeviceCapabilitiesInitializer.cs:1,21`). Externals: `IMauiInitializeService` (MAUI hosting), and `Plugin.LocalNotification` with its `NotificationActionEventArgs` (`DeviceCapabilitiesInitializer.cs:2-3`).
- **Concept introduced**: **cold-start deep-link buffering.** This type is the native publisher end of the deep-link funnel; the receiver end is the shared `DeepLinkListener` component rendered in the layout. A tap that arrives while the app is running travels live through [`IDeepLinkDispatcher`](#ideeplinkdispatcher); a tap that cold-starts the process arrives before the Blazor router exists, so the dispatcher buffers the pending route until first render and the listener drains it (`DeviceCapabilitiesInitializer.cs:8-12`).
  - `[Rubric §25, Navigation & IA]` §25 assesses how navigation intent flows through the app. Routing every native entry point through one dispatcher keeps the Blazor router the single source of truth for where the user lands.
  - `[Rubric §29, Resilience & Business Continuity]` §29 assesses graceful handling of edge states. The cold-start buffer is what stops a tap that launched the process from being lost before there is anything to navigate.
- **Walkthrough**: the class is `sealed` (`DeviceCapabilitiesInitializer.cs:14`). `Initialize(IServiceProvider services)` null-guards its argument (`DeviceCapabilitiesInitializer.cs:17-19`), then resolves [`IDeepLinkDispatcher`](#ideeplinkdispatcher) with `GetService` rather than `GetRequiredService` and returns early when none is registered (`DeviceCapabilitiesInitializer.cs:21-25`), so a head without the dispatcher gets a no-op instead of a startup crash. When one is present it subscribes to `LocalNotificationCenter.Current.NotificationActionTapped` with a lambda closing over the resolved dispatcher (`DeviceCapabilitiesInitializer.cs:27`). The static handler `OnNotificationTapped` (`DeviceCapabilitiesInitializer.cs:30`) ignores dismissals (`DeviceCapabilitiesInitializer.cs:32-35`), reads the app-relative route from `args.Request?.ReturningData` (`DeviceCapabilitiesInitializer.cs:37`), and publishes only when that route is non-blank (`DeviceCapabilitiesInitializer.cs:38-41`).
- **Why it's built this way**: notification metadata is not routing. Translating the plugin's tap event into this codebase's own [`IDeepLinkDispatcher`](#ideeplinkdispatcher) vocabulary here means the shared listener component never references `Plugin.LocalNotification`, so the same component works on hosts that have no notification plugin at all ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Wiring it as an `IMauiInitializeService` establishes the subscription exactly once, at app build time, before any UI renders. The defensive early return is what makes the hook safe to register unconditionally, which is why [`HostingDependencyInjection`](#hostingdependencyinjection) can add it with no condition.
- **Where it's used**: registered by [`HostingDependencyInjection`](#hostingdependencyinjection) as an `IMauiInitializeService` singleton inside `UseMauiDeviceCapabilities()` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:33`); the routes it publishes are consumed through [`IDeepLinkDispatcher`](#ideeplinkdispatcher) (implemented by [`DeepLinkDispatcher`](#deeplinkdispatcher)) by the shared `DeepLinkListener` component.
- **Caveats / not-in-source**: the route contract is entirely `ReturningData` on the scheduled notification, so a reminder created without an app-relative route in that field produces no navigation. Not determinable from source in this unit: the `DeepLinkListener` component body and the scheduling code that populates `ReturningData`, both outside this unit.

### HostingDependencyInjection

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:14` · Level 4 · class (static)

- **What it is**: the `MauiAppBuilder`-level entry point for the device-capability layer ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) and the hybrid culture wiring ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). `UseMauiDeviceCapabilities()` composes the service registrations plus the platform hooks that need the builder itself, `UseCommonBarcodeScanner(...)` is the opt-in camera-scanning add-on (two overloads), and `UseMauiCulture()` is the separately callable culture half.
- **Depends on**: first-party, [`DependencyInjection`](#dependencyinjection)'s `AddMauiDeviceCapabilities()` (`HostingDependencyInjection.cs:32`), [`DeviceCapabilitiesInitializer`](#devicecapabilitiesinitializer) (`HostingDependencyInjection.cs:33`), [`MauiBarcodeScannerService`](#mauibarcodescannerservice) behind [`IBarcodeScannerService`](#ibarcodescannerservice) (`HostingDependencyInjection.cs:100-101`), and the globalization pair [`MauiCultureApplier`](#mauicultureapplier) / [`MauiCultureInitializer`](#mauicultureinitializer) behind [`ICultureApplier`](group-15-common-ui-framework.md#icultureapplier) (`HostingDependencyInjection.cs:1-2,118-119`). Externals: `MauiAppBuilder` as the extended type, `Plugin.LocalNotification`'s `UseLocalNotification()` (`HostingDependencyInjection.cs:5,31`), and `ZXing.Net.Maui.Controls`' `UseBarcodeReader()` (`HostingDependencyInjection.cs:6,99`).
- **Concept introduced**: **builder-level versus service-level composition.** This is the layered pairing that runs through MAUI hosting: [`DependencyInjection`](#dependencyinjection) registers services on `IServiceCollection`, while this class operates on `MauiAppBuilder` because some steps (the Plugin.LocalNotification lifecycle wiring, the ZXing handler registration, the `IMauiInitializeService` hooks) need more than a service collection. It uses the same `extension(MauiAppBuilder builder)` block syntax (`HostingDependencyInjection.cs:16`). The second concept, visible in the two `UseCommonBarcodeScanner` overloads, is **eager versus lazy text resolution**: everything in this class runs while the app is being built, which is *before* [`MauiCultureInitializer`](#mauicultureinitializer) restores the user's persisted language, so any string captured here is pinned to the device language for the life of the process (`HostingDependencyInjection.cs:56-63`).
  - `[Rubric §16, Maintainability]` §16 assesses how hard the framework is to adopt correctly. Folding four easy-to-forget steps into one fluent call removes most of the ways a head can be left half-configured.
  - `[Rubric §33, Developer Experience]` §33 assesses the ceremony a developer pays for a working host. One builder extension plus a small set of documented obligations is that ceremony, and the obligations the wrapper cannot absorb are spelled out in XML docs instead of failing silently.
  - `[Rubric §27, i18n]` §27 assesses whether localization reaches every surface. The `Func<string>` overload exists precisely so the scan page follows the in-app language switch rather than the startup device language, and the culture fold-in guarantees a hybrid head has a working applier at all.
- **Walkthrough**: `UseMauiDeviceCapabilities()` (`HostingDependencyInjection.cs:29`) does four things in order: `builder.UseLocalNotification()` initializes the notification plugin (`:31`); `builder.Services.AddMauiDeviceCapabilities()` binds every native capability (`:32`); `AddSingleton<IMauiInitializeService, DeviceCapabilitiesInitializer>()` registers the notification-tap deep-link bridge (`:33`); and `builder.UseMauiCulture()` folds in the hybrid culture wiring (`:40`). It returns `builder` for chaining (`:41`). `UseCommonBarcodeScanner(string, string)` (`HostingDependencyInjection.cs:67-70`) is the convenience overload with defaults `"Cancel"` and `"Scan a code"`; it simply forwards both values as closures to the lazy overload (`:70`), which means the strings it passes are fixed at startup. `UseCommonBarcodeScanner(Func<string>, Func<string>)` (`HostingDependencyInjection.cs:92-103`) is the localization-correct one: it null-guards both delegates (`:96-97`), calls `builder.UseBarcodeReader()` to register the ZXing.Net.MAUI handlers (`:99`), and registers [`IBarcodeScannerService`](#ibarcodescannerservice) as a singleton built from a factory that hands both delegates to [`MauiBarcodeScannerService`](#mauibarcodescannerservice) (`:100-101`), which invokes them once per scan when the page is built. `UseMauiCulture()` (`HostingDependencyInjection.cs:116-121`) does two: `AddScoped<ICultureApplier, MauiCultureApplier>()` replaces the web applier that round-trips a server `/culture/set` endpoint no hybrid head hosts (`:118`), and `AddSingleton<IMauiInitializeService, MauiCultureInitializer>()` restores the persisted culture at startup (`:119`). Calling it twice is harmless (`:110-111`).
- **Why it's built this way**: the class doc pins the ordering constraint, call this **after** `AddUIShared` in `MauiProgram.CreateMauiApp` (`HostingDependencyInjection.cs:11-12`), because [`DependencyInjection`](#dependencyinjection) uses plain `Add` to override the shared TryAdd defaults. The culture fold-in is explained in an inline comment as a deliberate cross-ADR decision (`HostingDependencyInjection.cs:35-39`): culture belongs to ADR-027 rather than ADR-042, but a hybrid head that skips it ends up with a culture switcher that navigates to a server endpoint it does not host and renders the not-found page, so wiring it here means no head can be left half-configured, while `UseMauiCulture()` stays public for a head that composes by hand. Barcode scanning is deliberately **not** folded in (`HostingDependencyInjection.cs:47-49,75-77`): a head that never scans should ship neither the camera handler nor a camera permission declaration, and the head still declares the platform permission itself (Android `CAMERA`, iOS `NSCameraUsageDescription`). One step the wrapper cannot take at all is the MauiCommunityToolkit registration: speech-to-text ([`MauiSpeechToTextService`](#mauispeechtotextservice)) depends on it, and the toolkit's MCT001 analyzer requires `.UseMauiCommunityToolkit()` to appear in the app's own `UseMauiApp<T>()` chain, so the doc states the requirement rather than hiding it (`HostingDependencyInjection.cs:22-27`).
- **Where it's used**: called once per MAUI head in `MauiProgram.CreateMauiApp`. ADC calls `UseMauiDeviceCapabilities()` right after `AddUIShared` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:83-88`) and takes the lazy barcode overload with resource lookups, after the UI module that owns the check-in surface, so the plain `Add` is the last registration to run (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:109-117`); Store calls `UseMauiDeviceCapabilities()` and no scanner (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:66`). Both heads chain `.UseMauiCommunityToolkit()` themselves (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:58`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:45`).
- **Caveats / not-in-source**: the head keeps obligations this wrapper cannot fulfill: chaining `.UseMauiCommunityToolkit()`, declaring the camera permission when it scans, and supplying the per-capability configuration each inert service needs (push credentials, `OAuth:MobileRedirectScheme`). The string overload's values never change after startup even if the user switches language later; that behavior is documented, not a bug (`HostingDependencyInjection.cs:56-63`). Not determinable from source in this unit: the scan page ZXing builds at runtime, covered with [`MauiBarcodeScannerService`](#mauibarcodescannerservice) elsewhere in this group.


---
[⬅ ADC Application Host, UI Shell & Cross-Module Composition](group-25-adc-host-composition.md)  •  [Index](00-index.md)  •  [Testing & Quality Infrastructure ➡](group-27-testing-infrastructure.md)
