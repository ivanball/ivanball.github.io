# ADR-013: Result Pattern over Exceptions for Flow Control

## Status
Accepted. Revised 2026-07-21 (exception-handler chain / ProblemDetails edge contract documented).
Revised 2026-08-26 (`ErrorType.Unexpected`, severity-ranked status selection for aggregated
failures, and the full combinator surface).
Revised 2026-08-27 (v1.164.0): the **UI layer deviation is retired**. `MMCA.Common.UI` services
return `Result` end to end instead of throwing, the severity ranking is hoisted into
`MMCA.Common.Shared` so the HTTP and gRPC edges classify one aggregate identically, and the round
trip back into `Result` is a shipped reader rather than a per-service convention.
Revised 2026-08-31: the catch-all exception handler now maps `CrossTenantWriteException` to HTTP 400
ahead of its 500 fallback, so a write refused at the tenant boundary reads as a caller fault.
Revised 2026-09-03: the error `Code` is gated as a per-repo public vocabulary (one literal code, one
owning type) by an IL-reading architecture rule.

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
  `Internal` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:46`), and it
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
  (`:50-58`, projection at `ErrorHttpMapping.cs:61-69`). gRPC does the equivalent over the wire
  (`GrpcResultExceptionInterceptor`, ADR-007) from a mirrored table (`Validation`/`Invariant`/`Failure`
  to `InvalidArgument`, `NotFound` to `NotFound`, `Conflict` to `Aborted`, `Unauthorized` to
  `Unauthenticated`, `Forbidden` to `PermissionDenied`, `UnprocessableEntity` to `FailedPrecondition`,
  `Unexpected` to `Internal`: `ResultGrpcExtensions.cs:34-46`), so callers keep programming against
  `Result<T>` across a process boundary.
- **A failure carrying several errors takes the status of the most severe one, never of the first,
  and both edges rank it the same way.** `Result.Combine` aggregates errors in evaluation order
  (`Result.cs:124-145`), so a positional rule let an incidental validation failure downgrade a real
  403 or 500 to a 400. The ranking is one table in the Shared layer,
  `ErrorTypeSeverity` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:30`),
  most to least severe: `Unexpected` (70) > `Unauthorized` (60) > `Forbidden` (50) > `Conflict` (40) >
  `NotFound` (30) > `UnprocessableEntity` (20) > `Invariant` / `Validation` / `Failure` (one shared
  rank of 10, `:39-47`), with the reasoning for each rank written onto the type itself (`:16-25`).
  `MostSevere` keeps the earliest error on a tie (`:69-96`, strict `>` at `:88`) and an unmapped
  category ranks lowest, so a category added to `ErrorType` without a rank can never silently
  outrank a real 403 or 500 (`:57`, stated at `:50-53`). The scan is index-based rather than a LINQ
  `MaxBy` because it runs on every failure response (`:83-84`).

  **It lives in Shared rather than in one presentation package because two edges consume it.** HTTP
  resolves the status from `ErrorTypeSeverity.MostSevere`
  (`.../MMCA.Common.API/Middleware/ErrorHttpMapping.cs:50-51`, called from
  `ApiControllerBase.HandleFailure` at `ApiControllerBase.cs:48`) and gRPC's `ToRpcException` does
  the same (`.../MMCA.Common.Grpc/ResultGrpcExtensions.cs:116-118`, argued at `:100-107`). Only the
  *status* is ranked: every error still travels in the ProblemDetails `errors` array
  (`ErrorHttpMapping.cs:61-69`) and in the gRPC trailers as `error-{i}-code` / `-message` / `-type`
  (`ResultGrpcExtensions.cs:128-130`). Ranking in one place is what makes the two transports agree;
  the previous arrangement, with the table inside `MMCA.Common.API`, left gRPC classifying an
  aggregate by its first error while HTTP classified it by its worst.
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
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:67-80`,
    status set at `:69`). It maps exactly one exception by type before that fallback: a
    `CrossTenantWriteException` (the save-time tenant-boundary rejection,
    `.../MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24`) is a
    caller fault rather than a server fault and is answered with HTTP 400, logged at warning rather
    than error because a tenant-scoped API refusing an untenanted write is routine (`:47-64`, the
    warning at `:51`, the 400 at `:53`). The special case sits inside the catch-all rather than in
    its own handler because the exception derives from `InvalidOperationException`, so no handler
    ahead of this one claims it, and every other save-time invariant failure of that family still
    ends at the 500 (`:13-19`). The response body names no tenant id and no entity type: echoing
    either would tell an unauthorized caller which tenant owns the row it just tried to write, so
    the detail is a fixed string and the full failure stays in the log (`:31-39`).

### The client half: the UI layer returns `Result` too (2026-08-27)

Until v1.164.0 this record held everywhere except the one layer a user actually sees. A UI service
called the API, pulled the domain wording out of the ProblemDetails body, and **rethrew it** as a
`DomainInvariantViolationException` for the page to catch: the pattern was inverted at the last hop,
and every page paid for it with a `try`/`catch` around a call whose failure was entirely expected.
That deviation is retired. Every HTTP-typed client service in `MMCA.Common.UI` now returns
`Result` / `Result<T>`, and `ServiceExceptionHelper` is deleted rather than deprecated.

Two halves make a service method honestly typed, and they are deliberately separate types:

- **`ProblemDetailsResultReader` converts a response.**
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:58`.) It is the
  exact reverse of `ApiControllerBase.HandleFailure`: `ReadAsync(response, ct)` answers a valueless
  `Result` (`:223`) and `ReadAsync<T>(response, options, ct)` deserializes a 2xx body or parses the
  failure (`:257`), with the pure `ParseProblemDetails(status, body)` core testable against captured
  payloads (`:153`). It understands four payload shapes (`:20-49`): the **MMCA error array**, where
  `code`, `message`, `type`, `source` and `target` all round-trip and `type` parses straight back
  into `ErrorType` (`:319-354`, the parse at `:403-408`), the ASP.NET Core **validation dictionary**
  (`:356-382`), **plain ProblemDetails** with no `errors` extension, and a **non-JSON or empty
  body**, each of the last three synthesizing one error coded `Http.{status}` (`:410-414`). Property
  lookup is case-insensitive on purpose, because a hand-built PascalCase payload would otherwise
  silently lose every field (`:438-443`). It lives in `MMCA.Common.Shared` and uses nothing beyond
  the BCL, because the consumer is `MMCA.Common.UI`, which references Shared only (`:14-19`).
