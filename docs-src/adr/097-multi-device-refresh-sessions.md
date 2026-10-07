# ADR-097: Multi-Device Refresh Sessions (Hashed, Rotating, Per Device)

## Status
Accepted (2026-08-26). Supersedes the storage model of [ADR-050](050-jwt-refresh-token-rotation.md)
(one plaintext refresh-token column on the user row); the rotation and reuse-detection policy that
record decided is kept and generalized to a per-device set.

**Revised 2026-08-27 (v1.164.0):** the model gains the parts that make a per-device session
*visible* and *finite*. An access token now names the session that issued it (a `sid` claim), a user
can list and revoke their own devices through two endpoints and a shared page, and a retention sweep
ages the table out. Three of this record's original trade-offs are retired as a result, and the
sweep introduces one of its own. Every addition is additive: no consumer signature changes.

**Revised 2026-09-01:** rotation is a claim the store arbitrates rather than an in-memory revoke, so
two requests presenting the same live token cannot both walk away with a successor: the one that
loses the claim is answered exactly like a replay. The sessions page carries a sign-out-everywhere
action beside its per-device revokes.
Revised 2026-09-07 (a password change or reset revokes the whole session family, through a
refresh-session store the two handler bases require).
Revised 2026-10-01 (current-state sections re-anchored; the password handler bases require the
store).
Revised 2026-10-06: the session workflow now lives in the sealed `AuthSessionIssuer` behind a breaking
`AuthenticationServiceBase` constructor change (1.218.0), a signed-out or cap-evicted token no longer
revokes the family, an already-revoked revoke-by-id answers 404, and both page revokes confirm first.
Revised 2026-10-07: the reuse grace window this record originally rejected is adopted (1.233.0):
a token rotated less than `RefreshSessions:ReuseGraceSeconds` ago (default 10) answers 409
`Auth.RefreshSuperseded` and revokes nothing, on both the lookup path and the lost rotation claim,
so the 2026-09-01 note that a lost claim is answered exactly like a replay now holds only past the
grace and only when the row was not signed out or cap-evicted.
## Context
ADR-050 stores a user's refresh token as a single nullable `RefreshToken` string plus its
`RefreshTokenExpiry` on the app's `User` aggregate. That model settles rotation and reuse detection
correctly and costs three things it names but cannot fix from inside itself.

The token is a **bearer credential kept in plaintext**. Anything that can read the Identity database
(a backup, a support query, a log of a row dump, a compromised read replica) can mint access tokens
for any user who is signed in, because the stored value is exactly what the client presents.

