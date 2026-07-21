# 24. ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

**What this chapter covers.** This is the **Identity bounded context** of MMCA.ADC, the module that
owns *who a person is* across every ADC surface: web, WebAssembly, and MAUI. It is a leaf context (no
upstream module dependencies) but it touches every layer end to end, so this chapter doubles as a
compact tour of a full vertical slice built on the framework taught in groups 1 through 15. The single
aggregate is the [User](#user), and around it sit the credential and refresh-token lifecycle, the role
vocabulary, the change-password / change-preferences / avatar use cases, the two privacy use cases that
make ADC compliant (data-subject **export** and **erasure**), the persistence and EF configuration, the
REST controllers, the gRPC contract that lets a peer service ask Identity a question, the integration
events that keep the User-to-Speaker link consistent across the service split, and the Blazor profile
and user-list UI. The per-type sections follow; this overview shows how the pieces fit and how a
request flows through them.

Almost everything here is an *instantiation* of upstream framework machinery, cross-referenced rather
than re-taught: the [Result](group-01-result-error-handling.md#result) pattern (G01), the
[AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
entity chain plus the [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) and
[PiiAttribute](group-02-domain-building-blocks.md#piiattribute) governance markers (G02), the outbox
spine and [BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent) /
[BaseDomainEvent](group-04-events-outbox.md#basedomainevent) (G04), the CQRS command/query handler
pipeline (G05), the auth base classes
([AuthenticationServiceBase<TUser>](group-08-auth.md#authenticationservicebasetuser), JWKS,
[RoleValue](group-08-auth.md#rolevalue),
[HasPermissionAttribute](group-08-auth.md#haspermissionattribute)) from the shared auth group (G08),
and the [IModule](group-14-module-system-composition.md#imodule) composition system (G14). The lenses
this chapter most strongly embodies are [Rubric §4, Domain-Driven Design] (a behavior-rich aggregate
that guards its own invariants), [Rubric §11, Security] (credential handling, RS256 JWTs,
permission-based authorization, a fail-closed OAuth link gate), and [Rubric §30, Compliance / Privacy /
Data Governance] (the export and erasure flows). The `// BR-NN` markers referenced below are catalogued
in the ADC business-requirements guide; the privacy promises live in `MMCA.ADC/PRIVACY.md`.

## Projects, one bounded context

The module is split along the standard Clean Architecture layering ([Rubric §3, Clean Architecture]),
each project pinned by a trivial [AssemblyReference](#assemblyreference) /
[ClassReference](#classreference) anchor pair that Scrutor scanning and the architecture-fitness tests
use to *name* the assembly. **`MMCA.ADC.Identity.Domain`** holds the [User](#user) aggregate
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:18`), the
[UserRole](#userrole) value type (`UserRole.cs:17`), the [UserInvariants](#userinvariants) rule class
(`UserInvariants.cs:10`), and the [UserDeleted](#userdeleted) /
[UserPasswordChanged](#userpasswordchanged) domain events; it depends only on `MMCA.Common.Domain` and
`MMCA.Common.Shared` and knows nothing of EF or ASP.NET. **`MMCA.ADC.Identity.Application`** holds the
use-case handlers, the DTO mappers and validators, and the cross-module service implementations.
**`MMCA.ADC.Identity.Infrastructure`** holds the
[ModuleApplicationDbContext](#moduleapplicationdbcontext)
(`MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`), the
[UserConfiguration](#userconfiguration) EF mapping, and the
[IdentityModuleDbSeeder](#identitymoduledbseeder). **`MMCA.ADC.Identity.API`** holds the REST
controllers, the [IdentityModule](#identitymodule) descriptor
(`MMCA.ADC.Identity.API/IdentityModule.cs:13`), and the
[IdentityErrorResources](#identityerrorresources) anchor whose `.resx` siblings translate domain error
codes into the supported languages (`IdentityErrorResources.cs:11`, ADR-027).
**`MMCA.ADC.Identity.Shared`** is the contract package every other layer (including the WebAssembly
client) can reference without dragging in the domain: it carries the DTOs, the
[IAttendeeQueryService](#iattendeequeryservice) cross-module interface, the
[UserRegistered](#userregistered) integration event, and the
[IdentityPermissions](#identitypermissions) / [IdentitySettings](#identitysettings) constants. Three
more projects sit outside the module folder: **`MMCA.ADC.Identity.Contracts`** (the gRPC adapter),
**`MMCA.ADC.Identity.Service`** (the extracted process host), and **`MMCA.ADC.Identity.UI`** (the
Blazor pages). The identifier alias for this context is `UserIdentifierType = int` (a
database-generated identity), while the cross-context `LinkedSpeakerId` uses
`SpeakerIdentifierType = System.Guid`.

## The User aggregate: credentials, profile, and cross-context links in one root

[User](#user) (`MMCA.ADC.Identity.Domain/Users/User.cs:18`) is the only aggregate root in the module,
and it carries more responsibility than most: it is the credential store (`PasswordHash` plus a
per-user `PasswordSalt`, both `byte[]` mapped to `varbinary(max)`, `User.cs:34,37`), the refresh-token
holder (`RefreshToken` / `RefreshTokenExpiry`, rotated by `UpdateRefreshToken` and cleared by
`RevokeRefreshToken`, `User.cs:234,243`), the profile (`Email`, `FirstName`, `LastName`, each marked
[[Pii]](group-02-domain-building-blocks.md#piiattribute), `User.cs:22,26,30`), the preference store
(`PreferredCulture` / `PreferredTheme`, `User.cs:84,87`, ADR-027 / ADR-028), the avatar URL holder
(`User.cs:96`, BR-116a, ADR-045), the optional MAUI device-metadata bag (`User.cs:57-75`), the
external-OAuth link (`LoginProvider` / `ProviderKey`, `User.cs:78,81`), and the 1:1 cross-context
`LinkedSpeakerId` pointing at a Conference speaker (`User.cs:54`, BR-207 / BR-208 / BR-209). Every
property has a private setter, so state changes only through the aggregate's own methods: encapsulation
as a compile-time guarantee ([Rubric §4, Domain-Driven Design], [Rubric §1, SOLID]).

It follows the standard framework shape: a private EF constructor (`User.cs:104`), a private state
constructor (`User.cs:114`), and static factory methods returning
[Result<T>](group-01-result-error-handling.md#result). `Create` (`User.cs:147`) validates every
invariant with `Result.Combine(...)` *before* constructing anything (`User.cs:156-163`), so an invalid
user is unrepresentable; `CreateExternal` (`User.cs:189`) builds an OAuth account with empty credential
arrays (`User.cs:207`). A subtlety worth carrying forward: the factory deliberately does **not** raise a
registration event. The `Id` is database-generated (`[IdValueGenerated]` at `User.cs:17`, `Id` set to
`default` at `User.cs:171`), so the cross-module [UserRegistered](#userregistered) is raised by the
application layer only after the insert has executed and a real id exists. The behavior methods each
guard their own rule: `ChangePassword` re-validates and raises
[UserPasswordChanged](#userpasswordchanged) (`User.cs:302-316`); `UpdatePreferences` validates against
the supported-culture allowlist and the light/dark theme values (`User.cs:272-285`); the `Delete()`
override revokes the refresh token as a security measure, calls the G02 soft-delete, and raises
[UserDeleted](#userdeleted) (`User.cs:348-358`).

[UserInvariants](#userinvariants) (`UserInvariants.cs:10`) is the co-located static rule class whose
methods each return a [Result](group-01-result-error-handling.md#result), several of them delegating to
the shared [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants). Centralizing each
rule as a named, side-effect-free method is what makes the domain exhaustively unit-testable ([Rubric
§14, Testability]), and its `const` length limits (`FirstNameMaxLength = 100`,
`LastNameMaxLength = 100`, `EmailMaxLength = 100`, `DeviceFieldMaxLength = 256`,
`UserInvariants.cs:13-22`) are the *same* constants [UserConfiguration](#userconfiguration) uses for the
EF column widths (`UserConfiguration.cs:24,29,34`), so the domain rule and the schema cannot drift.
[UserRole](#userrole) (`UserRole.cs:17`) is a value object over the shared
[RoleValue](group-08-auth.md#rolevalue) base that fixes the ADC role set to three members: `Organizer`,
`Attendee` (the registration default), and `ContentEditor`, a strict capability subset that curates the
session catalog but cannot change event structure, run session selection, or read the user list
(`UserRole.cs:20-30`). Its `IsOrganizer(string?)` helper (`UserRole.cs:76`) does a case-insensitive
compare, because raw JWT role claims may carry any casing, and it is the exact check the delete and
export authorization gates use.

## Authentication: a thin subclass over the shared engine

The login / registration / refresh / revocation workflow is *not* re-implemented here. It lives in
[AuthenticationServiceBase<TUser>](group-08-auth.md#authenticationservicebasetuser) (G08), which owns
the validate-first flow, the ADR-029 lockout and rate-limit protection, and the BR-205 / BR-206
refresh-token rotation with reuse detection. [AuthenticationService](#authenticationservice)
(`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35`) is the ADC subclass that fills in
only the context-specific pieces: `CreateUser` supplies the `Attendee` default role (BR-45,
`AuthenticationService.cs:82-89`), `CreateAccessToken` attaches the `speaker_id` claim when the user is
linked to a speaker (BR-209, `AuthenticationService.cs:92-93` via the `SpeakerClaims` helper at `:228`),
`OnUserRegisteredAsync` raises the [UserRegistered](#userregistered) integration event
(`AuthenticationService.cs:105-110`), and `ExternalLoginAsync` drives the OAuth find-by-provider, else
link-by-email, else create flow (`AuthenticationService.cs:123`). The `EmailExistsAsync` override
deliberately passes `ignoreQueryFilters: true` (`AuthenticationService.cs:78-79`) so an erased
(soft-deleted) account's email cannot be re-registered.

Two details in that class are worth reading closely. First, **atomicity**: `RegisterAsync` wraps the
whole base workflow in `UnitOfWork.ExecuteInTransactionAsync` (`AuthenticationService.cs:57-63`), so the
user insert (first save) and the outbox row for `UserRegistered` (raised in `OnUserRegisteredAsync` once
the id exists at `:107`, then a second save at `:108`) commit together. The event is not fire-and-forget
after the fact, it is captured by the outbox inside the same transaction (ADR-003). The external-login
path does the same through `ExternalLoginAsync` (`:123-132`, with the event raised at `:213`). Second,
**the link-by-email gate**: linking an external identity to an existing local account on nothing but an
email match would be an account-takeover path through any provider that hands out unverified emails, so
the flow consults [IExternalLoginEmailVerifier](#iexternalloginemailverifier)
(`MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`). Its implementation
[HttpContextExternalLoginEmailVerifier](#httpcontextexternalloginemailverifier)
(`MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17`) lives at the API
edge because the assertion lives in the short-lived `ExternalLogin` cookie principal: it
re-authenticates that scheme and reads the `email_verified` claim (`:32-35`), and an absent claim,
absent principal, or non-request context all report unverified. It fails closed, which means GitHub
logins (whose OAuth payload carries no such assertion) never auto-link by design. Identity signs its
tokens with **RS256** and publishes the public key at `/.well-known/jwks.json`; peer services validate
tokens by fetching that document through the Gateway rather than sharing a secret (ADR-004, [Rubric §11,
Security]).

The HTTP surface is equally thin. [AuthController](#authcontroller)
(`MMCA.ADC.Identity.API/Controllers/AuthController.cs:25`) extends the shared
[AuthControllerBase](group-12-api-hosting-mapping.md#authcontrollerbase) (G12) and adds only what ADC
needs: a `register` override that captures the client IP for registration rate limiting (BR-213,
`AuthController.cs:48`), plus `PUT password`, `PUT preferences`, and `GET preferences`
(`AuthController.cs:77,104,129`) that dispatch [ChangePasswordCommand](#changepasswordcommand),
[ChangePreferencesCommand](#changepreferencescommand), and
[GetUserPreferencesQuery](#getuserpreferencesquery) straight through the
[G05 decorator pipeline](group-05-cqrs-pipeline.md). [OAuthController](#oauthcontroller)
(`OAuthController.cs:20`) is a body-less subclass of
[OAuthControllerBase](group-12-api-hosting-mapping.md#oauthcontrollerbase) (G12) that drives the
Google/GitHub challenge, callback, complete, single-use-code-exchange flow (tokens never ride the
redirect URL); it is an ADC-only feature, since MMCA.Store uses local credentials only.
[UserClaimsController](#userclaimscontroller) (`UserClaimsController.cs:16`) reflects the authenticated
JWT's claims back to the client, grouped by claim type (UC-10, `:26-38`).
[UsersController](#userscontroller) (`UsersController.cs:30`) hosts the rest: the three avatar
endpoints, the organizer user list, the data export, and the account delete. Its list endpoint is gated
by capability rather than by role name, `[HasPermission(IdentityPermissions.UsersRead)]`
(`UsersController.cs:123`), and the `identity:users:read` grant
(`MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:11`) is handed to Organizer and Admin in
`AddModuleIdentityAPI` (`MMCA.ADC.Identity.API/DependencyInjection.cs:44-48`, ADR-020).

## The privacy pair: export and erasure

Two use cases make this module the codebase's clearest [Rubric §30, Compliance / Privacy / Data
Governance] story. [DeleteUserHandler](#deleteuserhandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:15`) satisfies the
PRIVACY.md §5 "delete within 30 days" erasure promise. After an owner-or-Organizer authorization check
(`:26-33`) it soft-deletes the row (`:41`), then calls `user.Anonymize()` (`:52`, implemented at
`User.cs:371`), which irreversibly overwrites the personal fields with placeholders **in place** rather
than hard-deleting the record. Keeping the row lets cross-context scalar references (bookmarks,
notifications) and the audit trail survive; the replacement email embeds the user id
(`deleted-{Id}@anonymized.invalid`, `User.cs:376`) so the unique-email invariant still holds across many
erased accounts, and the operation is idempotent (an already-anonymized user short-circuits at
`User.cs:383-386`). This is the anonymize-in-place model of ADR-005, backed by the
[IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) marker. Because the avatar photo is
also personal data, the handler captures its blob name *before* `Anonymize` nulls the URL and deletes it
from storage *after* the erasure is persisted (`DeleteUserHandler.cs:47,56-61`).

[ExportUserDataHandler](#exportuserdatahandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:26`) is the
data-subject *access* request (PRIVACY.md §7). It is a query handler (it never calls `SaveChanges`), it
applies the same owner-or-Organizer rule (`:38-45`), and it projects the user's Identity-owned data into
a [UserDataExportDTO](#userdataexportdto) (`:61-84`), **deliberately excluding** credentials: no
password hash, no salt, no refresh token, no provider key. What makes it instructive is the
cross-service aggregation: it also gathers the Engagement section (bookmarks and submitted session
questions, through
[IUserEngagementExportService](group-22-engagement-module.md#iuserengagementexportservice), `:58`) and
the Notifications section (inbox rows, through
[IUserNotificationExportService](group-10-notifications.md#iusernotificationexportservice), `:59`), and
it does so **best-effort per section**. If a peer stays unreachable after the standard Polly resilience
pipeline, the catch block returns a section marked `Available = false` (`:115-121`, and the same shape
in the notification twin) and the export still succeeds, so one peer outage never fails the whole
request. That is [Rubric §29, Resilience] and [Rubric §7, Microservices Readiness] applied to a
compliance workflow.

## Avatars: the third mutating slice

The avatar trio is a small but complete example of a file-handling slice ([Rubric §11, Security] at the
content boundary, ADR-045). [UsersController](#userscontroller) caps the multipart upload at 2 MB in two
places, declaratively via `[RequestSizeLimit(MaxAvatarBytes)]` and imperatively via an explicit length
check that returns an `Avatar.InvalidUpload` validation error (`UsersController.cs:39-40,66,77-83`,
BR-116a). [SetUserAvatarHandler](#setuseravatarhandler)
(`MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16`) never trusts
the client-declared content type: it sniffs magic bytes through the shared
[ImageContentSniffer](group-07-persistence-ef-core.md#imagecontentsniffer) (`:32`), re-encodes to a
canonical 256x256 JPEG via [IImageProcessor](group-07-persistence-ef-core.md#iimageprocessor)
(`:23,52`), uploads under a randomized blob name through
[IFileStorageService](group-07-persistence-ef-core.md#ifilestorageservice) (`:60-66`), and only then
persists the new URL, deleting the replaced blob *after* the save so a failure leaks one orphaned image
rather than breaking a live avatar (`:74-82`). [RemoveUserAvatarHandler](#removeuseravatarhandler) and
[GetUserAvatarHandler](#getuseravatarhandler) are the trivial siblings on the same resource.

## Persistence, seeding, and the disabled stub

[ModuleApplicationDbContext](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:15`) is the
abstract, engine-agnostic context declaring the single `Users` set (`:22`); the concrete per-engine
class (`SQLServerDbContext` today) inherits it, and the base
[ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext) supplies audit stamping,
soft-delete query filters, and outbox / domain-event dispatch via interceptors. Identity owns its own
`ADC_Identity` database with its own `dbo.OutboxMessages`, so it never races another service's outbox
(database-per-service, ADR-006). [UserConfiguration](#userconfiguration)
(`MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12`) maps the
[Email](group-02-domain-building-blocks.md#email) value object through a value converter (`:20-26`),
mirrors the invariant length constants onto the columns, ignores the computed `FullName` and
`IsExternalLogin` members (`:114-115`), and pins four indexes that encode business rules as schema
([Rubric §8, Data Architecture]): unique `Email` (`:117`), a filtered index on `RefreshToken` for the
refresh lookup (`:119-120`), a filtered **unique** index on `LinkedSpeakerId` that enforces the 1:1
User-to-Speaker relationship of BR-208 (`:122-124`), and a filtered unique composite on
`(LoginProvider, ProviderKey)` for external accounts (`:126-128`).
[SoftDeletedUserValidator](#softdeleteduservalidator)
(`MMCA.ADC.Identity.Application/Users/SoftDeletedUserValidator.cs:10`) implements the shared
[ISoftDeletedUserValidator](group-08-auth.md#isoftdeleteduservalidator) (G08) with a single
filter-bypassing `ExistsAsync` (`:21-24`), so the request pipeline's soft-deleted-user middleware can
reject tokens belonging to erased accounts (BR-133).

Seeding is gated, not ambient. [IdentityModuleSeeder](#identitymoduleseeder)
(`MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14`) returns immediately unless
`Seeding:IncludeSampleUsers` is set (`:28-30`, defaulting to false so a production service that sets
nothing seeds nothing), and only then runs [IdentityModuleDbSeeder](#identitymoduledbseeder)
(`MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:16`), whose
deliberately weak development credentials are documented in its own remarks (`:11-15`) and whose three
seed steps each check for an existing email first, making the seeder idempotent (`:27-29,37-41`). When
the Identity module is *disabled* in a host, the [IdentityModule](#identitymodule) descriptor registers
the [DisabledAttendeeQueryService](#disabledattendeequeryservice) null-object stub through
`RegisterDisabledStubs` (`IdentityModule.cs:19-20`), so a consumer that only needs the attendee list
still composes.

## Crossing the service boundary: gRPC and integration events

Identity talks to its peers two ways, and both live in `Shared` and `Contracts` so neither side reaches
into the other's domain ([Rubric §7, Microservices Readiness]). **Synchronously**, the Notification
service needs the set of active attendee user ids; it depends on the
[IAttendeeQueryService](#iattendeequeryservice) interface, implemented in-process by
[AttendeeQueryService](#attendeequeryservice)
(`MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11`), a projected read of ids for users in
the `Attendee` role (`:17-20`). Once Identity runs as its own process, the composition root swaps in
[AttendeeQueryServiceGrpcAdapter](#attendeequeryservicegrpcadapter)
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14`), which
implements the *same* C# interface over a generated client and pins a 5-second per-call deadline (`:20`)
far tighter than the shared resilience budget so a hung peer fails fast rather than stalling a broadcast
notification; [AttendeesGrpcService](#attendeesgrpcservice)
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19`) serves the other
end by delegating to the in-process implementation. The swap itself is the Contracts-layer
`AddIdentityAttendeeClient` (`MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14`), which uses
`Replace` rather than `TryAdd` so it overwrites both the real service and the disabled stub, and which
must run after `ModuleLoader.DiscoverAndRegister`. Consumer code never changes, only the registration
does (ADR-007, ADR-008). The extracted host itself runs h2c-only for cross-service gRPC, with an
optional HTTP/1.1-only health-probe listener added by [KestrelConfiguration](#kestrelconfiguration) when
`HealthProbe:Port` is configured (`MMCA.ADC.Identity.Service/KestrelConfiguration.cs:31-40`, ADR-012).

**Asynchronously**, the User-to-Speaker link is kept consistent by events, not by a cross-database
foreign key. When a user registers, [AuthenticationService](#authenticationservice) raises
[UserRegistered](#userregistered)
(`MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23`, a
[BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent)) on the aggregate, and the outbox
carries it to Conference, whose
[UserRegisteredHandler](group-18-conference-application.md#userregisteredhandler) runs the speaker
email-match auto-link (BR-207). Conference then publishes
[SpeakerLinkedToUser](group-17-conference-domain.md#speakerlinkedtouser) /
[SpeakerUnlinkedFromUser](group-17-conference-domain.md#speakerunlinkedfromuser) back, which
[SpeakerLinkedToUserHandler](#speakerlinkedtouserhandler)
(`MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20`) and
[SpeakerUnlinkedFromUserHandler](#speakerunlinkedfromuserhandler) consume to set or clear
`User.LinkedSpeakerId`, so the `speaker_id` claim appears on the *next* token issued (eventual
consistency, BR-209). These handlers open their own DI scope (`SpeakerLinkedToUserHandler.cs:31`), are
idempotent (they return early when the link already matches, `:43-46`), and log-and-swallow every
non-cancellation exception (`:53-56`), because re-delivery over the broker is expected. This
event-carried link is what lets the bidirectional User-to-Speaker relationship survive the service split
([Rubric §6, CQRS and Event-Driven], ADR-006 / ADR-008).

## The UI edge

The Blazor surface is registered as an [IdentityUIModule](#identityuimodule)
(`MMCA.ADC.Identity.UI/IdentityUIModule.cs:13`) descriptor that contributes two
[NavItem](group-15-common-ui-framework.md#navitem)s as resource keys, "My Profile" for every signed-in
user and "Users" for Organizers (`IdentityUIModule.cs:16-19`, ADR-027), their routes coming from the
[IdentityRoutePaths](#identityroutepaths) constants `/profile` and `/users`
(`IdentityRoutePaths.cs:8-9`). The [Profile](#profile) page
(`MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15`) lets an authenticated user change their
password, manage their avatar, and delete their account. It mirrors the server's 2 MB cap client-side
before any upload starts (`Profile.razor.cs:25,125`), and it accepts an image from either a browser file
input or, on MAUI, the camera and gallery through
[IMediaPickerService](group-26-device-capability-layer.md#imediapickerservice)
(`Profile.razor.cs:19,86,88`). It talks to the API through the [IUserUIService](#iuseruiservice)
abstraction implemented by [UserService](#userservice)
(`MMCA.ADC.Identity.UI/Services/UserService.cs:14`), an
[AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase) subclass that
attaches the bearer token and calls the REST `users` resource. [UserList](#userlist)
(`MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`) is the Organizer-only management grid: a
`DataGridListPageBase<UserListDTO>` with server-side filtering, sorting, and paging on a desktop data
grid, plus a card-based infinite-scroll layout on mobile viewports, the two kept in sync by the shared
[ListPageActions](#listpageactions) helper (`UserList.razor.cs:39,76`). The whole UI targets WCAG 2.1
AA, and the login, register, and profile flows are covered by axe-core scans in the deploy-gating E2E
suite ([Rubric §21, Accessibility], [Rubric §22, Responsive and Cross-Browser]).

## End-to-end: one registration

To see the chapter cooperate, follow a new attendee signing up. [AuthController](#authcontroller)
receives the `register` POST, captures the client IP for BR-213 rate limiting (`AuthController.cs:48`),
and calls `RegisterAsync` on [AuthenticationService](#authenticationservice), which opens one
transaction (`AuthenticationService.cs:61`) and hands off to the shared G08 engine. The request shape
was already checked by [RegisterRequestValidator](#registerrequestvalidator)
(`MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:11`) in the pipeline, so
the engine only has to confirm the email is not taken (query-filter-bypassed, so an erased address stays
reserved), call `User.Create(...)` with the `Attendee` role, hash the password, add the aggregate, and
save. Only *after* that first save, when the EF identity id exists, does `OnUserRegisteredAsync` raise
[UserRegistered](#userregistered) and save again (`AuthenticationService.cs:105-110`); both saves sit
inside the one transaction, so the user row and its outbox row commit atomically (ADR-003). The first
token returned does not yet carry `speaker_id`. Asynchronously, Conference matches the email to a
speaker and publishes `SpeakerLinkedToUser`; [SpeakerLinkedToUserHandler](#speakerlinkedtouserhandler)
sets `User.LinkedSpeakerId`, and the attendee's *next* token carries the claim. No password left the
domain in plaintext, no cross-database foreign key was written, no event was hand-dispatched, and the
same code path behaves identically whether Identity runs inside the monolith or as its own service,
which is exactly the property the framework groups (G01 through G15) exist to provide. For the *why*
behind each choice, ADR-003 (outbox), ADR-004 (JWKS), ADR-005 (soft-delete versus erasure),
ADR-006 / 007 / 008 (database-per-service, gRPC extraction, service topology), ADR-012 (mixed Kestrel
endpoint profile), ADR-020 (permission registry), ADR-027 / ADR-028 (culture and theme), ADR-029 (login
protection), and ADR-045 (file storage and avatars) are the primary references.

### AssemblyReference
> MMCA.ADC.Identity.{API,Application} · `MMCA.ADC.Identity.{API,Application}` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the per-layer assembly marker, one static class holding the layer's own `Assembly` and its `AssemblyName` string. It carries no behavior; it exists so reflection-driven code can name an assembly without a magic string. This unit covers the **API** and **Application** copies (the Domain and Infrastructure copies are byte-identical and belong to their own layers).

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AssemblyReference` (API) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:5` | resolves to `MMCA.ADC.Identity.API` |
| `AssemblyReference` (Application) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/AssemblyReference.cs:5` | resolves to `MMCA.ADC.Identity.Application` |

- **Depends on**: `System.Reflection` only (BCL). No first-party types.
- **Concept introduced, the assembly marker.** The pattern is taught for the framework's own layers in [G14](group-14-module-system-composition.md#assemblyreference); this is its Identity realization. `Assembly` is initialized from `typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`), so it always resolves to the assembly that *declares* the marker: that is why the type is duplicated per layer instead of shared. `[Rubric §15, Best Practices & Code Quality]` (assesses idiomatic, low-ceremony conventions): a `typeof` handle survives a project rename, a `Assembly.Load("MMCA.ADC.Identity.Application")` string does not.
- **Walkthrough**: two `public static readonly` fields, `Assembly` (`:7`) and `AssemblyName = Assembly.GetName().Name ?? string.Empty` (`:8`). The null-coalescing guard is there because `AssemblyName.Name` is declared nullable in the BCL.
- **Why it's built this way**: static readonly fields are computed once at type initialization, so the reflection cost is paid a single time per process rather than at every scan site.
- **Where it's used**: as the stable handle for assembly-scanning code (Scrutor convention registration, EF configuration discovery, architecture tests). The scanning call itself takes the sibling [`ClassReference`](#classreference) as its generic argument.

---

### ChangePreferencesRequest
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesRequest.cs:10` · Level 0 · record (sealed)

- **What it is**: the inbound payload that updates one user's stored UI preferences, their preferred culture and their preferred theme.
- **Depends on**: nothing first-party. Two `string?` positional parameters, no BCL types beyond `record`.
- **Concept introduced, the partial-update DTO where `null` means "leave unchanged".** `[Rubric §9, API & Contract Design]` (assesses unambiguous payload semantics) and `[Rubric §27, Internationalization]` (assesses whether locale is a persisted, first-class user choice rather than a per-request setting). The record is `(string? Culture, string? Theme)` (`ChangePreferencesRequest.cs:10`), and the doc comment (`:3-9`) states the contract: a `null` field leaves that preference untouched. That is what lets two independent UI affordances, the app-bar culture switcher (which sends only `Culture`) and the theme toggle (which sends only `Theme`), share one endpoint without clobbering each other. The theme half is also the `[Rubric §20, Design System & Theming]` story: a persisted light/dark choice rather than a per-tab toggle.
- **Walkthrough**: a single-line positional record (`:10`) with no body. No validation attributes: the allow-list check for culture and the light/dark check for theme run in the domain (`User.UpdatePreferences`), reached through [`ChangePreferencesHandler`](#changepreferenceshandler).
- **Why it's built this way**: nullable fields give partial-update semantics without a JSON Patch document or per-field "was it set" flags, and keeping the validation in the aggregate means the rules travel with the model rather than with this DTO.
- **Where it's used**: carried as the `Request` member of [`ChangePreferencesCommand`](#changepreferencescommand), bound from the request body by [`UsersController`](#userscontroller).

---

### ClassReference
> MMCA.ADC.Identity.{API,Application} · `MMCA.ADC.Identity.{API,Application}` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty, member-less class that exists purely to be a *type argument*. Generic scanning APIs of the shape `DoSomething<T>()` derive the target assembly from `typeof(T).Assembly`, so each layer ships its own `ClassReference` to point such a call at itself.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `ClassReference` (API) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:11` | declared but not used by the API layer's own registration |
| `ClassReference` (Application) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/AssemblyReference.cs:11` | the `T` in `ScanModuleApplicationServices<ClassReference>()` |

- **Depends on**: nothing. `public class ClassReference { }`, no base type beyond `object`, no members.
- **Concept introduced**: cross-reference [`AssemblyReference`](#assemblyreference) above. The two solve the same problem from opposite directions: `AssemblyReference` hands out an `Assembly` *value*, `ClassReference` hands out a *type* that a generic constraint-free method can turn into one.
- **Walkthrough**: the whole declaration is one line (`AssemblyReference.cs:11`). It is deliberately not `static` and not `sealed`, because a static class cannot be used as a generic type argument.
- **Why it's built this way**: `ScanModuleApplicationServices<T>()` reads better and refactors more safely than passing an `Assembly` argument, and a dedicated empty type avoids accidentally anchoring the scan to some real class that might later move to another project.
- **Where it's used**: the Application copy is the type argument at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:37` (see [`DependencyInjection`](#dependencyinjection) for the Application layer).
- **Caveats / not-in-source**: whether the API-layer copy has an active consumer is `Not determinable from source` within this unit; the API registration (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:42-58`) does not reference it.

---

### IdentityErrorResources
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Resources` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` · Level 0 · class (sealed)

- **What it is**: an empty "resource anchor" type for the Identity module's localized error messages. It has no members; its only job is to be a `typeof(...)` handle that the localization layer uses to find the co-located `.resx` files (ADR-027).
- **Depends on**: nothing first-party. At runtime its `.resx` siblings are loaded through `System.Resources` / `IStringLocalizerFactory` (BCL and ASP.NET Core).
- **Concept introduced, edge error-message localization keyed by error `Code`.** `[Rubric §27, Internationalization]` (assesses whether user-facing strings, error text included, are translated rather than English-only). ADR-027 localizes failures **at the API edge**: a domain [`Error`](group-01-result-error-handling.md#error)'s `Code` (for example `"User.Email.Empty"`) is the resource key, and the shared [`IErrorLocalizer`](group-12-api-hosting-mapping.md#ierrorlocalizer) looks that key up across every registered resource source before the failure is written into the ProblemDetails response. Each module contributes translations *additively* by registering its own anchor type, so Identity's strings live in `IdentityErrorResources.resx` / `IdentityErrorResources.es.resx` rather than in one central framework file.
- **Walkthrough**: the class body is empty (`IdentityErrorResources.cs:11-13`); everything worth knowing is in the doc comment (`:3-10`), which records two design points: keys are the domain error `Code`, and **runtime-variable messages** (those that interpolate a user-supplied value) are deliberately omitted from the `.resx` so they degrade to their English message with the value intact instead of showing a broken or value-less translation.
- **Why it's built this way**: `AddErrorResources<TResource>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:103`) builds an `IStringLocalizer` from `typeof(TResource)` and appends it to the set of error-resource sources; the convention "a `.resx` named after the type, sitting beside it" is what binds the strings, so an empty marker class is exactly enough.
- **Where it's used**: registered at startup by the extracted Identity host, `services.AddErrorResources<IdentityErrorResources>()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:232`).

---

### IExternalLoginEmailVerifier
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11` · Level 0 · interface

- **What it is**: a one-method port that answers a single question about the OAuth login currently in flight: did the external provider explicitly assert that this email address is verified? It is the gate that decides whether an external identity may be auto-linked to an existing local account.
- **Depends on**: nothing first-party. The single method returns `Task<bool>` and takes no arguments, deliberately: the "current external login" is ambient request state, resolved by the implementation, not passed by the caller.
- **Concept introduced, the account-takeover guard as an explicit port.** `[Rubric §11, Security]` (assesses whether authentication trust decisions are explicit and fail closed) and `[Rubric §3, Clean Architecture]` (assesses dependencies pointing inward). Linking an external identity to a local account on nothing but an email match is a takeover primitive: any provider that hands out unverified email addresses would let an attacker register the victim's address and inherit the victim's account. The verified-email assertion lives in the short-lived `ExternalLogin` cookie principal, which is an HTTP concern, so the *decision input* is declared here as an interface in the Application layer and *implemented* at the API edge. Application code stays free of `HttpContext`, and the security rule stays testable with a two-line fake. `[Rubric §1, SOLID]`: an interface with exactly one method and exactly one reason to change.
- **Walkthrough**: `Task<bool> IsCurrentExternalLoginEmailVerifiedAsync()` (`IExternalLoginEmailVerifier.cs:19`). The XML comment (`:13-18`) fixes the semantics precisely: `true` only when the provider *explicitly* asserts verification (Google's `email_verified` claim); providers that assert nothing (GitHub's OAuth flow) yield `false`. There is no third "unknown" state, unknown is treated as unverified.
- **Why it's built this way**: fail-closed by construction. Because the contract collapses "not verified" and "no assertion" into `false`, adding a new provider cannot silently open the auto-link path; it stays closed until someone deliberately maps a verification claim for it.
- **Where it's used**: consumed by [`AuthenticationService`](#authenticationservice) inside the external-login workflow (`AuthenticationService.cs:173-182`); implemented by [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier), which re-authenticates the `ExternalLogin` scheme and reads the `email_verified` claim (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:32-35`), returning `false` when there is no `HttpContext`, no principal, or no parseable claim.

---

### DependencyInjection
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:18` · Level 2 · class (static)

- **What it is**: the **API-layer** composition root for the Identity module. It exposes `AddIdentityModule(...)`, the single call that registers every layer of the module, plus `AddModuleIdentityAPI()`, which declares the module's role-to-permission grants and wires the OAuth email-verification gate.
- **Depends on**: `IServiceCollection` and `TryAddScoped` (Microsoft.Extensions.DependencyInjection); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); the Application-layer `AddModuleIdentityApplication` (see [`DependencyInjection`](#dependencyinjection) for the Application layer) and the Infrastructure-layer `AddModuleIdentityInfrastructure`; [`AuthorizationExtensions`](group-08-auth.md#authorizationextensions)'s `AddPermissions`, plus [`IdentityPermissions`](#identitypermissions) and [`RoleNames`](group-08-auth.md#rolenames); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) and [`HttpContextExternalLoginEmailVerifier`](#httpcontextexternalloginemailverifier).
- **Concept introduced, the layered DI fan-out via `extension(IServiceCollection)`.** `[Rubric §3, Clean Architecture]` (assesses inward-pointing dependencies and a single composition point per module): the API layer is the only layer that can see *all* the others, so it owns the aggregate registration. The method hangs off `IServiceCollection` through the C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:20`), the workspace idiom for DI registration (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `[Rubric §16, Maintainability]`: the three-call body mirrors the layering, so registration order matches dependency order and there is exactly one place to look when wiring changes.
- **Walkthrough**
  - `AddIdentityModule(ApplicationSettings)` (`:27-34`) calls `AddModuleIdentityApplication(applicationSettings)` (`:29`), `AddModuleIdentityInfrastructure()` (`:30`), and `AddModuleIdentityAPI()` (`:31`), then returns `services` for chaining (`:33`).
  - `AddModuleIdentityAPI()` (`:42-58`) does two things. First it calls `AddPermissions` and grants **every** capability in [`IdentityPermissions`](#identitypermissions) to both `RoleNames.Organizer` (`:46`) and `RoleNames.Admin` (`:47`) via the spread `[.. IdentityPermissions.All]`; those grants are what back the module's `[HasPermission(...)]`-gated endpoints. Second it registers the OAuth auto-link gate: `AddHttpContextAccessor()` (`:54`) plus `TryAddScoped<IExternalLoginEmailVerifier, HttpContextExternalLoginEmailVerifier>()` (`:55`). The inline comment (`:50-53`) explains the placement: the verified-email assertion lives in the external-login cookie principal, so the verifier is an API-edge concern.
  - Controllers are not registered here; ASP.NET Core's controller convention discovers them (doc comment `:36-41`).
- **Why it's built this way**: one entry point per module is what [`IdentityModule`](#identitymodule) calls, so module wiring stays discoverable; declaring the role-to-permission grants inside the module that owns the endpoints keeps the capability model co-located with the code it protects instead of in a central authorization file every module must reach into. `TryAddScoped` (rather than `AddScoped`) leaves the door open for a host to pre-register a different verifier.
- **Where it's used**: `AddIdentityModule` is invoked by [`IdentityModule`](#identitymodule)'s `Register` (`IdentityModule.cs:23-24`) during topological module registration by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).

---

### IdentityModule
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's entry point, the concrete [`IModule`](group-14-module-system-composition.md#imodule) that the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) discovers by reflection and registers. Identity is a **leaf** in the module dependency graph: it declares no prerequisites.
- **Depends on**: [`IModule`](group-14-module-system-composition.md#imodule); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); its own [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule`; [`IAttendeeQueryService`](#iattendeequeryservice) and [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) from the Shared layer; `Microsoft.Extensions.{Configuration,DependencyInjection}`.
- **Concept introduced, the disabled-module stub.** The module contract itself is taught in [G14](group-14-module-system-composition.md#imodule); the Identity-specific lesson is `RegisterDisabledStubs`. `[Rubric §7, Microservices Readiness]` (assesses whether modules compose and deploy independently): every ADC host boots the same module assemblies but enables only some of them. A host with Identity *disabled* still contains consumers that depend on `IAttendeeQueryService` (Notification needs the attendee id list), so this method registers [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) as a singleton (`IdentityModule.cs:19-20`), a stub that returns an empty list. DI validation succeeds, the consumer degrades gracefully, and in the extracted topology the composition root later *replaces* that stub with a gRPC-backed adapter.
- **Walkthrough**: three members, all one-liners. `Name => "Identity"` (`:16`) is the topological-sort key and the value the loader logs. `RegisterDisabledStubs(IServiceCollection)` (`:19-20`) registers the stub singleton. `Register(IServiceCollection, IConfigurationBuilder, ApplicationSettings)` (`:23-24`) delegates straight to `services.AddIdentityModule(applicationSettings)`. No dependency-declaration members are overridden, so the interface defaults apply (a leaf). There is deliberately **no seeding here**: that is a separate [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder), [`IdentityModuleSeeder`](#identitymoduleseeder).
- **Why it's built this way**: the module boundary is what makes each module extractable into its own service host without a rewrite (ADR-007 / ADR-008). In the extracted `MMCA.ADC.Identity.Service` only this module is enabled; every other service registers the disabled stub and then overwrites it with a gRPC client. Application code never learns which transport it got.
- **Where it's used**: discovered and registered in Kahn-topological order by the [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) at host startup; `RegisterDisabledStubs` runs in hosts where the Identity module is not enabled.

---

### ChangePreferencesCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:12` · Level 7 · record (sealed)

- **What it is**: the command that persists one user's culture/theme preferences, the write side of ADR-027 / ADR-028. It pairs the target `UserId` with the partial [`ChangePreferencesRequest`](#changepreferencesrequest) and opts into cache invalidation so a preference change cannot be masked by a stale cached read.
- **Depends on**: [`ChangePreferencesRequest`](#changepreferencesrequest); the `UserIdentifierType` alias (`= int`, see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); [`User`](#user) (only for `typeof(User).FullName`); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Concept introduced, the cache-invalidating command.** `[Rubric §6, CQRS & Event-Driven]` (assesses commands as explicit, named intentions separated from reads) and `[Rubric §12, Performance & Scalability]` (assesses caching with correct invalidation). The record implements `ICacheInvalidating` (`ChangePreferencesCommand.cs:12`) and exposes `CachePrefix => $"{typeof(User).FullName}:"` (`:15`). The caching decorator in the [command pipeline](group-05-cqrs-pipeline.md#icacheinvalidating) reads that prefix and evicts every entry under it once the handler succeeds. Deriving the prefix from `typeof(User).FullName` rather than a literal keeps it in lockstep with the key the user cache actually uses: rename or move the type and the prefix follows.
- **Walkthrough**: a two-parameter positional record, `(UserIdentifierType UserId, ChangePreferencesRequest Request)` (`:12`), plus the single computed `CachePrefix` property (`:15`). `UserId` is supplied by the controller from the authenticated principal, never from the request body; `Request` is the partial payload.
- **Why it's built this way**: separating "who" (from the JWT) from "what" (from the body) makes it structurally impossible for a request to target another user's preferences, and expressing invalidation as an interface the command implements keeps eviction a cross-cutting decorator concern instead of handler boilerplate.
- **Where it's used**: handled by [`ChangePreferencesHandler`](#changepreferenceshandler); dispatched by [`UsersController`](#userscontroller) from the profile page and the app-bar culture/theme switchers.

---

### AttendeeQueryService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` · Level 8 · class (sealed)

- **What it is**: Identity's in-process implementation of the cross-module [`IAttendeeQueryService`](#iattendeequeryservice) contract. It answers one question, "which user ids hold the Attendee role", and it is the only way another module gets that answer without touching the Identity domain.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (the Shared-layer contract); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and the read side of [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype); [`User`](#user) and [`UserRole`](#userrole) (Domain); the `UserIdentifierType` alias.
- **Concept introduced, serving data across a module boundary through a Shared-layer contract.** `[Rubric §7, Microservices Readiness]` (assesses whether cross-module needs are met by explicit contracts rather than direct type references) and `[Rubric §3, Clean Architecture]`. Notification must fan a broadcast out to every attendee, but it must never reference `MMCA.ADC.Identity.Domain`. The interface therefore lives in `MMCA.ADC.Identity.Shared`, the implementation here in Application, and Notification sees only the interface. That indirection is exactly what later allows the same call to be satisfied over gRPC with no change at the call site. `[Rubric §12, Performance & Scalability]`: the query projects to ids in the database rather than materializing whole `User` rows, so the wire and the heap only ever carry integers.
- **Walkthrough** (primary-constructor injection of `IUnitOfWork`, `:11`)
  1. **Read repository** (`:16`), `unitOfWork.GetReadRepository<User, UserIdentifierType>()`, the read-only repository facade rather than the mutating one, so the intent is visible in the type.
  2. **Projected query** (`:17-20`), `GetProjectedAsync(u => u.Id, u => u.Role == UserRole.Attendee, cancellationToken: cancellationToken)`. The first lambda is the SELECT projection, the second the WHERE predicate; the global soft-delete query filter is left in force, so erased accounts are excluded automatically (that is what "active users" in the contract means, no explicit `IsDeleted` test appears here).
  3. **Shape the result** (`:22`), `userIds as IReadOnlyList<UserIdentifierType> ?? [.. userIds]`: the repository returns `IReadOnlyCollection<T>`, the contract promises `IReadOnlyList<T>`, so the cast is attempted first and a collection-expression copy is the fallback. No allocation when the underlying instance is already a list.
- **Why it's built this way**: pushing the role predicate and the id projection into the database keeps a broadcast cheap even as the attendee count grows, and relying on the global query filter for soft-delete means this service can never accidentally diverge from the rest of the system's definition of "deleted" (ADR-005).
- **Where it's used**: registered as the `IAttendeeQueryService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:33`); consumed by the Notification module. In the extracted topology the registration is replaced by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), and this class becomes the code behind [`AttendeesGrpcService`](#attendeesgrpcservice) on the Identity side.

---

### ChangePreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:13` · Level 8 · class (sealed, partial)

- **What it is**: the command handler that loads the target [`User`](#user), applies a **partial** preference update where each omitted field falls back to the stored value, saves, and logs.
- **Depends on**: `ICommandHandler<TCommand, TResult>` from the [CQRS pipeline](group-05-cqrs-pipeline.md#icacheinvalidating); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user) and its `UpdatePreferences` method; [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` and its `[LoggerMessage]` source generator.
- **Concept introduced, the null-coalescing merge plus source-generated logging.** `[Rubric §6, CQRS & Event-Driven]` (a command handler mutates and saves; it does not shape reads) and `[Rubric §27, Internationalization]` (persisting the locale choice is what makes it survive a new session). The merge is one expression (`ChangePreferencesHandler.cs:27-29`): `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)`. A request carrying only `Culture` re-supplies the *current* theme, and vice versa, which is precisely why a one-field switcher cannot wipe the other preference. Validation is not the handler's job: `User.UpdatePreferences` combines the culture allow-list and light/dark invariants and returns a [`Result`](group-01-result-error-handling.md#result) that this handler simply propagates. `[Rubric §13, Observability & Operability]`: the success log goes through a `[LoggerMessage]`-generated method (`:39-40`), which is why the class must be declared `partial`; the generator emits an allocation-free, strongly-typed log call instead of a boxed `ILogger.LogInformation` invocation.
- **Walkthrough** (primary constructor `:13-15`, body `:18-37`)
  1. **Fetch** (`:22-23`), `unitOfWork.GetRepository<User, UserIdentifierType>()` then `GetByIdAsync(command.UserId, cancellationToken)`.
  2. **Not-found guard** (`:24-25`), a `null` user returns `Result.Failure(Error.NotFound.WithSource(nameof(ChangePreferencesHandler)).WithTarget(nameof(User)))`, the fluent error-tagging builders that let the edge report *what* was missing without a bespoke error type.
  3. **Apply** (`:27-29`), the null-coalesced `UpdatePreferences` call, which returns a `Result` carrying any invariant failure.
  4. **Persist and log** (`:30-34`), only when `result.IsSuccess` does it `await unitOfWork.SaveChangesAsync(cancellationToken)` and emit `LogPreferencesChanged(logger, command.UserId)`.
  5. **Return** (`:36`), the domain `result` unchanged, success or failure.
- **Why it's built this way**: guarding both the save and the log behind `IsSuccess` means a rejected culture or theme produces a clean failure (mapped to a 400 at the edge) with no write and, just as important, no misleading "preferences changed" log line for an operator to chase.
- **Where it's used**: discovered by Scrutor convention scanning (one `ICommandHandler` per command) and invoked by [`UsersController`](#userscontroller); wrapped by the decorator pipeline, whose caching decorator performs the eviction declared on [`ChangePreferencesCommand`](#changepreferencescommand).
- **Caveats / not-in-source**: `UpdatePreferences` persists the two columns but raises no domain event, so a preference change writes the row and publishes nothing to the outbox. Whether a given database has the preference columns is an operational fact about applied migrations, not visible in this source file.

---

### SoftDeletedUserValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/SoftDeletedUserValidator.cs:10` · Level 8 · class (sealed)

- **What it is**: Identity's implementation of the framework contract [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (BR-133). It answers "is this user id a soft-deleted account?" so the shared middleware can reject a token that outlived its account.
- **Depends on**: [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (`MMCA.Common.Application`); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype); [`User`](#user); the `UserIdentifierType` alias.
- **Concept introduced, deliberately bypassing the global query filter.** `[Rubric §11, Security]` (assesses whether revoked access is enforced on every request, not just at login) and `[Rubric §8, Data Architecture]` (assesses soft-delete as a first-class concept). Access tokens are self-contained and valid until they expire, so deleting an account does not by itself stop the already-issued token: the framework closes that window with a per-request check. The catch is that a soft-deleted `User` is *invisible* to normal queries, the EF global query filter removes it, so an "is deleted" test written the obvious way would always find nothing. This class therefore passes `ignoreQueryFilters: true` (`SoftDeletedUserValidator.cs:23`), the one sanctioned place to look past the filter. `[Rubric §12, Performance & Scalability]`: the check is a single `ExistsAsync` (an `EXISTS` probe) rather than a load-then-inspect, because it runs on every authenticated request.
- **Walkthrough** (primary constructor `:10-11`, method `:14-25`): resolve the repository (`:18`), then `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, cancellationToken: cancellationToken)` (`:21-24`). The predicate deliberately fuses both conditions so one round trip covers "exists" and "is deleted", as the inline comment (`:20`) notes. A never-existing id and a live id both return `false`; only a soft-deleted row returns `true`.
- **Why it's built this way**: the contract lives in `MMCA.Common.Application` and the implementation here so the framework middleware never references the ADC Identity domain, the same inversion used for [`IAttendeeQueryService`](#iattendeequeryservice). It also means a host without Identity simply has no implementation registered, and the middleware skips the check rather than failing.
- **Where it's used**: resolved lazily per request by [`SoftDeletedUserMiddleware`](group-12-api-hosting-mapping.md#softdeletedusermiddleware) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:53`), which returns HTTP 401 when the answer is `true` (`:69`). Registered by the Application-layer [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:32`).

---

### AuthenticationService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35` · Level 9 · class (sealed)

- **What it is**: ADC's authentication service. The generic login / registration / refresh / revocation workflow is inherited from [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser); this subclass supplies the ADC-specific pieces: the Attendee default role, the `speaker_id` claim, the outbox-atomic [`UserRegistered`](#userregistered) integration event, and the entire external OAuth login flow.
- **Depends on**: [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser) and [`IAuthenticationService`](group-08-auth.md#iauthenticationservice); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ITokenService`](group-08-auth.md#itokenservice), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), `TimeProvider` (BCL); [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier); [`User`](#user), [`UserRole`](#userrole), [`UserRegistered`](#userregistered), [`Email`](group-02-domain-building-blocks.md#email), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and [`RegisterRequest`](group-08-auth.md#registerrequest).
- **Concept introduced (1), the template-method base with app-specific hooks.** `[Rubric §2, Design Patterns]` (assesses whether recurring shapes use a named, understood pattern) and `[Rubric §16, Maintainability]`. The base owns the security-critical sequence: validate first, ADR-029 lockout and registration rate limits, refresh-token rotation with reuse detection (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:134-187`). What varies per application is expressed as four abstract hooks and one virtual one, and this class overrides exactly those:
  - `FindUntrackedByEmailAsync` (`AuthenticationService.cs:66-74`), an untracked read used by the login path.
  - `EmailExistsAsync` (`:78-79`), the registration uniqueness probe, with `ignoreQueryFilters: true` so a **soft-deleted (erased) account's email cannot be re-registered** (`:77`), the same filter-bypass reasoning as [`SoftDeletedUserValidator`](#softdeleteduservalidator).
  - `CreateUser` (`:82-89`), which fixes ADC's default role as `UserRole.Attendee` (BR-45).
  - `CreateAccessToken` (`:92-93`), which appends the `speaker_id` claim when the account is linked to a speaker; the claim is built by the private `SpeakerClaims` helper (`:228-229`), returning `null` when `LinkedSpeakerId` has no value so the claim is simply absent rather than empty (BR-209).
  - `OnUserRegisteredAsync` (`:105-110`), the post-save hook, below.
- **Concept introduced (2), the outbox-atomic registration event, and why it needs two saves in one transaction.** `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience & Business Continuity]`. `User.Id` is a database-generated identity column, so at the moment the aggregate is created the id is still `0`. The outbox serializes an event's payload *at capture time*, so raising [`UserRegistered`](#userregistered) before the insert would persist `UserId = 0`, and the cross-service Conference consumer, which has no access to the Identity database to re-match by email, could never resolve it. The fix is visible in two places:
  - `RegisterAsync` (`:57-63`) re-implements the interface member with `new` and wraps the base implementation in `UnitOfWork.ExecuteInTransactionAsync(token => base.RegisterAsync(request, ipAddress, token), cancellationToken)`. The interface is re-listed on the class declaration (`:44`) specifically so this override wins for callers holding an `IAuthenticationService`, since the base method is not virtual.
  - `OnUserRegisteredAsync` (`:105-110`) runs *after* the base's first save, when the identity value exists: it calls `user.AddDomainEvent(new UserRegistered(user.Id, user.Email, user.FirstName, user.LastName, user.Role))` (`:107`) and saves a second time (`:108`) so the outbox row is captured. Both saves sit inside the one transaction opened by `RegisterAsync`, so a crash before commit rolls back user and event together, and after commit the outbox processor guarantees delivery. The class doc comment (`:21-33`) records that this replaced an earlier second-commit `IEventBus` publish whose crash window lost the speaker link permanently.
- **Concept introduced (3), the three-way external-login resolution with a takeover guard.** `[Rubric §11, Security]`. `ExternalLoginAsync` (`:123-132`) is again a transaction wrapper around `ExternalLoginCoreAsync` (`:135-223`), which resolves the caller into exactly one of three cases:
  1. **Known external identity** (`:144-149`), a tracked lookup by `LoginProvider` **and** `ProviderKey`. Found means log in.
  2. **Email matches an existing local account** (`:157-186`), the risky case. Before linking, it awaits `externalLoginEmailVerifier.IsCurrentExternalLoginEmailVerifiedAsync()` (`:173-174`) and, when the provider did not assert a verified email, returns `Error.Unauthorized("Auth.ExternalEmailNotVerified", ...)` (`:178-182`) telling the user to log in with their password instead. Only a verified assertion reaches `existingUser.LinkExternalProvider(loginProvider, providerKey)` (`:184`). The comment (`:167-172`) states the threat plainly: without this gate, any provider that hands out unverified emails would let an attacker claim a victim's local account.
  3. **Brand new user** (`:190-198`), `User.CreateExternal(...)`, failure propagated as `Result.Failure<AuthenticationResponse>(userResult.Errors)` (`:193`), otherwise `Repository.AddAsync` and `isNewUser = true`.
  All three paths then converge (`:202-222`): mint and store a refresh token with `TimeProvider.GetUtcNow().UtcDateTime.Add(RefreshTokenLifetime)` (`:203`), save (`:205`), and, for a new user only, raise [`UserRegistered`](#userregistered) and save again (`:211-215`), the same post-identity pattern as local registration. Finally it mints the access token (`:217`) and returns `AuthenticationResponse` with the access-token expiry (`:219-222`).
- **Why it's built this way**: the base class keeps every application on one audited auth workflow, so a fix to lockout or refresh-token reuse detection lands once in `MMCA.Common` rather than per app; the hooks keep ADC's divergences (role, claim, event) small and named. The `UserRegistered` integration event, rather than an in-process domain event, is a deliberate divergence from MMCA.Store, because Conference runs in a separate process with its own database and can only learn about a registration asynchronously (ADR-003 outbox, ADR-006 database-per-service). The eventual-consistency cost is explicit and documented: the first token issued does not yet carry `speaker_id`, and the claim appears on the next refresh once Conference has published `SpeakerLinkedToUser` back.
- **Where it's used**: registered as the `IAuthenticationService` implementation by the Application-layer [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:30`); driven by [`AuthController`](#authcontroller) for local credentials and [`OAuthController`](#oauthcontroller) for the social paths.
- **Caveats / not-in-source**: whether `email_verified` is actually mapped for a given provider is host configuration, not visible here; the verifier's own doc comment (`HttpContextExternalLoginEmailVerifier.cs:12-14`) records that Google is mapped by a claim action in the service host and that GitHub asserts nothing.

---

### IdentityModuleSeeder
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14` · Level 9 · class (sealed)

- **What it is**: the Identity module's startup data seeder. It is a thin [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) that checks a configuration gate, resolves its dependencies from the host service provider, and delegates the actual inserts (default Organizer and Attendee accounts) to the Infrastructure-level [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Depends on**: [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder); `IConfiguration` and `IServiceProvider` (Microsoft.Extensions); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IPasswordHasher`](group-08-auth.md#ipasswordhasher); [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Concept introduced, the config-gated seeder bridge.** `[Rubric §8, Data Architecture]` (assesses deterministic, repeatable startup state), `[Rubric §11, Security]`, and `[Rubric §3, Clean Architecture]` (the API layer orchestrates, Infrastructure persists). Two design points matter here. First, the **gate**: the seeded accounts carry deliberately weak, well-known credentials, so seeding is opt-in via `Seeding:IncludeSampleUsers` (`IdentityModuleSeeder.cs:28`) and the method returns immediately when it is false (`:29-30`). `GetValue<bool>` defaults to `false` when the key is absent, so a production service that configures nothing seeds no accounts at all, exactly the same shape as the conference sample-data gate (comment `:24-27`). Second, the **bridge**: this class resolves services from the provider instead of taking them in a constructor, then constructs the DB seeder by hand (`:34`).
- **Walkthrough** (`:14-36`): `ModuleName => "Identity"` (`:17`) identifies the seeder to the loader. `SeedAsync(IServiceProvider, CancellationToken)` (`:20-36`) resolves `IConfiguration` (`:22`), evaluates the gate (`:28-30`), then resolves `IUnitOfWork` (`:32`) and `IPasswordHasher` (`:33`) with `GetRequiredService` (a missing registration fails loudly at startup), constructs `new IdentityModuleDbSeeder(unitOfWork, passwordHasher)` (`:34`), and awaits its `SeedAsync` (`:35`). `IPasswordHasher` is required because the seed data holds plaintext passwords that must be hashed before they touch the database (doc comment `:9-13`).
- **Why it's built this way**: `IModuleSeeder.SeedAsync` runs inside a scope the loader creates *after* the host is fully built, so constructor-injecting scoped services would tie the seeder's own lifetime to that scope. Resolving at the boundary keeps the object simple and scope-agnostic. Keeping the EF insert logic in the Infrastructure `*DbSeeder` keeps the API assembly free of persistence detail and leaves the insert logic independently testable.
- **Where it's used**: discovered through the `IModuleSeeder` interface and invoked at host startup after the database initialization strategy has created or migrated the schema.

---

### DependencyInjection
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:16` · Level 10 · class (static)

- **What it is**: the **Application-layer** registration for Identity. It explicitly binds four services that convention scanning cannot infer, then runs Scrutor scanning to auto-register every handler, mapper, validator, and domain-event handler in the assembly.
- **Depends on**: `IServiceCollection` and `TryAddScoped`; [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) / [`AuthenticationService`](#authenticationservice), [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) / [`SoftDeletedUserValidator`](#softdeleteduservalidator), [`IAttendeeQueryService`](#iattendeequeryservice) / [`AttendeeQueryService`](#attendeequeryservice); the `ScanModuleApplicationServices<T>` helper from `MMCA.Common.Application`; [`ClassReference`](#classreference).
- **Concept introduced, explicit registration for the ambiguous, convention scanning for the rest.** `[Rubric §2, Design Patterns]` and `[Rubric §16, Maintainability]`. Handlers, mappers, and validators follow a one-interface-one-implementation convention, so Scrutor can find them: `services.ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:37`) means adding a new use-case slice needs **no DI edit at all**. The four services that are not convention-discoverable, because their interfaces live in other assemblies or have more than one plausible implementation, are registered by hand (`:30-33`). `TryAddScoped` rather than `AddScoped` is the load-bearing detail: a host that has already registered an override (a gRPC-backed `IAttendeeQueryService`, for instance) keeps it, and the module does not clobber it.
- **Walkthrough**: `AddModuleIdentityApplication(ApplicationSettings)` (`:26-40`) lives inside an `extension(IServiceCollection services)` block (`:18`). Body order: `_ = applicationSettings;` (`:28`) discards the parameter with a comment marking it reserved for future decorator configuration; then `IAuthenticationService` to [`AuthenticationService`](#authenticationservice) (`:30`), the [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators) parameter object as a concrete registration (`:31`), `ISoftDeletedUserValidator` to [`SoftDeletedUserValidator`](#softdeleteduservalidator) (`:32`), `IAttendeeQueryService` to [`AttendeeQueryService`](#attendeequeryservice) (`:33`); then the Scrutor scan (`:37`) and `return services` (`:39`).
- **Why it's built this way**: mixing explicit and convention registration keeps the common case zero-ceremony while retaining precise control over the handful of services that need a specific lifetime or an override point. Registering the two cross-boundary implementations (`ISoftDeletedUserValidator`, `IAttendeeQueryService`) here is what closes the inversion those contracts set up: the framework and the Notification module declare the need, Identity satisfies it.
- **Where it's used**: called by the API-layer [`DependencyInjection`](#dependencyinjection)'s `AddIdentityModule` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:29`), which [`IdentityModule`](#identitymodule) calls in turn.
- **Caveats / not-in-source**: whether `applicationSettings` will ever be consumed is `Not determinable from source`; today it is only discarded (`:28`), taken solely to keep the signature uniform across modules.

### AssemblyReference
> MMCA.ADC.Identity.Domain + MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.{Domain,Infrastructure}` · Level 0 · class (static) · two layer instances (table below)

- **What it is**: the static assembly-marker for the Identity module's Domain and Infrastructure layers. Each is a handle onto its own assembly (`Assembly`) plus that assembly's simple name (`AssemblyName`), used as a stable, string-free anchor for assembly scanning.
- **Depends on**: `System.Reflection.Assembly` (BCL) only.

| Type (assembly) | File:Line | Notes |
|------|-----------|-------|
| AssemblyReference (Identity.Domain) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/AssemblyReference.cs:5` | Domain-layer marker; same two fields |
| AssemblyReference (Identity.Infrastructure) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:5` | Infrastructure-layer marker; byte-identical shape, different namespace |

- **Concept**: the assembly-marker idiom is taught at its first appearance, [`AssemblyReference`](group-17-conference-domain.md#assemblyreference); these are the Identity Domain and Infrastructure instances of the same shape. `[Rubric §5, Vertical Slice]` (assesses feature cohesion and convention-driven wiring): a marker lets Scrutor and the EF configuration scanner target an assembly via `typeof(AssemblyReference).Assembly` rather than a brittle string literal, so adding a slice needs no registration edit.
- **Walkthrough**: in each file, two `static readonly` fields, `Assembly = typeof(AssemblyReference).Assembly` (line 7) and `AssemblyName = Assembly.GetName().Name ?? string.Empty` (line 8). No methods. The two declarations differ only in their namespace (`...Domain` vs `...Infrastructure`).
- **Why it's built this way**: every module layer ships the identical marker so generic scanning code can be told *which* assembly to scan without referencing a concrete business type; the layer is identified by which `AssemblyReference` you hand it.
- **Where it's used**: the Identity module's EF configuration / seeder assembly scan (Infrastructure marker) and any reflection needing a layer assembly handle; the registration machinery lives in [G14, Module System & Composition](group-14-module-system-composition.md). The remaining layers (API, Application, Shared, UI) ship their own `AssemblyReference`, covered in the sibling parts of this chapter.

### ClassReference
> MMCA.ADC.Identity.Domain + MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.{Domain,Infrastructure}` · Level 0 · class · two layer instances (table below)

- **What it is**: an empty, non-static companion class (`public class ClassReference { }`) that lives beside each [`AssemblyReference`](#assemblyreference). It exists so a scanning API that needs an *instantiable* generic type argument (for example Scrutor's `FromAssemblyOf<T>`) has one to reference from the assembly, since `AssemblyReference` is static and some APIs reject a static type as `T`.
- **Depends on**: nothing.

| Type (assembly) | File:Line | Notes |
|------|-----------|-------|
| ClassReference (Identity.Domain) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/AssemblyReference.cs:11` | empty marker, same file as the Domain `AssemblyReference` |
| ClassReference (Identity.Infrastructure) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:11` | empty marker, same file as the Infrastructure `AssemblyReference` |

- **Concept**: cross-reference the marker idiom under [`AssemblyReference`](#assemblyreference) and its first teaching in [G17, Conference Domain](group-17-conference-domain.md#classreference).
- **Walkthrough**: no members (`public class ClassReference { }`, line 11 of each file).
- **Why it's built this way**: `FromAssemblyOf<ClassReference>()` needs an instantiable `T`; this provides one per layer without exposing any behavior.
- **Where it's used**: generic assembly-scan registrations that take a type argument.

### DependencyInjection
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:11` · Level 0 · class (static)

- **What it is**: the Infrastructure-layer DI entry point for the Identity module. Currently a deliberate **no-op placeholder**: `AddModuleIdentityInfrastructure()` returns the `IServiceCollection` unchanged (line 20).
- **Depends on**: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (NuGet) only.
- **Concept introduced**: the `extension(IServiceCollection)` DI-registration idiom (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). `[Rubric §16, Maintainability & Evolvability]` (assesses uniform, predictable structure): every module layer ships an `AddModule{Name}{Layer}()` method so the module loader can call them uniformly; an empty one is honest about "nothing to register here yet" rather than absent and surprising.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (line 13) exposing `public IServiceCollection AddModuleIdentityInfrastructure() => services;` (line 20). The doc comment (lines 5-10) records *why* it is empty: Identity has no infrastructure services beyond the EF configurations and seeder, which are discovered automatically via assembly scanning.
- **Why it's built this way**: keeping the method present even when empty means the module-registration pipeline never special-cases Identity; if Identity later needs a typed infrastructure service (a query service, a key store) it is added here without touching the caller.
- **Where it's used**: invoked from the Identity API layer's `AddIdentityModule(...)` alongside `AddModuleIdentityApplication` and `AddModuleIdentityAPI`; the module/registration machinery is covered in [G14, Module System & Composition](group-14-module-system-composition.md).
- **Caveats / not-in-source**: the Identity module ships several `DependencyInjection` classes, one per layer (this Infrastructure one at Level 0, plus the API, Application, and UI-layer ones covered in the sibling parts of this chapter). They share the bare `dependencyinjection` anchor, which in the assembled chapter resolves to the first occurrence; cross-references in other sections disambiguate by layer in prose.

### GetUserAvatarQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarQuery.cs:5` · Level 0 · record (sealed)

- **What it is**: the CQRS query that reads the signed-in user's current avatar state (BR-116a). It carries a single field, the owning `UserId`.
- **Depends on**: `UserIdentifierType` (the Identity `global using UserIdentifierType = int;` alias, see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced, the user-avatar slice.** This is the read end of a small three-operation feature (get / set / remove) that stores a profile photo as an external blob and keeps only its URL on the [`User`](#user) aggregate. The upload-security machinery is taught in full at [`SetUserAvatarHandler`](#setuseravatarhandler); this query touches none of it, it just returns whatever URL is stored (or null). `[Rubric §9, API & Contract Design]` (assesses that each operation is a small, single-purpose contract): a dedicated read query keeps the avatar read inside the same CQRS decorator pipeline as every other read rather than bolting a getter onto a service.
- **Walkthrough**: a one-line positional record, `GetUserAvatarQuery(UserIdentifierType UserId)` (line 5). No body. The doc comment (lines 3-4) states the `UserId` is stamped by the controller from the authenticated principal and is never client-supplied, so a caller can only read their own avatar.
- **Why it's built this way**: modeling the read as a tiny query record pairs it with one handler ([`GetUserAvatarHandler`](#getuseravatarhandler)) that owns the data access, and the controller-stamped `UserId` makes ownership a property of routing rather than an argument the client controls.
- **Where it's used**: dispatched by the Identity profile/avatar read endpoint; handled by [`GetUserAvatarHandler`](#getuseravatarhandler), which returns a [`UserAvatarDTO`](#useravatardto).

### GetUserPreferencesQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:7` · Level 0 · record (sealed)

- **What it is**: the CQRS query that asks for one user's stored UI preferences (preferred culture and theme). It carries a single field, the target `UserId`.
- **Depends on**: `UserIdentifierType` (the Identity `global using UserIdentifierType = int;` alias, see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced, the read side of per-user preferences (ADR-027 / ADR-028).** `[Rubric §27, Internationalization (i18n)]` (assesses whether locale is a first-class, persisted user choice rather than a fixed compile-time default): this query is how the app retrieves a user's saved language so the UI can honor it across sessions and devices, the persisted-preference half of the i18n story. The same record also carries the dark/light theme choice, so `[Rubric §20, Design System & Theming]` applies too: theme is a stored per-user preference, not only a client cookie (ADR-028). The doc comment (`GetUserPreferencesQuery.cs:5`) names both ADRs.
- **Walkthrough**: a one-line positional record, `GetUserPreferencesQuery(UserIdentifierType UserId)` (line 7). No body; the value is the routed user id supplied by the controller.
- **Why it's built this way**: modeling the read as a tiny query record (rather than a method on a service) keeps it inside the CQRS decorator pipeline (logging, caching) like every other read, and pairs it with a single handler ([`GetUserPreferencesHandler`](#getuserpreferenceshandler)) that owns the data access.
- **Where it's used**: dispatched by the Identity profile/preferences read endpoint; handled by [`GetUserPreferencesHandler`](#getuserpreferenceshandler), which returns a [`UserPreferencesResponse`](#userpreferencesresponse).

### GetUsersQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersQuery.cs:18` · Level 0 · record (sealed)

- **What it is**: the query behind the organizer user-management list (BR-51): optional email/first-name/last-name/role filters plus paging and sort parameters.
- **Depends on**: nothing first-party (all members are BCL `string?` / `int`).
- **Concept**: the CQRS query record is taught at [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); this is a filter-plus-page-plus-sort read request. `[Rubric §9, API & Contract Design]` (assesses paged, filterable list contracts): the query carries server-side paging (`PageNumber` / `PageSize`) and sort (`SortColumn` / `SortDirection`) so the list never materializes every user. `[Rubric §12, Performance & Scalability]`: the page-size cap (max 500, BR-11) is honored downstream in the handler.
- **Walkthrough**: a positional record with eight members (lines 18-26): four nullable filters (`Email`, `FirstName`, `LastName`, `Role`), `PageNumber = 1`, `PageSize = 10`, and nullable `SortColumn` / `SortDirection`. The XML doc (lines 9-17) documents each parameter, including the BR-11 max-500 page size and the CreatedOn/desc defaults the handler applies.
- **Why it's built this way**: a record with defaulted parameters lets a caller request page 1 of 10 with no arguments while still supporting full filter and sort; immutability means the query can flow safely through the decorator pipeline.
- **Where it's used**: dispatched by the organizer Users endpoint; handled by [`GetUsersHandler`](#getusershandler), producing a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) of [`UserListDTO`](#userlistdto).

### RemoveUserAvatarCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarCommand.cs:8` · Level 0 · record (sealed)

- **What it is**: the CQRS command that removes the signed-in user's avatar photo (BR-116a): it deletes the blob and clears the URL. It carries only the owning `UserId`.
- **Depends on**: `UserIdentifierType` (the Identity `int` alias, see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept**: the avatar slice is introduced at [`GetUserAvatarQuery`](#getuseravatarquery); this is its delete operation. The doc comment (lines 3-6) records the key contract: the operation is **idempotent**, removing a non-existent avatar succeeds rather than erroring. `[Rubric §9, API & Contract Design]` (assesses idempotent, predictable mutation semantics): a delete that is safe to repeat lets a client retry without special-casing "already gone".
- **Walkthrough**: a one-line positional record, `RemoveUserAvatarCommand(UserIdentifierType UserId)` (line 8). No body. As with the other avatar operations, the doc comment (line 7) notes the `UserId` is stamped by the controller from the authenticated principal, never client-supplied.
- **Why it's built this way**: a bare command record keeps the delete inside the command decorator pipeline (validation, logging), and the controller-stamped owner id keeps the operation scoped to self-service.
- **Where it's used**: handled by [`RemoveUserAvatarHandler`](#removeuseravatarhandler), which returns a bare [`Result`](group-01-result-error-handling.md#result) (no payload).

### SetUserAvatarCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarCommand.cs:10` · Level 0 · record (sealed)

- **What it is**: the CQRS command that sets (uploads or replaces) the signed-in user's avatar photo (BR-116a, ADR-045). It carries the owning `UserId` plus the raw uploaded image bytes.
- **Depends on**: `UserIdentifierType` (the Identity `int` alias); `System.ReadOnlyMemory<byte>` (BCL) for the payload.
- **Concept**: the upload-security pipeline this command feeds is taught at [`SetUserAvatarHandler`](#setuseravatarhandler). Worth noting here is the *shape* of the payload: `Content` is a `ReadOnlyMemory<byte>` of the raw uploaded bytes, and the doc comment (lines 3-7) is explicit that the handler validates the true format from the bytes (magic bytes), *not* the client-declared content type, before re-encoding to a canonical 256x256 JPEG. `[Rubric §11, Security]` (assesses input trust boundaries): carrying raw bytes, not a client-typed stream, forces the trust decision into the handler where the format is sniffed rather than believed.
- **Walkthrough**: a positional record `SetUserAvatarCommand(UserIdentifierType UserId, ReadOnlyMemory<byte> Content)` (line 10). No body. The `UserId` (doc comment line 8) is controller-stamped; `Content` (line 9) is the uploaded image.
- **Why it's built this way**: modeling the upload as an immutable command with a value-type byte buffer keeps it inside the command pipeline and hands the handler an owned, read-only view of the bytes to sniff and re-encode.
- **Where it's used**: handled by [`SetUserAvatarHandler`](#setuseravatarhandler), which returns a [`UserAvatarDTO`](#useravatardto) with the new URL.

### UserPreferencesResponse
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/UserPreferencesResponse.cs:9` · Level 0 · record (sealed)

- **What it is**: the response shape for [`GetUserPreferencesQuery`](#getuserpreferencesquery): the user's stored `Culture` and `Theme`, each nullable. A `null` field means the user has not chosen that preference (the UI then falls back to its default).
- **Depends on**: nothing first-party (two `string?` members).
- **Concept reinforced, persisted UI preferences (ADR-027 / ADR-028).** `[Rubric §27, Internationalization (i18n)]`: returning the saved `Culture` (for example "es") lets the app re-apply the user's language on a fresh load instead of defaulting to en-US, and the `null`-means-unset convention (doc comment, lines 3-8) cleanly distinguishes "no choice yet" from a real value. `[Rubric §20, Design System & Theming]`: `Theme` ("light" / "dark") rides the same response, so a returning user gets their dark-mode choice back (ADR-028).
- **Walkthrough**: a positional record `UserPreferencesResponse(string? Culture, string? Theme)` (line 9). Both fields nullable; the XML doc documents the `null`-means-unchosen semantics for each.
- **Why it's built this way**: a flat two-field record keeps the wire contract minimal and lets the handler map straight from the [`User`](#user) aggregate's `PreferredCulture` / `PreferredTheme` columns; nullability is the contract for "unset" rather than a sentinel string.
- **Where it's used**: produced by [`GetUserPreferencesHandler`](#getuserpreferenceshandler) and returned by the Identity preferences endpoint; the client uses it to seed its culture cookie and theme on login. The write side is the preferences-update path on [`User`](#user) (covered in the sibling parts of this chapter).

### GetUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarHandler.cs:10` · Level 8 · class (sealed)

- **What it is**: the query handler that loads a user by id and returns their current avatar URL as a [`UserAvatarDTO`](#useravatardto) (the URL may be null when no avatar is set), or a NotFound failure if the user does not exist.
- **Depends on**: [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user); [`UserAvatarDTO`](#useravatardto); [`Result`](group-01-result-error-handling.md#result); [`Error`](group-01-result-error-handling.md#error); [`GetUserAvatarQuery`](#getuseravatarquery).
- **Concept reinforced, the thin CQRS read handler (ADR-014).** `[Rubric §6, CQRS & Event-Driven]`: it implements `IQueryHandler<GetUserAvatarQuery, Result<UserAvatarDTO>>` (lines 10-11) and runs inside the query decorator chain (FeatureGate then Logging then Caching then handler) with no transaction, since it only reads.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (lines 10-11).
  - `HandleAsync` (lines 14-24): resolves `unitOfWork.GetRepository<User, UserIdentifierType>()` and calls `GetByIdAsync(query.UserId, …)` (lines 18-19). If the user is `null` it returns `Result.Failure<UserAvatarDTO>(Error.NotFound.WithSource(nameof(GetUserAvatarHandler)).WithTarget(nameof(User)))` (line 22), attaching source/target for a traceable error; otherwise `Result.Success(new UserAvatarDTO(user.AvatarUrl))` (line 23), which passes the stored URL through unchanged (null included).
- **Why it's built this way**: using the unit-of-work repository plus a `Result` return keeps the read consistent with the rest of the module (no direct DbContext, errors as values not exceptions, ADR-013); a `GetByIdAsync` by key is the right shape because it fetches exactly one row.
- **Where it's used**: dispatched for the Identity avatar read endpoint; its [`UserAvatarDTO`](#useravatardto) tells the client whether and where to render the profile photo.
- **Caveats / not-in-source**: like [`GetUserPreferencesHandler`](#getuserpreferenceshandler), it uses `GetRepository` (the tracking repository) rather than the no-tracking read repository; for a single-row by-key read the difference is negligible.

### GetUserPreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:9` · Level 8 · class (sealed)

- **What it is**: the query handler that loads a user by id and returns their stored culture/theme as a [`UserPreferencesResponse`](#userpreferencesresponse), or a NotFound failure if the user does not exist.
- **Depends on**: [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`User`](#user); [`Result`](group-01-result-error-handling.md#result); [`Error`](group-01-result-error-handling.md#error); [`GetUserPreferencesQuery`](#getuserpreferencesquery); [`UserPreferencesResponse`](#userpreferencesresponse).
- **Concept reinforced, the thin CQRS read handler (ADR-014) serving persisted preferences (ADR-027 / ADR-028).** `[Rubric §27, Internationalization (i18n)]`: this handler is the server end of "remember my language", reading [`User`](#user)`.PreferredCulture` straight off the aggregate. `[Rubric §6, CQRS & Event-Driven]`: it implements `IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>` (lines 9-11) and runs inside the query decorator chain (FeatureGate then Logging then Caching then handler) with no transaction, since it only reads.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (line 9).
  - `HandleAsync` (lines 13-23): resolves the typed repository `unitOfWork.GetRepository<User, UserIdentifierType>()` (line 17), then `GetByIdAsync(query.UserId, …)` (line 18). If the user is `null` it returns `Result.Failure<UserPreferencesResponse>(Error.NotFound.WithSource(nameof(GetUserPreferencesHandler)).WithTarget(nameof(User)))` (lines 20-21), attaching source/target for a traceable error; otherwise `Result.Success(new UserPreferencesResponse(user.PreferredCulture, user.PreferredTheme))` (line 22).
- **Why it's built this way**: using the unit-of-work repository plus a `Result` return keeps the read consistent with the rest of the module (no direct DbContext, errors as values not exceptions, ADR-013); a `GetByIdAsync` by key rather than a projection is fine here because it fetches exactly one row.
- **Where it's used**: dispatched for the Identity preferences/profile read endpoint; its [`UserPreferencesResponse`](#userpreferencesresponse) seeds the client's culture and theme.
- **Caveats / not-in-source**: it uses `GetRepository` (the tracking repository) rather than `GetReadRepository`; for a single-row by-key read the difference is negligible, but it does not use the no-tracking `TableNoTracking` path the way [`GetUsersHandler`](#getusershandler) does.

### GetUsersHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:15` · Level 8 · class (sealed)

- **What it is**: the query handler for the organizer user list (BR-51). It filters, counts, sorts, pages, and projects `User` rows to [`UserListDTO`](#userlistdto) entirely at the database level, then returns a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt).
- **Depends on**: [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor); [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) (via `GetReadRepository`); [`User`](#user); [`UserListDTO`](#userlistdto); [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata); [`Result`](group-01-result-error-handling.md#result); `System.Linq.Expressions` (BCL).
- **Concept introduced, server-side paging/sorting/projection over a no-tracking queryable.** `[Rubric §12, Performance & Scalability]` (assesses that list endpoints push filter/sort/page/projection to the database, never materializing the whole table) and `[Rubric §30, Compliance, Privacy & Data Governance]` (data minimization): the projection selects only the six list columns (`UserId`, `Email`, `FirstName`, `LastName`, `Role`, `CreatedOn`, lines 44-52) so password hash/salt, refresh token, and device fields are never read out of the database. `[Rubric §6, CQRS & Event-Driven]`: a read handler, no transaction.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (lines 15-17); implements `IQueryHandler<GetUsersQuery, Result<PagedCollectionResult<UserListDTO>>>`.
  - `HandleAsync` (lines 20-58): caps page size at 500 (`Math.Min(query.PageSize, 500)`, BR-11, line 25); takes the no-tracking queryable `repository.TableNoTracking` from `GetReadRepository<User, UserIdentifierType>()` (lines 27-31); applies filters (line 32); gets the total with `queryableExecutor.CountAsync` (a `SELECT COUNT`, line 35); sorts (line 38); then `Skip`/`Take` plus `Select` into [`UserListDTO`](#userlistdto) (lines 41-52) and materializes with `queryableExecutor.ToListAsync` (line 54). It wraps the page in a `PaginationMetadata(totalCount, pageSize, query.PageNumber)` and returns `Result.Success(new PagedCollectionResult<UserListDTO>(paged, metadata))` (lines 56-57).
  - `ApplyFilters` (lines 60-72): adds a `Where` per non-null filter (`Email` / `FirstName` / `LastName` use `Contains`, `Role` uses `==`); `Email` is cast `(string)u.Email` (line 63) to compare against the value-object-backed column.
  - `ApplySorting` (lines 74-91): defaults to descending when `SortDirection` is "desc" or blank; a `switch` on `SortColumn.ToUpperInvariant()` picks the key selector, defaulting to `CreatedOn` (line 85).
- **Why it's built this way**: doing count, sort, page, and projection through [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) keeps the SQL set-based and the wire payload minimal, and routing through the read (no-tracking) repository avoids change-tracking overhead on a pure read; the explicit column projection is the type-level guarantee that sensitive fields never leave the database.
- **Where it's used**: dispatched by the organizer Users endpoint (gated by [`IdentityPermissions`](#identitypermissions)`.UsersRead`); its [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) of [`UserListDTO`](#userlistdto) feeds the user-management grid in the UI.

### SetUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16` · Level 8 · class (sealed, partial)

- **What it is**: the command handler that uploads or replaces the signed-in user's avatar (BR-116a, ADR-045). It sniffs the true image format, re-encodes the bytes to a canonical 256x256 JPEG, stores the result under a fresh random blob name, persists the new URL on the [`User`](#user) aggregate, then best-effort deletes the previous blob. It returns a [`UserAvatarDTO`](#useravatardto) with the new URL.
- **Depends on**: [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor); [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice); [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer); [`User`](#user); [`UserAvatarDTO`](#useravatardto); [`Result`](group-01-result-error-handling.md#result); [`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` (`ILogger` + `[LoggerMessage]` source generation), `System.Guid`, `System.IO.MemoryStream`, `System.Uri` (BCL).
- **Concept introduced, safe user-uploaded-image handling (ADR-045).** This is the first place the codebase accepts a binary upload from an end user, and it treats those bytes as hostile. `[Rubric §11, Security]` (assesses input trust boundaries and defense against malicious uploads): the format is decided by **magic-byte sniffing** ([`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer)`.IsAllowedImage`, line 32), never the client-declared content type, and the image is **re-encoded** rather than stored as received, which the doc comment (lines 10-15) notes strips EXIF metadata and defeats polyglot files (a valid image that is also valid script). `[Rubric §13, Observability & Operability]`: the success is logged through a compile-time `[LoggerMessage]` source-generated method (`LogAvatarSet`, lines 95-96), which is why the class is `partial`. `[Rubric §30, Compliance, Privacy & Data Governance]`: re-encoding also drops geolocation and camera EXIF a user did not intend to publish.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), and an `ILogger` (lines 16-20); implements `ICommandHandler<SetUserAvatarCommand, Result<UserAvatarDTO>>`. The canonical edge length is `internal const int AvatarSize = 256` (line 23).
  - **Format gate** (lines 32-38): if `ImageContentSniffer.IsAllowedImage(command.Content.Span)` is false, it returns `Error.Validation` with the app-specific code `"Avatar.UnsupportedFormat"` (line 35). The comment (lines 30-31) notes the shared sniffer lives in `MMCA.Common.Application` while the error code and size policy stay app-side.
  - **Load the user** (lines 40-46): `GetRepository<User, UserIdentifierType>()` then `GetByIdAsync`; `null` returns `Error.NotFound` (lines 44-45).
  - **Normalize** (lines 48-58): wraps the bytes in a non-writable `MemoryStream` and calls `imageProcessor.NormalizeToSquareJpegAsync(content, AvatarSize, …)` (line 52); a failed `Result<byte[]>` short-circuits with its own errors (lines 55-57).
  - **Upload** (lines 60-72): builds a blob name `"{UserId}-{8-hex-suffix}.jpg"` from a fresh `Guid.NewGuid().ToString("N")[..8]` (lines 60-61), streams the JPEG to `fileStorage.UploadAsync(blobName, jpeg, "image/jpeg", …)` (line 66); a failed upload short-circuits (lines 69-71).
  - **Persist then clean up** (lines 74-83): captures the previous blob name via `TryGetBlobName(user.AvatarUrl)` *before* overwriting, calls `user.SetAvatarUrl(uploaded.Value!.AbsoluteUri)` and `SaveChangesAsync`, then deletes the old blob only after the new URL is committed (the comment, lines 78-79, notes a delete failure leaks at most one orphaned 256px image, never a broken avatar).
  - `TryGetBlobName` (lines 90-93): a `static` helper that pulls the final URL segment as the blob name via `Uri.TryCreate` + `Uri.UnescapeDataString`; it is reused by [`RemoveUserAvatarHandler`](#removeuseravatarhandler).
- **Why it's built this way**: the random blob-name suffix means a replacement never reuses the old URL, so downstream caches and CDNs self-invalidate without an explicit purge (doc comment, lines 12-14). Ordering "persist new URL, then delete old blob" makes the user-visible state the source of truth and turns any storage failure into a harmless orphan rather than a dangling reference. Sniffing plus mandatory re-encoding is the ADR-045 rule that an accepted upload is only ever stored in a shape the server itself produced.
- **Where it's used**: dispatched by the Identity avatar upload endpoint; its [`UserAvatarDTO`](#useravatardto) carries the new URL back to the client for immediate display.
- **Caveats / not-in-source**: the concrete behavior of `NormalizeToSquareJpegAsync` (resize/crop strategy) and of the storage provider live behind [`IImageProcessor`](group-07-persistence-ef-core.md#iimageprocessor) and [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice) in MMCA.Common; this handler only orchestrates them. The per-upload size limit is enforced upstream (the comment at line 30 notes the size limit is applied outside this handler), not visible in this file.

### RemoveUserAvatarHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:14` · Level 9 · class (sealed, partial)

- **What it is**: the command handler that removes the signed-in user's avatar (BR-116a). It clears the stored URL on the [`User`](#user) aggregate first (the user-visible state), then best-effort deletes the blob. It is idempotent: when no avatar is set it succeeds without touching storage.
- **Depends on**: [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (implemented); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice); [`SetUserAvatarHandler`](#setuseravatarhandler) (reuses its `static TryGetBlobName`, hence Level 9); [`User`](#user); [`Result`](group-01-result-error-handling.md#result); [`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` (`[LoggerMessage]` source generation).
- **Concept reinforced, idempotent delete + best-effort cleanup.** `[Rubric §9, API & Contract Design]`: the operation is safe to repeat (see [`RemoveUserAvatarCommand`](#removeuseravatarcommand)). `[Rubric §13, Observability & Operability]`: the removal is logged through a source-generated `[LoggerMessage]` method (`LogAvatarRemoved`, lines 46-47), so the class is `partial`.
- **Walkthrough**
  - Primary-constructor injection of [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), and an `ILogger` (lines 14-17); implements `ICommandHandler<RemoveUserAvatarCommand, Result>` (note the bare `Result`, no payload).
  - `HandleAsync` (lines 20-44): loads the user via `GetRepository<User, UserIdentifierType>()` + `GetByIdAsync`; `null` returns `Error.NotFound` (lines 26-29). It derives the blob name with `SetUserAvatarHandler.TryGetBlobName(user.AvatarUrl)` (line 31); if that is `null` (no avatar set) it returns `Result.Success()` immediately, the idempotent no-op (lines 32-35). Otherwise it calls `user.SetAvatarUrl(null)` and `SaveChangesAsync` (lines 37-38), then `fileStorage.DeleteAsync(blobName, …)` (line 40), and logs (line 42).
- **Why it's built this way**: clearing the URL before deleting the blob makes the persisted "no avatar" state authoritative, so a later blob-delete failure leaves an orphan rather than a broken reference (the same ordering rationale as [`SetUserAvatarHandler`](#setuseravatarhandler)). Reusing that handler's `TryGetBlobName` keeps the URL-to-blob-name parsing in one place.
- **Where it's used**: dispatched by the Identity avatar removal endpoint; its bare [`Result`](group-01-result-error-handling.md#result) tells the client the avatar is gone (or was already absent).

### AssemblyReference
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the static assembly-marker for the Identity module's Infrastructure layer: a handle onto the assembly it lives in (`Assembly`) plus that assembly's simple name (`AssemblyName`), used as a stable, string-free anchor whenever something has to say "scan the Infrastructure assembly of Identity."
- **Depends on**: `System.Reflection.Assembly` (BCL) only, imported at `AssemblyReference.cs:1`. No first-party dependencies, which is why it sits at Level 0.
- **Concept**: the assembly-marker idiom is taught at its first appearance in [`AssemblyReference`](group-17-conference-domain.md#assemblyreference); this is the Identity Infrastructure instance of the same shape, and the module's other layers (Domain, Application, API) each ship their own byte-identical copy covered in the sibling parts of this chapter. `[Rubric §5, Vertical Slice]` assesses convention-driven wiring and feature cohesion: a marker lets EF-configuration and DI scanners target an assembly through `typeof(AssemblyReference).Assembly` instead of a brittle string literal, so adding an entity configuration needs no registration edit. `[Rubric §1, SOLID]` (Dependency Inversion): registration code binds to a deliberate marker rather than to `typeof(UserConfiguration).Assembly`, so renaming or moving a real type never silently breaks the scan.
- **Walkthrough**: two `public static readonly` fields resolved once at type-initialization. `Assembly = typeof(AssemblyReference).Assembly` (`AssemblyReference.cs:7`) is the self-referential handle; `AssemblyName = Assembly.GetName().Name ?? string.Empty` (`AssemblyReference.cs:8`) is the simple name with a `?? string.Empty` fallback so the field is never null even when the runtime reports no simple name. No methods, no constructor.
- **Why it's built this way**: every module layer ships the identical marker so generic scanning code can be told *which* assembly to scan without referencing a concrete business type. The layer is identified purely by which `AssemblyReference` you hand it, which keeps the layering rules of Clean Architecture intact (the scanner never needs a type reference that would create an upward dependency).
- **Where it's used**: the EF design-time factories pass this exact marker to `AddConfigurationAssembly(...)`: the per-service Identity migrations project at `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:25`, and the frozen combined-database archive project at `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer/DesignTimeSQLServerDbContextFactory.cs:29`. That is how [`UserConfiguration`](#userconfiguration) is discovered without the migrations host referencing it directly. The general registration machinery lives in [G14, Module System and Composition](group-14-module-system-composition.md).

---

### ClassReference
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: the empty, non-static companion to [`AssemblyReference`](#assemblyreference), declared in the same file. It exists so a scanning API that needs an *instantiable* generic type argument has one available from this assembly, since a C# static class cannot be used as a generic type argument.
- **Depends on**: nothing first-party, and nothing from the BCL beyond `object`.
- **Concept**: cross-reference the marker idiom taught under [`AssemblyReference`](#assemblyreference) and first introduced in [G17, Conference Domain](group-17-conference-domain.md#classreference). The companion exists because helpers such as `ScanModuleApplicationServices<TAssemblyMarker>()` constrain their type parameter to a reference type; the Identity Application layer's own copy is passed that way at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:37`. `[Rubric §33, Developer Experience]` assesses how much ceremony the inner loop demands: one conventional token per layer is the entire registration ritual.
- **Walkthrough**: `public class ClassReference { }` (`AssemblyReference.cs:11`), no members. Its only meaningful property is the assembly it belongs to, read by a scanner via `typeof(ClassReference).Assembly`.
- **Why it's built this way**: keeping the instantiable anchor separate sidesteps the static-class generic-argument restriction while leaving [`AssemblyReference`](#assemblyreference) impossible to instantiate by accident. Each layer defines its own copy so it can scan itself by passing its local token.
- **Where it's used**: no call site in ADC currently passes this Infrastructure copy as a type argument; the type-argument scans in the Identity module use the Application-layer copy (`MMCA.ADC.Identity.Application/DependencyInjection.cs:37`) and the architecture-fitness suite uses it too (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:40`). The Infrastructure copy is present for structural symmetry across layers.
- **Caveats / not-in-source**: whether an Infrastructure-layer generic scan is planned is `Not determinable from source`; today the copy is declared and unreferenced.

---

### DependencyInjection
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:11` · Level 0 · class (static)

- **What it is**: the Infrastructure-layer DI entry point for the Identity module. It is a deliberate no-op placeholder today: `AddModuleIdentityInfrastructure()` returns the `IServiceCollection` unchanged (`DependencyInjection.cs:20`).
- **Depends on**: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (NuGet) only (`DependencyInjection.cs:1`). No first-party types.
- **Concept**: the `extension(IServiceCollection)` registration idiom, taught once in the [primer](00-primer.md#c-extensiont-types-read-this-once). C# preview extension members let a layer contribute an `AddModule{Name}{Layer}()` method that reads like a built-in `IServiceCollection` API. `[Rubric §16, Maintainability]` assesses uniform, predictable structure: shipping the method even when it registers nothing means the composition root never special-cases Identity, and the empty body is honest about "nothing to register here yet" rather than absent and surprising. `[Rubric §3, Clean Architecture]` assesses layer discipline: the Infrastructure layer owns its own registration surface, and the API layer composes it rather than reaching into persistence details.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (`DependencyInjection.cs:13`) exposing `public IServiceCollection AddModuleIdentityInfrastructure() => services;` (`DependencyInjection.cs:20`), an expression body that returns the collection for chaining. The XML doc (`DependencyInjection.cs:5-10`) records *why* it is empty: Identity has no module-specific infrastructure services beyond the EF configurations and the seeder, and those are discovered by assembly scanning. That claim matches the layer's contents, which are exactly [`ModuleApplicationDbContext`](#moduleapplicationdbcontext), [`IdentityModuleDbSeeder`](#identitymoduledbseeder), and [`UserConfiguration`](#userconfiguration) alongside the two marker types above.
- **Why it's built this way**: keeping the method present even when empty means the module-registration pipeline stays uniform across every module and layer; when Identity later needs a typed infrastructure service (a key store, a read-model query service) it is added here and no caller changes.
- **Where it's used**: invoked from the API layer's `AddIdentityModule(...)` at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:30`, between `AddModuleIdentityApplication(applicationSettings)` (`:29`) and `AddModuleIdentityAPI()` (`:31`); that composite is in turn called by [`IdentityModule`](#identitymodule)'s registration, the [`IModule`](group-14-module-system-composition.md#imodule) contract from G14.
- **Caveats / not-in-source**: the Identity module ships one `DependencyInjection` class per layer (this Infrastructure one plus the API, Application, and UI copies covered in sibling parts of this chapter). They all slug to the bare `dependencyinjection` anchor, which resolves to the first occurrence in the assembled chapter, so cross-references disambiguate by layer in prose.

---

### IdentityPermissions
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Authorization` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:8` · Level 0 · class (static)

- **What it is**: the capability-permission catalog for the Identity module: string constants that endpoints demand (via [`[HasPermission(...)]`](group-08-auth.md#haspermissionattribute)) instead of hard-coding role names.
- **Depends on**: no first-party types; BCL `IReadOnlyList<string>` and a collection expression.
- **Concept, permission-based authorization over role-based.** An endpoint names the *capability* it needs (`identity:users:read`), and the role-to-permission grants are declared once at module registration, so adding a role or re-mapping a capability never touches an endpoint attribute. `[Rubric §11, Security]` assesses authorization design and least privilege: naming the capability at the endpoint and centralizing grants makes the authorization surface auditable rather than scattered across `[Authorize(Roles = ...)]` attributes. `[Rubric §7, Microservices Readiness]` assesses whether the boundary survives extraction: the catalog lives in the module's `Shared` project, so both the in-process host and the standalone Identity service consume the same constants.
- **Walkthrough**: `public const string UsersRead = "identity:users:read"` (`IdentityPermissions.cs:11`) is the single capability today, documented as "list or read all user accounts" for the organizer/admin user-management screens (`IdentityPermissions.cs:10`). `public static IReadOnlyList<string> All { get; }` (`IdentityPermissions.cs:14`) is initialized from a collection expression containing `UsersRead` (`IdentityPermissions.cs:15-17`), so a role can be granted the whole capability set in one call.
- **Why it's built this way**: a `namespace:resource:action` string convention keeps permissions self-describing and greppable, and the `All` accessor keeps the role-grant registration from drifting when a permission is added: the new constant only has to be listed once, inside `All`.
- **Where it's used**: demanded by the user-list endpoint on [`UsersController`](#userscontroller) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:124`, `[HasPermission(IdentityPermissions.UsersRead)]`), and granted in `AddModuleIdentityAPI()` where `permissions.Grant(RoleNames.Organizer, [.. IdentityPermissions.All])` and the same call for [`RoleNames`](group-08-auth.md#rolenames)`.Admin` populate the [`PermissionRegistry`](group-08-auth.md#permissionregistry) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:46-47`).

---

### IdentitySettings
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/IdentitySettings.cs:7` · Level 0 · class (sealed)

- **What it is**: a module-level options object for Identity, declared to bind from the `"Identity"` configuration section. It is a one-property options class covering the BR-213 registration throttle.
- **Depends on**: no first-party types; nothing beyond the BCL.
- **Concept, module-scoped options with an in-code default.** `[Rubric §10, Cross-Cutting Concerns]` assesses how configuration is surfaced and layered: an options class turns a business rule into an environment-overridable knob while still carrying a sane value when the configuration file omits the section. `[Rubric §15, Best Practices and Code Quality]` also applies here in the negative sense described under Caveats: an options type with no binder and no reader is dead configuration surface, and the live knob is elsewhere.
- **Walkthrough**: `public const string SectionName = "Identity"` (`IdentitySettings.cs:9`) is the section key an `IConfiguration.GetSection(...)` call would use. The single property `public int MaxRegistrationsPerIpPerHour { get; init; } = 10` (`IdentitySettings.cs:15`) caps registrations per IP per hour, with the doc comment (`IdentitySettings.cs:11-14`) attributing it to BR-213 and noting it is set higher in development/test so E2E runs are not rate-limited. `init`-only keeps a bound instance immutable after startup. The class-level doc comment (`IdentitySettings.cs:3-6`) says the values come from `modules.identity.json` or its `Development` overlay.
- **Why it's built this way**: keeping the `= 10` default in code rather than only in JSON means a missing configuration section still yields an enforceable limit, and `sealed` plus `init` make the options object a safe singleton to share.
- **Where it's used**: **nowhere in ADC source today.** A repository-wide search for `IdentitySettings` across `MMCA.ADC` returns only the declaration itself: there is no `Configure<IdentitySettings>(...)` binding and no injection of `IOptions<IdentitySettings>`. The registration throttle that actually runs is the framework's `LoginProtectionSettings` in `MMCA.Common.Infrastructure`, which declares the same property name and the same default (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:37`) and is read by [`LoginProtectionService`](group-08-auth.md#loginprotectionservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:82`). The AppHost raises that framework knob, not this one, for the Identity service: `identityService.WithEnvironment("LoginProtection__MaxRegistrationsPerIpPerHour", "1000")` (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:327`, with the BR-213 rationale at `:303`).
- **Caveats / not-in-source**: treat this type as an unwired duplicate of [`LoginProtectionSettings`](group-08-auth.md#loginprotectionsettings), not as the effective configuration. Changing `MaxRegistrationsPerIpPerHour` here has no runtime effect; the `Identity:MaxRegistrationsPerIpPerHour` configuration key is not read anywhere. Whether it is a leftover from before the throttle moved into MMCA.Common or a placeholder for a future module-owned setting is `Not determinable from source`.

---

### KestrelConfiguration
> MMCA.ADC.Identity.Service · `MMCA.ADC.Identity.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/KestrelConfiguration.cs:11` · Level 0 · class (static, internal)

- **What it is**: the Kestrel endpoint wiring for the standalone Identity service host. It forces HTTP/2-only on cleartext (h2c) for every endpoint and, when the platform injects a health-probe port, adds a second HTTP/1.1-only listener that the Azure Container Apps `httpGet` probes can actually talk to.
- **Depends on**: no first-party types. Externals: `Microsoft.AspNetCore.Server.Kestrel.Core.HttpProtocols` (`KestrelConfiguration.cs:1`), `WebApplicationBuilder`, and `IConfiguration.GetValue<int?>`.
- **Concept, the transport profile of a cleartext gRPC host.** On a cleartext endpoint there is no TLS, therefore no ALPN negotiation, so `Http1AndHttp2` effectively degrades to HTTP/1.1 and Kestrel answers gRPC frames with `GOAWAY HTTP_1_1_REQUIRED`. Setting `HttpProtocols.Http2` selects h2c prior knowledge, which is what lets cross-service typed gRPC clients (`http://identity`) connect at all. This is ADR-012 (gRPC-host transport convention) applied to the three REST services; the mixed-endpoint variant used by Notification, where a default `Http1AndHttp2` endpoint must survive a WebSocket upgrade, is covered in [G10](group-10-notifications.md#kestrelconfiguration). `[Rubric §13, Observability and Operability]` assesses whether the platform can genuinely observe the app: the probe listener is what allows the ACA probes to reach the real, DB-aware `/alive` and `/health/ready` pipeline instead of a bare TCP check (`KestrelConfiguration.cs:16-24`). `[Rubric §7, Microservices Readiness]` assesses whether a service is independently deployable: the transport profile is declared by the service host itself, not by a shared ambient default.
- **Walkthrough**: one static method, `ConfigureHttp2WithHealthProbe(WebApplicationBuilder builder)` (`KestrelConfiguration.cs:27`). It null-guards its argument (`:29`), then calls `builder.WebHost.ConfigureKestrel` (`:31`). Inside, `k.ConfigureEndpointDefaults(o => o.Protocols = HttpProtocols.Http2)` (`:33`) makes h2c the default for every endpoint, including the container's `ASPNETCORE_HTTP_PORTS` binding. Then a pattern-match on configuration, `builder.Configuration.GetValue<int?>("HealthProbe:Port") is int probePort` (`:35`), gates the probe path: only when the key is present does it re-declare the main endpoint explicitly with `k.ListenAnyIP(8080, o => o.Protocols = HttpProtocols.Http2)` (`:37`) and add `k.ListenAnyIP(probePort, o => o.Protocols = HttpProtocols.Http1)` (`:38`). The re-declaration is required because any explicit `Listen` call overrides the container's default binding, so 8080 has to be restated alongside the probe port (`:20-23`).
- **Why it's built this way**: the doc comment (`KestrelConfiguration.cs:14-25`) is the rationale of record. The `HealthProbe:Port` key is injected by `infra/main.bicep` as `HealthProbe__Port` and is deliberately absent locally, so Aspire's dynamic ports keep working and co-hosted services cannot collide on a fixed port on one developer machine. `MapDefaultEndpoints` maps `/health`, `/alive` and `/health/ready` on every listener (called at `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:296`), so the extra HTTP/1.1 listener serves the real health pipeline, and the probe port stays off the ACA ingress because the platform probes target it directly. The class also exists as a separate file, per its own doc comment (`:8-9`), so `Program.cs` stays inside the S1541 cyclomatic-complexity budget the analyzers enforce.
- **Where it's used**: called as the first configuration step of the Identity service host, `KestrelConfiguration.ConfigureHttp2WithHealthProbe(builder)` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:80`, with the transport rationale repeated in the comment at `:70-79`). The Conference and Engagement service hosts ship a byte-identical copy of this class and call it the same way (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/KestrelConfiguration.cs:27` from `Program.cs:83`, and `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/KestrelConfiguration.cs:27` from `Program.cs:59`); see [G20](group-20-conference-api-grpc.md#kestrelconfiguration) and [G22](group-22-engagement-module.md#kestrelconfiguration).
- **Caveats / not-in-source**: the `8080` literal and the `HealthProbe__Port` value are set outside this file (the container image's default port and `infra/main.bicep` respectively); only the listener declarations are verified here.

### IAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8` · Level 0 · interface

- **What it is**: the one cross-module read contract Identity publishes. It answers a single question, "which user ids are active attendees?", so the Notification module can fan a broadcast out to every attendee without knowing anything about the [`User`](#user) aggregate.
- **Depends on**: the `UserIdentifierType` alias only; BCL (`Task`, `IReadOnlyList<T>`, `CancellationToken`). It deliberately references no Identity Domain or Application type.
- **Concept introduced, the cross-module contract in the `Shared` assembly.** `[Rubric §7, Microservices Readiness]` (assesses whether modules talk through narrow, transport-agnostic interfaces that survive extraction into separate processes) and `[Rubric §3, Clean Architecture]` (assesses dependency direction: the consumer depends on an abstraction, not on the producer's internals). The doc comment (`IAttendeeQueryService.cs:3-7`) states the rule outright: the contract lives in `Shared` so Notification can call it without depending on the Identity implementation. That one placement decision is what makes three different wirings interchangeable behind the same interface: the in-process [`AttendeeQueryService`](#attendeequeryservice) when Identity runs in the same host, the [`DisabledAttendeeQueryService`](#disabledattendeequeryservice) stub when the module is switched off, and the [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter) when Identity runs as its own service. No consumer code changes between those three.
- **Walkthrough**: one member. `GetAttendeeUserIdsAsync(CancellationToken cancellationToken = default)` (`IAttendeeQueryService.cs:15`) returns `Task<IReadOnlyList<UserIdentifierType>>`. The return type is deliberately just ids, not user records: the caller needs recipients, not personal data, so the contract carries the minimum (`[Rubric §30, Compliance, Privacy & Data Governance]`, data minimization across a module boundary).
- **Why it's built this way**: a coarse, id-only, async, cancellable method maps cleanly onto a gRPC unary call, which is exactly the extraction path ADR-007 describes. Anything richer (a filtered query object, an `IQueryable`) would leak Identity's persistence model across the boundary and would not survive the process split.
- **Where it's used**: consumed by Notification's [`AttendeeNotificationRecipientProvider`](group-10-notifications.md#attendeenotificationrecipientprovider) (which bridges it to [`INotificationRecipientProvider`](group-10-notifications.md#inotificationrecipientprovider)); implemented in-process by [`AttendeeQueryService`](#attendeequeryservice), stubbed by [`DisabledAttendeeQueryService`](#disabledattendeequeryservice), served over the wire by [`AttendeesGrpcService`](#attendeesgrpcservice), and satisfied remotely by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).

### IdentityRoutePaths
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: the two route strings the Identity UI module owns, `/users` and `/profile`, published as `static readonly` fields so the navigation descriptor never hard-codes a URL literal.
- **Depends on**: nothing (no usings in the file).
- **Concept reinforced, route constants as the module's public navigation surface.** `[Rubric §25, Navigation & Information Architecture]` (assesses whether routes are declared in one place so menu entries, redirects, and tests cannot drift from the pages themselves) and `[Rubric §16, Maintainability]`. The pattern is small but load-bearing: the nav items in [`IdentityUIModule`](#identityuimodule) reference `IdentityRoutePaths.Profile` / `IdentityRoutePaths.Users` (`IdentityUIModule.cs:17-18`) rather than repeating the strings, so renaming a route is a one-line change here.
- **Walkthrough**: `Users = "/users"` (`IdentityRoutePaths.cs:8`) and `Profile = "/profile"` (`IdentityRoutePaths.cs:9`), both `public static readonly string` on a `public static class`.
- **Caveats / not-in-source**: the `@page` directives on the [`UserList`](#userlist) and [`Profile`](#profile) components still spell their route literally (Razor `@page` requires a compile-time constant, and these are `static readonly` fields rather than `const`), so this type is the single source of truth for *navigation*, not for the page routing attribute itself.
- **Where it's used**: only by [`IdentityUIModule`](#identityuimodule)'s `NavItems` (`IdentityUIModule.cs:17-18`) in current source.

### UserAvatarDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:6` · Level 0 · record (sealed)

- **What it is**: the one-field response body every avatar endpoint returns: the current public avatar URL, or `null` when the user has none (BR-116a).
- **Depends on**: nothing first-party; one BCL attribute (`SuppressMessage`).
- **Concept reinforced, the response DTO as a stable wire shape.** `[Rubric §9, API & Contract Design]` (assesses whether endpoints return a named, versionable shape rather than a bare primitive). Returning `{ "avatarUrl": ... }` instead of a raw string means a later addition (a thumbnail URL, an upload timestamp) is an additive change, not a breaking one. The `CA1054` suppression (`UserAvatarDTO.cs:5`) carries its own justification in source: this is a serialized DTO field, so the URL stays a `string` on the wire rather than becoming a `Uri`.
- **Walkthrough**: a single positional record, `public sealed record UserAvatarDTO(string? AvatarUrl)` (`UserAvatarDTO.cs:6`). The nullable parameter is the whole contract: "no avatar" is a first-class, non-exceptional state.
- **Where it's used**: produced by the avatar use cases ([`GetUserAvatarHandler`](#getuseravatarhandler), [`SetUserAvatarHandler`](#setuseravatarhandler)), returned by [`UsersController`](#userscontroller)'s `me/avatar` endpoints, and deserialized client-side by [`UserService`](#userservice) for the [`Profile`](#profile) page.

### UserDataExportBookmarkDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one session-bookmark row inside the Engagement section of a data-subject export: which session the user bookmarked and when.
- **Depends on**: the `SessionIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the export row DTO (ids and dates only).** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether a data-subject access / portability request returns the subject's own data, and only that). The doc comment (`UserDataExportBookmarkDTO.cs:3-6`) ties the shape directly to PRIVACY.md §7. Note what is *not* here: no session title, no speaker, no other user's activity. The export carries the personal fact ("you bookmarked session X at time T") rather than a denormalized copy of another context's catalog, which keeps the Identity service from becoming an accidental read model of Conference data.
- **Walkthrough**: two `required init` members, `SessionId` (`UserDataExportBookmarkDTO.cs:10`) and `CreatedOn`, documented as UTC (`UserDataExportBookmarkDTO.cs:13`). `required` means the aggregating handler cannot forget a field, and `init` makes the row immutable once produced (the `required`/`init` immutability convention from the primer).
- **Where it's used**: built by [`ExportUserDataHandler`](#exportuserdatahandler) from the Engagement peer's response (`ExportUserDataHandler.cs:102`) and carried inside [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto).

### UserDataExportNotificationDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one notification-inbox row in the Notifications section of a data-subject export: the notification id, its title, and the sent/read timestamps.
- **Depends on**: the `UserNotificationIdentifierType` alias; BCL (`DateTime`).
- **Concept**: the same export-row shape [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto) introduces (`[Rubric §30, Compliance, Privacy & Data Governance]`), with one extra nuance: it does include the `Title` text, because a notification's title is content that was addressed to this user, so it is part of *their* personal data rather than someone else's.
- **Walkthrough**: five members (`UserDataExportNotificationDTO.cs:10-22`), `required NotificationId` and `required Title`, `required SentOn` (UTC), plus the optional pair `IsRead` (a plain `bool`, defaulting to `false`) and `ReadOn` (a nullable `DateTime`, null while unread). The two read fields are intentionally *not* `required`: an unread row simply carries the defaults.
- **Where it's used**: projected by [`ExportUserDataHandler`](#exportuserdatahandler) from the Notification peer's rows (`ExportUserDataHandler.cs:137-139`) into [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto); the underlying entity is [`UserNotification`](group-10-notifications.md#usernotification).

### UserDataExportSubmittedQuestionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: one submitted session-question row in the Engagement section of a data-subject export: the question id, the session it was asked in, and when it was submitted.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL (`DateTime`).
- **Concept**: the same export-row shape as [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), and the sharpest illustration of its restraint. The doc comment (`UserDataExportSubmittedQuestionDTO.cs:3-6`) spells the rule out: "ids + submission date only, never other users' data". The question *text* and its upvote count are omitted, so an export cannot be turned into a scrape of the live Q and A feed (`[Rubric §30, Compliance]`, `[Rubric §11, Security]`).
- **Walkthrough**: three `required init` members, `QuestionId` (`UserDataExportSubmittedQuestionDTO.cs:10`), `SessionId` (`UserDataExportSubmittedQuestionDTO.cs:13`), and `CreatedOn` in UTC (`UserDataExportSubmittedQuestionDTO.cs:16`).
- **Where it's used**: carried in [`UserDataExportEngagementSectionDTO.SubmittedQuestions`](#userdataexportengagementsectiondto), populated by [`ExportUserDataHandler`](#exportuserdatahandler); the source aggregate is [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) in the Engagement live layer.

### UserListDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` · Level 0 · record

- **What it is**: the row shape for the organizer user list (BR-51): id, email, first/last name, role, and creation date, and nothing else.
- **Depends on**: the `UserIdentifierType` alias; BCL (`DateTime`).
- **Concept introduced, the list projection DTO as a privacy boundary.** `[Rubric §8, Data Architecture]` (assesses whether reads project only the columns a screen needs instead of hydrating whole aggregates) and `[Rubric §30, Compliance, Privacy & Data Governance]`. The doc comment (`UserListDTO.cs:3-6`) is explicit that device-specific fields are excluded to protect attendee device privacy: the [`User`](#user) aggregate carries `DeviceId`, `DeviceModel`, `DeviceManufacturer` and friends, but an organizer browsing the user grid has no business seeing them. Because the projection is built inside the query (`GetUsersHandler.cs:44`, a `.Select(u => new UserListDTO { ... })` translated to SQL), the excluded columns are never even read from the database, so this is a privacy boundary *and* a performance win at once.
- **Walkthrough**: six members (`UserListDTO.cs:10-25`). `UserId`, `Email`, `FirstName`, `LastName`, and `Role` are `required init`; `CreatedOn` is a plain `init` `DateTime`. `Role` is a `string`, not the [`UserRole`](#userrole) value object: the wire format stays primitive, and the closed-set type is a domain concern.
- **Why it's built this way**: keeping the list DTO separate from [`UserDTO`](#userdto) lets the grid evolve (sortable columns, an added `CreatedOn`) without touching the general-purpose account DTO, and it keeps the list endpoint's payload small enough to page cheaply.
- **Where it's used**: produced by [`GetUsersHandler`](#getusershandler) inside a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), returned by [`UsersController`](#userscontroller)'s list endpoint, and consumed client-side through [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice) as the `MudDataGrid` row type on the [`UserList`](#userlist) page.

### DisabledAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` · Level 1 · class (sealed)

- **What it is**: the no-op stand-in for [`IAttendeeQueryService`](#iattendeequeryservice) that gets registered when the Identity module is switched off in a host. It returns an empty attendee list instead of failing DI.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice), the `UserIdentifierType` alias; BCL (`Task.FromResult`).
- **Concept introduced, the disabled-module stub (null object).** `[Rubric §2, Design Patterns]` (assesses recognized patterns applied deliberately: this is the Null Object pattern) and `[Rubric §7, Microservices Readiness]`. The [module system](group-14-module-system-composition.md#imodule) lets a host run any subset of modules; a host that disables Identity would otherwise fail to resolve every cross-module Identity interface at startup. `IModule.RegisterDisabledStubs` closes that hole, and [`IdentityModule`](#identitymodule) registers exactly this type there (`IdentityModule.cs:19-20`). Crucially the stub lives in `Shared`, the same assembly as the contract, so a host can reference the stub without pulling in Identity's Application or Domain assemblies.
- **Walkthrough**: the whole class is one expression-bodied method. `GetAttendeeUserIdsAsync` returns `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])` (`DisabledAttendeeQueryService.cs:10-11`): a completed task over an empty collection expression, so there is no allocation-heavy work and no `async` state machine.
- **Why it's built this way**: returning empty rather than throwing keeps "Identity is not in this host" a *configuration* fact instead of a runtime error. In the extracted topology the stub is also the safety net: `AddIdentityAttendeeClient()` calls `services.Replace(...)` to swap in the gRPC adapter (`MMCA.ADC.Identity.Contracts/DependencyInjection.cs:47`), and its doc comment (`DependencyInjection.cs:28-30`) notes that the registration it overwrites is this stub. If that replacement were ever skipped, a broadcast would reach nobody rather than crash the Notification host.
- **Where it's used**: registered by [`IdentityModule.RegisterDisabledStubs`](#identitymodule) (`IdentityModule.cs:20`) as a singleton; replaced at startup in `MMCA.ADC.Notification.Service/Program.cs:186` by [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).

### HttpContextExternalLoginEmailVerifier
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Authentication` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17` · Level 1 · class (sealed)

- **What it is**: the API-edge implementation of [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier). It re-reads the short-lived `ExternalLogin` cookie principal from the current request and reports whether the OAuth provider asserted that the email is verified.
- **Depends on**: [`IExternalLoginEmailVerifier`](#iexternalloginemailverifier) (the Application-layer contract it satisfies), `ExternalAuthExtensions.ExternalLoginScheme` from `MMCA.Common.API.Authentication`; ASP.NET Core (`IHttpContextAccessor`, `HttpContext.AuthenticateAsync`).
- **Concept introduced, the fail-closed edge adapter for a security decision.** `[Rubric §11, Security]` (assesses whether authentication decisions are made on evidence the server can verify, and what happens when that evidence is missing) and `[Rubric §3, Clean Architecture]` (assesses the dependency-inversion move: the Application layer declares the question, the API layer answers it using request-scoped state it alone can see). The threat this guards is account takeover by email match: [`AuthenticationService`](#authenticationservice)`.ExternalLoginAsync` will link an external identity to an *existing* local account, and if it did that on an email string alone, any provider that hands out unverified emails would be a takeover vector (`IExternalLoginEmailVerifier.cs:3-10`). The verifier exists so the link only happens when the provider explicitly asserts verification. Every uncertain path returns `false`: no `HttpContext`, no principal, no claim, or an unparseable claim value all read as unverified.
- **Walkthrough**
  - `EmailVerifiedClaimType` (`HttpContextExternalLoginEmailVerifier.cs:21`): the `internal const string "email_verified"` claim type, `internal` so the module's tests can assert against it without publishing it.
  - `IsCurrentExternalLoginEmailVerifiedAsync` (`HttpContextExternalLoginEmailVerifier.cs:24-36`): reads `httpContextAccessor.HttpContext` and returns `false` immediately when there is none (`HttpContextExternalLoginEmailVerifier.cs:27-30`), which covers any non-request context such as a background job.
  - It then calls `httpContext.AuthenticateAsync(ExternalAuthExtensions.ExternalLoginScheme)` (`HttpContextExternalLoginEmailVerifier.cs:32`), re-authenticating the same short-lived cookie the shared `OAuthControllerBase.CompleteAsync` just validated, and pulls `email_verified` off the resulting principal (`HttpContextExternalLoginEmailVerifier.cs:33`).
  - The final line is the fail-closed gate: `bool.TryParse(claimValue, out var verified) && verified` (`HttpContextExternalLoginEmailVerifier.cs:35`). A missing claim yields a `null` value, `TryParse` fails, and the method returns `false`.
- **Why it's built this way**: the verification assertion only exists inside the external-login cookie principal, which is request state, so the check cannot live in the Application layer without dragging `HttpContext` down there. Inverting it behind an interface keeps [`AuthenticationService`](#authenticationservice) testable with a fake verifier. The class doc (`HttpContextExternalLoginEmailVerifier.cs:8-16`) also records a real provider asymmetry: the Identity service host maps Google's claim through a `PostConfigure<GoogleOptions>` claim action, while GitHub's OAuth payload carries no such assertion, so GitHub logins report unverified by design and simply do not auto-link.
- **Where it's used**: registered with `TryAddScoped` in `AddModuleIdentityAPI` alongside `AddHttpContextAccessor()` (`MMCA.ADC.Identity.API/DependencyInjection.cs:54-55`); consumed by [`AuthenticationService`](#authenticationservice)'s external-login flow.
- **Caveats / not-in-source**: the Google claim-action mapping lives in the Identity service host's `Program.cs`, not in this file, and the `ExternalLogin` cookie itself is issued by the shared `OAuthControllerBase` (see [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase)).

### UserDataExportEngagementSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:10` · Level 1 · record (sealed)

- **What it is**: the Engagement-owned slice of a data-subject export: the user's session bookmarks and submitted session questions, plus an `Available` flag that says whether the Engagement service could actually be reached.
- **Depends on**: [`UserDataExportBookmarkDTO`](#userdataexportbookmarkdto), [`UserDataExportSubmittedQuestionDTO`](#userdataexportsubmittedquestiondto).
- **Concept introduced, the partial-availability section (graceful degradation in a composite response).** `[Rubric §29, Resilience & Business Continuity]` (assesses whether a request that fans out to peers degrades instead of failing when one peer is down) and `[Rubric §7, Microservices Readiness]` (assesses that a cross-service aggregate does not turn every peer into a hard dependency). This is the interesting design move in the export: rather than modelling "Engagement is unreachable" as an exception that fails the whole GDPR request, the contract models it as *data*. The doc comment (`UserDataExportEngagementSectionDTO.cs:6-8`) states the rule: when the peer stays unreachable after the standard resilience pipeline, the export still succeeds with `Available` set to `false` and the lists empty. The reader of the export can then tell the difference between "you had no bookmarks" and "we could not check", which a bare empty list could never express.
- **Walkthrough**: three members. `required bool Available` (`UserDataExportEngagementSectionDTO.cs:14`) is the only required one, so no producer can construct a section without stating its completeness. `Bookmarks` (`UserDataExportEngagementSectionDTO.cs:17`) and `SubmittedQuestions` (`UserDataExportEngagementSectionDTO.cs:20`) are `IReadOnlyList<T>` properties defaulting to an empty collection expression `[]`, which is what makes `new UserDataExportEngagementSectionDTO { Available = false }` a legal one-liner on the failure path.
- **Why it's built this way**: the failure default and the required flag together make the degraded case cheap to produce and impossible to produce *silently*. [`ExportUserDataHandler`](#exportuserdatahandler) catches the peer failure, logs a warning, and returns exactly that one-liner (`ExportUserDataHandler.cs:120`), so a single peer outage never denies a user their portability right.
- **Where it's used**: the `Engagement` property of [`UserDataExportDTO`](#userdataexportdto) (`UserDataExportDTO.cs:77`), populated by [`ExportUserDataHandler`](#exportuserdatahandler) via [`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) (`ExportUserDataHandler.cs:89-121`).

### UserDataExportNotificationSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:9` · Level 1 · record (sealed)

- **What it is**: the Notification-owned slice of a data-subject export: the user's inbox rows, newest first, behind the same `Available` completeness flag.
- **Depends on**: [`UserDataExportNotificationDTO`](#userdataexportnotificationdto).
- **Concept**: structurally the same partial-availability section [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto) introduces, applied to a second peer (`[Rubric §29, Resilience & Business Continuity]`). Two peers, two independent flags: the Notification service can be down while Engagement answers, and the export still returns everything it managed to gather.
- **Walkthrough**: `required bool Available` (`UserDataExportNotificationSectionDTO.cs:13`) and `IReadOnlyList<UserDataExportNotificationDTO> Notifications { get; init; } = []` (`UserDataExportNotificationSectionDTO.cs:16`), documented as newest first.
- **Where it's used**: the `Notifications` property of [`UserDataExportDTO`](#userdataexportdto) (`UserDataExportDTO.cs:81`), populated by [`ExportUserDataHandler`](#exportuserdatahandler) via [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice), with the degraded path returning `new UserDataExportNotificationSectionDTO { Available = false }` (`ExportUserDataHandler.cs:152`).

### UserDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` · Level 1 · record

- **What it is**: the general-purpose account DTO: id, email, first/last name, and role. It is the credential-free projection of the [`User`](#user) aggregate.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the framework DTO contract from `MMCA.Common.Shared.DTOs`), the `UserIdentifierType` alias.
- **Concept reinforced, the identified DTO (`IBaseDTO<TIdentifierType>`).** `[Rubric §9, API & Contract Design]` (assesses a consistent, machine-checkable response shape) and `[Rubric §11, Security]` (assesses that secrets never reach a serialization boundary). Implementing [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`UserDTO.cs:8`) is what lets this DTO plug into the framework's generic mapper and service abstractions: `Id` (`UserDTO.cs:11`) satisfies the interface. Just as important is the omission, the [`UserDTOMapper`](#userdtomapper) doc comment (`UserDTOMapper.cs:9-11`) records that `PasswordHash`, `PasswordSalt`, and `RefreshToken` are excluded from the projection, so the DTO is the enforced boundary between an aggregate that holds credentials and anything that can be serialized.
- **Walkthrough**: five `required init` members (`UserDTO.cs:11-23`), `Id`, `Email` (documented as the login credential, BR-200), `FirstName`, `LastName`, and `Role` as a `string`. Because the mapper is a Mapperly source generator, adding a member here changes generated code at build time rather than at runtime (ADR-001, manual/Mapperly mapping).
- **Why it's built this way**: `required` on every member means the compiler, not a reviewer, catches a mapper that forgets a field, and keeping the type in `Shared` lets any layer (API, UI, tests) name it without referencing the Domain assembly.
- **Where it's used**: produced by [`UserDTOMapper`](#userdtomapper), which implements [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) over ([`User`](#user), `UserDTO`, `UserIdentifierType`) and converts the [`Email`](group-02-domain-building-blocks.md#email) value object to its string form via a private `EmailToString` helper (`UserDTOMapper.cs:28`).

### UserDataExportDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportDTO.cs:16` · Level 2 · record

- **What it is**: the full portable export of everything the system holds about one user: the Identity-owned account and device fields, plus the two best-effort cross-service sections. It is the response body of the GDPR/CCPA data-subject access endpoint.
- **Depends on**: [`UserDataExportEngagementSectionDTO`](#userdataexportengagementsectiondto), [`UserDataExportNotificationSectionDTO`](#userdataexportnotificationsectiondto), the `UserIdentifierType` and `SpeakerIdentifierType` aliases; BCL (`DateTime`).
- **Concept introduced, the data-portability contract (what goes in, and what is deliberately left out).** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether the right of access and portability is implemented as a real, complete, machine-readable artifact) and `[Rubric §11, Security]`. The type doc (`UserDataExportDTO.cs:3-8`) names the exclusions and the reason: the password hash and salt, the refresh token, and the opaque external-provider key are secrets, not portable personal data, so exporting them would create a credential-leak channel out of a privacy feature. What *is* included is everything a user would recognize as theirs, including the MAUI device metadata (`DeviceId` through `DeviceType`, `UserDataExportDTO.cs:49-67`), which is exactly the block [`UserListDTO`](#userlistdto) refuses to show an organizer: the subject may see their own device data, a third party may not. The `remarks` block (`UserDataExportDTO.cs:9-15`) records the cross-service aggregation policy and notes it closed the residual on RemediationBacklog #30.
- **Walkthrough**
  - Identity account fields (`UserDataExportDTO.cs:19-34`): `required` `UserId`, `Email`, `FirstName`, `LastName`, `FullName`, and `Role`.
  - External-login fields (`UserDataExportDTO.cs:37-40`): `IsExternalLogin` and the provider *name* only; the comment on `LoginProvider` restates that the opaque provider key is intentionally omitted.
  - Cross-context links and profile (`UserDataExportDTO.cs:43-46`): the nullable `LinkedSpeakerId` (the scalar link to a Conference `Speaker`) and `AvatarUrl` (BR-116a).
  - Device metadata (`UserDataExportDTO.cs:49-67`): seven nullable strings reported by the MAUI client.
  - Audit timestamps (`UserDataExportDTO.cs:70-73`): `CreatedOn` and nullable `LastModifiedOn`, both UTC, the same audit fields the framework stamps in `SaveChangesAsync`.
  - The two nullable sections (`UserDataExportDTO.cs:77,81`): `Engagement` and `Notifications`. They are nullable rather than required because they are filled by cross-service calls, and each carries its own `Available` flag for the degraded case.
- **Why it's built this way**: modelling the export as one flat, versionable record with nested per-service sections keeps the whole subject-access response a single GET, while the per-section availability flags mean a peer outage costs the user completeness, not the request. Together with the erasure path on the [`User`](#user) aggregate (ADR-005), this is the read half of the privacy pair: export what we hold, then anonymize it on request.
- **Where it's used**: produced by [`ExportUserDataHandler`](#exportuserdatahandler) (`ExportUserDataHandler.cs:61-84`) for [`ExportUserDataQuery`](#exportuserdataquery), returned by [`UsersController`](#userscontroller)'s `{userId}/export` endpoint under the handler's owner-or-organizer check.

### IdentityUIModule
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's UI descriptor. It tells the shared Blazor shell two things: which navigation entries this module contributes, and which assembly to scan for routable components.
- **Depends on**: [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the contract), [`NavItem`](group-15-common-ui-framework.md#navitem) and [`NavSection`](group-15-common-ui-framework.md#navsection), [`IdentityRoutePaths`](#identityroutepaths), [`RoleNames`](group-08-auth.md#rolenames); externals: MudBlazor `Icons.Material.Filled`, BCL `Assembly`.
- **Concept reinforced, the pluggable UI module descriptor.** `[Rubric §18, UI Architecture]` (assesses whether the shell discovers features rather than hard-coding them) and `[Rubric §25, Navigation & Information Architecture]` (assesses that menu structure, role gating, and routes are declared next to the feature that owns them). The [`IUIModule`](group-15-common-ui-framework.md#iuimodule) contract is introduced in group-15: a host collects every registered implementation, merges their `NavItems` into the sidebar, and passes their `Assembly` to `AddAdditionalAssemblies` so the router can find pages in a Razor Class Library. The effect is that adding the Identity module to a host adds its pages *and* its menu entries in one registration, with no edit to the shell. `[Rubric §11, Security]` and `[Rubric §27, Internationalization]` both show up in the two declarations below.
- **Walkthrough**: two members.
  - `NavItems` (`IdentityUIModule.cs:15-19`), a collection-expression-initialized `IReadOnlyList<NavItem>` with two entries. "My Profile" points at [`IdentityRoutePaths`](#identityroutepaths)`.Profile` with a `Person` icon in `NavSection.User` and no required role, so every signed-in user sees it (`IdentityUIModule.cs:17`). "Users" points at `IdentityRoutePaths.Users` with a `SupervisedUserCircle` icon, passes [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` as the `RequiredRole` positional argument, and sits in `NavSection.Admin` (`IdentityUIModule.cs:18`), so the link is only rendered for organizers. Note that this hides the entry, the actual enforcement is server-side on [`UsersController`](#userscontroller); menu gating is UX, not authorization.
  - Both entries pass `TitleResource: typeof(IdentityUIModule)`, which per the [`NavItem`](group-15-common-ui-framework.md#navitem) contract turns `"Nav.MyProfile"` and `"Nav.Users"` into *resource keys* resolved against this type's resources at render time, so the menu follows the active culture (ADR-027).
  - `Assembly => typeof(IdentityUIModule).Assembly` (`IdentityUIModule.cs:21`): the self-referencing assembly handle used for Blazor route discovery.
- **Why it's built this way**: a descriptor class is the smallest thing that can carry declarative metadata into DI. Because it is a plain sealed class with no dependencies, it registers as a singleton and costs nothing at runtime, while keeping the sidebar's Identity section owned by the Identity module rather than by the host.
- **Where it's used**: registered as `IUIModule` in [`DependencyInjection.AddIdentityUI`](#dependencyinjection) (`MMCA.ADC.Identity.UI/DependencyInjection.cs:32`); also the `FromAssemblyOf<IdentityUIModule>` marker for that method's Scrutor scan (`DependencyInjection.cs:23`).

### DependencyInjection
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:11` · Level 4 · class (static)

- **What it is**: the one-call registration entry point for the Identity UI layer. `AddIdentityUI()` wires the module's entity services, its bespoke user service, and its [`IdentityUIModule`](#identityuimodule) descriptor into any Blazor host.
- **Depends on**: [`IdentityUIModule`](#identityuimodule), [`IUserUIService`](#iuseruiservice) / [`UserService`](#userservice), [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) and [`IUIModule`](group-15-common-ui-framework.md#iuimodule) from `MMCA.Common.UI`; externals: `IServiceCollection` and Scrutor's `Scan`.
- **Concept reinforced, the `extension(IServiceCollection)` registration block.** `[Rubric §15, Best Practices & Code Quality]` (assesses idiomatic, current-language composition) and `[Rubric §3, Clean Architecture]` (assesses that each layer owns its own wiring instead of the host reaching into it). This file is the UI-layer instance of the convention used across all four repos: instead of a classic `public static IServiceCollection AddX(this IServiceCollection services)`, the method lives inside a C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:13`) and the receiver is named once for the whole block. Callers see an ordinary `services.AddIdentityUI()`.
- **Walkthrough**: `AddIdentityUI()` (`DependencyInjection.cs:19-35`) does three things and returns `services` for chaining.
  - A Scrutor scan over this assembly registering every [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) implementation `AsImplementedInterfaces` with a scoped lifetime (`DependencyInjection.cs:22-26`). Convention over configuration: a new standard CRUD-shaped UI service needs no registration edit.
  - An explicit `services.AddScoped<IUserUIService, UserService>()` (`DependencyInjection.cs:29`). The comment above it explains why this one is hand-written: users are a custom contract, not an `IEntityService`, so the scan cannot pick it up (the same asymmetry [`IUserUIService`](#iuseruiservice) documents).
  - `services.AddSingleton<IUIModule, IdentityUIModule>()` (`DependencyInjection.cs:32`), contributing the nav items and the assembly for component discovery. Singleton is right because the descriptor is immutable metadata.
- **Why it's built this way**: one host-facing method per module keeps the three hosts symmetric, they each call `AddIdentityUI()` and nothing else. The mix of scan plus explicit registration is deliberate: the scan covers the uniform majority, and the one bespoke contract is registered by hand where a reader can see it.
- **Where it's used**: called by all three UI hosts, `MMCA.ADC.UI.Web/Program.cs:70` (Blazor Server), `MMCA.ADC.UI.Web.Client/Program.cs:54` (the WebAssembly client), and `MMCA.ADC.UI/MauiProgram.cs:77` (MAUI), which is what lets the same Razor Class Library render on web and mobile.

### ChangePasswordRequestValidator

> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` · Level 1 · class (sealed)

- **What it is**: the FluentValidation rule set for a self-service password change. It requires the caller to supply a non-empty current password and holds the new password to the shared strong-password policy.
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet), [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (the request DTO from `MMCA.Common.Shared.Auth`), and [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest) from `MMCA.Common.Application.Validation`.
- **Concept reinforced, composable rule sets over copy-pasted rules.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether input rules are declared once and applied consistently at every entry point. FluentValidation's `Include` (`ChangePasswordRequestValidator.cs:18`) splices an entire other validator's rules into this one, so the password-complexity policy lives in exactly one framework type and this validator only states *which property* it applies to. The validator itself is discovered by assembly scan and executed by the CQRS validating decorator, so the API controller never calls it directly (see the pipeline in [00-primer.md](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**
  - Constructor (`ChangePasswordRequestValidator.cs:13`): the whole type is rules declared in a constructor, which is the FluentValidation idiom.
  - `CurrentPassword` (lines 15-16): `NotEmpty()` with the message "Current password is required." and, importantly, an explicit `WithErrorCode("User.CurrentPassword.Required")`. The stable error code (not the human message) is what the API surfaces and what a client can branch on.
  - `NewPassword` (line 18): `Include(new StrongPasswordRules<ChangePasswordRequest>(x => x.NewPassword))` applies the shared complexity policy by passing a property selector.
- **Why it's built this way**: the *current* password gets only a presence check because proving it is correct is a cryptographic operation, not a shape check: [`ChangePasswordHandler`](#changepasswordhandler) verifies it against the stored hash and salt. Validation stays about the shape of the request; authorization and proof-of-knowledge stay in the handler.
- **Where it's used**: resolved by the validating decorator when [`ChangePasswordCommand`](#changepasswordcommand) is dispatched from [`AuthController.ChangePasswordAsync`](#authcontroller).

### IUserUIService

> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` · Level 1 · interface

- **What it is**: the client-side contract the Blazor/MAUI UI uses to talk to the Identity `users` API: a paginated organizer user list, account deletion, and the three current-user avatar operations.
- **Depends on**: [`UserListDTO`](#userlistdto) and the `UserIdentifierType` alias (`= int`), both from `MMCA.ADC.Identity.Shared.Users`.
- **Concept introduced, the hand-written UI service contract (versus the generic CRUD base).** `[Rubric §18, UI Architecture]` assesses whether pages depend on abstractions rather than on `HttpClient` directly. Most ADC list pages ride a generic framework CRUD service, but the doc comment (`IUserUIService.cs:5-10`) states exactly why this one cannot: the users API returns [`UserListDTO`](#userlistdto), which does not implement `IBaseDTO<TIdentifierType>`, and the resource exposes only list plus delete, not the standard create/update/get-by-id set. Rather than widen the generic base to fit an outlier, the module declares a purpose-built interface. `[Rubric §1, SOLID]`: this is interface segregation applied to the client layer, the UI depends only on the five operations that actually exist.
- **Walkthrough**
  - `GetPagedAsync` (`IUserUIService.cs:16-25`): every filter (`email`, `firstName`, `lastName`, `role`) and every paging/sorting argument is optional with a default (`pageNumber = 1`, `pageSize = 10`), and the return type is a tuple `(IReadOnlyList<UserListDTO> Items, int TotalItems)`, exactly the shape a MudBlazor server-side grid needs (BR-51).
  - `DeleteAsync(UserIdentifierType, CancellationToken)` (line 30): returns `bool`, with the doc comment recording the server-side rule (owner or Organizer, UC-21).
  - `GetMyAvatarUrlAsync` (line 33), `UploadMyAvatarAsync` (line 39), `RemoveMyAvatarAsync` (line 42): the three "me" operations (BR-116a). Upload takes a raw `Stream` plus `fileName` and `contentType`, so the same contract serves both a Blazor `InputFile` and a MAUI media picker; it returns `string?` (the new public URL) with `null` meaning the server rejected the upload.
- **Why it's built this way**: keeping the contract in `Identity.UI` (not in a shared UI framework package) keeps the outlier local to the module that has the outlier API. Every method carries a `CancellationToken` with a default, which matters in Blazor where a component can be disposed mid-request.
- **Where it's used**: implemented by [`UserService`](#userservice); injected into [`UserList`](#userlist) and the profile/avatar pages.

### ListPageActions

> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Common` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Common/ListPageActions.cs:13` · Level 2 · class (static)

- **What it is**: two static helpers that every ADC organizer list page reuses: reload whichever layout (mobile list or desktop grid) is currently rendered, and run the canonical confirm, delete, toast, reload flow.
- **Depends on**: [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and the `DeleteConfirmation` dialog component (both `MMCA.Common.UI.Components`), MudBlazor's `MudDataGrid<T>` and `ISnackbar`, and the BCL `Func<>`/`OperationCanceledException`.
- **Concept introduced, ADC-side shared UI code placed by reference direction.** `[Rubric §16, Maintainability]` assesses whether duplicated logic gets a single home. The class comment (`ListPageActions.cs:6-12`) explains an unusual but deliberate placement: this helper is not Identity-specific, yet it lives in `Identity.UI` because Identity.UI is the root of the ADC module UI reference chain (Conference.UI references Identity.UI, Engagement.UI references Conference.UI), so it is the one ADC location every module UI project can already see. It is not in MMCA.Common because it encodes an ADC page convention, not a framework primitive. `[Rubric §22, Responsive & Cross-Browser]`: the mobile/desktop split is a genuine dual-render, and this helper is where the "which one is live" branch is centralized.
- **Walkthrough**
  - `ReloadActiveLayoutAsync<TDto>(bool isMobile, MobileInfiniteScrollList<TDto>?, MudDataGrid<TDto>?)` (`ListPageActions.cs:24-37`): both component references are nullable because only one layout is rendered at a time. When `isMobile` and the mobile list exists it calls `ResetAsync()` (line 31), otherwise it calls `dataGrid.ReloadServerData()` when the grid exists (line 35). If neither is present the call is a silent no-op, which is the right behavior during a render-mode transition.
  - `DeleteWithConfirmationAsync(...)` (`ListPageActions.cs:51-86`): guards all five reference arguments with `ArgumentNullException.ThrowIfNull` (lines 60-64), shows the confirmation dialog and returns early unless the result is exactly `true` (`confirmed is not true`, lines 66-70, so both "cancelled" and "dismissed/null" abort), then runs `deleteAsync()`, toasts `successMessage` at `Severity.Success`, and awaits `reloadAsync()` (lines 74-76).
  - Error handling (lines 78-85): `OperationCanceledException` is caught and deliberately swallowed with a comment naming the two causes (component disposal, InteractiveAuto render-mode transition); any other exception is mapped through the caller-supplied `Func<Exception, string> errorMessage` and toasted at `Severity.Error`.
- **Why it's built this way**: the caller passes in *localized* strings and a mapping function rather than the helper formatting text itself, so the shared flow stays free of resource lookups while each page keeps its own localized copy (`[Rubric §27, Internationalization]`). Distinguishing cancellation from failure is a real UX rule: a disposed component must not flash a red error toast at a user who already navigated away.
- **Where it's used**: [`UserList`](#userlist) wraps both methods (`UserList.razor.cs:38-39` and `75-83`); the Conference and Engagement list pages call the same two helpers.

### UserDeleted

> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` · Level 2 · record

- **What it is**: the in-process domain event raised when a user account is soft-deleted (BR-56). It carries only the user id.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (base) and the `UserIdentifierType` alias.
- **Concept reinforced, the domain event as a fact, not a command.** `[Rubric §6, CQRS & Event-Driven]` assesses whether state changes are announced rather than orchestrated inline. The record is past tense and carries the minimum payload; the doc comment (`UserDeleted.cs:5-7`) frames it as a hook so other bounded contexts can react (cascade cleanup, audit logging) without the aggregate knowing who listens. Domain events (this) differ from integration events ([`UserRegistered`](#userregistered)): domain events are dispatched in-process during `SaveChangesAsync`, integration events go through the outbox to the broker (ADR-003).
- **Walkthrough**: a one-line `sealed record class` with a single positional parameter `UserId` (`UserDeleted.cs:10-12`), inheriting [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) which supplies the event id and occurrence timestamp. There is no body: everything a handler needs beyond the id it must load itself.
- **Why it's built this way**: shipping only the id (rather than a snapshot of the user) keeps a personal-data-bearing aggregate out of the event stream, which matters because the very next thing that happens to this user is erasure (see [`User.Anonymize`](#user), ADR-005).
- **Where it's used**: added by `User.Delete()` (`User.cs:354`) and dispatched by the framework `ApplicationDbContext` during save.
- **Caveats / not-in-source**: no handler for this event is registered in the Identity module today; it is a published extension point, not an active flow.

### UserPasswordChanged

> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` · Level 2 · record

- **What it is**: the in-process domain event raised when a user's credentials are replaced. Structurally identical to [`UserDeleted`](#userdeleted).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) and the `UserIdentifierType` alias.
- **Concept reinforced, minimal-payload domain events** (introduced at [`UserDeleted`](#userdeleted)). `[Rubric §11, Security]`: the payload is the user id and nothing else. No hash, no salt, no old or new password ever enters an event, so credential material cannot leak through a logging or auditing subscriber.
- **Walkthrough**: `sealed record class UserPasswordChanged(UserIdentifierType UserId) : BaseDomainEvent` (`UserPasswordChanged.cs:9-11`). One parameter, no body.
- **Why it's built this way**: password change is exactly the kind of event a security-audit or "notify the account owner" feature would subscribe to later, so the aggregate raises it now even without a consumer; adding a subscriber later requires no change to the domain.
- **Where it's used**: raised inside `User.ChangePassword` only after the invariant checks pass (`User.cs:316`).
- **Caveats / not-in-source**: as with [`UserDeleted`](#userdeleted), no subscriber is registered in the Identity module today.

### UserRegistered

> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` · Level 3 · record

- **What it is**: the cross-module integration event announcing that a new user registered. It is the one message that lets Conference react to a registration without referencing anything in Identity.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (base) and the `UserIdentifierType` alias.
- **Concept introduced, the integration event and why it lives in `.Shared`.** `[Rubric §7, Microservices Readiness]` assesses whether modules coordinate through published contracts instead of direct references. Note the assembly: this record is in `Identity.Shared`, not `Identity.Domain`. Domain events ([`UserDeleted`](#userdeleted)) stay private to the aggregate's assembly; an integration event is a *published contract*, so it lives in the thin `Shared` project that other modules are allowed to reference. `[Rubric §6, CQRS & Event-Driven]`: it flows Identity to Conference through the outbox and MassTransit broker (ADR-003), so the two services stay decoupled at runtime and each can be down without failing the other's write.
- **Walkthrough**: `sealed record class UserRegistered(UserIdentifierType UserId, string Email, string FirstName, string LastName, string Role) : BaseIntegrationEvent` (`UserRegistered.cs:23-29`). Unlike the domain events, this one carries a payload: `Email`, `FirstName`, and `LastName` are present because the subscriber needs them for identity matching across a database boundary (there is no cross-database join to fall back on). `Role` records what the account was assigned at registration time.
- **Why it's built this way**: the doc comment (`UserRegistered.cs:5-16`) is unusually explicit about two decisions. First, publication happens *after* the unit-of-work commit so `UserId` is the database-generated identity, not a placeholder zero (see the override in [`AuthenticationService`](#authenticationservice)). Second, it replaced a direct cross-module call (`ISpeakerLinkingService.TryAutoLinkSpeakerAsync` from Identity into Conference); the event inverts that dependency so Identity stays a leaf module. The Conference-side subscriber [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler) runs the speaker email-match auto-link (BR-207). Note that ADC deliberately diverges from Store here, which models the same concept as an in-process domain event.
- **Where it's used**: published by [`AuthenticationService`](#authenticationservice) (both local registration and first-time external OAuth account creation); consumed by Conference's [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler).
- **Caveats / not-in-source**: the payload includes PII (email and names) crossing the broker. The retention and encryption posture of the broker itself is infrastructure configuration, not visible in this file.

### UserService

> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:14` · Level 3 · class (sealed)

- **What it is**: the HTTP implementation of [`IUserUIService`](#iuseruiservice): it builds the query string, attaches the bearer token, calls the `users` endpoints through the Gateway, and deserializes the responses.
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) (base), [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice), `IHttpClientFactory`, [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), and `System.Net.Http.Json`.
- **Concept introduced, the authenticated UI HTTP service.** `[Rubric §18, UI Architecture]` and `[Rubric §26, Front-End Security]`. The class is a primary-constructor `sealed class` forwarding both dependencies to [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) (`UserService.cs:14-15`), which supplies two things every call reuses: `CreateAuthenticatedClientAsync()` (a client with the stored JWT already attached, so no page ever handles a raw token) and `RetryPolicy` (a shared transient-fault policy). Every method follows the same four beats: create the authenticated client, execute through the retry policy, translate a non-success response into a domain exception via `ServiceExceptionHelper.ThrowIfDomainExceptionAsync`, then deserialize.
- **Walkthrough**
  - `Endpoint = "users"` (`UserService.cs:17`): a relative path. All URLs are built with `UriKind.Relative`, so the base address (the Gateway) is configured once at registration.
  - `GetPagedAsync` (lines 19-63): assembles a `Dictionary<string, string?>` of every filter and paging argument (lines 30-40), then filters out blank values and URL-encodes each one with `Uri.EscapeDataString` before joining with `&` (lines 42-44). Skipping blanks keeps the query string minimal; encoding is what makes an email or a name with a space safe. The response is read as [`PagedCollectionResult<UserListDTO>`](group-01-result-error-handling.md#pagedcollectionresultt) and flattened to the tuple the grid wants, defaulting to an empty list and `0` when the body is null (lines 57-62).
  - `DeleteAsync` (lines 65-80): builds `users/{id}` with `string.Create(CultureInfo.InvariantCulture, ...)`, which is the culture-safe way to format an id (an analyzer-enforced convention across the codebase), and returns `true` after `EnsureSuccessStatusCode`.
  - `GetMyAvatarUrlAsync` (lines 82-93): the one method that does *not* throw on failure. A non-success status returns `null` (lines 88-89), because "no avatar" and "could not fetch it" both render the same fallback and neither is worth an error toast.
  - `UploadMyAvatarAsync` (lines 95-118): deliberately bypasses `RetryPolicy` with an explicit comment (line 103): the content stream is single-shot, and picker or file-input streams do not rewind, so a retry would post an empty body. It builds a `MultipartFormDataContent` with a single `file` part carrying the caller-supplied content type (lines 104-107).
  - `RemoveMyAvatarAsync` (lines 120-131): delete through the retry policy, returning the success flag.
- **Why it's built this way**: `[Rubric §29, Resilience]`: retry is applied where it is safe (idempotent GET and DELETE) and withheld where it is not (a stream-backed POST), which is the correct discrimination rather than a blanket policy. Using `IHttpClientFactory` plus a per-call `using var httpClient` keeps handler lifetimes managed by the factory.
- **Where it's used**: registered as the [`IUserUIService`](#iuseruiservice) implementation in the Identity UI DI extension and injected into [`UserList`](#userlist) and the profile/avatar components.

### UserClaimsController

> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` · Level 4 · class (sealed)

- **What it is**: a single-endpoint diagnostic controller that echoes back the claims carried by the caller's own JWT (UC-10).
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (base), ASP.NET Core MVC, and `Asp.Versioning`.
- **Concept reinforced, the standard ADC controller attribute stack.** `[Rubric §9, API & Contract Design]` assesses whether endpoints are consistently declared and documented. Every ADC controller wears the same four class attributes (`UserClaimsController.cs:12-15`): `[ApiController]` (automatic model-state validation and binding-source inference), `[Route("[controller]")]` (the route is the class name minus the suffix, here `/UserClaims`), `[ApiVersion("1.0")]` (ADC versions by the `api-version` header), and `[Authorize]`. The `[ProducesResponseType]` pairs on the action (lines 23-24) are what the OpenAPI document is generated from.
- **Walkthrough**: `GetClaims()` (`UserClaimsController.cs:25`) is synchronous because it touches no I/O: everything it returns is already on `HttpContext.User`, materialized by the JWT bearer handler during authentication. It groups claims by type (line 28) and projects each group into a dictionary value that is a bare string when there is one claim of that type and a list when there are several (lines 31-35). That collapse matters because a JWT legitimately repeats claim types (roles being the usual case), and a naive `ToDictionary(c => c.Type, ...)` would throw on the duplicate key.
- **Why it's built this way**: the endpoint is a debugging and client-bootstrapping aid: the doc comment (lines 18-21) names the claims a client can expect (`user_id`, `email`, `role`, optional `speaker_id`), and `speaker_id` is exactly the one that appears only after the User-to-Speaker link resolves (BR-209). It returns nothing the caller does not already possess (`[Rubric §11, Security]`: `[Authorize]` plus reading only `HttpContext.User` means it is structurally incapable of disclosing another user's data).
- **Where it's used**: called by clients and by manual/E2E diagnostics; routed through the Gateway to the Identity service.

### UserList

> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.User` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16` · Level 4 · class (partial)

- **What it is**: the code-behind for the organizer user list page: a server-paged, server-sorted, per-column-filterable grid on desktop and an infinite-scroll card list on mobile, with delete (BR-51, UC-21).
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (base), [`IUserUIService`](#iuseruiservice), [`ListPageActions`](#listpageactions), [`UserListDTO`](#userlistdto), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), the `DeleteConfirmation` component, and MudBlazor's `MudDataGrid<T>`/`GridState<T>`/`GridData<T>`.
- **Concept introduced, the code-behind list page over a framework base.** `[Rubric §18, UI Architecture]` assesses separation of markup from behavior and reuse of page scaffolding. The page is split into a `.razor` markup file and this `partial class`, and the class inherits [`DataGridListPageBase<UserListDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), which supplies the localizer `L`, `Snackbar`, `IsMobile`, filter persistence, and the `LoadServerDataAsync` adapter. The subclass therefore contains only what is genuinely user-specific: which service to call, which four columns are filterable, and what to do on delete. `[Rubric §23, Front-End Performance]`: nothing is loaded client-side and filtered in the browser; paging, sorting, and filtering are all pushed to the API.
- **Walkthrough**
  - Base contract (`UserList.razor.cs:18-24`): `Title` and `EntityName` read from the localizer `L`, and `GridRef` exposes the `_dataGrid` field so the base can drive reloads.
  - Injected service (line 21): `[Inject] private IUserUIService UserService`, the interface, never a concrete HTTP type.
  - Component references (lines 23-29): the desktop grid, the mobile infinite list, and the `DeleteConfirmation` dialog. `_dataGrid` and `_infiniteList` are nullable (only one layout renders), `_deleteConfirm` is `default!` because the dialog is always in the markup.
  - `RetryLoadAsync` (line 27): the retry action offered by the base's inline error state, a null-safe `ReloadServerData()`.
  - `SaveFilters`/`RestoreFilters` (lines 32-36): the two overrides that persist the free-text `_searchString` across navigation, so returning to the list keeps the operator's search.
  - `LoadServerData` (lines 47-64): the desktop fetch. It hands the base a lambda that pulls the four per-column filter values out of MudBlazor's filter dictionary by `nameof(UserListDTO.X)` (lines 52-55) and forwards them plus page, size, and sort to `UserService.GetPagedAsync`. The second lambda (lines 60-64) injects the toolbar search box as a `contains` filter on `Email`, so the free-text search and the column filters use one code path.
  - `FetchMobilePage` (lines 67-72): the mobile fetch, simplified to search-on-email only and fixed `"Email"` ascending sort, because the card layout has no column headers to sort by.
  - `DeleteUserAsync` (lines 75-83): delegates the whole flow to [`ListPageActions.DeleteWithConfirmationAsync`](#listpageactions), passing the user's email as the confirmation subject, the delete call, and two localized messages (`Snackbar.UserDeleted`, `Snackbar.DeleteUserFailed`).
  - `ReloadActiveLayoutAsync` (lines 38-39): one line delegating to [`ListPageActions`](#listpageactions).
- **Why it's built this way**: `nameof(UserListDTO.Email)` rather than a `"Email"` literal ties the filter key to the DTO property, so a rename is a compile error rather than a silently dead filter. Delegating delete and reload to [`ListPageActions`](#listpageactions) means the cancellation-swallowing and confirm-first behavior is identical on every ADC list page, which is a `[Rubric §24, Forms, Validation & UX Safety]` concern: destructive actions always confirm.
- **Where it's used**: routed as the organizer user-management page in the ADC web and MAUI UI; the server side it calls is [`UsersController.GetAllAsync`](#userscontroller), which is gated on the `UsersRead` permission.

### UserRole

> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` · Level 4 · class (sealed)

- **What it is**: the value object for an ADC user role. It fixes the valid role set (Organizer, Attendee, ContentEditor), parses strings safely, and provides the case-insensitive comparisons every authorization check needs.
- **Depends on**: [`RoleValue`](group-08-auth.md#rolevalue) (the framework base in `MMCA.Common.Shared.Auth`), `RoleNames` (the shared canonical name constants), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and `System.Collections.Frozen.FrozenDictionary`.
- **Concept introduced, the closed-set value object over a bare string.** `[Rubric §4, DDD]` assesses whether domain concepts get types instead of primitives. A role is stored as a plain string in the database (that is what EF maps), but inside the domain it is a `UserRole`: the type is the only place the valid set is written down, and `FromString` is the only supported way in. The base [`RoleValue`](group-08-auth.md#rolevalue) supplies value equality, hashing, and validation (`UserRole.cs:14-15`); this subclass supplies the ADC-specific set. `[Rubric §11, Security]`: role comparison is a security decision, and getting the case sensitivity wrong is a real vulnerability class, which is why this type provides `IsOrganizer` rather than letting callers write `==`.
- **Walkthrough**
  - The three canonical instances (`UserRole.cs:20`, `23`, `30`): `Organizer` (manages conference master data, BR-41), `Attendee` (the default for new registrations, BR-45), and `ContentEditor`. The `ContentEditor` doc comment (lines 25-29) defines it precisely as a strict capability subset of Organizer: it curates sessions, speakers, and categories, but cannot change event structure, rooms, feedback questions, run session selection, or read the user list.
  - `AllByValue` (lines 32-33): a `FrozenDictionary<string, UserRole>` built once by the base's `BuildLookup`. `FrozenDictionary` is the BCL's read-optimized dictionary: built once at type initialization, then faster to read than a regular dictionary for the life of the process, which fits a lookup consulted on many requests and never mutated.
  - Private constructor (lines 35-38): no caller can invent a fourth role.
  - `FromString` (lines 51-58): a dictionary probe returning [`Result<UserRole>`](group-01-result-error-handling.md#result), with a failure carrying `Error.Invariant` code `"User.Role.Invalid"`. Note `role ?? string.Empty`, so a null input is a clean validation failure rather than an exception.
  - `IsValid` (line 65): the boolean form, used by [`UserInvariants.EnsureRoleIsValid`](#userinvariants).
  - `IsOrganizer(string?)` (line 76): `string.Equals(role, Organizer, StringComparison.OrdinalIgnoreCase)`. The doc comment (lines 67-73) states the trap it exists to prevent: because of the implicit `string` conversion, a plain `==` against `Organizer` compiles but compares *ordinally*, so a claim of `"organizer"` would silently fail the check. Raw JWT claim strings can carry any casing, so authorization on a claim must go through this method.
  - Equality members (lines 78-90) and the implicit `string` conversion plus the `ToString()` named alternate required by analyzer CA2225 (lines 94-98).
- **Why it's built this way**: the lookup is the single source of truth, so adding a role is one line plus one `BuildLookup` argument, and every validator, parser, and check picks it up. Keeping the implicit string conversion preserves compatibility with the string-typed `User.Role` column and with claim-based code, at the cost of the ordinal-comparison trap that `IsOrganizer` closes.
- **Where it's used**: [`UserInvariants.EnsureRoleIsValid`](#userinvariants), [`User.Create`](#user) and `CreateExternal` (the BR-45 Attendee default), [`AuthenticationService`](#authenticationservice), [`DeleteUserHandler`](#deleteuserhandler) and [`ExportUserDataHandler`](#exportuserdatahandler) for the owner-or-organizer checks, and [`IdentityModuleDbSeeder`](#identitymoduledbseeder).

### UserInvariants

> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:10` · Level 5 · class (static)

- **What it is**: the rule book for the [`User`](#user) aggregate: the field-length constants and the per-field `Ensure...` checks that every factory and mutator runs before changing state.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the framework primitives), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures), and `System.Net.Mail.MailAddress` (BCL).
- **Concept reinforced, invariants as a separate static companion.** `[Rubric §4, DDD]` assesses whether business rules live in the domain rather than in handlers or controllers. Pulling the checks out of the entity into a static companion keeps [`User`](#user) readable (its factory is a `Result.Combine` of named rules) and makes each rule independently unit-testable. Every method returns a [`Result`](group-01-result-error-handling.md#result), never throws, which is what lets the aggregate accumulate *all* validation failures in one pass instead of surfacing the first one.
- **Walkthrough**
  - Constants (`UserInvariants.cs:13-22`): `FirstNameMaxLength = 100`, `LastNameMaxLength = 100`, `EmailMaxLength = 100`, `DeviceFieldMaxLength = 256`. These are the same constants the EF configuration reads for its column widths, so the schema and the domain cannot drift apart.
  - `EnsureEmailIsValid` (lines 24-44): the one rule written with early returns rather than `Result.Combine`, because the three checks are ordered: not empty, then within `EmailMaxLength`, then a real address per `MailAddress.TryCreate` (line 34). Running the format parse on an empty string would produce a confusing second error, so it short-circuits. Failure code `"User.Email.InvalidFormat"`.
  - `EnsureFirstNameIsValid` / `EnsureLastNameIsValid` (lines 46-54): `Result.Combine` of a not-empty and a max-length check, each with its own stable error code (`User.FirstName.Empty`, `User.FirstName.TooLong`, and the LastName equivalents).
  - `EnsurePasswordHashIsValid` / `EnsurePasswordSaltIsValid` (lines 56-60): delegate to `CommonInvariants.EnsureBytesAreNotEmpty`. Note what they do *not* check: no length, no algorithm. The domain knows credentials must be present, not how they were derived, which stays behind [`IPasswordHasher`](group-08-auth.md#ipasswordhasher).
  - `EnsureRoleIsValid` (lines 65-72): defers the set membership question to [`UserRole.IsValid`](#userrole).
  - `EnsurePreferredCultureIsValid` (lines 77-84): `null` is valid (meaning "follow the request default"), otherwise the value must pass the `SupportedCultures.IsSupported` allowlist (ADR-027). An allowlist, not a format check, is the security-relevant choice here.
  - `EnsurePreferredThemeIsValid` (lines 89-98): `null`, `"light"`, or `"dark"`, compared `OrdinalIgnoreCase` (ADR-028).
- **Why it's built this way**: every rule takes a `source` string that is passed as `nameof(Create)` or `nameof(ChangePassword)` by the caller, so a failure carries which operation produced it, which is what makes an aggregated error list diagnosable. Sharing the length constants with the EF configuration is the practical mechanism that keeps a 101-character name from being a domain success and a database truncation.
- **Where it's used**: [`User.Create`](#user), `User.CreateExternal`, `User.UpdatePreferences`, `User.ChangePassword`, and the Identity EF entity configuration (for the column widths).

### RegisterRequestValidator

> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:11` · Level 6 · class (sealed)

- **What it is**: the FluentValidation rule set for account registration: email, password strength, both names, and an optional address.
- **Depends on**: `AbstractValidator<T>` (FluentValidation), [`RegisterRequest`](group-08-auth.md#registerrequest), and four shared rule types from `MMCA.Common.Application.Validation`: [`EmailRules<T>`](group-06-validation.md#emailrulest), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest), [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), and [`AddressValidator`](group-06-validation.md#addressvalidator).
- **Concept reinforced, composed rule sets** (introduced at [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator)). `[Rubric §24, Forms, Validation & UX Safety]`. This validator is almost entirely `Include` calls: it contributes no rule expressions of its own except the conditional address rule. `[Rubric §16, Maintainability]`: tightening the password policy is a change in one framework type that both ADC validators inherit at once.
- **Walkthrough**
  - `EmailRules<RegisterRequest>(x => x.Email, "Email", 100)` (`RegisterRequestValidator.cs:15`): property selector, display name, max length. The `100` matches [`UserInvariants.EmailMaxLength`](#userinvariants), so the request is rejected at the edge with a field-level message rather than failing later as a domain invariant.
  - `StrongPasswordRules<RegisterRequest>(x => x.Password)` (line 16): the same complexity policy applied to the new-account password.
  - `RequiredStringRules` for `FirstName` and `LastName` (lines 17-18), each with display name and a 100 max length mirroring the domain constants.
  - The address rule (lines 20-22): `RuleFor(x => x.Address).SetValidator(new AddressValidator()!).When(x => x.Address is not null)`. `SetValidator` composes a whole child-object validator; the `.When` guard makes address optional, so a registration without one is valid and one *with* one is fully validated. The `!` suppresses a nullability warning on the child validator's generic argument.
- **Why it's built this way**: keeping the max lengths as literals here duplicates the domain constants numerically, which is the one place this file could drift; the domain check remains the backstop, so a drift produces a domain-level error rather than a bad row. Validation runs in the pipeline decorator, so the same rules apply whether registration arrives through REST or any future entry point.
- **Where it's used**: executed by the validating decorator on the registration path invoked from [`AuthController.RegisterAsync`](#authcontroller) through [`AuthenticationService`](#authenticationservice).
- **Caveats / not-in-source**: the numeric limits here are literals, not references to [`UserInvariants`](#userinvariants); they happen to agree today but nothing in source enforces that they stay in step.

### User

> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:18` · Level 6 · class (sealed)

- **What it is**: the Identity aggregate root. One `User` row holds the account's identity (email, names), its credentials (hash plus per-user salt), its role, its refresh-token state, optional MAUI device metadata, optional external-login identifiers, UI preferences, an avatar URL, and the optional link to a Conference `Speaker`.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (base), [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable), [`IAuthUser`](group-08-auth.md#iauthuser), the [`Email`](group-02-domain-building-blocks.md#email) value object, [`UserRole`](#userrole), [`UserInvariants`](#userinvariants), [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`UserPasswordChanged`](#userpasswordchanged), [`UserDeleted`](#userdeleted), and [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, the aggregate root with a fully encapsulated state surface.** `[Rubric §4, DDD]` assesses whether entities protect their invariants rather than acting as property bags. Every single property here has a `private set` (`User.cs:22-96`): the only way to change a user is to call a named domain method. `[Rubric §11, Security]`: that is what makes it structurally impossible for application code to assign `PasswordHash` without going through `ChangePassword`'s invariant checks, or to set `RefreshToken` without `UpdateRefreshToken`.
  Two framework contracts are worth naming. [`IAuthUser`](group-08-auth.md#iauthuser) is what lets the shared `AuthenticationServiceBase<TUser>` operate on this type without knowing it is ADC's user. [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) marks the type as supporting right-to-erasure, which is the ADR-005 answer to "how does a soft-delete-everywhere system honor a deletion request".
  `[Rubric §30, Compliance, Privacy & Data Governance]`: the `[Pii]` attribute (`User.cs:21`, `25`, `29`, `94`) tags `Email`, `FirstName`, `LastName`, and `AvatarUrl` as personal data. The attribute is declarative metadata: it lets tooling and reviewers see the PII inventory on the type itself instead of in a separate document.
- **Walkthrough**
  - `[IdValueGenerated]` (line 17): declares that the id is database-generated, which the EF configuration honors.
  - Identity and profile (lines 22-30): `Email` is the [`Email`](group-02-domain-building-blocks.md#email) value object (not a string), and is the canonical identity across all platforms per BR-200.
  - Credentials (lines 34-37): `byte[] PasswordHash` and `byte[] PasswordSalt`, mapped to `varbinary(max)`, with an explicit `#pragma warning disable CA1819` (lines 32, 38) documenting that the array-returning properties exist for EF mapping.
  - `Role` (line 41): stored as `string` for EF mapping even though the domain concept is [`UserRole`](#userrole).
  - Refresh-token state (lines 44-47): token plus UTC expiry, both nullable, `null` meaning revoked or never issued (BR-205: 7 days).
  - `LinkedSpeakerId` (line 54): a nullable `SpeakerIdentifierType` (a `Guid`), the Identity half of the 1:1 bidirectional User-to-Speaker link (BR-207/208/209). It is a scalar column, not a foreign key, because Speaker lives in a different database (ADR-006).
  - Device metadata (lines 57-75): seven nullable MAUI-only fields; the doc comment is explicit that they are analytics metadata and are *not* used for authentication (BR-201).
  - External login (lines 78-81) and the computed `IsExternalLogin` (line 99); UI preferences (lines 84-87, ADR-027/028); `AvatarUrl` (line 96, BR-116a/ADR-045) with a CA1056 suppression explaining it stays a string because EF maps a varchar and DTOs serialize it verbatim; computed `FullName` (line 102).
  - Two private constructors (lines 104-128): the parameterless one is EF's materialization constructor (it assigns non-null defaults to satisfy nullability), and the parameterized one is what the factories call.
  - `Create` (lines 147-175): the local-account factory. It builds the [`Email`](group-02-domain-building-blocks.md#email) value object and then `Result.Combine`s six invariant checks (lines 156-163) so *all* validation failures come back together, returning `Result.Failure<User>(result.Errors)` on any failure. Its `<remarks>` (lines 133-139) records a decision worth internalizing: it does **not** raise a registration domain event, because [`UserRegistered`](#userregistered) must be published after `SaveChangesAsync` so subscribers receive the real database-generated id.
  - `CreateExternal` (lines 189-215): the OAuth factory. It validates only email and names (there is no password to check), sets `PasswordHash`/`PasswordSalt` to empty arrays, defaults the role to `UserRole.Attendee`, and records `LoginProvider`/`ProviderKey`.
  - `LinkExternalProvider` (lines 223-227): attaches an OAuth identity to an existing local account, the "same email logged in via Google" path.
  - `UpdateRefreshToken` / `RevokeRefreshToken` (lines 234-247): the rotation and revocation pair (BR-205, BR-216).
  - `LinkSpeaker` / `UnlinkSpeaker` (lines 254-262): one-line setters, but named domain operations so the event handlers that call them read as intent (BR-207/209, BR-70).
  - `UpdatePreferences` (lines 272-285): combines the culture and theme invariants, and only assigns both fields once both pass, so a rejected theme never leaves a half-applied culture.
  - `SetAvatarUrl` (line 294): deliberately dumb. The doc comment (lines 287-291) states that size, format, and re-encoding validation happen in the upload use case; the domain only records the resulting URL.
  - `ChangePassword` (lines 302-319): validates the new hash and salt, assigns them, and raises [`UserPasswordChanged`](#userpasswordchanged) (line 316) only on success.
  - `Delete` (lines 348-358): `new`-shadows the base soft-delete. It revokes the refresh token *first* (line 350), then calls `base.Delete()`, then raises [`UserDeleted`](#userdeleted) only if the base succeeded. Revoking first is the security point: a deleted account's outstanding sessions must die immediately, not at token expiry (BR-56).
  - `Anonymize` (lines 371-406): the erasure operation. It builds a placeholder email `deleted-{Id}@anonymized.invalid` using `string.Create(CultureInfo.InvariantCulture, ...)` (line 376), and the id is embedded precisely so the unique-email invariant (BR-200) still holds across many erased accounts. It is idempotent: if `Email` already equals the placeholder there is nothing left to erase and it returns success (lines 383-386). Otherwise it overwrites the email and names with placeholders, empties both credential arrays, nulls all seven device fields, the external-login pair, and `AvatarUrl`, and revokes the refresh token (lines 388-403).
- **Why it's built this way**: the split between `Delete` (soft-delete, `IsDeleted`) and `Anonymize` (destroy the personal data, keep the row) is ADR-005's resolution of a real tension. The row must survive because other bounded contexts hold scalar references to `UserId` (bookmarks, notifications) and because the audit trail depends on it; the personal data must not survive, because PRIVACY.md promises erasure. Doing both, in that order, satisfies both constraints. The aggregate never touches storage or the blob store: `Anonymize` nulls `AvatarUrl` but the doc comment (lines 89-93) notes the blob itself is deleted by the owning use case, which is the layer that knows about storage (see [`DeleteUserHandler`](#deleteuserhandler)).
- **Where it's used**: the single entity of the Identity module's DbContext; loaded and mutated by every Identity handler ([`ChangePasswordHandler`](#changepasswordhandler), [`DeleteUserHandler`](#deleteuserhandler), [`ExportUserDataHandler`](#exportuserdatahandler), [`SetUserAvatarHandler`](#setuseravatarhandler), [`GetUsersHandler`](#getusershandler)); projected by [`UserDTOMapper`](#userdtomapper); mapped by the Identity EF entity configuration; created by [`AuthenticationService`](#authenticationservice) and [`IdentityModuleDbSeeder`](#identitymoduledbseeder).

### OAuthController

> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` · Level 7 · class (sealed)

- **What it is**: the ADC social-login endpoint set (Google, GitHub). It is a body-less controller: the entire OAuth flow lives in the framework base [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) and this type exists only to supply the ADC route, version, and constructor wiring.
- **Depends on**: [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (base), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (aliased at `OAuthController.cs:6` to disambiguate it from the ASP.NET Core type of the same name), [`ICacheService`](group-09-caching.md#icacheservice), and `IConfiguration`.
- **Concept introduced, the thin derived controller.** `[Rubric §2, Design Patterns]` and `[Rubric §16, Maintainability]`. The class body is a single semicolon (`OAuthController.cs:23`): a primary-constructor declaration that forwards all three dependencies to the base and declares nothing else. All the endpoints, the challenge, the provider callback, the completion, and the single-use-code exchange, are inherited. The doc comment (lines 10-16) records two things that are not obvious: tokens never ride the redirect URL (they are exchanged for a short-lived single-use code instead, which is why [`ICacheService`](group-09-caching.md#icacheservice) is a dependency), and the class-level routing and versioning attributes are repeated here because they are not reliably inherited from the base.
- **Walkthrough**: `[Route("auth/oauth")]` (line 18) is an explicit literal route, not the `[controller]` token the other controllers use, so the OAuth endpoints sit under the auth path rather than at `/OAuth`. `[ApiController]` and `[ApiVersion("1.0")]` (lines 17, 19) complete the standard stack. The primary constructor (lines 20-23) takes the authentication service, the cache service, and configuration, and passes them straight through.
- **Why it's built this way**: `[Rubric §11, Security]`: an OAuth callback flow is easy to get subtly wrong (state handling, token leakage through the URL and therefore into browser history and referrer headers), so the algorithm lives once in MMCA.Common and every consuming app inherits the same hardened implementation. External OAuth is an ADC-only feature; Store is local-credential only, and this controller plus the host's `AddExternalAuthProviders` call is the entire ADC-side surface of that difference.
- **Where it's used**: mapped in the Identity service host and exposed through the Gateway; it drives the same [`AuthenticationService.ExternalLoginAsync`](#authenticationservice) that creates or links external accounts.
- **Caveats / not-in-source**: which providers are actually enabled, and their client ids and secrets, come from configuration read by the base and by `AddExternalAuthProviders`; nothing in this file determines them.

### UsersController

> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:30` · Level 8 · class (sealed)

- **What it is**: the REST surface for user management and personal-data operations: avatar get/upload/remove for the current user, the organizer user list, the GDPR data export, and account deletion.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (base), six injected handlers ([`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) and [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) closed over [`GetUsersQuery`](#getusersquery), [`DeleteUserCommand`](#deleteusercommand), [`ExportUserDataQuery`](#exportuserdataquery), [`SetUserAvatarCommand`](#setuseravatarcommand), [`RemoveUserAvatarCommand`](#removeuseravatarcommand), and [`GetUserAvatarQuery`](#getuseravatarquery)), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute), [`IdentityPermissions`](#identitypermissions), and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, the controller as a thin dispatcher over the CQRS pipeline.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §3, Clean Architecture]`. Every action follows one shape: read the current user id, build the query or command record, `await handler.HandleAsync(...)`, then `result.IsFailure ? HandleFailure(result.Errors) : <success>`. The controller injects *handler interfaces*, not an application service and not a mediator, so the dependency is visible in the constructor signature and the decorator pipeline (logging, caching, validation, transaction) wraps each one at registration. `HandleFailure` from [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) is the single place [`Error`](group-01-result-error-handling.md#error) codes become HTTP status codes plus `ProblemDetails`, which is why no action here writes a status code for a domain failure.
  `[Rubric §11, Security]` shows up in three different mechanisms on one controller, which is worth studying together: class-level `[Authorize]` (line 29) as the baseline; declarative permission gating with `[HasPermission(IdentityPermissions.UsersRead)]` on the list endpoint (line 124, BR-51); and *in-handler* authorization for the export and delete endpoints, where the action passes `currentUserService.UserId` and `currentUserService.Role` down to the handler (lines 161, 183) because "owner or Organizer" is a rule about domain data that an attribute cannot evaluate.
- **Walkthrough**
  - Constructor (`UsersController.cs:30-37`): six handlers plus [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), primary-constructor style.
  - `MaxAvatarBytes = 2 * 1024 * 1024` (line 40): the 2 MB cap from BR-116a, expressed as an arithmetic constant.
  - `GetAvatarAsync` (`HttpGet("me/avatar")`, lines 43-58): resolves the current user id, returns `Unauthorized()` when it is null, dispatches [`GetUserAvatarQuery`](#getuseravatarquery). The `me` route pattern takes no id from the URL at all, so a caller can only ever address their own avatar.
  - `SetAvatarAsync` (`HttpPost("me/avatar")`, lines 65-101): the most involved action. `[RequestSizeLimit(MaxAvatarBytes)]` (line 66) rejects an oversized body at the Kestrel level *before* the handler runs; the in-action check (lines 77-83) then rejects a null, empty, or over-cap `IFormFile` with `Error.Validation("Avatar.InvalidUpload", ...)`. Belt and braces, cheap and correct. The stream is copied into a right-sized `MemoryStream` and passed to the handler as a `byte[]` (lines 85-92), with `await using` on both the request stream and the buffer. The doc comment (lines 60-64) records what the *handler* then does: sniff the real format (jpeg/png/webp) rather than trusting the declared content type, and re-encode to 256x256 JPEG, which is the defense against a disguised-payload upload.
  - `RemoveAvatarAsync` (`HttpDelete("me/avatar")`, lines 104-119): dispatches [`RemoveUserAvatarCommand`](#removeuseravatarcommand) and returns `204 NoContent`; documented as idempotent.
  - `GetAllAsync` (`HttpGet`, lines 123-144): the organizer list. `[HasPermission(IdentityPermissions.UsersRead)]` gates it, and the paging arguments carry `[Range(1, int.MaxValue)]` data annotations (lines 131-132) so `[ApiController]` rejects `pageNumber=0` or a negative page size with a 400 before any code runs. Returns [`PagedCollectionResult<UserListDTO>`](group-01-result-error-handling.md#pagedcollectionresultt).
  - `ExportAsync` (`HttpGet("{userId}/export")`, lines 148-167): the data-subject access and portability endpoint (PRIVACY.md §7). It passes the target id *and* the caller's id and role into [`ExportUserDataQuery`](#exportuserdataquery), and declares 403 and 404 response types. `[Rubric §30, Compliance, Privacy & Data Governance]`: export and erasure are the two data-subject rights, and this controller is where both enter the system.
  - `DeleteAsync` (`HttpDelete("{userId}")`, lines 170-189): builds [`DeleteUserCommand`](#deleteusercommand) with the same three-value authorization payload and returns `204 NoContent` on success.
- **Why it's built this way**: keeping the "me" operations on a path with no id (rather than `users/{id}/avatar` with an ownership check) removes an entire class of ownership bug: there is no id to tamper with. Where an id *is* unavoidable (export, delete), the authorization subject travels on the command into the handler rather than being re-read from ambient context, which keeps the handler pure and unit-testable (`[Rubric §14, Testability]`). Every action is `async` with a `CancellationToken` defaulted, and every `await` uses `.ConfigureAwait(false)`, the codebase-wide analyzer-enforced convention (ADR-049).
- **Where it's used**: routed through the YARP Gateway to the Identity service; consumed by [`UserService`](#userservice) from the UI, which is what backs [`UserList`](#userlist) and the avatar components.

### AuthController

> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:25` · Level 11 · class (sealed)

- **What it is**: the ADC authentication endpoint set. It inherits login, registration, refresh, and revocation from the framework [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase), overrides two of them to add ADC-specific rate limiting, and adds three endpoints of its own (change password, get preferences, set preferences).
- **Depends on**: [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) (base), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), three handlers ([`ChangePasswordCommand`](#changepasswordcommand), [`ChangePreferencesCommand`](#changepreferencescommand), [`GetUserPreferencesQuery`](#getuserpreferencesquery)), the request/response contracts [`RegisterRequest`](group-08-auth.md#registerrequest), [`LoginRequest`](group-08-auth.md#loginrequest), [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest), [`ChangePreferencesRequest`](#changepreferencesrequest), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`UserPreferencesResponse`](#userpreferencesresponse), and ASP.NET Core's `EnableRateLimiting`.
- **Concept introduced, extending a framework controller by selective override.** `[Rubric §1, SOLID]` (Liskov and open-closed) and `[Rubric §11, Security]`. This is the richest example in the module of the inherit-then-specialize pattern: the base owns the shared auth endpoints, and ADC overrides exactly the two where its behavior genuinely differs, then adds three endpoints the framework has no opinion about. Two independent throttles guard the credential endpoints and they defend against different attacks: the per-email lockout in the authentication service (BR-212, ADR-029) stops brute force against *one* account, while `[EnableRateLimiting("auth-ip")]` (lines 39, 63) is a per-IP fixed window that stops password spraying. The comment at lines 57-60 states the reason plainly: the per-email lockout alone cannot throttle one source spraying one password across many emails.
- **Walkthrough**
  - Attributes and constructor (`AuthController.cs:22-31`): the standard `[ApiController]` / `[Route("[controller]")]` / `[ApiVersion("1.0")]` stack (no class-level `[Authorize]` here, since login and registration must be anonymous), and a primary constructor forwarding the authentication service and current-user service to the base while keeping the three handlers as its own.
  - `RegisterAsync` (override, lines 43-54): the reason for the override is one line, `HttpContext.Connection.RemoteIpAddress?.ToString()` (line 48), passed into `AuthenticationService.RegisterAsync` for the BR-213 registration rate limit. Reading the client IP requires the `HttpContext`, which the application layer does not have, so the controller is the correct place to capture it. Returns `201 Created` with the [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and documents a `409 Conflict` for a duplicate email and `429` for the rate limit.
  - `LoginAsync` (override, lines 67-70): overridden purely to attach `[EnableRateLimiting("auth-ip")]` and the `429` response documentation; the body just calls `base.LoginAsync`.
  - `ChangePasswordAsync` (`HttpPut("password")`, lines 82-97): `[Authorize]`, reads `CurrentUserService.UserId` and returns `Unauthorized()` when null, then dispatches [`ChangePasswordCommand`](#changepasswordcommand) and returns `204 NoContent`. The doc comment (lines 72-76) records the design choice: the command goes *directly* to the handler through the decorator pipeline rather than being brokered by the authentication service, so it gets validation, transaction, and cache invalidation like any other command. Note that the user id comes from the token, never from the request body: a caller cannot change someone else's password by changing a field.
  - `ChangePreferencesAsync` (`HttpPut("preferences")`, lines 108-123) and `GetPreferencesAsync` (`HttpGet("preferences")`, lines 133-146): the ADR-027/ADR-028 culture and theme persistence pair, both scoped to the token's user id. The comments (lines 99-102, 125-128) explain the purpose: preferences follow the user across devices, and a null field leaves that preference unchanged.
- **Why it's built this way**: keeping the login/refresh/revoke algorithm in MMCA.Common means the security-critical token dance is written once and hardened once; ADC's real differences are two rate-limit attributes and one IP capture, and those are the only things overridden. Persisting UI preferences server-side (rather than only in browser storage) is what makes them survive a device change, and routing them through the same CQRS pipeline as every other write means they get the same validation and audit treatment (`[Rubric §27, Internationalization]`, `[Rubric §19, State Management]`).
- **Where it's used**: mapped in the Identity service host and fronted by the Gateway's `/Auth` route; the tokens it issues are validated by the other three ADC services through JWKS discovery, with no shared secret (ADR-004).


---
[⬅ ADC Engagement Live Layer (Real-Time Polls & Session Q&A)](group-23-engagement-live-layer.md)  •  [Index](00-index.md)  •  [ADC Application Host, UI Shell & Cross-Module Composition ➡](group-25-adc-host-composition.md)
