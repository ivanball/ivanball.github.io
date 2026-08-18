# ADR-071: Device Capability Pattern for Barcode Scanning and QR Display

## Status
Accepted (2026-08-12). Amended 2026-08-13: the composition-time string trade-off below was resolved
in v1.147.0 by a deferred-resolution overload; see the updated trade-off entry. Amended 2026-08-14:
source citations re-anchored, and the registration path corrected (the string overload delegates to
the delegate overload, which is where the ZXing and singleton registrations happen).

## Context
ADC's badge check-in feature ([ADR-072](072-qr-badge-check-in-and-points.md)) needs two things that
look like one thing: an attendee's device has to **show** a QR code, and an organizer's device has to
**read** one. They are not the same kind of capability. Rendering a QR is pure managed computation
that every head can do, including WebAssembly. Reading one needs a camera, a permission grant, a
preview surface and a decode loop, none of which exist on a browser head that this workspace targets.

[ADR-042](042-device-capability-abstraction.md) already decided the shape for the second half: one
small interface per capability in `MMCA.Common.UI`, a safe fallback TryAdd-registered by
`AddDeviceCapabilityDefaults`, and a native override registered by the MAUI head after `AddUIShared`.
It did not decide anything about the first half, and it left two questions open that this feature is
the first to hit. Scanning is the first capability whose null fallback is not decoration: a head
without a camera cannot simply hide the affordance, because the underlying task (check an attendee in)
still has to be completable. And a camera is the first capability whose mere availability costs
something outside the code, since Android `CAMERA` and iOS `NSCameraUsageDescription` are declarations
an app store reviewer reads.

Two constraints bound the implementation. `MMCA.Common.UI` is a single-target net10.0 Razor class
library that must stay WebAssembly-compatible, so a QR generator that reaches for `System.Drawing` or a
native imaging asset is not available to it. And the pair is not conference-specific: a loyalty or
ticket-redemption flow in MMCA.Store would want the identical two halves, so building them inside ADC
would be the app-local duplication ADR-042 exists to prevent.

## Decision
**Split the feature by what it actually depends on: QR display ships as a shared component, barcode
scanning ships as an ADR-042 capability whose native half is opt-in per head.**

