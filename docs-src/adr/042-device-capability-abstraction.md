# ADR-042: Device Capability Abstraction (MAUI Blazor Hybrid)

## Status
Accepted (2026-07-10, amended 2026-07-17, 2026-07-23, 2026-08-14, 2026-08-29 and 2026-09-03). The
2026-08-29 amendment adds the `UseMmcaMauiErrorHandling` last-chance handlers and records the hybrid
head's missing ASP.NET Core pipeline as a known constraint. The 2026-09-03 amendment records the push
device-token provider as a second native override that sits outside `AddMauiDeviceCapabilities`.

## Context
The consumer apps ship the same Blazor component set through three heads: MAUI Blazor Hybrid
(Android/iOS/MacCatalyst/Windows), Blazor Server SSR, and WebAssembly. Native device capabilities
(share sheet, clipboard, haptics, geolocation, local notifications, connectivity, biometrics,
text-to-speech) only exist on the MAUI head, and some have partial browser equivalents
(`navigator.share`, `navigator.clipboard`, `navigator.onLine`, aria-live regions). Shared Razor
components cannot reference MAUI APIs: `MMCA.Common.UI` is a single-target net10.0 Razor class
library that must stay WASM-compatible (its layer rule allows Shared only), and any MAUI-typed code
in it would break the web heads at compile time.

Two constraints shape the packaging. First, per-head service selection already has a working
precedent: `ITokenStorageService` resolves to a per-head implementation registered after
`AddUIShared` (`builder.Services.AddCommonMauiTokenStorage()`,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:163`). Second, MMCA.Common's CI and release
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
  `IConnectivityStatusService`, `ILocalCacheStore`). Five more have joined since, for 23 today, all
  TryAdd-registered by `AddDeviceCapabilityDefaults`
  (`Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:37-81`): the
  additions are `IGeocodingService` (Wave 3), `IMediaPickerService` (ADR-045), the push pair
  `IPushRegistrationService` and `IPushDeviceTokenProvider` (ADR-044), and `IBarcodeScannerService`
  for camera barcode/QR scanning (`Capabilities/DependencyInjection.cs:70`). `AddMauiDeviceCapabilities`
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:42-78`) natively overrides 20 of
  the 23. Three stay outside it. `IDeepLinkDispatcher` needs no override because the shared default
  IS the real implementation. The other two are deliberately opt-in per head:
  `IPushDeviceTokenProvider` comes from the platform-conditional `AddMauiPushDeviceTokenProvider`
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:118-126`, FCM on Android, APNs on
  iOS/MacCatalyst, nothing on windows, and both providers stay configuration-gated), while
  `AddMauiDeviceCapabilities` registers only the `IPushRegistrationService` half of the push pair
  (`:67`); and `IBarcodeScannerService` ships behind the opt-in `UseCommonBarcodeScanner`
  (`Source/Presentation/MMCA.Common.UI.Maui/HostingDependencyInjection.cs:104`, called by ADC at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:153`), so a head that never scans ships
  neither the ZXing handler nor a camera permission declaration. Each capability has an independent
  fallback story, and per-capability contracts let heads adopt incrementally.

- **Safe defaults for every contract, TryAdd-registered by `AddUIShared`.**
  `AddDeviceCapabilityDefaults` (`Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs`)
  registers a null or neutral implementation per contract (`Fallbacks/`), so shared components
  resolve every capability on every head with zero host changes. Three fallback flavors:
  browser-equivalent (JS interop), null-object exposing `IsSupported == false` (components hide the
  affordance), and constant stubs (Blazor Server connectivity is always online: a dead circuit
  already means the whole UI is down).

- **Heads override AFTER `AddUIShared` with plain Add registrations.** Last registration wins for
  single-service resolution, so `AddBrowserDeviceCapabilities()` (browser implementations over
  `wwwroot/capabilities-interop.js`, prerender-safe per the `MauiBackNavigationBridge` degradation
  contract) and `AddMauiDeviceCapabilities()` / `UseMauiDeviceCapabilities()` (the MAUI package)
  replace the defaults without touching them.

- **`MMCA.Common.UI.Maui` is the one MAUI-TFM package.** It multi-targets
  net10.0-android/ios/maccatalyst/windows, references `MMCA.Common.UI` plus `Microsoft.Maui.Controls`
  and `Plugin.LocalNotification` (majors track MAUI majors, pinned together in
  `Directory.Packages.props`), and stays OUT of `MMCA.Common.slnx`, the same mechanism that keeps
  the UI gallery and E2E projects out of the ubuntu unit run. Dedicated windows jobs build
  (`ci.yml` `build-maui`, a required gate) and pack (`release.yml` `publish-maui`, same tag, own
  SBOM gate) it, so the lockstep release stays whole. Layer rule: UI + Shared only
  (`Source/Build/MMCA.Common.LayerEnforcement.targets`, `EnforceUIMauiLayerBoundary`); it is
  deliberately absent from the ubuntu NetArchTest runtime map because its assemblies cannot load
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
  release. Accepted; the `publish-maui` job is gated by the same tag and SBOM discipline.
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
  (`Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:61`, `:62`, and the broker scoped
  at `:76`). The residual trade-off is configuration, not code: `MauiExternalAuthBroker` registers
  unconditionally but reports `IsAvailable == false`
  (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:39`)
  until the head supplies `OAuth:MobileRedirectScheme`, so a misconfigured head quietly keeps the web
  anchor flow rather than failing fast.