There is **one slot per user**, so a session is an account-wide fact rather than a device fact.
Signing in on a phone overwrites the laptop's token, and the laptop's next refresh presents a value
that no longer matches, which the same record's reuse rule then treats as theft: the second device
is not merely signed out, it is signed out through the compromise path. ADR-050 records this as a
trade-off and names "a per-device or per-session token table" as the thing that would fix it
(`050-jwt-refresh-token-rotation.md:207-209`). The contract itself now says the same thing from the
other side: refresh tokens are "deliberately absent" from `IAuthUser`, with the reason written into
the interface (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`).

And a single column has **no history**. Rotation overwrites, so the row cannot say what replaced
what, who signed out, when, or from where. A replayed token and an expired one are indistinguishable
after the fact, which leaves an operator with nothing to look at after a reported account compromise.

## Decision
Refresh tokens become rows in their own table: one row per signed-in device, hashed at rest,
chained on rotation.

- **`RefreshSession` is a flat framework record, not an aggregate.**
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:41` (a `sealed class`
  implementing `IAnonymizable`) carries `Id`, `UserId`, `TokenHash`, `CreatedAt`, `ExpiresAt`,
  `RevokedAt`, `ReplacedByTokenHash`, `ReasonRevoked`, and the optional `IpAddress` / `UserAgent`
  (`:67-107`). Like `OutboxMessage` and `AuditTrailEntry` it has no audit stamps, no soft-delete flag
  and no concurrency token, and a global query filter hiding a revoked row would break the reuse check
  that depends on finding it (`:25-33`). Rows change in exactly two ways: `Revoke`, and `Anonymize`,
  which nulls the `[Pii]`-marked `IpAddress` and `UserAgent` (`:99`, `:106`) for an erasure request
  (`:212-217`) while keeping the hashes, timestamps and revocation chain, so reuse detection still
  works on an anonymized row (`:34-39`).
- **The store holds a hash, never a token.** `RefreshSession.HashToken` is SHA-256 over the token's
  UTF-8 bytes, hex encoded in upper case (`:175-179`), and `Create` hashes on the way in so the
  plaintext never reaches a property (`:154`, factory at `:127-160`). The digest is deliberately
  unsalted and deterministic, because every lookup is *by hash*: a salted digest could not be found
  (`:14-16`). The encoding is part of the contract rather than an implementation detail, and the
  method's remarks give the byte-for-byte SQL Server equivalent,
  `CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), Token)), 2)`, so a consumer's data
  migration can reproduce it (`:166-172`); the digest width is a constant the mapping reads (`:44`).
- **Rotation leaves a walkable chain.** `Revoke(revokedAt, reason, replacedByTokenHash)` records the
  successor's hash (`:189-204`, the link at `:201`), and refuses to revoke an already-revoked session
  rather than overwriting the first reason and instant recorded (`:191-197`). The four reasons are
  constants on the entity: `Rotated`, `SignedOut`, `ReuseDetected`, `SessionCapExceeded` (`:55-65`).
- **The rotation write is a claim the store arbitrates, not a mutation.**
  `IRefreshSessionStore.TryRotateAsync` is the one write in the contract that is not a revoke on a
  tracked instance: two requests presenting the same live token both read an un-revoked row, so a
  check-then-act rotation would mint two successors from one token and the presented row could never
  fire reuse detection again (`.../Application/Auth/IRefreshSessionStore.cs:13-14`, the return value
  argued at `:92-94`). The shipped EF store claims the row with a conditional
  `UPDATE ... WHERE Id = @id AND RevokedAt IS NULL`, so the database arbitrates: the winner affects
  one row, the loser affects none and writes nothing
  (`.../Persistence/Auth/EFRefreshSessionStore.cs:137-145`, argued at `:106-111`). The update and the
  successor insert share one transaction, so a loser cannot observe a half-finished rotation
  (`:134-163`, reasoning at `:114-118`). The interface's default implementation keeps the
  revoke-add-save shape, which is atomic only per instance and is all an in-memory or test store can
  offer (`IRefreshSessionStore.cs:113-131`, reasoning at `:99-101`). The caller that loses the claim
  re-reads the row as the database now holds it, through `IRefreshSessionStore.FindByIdUntrackedAsync`
  (`IRefreshSessionStore.cs:64-80`; the EF store's `AsNoTracking` override at
  `EFRefreshSessionStore.cs:87-97`), and is answered by what that row says
  (`.../Application/Auth/Sessions/AuthSessionIssuer.cs:392-452`, the losing branch at `:419-449`): a
  sign-out or cap eviction of the same row fails that request alone (`:428-434`), a rotation less than
  `ReuseGraceSeconds` ago answers `409 Auth.RefreshSuperseded` with nothing revoked (`:436-439`), and
  anything else gets the replay answer, every live session of that user going and
  `Auth.InvalidRefreshToken` coming back (`:441-448`). The interface default of the re-read returns
  null (`IRefreshSessionStore.cs:79-80`), which lands on that last branch, so a store that does not
  override it keeps the conservative family revoke.
- **Reuse detection revokes the live family, and only on the right signal.** The session workflow
  lives in the sealed `AuthSessionIssuer`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:41`), which
  `AuthenticationServiceBase<TUser>` takes as a required `IAuthSessionIssuer` constructor parameter
  (`.../Application/Auth/AuthenticationServiceBase.cs:64-71`): the base decides who is signed in, the
  issuer decides what they are handed (`:40-45`). The issuer resolves a presented token to its session
  (`AuthSessionIssuer.cs:296-343`) and separates the rejections, which answer the caller with the same
  `Auth.InvalidRefreshToken` failure (`:265-269`) except for the rotation race below. An unknown hash
  (or one belonging to another account) fails alone (`:311-314`), because revoking the family on it
  would let anyone holding one of a user's expired access tokens sign them out everywhere by posting a
  random string. A **revoked** row splits by why it was revoked (`:316-338`): one already rotated away
  (it carries a successor hash) or already flagged as reuse has come back, which is the reuse signal
  that revokes every live session the user holds (`IsReuseSignal` at `:460-468`, the family sweep at
  `:488-499`), while one that was signed out or evicted by the session cap only lost its session, so
  that request fails alone and the user's other devices keep working (`:318-324`). An **expired** row
  is an ordinary end of life: that device re-authenticates and the user's other devices keep working
  (`:340-342`). The cases are argued together in the method's own summary (`:282-295`).
- **A rotation race inside the reuse grace revokes nothing (since 1.233.0).** A row revoked as
  `Rotated` less than `RefreshSessions:ReuseGraceSeconds` ago (default 10, `[Range(0, 300)]`,
  `.../Application/Auth/RefreshSessionSettings.cs:97-98`, the trade-off argued at `:82-96`) is a
  sibling request (another tab, or the same browser served by another replica) that rotated the token
  a moment ago, so instead of the family revoke it answers `409 Conflict` with
  `Auth.RefreshSuperseded` (`AuthSessionIssuer.cs:276-280`) and nothing is revoked, on the lookup path
  (`:326-331`) as on the lost rotation claim above. The predicate admits only the `Rotated` reason
  (`:477-485`), so a row already flagged as reuse still revokes the family however recent, and a grace
  of `0` restores the original answer for every rotated row; it does not restore the family revoke for
  a lost claim whose row was signed out or cap-evicted, which fails alone at any grace (`:428-434`,
  pinned by `AuthSessionIssuerReuseGraceTests.cs:96`). `AuthControllerBase`'s refresh action documents and
  declares the 409 (`AuthControllerBase.cs:116-121`, `:128`), and the clients treat it as transient:
  `CookieSessionRefresher` keeps the cookie
  (`.../MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:117`), `DirectApiTokenRefresher`
  never reports it as signed out: it returns the newer stored pair when another refresh in the same
  process already stored one, and reports unavailable with the stored pair untouched otherwise
  (`.../MMCA.Common.UI/Services/Auth/Tokens/DirectApiTokenRefresher.cs:26-32`, `:64-67`,
  `:88-97`), and
  `AuthUIService.TryRefreshTokenAsync` keeps the stored tokens on that outcome
  (`.../MMCA.Common.UI/Services/Auth/AuthUIService.cs:151`, `:165`).
- **Sign-out has both scopes.** `RevokeTokenAsync(userId, refreshToken)`
  (`AuthenticationServiceBase.cs:378`) delegates to `IAuthSessionIssuer.SignOutAsync`
  (`AuthSessionIssuer.cs:150-176`), which signs out one device when the token resolves to a live
  session of that user (the per-device branch at `:164-171`); an unknown token, another account's
  token or an already-revoked row leaves the caller unidentifiable, so the request degrades to signing
  every device out rather than reporting success for a revocation that reached nothing (`:160-163`,
  fall-through at `:174-175`). `RevokeAllSessionsAsync(userId)` is the explicit everywhere case, for a
  password change, an admin lockout or a "sign out everywhere" action
  (`AuthenticationServiceBase.cs:395`, delegating to `IAuthSessionIssuer.SignOutEverywhereAsync` at
  `AuthSessionIssuer.cs:179-184`; the contract states both scopes at
  `.../Application/Auth/IAuthenticationService.cs:58-62,72-75`). `AuthControllerBase`'s
  `POST auth/revoke` carries no body, so it cannot name the device it is called from and deliberately
  signs out everywhere
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:142-169`, call
  at `:162-163`). Since 2026-08-27 a **third** scope ships beside those two, revoke-by-session-id, so a
  consumer no longer has to write its own action for per-device sign-out.
