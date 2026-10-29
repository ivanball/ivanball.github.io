# ADR-044: Native Push Delivery (the Third Notification Channel)

## Status
Accepted (2026-07-11). Amends ADR-024. The framework pipeline is implemented and inert by
default; each consumer switches it on by provisioning a notification hub with platform
credentials and enabling the `NativePush` configuration section. Revised 2026-10-01 (UI.Maui
ships credentialed FCM/APNs token providers and token-rotation re-registration; see Revision below).
Revised 2026-10-06: the device DELETE route is `/Notifications/Devices/{installationId}`.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-21: anchors refreshed after the releases that moved the device controller, the
registration service and the registrar.
Revised 2026-10-24: the Notification Hubs sender and registrar moved to MMCA.Common.Azure, registered by `AddAzureNotificationHubsPush` ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); see Revision (2026-10-24).
Revised 2026-10-25: two more delivery adapters ship, SNS mobile push over a DynamoDB registry (MMCA.Common.Aws) and FCM HTTP v1 over a Firestore registry (MMCA.Common.Gcp), and the payload builders moved into the core; see Revision (2026-10-25).
Revised 2026-10-26: anchors refreshed after the releases that moved the SNS sender and registrar and the core payload builders.
Revised 2026-10-28: the hub-call cost consequence is scoped to the Notification Hubs adapter, with the SNS per-endpoint cost beside it, and the native-leg anchor is corrected.

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
- **Two Application abstractions, Null by default** (the ADR-024 pattern):
  `INativePushSender` (user-targeted and broadcast native sends) and `IPushDeviceRegistrar`
  (installation upsert/delete,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushDeviceRegistrar.cs:11`,
  `UpsertAsync` at `:29`, `DeleteAsync` at `:48`). `AddInfrastructure` TryAdds no-op defaults.
- **Three delivery adapters, one registration call each.** Each call implements both abstractions
  and swaps them in only when `NativePush:Enabled` is true AND its own section is complete, so hosts
  call it unconditionally and deployments flip the channel on by configuration alone:
  - **Azure Notification Hubs**, `AddAzureNotificationHubsPush(configuration)` (MMCA.Common.Azure),
    gated on `ConnectionString` and `HubName`. One hub abstracts both platforms behind one API, holds
    the platform credentials outside our code, and its installation model gives upsert semantics
    with client-generated stable ids. The free tier covers conference volumes.
  - **AWS SNS mobile push**, `AddAmazonSnsPush(configuration)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:164`), gated on
    `NativePush:Sns` carrying `InstallationsTable`, `BroadcastTopicArn` and at least one of
    `FcmPlatformApplicationArn` / `ApnsPlatformApplicationArn` (`:138-147`, `:170-175`). SNS keeps
    no owner per endpoint, so a DynamoDB table is the installation registry: partition key
    `InstallationId`, global secondary index `UserId-index` on `UserId` (`:150-152`;
    `.../MMCA.Common.Aws/Notifications/SnsInstallationRegistry.cs:29`). The ownership and handover
    rule is one conditional write, `attribute_not_exists(InstallationId) OR UserId = :me OR
    PushChannel = :channel` (`SnsInstallationRegistry.cs:36`, applied at `:97`), so it holds under
    concurrency without a lock. A broadcast is one publish to the topic every endpoint subscribes
    to (`Notifications/SnsPushDeviceRegistrar.cs:157-167`, `Notifications/SnsNativePushSender.cs:73-80`),
    and an endpoint SNS reports disabled or missing is removed with its row on send
    (`SnsNativePushSender.cs:99-102`).
  - **Google FCM HTTP v1**, `AddFirebaseCloudMessagingPush(configuration)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:142`), gated on
    `NativePush:Fcm` carrying `ProjectId`, `InstallationsCollection` and `BroadcastTopic`
    (`:119-123`, `:148-153`), with Application Default Credentials. A Firestore collection is the
    registry, one document per installation id, and every ownership decision is a Firestore
    transaction (`.../MMCA.Common.Gcp/Notifications/FirestoreInstallationRegistry.cs:10-12`, `:45`).
    Only FCM registration tokens are accepted: an APNs-platform registration fails validation with
    `PushDevice.UnsupportedPlatform` (`Notifications/FcmPushDeviceRegistrar.cs:40-46`), so an iOS
    client registers its FCM token on this adapter. A broadcast is one message to the FCM topic
    (`Notifications/FcmNativePushSender.cs:95`), and a send that reports the token unregistered, or
    names it as an invalid registration token, prunes the installation
    (`Notifications/FcmSendOutcome.cs:25-28`, `FcmNativePushSender.cs:80`). The token target is set
    under a scoped CS0618 suppression (`Notifications/FcmPushMessage.cs:31-39`): FirebaseAdmin 3.6+
    deprecates `Message.Token` in favour of Firebase installation ids (FIDs), while the
    topic-subscription APIs the broadcast depends on take registration tokens only. The exit is moving
    registration and send to FIDs together.
- **A lost adapter call fails startup.** `NativePush:Enabled=true` while `INativePushSender` is
  still the Null sender fails validation with a message naming all three calls and their keys
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:48-53`).
- **Sends target users, never raw tokens**; a user's every device gets the message. On Notification
  Hubs installations are tagged `user:{id}` and tag expressions are OR-chunked at the hub's 20-tag
  cap (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/NativePushUserTags.cs:11,20`,
  unit-tested), so audience size is unbounded. The SNS and FCM registries look installations up by
  their `UserId` field instead (`SnsInstallationRegistry.cs:127`; Firestore queries at most 30 users
  at a time, `FirestoreInstallationRegistry.cs:23`).
- **One payload shape in the core.** `NativePushPayloads.BuildFcmV1Payload` and `BuildApnsPayload`
  are public in `MMCA.Common.Infrastructure.Notifications.Push`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:13,20,42`),
  called by the Notification Hubs sender
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/AzureNotificationHubNativePushSender.cs:22-23`)
  and the SNS message builder
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Notifications/SnsPushMessage.cs:29-30`). The FCM adapter
  maps the same fields onto FirebaseAdmin's typed `Message` instead of raw JSON
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Notifications/FcmPushMessage.cs:7-9`, `:56-76`), with a
  test pinning the equivalence.
- **`SendPushNotificationHandler` gains the third leg.** After the inbox write and the SignalR
  attempt, it calls `INativePushSender.SendToUsersAsync` inside its own non-fatal catch. The
  audit status (`Sent`/`Failed`) stays owned by the SignalR leg: the inbox remains the source
  of truth, and a hub outage must not fail the command or the other channels.
- **`DevicesController` (PUT `/Notifications/Devices`, DELETE `/Notifications/Devices/{installationId}`,
  `DevicesController.cs:22,35,60`)** ships in `MMCA.Common.API` via
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
  `MauiPushRegistrationService.cs:27,44`). The token provider defaults to
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
- On Notification Hubs, sends fan out per 20-user chunk and per platform: an audience of N users
  costs `ceil(N/20) * 2` hub calls. Acceptable at conference scale; a template-based send can
  consolidate later without touching callers. The SNS adapter instead costs at least one DynamoDB
  query per distinct user (the registry pages until `LastEvaluatedKey` is empty,
  `SnsInstallationRegistry.cs:117-151`) plus one publish per distinct endpoint
  (`SnsNativePushSender.cs:45-64`), and a disabled or missing endpoint adds its removal calls
  (`SnsNativePushSender.cs:120-123`). The FCM adapter costs one Firestore query per 30 distinct
  users (`FcmNativePushSender.cs:39,43`, `FirestoreInstallationRegistry.cs:23,76`) plus one
  `SendEachAsync` per 500 distinct tokens (`FcmNativePushSender.cs:57,63`,
  `IFcmMessagingClient.cs:17`).
- The handler's third leg is best-effort: it is awaited inside a non-fatal catch
  (`SendPushNotificationHandler.cs:140-153`), with no per-device delivery tracking. Because
  `SendPushNotificationCommand` is `ITransactional`, a transient fault on the final status save
  re-runs the live legs under the execution strategy, so native delivery is at-least-once and a
  device can receive the same OS push twice (`SendPushNotificationHandler.cs:21-30`). The
  observability surface is the vendor's delivery telemetry plus each adapter's own log messages
  (for SNS, `SnsNativePushSender.cs:67,132-148`; for FCM, `FcmNativePushSender.cs:116-134`); the
  inbox remains the recovery path.
- A delete verifies ownership before it acts: the registrar reads the installation and checks
  the `user:{id}` tag `UpsertAsync` stamped on it
  (`AzureNotificationHubDeviceRegistrar.cs:84-92`), so an id belonging to someone else deletes
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

## Revision (2026-10-21)
Re-verified against current source. The decision is unchanged: Notification Hubs, `user:{id}` tags,
the Null-by-default sender and registrar, the owner-scoped idempotent DELETE, and the unregister leg
running before the local sign-out. Only anchors in the live sections moved.

1. Anchors re-verified against current source: `DevicesController` routes are now
   `DevicesController.cs:22,35,60` (`[Route]` at `:22`, `[HttpPut]` at `:35`,
   `[HttpDelete("{installationId}")]` at `:60`); the registration `SemaphoreSlim` and its `WaitAsync`
   are `MauiPushRegistrationService.cs:27,44`; and the delete ownership check (read the installation,
   check the `user:{id}` tag, then delete) is `AzureNotificationHubDeviceRegistrar.cs:84-92`, with the
   unknown-id success path at `:95-99`. `AddMauiPushDeviceTokenProvider()` stays at
   `MMCA.Common.UI.Maui/DependencyInjection.cs:124-132`, the unregister calls at `AuthUIService.cs:90,143`
   (defined at `:361`), and the handler's native leg and at-least-once remarks at
   `SendPushNotificationHandler.cs:141-154` and `:21-30`.

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) moves the Notification Hubs implementation out of
MMCA.Common.Infrastructure into the `MMCA.Common.Azure` adapter. The decision is unchanged: the
Null-by-default sender and registrar, the `NativePush` section enabled AND complete as the gate, and
`user:{id}` tags.

1. **Registration renamed.** `AddNativePushNotifications(configuration)` is now
   `AddAzureNotificationHubsPush(configuration)`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:83`), with the same
   gate on `Enabled`, `ConnectionString` and `HubName` (`:91`-`:96`) before it registers the sender and
   registrar (`:101`-`:102`).
