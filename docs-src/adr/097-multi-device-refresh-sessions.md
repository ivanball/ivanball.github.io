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
(`050-jwt-refresh-token-rotation.md:114-118`). The contract itself now says the same thing from the
other side: refresh tokens are "deliberately absent" from `IAuthUser`, with the reason written into
the interface (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:9-14`).

And a single column has **no history**. Rotation overwrites, so the row cannot say what replaced
what, who signed out, when, or from where. A replayed token and an expired one are indistinguishable
after the fact, which leaves an operator with nothing to look at after a reported account compromise.

## Decision
Refresh tokens become rows in their own table: one row per signed-in device, hashed at rest,
chained on rotation.

- **`RefreshSession` is a flat framework record, not an aggregate.**
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:31` carries `Id`, `UserId`,
  `TokenHash`, `CreatedAt`, `ExpiresAt`, `RevokedAt`, `ReplacedByTokenHash`, `ReasonRevoked`, and the
  optional `IpAddress` / `UserAgent` (`:58-92`). Like `OutboxMessage` and `AuditTrailEntry` it has no
  audit stamps, no soft-delete flag and no concurrency token: rows are never edited except to be
  revoked, and a global query filter hiding a revoked row would break the reuse check that depends on
  finding it (`:22-29`).
- **The store holds a hash, never a token.** `RefreshSession.HashToken` is SHA-256 over the token's
  UTF-8 bytes, hex encoded in upper case (`:160-164`), and `Create` hashes on the way in so the
  plaintext never reaches a property (`:139`, factory at `:112-145`). The digest is deliberately
  unsalted and deterministic, because every lookup is *by hash*: a salted digest could not be found
  (`:11-15`). The encoding is part of the contract rather than an implementation detail, and the
  method's remarks give the byte-for-byte SQL Server equivalent,
  `CONVERT(char(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), Token)), 2)`, so a consumer's data
  migration can reproduce it (`:151-157`); the digest width is a constant the mapping reads (`:34`).
- **Rotation leaves a walkable chain.** `Revoke(revokedAt, reason, replacedByTokenHash)` records the
  successor's hash (`:174-189`, the link at `:186`), and refuses to revoke an already-revoked session
  rather than overwriting the first reason and instant recorded (`:176-182`). The four reasons are
  constants on the entity: `Rotated`, `SignedOut`, `ReuseDetected`, `SessionCapExceeded` (`:46-55`).
- **Reuse detection revokes the live family, and only on the right signal.**
  `AuthenticationServiceBase<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:45`) resolves a
  presented token to its session (`:464-496`) and separates three rejections that all answer the
  caller with the same `Auth.InvalidRefreshToken` failure (`:603-604`). An unknown hash (or one
  belonging to another account) fails alone (`:479-482`), because revoking the family on it would let
  anyone holding one of a user's expired access tokens sign them out everywhere by posting a random
  string. A **revoked** row means this exact token was already rotated away or signed out and has come
  back, which is the reuse signal that revokes every live session the user holds (`:484-491`, the
  family sweep at `:566-577`). An **expired** row is an ordinary end of life: that device
  re-authenticates and the user's other devices keep working (`:493-495`). The three are argued
  together in the method's own summary (`:454-463`).
- **Sign-out has both scopes.** `RevokeTokenAsync(userId, refreshToken)` signs out one device when the
  token resolves to a live session of that user (`:320-358`, the per-device branch at `:343-351`); an
  unknown token, another account's token or an already-revoked row leaves the caller unidentifiable,
  so the request degrades to signing every device out rather than reporting success for a revocation
  that reached nothing (`:339-342`, fall-through at `:354-355`). `RevokeAllSessionsAsync(userId)` is
  the explicit everywhere case, for a password change, an admin lockout or a "sign out everywhere"
  action (`:361-376`; the contract states both scopes at
  `.../Application/Auth/IAuthenticationService.cs:57-61,71-74`). `AuthControllerBase`'s
  `POST auth/revoke` carries no body, so it cannot name the device it is called from and deliberately
  signs out everywhere
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:143-160`, call
  at `:155`). Since 2026-08-27 a **third** scope ships beside those two, revoke-by-session-id, so a
  consumer no longer has to write its own action for per-device sign-out.
- **A configurable cap bounds the table without ever failing a login.**
  `RefreshSessions:MaxActiveSessionsPerUser`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:31`, default 10,
  `[Range(1, 1000)]` at `:30`, reasoning at `:23-29`; the base property falls back to the same 10 for
  an unbound options instance, `AuthenticationServiceBase.cs:96-105`, constant at `:57`) is enforced
  before a new session is staged: while the user is at or over the cap, the oldest live session is
  revoked with reason `SessionCapExceeded` (`:584-597`, the eviction loop at `:593-596`). Ordering is
  `CreatedAt` then `Id` (`:589-590`, matched by the store's own ordering,
  `.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:61-69`), so two sessions opened in the
  same clock tick still evict deterministically. Expired-but-unrevoked rows do not count against the
  cap: they authenticate nobody (`AuthenticationServiceBase.cs:579-583`, filter at `:588`).