- **`HttpResultExecutor` converts the absence of one.**
  (`.../MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:31`.) It does not make the request: it takes
  the caller's whole send-and-read operation as a `Func<Task<Result>>` / `Func<Task<Result<T>>>` and
  wraps it (`:52`, `:87`), so the two halves compose without either knowing the other's shape. A
  refused connection, a DNS failure, a dropped socket, an unreadable body (`HttpRequestException`,
  `IOException`, `JsonException`) becomes a failed `Result` coded `Http.TransportFailure`
  (`:121-127`, code at `:34`), and an `HttpClient` timeout becomes `Http.Timeout` (`:129-130`, code
  at `:37`). Anything else is a genuine programming fault and keeps travelling as an exception
  (`:118-119`). The exception's own text goes on `Error.Source`, never on `Message`, because it is
  diagnostic detail that is neither localizable nor safe to render (`:124-127`).

**`OperationCanceledException` is the one exception that still crosses the boundary, and that is the
decision, not an omission.** When the caller's own token is why the operation stopped, the
cancellation is rethrown (`HttpResultExecutor.cs:65-68`, `:100-103`, argued at `:17-23`): a disposed
component or a superseded grid fetch owns its own cancellation and must not have it handed back as
an error to render. A client timeout raises the same exception type with the token *not* cancelled,
and that one does become a failure (`:69-72`). The token is also checked before the call, so an
already-abandoned request never reaches the network (`:59`, `:94`).

