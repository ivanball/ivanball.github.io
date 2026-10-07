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
Revised 2026-10-01: citations re-anchored after line shifts; no decision changed.
Revised 2026-10-06: `ErrorType.TooManyRequests` (HTTP 429, gRPC `ResourceExhausted`, severity rank
45) joins the category set, the catch-all exception handler also answers `BadHttpRequestException`
with the status it carries (413 for an oversize body), and the UI executor counts Polly's `ExecutionRejectedException` as a
transport fault.
Revised 2026-10-07: a client-synthesized failure is localized by its code through the caller's
localizer and, when the caller passes one, then the framework's own `SharedResource` pair before
falling back to English, and the error-catalog rule's own summary now states that it does not read
`Error.TooManyRequests`; anchors refreshed after the v1.232.1 release.

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
  `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`, `Unexpected`, `TooManyRequests`. The
  domain never names an HTTP status. `Unexpected` is the one category reserved for a genuine
  server-side fault (the request was well formed and permitted, the server could not complete it,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:36-41`): it maps to HTTP 500
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:30`) and to gRPC
  `Internal` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:48`), and it
  is explicitly not for business-rule violations, which is what keeps the other nine categories
  caller-side (`ErrorType.cs:38-39`, factory at `.../Shared/Abstractions/Error.cs:126-127`).
  `TooManyRequests` is the temporary refusal (a login or password-change lockout): it maps to HTTP
  429 (`ErrorHttpMapping.cs:31`) and gRPC `ResourceExhausted` (`ResultGrpcExtensions.cs:49`), and
  the caller fixes it by retrying later rather than by changing the request (`ErrorType.cs:43-48`,
  factory at `Error.cs:103-104`). It is appended last so the numeric values of the earlier members
  do not move.
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
    (`.../Shared/Abstractions/ResultExtensions.cs:14`) carries `BindAsync` over both a `Task`-returning
    and a synchronous binder (`:24-33`, `:43-52`), `MapAsync` (`:62-71`), `TapAsync` (`:81-95`) and
    `MatchAsync` (`:106-117`), so an asynchronous pipeline composes end to end without an intermediate
    `await` and its temporary local between every step. Each awaits the incoming task once and
    applies the same short-circuit rule as the instance combinators: `BindAsync` and
    `MapAsync` delegate to them, `TapAsync` runs its asynchronous action inline only on success
    (`:89-92`), and `MatchAsync` hands the awaited result to the synchronous `Match` (`:115-116`).
  - Every combinator short-circuits: a failed result never invokes the delegate it was handed
    (`Result.cs:279`, `:292`, `:305`, `:339-342`).
- The transport mapping lives only at the edge. `ApiControllerBase.HandleFailure()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35-61`) maps an
  `ErrorType` to an HTTP status through a `FrozenDictionary` (`ErrorHttpMapping.cs:20-32`, resolved at
  `ApiControllerBase.cs:48`) and returns an RFC 9457 ProblemDetails body carrying **all** errors
  (`:50-58`, projection at `ErrorHttpMapping.cs:62-70`). gRPC does the equivalent over the wire
  (`GrpcResultExceptionInterceptor`, ADR-007) from a mirrored table (`Validation`/`Invariant`/`Failure`
  to `InvalidArgument`, `NotFound` to `NotFound`, `Conflict` to `Aborted`, `Unauthorized` to
  `Unauthenticated`, `Forbidden` to `PermissionDenied`, `UnprocessableEntity` to `FailedPrecondition`,
  `Unexpected` to `Internal`, `TooManyRequests` to `ResourceExhausted`:
  `ResultGrpcExtensions.cs:37-50`), so callers keep programming against `Result<T>` across a process
  boundary.
- **A failure carrying several errors takes the status of the most severe one, never of the first,
  and both edges rank it the same way.** `Result.Combine` aggregates errors in evaluation order
  (`Result.cs:124-145`), so a positional rule let an incidental validation failure downgrade a real
  403 or 500 to a 400. The ranking is one table in the Shared layer,
  `ErrorTypeSeverity` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:31`),
  most to least severe: `Unexpected` (70) > `Unauthorized` (60) > `Forbidden` (50) >
  `TooManyRequests` (45) > `Conflict` (40) > `NotFound` (30) > `UnprocessableEntity` (20) >
  `Invariant` / `Validation` / `Failure` (one shared rank of 10, `:38-50`), with the reasoning for
  each rank written onto the type itself (`:16-26`; a lockout outranks a conflict because the caller
  is refused whatever the request says, `:21`). `MostSevere` keeps the earliest error on a tie
  (`:71-98`, strict `>` at `:90`) and an unmapped category ranks lowest, so a category added to
  `ErrorType` without a rank can never silently outrank a real 403 or 500 (`:59`, stated at
  `:52-56`). The scan is index-based rather than a LINQ `MaxBy` because it runs on every failure
  response (`:85-86`).

  **It lives in Shared rather than in one presentation package because two edges consume it.** HTTP
  resolves the status from `ErrorTypeSeverity.MostSevere`
  (`.../MMCA.Common.API/Middleware/ErrorHttpMapping.cs:51-52`, called from
  `ApiControllerBase.HandleFailure` at `ApiControllerBase.cs:48`) and gRPC's `ToRpcException` does
  the same (`.../MMCA.Common.Grpc/ResultGrpcExtensions.cs:123-125`, argued at `:103-117`). Only the
  *status* is ranked: every error still travels in the ProblemDetails `errors` array
  (`ErrorHttpMapping.cs:62-70`) and in the gRPC trailers as `error-{i}-code` / `-message` / `-type`
  (`ResultGrpcExtensions.cs:135-137`). Ranking in one place is what makes the two transports agree;
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:149-161`, registrations at
  lines 154-158):
  - `OperationCanceledExceptionHandler` (registered first) maps a client-disconnect
    `OperationCanceledException` to the non-standard HTTP 499 Client Closed Request, so monitoring can
    tell an abandoned request apart from a server fault
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:29-30,37`).
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
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:100-113`,
    status set at `:102`). It maps two exceptions by type before that fallback, both caller faults
    rather than server faults and both logged at warning rather than error. A
    `CrossTenantWriteException` (the save-time tenant-boundary rejection,
    `.../MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24`) is
    answered with HTTP 400, because a tenant-scoped API refusing an untenanted write is routine
    (`:54-72`, the warning at `:58`, the 400 at `:60`). The special case sits inside the catch-all
    rather than in its own handler because the exception derives from `InvalidOperationException`,
    so no handler ahead of this one claims it, and every other save-time invariant failure of that
    family still ends at the 500 (`:14-19`). The response body names no tenant id and no entity
    type: echoing either would tell an unauthorized caller which tenant owns the row it just tried
    to write, so the detail is a fixed string and the full failure stays in the log (`:38-46`). A
    `BadHttpRequestException` (a body over the endpoint's request size limit, or an unreadable
    request) is answered with the status the exception itself carries, passed through unchanged
    (`:82`, `:89`): a 413 gets a "Payload Too Large" title and detail, and any other status (400 for
    an unreadable request, or another client status Kestrel assigns) gets the fixed "Bad Request"
    pair (`:74-98`, the title and detail at `:90-95`).

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
  `Result` (`:253`) and `ReadAsync<T>(response, options, ct)` deserializes a 2xx body or parses the
  failure (`:288`), with the pure `ParseProblemDetails(status, body)` core testable against captured
  payloads (`:155`). It understands four payload shapes (`:20-49`): the **MMCA error array**, where
  `code`, `message`, `type`, `source` and `target` all round-trip and `type` parses straight back
  into `ErrorType` (`:350-385`, the type read at `:377`, the parse at `:434-439`); the ASP.NET Core
  **validation dictionary**, which yields one error per message coded `Validation.{property}` (or
  `Validation` for an empty key) with the category taken from the status (`:387-432`, the code at
  `:394-396`); **plain ProblemDetails** with no `errors` extension; and a **non-JSON or empty
  body**. Each of the last two synthesizes one error coded `Http.{status}` (`:157-178`, `:203`,
  built at `:441-445`, the code at `:502-503`). Property lookup is case-insensitive on purpose,
  because a hand-built PascalCase payload would otherwise silently lose every field (`:469-500`). It lives in `MMCA.Common.Shared` and uses nothing beyond
  the BCL, because the consumer is `MMCA.Common.UI`, which references Shared only (`:14-19`).
- **`HttpResultExecutor` converts the absence of one.**
  (`.../MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:35`.) It does not make the request: it takes
  the caller's whole send-and-read operation as a `Func<Task<Result>>` / `Func<Task<Result<T>>>` and
  wraps it (`:56`, `:91`), so the two halves compose without either knowing the other's shape. A
  refused connection, a DNS failure, a dropped socket, an unreadable body (`HttpRequestException`,
  `IOException`, `JsonException`), or a call the client's resilience pipeline refused to run or
  finish (Polly's `ExecutionRejectedException`, the base of `TimeoutRejectedException` and
  `BrokenCircuitException`) becomes a failed `Result` coded `Http.TransportFailure` (the fault set at
  `:118-128`, caught at `:77`, `:112`, built at `:130-133`, code at `:38`). An `HttpClient` timeout,
  which surfaces as an `OperationCanceledException` with the caller's token not cancelled, becomes
  `Http.Timeout` (`:135-136`, code at `:41`); a timeout raised by a Polly strategy instead arrives as
  a `TimeoutRejectedException` and is classed with the transport faults. Both are built as
  `Error.Unexpected` (`:133`, `:136`). Anything else is a genuine programming fault and keeps
  travelling as an exception (`:124-125`). The exception's own text goes on `Error.Source`, never on
  `Message`, because it is diagnostic detail that is neither localizable nor safe to render
  (`:130-133`).

**`OperationCanceledException` is the one exception that still crosses the boundary, and that is the
decision, not an omission.** When the caller's own token is why the operation stopped, the
cancellation is rethrown (`HttpResultExecutor.cs:69-72`, `:104-107`, argued at `:18-24`): a disposed
component or a superseded grid fetch owns its own cancellation and must not have it handed back as
an error to render. A client timeout raises the same exception type with the token *not* cancelled,
and that one does become a failure (`:73-76`, `:108-111`). The token is also checked before the
call, so an already-abandoned request never reaches the network (`:63`, `:98`).

**Pages branch; they do not catch.** `ResultUiExtensions`
(`.../MMCA.Common.UI/Common/ResultUiExtensions.cs:74`) is the page-side idiom, written once so no
page hand-rolls it: `TryGetValue` unwraps inside a conditional the way `Dictionary.TryGetValue`
does, deciding the failing branch on `IsFailure` rather than on the value so a value-type default is
not mistaken for success (`:103-118`, the check at `:110-114`, the overload handing the errors back
at `:137`); `OnFailureSetError` pushes the composed message into a page field (`:248`, `:260`) and
`NotifyOnFailure` raises it as exactly one snackbar, never one per error (`:289`, `:310`); and
`HasErrorType` with `IsNotFound` / `IsUnauthorized` lets a page turn a 404 into an empty state and
a 401 into a redirect instead of an alert (`:328-332`, `:340`, `:348`). Messages are localized as
resource keys **with pass-through**, so one call site handles both an API error the server already
translated and a client-side error whose `Message` is a key (`:23-27`, `Localize` at `:407-416`,
ADR-027). The failures the client synthesized itself have no server-phrased message to pass
through, so they are looked up by their error code instead: a bodiless `Http.{status}` (recognized
through `ProblemDetailsResultReader.TryGetSynthesizedStatus`, `:360`), then the generic
`Http.Status` format, plus `Http.TransportFailure` and `Http.Timeout` (`:27-33`, `LocalizeError` at
`:350-373`). Each code resolves through the localizer the page passed and then, when that
localizer has no such key, through the framework's own `SharedResource` pair for the current UI
culture, so a page passing its own `IStringLocalizer<PageType>` still shows the translated sentence;
the English message is the last resort (`:30-33`, the two-step lookup at `:377-383` and `:386-397`).
The lookup runs only when a localizer is passed: `OnFailureSetError` and `NotifyOnFailure` default
it to null (`:248`, `:260`, `:292`, `:313`), and with none `LocalizeError` returns the raw English
message without consulting `SharedResource` (`:352-355`).
A transport or timeout code is replaced only while it still carries the executor's own English
sentence, so a caller that reused the code with a message of its own keeps that message
(`:398-405`). The messages are deduplicated and ordered by the same `ErrorTypeSeverity` rank the
edges use, so a real 403 leads and an incidental validation message never buries it (`:166-180`,
the ordering at `:176`, the deduplication at `:179`). The shared `ErrorSummary` component
renders the same list as one deduplicating `MudAlert`, taking a failed `Result` and the
`MudForm.Errors` shape together and rendering nothing at all when there is nothing to say
(`.../MMCA.Common.UI/Components/Forms/ErrorSummary.razor:8`, both shapes merged at `:87-105`, one message
inline and several as a list so a screen reader announces them as several items, `:17-31`).

**A component that shows a retry needs the failure, not an exception.**
`MobileInfiniteScrollList` takes one page fetcher, `FetchPageResult`, a required delegate returning
`Task<Result<(IReadOnlyList<TItem> Items, int TotalItems)>>`
(`.../MMCA.Common.UI/Components/Lists/MobileInfiniteScrollList.razor.cs:37`), and renders the failure's
localized message beside its inline retry affordance (`:204-210` into `SetLoadFailed` at `:208`, the
message read from the failed `Result` at `:304`). A tuple-returning delegate is not offered beside it: a tuple has no way to carry
a failure at all, so the component would be left showing a Retry button that cannot name what it is
retrying. The delegate is checked at initialization, so a call site that omits it throws instead of
rendering as a load failure that can never succeed (`:97-109`).

### The error `Code` is a public vocabulary, gated for uniqueness (2026-09-03)

`Code` is the half of a failure that crosses the wire verbatim (`ErrorHttpMapping.cs:62-70`) and the
key ADR-027 localizes the message by, so a client switches on `Order.NotFound` and a support ticket
quotes it. Two modules that both ship `Item.Invalid` make that vocabulary ambiguous, and the
ambiguity only surfaces in production
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.ErrorCatalog.cs:33-39`).
The catalog is therefore frozen the way ADR-010 froze integration-event schemas and ADR-015 Section B
froze the `.proto` contracts. A Mono.Cecil IL scan reads the `Error` factory call sites it
recognizes (`:171`, `:207-208`, the recognized members at `:19-31` and `:219-224`) across a repo's
per-module Domain and Application assemblies only (`:185-191`). The recognized set does not
include `Error.TooManyRequests` (`Error.cs:103`), so a call to that factory is neither checked nor
reported as UNVERIFIABLE, and the list's own summary states that gap (`:11-15`);
`ErrorCodesAreUnique` (`:64`) fails the build when one literal code is constructed by more than one
declaring type (`:75`), and `ErrorCodesUseAnAllowedPrefix` (`:104`) requires the owning prefix. A
code built at run time is reported as UNVERIFIABLE rather than passed or failed (`:212-215`,
`:149-157`). Consumers subclass
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
  the one thing `Result.Combine` makes arbitrary (`ErrorHttpMapping.cs:41-50`, restated on the enum
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
  to a client that reads the `errors` array (`ErrorHttpMapping.cs:62-70`). The three 400-mapped
  categories share one rank (`ErrorTypeSeverity.cs:47-49`), so among them the earliest error still
  wins.
- **The reverse mapping is lossy on 400, and only on 400.** A client reading an MMCA error array
  gets the original `ErrorType` verbatim, because the edge writes `Type` as a field
  (`ErrorHttpMapping.cs:62-70`) and the reader parses it back (`ProblemDetailsResultReader.cs:377`,
  `:434-439`). Every other payload shape (a validation dictionary, a plain ProblemDetails, a
  non-JSON body) has to derive the category from the status code, and the forward map sends
  `Validation`, `Invariant` **and** `Failure` all to 400, so the reverse can only pick one: it picks
  `Validation` (`:96-107`, which also maps 429 back to `TooManyRequests` at `:105`; admitted twice
  at `:50-56` and `:123-126`, pinned by
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
  (`MobileInfiniteScrollList.razor.cs:226-234`, `SetLoadFailed(failure: null)` at `:233`, the
  fallback stated at `:296-300`, `SetLoadFailed` itself at `:301-305`). Returning `Result` is what
  makes the specific message available at all; nothing forces a call site to produce one.
- The exception-handler registration order is load-bearing. Because ASP.NET Core stops at the first
  handler that reports the exception handled, a mis-ordered registration (for example the catch-all
  `GlobalExceptionHandler` ahead of a specific handler) would swallow the more precise status;
  `GlobalExceptionHandler` must stay registered last
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:154-158`).

## Revision (2026-10-01)
No decision or rationale changed. Citations were re-anchored to the current source after line
shifts: the gRPC status table, `ToRpcException` ranking and trailer writes in
`ResultGrpcExtensions.cs` (`:36-48`, `:121-123`, `:133-135`); `AddCommonExceptionHandlers`
(`DependencyInjection.cs:149-161`, registrations `:154-158`) and the 499 handler
(`OperationCanceledExceptionHandler.cs:29-30,37`); the `ProblemDetailsResultReader` members; the
`ResultUiExtensions` page helpers; the `ErrorSummary` merge and list rendering; and
`MobileInfiniteScrollList`, whose failure path now runs through `SetLoadFailed`
(`MobileInfiniteScrollList.razor.cs:278-282`).

## Revision (2026-10-06)
The decision is unchanged; additive behavior that had shipped without being recorded is now
described:
- `ErrorType` has ten categories: `TooManyRequests` (a lockout) maps to HTTP 429
  (`ErrorHttpMapping.cs:31`), gRPC `ResourceExhausted` (`ResultGrpcExtensions.cs:49`), severity rank
  45 between `Forbidden` and `Conflict` (`ErrorTypeSeverity.cs:43`), and back from 429 in the reader
  (`ProblemDetailsResultReader.cs:105`).
- `GlobalExceptionHandler` maps two exceptions by type, not one: `BadHttpRequestException` is
  answered with the status it carries, at warning level, titled "Payload Too Large" for a 413 and
  "Bad Request" for any other status (`GlobalExceptionHandler.cs:72-95`, the status at `:79`, `:86`).
- `HttpResultExecutor` also treats Polly's `ExecutionRejectedException` as a transport fault
  (`HttpResultExecutor.cs:125-126`), so a resilience-pipeline timeout reads as
  `Http.TransportFailure`; only an `HttpClient` timeout reads as `Http.Timeout`.
- Corrected: the validation dictionary yields `Validation.{property}` codes, one per message.
  `Http.{status}` is the fallback code wherever no code is supplied: a plain ProblemDetails, a
  non-JSON or non-object body, an `errors` extension that parses to nothing (`ProblemDetailsResultReader.cs:178`, `:197-203`),
  and an MMCA array entry that is a bare string or an object with no `code` (`:366`, `:380`).
- Added: client-synthesized failures are localized by error code (`ResultUiExtensions.cs:339-365`).
- Corrected: `TapAsync` and `MatchAsync` do not delegate to the instance combinator of the same
  name, though they short-circuit identically (`ResultExtensions.cs:84-90`, `:111-112`).
- Noted: the error-catalog IL scan does not recognize `Error.TooManyRequests`
  (`ArchitectureRules.ErrorCatalog.cs:17-29`).
- All live-section anchors were re-verified against current source. The 2026-10-01 anchors for the
  gRPC table and trailers now read `ResultGrpcExtensions.cs:37-50`, `:123-125`, `:135-137`, and the
  `SetLoadFailed` failure path `MobileInfiniteScrollList.razor.cs:301-305`.

## Revision (2026-10-07)
Re-verified against current source. The decision, the combinator surface, the ten categories, the
severity ranking, the exception-handler chain and the executor's fault classification are unchanged;
one behavior was added, one description moved, and most anchors into six files shifted with the
v1.232.1 release (`HttpResultExecutor.cs:18-24` and `ErrorSummary.razor:8` / `:17-31` did not move).
1. Added: a client-synthesized failure (`Http.{status}`, `Http.Status`, `Http.TransportFailure`,
   `Http.Timeout`) resolves through the page's localizer and then through the framework's own
   `SharedResource` pair for the current UI culture, with the English message only as the last resort,
   and a transport or timeout code is replaced only while it still carries the executor's own English
   sentence (`ResultUiExtensions.cs:30-33`, `:377-383`, `:386-397`, `:398-405`). The lookup runs
   only when a localizer is passed; with none, `LocalizeError` returns the English message unchanged
   (`:352-355`, the null defaults at `:248`, `:260`, `:292`, `:313`).
2. Corrected: the error-catalog rule's summary states that its recognized list omits
   `Error.TooManyRequests` (`ArchitectureRules.ErrorCatalog.cs:11-15`); the gap itself is unchanged
   (`:19-31`, `Error.cs:103`).
3. Anchors re-verified against current source: `ResultExtensions.cs:14`, `:24-33`, `:43-52`,
   `:62-71`, `:81-95`, `:89-92`, `:106-117`, `:115-116`; `GlobalExceptionHandler.cs:14-19`,
   `:38-46`, `:54-72` (`:58`, `:60`), `:74-98` (`:82`, `:89`, `:90-95`), `:100-113` (`:102`);
   `HttpResultExecutor.cs:35`, `:38`, `:41`, `:56`, `:63`, `:69-72`, `:73-76`, `:77`, `:91`, `:98`,
   `:104-107`, `:108-111`, `:112`, `:118-128` (the fault set, with `ExecutionRejectedException` at
   `:128`), `:124-125`, `:130-133`, `:135-136`; `ResultUiExtensions.cs:23-27`, `:74`, `:103-118`,
   `:110-114`, `:137`, `:166-180`, `:248`, `:260`, `:289`, `:310`, `:328-332`, `:340`, `:348`,
   `:350-373`, `:407-416`; `ErrorSummary.razor:87-105`; `ArchitectureRules.ErrorCatalog.cs:33-39`,
   `:64`, `:75`, `:104`, `:149-157`, `:171`, `:185-191`, `:207-208`, `:212-215`, `:219-224`. The 2026-10-06 entry
   above keeps its anchors as written; its `ResultExtensions.cs:84-90` / `:111-112`,
   `GlobalExceptionHandler.cs:72-95` / `:79` / `:86`, `HttpResultExecutor.cs:125-126`,
   `ResultUiExtensions.cs:339-365` and `ArchitectureRules.ErrorCatalog.cs:17-29` now read
   `:89-92` / `:115-116`, `:74-98` / `:82` / `:89`, `:127-128`, `:350-373` and `:19-31`. Spot
   checks found `ErrorHttpMapping.cs:30-31`, `ResultGrpcExtensions.cs:48-49`,
   `ErrorTypeSeverity.cs:43`, `Error.cs:103` and `:126-127`, and
   `MobileInfiniteScrollList.razor.cs:301-305` still correct.

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
