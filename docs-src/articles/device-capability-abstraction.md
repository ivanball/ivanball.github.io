# One Blazor UI, two hosts: a device-capability layer that stays resolvable everywhere

> Series: MMCA.Common · Article #42 (deep-dive) · Pillar P2,P5 · Group G26 · Rubric §18 · ADR-042 (+043) ·
> Status: grounded in `Website/docs-src/adr/042-device-capability-abstraction.md`,
> `Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md`,
> `Website/docs-src/onboarding/group-26-device-capability-layer.md`, and the real contracts under
> `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/` plus the native package
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/`. No em dashes.

**Subtitle:** The same Blazor component set runs in a browser and inside a MAUI Blazor Hybrid app. But a share sheet, a fingerprint prompt, and a haptic tap only exist on the phone. Here is how one UI talks to native hardware through small per-capability contracts, and never has to ask "am I on mobile?"

---

Ship the same Blazor components through a browser and through a .NET MAUI Blazor Hybrid app and you hit a wall the first time a component wants to do something physical. Open the native share sheet. Copy to the clipboard. Buzz on a bookmark. Prompt for Face ID. Read a GPS fix. Speak a screen-reader announcement. None of those APIs exist in a browser, and half of them have a partial browser equivalent (`navigator.share`, `navigator.clipboard`, `navigator.onLine`) that behaves nothing like the native one.

The naive fix is a platform check. A component asks "am I running on MAUI?" and branches. That question metastasizes: it shows up in the share button, the offline banner, the avatar picker, the login page, and every one of them now has two code paths, one of which never runs in the environment you are testing in. The component library stops being portable the moment it knows what a phone is.

`MMCA.Common.UI` is a single-target `net10.0` Razor class library that has to compile into a Blazor WebAssembly bundle, so it *cannot* reference a MAUI type without breaking the web heads at compile time. That hard constraint is the whole reason the design is clean: the shared UI is structurally forbidden from knowing about the phone, so it has to talk to native hardware through an abstraction, and the implementation gets chosen somewhere the shared library never sees. This is ADR-042, the Device Capability Abstraction, and it is a whole shipped functional group (G26 in the onboarding guide, roughly a hundred types once you count contracts, native adapters, browser adapters, and fallbacks).

## The MMCA answer: one small contract per capability, chosen per host

There is no god `IDeviceCapabilities` interface. That was a deliberate rejection: an aggregate device service forces every head to implement everything, and every new capability becomes a breaking change to a type everyone depends on. Instead the framework defines one small interface per capability, all living under `Source/Presentation/MMCA.Common.UI/Services/Capabilities/` (`Website/docs-src/adr/042-device-capability-abstraction.md:33`), 24 capability contracts in all.

Each contract is a few methods, shaped so failure is a value, not an exception:

- `IShareService` (`IShareService.cs:8`): `ShareLinkAsync` / `ShareFileAsync`, both returning `Task<bool>` so a caller learns "no share UI was presented" and falls back to copy-link rather than catching.
- `IHapticFeedbackService` (`IHapticFeedbackService.cs:8`): `Click`, `LongPress`, `Vibrate`, plus an `IsSupported` flag; the doc comment is blunt that "haptics are decoration, never behavior," so failures are swallowed.
- `IBiometricAuthenticator` (`IBiometricAuthenticator.cs:9`): `IsAvailableAsync` and `AuthenticateAsync(reason)`, where cancellation, lockout, and error all return `false` so the caller falls back to the normal credential login, never to a weaker path.
- `IGeolocationService` (`IGeolocationService.cs:8`): `GetCurrentOrLastKnownAsync` returns a nullable `GeoPoint`, and denial or timeout yields `null` so a proximity hint is simply omitted.
- `ISpeechToTextService` (`ISpeechToTextService.cs:10`), `IConnectivityStatusService` (`IConnectivityStatusService.cs:10`), `IExternalLinkService` (`IExternalLinkService.cs:9`), `IMediaPickerService` (`IMediaPickerService.cs:9`), `IPushRegistrationService` (`IPushRegistrationService.cs:10`), and the rest follow the same rule: a boolean or a nullable that means "unavailable," never a throw a component has to guard.

That last point is the load-bearing design choice. Because unavailability is a return value, a component written against the contract already handles the browser case for free. It calls `ShareLinkAsync`, gets `false`, and shows the copy-link path. It never asks what platform it is on.

## Three flavors of "unavailable," all registered by default

Small contracts only help if every one of them always resolves. A component that injects `IShareService` must get *something* on every head, or the browser build throws at runtime the first time someone taps share. So `AddUIShared` (the shared UI registration every host already calls) TryAdd-registers a safe default for every contract, in `AddDeviceCapabilityDefaults` (`Services/Capabilities/DependencyInjection.cs:37`). The `TryAdd` matters: it seeds a default only if nothing else claimed the slot, which keeps repeated host calls idempotent and lets a later registration win.

There are three flavors of default for absent hardware, and picking the right one per capability is the subtle part:

1. **Null object.** `NullShareService` (`Interop/NullShareService.cs:4`) returns `Task.FromResult(false)` from both methods. `NullHapticFeedbackService` (`DeviceStatus/NullHapticFeedbackService.cs:4`) and `NullSpeechToTextService` (`Media/NullSpeechToTextService.cs:6`) do the same and report `IsSupported => false` so components hide the affordance entirely. Each null default signals unavailability the way its own contract does: `IBiometricAuthenticator` has no `IsSupported` flag at all, so `NullBiometricAuthenticator` (`Auth/NullBiometricAuthenticator.cs:4`) returns `false` from `IsAvailableAsync` instead.
2. **Constant stub.** `AlwaysOnlineConnectivityStatusService` (`DeviceStatus/AlwaysOnlineConnectivityStatusService.cs:7`) hard-codes `IsOnline => true` and never raises its event. That is not laziness: it is *correct* for Blazor Server, where a lost connection tears down the circuit itself, so the reconnect overlay already covers the offline case and a connectivity service would be redundant.
3. **Neutral local state.** `InMemoryDevicePreferences` (`DeviceStorage/InMemoryDevicePreferences.cs:10`) is registered scoped, not singleton, so the Blazor Server fallback holds per-circuit (per-user) state and never leaks one user's preferences into another's.

A fourth kind is not a fallback at all. For two contracts the shared default *is* the real implementation, so no head replaces it: `DeepLinkDispatcher` (registered at `Services/Capabilities/DependencyInjection.cs:78`) and `AppLifecycleNotifier` (at `:82`), which the MAUI package feeds from the native window rather than overriding. That is why `AddMauiDeviceCapabilities` natively overrides 20 of the 24 contracts rather than all of them (`Website/docs-src/adr/042-device-capability-abstraction.md:47-52`).

The payoff: a head that knows nothing about capabilities keeps working. It gets share-returns-false, haptics-do-nothing, always-online, and every component degrades gracefully with zero host changes. That is the same inert-by-default posture the framework's notification layer takes.

## Heads override after the defaults, last registration wins

A default that is always inert would be useless on the platforms that *can* do the real thing. So heads override, and the mechanism is deliberately boring: plain `Add` registrations, called *after* `AddUIShared`, exploiting the rule that the last registration wins for single-service resolution.

The browser heads (Blazor Server and WebAssembly) call `AddBrowserDeviceCapabilities` (`Services/Capabilities/DependencyInjection.cs:95`), which swaps in eight browser adapters over one shared JS module, `CapabilitiesJsModule`. `BrowserShareService` (`Interop/BrowserShareService.cs:8`) calls `navigator.share` and returns whether a share UI actually appeared; on desktop Firefox or an insecure context it reports `false`, and the copy-link fallback kicks in exactly as on the null default. Every browser adapter is prerender-safe: a JS-unavailable call degrades to the null behavior instead of throwing during the static SSR pass.

The MAUI head calls `UseMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:30`), which wires the native `Plugin.LocalNotification` lifecycle, registers the notification-tap bridge, and calls `AddMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/DependencyInjection.cs:42`) to replace the defaults with `MauiShareService`, `MauiClipboardService`, `MauiHapticFeedbackService`, `MauiGeolocationService`, and the rest. Permission flows live *inside* each MAUI adapter (check, show rationale, request, degrade, never throw); components never see permission state.

Here is the whole composition, illustrative of the documented shape:

```csharp
// Every host, browser or native, calls the shared UI registration first.
// It TryAdd-seeds a safe default for every capability contract.
builder.Services.AddUIShared(builder.Configuration);   // -> AddDeviceCapabilityDefaults() inside

