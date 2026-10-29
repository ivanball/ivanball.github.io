# ADR-050: JWT Access Tokens with a Single Rotating Refresh Token and Reuse Detection

## Status
**Superseded by [ADR-097](097-multi-device-refresh-sessions.md) (2026-09-01).** Originally Accepted
(2026-07-21, storage model recorded as superseded 2026-08-26). Revised 2026-10-01: three statements corrected
against source. Revised 2026-10-06: the body's "Today" citations now point at `AuthSessionIssuer`, where
the refresh workflow's rotation, reuse revocation and lifetime guard live. Revised 2026-10-07: the
body's "Today" parentheticals now record the rotation grace window, under which a token rotated moments
ago is answered 409 with nothing revoked instead of revoking the user's sessions, and the
`AuthSessionIssuer` anchors are refreshed. The
body below is retained as the historical record (its present-tense citations re-verified against
current source on 2026-10-07) of the rotation, reuse-detection
and sliding-expiry policy this record decided, which ADR-097 keeps and generalizes to a per-user family
of per-device sessions hashed at rest; read ADR-097 for what ships today. Its storage, revocation,
claim and single-session details no longer describe the code: refresh tokens are gone from `IAuthUser`
(`Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`), `UpdateRefreshToken` and
`RevokeRefreshToken` are gone from that interface and from both app `User` aggregates, so no production
type declares them; neither Domain analyzer ledger mentions them any more (the unshipped ledger holds
only `#nullable enable`, `Source/Core/MMCA.Common.Domain/PublicAPI.Unshipped.txt:1`, and the shipped
`IAuthUser` entries list only `PasswordHash` and `PasswordSalt`, `PublicAPI.Shipped.txt:16-18`), so the
removal record survives only in Common's changelog (`MMCA.Common/CHANGELOG.md:3623`). The only callable copies left are on a
Common test double
(`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:83,89`), which is
not dead code: `DeleteUserHandlerBaseTests.cs:81` still calls `UpdateRefreshToken` on it. Beyond that,
the user id rides the standard `sub` claim rather than a `user_id` claim
(`Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:116`), the one-token-per-user model
is replaced by a per-user family of per-device sessions
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:40-52`), and revocation on an
account-state change moved out of the aggregates into each app's user-administration service: locking
an account (Store's lock is its `IsActive` deactivation) and changing its role both revoke every live
refresh session (ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Administration/UserAdministrationService.cs:85`
and `:139`, Store
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Administration/UserAdministrationService.cs:82`
and `:134`), while the aggregate transitions themselves carry no refresh state (ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:523`, `:545`, Store
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:229`, `:328`).
Revised 2026-10-21: anchors refreshed after the `AuthSessionIssuer`, `JwtSettings`, changelog and
user-administration code moved; behavior and defaults are unchanged. Revised 2026-10-26: a token
presented on a row already revoked as `ReuseDetected` now fails that request alone instead of
revoking the user's live sessions again (Common #612, v1.261.0); anchors refreshed. Revised
2026-10-28: a zero or negative `RefreshTokenExpirationDays` now fails host startup instead of
silently reverting to the seven-day default (Common v1.247.0), so the Trade-offs bullet and the
Decision's sliding-expiry bullet are corrected; the changelog removal anchor is refreshed.

Note (2026-09-03): the body bullet on account deactivation and erasure described shipped code when this
record was written (ADC revoked in `Delete()` and `Anonymize()`, Store in `Deactivate()` and
`Anonymize()`), and stopped describing it on 2026-08-26, when the refresh-sessions sweep removed the
refresh-token members from both aggregates. Neither aggregate transition touches refresh state today;
the administrative lock and role change do, from the application layer (see the Status paragraph
above).

Note (2026-09-19): three content corrections re-verified against current source, with the body's other
line anchors left as they stood. The removed `UpdateRefreshToken` and `RevokeRefreshToken` are recorded
in Common's analyzer ledgers and are still called from a Common test, not merely surviving on a test
double; `RefreshTokenAsync` no longer routes through `IssueTokensAsync`, which within the base now has only
login and registration as callers (ADC's external-login path also calls it, see the Decision); and the constructor wiring of each app's subclass was re-read (its current
shape is recorded in the 2026-09-25 note below).

Note (2026-09-25): four corrections re-verified against current source. Both apps' subclass
constructors then took `IOptions<RefreshSessionSettings>` directly and forwarded it unchanged to the base
(ADC `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:57`,
forwarded at `:67`; Store
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:33`,
forwarded at `:43`). Account lock and role change revoke live refresh sessions in both apps (Status
paragraph above). The refresh workflow was then not identical across the two apps in one respect: Store
alone overrode `CreateRefreshUserMissingError` to answer a vanished user with 404, where ADC kept the
base's 401. That difference is gone: see Revision (2026-10-06) at the end.
The Common anchors for the class, the lifetime guard, the sliding expiry, the atomic rotation and
the reuse revocation are refreshed in the body.

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
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:67`); the app-specific claim set
and account gates stay in each app's sealed subclass (ADR-004 dual-fetch, ADR-032 hashing).

## Decision
Mint a stateless JWT access token plus a single, server-stored refresh token that rotates on every use,
with a token mismatch triggering revocation.

- **Access token is stateless; refresh token is one column on the user row.** The access token is a
  signed JWT carrying the user claims and an `exp` set from
  `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
  `Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:66`), written by
  `TokenService.GenerateAccessToken` (`Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:101`).
  The refresh token is a single nullable `RefreshToken` string plus its `RefreshTokenExpiry` on
  `IAuthUser` (both members since removed,
  `Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`), persisted on the app's `User` aggregate.
  There is exactly one stored refresh token per user, not a per-device or per-session set.
