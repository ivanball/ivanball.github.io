# Compose validators, don't copy them: a reusable FluentValidation kit

> Series: MMCA.Common · Article #8 (deep-dive) · Pillar P2 · Group G06 · Rubric §24,§33 ·
> Status: grounded in `Website/docs-src/onboarding/group-06-validation.md` and `MMCA.Common.Application/Validation/`. No em dashes.

**Subtitle:** "Email must be valid, password must be strong, name is required." Every command re-declares
those rules, and then they drift. Here is a validation kit where the rules are written once, composed with
`Include(...)`, and bridged into the `Result` railway so a bad request is a 400, not a 500.

---

Open any codebase with more than a dozen commands and grep for `EmailAddress()`. You will find it five
times. `NotEmpty().MaximumLength(...)` for a name field, fifteen times. A password regex chain, copied into
the register validator, the set-password validator, and the admin-reset validator, each subtly different
because someone tightened one and forgot the others. That is the anemic-validation smell: validation is
treated as boilerplate you retype per command instead of a building block you compose.

The pipeline question (where does validation *run*) is settled elsewhere: a `ValidatingCommandDecorator`
sits in the CQRS chain and gates every command before the handler, covered in the decorator-pipeline
deep-dive. This article is about the *other* half that no one writes well: the reusable building blocks
that make each validator a short list of includes rather than a copy-pasted `RuleFor` wall. MMCA.Common
ships that kit in `MMCA.Common.Application`, so a module that composes from it gets the framework's email,
password, and address rules without restating a single chain.

## Reusable rule fragments, composed with Include

The core idea is a *rule fragment*: a tiny `AbstractValidator<T>` that owns exactly one field's contract,
generic over the parent type `T` and configured with a selector expression. `CommonValidationRules.cs`
declares eleven of them: `RequiredStringRules<T>`, `OptionalStringRules<T>`, `EmailRules<T>`,
`AbsoluteUrlRules<T>`, `PositiveIntRules<T>`, `PositiveDecimalRules<T>`, `NonNegativeIntRules<T>`,
`RequiredIdRules<T, TId>`, `OptionalPositiveIdRules<T, TId>`, `PasswordRules<T>`, and
`StrongPasswordRules<T>`. Each constructor is a single expression body. `EmailRules<T>`, for example,
chains `NotEmpty()` + `EmailAddress()` + `MaximumLength(maxLength)`. `StrongPasswordRules<T>` declares
the same non-empty plus 8-to-128 length as `PasswordRules<T>` and adds four `Matches(...)` regexes for an
uppercase letter, a lowercase letter, a digit, and a special character. Its lengths and character classes
come from `PasswordComplexity` in `MMCA.Common.Shared`, the one Unicode-aware definition the client form
attribute evaluates too, so the server rule and the form cannot disagree.

Two design choices make a fragment reusable across unrelated types. First, it is **generic over `T`**, the
type that contains the field. Second, it takes a **selector expression** (`Expression<Func<T, string>>`)
rather than inheriting from the parent. So the same `EmailRules<T>` validates ADC's `RegisterRequest`, a
speaker's email, and an event's organizer contact email, with zero inheritance coupling. A concrete
validator pulls fragments in with FluentValidation's `Include(...)`. This is ADC's registration validator:

```csharp
public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        Include(new EmailRules<RegisterRequest>(x => x.Email, "Email", UserInvariants.EmailMaxLength));
        Include(new StrongPasswordRules<RegisterRequest>(x => x.Password));
        Include(new RequiredStringRules<RegisterRequest>(x => x.FirstName, "First name", UserInvariants.FirstNameMaxLength));
        Include(new RequiredStringRules<RegisterRequest>(x => x.LastName, "Last name", UserInvariants.LastNameMaxLength));

        RuleFor(x => x.Address)
            .SetValidator(new AddressValidator()!)
            .When(x => x.Address is not null);
    }
}
```

Read that and the contract is obvious at a glance: a required, well-formed email, a strong password, and
required first and last names, each length cap taken from the `UserInvariants` constants the domain's own
`User` checks use, plus an optional address handed to the shared `AddressValidator`. The only `RuleFor`
left is the one that wires the nested validator. The "non-empty plus valid format plus max length" logic
lives in one place, and a security tweak (tighten a password character class, raise an email length cap)
is a one-line edit that reaches every validator that includes the fragment on the next package bump
instead of being missed in some forgotten validator.

