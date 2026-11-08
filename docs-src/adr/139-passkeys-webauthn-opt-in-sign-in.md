# ADR-139: Passkeys (WebAuthn) as an Opt-In Sign-In and Second Factor

## Status
Accepted (2026-11-08). Ships in MMCA.Common v1.281.0 as a new package, `MMCA.Common.Passkeys`
(the package list and count are owned by `MMCA.Common/FACTS.md`). Off unless the host calls
`AddPasskeys` and sets `Passkeys:Enabled`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Passkeys/PasskeySettings.cs:24-25`, default
false).

## Context
A password plus a TOTP code is phishable: a convincing proxy page collects both and replays them
within the code's window. The only passwordless path the framework offered was the emailed sign-in
link ([ADR-116](116-identity-completions-opt-in.md), item 14), which is as strong as the mailbox.
Nothing in MMCA.Common spoke WebAuthn.

Five forces shaped the decision:

- **The token path already has one choke point.** Every interactive sign-in mints through
  `AuthenticationServiceBase.IssueTokensAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:627-646`), which
  opens a refresh session ([ADR-097](097-multi-device-refresh-sessions.md)). A new sign-in method that
  goes through it inherits sessions, sign-in history and revocation with no second path.
- **The second-factor claim already exists.** `mfa` is an amr-style claim whose presence is the
  assertion and whose value names the method (`otp`, `recovery`;
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:49-69`), and a refresh carries it
  over (`AuthenticationServiceBase.cs:391-396`).
- **WebAuthn verification is security-critical parsing.** Attestation and assertion verification means
  CBOR, COSE keys, signature formats and origin binding. The maintained .NET library for it,
  Fido2NetLib, pulls `NSec.Cryptography` and the native libsodium.
- **Native code stays out of the core.** [ADR-134](134-cloud-neutral-core-vendor-adapters.md) keeps
  third-party SDKs in adapter packages a host opts into, and every consumer references
  Infrastructure, so a dependency there ships in every host whether or not it uses passkeys.
- **Common has no user entity.** The user row is the app's ([ADR-116](116-identity-completions-opt-in.md)),
  so a credential table owned by the framework has to key on the user id alone and ask the app
  whatever it needs to know about the account.

## Decision
**Passkeys are a framework opt-in: WebAuthn verification lives in its own package, credentials in a
gated framework table, and a passkey sign-in mints the normal token pair with `mfa=passkey`.
Registering a passkey needs an interactive sign-in under ten minutes old, judged by a new `auth_time`
claim. Web heads only.**

1. **One package holds the WebAuthn library, behind a core contract.** `MMCA.Common.Passkeys`
   references Application and the `Fido2` package and nothing else
   (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/MMCA.Common.Passkeys.csproj:7-13`), pinned exactly at
   4.3.2 (`MMCA.Common/Directory.Packages.props:103`). It supplies the internal
   `Fido2PasskeyCeremony` behind the core `IPasskeyCeremony`
   (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/Fido2PasskeyCeremony.cs:17`). Two gates keep the
   boundary true:
   - **Build time.** `EnforcePasskeysBoundary` fails any other `MMCA.Common.*` project that references
     `MMCA.Common.Passkeys` or declares a `Fido2`, `NSec` or `libsodium` package reference
     (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:157-180`).
   - **Test time.** `PasskeysIsolationTests` asserts that no core layer, nor Aspire, the testing
     packages or the MCP package, names a type from `MMCA.Common.Passkeys`, `Fido2NetLib` or `NSec`,
     or references an assembly with those prefixes or `libsodium`
     (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Passkeys/PasskeysIsolationTests.cs:14-25`,
     `:29-50`).
2. **One call registers it.** `services.AddPasskeys(configuration)` binds the `Passkeys` section with
   `ValidateOnStart` and a validator that names a missing key, and registers the ceremony, the
   challenge store and `IPasskeyService`
   (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeysServiceCollectionExtensions.cs:37-56`). The
   section carries `Enabled`, `RelyingPartyId`, `RelyingPartyName`, `Origins` and `DataSourceName`
   (`PasskeySettings.cs:24-46`).
3. **A startup tripwire catches the silent half-configuration.** `Passkeys:Enabled` true with no
   `IPasskeyCeremony` registered fails startup naming the package and the call
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:42`,
   `:64-69`), the same check native push already had, because without it every passkey route would
   answer 404 and nothing would say why.
4. **Credentials live in a gated, hard-deleted framework table.** `PasskeyCredential` is flat
   bookkeeping beside `RefreshSession`: no audit stamps, no soft-delete flag, deleted outright
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/PasskeyCredential.cs:8-14`); the EF store removes
   the row (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFPasskeyCredentialStore.cs:74-78`).
   Nothing in the row is secret (`PasskeyCredential.cs:15-18`). `PasskeyCredentials` is mapped only
   while `Passkeys:Enabled` is true and only on the source `Passkeys:DataSourceName` names
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:514-517`,
   `:1038-1040`), the view-as grants shape; `DesignTimeDbContextOptions.EnablePasskeys` opens the
   same gate for `dotnet ef`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:129`).
