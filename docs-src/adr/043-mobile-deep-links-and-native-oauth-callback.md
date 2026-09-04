# ADR-043: Mobile Deep Links, App Association, and the Native OAuth Callback

## Status
Accepted (2026-07-15). Revised 2026-07-28 (the Android https App Links leg is recorded as shipped,
the outstanding Android item is restated as the served certificate fingerprint, and the client-flow
attribution is corrected; see Revision below). Revised 2026-08-01 (the served Android fingerprint is
no longer a placeholder, which closes the last outstanding ADC item, and one `Program.cs` anchor is
corrected). Revised 2026-08-07 (the two `Program.cs` anchors moved one line again, and the
hostname trade-off now names its three occurrences instead of calling them parameterized). Revised
2026-08-31 (anchors re-pinned across MMCA.Common and MMCA.ADC, the Android manifest permission count
is corrected from seven to nine, the hostname trade-off separates binary occurrences from runbook
mentions, and the shared exchange call now returns a `Result`; see Revision below). The
framework leg is fully implemented in MMCA.Common:
the OAuth custom-scheme returnUrl allowlist in `CompleteAsync`, the app-association endpoint helper
`MapAppAssociationEndpoints`
(`Source/Presentation/MMCA.Common.API/Startup/Endpoints/AppAssociationEndpointExtensions.cs:35`, with
`AppAssociationOptions` alongside), and the MAUI `MauiExternalAuthBroker`
(`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:19`). The ADC
consumer's deep-link wave has shipped: `MMCA.ADC.UI.Web` serves the two well-known association
documents through the shared helper
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:181`), the Identity service allow-lists the
`atldevcon` scheme (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:56-58`), and
the native heads register the callback: iOS carries both the custom-scheme URL type
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Info.plist:16`) and the associated-domains
entitlement (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Entitlements.plist:11`), while
Android registers the custom-scheme `WebAuthenticatorCallbackActivity`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:14`).
Android's `AutoVerify` https App Links intent filter is in place too, declared as a C# attribute on
`MainActivity` rather than in XML
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:26-31`, with the public web
host constant at `:39` and the verified link reduced to path plus query and published to
`IDeepLinkDispatcher` at `:78-79`). The checked-in
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/AndroidManifest.xml` carries nine
`uses-permission` entries (`:4-26`) above the package-visibility `queries` block (`:29-42`);
activities and their intent filters are attributes in code, which .NET for Android merges into the
generated manifest at build time. The SERVED fingerprint has landed as well:
`AppAssociation:AndroidCertFingerprints` now carries the production Play App Signing SHA-256
fingerprint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:34-36`, the single value at
`:35`) in place of the former
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` placeholder, and the helper copies that array
verbatim into the document's `sha256_cert_fingerprints`
(`Source/Presentation/MMCA.Common.API/Startup/Endpoints/AppAssociationEndpointExtensions.cs:63`), so the
served `assetlinks.json` names a real certificate. No other setting of that key exists in the ADC
repo. MMCA.Store has not adopted the wave: no association endpoints, allowlist config, or platform
callback registrations exist there yet.

## Context
Three mobile flows all need a URL to leave the web world and land inside the MAUI app:

1. **Shared links and QR codes.** The share sheet and QR codes carry ordinary https web URLs. With
   Android App Links (`assetlinks.json`) and iOS Universal Links (`apple-app-site-association`),
   the OS opens those URLs in the installed app instead of the browser.
2. **Notification taps and app actions**, which are app-internal and covered by the
   `IDeepLinkDispatcher` boundary (ADR-042).
3. **External OAuth on a native head.** Google and GitHub reject OAuth inside embedded WebViews, so
   the MAUI head must run the provider flow in the system browser (`WebAuthenticator`) and needs
   the API to redirect its completion BACK to the app. Before this decision,
   `OAuthControllerBase.CompleteAsync` redirected only to the config-pinned `OAuth:UIBaseUrl`
   (`Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs`), which a native app
   could not intercept.

The completion redirect design (ADR-036 lineage) has a hard security property worth preserving:
tokens never ride a redirect URL. `CompleteAsync` stashes the token pair server-side under a
single-use code and the UI exchanges it out-of-band via POST.

## Decision
- **Custom-scheme returnUrl allowlist in the framework.** `CompleteAsync` consults
  `OAuth:AllowedReturnUrlSchemes` (a config array, default empty). When the challenge's stashed
  `returnUrl` is an absolute URI whose scheme appears in the allowlist (for example
  `atldevcon://oauth-complete`), the completion redirect (and completion errors) target that URL
  instead of `OAuth:UIBaseUrl`, carrying only the same single-use code. The redirect echoes the
  client's `Uri.OriginalString` because URI normalization would append a trailing slash and native
  callback matching can be exact. `http`/`https` schemes never match even if listed, so web
  destinations always flow through the pinned base URL and the allowlist cannot become an open
  redirect. An empty allowlist reproduces the previous behavior byte for byte.
