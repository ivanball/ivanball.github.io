# Stop throwing exceptions for control flow: the Result railway in C#

> Series: MMCA.Common · Article #4 · Pillar P2 · Group G01 · Rubric §1,§2 · ADR-013 ·
> Status: grounded in `Website/docs-src/adr/013-result-pattern.md`, `MMCA.Common/AGENTS.md` (the Result-pattern
> conventions in its Entity Model section), the `MMCA.Common.Shared/Abstractions` source, and `Website/docs-src/onboarding/group-01-result-error-handling.md`. No em dashes.

**Subtitle:** "This order ID does not exist" is not an exceptional event, it is a routine branch of
normal control flow. Here is the `Result<T>` railway that models it as a value, and why the domain in
MMCA.Common throws zero exceptions for business outcomes.

---

Here is a method signature you have written a hundred times:

```csharp
public Order GetOrder(int id);
```

Read it carefully. What does it tell you about failure? Nothing. It promises an `Order`. It does not
say it can fail when the id is missing, or that it might throw `OrderNotFoundException`, or that the
caller is supposed to wrap the call in a `try`/`catch`. The failure path is invisible. The compiler
cannot see it, the caller can forget it, and the only way to learn that the method throws is to read
its body or get paged at 3am.

Now compare:

```csharp
public Result<Order> GetOrder(int id);
```

The failure is in the signature. A caller cannot pretend it does not exist, because the return type is
not an `Order`, it is "an `Order` or an explanation of why not."

That swap is the single most pervasive idea in MMCA.Common. Practically every entity factory, every
CQRS command and query handler, and every UI service method returns `Result` or `Result<T>`, and every
controller action turns a failed one into an HTTP error response at the edge. This article is about why, and about the small set of types that make it ergonomic enough
to use everywhere.

## Why exceptions are not a control-flow mechanism

Exceptions are excellent at one job: aborting a computation that has gone genuinely wrong and unwinding
the stack to someone who can recover. They are a poor fit for *expected* outcomes, for four concrete
reasons that ADR-013 names directly:

1. **The failure is invisible in the method signature.** Nothing forces a caller to handle it.
2. **It is easy to forget to catch.** An uncaught exception escapes; an unread `Result` at least sits
   there as an unused value the analyzers can flag.
3. **It is comparatively expensive on the throw path.** Stack capture and unwinding cost real cycles
   for an outcome you expected.
4. **It conflates two different things:** "the user asked for something we will not do" and "the
   process is broken." Those deserve different handling, and a single `catch` flattens them together.

"This email is already taken" and "this session does not exist" are not bugs. They are routine,
anticipated branches. Modeling them as data lets the compiler see them, lets them be collected into a
list, threaded through a pipeline, inspected, and mapped to an HTTP response with no `try`/`catch`
anywhere in the slice.

## The MMCA answer: three small types and a railway

The pattern is factored into three dependency-free pieces, all living in `MMCA.Common.Shared`, the
innermost layer (the Blazor WebAssembly UI can reference it without dragging in EF Core or ASP.NET):

- **`ErrorType`** is the classification axis: a ten-value enum. `Validation`, `Invariant`,
  `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`,
  `Unexpected` for a genuine server-side fault the caller cannot fix by changing the request, and
  `TooManyRequests` for a temporary refusal after too many attempts (a login lockout, say), where
  retrying later rather than changing the request is the fix. Critically, this is a pure enum with
  no reference to ASP.NET. The domain never names an HTTP status code.
- **`Error`** is the carrier: an immutable positional `record` with a machine-readable `Code` (e.g.
  `"Order.NotFound"`, for programmatic branching), a human-readable `Message`, an `ErrorType`, and
  optional `Source` / `Target` context, plus an init-only `RetryAfter` that a `TooManyRequests`
  producer sets when it knows how long the refusal lasts (a sign-in lockout does). Ten factory methods
  (one per `ErrorType`) each hard-code the correct type, so a caller can never pair
  `Error.NotFoundError(...)` with the wrong classification.
