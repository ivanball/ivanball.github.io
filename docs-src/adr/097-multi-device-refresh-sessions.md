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
(`050-jwt-refresh-token-rotation.md:184-185`). The contract itself now says the same thing from the
other side: refresh tokens are "deliberately absent" from `IAuthUser`, with the reason written into
the interface (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`).

And a single column has **no history**. Rotation overwrites, so the row cannot say what replaced
what, who signed out, when, or from where. A replayed token and an expired one are indistinguishable
after the fact, which leaves an operator with nothing to look at after a reported account compromise.

## Decision
Refresh tokens become rows in their own table: one row per signed-in device, hashed at rest,
chained on rotation.

- **`RefreshSession` is a flat framework record, not an aggregate.**
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:39` (a `sealed class`
  implementing `IAnonymizable`) carries `Id`, `UserId`, `TokenHash`, `CreatedAt`, `ExpiresAt`,
  `RevokedAt`, `ReplacedByTokenHash`, `ReasonRevoked`, and the optional `IpAddress` / `UserAgent`
  (`:66-105`). Like `OutboxMessage` and `AuditTrailEntry` it has no audit stamps, no soft-delete flag
  and no concurrency token, and a global query filter hiding a revoked row would break the reuse check
  that depends on finding it (`:25-31`). Rows change in exactly two ways: `Revoke`, and `Anonymize`,
  which nulls the `[Pii]`-marked `IpAddress` and `UserAgent` (`:97`, `:104`) for an erasure request
  (`:210-215`) while keeping the hashes, timestamps and revocation chain, so reuse detection still
  works on an anonymized row (`:32-37`).
- **The store holds a hash, never a token.** `RefreshSession.HashToken` is SHA-256 over the token's
  UTF-8 bytes, hex encoded in upper case (`:173-177`), and `Create` hashes on the way in so the
  plaintext never reaches a property (`:152`, factory at `:125-158`). The digest is deliberately
  unsalted and deterministic, because every lookup is *by hash*: a salted digest could not be found
  (`:14-16`). The encoding is part of the contract rather than an implementation detail, and the
  method's remarks give the byte-for-byte SQL Server equivalent,
  `CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), Token)), 2)`, so a consumer's data
  migration can reproduce it (`:164-170`); the digest width is a constant the mapping reads (`:42`).
- **Rotation leaves a walkable chain.** `Revoke(revokedAt, reason, replacedByTokenHash)` records the
  successor's hash (`:187-202`, the link at `:199`), and refuses to revoke an already-revoked session
  rather than overwriting the first reason and instant recorded (`:189-195`). The four reasons are
  constants on the entity: `Rotated`, `SignedOut`, `ReuseDetected`, `SessionCapExceeded` (`:53-63`).
- **The rotation write is a claim the store arbitrates, not a mutation.**
  `IRefreshSessionStore.TryRotateAsync` is the one write in the contract that is not a revoke on a
  tracked instance: two requests presenting the same live token both read an un-revoked row, so a
  check-then-act rotation would mint two successors from one token and the presented row could never
  fire reuse detection again (`.../Application/Auth/IRefreshSessionStore.cs:13-14`, the return value
  argued at `:69-79`). The shipped EF store claims the row with a conditional
  `UPDATE ... WHERE Id = @id AND RevokedAt IS NULL`, so the database arbitrates: the winner affects
  one row, the loser affects none and writes nothing
  (`.../Persistence/Auth/EFRefreshSessionStore.cs:124-132`, argued at `:91-98`). The update and the
  successor insert share one transaction, so a loser cannot observe a half-finished rotation
  (`:121-150`, reasoning at `:100-106`). The interface's default implementation keeps the
  revoke-add-save shape, which is atomic only per instance and is all an in-memory or test store can
  offer (`IRefreshSessionStore.cs:95-113`, reasoning at `:80-84`). The caller that loses the claim is
  answered exactly like a replay: every live session of that user goes and the same
  `Auth.InvalidRefreshToken` comes back
  (`.../Application/Auth/Sessions/AuthSessionIssuer.cs:390-392`, the losing branch at `:394-403`).
- **Reuse detection revokes the live family, and only on the right signal.** The session workflow
  lives in the sealed `AuthSessionIssuer`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:39`), which
  `AuthenticationServiceBase<TUser>` takes as a required `IAuthSessionIssuer` constructor parameter
  (`.../Application/Auth/AuthenticationServiceBase.cs:64-71`): the base decides who is signed in, the
  issuer decides what they are handed (`:40-45`). The issuer resolves a presented token to its session
  (`AuthSessionIssuer.cs:281-321`) and separates the rejections, which all answer the caller with the
  same `Auth.InvalidRefreshToken` failure (`:259-267`). An unknown hash (or one belonging to another
  account) fails alone (`:296-299`), because revoking the family on it would let anyone holding one of
  a user's expired access tokens sign them out everywhere by posting a random string. A **revoked**
  row splits by why it was revoked (`:301-316`): one already rotated away (it carries a successor
  hash) or already flagged as reuse has come back, which is the reuse signal that revokes every live
  session the user holds (`IsReuseSignal` at `:415-423`, the family sweep at `:426-437`), while one
  that was signed out or evicted by the session cap only lost its session, so that request fails
  alone and the user's other devices keep working (`:303-309`). An **expired** row is an ordinary end
  of life: that device re-authenticates and the user's other devices keep working (`:318-320`). The
  cases are argued together in the method's own summary (`:269-280`).
- **Sign-out has both scopes.** `RevokeTokenAsync(userId, refreshToken)`
  (`AuthenticationServiceBase.cs:378`) delegates to `IAuthSessionIssuer.SignOutAsync`
  (`AuthSessionIssuer.cs:148-174`), which signs out one device when the token resolves to a live
  session of that user (the per-device branch at `:162-169`); an unknown token, another account's
  token or an already-revoked row leaves the caller unidentifiable, so the request degrades to signing
  every device out rather than reporting success for a revocation that reached nothing (`:158-161`,
  fall-through at `:172-173`). `RevokeAllSessionsAsync(userId)` is the explicit everywhere case, for a
  password change, an admin lockout or a "sign out everywhere" action
  (`AuthenticationServiceBase.cs:395`, delegating to `AuthSessionIssuer.cs:177-182`; the contract
  states both scopes at
  `.../Application/Auth/IAuthenticationService.cs:57-61,71-74`). `AuthControllerBase`'s
  `POST auth/revoke` carries no body, so it cannot name the device it is called from and deliberately
  signs out everywhere
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:144-162`, call
  at `:156`). Since 2026-08-27 a **third** scope ships beside those two, revoke-by-session-id, so a
  consumer no longer has to write its own action for per-device sign-out.
