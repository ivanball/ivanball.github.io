# Finishing Identity: Second Factor, Email Confirmation and Stored Permission Grants

> Series: MMCA.Common · Article #52 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-116 · ADR-091 · ADR-139 ·
> Status: grounded in `Website/docs-src/adr/116-identity-completions-opt-in.md`,
> `Website/docs-src/adr/091-cache-backed-password-reset.md`,
> `Website/docs-src/adr/139-passkeys-webauthn-opt-in-sign-in.md`,
> `MMCA.Common/.../Application/Auth/AuthenticationServiceBase.cs`,
> `.../Application/Auth/AuthenticationValidators.cs`,
> `.../Application/Auth/TwoFactor/TwoFactorSettings.cs`,
> `.../Application/Auth/EmailConfirmation/EmailConfirmationSettings.cs`,
> `.../Application/Auth/Permissions/PermissionGrantSettings.cs`,
> `.../Application/Auth/Legal/LegalAcceptancePolicy.cs`,
> `.../Application/Auth/Legal/LegalAcceptanceOptions.cs`,
> `.../Application/Auth/Passkeys/PasskeyStepUp.cs`,
> `.../Domain/Auth/ILegalAcceptingUser.cs`,
> `.../Shared/Auth/AuthClaimTypes.cs`,
> `.../Infrastructure/DependencyInjection.Auth.cs`,
> `.../Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`,
> `.../Infrastructure/Persistence/Auth/PermissionGrantModelGate.cs`,
> `.../Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs`,
> `.../Passkeys/PasskeysServiceCollectionExtensions.cs`,
> `.../API/Controllers/Administration/RolesAdminControllerBase.cs`,
> `.../API/Controllers/Administration/UsersAdminControllerBase.cs`,
> `.../API/Controllers/Legal/LegalAcceptanceControllerBase.cs`,
> `.../API/Controllers/Passkeys/PasskeysControllerBase.cs`,
> `.../UI/Pages/Auth/ConfirmEmail.razor`, `.../UI/Pages/Auth/TwoFactor/TwoFactorAccount.razor`,
> `.../UI/Components/Legal/TermsAcceptanceGate.razor.cs`,
> `.../Infrastructure/Auth/PasswordResetTokenService.cs`,
> `.../Infrastructure/Auth/EmailConfirmationTokenService.cs`,
> `.../Application/Auth/PasswordResetSettings.cs`,
> `.../Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs`,
> `.../API/Controllers/PasswordResetAuthControllerBase.cs`,
> the two consumers' Identity service hosts, and the §11 row of
> `Website/docs-src/governance/common-ArchitectureScorecard.md`.
> No em dashes.

**Subtitle:** A framework that owns sign-in for two deployed apps cannot add a second factor by
adding a step. Here is how a TOTP challenge, an email-confirmation gate, operator-editable permission
grants and versioned Terms of Service acceptance arrive as optional constructor arguments, a marker
type, a decorator and an unset setting, so a consumer that adopts none of them observes nothing at
all.

---

There is a moment in every shared authentication library where the interesting work is done and the
awkward work is left. The framework already owns sign-in: password verification, brute-force
protection, refresh-token rotation with reuse detection, the claims the token carries. Two
production apps run their login through that one base class. Then somebody asks for a second factor.

The natural move is to add a step. Query the user's two-factor state, branch, challenge, continue.
It is ten lines, and every one of them executes in both deployed apps the moment the package is
restored, including the app that never asked for two-factor and has no column to answer the query
from.

That is the actual problem this article is about, and it is not a cryptography problem. Five
capabilities were missing from the framework's identity story: a second authentication factor, email
confirmation, permission grants an operator can change without a deploy, a user and role
administration API, and a record of which version of the Terms of Service each user accepted. Each
of them is easy to write and dangerous to insert. **ADR-116** is the record of inserting them anyway,
without changing the behavior of anything already deployed. The same ADR records a sixth completion
of the same shape, emailed sign-in links (item 14, `ADR-116:318`), which this article leaves to the
ADR; passkeys (**ADR-139**) are a further opt-in of the shape and get their own section below.

The series has already covered the pieces these plug into: Article 16 for cross-service token
validation, Article 24 for permission-based authorization and its compiled registry, Article 27 for
the rotating refresh token and the sign-in pipeline the new claim rides on. This article is about
what it costs to extend those without breaking them.

## Why it matters

Rubric §11 (Security) is a weight-3 category asking that authentication be centralized and identity
flows documented, that authorization be enforced at the right layer rather than in the UI, and that
permissions follow least privilege, with "over-broad permissions (admin everywhere), no least
privilege" as a named red flag (`ArchitectureEvaluationCriteria.md:353-376`). MMCA.Common's §11 row
sits at Maturity 4 and Implementation 8 (`common-ArchitectureScorecard.md:76`), and the two
capabilities most often missing from the band above it are exactly a step-up factor and an
authorization model that can be adjusted without a release.

But there is a second thing at stake, and it is the one that decides the design. A shared framework
is a system with users who cannot review your diff. Adding a mandatory query to a sign-in path is
not a feature in a library, it is a behavior change in somebody else's production, delivered by a
version bump. The framework's own history is the argument: the 1.188.0 release needed an
`UPGRADING.md` section with eight items, one of which (a fallback authorization policy) broke
unannotated endpoints (`ADR-116:61-65`).

So the question is not "how do I implement TOTP." It is "how do I ship TOTP so that the app which
does not want it cannot possibly be affected by it."

## The MMCA answer: the unadopted path is unreachable, not merely disabled

`AuthenticationServiceBase<TUser>` takes the two new collaborators as constructor parameters, both
optional and both defaulted to null: `ITwoFactorAuthenticator? twoFactor = null` and
`IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null`
(`AuthenticationServiceBase.cs:80-81`). Every existing subclass keeps compiling, because it simply
passes fewer arguments. A host that adopts two-factor does not have to pass the authenticator either:
`AuthenticationValidators`, the parameter object every subclass already passes, has a second
constructor taking an `ITwoFactorAuthenticator`, which the container picks only when one is
registered (`AuthenticationValidators.cs:32-51`), and exposes it as `TwoFactor`, null otherwise
(`:68-73`). The documentation on the base parameter says what that leaves: "While it is null the
challenge comes from `AuthenticationValidators.TwoFactor` ... with neither, the sign-in flow has no
second-factor step at all. An explicit argument wins" (`AuthenticationServiceBase.cs:62-68`).

That is not the same as a configuration flag, and the difference is the whole point.
`ChallengeSecondFactorAsync` is a single expression: it takes the constructor argument, else the
one the validators carry, and with neither returns `TwoFactorOutcome.NotEnrolled` outright, only
otherwise delegating to the authenticator's `ChallengeAsync` (`:858-864`). An unadopted consumer
pays no query and no allocation. A disabled feature has a code path that runs and decides to do
nothing; an absent collaborator has no code path at all. Only the second one is safe to ship to a
system you cannot test.

The email gate is built the same way. `CheckEmailConfirmed` returns success immediately unless the
host supplied settings with `RequireConfirmedEmail` set, and even then refuses only a user whose type
implements `IEmailConfirmableUser` and reports `IsEmailConfirmed: false` (`:832-842`). Two
independent conditions, both off by default, one of them a type test the app controls. The same
virtual gate decides registration: when it would refuse the new account, `RegisterAsync` answers
`RegistrationOutcome.ConfirmationPending` and opens no session (`:387-393`), so an override moves
both together.