- **A configurable cap bounds the table without ever failing a login.**
  `RefreshSessions:MaxActiveSessionsPerUser`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:35`, default 10,
  `[Range(1, 1000)]` at `:34`, reasoning at `:27-33`; `AuthSessionIssuer` requires
  `IOptions<RefreshSessionSettings>` (`AuthSessionIssuer.cs:44`) and reads the cap straight from the
  bound settings (`:512`), and because the issuer is sealed (`:41`) the bound value is the only source)
  is enforced before a new session is staged (`:372-373`): while the user is at or over the cap, the
  oldest live session is revoked with reason `SessionCapExceeded` (`:510-523`, the eviction loop at
  `:519-522`). Ordering is `CreatedAt` then `Id` (`:515-516`, matched by the store's own ordering,
  `.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:63-71`), so two sessions opened in the
  same clock tick still evict deterministically. Expired-but-unrevoked rows do not count against the
  cap: they authenticate nobody (`AuthSessionIssuer.cs:501-509`, filter at `:514`).
- **IP and user-agent capture is optional and informational.** `AuthControllerBase` reads them from
  the connection and the request headers (`AuthControllerBase.cs:58`, `:64`) and passes them into
  login, registration and refresh (`:81`, `:106`, `:134`), and the entity truncates them to their
  column widths of 45 and 512 (`RefreshSession.cs:157-158`, widths at `:47`, `:50`). Neither value is
  ever part of a validation decision, so a mobile client changing networks is not signed out (`:94-98`).
- **Mapping is opt-in per data source.** `RefreshSessionSettings.Enabled` defaults to `false`
  (`RefreshSessionSettings.cs:25`, reasoning at `:14-24`), so a host that has not opted in keeps the
  model it had and its migrations never see the table. `ApplicationDbContext` maps it only when
  `Enabled` is true **and** the context instance's physical source name equals
  `RefreshSessions:DataSourceName` (default `Default`, `RefreshSessionSettings.cs:52`, reasoning at
  `:41-49`), the same two-part gate the scheduler table uses
  (`.../Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:336-339`, rationale at
  `:334-335`, applied at `:440` and `:893-901`). That keeps the table in exactly one database in a
  host that splits its modules across sources, instead of putting an empty `RefreshSessions` table in
  every module's migrations. A host with its own context class calls the public
  `ApplyRefreshSessionConfiguration` directly
  (`.../Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:34`, the opt-in-unlike-the-outbox
  argument at `:8-14`); Cosmos never reaches either path, because its context overrides
  `OnModelCreating` (`ApplicationDbContext.cs:882-883`).
- **The shipped store routes to that same database.** `EFRefreshSessionStore`
  (`.../Persistence/Auth/EFRefreshSessionStore.cs:31-35`) resolves the physical source through the
  entity registry first (a consumer that ships a real entity configuration for the session entity is
  routed like any other entity), falling back to the source named by `DataSourceName` (`:169-174`,
  reasoning at `:15-22`), and is registered scoped beside its bound options
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:168-172`), with the `AuthSessionIssuer`
  over it registered scoped for the same reason (`:176`). Every read the caller can revoke through is
  tracked on purpose: `IRefreshSessionStore` returns instances the caller revokes by mutating, and a
  no-tracking read would drop those revocations at save time
  (`.../Application/Auth/IRefreshSessionStore.cs:16-19`, restated at `EFRefreshSessionStore.cs:25-29`).
  The one exception is `FindByIdUntrackedAsync`, a read-only `AsNoTracking` re-read for the rotation
  loser that nothing revokes through (`EFRefreshSessionStore.cs:87-97`, declared at
  `IRefreshSessionStore.cs:64-80`).
- **The table carries exactly two indexes**, because it answers exactly two questions: a unique index
  on `TokenHash` (`IX_RefreshSessions_TokenHash`,
  `RefreshSessionModelBuilderExtensions.cs:64-66`, name at `:22`), the validation path, unique so a
  hash collision across users cannot validate one account's token against another's session
  (`:60-63`); and `(UserId, RevokedAt)` (`IX_RefreshSessions_UserId`, `:70-71`, name at `:25`), the
  family path used by the cap, by reuse detection and by sign-out-everywhere (`:68-69`). `TokenHash`
  is fixed-length non-unicode, because the value is always a 64-character hex digest (`:45-49`,
  reasoning at `:43-44`).
- **Design time has its own flag, and it must agree with the host.**
  `DesignTimeDbContextOptions.EnableRefreshSessions` (default `false`,
  `.../Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:73`) belongs in the **Identity**
  migrations project only (`:57-72`). `DesignTimeDbContextHelper` registers the
  settings with the source name **this context actually resolved to**
  (`.../Design/DesignTimeDbContextHelper.cs:173-178`, in the builder at `:116` that `CreateSqlServer`, `CreatePostgreSQL` and `CreateSqlite` share, `:52`, `:74`, `:95`), so the gate opens for exactly the context
  `--datasource` selected, including a logical name that collapses onto `Default` (`:136-140`). A flag
  that disagrees with the host's `RefreshSessions:Enabled` shows up as `has-pending-model-changes`
  (`DesignTimeDbContextOptions.cs:69-71`).
- **The access token carries `sub` and nothing else that names the user.** `TokenService` mints
  `JwtRegisteredClaimNames.Sub` as the single carrier of the user id
  (`.../MMCA.Common.Infrastructure/Auth/TokenService.cs:116`); the duplicate custom claim that used
  to ride alongside it is gone, so there are no longer two values that can disagree and two claim
  names every reader has to know (`:110-113`). `AuthClaimTypes.Subject` names the claim
  (`.../MMCA.Common.Shared/Auth/AuthClaimTypes.cs:34`) and `ClaimsPrincipalExtensions` reads both
  `sub` and the `NameIdentifier` form the JWT bearer handler maps it to
  (`.../Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`), parsing through `IParsable` so the
  solution-wide identifier alias (ADR-048) can change shape without editing the readers (`:40-43`).
  RS256 tokens now carry the JWKS `KeyId` in their `kid` header (`TokenService.cs:65-70`, passed at `:90`, stamped at
  `:259`), so a validator reading the published JWKS document (ADR-004) selects the right key by name
  instead of trying each in turn (`:255-258`, the same id on the validation key at `:278-281`).

### The session becomes visible and finite (2026-08-27)