2. **Types moved.** `AzureNotificationHubNativePushSender`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/AzureNotificationHubNativePushSender.cs:14`)
   and `AzureNotificationHubDeviceRegistrar` (`Notifications/AzureNotificationHubDeviceRegistrar.cs:15`)
   live in `MMCA.Common.Azure.Notifications`, and `NativePushSettings` is now
   `AzureNotificationHubSettings` (`Notifications/AzureNotificationHubSettings.cs:9`). The `NativePush`
   section and its keys are unchanged (`MMCA.Common/CHANGELOG.md:25`).
3. **A lost call fails startup.** `NativePush:Enabled=true` while `INativePushSender` is still the
   Null sender fails `ValidateOnStart`, naming the call
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:33`,
   `:48`-`:53`).
4. **Corrected in place:** the Decision bullet that named `AddNativePushNotifications(configuration)`.
   The registrar anchors inside the 2026-10-21 revision point at the file's earlier Infrastructure
   location and are left as recorded.

## Revision (2026-10-25)
MMCA.Common v1.257.0 adds two native push adapters beside Notification Hubs
(`MMCA.Common/CHANGELOG.md:14`, `:20`). The pipeline is unchanged: the Null-by-default sender and
registrar, the `NativePush:Enabled` gate, user-targeted sends, the owner-scoped idempotent DELETE and
the client lifecycle. The Decision now describes three adapters.