- **`Result`** (and the generic `Result<T>`) is the outcome envelope: either a success, or a failure
  carrying one or more `Error`s.

You cannot `new` a `Result<T>`. Its constructors are `internal`, so a result comes from the static
factories (`Result.Success`, `Result.Failure`) or from the implicit conversions that let a method write
`return error;` or `return value;`, and those conversions delegate to the same factories. That
discipline guarantees the invariant the rest of the codebase relies on: a result is always either a clean success or a non-empty failure, never a
half-built object.

### The railway, in one picture

"Railway-oriented programming" is the mental model. Picture two parallel tracks, a success track and a
failure track. An operation takes the current result as input. If the result is already a failure, the
operation is skipped (the train stays on the failure track). If it is a success, the operation runs and
may stay on the success track or switch to failure. Control flows forward, with no nested
`if (result.IsFailure)` checks at every line.

`Result<T>` carries seven combinators, and three of them do most of the work:

- **`Match(onSuccess, onFailure)`** terminates the railway by collapsing both tracks to a single value.
  Exactly one branch runs. `MatchAsync` is the awaiting twin.
- **`Map(mapper)`** transforms the success value while propagating errors untouched.
- **`BindAsync(binder)`** is the monadic bind for async continuations: it short-circuits on failure
  (returning the original errors without calling `binder`) and otherwise awaits the next operation,
  which itself returns a `Result`. `Bind` is the synchronous form of the same shape.

The other two are conveniences over the same short-circuit: **`Tap(action)`** runs a side effect on the
success value and hands back the same instance, and **`Ensure(predicate, error)`** fails the chain with a
supplied `Error` when the value does not satisfy a predicate. Every success-side delegate (the mapper, the
binder, the side effect, the predicate) is skipped when the result is already a failure; of the seven, only
`Match` and `MatchAsync` run a delegate on the failure track, their `onFailure` branch. A separate `ResultExtensions` class lifts `BindAsync`,
`MapAsync`, `TapAsync` and `MatchAsync` onto a pending `Task<Result<T>>`, so an asynchronous pipeline
composes end to end without an `await` and a temporary local between every step.

When a step needs the value itself rather than a delegate, `Result<T>` also offers
**`TryGetValue(out T value)`**, shaped like `Dictionary.TryGetValue`. It decides on `IsFailure`, and its
`[MaybeNullWhen(false)]` annotation lets the compiler track the check, so the value needs no `!` in the
success branch, and deleting or reordering the check breaks the build instead of letting a null escape.

The non-generic base carries four combinators of its own, and **`Result.Combine(params ReadOnlySpan<Result>)`**
is the one that earns its keep: the aggregate-all-failures combinator. It runs several invariant checks and
returns *all* their errors at once rather than failing on the first. This is the workhorse of domain factory
methods. The `ReadOnlySpan` parameter avoids a heap allocation in the common case. `Match`, `Bind` and
`OnFailure` round out the base, so a valueless step composes the same way instead of forcing an
`if (result.IsFailure)` check.