- **An access token names the session that issued it, through a claim nothing validates.**
  `AuthClaimTypes.SessionId` is `sid`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:47`, the additive-and-never-validated
  contract at `:36-46`), read back through `ClaimsPrincipalExtensions.FindSessionId`, which returns
  `Guid?` and answers null for an absent or unparsable claim rather than throwing
  (`.../Shared/Auth/ClaimsPrincipalExtensions.cs:109-113`). Its only job is to let a request say which
  of the caller's own devices it came from.

  **`TokenService` is untouched, and that is the design.** Neither it nor `ITokenService` gains a
  parameter, an overload or an obsoletion (`.../MMCA.Common.Infrastructure/Auth/TokenService.cs:101-159`,
  the contract at `.../MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:17-22`).
  Instead a private pass-through decorator nested in `AuthSessionIssuer`,
  `SessionStampingTokenService` (`.../Application/Auth/Sessions/AuthSessionIssuer.cs:542`), appends
  the claim when an ambient session id is armed (`:574-579`, and an `mfa` claim when a verified second
  factor is, `:581-584`) and forwards untouched when neither is (`:567-570`). The issuer exposes it as
  its `TokenService` (`:55`), and the base surfaces that to subclasses as its own `TokenService`
  property (`.../Application/Auth/AuthenticationServiceBase.cs:99`, no field of its own).
  `CreateAccessTokenForSession` (`:495-496`) hands the mint to `IAuthSessionIssuer.MintForSession`,
  which arms, mints and disarms (`AuthSessionIssuer.cs:132-147`). The abstract
  `CreateAccessToken(TUser)` hook every consumer already overrides
  (`AuthenticationServiceBase.cs:476`) keeps its signature, so every existing subclass emits `sid`
  with no edit at all (`:482-491`, `AuthSessionIssuer.cs:537-541`).
- **The session is created before the token is minted, because a token cannot name an id that does
  not exist yet.** The ordering is explicit in the code and explained there
  (`AuthSessionIssuer.cs:75-76`): `OpenSessionAsync` returns the new row's id (`:350-376`, the
  `IssuedSession` record at `:530`), `SaveChangesAsync` runs at `:83`, and only then does `:85-88`
  mint. Login reaches it through `IssueTokensAsync` at `AuthenticationServiceBase.cs:212` and
  registration at `:305` (the helper at `:443-457`). On refresh the rotation mints against the
  **successor's** id, not the session it just revoked (`AuthSessionIssuer.cs:121-124`, rotation at
  `:392-452`, argued at `:118-120`), so the `sid` in a freshly refreshed token names a live row.
- **Two endpoints put the device list and the per-device revoke in the framework.** Both are on
  `AuthControllerBase` and both are `[Authorize]`:
  - `GET auth/my-sessions` (`AuthControllerBase.cs:182-187`) returns
    `IReadOnlyList<RefreshSessionSummaryResponse>` (`:184`) for the caller's own live sessions,
    passing the caller's own `sid` straight into the application layer (`:194`).
  - `POST auth/revoke/{sessionId:guid}` (`:215-221`) answers 204, or 404 as ProblemDetails when the
    id names nothing the caller owns or a session already revoked (`:205-212`). It is explicitly
    `[NonIdempotent]` (`:216`), so a replayed request cannot be served a cached 204 and report success
    for a revoke that never ran.

  `RefreshSessionSummaryResponse` carries exactly six fields:
  `SessionId`, `CreatedAt`, `ExpiresAt`, `IpAddress`, `UserAgent`, `IsCurrent`
  (`.../MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:23-29`). `TokenHash` and
  `ReplacedByTokenHash` are deliberately absent, because returning either would hand a caller a
  queryable index of credentials at rest for no gain (`:6-11`). **`IsCurrent` is computed
  server-side from the caller's own `sid`**, never supplied by the client
  (`AuthSessionIssuer.cs:213`, the whole projection at `:193-215`, which filters to sessions live at
  `now` (`:204`) and orders newest first (`:205-206`)).
- **Revoking a session you do not own is indistinguishable from revoking one that does not exist,
  and revoking one already revoked says so without writing.** `RevokeSessionByIdAsync`
  (`AuthenticationServiceBase.cs:428-432`) delegates to `IAuthSessionIssuer.RevokeSessionAsync`
  (`AuthSessionIssuer.cs:231-259`), which resolves through the user-scoped
  `IRefreshSessionStore.FindByIdAsync` (`.../Application/Auth/IRefreshSessionStore.cs:49-62`), whose
  EF implementation puts the user in the predicate rather than in a post-read check
  (`.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:79-85`), so another account's id
  returns the same `Auth.SessionNotFound` as a random one (`AuthSessionIssuer.cs:236-244`). An
  **already-revoked** row returns `NotFound` with the code `Auth.SessionAlreadyRevoked` and writes
  nothing (`:246-253`): the list the user clicked through rendered it as live, so after a double
  click, or a session the cap evicted between rendering the list and clicking the button, the client
  needs to say it was signed out earlier rather than claim this click signed it out; the lookup is
  user-scoped, so the answer reveals nothing about another account (`:218-229`). The page shows that
  `NotFound` as an informational "already signed out" toast (`Sessions.razor.cs:155-161`).
- **The device list ships as a page, not as a sample.** `/profile/sessions`
  (`.../MMCA.Common.UI/Pages/Auth/Sessions.razor:1`, `[Authorize]` at `:5`, code-behind at
  `Sessions.razor.cs:27`) renders a table of Device, IP, signed-in and expiry columns (`:37-93`)
  over `IAuthUIService.GetSessionsAsync` / `RevokeSessionAsync`, both of which return `Result`
  (`.../MMCA.Common.UI/Services/Auth/AuthUIService.cs:261`, `:275`) rather than throwing
  ([ADR-013](013-result-pattern.md)). A **sign-out-everywhere** button sits below the table
  (`Sessions.razor:95-106`, its hint at `:107-109`) and runs through
  `IAuthUIService.RevokeAllSessionsAsync` (`Sessions.razor.cs:212`; `AuthUIService.cs:127`), which
  is the account-wide revoke followed, only once the server confirmed it, by the local sign-out; the
  page then redirects to the login page, and a failed revoke shows the error and stays on the page
  (`Sessions.razor.cs:187-230`, reasoning at `:180-186`); those two revoke
  paths are why the current row carries no button of its own (`:18-25`). Both paths ask first through
  `IAppDialogService.ConfirmAsync`: a row's revoke names the device it is about to sign out
  (`:129-138`), and sign-out-everywhere confirms because it also ends the session in use
  (`:194-203`). Any host using the shared
  router gets the route with **zero registration**, because the router's `AppAssembly` *is* `MMCA.Common.UI`
  (`.../MMCA.Common.UI/Routes.razor:12`); `AdditionalAssemblies` (`:13`) is the separate mechanism that
  discovers a consumer module's own pages. Nav entry at `Layout/NavMenu.razor:89` (narrowed to one role when a host sets `Layout:SessionsNavRequiredRole`, `:84`, `:252-253`), route constant at
  `Common/RoutePaths.cs:16`, 28 localized `Auth.Sessions.*` keys in both `SharedResource.resx` and its `.es` sibling.

  Three of its choices are decisions rather than styling. The current device is marked with a **text**
  chip, not a colour (`Sessions.razor:54-60`), for WCAG 1.4.1. The current row offers **no revoke
  button at all**, only a hint (`:68-75`), because ending your own session would leave the app signed
  in until the access token expired, which reads as a broken sign-out; the page-level button is
  where ending it belongs, because that path signs out locally too. And a load failure renders
  **inline** through `ErrorSummary` with a retry button (`:17`, `:23-29`) rather than as a snackbar,
  because once a toast expires an empty table and a failed load look identical (`:15-16`); a failed
  reload clears the list rather than leaving stale rows a user could act on (`Sessions.razor.cs:101-103`).
- **A retention sweep ages the table out.** `RefreshSessionCleanupService`
  (`.../MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:48-53`) derives from
  `PeriodicBackgroundService` and waits one full interval before its first sweep, so cleanup never competes
  with startup or migration work (`StartupDelay` at `:68`, reasoning at `:64-67`). It deletes rows that **stopped
  being usable** more than `RetentionDays` ago, in one set-based `ExecuteDeleteAsync` with no batching
  (`:124-128`, cutoff at `:107`). The predicate ages each row from the instant it stopped being
  usable: its revocation if it was revoked, otherwise its expiry, which is the wording the setting
  itself uses (`RefreshSessionSettings.cs:55-58`). That is a conditional, not the later of the two: a
  row revoked minutes ago survives even if it expired long before (`:99-104`), and a row revoked 31
  days ago is deleted even if its `ExpiresAt` is still in the future.

  `RetentionDays` defaults to 30 with `[Range(0, 3650)]`
  (`RefreshSessionSettings.cs:71-72`), swept every `CleanupIntervalHours` (default 6,
  `[Range(1, 168)]`, `:79-80`). Zero disables the sweep and logs that it did
  (`RefreshSessionCleanupService.cs:83-87`), as does `Enabled` being false (`:77-81`). Every sweep
  logs its count **including zero**, deliberately, because a log that speaks only when it deleted
  something gives an operator no evidence that retention is running at all (`:132`, message at `:153-154`, argued at
  `:130-131`):

  ```text
  Purged {Count} refresh sessions that stopped being usable more than {RetentionDays} days ago
  ```

  Registration is gated on `Enabled` alone, not on `DataSourceName`
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:181-185`): registering unconditionally would
  start a sweep in every service of a modular host, all but one of which has no table to sweep
  (`:178-180`). `DataSourceName` is used only to resolve the source at sweep time, as the fallback
  when the entity registry has no entry (`RefreshSessionCleanupService.cs:140-145`), and a source that
  does not map the table warns once per sweep instead of failing with a translation error (`:115-122`).

