# 26. Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)

**What this group covers.** A single Blazor UI codebase in `MMCA.Common.UI` renders on three
very different heads: Blazor Server (server-side render + interactive Server circuits), Blazor
WebAssembly (the whole component tree running in the browser), and MAUI Blazor Hybrid (the same
components inside a native shell on Android, iOS, Windows and macOS). Those heads have wildly
different access to the device: a phone can vibrate, scan a fingerprint, drop a local notification
and open the system share sheet; a server-rendered page can do none of that, and a WASM page can do
some of it through browser APIs. This group is how one component library talks to all of that
hardware without ever naming a platform type. It is a set of small, single-capability interface
**contracts** (biometrics, geolocation/geocoding, speech, push registration, media pick, clipboard,
screenshot, haptics, share, external links, external OAuth, local cache, local notifications,
connectivity, battery, accessibility announcements, deep links) plus three families of
**adapters** that implement each contract per host: MAUI-native, browser-JS-interop, and inert
fallback. The head chooses which family it gets at DI composition time. This is the
[Rubric §18, UI Architecture] and [Rubric §22, Responsive/Cross-Browser] story in miniature, and the
whole design is [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) (`MMCA.Common/ADRs/042-device-capability-abstraction.md`).

**The contract-per-capability shape.** Every capability is its own narrow interface in the
`MMCA.Common.UI.Services.Capabilities` namespace (form-factor detection, [`IFormFactor`](#iformfactor),
sits one level up in `MMCA.Common.UI.Services`). The contracts are deliberately tiny and
transport-agnostic: they speak in booleans, strings, and framework-owned records, never in a MAUI or
JS type. [`IBiometricAuthenticator`](#ibiometricauthenticator)
(`MMCA.Common.UI/Services/Capabilities/IBiometricAuthenticator.cs:9`) is the clearest example of the
house rule: availability and outcome are both plain `Task<bool>`, and every failure mode (cancel,
lockout, error) collapses to `false` so a caller can only fall back to the normal credential login,
never to a weaker path. Where a capability must return structured data it does so through a
framework-owned value type, not a platform one: [`GeoPoint`](#geopoint)
(`MMCA.Common.UI/Services/Capabilities/GeoPoint.cs:9`) is a `sealed record` latitude/longitude pair
that even carries its own haversine `DistanceKmTo` helper (`GeoPoint.cs:17`) so shared components
never touch a platform location type. [`PickedMedia`](#pickedmedia),
[`PushDeviceToken`](#pushdevicetoken), and [`LocalNotificationRequest`](#localnotificationrequest)
play the same role for their capabilities. Keeping the contracts in the shared UI layer and the
platform types out of them is the [Rubric §1, SOLID] Dependency-Inversion move that makes the whole
layer swappable per host.

**Composition: safe defaults first, head overrides last.** The wiring is a two-phase, last-wins
registration and it is the load-bearing mechanism of the group. `AddUIShared` (in the wider UI group)
calls `AddDeviceCapabilityDefaults`
(`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:24`), which `TryAdd`-registers a neutral
implementation for **every** contract, so any shared component can resolve any capability on any head
and get a well-defined no-op rather than a missing-service exception (`DependencyInjection.cs:27-60`).
A head then calls its own registration **after** `AddUIShared` with plain `Add` calls, and because the
last single-service registration wins, those override the defaults. Browser heads call
`AddBrowserDeviceCapabilities` (`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:73`);
native heads call `AddMauiDeviceCapabilities`
(`MMCA.Common.UI.Maui/DependencyInjection.cs:25`), which ships in the separate MAUI-TFM package
`MMCA.Common.UI.Maui` (the one package built outside `MMCA.Common.slnx`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Both of those DI
classes use the C# `extension(IServiceCollection)` member idiom the codebase favours for registration
(see the [primer](../00-primer.md#c-extensiont-types--read-this-once)). The lifetime choices are
deliberate: the browser services are `Scoped` (one per Blazor circuit) so per-user state never leaks
across circuits, while the MAUI services are `Singleton` because a native head is single-user and its
stateful services wrap app-global platform events.

**Three adapter families.** Each contract has up to three implementations, split across three
namespaces. The **fallback** family lives in `MMCA.Common.UI.Services.Capabilities.Fallbacks` and is
the Null Object pattern applied wholesale ([Rubric §2, Design Patterns]):
[`NullBiometricAuthenticator`](#nullbiometricauthenticator)
(`MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBiometricAuthenticator.cs:4`) simply returns
`false` from both members, [`NullShareService`](#nullshareservice),
[`NullClipboardService`](#nullclipboardservice), and their siblings do nothing, and
[`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice) reports permanent
connectivity because a server-rendered page has no offline concept. These are what make it safe for a
shared component to call a capability unconditionally: the null implementation answers "not available
here" honestly and the component hides the corresponding affordance. The **MAUI** family lives in
`MMCA.Common.UI.Maui.Capabilities` and wraps the real platform APIs:
[`MauiFormFactor`](#mauiformfactor) (`MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:12`) reads
`DeviceInfo.Idiom`/`DeviceInfo.Platform`, and its siblings drive Essentials, the Community Toolkit,
and Plugin.LocalNotification.

**The browser family and its prerender-safe contract.** The **browser** family lives in
`MMCA.Common.UI.Services.Capabilities.Browser` and reaches the device through JavaScript interop, but
it never calls `IJSRuntime` directly. Every browser service depends on
[`CapabilitiesJsModule`](#capabilitiesjsmodule)
(`MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:12`), a lazy accessor for the
single `capabilities-interop.js` module (`CapabilitiesJsModule.cs:14`) registered once per circuit
(`DependencyInjection.cs:76`). Its `InvokeOrDefaultAsync<T>` (`CapabilitiesJsModule.cs:27`) is the
degradation contract that makes browser capabilities usable during server-side prerender: it wraps the
import-and-invoke in a `try` that swallows the entire JS-unavailable exception family
(`InvalidOperationException` for an un-hydrated prerender, `JSDisconnectedException` for a torn-down
circuit, and `JSException` for a throwing browser API) and returns `default`
(`CapabilitiesJsModule.cs:39-51`). So [`BrowserShareService`](#browsershareservice)
(`MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:8`) calling `navigator.share`
degrades to "did not share" during prerender instead of throwing, exactly as a null implementation
would. This is the [Rubric §22, Responsive/Cross-Browser] and [Rubric §23, Front-End Performance]
discipline that lets the same component prerender on the server and hydrate in the browser without a
capability check at every call site.

**Form-factor detection across the trio.** [`IFormFactor`](#iformfactor)
(`MMCA.Common.UI/Services/IFormFactor.cs:7`) is the smallest capability, two strings describing the
device and platform, and it is the one contract with three genuinely different, hoisted
implementations: [`WebFormFactor`](#webformfactor)
(`MMCA.Common.UI.Web/Services/WebFormFactor.cs:12`) reports `"Web"` for the server head,
[`WasmFormFactor`](#wasmformfactor) (`MMCA.Common.UI/Services/WasmFormFactor.cs:9`) reports
`"WebAssembly"` for the browser runtime, and [`MauiFormFactor`](#mauiformfactor) reports the real
device idiom. Each head registers its own (`AddMauiFormFactor`,
`MMCA.Common.UI.Maui/DependencyInjection.cs:69`, keeps this separate from the capability bundle so a
head can override just the form factor). The trio is the concrete illustration of why the whole group
exists: identical shared components read `GetFormFactor()`/`GetPlatform()` and adapt, and the
correct answer for "what am I running on" is injected, not detected inline.

**Deep links: one funnel from native navigation into Blazor routing.** The most involved runtime flow
in this group is the deep-link path ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html),
`MMCA.Common/ADRs/043-mobile-deep-links-and-native-oauth-callback.md`).
[`IDeepLinkDispatcher`](#ideeplinkdispatcher)
(`MMCA.Common.UI/Services/Capabilities/IDeepLinkDispatcher.cs:10`) is the single boundary between
native navigation sources (notification taps, home-screen app actions, app links, QR scans) and the
Blazor router. Native code calls `Publish(route)` with an app-relative route; the shared
`DeepLinkListener` component (in the UI-components group) either receives it live via the
`RouteRequested` event or drains it from a buffer after first render. The default
[`DeepLinkDispatcher`](#deeplinkdispatcher)
(`MMCA.Common.UI/Services/Capabilities/DeepLinkDispatcher.cs:9`) is a singleton that solves the
cold-start race: when a tap launches the app before the router exists, `Publish` finds no attached
handler and stores the route in a single-entry buffer under a `Lock` (`DeepLinkDispatcher.cs:18-34`),
and the listener drains it via `TryConsumePending` once it renders (`DeepLinkDispatcher.cs:37-46`).
The event payload is [`DeepLinkRouteEventArgs`](#deeplinkrouteeventargs). On MAUI the bridge is wired
by [`DeviceCapabilitiesInitializer`](#devicecapabilitiesinitializer)
(`MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:15`), an `IMauiInitializeService` that hooks
`LocalNotificationCenter.Current.NotificationActionTapped` and republishes the tapped notification's
`ReturningData` route into the dispatcher (`DeviceCapabilitiesInitializer.cs:28-42`). That wiring is
installed by `UseMauiDeviceCapabilities` on the `MauiAppBuilder`
(`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:25`), which also calls `UseLocalNotification()`
and registers the native capability bundle.

**Wired-but-inert capabilities.** A recurring, honest theme in this layer is capabilities that are
fully registered but deliberately do nothing yet, because their real backing requires credentials or a
later feature wave. Native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html),
`MMCA.Common/ADRs/044-native-push-delivery.md`) registers a real
[`IPushRegistrationService`](#ipushregistrationservice)
(`MMCA.Common.UI/Services/Capabilities/IPushRegistrationService.cs:10`) on MAUI heads, but the
[`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) defaults to a null provider that yields no
token, so even a native head stays registered-but-tokenless until the app supplies real FCM/APNs
credentials (`DependencyInjection.cs:45-49`). The [`IExternalAuthBroker`](#iexternalauthbroker)
(`MMCA.Common.UI/Services/Capabilities/IExternalAuthBroker.cs:10`) defaults to
[`UnavailableExternalAuthBroker`](#unavailableexternalauthbroker) so web heads keep their existing
anchor-href OAuth flow, and the MAUI broker reports `IsAvailable == false` until the head configures
`OAuth:MobileRedirectScheme` (`MMCA.Common.UI.Maui/DependencyInjection.cs:56-59`). Biometrics stay on
their null default until [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4 lands (see the
[`DevicePreferenceKeys.AppLockEnabled`](#devicepreferencekeys) key,
`MMCA.Common.UI/Services/Capabilities/DevicePreferenceKeys.cs:10`). This "contract present, behavior
inert" pattern is what lets shared components be written against the full capability surface today
while the platform work ships incrementally; each null default is a truthful `IsAvailable == false`
that hides its affordance rather than a stub that lies.

**Device preferences and the per-head lifetime split.** [`IDevicePreferences`](#idevicepreferences)
(`MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:11`) stores per-device settings (reminder
lead time, haptics toggle, app-lock) that describe *this device* and never roam to the server, which
is why it is distinct from the server-side per-user preferences. It exposes an `IsPersistent` flag so a
head can hide device-settings UI where storage is ephemeral. The three implementations show the
lifetime story clearly: [`MauiDevicePreferences`](#mauidevicepreferences) persists to native
`Preferences`, [`BrowserDevicePreferences`](#browserdevicepreferences) persists to `localStorage`
through the shared JS module, and [`InMemoryDevicePreferences`](#inmemorydevicepreferences) is
registered `Scoped` (`DependencyInjection.cs:56`) so the Blazor Server fallback holds per-circuit
state and reports `IsPersistent == false`. Never storing secrets here is a documented rule (tokens
belong in platform secure storage), which ties this into [Rubric §26, Front-End Security] and
[Rubric §11, Security].

**Where this group sits.** The capability contracts are consumed by the shared Blazor components and
pages (the UI-components group), by the connectivity/battery/accessibility banners, and by the deep-link
and notification surfaces. Nothing in this group references EF Core, the API, or a message broker: it
is pure presentation-edge adaptation, sitting alongside the rest of `MMCA.Common.UI` at the top of the
dependency flow. Read it as the codebase's answer to a specific hard problem: how to write device-aware
UI once and run it on a server, in a browser, and on a phone, with the platform differences pushed
entirely into injected adapters and the shared components none the wiser. The governing decisions are
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) (the abstraction itself), [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html) (deep links and native OAuth callback), [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) (native push
delivery), and [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) (managed file storage and avatars, the backing for the media-picker capability).

### IFormFactor

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IFormFactor.cs:7` · Level 0 · interface

- **What it is**: a two-method abstraction over device / hosting-environment detection, so the shared Razor component library can adapt behavior without knowing which host it is running inside. Each host (Blazor Server, WebAssembly, MAUI) supplies its own implementation (`IFormFactor.cs:4-6`).
- **Depends on**: nothing first-party. It is a pure contract with two `string`-returning methods and no BCL dependency beyond `System.String`. Its concrete implementations are the host-specific siblings: [WasmFormFactor](#wasmformfactor) (WebAssembly), [WebFormFactor](#webformfactor) (Blazor Server), and [MauiFormFactor](#mauiformfactor) (MAUI native).
- **Concept introduced**: this is the first type in the device-capability layer, so it establishes the layer's whole shape. Define the *capability* as an interface in the shared UI library, then let each host register a concrete implementation at DI composition time. Shared components depend on the interface, never on `OperatingSystem.IsAndroid()`, `RuntimeInformation.ProcessArchitecture`, or a `#if` conditional, so one component tree serves all three hosts and stays unit-testable with a stub.
  - `[Rubric §18, UI Architecture]` §18 assesses whether the presentation layer is componentized and host-agnostic rather than duplicated per platform. `IFormFactor` embodies it directly: the same component library is consumed by three hosts, and platform variance is pushed to a single injected boundary instead of being scattered through component markup.
  - `[Rubric §1, SOLID]` §1 assesses interface segregation and dependency inversion. This is a minimal, focused interface (two methods, one concern) that shared components depend on abstractly, so the high-level UI does not depend on any concrete host detail.
- **Walkthrough**: two members, both returning `string` rather than an enum.
  - `GetFormFactor()` (`IFormFactor.cs:10`): returns the device form factor, documented as one of `"Web"`, `"WebAssembly"`, or `"Phone"`.
  - `GetPlatform()` (`IFormFactor.cs:13`): returns the platform / OS description.
  The `string` return types are deliberate: they let a new host or form factor appear without forcing a shared enum change that every assembly would have to recompile against.
- **Why it's built this way**: keeping the abstraction in `MMCA.Common.UI` (which depends on `Shared` only, per the layer rules in `MMCA.Common/CLAUDE.md`) means the shared component library carries no reference to any host-specific assembly. Each head owns and registers its own concrete class, the pattern used across the device-capability layer for biometric, geolocation, share, and the other native capabilities selected per host at composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) covers the MAUI-native head's separate build/pack path).
- **Where it's used**: registered per host through the `AddWasmFormFactor()` / `AddCommonWebFormFactor()` / `AddMauiFormFactor()` extension methods (see `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:117` for the WASM registration) and resolved by shared Blazor components that adapt layout or feature availability per platform. The Store and ADC WASM clients call `AddWasmFormFactor()` from their `Program.cs` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:65`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:70`).

### WasmFormFactor

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/WasmFormFactor.cs:9` · Level 1 · class

- **What it is**: the WebAssembly implementation of [IFormFactor](#iformfactor). It reports `"WebAssembly"` because this code runs entirely in the browser after the WASM runtime has loaded (`WasmFormFactor.cs:4-5`).
- **Depends on**: [IFormFactor](#iformfactor) (the contract it implements) and one BCL member, `System.Environment.OSVersion`. It carries no app-specific state, which is why it was hoisted out of the individual app WASM clients into the shared UI library (`WasmFormFactor.cs:6-7`).
- **Concept introduced**: this is the first concrete host adapter in the layer, so it shows the per-host implementation shape the interface set up. It is `sealed` (`WasmFormFactor.cs:9`), a workspace default for leaf classes, and both methods are expression-bodied, single-line answers. Its siblings implement the same two methods differently: [WebFormFactor](#webformfactor) reports `"Web"` plus the server OS, and [MauiFormFactor](#mauiformfactor) reports the native device form factor.
  - `[Rubric §22, Responsive / Cross-Browser]` §22 assesses whether the app adapts across the device and browser matrix. This adapter is the WASM leg of that story: it lets a shared component distinguish the browser-hosted WebAssembly runtime from a server-rendered or native host at runtime.
- **Walkthrough**: two members, both from `IFormFactor`.
  - `GetFormFactor()` (`WasmFormFactor.cs:12`): returns the constant string `"WebAssembly"`.
  - `GetPlatform()` (`WasmFormFactor.cs:15`): returns `Environment.OSVersion.ToString()`, the browser-reported OS description.
- **Why it's built this way**: because the class holds no state and is host-generic, it lives in the shared `MMCA.Common.UI` package rather than being copy-pasted into each app's WASM client. The Blazor Server and MAUI heads deliberately do not use it: they register their own `IFormFactor` (`WebFormFactor` in `MMCA.Common.UI.Web`, `MauiFormFactor` in `MMCA.Common.UI.Maui`, the latter built on its own windows job per [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: registered as a singleton `IFormFactor` by `AddWasmFormFactor()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:117-118`), called from each WASM `.Client` host's `Program.cs`. Its behavior and singleton registration are covered by `WasmFormFactorTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/WasmFormFactorTests.cs:16`).

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
  strings is the small [Rubric §16, Maintainability] discipline that keeps a writer and a reader from
  drifting apart on a literal.
- **Walkthrough**: one member today: `AppLockEnabled = "applock.enabled"`
  (`DevicePreferenceKeys.cs:10`), whether the biometric app-lock guards stored-token auto-login. The
  doc comment ties it to the biometric app-lock feature ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4).
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
  "never touch platform location types" (`GeoPoint.cs:5`), the MAUI `Location`/browser Geolocation
  result is mapped into this record at the adapter boundary. Being a `record` gives it value equality
  and immutability for free (the Value Object idea, see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), though it lives in the UI
  layer rather than the domain.
- **Walkthrough**
  - Positional parameters `Latitude`/`Longitude` in decimal degrees (`GeoPoint.cs:9`).
  - `EarthRadiusKm = 6371.0` (`GeoPoint.cs:11`): the mean Earth radius constant the distance formula
    uses.
  - `DistanceKmTo(GeoPoint other)` (`GeoPoint.cs:17`): null-guards `other`, then computes the haversine
    great-circle distance in kilometers (`GeoPoint.cs:19-28`). The doc comment scopes it honestly: good
    enough for "how far is the venue" hints, not for navigation (`GeoPoint.cs:15`).
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
  reader for events a sighted user perceives only visually (a poll opening, a question being answered,
  the unread badge incrementing).
- **Depends on**: BCL only (`System.Threading.Tasks`, `System.Threading.CancellationToken`).
- **Concept introduced, the per-capability contract with per-host adapters.** This whole group is a
  family of narrow interfaces in `MMCA.Common.UI`, each wrapping one device capability so shared Blazor
  components can call it uniformly while three implementations (MAUI-native, browser-JS-interop, and an
  inert fallback) are chosen per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). `[Rubric §1, SOLID]` (interface
  segregation and dependency inversion: components depend on the tiny abstraction, never a platform SDK)
  and `[Rubric §2, Design Patterns]` (this is the Strategy/adapter + Null-Object pairing repeated across
  the group). `[Rubric §21, Accessibility]` assesses whether non-visual users get equivalent information;
  this contract routes to MAUI `SemanticScreenReader` on native and an `aria-live` region in browsers
  (`IAccessibilityAnnouncer.cs:4-7`), and is a deliberate silent no-op when no assistive technology is
  active.
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

### IBatteryStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IBatteryStatusService.cs:8` · Level 0 · interface

- **What it is**: exposes the platform energy-saver state (plus a change event) so live features can
  throttle themselves on a draining battery.
- **Depends on**: BCL only (`System.EventHandler`).
- **Concept, the property + change-event capability shape.** This is the first of several read-a-state,
  react-to-changes contracts (compare [`IConnectivityStatusService`](#iconnectivitystatusservice)):
  a bool property plus an `EventHandler` that fires after it changes, handlers re-read the property.
  `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance]` assess whether the
  client adapts work to device constraints; here a component can drop a SignalR channel auto-join when
  the OS reports low-power mode (`IBatteryStatusService.cs:4-6`). Web and null fallbacks always report
  `false` and never raise the event, so a non-native head simply behaves as "never energy-saving".
- **Walkthrough**
  - `EnergySaverChanged` (`IBatteryStatusService.cs:11`): raised after `IsEnergySaverOn` changes;
    handlers read the new value from the property rather than from event args.
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
    shows the platform prompt with a localized `reason`; returns `true` only on positive verification,
    and cancellation, lockout, and errors all collapse to `false` (`IBiometricAuthenticator.cs:15-17`).
- **Why it's built this way**: folding cancellation/lockout/error into a single `false` keeps the call
  site's decision binary (verified or not) and forbids a partial-success path; the localized `reason`
  is required because the platform surfaces it in the system prompt.
- **Where it's used**: implemented by [`MauiBiometricAuthenticator`](#mauibiometricauthenticator) and
  the inert [`NullBiometricAuthenticator`](#nullbiometricauthenticator); consumed by the auto-login
  app-lock gate.
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
  requests. The doc comment records the three host behaviors (`IConnectivityStatusService.cs:4-9`): MAUI
  wraps `Connectivity.Current`, WebAssembly watches `navigator.onLine`, and Blazor Server is always
  online (a dead circuit takes the whole UI down and the reconnect overlay already covers it). Extends
  the property+event shape of [`IBatteryStatusService`](#ibatterystatusservice) with an
  `InitializeAsync` because the browser adapter needs explicit JS listener setup.
- **Walkthrough**
  - `ConnectivityChanged` (`IConnectivityStatusService.cs:13`): raised after `IsOnline` changes.
  - `IsOnline` (`IConnectivityStatusService.cs:16`): defaults to `true` until known, so the UI starts
    optimistic rather than flashing an offline banner on first render.
  - `InitializeAsync(CancellationToken = default)` (`IConnectivityStatusService.cs:22`): starts change
    monitoring where that needs explicit setup (browser JS listeners); called from `OnAfterRenderAsync`,
    a no-op and safe to call repeatedly on every implementation (`IConnectivityStatusService.cs:18-21`).
- **Why it's built this way**: `ValueTask InitializeAsync` keeps the always-ready implementations
  allocation-free while giving the browser adapter a place to attach listeners after the first render
  (JS interop is unavailable during prerender).
- **Where it's used**: implemented by [`MauiConnectivityStatusService`](#mauiconnectivitystatusservice),
  [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice), and the Server default
  [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice); consumed by the
  offline banner and request-skipping guards.

### IDevicePreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:11` · Level 0 · interface

- **What it is**: a small typed key/value store for per-device settings (reminder lead time, haptics
  toggle, app-lock), distinct from the server-side per-user preferences that roam with an account.
- **Depends on**: BCL only; keys come from [`DevicePreferenceKeys`](#devicepreferencekeys).
- **Concept introduced, device-scoped client state.** `[Rubric §19, State Management]` assesses whether
  state has a clear owner and lifetime. Device preferences "describe THIS device and never roam"
  (`IDevicePreferences.cs:5-6`), the counterpart to the server-side `IUserPreferenceWriter` (culture,
  theme). The doc comment sets two hard rules: never store secrets here (tokens belong in platform
  secure storage) and the supported value types are exactly `string`, `bool`, `int`, `long`, `double`,
  `DateTimeOffset` (`IDevicePreferences.cs:7-9`). `[Rubric §26, Front-End Security]`: the secrets
  prohibition keeps sensitive material off unencrypted preference storage.
- **Walkthrough**
  - `IsPersistent` (`IDevicePreferences.cs:17`): whether values survive an app restart; the Blazor
    Server fallback is in-memory only (`false`) and hosts hide device-settings UI when it is not
    persistent (`IDevicePreferences.cs:13-16`).
  - `GetAsync<T>(string key, T fallback, CancellationToken = default)` (`IDevicePreferences.cs:21`):
    reads a value, returning `fallback` when absent or unreadable.
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`IDevicePreferences.cs:25`):
    best-effort write, storage failures are swallowed.
  - `RemoveAsync(string key, CancellationToken = default)` (`IDevicePreferences.cs:28`): removes a
    value; unknown keys are ignored.
- **Why it's built this way**: the `IsPersistent` flag lets a host decide whether to even show
  device-settings UI (pointless when settings would evaporate on reload), and the swallow-on-failure
  writes keep a cosmetic preference from ever throwing into a render path.
- **Where it's used**: implemented by [`MauiDevicePreferences`](#mauidevicepreferences),
  [`BrowserDevicePreferences`](#browserdevicepreferences), and the in-memory Server default
  [`InMemoryDevicePreferences`](#inmemorydevicepreferences); read/written by device-settings screens and
  the app-lock gate.

### IExternalAuthBroker
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IExternalAuthBroker.cs:10` · Level 0 · interface

- **What it is**: runs an external OAuth sign-in (Google/GitHub) through the platform's system-browser
  authenticator instead of a web redirect, because the identity providers reject embedded WebViews.
- **Depends on**: BCL only.
- **Concept, native OAuth callback capture.** `[Rubric §11, Security]` and `[Rubric §26, Front-End
  Security]`. The default broker is unavailable, which preserves the existing anchor-href redirect flow
  on web heads; the MAUI implementation drives `WebAuthenticator` against the API's OAuth endpoints and
  stores the resulting token pair (`IExternalAuthBroker.cs:4-9`). This is the client half of the native
  deep-link OAuth callback design ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)): the server redirects a single-use completion code to an
  allow-listed custom scheme so `WebAuthenticator` can capture it (never tokens over the wire).
- **Walkthrough**
  - `IsAvailable` (`IExternalAuthBroker.cs:13`): whether a native brokered sign-in exists on this host
    (false on web heads).
  - `SignInAsync(string provider, CancellationToken = default)` (`IExternalAuthBroker.cs:20`): runs the
    full brokered flow for a provider (`google`, `github`): system-browser challenge, callback capture,
    code exchange, token storage; returns whether the user ended up authenticated
    (`IExternalAuthBroker.cs:15-19`).
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
    `target="_blank"` (`IExternalLinkService.cs:11-15`).
  - `OpenAsync(Uri uri, CancellationToken = default)` (`IExternalLinkService.cs:19`): opens the URI in
    the system browser / a new tab, best-effort.
- **Why it's built this way**: exposing `InterceptsLinks` means the browser head keeps native anchor
  semantics (middle-click, open-in-new-tab) while only WebView heads pay the interop cost ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: implemented by [`MauiExternalLinkService`](#mauiexternallinkservice),
  [`BrowserExternalLinkService`](#browserexternallinkservice), and [`NullExternalLinkService`](#nullexternallinkservice);
  consumed by the `ExternalLink` component (its fake counterpart
  [`FakeExternalLinkService`](group-27-testing-infrastructure.md#fakeexternallinkservice) backs the
  component tests).

### IHapticFeedbackService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IHapticFeedbackService.cs:8` · Level 0 · interface

- **What it is**: fires tactile feedback on interactions (bookmark toggles, poll votes). Native-only:
  the web fallback is a hidden no-op.
- **Depends on**: BCL only (`System.TimeSpan`).
- **Concept, decoration-not-behavior capability.** `[Rubric §18, UI Architecture]`. The methods are
  fire-and-forget `void` (not `Task`) and failures are swallowed because "haptics are decoration, never
  behavior" (`IHapticFeedbackService.cs:4-6`), so a missing or throwing vibrator can never affect what
  the app does. `IsSupported` is `false` on the web fallback.
- **Walkthrough**
  - `IsSupported` (`IHapticFeedbackService.cs:11`): whether the platform can produce haptics.
  - `Click()` (`IHapticFeedbackService.cs:14`): short feedback for taps and toggles.
  - `LongPress()` (`IHapticFeedbackService.cs:17`): stronger feedback for long-press interactions.
  - `Vibrate(TimeSpan duration)` (`IHapticFeedbackService.cs:20`): raw vibration for attention-level
    cues (e.g. a foregrounded notification arriving).
- **Why it's built this way**: synchronous `void` matches the fire-and-forget nature of a UI micro-cue
  (no caller waits on a buzz), and the swallow-failures rule keeps a decorative effect out of the
  correctness path.
- **Where it's used**: implemented by [`MauiHapticFeedbackService`](#mauihapticfeedbackservice) and the
  no-op [`NullHapticFeedbackService`](#nullhapticfeedbackservice); consumed by interactive components.

### ILocalCacheStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/ILocalCacheStore.cs:9` · Level 0 · interface

- **What it is**: a small on-device JSON document cache for offline UI state (an offline schedule
  snapshot), explicitly not a query cache and not for secrets.
- **Depends on**: BCL only (generic serialization via the implementation).
- **Concept, last-known-good UI state for offline rendering.** `[Rubric §29, Resilience & Business
  Continuity]` and `[Rubric §19, State Management]`. MAUI persists to the app data directory,
  WebAssembly to `localStorage`, and the Blazor Server fallback is unavailable (SSR always has the live
  API) (`ILocalCacheStore.cs:4-8`). The doc comment draws the boundary sharply: this is
  last-known-good UI state for offline rendering, not a general query cache and not a secret store.
- **Walkthrough**
  - `IsAvailable` (`ILocalCacheStore.cs:12`): whether cached values survive restarts on this host.
  - `SetAsync<T>(string key, T value, CancellationToken = default)` (`ILocalCacheStore.cs:16`):
    serializes and stores a JSON-serializable document, best-effort.
  - `GetAsync<T>(string key, CancellationToken = default)` (`ILocalCacheStore.cs:20`): reads and
    deserializes, or returns `default`.
  - `RemoveAsync(string key, CancellationToken = default)` (`ILocalCacheStore.cs:23`): removes an entry;
    unknown keys are ignored.
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
  supports it; returns whether a maps UI was opened.
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
- **Depends on**: [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) (Level 1, the token source it
  wraps).
- **Concept, native push registration lifecycle.** `[Rubric §6, CQRS & Event-Driven]` (the push channel
  is a delivery leg for notifications) and `[Rubric §18, UI Architecture]`. This is the client leg of
  native push delivery ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): hosts call `RegisterAsync` after sign-in and on resume, and
  `UnregisterAsync` *before* sign-out clears the tokens (the delete call is authenticated)
  (`IPushRegistrationService.cs:4-9`). The default implementation is a no-op on web heads.
- **Walkthrough**
  - `IsSupported` (`IPushRegistrationService.cs:13`): whether this head can register for native push at
    all (native heads only).
  - `RegisterAsync(CancellationToken = default)` (`IPushRegistrationService.cs:20`): registers or
    refreshes this device's installation; best-effort and safe to call repeatedly; returns `false` when
    no platform token is available (unsupported head, missing credentials, permission denied) or the
    sync failed (`IPushRegistrationService.cs:15-19`).
  - `UnregisterAsync(CancellationToken = default)` (`IPushRegistrationService.cs:23`): removes the
    installation, best-effort, called while still authenticated.
- **Why it's built this way**: ordering `UnregisterAsync` before token clearing is load-bearing: the
  server delete call is authenticated, so it must run while the credentials still exist; the
  idempotent, safe-to-repeat `RegisterAsync` tolerates the resume-driven re-calls ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Where it's used**: implemented by [`MauiPushRegistrationService`](#mauipushregistrationservice)
  (over [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider)) and the no-op
  [`NullPushRegistrationService`](#nullpushregistrationservice); driven by the head apps' sign-in /
  sign-out lifecycle and syncing to the server `DevicesController` ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).

### IScreenshotService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/IScreenshotService.cs:8` · Level 0 · interface

- **What it is**: captures the current app screen to a temporary image file, for pairing with a share
  action ("share my schedule as image").
- **Depends on**: BCL only; pairs with [`IShareService.ShareFileAsync`](#ishareservice).
- **Concept, permissionless temp-file capture.** `[Rubric §26, Front-End Security]` and `[Rubric §30,
  Compliance/Privacy]`. Captured files land in the platform cache directory, never the photo library,
  so no storage permissions are needed (`IScreenshotService.cs:4-6`), a deliberate minimization that
  avoids prompting for (and holding) a broad permission for a one-off share.
- **Walkthrough**
  - `IsSupported` (`IScreenshotService.cs:11`): whether screen capture is available (web/null fallbacks:
    `false`).
  - `CaptureToFileAsync(CancellationToken = default)` (`IScreenshotService.cs:14`): captures the screen
    to a temp PNG and returns its path, or `null` on failure.
- **Why it's built this way**: writing to the cache directory (not the gallery) keeps the feature
  permission-free; returning a nullable path lets the share flow abort quietly when capture is
  unsupported or fails.
- **Where it's used**: implemented by [`MauiScreenshotService`](#mauiscreenshotservice) and the
  unsupported [`NullScreenshotService`](#nullscreenshotservice); its output is handed to
  [`IShareService.ShareFileAsync`](#ishareservice).

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
- **Why it's built this way**: keeping recognition behind a `Shared`-only interface lets the MAUI head supply a real recognizer while browser and null heads register an inert one, all selected at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), `MMCA.Common/ADRs/042-device-capability-abstraction.md`).
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

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities` · `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:16` · Level 4 · class

- **What it is**: the device-capability registration entry point (`DependencyInjection.cs:8-15`). It TryAdd-registers a safe default for every capability contract so shared components resolve them on any head, then lets heads override with plain `Add` registrations, last registration wins for single-service resolution.
- **Depends on**: the whole contract set in this namespace plus their `Fallbacks` and `Browser` implementations (`DependencyInjection.cs:3-4`); `Microsoft.Extensions.DependencyInjection` and its `Extensions` (for `TryAdd*`). It uses C# `extension(IServiceCollection)` members (`:18`), the workspace's DI-registration idiom (see [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced**: the **two-phase, last-wins composition** that is the load-bearing mechanism of this whole group, made concrete. `AddDeviceCapabilityDefaults` `TryAdd`-registers a neutral default for every contract (`DependencyInjection.cs:24-63`); because `TryAdd` is a no-op when a service already exists, calling it repeatedly is idempotent, and because plain `Add` after it wins for single-service resolution, a head layers its real implementations on top without unregistering anything. `AddBrowserDeviceCapabilities` (`:73-88`) is the browser override phase.
  - `[Rubric §2, Design Patterns]` §2 assesses idiomatic patterns. This is the Null Object pattern at DI scale: every contract has an inert default, so no consumer ever resolves a missing service.
  - `[Rubric §18, UI Architecture]` §18 assesses host-agnostic composition. Platform variance is confined to which registrations run at composition time; the component tree is identical across heads.
  - `[Rubric §1, SOLID]` §1 assesses dependency inversion. Components depend on the contracts; the concrete family is chosen here, at the composition root.
- **Walkthrough**: two extension members on `IServiceCollection`.
  - `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:24`, internal): TryAdd-registers the null/neutral default for every contract. Most are stateless singletons (`:27-52`), for example `ISpeechToTextService` to `NullSpeechToTextService` (`:41`) and `IMediaPickerService` to `NullMediaPickerService` (`:52`). Two deliberate exceptions: `IDevicePreferences` is scoped so the Blazor Server fallback holds per-circuit (per-user) state, never cross-user state (`:54-56`), and `IDeepLinkDispatcher` is a singleton because native code publishes into it from outside any scope (`:58-60`). The push pair defaults to inert (`:48-49`), matching the inert-until-credentialed story of [IPushDeviceTokenProvider](#ipushdevicetokenprovider).
  - `AddBrowserDeviceCapabilities()` (`DependencyInjection.cs:73`, public): overrides the defaults with browser implementations (`navigator.share`, clipboard, `aria-live` announcements, online/offline watching, `localStorage`). Called after `AddUIShared` from the Blazor Server and WebAssembly hosts. It first registers one scoped `CapabilitiesJsModule` (`:76`), a single JS-module import per scope/circuit shared by all browser services, then registers each browser service as scoped (`:78-85`). Every browser implementation is prerender-safe: JS-unavailable calls degrade to the null behavior instead of throwing (`:69-72`).
- **Why it's built this way**: `TryAdd` defaults plus last-wins overrides let one shared library ship complete on every head while each head supplies only the implementations it can, and the browser services live here (not in a separate host) because they depend on `Shared` only ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Native overrides ship separately in `MMCA.Common.UI.Maui` (`AddMauiDeviceCapabilities`, `DependencyInjection.cs:12-14`) built on its own windows job ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: `AddDeviceCapabilityDefaults` is called by `AddUIShared` in the wider UI group; `AddBrowserDeviceCapabilities` is called from each Blazor Server and WebAssembly host's `Program.cs`. Registration behavior is covered by `CapabilityFallbackTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Capabilities/CapabilityFallbackTests.cs`).
- **Caveats / not-in-source**: the `internal` visibility of `AddDeviceCapabilityDefaults` (`DependencyInjection.cs:24`) means it is called through `AddUIShared` inside the same assembly, not directly by host `Program.cs`. Not determinable from this file: the exact `AddUIShared` call site, which lives in the wider UI group's `DependencyInjection`.

### CapabilitiesJsModule

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:12` · Level 0 · class

- **What it is** - the single, prerender-safe JavaScript accessor that every browser capability adapter in this namespace shares. It lazily imports one ES module (`capabilities-interop.js`) per Blazor scope/circuit and invokes its exports, swallowing the "JS is not reachable right now" exception family and returning `default` instead of throwing.
- **Depends on** - `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`, `JSException`); implements `IAsyncDisposable` (BCL). No first-party dependencies: it sits at the very bottom of the browser-adapter stack, which is why it is Level 0 while its consumers are Level 1.
- **Concept introduced - the browser degradation contract.** This is the first place in the group where JS interop is bridged, so the mechanism is taught here and the adapters merely reference it. Blazor Server (and prerendered Blazor Web) runs component code on the server *before* the browser has a live circuit; during that window any `IJSRuntime` call throws `InvalidOperationException`. A disposed or navigated-away circuit throws `JSDisconnectedException`, and a browser API that itself rejects (permission denied, unsupported) surfaces as `JSException`. `InvokeOrDefaultAsync` (`CapabilitiesJsModule.cs:27`) catches all three (`CapabilitiesJsModule.cs:39-51`) and returns `default`, so a caller on the server, on a dead circuit, or on a browser missing the API sees a benign `null`/`false` rather than an exception bubbling into the render tree. The XML doc (`CapabilitiesJsModule.cs:9-10`) states this deliberately mirrors [MauiBackNavigationBridge](group-15-common-ui-framework.md#mauibacknavigationbridge)'s contract: capability failures degrade, they never crash the page.
  - `[Rubric §22 - Responsive/Cross-Browser]` §22 assesses whether the front end works across engines and rendering modes; this type is the lever, one accessor that keeps every capability call safe under SSR prerender and across browsers that lack a given API.
  - `[Rubric §29 - Resilience & Business Continuity]` §29 assesses graceful degradation under partial failure; returning `default` on a torn-down circuit (`CapabilitiesJsModule.cs:44-51`) is degradation by construction, not exception handling bolted on later.
  - `[Rubric §12 - Performance & Scalability]` §12 assesses efficient resource use; the module import is memoized (`_module ??= ...`, `CapabilitiesJsModule.cs:34`) so the dynamic `import()` runs at most once per instance.
- **Walkthrough** -
  - `ModulePath` (`CapabilitiesJsModule.cs:14`) is the static content URL `./_content/MMCA.Common.UI/capabilities-interop.js`, the `_content/<PackageId>/` convention by which a Razor Class Library ships static web assets to any consuming host.
  - The constructor (`CapabilitiesJsModule.cs:20`) captures the host `IJSRuntime`; `_module` (`CapabilitiesJsModule.cs:17`) starts null.
  - `InvokeOrDefaultAsync<T>` (`CapabilitiesJsModule.cs:27`) is the one public entry point. On first call it imports the module via `InvokeAsync<IJSObjectReference>("import", ...)` and caches the reference (`CapabilitiesJsModule.cs:34-36`), then invokes the requested export by `identifier` with the supplied `args` (`CapabilitiesJsModule.cs:37`). Every call threads the caller's `CancellationToken` and uses `ConfigureAwait(false)`.
  - `DisposeAsync` (`CapabilitiesJsModule.cs:55`) releases the cached `IJSObjectReference` if one was imported, and itself catches `JSDisconnectedException` (`CapabilitiesJsModule.cs:66-69`) because a circuit that has already gone has nothing left to release.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) (device capability abstraction) establishes per-host adapters chosen at DI composition time; the browser host needs exactly one JS bridge so the eight adapters do not each import their own module or each re-implement the degradation try/catch. Centralizing both here keeps the adapters to a handful of lines and guarantees identical prerender behavior.
- **Where it's used** - injected into every Level-1 browser adapter in this group: [BrowserAccessibilityAnnouncer](#browseraccessibilityannouncer), [BrowserClipboardService](#browserclipboardservice), [BrowserConnectivityStatusService](#browserconnectivitystatusservice), [BrowserDevicePreferences](#browserdevicepreferences), [BrowserExternalLinkService](#browserexternallinkservice), [BrowserLocalCacheStore](#browserlocalcachestore), and [BrowserShareService](#browsershareservice). ([BrowserMapNavigationService](#browsermapnavigationservice) is the exception: it composes over `IExternalLinkService` rather than the JS module directly.)
- **Caveats / not-in-source** - the module's actual exports (`announce`, `copyText`, `watchOnline`, `storageGet`, and so on) live in `capabilities-interop.js`, a JavaScript asset outside this unit's type list; the adapters name the exports as string identifiers, but their JS bodies are not determinable from these `.cs` files.

### BrowserAccessibilityAnnouncer

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserAccessibilityAnnouncer.cs:8` · Level 1 · class

- **What it is** - the browser implementation of [IAccessibilityAnnouncer](#iaccessibilityannouncer): it pushes a message into a visually hidden `aria-live="polite"` region so screen readers speak status updates that carry no visible UI change.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); the interface [IAccessibilityAnnouncer](#iaccessibilityannouncer).
- **Concept introduced - the live region.** An `aria-live="polite"` container is one every screen reader monitors; writing text into it queues that text for announcement without stealing focus. Per the XML doc (`BrowserAccessibilityAnnouncer.cs:5-6`) the region is created on first use by `capabilities-interop.js`, so the app never has to add the element to its layout.
  - `[Rubric §21 - Accessibility]` §21 assesses whether non-visual users receive equivalent information; routing programmatic status through a polite live region is the standard, focus-preserving way to do that, and this adapter is the browser end of it.
- **Walkthrough** - the constructor (`BrowserAccessibilityAnnouncer.cs:13`) captures the shared module. `AnnounceAsync` (`BrowserAccessibilityAnnouncer.cs:16`) calls the `announce` export with the message (`BrowserAccessibilityAnnouncer.cs:18`); it awaits a `bool?` but discards it, because on the server/prerender the [degradation contract](#capabilitiesjsmodule) returns null and the announcement is simply a no-op.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) splits accessibility announcement behind an interface so the MAUI host can route to the native platform while the browser host uses a live region; the adapter stays a two-line pass-through because the JS module owns the DOM detail.
- **Where it's used** - resolved wherever `IAccessibilityAnnouncer` is injected (status toasts, async-completion messaging) when the browser adapter set is selected at composition time.

### BrowserClipboardService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserClipboardService.cs:4` · Level 1 · class

- **What it is** - the browser implementation of [IClipboardService](#iclipboardservice): copies text to the OS clipboard via `navigator.clipboard.writeText`.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); the interface [IClipboardService](#iclipboardservice).
- **Walkthrough** - the constructor (`BrowserClipboardService.cs:9`) captures the module. `SetTextAsync` (`BrowserClipboardService.cs:12`) calls the `copyText` export (`BrowserClipboardService.cs:14-16`) and collapses the nullable result with `copied == true` (`BrowserClipboardService.cs:17`), so a null from the [degradation contract](#capabilitiesjsmodule) (prerender, or a browser that blocks clipboard writes in an insecure context) reports `false`. This `== true` narrowing of a `bool?` to a definite success/failure is the recurring pattern across the "did it work?" adapters in this group.
  - `[Rubric §22 - Responsive/Cross-Browser]` §22 assesses cross-engine behavior; reporting a real boolean lets callers show a "copied" confirmation only when the write actually succeeded.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): clipboard is a device capability, abstracted so a native host uses the platform clipboard while the browser uses the async Clipboard API, both behind one interface.
- **Where it's used** - copy-to-clipboard affordances (copy-link, copy-code) resolved through `IClipboardService`.

### BrowserConnectivityStatusService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserConnectivityStatusService.cs:11` · Level 1 · class

- **What it is** - the browser implementation of [IConnectivityStatusService](#iconnectivitystatusservice): it reflects `navigator.onLine` and raises an event when the window's `online`/`offline` events fire. It is the one browser adapter that needs a live JS-to-.NET callback, so it also implements `IAsyncDisposable`.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); `Microsoft.JSInterop` (`DotNetObjectReference`, `[JSInvokable]`); the interface [IConnectivityStatusService](#iconnectivitystatusservice); `IAsyncDisposable` (BCL).
- **Concept introduced - the JS-to-.NET callback via `DotNetObjectReference`.** Where the other adapters call *into* JS and return, connectivity has to be *pushed* from the browser: the window fires `online`/`offline` at any time. The adapter hands JavaScript a `DotNetObjectReference` to itself (`BrowserConnectivityStatusService.cs:34`) so the JS listeners can invoke a `[JSInvokable]` .NET method whenever the state flips. This is the standard Blazor pattern for JS-originated events.
  - `[Rubric §19 - State Management]` §19 assesses how UI state is held and propagated; connectivity is stateful (`IsOnline`) with change notification (`ConnectivityChanged`), and the adapter guards against redundant notifications.
- **Walkthrough** -
  - Fields: the shared module, a nullable `_selfReference` (the `DotNetObjectReference`), and a `_watching` latch (`BrowserConnectivityStatusService.cs:13-15`).
  - `ConnectivityChanged` (`BrowserConnectivityStatusService.cs:21`) is the change event; `IsOnline` (`BrowserConnectivityStatusService.cs:24`) defaults to `true` with a private setter, so the app assumes online until proven otherwise. The XML doc (`BrowserConnectivityStatusService.cs:6-9`) notes this "reports online until `InitializeAsync` runs" and directs callers to invoke it from `OnAfterRenderAsync`, since it is a prerender-safe no-op before hydration.
  - `InitializeAsync` (`BrowserConnectivityStatusService.cs:27`) is idempotent via `_watching` (`BrowserConnectivityStatusService.cs:29-32`), lazily creates `_selfReference` (`BrowserConnectivityStatusService.cs:34`), and calls the `watchOnline` export passing that reference (`BrowserConnectivityStatusService.cs:35-37`). A null return means JS is not yet available, so it returns without latching to retry on a later call (`BrowserConnectivityStatusService.cs:39-43`); a non-null return latches `_watching` and seeds the status (`BrowserConnectivityStatusService.cs:45-46`).
  - `OnBrowserConnectivityChanged(bool)` (`BrowserConnectivityStatusService.cs:51`) is the `[JSInvokable]` callback target the JS listeners drive; its XML doc marks it "Not for app code."
  - `DisposeAsync` (`BrowserConnectivityStatusService.cs:54`) tears the JS listeners down via `unwatchOnline` when watching, then disposes and nulls `_selfReference` (`BrowserConnectivityStatusService.cs:56-62`).
  - `UpdateStatus(bool)` (`BrowserConnectivityStatusService.cs:65`) is the private funnel: it returns early when the value is unchanged (`BrowserConnectivityStatusService.cs:67-70`) and only then flips `IsOnline` and raises `ConnectivityChanged`, so subscribers are notified on genuine transitions only.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) abstracts connectivity so a native host can use platform reachability APIs; on the web the only source is `navigator.onLine` plus the window events, which require a callback object. The lifecycle (`Initialize`/`Dispose`) exists precisely because the browser adapter registers and must unregister real DOM listeners.
- **Where it's used** - offline-aware UI (banners, retry gating) that subscribes to `ConnectivityChanged` and reads `IsOnline` through `IConnectivityStatusService`.
- **Caveats / not-in-source** - the JS side registers/removes the window `online`/`offline` listeners; that registration lives in `capabilities-interop.js`, not in this `.cs` file.

### BrowserDevicePreferences

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserDevicePreferences.cs:10` · Level 1 · class

- **What it is** - the browser implementation of [IDevicePreferences](#idevicepreferences): a typed key/value preference store backed by `localStorage`, JSON-encoding each value under the `mmca.devicePrefs.` key prefix.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); `System.Text.Json` (`JsonSerializer`, `JsonException`); the interface [IDevicePreferences](#idevicepreferences).
- **Concept introduced - namespaced `localStorage` with fallback-on-failure.** Every key is prefixed (`KeyPrefix = "mmca.devicePrefs."`, `BrowserDevicePreferences.cs:12`) so app preferences never collide with other `localStorage` users on the same origin. `IsPersistent => true` (`BrowserDevicePreferences.cs:20`) advertises that, unlike a native in-memory fallback, these values survive across sessions on the same browser profile (per the XML doc, `BrowserDevicePreferences.cs:6-8`).
  - `[Rubric §19 - State Management]` §19 assesses persistence of user-scoped state; device preferences are exactly that, held client-side and durable per profile.
- **Walkthrough** -
  - `GetAsync<T>` (`BrowserDevicePreferences.cs:23`) validates the key (`ArgumentException.ThrowIfNullOrWhiteSpace`, `BrowserDevicePreferences.cs:25`), reads the raw string via the `storageGet` export (`BrowserDevicePreferences.cs:27-29`), and returns the caller's `fallback` when the value is missing (`BrowserDevicePreferences.cs:30-33`) or when JSON deserialization yields null or throws `JsonException` (`BrowserDevicePreferences.cs:35-43`). So a corrupt or absent entry never surfaces as an error, it collapses to the caller's default.
  - `SetAsync<T>` (`BrowserDevicePreferences.cs:47`) serializes the value and writes it via `storageSet` under the prefixed key (`BrowserDevicePreferences.cs:51-54`).
  - `RemoveAsync` (`BrowserDevicePreferences.cs:58`) calls `storageRemove` for the prefixed key (`BrowserDevicePreferences.cs:62-64`).
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): preferences are a capability so the MAUI host uses platform secure/preference storage while the browser uses `localStorage`; the fallback-on-failure semantics keep the interface total (a get always returns a `T`).
- **Where it's used** - components reading and writing durable per-device settings (theme, density, dismissed hints) through `IDevicePreferences`.
- **Caveats / not-in-source** - this shares the `storageGet`/`storageSet`/`storageRemove` exports with [BrowserLocalCacheStore](#browserlocalcachestore); the two differ only by key prefix, so a preference and a cache entry with the same logical key do not collide.

### BrowserExternalLinkService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserExternalLinkService.cs:8` · Level 1 · class

- **What it is** - the browser implementation of [IExternalLinkService](#iexternallinkservice): it opens a URL in a new tab via `window.open`, and declares that it does *not* intercept anchor navigation.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); the interface [IExternalLinkService](#iexternallinkservice); `Uri` (BCL).
- **Concept introduced - `InterceptsLinks` as a host capability flag.** `InterceptsLinks => false` (`BrowserExternalLinkService.cs:16`) tells callers that on the web, ordinary `<a target="_blank">` anchors already do the right thing, so components should not route markup links through this service; only *programmatic* opens (for example the maps fallback) need `OpenAsync`. A native host, by contrast, would return `true` and take over link handling. The boolean lets one component template serve both hosts.
  - `[Rubric §26 - Front-End Security]` §26 assesses safe handling of outbound navigation; concentrating programmatic external opens behind one service is where a host would centralize `noopener`/allowlist policy.
- **Walkthrough** - the constructor (`BrowserExternalLinkService.cs:13`) captures the module. `OpenAsync(Uri, ...)` (`BrowserExternalLinkService.cs:19`) null-checks the URI (`BrowserExternalLinkService.cs:21`) and calls the `openExternal` export with the string form (`BrowserExternalLinkService.cs:23-25`), discarding the result since a prerender no-op is acceptable.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) abstracts external-link opening; the `InterceptsLinks` flag exists so shared components can honor native anchor behavior on the web and delegated behavior on native without branching on the host type.
- **Where it's used** - [BrowserMapNavigationService](#browsermapnavigationservice) composes over it; more broadly, any component opening an outbound URL programmatically resolves `IExternalLinkService`.

### BrowserLocalCacheStore

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserLocalCacheStore.cs:10` · Level 1 · class

- **What it is** - the browser implementation of [ILocalCacheStore](#ilocalcachestore): a typed JSON document cache over `localStorage`, using the `mmca.localCache.` key prefix for small offline snapshots.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); `System.Text.Json`; the interface [ILocalCacheStore](#ilocalcachestore).
- **Concept introduced** - this is the second `localStorage`-backed adapter; the namespaced-storage mechanism is introduced under [BrowserDevicePreferences](#browserdevicepreferences). The difference is intent and the miss semantics: where preferences take a caller-supplied `fallback`, the cache returns `default` on a miss. `IsAvailable => true` (`BrowserLocalCacheStore.cs:20`) advertises that a store exists (the native inert fallback would report false). The XML doc (`BrowserLocalCacheStore.cs:6-8`) flags the ~5 MB `localStorage` cap and advises lean documents.
  - `[Rubric §12 - Performance & Scalability]` §12 assesses client-side resource limits; the 5 MB origin quota is the constraint this store lives within, which is why it is scoped to small snapshots rather than a general cache.
- **Walkthrough** -
  - `SetAsync<T>` (`BrowserLocalCacheStore.cs:23`) validates the key (`BrowserLocalCacheStore.cs:25`), serializes to JSON, and writes via `storageSet` under the prefix (`BrowserLocalCacheStore.cs:27-30`).
  - `GetAsync<T>` (`BrowserLocalCacheStore.cs:34`) reads via `storageGet` (`BrowserLocalCacheStore.cs:38-40`), returns `default` on a miss (`BrowserLocalCacheStore.cs:41-44`), and on a `JsonException` also returns `default` (`BrowserLocalCacheStore.cs:46-53`) so a schema change that invalidates an old cached document reads as a cache miss rather than an error.
  - `RemoveAsync` (`BrowserLocalCacheStore.cs:57`) calls `storageRemove` under the prefix (`BrowserLocalCacheStore.cs:61-63`).
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): an offline cache is a capability so the native host can use a richer store while the browser uses `localStorage`. The distinct `mmca.localCache.` prefix keeps cache documents from colliding with preferences (`mmca.devicePrefs.`) even under identical logical keys.
- **Where it's used** - components caching small read-model snapshots for offline/optimistic display through `ILocalCacheStore`.

### BrowserMapNavigationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserMapNavigationService.cs:7` · Level 1 · class

- **What it is** - the browser implementation of [IMapNavigationService](#imapnavigationservice): with no native maps app on the web, it opens a Google Maps search for an address in a new tab.
- **Depends on** - [IExternalLinkService](#iexternallinkservice) (not the JS module directly); `Uri` (BCL). This is the one adapter in the unit built by *composition over another capability* rather than over [CapabilitiesJsModule](#capabilitiesjsmodule).
- **Concept introduced - composing one capability over another.** Rather than reach for JS interop, this adapter takes `IExternalLinkService` (`BrowserMapNavigationService.cs:15`, ctor `BrowserMapNavigationService.cs:18`) and builds a Maps URL to hand it. Layering capabilities keeps the "open a URL" policy (new tab, security) in one place and lets maps navigation be pure URL construction.
  - `[Rubric §1 - SOLID]` §1 assesses dependency direction and single responsibility; depending on the `IExternalLinkService` abstraction rather than duplicating window-open logic is dependency inversion plus reuse in one move.
- **Walkthrough** -
  - `MapsSearchUrl` (`BrowserMapNavigationService.cs:12`) is the public Google Maps search endpoint `https://www.google.com/maps/search/?api=1&query=`. The surrounding `#pragma warning disable S1075` (`BrowserMapNavigationService.cs:11-13`) documents that this hard-coded URL is intentional: the public endpoint *is* the integration point on the web, there is no environment-specific path to externalize.
  - `OpenAddressAsync(string, string?, ...)` (`BrowserMapNavigationService.cs:22`) validates the address (`BrowserMapNavigationService.cs:24`), URL-encodes it with `Uri.EscapeDataString` and appends it to the search endpoint (`BrowserMapNavigationService.cs:26`), delegates to `_externalLinkService.OpenAsync` (`BrowserMapNavigationService.cs:27`), and returns `true` (`BrowserMapNavigationService.cs:28`).
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): map navigation is abstracted so the MAUI host launches the platform maps app while the browser opens a Maps search URL; reusing `IExternalLinkService` means the browser adapter inherits whatever new-tab/open policy that service enforces.
- **Where it's used** - venue/location UI ("open in maps") resolved through `IMapNavigationService`.
- **Caveats / not-in-source** - the `label` parameter is accepted but not used in the browser URL (the Google Maps `search` endpoint keys off the `query` only); it exists to satisfy the interface shape that native hosts use.

### BrowserShareService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Browser` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:8` · Level 1 · class

- **What it is** - the browser implementation of [IShareService](#ishareservice): it shares a link through the Web Share API (`navigator.share`) and reports whether the platform actually shared, so callers can fall back to copy-link when it did not.
- **Depends on** - [CapabilitiesJsModule](#capabilitiesjsmodule); the interface [IShareService](#ishareservice); `Uri` (BCL).
- **Concept introduced - feature-detected sharing with an honest boolean.** The Web Share API is absent on desktop Firefox and in insecure contexts (per the XML doc, `BrowserShareService.cs:5-6`). `ShareLinkAsync` returns a real `bool` so a caller can offer a copy-link fallback when sharing is unavailable, rather than silently doing nothing.
  - `[Rubric §22 - Responsive/Cross-Browser]` §22 assesses graceful behavior where a browser lacks an API; the boolean return plus the [degradation contract](#capabilitiesjsmodule) is the cross-browser fallback mechanism in miniature.
- **Walkthrough** -
  - `ShareLinkAsync(string, Uri, ...)` (`BrowserShareService.cs:16`) null-checks the URI (`BrowserShareService.cs:18`), calls the `shareLink` export with title and string URI (`BrowserShareService.cs:20-22`), and narrows the nullable result with `shared == true` (`BrowserShareService.cs:23`), so an unavailable API or a prerender no-op reports `false`.
  - `ShareFileAsync(...)` (`BrowserShareService.cs:27`) is a hard `Task.FromResult(false)`: file sharing is unsupported on the browser adapter, stated in code rather than by throwing, so callers can branch on the result.
- **Why it's built this way** - [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html): sharing is a capability so the native host uses the OS share sheet (including files) while the browser uses `navigator.share` for links only; returning `false` from `ShareFileAsync` keeps the interface total and steers browser callers to a supported path.
- **Where it's used** - "share" affordances (share a session, share a link) resolved through `IShareService`, with copy-link as the documented fallback when it returns `false`.

### MauiAccessibilityAnnouncer
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiAccessibilityAnnouncer.cs:9` · Level 1 · class (sealed)

- **What it is**: the MAUI-native adapter for [`IAccessibilityAnnouncer`](#iaccessibilityannouncer), pushing a spoken announcement to the platform screen reader (TalkBack / VoiceOver / Narrator) via `SemanticScreenReader.Default`.
- **Depends on**: [`IAccessibilityAnnouncer`](#iaccessibilityannouncer) (the contract it implements); MAUI Essentials `SemanticScreenReader`; BCL `Task`/`FeatureNotSupportedException`.
- **Concept**: this is the first of fifteen per-host adapters in this unit, so it is worth stating the shared shape once. Each class wraps exactly one narrow capability interface (introduced in this group's interface unit) over the platform SDK, and is selected at DI composition time on the native head. `[Rubric §21, Accessibility]` assesses whether non-visual users get equivalent information; this adapter routes the announcement through the OS assistive layer and is a deliberate silent no-op when none is active. `[Rubric §2, Design Patterns]`: adapter + Null-Object, the pairing repeated across the whole capability family.
- **Walkthrough**: `AnnounceAsync(string message, CancellationToken = default)` (`MauiAccessibilityAnnouncer.cs:12`) calls the synchronous `SemanticScreenReader.Default.Announce(message)` (`MauiAccessibilityAnnouncer.cs:16`), swallows `FeatureNotSupportedException` when no screen-reader integration exists on the platform (`MauiAccessibilityAnnouncer.cs:18-21`), and returns `Task.CompletedTask` (`MauiAccessibilityAnnouncer.cs:23`). The platform API is fire-and-forget synchronous, so the async signature is satisfied with an already-completed task rather than an offloaded call.
- **Why it's built this way**: swallowing the not-supported exception keeps call sites unconditional (they never branch on "is a screen reader present"); the completed-task return avoids a needless thread hop for a synchronous OS call.
- **Where it's used**: registered for native heads alongside its siblings [`BrowserAccessibilityAnnouncer`](#browseraccessibilityannouncer) and [`NullAccessibilityAnnouncer`](#nullaccessibilityannouncer); consumed by live-update components announcing events a sighted user perceives only visually.

### MauiBatteryStatusService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiBatteryStatusService.cs:9` · Level 1 · class (sealed partial, `IDisposable`)

- **What it is**: the MAUI adapter for [`IBatteryStatusService`](#ibatterystatusservice), reporting the OS energy-saver state and re-raising the platform's change event over `Battery.Default`.
- **Depends on**: [`IBatteryStatusService`](#ibatterystatusservice); MAUI Essentials `Battery`/`EnergySaverStatus`; BCL `IDisposable`/`EventHandler`.
- **Concept**: the property-plus-change-event capability shape (introduced by [`IBatteryStatusService`](#ibatterystatusservice)) meets a subscription-lifetime concern. This is a singleton that hooks a platform event in its constructor and unhooks in `Dispose`, so it must live and die with the container. `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance]` assess whether the client adapts work to device constraints; here live features can throttle when the OS reports low power.
- **Walkthrough**
  - The constructor (`MauiBatteryStatusService.cs:12`) subscribes `OnEnergySaverStatusChanged` to `Battery.Default.EnergySaverStatusChanged`, so it observes transitions for its whole lifetime.
  - `EnergySaverChanged` (`MauiBatteryStatusService.cs:16`): the contract event, re-raised from the platform handler.
  - `IsEnergySaverOn` (`MauiBatteryStatusService.cs:19`): reads `Battery.Default.EnergySaverStatus == EnergySaverStatus.On` on each access, so subscribers re-read the live value rather than trusting event args.
  - `Dispose()` (`MauiBatteryStatusService.cs:22`) unsubscribes from the platform event, preventing a leak against the process-lifetime `Battery` static.
  - `OnEnergySaverStatusChanged(...)` (`MauiBatteryStatusService.cs:24`) forwards the platform notification as the contract's argument-free `EnergySaverChanged`.
- **Why it's built this way**: subscribing in the constructor and unsubscribing in `Dispose` is the correct lifetime for a static platform event held by a DI singleton; re-reading the property (rather than caching the args) keeps a single source of truth for the current state.
- **Where it's used**: registered for native heads; its fallback sibling is [`NullBatteryStatusService`](#nullbatterystatusservice). Consumed by live/real-time components deciding whether to auto-join channels.

### MauiBiometricAuthenticator
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiBiometricAuthenticator.cs:13` · Level 1 · class (sealed)

- **What it is**: the platform-direct adapter for [`IBiometricAuthenticator`](#ibiometricauthenticator) ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4), driving the AndroidX `BiometricPrompt` on Android, `LAContext` on iOS/MacCatalyst, and reporting unavailable on Windows.
- **Depends on**: [`IBiometricAuthenticator`](#ibiometricauthenticator); per-platform SDKs behind compilation symbols (AndroidX `BiometricManager`/`BiometricPrompt`/`FragmentActivity`, `LocalAuthentication.LAContext`); BCL `TaskCompletionSource`, `MainThread`.
- **Concept**: fail-closed boolean auth gating (introduced by [`IBiometricAuthenticator`](#ibiometricauthenticator)) realized with real platform prompts. `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` assess whether client-side auth degrades safely; every negative outcome here (cancel, lockout, error, unsupported head) collapses to `false`, so callers fall back to credential login and never to a weaker path. `[Rubric §22, Responsive/Cross-Browser]` in its device-platform sense: the body is `#if`-partitioned per target so each head compiles only its own SDK.
- **Walkthrough**
  - Android (`MauiBiometricAuthenticator.cs:15-69`): `AllowedAuthenticators` combines `BiometricWeak | DeviceCredential` (`MauiBiometricAuthenticator.cs:16-18`), so a device PIN/pattern satisfies the prompt when no biometric is enrolled. `IsAvailableAsync` (`:21`) maps `BiometricManager.CanAuthenticate` to `BiometricSuccess`. `AuthenticateAsync` (`:29`) requires a `FragmentActivity` (else `false`, `:31-34`), builds a `TaskCompletionSource`, and on the main thread (`:38`) resolves the main executor (`false` if null, `:41-45`), then shows a `BiometricPrompt` titled `reason` (`:47-52`). Cancellation is wired to resolve `false` (`:55`). The nested `AuthenticationCallback` (`:59`) sets `true` on success (`:62`) and `false` on error (`:65`), but deliberately does **not** complete on `OnAuthenticationFailed` because a single bad attempt leaves the prompt up (`:68`).
  - iOS / MacCatalyst (`MauiBiometricAuthenticator.cs:70-92`): both methods use `LAContext` with `LAPolicy.DeviceOwnerAuthentication` (Face ID / Touch ID with passcode fallback), returning the policy-evaluation result.
  - Other heads (Windows, `MauiBiometricAuthenticator.cs:93-101`): both methods return `Task.FromResult(false)`, because the unpackaged WinUI head cannot present `UserConsentVerifier`.
- **Why it's built this way**: folding every non-success into `false` forbids a partial-success path at the call site; allowing device-credential as well as biometric means a user without enrolled biometrics can still pass the app lock; not completing on a single failed attempt matches the platform prompt's own retry loop.
- **Where it's used**: registered for native heads; the inert fallback is [`NullBiometricAuthenticator`](#nullbiometricauthenticator). Consumed by the stored-token auto-login app-lock gate, toggled through [`DevicePreferenceKeys`](#devicepreferencekeys).
- **Caveats / not-in-source**: the token store and auto-login flow live in the head apps and the Identity layer; this class only answers "is the enrolled user present now".

### MauiClipboardService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiClipboardService.cs:6` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IClipboardService`](#iclipboardservice), writing text to the system clipboard over `Clipboard.Default`.
- **Depends on**: [`IClipboardService`](#iclipboardservice); MAUI Essentials `Clipboard`; BCL `FeatureNotSupportedException`.
- **Concept**: best-effort capability with a success return (introduced by [`IClipboardService`](#iclipboardservice)). `[Rubric §18, UI Architecture]`: the `bool` result is what lets a caller confirm with a snackbar only when the write actually landed.
- **Walkthrough**: `SetTextAsync(string text, CancellationToken = default)` (`MauiClipboardService.cs:9`) awaits `Clipboard.Default.SetTextAsync(text)` and returns `true` (`MauiClipboardService.cs:13-14`), or returns `false` on `FeatureNotSupportedException` (`MauiClipboardService.cs:16-19`).
- **Why it's built this way**: reporting success (not `void`) makes this adapter the copy-link fallback signal for [`IShareService`](#ishareservice) callers when a native share sheet is unavailable.
- **Where it's used**: registered for native heads next to [`BrowserClipboardService`](#browserclipboardservice) and [`NullClipboardService`](#nullclipboardservice); the copy-link fallback path of [`IShareService`](#ishareservice).

### MauiConnectivityStatusService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiConnectivityStatusService.cs:11` · Level 1 · class (sealed partial, `IDisposable`)

- **What it is**: the MAUI adapter for [`IConnectivityStatusService`](#iconnectivitystatusservice), reporting network access and re-raising the change event over `Connectivity.Current`.
- **Depends on**: [`IConnectivityStatusService`](#iconnectivitystatusservice); MAUI Essentials `Connectivity`/`NetworkAccess`; BCL `IDisposable`/`ValueTask`.
- **Concept**: offline-awareness at the UI edge (introduced by [`IConnectivityStatusService`](#iconnectivitystatusservice)), same singleton subscription lifetime as [`MauiBatteryStatusService`](#mauibatterystatusservice). `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation; the offline banner and request-skipping guards read from here.
- **Walkthrough**
  - The constructor (`MauiConnectivityStatusService.cs:14`) subscribes `OnPlatformConnectivityChanged` to `Connectivity.Current.ConnectivityChanged`.
  - `ConnectivityChanged` (`MauiConnectivityStatusService.cs:18`): the contract event.
  - `IsOnline` (`MauiConnectivityStatusService.cs:21`): reads `Connectivity.Current.NetworkAccess == NetworkAccess.Internet`. This is the load-bearing detail: a captive-portal ("constrained") network is treated as offline because the API gateway is unreachable there, which is exactly what the offline banner should say.
  - `InitializeAsync(...)` (`MauiConnectivityStatusService.cs:24`) returns `ValueTask.CompletedTask`, because the native adapter subscribes in its constructor and needs no post-render JS listener setup (unlike the browser adapter).
  - `Dispose()` (`MauiConnectivityStatusService.cs:27`) unsubscribes; `OnPlatformConnectivityChanged` (`MauiConnectivityStatusService.cs:29`) forwards the event.
- **Why it's built this way**: mapping only full `Internet` access to online (not merely "some network") makes the banner honest about gateway reachability; the no-op `InitializeAsync` keeps the always-ready native adapter allocation-free while satisfying the browser-driven contract.
- **Where it's used**: registered for native heads; siblings are [`BrowserConnectivityStatusService`](#browserconnectivitystatusservice) and the Server default [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice). Consumed by the offline banner and request-skipping guards.

### MauiDevicePreferences
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiDevicePreferences.cs:12` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IDevicePreferences`](#idevicepreferences), a typed key/value store for per-device settings backed by `Preferences.Default`.
- **Depends on**: [`IDevicePreferences`](#idevicepreferences); MAUI Essentials `Preferences`; BCL `System.Text.Json`.
- **Concept**: device-scoped client state (introduced by [`IDevicePreferences`](#idevicepreferences); keys from [`DevicePreferenceKeys`](#devicepreferencekeys)). `[Rubric §19, State Management]` assesses whether state has a clear owner and lifetime; these values describe this device and never roam. `[Rubric §26, Front-End Security]`: the doc comment forbids secrets here (those belong in `SecureStorage`).
- **Walkthrough**
  - `KeyPrefix = "mmca.devicePrefs."` (`MauiDevicePreferences.cs:14`): every key is namespaced under a shared prefix, mirroring the browser adapter so key/value semantics hold on every head.
  - `IsPersistent` (`MauiDevicePreferences.cs:17`): `true`, values survive an app restart.
  - `GetAsync<T>(...)` (`MauiDevicePreferences.cs:20`): guards the key, reads the prefixed raw string (returning `fallback` when absent, `:24-28`), then JSON-deserializes, returning `fallback` on a null result or on `JsonException` (`MauiDevicePreferences.cs:30-38`).
  - `SetAsync<T>(...)` (`MauiDevicePreferences.cs:42`): JSON-serializes the value and writes it under the prefixed key.
  - `RemoveAsync(...)` (`MauiDevicePreferences.cs:51`): removes the prefixed key.
- **Why it's built this way**: JSON-encoding every value under one prefix gives the same typed store across MAUI and browser heads with no per-type platform code; deserialization failures degrade to the caller's `fallback` rather than throwing into a render path.
- **Where it's used**: registered for native heads; siblings are [`BrowserDevicePreferences`](#browserdevicepreferences) and the in-memory Server default [`InMemoryDevicePreferences`](#inmemorydevicepreferences). Read/written by device-settings screens and the app-lock gate.

### MauiExternalLinkService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiExternalLinkService.cs:10` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IExternalLinkService`](#iexternallinkservice), opening external URLs in the system browser (or OS handler) because `target="_blank"` dead-ends inside a BlazorWebView.
- **Depends on**: [`IExternalLinkService`](#iexternallinkservice); MAUI Essentials `Browser`/`Launcher`; BCL `Uri`.
- **Concept**: the WebView dead-link workaround (introduced by [`IExternalLinkService`](#iexternallinkservice)). `[Rubric §25, Navigation & IA]` and `[Rubric §18, UI Architecture]`.
- **Walkthrough**
  - `InterceptsLinks` (`MauiExternalLinkService.cs:13`): `true`, because links must be routed through `OpenAsync` inside the WebView rather than rendered as raw anchors.
  - `OpenAsync(Uri uri, CancellationToken = default)` (`MauiExternalLinkService.cs:16`): null-guards `uri`; for `http`/`https` schemes it uses `Browser.Default.OpenAsync(..., BrowserLaunchMode.SystemPreferred)` (`MauiExternalLinkService.cs:22-27`); everything else (`mailto:`, `tel:`, `sms:`) goes to `Launcher.Default.TryOpenAsync` (`MauiExternalLinkService.cs:31`), because `Browser.Default` only accepts http(s). `FeatureNotSupportedException` is swallowed (the link is a convenience, not a workflow, `:33-36`).
- **Why it's built this way**: splitting web schemes (system browser) from contact schemes (OS launcher) makes `mailto:`/`tel:` links work from inside the WebView where a plain anchor would silently do nothing.
- **Where it's used**: registered for native heads; siblings are [`BrowserExternalLinkService`](#browserexternallinkservice) and [`NullExternalLinkService`](#nullexternallinkservice). Consumed by the `ExternalLink` component.

### MauiFormFactor
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:12` · Level 1 · class (sealed)

- **What it is**: the MAUI implementation of [`IFormFactor`](#iformfactor), reporting the actual device idiom and platform via `DeviceInfo`.
- **Depends on**: [`IFormFactor`](#iformfactor) (in `MMCA.Common.UI.Services`); MAUI Essentials `DeviceInfo`.
- **Concept**: unlike the capability adapters above, this implements the older [`IFormFactor`](#iformfactor) contract rather than a `Capabilities` interface, but it follows the same per-host-adapter idea: `[Rubric §22, Responsive/Cross-Browser]` assesses whether the UI adapts across device classes, and this class supplies the native head's real idiom where the browser and WASM siblings supply a web-derived guess.
- **Walkthrough**
  - `GetFormFactor()` (`MauiFormFactor.cs:15`): returns `DeviceInfo.Idiom.ToString()` (Phone, Tablet, Desktop).
  - `GetPlatform()` (`MauiFormFactor.cs:18`): returns `DeviceInfo.Platform.ToString() + " - " + DeviceInfo.VersionString` (e.g. Android, iOS, Windows, macOS with version).
- **Why it's built this way**: the class was hoisted out of the app MAUI heads because it carries no app-specific state, so all heads share one implementation; the doc comment records its siblings `WebFormFactor` ([`WebFormFactor`](#webformfactor)) and `WasmFormFactor` ([`WasmFormFactor`](#wasmformfactor)) and its registration entry point `AddMauiFormFactor()`.
- **Where it's used**: registered on native heads via `AddMauiFormFactor()`; consumed by layout/responsive components that branch on form factor.

### MauiHapticFeedbackService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiHapticFeedbackService.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IHapticFeedbackService`](#ihapticfeedbackservice), firing tactile feedback over `HapticFeedback.Default` and `Vibration.Default`.
- **Depends on**: [`IHapticFeedbackService`](#ihapticfeedbackservice); MAUI Essentials `HapticFeedback`/`Vibration`; BCL `TimeSpan`, `OperatingSystem`.
- **Concept**: decoration-not-behavior capability (introduced by [`IHapticFeedbackService`](#ihapticfeedbackservice)). `[Rubric §18, UI Architecture]`: every failure is swallowed because a missing or blocked vibrator must never affect what the app does.
- **Walkthrough**
  - `IsSupported` (`MauiHapticFeedbackService.cs:14`): `!OperatingSystem.IsWindows()`, since Windows has no haptics.
  - `Click()` / `LongPress()` (`MauiHapticFeedbackService.cs:17`, `:20`): route to the private `Perform` with the matching `HapticFeedbackType`.
  - `Vibrate(TimeSpan duration)` (`MauiHapticFeedbackService.cs:23`): calls `Vibration.Default.Vibrate(duration)`, swallowing both `FeatureNotSupportedException` (no motor/platform) and `PermissionException` (Android `VIBRATE` permission missing from the manifest).
  - `Perform(HapticFeedbackType type)` (`MauiHapticFeedbackService.cs:39`): calls `HapticFeedback.Default.Perform`, swallowing the same two exception types.
- **Why it's built this way**: synchronous `void` methods match the fire-and-forget nature of a UI micro-cue (no caller waits on a buzz), and catching both the not-supported and permission-missing cases keeps a decorative effect strictly off the correctness path.
- **Where it's used**: registered for native heads; the no-op fallback is [`NullHapticFeedbackService`](#nullhapticfeedbackservice). Consumed by interactive components (bookmark toggles, poll votes).

### MauiLocalCacheStore
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiLocalCacheStore.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`ILocalCacheStore`](#ilocalcachestore), storing JSON documents as files in an `mmca-cache` folder under the app data directory.
- **Depends on**: [`ILocalCacheStore`](#ilocalcachestore); BCL `System.IO.File`/`FileSystem`, `System.Text.Json`.
- **Concept**: last-known-good UI state for offline rendering (introduced by [`ILocalCacheStore`](#ilocalcachestore)). `[Rubric §29, Resilience & Business Continuity]`: the on-device cache lets shared components render an offline snapshot when the API is unreachable.
- **Walkthrough**
  - `IsAvailable` (`MauiLocalCacheStore.cs:14`): `true`, native heads always have a writable data directory.
  - `SetAsync<T>(...)` (`MauiLocalCacheStore.cs:17`): resolves the path (creating the directory), JSON-serializes, and `File.WriteAllTextAsync`, swallowing `IOException`/`UnauthorizedAccessException`, a failed write only means a colder next launch (`MauiLocalCacheStore.cs:27-34`).
  - `GetAsync<T>(...)` (`MauiLocalCacheStore.cs:38`): returns `default` if the file is absent, else reads and deserializes, swallowing `IOException`/`UnauthorizedAccessException`/`JsonException` to `default` (`MauiLocalCacheStore.cs:53-64`).
  - `RemoveAsync(...)` (`MauiLocalCacheStore.cs:68`): deletes the file, swallowing IO failures.
  - `GetPath(string key, bool ensureDirectory)` (`MauiLocalCacheStore.cs:88`): builds `mmca-cache` under `FileSystem.AppDataDirectory` and maps the key to a file name through a conservative character filter (letters, digits, `-`, `.` kept; everything else becomes `_`), appending `.json`. The doc comment notes keys are code-controlled, not user input (`MauiLocalCacheStore.cs:8-9`).
- **Why it's built this way**: file-per-key JSON keeps the store dependency-free (no embedded DB), and best-effort IO with `default` returns means a cache miss or corrupt file degrades to a live fetch rather than an error.
- **Where it's used**: registered for native heads; siblings are [`BrowserLocalCacheStore`](#browserlocalcachestore) and the unavailable [`NullLocalCacheStore`](#nulllocalcachestore). Consumed by offline-schedule components.

### MauiMapNavigationService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiMapNavigationService.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IMapNavigationService`](#imapnavigationservice), launching the platform maps app for a street address via `Launcher` URIs.
- **Depends on**: [`IMapNavigationService`](#imapnavigationservice); MAUI Essentials `Launcher`; BCL `Uri`, `OperatingSystem`.
- **Concept**: address-only navigation (introduced by [`IMapNavigationService`](#imapnavigationservice)). `[Rubric §18, UI Architecture]`: address-based, not coordinate-based, because the domain model carries no geo-coordinates.
- **Walkthrough**
  - `OpenAddressAsync(string address, string? label, CancellationToken = default)` (`MauiMapNavigationService.cs:14`): guards the address, URL-escapes it, builds the platform URI, and calls `Launcher.Default.TryOpenAsync`, returning its result or `false` on `FeatureNotSupportedException` (`MauiMapNavigationService.cs:21-28`). The `label` parameter is currently unused by this adapter.
  - `BuildPlatformUri(string escapedQuery)` (`MauiMapNavigationService.cs:31`): returns `geo:0,0?q=...` on Android, `https://maps.apple.com/?q=...` on iOS/MacCatalyst, and `bingmaps:?q=...` elsewhere. The method suppresses SonarAnalyzer `S1075` (`MauiMapNavigationService.cs:35`, `:47`) with a comment that these launcher URIs are the fixed per-platform maps integration point, not configurable paths.
- **Why it's built this way**: routing through the OS launcher (rather than an in-app map) needs no location permission and no geocoding round-trip; hard-coding the scheme per platform is correct because these are OS contracts, and the doc comment notes Android hosts must declare a `geo` intent in the manifest `<queries>` block.
- **Where it's used**: registered for native heads; siblings are [`BrowserMapNavigationService`](#browsermapnavigationservice) and [`NullMapNavigationService`](#nullmapnavigationservice). Consumed by venue/location components.

### MauiScreenshotService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiScreenshotService.cs:10` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IScreenshotService`](#iscreenshotservice), capturing the current screen to a temporary PNG via `Screenshot.Default`.
- **Depends on**: [`IScreenshotService`](#iscreenshotservice); MAUI Essentials `Screenshot`/`FileSystem`; BCL `System.IO`, `Guid`.
- **Concept**: permissionless temp-file capture (introduced by [`IScreenshotService`](#iscreenshotservice)). `[Rubric §30, Compliance/Privacy]` and `[Rubric §26, Front-End Security]`: captures land in the cache directory, never the photo library, so no storage permission is prompted or held.
- **Walkthrough**
  - `IsSupported` (`MauiScreenshotService.cs:13`): `Screenshot.Default.IsCaptureSupported`.
  - `CaptureToFileAsync(CancellationToken = default)` (`MauiScreenshotService.cs:16`): returns `null` early when capture is unsupported (`:18-21`); otherwise captures, writes to `FileSystem.CacheDirectory` as `mmca-screenshot-{guid:N}.png` (`:25-26`), streams the PNG through nested `await using` blocks that dispose the source and file streams deterministically (`:28-36`), and returns the path. `FeatureNotSupportedException` and `IOException` both return `null` (`:40-47`).
- **Why it's built this way**: writing to the cache directory keeps the feature permission-free and lets the OS reclaim the files; the nullable path return lets the share flow abort quietly when capture is unsupported or fails.
- **Where it's used**: registered for native heads; the unsupported fallback is [`NullScreenshotService`](#nullscreenshotservice). Its output is handed to [`IShareService`](#ishareservice) for image sharing.

### MauiShareService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiShareService.cs:6` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`IShareService`](#ishareservice), opening the native share sheet for a link or a local file over `Share.Default`.
- **Depends on**: [`IShareService`](#ishareservice); MAUI Essentials `Share`/`ShareTextRequest`/`ShareFileRequest`; BCL `Uri`.
- **Concept**: share with a copy-link fallback (introduced by [`IShareService`](#ishareservice)). `[Rubric §18, UI Architecture]`: the `bool` returns are what make [`IClipboardService`](#iclipboardservice) copy-link a viable fallback on heads without a share sheet.
- **Walkthrough**
  - `ShareLinkAsync(string title, Uri uri, CancellationToken = default)` (`MauiShareService.cs:9`): null-guards `uri`, requests a `ShareTextRequest` carrying `Title` and the URI string (`:15-19`), returns `true`, or `false` on `FeatureNotSupportedException`.
  - `ShareFileAsync(string title, string filePath, string contentType, CancellationToken = default)` (`MauiShareService.cs:29`): guards `filePath`, requests a `ShareFileRequest` wrapping a `ShareFile(filePath, contentType)` (`:35-39`), returns `true`, or `false` on `FeatureNotSupportedException`/`IOException`.
- **Why it's built this way**: presenting the OS share sheet reuses the platform's own target picker; the boolean returns let a Share button degrade to copy-link on heads where sharing is unavailable.
- **Where it's used**: registered for native heads; siblings are [`BrowserShareService`](#browsershareservice) and [`NullShareService`](#nullshareservice). Consumes [`IScreenshotService`](#iscreenshotservice) output for image sharing and [`IClipboardService`](#iclipboardservice) as its fallback.

### MauiSpeechToTextService
> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common.UI.Maui/Capabilities/MauiSpeechToTextService.cs:14` · Level 1 · class (sealed)

- **What it is**: the MAUI adapter for [`ISpeechToTextService`](#ispeechtotextservice) ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4), driving CommunityToolkit.Maui's `SpeechToText` recognizer and owning the microphone permission flow.
- **Depends on**: [`ISpeechToTextService`](#ispeechtotextservice); `CommunityToolkit.Maui.Media.SpeechToText`; BCL `CultureInfo`, `IProgress<string>`, `TaskCompletionSource`.
- **Concept**: this adapter bridges an event-driven recognizer to the contract's single listen-until-final call. `[Rubric §21, Accessibility]` and `[Rubric §24, Forms/Validation/UX Safety]`: dictation is an input affordance whose denial or failure must never wedge a form; every negative outcome returns `null` and the affordance simply does nothing.
- **Walkthrough**
  - `IsSupported` (`MauiSpeechToTextService.cs:17`): `true`.
  - `ListenAsync(CultureInfo culture, IProgress<string>? partialResults, CancellationToken = default)` (`MauiSpeechToTextService.cs:20`): guards `culture`; requests recognition permissions and returns `null` if denied (`:29-32`); creates a `TaskCompletionSource<string?>`; wires `OnUpdated` to forward interim text to `partialResults` (`:36-37`) and `OnCompleted` to resolve the final `Text` when successful or `null` otherwise (`:39-40`); subscribes both events, starts listening with `SpeechToTextOptions` (culture plus `ShouldReportPartialResults` only when a progress sink was passed, `:46-51`); registers cancellation to resolve `null` (`:53-54`); and in a `finally` unsubscribes both handlers and calls `StopListenAsync` (`:57-62`). `OperationCanceledException` and the `InvalidOperationException`/`FeatureNotSupportedException` pair all return `null` (`:64-71`).
- **Why it's built this way**: the recognizer exposes start/stop with update/complete events, so a `TaskCompletionSource` is the idiomatic way to present it as one awaitable call; the guaranteed unsubscribe-and-stop in `finally` prevents a leaked recognizer session across dictations.
- **Where it's used**: registered for native heads; the fallback is [`NullSpeechToTextService`](#nullspeechtotextservice). Consumed by dictation affordances on text inputs.

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

### MauiGeocodingService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiGeocodingService.cs:10` · Level 2 · class

- **What it is**: the MAUI-native implementation of [`IGeocodingService`](#igeocodingservice): it turns a free-text address into a latitude/longitude [`GeoPoint`](#geopoint) by delegating to MAUI Essentials' `Geocoding.Default`. It is the concrete leg selected on the mobile/desktop head; the browser and inert fallbacks live elsewhere in this group.
- **Depends on**: [`IGeocodingService`](#igeocodingservice) and [`GeoPoint`](#geopoint) (the capability contract and its value carrier, both defined in `MMCA.Common.UI`, `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiGeocodingService.cs:1`); MAUI Essentials `Geocoding.Default` and `FeatureNotSupportedException` (NuGet, `Microsoft.Maui.Essentials`).
- **Concept introduced**: the **per-host capability adapter** pattern is introduced by the contracts and browser adapters earlier in this group, so it is only cross-referenced here: one interface in `MMCA.Common.UI`, several implementations (MAUI-native, browser-JS, inert null), and DI at the host picks exactly one ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). This file also shows the group's signature **degrade-to-null discipline**: every proximity affordance returns `null` rather than throwing when the platform cannot answer. `[Rubric §22 - Responsive/Cross-Browser]` assesses how gracefully the app spans device classes and runtimes; this adapter embodies it by giving the mobile head a real geocoder while the same call site degrades cleanly where geocoding is absent. `[Rubric §10 - Cross-Cutting]` assesses how uniformly ambient concerns are handled; the swallow-and-return-null contract is applied identically across every capability here.
- **Walkthrough**: `IsSupported` is a constant `true` (`MauiGeocodingService.cs:13`): on a MAUI head geocoding is always wired, since it is a network lookup rather than a permission-gated sensor. `GeocodeAsync` (`MauiGeocodingService.cs:16`) guards the input with `ArgumentException.ThrowIfNullOrWhiteSpace(address)` (`:18`), then calls `Geocoding.Default.GetLocationsAsync(address)` and takes `FirstOrDefault()` of the returned candidates (`:22-23`). A hit becomes `new GeoPoint(first.Latitude, first.Longitude)`; an empty result stays `null` (`:24`). Two catch arms enforce the degrade contract: `FeatureNotSupportedException` (`:26`) covers a platform with no geocoder, and a filtered catch for `TimeoutException`, `InvalidOperationException`, or `IOException` (`:30`) covers an offline or unavailable geocoder. Both simply return `null`, so the proximity hint is omitted rather than surfaced as an error.
- **Why it's built this way**: geocoding is a non-essential enhancement (a proximity hint on a card), so the correct failure mode is silence, not an exception the UI must handle. Note the deliberate narrow exception filter at `:30`: it does not blanket-catch, so a programming error outside those known-transient types still propagates. The adapter split (native here, browser/null elsewhere) is the [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) device-capability-abstraction decision.
- **Where it's used**: resolved wherever the app requests [`IGeocodingService`](#igeocodingservice); registered on the MAUI head by that package's capability wiring (the `UseMauiDeviceCapabilities` composition described in [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)), overriding the `TryAdd` fallback that `AddUIShared` registers.

### MauiGeolocationService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiGeolocationService.cs:11` · Level 2 · class

- **What it is**: the MAUI-native [`IGeolocationService`](#igeolocationservice): it reads the device's current position (or a recent cached fix) and returns a [`GeoPoint`](#geopoint), driving the soft when-in-use location-permission flow itself.
- **Depends on**: [`IGeolocationService`](#igeolocationservice) and [`GeoPoint`](#geopoint) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiGeolocationService.cs:1`); MAUI Essentials `Geolocation.Default`, `Permissions.LocationWhenInUse`, `PermissionStatus`, `GeolocationRequest`, `MainThread`, and the `FeatureNotSupportedException`/`FeatureNotEnabledException`/`PermissionException` family (NuGet, `Microsoft.Maui.Essentials`); BCL `TimeSpan`/`DateTimeOffset`.
- **Concept introduced**: this is the first capability in the unit that touches an OS **permission prompt**, so it teaches the soft-permission pattern: check the current grant, request it once on the main thread only if not already granted, and treat any denial as a `null` result rather than a blocking error. Unlike geocoding (a network call), reading location is a sensor read the OS gates. `[Rubric §26 - Front-End Security]` assesses least-privilege access to device-sensitive capabilities; requesting when-in-use (not always-on) location and prompting at most once embodies that restraint. `[Rubric §11 - Security]` (the general lens) applies for the same reason: the code never assumes access it has not been granted.
- **Walkthrough**: two `static readonly` tunables set policy: `LastKnownFreshness = TimeSpan.FromMinutes(5)` and `CurrentFixTimeout = TimeSpan.FromSeconds(10)` (`MauiGeolocationService.cs:13-14`). `IsSupported` is `true` (`:17`). `GetCurrentOrLastKnownAsync` (`:20`) first checks `Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>()` (`:24`); if not `Granted` it requests once, marshalled through `MainThread.InvokeOnMainThreadAsync` with a `static` lambda so the platform prompt runs on the UI thread (`:27-28`). Still not granted returns `null` (`:31-34`). It then prefers a cheap cached fix: `Geolocation.Default.GetLastKnownLocationAsync()` is accepted only if `IsFresh` (`:36-40`), where `IsFresh` compares the fix timestamp against `UtcNow - LastKnownFreshness` (`:61-62`). Otherwise it takes a live fix via `GetLocationAsync` with a `GeolocationRequest(GeolocationAccuracy.Medium, CurrentFixTimeout)`, passing the caller's `cancellationToken` (`:42-43`). Three catch arms return `null`: `FeatureNotSupportedException` (no GPS), `FeatureNotEnabledException` (location services off at the OS), and `PermissionException` (`:46-58`).
- **Why it's built this way**: the last-known-fresh-else-live ladder trades precision for battery and latency: a five-minute-old fix is good enough for a proximity hint and avoids waking the GPS. `GeolocationAccuracy.Medium` and a ten-second timeout keep the read cheap. Running the request on the main thread is required by the platform prompt APIs. The whole thing degrades to `null` for the same reason geocoding does: location is an enhancement, not a hard dependency ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Where it's used**: resolved via [`IGeolocationService`](#igeolocationservice) by any feature wanting device proximity; registered on the MAUI head, overriding the shared `TryAdd` fallback.

### MauiLocalNotificationService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiLocalNotificationService.cs:13` · Level 2 · class

- **What it is**: the MAUI-native [`ILocalNotificationService`](#ilocalnotificationservice): it schedules, cancels, and requests permission for **local** (on-device, no server) notifications by mapping the framework's [`LocalNotificationRequest`](#localnotificationrequest) onto the Plugin.LocalNotification package.
- **Depends on**: [`ILocalNotificationService`](#ilocalnotificationservice), [`LocalNotificationRequest`](#localnotificationrequest), and [`IDeepLinkDispatcher`](#ideeplinkdispatcher) (referenced in the doc contract for tap routing, `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiLocalNotificationService.cs:11`); the `Plugin.LocalNotification` NuGet package (`LocalNotificationCenter`, `NotificationRequest`, `NotificationRequestSchedule`, `:2-3`); BCL `DateTimeOffset`.
- **Concept introduced**: this is the group's **anti-corruption mapping** example: the framework's own `LocalNotificationRequest` DTO is kept independent of the third-party `NotificationRequest` shape, and this adapter is the single place the two are reconciled. Callers never see the plugin type. `[Rubric §2 - Design Patterns]` assesses disciplined use of patterns; the adapter/anti-corruption boundary here keeps a swappable dependency from leaking into feature code. `[Rubric §26 - Front-End Security]` again applies via the explicit permission request that respects Android 13+ `POST_NOTIFICATIONS` and iOS authorization.
- **Walkthrough**: `IsSupported` is `true` (`MauiLocalNotificationService.cs:16`). `RequestPermissionAsync` (`:19`) short-circuits to `true` if `AreNotificationsEnabled()` already reports granted, else calls `RequestNotificationPermission()`; an `InvalidOperationException` degrades to `false` (`:23-33`). `ScheduleAsync` (`:37`) null-guards the request (`:39`), silently drops any `DeliverAt` at or before now (`:41-44`, no past-dated reminders), then maps field-by-field into a plugin `NotificationRequest`: `Id → NotificationId`, `Title`, `Body → Description`, `DeepLinkRoute ?? string.Empty → ReturningData`, and `DeliverAt → Schedule.NotifyTime` (`:46-56`). The `Show` call is wrapped so a mid-session permission revocation (`InvalidOperationException`) becomes a no-op reminder rather than a crash (`:58-65`). `CancelAsync` (`:69`) null-guards the id list and, only when non-empty, calls `Cancel([.. ids])` (a collection expression spreading the ids into the plugin's params array, `:73-75`); `CancelAllAsync` (`:82`) forwards to `CancelAll()`. Both cancel methods return `Task.CompletedTask` (the plugin calls are synchronous).
- **Why it's built this way**: the doc comment records two deliberate platform choices (`:8-11`): scheduling uses **inexact** platform alarms (no `SCHEDULE_EXACT_ALARM`, which Play policy restricts), and notification **taps** are routed to [`IDeepLinkDispatcher`](#ideeplinkdispatcher) by the package bootstrap, not by this service, keeping tap-handling in the single deep-link route table ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Carrying the deep-link route through `ReturningData` is how a tapped reminder later reaches the dispatcher.
- **Where it's used**: resolved via [`ILocalNotificationService`](#ilocalnotificationservice) by features scheduling reminders; registered on the MAUI head over the shared fallback.
- **Caveats / not-in-source**: the actual tap-to-dispatcher wiring is asserted by the doc comment to live in the package bootstrap; it is not in this file. Not determinable from source here: the exact bootstrap that binds `ReturningData` back to [`IDeepLinkDispatcher`](#ideeplinkdispatcher).

### MauiMediaPickerService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiMediaPickerService.cs:11` · Level 2 · class

- **What it is**: the MAUI-native [`IMediaPickerService`](#imediapickerservice): it lets the user pick a photo from the library or capture one with the camera, returning a [`PickedMedia`](#pickedmedia) (an open stream plus filename and content type). It backs the avatar-upload flow ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Depends on**: [`IMediaPickerService`](#imediapickerservice) and [`PickedMedia`](#pickedmedia) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiMediaPickerService.cs:1`); MAUI Essentials `MediaPicker.Default`, `DeviceInfo.Current`, `DevicePlatform`, and `FileResult` (NuGet, `Microsoft.Maui.Essentials`).
- **Concept introduced**: reinforces the degrade-to-null discipline for a user-cancellable, permission-gated capability, with one nuance the earlier adapters lack: it distinguishes **cancellation** from **failure**. An `OperationCanceledException` is rethrown so the caller's own token semantics are honored, while every other failure (denied permission, unsupported device) collapses to `null`. `[Rubric §24 - Forms/Validation/UX Safety]` assesses how safely user-input flows handle abandonment and error; preserving cancellation while swallowing capability failures is exactly that safety. `[Rubric §22 - Responsive/Cross-Browser]` applies through the platform-aware `IsSupported`.
- **Walkthrough**: `IsSupported` (`MauiMediaPickerService.cs:14`) is `true` when either capture is supported or the platform is not WinUI, so the library-pick path stays available on desktop even where the camera is not. `PickPhotoAsync` (`:17`) delegates to `MediaPicker.Default.PickPhotoAsync()` through the shared `PickCoreAsync` helper, with a scoped `#pragma warning disable CS0618` (`:18-20`): the single-select API is flagged obsolete in favor of multi-select, but an avatar is exactly one photo, so the suppression is intentional and documented inline. `CapturePhotoAsync` (`:23`) checks `IsCaptureSupported` first and returns `Task.FromResult<PickedMedia?>(null)` when there is no camera, otherwise routes through the same helper. `PickCoreAsync` (`:28`) awaits the platform pick, returns `null` on a cancelled sheet (a `null` `FileResult`, `:33-35`), opens the file stream, honors `cancellationToken.ThrowIfCancellationRequested()` after the read starts (`:38-39`), and wraps the result as `new PickedMedia(stream, file.FileName, file.ContentType ?? "application/octet-stream")` (`:40`). The catch block rethrows `OperationCanceledException` (`:42-45`) but blanket-catches everything else to `null` under a scoped `#pragma warning disable CA1031` (`:46-51`), since a denied permission is a normal outcome here, not an error.
- **Why it's built this way**: an avatar picker must never crash the page: a user who declines the permission or backs out of the sheet should land back on the form unchanged, which is why the only exception allowed to escape is cancellation. The returned stream is left open for the caller (upload/processing) to consume and dispose. Passing the picked bytes to the server-side avatar contract (2 MB in, 256x256 JPEG out, all metadata stripped) is the [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) pipeline this feeds.
- **Where it's used**: resolved via [`IMediaPickerService`](#imediapickerservice) by the avatar-upload UI; on web heads the same contract is satisfied by an `InputFile`-based implementation instead ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), registered on the MAUI head over the shared fallback.

### MauiPushRegistrationService

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui.Capabilities` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiPushRegistrationService.cs:15` · Level 2 · class

- **What it is**: the native push-registration orchestrator ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): it fetches the platform push token, maintains a stable client-generated installation id in device preferences, and syncs (or removes) the installation on the server's `Notifications/Devices` endpoints. It is the most collaborator-heavy adapter in this unit and the only one taking constructor dependencies.
- **Depends on**: [`IPushRegistrationService`](#ipushregistrationservice) (the contract it implements), [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) (the app-supplied token source), and [`IDevicePreferences`](#idevicepreferences) (persistent key/value store), all injected via primary constructor (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiPushRegistrationService.cs:15-19`); BCL `IHttpClientFactory`, `PutAsJsonAsync`/`DeleteAsync` (`System.Net.Http.Json`, `:1`), `ILogger<T>` with source-generated `[LoggerMessage]` (`:2`), and `Guid`.
- **Concept introduced**: this is the unit's first adapter that talks to the **backend** rather than only the OS, and it introduces the group's **inert-by-construction** default: the service is fully wired but does nothing useful until the app supplies a credentialed [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider), because the default provider yields no token and `RegisterAsync` returns early. It also uses **source-generated logging** (`[LoggerMessage]` partial methods) rather than string-interpolated log calls. `[Rubric §13 - Observability]` assesses how well operational events are captured; the three `[LoggerMessage]` methods give push registration structured, allocation-light diagnostics without breaking the never-throw contract. `[Rubric §9 - API & Contract Design]` applies through the REST sync (PUT to register, DELETE to unregister) against the `Notifications/Devices` contract. `[Rubric §26 - Front-End Security]` applies because the sync rides the authenticated `"APIClient"`.
- **Walkthrough**: the class is `sealed partial` (partial for the generated log methods) with a primary constructor capturing the four dependencies (`MauiPushRegistrationService.cs:15-19`); `InstallationIdKey` is a constant preferences key (`:21`), `IsSupported` is `true` (`:24`). `RegisterAsync` (`:27`) asks `tokenProvider.GetTokenAsync`; a `null` token returns `false` (the inert path, `:31-35`). Otherwise it gets-or-creates the installation id, creates the named `"APIClient"` HTTP client (`:38`, the authenticated pipeline), and `PutAsJsonAsync` to the relative `Notifications/Devices` uri a body of `{ InstallationId, token.Platform, PushChannel = token.Token }` (`:39-42`). A non-success status logs `LogRegistrationRejected` with the status code and returns `false` (`:44-48`); success returns `true`. `UnregisterAsync` (`:62`) reads the stored installation id, no-ops if absent (`:66-70`), and `DeleteAsync` to `Notifications/Devices/{escaped-id}` with `Uri.EscapeDataString` guarding the path segment (`:72-75`). `GetOrCreateInstallationIdAsync` (`:85`) returns the persisted id if present, else generates `Guid.NewGuid().ToString("N")`, persists it via `devicePreferences.SetAsync`, and returns it (`:87-95`) so the same physical device keeps one stable identity across launches. Both public methods blanket-catch (scoped `#pragma warning disable CA1031`, `:52-58` and `:77-82`) into a warning log and a benign return, honoring the never-throw contract. The three `[LoggerMessage]` partials (`:98-105`) declare the rejected/failed/unregister-failed events at `Warning`.
- **Why it's built this way**: registration is a best-effort side channel: the inbox stays the source of truth ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), so a failed device sync must never surface to the user or throw. A client-generated stable installation id lets the server upsert one row per device (PUT is idempotent) and delete it precisely on sign-out, without the server minting ids. The Null token provider default keeps credential-less builds compiling and wired but inert (`:12-13`), so a downstream app opts in to push simply by registering a real provider. `Notifications/Devices` PUT/DELETE is the [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) `DevicesController` contract.
- **Where it's used**: resolved via [`IPushRegistrationService`](#ipushregistrationservice) on the MAUI head; invoked around sign-in (register) and sign-out (unregister). The server side is the [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) native-push pipeline (`INativePushSender`/`IPushDeviceRegistrar`).
- **Caveats / not-in-source**: the concrete `"APIClient"` handler chain (base address, bearer-token attachment) is configured by the head's HTTP wiring, not in this file. Not determinable from source here: which [`IPushDeviceTokenProvider`](#ipushdevicetokenprovider) implementation a given app registers (the default is the inert Null provider per [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).

### AlwaysOnlineConnectivityStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/AlwaysOnlineConnectivityStatusService.cs:7` · Level 1 · class

- **What it is**: the default, host-agnostic implementation of [`IConnectivityStatusService`](#iconnectivitystatusservice): it reports the app as permanently online and never signals a connectivity change.
- **Depends on**: [`IConnectivityStatusService`](#iconnectivitystatusservice) (the contract it satisfies) and BCL `EventHandler` / `ValueTask` only. No native platform APIs, no `MMCA.Common.UI.Maui` dependency.
- **Concept introduced (the inert-fallback / Null Object tier of the device-capability layer).** This is the first fallback type in the unit, so the pattern is worth teaching from first principles. Every device capability the UI can use (biometrics, geolocation, speech, haptics, sharing, push registration, connectivity, battery, and so on) is expressed as a small per-capability interface in `MMCA.Common.UI.Services.Capabilities`. Because a single shared Blazor component tree runs on three very different hosts (a MAUI Blazor Hybrid native shell, a browser Blazor WebAssembly/Server head, and backend-less test/gallery hosts), a component cannot assume any given capability exists. The framework resolves this with three registration tiers, selected per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)): the MAUI package registers real native adapters, the browser head registers JS-interop adapters, and `AddUIShared` registers this fallback tier with `TryAdd` so that *some* implementation is always resolvable even when nothing richer was added. The fallbacks are pure Null Objects: they satisfy the interface, do the safe inert thing, and never throw, so calling code never has to null-check a capability. This is [Rubric §2, Design Patterns] (the Null Object pattern applied uniformly across a capability surface) and [Rubric §1, SOLID] (Liskov substitutability: a component holding the interface behaves correctly whichever tier answered, and the dependency-inversion boundary keeps components off concrete platform APIs). It is also [Rubric §18, UI Architecture] and [Rubric §22, Responsive / Cross-Browser], because the same component set degrades gracefully from a native shell down to a plain web page without host-specific branches in the markup.
- **Walkthrough**: the class is `sealed` (`AlwaysOnlineConnectivityStatusService.cs:7`). The `ConnectivityChanged` event (`:10`) declares explicit `add`/`remove` accessors whose bodies are intentionally empty (`:12`, `:17`): subscribers are accepted but the event is never raised, because on this host connectivity is treated as constant. `IsOnline` (`:24`) is an expression-bodied property returning `true`. `InitializeAsync` (`:27`) returns `ValueTask.CompletedTask`, so warm-up is a no-op.
- **Why it's built this way**: the class comment (`:4`) records the rationale: on Blazor Server a dropped connection tears down the SignalR circuit itself, so a per-app "am I online?" signal is meaningless there, and "always online, never raises" is the *correct* default rather than a mere stub. Native heads that genuinely track radio state override it with `Add`.
- **Where it's used**: resolved by any component or service that injects [`IConnectivityStatusService`](#iconnectivitystatusservice) on a host that did not register a native/browser connectivity adapter.

### InMemoryDevicePreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/InMemoryDevicePreferences.cs:10` · Level 1 · class

- **What it is**: the default [`IDevicePreferences`](#idevicepreferences): a non-persistent key/value store that keeps preference values in memory for the lifetime of its DI scope only.
- **Depends on**: [`IDevicePreferences`](#idevicepreferences) and BCL `ConcurrentDictionary<string, object?>`.
- **Concept introduced**: unlike the pure Null Objects around it, this fallback carries *real* behavior: it is the only member of this unit that actually stores and returns data. It signals its limitation through the interface contract rather than by failing, which is a recurring shape in this layer (a `bool` "is this real?" property that hosts read to decide whether to show capability-dependent UI). See the fallback-tier concept under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice). [Rubric §19, State Management] applies: preferences are the small slice of client state whose durability differs per host, and the durability answer is data (`IsPersistent`), not a thrown exception.
- **Walkthrough**: a `readonly ConcurrentDictionary<string, object?>` built with `StringComparer.Ordinal` backs the store (`:12`); the concurrent type is chosen because Blazor scopes can be touched from more than one async continuation. `IsPersistent` (`:15`) returns `false`, the honest admission that these values do not survive a restart. `GetAsync<T>` (`:18`) guards the key with `ArgumentException.ThrowIfNullOrWhiteSpace`, then returns the stored value only when it is present and of the requested type `T`, otherwise the caller-supplied `fallback` (`:22`). `SetAsync<T>` (`:28`) and `RemoveAsync` (`:37`) apply the same key guard, then write or `TryRemove`. All three return completed `Task`s (the work is synchronous under an async contract).
- **Why it's built this way**: the class comment (`:5`) explains the intended consumer behavior: because `IsPersistent` is `false`, a host can hide device-settings UI that would otherwise promise durability it cannot deliver. A native head swaps in a platform-backed preferences store with `IsPersistent => true`.
- **Where it's used**: injected wherever the UI reads or writes device-scoped preferences and no persistent adapter was registered.

### NullAccessibilityAnnouncer
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullAccessibilityAnnouncer.cs:4` · Level 1 · class

- **What it is**: the default [`IAccessibilityAnnouncer`](#iaccessibilityannouncer): screen-reader announcements are silently dropped.
- **Depends on**: [`IAccessibilityAnnouncer`](#iaccessibilityannouncer) and BCL `Task` only.
- **Walkthrough**: a single `sealed` class (`:4`) with `AnnounceAsync(string message, ...)` returning `Task.CompletedTask` (`:7`). No state, no side effects. See the fallback-tier concept under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: a Null Object keeps [Rubric §21, Accessibility] wiring resolvable on every host; heads that own a live-region or native accessibility API replace it so announcements actually reach assistive technology.
- **Where it's used**: injected by components that push polite/assertive live-region messages.

### NullBatteryStatusService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBatteryStatusService.cs:4` · Level 1 · class

- **What it is**: the default [`IBatteryStatusService`](#ibatterystatusservice): energy-saver mode is never reported active and the change event never fires.
- **Depends on**: [`IBatteryStatusService`](#ibatterystatusservice) and BCL `EventHandler`.
- **Walkthrough**: the `sealed` class (`:4`) mirrors the connectivity fallback's shape: `EnergySaverChanged` (`:7`) has empty `add`/`remove` accessors (`:9`, `:14`) so subscriptions are accepted but never invoked, and `IsEnergySaverOn` (`:21`) returns `false`. See [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice) for the event-never-raised idiom and the fallback tier.
- **Why it's built this way**: web hosts have no OS battery signal, so "never energy-saving" is the safe default that lets performance-sensitive components (for example, animation throttling) run unthrottled; native heads override with real battery telemetry.
- **Where it's used**: injected by components that adapt behavior to low-power mode.

### NullBiometricAuthenticator
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBiometricAuthenticator.cs:4` · Level 1 · class

- **What it is**: the default [`IBiometricAuthenticator`](#ibiometricauthenticator): biometric app-lock is reported unavailable and any authentication attempt fails.
- **Depends on**: [`IBiometricAuthenticator`](#ibiometricauthenticator) and BCL `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:4`) returns `Task.FromResult(false)` from both `IsAvailableAsync` (`:7`) and `AuthenticateAsync(string reason, ...)` (`:11`). The availability flag and the auth result are the same `false`, so a host that checks availability first will never call authenticate. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) notes hosts hide the app-lock toggle when biometrics are unavailable, which keeps the security affordance ([Rubric §26, Front-End Security]) honest: no fake lock UI on a head that cannot enforce it. MAUI supplies a real fingerprint/face adapter.
- **Where it's used**: injected by app-lock / sensitive-screen guard components.

### NullClipboardService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullClipboardService.cs:4` · Level 1 · class

- **What it is**: the default [`IClipboardService`](#iclipboardservice): copying text to the clipboard is reported as failed.
- **Depends on**: [`IClipboardService`](#iclipboardservice) and BCL `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:4`) has one member, `SetTextAsync(string text, ...)`, returning `Task.FromResult(false)` (`:7`). The `bool` return is the failure signal callers branch on. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: returning `false` rather than throwing lets a copy-to-clipboard button degrade to an alternate UX (for example, showing selectable text) instead of erroring; browser heads register a JS-interop clipboard adapter that returns `true`.
- **Where it's used**: injected by copy-link / copy-code UI elements.

### NullExternalLinkService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullExternalLinkService.cs:7` · Level 1 · class

- **What it is**: the default [`IExternalLinkService`](#iexternallinkservice): it does not intercept outbound links, so components render ordinary anchors.
- **Depends on**: [`IExternalLinkService`](#iexternallinkservice) and BCL `Uri` / `Task`.
- **Walkthrough**: the `sealed` class (`:7`) exposes `InterceptsLinks` returning `false` (`:10`) and `OpenAsync(Uri uri, ...)` returning `Task.CompletedTask` (`:13`). Because `InterceptsLinks` is `false`, well-behaved components never call `OpenAsync` at all; they emit a plain `<a target="_blank">`. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) explains this is the *correct* behavior on web heads even without JS: a normal anchor already opens an external URL in a new tab. It exists as an override point for BlazorWebView (MAUI), where `target="_blank"` is dead and links must be handed to the OS browser instead ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). This is the `ExternalLink`-over-raw-anchor decision recorded in [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html).
- **Where it's used**: injected by the shared `ExternalLink` component and anywhere the UI opens off-app URLs.

### NullHapticFeedbackService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullHapticFeedbackService.cs:4` · Level 1 · class

- **What it is**: the default [`IHapticFeedbackService`](#ihapticfeedbackservice): no vibration hardware, so every haptic call is a no-op.
- **Depends on**: [`IHapticFeedbackService`](#ihapticfeedbackservice) and BCL `TimeSpan`.
- **Walkthrough**: the `sealed` class (`:4`) reports `IsSupported => false` (`:7`) and provides empty `Click()` (`:10`), `LongPress()` (`:16`), and `Vibrate(TimeSpan duration)` (`:22`). These are the unit's only *synchronous* (non-`Task`) capability methods, matching the fire-and-forget nature of haptics. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: no-op methods plus an `IsSupported` flag let interaction code request haptics unconditionally while a host with a vibrator motor opts in; the fallback keeps web and desktop heads quiet.
- **Where it's used**: injected by tactile-feedback wrappers around buttons and gestures.

### NullLocalCacheStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullLocalCacheStore.cs:4` · Level 1 · class

- **What it is**: the default [`ILocalCacheStore`](#ilocalcachestore): nothing is cached, and reads always return `default`.
- **Depends on**: [`ILocalCacheStore`](#ilocalcachestore) and BCL `Task` / `Task<T?>`.
- **Walkthrough**: the `sealed` class (`:4`) reports `IsAvailable => false` (`:7`). `SetAsync<T>` (`:10`) and `RemoveAsync` (`:18`) return `Task.CompletedTask` (writes are discarded); `GetAsync<T>` (`:14`) returns `Task.FromResult<T?>(default)`, so a miss is guaranteed. This is a write-black-hole / read-empty store. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: `IsAvailable` lets a component skip an offline read path entirely when no durable local cache exists; native/browser heads supply a real store (for example, over platform storage or IndexedDB). [Rubric §23, Front-End Performance] is the relevant lens: local caching is a performance capability the fallback declares absent rather than faking.
- **Where it's used**: injected by offline-read and response-caching UI helpers.

### NullMapNavigationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullMapNavigationService.cs:4` · Level 1 · class

- **What it is**: the default [`IMapNavigationService`](#imapnavigationservice): no maps integration; opening an address reports failure.
- **Depends on**: [`IMapNavigationService`](#imapnavigationservice) and BCL `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:4`) has one member, `OpenAddressAsync(string address, string? label, ...)`, returning `Task.FromResult(false)` (`:7`). The nullable `label` is accepted and ignored. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: a `false` result lets an "open in maps" affordance fall back to plain address text; native heads launch the OS maps app.
- **Where it's used**: injected by venue / location UI that offers turn-by-turn hand-off.

### NullPushRegistrationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushRegistrationService.cs:7` · Level 1 · class

- **What it is**: the default [`IPushRegistrationService`](#ipushregistrationservice): OS-level push registration is unsupported, so registering is a failed no-op.
- **Depends on**: [`IPushRegistrationService`](#ipushregistrationservice) and BCL `Task` / `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:7`) reports `IsSupported => false` (`:10`), `RegisterAsync` returns `Task.FromResult(false)` (`:13`), and `UnregisterAsync` returns `Task.CompletedTask` (`:16`) so tearing down is always safe to call. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) records the [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) rationale precisely: web heads already receive real-time notifications over the SignalR hub while the page is open and have no OS-level installation to manage, so no-op push registration is correct, not a gap. Native heads register with Azure Notification Hubs (FCM v1 / APNs) via the MAUI package. This is the client leg of [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)'s native push channel; the credential-less-but-inert posture keeps builds wired without a device token.
- **Where it's used**: injected by notification-preferences / permission-prompt UI.

### NullScreenshotService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullScreenshotService.cs:4` · Level 1 · class

- **What it is**: the default [`IScreenshotService`](#iscreenshotservice): screen capture is unavailable.
- **Depends on**: [`IScreenshotService`](#iscreenshotservice) and BCL `Task<string?>`.
- **Walkthrough**: the `sealed` class (`:4`) reports `IsSupported => false` (`:7`) and `CaptureToFileAsync` returning `Task.FromResult<string?>(null)` (`:10`) (a null file path meaning "no capture"). See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the null-path convention lets a "save screenshot" action gate itself on `IsSupported` and skip cleanly; native heads implement real capture-to-file.
- **Where it's used**: injected by share-a-screenshot / diagnostics UI.

### NullShareService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullShareService.cs:4` · Level 1 · class

- **What it is**: the default [`IShareService`](#ishareservice): the native share sheet is unavailable, so callers fall back to copy-link.
- **Depends on**: [`IShareService`](#ishareservice) and BCL `Uri` / `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:4`) returns `Task.FromResult(false)` from both `ShareLinkAsync(string title, Uri uri, ...)` (`:7`) and `ShareFileAsync(string title, string filePath, string contentType, ...)` (`:11`). See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) names the intended degradation: a `false` result routes callers to copy-link instead of a native share sheet. MAUI supplies a real share adapter.
- **Where it's used**: injected by share buttons on shareable entities (sessions, links, files).

### NullSpeechToTextService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullSpeechToTextService.cs:6` · Level 1 · class

- **What it is**: the default [`ISpeechToTextService`](#ispeechtotextservice): no recognizer, so dictation is unavailable.
- **Depends on**: [`ISpeechToTextService`](#ispeechtotextservice), BCL `CultureInfo`, `IProgress<string>`, `Task<string?>`.
- **Walkthrough**: the `sealed` class (`:6`) reports `IsSupported => false` (`:9`). `ListenAsync(CultureInfo culture, IProgress<string>? partialResults, ...)` (`:12`) accepts a target culture and an optional partial-results reporter but returns `Task.FromResult<string?>(null)` (`:16`) immediately: no interim progress is ever reported and the final result is null. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:5`) notes components hide the microphone affordance when `IsSupported` is false; native heads provide a platform speech recognizer that streams partials through the `IProgress<string>`.
- **Where it's used**: injected by voice-input / dictation controls.

### NullTextToSpeechService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullTextToSpeechService.cs:4` · Level 1 · class

- **What it is**: the default [`ITextToSpeechService`](#itexttospeechservice): no synthesizer, so speaking text is a no-op.
- **Depends on**: [`ITextToSpeechService`](#itexttospeechservice) and BCL `Task`.
- **Walkthrough**: the `sealed` class (`:4`) reports `IsSupported => false` (`:7`); `SpeakAsync(string text, ...)` (`:10`) and `StopAsync()` (`:13`) both return completed `Task`s. The paired speak/stop shape means a caller can always cancel safely even when nothing is speaking. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) notes components hide the read-aloud affordance when unsupported; native heads provide a platform synthesizer.
- **Where it's used**: injected by read-aloud / accessibility narration controls.

### UnavailableExternalAuthBroker
> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common.UI/Services/Capabilities/Fallbacks/UnavailableExternalAuthBroker.cs:7` · Level 1 · class

- **What it is**: the default [`IExternalAuthBroker`](#iexternalauthbroker): there is no native OAuth broker, so external sign-in falls through to the web flow.
- **Depends on**: [`IExternalAuthBroker`](#iexternalauthbroker) and BCL `Task<bool>`.
- **Walkthrough**: the `sealed` class (`:7`) reports `IsAvailable => false` (`:10`) and `SignInAsync(string provider, ...)` returning `Task.FromResult(false)` (`:13`). Because `IsAvailable` is `false`, the shared Login page never invokes the broker. See the fallback tier under [`AlwaysOnlineConnectivityStatusService`](#alwaysonlineconnectivitystatusservice).
- **Why it's built this way**: the class comment (`:3`) explains this keeps the shared Login page on its anchor-href OAuth flow, the correct behavior for web heads. On MAUI the `MauiExternalAuthBroker` overrides it to drive `WebAuthenticator` and capture the single-use completion code over the allow-listed custom scheme ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)). This is [Rubric §11, Security]: the native-vs-web sign-in path is chosen behind one interface, and the fallback picks the browser-safe OAuth redirect by default.
- **Where it's used**: injected by the shared Identity Login page's external-provider buttons.

### NullGeocodingService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Capabilities.Fallbacks` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Fallbacks/NullGeocodingService.cs:4` · Level 2 · class

- **What it is** - the inert default for [`IGeocodingService`](#igeocodingservice): a geocoder that geocodes nothing. It reports itself unsupported and hands back `null` for every address, which is exactly the "no coordinate hint available" state the contract is designed around.
- **Depends on** - implements [`IGeocodingService`](#igeocodingservice); returns [`GeoPoint`](#geopoint)`?`. No other first-party or external dependency beyond `System.Threading.Tasks` (`Task.FromResult`).
- **Concept introduced - the null-object capability fallback.** This is the first of five inert "Null…" defaults in this unit, so teach the shape once here. Every device capability in this group is an interface (biometrics, geolocation, media picking, push, and so on), and shared Blazor components resolve those interfaces directly. But a plain web head has no native geocoder, and a prerendering circuit has no JavaScript yet, so *something* must be in the container or resolution throws. The framework fills the container with a Null-Object implementation for every contract (the [Null Object pattern](../00-primer.md#3-conventions-and-idioms): a real, substitutable instance whose methods do nothing observable rather than a `null` reference). The two moving parts here are the `IsSupported` flag (a component reads it and hides the affordance) and the operation itself (a component that ignores `IsSupported` and calls anyway still gets a safe, `null` answer, never an exception). `AddDeviceCapabilityDefaults` `TryAdd`-registers this class as a singleton (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:33`), and a native or richer head later overrides it with a plain `Add`, so last-registration-wins swaps the real implementation in without the shared component knowing.
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

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common.UI.Web/Services/WebFormFactor.cs:12` · Level 1 · class

- **What it is**: The Blazor Server side implementation of [`IFormFactor`](#iformfactor), the tiny contract that lets shared UI adapt to the host it is running on. It reports the form factor as the literal string `"Web"` because this code executes on the server during SSR prerender and interactive Server render mode.
- **Depends on**: First-party: the [`IFormFactor`](#iformfactor) contract it implements (`MMCA.Common.UI.Web/Services/WebFormFactor.cs:12`). Externals: `System.Environment` (BCL) for the OS description. No app-specific state, which is why it was hoisted out of the individual Blazor Web hosts into the shared package.
- **Concept introduced**: **Host-selected capability implementation.** `IFormFactor` is the smallest example of the pattern this whole group is built around: one interface, and a different concrete class registered per host at DI composition time. The three siblings are this class ([`WebFormFactor`](#webformfactor) for Blazor Server), [`WasmFormFactor`](#wasmformfactor) in MMCA.Common.UI for WebAssembly, and [`MauiFormFactor`](#mauiformfactor) in MMCA.Common.UI.Maui for the native head. Shared components depend only on the interface; the host picks the body. [Rubric §18, UI Architecture] assesses how cleanly presentation concerns are layered and how portable components are across render hosts; a one-method contract with three swappable bodies keeps every consuming component host-agnostic. [Rubric §22, Responsive/Cross-Browser] assesses how the app adapts to device and environment; `GetFormFactor()` is the coarse signal components branch on when server-rendered behavior must differ from WASM or native.
- **Walkthrough**: The class is `sealed` (`WebFormFactor.cs:12`) and holds no fields. `GetFormFactor()` returns the constant `"Web"` (`WebFormFactor.cs:15`); it is a constant rather than a probe because Blazor Server always runs this code server-side. `GetPlatform()` returns `Environment.OSVersion.ToString()` (`WebFormFactor.cs:18`), the server OS description, which for a server render is the deployment host rather than the end user's device.
- **Why it's built this way**: Server prerender and interactive Server render both run on the server, so there is no reliable client device signal available at this layer; reporting `"Web"` and the server OS is the honest answer for this host. Keeping the type stateless and app-neutral is what allowed it to move up into the shared `MMCA.Common.UI.Web` package (its XML doc notes it is registered via `AddCommonWebFormFactor()`, `WebFormFactor.cs:9-10`).
- **Where it's used**: Registered by the Blazor Web hosts through `AddCommonWebFormFactor()`; resolved by any shared component that injects [`IFormFactor`](#iformfactor) to branch on the current host.
- **Caveats / not-in-source**: `GetPlatform()` reports the *server* OS, not the browser or client device; do not treat it as a client fingerprint. Not determinable from source: the exact registration body of `AddCommonWebFormFactor()` (it lives in the Web host's own DI file, outside this unit).

### DependencyInjection

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/DependencyInjection.cs:15` · Level 3 · class (static)

- **What it is**: The service-level registration surface for the MAUI native device-capability layer ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). It adds one `AddMauiDeviceCapabilities()` method that binds every capability contract the framework backs natively to its MAUI implementation, plus a separate `AddMauiFormFactor()` for the native [`IFormFactor`](#iformfactor).
- **Depends on**: First-party: the whole capability contract set in `MMCA.Common.UI.Services.Capabilities` and their `Maui*` implementations in `MMCA.Common.UI.Maui.Capabilities` (`DependencyInjection.cs:2-4`), [`MauiFormFactor`](#mauiformfactor) (`DependencyInjection.cs:69-70`). Externals: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (BCL/NuGet) as the extended type.
- **Concept introduced**: **`extension(IServiceCollection)` registration blocks.** The class is a `static class` whose members live inside an `extension(IServiceCollection services)` block (`DependencyInjection.cs:17`), the C# preview extension-member syntax this codebase uses everywhere for DI. The methods appear as instance methods on `IServiceCollection` at call sites (`builder.Services.AddMauiDeviceCapabilities()`). Two registration lifetimes appear here and the code explains both in comments: **singletons** for the capability services because a MAUI head is single-user and the stateful ones (connectivity, battery) wrap app-global platform events (`DependencyInjection.cs:27-28`), and one **scoped** registration for [`IExternalAuthBroker`](#iexternalauthbroker) because it navigates through the circuit's `NavigationManager` (`DependencyInjection.cs:56-59`). [Rubric §10, Cross-Cutting] assesses how infrastructure concerns are composed rather than scattered; centralizing every native binding in one extension method keeps the host program short. [Rubric §7, Microservices Readiness] assesses how cleanly a host swaps implementations; last-registration-wins over the shared TryAdd defaults is exactly that boundary.
- **Walkthrough**: `AddMauiDeviceCapabilities()` (`DependencyInjection.cs:25`) registers sixteen capability contracts as singletons in a block (`DependencyInjection.cs:29-45`): connectivity, battery, share, clipboard, haptics, map navigation, geolocation, geocoding, external links, text-to-speech, accessibility announcer, local notifications, screenshot, device preferences, local cache, biometrics, and speech-to-text. Three further registrations are commented because they carry conditions: [`IPushRegistrationService`](#ipushregistrationservice) is wired but stays inert until a credentialed `IPushDeviceTokenProvider` exists ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html), `DependencyInjection.cs:47-50`); `IMediaPickerService` needs the head to declare camera permissions for capture ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), `DependencyInjection.cs:52-54`); and [`IExternalAuthBroker`](#iexternalauthbroker) is registered `AddScoped` and stays inert (`IsAvailable == false`) until the head configures `OAuth:MobileRedirectScheme` and the platform callback (`DependencyInjection.cs:56-59`). `AddMauiFormFactor()` (`DependencyInjection.cs:69-70`) is deliberately separate so a head that registers its own [`IFormFactor`](#iformfactor) keeps last-registration-wins control.
- **Why it's built this way**: The class doc is explicit that plain `Add` (not `TryAdd`) is used and must run *after* `AddUIShared` so these native bodies override the shared TryAdd null-object defaults (last registration wins, `DependencyInjection.cs:11-13`). Splitting form-factor registration from capability registration (`DependencyInjection.cs:63-68`) preserves that override control per concern. Contracts with no native body yet (biometrics broker gaps, speech, external-auth) simply keep their shared null defaults until their feature wave lands (`DependencyInjection.cs:20-24`), so the DI graph always resolves.
- **Where it's used**: Called by [`HostingDependencyInjection`](#hostingdependencyinjection)'s `UseMauiDeviceCapabilities()` (`HostingDependencyInjection.cs:28`), the builder-level entry point heads actually call; the class doc names `builder.UseMauiDeviceCapabilities()` as the preferred path (`DependencyInjection.cs:9-11`).
- **Caveats / not-in-source**: "Wired but inert" is a real runtime state for push, media capture, and external auth: registration does not imply the capability works without the additional host config each comment names. Not determinable from source: the bodies of the individual `Maui*Service` implementations (they live in other units of this group).

### DeviceCapabilitiesInitializer

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:15` · Level 3 · class

- **What it is**: A MAUI startup hook that bridges local-notification taps into Blazor routing. It implements `IMauiInitializeService`, so its `Initialize` runs when the app is built, and it forwards the route carried by a tapped reminder to the shared [`IDeepLinkDispatcher`](#ideeplinkdispatcher).
- **Depends on**: First-party: [`IDeepLinkDispatcher`](#ideeplinkdispatcher) (`DeviceCapabilitiesInitializer.cs:2`). Externals: `Microsoft.Maui.Hosting.IMauiInitializeService` (MAUI), and `Plugin.LocalNotification` with its `NotificationActionEventArgs` (NuGet, `DeviceCapabilitiesInitializer.cs:3-4`).
- **Concept introduced**: **Cold-start deep-link buffering.** This type is the native publisher end of the deep-link funnel; the receiver end is the `DeepLinkListener` component in the shared layout. When a notification is tapped while the app is running, the route is delivered live via [`IDeepLinkDispatcher`](#ideeplinkdispatcher)'s `RouteRequested` event; when the tap cold-starts the app, the dispatcher buffers the single pending route until first render, and the listener drains it (`DeviceCapabilitiesInitializer.cs:10-13`). [Rubric §25, Navigation & IA] assesses how navigation intent flows through the app; routing every native entry point (taps, app links) through one dispatcher keeps Blazor routing the single source of truth. [Rubric §29, Resilience & Business Continuity] assesses graceful handling of edge states; the cold-start buffer means a tap that launches the process is not silently lost before the router exists.
- **Walkthrough**: The class is `sealed` (`DeviceCapabilitiesInitializer.cs:15`). `Initialize(IServiceProvider services)` null-guards its argument (`DeviceCapabilitiesInitializer.cs:20`), then resolves [`IDeepLinkDispatcher`](#ideeplinkdispatcher) with `GetService` and returns early if none is registered (`DeviceCapabilitiesInitializer.cs:22-26`), so a head without the dispatcher is a no-op rather than a crash. When present, it subscribes to `LocalNotificationCenter.Current.NotificationActionTapped` (`DeviceCapabilitiesInitializer.cs:28`). The private handler `OnNotificationTapped` (`DeviceCapabilitiesInitializer.cs:31`) ignores dismissals (`IsDismissed`, `DeviceCapabilitiesInitializer.cs:33-36`), reads the app-relative route from `args.Request?.ReturningData` (`DeviceCapabilitiesInitializer.cs:38`), and only publishes when the route is non-blank (`DeviceCapabilitiesInitializer.cs:39-42`).
- **Why it's built this way**: Notification metadata is not routing; this initializer translates the plugin's tap event into the codebase's own [`IDeepLinkDispatcher`](#ideeplinkdispatcher) vocabulary so the shared listener never touches `Plugin.LocalNotification`. Wiring it as an `IMauiInitializeService` means the subscription is established once at app build time. The defensive early-return keeps the hook safe to register unconditionally.
- **Where it's used**: Registered by [`HostingDependencyInjection`](#hostingdependencyinjection) as an `IMauiInitializeService` singleton (`HostingDependencyInjection.cs:29`); its published routes are consumed by the shared `DeepLinkListener` component through [`IDeepLinkDispatcher`](#ideeplinkdispatcher).
- **Caveats / not-in-source**: The route contract is entirely `ReturningData` on the scheduled notification: a reminder created without an app-relative route in that field produces no navigation. Not determinable from source: the `DeepLinkListener` component body and the code that schedules notifications with `ReturningData` set (both outside this unit).

### HostingDependencyInjection

> MMCA.Common.UI.Maui · `MMCA.Common.UI.Maui` · `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:10` · Level 4 · class (static)

- **What it is**: The `MauiAppBuilder`-level entry point for the entire device-capability layer ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Its one method `UseMauiDeviceCapabilities()` composes the service registrations plus the platform hooks that need the builder itself, so a head configures native capabilities with a single fluent call.
- **Depends on**: First-party: [`DependencyInjection`](#dependencyinjection)'s `AddMauiDeviceCapabilities()` (`HostingDependencyInjection.cs:28`) and [`DeviceCapabilitiesInitializer`](#devicecapabilitiesinitializer) (`HostingDependencyInjection.cs:29`). Externals: `Microsoft.Maui.Hosting.MauiAppBuilder` (MAUI) as the extended type, and `Plugin.LocalNotification`'s `UseLocalNotification()` (NuGet, `HostingDependencyInjection.cs:2,27`).
- **Concept introduced**: **Builder-level vs service-level composition.** This is the layered pairing that runs through MAUI hosting: [`DependencyInjection`](#dependencyinjection) registers services on `IServiceCollection`, while this class operates on `MauiAppBuilder` because two of the steps (the Plugin.LocalNotification lifecycle wiring and the initializer registration) need more than the service collection. It uses the same `extension(MauiAppBuilder builder)` block syntax (`HostingDependencyInjection.cs:12`). [Rubric §16, Maintainability] assesses how easy the framework is to adopt correctly; folding three easy-to-forget steps into one fluent call reduces the ways a head can be misconfigured. [Rubric §17, DevOps] assesses reproducible, low-ceremony host setup; a single builder extension is that ceremony reduction for the native head.
- **Walkthrough**: `UseMauiDeviceCapabilities()` (`HostingDependencyInjection.cs:25`) does three things in order: `builder.UseLocalNotification()` to initialize the notification plugin (`HostingDependencyInjection.cs:27`), `builder.Services.AddMauiDeviceCapabilities()` to bind every native capability (`HostingDependencyInjection.cs:28`), and `AddSingleton<IMauiInitializeService, DeviceCapabilitiesInitializer>()` to register the notification-tap deep-link bridge (`HostingDependencyInjection.cs:29`). It returns `builder` for chaining (`HostingDependencyInjection.cs:30`).
- **Why it's built this way**: The class doc pins the ordering constraint: call this AFTER `AddUIShared` in `MauiProgram.CreateMauiApp` (`HostingDependencyInjection.cs:8-9`), because [`DependencyInjection`](#dependencyinjection) uses plain `Add` to override the shared TryAdd defaults. One step it deliberately cannot do for the head is the MauiCommunityToolkit registration: speech-to-text depends on `.UseMauiCommunityToolkit()`, and the toolkit's MCT001 analyzer requires that call to appear directly in the app's own `UseMauiApp<T>()` chain, so the wrapper documents the requirement rather than hiding it (`HostingDependencyInjection.cs:18-23`).
- **Where it's used**: Called once per MAUI head in `MauiProgram.CreateMauiApp`; it is the public front door the class docs steer heads toward instead of calling [`DependencyInjection`](#dependencyinjection) directly (`DependencyInjection.cs:9-11`).
- **Caveats / not-in-source**: The head still has two obligations this wrapper cannot fulfill: chaining `.UseMauiCommunityToolkit()` for speech-to-text, and providing the per-capability config each inert service needs (push credentials, camera permissions, OAuth redirect scheme). Not determinable from source: the concrete `MauiProgram` of any downstream head that calls this method (outside this unit).


---
[⬅ ADC Application Host, UI Shell & Cross-Module Composition](group-25-adc-host-composition.md)  •  [Index](00-index.md)  •  [Testing & Quality Infrastructure ➡](group-27-testing-infrastructure.md)