The address family is the worked example of composition all the way up. `AddressValidationRules.cs` ships
six field fragments (`AddressLine1Rules<T>` through `CountryRules<T>`), and `AddressValidator` is a
composite `AbstractValidator<Address>` whose entire body is six `Include(...)` calls. It owns **no**
`RuleFor` chains of its own. The address fragments also pull their length limits from the
`AddressInvariants` fields in `MMCA.Common.Shared` rather than baking numeric literals into the rule, so the domain
invariant and its validator agree by construction. The max length for a city lives in exactly one place
across the entire solution, and the validator references it.

## One validator for the request, free for the command

Some commands carry a request DTO rather than being one. The generic update command,
`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>(Id, Request, RowVersion)`, wraps the request
body together with the route id and the concurrency token, and implements `ICommandWithRequest<TUpdateRequest>`
(its `Request` property is the bridge). The naive approach forces you to register a validator for *both*
the request and the command, which means restating the request's rules at the command level for every
wrapping command. That is boilerplate begging to drift. (A create path often needs no wrapper at all: ADC's
`CreateSessionHandler` handles `SessionCreateRequest` itself as the command, so the request's own
validator applies directly.)

`CommandRequestValidator<TCommand, TRequest>` removes it by convention. It is an auto-registered
`AbstractValidator<TCommand>` whose constructor takes `IEnumerable<IValidator<TRequest>>` by DI and loops
over the whole collection, de-duplicated by runtime type with `DistinctBy(v => v.GetType())`, applying
`RuleFor(c => c.Request).SetValidator(validator)` for each one. Every registered validator for the request
type runs, not just the first, so a module that authors a validator beside a framework-supplied one gets
both sets of rules enforced instead of silently losing one. The generic constraint
`where TCommand : ICommandWithRequest<TRequest>` is what guarantees the `c.Request` selector compiles.
Write one validator for the request, and the command that wraps it is validated for free.

The wiring lives in the Application layer's module scan,
`ScanModuleApplicationServices<TAssemblyMarker>()`, which forwards to an `Assembly`-typed overload. That
overload calls `AddValidatorsFromAssembly(moduleAssembly)` to discover every hand-written validator by
convention, then reflects over the assembly for commands implementing `ICommandWithRequest<>`, builds the
closed `CommandRequestValidator<TCommand, TRequest>` type per command, and registers it with
**`TryAddTransient`**. That `TryAdd` is the load-bearing detail: it is a fallback, not an override. If a
module ships an explicit hand-written `IValidator<TCommand>`, that wins, and the generic bridge stays out
of the way. An empty validator collection is not an error either: it just means the request has no rules
and the generic validator is a no-op. A command the scan cannot see (a closed generic constructed at
registration time rather than declared in the module assembly) gets the same bridge explicitly:
`AddEntityUpdate<...>()` calls `AddCommandRequestValidator<TCommand, TRequest>()`, which registers the same
`CommandRequestValidator` with the same `TryAdd` semantics. Convention over configuration, with an escape
hatch that never blocks a bespoke case.

## A validation failure is a Result, and the edge maps it to 400

A validator that runs is useless unless its output flows into the rest of the system cleanly.
FluentValidation speaks in `ValidationResult` and `ValidationFailure`. The rest of the codebase speaks in
the `Result` railway (covered in the Result-pattern article). One static class bridges them:
`ValidationFailureExtensions`, a C# `extension(ValidationResult)` block exposing a single method,
`ToErrors(string source)`.

`ToErrors` projects each `ValidationFailure` into an `Error.Validation(code, message, source, target)`,
tagged with the `ErrorType.Validation` kind. The mapping is exact: the failure's `ErrorCode` becomes the
error code, its `ErrorMessage` the message, the caller-supplied `source` the source, and its
`PropertyName` the `target` so the client learns *which* field failed. The `ValidatingCommandDecorator`
calls it with `typeof(TCommand).Name` as the source, so each error carries the name of the command that
produced it. On failure the decorator never calls the inner handler: it converts the failures to errors
and returns a `Result` failure immediately.