- **The refresh token is 64 random bytes, base64-encoded, opaque.** `TokenService.GenerateRefreshToken`
  draws 64 bytes from `RandomNumberGenerator.GetBytes` and base64-encodes them
  (`TokenService.cs:155-159`). It carries no claims and is meaningful only by exact match against the
  stored value.
- **Rotation on every issuance.** Both login (`AuthenticationServiceBase.cs:183`) and refresh
  (`AuthenticationServiceBase.cs:267`) routed through `IssueTokensAsync`
  (`AuthenticationServiceBase.cs:474`), which mints a new access token, generates a new refresh token,
  and overwrites the stored one via `user.UpdateRefreshToken(...)` before `SaveChangesAsync`.
  Registration seeds the first refresh token the same way (`AuthenticationServiceBase.cs:263`).
  `UpdateRefreshToken` sets the token and its expiry on each app's `User` aggregate. The previous
  refresh token is therefore invalid the moment a new one is issued. Today that shared entry point is
  gone from the refresh path: only login (`AuthenticationServiceBase.cs:230`) and registration
  (`AuthenticationServiceBase.cs:325`) still call `IssueTokensAsync` (body at
  `AuthenticationServiceBase.cs:463`, which delegates to `sessionIssuer.IssueAsync` at `:471`), while
  `RefreshTokenAsync` (`AuthenticationServiceBase.cs:329`) does not call it at all, delegating instead
  to `sessionIssuer.RotateAsync` (`AuthenticationServiceBase.cs:383`). That method
  (`Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:92`) runs
  `ResolveRotatableSessionAsync` (called at `AuthSessionIssuer.cs:103`, body at `:300`) and then
  `RotateSessionAsync` (called at `AuthSessionIssuer.cs:111`, body at `:396`). (Today that overwrite is a successor session row
  claimed atomically through `IRefreshSessionStore.TryRotateAsync`, called at `AuthSessionIssuer.cs:419`.)
- **Refresh binds to the same principal via the expired access token.** `RefreshTokenAsync` requires the
  client to present the expired access token alongside the refresh token and calls
  `TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:343`). That method
  validates issuer, audience, signing key, and the pinned algorithm but skips only the lifetime check
  (`TokenService.cs:178-180,182,187,196-197`), so an unsigned, wrong-audience, or algorithm-swapped token
  yields no principal and the refresh fails (`AuthenticationServiceBase.cs:344-348`). The user id claim
  from that principal (`principal.GetUserId()`, `AuthenticationServiceBase.cs:353`) selects the user
  whose stored refresh credential is then compared. (Today that compare is a lookup by token hash plus
  a user-id match, `AuthSessionIssuer.cs:311-317`.)
