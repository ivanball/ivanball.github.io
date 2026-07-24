# 1. Result & Error Handling

This is the first capability chapter, and it is deliberately first because the pattern it teaches
underpins almost every other one in the guide. Before you read a command handler, a domain factory,
a controller action, or a gRPC call in any later chapter, you need the **Result pattern** in your
head: in this codebase, an operation that can fail in an *expected* way does **not** throw, it
**returns** a value that is either a success or a structured failure. The types in this chapter are
that value, the error it carries, the classification that drives HTTP status codes, the collection
envelopes that paged reads come back in, the JSON converter that lets a result survive a round trip
through the distributed cache, and the two narrow exception types reserved for the cases where
returning a value is genuinely impossible. (The primer introduces the idea in
[§2](00-primer.md#2-architectural-styles-this-codebase-commits-to); this chapter is where it becomes
concrete.) This is **[ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)** (the Result pattern): expected failures are transport-agnostic
`Result`/`ErrorType` values, only the edge maps them to HTTP/gRPC, and exceptions are reserved for the
genuinely exceptional.

**Why a return value instead of an exception.** Exceptions are expensive (stack capture and
unwinding), they are invisible in a method's signature, and they conflate *programmer errors* with
*business outcomes*. "This order ID doesn't exist" and "this email is already taken" are not
exceptional, they are routine, expected branches of normal control flow. Modeling them as data lets
the compiler see them (a method that returns [`Result<T>`](#result) advertises that it can fail), lets
them be collected into a list, passed through a pipeline, inspected, and mapped to an HTTP response
**without** any `try/catch`. That decision is the single most pervasive idiom in the two repos:
practically every entity factory method, every CQRS command and query handler, every controller
action, and every service method returns [`Result`](#result) or [`Result<T>`](#result). This touches
`[Rubric §2, Design Patterns]` (which assesses whether patterns are idiomatic and solve real problems
rather than being "pattern theater", here Result is the genuine, codebase-wide error-flow mechanism)
and `[Rubric §9, API & Contract Design]` (which assesses consistent, standardized error responses,
because every failure flows through the same envelope, every endpoint produces the same error shape).

**The three-layer split.** The pattern is intentionally factored into three small, dependency-free
pieces that each do one job, all living in `MMCA.Common.Shared`, the innermost layer that even the
Blazor WebAssembly UI can reference without dragging in EF Core or ASP.NET:

- [`ErrorType`](#errortype) (Level 0) is the **classification axis**, an eight-value enum
  (`Validation`, `Invariant`, `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`,
  `UnprocessableEntity`, `Failure`) where each member's doc comment names the HTTP status it maps to
  (`Validation`/`Invariant`/`Failure` to 400, `NotFound` to 404, `Conflict` to 409, `Unauthorized`
  to 401, `Forbidden` to 403, `UnprocessableEntity` to 422;
  `MMCA.Common.Shared/Abstractions/ErrorType.cs:8-33`). Note that this HTTP-shaped concept lives in
  the domain core as a *pure enum* with no reference to ASP.NET, `[Rubric §3, Clean Architecture]`
  (dependencies point inward; the inner layers stay framework-free), with the actual
  `ErrorType -> status` translation deferred to the API layer.
- [`Error`](#error) (Level 1) is the **carrier**, an immutable positional `record`
  (`MMCA.Common.Shared/Abstractions/Error.cs:15`) with a machine-readable `Code` (e.g.
  `"Order.NotFound"`, for programmatic branching), a human-readable `Message` (for clients), an
  `ErrorType`, and optional `Source`/`Target` context. Eight factory methods (one per `ErrorType`,
  `Error.cs:37-101`) each hard-code the correct type, so a caller can never accidentally pair
  `Error.NotFoundError(...)` with the wrong classification; three pre-built static singletons
  (`Error.NotFound`, `Error.AlreadyDeleted`, `Error.InvalidEntityField`, `Error.cs:23-29`) cover the
  ubiquitous cases without re-allocating, and `WithSource`/`WithTarget` (`Error.cs:106,112`) enrich an
  error via `with`-expression copies.
- [`Result`](#result) (Level 2) is the **outcome envelope**
  (`MMCA.Common.Shared/Abstractions/Result.cs:18`), either a success (no errors) or a failure carrying
  one or more `Error`s. The generic [`Result<T>`](#result) (same file, `Result.cs:119`) adds a `Value`
  on the success path and the functional combinators that make the pattern ergonomic.

**The railway, in one picture.** "Railway-oriented programming" is the mental model: imagine two
parallel tracks, a success track and a failure track. An operation that takes the current result as
input is skipped if the result is already a failure (the train stays on the failure track), and runs
only if it is a success, where it may stay on the success track or switch to failure. Control flows
forward without nested `if (result.IsFailure)` checks. The generic `Result<T>` exposes exactly three
combinators for this, deliberately kept minimal because they cover the three real shapes:
`Match(onSuccess, onFailure)` (`Result.cs:141`) terminates the railway by collapsing both tracks to a
single value (exactly one branch runs); `Map(mapper)` (`Result.cs:157`) transforms the success value
while propagating errors untouched; and `BindAsync(binder)` (`Result.cs:170`) is the **monadic bind**
for async continuations, it short-circuits on failure (returning the original errors without calling
`binder`) and otherwise awaits the next operation, which itself returns a `Result`. The non-generic
base also offers `Result.Combine(params ReadOnlySpan<Result>)` (`Result.cs:87`), the
**aggregate-all-failures** combinator that runs several invariant checks and returns *all* their
errors at once rather than failing on the first, this is the workhorse of domain factory methods
(`Result.Combine(CheckName(name), CheckDate(date), ...)`), and its `ReadOnlySpan` parameter avoids a
heap allocation in the common case.

**A note on construction discipline.** You cannot `new` a `Result<T>` directly, its constructors are
`internal` (`Result.cs:126,130`), so the only way to produce one is through the static factory methods
on the base [`Result`](#result) class (`Success`, `Failure`, `Result.cs:43-78`). This is what
guarantees the invariant the rest of the codebase relies on: a result is *always* either a clean
success or a non-empty failure, never a half-built object (the success path is even served by a single
cached immutable instance, `Result.cs:20,43`, so the common case allocates nothing). Likewise,
[`Error`](#error)'s factory methods are the canonical construction path because they fix the
`Code -> ErrorType` pairing at the call site.

**Making a result survive a round trip.** That same construction discipline creates a problem the
moment a result must be *serialized*: because [`Result<T>`](#result)'s constructors are `internal` and
its properties are get-only, System.Text.Json's default reflection-based deserializer cannot rehydrate
one from JSON. That matters because the CQRS query-caching decorator
([Chapter 5](group-05-cqrs-pipeline.md)/[Chapter 9](group-09-caching.md)) serializes cached handler
results to Redis and reads them back later. [`ResultJsonConverterFactory`](#resultjsonconverterfactory)
(Level 2) is the fix: a `JsonConverterFactory` attached to both `Result` and `Result<T>` via
`[JsonConverter(...)]` (`Result.cs:17,118`) whose `CanConvert` matches the non-generic `Result` and any
closed `Result<T>` (`MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:21-23`) and whose
`CreateConverter` hands back the right per-type converter (`ResultJsonConverterFactory.cs:26-33`). It
writes a compact `{"value": ..., "errors": [...]}` shape and, crucially, reconstructs the object
*through the public factory methods* (`Result.Success`/`Result.Failure`,
`ResultJsonConverterFactory.cs:49,77`), so a round-tripped result still obeys the same
success-or-non-empty-failure invariant a freshly built one does. [`ResultConverter`](#resultconverter)
(Level 2, `ResultJsonConverterFactory.cs:35`) is the concrete `JsonConverter<Result>` for the
non-generic case (a generic `ResultConverter<T>` sibling handles the typed case), and both lean on one
small private helper, the [`PropertyReader`](#propertyreader) (Level 0) delegate
(`ResultJsonConverterFactory.cs:95`), a `ref Utf8JsonReader` callback that the shared `ReadObject`
walker invokes once per JSON property so the value- and error-reading logic is written once and reused
by both converters. This is quiet `[Rubric §12, Performance & Scalability]` plumbing: without it the
distributed result cache could not exist, and with it the cache stores nothing but the framework's own
canonical wire shape.

**How a failure becomes an HTTP response (the end-to-end flow).** Follow a typical write through the
layers. A domain factory or aggregate method validates its inputs and returns
`Result.Combine(...)`; a command handler in the application layer chains follow-on work with
`BindAsync`/`Map`, so any failure short-circuits the rest of the slice; the controller receives the
`Result<T>` and, on failure, hands it to `ApiControllerBase.HandleFailure`
([`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) in the API chapter), which
reads the **first** error's [`ErrorType`](#errortype) and maps it, via
[`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping)'s `FrozenDictionary`, to the
right status code, then renders an **RFC 9457 Problem Details** body. The same `Result` failure can
also cross a service boundary: on the gRPC boundary,
[`ResultGrpcExtensions`](group-13-grpc-contracts.md#resultgrpcextensions) turns a failure into an
`RpcException` carrying the errors over the wire ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)), and the typed client turns it back into a
`Result` on the far side, so a remote call looks like a local one to application code. Because the
whole journey is driven by the same eight-member enum, the HTTP and gRPC error shapes are uniform
across every endpoint and every extracted service, there is one source of truth for "what does a
not-found look like."

**The two exceptions, and why they exist anyway.** A return-value pattern still needs a fallback for
the places where you genuinely cannot return one. [`DomainException`](#domainexception) (Level 0,
`MMCA.Common.Shared/Exceptions/DomainException.cs:9`) is the abstract base for domain-layer
exceptions, and [`DomainInvariantViolationException`](#domaininvariantviolationexception)
(Level 1, `MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9`) is its one concrete
subclass. The doc comments are emphatic that these are a *last resort*: prefer `Result` with
`Error.Invariant` for normal business-rule violations, and reserve the exception for contexts where
the `Result` pattern is structurally unavailable, most notably inside aggregate constructors invoked
by **EF Core materialization** (`DomainInvariantViolationException.cs:4-7`), where the call stack is
framework-owned and there is no `Result` channel to return through. When one of these does escape, the
API layer's `DomainExceptionHandler` middleware
([`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler)) catches it and
converts it to the same Problem Details shape (`DomainException.cs:6-7`), so even the exceptional path
lands on a consistent contract. This is the considered version of `[Rubric §2, Design Patterns]`:
exceptions are for the truly exceptional (programming errors, corrupted persistent state), not for
control flow.

**Paged and collection reads ride the same rails.** The read side needs an envelope too. A query that
returns a list wraps it in [`CollectionResult<T>`](#collectionresultt) (Level 0), a thin
`[DataContract]` record (`MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:64`) with a single
required `Items` property whose constructor normalizes any `IReadOnlyCollection<T>` into a list
(`PaginationMetadata.cs:74-78`). When the read is paged,
[`PagedCollectionResult<T>`](#pagedcollectionresultt) (Level 1, `PaginationMetadata.cs:91`) extends
that base with one extra required property, [`PaginationMetadata`](#paginationmetadata) (Level 0,
`PaginationMetadata.cs:12`), the server-side paging state (`TotalItemCount`, `PageSize`,
`CurrentPage`) plus computed, non-serialized derivations (`TotalPageCount`, `FirstRowOnPage`,
`LastRowOnPage`, `PaginationMetadata.cs:45-55`, each marked `[IgnoreDataMember]`). The
`[DataMember(Order = ...)]` annotations fix a deterministic wire order so `PaginationMetadata` always
serializes after `Items` (`PaginationMetadata.cs:81,110`). These envelopes are not part of the
success/failure machinery themselves, a paged query handler returns
`Result<PagedCollectionResult<T>>`, composing the two ideas, but they belong in this chapter because
they are the canonical *shapes* that successful reads return, the read-side counterpart to the
`Result` that every write returns. This touches `[Rubric §9, API & Contract Design]` (stable,
right-sized response contracts) and `[Rubric §12, Performance & Scalability]` (paging large result
sets so a query never pulls an unbounded list).

**Where this leads.** With these eleven types you have the full error-and-result vocabulary the rest
of the guide assumes. You will see [`Result`](#result) returned by the domain building blocks of
[Chapter 2](group-02-domain-building-blocks.md) (factory methods that refuse to construct an invalid
entity), threaded through the CQRS decorator pipeline of
[Chapter 5](group-05-cqrs-pipeline.md) (where a `Result.Failure` deliberately commits the transaction
but skips cache invalidation), cached across a Redis round trip by that same pipeline
([Chapter 9](group-09-caching.md)), and unwrapped at the edges by the API and gRPC layers
([Chapter 12](group-12-api-hosting-mapping.md), [Chapter 13](group-13-grpc-contracts.md)). Read this
chapter's type sections next; everything after them takes the railway for granted.

### CollectionResult<T>
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:64` · Level 0 · record

- **What it is**: a thin envelope wrapping a collection of items for API responses; the base type for the paged variant.
- **Depends on**: nothing first-party. (Lives in the same file as [`PaginationMetadata`](#paginationmetadata) and [`PagedCollectionResult<T>`](#pagedcollectionresultt).)
- **Concept introduced, the collection envelope.** Returning a *named wrapper* (`{ items: [...] }`) instead of a bare JSON array is a small but deliberate `[Rubric §9, API & Contract Design]` choice (§9 assesses consistent, evolvable response contracts): a wrapper leaves room to add metadata, like pagination, without a breaking change to the response shape, which a top-level array would force.
- **Walkthrough**
  - One property: `required ICollection<T> Items { get; init; }` (`PaginationMetadata.cs:82`). The `required` keyword forces callers to set it (so `Items` is never null); both constructors are marked `[SetsRequiredMembers]` (lines 67, 73) to satisfy that requirement when constructed directly.
  - The data constructor (lines 74-78) null-checks input via `ArgumentNullException.ThrowIfNull` and normalizes to a `List<T>`, reusing the list if the input already is one, a small allocation optimization for the common case.
  - `[DataContract]` on the type and `[DataMember(Order = 1)]` on `Items` (lines 63, 81) pin the wire shape, matching [`PaginationMetadata`](#paginationmetadata)'s serialization discipline.
- **Why it's built this way**: `required` + `init` gives "set once, never null" semantics without a hand-written constructor guard for the common path, while the explicit `[DataContract]` keeps the serialized shape stable.
- **Where it's used**: base of [`PagedCollectionResult<T>`](#pagedcollectionresultt) (Level 1); returned by non-paged collection endpoints across both apps.

### DomainException
> MMCA.Common.Shared · `MMCA.Common.Shared.Exceptions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainException.cs:9` · Level 0 · class (abstract)

- **What it is**: the abstract base for domain-layer exceptions.
- **Depends on**: `System.Exception` (BCL) only.
- **Concept introduced, exceptions reserved for the truly exceptional.** `[Rubric §2, Design Patterns]` (§2 assesses whether patterns are idiomatic and solve real problems; a classic red flag is *exceptions used for control flow where a Result is the convention*). The doc comment (`DomainException.cs:3-8`) is explicit: prefer the [`Result`](#result) pattern for *expected* error paths; reserve exceptions for programming errors / corrupted state. So this type exists, but it is the **exception** (pun intended) to the rule, its concrete subclasses are caught by `DomainExceptionHandler` middleware (API layer) and converted to RFC 9457 Problem Details responses.
- **Walkthrough**: three `protected` constructors (parameterless, message, message+inner, `DomainException.cs:12-23`), the standard exception constructor set. `abstract` so you must derive a specific exception rather than throwing the base directly.
- **Why it's built this way**: a single domain-exception root lets the middleware catch "domain exceptions" as a *category* and map them consistently, while the Result pattern handles the common case. It keeps the abstraction pure: `DomainException` lives in `Shared` with no HTTP coupling; the status mapping happens later in the API layer.
- **Where it's used**: base of [`DomainInvariantViolationException`](#domaininvariantviolationexception) (Level 1); caught by `DomainExceptionHandler` API middleware.

### ErrorType
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorType.cs:8` · Level 0 · enum

- **What it is**: an enum that classifies every domain error into one of eight categories, each of which maps to an HTTP status code at the API boundary.
- **Depends on**: nothing first-party (BCL only). It is the seed of the Result-pattern family: [`Error`](#error) (Level 1) carries an `ErrorType`, and [`Result`](#result) (Level 2) carries `Error`s.
- **Concept introduced, the Result pattern.** `[Rubric §2, Design Patterns]` (§2 assesses whether patterns are idiomatic and solve real problems, not "pattern theater"; here the **Result** pattern is the codebase's canonical error-flow mechanism). Instead of throwing exceptions for *expected* failures (validation, not-found, conflict), operations return a [`Result`](#result) that is either success or a failure carrying one or more [`Error`](#error)s. `ErrorType` is the classification axis of that pattern. This also touches `[Rubric §9, API & Contract Design]` (assesses consistent, standardized error responses): the enum's doc comment (`ErrorType.cs:4-7`) states the **first** error in a result determines the response status, and `ApiControllerBase` maps each `ErrorType` to a status code via a `FrozenDictionary`, so error shapes are uniform across every endpoint. And `[Rubric §3, Clean Architecture]` (dependencies point inward; the domain is framework-free): note this HTTP-shaped concept lives in `Shared` as a *pure enum* with **no** reference to ASP.NET, the HTTP mapping happens later, in the API layer. The Result pattern is the single most pervasive idiom in the codebase (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: eight members, each documented with its target status (`ErrorType.cs:11-32`): `Validation` (400), `Invariant` (400, a broken business rule), `NotFound` (404), `Conflict` (409, e.g. duplicate or already-deleted), `Unauthorized` (401), `Forbidden` (403), `UnprocessableEntity` (422, e.g. an attempt to change an immutable field), and `Failure` (400, the catch-all). The values are not given explicit numbers, ordinal order is irrelevant because the HTTP mapping is keyed by name, not by integer value.
- **Why it's built this way**: separating *classification* (this enum) from *carrier* ([`Error`](#error)) from *outcome* ([`Result`](#result)) keeps each piece tiny and lets the same eight categories drive both domain logic and HTTP translation from one source of truth.
- **Where it's used**: pervasively: [`Error`](#error)'s factory methods each hard-code the correct `ErrorType`; `ApiControllerBase.HandleFailure` (API layer) switches on it; `ErrorHttpMapping` holds the `ErrorType → status` table.
- **Caveats / not-in-source**: the exact `ErrorType → status` table lives in `ApiControllerBase` / `ErrorHttpMapping` (a higher tier, group G12); only the *intent* is documented here.

### PaginationMetadata
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:12` · Level 0 · record (sealed)

- **What it is**: an immutable record carrying server-side pagination state (total items, page size, current page) with three derived, non-serialized convenience properties.
- **Depends on**: nothing first-party. (Lives in the same file as [`CollectionResult<T>`](#collectionresultt) and [`PagedCollectionResult<T>`](#pagedcollectionresultt).)
- **Concept introduced, server-side pagination + the `[DataContract]` serialization contract.** `[Rubric §9, API & Contract Design]` (uniform pagination/filtering conventions) and `[Rubric §12, Performance & Scalability]` (assesses query efficiency and **paginating large result sets** rather than returning whole tables). Carrying explicit pagination metadata is what lets the API page at the database and tell the client how to navigate.
- **Walkthrough**
  - Two constructors: a parameterless one delegating to the main ctor with zeros (`PaginationMetadata.cs:15-16`), and the main ctor (lines 22-31) which guards every argument with `ArgumentOutOfRangeException.ThrowIfNegative`, invalid pagination can't be represented.
  - Three stored values: `TotalItemCount`, `PageSize`, `CurrentPage`, all `init` and tagged `[DataMember(Order = …)]` (lines 34-43) for deterministic serialization order.
  - Three computed properties tagged `[IgnoreDataMember]` so they're *not* serialized (they're derivable): `TotalPageCount` (ceiling division, line 47), `FirstRowOnPage` (line 51), and `LastRowOnPage` (clamped to the total, line 55). Note the `(long)` casts in the row math, a deliberate guard against `int` overflow on large datasets.
- **Why it's built this way**: `[DataContract]`/`[DataMember]`/`[IgnoreDataMember]` make the wire shape explicit and stable (only the three core values travel; the rest are recomputed client-side), which is exactly the "stable, evolvable contract" §9 asks for. Validation in the constructor means an invalid instance is unconstructable, a recurring theme (compare value-object factories in group G02).
- **Where it's used**: embedded in [`PagedCollectionResult<T>`](#pagedcollectionresultt) (Level 1) and returned by paged query endpoints throughout both apps.

### PropertyReader
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:95` · Level 0 · delegate

- **What it is**: a small private delegate that [`ResultJsonConverterFactory`](#resultjsonconverterfactory) uses internally to hand each property of a `Result` JSON payload to a per-converter callback while one shared object-walker drives the reader.
- **Depends on**: `System.Text.Json.Utf8JsonReader` (BCL, passed by `ref`).
- **Concept, a `ref struct`-friendly callback shape.** `[Rubric §15, Best Practices & Code Quality]` (assesses DRY, no duplicated parsing loop). The two nested converters ([`ResultConverter`](#resultconverter) and its generic sibling) differ only in *which* JSON properties they care about, so the property loop is factored out into `ReadObject`, and this delegate is how `ReadObject` calls back into each converter. Because `Utf8JsonReader` is a `ref struct` (it cannot be captured by an ordinary `Func<>`), the delegate takes the reader by `ref` (`ResultJsonConverterFactory.cs:95`) so the callback advances the same reader instance.
- **Walkthrough**: a one-line declaration (`ResultJsonConverterFactory.cs:95`): `void (ref Utf8JsonReader reader, string propertyName)`. `ReadObject` (line 98) positions the reader on each property value and then invokes a `PropertyReader` once per property (line 117).
- **Why it's built this way**: keeping the token-stream bookkeeping (StartObject check, EndObject termination, truncation guards) in one `ReadObject` method and passing the "what to do with this property" logic as a delegate avoids copy-pasting the JSON walk into both converters.
- **Where it's used**: consumed only inside [`ResultJsonConverterFactory`](#resultjsonconverterfactory); `ResultConverter.Read` (line 41) and `ResultConverter<T>.Read` (line 67) each pass a lambda of this shape.
- **Caveats / not-in-source**: it is `private`, so it is not part of any public API; it exists purely to support the converter factory.

### DomainInvariantViolationException
> MMCA.Common.Shared · `MMCA.Common.Shared.Exceptions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9` · Level 1 · class

- **What it is**: the concrete exception thrown when a domain invariant is violated in a context where the [`Result`](#result) pattern cannot be used (e.g. inside aggregate constructors called by EF Core materialization, where the call stack is framework-owned and returning a `Result` is impossible).
- **Depends on**: [`DomainException`](#domainexception) (Level 0).
- **Concept**: this is the safety valve the doc comment (`DomainInvariantViolationException.cs:3-8`) spells out explicitly: "prefer returning `Result` with `Error.Invariant` for normal business rule violations". `[Rubric §2, Design Patterns]` (§2 flags exceptions used as control flow; this type is the sanctioned last resort, not the default path). `DomainExceptionHandler` middleware (API layer, group G12) catches any [`DomainException`](#domainexception) and maps it to HTTP 400 + ProblemDetails.
- **Walkthrough**: three standard **`public`** constructors delegating to [`DomainException`](#domainexception) (`DomainInvariantViolationException.cs:12-24`): parameterless, message, and message+inner. The class is `public` and **not `sealed`**, consumers can subclass it if they need more specific exception types.
- **Where it's used**: thrown inside aggregate factory methods or invariant-check helpers (group G02) where a broken invariant indicates corrupted persistent state rather than a recoverable user error.
- **Caveats / not-in-source**: earlier editions of this guide tagged the class `sealed` and its constructors `protected`; the current source (lines 9, 12-24) shows neither, the class is a non-sealed `public` type with three `public` constructors. Trust the source.

### Error
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:15` · Level 1 · record

- **What it is**: the immutable error value carried by [`Result`](#result). Every error has a machine-readable `Code`, a human-readable `Message`, an [`ErrorType`](#errortype) that maps to an HTTP status code, and optional `Source` / `Target` metadata.
- **Depends on**: [`ErrorType`](#errortype) (Level 0).
- **Concept introduced, the Error carrier.** `[Rubric §2, Design Patterns]` (assesses idiomatic patterns that solve real problems): an `Error` is a **value**, not an exception. It can be created, stored in a list, passed through a pipeline, and inspected without stack-unwinding cost. `[Rubric §9, API & Contract Design]` (assesses consistent, standardized error responses): the combination of `Code` (machine-readable, for programmatic branching) + `Message` (human-readable, for clients) + [`ErrorType`](#errortype) (HTTP status selector) gives every API endpoint a uniform error shape without any controller having to decide how to format errors.
- **Walkthrough**
  - The type is a positional `record` (`Error.cs:15-20`): `Code`, `Message`, `Type`, `Source?`, `Target?`. Records give value equality, two `Error` instances with the same fields are equal.
  - Three **pre-built `static readonly` singletons** (`Error.cs:23-29`) for the most common cases: `Error.NotFound`, `Error.AlreadyDeleted`, `Error.InvalidEntityField`. These avoid repeated `new Error(...)` call sites for the ubiquitous cases.
  - **Eight factory methods**, one per [`ErrorType`](#errortype) (`Error.cs:37-101`): `Validation`, `Invariant`, `NotFoundError`, `Conflict`, `Unauthorized`, `Forbidden`, `UnprocessableEntity`, `Failure`. Each constructs an `Error` with the correct `ErrorType` pre-set, callers can't accidentally mismatch the factory and the type. The naming convention is deliberate: `Validation(code, message)` reads naturally at the call site. (Note the one renamed factory: the `NotFound` *static field* and the `NotFoundError` *factory method* differ because C# forbids a method and field sharing a name.)
  - Two **`with`-expression helpers** (`Error.cs:106-113`): `WithSource(string)` and `WithTarget(string)` return a new record copy with one field replaced, useful for enriching a library-level error with caller context without mutating it. Records make this a one-liner: `this with { Source = source }`.
- **Why it's built this way**: keeping `Error` as an immutable value (not an exception) aligns with the Result pattern's goal: represent *expected* failures as data, not as control flow. Pre-built singletons avoid allocations on hot paths. Factory methods enforce the `Code → ErrorType` pairing at the source so no mapping table is needed elsewhere.
- **Where it's used**: every command/query handler returns [`Result<T>`](#result) carrying zero or more `Error` values; `ApiControllerBase.HandleFailure` inspects the first error's `Type` to pick the HTTP status (the `ErrorType → status` mapping lives there, not here); `ValidationFailureExtensions` (group G06) converts FluentValidation failures to `Error.Validation(...)` instances. Also serialized on the wire by [`ResultJsonConverterFactory`](#resultjsonconverterfactory) as the `errors` array.

### PagedCollectionResult<T>
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:91` · Level 1 · record (sealed)

- **What it is**: a [`CollectionResult<T>`](#collectionresultt) augmented with a [`PaginationMetadata`](#paginationmetadata) property, the standard shape for paged API responses.
- **Depends on**: [`CollectionResult<T>`](#collectionresultt) (Level 0), [`PaginationMetadata`](#paginationmetadata) (Level 0).
- **Concept**: same envelope pattern as [`CollectionResult<T>`](#collectionresultt) but extended with pagination metadata in a single, orthogonal step. `[Rubric §12, Performance & Scalability]` (paging large result sets) and `[Rubric §9, API & Contract Design]` (stable, evolvable contract). The `sealed record` inherits `CollectionResult<T>` and adds one required `PaginationMetadata` property; the `[DataContract]` / `[DataMember(Order = 2)]` on it (lines 90, 110-111) ensures pagination state serializes *after* `Items` in a deterministic wire order.
- **Walkthrough**: two constructors mirroring the base: a parameterless one producing an empty result with default metadata (lines 95-96) and a data constructor (lines 102-107) that calls `base(items)` and null-checks `paginationMetadata` via `ArgumentNullException.ThrowIfNull`. Both are `[SetsRequiredMembers]` (lines 94, 101). The `required` modifier on `PaginationMetadata` (line 111) forces it to be set at construction so it's never null at runtime.
- **Where it's used**: returned by every paged query handler (e.g. `GetCategories`, `GetSessions` in ADC); the entity query service (group G03) always wraps its paged results in this type.

### Result
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:18` · Level 2 · class

- **What it is**: the non-generic **railway-oriented result type**: either a success (no errors) or a failure carrying one or more [`Error`](#error) instances. The non-generic form is used for void-equivalent operations (invariant checks, deletes, commands with no return value). The generic `Result<T>` (same file, line 119) carries a value on success.
- **Depends on**: [`Error`](#error) (Level 1); [`ResultJsonConverterFactory`](#resultjsonconverterfactory) (attached to both `Result` and `Result<T>` via `[JsonConverter]`, `Result.cs:17,118`); `System.Collections.Generic` (BCL).
- **Concept introduced, railway-oriented programming and `Result` combinators.** `[Rubric §2, Design Patterns]` (assesses idiomatic, problem-solving patterns; the Result pattern is the codebase's canonical error-flow mechanism, not an exception crutch). `[Rubric §9, API & Contract Design]` (consistent, structured error shapes at every endpoint). `[Rubric §12, Performance & Scalability]` shows up in the deliberate allocation-avoidance choices called out below.

  The **railway metaphor**: picture two tracks, a success track and a failure track. Each operation takes the current result as input. If it is already a failure the operation is skipped; if it is a success the operation runs and may produce a new success *or* switch to the failure track. Control flows forward without `try/catch` nesting. [`ErrorType`](#errortype) (Level 0) classifies the failure; [`Error`](#error) (Level 1) carries the coded message; `Result` is the *outcome envelope*. Together they are the three-layer split introduced with [`ErrorType`](#errortype).

  The non-generic `Result`:
  - A shared success instance `CachedSuccess` (line 20) and an empty `NoErrors` array (line 21) back the two cheapest paths. Errors live in a **lazily-allocated** `List<Error>? _errors` (line 25): as the field comment notes (lines 23-24), the success path (the overwhelming majority of results created per request) never pays for a list allocation.
  - `Errors` exposes the list as `IReadOnlyList<Error>`, falling back to the shared `NoErrors` array when the field is null (line 28); `IsSuccess` is `_errors is null || _errors.Count == 0` (line 31) and `IsFailure` is its negation (line 34).
  - **`Result.Success()`** (line 43) returns the shared `CachedSuccess` singleton (success results carry no per-instance state); **`Result.Success<T>(value)`** (line 49) wraps a value in a new `Result<T>`.
  - **`Result.Failure(Error)`** (line 70) and **`Result.Failure(IEnumerable<Error>)`** (line 60), plus their `<T>` overloads (lines 55, 77), are the failure factories.
  - **`Result.Combine(params ReadOnlySpan<Result> results)`** (line 87), the **aggregate-all-failures** combinator: runs every check, collects *all* errors into one failure, and returns success only when *all* inputs succeed. The `ReadOnlySpan<Result>` parameter avoids a heap allocation at the common call site, and the `allErrors` list is lazily allocated only when a failure is actually seen (line 100). The guard at lines 89-91 throws `ArgumentException` for an empty span (combining nothing is a logic bug). Called constantly in entity factory methods: `Result.Combine(CheckName(name), CheckDate(date), …)`.

  The generic `Result<T>` (line 119):
  - `sealed class` inheriting `Result`, adds `T? Value` (line 122), `null` when `IsFailure`.
  - Two `internal` constructors (lines 126, 130) so only the base-class factory methods can produce instances, consumers can never directly `new Result<Order>(…)`.
  - **`Match<TResult>(onSuccess, onFailure)`** (line 141), exhaustive pattern match; exactly one branch runs (both delegates null-checked, lines 143-144). Avoids `if (result.IsFailure)` everywhere: `return result.Match(v => Ok(v), errs => Failure(errs))`.
  - **`Map<TOut>(mapper)`** (line 157), transforms the success value, propagating errors unchanged. Allows pipelining: `result.Map(order => order.ToDto())` stays on the success track without an `if` check.
  - **`BindAsync<TOut>(binder)`** (line 170), **monadic bind** for async continuations. If the current result is a failure it short-circuits and returns the original errors without calling `binder`; otherwise it awaits the next async operation (which itself returns `Result<TOut>`), with `ConfigureAwait(false)`. This is the core of async railway chains: `await result.BindAsync(order => PlaceOrderAsync(order))`.
- **Why it's built this way**: see [`ErrorType`](#errortype) for the broader rationale. The three-method combinator set (`Match`/`Map`/`BindAsync`) was deliberately kept minimal: they cover the three real usage shapes (terminate, transform, chain). `Combine` solves the aggregate-validation problem cleanly without forcing callers to interleave checks. Keeping the value-bearing constructors `internal` channels every construction through the static factories, so the success/failure invariant (a `Result<T>` with a value is never also a failure) holds by construction. The shared `CachedSuccess`/`NoErrors` instances and the lazily-allocated error list keep the overwhelmingly-common success path allocation-free.
- **Where it's used**: pervasively: every entity factory method (group G02), every command/query handler (group G05), every controller action (group G12), and every UI service method in both apps returns `Result` or `Result<T>`. It is made round-trippable over the wire and through the distributed cache by [`ResultJsonConverterFactory`](#resultjsonconverterfactory). Rubric categories `§2`, `§4`, `§9` all touch it across higher groups.

### ResultConverter
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:35` · Level 2 · class (private sealed, nested)

- **What it is**: the private nested `System.Text.Json` converter for the non-generic [`Result`](#result). A structurally identical generic sibling, `ResultConverter<T>` (`ResultJsonConverterFactory.cs:60`), handles [`Result<T>`](#result) and additionally round-trips the success `Value`.
- **Depends on**: [`Result`](#result), [`Error`](#error), the outer [`ResultJsonConverterFactory`](#resultjsonconverterfactory) (which owns, creates, and supplies the shared helpers), [`PropertyReader`](#propertyreader); BCL `System.Text.Json`.
- **Concept introduced, custom JSON round-tripping of factory-constructed types.** `[Rubric §12, Performance & Scalability]` (the distributed query cache serializes cached handler results to Redis, so `Result` must be reconstructable) and `[Rubric §9, API & Contract Design]` (a stable, compact wire shape for results). Because `Result`/`Result<T>` keep `internal` constructors and get-only properties (see [`Result`](#result)), default reflection-based deserialization cannot rebuild them; this converter reads the compact `{"value": ..., "errors": [...]}` shape and reconstructs through the **public factory methods**, preserving the success/failure invariant that direct field-setting would bypass.
- **Walkthrough**
  - `Read` (line 37): declares `List<Error>? errors`, then calls the shared `ReadObject` with a [`PropertyReader`](#propertyreader) lambda that deserializes the `errors` array on a case-insensitive property match (line 43) and skips every other property (line 46). It returns `Result.Failure(errors)` when any errors were present, else `Result.Success()` (line 49).
  - `Write` (line 52): opens a JSON object and delegates to the shared `WriteErrors` helper (line 55), which emits the `errors` array only for a failure (lines 123-129).
  - The generic `ResultConverter<T>` (line 60) mirrors this but also handles the `value` property: `Read` (line 62) captures `value` and reconstructs via `Result.Success(value!)` / `Result.Failure<T>(errors)` (line 77); `Write` (line 80) writes `value` only when the result `IsSuccess` (lines 84-88).
- **Why it's built this way**: reconstructing through `Result.Failure`/`Result.Success` rather than setting fields keeps a deserialized result honest (a value only on success, errors only on failure). Writing `value` only on success and `errors` only on failure keeps the payload minimal. Nesting the converter privately inside the factory keeps it an implementation detail no consumer needs to reference.
- **Where it's used**: instantiated by [`ResultJsonConverterFactory.CreateConverter`](#resultjsonconverterfactory) (lines 28-32); never referenced directly by application code.

### ResultJsonConverterFactory
> MMCA.Common.Shared · `MMCA.Common.Shared.Serialization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15` · Level 2 · class (sealed)

- **What it is**: a `JsonConverterFactory` that produces the correct converter for [`Result`](#result) or any closed [`Result<T>`](#result); it is wired onto both types by the `[JsonConverter(typeof(ResultJsonConverterFactory))]` attribute (`Result.cs:17,118`).
- **Depends on**: [`Result`](#result), [`ResultConverter`](#resultconverter) (and its generic sibling), [`PropertyReader`](#propertyreader); BCL `System.Text.Json` (`JsonConverterFactory`, `Utf8JsonReader`, `Activator`).
- **Concept introduced, the STJ converter-factory for an open generic.** `[Rubric §12, Performance & Scalability]` and `[Rubric §9, API & Contract Design]`. The doc comment (`ResultJsonConverterFactory.cs:7-14`) states the rationale plainly: the Result types deliberately keep internal constructors and get-only properties, so a single factory keyed on the open generic makes every `Result<AnyT>` round-trippable (as required by the Redis-backed distributed query cache) without registering one converter per `T`.
- **Walkthrough**
  - Two private constants `ValuePropertyName = "value"` and `ErrorsPropertyName = "errors"` (lines 17-18) define the wire shape used by both converters.
  - `CanConvert` (line 21): returns true for `typeof(Result)` or any generic type whose definition is `Result<>`.
  - `CreateConverter` (line 26): returns a [`ResultConverter`](#resultconverter) for the non-generic case (line 29); otherwise it reflects the value type and constructs `ResultConverter<T>` via `Activator.CreateInstance(typeof(ResultConverter<>).MakeGenericType(valueType))` (lines 31-32).
  - `ReadObject` (line 98): the shared object-walker that drives a [`PropertyReader`](#propertyreader). It requires a `StartObject` token (lines 102-103), returns on `EndObject` (lines 107-108), positions the reader on each property value, and throws `JsonException` on a malformed or truncated payload (lines 110-120).
  - `WriteErrors` (line 123): the shared writer that emits the `errors` array only when the result is a failure.
- **Why it's built this way**: one factory keyed on the open generic covers `Result<AnyT>` with no per-`T` registration; centralizing the token bookkeeping in `ReadObject`/`WriteErrors` and the callback shape in [`PropertyReader`](#propertyreader) keeps the two concrete converters tiny and identical in structure.
- **Where it's used**: attached to [`Result`](#result) and [`Result<T>`](#result) via the type-level `[JsonConverter]` attribute; `System.Text.Json` invokes it automatically wherever a `Result` is (de)serialized, most notably on the distributed-cache serialization path.


---
[⬅ Index](00-index.md)  •  [Index](00-index.md)  •  [Domain Building Blocks (Entities, Value Objects, Aggregates) ➡](group-02-domain-building-blocks.md)