Two properties of that flow matter to a caller:

- **Validation runs before the transaction opens.** The `ValidatingCommandDecorator` sits *before* the
  transactional decorator in the pipeline. An invalid command short-circuits before any database
  transaction is opened. You never pay for a transaction on input that was never going to be persisted.
- **A validation failure is a 400, not a 500.** The `ErrorType.Validation` tag is what the API edge's
  failure mapper turns into `400 Bad Request` with per-property messages, identical at the boundary
  regardless of which validator raised it. A bad request is a client error, and the status code says so.
  Nothing in the domain or the handler ever references FluentValidation: the entire kit is an
  application-layer concern, consistent with the inward dependency rule of Clean Architecture.

That decoupling cuts both ways. FluentValidation never sees a domain `Error`, and the domain `Error` never
sees a `ValidationFailure`. `ValidationFailureExtensions` is the only join point where the two meet, so
neither library knows the other exists.

## The two-altitude rule: validator versus domain factory

A reasonable objection: if the validator checks the input, why does the domain factory also return a
`Result<T>` and re-check things? Because they check at two different altitudes, and they complement rather
than duplicate.

The validator does **cheap structural checks**: is the string non-empty, is it under the max length, does
it look like an email, does the password match the complexity regex. These are properties of the request
shape alone. The kit's fragments need no database, no other entity, no business context, and they are
exactly what you want to reject at the edge with a 400 before opening a transaction.

The domain factory enforces **business invariants**: rules that depend on state the validator cannot see.
"This email is already registered." "A session cannot be scheduled outside its parent event's window." "A
discount cannot exceed the order total." Those need other data, so they belong in the domain where that
data lives, returned as a `Result` failure from the factory method.

Put the structural check in the validator and the business invariant in the domain factory, and each lives
in exactly one place. The anti-pattern is smearing one altitude across both layers: re-doing a regex check
inside the factory, or pulling a business invariant out of the domain into a validator. The pipeline does
not forbid the second (the validating decorator runs validators one at a time precisely because a validator
may reach the database through a scoped repository), but a rule that needs other data already has a home
in the domain factory, next to that data. The kit's job is to make the cheap structural layer composable
and consistent, so the domain factory is free to focus on the rules only it can enforce.

## Trade-offs, honestly

- **It is a FluentValidation dependency.** The kit is a thin composition layer over FluentValidation 12,
  not a hand-rolled engine. That is a deliberate trade (a mature, well-known library over reinventing
  validation), but it is a dependency in the Application layer all the same, and your team has to know
  FluentValidation's `Include`, `RuleFor`, and `SetValidator` idioms to read a validator fluently.
- **The generic-plus-selector indirection has a learning curve.** A fragment like
  `RequiredStringRules<T>(selector, fieldName, maxLength)` is more abstract than a literal
  `RuleFor(x => x.Title).NotEmpty().MaximumLength(200)`. The payoff is reuse, but a newcomer meets a small
  generic puzzle (what is `T`, what does the selector bind) before the first `Include` reads naturally.
- **Composition is opt-in, so adoption is uneven.** Nothing forces a validator to include a fragment.
  Store's registration validator hand-writes its email and password chains with literal lengths (and its
  password chain carries no complexity regexes), and Common's own login and forgot-password validators
  hand-write their email rule. The kit removes the reason to copy; it does not detect a copy.
- **This layer is structural only.** A fragment validates shape, never cross-entity or stateful rules.
  That is correct (those belong in the domain factory), but it means the validator is not the whole
  story, and a reviewer must check both altitudes to know a command is fully guarded.
- **It overlaps the domain factory at the edges.** "Required" and "max length" can be expressed both as a
  validator fragment and as a domain invariant. The kit keeps the structural copy in the validator and
  sources address limits from the same `AddressInvariants` fields the domain uses, so the two agree by
  construction. Where a field has no shared constant, keeping the two in sync is a discipline, not a
  compiler guarantee.

None of these argue for copy-pasting `RuleFor` chains. They argue for knowing which altitude a rule lives
at and composing the structural ones deliberately.

## Apply this even without MMCA

The pattern ports to any stack with a validation library that supports composition:

1. Write each field contract once as a **fragment**: a small validator generic over the parent type, taking
   a selector, owning one field's rules (required, email, strong password).