- **Display is a component, not a capability.** `QrCodeImage`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrCodeImage.razor`) renders a payload as
  an inline base64 PNG data URI through QRCoder's managed `PngByteQRCode` path (`:71-74`), so it works
  identically on SSR, Server, WASM and MAUI with no per-head registration at all. `Payload` (`:15-17`)
  and `AltText` (`:23-25`) are both `[EditorRequired]`, which is what keeps a generated image from
  shipping without an accessible name; `PixelsPerModule` (default 10, clamped to at least 1 at `:74`),
  `ErrorCorrection` and `Class` cover sizing and styling. A blank payload renders nothing rather than a
  broken image (`:66-69`), and the bitmap is memoized against the three inputs that affect it
  (`:42-56`), so a parent re-render does not re-encode.
- **The error-correction level is a framework enum, not the generator's.**
  `QrErrorCorrectionLevel` (`Components/QrErrorCorrectionLevel.cs:9-21`: `Low`, `Medium` (default),
  `Quartile`, `High`) is mapped onto QRCoder's `ECCLevel` inside the component (`QrCodeImage.razor:77-83`),
  so the package's public surface does not pin consumers to the generator that happens to back it today.
- **Scanning is one contract on the ADR-042 pattern.** `IBarcodeScannerService`
  (`Services/Capabilities/IBarcodeScannerService.cs:11-20`) is two members: `bool IsSupported` and
  `Task<string?> ScanAsync(CancellationToken cancellationToken = default)`. The contract is that an
  implementation **never throws**: an unsupported head, a denied permission, a user-cancelled scan and a
  cancelled token all return `null` (`:3-10`), and the decoded payload is documented as untrusted input.
  `NullBarcodeScannerService` (`Fallbacks/NullBarcodeScannerService.cs:9-16`) reports `IsSupported == false`
  and returns `null`, TryAdd-registered by `AddDeviceCapabilityDefaults`
  (`Services/Capabilities/DependencyInjection.cs:57`).
- **The native implementation is opt-in and deliberately NOT folded into `UseMauiDeviceCapabilities`.**
  A head asks for the camera by name:
  `UseCommonBarcodeScanner(string cancelText = "Cancel", string cameraDescription = "Scan a code")`
  on `MauiAppBuilder` (`MMCA.Common.UI.Maui/HostingDependencyInjection.cs:67-70`), which delegates to the
  `Func<string>` overload (`:92-103`); that overload is where ZXing's `UseBarcodeReader()` (`:99`) runs and
  where `MauiBarcodeScannerService` is plain-`AddSingleton`ed over the TryAdd default (`:100-101`).
  `UseMauiDeviceCapabilities` (`:29-42`) does not call it, and says why (`:47-49`): a head that never
  scans should ship neither the camera handler nor a camera permission declaration.
- **The scan is a modal page with exactly one resolution.** `MauiBarcodeScannerService`
  (`Capabilities/MauiBarcodeScannerService.cs:24`) marshals to the main thread, then inside
  `ScanOnMainThreadAsync` (`:94-119`) pushes a `BarcodeScanPage` modally (`:109`) and pops it in a
  `finally` (`:115-118`). The page holds a
  `TaskCompletionSource<string?>` (`Capabilities/BarcodeScanPage.cs:23-24`) that four paths can complete
  and only the first wins: a decode, the cancel button, the hardware back gesture, and
  `OnDisappearing`; the caller's `CancellationToken` is bridged to the same `Cancel()`
  (`MauiBarcodeScannerService.cs:112`). Only 2D formats are read (`BarcodeScanPage.cs:36`), because 1D
  symbologies multiply false positives on a badge screen.
- **Permission stays with the head, not the framework.** No framework code calls
  `Permissions.RequestAsync<Permissions.Camera>`. An undeclared or denied camera produces a preview that
  never decodes and is cancelled out of, which the contract already renders as `null`
  (`MauiBarcodeScannerService.cs:7-11`), so the degradation path and the cancel path are the same path.
- **Supported means Android or iOS.** `IsSupported` gates on `DeviceInfo.Current.Platform` (`:66-68`);
  Windows and Mac Catalyst heads keep the null behavior even after opting in.

Packaging follows ADR-042 exactly: `QRCoder` 1.8.0 (MIT) is a `MMCA.Common.UI` dependency and
`ZXing.Net.Maui.Controls` 0.10.3 (MIT) a `MMCA.Common.UI.Maui` one, both pinned in
`MMCA.Common/Directory.Packages.props` (`:134`, `:157`), and the MAUI package keeps its
windows-job build and pack.

## Rationale
- **Rendering a QR is not a device concern, so making it one would have been ceremony.** As a capability
  it would have needed an interface, a null fallback and a native override for something four heads all
  do the same way, and the null fallback would have meant a head that renders no badge at all. As a
  component it is one tag with no registration, which is why the web fallback in ADC's check-in flow
  costs nothing.
- **Managed-only is a hard requirement, not a preference.** QRCoder's `PngByteQRCode` path needs no
  native imaging asset, which is what lets the component ride into the WebAssembly head that
  `MMCA.Common.UI` must keep supporting.
- **`null` beats an exception when cancellation is the normal case.** A scan is a user-cancellable
  operation: the attendee walks away, the organizer taps back, the code never decodes. Modelling those as
  exceptions would make the ordinary path expensive and force every caller into a `try`. The contract of
  ADR-042's fallbacks (never throw, report capability through `IsSupported`) already said this, and
  scanning is where it pays.
- **Opting in by name keeps a permission declaration honest.** Folding the camera into
  `UseMauiDeviceCapabilities` would have handed every MAUI head an app-store-visible camera permission
  for a feature it may not have. The one extra line in a head's `MauiProgram` is the whole price of that.
- **Common, not ADC, because nothing here is about conferences.** ADR-042 established that reusable
  infrastructure belongs to the framework and app-specific behavior stays in the app. A QR display
  component and a barcode reader are the former by construction: ADC's check-in feature supplies only the
  payload format and the verification, both of which stay in ADC (ADR-072).
- **ZXing.Net.MAUI is MIT and is the maintained option.** Licensing is a decided axis in this workspace
  (ADR-016 pins MassTransit to v8 precisely because v9 is commercial), and a permissive license on a
  package that ships inside a published framework package is not negotiable. The alternative,
  hand-writing a camera preview and decoder per platform, is a large amount of code to own for a feature
  measured in one screen.

## Trade-offs
- **The scan page's strings were resolved at composition, not per call (resolved in v1.147.0).**
  As shipped in v1.145.0, `cancelText` and `cameraDescription` were captured into the singleton at
  registration, so a head that switches culture at runtime under
  [ADR-027](027-multi-locale-i18n.md) kept the cancel button, page title and semantic description in
  the language that was current at startup. v1.147.0 added a
  `UseCommonBarcodeScanner(Func<string> cancelText, Func<string> cameraDescription)` overload whose
  delegates are invoked once per scan, when the modal page is built, so the scan surface follows the
  in-app language. The original string overload remains and keeps its startup-fixed semantics (its
  XML doc says so); heads with a language switcher should pass the delegate overload.
- **`QrCodeImage` has no error surface.** There is no `try`/`catch` around the encode, so a payload too
  large for the chosen version and error-correction combination propagates out of `OnParametersSet`
  rather than degrading to a message. The intended payloads are short opaque tokens, so the failure mode
  is a programming error rather than a data condition, but the component does not say so at runtime.
- **A null fallback still masks a missing registration.** This is ADR-042's recorded trade-off, and here
  it is functional rather than decorative: a MAUI head that forgets `UseCommonBarcodeScanner` gets the
  same behavior as a browser head. The mitigation is on the consumer, which is why ADC's check-in page
  branches on `IsSupported` and renders a manual entry path instead (ADR-072) rather than hiding a
  button.
- **Opt-in means the platform matrix is not uniform.** A Windows or Mac Catalyst MAUI head that calls
  `UseCommonBarcodeScanner` still reports `IsSupported == false`, so "registered" and "usable" are two
  different questions a caller has to ask separately.
- **A generator dependency now ships to the browser.** `QRCoder` is a `MMCA.Common.UI` dependency, so it
  rides down to every WebAssembly client whether or not that client ever renders a code. It is a small
  managed assembly and trimming applies, but the cost is not zero and it is paid by heads that do not use
  the feature.
- **The decoded payload is input, and the contract can only say so.** Nothing in the framework validates
  what a camera decodes. The security of a scan therefore lives entirely in the consumer's verification
  step, which is exactly why ADR-072's credential is server-verified rather than self-describing.

## Related
[ADR-042](042-device-capability-abstraction.md) (the capability pattern this extends: contract in
`MMCA.Common.UI`, native implementation in `MMCA.Common.UI.Maui`, override after `AddUIShared`),
[ADR-072](072-qr-badge-check-in-and-points.md) (the ADC feature that motivated both halves and owns the
payload format and its verification), [ADR-027](027-multi-locale-i18n.md) (the culture model the
builder-time strings do not participate in), [ADR-016](016-lockstep-versioning-masstransit-pin.md)
(lockstep release and the licensing posture behind the ZXing choice),
[ADR-045](045-managed-file-storage-and-avatars.md) (the previous capability addition, and the same
treatment of untrusted device input).
