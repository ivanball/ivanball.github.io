# 24. ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

**What this chapter covers.** This is the **Identity bounded context** of MMCA.ADC, the module that
owns *who a person is* across every ADC surface: web, WebAssembly, and MAUI. It is a small, leaf
context (no upstream module dependencies), but it touches every layer end to end, so this chapter is a
compact tour of a full vertical slice built on the framework taught in groups 1 through 14. The single
aggregate is the [`User`](#user), and around it sit the credential and refresh-token lifecycle, the
role vocabulary, the change-password / change-preferences / set-avatar use cases, the two privacy use
cases that make ADC compliant (data-subject **export** and **erasure**), the persistence and EF
configuration, the REST controllers and their shared base classes, the gRPC contract that lets other
services ask Identity a question, the integration events that keep the User-to-Speaker link consistent
across the service split, and the Blazor profile and user-list UI. The detailed per-type sections
follow; this overview shows how the pieces fit and how a request flows through them.

Almost everything here is an *instantiation* of upstream framework machinery, cross-referenced rather
than re-taught: the [`Result`](group-01-result-error-handling.md#result) pattern (G01), the
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
entity chain plus the [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and
[`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) governance markers (G02), the outbox
spine and [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) /
[`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (G04), the CQRS command/query handler
pipeline (G05), the auth base classes ([`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser),
JWKS, [`RoleValue`](group-08-auth.md#rolevalue)) from the shared auth group (G08), and the
[`IModule`](group-14-module-system-composition.md#imodule) composition system (G14). The lenses this
chapter most strongly embodies are `[Rubric §4, Domain-Driven Design]` (a behavior-rich aggregate that
guards its own invariants), `[Rubric §11, Security]` (credential handling, RS256 JWTs, permission-based
authorization), and `[Rubric §30, Compliance / Privacy / Data Governance]` (the GDPR/CCPA export and
erasure flows). The business rules referenced by the `// BR-NN` markers are catalogued in
`MMCA.ADC/specifications.md`; the privacy promises live in `MMCA.ADC/PRIVACY.md`.

## Projects, one bounded context

The module is split along the standard Clean Architecture layering (`[Rubric §3, Clean
Architecture]`), each project pinned by a trivial [`AssemblyReference`](#assemblyreference) /
[`ClassReference`](#classreference) anchor pair that Scrutor and the architecture-fitness tests use to
*name* the assembly. **`MMCA.ADC.Identity.Domain`** holds the [`User`](#user) aggregate, the
[`UserRole`](#userrole) value type, the [`UserInvariants`](#userinvariants) rule class, and the
[`UserDeleted`](#userdeleted) / [`UserPasswordChanged`](#userpasswordchanged) domain events; it depends
only on `MMCA.Common.Domain`/`.Shared` and knows nothing of EF or ASP.NET.
**`MMCA.ADC.Identity.Application`** holds the use-case handlers, the DTO mappers and validators, and
the cross-module service implementations. **`MMCA.ADC.Identity.Infrastructure`** holds the
[`ModuleApplicationDbContext`](#moduleapplicationdbcontext), the [`UserConfiguration`](#userconfiguration)
EF mapping, and the seeder. **`MMCA.ADC.Identity.API`** holds the REST controllers and the
[`IdentityModule`](#identitymodule) descriptor. **`MMCA.ADC.Identity.Shared`** is the contract package
every other layer (including the WebAssembly client) can reference without dragging in the domain: it
carries the DTOs, the [`IAttendeeQueryService`](#iattendeequeryservice) cross-module interface, the
[`UserRegistered`](#userregistered) integration event, and the [`IdentityPermissions`](#identitypermissions)
/ [`IdentitySettings`](#identitysettings) constants. Two more projects sit outside the module folder:
**`MMCA.ADC.Identity.Contracts`** (the gRPC adapter) and **`MMCA.ADC.Identity.UI`** (the Blazor pages).
The identifier alias for this context is `UserIdentifierType = int` (an EF-generated identity), while
the cross-context `LinkedSpeakerId` uses `SpeakerIdentifierType = System.Guid`.

## The User aggregate: credentials, profile, and cross-context links in one root

[`User`](#user) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:17`) is the
only aggregate root in the module, and it carries more responsibility than most: it is the credential
store (a `PasswordHash` + per-user `PasswordSalt`, both `varbinary(max)`, `User.cs:33,36`), the
refresh-token holder (`RefreshToken` / `RefreshTokenExpiry`, rotated by `UpdateRefreshToken` and
cleared by `RevokeRefreshToken`, `User.cs:233,242`), the profile (`Email`, `FirstName`, `LastName`,
each marked [`[Pii]`](group-02-domain-building-blocks.md#piiattribute), `User.cs:20-29`), the
preference store (`PreferredCulture` / `PreferredTheme`, ADR-027 / ADR-028), the avatar URL holder
(BR-116a, ADR-045), the optional MAUI device-metadata bag, the external-OAuth link
(`LoginProvider` / `ProviderKey`), and the 1:1 cross-context `LinkedSpeakerId` to a Conference
`Speaker` (BR-207 / BR-208 / BR-209). Every property has a private setter; state changes only through
the aggregate's own methods, which is encapsulation as a compile-time guarantee (`[Rubric §4,
Domain-Driven Design]`, `[Rubric §1, SOLID]`).

It follows the standard framework shape: a private EF constructor (`User.cs:103`), a private state
constructor (`User.cs:113`), and static factory methods returning
[`Result<User>`](group-01-result-error-handling.md#result). `Create` (`User.cs:146`) validates every
invariant via `Result.Combine(...)` *before* constructing anything (`User.cs:155-162`), so an invalid
user is unrepresentable; `CreateExternal` (`User.cs:188`) builds an OAuth account with empty credential
arrays. A subtlety worth calling out for later: the factory deliberately does **not** raise a
registration domain event. The `Id` is database-generated (`[IdValueGenerated]` at `User.cs:16`, set to
`default` at `User.cs:170`), so the cross-module [`UserRegistered`](#userregistered) is published by the
application layer *after* the commit, when the real id exists. The behavior methods each guard their
own rule: `ChangePassword` re-validates and raises [`UserPasswordChanged`](#userpasswordchanged)
(`User.cs:315`); `UpdatePreferences` validates against the supported-culture allowlist and the
light/dark theme values (`User.cs:271`); the overridden `Delete()` revokes the refresh token as a
security measure, calls the G02 soft-delete, and raises [`UserDeleted`](#userdeleted) (`User.cs:347`).

[`UserInvariants`](#userinvariants) (`UserInvariants.cs:10`) is the co-located static rule class whose
methods each return a [`Result`](group-01-result-error-handling.md#result); centralizing each rule as a
named, side-effect-free method is what makes the domain exhaustively unit-testable (`[Rubric §14,
Testability]`), and its `const` length limits (`FirstNameMaxLength = 100`, etc., `UserInvariants.cs:13-22`)
are the *same* constants [`UserConfiguration`](#userconfiguration) uses for the EF column widths
(`UserConfiguration.cs:24,29,33`), so the domain rule and the schema can never drift. [`UserRole`](#userrole)
(`UserRole.cs:17`) is a value object over the shared
[`RoleValue`](group-08-auth.md#rolevalue) base fixing the ADC role set (`Attendee` default,
`Organizer`, `ContentEditor`, `UserRole.cs:20-30`); its `IsOrganizer(string?)` helper (`UserRole.cs:76`)
does a case-insensitive compare because raw JWT role claims may carry any casing, and it is the exact
check the delete and export authorization gates use.

## Authentication: a thin subclass over the shared engine

The login / registration / refresh / revocation workflow is *not* re-implemented here. It lives in
[`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser) (G08 shared
auth), which owns the validate-first flow, the ADR-029 lockout and rate-limit protection, the dual-fetch
pattern, and the BR-205/206 refresh-token rotation with reuse detection.
[`AuthenticationService`](#authenticationservice)
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:22`) is
the ADC subclass that fills in only the context-specific pieces: the `Attendee` default role for new
registrations (BR-45, `AuthenticationService.cs:50`), the `speaker_id` JWT claim when the user is
linked to a speaker (BR-209, `AuthenticationService.cs:61,164`), the post-commit
[`UserRegistered`](#userregistered) publish (`AuthenticationService.cs:70`), and the external OAuth
login flow (find-by-provider, else link-by-email, else create, `AuthenticationService.cs:88`). The
`EmailExistsAsync` override deliberately passes `ignoreQueryFilters: true` (`AuthenticationService.cs:47`)
so that an erased (soft-deleted) account's email cannot be re-registered. Identity signs its tokens with
**RS256** and publishes the public key at `/.well-known/jwks.json`; peer services validate tokens by
fetching that document through the Gateway rather than sharing a secret (ADR-004, `[Rubric §11,
Security]`).

The HTTP surface is equally thin. [`AuthController`](#authcontroller) (`AuthController.cs:24`) extends
the shared [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) (G12) and adds
only the pieces ADC needs: a `register` override that captures the client IP for registration rate
limiting (BR-213), plus the change-password, change-preferences, and get-preferences endpoints that
dispatch their commands straight through the [G05 decorator pipeline](group-05-cqrs-pipeline.md).
[`OAuthController`](#oauthcontroller) (`OAuthController.cs:20`) is a near-empty subclass of
[`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (G12) that drives the
Google/GitHub challenge-callback-complete flow (tokens never ride the redirect URL); it is an ADC-only
feature (MMCA.Store uses local credentials only). [`UserClaimsController`](#userclaimscontroller)
(`UserClaimsController.cs:16`) simply reflects the authenticated JWT's claims back to the client
(UC-10), and [`UsersController`](#userscontroller) (`UsersController.cs:31`) hosts the organizer
user-list, the account-delete, the data-export, and the avatar endpoints, each injecting its handler
directly.

## The privacy pair: export and erasure

Two use cases make this module the codebase's clearest `[Rubric §30, Compliance / Privacy / Data
Governance]` story. [`DeleteUserHandler`](#deleteuserhandler) (`DeleteUserHandler.cs:15`) satisfies the
PRIVACY.md §5 "delete within 30 days" erasure promise: after an owner-or-Organizer authorization check,
it soft-deletes the row, then calls `user.Anonymize()` (`User.cs:370`), which irreversibly overwrites
the personal fields with placeholders **in place** rather than hard-deleting the record. Keeping the row
lets cross-context scalar references (bookmarks, notifications) and the audit trail survive; the
replacement email embeds the user id (`deleted-{Id}@anonymized.invalid`) so the unique-email invariant
still holds across many erased accounts, and the operation is idempotent (`User.cs:381-385`). This is
the anonymize-in-place model of ADR-005, backed by the
[`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) marker. Because the avatar photo is
also personal data, the handler captures its blob name *before* `Anonymize` nulls the URL and deletes
it from storage *after* the erasure is persisted (`DeleteUserHandler.cs:47,58`).

[`ExportUserDataHandler`](#exportuserdatahandler) (`ExportUserDataHandler.cs:26`) is the data-subject
*access* request (PRIVACY.md §7). It is a query handler (it never calls `SaveChanges`), it applies the
same owner-or-Organizer rule, and it projects the user's Identity-owned data into a
[`UserDataExportDTO`](#userdataexportdto), **deliberately excluding** credentials (hash, salt, refresh
token, provider key, `ExportUserDataHandler.cs:14-18`). What makes it interesting is the cross-service
aggregation: it also gathers the user's Engagement section (bookmarks, submitted questions) and
Notifications section (inbox rows) from peer services, and it does so **best-effort per section**. If a
peer stays unreachable after the standard Polly resilience pipeline, the export still succeeds with that
section marked `Available = false` (`ExportUserDataHandler.cs:115-121`), so one peer outage never fails
the whole export. That is `[Rubric §29, Resilience]` and `[Rubric §7, Microservices Readiness]` applied
to a compliance workflow.

## Persistence, seeding, and the disabled stub

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:15`) is the
abstract, engine-agnostic context declaring the single `Users` set; the concrete per-engine context
inherits it, and the base `ApplicationDbContext` supplies audit stamping, soft-delete filters, and
outbox/domain-event dispatch via interceptors. Identity owns its own `ADC_Identity` database with its
own `dbo.OutboxMessages`, so it never races another service's outbox (database-per-service, ADR-006).
[`UserConfiguration`](#userconfiguration) (`UserConfiguration.cs:12`) maps the
[`Email`](group-02-domain-building-blocks.md#email) value object through a value converter and mirrors
the invariant length constants onto the columns. [`SoftDeletedUserValidator`](#softdeleteduservalidator)
(`SoftDeletedUserValidator.cs:10`) implements the shared
[`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (G08) with a single
filter-bypassing `ExistsAsync` so the request pipeline's soft-deleted-user middleware can reject tokens
belonging to erased accounts (BR-133). When the Identity module is *disabled* in a host, the
[`IdentityModule`](#identitymodule) descriptor (`IdentityModule.cs:13`) registers a
`DisabledAttendeeQueryService` null-object stub via `RegisterDisabledStubs` (`IdentityModule.cs:19`), so
a consumer that only needs the attendee list degrades gracefully rather than failing to compose.

## Crossing the service boundary: gRPC and integration events

Identity talks to its peers two ways, and both live in `Shared`/`Contracts` so neither side reaches
into the other's domain (`[Rubric §7, Microservices Readiness]`). **Synchronously**, the Notification
service needs the set of active attendee user ids; it depends on the
[`IAttendeeQueryService`](#iattendeequeryservice) interface, implemented in-process by
[`AttendeeQueryService`](#attendeequeryservice) (`AttendeeQueryService.cs:11`). Once Identity runs as
its own process, the composition root swaps in [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter)
(`AttendeeQueryServiceGrpcAdapter.cs:14`), which implements the *same* C# interface on top of a
generated gRPC client, while [`AttendeesGrpcService`](#attendeesgrpcservice) (`AttendeesGrpcService.cs:19`)
serves the other end by delegating to the in-process implementation. The consumer code never changes;
only the registration does (ADR-007, ADR-008).

**Asynchronously**, the User-to-Speaker link is kept consistent by events, not by a cross-database
foreign key. When a user registers, [`AuthenticationService`](#authenticationservice) publishes
[`UserRegistered`](#userregistered) (`UserRegistered.cs:23`, a
[`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent)) after the commit; Conference
subscribes and runs the speaker email-match auto-link (BR-207). Conference then publishes
[`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) /
[`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) back, which
[`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler) (`SpeakerLinkedToUserHandler.cs:20`) and
[`SpeakerUnlinkedFromUserHandler`](#speakerunlinkedfromuserhandler) consume to set or clear
`User.LinkedSpeakerId`, so the `speaker_id` claim appears on the *next* token refresh (eventual
consistency, BR-209). These handlers are idempotent (they skip if the link already matches,
`SpeakerLinkedToUserHandler.cs:43`) and swallow non-cancellation exceptions, because re-delivery over
the broker is expected. This event-carried link is what lets the bidirectional User-to-Speaker
relationship survive the service split (ADR-006 / ADR-008).

## The UI edge

The Blazor surface is registered as an [`IdentityUIModule`](#identityuimodule) (`IdentityUIModule.cs:13`)
descriptor that contributes two navigation items: "My Profile" for everyone and "Users" for Organizers
(`IdentityUIModule.cs:15-19`), their routes coming from the [`IdentityRoutePaths`](#identityroutepaths)
constants (`/profile`, `/users`). The [`Profile`](#profile) page (`Profile.razor.cs:15`) lets an
authenticated user change their password, manage their avatar (with a client-side size guard mirroring
the server's 2 MB BR-116a limit, `Profile.razor.cs:25`), and delete their account, all through the
[`IUserUIService`](#iuseruiservice) abstraction implemented by [`UserService`](#userservice)
(`UserService.cs:14`), an `AuthenticatedServiceBase` subclass that attaches the bearer token and calls
the REST `users` endpoint. [`UserList`](#userlist) is the Organizer-only paged user-management grid. The
whole UI targets WCAG 2.1 AA, and the login, register, and profile flows are covered by axe-core E2E
scans in the deploy-gating suite (`[Rubric §21, Accessibility]`).

## End-to-end: one registration

To see the chapter cooperate, follow a new attendee signing up. [`AuthController`](#authcontroller)
receives the `register` POST, captures the client IP for BR-213 rate limiting, and calls the shared
`RegisterAsync` on [`AuthenticationService`](#authenticationservice). The base engine validates the
request, confirms the email is not already taken (query-filter-bypassed so an erased address stays
reserved), calls `User.Create(...)` with the `Attendee` role, hashes the password, adds the aggregate,
and commits. Only *after* the commit, when the EF identity id exists, does `OnUserRegisteredAsync`
publish [`UserRegistered`](#userregistered) through the outbox (ADR-003); the first token returned does
not yet carry `speaker_id`. Asynchronously, Conference matches the email to a speaker and publishes
`SpeakerLinkedToUser`; [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler) sets
`User.LinkedSpeakerId`, and the attendee's *next* refresh carries the `speaker_id` claim. No password
left the domain in plaintext, no cross-database foreign key was written, no event was hand-dispatched,
and the same code path behaves identically whether Identity runs in a monolith or as its own service,
which is exactly the property the framework groups (G01 through G14) exist to provide. For the *why*
behind each choice, ADR-003 (outbox), ADR-004 (JWKS), ADR-005 (soft-delete vs erasure),
ADR-006/007/008 (database-per-service, gRPC, service topology), ADR-027/028 (culture/theme), and
ADR-045 (avatars) are the primary references; the business rules are catalogued in
`MMCA.ADC/specifications.md` and the privacy promises in `MMCA.ADC/PRIVACY.md`.

### AssemblyReference, ClassReference
> MMCA.ADC.Identity.{Application,API} · `MMCA.ADC.Identity.{Application,API}` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:5` · Level 0 · class (static) + class

- **What it is**: the assembly-marker pair, duplicated once per Identity layer. `AssemblyReference` is a static class exposing the layer's `Assembly` and `AssemblyName`; `ClassReference` is an empty non-static class used purely as a generic type argument that anchors Scrutor assembly scanning to *this* assembly. Neither carries behavior. This unit covers the **Application** and **API** layers' pair (the Domain and Infrastructure copies are byte-identical and are documented with their own layers):

| Type | File:Line | Notes |
|------|-----------|-------|
| `AssemblyReference` (Application) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/AssemblyReference.cs:5` | static class; `Assembly` + `AssemblyName` fields |
| `ClassReference` (Application) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/AssemblyReference.cs:11` | the `T` in `ScanModuleApplicationServices<ClassReference>()` |
| `AssemblyReference` (API) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:5` | identical shape |
| `ClassReference` (API) | `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/AssemblyReference.cs:11` | empty marker class |

- **Depends on**: `System.Reflection` only (BCL). No first-party types.
- **Concept introduced, the assembly-marker pair.** First taught in [G14](group-14-module-system-composition.md) for the framework's own layers; the idea is the same here. A static `AssemblyReference` gives reflection-driven code (Scrutor scanning, EF configuration discovery, test helpers) a stable, refactor-safe handle on the assembly without a magic string, and an empty `ClassReference` gives generic APIs like `ScanModuleApplicationServices<ClassReference>()` a *type* whose `.Assembly` resolves to the right layer. `[Rubric §15, Best Practices & Code Quality]` (assesses idiomatic, low-ceremony conventions): the pair removes brittle `Assembly.Load("MMCA.ADC.Identity.Application")` string lookups.
- **Walkthrough**: in each file `Assembly` is a `static readonly` field set once at type-init (`:7`); `AssemblyName` reads `Assembly.GetName().Name ?? string.Empty` (`:8`), null-coalescing because `AssemblyName.Name` is technically nullable. `ClassReference` is `public class ClassReference { }` (`:11`), no members.
- **Why it's built this way**: the pair is duplicated in each layer rather than shared, because each must resolve to *its own* assembly; a single shared type would always resolve to whichever assembly declared it, defeating the purpose.
- **Where it's used**: `ClassReference` (Application) is the type argument to `ScanModuleApplicationServices<ClassReference>()` inside the Application-layer [`DependencyInjection`](#dependencyinjection-identityapplication) (`DependencyInjection.cs:38`). `AssemblyReference` fields feed `ModuleLoader` discovery and EF configuration scanning.
- **Caveats / not-in-source**: an earlier edition described these markers as feeding "MediatR handler discovery"; that is **stale**. This codebase uses **Scrutor** convention scanning, not MediatR, there is no MediatR reference anywhere in the Identity projects.

---

### ChangePreferencesRequest
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesRequest.cs:10` · Level 0 · record (sealed)

- **What it is**: the request payload that updates the current user's stored UI preferences, their preferred culture and theme. It is the inbound DTO for the write side of per-user culture/theme preferences (ADR-027 / ADR-028).
- **Depends on**: nothing first-party (two `string?` parameters). No BCL beyond `record`.
- **Concept introduced, the partial-update DTO (null means "leave unchanged").** `[Rubric §27, Internationalization]` (assesses whether locale is a first-class, persisted user choice rather than a one-shot request setting) and `[Rubric §9, API & Contract Design]` (assesses clear, unambiguous payload semantics). The record is `(string? Culture, string? Theme)` (`:10`), and a **`null` field deliberately leaves that preference unchanged** (doc comment `:3-9`). That is what lets the two independent UI affordances, the app-bar culture switcher (which sends only `Culture`) and the theme toggle (which sends only `Theme`), each persist their own field through the same command without clobbering the other. The `Theme` half is also the `[Rubric §20, Design System & Theming]` story (a persisted light/dark choice).
- **Walkthrough**: two positional parameters on a single line (`:10`), both nullable, no body. Validation does not live here; the allow-list and light/dark checks run downstream in the domain (see [`ChangePreferencesHandler`](#changepreferenceshandler) and `User.UpdatePreferences`).
- **Why it's built this way**: a flat nullable-field record gives partial-update semantics for free without a separate PATCH document or per-field "was it set" flags; the two switchers stay independent because an omitted field arrives as `null` and the handler coalesces it back to the stored value.
- **Where it's used**: carried as the `Request` member of [`ChangePreferencesCommand`](#changepreferencescommand); bound from the profile page / app-bar switcher request body in `UsersController`.

---

### ExportUserDataQuery
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:10` · Level 0 · record (sealed)

- **What it is**: the Identity **query** record that drives a data-subject export (GDPR Art. 20 / CCPA portability): the account owner, or an Organizer, requesting a portable copy of one user's personal data.
- **Depends on**: `UserIdentifierType` (the solution-wide `= int` alias, see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); otherwise dependency-free.
- **Concept introduced, the query DTO carries its own authorization context.** `[Rubric §6, CQRS & Event-Driven]` (assesses a clean read/write split where queries are side-effect-free request objects) and `[Rubric §11, Security]` (assesses correct authZ placement): rather than reaching for an ambient `ICurrentUserService`/`HttpContextAccessor` inside the handler, the query carries `CurrentUserId` and `CurrentUserRole` **as parameters** (`:12-13`), so the controller extracts the caller's claims and passes them explicitly. The handler's check (owner *or* Organizer) is therefore a pure function of the record, `[Rubric §14, Testability]`: a unit test sets three values, no mocking of ambient state. The trade-off is a slightly more verbose call site in the controller.
- **Walkthrough**: three positional parameters (`:10-13`), `UserId`, `CurrentUserId`, `CurrentUserRole`; the ownership/role rule lives in [`ExportUserDataHandler`](#exportuserdatahandler). The doc comment (`:3-9`) ties it to `PRIVACY.md §7`.
- **Why it's built this way**: embedding the auth context eliminates hidden coupling to request-scoped services and keeps the slice self-contained (command/query + handler colocated under `UseCases/{Operation}/`, the vertical-slice convention from [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Where it's used**: dispatched by `UsersController` through the query side of the [CQRS pipeline](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the result maps to [`UserDataExportDTO`](#userdataexportdto), returned as a downloadable attachment.

---

### IdentityErrorResources
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Resources` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` · Level 0 · class (sealed)

- **What it is**: an empty "resource anchor" type for the Identity module's localized error messages. It carries no members; its only job is to be a `typeof(...)` handle that the localization layer uses to find the co-located `.resx` files (ADR-027).
- **Depends on**: nothing first-party. At runtime its `.resx` siblings are loaded through `System.Resources` / `IStringLocalizerFactory` (BCL/ASP.NET Core).
- **Concept introduced, edge error-message localization keyed by error `Code`.** `[Rubric §27, Internationalization]` (assesses whether user-facing strings, including error text, are translated rather than English-only). ADR-027 localizes failures **at the API edge**: a domain [`Error`](group-01-result-error-handling.md#error)'s `Code` (for example `"User.Email.Empty"`) is the resource key, and the shared [`IErrorLocalizer`](group-12-api-hosting-mapping.md#ierrorlocalizer) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/IErrorLocalizer.cs:9`) looks that key up across every registered resource source before the error is written to the ProblemDetails response. Each module contributes its own translations *additively* by registering its anchor type, so the Identity module's English/Spanish error strings live in `IdentityErrorResources.resx` / `IdentityErrorResources.es.resx` (both confirmed present alongside the anchor) rather than in one central framework file.
- **Walkthrough**: the class body is empty (`:11-13`); all behavior is in the doc comment (`:3-10`) and the sibling `.resx` files. The comment records two design points worth knowing: (1) keys are the domain error `Code`, and (2) **runtime-variable messages** (those that interpolate a user-supplied value) are deliberately omitted from the `.resx`, so they degrade gracefully to their English message with the value intact rather than showing a broken or value-less translation.
- **Why it's built this way**: `AddErrorResources<TResource>()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:103`) builds an `IStringLocalizer` from `typeof(TResource)` and registers it as an `ErrorResourceSource`; the localizer then enumerates all such sources. An empty marker type is therefore exactly enough, the convention "`.resx` named after the type, sitting next to it" is what binds strings to the anchor, so the class needs no fields.
- **Where it's used**: registered at startup via `services.AddErrorResources<IdentityErrorResources>()` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:180`), which adds it to the set of sources the edge `IErrorLocalizer` consults.

---

### DependencyInjection (Identity.API)
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/DependencyInjection.cs:15` · Level 2 · class (static)

- **What it is**: the top-level composition root for the Identity module: a single `AddIdentityModule(...)` extension method that fans out to the Application, Infrastructure, and API layer registrations, plus `AddModuleIdentityAPI()`, which declares the module's role-to-permission grants.
- **Depends on**: `Microsoft.Extensions.DependencyInjection.IServiceCollection`; [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings) (Level 1); the Application-layer `AddModuleIdentityApplication` ([`DependencyInjection (Identity.Application)`](#dependencyinjection-identityapplication)) and the Infrastructure-layer `AddModuleIdentityInfrastructure` (sibling group file); the [`AddPermissions`](group-08-auth.md#authorizationextensions) helper plus [`IdentityPermissions`](#identitypermissions) and [`RoleNames`](group-08-auth.md#rolenames) for the permission grants.
- **Concept introduced, the layered DI fan-out via `extension(IServiceCollection)`.** `[Rubric §3, Clean Architecture]` (assesses dependencies pointing inward and a single composition seam per module): the API layer is the only place that knows about *all* of the module's layers, so it owns the aggregate `AddIdentityModule`. It uses the C# 14 `extension(IServiceCollection services)` block (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) to hang the method directly onto `IServiceCollection`. `[Rubric §16, Maintainability]`: the three-call body (`AddModuleIdentityApplication` → `AddModuleIdentityInfrastructure` → `AddModuleIdentityAPI`, `:26-28`) mirrors the per-module layering so the registration order matches the dependency order.
- **Walkthrough**
  - `AddIdentityModule(ApplicationSettings)` (`:24-31`), calls the three layer registrations in inward-to-outward order, threading `applicationSettings` into the Application call, then `return services` for chaining.
  - `AddModuleIdentityAPI()` (`:39-48`) calls [`AddPermissions`](group-08-auth.md#authorizationextensions) and declares the role-to-permission grants that back the module's `[HasPermission(...)]`-gated endpoints: `permissions.Grant(RoleNames.Organizer, [.. IdentityPermissions.All])` (`:43`) and `permissions.Grant(RoleNames.Admin, [.. IdentityPermissions.All])` (`:44`), so both Organizer and Admin receive every [`IdentityPermissions`](#identitypermissions) capability. Identity's REST controllers are still discovered by ASP.NET Core's controller convention, so nothing else is registered imperatively.
- **Why it's built this way**: a single `AddIdentityModule` entry point is what [`IdentityModule.Register`](#identitymodule) calls, keeping the module's wiring in one discoverable place; declaring the role-to-permission grants inside `AddModuleIdentityAPI` keeps the capability model (which roles hold which permissions) co-located with the module that owns those endpoints, rather than in a central authorization file the module would have to reach into.
- **Where it's used**: invoked by [`IdentityModule.Register`](#identitymodule) (`IdentityModule.cs:24`) during topological module registration by the `ModuleLoader`.

---

### IdentityModule
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModule.cs:13` · Level 3 · class (sealed)

- **What it is**: the Identity module's entry point: the concrete [`IModule`](group-14-module-system-composition.md#imodule) the `ModuleLoader` discovers and registers. Identity is a **leaf** in the dependency graph, it declares no module dependencies.
- **Depends on**: [`IModule`](group-14-module-system-composition.md#imodule) (Level 2 contract); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); the module's own [`AddIdentityModule`](#dependencyinjection-identityapi); [`IAttendeeQueryService`](#iattendeequeryservice) and its disabled stub [`DisabledAttendeeQueryService`](#disabledattendeequeryservice); `Microsoft.Extensions.{Configuration,DependencyInjection}` (BCL/extensions).
- **Concept introduced, the `IModule` contract and disabled-module stubs.** `[Rubric §7, Microservices Readiness]` (assesses whether modules are independently composable and can run alone). The module system is taught fully in [G14](group-14-module-system-composition.md#imodule); here is its concrete Identity realization. Three members matter:
  - `Name => "Identity"` (`:16`), the topological-sort key and the value the `ModuleLoader` logs.
  - `Register(...)` (`:23-24`), delegates straight to `services.AddIdentityModule(applicationSettings)`; the module exposes nothing else, so registration is one line.
  - `RegisterDisabledStubs(...)` (`:19-20`), when Identity is *disabled* in a given host, this registers `DisabledAttendeeQueryService` as a singleton so any consumer (notably Notification, which needs the attendee-id list) still resolves [`IAttendeeQueryService`](#iattendeequeryservice) and degrades gracefully instead of failing DI validation.
- **Walkthrough**: the class is tiny and declarative: no `Dependencies`/`RequiresDependencies` overrides are present, so it inherits the interface defaults (a leaf with no prerequisites). `Register` and `RegisterDisabledStubs` are both expression-bodied. There is **no `SeedAsync` here**, seeding is a separate [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) implementation ([`IdentityModuleSeeder`](#identitymoduleseeder), below), keeping module *wiring* distinct from module *data*.
- **Why it's built this way**: the `IModule` seam is what makes each module extractable into its own service host without a rewrite (ADRs 007/008): in the extracted **Identity.Service** only this module is enabled, while every *other* service registers Identity's `DisabledAttendeeQueryService` stub and reaches the real implementation over gRPC. The transport choice lives at the edge; application code only ever sees the interface.
- **Where it's used**: discovered by reflection and registered in Kahn-topological order by the `ModuleLoader`; `Register` runs at startup, `RegisterDisabledStubs` runs in hosts where `Modules:Identity:Enabled` is false.

---

### ChangePreferencesCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:12` · Level 7 · record (sealed)

- **What it is**: the command that persists one user's culture/theme preferences, the write side of ADR-027 / ADR-028. It pairs the target `UserId` with the (partial) [`ChangePreferencesRequest`](#changepreferencesrequest) and opts into cache invalidation so a preference change refreshes any cached read of that user.
- **Depends on**: [`ChangePreferencesRequest`](#changepreferencesrequest); `UserIdentifierType` (the `= int` alias); [`User`](#user) (only for `typeof(User).FullName` in the cache prefix); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (`MMCA.Common.Application`).
- **Concept introduced, the cache-invalidating command.** `[Rubric §6, CQRS & Event-Driven]` (assesses commands as explicit, named intentions, separate from reads) and `[Rubric §27, Internationalization]` (the persisted-preference write that makes the chosen culture stick across sessions). The record `(UserIdentifierType UserId, ChangePreferencesRequest Request)` implements `ICacheInvalidating` (`:12`) and exposes `CachePrefix => $"{typeof(User).FullName}:"` (`:15`). The [caching command decorator](group-05-cqrs-pipeline.md#icacheinvalidating) reads that prefix and, **after the handler succeeds**, evicts every cache entry under it, so a stale cached `User` cannot survive a preference change. Deriving the prefix from `typeof(User).FullName` keeps it in lockstep with whatever key the user cache uses, with no hand-copied magic string.
- **Walkthrough**: a two-parameter positional record with one computed property. `UserId` (`:12`) is set by the controller from the authenticated principal (never from the request body, a caller can only change their own preferences); `Request` (`:12`) is the partial DTO; `CachePrefix` (`:15`) is the `ICacheInvalidating` member.
- **Why it's built this way**: separating "who" (`UserId`, from the JWT) from "what" ([`ChangePreferencesRequest`](#changepreferencesrequest), from the body) prevents a request from targeting another user, and implementing `ICacheInvalidating` rather than calling the cache by hand keeps the eviction a cross-cutting decorator concern (ADR-014) rather than handler boilerplate.
- **Where it's used**: handled by [`ChangePreferencesHandler`](#changepreferenceshandler); dispatched by `UsersController` from the profile page and the app-bar culture/theme switchers.

---

### ChangePreferencesHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:13` · Level 8 · class (sealed, partial)

- **What it is**: the command handler that loads the target [`User`](#user), applies a **partial** preference update (each omitted field falls back to the stored value), saves, and logs, the write counterpart to the read-only export/list handlers.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7); [`User`](#user) + its `UpdatePreferences` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` (the `[LoggerMessage]` source generator).
- **Concept introduced, the null-coalescing partial update + source-generated logging.** `[Rubric §6, CQRS]` (a command handler mutates and saves) and `[Rubric §27, Internationalization]` (persisting the locale choice). The merge happens at `:27-29`: `user.UpdatePreferences(command.Request.Culture ?? user.PreferredCulture, command.Request.Theme ?? user.PreferredTheme)`, so a request that carries only `Culture` re-supplies the *current* `PreferredTheme` and vice versa, which is exactly why a one-field switcher does not wipe the other preference. Validation is the domain's job, not the handler's: `User.UpdatePreferences` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:271`) `Result.Combine`s `UserInvariants.EnsurePreferredCultureIsValid` and `UserInvariants.EnsurePreferredThemeIsValid` (`User.cs:273-275`) against the supported-culture allow-list and the light/dark values before assigning the fields (`User.cs:281-282`), and the handler simply returns that `Result`. `[Rubric §13, Observability & Operability]`: the success log uses the `[LoggerMessage]` source generator (`:39-40`), which is why the class is declared `partial`.
- **Walkthrough** (ctor `:13-15`, body `:18-37`)
  1. **Fetch** (`:22-23`), `unitOfWork.GetRepository<User, UserIdentifierType>()` then `GetByIdAsync(command.UserId, ...)`.
  2. **Not-found guard** (`:24-25`), a `null` user returns `Result.Failure(Error.NotFound...)` tagged with source/target via the fluent `WithSource`/`WithTarget` builders.
  3. **Apply** (`:27-29`), `UpdatePreferences(...)` with the null-coalesced values; it returns a `Result` carrying any validation failure.
  4. **Persist + log** (`:30-34`), only on `result.IsSuccess` does it `await unitOfWork.SaveChangesAsync(...)` and emit `LogPreferencesChanged(logger, command.UserId)`.
  5. **Return** (`:36`), propagates the domain `result` (success or the validation failure) unchanged.
- **Why it's built this way**: keeping validation inside `User.UpdatePreferences` (not the handler) means the invariant travels with the aggregate and is reusable; guarding `SaveChangesAsync`/the log behind `IsSuccess` means a rejected culture/theme is a clean `Result.Failure` (mapped to 400 at the edge) with no write and no misleading "changed" log line.
- **Where it's used**: resolved by Scrutor convention scanning (one `ICommandHandler` per command) and invoked by `UsersController`; wrapped by the [command decorator pipeline](group-05-cqrs-pipeline.md#icacheinvalidating), whose caching decorator performs the prefix eviction declared on [`ChangePreferencesCommand`](#changepreferencescommand).
- **Caveats / not-in-source**: `UpdatePreferences` (`User.cs:271-284`) validates, sets the two fields, and returns `Result.Success()` but does **not** raise a domain event, so a preference change persists the row yet publishes nothing to the outbox. The `PreferredCulture`/`PreferredTheme` columns this handler writes were introduced by the `AddUserPreferences` EF migration (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260627221640_AddUserPreferences.cs`); whether any given database has that migration applied is an operational fact not visible in this `.cs` source. `[Rubric §27]`

---

### ExportUserDataHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:26` · Level 8 · class (sealed, partial)

- **What it is**: the query handler that fulfils a data-subject export (PRIVACY.md §7). It authorizes the caller, loads the single [`User`](#user) aggregate, projects its Identity-owned personal data into a [`UserDataExportDTO`](#userdataexportdto) (**deliberately omitting** credentials, password hash/salt, refresh token, external-provider key), then aggregates two cross-service sections, Engagement and Notifications, **best-effort each**.
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7); [`User`](#user) + [`UserRole`](#userrole) (Domain); [`UserDataExportDTO`](#userdataexportdto); the cross-service ports [`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) and [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); `Microsoft.Extensions.Logging` (the `[LoggerMessage]` source generator, which is why the class is `partial`).
- **Concept introduced, the read handler as authorization + projection + best-effort cross-service aggregation, never mutation.** `[Rubric §6, CQRS]`: a query handler reads and shapes; it must not call `SaveChanges` (the comment at `:47` makes the rule explicit). `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy/Data Governance]` (assesses lawful, minimized, and *complete* handling of a data-subject request): the handler is the single enforcement point for *who* may export and *what* is exported, and it now gathers the subject's personal data across every service that holds it. `[Rubric §29, Resilience & Business Continuity]`: each cross-service section is fetched inside its own `try`/`catch` so one peer outage degrades that section (`Available = false`) instead of failing the whole export, the same deliberate best-effort pattern as the live-channel publish path.
- **Walkthrough** (handler signature/ctor `:26-31`, body `:33-87`)
  1. **Authorization** (`:38-45`), if `query.CurrentUserId != query.UserId` **and** `!UserRole.IsOrganizer(query.CurrentUserRole)`, return `Error.Forbidden(...)` with code `"User.ExportForbidden"`. The role test goes through [`UserRole.IsOrganizer`](#userrole) (`UserRole.cs:76`), a `static bool` that does a case-insensitive `string.Equals` against the `Organizer` role name, so a lower/upper-case JWT claim still matches. The comment (`:37`) notes this is the *same* owner-or-organizer rule as account deletion ([`DeleteUserHandler`](#deleteuserhandler)).
  2. **Fetch** (`:48-54`), `unitOfWork.GetRepository<User, UserIdentifierType>()` then `GetByIdAsync`; a `null` user yields `Error.NotFound` tagged with source/target via the fluent `WithSource`/`WithTarget` builders.
  3. **Cross-service sections** (`:58-59`), `GetEngagementSectionAsync` and `GetNotificationSectionAsync` are awaited before projection. Each helper (`:89-122` / `:124-154`) calls its port ([`IUserEngagementExportService`](group-22-engagement-module.md#iuserengagementexportservice) / [`IUserNotificationExportService`](group-10-notifications.md#iusernotificationexportservice)), maps the returned rows into the section DTO with `Available = true`, and on any exception that is **not** `OperationCanceledException` (`:115` / `:147`) logs a warning and returns a section with `Available = false`. Cancellation is deliberately *not* swallowed, so a caller-abort still propagates.
  4. **Projection** (`:61-84`), hand-maps the aggregate to `UserDataExportDTO`: identity fields, `Email.Value` (unwrapping the value object), role, external-login flags, `LinkedSpeakerId`, the seven device-fingerprint fields, `CreatedOn`/`LastModifiedOn`, plus the two aggregated `Engagement`/`Notifications` sections. This is the manual-mapping convention of ADR-001, no AutoMapper.
  5. **Success** (`:86`), wraps the DTO in `Result.Success`.
- **Why it's built this way**: projecting an explicit allow-list (rather than serializing the whole entity) is privacy-by-design, a future field added to `User` is *not* exported until a developer consciously adds it here, and secrets can never leak through the export path. Fetching each remote section best-effort keeps a data-subject's export available even when one downstream service is down: a partial, honestly-flagged export beats a hard failure that leaves the subject with nothing. Returning `Result<T>` keeps the forbidden/not-found paths exception-free, mapping cleanly to 403/404 at the API boundary (see [`Error`](group-01-result-error-handling.md#error)).
- **Where it's used**: dispatched by `UsersController` through the [query pipeline](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); the resulting DTO is returned as a downloadable attachment.
- **Caveats / not-in-source**: the `Available = false` degrade path fires only after the standard Polly resilience pipeline has already exhausted its retries on the gRPC client; that pipeline is configured at the transport edge, not visible in this handler. The earlier edition's note that cross-module data is "not aggregated here (RemediationBacklog #30)" is now **stale**: the Engagement and Notification sections are aggregated, and the `UserDataExportDTO` doc comment (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportDTO.cs:14`) records the residual as closed.

---

### IdentityModuleSeeder
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:12` · Level 9 · class (sealed)

- **What it is**: the Identity module's startup data seeder: a thin [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) that resolves dependencies from the host `IServiceProvider` and delegates the actual inserts (default Organizer + Attendee accounts) to the Infrastructure-level [`IdentityModuleDbSeeder`](#identitymoduledbseeder).
- **Depends on**: [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) (Level 0 contract); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7); [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) (Level 0); [`IdentityModuleDbSeeder`](#identitymoduledbseeder) (Infrastructure); `Microsoft.Extensions.DependencyInjection`.
- **Concept introduced, the thin seeder bridge.** `[Rubric §8, Data Architecture]` (deterministic startup state) and `[Rubric §3, Clean Architecture]` (the API layer orchestrates, Infrastructure persists). The `IModuleSeeder` contract has two members, `string ModuleName` and `Task SeedAsync(IServiceProvider, CancellationToken)`. This top-level seeder is a *bridge*: it resolves `IUnitOfWork` and `IPasswordHasher` from the provider (so missing dependencies fail loudly at startup, not at compile time) and hands them to the Infrastructure `*DbSeeder` that owns the EF/SQL insert logic. That keeps the API assembly free of persistence detail and lets the DB seeder be unit-tested in isolation.
- **Walkthrough** (`:12-25`), `ModuleName => "Identity"` (`:15`) is returned to the `ModuleLoader` for logging/ordering. `SeedAsync` (`:18-24`) resolves `IUnitOfWork` (`:20`) and `IPasswordHasher` (`:21`) via `GetRequiredService`, constructs `new IdentityModuleDbSeeder(unitOfWork, passwordHasher)` (`:22`), and awaits `seeder.SeedAsync(ct)` (`:23`). `IPasswordHasher` is required because the seed accounts ship as plaintext passwords that must be hashed before persistence (doc comment `:8-11`).
- **Why it's built this way**: resolving from `IServiceProvider` rather than constructor injection is deliberate: `IModuleSeeder.SeedAsync` runs inside a scope the `ModuleLoader` creates *after* the host is fully built. Constructor-injecting scoped services would couple the seeder's own lifetime to a request scope; the service-locator-at-the-boundary keeps it a simple, scope-agnostic object. (Compare `ConferenceModuleSeeder`, which additionally resolves `IConfiguration` to gate sample data.)
- **Where it's used**: discovered by the `ModuleLoader` via the `IModuleSeeder` interface and invoked at host startup after the `DatabaseInitStrategy` runs the schema initialization.

---

### DependencyInjection (Identity.Application)
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:17` · Level 10 · class (static)

- **What it is**: the Application-layer registration for Identity: it explicitly binds three cross-cutting services, then runs Scrutor convention scanning to auto-register every handler, mapper, validator, and domain-event handler in the assembly.
- **Depends on**: `IServiceCollection` + `TryAddScoped`; [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings); the Identity auth/cross-module services `IAuthenticationService`/`AuthenticationService`, the [`AuthenticationValidators`](#authenticationvalidators) parameter object, `ISoftDeletedUserValidator`/[`SoftDeletedUserValidator`](#softdeleteduservalidator), [`IAttendeeQueryService`](#iattendeequeryservice)/[`AttendeeQueryService`](#attendeequeryservice); the `ScanModuleApplicationServices<T>` helper from `MMCA.Common.Application`; [`ClassReference`](#assemblyreference-classreference) (this assembly's marker).
- **Concept introduced, explicit registration for ambiguous services, convention scanning for the rest.** `[Rubric §2, Design Patterns]` and `[Rubric §16, Maintainability]`: handlers/mappers/validators follow a one-interface-one-implementation convention, so Scrutor scans for them (`ScanModuleApplicationServices<ClassReference>()`, `:38`) and adding a new use case needs **no DI edit**. Services that *aren't* convention-discoverable, an auth service, the auth-validator bundle, a soft-deleted-user validator, the cross-module attendee query, are registered explicitly with `TryAddScoped` (`:31-34`). `TryAdd*` (rather than `Add*`) means a host can pre-register an override (e.g. a gRPC-backed `IAttendeeQueryService` in an extracted service) and the module won't clobber it.
- **Walkthrough**: `AddModuleIdentityApplication(ApplicationSettings)` (`:27-41`) inside an `extension(IServiceCollection services)` block: `_ = applicationSettings;` (`:29`) discards the parameter with a comment that it is reserved for future decorator configuration (it is taken to keep the signature uniform with other modules); four `TryAddScoped` registrations (`:31-34`); then the Scrutor scan (`:38`); `return services` (`:40`).
- **Why it's built this way**: mixing explicit + convention registration keeps the common case (use-case slices) zero-ceremony while still giving precise control over the handful of services that need a specific lifetime or an override seam. The reserved-but-unused `applicationSettings` parameter trades a tiny analyzer-silencing discard for signature symmetry across modules.
- **Where it's used**: called by the API-layer [`AddIdentityModule`](#dependencyinjection-identityapi) (`:26`), which is in turn called by [`IdentityModule.Register`](#identitymodule).
- **Caveats / not-in-source**: whether `applicationSettings` will ever be consumed is `Not determinable from source`; today it is only discarded.

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

### IAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8` · Level 0 · interface

- **What it is**: A cross-module service contract that lets another module (the Notification service) obtain the identifiers of all active attendee users without referencing Identity's domain or infrastructure.
- **Depends on**: `UserIdentifierType` (the module's `int` identifier alias, see [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)); BCL `Task<IReadOnlyList<T>>` and `CancellationToken`.
- **Concept introduced**: **Cross-module service contract in the provider's Shared layer.** This is the same boundary pattern as [IBookmarkCountService](group-22-engagement-module.md#ibookmarkcountservice): the contract lives in `Identity.Shared` (the provider), so a consumer references only that thin project and injects the interface. `[Rubric §1, SOLID]` assesses adherence to the Dependency Inversion Principle: the consumer depends on this abstraction, never on Identity's implementation. `[Rubric §7, Microservices Readiness]` assesses whether module boundaries survive extraction: in-process the concrete `AttendeeQueryService` implements it, and once Identity is a separate service the same interface is satisfied by a gRPC typed client, so no consumer code changes (ADR-007).
- **Walkthrough**: One member, `GetAttendeeUserIdsAsync(CancellationToken = default)` (`IAttendeeQueryService.cs:15`), returning the ids of all non-deleted users in the Attendee role.
- **Why it's built this way**: Declaring the contract in Shared (not Application) keeps the data-access strategy replaceable and the boundary one-directional: Notification never learns how attendee ids are stored.
- **Where it's used**: Implemented by [AttendeeQueryService](#attendeequeryservice) in the Identity module and, when Identity is disabled in a host, by [DisabledAttendeeQueryService](#disabledattendeequeryservice).

---

### IdentityPermissions
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Authorization` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:8` · Level 0 · class (static)

- **What it is**: The capability-permission catalog for the Identity module: string constants that endpoints require (via `[HasPermission(...)]`) instead of hard-coding role names.
- **Depends on**: No first-party types; BCL `IReadOnlyList<string>` and a collection expression.
- **Concept introduced**: **Permission-based authorization over role-based.** Endpoints demand a *capability* (`identity:users:read`), and the role-to-permission grants are declared once at module registration; adding a role or re-mapping a capability never touches endpoint attributes. `[Rubric §11, Security]` assesses authorization design and least privilege: naming the capability at the endpoint and centralizing grants makes the authorization surface auditable rather than scattered across `[Authorize(Roles=...)]` attributes.
- **Walkthrough**: `const string UsersRead = "identity:users:read"` (`IdentityPermissions.cs:11`) is the single capability today; `static IReadOnlyList<string> All` (`IdentityPermissions.cs:14`) exposes the full set as a collection expression so a role can be granted the whole capability set at once.
- **Why it's built this way**: A `namespace:resource:action` string convention keeps permissions self-describing and greppable, and the `All` accessor keeps the role-grant registration from drifting out of sync when a permission is added.
- **Where it's used**: Referenced by the Identity API controllers' `[HasPermission(...)]` attributes and by the module's role-grant registration.

---

### IdentityRoutePaths
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: Route-path constants for the two Identity UI pages reached by authenticated users: the organizer user list and the personal profile page.
- **Depends on**: No first-party types.
- **Concept introduced**: **Centralized route constants.** `[Rubric §25, Navigation & IA]` assesses whether navigation targets are coherent and maintainable: keeping even trivial routes in one place stops the same string being re-typed at every `NavigateTo` call site and every `@page` directive.
- **Walkthrough**: `static readonly string Users = "/users"` (`IdentityRoutePaths.cs:8`, organizer-only) and `static readonly string Profile = "/profile"` (`IdentityRoutePaths.cs:9`, self-service).
- **Why it's built this way**: One authoritative spelling for each route removes the class of bug where a page and its nav link disagree.
- **Where it's used**: Consumed by [IdentityUIModule](#identityuimodule)'s `NavItem` entries and by the `@page` directives / `NavigationManager` calls in the Identity UI pages.

---

### IdentitySettings
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/IdentitySettings.cs:7` · Level 0 · class (sealed)

- **What it is**: The module-level options object for Identity, bound from the `"Identity"` configuration section (typically `modules.identity.json` / its `Development` overlay).
- **Depends on**: No first-party types; consumed through `IOptions<IdentitySettings>`.
- **Concept introduced**: **Module-scoped options with an in-code default.** `[Rubric §10, Cross-Cutting Concerns]` assesses how configuration is surfaced and layered: this class turns a business rule (BR-213) into an environment-overridable knob while still enforcing a sane value when the config file omits the section.
- **Walkthrough**: `const string SectionName = "Identity"` (`IdentitySettings.cs:9`) drives `Configure<IdentitySettings>(GetSection(SectionName))`; the single property `int MaxRegistrationsPerIpPerHour { get; init; } = 10` (`IdentitySettings.cs:15`) caps registrations per IP per hour and is deliberately raised in dev/test to keep E2E runs from tripping the limiter.
- **Why it's built this way**: Keeping the `= 10` default in code (not only in JSON) means the rate limit is enforced even if the config section is missing; `init`-only keeps the bound options immutable after startup.
- **Where it's used**: Bound in the Identity module registration; read by the registration use case, whose per-IP tracking is implemented by `LoginProtectionSettings` in `MMCA.Common.Infrastructure`.

---

### UserAvatarDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: The response contract returned after an avatar mutation (BR-116a): the current avatar URL, or `null` when none is set.
- **Depends on**: No first-party types.
- **Concept introduced**: Cross-reference the manual-DTO convention (ADR-001; the base DTO contract is introduced in [group-12](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)). `[Rubric §9, API & Contract Design]` assesses stable, intention-revealing wire shapes: a dedicated one-field record makes the avatar-change response self-documenting instead of overloading the full user DTO.
- **Walkthrough**: Positional record `UserAvatarDTO(string? AvatarUrl)` (`UserAvatarDTO.cs:7`). Two `SuppressMessage` attributes (`UserAvatarDTO.cs:5-6`) keep the URL a `string` on the wire rather than a `Uri`, since it is a serialized DTO field.
- **Why it's built this way**: Returning just the resulting URL keeps the avatar endpoints minimal and avoids re-serializing the whole account after an image change.
- **Where it's used**: Returned by the Identity API's avatar set/clear endpoints; consumed by the profile UI.

---

### UserDataExportBookmarkDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: One session-bookmark row inside the Engagement section of a data-subject export (PRIVACY.md §7): the bookmarked session and when the bookmark was created.
- **Depends on**: `SessionIdentifierType` (Conference's `Guid` alias); BCL `DateTime`.
- **Concept introduced**: **Data-minimized export row.** `[Rubric §30, Compliance/Privacy/Data Governance]` assesses how personal data is scoped when exported: this row carries only the subject's own bookmark facts (an id and a timestamp), never other users' data.
- **Walkthrough**: `required SessionIdentifierType SessionId` (`UserDataExportBookmarkDTO.cs:10`) and `required DateTime CreatedOn` (`:13`), both `init`-only.
- **Why it's built this way**: A purpose-built export row (rather than reusing a general bookmark DTO) keeps the exported surface exactly the fields the privacy policy commits to.
- **Where it's used**: Nested in [UserDataExportEngagementSectionDTO](#userdataexportengagementsectiondto).

---

### UserDataExportNotificationDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: One notification-inbox row inside the Notifications section of a data-subject export (PRIVACY.md §7): the notification id, title, and sent/read state.
- **Depends on**: `UserNotificationIdentifierType` (Notification's id alias); BCL `DateTime`/`DateTime?`.
- **Concept introduced**: Same data-minimized export-row shape as [UserDataExportBookmarkDTO](#userdataexportbookmarkdto). `[Rubric §30, Compliance/Privacy/Data Governance]`: exports only the subject's own inbox facts.
- **Walkthrough**: `required NotificationId` (`UserDataExportNotificationDTO.cs:10`), `required Title` (`:13`), `required DateTime SentOn` (`:16`), `bool IsRead` (`:19`), and `DateTime? ReadOn` (`:22`, null when unread).
- **Why it's built this way**: Carrying `IsRead`/`ReadOn` lets the export reflect the subject's actual interaction history without pulling notification body internals.
- **Where it's used**: Nested in [UserDataExportNotificationSectionDTO](#userdataexportnotificationsectiondto).

---

### UserDataExportSubmittedQuestionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: One submitted session-question row inside the Engagement section of a data-subject export (PRIVACY.md §7): ids and a submission date only.
- **Depends on**: `SessionQuestionIdentifierType`, `SessionIdentifierType`; BCL `DateTime`.
- **Concept introduced**: Same data-minimized export-row shape as [UserDataExportBookmarkDTO](#userdataexportbookmarkdto). `[Rubric §30, Compliance/Privacy/Data Governance]`: the doc comment is explicit that this row is ids plus submission date only, never other users' data.
- **Walkthrough**: `required SessionQuestionIdentifierType QuestionId` (`UserDataExportSubmittedQuestionDTO.cs:10`), `required SessionIdentifierType SessionId` (`:13`), `required DateTime CreatedOn` (`:16`).
- **Why it's built this way**: Deliberately omitting question text keeps a shared live-Q&A artifact from leaking co-attendees' content into one subject's export.
- **Where it's used**: Nested in [UserDataExportEngagementSectionDTO](#userdataexportengagementsectiondto).

---

### UserListDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` · Level 0 · record class

- **What it is**: The compact DTO for the organizer user-list screen (BR-51): identity and role facts only.
- **Depends on**: `UserIdentifierType`; BCL `DateTime`.
- **Concept introduced**: **Intentional DTO divergence for data minimization.** Compare with [UserDataExportDTO](#userdataexportdto): the export includes device fields at the subject's own request, while this list view omits them because organizers do not need device fingerprints and bulk-exposing them across many rows is unnecessary risk. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses minimization at the type level: separate DTOs per use case enforce it in code, not in review.
- **Walkthrough**: Six `init`-only members: `required UserId` (`UserListDTO.cs:11`), `required Email` (`:14`), `required FirstName` (`:17`), `required LastName` (`:20`), `required Role` (`:23`), and `DateTime CreatedOn` (`:25`).
- **Why it's built this way**: One DTO per use case (list vs export) beats one nullable-everywhere DTO, keeping each response's surface deliberate.
- **Where it's used**: Returned (as a paged collection) by the Identity API's list-users endpoint; consumed by [UserService](#userservice) in the UI.

---

### DisabledAttendeeQueryService
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` · Level 1 · class (sealed)

- **What it is**: The stub implementation of [IAttendeeQueryService](#iattendeequeryservice) registered in a host where the Identity module is disabled; it returns an empty list.
- **Depends on**: [IAttendeeQueryService](#iattendeequeryservice), `UserIdentifierType`.
- **Concept introduced**: **Disabled-module stub (Null Object).** When a service host boots only its own module, its dependencies' contracts still need a registration; a stub that returns a benign empty result lets the consumer run without the provider present. `[Rubric §7, Microservices Readiness]` assesses whether a module can be composed in or out without breaking callers: registering this stub via `RegisterDisabledStubs()` is exactly that mechanism (see the module system, ADR-007/008). `[Rubric §2, Design Patterns]` recognizes the Null Object pattern here.
- **Walkthrough**: `GetAttendeeUserIdsAsync` (`DisabledAttendeeQueryService.cs:10`) returns `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])`, an empty read-only list.
- **Why it's built this way**: A no-op that returns nothing (rather than throwing) means a Notification host without a co-hosted Identity simply broadcasts to no one, instead of failing at resolution time.
- **Where it's used**: Registered in a service host's composition when Identity is disabled; parallels the disabled stubs the other modules register for their cross-service gRPC contracts.

---

### UserDataExportEngagementSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:10` · Level 1 · record (sealed)

- **What it is**: The Engagement section of a data-subject export: the subject's session bookmarks and submitted session questions, aggregated cross-service from the Engagement service.
- **Depends on**: [UserDataExportBookmarkDTO](#userdataexportbookmarkdto), [UserDataExportSubmittedQuestionDTO](#userdataexportsubmittedquestiondto).
- **Concept introduced**: **Best-effort cross-service aggregation with an availability flag.** The export aggregates data owned by another service; when that peer stays unreachable after the standard resilience pipeline, the export still succeeds with this section marked incomplete instead of failing. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation under partial outage: `Available = false` is the explicit contract that a peer outage never fails the whole export (RemediationBacklog #30 residual closed).
- **Walkthrough**: `required bool Available` (`UserDataExportEngagementSectionDTO.cs:14`) signals whether Engagement was reachable; `IReadOnlyList<UserDataExportBookmarkDTO> Bookmarks` (`:17`) and `IReadOnlyList<UserDataExportSubmittedQuestionDTO> SubmittedQuestions` (`:20`) both default to empty and stay empty when `Available` is false.
- **Why it's built this way**: Making incompleteness a first-class, queryable field (not an exception or a silent gap) lets a caller retry later and lets the subject see that a section is pending rather than truly empty.
- **Where it's used**: Nested (nullable) in [UserDataExportDTO](#userdataexportdto).

---

### UserDataExportNotificationSectionDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:9` · Level 1 · record (sealed)

- **What it is**: The Notifications section of a data-subject export: the subject's notification inbox rows, aggregated cross-service from the Notification service.
- **Depends on**: [UserDataExportNotificationDTO](#userdataexportnotificationdto).
- **Concept introduced**: Same best-effort-with-availability-flag shape as [UserDataExportEngagementSectionDTO](#userdataexportengagementsectiondto). `[Rubric §29, Resilience & Business Continuity]`: a Notification outage yields `Available = false` and an empty list, never a failed export.
- **Walkthrough**: `required bool Available` (`UserDataExportNotificationSectionDTO.cs:13`) and `IReadOnlyList<UserDataExportNotificationDTO> Notifications` (`:16`, newest first, defaulting to empty).
- **Why it's built this way**: Mirroring the Engagement section keeps the two aggregated sections symmetric, so the export composer and any UI treat them identically.
- **Where it's used**: Nested (nullable) in [UserDataExportDTO](#userdataexportdto).

---

### UserDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` · Level 1 · record class

- **What it is**: The general-purpose data transfer object for a single user account.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (from `MMCA.Common.Shared.DTOs`), `UserIdentifierType`.
- **Concept introduced**: **`IBaseDTO<TId>` identity contract.** Implementing the common base DTO interface gives the type the framework-standard `Id` shape, so generic UI/query plumbing (entity services, mappers) can treat it uniformly. `[Rubric §9, API & Contract Design]` assesses contract consistency across the surface: conforming to `IBaseDTO<TId>` keeps every entity DTO's identity member uniform.
- **Walkthrough**: `required UserIdentifierType Id` (`UserDTO.cs:11`, satisfying the interface), then `required Email` (`:14`, the login credential per BR-200), `required FirstName` (`:17`), `required LastName` (`:20`), and `required Role` (`:23`, used for authorization decisions). No device fields and no secrets.
- **Why it's built this way**: A lean account DTO backs the generic entity-service path while the export and list use cases get their own purpose-built DTOs.
- **Where it's used**: Flows through the Identity UI entity services registered by [DependencyInjection](#dependencyinjection); the manual mapper (ADR-001) projects the `User` entity onto it.

---

### UserDataExportDTO
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDataExportDTO.cs:16` · Level 2 · record class

- **What it is**: The portable export of all personal data the platform holds for one user, served to satisfy the data-subject access / portability right (PRIVACY.md §7; GDPR/CCPA). Credential secrets are deliberately excluded.
- **Depends on**: [UserDataExportEngagementSectionDTO](#userdataexportengagementsectiondto), [UserDataExportNotificationSectionDTO](#userdataexportnotificationsectiondto), `UserIdentifierType`, `SpeakerIdentifierType`.
- **Concept introduced**: **Privacy-by-design in the DTO plus cross-service aggregation.** The XML doc is explicit that password hash/salt, refresh token, and the opaque external-provider key are excluded (they are secrets, not portable personal data), while device fields *are* included because they are the subject's own personal data. Beyond the Identity-owned account fields, it composes the two best-effort peer sections. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses the completeness and scoping of a subject export: this DTO both enumerates what is portable and, via the two `Available` flags on its sections, records what could not be fetched. `[Rubric §29, Resilience & Business Continuity]`: a peer outage returns the affected section with `Available = false` rather than failing the export (RemediationBacklog #30 residual closed).
- **Walkthrough**: Account facts `required UserId` (`UserDataExportDTO.cs:19`), `Email` (`:22`), `FirstName` (`:25`), `LastName` (`:28`), `FullName` (`:31`), `Role` (`:34`); auth shape `IsExternalLogin` (`:37`) and `LoginProvider?` (`:40`, provider name only, key omitted); `LinkedSpeakerId?` (`:43`, the User to Speaker link); `AvatarUrl?` (`:47`); seven nullable device fields (`:50-65`); audit timestamps `CreatedOn` (`:71`) and `LastModifiedOn?` (`:74`); and the two nullable aggregated sections `Engagement` (`:78`) and `Notifications` (`:82`).
- **Why it's built this way**: Keeping the export DTO in `Identity.Shared` lets the API return it without reaching into Application internals, and stating the exclusions in the doc comment forces the next person who adds a `User` field to decide whether it belongs in a subject export.
- **Where it's used**: Produced by the export-user-data use case (which fans out to Engagement and Notification for the two sections) and returned by the Identity API's export endpoint as a downloadable document.

---

### IdentityUIModule
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` · Level 3 · class (sealed)

- **What it is**: The Identity module's UI descriptor: it contributes the "My Profile" (all users) and "Users" (organizer-only) navigation items and exposes its assembly for Blazor component discovery.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule), [NavItem](group-15-common-ui-framework.md#navitem), [NavSection](group-15-common-ui-framework.md#navsection), [RoleNames](group-08-auth.md#rolenames), [IdentityRoutePaths](#identityroutepaths); MudBlazor `Icons` and BCL `Assembly`.
- **Concept introduced**: **UI module descriptor.** `IUIModule` is the front-end analogue of the back-end [IModule](group-14-module-system-composition.md#imodule): each UI module declares its nav contributions and its assembly, and the shell composes them, so a module's navigation and pages travel with the module. `[Rubric §18, UI Architecture]` assesses front-end modularity: nav items are declared per module rather than hard-coded in one shell menu. `[Rubric §25, Navigation & IA]`: the `NavSection` placement (User vs Admin) and the `RoleNames.Organizer` gate on "Users" put role-appropriate entries in the right menu region.
- **Walkthrough**: `NavItems` (`IdentityUIModule.cs:15`) is a two-entry list: "Nav.MyProfile" at `IdentityRoutePaths.Profile` in `NavSection.User` (`:17`), and "Nav.Users" at `IdentityRoutePaths.Users`, gated on `RoleNames.Organizer`, in `NavSection.Admin` (`:18`), each carrying `TitleResource: typeof(IdentityUIModule)` for localized labels. `Assembly => typeof(IdentityUIModule).Assembly` (`:21`) hands the shell this assembly for Razor component discovery.
- **Why it's built this way**: Declaring nav items as data (not markup) lets the shell render one coherent, role-filtered menu from every enabled module while each module owns its own entries.
- **Where it's used**: Registered as a singleton `IUIModule` by [DependencyInjection](#dependencyinjection); enumerated by the common UI shell to build the sidebar.

---

### DependencyInjection
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:11` · Level 4 · class (static)

- **What it is**: The Identity UI module's composition root: an `AddIdentityUI()` registration that wires the module's entity services, its user-management service, and the [IdentityUIModule](#identityuimodule) descriptor.
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype), [IUIModule](group-15-common-ui-framework.md#iuimodule), [IdentityUIModule](#identityuimodule), [IUserUIService](#iuseruiservice), [UserService](#userservice); Scrutor (`Scan`) and `Microsoft.Extensions.DependencyInjection`.
- **Concept introduced**: **`extension(IServiceCollection)` registration with Scrutor scan.** The C# preview extension-type syntax adds `AddIdentityUI` directly onto `IServiceCollection` (see [primer](00-primer.md#c-extensiont-types--read-this-once)), and Scrutor assembly-scanning auto-registers the convention-based services so new entity services need no manual DI line. `[Rubric §2, Design Patterns]` assesses composition-root discipline: registration is convention-driven where uniform and explicit where bespoke. `[Rubric §1, SOLID]`: the explicit `IUserUIService -> UserService` binding keeps the one non-conventional contract inverted.
- **Walkthrough**: The `extension(IServiceCollection services)` block (`DependencyInjection.cs:13`) exposes `AddIdentityUI()` (`:19`), which: (1) Scrutor-scans the Identity UI assembly for every `IEntityService<,>` implementation and registers them as their interfaces with scoped lifetime (`:22-26`); (2) registers the custom `IUserUIService -> UserService` binding as scoped (`:29`), since user management is not a plain entity service; (3) registers `IUIModule -> IdentityUIModule` as a singleton for nav and assembly discovery (`:32`); then returns `services` for chaining (`:34`).
- **Why it's built this way**: Scanning the conventional services while explicitly binding the one special case keeps the registration both terse and correct, and the singleton descriptor matches the shell's expectation that UI modules are enumerated once.
- **Where it's used**: Called from the Web UI host's startup when the Identity module is enabled (`UIModuleConfiguration.IsModuleEnabled(configuration, "Identity")`).

### ChangePasswordRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` · Level 1 · class (sealed)

- **What it is**: the FluentValidation validator for the change-password request. It requires a non-empty current password and enforces the shared strong-password policy on the new password.
- **Depends on**: `AbstractValidator<ChangePasswordRequest>` (FluentValidation), [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (the request it validates), and the shared [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest) rule set from `MMCA.Common.Application`.
- **Concept reinforced, request validation at the edge (composed rule sets).** `[Rubric §24, Forms, Validation & UX Safety]` (assesses that inputs are validated before they reach the domain, with clear per-field errors) and `[Rubric §11, Security]` (assesses that password strength is enforced on the way in). The validator is run by the [CQRS validating decorator](group-05-cqrs-pipeline.md) before the transaction opens, so a weak or empty password is rejected with a 400 before any handler work. It composes a shared rule set rather than re-spelling the policy: `Include(new StrongPasswordRules<ChangePasswordRequest>(x => x.NewPassword))` (`ChangePasswordRequestValidator.cs:18`) pulls in the same complexity rules the registration validator uses, so the two flows cannot drift.
- **Walkthrough**: the constructor (`ChangePasswordRequestValidator.cs:13-19`) declares two things: a `NotEmpty` rule on `CurrentPassword` with an explicit message and error code `User.CurrentPassword.Required` (`ChangePasswordRequestValidator.cs:15-16`), and the included [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest) applied to `NewPassword` (`ChangePasswordRequestValidator.cs:18`).
- **Why it's built this way**: the current password is only checked for presence here (its correctness is proven cryptographically in [`ChangePasswordHandler`](#changepasswordhandler) against the stored hash), while the new password carries the full strength policy. Sharing `StrongPasswordRules<T>` keeps one definition of "strong" across register and change-password.
- **Where it's used**: auto-registered by the Identity Application Scrutor scan and resolved by the validating decorator when [`ChangePasswordCommand`](#changepasswordcommand) (which wraps a `ChangePasswordRequest`) flows through the pipeline from [`AuthController.ChangePasswordAsync`](#authcontroller).

### IUserUIService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` · Level 1 · interface

- **What it is**: the UI-layer service contract for organizer user management and self-service avatar handling. It is a bespoke contract (not the generic entity-service interface) because the Users API returns [`UserListDTO`](#userlistdto) and exposes only list, delete, and avatar operations rather than uniform CRUD.
- **Depends on**: [`UserListDTO`](#userlistdto) (the list row), the `UserIdentifierType` alias; BCL only (`Stream`, `Task`, `CancellationToken`).
- **Concept introduced, the per-resource UI service abstraction.** `[Rubric §18, UI Architecture]` (assesses whether Blazor components depend on typed service interfaces rather than calling `HttpClient` directly, which keeps pages testable with fakes). The doc comment (`IUserUIService.cs:5-10`) is explicit that this contract exists precisely because users are not a standard CRUD resource: the list returns a projection DTO and there is no create/update endpoint. Components ([`UserList`](#userlist), [`Profile`](#profile)) inject this interface, never the concrete [`UserService`](#userservice).
- **Walkthrough**: five members. `GetPagedAsync(...)` (`IUserUIService.cs:16-25`) returns an `(IReadOnlyList<UserListDTO> Items, int TotalItems)` tuple with server-side filter/page/sort arguments (BR-51). `DeleteAsync(UserIdentifierType, ...)` (`IUserUIService.cs:30`) soft-deletes an account (UC-21). The three avatar members, `GetMyAvatarUrlAsync` (`IUserUIService.cs:33`), `UploadMyAvatarAsync` (`IUserUIService.cs:39`), and the idempotent `RemoveMyAvatarAsync` (`IUserUIService.cs:42`), cover the "my avatar" flow (BR-116a).
- **Why it's built this way**: shaping the contract around the endpoints that actually exist (paged list, delete, avatar) keeps the UI honest about the server's capabilities and lets components bind to an interface that a bUnit test can fake without a live API.
- **Where it's used**: implemented by [`UserService`](#userservice); injected into [`UserList`](#userlist) (list + delete) and [`Profile`](#profile) (delete + avatar).

### UserDeleted
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` · Level 2 · record (sealed)

- **What it is**: the domain event raised when a user account is soft-deleted (BR-56). It lets other in-process reactions (and, via the outbox, downstream contexts) respond to a deletion.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (the framework domain-event base), the `UserIdentifierType` alias.
- **Concept reinforced, the domain event as an in-boundary announcement.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether state changes are announced as events rather than leaked as side effects). This is one of the two events the [`User`](#user) aggregate raises. The [aggregate-root event mechanism](group-02-domain-building-blocks.md#iaggregateroot) is introduced in group-02: the event is added to the aggregate's private list and drained by `SaveChangesAsync` into the outbox in the same transaction (ADR-003).
- **Walkthrough**: a one-member positional record, `sealed record class UserDeleted(UserIdentifierType UserId) : BaseDomainEvent` (`UserDeleted.cs:10-12`). The doc comment (`UserDeleted.cs:5-9`) notes the intended reactions (cascade cleanup, audit logging).
- **Where it's used**: raised by [`User.Delete`](#user) on a successful soft-delete (`User.cs:353`).

### UserPasswordChanged
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users.DomainEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` · Level 2 · record (sealed)

- **What it is**: the domain event raised when a user's password is changed. Structurally identical to [`UserDeleted`](#userdeleted): a single-field event carrying the affected `UserId`.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the `UserIdentifierType` alias.
- **Concept**: the same aggregate-raised domain-event shape as [`UserDeleted`](#userdeleted) (see [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) in group-02); `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: `sealed record class UserPasswordChanged(UserIdentifierType UserId) : BaseDomainEvent` (`UserPasswordChanged.cs:9-11`).
- **Where it's used**: raised by [`User.ChangePassword`](#user) after the new hash and salt are set (`User.cs:315`).

### UserRegistered
> MMCA.ADC.Identity.Shared · `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` · Level 3 · record (sealed)

- **What it is**: the cross-module integration event published after a new user successfully registers. It carries the database-generated `UserId` plus `Email`, `FirstName`, `LastName`, and `Role` so downstream contexts can react without touching the Identity aggregate.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (the framework integration-event base), the `UserIdentifierType` alias.
- **Concept introduced, the integration event vs. the domain event.** `[Rubric §7, Microservices Readiness]` (assesses cross-module coupling through published events rather than direct service calls) and `[Rubric §6, CQRS & Event-Driven]`. Unlike a domain event (which stays inside the aggregate's own module), an *integration* event lives in the module's `Shared` assembly so other modules can subscribe by type without referencing Identity's Domain. The doc comment (`UserRegistered.cs:5-17`) records the history: it replaced a direct `ISpeakerLinkingService.TryAutoLinkSpeakerAsync` call from Identity into Conference. Conference now subscribes via its `UserRegisteredHandler` to run the speaker email-match auto-link (BR-207), so the two modules are coupled only by this message contract.
- **Walkthrough**: a five-member positional record (`UserId`, `Email`, `FirstName`, `LastName`, `Role`) deriving [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (`UserRegistered.cs:23-29`). The doc comment (`UserRegistered.cs:6-10`) stresses the *timing*: it is published by `AuthenticationService` **after** the unit-of-work commit, so `UserId` is the real EF-generated identity, not a placeholder.
- **Why it's built this way**: publishing after commit (from the application service, not from [`User.Create`](#user), which deliberately raises no event) guarantees subscribers see a persisted id, and routing it over the outbox-backed broker (ADR-003) gives at-least-once cross-service delivery.
- **Where it's used**: published by [`AuthenticationService`](#authenticationservice) after registration; consumed by Conference's `UserRegisteredHandler` (and any other module that subscribes).

### UserService
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Services` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserService.cs:14` · Level 3 · class (sealed)

- **What it is**: the concrete HTTP client for the `users` WebAPI resource. It implements [`IUserUIService`](#iuseruiservice), turning the interface's list/delete/avatar calls into authenticated requests against the Identity service through the Gateway.
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) (the base that supplies the token-attaching `HttpClient`, the Polly `RetryPolicy`, and `ServiceExceptionHelper`), [`IUserUIService`](#iuseruiservice) (the contract), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); BCL (`System.Net.Http.Json`, `CultureInfo`).
- **Concept reinforced, the authenticated UI HTTP service.** `[Rubric §18, UI Architecture]` (assesses a typed service layer between components and HTTP) and `[Rubric §12, Performance & Scalability]` (assesses resilient, retried remote calls). Deriving [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) (`UserService.cs:14-15`) means every call goes out on a bearer-token client via `CreateAuthenticatedClientAsync` and is wrapped by the base `RetryPolicy`; a non-success response is routed through `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` so the UI can surface the server's Problem Details.
- **Walkthrough**
  - `GetPagedAsync` (`UserService.cs:19-63`): builds a filter/paging query string (culture-invariant number formatting, `UserService.cs:32-33`), drops null/blank filters (`UserService.cs:42-44`), calls `GET users?...` under the retry policy, then reads a [`PagedCollectionResult<UserListDTO>`](group-01-result-error-handling.md#pagedcollectionresultt) and returns its items plus `PaginationMetadata.TotalItemCount` (`UserService.cs:57-62`).
  - `DeleteAsync` (`UserService.cs:65-80`): `DELETE users/{userId}` under retry; a failure is translated by `ServiceExceptionHelper` before `EnsureSuccessStatusCode`.
  - Avatar trio (`UserService.cs:82-131`): `GetMyAvatarUrlAsync` reads `users/me/avatar` into a [`UserAvatarDTO`](#useravatardto); `UploadMyAvatarAsync` posts a `multipart/form-data` body **without retry** (the note at `UserService.cs:103` explains the content stream is single-shot and cannot rewind); `RemoveMyAvatarAsync` issues an idempotent delete.
- **Why it's built this way**: concentrating the token, retry, and error-translation mechanics in [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) keeps each method a thin request shape, and deliberately skipping retry on the upload avoids replaying a consumed stream.
- **Where it's used**: registered as the `IUserUIService` implementation in the Identity UI module and injected into [`UserList`](#userlist) and [`Profile`](#profile).

### UserClaimsController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` · Level 4 · class (sealed)

- **What it is**: a one-action diagnostic controller that returns the authenticated caller's own JWT claims as a dictionary keyed by claim type (UC-10). It is the smallest controller in the module and the first place this chapter shows the thin-controller shape.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (the shared MVC base from `MMCA.Common.API`); ASP.NET Core MVC + `Asp.Versioning` (NuGet).
- **Concept introduced, the thin MVC controller over `ApiControllerBase`.** `[Rubric §9, API & Contract Design]` (assesses controllers as thin edges that shape HTTP and delegate, with versioning declared) and `[Rubric §11, Security]` (assesses correct authorization scoping). Every REST controller in the module inherits [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), declares `[ApiVersion("1.0")]` (`UserClaimsController.cs:14`), and carries no business logic of its own. This one is class-level `[Authorize]` (`UserClaimsController.cs:15`) with **no** role or permission policy, so any valid JWT can call it, and the response is scoped to `HttpContext.User.Claims`, the caller's own token, so it never exposes another user's data.
- **Walkthrough**: `GetClaims()` (`UserClaimsController.cs:25-38`) projects `HttpContext.User.Claims` into a dictionary with `GroupBy(c => c.Type)` (`UserClaimsController.cs:28`). The `GroupBy` handles multi-value claims (a user with several roles): a single-value claim serializes as a bare `string`, a multi-value one as a `List<string>` (`UserClaimsController.cs:33-34`). Returns `Ok(claims)`.
- **Why it's built this way**: exposing the exact claim set the server sees is a cheap, read-only debugging aid (verifying that `user_id`, `email`, `role`, and the optional `speaker_id` claim are present after login) without adding an attack surface, the endpoint reveals only what the caller already holds in their own token.
- **Where it's used**: routed at `/UserClaims` on the Identity service and reachable through the Gateway; useful in the OpenAPI explorer and for E2E/debugging of the token-issuance flow.

### UserList
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.User` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:15` · Level 4 · class (Blazor component, `partial`)

- **What it is**: the code-behind for the organizer-only user list page: a paginated, column-filterable `MudDataGrid<UserListDTO>` with a search box, per-user delete, and a mobile card layout, all backed by server-side paging.
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (the shared list-page base it derives from), [`IUserUIService`](#iuseruiservice) (injected as `UserService`, the list + delete API), [`UserListDTO`](#userlistdto) (the grid row), and BCL/MudBlazor externals (`MudDataGrid<T>`, `GridState<T>`, `GridData<T>`) plus the `MMCA.Common.UI` components [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and `DeleteConfirmation`. It talks only to UI-service abstractions, never a domain type.
- **Concept reinforced, the server-driven data-grid list page.** `[Rubric §18, UI Architecture]` (assesses whether pages delegate data access to typed services rather than calling `HttpClient` directly) and `[Rubric §24, Forms, Validation & UX Safety]` (assesses that filtering/paging happen server-side, not by loading everything and filtering in the browser). Deriving [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`UserList.razor.cs:15`) inherits the grid plumbing, the mobile-vs-desktop split (`IsMobile`), and the filter save/restore hooks; the page supplies only the per-column filter extraction and the fetch delegate. `[Rubric §27, Internationalization]`: all display strings resolve through the inherited localizer `L` (`Title`, `EntityName`, and the snackbar messages), so the page is en-US/es aware (ADR-027).
- **Walkthrough**
  - `SaveFilters`/`RestoreFilters` (`UserList.razor.cs:28-32`): persist and rehydrate the free-text `_searchString` so a round-trip back to the page keeps the organizer's query.
  - `LoadServerData` (`UserList.razor.cs:47-64`): the desktop grid callback. It hands the base's `LoadServerDataAsync` two lambdas: one that pulls the per-column filter values out of the `GridState` keyed by `nameof(UserListDTO.Email)` / `FirstName` / `LastName` / `Role` and calls [`IUserUIService`](#iuseruiservice)`.GetPagedAsync(...)`, and one that folds the search box into an `Email` `contains` filter (`UserList.razor.cs:62-63`). Every filter is a server-side argument, nothing is filtered in memory.
  - `FetchMobilePage` (`UserList.razor.cs:67-72`): the phone-layout callback for [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), fetching pages sorted by `Email` with the search box applied as the email filter.
  - `DeleteUserAsync` (`UserList.razor.cs:75-102`): shows the `DeleteConfirmation` dialog keyed by the target's email (`UserList.razor.cs:77`), and only on confirmation calls [`IUserUIService`](#iuseruiservice)`.DeleteAsync(user.UserId)`, then reloads the grid or resets the mobile list. It swallows `OperationCanceledException` (expected on disposal / InteractiveAuto render-mode transitions) and surfaces any other failure as an error snackbar.
- **Why it's built this way**: pushing every filter and page to the server keeps the client cheap and the list authoritative; requiring an explicit confirmation before a destructive delete is the §24 UX-safety guard. Authoring the page once in the module's Razor Class Library lets the same component render on Web and MAUI (primer §2, "write-once UI").
- **Where it's used**: the routable `/users` page; the sibling `.razor` file gates it with `[Authorize(Roles = RoleNames.Organizer)]`, and the module descriptor [`IdentityUIModule`](#identityuimodule) contributes its Organizer-only nav entry.

### UserRole
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` · Level 4 · class (sealed)

- **What it is**: the Identity domain's closed-set role value object. It fixes the ADC role vocabulary (`Organizer`, `Attendee`, `ContentEditor`) on top of the shared [`RoleValue`](group-08-auth.md#rolevalue) base, and offers safe parsing, validation, case-insensitive checks, and an implicit `string` conversion.
- **Depends on**: [`RoleValue`](group-08-auth.md#rolevalue) (the `MMCA.Common.Shared` base that supplies case-insensitive value equality, hashing, and the lookup builder), [`RoleNames`](group-08-auth.md#rolenames) (the canonical role-name constants), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error); BCL (`System.Collections.Frozen`).
- **Concept reinforced, the closed-set value object.** `[Rubric §4, Domain-Driven Design]` (assesses value objects that replace primitive-typed strings with a validated, self-describing type). The [value-object idiom](group-02-domain-building-blocks.md#valueobject) here is the *closed enumeration* variant (the same shape as [`Currency`](group-02-domain-building-blocks.md#currency)): a private constructor plus a fixed `FrozenDictionary<string, UserRole> AllByValue` (`UserRole.cs:32-33`) built by the base's `BuildLookup` over the three static instances, and the only ways in are `FromString` (returns [`Result<UserRole>`](group-01-result-error-handling.md#result)) or the three `static readonly` singletons `Organizer`/`Attendee`/`ContentEditor` (`UserRole.cs:20,23,30`). `[Rubric §11, Security]`: because role checks flow through this type's case-insensitive lookup rather than ad-hoc `== "Organizer"` string compares, a claim casing mismatch cannot silently deny or grant access.
- **Walkthrough**
  - The three roles (`UserRole.cs:20-30`): `Organizer` (manages conference master data, BR-41), `Attendee` (the default for new registrations, BR-45), and `ContentEditor` (curates the session catalog but, per the doc comment `UserRole.cs:25-29`, is a strict capability subset of Organizer: no event structure, rooms, feedback questions, session selection, or user-list access).
  - `FromString(string role)` (`UserRole.cs:51-58`): `AllByValue.TryGetValue` (null-coalescing the input to `string.Empty`); on a miss it returns `Error.Invariant("User.Role.Invalid", ...)` rather than throwing.
  - `IsValid(string role)` (`UserRole.cs:65`): a boolean fast-path (`ContainsKey`) with no `Result` allocation, used by [`UserInvariants`](#userinvariants).
  - `IsOrganizer(string? role)` (`UserRole.cs:76`): a case-insensitive `string.Equals` against `Organizer`, the safe way to test a raw JWT role claim (the doc comment `UserRole.cs:67-75` warns that a plain `==` would compare ordinally through the implicit string conversion).
  - Equality and conversion (`UserRole.cs:78-98`): `==`/`!=` operators and `Equals`/`GetHashCode` delegate to the [`RoleValue`](group-08-auth.md#rolevalue) base; the `implicit operator string` (`UserRole.cs:94`) and `ToString()` (`UserRole.cs:98`) return the canonical `Value` for the many places that still pass roles as strings (the `Role` column, JWT claims).
- **Why it's built this way**: a fixed set with O(1) case-insensitive lookup makes "is this a real role?" a single source of truth, and building on [`RoleValue`](group-08-auth.md#rolevalue) shares the equality/hashing machinery with the Store's parallel role type rather than re-deriving it per app.
- **Where it's used**: the [`User`](#user) aggregate stores its `Role` as a string but validates it via [`UserInvariants.EnsureRoleIsValid`](#userinvariants) → `UserRole.IsValid`; [`DeleteUserHandler`](#deleteuserhandler) compares against `UserRole.Organizer`.

### UserInvariants
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:10` · Level 5 · class (static)

- **What it is**: the static invariants toolbox for the [`User`](#user) aggregate. It publishes the user field max-length constants and the check methods (email format, name presence + length, password hash/salt presence, role validity, and the ADR-027/028 culture/theme validators), each returning a [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the reusable lower-layer checks from `MMCA.Common.Domain`), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (the culture allowlist), [`UserRole`](#userrole) (role validity), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, the shared-constants invariant class.** `[Rubric §16, Maintainability]` (assesses a single place to change a constraint) and `[Rubric §4, DDD]` (invariants enforced at construction). This is the Identity-module instance of the invariants pattern [group-02](group-02-domain-building-blocks.md#addressinvariants) introduces: the four `public const int` max-lengths (`FirstNameMaxLength`/`LastNameMaxLength`/`EmailMaxLength = 100`, `DeviceFieldMaxLength = 256`, `UserInvariants.cs:13-22`) are the one source of truth that both the domain checks below and the EF [`UserConfiguration`](#userconfiguration) column lengths read from. Each check delegates the primitive work (`EnsureStringIsNotEmpty`, `EnsureStringMaxLength`, `EnsureBytesAreNotEmpty`) to [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants), adding only the User-specific code/message.
- **Walkthrough**
  - `EnsureEmailIsValid` (`UserInvariants.cs:24-44`): non-empty, then max-length, then a real format check via `System.Net.Mail.MailAddress.TryCreate` (`UserInvariants.cs:34`); each failure carries a distinct code (`User.Email.Empty` / `.TooLong` / `.InvalidFormat`).
  - `EnsureFirstNameIsValid` / `EnsureLastNameIsValid` (`UserInvariants.cs:46-54`): `Result.Combine` of the not-empty and max-length checks.
  - `EnsurePasswordHashIsValid` / `EnsurePasswordSaltIsValid` (`UserInvariants.cs:56-60`): the binary equivalents (`EnsureBytesAreNotEmpty`), so a raw password never reaches the entity, only a validated non-empty hash + salt (`[Rubric §11, Security]`).
  - `EnsureRoleIsValid` (`UserInvariants.cs:65-72`): delegates to [`UserRole.IsValid`](#userrole) so role validity lives in one place, not a string comparison here.
  - `EnsurePreferredCultureIsValid` / `EnsurePreferredThemeIsValid` (`UserInvariants.cs:77-98`): the ADR-027/028 checks, `null` is allowed (follow the request default / OS preference), otherwise culture must be in [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) and theme must be case-insensitively `"light"` or `"dark"`.
- **Why it's built this way**: co-locating the constants with the checks means EF, the domain, and (indirectly) the FluentValidation validators cannot drift on a field length, and returning `Result` (not throwing) keeps validation composable via `Result.Combine` in the [`User`](#user) factory.
- **Where it's used**: called throughout [`User`](#user)'s `Create`/`CreateExternal`/`ChangePassword`/`UpdatePreferences`; the max-length constants are read by [`UserConfiguration`](#userconfiguration) (Infrastructure) and match the `100` caps in the Identity request validators.

### Profile
> MMCA.ADC.Identity.UI · `MMCA.ADC.Identity.UI.Pages.Profile` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15` · Level 6 · class (Blazor component, `partial`)

- **What it is**: the code-behind for the "My Profile" page. It lets an authenticated user change their password, manage their avatar photo (BR-116a, ADR-045), and delete their own account (UC-21). It is a `partial class` whose markup lives in the sibling `Profile.razor`.
- **Depends on**: [`IUserUIService`](#iuseruiservice) (injected as `UserService`, for avatar + account delete), [`IAuthUIService`](group-15-common-ui-framework.md#iauthuiservice) (change-password and logout), and BCL/MudBlazor externals: `IMediaPickerService`, Blazor's `AuthenticationStateProvider`, `NavigationManager`, `InputFileChangeEventArgs`, MudBlazor's `ISnackbar`, `MudForm`, and `MudMessageBox`. No first-party domain types, a UI page only ever talks to UI-service abstractions, never the [`User`](#user) aggregate directly.
- **Concept reinforced, the Blazor page (code-behind + UI-service injection + MudForm validation).** `[Rubric §18, UI Architecture]` (assesses whether components delegate mutations to services rather than reaching across layers): every change here goes through a UI service, there are no direct HTTP calls. `[Rubric §24, Forms, Validation & UX Safety]` (assesses client-side validation and destructive-action confirmation): the change-password form is a `MudForm` with per-field validators, `ValidateNewPassword` (≥8 chars, `Profile.razor.cs:43-44`) and `ValidateConfirmPassword` (matches the new password, `Profile.razor.cs:46-49`), and the account delete is gated behind a `MudMessageBox` confirmation (`Profile.razor.cs:251`). `[Rubric §23, Front-End Performance & Rendering]`: the component owns a `CancellationTokenSource` (`Profile.razor.cs:27`) and implements the dispose pattern so in-flight calls are cancelled on teardown (`Profile.razor.cs:279-295`). `[Rubric §27, Internationalization]`: all field labels, validation messages, and snackbars resolve through the localizer `L` (ADR-027).
- **Walkthrough**: members in lifecycle order:
  - `OnInitializedAsync` (`Profile.razor.cs:55-80`): reads the current `AuthenticationState`, pulls the `user_id` claim, parses it with `int.TryParse` into `_userId` (`Profile.razor.cs:61-64`), and preloads the current avatar URL. It swallows `OperationCanceledException` (expected during InteractiveAuto render-mode transitions and disposal) and surfaces any other failure through the snackbar; `_isLoading` clears in `finally`.
  - Avatar handling (`Profile.razor.cs:82-194`): `PickAvatarAsync`/`CaptureAvatarAsync` (MAUI media picker) and `OnBrowserInputChangedAsync` (web `<InputFile>`) both feed `UploadAvatarStreamAsync` → [`IUserUIService`](#iuseruiservice)`.UploadMyAvatarAsync`. The browser path enforces a client-side 2 MB guard (`MaxAvatarBytes`, `Profile.razor.cs:25,125`) that mirrors the server BR-116a limit; `RemoveAvatarAsync` clears the photo. Every branch guards `_isSavingAvatar` and swallows `OperationCanceledException`.
  - `SavePasswordAsync` (`Profile.razor.cs:196-241`): runs `form.ValidateAsync()` and returns early if the form is invalid (`Profile.razor.cs:205-209`), so Required + min-length + match are enforced (and shown in the form error summary) before any round-trip. On success it calls `AuthService.ChangePasswordAsync(current, new, token)` (`Profile.razor.cs:214`); a `true` result resets the form and clears the fields with a success snackbar, a `false` result shows a failure snackbar. The boolean return (not a [`Result`](group-01-result-error-handling.md#result)) is the UI-service contract's simplification of the API call.
  - `DeleteAccountAsync` (`Profile.razor.cs:243-275`): requires `_userId`, awaits the confirmation box, then `UserService.DeleteAsync(id, token)` → `AuthService.LogoutAsync()` → hard navigation to `/` (`NavigateTo("/", forceLoad: true)`, `Profile.razor.cs:261`) so the now-stale auth state is fully discarded. This is the client half of the server erasure flow (the server side is [`DeleteUserHandler`](#deleteuserhandler), which soft-deletes *and* anonymizes, ADR-005).
  - Dispose pattern (`Profile.razor.cs:279-295`): cancels and disposes the CTS exactly once, guarded by `_disposed`.
- **Why it's built this way**: keeping all mutation behind [`IAuthUIService`](group-15-common-ui-framework.md#iauthuiservice)/[`IUserUIService`](#iuseruiservice) keeps the page testable (bUnit) and identical across the Web and MAUI hosts that share this Razor Class Library (primer §2, "write-once UI"). The forced reload on delete avoids a Blazor circuit holding a credential for a user that no longer exists.
- **Where it's used**: the routable `/profile` page in the Identity UI module; the shipped E2E profile flow (G25) exercises this page and asserts zero axe-core violations.
- **Caveats / not-in-source**: the ≥8-char rule in `ValidateNewPassword` is a *client-side convenience* check; the authoritative password policy is enforced server-side by [`ChangePasswordRequestValidator`](#changepasswordrequestvalidator) and [`ChangePasswordHandler`](#changepasswordhandler). The `user_id` claim parse hard-codes `int.TryParse`, matching `UserIdentifierType = int`.

### RegisterRequestValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.Validation` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:11` · Level 6 · class (sealed)

- **What it is**: the FluentValidation validator for the registration request, the most comprehensive request validator in the Identity module. It composes email, password-strength, name, and optional-address rule sets.
- **Depends on**: `AbstractValidator<RegisterRequest>` (FluentValidation), [`RegisterRequest`](group-08-auth.md#registerrequest); the shared rule sets [`EmailRules<T>`](group-06-validation.md#emailrulest), [`StrongPasswordRules<T>`](group-06-validation.md#strongpasswordrulest), [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), and the `AddressValidator` ([`AddressValidator`](group-06-validation.md#addressvalidator)).
- **Concept reinforced, composing shared rule sets at the request boundary.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses layered, reusable input validation) and `[Rubric §11, Security]` (assesses password strength enforced before persistence). Rather than re-spell field rules, the constructor `Include`s the shared building blocks so the same email/password/name/address policies apply here as everywhere else, one definition, many call sites.
- **Walkthrough**: the constructor (`RegisterRequestValidator.cs:13-23`) includes [`EmailRules<RegisterRequest>`](group-06-validation.md#emailrulest) (max length 100, `RegisterRequestValidator.cs:15`), [`StrongPasswordRules<RegisterRequest>`](group-06-validation.md#strongpasswordrulest) on `Password` (`RegisterRequestValidator.cs:16`), two [`RequiredStringRules<RegisterRequest>`](group-06-validation.md#requiredstringrulest) for first/last name (max 100, `RegisterRequestValidator.cs:17-18`), and a conditional `SetValidator(new AddressValidator())` guarded by `.When(x => x.Address is not null)` (`RegisterRequestValidator.cs:20-22`) so the optional address is only validated when present.
- **Why it's built this way**: the `100` caps match [`UserInvariants`](#userinvariants)'s max-lengths, so the request-edge rejection and the domain invariant agree; the conditional address rule keeps registration open to users who omit a postal address.
- **Where it's used**: auto-registered by the Identity Application Scrutor scan and run by the validating decorator when a `RegisterRequest` is submitted through [`AuthController.RegisterAsync`](#authcontroller).

### User
> MMCA.ADC.Identity.Domain · `MMCA.ADC.Identity.Domain.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:17` · Level 6 · class (sealed)

- **What it is**: the Identity module's aggregate root and the richest domain type in ADC. It holds authentication credentials (per-user-salted password hash), role, refresh-token lifecycle, name, avatar URL, UI preferences, optional MAUI device metadata, optional external-OAuth linkage, and an optional cross-database scalar link to a `Speaker` in the Conference context.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (the top rung of the entity chain), [`Email`](group-02-domain-building-blocks.md#email) (value object), [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) + [`IAuthUser`](group-08-auth.md#iauthuser) (the erasure and auth-user contracts it implements), the [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), the [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) marker, [`UserRole`](#userrole) / [`UserInvariants`](#userinvariants), the domain events [`UserDeleted`](#userdeleted) and [`UserPasswordChanged`](#userpasswordchanged), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, GDPR/CCPA erasure at the aggregate (`IAnonymizable` + `[Pii]`).** `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses a real right-to-erasure path that reconciles with soft-delete). Because the framework soft-deletes by default (the row is never hard-deleted, [group-02](group-02-domain-building-blocks.md#iauditableentity)), personal data would otherwise survive a "delete". `User` closes that gap: it tags `Email`/`FirstName`/`LastName`/`AvatarUrl` with `[Pii]` (`User.cs:20,24,28,93`) and implements [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable). The `[Pii]` marker drives two governance mechanisms (both in [group-02](group-02-domain-building-blocks.md#piiattribute)): an architecture fitness test asserts that any `[Pii]`-carrying entity also implements [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) (so no personal data lacks an erasure path, ADR-005), and the opt-in [`PiiRedactor`](group-02-domain-building-blocks.md#piiredactor) can mask those fields for logs (a ready, tested helper, not an auto-wired sink). `[Rubric §4, DDD]`: the aggregate owns all its own transitions, credentials, refresh tokens, device metadata, and the speaker link are mutated only through this type's methods, never by outside code.
- **Walkthrough**
  - `[IdValueGenerated]` (`User.cs:16`): the id is DB-generated, so the factory leaves `Id = default` for SQL Server `IDENTITY` to fill (`User.cs:170,208`).
  - `[Pii]` fields + credentials (`User.cs:20-37`): `Email` (an [`Email`](group-02-domain-building-blocks.md#email) value object), `FirstName`, `LastName`, and the `byte[] PasswordHash`/`PasswordSalt` (BR-204), the array properties wrapped in a scoped `#pragma warning disable CA1819` with an inline justification (EF `varbinary(max)` mapping needs the array).
  - `LinkedSpeakerId` (`User.cs:53`): the nullable `SpeakerIdentifierType?` scalar to a Conference `Speaker` (1:1, BR-208), set/cleared only by `LinkSpeaker`/`UnlinkSpeaker` (`User.cs:253-261`). It is a scalar, not a navigation, because `Speaker` lives in another service's database (ADR-006).
  - `PreferredCulture` / `PreferredTheme` (`User.cs:83-86`) and `[Pii] AvatarUrl` (`User.cs:93-95`): the ADR-027/028 per-user UI preferences (`null` means "follow the request default / OS preference") and the BR-116a avatar URL; the preferences are set through `UpdatePreferences` (`User.cs:271-284`), the avatar through `SetAvatarUrl` (`User.cs:293`).
  - `Create` (`User.cs:146-174`): the factory. It constructs the [`Email`](group-02-domain-building-blocks.md#email) value object and `Result.Combine`s it with the name/credential/role invariants; on success it returns `Result.Success(new User(...))` with `Id = default`. It **deliberately does not raise a domain event**, the doc comment (`User.cs:129-138`) explains that the cross-module [`UserRegistered`](#userregistered) *integration* event is published by [`AuthenticationService`](#authenticationservice) after `SaveChangesAsync`, once the EF-generated id exists.
  - `CreateExternal` (`User.cs:188-214`): the OAuth factory, sets empty password arrays and records `LoginProvider`/`ProviderKey`; `LinkExternalProvider` (`User.cs:222-226`) later attaches a provider to an existing local account.
  - `ChangePassword` (`User.cs:301-318`): validates the new hash/salt, replaces them, and raises [`UserPasswordChanged`](#userpasswordchanged) (`User.cs:315`).
  - `Delete` (`User.cs:347-357`): a `new` shadow that first calls `RevokeRefreshToken()` (so outstanding sessions die immediately, a domain-enforced security rule, not left to the app layer), then `base.Delete()` (the soft-delete), then raises [`UserDeleted`](#userdeleted) on success (`User.cs:353`).
  - `Anonymize` (`User.cs:370-405`): the [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) implementation. It builds a placeholder email `deleted-{Id}@anonymized.invalid` (`User.cs:375`) so the unique-email invariant (BR-200) still holds across many erased accounts, is **idempotent** (if the email already equals the placeholder it returns success without re-erasing, `User.cs:382-385`), then overwrites the name, empties the credential arrays, nulls the device + provider + avatar fields, and revokes the refresh token, keeping the row so cross-context scalar references and the audit trail survive.
- **Why it's built this way**: the aggregate is intentionally rich because credential management, device metadata, OAuth linkage, the speaker link, and erasure all concern the one bounded context (Identity); splitting them would force multi-aggregate coordination for a single user operation. Refresh-token revocation on delete and the idempotent, in-place anonymize are domain-enforced compliance/security rules (ADR-005), so no caller can forget them.
- **Where it's used**: read and mutated by [`AuthenticationService`](#authenticationservice) for every auth flow, by [`ChangePasswordHandler`](#changepasswordhandler) / [`DeleteUserHandler`](#deleteuserhandler) for the two self-service use cases, projected by [`UserDTOMapper`](#userdtomapper), and mapped to the database by [`UserConfiguration`](#userconfiguration).

### OAuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` · Level 7 · class (sealed)

- **What it is**: the ADC concrete controller for external OAuth login (Google/GitHub). It is a body-less subclass of the shared [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) whose only job is to fix the route/versioning attributes and forward its three dependencies to the base.
- **Depends on**: [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (the base that owns the whole flow), the shared `IAuthenticationService` (aliased at `OAuthController.cs:6`), `ICacheService`, and `IConfiguration`; `Asp.Versioning` + ASP.NET Core MVC.
- **Concept reinforced, the minimal-concrete-controller-over-a-rich-base.** `[Rubric §3, Clean Architecture]` (assesses a thin API layer with logic in the base/service, not the endpoint) and `[Rubric §11, Security]` (assesses correct token-indirection in OAuth). The doc comment (`OAuthController.cs:10-16`) describes the flow the base runs: challenge → provider callback → complete → single-use-code exchange, with tokens *never* riding the redirect URL (they are exchanged for an opaque short-lived code). This subclass adds only the class-level `[Route("auth/oauth")]` / `[ApiVersion("1.0")]` (`OAuthController.cs:17-19`), which the doc notes are not reliably inherited from the base.
- **Walkthrough**: the whole type is one primary-constructor declaration (`OAuthController.cs:20-23`) forwarding `authenticationService`, `cacheService`, and `configuration` to `OAuthControllerBase(...)`. There are no overrides, the endpoints (challenge/callback/complete) all live in the base.
- **Why it's built this way**: extracting the OAuth mechanics into [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase) (`MMCA.Common.API`) lets any consuming app opt into social login by pairing this thin subclass with `AddExternalAuthProviders`; the app-specific parts (route prefix, provider configuration) stay here, the reusable flow stays shared. External OAuth is an ADC-only Identity feature.
- **Where it's used**: registered as an MVC controller in the Identity service host; reachable at `/auth/oauth/*` through the Gateway.
- **Caveats / not-in-source**: the challenge/callback/complete endpoint bodies and the single-use-code caching live in [`OAuthControllerBase`](group-12-api-hosting-mapping.md#oauthcontrollerbase), not in this file.

### UsersController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:31` · Level 8 · class (sealed)

- **What it is**: the user-management REST controller. It exposes the current user's avatar endpoints (BR-116a), a filtered organizer user list (BR-51), a GDPR-mandated per-user data export, and a self-service delete (UC-21). It extends [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) directly (not the generic entity-controller base) because user management is bespoke, not uniform CRUD.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase); the query/command handlers ([`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)/[`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)) for [`GetUsersQuery`](#getusersquery), [`ExportUserDataQuery`](#exportuserdataquery), [`DeleteUserCommand`](#deleteusercommand), and the three avatar use cases; [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); the [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) + [`IdentityPermissions`](#identitypermissions); [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`UserListDTO`](#userlistdto), [`UserAvatarDTO`](#useravatardto), [`UserDataExportDTO`](#userdataexportdto), [`Result`](group-01-result-error-handling.md#result); ASP.NET Core MVC + `Asp.Versioning`.
- **Concept reinforced, permission-gated + owner-scoped endpoints.** `[Rubric §11, Security]` (assesses layered authorization: coarse permission at the edge, fine ownership in the handler) and `[Rubric §30, Compliance]` (data portability + erasure as first-class endpoints). The list endpoint is gated by `[HasPermission(IdentityPermissions.UsersRead)]` (`UsersController.cs:125`), the permission-based authorization of ADR-020 rather than a hard-coded role check, while export and delete authorize *per resource* inside their handlers (owner-or-organizer). `[Rubric §3, Clean Architecture]`: choosing [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) over the generic entity base is the deliberate escape hatch, the list needs custom filter params and the export/delete have asymmetric authorization the generic base cannot express.
- **Walkthrough**
  - Avatar endpoints (`UsersController.cs:44-120`): `GetAvatarAsync` (`me/avatar`, GET), `SetAvatarAsync` (`me/avatar`, POST with `[RequestSizeLimit(MaxAvatarBytes)]` = 2 MB, `UsersController.cs:41,67`), and `RemoveAvatarAsync` (`me/avatar`, DELETE, idempotent). Each reads `currentUserService.UserId`, returns `Unauthorized()` when the JWT lacks it, and dispatches the matching command/query. `SetAvatarAsync` validates a single non-empty file within the size cap before buffering it (`UsersController.cs:78-93`).
  - `GetAllAsync` (`UsersController.cs:124-145`): `[HttpGet]` + `[HasPermission(IdentityPermissions.UsersRead)]`; takes `email`/`firstName`/`lastName`/`role` filters plus `pageNumber`/`pageSize` (`[Range(1, int.MaxValue)]`) and `sortColumn`/`sortDirection`, builds a [`GetUsersQuery`](#getusersquery), and returns the [`PagedCollectionResult<UserListDTO>`](group-01-result-error-handling.md#pagedcollectionresultt) or maps failures via `HandleFailure`.
  - `ExportAsync` (`UsersController.cs:149-168`): `[HttpGet("{userId}/export")]` under the class-level `[Authorize]` (any authenticated user). It reads [`ICurrentUserService`](group-08-auth.md#icurrentuserservice)`.UserId`, then dispatches [`ExportUserDataQuery`](#exportuserdataquery)`(userId, currentUserId, role)`, the *handler* enforces owner-or-organizer and 404s an unknown id. The doc comment cites PRIVACY.md §7 (GDPR Art. 20 portability).
  - `DeleteAsync` (`UsersController.cs:171-190`): `[HttpDelete("{userId}")]` with the same current-user guard, dispatching [`DeleteUserCommand`](#deleteusercommand)`(userId, currentUserId, role)` to [`DeleteUserHandler`](#deleteuserhandler); returns `204 No Content` on success.
- **Why it's built this way**: the two authorization styles are intentional, a broad read permission for the organizer list, but a row-scoped owner-or-organizer decision for exporting or deleting a *specific* account (which the generic query base cannot model). Keeping that fine-grained decision in the handler (over explicit ids) keeps it testable and independent of HTTP.
- **Where it's used**: registered in the Identity service host and routed via the Gateway; the list feeds the [`UserList`](#userlist) page (through [`IUserUIService`](#iuseruiservice)), and the delete is the server side of both the admin grid delete and the [`Profile`](#profile) self-delete.

### AuthController
> MMCA.ADC.Identity.API · `MMCA.ADC.Identity.API.Controllers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:24` · Level 11 · class (sealed)

- **What it is**: the ADC concrete authentication controller. It inherits the shared [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) (which supplies login/refresh/revoke/profile) and adds only the endpoints that need ADC-specific behaviour: registration (with client-IP capture), a 429-documented login passthrough, password change, and the ADR-027/028 preferences endpoints.
- **Depends on**: [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) (the rich base), the shared `IAuthenticationService`, [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), the [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) for [`ChangePasswordCommand`](#changepasswordcommand) and [`ChangePreferencesCommand`](#changepreferencescommand), the [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for `GetUserPreferencesQuery`; the request/response DTOs [`RegisterRequest`](group-08-auth.md#registerrequest) / [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest); [`Result`](group-01-result-error-handling.md#result); `Asp.Versioning` + ASP.NET Core MVC.
- **Concept reinforced, minimal concrete controller over a rich shared base.** `[Rubric §3, Clean Architecture]` (assesses a thin API layer) and `[Rubric §11, Security]` (assesses correct auth endpoints, rate-limit and lockout documentation, safe credential handling). The controller carries no business logic: it delegates to the injected `IAuthenticationService` (through the base) and to command/query handlers. Extracting [`AuthControllerBase`](group-12-api-hosting-mapping.md#authcontrollerbase) into `MMCA.Common.API` lets both ADC and Store share login/refresh/revoke while each app adds its own extensions here.
- **Walkthrough**: five endpoints (`AuthController.cs:36-141`)
  - `RegisterAsync` (`AuthController.cs:41-52`): overrides the base to capture the client IP from `HttpContext.Connection.RemoteIpAddress` (`AuthController.cs:46`) and pass it to `AuthenticationService.RegisterAsync(request, ipAddress, ct)` for the IP-based registration rate limit (BR-213); returns `201 Created` on success. This IP-capture override is the only ADC-specific registration behaviour.
  - `LoginAsync` (`AuthController.cs:62-65`): a passthrough override that immediately delegates to `base.LoginAsync`. It exists only to declare `[ProducesResponseType(429)]` (`AuthController.cs:61`) so the account-lockout response (BR-212) appears in the OpenAPI document, documentation-as-code.
  - `ChangePasswordAsync` (`AuthController.cs:77-92`): `[HttpPut("password")]` + `[Authorize]`; reads `CurrentUserService.UserId`, `Unauthorized()` if null, then dispatches [`ChangePasswordCommand`](#changepasswordcommand) through [`ChangePasswordHandler`](#changepasswordhandler) and the decorator pipeline; returns `204 No Content`. This is the one auth endpoint that goes through a command handler rather than the auth service.
  - `ChangePreferencesAsync` (`AuthController.cs:103-118`) and `GetPreferencesAsync` (`AuthController.cs:128-141`): the ADR-027/028 UI-preference endpoints (`[HttpPut("preferences")]` / `[HttpGet("preferences")]`), each guarded by the same `UserId` null-check and dispatching a [`ChangePreferencesCommand`](#changepreferencescommand) / `GetUserPreferencesQuery` so a returning user's culture/theme follow them across devices.
- **Why it's built this way**: sharing the login/refresh/revoke endpoints via the base avoids duplicating them per app, while the overrides keep the app-specific bits (IP capture, lockout docs, password change, preferences) co-located with the module that needs them. Every method ends in the same `result.IsFailure ? HandleFailure(...) : <success>` shape, so `ErrorType`→HTTP mapping stays in one inherited place.
- **Where it's used**: registered as an MVC controller in the Identity service host and exposed at the `/Auth` prefix by the YARP Gateway route map; the UI auth-state provider and the E2E suite drive these endpoints.
- **Caveats / not-in-source**: the Gateway `/Auth` route mapping lives in `MMCA.ADC.Gateway/Program.cs`, not in this file.

### ChangePasswordCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:16` · Level 7 · record

- **What it is**: the CQRS command that carries a user id plus the current/new password payload for a self-service password change. Handled by [`ChangePasswordHandler`](#changepasswordhandler).
- **Depends on**: the `UserIdentifierType` alias (`= int`), [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) (the request DTO, from `MMCA.Common.Shared.Auth`), [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), and (for the `CachePrefix` string) the [`User`](#user) aggregate.
- **Concept introduced, the cache-invalidating command.** `[Rubric §6, CQRS & Event-Driven]` assesses whether writes and reads are separated and whether writes correctly evict stale reads. A `sealed record` command (`ChangePasswordCommand.cs:16`) is the immutable input to exactly one handler. Implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) is the hook the `CachingCommandDecorator` reads: after the handler succeeds, the decorator evicts every cache entry whose key starts with `CachePrefix`. Here `CachePrefix => $"{typeof(User).FullName}:"` (`ChangePasswordCommand.cs:19`), so a password change flushes all cached `User` reads for consistency.
- **Walkthrough**: a positional record with `UserId` and `Request` (`ChangePasswordCommand.cs:16`); the only body member is the computed `CachePrefix` (line 19). No behavior lives here: the record is pure data, which is why the CQRS pipeline can log, validate, and cache-invalidate it uniformly.
- **Why it's built this way**: modeling the command as an immutable record keeps the write intent explicit and lets the [decorator pipeline](00-primer.md#2-architectural-styles-this-codebase-commits-to) (FeatureGate, Logging, Caching, Validating, Transactional) wrap it without the handler knowing. Declaring `ICacheInvalidating` on the command (not the handler) means the eviction policy travels with the message.
- **Where it's used**: constructed by the Identity service's users/auth controller and dispatched to [`ChangePasswordHandler`](#changepasswordhandler) through [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).

### DeleteUserCommand
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:13` · Level 7 · record

- **What it is**: the command to delete (soft-delete and erase) a user account (use case UC-21), carrying both the target user and the identity of the caller for the in-handler authorization check.
- **Depends on**: the `UserIdentifierType` alias, [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), and [`User`](#user) (for `CachePrefix`).
- **Concept reinforced, carrying the authorization subject on the command.** Unlike [`ChangePasswordCommand`](#changepasswordcommand), this record adds `CurrentUserId` and `CurrentUserRole` (`DeleteUserCommand.cs:13-16`) so the handler can enforce an owner-or-organizer rule on domain data (see [`DeleteUserHandler`](#deleteuserhandler)). The authorization *subject* rides on the message rather than being read from ambient context in the handler, which keeps the handler pure and testable. `[Rubric §11, Security]` assesses whether sensitive mutations authorize against the acting principal.
- **Walkthrough**: positional record with `UserId`, `CurrentUserId`, and `CurrentUserRole` (`string?`, nullable because a claim may be absent); the same `CachePrefix => $"{typeof(User).FullName}:"` (`DeleteUserCommand.cs:19`) evicts cached `User` reads on success.
- **Why it's built this way**: deletion is also a privacy event (anonymize-in-place, ADR-005), so the command deliberately carries only ids and a role string, not the loaded aggregate. The handler loads and mutates the aggregate itself.
- **Where it's used**: dispatched to [`DeleteUserHandler`](#deleteuserhandler) via [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).

### ModuleApplicationDbContext
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15` · Level 7 · class (abstract)

- **What it is**: the Identity module's abstract EF Core context: it declares the module's `DbSet`s and inherits every cross-cutting persistence behavior from the framework base [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Depends on**: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base), [`User`](#user) (the one entity set), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider), and `DbContextOptions`/`IServiceProvider` (EF Core, BCL).
- **Concept introduced, one context per engine over an abstract module context (ADR-006).** `[Rubric §8, Data Architecture]` assesses whether persistence is centralized rather than scattered. This class is `abstract` (`ModuleApplicationDbContext.cs:15`): it names *what* the module persists (a single `internal DbSet<User> Users`, line 22) but not *which* database engine. A concrete `SQLServerDbContext` per engine inherits from it and supplies provider-specific options, which is the database-per-service rule (ADR-006): never split the context per module, split it per engine. The primary constructor forwards all four parameters straight to the base (`ModuleApplicationDbContext.cs:15-20`), so the base's audit stamping, soft-delete query filters, and domain-event dispatch during `SaveChangesAsync` all apply to `User` for free.
- **Walkthrough**: a primary-constructor abstract class forwarding `(options, serviceProvider, assemblyProvider, physicalDataSource)` to `ApplicationDbContext` (`ModuleApplicationDbContext.cs:15-20`); the body is a single `internal DbSet<User> Users` (line 22). `internal` keeps the set inside the Infrastructure assembly: application code goes through the repository/unit-of-work abstractions, never the raw `DbSet`.
- **Why it's built this way**: the module owns only its entity declarations; every heavy behavior (audit, soft-delete, outbox, event dispatch) lives once in [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext). Each service owns its own database (`ADC_Identity`), so the Identity context never sees other modules' tables (ADR-006).
- **Where it's used**: subclassed by the per-engine `SQLServerDbContext`; the Identity migrations project and the Identity service host both boot against that concrete context.

### UserDTOMapper
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.DTOs` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:14` · Level 7 · class (sealed partial)

- **What it is**: the Mapperly-generated mapper that projects a [`User`](#user) domain entity to a [`UserDTO`](#userdto), deliberately excluding the credential fields (`PasswordHash`, `PasswordSalt`, `RefreshToken`) from the wire shape.
- **Depends on**: [`User`](#user), [`UserDTO`](#userdto), the `UserIdentifierType` alias, [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), the [`Email`](group-02-domain-building-blocks.md#email) value object, and `Riok.Mapperly.Abstractions` (NuGet source generator).
- **Concept introduced, source-generated DTO mapping (ADR-001).** `[Rubric §9, API & Contract Design]` assesses whether internal entities are kept off the API surface. The `[Mapper]` attribute plus `partial` (`UserDTOMapper.cs:13-14`) tells the Mapperly source generator to synthesize `MapToDTO` at compile time (declared `public partial UserDTO MapToDTO(User entity)`, line 18), so there is no reflection or hand-written field copying, and a compile error fires if a target member has no source. Excluding credentials is a `[Rubric §11, Security]` control: the DTO simply has no hash/salt/token members, so they can never be projected onto the wire.
- **Walkthrough**
  - `MapToDTO(User)` (`UserDTOMapper.cs:18`): the generated single-entity projection.
  - `MapToDTOs(IReadOnlyCollection<User>)` (`UserDTOMapper.cs:21-25`): a hand-written collection projection that null-checks then spreads `entityCollection.Select(MapToDTO)` into a new list.
  - `EmailToString(Email)` (`UserDTOMapper.cs:28`): a private helper the generator uses to unwrap the [`Email`](group-02-domain-building-blocks.md#email) value object to its `string` `Value` for the DTO field.
- **Why it's built this way**: Mapperly gives compile-time, allocation-light mapping with no runtime mapping engine (ADR-001); a value-object-to-string helper keeps the DTO a flat, serializable contract.
- **Where it's used**: resolved by the framework read pipeline and the Identity users controller when returning user data.

### AttendeeQueryService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` · Level 8 · class (sealed)

- **What it is**: the Identity-owned implementation of the cross-module [`IAttendeeQueryService`](#iattendeequeryservice) contract: it returns the ids of every active user with the Attendee role.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`User`](#user), [`UserRole`](#userrole), the `UserIdentifierType` alias, and [`IAttendeeQueryService`](#iattendeequeryservice).
- **Concept introduced, providing data across a module boundary through an abstraction.** `[Rubric §7, Microservices Readiness]` assesses whether cross-module needs are met through explicit contracts rather than direct entity references. The Notification module needs "every attendee's id" to fan out a broadcast, but it must not reference the Identity domain. So Identity implements the shared [`IAttendeeQueryService`](#iattendeequeryservice) interface here, and Notification depends only on that interface (in-process today, over gRPC once extracted, see [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter)).
- **Walkthrough**: `GetAttendeeUserIdsAsync` (`AttendeeQueryService.cs:14`) gets the read repository (`unitOfWork.GetReadRepository<User, UserIdentifierType>()`, line 16), then calls `GetProjectedAsync(u => u.Id, u => u.Role == UserRole.Attendee, …)` (lines 17-20) so only the id column is selected and only Attendee-role rows are returned (the global soft-delete filter excludes deleted users). The result is returned as an `IReadOnlyList`, materializing with a spread only when the projection is not already a list (line 22).
- **Why it's built this way**: projecting to `u.Id` keeps the query narrow (no full-entity load), and returning ids (not aggregates) keeps the contract transport-friendly and cheap to serialize over gRPC.
- **Where it's used**: consumed by the Notification module's recipient provider; exposed remotely by [`AttendeesGrpcService`](#attendeesgrpcservice).

### ChangePasswordHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:14` · Level 8 · class (sealed partial)

- **What it is**: the handler for [`ChangePasswordCommand`](#changepasswordcommand): it verifies the caller's current password before hashing and persisting a new one.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), `ILogger<T>`, [`User`](#user), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept reinforced, verify-then-mutate on the aggregate.** `[Rubric §11, Security]` assesses proof-of-knowledge before a credential change. The handler loads the tracked [`User`](#user), returns [`Error.NotFound`](group-01-result-error-handling.md#error) when absent, then checks the supplied current password with `passwordHasher.VerifyPassword` (`ChangePasswordHandler.cs:29`) and returns [`Error.Unauthorized`](group-01-result-error-handling.md#error) (code `"Auth.InvalidCurrentPassword"`, lines 31-32) on mismatch, before it ever hashes the new value.
- **Walkthrough**
  - Load: `unitOfWork.GetRepository<User, UserIdentifierType>()` then `GetByIdAsync(command.UserId, …)` (`ChangePasswordHandler.cs:24-25`); `null` yields `Error.NotFound.WithSource(...).WithTarget(nameof(User))` (line 27).
  - Verify: `VerifyPassword(command.Request.CurrentPassword, user.PasswordHash, user.PasswordSalt)` (line 29); failure returns the generic unauthorized error.
  - Mutate: `passwordHasher.HashPassword(command.Request.NewPassword)` yields a `(newHash, newSalt)` tuple (line 35), applied via the domain method `user.ChangePassword(newHash, newSalt)` (line 36) which returns a [`Result`](group-01-result-error-handling.md#result).
  - Persist and log: only on success does it `SaveChangesAsync` and emit the source-generated `LogPasswordChanged` message (lines 37-41, 46-47).
- **Why it's built this way**: the domain owns the state change (`User.ChangePassword`), the handler owns orchestration and authorization, and hashing lives behind [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) so the Application layer never references a crypto library. The `[LoggerMessage]` source generator (line 46) gives zero-allocation structured logging.
- **Where it's used**: invoked through the command pipeline when the profile page posts a password change.

### DeleteUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:15` · Level 8 · class (sealed partial)

- **What it is**: the handler for [`DeleteUserCommand`](#deleteusercommand): it authorizes the caller, soft-deletes the account, and irreversibly anonymizes its personal data in place (GDPR/CCPA erasure, ADR-005).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IFileStorageService`](group-07-persistence-ef-core.md#ifilestorageservice), `ILogger<T>`, [`User`](#user), [`UserRole`](#userrole), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept introduced, reconciling soft-delete with right-to-erasure (ADR-005).** `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether a soft-delete-everywhere system still has a real erasure path. This handler is the canonical answer: it calls `user.Delete()` (soft-delete, sets `IsDeleted`, revokes the refresh token per BR-56, `DeleteUserHandler.cs:41`) *and then* `user.Anonymize()` (`DeleteUserHandler.cs:52`) to overwrite PII in place. The row survives (preserving cross-context scalar references like bookmarks and the audit trail) but the personal data is destroyed, honoring the PRIVACY.md "delete within 30 days" promise. `[Rubric §11, Security]` also applies: authorization is enforced in the handler (`command.CurrentUserId != command.UserId && !UserRole.IsOrganizer(command.CurrentUserRole)` returns [`Error.Forbidden`](group-01-result-error-handling.md#error), lines 26-33), a case-insensitive owner-or-organizer rule on domain data.
- **Walkthrough**
  - Authorize: owner-or-organizer check first; a stranger without the Organizer role gets `Error.Forbidden` (`DeleteUserHandler.cs:26-33`).
  - Load: `GetByIdAsync` then `Error.NotFound` if absent (lines 36-38).
  - Soft-delete: `user.Delete()`; short-circuit on failure (lines 41-43).
  - Capture avatar: before erasure clears the URL, `SetUserAvatarHandler.TryGetBlobName(user.AvatarUrl)` records the blob name (`DeleteUserHandler.cs:47`), because the avatar photo is personal data too (BR-116a). See [`SetUserAvatarHandler`](#setuseravatarhandler).
  - Erase: `user.Anonymize()`; short-circuit on failure (lines 52-54).
  - Persist then clean up: `SaveChangesAsync`, then `fileStorage.DeleteAsync(avatarBlobName, …)` only after the erasure is committed (lines 56-61), and finally the source-generated `LogUserErased` (lines 63, 68).
- **Why it's built this way**: ordering matters. The avatar blob name is captured before `Anonymize` clears the URL, and the blob is deleted only after the DB commit succeeds, so a mid-operation failure never orphans the record against a deleted photo. Anonymize-in-place (over hard-delete) is ADR-005's resolution of the soft-delete-vs-erasure tension.
- **Where it's used**: invoked from the account-deletion endpoint behind the Identity users controller.

### IdentityModuleDbSeeder
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:16` · Level 8 · class

- **What it is**: the idempotent development/test seeder that creates default organizer and attendee accounts after the Identity schema is initialized.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), the framework [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) base (see also [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder)), [`User`](#user), [`UserRole`](#userrole), and the [`Email`](group-02-domain-building-blocks.md#email) value object.
- **Concept introduced, idempotent module seeding.** `[Rubric §17, DevOps]` assesses reproducible environment bootstrap. `SeedAsync` (`IdentityModuleDbSeeder.cs:25`) runs three private seed methods (organizer, attendee, test attendee, lines 27-29); each one first calls `repository.ExistsAsync(u => u.Email == …)` and returns early if the account is present (e.g. lines 37-42), so re-running the seeder on an existing database is a no-op. Every account is created through the `User.Create(…)` factory (line 45), so seeded rows obey the same invariants as production ones, and a factory failure is swallowed rather than throwing (lines 47-48). The constructor guards both dependencies with `ArgumentNullException`-style null checks (lines 21-22).
- **Walkthrough**: three near-identical methods differing only in the email, name, password, and role: `SeedOrganizerUserAsync` (`admin@adc.com`, Organizer, `IdentityModuleDbSeeder.cs:32-52`), `SeedAttendeeUserAsync` (Attendee, lines 54-74), and `SeedTestAttendeeUserAsync` (`customer@adc.com`, Attendee, lines 76-96). Each hashes its password via [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), creates the user, adds it through the repository, and saves.
- **Why it's built this way**: seeding through the same `User.Create` factory and repository as the app keeps dev data valid and the operation replay-safe. The XML `<remarks>` (lines 11-15) warns loudly that the seed credentials (`"Admin123!"`, `"Password"`) are intentionally weak and for local development only: production must disable seeding or supply environment-sourced secrets. `[Rubric §11, Security]` is the flag here (the weak-password caveat is called out in source).
- **Where it's used**: run by the Identity module's registration during database initialization (the module's `SeedAsync`), after migrations apply.
- **Caveats / not-in-source**: the seeder is `public class` (not sealed) and does not itself gate on environment; the "disable in production" decision is enforced by the host's init strategy, not this type.

### SoftDeletedUserValidator
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/SoftDeletedUserValidator.cs:10` · Level 8 · class (sealed)

- **What it is**: the Identity-owned implementation of [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (BR-133): it answers whether a given user has been soft-deleted, bypassing the global query filter that normally hides such rows.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`User`](#user), the `UserIdentifierType` alias, and [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator).
- **Concept reinforced, module-owned data behind a cross-cutting policy.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether shared policy and module-owned data are cleanly separated. The `SoftDeletedUserMiddleware` (in the shared API layer) enforces the *policy* "a token belonging to a deleted account is rejected"; this class supplies the *data* that answers it, without the middleware ever touching the Identity domain.
- **Walkthrough**: `IsUserSoftDeletedAsync` (`SoftDeletedUserValidator.cs:14`) runs one `repository.ExistsAsync(u => u.Id == userId && u.IsDeleted, ignoreQueryFilters: true, …)` (lines 21-24). The `ignoreQueryFilters: true` is essential: the default soft-delete filter would make deleted users invisible, so the check must deliberately look past it to see them.
- **Why it's built this way**: a single existence query (not a full load) is the cheapest way to answer a per-request auth question, and pushing it behind an interface lets the middleware live in shared code (ADR-006 keeps the Identity data source private to Identity).
- **Where it's used**: consumed by `SoftDeletedUserMiddleware` on every authenticated request in the Identity service pipeline.

### SpeakerLinkedToUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20` · Level 8 · class (sealed partial)

- **What it is**: the Identity-side integration-event consumer that completes the bidirectional User to Speaker link: when Conference publishes [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser), this handler sets `User.LinkedSpeakerId` (BR-209).
- **Depends on**: `IServiceScopeFactory`, [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger<T>`, [`User`](#user), the `SpeakerIdentifierType` alias, [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser), and [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent).
- **Concept introduced, the idempotent integration-event handler.** `[Rubric §6, CQRS & Event-Driven]` assesses whether asynchronous consumers tolerate at-least-once delivery. Because the outbox/broker can redeliver an event (ADR-003), the handler must be safe to run twice: it loads the user and returns early if `user.LinkedSpeakerId == integrationEvent.SpeakerId` (`SpeakerLinkedToUserHandler.cs:43-46`), so a duplicate delivery is a no-op. `[Rubric §7, Microservices Readiness]`: the link is a two-database fact (User lives in `ADC_Identity`, Speaker in `ADC_Conference`) kept consistent by events, not a cross-database foreign key.
- **Walkthrough**: `HandleAsync` (`SpeakerLinkedToUserHandler.cs:25`) null-checks the event, opens a per-event async scope (`scopeFactory.CreateAsyncScope()`, line 31) to resolve a fresh [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), loads the user (line 35; logs and returns if missing, lines 36-40), applies the change via the domain method `user.LinkSpeaker(integrationEvent.SpeakerId)` (line 48), and saves (line 49). The whole body is wrapped in a best-effort `try/catch` that excludes `OperationCanceledException` (lines 53-56), so a transient failure is logged rather than crashing the consumer. Three `[LoggerMessage]` source-generated methods cover not-found, linked, and error (lines 59-66).
- **Why it's built this way**: the doc comment (`SpeakerLinkedToUserHandler.cs:13-18`) states this is the *only* place that mutates `User.LinkedSpeakerId` in response to a Conference-side change, replacing a former direct cross-module service call, so the link is always applied through one consistent code path. Opening its own DI scope keeps a broker-dispatched handler independent of any request scope.
- **Where it's used**: registered as a broker consumer in the Identity service host; its mirror is [`SpeakerUnlinkedFromUserHandler`](#speakerunlinkedfromuserhandler).

### SpeakerUnlinkedFromUserHandler
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:19` · Level 8 · class (sealed partial)

- **What it is**: the mirror of [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler): on [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) it clears `User.LinkedSpeakerId` on the Identity side (triggered by an explicit unlink command or by cascade cleanup when a Speaker is soft-deleted, BR-70).
- **Depends on**: identical to its sibling: `IServiceScopeFactory`, [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger<T>`, [`User`](#user), the `SpeakerIdentifierType` alias, [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser), and [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent).
- **Concept reinforced, idempotent event handling** (introduced at [`SpeakerLinkedToUserHandler`](#speakerlinkedtouserhandler)). `[Rubric §6, CQRS & Event-Driven]`. The idempotency guard here is the inverse: return early when `!user.LinkedSpeakerId.HasValue` (`SpeakerUnlinkedFromUserHandler.cs:41-45`), so a redelivered unlink for an already-cleared user does nothing.
- **Walkthrough**: `HandleAsync` (`SpeakerUnlinkedFromUserHandler.cs:24`) follows the same shape, opening an async scope (line 30), loading the user (line 34), skipping when already cleared (line 41), calling `user.UnlinkSpeaker()` (line 47), saving (line 48), and wrapping in the same `OperationCanceledException`-excluding `try/catch` (lines 52-55). Three `[LoggerMessage]` methods mirror the link handler (lines 58-65).
- **Why it's built this way**: keeping link and unlink as two single-responsibility handlers (rather than one branching handler) keeps each one trivial to reason about and re-deliver-safe; the doc comment (lines 14-17) notes it replaces a former direct cross-module call.
- **Where it's used**: registered alongside its sibling as a broker consumer in the Identity service host.

### UserConfiguration
> MMCA.ADC.Identity.Infrastructure · `MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12` · Level 8 · class (internal sealed)

- **What it is**: the richest EF Core entity configuration in the ADC codebase: it maps the [`User`](#user) aggregate, including value-object conversion, device metadata, external-auth fields, per-user UI preferences, the avatar URL, and four indexes.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base), [`User`](#user), [`UserInvariants`](#userinvariants) (the max-length constants), the [`Email`](group-02-domain-building-blocks.md#email) value object, and EF Core's `EntityTypeBuilder`.
- **Concept reinforced, invariant-driven schema and converted value objects.** `[Rubric §8, Data Architecture]` assesses whether the physical schema mirrors domain rules. Field lengths are read from [`UserInvariants`](#userinvariants) (e.g. `EmailMaxLength`, `FirstNameMaxLength`, `DeviceFieldMaxLength`), so the column widths and the domain validators share one source of truth. [`Email`](group-02-domain-building-blocks.md#email) is persisted via `HasConversion(e => e.Value, v => Email.Create(v).Value!)` (`UserConfiguration.cs:20-23`), storing the flat string while reconstructing the value object on read (the `!` is safe because a stored value already passed creation).
- **Walkthrough**
  - `base.Configure(builder)` (`UserConfiguration.cs:18`) first applies the framework conventions (keys, audit columns, soft-delete filter, concurrency token).
  - `Email` (lines 20-26): value-object conversion, `HasMaxLength(UserInvariants.EmailMaxLength)`, `IsUnicode(false)` (ASCII `varchar`), required.
  - `FirstName`/`LastName` (lines 28-36): invariant-bounded, ASCII, required.
  - `PasswordHash`/`PasswordSalt` (lines 41-43): `byte[]` mapped to `varbinary(max)` with no explicit length; the comment notes external-login users store empty arrays (BR-204).
  - `Role` (lines 45-48): `varchar(50)`, required.
  - `RefreshToken` (lines 51-53): nullable `varchar(256)`, null when revoked or never issued (BR-205).
  - Device metadata (lines 62-88): seven optional MAUI-only fields, each `UserInvariants.DeviceFieldMaxLength` (BR-201/202).
  - External auth (lines 91-97): `LoginProvider` (50) and `ProviderKey` (256), nullable for local accounts.
  - UI preferences (lines 100-106): `PreferredCulture`/`PreferredTheme`, nullable `varchar(10)` (ADR-027/028).
  - `AvatarUrl` (lines 109-111): nullable `varchar(512)` (BR-116a, ADR-045).
  - Ignored computed members (lines 114-115): `FullName` and `IsExternalLogin` have no columns.
  - Four indexes (lines 117-128): unique on `Email` (login lookup); filtered-unique on `RefreshToken` where NOT NULL (one live refresh token per user); filtered-unique on `LinkedSpeakerId` where NOT NULL (1:1 User to Speaker, BR-208/209); filtered-unique composite on `(LoginProvider, ProviderKey)` where both NOT NULL (one external identity per user).
- **Why it's built this way**: `[Rubric §11, Security]` (unique refresh-token and provider-key indexes prevent token reuse and account confusion); the filtered unique indexes let the "at most one when present" rules coexist with nullable columns, which the domain invariants alone cannot enforce at the storage level.
- **Where it's used**: discovered and applied by the Identity module's `SQLServerDbContext` model build (auto-scanned via the entity-configuration assembly provider); `internal sealed` keeps it inside the Infrastructure assembly.

### AttendeeQueryServiceGrpcAdapter
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14` · Level 9 · class (sealed)

- **What it is**: the client-side adapter that implements the in-process [`IAttendeeQueryService`](#iattendeequeryservice) interface on top of the generated gRPC client, so a consumer (Notification) can call the extracted Identity service without changing its code.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice), the `UserIdentifierType` alias, and the proto-generated `AttendeeQueryService.AttendeeQueryServiceClient` (from `attendee_query.proto`).
- **Concept introduced, the gRPC adapter behind a shared interface (ADR-007).** `[Rubric §7, Microservices Readiness]` assesses whether a module can be extracted without a rewrite. Consumers keep depending on the C# interface from `MMCA.ADC.Identity.Shared`; at the composition root the in-process implementation ([`AttendeeQueryService`](#attendeequeryservice)) is swapped for this adapter once Identity runs as its own service. The call site never learns the transport changed, which is the Strangler Fig extraction pattern (ADR-008).
- **Walkthrough**: `GetAttendeeUserIdsAsync` (`AttendeeQueryServiceGrpcAdapter.cs:18`) sends `new GetAttendeeUserIdsRequest()` to `client.GetAttendeeUserIdsAsync` (lines 21-23), then materializes the proto `RepeatedField` with a spread `[.. response.UserIds]` (line 27) into a plain `IReadOnlyList` so callers never leak the generated type. The comment (lines 25-27) notes that because `UserIdentifierType = int`, the projection is a no-op cast.
- **Why it's built this way**: hand-writing the adapter (rather than exposing the generated client) keeps the module's public surface the framework interface, not a proto type, so nothing downstream binds to gRPC specifics.
- **Where it's used**: registered in place of the in-process service by [`DependencyInjection.AddIdentityAttendeeClient`](#dependencyinjection) in the Notification service host; the server end is [`AttendeesGrpcService`](#attendeesgrpcservice).
- **Caveats / not-in-source**: this contract returns a plain list, not a [`Result`](group-01-result-error-handling.md#result), so a transport fault surfaces as an `RpcException` handled by the Polly resilience pipeline rather than a `Result` failure.

### AttendeesGrpcService
> MMCA.ADC.Identity.Service · `MMCA.ADC.Identity.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19` · Level 9 · class (sealed)

- **What it is**: the server-side gRPC endpoint that exposes the in-process [`IAttendeeQueryService`](#iattendeequeryservice) over the wire to consumer services (Notification). It is the mirror image of [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice) (the injected `inner`), the proto-generated `AttendeeQueryService.AttendeeQueryServiceBase`, and `Grpc.Core.ServerCallContext`.
- **Concept reinforced, the server bridge and centralized error translation.** `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]`. The service subclasses the generated base and delegates straight to the registered in-process implementation, so the same business logic serves both in-process and remote callers. Errors are not translated here: the doc comment (`AttendeesGrpcService.cs:11-17`) notes that any [`ResultFailureException`](group-13-grpc-contracts.md#resultfailureexception) is converted to an `RpcException` with the right status code by the shared [`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) server interceptor, keeping error mapping in one place.
- **Walkthrough**: `GetAttendeeUserIds` (`AttendeesGrpcService.cs:23`) null-checks `request` and `context` (lines 27-28), delegates to `inner.GetAttendeeUserIdsAsync(context.CancellationToken)` (line 30), then builds a `GetAttendeeUserIdsResponse` and populates it with `response.UserIds.AddRange(userIds)` (lines 32-33). No `Result` handling: the operation returns a plain id list.
- **Why it's built this way**: a thin server that only marshals to and from the proto types keeps the transport layer free of business logic and lets the module's interface stay the single implementation of record.
- **Where it's used**: mapped as a gRPC endpoint in the Identity service host's `Program.cs`; its remote peer is [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter).

### AuthenticationService
> MMCA.ADC.Identity.Application · `MMCA.ADC.Identity.Application.Users` · `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:22` · Level 9 · class (sealed)

- **What it is**: ADC's authentication service. The shared login/registration/refresh/revocation workflow lives in the framework base [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser); this subclass supplies only the ADC-specific pieces (the Attendee default role, the `speaker_id` claim, the post-commit [`UserRegistered`](#userregistered) event, and the external OAuth flow).
- **Depends on**: [`AuthenticationServiceBase<User>`](group-08-auth.md#authenticationservicebasetuser) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ITokenService`](group-08-auth.md#itokenservice), [`IPasswordHasher`](group-08-auth.md#ipasswordhasher), [`ILoginProtectionService`](group-08-auth.md#iloginprotectionservice), [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher), `TimeProvider`, [`AuthenticationValidators`](group-08-auth.md#authenticationvalidators), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice), [`User`](#user), [`UserRole`](#userrole), the [`Email`](group-02-domain-building-blocks.md#email) value object, [`RegisterRequest`](group-08-auth.md#registerrequest), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`Result`](group-01-result-error-handling.md#result), and [`UserRegistered`](#userregistered).
- **Concept introduced, the Template Method pattern for authentication.** `[Rubric §1, SOLID]` (open-closed via inheritance) and `[Rubric §11, Security]`. The heavy, security-critical algorithm (validate-first, the ADR-029 lockout and rate limits, the dual-fetch pattern for password verification, and the BR-205/206 refresh-token rotation with reuse detection) is written once in [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser); ADC customizes it purely by overriding a handful of `protected` hooks, so no consumer reimplements the token dance. The class re-lists [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (`AuthenticationService.cs:31`) so its `ExternalLoginAsync` re-implements the interface's default member.
- **Walkthrough** (the ADC-specific overrides and the OAuth path)
  - `FindUntrackedByEmailAsync` (`AuthenticationService.cs:34-42`): reads a user untracked by email, the read half of the dual-fetch.
  - `EmailExistsAsync` (lines 46-47): duplicate-email check with `ignoreQueryFilters: true` so a soft-deleted (erased) account's email cannot be re-registered.
  - `CreateUser` (lines 50-57): builds a new [`User`](#user) via `User.Create(…, UserRole.Attendee)`, the BR-45 default role.
  - `CreateAccessToken` (lines 60-61): signs a token carrying `SpeakerClaims(user.LinkedSpeakerId)`.
  - `OnUserRegisteredAsync` (lines 70-76): publishes [`UserRegistered`](#userregistered) *after* the commit (so the EF-generated id is populated), which Conference consumes to run the speaker email-match auto-link (BR-207); the first token deliberately does not yet carry `speaker_id` (eventual consistency).
  - `ExternalLoginAsync` (lines 88-159): the OAuth flow. It looks up by `LoginProvider` + `ProviderKey`; if absent it either links the provider to an existing same-email account (`LinkExternalProvider`, line 120) or creates a fresh account via `User.CreateExternal` (line 126). It rotates a refresh token, saves, publishes [`UserRegistered`](#userregistered) only for brand-new external users (lines 146-151), and returns an [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) with a 15-minute access token and 7-day refresh token.
  - `SpeakerClaims` (lines 164-165): emits the `speaker_id` claim only when a speaker is linked (BR-209), the claim Conference checks for speaker self-edit authorization.
- **Why it's built this way**: keeping the credential algorithm in the shared base (ADR-029 lockout, refresh rotation, reuse detection) means every consuming app gets the same hardened flow; ADC's differences (default role, speaker claim, registration event, OAuth) are the only things that vary, so they are the only things overridden. Publishing [`UserRegistered`](#userregistered) over the outbox (rather than calling Conference directly) keeps Identity a leaf module (ADR-004 for token validation via JWKS, events for coordination).
- **Where it's used**: injected behind the Identity service's auth/OAuth controllers; tokens it signs are validated cross-service via JWKS discovery (ADR-004).

### DependencyInjection
> MMCA.ADC.Identity.Contracts · `MMCA.ADC.Identity.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14` · Level 10 · class (static)

- **What it is**: the one-method DI facade a consumer host (Notification) calls to swap the in-process [`IAttendeeQueryService`](#iattendeequeryservice) registration for the gRPC-backed [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter) pointing at the extracted Identity service.
- **Depends on**: [`IAttendeeQueryService`](#iattendeequeryservice), [`AttendeeQueryServiceGrpcAdapter`](#attendeequeryservicegrpcadapter), the proto-generated client, and `MMCA.Common.Grpc`'s `AddTypedGrpcClient`.
- **Concept introduced, the gRPC adapter-swap registration (ADR-007/008).** `[Rubric §7, Microservices Readiness]` and `[Rubric §16, Maintainability]`. The method is a C# `extension(IServiceCollection)` member (`DependencyInjection.cs:16`), the codebase's idiom for DI registration. It does two things (lines 43-49): `AddTypedGrpcClient<AttendeeQueryService.AttendeeQueryServiceClient>(serviceName)` wires the generated client through Aspire service discovery (`http://{serviceName}`), the JWT-forwarding interceptor, and the Polly retry/circuit-breaker pipeline; then `services.Replace(ServiceDescriptor.Scoped<IAttendeeQueryService, AttendeeQueryServiceGrpcAdapter>())` overwrites whichever registration is already present. `Replace` (not `TryAdd`) is deliberate (doc comment, lines 25-37): the container may already hold the real in-process [`AttendeeQueryService`](#attendeequeryservice) *or* the `DisabledAttendeeQueryService` stub, and the adapter must win in both cases, so this must be called *after* `ModuleLoader.DiscoverAndRegister`.
- **Walkthrough**: `AddIdentityAttendeeClient(string serviceName = "identity")` (`DependencyInjection.cs:41`): the `serviceName` default matches the AppHost resource name, so the common call site passes no argument. Returns the collection for chaining (line 49).
- **Why it's built this way**: making extraction a single DI-swap (not a code change at every call site) is the whole point of ADR-007/008: the in-process binding and the remote binding share one interface. `[Rubric §33, Developer Experience]`: the defaulted `serviceName` means zero-config for the normal case.
- **Where it's used**: called from the Notification service host's `Program.cs` after module discovery; it is the exact sibling of the Conference and Engagement `Contracts.DependencyInjection` facades.


---
[⬅ ADC Engagement Live Layer (Real-Time Polls & Session Q&A)](group-23-engagement-live-layer.md)  •  [Index](00-index.md)  •  [ADC Application Host, UI Shell & Cross-Module Composition ➡](group-25-adc-host-composition.md)