- **Client flow.** The MAUI head calls
  `WebAuthenticator` with `{gateway}/auth/oauth/{provider}?returnUrl={scheme}://oauth-complete` and
  captures `code` from the custom-scheme callback
  (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:71-76`), then
  hands the code to the shared `/auth/oauth-complete` page by navigating to it (`:80`). That page
  owns the rest, exactly as it does on web heads:
  `Source/Presentation/MMCA.Common.UI/Pages/Auth/OAuthComplete.razor:65` calls
  `IAuthUIService.ExchangeOAuthCodeAsync`, which returns `Result<AuthenticationResponse>` so the
  page branches on `result.IsFailure` (`:66`) rather than on an exception. The service's
  `ExchangeOAuthCodeAsync`
  (`Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:68`) POSTs the existing
  anonymous `auth/oauth/exchange` through the shared `AuthenticateAsync` helper (`:76`, the helper
  itself at `:262`), which stores the pair via `ITokenStorageService` (`:290`), so the
  single-use-code contract lives in exactly one place. This rides behind the `IExternalAuthBroker`
  contract
  (ADR-042); the default broker is unavailable, which keeps the shared Login page on its anchor
  flow for web heads.
- **Association files are served by each app's UI.Web host**, not the gateway: the shared web URLs
  are UI-host URLs, and the gateway's `/.well-known` already forwards to Identity for JWKS.
  Explicit anonymous endpoints return `assetlinks.json` (with the PLAY APP SIGNING certificate
  fingerprint, not the local keystore's) and `apple-app-site-association` (team id + bundle id +
  the shared route paths). Platform side: `AutoVerify` intent filters on Android, the
  associated-domains entitlement on iOS, plus the `WebAuthenticatorCallbackActivity` /
  `CFBundleURLTypes` scheme registrations.
- **Incoming URIs reuse the ADR-042 dispatcher.** App-link and callback URIs are reduced to their
  path and query and published to `IDeepLinkDispatcher`; because all heads share one Blazor route
  table, no mapping layer exists.

## Rationale
- Reusing the single-use-code exchange keeps the token-never-in-URL invariant identical across web
  and native; the only new surface is WHERE the code lands.
- A scheme allowlist in configuration keeps the framework generic (Store can register its own
  scheme) while defaulting closed.
- Serving association files from the UI host keeps them next to the URLs they describe and out of
  the gateway's routing table.

## Trade-offs
- The app-facing hostname is baked into store binaries (intent filters, entitlements). The apps
  currently ride the Azure Container Apps default domain, which changes if the environment is ever
  recreated and would force store resubmissions. Three places in the ADC repo put the host string
  inside the app binary: `PublicSite:BaseUrl` in the MAUI head's
  `appsettings.json` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/appsettings.json:22`, compiled in as an
  `EmbeddedResource` per `MMCA.ADC.UI.csproj:130`), a raw literal in the iOS associated-domains
  array (`Platforms/iOS/Entitlements.plist:11`), and the `PublicWebHost` compile-time constant that
  feeds the Android intent-filter attribute (`Platforms/Android/MainActivity.cs:39`). Only the first
  is read through configuration; the two native manifests take literals, because neither an
  entitlement nor an attribute argument can read config. A cutover is therefore a three-spot edit
  plus a rebuild, not a setting change (the comment at `MainActivity.cs:37-38` still describes it as
  touching two spots), plus the two verification commands in
  `MMCA.ADC/Docs/MobileReleaseRunbook.md:48` and `:52`, which repeat the host but ship nothing; a
  custom domain is the durable fix.
- A custom-scheme URI's host and path are attacker-choosable on a device with a hostile app
  registered for the same scheme (scheme hijack). Accepted: the redirect carries only a two-minute
  single-use code, the exchange is one-shot, and platform app-link verification does not exist for
  custom schemes anywhere.
- Completion failures that occur before authentication properties exist cannot know the native
  callback and still land on the web login page; the broker times out and the user retries.

## Revision (2026-07-28)
Correction pass from an ADR audit. No decision or behavior changed; the Status section had the
Android leg backwards and the Decision section attributed the token exchange to the wrong component.