**Where the two gates sit in the login sequence is a decision, not an accident.** Both run after the
password has been proved: `CheckEmailConfirmed` at `:239`, the second-factor challenge at `:248`,
under a comment that gives the reason (`:235-238`). They return distinct, actionable errors ("confirm
your address", "send a code"), and an actionable error is an information leak if an anonymous caller
can trigger it. Reaching either gate proves the caller owns the account, so neither is readable by
somebody sweeping addresses.

Login reaches the challenge through a private wrapper, `ChallengeSecondFactorCountingFailuresAsync`
(`:876-889`), which counts a wrong code against the account exactly like a wrong password, so the
same lockout that throttles password guessing throttles code guessing per account. A missing code is
the ordinary first leg of the challenge and is not counted (`:866-870`). For an app with no
authenticator the wrapper costs nothing either: the inner call answers `NotEnrolled`, which is not a
failure, and no counter is touched.

## The step-up assertion is a claim, and presence is the whole test

A challenge that is satisfied has to be recorded somewhere the rest of the system can read. The
framework stamps an `amr`-style claim: `AuthClaimTypes.MultiFactor` is the literal `mfa`
(`AuthClaimTypes.cs:63`), and its value names the method that satisfied the challenge, `otp` for a
time-based code (`:66`), `recovery` for a single-use recovery code (`:69`) or `passkey` for a WebAuthn
sign-in (`:76`, covered below).

Three details make this cheap to adopt.

**The claim is stamped without the app's hook participating.** `LoginAsync` arms a private field with
the outcome (`AuthenticationServiceBase.cs:277`) and clears it in a `finally` (`:285`); the token is
minted through `CreateAccessTokenForSession`, which hands that field and the sign-in instant to the
session issuer's `MintForSession`, and the issuer appends `mfa` (and `auth_time`) to whatever claim
set the app's `CreateAccessToken` returned (`:803-817`, `:821-822`). No subclass signature changed,
so no consumer edits a method to start emitting `mfa`.

**A rotation does not silently drop it.** `RefreshTokenAsync` reads the method back off the presented
token (`:450`) and carries it into the new one, then clears the field in a `finally` (`:468-472`).
Without that, a step-up would quietly expire at the next refresh and a user who did present a second
factor would look like one who never had.

**Presence is the assertion, and absence denies.** A token for an account with no second factor
carries no `mfa` claim at all, so a request marked `IRequiresMfa` denies that caller rather than
degrading to a role check (`AuthClaimTypes.cs:49-62`). There is no "this account has no second
factor, so let it through" branch anywhere, which is the branch that turns a step-up requirement into
a suggestion.

One more small thing worth stealing. The map from outcome to claim value has a default case that
returns null with a comment explaining it: an outcome the map has not been taught about means the
enum grew and this method did not, and it must not silently mint an `mfa` claim
(`AuthenticationServiceBase.cs:897-906`, the unknown arm at `:903-905`). A switch over an enum whose
unknown arm asserts an identity fact is a vulnerability waiting for its next contributor.

```csharp
// Illustrative of the documented shape: the two gates and the optional collaborator.
public abstract class AuthenticationServiceBase<TUser>(
    // ... the five collaborators every consumer already passes, AuthenticationValidators validators among them ...
    ITwoFactorAuthenticator? twoFactor = null,
    IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null) : IAuthenticationService
{
    // Both gates run AFTER the password check: they return actionable errors, and reaching
    // them proves the caller owns the account, so neither is readable by an address sweep.
    var confirmationResult = CheckEmailConfirmed(untracked);
    if (confirmationResult.IsFailure)
        return SignInFailed(
            AuthSignInMetrics.EmailNotConfirmed,
            request.Email,
            Result.Failure<AuthenticationResponse>(confirmationResult.Errors));

    var secondFactor = await ChallengeSecondFactorCountingFailuresAsync(
        untracked.Id, request, cancellationToken);
    if (secondFactor.IsFailure)
        return SignInFailed(
            AuthSignInMetrics.ForSecondFactorFailure(secondFactor.Errors),
            request.Email,
            Result.Failure<AuthenticationResponse>(secondFactor.Errors));

    // The constructor argument wins, else the validators' one. With neither there is no
    // challenge and no extra query.
    protected virtual Task<Result<TwoFactorOutcome>> ChallengeSecondFactorAsync(
        UserIdentifierType userId, string? code, CancellationToken cancellationToken) =>
        (twoFactor ?? validators.TwoFactor) is not { } authenticator
            ? Task.FromResult(Result.Success(TwoFactorOutcome.NotEnrolled))
            : authenticator.ChallengeAsync(userId, code, cancellationToken);

    // A wrong code counts toward lockout like a wrong password; a missing code does not.
    private async Task<Result<TwoFactorOutcome>> ChallengeSecondFactorCountingFailuresAsync(
        UserIdentifierType userId, LoginRequest request, CancellationToken cancellationToken)
    {
        var secondFactor = await ChallengeSecondFactorAsync(userId, request.TwoFactorCode, cancellationToken);
        if (secondFactor.IsFailure && secondFactor.Errors.Any(e => e.Code == TwoFactorErrors.TwoFactorInvalidCode))
            await loginProtection.IncrementFailedAttemptsAsync(request.Email, cancellationToken);

        return secondFactor;
    }

    // Off unless the host set RequireConfirmedEmail AND the app's User implements the contract.
    protected virtual Result CheckEmailConfirmed(TUser untrackedUser)
    {
        if (emailConfirmationSettings?.Value.RequireConfirmedEmail != true)
            return Result.Success();

        return untrackedUser is IEmailConfirmableUser { IsEmailConfirmed: false }
            ? Result.Failure(EmailConfirmationErrors.EmailNotConfirmed(nameof(LoginAsync)))
            : Result.Success();
    }
}
```

## The framework ships no user table, on purpose

`ITwoFactorService` is stateless cryptography: secrets, provisioning URIs, verification inside a skew
window, recovery codes. `ITwoFactorStore` is the persistence, and the consumer writes it, over its
own `User` aggregate. The DI call is explicit about the split: it "deliberately registers no
`ITwoFactorStore`", because the account's secret and recovery hashes belong to the app's own
aggregate (`Infrastructure/DependencyInjection.Auth.cs:31-34`).

This is the same trade the framework already made for password material and for user lookups, and
ADR-116 states the reason plainly: the two deployed apps model users differently, and a
framework-owned user table would either be too thin to use or force columns an app has no place for
(`ADR-116:54-59`). Every consumer that wants two-factor writes one class. That is deliberate
duplication, bought on purpose.

The settings carry the RFC 6238 defaults every authenticator app assumes: six digits, a thirty-second
step (`TwoFactorSettings.cs:34`), one step of tolerated skew on each side, which widens the accepted
window to roughly ninety seconds (`:46`), ten single-use recovery codes (`:50`), and a twenty-byte
shared secret, the RFC 4226 recommendation (`:61`). They are configurable because a host may have to
match an existing enrollment base, not because moving them is a good idea: an authenticator app keyed
against one period cannot read codes minted with another (`:9-14`).

Email confirmation reuses the password-reset design rather than inventing one, down to the record
shape, the hashing, the attempt cap and the throttle, under its own key prefix so issuing a
confirmation link cannot invalidate an outstanding reset link (`ADR-116:125-137`). And
`RequireConfirmedEmail` defaults to false, with the reason written next to it: turning it on locks
out every existing account whose address was never confirmed, so a host backfills its rows as
confirmed first and flips the flag afterwards (`EmailConfirmationSettings.cs:47-55`). With it off the
whole capability is additive: tokens are issued and redeemed, and nothing about who can sign in
changes.

Above both sit handler bases the apps derive from rather than reimplement:
`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>` (`:39`), `DisableTwoFactorHandlerBase<TCommand>`
(`:36`), `RegenerateRecoveryCodesHandlerBase<TCommand>` (`:36`),
`SendEmailConfirmationHandlerBase<TUser, TCommand>` (`:51`) and
`ConfirmEmailHandlerBase<TUser, TCommand>` (`:33`).

## Stored grants: operator-editable, and structurally unable to deny

Article 24 covered the compiled permission registry: a frozen role-to-permission map, consulted by
the CQRS authorization decorators and the `[HasPermission]` policy. It has one operational weakness.
Changing who can do what is a deploy.

Stored grants layer over it. `LayeredPermissionRegistry` decorates whatever `IPermissionRegistry` the
host already registered and **unions** the stored set with the compiled one
(`Infrastructure/DependencyInjection.Auth.cs:175-219`, the `TryDecorate` call at `:205` and its
order-tolerant fallback at `:202-216`). The union is the security property: **there is no deny row.**
A stored edit can only widen a role, so the effective permission set never depends on evaluation
order, and a data change can never disable an endpoint the code guarantees. Removing a compiled
capability stays a code change (`ADR-116:406-408`).

Two more decisions hold this up.

**The opt-in is a marker type, and it is what maps the table.** `PermissionGrantModelGate` is an
empty sealed class that is never injected anywhere
(`PermissionGrantModelGate.cs:19`), registered by `AddStoredPermissionGrants`
(`DependencyInjection.Auth.cs:183`). `ApplicationDbContext` resolves it from the root provider with
`GetService`, so its absence reads as "this host did not opt in" rather than failing every context
construction (`ApplicationDbContext.cs:1070-1076`), and applies the grant configuration only then, and
only in the context instance whose physical source matches the configured `DataSourceName`
(`:1077-1080`, applied in `ConfigurePermissionGrants` at `:1177`, default `"Default"` at
`PermissionGrantSettings.cs:42`). A host that never calls
`AddStoredPermissionGrants` keeps a byte-identical model, and an opted-in host gets the table in
exactly one of its databases.

**The authorization read stays synchronous, so the cache is part of the contract.**
`IPermissionRegistry.HasPermission` sits on the hot path of every gated request. Loading grants per
role on demand inside it means blocking I/O on every such request, so the grants are held as a
per-role in-memory snapshot, rebuilt on a timer and immediately after an edit by an invalidator that
is the same instance as the cache, "so an edit and the reads that follow it cannot end up looking at
two different snapshots" (`Infrastructure/DependencyInjection.Auth.cs:187-193`). `CacheSeconds`
defaults to 30 (`PermissionGrantSettings.cs:34`, bounded 5 to 3600 at `:33`), documented as exactly
what it is: the bound on how stale another replica may be after an edit, because invalidation is per
process (`:19-20`). The default is short because the token-minting service reads these grants, and
the permission claims it mints are trusted for the token's whole lifetime, so any lag here is added
on top of that before a revoke reaches every service (`:20-25`).

A cold cache grants nothing, which is the safe direction, and the compiled layer answers from the
first request either way.

## Two refusals that are worth more than the feature

`StoredPermissionRoleAdministrationService` (`:45`) is the shipped `IRoleAdministrationService`: it
reports each role's compiled and stored permissions and replaces the stored half. The framework can
ship this one complete, unlike the user half, because every input is framework-owned: the registry
answers what the code grants, the catalog enumerates what the code *can* grant, and the store holds
what data grants (`:16-21`).

Its write method, `SetStoredPermissionsAsync` (`:115`), refuses two things, and both refusals are the
kind you only think of after an incident.

**It refuses `AdministrationPermissions.ManageRoles`, outright** (`:147-154`). That is the permission
guarding this very surface. Granting it from a row would make access to role administration a matter
of data, and deleting that row would lock every operator out of the one screen that could restore it.
The check runs *before* the catalog test and regardless of whether the host compiled the permission
in, because the error message has to name the real reason rather than "unknown" (`:145-146`). A host
that wants a role to administer roles compiles that grant in.

**It refuses any permission outside the compiled catalog** (`:156-168`). A stored row that no endpoint
checks is not a grant, it is a typo, and the difference between "refused at the API" and "written and
silently inert" is the difference between a user error and a support ticket six months later.

Everything else about the write is deliberately boring, which is the compliment: a set is a diff
rather than a truncate-and-insert, so only changed permissions are written, an unchanged submission
writes nothing, and the `GrantedAt` stamps of untouched rows survive (`:32-37`, writes at `:175-197`).
Every read, write and invalidation uses the role's one canonical spelling, so a route value cased
differently from the stored rows cannot write a second casing beside them (`:131-134`). The snapshot
is invalidated once, in a `finally` after the writes. Each grant and revoke commits on its own, so a
failure part-way through leaves earlier rows written, and the invalidation therefore runs on every
exit rather than only on success (`:172-174`, `:198-201`).

```csharp
// Illustrative of the documented shape: the two refusals on a set.
// Every read, write and invalidation below uses the role's one canonical spelling.
var canonicalRole = CanonicalRole(role);

var desired = new HashSet<string>(permissions.Select(p => p.Trim()), StringComparer.Ordinal);

// Checked BEFORE the catalog test, and regardless of whether the host compiled this
// permission in: the message has to name the real reason rather than "unknown".
if (desired.Contains(AdministrationPermissions.ManageRoles))
    return Result.Failure<RolePermissionsResponse>(Error.Validation(
        "PermissionGrant.ManageRolesMustBeCompiled",
        "It is the permission that guards this surface, so granting it from here would make "
        + "access to role administration a matter of data, and deleting the row would lock "
        + "every operator out of the screen that could restore it.",
        nameof(IRoleAdministrationService), role));

var unknown = desired.Except(catalog.Permissions, StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
if (unknown.Count > 0)
    return Result.Failure<RolePermissionsResponse>(Error.Validation(
        "PermissionGrant.UnknownPermission",
        "A stored grant may only name a permission the code already declares, so an endpoint "
        + "actually checks it.",
        nameof(IRoleAdministrationService), role));

// A set is a diff, not a truncate-and-insert: unchanged rows keep their GrantedAt stamp.
// Each write commits on its own, so the invalidation runs on every exit.
try
{
    foreach (var permission in desired.Except(existing, StringComparer.Ordinal))
    {
        var granted = await store.GrantAsync(canonicalRole, permission, changedBy, cancellationToken);
        if (granted.IsFailure)
            return Result.Failure<RolePermissionsResponse>(granted.Errors);
    }

    foreach (var permission in existing.Except(desired, StringComparer.Ordinal))
    {
        var revoked = await store.RevokeAsync(canonicalRole, permission, cancellationToken);
        if (revoked.IsFailure)
            return Result.Failure<RolePermissionsResponse>(revoked.Errors);
    }
}
finally
{
    await invalidator.InvalidateAsync(canonicalRole, cancellationToken);
}
```

## The administration API is two bases, gated on capabilities

`RolesAdminControllerBase` (`:61`) needs no app-supplied service, because
`AddStoredPermissionGrants()` registers a complete one; an app implements the interface only to
change that behavior (`:29-33`). `UsersAdminControllerBase<TUserDto>` (`:68`) takes a
consumer-implemented `IUserAdministrationService<TUserDto>`, because only the app knows its user
table, and serves one account, its live sessions and its sign-in history, lock, unlock and role
replacement (`:80`, `:101`, `:125`, `:214`, `:246`, `:280`), plus a view-as action that also
requires `AdministrationPermissions.ViewAsUsers` (`:160-161`). The roster itself is the app's generic
paged entity endpoint, not an action on the base (`:21-23`). The role, lock and unlock actions carry
two refusals of their own: no administrator grants more than they hold
(`UserAdministration.PrivilegeCeiling`, `:48-56`), and a role listed under
`Authorization:MultiFactor:RequiredForRoles` goes only to an account that has turned on two-factor
(`UserAdministration.SecondFactorNotEnrolled`, `:57-63`).

Both are gated on capabilities, never on role names:
`[HasPermission(AdministrationPermissions.ManageRoles)]` at `RolesAdminControllerBase.cs:60` and
`[HasPermission(AdministrationPermissions.ManageUsers)]` at `UsersAdminControllerBase.cs:67`. That
matters more here than anywhere else in an app: an administration surface gated on the string
`"Admin"` is the one place where a role rename becomes a privilege escalation.

The roles base serves three reads and one write, and the third read is the one an editor cannot work
without: `GetCatalogAsync`, routed on the literal `catalog` (`:98`), which takes precedence over the
`{role}` template below it, so no role named "catalog" can shadow the endpoint. A consumer routing
its subclass at `Admin/Roles` therefore gets `GET Admin/Roles/catalog`, and the editor draws from a
closed list rather than a free-text box. The closed list is why the "unknown permission" refusal
above is a safety net rather than the primary defense.

## Terms of Service acceptance: the server owns the version

The fifth completion records which version of the Terms of Service each user agreed to, and asks
again when that version moves. It has the same shape as the other four, plus one rule of its own:
the version a user consents to is never the client's to name.

`AddLegalAcceptance(configuration)` (`Infrastructure/DependencyInjection.Auth.cs:140`) binds
`LegalAcceptanceOptions` from the `Legal` section and nothing else (`:145-146`). It deliberately
registers no `ILegalAcceptanceService`, because the accepted version and instant belong to the app's
own `User` aggregate (`:129-131`), and it skips `ValidateOnStart` because its one setting has no
invalid value (`:142-144`). Unset is the off switch: with no `CurrentTermsVersion` the registration
flow asks for nothing, the read endpoint reports every user as current, and the accept endpoint has
nothing to accept (`LegalAcceptanceOptions.cs:8-10`, section `"Legal"` at `:15`, the setting at
`:21`).

**It reaches sign-up without an eighth constructor parameter.** The options travel through
`AuthenticationValidators`, the registration parameter object, as an optional constructor argument
(`AuthenticationValidators.cs:30`), and `AuthenticationServiceBase` reads the version from there
(`AuthenticationServiceBase.cs:126-141`), so the app's `AuthenticationService` needs no change
(`DependencyInjection.Auth.cs:134-137`). With a version configured, `RegisterAsync` refuses a request
whose `AcceptedTerms` flag is false with `LegalAcceptanceErrors.TermsNotAccepted`
(`AuthenticationServiceBase.cs:316-319`). The flag is all the client sends, because the anonymous
register page cannot read the version; the app's `CreateUser` override stamps the server's own
`CurrentTermsVersion` on a user that implements `ILegalAcceptingUser` (`:133-136`).

**The rules live in one static class, so a consumer cannot forget one.** `ILegalAcceptingUser`
(`Domain/Auth/ILegalAcceptingUser.cs:21`) is three members: the accepted version (`:24`), the instant
(`:27`), and `AcceptTerms`, which returns a `Result` so the aggregate keeps the last word, and which
treats accepting the version already on record as an ordinary repeat (`:31-37`). The rest is
`LegalAcceptancePolicy` (`Application/Auth/Legal/LegalAcceptancePolicy.cs:10`, remark `:6-8`).
`EnsureAcceptsCurrentVersion` fails when no version is configured and when the supplied version
differs ordinally, so a client that showed stale terms cannot record consent to the new ones
(`:24-36`, failing with `LegalAcceptanceErrors.VersionNotCurrent`). `Normalize` rebuilds the standing
from the accepted version and instant alone, so the answer never depends on a consumer filling
`IsCurrent` correctly (`:38-52`).

`LegalAcceptanceControllerBase` (`API/Controllers/Legal/LegalAcceptanceControllerBase.cs:45`,
`[Authorize]` at `:44`) applies both. A derived controller supplies the route and nothing else
(`:19-21`). `GET` answers `IsCurrent = true` without calling the app's service when no version is
configured, so a client never blocks a user on a host that has not opted in (`:65-69`), and every
other answer passes through `Normalize` (`:83`). `POST` is `[Idempotent]` (`:94`) and runs the
version check before anything is recorded (`:109-111`).

**The re-acceptance dialog cannot be dismissed.** `TermsAcceptanceGate`
(`UI/Components/Legal/TermsAcceptanceGate.razor.cs:29`) is a layout component the host adds itself.
Its dialog turns off backdrop click, Escape, close-on-navigation and the close button (`:37-45`), so
accepting or signing out are the only exits, and the comment above those options says why navigation
is on the list: a list page rewrites its own URL right after it loads, and the dialog provider
otherwise closes every open dialog on a location change (`:32-35`). The gate reads the standing from
`OnAfterRenderAsync`, never during prerender, because the bearer token is only readable once the
renderer is interactive (`:25-26`).

The capability shipped in MMCA.Common 1.223.0 (`MMCA.Common/CHANGELOG.md:1826`, entry `:1830`). One consumer runs it,
covered in the trade-offs below.

## Password reset: the single-use token the confirmation copies

The email-confirmation token earlier is a copy, and **ADR-091** records the original. A
forgot-password credential is a cache record rather than a schema change: `PasswordResetTokenService`
(`Infrastructure/Auth/PasswordResetTokenService.cs:33`) writes one `pwdreset:token:{email}` record and
one `pwdreset:req:{email}` request counter through `ICacheService`, both keyed by the normalized
address (`:53-55`). Expiry is the cache TTL, so there is no sweeper and no row to reap (`:13-14`).

The token is 32 random bytes, Base64Url-encoded (`:39`, `:81`), and only its SHA-256 is stored, with
the token's lifetime as the record's TTL (`:84-90`). Issuing overwrites, so an address holds at most
one live link (`:16-17`). Redemption compares in fixed time (`:146`); a wrong guess rewrites the
record with its remaining lifetime rather than a fresh one, and the record is dropped at the attempt
cap (`:165-180`). A match removes the token and the request counter together (`:152-155`). The
defaults are a 30-minute lifetime, five attempts and three requests per address per hour
(`PasswordResetSettings.cs:29-44`).

Single use is why the credential is stored at all: a signed token that has not expired stays valid
however many times it is presented (`ADR-091:31-33`, `:129`). So the read, compare and remove run as
one critical section under an `IDistributedLock` on `lock:{key}` (`:106-108`), and a redemption that
cannot take the lock within five seconds is answered as an invalid token (`:41-43`, `:109-112`).

That lock is the one structural difference from the confirmation token.
`EmailConfirmationTokenService` (`EmailConfirmationTokenService.cs:41`) takes no lock (`:41-44`) and
relies on the shared-store read alone (`:93-95`); its record lives a day rather than half an hour
(`EmailConfirmationSettings.cs:29`), under its own `emailconfirm:` prefix so neither link can
invalidate the other (`:28-31`).

The callers keep the contract. `ResetPasswordHandlerBase<TUser, TCommand>`
(`Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:42`) consumes the token before the save on
purpose, folds every rejection into one `Auth.InvalidResetToken` (`:20-22`, `:74-79`), and revokes
every refresh session before it applies the new password (`:106-111`).
`PasswordResetAuthControllerBase` (`API/Controllers/PasswordResetAuthControllerBase.cs:43`) exposes
both endpoints anonymous, idempotent and behind the per-IP auth limiter (`:75-78`, `:99-102`). The
cost is the cache's: an eviction or a restart silently kills live links, and the user requests
another (`ADR-091:134`).

## Passkeys: a second factor in one gesture, kept in its own package

**ADR-139** adds passkey (WebAuthn) sign-in as one more opt-in of the same shape, with one twist: the
verification library never reaches a host that does not ask for it. WebAuthn verification is CBOR,
COSE keys, signature formats and origin binding, and the maintained .NET library for it pulls a native
dependency (`ADR-139:36-38`), so it lives in its own package, `MMCA.Common.Passkeys`. The core
contract is `IPasskeyCeremony` (`Application/Auth/Passkeys/IPasskeyCeremony.cs:19`).
`AddPasskeys(configuration)` (`Passkeys/PasskeysServiceCollectionExtensions.cs:37`) binds the
`Passkeys` section with startup validation (`:41-44`), registers the Fido2-backed
`Fido2PasskeyCeremony` behind `IPasskeyCeremony` (`:47`) and the scoped `IPasskeyService` that runs
the ceremonies (`:51-52`).

Calling it turns nothing on. `PasskeySettings.Enabled` defaults to false (`PasskeySettings.cs:25`),
and while it is false every passkey endpoint answers 404 and no context maps the `PasskeyCredentials`
table (`PasskeysServiceCollectionExtensions.cs:23-26`); the controller base returns `NotFound()`
unless the registered service reports itself enabled (`PasskeysControllerBase.cs:53-54`, `:71-73`).
A host that never references the package carries no WebAuthn library at all.

**A passkey sign-in is an ordinary sign-in with `mfa=passkey`.** `SignInWithPasskeyAsync`
(`AuthenticationServiceBase.cs:604`) refuses a service account (`:611-616`), runs the app's own
login-candidate gate (`:618-622`), arms the method field with `AuthClaimTypes.MultiFactorMethodPasskey`
(`:624`) and mints through the same `IssueTokensCoreAsync` the password sign-in uses (`:627`),
clearing the field in a `finally` (`:629-632`). It is the third value the `mfa` claim can carry
(`AuthClaimTypes.cs:76`): possession of the device plus the authenticator's own user verification is
multi-factor by itself, and a refresh carries it over like the other two (`:71-75`). Every
`IRequiresMfa` use case therefore accepts a passkey session with no new branch, and the refresh
session, the sign-in history and revocation are the ones every other sign-in produces.

**Registering a passkey needs a recent sign-in, judged by `auth_time`.** Planting its own passkey is
the most valuable thing a stolen session could do, so both registration actions ask
`PasskeyStepUp.IsSatisfiedBy` first (`PasskeysControllerBase.cs:81`; `ADR-139:120-122`). It admits a
caller whose `auth_time` claim (`AuthClaimTypes.cs:111`, the sign-in instant) is at most
`MaxSignInAge` old, ten minutes (`PasskeyStepUp.cs:20`, `:26-30`); a token with no `auth_time` never
qualifies. The claim is the right test because a refresh carries it over unchanged
(`AuthenticationServiceBase.cs:452-455`): a token's age and the presence of `mfa` both ride every
refresh, so either would let a stolen refresh token stay fresh enough to register a passkey
indefinitely (`ADR-139:122-125`). The signature counter must also advance, or the assertion reads as
a cloned key (`ADR-139:98-103`).

**It ships off in ADC production.** MMCA.ADC is the one consumer that carries the code path: its
Identity service calls `AddPasskeys` (`MMCA.ADC/.../MMCA.ADC.Identity.Service/Program.cs:191`), and
its base `appsettings.json` sets `Passkeys:Enabled` to false (`appsettings.json:133-134`). Only the
Development settings and the AppHost turn it on, and nothing under ADC's infrastructure sets it, so
in production every passkey route answers 404 (`ADR-139:207-216`). Turning it on waits on a decision
about ADC's production domain, because a passkey is bound to its relying-party id
(`ADR-139:235-238`). MMCA.Store and MMCA.Helpdesk leave it off (`:238`).

## Trade-offs, honestly

- **Two-factor has one adopter, and it is opt-in per account there.** MMCA.Store's Identity service
  calls `AddTwoFactorAuthentication` (`Store Program.cs:96`), its Identity module registers
  `AuthenticationValidators` by type and its own `UserTwoFactorStore` (`DependencyInjection.cs:47`,
  `:60`; the store at `UserTwoFactorStore.cs:26`), its `User` implements `ITwoFactorUserState`
  (`Store User.cs:30`), and its web head calls `AddTwoFactorUI` (`MMCA.Store.UI.Web/Program.cs:71`).
  An account that never enrolls signs in exactly as before, and no role requires the factor, because
  `Authorization:MultiFactor:RequiredForRoles` stays empty (`Store Program.cs:91-95`). A search of
  MMCA.ADC's `Source/` tree this run finds no `AddTwoFactorAuthentication` call and no
  `ITwoFactorStore` implementation. Email confirmation and stored grants are live in both: ADC's
  Identity service calls `AddEmailConfirmation` (`Program.cs:178`) and `AddStoredPermissionGrants`
  (`:250`), Store's calls the same two (`Program.cs:89`, `:111`), both apps' `User` implements
  `IEmailConfirmableUser` (`ADC User.cs:39`, `Store User.cs:30`), and both route the two controller
  bases (`ADC AdminRolesController.cs:36`, `UsersAdminController.cs:27`;
  `Store AdminRolesController.cs:35`, `AdminUsersController.cs:35`).
- **Terms acceptance has one adopter, and its gate fails open.** ADC's Identity service calls
  `AddLegalAcceptance` (`Program.cs:212`), its `User` implements `ILegalAcceptingUser`
  (`ADC User.cs:39`), it routes a `LegalAcceptanceController` (`LegalAcceptanceController.cs:24`), and
  its Identity UI module contributes the gate (`IdentityUIModule.cs:49`); the same search finds none
  of the four in MMCA.Store or MMCA.Helpdesk. Every non-success outcome of the gate's read renders
  nothing, because the gate exists to ask for consent and never to take the app down with the API
  (`TermsAcceptanceGate.razor.cs:26-27`), so while the read endpoint is failing nobody is asked. A
  user created by an external-login path outside `RegisterAsync` starts unstamped and is asked on
  first sign-in (`AuthenticationServiceBase.cs:137-138`).
- **Passkeys ship off in production, and the relying-party id is why.** ADC carries the whole code
  path and the table, with the switch off, because a passkey registered against one domain cannot be
  moved to another (`ADR-139:235-238`). The feature is real, tested framework code, and in production
  it answers 404.
- **Registering a service is not the same as changing behavior, and that is a documentation burden.**
  Adopting two-factor takes the DI call and the app's `ITwoFactorStore`, and it arms the challenge
  only if the app registers `AuthenticationValidators` by type, because the framework does not
  register that bundle itself; the app's `AuthenticationService` constructor does not change
  (`Infrastructure/DependencyInjection.Auth.cs:37-44`). Adopting confirmation takes three: the DI
  call, `RequireConfirmedEmail`, and the `User` implementing the contract. Adopting Terms acceptance
  takes four: the DI call, a configured `Legal:CurrentTermsVersion`, the `User` contract with a
  `CreateUser` override that stamps it, and an app-written `ILegalAcceptanceService` behind a routed
  controller subclass. Adopting passkeys takes the most: the package reference, the DI call,
  `Passkeys:Enabled`, a migration and a routed controller subclass
  (`PasskeysServiceCollectionExtensions.cs:29-34`). Every one of those gaps is a place where somebody
  believes a feature is on and it is not. The safety is real and the confusion is real, and they are
  the same property.
- **Optional constructor parameters are a one-way widening.** The pattern that makes this
  source-compatible also means the base constructor's parameter list grows with every optional
  collaborator. It stands at seven: five required collaborators (`AuthenticationServiceBase.cs:75-79`)
  plus the two optional ones (`:80-81`). Terms acceptance and the registered two-factor authenticator
  both take the other route, through the `AuthenticationValidators` parameter object
  (`AuthenticationValidators.cs:30`, `:45-51`), which is why the count stays at seven. This scales to
  a few more and not to a dozen; at some point the honest refactor is an options object, and that one
  will not be source-compatible.
- **Stored grants are per-process cached, so a replica can be stale.** An edit is live immediately on
  the replica that served it and reaches the others within `CacheSeconds`, 30 by default
  (`PermissionGrantSettings.cs:19-20`, `:34`). A cross-replica push would put a broker on the
  authorization path. The window it would close is at most one interval, and a snapshot that cannot
  reload stops answering after three intervals, so stored grants fail closed rather than linger
  (`:28-30`).
- **A stored grant reaches another service only through a token claim.** Where modules run as separate
  services, the host that mints tokens is the one that holds the grants, so a permission granted by a
  row lands on the holder's next sign-in rather than within `CacheSeconds` (`ADR-116:445-448`). That
  is the same latency a role change has always had, and it is the price of keeping the grant table in
  one host instead of replicating it.
- **Adopting the table is a migration in the consumer, and it joins the hard-delete allowlist.** The
  grant store hard-deletes a revoked grant, which makes it an exception to the framework's
  soft-delete default, and consumers running the same fitness rule have to add the type to their own
  allowlist when they upgrade (`ADR-116:436-439`).
- **Three pages ship; the rest stays with the consumers.** `MMCA.Common.UI` ships three pages of
  ADR-116: the anonymous email confirmation landing page at `/confirm-email`
  (`ConfirmEmail.razor:1-3`), the sign-in link page, and the two-factor account page at
  `/profile/two-factor` (`TwoFactor/TwoFactorAccount.razor:1`), which covers set-up with a QR code,
  recovery codes shown once and turning it off, and is routable only in a host that calls
  `AddTwoFactorUI()`; MMCA.Store is the one consumer that does (`ADR-116:210-223`). The Terms gate
  ships as a layout component the host adds, and the administration surface ships as routeless
  components the app routes, authorizes and links for itself (`ADR-116:228-246`), promoted under the
  framework's rule for shared components: two consumers wanting the same one (`:232-233`).

## Apply this even without MMCA

The identity mechanics here are standard. What is worth copying is the shape of the extension.

1. **Make the unadopted path unreachable rather than disabled.** An optional collaborator defaulted
   to null, with a method that short-circuits when it is absent, costs a consumer nothing and cannot
   misfire. A configuration flag still executes a code path and still has a wrong setting.
2. **Never put a new mandatory step into a sign-in chain you do not operate.** If the framework owns
   login for apps you cannot test, every added step is a change to somebody's production delivered by
   a version bump. Default the gate off, require two independent conditions to turn it on, and make
   one of them something the app declares in its own type system.
3. **Run new sign-in gates after the password check.** Actionable errors are the point of the
   feature and an information leak before authentication. Order them so that reaching them proves
   ownership of the account.
4. **Make the step-up an assertion where presence is the test.** Stamp the claim only when a factor
   was actually presented, carry it through token rotation, and let absence deny. Any "the user has no
   second factor, so allow" branch converts a requirement into a preference.
5. **Let data widen authority, never remove it.** A stored permission layer that can only union with
   the compiled one has no evaluation-order semantics to get wrong, and no row whose deletion disables
   an endpoint. Keep revocation of a compiled capability in code.
6. **Refuse the permission that guards the surface, from inside the surface.** Any screen that can
   edit its own access control needs one hard-coded refusal, or its worst outage is a single
   `DELETE` with nobody left who can undo it.
7. **Draw the editor from a closed catalog and refuse anything outside it.** A grant no endpoint
   checks is a typo that looks like a grant, and it will be discovered by the person who assumed it
   worked.
8. **If the read is synchronous, make the cache part of the contract.** Say out loud what the
   staleness bound is and which direction a cold cache fails in. "Grants nothing on a cold cache" is a
   design statement; discovering it in production is not.
9. **Let the server own the version of anything a user consents to.** The client sends a yes, the
   server stamps the version it enforces, a request naming any other version is refused, and every
   answer is re-derived from what was recorded rather than from a consumer's own `IsCurrent`.
10. **Judge "recently authenticated" by when the user signed in, not by the token.** A refresh resets
    a token's age and carries every assertion it held, so recency has to be a claim a refresh copies
    unchanged and never renews.

The rule of thumb: **in a shared framework, the cost of a feature is paid by the consumers who do not
want it. Design so that bill is exactly zero, and adoption becomes a decision instead of an upgrade
risk.**

---

**What we covered:** why a second factor cannot be added to a shared sign-in chain as a step, how
`AuthenticationServiceBase` takes the authenticator (directly or through the validators bundle) and
the confirmation settings as optional collaborators so the unadopted path is unreachable, where both
gates sit relative to the password check and why, how the `mfa` claim is stamped by a token wrapper
and carried through rotation with presence as the whole test, why the framework ships no user table
for two-factor material, how stored permission grants union with the compiled registry behind a
marker type that maps the table, the two refusals `SetStoredPermissionsAsync` makes, how the two
administration controller bases gate on capabilities rather than role names, and how versioned Terms
of Service acceptance keeps the version on the server and holds a non-dismissable dialog open until
the user accepts or signs out, how the cache-backed password-reset token stays single-use under a
lock the email-confirmation token does not take, and how passkeys sign in with `mfa=passkey` from
their own package, register only after a recent sign-in judged by `auth_time`, and ship off in ADC
production.

**Next in the series:** Article 53, a cloud-neutral core with one Azure, AWS or Google adapter
package per cloud and one call per capability.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-116 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/116-identity-completions-opt-in.md`
- The full 34-category scorecard, §11 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 51, "Four ways to do work later: channels, cron, the outbox and durable internal commands."
Next: Article 53, "One framework, three clouds: a cloud-neutral core with vendor adapter packages."*

*Tags: .NET, C Sharp, Authentication, Security, Software Architecture*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`, 30 published
packages at `:20`); every changed claim below re-read with path:line this run. Changes this run
(2026-11-25): two-factor adoption rewritten (MMCA.Store adopts it: `Store Program.cs:96`,
`UserTwoFactorStore.cs:26` registered at Store `Identity.Application/DependencyInjection.cs:60` with
`AuthenticationValidators` by type at `:47`, `ITwoFactorUserState` on Store `User.cs:30`, `AddTwoFactorUI`
at `MMCA.Store.UI.Web/Program.cs:71`; ADC has none, Grep of `MMCA.ADC/Source` for
`AddTwoFactorAuthentication|: ITwoFactorStore|AddTwoFactorUI` returned no match); the authenticator
reaching sign-in through `AuthenticationValidators.TwoFactor` (`AuthenticationValidators.cs:32-51`,
`:68-73`; `AuthenticationServiceBase.cs:62-68`, `:858-864`; `DependencyInjection.Auth.cs:37-44`),
replacing the "pass it to the base constructor" adoption step; the first code block's call sites now
return through `SignInFailed` with the metric outcome, as the source does (`:239-256`), and its
challenge body uses the `twoFactor ?? validators.TwoFactor` fallback; `CacheSeconds` 300 to 30
(`PermissionGrantSettings.cs:34`, range `:33`, remarks `:19-25`, fail-closed `:28-30`) with the
stored-grant trade-off rewritten around it; `UsersAdminControllerBase` now names the sign-in history
and view-as actions and the privilege-ceiling and enrolled-role refusals (`:48-63`, `:80-280`); the
pages trade-off rewritten (three pages ship, `/profile/two-factor` adopted by Store, ADR-116 item 10
`:210-246`); the `mfa` claim's third value `passkey` (`AuthClaimTypes.cs:76`); a sixth ADR-116
completion (sign-in links, `:318`) named in the opening and left to the ADR; `RegisterAsync`'s
`ConfirmationPending` outcome on the same gate (`AuthenticationServiceBase.cs:387-393`); and a new
passkeys section (ADR-139, added to the header) with a passkey trade-off, a passkey adoption sentence,
a tenth "apply this" item and a closing-summary clause. Every other anchor was re-pointed (listed
below). Earlier runs (2026-10-29, 2026-10-22, 2026-10-08 and 2026-10-02) added the password-reset and Terms sections and recounted the constructor; their detail
lives in git history. Both code blocks are illustrative of the documented shape rather than
compilable extracts: the first splices `AuthenticationServiceBase`'s constructor header (`:74-81`),
the two login-gate call sites (`:239-256`) and three of its methods (`:832-842`, `:858-864`,
`:876-889`) into one class body, with `ConfigureAwait` calls dropped; the second condenses
`StoredPermissionRoleAdministrationService.SetStoredPermissionsAsync` (from `:115`) with the null,
whitespace and role-existence guards and `ConfigureAwait` calls dropped and the two error messages
shortened from the source strings beside the codes at `:150` and `:164`; the `canonicalRole`
resolution (`:134`) is kept ahead of the refusals, as in the source. Control flow, member names and
refusal codes are faithful. The password-reset and passkey sections carry no code block.*
- *ADR-116 (`Website/docs-src/adr/116-identity-completions-opt-in.md`), Status `:3-26` (revisions
  through 2026-11-23 and the 2026-11-24 amendment; passkeys and machine clients named as further
  opt-ins of this shape `:18-20`): the app-owned user row (`:54-59`); the 1.188.0 `UPGRADING.md`
  precedent with eight items (`:61-65`); item 4, email confirmation mirroring the password-reset
  design (`:125-137`); item 10, three pages shipping, `/profile/two-factor` routable after
  `AddTwoFactorUI()` and adopted by MMCA.Store alone, and the routeless administration components
  (`:210-246`, promotion rule `:232-233`); item 13, Terms acceptance as the fifth completion
  (`:291-317`); item 14, sign-in links as the sixth (`:318`); the rejected "let a stored grant deny"
  (`:406-408`); the hard-delete allowlist (`:436-439`); next-sign-in latency (`:445-448`); the
  2026-11-23 revision recording the two-factor page (`:617-627`); the 2026-11-24 amendment replacing
  `Otp.NET` with internal TOTP and Base32 types (`:661-670`).*
