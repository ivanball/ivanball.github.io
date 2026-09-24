# Stop throwing exceptions for control flow: the Result railway in C#

> Series: MMCA.Common · Article #4 · Pillar P2 · Group G01 · Rubric §1,§2 · ADR-013 ·
> Status: grounded in `Website/docs-src/adr/013-result-pattern.md`, `MMCA.Common/CLAUDE.md` (the Result-pattern
> conventions referenced inline, not a titled section), and `Website/docs-src/onboarding/group-01-result-error-handling.md`. No em dashes.

**Subtitle:** "This order ID does not exist" is not an exceptional event, it is a routine branch of
normal control flow. Here is the `Result<T>` railway that models it as a value, and why the domain in
MMCA.Common throws zero exceptions.

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
CQRS command and query handler, every controller action, and every service method returns `Result` or
`Result<T>`. This article is about why, and about the small set of types that make it ergonomic enough
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

- **`ErrorType`** is the classification axis: a nine-value enum. `Validation`, `Invariant`,
  `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`, and
  `Unexpected` for a genuine server-side fault the caller cannot fix by changing the request.
  Critically, this is a pure enum with no reference to ASP.NET. The domain never names an HTTP
  status code.
- **`Error`** is the carrier: an immutable positional `record` with a machine-readable `Code` (e.g.
  `"Order.NotFound"`, for programmatic branching), a human-readable `Message`, an `ErrorType`, and
  optional `Source` / `Target` context. Nine factory methods (one per `ErrorType`) each hard-code the
  correct type, so a caller can never pair `Error.NotFoundError(...)` with the wrong classification.
- **`Result`** (and the generic `Result<T>`) is the outcome envelope: either a success, or a failure
  carrying one or more `Error`s.

You cannot `new` a `Result<T>`. Its constructors are `internal`; the only way in is through the static
factories (`Result.Success`, `Result.Failure`). That discipline guarantees the invariant the rest of
the codebase relies on: a result is always either a clean success or a non-empty failure, never a
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
supplied `Error` when the value does not satisfy a predicate. Every one of them skips the delegate it was
handed when the result is already a failure. A separate `ResultExtensions` class lifts `BindAsync`,
`MapAsync`, `TapAsync` and `MatchAsync` onto a pending `Task<Result<T>>`, so an asynchronous pipeline
composes end to end without an `await` and a temporary local between every step.

The non-generic base carries four members of its own, and **`Result.Combine(params ReadOnlySpan<Result>)`**
is the one that earns its keep: the aggregate-all-failures combinator. It runs several invariant checks and
returns *all* their errors at once rather than failing on the first. This is the workhorse of domain factory
methods. The `ReadOnlySpan` parameter avoids a heap allocation in the common case. `Match`, `Bind` and
`OnFailure` round out the base, so a valueless step composes the same way instead of forcing an
`if (result.IsFailure)` check.

```csharp
// A domain factory: invalidity is unrepresentable, and every broken rule is reported at once.
public static Result<Speaker> Create(string name, Email email, DateOnly availableFrom)
{
    var validation = Result.Combine(
        CheckName(name),
        EmailInvariants.EnsureEmailIsValid(email, nameof(Create)),
        CheckAvailability(availableFrom));

    if (validation.IsFailure)
    {
        return Result.Failure<Speaker>(validation.Errors);
    }

    return Result.Success(new Speaker { Id = default, Name = name, Email = email });
}

// The shared create pipeline propagates the failure and stops; the success path continues.
protected async Task<Result<TEntityDTO>> CreateCoreAsync(
    IUnitOfWork attemptUnitOfWork,
    TCreateRequest command,
    CancellationToken cancellationToken)
{
    var prepared = await PrepareAsync(attemptUnitOfWork, command, cancellationToken).ConfigureAwait(false);
    if (prepared.IsFailure)
        return Result.Failure<TEntityDTO>(prepared.Errors);

    var result = await requestMapper.CreateEntityAsync(prepared.Value!, cancellationToken).ConfigureAwait(false);
    if (result.IsFailure)
        return Result.Failure<TEntityDTO>(result.Errors);

    var entity = result.Value!;
    var repository = attemptUnitOfWork.GetRepository<TEntity, TIdentifierType>();

    await PersistAsync(attemptUnitOfWork, repository, entity, cancellationToken).ConfigureAwait(false);

    return Result.Success(dtoMapper.MapToDTO(entity));
}
```

No `try`, no `catch`, no `throw`. The factory refuses to build an invalid `Speaker`, the handler
forwards the errors it cannot handle, and the failure path is carried along as data.

### The transport mapping lives only at the edge