- **Sliding per-rotation expiry, from a bound setting.** Every issuance (login, refresh, and the first
  token seeded at registration) stamps the stored refresh token's expiry as now plus the
  `RefreshTokenLifetime` property (today private to the session issuer, `AuthSessionIssuer.cs:60`;
  stamped at `:367` when a session opens and `:409` on the rotation successor), so the window restarts
  from the moment of each successful rotation rather than staying pinned to the opening login. That
  property reads the value the token service derives from `JwtSettings.RefreshTokenExpirationDays`
  (`JwtSettings.cs:73`, default 7 days) via `TokenService.RefreshTokenLifetime` (`TokenService.cs:165`).
  A zero or negative configured value fails host startup (`[Range(1, int.MaxValue)]`,
  `JwtSettings.cs:72`), and the issuer still falls back to the BR-205 default of 7 days for a token
  service that reports a non-positive lifetime (`AuthSessionIssuer.cs:60-61`; interface default
  `ITokenService.cs:40`). A client that refreshes
  at least once inside each window therefore stays signed in indefinitely; re-login is required only after
  a full lifetime elapses with no successful refresh, or after the token is revoked.
- **Mismatch or expiry revokes the stored token.** On refresh, if the presented token does not equal the
  stored `RefreshToken`, or the stored expiry is in the past, the workflow calls
  `user.RevokeRefreshToken()` and saves before returning a 401. `RevokeRefreshToken` nulls both the
  token and its expiry on each app's `User` aggregate, so a presented token that has already been
  rotated away (the signature of reuse or theft) invalidates the current stored token as well, forcing a
  fresh password login rather than silently reissuing. (Today the equivalent rule runs against session
  rows: a presented token that lands on a row revoked as a reuse signal (guard `IsReuseSignal` at
  `AuthSessionIssuer.cs:322`, defined at `:466`) revokes every live session the user holds,
  `RevokeLiveSessionsAsync` with `ReasonReuseDetected` at `AuthSessionIssuer.cs:338`, unless the row was
  rotated within the rotation grace window (`IsWithinRotationGrace`, called at `:331`, defined at
  `:486`; `RefreshSessionSettings.ReuseGraceSeconds`, default 10,
  `Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:98`), which answers a
  `409 Conflict` `Auth.RefreshSuperseded` (`AuthSessionIssuer.cs:278-282`) with nothing revoked. A
  token that loses the atomic rotation claim branches the same three ways on a re-read of its row: lost
  to a sign-out, a cap eviction or a reuse sweep of that same row, only that request fails
  (`AuthSessionIssuer.cs:431-437`); rotated inside the grace, the 409 with nothing revoked
  (`:439-442`); otherwise the whole live family is revoked (`:447`). A row revoked by sign-out,
  sign-out-everywhere, a password change, eviction by the session cap, or already swept by an earlier
  reuse event (`ReasonReuseDetected`, excluded from `IsReuseSignal` at `AuthSessionIssuer.cs:473-475`)
  fails only that request and leaves the user's other sessions live, `AuthSessionIssuer.cs:322-329`;
  a row carrying a successor hash (`:468-471`), or revoked for any reason other than `SignedOut`,
  `SessionCapExceeded` or `ReuseDetected` (`Rotated`, `AccountDeleted` at
  `Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:70`, an unrecognized reason, or none), is a
  reuse signal.)