// Blazor Server / WebAssembly host: override with browser adapters AFTER AddUIShared.
builder.Services.AddBrowserDeviceCapabilities();       // navigator.share, clipboard, aria-live, onLine

// MAUI Blazor Hybrid host (in MauiProgram): override with native adapters AFTER AddUIShared.
builder.UseMauiDeviceCapabilities();                   // native share sheet, haptics, geolocation, biometrics
```

Three hosts, one shared component set, and the only difference is which one line ran after `AddUIShared`. A component that injects `IShareService` gets `NullShareService` on a forgetful host, `BrowserShareService` on the web, and `MauiShareService` on the phone, and it wrote none of that branching.

## The ninth package, and why it lives outside the solution

The native adapters cannot ship in `MMCA.Common.UI`, because that package must stay WebAssembly-compatible. They ship in `MMCA.Common.UI.Maui`, the ninth of the framework's nineteen NuGet packages and its one MAUI-target exception. It multi-targets `net10.0-android/ios/maccatalyst/windows`, references `MMCA.Common.UI` plus `Microsoft.Maui.Controls` and `Plugin.LocalNotification`, and stays *out* of `MMCA.Common.slnx` (`Website/docs-src/adr/042-device-capability-abstraction.md:81`).

That exclusion is not cosmetic. MMCA.Common's CI and release pipelines run on ubuntu, which cannot build MAUI target frameworks at all, and the nineteen packages release in lockstep. So the MAUI package is built and packed by dedicated windows CI jobs (`build-maui`, a required gate, and `publish-maui`, under the same tag and SBOM discipline), the same mechanism that keeps the UI gallery and E2E projects out of the fast ubuntu unit run. Its layer rule is "UI plus Shared only," enforced at compile time; it is deliberately absent from the ubuntu runtime architecture map because its assemblies cannot even load there.

## Deep links: one funnel, no translation table

The most elegant part is navigation. A notification tap, a home-screen app action, an app link, a scanned QR code: all four are native events that need to land on a Blazor route. They funnel through one singleton, `IDeepLinkDispatcher` (`Services/Capabilities/Navigation/IDeepLinkDispatcher.cs:10`), whose default `DeepLinkDispatcher` (`Services/Capabilities/Navigation/DeepLinkDispatcher.cs:9`) either raises `RouteRequested` live when a listener is attached, or buffers the most recent route (capacity one, guarded by a `Lock`) so a cold-start tap survives until the router renders. The `DeepLinkListener.razor` component in the shared layout drains that buffer after first render and navigates.

Why capacity one, and why a buffer at all? Because a tap can *launch* the app: native code publishes the route into the singleton before Blazor has rendered anything, so there is no listener yet. The single-entry buffer holds that route until first render, then the listener consumes it. Live taps, once the app is running, skip the buffer entirely.

The payoff of Blazor Hybrid is that web URLs and app routes are *identical*. All heads share one Blazor route table, so an incoming deep link is reduced to its path and query and published as-is. No translation table exists anywhere. This is also where ADR-043 (mobile deep links and app association) plugs in: incoming app-link and OAuth-callback URIs reuse this exact dispatcher, and each app's `UI.Web` host serves the platform association files (`assetlinks.json`, `apple-app-site-association`) that tell the OS to open shared https URLs in the installed app. The OAuth-callback angle is its own story; here the point is only that ADR-043 adds native entry points and reuses this one funnel rather than building a second.

One more component earns its place: `ExternalLink.razor`. A raw `target="_blank"` anchor silently dead-ends inside a BlazorWebView (WKWebView drops it), so shared components route external links through `IExternalLinkService` (`Services/Capabilities/Interop/IExternalLinkService.cs:9`). It renders a real new-tab anchor on web heads, and where `InterceptsLinks` is `true` it intercepts the click into the system browser. `OfflineBanner.razor` renders only when `IConnectivityStatusService` reports offline. The components adapt; they never branch on platform.

## Trade-offs, honestly

- **Null-object defaults can mask a missing registration.** A MAUI head that forgets `UseMauiDeviceCapabilities` does not fail fast: it silently resolves the null defaults and loses haptics, share, and biometrics with no error. That is accepted for decoration-grade capabilities, but a feature that genuinely depends on a capability has to assert availability in its own UI and surface the gap (`IsSupported` where the contract exposes one, `IsAvailableAsync` for biometrics, the returned `false` for share), rather than trusting the registration happened.
- **The pattern relies on registration order.** The whole "last registration wins" mechanism only works if `AddUIShared` (and its `TryAdd` defaults) runs *before* the head's plain `Add` overrides. Both extension methods document the ordering, and the class doc comment above `AddMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/DependencyInjection.cs:28-30`) restates it, but it is an ordering contract a host can still get wrong.
- **A separate MAUI package raises release surface.** Two CI runners, ubuntu and windows, must both succeed for a whole release, because the MAUI package cannot build on ubuntu and the packages ship in lockstep. Accepted, and gated by the same tag and SBOM checks as the rest.
- **Some contracts ship ahead of their native depth.** The external-auth broker registers `MauiExternalAuthBroker` scoped but inert (`IsAvailable == false`) until the head configures its OAuth redirect scheme and platform callback (`MMCA.Common.UI.Maui/DependencyInjection.cs:73-76`); until then the shared login page stays on its anchor flow. Native push likewise stays wired-but-tokenless until real FCM/APNs credentials exist (`MMCA.Common.UI.Maui/DependencyInjection.cs:64-67`). Registered is not the same as fully live, and the article does not claim otherwise.

None of these argue for a platform check back in the components. They argue for asserting `IsSupported` where a feature truly needs the hardware, and for keeping the registration order honest.

## Apply this even without MMCA

The pattern ports to any UI that runs on more than one host:

1. Define **one small interface per capability**, not an aggregate device service. Each new capability is then additive, not a breaking change to a type everyone depends on.
2. Shape each contract so **unavailability is a return value** (a `bool` or a nullable), never an exception. A component written against it handles the missing-hardware case without a single guard.
3. **Register a safe default for every contract** at the composition root, with a conditional-add so it only seeds when nothing else claimed the slot. Then a host that knows nothing about capabilities still resolves everything and degrades gracefully.
4. Let **hosts override after the defaults**, relying on last-registration-wins, so the per-host adapter is one line and the shared code never sees it.
5. Keep the **platform-specific package physically separate** if its target frameworks cannot build where the rest of your CI runs, and gate it on its own runner under the same release tag.

The takeaway: **a portable UI is one that is structurally forbidden from knowing where it runs. Put each device capability behind a small contract, give every contract an inert default so it always resolves, and choose the real implementation per host at the composition root. The component asks for a capability; it never asks for a platform.**

---

**What we covered:** why a platform check inside a shared component set is a portability leak, how ADR-042 replaces it with one small contract per capability under `MMCA.Common.UI/Services/Capabilities/`, how `AddDeviceCapabilityDefaults` TryAdd-seeds a null-object, constant-stub, or neutral-state default for every contract so it always resolves, how browser and MAUI heads override those defaults after `AddUIShared` with last-registration-wins, why the native adapters live in the ninth package `MMCA.Common.UI.Maui` built by a windows CI job, and how `IDeepLinkDispatcher` funnels every native navigation source onto the one shared Blazor route table.

**Previously in the series:** Two real apps on one framework, a conference platform and a store, both running on MMCA.Common without a fork.

**Next in the series:** managed file storage, uploads you don't have to trust, with untrusted-image re-encoding and a storage abstraction that swaps an Azure Blob backend for a safe Null fallback.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the device-capability chapter of the onboarding guide, or `dotnet add package MMCA.Common.UI.Maui` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, Blazor, MAUI, C Sharp, Software Architecture*

*Notes: verified contract names + path:line under `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/`: `IShareService` (`IShareService.cs:8`, `ShareLinkAsync`/`ShareFileAsync` -> `Task<bool>`), `IHapticFeedbackService` (`IHapticFeedbackService.cs:8`, `Click`/`LongPress`/`Vibrate`/`IsSupported`), `IBiometricAuthenticator` (`IBiometricAuthenticator.cs:9-19`, `IsAvailableAsync`/`AuthenticateAsync` only, no `IsSupported` member), `IGeolocationService` (`IGeolocationService.cs:8`, `GetCurrentOrLastKnownAsync` -> `GeoPoint?`), `ISpeechToTextService` (`ISpeechToTextService.cs:10`, `ListenAsync`/`IsSupported`), `IConnectivityStatusService` (`IConnectivityStatusService.cs:10`, `IsOnline`/`ConnectivityChanged`/`InitializeAsync`), `IExternalLinkService` (`Interop/IExternalLinkService.cs:9`, `InterceptsLinks`/`OpenAsync`), `IMediaPickerService` (`IMediaPickerService.cs:9`, `PickPhotoAsync`/`CapturePhotoAsync`, `PickedMedia` class at `:29`), `IPushRegistrationService` (`IPushRegistrationService.cs:10`, `IsSupported`/`RegisterAsync`/`UnregisterAsync`), `IDeepLinkDispatcher` (`Navigation/IDeepLinkDispatcher.cs:10`, `Publish`/`TryConsumePending`/`RouteRequested`). Defaults: `AddDeviceCapabilityDefaults` at `Services/Capabilities/DependencyInjection.cs:37` (24 TryAdd registrations, one per contract: 17 singletons at `:40-56`, the push pair at `:61-62`, the media picker at `:65`, the barcode scanner at `:70`, scoped device preferences at `:74`, the deep-link dispatcher at `:78`, the app-lifecycle notifier at `:82`; ADR-042 lists the 18 at introduction at `:34` and "Six more have joined since, for 24 today" at `:39`), `NullShareService` (`Interop/NullShareService.cs:4`, returns false), `NullHapticFeedbackService` (`DeviceStatus/NullHapticFeedbackService.cs:4`, `IsSupported => false`), `NullSpeechToTextService` (`Media/NullSpeechToTextService.cs:6`, `IsSupported => false`), `NullBiometricAuthenticator` (`Auth/NullBiometricAuthenticator.cs:4`, `IsAvailableAsync` -> false, which is how that contract reports unavailability), `AlwaysOnlineConnectivityStatusService` (`DeviceStatus/AlwaysOnlineConnectivityStatusService.cs:7`, `IsOnline => true`), `InMemoryDevicePreferences` scoped (`DeviceStorage/InMemoryDevicePreferences.cs:10`). The two contracts whose shared default IS the real implementation (`IDeepLinkDispatcher` at `:78`, `IAppLifecycleNotifier` at `:82`) and the 20-of-24 native override count come from `Website/docs-src/adr/042-device-capability-abstraction.md:47-52`. Browser overrides: `AddBrowserDeviceCapabilities` (`Services/Capabilities/DependencyInjection.cs:95`, `CapabilitiesJsModule` scoped at `:98` plus exactly 8 scoped adapters at `:100-107`), `BrowserShareService` (`Interop/BrowserShareService.cs:8`, `navigator.share`, returns false where unavailable). MAUI overrides: `UseMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:30`, `UseLocalNotification()` at `:32`, `AddMauiDeviceCapabilities()` at `:33`, the `DeviceCapabilitiesInitializer` tap bridge at `:34`), `AddMauiDeviceCapabilities` (`MMCA.Common.UI.Maui/DependencyInjection.cs:42`); external-auth broker inert until configured (`:73-76`), push wired-but-tokenless (`:64-67`); the ordering note is the class doc comment at `:25-31` ("call this service-level registration AFTER `AddUIShared` ... last registration wins", `:28-30`). Deep-link default `DeepLinkDispatcher` (`Services/Capabilities/Navigation/DeepLinkDispatcher.cs:9`, capacity-one buffer, `Lock _gate`). Shared components verified to exist: `Components/Capabilities/DeepLinkListener.razor`, `Components/Capabilities/ExternalLink.razor`, `Components/Capabilities/OfflineBanner.razor`. Package position: `MMCA.Common.UI.Maui` is entry 9 of the 19 published packages (`MMCA.Common/FACTS.md:19-40`, the entry itself at `:30`). Windows CI jobs + layer rule + the contract counts are from `Website/docs-src/adr/042-device-capability-abstraction.md` (contracts and counts at `:33-62`, defaults at `:64-70`, heads-override at `:72-76`, package/CI/layer-rule/slnx exclusion at `:78-87`). ADR-043 reuse of the dispatcher + UI.Web-served association files from `Website/docs-src/adr/043-mobile-deep-links-and-native-oauth-callback.md:100-107` ("Association files are served by each app's UI.Web host" at `:100`, "Incoming URIs reuse the ADR-042 dispatcher" at `:107`). The roughly-a-hundred-types-in-G26 figure is from `Website/docs-src/onboarding/group-26-device-capability-layer.md`, which carries 103 level-3 `### ` headings today (the body's "roughly a hundred" is that approximation). The single ```csharp``` composition block is an illustrative sketch of the documented registration order, not verbatim source; the individual method names and file:line in it are verified above. `AddUIShared` has exactly one overload, `AddUIShared(IConfiguration configuration)` (`MMCA.Common.UI/DependencyInjection.cs:36`, calling `AddDeviceCapabilityDefaults()` at `:158`), and every real host passes `builder.Configuration` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:101`, `MMCA.ADC.UI.Web/Program.cs:70`, `MMCA.ADC.UI.Web.Client/Program.cs:45`), so the sketch shows that argument. Change history: refreshed 2026-09-19 against MMCA.Common v1.205.0. The contract count moved 18 -> 24, the capability files moved out of a flat `Fallbacks/` folder into per-concern folders (`Interop/`, `DeviceStatus/`, `Media/`, `Auth/`, `DeviceStorage/`, `Navigation/`), the package ordinal moved from fifteenth of fifteen to ninth of nineteen, and the fourth kind of default (the shared default that IS the real implementation) was added to the defaults section.*

- Full series index: https://ivanball.github.io/writing.html