Because `ErrorType` is transport-agnostic, the translation to an HTTP status code is centralized in a
single shared internal class, `ErrorHttpMapping`. It owns the `FrozenDictionary` that maps each
`ErrorType` to a status (`Validation`, `Invariant` and `Failure` to 400, `NotFound` to 404, `Conflict`
to 409, `Unauthorized` to 401, `Forbidden` to 403, `UnprocessableEntity` to 422, `Unexpected` to 500,
anything unmapped falling back to 400) and the `GetStatusCode` lookups over it. Two consumers share the
status lookup. `ApiControllerBase.HandleFailure()` is the normal path: a controller action resolves the
status from the *most severe* error present through `ErrorHttpMapping` and renders an RFC 9457
ProblemDetails body carrying *all* the errors. `UnhandledResultFailureFilter` is the safety net: a global
filter that catches an action which accidentally returns a failed `Result` as a 200 body and rewrites it
into the identical ProblemDetails shape via the same mapping. A third caller, the `If-Match` concurrency
attribute, reuses the same class for the errors projection alone. Because the dictionary lives in one
place, the controller base and the filter can never drift apart.

The gRPC layer does the equivalent over the wire (`GrpcResultExceptionInterceptor`, ADR-007), so a remote
call looks like a local `Result<T>` to application code. One enum drives both transports, so every
endpoint and every extracted service produces the same error shape. There is one source of truth for
"what does a not-found look like."

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

A paged query handler returns `Result<PagedCollectionResult<T>>`, composing the two ideas: the railway
carries success-or-failure, and the success payload is the canonical paged shape. One envelope for every
write, one for every read, and the response contract stays stable as the API grows.

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
  framework-owned. That is not the only exception the framework catches, though. An ordered
  `IExceptionHandler` chain converges every escaped exception onto the same RFC 9457 ProblemDetails
  contract: a cancellation handler (499), a domain-exception handler (400), a `DbUpdate` handler (409),
  a validation handler (400), and a catch-all (500), registered in that load-bearing order. So the
  failure shape stays identical whether it arrived as a `Result` or as a throw.