```csharp
// A domain factory (condensed): invalidity is unrepresentable, and Combine reports every broken rule at once.
public static Result<Speaker> Create(
    SpeakerIdentifierType? id,
    string firstName,
    string lastName,
    string? email,
    /* bio, tagLine, profilePicture, isTopSpeaker, optional social links */)
{
    Email? emailVO = null;
    if (!string.IsNullOrWhiteSpace(email))
    {
        var emailResult = Email.Create(email);
        if (emailResult.IsFailure)
            return Result.Failure<Speaker>(emailResult.Errors);
        emailVO = emailResult.Value;
    }

    var result = Result.Combine(
        SpeakerInvariants.EnsureFirstNameIsValid(firstName, nameof(Create)),
        SpeakerInvariants.EnsureLastNameIsValid(lastName, nameof(Create)),
        SpeakerInvariants.EnsureOptionalFieldsAreValid(/* tagLine, links, */ nameof(Create)));
    if (result.IsFailure)
        return Result.Failure<Speaker>(result.Errors);

    var speaker = new Speaker(firstName, lastName, emailVO /* , ... */) { /* Id, links */ };
    speaker.AddDomainEvent(new SpeakerChanged(DomainEntityState.Added, speaker.Id, speaker.FullName));

    return Result.Success(speaker);
}

// The shared create pipeline propagates the failure and stops; the success path continues.
protected async Task<Result<TEntityDTO>> CreateCoreAsync(
    IUnitOfWork attemptUnitOfWork,
    TCreateRequest command,
    CancellationToken cancellationToken)
{
    var prepared = await PrepareAsync(attemptUnitOfWork, command, cancellationToken).ConfigureAwait(false);
    if (!prepared.TryGetValue(out var request))
        return Result.Failure<TEntityDTO>(prepared.Errors);

    var result = await requestMapper.CreateEntityAsync(request, cancellationToken).ConfigureAwait(false);
    if (!result.TryGetValue(out var entity))
        return Result.Failure<TEntityDTO>(result.Errors);

    var repository = attemptUnitOfWork.GetRepository<TEntity, TIdentifierType>();

    await PersistAsync(attemptUnitOfWork, repository, entity, cancellationToken).ConfigureAwait(false);

    LogCreated(entity);
    await OnCreatedAsync(entity, cancellationToken).ConfigureAwait(false);

    return Result.Success(dtoMapper.MapToDTO(entity));
}
```

No `try`, no `catch`, no `throw`. The factory refuses to build an invalid `Speaker`, the handler
forwards the errors it cannot handle, and the failure path is carried along as data.

### The transport mapping lives only at the edge

Because `ErrorType` is transport-agnostic, the translation to an HTTP status code is centralized in a
single shared internal class, `ErrorHttpMapping`. It owns the `FrozenDictionary` that maps each
`ErrorType` to a status (`Validation`, `Invariant` and `Failure` to 400, `NotFound` to 404, `Conflict`
to 409, `Unauthorized` to 401, `Forbidden` to 403, `UnprocessableEntity` to 422, `TooManyRequests` to
429, `Unexpected` to 500, anything unmapped falling back to 400) and the `GetStatusCode` lookups over it. Two consumers share the
status lookup. `ApiControllerBase.HandleFailure()` is the normal path: a controller action resolves the
status from the *most severe* error present through `ErrorHttpMapping` and renders an RFC 9457
ProblemDetails body carrying *all* the errors. When that status is 429 and the `TooManyRequests` errors
carry a `RetryAfter`, it also answers a `Retry-After` header, the longest hint winning, so a client waits
out a lockout instead of guessing. `UnhandledResultFailureFilter` is the safety net: a global
filter that catches an action which accidentally returns a failed `Result` as a 200 body and rewrites it
into the same ProblemDetails structure (the same status and the same `errors` extension, under its own
title) via the same mapping. A third caller, the `If-Match` concurrency
attribute, reuses the same class for the errors projection alone. Because the dictionary lives in one
place, the controller base and the filter can never drift apart.

The gRPC layer does the equivalent over the wire (`GrpcResultExceptionInterceptor`, ADR-007), so a remote
call looks like a local `Result<T>` to application code (`TooManyRequests`, for instance, travels as
`ResourceExhausted`). One enum and one severity ranking drive both transports, so every endpoint and
every extracted service classifies a failure the same way and picks the same winner from an aggregate.
The status tables themselves are per edge: the gRPC layer keeps its own `FrozenDictionary` that mirrors
`ErrorHttpMapping` by convention, and the client-side reader that turns a ProblemDetails body back into a
`Result` keeps a reverse status-to-`ErrorType` table. The enum is the single source of truth for what kind
of failure occurred; each table only translates it for one transport.

