# ADR-050: JWT Access Tokens with a Single Rotating Refresh Token and Reuse Detection

## Status
**Superseded by [ADR-097](097-multi-device-refresh-sessions.md) (2026-09-01).** Originally Accepted
(2026-07-21, storage model recorded as superseded 2026-08-26). The body below is retained as the
historical record (its citations refreshed to current line anchors) of the rotation, reuse-detection
and sliding-expiry policy this record decided, which ADR-097 keeps and generalizes to a per-user family
of per-device sessions hashed at rest; read ADR-097 for what ships today. Its storage, revocation,
claim and single-session details no longer describe the code: refresh tokens are gone from `IAuthUser`
(`Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`), `UpdateRefreshToken` and
`RevokeRefreshToken` no longer exist under any `Source/` tree (the names survive only on a Common test
double, `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:76,82`),
the user id rides the standard `sub` claim rather than a `user_id` claim
(`Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:87-90,93`), the one-token-per-user model
is replaced by a per-user family of per-device sessions
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:39-49`), and neither app revokes
refresh sessions on account deactivation or erasure
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:334-350`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:185-192`).

Note (2026-09-03): the body bullet on account deactivation and erasure described shipped code when this
record was written (ADC revoked in `Delete()` and `Anonymize()`, Store in `Deactivate()` and
`Anonymize()`), and stopped describing it on 2026-08-26, when the refresh-sessions sweep removed the
refresh-token members from both aggregates. Neither transition touches refresh state today.

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
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:53`); the app-specific claim set
and account gates stay in each app's sealed subclass (ADR-004 dual-fetch, ADR-032 hashing).

## Decision
Mint a stateless JWT access token plus a single, server-stored refresh token that rotates on every use,
with a token mismatch triggering revocation.

