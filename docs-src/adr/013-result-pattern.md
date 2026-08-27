# ADR-013: Result Pattern over Exceptions for Flow Control

## Status
Accepted. Revised 2026-07-21 (exception-handler chain / ProblemDetails edge contract documented).
Revised 2026-08-26 (`ErrorType.Unexpected`, severity-ranked status selection for aggregated
failures, and the full combinator surface).

## Context
Operations at every layer fail in *expected* ways: input is invalid, a domain invariant is broken, a
requested entity is missing, a uniqueness conflict occurs, the caller lacks permission. There are two
common ways to signal those: throw an exception and translate it near the edge, or return an explicit
value that the caller must inspect. Using exceptions for *expected* business outcomes has real costs:
the failure is invisible in the method signature, it is easy to forget to catch, it is comparatively
expensive on the throw path, and it conflates "the user asked for something we will not do" with "the
process is broken."

## Decision
Model expected failures as values using `Result` / `Result<T>` (`MMCA.Common.Shared.Abstractions`),
not exceptions.

- A `Result` is either success or failure; a failure carries one or more `Error` records (`Code`,
  `Message`, `Type` of type `ErrorType`, optional `Source` / `Target`).
- `ErrorType` is a **transport-agnostic** category: `Validation`, `Invariant`, `NotFound`, `Conflict`,
  `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`, `Unexpected`. The domain never names
  an HTTP status. `Unexpected` is the one category reserved for a genuine server-side fault (the
  request was well formed and permitted, the server could not complete it,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:36-41`): it maps to HTTP 500
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:30`) and to gRPC
  `Internal` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:45`), and it
  is explicitly not for business-rule violations, which is what keeps the other eight categories
  caller-fixable (`ErrorType.cs:38-39`, factory at `.../Shared/Abstractions/Error.cs:114-115`).
- Domain factory methods and mutators return `Result<T>`; application command/query handlers thread
  results through combinators instead of `try`/`catch`. The surface is:
  - **Lifting without naming a factory.** An `Error` converts implicitly to a failed `Result`
    (`.../Shared/Abstractions/Result.cs:43`) or `Result<T>` (`:233-237`), and a value converts
    implicitly to a successful `Result<T>` (`:249`), so a guard clause writes `return someError;` and
    a happy path writes `return theValue;`. `Result.FromError` is the named alternate for the
    non-generic conversion (`:49-53`); the inherited `Result.Failure<T>` / `Result.Success<T>`
    factories are the named alternates on the generic type (`:229-232`, `:245-248`).
  - **On `Result<T>`:** `Match` (`:260-268`) / `MatchAsync` (`:355-365`), exactly one branch running
    in both; `Map` (`:276-280`), `Bind` (`:302-306`) / `BindAsync` (`:289-293`), `Tap` (a side effect
    on the success value, returning the same instance, `:314-324`) and `Ensure` (fail the chain with a
    supplied `Error` when the value does not satisfy a predicate, `:334-345`).
  - **On the non-generic `Result`:** `Match` (`:155-161`), `Bind` (`:187-191`) and `OnFailure`
    (`:169-179`), so a valueless step composes the same way instead of forcing an `IsFailure` check.
  - **On a pending `Task<Result<T>>`:** `ResultExtensions`
    (`.../Shared/Abstractions/ResultExtensions.cs:10`) carries `BindAsync` over both a `Task`-returning
    and a synchronous binder (`:20-29`, `:39-48`), `MapAsync` (`:58-67`), `TapAsync` (`:77-91`) and
    `MatchAsync` (`:102-113`), so an asynchronous pipeline composes end to end without an intermediate
    `await` and its temporary local between every step. Each awaits the incoming task once and
    delegates to the same instance combinator, so the short-circuit behavior is identical (`:3-9`).
  - Every combinator short-circuits: a failed result never invokes the delegate it was handed
    (`Result.cs:279`, `:292`, `:305`, `:339-342`).
- The transport mapping lives only at the edge. `ApiControllerBase.HandleFailure()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35-60`) maps an
  `ErrorType` to an HTTP status through a `FrozenDictionary` (`ErrorHttpMapping.cs:20-31`, resolved at
  `ApiControllerBase.cs:48`) and returns an RFC 9457 ProblemDetails body carrying **all** errors
  (`:50-58`, projection at `ErrorHttpMapping.cs:112-120`). gRPC does the equivalent over the wire
  (`GrpcResultExceptionInterceptor`, ADR-007) from a mirrored table (`Validation`/`Invariant`/`Failure`
  to `InvalidArgument`, `NotFound` to `NotFound`, `Conflict` to `Aborted`, `Unauthorized` to
  `Unauthenticated`, `Forbidden` to `PermissionDenied`, `UnprocessableEntity` to `FailedPrecondition`,
  `Unexpected` to `Internal`: `ResultGrpcExtensions.cs:34-46`), so callers keep programming against
  `Result<T>` across a process boundary.
- **A failure carrying several errors takes the status of the most severe one, never of the first.**
  `Result.Combine` aggregates errors in evaluation order (`Result.cs:124-145`), so a positional rule
  let an incidental validation failure downgrade a real 403 or 500 to a 400. `ErrorHttpMapping` ranks
  the categories instead (`ErrorHttpMapping.cs:49-60`, rationale at `:33-48`), most to least severe:
  `Unexpected` (500) > `Unauthorized` (401) > `Forbidden` (403) > `Conflict` (409) > `NotFound` (404) >
  `UnprocessableEntity` (422) > `Invariant` / `Validation` / `Failure` (400, one shared rank at
  `:57-59`). Ties keep the earliest error (`:84-92`, strict `>` at `:87`), an unmapped category ranks
  lowest so it can never silently outrank a real 403 or 500 (`:101-102`), and only the *status* is
  ranked: every error still travels in the ProblemDetails `errors` array (`:69-73`). The scan is
  index-based rather than a LINQ `MaxBy` because it runs on every failure response (`:82-83`).
- Exceptions are reserved for the genuinely exceptional: programming errors (null-argument guards) and
  infrastructure faults (DB / transaction failures) that should abort the request rather than be
  modeled as a business outcome.
- When an exception does escape to the HTTP edge, the API layer converges it onto the same RFC 9457
  ProblemDetails shape via an ordered `IExceptionHandler` chain, so both channels (Result and
  exception) return one wire contract. `AddCommonExceptionHandlers()` first registers `AddProblemDetails`
  (which stamps a `requestId` extension from the request's trace identifier), then registers the handlers
  in a load-bearing order; ASP.NET Core runs them in registration order and stops at the first handler
  that reports the exception handled, so most-specific-first placement is the mechanism, not a comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:135-147`, registrations at
  lines 140-144):
  - `OperationCanceledExceptionHandler` (registered first) maps a client-disconnect
    `OperationCanceledException` to the non-standard HTTP 499 Client Closed Request, so monitoring can
    tell an abandoned request apart from a server fault
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:27,32`).
  - `DomainExceptionHandler` maps a `DomainException` (a business-rule violation reaching the edge as an
    exception rather than a `Result`) to HTTP 400 Bad Request
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:27,32`).
  - `DbUpdateExceptionHandler` maps an EF Core `DbUpdateException` (concurrency, unique-constraint, or
    foreign-key failure) to HTTP 409 Conflict, returning a generic detail so no database schema detail
    leaks to the client
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:28,33,37`).
  - `ValidationExceptionHandler` maps a FluentValidation `ValidationException` to HTTP 400, grouping the
    failures by property name into an `errors` extension that matches ASP.NET Core's model-validation
    shape
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:28,33,48-54`).
  - `GlobalExceptionHandler` (registered last) is the catch-all that turns any remaining unhandled
    exception into HTTP 500
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:26-28`).

## Rationale
- **Failures are in the signature.** A method that can fail returns `Result<T>`, so the caller cannot
  silently ignore the failure path the way an uncaught exception allows.
- **Category, not status code, at the core.** `ErrorType` keeps Domain and Application transport-
  agnostic; only the API (or gRPC interceptor) translates it, so the same handler serves REST and gRPC.
- **Composable.** The railway-oriented combinators chain steps without an `IsFailure` check at every
  line, and short-circuit on the first failure. The implicit conversions are what keep the ceremony
  proportional: a guard clause returns the `Error` itself (`Result.cs:37-43`), so the cheapest thing
  to write is also the correct one.
- **An aggregate answers with its worst problem.** Ranking the categories makes the status independent
  of the order invariants happen to be evaluated in, which is the one thing a caller cannot see and
  the one thing `Result.Combine` makes arbitrary (`ErrorHttpMapping.cs:34-37`, restated on the enum
  itself at `ErrorType.cs:5-8`).
- **Cheap and predictable.** No throw/catch on the common "won't do it" path.
- **One wire contract for both channels.** Whether a request ends in a `Result.Failure` mapped by
  `HandleFailure()` or an escaped exception caught by the handler chain, the client receives the same
  RFC 9457 ProblemDetails body (carrying the shared `requestId` extension), so consumers parse one error
  shape regardless of which channel produced it.

## Trade-offs
- More ceremony at call sites than letting an exception bubble; the combinators absorb most of it.
- Two error channels coexist (Result for expected, exceptions for exceptional). The boundary is a
  judgment call: "could a well-behaved caller reasonably trigger this?" then return a `Result`,
  otherwise throw.
- The `ErrorType` to HTTP mapping is one-directional, and one status has to stand for a whole list.
  Severity ranking removes the ordering dependency but not the collapse: a failure carrying a 403 and
  a 400 answers 403, and the 400 is visible only to a client that reads the `errors` array
  (`ErrorHttpMapping.cs:69-73`). The three 400-mapped categories share one rank (`:57-59`), so among
  them the earliest error still wins.
- **The two transports rank differently.** HTTP picks the most severe error's status
  (`ApiControllerBase.cs:47-48`); the gRPC `ToRpcException` path still takes the **first** error's type
  (`ResultGrpcExtensions.cs:110-112`), with all errors travelling in the trailers (`:118-124`), so an
  aggregate failure can answer with a different category depending on which edge a caller reached.
- The exception-handler registration order is load-bearing. Because ASP.NET Core stops at the first
  handler that reports the exception handled, a mis-ordered registration (for example the catch-all
  `GlobalExceptionHandler` ahead of a specific handler) would swallow the more precise status;
  `GlobalExceptionHandler` must stay registered last
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:140-144`).

## Related
ADR-007 (Result over the wire via gRPC), ADR-014 (the decorator pipeline returns `Result.Failure` to
short-circuit a command before it reaches the handler).