The payoff at the framework level: the domain layer throws zero exceptions for business outcomes. The
scorecard credits §15 for "consistent Result-based error handling"; the domain reserves exceptions for
the genuinely exceptional (EF Core materialization), with no business-logic throws.

### The read-side envelopes: collection and pagination results

`Result<T>` is what every *write* returns. Reads need a shape too, and returning a bare JSON array is a
trap: the moment you want to add pagination metadata, a top-level array forces a breaking change on every
client. So the read side has its own small envelopes, living in `MMCA.Common.Shared` right next to
`Result`:

- **`CollectionResult<T>`** is a thin `[DataContract]` record with a single `required ICollection<T>
  Items` property. Returning a named wrapper (`{ "items": [...] }`) instead of a raw array is a deliberate
  API-contract choice (Rubric §9): the wrapper leaves room to add metadata later without breaking the
  response shape, which a top-level array would force.
- **`PagedCollectionResult<T>`** extends it with one more required property, **`PaginationMetadata`**: the
  server-side paging state (`TotalItemCount`, `PageSize`, `CurrentPage`) plus computed, non-serialized
  derivations (`TotalPageCount`, `FirstRowOnPage`, `LastRowOnPage`). `[DataMember(Order = ...)]`
  annotations pin a deterministic wire order, and `[IgnoreDataMember]` keeps the derived values off the
  wire so the client recomputes them.
- **`KeysetCollectionResult<T>`** is the cursor-paged sibling for deep or infinite scrolling. It also
  extends `CollectionResult<T>`, adding a nullable, opaque `NextCursor` that the next request passes back
  to fetch the rows after it, and deliberately carries no total count or page number, because a keyset
  read never pays for either.

A paged query handler returns `Result<PagedCollectionResult<T>>`, composing the two ideas: the railway
carries success-or-failure, and the success payload is the canonical paged shape. One envelope for every
write, one small family of them for every read, and the response contract stays stable as the API grows.

## Trade-offs, honestly

The Result pattern is not free, and ADR-013 names the rough edges rather than hiding them:

- **More ceremony at the call site** than letting an exception bubble. `Combine` absorbs most of it
  inside the factories, but a guard-and-propagate pair after every fallible call is wordier than a
  bare method call. That is the cost of making failure visible.
- **Two error channels coexist.** `Result` is for *expected* failures; exceptions are reserved for the
  genuinely exceptional: programming errors (null-argument guards) and infrastructure faults (a dropped
  database connection) that should abort the request. The boundary is a judgment call: "could a
  well-behaved caller reasonably trigger this?" If yes, return a `Result`; if no, throw. MMCA.Common
  keeps a single concrete domain exception type (`DomainInvariantViolationException`) for the one
  structural gap where `Result` cannot be returned: EF Core materialization, where the call stack is
  framework-owned. The type is held in reserve: no code path in MMCA.Common throws it. That is not the only exception the framework catches, though. An ordered
  `IExceptionHandler` chain converges every escaped exception onto the same RFC 9457 ProblemDetails
  contract: a cancellation handler (499), a domain-exception handler (400), a `DbUpdate` handler (409),
  a validation handler (400), and a catch-all (500, except 400 for a refused cross-tenant write and the
  status a server-rejected request already carries, such as 413 for an oversize body), registered in that load-bearing order. So the
  failure shape stays identical whether it arrived as a `Result` or as a throw.
- **One status has to stand for a whole list of errors.** Every error serializes into the
  ProblemDetails body, but the status code can only be one number, so it is resolved by ranking: the
  most severe `ErrorType` present wins (`Unexpected` over `Unauthorized` over `Forbidden` over
  `TooManyRequests` over `Conflict` over `NotFound` over `UnprocessableEntity` over the shared bottom rank of `Invariant`,
  `Validation` and `Failure`), and equal ranks keep the earliest error. A result carrying both a
  `Validation` and a `Conflict` answers 409, and the validation detail is readable only in the body.

