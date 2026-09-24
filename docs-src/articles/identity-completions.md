# Finishing Identity: Second Factor, Email Confirmation and Stored Permission Grants

> Series: MMCA.Common · Article #52 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-116 ·
> Status: grounded in `Website/docs-src/adr/116-identity-completions-opt-in.md`,
> `MMCA.Common/.../Application/Auth/AuthenticationServiceBase.cs`,
> `.../Application/Auth/TwoFactor/TwoFactorSettings.cs`,
> `.../Application/Auth/EmailConfirmation/EmailConfirmationSettings.cs`,
> `.../Application/Auth/Permissions/PermissionGrantSettings.cs`,
> `.../Shared/Auth/AuthClaimTypes.cs`,
> `.../Infrastructure/DependencyInjection.cs`,
> `.../Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`,
> `.../Infrastructure/Persistence/Auth/PermissionGrantModelGate.cs`,
> `.../Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs`,
> `.../API/Controllers/Administration/RolesAdminControllerBase.cs`,
> `.../API/Controllers/Administration/UsersAdminControllerBase.cs`, the two consumers' Identity
> service hosts, and the §11 row of `Website/docs-src/governance/common-ArchitectureScorecard.md`.
> No em dashes.

**Subtitle:** A framework that owns sign-in for two deployed apps cannot add a second factor by
adding a step. Here is how a TOTP challenge, an email-confirmation gate and operator-editable
permission grants arrive as optional constructor arguments, a marker type and a decorator, so a
consumer that adopts none of them observes nothing at all.

---

There is a moment in every shared authentication library where the interesting work is done and the
awkward work is left. The framework already owns sign-in: password verification, brute-force
protection, refresh-token rotation with reuse detection, the claims the token carries. Two
production apps run their login through that one base class. Then somebody asks for a second factor.

The natural move is to add a step. Query the user's two-factor state, branch, challenge, continue.
It is ten lines, and every one of them executes in both deployed apps the moment the package is
restored, including the app that never asked for two-factor and has no column to answer the query
from.

That is the actual problem this article is about, and it is not a cryptography problem. Four
capabilities were missing from the framework's identity story: a second authentication factor, email
confirmation, permission grants an operator can change without a deploy, and a user and role
administration API. Each of them is easy to write and dangerous to insert. **ADR-116** is the record
of inserting them anyway, without changing the behavior of anything already deployed.

The series has already covered the pieces these plug into: Article 16 for cross-service token
validation, Article 24 for permission-based authorization and its compiled registry, Article 27 for
the rotating refresh token and the sign-in pipeline the new claim rides on. This article is about
what it costs to extend those without breaking them.

## Why it matters

Rubric §11 (Security) is a weight-3 category asking that authentication be centralized and identity
flows documented, that authorization be enforced at the right layer rather than in the UI, and that
permissions follow least privilege, with "over-broad permissions (admin everywhere), no least
privilege" as a named red flag (`ArchitectureEvaluationCriteria.md:353-380`). MMCA.Common's §11 row
sits at Maturity 4 and Implementation 8 (`common-ArchitectureScorecard.md:91`), and the two
capabilities most often missing from the band above it are exactly a step-up factor and an
authorization model that can be adjusted without a release.

But there is a second thing at stake, and it is the one that decides the design. A shared framework
is a system with users who cannot review your diff. Adding a mandatory query to a sign-in path is
not a feature in a library, it is a behavior change in somebody else's production, delivered by a
version bump. The framework's own history is the argument: the 1.188.0 release needed an
`UPGRADING.md` section with eight items, one of which (a fallback authorization policy) broke
unannotated endpoints (`ADR-116:39-42`).

So the question is not "how do I implement TOTP." It is "how do I ship TOTP so that the app which
does not want it cannot possibly be affected by it."

## The MMCA answer: the unadopted path is unreachable, not merely disabled

`AuthenticationServiceBase<TUser>` gained two constructor parameters, both optional and both
defaulted to null: `ITwoFactorAuthenticator? twoFactor = null` and
`IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null`
(`AuthenticationServiceBase.cs:83-84`). Every existing subclass keeps compiling, because it simply
passes fewer arguments, and the documentation on those parameters says what null means: "while it is
null the sign-in flow has no second-factor step at all" (`:63-69`).