5. **Challenges are single-use, five minutes, in the shared store.** `PasskeyChallenges.IssueAsync`
   stores the issued options under a random 32-hex flow id for `Lifetime` (5 minutes), and
   `RedeemAsync` reads and burns the entry inside `lock:passkeys:challenge:{flowId}`, reading the
   shared store so a flow burned on one replica misses on every other
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Passkeys/PasskeyChallenges.cs:24`, `:38-47`,
   `:56-83`), the OAuth exchange-code pattern ([ADR-036](036-external-oauth-login.md)).
6. **The signature counter must advance.** `PasskeyCredential.IsSignCountAcceptable` admits a counter
   above the stored one, or zero on both sides (an authenticator that does not count, which synced
   passkeys are); anything else is a cloned key and `RecordUse` refuses it
   (`PasskeyCredential.cs:114-146`). `PasskeyService` applies the rule itself as well as through the
   library, so it does not depend on the library's own check
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Passkeys/PasskeyService.cs:264-271`).
7. **A passkey sign-in is a normal sign-in with `mfa=passkey`.**
   `AuthenticationServiceBase.SignInWithPasskeyAsync` runs the app's login-candidate check, sets the
   method to `AuthClaimTypes.MultiFactorMethodPasskey` and mints through `IssueTokensAsync`
   (`AuthenticationServiceBase.cs:549-578`; `AuthClaimTypes.cs:71-76`), so the token pair, the refresh
   session and the sign-in history are the ones every other sign-in produces. A passkey is
   possession plus the authenticator's own user verification, so it satisfies the second factor
   itself. Failures answer one vague `AssertionFailed` to the caller and log the specific reason as a
   Warning with no key material (`PasskeyService.cs:18-24`, `:277-281`).
8. **Registration needs a recent interactive sign-in, judged by `auth_time`.** Every interactive
   sign-in that opens a session stamps `auth_time` (Unix seconds), and a refresh carries it UNCHANGED
   (`AuthClaimTypes.cs:78-91`; `AuthenticationServiceBase.cs:398-401`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:173-190`).
   `PasskeyStepUp.IsSatisfiedBy` admits a caller whose `auth_time` is at most `MaxSignInAge` (10
   minutes) old; a token with no `auth_time` never qualifies
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Passkeys/PasskeyStepUp.cs:6-30`). Both
   registration actions check it
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Passkeys/PasskeysControllerBase.cs:81`,
   `:132`). This is stricter than "a token under 10 minutes old, or one that carries `mfa`": both of
   those ride every refresh (a refresh resets `iat` and carries `mfa` over), so either would let a
   stolen refresh token keep a session fresh enough to plant its own passkey indefinitely
   (`PasskeyStepUp.cs:10-15`).
9. **The controller base.** `PasskeysControllerBase` (abstract; the app routes it at `auth/passkeys`)
   serves `register/options` and `register` for a signed-in caller, `GET`, `PATCH {id}` and
   `DELETE {id}`, and anonymous `signin/options` and `signin` on the `auth-ip` rate-limit policy with
   discoverable credentials (`PasskeysControllerBase.cs:41`, `:62-64`, `:110-112`, `:144-145`,
   `:170-171`, `:204-205`, `:229-232`, `:254-257`). Every action answers 404 while passkeys are
   disabled (`:54`). The last passkey can be deleted only while the account still has a password or
   an external login, under a per-account lock so two concurrent deletes cannot both see "one more
   remains" (`PasskeyService.cs:153-179`; `PasskeyChallenges.cs:92-94`); the app answers the external
   half by overriding `HasExternalLoginAsync` (`AuthenticationServiceBase.cs:586-610`, default false).
10. **One more token-issuing proxy path.** `auth/passkeys/signin` joins the same-origin proxy's
    default token-issuing paths
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:33`,
    [ADR-131](131-same-origin-api-proxy.md)).