- *`AuthenticationServiceBase<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`): the
  `twoFactor` parameter documentation with the validators fallback `:62-68`, the confirmation-parameter
  documentation `:69-73`; primary constructor `:74-81` (five required `:75-79`, optional `twoFactor` and
  `emailConfirmationSettings` `:80-81`); `CurrentTermsVersion` from `AuthenticationValidators` with
  remarks `:126-141` (stamping `:133-136`, external login `:137-138`); in `LoginAsync`, the
  after-the-password-check comment `:235-238`, `CheckEmailConfirmed` call `:239` (failure through
  `SignInFailed(AuthSignInMetrics.EmailNotConfirmed, ...)` `:242-245`),
  `ChallengeSecondFactorCountingFailuresAsync` call `:248` (failure `:252-255`), arming `:277`, issuance
  `:281`, `finally` clear `:285`; in `RegisterAsync`, the Terms refusal `:316-319` and
  `RegistrationOutcome.ConfirmationPending` `:387-393`; `RefreshTokenAsync` carrying `mfa` `:450` and
  `auth_time` `:452-455`, cleared in the `finally` `:468-472`; `SignInWithPasskeyAsync` `:604`
  (service-account refusal `:611-616`, candidate check `:618-622`, `MultiFactorMethodPasskey` `:624`,
  `IssueTokensCoreAsync` `:627`, `finally` `:629-632`, email gate skipped `:600-601`);
  `CreateAccessTokenForSession` `:821-822` calling
  `MintForSession(sessionId, _multiFactorMethod, _authenticatedAt, ...)` with the remark `:803-817`;
  `CheckEmailConfirmed` `:832-842`; `ChallengeSecondFactorAsync` `:858-864` (remark `:847-853`);
  `ChallengeSecondFactorCountingFailuresAsync` `:876-889` (remark `:866-870`, counts only
  `TwoFactorInvalidCode` `:883`); `MultiFactorMethodFor` `:897-906` (unknown arm `:903-905`).*