That is not the same as a configuration flag, and the difference is the whole point.
`ChallengeSecondFactorAsync` is a two-line expression body: with no authenticator injected it
returns `TwoFactorOutcome.NotEnrolled` outright, and only otherwise delegates to
`twoFactor.ChallengeAsync` (`:665-672`). An unadopted consumer pays no query, no branch and no
allocation. A disabled feature has a code path that runs and decides to do nothing; an absent
collaborator has no code path at all. Only the second one is safe to ship to a system you cannot
test.

The email gate is built the same way. `CheckEmailConfirmed` returns success immediately unless the
host supplied settings with `RequireConfirmedEmail` set, and even then refuses only a user whose type
implements `IEmailConfirmableUser` and reports `IsEmailConfirmed: false` (`:641-652`). Two
independent conditions, both off by default, one of them a type test the app controls.

**Where the two gates sit in the login sequence is a decision, not an accident.** Both run after the
password has been proved: `CheckEmailConfirmed` at `:215`, `ChallengeSecondFactorAsync` at `:221`,
under a comment that gives the reason (`:210-213`). They return distinct, actionable errors ("confirm
your address", "send a code"), and an actionable error is an information leak if an anonymous caller
can trigger it. Reaching either gate proves the caller owns the account, so neither is readable by
somebody sweeping addresses.

## The step-up assertion is a claim, and presence is the whole test

A challenge that is satisfied has to be recorded somewhere the rest of the system can read. The
framework stamps an `amr`-style claim: `AuthClaimTypes.MultiFactor` is the literal `mfa`
(`AuthClaimTypes.cs:62`), and its value names the method that satisfied the challenge, `otp` for a
time-based code (`:65`) or `recovery` for a single-use recovery code (`:68`).

Three details make this cheap to adopt.

**The claim is stamped without the app's hook participating.** `LoginAsync` arms a private field with
the outcome (`AuthenticationServiceBase.cs:242`) and clears it in a `finally` (`:249`); the token is
minted through a wrapper that appends the claim to whatever claim set the app's `CreateAccessToken`
returned (`:619-632`, the arming at `:621`). No subclass signature changed, so no consumer edits a
method to start emitting `mfa`.

**A rotation does not silently drop it.** `RefreshTokenAsync` reads the method back off the presented
token (`:398`) and carries it into the new one, then clears the field (`:411`). Without that, a
step-up would quietly expire at the next refresh and a user who did present a second factor would
look like one who never had.

**Presence is the assertion, and absence denies.** A token for an account with no second factor
carries no `mfa` claim at all, so a request marked `IRequiresMfa` denies that caller rather than
degrading to a role check (`AuthClaimTypes.cs:50-62`). There is no "this account has no second
factor, so let it through" branch anywhere, which is the branch that turns a step-up requirement into
a suggestion.

One more small thing worth stealing. The map from outcome to claim value has a default case that
returns null with a comment explaining it: an outcome the map has not been taught about means the
enum grew and this method did not, and it must not silently mint an `mfa` claim
(`AuthenticationServiceBase.cs:679-691`). A switch over an enum whose unknown arm asserts an identity
fact is a vulnerability waiting for its next contributor.

```csharp
// Illustrative of the documented shape: the two gates and the optional collaborator.
public abstract class AuthenticationServiceBase<TUser>(
    // ... the eight collaborators every consumer already passes ...
    ITwoFactorAuthenticator? twoFactor = null,
    IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null) : IAuthenticationService
{
    // Both gates run AFTER the password check: they return actionable errors, and reaching
    // them proves the caller owns the account, so neither is readable by an address sweep.
    var confirmationResult = CheckEmailConfirmed(untracked);
    if (confirmationResult.IsFailure)
        return Result.Failure<AuthenticationResponse>(confirmationResult.Errors);

    var secondFactor = await ChallengeSecondFactorAsync(
        untracked.Id, request.TwoFactorCode, cancellationToken);
    if (secondFactor.IsFailure)
        return Result.Failure<AuthenticationResponse>(secondFactor.Errors);

    // With no authenticator injected there is no challenge and no extra query.
    protected virtual Task<Result<TwoFactorOutcome>> ChallengeSecondFactorAsync(
        UserIdentifierType userId, string? code, CancellationToken cancellationToken) =>
        twoFactor is null
            ? Task.FromResult(Result.Success(TwoFactorOutcome.NotEnrolled))
            : twoFactor.ChallengeAsync(userId, code, cancellationToken);

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
aggregate (`Infrastructure/DependencyInjection.cs:459-464`).

This is the same trade the framework already made for password material and for user lookups, and
ADR-116 states the reason plainly: the two deployed apps model users differently, and a
framework-owned user table would either be too thin to use or force columns an app has no place for
(`ADR-116:31-38`). Every consumer that wants two-factor writes one class. That is deliberate
duplication, bought on purpose.

The settings carry the RFC 6238 defaults every authenticator app assumes: six digits, a thirty-second
step (`TwoFactorSettings.cs:34`), one step of tolerated skew on each side, which widens the accepted
window to roughly ninety seconds (`:46`), ten single-use recovery codes (`:50`), and a twenty-byte
shared secret, the RFC 4226 recommendation (`:61`). They are configurable because a host may have to
match an existing enrollment base, not because moving them is a good idea: an authenticator app keyed
against one period cannot read codes minted with another (`:9-14`).

Email confirmation reuses the password-reset design rather than inventing one, down to the record
shape, the hashing, the attempt cap and the throttle, under its own key prefix so issuing a
confirmation link cannot invalidate an outstanding reset link (`ADR-116:66-77`). And
`RequireConfirmedEmail` defaults to false, with the reason written next to it: turning it on locks
out every existing account whose address was never confirmed, so a host backfills its rows as
confirmed first and flips the flag afterwards (`EmailConfirmationSettings.cs:47-55`). With it off the
whole capability is additive: tokens are issued and redeemed, and nothing about who can sign in
changes.

Above both sit handler bases the apps derive from rather than reimplement:
`ConfirmTwoFactorEnrollmentHandlerBase<TCommand>` (`:29`), `DisableTwoFactorHandlerBase<TCommand>`
(`:29`), `RegenerateRecoveryCodesHandlerBase<TCommand>` (`:30`),
`SendEmailConfirmationHandlerBase<TUser, TCommand>` (`:40`) and
`ConfirmEmailHandlerBase<TUser, TCommand>` (`:33`).

## Stored grants: operator-editable, and structurally unable to deny

Article 24 covered the compiled permission registry: a frozen role-to-permission map, consulted by
the CQRS authorization decorators and the `[HasPermission]` policy. It has one operational weakness.
Changing who can do what is a deploy.

Stored grants layer over it. `LayeredPermissionRegistry` decorates whatever `IPermissionRegistry` the
host already registered and **unions** the stored set with the compiled one
(`Infrastructure/DependencyInjection.cs:535-580`, the `TryDecorate` call and its order-tolerant
fallback at `:566-580`). The union is the security property: **there is no deny row.** A stored edit
can only widen a role, so the effective permission set never depends on evaluation order, and a data
change can never disable an endpoint the code guarantees. Removing a compiled capability stays a code
change (`ADR-116:212-215`).

Two more decisions hold this up.

**The opt-in is a marker type, and it is what maps the table.** `PermissionGrantModelGate` is an
empty sealed class that is never injected anywhere
(`PermissionGrantModelGate.cs:19`). `ApplicationDbContext` resolves it from the root provider with
`GetService`, so its absence reads as "this host did not opt in" rather than failing every context
construction (`ApplicationDbContext.cs:911`), and applies the grant configuration only then, and only
in the context instance whose physical source matches the configured `DataSourceName`
(`:940`, default `"Default"` at `PermissionGrantSettings.cs:31`). A host that never calls
`AddStoredPermissionGrants` keeps a byte-identical model, and an opted-in host gets the table in
exactly one of its databases.

**The authorization read stays synchronous, so the cache is part of the contract.**
`IPermissionRegistry.HasPermission` sits on the hot path of every gated request. Loading grants per
role on demand inside it means blocking I/O on every such request, so the grants are held as a
per-role in-memory snapshot, rebuilt on a timer and immediately after an edit by an invalidator that
is the same instance as the cache, "so an edit and the reads that follow it cannot end up looking at
two different snapshots" (`Infrastructure/DependencyInjection.cs:555-560`). `CacheSeconds` defaults
to 300, documented as exactly what it is: the bound on how stale another replica may be after an
edit, because invalidation is per process (`PermissionGrantSettings.cs:14-23`).

A cold cache grants nothing, which is the safe direction, and the compiled layer answers from the
first request either way.

## Two refusals that are worth more than the feature

`StoredPermissionRoleAdministrationService` (`:45`) is the shipped `IRoleAdministrationService`: it
reports each role's compiled and stored permissions and replaces the stored half. The framework can
ship this one complete, unlike the user half, because every input is framework-owned: the registry
answers what the code grants, the catalog enumerates what the code *can* grant, and the store holds
what data grants (`:16-21`).

Its write method, `SetStoredPermissionsAsync` (`:120`), refuses two things, and both refusals are the
kind you only think of after an incident.

**It refuses `AdministrationPermissions.ManageRoles`, outright** (`:139-146`). That is the permission
guarding this very surface. Granting it from a row would make access to role administration a matter
of data, and deleting that row would lock every operator out of the one screen that could restore it.
The check runs *before* the catalog test and regardless of whether the host compiled the permission
in, because the error message has to name the real reason rather than "unknown" (`:137-138`). A host
that wants a role to administer roles compiles that grant in.

**It refuses any permission outside the compiled catalog** (`:148-160`). A stored row that no endpoint
checks is not a grant, it is a typo, and the difference between "refused at the API" and "written and
silently inert" is the difference between a user error and a support ticket six months later.

Everything else about the write is deliberately boring, which is the compliment: a set is a diff
rather than a truncate-and-insert, so only changed permissions are written, an unchanged submission
writes nothing, and the `GrantedAt` stamps of untouched rows survive (`:32-37`, writes at `:162-186`).
The snapshot is invalidated once, after the writes (`:187`).

```csharp
// Illustrative of the documented shape: the two refusals on a set.
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
foreach (var permission in desired.Except(existing, StringComparer.Ordinal))
    await store.GrantAsync(role, permission, changedBy, cancellationToken);

foreach (var permission in existing.Except(desired, StringComparer.Ordinal))
    await store.RevokeAsync(role, permission, cancellationToken);

await invalidator.InvalidateAsync(role, cancellationToken);
```

## The administration API is two bases, gated on capabilities

`RolesAdminControllerBase` (`:61`) needs no app-supplied service, because
`AddStoredPermissionGrants()` registers a complete one; an app implements the interface only to
change that behavior (`:29-33`). `UsersAdminControllerBase<TUserDto>` (`:49`) takes a
consumer-implemented `IUserAdministrationService<TUserDto>`, because only the app knows its user
table, and clamps any requested page to `MaxPageSize = 100` (`:53`).

Both are gated on capabilities, never on role names:
`[HasPermission(AdministrationPermissions.ManageRoles)]` at `RolesAdminControllerBase.cs:60` and
`[HasPermission(AdministrationPermissions.ManageUsers)]` at `UsersAdminControllerBase.cs:48`. That
matters more here than anywhere else in an app: an administration surface gated on the string
`"Admin"` is the one place where a role rename becomes a privilege escalation.

The roles base serves three reads and one write, and the third read is the one an editor cannot work
without: `GetCatalogAsync`, routed on the literal `catalog` (`:98`), which takes precedence over the
`{role}` template below it, so no role named "catalog" can shadow the endpoint. A consumer routing
its subclass at `Admin/Roles` therefore gets `GET Admin/Roles/catalog`, and the editor draws from a
closed list rather than a free-text box. The closed list is why the "unknown permission" refusal
above is a safety net rather than the primary defense.

## Trade-offs, honestly

- **Two-factor ships unadopted, and the article will not pretend otherwise.** A search across both
  consumers' `Source/` trees this run finds no call to `AddTwoFactorAuthentication` and no
  implementation of `ITwoFactorStore` in either MMCA.ADC or MMCA.Store. The capability is framework
  code with handler bases, settings, a claim and a challenge, waiting for its first adopter. Email
  confirmation and stored grants, by contrast, are both live: ADC's Identity service calls
  `AddEmailConfirmation` (`Program.cs:231`) and `AddStoredPermissionGrants` (`:277`), Store's calls
  the same two (`Program.cs:183`, `:220`), both apps' `User` implements `IEmailConfirmableUser`
  (`ADC User.cs:35`, `Store User.cs:30`), and both route the two controller bases
  (`ADC AdminRolesController.cs:37`, `UsersAdminController.cs:26`; `Store AdminRolesController.cs:36`,
  `AdminUsersController.cs:28`).
- **Registering a service is not the same as changing behavior, and that is a documentation burden.**
  Adopting two-factor takes two steps, not one: the DI call, and then the app passing the resolved
  `ITwoFactorAuthenticator` to its base constructor (`Infrastructure/DependencyInjection.cs:465-468`).
  Adopting confirmation takes three: the DI call, `RequireConfirmedEmail`, and the `User` implementing
  the contract. Every one of those gaps is a place where somebody believes a feature is on and it is
  not. The safety is real and the confusion is real, and they are the same property.
- **Optional constructor parameters are a one-way widening.** The pattern that makes this
  source-compatible also means the base constructor's parameter list grows with every optional
  collaborator, and it is now at ten. This scales to a few more and not to a dozen; at some point the
  honest refactor is an options object, and that one will not be source-compatible.
- **Stored grants are per-process cached, so a replica can be stale.** An edit is live immediately on
  the replica that served it and reaches the others within `CacheSeconds`
  (`PermissionGrantSettings.cs:23`). A cross-replica push would put a broker on the authorization
  path. The window it would close is a grant taking effect a few seconds late, never a revoked grant
  outliving the interval, because the layer can only widen.
- **A stored grant reaches another service only through a token claim.** Where modules run as separate
  services, the host that mints tokens is the one that holds the grants, so a permission granted by a
  row lands on the holder's next sign-in rather than within `CacheSeconds` (`ADR-116:289-303`). That
  is the same latency a role change has always had, and it is the price of keeping the grant table in
  one host instead of replicating it.
- **Adopting the table is a migration in the consumer, and it joins the hard-delete allowlist.** The
  grant store hard-deletes a revoked grant, which makes it an exception to the framework's
  soft-delete default, and consumers running the same fitness rule have to add the type to their own
  allowlist when they upgrade (`ADR-116:339-344`).
- **No pages ship.** Enrollment (with its QR code and its show-recovery-codes-once screen) and
  confirmation stay with the consumers; what ships is routeless administration components the app
  routes, authorizes and links for itself (`ADR-116:246-274`). Two consumers have not yet wanted the
  same enrollment page, and the rule is that a component gets promoted when they do.

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

The rule of thumb: **in a shared framework, the cost of a feature is paid by the consumers who do not
want it. Design so that bill is exactly zero, and adoption becomes a decision instead of an upgrade
risk.**

---

**What we covered:** why a second factor cannot be added to a shared sign-in chain as a step, how
`AuthenticationServiceBase` takes the authenticator and the confirmation settings as optional
constructor arguments so the unadopted path is unreachable, where both gates sit relative to the
password check and why, how the `mfa` claim is stamped by a token wrapper and carried through
rotation with presence as the whole test, why the framework ships no user table for two-factor
material, how stored permission grants union with the compiled registry behind a marker type that
maps the table, the two refusals `SetStoredPermissionsAsync` makes, and how the two administration
controller bases gate on capabilities rather than role names.

**Next in the series:** Article 53, the series index: every pattern in one place, from the Result
railway to this one.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-116 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/116-identity-completions-opt-in.md`
- The full 34-category scorecard, §11 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 51, "Four ways to do work later: channels, cron, the outbox and durable internal commands."
Next: Article 53, the series index, "The MMCA series: every pattern, one place."*

*Tags: .NET, C Sharp, Authentication, Security, Software Architecture*

*Notes: verified type/behavior names with path:line (all re-read this run). Both code blocks are
illustrative of the documented shape rather than compilable extracts: the first splices
`AuthenticationServiceBase`'s constructor header (`:83-84`), the two login-gate call sites
(`:210-224`) and the two protected methods (`:641-652`, `:665-672`) into one class body, which the
source of course does not do; the second condenses
`StoredPermissionRoleAdministrationService.SetStoredPermissionsAsync` (`:120-187`) with the null and
whitespace guards dropped and the two error messages shortened from the source strings at `:143` and
`:157`. Control flow, member names and refusal codes are faithful.*
- *ADR-116 (`Website/docs-src/adr/116-identity-completions-opt-in.md`), Accepted 2026-09-09, revised
  2026-09-19 (`:3-9`): the four missing capabilities and why each consumer would otherwise have
  written its own (`:22-27`); the three reasons a framework-feature shape is wrong here, the app-owned
  user row (`:31-38`), the sign-in chain no consumer can afford to have changed under it with the
  1.188.0 `UPGRADING.md` precedent (`:39-46`) and pages being where apps diverge most (`:47-52`); the
  decision statement that a consumer adopting none of them observes no change (`:54-59`); two-factor
  as contract plus challenge (`:61-68`); the optional-constructor-argument hook (`:70-76`); the claim
  and its presence-is-the-test rule (`:78-89`); email confirmation mirroring the password-reset design
  under its own key prefix (`:91-104`); stored grants unioning with the compiled registry with no deny
  row (`:106-130`); the synchronous-read cache contract (`:132-142`); the two controller bases
  (`:144-166`); the three separate DI calls (`:168-176`); the single new package `Otp.NET` in
  Infrastructure only (`:178-184`); pages staying with the consumers and the routeless administration
  components (`:186-213`); the closed catalog and the two refusals (`:215-231`); the token carrying
  permissions so a service that never sees the grants still honours them (`:233-250`); the six
  rejected shapes (`:252-277`); and the trade-offs restated here (`:279-305`).*
- *`AuthenticationServiceBase<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`): the two
  optional constructor parameters `ITwoFactorAuthenticator? twoFactor = null` and
  `IOptions<EmailConfirmationSettings>? emailConfirmationSettings = null` `:83-84`, with the
  "while it is null the sign-in flow has no second-factor step at all" documentation `:63-69` and the
  confirmation-parameter documentation `:70-74`; the `_multiFactorMethod` field `:105`; in
  `LoginAsync`, the after-the-password-check comment `:210-213`, `CheckEmailConfirmed` call `:215`,
  `ChallengeSecondFactorAsync` call `:221`, arming `:242` and the `finally` clear `:249`;
  `RefreshTokenAsync` carrying the method over from the presented token `:398` and clearing it `:411`;
  `CreateAccessTokenForSession` `:619-632` with the multi-factor arming `:621`; `CheckEmailConfirmed`
  `:641-652`; `ChallengeSecondFactorAsync` `:665-672` (null authenticator answers
  `TwoFactorOutcome.NotEnrolled`); `MultiFactorMethodFor` `:679-691` with the unknown-outcome arm
  returning null `:687-690`.*