## Rationale
- **A credential at rest is a credential.** Hashing is what turns a database read from "mint tokens
  for every signed-in user" into "hold a list of digests". The unsalted digest is the deliberate part:
  the token is 64 bytes of `RandomNumberGenerator` output (`TokenService.cs:155-159`), not a guessable
  password, so the property a salt buys (resistance to offline guessing of the input) is worth nothing
  here, while the property it costs (lookup by hash) is the entire access path
  (`IRefreshSessionStore.cs:28-37`).
- **One row per device is what a session actually is.** The single column made "signed in" an account
  fact and forced every second device through the compromise path. Rows make it a device fact, which
  is what both the user's mental model and any future "your devices" screen need
  (`RefreshSession.cs:9-12`).
- **A rotation chain is what makes replay detectable at all.** Because using a session revokes it and
  records its successor, a replayed token lands on a revoked row carrying a successor hash instead of
  on nothing, and that is a signal an unknown hash can never produce (`RefreshSession.cs:18-23`, and
  the store returning revoked rows on purpose, `IRefreshSessionStore.cs:29-32`). That distinction is
  what lets reuse revoke the family while a random string, or a token whose device was merely signed
  out, cannot.
- **Failing closed on reuse, open on the unknown.** Both branches return the same error, so a caller
  learns nothing about which one it hit (`AuthSessionIssuer.cs:261-269`), but they behave
  differently where it matters: the branch an attacker can reach at will (post a random token) is the
  one that revokes nothing. The one distinct answer is the grace window's `409 Auth.RefreshSuperseded`
  (`:271-280`), which tells a caller only that its token was rotated within the last
  `ReuseGraceSeconds`: the signal a racing sibling tab needs to retry instead of signing out, and one
  a holder of a copied token learns too.
- **A cap that evicts beats a cap that refuses.** Refusing the eleventh sign-in would fail a
  legitimate login to protect a table; evicting the oldest live session bounds the growth and costs
  the user the device they used least recently (`RefreshSessionSettings.cs:27-33`).
- **Opt-in mapping is what keeps this one module's data.** Sessions belong to Identity. The outbox is
  configured on the base context because it is genuinely cross-cutting; copying that would have put an
  empty table in every other database's migrations
  (`RefreshSessionModelBuilderExtensions.cs:8-14`).
