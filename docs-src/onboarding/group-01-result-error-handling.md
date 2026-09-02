# 1. Result & Error Handling

**What this group covers.** This is the first capability chapter, and it is deliberately first because
the pattern it teaches underpins almost every other one in the guide. Before you read a command
handler, a domain factory, a controller action, or a gRPC call in any later chapter, you need the
**Result pattern** in your head: in this codebase an operation that can fail in an *expected* way does
not throw, it **returns** a value that is either a success or a structured failure. The sixteen types
here are that value ([`Result`](#result) and its combinator surface, extended over pending tasks by
[`ResultExtensions`](#resultextensions)), the error it carries ([`Error`](#error)), the classification
that drives HTTP and gRPC status codes ([`ErrorType`](#errortype) plus the
[`ErrorTypeSeverity`](#errortypeseverity) ranking that picks *which* error speaks for a multi-error
failure), the JSON machinery that lets a result survive a Redis round trip
([`ResultJsonConverterFactory`](#resultjsonconverterfactory), [`ResultConverter`](#resultconverter),
[`PropertyReader`](#propertyreader)), the two narrow exception types reserved for the cases where
returning a value is structurally impossible ([`DomainException`](#domainexception),
[`DomainInvariantViolationException`](#domaininvariantviolationexception)), and the collection
envelopes that successful reads come back in, offset
([`CollectionResult<T>`](#collectionresultt), [`PagedCollectionResult<T>`](#pagedcollectionresultt),
[`PaginationMetadata`](#paginationmetadata)) and keyset
([`KeysetPageRequest`](#keysetpagerequest), [`KeysetCollectionResult<T>`](#keysetcollectionresultt),
[`KeysetCursor`](#keysetcursor)). The primer introduces the idea in
[§2](00-primer.md#2-architectural-styles-this-codebase-commits-to); this chapter is where it becomes
concrete. The governing decision is
[ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html): expected failures are
transport-agnostic values, only the edge maps them to HTTP or gRPC, and exceptions stay for the
genuinely exceptional.

Every type in this chapter lives in `MMCA.Common.Shared`, the innermost layer, which is why the Blazor
WebAssembly client can reference the exact same `Result`, `Error` and `PagedCollectionResult<T>` the
SQL Server repository produced, with no EF Core or ASP.NET dragged along. That placement is
[Rubric §3, Clean Architecture] in miniature: an HTTP-shaped concept (`ErrorType`) is modelled as a
pure enum in the core, and the translation to a status code is deferred to the presentation layer.

## Why a return value instead of an exception

Exceptions are expensive (stack capture and unwinding), they are invisible in a method's signature,
and they conflate *programmer errors* with *business outcomes*. "This order ID does not exist" and
"this email is already taken" are not exceptional, they are routine, expected branches of normal
control flow. Modelling them as data lets the compiler see them (a method that returns `Result<T>`
advertises that it can fail), lets them be collected into a list, passed through a pipeline,
inspected, and mapped to a response without any `try`/`catch`. That decision is the single most
pervasive idiom in the two repos: practically every entity factory method, every CQRS command and
query handler, every controller action, and every client service method returns [`Result`](#result) or
`Result<T>`. This touches [Rubric §2, Design Patterns] (which assesses whether patterns are idiomatic
and solve real problems rather than being "pattern theater", and here Result is the genuine,
codebase-wide error-flow mechanism) and [Rubric §9, API & Contract Design] (which assesses consistent,
standardized error responses, because every failure flows through the same envelope, so every endpoint
produces the same error shape).

## Three pieces: classification, carrier, envelope

[`ErrorType`](#errortype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:10`) is the **classification
axis**, a nine-member enum whose per-member doc comments name the HTTP status each maps to:
`Validation`, `Invariant` and `Failure` to 400, `NotFound` to 404, `Conflict` to 409, `Unauthorized`
to 401, `Forbidden` to 403, `UnprocessableEntity` to 422 (`ErrorType.cs:12-34`), and `Unexpected` to
500 (`ErrorType.cs:36-41`). That last member is the one to internalize: it is reserved for a genuine
server-side fault, a request that was well-formed and permitted but that the server could not
complete, and its doc comment is explicit that it must never be used for a business-rule violation
(`ErrorType.cs:37-39`).

[`Error`](#error) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:15`) is the
**carrier**, an immutable positional `record` (`Error.cs:15-20`) with a machine-readable `Code` (for
example `"Order.NotFound"`, used for programmatic branching and, per
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), as the localization key), a
human-readable `Message`, an `ErrorType`, and optional `Source` / `Target` context. Nine factory
methods, one per `ErrorType` (`Error.cs:37-115`), each hard-code the correct classification, so a
caller can never accidentally pair `Error.NotFoundError(...)` with the wrong type. Three pre-built
static singletons (`Error.NotFound`, `Error.AlreadyDeleted`, `Error.InvalidEntityField`,
`Error.cs:23-29`) cover the ubiquitous cases without re-allocating, and `WithSource` / `WithTarget`
(`Error.cs:120`, `Error.cs:126`) enrich an error through `with`-expression copies.

[`Result`](#result) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:19`) is the
**outcome envelope**, either a success (no errors) or a failure carrying one or more `Error`s. The
sealed generic `Result<T>` (same file, `Result.cs:204`) adds a `Value` on the success path
(`Result.cs:207`) and the functional combinators that make the pattern ergonomic.

## The railway, in one picture

"Railway-oriented programming" is the mental model: imagine two parallel tracks, a success track and a
failure track. An operation that takes the current result as input is skipped if the result is already
a failure (the train stays on the failure track), and runs only if it is a success, where it may stay
on the success track or switch to failure. Control flows forward without nested
`if (result.IsFailure)` checks.

On `Result<T>` the surface is seven members. `Match(onSuccess, onFailure)` (`Result.cs:260`)
terminates the railway by collapsing both tracks to a single value, with `MatchAsync`
(`Result.cs:355`) as its awaiting twin. `Map(mapper)` (`Result.cs:276`) transforms the success value
while propagating errors untouched. `Bind(binder)` (`Result.cs:302`) and `BindAsync(binder)`
(`Result.cs:289`) are the **monadic bind**, synchronous and asynchronous: they short-circuit on
failure, returning the original errors without invoking `binder`, and otherwise hand the success value
to the next result-returning operation. `Tap(action)` (`Result.cs:314`) runs a side effect on the
success value and returns the same instance so the call can sit inline in a chain, and
`Ensure(predicate, error)` (`Result.cs:334`) fails an otherwise-successful chain when the value does
not satisfy a condition, without ever running the predicate on an already-failed result
(`Result.cs:339-344`).

The non-generic base carries the valueless equivalents: `Match` (`Result.cs:155`), `Bind`
(`Result.cs:187`), and `OnFailure(action)` (`Result.cs:169`), which runs a side effect on the error
list and passes the instance through. It also owns `Combine(params ReadOnlySpan<Result> results)`
(`Result.cs:124`), the **aggregate-all-failures** combinator that runs several invariant checks and
returns *all* their errors at once rather than failing on the first. That is the workhorse of domain
factory methods (`Result.Combine(CheckName(name), CheckDate(date), ...)`), its `ReadOnlySpan`
parameter avoids a heap allocation in the common case, it allocates the aggregated error list only
when something actually failed (`Result.cs:131-140`), and it rejects an empty call outright
(`Result.cs:126-129`) because combining nothing has no defensible answer.

Three implicit conversions remove the remaining ceremony: an `Error` lifts into a failed `Result`
(`Result.cs:43`, with the named alternate `FromError` at `Result.cs:49` for callers that prefer it) or
into a failed `Result<T>` (`Result.cs:233`), and a bare value lifts into a successful `Result<T>`
(`Result.cs:249`), so a guard clause writes `return someError;` and a happy path writes
`return theValue;`. [`ResultExtensions`](#resultextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ResultExtensions.cs:10`) then carries the
same combinators over a **pending** `Task<Result<T>>` so an asynchronous pipeline composes end to end
without an `await` and a temporary local between every step: two `BindAsync` overloads for async and
sync binders (`ResultExtensions.cs:20`, `ResultExtensions.cs:39`), `MapAsync`
(`ResultExtensions.cs:58`), `TapAsync` (`ResultExtensions.cs:77`), and `MatchAsync`
(`ResultExtensions.cs:102`). Each awaits the incoming task exactly once and then delegates to the
instance combinator, so the short-circuit behavior is identical by construction rather than by
duplication, which is the [Rubric §16, Maintainability] argument for the helper existing at all.

## Construction discipline, and the invariant it buys

You cannot `new` a `Result<T>` directly: its constructors are `internal` (`Result.cs:211`,
`Result.cs:217`), so the only way to produce one is through the static factory methods on the base
[`Result`](#result) class (`Success` / `Failure`, `Result.cs:62-102`). That is what guarantees the
invariant the rest of the codebase relies on: a result is *always* either a clean success or a
non-empty failure, never a half-built object. Two details make it airtight. First, the success path is
served by a single cached immutable instance (`Result.cs:21`, `Result.cs:62`) and the error list is
allocated lazily (`Result.cs:26`, `Result.cs:29`), so the overwhelmingly common success case allocates
nothing. Second, `ThrowIfNoErrors` (`Result.cs:107-115`) throws `ArgumentException` when a failure
factory is handed an empty collection, because `IsSuccess` is derived from the error count
(`Result.cs:32`) and an accidentally-empty collection would otherwise turn an explicit `Failure(...)`
call into a *success*. Both the non-generic `Failure` (`Result.cs:83-89`) and the generic failure
constructor (`Result.cs:217-221`) route through that guard. Likewise, [`Error`](#error)'s factory
methods are the canonical construction path because they fix the code-to-classification pairing at the
call site. This is quiet [Rubric §15, Best Practices & Code Quality] work: the type system and the
factories, not documentation, keep the envelope well-formed.

## Severity, not position, classifies a failure

`Result.Combine` aggregates errors in **evaluation order**, so if a transport picked the first error to
classify the whole failure, an incidental validation failure evaluated early could downgrade a real
403 or 500 into a 400. [`ErrorTypeSeverity`](#errortypeseverity)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:30`) is the answer: one
ranking over `ErrorType`, held in a `FrozenDictionary` because the table is fixed at startup and read
on every failure path (`ErrorTypeSeverity.cs:37-48`). The ranks are `Unexpected` 70, `Unauthorized`
60, `Forbidden` 50, `Conflict` 40, `NotFound` 30, `UnprocessableEntity` 20, and `Invariant`,
`Validation` and `Failure` all 10 (`ErrorTypeSeverity.cs:39-47`). `Rank` returns zero for an unmapped
type (`ErrorTypeSeverity.cs:57`), so a category added to `ErrorType` without a rank here can never
silently outrank a real 403 or 500. `MostSevere(errors)` (`ErrorTypeSeverity.cs:69`) then picks the
representative error with a deliberately index-based loop that keeps the earliest error on a tie
(`ErrorTypeSeverity.cs:80-95`), the comment at `ErrorTypeSeverity.cs:83-84` explaining that a LINQ
`MaxBy` would allocate an enumerator and a comparer closure on a path that runs for every failure
response.

The point of hoisting this into `MMCA.Common.Shared` rather than into one presentation package is that
**both** edges classify the same aggregate identically: the HTTP side calls it from
`ErrorHttpMapping.GetStatusCode(IReadOnlyList<Error>)`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:50-51`) and the gRPC
side from `ToRpcException`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:117`). Every error still
travels in the payload; ranking selects the status only. This is the 2026-08-26 and 2026-08-27
revision of [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html), and it is
[Rubric §9, API & Contract Design] in the small: the meaning of a failure must not depend on the order
in which its causes happened to be evaluated.

## Making a result survive a round trip

The construction discipline above creates a problem the moment a result must be *serialized*: because
`Result<T>`'s constructors are `internal` and its properties are get-only, System.Text.Json's default
reflection-based deserializer cannot rehydrate one. That matters because the CQRS query-caching
decorator
[`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult)
writes whole handler results through `ICacheService`, skipping only failures
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:115,119`),
and those results are `Result<...>` values (see [Chapter 5](group-05-cqrs-pipeline.md) and
[Chapter 9](group-09-caching.md)).

[`ResultJsonConverterFactory`](#resultjsonconverterfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15`) is the
fix: a `JsonConverterFactory` attached to both `Result` and `Result<T>` via `[JsonConverter(...)]`
(`Result.cs:18`, `Result.cs:203`) whose `CanConvert` matches the non-generic `Result` and any closed
`Result<T>` (`ResultJsonConverterFactory.cs:21-23`) and whose `CreateConverter` hands back the right
per-type converter (`ResultJsonConverterFactory.cs:26-33`). It writes a compact
`{"value": ..., "errors": [...]}` shape and, crucially, rebuilds the object *through the public
factory methods* (`ResultJsonConverterFactory.cs:52`, `ResultJsonConverterFactory.cs:100`), so a
round-tripped result obeys exactly the same success-or-non-empty-failure invariant a freshly built one
does.

[`ResultConverter`](#resultconverter) (`ResultJsonConverterFactory.cs:35`) is the concrete
`JsonConverter<Result>` for the non-generic case, and a private generic `ResultConverter<T>` sibling
(`ResultJsonConverterFactory.cs:63`) handles the typed case. Both lean on one small helper, the
[`PropertyReader`](#propertyreader) delegate (`ResultJsonConverterFactory.cs:118`), a
`ref Utf8JsonReader` callback that the shared `ReadObject` walker
(`ResultJsonConverterFactory.cs:121-144`) invokes once per JSON property, so the value- and
error-reading logic is written once and reused by both converters, and both emit their errors through
one `WriteErrors` (`ResultJsonConverterFactory.cs:146-153`). The typed converter is stricter than the
untyped one on purpose: an object carrying neither `value` nor `errors` is a corrupt or truncated
cache entry, so it throws rather than fabricate a success wrapping `null`
(`ResultJsonConverterFactory.cs:95-98`), while the same empty object is the *legitimate* success form
for the non-generic `Result` (`ResultJsonConverterFactory.cs:37-39,52`). Without this converter the
distributed result cache could not exist, which makes it quiet
[Rubric §12, Performance & Scalability] plumbing.

## How a failure becomes an HTTP response

Follow a typical write through the layers. A domain factory or aggregate method validates its inputs
and returns `Result.Combine(...)`; a command handler in the application layer chains follow-on work
with `Bind` / `BindAsync` / `Map`, so any failure short-circuits the rest of the slice; the controller
receives the `Result<T>` and, on failure, hands the errors to
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)`.HandleFailure`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35`). That method
resolves the status from the **most severe** error present, never from position
(`ApiControllerBase.cs:47-48`), through
[`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping)'s `FrozenDictionary` of all nine
categories (`ErrorHttpMapping.cs:20-31`), then renders an **RFC 9457 Problem Details** body carrying
*all* the errors in an `errors` extension, optionally localized through
[`ErrorLocalizer`](group-12-api-hosting-mapping.md#errorlocalizer) resolved per request
(`ApiControllerBase.cs:50-60`). An empty error list is defended against too: it becomes a 500 rather
than a silent 200 (`ApiControllerBase.cs:39-45`). The mapping table is shared rather than duplicated so
that the controller base and
[`UnhandledResultFailureFilter`](group-12-api-hosting-mapping.md#unhandledresultfailurefilter) cannot
drift (`ErrorHttpMapping.cs:10-12`).

## And how the same failure crosses a service boundary, or reaches the browser

On the gRPC side, [`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions) carries a
*mirror* of that table, `ErrorType` to `Grpc.Core.StatusCode`, in its own `FrozenDictionary`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:35-47`, with `Unexpected`
mapping to `StatusCode.Internal` at `ResultGrpcExtensions.cs:46`), reachable as an extension member
`ToGrpcStatusCode()` (`ResultGrpcExtensions.cs:56`). A service implementation guards with a single
`result.ThrowIfFailure()` (`ResultGrpcExtensions.cs:69`) or takes the value with `UnwrapOrThrow()`
(`ResultGrpcExtensions.cs:86`), both raising a
[`ResultFailureException`](group-13-grpc-contracts.md#resultfailureexception) that the server
interceptor `GrpcResultExceptionInterceptor`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19`)
translates through `ToRpcException` (`ResultGrpcExtensions.cs:112`): the status comes from
`ErrorTypeSeverity.MostSevere` (`ResultGrpcExtensions.cs:116-117`) and every error is still written
into the trailers as `error-{i}-code`, `error-{i}-message` and `error-{i}-type` entries, plus
`-source` / `-target` when present, so the far side can rebuild the list
(`ResultGrpcExtensions.cs:124-140`). See
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
[Chapter 13](group-13-grpc-contracts.md).

The browser gets the same treatment from the other direction. Every HTTP-typed client service in
`MMCA.Common.UI` returns `Result` end to end:
[`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:58`) parses an
RFC 9457 body back into typed errors, and
[`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) converts the *absence* of a
body (connection, DNS, socket, client timeout) into transport errors, so pages branch through
[`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions) rather than catch. One
fidelity limit is worth carrying in your head and is stated in source: the reverse mapping is lossy on
400 alone, because the forward map collapses `Validation`, `Invariant` and `Failure` onto it and the
reader can only pick `Validation` back (`ProblemDetailsResultReader.cs:50-56`), so a client that needs
the distinction must consume an endpoint that emits the MMCA error array. Because all three edges are
driven by the same nine-member enum and the same severity ranking, there is one source of truth for
"what does a not-found look like", which is the [Rubric §9, API & Contract Design] payoff of putting
the classification in the core rather than at each edge.

## The two exceptions, and why they exist anyway

A return-value pattern still needs a fallback for the places where you genuinely cannot return one.
[`DomainException`](#domainexception)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainException.cs:9`) is the abstract base for
domain-layer exceptions, with the three conventional protected constructors (`DomainException.cs:12`,
`DomainException.cs:16`, `DomainException.cs:22`), and
[`DomainInvariantViolationException`](#domaininvariantviolationexception)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9`) is its
one concrete subclass. Their doc comments are emphatic that these are a *last resort*: prefer `Result`
with `Error.Invariant` for normal business-rule violations, and reserve the exception for contexts
where the Result pattern is structurally unavailable, most notably inside aggregate constructors
invoked by **EF Core materialization** (`DomainInvariantViolationException.cs:3-8`), where the call
stack is framework-owned and there is no result channel to return through. When one of these does
escape, the API layer's
[`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler) converts it to the
same Problem Details shape (`DomainException.cs:3-8`), so even the exceptional path lands on a
consistent contract. This is the considered version of [Rubric §2, Design Patterns]: exceptions are for
the truly exceptional (programming errors, corrupted persistent state), not for control flow.

## Offset paging: the read-side envelopes

The read side needs shapes of its own. A query that returns a list wraps it in
[`CollectionResult<T>`](#collectionresultt), a thin `[DataContract]` record
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:92`) whose single
`required Items` property (`PaginationMetadata.cs:110`) is normalized by the constructor from any
`IReadOnlyCollection<T>` into a list, reusing the caller's `List<T>` when it already is one
(`PaginationMetadata.cs:102-106`). When the read is paged,
[`PagedCollectionResult<T>`](#pagedcollectionresultt) (`PaginationMetadata.cs:119`) extends that base
with one extra required property, [`PaginationMetadata`](#paginationmetadata)
(`PaginationMetadata.cs:12`), the server-side paging state (`TotalItemCount`, `PageSize`,
`CurrentPage`) plus computed derivations (`TotalPageCount`, `FirstRowOnPage`, `LastRowOnPage`,
`PaginationMetadata.cs:75-83`) that are excluded from the wire with `[IgnoreDataMember]`.

Two details are worth internalizing. The three core values are validated *twice*, in the constructor
(`PaginationMetadata.cs:22-31`) and again in each `init` accessor (`PaginationMetadata.cs:38-71`),
precisely because object initializers, record `with` expressions, and System.Text.Json all bypass the
constructor (the comment at `PaginationMetadata.cs:33-35` says so). And `[DataMember(Order = ...)]`
fixes a deterministic wire order so `PaginationMetadata` always follows `Items`
(`PaginationMetadata.cs:109`, `PaginationMetadata.cs:138`). These envelopes are not part of the
success/failure machinery themselves, a paged query handler returns `Result<PagedCollectionResult<T>>`,
composing the two ideas, but they belong in this chapter because they are the canonical *shapes* that
successful reads return. They are also genuinely shared contracts: the controller surface declares
`ActionResult<PagedCollectionResult<TEntityDTO>>`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:43`) and the
Blazor client deserializes the very same type in
[`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:73,111`), so there is no
hand-written mirror DTO to drift
([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html),
[ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html)).

## Keyset paging: the same envelope family, a different cost model

Offset paging answers "give me page 37" and costs the database a scan of the 36 pages before it.
[`KeysetPageRequest`](#keysetpagerequest)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs:20`) asks the other
question, "give me what comes after this row", which costs one index seek regardless of depth, at the
price of losing random page access and a total count (the type's own doc comment lays this out at
`KeysetPagination.cs:11-17`). The request carries a page size clamped into `[1, MaxPageSize]` in both
the constructor and the `init` accessor (`KeysetPagination.cs:51`, `KeysetPagination.cs:62`) so a
caller who asks for zero or a million gets a sane page instead of an error, with `MaxPageSize` fixed at
1000 to mirror the query pipeline's own unbounded-result ceiling (`KeysetPagination.cs:26`), plus
`SortColumn`, `Descending`, and the opaque `Cursor` (`KeysetPagination.cs:67,71,75`). Its answer is
[`KeysetCollectionResult<T>`](#keysetcollectionresultt) (`KeysetPagination.cs:85`), a sibling of
`PagedCollectionResult<T>` over the same [`CollectionResult<T>`](#collectionresultt) base that adds a
single `NextCursor` (`KeysetPagination.cs:107`) and deliberately no total and no page number.

[`KeysetCursor`](#keysetcursor) (`KeysetPagination.cs:125`) is the static codec for that token.
`Encode` (`KeysetPagination.cs:139`) builds `v1|{hasSortValue}|{sortValue}|{id}` with both value
segments themselves base64url encoded so a value containing the separator cannot forge one
(`KeysetPagination.cs:143-150`), then base64url encodes the whole payload (`KeysetPagination.cs:152`).
`TryDecode` (`KeysetPagination.cs:169`) rejects anything it does not understand, wrong version, wrong
segment count, bad flag, invalid base64 (`KeysetPagination.cs:174-185`), rather than silently
mis-seeking, and its private base64url helper checks validity *before* decoding because the BCL's
`Base64Url.TryDecodeFromChars` throws on an invalid character rather than returning false, which is
exactly the input a client-supplied cursor will contain (`KeysetPagination.cs:202-206`). The cursor is
opaque but neither signed nor encrypted, so it must never carry anything the caller may not already
see, and by construction it carries only a sort key and an id from a row the caller just received
(`KeysetPagination.cs:120-123`): that is the [Rubric §11, Security] boundary of this design, stated in
source.

The consumer is the repository layer:
[`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype)`.GetPageByCursorAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:496`)
returns a `Result<KeysetCollectionResult<TEntity>>`, turning an unknown sort column
(`EFReadRepository.cs:503-512`) or a malformed cursor (`EFReadRepository.cs:520-528`) into a `Result`
failure rather than an exception, fetching `PageSize + 1` rows so the extra row acts as a next-page
probe instead of paying for a `COUNT` (`EFReadRepository.cs:535-541`), and encoding the last kept row
into the next cursor via [`KeysetQueryBuilder`](group-07-persistence-ef-core.md#keysetquerybuilder)
(`EFReadRepository.cs:546-549`). Per
[ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) this is a
repository-level capability only: it is deliberately not exposed on the HTTP query contract of
[ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html), which still offers
offset paging. Both shapes together are the [Rubric §12, Performance & Scalability] story on the read
side: no query ever returns an unbounded list, and deep scrolling has a mode that does not degrade
with depth.

## Where this leads

With these sixteen types you have the full error-and-result vocabulary the rest of the guide assumes.
You will see [`Result`](#result) returned by the domain building blocks of
[Chapter 2](group-02-domain-building-blocks.md) (factory methods that refuse to construct an invalid
entity), threaded through the CQRS decorator pipeline of [Chapter 5](group-05-cqrs-pipeline.md) and
cached across a Redis round trip by that same pipeline ([Chapter 9](group-09-caching.md)), produced by
the querying and persistence layers of [Chapter 3](group-03-querying-specifications.md) and
[Chapter 7](group-07-persistence-ef-core.md), and unwrapped at the edges by the API, gRPC and UI layers
([Chapter 12](group-12-api-hosting-mapping.md), [Chapter 13](group-13-grpc-contracts.md),
[Chapter 15](group-15-common-ui-framework.md)). Read this chapter's type sections next; everything
after them takes the railway for granted.

### CollectionResult<T>
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:92` · Level 0 · record

- **What it is**: a thin envelope wrapping a collection of items for API responses; the base type both paged variants ([`PagedCollectionResult<T>`](#pagedcollectionresultt) and [`KeysetCollectionResult<T>`](#keysetcollectionresultt)) extend.
- **Depends on**: nothing first-party. It shares a file with [`PaginationMetadata`](#paginationmetadata) and [`PagedCollectionResult<T>`](#pagedcollectionresultt), and it is inherited from another file by [`KeysetCollectionResult<T>`](#keysetcollectionresultt).
- **Concept introduced, the collection envelope.** Returning a *named wrapper* (`{ "items": [...] }`) instead of a bare JSON array is a small but deliberate `[Rubric §9, API & Contract Design]` choice (§9 assesses consistent, evolvable response contracts): a wrapper leaves room to add metadata later, pagination state or a cursor, without a breaking change to the response shape that a top-level array would force. That headroom is not hypothetical here, it is exactly what the two subtypes below spend.
- **Walkthrough**
  - One property: `required ICollection<T> Items { get; init; }` (`PaginationMetadata.cs:110`). `required` forces every caller to set it, so `Items` is never null; `init` makes it write-once.
  - Two constructors, both marked `[SetsRequiredMembers]` (`PaginationMetadata.cs:95,101`) so direct construction satisfies the `required` contract without an object initializer: a parameterless one delegating to the data constructor with an empty collection (`PaginationMetadata.cs:96-97`), and the data constructor (`PaginationMetadata.cs:102-106`).
  - The data constructor null-checks its input with `ArgumentNullException.ThrowIfNull` and then normalizes to a list, reusing the instance when the caller already passed a `List<T>` and copying with a collection expression otherwise (`PaginationMetadata.cs:105`). That is a real allocation saving on the hot read path, where the repository has already materialized a `List<T>`.
  - `[DataContract]` on the type and `[DataMember(Order = 1)]` on `Items` (`PaginationMetadata.cs:91,109`) pin the wire order, matching the serialization discipline [`PaginationMetadata`](#paginationmetadata) uses.
- **Why it's built this way**: `required` + `init` gives "set once, never null" semantics with no hand-written guard on the common path, while the explicit `[DataContract]` / `[DataMember(Order = ...)]` pair keeps the serialized shape deterministic instead of leaving it to member-declaration order.
- **Where it's used**: base of [`PagedCollectionResult<T>`](#pagedcollectionresultt) and [`KeysetCollectionResult<T>`](#keysetcollectionresultt). Note that it is the *base* that carries the reuse: no framework read returns a bare `CollectionResult<T>` today, every list read returns one of the two subtypes (the offset one through [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) and the generic controllers of [Chapter 12](group-12-api-hosting-mapping.md), the keyset one through the repository layer of [Chapter 7](group-07-persistence-ef-core.md)).

### DomainException
> MMCA.Common.Shared · `MMCA.Common.Shared.Exceptions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainException.cs:9` · Level 0 · class (abstract)

- **What it is**: the abstract base for domain-layer exceptions, the narrow escape hatch for the cases where returning a [`Result`](#result) is structurally impossible.
- **Depends on**: `System.Exception` (BCL) only. It references [`Result`](#result) in prose (`DomainException.cs:4`) but takes no code dependency on it.
- **Concept introduced, exceptions reserved for the truly exceptional.** `[Rubric §2, Design Patterns]` (§2 assesses whether patterns are idiomatic and solve real problems; a classic red flag is *exceptions used for control flow where a Result is the convention*). The doc comment (`DomainException.cs:3-8`) is explicit about the ranking: prefer the [`Result`](#result) pattern for expected error paths, reserve exceptions for programming errors and corrupted state. So this type exists, but it is the exception to the rule rather than the rule. `[Rubric §3, Clean Architecture]` also applies: the type lives in `MMCA.Common.Shared` with zero HTTP coupling, and the status mapping is deferred to the API layer.
- **Walkthrough**: three `protected` constructors, the standard exception constructor set: parameterless (`DomainException.cs:12`), message (`DomainException.cs:16-17`), and message plus inner exception (`DomainException.cs:22-23`). The class is `abstract`, so you must derive a specific exception rather than throwing the base directly, and the constructors being `protected` rather than `public` enforces that at the call site too.
- **Why it's built this way**: a single domain-exception root lets the edge catch "domain exceptions" as a *category*. [`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler) does exactly one type test, `exception is not DomainException` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:27`), sets HTTP 400 (`DomainExceptionHandler.cs:32`) and writes an RFC 9457 Problem Details body through `IProblemDetailsService` (`DomainExceptionHandler.cs:33-45`). One root type means new domain exceptions get correct edge behavior for free. See [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) for the decision that keeps this path narrow, including the load-bearing *registration order* of the handler chain (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:141`): ASP.NET Core runs `IExceptionHandler`s in registration order and stops at the first one that reports the exception handled, so most-specific-first is the mechanism, not a comment.
- **Where it's used**: base of [`DomainInvariantViolationException`](#domaininvariantviolationexception) (its only concrete subclass in the framework); caught by [`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler) in the ordered `IExceptionHandler` chain of [Chapter 12](group-12-api-hosting-mapping.md).

### ErrorType
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:10` · Level 0 · enum

- **What it is**: an enum that classifies every domain error into one of nine categories, each of which the API layer maps to an HTTP status code and the gRPC layer maps to a status code of its own.
- **Depends on**: nothing first-party (BCL only). It is the seed of the Result family: [`Error`](#error) (Level 1) carries an `ErrorType`, [`ErrorTypeSeverity`](#errortypeseverity) (Level 2) ranks one, and [`Result`](#result) (Level 2) carries `Error`s.
- **Concept introduced, the Result pattern.** `[Rubric §2, Design Patterns]` (§2 assesses whether patterns are idiomatic and solve real problems rather than being pattern theater; here the Result pattern is the codebase's canonical error-flow mechanism, used by practically every factory method, handler, and controller action in both repos). Instead of throwing for *expected* failures (validation, not-found, conflict), an operation returns a [`Result`](#result) that is either a success or a failure carrying one or more [`Error`](#error)s; `ErrorType` is that pattern's classification axis. It also touches `[Rubric §9, API & Contract Design]` (§9 assesses consistent, standardized error responses): every endpoint produces the same error shape out of the same nine categories. And `[Rubric §3, Clean Architecture]` (dependencies point inward, inner layers stay framework-free): this HTTP-shaped concept lives in the innermost assembly as a *pure enum* with no reference to ASP.NET, and the translation happens only at the edge. See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) for where the pattern sits among the codebase's committed styles.
- **Walkthrough**: nine members, each documented with the status it is meant to produce (`ErrorType.cs:13,16,19,22,25,28,31,34,41`): `Validation` (400), `Invariant` (400, a broken business rule), `NotFound` (404), `Conflict` (409, for example a duplicate or an already-deleted row), `Unauthorized` (401), `Forbidden` (403), `UnprocessableEntity` (422, for example an attempt to change an immutable field), `Failure` (400, the general/unclassified case), and `Unexpected` (500). No member is given an explicit numeric value: the ordinal order is irrelevant because every consumer keys on the member, never on the integer.
  - `Unexpected` is the one member with a policy attached to it in source (`ErrorType.cs:36-40`, and the matching factory doc at `Error.cs:103-108`): it is reserved for a *genuine server-side fault*, the request was well formed and permitted but the server could not complete it. It is explicitly not for business-rule violations. That reservation is what keeps the other eight categories caller-fixable, which is the property the whole enum is designed around.
  - The type-level doc comment (`ErrorType.cs:3-9`) states the aggregation rule the categories obey: when a result carries several errors, the response status is the one belonging to the **highest-ranked category present**, so an aggregate can never be downgraded by the ordering of its errors. The ranking itself is [`ErrorTypeSeverity`](#errortypeseverity).
- **Why it's built this way**: separating *classification* (this enum) from *carrier* ([`Error`](#error)) from *severity* ([`ErrorTypeSeverity`](#errortypeseverity)) from *outcome* ([`Result`](#result)) keeps each piece tiny and lets the same nine categories drive domain logic, HTTP translation, and gRPC translation from one source of truth. [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) states the rule the enum encodes: the domain never names an HTTP status.
- **Where it's used**: [`Error`](#error)'s nine factory methods each hard-code one member (`Error.cs:37,46,55,64,73,82,91,100,114`); [`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping) holds the HTTP table as a `FrozenDictionary<ErrorType, int>` built once at startup (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:20-31`) and resolves through it with a 400 fallback (`ErrorHttpMapping.cs:37-38`). On the gRPC boundary, [`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions) performs the mirror translation ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Caveats / not-in-source**: the per-member HTTP status codes written in this enum's doc comments are *documentation*, not the mapping. The executable table lives in `ErrorHttpMapping.cs:22-30` and currently agrees with them member for member.

### KeysetCursor
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs:125` · Level 0 · class (static)

- **What it is**: the encoder and decoder for the opaque cursor string that a keyset page hands back to the client and receives on the next request.
- **Depends on**: nothing first-party. Externals: `System.Buffers.Text.Base64Url` and `System.Text.Encoding` (BCL).
- **Concept introduced, the opaque, versioned cursor.** A cursor is a *position token*, not a page number. The client never parses it; it just echoes back whatever the previous page returned. That gives the server freedom to change the encoding without a client change, which is the `[Rubric §9, API & Contract Design]` point (§9 assesses evolvable contracts): the format carries an explicit `v1` prefix (`KeysetPagination.cs:127`), so a future `v2` encoding is additive and `TryDecode` keeps rejecting what it does not recognize rather than mis-seeking silently (`KeysetPagination.cs:113-119` documents exactly this intent). It also touches `[Rubric §11, Security]`: the doc comment is blunt that the cursor is neither signed nor encrypted (`KeysetPagination.cs:120-123`), so it must never carry anything the caller may not see. The two values it does carry, a sort key and an id, are already in the rows the caller just received, which is what makes the unsigned form acceptable rather than a leak.
- **Walkthrough**
  - Two private constants define the format: `Version = "v1"` and `Separator = '|'` (`KeysetPagination.cs:127-128`).
  - `Encode(string? sortValue, string id)` (`KeysetPagination.cs:139-153`) null-checks the id, then builds the payload `v1|{hasSortValue}|{sortValue}|{id}` where `hasSortValue` is the literal `"0"` or `"1"` and both value segments are themselves base64url (`KeysetPagination.cs:143-150`). Encoding the segments is what stops a sort value that happens to contain a `|` from forging an extra segment. The whole payload is then base64url encoded once more (`KeysetPagination.cs:152`), which is what makes the result URL-safe and visibly opaque.
  - `TryDecode(string? cursor, out string? sortValue, out string id)` (`KeysetPagination.cs:169-190`) is a strict inverse and a `Try` method by design, because its input is client-supplied. It clears both outputs first (`KeysetPagination.cs:171-172`), then rejects: a blank or non-base64url cursor (`KeysetPagination.cs:174-175`), a payload that does not split into exactly four segments or whose first segment is not `v1` (`KeysetPagination.cs:177-179`), a flag segment that is neither `"0"` nor `"1"` (`KeysetPagination.cs:181-182`), and a segment that is not valid base64url (`KeysetPagination.cs:184-185`). Only then does it publish the decoded values, honoring the flag by returning `null` for the sort value when the cursor carries none (`KeysetPagination.cs:187-189`).
  - `TryFromBase64Url` (`KeysetPagination.cs:195-214`) holds the subtle bit and says so in a comment: `Base64Url.TryDecodeFromChars` **throws** on an invalid character instead of returning `false`, and a client-supplied cursor is precisely the input that will contain one, so the method calls `Base64Url.IsValid` first (`KeysetPagination.cs:202-206`). An empty string short-circuits to a successful empty decode (`KeysetPagination.cs:199-200`), which is how a cursor with no sort value round-trips.
- **Why it's built this way**: the version prefix plus the total-failure `Try` contract means a malformed or stale cursor becomes a *validation failure the caller can see*, never a silent reset to the first page. [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) turns a `false` return into `Error.Validation("Error.InvalidCursor", ...)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:522-527`). This is the keyset half of [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html).
- **Where it's used**: `Encode` is called once per page by [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) with the last row's sort value and id, both rendered invariantly by [`KeysetQueryBuilder`](group-07-persistence-ef-core.md#keysetquerybuilder) (`EFReadRepository.cs:547-549`); `TryDecode` is called from the same class's `TryBuildSeekPredicate` to rebuild the seek predicate (`EFReadRepository.cs:567`).

### KeysetPageRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs:20` · Level 0 · record (sealed)

- **What it is**: the request for one keyset ("seek") page: how many rows, ordered by which single sort key in which direction, starting after which cursor.
- **Depends on**: nothing first-party at the type level. It is paired with [`KeysetCollectionResult<T>`](#keysetcollectionresultt) (whose `NextCursor` becomes this request's `Cursor`) and decoded by [`KeysetCursor`](#keysetcursor).
- **Concept introduced, keyset paging versus offset paging.** The type's own doc comment teaches the trade directly (`KeysetPagination.cs:11-17`): offset paging, the mode [`PaginationMetadata`](#paginationmetadata) describes, answers "give me page 37" and makes the database scan the 36 pages before it; keyset paging answers "give me what comes after this row" and costs one index seek no matter how deep you are, at the price of losing random page access and a total count. The two coexist, keyset does not replace offset. That is a textbook `[Rubric §12, Performance & Scalability]` concern (§12 assesses query efficiency and whether reads stay bounded as data grows): deep offset paging degrades linearly with depth, keyset does not. `[Rubric §9, API & Contract Design]` applies too, because the choice is visible in the response contract: a keyset page returns a cursor where an offset page returns a page number and a count.
- **Walkthrough**
  - `public const int MaxPageSize = 1000` (`KeysetPagination.cs:26`) is the framework ceiling. Its doc comment says it deliberately mirrors the query pipeline's own unbounded-result ceiling so neither entry point can be talked into an unbounded read (`KeysetPagination.cs:22-25`), and that mirror holds today: [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline) declares `MaxUnboundedResultLimit = 1000` (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:23`).
  - Two constructors: a parameterless one delegating with `pageSize: 1` (`KeysetPagination.cs:29-30`), and the full one (`KeysetPagination.cs:45-55`).
  - The page size is **clamped, not rejected**: `Math.Clamp(pageSize, 1, MaxPageSize)` in the constructor (`KeysetPagination.cs:51`) and again in the `init` accessor (`KeysetPagination.cs:62`), so a caller asking for zero or a million gets a sane page instead of an error. The `init` accessor uses the C# `field` keyword to write the clamped value into the compiler-generated backing field, which is what closes the hole that an object initializer, a `with` expression, or a System.Text.Json deserialization would otherwise open by bypassing the constructor entirely.
  - The remaining three properties are plain `init` values: `SortColumn` (nullable; null means order by `Id` alone, `KeysetPagination.cs:67`), `Descending` (`KeysetPagination.cs:71`), and `Cursor` (nullable; null means the first page, `KeysetPagination.cs:75`).
  - `[DataContract]` on the record and `[DataMember(Order = 1..4)]` on the four properties (`KeysetPagination.cs:19,58,66,70,74`) pin the wire order.
- **Why it's built this way**: exactly one sort key is supported, with the entity's `Id` as the tie-break, because that is what keeps the seek predicate a single composable comparison. A null `SortColumn` keys the page on `Id` alone (stated on the contract at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:306-309`). The sort column must name a real public property: [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) resolves it through [`KeysetQueryBuilder`](group-07-persistence-ef-core.md#keysetquerybuilder) and returns an `Error.InvalidEntityField` copy carrying the offending column name when it does not (`EFReadRepository.cs:503-512`), so an unknown name is a validation failure rather than a silently ignored parameter. See [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html).
- **Where it's used**: the sole parameter object of `GetPageByCursorAsync`, declared on [`IEntityQuerier<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientityqueriertentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:316-319`, inherited by [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) at `IRepository.cs:330`), implemented by [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) (`EFReadRepository.cs:496-553`) and forwarded by [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorydecoratortentity-tidentifiertype) (`EFReadRepositoryDecorator.cs:151-152`).
- **Caveats / not-in-source**: `MaxPageSize` and `MaxUnboundedResultLimit` are two independent constants that happen to be equal. Nothing in source ties them together, so a change to one does not move the other.

### PaginationMetadata
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:12` · Level 0 · record (sealed)

- **What it is**: an immutable record carrying offset-pagination state (total items, page size, current page) plus three derived, non-serialized convenience properties.
- **Depends on**: nothing first-party. It shares a file with [`CollectionResult<T>`](#collectionresultt) and [`PagedCollectionResult<T>`](#pagedcollectionresultt).
- **Concept introduced, server-side offset pagination and the explicit `[DataContract]` wire shape.** `[Rubric §9, API & Contract Design]` (§9 assesses uniform pagination and filtering conventions across endpoints) and `[Rubric §12, Performance & Scalability]` (§12 assesses whether reads page at the database rather than returning whole tables). Carrying explicit metadata is what lets the API page at the source and still tell the client how to navigate. The keyset alternative for deep scrolling is [`KeysetPageRequest`](#keysetpagerequest).
- **Walkthrough**
  - Two constructors: a parameterless one delegating to the main constructor with zeros (`PaginationMetadata.cs:15-16`), and the main constructor which guards all three arguments with `ArgumentOutOfRangeException.ThrowIfNegative` before assigning (`PaginationMetadata.cs:22-31`). Negative pagination is therefore unrepresentable.
  - Three stored values, each `init` and each tagged `[DataMember(Order = 1..3)]`: `TotalItemCount` (`PaginationMetadata.cs:38-47`), `PageSize` (`PaginationMetadata.cs:50-59`), and `CurrentPage` (`PaginationMetadata.cs:62-71`).
  - Each `init` accessor **re-validates** with `ArgumentOutOfRangeException.ThrowIfNegative` and assigns through the C# `field` keyword. The comment above them says why (`PaginationMetadata.cs:33-35`): object initializers, record `with` expressions, and System.Text.Json (which builds this type through the parameterless constructor plus the `init` setters) all bypass the constructor guards. Without the duplicated check the guard would be decorative on exactly the paths a client controls.
  - Three computed properties tagged `[IgnoreDataMember]`, so they are derived rather than transmitted: `TotalPageCount`, a ceiling division that returns 0 when `PageSize` is 0 (`PaginationMetadata.cs:74-75`); `FirstRowOnPage`, which returns 0 for the several empty cases and otherwise computes the 1-based first index (`PaginationMetadata.cs:78-79`); and `LastRowOnPage`, clamped to `TotalItemCount` (`PaginationMetadata.cs:82-83`). Note the `(long)` casts inside both row calculations: `CurrentPage * PageSize` is a deliberate overflow guard, since two large `int`s multiply out of range long before either is individually implausible.
- **Why it's built this way**: `[DataContract]` / `[DataMember]` / `[IgnoreDataMember]` make the wire shape explicit and stable, so only the three primary values travel and the rest are recomputed on the other side. Constructor-plus-`init` validation makes an invalid instance unconstructable, which is the same "validate at the boundary of the type" discipline the value objects of [Chapter 2](group-02-domain-building-blocks.md) use.
- **Where it's used**: embedded in [`PagedCollectionResult<T>`](#pagedcollectionresultt); serialized whole into the `X-Pagination` response header by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:187`), which also reads `TotalItemCount` to decide whether a CSV export was truncated (`EntityControllerBase.cs:340`). Built by [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) in one private helper (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:555`, called at `:332`).

### PropertyReader
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:118` · Level 0 · delegate

- **What it is**: a small private delegate that [`ResultJsonConverterFactory`](#resultjsonconverterfactory) uses to hand each property of a `Result` JSON payload to a per-converter callback while one shared object-walker drives the reader.
- **Depends on**: `System.Text.Json.Utf8JsonReader` (BCL), taken by `ref`.
- **Concept introduced, a callback shape that can carry a `ref struct`.** `[Rubric §15, Best Practices & Code Quality]` (§15 assesses DRY and whether shared mechanics are factored out rather than copy-pasted). The two nested converters differ only in *which* JSON properties they care about, so the property loop is factored into a single `ReadObject` and this delegate is how `ReadObject` calls back into each one. The `ref` is not stylistic: `Utf8JsonReader` is a `ref struct`, it cannot be a generic type argument, so an ordinary `Func<Utf8JsonReader, ...>` is not expressible. A hand-written delegate with a `ref` parameter is the only shape available, and passing by `ref` also means the callback advances the *same* reader the walker is driving rather than a copy.
- **Walkthrough**: a one-line private declaration, `private delegate void PropertyReader(ref Utf8JsonReader reader, string propertyName)` (`ResultJsonConverterFactory.cs:118`). `ReadObject` takes one as its third parameter (`ResultJsonConverterFactory.cs:121`), positions the reader on each property's *value* token, and invokes the delegate once per property (`ResultJsonConverterFactory.cs:136-140`).
- **Why it's built this way**: keeping all the token-stream bookkeeping (the `StartObject` check, the `EndObject` termination, the truncation guards) in one place and passing only "what to do with this property" as a delegate means the JSON walk exists once instead of twice, and a fix to the walk fixes both converters.
- **Where it's used**: only inside [`ResultJsonConverterFactory`](#resultjsonconverterfactory). [`ResultConverter`](#resultconverter)`.Read` passes a lambda of this shape (`ResultJsonConverterFactory.cs:44-50`) and the generic `ResultConverter<T>.Read` passes a richer one (`ResultJsonConverterFactory.cs:72-88`).
- **Caveats / not-in-source**: it is `private` to the factory, so it is not part of any public API and no consumer can name it.

### DomainInvariantViolationException
> MMCA.Common.Shared · `MMCA.Common.Shared.Exceptions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9` · Level 1 · class

- **What it is**: the concrete exception for a domain invariant violated in a context where the [`Result`](#result) pattern cannot be used, the example the doc comment names being an aggregate root constructor called by EF Core materialization, where the call stack is framework-owned and there is no `Result` channel to return through.
- **Depends on**: [`DomainException`](#domainexception) (Level 0).
- **Concept**: this is the sanctioned safety valve, and the doc comment ranks it explicitly (`DomainInvariantViolationException.cs:3-8`): prefer returning [`Result`](#result) with an [`Error`](#error)`.Invariant` for normal business-rule violations. `[Rubric §2, Design Patterns]` (§2 flags exceptions used as control flow; this type is the documented last resort, not the default path). Because it derives from [`DomainException`](#domainexception), it inherits the edge behavior for free: [`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler) maps it to HTTP 400 plus Problem Details without knowing this subclass exists.
- **Walkthrough**: three `public` constructors delegating to the base, matching the standard exception set: parameterless (`DomainInvariantViolationException.cs:12-13`), message (`DomainInvariantViolationException.cs:17-18`), and message plus inner exception (`DomainInvariantViolationException.cs:23-24`). The class is `public` and **not** `sealed`, so a consuming module can derive a more specific invariant exception and still land on the same edge handling.
- **Why it's built this way**: making the concrete type public and unsealed while keeping the base abstract with `protected` constructors gives a two-level shape: one root the edge can catch as a category, one ready-made concrete type nobody has to define, and room underneath it for module-specific refinements.
- **Where it's used**: caught as a [`DomainException`](#domainexception) by the API middleware of [Chapter 12](group-12-api-hosting-mapping.md). Read that as *capability*, not traffic: this is the honest state of the exception path, and it is worth internalizing because it is the strongest evidence that the Result pattern really is the default.
- **Caveats / not-in-source**: there is **no production `throw` site** for this type anywhere in the workspace today. Every reference outside its own file is a test that needs a sample `DomainException` to drive the handler chain or a UI error path (for example `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Middleware/ExceptionHandlerTests.cs` and `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Exceptions/DomainExceptionTests.cs`). The EF-materialization scenario the doc comment describes is the *reason the type exists*, not a path the current code takes.

### Error
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:15` · Level 1 · record

- **What it is**: the immutable error value carried by [`Result`](#result). Every error has a machine-readable `Code`, a human-readable `Message`, an [`ErrorType`](#errortype) that drives the status at the edge, and optional `Source` / `Target` context.
- **Depends on**: [`ErrorType`](#errortype) (Level 0). No externals beyond the BCL.
- **Concept introduced, the error as a value.** `[Rubric §2, Design Patterns]` (§2 assesses idiomatic patterns that solve real problems): an `Error` is a **value**, not an exception. It can be constructed, put in a list, threaded through a pipeline, merged with other errors, and inspected, all without a throw, a stack capture, or an unwind. `[Rubric §9, API & Contract Design]` (§9 assesses consistent, standardized error responses): the triple of `Code` (for programmatic branching by the client), `Message` (for humans), and [`ErrorType`](#errortype) (for the status selector) gives every endpoint a uniform error shape with no controller deciding how to format anything.
- **Walkthrough**
  - The type is a positional `record` with five components (`Error.cs:15-20`): `Code`, `Message`, `Type`, and the two optional context strings `Source` and `Target`, both defaulting to `null`. Being a record it gets value equality, so two errors with the same components compare equal, which is what makes error assertions in tests trivial.
  - Three pre-built `static readonly` singletons for the ubiquitous cases (`Error.cs:23,26,29`): `Error.NotFound`, `Error.AlreadyDeleted`, and `Error.InvalidEntityField`. Each is itself built through a factory method, so the singletons cannot drift from the factory contract.
  - **Nine factory methods**, one per [`ErrorType`](#errortype) member (`Error.cs:37,46,55,64,73,82,91,100,114`): `Validation`, `Invariant`, `NotFoundError`, `Conflict`, `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`, and `Unexpected`. Each hard-codes the matching `ErrorType`, so a caller cannot pair the wrong classification with a code. Two details worth carrying: the factory is `NotFoundError` rather than `NotFound` because the static field already owns that name and C# forbids a field and a method sharing one; and `Unexpected` carries a written usage policy on the factory itself (`Error.cs:103-108`), namely that it is for a genuine server-side fault the caller cannot fix by changing the request, with business-rule violations routed to `Invariant` or `Failure`.
  - Two `with`-expression helpers (`Error.cs:120-121,126-127`): `WithSource(string)` and `WithTarget(string)` each return a copy with one component replaced, which is how a generic framework error gets enriched with caller context without being mutated.
  - The singletons are `record`s, so they are also freely refinable at the call site: [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) takes `Error.InvalidEntityField with { Message = ..., Source = ..., Target = ... }` to report an unknown keyset sort column (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:505-511`), keeping the shared `Code` while specializing everything else.
- **Why it's built this way**: modeling an expected failure as data rather than as control flow is the whole point of [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html). The pre-built singletons keep the common cases allocation-free, and the factory methods fix the `Code` to `ErrorType` pairing at the point of creation so no mapping table is needed anywhere else in the codebase.
- **Where it's used**: carried by every failing [`Result`](#result) in both repos; [`ValidationFailureExtensions`](group-06-validation.md#validationfailureextensions) converts each FluentValidation failure into an `Error.Validation(...)` carrying the rule's code, message, source, and property name (`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:21`); [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) renders the whole list into the Problem Details `errors` extension, optionally through an [`IErrorLocalizer`](group-12-api-hosting-mapping.md#ierrorlocalizer) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:57-58`, projection at `ErrorHttpMapping.cs:61-69`); [`ErrorTypeSeverity`](#errortypeseverity) picks one of them to classify the whole failure; and [`ResultJsonConverterFactory`](#resultjsonconverterfactory) serializes the list as the `errors` array.

### KeysetCollectionResult<T>
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs:85` · Level 1 · record (sealed)

- **What it is**: the response shape for one keyset page, a [`CollectionResult<T>`](#collectionresultt) plus the cursor that fetches the following page.
- **Depends on**: [`CollectionResult<T>`](#collectionresultt) (Level 0). It is the counterpart of [`KeysetPageRequest`](#keysetpagerequest) and its cursor is produced by [`KeysetCursor`](#keysetcursor).
- **Concept**: this is the same envelope idea [`CollectionResult<T>`](#collectionresultt) introduced, extended in one orthogonal step, but the interesting part is what it deliberately **omits**. There is no total count and no page number (`KeysetPagination.cs:78-82`), because a keyset read never pays for either. Compare [`PagedCollectionResult<T>`](#pagedcollectionresultt), which carries both. That asymmetry is honest `[Rubric §9, API & Contract Design]`: the contract advertises exactly what the read mode can actually deliver instead of faking a count with a second query. It is also the `[Rubric §12, Performance & Scalability]` payoff, since the count query is usually the expensive half of a deep page.
- **Walkthrough**
  - `sealed record` inheriting `CollectionResult<T>` (`KeysetPagination.cs:85`), tagged `[DataContract]` (`KeysetPagination.cs:84`).
  - Two constructors mirroring the base, both `[SetsRequiredMembers]` (`KeysetPagination.cs:88,98`): a parameterless one producing an empty page with no next cursor (`KeysetPagination.cs:89-90`), and the data constructor that passes items to `base(items)` and assigns the cursor (`KeysetPagination.cs:99-100`).
  - One added property: `string? NextCursor { get; init; }` tagged `[DataMember(Order = 2)]` so it serializes after `Items` (`KeysetPagination.cs:106-107`). Null means this page is the last one. The doc comment instructs consumers to treat it as opaque and warns that its encoding is versioned (`KeysetPagination.cs:102-105`).
- **Why it's built this way**: nullable-means-last is what lets the repository skip a count entirely. It fetches `PageSize + 1` rows as a next-page probe, drops the extra row, and only then emits a cursor (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:535-552`); the comment there states the trade explicitly, that a one-row probe is cheaper and more honest than a `COUNT` over the whole set (`EFReadRepository.cs:536-537`). See [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html).
- **Where it's used**: the success payload of `GetPageByCursorAsync`, declared on [`IEntityQuerier<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ientityqueriertentity-tidentifiertype) as `Task<Result<KeysetCollectionResult<TEntity>>>` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:316`) and returned by [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype) (`EFReadRepository.cs:552`). Note the composition: the *outcome* is a [`Result`](#result), the *payload* is this envelope, which is the standard pairing throughout the codebase.

### PagedCollectionResult<T>
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:119` · Level 1 · record (sealed)

- **What it is**: a [`CollectionResult<T>`](#collectionresultt) augmented with a [`PaginationMetadata`](#paginationmetadata) property, the standard shape for an offset-paged API response.
- **Depends on**: [`CollectionResult<T>`](#collectionresultt) (Level 0) and [`PaginationMetadata`](#paginationmetadata) (Level 0).
- **Concept**: the same envelope-plus-one-step extension as [`KeysetCollectionResult<T>`](#keysetcollectionresultt), but for the offset mode, so it carries the count and page number a cursor page cannot. `[Rubric §12, Performance & Scalability]` (paged reads instead of whole tables) and `[Rubric §9, API & Contract Design]` (a stable, evolvable response contract). Reading the two subtypes side by side is the fastest way to internalize the difference between the two paging modes.
- **Walkthrough**
  - `sealed record` inheriting `CollectionResult<T>` (`PaginationMetadata.cs:119`), tagged `[DataContract]` (`PaginationMetadata.cs:118`).
  - Two constructors mirroring the base, both `[SetsRequiredMembers]` (`PaginationMetadata.cs:122,129`): a parameterless one producing an empty result with a default `PaginationMetadata` (`PaginationMetadata.cs:123-124`), and the data constructor that calls `base(items)` and null-checks the metadata with `ArgumentNullException.ThrowIfNull` (`PaginationMetadata.cs:130-135`).
  - One added property: `required PaginationMetadata PaginationMetadata { get; init; }` tagged `[DataMember(Order = 2)]` (`PaginationMetadata.cs:138-139`), so it is never null and always serializes after `Items`.
- **Why it's built this way**: `required` plus a null-checking constructor covers both construction routes (object initializer and direct constructor call), and the explicit `Order = 2` keeps the wire shape deterministic across the base/derived split, which member-declaration order alone would not guarantee.
- **Where it's used**: the payload of every offset-paged read, and a genuinely *shared* contract rather than a server-only shape. The controller surface declares `Task<ActionResult<PagedCollectionResult<TEntityDTO>>>` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:43`, implemented at `EntityControllerBase.cs:157`) and copies the metadata into the `X-Pagination` header (`EntityControllerBase.cs:187`), while the Blazor client deserializes the very same type (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:73,111`), so there is no hand-written mirror DTO to drift. [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) builds it (`EntityQueryService.cs:338-342`), and the notification read handlers in `MMCA.Common.Application` return it too.

### ErrorTypeSeverity
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:30` · Level 2 · class (static)

- **What it is**: the single severity ranking over [`ErrorType`](#errortype), and the helper that picks the one representative [`Error`](#error) from a failure carrying several. Every transport edge classifies an aggregate failure through this one table.
- **Depends on**: [`ErrorType`](#errortype) (Level 0) and [`Error`](#error) (Level 1). Externals: `System.Collections.Frozen.FrozenDictionary` (BCL).
- **Concept introduced, ranking an aggregate failure instead of taking its first error.** `[Rubric §9, API & Contract Design]` (§9 assesses consistent, correct error responses across endpoints) and `[Rubric §7, Microservices Readiness]` (§7 assesses whether a capability behaves identically once a module is extracted behind a network boundary). Here is the problem this type exists to solve, and it is worth understanding before the code. [`Result.Combine`](#result) aggregates errors in **evaluation order**, so a domain factory that checks five fields produces a list ordered by the order the checks happened to run. If the edge classified the whole failure by the *first* error in that list, an incidental `Validation` failure could downgrade a real `Forbidden` or `Unexpected` in the same list to a 400: the response status would depend on the order somebody wrote the guard clauses. Ranking the *categories* makes the classification independent of ordering.

  The second half of the concept is *where* the ranking lives. It is in `MMCA.Common.Shared`, the innermost layer, and not inside `MMCA.Common.API`, because two edges consume it: HTTP and gRPC. Putting the table in one presentation package would leave the other edge to invent its own rule, and the type's own doc comment names exactly that outcome as the thing to avoid (`ErrorTypeSeverity.cs:11-15`). This is the small, concrete version of a rule the whole framework follows: anything two transports must agree on belongs below both of them.
- **Walkthrough**
  - `Ranks`, a `private static readonly FrozenDictionary<ErrorType, int>` built once from a dictionary literal (`ErrorTypeSeverity.cs:37-48`). The ranking, most to least severe: `Unexpected` 70, `Unauthorized` 60, `Forbidden` 50, `Conflict` 40, `NotFound` 30, `UnprocessableEntity` 20, and then `Invariant`, `Validation`, and `Failure` sharing one rank of 10 (`ErrorTypeSeverity.cs:39-47`). The reasoning for each rung is written onto the type itself as a numbered list (`ErrorTypeSeverity.cs:16-25`): the server being broken outranks the caller not having proven who they are, which outranks the caller being known but not allowed, and so on down to the three categories the caller can fix by changing the request. `FrozenDictionary` is the chosen shape because the table is fixed at startup and read on every failure path (`ErrorTypeSeverity.cs:33-35`).
  - `Rank(ErrorType)` (`ErrorTypeSeverity.cs:57`) is a one-line `GetValueOrDefault(errorType, 0)`. The **zero default is load-bearing**, and the doc comment says why (`ErrorTypeSeverity.cs:50-53`): a category added to [`ErrorType`](#errortype) without a rank here ranks *lowest*, so a new member can never silently outrank a real 403 or 500. The failure mode of forgetting to update this table is a too-low status, which is visible, not a too-high one, which would be a security-shaped surprise.
  - `MostSevere(IReadOnlyList<Error>)` (`ErrorTypeSeverity.cs:69-96`) selects the representative error. It null-checks (`ErrorTypeSeverity.cs:71`) and rejects an empty list outright with `ArgumentException` (`ErrorTypeSeverity.cs:73-78`), because a failure with no errors is not classifiable and the [`Result`](#result) factories already make that state unreachable. It then seeds from `errors[0]` (`ErrorTypeSeverity.cs:80-81`) and scans forward keeping strictly greater ranks (`ErrorTypeSeverity.cs:85-93`). The strict `>` is what implements "ties keep the earliest error", so a list of same-rank errors behaves exactly as a positional selection would, which is the compatibility property that made the change safe to make.
  - The scan is a hand-written index loop with a comment defending it (`ErrorTypeSeverity.cs:83-84`): a LINQ `MaxBy` would allocate an enumerator plus a comparer closure on a path that runs on *every* failure response. That is `[Rubric §12, Performance & Scalability]` reasoning applied at the right scale, a hot path, with the trade written down rather than assumed.
- **Why it's built this way**: [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) records the decision and its history. Only the *status* is ranked: every error still travels in the payload, in the Problem Details `errors` array on HTTP (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:61-69`) and in the gRPC trailers on the other edge. The ranking answers exactly one question, "what is this failure, in one word", and answers it the same way on both transports.
- **Where it's used**: HTTP resolves a status through it, `ErrorHttpMapping.GetStatusCode(IReadOnlyList<Error>)` calling `MostSevere` (`ErrorHttpMapping.cs:50-51`) on behalf of [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)`.HandleFailure` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:48`). gRPC does the same in [`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions)`.ToRpcException` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:117`, falling back to `Internal` for the impossible empty case). The UI uses the other half of the type: [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions)`.LocalizedErrorMessages` orders the messages it shows a user by `Rank` descending, so the most severe error is read first (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:155`).

### Result
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:19` · Level 2 · class

- **What it is**: the non-generic railway-oriented outcome type, either a success (no errors) or a failure carrying one or more [`Error`](#error) instances. The non-generic form covers void-equivalent operations (invariant checks, deletes, commands with nothing to return); the sealed generic `Result<T>` in the same file (`Result.cs:204`) adds a `Value` on the success path and the full combinator set.
- **Depends on**: [`Error`](#error) (Level 1) and [`ResultJsonConverterFactory`](#resultjsonconverterfactory), which is attached to both classes by a type-level `[JsonConverter(typeof(ResultJsonConverterFactory))]` (`Result.cs:18,203`). Externals: `System.Collections.Generic`, `System.Text.Json.Serialization`, `System.Diagnostics.CodeAnalysis` (BCL).
- **Concept introduced, railway-oriented programming and the combinators.** `[Rubric §2, Design Patterns]` (the Result pattern as the codebase's canonical error-flow mechanism, not an exception crutch), `[Rubric §9, API & Contract Design]` (one structured failure shape behind every endpoint), and `[Rubric §12, Performance & Scalability]` in the allocation choices below.

  The **railway metaphor**: picture two parallel tracks, success and failure. Each step takes the current result as input; if it is already a failure the step is skipped and the train stays on the failure track, and if it is a success the step runs and may stay on the success track or switch. Control flows forward with no nested `try`/`catch` and no `if (result.IsFailure)` at every line. [`ErrorType`](#errortype) classifies the failure, [`Error`](#error) carries it, [`ErrorTypeSeverity`](#errortypeseverity) ranks it when there are several, and `Result` is the envelope that moves it.

  The non-generic `Result`:
  - Two shared instances back the cheap paths: `CachedSuccess` (`Result.cs:21`) and an empty `NoErrors` array (`Result.cs:22`). Errors live in a lazily allocated `List<Error>? _errors` (`Result.cs:26`), and the comment above it states the reason (`Result.cs:24-25`): the success path, which is the overwhelming majority of results created per request, never pays for a list allocation.
  - `Errors` returns the list or falls back to the shared empty array (`Result.cs:29`); `IsSuccess` is `_errors is null || _errors.Count == 0` (`Result.cs:32`) and `IsFailure` is its negation (`Result.cs:35`). Success is therefore *derived from the error count*, not stored, which is the fact the guard two bullets down exists to protect.
  - **Implicit lifting.** `public static implicit operator Result(Error error)` (`Result.cs:43`) lets a guard clause write `return someError;` with no factory named, and `FromError` (`Result.cs:49-53`) is the named alternate the analyzers require for that operator. The generic type has the same pair plus one more: `Error` to `Result<T>` (`Result.cs:233-237`) and, on the happy path, `T` to `Result<T>` (`Result.cs:249`) so a handler writes `return theValue;`. Both operators carry a `[SuppressMessage]` with the reasoning written into the `Justification` (`Result.cs:229-232,245-248`), which is worth reading as an example of how this codebase documents an analyzer exception at the point of the exception.
  - `protected void AddErrors(IEnumerable<Error> errors)` (`Result.cs:57`) is the only mutation point, and it null-coalescing-assigns the list on first use.
  - `Result.Success()` (`Result.cs:62`) returns the shared singleton; `Result.Success<T>(value)` (`Result.cs:68`) wraps a value in a new `Result<T>`.
  - Four failure factories: `Failure<T>(IEnumerable<Error>)` (`Result.cs:74`), `Failure(IEnumerable<Error>)` (`Result.cs:83-89`), `Failure(Error)` (`Result.cs:94-95`), and `Failure<T>(Error)` (`Result.cs:101-102`), the single-error overloads delegating to the collection ones.
  - `private protected static void ThrowIfNoErrors(Result result)` (`Result.cs:107-115`) is the guard that makes the derived-success design safe. Because `IsSuccess` is computed from the error count, an accidentally empty collection handed to `Failure(...)` would otherwise produce a **success** from a call that explicitly asked for a failure, so the guard throws `ArgumentException` instead. `Result.Failure(IEnumerable<Error>)` calls it after adding (`Result.cs:87`), and so does `Result<T>`'s failure constructor (`Result.cs:220`).
  - `Result.Combine(params ReadOnlySpan<Result> results)` (`Result.cs:124-145`) is the aggregate-all-failures combinator: it walks every input, collects *all* errors into one list, and returns success only when every input succeeded (`Result.cs:133-144`). It throws `ArgumentException` on an empty span, since combining nothing is a logic bug (`Result.cs:126-129`). Two allocation details: `params ReadOnlySpan<Result>` means the common call site passes a stack-allocated span rather than an array, and `allErrors` is only allocated once a failure is actually seen (`Result.cs:131,137`).
  - Three combinators on the valueless type so a void-equivalent step composes the same way: `Match` (`Result.cs:155-161`), `OnFailure`, which runs a side effect on the error list and returns the same instance so it can sit inline in a chain (`Result.cs:169-179`), and `Bind` (`Result.cs:187-191`).

  The generic `Result<T>` (`Result.cs:204`):
  - `sealed class Result<T> : Result` adding `public T? Value { get; }` (`Result.cs:207`), which is `null` when the result is a failure.
  - Two `internal` constructors (`Result.cs:211` for success, `Result.cs:217-221` for failure) so only the base class's static factories can produce an instance. Application code can never write `new Result<Order>(...)`.
  - `Match<TResult>(onSuccess, onFailure)` (`Result.cs:260-268`) terminates the railway by collapsing both tracks into one value; both delegates are null-checked and exactly one branch runs. `MatchAsync` (`Result.cs:355-365`) is the awaiting counterpart with the same guarantee.
  - `Map<TOut>(mapper)` (`Result.cs:276-280`) transforms the success value and propagates the errors untouched on failure, so a DTO projection needs no `if`.
  - `Bind<TOut>(binder)` (`Result.cs:302-306`) and `BindAsync<TOut>(binder)` (`Result.cs:289-293`) are the monadic bind, sync and async: on failure they short-circuit and return the original errors *without invoking* `binder`.
  - `Tap(action)` (`Result.cs:314-324`) runs a side effect on the success value and returns the same instance, and `Ensure(predicate, error)` (`Result.cs:334-345`) fails an otherwise-successful chain with a supplied [`Error`](#error) when the value does not satisfy a predicate, leaving an already-failed result untouched and never running the predicate.
  - Every combinator short-circuits on failure, at `Result.cs:279`, `:292`, `:305`, and `:339-342`. That uniformity is the property that makes them composable: you can read a chain top to bottom and know that nothing after the first failure ran.
- **Why it's built this way**: [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) is the decision record. Expected failures are values, not exceptions, because an exception is invisible in the signature, easy to forget to catch, expensive on the throw path, and conflates "we will not do this" with "the process is broken". Keeping the value-bearing constructors `internal` and routing everything through the factories plus `ThrowIfNoErrors` is what makes the central invariant hold by construction: a result is always either a clean success or a non-empty failure, never a half-built object. The implicit conversions exist so that discipline costs nothing at the call site.
- **Where it's used**: as a *return type*, everywhere. Value-object and entity factories return it, for example [`Address`](group-02-domain-building-blocks.md#address)`.Create` gathers its per-field checks with `Result.Combine` (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:77`), as does [`AddressInvariants`](group-02-domain-building-blocks.md#addressinvariants) (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:40`); every CQRS handler in [Chapter 5](group-05-cqrs-pipeline.md) threads one through the decorator pipeline; every controller action in [Chapter 12](group-12-api-hosting-mapping.md) unwraps one; the repository contract of [Chapter 7](group-07-persistence-ef-core.md) returns `Result<KeysetCollectionResult<TEntity>>` for a keyset page; and [`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions) carries one across a process boundary in [Chapter 13](group-13-grpc-contracts.md).
- **Caveats / not-in-source**: the two halves of the surface get very different amounts of use, and you should calibrate on that when you read the applications. `Result.Combine` and direct `IsFailure` / `Errors` / `Value` inspection are the dominant idioms (`Result.Combine` appears 8 times across 6 files in `MMCA.Common/Source` and 54 times across 29 files in `MMCA.ADC/Source`; `IsFailure` appears 341 times across 123 files in `MMCA.ADC/Source` alone). The fluent combinators (`Match`, `Map`, `Bind`, `BindAsync`, `Tap`, `Ensure`, `OnFailure`) are fully implemented and unit-tested in `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Abstractions/ResultTests.cs`, but a search of the workspace finds no production call site for them today. Read them as available surface, not as prevailing style.

### ResultConverter
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:35` · Level 2 · class (private sealed, nested)

- **What it is**: the private nested `JsonConverter<Result>` for the non-generic [`Result`](#result). A structurally similar generic sibling, `ResultConverter<T>` (`ResultJsonConverterFactory.cs:63`), handles `Result<T>` and additionally round-trips the success `Value`.
- **Depends on**: [`Result`](#result), [`Error`](#error), [`PropertyReader`](#propertyreader), and the enclosing [`ResultJsonConverterFactory`](#resultjsonconverterfactory), which owns the shared `ReadObject` and `WriteErrors` helpers and the two property-name constants. Externals: `System.Text.Json`.
- **Concept introduced, round-tripping a factory-constructed type.** `[Rubric §12, Performance & Scalability]` (the distributed query cache stores handler results, so a `Result` must survive a serialize/deserialize cycle) and `[Rubric §9, API & Contract Design]` (a compact, stable wire shape). Because [`Result`](#result) keeps `internal` constructors and get-only properties, System.Text.Json's default reflection-based deserializer cannot rebuild one. This converter reads the compact `{"value": ..., "errors": [...]}` shape and reconstructs **through the public factory methods**, which is what keeps a rehydrated result subject to the same success-or-non-empty-failure invariant a freshly built one obeys. Setting fields directly would have bypassed exactly that guard.
- **Walkthrough**
  - `Read` (`ResultJsonConverterFactory.cs:40-53`): declares `List<Error>? errors`, then drives the shared `ReadObject` with a [`PropertyReader`](#propertyreader) lambda that deserializes the `errors` array on a case-insensitive name match and calls `reader.Skip()` on everything else (`ResultJsonConverterFactory.cs:44-50`). It returns `Result.Failure(errors)` when errors were present and `Result.Success()` otherwise (`ResultJsonConverterFactory.cs:52`).
  - The comment above `Read` records a deliberate asymmetry (`ResultJsonConverterFactory.cs:37-39`): the non-generic `Result` carries no value, so `Write` emits a bare `{}` for a success. An empty object is therefore the *legitimate* wire form here and must stay a success, unlike in the generic converter where it means a corrupt payload.
  - `Write` (`ResultJsonConverterFactory.cs:55-60`): opens an object, delegates to the shared `WriteErrors`, closes it. `WriteErrors` returns immediately on success, so nothing but `{}` is written (`ResultJsonConverterFactory.cs:146-153`).
  - The generic `ResultConverter<T>` (`ResultJsonConverterFactory.cs:63`) mirrors the shape but tracks two extra booleans, `sawValue` and `sawErrors` (`ResultJsonConverterFactory.cs:69-70`), set as the walker encounters each property (`ResultJsonConverterFactory.cs:72-88`). If neither was seen it throws `JsonException` (`ResultJsonConverterFactory.cs:95-98`), and the comment explains why in detail (`ResultJsonConverterFactory.cs:90-94`): `Write` always emits one of the two properties, so an object carrying neither is a truncated or partially overwritten cache entry, and returning `Result.Success(default!)` there would hand the caller a **fake success wrapping null**. A success whose value genuinely is null still writes `"value": null`, which sets `sawValue` and stays a success. Its `Write` (`ResultJsonConverterFactory.cs:103-115`) emits `value` only when the result `IsSuccess` and then delegates to the same `WriteErrors`.
- **Why it's built this way**: reconstructing through `Result.Failure` / `Result.Success` rather than through field assignment keeps a deserialized result honest (a value only on success, errors only on failure), and the corrupt-payload guard turns a cache-level data problem into a loud `JsonException` instead of a silent wrong answer. Writing only the property that applies keeps the payload minimal, which matters when every cached query result pays for it. Nesting both converters privately inside the factory keeps them an implementation detail no consumer can bind to.
- **Where it's used**: instantiated only by [`ResultJsonConverterFactory`](#resultjsonconverterfactory)`.CreateConverter` (`ResultJsonConverterFactory.cs:28-32`); never referenced by application code.

### ResultJsonConverterFactory
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15` · Level 2 · class (sealed)

- **What it is**: a `JsonConverterFactory` that produces the right converter for [`Result`](#result) or for any closed `Result<T>`, wired onto both types by a type-level `[JsonConverter(typeof(ResultJsonConverterFactory))]` attribute (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:18,203`).
- **Depends on**: [`Result`](#result), [`Error`](#error), [`ResultConverter`](#resultconverter) and its generic sibling, [`PropertyReader`](#propertyreader). Externals: `System.Text.Json` (`JsonConverterFactory`, `Utf8JsonReader`, `Utf8JsonWriter`) and `System.Activator`.
- **Concept introduced, the converter factory for an open generic.** A `JsonConverter<T>` is bound to one closed type, so `Result<Order>`, `Result<CategoryDTO>`, and every other closure would each need their own registration. A `JsonConverterFactory` inverts that: it answers "can I handle this type?" at runtime and manufactures the right closed converter on demand, so one attribute covers every `Result<T>` in both repos forever. `[Rubric §15, Best Practices & Code Quality]` (the mechanism exists once rather than per type) and `[Rubric §12, Performance & Scalability]`, since without it the distributed result cache could not store a handler result at all.
- **Walkthrough**
  - Two private constants fix the wire shape for both converters: `ValuePropertyName = "value"` and `ErrorsPropertyName = "errors"` (`ResultJsonConverterFactory.cs:17-18`).
  - `CanConvert` (`ResultJsonConverterFactory.cs:21-23`): true for `typeof(Result)` exactly, or for any generic type whose generic type definition is `Result<>`.
  - `CreateConverter` (`ResultJsonConverterFactory.cs:26-33`): returns a [`ResultConverter`](#resultconverter) for the non-generic case (`ResultJsonConverterFactory.cs:28-29`), and otherwise pulls the value type off the closed generic and constructs `ResultConverter<T>` reflectively via `Activator.CreateInstance(typeof(ResultConverter<>).MakeGenericType(valueType))` (`ResultJsonConverterFactory.cs:31-32`). That reflective construction happens once per closed type, not once per payload, because System.Text.Json caches converters per type in the `JsonSerializerOptions`.
  - `ReadObject` (`ResultJsonConverterFactory.cs:121-144`) is the shared object walker both converters drive through a [`PropertyReader`](#propertyreader). It requires a `StartObject` token (`ResultJsonConverterFactory.cs:125-126`), returns on `EndObject` (`ResultJsonConverterFactory.cs:130-131`), demands a `PropertyName` token at each step (`ResultJsonConverterFactory.cs:133-134`), advances onto the value and throws on truncation (`ResultJsonConverterFactory.cs:137-138`), invokes the callback (`ResultJsonConverterFactory.cs:140`), and throws `JsonException` if the reader runs out before the closing brace (`ResultJsonConverterFactory.cs:143`). Its `options` parameter is deliberately discarded with `_ = options` (`ResultJsonConverterFactory.cs:123`).
  - `WriteErrors` (`ResultJsonConverterFactory.cs:146-153`) is the shared writer: it returns without writing anything when the result is a success, and otherwise emits the `errors` array through the ambient options.
- **Why it's built this way**: the Result types deliberately keep internal constructors and get-only properties (the construction discipline described under [`Result`](#result)), and the doc comment states the consequence plainly (`ResultJsonConverterFactory.cs:7-14`): default reflection-based deserialization cannot rehydrate them, so a purpose-built factory is what makes the type round-trippable for the distributed query cache. That cache path is real: [`CachingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult) reads and writes whole handler results (a `Result<...>` in practice) through [`ICacheService`](group-09-caching.md#icacheservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:41-46`), and [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) writes and reads those values as UTF-8 JSON via `JsonSerializer` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:155,158`). Centralizing the token bookkeeping in `ReadObject` / `WriteErrors` and the callback shape in [`PropertyReader`](#propertyreader) keeps the two concrete converters small and structurally parallel.
- **Where it's used**: attached to [`Result`](#result) and `Result<T>` by attribute, so System.Text.Json picks it up automatically wherever a result is serialized, most consequentially on the cache path of [Chapter 9](group-09-caching.md) and anywhere a result is written to an HTTP or gRPC payload.
- **Caveats / not-in-source**: the doc comment names Redis specifically (`ResultJsonConverterFactory.cs:11-12`), but the code path is `IDistributedCache`-shaped and [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) documents Redis only as an example backing store (`DistributedCacheService.cs:12`). The converter is backing-store agnostic; which store a given host runs is a composition-time choice, not visible here.

### ResultExtensions
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ResultExtensions.cs:10` · Level 3 · class (static)

- **What it is**: the `Task`-returning counterparts of the [`Result`](#result)`<T>` combinators, so an asynchronous pipeline composes end to end without an intermediate `await` (and its temporary local) between every step.
- **Depends on**: [`Result`](#result) and [`Error`](#error) (Level 1). Externals: `System.Threading.Tasks` (BCL).
- **Concept introduced, lifting combinators over the `Task` boundary.** The instance combinators on `Result<T>` are the right shape only when you already *have* a result. In an async pipeline you usually have a `Task<Result<T>>` instead, and calling `Map` on it does not compile: `Task<Result<T>>` has no `Map`. The two ways out are to `await` into a local at every step, which reintroduces the ladder of temporaries the railway was meant to remove, or to define the same combinators as extension methods **on the task**. This type takes the second route. `[Rubric §15, Best Practices & Code Quality]` (§15 assesses whether the codebase gives callers one consistent way to express a thing rather than two half-shapes) and `[Rubric §1, SOLID]`, in particular open-closed: these arrive as extension methods on a closed type, so the async surface grows without `Result<T>` itself changing.

  The mechanism to internalize is how thin each method is, and why. Each one awaits the incoming task **exactly once**, then delegates to the identical instance combinator (`ResultExtensions.cs:3-9` states this as the design). Nothing about short-circuiting is re-implemented here: a failed result never runs the supplied delegate because the *instance* method it forwards to already guarantees that. Duplicating the short-circuit logic in the extension would have created a second place for it to drift, and the pattern here is the alternative worth copying.
- **Walkthrough**: five extension methods, all `this Task<Result<T>>`, all null-checking both the task and the delegate before awaiting.

  | Member | File:Line | What it forwards to |
  |--------|-----------|---------------------|
  | `BindAsync<T, TOut>(Task<Result<T>>, Func<T, Task<Result<TOut>>>)` | `ResultExtensions.cs:20-29` | `Result<T>.BindAsync` (`Result.cs:289`), awaited |
  | `BindAsync<T, TOut>(Task<Result<T>>, Func<T, Result<TOut>>)` | `ResultExtensions.cs:39-48` | `Result<T>.Bind` (`Result.cs:302`), the synchronous binder overload |
  | `MapAsync<T, TOut>(Task<Result<T>>, Func<T, TOut>)` | `ResultExtensions.cs:58-67` | `Result<T>.Map` (`Result.cs:276`) |
  | `TapAsync<T>(Task<Result<T>>, Func<T, Task>)` | `ResultExtensions.cs:77-91` | no instance equivalent; it inlines the `IsSuccess` check and awaits the async side effect (`ResultExtensions.cs:85-88`) |
  | `MatchAsync<T, TResult>(Task<Result<T>>, Func<T, TResult>, Func<IEnumerable<Error>, TResult>)` | `ResultExtensions.cs:102-113` | `Result<T>.Match` (`Result.cs:260`) |
  - The two `BindAsync` overloads are the reason the chain reads well: one accepts an async binder, the other a synchronous one, so a pipeline can mix "call another service" and "project this in memory" steps without the caller wrapping anything in `Task.FromResult`.
  - `TapAsync` is the one member with no instance twin, because `Result<T>.Tap` takes an `Action<T>` and cannot await. It is the only place in the file that touches `IsSuccess` and `Value` directly (`ResultExtensions.cs:85-87`), and it still returns the awaited result unchanged so it composes like the others.
  - Every `await` in the file uses `ConfigureAwait(false)` (`ResultExtensions.cs:27,28,46,65,84,87,111`), which is the library-wide policy of [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html): framework code must not capture a synchronization context.
- **Why it's built this way**: [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) lists this file as the third tier of the combinator surface, after the non-generic `Result` and the generic `Result<T>`. Making these extension methods rather than members of `Result<T>` is what lets them exist at all: you cannot add an instance method to `Task<T>`, which is a BCL type. It also keeps the core type free of `Task`-shaped members it does not need when a caller is already synchronous.
- **Where it's used**: available to any async pipeline in the Application layer of [Chapter 5](group-05-cqrs-pipeline.md).
- **Caveats / not-in-source**: as with the fluent combinators on [`Result`](#result), the surface exists and is fully unit-tested (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Abstractions/ResultExtensionsTests.cs`), but a search of the workspace finds **no production call site** for `MapAsync`, `TapAsync`, `MatchAsync`, or the task-form `BindAsync` today; the only matches are in that test file. Treat this section as teaching the intended composition style, not describing prevailing application code.


---
[⬅ Index](00-index.md)  •  [Index](00-index.md)  •  [Domain Building Blocks (Entities, Value Objects, Aggregates) ➡](group-02-domain-building-blocks.md)