- *`AuthClaimTypes` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs`):
  `Permission = "permission"` `:24`; `MultiFactor = "mfa"` `:62` with the presence-is-the-assertion
  documentation `:50-61`; `MultiFactorMethodTotp = "otp"` `:65`; `MultiFactorMethodRecoveryCode =
  "recovery"` `:68`.*
- *Settings (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/`):
  `TwoFactor/TwoFactorSettings.cs` section `Authentication:TwoFactor` `:18`, the
  "defaults are the RFC 6238 values" remark `:9-14`, `PeriodSeconds` 30 `:34`,
  `VerificationWindowSteps` 1 with the roughly-ninety-second note `:36-46`, `RecoveryCodeCount` 10
  `:50`, `SecretByteLength` 20 with the RFC 4226 note `:60-61`;
  `EmailConfirmation/EmailConfirmationSettings.cs` section `Authentication:EmailConfirmation` `:13`,
  `RequireConfirmedEmail` defaulting false with the "that default is load-bearing" remark `:47-55`;
  `Permissions/PermissionGrantSettings.cs` section `Authentication:PermissionGrants` `:12`,
  `CacheSeconds` 300 with the per-process staleness-bound remark `:14-23`, `DataSourceName` defaulting
  `"Default"` `:31`.*
- *Handler bases (paths rooted at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/`):
  `TwoFactor/ConfirmTwoFactorEnrollmentHandlerBase.cs:29`, `TwoFactor/DisableTwoFactorHandlerBase.cs:29`,
  `TwoFactor/RegenerateRecoveryCodesHandlerBase.cs:30`,
  `EmailConfirmation/SendEmailConfirmationHandlerBase.cs:40`,
  `EmailConfirmation/ConfirmEmailHandlerBase.cs:33`.*
- *DI (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs`):
  `AddTwoFactorAuthentication(IConfiguration)` `:470` with the "deliberately registers no
  `ITwoFactorStore`" remark `:459-464` and the "calling this alone changes nothing about sign-in"
  remark `:465-468`; `AddEmailConfirmation(IConfiguration)` `:498` with its "registering it does not
  gate sign-in" remark `:487-492`; `AddStoredPermissionGrants(IConfiguration)` `:535`, its
  call-after-`AddAuthorizationPolicies` remark `:514-520` and its this-call-is-what-maps-the-table
  remark `:521-529`, the single cache instance answering as both reader and invalidator `:555-560`,
  the scoped `IRoleAdministrationService` registration `:562`, the hosted refresh service registered
  through `TryAddEnumerable` `:564-567`, and the `TryDecorate<IPermissionRegistry,
  LayeredPermissionRegistry>` call with its order-tolerant empty-compiled fallback `:569-582`.*