2. **Compose, never copy.** A real validator is a short list of includes, not a wall of inline rules.
3. Source length limits and similar constants from **the same place the domain uses**, so the validator and
   the invariant cannot drift apart.
4. **Bridge validation output into your error type** at one join point, tag it as a validation-class error,
   and map that class to HTTP 400 at the edge. Run it before you open a transaction.
5. Keep **structural checks in the validator and business invariants in the domain**. Two altitudes, no
   smearing.

The takeaway: **validation is a cross-cutting concern, so it deserves the same composition discipline as the
rest of your architecture. A copy-pasted RuleFor chain is the anemic-validation smell. Write the rule once,
include it everywhere, and let the edge turn a failure into a 400.**

---

**What we covered:** why every command re-declaring "email valid, password strong, name required" drifts,
how MMCA.Common's reusable rule fragments (`RequiredStringRules<T>`, `EmailRules<T>`,
`StrongPasswordRules<T>`, the address fragments and `AddressValidator`) compose via `Include(...)` instead
of copy-paste, how `CommandRequestValidator<TCommand, TRequest>` plus `ICommandWithRequest` validate a
command for free from its request validator, and how `ValidationFailureExtensions.ToErrors` turns a
failure into an `ErrorType.Validation` `Result` that the API edge maps to 400 before any transaction opens.

**Next in the series:** the transactional outbox, the reliability backbone that persists a domain
event and publishes it in the same transaction, never losing one.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the validation chapter of the onboarding
guide, or `dotnet add package MMCA.Common.Application` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Validation, Software Architecture, FluentValidation*