None of these are reasons to reach back for exceptions. They are the reasons to apply the pattern
deliberately and to know where its one sanctioned exception lives.

## Apply this even without MMCA

You do not need this framework to adopt the railway. The ideas port to any stack:

1. **Make failure visible in the signature.** Return a result type (`Result<T>`, `OneOf`,
   `ErrorOr`, your own) from any method that can fail in an expected way. If the failure is not in the
   signature, callers will forget it.
2. **Classify errors as data, not as exception subtypes.** An enum or sealed hierarchy of error
   categories keeps your core layer free of transport concerns and lets one mapping table translate to
   HTTP, gRPC, or a UI toast at the edge.
3. **Aggregate validation failures.** Returning the first broken rule and stopping forces users through
   a frustrating fix-one-retry loop. A `Combine`-style combinator that returns all failures at once is
   a small change with a large UX payoff.
4. **Keep exceptions for the exceptional.** Null-argument guards and infrastructure faults still belong
   as exceptions. The rule of thumb: if a well-behaved caller could trigger it, return a value; if only
   a bug or a broken dependency could, throw.

The takeaway is one line: **if a method can fail in a way a caller is expected to handle, put that
failure in the return type, not on the stack.**

---

**What we covered:** why exceptions are the wrong tool for expected outcomes, the three-type
`ErrorType` / `Error` / `Result` split, the `Match` / `Map` / `BindAsync` / `Combine` railway
combinators, factory methods that make invalidity unrepresentable, and the single shared
`ErrorHttpMapping` that maps `ErrorType` to HTTP via a `FrozenDictionary` for both the controller base
and the unhandled-failure filter.