- *`StoredPermissionRoleAdministrationService`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/Administration/StoredPermissionRoleAdministrationService.cs`):
  declaration `:45-52`, the "every half is framework-owned" remark `:16-21`, the two-refusals remark
  `:23-31`, the set-is-a-diff remark `:32-37`; `SetStoredPermissionsAsync` `:120`, the
  checked-before-the-catalog-test comment `:137-138`, the `ManageRoles` refusal
  (`PermissionGrant.ManageRolesMustBeCompiled`) `:139-146`, the catalog refusal
  (`PermissionGrant.UnknownPermission`) `:148-160`, the grant/revoke diff `:162-186` and the single
  invalidation `:187`.*
- *`PermissionGrantModelGate`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/PermissionGrantModelGate.cs:19`),
  an empty `internal sealed class` with no state and no injection site (its remarks `:15-18`);
  resolved with `GetService` in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:911`
  (the "whole opt-in" comment `:109`), with `modelBuilder.ApplyPermissionGrantConfiguration()` applied
  at `:940` (its documentation `:928`).*
- *Controller bases (paths rooted at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Administration/`):
  `RolesAdminControllerBase.cs` capability gate `[HasPermission(AdministrationPermissions.ManageRoles)]`
  `:60`, declaration `:61`, the "needs no app-supplied service" remark `:29-33`, the two-refusals
  client contract `:40-56`, `GetCatalogAsync` on the literal route `[HttpGet("catalog")]` `:98` with
  the takes-precedence-over-`{role}` remark `:90-93`;
  `UsersAdminControllerBase.cs` capability gate `[HasPermission(AdministrationPermissions.ManageUsers)]`
  `:48`, declaration `:49`, `MaxPageSize = 100` `:53`.*