- **A configurable cap bounds the table without ever failing a login.**
  `RefreshSessions:MaxActiveSessionsPerUser`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:35`, default 10,
  `[Range(1, 1000)]` at `:34`, reasoning at `:27-33`; `AuthSessionIssuer` requires
  `IOptions<RefreshSessionSettings>` (`AuthSessionIssuer.cs:42`) and reads the cap straight from the
  bound settings (`:450`), and because the issuer is sealed (`:39`) the bound value is the only source)
  is enforced before a new session is staged (`:350-351`): while the user is at or over the cap, the
  oldest live session is revoked with reason `SessionCapExceeded` (`:448-461`, the eviction loop at
  `:457-460`). Ordering is `CreatedAt` then `Id` (`:453-454`, matched by the store's own ordering,
  `.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:62-70`), so two sessions opened in the
  same clock tick still evict deterministically. Expired-but-unrevoked rows do not count against the
  cap: they authenticate nobody (`AuthSessionIssuer.cs:442-446`, filter at `:452`).
- **IP and user-agent capture is optional and informational.** `AuthControllerBase` reads them from
  the connection and the request headers (`AuthControllerBase.cs:58`, `:64`) and passes them into
  login, registration and refresh (`:81`, `:106`, `:127`), and the entity truncates them to their
  column widths of 45 and 512 (`RefreshSession.cs:155-156`, widths at `:45`, `:48`). Neither value is
  ever part of a validation decision, so a mobile client changing networks is not signed out (`:92-96`).
- **Mapping is opt-in per data source.** `RefreshSessionSettings.Enabled` defaults to `false`
  (`RefreshSessionSettings.cs:25`, reasoning at `:14-24`), so a host that has not opted in keeps the
  model it had and its migrations never see the table. `ApplicationDbContext` maps it only when
  `Enabled` is true **and** the context instance's physical source name equals
  `RefreshSessions:DataSourceName` (default `Default`, `RefreshSessionSettings.cs:52`, reasoning at
  `:41-49`), the same two-part gate the scheduler table uses
  (`.../Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:337-340`, rationale at
  `:335-336`, applied at `:440` and `:895-903`). That keeps the table in exactly one database in a
  host that splits its modules across sources, instead of putting an empty `RefreshSessions` table in
  every module's migrations. A host with its own context class calls the public
  `ApplyRefreshSessionConfiguration` directly
  (`.../Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:34`, the opt-in-unlike-the-outbox
  argument at `:8-14`); Cosmos never reaches either path, because its context overrides
  `OnModelCreating` (`ApplicationDbContext.cs:884-885`).
- **The shipped store routes to that same database.** `EFRefreshSessionStore`
  (`.../Persistence/Auth/EFRefreshSessionStore.cs:30-34`) resolves the physical source through the
  entity registry first (a consumer that ships a real entity configuration for the session entity is
  routed like any other entity), falling back to the source named by `DataSourceName` (`:156-161`,
  reasoning at `:14-23`), and is registered scoped beside its bound options
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:160-166`). Every read is tracked on purpose:
  `IRefreshSessionStore` returns instances the caller revokes by mutating, and a no-tracking read
  would drop those revocations at save time
  (`.../Application/Auth/IRefreshSessionStore.cs:16-19`, restated at `EFRefreshSessionStore.cs:24-28`).
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
  `SessionStampingTokenService` (`.../Application/Auth/Sessions/AuthSessionIssuer.cs:480`), appends
  the claim when an ambient session id is armed (`:512-517`, and an `mfa` claim when a verified second
  factor is, `:519-522`) and forwards untouched when neither is (`:505-508`). The issuer exposes it as
  its `TokenService` (`:53`), and the base surfaces that to subclasses as its own `TokenService`
  property (`.../Application/Auth/AuthenticationServiceBase.cs:99`, no field of its own).
  `CreateAccessTokenForSession` (`:495-496`) hands the mint to `IAuthSessionIssuer.MintForSession`,
  which arms, mints and disarms (`AuthSessionIssuer.cs:130-145`). The abstract
  `CreateAccessToken(TUser)` hook every consumer already overrides
  (`AuthenticationServiceBase.cs:476`) keeps its signature, so every existing subclass emits `sid`
  with no edit at all (`:482-491`, `AuthSessionIssuer.cs:475-479`).