- **Explicit revocation and account-state changes clear the same slot.** `RevokeTokenAsync` loads the
  user and revokes the stored token on demand (today `AuthenticationServiceBase.cs:398`, delegating to
  `sessionIssuer.SignOutAsync` at `:409`). Both apps also
  revoked on account deactivation and erasure, so those transitions immediately ended the refresh chain:
  ADC in `Delete()` and `Anonymize()`, Store in `Deactivate()` and `Anonymize()`. That half stopped
  applying on 2026-08-26 (see the Status note): those methods leave refresh state untouched today
  (ADC `MMCA.ADC/.../Identity.Domain/Users/User.cs:523,545`, Store
  `MMCA.Store/.../Identity.Domain/Users/User.cs:229,328`), and the revocation on an account lock or a
  role change now runs in each app's user-administration service instead (ADC
  `UserAdministrationService.cs:85,139`, Store `UserAdministrationService.cs:82,134`).
- **Both apps inherit the workflow through a sealed subclass.** ADC's `AuthenticationService`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:50`,
  `IAuthSessionIssuer` taken at `:56` and forwarded to the base at `:64`) and Store's
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:26`,
  taken at `:31`, forwarded at `:38`) both pass `IAuthSessionIssuer` into the base constructor and
  supply only app-specific hooks (the claim set, deactivated-account gates, the registration side-effect);
  both constructors also take `IOptions<EmailConfirmationSettings>` (ADC `AuthenticationService.cs:57`,
  Store `AuthenticationService.cs:32`) and forward it to the base unchanged (ADC `:66`, Store `:40`).
  Neither takes `IRefreshSessionStore` or `IOptions<RefreshSessionSettings>`: session issuing and the
  refresh settings sit behind the framework's `IAuthSessionIssuer`.
  The rotation, reuse-detection, and lifetime logic is identical across both apps because it lives once in
  the base, with no app-level difference at the edge: neither app overrides `CreateRefreshUserMissingError`,
  so a refresh for a vanished user answers the base's 401 in both
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:620-621`,
  called at `:363`). ADC's
  external OAuth path (ADR-036) issues the same refresh credential when it exchanges an
  external identity for the local token pair, by routing into the shared `IssueTokensAsync`
  (`AuthenticationService.cs:336`).

## Rationale
- **Short access token plus refresh keeps the hot path stateless.** Every service validates the access
  token with no store lookup (ADR-004); the short `exp` bounds the revocation gap, and the refresh token
  is the one place a database round trip is paid, only when the access token has already expired.
- **Rotation makes theft self-limiting.** Because each refresh invalidates the prior refresh token, a
  stolen token is useful for at most one rotation; the legitimate client's next refresh then presents a
  token that no longer matches, which surfaces the compromise instead of letting two parties refresh
  indefinitely from the same secret. (Today that detection has a blind spot: a replay of a stolen
  token that arrives within the rotation grace window of a legitimate rotation is answered 409 with
  nothing revoked, `RefreshSessionSettings.cs:90-92`; see the Trade-offs.)
- **Revoke-on-mismatch turns a silent replay into a forced re-login.** Treating any mismatch as reuse and
  clearing the stored token means a captured-and-replayed refresh cannot quietly mint tokens; it ends the
  session for everyone holding that token and requires a password to reopen it. (Today a token
  re-presented within the rotation grace window is treated as a race rather than reuse: it is answered
  409 with nothing revoked, `AuthSessionIssuer.cs:331-336`; see the Trade-offs.)
- **Rotation plus a sliding inactivity window, not an absolute cap.** Because the expiry is re-stamped on
  every rotation (`AuthSessionIssuer.cs:367,409`), an actively refreshing client is never forced onto
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
  short reuse grace window. (Today the session issuer does apply such a window: a token rotated less
  than `RefreshSessionSettings.ReuseGraceSeconds` ago (default 10,
  `Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:98`) is answered `409 Conflict`
  `Auth.RefreshSuperseded` with nothing revoked, on both the lookup path and the lost-claim path
  (`AuthSessionIssuer.cs:331`, `:439`, defined at `:486`), so a sibling-tab race inside the window fails
  only that request. The cost is the converse: a replay of a stolen token that arrives inside the window
  of a legitimate rotation gets the same 409 and revokes nothing, a trade-off the setting itself
  documents (`RefreshSessionSettings.cs:90-92`; set it to `0` to treat every returning rotated token as
  reuse, `:94`). A re-presentation after the window still revokes the whole live family.)
