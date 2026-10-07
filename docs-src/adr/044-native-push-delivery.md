# ADR-044: Native Push Delivery (the Third Notification Channel)

## Status
Accepted (2026-07-11). Amends ADR-024. The framework pipeline is implemented and inert by
default; each consumer switches it on by provisioning a notification hub with platform
credentials and enabling the `NativePush` configuration section. Revised 2026-10-01 (UI.Maui
ships credentialed FCM/APNs token providers and token-rotation re-registration; see Revision below).
Revised 2026-10-06: the device DELETE route is `/Notifications/Devices/{installationId}`.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
ADR-024 established two notification channels: a durable per-user `UserNotification` inbox (the
source of truth) and a transient SignalR push behind `IPushNotificationSender`. Both stop at the
edge of a connected client: a phone with the app backgrounded, killed, or offline hears nothing
until the next launch. Conference announcements ("lunch is served", "room change") are exactly
the messages that must reach pockets, not open tabs.

OS-level delivery needs three things the framework did not have: a per-device registration
store keyed to users, a sender that speaks FCM v1 (Android) and APNs (iOS), and a client-side
lifecycle that registers the device after sign-in and unregisters it before sign-out. It also
needs credentials (a Firebase service account, an APNs auth key) that cannot live in source and
may not exist when the code ships.

## Decision
- **Azure Notification Hubs as the delivery fan-out.** One hub abstracts both platforms behind
  one API, holds the platform credentials outside our code, and its installation model gives
  upsert semantics with client-generated stable ids. The free tier covers conference volumes.
- **Two new Application abstractions, Null by default** (the ADR-024 pattern):
  `INativePushSender` (user-targeted and broadcast native sends) and `IPushDeviceRegistrar`
  (installation upsert/delete). `AddInfrastructure` TryAdds no-op defaults;
  `AddNativePushNotifications(configuration)` swaps in the Azure Notification Hubs
  implementations only when the `NativePush` section is enabled AND complete
  (`ConnectionString`, `HubName`) - so hosts call it unconditionally and deployments flip the
  channel on by configuration alone.
- **Installations are tagged `user:{id}`.** Sends target users, never raw tokens; a user's
  every device gets the message. Tag expressions are OR-chunked at the hub's 20-tag cap
  (`NativePushPayloads`, unit-tested), so audience size is unbounded.
- **`SendPushNotificationHandler` gains the third leg.** After the inbox write and the SignalR
  attempt, it calls `INativePushSender.SendToUsersAsync` inside its own non-fatal catch. The
  audit status (`Sent`/`Failed`) stays owned by the SignalR leg: the inbox remains the source
  of truth, and a hub outage must not fail the command or the other channels.
- **`DevicesController` (PUT `/Notifications/Devices`, DELETE `/Notifications/Devices/{installationId}`,
  `DevicesController.cs:22,31,55`)** ships in `MMCA.Common.API` via
  the existing `AddNotificationControllers` application part, `[Authorize]` for any signed-in
  user and feature-gated with the same `Notification.PushNotifications` flag as the rest of the
  pipeline. Ownership is stamped server-side from the current user; installation ids are
  client-generated GUIDs (not enumerable). DELETE is idempotent and owner-scoped:
  `IPushDeviceRegistrar.DeleteAsync(userId, installationId, ct)` takes the owning user, and an
  unknown id and another user's id both answer success without deleting anything.
- **Client orchestration behind two UI capability contracts** (ADR-042 pattern):
  `IPushRegistrationService` (register after sign-in, unregister BEFORE sign-out - the delete
  call is authenticated) and `IPushDeviceTokenProvider` (the platform token extension point). UI.Maui
  ships `MauiPushRegistrationService` (stable installation id in `IDevicePreferences`, sync
  over the named API client, with a `SemaphoreSlim` serializing registration passes,
  `MauiPushRegistrationService.cs:24,41`). The token provider defaults to
  `NullPushDeviceTokenProvider` (TryAdd, `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:62`);
  the opt-in `AddMauiPushDeviceTokenProvider()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:124-132`)
  replaces it with `FcmPushDeviceTokenProvider` on Android (gated on the `Push:Fcm` section,
  `FcmPushDeviceTokenProvider.cs:33,43-49`) and `ApnsPushDeviceTokenProvider` on iOS/MacCatalyst
  (gated on `Push:Apns:Enabled`, `ApnsPushDeviceTokenProvider.cs:30,37`), while the windows TFM
  keeps the Null default. A build WITHOUT push credentials is therefore wired but inert end to end.
  `PushRegistrationListener` (rendered through the host layout extension point) re-registers on
  auth-state changes, and on Android `MauiFirebaseMessagingService.OnNewToken` re-registers when
  FCM rotates the token (`MauiFirebaseMessagingService.cs:26-35`). `AuthUIService` owns the
  unregister leg: `LogoutAsync` and `RevokeAllSessionsAsync` both call `UnregisterPushAsync`
  before the local sign-out (`AuthUIService.cs:90,143`, defined at `:361`).

