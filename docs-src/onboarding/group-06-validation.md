# 6. Validation

**What this group covers.** This is the framework-level **validation kit** that
`MMCA.Common.Application` ships so every module validates input the same way. It has four parts:
(1) a set of composable **FluentValidation rule sets**, eleven general-purpose ones in
`CommonValidationRules.cs` ([`RequiredStringRules<T>`](#requiredstringrulest),
[`OptionalStringRules<T>`](#optionalstringrulest), [`EmailRules<T>`](#emailrulest),
[`AbsoluteUrlRules<T>`](#absoluteurlrulest), [`PositiveIntRules<T>`](#positiveintrulest),
[`PositiveDecimalRules<T>`](#positivedecimalrulest), [`NonNegativeIntRules<T>`](#nonnegativeintrulest),
[`RequiredIdRules<T, TId>`](#requiredidrulest-tid),
[`OptionalPositiveIdRules<T, TId>`](#optionalpositiveidrulest-tid),
[`PasswordRules<T>`](#passwordrulest), [`StrongPasswordRules<T>`](#strongpasswordrulest)) plus the
six address-field rules ([`AddressLine1Rules<T>`](#addressline1rulest),
[`AddressLine2Rules<T>`](#addressline2rulest), [`CityRules<T>`](#cityrulest),
[`StateRules<T>`](#staterulest), [`ZipCodeRules<T>`](#zipcoderulest),
[`CountryRules<T>`](#countryrulest)) and the [`AddressValidator`](#addressvalidator) that assembles
them; (2) the shared helper that gives every one of those rules an optional machine-readable code,
[`OptionalErrorCodeExtensions`](#optionalerrorcodeextensions); (3) one **convention validator**,
[`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest), that
bridges a command to its request's validators; and (4) one **failure-mapping extension**,
[`ValidationFailureExtensions`](#validationfailureextensions), that turns FluentValidation output
into domain [`Error`](group-01-result-error-handling.md#error) values. Riding along in the same
namespace family is [`CurrentUserServiceExtensions`](#currentuserserviceextensions), the caller
guard that answers the other pre-execution question a handler asks ("is there an authenticated user
at all?"). The per-feature validators that consume all of this (ADC's `SessionEventIdRules<T>`,
Store's `ProductCategoryIdRules<T>`, Identity's `RegisterRequestValidator`) live in their module
chapters. The external library underneath is **FluentValidation 12**
([primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0)); nothing here hand-rolls
validation.

**Where validation sits in the request lifecycle.** Validation is not invoked by handlers. It is a
cross-cutting stage of the CQRS pipeline
([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), governed by
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html). The shipped command
chain runs FeatureGate -> Authorization -> Logging -> Caching -> **Validating** -> Timeout ->
Transactional -> handler, and the query chain is the same minus the transaction. Two decorators feed
on this chapter's types: [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:30`)
and [`ValidatingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#validatingquerydecoratortquery-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingQueryDecorator.cs:34`),
the second added by the ADR's 2026-08-26 revision so that a query carrying paging or filter input is
gated the same way a command is. Placement is the point: the Validating stage sits *before*
[`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult),
so an invalid command short-circuits before a database transaction is ever opened
(`ValidatingCommandDecorator.cs:23-26`). `[Rubric §6, CQRS & Event-Driven]` assesses whether reads
and writes are separated and whether cross-cutting behavior lives in the pipeline rather than inside
use cases: validation here is one decorator, not an `if (!valid) return` prologue copied into every
handler. `[Rubric §10, Cross-Cutting Concerns]` and `[Rubric §24, Forms, Validation & UX Safety]`
apply for the same reason: one gate, uniform for REST, gRPC, and event-consumer entry points alike.

**Every registered validator runs, and they run sequentially.** Both decorators materialize their
injected `IEnumerable<IValidator<T>>` into an array once
(`ValidatingCommandDecorator.cs:36`, `ValidatingQueryDecorator.cs:39`) and, when that array is empty,
call the inner handler untouched (`ValidatingCommandDecorator.cs:64`, `ValidatingQueryDecorator.cs:68`),
so a use case with no validator costs nothing. When validators exist, the decorator loops over **all**
of them and unions their failures (`ValidatingCommandDecorator.cs:73-83`,
`ValidatingQueryDecorator.cs:76-85`) rather than honoring only the first registration. That semantic
is deliberate and is recorded as the 2026-08-31 correction on ADR-014: a use case commonly carries a
module-authored validator beside a framework-supplied one, and stopping at the first registration
would turn the others into silently unenforced dead code
(`ValidatingCommandDecorator.cs:17-21`). The loop is sequential on purpose, not a `Task.WhenAll`: a
validator is free to reach the database through a scoped repository and a `DbContext` is not
thread-safe (`ValidatingCommandDecorator.cs:69-71`). Only when at least one failure is collected does
the decorator build a typed failure and return it without calling the handler
(`ValidatingCommandDecorator.cs:85-93`).

**The failure-mapping boundary.** FluentValidation speaks `ValidationResult` and `ValidationFailure`;
the rest of the codebase speaks the [Result pattern](group-01-result-error-handling.md#result)
([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)).
[`ValidationFailureExtensions`](#validationfailureextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:9`) is
the one-line bridge: a C# `extension(ValidationResult)` block
([primer §4](00-primer.md#c-extensiont-types-read-this-once)) whose `ToErrors(source)` projects each
failure into `Error.Validation(f.ErrorCode, f.ErrorMessage, source, f.PropertyName)`
(`ValidationFailureExtensions.cs:19-21`), which stamps
[`ErrorType.Validation`](group-01-result-error-handling.md#errortype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:37-38`). Each decorator passes the
use-case type name as the `source` (`ValidatingCommandDecorator.cs:82`,
`ValidatingQueryDecorator.cs:85`), so a downstream consumer can see which command or query produced
the failures, and the failing property name travels as the error's `target`. `ErrorType.Validation`
is what the edge maps to HTTP 400: the client-side reader carries the inverse mapping explicitly
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:105`), and the
severity table ranks `Validation` at the caller-can-fix-it end so a multi-error failure is never
downgraded from a 403 or 500 to a 400
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:46`). Nothing in the
domain references FluentValidation, and FluentValidation never sees an `Error`: neither library knows
the other exists, which is `[Rubric §3, Clean Architecture]` (dependencies point inward, the external
library stays at the Application boundary) and `[Rubric §9, API and Contract Design]` (one uniform
failure contract for every endpoint).

**The rule sets: composition over copy-paste.** Each rule class in
`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs` is a tiny
`AbstractValidator<T>` generic over the *parent* type, taking an `Expression<Func<T, ...>>` selector
in its constructor and declaring its rules in an expression-bodied constructor. Because they are
generic-plus-selector, the same [`EmailRules<T>`](#emailrulest)
(`CommonValidationRules.cs:64`) validates a value object, a request DTO, or a command; a module
composes it with FluentValidation's `Include(...)` instead of rewriting "non-empty, valid format, max
length" each time. The bounds are parameters, never literals in the rule: ADC's registration
validator passes `UserInvariants.EmailMaxLength` into `EmailRules<RegisterRequest>` and pairs it with
[`StrongPasswordRules<T>`](#strongpasswordrulest) and two
[`RequiredStringRules<T>`](#requiredstringrulest)
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:16-19`).
The two password rules are the one place a literal bound is intentional: both pin 8 and 128
characters (`CommonValidationRules.cs:179-180`, `:193-194`), and
[`StrongPasswordRules<T>`](#strongpasswordrulest) adds four complexity `Matches` rules for uppercase,
lowercase, digit, and non-alphanumeric (`CommonValidationRules.cs:195-198`). That pair is
`[Rubric §11, Security]` territory: the framework offers a weak-by-default floor and a strong
variant, and the module picks, so a consumer cannot accidentally ship a two-character password field.
`[Rubric §1, SOLID]` (one rule set, one responsibility; the composite assembles rather than
duplicates) and `[Rubric §15, Best Practices and Code Quality]` (no copy-pasted limits or messages)
are what the whole file is optimizing for.

**One field, one error code.** Every rule class takes an optional trailing `errorCode`, and
[`OptionalErrorCodeExtensions.WithOptionalErrorCode`](#optionalerrorcodeextensions)
(`CommonValidationRules.cs:19`, the method at `:30-32`) is the internal helper that applies it:
it returns the rule unchanged when the code is `null`, so every existing call site that omits it
behaves exactly as before, and calls FluentValidation's `WithErrorCode` when one is supplied. The
code is applied to **every** rule the class declares for that field, so one field answers under one
code (`CommonValidationRules.cs:11-18`); a field whose separate bounds must answer under distinct
codes still writes its own rules. This is what lets modules subclass a framework rule instead of
bypassing it: ADC's `SessionEventIdRules<T>` derives from
[`RequiredIdRules<T, TId>`](#requiredidrulest-tid) and passes `"Session.EventId.Required"`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:24-29`),
and Store's `ProductCategoryIdRules<T>` derives from
[`OptionalPositiveIdRules<T, TId>`](#optionalpositiveidrulest-tid) with
`"Product.CategoryId.Invalid"`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/Validation/ProductValidationRules.cs:47-51`).
The two id rules also encode a deliberate difference in what "missing" means:
[`RequiredIdRules<T, TId>`](#requiredidrulest-tid) uses `NotEmpty`, which rejects both `0` for an
integer key and `Guid.Empty` for a GUID key (`CommonValidationRules.cs:133-139`,
`:147`), while [`OptionalPositiveIdRules<T, TId>`](#optionalpositiveidrulest-tid) uses
`GreaterThan(default(TId))` on a nullable and relies on FluentValidation skipping a comparison rule
when the property is `null`, so "positive when provided" needs no `When` clause and no per-pass
recompiled selector (`CommonValidationRules.cs:154-158`, `:166`).

**One rule that shares its check with the domain.** [`AbsoluteUrlRules<T>`](#absoluteurlrulest)
(`CommonValidationRules.cs:85`) is the exception to "rule sets are self-contained": besides the
length bound it calls `Must(BeAnAbsoluteHttpUrl)` (`CommonValidationRules.cs:90`), and that predicate
delegates to [`CommonInvariants.EnsureUrlIsWellFormed`](group-02-domain-building-blocks.md#commoninvariants)
(`CommonValidationRules.cs:92-93`, the invariant at
`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:293-297`) and keeps only
its `IsSuccess`. The validator and the domain invariant therefore answer identically, by construction
rather than by convention. What it buys is concrete: a plain bounded-string treatment accepts
`javascript:` and `data:` values that become executable the moment a link or an image renders them,
and the invariant's own suppression note says the check must run on the untrusted *string*, before
anything constructs a `Uri` from it (`CommonInvariants.cs:289-292`). Null or empty passes, since the
fields are optional (`CommonInvariants.cs:295`). ADC applies it to every stored external link:
sponsor logo, website, and LinkedIn URLs
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:34`,
`:64`, `:82`), speaker LinkedIn and GitHub URLs
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:65`,
`:84`), and the event sponsorship-packet and ticketing URLs
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:85`,
`:105`). `[Rubric §11, Security]` assesses whether untrusted input is constrained at the boundary
before it reaches a rendering surface; this rule is where that happens for URLs.

**The address family, a worked example of composition.** The six rules in
`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs` follow the
same generic-plus-selector shape, and their length bounds come from
[`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) constants rather than
literals (`AddressValidationRules.cs:37`, `:47`, `:57`, `:67`, `:77`, `:87`), so the value object and
its validator cannot disagree. Only line 1 is required (`NotEmpty` at `AddressValidationRules.cs:36`);
the other five are max-length only. [`AddressValidator`](#addressvalidator)
(`AddressValidationRules.cs:13`) then `Include`s all six against the
[`Address`](group-02-domain-building-blocks.md#address) value object
(`AddressValidationRules.cs:17-22`). Consumers pick whichever half they need: ADC and Store's
registration validators and Store's customer create and change-address validators attach the whole
composite with `SetValidator(new AddressValidator())`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:22`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:36`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/UseCases/Create/CustomerCreateRequestValidator.cs:20`,
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/UseCases/ChangeAddress/CustomerChangeAddressRequestValidator.cs:18`),
while a DTO that flattens address fields without an `Address` wrapper can include the individual
rule sets instead (`AddressValidationRules.cs:9-11`).

**Convention over configuration: the request-to-command bridge.** Most commands wrap a request record
and implement [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:14`). Rather than
make module authors write a validator for both the request and the command,
[`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:30`) takes
the whole `IEnumerable<IValidator<TRequest>>` from the container, de-duplicates it by runtime type so
an assembly scanned twice does not report each failure twice, and attaches each one with
`RuleFor(c => c.Request).SetValidator(validator)` (`CommandRequestValidator.cs:33-41`). The wiring is
reflective and lives in the module scan: `ScanModuleApplicationServices`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:179`) first calls
FluentValidation's `AddValidatorsFromAssembly` to pick up every hand-written validator by convention
(`DependencyInjection.cs:250`), then walks the assembly for types implementing
`ICommandWithRequest<>`, constructs the closed `CommandRequestValidator<TCommand, TRequest>`, and
registers it as `IValidator<TCommand>` with **`TryAddTransient`**, so an explicitly authored command
validator always wins (`DependencyInjection.cs:252-268`). Common's own validators are registered
separately in `AddApplication` via `AddValidatorsFromAssemblyContaining<ClassReference>()`, because
the per-module scan only sees the module's own assembly (`DependencyInjection.cs:46-49`); that call
is what puts [`AddressValidator`](#addressvalidator) in the container. For a command the reflective
scan cannot see, for example a closed generic constructed at registration time,
`AddCommandRequestValidator<TCommand, TRequest>()` (`DependencyInjection.cs:475-478`) is the explicit
form of the same registration, with the same `TryAdd` precedence. `[Rubric §2, Design Patterns]`
(convention over configuration, plus the Decorator pattern the gate itself rides on) and
`[Rubric §16, Maintainability]` (a new command inherits validation without a registration line) both
land here.

**The caller guard that travels with this group.**
[`CurrentUserServiceExtensions`](#currentuserserviceextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/CurrentUserServiceExtensions.cs:9`) is
not FluentValidation, but it answers the other question asked before a handler does work: it collapses
the read-then-null-check-then-fail block into
`RequireUserId(code, message, errorType, source)` on
[`ICurrentUserService`](group-08-auth.md#icurrentuserservice), returning
`Result<UserIdentifierType>` and defaulting to `ErrorType.Forbidden` with the shared
`"Access denied."` message (`CurrentUserServiceExtensions.cs:12`, `:35-46`). The error *code* stays a
parameter because it names the module, which the framework cannot know. ADC's Engagement handlers use
it as their first statement (`"CheckIns.Forbidden"` in the five check-in handlers, for example
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/CheckIns/UseCases/CheckInAttendee/CheckInAttendeeHandler.cs:33`,
and `"Points.Forbidden"` in the two points handlers, for example
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/UseCases/GetMyPoints/GetMyPointsHandler.cs:40`).
Adopting it moved those codes out of the modules and into framework arguments, which is visible in
governance: ADC's error-catalog fitness test lowered its scanned-code floor to 57 to account for
codes the scanner can no longer see as module literals
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ErrorCatalogTests.cs:88-106`). That is
`[Rubric §34, Architecture Governance and Documentation]` at work: a shared abstraction is not
adopted until the tests that measure the codebase are updated to match.

**End to end, concretely.** A request arrives at a controller or endpoint, is mapped to a command, and
is dispatched. The pipeline reaches the Validating stage, which resolves every `IValidator<TCommand>`
the container holds: hand-written ones found by the assembly scan, plus the auto-registered
`CommandRequestValidator` that forwards to the request's validators. Those validators run the composed
rule sets: ADC's session rules, for instance, derive `SessionTitleRules<T>` from
[`RequiredStringRules<T>`](#requiredstringrulest) and `SessionEventIdRules<T>` from
[`RequiredIdRules<T, TId>`](#requiredidrulest-tid)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:13-14`,
`:24-25`). If every validator passes, the Timeout and Transactional
decorators run and the handler executes inside a transaction. If any fails, `ToErrors` converts the
union of failures into `ErrorType.Validation` errors, the decorator logs a debug line naming the
command and the error count (`ValidatingCommandDecorator.cs:96-106`) and returns a failed `Result`
**without touching the database**; the edge maps it to a 400 with per-property messages. All of it
lives in `MMCA.Common.Application` so ADC, Store, and Helpdesk inherit the same email, password,
address, id, and URL rules and the same auto-validation convention. Module validators express only
domain-specific rules on top. There is no ADR dedicated to validation: it is governed by
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) for the gate and its
placement, [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) for the failure
contract the gate emits, and by the architecture fitness tests that keep the layering honest.

### OptionalErrorCodeExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:19` · Level 0 · class (internal static)

- **What it is**: a one-method internal helper that lets every reusable rule fragment in
  `CommonValidationRules.cs` accept an *optional* machine-readable error code without any of them
  branching on it. Given a code it stamps the rule with FluentValidation's `WithErrorCode`; given
  `null` it hands the rule straight back untouched.

- **Depends on**: FluentValidation's `IRuleBuilderOptions<T, TProperty>` (NuGet, imported at
  `CommonValidationRules.cs:3`). No first-party dependencies: this is the lowest primitive in the
  validation kit. Every rule class in the same file calls it, and its output feeds
  [`ValidationFailureExtensions`](#validationfailureextensions), which copies the failure's
  `ErrorCode` onto the domain [`Error`](group-01-result-error-handling.md#error).

- **Concept introduced, the machine-readable error code alongside the human message.**
  A FluentValidation failure carries two independent strings: a `ErrorMessage` meant for a person and
  an `ErrorCode` meant for a program. Left alone, FluentValidation fills the code with the *validator's*
  name (`"NotEmptyValidator"`, `"MaximumLengthValidator"`), which is useless to a caller that wants to
  branch on "the question text was missing" rather than "some non-empty rule failed somewhere". The
  class remarks (`CommonValidationRules.cs:11-18`) record the failure mode this helper exists to close:
  module validators used to skip the shared bases entirely and hand-write the rule chain for the single
  reason that the bases set a message but no code, so a validator needing a stable code had nothing to
  compose with. `[Rubric §9, API & Contract Design]` assesses whether the contract a client codes
  against is stable and uniform; a caller-supplied code such as `"Sponsor.EventId.Required"` is part of
  that contract, where the FluentValidation default is an implementation detail that would change if
  the rule were re-expressed. `[Rubric §16, Maintainability]`: because the code rides in as one optional
  constructor argument, adding a coded rule never forks the shared fragment into a bespoke copy.
  One deliberate consequence, spelled out in the same remarks: the code is applied to **every** rule the
  fragment declares for that field, so one field answers under one code, and a field whose bounds must
  answer under *distinct* codes still declares its own rules rather than reusing a fragment.

- **Walkthrough**: the class is `internal static` (`:19`), so it is invisible outside
  `MMCA.Common.Application`; consumers reach the behavior only through the `errorCode` parameter on the
  rule classes. Its single member, `WithOptionalErrorCode<T, TProperty>` (`:30-32`), is an extension
  method on `IRuleBuilderOptions<T, TProperty>` with an expression body that reads
  `errorCode is null ? rule : rule.WithErrorCode(errorCode)`. Returning the *same* `IRuleBuilderOptions`
  in the null case is what makes it chainable in the middle of a fluent rule chain, and is what
  preserves byte-for-byte the behavior of the many callers that omit the code
  (`:22-23` documents exactly that intent).

- **Why it's built this way**: the alternative (an `if` inside each of the eleven rule constructors)
  would have broken their single-expression bodies and repeated the null check eleven times. Making it
  an extension keeps every fragment a one-liner while giving the whole file a uniform optional-code
  behavior.

- **Where it's used**: every rule chain in `CommonValidationRules.cs` (`:45-46`, `:57`, `:68-70`,
  `:89-90`, `:104`, `:115`, `:126`, `:147`, `:166`, `:178-180`, `:192-198`). The address fragments in
  `AddressValidationRules.cs` do **not** use it: they take no `errorCode` parameter at all.

### RequiredStringRules<T>, OptionalStringRules<T>, EmailRules<T>, PositiveIntRules<T>, PositiveDecimalRules<T>, NonNegativeIntRules<T>, RequiredIdRules<T, TId>, OptionalPositiveIdRules<T, TId>, PasswordRules<T>, StrongPasswordRules<T>

> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs` · Level 0 · classes (`AbstractValidator<T>` subclasses)

- **What it is**: ten reusable FluentValidation rule fragments, each enforcing exactly one field
  contract (a required string with a length ceiling, a positive integer, a supplied identifier, a
  strong password). A request or command validator composes them with FluentValidation's `Include()`
  instead of restating the same `RuleFor` chain. Each member, with its source line and the rule chain
  its constructor builds:

  | Type | File:Line | Rule chain (all with `.WithOptionalErrorCode(errorCode)` per rule) |
  |------|-----------|-------------------------------------------------------------------|
  | `RequiredStringRules<T>` | `CommonValidationRules.cs:41` | `NotEmpty()` + `MaximumLength(maxLength)` |
  | `OptionalStringRules<T>` | `CommonValidationRules.cs:53` | `MaximumLength(maxLength)` only (nullable selector, null passes) |
  | `EmailRules<T>` | `CommonValidationRules.cs:64` | `NotEmpty()` + `EmailAddress()` + `MaximumLength(maxLength)` |
  | `PositiveIntRules<T>` | `CommonValidationRules.cs:100` | `GreaterThan(0)` over `int` |
  | `PositiveDecimalRules<T>` | `CommonValidationRules.cs:111` | `GreaterThan(0)` over `decimal` |
  | `NonNegativeIntRules<T>` | `CommonValidationRules.cs:122` | `GreaterThanOrEqualTo(0)` over `int` |
  | `RequiredIdRules<T, TId>` | `CommonValidationRules.cs:142` | `NotEmpty()` over `TId : notnull` (rejects `0` and `Guid.Empty`) |
  | `OptionalPositiveIdRules<T, TId>` | `CommonValidationRules.cs:161` | `GreaterThan(default(TId))` over `TId?` (null passes) |
  | `PasswordRules<T>` | `CommonValidationRules.cs:174` | `NotEmpty()` + `MinimumLength(8)` + `MaximumLength(128)` |
  | `StrongPasswordRules<T>` | `CommonValidationRules.cs:188` | all of `PasswordRules<T>` plus four `Matches(...)` regexes |

  The eleventh class in the file, [`AbsoluteUrlRules<T>`](#absoluteurlrulest), is a Level 6 sibling
  (it reaches into a domain invariant) and is covered separately.

- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, primer §3),
  `System.Linq.Expressions.Expression<Func<T, ...>>` and `System.Globalization.CultureInfo` (BCL,
  `CommonValidationRules.cs:1-3`), and the file-local
  [`OptionalErrorCodeExtensions`](#optionalerrorcodeextensions). No first-party dependencies beyond
  that: these sit at the very bottom of the Application layer, which is why they carry no invariant
  constants and take `maxLength` as an argument. Bridged onto commands automatically by
  [`CommandRequestValidator<TCommand, TRequest>`](#commandrequestvalidatortcommand-trequest).

- **Concept introduced, reusable FluentValidation rule fragments via `Include()`.**
  This is the first place the guide meets FluentValidation's *fragment composition* idiom. Rather than
  each validator owning a long `RuleFor(...)` chain, a fragment is a tiny `AbstractValidator<T>` whose
  constructor declares **one** field's rules, and a real validator pulls it in with
  `Include(new RequiredStringRules<RegisterRequest>(x => x.FirstName, "First name", UserInvariants.FirstNameMaxLength))`
  (a live example at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:18`).
  Two design choices make a fragment reusable across unrelated types: it is **generic over `T`** (the
  parent that holds the field), and it takes a **selector expression** rather than inheriting from that
  parent, so the same `EmailRules<T>` validates a `RegisterRequest`, a bare value object, or a command
  with no inheritance coupling. `[Rubric §24, Forms, Validation & UX Safety]` assesses whether
  validation is defined once and reused rather than copy-pasted across create and update paths; these
  fragments are the framework's answer. `[Rubric §1, SOLID]`: each fragment has one responsibility (one
  field contract), so tightening the minimum password length is a one-line edit in one file rather than
  a search-and-replace across every module. `[Rubric §11, Security]` applies narrowly to the two
  password fragments: the complexity policy is expressed once, in framework code that both apps consume,
  so no module can accidentally ship a weaker one.

- **Walkthrough**: every constructor is a single expression body (`=>` returning the configured
  `RuleFor` chain), which is why these classes are so terse. Each ends its parameter list with
  `string? errorCode = null`.
  - `RequiredStringRules<T>` (`:43-46`) takes `(selector, fieldName, maxLength, errorCode)` and chains
    `NotEmpty().WithMessage($"You must enter a {fieldName}")` then `MaximumLength(maxLength)`. The
    `fieldName` is interpolated into the human message, so one fragment yields "You must enter a Title"
    or "You must enter a First name". The length message is built with
    `string.Create(CultureInfo.InvariantCulture, $"...")` (`:46`) so the numeric limit formats
    identically whatever the ambient culture is.
  - `OptionalStringRules<T>` (`:55-57`) drops the `NotEmpty`; its selector is `Func<T, string?>` and
    only the ceiling is enforced.
  - `EmailRules<T>` (`:66-70`) inserts FluentValidation's built-in `EmailAddress()` between `NotEmpty`
    and `MaximumLength`, with the message "You must enter a valid {fieldName}" (`:69`).
  - `PositiveIntRules<T>`, `PositiveDecimalRules<T>` and `NonNegativeIntRules<T>` (`:102-104`,
    `:113-115`, `:124-126`) take only `(selector, fieldName, errorCode)`, no length, and emit one
    comparison rule each. The first two share the message "{fieldName} must be a positive value"; the
    third reads "{fieldName} must be greater than or equal to 0".
  - `RequiredIdRules<T, TId>` (`:142-147`) is constrained `where TId : notnull` (`:143`) and uses
    `NotEmpty()`. The remarks (`:133-139`) explain why that operator and not `GreaterThan(0)`:
    `NotEmpty` rejects `0` for an integer key **and** `Guid.Empty` for a `Guid` key, which is exactly
    what "no id was supplied" looks like on the wire for both shapes. Its message interpolates the
    field phrase verbatim into "You must specify {fieldName}", so the caller supplies the article and
    any qualifier, for example `"an Event for the Sponsor"`
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:119`).
  - `OptionalPositiveIdRules<T, TId>` (`:161-166`) is constrained
    `where TId : struct, IComparable<TId>, IComparable` (`:162`), takes a nullable
    `Expression<Func<T, TId?>>` selector and applies `GreaterThan(default(TId))`. The remarks
    (`:154-158`) record the mechanism that keeps it cheap: FluentValidation skips a comparison rule
    when the nullable property holds `null`, so "must be positive *when provided*" needs no `When`
    clause and no selector recompiled per validation pass.
  - `PasswordRules<T>` (`:176-180`) takes only `(selector, errorCode)`: its messages are fixed strings,
    not parameterized by a field name. It enforces non-empty plus a length band of 8 to 128.
  - `StrongPasswordRules<T>` (`:190-198`) repeats that band and adds four `Matches(...)` calls whose
    regex literals are inline in the source: `"[A-Z]"`, `"[a-z]"`, `"\\d"` and `"[^a-zA-Z\\d]"` for
    uppercase, lowercase, digit and special character (`:195-198`). The doc comment on `PasswordRules`
    (`:170-171`) points callers who need complexity at `StrongPasswordRules<T>` instead.

- **Why it's built this way**: these fragments are the DRY core of the validation story. Because they
  live in `MMCA.Common.Application` and are generic, both ADC and Store inherit identical, tested field
  rules. `[Rubric §33, Developer Experience]`: a new request validator in any module reads as a short
  list of `Include(...)` calls, and a framework-level tightening propagates to every consumer on the
  next package bump instead of being missed in some forgotten validator. There is no dedicated ADR for
  validation; it is governed implicitly by the CQRS decorator design and the layering rules the
  architecture fitness tests enforce.

- **Where it's used**: modules consume them two ways. **By subclassing**, to bind a domain's invariant
  constant and error code once: `SpeakerFirstNameRules<T> : RequiredStringRules<T>`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:12-17`),
  `SponsorEventIdRules<T> : RequiredIdRules<T, EventIdentifierType>`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:115-120`),
  `ProductCategoryIdRules<T> : OptionalPositiveIdRules<T, CategoryIdentifierType>`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/Validation/ProductValidationRules.cs:46-51`),
  and `CustomerEmailRules<T> : EmailRules<T>`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/Validation/CustomerValidationRules.cs:33-34`).
  **By direct inclusion**, when no domain constant is involved: ADC's `RegisterRequestValidator`
  includes `EmailRules`, `StrongPasswordRules` and two `RequiredStringRules`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:16-19`),
  and `ChangePasswordRequestValidator` includes `StrongPasswordRules` for the new password
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:18`).
  Whichever validator wins, it is invoked by
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  before the handler runs. Behavior is pinned by `CommonValidationRulesTests` in
  [group-27](group-27-testing-infrastructure.md#commonvalidationrulestests), which exercises both the
  message and the optional-code path for each fragment
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:440-538`).

### CommandRequestValidator<TCommand, TRequest>

> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:30` · Level 1 · class (sealed)

- **What it is**: an auto-registered `AbstractValidator<TCommand>` for any command implementing
  [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest). It
  validates the command by delegating to the `IValidator<TRequest>` registrations for the embedded
  request payload, so a module author writes rules for the request only and the command is validated
  for free.

- **Depends on**: [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (Level 0; its `Request` property is the bridge, declared at
  `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:17`) and
  FluentValidation's `AbstractValidator<T>` / `IValidator<T>` / `SetValidator`. Registered by the
  Application-layer [`DependencyInjection`](group-14-module-system-composition.md#dependencyinjection)
  scan.

- **Concept introduced, convention-over-configuration validation.** `[Rubric §2, Design Patterns]`
  assesses whether recurring structure is handled by a named, reusable mechanism instead of repeated by
  hand; `[Rubric §9, API & Contract Design]` assesses whether input validation is applied uniformly at
  the edge. Most write-side commands are thin wrappers carrying a request DTO, for example
  `CreateSessionCommand(CreateSessionRequest Request)`. Without this type a module would have to
  register a validator for both the request *and* the command. Instead the framework closes
  `CommandRequestValidator<TCommand, TRequest>` over the pair and routes command validation into the
  request's registered validators.

- **Walkthrough**: the class is sealed and constrained `where TCommand : ICommandWithRequest<TRequest>`
  (`:30-31`), which is what makes the `c.Request` selector compile. The constructor (`:33-41`) receives
  `IEnumerable<IValidator<TRequest>>` by DI, null-guards it with `ArgumentNullException.ThrowIfNull`
  (`:35`), then iterates `requestValidators.DistinctBy(v => v.GetType())` (`:37`) and calls
  `RuleFor(c => c.Request).SetValidator(validator)` once per surviving validator (`:39`). Three
  behaviors follow from those five lines, each documented on the class:
  - **Every** registered validator for the request runs, not just the first (`:11-17`). That matches the
    policy the command and query decorators already apply to `IValidator<TCommand>`: a module that
    authors a validator beside a framework-supplied one expects both rule sets enforced, and honoring
    only the first registration would turn the rest into dead code. FluentValidation unions the
    failures of rules placed on one property.
  - Registrations are **de-duplicated by runtime type** (`:18-21`), so a validator class registered
    twice (a module assembly scanned twice, say) reports each failure once rather than in duplicate.
  - An **empty** collection is not an error: the loop simply adds no rule, and the bridge is a no-op for
    a request with no rules (the same point is made at
    `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:475-476`).

- **Why it's built this way**: it removes the most common piece of validation boilerplate (restating
  request rules at the command level) while staying overridable. Registration is by `TryAdd`, so the
  convention never blocks a bespoke case. Two registration paths exist, both using `TryAddTransient`:
  the reflection scan in `ScanModuleApplicationServices` walks the module assembly for commands
  implementing `ICommandWithRequest<>`, builds the closed generic and registers it
  (`DependencyInjection.cs:252-268`, `TryAddTransient` at `:267`) after
  `services.AddValidatorsFromAssembly(moduleAssembly)` has already picked up every hand-written
  validator (`:250`); and the explicit helper `AddCommandRequestValidator<TCommand, TRequest>()`
  (`DependencyInjection.cs:475-479`) does the same thing for one pair, which is how the generic
  create/update/delete registration helpers wire their commands (`:349`, `:405`, `:454`). Because the
  explicit `IValidator<TCommand>` is registered first, it always wins.

- **Where it's used**: the closed generic is registered per command during module scanning. At runtime
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  injects `IEnumerable<IValidator<TCommand>>` and materializes it into an array
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:33`,
  `:36`), skips validation entirely when the array is empty (`:64`), and otherwise runs every validator
  in turn (`:73`), accumulating failures through
  [`ValidationFailureExtensions.ToErrors`](#validationfailureextensions) (`:82`). Covered by
  `CommandRequestValidatorTests` in
  [group-27](group-27-testing-infrastructure.md#commandrequestvalidatortests).

### AddressLine1Rules<T>, AddressLine2Rules<T>, CityRules<T>, CountryRules<T>

> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs` · Level 4 · classes (sealed, `AbstractValidator<T>`)

- **What it is**: four of the six per-field address rule fragments, each generic over the parent type
  `T` and configured with a selector expression, each pinning its length ceiling to an
  [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) constant rather than a
  literal. The remaining two of the six, [`StateRules<T>`](#staterulest) and
  [`ZipCodeRules<T>`](#zipcoderulest), have the identical shape and are covered alongside their
  composite, [`AddressValidator`](#addressvalidator).

  | Type | File:Line | Rule chain | Effective limit |
  |------|-----------|------------|-----------------|
  | `AddressLine1Rules<T>` | `AddressValidationRules.cs:31` | `NotEmpty()` + `MaximumLength(AddressInvariants.AddressLine1MaxLength)` | 200 |
  | `AddressLine2Rules<T>` | `AddressValidationRules.cs:42` | `MaximumLength(AddressInvariants.AddressLine2MaxLength)` only | 200 |
  | `CityRules<T>` | `AddressValidationRules.cs:52` | `MaximumLength(AddressInvariants.CityMaxLength)` only | 100 |
  | `CountryRules<T>` | `AddressValidationRules.cs:82` | `MaximumLength(AddressInvariants.CountryMaxLength)` only | 100 |

  The limits are `public static readonly int` fields on `AddressInvariants`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:12`, `:15`, `:18`,
  `:27`), the same constants the EF entity configurations use, so the column width and the validator
  cannot drift apart.

- **Depends on**: [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) from
  `MMCA.Common.Shared.ValueObjects` (imported at `AddressValidationRules.cs:4`), FluentValidation, and
  `System.Globalization` / `System.Linq.Expressions` from the BCL (`:1-2`). They share the *shape* of
  the Level 0 fragments in
  [CommonValidationRules](#requiredstringrulest-optionalstringrulest-emailrulest-positiveintrulest-positivedecimalrulest-nonnegativeintrulest-requiredidrulest-tid-optionalpositiveidrulest-tid-passwordrulest-strongpasswordrulest)
  but not an inheritance chain, and they sit at Level 4 precisely because they reference the invariant
  constants instead of taking `maxLength` as an argument.

- **Concept introduced, a validation fragment bound to a domain invariant.** The Level 0 fragments are
  policy-free: the caller supplies the number. These four bake in the canonical number by reading it
  from the shared invariant class, which is the right trade when the field has exactly one meaning
  across the whole solution (an address line is an address line in every module).
  `[Rubric §4, DDD]` assesses whether domain rules live in one authoritative place rather than being
  restated per use case; here the length policy lives with the
  [`Address`](group-02-domain-building-blocks.md#address) value object's invariants and the validator
  merely reads it. `[Rubric §24, Forms, Validation & UX Safety]`: because each fragment is generic over
  `T` and selector-driven, the same `CityRules<T>` validates a bare `Address` value object *and* a
  request DTO that carries loose address fields with no `Address` wrapper, a reuse the class doc calls
  out explicitly (`AddressValidationRules.cs:9-12`). `[Rubric §1, SOLID]` (SRP): one fragment per field.

- **Walkthrough**: all four are `sealed` and each constructor is a single `=>` expression body.
  `AddressLine1Rules<T>` (`:34-37`) is the only one of the six with `NotEmpty()`, matching the domain
  invariant `AddressInvariants.EnsureAddressLine1IsValid`, which is likewise the only field check
  `EnsureAddressIsValid` performs
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:34-40`). Its selector
  is a non-nullable `Expression<Func<T, string>>`. The other three take a nullable
  `Expression<Func<T, string?>>` (`:45`, `:55`, `:85`) and enforce `MaximumLength` only, matching the
  fact that line 2, city and country are optional on the value object. Every `WithMessage` interpolates
  the actual numeric limit through `string.Create(CultureInfo.InvariantCulture, $"...")` (`:37`, `:47`,
  `:57`, `:87`), so the message a user sees quotes the same number the constant holds and formats
  culture-independently. Unlike the Level 0 fragments these constructors take **no** `errorCode`
  parameter, so their failures carry FluentValidation's default codes
  (`"NotEmptyValidator"`, `"MaximumLengthValidator"`).

- **Why it's built this way**: several commands across both apps carry address fields; each can
  `Include(new CityRules<CreateEventRequest>(p => p.City))` without copy-pasting a limit, and a change
  to the canonical limit flows from `AddressInvariants` into every validator and every EF configuration
  at once. Splitting one address validator into six per-field fragments is what allows a DTO with only
  *some* address fields to reuse the relevant subset.

- **Where it's used**: within the current source their only production consumer is
  [`AddressValidator`](#addressvalidator), which includes each of them bound to the corresponding
  `Address` property (`AddressValidationRules.cs:17-19`, `:22`). They are covered directly by
  `AddressValidationRulesTests` in
  [group-27](group-27-testing-infrastructure.md#addressvalidationrulestests)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:19`,
  `:55`, `:82`, `:130`).

- **Caveats / not-in-source**: an earlier edition of this guide described these fragments as derived
  from `RequiredStringRules<T>`. That is stale: each extends `AbstractValidator<T>` directly
  (`AddressValidationRules.cs:31-32`, `:42-43`, `:52-53`, `:82-83`). No ADC or Store validator
  currently includes them directly; the reuse-outside-`Address` scenario the class doc describes is
  supported by the design but has no consumer in the source today.

### StateRules<T>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:62` · Level 4 · class (sealed)

- **What it is**: a one-rule FluentValidation fragment for the optional `State` field of a postal
  address. It is generic over the parent type `T` and takes a selector expression, so it can be
  included by any validator whose model carries a state / province / region string, not only by a
  validator for the [`Address`](group-02-domain-building-blocks.md#address) value object.
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0)),
  `System.Linq.Expressions.Expression<Func<T, string?>>` (BCL), and
  [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) for the length ceiling
  (`MMCA.Common.Shared.ValueObjects`, imported at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:4`). It sits at
  Level 4 purely because of that constant reference: structurally it is the same fragment shape as the
  Level-0 [`OptionalStringRules<T>`](#optionalstringrulest).
- **Concept**: the reusable rule-fragment idiom introduced by
  [`RequiredStringRules<T>`](#requiredstringrulest) and the other
  `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs` fragments,
  specialised to one address field. `[Rubric §1, SOLID]` assesses whether each unit has one reason to
  change; this class has exactly one, the state field's contract, and the number that expresses that
  contract lives in a single shared constant rather than being retyped at each call site.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether validation is defined once and reused
  across create and update paths instead of copy-pasted; including this fragment is how a request
  validator gets the state rule without restating it.
- **Walkthrough**: the whole class is a constructor with an expression body
  (`AddressValidationRules.cs:65-67`). It takes `Expression<Func<T, string?>> selector` and calls
  `RuleFor(selector).MaximumLength(AddressInvariants.StateMaxLength)`. The selector is **nullable**
  (`string?`), which encodes the fact that state is optional on
  [`Address`](group-02-domain-building-blocks.md#address)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:32` declares `State` as
  `string?`): there is no `NotEmpty()` in the chain, so `null` and `""` both pass and only an
  over-length value fails. The message is built with
  `string.Create(CultureInfo.InvariantCulture, $"State cannot be longer than {AddressInvariants.StateMaxLength} characters")`
  (`:67`), so the number a user sees is the same constant the rule enforces, and the interpolation is
  culture-invariant rather than dependent on the ambient culture of the validating thread. The current
  value of that constant is `100`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:21`).
- **Why it's built this way**: `AddressInvariants` is described in its own doc comment as the single
  place the max lengths are shared with "EF entity configurations and FluentValidation validators"
  (`AddressInvariants.cs:5-7`). Binding the fragment to the constant rather than to a literal is what
  keeps the request-level rule, the domain invariant, and the column width from drifting apart.
- **Where it's used**: composed into [`AddressValidator`](#addressvalidator) at
  `AddressValidationRules.cs:20`, and available for direct `Include(...)` by any module request
  validator whose DTO carries loose address fields. It is exercised directly by
  [`AddressValidationRulesTests`](group-27-testing-infrastructure.md#addressvalidationrulestests)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:98`),
  which builds `new StateRules<TestAddressModel>(p => p.State)` against a model type unrelated to
  `Address` and is therefore a live demonstration that the fragment is genuinely parent-agnostic.
- **Caveats / not-in-source**: the rule is length-only. There is no format, enumeration, or
  country-aware check on the state value anywhere in this class.

### ZipCodeRules<T>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:72` · Level 4 · class (sealed)

- **What it is**: the same one-rule fragment shape as [`StateRules<T>`](#staterulest), bound to the
  optional `ZipCode` field and its own length constant.
- **Depends on**: FluentValidation's `AbstractValidator<T>`, a nullable selector expression, and
  [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants).
- **Concept**: no new concept. See [`StateRules<T>`](#staterulest) for the fragment idiom and the
  `[Rubric §24, Forms, Validation & UX Safety]` treatment; this section records only what differs.
- **Walkthrough**: the constructor body (`AddressValidationRules.cs:75-77`) is
  `RuleFor(selector).MaximumLength(AddressInvariants.ZipCodeMaxLength)` with the message
  "Zip Code cannot be longer than {n} characters", again built through
  `string.Create(CultureInfo.InvariantCulture, ...)`. `ZipCodeMaxLength` is `20`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:24`), the tightest of
  the six address constants, and the field is nullable on the value object
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:36`), so an absent postal code
  is valid.
- **Why it's built this way**: postal-code formats differ by country, so the framework-level rule
  deliberately bounds length only and leaves any national format rule to the module that knows the
  country context. Twenty characters is wide enough for the punctuated formats used outside the United
  States while still bounding the string for storage and for the EF column width that shares the
  constant.
- **Where it's used**: included by [`AddressValidator`](#addressvalidator) at
  `AddressValidationRules.cs:21`, and covered in isolation by
  [`AddressValidationRulesTests`](group-27-testing-infrastructure.md#addressvalidationrulestests)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:114`),
  which asserts a failure at `ZipCodeMaxLength + 1` characters rather than at a hard-coded 21, so the
  test moves with the constant.

### AddressValidator
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:13` · Level 5 · class (sealed)

- **What it is**: the composite `AbstractValidator<Address>` for the whole
  [`Address`](group-02-domain-building-blocks.md#address) value object. It declares no rules of its
  own: its entire body is six `Include(...)` calls that bind the six per-field fragments to the six
  `Address` properties.
- **Depends on**: [`Address`](group-02-domain-building-blocks.md#address) (the validated type, imported
  at `AddressValidationRules.cs:4`) and the six Level-4 fragments
  [`AddressLine1Rules<T>`](#addressline1rulest), [`AddressLine2Rules<T>`](#addressline2rulest),
  [`CityRules<T>`](#cityrulest), [`StateRules<T>`](#staterulest), [`ZipCodeRules<T>`](#zipcoderulest),
  and [`CountryRules<T>`](#countryrulest). Through those it depends transitively on
  [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants), and on FluentValidation.
- **Concept introduced, composing a value-object validator out of field fragments.**
  `[Rubric §2, Design Patterns]` assesses whether recognised patterns are applied where they earn their
  keep; this is composition rather than inheritance, and FluentValidation's `Include()` is the
  mechanism: including a validator of the *same* generic argument merges its rules into the including
  validator's rule set, so a failure surfaces with the field's own property name and message exactly as
  it would if the fragment ran standalone. `[Rubric §24, Forms, Validation & UX Safety]` assesses reuse
  of validation across paths: because the composite lives in `MMCA.Common.Application` rather than in a
  module, ADC and Store validate an address identically, and the six fragments stay independently
  includable for the request DTOs that carry loose address fields without an `Address` wrapper (a case
  the class doc calls out explicitly at `AddressValidationRules.cs:8-12`).
  `[Rubric §14, Testability]`: because each field's rule is a separate type, a test can construct one
  fragment over a throwaway model, which is what
  [`AddressValidationRulesTests`](group-27-testing-infrastructure.md#addressvalidationrulestests) does
  before also exercising the assembled composite
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:10`
  holds the shared `AddressValidator` instance; `:144` is the all-fields-valid case).
- **Walkthrough**: the constructor (`AddressValidationRules.cs:15-23`) runs six statements in property
  order: `Include(new AddressLine1Rules<Address>(p => p.AddressLine1))` (`:17`), then
  `AddressLine2Rules` (`:18`), `CityRules` (`:19`), `StateRules` (`:20`), `ZipCodeRules` (`:21`), and
  `CountryRules` (`:22`). Each fragment is closed over `Address` as its `T`, and each selector picks the
  matching property. `AddressLine1Rules<Address>` is the only fragment in the set that contributes a
  `NotEmpty()` (`AddressValidationRules.cs:36`), which is what makes address line 1 the single required
  field of the value object; every other `Include` contributes a max-length bound only. The class is
  `sealed` and holds no state beyond the rules its constructor registers, so a call site can safely
  construct one per use.
- **Why it's built this way**: the same invariants are also enforced inside the domain by
  `AddressInvariants.EnsureAddressIsValid`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:35`), which the
  `Address` factory calls. The validator exists so a bad address is rejected at the application
  boundary with a per-field, user-facing message instead of surfacing as a single factory failure after
  the command has already entered the pipeline; both paths read the same constants, so they cannot
  disagree on the bounds.
- **Where it's used**: module request validators attach it with `SetValidator`, not `Include`, because
  the address is a nested object rather than a set of sibling fields on the request. ADC's
  [`RegisterRequestValidator`](group-24-identity-module.md#registerrequestvalidator) does
  `RuleFor(x => x.Address).SetValidator(new AddressValidator()!).When(x => x.Address is not null)`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:21-23`).
  Store does the same for registration
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:36`)
  and for customer creation
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/UseCases/Create/CustomerCreateRequestValidator.cs:20`),
  while `CustomerChangeAddressRequestValidator`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/UseCases/ChangeAddress/CustomerChangeAddressRequestValidator.cs:17-18`)
  attaches it with no `When` clause at all: its doc comment explains that the request's `Address` member
  is `required` and non-nullable, so FluentValidation's child-validator adapter already skips a null
  instance. Whichever validator wins, it reaches the runtime through the same route as every other one
  in this chapter: the resolved `IValidator<TCommand>` set is run by
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  before the handler executes, and failures are mapped to domain errors by
  [`ValidationFailureExtensions`](#validationfailureextensions).
- **Caveats / not-in-source**: the `!` in the ADC and Store registration call sites suppresses a
  nullability warning on `SetValidator` for a nullable child property; it does not change the runtime
  behaviour of this validator.

### AbsoluteUrlRules<T>
> MMCA.Common.Application · `MMCA.Common.Application.Validation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:85` · Level 6 · class

- **What it is**: a reusable fragment for an **optional URL** field. It applies two rules: a maximum
  length, and a check that any supplied value is an absolute `http` or `https` URI. A `null` or empty
  value passes both.
- **Depends on**: FluentValidation's `AbstractValidator<T>`, a nullable selector expression, the
  internal [`OptionalErrorCodeExtensions`](#optionalerrorcodeextensions) helper in the same file, and
  [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) from
  `MMCA.Common.Domain.Invariants` (imported at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:4`), which is
  what puts this fragment at Level 6 while its file-mates sit at Level 0.
- **Concept introduced, delegating a validator predicate to the domain invariant.**
  `[Rubric §11, Security]` assesses whether untrusted input is constrained before it reaches a sink.
  The rule's own doc comment states the threat plainly (`CommonValidationRules.cs:77-83`): a
  length-only bound accepts `javascript:` and `data:` values, and those become executable the moment a
  link `href` or an image `src` renders them. The scheme check is therefore not cosmetic URL hygiene,
  it is the boundary control for stored script injection through a user-supplied link.
  `[Rubric §9, API & Contract Design]` assesses uniform, machine-readable error contracts: the optional
  `errorCode` parameter, applied through [`OptionalErrorCodeExtensions`](#optionalerrorcodeextensions),
  lets a module attach a stable code such as `Sponsor.LogoUrl.Invalid` to both rules so one field
  answers under one code, which is the reason module validators no longer need to bypass the shared
  fragments to get a code. `[Rubric §15, Best Practices & Code Quality]`: the predicate is not a second
  implementation of the scheme test, it calls the domain invariant, so the request-level answer and the
  entity-level answer cannot diverge.
- **Walkthrough**:
  - The constructor (`CommonValidationRules.cs:87-90`) takes
    `(Expression<Func<T, string?>> selector, string fieldName, int maxLength, string? errorCode = null)`
    and builds a single chain: `MaximumLength(maxLength)` with the interpolated
    "{fieldName} cannot be longer than {maxLength} characters" message, then `.Must(BeAnAbsoluteHttpUrl)`
    with "{fieldName} must be an absolute http or https URL". Each rule ends in
    `.WithOptionalErrorCode(errorCode)` (`:89`, `:90`), which returns the rule untouched when the code
    is `null` (`CommonValidationRules.cs:30-32`), so every existing caller that omits it keeps
    FluentValidation's default per-rule code.
  - The length message uses `string.Create(CultureInfo.InvariantCulture, ...)` while the scheme message
    is a plain interpolation: the first embeds a number and so pins the culture, the second embeds only
    the field name.
  - `BeAnAbsoluteHttpUrl` (`:92-93`) is a `private static` predicate that calls
    `CommonInvariants.EnsureUrlIsWellFormed(url, "Url.Invalid", "Url.Invalid", nameof(AbsoluteUrlRules<>), "url")`
    and returns `.IsSuccess`. Two details are worth reading twice. First, the invariant returns a
    [`Result`](group-01-result-error-handling.md#result) and this call site discards everything except
    the boolean: the code, message, source, and target passed in are the invariant's own error shape,
    **not** what the user sees. The message the field actually reports is the FluentValidation
    `WithMessage` text on `:90`, and the code is whatever `errorCode` the caller supplied. Second,
    `nameof(AbsoluteUrlRules<>)` uses the unbound generic form and evaluates to the plain string
    `"AbsoluteUrlRules"`.
  - The invariant itself
    (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:293-297`) passes when
    the string is null or empty, otherwise defers to the private `IsAbsoluteHttpUrl`
    (`CommonInvariants.cs:436-439`), which requires `Uri.TryCreate(url, UriKind.Absolute, out var uri)`
    to succeed **and** `uri.Scheme` to equal `Uri.UriSchemeHttp` or `Uri.UriSchemeHttps` under
    `StringComparison.Ordinal`. That is an allow-list, not a deny-list: `mailto:`, `ftp:`, `file:`, and
    any relative value are refused along with `javascript:` and `data:`.
  - Because the empty case passes, the fragment is genuinely optional-field-shaped; a caller that needs
    the URL to be present pairs it with a required rule, which is what the ADC wrappers do with a
    `When(...)` guard.
- **Why it's built this way**: the invariant carries the doc comment explaining that length is a
  separate concern to be composed via `Result.Combine`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:280-281`), and this
  fragment is the application-layer counterpart of that composition: one `MaximumLength` rule plus one
  scheme rule, both reporting per field. `[Rubric §26, Front-End Security]` extends the same reasoning
  to the browser: [`AbsoluteUrlAttribute`](group-15-common-ui-framework.md#absoluteurlattribute)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/AbsoluteUrlAttribute.cs:26`) applies the
  identical `Uri.TryCreate` plus ordinal scheme comparison (`AbsoluteUrlAttribute.cs:44-45`) as a
  DataAnnotations rule and names this class in its doc comment as the server rule it mirrors, so a form
  gives the verdict the API would give rather than sending the user on a round trip to find out. The
  two are separate implementations by necessity (the UI package does not reference the Application
  layer), and the parity is held by tests on both sides rather than by a shared call.
- **Where it's used**: the ADC Conference module wraps it once per URL-bearing field, always inside a
  `When(x => !string.IsNullOrWhiteSpace(accessor(x)), ...)` guard so a blank optional field reports
  nothing: [`SponsorLogoUrlRules<T>`](group-18-conference-application.md#sponsorlogourlrulest)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:34`),
  [`SponsorWebsiteUrlRules<T>`](group-18-conference-application.md#sponsorwebsiteurlrulest) (`:64`),
  the sponsor LinkedIn rule (`:82`),
  [`SpeakerLinkedInUrlRules<T>`](group-18-conference-application.md#speakerlinkedinurlrulest)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:65`),
  [`SpeakerGitHubUrlRules<T>`](group-18-conference-application.md#speakergithuburlrulest) (`:84`) and
  the speaker website rule (`:103`),
  [`ActivityVenueUrlRules<T>`](group-18-conference-application.md#activityvenueurlrulest)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:71`),
  and [`EventSponsorshipPacketUrlRules<T>`](group-18-conference-application.md#eventsponsorshippacketurlrulest)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:85`).
  Each wrapper supplies its own module max-length constant. Direct coverage lives in
  [`CommonValidationRulesTests`](group-27-testing-infrastructure.md#commonvalidationrulestests)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:565`
  for the passing shapes, `:580` for rejected schemes, `:592` for the length bound, and `:604` for the
  supplied-error-code path).
- **Caveats / not-in-source**: the rule constrains the scheme only. It does not check that the host
  resolves, that the URL is reachable, or that the target is safe to embed, and it places no
  restriction on host, port, or path.

### ValidationFailureExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:9` · Level 2 · class (static)

- **What it is**: a static class wrapping a single C# `extension(ValidationResult)` block that adds one
  method, `ToErrors(string source)`, which converts FluentValidation's `ValidationFailure` entries into
  domain [`Error`](group-01-result-error-handling.md#error) instances. It is the one adapter that lets
  FluentValidation output flow into the codebase's Result pattern.

- **Depends on**: [`Error`](group-01-result-error-handling.md#error) and its
  [`ErrorType.Validation`](group-01-result-error-handling.md#errortype) classification (imported from
  `MMCA.Common.Shared.Abstractions`, `ValidationFailureExtensions.cs:2`); `FluentValidation.Results`
  (`ValidationResult`, `ValidationFailure`, NuGet, `ValidationFailureExtensions.cs:1`); LINQ `Select`.

- **Concept introduced, bridging FluentValidation to the Result pattern.**
  `[Rubric §15, Best Practices & Code Quality]` (assesses consistent, idiomatic conventions over one-off
  code; the convention here is *validators produce domain `Error`s, never raw strings and never thrown
  exceptions*). A FluentValidation `AbstractValidator<T>` produces a `ValidationResult` whose `Errors`
  are framework-specific `ValidationFailure` objects; everything downstream speaks in
  [`Result`](group-01-result-error-handling.md#result) failures carrying domain
  [`Error`](group-01-result-error-handling.md#error)s. This extension is the only place that translation
  happens, so no pipeline stage, handler, or API filter is coupled to FluentValidation's failure shape.
  It also touches `[Rubric §9, API & Contract Design]` (assesses uniform, standardized error responses):
  every failure becomes an [`ErrorType.Validation`](group-01-result-error-handling.md#errortype) error,
  the classification the API layer maps to HTTP 400, so a validation failure looks identical at the
  boundary no matter which validator raised it.

- **Walkthrough**: the file is a static class (`ValidationFailureExtensions.cs:9`) holding a single
  `extension(ValidationResult result)` block (`:11`). Inside it, `ToErrors(string source)` (`:19`)
  projects `result.Errors` with a LINQ `Select` (`:20`) into one
  [`Error.Validation(...)`](group-01-result-error-handling.md#error) call per failure (`:21`), passing
  four arguments in order: the failure's `ErrorCode` becomes the error `code`, its `ErrorMessage` becomes
  the `message`, the caller-supplied `source` becomes the `source`, and its `PropertyName` becomes the
  `target`. `Error.Validation` is declared
  `Validation(string code, string message, string? source = null, string? target = null)` in
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:37`, so `PropertyName` lands in the
  `target` slot, identifying *which* field failed while `source` identifies *what operation* was being
  validated. The method returns `IEnumerable<Error>` lazily; the caller materializes it.

- **Why it's built this way**: the C# `extension(T)` syntax (see [primer §4](00-primer.md)) lets the
  conversion read as a natural method on `ValidationResult` (`result.ToErrors("X")`) without subclassing
  FluentValidation and without a static helper every consumer must remember to reach for. It keeps the
  cross-cutting mapping co-located with its purpose and out of both FluentValidation and
  [`Error`](group-01-result-error-handling.md#error): neither library knows the other exists. Returning a
  lazy `IEnumerable<Error>` defers the projection until the caller enumerates, which the call sites do
  immediately (`AddRange` in the decorators, the `Result.Failure` factory in the auth base).

- **Where it's used**: five call sites in `MMCA.Common.Application`, all following the same shape.
  [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult)
  loops over every registered `IValidator<TCommand>` and, for each result that is not valid, does
  `errors.AddRange(validationResult.ToErrors(typeof(TCommand).Name))`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:82`,
  accumulating into the `List<Error>? errors` declared at `:72` and lazily allocated at `:81`).
  [`ValidatingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#validatingquerydecoratortquery-tresult)
  does the identical thing with `typeof(TQuery).Name`
  (`MMCA.Common.Application/UseCases/Decorators/ValidatingQueryDecorator.cs:85`). Note that the
  accumulate-across-all-validators shape is deliberate: the decorator's own doc comment
  (`ValidatingCommandDecorator.cs:17-22`) records that running only the first registered validator would
  turn the rest into silently unenforced dead code, and that collecting all of them lets the caller see
  every broken rule in one response instead of one per round trip. The remaining three call sites are in
  [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser), which validates
  its request before touching the user store and passes the method name as `source`:
  `nameof(LoginAsync)` (`MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:127`),
  `nameof(RegisterAsync)` (`:193`), and `nameof(RefreshTokenAsync)` (`:273`), each wrapping the result in
  `Result.Failure<AuthenticationResponse>(...)`. Covered by
  [`ValidationFailureExtensionsTests`](group-27-testing-infrastructure.md#validationfailureextensionstests).

- **Caveats / not-in-source**: the failure's `ErrorCode` is FluentValidation's per-rule code (for example
  `"NotEmptyValidator"`) unless a validator overrides it with `.WithErrorCode(...)`; this extension passes
  it through verbatim and neither normalizes nor validates it. Separately, the name `ToErrors` is reused
  by an unrelated extension in the gRPC layer,
  [`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions) declares an
  `extension(Metadata? trailers)` block with its own `ToErrors()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:146` and `:165`) that decodes
  errors out of gRPC trailers. Different receiver, different assembly, no relationship to this one.

### CurrentUserServiceExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/CurrentUserServiceExtensions.cs:9` · Level 9 · class (static)

- **What it is**: a static class holding one public constant and one `extension(ICurrentUserService)`
  member, `RequireUserId(...)`, which turns "who is calling, and fail if nobody is" into a single
  expression returning a [`Result`](group-01-result-error-handling.md#result)`<UserIdentifierType>`. It is
  a validation-shaped caller guard: the same short-circuit-before-you-work move the validating decorators
  make, applied to identity rather than to command fields.

- **Depends on**: [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (the extended type,
  `CurrentUserServiceExtensions.cs:1` and `:14`), [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error) and
  [`ErrorType`](group-01-result-error-handling.md#errortype) (`:2`), and the `UserIdentifierType`
  identifier alias (`global using UserIdentifierType = int;` in
  `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`, see primer). The only BCL
  dependency is `ArgumentNullException.ThrowIfNull`.

- **Concept: pushing a repeated guard into the framework rather than a base class.**
  `[Rubric §16, Maintainability]` (assesses whether duplicated logic is consolidated where it can only be
  written once): the guard being replaced is the three-line
  read-`UserId`, null-check, build-a-forbidden-`Error`, return-a-failure block that every handler and
  controller protecting a per-user operation would otherwise repeat, which the type's own doc comment
  states at `CurrentUserServiceExtensions.cs:17-19`. `[Rubric §11, Security]` (assesses that
  authentication and authorization decisions are made server-side and consistently): because the failure
  is manufactured in one place, no module can accidentally return a 200 with a default identifier for an
  unauthenticated caller, and no module can drift on the message. `[Rubric §1, SOLID]`: the guard is
  added by extension rather than by a handler base class, so it composes onto *any*
  `ICurrentUserService` implementation (production service, hand-written test double, or mock) without an
  inheritance constraint on the consumer.

- **Walkthrough**: `AccessDeniedMessage` (`:12`) is a `public const string` fixed to `"Access denied."`,
  documented as the message every app-side copy of this guard reports; making it a named constant is what
  lets a test assert the framework and the modules agree on one string. The
  `extension(ICurrentUserService currentUserService)` block (`:14`) contributes the single instance method
  `RequireUserId` (`:35`), whose four parameters are: `code`, required, the module's error code for a
  denied caller (for example `"CheckIns.Forbidden"`), kept a parameter because the code names the module
  and the framework cannot know that (`:21-24`); `message`, defaulting to `AccessDeniedMessage` (`:37`);
  `errorType`, defaulting to `ErrorType.Forbidden` (`:38`), which is what the handler-side copies of the
  guard report, with `ErrorType.Unauthorized` documented as the value to pass where the edge answers 401
  instead (`:26-30`); and an optional `source` (`:39`) for the calling handler's name. The body is three
  lines: `ArgumentNullException.ThrowIfNull(currentUserService)` (`:41`), which matters because an
  extension member on an interface is callable on a null reference without an NRE at the call site, then a
  single expression (`:43-45`) that pattern-matches `currentUserService.UserId is { } userId` and returns
  either `Result.Success(userId)` or
  `Result.Failure<UserIdentifierType>(new Error(code, message, errorType, source))`. The `is { }` property
  pattern is the null test and the unwrap in one step: `UserId` is declared `UserIdentifierType?` on
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:15`),
  and `userId` is the non-nullable `int` behind it. Note the failure path constructs the
  [`Error`](group-01-result-error-handling.md#error) record directly rather than through a factory, because
  the classification is a caller-supplied parameter here and the factories
  (`Error.Forbidden`, `Error.Unauthorized` at
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:82` and `:73`) each hard-code one
  `ErrorType`. `Result.Failure<T>(Error)` wraps the single error into the result's error list
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:101`).

- **Why it's built this way**: the parameter set is the minimum that could not be inferred. Everything the
  framework can know (the message, the classification, the null handling, the `Result` shape) has a
  default; the one thing it cannot know, the module-scoped error code, stays required. That choice has a
  measurable side effect recorded in ADC's architecture fitness suite: moving `"CheckIns.Forbidden"` and
  `"Points.Forbidden"` out of module-side `Error` factory calls and into arguments of this framework
  member made them invisible to the IL literal scan that counts ADC's error codes, which is part of why
  `ErrorCatalogTests.MinimumErrorCodes` sits at 57
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ErrorCatalogTests.cs:95-106`). The codes ship
  unchanged; only the scanner's visibility of them changed.

- **Where it's used**: six ADC Engagement handlers call it as their first statement after the null guard,
  then branch on `caller.IsFailure` and propagate `caller.Errors`:
  [`RecordSponsorVisitHandler`](group-22-engagement-module.md#recordsponsorvisithandler)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/CheckIns/UseCases/RecordSponsorVisit/RecordSponsorVisitHandler.cs:48`),
  [`RecordRoomCheckInHandler`](group-22-engagement-module.md#recordroomcheckinhandler)
  (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:41`),
  [`ManualCheckInHandler`](group-22-engagement-module.md#manualcheckinhandler)
  (`.../CheckIns/UseCases/ManualCheckIn/ManualCheckInHandler.cs:31`),
  [`GetOrCreateMyBadgeHandler`](group-22-engagement-module.md#getorcreatemybadgehandler)
  (`.../CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:28`) and
  [`CheckInAttendeeHandler`](group-22-engagement-module.md#checkinattendeehandler)
  (`.../CheckIns/UseCases/CheckInAttendee/CheckInAttendeeHandler.cs:33`), all passing
  `"CheckIns.Forbidden"`; plus
  [`SetLeaderboardParticipationHandler`](group-22-engagement-module.md#setleaderboardparticipationhandler)
  (`.../Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:43`) and
  [`GetMyPointsHandler`](group-22-engagement-module.md#getmypointshandler)
  (`.../Points/UseCases/GetMyPoints/GetMyPointsHandler.cs:40`) passing `"Points.Forbidden"`. All of them
  take the defaults, so every one reports `"Access denied."` with `ErrorType.Forbidden`. Behavior is pinned
  by [`CurrentUserServiceExtensionsTests`](group-27-testing-infrastructure.md#currentuserserviceextensionstests),
  which asserts the success value, the default forbidden failure, the fully-overridden failure, the
  `ArgumentNullException` on a null service, and that `AccessDeniedMessage` still equals `"Access denied."`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Extensions/CurrentUserServiceExtensionsTests.cs:16-72`).

- **Caveats / not-in-source**: the name `CurrentUserServiceExtensions` is used twice in the workspace for
  two unrelated static classes. This one is the framework guard in `MMCA.Common.Application.Extensions`;
  ADC's Conference API ships its own
  [`CurrentUserServiceExtensions`](group-20-conference-api-grpc.md#currentuserserviceextensions) in
  `MMCA.ADC.Conference.API.Authorization` whose single member is `IsPrivilegedConferenceReader()`, a read
  visibility check over role names
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:10-26`).
  They share a name and an extended type and nothing else. Also note `RequireUserId` answers only "is there
  an authenticated user", it makes no permission decision; capability checks stay with the
  `[HasPermission(...)]` attributes on the endpoints.


---
[⬅ CQRS: Commands, Queries & the Decorator Pipeline](group-05-cqrs-pipeline.md)  •  [Index](00-index.md)  •  [Persistence & EF Core ➡](group-07-persistence-ef-core.md)