- **The behavior is pinned by tests at all three layers**: the entity's hashing, creation and
  revocation rules
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Auth/RefreshSessionTests.cs:13`), the login,
  rotation, reuse and cap workflow
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:29`,
  hash-only storage at `:225`, other devices left alone at `:239` and `:595`, cap eviction at `:255`,
  rotation at `:568`, replay revoking the family at `:615`, a signed-out or evicted session failing
  alone at `:641` and a rotated or flagged-as-reuse one revoking the family at `:666`, the lost and the
  won rotation claim at `:688` and `:713`, expiry and unknown tokens failing alone at
  `:732` and `:755`, per-device and all-device sign-out at `:804`, `:820` and `:836`), the reuse grace
  (`.../MMCA.Common.Application.Tests/Auth/Sessions/AuthSessionIssuerReuseGraceTests.cs:24`, the
  10-second default at `:33`, a lost claim inside the grace answering 409 and keeping the family at
  `:38`, a rotated token inside the grace doing the same at `:114`, a flagged-as-reuse row still
  revoking the family inside the grace at `:149`, and a zero grace treating every rotated token as
  reuse at `:195`), and the mapping
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionModelBuilderExtensionsTests.cs:14`).
- **The 2026-08-27 additions are pinned at five layers**, which is what lets the trade-offs above be
  stated as facts: the claim and the projection
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/RefreshSessionManagementTests.cs:31`,
  successor-not-predecessor `sid` at `:87`, a token with no `sid` still refreshing at `:109`,
  only-the-caller's-row-is-current at `:162`, no token material in the response at `:188`, another
  user's session answering not-found at `:249`, already-revoked answering not-found without a write
  at `:267`);
  the claim reader
  (`.../MMCA.Common.Shared.Tests/Auth/ClaimsPrincipalExtensionsTests.cs:12`); the endpoints, including
  reflection theories that pin the two route templates and the `[Authorize]` attribute
  (`.../MMCA.Common.API.Tests/Controllers/Auth/AuthControllerBaseTests.cs:20`, routes at `:328-330`,
  authorization at `:340`, the non-idempotent declaration at `:350`); the sweep, whose predicate
  semantics are settled by a test rather than by prose
  (`.../MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionCleanupServiceTests.cs:35`,
  `PurgeSweep_MeasuresARevokedRowFromItsRevocationNotItsExpiry` at `:126`, the zero-count log at
  `:157`, registration gating at `:184` and `:196`), with ownership scoping pinned against real SQLite
  (`.../Persistence/Auth/EFRefreshSessionStoreFindByIdTests.cs:21`, another user's session at `:41`,
  the tracked-instance requirement at `:75`); and the page
  (`.../MMCA.Common.UI.Tests/Pages/Auth/SessionsTests.cs:27`, the current row offering no revoke at
  `:167`, a failed reload not leaving stale rows at `:231`, a not-found revoke reading as
  already-signed-out at `:265`, both revoke paths confirming first and doing nothing when cancelled at
  `:322`, `:339`, `:359` and `:376`, sign-out-everywhere signing out through the auth service at
  `:396`, calling no per-device revoke at `:410` and staying on the page when it fails at `:422`). A WCAG 2.1 AA scan of the page runs in the out-of-solution gallery
  suite (`.../MMCA.Common.UI.E2E.Tests/Auth/SessionsPageE2ETests.cs:13`), which means it runs in the
  `ui-e2e` CI job and **not** in a local `dotnet test --solution MMCA.Common.slnx`.

## Trade-offs
- **This is a breaking change with a data migration attached.** `IAuthUser` loses `RefreshToken`,
  `RefreshTokenExpiry`, `UpdateRefreshToken` and `RevokeRefreshToken` (`IAuthUser.cs:9-14`, the
  interface now being password material only at `:16-25`), so every consumer's `User` aggregate
  changes shape. The migration path is expand then contract (ADR-057): create the `RefreshSessions`
  table, carry the live tokens over by hashing them **in place** with the SQL equivalent of
  `HashToken` (which is why the encoding is documented as a contract, `RefreshSession.cs:166-172`),
  and only then drop the two user columns, with the `EXPAND-CONTRACT-OVERRIDE` marker that drop
  requires. A consumer that skips the carry step is not broken, but every signed-in user is signed
  out at deploy.
- **Reuse detection still revokes a family on a benign race that outlasts the grace.** Two client
  tabs refreshing near simultaneously reach that outcome, once the reuse grace has passed, through
  either of two branches: the second tab presents the just-rotated-away token and lands on its revoked
  row, which carries its successor's hash (`AuthSessionIssuer.cs:316-338`, `:462-464`), or both
  present the same still-live token and the one that loses the store's rotation claim re-reads a row
  rotated longer ago than the grace (`:436-448`). Neither is distinguishable from theft, so both sign
  out every device rather than one. A loser whose row was signed out or cap-evicted instead fails
  alone (`:428-434`), and inside the grace both branches answer 409 with nothing revoked (next
  bullet). This is ADR-050's aggressive-by-design trade-off with a wider blast radius. As first
  recorded it was taken in full, rejecting a grace window because a genuinely stolen token works
  inside one; that window is now adopted (see the 2026-10-07 revision below), so the trade-off holds
  past the grace, and for every rotated row when `ReuseGraceSeconds` is `0`.
- **A replay inside the reuse grace revokes nothing (2026-10-07).** A stolen refresh token presented
  within `ReuseGraceSeconds` (default 10) of a legitimate rotation is answered 409 like a racing
  sibling tab instead of revoking the user's whole session family, because the two cannot be told
  apart in that window (`RefreshSessionSettings.cs:90-94`). Past the window, and for a row flagged as
  reuse at any age, the family revoke applies unchanged (`AuthSessionIssuer.cs:477-485`). The price
  buys a concurrent refresh from two tabs or two replicas that no longer signs every device out.
- **"Nothing ages the table out" is retired (2026-08-27).** `RefreshSessionCleanupService` ships the
  sweep, so a consumer no longer schedules its own. The cap still bounds only the *live* set; the
  sweep is what bounds the dead one.
- **The retention window is also the reuse-detection window, and the shorter one wins.** Reuse
  detection works because a replayed token lands on a **revoked row**; delete that row and the same
  replay lands on nothing, which is the branch that deliberately fails alone. So retention silently
  caps how long a stolen token remains detectable as theft rather than as an unknown value. Both the
  setting and the service say so (`RefreshSessionSettings.cs:59-66`,
  `RefreshSessionCleanupService.cs:24-32`, cross-referenced from
  `AuthSessionIssuer.cs:501-509`). The 30-day default is comfortably longer than the 7-day
  `Jwt:RefreshTokenExpirationDays` it has to outlive, but the two settings are independent and
  nothing fails a build when an operator sets retention below the refresh lifetime: it just quietly
  starts deleting rows whose tokens could still come back.
- **"Nothing in the framework reads `IpAddress` and `UserAgent`" is retired (2026-08-27).**
  `GET auth/my-sessions` returns both and `/profile/sessions` renders them. They remain
  informational, never part of a validation decision, which is the property that keeps a mobile client
  changing networks signed in.
- **The `sid` claim is stamped by a decorator, so a subclass can opt out of it by accident.** A
  consumer whose `CreateAccessToken` override mints from its own injected `ITokenService` rather than
  from the base's `TokenService` property produces a perfectly valid token that simply carries no
  `sid` (`AuthenticationServiceBase.cs:89-98`; such a subclass can override
  `CreateAccessTokenForSession` instead, `:489-490`). Nothing fails; the device list just marks no row as
  current for that consumer, which is pinned by
  `GetSessionsAsync_WithNoCurrentSessionId_MarksNothingCurrent`
  (`.../MMCA.Common.Application.Tests/Auth/RefreshSessionManagementTests.cs:176`). That is the price
  of making the claim additive instead of changing an abstract signature every consumer implements,
  and the trade was taken deliberately.