**Next in the series:** killing the anemic domain model, where these factory methods that return
`Result` do their best work.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-013 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- ADR-013 (Result pattern over exceptions): `Website/docs-src/adr/013-result-pattern.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Programming, Error Handling*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:4,14`). Every anchor below was read
this run. `ErrorType` is a ten-member enum (`Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:10`,
`TooManyRequests` the last member at `:48`). `Error` (`.../Abstractions/Error.cs`) is `public record Error(Code, Message,
Type, Source, Target)` at `:15-20` with an init-only `TimeSpan? RetryAfter` at `:37` (doc comment `:31-36`: set with
`with { RetryAfter = ... }` on a `TooManyRequests` error, answered by `HandleFailure` as `Retry-After`; the sign-in lockout
sets it at `Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:107`), and ten factories: `Validation`
`:45`, `Invariant` `:54`, `NotFoundError` `:63`, `Conflict` `:72`, `Unauthorized` `:81`, `Forbidden` `:90`,
`UnprocessableEntity` `:99`, `TooManyRequests` `:111`, `Failure` `:120`, `Unexpected` `:134`. `Result`/`Result<T>`
(`.../Abstractions/Result.cs`): value-bearing constructors `internal` (`:232`, `:238`); factories `Success` `:62`/`:68`,
`Failure` `:74`/`:83`/`:94`/`:101`; implicit conversions `Error` to `Result` (`:43`, via `FromError` `:49`), `Error` to
`Result<T>` (`:254`) and `T` to `Result<T>` (`:270`, calls `Success`). On `Result<T>`: `Match` `:281`, `Map` `:297`,
`BindAsync` `:310`, `Bind` `:323`, `Tap` `:335`, `Ensure` `:355` (failure check `:360`), `MatchAsync` `:376`, and
`TryGetValue([MaybeNullWhen(false)] out T value)` at `:218` deciding on `IsFailure` at `:220`. On the non-generic `Result`:
`Combine(params ReadOnlySpan<Result>)` `:124`, `Match` `:155`, `OnFailure` `:169` (failure check `:173`), `Bind` `:187`.
The remaining short-circuit lines (`:300`, `:313`, `:326`) are taken from ADR-013 (`Website/docs-src/adr/013-result-pattern.md:98-99`),
which re-anchored them on 2026-11-23. `ResultExtensions` (`.../Abstractions/ResultExtensions.cs:14`): `BindAsync` `:24`/`:43`,
`MapAsync` `:62`, `TapAsync` `:81`, `MatchAsync` `:106`. ADR-013: the four exception costs `:46-48`, the `Error` record with
`RetryAfter` `:54-58`, the category list `:59-60`, `TooManyRequests` to 429 and `ResourceExhausted` `:68-72`, the combinator
surface `:73-99` (`TryGetValue` `:84-87`), `HandleFailure` plus the `Retry-After` header `:100-110`, the severity ranking
`:117-126` (`TooManyRequests` 45 at `:123`), the 2026-11-23 `RetryAfter` revision note `:34`, Trade-offs at `:362`. Controller
actions return `Task<ActionResult<...>>` or `Task<IActionResult>`, not `Result`
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:109`, `:157`, `:258`, `:321`, `:362`, `:408`,
`:461`; `CrudEntityControllerBase.cs:99`); UI service methods return `Result`/`Result<T>`
(`Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:52`, `:70`, `:116`, `:127`, `:146`, `:169`, `:199`),
with production `.Map(...)` calls at `:66` and `:123`. The domain-factory snippet is condensed from the ADC `Speaker.Create`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:126`: `Email.Create` `:144`, early return
`:146`, `Result.Combine` over the three `SpeakerInvariants` checks `:150`, `SpeakerChanged` `:179`, `Result.Success` `:181`);
parameters after `email`, constructor arguments, id selection and social-link initializers are elided as comments. The
pipeline snippet is `CreateCoreAsync` (`Source/Core/MMCA.Common.Application/UseCases/Crud/CreateEntityHandlerBase.cs:77`:
`ArgumentNullException` guard `:82` elided, `TryGetValue` guards `:85` and `:89`, mapper call `:88`, repository `:92`,
`LogCreated` `:96`, `OnCreatedAsync` `:97`, `Result.Success` `:99`); its ADC leaf `CreateSpeakerHandler`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:15`) is a
sealed partial class deriving from `CreateEntityHandlerBase<SpeakerCreateRequest, Speaker, SpeakerIdentifierType, SpeakerDTO>`
(`:20`) whose only override is `LogCreated` (`:24`), backed by the `[LoggerMessage]` partial `LogSpeakerCreated` (`:26-27`).
`DomainInvariantViolationException` (`Source/Core/MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9`) is the
only `: DomainException` subclass the search over `MMCA.Common/Source` returned. Exception chain: `AddCommonExceptionHandlers`
(`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:157`, registrations `:162-166` in the order OperationCanceled,
Domain, DbUpdate, Validation, Global); `OperationCanceledExceptionHandler.cs` answers 499 at `:46` and claims a post-disconnect
`DbException` (`:17`, `:38`); `GlobalExceptionHandler.cs` answers 400 for `CrossTenantWriteException` (type check `:54`, status
`:60`), passes a `BadHttpRequestException` through with its own status (`:74`, `:82`, the 413 "Payload Too Large" title and
detail at `:90-93`) and falls back to 500 at `:102`. `ErrorHttpMapping` (`Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs`):
doc comment `:8-13` naming the controller base and the filter, the `FrozenDictionary` `:23-35` (`Unexpected` 500 `:33`,
`TooManyRequests` 429 `:34`), `GetStatusCode(ErrorType)` with its 400 fallback `:41-42`, the list overload over
`ErrorTypeSeverity.MostSevere` `:54-55`, `BuildErrorsExtension` `:65-74`. `ErrorTypeSeverity`
(`Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:31`): `TooManyRequests` 45 at `:43`, `MostSevere` `:71`,
strict `>` at `:90` inside the scan from `:87`, so ties keep the earliest error; the other ranks are as ADR-013 `:122-124` lists
them. `ApiControllerBase` (`Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs`): ranking doc comment `:36-44`
(`TooManyRequests` (429) at `:41`), `HandleFailure` `:49`, status `:62`, title "Operation failed" `:67`, `errors` extension
`:72`, `SetRetryAfter` call `:74` and method `:87-101` (429 only `:89`, longest hint `:94-96`, positive hint only `:97`, header
`:99`). `UnhandledResultFailureFilter.cs`: status `:36`, title "Unhandled result failure" `:42`, `errors` extension `:47`.
`SupportsIfMatchAttribute.cs:268` (`.../Concurrency/`) reuses `BuildErrorsExtension` alone. gRPC:
`GrpcResultExceptionInterceptor` (`Source/Presentation/MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19`);
`Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs` keeps its own `FrozenDictionary` (`:37-50`, doc comment `:35`
naming `ErrorHttpMapping.ErrorTypeToStatusCode`), `TooManyRequests` to `ResourceExhausted` at `:49`, `MostSevere` at `:124`; the
client reverse table is `StatusCodeToErrorType` (`Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:96-107`, 429
at `:105`). Read-side envelopes: `PaginationMetadata.cs` (`PaginationMetadata` `:12`, `[IgnoreDataMember]` `:74`/`:78`/`:82`,
`CollectionResult<T>` `:92`, `Items` `:110`, `PagedCollectionResult<T>` `:119`) and `KeysetPagination.cs` (`KeysetPageRequest`
`:20`, cursor doc `:42`, `KeysetCollectionResult<T> : CollectionResult<T>` `:85`, `NextCursor` `:107`). Scorecard
(`Website/docs-src/governance/common-ArchitectureScorecard.md`): table header `:64`, section 1 SOLID Principles `:66`, section 2
Design Patterns `:67`, section 10 Messaging & Integration Architecture `:75`, section 15 Best Practices & Code Quality `:80`
(quotes "consistent Result-based error handling"); the header stays sections 1 and 2. Section 1 is grounded independently by the
SRP (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:127`) and ISP (`:130`) criteria. Header grounding:
`MMCA.Common/AGENTS.md:123` (Entity Model, heading `:121`: `Create(...)` factories returning `Result<T>`, invariants composed with
`Result.Combine()`). The "for business outcomes" qualifier rests on argument guards such as
`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:52`. Flag (2026-11-25): the per-test line anchors in
`Tests/Core/MMCA.Common.Shared.Tests/Abstractions/ResultTests.cs` were not re-read (the search output was truncated), so unit
coverage is cited by file only. Flag (2026-11-25): the search for a `throw new DomainInvariantViolationException` site was
truncated after `Source/Presentation/MMCA.Common.API/Controllers`, so the prose "no code path in MMCA.Common throws it" is
carried from the prior pass rather than fully re-proved. Change history: this pass adds the init-only `RetryAfter` to the
`Error` carrier bullet and the `Retry-After` header to the transport section (`Error.cs:37`, `ApiControllerBase.cs:74`,
`:87-101`), and re-anchors `Error.cs` (factories +8), `ErrorHttpMapping.cs` (+3), `ApiControllerBase.cs` (+14),
`SupportsIfMatchAttribute.cs` (219 to 268), `DependencyInjection.cs` (+3), `Speaker.cs` (180/182 to 179/181),
`EntityControllerBase.cs`, `CrudEntityControllerBase.cs`, `EntityServiceBase.cs`, `AGENTS.md` (103/105 to 121/123), the
scorecard rows (+1) and ADR-013 (Trade-offs 347 to 362). Earlier passes (2026-09-19 to 2026-10-29) added `TooManyRequests`
(v1.219.0) and `TryGetValue` (v1.252.0), the `KeysetCollectionResult<T>` envelope, the `BadHttpRequestException`
pass-through, and the "for business outcomes" scope on the subtitle.*

- Full series index: https://ivanball.github.io/writing.html