- *`AuthenticationValidators`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs`): primary
  constructor with `IOptions<LegalAcceptanceOptions>? legalAcceptance = null` `:30`; the second
  constructor taking `ITwoFactorAuthenticator`, picked only when one is registered `:32-51`;
  `TwoFactor` `:68-73`.*
- *`AuthClaimTypes` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs`):
  presence-is-the-assertion documentation listing three values `:49-62`; `MultiFactor = "mfa"` `:63`;
  `otp` `:66`; `recovery` `:69`; `passkey` `:76` (remark `:71-75`); `AuthTime = "auth_time"` `:111`
  (remark from `:100`).*
- *Settings (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/`), confirmed by
  this run's audit: `TwoFactor/TwoFactorSettings.cs` (`:9-14`, `:34`, `:46`, `:50`, `:61`);
  `EmailConfirmation/EmailConfirmationSettings.cs` (`RequireConfirmedEmail` remark `:47-55`,
  `TokenLifetimeMinutes` 1440 `:29`). Re-read this run: `Permissions/PermissionGrantSettings.cs`
  section `:12`, staleness-bound remark `:19-25`, three-intervals fail-closed `:28-30`,
  `[Range(5, 3600)]` `:33`, `CacheSeconds = 30` `:34`, `DataSourceName = "Default"` `:42`.*
- *Handler bases (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/`):
  `TwoFactor/ConfirmTwoFactorEnrollmentHandlerBase.cs:39`, `TwoFactor/DisableTwoFactorHandlerBase.cs:36`,
  `TwoFactor/RegenerateRecoveryCodesHandlerBase.cs:36`,
  `EmailConfirmation/SendEmailConfirmationHandlerBase.cs:51` (re-read this run),
  `EmailConfirmation/ConfirmEmailHandlerBase.cs:33`.*
