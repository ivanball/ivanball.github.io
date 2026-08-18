# ADR-043: Mobile Deep Links, App Association, and the Native OAuth Callback

## Status
Accepted (2026-07-15). Revised 2026-07-28 (the Android https App Links leg is recorded as shipped,
the outstanding Android item is restated as the served certificate fingerprint, and the client-flow
attribution is corrected; see Revision below). Revised 2026-08-01 (the served Android fingerprint is
no longer a placeholder, which closes the last outstanding ADC item, and one `Program.cs` anchor is
corrected). Revised 2026-08-07 (the two `Program.cs` anchors moved one line again, and the
hostname trade-off now names its three occurrences instead of calling them parameterized). The
framework leg is fully implemented in MMCA.Common:
the OAuth custom-scheme returnUrl allowlist in `CompleteAsync`, the app-association endpoint helper
`MapAppAssociationEndpoints`
(`Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:35`, with
`AppAssociationOptions` alongside), and the MAUI `MauiExternalAuthBroker`
(`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:19`). The ADC
consumer's deep-link wave has shipped: `MMCA.ADC.UI.Web` serves the two well-known association
documents through the shared helper
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:169`), the Identity service allow-lists the
`atldevcon` scheme (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:42-43`), and
the native heads register the callback: iOS carries both the custom-scheme URL type
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Info.plist:16`) and the associated-domains
entitlement (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/iOS/Entitlements.plist:11`), while
Android registers the custom-scheme `WebAuthenticatorCallbackActivity`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:14`).
Android's `AutoVerify` https App Links intent filter is in place too, declared as a C# attribute on
`MainActivity` rather than in XML
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:21-26`, with the public web
host constant at `:31` and the verified link reduced to path plus query and published to
`IDeepLinkDispatcher` at `:60-61`). The checked-in
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/AndroidManifest.xml` carries seven
`uses-permission` entries (`:4-16`) above the package-visibility `queries` block (`:19-32`);
activities and their intent filters are attributes in code, which .NET for Android merges into the
generated manifest at build time. The SERVED fingerprint has landed as well:
`AppAssociation:AndroidCertFingerprints` now carries the production Play App Signing SHA-256
fingerprint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:29`) in place of the former
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` placeholder, and the helper copies that array
verbatim into the document's `sha256_cert_fingerprints`
(`Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:63`), so the
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
  (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:71-76`), then
  hands the code to the shared `/auth/oauth-complete` page by navigating to it (`:80`). That page
  owns the rest, exactly as it does on web heads:
  `Source/Presentation/MMCA.Common.UI/Pages/Auth/OAuthComplete.razor:64` calls
  `IAuthUIService.ExchangeOAuthCodeAsync`, which POSTs the existing anonymous
  `auth/oauth/exchange` (`Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:128`)
  and stores the pair via `ITokenStorageService` (`:156`), so the single-use-code contract lives in
  exactly one place. This rides behind the `IExternalAuthBroker` contract
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
  recreated and would force store resubmissions. The host string occurs in exactly three places in
  the ADC repo, and all three ship inside the app binary: `PublicSite:BaseUrl` in the MAUI head's
  `appsettings.json` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/appsettings.json:22`, compiled in as an
  `EmbeddedResource` per `MMCA.ADC.UI.csproj:122`), a raw literal in the iOS associated-domains
  array (`Platforms/iOS/Entitlements.plist:11`), and the `PublicWebHost` compile-time constant that
  feeds the Android intent-filter attribute (`Platforms/Android/MainActivity.cs:31`). Only the first
  is read through configuration; the two native manifests take literals, because neither an
  entitlement nor an attribute argument can read config. A cutover is therefore a three-spot edit
  plus a rebuild, not a setting change (the comment at `MainActivity.cs:29-30` still describes it as
  touching two spots); a custom domain is the durable fix.
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
   constant (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Platforms/Android/MainActivity.cs:21-26`,
   constant at `:31`), and a verified link arrives through `OnCreate` / `OnNewIntent`, is reduced to
   path plus query, and is published to `IDeepLinkDispatcher` (`:60-61`). The checked-in manifest
   carries more than package visibility as well: seven `uses-permission` entries (`:4-16`) sit above
   the `queries` block (`:19-32`).
