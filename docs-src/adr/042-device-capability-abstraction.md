# ADR-042: Device Capability Abstraction (MAUI Blazor Hybrid)

## Status
Accepted (2026-07-10, amended 2026-07-17, 2026-07-23, 2026-08-14, 2026-08-29 and 2026-09-03). The
2026-08-29 amendment adds the `UseMmcaMauiErrorHandling` last-chance handlers and records the hybrid
head's missing ASP.NET Core pipeline as a known constraint. The 2026-09-03 amendment records the push
device-token provider as a second native override that sits outside `AddMauiDeviceCapabilities`.
Revised 2026-09-11: `IAppLifecycleNotifier` joins the shared contract set (24 contracts today), and it
is the fourth capability outside `AddMauiDeviceCapabilities`, fed from the native window through a
window-lifecycle extension.
Revised 2026-10-01: null fallbacks sit beside their contracts in concern sub-folders, not a
`Fallbacks/` folder.
Revised 2026-10-06: the concern sub-folder list gains `Navigation/` (nine, not eight), and the
lifecycle no-op is cited at the extension rather than the ADC call site.
Revised 2026-10-19: the ADC `MauiProgram.cs` anchors are re-pointed (`:161` and `:171`); no decision changed.
Revised 2026-11-23: the default set is 26 contracts (`IPasskeyCapability` and `IDeviceMetadataReporter`
join), the MAUI package overrides 21 and five stay outside it, both UI packages build on net10.0 and
net11.0 (ADR-141), and the MAUI release splits into a windows `pack-maui` job and an ubuntu
`publish-maui` push behind the `release` environment.
Revised 2026-11-24: the runtime architecture map no longer runs on NetArchTest (MMCA.Common 1.318.0,
[ADR-015](015-architecture-fitness-functions.md) Amendment (2026-11-24)); the layer-rule bullet is
reworded in place.

## Context
The consumer apps ship the same Blazor component set through three heads: MAUI Blazor Hybrid
(Android/iOS/MacCatalyst/Windows), Blazor Server SSR, and WebAssembly. Native device capabilities
(share sheet, clipboard, haptics, geolocation, local notifications, connectivity, biometrics,
text-to-speech) only exist on the MAUI head, and some have partial browser equivalents
(`navigator.share`, `navigator.clipboard`, `navigator.onLine`, aria-live regions). Shared Razor
components cannot reference MAUI APIs: `MMCA.Common.UI` is a Razor class library (built for
net10.0 and net11.0, `MMCA.Common/Directory.Build.props:7`) that must stay WASM-compatible (its
layer rule allows Shared only), and any MAUI-typed code in it would break the web heads at compile time.