- *Consumer adoption, from a search across both `Source/` trees this run. Live: ADC
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:231` (`AddEmailConfirmation`) and
  `:277` (`AddStoredPermissionGrants`); Store
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:183` and `:220`;
  `IEmailConfirmableUser` on
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:35` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:30`; the controller
  subclasses at `MMCA.ADC/.../Identity.API/Controllers/AdminRolesController.cs:37` and
  `UsersAdminController.cs:26`, `MMCA.Store/.../Identity.API/Controllers/AdminRolesController.cs:36`
  and `AdminUsersController.cs:28`; Store's confirmation migration
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Identity/Migrations/20260910144620_AddEmailConfirmation.cs:8`.
  Not adopted: the same search returns no `AddTwoFactorAuthentication` call and no `ITwoFactorStore`
  implementation in either consumer.*
- *Rubric: §11 Security criteria and red flags
  (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:353-380`, default weight 3 at
  `:379`); MMCA.Common's §11 row at Weight 3 / Maturity 4 / Implementation 8
  (`Website/docs-src/governance/common-ArchitectureScorecard.md:91`, column header `:79`). Group G08
  Authentication and Authorization (`Website/docs-src/onboarding/00-group-taxonomy.md:63`), which is
  where `ITwoFactorAuthenticator` (`:636`), `IEmailConfirmationTokenService` (`:631`),
  `StoredPermissionRoleAdministrationService` (`:666`) and `PermissionGrantModelGate` (`:387`) are
  inventoried. Framework v1.205.0 (`MMCA.Common/FACTS.md:14`) / 19 published packages (`:19`) this
  run; not recounted here.*

- Full series index: https://ivanball.github.io/writing.html