- **The session is created before the token is minted, because a token cannot name an id that does
  not exist yet.** The ordering is explicit in the code and explained there
  (`AuthSessionIssuer.cs:73-74`): `OpenSessionAsync` returns the new row's id (`:328-354`, the
  `IssuedSession` record at `:468`), `SaveChangesAsync` runs at `:81`, and only then does `:83-86`
  mint. Login reaches it through `IssueTokensAsync` at `AuthenticationServiceBase.cs:212` and
  registration at `:305` (the helper at `:443-457`). On refresh the rotation mints against the
  **successor's** id, not the session it just revoked (`AuthSessionIssuer.cs:119-122`, rotation at
  `:367-407`, argued at `:116-118`), so the `sid` in a freshly refreshed token names a live row.
- **Two endpoints put the device list and the per-device revoke in the framework.** Both are on
  `AuthControllerBase` and both are `[Authorize]`:
  - `GET auth/my-sessions` (`AuthControllerBase.cs:175-180`) returns
    `IReadOnlyList<RefreshSessionSummaryResponse>` (`:177`) for the caller's own live sessions,
    passing the caller's own `sid` straight into the application layer (`:187`).
  - `POST auth/revoke/{sessionId:guid}` (`:208-214`) answers 204, or 404 as ProblemDetails when the
    id names nothing the caller owns or a session already revoked (`:201-204`). It is explicitly
    `[NonIdempotent]` (`:209`), so a replayed request cannot be served a cached 204 and report success
    for a revoke that never ran.

  `RefreshSessionSummaryResponse` carries exactly six fields:
  `SessionId`, `CreatedAt`, `ExpiresAt`, `IpAddress`, `UserAgent`, `IsCurrent`
  (`.../MMCA.Common.Shared/Auth/Responses/RefreshSessionSummaryResponse.cs:23-29`). `TokenHash` and
  `ReplacedByTokenHash` are deliberately absent, because returning either would hand a caller a
  queryable index of credentials at rest for no gain (`:6-11`). **`IsCurrent` is computed
  server-side from the caller's own `sid`**, never supplied by the client
  (`AuthSessionIssuer.cs:211`, the whole projection at `:191-213`, which filters to sessions live at
  `now` (`:202`) and orders newest first (`:203-204`)).