Two constraints shape the packaging. First, per-head service selection already has a working
precedent: `ITokenStorageService` resolves to a per-head implementation registered after
`AddUIShared` (`builder.Services.AddCommonMauiTokenStorage()`,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:182`). Second, MMCA.Common's CI and release
pipelines run on ubuntu-latest, which cannot build MAUI target frameworks at all, while the
framework's packages release in lockstep (ADR-016).

## Decision
Add a per-capability contract layer to `MMCA.Common.UI` and a dedicated package,
`MMCA.Common.UI.Maui`, carrying the native implementations.

- **One small interface per capability, no aggregate device service.** Contracts live in
  `Source/Presentation/MMCA.Common.UI/Services/Capabilities/` (18 at introduction:
  `IShareService`, `IClipboardService`, `IHapticFeedbackService`, `IMapNavigationService`,
  `IGeolocationService`, `IExternalLinkService`, `ITextToSpeechService`, `IAccessibilityAnnouncer`,
  `ILocalNotificationService`, `IScreenshotService`, `IDevicePreferences`, `IBatteryStatusService`,
  `IBiometricAuthenticator`, `ISpeechToTextService`, `IExternalAuthBroker`, `IDeepLinkDispatcher`,
  `IConnectivityStatusService`, `ILocalCacheStore`). Eight more have joined since, for 26 today, all
  TryAdd-registered by `AddDeviceCapabilityDefaults`
  (`Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:38-94`): the
  additions are `IGeocodingService` (Wave 3), `IMediaPickerService` (ADR-045), the push pair
  `IPushRegistrationService` and `IPushDeviceTokenProvider` (ADR-044), `IPasskeyCapability` for
  WebAuthn sign-in (ADR-139, `Capabilities/DependencyInjection.cs:60`), `IDeviceMetadataReporter`
  for per-session device metadata (`Capabilities/DependencyInjection.cs:71`; its contract is the one
  that lives outside `Services/Capabilities/`, at
  `Services/Auth/Devices/IDeviceMetadataReporter.cs`),
  `IBarcodeScannerService` for camera barcode/QR scanning (`Capabilities/DependencyInjection.cs:79`),
  and `IAppLifecycleNotifier` for the native window's background/foreground callbacks
  (`Capabilities/DependencyInjection.cs:91`). `AddMauiDeviceCapabilities`
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:45-96`) natively overrides 21 of
  the 26 (it also registers the non-capability `IInitialThemeModeSource` at `:69` and the
  capabilities JS module through `AddMauiCapabilitiesJsModule()` at `:94`). Five stay
  outside it. `IPasskeyCapability` has no MAUI implementation: it keeps the unavailable default on a
  MAUI head, so the passkey affordances stay hidden there, and only `AddBrowserDeviceCapabilities`
  overrides it (`Capabilities/DependencyInjection.cs:58-60`, `:119`). `IDeepLinkDispatcher` and
  `IAppLifecycleNotifier` need no override
  because the shared default IS the real implementation: the MAUI package feeds the notifier from the
  native window instead of replacing it, through `AttachMmcaAppLifecycle`
  (`Source/Presentation/MMCA.Common.UI.Maui/WindowLifecycleExtensions.cs:33`), which forwards the
  window's `Stopped` and `Resumed` events and no-ops when the head registered no notifier
  (`WindowLifecycleExtensions.cs:38-42`; ADC calls it from `CreateWindow` at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:36`). The last two are deliberately opt-in per head:
  `IPushDeviceTokenProvider` comes from the platform-conditional `AddMauiPushDeviceTokenProvider`
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:136-144`, FCM on Android, APNs on
  iOS/MacCatalyst, nothing on windows, and both providers stay configuration-gated), while
  `AddMauiDeviceCapabilities` registers only the `IPushRegistrationService` half of the push pair
  (`:74`); and `IBarcodeScannerService` ships behind the opt-in `UseCommonBarcodeScanner`
  (`Source/Presentation/MMCA.Common.UI.Maui/HostingDependencyInjection.cs:104`, called by ADC at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:172`), so a head that never scans ships
  neither the ZXing handler nor a camera permission declaration. Each capability has an independent
  fallback story, and per-capability contracts let heads adopt incrementally.

- **Safe defaults for every contract, TryAdd-registered by `AddUIShared`.**
  `AddDeviceCapabilityDefaults` (`Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs`)
  registers a null or neutral implementation per contract, kept beside its contract in the concern
  sub-folder (for example `Services/Capabilities/Interop/NullShareService.cs`), so shared components
  resolve every capability on every head with zero host changes. Three fallback flavors:
  browser-equivalent (JS interop), null-object exposing `IsSupported == false` (components hide the
  affordance), and constant stubs (Blazor Server connectivity is always online: a dead circuit
  already means the whole UI is down).

- **Heads override AFTER `AddUIShared` with plain Add registrations.** Last registration wins for
  single-service resolution, so `AddBrowserDeviceCapabilities()` (browser implementations over
  `wwwroot/capabilities-interop.js`, prerender-safe per the `MauiBackNavigationBridge` degradation
  contract) and `AddMauiDeviceCapabilities()` / `UseMauiDeviceCapabilities()` (the MAUI package)
  replace the defaults without touching them.

- **`MMCA.Common.UI.Maui` is the one MAUI-TFM package.** It multi-targets android, ios,
  maccatalyst and windows10.0.19041.0 once per .NET line, net10.0 and net11.0, for eight TFMs
  (`Source/Presentation/MMCA.Common.UI.Maui/MMCA.Common.UI.Maui.csproj:18`), references
  `MMCA.Common.UI` plus `Microsoft.Maui.Controls` (on the per-line `MmcaMauiVersion`,
  `Directory.Packages.props:50`, `:62`) and `Plugin.LocalNotification` (one fixed pin for both lines,
  `Directory.Packages.props:331`), and stays OUT of `MMCA.Common.slnx`, the same mechanism that keeps
  the UI gallery and E2E projects out of the ubuntu unit run. A dedicated windows job builds it
  (`ci.yml` `build-maui`, `.github/workflows/ci.yml:260`, a required gate) and another packs it
  with its own SBOM gate (`release.yml` `pack-maui`, `.github/workflows/release.yml:235`, same
  tag); the ubuntu `publish-maui` job (`release.yml:341`) only attests and pushes, with no restore,
  build or test (`release.yml:344`, attestation step `:364`), after both pack jobs and
  behind the `release` environment approval (`release.yml:342`, `:348`), so the lockstep release
  stays whole. Layer rule: UI + Shared only
  (`Source/Build/MMCA.Common.LayerEnforcement.targets`, `EnforceUIMauiLayerBoundary`); it is
  deliberately absent from the ubuntu runtime architecture map because its assemblies cannot load
  there, and the compile-time target is the enforcement.

- **Deep links funnel through one boundary.** Native navigation sources (notification taps, app
  actions, app links, QR scans) publish app-relative routes into the singleton
  `IDeepLinkDispatcher` (buffered, capacity one, for cold starts); the `DeepLinkListener`
  component in the shared layout drains the buffer after first render and navigates live requests.
  The payoff of Blazor Hybrid: web URLs and app routes are identical, so no translation table
  exists anywhere.

- **A head installs the process-wide last-chance error handlers with one call** (2026-08-29).
  `UseMmcaMauiErrorHandling(onUnhandled?)`
  (`Source/Presentation/MMCA.Common.UI.Maui/HostingDependencyInjection.cs:76`) registers
  `MauiErrorHandlingInitializer` as an `IMauiInitializeService`, which hooks
  `AppDomain.UnhandledException` and `TaskScheduler.UnobservedTaskException` and reports what they
  catch to the app's `ILogger` plus the optional crash-reporter callback. It is an initializer rather
  than a builder-time hook for the same reason `DeviceCapabilitiesInitializer` is one: the handlers
  need a logger, and the container that supplies it only exists once the app is built. The logger is
  resolved with `GetService`, so a head that configured no logging still gets the handlers and the
  callback; the two events are process-wide statics behind a static once-guard, so a head that calls
  the extension twice still reports each crash once.

- **Shared components adapt, never branch on platform.** `ExternalLink` renders a real new-tab
  anchor on web heads and intercepts the click into the system browser where
  `IExternalLinkService.InterceptsLinks` is true, because `target="_blank"` silently dead-ends
  inside a BlazorWebView. `OfflineBanner` renders only when `IConnectivityStatusService` reports
  offline. Permission flows live INSIDE each MAUI implementation (check, rationale, request,
  degrade, never throw); components never see permission state.

## Rationale
- A god `IDeviceCapabilities` interface would force every head to implement everything and turn
  each new capability into a breaking change; per-capability contracts are open/closed and mock
  cleanly in bUnit.
- Null defaults inside `AddUIShared` mean a head that knows nothing about capabilities keeps
  working, which is exactly the inert-by-default posture of ADR-024's notification layer.
- Putting implementations in a framework package (not each app's MAUI head) gives the Store and
  ADC heads the same capabilities for one registration line, and keeps the ADR-015 discipline:
  reusable infrastructure belongs to Common.
- The windows-job packaging exception is the smallest change that preserves both truths: ubuntu CI
  stays fast and MAUI TFMs get built at all.

## Trade-offs
- A second build runner raises release surface: ubuntu and windows must both succeed for a whole
  release. Accepted; the `pack-maui` job carries the same tag and SBOM discipline, and
  `publish-maui` waits on the same `release` environment as the main push.
- The TryAdd-default plus later-plain-Add pattern relies on registration order (`AddUIShared`
  first). Documented on both extension methods; the order is already load-bearing in every host for
  other reasons.
- Null-object fallbacks can mask a missing registration (a MAUI head that forgets
  `UseMauiDeviceCapabilities()` silently loses haptics rather than failing fast). Accepted for
  decoration-grade capabilities; feature waves that depend on a capability assert `IsSupported` in
  their UI and surface the gap visibly.
- **The hybrid head has no ASP.NET Core request pipeline** (recorded explicitly 2026-08-29). Inside a
  `BlazorWebView` there is no Kestrel, no middleware and no mapped endpoints, so anything the web
  heads get from the server side is simply absent: a request to a server route is resolved by the
  Blazor `Router` instead, matches no `@page`, and renders the shell's NotFound page. The culture
  endpoint is the worked example (`/culture/set`, mapped by `MapCultureEndpoint()` on the web heads;
  `Source/Presentation/MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:10` and
  `MauiCultureStore.cs:8` document the consequence), which is why culture switching resolves through
  the per-head `ICultureApplier` rather than a redirect. The same constraint is why unhandled-exception
  reporting arrives as `UseMmcaMauiErrorHandling` above and not as middleware. Accepted, not a defect:
  the head's whole value is that it renders the same components with no web server, and adding a local
  pipeline for endpoint parity would reintroduce exactly the dependency it exists to avoid. The
  practical rule for adopters is that any capability a web head implements as an endpoint needs a
  per-head service contract here before a hybrid head can use it.
- Biometrics, speech-to-text, and the external-auth broker now ship native MAUI implementations,
  all three registered by `AddMauiDeviceCapabilities()`
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:64`, `:65`, and the broker scoped
  at `:89`). The residual trade-off is configuration, not code: `MauiExternalAuthBroker` registers
  unconditionally but reports `IsAvailable == false`
  (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:54`)
  until the head supplies `OAuth:MobileRedirectScheme`, so a misconfigured head quietly keeps the web
  anchor flow rather than failing fast.

## Revision (2026-10-01)
No decision or rationale changed. The Decision bullet on safe defaults no longer points at a
`Fallbacks/` folder, which does not exist: each null fallback sits beside its contract in a concern
sub-folder of `Source/Presentation/MMCA.Common.UI/Services/Capabilities/` (Accessibility, Auth,
DeviceStatus, DeviceStorage, Geo, Interop, Media, Notifications), for example
`Source/Presentation/MMCA.Common.UI/Services/Capabilities/Interop/NullShareService.cs`.

## Revision (2026-10-06)
No decision or rationale changed.
- The 2026-10-01 list of concern sub-folders under
  `Source/Presentation/MMCA.Common.UI/Services/Capabilities/` missed one: there are nine, the ninth
  being `Navigation/`, which holds `IDeepLinkDispatcher.cs`, its shared default
  `DeepLinkDispatcher.cs` and `DeepLinkRouteEventArgs.cs`.
- The Decision bullet now cites the lifecycle no-op where it lives
  (`Source/Presentation/MMCA.Common.UI.Maui/WindowLifecycleExtensions.cs:38-42`) and the ADC call
  separately (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/App.xaml.cs:65`, inside `CreateWindow`).
