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
[`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache)) from G08, and the hoisted user
use-case bases from G14
([`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand),
[`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser),
[`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand),
[`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery))
alongside the [`IModule`](group-14-module-system-composition.md#imodule) composition system. The
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
**`MMCA.ADC.Identity.Domain`** holds the [`User`](#user) aggregate (`User.cs:33`), the
[`UserRole`](#userrole) value type (`UserRole.cs:17`), the [`UserInvariants`](#userinvariants) rule
class (`UserInvariants.cs:9`), and the [`UserDeleted`](#userdeleted) (`UserDeleted.cs:10`) /
[`UserPasswordChanged`](#userpasswordchanged) (`UserPasswordChanged.cs:9`) domain events; it depends
only on `MMCA.Common.Domain` and `MMCA.Common.Shared` and knows nothing of EF or ASP.NET.
**`MMCA.ADC.Identity.Application`** holds the use-case handlers, the Mapperly-generated
[`UserDTOMapper`](#userdtomapper)
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:13-14`,
[ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), the FluentValidation
validators, and the cross-module service implementations; its
[`DependencyInjection`](#dependencyinjection) registers four services explicitly, including the
shared [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser)
closed over `User` (`MMCA.ADC.Identity.Application/DependencyInjection.cs:33-36`), contributes the two
export sections in the order they appear in the exported document (`:42-43`), and leaves handlers,
mappers, validators, and domain-event handlers to `ScanModuleApplicationServices<ClassReference>()`
(`:47`). **`MMCA.ADC.Identity.Infrastructure`** holds the
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
[`UserRegistered`](#userregistered) and [`UserDeleted`](#userdeleted) integration events, and the
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

[`User`](#user) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:33`) is the
only aggregate root in the module, and it carries more responsibility than most: it is the credential
store (`PasswordHash` plus a per-user `PasswordSalt`, both `byte[]` mapped to `varbinary(max)`,
`User.cs:50`, `:53`), the refresh-token holder (`RefreshToken` / `RefreshTokenExpiry`, rotated by
`UpdateRefreshToken` at `User.cs:250` and cleared by `RevokeRefreshToken` at `:259`), the profile
(`Email`, `FirstName`, `LastName`, each marked
[`[Pii]`](group-02-domain-building-blocks.md#piiattribute), `User.cs:38`, `:42`, `:46`), the
preference store (`PreferredCulture` / `PreferredTheme`, `:100`, `:103`,
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) /
[ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), the avatar URL holder (`:112`,
also `[Pii]`, BR-116a,
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), the optional
MAUI device-metadata bag (`:73-91`), the external-OAuth link (`LoginProvider` / `ProviderKey`, `:94`,
`:97`), and the 1:1 cross-context `LinkedSpeakerId` pointing at a Conference speaker (`:70`, BR-207 /
BR-208 / BR-209). Every property has a private setter, so state changes only through the aggregate's
own methods: encapsulation as a compile-time guarantee ([Rubric §4, Domain-Driven Design], [Rubric §1,
SOLID]). Its interface list is what binds the aggregate to the shared G08 user workflows,
[`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser),
[`IUserPreferences`](group-08-auth.md#iuserpreferences), and
[`IErasableUser`](group-08-auth.md#ierasableuser) (`User.cs:33-34`); the third one is declared on
*this* type rather than inherited, and the class comment explains why it has to be (`:17-24`):
`Delete()` **hides** the base soft-delete with `new` (`:364`), so only re-listing the interface here
re-maps the workflow onto this type's own member and keeps the refresh-token revocation in the erasure
path. A fourth interface, `IAuditedEntity` (`:34`), is the one non-behavioral marker: it opts the
aggregate into a recorded change history, because an account record is where a support or compliance
question is actually asked (who changed this attendee's email, when was this account raised to
Organizer) and the plain audit fields answer only "who touched it last" (`:25-30`).

It follows the standard framework shape: a private EF constructor (`User.cs:120`), a private state
constructor (`:130`), and static factory methods returning
[`Result<T>`](group-01-result-error-handling.md#result). `Create` (`:163`) validates every invariant
with `Result.Combine(...)` *before* constructing anything (`:172-179`), so an invalid user is
unrepresentable; `CreateExternal` (`:205`) builds an OAuth account with empty credential arrays
(`:223`). A subtlety worth carrying forward: the factory deliberately does **not** raise a
registration event. The `Id` is database-generated (`[IdValueGenerated]` at `:32`, `Id` set to
`default` at `:187`), so the cross-module [`UserRegistered`](#userregistered) is raised by the
application layer only after the insert has executed and a real id exists (`:149-155` records exactly
that). The behavior methods each guard their own rule: `ChangePassword` re-validates and raises
[`UserPasswordChanged`](#userpasswordchanged) (`:318-335`); `UpdatePreferences` validates against the
supported-culture allowlist and the light/dark theme values (`:288-301`); `Delete()` revokes the
refresh token as a security measure, calls the G02 soft-delete, and raises
[`UserDeleted`](#userdeleted) (`:364-374`).

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
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:219-223`). Identity signs its tokens
with **RS256** and publishes the public key at `/.well-known/jwks.json`; peer services validate tokens
by fetching that document through the Gateway rather than sharing a secret (`Program.cs:32-36`,
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), [Rubric §11,
Security]). One `EmailExistsAsync` override deserves its own note, because the reason is the opposite
of the obvious one: it passes `ignoreQueryFilters: true` (`AuthenticationService.cs:85-86`) *not* to
keep an erased address reserved. Erasure always pairs `Delete` with `Anonymize`, which rewrites the
address to a placeholder, so a real erased email is re-registrable by design (GDPR). The filter bypass
exists so the two rows the unfiltered unique Email index would otherwise turn into a 500 (legacy rows
soft-deleted without anonymization, and the placeholder addresses themselves) come back as a clean
conflict instead (`:77-84`).

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
The three handlers on that path are all body-less subclasses of a G14 base whose only purpose is that
the `source` reported on every error stays the ADC class name, which clients match on:
[`ChangePasswordHandler`](#changepasswordhandler) (`ChangePasswordHandler.cs:12-23`,
[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)),
[`ChangePreferencesHandler`](#changepreferenceshandler), and
[`GetUserPreferencesHandler`](#getuserpreferenceshandler) (`GetUserPreferencesHandler.cs:8-16`).
[`OAuthController`](#oauthcontroller) (`OAuthController.cs:20`) is a body-less subclass of
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (G12) that drives the
Google/GitHub challenge, callback, complete, single-use-code-exchange flow, with the class-level
routing and versioning attributes re-declared locally because they are not reliably inherited
(`:14-19`); it is an ADC-only feature, since MMCA.Store uses local credentials only.
[`UserClaimsController`](#userclaimscontroller) (`UserClaimsController.cs:16`) reflects the
authenticated JWT's claims back to the client. [`UsersController`](#userscontroller)
(`UsersController.cs:31`) hosts the rest: the three avatar endpoints, the organizer user list, the
data export (`:149`), and the account delete (`:171`). Its list endpoint is gated by capability rather
than by role name, `[HasPermission(IdentityPermissions.UsersRead)]` (`:125`), and the
`identity:users:read` grant
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:11`) is handed to Organizer and Admin
in `AddModuleIdentityAPI` (`MMCA.ADC.Identity.API/DependencyInjection.cs:44-48`,
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)). That list
itself is served by [`GetUsersHandler`](#getusershandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:16`), which clamps the page
size at 500 through [`PagingMath`](group-03-querying-specifications.md#pagingmath) before touching the
database (`:28`, BR-11) and pushes filtering, `COUNT`, ordering, OFFSET/FETCH paging, and the
projection into SQL (`:34-57`), so the credential columns are never materialized ([Rubric §12,
Performance and Scalability]). Its sort carries an `Id` tie-break (`:93-95`) that makes the `ORDER BY`
total: without it, rows sharing a sort key can repeat or vanish across pages, because OFFSET/FETCH has
no stable row order to page over.

## The privacy pair: export and erasure

Two use cases make this module the codebase's clearest [Rubric §30, Compliance / Privacy / Data
Governance] story, and both are now thin ADC specializations of a G14 base. The erasure workflow lives
in [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand);
[`DeleteUserHandler`](#deleteuserhandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:28`) keeps the class
name so the reported error `source` stays stable for clients, and supplies the ADC-specific pieces
(`:18-27`). `HasDeletePrivilege` (`:42`) says the Organizer role bypasses the ownership rule,
delegating to `UserRole.IsOrganizer` so the claim's casing does not matter. `OnAfterSoftDeleteAsync`
(`:46`) does two things. It raises the cross-service [`UserDeleted`](#userdeleted) integration event on
the aggregate (`:62`), so the outbox row is written by the very `SaveChangesAsync` that commits the
erasure: Engagement holds a `DisplayName` snapshot on its leaderboard opt-in, lives in its own process
with its own database, and never sees Identity's in-process domain event, so the fact and its
announcement must not be able to come apart (`:56-61`). Its payload is deliberately just the user id
and a timestamp, because carrying a name or email would publish onto a persistent broker the very
personal data the erasure exists to remove
(`MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserDeleted.cs:16-20`). It then queues two
**after-commit** actions: writing the shared
[`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) marker so the API middleware rejects
requests still carrying an already-issued access token for the erased account (`:68-80`, BR-133,
[ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)), and
deleting the avatar blob (`:82-85`, BR-116a). Both are best-effort by construction: the deletion is
already committed when they run, so a cache fault is logged rather than turned into a failure the
caller would retry (`:64-67`, `:76-79`). Note the ordering detail at `:54`: the blob name is captured
*before* `Anonymize` clears the URL. The erasure itself lives in `User.Anonymize()` (`User.cs:387`),
which irreversibly overwrites the personal fields with placeholders **in place** rather than
hard-deleting the record. Keeping the row lets cross-context scalar references (bookmarks,
notifications) and the audit trail survive; the replacement email embeds the user id
(`deleted-{Id}@anonymized.invalid`, `:392`) so the unique-email invariant still holds across many
erased accounts, and the operation is idempotent (an already-anonymized user short-circuits at
`:399-402`). This is the anonymize-in-place model of
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), backed by the
[`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) marker, and it satisfies the
PRIVACY.md §5 "delete within 30 days" promise.

The data-subject *access* request (PRIVACY.md §7) is assembled the same way.
[`ExportUserDataHandler`](#exportuserdatahandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:30`) inherits
[`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery),
which owns the owner-or-privileged authorization, the account load, and the section fan-out; ADC
contributes exactly two things (`:10-14`): `HasExportPrivilege`, again `UserRole.IsOrganizer` (`:38`),
and `BuildSubjectSnapshotAsync` (`:41`), which projects the account's own portable fields into a
[`UserDataExportSubjectDTO`](#userdataexportsubjectdto) (`:48-74`). Credentials are **deliberately
excluded**: no password hash, no salt, no refresh token, no provider key
(`MMCA.ADC.Identity.Shared/Users/UserDataExportSubjectDTO.cs:3-7`). One small correctness detail sits
at `:67-73`: SQL Server hands audit timestamps back as `Kind=Unspecified`, so the handler re-stamps
them UTC, which is the only reason the exported JSON carries the `Z` marker the DTO documents. The
subject snapshot is the `Subject` of the shared envelope
[`UserDataExportDTO`](group-08-auth.md#userdataexportdto), and beside it travel one
[`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) per registered
[`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection). ADC registers
two, in document order (`MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`):
[`EngagementUserDataExportSection`](#engagementuserdataexportsection)
(`.../ExportUserData/EngagementUserDataExportSection.cs:19`) reads bookmarks, submitted session
questions, the points ledger, check-in history, and leaderboard participation through
[`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) (`:30-31`)
and shapes them into [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto)
(`:34-68`), turning enum values into their readable names because a data subject reads this document
(`:49-51`, `:58-60`); [`NotificationUserDataExportSection`](#notificationuserdataexportsection)
(`.../ExportUserData/NotificationUserDataExportSection.cs:18`) does the same for inbox rows through
[`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice) (`:29-31`).
Neither section catches transport failures (`:12-15` in both files): that is the point. The base wraps
every section, so a peer that stays unreachable after the standard Polly resilience pipeline degrades
to `Available = false` and the export still succeeds, which is [Rubric §29, Resilience] and [Rubric §7,
Microservices Readiness] applied to a compliance workflow.

## Avatars: the third mutating slice

The avatar trio is a small but complete example of a file-handling slice ([Rubric §11, Security] at the
content boundary,
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
[`UsersController`](#userscontroller) caps the multipart upload at 2 MB in two places, declaratively
via `[RequestSizeLimit(MaxAvatarBytes)]` and imperatively via an explicit length check that returns an
`Avatar.InvalidUpload` validation error (`UsersController.cs:41`, `:67`, `:78-84`, BR-116a).
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
maps the [`Email`](group-02-domain-building-blocks.md#email) value object through the shared
[`EmailValueConverter`](group-07-persistence-ef-core.md#emailvalueconverter) (`:20-24`), mirrors the
invariant length constants onto the columns, ignores the computed `FullName` and `IsExternalLogin`
members (`:112-113`), and pins four indexes that encode business rules as schema ([Rubric §8, Data
Architecture]): unique `Email` (`:115`), a filtered index on `RefreshToken` for the refresh lookup
(`:117-118`), a filtered **unique** index on `LinkedSpeakerId` that enforces the 1:1 User-to-Speaker
relationship of BR-208 (`:120-122`), and a filtered unique composite on
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
`Program.cs:342` (the response enumerates attendee user ids, so internal-only ingress is not enough,
`:336-341`). The swap itself is the Contracts-layer
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
[`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) subclass registered
at `Program.cs:187`, replays the organizer user-list read against its own Kestrel endpoint (`:33-36`)
and holds `/health/ready` not-ready until it has had its chance, deliberately accepting the expected
401 by turning `RequireSuccessStatusCode` off (`:49`) because the JIT cost lives in the traversal, not
the response ([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html), [Rubric
§12, Performance and Scalability]).

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
broker consumers (`Program.cs:297-301`). This event-carried link is what lets the bidirectional
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
server round-trip (`:43-49`), and accepts an image from either a browser file input (`:117`) or, on
MAUI, the camera and gallery through
[`IMediaPickerService`](group-26-device-capability-layer.md#imediapickerservice) (`:19`, `:86`, `:88`).
It talks to the API through the [`IUserUIService`](#iuseruiservice) abstraction implemented by
[`UserService`](#userservice) (`MMCA.ADC.Identity.UI/Services/UserService.cs:14`), an
[`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) subclass that
attaches the bearer token and calls the REST `users` resource (`:17`), and which deliberately skips the
retry policy on the avatar upload because a picker stream is single-shot and cannot rewind
(`:106-110`, against the `RetryPolicy.ExecuteAsync` every other call uses, `:49`, `:73`, `:88`,
`:127`). [`UserList`](#userlist) (`MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`) is the
Organizer-only management grid: a
[`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over
`UserListDTO` with server-side filtering, sorting, and paging on a desktop data grid (`:47-64`), plus a
[`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
card layout on mobile viewports (`:67-72`), the two kept in sync by the shared
[`ListPageActions`](#listpageactions) helper (`:38-39`, `:76`), which lives in Identity.UI because that
project is the root of the ADC module-UI reference chain
(`MMCA.ADC.Identity.UI/Common/ListPageActions.cs:6-12`). The UI targets WCAG 2.1 AA; the login and
register flows are scanned by the shared `MMCA.Common.Testing.E2E` workflow bases and the profile page
has its own axe-core scan in ADC's suite
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:360`, with the rationale for
not inheriting the Common profile base at `:362-363`), all of it running in the deploy-gating chromium
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
the password through the shared [`IPasswordHasher`](group-08-auth.md#ipasswordhasher)
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
- **Where it's used**: the Application copy is the type argument at `MMCA.ADC.Identity.Application/DependencyInjection.cs:47`, which resolves to `ScanModuleApplicationServices<TAssemblyMarker>` in `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:115` (see [`DependencyInjection`](#dependencyinjection) for the Application layer).
- **Caveats / not-in-source**: whether the API-layer copy has an active consumer is `Not determinable from source` within this unit; the API registration (`MMCA.ADC.Identity.API/DependencyInjection.cs:42-58`) does not reference it.

---

### GetUserAvatarQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarQuery.cs:5` · Level 0 · record (sealed)

- **What it is**: the smallest query in the module, a single-field request for the current user's avatar state (BR-116a).
- **Depends on**: the `UserIdentifierType` alias (`= int`, see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). Nothing else.
- **Concept introduced, the "identity is stamped, never asked for" query.** The CQRS query record itself is taught at [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the detail worth naming here is stated by the parameter doc (`GetUserAvatarQuery.cs:4`): `UserId` is "stamped by the controller, never client-supplied". `[Rubric §11, Security]` (assesses whether authorization is structural rather than a check that could be forgotten): the endpoint is `me/avatar` and the id comes from `ICurrentUserService` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:48-53`), so there is no request shape in which one user can ask for another user's avatar. Contrast [`GetUsersQuery`](#getusersquery) below, whose every field *is* client-supplied and therefore clamped and gated.
- **Walkthrough**: one line (`:5`), `public sealed record GetUserAvatarQuery(UserIdentifierType UserId);`. No validator, because there is no client-supplied field left to validate.
- **Why it's built this way**: giving even a one-field read its own named query type keeps every use case discoverable in the same place and lets the CQRS decorator pipeline address it by type like any other.
- **Where it's used**: constructed by [`UsersController`](#userscontroller)'s `GetAvatarAsync` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:52-54`), handled by [`GetUserAvatarHandler`](#getuseravatarhandler).

---

### GetUsersQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersQuery.cs:12` · Level 0 · record (sealed)

- **What it is**: the query behind the organizer user-management list (BR-51): four optional filters (email, first name, last name, role) plus paging and sort parameters.
- **Depends on**: nothing first-party. Every member is a BCL `string?` or `int`.
- **Concept introduced, the filter-plus-page-plus-sort read contract.** `[Rubric §9, API & Contract Design]` (assesses whether list contracts are explicit about paging and ordering rather than returning an unbounded collection): the query carries `PageNumber` / `PageSize` and `SortColumn` / `SortDirection` as first-class parameters, so a caller can never ask for "everything" implicitly. `[Rubric §12, Performance & Scalability]`: the documented maximum of 500 items per page (BR-11, `GetUsersQuery.cs:9`) is a contract statement here and an enforced clamp in [`GetUsersHandler`](#getusershandler).
- **Walkthrough**: a positional record with eight parameters (`:12-20`): the four nullable filters `Email` / `FirstName` / `LastName` / `Role` (`:13-16`), then `PageNumber = 1` (`:17`), `PageSize = 10` (`:18`), and the nullable `SortColumn = null` / `SortDirection = null` (`:19-20`). No body. The XML doc (`:3-11`) is the contract of record: 1-based page numbers, a maximum of 500 items per page, a default sort column of `CreatedOn` and a default direction of `desc`, all of which the handler actually applies.
- **Why it's built this way**: defaulted positional parameters let the common call ("page 1, 10 rows") be argument-free while still supporting the full filter and sort surface, and a `sealed record` is immutable, so the query can flow through the decorator pipeline with no stage able to mutate it.
- **Where it's used**: constructed by the organizer Users endpoint on [`UsersController`](#userscontroller) (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:138-140`), which is `[HttpGet]` (`:124`) gated by `[HasPermission(IdentityPermissions.UsersRead)]` (`:125`) and range-validates `pageNumber` and `pageSize` at the boundary with `[Range(1, int.MaxValue)]` (`:132-133`). Handled by [`GetUsersHandler`](#getusershandler).

---

### IdentityErrorResources
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Resources` · `MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` · Level 0 · class (sealed)

- **What it is**: an empty "resource anchor" type for the Identity module's localized error messages. It has no members; its only job is to be a `typeof(...)` handle that the localization layer uses to find the co-located `.resx` files ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. At runtime its `.resx` siblings are loaded through `System.Resources` and `IStringLocalizerFactory` (BCL and ASP.NET Core).
- **Concept introduced, edge error-message localization keyed by error `Code`.** `[Rubric §27, Internationalization]` (assesses whether user-facing strings, error text included, are translated rather than English-only). [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) localizes failures **at the API edge**: a domain [`Error`](group-01-result-error-handling.md#error)'s `Code` (for example `"User.Email.Empty"`) is the resource key, and the shared [`IErrorLocalizer`](group-12-api-hosting-mapping.md#ierrorlocalizer) looks that key up across every registered resource source before the failure is written into the ProblemDetails response. Each module contributes translations *additively* by registering its own anchor type, so Identity's strings live in `IdentityErrorResources.resx` and `IdentityErrorResources.es.resx` rather than in one central framework file that every module would have to edit.
- **Walkthrough**: the class body is empty (`IdentityErrorResources.cs:11-13`); everything worth knowing is in the doc comment (`:3-10`), which records two design points. Keys are the domain error `Code`. And **runtime-variable messages** (those that interpolate a user-supplied value) are deliberately omitted from the `.resx` so they degrade to their English message with the value intact instead of showing a broken or value-less translation.
- **Why it's built this way**: `AddErrorResources<TResource>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:113-117`) builds an `IStringLocalizer` from `typeof(TResource)` and appends it as one more [`ErrorResourceSource`](group-12-api-hosting-mapping.md#errorresourcesource) singleton (`:115-116`); the convention "a `.resx` named after the type, sitting beside it" is what binds the strings, so an empty marker class is exactly enough. The framework registers its own [`ErrorResources`](group-12-api-hosting-mapping.md#errorresources) the same way inside `AddErrorLocalization()` (`:98-104`, the registration itself at `:102`), which is what makes the mechanism additive rather than replace-only.
- **Where it's used**: registered at startup by the extracted Identity host, `services.AddErrorResources<IdentityErrorResources>()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:257`).

---

### IExternalLoginEmailVerifier
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11` · Level 0 · interface

- **What it is**: a one-method port that answers a single question about the OAuth login currently in flight: did the external provider explicitly assert that this email address is verified? It is the gate that decides whether an external identity may be auto-linked to an existing local account.
- **Depends on**: nothing first-party. The single method returns `Task<bool>` and takes no arguments, deliberately: the "current external login" is ambient request state, resolved by the implementation, not passed by the caller.
- **Concept introduced, the account-takeover guard as an explicit port.** `[Rubric §11, Security]` (assesses whether authentication trust decisions are explicit and fail closed) and `[Rubric §3, Clean Architecture]` (assesses dependencies pointing inward). Linking an external identity to a local account on nothing but an email match is a takeover primitive: any provider that hands out unverified email addresses would let an attacker register the victim's address and inherit the victim's account. The verified-email assertion lives in the short-lived `ExternalLogin` cookie principal, which is an HTTP concern, so the *decision input* is declared here as an interface in the Application layer and *implemented* at the API edge. Application code stays free of `HttpContext`, and the security rule stays testable with a two-line fake. `[Rubric §1, SOLID]`: an interface with exactly one method and exactly one reason to change.
- **Walkthrough**: `Task<bool> IsCurrentExternalLoginEmailVerifiedAsync()` (`IExternalLoginEmailVerifier.cs:19`). The XML comment (`:13-18`) fixes the semantics precisely: `true` only when the provider *explicitly* asserts verification (Google's `email_verified` claim); providers that assert nothing (GitHub's OAuth flow) yield `false`. There is no third "unknown" state, unknown is treated as unverified. The type-level comment (`:3-10`) names the consumer and the threat it is defending against.
- **Why it's built this way**: fail-closed by construction. Because the contract collapses "not verified" and "no assertion" into `false`, adding a new provider cannot silently open the auto-link path; it stays closed until someone deliberately maps a verification claim for it.
- **Where it's used**: consumed by [`AuthenticationService`](#authenticationservice) inside the external-login workflow (`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:196-197`); implemented by [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier), which re-authenticates the `ExternalLogin` scheme and parses the `email_verified` claim (`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:32-35`), returning `false` when there is no `HttpContext` (`:26-30`), no principal, or no parseable claim value (`:35`).

---

### DependencyInjection
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/DependencyInjection.cs:18` · Level 2 · class (static)

- **What it is**: the **API-layer** composition root for the Identity module. It exposes `AddIdentityModule(...)`, the single call that registers every layer of the module, plus `AddModuleIdentityAPI()`, which declares the module's role-to-permission grants and wires the OAuth email-verification gate.
- **Depends on**: `IServiceCollection` and `TryAddScoped` (Microsoft.Extensions.DependencyInjection); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); the Application-layer `AddModuleIdentityApplication` (see [`DependencyInjection`](#dependencyinjection) for the Application layer) and the Infrastructure-layer `AddModuleIdentityInfrastructure`; `AddPermissions` from `MMCA.Common.API.Authorization`, plus [`IdentityPermissions`](#identitypermissions) and [`RoleNames`](group-08-auth.md#rolenames); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) and [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier).
- **Concept introduced, the layered DI fan-out via `extension(IServiceCollection)`.** `[Rubric §3, Clean Architecture]` (assesses inward-pointing dependencies and a single composition point per module): the API layer is the only layer that can see *all* the others, so it owns the aggregate registration. The method hangs off `IServiceCollection` through the C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:20`), the workspace idiom for DI registration (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `[Rubric §16, Maintainability]`: the three-call body mirrors the layering, so registration order matches dependency order and there is exactly one place to look when wiring changes.
- **Walkthrough**
  - `AddIdentityModule(ApplicationSettings)` (`:27-34`) calls `AddModuleIdentityApplication(applicationSettings)` (`:29`), `AddModuleIdentityInfrastructure()` (`:30`), and `AddModuleIdentityAPI()` (`:31`), then returns `services` for chaining (`:33`).
  - `AddModuleIdentityAPI()` (`:42-58`) does two things. First it calls `AddPermissions` (`:44-48`) and grants **every** capability in [`IdentityPermissions`](#identitypermissions) to both `RoleNames.Organizer` (`:46`) and `RoleNames.Admin` (`:47`) via the spread `[.. IdentityPermissions.All]`; today that list holds the single `identity:users:read` capability (`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:11` and `:14-17`), and those grants are what back the module's `[HasPermission(...)]`-gated endpoints, the organizer user list among them. Second it registers the OAuth auto-link gate: `AddHttpContextAccessor()` (`:54`) plus `TryAddScoped<IExternalLoginEmailVerifier, HttpContextExternalLoginEmailVerifier>()` (`:55`). The inline comment (`:50-53`) explains the placement: the verified-email assertion lives in the external-login cookie principal, so the verifier is an API-edge concern.
  - Controllers are not registered here; ASP.NET Core's controller convention discovers them (doc comment `:36-41`).
- **Why it's built this way**: one entry point per module is what [`IdentityModule`](#identitymodule) calls, so module wiring stays discoverable; declaring the role-to-permission grants inside the module that owns the endpoints keeps the capability model co-located with the code it protects instead of in a central authorization file every module must reach into. `TryAddScoped` (rather than `AddScoped`) leaves the door open for a host to pre-register a different verifier.
- **Where it's used**: `AddIdentityModule` is invoked by [`IdentityModule`](#identitymodule)'s `Register` (`MMCA.ADC.Identity.API/IdentityModule.cs:23-24`) during topological module registration by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).

---

### IdentityModule
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/IdentityModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's entry point, the concrete [`IModule`](group-14-module-system-composition.md#imodule) that the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) discovers by reflection and registers. Identity is a **leaf** in the module dependency graph: it declares no prerequisites (doc comment `IdentityModule.cs:9-12`).
- **Depends on**: [`IModule`](group-14-module-system-composition.md#imodule); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); its own [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule`; [`IAttendeeQueryService`](#iattendeequeryservice) and [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) from the Shared layer; `Microsoft.Extensions.Configuration` and `Microsoft.Extensions.DependencyInjection`.
- **Concept introduced, the disabled-module stub.** The module contract itself is taught in [G14](group-14-module-system-composition.md#imodule); the Identity-specific lesson is `RegisterDisabledStubs`. `[Rubric §7, Microservices Readiness]` (assesses whether modules compose and deploy independently): every ADC host boots the same module assemblies but enables only some of them. A host with Identity *disabled* still contains consumers that depend on `IAttendeeQueryService` (Notification needs the attendee id list for a broadcast), so this method registers [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) as a singleton (`IdentityModule.cs:19-20`). DI validation succeeds, the consumer degrades gracefully, and in the extracted topology the composition root later *replaces* that stub with a gRPC-backed adapter (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:47`, a `services.Replace(...)` of the scoped [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter)).
- **Walkthrough**: three members, all one-liners. `Name => "Identity"` (`:16`) is the topological-sort key and the value the loader logs. `RegisterDisabledStubs(IServiceCollection)` (`:19-20`) registers the stub singleton. `Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:23-24`) delegates straight to `services.AddIdentityModule(applicationSettings)`; note that the `IConfigurationBuilder` parameter is accepted and unused here, because Identity contributes no configuration sources of its own. No dependency-declaration members are overridden, so the interface defaults apply (a leaf). There is deliberately **no seeding here**: that is a separate [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder), [`IdentityModuleSeeder`](#identitymoduleseeder).
- **Why it's built this way**: the module boundary is what makes each module extractable into its own service host without a rewrite ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). In the extracted `MMCA.ADC.Identity.Service` only this module is enabled; other services register the disabled stub and then overwrite it with a gRPC client. Application code never learns which transport it got.
- **Where it's used**: discovered and registered in Kahn-topological order by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) at host startup; `RegisterDisabledStubs` runs in hosts where the Identity module is not enabled, for example `MMCA.ADC.Notification.Service`, whose composition root then calls `AddIdentityAttendeeClient()` over the top (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:210-218`).

---

### AttendeeQueryService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` · Level 8 · class (sealed)

- **What it is**: Identity's in-process implementation of the cross-module [`IAttendeeQueryService`](#iattendeequeryservice) contract. It answers one question, "which user ids hold the Attendee role", and it is the only way another module gets that answer without touching the Identity domain.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (the Shared-layer contract); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype); [`User`](#user) and [`UserRole`](#userrole) (Domain); the `UserIdentifierType` alias.
- **Concept introduced, serving data across a module boundary through a Shared-layer contract.** `[Rubric §7, Microservices Readiness]` (assesses whether cross-module needs are met by explicit contracts rather than direct type references) and `[Rubric §3, Clean Architecture]`. Notification must fan a broadcast out to every attendee, but it must never reference `MMCA.ADC.Identity.Domain`. The interface therefore lives in `MMCA.ADC.Identity.Shared`, the implementation here in Application, and Notification sees only the interface. That indirection is exactly what later allows the same call to be satisfied over gRPC with no change at the call site. `[Rubric §12, Performance & Scalability]`: the query projects to ids in the database rather than materializing whole `User` rows, so the wire and the heap only ever carry integers.
- **Walkthrough** (primary-constructor injection of `IUnitOfWork`, `:11`)
  1. **Read repository** (`:16`), `unitOfWork.GetReadRepository<User, UserIdentifierType>()`, the read-only repository facade rather than the mutating one, so the intent is visible in the type.
  2. **Projected query** (`:17-20`), `GetProjectedAsync(u => u.Id, u => u.Role == UserRole.Attendee, cancellationToken: cancellationToken)`. The first lambda is the SELECT projection, the second the WHERE predicate; the global soft-delete query filter is left in force, so erased accounts are excluded automatically (that is what "active users" in the doc comment at `:7-10` means, since no explicit `IsDeleted` test appears here).
  3. **Shape the result** (`:22`), `userIds as IReadOnlyList<UserIdentifierType> ?? [.. userIds]`: the repository returns `IReadOnlyCollection<T>`, the contract promises `IReadOnlyList<T>`, so the cast is attempted first and a collection-expression copy is the fallback. No allocation when the underlying instance is already a list.
- **Why it's built this way**: pushing the role predicate and the id projection into the database keeps a broadcast cheap even as the attendee count grows, and relying on the global query filter for soft-delete means this service can never accidentally diverge from the rest of the system's definition of "deleted" ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Where it's used**: registered as the `IAttendeeQueryService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`MMCA.ADC.Identity.Application/DependencyInjection.cs:36`); consumed by the Notification module. In the extracted topology the registration is replaced by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), and this class becomes the code behind [`AttendeesGrpcService`](#attendeesgrpcservice) on the Identity side (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19`).

---

### GetUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarHandler.cs:10` · Level 8 · class (sealed)

- **What it is**: the read side of the avatar feature (BR-116a). It returns the current user's avatar URL, or `null` inside a successful result when none is set.
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); [`GetUserAvatarQuery`](#getuseravatarquery); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user); [`UserAvatarDTO`](#useravatardto); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, "absent value" is a success, "absent row" is a failure.** `[Rubric §9, API & Contract Design]` (assesses whether responses distinguish states unambiguously). The two outcomes look similar from the outside but mean different things, and the handler keeps them apart: a user with no avatar yields `Result.Success(new UserAvatarDTO(user.AvatarUrl))` with a null URL inside (`:23`), which the controller returns as HTTP 200 and a JSON body; a user id that resolves to no row yields `Error.NotFound` (`:22`), which the shared failure mapping turns into a 404. The UI can therefore render the "no photo yet" placeholder without treating it as an error. Everything else here is standard CQRS read shape, taught in [G05](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult).
- **Walkthrough** (primary constructor `:10-11`, single method `:14-24`): resolve the read-only repository and load in one expression, `unitOfWork.GetReadRepository<User, UserIdentifierType>().GetByIdAsync(query.UserId, cancellationToken)` (`:18-19`); then a ternary (`:21-23`) mapping `null` to `Error.NotFound.WithSource(nameof(GetUserAvatarHandler)).WithTarget(nameof(User))` and a found user to `Result.Success(new UserAvatarDTO(user.AvatarUrl))`. Eleven lines of body, no branching beyond that.
- **Why it's built this way**: `GetReadRepository` states the intent in the type, and the fluent `WithSource` / `WithTarget` error builders mean the edge can report *what* was missing without a bespoke error type per use case. Returning a DTO rather than the raw string leaves room to add avatar metadata later without changing the endpoint's shape ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: injected into [`UsersController`](#userscontroller) as `IQueryHandler<GetUserAvatarQuery, Result<UserAvatarDTO>>` (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:37`) and invoked by `GetAvatarAsync` for `GET /Users/me/avatar` (`:46-58`); its write-side counterparts are the [`SetUserAvatarCommand`](#setuseravatarcommand) and [`RemoveUserAvatarCommand`](#removeuseravatarcommand) handlers injected alongside it (`:35-36`).

---

### GetUsersHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:16` · Level 8 · class (sealed)

- **What it is**: the query handler for the organizer user list (BR-51). It filters, counts, sorts, pages and projects `User` rows into [`UserListDTO`](#userlistdto) entirely at the database level, then returns a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) wrapped in a [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor); [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) (obtained via `GetReadRepository`); [`PagingMath`](group-03-querying-specifications.md#pagingmath); [`User`](#user); [`UserListDTO`](#userlistdto); [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata); [`GetUsersQuery`](#getusersquery); BCL `System.Linq.Expressions` (`GetUsersHandler.cs:1`).
- **Concept introduced (1), server-side paging, sorting and projection over a no-tracking queryable.** `[Rubric §12, Performance & Scalability]` (assesses whether list endpoints push filter, sort, page and projection down to the database instead of materializing a table and slicing in memory): every stage composes onto `IQueryable` and executes as SQL, and the read runs against the no-tracking queryable so EF builds no change-tracking graph for rows the caller only reads. `[Rubric §30, Compliance / Privacy / Data Governance]` (assesses data minimization): the explicit `Select` projects exactly six columns (`:47-55`), so password hash and salt, refresh token and the device fields are never read out of the database, let alone serialized. The class doc (`:11-15`) states that contract directly. `[Rubric §6, CQRS & Event-Driven]`: as a query handler it runs inside the read decorator chain (FeatureGate, Logging, Caching, handler) with no transaction, per [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).
- **Concept introduced (2), a total ORDER BY is what makes paging correct.** `[Rubric §15, Best Practices & Code Quality]` (assesses whether known correctness traps are handled rather than left to chance). Sorting by a non-unique key alone leaves the database free to return equal-keyed rows in any order, so with `OFFSET`/`FETCH` a row can appear on two consecutive pages or on neither. `ApplySorting` therefore appends `ThenBy`/`ThenByDescending` on the primary key (`:93-95`) after the chosen key selector, and the comment above it (`:91-92`) records exactly that reasoning. The tie-break is not cosmetic: it is the difference between a stable pager and one that silently drops users.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (`:16-18`), implementing `IQueryHandler<GetUsersQuery, Result<PagedCollectionResult<UserListDTO>>>` (`:18`).
  - **Clamp the page** (`:28`): `PagingMath.Clamp(query.PageNumber, query.PageSize, 500)` returns a `(skip, take)` pair. The comment above it (`:25-27`) is the rationale: this is the BR-11 cap of 500, and the shared helper also floors a non-positive page number or page size and range-checks the offset in 64-bit. In the helper itself, `take` is `Math.Clamp(pageSize, 1, ...)` (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:37`), the page is floored at 1 (`:38`), the offset is computed as a `long` (`:40`), and an offset past `int.MaxValue` returns `(0, 0)` (`:42`), which materializes the empty page that page genuinely holds instead of a negative `Skip`.
  - **Base query** (`:30-35`): `unitOfWork.GetReadRepository<User, UserIdentifierType>()` yields the read repository (`:30`), `repository.TableNoTracking` (`:34`) is the untracked `IQueryable<User>`, and `ApplyFilters` composes the `Where` clauses (`:35`).
  - **Count, then sort, then page** (`:38-57`): `queryableExecutor.CountAsync(baseQuery, cancellationToken)` issues a `SELECT COUNT` against the *filtered but unpaged* query (`:38`); `ApplySorting` adds the `ORDER BY` (`:41`); then `Skip(skip).Take(take)` plus the `Select` into [`UserListDTO`](#userlistdto) (`:44-55`) become `OFFSET`/`FETCH` with an explicit column list, materialized by `queryableExecutor.ToListAsync` (`:57`). Note `Email = (string)u.Email` (`:50`): `User.Email` is a value object, and the cast is what lets the projection reach the underlying column value.
  - **Wrap** (`:59-60`): `new PaginationMetadata(totalCount, take, Math.Max(query.PageNumber, 1))` reports the *clamped* page size and the floored page number, so the metadata describes the page that was actually served rather than the one that was asked for; the result is returned as `Result.Success(new PagedCollectionResult<UserListDTO>(paged, metadata))`.
  - `ApplyFilters` (`:63-75`): one `Where` per non-null filter. `Email`, `FirstName` and `LastName` use `Contains` (`:66-70`), with the email predicate casting the value object first (`((string)u.Email).Contains(...)`, `:66`); `Role` uses equality against the query's `string?` (`:72`), which binds through [`UserRole`](#userrole)'s implicit string conversion (`MMCA.ADC.Identity.Domain/Users/UserRole.cs:94`).
  - `ApplySorting` (`:77-96`): the direction is descending when `SortDirection` equals `"desc"` case-insensitively **or** is null or whitespace (`:79-80`), which is how the documented `desc` default is realized. A `switch` on `SortColumn?.ToUpperInvariant()` picks the key selector for `EMAIL` / `FIRSTNAME` / `LASTNAME` / `ROLE` and falls through to `CreatedOn` for anything else, including null (`:82-89`), so an unknown sort column degrades to the documented default instead of throwing.
- **Why it's built this way**: routing count, sort, page and projection through [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) keeps the work set-based and testable (the executor is the mockable boundary over EF's async extension methods), while the read repository keeps a pure read off the tracking path. The explicit column projection is a type-level guarantee, not a convention: adding a sensitive field to [`User`](#user) cannot leak it through this endpoint without someone editing the `Select`. Delegating the cap to the shared [`PagingMath`](group-03-querying-specifications.md#pagingmath) rather than open-coding `Math.Min` means the hostile inputs (page 0, negative size, a page number near `int.MaxValue`) are handled the same way in every module.
- **Where it's used**: dispatched by the organizer Users endpoint on [`UsersController`](#userscontroller) (`MMCA.ADC.Identity.API/Controllers/UsersController.cs:138-140`), gated by [`IdentityPermissions`](#identitypermissions)`.UsersRead` (`:125`). Its page of [`UserListDTO`](#userlistdto) feeds the user-management grid in [`UserList`](#userlist).
- **Caveats / not-in-source**: whether a given filter or the `Role` comparison translates to SQL or falls back to client evaluation depends on the EF model configuration for the `Email` and `Role` value objects, which is not visible in this file.

---

### AuthenticationService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35` · Level 9 · class (sealed)

- **What it is**: ADC's authentication service. The generic login, registration, refresh, and revocation workflow is inherited from [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser); this subclass supplies the ADC-specific pieces: the Attendee default role, the `speaker_id` claim, the outbox-atomic [`UserRegistered`](#userregistered) integration event, and the entire external OAuth login flow.
- **Depends on**: [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser) and [`IAuthenticationService`](group-08-auth.md#iauthenticationservice); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ITokenService`](group-08-auth.md#itokenservice), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), `TimeProvider` (BCL); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier); [`User`](#user), [`UserRole`](#userrole), [`UserRegistered`](#userregistered), [`Email`](group-02-domain-building-blocks.md#email), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and [`RegisterRequest`](group-08-auth.md#registerrequest); `System.Security.Claims`.
- **Concept introduced (1), the template-method base with app-specific hooks.** `[Rubric §2, Design Patterns]` (assesses whether recurring shapes use a named, understood pattern) and `[Rubric §16, Maintainability]`. The base owns the security-critical sequence: validate first, [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) lockout and registration rate limits, the dual-fetch pattern, and refresh-token rotation with reuse detection (class doc `AuthenticationService.cs:12-20`). What varies per application is expressed as hooks, and this class overrides exactly those:
  - `FindUntrackedByEmailAsync` (`:66-74`), an untracked read (`asTracking: false`, `:71`) used by the login path.
  - `EmailExistsAsync` (`:85-86`), the registration uniqueness probe, run with `ignoreQueryFilters: true`.
  - `CreateUser` (`:89-96`), which fixes ADC's default role as `UserRole.Attendee` (BR-45, `:96`).
  - `CreateAccessToken` (`:99-100`), which appends the `speaker_id` claim when the account is linked to a speaker; the claim is built by the private `SpeakerClaims` helper (`:251-252`), returning `null` when `LinkedSpeakerId` has no value so the claim is simply absent rather than empty (BR-209).
  - `OnUserRegisteredAsync` (`:112-117`), the post-save hook, below.
- **Concept introduced (2), bypassing the query filter for a uniqueness probe, and what that actually protects.** `[Rubric §8, Data Architecture]` and `[Rubric §30, Compliance / Privacy / Data Governance]`. Read the remark at `:77-84` carefully, because the intuitive reading is wrong. Erasure in ADC always pairs Delete with Anonymize, which rewrites the stored address to a placeholder, so an erased account's **real email is re-registrable by design**, which is exactly what a right-to-erasure promise requires. The `ignoreQueryFilters: true` bypass is not there to block that. It is there because the unique `Email` index is *unfiltered* at the database level, so two cases would otherwise sail past a filtered `EXISTS` check and then blow up as a 500 on insert instead of a clean conflict: legacy rows that were soft-deleted without anonymization, and the anonymized placeholder addresses themselves. Seeing past the filter turns a crash into a domain error.
- **Concept introduced (3), the outbox-atomic registration event, and why it needs two saves in one transaction.** `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience & Business Continuity]`. `User.Id` is a database-generated identity column, so at the moment the aggregate is created the id is still `0`. The outbox serializes an event's payload *at capture time*, so raising [`UserRegistered`](#userregistered) before the insert would persist `UserId = 0`, and the cross-service Conference consumer, which has no access to the Identity database to re-match by email, could never resolve it. The fix is visible in two places:
  - `RegisterAsync` (`:57-63`) re-implements the interface member with `new` and wraps the base implementation in `UnitOfWork.ExecuteInTransactionAsync(token => base.RegisterAsync(request, ipAddress, token), cancellationToken)` (`:61-63`). The interface is re-listed on the class declaration (`:44`) specifically so this override wins for callers holding an [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), since the base method is not virtual; the trailing comment on that line says so.
  - `OnUserRegisteredAsync` (`:112-117`) runs *after* the base's first save, when the identity value exists: it calls `user.AddDomainEvent(new UserRegistered(user.Id, user.Email, user.FirstName, user.LastName, user.Role))` (`:114`), saves a second time so the outbox row is captured (`:115`), and returns the user (`:116`). Both saves sit inside the one transaction opened by `RegisterAsync`, so a crash before commit rolls back user and event together, and after commit the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) guarantees delivery. The class doc comment (`:21-33`) records that this replaced an earlier second-commit [`IEventBus`](group-04-events-outbox.md#ieventbus) publish whose crash window lost the speaker link permanently.
- **Concept introduced (4), the three-way external-login resolution with a takeover guard.** `[Rubric §11, Security]`. `ExternalLoginAsync` (`:130-139`) is again a transaction wrapper, this time around `ExternalLoginCoreAsync` (`:142-246`), which resolves the caller into exactly one of three cases:
  1. **Known external identity** (`:151-156`), a tracked lookup by `LoginProvider` **and** `ProviderKey`. Found means log in, nothing else runs.
  2. **Email matches an existing local account** (`:160-209`), the risky case, and it is guarded twice. First the raw claim is parsed through the value object: `Email.Create(email)` (`:171`) and, on failure, `Error.Validation("Auth.ExternalEmailInvalid", ...)` (`:174-178`). The comment (`:165-170`) explains why the `IsFailure` check rather than a bare `.Value`: `Result<T>.Value` is `null` on failure and does not throw, so an unparseable provider claim previously turned the lookup into "find the users whose email IS NULL" and matched on *absence* instead of identity. Unlike the local login and register paths, nothing has validated this address beforehand, because it arrives in an OAuth claim rather than in a FluentValidation-gated request. Second, before linking, it awaits `externalLoginEmailVerifier.IsCurrentExternalLoginEmailVerifiedAsync()` (`:196-197`) and, when the provider did not assert a verified email, returns `Error.Unauthorized("Auth.ExternalEmailNotVerified", ...)` (`:201-204`) telling the user to log in with their password instead. Only a verified assertion reaches `existingUser.LinkExternalProvider(loginProvider, providerKey)` (`:207`). The comment (`:190-195`) states the threat plainly.
  3. **Brand new user** (`:210-222`), `User.CreateExternal(...)` (`:213`), with failure propagated as `Result.Failure<AuthenticationResponse>(userResult.Errors)` (`:216`), otherwise `Repository.AddAsync` (`:220`) and `isNewUser = true` (`:221`).

  All three paths then converge (`:225-245`): mint and store a refresh token with `TimeProvider.GetUtcNow().UtcDateTime.Add(RefreshTokenLifetime)` (`:225-226`), save (`:228`), and, for a new user only, raise [`UserRegistered`](#userregistered) and save again (`:234-238`), the same post-identity pattern as local registration. Finally it mints the access token through `CreateAccessToken` (`:240`) and returns an [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) with the access-token expiry (`:242-245`).
- **Why it's built this way**: the base class keeps every application on one audited auth workflow, so a fix to lockout or refresh-token reuse detection lands once in `MMCA.Common` rather than per app; the hooks keep ADC's divergences (role, claim, event) small and named. The `UserRegistered` integration event, rather than an in-process domain event, is a deliberate divergence from MMCA.Store, because Conference runs in a separate process with its own database and can only learn about a registration asynchronously ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) outbox, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service). The eventual-consistency cost is explicit and documented at `:102-111` and `:119-129`: the first token issued does not yet carry `speaker_id`, and the claim appears on the next refresh once Conference has published `SpeakerLinkedToUser` back.
- **Where it's used**: registered as the `IAuthenticationService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`MMCA.ADC.Identity.Application/DependencyInjection.cs:33`); driven by [`AuthController`](#authcontroller) for local credentials and [`OAuthController`](#oauthcontroller) for the social paths.
- **Caveats / not-in-source**: whether `email_verified` is actually mapped for a given provider is host configuration, not visible here; the verifier's own doc comment (`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:12-14`) records that Google is mapped by a `PostConfigure<GoogleOptions>` claim action in the service host and that GitHub asserts nothing.

---

### DependencyInjection
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application` · `MMCA.ADC.Identity.Application/DependencyInjection.cs:19` · Level 10 · class (static)

- **What it is**: the **Application-layer** registration for Identity. It explicitly binds four services that convention scanning cannot infer, contributes the module's two data-subject export sections, then runs Scrutor scanning to auto-register every handler, mapper, validator, and domain-event handler in the assembly.
- **Depends on**: `IServiceCollection`, `TryAddScoped`; [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) with [`AuthenticationService`](#authenticationservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) with the framework's generic [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser) closed over [`User`](#user), and [`IAttendeeQueryService`](#iattendeequeryservice) with [`AttendeeQueryService`](#attendeequeryservice); the [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection) contributors [`EngagementUserDataExportSection`](#engagementuserdataexportsection) and [`NotificationUserDataExportSection`](#notificationuserdataexportsection); the `AddUserDataExportSection<TSection>` and `ScanModuleApplicationServices<TAssemblyMarker>` helpers from `MMCA.Common.Application` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:206` and `:115`); [`ClassReference`](#classreference).
- **Concept introduced (1), explicit registration for the ambiguous, convention scanning for the rest.** `[Rubric §2, Design Patterns]` and `[Rubric §16, Maintainability]`. Handlers, mappers, and validators follow a one-interface-one-implementation convention, so Scrutor can find them: `services.ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:47`) means adding a new use-case slice, [`GetUserAvatarHandler`](#getuseravatarhandler) for instance, needs **no DI edit at all**. The four services that are not convention-discoverable, because their interfaces live in other assemblies or have more than one plausible implementation, are registered by hand (`:33-36`). `TryAddScoped` rather than `AddScoped` is the load-bearing detail: a host that has already registered an override (a gRPC-backed `IAttendeeQueryService`, for instance) keeps it, and the module does not clobber it.
- **Concept introduced (2), closing a framework generic over the app's own entity.** `[Rubric §1, SOLID]` and `[Rubric §11, Security]`. `ISoftDeletedUserValidator` is a framework contract used by the shared [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) to reject an access token that outlived its account. Identity satisfies it not with a hand-written class but by closing the framework's generic [`SoftDeletedUserValidator<TUser>`](group-14-module-system-composition.md#softdeleteduservalidatortuser) over its own [`User`](#user) type (`:35`). The revocation check therefore has exactly one implementation across the whole workspace, and each app contributes only its entity type.
- **Concept introduced (3), the export section as an additive, ordered contribution.** `[Rubric §30, Compliance / Privacy / Data Governance]` and `[Rubric §7, Microservices Readiness]`. The data-subject export (PRIVACY.md §7) has to include data Identity does not own, so the framework models each contributor as an [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection) and the export handler fans out over the whole `IEnumerable<>`. Here Identity registers the two peers' sections in order, `EngagementUserDataExportSection` then `NotificationUserDataExportSection` (`:42-43`), and the comment above them (`:38-41`) records the two consequences: **registration order is the section order in the exported document**, and the export handler itself needs no registration because the scan below picks it up as an ordinary `IQueryHandler`. On the framework side, `AddUserDataExportSection<TSection>` registers the concrete type scoped and appends it with `TryAddEnumerable` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:209-210`), so the same section registered twice is added once, and a scoped lifetime lets a section take repositories or gRPC clients (`:188-198`).
- **Walkthrough**: `AddModuleIdentityApplication(ApplicationSettings)` (`:29-50`) lives inside an `extension(IServiceCollection services)` block (`:21`). Body order: `_ = applicationSettings;` (`:31`) discards the parameter with a comment marking it reserved for future decorator configuration; then `IAuthenticationService` to [`AuthenticationService`](#authenticationservice) (`:33`), the [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators) parameter object as a concrete registration (`:34`), `ISoftDeletedUserValidator` to `SoftDeletedUserValidator<User>` (`:35`), `IAttendeeQueryService` to [`AttendeeQueryService`](#attendeequeryservice) (`:36`); then the two export sections (`:42-43`), the Scrutor scan (`:47`), and `return services` (`:49`).
- **Why it's built this way**: mixing explicit and convention registration keeps the common case zero-ceremony while retaining precise control over the handful of services that need a specific lifetime or an override point. Registering the two cross-boundary implementations (`ISoftDeletedUserValidator`, `IAttendeeQueryService`) here is what closes the inversion those contracts set up: the framework and the Notification module declare the need, Identity satisfies it.
- **Where it's used**: called by the API-layer [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule` (`MMCA.ADC.Identity.API/DependencyInjection.cs:29`), which [`IdentityModule`](#identitymodule) calls in turn.
- **Caveats / not-in-source**: whether `applicationSettings` will ever be consumed is `Not determinable from source`; today it is only discarded (`:31`), taken solely to keep the signature uniform across modules.

---

### IdentityModuleSeeder
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14` · Level 11 · class (sealed)

- **What it is**: the Identity module's startup data seeder. It is a thin [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) that checks a configuration gate, resolves its dependencies from the host service provider, and delegates the actual inserts (default Organizer and Attendee accounts) to the Infrastructure-level [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Depends on**: [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder); `IConfiguration` and `IServiceProvider` (Microsoft.Extensions); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IPasswordHasher`](group-08-auth.md#ipasswordhasher); [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Concept introduced, the config-gated seeder bridge.** `[Rubric §8, Data Architecture]` (assesses deterministic, repeatable startup state), `[Rubric §11, Security]`, and `[Rubric §3, Clean Architecture]` (the API layer orchestrates, Infrastructure persists). Two design points matter here. First, the **gate**: the seeded accounts carry deliberately weak, well-known credentials (`admin@adc.com` with `Admin123!` plus two attendee accounts, `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:35-37`), so seeding is opt-in via `Seeding:IncludeSampleUsers` (`IdentityModuleSeeder.cs:28`) and the method returns immediately when it is false (`:29-30`). `GetValue<bool>` defaults to `false` when the key is absent, so a production service that configures nothing seeds no accounts at all, exactly the same shape as the conference sample-data gate (comment `:24-27`). Second, the **bridge**: this class resolves services from the provider instead of taking them in a constructor, then constructs the DB seeder by hand (`:34`).
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
- **Depends on**: the `UserIdentifierType` alias only; BCL (`Task`, `IReadOnlyList<T>`, `CancellationToken`). It deliberately references no Identity Domain or Application type: the file has no `using` directives at all, it opens straight onto its namespace (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:1`).
- **Concept introduced, the cross-module contract in the `Shared` assembly.** `[Rubric §7, Microservices Readiness]` (assesses whether modules talk through narrow, transport-agnostic interfaces that survive extraction into separate processes) and `[Rubric §3, Clean Architecture]` (assesses dependency direction: the consumer depends on an abstraction, not on the producer's internals). The doc comment (`IAttendeeQueryService.cs:3-7`) states the rule outright: the contract lives in `Shared` so the Notification module can call it without depending on the Identity implementation, preserving module boundary isolation. That one placement decision is what makes three different wirings interchangeable behind the same interface: the in-process [`AttendeeQueryService`](#attendeequeryservice) when Identity runs in the same host (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11`), the [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) stub when the module is switched off, and the [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter) when Identity runs as its own service. No consumer code changes between those three.
- **Walkthrough**: one member. `GetAttendeeUserIdsAsync(CancellationToken cancellationToken = default)` (`IAttendeeQueryService.cs:15`) returns `Task<IReadOnlyList<UserIdentifierType>>`, documented as the identifiers of all active (non-deleted) users with the Attendee role (`IAttendeeQueryService.cs:10-14`). The return type is deliberately just ids, not user records: the caller needs recipients, not personal data, so the contract carries the minimum (`[Rubric §30, Compliance, Privacy and Data Governance]`, data minimization across a module boundary).
- **Why it's built this way**: a coarse, id-only, async, cancellable method maps cleanly onto a gRPC unary call, which is exactly the extraction path [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) describes. Anything richer (a filtered query object, an `IQueryable`) would leak Identity's persistence model across the boundary and would not survive the process split.
- **Where it's used**: consumed by Notification's [`AttendeeNotificationRecipientProvider`](group-10-notifications.md#attendeenotificationrecipientprovider) (which bridges it to [`INotificationRecipientProvider`](group-10-notifications.md#inotificationrecipientprovider)); implemented in-process by [`AttendeeQueryService`](#attendeequeryservice), stubbed by [`DisabledAttendeeQueryService`](#disabledattendeequeryservice), served over the wire by [`AttendeesGrpcService`](#attendeesgrpcservice), and satisfied remotely by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).

### IdentityRoutePaths
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: the two route strings the Identity UI module owns, `/users` and `/profile`, published as `static readonly` fields so the navigation descriptor never hard-codes a URL literal.
- **Depends on**: nothing. The file declares no `using` directives and references no other type.
- **Concept reinforced, route constants as the module's public navigation surface.** `[Rubric §25, Navigation and Information Architecture]` (assesses whether routes are declared in one place so menu entries, redirects, and tests cannot drift from the pages themselves) and `[Rubric §16, Maintainability]`. The pattern is small but load-bearing: the nav items in [`IdentityUIModule`](#identityuimodule) reference `IdentityRoutePaths.Profile` and `IdentityRoutePaths.Users` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:17-18`) rather than repeating the strings, so renaming a route is a one-line change here.
- **Walkthrough**: `Users = "/users"` (`IdentityRoutePaths.cs:8`) and `Profile = "/profile"` (`IdentityRoutePaths.cs:9`), both `public static readonly string` on a `public static class` (`:6`).
- **Caveats / not-in-source**: the `@page` directives on the [`UserList`](#userlist) and [`Profile`](#profile) components still spell their route literally (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor:1` is `@page "/users"`, `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor:1` is `@page "/profile"`), because a Razor `@page` directive requires a compile-time constant and these are `static readonly` fields rather than `const`. So this type is the single source of truth for *navigation*, not for the page routing attribute itself. The sibling claims page (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/UserClaims.razor:1`, `@page "/profile/claims"`) has no entry here at all.
- **Where it's used**: only by [`IdentityUIModule`](#identityuimodule)'s `NavItems` (`IdentityUIModule.cs:17-18`) in current source; a repository-wide search for the type name returns just that file and its own declaration.

### UserAvatarDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:6` · Level 0 · record (sealed)

- **What it is**: the one-field response body every avatar endpoint returns: the current public avatar URL, or `null` when the user has none (BR-116a).
- **Depends on**: nothing first-party; one BCL attribute (`System.Diagnostics.CodeAnalysis.SuppressMessage`).
- **Concept reinforced, the response DTO as a stable wire shape.** `[Rubric §9, API and Contract Design]` (assesses whether endpoints return a named, versionable shape rather than a bare primitive). Returning `{ "avatarUrl": ... }` instead of a raw string means a later addition (a thumbnail URL, an upload timestamp) is an additive change, not a breaking one. The `CA1054` suppression (`UserAvatarDTO.cs:5`) carries its own justification in source: this is a serialized DTO field, so the URL stays a `string` on the wire rather than becoming a `Uri`.
- **Walkthrough**: a single positional record, `public sealed record UserAvatarDTO(string? AvatarUrl)` (`UserAvatarDTO.cs:6`), with the parameter documented at `UserAvatarDTO.cs:4`. The nullable parameter is the whole contract: "no avatar" is a first-class, non-exceptional state.
- **Why it's built this way**: avatars are managed file storage ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), so the only thing a client ever needs back from an upload is the new public URL. Handing it back in a named record keeps the read endpoint, the write endpoint, and the client projection on one type.
- **Where it's used**: produced by the avatar read and write use cases ([`GetUserAvatarHandler`](#getuseravatarhandler), [`SetUserAvatarHandler`](#setuseravatarhandler)) and returned by [`UsersController`](#userscontroller)'s `me/avatar` endpoints (`GET` declared at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:44-46` returning `Ok(result.Value)` at `:58`, `POST` at `:66-70` returning at `:101`). The delete endpoint (`:105-107`) returns a bare `ActionResult` with a 204, because there is no avatar state left to report. Client-side it is deserialized by [`UserService`](#userservice) in `GetMyAvatarUrlAsync` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:94-95`) and `UploadMyAvatarAsync` (`:119-120`), both of which immediately project it down to `dto?.AvatarUrl` for the [`Profile`](#profile) page's avatar controls (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:65`, `:156`).

### UserDataExportBookmarkDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one session-bookmark row inside the Engagement section of a data-subject export: which session the user bookmarked and when.
- **Depends on**: the `SessionIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the export row DTO (ids and dates only).** `[Rubric §30, Compliance, Privacy and Data Governance]` (assesses whether a data-subject access or portability request returns the subject's own data, and only that). The doc comment (`UserDataExportBookmarkDTO.cs:3-6`) ties the shape directly to PRIVACY.md §7. Note what is *not* here: no session title, no speaker, no other user's activity. The export carries the personal fact ("you bookmarked session X at time T") rather than a denormalized copy of another context's catalog, which keeps the Identity service from becoming an accidental read model of Conference data.
- **Walkthrough**: two `required init` members, `SessionId` (`UserDataExportBookmarkDTO.cs:10`) and `CreatedOn`, documented as UTC (`:13`). `required` means the producing section cannot forget a field, and `init` makes the row immutable once produced (the `required`/`init` immutability convention from the [primer](00-primer.md)).
- **Where it's used**: built by [`EngagementUserDataExportSection`](#engagementuserdataexportsection) from the Engagement peer's response, in a `[.. export.Bookmarks.Select(...)]` spread (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/EngagementUserDataExportSection.cs:36-40`), and carried inside [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:14`). The source aggregate on the far side is [`UserSessionBookmark`](group-22-engagement-module.md#usersessionbookmark).

### UserDataExportCheckInDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportCheckInDTO.cs:8` · Level 0 · record (sealed)

- **What it is**: one attendance row in the Engagement section of a data-subject export: what the attendee was checked in to (a session, a sponsor booth, or the event itself) and when.
- **Depends on**: nothing first-party (the ids travel as plain `int`); BCL (`DateTimeOffset`).
- **Concept**: the same export-row shape [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto) introduces, with one policy worth reading carefully. The doc comment (`UserDataExportCheckInDTO.cs:3-7`) records that check-ins are reported *independently of the points ledger*, "since a check-in that earned no points still leaves an attendance record". `[Rubric §30, Compliance, Privacy and Data Governance]` (assesses completeness of a subject access response): had the export derived attendance from [`UserDataExportPointsEntryDTO`](#userdataexportpointsentrydto) rows, a repeat scan or a scan outside the awarding window would be personal data the system holds and the export never mentions. Two independent lists is the honest answer.
- **Walkthrough**: five members (`UserDataExportCheckInDTO.cs:11-23`). `Scope` (`:11`) is a `required string`, documented as the readable name of what the check-in attests to (for example `"Session"`); `EventId` (`:14`) is `required` and documented as always set for every scope, which is what makes the row self-locating. `SessionId` (`:17`) and `SponsorId` (`:20`) are nullable `int`s, each set only for its own scope, so the row is a discriminated shape expressed with nullability rather than a type hierarchy. `CheckedInOn` (`:23`) is a `required DateTimeOffset`: unlike the sibling rows, which carry `DateTime` and depend on the producer to stamp UTC, this one carries its offset on the wire.
- **Why it's built this way**: `Scope` is a `string` and not the [`CheckInScope`](group-22-engagement-module.md#checkinscope) enum, and the mapping site says why in a comment: "the export document is read by the data subject, so the scope travels as its readable name rather than a number" (`EngagementUserDataExportSection.cs:58-60`). A numeric enum value in a portable document is meaningless to the person it was produced for, and it silently re-numbers if the enum is ever reordered. The check-in and points data itself arrives via [ADR-072](https://ivanball.github.io/docs/adr/072-qr-badge-check-in-and-points.html).
- **Where it's used**: projected by [`EngagementUserDataExportSection`](#engagementuserdataexportsection) from [`UserEngagementCheckInExportDTO`](group-22-engagement-module.md#userengagementcheckinexportdto) rows (`EngagementUserDataExportSection.cs:56-65`), into the `CheckIns` list of [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) (`UserDataExportEngagementSectionDTO.cs:26`).

### UserDataExportNotificationDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one notification-inbox row in the Notifications section of a data-subject export: the notification id, its title, and the sent/read timestamps.
- **Depends on**: the `UserNotificationIdentifierType` alias; BCL (`DateTime`).
- **Concept**: the same export-row shape [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto) introduces (`[Rubric §30, Compliance, Privacy and Data Governance]`), with one extra nuance: it does include the `Title` text, because a notification's title is content that was addressed to this user, so it is part of *their* personal data rather than someone else's.
- **Walkthrough**: five members (`UserDataExportNotificationDTO.cs:10-22`). `NotificationId` (`:10`), `Title` (`:13`), and `SentOn` (`:16`, documented UTC) are `required init`. The pair that describes read state is not: `IsRead` is a plain `bool` (`:19`) that defaults to `false`, and `ReadOn` is a nullable `DateTime` (`:22`) documented as null while unread. An unread row therefore simply carries the defaults, with no ceremony at the construction site.
- **Where it's used**: projected by [`NotificationUserDataExportSection`](#notificationuserdataexportsection) from the Notification peer's rows (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/NotificationUserDataExportSection.cs:35-42`) into [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto); the underlying entity is [`UserNotification`](group-10-notifications.md#usernotification).

### UserDataExportPointsEntryDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportPointsEntryDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one awarded-points row in the Engagement section of a data-subject export: what the attendee did, how many points it was worth, what it was scoped to, and when.
- **Depends on**: nothing first-party; BCL (`DateTime`).
- **Concept**: the same export-row shape as [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), applied to a gamification ledger. `[Rubric §30, Compliance, Privacy and Data Governance]`: a points ledger is derived data, not something the subject typed in, and it is still personal data the operator holds about them, so it is exported. The `Points` doc (`UserDataExportPointsEntryDTO.cs:12`) is precise about which number is reported: "as configured at award time", not recomputed from today's configuration, so the export reproduces what the ledger actually recorded rather than what the current rules would say.
- **Walkthrough**: four `required init` members (`UserDataExportPointsEntryDTO.cs:10-19`). `ActivityType` (`:10`) is a `string` carrying the readable activity name (for example `"SessionCheckIn"`), `Points` (`:13`) the awarded amount, `SubjectKey` (`:16`) the subject the award was scoped to (documented as, for example, the session key), and `CreatedOn` (`:19`) the UTC timestamp.
- **Why it's built this way**: same reason as [`UserDataExportCheckInDTO`](#userdataexportcheckindto)'s `Scope`. The producing section maps `p.ActivityType.ToString()` off the [`PointsActivityType`](group-22-engagement-module.md#pointsactivitytype) enum with the rationale in a comment: the document is read by the data subject, so the activity travels as its readable name "(the same choice the Role field makes) rather than a number" (`EngagementUserDataExportSection.cs:49-51`).
- **Where it's used**: projected by [`EngagementUserDataExportSection`](#engagementuserdataexportsection) from [`UserEngagementPointsEntryExportDTO`](group-22-engagement-module.md#userengagementpointsentryexportdto) rows (`EngagementUserDataExportSection.cs:47-55`) into the `PointsEntries` list of [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) (`UserDataExportEngagementSectionDTO.cs:20`); the owning aggregate on the far side is [`PointsEntry`](group-22-engagement-module.md#pointsentry).

### UserDataExportSubjectDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportSubjectDTO.cs:16` · Level 0 · record (sealed)

- **What it is**: the Identity-owned half of a data-subject export: everything the Identity service holds about one account, from the login email to the MAUI device metadata. It is the `Subject` slot of the framework's export envelope, not the whole document.
- **Depends on**: the `UserIdentifierType` and `SpeakerIdentifierType` aliases; BCL (`DateTime`). Notably it depends on nothing from MMCA.Common: the envelope types it plugs into declare that slot as `object`.
- **Concept introduced, the app-owned subject snapshot inside a framework-owned envelope.** `[Rubric §30, Compliance, Privacy and Data Governance]` (assesses whether the right of access and portability is implemented as a real, complete, machine-readable artifact) and `[Rubric §11, Security]` (assesses that secrets never reach a serialization boundary). The type doc (`UserDataExportSubjectDTO.cs:3-8`) names the exclusions and the reason: the password hash and salt, the refresh token, and the opaque external-provider key are secrets, not portable personal data, so exporting them would create a credential-leak channel out of a privacy feature. The `remarks` block (`:9-15`) records the split that [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) introduced: this type is the `Subject` of [`UserDataExportDTO`](group-08-auth.md#userdataexportdto) in `MMCA.Common.Shared.Privacy`, and the cross-service data travels *beside* it as section envelopes, each aggregated best-effort. The framework owns the envelope; each app owns which of its own fields are portable, which is exactly why the envelope's `Subject` property is typed `object` and serializes by runtime type (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:32-40`).
- **Walkthrough**
  - Identity account fields (`UserDataExportSubjectDTO.cs:19-34`): `required` `UserId` (`:19`), `Email` (`:22`), `FirstName` (`:25`), `LastName` (`:28`), `FullName` (`:31`), and `Role` (`:34`).
  - External-login fields (`:37`, `:40`): `IsExternalLogin` and the provider *name* only; the doc on `LoginProvider` (`:39`) restates that the opaque provider key is intentionally omitted.
  - Cross-context link and profile (`:43`, `:46`): the nullable `LinkedSpeakerId` (the scalar link to a Conference speaker, never a cross-database FK) and `AvatarUrl` (BR-116a).
  - Device metadata (`:49-67`): seven nullable strings reported by the MAUI client, `DeviceId`, `DeviceFormFactor`, `DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceName`, `DeviceType`. This is exactly the block [`UserListDTO`](#userlistdto) refuses to show an organizer: the subject may see their own device data, a third party browsing a user grid may not.
  - Audit timestamps (`:70`, `:73`): `CreatedOn` and nullable `LastModifiedOn`, both documented UTC, the same audit fields the framework stamps in `SaveChangesAsync`. [`ExportUserDataHandler`](#exportuserdatahandler) re-stamps their `DateTimeKind` on the way out (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:70-73`) because SQL Server hands them back as `Kind=Unspecified`, which would serialize without the trailing `Z` the doc promises; the comment at `:67-69` is the record of that.
- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) split the export handler in two, an orchestration that is identical in ADC and Store (authorize, load, fan out, degrade, envelope) and a projection that names app types and therefore cannot be shared. This record is that projection. Keeping it flat and required-heavy means the compiler catches a snapshot that forgets a field, and keeping it in `Shared` lets the API, the UI, and the tests name it without referencing the Domain assembly. Together with the erasure path on the [`User`](#user) aggregate ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), it is the read half of the privacy pair: export what we hold, then anonymize it on request.
- **Where it's used**: assembled by [`ExportUserDataHandler`](#exportuserdatahandler) in one object initializer (`ExportUserDataHandler.cs:48-74`) and returned as the `object?` subject (`:76`); the shared base then stamps it into the envelope's `Subject` alongside a `FormatVersion` of `"1.0"` and the section list (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:61`, `:110-117`). The whole envelope is served by [`UsersController`](#userscontroller)'s `{userId}/export` endpoint (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:149-167`), which passes the caller's own id and role into the query so the handler can enforce its owner-or-Organizer check (`:161-163`).
- **Caveats / not-in-source**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) records that the framework also ships a `DataExportControllerBase` that delivers the package as a `Content-Disposition` download behind a feature gate, and that **no consumer has adopted it**: ADC's endpoint still returns the document inline from its own action (`UsersController.cs:167`). The file-download and 404-when-disabled behavior is framework code no deployed ADC endpoint exhibits today.

### UserDataExportSubmittedQuestionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one submitted session-question row in the Engagement section of a data-subject export: the question id, the session it was asked in, and when it was submitted.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL (`DateTime`).
- **Concept**: the same export-row shape as [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), and the sharpest illustration of its restraint. The doc comment (`UserDataExportSubmittedQuestionDTO.cs:3-6`) spells the rule out: ids plus submission date only, never other users' data. The question *text* and its upvote count are omitted, so an export cannot be turned into a scrape of the live question feed (`[Rubric §30, Compliance, Privacy and Data Governance]`, `[Rubric §11, Security]`).
- **Walkthrough**: three `required init` members, `QuestionId` (`UserDataExportSubmittedQuestionDTO.cs:10`), `SessionId` (`:13`), and `CreatedOn` in UTC (`:16`).
- **Where it's used**: carried in [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto)'s `SubmittedQuestions` (`UserDataExportEngagementSectionDTO.cs:17`), populated by [`EngagementUserDataExportSection`](#engagementuserdataexportsection) (`EngagementUserDataExportSection.cs:41-46`); the source aggregate is [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) in the Engagement live layer.

### UserListDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` · Level 0 · record

- **What it is**: the row shape for the organizer user list (BR-51): id, email, first/last name, role, and creation date, and nothing else.
- **Depends on**: the `UserIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the list projection DTO as a privacy boundary.** `[Rubric §8, Data Architecture]` (assesses whether reads project only the columns a screen needs instead of hydrating whole aggregates) and `[Rubric §30, Compliance, Privacy and Data Governance]`. The doc comment (`UserListDTO.cs:3-6`) is explicit that device-specific fields are excluded to protect attendee device privacy: the [`User`](#user) aggregate carries `DeviceId`, `DeviceModel`, `DeviceManufacturer` and friends, but an organizer browsing the user grid has no business seeing them. Because the projection is built inside the query, a `.Select(u => new UserListDTO { ... })` translated to SQL after `Skip`/`Take` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:44-55`), the excluded columns are never even read from the database, so this is a privacy boundary *and* a performance win at once (`[Rubric §12, Performance and Scalability]`).
- **Walkthrough**: six members (`UserListDTO.cs:10-25`). `UserId` (`:10`), `Email` (`:13`), `FirstName` (`:16`), `LastName` (`:19`), and `Role` (`:22`) are `required init`; `CreatedOn` is a plain `init` `DateTime` (`:25`). `Role` is a `string`, not the [`UserRole`](#userrole) value object: the wire format stays primitive, and the closed-set type is a domain concern. The projection casts the [`Email`](group-02-domain-building-blocks.md#email) value object with `(string)u.Email` (`GetUsersHandler.cs:50`) so EF translates it to the underlying column.
- **Why it's built this way**: keeping the list DTO separate from [`UserDTO`](#userdto) lets the grid evolve (sortable columns, an added `CreatedOn`) without touching the general-purpose account DTO, and it keeps the list endpoint's payload small enough to page cheaply.
- **Where it's used**: produced by [`GetUsersHandler`](#getusershandler) inside a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (`GetUsersHandler.cs:60`), returned by [`UsersController`](#userscontroller)'s list endpoint (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:126-127`), and consumed client-side through [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:19`, `:59-62`) as the `MudDataGrid` row type on the [`UserList`](#userlist) page, which inherits `DataGridListPageBase<UserListDTO>` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`). The grid's filter keys are read back off the DTO with `nameof(UserListDTO.Email)` and friends (`UserList.razor.cs:52-55`), so a renamed property breaks at compile time rather than at runtime.

### DisabledAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` · Level 1 · class (sealed)

- **What it is**: the no-op stand-in for [`IAttendeeQueryService`](#iattendeequeryservice) that gets registered when the Identity module is switched off in a host. It returns an empty attendee list instead of failing DI.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice), the `UserIdentifierType` alias; BCL (`Task.FromResult`).
- **Concept introduced, the disabled-module stub (null object).** `[Rubric §2, Design Patterns]` (assesses recognized patterns applied deliberately: this is the Null Object pattern) and `[Rubric §7, Microservices Readiness]`. The [module system](group-14-module-system-composition.md#imodule) lets a host run any subset of modules; a host that disables Identity would otherwise fail to resolve every cross-module Identity interface at startup. `IModule.RegisterDisabledStubs` closes that hole, and [`IdentityModule`](#identitymodule) registers exactly this type there (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:19-20`). Crucially the stub lives in `Shared`, the same assembly as the contract, so a host can reference the stub without pulling in Identity's Application or Domain assemblies: the Notification service's csproj carries a comment saying precisely that (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/MMCA.ADC.Notification.Service.csproj:28-31`).
- **Walkthrough**: the whole class is one expression-bodied method. `GetAttendeeUserIdsAsync` returns `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])` (`DisabledAttendeeQueryService.cs:10-11`): a completed task over an empty collection expression, so there is no allocation-heavy work and no `async` state machine.
- **Why it's built this way**: returning empty rather than throwing keeps "Identity is not in this host" a *configuration* fact instead of a runtime error. In the extracted topology the stub is also the safety net: `AddIdentityAttendeeClient()` calls `services.Replace(ServiceDescriptor.Scoped<IAttendeeQueryService, AttendeeQueryServiceGrpcAdapter>())` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:47`), and its doc comment (`:25-31`) records why `Replace` rather than `TryAdd`: either the real in-process [`AttendeeQueryService`](#attendeequeryservice) or this stub may already be in the container, and after the call the resolved interface is the gRPC adapter in both cases. If that replacement were ever skipped, a broadcast would reach nobody rather than crash the Notification host. The same pattern is the module convention across the repo (`DisabledBookmarkCountService`, `DisabledSessionBookmarkValidationService`, `DisabledUserNotificationExportService`).
- **Where it's used**: registered by [`IdentityModule`](#identitymodule)`.RegisterDisabledStubs` as a singleton (`IdentityModule.cs:20`); replaced at startup in `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:218` by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), with the `Replace` rationale restated in the comment at `:210-217`.

### UserDataExportEngagementSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:11` · Level 1 · record (sealed)

- **What it is**: the Engagement-owned payload of a data-subject export: the user's session bookmarks, submitted session questions, points ledger, check-in history, and leaderboard participation.
- **Depends on**: [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), [`UserDataExportSubmittedQuestionDTO`](#userdataexportsubmittedquestiondto), [`UserDataExportPointsEntryDTO`](#userdataexportpointsentrydto), [`UserDataExportCheckInDTO`](#userdataexportcheckindto).
- **Concept introduced, the section payload with reachability held one level up.** `[Rubric §29, Resilience and Business Continuity]` (assesses whether a request that fans out to peers degrades instead of failing when one peer is down) and `[Rubric §7, Microservices Readiness]` (assesses that a cross-service aggregate does not turn every peer into a hard dependency). The interesting move in the export is that "Engagement is unreachable" is modelled as *data* rather than as an exception, so a GDPR request that cannot reach one peer still succeeds. What is worth reading carefully here is **where** that flag lives: not on this type. The doc comment (`UserDataExportEngagementSectionDTO.cs:3-10`) is explicit, "reachability lives on the envelope, never here", because the framework's [`UserDataExportSectionDTO`](group-08-auth.md#userdataexportsectiondto) owns `Available` and `UnavailableReason` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:72`, `:88`). This type is only the payload the envelope carries in its `object? Data` slot. That is the [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) split again: degradation semantics belong to the framework, the field list belongs to the app.
- **Walkthrough**: six members, none of them `required`, all four collections defaulting to an empty collection expression `[]`. `Bookmarks` (`UserDataExportEngagementSectionDTO.cs:14`), `SubmittedQuestions` (`:17`), `PointsEntries` (`:20`), and `CheckIns` (`:26`, whose doc at `:22-25` records that it is reported independently of the points ledger). `IsOnLeaderboard` (`:29`) is a plain `bool` and `LeaderboardDisplayName` (`:32`) a nullable string documented as null when the user never opted in, which is how the export reports a privacy *choice* the user made and not just the data it produced.
- **Why it's built this way**: the empty-list defaults mean a section that legitimately holds nothing for the user is a truthful `Complete` result with an empty payload, which the framework contract distinguishes from an unknown one (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:9-14`). The reader of an export can therefore tell "you had no bookmarks" apart from "we could not check", and neither of those states is expressible as a null list.
- **Where it's used**: constructed by [`EngagementUserDataExportSection`](#engagementuserdataexportsection) from [`UserEngagementExportDTO`](group-22-engagement-module.md#userengagementexportdto) (`EngagementUserDataExportSection.cs:34-68`) and handed to [`UserDataExportSectionResult`](group-14-module-system-composition.md#userdataexportsectionresult)`.Complete("Engagement", data)` (`:70`); the shared base wraps it into a section envelope and, on a thrown call, replaces it with an `Available = false` envelope instead (`ExportUserDataHandlerBase.cs:185-197`).

### UserDataExportNotificationSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:10` · Level 1 · record (sealed)

- **What it is**: the Notification-owned payload of a data-subject export: the user's inbox rows, newest first.
- **Depends on**: [`UserDataExportNotificationDTO`](#userdataexportnotificationdto).
- **Concept**: structurally the same section payload [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) introduces, applied to a second peer (`[Rubric §29, Resilience and Business Continuity]`), and carrying the same "reachability lives on the envelope, never here" contract in its doc comment (`UserDataExportNotificationSectionDTO.cs:3-9`). Two peers means two independent envelopes: the Notification service can be down while Engagement answers, and the export still returns everything it managed to gather, because the shared base invokes each registered section inside its own try/catch (`ExportUserDataHandlerBase.cs:31-36`, `:185-197`).
- **Walkthrough**: one member. `IReadOnlyList<UserDataExportNotificationDTO> Notifications { get; init; } = []` (`UserDataExportNotificationSectionDTO.cs:13`), documented as newest first. The ordering is part of the contract but is produced by the peer, not enforced here.
- **Where it's used**: constructed by [`NotificationUserDataExportSection`](#notificationuserdataexportsection) (`NotificationUserDataExportSection.cs:33-43`) and returned via `UserDataExportSectionResult.Complete("Notifications", data)` (`:45`). It is the second of the two sections ADC registers, and the registration order is the document order: `AddUserDataExportSection<EngagementUserDataExportSection>()` then `AddUserDataExportSection<NotificationUserDataExportSection>()` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:42-43`, with the ordering rationale in the comment at `:39-41`).

### UserDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` · Level 1 · record

- **What it is**: the general-purpose account DTO: id, email, first/last name, and role. It is the credential-free projection of the [`User`](#user) aggregate.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the framework DTO contract from `MMCA.Common.Shared.DTOs`, imported at `UserDTO.cs:1`), the `UserIdentifierType` alias.
- **Concept reinforced, the identified DTO (`IBaseDTO<TIdentifierType>`).** `[Rubric §9, API and Contract Design]` (assesses a consistent, machine-checkable response shape) and `[Rubric §11, Security]` (assesses that secrets never reach a serialization boundary). Implementing [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`UserDTO.cs:8`) is what lets this DTO plug into the framework's generic mapper and service abstractions: `Id` (`:11`) satisfies the interface. Just as important is the omission: the [`UserDTOMapper`](#userdtomapper) doc comment (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:11`) records that `PasswordHash`, `PasswordSalt`, and `RefreshToken` are excluded from the projection, so the DTO is the enforced boundary between an aggregate that holds credentials and anything that can be serialized.
- **Walkthrough**: five `required init` members (`UserDTO.cs:11-23`), `Id` (`:11`), `Email` (`:14`, documented as the login credential, BR-200), `FirstName` (`:17`), `LastName` (`:20`), and `Role` as a `string` used for authorization decisions (`:23`). Because the mapper is a Mapperly source generator, adding a member here changes generated code at build time rather than at runtime ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html), manual and Mapperly mapping).
- **Why it's built this way**: `required` on every member means the compiler, not a reviewer, catches a mapper that forgets a field, and keeping the type in `Shared` lets any layer (API, UI, tests) name it without referencing the Domain assembly.
- **Where it's used**: produced by [`UserDTOMapper`](#userdtomapper), a `[Mapper]`-attributed sealed partial class (`UserDTOMapper.cs:13-15`) implementing [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) over ([`User`](#user), `UserDTO`, `UserIdentifierType`). The generator fills in `MapToDTO` (`UserDTOMapper.cs:18`); the collection overload is hand-written over it (`:21-25`), and a private `EmailToString` helper converts the [`Email`](group-02-domain-building-blocks.md#email) value object to its string form (`:28`).

### IdentityUIModule
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's UI descriptor. It tells the shared Blazor shell two things: which navigation entries this module contributes, and which assembly to scan for routable components.
- **Depends on**: [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the contract, `IdentityUIModule.cs:4`, `:13`), [`NavItem`](group-15-common-ui-framework.md#navitem) and [`NavSection`](group-15-common-ui-framework.md#navsection) from `MMCA.Common.UI.Common` (`:3`), [`IdentityRoutePaths`](#identityroutepaths), [`RoleNames`](group-08-auth.md#rolenames) from `MMCA.Common.Shared.Auth` (`:2`); externals: MudBlazor `Icons.Material.Filled` (`:5`), BCL `System.Reflection.Assembly` (`:1`).
- **Concept reinforced, the pluggable UI module descriptor.** `[Rubric §18, UI Architecture]` (assesses whether the shell discovers features rather than hard-coding them) and `[Rubric §25, Navigation and Information Architecture]` (assesses that menu structure, role gating, and routes are declared next to the feature that owns them). The [`IUIModule`](group-15-common-ui-framework.md#iuimodule) contract is introduced in [G15](group-15-common-ui-framework.md): a host collects every registered implementation, merges their `NavItems` into the sidebar, and passes their `Assembly` to the router's additional assemblies so pages in a Razor Class Library are found ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)). The effect is that adding the Identity module to a host adds its pages *and* its menu entries in one registration, with no edit to the shell. `[Rubric §11, Security]` and `[Rubric §27, Internationalization]` both show up in the two declarations below.
- **Walkthrough**: two members.
  - `NavItems` (`IdentityUIModule.cs:15-19`), a collection-expression-initialized `IReadOnlyList<NavItem>` with two entries. "My Profile" points at [`IdentityRoutePaths`](#identityroutepaths)`.Profile` with a `Person` icon in `NavSection.User` and no required role, so every signed-in user sees it (`:17`). "Users" points at `IdentityRoutePaths.Users` with a `SupervisedUserCircle` icon, passes [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` as the `RequiredRole` positional argument, and sits in `NavSection.Admin` (`:18`), so the link is only rendered for organizers (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:5`, `:17`). Note that this hides the entry: the actual enforcement is server-side on [`UsersController`](#userscontroller), whose list endpoint demands [`IdentityPermissions`](#identitypermissions)`.UsersRead` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:125`). Menu gating is UX, not authorization.
  - Both entries pass `TitleResource: typeof(IdentityUIModule)`, which per the [`NavItem`](group-15-common-ui-framework.md#navitem) contract turns `"Nav.MyProfile"` and `"Nav.Users"` into *resource keys* resolved against this type's resources at render time, per circuit, so the menu follows the active culture; a missing key falls back to the raw string (`NavItem.cs:9-15`, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - `Assembly => typeof(IdentityUIModule).Assembly` (`:21`): the self-referencing assembly handle used for Blazor route discovery.
- **Why it's built this way**: a descriptor class is the smallest thing that can carry declarative metadata into DI. Because it is a plain sealed class with no dependencies, it registers as a singleton and costs nothing at runtime, while keeping the sidebar's Identity section owned by the Identity module rather than by the host.
- **Where it's used**: passed as the type argument to the framework's `AddUIModule<TModule>()` inside [`DependencyInjection.AddIdentityUI`](#dependencyinjection) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:23`). That one call does both jobs: it is the Scrutor scan root (`FromAssemblyOf<TModule>`) and the descriptor registration (`AddSingleton<IUIModule, TModule>`), at `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:152-162`.

### DependencyInjection
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:11` · Level 4 · class (static)

- **What it is**: the one-call registration entry point for the Identity UI layer. `AddIdentityUI()` wires the module's entity services, its bespoke user service, and its [`IdentityUIModule`](#identityuimodule) descriptor into any Blazor host.
- **Depends on**: [`IdentityUIModule`](#identityuimodule), [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice) from `MMCA.ADC.Identity.UI.Services` (`DependencyInjection.cs:2`), and the framework's `AddUIModule<TModule>()` extension from `MMCA.Common.UI` (`:3`); externals: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (`:1`).
- **Concept reinforced, the `extension(IServiceCollection)` registration block.** `[Rubric §15, Best Practices and Code Quality]` (assesses idiomatic, current-language composition) and `[Rubric §3, Clean Architecture]` (assesses that each layer owns its own wiring instead of the host reaching into it). This file is the UI-layer instance of the convention used across all four repos: instead of a classic `public static IServiceCollection AddX(this IServiceCollection services)`, the method lives inside a C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:13`) and the receiver is named once for the whole block, which the class doc calls out explicitly (`:7-10`). Callers see an ordinary `services.AddIdentityUI()`.
- **Walkthrough**: `AddIdentityUI()` (`DependencyInjection.cs:19-29`) does two things and returns `services` for chaining (`:28`).
  - `services.AddUIModule<IdentityUIModule>()` (`:23`), the shared two-step prologue every module's `Add{Module}UI()` opens with, with the intent restated in the comment above it (`:21-22`). Inside `MMCA.Common.UI` that single call runs the Scrutor scan over the descriptor's assembly, registering every [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) implementation `AsImplementedInterfaces` with a scoped lifetime, then registers the descriptor with `AddSingleton<IUIModule, TModule>` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-161`). Convention over configuration: a new standard CRUD-shaped UI service needs no registration edit here.
  - An explicit `services.AddScoped<IUserUIService, UserService>()` (`:26`). The comment above it (`:25`) explains why this one is hand-written: users are a custom contract, not an `IEntityService`, so the scan cannot pick it up (the same asymmetry [`IUserUIService`](#iuseruiservice) documents at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:7`, because the Users API returns [`UserListDTO`](#userlistdto) rather than the module's entity DTO).
- **Why it's built this way**: one host-facing method per module keeps the three hosts symmetric: they each call `AddIdentityUI()` and nothing else. The mix of a shared scan helper plus one explicit registration is deliberate, and the framework doc for `AddUIModule<TModule>()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:140-146`) records the ordering rationale: module-specific services are registered by the caller *after* the prologue, so a module whose service must win over a shared default still controls its own registration order.
- **Where it's used**: called by all three UI hosts, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:80` (Blazor Server), `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:60` (the WebAssembly client), and `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:94` (MAUI), which is what lets the same Razor Class Library render on web and mobile.
- **Caveats / not-in-source**: the Identity module ships one `DependencyInjection` class per layer (this UI one plus the API, Application, and Infrastructure copies covered in sibling parts of this chapter). They all slug to the bare `dependencyinjection` anchor, which resolves to the first occurrence in the assembled chapter, so cross-references disambiguate by layer in prose.

### ChangePasswordRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` · Level 1 · class (sealed)

- **What it is**: the FluentValidation rule set for a password change: the current password must be present, and the new password must clear the shared strength rules.
- **Depends on**: [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (the shared request DTO it validates), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest); externals: FluentValidation (`AbstractValidator<T>`, `RuleFor`, `Include`).
- **Concept introduced, the request validator that reaches the pipeline indirectly.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether cross-cutting concerns sit in the pipeline rather than inside handlers) and `[Rubric §11, Security]` (assesses that password strength is enforced at a boundary the caller cannot bypass). Nothing in ADC constructs this class: it is picked up by the convention scan in the Identity Application layer's `AddModuleIdentityApplication` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:47`, `ScanModuleApplicationServices<ClassReference>()`) and registered as `IValidator<ChangePasswordRequest>`. The Validating decorator, though, validates the *command*, not the request. The bridge is the framework's [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest) (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:19`), auto-registered for any command implementing `ICommandWithRequest<TRequest>`: it does `RuleFor(c => c.Request).SetValidator(validator)` (`CommandRequestValidator.cs:26`). [`ChangePasswordCommand`](#changepasswordcommand) declares that marker (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15`), so writing this one small validator is enough to put password rules in front of the handler with no wiring at all.
- **Walkthrough**: one constructor (`ChangePasswordRequestValidator.cs:13-19`).
  - `RuleFor(x => x.CurrentPassword).NotEmpty()` with the message "Current password is required." and the error code `User.CurrentPassword.Required` (`ChangePasswordRequestValidator.cs:15-16`). The explicit `WithErrorCode` matters: the API surfaces codes, not English text, so a client can branch on the code and a translator can own the message.
  - `Include(new StrongPasswordRules<ChangePasswordRequest>(x => x.NewPassword))` (`ChangePasswordRequestValidator.cs:18`). `Include` folds another rule set into this one against a selected property, so the framework owns "what counts as a strong password" in one place and every app inherits changes to it.
- **Why it's built this way**: the *current* password is deliberately only checked for presence here, never for strength. Its correctness is a credential comparison against the stored hash, which lives in [`ChangePasswordHandler`](#changepasswordhandler) via `ChangePasswordHandlerBase` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs`), and an old account may legitimately hold a password that no longer meets today's rules. Applying strength rules to it would lock those users out of the very screen that would fix the problem ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)).
- **Where it's used**: resolved as `IValidator<ChangePasswordRequest>` by `CommandRequestValidator<ChangePasswordCommand, ChangePasswordRequest>`, which the Validating decorator runs before [`ChangePasswordHandler`](#changepasswordhandler) for the `PUT auth/password` endpoint on [`AuthController`](#authcontroller).

### HttpContextExternalLoginEmailVerifier
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Authentication` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17` · Level 1 · class (sealed)

- **What it is**: the API-edge implementation of [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier). It answers one question during an in-flight OAuth callback: did the external provider assert that this login's email address is verified?
- **Depends on**: [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) (the Application-layer contract it satisfies), [`ExternalAuthExtensions`](group-12-api-hosting-mapping.md#externalauthextensions) for the `ExternalLogin` scheme name; externals: ASP.NET Core (`IHttpContextAccessor`, `HttpContext.AuthenticateAsync`, `ClaimsPrincipal.FindFirst`), BCL `bool.TryParse`.
- **Concept introduced, the fail-closed security probe implemented where the evidence lives.** `[Rubric §11, Security]` (assesses whether an authorization-relevant decision is made on evidence the caller does not control, and what happens when the evidence is missing) and `[Rubric §3, Clean Architecture]` (assesses whether the direction of dependency runs inward: the interface is declared in the Application layer at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`, and only this implementation knows about HTTP). The attack it exists to stop is spelled out at the call site (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:190-195`): auto-linking an external identity to an existing local account on nothing but an email match hands an attacker that account if the provider will issue tokens for an address it never confirmed. The verifier is therefore consulted **before** the link, and every uncertain answer is `false`.
- **Walkthrough**: a primary-constructor class taking one dependency (`HttpContextExternalLoginEmailVerifier.cs:17-18`) and exposing one method.
  - `EmailVerifiedClaimType` (`HttpContextExternalLoginEmailVerifier.cs:21`), the `internal const string "email_verified"`. `internal` rather than `private` so the claim name is nameable from the test assembly instead of being re-typed as a literal.
  - `IsCurrentExternalLoginEmailVerifiedAsync()` (`HttpContextExternalLoginEmailVerifier.cs:24-36`). It reads `httpContextAccessor.HttpContext` and returns `false` when there is none (`:26-30`), so a call outside a request reports unverified instead of throwing.
  - It then re-authenticates the short-lived `ExternalLogin` cookie (`:32`, `ExternalAuthExtensions.ExternalLoginScheme`, the constant at `MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:27`). That is the same principal `OAuthControllerBase.CompleteAsync` just authenticated (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:78`), so the claim is read from the provider's own freshly minted principal, never from anything a client supplied.
  - The tail collapses three failure modes into one expression (`:33-35`): a null principal, a missing claim, or a value that is not a parseable `true` all yield `false`, via `authenticateResult.Principal?.FindFirst(...)?.Value` plus `bool.TryParse(claimValue, out var verified) && verified`.
- **Why it's built this way**: the claim only exists because the Identity service host maps it. `services.PostConfigure<GoogleOptions>(...)` maps both the v3 `email_verified` key and the legacy v2 `verified_email` key onto the single `email_verified` claim (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:219-223`), and the comment above it records the consequence (`Program.cs:213-218`): GitHub's OAuth user payload asserts nothing, so a GitHub login reads as unverified by design and the link-by-email path is refused for it. Registration is `services.TryAddScoped<IExternalLoginEmailVerifier, HttpContextExternalLoginEmailVerifier>()` immediately after `AddHttpContextAccessor()` in `AddModuleIdentityAPI` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:54-55`), with the rationale for placing it in the API layer in the comment above (`DependencyInjection.cs:50-53`).
- **Where it's used**: injected into [`AuthenticationService`](#authenticationservice) (`AuthenticationService.cs:40`) and called from the external-login path when an account with that email already exists (`AuthenticationService.cs:196-197`). An unverified answer returns `Error.Unauthorized` with the code `Auth.ExternalEmailNotVerified` and a message steering the user back to the local credential flow (`AuthenticationService.cs:199-205`); only a verified answer reaches `existingUser.LinkExternalProvider(...)` (`AuthenticationService.cs:207`). The [`OAuthController`](#oauthcontroller) endpoints are the surface this runs behind.
- **Caveats / not-in-source**: which providers are registered, their scopes, and the callback URLs live in the Identity service host, not here. This type only reads a claim someone else mapped.

### IUserUIService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` · Level 1 · interface

- **What it is**: the client-side contract the Identity Blazor pages call for everything user-shaped: the organizer user list, account delete, and the three avatar operations on the signed-in user.
- **Depends on**: [`UserListDTO`](#userlistdto), the `UserIdentifierType` alias; BCL (`Task`, `Stream`, `CancellationToken`).
- **Concept introduced, the bespoke UI service contract (when the generic one does not fit).** `[Rubric §18, UI Architecture]` (assesses whether components talk to a typed abstraction instead of raw HTTP) and `[Rubric §9, API & Contract Design]`. The framework's default for a UI-to-API contract is [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype), which assumes a full CRUD resource whose DTO implements `IBaseDTO<TIdentifierType>`. The doc comment states plainly why users cannot use it (`IUserUIService.cs:5-10`): the users API returns [`UserListDTO`](#userlistdto), a projection with no `IBaseDTO` identity, and it exposes only list plus delete rather than the standard five verbs. Rather than bend the DTO to fit a generic contract, the module declares its own narrow interface. The UI registration documents the consequence: the assembly scan behind `AddUIModule<IdentityUIModule>()` only finds `IEntityService<,>` implementations, so this one is registered by hand on the next line (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:21-26`).
- **Walkthrough**: five members.
  - `GetPagedAsync(...)` (`IUserUIService.cs:16-25`) takes nullable `email`, `firstName`, `lastName`, `role` filters, `pageNumber`/`pageSize` defaulting to 1 and 10, and nullable `sortColumn`/`sortDirection`. It returns a tuple `(IReadOnlyList<UserListDTO> Items, int TotalItems)` rather than the wire's [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), so the page gets exactly the two things a `MudDataGrid` needs.
  - `DeleteAsync(UserIdentifierType userId, ...)` (`IUserUIService.cs:30`) returns `bool`; the doc records that the server requires owner-or-Organizer (UC-21), so the client never has to reason about the rule.
  - `GetMyAvatarUrlAsync` (`IUserUIService.cs:33`), `UploadMyAvatarAsync(Stream content, string fileName, string contentType, ...)` (`IUserUIService.cs:39`), and `RemoveMyAvatarAsync` (`IUserUIService.cs:42`), the BR-116a trio. Note the "my" naming: none of them take a user id, because the server derives the subject from the token. A client that cannot name another user's avatar cannot accidentally ask for one.
- **Why it's built this way**: an interface here is what lets the [`Profile`](#profile) and [`UserList`](#userlist) pages be tested with a fake instead of a live HTTP stack (`[Rubric §14, Testability]`), and it is the boundary that keeps `HttpClient`, retries, and JSON shapes out of the components entirely.
- **Where it's used**: implemented by [`UserService`](#userservice); injected into [`UserList`](#userlist) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:21`) and [`Profile`](#profile) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:17`); registered scoped in `AddIdentityUI` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:26`).

### ExportUserDataQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:12` · Level 2 · record (sealed)

- **What it is**: the request for a data-subject export (PRIVACY.md §7): which account to export, plus who is asking and with what role.
- **Depends on**: [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest), the `UserIdentifierType` alias.
- **Concept introduced, carrying the caller inside the query.** `[Rubric §11, Security]` (assesses whether authorization decisions are made on trusted, explicit inputs) and `[Rubric §5, Vertical Slice]` (assesses whether a use case owns its own request shape). Three positional members (`ExportUserDataQuery.cs:12-15`): `UserId`, `CurrentUserId`, and the nullable `CurrentUserRole`. The handler never reaches for `HttpContext`; the controller reads the claims once and puts them in the query ([`UsersController`](#userscontroller), `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:157-162`). That is what makes the whole use case testable without a web host, and it is why the ownership rule can live in the shared base rather than in a controller filter. Implementing [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest) is the load-bearing part: the framework's generic constraint is `where TQuery : IUserOwnedRequest` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:55`), so the shared [`UserOwnershipRule`](group-14-module-system-composition.md#userownershiprule) can read `UserId`, `CurrentUserId`, and `CurrentUserRole` off any app's query record (`ExportUserDataHandlerBase.cs:81-86`).
- **Walkthrough**: a positional record with an XML doc per parameter and nothing else (`ExportUserDataQuery.cs:5-15`). What it deliberately does **not** implement is as informative as what it does: it carries no `IQueryCacheable`, so the Caching decorator has nothing to act on. The base handler's remarks say why (`ExportUserDataHandlerBase.cs:42-45`): the document it produces is PII by design and must never be logged or cached.
- **Why it's built this way**: the nullable `CurrentUserRole` mirrors reality at the edge, where a role claim may simply be absent. The privilege check is therefore written to accept null and answer `false` rather than to assume a role exists ([`ExportUserDataHandler.HasExportPrivilege`](#exportuserdatahandler), `ExportUserDataHandler.cs:38`).
- **Where it's used**: constructed by [`UsersController`](#userscontroller) for `GET users/{userId}/export` (`UsersController.cs:149-162`) and handled by [`ExportUserDataHandler`](#exportuserdatahandler), which the controller receives as `IQueryHandler<ExportUserDataQuery, Result<UserDataExportDTO>>` (`UsersController.cs:34`).

### SelfHttpWarmupTask
> MMCA.ADC.Identity.Service · `MMCA.ADC.Identity.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:23` · Level 2 · class (sealed, internal)

- **What it is**: the Identity service's startup warm-up. Once Kestrel is listening, it replays the hot users read against the host's own cleartext endpoint so routing, authentication, and the middleware pipeline are JIT-compiled before the first real request arrives.
- **Depends on**: [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) from `MMCA.Common.Aspire.Warmup`; externals: ASP.NET Core (`IServer`, `IHostApplicationLifetime`, `IHostEnvironment`), `IConfiguration`, `ILogger<T>`.
- **Concept reinforced, the cold-start warm-up task ([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)).** `[Rubric §12, Performance & Scalability]` (assesses whether first-request latency after a scale-out or restart is managed rather than paid by a user) and `[Rubric §13, Observability & Operability]` (assesses that readiness reflects the instance's real ability to serve). The base class, taught in group-16, discovers the bound address, waits for `ApplicationStarted`, and issues the configured GETs; the runner registered by `AddWarmupReadiness()` keeps `/health/ready` not-ready until the task has had its chance, so the orchestrator does not route traffic into a cold instance. Failures are logged and fall back to lazy warm-up, so a warm-up problem degrades startup latency rather than blocking the service (`SelfHttpWarmupTask.cs:13-16`).
- **Walkthrough**: a primary-constructor class that forwards all five dependencies to the base (`SelfHttpWarmupTask.cs:23-29`) and overrides three members.
  - `Paths` (`SelfHttpWarmupTask.cs:33-36`), one entry: `users?pageNumber=1&pageSize=10`. The comment above it ties the string to reality (`SelfHttpWarmupTask.cs:31-32`): it is the exact shape [`UserService.GetPagedAsync`](#userservice) builds for the organizer list once the empty filter and sort values are dropped, leaving only the paging pair.
  - `Name => "SelfHttpWarmup"` (`SelfHttpWarmupTask.cs:39`) and `WarmupPaths => Paths` (`SelfHttpWarmupTask.cs:42`), the base's two abstractions.
  - `RequireSuccessStatusCode => false` (`SelfHttpWarmupTask.cs:49`), the one genuinely interesting override. [`UsersController`](#userscontroller) is `[Authorize]` plus `[HasPermission]`, so an unauthenticated self-request is refused by design and returns 401. The comment (`SelfHttpWarmupTask.cs:44-48`) makes the argument: the refusal still traverses Kestrel, routing, authentication, and the whole middleware pipeline, which is exactly where the cold-start JIT cost lives, so a 401 is the correct outcome and treating it as a failure would log a spurious warning on every single startup.
- **Why it's built this way**: the class doc (`SelfHttpWarmupTask.cs:6-17`) draws the contrast with Conference's task, which warms public read endpoints and therefore also populates the output cache. Identity has no anonymous read to warm, so this task buys pipeline JIT only, and it says so rather than pretending to prime a cache it cannot reach.
- **Where it's used**: registered with `services.AddWarmupTask<SelfHttpWarmupTask>()` in the Identity service host (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:187`), where the surrounding comment block (`Program.cs:183-186`) repeats the rationale for an operator reading the host file.
- **Caveats / not-in-source**: the base type decides how the bound address is discovered and whether the run is skipped under the Testing environment; this file only supplies the paths and the status-code policy.

### UserDeleted
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` · Level 2 · record (sealed)

- **What it is**: the in-process domain event the [`User`](#user) aggregate raises when an account is soft-deleted (BR-56). It carries the user id and nothing else.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the `UserIdentifierType` alias.
- **Concept reinforced, the domain event as an internal fact.** `[Rubric §4, DDD]` (assesses whether state changes that other code cares about are expressed as named domain facts instead of inferred from a database write) and `[Rubric §6, CQRS & Event-Driven]`. The distinction from an integration event is the one to keep straight, and this module makes it unusually concrete: there is a **second** `UserDeleted` record, in `MMCA.ADC.Identity.Shared.Users.IntegrationEvents`, carrying the same fact to other processes. A `BaseDomainEvent` such as this one is dispatched in-process by the framework's `DomainEventDispatcher` after `SaveChangesAsync` (deferred until after commit when a transaction is open), while a [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) leaves its outbox row unprocessed for the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to publish to the broker ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). Same `AddDomainEvent` call at the aggregate, two very different delivery paths, chosen purely by base type.
- **Walkthrough**: a one-line positional record, `public sealed record class UserDeleted(UserIdentifierType UserId) : BaseDomainEvent` (`UserDeleted.cs:10-12`). The id-only payload is deliberate: an in-process subscriber can load whatever else it needs from the same unit of work, and a fat payload would go stale between raise and dispatch.
- **Why it's built this way**: raising the event inside `User.Delete` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:370`) and only when the base soft-delete actually succeeded (`User.cs:367-369`) means a second delete on an already-deleted account raises nothing, so subscribers cannot see a duplicate fact. `Delete` also revokes the refresh token first (`User.cs:366`), so outstanding sessions die whether or not anybody listens to the event.
- **Where it's used**: raised by [`User.Delete`](#user) (`User.cs:364-374`) and asserted by the domain tests (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Users/UserInvariantsAndRoleTests.cs:255-263`).
- **Caveats / not-in-source**: no `IDomainEventHandler<UserDeleted>` exists anywhere in ADC source today. The doc comment names cascade cleanup and audit logging as the intended consumers (`UserDeleted.cs:6-7`), but that is an available extension point, not shipped behavior. The cross-process cleanup that *is* shipped travels on the Shared integration event of the same name, raised separately by [`DeleteUserHandler`](#deleteuserhandler); the two records are not connected in code.

### UserPasswordChanged
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` · Level 2 · record (sealed)

- **What it is**: the in-process domain event raised when a user's credentials are replaced (BR-204).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the `UserIdentifierType` alias.
- **Concept**: structurally identical to the domain [`UserDeleted`](#userdeleted), and the same domain-event-versus-integration-event distinction applies. What is worth noticing is the omission: the payload is the id only (`UserPasswordChanged.cs:9-11`), never the new hash or salt. A security-relevant event that carried credential material would turn every future subscriber, and every log line that serialized it, into a leak (`[Rubric §11, Security]`).
- **Walkthrough**: `public sealed record class UserPasswordChanged(UserIdentifierType UserId) : BaseDomainEvent` (`UserPasswordChanged.cs:9-11`).
- **Where it's used**: raised by [`User.ChangePassword`](#user) after the two credential invariants pass and the new hash and salt are assigned (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:329-332`), and asserted by the domain tests (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Users/UserTests.cs:200`).
- **Caveats / not-in-source**: like the domain [`UserDeleted`](#userdeleted), no handler subscribes to it in ADC source today. Session revocation on a password change is not driven from this event; refresh-token revocation is an explicit aggregate call (`User.RevokeRefreshToken`).

### NotificationUserDataExportSection
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/NotificationUserDataExportSection.cs:18` · Level 3 · class (sealed)

- **What it is**: the Notifications contribution to a data-subject export: the user's notification inbox rows, fetched from the Notification service and projected into the export's own DTO shape.
- **Depends on**: [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection) (the contract), [`UserDataExportSectionResult`](group-14-module-system-composition.md#userdataexportsectionresult), [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice) (the cross-service peer), [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto), [`UserDataExportNotificationDTO`](#userdataexportnotificationdto).
- **Concept introduced, the export section as a pluggable contributor.** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether a data-subject access request can actually be satisfied across every store that holds the subject's data) and `[Rubric §7, Microservices Readiness]` (assesses that a module reaches a peer through an interface it could satisfy in-process or over the wire). An access request is only as complete as the list of places that answer it, and in ADC those places are separate processes with separate databases. The framework's answer is a small interface, [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection) (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:20`), with a stable `SectionName` that appears verbatim in the document a subject reads (`IUserDataExportSection.cs:22-27`) and one `ExportAsync` per user. Sections accumulate through `AddUserDataExportSection<TSection>()`, which registers them scoped and via `TryAddEnumerable` so a double registration adds one entry (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:206-212`), and they are exported in registration order.
- **Walkthrough**: a primary-constructor class over one dependency (`NotificationUserDataExportSection.cs:18-19`).
  - `SectionName => "Notifications"` (`NotificationUserDataExportSection.cs:22`). Treat it as contract text, not a label: it is the key a subject (or a regulator) reads in the JSON.
  - `ExportAsync` (`NotificationUserDataExportSection.cs:25-46`) awaits `GetUserNotificationExportAsync(userId, ...)` on the peer (`:29-31`), then projects each row into a [`UserDataExportNotificationDTO`](#userdataexportnotificationdto) with `NotificationId`, `Title`, `SentOn`, `IsRead`, and `ReadOn` (`:35-42`), wrapped in a [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:10`). The re-projection is what keeps the exported wire shape owned by `Identity.Shared` rather than by whatever the peer happens to return today.
  - `UserDataExportSectionResult.Complete(SectionName, data)` (`:45`) closes it out. A user with an empty inbox produces an empty list and a `Complete` result, which is a truthful "nothing here" rather than the ambiguous "could not tell" an `Unavailable` would report (`IUserDataExportSection.cs:8-14`).
- **Why it's built this way**: the class doc (`NotificationUserDataExportSection.cs:12-15`) makes the omission explicit: transport failures are **not** caught here. Catching them locally would mean every section reinventing the degrade policy; letting them propagate one frame lets the base of [`ExportUserDataHandler`](#exportuserdatahandler) apply one policy to all sections (`[Rubric §29, Resilience & Business Continuity]`).
- **Where it's used**: registered second, after Engagement, in `AddModuleIdentityApplication` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:43`), which fixes its position in the document; the peer client is wired in the Identity service host with `services.AddNotificationUserExportClient()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:281`), resolving to the gRPC adapter (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:10`) outside the Notification process. Covered by `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/NotificationUserDataExportSectionTests.cs`.

### UserDeleted
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserDeleted.cs:24` · Level 3 · record (sealed)

- **What it is**: the cross-service announcement that an account has been erased (UC-21, BR-56). Same name as the Identity domain event above, different assembly, different delivery path, different job.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent), the `UserIdentifierType` alias.
- **Concept introduced, the erasure announcement, and why its payload is nearly empty.** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether an erasure reaches every store that holds the subject's personal data) and `[Rubric §11, Security]`. Two positional members only (`UserDeleted.cs:24-27`): `UserId` and `DeletedOn`. The doc comment gives the reason in one sentence (`UserDeleted.cs:16-20`): a downstream module reacting to an erasure already stores the scalar user id, and carrying a name or an email here would publish the very personal data the erasure exists to remove, onto a broker that persists messages. An erasure event that leaked PII would be self-defeating.
- **Walkthrough**: the interesting mechanics are not in the record, they are at the raise site. [`DeleteUserHandler`](#deleteuserhandler) calls `user.AddDomainEvent(new UserDeleted(command.UserId, timeProvider.GetUtcNow()))` inside `OnAfterSoftDeleteAsync`, **before** the erasure is saved (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:62`), and the comment above it spells out what that buys (`DeleteUserHandler.cs:56-61`): the outbox row is written by the very `SaveChangesAsync` that commits the soft-delete and the anonymization, so an account that is erased has always produced exactly one event, and an erasure that rolls back produces none. Publishing after the commit instead would leave a crash window in which the account is gone and the published name is not. The timestamp comes from the injected `TimeProvider`, not `DateTimeOffset.UtcNow`, so the handler stays testable.
- **Why it's built this way**: the doc comment (`UserDeleted.cs:10-15`) is explicit that this record does **not** replace the in-process domain [`UserDeleted`](#userdeleted): Engagement is a different process with its own database and never sees an Identity in-process dispatch. Two records carrying one fact is the honest modelling of a two-process reality, and the base type is the only thing that decides which path a raise takes ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Where it's used**: consumed by Engagement's [`UserDeletedPointsHandler`](group-22-engagement-module.md#userdeletedpointshandler) (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/UserDeletedPointsHandler.cs:36-38`), which takes the account off the public leaderboard and overwrites the [`LeaderboardOptIn`](group-22-engagement-module.md#leaderboardoptin) display name the attendee had published there, the one place Engagement holds a name rather than a scalar id (`UserDeletedPointsHandler.cs:13-21`). The subscription is wired in the Engagement service host with `x.RegisterIntegrationEventConsumer<UserDeleted>()` (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:302`). That handler is idempotent in both directions and deliberately does not swallow exceptions, so a failed erasure is retried by the outbox and the broker instead of being acked away with a log line (`UserDeletedPointsHandler.cs:22-28`).

### UserRegistered
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` · Level 3 · record (sealed)

- **What it is**: the cross-service announcement that a new account exists. It carries the database-generated user id plus the identity fields another context needs to match on, and it is the event that drives the BR-207 speaker auto-link.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent), the `UserIdentifierType` alias.
- **Concept introduced, the integration event as a published contract.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether contexts collaborate through facts rather than commands), `[Rubric §7, Microservices Readiness]` (assesses that the producer does not know its consumers), and `[Rubric §9, API & Contract Design]`. Three properties of this record make it a contract rather than an internal message. It lives in `Shared`, the assembly a consumer may reference without touching Identity's Domain or Application. It carries denormalized primitives (`string Email`, `string Role`) rather than the [`Email`](group-02-domain-building-blocks.md#email) value object or [`UserRole`](#userrole), so a subscriber needs no Identity types to deserialize it. And it is a `record` with positional members, so adding an optional member later is an additive change consumers can ignore ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)).
- **Walkthrough**: five positional members (`UserRegistered.cs:23-29`): `UserId`, `Email`, `FirstName`, `LastName`, `Role`. `Email` is the field the auto-link actually matches on; the two name fields exist so a subscriber can report candidates without a call back into Identity.
- **Why it's built this way**: the ordering problem is the whole story. The id is a database-generated identity column, so the event cannot be raised inside [`User.Create`](#user) (the factory remarks say so outright, `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:149-155`): the id is still `default` at that point, and the outbox serializes the payload at capture time, so it would persist `UserId = 0`, which the cross-service consumer cannot resolve (`AuthenticationService.cs:22-25`). Instead [`AuthenticationService`](#authenticationservice) wraps the base registration workflow in a single transaction (`AuthenticationService.cs:57-63`), then in `OnUserRegisteredAsync` raises the event on the already-persisted aggregate and saves a second time (`AuthenticationService.cs:112-117`). The first save populates the real id; the second save writes the outbox row; both are inside one transaction, so the user and the event commit atomically. The remarks on that override (`AuthenticationService.cs:103-111`) name the consequence honestly: this is eventual consistency, and the token handed back to the just-registered user does not yet carry the `speaker_id` claim. The same raise happens for brand-new external OAuth users (`AuthenticationService.cs:230-238`).
- **Where it's used**: consumed by Conference's [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler), which runs the email-match speaker auto-link and publishes `SpeakerLinkedToUser` back so Identity can set `User.LinkedSpeakerId`; Identity registers the consumers for that return event in its own host (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:299-300`).
- **Caveats / not-in-source**: the type's own doc comment says the event is "Published by `AuthenticationService` AFTER the unit-of-work commit" (`UserRegistered.cs:6-8`), which no longer describes the mechanism: current source raises it via `AddDomainEvent` on the aggregate after the first save so the outbox row commits in the same transaction (`AuthenticationService.cs:114-115`). The code is ground truth here; the doc comment predates the atomicity fix described at `AuthenticationService.cs:21-33`.

### UserService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:14` · Level 3 · class (sealed)

- **What it is**: the HTTP implementation of [`IUserUIService`](#iuseruiservice). It builds the query string, attaches the bearer token, applies the shared retry policy, and turns responses into the tuples and strings the pages consume.
- **Depends on**: [`IUserUIService`](#iuseruiservice), [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase), [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); externals: `IHttpClientFactory`, `System.Net.Http.Json`, `MultipartFormDataContent`.
- **Concept reinforced, the authenticated client service.** `[Rubric §18, UI Architecture]` and `[Rubric §26, Front-End Security]` (assesses that tokens are attached by one audited helper rather than by each caller). The base class supplies `CreateAuthenticatedClientAsync()` and `RetryPolicy`, so every method here follows the same three-step shape: create a token-bearing client, execute through the retry policy, then translate the response. The token never appears in this file, which is the point.
- **Walkthrough**: five methods over a single `Endpoint = "users"` constant (`UserService.cs:17`).
  - `GetPagedAsync` (`UserService.cs:19-64`) puts all eight parameters into a dictionary, drops the null or whitespace entries, and URL-encodes the survivors with `Uri.EscapeDataString` (`UserService.cs:30-44`). That filter is why [`SelfHttpWarmupTask`](#selfhttpwarmuptask) warms exactly `users?pageNumber=1&pageSize=10`: with no filters set, only the paging pair survives. Non-success responses go through `ServiceExceptionHelper.ThrowIfDomainExceptionAsync`, which rethrows a server `ProblemDetails` as a typed domain exception before the blunt `EnsureSuccessStatusCode` (`UserService.cs:53-56`). The body deserializes as `PagedCollectionResult<UserListDTO>` and is flattened to `(Items, TotalItemCount)` with null-coalescing defaults, so a null body reads as an empty page rather than a crash (`UserService.cs:58-63`).
  - `DeleteAsync` (`UserService.cs:66-82`) builds `users/{id}` with `CultureInfo.InvariantCulture` (an id must never be culture-formatted), retries, translates failures the same way, and returns `true`.
  - `GetMyAvatarUrlAsync` (`UserService.cs:84-96`) is the one method that swallows failure: any non-success status returns `null` (`UserService.cs:91-92`), because "no avatar" and "could not fetch the avatar" render identically as the fallback initials, and a toast would be noise on a profile page load.
  - `UploadMyAvatarAsync` (`UserService.cs:98-121`) posts a `MultipartFormDataContent` with one `file` part carrying the caller's content type. It deliberately does **not** use the retry policy, and the comment says why (`UserService.cs:106`): the content stream is single-shot, since file-picker and file-input streams do not rewind, so a retry would post an empty body. This is the sharpest example in the module of a resilience policy being wrong for a specific call (`[Rubric §29, Resilience & Business Continuity]`).
  - `RemoveMyAvatarAsync` (`UserService.cs:123-135`) deletes and returns the success flag.
- **Why it's built this way**: manual query-string assembly, rather than a typed query object, keeps the client honest about what the API actually accepts, and returning plain tuples and strings instead of [`Result`](group-01-result-error-handling.md#result) matches the UI layer's convention of surfacing failures as exceptions that [`ListPageActions`](#listpageactions) and the page code map to snackbars.
- **Where it's used**: registered as `IUserUIService` in `AddIdentityUI` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:26`) and consumed by [`UserList`](#userlist) and [`Profile`](#profile) through the interface, so the same code runs on Blazor Server, WebAssembly, and MAUI.

### EngagementUserDataExportSection
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/EngagementUserDataExportSection.cs:19` · Level 4 · class (sealed)

- **What it is**: the Engagement contribution to a data-subject export: session bookmarks, submitted session questions, the points ledger, check-in history, and leaderboard participation, read from the Engagement service and projected into the export's DTOs.
- **Depends on**: [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection), [`UserDataExportSectionResult`](group-14-module-system-composition.md#userdataexportsectionresult), [`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice), [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) and its four row types ([`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), [`UserDataExportSubmittedQuestionDTO`](#userdataexportsubmittedquestiondto), [`UserDataExportPointsEntryDTO`](#userdataexportpointsentrydto), [`UserDataExportCheckInDTO`](#userdataexportcheckindto)).
- **Concept reinforced, the export section (introduced at [`NotificationUserDataExportSection`](#notificationuserdataexportsection)), here at its widest.** `[Rubric §30, Compliance, Privacy & Data Governance]` and `[Rubric §9, API & Contract Design]`. Everything structural is identical to its sibling: a primary constructor over one peer interface, a constant `SectionName` (`EngagementUserDataExportSection.cs:23`), one `ExportAsync`, and no local try/catch (`EngagementUserDataExportSection.cs:12-16`). What differs is breadth, five collections instead of one, which is what makes its two projection comments worth reading.
- **Walkthrough**: `ExportAsync` (`EngagementUserDataExportSection.cs:26-71`) makes a single peer call (`:30-32`) and then assembles one section DTO (`:34-68`).
  - `Bookmarks` (`:36-40`) and `SubmittedQuestions` (`:41-46`) project scalar ids plus `CreatedOn`. No session or question titles are pulled across: Engagement stores ids, and the export is truthful about what Engagement actually holds.
  - `PointsEntries` (`:47-55`) converts `ActivityType` with `.ToString()`, and the comment says why (`:49-50`): the export document is read by the data subject, so an activity travels as its readable name rather than an enum number. That is a real API-design decision, because it means renaming an enum member changes an externally visible document.
  - `CheckIns` (`:56-65`) applies the same rule to `Scope` (`:57-59`) and carries the nullable `EventId`, `SessionId`, and `SponsorId` alongside `CheckedInOn`, which is what makes the three check-in scopes distinguishable in the output.
  - `IsOnLeaderboard` and `LeaderboardDisplayName` (`:66-67`) close the section. Those are the same two facts Engagement's [`UserDeletedPointsHandler`](group-22-engagement-module.md#userdeletedpointshandler) erases on account deletion, which is the neat symmetry of this module: access and erasure operate on the identical set of data.
  - `UserDataExportSectionResult.Complete(SectionName, data)` (`:70`).
- **Why it's built this way**: registration order is document order, and Engagement is registered first (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:38-43`), with the comment above the two calls recording that this is deliberate rather than incidental. Stable ordering means an exported document can be diffed across runs.
- **Where it's used**: the peer client is wired in the Identity service host with `services.AddEngagementUserExportClient()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:280`), which resolves to the gRPC adapter outside the Engagement process (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:12`). The host comment states the coupling explicitly (`Program.cs:276-279`): both calls are best-effort consumers, so Identity's startup never waits on either peer. Covered by `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/EngagementUserDataExportSectionTests.cs`.

### RegisterRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:12` · Level 7 · class (sealed)

- **What it is**: the rule set for a registration request: a well-formed email within the domain's length limit, a strong password, required first and last names, and an optional address that is validated only when present.
- **Depends on**: [`RegisterRequest`](group-08-auth.md#registerrequest), [`EmailRules<T>`](group-06-validation.md#emailrulest), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest), [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), [`AddressValidator`](group-06-validation.md#addressvalidator), [`UserInvariants`](#userinvariants); externals: FluentValidation.
- **Concept reinforced, composing shared rule sets, and tying them to the domain's constants.** `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §15, Best Practices & Code Quality]`. This validator is almost entirely `Include` calls: the four reusable rule sets from `MMCA.Common.Application.Validation` carry the actual logic, and this class only chooses which property each applies to. The detail worth copying is that the length arguments are not literals: `UserInvariants.EmailMaxLength`, `UserInvariants.FirstNameMaxLength`, and `UserInvariants.LastNameMaxLength` (`RegisterRequestValidator.cs:16,18,19`) come straight from the aggregate's own rules. A request can therefore never be accepted at the edge and then rejected by the domain for a length the API thought was fine.
- **Walkthrough**: one constructor (`RegisterRequestValidator.cs:14-24`).
  - `EmailRules<RegisterRequest>(x => x.Email, "Email", UserInvariants.EmailMaxLength)` (`RegisterRequestValidator.cs:16`): presence, format, and length, with "Email" as the display name in messages.
  - `StrongPasswordRules<RegisterRequest>(x => x.Password)` (`RegisterRequestValidator.cs:17`), the same complexity policy [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) applies to a new password.
  - Two `RequiredStringRules<RegisterRequest>` for the names (`RegisterRequestValidator.cs:18-19`).
  - The conditional address rule (`RegisterRequestValidator.cs:21-23`): `RuleFor(x => x.Address).SetValidator(new AddressValidator()!).When(x => x.Address is not null)`. `When` is what makes the address genuinely optional: omitting it is valid, supplying a malformed one is not.
- **Why it's built this way**: registration is anonymous and internet-facing, so it is the most hostile input surface in the module. Composing framework-owned rule sets means a tightening of the shared password policy applies here without a code change (`[Rubric §11, Security]`).
- **Where it's used**: auto-registered as `IValidator<RegisterRequest>` by `ScanModuleApplicationServices<ClassReference>()` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:47`) and injected into [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators) as its `Register` member (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:18,25`), which [`AuthenticationService`](#authenticationservice) receives through its base and runs at the top of the registration workflow. The endpoint is `POST auth/register` on [`AuthController`](#authcontroller).

### ExportUserDataHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:30` · Level 9 · class (sealed)

- **What it is**: ADC's data-subject export handler. It is a thin subclass of the framework's export workflow that answers exactly two app-specific questions: which role may export somebody else's account, and which of the account's own fields count as portable personal data.
- **Depends on**: [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery), [`User`](#user), [`ExportUserDataQuery`](#exportuserdataquery), [`UserRole`](#userrole), [`UserDataExportSubjectDTO`](#userdataexportsubjectdto), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IUserDataExportSection`](group-14-module-system-composition.md#iuserdataexportsection); externals: `TimeProvider`, `ILogger<T>`.
- **Concept introduced, the template-method handler where the app supplies only its vocabulary.** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether access and portability are implemented once and identically everywhere), `[Rubric §2, Design Patterns]` (template method), and `[Rubric §1, SOLID]` (the base is closed for modification and open through three protected hooks). The base (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49`) owns the whole workflow: the owner-or-privileged-role check via `UserOwnershipRule.CheckOwnership`, returning a `User.ExportForbidden` error (`ExportUserDataHandlerBase.cs:81-90`), a no-tracking load through `GetReadRepository` with `Error.NotFound` when the account is gone (`:92-98`), the subject snapshot, the section fan-out (`:104-108`), and the envelope stamped with `FormatVersion` "1.0" and a `GeneratedOn` from `TimeProvider` (`:61`, `:110-117`). Two of those choices carry real weight. The fan-out is sequential on purpose, because sections share the scoped unit of work and its `DbContext`, which is not thread-safe, and because registration order is the published order of the document (`:102-103`). And each section runs inside its own try/catch (`:173-198`) that degrades a failing section to `Available = false` with a deliberately generic reason, sending the exception detail to the log and never to the subject (`:187-197`); `OperationCanceledException` is explicitly excluded, because a cancelled request is not a degraded one.
- **Walkthrough**: a primary constructor forwarding four dependencies to the base (`ExportUserDataHandler.cs:30-35`) and two overrides.
  - `HasExportPrivilege(string? currentUserRole) => UserRole.IsOrganizer(currentUserRole)` (`ExportUserDataHandler.cs:38`). One line, and the case-insensitive comparison lives inside [`UserRole.IsOrganizer`](#userrole) rather than here, so a claim with unexpected casing cannot silently deny an organizer.
  - `BuildSubjectSnapshotAsync` (`ExportUserDataHandler.cs:41-77`) guards its argument (`:46`) and projects the aggregate into a [`UserDataExportSubjectDTO`](#userdataexportsubjectdto): identity and profile fields, `IsExternalLogin` and `LoginProvider`, `LinkedSpeakerId`, `AvatarUrl`, the seven MAUI device fields, and the two audit timestamps (`:48-73`). What is **absent** is the point: no `PasswordHash`, no `PasswordSalt`, no refresh token, no external `ProviderKey`. The class doc states the principle (`ExportUserDataHandler.cs:16-19`) and the base repeats it (`ExportUserDataHandlerBase.cs:132-135`): credentials are secrets, not portable personal data, and a portability right is not a right to a copy of your own password hash.
  - The timestamp handling is the subtle bit (`ExportUserDataHandler.cs:67-73`). SQL Server hands audit timestamps back as `Kind=Unspecified`, and the DTO documents them as UTC but serializes them without a `Z` marker in that state, so `DateTime.SpecifyKind(..., DateTimeKind.Utc)` only restores the marker on a value that was already UTC. `LastModifiedOn` is null-checked first, since a never-updated account has none.
  - The method returns `Task.FromResult<object?>(subject)` (`:76`): the hook is asynchronous because some apps read a second aggregate for the snapshot, and ADC does not need to.
- **Why it's built this way**: the handler needs no DI registration of its own. `ScanModuleApplicationServices<ClassReference>()` finds it through the base class's `IQueryHandler<TQuery, Result<UserDataExportDTO>>` implementation, which the Identity DI comment records explicitly (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:40-41`) and a dedicated test pins (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataRegistrationTests.cs:19`, with a second test at `:34` asserting that section registration order is preserved). Best-effort section aggregation is the same posture the module takes for the best-effort live-channel publish (`ExportUserDataHandler.cs:23-28`): one peer outage costs the subject one section, never the whole document (`[Rubric §29, Resilience & Business Continuity]`).
- **Where it's used**: injected into [`UsersController`](#userscontroller) as `IQueryHandler<ExportUserDataQuery, Result<UserDataExportDTO>>` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:34`) and invoked from `GET users/{userId}/export`, which maps the handler's failures to 403 or 404 (`UsersController.cs:149-168`). Covered by `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataHandlerTests.cs`.
- **Caveats / not-in-source**: ADC does not override `OnExportCompletedAsync`, the base's post-assembly hook for an access-log row or a metric (`ExportUserDataHandlerBase.cs:159-164`), so an export leaves no application-level audit record beyond ordinary request logging.

### UserClaimsController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` · Level 4 · class (sealed)

- **What it is**: a single read-only endpoint that echoes the authenticated caller's JWT claims back as a JSON object (UC-10). It is the "who does the server think I am" diagnostic.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase); externals: ASP.NET Core MVC (`[ApiController]`, `[Authorize]`, `HttpContext.User`), Asp.Versioning.
- **Concept reinforced, the thin diagnostic controller.** `[Rubric §13, Observability & Operability]` assesses whether an operator can inspect live state without attaching a debugger, and `[Rubric §11, Security]` covers what such a surface is allowed to reveal. The security property to notice is that the endpoint reflects only `HttpContext.User` (`UserClaimsController.cs:27`), the principal the authentication middleware already built from the presented token. It reads nothing from the database and accepts no id, so the worst a caller can learn is what they already hold. `[Authorize]` (`UserClaimsController.cs:15`) makes an anonymous call a 401 rather than an empty object.
- **Walkthrough**: one action, `GetClaims()` (`UserClaimsController.cs:25-38`). It groups the principal's claims by type (`UserClaimsController.cs:27-28`) and projects each group into a dictionary entry whose value is either the single string or the list of strings (`UserClaimsController.cs:33-34`). That collapse is what makes the JSON pleasant: single-valued claims such as `user_id` or `email` serialize as scalars, while a genuinely repeated claim stays an array instead of being silently truncated. The doc comment (`UserClaimsController.cs:18-21`) names the expected set: `user_id`, `email`, `role`, and the optional `speaker_id`.
- **Why it's built this way**: routing is `[Route("[controller]")]` (`UserClaimsController.cs:13`), so the resource is `/userclaims`, and `[ApiVersion("1.0")]` (`UserClaimsController.cs:14`) puts it under the same header-based versioning as every other ADC endpoint ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)). Returning `ActionResult` with an anonymous dictionary rather than a named DTO is a deliberate exception to the module's DTO discipline: the payload is by definition whatever claims the token happens to carry, so there is no stable shape to name. The two `ProducesResponseType` entries (`UserClaimsController.cs:23-24`) therefore declare status codes only.
- **Where it's used**: reachable through the Gateway alongside the other Identity endpoints; it is a support and debugging surface rather than something the ADC UI calls in a normal flow.

### UserRole
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` · Level 4 · class (sealed)

- **What it is**: the closed set of ADC roles as a value object: `Organizer`, `Attendee`, and `ContentEditor`, with case-insensitive parsing, validation, and equality.
- **Depends on**: [`RoleValue`](group-08-auth.md#rolevalue) (the shared base), [`RoleNames`](group-08-auth.md#rolenames) (the string constants), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); externals: `System.Collections.Frozen.FrozenDictionary`.
- **Concept introduced, the closed-set value object over a persisted string.** `[Rubric §4, DDD]` assesses whether concepts with rules get a type instead of a bare primitive, and `[Rubric §2, Design Patterns]` covers the shared-base factoring. The base [`RoleValue`](group-08-auth.md#rolevalue) supplies case-insensitive value equality, hashing, and validation once for both apps; this type only fixes the ADC role set, and the class remarks say so (`UserRole.cs:11-16`). Note what it is *not*: an `enum`. The [`User`](#user) aggregate stores `Role` as a `string` (`User.cs:57`) so EF maps a plain column and a JWT claim round-trips without conversion, while every place that reasons about roles goes through this type. That combination, primitive at rest and typed in the domain, is the pattern [ADR-068](https://ivanball.github.io/docs/adr/068-value-objects-as-validated-primitives.html) describes.
- **Walkthrough**
  - The three static instances (`UserRole.cs:20`, `:23`, `:30`), each built from a [`RoleNames`](group-08-auth.md#rolenames) constant so the domain and the auth layer cannot drift apart. The `ContentEditor` doc (`UserRole.cs:25-29`) is worth reading: it defines the role as a strict capability subset of Organizer, able to curate sessions, speakers, and categories but not to change event structure, rooms, feedback questions, run session selection, or read the user list.
  - `AllByValue` (`UserRole.cs:32-33`), a `FrozenDictionary<string, UserRole>` built once by the base's `BuildLookup`. Frozen dictionaries trade a slower build for faster reads, which is exactly right for a table that is populated at type-init and then read on every authorization check (`[Rubric §12, Performance & Scalability]`).
  - `All` (`UserRole.cs:44`) exposes the values; the private constructor (`UserRole.cs:35-38`) makes the three statics the only instances that can exist.
  - `FromString(string role)` (`UserRole.cs:51-58`) is the Result-returning parse: a hit returns `Result.Success`, a miss returns `Error.Invariant` with the code `User.Role.Invalid`. `role ?? string.Empty` (`UserRole.cs:52`) means a null argument is a clean validation failure, not a `NullReferenceException`.
  - `IsValid(string role)` (`UserRole.cs:65`) is the boolean form used by [`UserInvariants.EnsureRoleIsValid`](#userinvariants).
  - `IsOrganizer(string? role)` (`UserRole.cs:76`) compares with `StringComparison.OrdinalIgnoreCase`, and its doc explains the trap it exists to avoid (`UserRole.cs:67-75`): a raw claim string may carry any casing, and `role == UserRole.Organizer` would go through the implicit string conversion and compare *ordinally*, quietly failing on `"organizer"`. This is an authorization-relevant helper, so the subtlety is load-bearing (`[Rubric §11, Security]`).
  - The equality surface (`UserRole.cs:78-90`) and the implicit `string` conversion with its `ToString` alternate (`UserRole.cs:94-98`), which is what lets the type flow into string-typed APIs such as the `role` parameter of [`User.Create`](#user).
- **Why it's built this way**: a `FromString` returning `Result<UserRole>` instead of throwing keeps role parsing on the same error channel as every other validation in the codebase ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)), and keeping the role set in the Domain assembly means the invariant "a user's role is one of these three" is enforced where the aggregate lives, not at the API edge.
- **Where it's used**: by [`UserInvariants.EnsureRoleIsValid`](#userinvariants) (`UserInvariants.cs:65`), by [`User`](#user)'s parameterless constructor default and `CreateExternal` (`User.cs:127`, `:223`), by [`AuthenticationService`](#authenticationservice) for the BR-45 attendee default, and by the handlers that gate owner-or-Organizer access, such as [`DeleteUserHandler`](#deleteuserhandler), whose whole `HasDeletePrivilege` override is `UserRole.IsOrganizer(currentUserRole)` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:42-43`), and [`ExportUserDataHandler`](#exportuserdatahandler).

### ListPageActions
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Common` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Common/ListPageActions.cs:13` · Level 6 · class (static)

- **What it is**: two static helpers that every ADC list page shares: reload whichever layout (mobile list or desktop grid) is currently rendered, and run the confirm-delete-toast-reload flow.
- **Depends on**: [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and the `DeleteConfirmation` dialog component from `MMCA.Common.UI.Components`; externals: MudBlazor (`MudDataGrid<T>`, `ISnackbar`, `Severity`).
- **Concept introduced, the ADC-side shared UI helper and where it is allowed to live.** `[Rubric §16, Maintainability]` assesses whether a repeated flow exists once, and `[Rubric §24, Forms, Validation & UX Safety]` assesses that destructive actions confirm first and that failures surface to the user. The class comment (`ListPageActions.cs:6-12`) explains the placement, which is the interesting part: Identity.UI is the root of the module UI reference chain (Conference.UI references Identity.UI, Engagement.UI references Conference.UI), so it is the only ADC UI project every other module UI project can see. Putting the helper here avoids inventing a fifth shared UI assembly, and it is why a Conference page such as `SpeakerList` calls into an Identity type without that being a layering violation.
- **Walkthrough**: two methods, both static and generic over the row DTO.
  - `ReloadActiveLayoutAsync<TDto>(bool isMobile, MobileInfiniteScrollList<TDto>? mobileList, MudDataGrid<TDto>? dataGrid)` (`ListPageActions.cs:24-37`). If the mobile layout is active and its ref is bound, it calls `mobileList.ResetAsync()` (`:31`); otherwise it calls `dataGrid.ReloadServerData()` when that ref is bound (`:35`). Both refs are nullable by design: only one layout is in the render tree at a time, so the other `@ref` is null, and the null checks are the mechanism rather than defensive noise (`[Rubric §22, Responsive & Cross-Browser]`).
  - `DeleteWithConfirmationAsync(...)` (`ListPageActions.cs:51-86`) takes the page's `DeleteConfirmation` ref, the entity display name, the delete call, the snackbar, a localized success message, a failure-to-message mapper, and the reload callback. It guards every reference argument with `ArgumentNullException.ThrowIfNull` (`ListPageActions.cs:60-64`), shows the dialog, and returns immediately unless the result is exactly `true` (`ListPageActions.cs:66-70`): a dialog dismissed with `null` is a cancel, not a confirm. On confirm it awaits the delete, toasts success, and reloads (`ListPageActions.cs:74-76`).
  - The two-catch tail is the subtle part (`ListPageActions.cs:78-85`). `OperationCanceledException` is swallowed with a comment naming the two causes: component disposal, and the InteractiveAuto render-mode transition where a Server-rendered circuit is torn down as WebAssembly takes over. Any other exception is mapped through the caller's `errorMessage` delegate and toasted at `Severity.Error` (`ListPageActions.cs:84`), so a failed delete is visible rather than silent.
- **Why it's built this way**: passing the localized strings and the error mapper in as parameters keeps this class free of any resource dependency, so each page supplies its own translated text ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) while the flow itself stays identical everywhere.
- **Where it's used**: twelve pages in current source. Identity's [`UserList`](#userlist) uses both methods (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:39`, `:76-83`); the Conference UI calls them from `EventList`, `SessionList`, `SpeakerList`, `RoomList`, `QuestionList`, `ConferenceCategoryList`, `SponsorList`, `PublicEventList`, `PublicSessionListView`, and `PublicSpeakerList`; and the Engagement UI calls them from `AttendeeSearchPanel`. That last caller is the proof the placement argument holds: Engagement.UI reaches this type transitively, without a direct reference to Identity.UI's pages.

### Profile
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.Profile` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15` · Level 6 · class (partial)

- **What it is**: the code-behind for the "My Profile" page at `/profile`: the signed-in user's three self-service actions in one component, namely set or remove the avatar, change the password, and delete the account.
- **Depends on**: [`IUserUIService`](#iuseruiservice), [`IAuthUIService`](group-15-common-ui-framework.md#iauthuiservice), [`IMediaPickerService`](group-26-device-capability-layer.md#imediapickerservice) and [`PickedMedia`](group-26-device-capability-layer.md#pickedmedia), plus Blazor's `AuthenticationStateProvider`, `NavigationManager`, `InputFileChangeEventArgs`, and MudBlazor's `ISnackbar` / `MudForm` / `MudMessageBox` (`Profile.razor.cs:1-22`). The localizer `L` is injected in the markup half (`Profile.razor:3`), which is also where the route and the `[Authorize]` attribute live (`Profile.razor:1-2`).
- **Concept introduced (1), the cross-head capability branch.** `[Rubric §22, Responsive & Cross-Browser]` assesses whether one component genuinely serves different hosts. The same page runs in the Blazor web head and inside the MAUI hybrid, and the avatar affordance differs: the markup branches on `MediaPicker.IsSupported` (`Profile.razor:46`) to offer "choose photo" plus "take photo" buttons on a native head, and falls back to a hidden `<InputFile accept="image/jpeg,image/png,image/webp">` behind a label-styled button on the web (`Profile.razor:57-66`). Both branches converge on one private method, `UploadAvatarStreamAsync` (`Profile.razor.cs:154-165`), so the upload contract is written once. That convergence is also why [`IUserUIService`](#iuseruiservice)'s upload method is typed on a raw `Stream` rather than on a framework-specific file type.
- **Concept introduced (2), the component-scoped `CancellationTokenSource`.** `[Rubric §18, UI Architecture]`. The page holds `private readonly CancellationTokenSource _cts = new()` (`Profile.razor.cs:27`), passes `_cts.Token` into every service call, and cancels plus disposes it through the standard disposable pattern (`Profile.razor.cs:277-295`). Every async entry point then catches `OperationCanceledException` separately from `Exception` and deliberately does nothing (`Profile.razor.cs:68-71`, `:103-106`, `:140-143`, `:182-185`, `:229-232`, `:263-266`), with the comment naming the two causes: component disposal and an InteractiveAuto render-mode transition. A user who navigated away must not be shown a red error toast for a request that was cancelled on their behalf; a genuine failure still toasts.
- **Walkthrough**
  - `OnInitializedAsync` (`Profile.razor.cs:55-80`): awaits `AuthStateProvider.GetAuthenticationStateAsync()`, reads the `user_id` claim and parses it (`:61-62`). The page identifies its subject from the token, never from a route parameter, which is what makes it structurally incapable of acting on another account. Only when the claim parses does it fetch the avatar URL (`:65`). `_isLoading` is cleared in `finally` (`:78`), so a failed load still renders the error state rather than a permanent spinner.
  - Client-side avatar guard (`:24-25`, `:125-129`): `MaxAvatarBytes = 2 * 1024 * 1024`, and the browser path rejects an oversized file with a `Severity.Warning` toast before any bytes leave the machine. The doc comment says exactly what this is: a mirror of the server's BR-116a limit, not the enforcement point. The server re-checks in [`UsersController`](#userscontroller) and again in [`SetUserAvatarHandler`](#setuseravatarhandler).
  - Avatar paths: `PickAvatarAsync` and `CaptureAvatarAsync` (`:86-88`) both funnel through `UploadPickedMediaAsync` (`:90-115`), which disposes the [`PickedMedia`](group-26-device-capability-layer.md#pickedmedia) with `using` (`:95`) and returns silently when the user cancelled the picker (`media is null`, `:96-99`). The browser path `OnBrowserInputChangedAsync` (`:117-152`) opens the stream with `file.OpenReadStream(MaxAvatarBytes, _cts.Token)` (`:134`) and wraps it in `await using` so the read stream is released even on failure. `UploadAvatarStreamAsync` (`:154-165`) treats a `null` return from the service as a failure toast and only assigns `_avatarUrl` on success.
  - `RemoveAvatarAsync` (`:167-194`): a boolean-returning call whose `false` branch toasts the same error as a thrown exception (`:179`, `:188`), so the user sees one consistent outcome for "did not work".
  - Password form (`:34-49`, `:196-241`): two local validators, `ValidateNewPassword` (minimum length 8, `:43-44`) and `ValidateConfirmPassword` (ordinal equality against `_newPassword`, `:46-49`), both returning `null` for an empty value so the field's own `Required` rule owns the "missing" message instead of stacking two errors. `SavePasswordAsync` runs `form.ValidateAsync()` and returns early when invalid (`:205-209`), so a shape error costs no round trip; the errors also render as a list inside a `MudAlert` summary (`Profile.razor:98-109`). On success it resets the form and clears all three fields (`:218-221`). `[Rubric §24, Forms, Validation & UX Safety]`: this is client-side validation as an ergonomics layer over, never instead of, the server rules that live in [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) and [`ChangePasswordHandler`](#changepasswordhandler).
  - `DeleteAccountAsync` (`:243-275`): guards on a known `_userId` (`:245-249`), shows the `MudMessageBox` and aborts unless the answer is exactly `true` (`confirmed is not true`, `:251-253`, so cancel and dismiss both abort), then deletes, calls `AuthService.LogoutAsync()`, toasts, and navigates to `/` with `forceLoad: true` (`:258-261`). The forced load matters: the account is gone, so the circuit and every piece of cached client state must be rebuilt from scratch rather than kept alive against a dead identity.
- **Why it's built this way**: keeping avatar, password, and deletion on one page mirrors the account-level scope of all three (each acts on the caller and only the caller), and every action ends in a snackbar with a localized message, so the page needs no bespoke error surface. `[Rubric §21, Accessibility]`: the markup carries an explicit `aria-label` on the `MudAvatar` (`Profile.razor:32`) because MudBlazor renders `role="img"`, which the axe `role-img-alt` rule requires to carry an accessible name even in the fallback-icon state; this page is one of the surfaces the deploy-gating WCAG 2.1 AA scan covers.
- **Where it's used**: routed at `/profile` for any authenticated user in both the web and MAUI heads. Its server round trips land on the Identity avatar endpoints, [`AuthController`](#authcontroller)'s `PUT password`, and [`UsersController`](#userscontroller)'s `DELETE {userId}`.
- **Caveats / not-in-source**: the 8-character minimum in `ValidateNewPassword` is a local literal (`Profile.razor.cs:44`); it does not reference the shared strong-password rule set the server applies, so the two can drift and only a server rejection would surface the difference.

### UserInvariants
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:9` · Level 6 · class (static)

- **What it is**: the rule book for the [`User`](#user) aggregate: the field length constants plus one `Ensure...` method per invariant, each returning a [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the shared primitive checks), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), [`UserRole`](#userrole); externals: `System.Net.Mail.MailAddress`.
- **Concept reinforced, the static invariants class.** `[Rubric §4, DDD]` assesses whether invariants live with the aggregate that owns them, and `[Rubric §1, SOLID]` covers the single-responsibility split. The framework convention, introduced in group-02, is that an aggregate's factory does not contain its rules: the rules live in a static sibling class as independent, individually testable functions, and the factory composes them with `Result.Combine` so the caller gets *every* violation at once instead of the first one. [`User.Create`](#user) is the worked example, combining six checks in a single call (`User.cs:172-179`).
- **Walkthrough**
  - Four public constants (`UserInvariants.cs:12-21`): `FirstNameMaxLength` and `LastNameMaxLength` at 100, `EmailMaxLength` at 100, `DeviceFieldMaxLength` at 256. They are `public const` for a reason: the Application-layer [`RegisterRequestValidator`](#registerrequestvalidator) reuses them (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:16`, `:18-19`) and the EF configuration sizes its columns from them ([`UserConfiguration`](#userconfiguration) at `UserConfiguration.cs:22`, `:27`, `:32`, and on all seven device columns at `:61`, `:65`, `:69`, `:73`, `:77`, `:81`, `:85`), so the domain rule, the wire validation, and the schema cannot disagree.
  - `EnsureEmailIsValid` (`UserInvariants.cs:23-43`) is the only sequential (short-circuiting) check: not empty (`:25-27`), then within length (`:29-31`), then parseable by `MailAddress.TryCreate`, returning `User.Email.InvalidFormat` on the last (`:33-40`). The order matters because running a format parse on an empty string would report a confusing second error.
  - `EnsureFirstNameIsValid` / `EnsureLastNameIsValid` (`UserInvariants.cs:45-53`) each `Result.Combine` a non-empty check with a max-length check, so both problems surface together.
  - `EnsurePasswordHashIsValid` / `EnsurePasswordSaltIsValid` (`UserInvariants.cs:55-59`) delegate to `CommonInvariants.EnsureBytesAreNotEmpty`. They assert presence only: strength is a request-level concern ([`ChangePasswordRequestValidator`](#changepasswordrequestvalidator)) and the hash itself is opaque to the domain.
  - `EnsureRoleIsValid` (`UserInvariants.cs:64-71`) defers to [`UserRole.IsValid`](#userrole) and returns `User.Role.Invalid` on a miss.
  - `EnsurePreferredCultureIsValid` and `EnsurePreferredThemeIsValid` (`UserInvariants.cs:76-93`) forward to the shared `CommonInvariants` equivalents, passing ADC's own error codes and messages. The allowlist of [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) and the light/dark theme set ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)) live in the framework; only the wording is app-specific.
- **Why it's built this way**: every method takes a `source` string that becomes the error's `source` field, so a failure reports which operation raised it (`nameof(Create)`, `nameof(ChangePassword)`, `nameof(UpdatePreferences)`). That is why the same invariant can be shared by the create and change paths without losing diagnostic context (`[Rubric §13, Observability & Operability]`).
- **Where it's used**: by [`User.Create`](#user) (`User.cs:174-178`), [`User.CreateExternal`](#user) (`User.cs:215-216`), [`User.UpdatePreferences`](#user) (`User.cs:291-292`), and [`User.ChangePassword`](#user) (`User.cs:321-322`); the length constants are reused by [`RegisterRequestValidator`](#registerrequestvalidator) and [`UserConfiguration`](#userconfiguration).
- **Caveats / not-in-source**: `EnsureEmailIsValid` and `DeviceFieldMaxLength` are not called from [`User`](#user) in current source. The aggregate validates its address through the [`Email`](group-02-domain-building-blocks.md#email) value object's own `Create` instead (`User.cs:171`, `:212`, `:392`), so the email invariant here is a second, currently unused expression of the same rule, and the device-field limit is enforced only by the EF configuration.

### OAuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` · Level 7 · class (sealed)

- **What it is**: ADC's external social-login endpoint surface (Google and GitHub). It is a body-less class: every action is inherited from the shared [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase), and this file exists to supply the route, the version, and the concrete dependencies.
- **Depends on**: [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (aliased at `OAuthController.cs:6` to disambiguate from the ASP.NET Core type of the same name), [`ICacheService`](group-09-caching.md#icacheservice), `IConfiguration`.
- **Concept introduced, the derived-controller-as-configuration pattern.** `[Rubric §16, Maintainability]` assesses whether a shared workflow is inherited rather than copied, and `[Rubric §9, API & Contract Design]` covers the route surface. The whole class is a primary constructor forwarding three dependencies to a base (`OAuthController.cs:20-23`), terminated with a semicolon: there is no body at all. The base owns the four-step flow, which the class doc states in order (`OAuthController.cs:10-16`): challenge, provider callback, complete, then a single-use-code exchange, with tokens never riding the redirect URL ([ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html)). That last step is the security-relevant one, because a token in a redirect URL lands in browser history and referrer headers (`[Rubric §26, Front-End Security]`, `[Rubric §11, Security]`).
- **Walkthrough**: three attributes and three constructor parameters.
  - `[ApiController]`, `[Route("auth/oauth")]`, `[ApiVersion("1.0")]` (`OAuthController.cs:17-19`). The class doc records the non-obvious reason these are repeated here rather than inherited (`OAuthController.cs:15`): routing and versioning attributes are not reliably inherited from the base, so omitting them would leave the endpoints unroutable.
  - `IAuthenticationService` (`OAuthController.cs:21`) resolves to Identity's own [`AuthenticationService`](#authenticationservice), which is what makes the base's provider-agnostic flow create or link an ADC [`User`](#user). `ICacheService` (`:22`) backs the single-use exchange code. `IConfiguration` (`:23`) supplies the provider and redirect settings.
- **Why it's built this way**: external OAuth is an ADC-only feature (Store is local-credential only), but the *protocol* is app-agnostic, so the flow was hoisted into `MMCA.Common.API` and each app contributes only its route prefix and its authentication service. Pairing this controller with `AddExternalAuthProviders` in the service host is what completes the wiring, and the class doc says so (`OAuthController.cs:13-14`).
- **Where it's used**: mounted by the Identity service host and fronted by the Gateway; the browser and MAUI clients drive it, and the email-verified guard on the linking step is answered by [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier).
- **Caveats / not-in-source**: the provider registrations, scopes, and the Google `email_verified` claim mapping live in the Identity service host's `Program.cs`, not in this file.

### User
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:33` · Level 7 · class (sealed)

- **What it is**: the Identity aggregate root. One row per account, holding credentials, role, refresh-token lifecycle, profile fields, optional MAUI device metadata, external-login identifiers, UI preferences, the avatar URL, and the scalar link to a Conference `Speaker`.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`IPasswordChangeableUser`](group-08-auth.md#ipasswordchangeableuser), [`IUserPreferences`](group-08-auth.md#iuserpreferences), [`IErasableUser`](group-08-auth.md#ierasableuser) (which extends [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable)), [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity), [`Email`](group-02-domain-building-blocks.md#email), [`UserRole`](#userrole), [`UserInvariants`](#userinvariants), [`UserPasswordChanged`](#userpasswordchanged), [`UserDeleted`](#userdeleted), [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`Result`](group-01-result-error-handling.md#result); externals: BCL only.
- **Concept introduced, the interface list as a workflow contract.** `[Rubric §4, DDD]` assesses whether the aggregate is the consistency boundary and enforces its own invariants, and `[Rubric §1, SOLID]` assesses interface segregation: four narrow capability interfaces instead of one fat base (`User.cs:33-34`). The class remarks (`User.cs:17-31`) explain something genuinely easy to get wrong. The shared framework workflows are generic over capability interfaces: [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) constrains on `IPasswordChangeableUser`, and the erasure workflow constrains on `IErasableUser`. Listing `IErasableUser` **on this type directly** is load-bearing because `Delete` here *hides* the base soft-delete with `new` (`User.cs:364`); only re-declaring the interface on `User` re-maps the interface slot onto this type's own member, which is what keeps the refresh-token revocation inside the shared erasure path. Remove the interface from the declaration list and the code still compiles while quietly calling the base method instead.
  - `IAuditedEntity` (`User.cs:34`) is the one non-behavioural marker in the list, and the remarks justify it (`User.cs:25-30`): it opts the aggregate into a change history rather than just the last-writer audit fields. `[Rubric §30, Compliance, Privacy & Data Governance]`: account records are where a support or compliance question actually gets asked (who changed this attendee's email, when was this account raised to Organizer, who anonymized it), and `LastModifiedOn/By` alone answers only "who touched it last".
  - `[IdValueGenerated]` (`User.cs:32`) tells the persistence layer the id is database-generated. That single attribute is the root cause of the [`UserRegistered`](#userregistered) two-save dance: the id does not exist until after the insert, which the `Create` doc states outright (`User.cs:149-155`).
- **Walkthrough**
  - **State** (`User.cs:36-112`). `Email` is an [`Email`](group-02-domain-building-blocks.md#email) value object, not a string, and is marked `[Pii]` along with `FirstName`, `LastName`, and `AvatarUrl` (`User.cs:37`, `:41`, `:45`, `:110`); the `[Pii]` marks are what let the privacy tooling find personal columns ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). `PasswordHash` and `PasswordSalt` are `byte[]` mapped to `varbinary(max)`, inside a scoped `CA1819` suppression that names EF mapping as the reason (`User.cs:48-54`). `Role` is a `string` for EF and JWT round-tripping (`User.cs:57`) while [`UserRole`](#userrole) owns the rules. `LinkedSpeakerId` is a nullable `SpeakerIdentifierType` scalar (`User.cs:70`), the 1:1 bidirectional counterpart of `Speaker.LinkedUserId` (BR-208). Every setter is `private`: state changes only through the methods below.
  - **Computed members**: `IsExternalLogin => LoginProvider is not null` (`User.cs:115`) and `FullName` (`User.cs:118`), derived rather than stored so they cannot go stale.
  - **Constructors** (`User.cs:120-144`): a private parameterless one for EF that initializes the non-nullable members to safe defaults, including `Role = UserRole.Attendee` (`:127`), and a private full one used by the factories.
  - **`Create`** (`User.cs:163-191`): parses the email (`:171`), then `Result.Combine`s the email result with five [`UserInvariants`](#userinvariants) checks (`:172-179`), returns `Result.Failure<User>(result.Errors)` on any failure (`:180-183`), and otherwise constructs with `Id = default` (`:185-188`).
  - **`CreateExternal`** (`User.cs:205-231`): the OAuth path. It validates email and names only (`:212-217`), sets `PasswordHash`/`PasswordSalt` to empty arrays and forces `UserRole.Attendee` (`:223`), and records `LoginProvider`/`ProviderKey` (`:226-227`). The password invariants are deliberately skipped because an external account has no local password.
  - **Behavior**: `LinkExternalProvider` (`User.cs:239-243`) attaches a provider to an existing local account; `UpdateRefreshToken` / `RevokeRefreshToken` (`User.cs:250-263`) are the BR-205/BR-216 token lifecycle; `LinkSpeaker` / `UnlinkSpeaker` (`User.cs:270-278`) maintain the BR-207/BR-209 scalar cross-context link; `UpdateDeviceMetadata` (`User.cs:341-357`) sets the seven MAUI fields in one call; `SetAvatarUrl` (`User.cs:310`) records or clears the avatar URL and nothing else, with the doc drawing the boundary explicitly (`User.cs:303-307`): size, format sniffing, and re-encoding belong to the upload use case, and the domain only stores the resulting public URL.
  - **`UpdatePreferences`** (`User.cs:288-301`): combines the culture and theme invariants (`:290-292`) and assigns only after both pass (`:298-299`), so a rejected theme cannot leave a half-applied culture.
  - **`ChangePassword`** (`User.cs:318-335`): validates the new hash and salt (`:320-323`), assigns, and raises [`UserPasswordChanged`](#userpasswordchanged) via `AddDomainEvent` (`:332`).
  - **`Delete`** (`User.cs:364-374`): the `new` hiding method. It revokes the refresh token *first* (`:366`), so an account being deleted cannot keep minting access tokens from an outstanding refresh token, then calls `base.Delete()` and raises [`UserDeleted`](#userdeleted) only when that succeeded (`:368-371`).
  - **`Anonymize`** (`User.cs:387-422`): the erasure half. It builds the placeholder address `deleted-{Id}@anonymized.invalid` with `CultureInfo.InvariantCulture` (`:392`), and the id embedded in the address is what keeps the unique-email invariant (BR-200) satisfiable across many erased accounts. It is idempotent by construction: if the current email already equals the placeholder there is nothing left to erase and it returns success (`:399-402`). Otherwise it overwrites the email, names, credentials, all seven device fields, both external-login fields, and the avatar URL, and revokes the refresh token (`:404-419`).
- **Why it's built this way**: `Delete` and `Anonymize` are separate operations, and the doc on `Anonymize` (`User.cs:376-386`) says exactly why: the row survives so cross-context scalar references (bookmarks, notifications) and the audit trail do not break, which is the anonymize-in-place policy of [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html). It is also why a re-registration with an erased account's original email succeeds by design, a nuance [`AuthenticationService`](#authenticationservice)'s `EmailExistsAsync` documents. The avatar comment (`User.cs:105-109`) draws the matching line for storage: the domain nulls the URL, and the use case, which knows the blob boundary, deletes the file ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).
- **Where it's used**: persisted by [`UserConfiguration`](#userconfiguration), projected by [`UserDTOMapper`](#userdtomapper), driven by [`AuthenticationService`](#authenticationservice) and the Users use cases ([`ChangePasswordHandler`](#changepasswordhandler), [`ChangePreferencesHandler`](#changepreferenceshandler), [`DeleteUserHandler`](#deleteuserhandler), [`ExportUserDataHandler`](#exportuserdatahandler), [`SetUserAvatarHandler`](#setuseravatarhandler), [`RemoveUserAvatarHandler`](#removeuseravatarhandler)), mutated on the cross-context link by [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler) and [`SpeakerUnlinkedFromUserHandler`](#speakerunlinkedfromuserhandler), and read by [`GetUsersHandler`](#getusershandler).
- **Caveats / not-in-source**: `Anonymize` leaves `Role`, `PreferredCulture`, `PreferredTheme`, and `LinkedSpeakerId` untouched (`User.cs:404-419`), so an erased account keeps its role, its UI preferences, and any speaker link. Those are treated as non-identifying here; nothing in this file states that judgement, so it is a behavior to notice rather than a documented decision.

### UserList
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.User` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16` · Level 7 · class (partial)

- **What it is**: the code-behind for the organizer user list page at `/users`: a server-paged, server-sorted, per-column-filterable grid on desktop and an infinite-scroll card list on mobile, with delete (BR-51, UC-21).
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (base), [`IUserUIService`](#iuseruiservice), [`ListPageActions`](#listpageactions), [`UserListDTO`](#userlistdto), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), the `DeleteConfirmation` component from `MMCA.Common.UI.Components`, and MudBlazor's `MudDataGrid<T>` / `GridState<T>` / `GridData<T>`.
- **Concept introduced, the code-behind list page over a framework base.** `[Rubric §18, UI Architecture]` assesses separation of markup from behavior and reuse of page scaffolding. The page is split into a `.razor` markup file and this `partial class`, and the class inherits [`DataGridListPageBase<UserListDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`UserList.razor.cs:16`), which supplies `Snackbar` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:22`), `IsMobile` (`:44`), the filter-persistence hooks (`:108`, `:111`), the `GridRef` extension point (`:121`), and the `LoadServerDataAsync` adapter (`:434`). The subclass therefore contains only what is genuinely user-specific: which service to call, which four columns are filterable, and what to do on delete. `[Rubric §23, Front-End Performance]`: nothing is loaded client-side and filtered in the browser; paging, sorting, and filtering are all pushed to the API.
- **Walkthrough**
  - Base contract (`UserList.razor.cs:18-19`, `:24`): `EntityName` and the overridden `Title` read from the localizer `L`, and `GridRef` exposes the `_dataGrid` field so the base can drive reloads. `L` itself is injected in the markup half (`UserList.razor:5`), not by the base, whose own localizer is private and scoped to the shared resource.
  - Route and gate (`UserList.razor:1-2`): `@page "/users"` plus `[Authorize(Roles = "Organizer")]`, a role-shaped client gate over the server's own permission check.
  - Injected service (`UserList.razor.cs:21`): `[Inject] private IUserUIService UserService`, the interface, never a concrete HTTP type.
  - Component references (`:23-30`): the desktop grid, the mobile infinite list, the `DeleteConfirmation` dialog, and the toolbar search string. `_dataGrid` and `_infiniteList` are nullable (only one layout renders at a time), `_deleteConfirm` is `default!` because the dialog is always present in the markup.
  - `RetryLoadAsync` (`:27`): the retry action offered by the base's inline error state, a null-safe `ReloadServerData()`.
  - `SaveFilters` / `RestoreFilters` (`:32-36`): the two overrides that persist the free-text `_searchString` across navigation, so returning to the list keeps the operator's search.
  - `ReloadActiveLayoutAsync` (`:38-39`) and `OnSearchChanged` (`:41-45`): the first is one line delegating to [`ListPageActions`](#listpageactions); the second records the new search text and reloads through it, so typing in the toolbar drives whichever layout is live.
  - `LoadServerData` (`:47-64`): the desktop fetch. It hands the base a lambda that pulls the four per-column filter values out of MudBlazor's filter dictionary by `nameof(UserListDTO.X)` (`:52-55`) and forwards them plus page, size, and sort to `UserService.GetPagedAsync` (`:57-58`). The second lambda (`:60-64`) injects the toolbar search box as a `contains` filter on `Email`, so free-text search and column filters travel one code path.
  - `FetchMobilePage` (`:67-72`): the mobile fetch, simplified to search-on-email only with a fixed `"Email"` ascending sort, because the card layout has no column headers to sort by.
  - `DeleteUserAsync` (`:75-83`): delegates the whole flow to `ListPageActions.DeleteWithConfirmationAsync`, passing the user's email as the confirmation subject, the delete call, and two localized messages (`Snackbar.UserDeleted`, `Snackbar.DeleteUserFailed`).
- **Why it's built this way**: `nameof(UserListDTO.Email)` rather than an `"Email"` literal ties the filter key to the DTO property, so a rename is a compile error rather than a silently dead filter. Delegating delete and reload to [`ListPageActions`](#listpageactions) means the cancellation-swallowing and confirm-first behavior is identical on every ADC list page, which is a `[Rubric §24, Forms, Validation & UX Safety]` concern: destructive actions always confirm.
- **Where it's used**: routed as the organizer user-management page in the ADC web and MAUI UI; the server side it calls is [`UsersController`](#userscontroller), whose list endpoint is gated on the `UsersRead` capability in [`IdentityPermissions`](#identitypermissions).

### ChangePasswordCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:14` · Level 8 · record (sealed)

- **What it is**: the command for a self-service password change. It pairs the target `UserId` with the [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) body, opts into automatic request validation, and evicts the user cache on success.
- **Depends on**: [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest); the `UserIdentifierType` alias (`= int`); [`User`](#user) (only for `typeof(User).FullName`); and three framework markers, [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), and [`IUserScopedCommand<out TRequest>`](group-14-module-system-composition.md#iuserscopedcommandout-trequest).
- **Concept introduced, three markers that each buy exactly one pipeline behavior.** `[Rubric §6, CQRS & Event-Driven]` (a command is a named intention carrying exactly what the write needs) and `[Rubric §2, Design Patterns]`. The record declares no members beyond `CachePrefix`; everything else it does is expressed by which interfaces it lists (`ChangePasswordCommand.cs:15`).
  - `ICommandWithRequest<ChangePasswordRequest>` opts the command into **automatic validation**: the framework registers a `CommandRequestValidator<TCommand, TRequest>` that delegates to the registered `IValidator<ChangePasswordRequest>` through FluentValidation's `SetValidator`, with `TryAdd` semantics so an explicit command-level validator still wins (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:5-11`).
  - `ICacheInvalidating` gives the caching decorator a prefix to evict, `$"{typeof(User).FullName}:"` (`ChangePasswordCommand.cs:18`). Deriving it from the type rather than from a string literal keeps it in lockstep with the key the user cache actually uses: rename or move [`User`](#user) and the prefix follows.
  - `IUserScopedCommand<ChangePasswordRequest>` is the view the shared handler base reads the command through, and it changes no pipeline behavior on its own. Its doc comment records why the two are separate rather than merged: the automatic-validation opt-in is a per-application decision, and ADC and Store agree on it for password change but disagree for preferences (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:6-11`).
- **Walkthrough**: a two-parameter positional record `(UserIdentifierType UserId, ChangePasswordRequest Request)` (`ChangePasswordCommand.cs:14`) plus the single computed `CachePrefix` property (`:17-18`). `UserId` comes from the authenticated principal, `Request` from the body.
- **Why it's built this way**: splitting "who" (the token) from "what" (the body) makes it structurally impossible for a request to target another account, and the shared handler base stays generic in `TCommand` precisely so each application can keep its own marker set on the record while sharing one workflow.
- **Where it's used**: constructed by [`AuthController`](#authcontroller)'s `CreateChangePasswordCommand` override (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:82-84`) and handled by [`ChangePasswordHandler`](#changepasswordhandler).

### SpeakerLinkedToUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20` · Level 8 · class (sealed, partial)

- **What it is**: the Identity-side subscriber for Conference's [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) integration event. It sets `User.LinkedSpeakerId`, the Identity half of the bidirectional User-to-Speaker link (BR-209).
- **Depends on**: [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent) (implemented); [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) from `MMCA.ADC.Conference.Shared`; [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype); [`User`](#user); `IServiceScopeFactory` and `ILogger` with the `[LoggerMessage]` source generator.
- **Concept introduced, the integration-event handler that owns its own scope.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]`. Two structural facts separate this from a domain-event handler.
  First, it injects `IServiceScopeFactory` rather than [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`SpeakerLinkedToUserHandler.cs:20-22`) and opens `scopeFactory.CreateAsyncScope()` per message (`:31-32`). An integration event arrives on a broker consumer thread, outside any HTTP request scope, so the handler has to create the scope that scoped services live in.
  Second, this is a **cross-service** subscription: the event type comes from Conference's `Shared` assembly, travels through Conference's outbox and the MassTransit broker, and lands here ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). The class doc comment (`:13-18`) records what it replaced, a direct call from Conference into an Identity service interface. Inverting that into an event is what allowed the two modules to become separate processes with separate databases, and it is why the comment can state that this handler is the only place `User.LinkedSpeakerId` changes in response to a Conference-side change.
- **Walkthrough** (primary constructor `:20-22`, `HandleAsync` `:25-58`)
  1. **Null guard** (`:27`), `ArgumentNullException.ThrowIfNull(integrationEvent)`.
  2. **Scope and repository** (`:31-33`), an async scope, then `IUnitOfWork` resolved from it, then `GetRepository<User, UserIdentifierType>()` (the mutating repository, because this path writes).
  3. **Load** (`:35`), `GetByIdAsync(integrationEvent.UserId, ...)`. A missing user logs a **warning** and returns (`:36-40`) rather than throwing: retrying cannot conjure an account that no longer exists.
  4. **Idempotency check** (`:42-46`), when `LinkedSpeakerId` already equals the event's `SpeakerId`, return without writing. The comment says why this matters: delivery is at-least-once, so a redelivery must be a no-op rather than a second write.
  5. **Apply and persist** (`:48-49`), `user.LinkSpeaker(...)` then `SaveChangesAsync`, followed by an information-level log (`:51`).
  6. **Failure policy** (`:53-57`, `:76-80`), the `catch (Exception ex) when (LogAndRethrow(...))` idiom. `LogAndRethrow` logs at error level and always returns `false`, so the filter never matches, the exception keeps propagating with its original stack, and the `throw;` inside the block is unreachable by construction (the comment at `:55` says so). `[Rubric §29, Resilience & Business Continuity]`: the `<remarks>` (`:63-75`) records the failure this design corrects. The handler used to swallow every exception, so one transient database fault lost the BR-209 back-link permanently (the delivery was already acknowledged, so nothing retried), leaving Conference believing the speaker was linked while Identity held a null and only a log line existed to show for it. Letting the exception through hands the decision to the delivery mechanism instead: the consumer wrapper leaves the inbox row unprocessed, MassTransit redelivers, and a message that keeps failing moves to the error queue where an operator can see it.
- **Why it's built this way**: log-and-rethrow through an exception filter, rather than a `catch` / log / `throw` block, preserves the original stack trace exactly. Retrying is only safe because step 4 exists: the handler re-reads the user and writes nothing when the link already points at the same speaker, so at-least-once delivery converges on one state.
- **Where it's used**: auto-registered by the Application-layer Scrutor scan and driven by the broker consumer for `SpeakerLinkedToUser`; the full outbox to broker to consumer round trip is exercised by the cross-service Testcontainers test tier.

### SpeakerUnlinkedFromUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:20` · Level 8 · class (sealed, partial)

- **What it is**: the mirror of [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler). It subscribes to Conference's [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) and clears `User.LinkedSpeakerId`, but only when the link still points at the speaker the event names.
- **Depends on**: the same set as its sibling: [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`User`](#user), `IServiceScopeFactory`, and `[LoggerMessage]` logging.
- **Concept introduced, guarding against out-of-order delivery.** `[Rubric §29, Resilience & Business Continuity]` and `[Rubric §8, Data Architecture]`. The scope, idempotency, and log-and-rethrow mechanics are the ones taught at [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler); what is genuinely new here is a third guard. Linked and Unlinked arrive on **separate queues with no ordering guarantee**, so an Unlinked event for a previous speaker can land after the user has already been re-pointed at a new one. Clearing the column on that message would silently drop a link that is still valid. The handler therefore compares before clearing (`SpeakerUnlinkedFromUserHandler.cs:48-55`) and, on a mismatch, logs a warning naming both speaker ids (`:53`, message template at `:94-95`) and leaves the link in place. That is the general lesson for any compensating message: an event that undoes something must verify it is undoing the thing it was written for.
- **Walkthrough** (`HandleAsync` `:25-67`): null guard (`:27`); async scope, unit of work, mutating repository (`:31-33`); load, with a warning-and-return on a missing user (`:35-40`); the **already-cleared** short circuit when `LinkedSpeakerId` has no value, which is the idempotent-redelivery case (`:42-46`); the **stale-event** guard above (`:48-55`); then `user.UnlinkSpeaker()` plus `SaveChangesAsync` and an information log (`:57-60`). Failure handling is the identical `catch ... when (LogAndRethrow(...))` filter (`:62-66`, `:85-89`) carrying the same `<remarks>` rationale (`:72-84`).
- **Why it's built this way**: three separate early returns (not found, already cleared, different speaker) each map to a distinct real situation and each gets its own message and log level, so an operator reading the log can tell "nothing to do" apart from "something is off". Only the last is a warning about suspicious ordering; the first two are routine, and the "already cleared" case logs nothing at all.
- **Where it's used**: auto-registered by the Application-layer Scrutor scan; triggered by Conference's unlink command and by the cascade cleanup that runs when a Speaker is soft-deleted (BR-70), as the class doc records (`:10-19`).

### UserDTOMapper
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.DTOs` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:14` · Level 8 · class (sealed, partial)

- **What it is**: the compile-time mapper from the [`User`](#user) aggregate to [`UserDTO`](#userdto), for the single and the collection case.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (implemented), [`User`](#user), [`UserDTO`](#userdto), the [`Email`](group-02-domain-building-blocks.md#email) value object, and Mapperly (`Riok.Mapperly.Abstractions`).
- **Concept introduced, source-generated mapping with a hand-written converter hook.** `[Rubric §9, API & Contract Design]` assesses whether the wire shape is decided deliberately, and `[Rubric §15, Best Practices & Code Quality]` covers the generator choice. `[Mapper]` on a `partial` class (`UserDTOMapper.cs:13-15`) tells Mapperly to generate the body of every `partial` method declaration at build time ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). There is no reflection and no runtime configuration: the generated assignment list is ordinary C# you can step through, and a property that cannot be mapped is a build diagnostic rather than a silent null at runtime.
  The value-object problem is solved by convention rather than by attribute. `User.Email` is an [`Email`](group-02-domain-building-blocks.md#email) while `UserDTO.Email` is a `string`, and Mapperly resolves that by finding a method in the class whose signature converts one to the other: the private `static string EmailToString(Email email) => email.Value` (`:28`). Adding that method is the entire configuration.
- **Walkthrough**
  - `MapToDTO(User entity)` (`:18`): declared `partial` with no body; the generator emits the property-by-property assignment.
  - `MapToDTOs(IReadOnlyCollection<User>)` (`:21-25`): hand-written, not generated. It null-guards with `ArgumentNullException.ThrowIfNull` (`:23`) and returns `[.. entityCollection.Select(MapToDTO)]` (`:24`), a collection expression over the generated single-item map, so there is exactly one mapping definition to keep correct.
  - `EmailToString` (`:28`): the converter hook described above.
- **Why it's built this way**: `[Rubric §30, Compliance, Privacy & Data Governance]`. The doc comment (`:9-12`) states the real purpose of the type: it excludes `PasswordHash`, `PasswordSalt`, and `RefreshToken` from the projection. That exclusion is not enforced by an attribute, it follows from [`UserDTO`](#userdto) simply not declaring those members (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8-24` declares exactly `Id`, `Email`, `FirstName`, `LastName`, `Role`, all `required` and `init`-only). The DTO is the allowlist, and because Mapperly maps by name at compile time, adding a sensitive property to the aggregate cannot leak it: someone would have to add it to the DTO on purpose.
- **Where it's used**: registered as `IEntityDTOMapper<User, UserDTO, UserIdentifierType>` by the Application-layer Scrutor scan and resolved wherever the module returns a full user representation. Note that the organizer list endpoint does **not** go through it: [`GetUsersHandler`](#getusershandler) projects straight to [`UserListDTO`](#userlistdto) in the database, so the sensitive columns are never read at all.

### ChangePasswordHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: ADC's change-password handler. The class body is empty: the whole workflow lives in the framework base [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand), and this type exists to bind the generic parameters and to keep the name.
- **Depends on**: [`ChangePasswordHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepasswordhandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), `ILogger<T>`, [`User`](#user), and [`ChangePasswordCommand`](#changepasswordcommand).
- **Concept introduced, the name-preserving thin subclass.** `[Rubric §16, Maintainability]` assesses de-duplication across applications, and `[Rubric §9, API & Contract Design]` covers why the class name survives the move. ADC and Store carried line-identical copies of this handler, so the workflow was hoisted into `MMCA.Common` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:11-15`). What could not be hoisted is the **error payload**: every failure the framework returns carries a `source`, the base defaults it to `GetType().Name` through a virtual `HandlerName` (`ChangePasswordHandlerBase.cs:34-39`), and clients match on the string `ChangePasswordHandler`. Keeping an empty subclass under the original name makes the hoist invisible on the wire, and the `<remarks>` says so outright (`ChangePasswordHandler.cs:12-16`). It is a small pattern with a large consequence: a refactor that would otherwise be a breaking API change becomes a no-op for consumers. The same shape recurs at [`ChangePreferencesHandler`](#changepreferenceshandler) and [`GetUserPreferencesHandler`](#getuserpreferenceshandler).
- **Walkthrough**: a primary constructor taking [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), and `ILogger<ChangePasswordHandler>` and forwarding all three to the base (`ChangePasswordHandler.cs:17-21`), with an empty body (`:22-23`). The inherited workflow (`ChangePasswordHandlerBase.cs:42-70`) is: null-guard the command (`:46`); load the user through the mutating repository and return `Error.NotFound` tagged with `HandlerName` when absent (`:48-53`); verify the supplied current password with `passwordHasher.VerifyPassword(command.Request.CurrentPassword, user.PasswordHash, user.PasswordSalt)` and return `Error.Unauthorized("Auth.InvalidCurrentPassword", ...)` on a mismatch (`:55-59`); hash the new password into a fresh hash and salt pair (`:61`); call `user.ChangePassword(newHash, newSalt)` and, only when that succeeds, save and log (`:62-67`); return the aggregate's [`Result`](group-01-result-error-handling.md#result) unchanged (`:69`).
- **Why it's built this way**: `[Rubric §11, Security]`. Note the division of responsibility the base encodes. Proving knowledge of the current password is a cryptographic operation, so it happens where the stored hash and salt are in hand, not in a request validator (a validator can only check that a value is present). The domain then applies its own invariants on the new credential material, and nothing is persisted unless both gates pass. The generic constraint `where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IPasswordChangeableUser` (`ChangePasswordHandlerBase.cs:28`) is what lets the base call `ChangePassword` on an application's aggregate without knowing the concrete type, and the hashing scheme itself is [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html).
- **Where it's used**: resolved as `ICommandHandler<ChangePasswordCommand, Result>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:32`), which exposes it as `PUT /auth/password`; the [`Profile`](#profile) page is the client.

### UsersController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:31` · Level 9 · class (sealed)

- **What it is**: the `/users` REST surface: the organizer user list, account delete, the GDPR data export, and the three avatar endpoints for the signed-in user. Six actions, each a thin adapter over one handler.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) closed over six use cases (`UsersController.cs:32-37`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute), [`IdentityPermissions`](#identitypermissions), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`UserDataExportDTO`](group-08-auth.md#userdataexportdto), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); externals: ASP.NET Core MVC (`IFormFile`, `[RequestSizeLimit]`, `[Range]`).
- **Concept introduced, the controller as a translator between HTTP and the handler pipeline, and the two shapes of authorization.** `[Rubric §9, API & Contract Design]`, `[Rubric §11, Security]`, `[Rubric §5, Vertical Slice]` (assesses whether each endpoint routes to its own use case rather than into a shared service). Every action follows the same four lines: read the caller from `ICurrentUserService`, build the command or query record, `await handler.HandleAsync(...)`, then `result.IsFailure ? HandleFailure(result.Errors) : Ok(...)`. The controller holds no business logic, which is why the decorator pipeline (logging, caching, validation, transaction) applies uniformly. The authorization split is the interesting part:
  - **Declarative**, for a role-shaped rule: the list endpoint carries `[HasPermission(IdentityPermissions.UsersRead)]` (`UsersController.cs:125`), the permission-based check of [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html). A caller without that capability never reaches the handler.
  - **In-handler**, for an ownership-shaped rule: export and delete pass the caller's id and role *into* the query or command (`UsersController.cs:162`, `:184`) so the handler can apply owner-or-Organizer and, importantly, return 404 rather than 403 for a stranger's id, which avoids leaking whether that account exists ([ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)).
- **Walkthrough**: class-level `[Authorize]` (`UsersController.cs:30`) makes every action authenticated by default, and each action re-checks `currentUserService.UserId is null` and returns `Unauthorized()` for the "authenticated but no usable id" case.
  - `MaxAvatarBytes = 2 * 1024 * 1024` (`UsersController.cs:41`), the BR-116a ceiling.
  - `GET me/avatar` (`UsersController.cs:44-59`), resolving the subject from the token rather than a route parameter.
  - `POST me/avatar` (`UsersController.cs:66-102`) is the richest action. `[RequestSizeLimit(MaxAvatarBytes)]` (`:67`) rejects an oversized body at the pipeline before any of it is buffered; the inline guard then re-checks null, zero-length, and over-limit and returns a validation error (`:78-84`), so the limit is enforced twice for two different failure modes. The stream is copied into a right-sized `MemoryStream` (`:86-93`), with both `await using` scopes carrying `ConfigureAwait(false)`, and the byte array is handed to [`SetUserAvatarCommand`](#setuseravatarcommand) (`:95-97`). The action doc records what the handler then does (`:61-65`): sniff the real format, re-encode to 256x256 JPEG, return the public URL. Trusting a declared content type here would be an upload vulnerability.
  - `DELETE me/avatar` (`UsersController.cs:105-120`), documented idempotent, returning 204.
  - `GET users` (`UsersController.cs:124-145`): eight `[FromQuery]` parameters with `[Range(1, int.MaxValue)]` on both paging values (`:132-133`), so a `pageNumber=0` is a model-binding 400 rather than a handler concern.
  - `GET {userId}/export` (`UsersController.cs:149-168`) and `DELETE {userId}` (`UsersController.cs:171-190`), the two ownership-checked actions, both declaring 403 and 404 in their `ProducesResponseType` set (`:151-152`, `:173-174`).
- **Why it's built this way**: injecting six separate closed handler interfaces rather than one "user service" is what keeps each endpoint on its own vertical slice and makes the decorator pipeline the single place where cross-cutting behavior lives ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The consistent `HandleFailure(result.Errors)` tail means every failure becomes a `ProblemDetails` with the same shape, mapped once in [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase).
- **Where it's used**: mounted by the Identity service host and routed through the Gateway; consumed by [`UserService`](#userservice) on the client side, and warmed at startup by [`SelfHttpWarmupTask`](#selfhttpwarmuptask), whose expected 401 comes from this class's `[Authorize]` plus `[HasPermission]` pair.

### AuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:29` · Level 12 · class (sealed)

- **What it is**: the `/auth` endpoint surface: login, register, refresh, revoke, change password, and get/set the stored culture and theme preferences. Most of it is inherited; this class overrides two actions and supplies the two command factories.
- **Depends on**: [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](group-12-api-hosting-mapping.md#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand) (which itself extends [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase)), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`ChangePasswordCommand`](#changepasswordcommand), [`ChangePreferencesCommand`](#changepreferencescommand), [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`RegisterRequest`](group-08-auth.md#registerrequest), [`LoginRequest`](group-08-auth.md#loginrequest); externals: ASP.NET Core rate limiting (`[EnableRateLimiting]`).
- **Concept introduced, the generic controller base parameterized by the app's command types.** `[Rubric §16, Maintainability]`, `[Rubric §1, SOLID]`, `[Rubric §11, Security]`. The base owns the four token actions plus `PUT password` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:86`), `PUT preferences` (`:112`), and `GET preferences` (`:138`). It cannot own the command *records*, because ADC marks its change-password command `ICacheInvalidating` with a cache prefix built from ADC's own [`User`](#user) type while Store does not; the shared handler base's remarks record that reason (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:16-21`). The resolution is two abstract factory methods, which this class implements as one-liners (`AuthController.cs:82-89`): the shared workflow stays shared, and each app keeps its own command semantics.
- **Walkthrough**: primary constructor forwarding five dependencies to the base (`AuthController.cs:29-40`), then four members.
  - `RegisterAsync` (`AuthController.cs:52-63`) is a genuine override rather than a pass-through. It reads `HttpContext.Connection.RemoteIpAddress` and passes it to `AuthenticationService.RegisterAsync` (`:57-58`), which is the BR-213 registration rate limiting: the Application layer cannot see the connection, so the IP has to be captured here and handed down. Success returns `201 Created` explicitly rather than `200` (`:62`).
  - `LoginAsync` (`AuthController.cs:76-79`) overrides only to re-declare attributes, then calls `base.LoginAsync`. The reason is the attribute set: `[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]` (`:72`, the constant resolves to `"auth-ip"` at `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:41`) and the documented 429 (`:75`). The doc comment (`:65-69`) states the threat model precisely: the per-email lockout of BR-212 cannot stop one source spraying a single common password across many different emails, so a per-IP fixed window sits on top of it ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). Both anonymous endpoints, register and login, carry the same policy (`:48`, `:72`).
  - `CreateChangePasswordCommand` and `CreateChangePreferencesCommand` (`AuthController.cs:82-89`), the two factory implementations that bind ADC's command records to the base's workflow.
- **Why it's built this way**: `[Route("[controller]")]` (`AuthController.cs:27`) makes the prefix `/auth`, which is what the Gateway's route map fronts, and `[ApiVersion("1.0")]` (`:28`) keeps it on the header-based versioning scheme. Both anonymous actions are marked `[AllowAnonymous]` with the fully qualified attribute name (`:47`, `:71`) because the file's `using` set does not import the authorization namespace.
- **Where it's used**: the entry point for every authenticated ADC client. The Blazor and MAUI clients call login/register/refresh through the Gateway; the [`Profile`](#profile) page uses `PUT auth/password` and the preferences pair; [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) guards the password action through the Validating decorator.

### ChangePreferencesCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14` · Level 8 · record (sealed)

- **What it is**: the command that persists one user's culture and theme preferences, the write side of [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). It pairs the target `UserId` with the partial [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest) and evicts the user cache so a preference change cannot be masked by a stale cached read.
- **Depends on**: [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest); the `UserIdentifierType` alias (`= int` in this module); [`User`](#user) (only for `typeof(User).FullName`); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and [`IUserScopedCommand<out TRequest>`](group-14-module-system-composition.md#iuserscopedcommandout-trequest).
- **Concept reinforced, marker-driven pipeline behavior** (introduced at [`ChangePasswordCommand`](#changepasswordcommand)). `[Rubric §12, Performance & Scalability]` assesses caching with correct invalidation, and `[Rubric §6, CQRS & Event-Driven]` assesses whether a command is a named intention carrying exactly what the write needs. The instructive detail is what this record does **not** implement: the declaration lists only `ICacheInvalidating` and `IUserScopedCommand<ChangePreferencesRequest>` (`ChangePreferencesCommand.cs:15`), with no [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), so no `CommandRequestValidator` is auto-registered and the payload is not run through FluentValidation at the edge. `IUserScopedCommand<out TRequest>`'s own `<remarks>` records why the two markers are separate rather than merged: the automatic-validation opt-in is a per-application decision, and ADC and Store agree on it for the password change but disagree for preferences (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserScopedCommand.cs:6-11`). Skipping edge validation is safe here only because the aggregate checks both values itself: `User.UpdatePreferences` combines the supported-culture allowlist and the light/dark rule through [`UserInvariants`](#userinvariants), and the shared handler base propagates that invariant failure as the command's failure.
- **Walkthrough**: a two-parameter positional record `(UserIdentifierType UserId, ChangePreferencesRequest Request)` (`ChangePreferencesCommand.cs:14`), plus one computed member, `CachePrefix => $"{typeof(User).FullName}:"` (`:18`). Deriving the prefix from the type rather than from a string literal keeps it in lockstep with the key the user cache actually uses: rename or move [`User`](#user) and the prefix follows.
- **Why it's built this way**: the command record deliberately stays application-side rather than moving into the framework alongside its handler, because ADC marks it `ICacheInvalidating` with a prefix built from its own `User` type and Store does not, so a single shared record could not preserve both behaviors (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:16-20`). Expressing eviction as an interface the command implements keeps cache management a decorator concern instead of handler boilerplate.
- **Where it's used**: constructed by [`AuthController`](#authcontroller)'s `CreateChangePreferencesCommand` override (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:87-89`) for the profile page and the app-bar culture and theme switchers; handled by [`ChangePreferencesHandler`](#changepreferenceshandler).

### DeleteUserCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:11` · Level 8 · record (sealed)

- **What it is**: the command that soft-deletes and erases a user account (UC-21). It carries the account being deleted **and** the authenticated caller, because deletion is one of the few operations where the caller may legitimately not be the subject.
- **Depends on**: the `UserIdentifierType` alias; [`User`](#user) (for `typeof(User).FullName`); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest).
- **Concept introduced, the owner-or-privileged-role request shape.** `[Rubric §11, Security]` assesses whether authorization decisions are made from data the caller cannot forge, and `[Rubric §1, SOLID]` covers why this is an interface rather than a naming convention. [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest) extends [`IUserScopedRequest`](group-14-module-system-composition.md#iuserscopedrequest) with `CurrentUserId` and a nullable `CurrentUserRole` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/IUserOwnedRequest.cs:8-15`), which is exactly the triple the shared [`UserOwnershipRule`](group-14-module-system-composition.md#userownershiprule) needs to answer "may this caller act on that account". Both extra values are filled from the token by the controller, never from the body, so a client cannot claim a role it was not issued. Only two ADC use cases wear this shape, deletion and data export, and they are precisely the two that must let an Organizer act on someone else's row.
- **Walkthrough**: a three-parameter positional record, `UserId`, `CurrentUserId`, `CurrentUserRole` (`DeleteUserCommand.cs:11-14`), plus the computed `CachePrefix => $"{typeof(User).FullName}:"` (`:17`). `CurrentUserRole` is `string?` because a token may carry no role claim at all, and the null case must resolve to "no privilege" rather than to an exception.
- **Why it's built this way**: modelling the caller as part of the command, rather than reaching for an ambient `HttpContext` inside the handler, is what keeps the handler testable without a web host and keeps the Application layer free of ASP.NET types (`[Rubric §3, Clean Architecture]`, `[Rubric §14, Testability]`).
- **Where it's used**: constructed by [`UsersController`](#userscontroller)'s `DeleteAsync` from `currentUserService.UserId` and `currentUserService.Role` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:183-185`); handled by [`DeleteUserHandler`](#deleteuserhandler).

### ModuleApplicationDbContext
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15` · Level 8 · class (abstract)

- **What it is**: the Identity module's abstract EF Core context. It declares the module's one entity set, `Users`, and inherits everything else from the framework [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Depends on**: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource), EF Core's `DbContextOptions`, `IServiceProvider`, and [`User`](#user).
- **Concept reinforced, one context class per engine, never one per module.** `[Rubric §8, Data Architecture]` assesses how ownership of tables is expressed. The name can mislead on first reading: this type is not what gets instantiated. It is an **abstract** declaration of what Identity contributes to a context, and the concrete per-engine class ([`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) in production today) inherits it and supplies the provider options ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Every other module declares a same-named abstract class in its own namespace, and the doc comment (`ModuleApplicationDbContext.cs:9-14`) states the division of labour plainly: the base handles audit fields, soft deletes, and domain-event dispatch through EF interceptors, so a module context is a declaration of entity sets and nothing more.
- **Walkthrough**: a primary constructor forwarding all four parameters straight to the base (`ModuleApplicationDbContext.cs:15-20`), then the single member `internal DbSet<User> Users { get; set; }` (`:22`). Note the accessibility: `internal`, not `public`. Application code reaches users through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the repositories, so nothing outside the Infrastructure assembly has a reason to touch the set directly. The mapping is not here either: it is discovered from the assembly named by [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and supplied by [`UserConfiguration`](#userconfiguration).
- **Why it's built this way**: keeping the module's contribution abstract is what lets the same entity declarations be hosted by a SQL Server context in production and, with no code change, by a different engine's context. It is also what makes the "never split the context per module" rule enforceable: modules add abstract declarations, they never introduce a second concrete context class ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: inherited by the concrete engine context the framework's physical context factory builds for the `ADC_Identity` database; that database also carries its own `dbo.OutboxMessages` table, so Identity's outbox never contends with another service's.

### UserConfiguration
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12` · Level 8 · class (internal, sealed)

- **What it is**: the EF Core mapping for the [`User`](#user) aggregate: column types and widths, the value-object conversion for `Email`, the ignored computed properties, and four indexes.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base), [`EmailValueConverter`](group-07-persistence-ef-core.md#emailvalueconverter), [`User`](#user) and [`UserInvariants`](#userinvariants), and EF Core's `EntityTypeBuilder<T>`.
- **Concept introduced, the engine-typed configuration base and the shared length constants.** `[Rubric §8, Data Architecture]` assesses whether the schema is declared explicitly rather than inferred, and `[Rubric §16, Maintainability]` covers why the numbers are not literals. Two things are worth internalizing.
  First, the base class is what routes this entity to a physical data source: deriving from `EntityTypeConfigurationSQLServer<User, UserIdentifierType>` (`UserConfiguration.cs:13`) declares the engine, and the database name resolves from the module, which is how `User` lands in `ADC_Identity` rather than in a shared database. `base.Configure(builder)` (`:18`) must run first, because it applies the framework conventions (key, audit columns, the soft-delete global query filter) that this method then refines.
  Second, every length that also matters to the domain is read from [`UserInvariants`](#userinvariants) rather than typed twice: `EmailMaxLength` (`:22`), `FirstNameMaxLength` (`:27`), `LastNameMaxLength` (`:32`), and `DeviceFieldMaxLength` on all seven device columns (`:61`, `:65`, `:69`, `:73`, `:77`, `:81`, `:85`). That is the mechanism that stops an over-long name from passing the domain check and then being truncated by the database.
- **Walkthrough**
  - `Email` (`:20-24`): `HasConversion(new EmailValueConverter())` maps the [`Email`](group-02-domain-building-blocks.md#email) value object onto a plain column, then `IsUnicode(false)` and `IsRequired()`. `IsUnicode(false)` recurs on nearly every string here: these become `varchar`, not `nvarchar`, halving the storage for values that are ASCII by definition (emails, role names, culture codes, URLs, tokens).
  - Names (`:26-34`): `FirstName` and `LastName`, both required, both bounded by the domain constants above.
  - Credentials (`:36-41`): `PasswordHash` and `PasswordSalt` are configured with no options at all, deliberately. The comment states that EF maps `byte[]` to `varbinary(max)` by default so no explicit length is needed (BR-204), and that external-login accounts hold empty arrays.
  - Fixed-width strings: `Role` at 50 (`:43-46`), `RefreshToken` at 256 (`:49-51`), `LoginProvider` at 50 and `ProviderKey` at 256 (`:89-95`), `PreferredCulture` and `PreferredTheme` at 10 each (`:98-104`), `AvatarUrl` at 512 (`:107-109`).
  - `LinkedSpeakerId` (`:57`): configured as a plain scalar property with no relationship at all. That is the visible consequence of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): Speaker lives in another database, so there is no foreign key to declare.
  - Ignored members (`:112-113`): `FullName` and `IsExternalLogin` are computed on the aggregate, so `builder.Ignore` keeps EF from expecting columns for them.
  - Indexes (`:115-126`): a unique index on `Email`, which is the BR-200 "email is the identity" rule enforced at the storage layer; a **filtered** index on `RefreshToken` with `HasFilter("[RefreshToken] IS NOT NULL")`, indexing only the rows that have an outstanding session; a unique filtered index on `LinkedSpeakerId`, which makes the User-to-Speaker link 1:1 while still allowing the many users who have no linked speaker; and a unique filtered composite on `(LoginProvider, ProviderKey)`, so one external identity cannot be attached to two accounts.
- **Why it's built this way**: `[Rubric §12, Performance & Scalability]`: the three filtered indexes are all sparse-column cases where the vast majority of rows are null, so filtering keeps each index small and keeps writes to the common rows out of it entirely. `[Rubric §11, Security]`: the unique constraints on email and on the provider pair are the last line of defence behind the application-level uniqueness probes, so a race between two concurrent registrations fails at the database rather than producing two accounts.
- **Where it's used**: discovered by assembly scan through [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and applied when the concrete engine context builds the model declared by [`ModuleApplicationDbContext`](#moduleapplicationdbcontext); the resulting schema is materialized by the per-service Identity migrations project.

### AttendeeQueryServiceGrpcAdapter
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14` · Level 9 · class (sealed)

- **What it is**: the gRPC-backed **client** implementation of [`IAttendeeQueryService`](#iattendeequeryservice). It answers "which user ids hold the Attendee role" by calling the extracted Identity service instead of reading the local database.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (implemented, from `MMCA.ADC.Identity.Shared`), the generated `AttendeeQueryService.AttendeeQueryServiceClient` and `GetAttendeeUserIdsRequest` types compiled from the `.proto` in this project, and the `UserIdentifierType` alias.
- **Concept introduced, the adapter that makes extraction invisible to callers.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own process without rewriting the code that consumes it. This class is the concrete payoff of the interface indirection set up in the `Shared` layer. Notification depends on the C# interface; in the monolith that interface resolves to Identity's in-process [`AttendeeQueryService`](#attendeequeryservice), and in the extracted topology the composition root swaps in this adapter. The consuming code does not change, does not learn about gRPC, and never holds a generated proto type. The class doc comment (`AttendeeQueryServiceGrpcAdapter.cs:6-13`) says exactly that, and it is why the project is named `.Contracts` and holds both the `.proto` and the hand-written adapter ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Walkthrough**
  - Primary constructor (`:14-15`): takes the generated typed client and nothing else.
  - `CallDeadline = TimeSpan.FromSeconds(5)` (`:20`): a per-call deadline, and the comment (`:17-19`) explains why it is far tighter than the shared resilience pipeline's 30s attempt and 90s total budget. The failure being defended against is a **hung** peer, not a refused one: a refused call fails immediately, but a hung one would stall the broadcast-notification request that triggered this lookup for the full pipeline budget. Transport failures propagate to the caller by design rather than degrading into an empty audience.
  - `GetAttendeeUserIdsAsync` (`:23-34`): one call, passing `deadline: DateTime.UtcNow.Add(CallDeadline)` alongside the cancellation token (`:26-29`), then `return [.. response.UserIds]` (`:33`). The collection expression materializes protobuf's `RepeatedField` into a plain `IReadOnlyList`, which the comment (`:31-32`) notes is deliberate so callers do not leak the generated type; because `UserIdentifierType` is `int`, the projection is a no-op cast.
- **Why it's built this way**: `[Rubric §29, Resilience & Business Continuity]`. Choosing a deadline shorter than the retry budget is the difference between "this dependency is slow" and "this request never returns". Letting transport failures surface rather than swallowing them means a broadcast that could not determine its audience fails visibly instead of quietly notifying nobody.
- **Where it's used**: registered by [`DependencyInjection`](#dependencyinjection)'s `AddIdentityAttendeeClient` in this same project, which the Notification service host calls after module registration (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:210-218`). Its server-side counterpart is [`AttendeesGrpcService`](#attendeesgrpcservice).
- **Caveats / not-in-source**: the interface returns a plain list rather than a [`Result`](group-01-result-error-handling.md#result), so a transport fault reaches the caller as a raw `RpcException` after the Polly pipeline gives up; there is no `Result.Failure` translation on this path.

### AttendeesGrpcService
> MMCA.ADC.Identity.Service · `MMCA.ADC.Identity.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19` · Level 9 · class (sealed)

- **What it is**: the **server** half of the same bridge. It subclasses the generated `AttendeeQueryService.AttendeeQueryServiceBase` and answers the RPC by delegating to whatever `IAttendeeQueryService` is registered in the Identity service host, which in that process is the real in-process implementation reading the Identity database.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (injected), the generated `AttendeeQueryServiceBase`, `GetAttendeeUserIdsRequest` and `GetAttendeeUserIdsResponse` from `attendee_query.proto`, and `Grpc.Core.ServerCallContext`.
- **Concept introduced, the thin gRPC ingress over an existing interface.** `[Rubric §9, API & Contract Design]` assesses whether a published contract is a deliberate surface rather than a leaked internal shape, and `[Rubric §7, Microservices Readiness]` covers the extraction path. The important property is that this class contains **no logic**: it translates a proto request into an interface call and the returned list into a proto response. That is what makes the two deployment topologies behaviorally identical. The doc comment (`AttendeesGrpcService.cs:11-17`) names the one piece of error handling that is not written here: exceptions from the inner service propagate as plain exceptions, and the shared server interceptor [`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) translates a [`ResultFailureException`](group-13-grpc-contracts.md#resultfailureexception) into an `RpcException` carrying the right gRPC status code. A hand-written try/catch here would duplicate a cross-cutting concern that the pipeline already owns.
- **Walkthrough** (`GetAttendeeUserIds`, `:23-35`)
  1. Argument guards on both `request` and `context` (`:27-28`). The generated base is a public wire surface, so both are checked even though the framework supplies them.
  2. `await inner.GetAttendeeUserIdsAsync(context.CancellationToken)` (`:30`). Notice which token is passed: the **server call context's** token, so a client that hangs up or hits its deadline cancels the database read on this side rather than letting it run to completion for nobody.
  3. Response construction (`:32-34`): a fresh `GetAttendeeUserIdsResponse`, then `response.UserIds.AddRange(userIds)`. Protobuf repeated fields are read-only collections that are populated, never assigned.
- **Why it's built this way**: `[Rubric §11, Security]`. The endpoint is mapped with `app.MapGrpcService<AttendeesGrpcService>().RequireAuthorization()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:342`), and the comment above the mapping (`:334-341`) is worth reading in full: the response enumerates attendee user ids, so internal-only ingress is not considered sufficient, and the authorization holds today only because the single caller chain is HTTP-triggered (Notification's [`AttendeeNotificationRecipientProvider`](group-10-notifications.md#attendeenotificationrecipientprovider) under an organizer-authorized controller), which means an inbound bearer always exists for [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) to forward. The comment states the standing condition explicitly: a scheduler or broker-consumer path would run with no `HttpContext`, forward no bearer, and would need its own credential before it ships.
- **Where it's used**: registered through `AddGrpcServiceDefaults()` (`Program.cs:311`) and mapped at `Program.cs:342`; the only client is [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter). The service serves it over Kestrel's HTTP/2 cleartext channel, the transport profile of [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html).

### ChangePreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: ADC's change-preferences handler, an empty subclass. The whole workflow lives in [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand); this type exists to bind the generic parameters and to keep the name.
- **Depends on**: [`ChangePreferencesHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#changepreferenceshandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger<T>`, [`User`](#user), and [`ChangePreferencesCommand`](#changepreferencescommand).
- **Concept reinforced, the name-preserving thin subclass** (introduced at [`ChangePasswordHandler`](#changepasswordhandler)); the `<remarks>` here carries the same rationale, that the class name is kept so the `source` reported on every error stays `ChangePreferencesHandler`, which clients match on (`ChangePreferencesHandler.cs:12-16`). The behavior worth learning is the **null-coalescing merge** inside the base. `[Rubric §27, Internationalization]` assesses whether a locale choice survives a session, and `[Rubric §24, Forms, Validation & UX Safety]` covers partial updates. The merge is one expression (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:53-55`): `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)`. A request carrying only a culture re-supplies the stored theme, and the reverse, which is precisely why the app-bar language switcher cannot wipe the user's dark-mode choice.
- **Walkthrough**: a primary constructor taking [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `ILogger<ChangePreferencesHandler>` and forwarding both to the base (`ChangePreferencesHandler.cs:17-20`), with an empty body (`:21-22`). The inherited workflow (`ChangePreferencesHandlerBase.cs:40-63`): a null guard on the command (`:44`); load through the **mutating** repository, `unitOfWork.GetRepository<TUser, UserIdentifierType>()`, returning `Error.NotFound.WithSource(HandlerName).WithTarget(typeof(TUser).Name)` when absent (`:46-51`); the merge above (`:53-55`); then, **only** when the returned [`Result`](group-01-result-error-handling.md#result) is a success, `SaveChangesAsync` plus the shared [`UserUseCaseLog`](group-14-module-system-composition.md#userusecaselog)`.PreferencesChanged` log (`:56-60`); return the result unchanged (`:62`). Validation is not the handler's job: `User.UpdatePreferences` combines the culture allowlist and the light/dark rule and hands back a failure the handler simply propagates.
- **Why it's built this way**: guarding both the save and the log behind `IsSuccess` means a rejected culture or theme produces a clean failure (a 400 at the edge) with no write and, just as importantly, no misleading "preferences changed" log line for an operator to chase later. The `HandlerName` indirection (`ChangePreferencesHandlerBase.cs:37`, `GetType().Name`) is what makes the empty subclass sufficient: the base reports the runtime type name, so the hoist is invisible on the wire.
- **Where it's used**: resolved as `ICommandHandler<ChangePreferencesCommand, Result>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:33`) as `PUT /Auth/preferences`; wrapped by the decorator pipeline, whose caching decorator performs the eviction declared on [`ChangePreferencesCommand`](#changepreferencescommand).
- **Caveats / not-in-source**: `UpdatePreferences` raises no domain event, so a preference change writes the row and publishes nothing to the outbox.

### DeleteUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:28` · Level 9 · class (sealed, partial)

- **What it is**: ADC's account-deletion handler (UC-21). Unlike the two thin siblings it is not empty: it inherits the shared erasure workflow from [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) and supplies the three genuinely ADC-specific pieces, the privileged role, the cross-service erasure announcement, and the post-commit tail.
- **Depends on**: [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), [`ICacheService`](group-09-caching.md#icacheservice), `TimeProvider`, [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache), [`UserRole`](#userrole), [`UserDeleted`](#userdeleted) (the Identity.Shared integration event), [`SetUserAvatarHandler`](#setuseravatarhandler) (for its `TryGetBlobName` helper), [`Result`](group-01-result-error-handling.md#result), and `[LoggerMessage]` logging.
- **Concept introduced (1), erasure as a fixed workflow with application-specific hooks.** `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether a deletion request actually destroys personal data. The base (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:55-119`) runs a fixed order: check ownership through `UserOwnershipRule.CheckOwnership` using the application's `HasDeletePrivilege` answer (`:62-71`); load the user, `Error.NotFound` when absent (`:73-78`); soft-delete (`:88-93`); run the application's tail (`:95-100`); anonymize (`:103-107`); save (`:109`); then run whatever post-commit actions the tail enqueued (`:111-114`) and log the erasure (`:116`). The two-step delete-then-anonymize is [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)'s resolution of a real tension: the row must survive because other bounded contexts hold scalar `UserId` references and the audit trail depends on it, but the personal data must not survive, because the privacy promise is erasure. One detail in the base rewards a second read (`:83-89`): it dispatches through `IErasableUser erasable = user;` rather than calling `user.Delete()` directly, because member lookup on a type parameter prefers its class constraint, and ADC's [`User`](#user) **hides** the base `Delete()` with `public new Result Delete()` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:364`). Interface dispatch is what guarantees the aggregate's own version (the one that revokes the refresh token first) actually runs.
- **Concept introduced (2), raising a cross-service integration event from inside the erasure.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §30]`. Personal data this account published into **another** service has to travel: Engagement holds a `DisplayName` snapshot on the leaderboard opt-in, Engagement is its own process with its own database, and the in-process domain event `User.Delete()` raises never reaches it. So the override calls `user.AddDomainEvent(new UserDeleted(command.UserId, timeProvider.GetUtcNow()))` (`DeleteUserHandler.cs:62`) on the aggregate, **before** the save. The comment (`:56-61`) states the invariant this buys: the outbox row is written by the very `SaveChangesAsync` that commits the erasure, so the fact and its announcement cannot come apart, whereas publishing after the commit would leave a crash window in which the account is gone and the published name is not. The event payload is deliberately just the id and a timestamp, because carrying a name or email would publish the very data the erasure exists to remove onto a broker that persists messages (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserDeleted.cs:16-27`).
- **Concept introduced (3), the post-commit action list.** `[Rubric §29, Resilience & Business Continuity]`. The hook signature takes an `ICollection<Func<CancellationToken, Task>> afterCommit` (`DeleteUserHandler.cs:46-50`). Work that must not happen if the save fails is **enqueued** rather than run inline, which lets the override hand values it captured before anonymization into a post-commit closure without parking them in mutable handler state.
- **Walkthrough**
  - Constructor and `_logger` field (`:28-38`): five dependencies, and the logger is then held explicitly in a field rather than captured from the primary constructor. The comment says why: the base also receives `logger`, and capturing the same parameter into this type's state would be the compiler error CS9107.
  - `HasDeletePrivilege` (`:42-43`): `UserRole.IsOrganizer(currentUserRole)`, whose implementation is an `OrdinalIgnoreCase` comparison (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:76`), with a `<remarks>` noting it is case-insensitive because a role claim may carry any casing. Store's equivalent answers with its Admin role; that one line is the entire difference in the authorization model between the two applications.
  - `OnAfterSoftDeleteAsync` (`:46-88`): it first captures the avatar blob name **before** anonymization clears the URL (`:54`), reusing `SetUserAvatarHandler.TryGetBlobName` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:90`). That ordering is the whole reason the hook runs where it does. It then raises the integration event (`:62`) and enqueues two post-commit actions in the order the pre-hoist handler ran them (`:64`): writing the shared soft-deleted marker through `SoftDeletedUserCache.MarkDeletedAsync` (`:68-80`), then deleting the avatar blob when there was one (`:82-85`). It returns `Result.Success()` (`:87`); returning a failure here would abort the erasure before anything is persisted.
  - Marker failure policy (`:76-79`, `:90-93`): the cache write is wrapped in its own try/catch that swallows everything except `OperationCanceledException` and logs a warning whose message spells out the consequence, that the deleted user's existing access token stays usable until it expires. The comment (`:65-67`) states the reasoning: the deletion is already committed by the time this runs, the marker only shortens the window in which an already-issued token keeps working, and a cache fault must not turn a successful erasure into a failure the caller would retry.
- **Why it's built this way**: `[Rubric §11, Security]`. Access tokens are self-contained and valid until they expire, so deleting an account does not by itself stop a token already in the wild; the marker is what lets the shared [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) reject those requests. Treating it as best-effort is the correct trade: erasure is the promise that must hold, and the token window is bounded anyway. `[Rubric §30]`: the avatar photo is personal data too (BR-116a), so the blob is deleted rather than merely unreferenced.
- **Where it's used**: resolved as `ICommandHandler<DeleteUserCommand, Result>` and invoked by [`UsersController`](#userscontroller)'s `DeleteAsync` (`UsersController.cs:183-185`), which returns 204 on success; the callers are the [`Profile`](#profile) page's self-service deletion and the organizer [`UserList`](#userlist). The [`UserDeleted`](#userdeleted) integration event it raises is consumed downstream by Engagement's [`UserDeletedPointsHandler`](group-22-engagement-module.md#userdeletedpointshandler).
- **Caveats / not-in-source**: the post-commit actions run sequentially inside the calling request (`DeleteUserHandlerBase.cs:111-114`), so a slow blob delete adds latency to the response; there is no background dispatch here.

### GetUserPreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13` · Level 9 · class (sealed)

- **What it is**: the read side of user preferences: given a user id, return the stored culture and theme. Another empty subclass, this one over [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser).
- **Depends on**: [`GetUserPreferencesHandlerBase<TUser>`](group-14-module-system-composition.md#getuserpreferenceshandlerbasetuser) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), and [`User`](#user). Note what is absent: no `ILogger`. A query that only reads has nothing to announce.
- **Concept reinforced, the thin CQRS read handler** (the subclass shape is taught at [`ChangePasswordHandler`](#changepasswordhandler); the query pipeline at [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)). `[Rubric §6, CQRS & Event-Driven]`: the base implements `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21-23`), so it runs through the query decorator chain (FeatureGate, Logging, Caching) with no Validating and no Transactional decorator, because a read opens no transaction. Both [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery) and [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse) were byte-identical in the two applications and were hoisted whole, which is why this base is generic in the aggregate only, and why its constraint is the lighter `AuditableBaseEntity<UserIdentifierType>, IUserPreferences` rather than the aggregate-root constraint the write bases need (`:23`). `[Rubric §27, Internationalization]`: this is the server end of "remember my language", reading `User.PreferredCulture` straight off the aggregate.
- **Walkthrough**: a primary constructor taking [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwarding it (`GetUserPreferencesHandler.cs:13-14`), empty body. The inherited `HandleAsync` (`GetUserPreferencesHandlerBase.cs:33-45`) guards the query for null (`:37`), resolves `unitOfWork.GetReadRepository<TUser, UserIdentifierType>()` (`:39`), calls `GetByIdAsync(query.UserId, ...)` (`:40`), and returns either `Error.NotFound` tagged with `HandlerName` and the aggregate's type name or `Result.Success(new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme))` (`:41-44`).
- **Why it's built this way**: the base's `<remarks>` (`GetUserPreferencesHandlerBase.cs:15-19`) records that the two application copies disagreed on the repository (ADC read, Store write) and that the read repository is the correct choice for a handler which never calls `SaveChangesAsync`, so Store gained a no-tracking read on adoption. That is the ordinary payoff of consolidating duplicated code: the merge forces a decision, and the better of the two behaviors wins for everyone.
- **Where it's used**: resolved as `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` and injected into [`AuthController`](#authcontroller) (`AuthController.cs:34`) as `GET /Auth/preferences`; the response seeds the client's culture and theme at startup.

### DependencyInjection
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14` · Level 10 · class (static)

- **What it is**: the one registration helper the `.Contracts` project exposes. `AddIdentityAttendeeClient(serviceName)` wires a typed gRPC client for the extracted Identity service and swaps [`IAttendeeQueryService`](#iattendeequeryservice) over to [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).
- **Depends on**: `IServiceCollection` and `ServiceCollectionDescriptorExtensions.Replace`; the generated `AttendeeQueryService.AttendeeQueryServiceClient`; [`IAttendeeQueryService`](#iattendeequeryservice) and [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter); `AddTypedGrpcClient<TClient>` from `MMCA.Common.Grpc`.
- **Concept introduced, `Replace` instead of `TryAdd`, and why the call site's position is load-bearing.** `[Rubric §7, Microservices Readiness]` and `[Rubric §3, Clean Architecture]`. Everywhere else in this codebase module registration uses `TryAdd`, so a host can pre-empt a default. Here the semantics are inverted deliberately, and the doc comment (`DependencyInjection.cs:24-32`) gives the reason: by the time a consuming host calls this, the container already holds **one of two** registrations for [`IAttendeeQueryService`](#iattendeequeryservice). If the Identity module is enabled it holds the real in-process [`AttendeeQueryService`](#attendeequeryservice); if Identity is disabled it holds the [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) stub that [`IdentityModule`](#identitymodule)'s `RegisterDisabledStubs` put there so DI validation would still succeed. `Replace` overwrites either one, so after this call the resolved service is the gRPC adapter regardless of which path the host took; `TryAdd` would silently do nothing in both cases.
  The consequence is an ordering rule, stated in the same comment (`:33-37`): call this from the host's `Program.cs` **after** [`ModuleLoader`](group-14-module-system-composition.md#moduleloader)`.DiscoverAndRegister(...)`, so the in-process or stub registration is in the container by the time `Replace` looks for it. Calling it earlier is not an error the compiler or the container reports; it simply leaves the wrong implementation in place.
- **Walkthrough**: the method lives inside an `extension(IServiceCollection services)` block (`:16`), the workspace idiom for DI registration (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `AddIdentityAttendeeClient(string serviceName = "identity")` (`:41`) does two things: `AddTypedGrpcClient<AttendeeQueryService.AttendeeQueryServiceClient>(serviceName)` (`:43`), which the framework wires to Aspire service discovery at `http://{serviceName}` over HTTP/2 cleartext with the standard [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) and Polly resilience handler; and `services.Replace(ServiceDescriptor.Scoped<IAttendeeQueryService, AttendeeQueryServiceGrpcAdapter>())` (`:47`), with the inline comment restating the `Replace`-not-`TryAdd` rule at the point of use (`:45-46`). It then returns `services` for chaining (`:49`). The `serviceName` default of `"identity"` matches the AppHost resource name, so the common case passes no argument.
- **Why it's built this way**: keeping this helper in the `.Contracts` project rather than in the consuming service means the knowledge of "how you talk to Identity remotely" lives once, next to the `.proto` that defines the call, and every future consumer gets it with a project reference plus one line ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). The `Scoped` lifetime matches the in-process implementation it replaces, so swapping transports changes no lifetime assumption anywhere in the graph.
- **Where it's used**: called by the Notification service host (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:218`), whose surrounding comment (`:210-217`) repeats the `Replace` rationale at the call site; the matching AppHost wiring is noted at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:212`.
- **Caveats / not-in-source**: this is the only public member of the class today, so the `.Contracts` project's DI surface is exactly this one call.

### IdentityModuleDbSeeder
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27` · Level 10 · class

- **What it is**: the development and test seeder for Identity. It supplies three fixed accounts (one Organizer, two Attendees) to the framework's [`IdentityModuleDbSeederBase<TUser>`](group-07-persistence-ef-core.md#identitymoduledbseederbasetuser), which owns the per-account idiom.
- **Depends on**: [`IdentityModuleDbSeederBase<TUser>`](group-07-persistence-ef-core.md#identitymoduledbseederbasetuser) (base, itself a [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder)), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), [`SeedAccount`](group-07-persistence-ef-core.md#seedaccount), [`Email`](group-02-domain-building-blocks.md#email), [`User`](#user) and [`UserRole`](#userrole), and [`Result`](group-01-result-error-handling.md#result) in its generic form.
- **Concept introduced, the hoisted seeder with two typed hooks.** `[Rubric §17, DevOps]` assesses repeatable environment setup, and `[Rubric §16, Maintainability]` covers the de-duplication. The five-step idiom (normalize the email, skip if it already exists, hash the password, build the aggregate, add, save) was written out five times across the two applications' Identity modules and now lives once in the base (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:92-113`). Only two things could not be hoisted, and the base's `<remarks>` (`:13-24`) names both: `CreateUser`, because the two applications' `User.Create(...)` factories take the same values in **different parameter orders** and only the application can spell its own role vocabulary; and `EmailExistsAsync`, because the existence predicate must be written against the concrete `User` (never an interface member) so EF translates it byte-for-byte the way it did before the hoist. That second point is the general lesson for hoisting anything that ends up inside an expression tree: a `where TUser : ISomething` constraint would compile and then fail at query translation.
- **Concept introduced, seeding gated where the gate has one home.** `[Rubric §11, Security]`. The base exposes a `ShouldSeed` opt-in that defaults to `true` (`IdentityModuleDbSeederBase.cs:57`), and this subclass deliberately does **not** override it (`IdentityModuleDbSeeder.cs:17-19`): ADC's `Seeding:IncludeSampleUsers` gate stays in [`IdentityModuleSeeder`](#identitymoduleseeder) in the API layer, which reads the key with `GetValue<bool>` and returns before constructing this seeder at all (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:28-35`). One gate, one home. The class doc carries an explicit security notice (`IdentityModuleDbSeeder.cs:21-25`): the seed credentials ("Admin123!", "Password") are intentionally weak, exist only for local development convenience, and a deployed host must either disable seeding or supply environment-sourced secrets. The default of `false` when the configuration key is absent (`IdentityModuleSeeder.cs:26-27`) is what makes that safe by omission rather than by remembering.
- **Walkthrough**
  - `Accounts` (`:33-38`): a collection-expression `IReadOnlyList<SeedAccount>` with three entries, each `(email, password, role, firstName, lastName)`. The roles come from [`UserRole`](#userrole)'s constants, not string literals.
  - `EmailExistsAsync` (`:41-48`): resolves the mutating repository through `UnitOfWork.GetRepository<User, UserIdentifierType>()` and calls `ExistsAsync(u => u.Email == email, ...)`. The predicate compares the `Email` value object, which is why the base normalizes the raw string with `Email.Create(account.Email).Value` first (`IdentityModuleDbSeederBase.cs:95`): both sides of the comparison then go through the same value converter and the SQL matches.
  - `CreateUser` (`:51-62`): a null guard, then `User.Create(email, firstName, lastName, passwordHash, passwordSalt, role)` in ADC's parameter order, returning the aggregate's own [`Result<TUser>`](group-01-result-error-handling.md#result). A failure here is not thrown: the base skips that one account and moves on (`IdentityModuleDbSeederBase.cs:104-108`).
  - Idempotency and isolation come from the base loop: `SeedAsync` iterates the accounts (`:67-70`) and each account is saved individually (`:110-112`), so re-running against an already-seeded database is a no-op and one invalid account cannot roll back the others.
- **Why it's built this way**: seeding goes through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the domain factory rather than through raw SQL or EF `HasData`, so seeded rows satisfy exactly the same invariants, audit stamping, and password hashing ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)) as rows created through the API. That is what makes the seeded database a faithful small copy of a real one rather than a fixture that only looks like one.
- **Where it's used**: constructed by [`IdentityModuleSeeder`](#identitymoduleseeder) (`IdentityModuleSeeder.cs:34-35`), which the module system invokes through the `IModuleSeeder` contract during database initialization ([`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions)); in practice that means the local Aspire AppHost and E2E CI, and nothing else.
- **Caveats / not-in-source**: the account list is a compile-time constant, so changing which accounts exist in a development environment is a code change and a rebuild, not configuration.


---
[⬅ ADC Engagement Live Layer (Real-Time Polls & Session Q&A)](group-23-engagement-live-layer.md)  •  [Index](00-index.md)  •  [ADC Application Host, UI Shell & Cross-Module Composition ➡](group-25-adc-host-composition.md)