- **Revoking a session you do not own is indistinguishable from revoking one that does not exist,
  and revoking one already revoked says so without writing.** `RevokeSessionByIdAsync`
  (`AuthenticationServiceBase.cs:428-432`) delegates to `IAuthSessionIssuer.RevokeSessionAsync`
  (`AuthSessionIssuer.cs:229-257`), which resolves through the user-scoped
  `IRefreshSessionStore.FindByIdAsync` (`.../Application/Auth/IRefreshSessionStore.cs:49-62`), whose
  EF implementation puts the user in the predicate rather than in a post-read check
  (`.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:73-84`), so another account's id
  returns the same `Auth.SessionNotFound` as a random one (`AuthSessionIssuer.cs:234-242`). An
  **already-revoked** row returns `NotFound` with the code `Auth.SessionAlreadyRevoked` and writes
  nothing (`:244-251`): the list the user clicked through rendered it as live, so after a double
  click, or a session the cap evicted between rendering the list and clicking the button, the client
  needs to say it was signed out earlier rather than claim this click signed it out; the lookup is
  user-scoped, so the answer reveals nothing about another account (`:220-227`). The page shows that
  `NotFound` as an informational "already signed out" toast (`Sessions.razor.cs:150-155`).
- **The device list ships as a page, not as a sample.** `/profile/sessions`
  (`.../MMCA.Common.UI/Pages/Auth/Sessions.razor:1`, `[Authorize]` at `:5`, code-behind at
  `Sessions.razor.cs:27`) renders a table of Device, IP, signed-in and expiry columns (`:37-93`)
  over `IAuthUIService.GetSessionsAsync` / `RevokeSessionAsync`, both of which return `Result`
  (`.../MMCA.Common.UI/Services/Auth/AuthUIService.cs:242-253`, `:256-268`) rather than throwing
  ([ADR-013](013-result-pattern.md)). A **sign-out-everywhere** button sits below the table
  (`Sessions.razor:95-106`, its hint at `:107-109`) and runs through
  `IAuthUIService.RevokeAllSessionsAsync` (`Sessions.razor.cs:203`; `AuthUIService.cs:126-148`), which
  is the account-wide revoke followed, only once the server confirmed it, by the local sign-out; the
  page then redirects to the login page, and a failed revoke shows the error and stays on the page
  (`Sessions.razor.cs:181-211`, reasoning at `:175-180`); those two revoke
  paths are why the current row carries no button of its own (`:18-25`). Both paths ask first through
  `IAppDialogService.ConfirmAsync`: a row's revoke names the device it is about to sign out
  (`:129-138`), and sign-out-everywhere confirms because it also ends the session in use
  (`:188-197`). Any host using the shared
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
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:171-175`): registering unconditionally would
  start a sweep in every service of a modular host, all but one of which has no table to sweep
  (`:168-170`). `DataSourceName` is used only to resolve the source at sweep time, as the fallback
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
  learns nothing about which one it hit (`AuthSessionIssuer.cs:259-267`), but they behave
  differently where it matters: the branch an attacker can reach at will (post a random token) is the
  one that revokes nothing.
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
  rotation at `:568`, replay revoking the family at `:613`, a signed-out or evicted session failing
  alone at `:639` and a rotated or flagged-as-reuse one revoking the family at `:664`, the lost and the
  won rotation claim at `:686` and `:711`, expiry and unknown tokens failing alone at
  `:730` and `:753`, per-device and all-device sign-out at `:802`, `:818` and `:834`), and the mapping
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
  `HashToken` (which is why the encoding is documented as a contract, `RefreshSession.cs:164-170`),
  and only then drop the two user columns, with the `EXPAND-CONTRACT-OVERRIDE` marker that drop
  requires. A consumer that skips the carry step is not broken, but every signed-in user is signed
  out at deploy.
- **Reuse detection still revokes a family on a benign race.** Two client tabs refreshing near
  simultaneously reach that outcome through either of two branches: the second tab presents the
  just-rotated-away token and lands on its revoked row, which carries its successor's hash
  (`AuthSessionIssuer.cs:301-316`, `:417-419`), or both present the same still-live token and the one
  that loses the store's rotation claim is answered like a replay (`:394-403`). Neither is distinguishable from theft, so both sign out every
  device rather than one. This is ADR-050's aggressive-by-design trade-off with a wider blast
  radius, kept deliberately: the alternative is a grace window in which a genuinely stolen token
  works.
- **"Nothing ages the table out" is retired (2026-08-27).** `RefreshSessionCleanupService` ships the
  sweep, so a consumer no longer schedules its own. The cap still bounds only the *live* set; the
  sweep is what bounds the dead one.
- **The retention window is also the reuse-detection window, and the shorter one wins.** Reuse
  detection works because a replayed token lands on a **revoked row**; delete that row and the same
  replay lands on nothing, which is the branch that deliberately fails alone. So retention silently
  caps how long a stolen token remains detectable as theft rather than as an unknown value. Both the
  setting and the service say so (`RefreshSessionSettings.cs:59-66`,
  `RefreshSessionCleanupService.cs:24-32`, cross-referenced from
  `AuthSessionIssuer.cs:442-446`). The 30-day default is comfortably longer than the 7-day
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
  (`Sessions.razor.cs:129-138`, `:188-197`), with the in-flight disable still guarding a double click
  (`Sessions.razor:80`, `:97`). Tidying up several old devices therefore takes two clicks per row;
  the price buys a named, cancellable step in front of an action that has no undo.
- **Two gates have to agree, and only a scaffold says when they do not.** `RefreshSessions:Enabled`
  drives the runtime model (`ApplicationDbContext.cs:337-340`) and `EnableRefreshSessions` drives the
  design-time one (`DesignTimeDbContextOptions.cs:73`); a mismatch produces no startup error, just a
  migration that does not match the running model (`:69-71`).
- **The refresh path writes more than it did.** A rotation inserts one row and revokes another
  (`AuthSessionIssuer.cs:367-407`), and every issue reads the user's live set to enforce the
  cap (`:448-455`), where the previous model wrote one column. The reads are index-covered
  (`RefreshSessionModelBuilderExtensions.cs:70-71`), but the refresh endpoint is no longer a
  single-row update.
- **The hash is confirmable, by design.** Anyone holding both a database read and a candidate token
  can verify the pairing, since the digest is deterministic and unsalted (`RefreshSession.cs:173-177`).
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