- Line anchors in the live sections were re-verified against current source and moved where the
  code had shifted (`AddMauiDeviceCapabilities` 44-84, push provider 124-132, push registration
  `:73`, biometrics/speech/broker `:63`/`:64`/`:82`, ADC `MauiProgram.cs` `:155`/`:165`).

## Revision (2026-10-19)
No decision or rationale changed. Comment growth above the registrations in ADC's head moved the two
`MauiProgram.cs` anchors: `UseCommonBarcodeScanner` is now called at
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:161` (was `:155`) and
`AddCommonMauiTokenStorage` at `:171` (was `:165`), still after `AddUIShared`, so last-registration-wins
holds for both. The framework definition (`HostingDependencyInjection.cs:104`) is unchanged. The
2026-10-06 list above keeps its `:155`/`:165` as the values verified that day.

## Revision (2026-11-23)
Re-verified against current source. The decision is unchanged: one contract per capability, safe
TryAdd defaults in `AddUIShared`, per-head plain-Add overrides, and one MAUI-TFM package built and
packed on windows. What moved is the size of the contract set, the framework lines both UI packages
build for, and the shape of the MAUI release jobs.
1. The default set is 26 contracts, not 24. Two were missing from this ADR: `IPasskeyCapability`
   (ADR-139, `Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:60`,
   contract at `Services/Capabilities/Auth/IPasskeyCapability.cs`) and `IDeviceMetadataReporter`
   (`Capabilities/DependencyInjection.cs:71`, contract at `Services/Auth/Devices/IDeviceMetadataReporter.cs`,
   the one contract outside `Services/Capabilities/`). Eight have joined since introduction, not six.
2. `AddMauiDeviceCapabilities` overrides 21 of the 26
   (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:49-65`, `:74`, `:80`, `:84`,
   `:89`); the new override is `MauiDeviceMetadataReporter` at `:80`. Five defaults stay outside it,
   the fifth being `IPasskeyCapability`, which has no MAUI implementation and is overridden only by
   `AddBrowserDeviceCapabilities` (`Capabilities/DependencyInjection.cs:119`).
