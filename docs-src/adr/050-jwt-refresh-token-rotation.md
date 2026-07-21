# ADR-050: JWT Access Tokens with a Single Rotating Refresh Token and Reuse Detection

## Status
Accepted (2026-07-21).

## Context
Identity issues two credentials on every successful sign-in: a short-lived, stateless JWT access
token that every service validates by signature and expiry (ADR-004), and a long-lived refresh token
the client presents to obtain a fresh access token without re-entering a password. The framework needs
one canonical issuance-and-rotation workflow so the token lifetime, the rotation rule, and the
reuse-detection response are decided once and inherited by every consuming Identity module, rather than
re-implemented per app.

Two forces shape the model. A stateless access token cannot be revoked before it expires, so its
lifetime must stay short to bound exposure, which in turn makes a refresh token necessary for a usable
session. And a refresh token is a bearer credential with a long life: if it is captured, replay must be
detectable and answerable. The workflow lives once in `AuthenticationServiceBase<TUser>`
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34`); the app-specific claim set
and account gates stay in each app's sealed subclass (ADR-004 dual-fetch, ADR-032 hashing).

## Decision
Mint a stateless JWT access token plus a single, server-stored refresh token that rotates on every use,
with a token mismatch triggering revocation.

- **Access token is stateless; refresh token is one column on the user row.** The access token is a
  signed JWT carrying the user claims and an `exp` set from
  `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
  `Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:42`), written by
  `TokenService.GenerateAccessToken` (`Source/Core/MMCA.Common.Infrastructure/Services/TokenService.cs:97`).
  The refresh token is a single nullable `RefreshToken` string plus its `RefreshTokenExpiry`
  (`Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:20,24`), persisted on the app's `User` aggregate.
  There is exactly one stored refresh token per user, not a per-device or per-session set.
- **The refresh token is 64 random bytes, base64-encoded, opaque.** `TokenService.GenerateRefreshToken`
  draws 64 bytes from `RandomNumberGenerator.GetBytes` and base64-encodes them
  (`TokenService.cs:104,106,107`). It carries no claims and is meaningful only by exact match against the
  stored value.
- **Rotation on every issuance.** Both login and refresh route through `IssueTokensAsync`, which mints a
  new access token, generates a new refresh token, and overwrites the stored one via
  `user.UpdateRefreshToken(...)` before `SaveChangesAsync`
  (`AuthenticationServiceBase.cs:254,258,259,260,262`). Registration seeds the first refresh token the
  same way (`AuthenticationServiceBase.cs:158,159`). `UpdateRefreshToken` sets the token and its expiry
  (`IAuthUser.cs:27`; ADC `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:234,236,237`,
  Store `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:129,131,132`). The
  previous refresh token is therefore invalid the moment a new one is issued.
- **Refresh binds to the same principal via the expired access token.** `RefreshTokenAsync` requires the
  client to present the expired access token alongside the refresh token and calls
  `TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:180,192`). That method
  validates issuer, audience, signing key, and the pinned algorithm but skips only the lifetime check
  (`TokenService.cs:117,121,122,123,125,130`), so an unsigned, wrong-audience, or algorithm-swapped token
  yields no principal and the refresh fails (`AuthenticationServiceBase.cs:193-197`). The `user_id` claim
  from that principal selects the row whose stored refresh token is then compared
  (`AuthenticationServiceBase.cs:199,206`).
- **Absolute lifetime, not sliding.** The stored refresh token's expiry is stamped as now plus the
  `RefreshTokenLifetime` base property, `TimeSpan.FromDays(7)`
  (`AuthenticationServiceBase.cs:60,159,260`). Because that absolute expiry is copied forward unchanged on
  each rotation from the original issuance clock read, a session cannot be extended past seven days by
  refreshing: the window is fixed from the login that opened it, and re-login is required when it lapses.
  (`JwtSettings.RefreshTokenExpirationDays` at `JwtSettings.cs:45` is a bound setting but is not the value
  applied here; the applied lifetime is the base property.)
- **Mismatch or expiry revokes the stored token.** On refresh, if the presented token does not equal the
  stored `RefreshToken`, or the stored expiry is in the past, the workflow calls
  `user.RevokeRefreshToken()` and saves before returning a 401
  (`AuthenticationServiceBase.cs:221,223,224,227`). `RevokeRefreshToken` nulls both the token and its
  expiry (`IAuthUser.cs:30`; ADC `User.cs:243,245,246`, Store `User.cs:139,141,142`), so a presented
  token that has already been rotated away (the signature of reuse or theft) invalidates the current
  stored token as well, forcing a fresh password login rather than silently reissuing.