- **One status has to stand for a whole list of errors.** Every error serializes into the
  ProblemDetails body, but the status code can only be one number, so it is resolved by ranking: the
  most severe `ErrorType` present wins (`Unexpected` over `Unauthorized` over `Forbidden` over
  `Conflict` over `NotFound` over `UnprocessableEntity` over the shared bottom rank of `Invariant`,
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

*Notes: re-verified 2026-09-19 against MMCA.Common at v1.205.0. Type and behavior names, all read this
run: `ErrorType` (nine members: Validation, Invariant, NotFound, Conflict, Unauthorized, Forbidden,
UnprocessableEntity, Failure, Unexpected; `Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:10-41`,
`Unexpected` at `:36-41`); `Error` with nine factory methods, one per member
(`.../Abstractions/Error.cs`: `Validation` `:37`, `Invariant` `:46`, `NotFoundError` `:55`, `Conflict`
`:64`, `Unauthorized` `:73`, `Forbidden` `:82`, `UnprocessableEntity` `:91`, `Failure` `:100`,
`Unexpected` `:114`); and `Result`/`Result<T>` (`.../Abstractions/Result.cs`, 366 lines). Combinators
re-anchored this run: on `Result<T>`, `Match` `:260`, `Map` `:276`, `BindAsync` `:289`, `Bind` `:302`,
`Tap` `:314`, `Ensure` `:334`, `MatchAsync` `:355`, with the internal value-bearing constructors at
`:211` and `:217`; on the non-generic `Result`, `Combine` `:124`, `Match` `:155`, `OnFailure` `:169`,
`Bind` `:187`. `ResultExtensions` (`.../Abstractions/ResultExtensions.cs:10`) lifts the same shapes onto
a pending `Task<Result<T>>`: `BindAsync` `:20`/`:39`, `MapAsync` `:58`, `TapAsync` `:77`, `MatchAsync`
`:102`. ADR-013 documents the whole surface (`Website/docs-src/adr/013-result-pattern.md:48-59`).
The combinators carry production call sites, not only tests: `.Map(...)` at
`Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:75` and `:127`, while `Combine`
and the explicit guard-and-propagate pair are used throughout. Unit coverage is
`Tests/Core/MMCA.Common.Shared.Tests/Abstractions/ResultTests.cs`: `Map` `:119`/`:128`, `BindAsync`
`:146`/`:156`/`:166`, `Match` `:184`/`:196`, `Bind` `:325`/`:334`, `Tap` `:352`/`:364`, `Ensure`
`:377`/`:387`/`:396`, `MatchAsync` `:415`/`:425`, the non-generic `Match`/`OnFailure`/`Bind` at
`:255-308`, implicit conversions at `:209-246`. The application-handler snippet is the shared create
pipeline `CreateCoreAsync`
(`Source/Core/MMCA.Common.Application/UseCases/Crud/CreateEntityHandlerBase.cs:77-103`: guard-and-propagate
at `:84-86` and `:91-92`, repository at `:95`, `Result.Success` at `:102`), condensed for print (the
`ArgumentNullException` guard at `:82` and the `prepared.Value!` local at `:88` are elided). Its ADC leaf
`CreateSpeakerHandler`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:15-27`)
is a 28-line primary-constructor sealed partial class deriving from
`CreateEntityHandlerBase<SpeakerCreateRequest, Speaker, SpeakerIdentifierType, SpeakerDTO>` (`:20-21`)
whose only body member is the `LogCreated` override (`:24`), so the railway lives in the base. The
`Speaker.Create` snippet is illustrative of the documented factory shape, not copied verbatim from a
single source file. `DomainInvariantViolationException`
(`Source/Core/MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9`) is the concrete
`DomainException` subclass for the EF-materialization gap; an ordered `IExceptionHandler` chain
(`AddCommonExceptionHandlers`, `Source/Presentation/MMCA.Common.API/DependencyInjection.cs:149`,
re-anchored this run: doc comment `:143-148`, the five `AddExceptionHandler` registrations at `:154-158`,
OperationCanceled 499, Domain 400, DbUpdate 409, Validation 400, catch-all Global 500) converges every
escaped exception onto the same RFC 9457 ProblemDetails contract. The status mapping lives in one shared
internal class: `ErrorHttpMapping` holds the `FrozenDictionary` (`ErrorTypeToStatusCode`,
`Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:20-31`, `Unexpected` to 500 at `:30`),
the single-type `GetStatusCode` with its 400 fallback (`:37-38`), and the list overload that resolves the
status from `ErrorTypeSeverity.MostSevere(errors).Type` (`:50-51`); its own doc comment (`:8-13`) states
the mapping is shared so the controller base and the filter stay consistent. The severity ranking is one
table in the Shared layer (`Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:37-48`:
Unexpected 70, Unauthorized 60, Forbidden 50, Conflict 40, NotFound 30, UnprocessableEntity 20,
Invariant/Validation/Failure sharing 10), ties keeping the earliest error; ADR-013 argues it at
`013-result-pattern.md:72-83`. Two consumers call the status lookup: `ApiControllerBase.HandleFailure`
(`Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35`, status resolved at `:48`,
errors extension at `:58`) and `UnhandledResultFailureFilter`
(`.../Middleware/UnhandledResultFailureFilter.cs:36`, errors extension at `:47`); a third caller,
`SupportsIfMatchAttribute` (`.../Concurrency/SupportsIfMatchAttribute.cs:217`), reuses
`BuildErrorsExtension` alone. The §15 (Best Practices & Code Quality) scorecard row
(`Website/docs-src/governance/common-ArchitectureScorecard.md:95`, re-anchored this run: the table
header sits at `:79` and the whole table shifted eight lines) credits "consistent Result-based error
handling". Read-side envelopes `CollectionResult<T>` / `PagedCollectionResult<T>` / `PaginationMetadata`
(`[DataContract]` with deterministic `[DataMember(Order)]`, computed members tagged `[IgnoreDataMember]`)
live in `MMCA.Common.Shared.Abstractions/PaginationMetadata.cs`; a paged handler returns
`Result<PagedCollectionResult<T>>`. The header rubric mapping stays §1,§2: the §1 SOLID Principles row
(`common-ArchitectureScorecard.md:81`) and the §2 Design Patterns row (`:82`, "Idiomatic, problem-driven:
Result over exceptions ... entity Factory+Result") both rest on this article's subject, while the §10
Messaging & Integration Architecture row (`:90`) carries no Result or error-handling evidence, so §10
stays off the header line. The article grounds §1 independently: the three-type split
(`ErrorType`/`Error`/`Result`) is an SRP separation, one classifies, one carries, one envelopes (criterion
at `ArchitectureEvaluationCriteria.md:127`, re-anchored this run from `:114`), and the combinator surface
stays role-narrow, with the valueless shapes kept on the non-generic `Result` rather than forced onto
`Result<T>` (ISP criterion at `:130`, from `:117`). Change history: the previous pass called `ErrorType`
eight-valued, described `Result<T>` as a deliberately minimal three-combinator surface, and described the
HTTP status selection as first-error-wins; all three moved, against the source cited above. An earlier
claim that no "zero throw-new in Domain" rule exists anywhere in the repo is dropped rather than repeated,
because a workspace-wide absence was not established this run.*

- Full series index: https://ivanball.github.io/writing.html