- *DI (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs`): no
  `ITwoFactorStore` remark `:31-34`; arms-the-challenge-through-`AuthenticationValidators` remark
  `:37-44`; `AddTwoFactorAuthentication` `:47`; `AddLegalAcceptance` `:140` (no-service remark
  `:129-131`, validators remark `:134-137`, no `ValidateOnStart` `:142-144`, `Legal` bind `:145-146`);
  `AddStoredPermissionGrants` `:175-219` (call-after remark `:161-164`, maps-the-table remark
  `:167-172`, `PermissionGrantModelGate` `TryAddSingleton` `:183`, one-instance cache `:187-193`,
  `IRoleAdministrationService` `:195`, refresh service `:199-200`, `TryDecorate` `:205`, fallback
  `:202-216`).*
- *`StoredPermissionRoleAdministrationService` and `RolesAdminControllerBase` anchors (`:45`, `:16-21`,
  `:115`, `:131-134`, `:145-168`, `:172-201`; `:29-33`, `:60`, `:61`, `:98`) confirmed by this run's
  audit, unchanged.*
- *`PermissionGrantModelGate` (`.../Infrastructure/Persistence/Auth/PermissionGrantModelGate.cs:19`);
  `ApplicationDbContext`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs`):
  both-use-`GetService` remark `:1070-1072`, `ResolvePermissionGrantGate` `:1075-1080` (gate lookup
  `:1076`, `DataSourceName` match `:1077-1080`), `ConfigurePermissionGrants` `:1170` applying
  `ApplyPermissionGrantConfiguration` `:1177`.*
