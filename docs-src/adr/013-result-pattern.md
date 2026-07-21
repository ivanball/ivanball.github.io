# ADR-013: Result Pattern over Exceptions for Flow Control

## Status
Accepted. Revised 2026-07-21 (exception-handler chain / ProblemDetails edge contract documented).

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
  `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`. The domain never names an HTTP status.
- Domain factory methods and mutators return `Result<T>`; application command/query handlers thread
  results through the `Match()`, `Map()`, and `BindAsync()` combinators instead of `try`/`catch`.
- The transport mapping lives only at the edge. `ApiControllerBase.HandleFailure()` maps the first
  error's `ErrorType` to an HTTP status via a `FrozenDictionary` and returns an RFC 9457 ProblemDetails
  body carrying all errors. gRPC does the equivalent over the wire (`GrpcResultExceptionInterceptor`,
  ADR-007), so callers keep programming against `Result<T>` across a process boundary.
- Exceptions are reserved for the genuinely exceptional: programming errors (null-argument guards) and
  infrastructure faults (DB / transaction failures) that should abort the request rather than be
  modeled as a business outcome.
- When an exception does escape to the HTTP edge, the API layer converges it onto the same RFC 9457
  ProblemDetails shape via an ordered `IExceptionHandler` chain, so both channels (Result and
  exception) return one wire contract. `AddCommonExceptionHandlers()` first registers `AddProblemDetails`
  (which stamps a `requestId` extension from the request's trace identifier), then registers the handlers
  in a load-bearing order; ASP.NET Core runs them in registration order and stops at the first handler
  that reports the exception handled, so most-specific-first placement is the mechanism, not a comment
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:116-127`, registrations at
  lines 121-125):
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
  line, and short-circuit on the first failure.
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
- The `ErrorType` to HTTP mapping is one-directional and first-error-wins for the *status code* (all
  errors still serialize into the ProblemDetails body).
- The exception-handler registration order is load-bearing. Because ASP.NET Core stops at the first
  handler that reports the exception handled, a mis-ordered registration (for example the catch-all
  `GlobalExceptionHandler` ahead of a specific handler) would swallow the more precise status;
  `GlobalExceptionHandler` must stay registered last
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:121-125`).

## Related
ADR-007 (Result over the wire via gRPC), ADR-014 (the decorator pipeline returns `Result.Failure` to
short-circuit a command before it reaches the handler).