1. **The Android https App Links intent filter is present, not outstanding.** The Status section
   looked for it in `Platforms/Android/AndroidManifest.xml` and, not finding it there, called the
   leg unshipped. It is declared in code instead: an `[IntentFilter]` attribute on `MainActivity`
   with `AutoVerify = true`, `DataScheme = "https"`, and `DataHost` bound to the public web host
   constant (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:26-31`,
   constant at `:39`), and a verified link arrives through `OnCreate` / `OnNewIntent`, is reduced to
   path plus query, and is published to `IDeepLinkDispatcher` (`:78-79`, inside `PublishDeepLink` at
   `:65-80`). The checked-in manifest
   carries more than package visibility as well: nine `uses-permission` entries (`:4-26`) sit above
   the `queries` block (`:29-42`). (This entry counted seven permissions when it was written; the
   count is now nine, see the 2026-08-31 entry.)
2. **What is outstanding is the served fingerprint, not the platform registration.**
   `AppAssociation:AndroidCertFingerprints` still holds the literal
   `"REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT"`
   (the key now sits at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:34`), and the mapper serializes that
   array straight into `sha256_cert_fingerprints`
   (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/AppAssociationEndpointExtensions.cs:63`). No other
   setting of that key exists in the ADC repo; the only other mention is the rotation procedure in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md`. Until the real Play App Signing fingerprint is supplied,
   the served document names a certificate no build carries and Android cannot auto-verify the
   filter that is already shipped. That item was closed hours later on the same day, so read it as
   the state at the time of writing; the 2026-08-01 entry below records the replacement.
3. **The completion page performs the exchange, not the broker.** The Decision's client-flow bullet
   read as if the MAUI broker POSTed the exchange and stored the tokens. The broker captures the
   code from the `WebAuthenticator` result
   (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/Auth/MauiExternalAuthBroker.cs:71-76`) and then
   navigates to `/auth/oauth-complete?code=...` (`:80`); `OAuthComplete.razor:65` calls
   `IAuthUIService.ExchangeOAuthCodeAsync`, declared at
   (`Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:68`, the POST at `:76`) and
   calls `ITokenStorageService.SetTokensAsync` (`:290`). The net effect is what the ADR described; the
   division of labor is not, and it matters because the native path reuses the web completion page
   rather than duplicating it.
4. **Anchor and tense maintenance.** `MapAppAssociationEndpoints` is called at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:178` (the previously cited `:162` pointed at
   the `AndroidCertFingerprints` line inside the options initializer, which now sits at `:185`; see
   the 2026-08-01, 2026-08-07, and 2026-08-31 entries). The Context statement about
   `CompleteAsync` redirecting only to `OAuth:UIBaseUrl` is now past tense, since the decision
   shipped: `BuildSuccessRedirectUrl` targets the allow-listed native URL whenever one is in play
   (`Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:137-140`, called from
   the success path at `:134`).

## Revision (2026-08-01)
Status pass from an ADR audit. No decision and no behavior changed; the one item the previous
revision left open is closed, and the anchor that revision itself introduced had already moved.

1. **The served fingerprint is no longer a placeholder.**
   `AppAssociation:AndroidCertFingerprints` now holds the production Play App Signing SHA-256
   fingerprint (now `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:34-36`), set by MMCA.ADC
   commit `d5fd0e9` (PR #80, merged 2026-07-28), which landed after the previous revision was
   written on the same day. The mapper still serializes that array straight into
   `sha256_cert_fingerprints`
   (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/AppAssociationEndpointExtensions.cs:63`), so the
   served `assetlinks.json` now names a real certificate and nothing in the ADC deep-link wave is
   outstanding. One companion document lags the code: the rotation procedure in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md:32` still describes the checked-in value as a placeholder.
2. **`Program.cs` anchor correction.** The same commit inserted a four-line comment above the
   `AndroidPackageName` assignment (explaining that the Release Android head overrides
   `ApplicationId`, so that is the package Digital Asset Links must name), which pushed the options
   initializer down. `AndroidCertFingerprints` is at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:185`, not `:162`, and the
   `MapAppAssociationEndpoints` call site is at `:178`. (Both anchors sat at `:167` and `:160` when
   this entry was written; later commits shifted them twice, see the 2026-08-07 and 2026-08-31
   entries.)

## Revision (2026-08-07)
Anchor and precision pass from an ADR audit. No decision and no behavior changed.

1. **The two `Program.cs` anchors moved one line.** MMCA.ADC commit `886fa189` (PR #100, merged
   2026-08-03, DataProtection plus client idempotency keys) inserted a line above the association
   block. `app.MapAppAssociationEndpoints(new AppAssociationOptions` moved to
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:169` (`:168` being the preceding
   `GetSection("AppAssociation")` line), with `AndroidCertFingerprints` at `:176`,
   `AndroidPackageName` at `:175` and the four-line comment from the 2026-08-01 entry at `:171-174`.
   Every citation of those two anchors is updated above, the ones inside the earlier revisions
   included. (Those are the values as of this entry; a further commit shifted the block again, see
   the 2026-08-31 entry.)
2. **The hostname trade-off names its three occurrences.** The bullet said every occurrence "stays
   parameterized", which reads as if the host were configurable everywhere. It is not: the string
   reaches the binary from three places and only one of them is read through configuration
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/appsettings.json:22`). The other two are compile-time
   literals the platforms require: `Platforms/iOS/Entitlements.plist:11` and the `PublicWebHost`
   constant at `Platforms/Android/MainActivity.cs:39`. All three ship inside the binary, so the
   resubmission cost the bullet warns about is unchanged; what changed is the description of the
   edit. The in-code comment at `MainActivity.cs:37-38` still calls the cutover a two-spot change,
   which is a documentation lag in MMCA.ADC, not a behavior difference. (This entry said "occurs
   three times in the ADC repo"; the repo has two further mentions in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md`, see the 2026-08-31 entry.)

## Revision (2026-08-31)
Anchor and count pass from an ADR audit. No decision and no behavior changed.

1. **The ADC `Program.cs` association block moved again.** MMCA.ADC commit `6323a7b9` (PR #155)
   shifted it nine lines: `app.MapAppAssociationEndpoints(new AppAssociationOptions` is at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:181`, the preceding
   `GetSection("AppAssociation")` line at `:180`, `AndroidPackageName` at `:187`,
   `AndroidCertFingerprints` at `:188`, and the Apple `applinks` components at `:190`; the four-line
   package-id comment from the 2026-08-01 entry is at `:183-186`, above which `:174-179` is now an
   ADR-043 block comment. Every citation of those anchors is updated above.
2. **The MMCA.Common exchange call returns a `Result`.** `IAuthUIService.ExchangeOAuthCodeAsync`
   returns `Result<AuthenticationResponse>`
   (`Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:68`), so the shared
   completion page branches on `result.IsFailure`
   (`Source/Presentation/MMCA.Common.UI/Pages/Auth/OAuthComplete.razor:65-66`) instead of relying on
   the surrounding `try`/`catch` alone. Inside the service the POST to `auth/oauth/exchange` goes
   through the shared `AuthenticateAsync` helper (`:76`, the helper itself at `:262`), which is
   also where `ITokenStorageService.SetTokensAsync` is called (`:290`). The division of labor the
   2026-07-28 entry corrected is unchanged: the page still owns the exchange, the broker still only
   hands over the code.
3. **The Android manifest carries nine permissions, not seven.** The 2026-07-28 count is stale:
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/AndroidManifest.xml:4-26` declares
   `ACCESS_NETWORK_STATE`, `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, `ACCESS_COARSE_LOCATION`,
   `ACCESS_FINE_LOCATION`, `USE_BIOMETRIC`, `RECORD_AUDIO`, and `CAMERA`, above the
   package-visibility `queries` block at `:29-42`. The extra permissions belong to the ADR-042 and
   ADR-045 device-capability waves and touch nothing in this decision; only the count was wrong.
4. **The hostname trade-off separates binary occurrences from documentation.** The bullet said the
   host string occurs "in exactly three places in the ADC repo, and all three ship inside the app
   binary". Three places put it in the binary (`MMCA.ADC.UI/appsettings.json:22`,
   `Platforms/iOS/Entitlements.plist:11`, `Platforms/Android/MainActivity.cs:39`), which is the
   claim that carries the resubmission cost, but the repo holds two further mentions that ship
   nothing: the `curl` and Digital Asset Links verification commands in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md:48` and `:52`. A cutover has to touch those too, or the
   runbook verifies the old host.
5. **Remaining ADC anchor drift.** The MAUI head's `appsettings.json` is compiled in as an
   `EmbeddedResource` at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MMCA.ADC.UI.csproj:130` (the only
   `EmbeddedResource` in that file), the Identity service's OAuth allowlist section is at
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:56-58` with the `atldevcon`
   entry at `:57`, the served fingerprint key is at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:34-36`, the Android intent filter is
   at `Platforms/Android/MainActivity.cs:26-31` with `PublishDeepLink` at `:65-80`, and
   `BuildSuccessRedirectUrl` is defined at
   `Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:137-140` and called at
   `:134`. The rotation procedure in `MMCA.ADC/Docs/MobileReleaseRunbook.md:32` still calls the
   checked-in fingerprint a placeholder, so that documentation lag from the 2026-08-01 entry is
   still open.
