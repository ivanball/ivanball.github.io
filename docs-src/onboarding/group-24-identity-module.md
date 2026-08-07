# 24. ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

**What this chapter covers.** This is the **Identity bounded context** of MMCA.ADC, the module that
owns *who a person is* across every ADC surface: web, WebAssembly, and MAUI. It is a leaf in the
module dependency graph (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:11`)
but it touches every layer end to end, so this chapter doubles as a compact tour of one full vertical
slice built on the framework taught in groups 1 through 15. The single aggregate is
[`User`](#user), and around it sit the credential and refresh-token lifecycle, the role vocabulary,
the change-password / change-preferences / avatar use cases, the two privacy use cases that make ADC
compliant (data-subject **export** and **erasure**), the persistence and EF configuration, the REST
controllers, the gRPC contract that lets a peer service ask Identity a question, the integration
events that keep the User-to-Speaker link consistent across the service split, and the Blazor profile
and user-list UI. The per-type sections follow; this overview shows how the pieces fit and how a
request flows through them.

Almost everything here is an *instantiation* of upstream framework machinery, cross-referenced rather
than re-taught: the [`Result`](group-01-result-error-handling.md#result) pattern (G01), the
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
entity chain plus the [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and
[`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) governance markers (G02), the outbox
spine with [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (G04), the CQRS
command/query handler pipeline (G05), the shared auth engine
([`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser),
[`RoleValue`](group-08-auth.md#rolevalue),
[`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute),
[`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache)) from G08, the hoisted user use-case
bases ([`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand),
[`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand))
and the [`IModule`](group-14-module-system-composition.md#imodule) composition system (G14). The
lenses this chapter most strongly embodies are [Rubric §4, Domain-Driven Design] (a behavior-rich
aggregate that guards its own invariants), [Rubric §11, Security] (credential handling, RS256 JWTs,
permission-based authorization, a fail-closed OAuth link gate), and [Rubric §30, Compliance / Privacy
/ Data Governance] (the export and erasure flows). The `// BR-NN` markers quoted below are the
in-code business-requirement references, catalogued in the ADC business-requirements guide; the
privacy promises they implement live in `MMCA.ADC/PRIVACY.md`.

## Projects, one bounded context

The module is split along the standard Clean Architecture layering ([Rubric §3, Clean Architecture]),
each project pinned by a trivial [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) anchor pair
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/AssemblyReference.cs:5`, `:11`) that
Scrutor scanning and the architecture-fitness tests use to *name* the assembly.
**`MMCA.ADC.Identity.Domain`** holds the [`User`](#user) aggregate (`User.cs:26`), the
[`UserRole`](#userrole) value type (`UserRole.cs:17`), the [`UserInvariants`](#userinvariants) rule
class (`UserInvariants.cs:9`), and the [`UserDeleted`](#userdeleted) (`UserDeleted.cs:10`) /
[`UserPasswordChanged`](#userpasswordchanged) (`UserPasswordChanged.cs:9`) domain events; it depends
only on `MMCA.Common.Domain` and `MMCA.Common.Shared` and knows nothing of EF or ASP.NET.
**`MMCA.ADC.Identity.Application`** holds the use-case handlers, the Mapperly-generated
[`UserDTOMapper`](#userdtomapper)
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:13-14`,
[ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), the FluentValidation
validators, and the cross-module service implementations; its
[`DependencyInjection`](#dependencyinjection) registers four named services explicitly, including the
shared [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser)
closed over `User` (`MMCA.ADC.Identity.Application/DependencyInjection.cs:32-35`), and leaves
handlers, mappers, validators, and domain-event handlers to
`ScanModuleApplicationServices<ClassReference>()` (`:39`).
**`MMCA.ADC.Identity.Infrastructure`** holds the
[`ModuleApplicationDbContext`](#moduleapplicationdbcontext)
(`MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`), the
[`UserConfiguration`](#userconfiguration) EF mapping, and the
[`IdentityModuleDbSeeder`](#identitymoduledbseeder); its own registration hook is deliberately a
no-op, kept only so every module has the same shape
(`MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:20`). **`MMCA.ADC.Identity.API`** holds the
REST controllers, the [`IdentityModule`](#identitymodule) descriptor (`IdentityModule.cs:13`), and the
[`IdentityErrorResources`](#identityerrorresources) anchor whose `.resx` siblings translate domain
error codes into the supported languages (`IdentityErrorResources.cs:11`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
**`MMCA.ADC.Identity.Shared`** is the contract package every other layer (including the WebAssembly
client) can reference without dragging in the domain: it carries the DTOs, the
[`IAttendeeQueryService`](#iattendeequeryservice) cross-module interface
(`MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8`), the
[`UserRegistered`](#userregistered) integration event, and the
[`IdentityPermissions`](#identitypermissions) / [`IdentitySettings`](#identitysettings) constants (the
latter carrying the BR-213 registration budget, `MaxRegistrationsPerIpPerHour = 10`,
`IdentitySettings.cs:15`). Three more projects sit outside the module folder:
**`MMCA.ADC.Identity.Contracts`** (the gRPC adapter), **`MMCA.ADC.Identity.Service`** (the extracted
process host), and **`MMCA.ADC.Identity.UI`** (the Blazor pages). The identifier alias for this
context is `UserIdentifierType = int`, a database-generated identity
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
while the cross-context `LinkedSpeakerId` uses `SpeakerIdentifierType = System.Guid`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18`,
[ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).

## The User aggregate: credentials, profile, and cross-context links in one root

[`User`](#user) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:26`) is the
only aggregate root in the module, and it carries more responsibility than most: it is the credential
store (`PasswordHash` plus a per-user `PasswordSalt`, both `byte[]` mapped to `varbinary(max)`,
`User.cs:43`, `:46`), the refresh-token holder (`RefreshToken` / `RefreshTokenExpiry`, rotated by
`UpdateRefreshToken` at `User.cs:243` and cleared by `RevokeRefreshToken` at `:252`), the profile
(`Email`, `FirstName`, `LastName`, each marked
[`[Pii]`](group-02-domain-building-blocks.md#piiattribute), `User.cs:31`, `:35`, `:39`), the
preference store (`PreferredCulture` / `PreferredTheme`, `:93`, `:96`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) /
[ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), the avatar URL holder (`:105`,
also `[Pii]`, BR-116a,
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), the optional
MAUI device-metadata bag (`:66-84`), the external-OAuth link (`LoginProvider` / `ProviderKey`, `:87`,
`:90`), and the 1:1 cross-context `LinkedSpeakerId` pointing at a Conference speaker (`:63`, BR-207 /
BR-208 / BR-209). Every property has a private setter, so state changes only through the aggregate's
own methods: encapsulation as a compile-time guarantee ([Rubric §4, Domain-Driven Design], [Rubric §1,
SOLID]). Its interface list is what binds the aggregate to the shared G08 user workflows,
[`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser),
[`IUserPreferences`](group-08-auth.md#iuserpreferences), and
[`IErasableUser`](group-08-auth.md#ierasableuser) (`User.cs:27`); the third one is declared on *this*
type rather than inherited, and the class comment explains why it has to be (`:16-24`): `Delete()`
**hides** the base soft-delete with `new` (`:357`), so only re-listing the interface here re-maps the
workflow onto this type's own member and keeps the refresh-token revocation in the erasure path.

It follows the standard framework shape: a private EF constructor (`User.cs:113`), a private state
constructor (`:123`), and static factory methods returning
[`Result<T>`](group-01-result-error-handling.md#result). `Create` (`:156`) validates every invariant
with `Result.Combine(...)` *before* constructing anything (`:165-172`), so an invalid user is
unrepresentable; `CreateExternal` (`:198`) builds an OAuth account with empty credential arrays
(`:216`). A subtlety worth carrying forward: the factory deliberately does **not** raise a
registration event. The `Id` is database-generated (`[IdValueGenerated]` at `:25`, `Id` set to
`default` at `:180`), so the cross-module [`UserRegistered`](#userregistered) is raised by the
application layer only after the insert has executed and a real id exists (`:142-148` records exactly
that). The behavior methods each guard their own rule: `ChangePassword` re-validates and raises
[`UserPasswordChanged`](#userpasswordchanged) (`:311-328`); `UpdatePreferences` validates against the
supported-culture allowlist and the light/dark theme values (`:281-294`); `Delete()` revokes the
refresh token as a security measure, calls the G02 soft-delete, and raises
[`UserDeleted`](#userdeleted) (`:357-367`).

[`UserInvariants`](#userinvariants) (`UserInvariants.cs:9`) is the co-located static rule class whose
methods each return a [`Result`](group-01-result-error-handling.md#result), several of them delegating
to the shared [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants)
(`UserInvariants.cs:45-59`). Centralizing each rule as a named, side-effect-free method is what makes
the domain exhaustively unit-testable ([Rubric §14, Testability]), and its `const` length limits
(`FirstNameMaxLength = 100`, `LastNameMaxLength = 100`, `EmailMaxLength = 100`,
`DeviceFieldMaxLength = 256`, `UserInvariants.cs:12-21`) are the *same* constants
[`UserConfiguration`](#userconfiguration) uses for the EF column widths (`UserConfiguration.cs:22`,
`:27`, `:32`) and [`RegisterRequestValidator`](#registerrequestvalidator) uses for the request-shape
rules (`MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:16-19`), so the
domain rule, the request contract, and the schema cannot drift apart. [`UserRole`](#userrole)
(`UserRole.cs:17`) is a value object over the shared [`RoleValue`](group-08-auth.md#rolevalue) base
that fixes the ADC role set to three members: `Organizer` (`:20`), `Attendee` (the registration
default, `:23`), and `ContentEditor` (`:30`), a strict capability subset that curates the session
catalog but cannot change event structure, rooms, feedback questions, run session selection, or read
the user list (`:25-30`). Its `IsOrganizer(string?)` helper (`:76`) does a case-insensitive compare,
because raw JWT role claims may carry any casing, and it is the exact check the delete and export
authorization gates use.

## Authentication: a thin subclass over the shared engine

The login / registration / refresh / revocation workflow is *not* re-implemented here. It lives in
[`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser) (G08), which owns
the validate-first flow, the lockout and rate-limit protection
([ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)), and
the BR-205 / BR-206 refresh-token rotation with reuse detection
([ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html)); the ADC subclass
documents that division of labor at
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:12-33`.
[`AuthenticationService`](#authenticationservice) (`AuthenticationService.cs:35`) fills in only the
context-specific pieces: `CreateUser` supplies the `Attendee` default role (BR-45, `:89-96`),
`CreateAccessToken` attaches the `speaker_id` claim when the user is linked to a speaker (BR-209,
`:99-100` via the `SpeakerClaims` helper at `:251`), `OnUserRegisteredAsync` raises the
[`UserRegistered`](#userregistered) integration event (`:112-117`), and `ExternalLoginAsync` drives the
OAuth find-by-provider, else link-by-email, else create flow (`:130`,
[ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)).

Two details in that class are worth reading closely. First, **atomicity**: `RegisterAsync` wraps the
whole base workflow in `UnitOfWork.ExecuteInTransactionAsync` (`AuthenticationService.cs:57-63`), so
the user insert (first save) and the outbox row for `UserRegistered` (raised in
`OnUserRegisteredAsync` once the id exists at `:114`, then a second save at `:115`) commit together.
The event is not fire-and-forget after the fact, it is captured by the outbox inside the same
transaction ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); the class
remarks spell out the failure the design removes, namely a serialized `UserId = 0` payload that the
cross-service Conference consumer cannot resolve (`:21-33`). The external-login path does the same
through `ExternalLoginAsync` (`:137-139`, with the event raised at `:236` only for a brand-new
account). Second, **the link-by-email gate**: linking an external identity to an existing local
account on nothing but an email match would be an account-takeover path through any provider that
hands out unverified emails, so the flow consults
[`IExternalLoginEmailVerifier`](#iexternalloginemailverifier)
(`MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`) and returns
`Auth.ExternalEmailNotVerified` when the answer is no (`AuthenticationService.cs:196-205`). Its
implementation [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier)
(`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17`) lives at the API
edge because the assertion lives in the short-lived `ExternalLogin` cookie principal: it
re-authenticates that scheme and reads the `email_verified` claim (`:32-35`), and an absent claim,
absent principal, or non-request context all report unverified. It fails closed, which means GitHub
logins (whose OAuth payload carries no such assertion) never auto-link by design; the host maps
Google's `email_verified` and legacy `verified_email` payload keys onto that one claim
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:203-207`). Identity signs its tokens
with **RS256** and publishes the public key at `/.well-known/jwks.json`; peer services validate tokens
by fetching that document through the Gateway rather than sharing a secret (`Program.cs:32-36`,
`:182-184`, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [Rubric
§11, Security]). One `EmailExistsAsync` override deserves its own note, because the reason is the
opposite of the obvious one: it passes `ignoreQueryFilters: true` (`AuthenticationService.cs:85-86`)
*not* to keep an erased address reserved. Erasure always pairs `Delete` with `Anonymize`, which
rewrites the address to a placeholder, so a real erased email is re-registrable by design (GDPR). The
filter bypass exists so the two rows the unfiltered unique Email index would otherwise turn into a 500
(legacy rows soft-deleted without anonymization, and the placeholder addresses themselves) come back
as a clean conflict instead (`:77-84`).

The HTTP surface is equally thin. [`AuthController`](#authcontroller)
(`MMCA.ADC.Identity.API/Controllers/AuthController.cs:29`) extends
[`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
(G12), which supplies the login / register / refresh / revoke actions plus the three self-service
account actions (`PUT password`, `PUT preferences`, `GET preferences`, `AuthController.cs:20-24`); the
ADC subclass adds only two overrides and two command factories. `RegisterAsync` (`:52`) captures the
client IP for registration rate limiting (BR-213, `:57`) and carries the per-IP `auth-ip` fixed window
(`:48`); `LoginAsync` (`:76`) re-declares the same window as a password-spray guard, because the
per-email lockout alone cannot throttle one source spraying one password across many addresses
(`:66-69`). `CreateChangePasswordCommand` and `CreateChangePreferencesCommand` (`:82`, `:87`) are the
only wiring the base needs to dispatch [`ChangePasswordCommand`](#changepasswordcommand) and
[`ChangePreferencesCommand`](#changepreferencescommand) through the
[G05 decorator pipeline](group-05-cqrs-pipeline.md), where the preferences write declares
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a `User`-typed cache prefix
so a stale cached read cannot mask a preference change (`ChangePreferencesCommand.cs:15`, `:18`).
The password half is equally thin: [`ChangePasswordHandler`](#changepasswordhandler) is an empty
subclass of [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand)
whose only purpose is that the `source` reported on every error stays `ChangePasswordHandler`, which
clients match on (`ChangePasswordHandler.cs:12-23`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)).
[`OAuthController`](#oauthcontroller) (`OAuthController.cs:20`) is a body-less subclass of
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (G12) that drives the
Google/GitHub challenge, callback, complete, single-use-code-exchange flow; it is an ADC-only feature,
since MMCA.Store uses local credentials only. [`UserClaimsController`](#userclaimscontroller)
(`UserClaimsController.cs:16`) reflects the authenticated JWT's claims back to the client.
[`UsersController`](#userscontroller) (`UsersController.cs:30`) hosts the rest: the three avatar
endpoints, the organizer user list, the data export (`:148`), and the account delete (`:170`). Its
list endpoint is gated by capability rather than by role name,
`[HasPermission(IdentityPermissions.UsersRead)]` (`:124`), and the `identity:users:read` grant
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:11`) is handed to Organizer and Admin
in `AddModuleIdentityAPI` (`MMCA.ADC.Identity.API/DependencyInjection.cs:44-48`,
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)). That list
itself is served by [`GetUsersHandler`](#getusershandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:16`), which clamps the page
size at 500 through [`PagingMath`](group-03-querying-specifications.md#pagingmath) before touching the
database (`:28`, BR-11) and pushes filtering, `COUNT`, ordering, OFFSET/FETCH paging, and the
projection into SQL (`:34-57`), so the credential columns are never materialized ([Rubric §12,
Performance and Scalability]).

## The privacy pair: export and erasure

Two use cases make this module the codebase's clearest [Rubric §30, Compliance / Privacy / Data
Governance] story. The erasure workflow itself has been hoisted into
[`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand)
(G14); [`DeleteUserHandler`](#deleteuserhandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:25`) keeps the class
name so the reported error `source` stays stable for clients, and supplies exactly two ADC-specific
pieces (`:17-24`). `HasDeletePrivilege` (`:38`) says the Organizer role bypasses the ownership rule,
delegating to `UserRole.IsOrganizer` so the claim's casing does not matter. `OnAfterSoftDeleteAsync`
(`:42`) queues two **after-commit** actions: writing the shared
[`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) marker so the API middleware rejects
requests still carrying an already-issued access token for the erased account (`:56-68`, BR-133,
[ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)), and
deleting the avatar blob (`:70-73`, BR-116a). Both are best-effort by construction: the deletion is
already committed when they run, so a cache fault is logged rather than turned into a failure the
caller would retry (`:52-55`, `:64-67`). Note the ordering detail at `:50`: the blob name is captured
*before* `Anonymize` clears the URL. The erasure itself lives in `User.Anonymize()`
(`User.cs:380`), which irreversibly overwrites the personal fields with placeholders **in place**
rather than hard-deleting the record. Keeping the row lets cross-context scalar references (bookmarks,
notifications) and the audit trail survive; the replacement email embeds the user id
(`deleted-{Id}@anonymized.invalid`, `:385`) so the unique-email invariant still holds across many
erased accounts, and the operation is idempotent (an already-anonymized user short-circuits at
`:392-395`). This is the anonymize-in-place model of
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), backed by the
[`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) marker, and it satisfies the
PRIVACY.md §5 "delete within 30 days" promise.

[`ExportUserDataHandler`](#exportuserdatahandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:26`) is the
data-subject *access* request (PRIVACY.md §7). It is a query handler (it never calls `SaveChanges`,
`:47-49`), it applies the same owner-or-Organizer rule (`:38-45`), and it projects the user's
Identity-owned data into a [`UserDataExportDTO`](#userdataexportdto) (`:61-89`), **deliberately
excluding** credentials: no password hash, no salt, no refresh token, no provider key
(`UserDataExportDTO.cs:5-7`). What makes it instructive is the cross-service aggregation: it also
gathers the Engagement section (bookmarks and submitted session questions, through
[`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice), `:58`)
and the Notifications section (inbox rows, through
[`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice), `:59`),
and it does so **best-effort per section**. If a peer stays unreachable after the standard Polly
resilience pipeline, the catch block logs a warning and returns a section marked `Available = false`
(`:120-126`, and the same shape in the notification twin at `:152-158`) and the export still succeeds,
so one peer outage never fails the whole request. That is [Rubric §29, Resilience] and [Rubric §7,
Microservices Readiness] applied to a compliance workflow. One small correctness detail sits at
`:80-86`: SQL Server hands audit timestamps back as `Kind=Unspecified`, so the handler re-stamps them
UTC, which is the only reason the exported JSON carries the `Z` marker the DTO documents.

## Avatars: the third mutating slice

The avatar trio is a small but complete example of a file-handling slice ([Rubric §11, Security] at the
content boundary,
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
[`UsersController`](#userscontroller) caps the multipart upload at 2 MB in two places, declaratively
via `[RequestSizeLimit(MaxAvatarBytes)]` and imperatively via an explicit length check that returns an
`Avatar.InvalidUpload` validation error (`UsersController.cs:40`, `:66`, `:77-83`, BR-116a).
[`SetUserAvatarHandler`](#setuseravatarhandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16`) never trusts
the client-declared content type: it sniffs magic bytes through the shared
[`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer) (`:32`), re-encodes to a
canonical 256x256 JPEG via [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor) (`:23`,
`:52`), uploads under a randomized blob name through
[`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) (`:60-66`), and only then
persists the new URL, deleting the replaced blob *after* the save so a failure leaks one orphaned
image rather than breaking a live avatar (`:74-83`). The random suffix means a replacement never
reuses the old URL, so stale caches self-resolve (`:10-14`).
[`RemoveUserAvatarHandler`](#removeuseravatarhandler) and
[`GetUserAvatarHandler`](#getuseravatarhandler) are the trivial siblings on the same resource.

## Persistence, seeding, and the disabled stub

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:15`) is the
abstract, engine-agnostic context declaring the single `Users` set (`:22`); the concrete per-engine
class (`SQLServerDbContext` today) inherits it, and the base
[`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) supplies audit stamping,
soft-delete query filters, and outbox / domain-event dispatch via interceptors (`:9-13`, `:20`).
Identity owns its own `ADC_Identity` database with its own `dbo.OutboxMessages`, so it never races
another service's outbox (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:32`,
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
[`UserConfiguration`](#userconfiguration)
(`MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12`) extends
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype),
maps the [`Email`](group-02-domain-building-blocks.md#email) value object through a value converter
(`:20-24`), mirrors the invariant length constants onto the columns, ignores the computed `FullName`
and `IsExternalLogin` members (`:112-113`), and pins four indexes that encode business rules as schema
([Rubric §8, Data Architecture]): unique `Email` (`:115`), a filtered index on `RefreshToken` for the
refresh lookup (`:117-118`), a filtered **unique** index on `LinkedSpeakerId` that enforces the 1:1
User-to-Speaker relationship of BR-208 (`:120-122`), and a filtered unique composite on
`(LoginProvider, ProviderKey)` for external accounts (`:124-126`).

Seeding is gated, not ambient. [`IdentityModuleSeeder`](#identitymoduleseeder)
(`MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14`) returns immediately unless
`Seeding:IncludeSampleUsers` is set (`:28-30`, defaulting to false so a production service that sets
nothing seeds nothing), and only then runs [`IdentityModuleDbSeeder`](#identitymoduledbseeder)
(`MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27`), a
subclass of [`IdentityModuleDbSeederBase<TUser>`](group-07-persistence-ef-core.md#identitymoduledbseederbasetuser)
that contributes only the three-account list (`:33-38`), the existence predicate (`:41`) and ADC's
`User.Create` parameter order (`:51`); the check-then-insert idiom in the base is what makes the
seeder idempotent, and the deliberately weak development credentials are documented in its own
remarks (`:21-25`). Note the base's `ShouldSeed` is deliberately *not* overridden, so the
configuration gate has exactly one home (`:17-19`). When the Identity module is *disabled* in a host,
the [`IdentityModule`](#identitymodule) descriptor registers the
[`DisabledAttendeeQueryService`](#disabledattendeequeryservice) null-object stub through
`RegisterDisabledStubs` (`IdentityModule.cs:19-20`), so a consumer that only needs the attendee list
still composes.

## Crossing the service boundary: gRPC and integration events

Identity talks to its peers two ways, and both live in `Shared` and `Contracts` so neither side reaches
into the other's domain ([Rubric §7, Microservices Readiness]). **Synchronously**, the Notification
service needs the set of active attendee user ids; it depends on the
[`IAttendeeQueryService`](#iattendeequeryservice) interface, implemented in-process by
[`AttendeeQueryService`](#attendeequeryservice)
(`MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11`), a projected read of ids for users
in the `Attendee` role (`:17-20`). Once Identity runs as its own process, the composition root swaps in
[`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter)
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14`), which
implements the *same* C# interface over a generated client and pins a 5-second per-call deadline
(`:20`) far tighter than the shared resilience budget so a hung peer fails fast rather than stalling a
broadcast notification; [`AttendeesGrpcService`](#attendeesgrpcservice)
(`MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19`) serves the other end by delegating to the
in-process implementation (`:30`), and the host maps it with `RequireAuthorization()` at
`Program.cs:318`. The swap itself is the Contracts-layer
[`DependencyInjection`](#dependencyinjection)`.AddIdentityAttendeeClient`
(`MMCA.ADC.Identity.Contracts/DependencyInjection.cs:41`), which uses `Replace` rather than `TryAdd`
so it overwrites both the real service and the disabled stub (`:47`), and which must run after
`ModuleLoader.DiscoverAndRegister` (`:33-37`). Consumer code never changes, only the registration does
([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). The extracted
host runs h2c-only for cross-service gRPC, with an optional HTTP/1.1-only health-probe listener, both
configured by one call to
[`KestrelEndpointExtensions`](group-16-aspire-orchestration.md#kestrelendpointextensions)`.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)`
(`Program.cs:81`, rationale at `:71-80`,
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)), and it primes its own
request pipeline at startup: [`SelfHttpWarmupTask`](#selfhttpwarmuptask)
(`MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:23`), a
[`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) subclass, replays
the organizer user-list read against its own Kestrel endpoint (`:33-36`) and holds `/health/ready`
not-ready until it has had its chance, deliberately accepting the expected 401 by turning
`RequireSuccessStatusCode` off (`:49`) because the JIT cost lives in the traversal, not the response
([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html), [Rubric §12,
Performance and Scalability]).

**Asynchronously**, the User-to-Speaker link is kept consistent by events, not by a cross-database
foreign key. When a user registers, [`AuthenticationService`](#authenticationservice) raises
[`UserRegistered`](#userregistered)
(`MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23`, a
[`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent)) on the aggregate, and the
outbox carries it to Conference, whose
[`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler) runs the speaker
email-match auto-link (BR-207). Conference then publishes
[`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) /
[`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) back, which
[`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler)
(`MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20`)
and [`SpeakerUnlinkedFromUserHandler`](#speakerunlinkedfromuserhandler) consume to set or clear
`User.LinkedSpeakerId`, so the `speaker_id` claim appears on the *next* token issued (eventual
consistency, BR-209). These handlers open their own DI scope (`SpeakerLinkedToUserHandler.cs:31`) and
are idempotent, returning early when the link already matches (`:43-46`). Their error policy is worth
copying: the exception filter **logs and returns false**, so the exception keeps propagating
(`:53-57`, `:76-80`). The remarks explain the bug that motivated it (`:63-75`): swallowing meant one
transient database fault lost the BR-209 back-link permanently, because the delivery had already been
acked. Letting the exception through hands the decision to the delivery mechanism, which leaves the
inbox row unprocessed so MassTransit redelivers and then dead-letters. The host registers both as
broker consumers (`Program.cs:273-277`). This event-carried link is what lets the bidirectional
User-to-Speaker relationship survive the service split ([Rubric §6, CQRS and Event-Driven],
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) /
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

## The UI edge

The Blazor surface is registered as an [`IdentityUIModule`](#identityuimodule)
(`MMCA.ADC.Identity.UI/IdentityUIModule.cs:13`), an
[`IUIModule`](group-15-common-ui-framework.md#iuimodule) descriptor that contributes two
[`NavItem`](group-15-common-ui-framework.md#navitem)s as resource keys, "My Profile" for every
signed-in user and "Users" for Organizers (`:15-19`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), their routes coming from
the [`IdentityRoutePaths`](#identityroutepaths) constants `/users` and `/profile`
(`IdentityRoutePaths.cs:8-9`), with the UI-layer [`DependencyInjection`](#dependencyinjection) wiring
the module descriptor and the user service (`MMCA.ADC.Identity.UI/DependencyInjection.cs:23`, `:26`).
The [`Profile`](#profile) page (`MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15`) lets an
authenticated user change their password, manage their avatar, and delete their account. It mirrors the
server's 2 MB cap client-side before any upload starts (`:25`, `:125-129`), validates the new password
inline for length and confirmation match so the form error summary carries the message rather than a
server round-trip (`:43-49`, `:200-209`), and accepts an image from either a browser file input
(`:117`) or, on MAUI, the camera and gallery through
[`IMediaPickerService`](group-26-device-capability-layer.md#imediapickerservice) (`:19`, `:86`, `:88`).
It talks to the API through the [`IUserUIService`](#iuseruiservice) abstraction implemented by
[`UserService`](#userservice) (`MMCA.ADC.Identity.UI/Services/UserService.cs:14`), an
[`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) subclass that
attaches the bearer token and calls the REST `users` resource (`:17`), and which deliberately skips the
retry policy on the avatar upload because a picker stream is single-shot and cannot rewind
(`:106-112`). [`UserList`](#userlist) (`MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`) is the
Organizer-only management grid: a
[`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over
`UserListDTO` with server-side filtering, sorting, and paging on a desktop data grid (`:47-64`), plus a
[`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
card layout on mobile viewports (`:67-72`), the two kept in sync by the shared
[`ListPageActions`](#listpageactions) helper (`:39`, `:76`), which lives in Identity.UI because that
project is the root of the ADC module-UI reference chain
(`MMCA.ADC.Identity.UI/Common/ListPageActions.cs:6-12`). The UI targets WCAG 2.1 AA; the login and
register flows are scanned by the shared `MMCA.Common.Testing.E2E` workflow bases and the profile page
has its own axe-core scan in ADC's suite
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:215`, with the rationale for
not inheriting the Common profile base at `:217-218`), all of it running in the deploy-gating chromium
E2E leg ([Rubric §21, Accessibility], [Rubric §22, Responsive and Cross-Browser]).

## End-to-end: one registration

To see the chapter cooperate, follow a new attendee signing up. [`AuthController`](#authcontroller)
receives the `register` POST, captures the client IP for BR-213 rate limiting
(`AuthController.cs:57`), and calls `RegisterAsync` on
[`AuthenticationService`](#authenticationservice), which opens one transaction
(`AuthenticationService.cs:61`) and hands off to the shared G08 engine. The request shape was already
checked by [`RegisterRequestValidator`](#registerrequestvalidator) (`RegisterRequestValidator.cs:12`)
in the pipeline, so the engine only has to confirm the email is not taken
(`AuthenticationService.cs:85-86`), call `User.Create(...)` with the `Attendee` role (`:89-96`), hash
the password through the shared `IPasswordHasher`
([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)), add the aggregate, and
save. Only *after* that first save, when the EF identity id exists, does `OnUserRegisteredAsync` raise
[`UserRegistered`](#userregistered) and save again (`:112-117`); both saves sit inside the one
transaction, so the user row and its outbox row commit atomically
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). The first token
returned does not yet carry `speaker_id`. Asynchronously, Conference matches the email to a speaker and
publishes `SpeakerLinkedToUser`; [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler) sets
`User.LinkedSpeakerId` (`SpeakerLinkedToUserHandler.cs:48`), and the attendee's *next* token carries
the claim (`AuthenticationService.cs:99-100`). No password left the domain in plaintext, no
cross-database foreign key was written, no event was hand-dispatched, and the same code path behaves
identically whether Identity runs inside the monolith or as its own service, which is exactly the
property the framework groups (G01 through G15) exist to provide. For the *why* behind each choice,
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox),
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) (JWKS),
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (soft-delete versus
erasure), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) /
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) /
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
(database-per-service, gRPC extraction, service topology),
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) (mixed Kestrel endpoint
profile), [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)
(permission registry),
[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) (startup warm-up and
readiness), [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) /
[ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) (culture and theme),
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) (login
protection), [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) (external
OAuth login), [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)
(file storage and avatars), and
[ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)
(soft-deleted session revocation) are the primary references.

### AssemblyReference
> MMCA.ADC.Identity.{API,Application} · `MMCA.ADC.Identity.{API,Application}` · `MMCA.ADC.Identity.API/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the per-layer assembly marker, one static class holding the layer's own `Assembly` and its `AssemblyName` string. It carries no behavior; it exists so reflection-driven code can name an assembly without a magic string. This unit covers the **API** and **Application** copies (the Domain and Infrastructure copies are byte-identical and belong to their own layers).

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AssemblyReference` (API) | `MMCA.ADC.Identity.API/AssemblyReference.cs:5` | resolves to `MMCA.ADC.Identity.API` |
| `AssemblyReference` (Application) | `MMCA.ADC.Identity.Application/AssemblyReference.cs:5` | resolves to `MMCA.ADC.Identity.Application` |

- **Depends on**: `System.Reflection` only (BCL, imported at `AssemblyReference.cs:1`). No first-party types.
- **Concept introduced, the assembly marker.** The pattern is taught for the framework's own layers in [G14](group-14-module-system-composition.md#assemblyreference); this is its Identity realization. `Assembly` is initialized from `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), so it always resolves to the assembly that *declares* the marker: that is why the type is duplicated per layer instead of shared, and why the two copies differ only in their `namespace` line (`:3`). `[Rubric §15, Best Practices & Code Quality]` (assesses idiomatic, low-ceremony conventions): a `typeof` handle survives a project rename, an `Assembly.Load("MMCA.ADC.Identity.Application")` string does not.
- **Walkthrough**: two `public static readonly` fields, `Assembly` (`:7`) and `AssemblyName = Assembly.GetName().Name ?? string.Empty` (`:8`). The null-coalescing guard is there because `AssemblyName.Name` is declared nullable in the BCL, and the repo compiles with warnings as errors, so the nullable flow has to be closed rather than suppressed.
- **Why it's built this way**: static readonly fields are computed once at type initialization, so the reflection cost is paid a single time per process rather than at every scan site.
- **Where it's used**: as the stable handle for assembly-scanning code (Scrutor convention registration, EF configuration discovery, architecture fitness tests). The scanning call itself takes the sibling [`ClassReference`](#classreference) as its generic argument.

---

### ClassReference
> MMCA.ADC.Identity.{API,Application} · `MMCA.ADC.Identity.{API,Application}` · `MMCA.ADC.Identity.API/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty, member-less class that exists purely to be a *type argument*. Generic scanning APIs of the shape `DoSomething<T>()` derive the target assembly from `typeof(T).Assembly`, so each layer ships its own `ClassReference` to point such a call at itself.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `ClassReference` (API) | `MMCA.ADC.Identity.API/AssemblyReference.cs:11` | declared but not referenced by the API layer's own registration |
| `ClassReference` (Application) | `MMCA.ADC.Identity.Application/AssemblyReference.cs:11` | the `T` in `ScanModuleApplicationServices<ClassReference>()` |

- **Depends on**: nothing. `public class ClassReference { }`, no base type beyond `object`, no members.
- **Concept introduced**: cross-reference [`AssemblyReference`](#assemblyreference) above. The two solve the same problem from opposite directions: `AssemblyReference` hands out an `Assembly` *value*, `ClassReference` hands out a *type* that a generic method can turn into one without the caller ever mentioning `System.Reflection`.
- **Walkthrough**: the whole declaration is one line (`AssemblyReference.cs:11`), sharing the file with its `AssemblyReference` sibling. It is deliberately neither `static` nor `sealed`: a static class cannot be used as a generic type argument at all, and sealing would buy nothing for a type that is never instantiated.
- **Why it's built this way**: `ScanModuleApplicationServices<T>()` reads better and refactors more safely than passing an `Assembly` argument, and a dedicated empty type avoids accidentally anchoring the scan to some real class that might later move to another project.
- **Where it's used**: the Application copy is the type argument at `MMCA.ADC.Identity.Application/DependencyInjection.cs:39`, which resolves to `ScanModuleApplicationServices<TAssemblyMarker>` in `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:114` (see [`DependencyInjection`](#dependencyinjection) for the Application layer).
- **Caveats / not-in-source**: whether the API-layer copy has an active consumer is `Not determinable from source` within this unit; the API registration (`MMCA.ADC.Identity.API/DependencyInjection.cs:42-58`) does not reference it.

---

### ExportUserDataQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:10` · Level 0 · record (sealed)

- **What it is**: the request object for the data-subject export, one of the two privacy use cases that make ADC compliant. It names the user whose data is being exported *and* carries the authenticated caller's identity so the handler can run the owner-or-organizer check itself.
- **Depends on**: the `UserIdentifierType` alias (`= int`, see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). Nothing else: three positional parameters, no BCL types beyond `record`.
- **Concept introduced, carrying the caller's identity *in* the query rather than reading it inside the handler.** `[Rubric §11, Security]` (assesses whether authorization is an explicit, testable decision rather than an ambient one) and `[Rubric §3, Clean Architecture]` (assesses dependencies pointing inward). The obvious alternative would be to inject `ICurrentUserService`, or an `HttpContext`, into [`ExportUserDataHandler`](#exportuserdatahandler). Instead the controller reads the principal at the edge and stamps `CurrentUserId` and `CurrentUserRole` onto the query (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:161`), so the Application layer sees only plain data. The rule then unit-tests as pure input to output, with no HTTP fixture at all `[Rubric §14, Testability]`. `[Rubric §30, Compliance / Privacy / Data Governance]`: the doc comment (`ExportUserDataQuery.cs:3-9`) pins the use case to `PRIVACY.md §7` (data-subject access and portability), so the code carries its own compliance provenance.
- **Walkthrough**: a three-parameter positional record (`:10-13`). `UserId` is the export subject, taken from the route (`{userId}`). `CurrentUserId` is the caller, a non-nullable `UserIdentifierType` because the controller has already rejected an unauthenticated call with `Unauthorized()` (`UsersController.cs:156-158`). `CurrentUserRole` is `string?` because a role claim may simply be absent from a token; the handler treats absent as "not an organizer" rather than throwing.
- **Why it's built this way**: separating "who is asking" (from the JWT) from "whose data" (from the route) makes the authorization test a one-line comparison, and keeping both on the query means the identical rule applies no matter which transport dispatches it.
- **Where it's used**: constructed by [`UsersController`](#userscontroller)'s `ExportAsync` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:160-162`) and handled by [`ExportUserDataHandler`](#exportuserdatahandler).

---

### GetUserAvatarQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarQuery.cs:5` · Level 0 · record (sealed)

- **What it is**: the smallest query in the module, a single-field request for the current user's avatar state (BR-116a).
- **Depends on**: the `UserIdentifierType` alias only.
- **Concept introduced**: nothing new. It is the compact counterpart to [`ExportUserDataQuery`](#exportuserdataquery) above, which teaches the "identity travels on the query" idea in full. The one detail worth naming is stated by the parameter doc itself (`GetUserAvatarQuery.cs:4`): `UserId` is "stamped by the controller, never client-supplied". `[Rubric §11, Security]`: because the endpoint is `me/avatar` and the id comes from `ICurrentUserService` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:47-52`), there is no request shape in which one user can ask for another user's avatar. The safety property is structural, not a check that could be forgotten.
- **Walkthrough**: one line (`:5`), `public sealed record GetUserAvatarQuery(UserIdentifierType UserId);`. No validator, because there is no client-supplied field left to validate.
- **Why it's built this way**: giving even a one-field read its own named query type keeps every use case discoverable in the same place and lets the CQRS decorator pipeline (logging, caching) address it by type like any other.
- **Where it's used**: constructed by [`UsersController`](#userscontroller)'s `GetAvatarAsync` (`UsersController.cs:51-53`), handled by [`GetUserAvatarHandler`](#getuseravatarhandler).

---

### IdentityErrorResources
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Resources` · `MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` · Level 0 · class (sealed)

- **What it is**: an empty "resource anchor" type for the Identity module's localized error messages. It has no members; its only job is to be a `typeof(...)` handle that the localization layer uses to find the co-located `.resx` files ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. At runtime its `.resx` siblings are loaded through `System.Resources` and `IStringLocalizerFactory` (BCL and ASP.NET Core).
- **Concept introduced, edge error-message localization keyed by error `Code`.** `[Rubric §27, Internationalization]` (assesses whether user-facing strings, error text included, are translated rather than English-only). [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) localizes failures **at the API edge**: a domain [`Error`](group-01-result-error-handling.md#error)'s `Code` (for example `"User.Email.Empty"`) is the resource key, and the shared [`IErrorLocalizer`](group-12-api-hosting-mapping.md#ierrorlocalizer) looks that key up across every registered resource source before the failure is written into the ProblemDetails response. Each module contributes translations *additively* by registering its own anchor type, so Identity's strings live in `IdentityErrorResources.resx` and `IdentityErrorResources.es.resx` rather than in one central framework file that every module would have to edit.
- **Walkthrough**: the class body is empty (`IdentityErrorResources.cs:11-13`); everything worth knowing is in the doc comment (`:3-10`), which records two design points. Keys are the domain error `Code`. And **runtime-variable messages** (those that interpolate a user-supplied value) are deliberately omitted from the `.resx` so they degrade to their English message with the value intact instead of showing a broken or value-less translation.
- **Why it's built this way**: `AddErrorResources<TResource>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:103-108`) builds an `IStringLocalizer` from `typeof(TResource)` and appends it as one more `ErrorResourceSource` singleton (`:105-106`); the convention "a `.resx` named after the type, sitting beside it" is what binds the strings, so an empty marker class is exactly enough. The framework registers its own `ErrorResources` the same way inside `AddErrorLocalization()` (`:88-94`), which is what makes the mechanism additive rather than replace-only.
- **Where it's used**: registered at startup by the extracted Identity host, `services.AddErrorResources<IdentityErrorResources>()` (`MMCA.ADC.Identity.Service/Program.cs:233`).

---

### IExternalLoginEmailVerifier
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11` · Level 0 · interface

- **What it is**: a one-method port that answers a single question about the OAuth login currently in flight: did the external provider explicitly assert that this email address is verified? It is the gate that decides whether an external identity may be auto-linked to an existing local account.
- **Depends on**: nothing first-party. The single method returns `Task<bool>` and takes no arguments, deliberately: the "current external login" is ambient request state, resolved by the implementation, not passed by the caller.
- **Concept introduced, the account-takeover guard as an explicit port.** `[Rubric §11, Security]` (assesses whether authentication trust decisions are explicit and fail closed) and `[Rubric §3, Clean Architecture]` (assesses dependencies pointing inward). Linking an external identity to a local account on nothing but an email match is a takeover primitive: any provider that hands out unverified email addresses would let an attacker register the victim's address and inherit the victim's account. The verified-email assertion lives in the short-lived `ExternalLogin` cookie principal, which is an HTTP concern, so the *decision input* is declared here as an interface in the Application layer and *implemented* at the API edge. Application code stays free of `HttpContext`, and the security rule stays testable with a two-line fake. `[Rubric §1, SOLID]`: an interface with exactly one method and exactly one reason to change.
- **Walkthrough**: `Task<bool> IsCurrentExternalLoginEmailVerifiedAsync()` (`IExternalLoginEmailVerifier.cs:19`). The XML comment (`:13-18`) fixes the semantics precisely: `true` only when the provider *explicitly* asserts verification (Google's `email_verified` claim); providers that assert nothing (GitHub's OAuth flow) yield `false`. There is no third "unknown" state, unknown is treated as unverified.
- **Why it's built this way**: fail-closed by construction. Because the contract collapses "not verified" and "no assertion" into `false`, adding a new provider cannot silently open the auto-link path; it stays closed until someone deliberately maps a verification claim for it.
- **Where it's used**: consumed by [`AuthenticationService`](#authenticationservice) inside the external-login workflow (`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:196-197`); implemented by [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier), which re-authenticates the `ExternalLogin` scheme and parses the `email_verified` claim (`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:32-35`), returning `false` when there is no `HttpContext` (`:27-30`), no principal, or no parseable claim value.

---

### DependencyInjection
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/DependencyInjection.cs:18` · Level 2 · class (static)

- **What it is**: the **API-layer** composition root for the Identity module. It exposes `AddIdentityModule(...)`, the single call that registers every layer of the module, plus `AddModuleIdentityAPI()`, which declares the module's role-to-permission grants and wires the OAuth email-verification gate.
- **Depends on**: `IServiceCollection` and `TryAddScoped` (Microsoft.Extensions.DependencyInjection); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); the Application-layer `AddModuleIdentityApplication` (see [`DependencyInjection`](#dependencyinjection) for the Application layer) and the Infrastructure-layer `AddModuleIdentityInfrastructure`; `AddPermissions` from `MMCA.Common.API.Authorization`, plus [`IdentityPermissions`](#identitypermissions) and [`RoleNames`](group-08-auth.md#rolenames); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) and [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier).
- **Concept introduced, the layered DI fan-out via `extension(IServiceCollection)`.** `[Rubric §3, Clean Architecture]` (assesses inward-pointing dependencies and a single composition point per module): the API layer is the only layer that can see *all* the others, so it owns the aggregate registration. The method hangs off `IServiceCollection` through the C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:20`), the workspace idiom for DI registration (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `[Rubric §16, Maintainability]`: the three-call body mirrors the layering, so registration order matches dependency order and there is exactly one place to look when wiring changes.
- **Walkthrough**
  - `AddIdentityModule(ApplicationSettings)` (`:27-34`) calls `AddModuleIdentityApplication(applicationSettings)` (`:29`), `AddModuleIdentityInfrastructure()` (`:30`), and `AddModuleIdentityAPI()` (`:31`), then returns `services` for chaining (`:33`).
  - `AddModuleIdentityAPI()` (`:42-58`) does two things. First it calls `AddPermissions` and grants **every** capability in [`IdentityPermissions`](#identitypermissions) to both `RoleNames.Organizer` (`:46`) and `RoleNames.Admin` (`:47`) via the spread `[.. IdentityPermissions.All]`; today that list holds the single `identity:users:read` capability (`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:11-17`), and those grants are what back the module's `[HasPermission(...)]`-gated endpoints. Second it registers the OAuth auto-link gate: `AddHttpContextAccessor()` (`:54`) plus `TryAddScoped<IExternalLoginEmailVerifier, HttpContextExternalLoginEmailVerifier>()` (`:55`). The inline comment (`:50-53`) explains the placement: the verified-email assertion lives in the external-login cookie principal, so the verifier is an API-edge concern.
  - Controllers are not registered here; ASP.NET Core's controller convention discovers them (doc comment `:36-41`).
- **Why it's built this way**: one entry point per module is what [`IdentityModule`](#identitymodule) calls, so module wiring stays discoverable; declaring the role-to-permission grants inside the module that owns the endpoints keeps the capability model co-located with the code it protects instead of in a central authorization file every module must reach into. `TryAddScoped` (rather than `AddScoped`) leaves the door open for a host to pre-register a different verifier.
- **Where it's used**: `AddIdentityModule` is invoked by [`IdentityModule`](#identitymodule)'s `Register` (`MMCA.ADC.Identity.API/IdentityModule.cs:23-24`) during topological module registration by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).

---

### IdentityModule
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/IdentityModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's entry point, the concrete [`IModule`](group-14-module-system-composition.md#imodule) that the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) discovers by reflection and registers. Identity is a **leaf** in the module dependency graph: it declares no prerequisites (doc comment `IdentityModule.cs:9-12`).
- **Depends on**: [`IModule`](group-14-module-system-composition.md#imodule); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); its own [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule`; [`IAttendeeQueryService`](#iattendeequeryservice) and [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) from the Shared layer; `Microsoft.Extensions.Configuration` and `Microsoft.Extensions.DependencyInjection`.
- **Concept introduced, the disabled-module stub.** The module contract itself is taught in [G14](group-14-module-system-composition.md#imodule); the Identity-specific lesson is `RegisterDisabledStubs`. `[Rubric §7, Microservices Readiness]` (assesses whether modules compose and deploy independently): every ADC host boots the same module assemblies but enables only some of them. A host with Identity *disabled* still contains consumers that depend on `IAttendeeQueryService` (Notification needs the attendee id list for a broadcast), so this method registers [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) as a singleton (`IdentityModule.cs:19-20`), a stub that returns an empty list. DI validation succeeds, the consumer degrades gracefully, and in the extracted topology the composition root later *replaces* that stub with a gRPC-backed adapter (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:47`).
- **Walkthrough**: three members, all one-liners. `Name => "Identity"` (`:16`) is the topological-sort key and the value the loader logs. `RegisterDisabledStubs(IServiceCollection)` (`:19-20`) registers the stub singleton. `Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:23-24`) delegates straight to `services.AddIdentityModule(applicationSettings)`; note that the `IConfigurationBuilder` parameter is accepted and unused here, because Identity contributes no configuration sources of its own. No dependency-declaration members are overridden, so the interface defaults apply (a leaf). There is deliberately **no seeding here**: that is a separate [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder), [`IdentityModuleSeeder`](#identitymoduleseeder).
- **Why it's built this way**: the module boundary is what makes each module extractable into its own service host without a rewrite ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). In the extracted `MMCA.ADC.Identity.Service` only this module is enabled; every other service registers the disabled stub and then overwrites it with a gRPC client. Application code never learns which transport it got.
- **Where it's used**: discovered and registered in Kahn-topological order by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) at host startup; `RegisterDisabledStubs` runs in hosts where the Identity module is not enabled, for example `MMCA.ADC.Notification.Service` (`MMCA.ADC.Notification.Service/Program.cs:196-200`).

---

### AttendeeQueryService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` · Level 8 · class (sealed)

- **What it is**: Identity's in-process implementation of the cross-module [`IAttendeeQueryService`](#iattendeequeryservice) contract. It answers one question, "which user ids hold the Attendee role", and it is the only way another module gets that answer without touching the Identity domain.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (the Shared-layer contract); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the read side of [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype); [`User`](#user) and [`UserRole`](#userrole) (Domain); the `UserIdentifierType` alias.
- **Concept introduced, serving data across a module boundary through a Shared-layer contract.** `[Rubric §7, Microservices Readiness]` (assesses whether cross-module needs are met by explicit contracts rather than direct type references) and `[Rubric §3, Clean Architecture]`. Notification must fan a broadcast out to every attendee, but it must never reference `MMCA.ADC.Identity.Domain`. The interface therefore lives in `MMCA.ADC.Identity.Shared`, the implementation here in Application, and Notification sees only the interface (through its own `AttendeeNotificationRecipientProvider`, `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:11`). That indirection is exactly what later allows the same call to be satisfied over gRPC with no change at the call site. `[Rubric §12, Performance & Scalability]`: the query projects to ids in the database rather than materializing whole `User` rows, so the wire and the heap only ever carry integers.
- **Walkthrough** (primary-constructor injection of `IUnitOfWork`, `:11`)
  1. **Read repository** (`:16`), `unitOfWork.GetReadRepository<User, UserIdentifierType>()`, the read-only repository facade rather than the mutating one, so the intent is visible in the type.
  2. **Projected query** (`:17-20`), `GetProjectedAsync(u => u.Id, u => u.Role == UserRole.Attendee, cancellationToken: cancellationToken)`. The first lambda is the SELECT projection, the second the WHERE predicate; the global soft-delete query filter is left in force, so erased accounts are excluded automatically (that is what "active users" in the doc comment at `:7-10` means, since no explicit `IsDeleted` test appears here).
  3. **Shape the result** (`:22`), `userIds as IReadOnlyList<UserIdentifierType> ?? [.. userIds]`: the repository returns `IReadOnlyCollection<T>`, the contract promises `IReadOnlyList<T>`, so the cast is attempted first and a collection-expression copy is the fallback. No allocation when the underlying instance is already a list.
- **Why it's built this way**: pushing the role predicate and the id projection into the database keeps a broadcast cheap even as the attendee count grows, and relying on the global query filter for soft-delete means this service can never accidentally diverge from the rest of the system's definition of "deleted" ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Where it's used**: registered as the `IAttendeeQueryService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`MMCA.ADC.Identity.Application/DependencyInjection.cs:35`); consumed by the Notification module. In the extracted topology the registration is replaced by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), and this class becomes the code behind [`AttendeesGrpcService`](#attendeesgrpcservice) on the Identity side (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19`).

---

### ExportUserDataHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:26` · Level 8 · class (sealed, partial)

- **What it is**: the handler behind the GDPR-style data-subject export. It authorizes the caller, projects the user's Identity-owned personal data into a [`UserDataExportDTO`](#userdataexportdto), and then aggregates two **cross-service** sections (Engagement bookmarks and questions, Notification inbox rows) into the same document, degrading rather than failing when a peer is unreachable.
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); [`ExportUserDataQuery`](#exportuserdataquery); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user) and [`UserRole`](#userrole); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); [`UserDataExportDTO`](#userdataexportdto) with its [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto), [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), [`UserDataExportSubmittedQuestionDTO`](#userdataexportsubmittedquestiondto), [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto) and [`UserDataExportNotificationDTO`](#userdataexportnotificationdto) parts; the peer contracts [`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) and [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice); `Microsoft.Extensions.Logging` with the `[LoggerMessage]` source generator.
- **Concept introduced (1), the privacy export as a first-class use case.** `[Rubric §30, Compliance / Privacy / Data Governance]` (assesses whether privacy promises are implemented and traceable, not just documented). The doc comment (`ExportUserDataHandler.cs:12-25`) ties the handler to `PRIVACY.md §7` and states what the export deliberately **excludes**: password hash and salt, refresh token, and the external-provider key. That exclusion is enforced structurally, by hand-writing the projection (`:61-89`) instead of serializing the aggregate, so a future field added to [`User`](#user) cannot leak into an export by default. `[Rubric §9, API & Contract Design]`: the export is a plain typed DTO returned as JSON from `GET /Users/{userId}/export`, portable by construction.
- **Concept introduced (2), best-effort cross-service aggregation.** `[Rubric §29, Resilience & Business Continuity]` (assesses whether a dependency outage degrades a feature or breaks it) and `[Rubric §7, Microservices Readiness]`. The bookmarks, submitted questions, and notification rows live in *other* services' databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), reached through in-process interfaces that the extracted topology swaps for gRPC adapters (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:82`, `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:84`). Each section is fetched inside its own `try` (`:98-127` and `:133-159`) whose `catch` filter is `when (ex is not OperationCanceledException)`: a genuine cancellation still propagates, but any other failure after the standard Polly pipeline has already retried is logged and turned into a section with `Available = false` (`:125`, `:157`). One peer outage never fails the whole export, and the caller can *see* which section is incomplete rather than guessing. `[Rubric §13, Observability & Operability]`: the degradation is recorded through a `[LoggerMessage]`-generated warning (`:161-162`) carrying the section name and user id, which is why the class is declared `partial`.
- **Walkthrough** (primary constructor `:26-30`, body `:33-92`)
  1. **Authorize** (`:38-45`), `query.CurrentUserId != query.UserId && !UserRole.IsOrganizer(query.CurrentUserRole)` returns `Error.Forbidden("User.ExportForbidden", ...)`. `UserRole.IsOrganizer` is an ordinal case-insensitive comparison (`MMCA.ADC.Identity.Domain/Users/UserRole.cs:76`), so a differently-cased role claim still authorizes. The inline comment (`:37`) records that this is the same rule as account deletion.
  2. **Load the aggregate** (`:48-54`), `unitOfWork.GetRepository<User, UserIdentifierType>()` then `GetByIdAsync`, with a `null` result mapped to `Error.NotFound.WithSource(nameof(ExportUserDataHandler)).WithTarget(nameof(User))`. The comment at `:47` states the discipline explicitly: a query handler never calls `SaveChanges`.
  3. **Aggregate the peers** (`:58-59`), awaiting `GetEngagementSectionAsync` then `GetNotificationSectionAsync` in sequence.
  4. **Project** (`:61-89`), an object initializer over the aggregate's own fields (email value, names, role, external-login provider, linked speaker id, avatar URL, and the seven device-registration fields). Audit timestamps get `DateTime.SpecifyKind(..., DateTimeKind.Utc)` (`:83-86`) because SQL Server returns them as `Kind = Unspecified` and the DTO documents them as UTC; the comment (`:80-82`) is clear that the values are already UTC, so stamping the kind only restores the `Z` marker in the serialized output. `LastModifiedOn` is null-guarded because it is nullable until the first update.
  5. **Return** (`:91`), `Result.Success(export)`.
  6. **Section helpers** (`:94-127`, `:129-159`), each maps the peer's rows into the export's own DTO shapes with collection expressions over `Select`, so the export contract never re-exports a peer's internal type.
- **Why it's built this way**: aggregating at the owning module (Identity owns "the person") gives the data subject one endpoint instead of three, while database-per-service keeps each peer's data where it belongs. Making the aggregation best-effort per section is the same deliberate pattern as the best-effort live-channel publish elsewhere in ADC (named as such at `:20-21`): a privacy request should still produce a usable document during a partial outage.
- **Where it's used**: injected into [`UsersController`](#userscontroller) as `IQueryHandler<ExportUserDataQuery, Result<UserDataExportDTO>>` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:33`) and invoked from `ExportAsync` (`:160-162`); discovered by the Scrutor scan in the Application-layer [`DependencyInjection`](#dependencyinjection).
- **Caveats / not-in-source**: the handler resolves the tracked `GetRepository` (`:48`) rather than the read-only `GetReadRepository` its own comment implies; nothing writes, so the difference is change-tracking overhead, not behavior. Whether a peer call actually retries before throwing depends on the Polly pipeline configured on the gRPC client in the service host, which is not visible in this file.

---

### GetUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarHandler.cs:10` · Level 8 · class (sealed)

- **What it is**: the read side of the avatar feature (BR-116a). It returns the current user's avatar URL, or `null` inside a successful result when none is set.
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); [`GetUserAvatarQuery`](#getuseravatarquery); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user); [`UserAvatarDTO`](#useravatardto); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, "absent value" is a success, "absent row" is a failure.** `[Rubric §9, API & Contract Design]` (assesses whether responses distinguish states unambiguously). The two outcomes look similar from the outside but mean different things, and the handler keeps them apart: a user with no avatar yields `Result.Success(new UserAvatarDTO(user.AvatarUrl))` with a null URL inside (`:23`), which the controller returns as HTTP 200 and a JSON body; a user id that resolves to no row yields `Error.NotFound` (`:22`), which the shared failure mapping turns into a 404. The UI can therefore render the "no photo yet" placeholder without treating it as an error. Everything else here is standard CQRS read shape, taught in [G05](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult).
- **Walkthrough** (primary constructor `:10-11`, single method `:14-24`): resolve the read-only repository and load in one expression, `unitOfWork.GetReadRepository<User, UserIdentifierType>().GetByIdAsync(query.UserId, cancellationToken)` (`:18-19`); then a ternary (`:21-23`) mapping `null` to `Error.NotFound.WithSource(nameof(GetUserAvatarHandler)).WithTarget(nameof(User))` and a found user to `Result.Success(new UserAvatarDTO(user.AvatarUrl))`. Eleven lines of body, no branching beyond that.
- **Why it's built this way**: `GetReadRepository` states the intent in the type (contrast [`ExportUserDataHandler`](#exportuserdatahandler), which happens to take the tracked one), and the fluent `WithSource` / `WithTarget` error builders mean the edge can report *what* was missing without a bespoke error type per use case. Returning a DTO rather than the raw string leaves room to add avatar metadata later without changing the endpoint's shape ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: injected into [`UsersController`](#userscontroller) (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:36`) and invoked by `GetAvatarAsync` for `GET /Users/me/avatar` (`:43-58`); its write-side counterparts are the `SetUserAvatarCommand` and `RemoveUserAvatarCommand` handlers on the same controller (`:34-35`).

---

### AuthenticationService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35` · Level 9 · class (sealed)

- **What it is**: ADC's authentication service. The generic login, registration, refresh, and revocation workflow is inherited from [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser); this subclass supplies the ADC-specific pieces: the Attendee default role, the `speaker_id` claim, the outbox-atomic [`UserRegistered`](#userregistered) integration event, and the entire external OAuth login flow.
- **Depends on**: [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser) and [`IAuthenticationService`](group-08-auth.md#iauthenticationservice); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ITokenService`](group-08-auth.md#itokenservice), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), `TimeProvider` (BCL); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier); [`User`](#user), [`UserRole`](#userrole), [`UserRegistered`](#userregistered), [`Email`](group-02-domain-building-blocks.md#email), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and [`RegisterRequest`](group-08-auth.md#registerrequest); `System.Security.Claims`.
- **Concept introduced (1), the template-method base with app-specific hooks.** `[Rubric §2, Design Patterns]` (assesses whether recurring shapes use a named, understood pattern) and `[Rubric §16, Maintainability]`. The base owns the security-critical sequence: validate first, [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) lockout and registration rate limits, the dual-fetch pattern, and refresh-token rotation with reuse detection (class doc `AuthenticationService.cs:12-20`). What varies per application is expressed as hooks, and this class overrides exactly those:
  - `FindUntrackedByEmailAsync` (`:66-74`), an untracked read (`asTracking: false`) used by the login path.
  - `EmailExistsAsync` (`:85-86`), the registration uniqueness probe, run with `ignoreQueryFilters: true`.
  - `CreateUser` (`:89-96`), which fixes ADC's default role as `UserRole.Attendee` (BR-45).
  - `CreateAccessToken` (`:99-100`), which appends the `speaker_id` claim when the account is linked to a speaker; the claim is built by the private `SpeakerClaims` helper (`:251-252`), returning `null` when `LinkedSpeakerId` has no value so the claim is simply absent rather than empty (BR-209).
  - `OnUserRegisteredAsync` (`:112-117`), the post-save hook, below.
- **Concept introduced (2), bypassing the query filter for a uniqueness probe, and what that actually protects.** `[Rubric §8, Data Architecture]` and `[Rubric §30, Compliance / Privacy / Data Governance]`. Read the remark at `:77-84` carefully, because the intuitive reading is wrong. Erasure in ADC always pairs Delete with Anonymize, which rewrites the stored address to a placeholder, so an erased account's **real email is re-registrable by design**, which is exactly what a right-to-erasure promise requires. The `ignoreQueryFilters: true` bypass is not there to block that. It is there because the unique `Email` index is *unfiltered* at the database level, so two cases would otherwise sail past a filtered `EXISTS` check and then blow up as a 500 on insert instead of a clean 409-style conflict: legacy rows that were soft-deleted without anonymization, and the anonymized placeholder addresses themselves. Seeing past the filter turns a crash into a domain error.
- **Concept introduced (3), the outbox-atomic registration event, and why it needs two saves in one transaction.** `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience & Business Continuity]`. `User.Id` is a database-generated identity column, so at the moment the aggregate is created the id is still `0`. The outbox serializes an event's payload *at capture time*, so raising [`UserRegistered`](#userregistered) before the insert would persist `UserId = 0`, and the cross-service Conference consumer, which has no access to the Identity database to re-match by email, could never resolve it. The fix is visible in two places:
  - `RegisterAsync` (`:57-63`) re-implements the interface member with `new` and wraps the base implementation in `UnitOfWork.ExecuteInTransactionAsync(token => base.RegisterAsync(request, ipAddress, token), cancellationToken)`. The interface is re-listed on the class declaration (`:44`) specifically so this override wins for callers holding an [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), since the base method is not virtual; the trailing comment on that line says so.
  - `OnUserRegisteredAsync` (`:112-117`) runs *after* the base's first save, when the identity value exists: it calls `user.AddDomainEvent(new UserRegistered(user.Id, user.Email, user.FirstName, user.LastName, user.Role))` (`:114`), saves a second time so the outbox row is captured (`:115`), and returns the user (`:116`). Both saves sit inside the one transaction opened by `RegisterAsync`, so a crash before commit rolls back user and event together, and after commit the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) guarantees delivery. The class doc comment (`:21-33`) records that this replaced an earlier second-commit [`IEventBus`](group-04-events-outbox.md#ieventbus) publish whose crash window lost the speaker link permanently.
- **Concept introduced (4), the three-way external-login resolution with a takeover guard.** `[Rubric §11, Security]`. `ExternalLoginAsync` (`:130-139`) is again a transaction wrapper, this time around `ExternalLoginCoreAsync` (`:142-246`), which resolves the caller into exactly one of three cases:
  1. **Known external identity** (`:151-156`), a tracked lookup by `LoginProvider` **and** `ProviderKey`. Found means log in, nothing else runs.
  2. **Email matches an existing local account** (`:162-209`), the risky case, and it is guarded twice. First the raw claim is parsed through the value object: `Email.Create(email)` (`:171`) and, on failure, `Error.Validation("Auth.ExternalEmailInvalid", ...)` (`:174-178`). The comment (`:165-170`) explains why the `IsFailure` check rather than a bare `.Value`: `Result<T>.Value` is `null` on failure and does not throw, so an unparseable provider claim previously turned the lookup into "find the users whose email IS NULL" and matched on *absence* instead of identity. Unlike the local login and register paths, nothing has validated this address beforehand, because it arrives in an OAuth claim rather than in a FluentValidation-gated request. Second, before linking, it awaits `externalLoginEmailVerifier.IsCurrentExternalLoginEmailVerifiedAsync()` (`:196-197`) and, when the provider did not assert a verified email, returns `Error.Unauthorized("Auth.ExternalEmailNotVerified", ...)` (`:201-204`) telling the user to log in with their password instead. Only a verified assertion reaches `existingUser.LinkExternalProvider(loginProvider, providerKey)` (`:207`). The comment (`:190-195`) states the threat plainly.
  3. **Brand new user** (`:212-221`), `User.CreateExternal(...)`, with failure propagated as `Result.Failure<AuthenticationResponse>(userResult.Errors)` (`:216`), otherwise `Repository.AddAsync` and `isNewUser = true`.

  All three paths then converge (`:225-245`): mint and store a refresh token with `TimeProvider.GetUtcNow().UtcDateTime.Add(RefreshTokenLifetime)` (`:226`), save (`:228`), and, for a new user only, raise [`UserRegistered`](#userregistered) and save again (`:234-238`), the same post-identity pattern as local registration. Finally it mints the access token through `CreateAccessToken` (`:240`) and returns an [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) with the access-token expiry (`:242-245`).
- **Why it's built this way**: the base class keeps every application on one audited auth workflow, so a fix to lockout or refresh-token reuse detection lands once in `MMCA.Common` rather than per app; the hooks keep ADC's divergences (role, claim, event) small and named. The `UserRegistered` integration event, rather than an in-process domain event, is a deliberate divergence from MMCA.Store, because Conference runs in a separate process with its own database and can only learn about a registration asynchronously ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) outbox, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service). The eventual-consistency cost is explicit and documented at `:104-110` and `:123-128`: the first token issued does not yet carry `speaker_id`, and the claim appears on the next refresh once Conference has published `SpeakerLinkedToUser` back.
- **Where it's used**: registered as the `IAuthenticationService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`MMCA.ADC.Identity.Application/DependencyInjection.cs:32`); driven by [`AuthController`](#authcontroller) for local credentials and [`OAuthController`](#oauthcontroller) for the social paths.
- **Caveats / not-in-source**: whether `email_verified` is actually mapped for a given provider is host configuration, not visible here; the verifier's own doc comment (`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:12-14`) records that Google is mapped by a `PostConfigure<GoogleOptions>` claim action in the service host and that GitHub asserts nothing.

---

### DependencyInjection
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application` · `MMCA.ADC.Identity.Application/DependencyInjection.cs:18` · Level 10 · class (static)

- **What it is**: the **Application-layer** registration for Identity. It explicitly binds four services that convention scanning cannot infer, then runs Scrutor scanning to auto-register every handler, mapper, validator, and domain-event handler in the assembly.
- **Depends on**: `IServiceCollection` and `TryAddScoped`; [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) with [`AuthenticationService`](#authenticationservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) with the framework's generic [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser) closed over [`User`](#user), and [`IAttendeeQueryService`](#iattendeequeryservice) with [`AttendeeQueryService`](#attendeequeryservice); the `ScanModuleApplicationServices<TAssemblyMarker>` helper from `MMCA.Common.Application` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:114`); [`ClassReference`](#classreference).
- **Concept introduced, explicit registration for the ambiguous, convention scanning for the rest.** `[Rubric §2, Design Patterns]` and `[Rubric §16, Maintainability]`. Handlers, mappers, and validators follow a one-interface-one-implementation convention, so Scrutor can find them: `services.ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:39`) means adding a new use-case slice, [`GetUserAvatarHandler`](#getuseravatarhandler) for instance, needs **no DI edit at all**. The four services that are not convention-discoverable, because their interfaces live in other assemblies or have more than one plausible implementation, are registered by hand (`:32-35`). `TryAddScoped` rather than `AddScoped` is the load-bearing detail: a host that has already registered an override (a gRPC-backed `IAttendeeQueryService`, for instance) keeps it, and the module does not clobber it.
- **Concept introduced, closing a framework generic over the app's own entity.** `[Rubric §1, SOLID]` and `[Rubric §11, Security]`. `ISoftDeletedUserValidator` is a framework contract used by the shared [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) to reject an access token that outlived its account. Identity satisfies it not with a hand-written class but by closing the framework's generic [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser) over its own [`User`](#user) type (`:34`). The revocation check therefore has exactly one implementation across the whole workspace, and each app contributes only its entity type.
- **Walkthrough**: `AddModuleIdentityApplication(ApplicationSettings)` (`:28-42`) lives inside an `extension(IServiceCollection services)` block (`:20`). Body order: `_ = applicationSettings;` (`:30`) discards the parameter with a comment marking it reserved for future decorator configuration; then `IAuthenticationService` to [`AuthenticationService`](#authenticationservice) (`:32`), the [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators) parameter object as a concrete registration (`:33`), `ISoftDeletedUserValidator` to `SoftDeletedUserValidator<User>` (`:34`), `IAttendeeQueryService` to [`AttendeeQueryService`](#attendeequeryservice) (`:35`); then the Scrutor scan (`:39`) and `return services` (`:41`).
- **Why it's built this way**: mixing explicit and convention registration keeps the common case zero-ceremony while retaining precise control over the handful of services that need a specific lifetime or an override point. Registering the two cross-boundary implementations (`ISoftDeletedUserValidator`, `IAttendeeQueryService`) here is what closes the inversion those contracts set up: the framework and the Notification module declare the need, Identity satisfies it.
- **Where it's used**: called by the API-layer [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule` (`MMCA.ADC.Identity.API/DependencyInjection.cs:29`), which [`IdentityModule`](#identitymodule) calls in turn.
- **Caveats / not-in-source**: whether `applicationSettings` will ever be consumed is `Not determinable from source`; today it is only discarded (`:30`), taken solely to keep the signature uniform across modules.

---

### IdentityModuleSeeder
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14` · Level 11 · class (sealed)

- **What it is**: the Identity module's startup data seeder. It is a thin [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) that checks a configuration gate, resolves its dependencies from the host service provider, and delegates the actual inserts (default Organizer and Attendee accounts) to the Infrastructure-level [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Depends on**: [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder); `IConfiguration` and `IServiceProvider` (Microsoft.Extensions); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IPasswordHasher`](group-08-auth.md#ipasswordhasher); [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Concept introduced, the config-gated seeder bridge.** `[Rubric §8, Data Architecture]` (assesses deterministic, repeatable startup state), `[Rubric §11, Security]`, and `[Rubric §3, Clean Architecture]` (the API layer orchestrates, Infrastructure persists). Two design points matter here. First, the **gate**: the seeded accounts carry deliberately weak, well-known credentials (`admin@adc.com` with `Admin123!` and two attendee accounts, `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:35-37`), so seeding is opt-in via `Seeding:IncludeSampleUsers` (`IdentityModuleSeeder.cs:28`) and the method returns immediately when it is false (`:29-30`). `GetValue<bool>` defaults to `false` when the key is absent, so a production service that configures nothing seeds no accounts at all, exactly the same shape as the conference sample-data gate (comment `:24-27`). Second, the **bridge**: this class resolves services from the provider instead of taking them in a constructor, then constructs the DB seeder by hand (`:34`).
- **Walkthrough** (`:14-37`): `ModuleName => "Identity"` (`:17`) identifies the seeder to the loader. `SeedAsync(IServiceProvider, CancellationToken)` (`:20-36`) resolves `IConfiguration` (`:22`), evaluates the gate (`:28-30`), then resolves `IUnitOfWork` (`:32`) and `IPasswordHasher` (`:33`) with `GetRequiredService` (a missing registration fails loudly at startup rather than silently skipping the seed), constructs `new IdentityModuleDbSeeder(unitOfWork, passwordHasher)` (`:34`), and awaits its `SeedAsync` (`:35`). `IPasswordHasher` is required because the seed data holds plaintext passwords that must be hashed before they touch the database (doc comment `:9-13`).
- **Why it's built this way**: `IModuleSeeder.SeedAsync` runs inside a scope the loader creates *after* the host is fully built, so constructor-injecting scoped services would tie the seeder's own lifetime to that scope. Resolving at the boundary keeps the object simple and scope-agnostic. Keeping the EF insert logic in the Infrastructure `*DbSeeder` keeps the API assembly free of persistence detail and leaves the insert logic independently testable.
- **Where it's used**: discovered through the `IModuleSeeder` interface and invoked at host startup after the database initialization strategy has created or migrated the schema.
- **Caveats / not-in-source**: which hosts actually set `Seeding:IncludeSampleUsers` is configuration, not source; the code only records the intent (local AppHost and E2E CI) in its comment at `:24-27`.

### AssemblyReference
> MMCA.ADC.Identity.Domain + MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.{Domain,Infrastructure}` · Level 0 · class (static) · two layer copies (table below)

- **What it is**: the static assembly marker each Identity layer ships so that scanning code can say
  "this assembly" without a string literal or a reference to a real business type. Each copy exposes a
  handle onto its own assembly (`Assembly`) plus that assembly's simple name (`AssemblyName`).
- **Depends on**: `System.Reflection.Assembly` (BCL) only, imported at line 1 of each file. No
  first-party dependencies, which is why both sit at Level 0.

| Type (assembly) | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| AssemblyReference (Identity.Domain) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/AssemblyReference.cs:5` | Domain-layer copy; namespace `MMCA.ADC.Identity.Domain` (line 3). No call site in ADC today (see Caveats). |
| AssemblyReference (Identity.Infrastructure) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:5` | Infrastructure-layer copy; byte-identical body, namespace `MMCA.ADC.Identity.Infrastructure` (line 3). This is the one the EF design-time factories scan. |

- **Concept**: the assembly-marker idiom is taught once at
  [`AssemblyReference`](group-14-module-system-composition.md#assemblyreference) in the module-system
  chapter; these are the Identity Domain and Infrastructure instances of the same shape, and the API,
  Application, Shared and UI layers ship their own copies (covered in the sibling parts of this
  chapter). `[Rubric §5, Vertical Slice]` assesses convention-driven wiring and feature cohesion: a
  marker lets a scanner target an assembly through `typeof(AssemblyReference).Assembly` rather than a
  brittle string or a concrete type name, so adding an entity configuration or a handler to a slice
  needs no registration edit. `[Rubric §1, SOLID]` (Dependency Inversion): registration code binds to
  a deliberate, behavior-free token instead of `typeof(UserConfiguration).Assembly`, so renaming or
  moving a real type never silently breaks the scan.
- **Walkthrough**: two `public static readonly` fields, resolved once at type initialization.
  `Assembly = typeof(AssemblyReference).Assembly` (line 7 of each file) is the self-referential
  handle; `AssemblyName = Assembly.GetName().Name ?? string.Empty` (line 8) is the simple name, with
  the `?? string.Empty` fallback so the field is never null even if the runtime reports no simple
  name. No constructor, no methods.
- **Why it's built this way**: every module layer ships the identical marker so generic scanning code
  can be told *which* assembly to scan while the layer identity travels purely in the type argument.
  That keeps Clean Architecture layering intact: the scanner never needs a type reference that would
  create an upward dependency.
- **Where it's used**: the Infrastructure copy is what the EF design-time factories hand to
  `AddConfigurationAssembly(...)`: the per-service Identity migrations project
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:25`)
  and the frozen combined-database archive project
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer/DesignTimeSQLServerDbContextFactory.cs:29`).
  That is how [`UserConfiguration`](#userconfiguration) is discovered without the migrations host
  referencing it directly. The general registration machinery lives in
  [G14, Module System and Composition](group-14-module-system-composition.md).
- **Caveats / not-in-source**: the Domain copy has no call site in `MMCA.ADC/Source` or
  `MMCA.ADC/Tests` today: a repository-wide search returns only its own declaration. It exists for
  structural symmetry across layers. Whether a Domain-assembly scan is intended is
  `Not determinable from source`.

---

### ClassReference
> MMCA.ADC.Identity.Domain + MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.{Domain,Infrastructure}` · Level 0 · class · two layer copies (table below)

- **What it is**: the empty, non-static companion to [`AssemblyReference`](#assemblyreference),
  declared in the same file. It exists so a scanning API that needs an *instantiable* generic type
  argument has one available from this assembly, since a C# static class cannot be used as a generic
  type argument.
- **Depends on**: nothing first-party, and nothing from the BCL beyond `object`.

| Type (assembly) | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| ClassReference (Identity.Domain) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/AssemblyReference.cs:11` | Empty marker, same file as the Domain `AssemblyReference`. |
| ClassReference (Identity.Infrastructure) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:11` | Empty marker, same file as the Infrastructure `AssemblyReference`. Identical body. |

- **Concept**: cross-reference the marker idiom taught under
  [`AssemblyReference`](#assemblyreference) and first introduced in
  [G14](group-14-module-system-composition.md#classreference). The companion is needed because helpers
  such as `ScanModuleApplicationServices<TAssemblyMarker>()` constrain their type parameter to a
  reference type, which a static class cannot satisfy. `[Rubric §33, Developer Experience]` assesses
  how much ceremony the inner loop demands: one conventional token per layer is the entire
  registration ritual for a new slice.
- **Walkthrough**: `public class ClassReference { }` (line 11 of each file), no members. Its only
  meaningful property is the assembly it belongs to, read by a scanner through
  `typeof(ClassReference).Assembly`.
- **Why it's built this way**: keeping the instantiable anchor separate sidesteps the static-class
  generic-argument restriction while leaving [`AssemblyReference`](#assemblyreference) impossible to
  instantiate by accident. Each layer declares its own copy so it can be scanned by passing its local
  token.
- **Where it's used**: neither of these two copies is passed as a type argument anywhere in ADC today.
  The Identity module's generic scan uses the **Application**-layer copy
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:39`,
  `services.ScanModuleApplicationServices<ClassReference>()`), and the architecture-fitness suite
  passes that same Application copy explicitly
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:41`).
- **Caveats / not-in-source**: the Domain and Infrastructure copies are declared and unreferenced;
  they are present for symmetry. Whether a layer-specific scan is planned for either is
  `Not determinable from source`.

---

### DependencyInjection
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:11` · Level 0 · class (static)

- **What it is**: the Infrastructure-layer DI entry point for the Identity module. It is a deliberate
  no-op placeholder today: `AddModuleIdentityInfrastructure()` returns the `IServiceCollection`
  unchanged (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:20`).
- **Depends on**: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (NuGet, imported at
  `DependencyInjection.cs:1`). No first-party types.
- **Concept**: the `extension(IServiceCollection)` registration idiom, taught once in the
  [primer](00-primer.md#c-extensiont-types-read-this-once). C# preview extension members let each
  layer contribute an `AddModule{Name}{Layer}()` method that reads like a built-in `IServiceCollection`
  API. `[Rubric §16, Maintainability]` assesses uniform, predictable structure: shipping the method
  even when it registers nothing means the composition root never special-cases Identity, and the
  empty body is honest about "nothing to register here yet" rather than absent and surprising.
  `[Rubric §3, Clean Architecture]` assesses layer discipline: the Infrastructure layer owns its own
  registration surface and the API layer composes it, rather than the API layer reaching into
  persistence details itself.
- **Walkthrough**: a single `extension(IServiceCollection services)` block
  (`DependencyInjection.cs:13`) exposing
  `public IServiceCollection AddModuleIdentityInfrastructure() => services;`
  (`DependencyInjection.cs:20`), an expression body that returns the collection for chaining. The
  class-level XML doc (`DependencyInjection.cs:5-10`) records *why* it is empty: Identity has no
  module-specific infrastructure services beyond the EF configurations and the seeder, and those are
  discovered by assembly scanning. That claim matches the layer's actual contents, which are
  [`ModuleApplicationDbContext`](#moduleapplicationdbcontext),
  [`IdentityModuleDbSeeder`](#identitymoduledbseeder) and [`UserConfiguration`](#userconfiguration)
  alongside the two marker types above.
- **Why it's built this way**: keeping the method present even when empty keeps the module-registration
  pipeline uniform across every module and layer. When Identity later needs a typed infrastructure
  service (a key store, a read-model query service), it is added here and no caller changes.
- **Where it's used**: invoked from the API layer's `AddIdentityModule(...)` at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:30`, between
  `AddModuleIdentityApplication(applicationSettings)` (`:29`) and `AddModuleIdentityAPI()` (`:31`).
  That composite is called in turn by [`IdentityModule`](#identitymodule)`.Register`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:24`), the
  [`IModule`](group-14-module-system-composition.md#imodule) contract from G14.
- **Caveats / not-in-source**: the Identity module ships one `DependencyInjection` class per layer
  (this Infrastructure one plus the API, Application, Contracts and UI copies covered in sibling parts
  of this chapter). They all slug to the bare `dependencyinjection` anchor, which resolves to the
  first occurrence in the assembled chapter, so cross-references disambiguate by layer in prose.

---

### GetUsersQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersQuery.cs:12` · Level 0 · record (sealed)

- **What it is**: the query behind the organizer user-management list (BR-51): four optional filters
  (email, first name, last name, role) plus paging and sort parameters.
- **Depends on**: nothing first-party. Every member is a BCL `string?` or `int`.
- **Concept**: the CQRS query record is taught at
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult);
  this is the filter-plus-page-plus-sort flavor of it. `[Rubric §9, API and Contract Design]` assesses
  whether list contracts are explicit about paging and ordering rather than returning an unbounded
  collection: the query carries `PageNumber` / `PageSize` and `SortColumn` / `SortDirection` as
  first-class parameters, so a caller can never ask for "everything" implicitly.
  `[Rubric §12, Performance and Scalability]`: the documented max of 500 items per page (BR-11,
  `GetUsersQuery.cs:9`) is a contract statement here and an enforced clamp in the handler.
- **Walkthrough**: a positional record with eight parameters (`GetUsersQuery.cs:12-20`): the four
  nullable filters `Email` / `FirstName` / `LastName` / `Role` (`:13-16`), then `PageNumber = 1`
  (`:17`), `PageSize = 10` (`:18`), and the nullable `SortColumn = null` / `SortDirection = null`
  (`:19-20`). No body. The XML doc (`:3-11`) is the contract of record: 1-based page numbers, max 500
  items per page (BR-11), a default sort column of `CreatedOn` and a default direction of `desc`, all
  of which the handler actually applies.
- **Why it's built this way**: defaulted positional parameters let the common call ("page 1, 10 rows")
  be argument-free while still supporting the full filter and sort surface, and a `sealed record` is
  immutable, so the query can flow through the decorator pipeline with no stage able to mutate it.
- **Where it's used**: constructed by the organizer Users endpoint on
  [`UsersController`](#userscontroller) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:138`),
  which is `[HttpGet]` (`:123`) gated by
  `[HasPermission(IdentityPermissions.UsersRead)]` (`:124`) and range-validates `pageNumber` and
  `pageSize` at the boundary with `[Range(1, int.MaxValue)]` (`:131-132`). It is handled by
  [`GetUsersHandler`](#getusershandler), which produces a
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) of
  [`UserListDTO`](#userlistdto).

---

### IdentityPermissions
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Authorization` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:8` · Level 0 · class (static)

- **What it is**: the capability-permission catalog for the Identity module: string constants that
  endpoints demand through
  [`[HasPermission(...)]`](group-08-auth.md#haspermissionattribute) instead of naming roles inline.
- **Depends on**: no first-party types. BCL `IReadOnlyList<string>` plus a collection expression.
- **Concept, permission-based authorization over role-based.** An endpoint declares the *capability*
  it needs (`identity:users:read`), and the role-to-permission grants are declared once at module
  registration, so adding a role or re-mapping a capability never touches an endpoint attribute.
  `[Rubric §11, Security]` assesses authorization design and least privilege: naming the capability at
  the endpoint and centralizing the grants makes the authorization surface auditable in one place
  rather than scattered across `[Authorize(Roles = ...)]` strings. `[Rubric §7, Microservices
  Readiness]` assesses whether a boundary survives extraction: the catalog lives in the module's
  `Shared` project, so the in-process host and the standalone Identity service consume the exact same
  constants with no duplication.
- **Walkthrough**: `public const string UsersRead = "identity:users:read"`
  (`IdentityPermissions.cs:11`) is the single capability today, documented as "list or read all user
  accounts (organizer/admin user-management screens)" (`:10`). `public static IReadOnlyList<string>
  All { get; }` (`:14`) is initialized from a collection expression holding `UsersRead` (`:15-17`), so
  a role can be granted the whole capability set in one call. The class doc (`:3-7`) states the
  policy: endpoints require these rather than role names, and the grants are declared in the module's
  registration.
- **Why it's built this way**: a `namespace:resource:action` string convention keeps permissions
  self-describing and greppable, and the `All` accessor keeps the role-grant registration from
  drifting: a new permission constant only has to be listed once, inside `All`, and every role that
  was granted the set picks it up.
- **Where it's used**: demanded by the user-list endpoint on [`UsersController`](#userscontroller)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:124`), and
  granted in `AddModuleIdentityAPI()` where
  `permissions.Grant(RoleNames.Organizer, [.. IdentityPermissions.All])` and the same call for
  [`RoleNames`](group-08-auth.md#rolenames)`.Admin` populate the
  [`PermissionRegistry`](group-08-auth.md#permissionregistry)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:46-47`, with the
  rationale in the doc comment at `:36-40`).

---

### IdentitySettings
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/IdentitySettings.cs:7` · Level 0 · class (sealed)

- **What it is**: a module-level options object for Identity, declared to bind from the `"Identity"`
  configuration section. It carries one property, the BR-213 registration throttle.
- **Depends on**: no first-party types, nothing beyond the BCL.
- **Concept, module-scoped options with an in-code default.** `[Rubric §10, Cross-Cutting Concerns]`
  assesses how configuration is surfaced and layered: an options class turns a business rule into an
  environment-overridable knob while still carrying a sane value when the configuration file omits the
  section. `[Rubric §15, Best Practices and Code Quality]` applies here in the negative sense
  described under Caveats: an options type with no binder and no reader is dead configuration surface,
  and the knob that actually runs lives elsewhere.
- **Walkthrough**: `public const string SectionName = "Identity"` (`IdentitySettings.cs:9`) is the
  section key an `IConfiguration.GetSection(...)` call would use. The single property
  `public int MaxRegistrationsPerIpPerHour { get; init; } = 10` (`:15`) caps registrations per IP per
  hour, with the doc comment (`:11-14`) attributing it to BR-213 and noting it is set higher in
  development and test so E2E runs are not rate-limited. `init`-only keeps a bound instance immutable
  after startup, and `sealed` makes it safe to share as a singleton.
- **Why it's built this way**: keeping the `= 10` default in code rather than only in JSON means a
  missing configuration section still yields an enforceable limit instead of zero or a null reference.
- **Where it's used**: **nowhere in ADC today.** A repository-wide search for `IdentitySettings`
  across `MMCA.ADC` returns only the declaration at `IdentitySettings.cs:7`: there is no
  `Configure<IdentitySettings>(...)` binding and no injection of `IOptions<IdentitySettings>`. The
  registration throttle that actually runs is the framework's
  [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings) in `MMCA.Common.Infrastructure`,
  which declares the same property name with the same default
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:37`) and is
  compared against the cached per-IP count by
  [`LoginProtectionService`](group-08-auth.md#loginprotectionservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:111`). The test
  fixtures raise that framework knob, not this one, through the environment variable
  `LoginProtection__MaxRegistrationsPerIpPerHour`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:49`
  and `MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:151`,
  both setting `"1000"`).
- **Caveats / not-in-source**: treat this type as an unwired duplicate of `LoginProtectionSettings`,
  not as the effective configuration. Changing `MaxRegistrationsPerIpPerHour` here has no runtime
  effect, and the `Identity:MaxRegistrationsPerIpPerHour` configuration key is read nowhere. The class
  doc (`:3-6`) says the values come from `modules.identity.json` or its `Development` overlay, but no
  file by either name exists in the repository, so that comment is stale as well. The AppHost does not
  set the framework throttle either: a search for `LoginProtection` under
  `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost` returns no matches, so locally the framework default of
  10 applies. Whether this type is a leftover from before the throttle moved into MMCA.Common or a
  placeholder for a future module-owned setting is `Not determinable from source`.

---

### RemoveUserAvatarCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarCommand.cs:8` · Level 0 · record (sealed)

- **What it is**: the CQRS command that removes the signed-in user's avatar photo (BR-116a): it clears
  the stored URL and deletes the blob. It carries only the owning `UserId`.
- **Depends on**: `UserIdentifierType`, the Identity module's `int` identifier alias (see
  [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept**: the avatar slice as a whole is a three-operation feature (get, set, remove) taught in
  depth at [`SetUserAvatarHandler`](#setuseravatarhandler); this record is its delete request. The doc
  comment (`RemoveUserAvatarCommand.cs:3-6`) records the load-bearing contract: the operation is
  **idempotent**, and removing a non-existent avatar succeeds rather than erroring.
  `[Rubric §9, API and Contract Design]` assesses predictable, repeat-safe mutation semantics: a
  delete that is safe to replay lets a client (or a retrying proxy) call it again without
  special-casing "already gone".
- **Walkthrough**: a one-line positional record,
  `RemoveUserAvatarCommand(UserIdentifierType UserId)` (`RemoveUserAvatarCommand.cs:8`). No body. The
  parameter doc (`:7`) states that `UserId` is stamped by the controller from the authenticated
  principal and is never client-supplied, which is what makes this a self-service-only operation
  rather than an ownership check the handler has to perform.
- **Why it's built this way**: a bare command record keeps the delete inside the command decorator
  pipeline (FeatureGate, Logging, Caching, Validating, Transactional) like every other mutation, and
  the controller-stamped owner id turns ownership into a property of routing rather than an argument
  the client controls.
- **Where it's used**: constructed by [`UsersController`](#userscontroller)`.RemoveAvatarAsync`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:113`), the
  `[HttpDelete("me/avatar")]` endpoint (`:104`) which returns `204 No Content` on success (`:105`,
  `:118`). Handled by [`RemoveUserAvatarHandler`](#removeuseravatarhandler), which returns a bare
  [`Result`](group-01-result-error-handling.md#result) with no payload.

---

### SetUserAvatarCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarCommand.cs:10` · Level 0 · record (sealed)

- **What it is**: the CQRS command that sets (uploads or replaces) the signed-in user's avatar photo
  (BR-116a, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
  It carries the owning `UserId` plus the raw uploaded image bytes.
- **Depends on**: `UserIdentifierType` (the Identity `int` alias) and BCL
  `System.ReadOnlyMemory<byte>` for the payload.
- **Concept**: the upload-security pipeline this command feeds is taught in full at
  [`SetUserAvatarHandler`](#setuseravatarhandler). What matters *here* is the shape of the payload:
  `Content` is a `ReadOnlyMemory<byte>` of raw bytes, and the doc comment
  (`SetUserAvatarCommand.cs:3-7`) is explicit that the handler validates the true format from those
  bytes (magic bytes), **not** the client-declared content type, before re-encoding to the canonical
  256x256 JPEG. `[Rubric §11, Security]` assesses input trust boundaries: carrying an opaque byte
  buffer rather than a client-typed stream forces the trust decision into the handler, where the
  format is sniffed instead of believed.
- **Walkthrough**: a positional record
  `SetUserAvatarCommand(UserIdentifierType UserId, ReadOnlyMemory<byte> Content)`
  (`SetUserAvatarCommand.cs:10`). No body. `UserId` (`:8`) is controller-stamped from the
  authenticated principal and never client-supplied; `Content` (`:9`) is the uploaded image.
- **Why it's built this way**: modeling the upload as an immutable command with a read-only memory
  buffer keeps it inside the command pipeline like any other mutation, and hands the handler a view of
  the bytes it can sniff and re-encode without owning a disposable stream.
- **Where it's used**: constructed by [`UsersController`](#userscontroller)`.SetAvatarAsync`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:95`), the
  `[HttpPost("me/avatar")]` multipart endpoint (`:65`). The boundary enforces the size budget before
  the command is built: `[RequestSizeLimit(MaxAvatarBytes)]` (`:66`) with
  `MaxAvatarBytes = 2 * 1024 * 1024` (BR-116a, 2 MB, `:40`), plus an explicit reject of an empty or
  oversized file with the `Avatar.InvalidUpload` validation error (`:77-83`); the stream is then
  buffered into a `byte[]` (`:85-92`). Handled by
  [`SetUserAvatarHandler`](#setuseravatarhandler), which returns a
  [`UserAvatarDTO`](#useravatardto) carrying the new URL.

---

### GetUsersHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:16` · Level 8 · class (sealed)

- **What it is**: the query handler for the organizer user list (BR-51). It filters, counts, sorts,
  pages and projects `User` rows into [`UserListDTO`](#userlistdto) entirely at the database level,
  then returns a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)
  wrapped in a [`Result`](group-01-result-error-handling.md#result).
- **Depends on**:
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork);
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor);
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)
  (obtained via `GetReadRepository`); [`PagingMath`](group-03-querying-specifications.md#pagingmath);
  [`User`](#user); [`UserListDTO`](#userlistdto);
  [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata);
  [`GetUsersQuery`](#getusersquery); BCL `System.Linq.Expressions` (`GetUsersHandler.cs:1`).
- **Concept introduced, server-side paging, sorting and projection over a no-tracking queryable.**
  `[Rubric §12, Performance and Scalability]` assesses whether list endpoints push filter, sort, page
  and projection down to the database instead of materializing a table and slicing in memory: every
  stage here composes onto `IQueryable` and executes as SQL, and the read runs against the no-tracking
  repository so EF builds no change-tracking graph for rows the caller only reads.
  `[Rubric §30, Compliance, Privacy and Data Governance]` assesses data minimization: the explicit
  `Select` projects exactly six columns (`GetUsersHandler.cs:47-55`), so password hash and salt,
  refresh token and device fields are never read out of the database, let alone serialized. The class
  doc (`:11-15`) states that contract directly. `[Rubric §6, CQRS and Event-Driven]`: as a query
  handler it runs inside the read decorator chain (FeatureGate, Logging, Caching, handler) with no
  transaction, per
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and
    [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor)
    (`GetUsersHandler.cs:16-18`), implementing
    `IQueryHandler<GetUsersQuery, Result<PagedCollectionResult<UserListDTO>>>` (`:18`).
  - **Clamp the page** (`:28`): `PagingMath.Clamp(query.PageNumber, query.PageSize, 500)` returns a
    `(skip, take)` pair. The comment above it (`:25-27`) is the rationale: this is the BR-11 cap of
    500, and the shared helper also floors a non-positive page number or page size and range-checks
    the offset in 64-bit. In the helper itself, `take` is `Math.Clamp(pageSize, 1, max)`
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:37`), the page is
    floored at 1 (`:38`), the offset is computed as a `long` (`:40`), and an offset past
    `int.MaxValue` returns `(0, 0)` (`:42`), which materializes the empty page that page genuinely
    holds instead of a negative `Skip`.
  - **Base query** (`:30-35`): `unitOfWork.GetReadRepository<User, UserIdentifierType>()` yields the
    read repository, `repository.TableNoTracking` (`:34`) is the untracked `IQueryable<User>`, and
    `ApplyFilters` composes the `Where` clauses (`:35`).
  - **Count then sort then page** (`:38-57`): `queryableExecutor.CountAsync(baseQuery, ...)` issues a
    `SELECT COUNT` against the *filtered but unpaged* query (`:38`); `ApplySorting` adds the `ORDER BY`
    (`:41`); then `Skip(skip).Take(take)` plus the `Select` into [`UserListDTO`](#userlistdto)
    (`:44-55`) become `OFFSET/FETCH` with an explicit column list, materialized by
    `queryableExecutor.ToListAsync` (`:57`). Note `Email = (string)u.Email` (`:50`): `User.Email` is a
    value object, and the cast is what lets EF translate it to the underlying column.
  - **Wrap** (`:59-60`): `new PaginationMetadata(totalCount, take, Math.Max(query.PageNumber, 1))`
    reports the *clamped* page size and the floored page number, so the metadata describes the page
    that was actually served rather than the one that was asked for, and the result is returned as
    `Result.Success(new PagedCollectionResult<UserListDTO>(paged, metadata))`.
  - `ApplyFilters` (`:63-75`): one `Where` per non-null filter. `Email`, `FirstName` and `LastName`
    use `Contains` (`:66-70`), `Role` uses equality (`:72`), and the email predicate casts the value
    object with `((string)u.Email).Contains(...)` (`:66`).
  - `ApplySorting` (`:77-94`): the direction is descending when `SortDirection` equals `"desc"`
    case-insensitively **or** is null or whitespace (`:79-80`), which is how the documented
    `desc` default is realized. A `switch` on `SortColumn?.ToUpperInvariant()` picks the key selector
    for `EMAIL` / `FIRSTNAME` / `LASTNAME` / `ROLE` and falls through to `CreatedOn` for anything else,
    including null (`:82-89`), so an unknown sort column degrades to the documented default instead of
    throwing.
- **Why it's built this way**: routing count, sort, page and projection through
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) keeps the work set-based
  and testable (the executor is the mockable boundary over EF's async extension methods), while the
  read repository keeps a pure read off the tracking path. The explicit column projection is a
  type-level guarantee, not a convention: adding a sensitive field to [`User`](#user) cannot leak it
  through this endpoint without someone editing the `Select`. Delegating the cap to the shared
  [`PagingMath`](group-03-querying-specifications.md#pagingmath) rather than open-coding `Math.Min`
  means the hostile inputs (page 0, negative size, a page number near `int.MaxValue`) are handled the
  same way in every module.
- **Where it's used**: dispatched by the organizer Users endpoint on
  [`UsersController`](#userscontroller)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:137-139`),
  gated by [`IdentityPermissions`](#identitypermissions)`.UsersRead` (`:124`). Its page of
  [`UserListDTO`](#userlistdto) feeds the user-management grid in [`UserList`](#userlist) through
  [`UserService`](#userservice).

---

### SetUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16` · Level 8 · class (sealed, partial)

- **What it is**: the command handler that uploads or replaces the signed-in user's avatar (BR-116a,
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)). It
  sniffs the true image format, re-encodes to a canonical 256x256 JPEG, stores the result under a
  fresh random blob name, persists the new URL on the [`User`](#user) aggregate, then best-effort
  deletes the previous blob. It returns a [`UserAvatarDTO`](#useravatardto) with the new URL.
- **Depends on**:
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork);
  [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor);
  [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice);
  [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer); [`User`](#user);
  [`UserAvatarDTO`](#useravatardto); [`Result`](group-01-result-error-handling.md#result);
  [`Error`](group-01-result-error-handling.md#error); externals `Microsoft.Extensions.Logging`
  (`ILogger` plus `[LoggerMessage]` source generation), `System.Guid`, `System.IO.MemoryStream`,
  `System.Uri`, `System.Globalization.CultureInfo`.
- **Concept introduced, safe handling of a user-supplied binary upload
  ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).** This
  is the one place in the Identity module that accepts arbitrary bytes from an end user, and it treats
  them as hostile. `[Rubric §11, Security]` assesses input trust boundaries and defense against
  malicious uploads: the accepted format is decided by **magic-byte sniffing**
  ([`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer)`.IsAllowedImage`,
  called at `SetUserAvatarHandler.cs:32`, implemented at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:15-16`
  as JPEG or PNG or WebP), never the client-declared content type, and the image is **re-encoded**
  rather than stored as received, which the class doc (`:10-15`) notes strips EXIF and kills polyglot
  files (a payload that is a valid image *and* a valid script). `[Rubric §30, Compliance, Privacy and
  Data Governance]`: the same re-encode drops geolocation and camera EXIF a user did not intend to
  publish, and the stored URL lands on a `[Pii]`-tagged property
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:103-105`), so it
  participates in the erasure story of
  [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
  `[Rubric §13, Observability and Operability]`: the success path logs through a compile-time
  `[LoggerMessage]` source-generated method (`:95-96`), which is why the class is `partial`.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
    [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor),
    [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) and an
    `ILogger<SetUserAvatarHandler>` (`SetUserAvatarHandler.cs:16-20`), implementing
    `ICommandHandler<SetUserAvatarCommand, Result<UserAvatarDTO>>` (`:20`). The canonical edge length
    is `internal const int AvatarSize = 256` (`:23`).
  - **Format gate** (`:32-38`): if `ImageContentSniffer.IsAllowedImage(command.Content.Span)` is
    false, it returns `Error.Validation` with the app-specific code `"Avatar.UnsupportedFormat"` and
    the source stamped as the handler name (`:34-37`). The comment above it (`:30-31`) records the
    split: the sniffer is shared framework code in `MMCA.Common.Application`, while the error code and
    the size policy stay app-side.
  - **Load the aggregate** (`:40-46`): `unitOfWork.GetRepository<User, UserIdentifierType>()` (the
    writable repository, since this path mutates) then `GetByIdAsync(command.UserId, ...)`; a `null`
    user yields `Error.NotFound.WithSource(...).WithTarget(nameof(User))` (`:44-45`).
  - **Normalize** (`:48-58`): the bytes are wrapped in a non-writable `MemoryStream` (`:48`) and
    handed to `imageProcessor.NormalizeToSquareJpegAsync(content, AvatarSize, ...)` inside an
    `await using` block (`:50-53`); a failed `Result<byte[]>` short-circuits by re-returning its own
    errors (`:55-58`), so the failure detail from the image layer reaches the client unchanged.
  - **Upload** (`:60-72`): a fresh eight-hex-character suffix comes from
    `Guid.NewGuid().ToString("N")[..8]` (`:60`), and the blob name is built culture-invariantly with
    `string.Create(CultureInfo.InvariantCulture, $"{command.UserId}-{suffix}.jpg")` (`:61`). The JPEG
    is streamed to `fileStorage.UploadAsync(blobName, jpeg, "image/jpeg", ...)` (`:66`); a failed
    upload short-circuits (`:69-72`).
  - **Persist, then clean up** (`:74-86`): the previous blob name is captured with
    `TryGetBlobName(user.AvatarUrl)` **before** the property is overwritten (`:74`), then
    `user.SetAvatarUrl(uploaded.Value!.AbsoluteUri)`
    (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:303`) and
    `unitOfWork.SaveChangesAsync` commit the new URL (`:75-76`). Only after that does it delete the
    old blob (`:80-83`); the comment (`:78-79`) states the trade-off: a delete failure leaks at most
    one orphaned 256px image, never a broken avatar. It logs (`:85`) and returns
    `Result.Success(new UserAvatarDTO(user.AvatarUrl))` (`:86`).
  - `TryGetBlobName` (`:90-93`): an `internal static` helper that parses the stored URL with
    `Uri.TryCreate`, requires more than one segment, and returns the unescaped final segment as the
    blob name (otherwise `null`). It is deliberately `internal static` because
    [`RemoveUserAvatarHandler`](#removeuseravatarhandler) reuses it.
- **Why it's built this way**: the random blob-name suffix means a replacement never reuses the old
  URL, so browser and CDN caches self-resolve without an explicit purge (class doc, `:12-14`).
  Ordering the work as "persist the new URL, then delete the old blob" makes the user-visible state
  the source of truth and turns any storage failure into a harmless orphan rather than a dangling
  reference. Sniffing plus mandatory re-encoding is the
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) rule that
  an accepted upload is only ever stored in a shape the server itself produced.
- **Where it's used**: dispatched by [`UsersController`](#userscontroller)`.SetAvatarAsync`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:94-96`); the
  returned [`UserAvatarDTO`](#useravatardto) carries the new URL back for immediate display.
- **Caveats / not-in-source**: the concrete resize and crop strategy behind
  `NormalizeToSquareJpegAsync`, and the storage provider behind
  [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), live in MMCA.Common
  and are not visible here: this handler only orchestrates them. The 2 MB per-upload size limit is
  enforced at the API boundary, not in this file (the comment at `:30-31` says the size limit stays
  app-side, and the enforcement is
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:66` and
  `:77-83`).

---

### RemoveUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:14` · Level 9 · class (sealed, partial)

- **What it is**: the command handler that removes the signed-in user's avatar (BR-116a). It clears
  the stored URL on the [`User`](#user) aggregate first (the user-visible state), then best-effort
  deletes the blob. It is idempotent: when no avatar is set it succeeds without touching storage.
- **Depends on**:
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork);
  [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice);
  [`SetUserAvatarHandler`](#setuseravatarhandler) (it calls that class's `internal static`
  `TryGetBlobName`, imported at `RemoveUserAvatarHandler.cs:2`, which is why it sits one level higher
  at Level 9); [`User`](#user); [`Result`](group-01-result-error-handling.md#result);
  [`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` with
  `[LoggerMessage]` source generation.
- **Concept reinforced, the idempotent delete with best-effort cleanup.**
  `[Rubric §9, API and Contract Design]`: the operation is safe to repeat, and the no-op path is an
  explicit success rather than an error (see [`RemoveUserAvatarCommand`](#removeuseravatarcommand)).
  `[Rubric §13, Observability and Operability]`: the removal is recorded through a source-generated
  `[LoggerMessage]` method (`RemoveUserAvatarHandler.cs:46-47`), so the class is `partial`.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
    [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) and an
    `ILogger<RemoveUserAvatarHandler>` (`RemoveUserAvatarHandler.cs:14-17`), implementing
    `ICommandHandler<RemoveUserAvatarCommand, Result>` (`:17`). Note the bare `Result`: this command
    returns no payload.
  - `HandleAsync` (`:20-44`): loads the user through
    `unitOfWork.GetRepository<User, UserIdentifierType>()` and `GetByIdAsync` (`:24-25`); a `null`
    user returns `Error.NotFound.WithSource(...).WithTarget(nameof(User))` (`:28`).
  - **The idempotent short-circuit** (`:31-35`): it derives the blob name with
    `SetUserAvatarHandler.TryGetBlobName(user.AvatarUrl)`, and when that is `null` (no avatar stored,
    or a URL with no usable final segment) it returns `Result.Success()` immediately, without a write
    and without a storage call.
  - **Clear, then delete** (`:37-43`): `user.SetAvatarUrl(null)` and
    `unitOfWork.SaveChangesAsync` commit the cleared URL (`:37-38`), then
    `fileStorage.DeleteAsync(blobName, ...)` removes the blob (`:40`), the removal is logged (`:42`),
    and it returns `Result.Success()` (`:43`).
- **Why it's built this way**: clearing the URL before deleting the blob makes the persisted "no
  avatar" state authoritative, so a later storage failure leaves an orphaned file rather than a
  dangling reference to a blob that no longer exists. That is the same ordering rationale as
  [`SetUserAvatarHandler`](#setuseravatarhandler), and reusing that handler's `TryGetBlobName` keeps
  the URL-to-blob-name parsing in exactly one place, so the two operations can never disagree about
  which blob a stored URL names.
- **Where it's used**: dispatched by [`UsersController`](#userscontroller)`.RemoveAvatarAsync`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:112-114`),
  whose `204 No Content` response tells the client the avatar is gone (or was already absent).
- **Caveats / not-in-source**: the storage `DeleteAsync` result is not inspected here, so a failed
  blob delete is silent from this handler's perspective; whatever the storage implementation logs is
  the only trace. Whether orphaned blobs are swept by anything else is
  `Not determinable from source`.

### IAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8` · Level 0 · interface

- **What it is**: the one cross-module read contract Identity publishes. It answers a single question, "which user ids are active attendees?", so the Notification module can fan a broadcast out to every attendee without knowing anything about the [`User`](#user) aggregate.
- **Depends on**: the `UserIdentifierType` alias only; BCL (`Task`, `IReadOnlyList<T>`, `CancellationToken`). It deliberately references no Identity Domain or Application type: the file has no `using` directives at all (`IAttendeeQueryService.cs:1`).
- **Concept introduced, the cross-module contract in the `Shared` assembly.** `[Rubric §7, Microservices Readiness]` (assesses whether modules talk through narrow, transport-agnostic interfaces that survive extraction into separate processes) and `[Rubric §3, Clean Architecture]` (assesses dependency direction: the consumer depends on an abstraction, not on the producer's internals). The doc comment (`IAttendeeQueryService.cs:3-7`) states the rule outright: the contract lives in `Shared` so the Notification module can call it without depending on the Identity implementation, preserving module boundary isolation. That one placement decision is what makes three different wirings interchangeable behind the same interface: the in-process [`AttendeeQueryService`](#attendeequeryservice) when Identity runs in the same host, the [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) stub when the module is switched off, and the [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter) when Identity runs as its own service. No consumer code changes between those three.
- **Walkthrough**: one member. `GetAttendeeUserIdsAsync(CancellationToken cancellationToken = default)` (`IAttendeeQueryService.cs:15`) returns `Task<IReadOnlyList<UserIdentifierType>>`, documented as the identifiers of all active (non-deleted) users with the Attendee role (`IAttendeeQueryService.cs:10-14`). The return type is deliberately just ids, not user records: the caller needs recipients, not personal data, so the contract carries the minimum (`[Rubric §30, Compliance, Privacy and Data Governance]`, data minimization across a module boundary).
- **Why it's built this way**: a coarse, id-only, async, cancellable method maps cleanly onto a gRPC unary call, which is exactly the extraction path [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) describes. Anything richer (a filtered query object, an `IQueryable`) would leak Identity's persistence model across the boundary and would not survive the process split.
- **Where it's used**: consumed by Notification's [`AttendeeNotificationRecipientProvider`](group-10-notifications.md#attendeenotificationrecipientprovider) (which bridges it to [`INotificationRecipientProvider`](group-10-notifications.md#inotificationrecipientprovider)); implemented in-process by [`AttendeeQueryService`](#attendeequeryservice), stubbed by [`DisabledAttendeeQueryService`](#disabledattendeequeryservice), served over the wire by [`AttendeesGrpcService`](#attendeesgrpcservice), and satisfied remotely by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).

### IdentityRoutePaths
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: the two route strings the Identity UI module owns, `/users` and `/profile`, published as `static readonly` fields so the navigation descriptor never hard-codes a URL literal.
- **Depends on**: nothing. The file declares no `using` directives and references no other type.
- **Concept reinforced, route constants as the module's public navigation surface.** `[Rubric §25, Navigation and Information Architecture]` (assesses whether routes are declared in one place so menu entries, redirects, and tests cannot drift from the pages themselves) and `[Rubric §16, Maintainability]`. The pattern is small but load-bearing: the nav items in [`IdentityUIModule`](#identityuimodule) reference `IdentityRoutePaths.Profile` and `IdentityRoutePaths.Users` (`IdentityUIModule.cs:17-18`) rather than repeating the strings, so renaming a route is a one-line change here.
- **Walkthrough**: `Users = "/users"` (`IdentityRoutePaths.cs:8`) and `Profile = "/profile"` (`IdentityRoutePaths.cs:9`), both `public static readonly string` on a `public static class`.
- **Caveats / not-in-source**: the `@page` directives on the [`UserList`](#userlist) and [`Profile`](#profile) components still spell their route literally (`UserList.razor:1` is `@page "/users"`, `Profile.razor:1` is `@page "/profile"`), because a Razor `@page` directive requires a compile-time constant and these are `static readonly` fields rather than `const`. So this type is the single source of truth for *navigation*, not for the page routing attribute itself. The sibling claims page `UserClaims.razor:1` (`@page "/profile/claims"`) has no entry here at all.
- **Where it's used**: only by [`IdentityUIModule`](#identityuimodule)'s `NavItems` (`IdentityUIModule.cs:17-18`) in current source; a repository-wide search for the type name returns just that file and its own declaration.

### UserAvatarDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:6` · Level 0 · record (sealed)

- **What it is**: the one-field response body every avatar endpoint returns: the current public avatar URL, or `null` when the user has none (BR-116a).
- **Depends on**: nothing first-party; one BCL attribute (`System.Diagnostics.CodeAnalysis.SuppressMessage`).
- **Concept reinforced, the response DTO as a stable wire shape.** `[Rubric §9, API and Contract Design]` (assesses whether endpoints return a named, versionable shape rather than a bare primitive). Returning `{ "avatarUrl": ... }` instead of a raw string means a later addition (a thumbnail URL, an upload timestamp) is an additive change, not a breaking one. The `CA1054` suppression (`UserAvatarDTO.cs:5`) carries its own justification in source: this is a serialized DTO field, so the URL stays a `string` on the wire rather than becoming a `Uri`.
- **Walkthrough**: a single positional record, `public sealed record UserAvatarDTO(string? AvatarUrl)` (`UserAvatarDTO.cs:6`), with the parameter documented at `UserAvatarDTO.cs:4`. The nullable parameter is the whole contract: "no avatar" is a first-class, non-exceptional state.
- **Where it's used**: produced by the avatar read and write use cases ([`GetUserAvatarHandler`](#getuseravatarhandler), [`SetUserAvatarHandler`](#setuseravatarhandler)) and returned by [`UsersController`](#userscontroller)'s `me/avatar` endpoints (`GET` at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:43-45`, `POST` at `:65-67`). The delete endpoint (`:104`) returns a bare `Result` instead, because there is no avatar state left to report. Client-side it is deserialized by [`UserService`](#userservice) in `GetMyAvatarUrlAsync` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:94`) and `UploadMyAvatarAsync` (`:119`), both of which immediately project it down to `dto?.AvatarUrl` for the [`Profile`](#profile) page's avatar controls (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:65`).

### UserDataExportBookmarkDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one session-bookmark row inside the Engagement section of a data-subject export: which session the user bookmarked and when.
- **Depends on**: the `SessionIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the export row DTO (ids and dates only).** `[Rubric §30, Compliance, Privacy and Data Governance]` (assesses whether a data-subject access or portability request returns the subject's own data, and only that). The doc comment (`UserDataExportBookmarkDTO.cs:3-6`) ties the shape directly to PRIVACY.md §7. Note what is *not* here: no session title, no speaker, no other user's activity. The export carries the personal fact ("you bookmarked session X at time T") rather than a denormalized copy of another context's catalog, which keeps the Identity service from becoming an accidental read model of Conference data.
- **Walkthrough**: two `required init` members, `SessionId` (`UserDataExportBookmarkDTO.cs:10`) and `CreatedOn`, documented as UTC (`UserDataExportBookmarkDTO.cs:13`). `required` means the aggregating handler cannot forget a field, and `init` makes the row immutable once produced (the `required`/`init` immutability convention from the [primer](00-primer.md)).
- **Where it's used**: built by [`ExportUserDataHandler`](#exportuserdatahandler) from the Engagement peer's response, in a `[.. export.Bookmarks.Select(...)]` spread (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:107-111`), and carried inside [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto).

### UserDataExportNotificationDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one notification-inbox row in the Notifications section of a data-subject export: the notification id, its title, and the sent/read timestamps.
- **Depends on**: the `UserNotificationIdentifierType` alias; BCL (`DateTime`).
- **Concept**: the same export-row shape [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto) introduces (`[Rubric §30, Compliance, Privacy and Data Governance]`), with one extra nuance: it does include the `Title` text, because a notification's title is content that was addressed to this user, so it is part of *their* personal data rather than someone else's.
- **Walkthrough**: five members (`UserDataExportNotificationDTO.cs:10-22`). `NotificationId` (`:10`), `Title` (`:13`), and `SentOn` (`:16`, documented UTC) are `required init`. The pair that describes read state is not: `IsRead` is a plain `bool` (`:19`) that defaults to `false`, and `ReadOn` is a nullable `DateTime` (`:22`) documented as null while unread. An unread row therefore simply carries the defaults, with no ceremony at the construction site.
- **Where it's used**: projected by [`ExportUserDataHandler`](#exportuserdatahandler) from the Notification peer's rows (`ExportUserDataHandler.cs:142-149`) into [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto); the underlying entity is [`UserNotification`](group-10-notifications.md#usernotification).

### UserDataExportSubmittedQuestionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one submitted session-question row in the Engagement section of a data-subject export: the question id, the session it was asked in, and when it was submitted.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL (`DateTime`).
- **Concept**: the same export-row shape as [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), and the sharpest illustration of its restraint. The doc comment (`UserDataExportSubmittedQuestionDTO.cs:3-6`) spells the rule out: ids plus submission date only, never other users' data. The question *text* and its upvote count are omitted, so an export cannot be turned into a scrape of the live question feed (`[Rubric §30, Compliance, Privacy and Data Governance]`, `[Rubric §11, Security]`).
- **Walkthrough**: three `required init` members, `QuestionId` (`UserDataExportSubmittedQuestionDTO.cs:10`), `SessionId` (`:13`), and `CreatedOn` in UTC (`:16`).
- **Where it's used**: carried in [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto)'s `SubmittedQuestions`, populated by [`ExportUserDataHandler`](#exportuserdatahandler) (`ExportUserDataHandler.cs:112-117`); the source aggregate is [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) in the Engagement live layer.

### UserListDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` · Level 0 · record

- **What it is**: the row shape for the organizer user list (BR-51): id, email, first/last name, role, and creation date, and nothing else.
- **Depends on**: the `UserIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the list projection DTO as a privacy boundary.** `[Rubric §8, Data Architecture]` (assesses whether reads project only the columns a screen needs instead of hydrating whole aggregates) and `[Rubric §30, Compliance, Privacy and Data Governance]`. The doc comment (`UserListDTO.cs:3-6`) is explicit that device-specific fields are excluded to protect attendee device privacy: the [`User`](#user) aggregate carries `DeviceId`, `DeviceModel`, `DeviceManufacturer` and friends, but an organizer browsing the user grid has no business seeing them. Because the projection is built inside the query, a `.Select(u => new UserListDTO { ... })` translated to SQL after `Skip`/`Take` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:44-55`), the excluded columns are never even read from the database, so this is a privacy boundary *and* a performance win at once.
- **Walkthrough**: six members (`UserListDTO.cs:10-25`). `UserId` (`:10`), `Email` (`:13`), `FirstName` (`:16`), `LastName` (`:19`), and `Role` (`:22`) are `required init`; `CreatedOn` is a plain `init` `DateTime` (`:25`). `Role` is a `string`, not the [`UserRole`](#userrole) value object: the wire format stays primitive, and the closed-set type is a domain concern. The projection casts the [`Email`](group-02-domain-building-blocks.md#email) value object with `(string)u.Email` (`GetUsersHandler.cs:50`) so EF translates it to the underlying column.
- **Why it's built this way**: keeping the list DTO separate from [`UserDTO`](#userdto) lets the grid evolve (sortable columns, an added `CreatedOn`) without touching the general-purpose account DTO, and it keeps the list endpoint's payload small enough to page cheaply.
- **Where it's used**: produced by [`GetUsersHandler`](#getusershandler) inside a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (`GetUsersHandler.cs:60`), returned by [`UsersController`](#userscontroller)'s list endpoint (`UsersController.cs:123-126`), and consumed client-side through [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice) (`UserService.cs:19`, `:59`) as the `MudDataGrid` row type on the [`UserList`](#userlist) page, which inherits `DataGridListPageBase<UserListDTO>` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`). The grid's filter keys are read back off the DTO with `nameof(UserListDTO.Email)` and friends (`UserList.razor.cs:52-55`), so a renamed property breaks at compile time rather than at runtime.

### DisabledAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` · Level 1 · class (sealed)

- **What it is**: the no-op stand-in for [`IAttendeeQueryService`](#iattendeequeryservice) that gets registered when the Identity module is switched off in a host. It returns an empty attendee list instead of failing DI.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice), the `UserIdentifierType` alias; BCL (`Task.FromResult`).
- **Concept introduced, the disabled-module stub (null object).** `[Rubric §2, Design Patterns]` (assesses recognized patterns applied deliberately: this is the Null Object pattern) and `[Rubric §7, Microservices Readiness]`. The [module system](group-14-module-system-composition.md#imodule) lets a host run any subset of modules; a host that disables Identity would otherwise fail to resolve every cross-module Identity interface at startup. `IModule.RegisterDisabledStubs` closes that hole, and [`IdentityModule`](#identitymodule) registers exactly this type there (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:19-20`). Crucially the stub lives in `Shared`, the same assembly as the contract, so a host can reference the stub without pulling in Identity's Application or Domain assemblies.
- **Walkthrough**: the whole class is one expression-bodied method. `GetAttendeeUserIdsAsync` returns `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])` (`DisabledAttendeeQueryService.cs:10-11`): a completed task over an empty collection expression, so there is no allocation-heavy work and no `async` state machine.
- **Why it's built this way**: returning empty rather than throwing keeps "Identity is not in this host" a *configuration* fact instead of a runtime error. In the extracted topology the stub is also the safety net: `AddIdentityAttendeeClient()` calls `services.Replace(ServiceDescriptor.Scoped<IAttendeeQueryService, AttendeeQueryServiceGrpcAdapter>())` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:47`), and its doc comment (`DependencyInjection.cs:25-36`) records why `Replace` rather than `TryAdd`: either the in-process implementation or this stub may already be in the container, and the caller must order the call so the existing descriptor is present when `Replace` looks for it. If that replacement were ever skipped, a broadcast would reach nobody rather than crash the Notification host.
- **Where it's used**: registered by [`IdentityModule`](#identitymodule)`.RegisterDisabledStubs` as a singleton (`IdentityModule.cs:20`); replaced at startup in `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:202` by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), with the `Replace` rationale restated in the comment at `:199-201`.

### HttpContextExternalLoginEmailVerifier
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Authentication` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17` · Level 1 · class (sealed)

- **What it is**: the API-edge implementation of [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier). It re-reads the short-lived `ExternalLogin` cookie principal from the current request and reports whether the OAuth provider asserted that the email is verified.
- **Depends on**: [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) from `MMCA.ADC.Identity.Application.Users` (the Application-layer contract it satisfies, `HttpContextExternalLoginEmailVerifier.cs:3`), and `ExternalAuthExtensions.ExternalLoginScheme` from `MMCA.Common.API.Authentication` (`:4`); ASP.NET Core `IHttpContextAccessor` (injected as the single primary-constructor parameter, `:17-18`) and the `HttpContext.AuthenticateAsync` extension (`:1-2`).
- **Concept introduced, the fail-closed edge adapter for a security decision.** `[Rubric §11, Security]` (assesses whether authentication decisions are made on evidence the server can verify, and what happens when that evidence is missing) and `[Rubric §3, Clean Architecture]` (assesses the dependency-inversion move: the Application layer declares the question, the API layer answers it using request-scoped state it alone can see). The threat this guards is account takeover by email match: [`AuthenticationService`](#authenticationservice)'s external-login flow will link an external identity to an *existing* local account, and if it did that on an email string alone, any provider that hands out unverified emails would be a takeover vector. The verifier exists so the link only happens when the provider explicitly asserts verification. Every uncertain path returns `false`: no `HttpContext`, no principal, no claim, or an unparseable claim value all read as unverified, which the class doc calls out as fail-closed (`HttpContextExternalLoginEmailVerifier.cs:15`).
- **Walkthrough**
  - `EmailVerifiedClaimType` (`HttpContextExternalLoginEmailVerifier.cs:21`): the `internal const string "email_verified"` claim type, `internal` so the module's tests can assert against it without publishing it on the public surface.
  - `IsCurrentExternalLoginEmailVerifiedAsync` (`:24-36`): reads `httpContextAccessor.HttpContext` (`:26`) and returns `false` immediately when there is none (`:27-30`), which covers any non-request context such as a background job.
  - It then calls `httpContext.AuthenticateAsync(ExternalAuthExtensions.ExternalLoginScheme)` (`:32`), re-authenticating the same short-lived cookie the shared `OAuthControllerBase.CompleteAsync` just validated, and pulls `email_verified` off the resulting principal with `authenticateResult.Principal?.FindFirst(...)?.Value` (`:33`). Both null-conditional operators matter: a failed authentication yields a null principal, and a principal without the claim yields a null value.
  - The final line is the fail-closed gate: `bool.TryParse(claimValue, out var verified) && verified` (`:35`). A missing claim yields a `null` value, `TryParse` fails, and the method returns `false`.
- **Why it's built this way**: the verification assertion only exists inside the external-login cookie principal, which is request state, so the check cannot live in the Application layer without dragging `HttpContext` down there. Inverting it behind an interface keeps [`AuthenticationService`](#authenticationservice) testable with a fake verifier. The class doc (`HttpContextExternalLoginEmailVerifier.cs:8-16`) also records a real provider asymmetry: the Identity service host maps Google's claim through a `PostConfigure<GoogleOptions>` claim action, while GitHub's OAuth user payload carries no such assertion, so GitHub logins report unverified by design and simply do not auto-link.
- **Where it's used**: registered with `TryAddScoped` in `AddModuleIdentityAPI` immediately after `AddHttpContextAccessor()` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:54-55`); consumed by [`AuthenticationService`](#authenticationservice)'s external-login flow.
- **Caveats / not-in-source**: the Google claim-action mapping lives in the Identity service host's `Program.cs`, not in this file, and the `ExternalLogin` cookie itself is issued by the shared [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase).

### UserDataExportEngagementSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:10` · Level 1 · record (sealed)

- **What it is**: the Engagement-owned slice of a data-subject export: the user's session bookmarks and submitted session questions, plus an `Available` flag that says whether the Engagement service could actually be reached.
- **Depends on**: [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), [`UserDataExportSubmittedQuestionDTO`](#userdataexportsubmittedquestiondto).
- **Concept introduced, the partial-availability section (graceful degradation in a composite response).** `[Rubric §29, Resilience and Business Continuity]` (assesses whether a request that fans out to peers degrades instead of failing when one peer is down) and `[Rubric §7, Microservices Readiness]` (assesses that a cross-service aggregate does not turn every peer into a hard dependency). This is the interesting design move in the export: rather than modelling "Engagement is unreachable" as an exception that fails the whole GDPR request, the contract models it as *data*. The doc comment (`UserDataExportEngagementSectionDTO.cs:3-9`) states the rule: aggregation is best-effort, and when the Engagement peer stays unreachable after the standard resilience pipeline the export still succeeds with `Available` set to false and the lists empty. The reader of the export can then tell the difference between "you had no bookmarks" and "we could not check", which a bare empty list could never express.
- **Walkthrough**: three members. `required bool Available` (`UserDataExportEngagementSectionDTO.cs:14`) is the only required one, so no producer can construct a section without stating its completeness, and its doc (`:12-13`) says false means the section is incomplete and the export can be retried later. `Bookmarks` (`:17`) and `SubmittedQuestions` (`:20`) are `IReadOnlyList<T>` properties defaulting to an empty collection expression `[]`, which is what makes `new UserDataExportEngagementSectionDTO { Available = false }` a legal one-liner on the failure path.
- **Why it's built this way**: the failure default and the required flag together make the degraded case cheap to produce and impossible to produce *silently*. [`ExportUserDataHandler`](#exportuserdatahandler) catches everything that is not an `OperationCanceledException` (`ExportUserDataHandler.cs:120`), logs the section as unavailable, and returns exactly that one-liner (`:125`), so a single peer outage never denies a user their portability right.
- **Where it's used**: the `Engagement` property of [`UserDataExportDTO`](#userdataexportdto) (`UserDataExportDTO.cs:77`), populated by [`ExportUserDataHandler`](#exportuserdatahandler) via [`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) in `GetEngagementSectionAsync` (`ExportUserDataHandler.cs:94-127`).

### UserDataExportNotificationSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:9` · Level 1 · record (sealed)

- **What it is**: the Notification-owned slice of a data-subject export: the user's inbox rows, newest first, behind the same `Available` completeness flag.
- **Depends on**: [`UserDataExportNotificationDTO`](#userdataexportnotificationdto).
- **Concept**: structurally the same partial-availability section [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) introduces, applied to a second peer (`[Rubric §29, Resilience and Business Continuity]`). Two peers, two independent flags: the Notification service can be down while Engagement answers, and the export still returns everything it managed to gather. The two `GetXSectionAsync` helpers are separate methods with separate `try`/`catch` blocks precisely so one failure cannot swallow the other's result.
- **Walkthrough**: `required bool Available` (`UserDataExportNotificationSectionDTO.cs:13`) and `IReadOnlyList<UserDataExportNotificationDTO> Notifications { get; init; } = []` (`:16`), documented as newest first. The class doc (`:3-8`) carries the same best-effort contract as its Engagement sibling.
- **Where it's used**: the `Notifications` property of [`UserDataExportDTO`](#userdataexportdto) (`UserDataExportDTO.cs:81`), populated by [`ExportUserDataHandler`](#exportuserdatahandler) via [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice) in `GetNotificationSectionAsync` (`ExportUserDataHandler.cs:129-159`), with the degraded path returning `new UserDataExportNotificationSectionDTO { Available = false }` (`:157`).

### UserDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` · Level 1 · record

- **What it is**: the general-purpose account DTO: id, email, first/last name, and role. It is the credential-free projection of the [`User`](#user) aggregate.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the framework DTO contract from `MMCA.Common.Shared.DTOs`, imported at `UserDTO.cs:1`), the `UserIdentifierType` alias.
- **Concept reinforced, the identified DTO (`IBaseDTO<TIdentifierType>`).** `[Rubric §9, API and Contract Design]` (assesses a consistent, machine-checkable response shape) and `[Rubric §11, Security]` (assesses that secrets never reach a serialization boundary). Implementing [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`UserDTO.cs:8`) is what lets this DTO plug into the framework's generic mapper and service abstractions: `Id` (`:11`) satisfies the interface. Just as important is the omission: the [`UserDTOMapper`](#userdtomapper) doc comment (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:11`) records that `PasswordHash`, `PasswordSalt`, and `RefreshToken` are excluded from the projection, so the DTO is the enforced boundary between an aggregate that holds credentials and anything that can be serialized.
- **Walkthrough**: five `required init` members (`UserDTO.cs:11-23`), `Id` (`:11`), `Email` (`:14`, documented as the login credential, BR-200), `FirstName` (`:17`), `LastName` (`:20`), and `Role` as a `string` used for authorization decisions (`:23`). Because the mapper is a Mapperly source generator, adding a member here changes generated code at build time rather than at runtime ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html), manual and Mapperly mapping).
- **Why it's built this way**: `required` on every member means the compiler, not a reviewer, catches a mapper that forgets a field, and keeping the type in `Shared` lets any layer (API, UI, tests) name it without referencing the Domain assembly.
- **Where it's used**: produced by [`UserDTOMapper`](#userdtomapper), which is a `[Mapper]`-attributed sealed partial class (`UserDTOMapper.cs:13-15`) implementing [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) over ([`User`](#user), `UserDTO`, `UserIdentifierType`). The generator fills in `MapToDTO` (`UserDTOMapper.cs:18`); the collection overload is hand-written over it (`:21-25`), and a private `EmailToString` helper converts the [`Email`](group-02-domain-building-blocks.md#email) value object to its string form (`:28`).

### UserDataExportDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportDTO.cs:16` · Level 2 · record

- **What it is**: the full portable export of everything the system holds about one user: the Identity-owned account and device fields, plus the two best-effort cross-service sections. It is the response body of the GDPR/CCPA data-subject access endpoint.
- **Depends on**: [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto), [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto), the `UserIdentifierType` and `SpeakerIdentifierType` aliases; BCL (`DateTime`).
- **Concept introduced, the data-portability contract (what goes in, and what is deliberately left out).** `[Rubric §30, Compliance, Privacy and Data Governance]` (assesses whether the right of access and portability is implemented as a real, complete, machine-readable artifact) and `[Rubric §11, Security]`. The type doc (`UserDataExportDTO.cs:3-8`) names the exclusions and the reason: the password hash and salt, the refresh token, and the opaque external-provider key are secrets, not portable personal data, so exporting them would create a credential-leak channel out of a privacy feature. What *is* included is everything a user would recognize as theirs, including the MAUI device metadata (`:49-67`), which is exactly the block [`UserListDTO`](#userlistdto) refuses to show an organizer: the subject may see their own device data, a third party may not. The `remarks` block (`:9-15`) records the cross-service aggregation policy and notes it closed the residual on RemediationBacklog #30.
- **Walkthrough**
  - Identity account fields (`UserDataExportDTO.cs:19-34`): `required` `UserId` (`:19`), `Email` (`:22`), `FirstName` (`:25`), `LastName` (`:28`), `FullName` (`:31`), and `Role` (`:34`).
  - External-login fields (`:37,40`): `IsExternalLogin` and the provider *name* only; the doc on `LoginProvider` (`:39`) restates that the opaque provider key is intentionally omitted.
  - Cross-context links and profile (`:43,46`): the nullable `LinkedSpeakerId` (the scalar link to a Conference speaker, never a cross-database FK) and `AvatarUrl` (BR-116a).
  - Device metadata (`:49-67`): seven nullable strings reported by the MAUI client, `DeviceId`, `DeviceFormFactor`, `DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceName`, `DeviceType`.
  - Audit timestamps (`:70,73`): `CreatedOn` and nullable `LastModifiedOn`, both documented UTC, the same audit fields the framework stamps in `SaveChangesAsync`. The handler re-stamps their `DateTimeKind` on the way out (`ExportUserDataHandler.cs:83-86`) because SQL Server hands them back as `Kind=Unspecified`, which would serialize without the trailing `Z` the doc promises; the comment at `:80-82` is the record of that.
  - The two nullable sections (`:77,81`): `Engagement` and `Notifications`. They are nullable rather than required because they are filled by cross-service calls, and each carries its own `Available` flag for the degraded case.
- **Why it's built this way**: modelling the export as one flat, versionable record with nested per-service sections keeps the whole subject-access response a single GET, while the per-section availability flags mean a peer outage costs the user completeness, not the request. Together with the erasure path on the [`User`](#user) aggregate ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), this is the read half of the privacy pair: export what we hold, then anonymize it on request.
- **Where it's used**: assembled by [`ExportUserDataHandler`](#exportuserdatahandler) in one object initializer (`ExportUserDataHandler.cs:61-89`) for [`ExportUserDataQuery`](#exportuserdataquery), after both peer sections have already been resolved (`:58-59`); returned by [`UsersController`](#userscontroller)'s `{userId}/export` endpoint (`UsersController.cs:148-152`), which passes the caller's own id and role into the query so the handler can enforce its owner-or-Organizer check (`UsersController.cs:160-162`).

### IdentityUIModule
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's UI descriptor. It tells the shared Blazor shell two things: which navigation entries this module contributes, and which assembly to scan for routable components.
- **Depends on**: [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the contract, `IdentityUIModule.cs:4,13`), [`NavItem`](group-15-common-ui-framework.md#navitem) and [`NavSection`](group-15-common-ui-framework.md#navsection) from `MMCA.Common.UI.Common` (`:3`), [`IdentityRoutePaths`](#identityroutepaths), [`RoleNames`](group-08-auth.md#rolenames) from `MMCA.Common.Shared.Auth` (`:2`); externals: MudBlazor `Icons.Material.Filled` (`:5`), BCL `System.Reflection.Assembly` (`:1`).
- **Concept reinforced, the pluggable UI module descriptor.** `[Rubric §18, UI Architecture]` (assesses whether the shell discovers features rather than hard-coding them) and `[Rubric §25, Navigation and Information Architecture]` (assesses that menu structure, role gating, and routes are declared next to the feature that owns them). The [`IUIModule`](group-15-common-ui-framework.md#iuimodule) contract is introduced in [G15](group-15-common-ui-framework.md): a host collects every registered implementation, merges their `NavItems` into the sidebar, and passes their `Assembly` to the router's additional assemblies so pages in a Razor Class Library are found. The effect is that adding the Identity module to a host adds its pages *and* its menu entries in one registration, with no edit to the shell. `[Rubric §11, Security]` and `[Rubric §27, Internationalization]` both show up in the two declarations below.
- **Walkthrough**: two members.
  - `NavItems` (`IdentityUIModule.cs:15-19`), a collection-expression-initialized `IReadOnlyList<NavItem>` with two entries. "My Profile" points at [`IdentityRoutePaths`](#identityroutepaths)`.Profile` with a `Person` icon in `NavSection.User` and no required role, so every signed-in user sees it (`:17`). "Users" points at `IdentityRoutePaths.Users` with a `SupervisedUserCircle` icon, passes [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` as the `RequiredRole` positional argument, and sits in `NavSection.Admin` (`:18`), so the link is only rendered for organizers. Note that this hides the entry: the actual enforcement is server-side on [`UsersController`](#userscontroller), whose list endpoint demands `IdentityPermissions.UsersRead` (`UsersController.cs:124`). Menu gating is UX, not authorization.
  - Both entries pass `TitleResource: typeof(IdentityUIModule)`, which per the [`NavItem`](group-15-common-ui-framework.md#navitem) contract turns `"Nav.MyProfile"` and `"Nav.Users"` into *resource keys* resolved against this type's resources at render time, so the menu follows the active culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - `Assembly => typeof(IdentityUIModule).Assembly` (`:21`): the self-referencing assembly handle used for Blazor route discovery.
- **Why it's built this way**: a descriptor class is the smallest thing that can carry declarative metadata into DI. Because it is a plain sealed class with no dependencies, it registers as a singleton and costs nothing at runtime, while keeping the sidebar's Identity section owned by the Identity module rather than by the host.
- **Where it's used**: passed as the type argument to the framework's `AddUIModule<TModule>()` inside [`DependencyInjection.AddIdentityUI`](#dependencyinjection) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:23`). That one call does both jobs: it is the Scrutor scan root (`FromAssemblyOf<TModule>`) and the descriptor registration (`AddSingleton<IUIModule, TModule>`), at `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-161`.

### DependencyInjection
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:11` · Level 4 · class (static)

- **What it is**: the one-call registration entry point for the Identity UI layer. `AddIdentityUI()` wires the module's entity services, its bespoke user service, and its [`IdentityUIModule`](#identityuimodule) descriptor into any Blazor host.
- **Depends on**: [`IdentityUIModule`](#identityuimodule), [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice) from `MMCA.ADC.Identity.UI.Services` (`DependencyInjection.cs:2`), and the framework's `AddUIModule<TModule>()` extension from `MMCA.Common.UI` (`:3`); externals: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (`:1`).
- **Concept reinforced, the `extension(IServiceCollection)` registration block.** `[Rubric §15, Best Practices and Code Quality]` (assesses idiomatic, current-language composition) and `[Rubric §3, Clean Architecture]` (assesses that each layer owns its own wiring instead of the host reaching into it). This file is the UI-layer instance of the convention used across all four repos: instead of a classic `public static IServiceCollection AddX(this IServiceCollection services)`, the method lives inside a C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:13`) and the receiver is named once for the whole block, which the class doc calls out explicitly (`:7-10`). Callers see an ordinary `services.AddIdentityUI()`.
- **Walkthrough**: `AddIdentityUI()` (`DependencyInjection.cs:19-29`) does two things and returns `services` for chaining.
  - `services.AddUIModule<IdentityUIModule>()` (`:23`), the shared two-step prologue every module's `Add{Module}UI()` opens with. Inside `MMCA.Common.UI` that single call runs the Scrutor scan over the descriptor's assembly, registering every [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) implementation `AsImplementedInterfaces` with a scoped lifetime, then registers the descriptor with `AddSingleton<IUIModule, TModule>` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-161`). Convention over configuration: a new standard CRUD-shaped UI service needs no registration edit here.
  - An explicit `services.AddScoped<IUserUIService, UserService>()` (`:26`). The comment above it (`:25`) explains why this one is hand-written: users are a custom contract, not an `IEntityService`, so the scan cannot pick it up (the same asymmetry [`IUserUIService`](#iuseruiservice) documents at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:7`, because the Users API returns [`UserListDTO`](#userlistdto) rather than the module's entity DTO).
- **Why it's built this way**: one host-facing method per module keeps the three hosts symmetric: they each call `AddIdentityUI()` and nothing else. The mix of a shared scan helper plus one explicit registration is deliberate, and the framework doc for `AddUIModule<TModule>()` (`MMCA.Common.UI/DependencyInjection.cs:140-146`) records the ordering rationale: module-specific services are registered by the caller *after* the prologue, so a module whose service must win over a shared default still controls its own registration order.
- **Where it's used**: called by all three UI hosts, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:71` (Blazor Server), `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:60` (the WebAssembly client), and `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:82` (MAUI), which is what lets the same Razor Class Library render on web and mobile.
- **Caveats / not-in-source**: the Identity module ships one `DependencyInjection` class per layer (this UI one plus the API, Application, and Infrastructure copies covered in sibling parts of this chapter). They all slug to the bare `dependencyinjection` anchor, which resolves to the first occurrence in the assembled chapter, so cross-references disambiguate by layer in prose.

### ChangePasswordRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` · Level 1 · class (sealed)

- **What it is**: the FluentValidation rule set for a password change: the current password must be present, and the new password must clear the shared strength rules.
- **Depends on**: [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (the shared request DTO it validates), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest); externals: FluentValidation (`AbstractValidator<T>`, `RuleFor`, `Include`).
- **Concept introduced, the request validator that reaches the pipeline indirectly.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether cross-cutting concerns sit in the pipeline rather than inside handlers) and `[Rubric §11, Security]` (assesses that password strength is enforced at a boundary the caller cannot bypass). Nothing in ADC constructs this class: it is picked up by the convention scan in the Identity Application layer's `AddModuleIdentityApplication` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:39`, `ScanModuleApplicationServices<ClassReference>()`) and registered as `IValidator<ChangePasswordRequest>`. The Validating decorator, though, validates the *command*, not the request. The bridge is the framework's `CommandRequestValidator<TCommand, TRequest>` (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:19-27`), auto-registered for any command implementing `ICommandWithRequest<TRequest>`: it does `RuleFor(c => c.Request).SetValidator(validator)`. [`ChangePasswordCommand`](#changepasswordcommand) declares that marker (`ChangePasswordCommand.cs:15`), so writing this one small validator is enough to put password rules in front of the handler with no wiring at all.
- **Walkthrough**: one constructor (`ChangePasswordRequestValidator.cs:13-19`).
  - `RuleFor(x => x.CurrentPassword).NotEmpty()` with the message "Current password is required." and the error code `User.CurrentPassword.Required` (`ChangePasswordRequestValidator.cs:15-16`). The explicit `WithErrorCode` matters: the API surfaces codes, not English text, so a client can branch on the code and a translator can own the message.
  - `Include(new StrongPasswordRules<ChangePasswordRequest>(x => x.NewPassword))` (`ChangePasswordRequestValidator.cs:18`). `Include` folds another rule set into this one against a selected property, so the framework owns "what counts as a strong password" in one place and every app inherits changes to it.
- **Why it's built this way**: the *current* password is deliberately only checked for presence here, never for strength. Its correctness is a credential comparison against the stored hash, which lives in [`ChangePasswordHandler`](#changepasswordhandler) via `ChangePasswordHandlerBase` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:55-59`), and an old account may legitimately hold a password that no longer meets today's rules. Applying strength rules to it would lock those users out of the very screen that would fix the problem ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)).
- **Where it's used**: resolved as `IValidator<ChangePasswordRequest>` by `CommandRequestValidator<ChangePasswordCommand, ChangePasswordRequest>`, which the Validating decorator runs before [`ChangePasswordHandler`](#changepasswordhandler) for the `PUT auth/password` endpoint on [`AuthController`](#authcontroller).

### IUserUIService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` · Level 1 · interface

- **What it is**: the client-side contract the Identity Blazor pages call for everything user-shaped: the organizer user list, account delete, and the three avatar operations on the signed-in user.
- **Depends on**: [`UserListDTO`](#userlistdto), the `UserIdentifierType` alias; BCL (`Task`, `Stream`, `CancellationToken`).
- **Concept introduced, the bespoke UI service contract (when the generic one does not fit).** `[Rubric §18, UI Architecture]` (assesses whether components talk to a typed abstraction instead of raw HTTP) and `[Rubric §9, API & Contract Design]`. The framework's default for a UI-to-API contract is [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype), which assumes a full CRUD resource whose DTO implements `IBaseDTO<TIdentifierType>`. The doc comment states plainly why users cannot use it (`IUserUIService.cs:5-10`): the users API returns [`UserListDTO`](#userlistdto), which is a projection with no `IBaseDTO` identity, and it exposes only list plus delete rather than the standard five verbs. Rather than bend the DTO to fit a generic contract, the module declares its own narrow interface. That is the same decision the registration in [`DependencyInjection`](#dependencyinjection) documents: the Scrutor scan cannot see this one, so it is registered by hand (`MMCA.ADC.Identity.UI/DependencyInjection.cs:29`).
- **Walkthrough**: five members.
  - `GetPagedAsync(...)` (`IUserUIService.cs:16-25`) takes nullable `email`, `firstName`, `lastName`, `role` filters, `pageNumber`/`pageSize` defaulting to 1 and 10, and nullable `sortColumn`/`sortDirection`. It returns a tuple `(IReadOnlyList<UserListDTO> Items, int TotalItems)` rather than the wire's `PagedCollectionResult<T>`, so the page gets exactly the two things a `MudDataGrid` needs.
  - `DeleteAsync(UserIdentifierType userId, ...)` (`IUserUIService.cs:30`) returns `bool`; the doc records that the server requires owner-or-Organizer (UC-21), so the client never has to reason about the rule.
  - `GetMyAvatarUrlAsync` (`IUserUIService.cs:33`), `UploadMyAvatarAsync(Stream content, string fileName, string contentType, ...)` (`IUserUIService.cs:39`), and `RemoveMyAvatarAsync` (`IUserUIService.cs:42`), the BR-116a trio. Note the "my" naming: none of them take a user id, because the server derives the subject from the token. A client that cannot name another user's avatar cannot accidentally ask for one.
- **Why it's built this way**: an interface here is what lets the [`Profile`](#profile) and [`UserList`](#userlist) pages be tested with a fake instead of a live HTTP stack (`[Rubric §14, Testability]`), and it is the boundary that keeps `HttpClient`, retries, and JSON shapes out of the components entirely.
- **Where it's used**: implemented by [`UserService`](#userservice); injected into [`UserList`](#userlist) (`MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:21`) and [`Profile`](#profile) (`MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:17`); registered scoped in [`DependencyInjection.AddIdentityUI`](#dependencyinjection).

### ListPageActions
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Common` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Common/ListPageActions.cs:13` · Level 2 · class (static)

- **What it is**: two static helpers that every ADC organizer list page shares: reload whichever layout (mobile list or desktop grid) is currently rendered, and run the confirm-delete-toast-reload flow.
- **Depends on**: [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and the `DeleteConfirmation` dialog component from `MMCA.Common.UI.Components`; externals: MudBlazor (`MudDataGrid<T>`, `ISnackbar`, `Severity`).
- **Concept introduced, the ADC-side shared UI helper and where it is allowed to live.** `[Rubric §16, Maintainability]` (assesses whether a repeated flow exists once) and `[Rubric §24, Forms, Validation & UX Safety]` (assesses that destructive actions confirm first and that failures surface to the user). The class comment (`ListPageActions.cs:6-12`) explains the placement, which is the interesting part: Identity.UI is the root of the module UI reference chain (Conference.UI references Identity.UI, Engagement.UI references Conference.UI), so it is the only ADC UI project every other module UI project can see. Putting the helper here avoids inventing a fifth shared UI assembly, and it is why a Conference page such as `SpeakerList` calls into an Identity type without that being a layering violation.
- **Walkthrough**: two methods, both static and generic over the row DTO.
  - `ReloadActiveLayoutAsync<TDto>(bool isMobile, MobileInfiniteScrollList<TDto>? mobileList, MudDataGrid<TDto>? dataGrid)` (`ListPageActions.cs:24-37`). If the mobile layout is active and its ref is bound, it calls `mobileList.ResetAsync()`; otherwise it calls `dataGrid.ReloadServerData()` when that ref is bound. Both refs are nullable by design: only one layout is in the render tree at a time, so the other `@ref` is null, and the null checks are the mechanism rather than defensive noise (`[Rubric §22, Responsive & Cross-Browser]`).
  - `DeleteWithConfirmationAsync(...)` (`ListPageActions.cs:51-86`) takes the page's `DeleteConfirmation` ref, the entity display name, the delete call, the snackbar, a localized success message, a failure-to-message mapper, and the reload callback. It guards every reference argument with `ArgumentNullException.ThrowIfNull` (`ListPageActions.cs:60-64`), shows the dialog, and returns immediately unless the result is exactly `true` (`ListPageActions.cs:66-70`): a dialog dismissed with `null` is a cancel, not a confirm. On confirm it awaits the delete, toasts success, and reloads (`ListPageActions.cs:74-76`).
  - The two-catch tail is the subtle part (`ListPageActions.cs:78-85`). `OperationCanceledException` is swallowed with a comment naming the two causes: component disposal, and the InteractiveAuto render-mode transition where a Server-rendered circuit is torn down as WebAssembly takes over. Any other exception is mapped through the caller's `errorMessage` delegate and toasted at `Severity.Error`, so a failed delete is visible rather than silent.
- **Why it's built this way**: passing the localized strings and the error mapper in as parameters keeps this class free of any resource dependency, so each page supplies its own translated text ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) while the flow itself stays identical everywhere.
- **Where it's used**: ten list pages in current source. Identity's [`UserList`](#userlist) uses both methods (`MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:39,76-83`), and the Conference UI uses them from `EventList`, `SessionList`, `SpeakerList`, `RoomList`, `QuestionList`, `ConferenceCategoryList`, `PublicEventList`, `PublicSessionListView`, and `PublicSpeakerList`.

### SelfHttpWarmupTask
> MMCA.ADC.Identity.Service · `MMCA.ADC.Identity.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:23` · Level 2 · class (sealed, internal)

- **What it is**: the Identity service's startup warm-up. Once Kestrel is listening, it replays the hot users read against the host's own cleartext endpoint so routing, authentication, and the middleware pipeline are JIT-compiled before the first real request arrives.
- **Depends on**: [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) from `MMCA.Common.Aspire.Warmup`; externals: ASP.NET Core (`IServer`, `IHostApplicationLifetime`, `IHostEnvironment`), `IConfiguration`, `ILogger<T>`.
- **Concept reinforced, the cold-start warm-up task ([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)).** `[Rubric §12, Performance & Scalability]` (assesses whether first-request latency after a scale-out or restart is managed rather than paid by a user) and `[Rubric §13, Observability & Operability]` (assesses that readiness reflects the instance's real ability to serve). The base class, taught in group-16, discovers the bound address, waits for `ApplicationStarted`, and issues the configured GETs; the runner registered by `AddWarmupReadiness()` keeps `/health/ready` not-ready until the task has had its chance, so the orchestrator does not route traffic into a cold instance. Failures are logged and fall back to lazy warm-up, so a warm-up problem degrades startup latency rather than blocking the service.
- **Walkthrough**: a primary-constructor class that forwards all five dependencies to the base (`SelfHttpWarmupTask.cs:23-29`) and overrides three members.
  - `Paths` (`SelfHttpWarmupTask.cs:33-36`), one entry: `users?pageNumber=1&pageSize=10`. The comment above it ties the string to reality: it is the exact shape [`UserService.GetPagedAsync`](#userservice) builds for the organizer list once the empty filter and sort values are dropped, leaving only the paging pair.
  - `Name => "SelfHttpWarmup"` (`SelfHttpWarmupTask.cs:39`) and `WarmupPaths => Paths` (`SelfHttpWarmupTask.cs:42`), the base's two abstractions.
  - `RequireSuccessStatusCode => false` (`SelfHttpWarmupTask.cs:49`), the one genuinely interesting override. [`UsersController`](#userscontroller) is `[Authorize]` plus `[HasPermission]`, so an unauthenticated self-request is refused by design and returns 401. The comment (`SelfHttpWarmupTask.cs:44-48`) makes the argument: the refusal still traverses Kestrel, routing, authentication, and the whole middleware pipeline, which is exactly where the cold-start JIT cost lives, so a 401 is the correct outcome and treating it as a failure would log a spurious warning on every single startup.
- **Why it's built this way**: the class doc (`SelfHttpWarmupTask.cs:6-17`) draws the contrast with Conference's task, which warms public read endpoints and therefore also populates the output cache. Identity has no anonymous read to warm, so this task buys pipeline JIT only, and it says so rather than pretending to prime a cache it cannot reach.
- **Where it's used**: registered with `services.AddWarmupTask<SelfHttpWarmupTask>()` in the Identity service host (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:171`), where the surrounding comment block (`Program.cs:167-170`) repeats the rationale for an operator reading the host file.
- **Caveats / not-in-source**: the base type decides how the bound address is discovered and whether the run is skipped under the Testing environment; this file only supplies the paths and the status-code policy.

### UserDeleted
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` · Level 2 · record (sealed)

- **What it is**: the in-process domain event the [`User`](#user) aggregate raises when an account is soft-deleted (BR-56). It carries the user id and nothing else.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the `UserIdentifierType` alias.
- **Concept reinforced, the domain event as an internal fact.** `[Rubric §4, DDD]` (assesses whether state changes that other code cares about are expressed as named domain facts instead of inferred from a database write) and `[Rubric §6, CQRS & Event-Driven]`. The distinction from an integration event is the one to keep straight, and this module holds both kinds side by side: a `BaseDomainEvent` such as this one is dispatched in-process by the framework's `DomainEventDispatcher` after `SaveChangesAsync` (deferred until after commit when a transaction is open), while a `BaseIntegrationEvent` such as [`UserRegistered`](#userregistered) leaves its outbox row unprocessed for the `OutboxProcessor` to publish to the broker ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). Same `AddDomainEvent` call at the aggregate, two very different delivery paths, chosen purely by base type.
- **Walkthrough**: a one-line positional record, `public sealed record class UserDeleted(UserIdentifierType UserId) : BaseDomainEvent` (`UserDeleted.cs:10-12`). The id-only payload is deliberate: an in-process subscriber can load whatever else it needs from the same unit of work, and a fat payload would go stale between raise and dispatch.
- **Why it's built this way**: raising the event inside `User.Delete` (`User.cs:363`) and only when the base soft-delete actually succeeded (`User.cs:361`) means a second delete on an already-deleted account raises nothing, so subscribers cannot see a duplicate fact.
- **Where it's used**: raised by [`User.Delete`](#user) (`User.cs:357-367`) and asserted by the domain tests (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Users/UserInvariantsAndRoleTests.cs:255-263`).
- **Caveats / not-in-source**: no handler subscribes to it anywhere in ADC source today. The doc comment names cascade cleanup and audit logging as the intended consumers (`UserDeleted.cs:6-7`), but that is an available extension point, not shipped behavior; the actual cross-context cleanup on delete happens inside [`DeleteUserHandler`](#deleteuserhandler).

### UserPasswordChanged
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` · Level 2 · record (sealed)

- **What it is**: the in-process domain event raised when a user's credentials are replaced (BR-204).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the `UserIdentifierType` alias.
- **Concept**: structurally identical to [`UserDeleted`](#userdeleted), and the same domain-event-versus-integration-event distinction applies. What is worth noticing is the omission: the payload is the id only (`UserPasswordChanged.cs:9-11`), never the new hash or salt. A security-relevant event that carried credential material would turn every future subscriber, and every log line that serialized it, into a leak (`[Rubric §11, Security]`).
- **Walkthrough**: `public sealed record class UserPasswordChanged(UserIdentifierType UserId) : BaseDomainEvent` (`UserPasswordChanged.cs:9-11`).
- **Where it's used**: raised by [`User.ChangePassword`](#user) after the invariants pass and the new hash/salt are assigned (`User.cs:325`), and asserted by the domain tests (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Users/UserTests.cs:200`).
- **Caveats / not-in-source**: like [`UserDeleted`](#userdeleted), no handler subscribes to it in ADC source today. Session revocation on a password change is not driven from this event; refresh-token revocation is an explicit aggregate call (`User.RevokeRefreshToken`, `User.cs:252-256`).

### UserRegistered
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` · Level 3 · record (sealed)

- **What it is**: the cross-service announcement that a new account exists. It carries the database-generated user id plus the identity fields another context needs to match on, and it is the event that drives the BR-207 speaker auto-link.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent), the `UserIdentifierType` alias.
- **Concept introduced, the integration event as a published contract.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether contexts collaborate through facts rather than commands), `[Rubric §7, Microservices Readiness]` (assesses that the producer does not know its consumers), and `[Rubric §9, API & Contract Design]`. Three properties of this record make it a contract rather than an internal message. It lives in `Shared`, the assembly a consumer may reference without touching Identity's Domain or Application. It carries denormalized primitives (`string Email`, `string Role`) rather than the [`Email`](group-02-domain-building-blocks.md#email) value object or [`UserRole`](#userrole), so a subscriber needs no Identity types to deserialize it. And it is a `record` with positional members, so adding an optional member later is an additive change consumers can ignore ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)).
- **Walkthrough**: five positional members (`UserRegistered.cs:23-29`): `UserId`, `Email`, `FirstName`, `LastName`, `Role`. `Email` is the field the auto-link actually matches on; the two name fields exist so a subscriber can report candidates without a call back into Identity.
- **Why it's built this way**: the ordering problem is the whole story. The id is a database-generated identity column, so the event cannot be raised inside [`User.Create`](#user) (the factory doc says so outright, `User.cs:142-148`): the id is still `default` at that point. Instead [`AuthenticationService`](#authenticationservice) opens a transaction around the base registration workflow (`AuthenticationService.cs:57-63`), then in `OnUserRegisteredAsync` raises the event on the already-persisted aggregate and saves a second time (`AuthenticationService.cs:112-117`). The first save populates the real id; the second save writes the outbox row; both are inside one transaction, so the user and the event commit atomically. The remarks on that override (`AuthenticationService.cs:103-111`) also name the consequence honestly: this is eventual consistency, and the token handed back to the just-registered user does not yet carry the `speaker_id` claim. The same raise happens for brand-new external OAuth users (`AuthenticationService.cs:230-236`).
- **Where it's used**: consumed by Conference's [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:42`), which runs the email-match speaker auto-link and publishes `SpeakerLinkedToUser` back so Identity can set `User.LinkedSpeakerId`. The subscription is wired in the Conference service host with `x.RegisterIntegrationEventConsumer<UserRegistered>()` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:321`).
- **Caveats / not-in-source**: the type's own doc comment says the event is "Published by `AuthenticationService` AFTER the unit-of-work commit" (`UserRegistered.cs:6-10`), which no longer describes the mechanism: current source raises it via `AddDomainEvent` on the aggregate after the first save so the outbox row commits in the same transaction (`AuthenticationService.cs:114-115`). The code is ground truth here; the doc comment predates the atomicity fix described at `AuthenticationService.cs:22-31`.

### UserService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:14` · Level 3 · class (sealed)

- **What it is**: the HTTP implementation of [`IUserUIService`](#iuseruiservice). It builds the query string, attaches the bearer token, applies the shared retry policy, and turns responses into the tuples and strings the pages consume.
- **Depends on**: [`IUserUIService`](#iuseruiservice), [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase), [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); externals: `IHttpClientFactory`, `System.Net.Http.Json`, `MultipartFormDataContent`.
- **Concept reinforced, the authenticated client service.** `[Rubric §18, UI Architecture]` and `[Rubric §26, Front-End Security]` (assesses that tokens are attached by one audited helper rather than by each caller). The base class supplies `CreateAuthenticatedClientAsync()` and `RetryPolicy`, so every method here follows the same three-step shape: create a token-bearing client, execute through the retry policy, then translate the response. The token never appears in this file, which is the point.
- **Walkthrough**: five methods over a single `Endpoint = "users"` constant (`UserService.cs:17`).
  - `GetPagedAsync` (`UserService.cs:19-64`) puts all eight parameters into a dictionary, drops the null/whitespace entries, and URL-encodes the survivors with `Uri.EscapeDataString` (`UserService.cs:30-44`). That filter is why [`SelfHttpWarmupTask`](#selfhttpwarmuptask) warms exactly `users?pageNumber=1&pageSize=10`: with no filters set, only the paging pair survives. Non-success responses go through `ServiceExceptionHelper.ThrowIfDomainExceptionAsync`, which rethrows a server `ProblemDetails` as a typed domain exception before the blunt `EnsureSuccessStatusCode` (`UserService.cs:53-56`). The body deserializes as `PagedCollectionResult<UserListDTO>` and is flattened to `(Items, TotalItemCount)` with null-coalescing defaults so a null body reads as an empty page, not a crash (`UserService.cs:58-63`).
  - `DeleteAsync` (`UserService.cs:66-82`) builds `users/{id}` with `CultureInfo.InvariantCulture` (an id must never be culture-formatted), retries, translates failures the same way, and returns `true`.
  - `GetMyAvatarUrlAsync` (`UserService.cs:84-96`) is the one method that swallows failure: any non-success status returns `null` (`UserService.cs:91-92`), because "no avatar" and "could not fetch the avatar" render identically as the fallback initials, and a toast would be noise on a profile page load.
  - `UploadMyAvatarAsync` (`UserService.cs:98-121`) posts a `MultipartFormDataContent` with one `file` part carrying the caller's content type. It deliberately does **not** use the retry policy, and the comment says why (`UserService.cs:106`): the content stream is single-shot, since file-picker and file-input streams do not rewind, so a retry would post an empty body. This is the sharpest example in the module of a resilience policy being wrong for a specific call (`[Rubric §29, Resilience & Business Continuity]`).
  - `RemoveMyAvatarAsync` (`UserService.cs:123-135`) deletes and returns the success flag.
- **Why it's built this way**: manual query-string assembly (rather than a typed query object) keeps the client honest about what the API actually accepts, and returning plain tuples/strings instead of `Result<T>` matches the UI layer's convention of surfacing failures as exceptions that [`ListPageActions`](#listpageactions) and the page code map to snackbars.
- **Where it's used**: registered as `IUserUIService` in [`DependencyInjection.AddIdentityUI`](#dependencyinjection) (`MMCA.ADC.Identity.UI/DependencyInjection.cs:29`) and consumed by [`UserList`](#userlist) and [`Profile`](#profile) through the interface, so the same code runs on Blazor Server, WebAssembly, and MAUI.

### UserClaimsController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` · Level 4 · class (sealed)

- **What it is**: a single read-only endpoint that echoes the authenticated caller's JWT claims back as a JSON object (UC-10). It is the "who does the server think I am" diagnostic.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase); externals: ASP.NET Core MVC (`[ApiController]`, `[Authorize]`, `HttpContext.User`), Asp.Versioning.
- **Concept reinforced, the thin diagnostic controller.** `[Rubric §13, Observability & Operability]` (assesses whether an operator can inspect live state without attaching a debugger) and `[Rubric §11, Security]`. The security property to notice is that the endpoint reflects only `HttpContext.User`, the principal the authentication middleware already built from the presented token. It reads nothing from the database and accepts no id, so the worst a caller can learn is what they already hold. `[Authorize]` (`UserClaimsController.cs:15`) makes an anonymous call a 401 rather than an empty object.
- **Walkthrough**: one action, `GetClaims()` (`UserClaimsController.cs:25-38`). It groups the principal's claims by type (`UserClaimsController.cs:27-28`) and projects each group into a dictionary entry whose value is either the single string or the list of strings (`UserClaimsController.cs:33-34`). That collapse is what makes the JSON pleasant: single-valued claims such as `user_id` or `email` serialize as scalars, while a genuinely repeated claim stays an array instead of being silently truncated. The doc comment (`UserClaimsController.cs:18-21`) names the expected set: `user_id`, `email`, `role`, and the optional `speaker_id`.
- **Why it's built this way**: routing is `[Route("[controller]")]` (`UserClaimsController.cs:13`), so the resource is `/userclaims`, and `[ApiVersion("1.0")]` puts it under the same header-based versioning as every other ADC endpoint ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)). Returning `ActionResult` with an anonymous dictionary rather than a named DTO is a deliberate exception to the module's DTO discipline: the payload is by definition whatever claims the token happens to carry, so there is no stable shape to name.
- **Where it's used**: reachable through the Gateway alongside the other Identity endpoints; it is a support and debugging surface rather than something the ADC UI calls in a normal flow.

### UserRole
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` · Level 4 · class (sealed)

- **What it is**: the closed set of ADC roles as a value object: `Organizer`, `Attendee`, and `ContentEditor`, with case-insensitive parsing, validation, and equality.
- **Depends on**: [`RoleValue`](group-08-auth.md#rolevalue) (the shared base), [`RoleNames`](group-08-auth.md#rolenames) (the string constants), [`Result<T>`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); externals: `System.Collections.Frozen.FrozenDictionary`.
- **Concept introduced, the closed-set value object over a persisted string.** `[Rubric §4, DDD]` (assesses whether concepts with rules get a type instead of a bare primitive) and `[Rubric §2, Design Patterns]`. The base [`RoleValue`](group-08-auth.md#rolevalue) supplies case-insensitive value equality, hashing, and validation once for both apps; this type only fixes the ADC role set (`UserRole.cs:11-16`). Note what it is *not*: an `enum`. The [`User`](#user) aggregate stores `Role` as a `string` (`User.cs:50`) so EF maps a plain column and a JWT claim round-trips without conversion, while every place that reasons about roles goes through this type. That combination, primitive at rest and typed in the domain, is the pattern [ADR-068](https://ivanball.github.io/docs/adr/068-value-objects-as-validated-primitives.html) describes.
- **Walkthrough**
  - The three static instances (`UserRole.cs:20`, `:23`, `:30`), each built from a [`RoleNames`](group-08-auth.md#rolenames) constant so the domain and the auth layer cannot drift apart. The `ContentEditor` doc (`UserRole.cs:25-29`) is worth reading: it defines the role as a strict capability subset of Organizer, able to curate sessions, speakers, and categories but not to change event structure, rooms, feedback questions, session selection, or read the user list.
  - `AllByValue` (`UserRole.cs:32-33`), a `FrozenDictionary<string, UserRole>` built once by the base's `BuildLookup`. Frozen dictionaries trade a slower build for faster reads, which is exactly right for a table that is populated at type-init and then read on every authorization check (`[Rubric §12, Performance & Scalability]`).
  - `All` (`UserRole.cs:44`) exposes the values; the private constructor (`UserRole.cs:35-38`) makes the three statics the only instances that can exist.
  - `FromString(string role)` (`UserRole.cs:51-58`) is the Result-returning parse: a hit returns `Result.Success`, a miss returns `Error.Invariant` with the code `User.Role.Invalid`. `role ?? string.Empty` means a null argument is a clean validation failure, not a `NullReferenceException`.
  - `IsValid(string role)` (`UserRole.cs:65`) is the boolean form used by [`UserInvariants.EnsureRoleIsValid`](#userinvariants).
  - `IsOrganizer(string? role)` (`UserRole.cs:76`) compares with `StringComparison.OrdinalIgnoreCase`, and its doc explains the trap it exists to avoid (`UserRole.cs:67-73`): a raw claim string may carry any casing, and `role == UserRole.Organizer` would go through the implicit string conversion and compare *ordinally*, quietly failing on `"organizer"`. This is an authorization-relevant helper, so the subtlety is load-bearing (`[Rubric §11, Security]`).
  - The equality surface (`UserRole.cs:78-90`) and the implicit `string` conversion with its `ToString` alternate (`UserRole.cs:94-98`), which is what lets the type flow into string-typed APIs such as `User.Create(..., UserRole.Attendee)` (`AuthenticationService.cs:96`).
- **Why it's built this way**: a `FromString` returning `Result<UserRole>` instead of throwing keeps role parsing on the same error channel as every other validation in the codebase ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)), and keeping the role set in the Domain assembly means the invariant "a user's role is one of these three" is enforced where the aggregate lives, not at the API edge.
- **Where it's used**: by [`UserInvariants.EnsureRoleIsValid`](#userinvariants) (`UserInvariants.cs:65`), by [`User`](#user)'s parameterless constructor default and `CreateExternal` (`User.cs:120`, `:216`), by [`AuthenticationService.CreateUser`](#authenticationservice) for the BR-45 attendee default (`AuthenticationService.cs:96`), and by the handlers that gate owner-or-Organizer access such as [`DeleteUserHandler`](#deleteuserhandler) and [`ExportUserDataHandler`](#exportuserdatahandler).

### UserInvariants
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:9` · Level 6 · class (static)

- **What it is**: the rule book for the [`User`](#user) aggregate: the field length constants plus one `Ensure...` method per invariant, each returning a [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the shared primitive checks), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), [`UserRole`](#userrole); externals: `System.Net.Mail.MailAddress`.
- **Concept reinforced, the static invariants class.** `[Rubric §4, DDD]` (assesses whether invariants live with the aggregate that owns them) and `[Rubric §1, SOLID]`. The framework convention, introduced in group-02, is that an aggregate's factory does not contain its rules: the rules live in a static sibling class as independent, individually testable functions, and the factory composes them with `Result.Combine` so the caller gets *every* violation at once instead of the first one. [`User.Create`](#user) is the worked example, combining six checks in a single call (`User.cs:165-172`).
- **Walkthrough**
  - Four public constants (`UserInvariants.cs:12-21`): `FirstNameMaxLength` and `LastNameMaxLength` at 100, `EmailMaxLength` at 100, `DeviceFieldMaxLength` at 256. They are `public const` for a reason: the API-layer [`RegisterRequestValidator`](#registerrequestvalidator) reuses them (`RegisterRequestValidator.cs:16-19`) and the EF configuration sizes its columns from them, so the domain rule, the wire validation, and the schema cannot disagree.
  - `EnsureEmailIsValid` (`UserInvariants.cs:23-43`) is the only sequential (short-circuiting) check: not empty, then within length, then parseable by `MailAddress.TryCreate`, returning `User.Email.InvalidFormat` on the last. The order matters because running a format parse on an empty string would report a confusing second error.
  - `EnsureFirstNameIsValid` / `EnsureLastNameIsValid` (`UserInvariants.cs:45-53`) each `Result.Combine` a non-empty check with a max-length check, so both problems surface together.
  - `EnsurePasswordHashIsValid` / `EnsurePasswordSaltIsValid` (`UserInvariants.cs:55-59`) delegate to `CommonInvariants.EnsureBytesAreNotEmpty`. They assert presence only: strength is a request-level concern ([`ChangePasswordRequestValidator`](#changepasswordrequestvalidator)) and the hash itself is opaque to the domain.
  - `EnsureRoleIsValid` (`UserInvariants.cs:64-71`) defers to [`UserRole.IsValid`](#userrole) and returns `User.Role.Invalid` on a miss.
  - `EnsurePreferredCultureIsValid` and `EnsurePreferredThemeIsValid` (`UserInvariants.cs:76-93`) forward to the shared `CommonInvariants` equivalents, passing ADC's own error codes and messages. The allowlist of supported cultures ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) and the light/dark theme set ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)) live in the framework; only the wording is app-specific.
- **Why it's built this way**: every method takes a `source` string that becomes the error's `source` field, so a failure reports which operation raised it (`nameof(Create)`, `nameof(ChangePassword)`, `nameof(UpdatePreferences)`). That is why the same invariant can be shared by the create and change paths without losing diagnostic context.
- **Where it's used**: by [`User.Create`](#user) (`User.cs:167-171`), [`User.CreateExternal`](#user) (`User.cs:208-209`), [`User.UpdatePreferences`](#user) (`User.cs:284-285`), and [`User.ChangePassword`](#user) (`User.cs:314-315`); the length constants are reused by [`RegisterRequestValidator`](#registerrequestvalidator).
- **Caveats / not-in-source**: `EnsureEmailIsValid` and `DeviceFieldMaxLength` are not called from [`User`](#user) in current source. The aggregate validates its address through the [`Email`](group-02-domain-building-blocks.md#email) value object's own `Create` instead (`User.cs:164`, `:205`, `:385`), so the email invariant here is a second, currently unused expression of the same rule.

### OAuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` · Level 7 · class (sealed)

- **What it is**: ADC's external social-login endpoint surface (Google and GitHub). It is a body-less class: every action is inherited from the shared [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase), and this file exists to supply the route, the version, and the concrete dependencies.
- **Depends on**: [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (aliased at `OAuthController.cs:6` to disambiguate from the ASP.NET Core type of the same name), [`ICacheService`](group-09-caching.md#icacheservice), `IConfiguration`.
- **Concept introduced, the derived-controller-as-configuration pattern.** `[Rubric §16, Maintainability]` (assesses whether a shared workflow is inherited rather than copied) and `[Rubric §9, API & Contract Design]`. The whole class is a primary constructor forwarding three dependencies to a base (`OAuthController.cs:20-23`), terminated with a semicolon: there is no body at all. The base owns the four-step flow ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)): `GET google` and `GET github` issue the challenge (`OAuthControllerBase.cs:49`, `:57`), `GET complete` handles the provider callback (`OAuthControllerBase.cs:73-75`), and `POST exchange` trades a single-use code for tokens (`OAuthControllerBase.cs:135-138`). That last step is the security-relevant one: tokens are never placed in the redirect URL, where they would land in browser history and referrer headers (`[Rubric §26, Front-End Security]`, `[Rubric §11, Security]`).
- **Walkthrough**: three attributes and three constructor parameters.
  - `[ApiController]`, `[Route("auth/oauth")]`, `[ApiVersion("1.0")]` (`OAuthController.cs:17-19`). The class doc records the non-obvious reason these are repeated here rather than inherited (`OAuthController.cs:15`): routing and versioning attributes are not reliably inherited from the base, so omitting them would leave the endpoints unroutable.
  - `IAuthenticationService` resolves to Identity's own [`AuthenticationService`](#authenticationservice), which is what makes the base's provider-agnostic flow create or link an ADC [`User`](#user). `ICacheService` backs the single-use exchange code. `IConfiguration` supplies the provider and redirect settings.
- **Why it's built this way**: external OAuth is an ADC-only feature (Store is local-credential only), but the *protocol* is app-agnostic, so the flow was hoisted into `MMCA.Common.API` and each app contributes only its route prefix and its authentication service. Pairing this controller with `AddExternalAuthProviders` in the service host (`OAuthController.cs:13-14`) is what completes the wiring.
- **Where it's used**: mounted by the Identity service host and fronted by the Gateway; the browser and MAUI clients drive it, and the email-verified guard on the linking step is answered by [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier).
- **Caveats / not-in-source**: the provider registrations, scopes, and the Google `email_verified` claim mapping live in the Identity service host's `Program.cs`, not in this file.

### RegisterRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:12` · Level 7 · class (sealed)

- **What it is**: the rule set for a registration request: a well-formed email within the domain's length limit, a strong password, required first and last names, and an optional address that is validated only when present.
- **Depends on**: [`RegisterRequest`](group-08-auth.md#registerrequest), [`EmailRules<T>`](group-06-validation.md#emailrulest), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest), [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), [`AddressValidator`](group-06-validation.md#addressvalidator), [`UserInvariants`](#userinvariants); externals: FluentValidation.
- **Concept reinforced, composing shared rule sets, and tying them to the domain's constants.** `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §15, Best Practices & Code Quality]`. This validator is almost entirely `Include` calls: the four reusable rule sets from `MMCA.Common.Application.Validation` carry the actual logic, and this class only chooses which property each applies to. The detail worth copying is that the length arguments are not literals: `UserInvariants.EmailMaxLength`, `UserInvariants.FirstNameMaxLength`, and `UserInvariants.LastNameMaxLength` (`RegisterRequestValidator.cs:16,18,19`) come straight from the aggregate's own rules. A request can therefore never be accepted at the edge and then rejected by the domain for a length the API thought was fine.
- **Walkthrough**: one constructor (`RegisterRequestValidator.cs:14-24`).
  - `EmailRules<RegisterRequest>(x => x.Email, "Email", UserInvariants.EmailMaxLength)` (`RegisterRequestValidator.cs:16`): presence, format, and length, with "Email" as the display name in messages.
  - `StrongPasswordRules<RegisterRequest>(x => x.Password)` (`RegisterRequestValidator.cs:17`), the same complexity policy [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) applies to a new password.
  - Two `RequiredStringRules<RegisterRequest>` for the names (`RegisterRequestValidator.cs:18-19`).
  - The conditional address rule (`RegisterRequestValidator.cs:21-23`): `RuleFor(x => x.Address).SetValidator(new AddressValidator()!).When(x => x.Address is not null)`. `When` is what makes the address genuinely optional: omitting it is valid, but supplying a malformed one is not.
- **Why it's built this way**: registration is anonymous and internet-facing, so it is the most hostile input surface in the module. Composing framework-owned rule sets means a tightening of the shared password policy applies here without a code change (`[Rubric §11, Security]`).
- **Where it's used**: auto-registered as `IValidator<RegisterRequest>` by `ScanModuleApplicationServices<ClassReference>()` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:39`) and injected into `AuthenticationValidators` as its `Register` member (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:18,25`), which [`AuthenticationService`](#authenticationservice) receives through its base and runs at the top of `RegisterAsync`. The endpoint is `POST auth/register` on [`AuthController`](#authcontroller).

### User
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:26` · Level 7 · class (sealed)

- **What it is**: the Identity aggregate root. One row per account, holding credentials, role, refresh-token lifecycle, profile fields, optional MAUI device metadata, external-login identifiers, UI preferences, the avatar URL, and the scalar link to a Conference `Speaker`.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser), [`IUserPreferences`](group-08-auth.md#iuserpreferences), [`IErasableUser`](group-08-auth.md#ierasableuser) (which extends [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable)), [`Email`](group-02-domain-building-blocks.md#email), [`UserRole`](#userrole), [`UserInvariants`](#userinvariants), [`UserPasswordChanged`](#userpasswordchanged), [`UserDeleted`](#userdeleted), [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`Result`](group-01-result-error-handling.md#result); externals: BCL only.
- **Concept introduced, the interface list as a workflow contract.** `[Rubric §4, DDD]` (assesses whether the aggregate is the consistency boundary and enforces its own invariants) and `[Rubric §1, SOLID]` (assesses interface segregation: three narrow capability interfaces instead of one fat base). The class remarks (`User.cs:16-24`) explain something genuinely easy to get wrong. The shared framework workflows are generic over capability interfaces: `ChangePasswordHandlerBase` constrains on `IPasswordChangeableUser`, and the erasure workflow constrains on `IErasableUser`. Listing `IErasableUser` **on this type directly** is load-bearing because `Delete` here *hides* the base soft-delete with `new` (`User.cs:357`); only re-declaring the interface on `User` re-maps the interface slot onto this type's own member, which is what keeps the refresh-token revocation inside the shared erasure path. Remove the interface from the declaration list and the code still compiles while quietly calling the base method instead.
  - `[IdValueGenerated]` (`User.cs:25`) tells the persistence layer the id is database-generated. That single attribute is the root cause of the [`UserRegistered`](#userregistered) two-save dance: the id does not exist until after the insert.
- **Walkthrough**
  - **State** (`User.cs:29-105`). `Email` is an [`Email`](group-02-domain-building-blocks.md#email) value object, not a string, and is marked `[Pii]` along with `FirstName`, `LastName`, and `AvatarUrl` (`User.cs:30`, `:34`, `:38`, `:103`); the `[Pii]` marks are what let the privacy tooling find personal columns ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). `PasswordHash` and `PasswordSalt` are `byte[]` mapped to `varbinary(max)`, with a scoped `CA1819` suppression that names EF mapping as the reason (`User.cs:41-47`). `Role` is a `string` for EF and JWT round-tripping (`User.cs:50`) while [`UserRole`](#userrole) owns the rules. Every setter is `private`: state changes only through the methods below.
  - **Computed members**: `IsExternalLogin => LoginProvider is not null` (`User.cs:108`) and `FullName` (`User.cs:111`), derived rather than stored so they cannot go stale.
  - **Constructors** (`User.cs:113-137`): a private parameterless one for EF that initializes the non-nullable members to safe defaults (including `Role = UserRole.Attendee`), and a private full one used by the factories.
  - **`Create`** (`User.cs:156-184`): parses the email, then `Result.Combine`s six [`UserInvariants`](#userinvariants) checks, returns `Result.Failure<User>(result.Errors)` on any failure, and otherwise constructs with `Id = default`. The factory doc explicitly records that it does **not** raise a registration event and why (`User.cs:142-148`).
  - **`CreateExternal`** (`User.cs:198-224`): the OAuth path. It validates email and names only, sets `PasswordHash`/`PasswordSalt` to empty arrays (an external account has no local password, so the password invariants are deliberately skipped), forces `UserRole.Attendee`, and records `LoginProvider`/`ProviderKey`.
  - **Behavior**: `LinkExternalProvider` (`User.cs:232-236`) attaches a provider to an existing local account; `UpdateRefreshToken` / `RevokeRefreshToken` (`User.cs:243-256`) are the BR-205/BR-216 token lifecycle; `LinkSpeaker` / `UnlinkSpeaker` (`User.cs:263-271`) maintain the BR-207/BR-209 scalar cross-context link; `UpdateDeviceMetadata` (`User.cs:334-350`) sets the seven MAUI fields in one call.
  - **`UpdatePreferences`** (`User.cs:281-294`): combines the culture and theme invariants and assigns only after both pass, so a rejected theme cannot leave a half-applied culture.
  - **`ChangePassword`** (`User.cs:311-328`): validates the new hash and salt, assigns, and raises [`UserPasswordChanged`](#userpasswordchanged) via `AddDomainEvent` (`User.cs:325`).
  - **`Delete`** (`User.cs:357-367`): the `new` hiding method. It revokes the refresh token *first* (`User.cs:359`), so an account that is being deleted cannot keep minting access tokens from an outstanding refresh token, then calls `base.Delete()` and raises [`UserDeleted`](#userdeleted) only when that succeeded.
  - **`Anonymize`** (`User.cs:380-415`): the erasure half. It builds the placeholder address `deleted-{Id}@anonymized.invalid` with `CultureInfo.InvariantCulture`, and the id embedded in the address is what keeps the unique-email invariant (BR-200) satisfiable across many erased accounts. It is idempotent by construction: if the current email already equals the placeholder there is nothing left to erase and it returns success (`User.cs:391-395`). Otherwise it overwrites the email, names, credentials, all seven device fields, both external-login fields, and the avatar URL, and revokes the refresh token.
- **Why it's built this way**: `Delete` and `Anonymize` are separate operations, and the doc on `Anonymize` (`User.cs:369-378`) says exactly why: the row survives so cross-context scalar references (bookmarks, notifications) and the audit trail do not break, which is the anonymize-in-place policy of [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html). It is also why a re-registration with an erased account's original email succeeds by design, a nuance [`AuthenticationService.EmailExistsAsync`](#authenticationservice) documents at `AuthenticationService.cs:77-84`. The avatar comment (`User.cs:98-102`) draws the matching line for storage: the domain nulls the URL, and the use case, which knows the blob boundary, deletes the file ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: persisted by [`UserConfiguration`](#userconfiguration), projected by [`UserDTOMapper`](#userdtomapper), driven by [`AuthenticationService`](#authenticationservice) and the Users use cases ([`ChangePasswordHandler`](#changepasswordhandler), [`DeleteUserHandler`](#deleteuserhandler), [`ExportUserDataHandler`](#exportuserdatahandler), [`SetUserAvatarHandler`](#setuseravatarhandler), [`RemoveUserAvatarHandler`](#removeuseravatarhandler)), and read by [`GetUsersHandler`](#getusershandler).

### UsersController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:30` · Level 9 · class (sealed)

- **What it is**: the `/users` REST surface: the organizer user list, account delete, the GDPR data export, and the three avatar endpoints for the signed-in user. Six actions, each a thin adapter over one handler.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) closed over six use cases, [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute), [`IdentityPermissions`](#identitypermissions), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`UserDataExportDTO`](#userdataexportdto), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); externals: ASP.NET Core MVC (`IFormFile`, `[RequestSizeLimit]`, `[Range]`).
- **Concept introduced, the controller as a translator between HTTP and the handler pipeline, and the two shapes of authorization.** `[Rubric §9, API & Contract Design]`, `[Rubric §11, Security]`, `[Rubric §5, Vertical Slice]` (assesses whether each endpoint routes to its own use case rather than into a shared service). Every action follows the same four lines: read the caller from `ICurrentUserService`, build the command or query record, `await handler.HandleAsync(...)`, then `result.IsFailure ? HandleFailure(result.Errors) : Ok(...)`. The controller holds no business logic, which is why the decorator pipeline (logging, caching, validation, transaction) applies uniformly. The authorization split is the interesting part:
  - **Declarative**, for a role-shaped rule: the list endpoint carries `[HasPermission(IdentityPermissions.UsersRead)]` (`UsersController.cs:124`), the permission-based check of [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html). A caller without `identity:users:read` never reaches the handler.
  - **In-handler**, for an ownership-shaped rule: delete and export pass the caller's id and role *into* the command or query (`UsersController.cs:161`, `:183`) so the handler can apply owner-or-Organizer and, importantly, return 404 rather than 403 for a stranger's id, which avoids leaking whether that account exists ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)).
- **Walkthrough**: class-level `[Authorize]` (`UsersController.cs:29`) makes every action authenticated by default, and each action re-checks `currentUserService.UserId is null` and returns `Unauthorized()` for the "authenticated but no usable id" case.
  - `MaxAvatarBytes = 2 * 1024 * 1024` (`UsersController.cs:40`), the BR-116a ceiling.
  - `GET me/avatar` (`UsersController.cs:43-58`), resolving the subject from the token rather than a route parameter.
  - `POST me/avatar` (`UsersController.cs:65-101`) is the richest action. `[RequestSizeLimit(MaxAvatarBytes)]` (`UsersController.cs:66`) rejects an oversized body at the pipeline before any of it is buffered; the inline guard then re-checks null, zero-length, and over-limit and returns a validation error (`UsersController.cs:77-83`), so the limit is enforced twice for two different failure modes. The stream is copied into a right-sized `MemoryStream` (`UsersController.cs:86-92`), with both `await using` scopes carrying `ConfigureAwait(false)`, and the byte array is handed to [`SetUserAvatarCommand`](#setuseravatarcommand). The action doc records what the handler then does (`UsersController.cs:61-63`): sniff the real format, re-encode to 256x256 JPEG, return the public URL. Trusting a declared content type here would be an upload vulnerability.
  - `DELETE me/avatar` (`UsersController.cs:104-119`), documented idempotent, returning 204.
  - `GET users` (`UsersController.cs:123-144`): eight `[FromQuery]` parameters with `[Range(1, int.MaxValue)]` on both paging values, so a `pageNumber=0` is a model-binding 400 rather than a handler concern.
  - `GET {userId}/export` (`UsersController.cs:148-167`) and `DELETE {userId}` (`UsersController.cs:170-189`), the two ownership-checked actions, both declaring 403 and 404 in their `ProducesResponseType` set.
- **Why it's built this way**: injecting six separate closed handler interfaces rather than one "user service" is what keeps each endpoint on its own vertical slice and makes the decorator pipeline the single place where cross-cutting behavior lives ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The consistent `HandleFailure(result.Errors)` tail means every failure becomes a `ProblemDetails` with the same shape, mapped once in [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase).
- **Where it's used**: mounted by the Identity service host and routed through the Gateway; consumed by [`UserService`](#userservice) on the client side, and warmed at startup by [`SelfHttpWarmupTask`](#selfhttpwarmuptask), whose expected 401 comes from this class's `[Authorize]` plus `[HasPermission]` pair.

### AuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:29` · Level 12 · class (sealed)

- **What it is**: the `/auth` endpoint surface: login, register, refresh, revoke, change password, and get/set the stored culture and theme preferences. Most of it is inherited; this class overrides two actions and supplies the two command factories.
- **Depends on**: [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (which itself extends [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase)), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`ChangePasswordCommand`](#changepasswordcommand), [`ChangePreferencesCommand`](#changepreferencescommand), [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`RegisterRequest`](group-08-auth.md#registerrequest), [`LoginRequest`](group-08-auth.md#loginrequest); externals: ASP.NET Core rate limiting (`[EnableRateLimiting]`).
- **Concept introduced, the generic controller base parameterized by the app's command types.** `[Rubric §16, Maintainability]`, `[Rubric §1, SOLID]`, `[Rubric §11, Security]`. The base owns the four token actions plus `PUT password` (`UserAccountAuthControllerBase.cs:86-91`), `PUT preferences` (`:112-117`), and `GET preferences` (`:138-142`). It cannot own the command *records*, because ADC marks its change-password command `ICacheInvalidating` with a cache prefix built from ADC's own [`User`](#user) type while Store does not; the base's own remarks record that reason (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:16-21`). The resolution is two abstract factory methods, which this class implements as one-liners (`AuthController.cs:82-89`): the shared workflow stays shared, and each app keeps its own command semantics.
- **Walkthrough**: primary constructor forwarding five dependencies to the base (`AuthController.cs:29-40`), then four members.
  - `RegisterAsync` (`AuthController.cs:52-63`) is a genuine override rather than a pass-through. It reads `HttpContext.Connection.RemoteIpAddress` and passes it to `AuthenticationService.RegisterAsync` (`AuthController.cs:57-58`), which is the BR-213 registration rate limiting: the Application layer cannot see the connection, so the IP has to be captured here and handed down. Success returns `201 Created` explicitly rather than `200`.
  - `LoginAsync` (`AuthController.cs:76-79`) overrides only to re-declare attributes, then calls `base.LoginAsync`. The reason is the attribute set: `[EnableRateLimiting("auth-ip")]` (`AuthController.cs:72`, the constant is `WebApplicationBuilderExtensions.RateLimitPolicyAuthIp`, `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:38`) and the documented 429. The doc comment (`AuthController.cs:66-69`) states the threat model precisely: the per-email lockout of BR-212 cannot stop one source spraying a single common password across many different emails, so a per-IP fixed window sits on top of it ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). Both anonymous endpoints, register and login, carry the same policy.
  - `CreateChangePasswordCommand` and `CreateChangePreferencesCommand` (`AuthController.cs:82-89`), the two factory implementations that bind ADC's command records to the base's workflow.
- **Why it's built this way**: `[Route("[controller]")]` (`AuthController.cs:27`) makes the prefix `/auth`, which is what the Gateway's route map fronts, and `[ApiVersion("1.0")]` keeps it on the header-based versioning scheme. Both anonymous actions are marked `[AllowAnonymous]` with the fully qualified attribute name (`AuthController.cs:47`, `:71`) because the file's `using` set does not import the authorization namespace.
- **Where it's used**: the entry point for every authenticated ADC client. The Blazor and MAUI clients call login/register/refresh through the Gateway; the [`Profile`](#profile) page uses `PUT auth/password` and the preferences pair; [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) guards the password action through the Validating decorator.

### UserList
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.User` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16` · Level 4 · class (partial)

- **What it is**: the code-behind for the organizer user list page: a server-paged, server-sorted, per-column-filterable grid on desktop and an infinite-scroll card list on mobile, with delete (BR-51, UC-21).
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (base), [`IUserUIService`](#iuseruiservice), [`ListPageActions`](#listpageactions), [`UserListDTO`](#userlistdto), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), the `DeleteConfirmation` component from `MMCA.Common.UI.Components`, and MudBlazor's `MudDataGrid<T>` / `GridState<T>` / `GridData<T>`.
- **Concept introduced, the code-behind list page over a framework base.** `[Rubric §18, UI Architecture]` assesses separation of markup from behavior and reuse of page scaffolding. The page is split into a `.razor` markup file and this `partial class`, and the class inherits [`DataGridListPageBase<UserListDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`UserList.razor.cs:16`), which supplies the localizer `L`, `Snackbar`, `IsMobile`, filter persistence, and the `LoadServerDataAsync` adapter. The subclass therefore contains only what is genuinely user-specific: which service to call, which four columns are filterable, and what to do on delete. `[Rubric §23, Front-End Performance]`: nothing is loaded client-side and filtered in the browser; paging, sorting, and filtering are all pushed to the API.
- **Walkthrough**
  - Base contract (`UserList.razor.cs:18-19`, `24`): `EntityName` and the overridden `Title` read from the localizer `L`, and `GridRef` exposes the `_dataGrid` field so the base can drive reloads.
  - Injected service (line 21): `[Inject] private IUserUIService UserService`, the interface, never a concrete HTTP type.
  - Component references (lines 23-30): the desktop grid, the mobile infinite list, the `DeleteConfirmation` dialog, and the toolbar search string. `_dataGrid` and `_infiniteList` are nullable (only one layout renders at a time), `_deleteConfirm` is `default!` because the dialog is always present in the markup.
  - `RetryLoadAsync` (line 27): the retry action offered by the base's inline error state, a null-safe `ReloadServerData()`.
  - `SaveFilters` / `RestoreFilters` (lines 32-36): the two overrides that persist the free-text `_searchString` across navigation, so returning to the list keeps the operator's search.
  - `ReloadActiveLayoutAsync` (lines 38-39) and `OnSearchChanged` (lines 41-45): the first is one line delegating to [`ListPageActions`](#listpageactions); the second records the new search text and reloads through it, so typing in the toolbar drives whichever layout is live.
  - `LoadServerData` (lines 47-64): the desktop fetch. It hands the base a lambda that pulls the four per-column filter values out of MudBlazor's filter dictionary by `nameof(UserListDTO.X)` (lines 52-55) and forwards them plus page, size, and sort to `UserService.GetPagedAsync` (lines 57-58). The second lambda (lines 60-64) injects the toolbar search box as a `contains` filter on `Email`, so free-text search and column filters travel one code path.
  - `FetchMobilePage` (lines 67-72): the mobile fetch, simplified to search-on-email only with a fixed `"Email"` ascending sort, because the card layout has no column headers to sort by.
  - `DeleteUserAsync` (lines 75-83): delegates the whole flow to `ListPageActions.DeleteWithConfirmationAsync`, passing the user's email as the confirmation subject, the delete call, and two localized messages (`Snackbar.UserDeleted`, `Snackbar.DeleteUserFailed`).
- **Why it's built this way**: `nameof(UserListDTO.Email)` rather than an `"Email"` literal ties the filter key to the DTO property, so a rename is a compile error rather than a silently dead filter. Delegating delete and reload to [`ListPageActions`](#listpageactions) means the cancellation-swallowing and confirm-first behavior is identical on every ADC list page, which is a `[Rubric §24, Forms, Validation & UX Safety]` concern: destructive actions always confirm.
- **Where it's used**: routed as the organizer user-management page in the ADC web and MAUI UI; the server side it calls is [`UsersController`](#userscontroller), whose list endpoint is gated on the `UsersRead` capability in [`IdentityPermissions`](#identitypermissions).

### Profile
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.Profile` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15` · Level 6 · class (partial)

- **What it is**: the code-behind for the "My Profile" page at `/profile`: the signed-in user's three self-service actions in one component, namely set or remove the avatar, change the password, and delete the account.
- **Depends on**: [`IUserUIService`](#iuseruiservice), [`IAuthUIService`](group-15-common-ui-framework.md#iauthuiservice), [`IMediaPickerService`](group-26-device-capability-layer.md#imediapickerservice) and [`PickedMedia`](group-26-device-capability-layer.md#pickedmedia), plus Blazor's `AuthenticationStateProvider`, `NavigationManager`, `InputFileChangeEventArgs`, and MudBlazor's `ISnackbar` / `MudForm` / `MudMessageBox` (`Profile.razor.cs:1-22`). The localizer `L` is injected in the markup half (`Profile.razor:3`), which is also where the route and `[Authorize]` attribute live (`Profile.razor:1-2`).
- **Concept introduced (1), the cross-head capability branch.** `[Rubric §22, Responsive & Cross-Browser]` assesses whether one component genuinely serves different hosts. The same page runs in the Blazor web head and inside the MAUI hybrid, and the avatar affordance differs: the markup branches on `MediaPicker.IsSupported` (`Profile.razor:46`) to offer "choose photo" plus "take photo" buttons on a native head, and falls back to a hidden `<InputFile accept="image/jpeg,image/png,image/webp">` behind a label-styled button on the web (`Profile.razor:59-66`). Both branches converge on one private method, `UploadAvatarStreamAsync` (`Profile.razor.cs:154-165`), so the upload contract is written once. That convergence is also why [`IUserUIService`](#iuseruiservice)'s upload method is typed on a raw `Stream` rather than on a framework-specific file type.
- **Concept introduced (2), the component-scoped `CancellationTokenSource`.** `[Rubric §18, UI Architecture]`. The page holds `private readonly CancellationTokenSource _cts = new()` (`Profile.razor.cs:27`), passes `_cts.Token` into every service call, and cancels plus disposes it through the standard disposable pattern (`Profile.razor.cs:277-295`). Every async entry point then catches `OperationCanceledException` separately from `Exception` and deliberately does nothing (`Profile.razor.cs:68-71`, `103-106`, `140-143`, `182-185`, `229-232`, `263-266`), with the comment naming the two causes: component disposal and an InteractiveAuto render-mode transition. A user who navigated away must not be shown a red error toast for a request that was cancelled on their behalf; a genuine failure still toasts.
- **Walkthrough**
  - `OnInitializedAsync` (`Profile.razor.cs:55-80`): awaits `AuthStateProvider.GetAuthenticationStateAsync()`, reads the `user_id` claim and parses it (lines 59-62). The page identifies its subject from the token, never from a route parameter, which is what makes it structurally incapable of acting on another account. Only when the claim parses does it fetch the avatar URL (line 65). `_isLoading` is cleared in `finally` (line 78), so a failed load still renders the error state rather than a permanent spinner.
  - Client-side avatar guard (lines 24-25, 125-129): `MaxAvatarBytes = 2 * 1024 * 1024`, and the browser path rejects an oversized file with a `Severity.Warning` toast before any bytes leave the machine. The doc comment says exactly what this is: a mirror of the server's BR-116a limit, not the enforcement point. The server re-checks in [`SetUserAvatarHandler`](#setuseravatarhandler).
  - Avatar paths: `PickAvatarAsync` and `CaptureAvatarAsync` (lines 86-88) both funnel through `UploadPickedMediaAsync` (lines 90-115), which disposes the [`PickedMedia`](group-26-device-capability-layer.md#pickedmedia) with `using` and returns silently when the user cancelled the picker (`media is null`, lines 95-99). The browser path `OnBrowserInputChangedAsync` (lines 117-152) opens the stream with `file.OpenReadStream(MaxAvatarBytes, _cts.Token)` and wraps it in `await using` so the read stream is released even on failure. `UploadAvatarStreamAsync` (lines 154-165) treats a `null` return from the service as a failure toast and only assigns `_avatarUrl` on success.
  - `RemoveAvatarAsync` (lines 167-194): a boolean-returning call whose `false` branch toasts the same error as a thrown exception, so the user sees one consistent outcome for "did not work".
  - Password form (lines 34-49, 196-241): two local validators, `ValidateNewPassword` (minimum length 8) and `ValidateConfirmPassword` (ordinal equality against `_newPassword`), both returning `null` for an empty value so the field's own `Required` rule owns the "missing" message instead of stacking two errors. `SavePasswordAsync` runs `form.ValidateAsync()` and returns early when invalid (lines 205-209), so a shape error costs no round trip; the errors also render as a list inside a `MudAlert` summary (`Profile.razor:98-109`). On success it resets the form and clears all three fields (lines 218-221). `[Rubric §24, Forms, Validation & UX Safety]`: this is client-side validation as an ergonomics layer over, never instead of, the server rules that live in the change-password validator and [`ChangePasswordHandler`](#changepasswordhandler).
  - `DeleteAccountAsync` (lines 243-275): guards on a known `_userId`, shows the `MudMessageBox` and aborts unless the answer is exactly `true` (`confirmed is not true`, lines 251-253, so cancel and dismiss both abort), then deletes, calls `AuthService.LogoutAsync()`, toasts, and navigates to `/` with `forceLoad: true` (line 261). The forced load matters: the account is gone, so the circuit and every piece of cached client state must be rebuilt from scratch rather than kept alive against a dead identity.
- **Why it's built this way**: keeping avatar, password, and deletion on one page mirrors the account-level scope of all three (each acts on the caller and only the caller), and every action ends in a snackbar with a localized message, so the page needs no bespoke error surface. `[Rubric §21, Accessibility]`: the markup carries an explicit `aria-label` on the `MudAvatar` (`Profile.razor:33`) because MudBlazor renders `role="img"`, which the axe `role-img-alt` rule requires to carry an accessible name even in the fallback-icon state; this page is one of the surfaces the deploy-gating WCAG 2.1 AA scan covers.
- **Where it's used**: routed at `/profile` for any authenticated user in both the web and MAUI heads. Its server round trips land on the Identity avatar endpoints, [`AuthController`](#authcontroller)'s `PUT password`, and [`UsersController`](#userscontroller)'s `DELETE {userId}`.
- **Caveats / not-in-source**: the 8-character minimum in `ValidateNewPassword` is a local literal (`Profile.razor.cs:44`); it does not reference the shared strong-password rule set the server applies, so the two can drift and only a server rejection would surface the difference.

### ChangePasswordCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:14` · Level 8 · record (sealed)

- **What it is**: the command for a self-service password change. It pairs the target `UserId` with the [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) body, opts into automatic request validation, and evicts the user cache on success.
- **Depends on**: [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest); the `UserIdentifierType` alias (`= int`); [`User`](#user) (only for `typeof(User).FullName`); and three framework markers, [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), and [`IUserScopedCommand<out TRequest>`](group-14-module-system-composition.md#iuserscopedcommandout-trequest).
- **Concept introduced, three markers that each buy exactly one pipeline behavior.** `[Rubric §6, CQRS & Event-Driven]` (a command is a named intention carrying exactly what the write needs) and `[Rubric §2, Design Patterns]`. The record declares no members beyond `CachePrefix`; everything else it does is expressed by which interfaces it lists (`ChangePasswordCommand.cs:15`).
  - `ICommandWithRequest<ChangePasswordRequest>` opts the command into **automatic validation**: the framework registers a `CommandRequestValidator<TCommand, TRequest>` that delegates to the registered `IValidator<ChangePasswordRequest>` through FluentValidation's `SetValidator`, with `TryAdd` semantics so an explicit command-level validator still wins (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:6-10`).
  - `ICacheInvalidating` gives the caching decorator a prefix to evict, `$"{typeof(User).FullName}:"` (`ChangePasswordCommand.cs:18`). Deriving it from the type rather than from a string literal keeps it in lockstep with the key the user cache actually uses: rename or move [`User`](#user) and the prefix follows.
  - `IUserScopedCommand<ChangePasswordRequest>` is the view the shared handler base reads the command through, and it changes no pipeline behavior on its own. Its doc comment records why the two are separate rather than merged: the automatic-validation opt-in is a per-application decision, and ADC and Store agree on it for password change but disagree for preferences (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:6-10`).
- **Walkthrough**: a two-parameter positional record `(UserIdentifierType UserId, ChangePasswordRequest Request)` (`ChangePasswordCommand.cs:14`) plus the single computed `CachePrefix` property (`:18`). `UserId` comes from the authenticated principal, `Request` from the body.
- **Why it's built this way**: splitting "who" (the token) from "what" (the body) makes it structurally impossible for a request to target another account, and the shared handler base stays generic in `TCommand` precisely so each application can keep its own marker set on the record while sharing one workflow.
- **Where it's used**: constructed by [`AuthController`](#authcontroller)'s `CreateChangePasswordCommand` override (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:82-84`) and handled by [`ChangePasswordHandler`](#changepasswordhandler).

### ChangePreferencesCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14` · Level 8 · record (sealed)

- **What it is**: the command that persists one user's culture and theme preferences, the write side of [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). It pairs the target `UserId` with the partial [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) and evicts the user cache so a preference change cannot be masked by a stale cached read.
- **Depends on**: [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest); the `UserIdentifierType` alias; [`User`](#user) (for `typeof(User).FullName`); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and [`IUserScopedCommand<out TRequest>`](group-14-module-system-composition.md#iuserscopedcommandout-trequest).
- **Concept reinforced, marker-driven pipeline behavior** (introduced at [`ChangePasswordCommand`](#changepasswordcommand)). `[Rubric §12, Performance & Scalability]` assesses caching with correct invalidation. The instructive difference is what this record does **not** implement: there is no `ICommandWithRequest<ChangePreferencesRequest>` on the declaration (`ChangePreferencesCommand.cs:15`), so no `CommandRequestValidator` is auto-registered and the payload is not run through FluentValidation at the edge. That is safe here only because the two values are checked by the aggregate itself: `User.UpdatePreferences` combines the [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) allowlist and the light/dark rule through [`UserInvariants`](#userinvariants), and the shared handler base propagates that invariant failure as the command's failure.
- **Walkthrough**: a two-parameter positional record `(UserIdentifierType UserId, ChangePreferencesRequest Request)` (`ChangePreferencesCommand.cs:14`) plus the computed `CachePrefix` (`:18`), identical in shape to [`ChangePasswordCommand`](#changepasswordcommand).
- **Why it's built this way**: the command record deliberately stays application-side rather than moving into the framework alongside its handler, because ADC marks it `ICacheInvalidating` with a prefix built from its own `User` type and Store does not, so a single shared record could not preserve both behaviors (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:16-20`). Expressing eviction as an interface the command implements keeps cache management a decorator concern instead of handler boilerplate.
- **Where it's used**: constructed by [`AuthController`](#authcontroller)'s `CreateChangePreferencesCommand` override (`AuthController.cs:87-89`) for the profile page and the app-bar culture and theme switchers; handled by [`ChangePreferencesHandler`](#changepreferenceshandler).

### DeleteUserCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:11` · Level 8 · record (sealed)

- **What it is**: the command that soft-deletes and erases a user account (UC-21). It carries the account being deleted **and** the authenticated caller, because deletion is one of the few operations where the caller may legitimately not be the subject.
- **Depends on**: the `UserIdentifierType` alias; [`User`](#user) (for `typeof(User).FullName`); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest).
- **Concept introduced, the owner-or-privileged-role request shape.** `[Rubric §11, Security]` assesses whether authorization decisions are made from data the caller cannot forge, and `[Rubric §1, SOLID]` covers why this is an interface rather than a naming convention. [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest) adds `CurrentUserId` and a nullable `CurrentUserRole` on top of the user-scoped `UserId` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8-14`), which is exactly the triple the shared `UserOwnershipRule` needs to answer "may this caller act on that account". Both extra values are filled from the token by the controller, never from the body, so a client cannot claim a role it was not issued. Only two ADC use cases wear this shape, deletion and data export, and they are precisely the two that must let an Organizer act on someone else's row.
- **Walkthrough**: a three-parameter positional record, `UserId`, `CurrentUserId`, `CurrentUserRole` (`DeleteUserCommand.cs:11-14`), plus the computed `CachePrefix => $"{typeof(User).FullName}:"` (`:17`). `CurrentUserRole` is `string?` because a token may carry no role claim at all, and the null case must resolve to "no privilege" rather than to an exception.
- **Why it's built this way**: modelling the caller as part of the command, rather than reaching for an ambient `HttpContext` inside the handler, is what keeps the handler testable without a web host and keeps the Application layer free of ASP.NET types (`[Rubric §3, Clean Architecture]`, `[Rubric §14, Testability]`).
- **Where it's used**: constructed by [`UsersController`](#userscontroller)'s `DeleteAsync` from `currentUserService.UserId` and `currentUserService.Role` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:182-184`); handled by [`DeleteUserHandler`](#deleteuserhandler).

### ModuleApplicationDbContext
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15` · Level 8 · class (abstract)

- **What it is**: the Identity module's abstract EF Core context. It declares the module's one entity set, `Users`, and inherits everything else from the framework [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Depends on**: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource), EF Core's `DbContextOptions`, `IServiceProvider`, and [`User`](#user).
- **Concept reinforced, one context class per engine, never one per module.** `[Rubric §8, Data Architecture]` assesses how ownership of tables is expressed. The name can mislead on first reading: this type is not what gets instantiated. It is an **abstract** declaration of what Identity contributes to a context, and the concrete per-engine class ([`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) in production today) inherits it and supplies the provider options ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Every other module declares a same-named abstract class in its own namespace, and the doc comment (`ModuleApplicationDbContext.cs:9-14`) states the division of labour plainly: the base handles audit fields, soft deletes, and domain-event dispatch through EF interceptors, so a module context is a declaration of entity sets and nothing more.
- **Walkthrough**: a primary constructor forwarding all four parameters straight to the base (`ModuleApplicationDbContext.cs:15-20`), then the single member `internal DbSet<User> Users { get; set; }` (`:22`). Note the accessibility: `internal`, not `public`. Application code reaches users through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the repositories, so nothing outside the Infrastructure assembly has a reason to touch the set directly. The mapping is not here either: it is discovered from the assembly named by [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and supplied by [`UserConfiguration`](#userconfiguration).
- **Why it's built this way**: keeping the module's contribution abstract is what lets the same entity declarations be hosted by a SQL Server context in production and, with no code change, by a different engine's context. It is also what makes the "never split the context per module" rule enforceable: modules add abstract declarations, they never introduce a second concrete context class ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: inherited by the concrete engine context the framework's physical context factory builds for the `ADC_Identity` database; that database also carries its own `dbo.OutboxMessages` table, so Identity's outbox never contends with another service's.

### SpeakerLinkedToUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20` · Level 8 · class (sealed, partial)

- **What it is**: the Identity-side subscriber for Conference's [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) integration event. It sets `User.LinkedSpeakerId`, the Identity half of the bidirectional User-to-Speaker link (BR-209).
- **Depends on**: [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent) (implemented); [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) from `MMCA.ADC.Conference.Shared`; [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype); [`User`](#user); `IServiceScopeFactory` and `ILogger` with the `[LoggerMessage]` source generator.
- **Concept introduced, the integration-event handler that owns its own scope.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]`. Two structural facts separate this from a domain-event handler.
  First, it injects `IServiceScopeFactory` rather than [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and opens `scopeFactory.CreateAsyncScope()` per message (`SpeakerLinkedToUserHandler.cs:31-32`). An integration event arrives on a broker consumer thread, outside any HTTP request scope, so the handler has to create the scope that scoped services live in.
  Second, this is a **cross-service** subscription: the event type comes from Conference's `Shared` assembly, travels through Conference's outbox and the MassTransit broker, and lands here ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). The class doc comment (`:13-18`) records what it replaced, a direct call from Conference into an Identity service interface. Inverting that into an event is what allowed the two modules to become separate processes with separate databases, and it is why the comment can state that this handler is the only place `User.LinkedSpeakerId` changes in response to a Conference-side change.
- **Walkthrough** (primary constructor `:20-22`, `HandleAsync` `:25-58`)
  1. **Null guard** (`:27`), `ArgumentNullException.ThrowIfNull(integrationEvent)`.
  2. **Scope and repository** (`:31-33`), an async scope, then `IUnitOfWork` resolved from it, then `GetRepository<User, UserIdentifierType>()` (the mutating repository, because this path writes).
  3. **Load** (`:35`), `GetByIdAsync(integrationEvent.UserId, ...)`. A missing user logs a **warning** and returns (`:36-40`) rather than throwing: retrying cannot conjure an account that no longer exists.
  4. **Idempotency check** (`:43-46`), when `LinkedSpeakerId` already equals the event's `SpeakerId`, return without writing. The comment says why this matters: delivery is at-least-once, so a redelivery must be a no-op rather than a second write.
  5. **Apply and persist** (`:48-49`), `user.LinkSpeaker(...)` then `SaveChangesAsync`, followed by an information-level log (`:51`).
  6. **Failure policy** (`:53-57`, `:76-80`), the `catch (Exception ex) when (LogAndRethrow(...))` idiom. `LogAndRethrow` logs at error level and always returns `false`, so the filter never matches, the exception keeps propagating with its original stack, and the `throw;` inside the block is unreachable by construction. `[Rubric §29, Resilience & Business Continuity]`: the `<remarks>` (`:63-75`) records the failure this design corrects. The handler used to swallow every exception, so one transient database fault lost the BR-209 back-link permanently (the delivery was already acknowledged, so nothing retried), leaving Conference believing the speaker was linked while Identity held a null and only a log line existed to show for it. Letting the exception through hands the decision to the delivery mechanism instead: the consumer wrapper leaves the inbox row unprocessed, MassTransit redelivers, and a message that keeps failing moves to the error queue where an operator can see it.
- **Why it's built this way**: log-and-rethrow through an exception filter, rather than a `catch` / log / `throw` block, preserves the original stack trace exactly. Retrying is only safe because step 4 exists: the handler re-reads the user and writes nothing when the link already points at the same speaker, so at-least-once delivery converges on one state.
- **Where it's used**: auto-registered by the Application-layer Scrutor scan and driven by the broker consumer for `SpeakerLinkedToUser`; the full outbox to broker to consumer round trip is exercised by the cross-service Testcontainers test tier.

### SpeakerUnlinkedFromUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:20` · Level 8 · class (sealed, partial)

- **What it is**: the mirror of [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler). It subscribes to Conference's [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) and clears `User.LinkedSpeakerId`, but only when the link still points at the speaker the event names.
- **Depends on**: the same set as its sibling: [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`User`](#user), `IServiceScopeFactory`, and `[LoggerMessage]` logging.
- **Concept introduced, guarding against out-of-order delivery.** `[Rubric §29, Resilience & Business Continuity]` and `[Rubric §8, Data Architecture]`. The scope, idempotency, and log-and-rethrow mechanics are the ones taught at [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler); what is genuinely new here is a third guard. Linked and Unlinked arrive on **separate queues with no ordering guarantee**, so an Unlinked event for a previous speaker can land after the user has already been re-pointed at a new one. Clearing the column on that message would silently drop a link that is still valid. The handler therefore compares before clearing (`SpeakerUnlinkedFromUserHandler.cs:48-55`) and, on a mismatch, logs a warning naming both speaker ids and leaves the link in place. That is the general lesson for any compensating message: an event that undoes something must verify it is undoing the thing it was written for.
- **Walkthrough** (`HandleAsync` `:25-67`): null guard (`:27`); async scope, unit of work, mutating repository (`:31-33`); load, with a warning-and-return on a missing user (`:35-40`); the **already-cleared** short circuit when `LinkedSpeakerId` has no value, which is the idempotent-redelivery case (`:42-46`); the **stale-event** guard above (`:48-55`); then `user.UnlinkSpeaker()` plus `SaveChangesAsync` and an information log (`:57-60`). Failure handling is the identical `catch ... when (LogAndRethrow(...))` filter (`:62-66`, `:85-89`) carrying the same `<remarks>` rationale (`:72-84`).
- **Why it's built this way**: three separate early returns (not found, already cleared, different speaker) each map to a distinct real situation and each gets its own message and log level, so an operator reading the log can tell "nothing to do" apart from "something is off". Only the last is a warning about suspicious ordering; the first two are routine.
- **Where it's used**: auto-registered by the Application-layer Scrutor scan; triggered by Conference's unlink command and by the cascade cleanup that runs when a Speaker is soft-deleted (BR-70).

### UserConfiguration
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12` · Level 8 · class (internal, sealed)

- **What it is**: the EF Core mapping for the [`User`](#user) aggregate: column types and widths, the value-object conversion for `Email`, the ignored computed properties, and four indexes.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base), [`EmailValueConverter`](group-07-persistence-ef-core.md#emailvalueconverter), [`User`](#user) and [`UserInvariants`](#userinvariants), and EF Core's `EntityTypeBuilder<T>`.
- **Concept introduced, the engine-typed configuration base and the shared length constants.** `[Rubric §8, Data Architecture]` assesses whether the schema is declared explicitly rather than inferred, and `[Rubric §16, Maintainability]` covers why the numbers are not literals. Two things are worth internalizing.
  First, the base class is what routes this entity to a physical data source: deriving from `EntityTypeConfigurationSQLServer<User, UserIdentifierType>` (`UserConfiguration.cs:13`) declares the engine, and the database name resolves from the module, which is how `User` lands in `ADC_Identity` rather than in a shared database. `base.Configure(builder)` (`:18`) must run first, because it applies the framework conventions (key, audit columns, the soft-delete global query filter) that this method then refines.
  Second, every length that also matters to the domain is read from [`UserInvariants`](#userinvariants) rather than typed twice: `EmailMaxLength` (`:22`), `FirstNameMaxLength` (`:27`), `LastNameMaxLength` (`:32`), and `DeviceFieldMaxLength` on all seven device columns (`:61`, `:65`, `:69`, `:73`, `:77`, `:81`, `:85`). That is the mechanism that stops a 101-character name from passing the domain check and then being truncated by the database.
- **Walkthrough**
  - `Email` (`:20-24`): `HasConversion(new EmailValueConverter())` maps the [`Email`](group-02-domain-building-blocks.md#email) value object onto a plain column, then `IsUnicode(false)` and `IsRequired()`. `IsUnicode(false)` recurs on nearly every string here: these become `varchar`, not `nvarchar`, halving the storage for values that are ASCII by definition (emails, role names, culture codes, URLs, tokens).
  - Credentials (`:36-41`): `PasswordHash` and `PasswordSalt` are configured with no options at all, deliberately. The comment states that EF maps `byte[]` to `varbinary(max)` by default so no explicit length is needed (BR-204), and that external-login accounts hold empty arrays.
  - Fixed-width strings: `Role` at 50 (`:43-46`), `RefreshToken` at 256 (`:49-51`), `LoginProvider` at 50 and `ProviderKey` at 256 (`:89-95`), `PreferredCulture` and `PreferredTheme` at 10 each (`:98-104`), `AvatarUrl` at 512 (`:107-109`).
  - `LinkedSpeakerId` (`:57`): configured as a plain scalar property with no relationship at all. That is the visible consequence of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): Speaker lives in another database, so there is no foreign key to declare.
  - Ignored members (`:112-113`): `FullName` and `IsExternalLogin` are computed on the aggregate, so `builder.Ignore` keeps EF from expecting columns for them.
  - Indexes (`:115-126`): a unique index on `Email`, which is the BR-200 "email is the identity" rule enforced at the storage layer; a **filtered** index on `RefreshToken` with `HasFilter("[RefreshToken] IS NOT NULL")`, indexing only the rows that have an outstanding session; a unique filtered index on `LinkedSpeakerId`, which makes the User-to-Speaker link 1:1 while still allowing the many users who have no linked speaker; and a unique filtered composite on `(LoginProvider, ProviderKey)`, so one external identity cannot be attached to two accounts.
- **Why it's built this way**: `[Rubric §12, Performance & Scalability]`: the three filtered indexes are all sparse-column cases where the vast majority of rows are null, so filtering keeps each index small and keeps writes to the common rows out of it entirely. `[Rubric §11, Security]`: the unique constraints on email and on the provider pair are the last line of defence behind the application-level uniqueness probes, so a race between two concurrent registrations fails at the database rather than producing two accounts.
- **Where it's used**: discovered by assembly scan through [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and applied when the concrete engine context builds the model declared by [`ModuleApplicationDbContext`](#moduleapplicationdbcontext); the resulting schema is materialized by the per-service Identity migrations project.

### UserDTOMapper
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.DTOs` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:14` · Level 8 · class (sealed, partial)

- **What it is**: the compile-time mapper from the [`User`](#user) aggregate to [`UserDTO`](#userdto), for the single and the collection case.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (implemented), [`User`](#user), [`UserDTO`](#userdto), the [`Email`](group-02-domain-building-blocks.md#email) value object, and Mapperly (`Riok.Mapperly.Abstractions`).
- **Concept introduced, source-generated mapping with a hand-written converter hook.** `[Rubric §9, API & Contract Design]` assesses whether the wire shape is decided deliberately, and `[Rubric §15, Best Practices & Code Quality]` covers the generator choice. `[Mapper]` on a `partial` class (`UserDTOMapper.cs:13-14`) tells Mapperly to generate the body of every `partial` method declaration at build time ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). There is no reflection and no runtime configuration: the generated assignment list is ordinary C# you can step through, and a property that cannot be mapped is a build diagnostic rather than a silent null at runtime.
  The value-object problem is solved by convention rather than by attribute. `User.Email` is an [`Email`](group-02-domain-building-blocks.md#email) while `UserDTO.Email` is a `string`, and Mapperly resolves that by finding a method in the class whose signature converts one to the other: the private `static string EmailToString(Email email) => email.Value` (`:28`). Adding that method is the entire configuration.
- **Walkthrough**
  - `MapToDTO(User entity)` (`:18`): declared `partial` with no body; the generator emits the property-by-property assignment.
  - `MapToDTOs(IReadOnlyCollection<User>)` (`:21-25`): hand-written, not generated. It null-guards with `ArgumentNullException.ThrowIfNull` and returns `[.. entityCollection.Select(MapToDTO)]`, a collection expression over the generated single-item map, so there is exactly one mapping definition to keep correct.
  - `EmailToString` (`:28`): the converter hook described above.
- **Why it's built this way**: `[Rubric §30, Compliance, Privacy & Data Governance]`. The doc comment (`:9-12`) states the real purpose of the type: it excludes `PasswordHash`, `PasswordSalt`, and `RefreshToken` from the projection. That exclusion is not enforced by an attribute, it follows from [`UserDTO`](#userdto) simply not declaring those members (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8-24` declares exactly `Id`, `Email`, `FirstName`, `LastName`, `Role`). The DTO is the allowlist, and because Mapperly maps by name at compile time, adding a sensitive property to the aggregate cannot leak it: someone would have to add it to the DTO on purpose.
- **Where it's used**: registered as `IEntityDTOMapper<User, UserDTO, UserIdentifierType>` by the Application-layer Scrutor scan and resolved wherever the module returns a full user representation. Note that the organizer list endpoint does **not** go through it: [`GetUsersHandler`](#getusershandler) projects straight to [`UserListDTO`](#userlistdto) in the database, so the sensitive columns are never read at all.

### AttendeeQueryServiceGrpcAdapter
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14` · Level 9 · class (sealed)

- **What it is**: the gRPC-backed implementation of [`IAttendeeQueryService`](#iattendeequeryservice). It answers "which user ids hold the Attendee role" by calling the extracted Identity service instead of reading the local database.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (implemented, from `MMCA.ADC.Identity.Shared`), the generated `AttendeeQueryService.AttendeeQueryServiceClient` and `GetAttendeeUserIdsRequest` types compiled from the `.proto` in this project, and the `UserIdentifierType` alias.
- **Concept introduced, the adapter that makes extraction invisible to callers.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own process without rewriting the code that consumes it. This class is the concrete payoff of the interface indirection set up in the `Shared` layer. Notification depends on the C# interface; in the monolith that interface resolves to Identity's in-process [`AttendeeQueryService`](#attendeequeryservice), and in the extracted topology the composition root swaps in this adapter. The consuming code does not change, does not learn about gRPC, and never holds a generated proto type. The class doc comment (`AttendeeQueryServiceGrpcAdapter.cs:6-13`) says exactly that, and it is why the project is named `.Contracts` and holds both the `.proto` and the hand-written adapter ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Walkthrough**
  - Primary constructor (`:14-15`): takes the generated typed client and nothing else.
  - `CallDeadline = TimeSpan.FromSeconds(5)` (`:20`): a per-call deadline, and the comment (`:17-19`) explains why it is far tighter than the shared resilience pipeline's 30s attempt and 90s total budget. The failure being defended against is a **hung** peer, not a refused one: a refused call fails immediately, but a hung one would stall the broadcast-notification request that triggered this lookup for the full pipeline budget. Transport failures propagate to the caller by design rather than degrading into an empty audience.
  - `GetAttendeeUserIdsAsync` (`:23-34`): one call, passing `deadline: DateTime.UtcNow.Add(CallDeadline)` alongside the cancellation token (`:26-29`), then `return [.. response.UserIds]` (`:33`). The collection expression materializes protobuf's `RepeatedField` into a plain `IReadOnlyList`, which the comment (`:31-32`) notes is deliberate so callers do not leak the generated type; because `UserIdentifierType` is `int`, the projection is a no-op cast.
- **Why it's built this way**: `[Rubric §29, Resilience & Business Continuity]`. Choosing a deadline shorter than the retry budget is the difference between "this dependency is slow" and "this request never returns". Letting transport failures surface rather than swallowing them means a broadcast that could not determine its audience fails visibly instead of quietly notifying nobody.
- **Where it's used**: registered by [`DependencyInjection`](#dependencyinjection)'s `AddIdentityAttendeeClient` in this same project, which the Notification service host calls after module registration (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:199-202`).

### ChangePasswordHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: ADC's change-password handler. The class body is empty: the whole workflow lives in the framework base [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand), and this type exists to bind the generic parameters and to keep the name.
- **Depends on**: [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), `ILogger<T>`, [`User`](#user), and [`ChangePasswordCommand`](#changepasswordcommand).
- **Concept introduced, the name-preserving thin subclass.** `[Rubric §16, Maintainability]` assesses de-duplication across applications, and `[Rubric §9, API & Contract Design]` covers why the class name survives the move. ADC and Store carried line-identical copies of this handler, so the workflow was hoisted into `MMCA.Common` (`ChangePasswordHandlerBase.cs:11-15`). What could not be hoisted is the **error payload**: every failure the framework returns carries a `source`, the base defaults it to `GetType().Name` through a virtual `HandlerName` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:39`), and clients match on the string `ChangePasswordHandler`. Keeping an empty subclass under the original name makes the hoist invisible on the wire, and the `<remarks>` says so outright (`ChangePasswordHandler.cs:12-16`). It is a small pattern with a large consequence: a refactor that would otherwise be a breaking API change becomes a no-op for consumers. The same shape recurs at [`ChangePreferencesHandler`](#changepreferenceshandler) and [`GetUserPreferencesHandler`](#getuserpreferenceshandler).
- **Walkthrough**: a primary constructor taking [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), and `ILogger<ChangePasswordHandler>` and forwarding all three to the base (`ChangePasswordHandler.cs:17-21`), with an empty body (`:22-23`). The inherited workflow (`ChangePasswordHandlerBase.cs:42-70`) is: load the user through the mutating repository and return `Error.NotFound` when absent (`:48-53`); verify the supplied current password with `passwordHasher.VerifyPassword(command.Request.CurrentPassword, user.PasswordHash, user.PasswordSalt)` and return `Error.Unauthorized("Auth.InvalidCurrentPassword", ...)` on a mismatch (`:55-59`); hash the new password into a fresh hash and salt pair (`:61`); call `user.ChangePassword(newHash, newSalt)` and, only when that succeeds, save and log (`:62-67`); return the aggregate's [`Result`](group-01-result-error-handling.md#result) unchanged (`:69`).
- **Why it's built this way**: `[Rubric §11, Security]`. Note the division of responsibility the base encodes. Proving knowledge of the current password is a cryptographic operation, so it happens where the stored hash and salt are in hand, not in a request validator (a validator can only check that a value is present). The domain then applies its own invariants on the new credential material, and nothing is persisted unless both gates pass. The generic constraint `where TUser : ..., IPasswordChangeableUser` (`ChangePasswordHandlerBase.cs:28`) is what lets the base call `ChangePassword` on an application's aggregate without knowing the concrete type, and the hashing scheme itself is [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html).
- **Where it's used**: resolved as `ICommandHandler<ChangePasswordCommand, Result>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:32`), which exposes it as `PUT /Auth/password`; the [`Profile`](#profile) page is the client.

### ChangePreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: ADC's change-preferences handler, another empty subclass. The workflow lives in [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand).
- **Depends on**: [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger<T>`, [`User`](#user), and [`ChangePreferencesCommand`](#changepreferencescommand).
- **Concept reinforced, the name-preserving thin subclass** (introduced at [`ChangePasswordHandler`](#changepasswordhandler)); the `<remarks>` (`ChangePreferencesHandler.cs:12-16`) carries the same rationale. The behavior worth learning here is the **null-coalescing merge** inside the base. `[Rubric §27, Internationalization]` assesses whether a locale choice survives a session, and `[Rubric §24, Forms, Validation & UX Safety]` covers partial updates. The merge is one expression (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53-55`): `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)`. A request carrying only a culture re-supplies the stored theme, and the reverse, which is precisely why the app-bar language switcher cannot wipe the user's dark-mode choice.
- **Walkthrough**: a primary constructor forwarding [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `ILogger<ChangePreferencesHandler>` to the base (`ChangePreferencesHandler.cs:17-20`), empty body. The inherited workflow (`ChangePreferencesHandlerBase.cs:40-63`): load through the mutating repository with `Error.NotFound` when absent (`:46-51`); the merge above; then, **only** when the returned [`Result`](group-01-result-error-handling.md#result) is a success, `SaveChangesAsync` plus the shared `UserUseCaseLog.PreferencesChanged` log (`:56-60`); return the result unchanged (`:62`). Validation is not the handler's job: `User.UpdatePreferences` combines the culture allowlist and the light/dark rule and hands back a failure the handler simply propagates.
- **Why it's built this way**: guarding both the save and the log behind `IsSuccess` means a rejected culture or theme produces a clean failure (a 400 at the edge) with no write and, just as importantly, no misleading "preferences changed" log line for an operator to chase later.
- **Where it's used**: resolved as `ICommandHandler<ChangePreferencesCommand, Result>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:33`) as `PUT /Auth/preferences`; wrapped by the decorator pipeline, whose caching decorator performs the eviction declared on [`ChangePreferencesCommand`](#changepreferencescommand).
- **Caveats / not-in-source**: `UpdatePreferences` raises no domain event, so a preference change writes the row and publishes nothing to the outbox.

### DeleteUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:25` · Level 9 · class (sealed, partial)

- **What it is**: ADC's account-deletion handler (UC-21). Unlike the two siblings above it is not empty: it inherits the shared erasure workflow from [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) and supplies the two genuinely ADC-specific pieces, the privileged role and the post-erasure tail.
- **Depends on**: [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), [`ICacheService`](group-09-caching.md#icacheservice), [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache), [`UserRole`](#userrole), [`SetUserAvatarHandler`](#setuseravatarhandler) (for its `TryGetBlobName` helper), [`Result`](group-01-result-error-handling.md#result), and `[LoggerMessage]` logging.
- **Concept introduced (1), erasure as a fixed workflow with application-specific hooks.** `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether a deletion request actually destroys personal data. The base (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:55-119`) runs a fixed order: check ownership through `UserOwnershipRule.CheckOwnership` using the application's `HasDeletePrivilege` answer (`:62-71`); load the user, `Error.NotFound` when absent (`:73-78`); soft-delete; run the application's tail; anonymize; save; then run whatever post-commit actions the tail enqueued (`:109-114`). The two-step delete-then-anonymize is [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)'s resolution of a real tension: the row must survive because other bounded contexts hold scalar `UserId` references and the audit trail depends on it, but the personal data must not survive, because PRIVACY.md §5 promises erasure. One detail in the base rewards a second read (`:83-89`): it dispatches through `IErasableUser erasable = user;` rather than calling `user.Delete()` directly, because member lookup on a type parameter prefers its class constraint, and ADC's [`User`](#user) **hides** the base `Delete()` with `public new Result Delete()`. Interface dispatch is what guarantees the aggregate's own version (the one that revokes the refresh token first) actually runs.
- **Concept introduced (2), the post-commit action list.** `[Rubric §29, Resilience & Business Continuity]`. The hook signature takes an `ICollection<Func<CancellationToken, Task>> afterCommit` (`DeleteUserHandler.cs:42-46`). Work that must not happen if the save fails is **enqueued** rather than run inline, which lets the override hand values it captured before anonymization into a post-commit closure without parking them in mutable handler state.
- **Walkthrough**
  - `_logger` field (`:34`): the logger is held explicitly rather than captured from the primary constructor, and the comment says why: the base also receives `logger`, and capturing the same parameter into this type's state would be the compiler error CS9107.
  - `HasDeletePrivilege` (`:38-39`): `UserRole.IsOrganizer(currentUserRole)`, with a `<remarks>` noting it is case-insensitive because a role claim may carry any casing. Store's equivalent answers with its Admin role; that one line is the entire difference in the authorization model between the two applications.
  - `OnAfterSoftDeleteAsync` (`:42-76`): it first captures the avatar blob name **before** anonymization clears the URL (`:50`), reusing `SetUserAvatarHandler.TryGetBlobName` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:89-90`). That ordering is the whole reason the hook runs where it does. It then enqueues two post-commit actions in the order the pre-hoist handler ran them (`:52`): writing the shared soft-deleted marker through `SoftDeletedUserCache.MarkDeletedAsync` (`:56-68`), then deleting the avatar blob when there was one (`:70-73`). It returns `Result.Success()` (`:75`); returning a failure here would abort the erasure before anything is persisted.
  - Marker failure policy (`:64-67`, `:78-81`): the cache write is wrapped in its own try/catch that swallows everything except `OperationCanceledException` and logs a warning whose message spells out the consequence, that the deleted user's existing access token stays usable until it expires. The comment (`:53-55`) states the reasoning: the deletion is already committed by the time this runs, the marker only shortens the window in which an already-issued token keeps working, and a cache fault must not turn a successful erasure into a failure the caller would retry.
- **Why it's built this way**: `[Rubric §11, Security]`. Access tokens are self-contained and valid until they expire, so deleting an account does not by itself stop a token already in the wild; the marker is what lets the shared [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) reject those requests. Treating it as best-effort is the correct trade: erasure is the promise that must hold, and the token window is bounded anyway. `[Rubric §30]`: the avatar photo is personal data too (BR-116a), so the blob is deleted rather than merely unreferenced.
- **Where it's used**: resolved as `ICommandHandler<DeleteUserCommand, Result>` and invoked by [`UsersController`](#userscontroller)'s `DeleteAsync` (`UsersController.cs:182-184`), which returns 204 on success; the callers are the [`Profile`](#profile) page's self-service deletion and the organizer [`UserList`](#userlist).
- **Caveats / not-in-source**: the post-commit actions run sequentially inside the calling request (`DeleteUserHandlerBase.cs:111-114`), so a slow blob delete adds latency to the response; there is no background dispatch here.

### GetUserPreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13` · Level 9 · class (sealed)

- **What it is**: the read side of user preferences: given a user id, return the stored culture and theme. Another empty subclass, this one over [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser).
- **Depends on**: [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), and [`User`](#user). Note what is absent: no `ILogger`. A query that only reads has nothing to announce.
- **Concept reinforced, the thin CQRS read handler** (the subclass shape is taught at [`ChangePasswordHandler`](#changepasswordhandler); the query pipeline at [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)). `[Rubric §6, CQRS & Event-Driven]`: the base implements `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21-23`), so it runs through the query decorator chain (FeatureGate, Logging, Caching) with no Validating and no Transactional decorator, because a read opens no transaction. Both [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery) and [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse) were byte-identical in the two applications and were hoisted whole, which is why this base is generic in the aggregate only. `[Rubric §27, Internationalization]`: this is the server end of "remember my language", reading `User.PreferredCulture` straight off the aggregate.
- **Walkthrough**: a primary constructor taking [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwarding it (`GetUserPreferencesHandler.cs:13-14`), empty body. The inherited `HandleAsync` (`GetUserPreferencesHandlerBase.cs:33-45`) resolves `unitOfWork.GetReadRepository<TUser, UserIdentifierType>()` (`:39`), calls `GetByIdAsync(query.UserId, ...)` (`:40`), and returns either `Error.NotFound` tagged with `HandlerName` and the aggregate's type name or `Result.Success(new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme))` (`:41-44`).
- **Why it's built this way**: the base's `<remarks>` (`GetUserPreferencesHandlerBase.cs:15-19`) records that the two application copies disagreed on the repository (ADC read, Store write) and that the read repository is the correct choice for a handler which never calls `SaveChangesAsync`, so Store gained a no-tracking read on adoption. That is the ordinary payoff of consolidating duplicated code: the merge forces a decision, and the better of the two behaviors wins for everyone.
- **Where it's used**: resolved as `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:34`) as `GET /Auth/preferences`; the response seeds the client's culture and theme at startup.

### DependencyInjection
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14` · Level 10 · class (static)

- **What it is**: the one registration helper the `.Contracts` project exposes. `AddIdentityAttendeeClient(serviceName)` wires a typed gRPC client for the extracted Identity service and swaps [`IAttendeeQueryService`](#iattendeequeryservice) over to [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).
- **Depends on**: `IServiceCollection` and `ServiceCollectionDescriptorExtensions.Replace`; the generated `AttendeeQueryService.AttendeeQueryServiceClient`; [`IAttendeeQueryService`](#iattendeequeryservice) and [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter); `AddTypedGrpcClient<TClient>` from `MMCA.Common.Grpc`.
- **Concept introduced, `Replace` instead of `TryAdd`, and why the call site's position is load-bearing.** `[Rubric §7, Microservices Readiness]` and `[Rubric §3, Clean Architecture]`. Everywhere else in this codebase module registration uses `TryAdd`, so a host can pre-empt a default. Here the semantics are inverted deliberately, and the doc comment (`DependencyInjection.cs:24-32`) gives the reason: by the time a consuming host calls this, the container already holds **one of two** registrations for [`IAttendeeQueryService`](#iattendeequeryservice). If the Identity module is enabled it holds the real in-process [`AttendeeQueryService`](#attendeequeryservice); if Identity is disabled it holds the [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) stub that [`IdentityModule`](#identitymodule)'s `RegisterDisabledStubs` put there so DI validation would still succeed. `Replace` overwrites either one, so after this call the resolved service is the gRPC adapter regardless of which path the host took; `TryAdd` would silently do nothing in both cases.
  The consequence is an ordering rule, stated in the same comment (`:33-37`): call this from the host's `Program.cs` **after** `ModuleLoader.DiscoverAndRegister(...)`, so the in-process or stub registration is in the container by the time `Replace` looks for it. Calling it earlier is not an error the compiler or the container reports; it simply leaves the wrong implementation in place.
- **Walkthrough**: the method lives inside an `extension(IServiceCollection services)` block (`:16`), the workspace idiom for DI registration (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `AddIdentityAttendeeClient(string serviceName = "identity")` (`:41`) does two things: `AddTypedGrpcClient<AttendeeQueryService.AttendeeQueryServiceClient>(serviceName)` (`:43`), which the framework wires to Aspire service discovery at `http://{serviceName}` over HTTP/2 cleartext with the standard JWT-forwarding interceptor and Polly resilience handler; and `services.Replace(ServiceDescriptor.Scoped<IAttendeeQueryService, AttendeeQueryServiceGrpcAdapter>())` (`:47`). It then returns `services` for chaining (`:49`). The `serviceName` default of `"identity"` matches the AppHost resource name, so the common case passes no argument.
- **Why it's built this way**: keeping this helper in the `.Contracts` project rather than in the consuming service means the knowledge of "how you talk to Identity remotely" lives once, next to the `.proto` that defines the call, and every future consumer gets it with a project reference plus one line ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). The `Scoped` lifetime matches the in-process implementation it replaces, so swapping transports changes no lifetime assumption anywhere in the graph.
- **Where it's used**: called by the Notification service host (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:202`), whose surrounding comment (`:199-201`) repeats the `Replace` rationale at the call site; the matching AppHost wiring is noted at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:214`.
- **Caveats / not-in-source**: this is the only public member of the class today, so the `.Contracts` project's DI surface is exactly this one call.


---
[⬅ ADC Engagement Live Layer (Real-Time Polls & Session Q&A)](group-23-engagement-live-layer.md)  •  [Index](00-index.md)  •  [ADC Application Host, UI Shell & Cross-Module Composition ➡](group-25-adc-host-composition.md)