- **Nothing validates `sid`, by design, so it is a hint and not an authorization input.** It is
  documented as additive and never validated (`AuthClaimTypes.cs:36-46`) and the reader answers null
  rather than throwing on a malformed value (`ClaimsPrincipalExtensions.cs:109-113`). A future
  temptation to authorize on it would need its own record: today a token whose session was revoked
  still validates until it expires, which is exactly ADR-047's revocation-gap posture.
- **Every revoke on the sessions page costs a confirmation.** Both a row's revoke and
  sign-out-everywhere open an `IAppDialogService.ConfirmAsync` dialog before anything is sent
  (`Sessions.razor.cs:129-138`, `:194-203`), with the in-flight disable still guarding a double click
  (`Sessions.razor:80`, `:97`). Tidying up several old devices therefore takes two clicks per row;
  the price buys a named, cancellable step in front of an action that has no undo.
- **Two gates have to agree, and only a scaffold says when they do not.** `RefreshSessions:Enabled`
  drives the runtime model (`ApplicationDbContext.cs:336-339`) and `EnableRefreshSessions` drives the
  design-time one (`DesignTimeDbContextOptions.cs:73`); a mismatch produces no startup error, just a
  migration that does not match the running model (`:69-71`).
- **The refresh path writes more than it did.** A rotation inserts one row and revokes another
  (`AuthSessionIssuer.cs:392-452`), and every issue reads the user's live set to enforce the
  cap (`:510-517`), where the previous model wrote one column. The reads are index-covered
  (`RefreshSessionModelBuilderExtensions.cs:70-71`), but the refresh endpoint is no longer a
  single-row update.
- **The hash is confirmable, by design.** Anyone holding both a database read and a candidate token
  can verify the pairing, since the digest is deterministic and unsalted (`RefreshSession.cs:175-179`).
  That is the accepted cost of lookup-by-hash and it holds only because the input is high-entropy
  random; the same scheme applied to anything guessable would be wrong.

## Revision (2026-09-07)
Credential rotation now ends the session family (SEC-Common-02). A stolen refresh chain otherwise
survived the exact remediation a user performs on discovering it: the rotation replaced the password
and left every live refresh session minting tokens.

`RefreshSessionRevocation.RevokeAllAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionRevocation.cs:27`, in the
internal helper at `:17`) reads the account's un-revoked sessions through
`GetUnrevokedByUserAsync` (`:39`), revokes them and saves (`:50`). It is called after a successful
save by `ChangePasswordHandlerBase`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:93`)
and `ResetPasswordHandlerBase`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:105`).

Both bases take the store as an **optional** constructor parameter with a `TimeProvider`
(`ChangePasswordHandlerBase.cs:40`, `ResetPasswordHandlerBase.cs:49`), so this is not a breaking
signature change: a consumer that has not wired `IRefreshSessionStore` keeps compiling and keeps the
old behaviour, and injecting it is what turns the revocation on. The revocation runs after the
password save rather than before it, so a failure to revoke cannot leave an account whose password
changed but whose caller was told it did not.

## Revision (2026-10-01)
No decision or rationale changed; the current-state sections now match the code. Content corrected
in place: the session cap is read through a `protected virtual` `MaxActiveSessionsPerUser` property, so
a subclass can override the bound value (`AuthenticationServiceBase.cs:153`); the `sid` decorator also
stamps an `mfa` claim and forwards untouched only when neither is armed (`:966-970`, `:986-1005`); the
sessions page's sign-out-everywhere runs through `IAuthUIService.RevokeAllSessionsAsync`, which signs
out locally only after the server confirmed the revoke, and a failure keeps the user on the page
(`Sessions.razor.cs:156-185`, `AuthUIService.cs:118-139`); the nav entry is role-gatable through
`Layout:SessionsNavRequiredRole` (`NavMenu.razor:81-84`, `:249-250`) and the page has 24 localized
keys; the retention sweep derives from `PeriodicBackgroundService`
(`RefreshSessionCleanupService.cs:53`); the design-time settings registration lives in a builder that
`CreateSqlServer`, `CreatePostgreSQL` and `CreateSqlite` share (`DesignTimeDbContextHelper.cs:116`,
`:173-178`); and both password handler bases now take `IRefreshSessionStore` as a required
constructor parameter, only the `TimeProvider` staying optional (`ChangePasswordHandlerBase.cs:46-48`,
`ResetPasswordHandlerBase.cs:47-48`), which corrects the Status line (the 2026-09-07 Revision above
records the original optional shape). Every other `path:line` citation in Status through Related was
re-anchored to current source, including moved files (`Interfaces/Infrastructure/Auth/ITokenService.cs`,
`Shared/Auth/Responses/RefreshSessionSummaryResponse.cs`, `Controllers/Auth/AuthControllerBaseTests.cs`,
`UI.E2E.Tests/Auth/SessionsPageE2ETests.cs`).

## Revision (2026-10-06)
No decision changed; the current-state sections now match the code again. Content corrected in place:
- The session workflow (issue, rotation, reuse detection, the cap, sign-out, listing, revoke-by-id and
  the `sid`/`mfa` stamping decorator) moved out of `AuthenticationServiceBase` into the sealed
  `AuthSessionIssuer` (`AuthSessionIssuer.cs:39`). The base now takes a required `IAuthSessionIssuer`
  (`AuthenticationServiceBase.cs:64-71`), a breaking constructor change in 1.218.0
  (`MMCA.Common/CHANGELOG.md:283-284`), so the 2026-08-27 Status note that no consumer signature
  changed holds only for that revision.
- The 2026-10-01 Revision's `protected virtual` `MaxActiveSessionsPerUser` property no longer exists:
  the issuer reads the cap from the bound settings (`AuthSessionIssuer.cs:450`) and cannot be
  subclassed.
- A revoked row is a reuse signal only when it was rotated or already flagged as reuse; a signed-out or
  cap-evicted token now fails alone (`AuthSessionIssuer.cs:301-309`, `:415-423`;
  `MMCA.Common/CHANGELOG.md:260`, 1.219.0).
- Revoking an already-revoked session by id answers `NotFound` (`Auth.SessionAlreadyRevoked`) instead
  of success (`AuthSessionIssuer.cs:244-251`; `MMCA.Common/CHANGELOG.md:216`, 1.222.0).
- `RefreshSession` implements `IAnonymizable`, so `Anonymize` is a second mutation beside `Revoke`
  (`RefreshSession.cs:39`, `:210-215`).
- Both sessions-page revokes confirm first, so the "no confirmation step" trade-off is replaced
  (`Sessions.razor.cs:129-138`, `:188-197`); the page has 28 localized `Auth.Sessions.*` keys, not 24.