- **IP and user-agent capture is optional and informational.** `AuthControllerBase` reads them from
  the connection and the request headers (`AuthControllerBase.cs:56`, `:62`) and passes them into
  login, registration and refresh (`:79`, `:104`, `:125`), and the entity truncates them to their
  column widths of 45 and 512 (`RefreshSession.cs:142-143`, widths at `:37`, `:40`). Neither value is
  ever part of a validation decision, so a mobile client changing networks is not signed out (`:84-88`).
- **Mapping is opt-in per data source.** `RefreshSessionSettings.Enabled` defaults to `false`
  (`RefreshSessionSettings.cs:21`, reasoning at `:14-20`), so a host that has not opted in keeps the
  model it had and its migrations never see the table. `ApplicationDbContext` maps it only when
  `Enabled` is true **and** the context instance's physical source name equals
  `RefreshSessions:DataSourceName` (default `Default`, `RefreshSessionSettings.cs:48`, reasoning at
  `:33-46`), the same two-part gate the scheduler table uses
  (`.../Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:296-298`, rationale at
  `:293-295`, applied at `:357` and `:659-667`). That keeps the table in exactly one database in a
  host that splits its modules across sources, instead of putting an empty `RefreshSessions` table in
  every module's migrations. A host with its own context class calls the public
  `ApplyRefreshSessionConfiguration` directly
  (`.../Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:34`, the opt-in-unlike-the-outbox
  argument at `:8-14`); Cosmos never reaches either path, because its context overrides
  `OnModelCreating` (`ApplicationDbContext.cs:648-649`).
- **The shipped store routes to that same database.** `EFRefreshSessionStore`
  (`.../Persistence/Auth/EFRefreshSessionStore.cs:30-33`) resolves the physical source through the
  entity registry first (a consumer that ships a real entity configuration for the session entity is
  routed like any other entity), falling back to the source named by `DataSourceName` (`:75-78`,
  reasoning at `:14-23`), and is registered scoped beside its bound options
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:147-151`). Every read is tracked on purpose:
  `IRefreshSessionStore` returns instances the caller revokes by mutating, and a no-tracking read
  would drop those revocations at save time
  (`.../Application/Auth/IRefreshSessionStore.cs:15-17`, restated at `EFRefreshSessionStore.cs:24-28`).
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
  migrations project only (`:57-72`). `DesignTimeDbContextHelper.CreateSqlServer` registers the
  settings with the source name **this context actually resolved to**
  (`.../Design/DesignTimeDbContextHelper.cs:101-106`), so the gate opens for exactly the context
  `--datasource` selected, including a logical name that collapses onto `Default` (`:96-100`). A flag
  that disagrees with the host's `RefreshSessions:Enabled` shows up as `has-pending-model-changes`
  (`DesignTimeDbContextOptions.cs:69-71`).
- **The access token carries `sub` and nothing else that names the user.** `TokenService` mints
  `JwtRegisteredClaimNames.Sub` as the single carrier of the user id
  (`.../MMCA.Common.Infrastructure/Services/TokenService.cs:92`); the duplicate custom claim that used
  to ride alongside it is gone, so there are no longer two values that can disagree and two claim
  names every reader has to know (`:86-89`). `AuthClaimTypes.Subject` names the claim
  (`.../MMCA.Common.Shared/Auth/AuthClaimTypes.cs:25`) and `ClaimsPrincipalExtensions` reads both
  `sub` and the `NameIdentifier` form the JWT bearer handler maps it to
  (`.../Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`), parsing through `IParsable` so the
  solution-wide identifier alias (ADR-048) can change shape without editing the readers (`:40-43`).
  RS256 tokens now carry the JWKS `KeyId` in their `kid` header (`TokenService.cs:66`, stamped at
  `:212`), so a validator reading the published JWKS document (ADR-004) selects the right key by name
  instead of trying each in turn (`:208-211`, the same id on the validation key at `:232-234`).

### The session becomes visible and finite (2026-08-27)

- **An access token names the session that issued it, through a claim nothing validates.**
  `AuthClaimTypes.SessionId` is `sid`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:38`, the additive-and-never-validated
  contract at `:27-37`), read back through `ClaimsPrincipalExtensions.FindSessionId`, which returns
  `Guid?` and answers null for an absent or unparsable claim rather than throwing
  (`.../Shared/Auth/ClaimsPrincipalExtensions.cs:56-60`). Its only job is to let a request say which
  of the caller's own devices it came from.

  **`TokenService` is untouched, and that is the design.** Neither it nor `ITokenService` gains a
  parameter, an overload or an obsoletion (`.../MMCA.Common.Infrastructure/Services/TokenService.cs:77-114`,
  the contract at `.../MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:17-22`).
  Instead a private pass-through decorator nested in `AuthenticationServiceBase`,
  `SessionStampingTokenService` (`.../Application/Auth/AuthenticationServiceBase.cs:761`), appends the
  claim when an ambient session id is armed and forwards untouched when it is not (`:780-790`), and
  the base exposes it to subclasses as the `TokenService` property (`:82`, field at `:67`).
  `CreateAccessTokenForSession` arms, mints and disarms (`:544-555`). The abstract
  `CreateAccessToken(TUser)` hook every consumer already overrides (`:523`) keeps its signature, so
  every existing subclass emits `sid` with no edit at all (`:530-534`, `:756-760`).