1. **SNS mobile push** (`AddAmazonSnsPush`, MMCA.Common.Aws) over a DynamoDB installation registry
   with the `UserId-index` global secondary index, the ownership and handover rule as one conditional
   write, a broadcast topic, and disabled-endpoint pruning on send (anchors in the Decision).
2. **FCM HTTP v1** (`AddFirebaseCloudMessagingPush`, MMCA.Common.Gcp) over a Firestore registry
   updated inside transactions. FCM registration tokens only: an APNs-platform registration fails
   validation. Broadcast uses an FCM topic, and unregistered tokens are pruned on send.
3. **Payload builders moved into the core.** `NativePushPayloads.BuildFcmV1Payload` and
   `BuildApnsPayload` are public in `MMCA.Common.Infrastructure.Notifications.Push`, with output
   byte-identical to the former Azure-internal builders (`MMCA.Common/CHANGELOG.md:26`). The 20-tag
   chunking stays in the Azure adapter as `NativePushUserTags`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/NativePushUserTags.cs:8`); the
   Decision bullet that credited it to `NativePushPayloads` is corrected in place.
4. **The startup tripwire names all three calls**
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:53`,
   `MMCA.Common/CHANGELOG.md:33`).
5. **Scoped CS0618 suppression on `Message.Token`**
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Notifications/FcmPushMessage.cs:37-39`, rationale and
   exit at `:31-36`): FirebaseAdmin 3.6+ deprecates tokens for FIDs, while the topic-subscription
   APIs take tokens only. The exit is moving registration and send to FIDs together.
6. **Rejected alternative: registry rows in each consumer's own database.** Keeping the SNS and FCM
   installations as rows in each consumer's database was weighed on 2026-10-24 and rejected (a design
   decision recorded here, not in source): an adapter-owned table would need a migration and a PR in every
   consumer that enables push, and the adapter would no longer hold everything its capability needs.
   Revisit if a consumer must keep installation data inside its own database for a residency or audit
   reason. The registries are vendor-side resources provisioned outside the application instead
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:150`,
   `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:128-129`).
