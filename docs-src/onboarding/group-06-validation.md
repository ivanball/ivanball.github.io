# 6. Validation

This chapter covers the small, framework-level **validation kit** that `MMCA.Common.Application`
ships so that every consuming module validates command input the same way: a set of composable
**FluentValidation rule sets** (`RequiredStringRules<T>`, `EmailRules<T>`, `StrongPasswordRules<T>`,
the six address-field rules, and the `AddressValidator` that assembles them), one **convention
validator** ([`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest))
that auto-bridges a command to its request's validator, and one **failure-mapping extension**
([`ValidationFailureExtensions`](#validationfailureextensions)) that turns FluentValidation output
into domain [`Error`](group-01-result-error-handling.md#error)s. These are the *reusable* pieces;
the per-feature validators that consume them (e.g. ADC's `SessionCreateRequestValidator`,
`EventUpdateRequestValidator`, Identity's `RegisterRequestValidator`) live in their own module
chapters. The external library underneath everything is **FluentValidation 12** (primer §3), the
codebase does not hand-roll validation.

**Where validation sits in the request lifecycle.** Validation is not invoked by handlers; it is a
*cross-cutting stage of the CQRS pipeline* (primer §2, "CQRS"). When a command is dispatched it flows
through the decorator chain `Logging → Caching → Validating → Transactional → handler`. The
[`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
(G05) is the gate this chapter's types feed: it resolves the first registered `IValidator<TCommand>`,
calls `ValidateAsync`, and, critically, sits *before* the transactional decorator so an invalid
command **short-circuits before any database transaction is opened**
(`ValidatingCommandDecorator.cs:16-20`). On failure it never calls the inner handler; it converts the
failures to errors and returns a `Result` failure immediately (`ValidatingCommandDecorator.cs:46-55`).
This is the "gate commands before they execute" charter of the group, realized as one pipeline stage
rather than scattered `if (!valid) return` checks in every handler. `[Rubric §6, CQRS & Event-Driven]`
(cross-cutting concerns belong in the pipeline) `[Rubric §24, Forms, Validation & UX Safety]`
(centralized, consistent input validation).

**The failure-mapping seam.** FluentValidation speaks in `ValidationResult` / `ValidationFailure`;
the rest of the codebase speaks in the [Result pattern](group-01-result-error-handling.md#result)
(primer §2). [`ValidationFailureExtensions.ToErrors`](#validationfailureextensions) is the one-line
bridge: a C# `extension(ValidationResult)` block (primer §4) that projects each failure into an
[`Error.Validation(errorCode, message, source, propertyName)`](group-01-result-error-handling.md#error),
tagged with the [`ErrorType.Validation`](group-01-result-error-handling.md#errortype) kind. The
decorator calls it with `typeof(TCommand).Name` as the `source` so a downstream consumer (or the API
error mapper) can see which command produced the failures (`ValidatingCommandDecorator.cs:52`). This
is why a validation failure surfaces to the client as an HTTP 400 with per-property messages: the
`ErrorType.Validation` tag is what the API layer's `HandleFailure` maps to `400 Bad Request`. Keeping
the FluentValidation type out of the domain `Error` (and the `Error` out of FluentValidation) is a
deliberate decoupling, neither library knows about the other.

**The reusable rule sets, composition over copy-paste.** The eight rules in `CommonValidationRules.cs`
(`RequiredStringRules<T>`, `OptionalStringRules<T>`, `EmailRules<T>`, `PositiveIntRules<T>`,
`PositiveDecimalRules<T>`, `NonNegativeIntRules<T>`, `PasswordRules<T>`, `StrongPasswordRules<T>`) and
the six address rules in `AddressValidationRules.cs` (`AddressLine1Rules<T>` … `CountryRules<T>`) are
each a tiny `AbstractValidator<T>` generic over the parent type `T`, taking an
`Expression<Func<T, …>>` *selector* in its constructor. Because they're generic-plus-selector, the
same `EmailRules<T>` can validate a bare value object, a request DTO, or a command, a module composes
them with FluentValidation's `Include(...)` instead of re-writing the "non-empty + valid format + max
length" logic each time. Length limits are not literals in the rule: the address rules pull theirs
from [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) constants
(`AddressValidationRules.cs:36`), so the domain invariant and its validator agree by construction.
[`AddressValidator`](#addressvalidator) is the worked example of this composition, a single
`AbstractValidator<Address>` that `Include`s all six field rules (`AddressValidationRules.cs:14-22`).
`[Rubric §1, SOLID]` (each rule set has one responsibility; the composite assembles, never
duplicates) `[Rubric §15, Best Practices & Code Quality]` (no copy-pasted length limits or messages).

**Convention over configuration, the request/command bridge.** Most ADC commands wrap a request
record (e.g. `CreateSessionCommand(CreateSessionRequest Request)`) and implement
[`ICommandWithRequest<TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest). Rather
than force module authors to write a validator for *both* the request and the command,
[`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest) is
auto-registered for every such command: it resolves the registered `IValidator<TRequest>` and forwards
to it via `RuleFor(c => c.Request).SetValidator(...)`. Module authors thus write *one* validator,
for the request, and the command is validated for free. This wiring lives in
[`ScanModuleApplicationServices<TAssemblyMarker>`](group-14-module-system-composition.md#imodule)'s
DI scan (`DependencyInjection.cs:162-176`): it reflects over the assembly for commands implementing
`ICommandWithRequest<>`, builds the closed `CommandRequestValidator<TCommand, TRequest>` type, and
registers it with **`TryAddTransient`**, so an explicitly-authored `IValidator<TCommand>` always wins
(`DependencyInjection.cs:158-159` doc). The same scan also calls
`AddValidatorsFromAssemblyContaining<TAssemblyMarker>` (`DependencyInjection.cs:156`) to discover every
hand-written validator by convention. `[Rubric §2, Design Patterns]` (convention over configuration)
`[Rubric §9, API & Contract Design]` (input validation applied uniformly across every endpoint).

**End-to-end flow, concretely.** A request arrives at a controller, is mapped to a command, and
dispatched. The pipeline reaches `ValidatingCommandDecorator`, which finds the `IValidator<TCommand>`
the module scan registered, either a hand-written one or the auto-generated `CommandRequestValidator`
delegating to the request validator. That validator runs the composed rule sets (a
`SessionCreateRequestValidator` might `Include` `RequiredStringRules` for the title and `EmailRules`
for a contact field). If valid, the handler runs inside the transaction; if not, `ToErrors` converts
the failures to `ErrorType.Validation` errors and the decorator returns a failed `Result` *without
touching the database*. The errors propagate up to the API layer, which maps them to `400`. Nothing
in the domain or the handler ever references FluentValidation, the validation kit is entirely an
application-layer concern, consistent with Clean Architecture's inward dependency rule (primer §1).

A note on placement and scope: all of this lives in `MMCA.Common.Application` so that **both** ADC and
Store inherit the same email/password/address rules and the same auto-validation convention without
duplicating them, the per-module validators only express *domain-specific* rules and reuse these
primitives. There is no separate ADR for validation; it is governed implicitly by the CQRS decorator
ADRs and the layering rules the architecture fitness tests enforce (primer §4).

### RequiredStringRules<T>, OptionalStringRules<T>, EmailRules<T>, PositiveIntRules<T>, PositiveDecimalRules<T>, NonNegativeIntRules<T>, PasswordRules<T>, StrongPasswordRules<T>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs` · Level 0 · classes (`AbstractValidator<T>` subclasses)

- **What it is**: eight reusable FluentValidation rule fragments, each enforcing exactly one field
  contract (a required string with a max length, a positive integer, a strong password, …). A
  command/request validator composes them via FluentValidation's `Include()` instead of redeclaring
  the same `RuleFor` chain. Each member, with its source line and the rule chain it builds:

  | Type | File:Line | Rule chain |
  |------|-----------|------------|
  | `RequiredStringRules<T>` | `CommonValidationRules.cs:12` | `NotEmpty()` + `MaximumLength(maxLength)` |
  | `OptionalStringRules<T>` | `CommonValidationRules.cs:24` | `MaximumLength(maxLength)` only (null/empty allowed) |
  | `EmailRules<T>` | `CommonValidationRules.cs:35` | `NotEmpty()` + `EmailAddress()` + `MaximumLength(maxLength)` |
  | `PositiveIntRules<T>` | `CommonValidationRules.cs:48` | `GreaterThan(0)` (int) |
  | `PositiveDecimalRules<T>` | `CommonValidationRules.cs:59` | `GreaterThan(0)` (decimal) |
  | `NonNegativeIntRules<T>` | `CommonValidationRules.cs:70` | `GreaterThanOrEqualTo(0)` |
  | `PasswordRules<T>` | `CommonValidationRules.cs:82` | `NotEmpty()` + `MinimumLength(8)` + `MaximumLength(128)` |
  | `StrongPasswordRules<T>` | `CommonValidationRules.cs:96` | all of `PasswordRules` + four `Matches(...)` regexes (uppercase, lowercase, digit, special char) |

- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, primer §3) and
  `System.Linq.Expressions.Expression<Func<T,…>>` (BCL). No first-party dependencies, these sit at
  the very bottom of the Application layer. Auto-wired for request types by
  [`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest).

- **Concept introduced, reusable FluentValidation rule fragments via `Include()`.**
  This is the first place the guide meets FluentValidation's *fragment-composition* idiom. Rather
  than each command validator owning a long `RuleFor(...)` chain, a fragment is a tiny
  `AbstractValidator<T>` whose constructor builds **one** field's rules, and a real validator pulls it
  in with `Include(new RequiredStringRules<CreateSessionRequest>(r => r.Title, "Title", 200))`. Two
  design choices make the fragment reusable across unrelated types: (1) it is **generic over `T`** (the
  parent type that contains the field), and (2) it takes a **selector expression**
  `Expression<Func<T, string>>` rather than inheriting from the parent, so the same `EmailRules<T>`
  validates a `RegisterRequest`, a `LoginRequest`, or a bare value object without any inheritance
  coupling. `[Rubric §24, Forms, Validation & UX Safety]` assesses whether validation is reused
  rather than copy-pasted across create/update paths; these fragments are the framework's answer, one
  definition, included everywhere. `[Rubric §1, SOLID]`: each fragment has a single responsibility
  (one field contract), and changing, say, the minimum password length is a one-line edit in one place
  rather than a grep-and-replace across every module.

- **Walkthrough**: every constructor is a single expression body (`=>` returning the configured
  `RuleFor` chain), which is why these classes are so terse.
  - `RequiredStringRules<T>` (`:14`) takes `(selector, fieldName, maxLength)` and chains
    `NotEmpty().WithMessage($"You must enter a {fieldName}")` then
    `MaximumLength(maxLength).WithMessage(...)`. The `fieldName` is interpolated into the human-readable
    message, so the same fragment yields "You must enter a Title" or "You must enter a First Name".
  - `OptionalStringRules<T>` (`:26`) drops the `NotEmpty`, selector is `Func<T, string?>` and only the
    length ceiling is enforced.
  - `EmailRules<T>` (`:37`) inserts FluentValidation's built-in `EmailAddress()` check between
    `NotEmpty` and `MaximumLength`.
  - `PositiveIntRules<T>` / `PositiveDecimalRules<T>` / `NonNegativeIntRules<T>` (`:50`, `:61`, `:72`)
    take only `(selector, fieldName)`, no length, and emit one comparison rule each.
  - `PasswordRules<T>` (`:84`) takes only a `selector` (the message strings are fixed, not
    parameterised) and enforces non-empty + 8–128 length.
  - `StrongPasswordRules<T>` (`:98`) extends that with four `Matches(...)` calls whose regex literals
    are inline in the source: `"[A-Z]"`, `"[a-z]"`, `"\\d"`, and `"[^a-zA-Z\\d]"` for uppercase,
    lowercase, digit, and special character respectively. The doc comment on `PasswordRules` (`:79`)
    explicitly points callers needing complexity at `StrongPasswordRules` instead.

- **Why it's built this way**: these fragments are the DRY core of the validation story. Because they
  live in `MMCA.Common.Application` and are generic, *both* ADC and Store get identical, tested field
  rules for free. `[Rubric §33, Developer Experience]`: a new request validator in any module reads
  as a short list of `Include(...)` calls, and a security tweak (e.g. tightening the password regex)
  propagates to every consumer on the next package bump rather than being missed in some forgotten
  validator.

- **Where it's used**: request validators throughout ADC and Store `Include()` the appropriate
  fragment; the Conference module's `*Rules<T>` validators (e.g. `SessionTitleRules<T>`,
  `SpeakerFirstNameRules<T>` in [group-18](group-18-conference-application.md)) inherit from
  `RequiredStringRules<T>` to add domain max-length constants. `PasswordRules<T>` is the standard
  password path; `StrongPasswordRules<T>` gates the initial registration / set-password flow where the
  user chooses their own credential. Whichever validator wins, it is invoked by
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  in the CQRS pipeline before the command handler runs.

### CommandRequestValidator<TCommand, TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:19` · Level 1 · class (sealed)

- **What it is**: an auto-registered `AbstractValidator<TCommand>` for any command that implements
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest). It
  validates the command by delegating to whatever `IValidator<TRequest>` is registered for the
  embedded request payload.
- **Depends on**: [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (Level 0; its `Request` property is the bridge) and FluentValidation. Registered automatically by
  `ScanModuleApplicationServices<TAssemblyMarker>()` in the Application layer
  [`DependencyInjection`](group-14-module-system-composition.md#dependencyinjection).
- **Concept, convention-over-configuration validation.** `[Rubric §2, Design Patterns]` (convention
  over configuration) and `[Rubric §9, API & Contract Design]` (input validation applied uniformly at
  the edge). Many commands are thin wrappers carrying a request DTO, e.g.
  `CreateSessionCommand(CreateSessionRequest Request)`. Without this type you would have to register a
  validator for *both* the request and the command. Instead the framework auto-binds
  `CommandRequestValidator<CreateSessionCommand, CreateSessionRequest>` and routes its validation into
  the registered `IValidator<CreateSessionRequest>`. The doc comment (`:12-15`) notes it is registered
  with **`TryAdd` semantics**, so an explicit, hand-written command validator the module ships always
  takes precedence over this generic fallback.
- **Walkthrough**: the constructor (`CommandRequestValidator.cs:22-27`) receives
  `IEnumerable<IValidator<TRequest>>` by DI, takes `FirstOrDefault()`, and, only if one exists,
  applies `RuleFor(c => c.Request).SetValidator(validator)`. An **empty** validator collection is not
  an error: it simply means the command's request has no validation rules, and the generic validator
  becomes a no-op. The generic constraint `where TCommand : ICommandWithRequest<TRequest>` is what
  guarantees the `c.Request` selector compiles.
- **Why it's built this way**: it removes the most common piece of validation boilerplate (re-stating
  request rules at the command level) while staying overridable, so the convention never blocks a
  bespoke case.
- **Where it's used**: the closed generic is discovered and registered per command during module
  scanning; at runtime
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  resolves and runs all `IValidator<TCommand>` instances, including this one, before the handler.

### AddressLine1Rules<T>, AddressLine2Rules<T>, CityRules<T>, StateRules<T>, ZipCodeRules<T>, CountryRules<T>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs` · Level 4 · classes (sealed, `AbstractValidator<T>`)

- **What it is**: six composable FluentValidation rule sets, one per address field, each generic over
  the parent type `T` and configured with a selector expression. Per member:

  | Type | File:Line | Rule chain |
  |------|-----------|------------|
  | `AddressLine1Rules<T>` | `AddressValidationRules.cs:30` | `NotEmpty()` + `MaximumLength(AddressInvariants.AddressLine1MaxLength)` (the only required line) |
  | `AddressLine2Rules<T>` | `AddressValidationRules.cs:41` | `MaximumLength(AddressInvariants.AddressLine2MaxLength)` only (optional, nullable selector) |
  | `CityRules<T>` | `AddressValidationRules.cs:51` | `MaximumLength(AddressInvariants.CityMaxLength)` only |
  | `StateRules<T>` | `AddressValidationRules.cs:61` | `MaximumLength(AddressInvariants.StateMaxLength)` only |
  | `ZipCodeRules<T>` | `AddressValidationRules.cs:71` | `MaximumLength(AddressInvariants.ZipCodeMaxLength)` only |
  | `CountryRules<T>` | `AddressValidationRules.cs:81` | `MaximumLength(AddressInvariants.CountryMaxLength)` only |

- **Depends on**: [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) (the
  `MMCA.Common.Shared.ValueObjects` constants that supply each `MaximumLength`, imported at
  `AddressValidationRules.cs:3`) and FluentValidation. These are the same fragment shape as the
  Level-0 [CommonValidationRules](#requiredstringrulest-optionalstringrulest-emailrulest-positiveintrulest-positivedecimalrulest-nonnegativeintrulest-passwordrulest-strongpasswordrulest)
  but pinned to address semantics; they sit at Level 4 because they reference the `AddressInvariants`
  constants rather than taking `maxLength` as a constructor argument.
- **Concept introduced, composable validation rule sets bound to domain invariants.**
  `[Rubric §24, Forms, Validation & UX Safety]`: each rule set extends `AbstractValidator<T>` and
  calls `RuleFor(selector)` once in its constructor, so the same `CityRules<T>` validates a bare
  [`Address`](group-02-domain-building-blocks.md#address) value object *and* any request DTO that
  embeds loose address fields without an `Address` wrapper (the class doc at `:25-29` calls this out
  explicitly). `[Rubric §1, SOLID]` (SRP): one rule set per field, and the limit comes from a single
  `AddressInvariants` constant so the max-length lives in exactly one place across the whole solution.
- **Walkthrough**: every constructor is a single `=>` expression body.
  `AddressLine1Rules<T>` (`:33-36`) is the only one with `NotEmpty()`; the other five take a nullable
  `Expression<Func<T, string?>>` selector and enforce `MaximumLength` only, matching the fact that
  lines 2 / city / state / zip / country are optional on the `Address` value object. Each `WithMessage`
  bakes the actual numeric limit in from its invariant constant (e.g. "City cannot be longer than
  {AddressInvariants.CityMaxLength} characters").
- **Why it's built this way**: different commands (create event, update profile, register) all carry
  address fields; each can `Include(new CityRules<CreateEventRequest>(p => p.City))` without
  copy-pasting the length limit, and a change to the canonical limit flows through `AddressInvariants`.
- **Where it's used**: assembled by [`AddressValidator`](#addressvalidator) for the `Address` value
  object, and included directly by module request validators in ADC and Store that embed address
  fields.

### AddressValidator
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:12` · Level 5 · class (sealed)

- **What it is**: a composite `AbstractValidator<Address>` that validates the whole
  [`Address`](group-02-domain-building-blocks.md#address) value object by `Include()`-ing the six
  field-level rule sets at Level 4.
- **Depends on**: [`Address`](group-02-domain-building-blocks.md#address) (the validated type) and the
  six field rule sets
  [`AddressLine1Rules<T>` … `CountryRules<T>`](#addressline1rulest-addressline2rulest-cityrulest-staterulest-zipcoderulest-countryrulest).
- **Concept**: composition over duplication: the address validator owns *no* `RuleFor` chains of its
  own; its entire body (`AddressValidationRules.cs:14-22`) is six `Include(new XRules<Address>(p => p.Field))`
  calls binding each rule set to the corresponding `Address` property. `[Rubric §15, Best Practices]`
  (no copy-paste validation; each field's rules are isolated and independently testable, see
  `AddressValidationRulesTests` in [group-25](group-27-testing-infrastructure.md#addressvalidationrulestests)).
  `[Rubric §24, Forms, Validation & UX Safety]`: this lives in `MMCA.Common.Application` so both ADC
  and Store reuse one framework-level address validator rather than each authoring its own.
- **Caveats / not-in-source**: the prior tier-05 edition described the six rule sets as "derived from
  `RequiredStringRules<T>`"; that is **stale**. As of the current source each of
  `AddressLine1Rules<T>`…`CountryRules<T>` extends `AbstractValidator<T>` **directly**
  (`AddressValidationRules.cs:30-87`), not `RequiredStringRules<T>`, they share only the *shape*, not
  an inheritance chain.
- **Where it's used**: referenced by command validators that carry an address (address-update flows in
  ADC and Store); like every validator here it is invoked by
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  in the CQRS pipeline before the handler executes.

### ValidationFailureExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:9` · Level 2 · class (static)

- **What it is**: a static class wrapping a C# `extension(ValidationResult)` block that adds one
  method, `ToErrors(string source)`, which converts FluentValidation's `ValidationFailure` entries into
  domain [`Error`](group-01-result-error-handling.md#error) instances. It is the single adapter that
  lets FluentValidation output flow into the codebase's Result pattern.

- **Depends on**: [`Error`](group-01-result-error-handling.md#error) (Level 1) and its
  [`ErrorType.Validation`](group-01-result-error-handling.md#errortype) classification; `FluentValidation.Results`
  (`ValidationResult`, `ValidationFailure`, NuGet).

- **Concept introduced, bridging FluentValidation to the Result pattern.**
  `[Rubric §15, Best Practices & Code Quality]` (assesses consistent, idiomatic conventions over
  one-off code; here the convention is *validators produce domain `Error`s, never raw strings or thrown
  exceptions*). FluentValidation validators (`AbstractValidator<T>`) produce a `ValidationResult` whose
  `Errors` are framework-specific `ValidationFailure` objects; the application pipeline needs those
  surfaced as a [`Result`](group-01-result-error-handling.md#result) failure carrying domain
  [`Error`](group-01-result-error-handling.md#error)s. This extension is the *only* seam where that
  translation happens, so the rest of the pipeline depends on neither FluentValidation's failure shape
  nor a hand-rolled mapping. It also touches `[Rubric §9, API & Contract Design]` (assesses uniform,
  standardized error responses): because each failure becomes an
  [`ErrorType.Validation`](group-01-result-error-handling.md#errortype) error (which the API layer maps
  to HTTP 400), validation failures look identical at the boundary regardless of which validator raised
  them.

- **Walkthrough**: the file is a static class (`:9`) holding a single `extension(ValidationResult result)`
  block (`:11`). Inside it, `ToErrors(string source)` (`:19`) projects `result.Errors` with a LINQ
  `Select` (`:20`) into one
  [`Error.Validation(...)`](group-01-result-error-handling.md#error) call per failure (`:21`), passing
  four arguments in order: the failure's `ErrorCode` → the error `code`, its `ErrorMessage` → the error
  `message`, the caller-supplied `source` → the error `source`, and its `PropertyName` → the error
  `target`. (`Error.Validation` is declared as `Validation(string code, string message, string? source = null, string? target = null)`
  in `MMCA.Common.Shared/Abstractions/Error.cs:37`, so `PropertyName` lands in the `target` slot,
  identifying *which* field failed.) The method returns `IEnumerable<Error>` lazily; the caller
  materializes it.

- **Why it's built this way**: the C# `extension(T)` syntax (see [primer §4](00-primer.md)) lets the
  conversion read as a natural method on `ValidationResult` (`result.ToErrors("X")`) without subclassing
  FluentValidation or adding a static helper that consumers must remember to call. It keeps the
  cross-cutting mapping co-located with its purpose and out of both `FluentValidation` and
  [`Error`](group-01-result-error-handling.md#error). Lazy `IEnumerable<Error>` defers the projection
  until the caller enumerates (the decorator immediately `.ToList()`s it).

- **Where it's used**: the sole call site is
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  (`MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:52`), which runs the
  command's [`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest)
  and, on failure, calls `validationResult.ToErrors(typeof(TCommand).Name).ToList()`, passing the
  command type name as `source`, then returns those errors as a
  [`Result`](group-01-result-error-handling.md#result) failure, short-circuiting the pipeline before the
  concrete handler runs.

- **Caveats / not-in-source**: the failure's `ErrorCode` is FluentValidation's per-rule code (e.g.
  `"NotEmptyValidator"`) unless a validator overrides it with `.WithErrorCode(...)`; this extension
  passes it through verbatim and does not normalize or validate it.


---
[⬅ CQRS: Commands, Queries & the Decorator Pipeline](group-05-cqrs-pipeline.md)  •  [Index](00-index.md)  •  [Persistence & EF Core ➡](group-07-persistence-ef-core.md)