2. **What is outstanding is the served fingerprint, not the platform registration.**
   `AppAssociation:AndroidCertFingerprints` still holds the literal
   `"REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT"`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:29`), and the mapper serializes that
   array straight into `sha256_cert_fingerprints`
   (`Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:63`). No other
   setting of that key exists in the ADC repo; the only other mention is the rotation procedure in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md`. Until the real Play App Signing fingerprint is supplied,
   the served document names a certificate no build carries and Android cannot auto-verify the
   filter that is already shipped. That item was closed hours later on the same day, so read it as
   the state at the time of writing; the 2026-08-01 entry below records the replacement.
3. **The completion page performs the exchange, not the broker.** The Decision's client-flow bullet
   read as if the MAUI broker POSTed the exchange and stored the tokens. The broker captures the
   code from the `WebAuthenticator` result
   (`Source/Presentation/MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:71-76`) and then
   navigates to `/auth/oauth-complete?code=...` (`:80`); `OAuthComplete.razor:64` calls
   `IAuthUIService.ExchangeOAuthCodeAsync`, which POSTs `auth/oauth/exchange`
   (`Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:128`) and calls
   `ITokenStorageService.SetTokensAsync` (`:156`). The net effect is what the ADR described; the
   division of labor is not, and it matters because the native path reuses the web completion page
   rather than duplicating it.
4. **Anchor and tense maintenance.** `MapAppAssociationEndpoints` is called at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:160` (the previously cited `:162` pointed at
   the `AndroidCertFingerprints` line inside the options initializer, which now sits at `:167`; see
   the 2026-08-01 and 2026-08-07 entries). The Context statement about
   `CompleteAsync` redirecting only to `OAuth:UIBaseUrl` is now past tense, since the decision
   shipped: `BuildSuccessRedirectUrl` targets the allow-listed native URL whenever one is in play
   (`Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:124-127`).

## Revision (2026-08-01)
Status pass from an ADR audit. No decision and no behavior changed; the one item the previous
revision left open is closed, and the anchor that revision itself introduced had already moved.

1. **The served fingerprint is no longer a placeholder.**
   `AppAssociation:AndroidCertFingerprints` now holds the production Play App Signing SHA-256
   fingerprint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:29`), set by MMCA.ADC
   commit `d5fd0e9` (PR #80, merged 2026-07-28), which landed after the previous revision was
   written on the same day. The mapper still serializes that array straight into
   `sha256_cert_fingerprints`
   (`Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:63`), so the
   served `assetlinks.json` now names a real certificate and nothing in the ADC deep-link wave is
   outstanding. One companion document lags the code: the rotation procedure in
   `MMCA.ADC/Docs/MobileReleaseRunbook.md:32` still describes the checked-in value as a placeholder.
2. **`Program.cs` anchor correction.** The same commit inserted a four-line comment above the
   `AndroidPackageName` assignment (explaining that the Release Android head overrides
   `ApplicationId`, so that is the package Digital Asset Links must name), which pushed the options
   initializer down. `AndroidCertFingerprints` is now at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:167`, not `:162`, and `:162` is still one
   line of that comment. The `MapAppAssociationEndpoints` call site is at `:160`. (Both anchors sat
   one line earlier when this entry was written; a later commit shifted them, see the 2026-08-07
   entry.)

## Revision (2026-08-07)
Anchor and precision pass from an ADR audit. No decision and no behavior changed.

1. **The two `Program.cs` anchors moved one line.** MMCA.ADC commit `886fa189` (PR #100, merged
   2026-08-03, DataProtection plus client idempotency keys) inserted a line above the association
   block. `app.MapAppAssociationEndpoints(new AppAssociationOptions` is now at
   `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:169` (`:168` is the preceding
   `GetSection("AppAssociation")` line), and `AndroidCertFingerprints` is at `:176`, with
   `AndroidPackageName` at `:175` and the four-line comment from the 2026-08-01 entry at `:171-174`.
   Every citation of those two anchors is updated above, the ones inside the earlier revisions
   included.
2. **The hostname trade-off names its three occurrences.** The bullet said every occurrence "stays
   parameterized", which reads as if the host were configurable everywhere. It is not: the string
   occurs three times in the ADC repo and only one of them is read through configuration
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/appsettings.json:22`). The other two are compile-time
   literals the platforms require: `Platforms/iOS/Entitlements.plist:11` and the `PublicWebHost`
   constant at `Platforms/Android/MainActivity.cs:31`. All three ship inside the binary, so the
   resubmission cost the bullet warns about is unchanged; what changed is the description of the
   edit. The in-code comment at `MainActivity.cs:29-30` still calls the cutover a two-spot change,
   which is a documentation lag in MMCA.ADC, not a behavior difference.