- *`UsersAdminControllerBase`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/UsersAdminControllerBase.cs`):
  summary with the roster sentence `:21-23`, privilege-ceiling remark `:48-56`, enrolled-role remark
  `:57-63`, `[HasPermission(AdministrationPermissions.ManageUsers)]` `:67`, declaration `:68`;
  `GET {userId}` `:80`, `GET {userId}/sessions` `:101`, `GET {userId}/sign-ins` `:125`,
  `POST {userId}/view-as` `:160` with `[HasPermission(AdministrationPermissions.ViewAsUsers)]` `:161`,
  `POST {userId}/lock` `:214`, `POST {userId}/unlock` `:246`, `PUT {userId}/roles` `:280`.*
- *Terms of Service acceptance (MMCA.Common 1.223.0, `MMCA.Common/CHANGELOG.md:1826`, entry `:1830`):
  `LegalAcceptanceOptions`, `ILegalAcceptingUser`, `LegalAcceptancePolicy`,
  `LegalAcceptanceControllerBase` and `TermsAcceptanceGate` anchors as cited in the body, confirmed by
  this run's audit, unchanged.*
- *Password reset: ADR-091 (`Website/docs-src/adr/091-cache-backed-password-reset.md`), the
  signed-payload option `:31-33`, single use ruling it out `:129`, cache eviction `:134`;
  `PasswordResetTokenService`, `PasswordResetSettings`, `EmailConfirmationTokenService`,
  `ResetPasswordHandlerBase` and `PasswordResetAuthControllerBase` anchors as cited in the body,
  confirmed by this run's audit, unchanged.*
- *Passkeys: ADR-139 (`Website/docs-src/adr/139-passkeys-webauthn-opt-in-sign-in.md`), Status `:3-13`
  (off unless `AddPasskeys` plus `Passkeys:Enabled`; ADC carries it switched off in production), the
  native-dependency force `:36-38`, signature counter `:98-103`, registration checks `:120-122`, why
  not token age or `mfa` `:122-125`, ADC production off `:207-216`, relying-party-id wait and Store and
  Helpdesk off `:235-238`; `PasskeysServiceCollectionExtensions.AddPasskeys`
  (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeysServiceCollectionExtensions.cs:37`, nothing-on
  remark `:23-26`, turning-on remark `:29-34`, settings bind and validation `:41-44`,
  `IPasskeyCeremony` to `Fido2PasskeyCeremony` `:47`, `IPasskeyService` `:51-52`); `IPasskeyCeremony`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Passkeys/IPasskeyCeremony.cs:19`);
  `PasskeySettings.Enabled` (`.../Auth/Passkeys/PasskeySettings.cs:25`, off-by-default remark `:9`);
  `PasskeyStepUp` (`.../Auth/Passkeys/PasskeyStepUp.cs`, `MaxSignInAge` 10 minutes `:20`,
  `IsSatisfiedBy` `:26-30`); `PasskeysControllerBase`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Passkeys/PasskeysControllerBase.cs`,
  enabled check `:53-54`, `NotFound()` `:71-73`, step-up check `:81`); ADC
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:191` (`AddPasskeys`) and
  `appsettings.json:133-134` (`Passkeys:Enabled` false).*
- *Pages: `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ConfirmEmail.razor:1-3`;
  `.../Pages/Auth/TwoFactor/TwoFactorAccount.razor:1` (`@page "/profile/two-factor"`).*
- *Consumer adoption, re-read this run. ADC
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:178` (`AddEmailConfirmation`),
  `:191` (`AddPasskeys`), `:212` (`AddLegalAcceptance`), `:250` (`AddStoredPermissionGrants`); Store
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:89` (`AddEmailConfirmation`),
  `:91-96` (`AddTwoFactorAuthentication` with the opt-in-per-account comment), `:111`
  (`AddStoredPermissionGrants`); Store
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:47`
  (`AuthenticationValidators`) and `:60` (`ITwoFactorStore`), `.../Users/UserTwoFactorStore.cs:26`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:71` (`AddTwoFactorUI`); ADC
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:38` (interfaces `:39`,
  `IEmailConfirmableUser` and `ILegalAcceptingUser`); Store
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:30` (`IEmailConfirmableUser`,
  `ITwoFactorUserState`); controller subclasses ADC `UsersAdminController.cs:27`, Store
  `AdminUsersController.cs:35`, and (audit-confirmed) ADC `AdminRolesController.cs:36`,
  `LegalAcceptanceController.cs:24`, Store `AdminRolesController.cs:35`; ADC
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:49`
  (`LayoutComponentTypes = [typeof(TermsAcceptanceGate)]`).*