11. **Web only.** `IPasskeyCapability` defaults to `UnavailablePasskeyCapability`, so a MAUI head
    hides the passkey button and the add-passkey action; `AddBrowserDeviceCapabilities` swaps in the
    browser implementation over `passkeys.js`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:57-59`,
    `:113-114`). The login page offers passkeys only when `SignIn:OfferPasskeys` is true and the
    capability is available (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor.cs:101-106`),
    and browser autofill asks for a challenge only where conditional mediation is available
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/passkeys.js:137-143`).
12. **Service accounts never sign in with a passkey.** `SignInWithPasskeyAsync` treats an account
    whose `IAuthUser.IsServiceAccount` is true as vanished (`AuthenticationServiceBase.cs:555-561`;
    [ADR-140](140-machine-clients-oauth-client-credentials.md)).

## Rationale
- **A library over hand-rolled verification.** The parsing is where WebAuthn implementations fail, and
  a maintained library with its own conformance work is the cheaper and safer owner of it.
- **A separate package keeps native code where ADR-134 puts vendor code.** A host that does not
  reference `MMCA.Common.Passkeys` restores no Fido2, NSec or libsodium, and the core layers stay
  free of a native dependency; the two gates make that a build failure rather than a review comment.
- **The existing choke point and claim.** Minting through `IssueTokensAsync` with a new `mfa` value
  means sessions, sign-in history, revocation and every `IRequiresMfa` use case treat a passkey sign-in
  correctly with no change.
- **`auth_time` measures the thing that matters.** "Recently signed in" is a property of the sign-in,
  not of the access token; the claim that survives a refresh unchanged is the only one that cannot be
  kept fresh by refreshing.
- **Hard delete matches the meaning.** A removed passkey must never sign in again; a soft-deleted row
  is one query-filter mistake from doing so, and the row is a public key, not an audit record.

## Trade-offs
- **A new third-party dependency in the auth path,** with a native library behind it. Mitigated by the
  exact pin, the package boundary and the fact that a host opts in by reference.
- **Passkeys are bound to the relying party id.** A credential registered under one
  `Passkeys:RelyingPartyId` is never offered for another, so a later domain change orphans every
  passkey (`PasskeySettings.cs:13-17`). The production domain has to be settled before the feature
  is turned on.
- **One gated table migration where enabled,** on the Identity database only.
- **Login protection does not meter passkey failures by account.** Login protection is keyed by email,
  which a discoverable sign-in does not carry before the assertion, so failures are metered per IP by
  the `auth-ip` policy and logged as Warnings instead (`PasskeyService.cs:19-24`).
- **A token minted before the claim shipped cannot register a passkey** until its holder signs in
  again, because it has no `auth_time`.
- **An app with external logins must override `HasExternalLoginAsync`,** or the last-passkey rule
  ignores the external login and refuses a delete it could allow.

## Alternatives rejected
- **Writing CBOR/COSE attestation and assertion verification ourselves** (2026-11-08). A
  security-critical parser for no gain over a maintained library.
- **ASP.NET Core Identity's passkey support** (2026-11-08). It is built on Identity's `UserManager`
  and stores, which MMCA.Common does not use; the user row is the app's.
- **Fido2NetLib inside `MMCA.Common.Infrastructure`** (2026-11-08). Every host references
  Infrastructure, so every host would carry NSec and the native libsodium whether it offers passkeys
  or not.
- **Judging registration by token age, or by the presence of `mfa`** (2026-11-08). Both survive a
  refresh, so a stolen refresh token could keep either satisfied forever; `auth_time` cannot be
  refreshed.
- **A sign-in method column on `RefreshSession`** (2026-11-08). It would be a migration in every
  consumer's Identity database for a fact the token's `mfa` value already carries.
- **MAUI native passkeys now** (2026-11-08). Credential Manager on Android, associated domains on iOS
  and asset links for a need no user has raised. Recorded in the *Enterprise-scale register* of
  [the Common backlog](../governance/common-RemediationBacklog.md). **Revisit:** mobile users asking
  for passkeys, or a store-review requirement.

## Consequences
- A host opts in by referencing `MMCA.Common.Passkeys` from its Identity service, calling
  `AddPasskeys`, setting the RP id, name and origins, adding the `PasskeyCredentials` migration with
  `EnablePasskeys`, routing a `PasskeysControllerBase` subclass, setting `SignIn:OfferPasskeys` and
  placing `PasskeysPanel` on the profile page (`MMCA.Common/UPGRADING.md:54-70`).
- MMCA.ADC ships the code path off: it overrides `HasExternalLoginAsync` but adds no migration, no
  configuration and no UI wiring, pending a decision on its production domain (recorded in
  [the ADC backlog](../governance/adc-RemediationBacklog.md)). Store and Helpdesk leave it off.
- `MMCA.Common/FACTS.md` lists the new package.

## Related
[ADR-036](036-external-oauth-login.md) (the exchange-code burn the challenge store copies),
[ADR-050](050-jwt-refresh-token-rotation.md) (the rotation that carries `mfa` and `auth_time`),
[ADR-097](097-multi-device-refresh-sessions.md) (the sessions a passkey sign-in opens),
[ADR-116](116-identity-completions-opt-in.md) (the opt-in shape and the second factor this complements),
[ADR-131](131-same-origin-api-proxy.md) (the token-issuing proxy list),
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) (the adapter-package shape),
[ADR-140](140-machine-clients-oauth-client-credentials.md) (the service accounts this refuses).