- **Access token is stateless; refresh token is one column on the user row.** The access token is a
  signed JWT carrying the user claims and an `exp` set from
  `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
  `Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:61`), written by
  `TokenService.GenerateAccessToken` (`Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:78`).
  The refresh token is a single nullable `RefreshToken` string plus its `RefreshTokenExpiry` on
  `IAuthUser` (both members since removed,
  `Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`), persisted on the app's `User` aggregate.
  There is exactly one stored refresh token per user, not a per-device or per-session set.
- **The refresh token is 64 random bytes, base64-encoded, opaque.** `TokenService.GenerateRefreshToken`
  draws 64 bytes from `RandomNumberGenerator.GetBytes` and base64-encodes them
  (`TokenService.cs:118-121`). It carries no claims and is meaningful only by exact match against the
  stored value.
- **Rotation on every issuance.** Both login (`AuthenticationServiceBase.cs:183`) and refresh
  (`AuthenticationServiceBase.cs:267`) route through `IssueTokensAsync`
  (`AuthenticationServiceBase.cs:474`), which mints a new access token, generates a new refresh token,
  and overwrites the stored one via `user.UpdateRefreshToken(...)` before `SaveChangesAsync`.
  Registration seeds the first refresh token the same way (`AuthenticationServiceBase.cs:263`).
  `UpdateRefreshToken` sets the token and its expiry on each app's `User` aggregate. The previous
  refresh token is therefore invalid the moment a new one is issued. (Today that overwrite is a
  successor session row claimed atomically through `IRefreshSessionStore.TryRotateAsync`,
  `AuthenticationServiceBase.cs:686`.)
- **Refresh binds to the same principal via the expired access token.** `RefreshTokenAsync` requires the
  client to present the expired access token alongside the refresh token and calls
  `TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:281`). That method
  validates issuer, audience, signing key, and the pinned algorithm but skips only the lifetime check
  (`TokenService.cs:137,145,150,159-160`), so an unsigned, wrong-audience, or algorithm-swapped token
  yields no principal and the refresh fails (`AuthenticationServiceBase.cs:282-285`). The user id claim
  from that principal selects the row whose stored refresh token is then compared
  (`AuthenticationServiceBase.cs:291,298`).
- **Sliding per-rotation expiry, from a bound setting.** Every issuance (login, refresh, and the first
  token seeded at registration) stamps the stored refresh token's expiry as now plus the
  `RefreshTokenLifetime` base property (`AuthenticationServiceBase.cs:110,635,675`), so the window restarts
  from the moment of each successful rotation rather than staying pinned to the opening login. That
  property reads the value the token service derives from `JwtSettings.RefreshTokenExpirationDays`
  (`JwtSettings.cs:64`, default 7 days) via `TokenService.RefreshTokenLifetime` (`TokenService.cs:128`),
  guarding against a non-positive configured value by falling back to the BR-205 default of 7 days
  (`AuthenticationServiceBase.cs:110,111`; interface default `ITokenService.cs:40`). A client that refreshes
  at least once inside each window therefore stays signed in indefinitely; re-login is required only after
  a full lifetime elapses with no successful refresh, or after the token is revoked.
- **Mismatch or expiry revokes the stored token.** On refresh, if the presented token does not equal the
  stored `RefreshToken`, or the stored expiry is in the past, the workflow calls
  `user.RevokeRefreshToken()` and saves before returning a 401. `RevokeRefreshToken` nulls both the
  token and its expiry on each app's `User` aggregate, so a presented token that has already been
  rotated away (the signature of reuse or theft) invalidates the current stored token as well, forcing a
  fresh password login rather than silently reissuing. (Today the equivalent rule runs against session
  rows: a presented token that lands on a revoked row revokes every live session the user holds,
  `AuthenticationServiceBase.cs:604-611`.)
- **Explicit revocation and account-state changes clear the same slot.** `RevokeTokenAsync` loads the
  user and revokes the stored token on demand (`AuthenticationServiceBase.cs:336`). Both apps also
  revoked on account deactivation and erasure, so those transitions immediately ended the refresh chain:
  ADC in `Delete()` and `Anonymize()`, Store in `Deactivate()` and `Anonymize()`. That half stopped
  applying on 2026-08-26 (see the Status note): those methods leave refresh state untouched today
  (ADC `MMCA.ADC/.../Identity.Domain/Users/User.cs:334-341,363`, Store
  `MMCA.Store/.../Identity.Domain/Users/User.cs:185-192,216`).
- **Both apps inherit the workflow through a sealed subclass.** ADC's `AuthenticationService`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:46`,
  forwarded to the base at `AuthenticationService.cs:56`) and Store's
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:22`,
  forwarded at `AuthenticationService.cs:31`) both pass `ITokenService` into the base constructor and
  supply only app-specific hooks (the claim set, deactivated-account gates, the registration side-effect);
  both constructors also take `IRefreshSessionStore` and `IOptions<RefreshSessionSettings>` today (ADC
  `AuthenticationService.cs:54,55`, Store `AuthenticationService.cs:29,30`).
  The rotation, reuse-detection, and lifetime logic is identical across both apps because it lives once in
  the base. ADC's external OAuth path (ADR-036) issues the same refresh credential when it exchanges an
  external identity for the local token pair, by routing into the shared `IssueTokensAsync`
  (`AuthenticationService.cs:270`).

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
- **Rotation plus a sliding inactivity window, not an absolute cap.** Because the expiry is re-stamped on
  every rotation (`AuthenticationServiceBase.cs:635,675`), an actively refreshing client is never forced onto
  a fixed re-authentication schedule; the window bounds inactivity instead, lapsing a chain that goes a
  full lifetime with no successful refresh. There is deliberately no absolute session cap: rotation (each
  refresh invalidates its predecessor) and reuse-detection revocation are the backstops that make a
  captured chain self-limiting.
- **One workflow, app-specific edges.** Putting issuance, rotation, and reuse detection in the shared base
  means a future hardening (shorter lifetime, a per-device token table, a different reuse response) is one
  edit both apps inherit, while the claim set and account gates stay in each subclass.

## Trade-offs
- **One refresh token per user means one live session.** A new login overwrites the single stored token,
  so signing in on a second device invalidates the first device's refresh chain; the first device's next
  refresh mismatches and is revoked. Concurrent multi-device sessions that each keep their own refresh
  token are not supported by this model. A per-device or per-session token table would be required for
  that, and is deliberately out of scope here.
- **Reuse detection is aggressive by design.** A benign race (two client tabs refreshing near-simultaneously,
  the second presenting the just-rotated-away token) is indistinguishable from theft, so it revokes the
  stored token and forces a re-login. The safety of failing closed is chosen over the convenience of a
  short reuse grace window.
- **The refresh token is server-side state.** Unlike the fully stateless access token, the refresh token
  is a column that must be written on every login and every refresh, so the refresh path always incurs
  a write to the Identity database; it is not a stateless operation.
- **No absolute session cap.** Because the refresh lifetime is re-stamped on every rotation
  (`AuthenticationServiceBase.cs:635,675`), the configured window (seven days by default) bounds inactivity,
  not total session age: a continuously active client that refreshes at least once per window stays signed
  in indefinitely without re-entering a password. The flip side is exposure: a captured refresh-token
  chain that keeps refreshing never lapses on its own, so rotation (each refresh invalidates its
  predecessor) and reuse-detection revocation are the only backstops that end it. An absolute cap anchored
  to the opening login would bound that exposure but is deliberately not imposed here.
- **A non-positive configured lifetime falls back silently.** Since 2026-07-21 the refresh lifetime is
  honored from configuration: `RefreshTokenLifetime` (`AuthenticationServiceBase.cs:110,111`) applies the
  value `TokenService` derives from `JwtSettings.RefreshTokenExpirationDays` (`TokenService.cs:128`;
  `JwtSettings.cs:64`). The guard treats a non-positive configured value (a zero or negative
  `RefreshTokenExpirationDays`, or a hand-written test double reporting `TimeSpan.Zero` via the interface
  default at `ITokenService.cs:40`) as absent and falls back to the BR-205 seven-day default rather than
  failing startup, so a misconfiguration silently reverts to the baseline instead of surfacing an error.

## Related
ADR-004 (the stateless RS256/JWKS access token this refresh flow reissues, and the algorithm pinning
`GetPrincipalFromExpiredToken` relies on), ADR-032 (the password hashing that gates the login which opens
a refresh session, sharing the same `AuthenticationServiceBase<TUser>`), ADR-036 (the external OAuth path
that exchanges a federated identity for this same single rotating refresh token), ADR-047 (the
soft-deleted-user middleware that bounds the stateless access token's revocation gap, complementing the
refresh-token revocation this ADR performs on the user row).