- **The session is created before the token is minted, because a token cannot name an id that does
  not exist yet.** The ordering is explicit in the code and explained there
  (`AuthenticationServiceBase.cs:490-492`): `OpenSessionAsync` returns the new row's id
  (`:629-655`, the `IssuedSession` record at `:749`), `SaveChangesAsync` runs at `:498`, and only then
  does `:501` mint. Login reaches it at `:189` and registration at `:269`. On refresh the rotation
  mints against the **successor's** id, not the session it just revoked (`:336`, rotation at
  `:662-690`, argued at `:332-334`), so the `sid` in a freshly refreshed token names a live row.
- **Two endpoints put the device list and the per-device revoke in the framework.** Both are on
  `AuthControllerBase` and both are `[Authorize]`:
  - `GET auth/my-sessions` (`AuthControllerBase.cs:173-177`) returns
    `IReadOnlyList<RefreshSessionSummaryResponse>` (`:175`) for the caller's own live sessions,
    passing the caller's own `sid` straight into the application layer (`:185`).
  - `POST auth/revoke/{sessionId:guid}` (`:205-211`) answers 204, or 404 as ProblemDetails when the
    id names nothing the caller owns. It is explicitly `[NonIdempotent]` (`:206`), so a replayed
    request cannot be served a cached 204 and report success for a revoke that never ran.

  `RefreshSessionSummaryResponse` carries exactly six fields:
  `SessionId`, `CreatedAt`, `ExpiresAt`, `IpAddress`, `UserAgent`, `IsCurrent`
  (`.../MMCA.Common.Shared/Auth/RefreshSessionSummaryResponse.cs:23-29`). `TokenHash` and
  `ReplacedByTokenHash` are deliberately absent, because returning either would hand a caller a
  queryable index of credentials at rest for no gain (`:5-11`). **`IsCurrent` is computed
  server-side from the caller's own `sid`**, never supplied by the client
  (`AuthenticationServiceBase.cs:427`, the whole projection at `:407-431`, which filters to sessions
  live at `now` (`:418`) and orders newest first (`:419-420`)).
- **Revoking a session you do not own is indistinguishable from revoking one that does not exist,
  and revoking one already revoked is a success.** `RevokeSessionByIdAsync` (`:445-469`) resolves
  through the user-scoped `IRefreshSessionStore.FindByIdAsync`
  (`.../Application/Auth/IRefreshSessionStore.cs:57-60`), whose EF implementation puts the user in
  the predicate rather than in a post-read check
  (`.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:77-83`), so another account's id
  returns the same `Auth.SessionNotFound` as a random one (`:453-457`). An **already-revoked** row
  returns `Result.Success()` and writes nothing (`:460-463`): a double click, or a session the cap
  evicted between rendering the list and clicking the button, leaves the caller's request already
  satisfied, and reporting an error for that would be reporting a failure to reach a state the
  caller is already in (`:438-443`).