- Every other `path:line` citation in Status through Related was re-verified against current source and
  re-anchored where it had moved.

## Revision (2026-10-07)
Re-verified against current source. The storage model, the hashing, the cap, the sign-out scopes,
the device list and the retention sweep are unchanged; what moved is the reuse answer to a rotation
race, which reverses this record's original rejection of a grace window. This is an amendment, not
a supersede: reuse detection still revokes the family past the grace.
1. **The reuse grace window is adopted (1.233.0).** `RefreshSessions:ReuseGraceSeconds` defaults to
   10 with `[Range(0, 300)]` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:82-98`).
   A token whose row was revoked as `Rotated` less than the grace ago answers `409 Conflict`
   (`Auth.RefreshSuperseded`, `AuthSessionIssuer.cs:276-280`) and revokes nothing, on the lookup path
   (`:326-331`) and on the lost rotation claim (`:436-439`); the predicate is `:477-485`
   (`MMCA.Common/CHANGELOG.md:12`). Why: two tabs, or one browser served by two replicas, refreshing
   a moment apart no longer burns the whole session family, which the original trade-off accepted.
   The cost is that a replay inside the window revokes nothing; it is recorded as a new trade-off,
   and the original rejected-alternative bullet is narrowed to the race that outlasts the grace,
   re-anchored, and points here. A grace of `0` restores the family revoke for every rotated row but
   not for a lost claim on a signed-out or cap-evicted row, which fails alone
   (`AuthSessionIssuer.cs:428-434`, `AuthSessionIssuerReuseGraceTests.cs:96`).
2. **The rotation loser re-reads its row.** `IRefreshSessionStore.FindByIdUntrackedAsync`
   (`IRefreshSessionStore.cs:64-80`, a default member returning null) is overridden by the EF store
   with an `AsNoTracking` read (`EFRefreshSessionStore.cs:87-97`), so the loser of the claim fails
   alone on a sign-out or cap eviction (`AuthSessionIssuer.cs:428-434`), answers 409 inside the grace,
   and otherwise gets the replay answer (`:441-448`). The "every read is tracked" statement now
   names that exception (`EFRefreshSessionStore.cs:25-29`).
3. **The 409 is part of the HTTP contract and the clients honour it.** The refresh action documents
   and declares it (`AuthControllerBase.cs:116-121`, `:128`); `CookieSessionRefresher.cs:117`,
   `DirectApiTokenRefresher.cs:64-67` and `AuthUIService.TryRefreshTokenAsync` (`:151`, `:165`)
   treat it as transient (`MMCA.Common/CHANGELOG.md:21`). `DirectApiTokenRefresher` answers a 409
   with the newer stored pair when another in-process refresh already stored one, and as unavailable
   otherwise (`DirectApiTokenRefresher.cs:26-32`, `:88-97`). The grace is pinned by
   `AuthSessionIssuerReuseGraceTests.cs:24`.
4. The everywhere sign-out delegates to `IAuthSessionIssuer.SignOutEverywhereAsync`
   (`AuthSessionIssuer.cs:179-184`), not to `SignOutAsync`; the `AuthSessionIssuer` registration
   beside the store is cited (`DependencyInjection.cs:176`).
5. Anchors re-verified against current source: `AuthSessionIssuer.cs` (class `:41`, options `:44`,
   cap `:510-523`, rotation `:392-452`, `IsReuseSignal` `:460-468`, family sweep `:488-499`,
   decorator `:542`), `RefreshSession.cs` (`:41`, `:55-65`, `:127-160`, `:175-179`, `:189-204`,
   `:212-217`), `EFRefreshSessionStore.cs` (`:31-35`, `:134-163`, `:169-174`),
   `IRefreshSessionStore.cs` (`:92-94`, `:113-131`), `AuthControllerBase.cs` (`:142-169`,
   `:182-187`, `:215-221`), `DependencyInjection.cs:168-185`, `ApplicationDbContext.cs:336-339`,
   `:882-883`, `IAuthenticationService.cs:58-62,72-75`, `Sessions.razor.cs:155-161`, `:187-230`,
   `:194-203`, `AuthUIService.cs:127`, `:261`, `:275`, `AuthenticationServiceBaseTests.cs:615` through
   `:836`, and `050-jwt-refresh-token-rotation.md:207-209`. Dated revisions above keep their anchors
   as written.

## Related
[ADR-050](050-jwt-refresh-token-rotation.md) (the single-column model this record replaces, and the
source of the rotation and reuse-detection policy it keeps),
[ADR-004](004-authentication-dual-fetch.md) (the stateless RS256 access token this flow reissues, and
the JWKS document the new `kid` header points into),
[ADR-006](006-database-per-service.md) (one sealed context class per engine, which is why the mapping
gate lives on the base context rather than in a consumer subclass),
[ADR-029](029-authentication-brute-force-protection.md) (the lockout and rate-limit checks that run
before a session is ever opened, in the same shared workflow,
`AuthenticationServiceBase.cs:135-140` for login and `:242` for registration),
[ADR-047](047-soft-deleted-user-session-revocation.md) (the middleware that bounds the access token's
revocation gap; a soft-deleted user's sessions stop refreshing because the refresh flow re-fetches
through the same query filter, which is why the delete handler does not revoke them itself,
`.../Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:107-111`),
[ADR-051](051-client-auth-token-lifecycle.md) (the client half: the rotated pair each head persists
and replays),
[ADR-057](057-expand-contract-schema-evolution-gate.md) (the gate the column drop has to be marked
for),
[ADR-048](048-primitive-identifier-type-aliases.md) (the identifier alias the sessions and the `sub`
reader are typed against),
[ADR-013](013-result-pattern.md) (the `Result`-returning UI client the sessions page branches on, and
the `ErrorSummary` component it renders a failed load through),
[ADR-074](074-recurring-job-scheduler.md) (the scheduler a consumer would have used for its own
retention job before the framework shipped one, and the same two-part `Enabled` plus `DataSourceName`
gate the scheduler table uses),
[ADR-020](020-permission-based-authorization.md) (why these two endpoints are `[Authorize]` and
self-scoped rather than permission-gated: a user listing and revoking their own devices needs no
permission, and the ownership scope is enforced in the query),
[ADR-063](063-accessibility-conformance-gate.md) (the WCAG gate the sessions page is scanned under,
and the reason the current-device marker is text rather than colour).