## Consequences
- Sends fan out per 20-user chunk and per platform: an audience of N users costs
  `ceil(N/20) * 2` hub calls. Acceptable at conference scale; a template-based send can
  consolidate later without touching callers.
- The handler's third leg is best-effort: it is awaited inside a non-fatal catch
  (`SendPushNotificationHandler.cs:141-154`), with no per-device delivery tracking. Because
  `SendPushNotificationCommand` is `ITransactional`, a transient fault on the final status save
  re-runs the live legs under the execution strategy, so native delivery is at-least-once and a
  device can receive the same OS push twice (`SendPushNotificationHandler.cs:21-30`). The hub's
  telemetry is the observability surface; the inbox remains the recovery path.
- A delete verifies ownership before it acts: the registrar reads the installation and checks
  the `user:{id}` tag `UpsertAsync` stamped on it
  (`AzureNotificationHubDeviceRegistrar.cs:68-74`), so an id belonging to someone else deletes
  nothing. That costs an extra hub round trip per delete, and the response cannot tell a caller
  which case it hit: an unknown id and a foreign one both answer success, deliberately, so the
  endpoint is not an existence oracle for other users' installation ids.
- Consumers must update PRIVACY.md/store data-safety forms (push tokens are device identifiers)
  BEFORE store metadata mentions push. Credential provisioning (Firebase service account, APNs
  key) is a manual runbook step per app; until done, the hub rejects sends and the client
  token provider yields nothing - both by design.
- `SendPushNotificationHandler` gained a constructor parameter (DI-resolved; source-compatible
  for every host, breaking only for code constructing it manually - none known).

## Revision (2026-10-01)
The client half of the pipeline is no longer Null-only. `MMCA.Common.UI.Maui` ships credentialed
token providers behind the opt-in `AddMauiPushDeviceTokenProvider()`
(`MMCA.Common.UI.Maui/DependencyInjection.cs:118-126`): `FcmPushDeviceTokenProvider` on Android,
which yields nothing unless the four `Push:Fcm` values are present
(`FcmPushDeviceTokenProvider.cs:33,43-49`), and `ApnsPushDeviceTokenProvider` on iOS/MacCatalyst,
gated on `Push:Apns:Enabled` (`ApnsPushDeviceTokenProvider.cs:30,37`) and fed by `ApnsTokenBridge`.
The windows TFM registers nothing and keeps the `NullPushDeviceTokenProvider` TryAdd default
(`MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:62`), so the inert-without-credentials
property holds. Android also gains a second registration trigger: `MauiFirebaseMessagingService`
re-registers on FCM token rotation (`MauiFirebaseMessagingService.cs:26-35`), and
`MauiPushRegistrationService` serializes concurrent passes with a `SemaphoreSlim`
(`MauiPushRegistrationService.cs:24,41`). The unregister leg runs from both `LogoutAsync` and
`RevokeAllSessionsAsync` (`AuthUIService.cs:90,134,320`). The Consequences entry on the third leg
now reads best-effort rather than fire-and-forget: the native send is awaited inside a non-fatal
catch, and because `SendPushNotificationCommand` is `ITransactional` a retried final save re-runs
the live legs, making native delivery at-least-once (`SendPushNotificationHandler.cs:21-29,158-171`).
The server-side decision (Notification Hubs, `user:{id}` tags, the Null-by-default sender and
registrar) is unchanged.

## Revision (2026-10-06)
- The Decision entry on `DevicesController` now names the DELETE route correctly: PUT is the bare
  `/Notifications/Devices` route and DELETE is `/Notifications/Devices/{installationId}`
  (`DevicesController.cs:22,31,55`).
- Anchors in the live sections were re-verified against current source: `AddMauiPushDeviceTokenProvider()`
  is now `MMCA.Common.UI.Maui/DependencyInjection.cs:124-132`, the unregister calls are
  `AuthUIService.cs:90,143` (definition at `:342`), and the handler's native leg and at-least-once
  remarks are `SendPushNotificationHandler.cs:141-154` and `:21-30`.

## Revision (2026-10-07)
Re-verified against current source. The decision is unchanged: Notification Hubs, `user:{id}` tags, the
Null-by-default sender and registrar, and the unregister leg running before the local sign-out in
both `LogoutAsync` and `RevokeAllSessionsAsync`. Only one anchor moved.

1. Anchors re-verified against current source: the unregister calls stay at `AuthUIService.cs:90,143`
   (each ahead of `SignOutLocallyAsync` at `:101` and `:144`), and `UnregisterPushAsync` is now defined
   at `AuthUIService.cs:361`.
