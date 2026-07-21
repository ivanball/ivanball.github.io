# 3. Querying: Specifications, Filtering & the Entity Query Service

Every read endpoint in MMCA.Common and ADC, "list me the published events", "get session 42", "the speakers in Atlanta, page 3, sorted by name, with only the `name` and `bio` fields", flows through **one** reusable read engine. This chapter is the *read side* of CQRS (the [primer's §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) introduced the command/query split): side-effect-free queries that turn HTTP query-string knobs into translated-to-SQL `WHERE`/`ORDER BY`/`OFFSET`/`SELECT` clauses, run them once, and shape the rows down to exactly the fields the caller asked for. No per-entity repository method, no hand-rolled `IQueryable` plumbing in each controller. Add a new entity and it inherits filtering, sorting, paging, sparse-fieldset projection, and eager-loading of navigations *for free*. This whole read contract, the generic resource surface, OData-lite dynamic filtering, sparse fieldsets, per-type filter strategies, sort, pagination plus the `X-Pagination` header, the `MaxUnboundedResultLimit` ceiling, and the two-path include strategy, is recorded as a deliberate trade-off in ADR-034 (generic entity query layer), which also spells out how it composes with manual DTO mapping (ADR-001), navigation populators (ADR-002), the Result pattern at the edge (ADR-013), and request idempotency on the generic create (ADR-017).

There are three cooperating sub-systems here, and it helps to hold them apart from the start. **The Specification pattern** (Domain layer) is the *type-safe, programmer-authored* predicate, a compiled `Expression<Func<TEntity, bool>>` that usually carries an **authorization or business scope** the caller must not be able to override (e.g. "only sessions belonging to *this* speaker"). **Dynamic filtering/sorting/field-selection** (Application layer) is the *string-driven, user-authored* shaping, the `?filter=…&sort=…&fields=…` querystring, untrusted input that must be validated against the entity's real properties before it touches the database. **The entity query pipeline + query service** (Application layer) is the orchestrator that composes both, decides how to load navigations given the data source's JOIN capabilities, runs the query, and packages the result with pagination metadata. The separation matters: specifications are *trusted* and live with the domain; dynamic filters are *untrusted* and are validated, capped, and reflection-cached at the application boundary.

**The Specification pattern (the trusted predicate).** [`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype) exposes two faces of the same rule: a `Criteria` expression tree that **EF Core translates to SQL** (so the filter runs *in the database*, not in memory after a full-table load) and an `IsSatisfiedBy(entity)` predicate for **in-memory** evaluation. The abstract base [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) lazy-compiles the expression once and caches the delegate, so repeated in-memory checks don't recompile the tree. The three combinators, [`AndSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype), [`OrSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#orspecificationtentity-tidentifiertype), and [`NotSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#notspecificationtentity-tidentifiertype), compose two (or one) specifications into a new one using `Expression.AndAlso`/`OrElse`/`Not` over a *shared* parameter, deliberately rebuilding the lambda so the combined `Criteria` **stays EF-translatable** rather than degrading to client-side evaluation. ADC's own concrete specifications (e.g. `PublishedEventSpecification`, `OwnSessionQuestionAnswerSpecification` in the Conference module) are how a controller scopes a query to the current user's data without trusting the request to do it. This is `[Rubric §4, DDD]` (the rule lives in the domain as a first-class, reusable, composable object) and `[Rubric §2, Design Patterns]` (a textbook Specification, with `[Rubric §11, Security]` overtones: authorization predicates are server-supplied criteria the client cannot tamper with). Two newer members round out the family for **polyglot persistence** (ADR-018). [`InlineSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#inlinespecificationtentity-tidentifiertype) wraps an already-composed `Criteria` expression as a first-class specification, and the static [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) builds a *cross-source* filter: when a dependent entity (say a Cosmos-stored `Session`) references a principal in a different physical data source (a SQL-Server `Event`), a navigating predicate like `s => s.Event.IsPublished` cannot be translated, so it resolves the matching principal keys first and filters by `foreignKey IN (...)` instead. That "resolve-then-filter-by-FK" shape is guarded by an opt-in fitness rule ([G25](group-27-testing-infrastructure.md#specificationconventiontestsbase)).

**Dynamic filtering, Strategy-per-type.** User filters arrive as a `Dictionary<string, (string Operator, string Value)>`, property name → operator key + raw string value, parsed from the querystring by the [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) at the API edge. Translating `("Name", "CONTAINS", "blazor")` into a `.Where()` clause depends entirely on the property's CLR type: strings support `CONTAINS`/`STARTS WITH`; numbers and dates support `GT`/`LT`/range operators; bools and Guids support equality. Rather than one giant `switch(type)`, each type gets a dedicated [`IFilterStrategy`](group-03-querying-specifications.md#ifilterstrategy), [`StringFilterStrategy`](group-03-querying-specifications.md#stringfilterstrategy), [`IntFilterStrategy`](group-03-querying-specifications.md#intfilterstrategy), [`DecimalFilterStrategy`](group-03-querying-specifications.md#decimalfilterstrategy), [`DateTimeFilterStrategy`](group-03-querying-specifications.md#datetimefilterstrategy), [`BoolFilterStrategy`](group-03-querying-specifications.md#boolfilterstrategy), and [`GuidFilterStrategy`](group-03-querying-specifications.md#guidfilterstrategy), each declaring the operator set it supports and building expressions via **System.Linq.Dynamic.Core** (string-based LINQ, the [primer's external](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0) for dynamic `OrderBy`/`Where`). The static [`QueryFilterService`](group-03-querying-specifications.md#queryfilterservice) is the registry-and-dispatcher: it holds a `ConcurrentDictionary<Type, IFilterStrategy>` seeded with the built-ins, exposes `RegisterStrategy` so a module can add a custom type without modifying the framework (`[Rubric §1, SOLID]`, the open/closed principle made literal), caches `PropertyInfo` lookups per `(entity, property)` to dodge per-request reflection, and routes nested paths like `"Category.Name"` through the string strategy. Crucially it has **two phases**: `ValidateFilters` (does the property exist on the entity? is the operator supported for its type?) runs *before* the query, returning a [`Result`](group-01-result-error-handling.md#result) of [`Error`](group-01-result-error-handling.md#error)s, so a bad filter is a `400`, not a SQL exception, and `ApplyFilters` builds the actual `.Where()` chain. This is `[Rubric §2, Design Patterns]` (Strategy) and `[Rubric §11, Security]` (untrusted input is allow-listed against real entity metadata, never concatenated blindly).

**Dynamic sorting & sparse fieldsets, `QueryFieldService`.** The companion static [`QueryFieldService`](group-03-querying-specifications.md#queryfieldservice) owns three more pieces of read-shaping. `ApplySorting` turns a `sort`/`direction` pair into a LINQ-Dynamic `OrderBy` (again resolving DTO names to entity paths). `ApplyFieldSelection` builds a `MemberInit` `Select` expression so a `fields=name,bio` request pulls **only those columns from the database** (less data over the wire and off disk, `[Rubric §12, Performance & Scalability]`), restricted to *writable* properties because the `MemberInit` projection needs setters. And `ShapeData`/`ShapeCollectionData` produce the final wire shape: an `ExpandoObject` (or list of them) containing only the requested fields, camelCased. To make that last step fast on large result sets, `QueryFieldService` caches a per-type array of [`PropertyAccessor`](group-03-querying-specifications.md#propertyaccessor), a private `readonly record struct` bundling each property's name, its precomputed camelCase JSON key, and a *compiled* `Func<object, object?>` getter (an `Expression.Lambda`, not `PropertyInfo.GetValue`) so shaping thousands of rows is a delegate invocation per field, not reflection. The `ExpandoObject` return type is *why* the read controllers traffic in `dynamic`: field projection yields a runtime-shaped object, not a statically-typed DTO. Validation here mirrors the filter side, `Validate<TEntity>` and `ValidateSortDirection` reject unknown field names and bad directions up front.

**The pipeline, two paths, one contract.** [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline) (implemented by the sealed [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)) is where it all executes, against an `IQueryable<TEntity>` and a bundle of inputs packaged as [`EntityQueryParameters<TEntity>`](group-03-querying-specifications.md#entityqueryparameterstentity), an immutable record carrying the specification `Criteria`, the dynamic `Filters`, sort, fields, paging, include flags, and the DTO→entity name map. The pipeline branches on the data source's JOIN capability. **Path 1 (server-side includes):** when every requested navigation can be `.Include()`-ed in SQL (the universal case for ADC, which runs SQL Server only), it adds the includes, forcing `AsSplitQuery()` when a *child collection* is included, because EF's single-query `Skip`/`Take` over a JOIN-expanded set truncates child rows and silently returns empty collections on list reads (a real, hard-won fix annotated `R24/§8` in the source), then applies criteria, filters, sort, count-before-paging, `Skip`/`Take`, and the field-selection `Select`, all translated to one (or, with split-query, a few) round trips. **Path 2 (manual navigation):** when a navigation crosses a physical data source (database-per-service, ADR-006) EF *cannot* JOIN it, so the pipeline materializes the paged-and-sorted page first, then invokes a `navigationPopulator` callback to **batch-load** those navigations in a second query, the [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) escape hatch (ADR-002, the navigation-populators chapter). Both paths share a `[Rubric §12, Performance]` safety ceiling: an unpaginated query is capped at `MaxUnboundedResultLimit` (1000) so a service caller who forgets paging can never trigger an unbounded full-table load. Which navigations are even *eligible*, and which path a given navigation takes, is decided by [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) (behind [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider)), which reflects `NavigationAttribute`-marked properties into [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) of supported vs. unsupported includes by asking [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) whether the two ends share a JOIN-capable source, caching the answer per `(entity, NavigationType)`.

**The query service, the public face.** [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) and its concrete [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) are what controllers actually inject. The service ties the whole chapter together in a four-step orchestration (visible in its `GetAllAsync`): **(1) Validate** all parameters up front via `Result.Combine` of the field, sort, sort-direction, and filter validators, a bad `fields` is a `400` before any DB hit; **(2) Build the query**: pick `Repository.Table` or `TableNoTracking` (from the read repository, [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)), ask `NavigationMetadataProvider` which includes are supported, pack everything into `EntityQueryParameters`, and hand off to `IEntityQueryPipeline.ExecuteAsync` (passing the populator callback); **(3) Map & shape**, convert entities to DTOs through the injected [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (ADR-001, manual/Mapperly mapping) then `ShapeCollectionData` to the requested fields, yielding a [`PagedCollectionResult<ExpandoObject>`](group-01-result-error-handling.md#pagedcollectionresultt); **(4) Wrap** in [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata). `GetByIdAsync` reuses the *same* pipeline through a synthetic `Id EQUALS` filter and returns `Error.NotFound` if empty; `GetAllForLookupAsync` returns lightweight `BaseLookup` id/name pairs for dropdowns. The service is built for `[Rubric §1, SOLID]` extension-over-modification: `Repository`, the `DTOToEntityPropertyMap` (e.g. `"CategoryName" → "Category.Name"`), and the methods themselves are `virtual`, so a module subclass like [`SpeakerEntityQueryService`](group-18-conference-application.md#speakerentityqueryservice) overrides one behavior without reimplementing the engine. Generic constraints (`TEntity : AuditableBaseEntity<TIdentifierType>`, `TEntityDTO : IBaseDTO<TIdentifierType>`) keep it usable only with the framework's [entity](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) and DTO contracts.

**End-to-end, the runtime flow of one list request:** the request hits a read controller, [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) or [`AggregateRootEntityControllerBase<…>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (the API chapter, G12), which clamps `pageSize` to `MaxPageSize` from [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings) (falling back to 500), binds the `?filter=` querystring through `QueryFilterModelBinder`, and may supply a server-authored `Specification` for authorization scope. It calls `IEntityQueryService.GetAllAsync`. The service validates fields/sort/filters (early `400` on failure), asks `NavigationMetadataProvider` to classify the requested includes, and packages an `EntityQueryParameters`. `EntityQueryPipeline` then chooses Path 1 or Path 2, applies the specification's `Criteria` plus the user's dynamic filters as translated SQL `WHERE` clauses, sorts, takes a `COUNT` for the page total, applies `Skip`/`Take`, projects the requested columns, materializes, batch-loads any cross-source navigations, maps entities to DTOs, shapes to the requested fields, and returns a `Result<PagedCollectionResult<ExpandoObject>>`, which the controller unwraps into the HTTP body plus an `X-Pagination` header. One pipeline, every entity, validated input, server-side execution, and a clean extraction seam for navigations that cross a service boundary.

### EntityQueryParameters<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11` · Level 0 · record (sealed)

- **What it is**: an immutable parameter object that bundles *every* input the read-side query
  pipeline needs for one list query: a LINQ criteria expression, a dynamic filter map, sort
  column/direction, field projection, pagination, navigation include flags, and a DTO-to-entity
  property-name map.
- **Depends on**: `System.Linq.Expressions`, `System.Collections.Frozen` (BCL). No first-party
  dependencies, it sits at Level 0, below everything that consumes it.
- **Concept introduced, the Parameter Object pattern + FrozenDictionary default.** `[Rubric §2,
  Design Patterns]` (assesses whether patterns solve real problems): grouping all query inputs into
  one record avoids a combinatorial explosion of method overloads on
  [`IEntityQueryService`](#ientityqueryservicetentity-tentitydto-tidentifiertype) and
  [`IEntityQueryPipeline`](#ientityquerypipeline). `[Rubric §12, Performance & Scalability]`
  (assesses query efficiency): the `FrozenDictionary<string, string>.Empty` default for
  `DTOToEntityPropertyMap` (line 44) avoids a null check at every usage site, `FrozenDictionary` is
  the .NET 8+ immutable dictionary optimised for the build-once/read-many shape these maps have.
- **Walkthrough**: all properties are `init`-only:
  - `Criteria` (line 14): an `Expression<Func<TEntity, bool>>?` applied *before* dynamic filters,
    typically carrying the caller's authorization scope. It is populated from a
    [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)`.Criteria` by
    the query service.
  - `Filters` (line 17): the parsed user filter map, keyed by property name, value a
    `(string Operator, string Value)` tuple, the shape produced by
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) at the API edge.
  - `SortColumn` / `SortDirection` (lines 20, 23): the property name and `"asc"`/`"desc"` string.
  - `Fields` (line 26): comma-separated field names for sparse-fieldset projection.
  - `PageNumber` / `PageSize` (lines 29, 32): nullable, null means "no pagination" (the pipeline
    then applies a safety cap, see [`EntityQueryPipeline`](#entityquerypipeline)).
  - `IncludeFKs` (line 35) / `IncludeChildren` (line 38): whether FK reference / child collection
    navigations were requested.
  - `DTOToEntityPropertyMap` (line 44): translates DTO column names to entity property paths
    (e.g. `"CategoryName" → "Category.Name"`), defaulting to `FrozenDictionary.Empty`.
- **Why it's built this way**: the sealed record gives immutability (safe to pass across layers) and
  `with`-expression construction (handy in tests); the empty-map default means callers that don't need
  translation pass nothing and the lookup branch is simply skipped.
- **Where it's used**: constructed inside
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype)`.BuildQueryAsync`
  (`EntityQueryService.cs:283-295`) and handed to
  [`IEntityQueryPipeline`](#ientityquerypipeline)`.ExecuteAsync`.

---

### IFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6` · Level 0 · interface

- **What it is**: the Strategy-pattern interface for dynamic query filtering. Each implementation
  handles one CLR property-type family (string, int, DateTime, bool, decimal, Guid) and translates an
  operator key + raw string value into a `.Where()` clause on an `IQueryable<T>`.
- **Depends on**: `System.Linq` (BCL). No first-party dependencies.
- **Concept introduced, the Strategy pattern for open-ended extensibility.** `[Rubric §2, Design
  Patterns]` (assesses idiomatic, problem-solving patterns): instead of one giant `switch (type)` in a
  single filtering class, each filterable type gets its own strategy class, and
  [`QueryFilterService`](#queryfilterservice) holds a `Type → IFilterStrategy` dictionary. Adding a new
  filterable type means adding a strategy and registering it, no edit to existing code, the textbook
  Open/Closed shape (`[Rubric §1, SOLID]`). `[Rubric §9, API & Contract Design]` (assesses
  consistent dynamic-query conventions): a uniform operator vocabulary across the whole API surface
  flows from this one contract.
- **Walkthrough**
  - `IQueryable<T> Apply<T>(IQueryable<T> query, string property, string op, string value)` (line 17)
   , `property` is the entity property name or dotted path, `op` is the operator string **already
    uppercased by the caller** (per the doc comment, line 14), `value` is the raw string. The contract
    is to return the *original* query unchanged when the operator is unrecognized, filtering is
    best-effort, never throwing.
  - `IReadOnlySet<string>? SupportedOperators => null` (line 24), a **default interface member**:
    returns `null` by default (so a custom third-party strategy can skip operator validation), but the
    built-in strategies override it with a `FrozenSet` of the operators they accept, so
    [`QueryFilterService`](#queryfilterservice) can reject an invalid operator *up front* as a 400
    rather than letting it become a silent no-op or a 500.
- **Why it's built this way**: string operator names (rather than an enum) let a consumer extend the
  operator vocabulary without changing a framework enum; the per-type strategy split keeps each type's
  parsing/comparison rules isolated and testable.
- **Where it's used**: implemented by the six built-in strategies below; the registry and dispatch
  live in [`QueryFilterService`](#queryfilterservice).

---

### PropertyAccessor
> MMCA.Common.Application · `MMCA.Common.Application.Services` (private nested in `QueryFieldService`) · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:23` · Level 0 · record struct (readonly, private)

- **What it is**: a tiny private `readonly record struct` declared inside
  [`QueryFieldService`](#queryfieldservice) that bundles a property's CLR name, its pre-computed
  camelCase JSON name, and a compiled `Func<object, object?>` getter delegate, so a property's value
  can be read without per-call reflection.
- **Depends on**: `System.Reflection`, `System.Linq.Expressions` (BCL). No first-party dependencies.
- **Concept introduced, compile-once expression delegates vs. per-call reflection.** `[Rubric §12,
  Performance & Scalability]` (assesses avoiding per-request reflection on hot paths): calling
  `PropertyInfo.GetValue` allocates an `object[]` args array on *every* invocation; compiling a
  `Func<object, object?>` once per type from an `Expression.Lambda` (done in
  [`QueryFieldService`](#queryfieldservice)`.GetAccessors`, lines 25-42, then cached) collapses the
  per-property/per-row cost to a delegate call. The `readonly record struct` shape is the idiomatic
  .NET choice for a small, allocation-free value carrier, cross-reference
  [`LoginRequest`](group-08-auth.md#loginrequest) for the `readonly record struct` pattern.
- **Walkthrough**: `private readonly record struct PropertyAccessor(string PropertyName, string
  CamelCaseName, Func<object, object?> GetValue)` (line 23). `PropertyName` is used to match requested
  fields; `CamelCaseName` becomes the `ExpandoObject` key; `GetValue` is the compiled getter invoked
  per entity in `ShapeData`/`ShapeCollectionData`.
- **Why it's built this way**: `private` keeps this hot-path helper unexposed; the struct + record
  combination gives zero-allocation storage with structural equality, suitable for caching in arrays.
- **Where it's used**: exclusively inside [`QueryFieldService`](#queryfieldservice): the `AccessorCache`
  (`ConcurrentDictionary<Type, PropertyAccessor[]>`) is built once per entity type and iterated by the
  data-shaping methods.

> The **six built-in filter strategies** that follow are structurally identical: each is an
> `internal sealed` class implementing [`IFilterStrategy`](#ifilterstrategy) for one CLR type family,
> declaring its `SupportedOperators` as a `FrozenSet<string>` and a `switch` over the operator that
> builds a LINQ-Dynamic `.Where()` string. They are grouped into one section that teaches the shared
> shape once.

### BoolFilterStrategy, DateTimeFilterStrategy, DecimalFilterStrategy, GuidFilterStrategy, IntFilterStrategy, StringFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · Level 1 · class (internal, sealed)

| Type | File:Line | Supported operators (verbatim from source) |
|------|-----------|----------------------------------------------|
| `BoolFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/BoolFilterStrategy.cs:11` | `IS` |
| `DateTimeFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` | `IS`, `IS NOT`, `IS AFTER`, `IS ON OR AFTER`, `IS BEFORE`, `IS ON OR BEFORE`, `IS EMPTY`, `IS NOT EMPTY` |
| `DecimalFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:12` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL` |
| `GuidFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:11` | `EQUALS`, `NOT EQUALS` |
| `IntFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:11` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL` |
| `StringFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/StringFilterStrategy.cs:12` | `CONTAINS`, `NOT CONTAINS`, `EQUALS`, `NOT EQUALS`, `STARTS WITH`, `ENDS WITH`, `IS EMPTY`, `IS NOT EMPTY` |

- **What they are**: the concrete [`IFilterStrategy`](#ifilterstrategy) implementations, one per CLR
  type family, that turn a `(property, operator, value)` triple into a `.Where()` clause.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy) (Level 0); `System.Linq.Dynamic.Core` (the
  `query.Where("expr", args)` string-expression API); `System.Collections.Frozen`. The numeric/date
  strategies also use `System.Globalization` (see below).
- **Concept introduced, the Filter Strategy pattern in concrete form.** `[Rubric §2, Design
  Patterns]` (Strategy) and `[Rubric §9, API & Contract Design]` (URL-driven filtering with a uniform
  operator set). Each strategy declares its operator set as an `IReadOnlySet<string>` built from a
  `HashSet` with `StringComparer.Ordinal`, then `.ToFrozenSet(StringComparer.Ordinal)`, a `FrozenSet`
  is the read-optimised immutable set the framework reaches for whenever a lookup table is built once
  and read many times.
- **Walkthrough, the shared shape**
  - `Apply<T>` is an operator `switch`. The match arm builds a LINQ-Dynamic string like
    `query.Where("{property} == @0", value)`, `@0` is a positional, parameterised placeholder, so the
    value is *not* string-concatenated into the expression (it crosses into EF as a SQL parameter, not
    interpolated text, relevant to `[Rubric §11, Security]`, which assesses injection resistance).
    `StringFilterStrategy` instead emits method calls like `{property}.Contains(@0)` and
    `string.IsNullOrEmpty({property})` (`StringFilterStrategy.cs:23-30`).
  - **Defensive parsing.** The value strategies (`Bool`, `Decimal`, `Guid`, `Int`) `TryParse` the
    value and *return the unfiltered query* on failure (e.g. `BoolFilterStrategy.cs:20-21`,
    `IntFilterStrategy.cs:21-22`) rather than throwing, a bad client value yields an unfiltered result
    instead of a 500. The `_ =>` default arm of every `switch` returns the original query for an
    unrecognized operator, the same silent no-op the [`IFilterStrategy`](#ifilterstrategy) contract
    promises.
  - **Culture-invariance.** `DateTimeFilterStrategy` and `DecimalFilterStrategy` parse with
    `CultureInfo.InvariantCulture` (`DateTimeFilterStrategy.cs:15`, `DecimalFilterStrategy.cs:22`) so a
    date or decimal separator parses identically across server locales, the single-locale, culture-safe
    posture described in [primer §6, §27](00-primer.md#6-the-34-category-architecture-evaluation-lens).
  - **Null operators.** `DateTime` and `String` support `IS EMPTY` / `IS NOT EMPTY`, which emit
    `{property} == null` / `string.IsNullOrEmpty({property})` and take no value.
- **Why they're built this way**: one type per strategy keeps each type's parse + comparison rules in
  isolation; `internal sealed` means they're registered by the framework and never referenced directly
  by consumers, extension happens through
  [`QueryFilterService.RegisterStrategy`](#queryfilterservice), not subclassing.
- **Where they're used**: instantiated and registered in the static `Strategies` table of
  [`QueryFilterService`](#queryfilterservice) (one instance per type, with the nullable variant
  sharing the same instance, `QueryFilterService.cs:26-40`).
- **Caveats / not-in-source**: there is **no** `BETWEEN` operator on any strategy (a prior edition of
  this guide listed one; the current source has none). `Bool`, `Guid`, `Int` and `Decimal` have *no*
  `IS EMPTY`/`IS NOT EMPTY` arm, only `String` and `DateTime` do.

---

### QueryFieldService
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16` · Level 3 · class (sealed)

- **What it is**: a stateless utility (all methods static) that provides **field validation**,
  **data shaping** (sparse-fieldset projection onto `ExpandoObject`), **dynamic sorting**, and
  **server-side field selection** (building EF `Select` expressions). It caches reflected metadata per
  type so reflection happens once.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result) (both Level 1/2),
  [`PropertyAccessor`](#propertyaccessor) (its own private nested struct);
  `System.Linq.Dynamic.Core`, `System.Dynamic` (`ExpandoObject`), `System.Reflection`,
  `System.Text.Json` (camelCase naming policy).
- **Concept introduced, compiled-getter cache + sparse fieldsets + dynamic sort.** `[Rubric §12,
  Performance & Scalability]` (assesses avoiding per-request reflection and moving less data):
  `GetAccessors<TEntity>` (lines 25-42) builds one [`PropertyAccessor`](#propertyaccessor) array per
  type, each with a compiled getter, and caches it in `AccessorCache`; later requests reuse it with
  no reflection. `[Rubric §9, API & Contract Design]` (assesses sparse-fieldset / projection APIs):
  a `?fields=...` request shapes the response to only the named fields, letting a client ask for
  exactly the data it needs.
- **Walkthrough** (members in teaching order)
  - `ShapeData<TEntity>` (line 52) / `ShapeCollectionData<TEntity>` (line 77): produce
    `ExpandoObject`(s) holding only the requested fields, keyed by camelCase name. `ParseFields`
    (line 250) splits the comma list into a case-insensitive `HashSet`; `FilterAccessorsByFields`
    (line 261) narrows the cached accessor array.
  - `ApplySorting<TEntity>` (line 115): builds a LINQ-Dynamic `OrderBy("col ascending/descending")`
    expression, first translating the DTO column name through the `dtoToEntityPropertyMap` (line 124).
    Falls back to an optional `defaultSort` lambda when no column is given.
  - `ApplyFieldSelection<TEntity>` (line 140): constructs a `MemberInit` expression
    (`new TEntity { Prop = e.Prop, ... }`) to push field projection *into the SQL `SELECT`*, only
    **writable** properties are projected (line 153), since a read-only/computed property would break
    EF's translation of the `MemberInit`.
  - `Validate<TEntity>` (line 183): checks every requested field exists on the type, and (when
    `allowWriteableFields` is false) rejects read-only fields; returns a
    [`Result`](group-01-result-error-handling.md#result) carrying one
    [`Error`](group-01-result-error-handling.md#error) per offending field, built from
    `Error.InvalidEntityField`.
  - `ValidateSortDirection` (line 229): accepts only `"asc"`, `"desc"`, or null/empty.
- **Why it's built this way**: sparse fieldsets cut payload size on collection endpoints; dynamic
  sort avoids a hand-written `OrderBy` switch per sortable column; the compiled-delegate cache
  eliminates `PropertyInfo.GetValue` overhead on every shaped row.
- **Where it's used**: called by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) (validation + shaping)
  and inside [`EntityQueryPipeline`](#entityquerypipeline) (sorting + field selection).

---

### QueryFilterService
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19` · Level 3 · class (static)

- **What it is**: the static registry + dispatcher that applies and validates dynamic query filters
  using the strategy-per-type pattern. It owns the `Type → IFilterStrategy` table and a `PropertyInfo`
  cache, and is the single point where filters meet the query.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy) and the six concrete strategies
  ([`BoolFilterStrategy` … `StringFilterStrategy`](#boolfilterstrategy-datetimefilterstrategy-decimalfilterstrategy-guidfilterstrategy-intfilterstrategy-stringfilterstrategy)),
  [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result); `System.Reflection`,
  `System.Collections.Concurrent`.
- **Concept introduced, the strategy registry + validate-before-execute boundary.** `[Rubric §2,
  Design Patterns]` / `[Rubric §1, SOLID]` (OCP): the `Strategies` `ConcurrentDictionary`
  (lines 26-40) seeds one instance per CLR type (with each nullable variant sharing the same
  instance), and `RegisterStrategy(Type, IFilterStrategy)` (line 55) lets a consumer add a type
  without editing this file. `[Rubric §9, API & Contract Design]` (assesses validation at the right
  boundary): `ValidateFilters` runs operator-support checks *before* the query executes, so an
  unsupported operator becomes a 400 validation error rather than a LINQ-Dynamic runtime exception
  (a 500).
- **Walkthrough**
  - `ApplyFilters<TEntity>` (line 71): for each filter, resolves the entity property path through the
    `dtoToEntityPropertyMap`, resolves the root `PropertyInfo` (cached per `(Type, name)` in
    `PropertyCache`, line 24), and dispatches. **Nested paths** like `"Category.Name"` *and* string
    properties always route to a dedicated `StringStrategy` (lines 47, 102-106), because LINQ-Dynamic
    traverses a dotted path as a string expression, otherwise the per-type strategy from `Strategies`
    is used (line 109). An unresolvable property is silently skipped (line 95).
  - `ValidateFilters<TEntity>` (line 124): collects **all** errors (not just the first) into a
    [`Result`](group-01-result-error-handling.md#result); per filter it checks the property exists
    (`Filter.Property.NotFound`), a strategy exists for its type (`Filter.Type.NotSupported`), and the
    operator is in that strategy's `SupportedOperators` (`Filter.Operator.NotSupported`,
    lines 206-221). A strategy whose `SupportedOperators` is `null` skips the operator check.
- **Why it's built this way**: validating up front turns would-be 500s into precise 400s at the API
  boundary; the `PropertyCache` and a static strategy table mean per-request reflection is amortised
  to first use.
- **Where it's used**: `ValidateFilters` is called by
  [`EntityQueryService.GetAllAsync`](#entityqueryservicetentity-tentitydto-tidentifiertype); `ApplyFilters`
  is called inside [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline) before materialization.
- **Caveats / not-in-source**: `QueryFilterService` is a **static class**, not a DI-resolved service;
  there is no `FilteringService` type in the codebase (an earlier edition named it that). Strategy
  registration is process-global mutable state (`RegisterStrategy` writes the shared `Strategies` map).

---

### IEntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10` · Level 4 · interface

- **What it is**: the orchestration contract for the full read pipeline: navigation includes,
  criteria, dynamic filters, sorting, pagination, and field projection, returning the materialized
  page plus the total matching count.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the entity constraint), [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata).
- **Concept**: the pipeline is the seam that converts a handler's base `IQueryable<TEntity>` plus an
  [`EntityQueryParameters`](#entityqueryparameterstentity) into a fully filtered/sorted/paged/projected
  collection. The `navigationPopulator` parameter (line 27) is a delegate whose signature mirrors
  [`INavigationPopulator<TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)`.PopulateAsync`
 , the pipeline calls it *after* EF materialization to batch-load cross-source navigations. `[Rubric
  §12, Performance & Scalability]` (single-pass pipeline; pagination at the database). `[Rubric §3,
  Clean Architecture]` (an Application-layer interface; the EF implementation is injected, not
  referenced).
- **Walkthrough**: one method, `ExecuteAsync<TEntity, TIdentifierType>` (lines 23-30), constrained
  `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType : notnull`,
  returning `Task<(IReadOnlyCollection<TEntity> Items, int TotalCount)>`, the tuple carries both the
  page and the count needed to build [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata).
- **Where it's used**: implemented by [`EntityQueryPipeline`](#entityquerypipeline); injected into
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype).

---

### INavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9` · Level 4 · interface

- **What it is**: classifies an entity type's navigation properties into "supported" (EF
  `Include()`-able) and "unsupported" (need manual population), based on data-source compatibility.
- **Depends on**: [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata)
  (its return type).
- **Concept**: the metadata-discovery half of ADR-002 (navigation populators). It inspects an
  entity's `[Navigation]` attributes and configured data source and decides which navigations EF can
  `Include` (same database) and which require batch loading (cross-source). `[Rubric §2, Design
  Patterns]` (Strategy: callers just call `BuildIncludes`, the classification mechanism is hidden).
  `[Rubric §8, Data Architecture]` (the include strategy is data-source-aware).
- **Walkthrough**: one method, `BuildIncludes<TEntity>(bool includeFKs, bool includeChildren)`
  (line 19), returning [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata).
  The boolean pair lets a caller request FK references and/or child collections independently.
- **Where it's used**: implemented by [`NavigationMetadataProvider`](#navigationmetadataprovider);
  injected into [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype), whose
  result is forwarded to [`IEntityQueryPipeline`](#ientityquerypipeline).

---

### EntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13` · Level 5 · class (sealed)

- **What it is**: the execution engine implementing [`IEntityQueryPipeline`](#ientityquerypipeline):
  it applies EF includes, criteria and dynamic filters, sorting, pagination, and field selection, and
  for cross-source navigations calls the populator callback after materialization.
- **Depends on**: [`IEntityQueryPipeline`](#ientityquerypipeline) (implements),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata),
  [`NavigationType`](group-11-navigation-populators.md#navigationtype),
  [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`QueryFilterService`](#queryfilterservice), [`QueryFieldService`](#queryfieldservice), and
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (the EF-facing abstraction
  it is constructed with, line 13).
- **Concept introduced, two-path query execution for multi-database environments.** `[Rubric §12,
  Performance & Scalability]` (server-side filtering, paginate before materializing, a safety ceiling)
  and `[Rubric §8, Data Architecture]` (the cross-source query strategy, ADR-006). `ExecuteAsync`
  applies supported includes via `queryableExecutor.Include` (lines 39-50), applies `Criteria`
  (line 56) and `Filters` via [`QueryFilterService.ApplyFilters`](#queryfilterservice) (line 59), all
  *before* materializing so the database does as much work as possible, then routes down one of two
  paths:
  - **PATH 1, server-side includes** (`ExecuteWithServerSideIncludesAsync`, lines 121-155): every
    navigation is EF `Include`-able, so sort, pagination, and field selection are all applied on the
    `IQueryable` before a single `ToListAsync`, minimal data crosses the wire.
  - **PATH 2, manual navigation loading** (`ExecuteWithManualNavigationAsync`, lines 75-115): some
    navigations are cross-source (e.g. a Cosmos container or another physical source); the page is
    sorted and paginated server-side, materialized, then `navigationPopulator(entities, ...)` (line
    106) fills in the cross-source relationships on just that page.
- **Walkthrough, two details worth knowing**
  - **Split-query guard** (lines 44-49): when a *child collection* is among the supported includes the
    pipeline forces `AsSplitQuery`. The inline comment (R24/§8) records why, paginating a single-query
    collection `Include` makes EF apply `Skip`/`Take` to the JOIN-expanded row set, truncating child
    rows so list reads return empty collections while by-id reads work; split query is EF's documented
    remedy. (See the memory note "Session list omits SessionSpeakers" for the live bug this prevents.)
  - **Unbounded-result safety ceiling** (`MaxUnboundedResultLimit = 1000`, line 22): an *unpaginated*
    query is capped with `.Take(1000)` on both paths (lines 100, 144) so a direct service caller that
    forgets pagination can never trigger an unbounded full-table load, the comments cite "rubric §12"
    explicitly. `Skip` math is `checked` (lines 93, 137) to fail loudly on overflow.
- **Why it's built this way**: pushing filter/sort/page to the database is the §12 win; the two-path
  split is what makes the same pipeline correct whether an entity's navigations live in one database or
  across physical sources (ADR-002/006). Talking to
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) instead of `DbContext`
  keeps this Application-layer type free of an EF reference (`[Rubric §3, Clean Architecture]`).
- **Where it's used**: injected into
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype); one `ExecuteAsync`
  call per read request.

---

### NavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20` · Level 5 · class (sealed)

- **What it is**: the implementation of [`INavigationMetadataProvider`](#inavigationmetadataprovider):
  it reflects over an entity's `[Navigation]`-tagged properties and classifies each as a supported EF
  `Include` or an unsupported (manual-load) navigation, caching the result per (entity type, navigation
  kind).
- **Depends on**: [`INavigationMetadataProvider`](#inavigationmetadataprovider) (implements),
  [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) (constructor, line 20),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata),
  [`NavigationPropertyInfo`](group-11-navigation-populators.md#navigationpropertyinfo),
  [`NavigationType`](group-11-navigation-populators.md#navigationtype); `System.Reflection`,
  `System.Collections.Concurrent`.
- **Concept introduced, reflection-based navigation discovery with data-source awareness.** `[Rubric
  §2, Design Patterns]` (metadata-driven behavior) and `[Rubric §3, Clean Architecture]` (ADR-002:
  the Application layer classifies includes without referencing EF). The decision hinges on one call,
  `dataSourceService.HaveIncludeSupport(declaringEntityFullName, targetEntityFullName)` (line 96):
  if both ends share a database the navigation is *supported* (EF `Include`), otherwise it is
  *unsupported* and must flow through
  [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) after
  materialization.
- **Walkthrough**
  - `_cache` (line 28): `ConcurrentDictionary<(Type, NavigationType), NavigationMetadata>`. The doc
    comment (lines 22-27) explains why it is **instance-level, not static**: classification depends on
    the host's data-source configuration, so two service hosts in one process (integration tests) must
    not share results.
  - `BuildIncludes<TEntity>` (lines 31-50): public entry, collects FK navigations if `includeFKs`,
    child collections if `includeChildren`, merges both into one
    [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata).
  - `BuildNavigationMetadata` (lines 60-70) reflects over all public instance properties;
    `ClassifyNavigationProperty` (lines 72-100) skips properties without `[Navigation]`, matches the
    attribute's `IsCollection` flag to the requested
    [`NavigationType`](group-11-navigation-populators.md#navigationtype), `UnwrapCollectionType`
    (lines 106-116) strips `ICollection<T>`/`IReadOnlyCollection<T>` to the element type, then routes
    via `HaveIncludeSupport`.
- **Why it's built this way**: keeping classification out of EF means the Application layer computes
  "what should be included" with no `Microsoft.EntityFrameworkCore` reference; the EF knowledge is
  supplied at the boundary by [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice).
- **Where it's used**: injected into
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype); its output drives the
  include strategy inside [`EntityQueryPipeline`](#entityquerypipeline).

---

### EntityQueryService<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:29` · Level 8 · class

- **What it is**: the concrete, reusable engine behind *every* read endpoint in both apps: filtered,
  sorted, paginated, field-projected reads for any entity. It implements
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`INavigationMetadataProvider`](#inavigationmetadataprovider),
  [`IEntityQueryPipeline`](#ientityquerypipeline),
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype),
  [`INavigationPopulator<TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity),
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype),
  [`QueryFieldService`](#queryfieldservice), [`QueryFilterService`](#queryfilterservice),
  [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype);
  constrained `where TEntity : AuditableBaseEntity<TIdentifierType>`, `where TEntityDTO :
  IBaseDTO<TIdentifierType>`, `where TIdentifierType : notnull`.
- **Concept introduced, the generic query service: one pipeline, every entity, dynamic shaping.**
  `[Rubric §1, SOLID]` (OCP, extend via subclass/override, not modification), `[Rubric §9, API &
  Contract Design]` (one uniform filter/sort/page/fields convention across all read endpoints), and
  `[Rubric §12, Performance & Scalability]` (everything pushed to the database via the pipeline). The
  orchestration is a four-step pipeline, visible in `GetAllAsync` (lines 85-144):
  1. **Validate** all parameters *before* touching the DB, `Result.Combine` of field validation, sort
     validation, sort-direction validation, and [`QueryFilterService.ValidateFilters`](#queryfilterservice)
     (lines 99-104); on failure it rewrites each
     [`Error`](group-01-result-error-handling.md#error)'s `Source`/`Target` with a `with` expression
     and returns a typed failure (lines 107-115).
  2. **Build the query** via `BuildQueryAsync` (lines 264-303): pick `Repository.Table` (tracking) or
     `TableNoTracking`, ask [`NavigationMetadataProvider.BuildIncludes`](#navigationmetadataprovider)
     which navigations are supported, pack everything into an
     [`EntityQueryParameters`](#entityqueryparameterstentity) (pulling
     `Criteria` from the optional
     [`Specification`](#specificationtentity-tidentifiertype)), and hand off to
     [`IEntityQueryPipeline.ExecuteAsync`](#ientityquerypipeline), passing
     `NavigationPopulator.PopulateAsync` so cross-source navigations EF can't `Include` are batch-loaded
     afterward (ADR-002).
  3. **Map** the entities to DTOs via the injected
     [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
     and **shape** them to the requested `fields` with
     [`QueryFieldService.ShapeCollectionData`](#queryfieldservice), yielding
     `PagedCollectionResult<ExpandoObject>`. The `ExpandoObject` return type is *why* field projection
     produces a runtime-shaped object rather than a statically-typed DTO.
  4. **Wrap** in [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata)
     (`BuildPaginationMetadata`, lines 305-323, when no page is requested, page size = total count and
     current page = 1).
- **Walkthrough, the other read paths**
  - `GetByIdAsync` (lines 228-252) reuses the pipeline via a synthetic `Id EQUALS` filter through
    `GetEntityByIdAsync` (lines 175-225), maps the single entity, shapes it, and returns
    `Error.NotFound` if empty.
  - `GetAllForLookupAsync` (lines 147-172) validates a single `nameProperty` then delegates to the
    repository's `GetAllForLookupAsync`, returning
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
    id/name pairs for dropdowns.
  - `ExistsAsync` (lines 255-259) is a thin pass-through to the repository.
  - **Extensibility points**: `Repository`, `DTOToEntityPropertyMap` (override to map DTO field names
    to entity paths, e.g. `"CategoryName" → "Category.Name"`, lines 54-59), and the read methods
    themselves are `virtual`, so a module subclass (e.g. a speaker-specific query service) can override
    one behavior without reimplementing the pipeline. Note the class is **not** `sealed` precisely to
    allow this.
- **Why it's built this way**: centralizing read mechanics means a new entity gets full
  filter/sort/page/projection support for free with identical conventions everywhere (`[Rubric §16,
  Maintainability]`). Validate-before-DB makes a bad `fields` parameter a 400, not a SQL error. The
  [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) hook is
  the database-per-service escape hatch (ADR-002): EF can't join across physical sources, so those
  navigations are filled in a second batch query.
- **Where it's used**: injected as the `queryService` of the read controllers
  (`EntityControllerBase`) in both apps; subclassed per module where a default behavior must change.
- **Caveats / not-in-source**: the per-request `PageSize` clamp against
  `IApplicationSettings.MaxPageSize` happens at the API boundary, not in this class; the
  `MaxUnboundedResultLimit = 1000` ceiling inside [`EntityQueryPipeline`](#entityquerypipeline) is the
  only bound visible here. `GetEntityByIdAsync` rewrites errors with `Source = nameof(GetByIdAsync)`
  (lines 191, 219) even when called on its own, a cosmetic source label, not a bug.

### ISpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12` · Level 1 · interface

- **What it is**: the Specification pattern interface: an encapsulated, reusable predicate that
  exposes *both* an EF-translatable expression tree (`Criteria`) and an in-memory evaluation path
  (`IsSatisfiedBy`).
- **Depends on**: [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint, line 13); `System.Linq.Expressions` (BCL).
- **Concept introduced, the Specification pattern.** `[Rubric §4, DDD]` assesses whether business
  rules are modelled as first-class, named domain concepts rather than scattered conditionals; here a
  query criterion *is* a domain object. `[Rubric §3, Clean Architecture]` assesses whether the domain
  expresses rules while infrastructure translates them, `Criteria` is a pure expression tree the
  domain owns, EF Core (an outer layer) is what turns it into SQL. A **specification** is a named,
  composable query criterion: instead of scattering `Where(e => e.OwnerId == userId)` throughout the
  codebase, you write `new OwnedByCurrentUserSpec(userId)` once and reuse it. The doc comment
  (`ISpecification.cs:5-8`) lists the three use sites: authorization filtering, query scoping, and
  domain validation.
- **Walkthrough**: two members, both constrained `where TEntity : IBaseEntity<TIdentifierType>` and
  `where TIdentifierType : notnull` (lines 13-14):
  - `Expression<Func<TEntity, bool>> Criteria { get; }` (line 17), the expression tree EF Core
    translates to SQL via LINQ-to-DB. It is an *expression*, not a compiled `Func`, precisely so EF can
    inspect and translate it.
  - `bool IsSatisfiedBy(TEntity entity)` (line 22), the compiled in-memory predicate, for unit-testing
    business rules or evaluating a rule against an already-materialized entity without a database.
  Both members on the same type is the key insight: one specification works equally against EF and
  in-memory collections, eliminating duplicate filter logic. `[Rubric §14, Testability]` (business
  rules become testable without infrastructure).
- **Where it's used**: implemented by the abstract base [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (next section) and module-specific authorization specs in both apps (e.g. `OwnedByCustomerSpec`);
  accepted as an optional argument by [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and the read-repository query methods (G07).

### Specification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15` · Level 2 · class (abstract)

- **What it is**: the abstract base for the Specification pattern: subclasses supply an
  `Expression<Func<TEntity, bool>>` (`Criteria`, usable in EF `Where` clauses) and inherit an
  in-memory `IsSatisfiedBy` shortcut backed by a lazy-compiled, cached delegate.
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the contract it implements), [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, the Specification pattern with expression trees.** `[Rubric §2, Design
  Patterns]` assesses whether a pattern solves a real problem rather than being pattern theater, here
  specifications solve authorization scoping and reusable query predicates without leaking logic into
  repositories. `[Rubric §4, DDD]` (domain logic as reusable, composable predicates rather than
  scattered `if`s). The pattern is dual-purpose: because `Criteria` is an expression tree (not a
  compiled delegate), EF Core can translate it to SQL, `Where(spec.Criteria)` becomes a `WHERE` clause
  in the database; for in-memory use, `IsSatisfiedBy` compiles the same expression once and caches the
  result. One object, two evaluation modes, zero duplicate logic.
- **Walkthrough**
  - `protected Specification() { }` (line 20), a do-nothing protected ctor so only subclasses (and the
    composites below) can construct one.
  - `public abstract Expression<Func<TEntity, bool>> Criteria { get; }` (line 23), subclasses provide
    the expression tree; this is the single piece of state a concrete specification must define.
  - `private Func<TEntity, bool>? _compiled` (line 27), the lazily-compiled delegate, cached to avoid
    recompiling the expression tree on every `IsSatisfiedBy` call (expression compilation is expensive).
  - `public virtual bool IsSatisfiedBy(TEntity entity)` (line 30), `_compiled ??= Criteria.Compile();`
    then `return _compiled(entity);` (lines 32-33). First call compiles; subsequent calls reuse the
    delegate. `virtual`, so composites/subclasses *could* override, though none do.
- **Why it's built this way**: placing `Specification` in `MMCA.Common.Domain` (not Infrastructure)
  keeps query business rules in the domain layer, where they are testable without an EF context or a
  database, and the domain stays free of any EF reference (the expression tree is plain BCL).
- **Where it's used**: base class for the composites
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) /
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) /
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) (next section) and every
  module-specific access-control specification; passed as the optional `specification` argument to
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for authorization scoping (e.g. an `OwnerSpecification` restricting results to the authenticated
  user's own entities).

### AndSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, NotSpecification<TEntity, TIdentifierType>

> All three: MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · Level 3 · class (sealed)

These three are the **composite combinators** of the Specification pattern, each is a sealed,
primary-constructor subclass of [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
that builds a new `Criteria` expression tree from one or two existing specifications. They share one
structural shape and differ only in the `Expression` node they emit, so they are taught together.

| Type | File:Line | What differs |
|------|-----------|--------------|
| `AndSpecification<TEntity, TIdentifierType>` | `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:62` | Two specs; `Expression.AndAlso` (logical AND, short-circuiting) |
| `OrSpecification<TEntity, TIdentifierType>` | `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:88` | Two specs; `Expression.OrElse` (logical OR, short-circuiting) |
| `NotSpecification<TEntity, TIdentifierType>` | `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:114` | One spec; `Expression.Not` (negation) |

- **What they are**: `AndSpecification` / `OrSpecification` compose two specifications; `NotSpecification`
  negates one. The result is itself an `ISpecification`, so compositions nest arbitrarily
  (`new AndSpecification(ownerSpec, new NotSpecification(deletedSpec))`).
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class), [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the constructor parameter type), [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, expression-tree composition for EF translatability.** `[Rubric §8, Data
  Architecture]` assesses whether query predicates reach the database rather than filtering in-memory
  after a full load. The trick is `Expression.Invoke`: each combinator creates **one** shared
  `ParameterExpression` named `"entity"`, then embeds each child spec's existing `Criteria` tree as a
  sub-expression via `Expression.Invoke(spec.Criteria, parameter)`. Composing at the *expression-tree*
  level (not by combining compiled `Func`s) is what keeps the composite translatable, a compiled
  delegate cannot be turned into SQL, but `Expression.AndAlso(invoke1, invoke2)` can. Most EF providers
  accept `Invoke` in composed expressions.
- **Walkthrough**: identical body shape in all three (`AndSpecification.Criteria` lines 70-78 shown;
  the others mirror it):
  1. `var parameter = Expression.Parameter(typeof(TEntity), "entity");`, the single shared lambda
     parameter.
  2. Build `body`: `Expression.AndAlso(...)` (line 75, And), `Expression.OrElse(...)` (line 101, Or), or
     `Expression.Not(Expression.Invoke(spec.Criteria, parameter))` (lines 126-127, Not).
  3. `return Expression.Lambda<Func<TEntity, bool>>(body, parameter);`, re-wrap as a strongly-typed
     predicate lambda.
  Note `Criteria` is a computed property here (a fresh tree is built on each `get`), not a cached field,
  composites are cheap and usually constructed per-query.
- **Why they're built this way**: combinators let query callers compose access rules
  (`ownerSpec.And(activeSpec)`) without the query service knowing the predicate internals, and the
  expression-tree approach preserves database translation throughout the composition. Keeping them
  `sealed` signals they are leaf implementations not meant for further subclassing.
- **Where they're used**: "owner + active" filtering (And), "admin or owner" access patterns where
  either condition grants access (Or), and "exclude soft-deleted / not in this set" predicates (Not),
  all combined and passed as the `specification` argument to the query service and read repositories
  (G07).

### InlineSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:45` · Level 3 · class (sealed)

- **What it is**: a specification built from an *already-composed* `Criteria` expression, rather than
  from a fixed, hand-written specification subclass. It lets code that constructs a predicate
  dynamically (notably the cross-source filter built by
  [`CrossSourceSpecification`](#crosssourcespecification), below) hand that expression back as a
  first-class `Specification` without declaring a one-off class.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class), [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (via the base), [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, a wrapper specification.** The composites
  ([`AndSpecification`](#andspecificationtentity-tidentifiertype) etc.) build *new* trees from existing
  specs; `InlineSpecification` instead adopts a tree someone else built. This is the small seam that
  lets the dynamic, runtime-assembled cross-source predicate participate in the same
  `Where(spec.Criteria)` / `IsSatisfiedBy` machinery every other specification uses.
- **Walkthrough**: a one-member sealed class with a primary constructor (lines 45-53):
  - `InlineSpecification(Expression<Func<TEntity, bool>> criteria)` (line 45), the primary-constructor
    parameter is the pre-built criteria.
  - `public override Expression<Func<TEntity, bool>> Criteria { get; } = criteria ?? throw new ArgumentNullException(nameof(criteria));`
    (lines 51-52), the inherited abstract `Criteria` is satisfied by a get-only auto-property
    initialized once (and null-guarded) from the constructor argument; `IsSatisfiedBy` is inherited
    unchanged from the base, so the lazy-compiled in-memory path works too.
- **Why it's built this way**: without it, the cross-source helper would have to emit a bespoke
  `Specification` subclass per call site; a single sealed wrapper keeps that machinery to one type. It
  lives in `MMCA.Common.Domain` alongside the base and composites so the whole Specification family
  stays in the domain layer (ADR-018 builds the cross-source filter on top of it from the Application
  layer).
- **Where it's used**: returned by
  [`CrossSourceSpecification.BuildAsync`](#crosssourcespecification) to wrap the
  `localPredicate AND principalKeys.Contains(fk)` expression it assembles.

### IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:18` · Level 5 · interface (generic)

- **What it is**: the central read-query contract of the framework: generic operations for
  `GetAllAsync` (with filter/sort/pagination/projection), `GetAllForLookupAsync`, `GetEntityByIdAsync`,
  `GetByIdAsync`, and `ExistsAsync` over any entity/DTO pair. It is the read half of the application's
  CQRS split (the write half flows through command handlers).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, line 19), [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (the `TEntityDTO` constraint, line 20), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  (the `DTOMapper` property), [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (optional scoping argument), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`Result`](group-01-result-error-handling.md#result), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype);
  `System.Dynamic.ExpandoObject` and `System.Linq.Expressions` (BCL).
- **Concept introduced, the entity query service contract.** `[Rubric §5, Vertical Slice]` assesses
  whether a feature's read logic is encapsulated in one place, here the API controller delegates to
  this service and never touches `IQueryable` directly. `[Rubric §12, Performance & Scalability]`
  assesses whether result sets are bounded, explicit `pageNumber`/`pageSize` parameters and `fields`
  projection prevent returning unbounded rows or over-fetching columns. The most distinctive design
  choice is the return shape: read methods return `Result<...<ExpandoObject>>`. The `ExpandoObject` is
  a dynamic property bag shaped by the comma-separated `fields` parameter, so the API can return only
  the requested fields without proliferating one DTO per projection, a single contract serves
  full-detail and sparse-field responses alike.
- **Walkthrough**: constraints `where TEntity : AuditableBaseEntity<TIdentifierType>`,
  `where TEntityDTO : IBaseDTO<TIdentifierType>`, `where TIdentifierType : notnull` (lines 19-21):
  - `IEntityDTOMapper<...> DTOMapper { get; }` (line 24), exposes the mapper so callers can do manual
    entity→DTO mapping outside the pipeline when needed (e.g. a custom join result).
  - `GetAllAsync(...)` (lines 36-42), the **simple** overload: navigate FKs and/or children
    (`includeFKs`/`includeChildren`), optionally scope by `Specification`, optionally project `fields`;
    returns `Task<Result<PagedCollectionResult<ExpandoObject>>>`.
  - `GetAllAsync(...)` (lines 59-70), the **full** overload: adds `filters`
    (`Dictionary<string, (string Operator, string Value)>`, a dynamic filter map), `sortColumn`,
    `sortDirection` ("asc"/"desc"), `pageNumber`, `pageSize`. Callers pick the minimal overload for
    their use case.
  - `GetAllForLookupAsync(string nameProperty, ...)` (lines 81-86), returns lightweight
    `IReadOnlyCollection<BaseLookup<TIdentifierType>>` id/name pairs for dropdowns, with optional
    `where` and `orderBy` expressions.
  - `GetEntityByIdAsync(string idValue, ...)` (lines 100-108), returns the raw `Result<TEntity>` (the
    tracked entity) for command handlers that need to mutate it; takes the id as a string plus an
    optional `idField` so non-`Id` lookups are possible.
  - `GetByIdAsync(TIdentifierType id, ...)` (lines 121-128), returns a projected
    `Result<ExpandoObject>` for read-only detail responses.
  - `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, ...)` (lines
    137-140), a cheap existence check; `ignoreQueryFilters` can bypass the global soft-delete filter.
- **Why it's built this way**: a single generic read contract over every entity lets the generic
  controller base (G12) expose uniform list/detail/lookup/exists endpoints without per-entity query
  code, while the `ExpandoObject` + `fields` shaping keeps the wire payload caller-controlled. Splitting
  `GetEntityByIdAsync` (raw entity) from `GetByIdAsync` (shaped DTO) cleanly separates the command-side
  need (a tracked aggregate to mutate) from the query-side need (a projected response).
- **Where it's used**: implemented by [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (this group), which delegates the heavy lifting to the [`IEntityQueryPipeline`](#ientityquerypipeline);
  consumed by every read endpoint through the generic controller base (G12).

### CrossSourceSpecification
> MMCA.Common.Application · `MMCA.Common.Application.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` · Level 8 · class (static)

- **What it is**: a static helper that builds a specification filtering a *dependent* entity by a
  condition on a **cross-source principal** it references by foreign key. Its single method,
  `BuildAsync`, resolves the matching principal keys first (a scalar query against the principal's own
  data source) and returns an [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) whose
  criteria is the engine-portable `localPredicate AND principalKeys.Contains(dependent.ForeignKey)`.
- **Depends on**: [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype)
  and [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (the return
  type), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) +
  `GetReadRepository<,>`/`GetProjectedAsync` (G07) to query the principal source,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TPrincipal` constraint) and [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TDependent` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, cross-source filtering under polyglot persistence `[Rubric §8, Data
  Architecture]`.** In a database-per-service / polyglot setup an entity and a related entity can live
  in *different physical data sources* (e.g. a Cosmos-stored `Session` referencing a SQL-Server `Event`).
  A query cannot join across physical sources, so a predicate that *navigates*, `s => s.Event.IsPublished`
 , is not translatable; on Cosmos the cross-source navigation is even degraded out of the model
  entirely by [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention).
  The engine-portable alternative is **resolve-then-filter-by-FK**: read the principal keys that satisfy
  the condition from the principal's own source, then filter the dependent by
  `foreignKey IN (those keys)` (which every provider translates, SQL `IN`, Cosmos `ARRAY_CONTAINS`).
  This is the runtime counterpart to ADR-018's polyglot model, and it is enforced by the opt-in
  [`SpecificationsDoNotNavigateToOtherEntities`](group-27-testing-infrastructure.md#specificationconventiontestsbase)
  fitness rule (G25).
- **Walkthrough**
  - `BuildAsync<TDependent, TDependentId, TPrincipal, TPrincipalId>(IUnitOfWork unitOfWork, Expression<Func<TPrincipal, bool>> principalPredicate, Expression<Func<TDependent, TPrincipalId>> dependentForeignKey, Expression<Func<TDependent, bool>>? localPredicate = null, CancellationToken = default)`
    (lines 39-64), four type parameters: the dependent + its id, and the principal + its id (which is
    also the dependent's FK type). Constraints require `TPrincipal : AuditableBaseEntity<TPrincipalId>`.
  - Resolves keys: `unitOfWork.GetReadRepository<TPrincipal, TPrincipalId>()` then
    `GetProjectedAsync(p => p.Id, principalPredicate, asTracking: false, ct)` (lines 54-57), materialized
    once into a list (line 60) so the predicate embeds a stable collection EF can translate.
  - `BuildCriteria` (lines 66-91) builds `Enumerable.Contains(keys, fk)` via `Expression.Call` (line
    74-79); if a `localPredicate` is supplied it is rebound onto the FK selector's parameter and ANDed
    with `Expression.AndAlso` (lines 81-88), deliberately **not** `Expression.Invoke`, so the combined
    predicate stays translatable on every provider.
  - `ParameterReplacer` (`CrossSourceSpecification.cs:93`, a private sealed `ExpressionVisitor`) does
    the rebind, swapping the local predicate's parameter for the FK selector's so the two trees share
    one lambda parameter.
- **Why it's built this way**: it makes a module's storage engine a movable choice (ADR-018): a
  Session-by-published-event filter written this way keeps working whether `Session` is in SQL Server,
  SQLite, or Cosmos, with no query rewrite. Returning an `InlineSpecification` means the result drops
  straight into the existing `IEntityQueryService` / read-repository `specification` argument.
- **Where it's used**: ADC Conference's
  [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterquery-getpublicsessionfilterhandler)
  (G18), which resolves published `Event` ids and filters `Session.EventId IN (…)`, the refactor that
  replaced the former navigation-based `PublicSessionSpecification`.
- **Caveats / not-in-source**: the matching keys are materialized and embedded in the predicate, so
  this fits **small/bounded** principal sets (the common "published events", "active tenants" shape);
  an unbounded principal set would inline a very large `IN` list. The class doc (lines 17-20) states
  this explicitly.


---
[⬅ Domain Building Blocks (Entities, Value Objects, Aggregates)](group-02-domain-building-blocks.md)  •  [Index](00-index.md)  •  [Domain & Integration Events + Outbox Dual-Dispatch ➡](group-04-events-outbox.md)