**Pages branch; they do not catch.** `ResultUiExtensions`
(`.../MMCA.Common.UI/Common/ResultUiExtensions.cs:63`) is the page-side idiom, written once so no
page hand-rolls it: `TryGetValue` unwraps inside a conditional the way `Dictionary.TryGetValue`
does, deciding the failing branch on `IsFailure` rather than on the value so a value-type default is
not mistaken for success (`:82-97`, the overload handing the errors back at `:116`);
`OnFailureSetError` pushes the composed message into a page field (`:226`) and `NotifyOnFailure`
raises it as exactly one snackbar, never one per error (`:265`); and `HasErrorType` with
`IsNotFound` / `IsUnauthorized` lets a page turn a 404 into an empty state and a 401 into a redirect
instead of an alert (`:303-323`). Messages are localized as resource keys **with pass-through**, so
one call site handles both an API error the server already translated and a client-side error whose
`Message` is a key (`:17-23`, `:325-334`, ADR-027), and they are deduplicated and ordered by the
same `ErrorTypeSeverity` rank the edges use, so a real 403 leads and an incidental validation
message never buries it (`:145-159`, the ordering at `:155`). The shared `ErrorSummary` component
renders the same list as one deduplicating `MudAlert`, taking a failed `Result` and the
`MudForm.Errors` shape together and rendering nothing at all when there is nothing to say
(`.../MMCA.Common.UI/Components/Forms/ErrorSummary.razor:8`, both shapes merged at `:81-102`, one message
inline and several as a list so a screen reader announces them as several items, `:15-29`).

**A component that shows a retry needs the failure, not an exception.**
`MobileInfiniteScrollList` takes one page fetcher, `FetchPageResult`, a required delegate returning
`Task<Result<(IReadOnlyList<TItem> Items, int TotalItems)>>`
(`.../MMCA.Common.UI/Components/Lists/MobileInfiniteScrollList.razor.cs:37-39`), and renders the failure's
localized message beside its inline retry affordance (`:259-268`, the message read from the failed
`Result` at `:262`). A tuple-returning delegate is not offered beside it: a tuple has no way to carry
a failure at all, so the component would be left showing a Retry button that cannot name what it is
retrying. The delegate is checked at initialization, so a call site that omits it throws instead of
rendering as a load failure that can never succeed (`:93-105`).

### The error `Code` is a public vocabulary, gated for uniqueness (2026-09-03)

`Code` is the half of a failure that crosses the wire verbatim (`ErrorHttpMapping.cs:61-69`) and the
key ADR-027 localizes the message by, so a client switches on `Order.NotFound` and a support ticket
quotes it. Two modules that both ship `Item.Invalid` make that vocabulary ambiguous, and the
ambiguity only surfaces in production
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.ErrorCatalog.cs:31-37`).
The catalog is therefore frozen the way ADR-010 froze integration-event schemas and ADR-015 Section B
froze the `.proto` contracts. A Mono.Cecil IL scan reads every `Error` factory call site (`:169`,
`:206-208`, the recognized members at `:17-29` and `:218-222`) across a repo's per-module Domain and
Application assemblies only (`:184-189`); `ErrorCodesAreUnique` (`:62`) fails the build when one
literal code is constructed by more than one declaring type (`:73`), and
`ErrorCodesUseAnAllowedPrefix` (`:102`) requires the owning prefix. A code built at run time is
reported as UNVERIFIABLE rather than passed or failed (`:210-213`, `:151-155`). Consumers subclass
`ErrorCatalogTestsBase` (`.../Bases/Contracts/ErrorCatalogTestsBase.cs:20`, the three facts at `:46`,
`:50`, `:54`) and allowlist a deliberately shared code (`:35-36`) rather than rename a shipped one:
Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/ErrorCatalogTests.cs:19`)
and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Contracts/ErrorCatalogTests.cs:20`)
do; MMCA.Common ships no module catalog and self-tests the rules against fixtures instead
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Contracts/ErrorCatalogFitnessTests.cs:15`).

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
  the one thing `Result.Combine` makes arbitrary (`ErrorHttpMapping.cs:40-47`, restated on the enum
  itself at `ErrorType.cs:5-8`).
- **Cheap and predictable.** No throw/catch on the common "won't do it" path.
- **One wire contract for both channels.** Whether a request ends in a `Result.Failure` mapped by
  `HandleFailure()` or an escaped exception caught by the handler chain, the client receives the same
  RFC 9457 ProblemDetails body (carrying the shared `requestId` extension), so consumers parse one error
  shape regardless of which channel produced it.