7. The Consequences entries on hub-call cost (`ceil(N/20) * 2`) and on the tag-based delete check
   describe the Notification Hubs adapter. The SNS and FCM registrars enforce the same owner-scoped
   delete and channel handover through the DynamoDB condition and the Firestore transaction
   (`AwsServiceCollectionExtensions.cs:134-136`, `GcpServiceCollectionExtensions.cs:113-115`).

## Revision (2026-10-26)
Re-verified against current source. The decision is unchanged: three delivery adapters, the
Null-by-default sender and registrar, the `NativePush:Enabled` gate, and one payload shape in the
core. Only anchors in the live sections moved.

1. Anchors re-verified against current source: the SNS broadcast topic subscription is
   `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Notifications/SnsPushDeviceRegistrar.cs:157-167`
   (`TopicArn = options.Value.BroadcastTopicArn` at `:162`); the single broadcast publish is
   `Notifications/SnsNativePushSender.cs:73-80` inside `BroadcastAsync` (`:71`); the disabled or
   missing endpoint pruning is `SnsNativePushSender.cs:99-102`; and `NativePushPayloads`,
   `BuildFcmV1Payload` and `BuildApnsPayload` are
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:13,20,42`.
   The `AddMauiPushDeviceTokenProvider()` anchor inside the 2026-10-01 revision is left as recorded;
   the live Decision already cites `MMCA.Common.UI.Maui/DependencyInjection.cs:124-132`.

## Revision (2026-10-28)
Re-verified against current source. The decision is unchanged: three delivery adapters, the
Null-by-default sender and registrar, the `NativePush:Enabled` gate, and the best-effort native leg
with at-least-once delivery. One Consequences entry is scoped and one anchor moved.

1. **Send cost scoped per adapter.** The Consequences entry on `ceil(N/20) * 2` calls now names
   Notification Hubs, since the Decision describes three adapters, and gives the other two beside
   it. The SNS sender costs at least one DynamoDB query per distinct user, because
   `QueryByUserAsync` pages until `LastEvaluatedKey` is empty
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Notifications/SnsInstallationRegistry.cs:117-151`),
   plus one publish per distinct endpoint (`Notifications/SnsNativePushSender.cs:45-64`), with
   stale-endpoint removal calls on top (`:120-123`). The FCM sender costs one Firestore query per 30
   distinct users and one `SendEachAsync` per 500 distinct tokens
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Notifications/FcmNativePushSender.cs:39,43,57,63`,
   `FirestoreInstallationRegistry.cs:23,76`, `IFcmMessagingClient.cs:17`).
2. **Observability no longer credited to the hub alone.** The same Consequences entry now names
   each adapter's log messages beside the vendor telemetry (`SnsNativePushSender.cs:67,132-148`,
   `FcmNativePushSender.cs:116-134`).
3. Anchors re-verified against current source: the handler's native leg is
   `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:140-153`
   (`try` at `:140`, `SendToUsersAsync` at `:142`, catch at `:149`), and the at-least-once remark
   stays at `:21-30`. Anchors inside earlier revisions are left as recorded: the CHANGELOG lines, the
   2026-10-01 anchors, and the native-leg range `SendPushNotificationHandler.cs:141-154` in the
   2026-10-06 and 2026-10-21 revisions.