- *Rubric: §11 Security criteria (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:353-376`);
  MMCA.Common's §11 row at Weight 3 / Maturity 4 / Implementation 8
  (`Website/docs-src/governance/common-ArchitectureScorecard.md:76`, column header `:64`). Group G08
  (`Website/docs-src/onboarding/00-group-taxonomy.md:63`), inventorying `ITwoFactorAuthenticator`
  (`:824`), `IEmailConfirmationTokenService` (`:809`), `StoredPermissionRoleAdministrationService`
  (`:874`), `PermissionGrantModelGate` (`:468`), `ILegalAcceptingUser` (`:811`), `LegalAcceptancePolicy`
  (`:831`), `LegalAcceptanceControllerBase` (`:1152`), `TermsAcceptanceGate` (`:1637`),
  `IPasswordResetTokenService` (`:820`), `PasswordResetTokenService` (`:883`),
  `PasswordResetAuthControllerBase` (`:1160`), `ResetPasswordHandlerBase` (`:1319`), and the passkey
  types `IPasskeyCeremony` (`:815`), `Fido2PasskeyCeremony` (`:893`),
  `PasskeysServiceCollectionExtensions` (`:899`) and `PasskeysControllerBase` (`:1144`).*

- Full series index: https://ivanball.github.io/writing.html