- **Explicit revocation and account-state changes clear the same slot.** `RevokeTokenAsync` loads the
  user and revokes the stored token on demand (`AuthenticationServiceBase.cs:234,244,245`). Both apps also
  revoke on account deactivation and erasure, so those transitions immediately end the refresh chain: ADC
  in `Delete()` and `Anonymize()` (`MMCA.ADC/.../Identity.Domain/Users/User.cs:350,403`), Store in
  `Deactivate()` and `Anonymize()` (`MMCA.Store/.../Identity.Domain/Users/User.cs:217,249`).
- **Both apps inherit the workflow through a sealed subclass.** ADC's `AuthenticationService`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35`,
  forwarded to the base at `AuthenticationService.cs:43`) and Store's
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:20`,
  forwarded at `AuthenticationService.cs:27`) both pass `ITokenService` into the base constructor and
  supply only app-specific hooks (the claim set, deactivated-account gates, the registration side-effect).
  The rotation, reuse-detection, and lifetime logic is identical across both apps because it lives once in
  the base. ADC's external OAuth path (ADR-036) issues the same single rotating refresh token when it
  exchanges an external identity for the local token pair (`AuthenticationService.cs:202,203`).

## Rationale
- **Short access token plus refresh keeps the hot path stateless.** Every service validates the access
  token with no store lookup (ADR-004); the short `exp` bounds the revocation gap, and the refresh token
  is the one place a database round trip is paid, only when the access token has already expired.
- **Rotation makes theft self-limiting.** Because each refresh invalidates the prior refresh token, a
  stolen token is useful for at most one rotation; the legitimate client's next refresh then presents a
  token that no longer matches, which surfaces the compromise instead of letting two parties refresh
  indefinitely from the same secret.
- **Revoke-on-mismatch turns a silent replay into a forced re-login.** Treating any mismatch as reuse and
  clearing the stored token means a captured-and-replayed refresh cannot quietly mint tokens; it ends the
  session for everyone holding that token and requires a password to reopen it.
- **Absolute lifetime caps a long-lived credential.** A sliding window would let an active session live
  forever on refreshes alone. Anchoring expiry to the opening login guarantees the refresh credential
  cannot outlive a fixed seven-day bound without re-authentication.
- **One workflow, app-specific edges.** Putting issuance, rotation, and reuse detection in the shared base
  means a future hardening (shorter lifetime, a per-device token table, a different reuse response) is one
  edit both apps inherit, while the claim set and account gates stay in each subclass.

## Trade-offs
- **One refresh token per user means one live session.** A new login overwrites the single stored token
  (`AuthenticationServiceBase.cs:260`), so signing in on a second device invalidates the first device's
  refresh chain; the first device's next refresh mismatches and is revoked. Concurrent multi-device
  sessions that each keep their own refresh token are not supported by this model. A per-device or
  per-session token table would be required for that, and is deliberately out of scope here.
- **Reuse detection is aggressive by design.** A benign race (two client tabs refreshing near-simultaneously,
  the second presenting the just-rotated-away token) is indistinguishable from theft, so it revokes the
  stored token and forces a re-login. The safety of failing closed is chosen over the convenience of a
  short reuse grace window.
- **The refresh token is server-side state.** Unlike the fully stateless access token, the refresh token
  is a column that must be written on every login and every refresh (`AuthenticationServiceBase.cs:262`),
  so the refresh path always incurs a write to the Identity database; it is not a stateless operation.
- **Weekly re-login is mandatory.** The absolute seven-day lifetime
  (`AuthenticationServiceBase.cs:60`) means even a continuously active user must re-authenticate at least
  weekly. Lengthening it widens the exposure of a captured refresh token; the seven-day value is the
  chosen balance and is a base property, not a per-host appsetting.
- **The bound refresh setting is not the applied one.** `JwtSettings.RefreshTokenExpirationDays`
  (`JwtSettings.cs:45`) exists and binds, but the lifetime actually applied comes from the
  `RefreshTokenLifetime` base property (`AuthenticationServiceBase.cs:60`); an operator changing the
  config value would not change the refresh lifetime, which is a latent point of confusion to be aware of.

## Related
ADR-004 (the stateless RS256/JWKS access token this refresh flow reissues, and the algorithm pinning
`GetPrincipalFromExpiredToken` relies on), ADR-032 (the password hashing that gates the login which opens
a refresh session, sharing the same `AuthenticationServiceBase<TUser>`), ADR-036 (the external OAuth path
that exchanges a federated identity for this same single rotating refresh token), ADR-047 (the
soft-deleted-user middleware that bounds the stateless access token's revocation gap, complementing the
refresh-token revocation this ADR performs on the user row).