- **The device list ships as a page, not as a sample.** `/profile/sessions`
  (`.../MMCA.Common.UI/Pages/Auth/Sessions.razor:1`, `[Authorize]` at `:5`, code-behind at
  `Sessions.razor.cs:25`) renders a table of Device, IP, signed-in and expiry columns (`:36-86`)
  over `IAuthUIService.GetSessionsAsync` / `RevokeSessionAsync`, both of which return `Result`
  (`.../MMCA.Common.UI/Services/Auth/AuthUIService.cs:205-216`, `:219-231`) rather than throwing
  ([ADR-013](013-result-pattern.md)). Any host using the shared router gets the route with **zero
  registration**, because the router's `AppAssembly` *is* `MMCA.Common.UI`
  (`.../MMCA.Common.UI/Routes.razor:7`); `AdditionalAssemblies` (`:8`) is the separate mechanism that
  discovers a consumer module's own pages. Nav entry at `Layout/NavMenu.razor:139`, route constant at
  `Common/RoutePaths.cs:16`, 23 localized keys in both `SharedResource.resx` and its `.es` sibling.

  Three of its choices are decisions rather than styling. The current device is marked with a **text**
  chip, not a colour (`Sessions.razor:48-54`), for WCAG 1.4.1. The current row offers **no revoke
  button at all**, only a hint (`:62-69`), because ending your own session would leave the app signed
  in until the access token expired, which reads as a broken sign-out. And a load failure renders
  **inline** through `ErrorSummary` with a retry button (`:16`, `:24-28`) rather than as a snackbar,
  because once a toast expires an empty table and a failed load look identical (`:14-15`); a failed
  reload clears the list rather than leaving stale rows a user could act on (`Sessions.razor.cs:87-90`).