*Notes: source-verified 2026-10-08 against MMCA.Common v1.233.0 (`MMCA.Common/FACTS.md:14`), paths
relative to `MMCA.Common/Source/Core/MMCA.Common.Application/` unless prefixed. Rule fragments, all
eleven, in `Validation/CommonValidationRules.cs`: `RequiredStringRules<T>` (:42), `OptionalStringRules<T>`
(:54), `EmailRules<T>` (:65), `AbsoluteUrlRules<T>` (:86), `PositiveIntRules<T>` (:101),
`PositiveDecimalRules<T>` (:112), `NonNegativeIntRules<T>` (:123), `RequiredIdRules<T, TId>` (:143),
`OptionalPositiveIdRules<T, TId>` (:162), `PasswordRules<T>` (:175), `StrongPasswordRules<T>` (:191);
internal `OptionalErrorCodeExtensions` helper at :20. `EmailRules<T>` ctor :67, chain :68-71;
`RequiredStringRules<T>` ctor :44; every fragment ctor ends in an optional `string? errorCode = null`.
`PasswordRules<T>` chains literal `MinimumLength(8)` / `MaximumLength(128)` (:179-181);
`StrongPasswordRules<T>` chains `MinimumLength(PasswordComplexity.MinimumLength)`,
`MaximumLength(PasswordComplexity.MaximumLength)` and four `Matches(PasswordComplexity.Uppercase/
Lowercase/Digit/SpecialCharacter)` (:195-201), with the shared-with-the-client-form-attribute statement in
its class doc (:187-188); `MMCA.Common.Shared/Auth/PasswordComplexity.cs` declares `MinimumLength = 8`
(:21), `MaximumLength = 128` (:24) and the four Unicode-category regexes (:28, :32, :36, :43). The code
block is verbatim from `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/
RegisterRequestValidator.cs:12-25` (includes :16-19); its caps come from
`MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:12,15,18` (`const`), which the domain's own checks use
(`EnsureEmailIsValid` :38, `EmailMaxLength` read at :44; first and last name at :63, :68). Other `EmailRules`
users: ADC `SpeakerValidationRules.cs:46`, `EventValidationRules.cs:123` (inside
`EventOrganizerContactEmailRules<T>`, :115);
`StrongPasswordRules` also in ADC `ChangePasswordRequestValidator.cs:18`. Uneven adoption: Store
`MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:17-20` (email, literal 100)
and :22-25 (password, 8/128, no `Matches`), composing only `AddressValidator` (:35-37); Common
`Auth/Validation/LoginRequestValidator.cs:15` and `ForgotPasswordRequestValidator.cs:14` hand-write
`RuleFor(x => x.Email)`. Address family: `Validation/AddressValidationRules.cs`, `AddressValidator` :13
with six `Include` calls :17-22, fragments :31-88 reading `AddressInvariants`
(`MMCA.Common.Shared/ValueObjects/Contact/AddressInvariants.cs:9`, the six limits declared
`public static readonly int` at :12-27, not `const`). Command bridge:
`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>(Id, Request, RowVersion)` implements
`ICommandWithRequest<TUpdateRequest>` (`UseCases/Crud/UpdateEntityCommand.cs:48-52`);
`ICommandWithRequest<TRequest>.Request` (`UseCases/Contracts/ICommandWithRequest.cs:14-17`); create path:
ADC `Sessions/UseCases/Create/CreateSessionHandler.cs:29` derives `CreateEntityHandlerBase<SessionCreateRequest, ...>`,
which is `ICommandHandler<TCreateRequest, Result<TEntityDTO>>` (`UseCases/Crud/CreateEntityHandlerBase.cs:42-46`).
`CommandRequestValidator<TCommand, TRequest>` (`Validation/CommandRequestValidator.cs:30-31`, ctor :33,
`DistinctBy` loop :37-40, every-validator doc :12-16). `ScanModuleApplicationServices<TAssemblyMarker>()`
(`DependencyInjection.ModuleScanning.cs:28-30`) forwards to the `Assembly` overload (:46), which calls
`AddValidatorsFromAssembly(moduleAssembly)` (:117) and reflects over `ICommandWithRequest<>` (:121-135),
registering via `TryAddTransient(serviceType, validatorType)` (:134). Explicit form:
`AddCommandRequestValidator<TCommand, TRequest>()` (`DependencyInjection.Crud.cs:220-226`, `TryAddTransient`
:223), called from `AddEntityUpdate` (:199). `ValidationFailureExtensions.ToErrors(string source)`
(`Extensions/ValidationFailureExtensions.cs:11,19-21`) builds `Error.Validation(code, message, source,
target)` (`MMCA.Common.Shared/Abstractions/Error.cs:37-38`). `ValidatingCommandDecorator` calls
`ToErrors(typeof(TCommand).Name)` (`UseCases/Decorators/ValidatingCommandDecorator.cs:83`) and returns a
failure without calling the inner handler (:86-94); its comment that a validator may reach the database
through a scoped repository is at :70-72. Decorator order: `DependencyInjection.cs:134` Transactional
(innermost), :135 Timeout, :136 Validating. `ErrorType.Validation` -> 400 at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:22`. FluentValidation 12:
`MMCA.Common/Directory.Packages.props:30` (`FluentValidation.DependencyInjectionExtensions` 12.1.1). There
is no dedicated ADR for validation; it is governed by the CQRS-decorator ADRs (ADR-014) and the layering
fitness tests. Change history (2026-10-08, v1.233.0): every Common anchor re-checked and holding;
stamp refreshed; ADC anchors re-based (`EventValidationRules.cs:67` to :123, the `UserInvariants`
email-check cite :29 to :38/:44); "`AddressInvariants` constants" reworded to "fields" in the body and
trade-offs, since the six limits are `static readonly`, not `const`. Change history (2026-10-02): re-anchored every Common cite after the `DependencyInjection`
partial split (scan moved to `DependencyInjection.ModuleScanning.cs`) and a one-to-three-line shift in
`CommonValidationRules.cs`; replaced the illustrative `CreateSessionRequestValidator` block (no such type)
with ADC's real `RegisterRequestValidator`; replaced the nonexistent `CreateSessionCommand` example with
`UpdateEntityCommand` and "most commands" with "some"; narrowed "ADC and Store both inherit identical
rules" (Store hand-writes them) and "the same EmailRules validates a LoginRequest" (Common's login
validator does not use it) and added the uneven-adoption trade-off; reconciled the validator-database
stance with the decorator comment; added `PasswordComplexity` and `AddCommandRequestValidator`. Earlier
runs corrected the fragment count from eight to eleven, the `CommandRequestValidator` description to apply
every registered validator, and the discovery call to `AddValidatorsFromAssembly(moduleAssembly)`.*

- Full series index: https://ivanball.github.io/writing.html