- **The layer with the most expected failures had the least Result.** A UI service call fails for
  every reason this record was written about: the input was rejected, the record is gone, the caller
  signed out. Converting the response back into an exception at the last hop meant the one layer
  whose whole job is rendering failure was the one layer that had to catch, and it made a
  business-rule violation and a dropped socket arrive the same way. Returning `Result` there closes
  the round trip: the category the domain produced is the category the page branches on.
- **Ranking in Shared rather than at each edge is what makes "the same aggregate" mean something.**
  A ranking table copied into two presentation packages is two tables, and the gRPC edge proved it
  by classifying by position while HTTP classified by severity. One table in the layer both edges
  already reference removes the possibility rather than the habit.

## Trade-offs
- More ceremony at call sites than letting an exception bubble; the combinators absorb most of it.
- Two error channels coexist (Result for expected, exceptions for exceptional). The boundary is a
  judgment call: "could a well-behaved caller reasonably trigger this?" then return a `Result`,
  otherwise throw.
- One status still has to stand for a whole list. Severity ranking removes the ordering dependency
  but not the collapse: a failure carrying a 403 and a 400 answers 403, and the 400 is visible only
  to a client that reads the `errors` array (`ErrorHttpMapping.cs:61-69`). The three 400-mapped
  categories share one rank (`ErrorTypeSeverity.cs:45-47`), so among them the earliest error still
  wins.
- **The reverse mapping is lossy on 400, and only on 400.** A client reading an MMCA error array
  gets the original `ErrorType` verbatim, because the edge writes `Type` as a field
  (`ErrorHttpMapping.cs:61-69`) and the reader parses it back (`ProblemDetailsResultReader.cs:346`,
  `:403-408`). Every other payload shape (a validation dictionary, a plain ProblemDetails, a
  non-JSON body) has to derive the category from the status code, and the forward map sends
  `Validation`, `Invariant` **and** `Failure` all to 400, so the reverse can only pick one: it picks
  `Validation` (`:96-106`, admitted twice at `:50-56` and `:121-124`, pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Http/ProblemDetailsResultReaderTests.cs:228`).
  A client that needs `Invariant` distinguished from `Validation` must call an endpoint that emits
  the error array, which every `ApiControllerBase` failure does but an escaped exception handled by
  the handler chain does not.
- **The UI's Result surface is a breaking change for every consumer page.** Retiring the deviation
  moved `MMCA.Common.UI`'s public API by 41 removals and 98 additions in one release, so every page
  that wrapped a service call in `try`/`catch` had to be rewritten to branch. That is the cost of
  having deferred the conversion: the deviation was cheap to keep and expensive to remove, and it
  grew with every page added while it stood.
- **An exception reaching a page still costs it the reason.** Where a failed `Result` carries a
  localized message the page can render, an exception that escapes a consumer-supplied fetcher falls
  back to a generic resource string, because its own text is neither translatable nor safe to render
  (`MobileInfiniteScrollList.razor.cs:248-268`, the fallback at `:266`). Returning `Result` is what
  makes the specific message available at all; nothing forces a call site to produce one.
- The exception-handler registration order is load-bearing. Because ASP.NET Core stops at the first
  handler that reports the exception handled, a mis-ordered registration (for example the catch-all
  `GlobalExceptionHandler` ahead of a specific handler) would swallow the more precise status;
  `GlobalExceptionHandler` must stay registered last
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:140-144`).

## Related
[ADR-007](007-grpc-extraction.md) (Result over the wire via gRPC, the second edge the shared severity
ranking now serves),
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator pipeline returns `Result.Failure` to
short-circuit a command before it reaches the handler),
[ADR-094](094-client-entity-data-access.md) (the client base hierarchy whose dispatch method now ends
in a `Result` instead of a rethrow, and which owns the retry and idempotency behavior around it),
[ADR-027](027-multi-locale-i18n.md) (the localization contract the page-side helpers honor: an API
message arrives already translated, a client-side one is a resource key, and pass-through lookup
serves both from one call site).