- **A retention sweep ages the table out.** `RefreshSessionCleanupService`
  (`.../MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:48-52`) is a plain
  `BackgroundService` that waits one full interval before its first sweep, so cleanup never competes
  with startup or migration work (`:74-93`, reasoning at `:76-77`). It deletes rows that **stopped
  being usable** more than `RetentionDays` ago, in one set-based `ExecuteDeleteAsync` with no batching
  (`:120-124`, cutoff at `:104`). The predicate ages each row from the instant it stopped being
  usable: its revocation if it was revoked, otherwise its expiry, which is the wording the setting
  itself uses (`RefreshSessionSettings.cs:52-54`). That is a conditional, not the later of the two: a
  row revoked minutes ago survives even if it expired long before (`:97-100`), and a row revoked 31
  days ago is deleted even if its `ExpiresAt` is still in the future.

  `RetentionDays` defaults to 30 with `[Range(0, 3650)]`
  (`RefreshSessionSettings.cs:68-69`), swept every `CleanupIntervalHours` (default 6,
  `[Range(1, 168)]`, `:76-77`). Zero disables the sweep and logs that it did
  (`RefreshSessionCleanupService.cs:68-72`), as does `Enabled` being false (`:62-66`). Every sweep
  logs its count **including zero**, deliberately, because a log that speaks only when it deleted
  something gives an operator no evidence that retention is running at all (`:147-148`, argued at
  `:126-127`):

  ```text
  Purged {Count} refresh sessions that stopped being usable more than {RetentionDays} days ago
  ```

  Registration is gated on `Enabled` alone, not on `DataSourceName`
  (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:156-159`): registering unconditionally would
  start a sweep in every service of a modular host, all but one of which has no table to sweep
  (`:153-155`). `DataSourceName` is used only to resolve the source at sweep time, as the fallback
  when the entity registry has no entry (`RefreshSessionCleanupService.cs:136-139`), and a source that
  does not map the table warns once per sweep instead of failing with a translation error (`:114-118`).

## Rationale
- **A credential at rest is a credential.** Hashing is what turns a database read from "mint tokens
  for every signed-in user" into "hold a list of digests". The unsalted digest is the deliberate part:
  the token is 64 bytes of `RandomNumberGenerator` output (`TokenService.cs:117-121`), not a guessable
  password, so the property a salt buys (resistance to offline guessing of the input) is worth nothing
  here, while the property it costs (lookup by hash) is the entire access path
  (`IRefreshSessionStore.cs:26-35`).
- **One row per device is what a session actually is.** The single column made "signed in" an account
  fact and forced every second device through the compromise path. Rows make it a device fact, which
  is what both the user's mental model and any future "your devices" screen need
  (`RefreshSession.cs:7-10`).
- **A rotation chain is what makes replay detectable at all.** Because using a session revokes it and
  records its successor, a replayed token lands on a revoked row instead of on nothing, and "revoked"
  is a signal an unknown hash can never produce (`RefreshSession.cs:16-21`, and the store returning
  revoked rows on purpose, `IRefreshSessionStore.cs:26-31`). That distinction is what lets reuse
  revoke the family while a random string cannot.
- **Failing closed on reuse, open on the unknown.** Both branches return the same error, so a caller
  learns nothing about which one it hit (`AuthenticationServiceBase.cs:599-604`), but they behave
  differently where it matters: the branch an attacker can reach at will (post a random token) is the
  one that revokes nothing.
- **A cap that evicts beats a cap that refuses.** Refusing the eleventh sign-in would fail a
  legitimate login to protect a table; evicting the oldest live session bounds the growth and costs
  the user the device they used least recently (`RefreshSessionSettings.cs:23-29`).
- **Opt-in mapping is what keeps this one module's data.** Sessions belong to Identity. The outbox is
  configured on the base context because it is genuinely cross-cutting; copying that would have put an
  empty table in every other database's migrations
  (`RefreshSessionModelBuilderExtensions.cs:8-14`).
- **The behavior is pinned by tests at all three layers**: the entity's hashing, creation and
  revocation rules
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Auth/RefreshSessionTests.cs:13`), the login,
  rotation, reuse and cap workflow
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:24`,
  hash-only storage at `:164`, other devices left alone at `:178` and `:534`, cap eviction at `:194`,
  rotation at `:507`, replay revoking the family at `:552`, expiry and unknown tokens failing alone at
  `:573` and `:596`, per-device and all-device sign-out at `:645`, `:661` and `:677`), and the mapping
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionModelBuilderExtensionsTests.cs:14`).
- **The 2026-08-27 additions are pinned at five layers**, which is what lets the trade-offs above be
  stated as facts: the claim and the projection
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/RefreshSessionManagementTests.cs:26`,
  successor-not-predecessor `sid` at `:82`, a token with no `sid` still refreshing at `:104`,
  only-the-caller's-row-is-current at `:157`, no token material in the response at `:183`, another
  user's session answering not-found at `:244`, already-revoked succeeding without a write at `:260`);
  the claim reader
  (`.../MMCA.Common.Shared.Tests/Auth/ClaimsPrincipalExtensionsTests.cs:12`); the endpoints, including
  reflection theories that pin the two route templates and the `[Authorize]` attribute
  (`.../MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:18`, routes at `:305-308`,
  authorization at `:315-318`, the non-idempotent declaration at `:328`); the sweep, whose predicate
  semantics are settled by a test rather than by prose
  (`.../MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionCleanupServiceTests.cs:33`,
  `PurgeSweep_MeasuresARevokedRowFromItsRevocationNotItsExpiry` at `:124`, the zero-count log at
  `:155`, registration gating at `:182` and `:194`), with ownership scoping pinned against real SQLite
  (`.../Persistence/Auth/EFRefreshSessionStoreFindByIdTests.cs:20`, another user's session at `:40`,
  the tracked-instance requirement at `:74`); and the page
  (`.../MMCA.Common.UI.Tests/Pages/Auth/SessionsTests.cs:27`, the current row offering no revoke at
  `:140`, a failed reload not leaving stale rows at `:204`, a not-found revoke reading as
  already-signed-out at `:238`). A WCAG 2.1 AA scan of the page runs in the out-of-solution gallery
  suite (`.../MMCA.Common.UI.E2E.Tests/SessionsPageE2ETests.cs:13`), which means it runs in the
  `ui-e2e` CI job and **not** in a local `dotnet test --solution MMCA.Common.slnx`.

## Trade-offs
- **This is a breaking change with a data migration attached.** `IAuthUser` loses `RefreshToken`,
  `RefreshTokenExpiry`, `UpdateRefreshToken` and `RevokeRefreshToken` (`IAuthUser.cs:9-14`, the
  interface now being password material only at `:16-25`), so every consumer's `User` aggregate
  changes shape. The migration path is expand then contract (ADR-057): create the `RefreshSessions`
  table, carry the live tokens over by hashing them **in place** with the SQL equivalent of
  `HashToken` (which is why the encoding is documented as a contract, `RefreshSession.cs:151-157`),
  and only then drop the two user columns, with the `EXPAND-CONTRACT-OVERRIDE` marker that drop
  requires. A consumer that skips the carry step is not broken, but every signed-in user is signed
  out at deploy.
- **Reuse detection still revokes a family on a benign race.** Two client tabs refreshing near
  simultaneously, the second presenting the just-rotated-away token, is indistinguishable from theft
  and now signs out every device rather than one (`AuthenticationServiceBase.cs:484-491`). This is
  ADR-050's aggressive-by-design trade-off with a wider blast radius, kept deliberately: the
  alternative is a grace window in which a genuinely stolen token works.
- **"Nothing ages the table out" is retired (2026-08-27).** `RefreshSessionCleanupService` ships the
  sweep, so a consumer no longer schedules its own. The cap still bounds only the *live* set; the
  sweep is what bounds the dead one.
- **The retention window is also the reuse-detection window, and the shorter one wins.** Reuse
  detection works because a replayed token lands on a **revoked row**; delete that row and the same
  replay lands on nothing, which is the branch that deliberately fails alone. So retention silently
  caps how long a stolen token remains detectable as theft rather than as an unknown value. Both the
  setting and the service say so (`RefreshSessionSettings.cs:55-62`,
  `RefreshSessionCleanupService.cs:24-32`, cross-referenced from
  `AuthenticationServiceBase.cs:706-712`). The 30-day default is comfortably longer than the 7-day
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
  `sid` (`AuthenticationServiceBase.cs:76-80`). Nothing fails; the device list just marks no row as
  current for that consumer (`:171`-style behavior is pinned by
  `GetSessionsAsync_WithNoCurrentSessionId_MarksNothingCurrent`). That is the price of making the
  claim additive instead of changing an abstract signature every consumer implements, and the trade
  was taken deliberately.
- **Nothing validates `sid`, by design, so it is a hint and not an authorization input.** It is
  documented as additive and never validated (`AuthClaimTypes.cs:27-37`) and the reader answers null
  rather than throwing on a malformed value (`ClaimsPrincipalExtensions.cs:56-60`). A future
  temptation to authorize on it would need its own record: today a token whose session was revoked
  still validates until it expires, which is exactly ADR-047's revocation-gap posture.
- **The sessions page revokes without a confirmation step.** One click on a row's revoke button signs
  that device out; there is no dialog, and the only guard is the in-flight disable
  (`Sessions.razor:54`, `:74`, `:90`). The action is low-harm and recoverable (the user signs in
  again) and a confirm on every row would make the common case, tidying up old devices, tedious. It
  is still a destructive action with no undo.
- **Two gates have to agree, and only a scaffold says when they do not.** `RefreshSessions:Enabled`
  drives the runtime model (`ApplicationDbContext.cs:296-298`) and `EnableRefreshSessions` drives the
  design-time one (`DesignTimeDbContextOptions.cs:73`); a mismatch produces no startup error, just a
  migration that does not match the running model (`:69-71`).
- **The refresh path writes more than it did.** A rotation inserts one row and revokes another
  (`AuthenticationServiceBase.cs:535-563`), and every issue reads the user's live set to enforce the
  cap (`:584-591`), where the previous model wrote one column. The reads are index-covered
  (`RefreshSessionModelBuilderExtensions.cs:70-71`), but the refresh endpoint is no longer a
  single-row update.
- **The hash is confirmable, by design.** Anyone holding both a database read and a candidate token
  can verify the pairing, since the digest is deterministic and unsalted (`RefreshSession.cs:160-164`).
  That is the accepted cost of lookup-by-hash and it holds only because the input is high-entropy
  random; the same scheme applied to anything guessable would be wrong.

## Related
[ADR-050](050-jwt-refresh-token-rotation.md) (the single-column model this record replaces, and the
source of the rotation and reuse-detection policy it keeps),
[ADR-004](004-authentication-dual-fetch.md) (the stateless RS256 access token this flow reissues, and
the JWKS document the new `kid` header points into),
[ADR-006](006-database-per-service.md) (one sealed context class per engine, which is why the mapping
gate lives on the base context rather than in a consumer subclass),
[ADR-029](029-authentication-brute-force-protection.md) (the lockout and rate-limit checks that run
before a session is ever opened, in the same shared workflow,
`AuthenticationServiceBase.cs:120-125`),
[ADR-047](047-soft-deleted-user-session-revocation.md) (the middleware that bounds the access token's
revocation gap; a soft-deleted user's sessions stop refreshing because the refresh flow re-fetches
through the same query filter, which is why the delete handler does not revoke them itself,
`.../Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:82-86`),
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