- **The refresh token is server-side state.** Unlike the fully stateless access token, the refresh token
  is a column that must be written on every login and every refresh, so the refresh path always incurs
  a write to the Identity database; it is not a stateless operation.
- **No absolute session cap.** Because the refresh lifetime is re-stamped on every rotation
  (`AuthSessionIssuer.cs:367,409`), the configured window (seven days by default) bounds inactivity,
  not total session age: a continuously active client that refreshes at least once per window stays signed
  in indefinitely without re-entering a password. The flip side is exposure: a captured refresh-token
  chain that keeps refreshing never lapses on its own, so rotation (each refresh invalidates its
  predecessor) and reuse-detection revocation are the only backstops that end it. An absolute cap anchored
  to the opening login would bound that exposure but is deliberately not imposed here.
- **A non-positive configured lifetime fails startup; the issuer's fallback only covers a token
  service.** The refresh lifetime is honored from configuration: `RefreshTokenLifetime`
  (`AuthSessionIssuer.cs:60-61`) applies the value `TokenService` derives from
  `JwtSettings.RefreshTokenExpirationDays` (`TokenService.cs:165`; `JwtSettings.cs:73`). That setting
  carries `[Range(1, int.MaxValue)]` (`JwtSettings.cs:72`) and the options are bound with
  `ValidateDataAnnotations().ValidateOnStart()`
  (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:135-138`),
  so a zero or negative `RefreshTokenExpirationDays` fails host startup rather than reverting to a
  default. The issuer's guard still treats a non-positive reported lifetime as absent and falls back
  to the BR-205 seven-day default, which now matters only for a test double or custom
  `ITokenService` that overrides the member and reports a non-positive lifetime (`TimeSpan.Zero` or
  negative; the interface default at
  `ITokenService.cs:40` itself returns seven days).

## Revision (2026-10-01)
No decision or rationale changed. Three statements were corrected against current source. The removed
`UpdateRefreshToken` and `RevokeRefreshToken` no longer appear in either Domain analyzer ledger
(`Source/Core/MMCA.Common.Domain/PublicAPI.Unshipped.txt:1`, `PublicAPI.Shipped.txt:14-16`); their
removal is recorded only in `MMCA.Common/CHANGELOG.md:2680` (Status). `IssueTokensAsync` has login and
registration as its only callers inside the base (`AuthenticationServiceBase.cs:245,330`), and ADC's
external-login path also calls it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:320`)
(2026-09-19 note). The interface default for `RefreshTokenLifetime` is seven days
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:40`), so only a
double that overrides the member can report `TimeSpan.Zero` (Trade-offs). Line anchors were refreshed
for `TokenService` (`:101`, `:116`, `:155-159`, `:165`, `:178-197`), `AuthenticationServiceBase`
(`:40-52`, `:735-736`, `:748`, `:770`, `:799`, `:826`, `:839`, `:850`, `:858`), Store's
`AuthenticationService` (`:25`, `:32-33`, `:37`, `:42-43`, `:136-137`) and ADC's external-login call. The
login, refresh, registration and `IssueTokensAsync` anchors in the "Rotation on every issuance" bullet
(`AuthenticationServiceBase.cs:183`, `:263`, `:267`, `:474`) record the pre-2026-08-26 code shape and do not
point at that code today.

## Revision (2026-10-06)

**Both apps answer a vanished refresh user with 401, and neither constructor takes the refresh-session
types.** Store no longer overrides `CreateRefreshUserMissingError`, so both apps inherit the
framework's 401 (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:600-601`,
called at `:343`). Both subclass constructors take `IAuthSessionIssuer` (ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:56`,
Store `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:31`)
and `IOptions<EmailConfirmationSettings>` (ADC `:57`, Store `:32`) in place of `IRefreshSessionStore`
and `IOptions<RefreshSessionSettings>`; the Decision body is corrected to match. The 2026-09-25 note
keeps the anchors it recorded.

- **The refresh mechanics moved out of the base into `AuthSessionIssuer`.** `RefreshTokenAsync`
  (`AuthenticationServiceBase.cs:309`) delegates to `sessionIssuer.RotateAsync` (`:363`), and
  `RevokeTokenAsync` (`:378`) to `sessionIssuer.SignOutAsync` (`:389`). Rotation
  (`Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:90`, `:101`, `:281`, `:367`,
  `:391`), reuse revocation (`:311`, `:399`; a revoked row triggers it only when `IsReuseSignal` holds,
  `:303`, so a signed-out or cap-evicted row fails just that request), the private `RefreshTokenLifetime` guard (`:58-59`) and the
  sliding expiry stamps (`:340`, `:380`) are cited there; the base has no `RefreshTokenLifetime` member.
  The refresh credential compare is a token-hash lookup plus a user-id match (`AuthSessionIssuer.cs:292-299`),
  not a compare in the base. The 2026-10-01 anchor list for `AuthenticationServiceBase` (`:735-858`)
  pointed past the end of that file.
- **Related no longer describes the single-slot model in the present tense:** ADR-036's path issues a
  per-device session (ADR-097), and the revocation runs against session rows, not the user row.
- Current locations of facts recorded only in the 2026-10-01 revision: the removal record is at
  `MMCA.Common/CHANGELOG.md:3021` (not `:2680`); `IssueTokensAsync` is called at login
  (`AuthenticationServiceBase.cs:212`) and registration (`:305`), body `:443`; ADC's external-login call
  is `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:338`
  (not `:320`).
- Line anchors in Status, Context, Decision, Rationale and Trade-offs were re-verified against current
  source (`AuthenticationServiceBase.cs:64`, `:212`, `:305`, `:309`, `:323-333`, `:363`, `:378`, `:443`;
  ADC `User.cs:485`, `:507`).

## Revision (2026-10-07)
Re-verified against current source. The decision, the superseded status and the
`AuthenticationServiceBase` delegation are unchanged (`AuthenticationServiceBase.cs:212`, `:305`,
`:309`, `:323`, `:343`, `:363`, `:378`, `:389`, `:443`, `:451`, `:600`); what moved is the session
issuer, which now applies a rotation grace window and whose anchors all shifted.

1. **A token re-presented within the rotation grace is a race, not reuse.** A revoked row whose reason
   is `Rotated` and whose revocation is younger than `RefreshSessionSettings.ReuseGraceSeconds`
   (default 10, `Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:98`;
   `IsWithinRotationGrace`, `Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:477`)
   is answered `409 Conflict` `Auth.RefreshSuperseded` (`AuthSessionIssuer.cs:276-280`) with nothing
   revoked, on the lookup path (`:326-331`) and on the lost-claim path (`:436-439`). The Decision's
   reuse-revocation parenthetical, the Rationale's theft and revoke-on-mismatch bullets and the
   Trade-offs' aggressive-reuse bullet now say so, including the cost: a stolen-token replay inside
   the window is also answered 409 with nothing revoked (`RefreshSessionSettings.cs:90-93`).
2. **Losing the atomic rotation claim no longer always revokes the family.** The loser re-reads its row
   and branches three ways: lost to a sign-out or a cap eviction, only that request fails
   (`AuthSessionIssuer.cs:428-434`); rotated inside the grace, the 409 above (`:436-439`); otherwise the
   whole live family is revoked with `ReasonReuseDetected` (`:444`). The Decision parenthetical that
   stated an unconditional revoke is corrected.
3. Anchors re-verified against current source: `AuthSessionIssuer.cs` `RotateAsync` `:92`,
   `ResolveRotatableSessionAsync` called `:103` with body `:296`, `RotateSessionAsync` called `:111`
   with body `:392`, `TryRotateAsync` called `:416`, the token-hash lookup plus user-id match
   `:307-314`, the `IsRevoked` block `:316` with the non-reuse branch `:318-324`, `IsReuseSignal`
   defined `:460`, the reuse revoke `:333`, the private `RefreshTokenLifetime` guard `:60-61` (`:57-58`
   is now `AccessTokenLifetime`), and the sliding-expiry stamps `:362` (open) and `:405` (rotation
   successor); the removal record in Status is at `MMCA.Common/CHANGELOG.md:3046`. The 2026-10-06
   revision and the 2026-09-25 note keep the anchors they recorded.

## Revision (2026-10-21)
Re-verified against current source. The decision, the superseded status, the rotation grace window,
the lifetime defaults (`JwtSettings.AccessTokenExpirationMinutes` 15, `RefreshTokenExpirationDays` 7)
and the `AuthenticationServiceBase` delegation (`:212`, `:305`, `:309`, `:323`, `:333`, `:343`,
`:363`, `:378`, `:389`, `:443`, `:451`, `:600`) are unchanged; only line anchors moved.

1. Anchors re-verified against current source: `AuthSessionIssuer.cs` `ResolveRotatableSessionAsync`
   body `:298`, the token-hash lookup plus user-id match `:309-316`, the `IsRevoked` block `:318` with
   the non-reuse branch `:320-326`, the grace check on the lookup path `:328-333`, the reuse revoke
   `:335`, `RefreshSupersededError` `:278-282`, the sliding-expiry stamps `:364` (open) and `:407`
   (rotation successor), `RotateSessionAsync` body `:394`, `TryRotateAsync` called `:418`, the
   lost-claim branches `:430-436` (sign-out or eviction), `:438-441` (grace) and `:446` (family
   revoke), `IsReuseSignal` defined `:462`, `IsWithinRotationGrace` defined `:479` (`RotateAsync`
   `:92`, the calls at `:103` and `:111`, and the `RefreshTokenLifetime` guard `:60-61` hold);
   `JwtSettings.cs:66` and `:73`; the shipped `IAuthUser` ledger entries
   `Source/Core/MMCA.Common.Domain/PublicAPI.Shipped.txt:16-18`; the removal record
   `MMCA.Common/CHANGELOG.md:3364`; the test caller `DeleteUserHandlerBaseTests.cs:81` (the double's
   members stay at `UserUseCaseTestDoubles.cs:83,89`); the lock and role-change revocations ADC
   `UserAdministrationService.cs:85` and `:139`, Store `:82` and `:134`; and ADC `User.cs` `Delete()`
   `:497` and `Anonymize()` `:519` (Store `:204`, `:303` hold). The 2026-10-07 and earlier revisions
   keep the anchors they recorded.

## Revision (2026-10-26)
Re-verified against current source. The decision, the superseded status, the rotation grace window
(`ReuseGraceSeconds` default 10, `RefreshSessionSettings.cs:98`) and the `AuthenticationServiceBase`
delegation are unchanged; what moved is which revoked rows count as a reuse signal, plus line anchors.

1. **A row already swept by a reuse event is no longer a reuse signal.** `IsReuseSignal` now treats
   `ReasonReuseDetected` like `ReasonSignedOut` and `ReasonSessionCap`
   (`Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:473-475`), so presenting
   a token whose row an earlier reuse event already revoked fails that request alone, on the lookup
   path (`:322-329`) and on the lost-claim path (`:431-437`), instead of revoking the user's newer
   sessions a second time. A row carrying a successor hash (`:468-471`), or revoked for any other
   reason (`Rotated`, `AccountDeleted` at `Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:70`,
   an unrecognized reason, or none), still triggers the family revoke (`:338`, `:447`). This is the Common #612 change
   (v1.261.0). The Decision's list of non-reuse revocations and its lost-claim branch now include it.
2. **The setting's trade-off citation narrows to `RefreshSessionSettings.cs:90-92`.** Lines `:90-92`
   still document the in-window stolen-token trade-off; the clause at `:92-93` saying a row already
   flagged as reuse still revokes the family no longer matches the code above, so the Rationale and
   Trade-offs no longer cite it.
3. Anchors re-verified against current source: `AuthenticationServiceBase.cs` class `:67`, login and
   registration `IssueTokensAsync` calls `:230` and `:325`, body `:463` delegating to
   `sessionIssuer.IssueAsync` at `:471`, `RefreshTokenAsync` `:329`, `GetPrincipalFromExpiredToken`
   `:343`, the null-principal failure `:344-348`, `GetUserId` `:353`, the missing-user call `:363`
   with `CreateRefreshUserMissingError` defined `:620-621` (neither app overrides it), `RotateAsync`
   delegation `:383`, `RevokeTokenAsync` `:398` delegating to `SignOutAsync` at `:409`;
   `AuthSessionIssuer.cs` `ResolveRotatableSessionAsync` body `:300`, the token-hash lookup plus
   user-id match `:311-317`, the `IsRevoked` block `:320`, the grace check on the lookup path
   `:331-336`, the reuse revoke `:338`, the sliding-expiry stamps `:367` (open) and `:409` (rotation
   successor), `RotateSessionAsync` body `:396`, `TryRotateAsync` called `:419`, the lost-claim
   grace `:439-442` and family revoke `:447`, `IsReuseSignal` defined `:466`,
   `IsWithinRotationGrace` defined `:486` (`RotateAsync` `:92`, the calls at `:103` and `:111`,
   `RefreshSupersededError` `:278-282` and the `RefreshTokenLifetime` guard `:60-61` hold); the
   removal record `MMCA.Common/CHANGELOG.md:3580`; ADC's external-login `IssueTokensAsync` call
   `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:336`
   (its constructor anchors `:50`, `:56`, `:57`, `:64`, `:66` and Store's `:26`, `:31`, `:32`, `:38`,
   `:40` hold); ADC `User.cs` `Delete()` `:523` and `Anonymize()` `:545`, Store `User.cs`
   `Deactivate()` `:229` and `Anonymize()` `:328`. The 2026-10-21 and earlier revisions keep the
   anchors they recorded.

## Revision (2026-10-28)
Re-verified against current source. The decision, the superseded status, the rotation grace window,
the lifetime defaults (`JwtSettings.AccessTokenExpirationMinutes` 15, `RefreshTokenExpirationDays` 7)
and the issuer's fallback expression are unchanged; what moved is how a non-positive configured
refresh lifetime is handled, plus one changelog anchor.

1. **A non-positive configured refresh lifetime fails startup.** `RefreshTokenExpirationDays` carries
   `[Range(1, int.MaxValue)]` (`Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:72`,
   default `7` at `:73`), and `JwtSettings` is bound with `ValidateDataAnnotations().ValidateOnStart()`
   (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:135-138`);
   the change is recorded at `MMCA.Common/CHANGELOG.md:342` (v1.247.0). The fallback to seven days in
   `AuthSessionIssuer.cs:60-61` remains, but now covers only a token service (a test double or custom
   `ITokenService`) that reports a non-positive lifetime (`TimeSpan.Zero` or negative). The Trade-offs bullet that said a misconfiguration
   silently reverts to the baseline, and the matching clause in the Decision's sliding-expiry bullet,
   are corrected.
2. Anchors re-verified against current source: the removal record in Status is
   `MMCA.Common/CHANGELOG.md:3623` (the BREAKING multi-device refresh sessions entry, which opens at
   `:3622`; `:3580` is now unrelated text); `TokenService.cs:165` and `ITokenService.cs:40` hold. The
   2026-10-26 and earlier revisions keep the anchors they recorded.

## Related
ADR-004 (the stateless RS256/JWKS access token this refresh flow reissues, and the algorithm pinning
`GetPrincipalFromExpiredToken` relies on), ADR-032 (the password hashing that gates the login which opens
a refresh session, sharing the same `AuthenticationServiceBase<TUser>`), ADR-036 (the external OAuth path
that exchanges a federated identity for the same rotating refresh credential, today a per-device
session under ADR-097), ADR-047 (the soft-deleted-user middleware that bounds the stateless access
token's revocation gap, complementing the refresh revocation this ADR decided, which ADR-097 runs
against session rows rather than the user row), ADR-097 (the multi-device refresh sessions that
supersede this record).