3. `MMCA.Common.UI` builds for net10.0 and net11.0 (`MMCA.Common/Directory.Build.props:7`,
   `build/Frameworks.props:23`; it is not in `MmcaSingleTargetProjects`, `build/Frameworks.props:27`),
   and `MMCA.Common.UI.Maui` builds each of its four platforms on both lines, eight TFMs
   (`Source/Presentation/MMCA.Common.UI.Maui/MMCA.Common.UI.Maui.csproj:18`), per ADR-141.
4. The two MAUI package pins differ in shape: `Microsoft.Maui.Controls` follows the per-line
   `MmcaMauiVersion` (`Directory.Packages.props:50`, `:62`), while `Plugin.LocalNotification` is one
   fixed `14.1.2` pin for both lines (`Directory.Packages.props:331`). The pin comment still says the
   plugin's majors track MAUI majors and calls 14.x the net10 line (`Directory.Packages.props:329-330`),
   so the net11.0 line currently builds on that plugin line. The Decision bullet now states the pins
   as source has them.
5. The MAUI release is two jobs. `pack-maui` (`.github/workflows/release.yml:235`, windows-latest)
   packs the package and runs its SBOM gate (`release.yml:315-329`); `publish-maui`
   (`release.yml:341`, ubuntu-latest) only attests and pushes, with no restore, build or test
   (`:344`, attestation step `:364`, `attestations: write` `:353`), needs both pack jobs (`:342`) and waits on the
   `release` environment (`:348`). The Decision bullet and the first trade-off are reworded to match.
   `build-maui` (`.github/workflows/ci.yml:260`, windows-latest) remains the required CI gate.
6. Anchors re-verified against current source: `AddDeviceCapabilityDefaults` 38-94 (barcode `:79`,
   lifecycle `:91`), `AddMauiDeviceCapabilities` 45-96 (push registration `:74`, biometrics `:64`,
   speech-to-text `:65`, broker `:89`), `AddMauiPushDeviceTokenProvider` 136-144,
   `MauiExternalAuthBroker.cs:54`, ADC `App.xaml.cs:36` (inside `CreateWindow`, `:18`), and ADC
   `MauiProgram.cs` `:172` (`UseCommonBarcodeScanner`) and `:182` (`AddCommonMauiTokenStorage`),
   both still after `AddUIShared` (`:104`). The 2026-10-06 and 2026-10-19 sections keep the values
   verified on their dates.
