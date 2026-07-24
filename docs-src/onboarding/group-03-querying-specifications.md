# 3. Querying: Specifications, Filtering & the Entity Query Service

**What this group covers.** Every read in MMCA.Common and ADC ("list the published events", "get session 42", "the speakers in Atlanta, page 3, sorted by name, with only the `name` and `bio` fields") flows through one reusable read engine. This chapter is the read side of CQRS (the command/query split is introduced in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)): side-effect-free queries that turn query-string knobs into `WHERE`, `ORDER BY`, `OFFSET`, and `SELECT` clauses the database executes, then shape the rows down to the fields the caller asked for. There is no per-entity repository method and no hand-rolled `IQueryable` plumbing in each controller: add an entity and it inherits filtering, sorting, paging, sparse-fieldset projection, and eager loading of navigations. The trade-offs behind that generic read surface (dynamic filtering, sparse fieldsets, per-type filter strategies, the pagination header, the unbounded-result ceiling, and the two-path include strategy) are recorded in [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html), which also explains how it composes with manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), and the Result pattern at the edge ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)).

Three sub-systems cooperate here, and it pays to hold them apart from the start:

1. **The Specification pattern** (Domain layer): the type-safe, programmer-authored predicate. A compiled `Expression<Func<TEntity, bool>>` that usually carries an authorization or business scope the caller must not be able to override ("only sessions belonging to this speaker").
2. **Dynamic filtering, sorting, and field selection** (Application layer): the string-driven, user-authored shaping behind `?filter=...&sort=...&fields=...`. Untrusted input that must be validated against the entity's real properties before it reaches the database.
3. **The query pipeline and the entity query service** (Application layer): the orchestrator that composes both, decides how to load navigations given the data source's JOIN capabilities, runs the query, and packages the result with pagination metadata.

The split matters: specifications are trusted and live with the domain, dynamic filters are untrusted and are validated, capped, and reflection-cached at the application boundary.

## The Specification pattern, the trusted predicate

[`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12`) exposes two faces of one rule: a `Criteria` expression tree that EF Core translates to SQL, so the filter runs in the database rather than in memory after a full-table load (`ISpecification.cs:17`), and `IsSatisfiedBy(entity)` for in-memory evaluation (`ISpecification.cs:22`). The abstract base [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`) compiles the expression lazily and caches the delegate in a private field (`Specification.cs:27`, `Specification.cs:32`), so repeated in-memory checks do not recompile the tree.

The three combinators, [`AndSpecification<TEntity, TIdentifierType>`](#andspecificationtentity-tidentifiertype) (`Specification.cs:62`), [`OrSpecification<TEntity, TIdentifierType>`](#orspecificationtentity-tidentifiertype) (`Specification.cs:88`), and [`NotSpecification<TEntity, TIdentifierType>`](#notspecificationtentity-tidentifiertype) (`Specification.cs:114`), each build a fresh lambda over a single shared `ParameterExpression` and embed the operands with `Expression.Invoke`, combined by `Expression.AndAlso`, `Expression.OrElse`, or `Expression.Not` (`Specification.cs:75`, `Specification.cs:101`, `Specification.cs:126`). Rebuilding the lambda, rather than composing delegates, is what keeps the combined `Criteria` a single translatable tree. ADC's concrete specifications (`PublishedEventSpecification` and `OwnEventQuestionAnswerSpecification` under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/`, plus `OwnSessionQuestionAnswerSpecification` under `.../Sessions/Specifications/`) are how a controller scopes a query to the current user's data without trusting the request to do it. This is [Rubric §4, Domain-Driven Design] (the rule is a first-class, reusable domain object) and [Rubric §2, Design Patterns] (a textbook Specification), with a [Rubric §11, Security] overtone: an authorization predicate is server-supplied criteria the client cannot tamper with.

Two members round the family out for polyglot persistence ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype) (`Specification.cs:45`) wraps an already-composed `Criteria` expression as a first-class specification, for predicates built at runtime where no hand-written class exists. The static [`CrossSourceSpecification`](#crosssourcespecification) (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22`) builds the cross-source filter: when a dependent entity references a principal that lives in a different physical data source (database-per-service, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), a navigating predicate like `s => s.Event.IsPublished` cannot be translated, so `BuildAsync` first projects the matching principal keys from the principal's own source (`CrossSourceSpecification.cs:55`), materializes them once (`CrossSourceSpecification.cs:60`), and returns an `InlineSpecification` whose body is an `Enumerable.Contains(keys, dependent.ForeignKey)` call that translates to `IN` or `ARRAY_CONTAINS` (`CrossSourceSpecification.cs:74`). An optional local predicate on the dependent's own columns is rebound onto the foreign-key selector's parameter by the nested [`ParameterReplacer`](#parameterreplacer) visitor (`CrossSourceSpecification.cs:85`, class at `CrossSourceSpecification.cs:93`) and ANDed in, deliberately without `Expression.Invoke` so the combined predicate stays translatable on every provider. The doc comment is explicit about the limit: the keys are embedded in the predicate, so the shape fits bounded principal sets (`CrossSourceSpecification.cs:17`). The convention is guarded by an opt-in fitness rule, [`SpecificationConventionTestsBase`](group-27-testing-infrastructure.md#specificationconventiontestsbase).

## Dynamic filtering, one Strategy per CLR type

User filters arrive as a `Dictionary<string, (string Operator, string Value)>`, property name to operator key plus raw string value, parsed from the query string by [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) at the API edge. Turning `("Name", "CONTAINS", "blazor")` into a `.Where()` clause depends entirely on the property's CLR type, so instead of one large `switch` each type gets an [`IFilterStrategy`](#ifilterstrategy) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6`) declaring an `Apply` method (`IFilterStrategy.cs:17`) and the operator set it supports (`IFilterStrategy.cs:24`, where the default `SupportedOperators` is `null`, meaning validation is skipped for custom strategies). The seven built-ins each override that default with a `FrozenSet`: [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:12`: `CONTAINS`, `NOT CONTAINS`, `EQUALS`, `NOT EQUALS`, `STARTS WITH`, `ENDS WITH`, `IS EMPTY`, `IS NOT EMPTY`, `IN`), [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:12`) and [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:14`), which share one numeric set (equality, the four comparisons, `IN`, an inclusive `BETWEEN` range, and the two presence checks, parsed invariant-culture), [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:14`: the same numeric set with invariant-culture parsing), [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:13`: `IS`, `IS NOT`, `IS AFTER`, `IS ON OR AFTER`, `IS BEFORE`, `IS ON OR BEFORE`, the two presence checks, `IN`, and `BETWEEN`), [`BoolFilterStrategy`](#boolfilterstrategy) (`BoolFilterStrategy.cs:12`: `IS` plus the two presence checks), and [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:13`: `EQUALS`, `NOT EQUALS`, `IN`, and the two presence checks; GUIDs have no ordering, so no comparisons). Each builds its clause through **System.Linq.Dynamic.Core** string predicates with parameter placeholders (`@0`), never string-concatenated values, and each silently returns the unfiltered query when the raw value fails to parse. The comma-separated `IN` list is split by the internal [`FilterValueParser`](#filtervalueparser) (`FilterValueParser.cs:8`): its `ParseList<T>` for numeric/Guid lists skips unparseable entries rather than failing the request (`FilterValueParser.cs:17`, the `if (parse(part) is { } parsed)` guard at `FilterValueParser.cs:26`), while its `ParseStringList` simply splits on comma and drops empty/whitespace entries with no per-item parse step (`FilterValueParser.cs:34`).

The static [`QueryFilterService`](#queryfilterservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19`) is the registry and dispatcher. It seeds a `ConcurrentDictionary<Type, IFilterStrategy>` with the built-ins, registering both the value type and its `Nullable<>` form (`QueryFilterService.cs:26`), exposes `RegisterStrategy` so a module can add a custom type without touching framework code (`QueryFilterService.cs:57`, the open/closed principle made literal, [Rubric §1, SOLID]), caches `PropertyInfo` lookups per (entity type, property name) to avoid per-request reflection (`QueryFilterService.cs:24`), and routes nested paths like `"Category.Name"` through a dedicated string strategy instance because Dynamic LINQ traverses the chain as a string expression (`QueryFilterService.cs:49`, `QueryFilterService.cs:104`). It has two phases, and the ordering is the security story: `ValidateFilters` (`QueryFilterService.cs:126`) runs before the query and returns a [`Result`](group-01-result-error-handling.md#result) carrying every [`Error`](group-01-result-error-handling.md#error) it found (`Filter.Property.NotFound` at `QueryFilterService.cs:158`, `Filter.Type.NotSupported` at `QueryFilterService.cs:179`, `Filter.Operator.NotSupported` at `QueryFilterService.cs:219`), so a bad filter is a validation failure and not a SQL exception; `ApplyFilters` (`QueryFilterService.cs:73`) then builds the actual `.Where()` chain, skipping any property it cannot resolve (`QueryFilterService.cs:97`). This is [Rubric §2, Design Patterns] (Strategy) and [Rubric §11, Security] (untrusted input allow-listed against real entity metadata).

## Sorting and sparse fieldsets, QueryFieldService

[`QueryFieldService`](#queryfieldservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16`) owns the other three pieces of read shaping. `ApplySorting` (`QueryFieldService.cs:120`) resolves a DTO sort name through the server-authored map, and otherwise accepts the column **only** when it names a real public property of the entity, falling back to the optional default sort when it does not (`QueryFieldService.cs:129`, `QueryFieldService.cs:142`). That guard is deliberate and documented in the summary (`QueryFieldService.cs:109`): a client-supplied string can never reach Dynamic LINQ to order by nested paths or expressions the DTO does not expose. `ApplyFieldSelection` (`QueryFieldService.cs:154`) builds a `MemberInit` `Select` expression so a `fields=name,bio` request pulls only those columns from the database ([Rubric §12, Performance & Scalability]), restricted to writable properties because the projection needs setters (`QueryFieldService.cs:167`). `ShapeData` and `ShapeCollectionData` (`QueryFieldService.cs:52`, `QueryFieldService.cs:77`) produce the wire shape: an `ExpandoObject` (or a list of them) holding only the requested fields under camelCase keys.

To make that last step cheap on large result sets, the service caches a per-type array of [`PropertyAccessor`](#propertyaccessor) (`QueryFieldService.cs:23`), a private `readonly record struct` bundling each property's name, its precomputed camelCase key, and a compiled `Func<object, object?>` getter built with `Expression.Lambda(...).Compile()` rather than `PropertyInfo.GetValue` (`QueryFieldService.cs:25` to `QueryFieldService.cs:42`). Shaping a thousand rows is then a delegate call per field. Validation mirrors the filter side: `Validate<TEntity>` rejects unknown field names and (when shaping) read-only properties (`QueryFieldService.cs:197`), and `ValidateSortDirection` accepts only `asc` or `desc` (`QueryFieldService.cs:243`).

## The pipeline, two paths and one contract

[`IEntityQueryPipeline`](#ientityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10`) is the execution contract, implemented by the sealed [`EntityQueryPipeline`](#entityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`), which talks to the database through the [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) abstraction rather than referencing EF Core from the Application layer ([Rubric §3, Clean Architecture]). Its inputs are bundled into [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11`), an immutable record carrying the specification `Criteria`, the dynamic `Filters`, sort column and direction, `Fields`, page number and size, the two include flags, and the DTO-to-entity property map (defaulting to an empty `FrozenDictionary`, `EntityQueryParameters.cs:44`).

`ExecuteAsync` (`EntityQueryPipeline.cs:26`) first adds every supported navigation as an `.Include()` (`EntityQueryPipeline.cs:42`), forcing `AsSplitQuery()` when a child collection is among them (`EntityQueryPipeline.cs:49`). The comment above that line records the hard-won reason, annotated `R24/§8`: paginating a single-query collection include truncates child rows because EF applies `Skip`/`Take` to the JOIN-expanded set, so list reads returned empty child collections while by-id reads worked (`EntityQueryPipeline.cs:45`). It then applies the specification criteria and the dynamic filters **before** materializing anything (`EntityQueryPipeline.cs:57`, `EntityQueryPipeline.cs:60`), so the data source does as much of the work as possible. From there it branches. **Path 1, server-side includes** (`EntityQueryPipeline.cs:125`): sort, count before paging, `Skip`/`Take`, field-selection `Select`, materialize. **Path 2, manual navigation** (`EntityQueryPipeline.cs:76`), taken when any requested navigation crosses a physical data source and cannot be joined: sort and page at the database first, materialize the page, then invoke the `navigationPopulator` callback to batch-load those navigations in a second query (`EntityQueryPipeline.cs:110`), the [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) extension point of [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), and apply field selection in memory afterwards (`EntityQueryPipeline.cs:117`). Both paths share one [Rubric §12, Performance] safety ceiling: an unpaginated query is capped at `MaxUnboundedResultLimit`, a public `const int` of 1000 (`EntityQueryPipeline.cs:23`, applied at `EntityQueryPipeline.cs:104` and `EntityQueryPipeline.cs:151`), and a paginated call has its page size clamped to that same ceiling (`EntityQueryPipeline.cs:96`, `EntityQueryPipeline.cs:143`), so a service caller who forgets or oversizes paging can never trigger an unbounded full-table load.

Which navigations are eligible, and which path each takes, is decided by [`NavigationMetadataProvider`](#navigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`) behind [`INavigationMetadataProvider`](#inavigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9`). It reflects over the entity's public properties looking for [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (`NavigationMetadataProvider.cs:74`), unwraps collection types to find the target entity (`NavigationMetadataProvider.cs:106`), and asks [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) whether the two ends share a JOIN-capable source, sorting each into the supported or unsupported bucket of [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (`NavigationMetadataProvider.cs:96`). Results are cached per (entity type, [`NavigationType`](group-11-navigation-populators.md#navigationtype)) in an **instance-level** dictionary, not a static one, precisely so that a process hosting more than one data-source configuration (integration tests, for example) cannot share classifications across hosts (`NavigationMetadataProvider.cs:28`).

## The query service, the public face

[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19`) and its concrete [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:31`) are what controllers and handlers inject. The service is constructed from [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the metadata provider, the pipeline, an [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), and an `INavigationPopulator<TEntity>` (`EntityQueryService.cs:32` to `EntityQueryService.cs:36`), and it resolves its [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) from the unit of work through a `virtual` property (`EntityQueryService.cs:48`).

`GetAllAsync` is the four-step orchestration. **(1) Validate** every parameter up front with `Result.Combine` over the fields, sort-column, sort-direction, and filter validators, so a bad `fields` fails before any database hit (`EntityQueryService.cs:183`). **(2) Build the query** in `BuildQueryAsync` (`EntityQueryService.cs:366`): pick `Repository.Table` or `TableNoTracking` from the `asTracking` flag (`EntityQueryService.cs:379`), ask the metadata provider which includes are supported, pack everything into `EntityQueryParameters`, and hand off to `IEntityQueryPipeline.ExecuteAsync` with the populator callback (`EntityQueryService.cs:399`). **(3) Map and shape**: convert entities to DTOs through `DTOMapper.MapToDTOs`, then shape **only when a field subset was requested**, otherwise return the typed DTOs as-is to avoid a per-row `ExpandoObject` allocation and boxing (`EntityQueryService.cs:222` to `EntityQueryService.cs:226`); both forms serialize to the same camelCase JSON, which is why the return type is `PagedCollectionResult<object>` rather than a typed collection. **(4) Wrap** in [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata), which for an unpaginated call reports the total count as the page size and page 1 (`EntityQueryService.cs:407`).

The by-id path has a fast lane worth knowing. `GetEntityByIdAsync` (`EntityQueryService.cs:266`) validates the fields, then tries `TryGetByIdFastPathAsync` (`EntityQueryService.cs:80`): when the request is a plain primary-key lookup (no projection, no includes, no specification, default `Id` field, per `IsPrimaryKeyOnlyLookup` at `EntityQueryService.cs:102`) and the string id converts to the identifier type via a cached `TypeConverter` (`EntityQueryService.cs:68`, `EntityQueryService.cs:119`), it issues a single keyed repository read on the filtered `TableNoTracking`, so soft-delete query filters still apply, instead of running the dynamic-filter pipeline. Anything else falls through to the pipeline with a synthetic `Id EQUALS <value>` filter (`EntityQueryService.cs:298`) and returns `Error.NotFound` when the page is empty (`EntityQueryService.cs:317`). `GetByIdAsync` (`EntityQueryService.cs:327`) layers DTO mapping and the same shape-only-if-fields rule on top; `GetAllForLookupAsync` (`EntityQueryService.cs:238`) returns lightweight [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) id/name pairs for dropdowns; `ExistsAsync` (`EntityQueryService.cs:357`) delegates straight to the repository. The class is built for extension over modification ([Rubric §1, SOLID]): `Repository`, `DTOToEntityPropertyMap` (`EntityQueryService.cs:61`, where a module maps `"CategoryName"` to `"Category.Name"`), and every query method are `virtual`, so a module subclass such as [`SpeakerEntityQueryService`](group-18-conference-application.md#speakerentityqueryservice) overrides one behavior without reimplementing the engine.

## End to end, one list request

The request reaches a read controller, [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) or [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (Group 12), which clamps `pageSize` to `MaxPageSize` from [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), falling back to 500 when unset (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:55`, clamp at `EntityControllerBase.cs:127`), binds `?filter=` through `QueryFilterModelBinder`, and may supply a server-authored specification for authorization scope. It calls `IEntityQueryService.GetAllAsync`. The service validates fields, sort, and filters (an early failure short-circuits to an error result), classifies the requested includes, and packages an `EntityQueryParameters`. `EntityQueryPipeline` chooses Path 1 or Path 2, applies the specification criteria plus the dynamic filters as translated `WHERE` clauses, sorts, counts, pages, projects the requested columns, materializes, batch-loads any cross-source navigations, and returns the entities plus the total. The service maps to DTOs, shapes if a field subset was asked for, and returns a `Result<PagedCollectionResult<object>>` that the controller unwraps into the HTTP body plus an `X-Pagination` header carrying the serialized metadata (`EntityControllerBase.cs:144`). One pipeline, every entity, validated input, server-side execution, and a clean extension point for navigations that cross a service boundary.

### FilterValueParser
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/FilterValueParser.cs:8` · Level 0 · class (internal, static)

- **What it is**: a tiny internal helper that splits the comma-separated value list carried by the
  `IN` filter operator (and the two-bound list behind `BETWEEN`) into a typed list, skipping any
  entry that fails to parse.
- **Depends on**: nothing first-party. BCL only (`string.Split`, `StringSplitOptions`).
- **Concept introduced, set membership in a URL filter, and lenient parsing as a contract.** The
  dynamic-filter vocabulary is one operator string plus one value string per property (see
  [`IFilterStrategy`](#ifilterstrategy)), so an `IN` filter has to smuggle a *set*, and `BETWEEN` a
  *pair of bounds*, through a single string. This class is the one place that decodes that
  convention:
  `value.Split(Separator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)`
  (`FilterValueParser.cs:24`, `:39`), so `"1, 2 ,3"` and `"1,2,3"` behave identically and empty slots
  vanish. `[Rubric §9, API & Contract Design]` (assesses whether the query conventions are uniform
  and predictable): every strategy that supports `IN` or `BETWEEN` decodes the list the same way, so
  the client never has to learn a per-type list syntax. `[Rubric §15, Best Practices & Code Quality]`
  (assesses defensive, exception-free handling of untrusted input): the doc comment (`:3-7`) states
  the rule explicitly, an unparseable entry is *skipped*, matching the single-value strategies which
  silently return the unfiltered query rather than throwing, so one malformed entry never fails the
  request.
- **Walkthrough**
  - `Separator` (`:10`): a `static readonly char[]` holding a single comma, hoisted to a field so the
    array is allocated once rather than per call.
  - `ParseList<T>(string value, Func<string, T?> parse)` (`:17-31`), constrained `where T : struct`.
    The caller supplies the per-item parse delegate, so the parser stays type-agnostic. A
    null/whitespace input returns an empty list (`:21-22`); each part is run through `parse` and
    added only when the nullable result has a value (`if (parse(part) is { } parsed)`, `:26-27`).
  - `ParseStringList(string value)` (`:34-40`): the string overload, no per-item parse needed, just
    the split with the same options, returning `[]` for empty input (`:37`).
- **Why it's built this way**: the `Func<string, T?>` shape lets each caller pass its own
  `TryParse` in a `static` lambda, so no closure is allocated (see
  [`IntFilterStrategy`](#intfilterstrategy)`.ApplyIn`, `IntFilterStrategy.cs:46`). Returning a
  `List<T>` rather than an array matters downstream: LINQ Dynamic binds it as the receiver of a
  `Contains` call.
- **Where it's used**: every value strategy that supports `IN` or `BETWEEN` routes through it:
  [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:55`, `:62`),
  [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:51`, `:58`),
  [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:34`),
  [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:46`, `:53`), and
  [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:51`, `:58`) call `ParseList`;
  [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:45`) calls
  `ParseStringList`.
- **Caveats / not-in-source**: `internal`, so a consumer writing a custom
  [`IFilterStrategy`](#ifilterstrategy) outside this assembly cannot reuse it and must decode its own
  list syntax. There is no size cap on the parsed list in this class; nothing here bounds how many
  values an `IN` filter may carry.

---

### IFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6` · Level 0 · interface

- **What it is**: the Strategy-pattern contract for dynamic query filtering. Each implementation
  handles one CLR property-type family (string, int, long, DateTime, bool, decimal, Guid) and turns
  an operator key plus a raw string value into a `.Where()` clause on an `IQueryable<T>`.
- **Depends on**: nothing first-party. `System.Linq` (BCL).
- **Concept introduced, the Strategy pattern for open-ended extensibility.** `[Rubric §2, Design
  Patterns]` (assesses whether patterns are applied idiomatically to real problems): instead of one
  growing `switch (propertyType)` inside a single filtering class, every filterable type gets its own
  strategy object and [`QueryFilterService`](#queryfilterservice) holds a `Type -> IFilterStrategy`
  dictionary. Adding a filterable type means adding a class and registering it, with no edit to
  existing code, the textbook Open/Closed shape (`[Rubric §1, SOLID]`). `[Rubric §9, API & Contract
  Design]` (assesses consistent query conventions across the API surface): a single operator
  vocabulary for every entity in both apps flows from this one contract.
- **Walkthrough**
  - `IQueryable<T> Apply<T>(IQueryable<T> query, string property, string op, string value)`
    (`IFilterStrategy.cs:17`). `property` is the entity property name or dotted path, `op` is the
    operator string **already uppercased by the caller** (stated in the doc comment, `:14`), and
    `value` is the raw string. The documented return contract (`:16`) is to hand back the *original*
    query when the operator is unrecognized: filtering is best-effort and never throws.
  - `IReadOnlySet<string>? SupportedOperators => null` (`:24`), a **default interface member**. A
    default interface member supplies a body on the interface itself, so an implementer can ignore it
    entirely. Returning `null` means "skip operator validation" (`:21-23`), the tolerant default for a
    third-party strategy; the seven built-in strategies override it with a `FrozenSet` so
    [`QueryFilterService`](#queryfilterservice) can reject an unknown operator up front as a
    validation failure instead of letting it degrade into a silent no-op.
- **Why it's built this way**: operators are plain strings rather than an enum, so a consumer can
  extend the vocabulary without a framework change; splitting per type keeps each type's parsing and
  comparison rules isolated and unit-testable.
- **Where it's used**: implemented by the seven built-in strategies below; the registry, the
  dispatch, and the up-front validation all live in [`QueryFilterService`](#queryfilterservice).

---

### PropertyAccessor
> MMCA.Common.Application · `MMCA.Common.Application.Services` (private, nested in `QueryFieldService`) · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:23` · Level 0 · record struct (readonly, private)

- **What it is**: a tiny `private readonly record struct` declared inside
  [`QueryFieldService`](#queryfieldservice) that bundles a property's CLR name, its pre-computed
  camelCase JSON name, and a compiled `Func<object, object?>` getter, so a property value can be read
  without per-call reflection.
- **Depends on**: nothing first-party. `System.Reflection`, `System.Linq.Expressions` (BCL).
- **Concept introduced, compile-once expression delegates instead of per-call reflection.**
  `[Rubric §12, Performance & Scalability]` (assesses whether hot paths avoid avoidable per-request
  work): `PropertyInfo.GetValue` allocates an argument array on *every* invocation, and shaping a
  1,000-row page with 20 properties would pay that cost 20,000 times. Building a
  `Func<object, object?>` once per type from an `Expression.Lambda` (`QueryFieldService.cs:33-37`) and
  caching it collapses each read to a delegate call. The `readonly record struct` shape is the
  idiomatic .NET carrier for a small immutable tuple of values: no heap allocation per element,
  structural equality for free.
- **Walkthrough**: the whole type is one positional declaration,
  `private readonly record struct PropertyAccessor(string PropertyName, string CamelCaseName,
  Func<object, object?> GetValue)` (`QueryFieldService.cs:23`).
  - `PropertyName` matches a requested `?fields=` entry, case-insensitively
    (`QueryFieldService.cs:280`).
  - `CamelCaseName` is computed once at construction with `JsonNamingPolicy.CamelCase.ConvertName`
    (`:38`, policy held at `:20`) and becomes the `ExpandoObject` key, so the shaped payload matches
    the JSON casing a typed DTO would produce.
  - `GetValue` is the compiled getter, invoked once per property per row inside `ShapeData` (`:64`)
    and `ShapeCollectionData` (`:95`).
- **Why it's built this way**: `private` keeps a hot-path implementation detail out of the public
  surface; the struct plus record combination gives an allocation-free value carrier that is cheap to
  store in the cached array.
- **Where it's used**: exclusively inside [`QueryFieldService`](#queryfieldservice). The
  `AccessorCache` (`ConcurrentDictionary<Type, PropertyAccessor[]>`, `:19`) is populated once per
  entity/DTO type by `GetAccessors<TEntity>` (`:25-42`) and iterated by the two shaping methods.

---

> The **seven built-in filter strategies** that follow share one shape: each is an `internal sealed`
> class implementing [`IFilterStrategy`](#ifilterstrategy) for one CLR type family, declaring its
> `SupportedOperators` as a `HashSet` built with `StringComparer.Ordinal` and frozen with
> `.ToFrozenSet(StringComparer.Ordinal)` (a `FrozenSet` is the read-optimised immutable set the
> framework reaches for whenever a lookup table is built once and read many times), then switching on
> the operator to build a LINQ Dynamic `.Where()` string. Four rules hold across all seven and are
> not repeated in every section below.
>
> 1. **Bound parameters, never string concatenation.** Values are passed as the positional parameter
>    `@0` (`@0`/`@1` for `BETWEEN`) rather than interpolated into the expression text, so they cross
>    into EF Core as SQL parameters and not as inline SQL (`[Rubric §11, Security]`, which assesses
>    injection resistance).
> 2. **Parse failure is a no-op.** A value that fails to parse (or an unrecognized operator via the
>    `_ =>` default arm) returns the **unfiltered** query rather than throwing, exactly the no-op the
>    [`IFilterStrategy`](#ifilterstrategy) contract promises.
> 3. **`IN` is set membership.** The value strategies that support `IN` decode a comma list through
>    [`FilterValueParser`](#filtervalueparser) and emit `@0.Contains({property})`, with the parsed
>    list as the *receiver* `@0` and the entity property as the argument, the shape LINQ Dynamic turns
>    into SQL `IN (...)`. An empty parsed list short-circuits to the unfiltered query, so `IN` with no
>    usable value matches everything rather than nothing. `[Rubric §12, Performance & Scalability]`: a
>    UI that fetches many rows by id issues one query instead of a chain of round trips.
> 4. **`BETWEEN` is an inclusive range, `IS EMPTY` / `IS NOT EMPTY` are value-free null checks.**
>    `BETWEEN` reads exactly two comma-separated bounds and emits
>    `{property} >= @0 && {property} <= @1` (inclusive on both ends); a list that is not exactly two
>    bounds is a no-op. `IS EMPTY` / `IS NOT EMPTY` take no value at all and emit `{property} == null`
>    / `{property} != null`, so a nullable column can be filtered for presence.
>
> The complete operator matrix, verbatim from source:
>
> | Strategy | File:Line | Supported operators |
> |----------|-----------|---------------------|
> | `BoolFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/BoolFilterStrategy.cs:12` | `IS`, `IS EMPTY`, `IS NOT EMPTY` |
> | `DateTimeFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` | `IS`, `IS NOT`, `IS AFTER`, `IS ON OR AFTER`, `IS BEFORE`, `IS ON OR BEFORE`, `IS EMPTY`, `IS NOT EMPTY`, `IN`, `BETWEEN` |
> | `DecimalFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:14` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL`, `IN`, `BETWEEN`, `IS EMPTY`, `IS NOT EMPTY` |
> | `GuidFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:13` | `EQUALS`, `NOT EQUALS`, `IN`, `IS EMPTY`, `IS NOT EMPTY` |
> | `IntFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:12` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL`, `IN`, `BETWEEN`, `IS EMPTY`, `IS NOT EMPTY` |
> | `LongFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/LongFilterStrategy.cs:14` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL`, `IN`, `BETWEEN`, `IS EMPTY`, `IS NOT EMPTY` |
> | `StringFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/StringFilterStrategy.cs:12` | `CONTAINS`, `NOT CONTAINS`, `EQUALS`, `NOT EQUALS`, `STARTS WITH`, `ENDS WITH`, `IS EMPTY`, `IS NOT EMPTY`, `IN` |

### BoolFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/BoolFilterStrategy.cs:12` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `bool` and `bool?` properties, and the
  smallest member of the family: one equality operator plus the two null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core` (the `query.Where("expr", args)` string-expression API taught in
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0)).
- **Walkthrough**: `SupportedOperators` is the three-entry frozen set `{ "IS", "IS EMPTY", "IS NOT
  EMPTY" }` (`:14-17`). `Apply<T>` (`:19-27`) puts the value-free presence checks *first*, before the
  parse, because they do not depend on the value (the inline comment states this, `:22`):
  `"IS EMPTY" => query.Where($"{property} == null")` and `"IS NOT EMPTY" => query.Where($"{property}
  != null")` (`:23-24`). The one equality arm parses inside a `when` guard,
  `"IS" when bool.TryParse(value, out var boolValue) => query.Where($"{property} == @0", boolValue)`
  (`:25`), so `?isActive=IS:maybe` fails the guard and falls to `_ => query` (`:26`) rather than
  throwing.
- **Why it's built this way**: `IS` (rather than `EQUALS`) reads naturally for a boolean in a URL
  filter, and a boolean has no ordering, so no comparison operators exist to support; the null checks
  are the meaningful extra for a `bool?` column.
- **Where it's used**: registered against both `typeof(bool)` and `typeof(bool?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:30-31`). Note that the two keys
  get **two separate instances**, not one shared instance.
- **Caveats / not-in-source**: there is no `IN` arm, since a boolean set is degenerate.

---

### DateTimeFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `DateTime` and `DateTime?`, covering
  the six temporal comparisons, the two null checks, set membership (`IN`), and an inclusive
  `BETWEEN` range.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Globalization`,
  `System.Collections.Frozen`, `System.Linq.Dynamic.Core`.
- **Concept introduced, culture-invariant parsing of untrusted input.** `FormatProvider` is a static
  `CultureInfo.InvariantCulture` (`:15`) used by every `DateTime.TryParse` call, so `"2026-07-21"`
  parses identically regardless of the server's locale. That is the single-locale, culture-safe
  posture described in [primer §4](00-primer.md#4-c-build-and-code-style-conventions), and it is what
  keeps a filter from meaning different things on two hosts in the same cluster.
- **Walkthrough**: `SupportedOperators` (`:17-22`) is the ten-entry frozen set. `Apply<T>`
  (`:24-43`) parses **inside** each temporal arm via a `when` clause, for example
  `"IS AFTER" when DateTime.TryParse(value, FormatProvider, DateTimeStyles.None, out var dt) =>
  query.Where($"{property} > @0", dt)` (`:31-32`). A failed parse means the `when` guard is false and
  the arm does not match. The two null operators need no value: `"IS EMPTY" => query.Where($"{property}
  == null")` and `"IS NOT EMPTY" => query.Where($"{property} != null")` (`:39-40`). The `_ =>` arm
  routes to `ApplyInOrRange` (`:42`), which dispatches `IN` to `ApplyIn` and `BETWEEN` to
  `ApplyBetween` (`:45-51`). `ApplyIn` (`:53-57`) parses through
  [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseDateTime` helper (`:55`) and
  emits `@0.Contains({property})` (`:56`); `ApplyBetween` (`:59-66`) requires exactly two bounds and
  emits `{property} >= @0 && {property} <= @1` (`:64`). `ParseDateTime` (`:68-69`) is the shared
  culture-invariant `TryParse`.
- **Why it's built this way**: parsing per arm keeps the value-taking and the value-free operators in
  one switch without a pre-parse that would reject `IS EMPTY` for having no parsable value; splitting
  `IN`/`BETWEEN` into a helper keeps the main switch under the analyzers' cyclomatic-complexity
  ceiling.
- **Where it's used**: registered against `typeof(DateTime)` and `typeof(DateTime?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:36-37`), as two instances.
- **Caveats / not-in-source**: nothing here normalizes to UTC: the parsed value is used as given
  (`DateTimeStyles.None`), so the caller is responsible for supplying a value in the column's kind.

---

### DecimalFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:14` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `decimal` and `decimal?`, supporting
  equality, the four ordering comparisons, set membership (`IN`), an inclusive `BETWEEN`, and the two
  null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Globalization`,
  `System.Collections.Frozen`, `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:16-21`) lists the ten operators. `Apply<T>` (`:23-36`)
  parses each single-value arm through the private `TryParse` helper
  (`decimal.TryParse(value, CultureInfo.InvariantCulture, out result)`, `:38-39`) inside a `when`
  guard, then the six `@0` comparisons (`:26-31`) and the two null checks (`:32-33`). The `_ =>` arm
  routes to `ApplyInOrRange` (`:35`, `:41-47`); `ApplyIn` (`:49-53`) and `ApplyBetween` (`:55-62`)
  parse through [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseDecimal` helper
  (`:64-65`). The invariant culture is the load-bearing detail: it fixes `.` as the decimal
  separator, so a price filter cannot silently change meaning on a host with a different locale.
- **Why it's built this way**: `decimal` (not `double`) is the money/quantity type across the
  codebase, so the filter type matches the storage type exactly and no precision is lost at the
  boundary.
- **Where it's used**: registered against `typeof(decimal)` and `typeof(decimal?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:38-39`).

---

### GuidFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:13` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `Guid` and `Guid?`, supporting
  equality, set membership (`IN`), and the two null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:15-17`) is `{ EQUALS, NOT EQUALS, IN, IS EMPTY, IS NOT
  EMPTY }`. `Apply<T>` (`:20-30`) parses the two single-value equality arms with a `Guid.TryParse`
  `when` guard (`:23-24`), handles the value-free null checks (`:25-26`), and routes `IN` last
  (`:28`) because a comma-separated list would never parse as one GUID. `ApplyIn` (`:32-36`) parses
  through [`FilterValueParser.ParseList`](#filtervalueparser) with a `static` lambda over
  `Guid.TryParse` (`:34`) and emits the receiver-inverted `@0.Contains({property})` (`:35`).
- **Why it's built this way**: GUIDs have no meaningful ordering, so no comparison or range operators
  are provided; equality, membership, and presence are the full useful set for an opaque identifier.
- **Where it's used**: registered against `typeof(Guid)` and `typeof(Guid?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:40-41`). It is the strategy that
  serves by-id filtering wherever an entity's identifier alias resolves to `Guid` (for example the
  Conference module's `SpeakerIdentifierType`).
- **Caveats / not-in-source**: no ordering operators and no `BETWEEN`, since a GUID range is
  meaningless.

---

### IntFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:12` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `int` and `int?`, the widest numeric
  surface: equality, the four ordering comparisons, `IN`, an inclusive `BETWEEN`, and the two null
  checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:14-19`) holds the ten operators. `Apply<T>` (`:21-34`)
  handles the six single-value comparison arms with an inline `int.TryParse` guard (`:24-29`) and the
  two value-free null checks (`:30-31`), then falls to `ApplyInOrRange` (`:33`, `:36-42`). `ApplyIn`
  (`:44-48`) parses through [`FilterValueParser.ParseList`](#filtervalueparser) with a `static` lambda
  over `int.TryParse` (`:46`); `ApplyBetween` (`:50-57`) requires exactly two bounds
  (`bounds.Count == 2`, `:54`) and emits `{property} >= @0 && {property} <= @1` (`:55`).
- **Why it's built this way**: `int` is the default identifier alias across most modules (for example
  the Identity module's `UserIdentifierType`), so this strategy carries the by-id and by-parent-id
  filtering for the majority of entities, which is why it gets the full comparison/`IN`/`BETWEEN`
  surface.
- **Where it's used**: registered against `typeof(int)` and `typeof(int?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:32-33`); reached indirectly by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype)'s synthetic
  `Id EQUALS` filter (`EntityQueryService.cs:298-301`) whenever the identifier alias is `int`.

---

### LongFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/LongFilterStrategy.cs:14` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `long` and `long?`, a structural twin
  of [`IntFilterStrategy`](#intfilterstrategy): equality, the four ordering comparisons, `IN`, an
  inclusive `BETWEEN`, and the two null checks, over 64-bit integers.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Globalization`,
  `System.Collections.Frozen`, `System.Linq.Dynamic.Core`.
- **Concept, filling a type gap without a startup call.** The class doc comment (`:11-12`) states the
  reason this type exists: it is "registered by default so long-keyed entities filter without a
  startup [`QueryFilterService`](#queryfilterservice)`.RegisterStrategy` call." Earlier editions of
  the framework had no built-in `long` strategy, so a `bigint`-keyed entity had to call
  `RegisterStrategy` at composition time; making it a default entry closes that gap
  (`[Rubric §16, Maintainability]`, which assesses whether a common case works with zero
  configuration).
- **Walkthrough**: `SupportedOperators` (`:16-21`) holds the ten operators. `Apply<T>` (`:23-36`)
  parses each single-value arm through the private `TryParse` helper
  (`long.TryParse(value, CultureInfo.InvariantCulture, out result)`, `:38-39`) inside a `when` guard,
  then the two null checks (`:32-33`), then `ApplyInOrRange` (`:35`, `:41-47`). `ApplyIn` (`:49-53`)
  and `ApplyBetween` (`:55-62`) parse through [`FilterValueParser.ParseList`](#filtervalueparser) with
  the `ParseLong` helper (`:64-65`), the same shape as the `int` and `decimal` strategies.
- **Why it's built this way**: mirroring the `int` strategy keeps the numeric operator vocabulary
  identical whether a key is 32-bit or 64-bit, so a client never has to know the underlying width.
- **Where it's used**: registered against `typeof(long)` and `typeof(long?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:34-35`).

---

### StringFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/StringFilterStrategy.cs:12` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `string` properties, and, because of a
  routing rule in [`QueryFilterService`](#queryfilterservice), the strategy used for **every nested
  property path** regardless of the target type.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy),
  [`FilterValueParser`](#filtervalueparser); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Concept introduced, method-call expressions in LINQ Dynamic.** Where the value strategies emit
  operator comparisons, the text operators emit *method calls* on the property:
  `{property}.Contains(@0)`, `!{property}.Contains(@0)`, `{property}.StartsWith(@0)`,
  `{property}.EndsWith(@0)` (`:23-28`), and `string.IsNullOrEmpty({property})` /
  `!string.IsNullOrEmpty({property})` for the presence checks (`:37-38`). LINQ Dynamic parses the
  string into an expression tree, and EF Core then translates those calls into `LIKE` predicates, so
  the match still runs in the database. `[Rubric §12, Performance & Scalability]`: `CONTAINS`
  translates to a leading-wildcard `LIKE`, which cannot use a normal B-tree index, that is a known
  cost of the convenience, not a defect of this class.
- **Walkthrough**: `SupportedOperators` (`:14-18`) is the nine-entry frozen set, second-largest in
  the family behind the four ten-operator numeric/date strategies (DateTime, Decimal, Int, Long). `Apply<T>` (`:20-30`) handles the six value-taking text operators, then delegates the rest
  to `ApplyPresenceOrSet` (`:34-41`); the inline comment (`:32-33`) records why, the split keeps each
  method under the cyclomatic-complexity ceiling the analyzers enforce as errors. `ApplyPresenceOrSet`
  covers `IS EMPTY`, `IS NOT EMPTY`, and routes `IN` to `ApplyIn` (`:43-47`), which uses
  [`FilterValueParser.ParseStringList`](#filtervalueparser) (`:45`) and emits the same
  `@0.Contains({property})` receiver-inverted form as the other `IN` strategies.
- **Why it's built this way**: the class doc comment (`:6-11`) states the dual role explicitly, this
  strategy also serves nested paths such as `"Category.Name"` "since LINQ Dynamic evaluates the full
  path as a string expression." That is why a nested filter is always validated against *this*
  operator set, even when the leaf property is an `int`.
- **Where it's used**: registered against `typeof(string)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:29`), and held a second time as
  the dedicated `StringStrategy` field (`QueryFilterService.cs:49`) used for the string and
  nested-path routes in both `ApplyFilters` (`:107`) and validation (`:170`, `:205`).
- **Caveats / not-in-source**: nothing here escapes LIKE wildcards, so a `%` inside a `CONTAINS`
  value reaches the database as part of the pattern. The value is still a bound parameter, so this is
  a matching-semantics detail, not an injection vector.

---

### QueryFieldService
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16` · Level 3 · class (sealed, all members static)

- **What it is**: the read-side utility that owns four jobs: **field validation**, **data shaping**
  (sparse-fieldset projection onto `ExpandoObject`), **dynamic sorting**, and **server-side field
  selection** (building an EF `Select` expression). It caches reflected metadata per type so
  reflection is paid once per process, not once per request.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error),
  [`PropertyAccessor`](#propertyaccessor) (its own nested struct); `System.Linq.Dynamic.Core`,
  `System.Dynamic` (`ExpandoObject`), `System.Reflection`, `System.Text.Json`,
  `System.Collections.Concurrent`.
- **Concept introduced, sparse fieldsets and the two-level metadata cache.** `[Rubric §9, API &
  Contract Design]` (assesses whether clients can ask for exactly the data they need): a
  `?fields=id,name` request narrows both the SQL `SELECT` and the JSON payload. `[Rubric §12,
  Performance & Scalability]`: two static `ConcurrentDictionary` caches back everything,
  `PropertiesCache` (`Type -> PropertyInfo[]`, `:18`) for the validation/projection paths and
  `AccessorCache` (`Type -> PropertyAccessor[]`, `:19`) for the shaping path.
  `GetAccessors<TEntity>` (`:25-42`) builds the second from the first, compiling one
  `Expression.Lambda<Func<object, object?>>` per property (`:33-37`) and pre-computing the camelCase
  name (`:38`). Both `GetOrAdd` calls use `static` lambdas, so no closure is allocated on the hot
  path.
- **Walkthrough** (members in teaching order)
  - `ShapeData<TEntity>(entity, fields)` (`:52-68`) and
    `ShapeCollectionData<TEntity>(entities, fields)` (`:77-102`): parse the field list, fetch the
    cached accessors, narrow them when a subset was requested (`:57-58`, `:84-85`), then fill an
    `ExpandoObject` keyed by `CamelCaseName` (`:64`, `:95`). An empty field list means all properties.
  - `ApplySorting<TEntity>` (`:120-143`): resolves the sort column, then emits
    `query.OrderBy($"{sortExpr} {(descending ? "descending" : "ascending")}")` (`:138`), falling back
    to the optional `defaultSort` lambda when nothing valid was supplied (`:142`).
  - `ApplyFieldSelection<TEntity>` (`:154-186`): builds a `MemberInit` expression
    (`new TEntity { Prop = e.Prop, ... }`, `:173-183`) so the projection is pushed into the SQL
    `SELECT`. Only **writable** properties are eligible (`p.CanWrite`, `:167`), since EF cannot
    translate a `MemberInit` that assigns a read-only member; if nothing survives the filter the query
    is returned unprojected (`:170-171`).
  - `Validate<TEntity>(fields, allowWriteableFields)` (`:197-236`): checks every requested field
    exists on the type, case-insensitively (`:209-210`), and, when `allowWriteableFields` is false,
    additionally rejects read-only properties (`:223-230`). It accumulates **all** offenders into a
    list of [`Error`](group-01-result-error-handling.md#error) built from `Error.InvalidEntityField`
    with a `with` expression, then returns one aggregate
    [`Result`](group-01-result-error-handling.md#result) (`:233-235`).
  - `ValidateSortDirection` (`:243-262`): accepts only `"asc"`, `"desc"`, or null/empty, and returns
    an `Error.InvalidSortDirection` validation failure otherwise (`:256-258`).
  - Private helpers: `ParseFields` (`:264-268`) splits the comma list into a case-insensitive
    `HashSet`; `GetProperties<TEntity>` (`:270-273`) reads through `PropertiesCache`;
    `FilterAccessorsByFields` (`:275-281`) narrows the cached accessor array.
- **Why it's built this way**: the sort path is the security-relevant one. A sort column with no
  entry in `dtoToEntityPropertyMap` is accepted **only** when it names a real public property of the
  entity, resolved by reflection (`:129-133`); anything else is null and falls through to
  `defaultSort` without ever reaching Dynamic LINQ. The doc comment (`:108-111`) spells out the three
  risks that guard closes: inferring hidden-column data through a nested path, forcing an unindexed
  sort, and turning a parse error into a 500. Server-authored map entries may still be navigation
  paths or expressions, client-supplied strings may not. `[Rubric §11, Security]` (assesses whether
  untrusted input can reach an expression evaluator) and `[Rubric §12, Performance & Scalability]`.
- **Where it's used**: `Validate` and `ValidateSortDirection` are called by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) before the database is
  touched (`EntityQueryService.cs:183-188`, `:245`, `:276`); `ShapeData` / `ShapeCollectionData` are
  called after mapping (`EntityQueryService.cs:226`, `:353`); `ApplySorting` and
  `ApplyFieldSelection` are called inside [`EntityQueryPipeline`](#entityquerypipeline).
- **Caveats / not-in-source**: the class is `sealed` but every member is `static`, so it is never
  instantiated or injected; treat it as a static utility despite the shape.

---

### QueryFilterService
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19` · Level 3 · class (public, static)

- **What it is**: the static registry plus dispatcher that applies and validates dynamic filters. It
  owns the `Type -> IFilterStrategy` table and a `PropertyInfo` cache, and it is the single point
  where a parsed URL filter meets an `IQueryable`.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy) and the seven built-in strategies
  ([`BoolFilterStrategy`](#boolfilterstrategy), [`DateTimeFilterStrategy`](#datetimefilterstrategy),
  [`DecimalFilterStrategy`](#decimalfilterstrategy), [`GuidFilterStrategy`](#guidfilterstrategy),
  [`IntFilterStrategy`](#intfilterstrategy), [`LongFilterStrategy`](#longfilterstrategy),
  [`StringFilterStrategy`](#stringfilterstrategy)),
  [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error); `System.Reflection`,
  `System.Collections.Concurrent`.
- **Concept introduced, the strategy registry plus a validate-before-execute boundary.** `[Rubric
  §2, Design Patterns]` and `[Rubric §1, SOLID]` (Open/Closed): the `Strategies`
  `ConcurrentDictionary` (`:26-42`) seeds thirteen entries, one per supported CLR type including each
  nullable variant (string, bool/bool?, int/int?, long/long?, DateTime/DateTime?, decimal/decimal?,
  Guid/Guid?), and `RegisterStrategy(Type, IFilterStrategy)` (`:57-62`) lets a host add a type at
  startup without editing this file. `[Rubric §9, API & Contract Design]` (assesses validation at the
  right boundary): `ValidateFilters` runs the property and operator checks *before* the query is
  built, so an unsupported operator becomes a precise validation failure rather than a LINQ Dynamic
  parse exception at execution time.
- **Walkthrough**
  - `PropertyCache` (`:24`): `ConcurrentDictionary<(Type EntityType, string PropertyName),
    PropertyInfo?>`, so a reflected lookup is paid once per entity/property pair. It caches the
    *negative* result too (the value is nullable), so a repeatedly bogus filter name does not
    re-reflect.
  - `StringStrategy` (`:49`): a dedicated [`StringFilterStrategy`](#stringfilterstrategy) instance
    held apart from the table, used for both string properties and nested paths.
  - `ApplyFilters<TEntity>` (`:73-116`): for each `(property, (op, value))` it translates the DTO name
    through `dtoToEntityPropertyMap` (`:81-83`), derives the **root** property name from a dotted path
    (`:86-88`), resolves the `PropertyInfo` through the cache (falling back from the DTO name to the
    root name, `:90-95`), and **silently skips** an unresolvable property (`:97-98`). The operator is
    uppercased once here (`:100`), which is the caller-side half of the
    [`IFilterStrategy`](#ifilterstrategy) contract. A string property or any dotted path routes to
    `StringStrategy` (`:104-108`); otherwise the per-type strategy is looked up and applied
    (`:111-112`).
  - `ValidateFilters<TEntity>` (`:126-141`): returns success for a null/empty filter map (`:130-131`),
    otherwise runs `ValidateSingleFilter` per entry and collects **all** errors into one
    [`Result`](group-01-result-error-handling.md#result) (`:138-140`), so a client sees every problem
    at once rather than one per round trip.
  - `ValidateSingleFilter<TEntity>` (`:143-187`) emits three distinct error codes:
    `Filter.Property.NotFound` when reflection cannot resolve the property (`:157-161`),
    `Filter.Type.NotSupported` when no strategy is registered for its CLR type (`:178-182`), and,
    via `ValidateOperatorSupported` (`:208-224`), `Filter.Operator.NotSupported` when the operator is
    outside the strategy's set (`:218-222`). A nested path is validated against the string operator
    set (`:168-171`). A strategy whose `SupportedOperators` is `null` skips the operator check
    entirely (`:216`).
  - `ResolvePropertyInfo` (`:189-201`) and `ResolveStrategy` (`:203-206`) are the small shared helpers
    behind both paths; note `ResolveStrategy` special-cases `typeof(string)` to the dedicated
    `StringStrategy` rather than the table entry.
- **Why it's built this way**: validating up front converts would-be runtime exceptions into precise
  validation errors at the API boundary, and the two caches amortise all reflection to first use per
  process.
- **Where it's used**: `ValidateFilters` is called from
  [`EntityQueryService.GetAllAsync`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`EntityQueryService.cs:187`); `ApplyFilters` is called inside
  [`EntityQueryPipeline`](#entityquerypipeline) before materialization. The filter map itself is
  produced at the API edge by
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Caveats / not-in-source**: this is a **static class**, not a DI-resolved service, so
  `RegisterStrategy` mutates process-global state and is only safe at startup. Nullable variants are
  registered as separate instances rather than a shared one (`:29-41`), which costs a few extra
  objects but keeps the table declaration flat.

---

### EntityQueryService<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:31` · Level 8 · class

- **What it is**: the reusable engine behind essentially every read endpoint in both apps: filtered,
  sorted, paginated, field-projected list and by-id reads for any entity. It implements
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype).
- **Depends on**: injected through a primary constructor (`:31-36`),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`INavigationMetadataProvider`](#inavigationmetadataprovider),
  [`IEntityQueryPipeline`](#ientityquerypipeline),
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype),
  and [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity);
  plus [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype),
  [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`QueryFieldService`](#queryfieldservice), [`QueryFilterService`](#queryfilterservice),
  [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype).
  Constrained `where TEntity : AuditableBaseEntity<TIdentifierType>`,
  `where TEntityDTO : IBaseDTO<TIdentifierType>`, `where TIdentifierType : notnull` (`:38-40`).
- **Concept introduced, one generic read pipeline for every entity.** `[Rubric §1, SOLID]`
  (Open/Closed: extend by subclassing and overriding, not by editing), `[Rubric §9, API & Contract
  Design]` (one filter/sort/page/fields convention across every read endpoint), `[Rubric §12,
  Performance & Scalability]` (all shaping is pushed down to the database through the pipeline), and
  `[Rubric §16, Maintainability]` (a new entity inherits the full read surface with no new code). The
  list path, `GetAllAsync` (`:169-235`), is four steps:
  1. **Validate before touching the database** (`:183-188`): `Result.Combine` of
     [`QueryFieldService.Validate`](#queryfieldservice) for `fields` (read-only fields rejected) and
     for `sortColumn` (`allowWriteableFields: true`, since a computed column may still be sortable),
     `ValidateSortDirection`, and
     [`QueryFilterService.ValidateFilters`](#queryfilterservice). On failure every
     [`Error`](group-01-result-error-handling.md#error) is re-stamped with
     `Source = nameof(GetAllAsync)` and `Target = typeof(TEntity).Name` via a `with` expression
     (`:191-199`), so the caller sees which operation and which entity produced each problem.
  2. **Build and execute** through `BuildQueryAsync` (`:366-405`): pick `Repository.Table` when
     tracking is requested or `TableNoTracking` otherwise (`:379-381`), ask
     [`NavigationMetadataProvider.BuildIncludes`](#navigationmetadataprovider) which navigations EF
     can `Include` (`:383`), pack everything (including `specification?.Criteria`, `:387`) into an
     [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`:385-397`), and hand off to
     [`IEntityQueryPipeline.ExecuteAsync`](#ientityquerypipeline) passing
     `NavigationPopulator.PopulateAsync` as the callback (`:399-404`) so cross-source navigations EF
     cannot join are batch-loaded after materialization ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
  3. **Map, then shape only when asked** (`:222-226`): the entities go through the injected
     [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype),
     and the result is cast to `object` as-is unless a `fields` subset was requested, in which case
     [`QueryFieldService.ShapeCollectionData`](#queryfieldservice) produces `ExpandoObject`s. The
     comment (`:216-219`) explains the rule: typed DTOs already serialize to the same camelCase JSON,
     so paying the per-row `ExpandoObject` allocation and boxing only makes sense when it actually
     removes fields.
  4. **Wrap** in a `PagedCollectionResult<object>` with
     [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) from
     `BuildPaginationMetadata` (`:407-425`); when no page was requested, page size equals the total
     count and the current page is 1 (`:409-417`).
- **Walkthrough, the other read paths**
  - **The by-id fast path** (`TryGetByIdFastPathAsync`, `:80-100`). For a plain primary-key lookup it
    issues a single keyed read through `Repository.GetByIdAsync` (`:96`) and skips the dynamic-filter
    pipeline entirely. The doc comment (`:70-79`) states why this exists: the pipeline would parse a
    string predicate and emit a `TOP 1000` plus a client-side `FirstOrDefault`, and it notes that the
    repository overload runs on the filtered `TableNoTracking`, so soft-delete query filters still
    apply (unlike EF's `FindAsync`, which bypasses them). `IsPrimaryKeyOnlyLookup` (`:102-112`) gates
    it: no `fields`, no includes, no
    [`Specification`](#specificationtentity-tidentifiertype), and either no `idField` or the default
    `"Id"`. `TryConvertId` (`:119-145`) converts the string id via a `TypeConverter` cached per
    identifier type in `IdConverterCache` (`:68`), catching only `FormatException`,
    `NotSupportedException`, and `ArgumentException` (`:139`) and returning `false` so a malformed id
    falls back to the pipeline rather than failing. This is a targeted `[Rubric §12, Performance &
    Scalability]` optimization on the single hottest read shape in the system.
  - `GetEntityByIdAsync` (`:266-324`): validates `fields`, tries the fast path (`:292-296`), and
    otherwise reuses the list pipeline through a synthetic `Id EQUALS` filter built with an
    `OrdinalIgnoreCase` comparer (`:298-301`), returning
    `Error.NotFound.WithSource(nameof(GetByIdAsync)).WithTarget(...)` when nothing came back
    (`:317-321`).
  - `GetByIdAsync` (`:327-354`): stringifies the typed id (throwing `InvalidOperationException` if
    `ToString()` returns null, `:336`), delegates to `GetEntityByIdAsync`, maps the single entity, and
    applies the same shape-only-when-asked rule as the list path (`:351-353`).
  - `GetAllForLookupAsync` (`:238-263`): validates one `nameProperty`, then delegates to the
    repository's lookup query, returning
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
    id/name pairs for dropdowns.
  - `ExistsAsync` (`:357-361`): a thin non-virtual pass-through to the repository.
  - **Extensibility points**: `Repository` (`:48`) and `DTOToEntityPropertyMap` (`:61`) are
    `virtual`, as are all the read methods, and the class is deliberately **not** `sealed`, so a
    module subclass can override one behavior (a scoped repository, a
    `"CategoryName" -> "Category.Name"` mapping) without reimplementing the pipeline. `UnitOfWork` is
    `protected` (`:43`) for subclasses that need a custom query.
- **Why it's built this way**: centralizing read mechanics means every entity gets identical
  filter/sort/page/projection semantics for free, and validate-before-database turns a bad `fields` or
  operator into a validation failure rather than a SQL or expression-parser error. The
  [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) callback
  is the database-per-service escape hatch ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) and [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): EF cannot join across physical
  sources, so those navigations are filled by a second batch query against the page that was actually
  returned.
- **Where it's used**: injected as the query service of the read controllers
  ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype))
  in both apps, and subclassed per module wherever a default must change.
- **Caveats / not-in-source**: no page-size clamp lives in this class; the
  [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings) maximum is
  applied at the API boundary, and the only bound visible from here is the unbounded-result ceiling
  inside [`EntityQueryPipeline`](#entityquerypipeline). Error stamping in the by-id path always uses
  `Source = nameof(GetByIdAsync)` (`:282`, `:319`) even when `GetEntityByIdAsync` is called directly,
  a cosmetic label, not a behavior difference.

### EntityQueryParameters<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11` · Level 0 · record

- **What it is**: an immutable parameter object that bundles every input the read pipeline needs into
  one value: specification criteria, dynamic filters, sort column/direction, field projection,
  pagination, the two navigation-include flags, and the DTO-to-entity property map.
- **Depends on**: `System.Linq.Expressions` (the `Criteria` expression), `System.Collections.Frozen`
  (the default empty `DTOToEntityPropertyMap`); no first-party dependencies. Consumed by
  [`IEntityQueryPipeline`](#ientityquerypipeline) and its implementation
  [`EntityQueryPipeline`](#entityquerypipeline).
- **Concept introduced, the parameter object.** `[Rubric §15, Best Practices & Code Quality]` assesses
  whether long, order-sensitive argument lists are replaced by a named, self-documenting shape; the
  query pipeline's `ExecuteAsync` would otherwise take eight-plus positional arguments, so they collapse
  into one `record` with named `init` properties. Being a `sealed record` with all-`init` members makes
  it immutable once built (the primer's `required`/`init` immutability convention), so the same
  parameters can be passed down the pipeline without any stage mutating them.
- **Walkthrough**: eleven `init`-only properties, all optional (nullable or defaulted):
  - `Expression<Func<TEntity, bool>>? Criteria` (line 14), the specification predicate (e.g. an
    authorization filter) applied server-side before materialization.
  - `Dictionary<string, (string Operator, string Value)>? Filters` (line 17), the dynamic
    user-supplied filter map (property name to operator/value pair) that
    [`QueryFilterService`](#queryfilterservice) turns into `Where` clauses.
  - `string? SortColumn` / `string? SortDirection` (lines 20, 23), the sort column and `"asc"`/`"desc"`
    direction consumed by `QueryFieldService.ApplySorting`.
  - `string? Fields` (line 26), the comma-separated sparse-fieldset projection list.
  - `int? PageNumber` / `int? PageSize` (lines 29, 32), 1-based pagination; both must be present for the
    pipeline to treat the query as paginated.
  - `bool IncludeFKs` / `bool IncludeChildren` (lines 35, 38), whether FK reference navigations and/or
    child-collection navigations were requested.
  - `IReadOnlyDictionary<string, string> DTOToEntityPropertyMap` (line 44), maps DTO property names to
    entity property paths (e.g. `"CategoryName"` to `"Category.Name"`) so filtering and sorting can use
    DTO-facing names even when they differ from the entity's own properties; it defaults to
    `FrozenDictionary<string, string>.Empty` so callers that do not need remapping can omit it.
- **Why it's built this way**: threading one immutable value through a multi-stage pipeline keeps each
  stage's signature stable and its inputs unambiguous, and the frozen-empty default keeps the common
  no-remapping case allocation-light.
- **Where it's used**: constructed by the concrete
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) (this group, p01) from
  the controller's query arguments, then handed to
  [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline).

### ParameterReplacer
> MMCA.Common.Application · `MMCA.Common.Application.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:93` · Level 0 · class (private sealed)

- **What it is**: a tiny `ExpressionVisitor` that rewrites an expression tree, swapping every occurrence
  of one `ParameterExpression` for another. It is a private nested helper of
  [`CrossSourceSpecification`](#crosssourcespecification), not a public type.
- **Depends on**: `System.Linq.Expressions.ExpressionVisitor` (BCL base class); no first-party
  dependencies.
- **Concept introduced, expression-tree rebinding via a visitor `[Rubric §8, Data Architecture]`.**
  Two independently-built lambdas each own their own `ParameterExpression` (their `x =>` variable). To
  combine their bodies into a single lambda that EF Core can still translate to SQL, the two bodies must
  share ONE parameter. A `ParameterExpression` is compared by reference, so you cannot just reuse the
  same name; you must physically visit one body and replace its parameter node with the other's. That is
  exactly what an `ExpressionVisitor` subclass does: it walks the tree and, at each node type, lets you
  substitute a replacement.
- **Walkthrough**: a primary-constructor sealed class taking `(ParameterExpression from,
  ParameterExpression to)` (line 93) with a single override:
  - `VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node)` (lines
    95-96), when the visitor reaches the `from` parameter it returns `to` instead; every other node is
    left untouched by delegating to the base visitor.
- **Why it's built this way**: rebinding at the expression-tree level (rather than via
  `Expression.Invoke`) keeps the resulting composite predicate translatable on every provider, which is
  the whole point of [`CrossSourceSpecification`](#crosssourcespecification); a one-method visitor is the
  minimal, standard way to do the swap.
- **Where it's used**: only inside
  [`CrossSourceSpecification.BuildCriteria`](#crosssourcespecification), to rebind an optional local
  predicate onto the foreign-key selector's parameter before ANDing the two bodies together.

### ISpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12` · Level 1 · interface

- **What it is**: the Specification pattern interface: an encapsulated, reusable predicate that exposes
  *both* an EF-translatable expression tree (`Criteria`) and an in-memory evaluation path
  (`IsSatisfiedBy`).
- **Depends on**: [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint, line 13); `System.Linq.Expressions` (BCL).
- **Concept introduced, the Specification pattern.** `[Rubric §4, DDD]` assesses whether business
  rules are modelled as first-class, named domain concepts rather than scattered conditionals; here a
  query criterion *is* a domain object. `[Rubric §3, Clean Architecture]` assesses whether the domain
  expresses rules while infrastructure translates them: `Criteria` is a pure expression tree the domain
  owns, and EF Core (an outer layer) is what turns it into SQL. A **specification** is a named,
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
- **Where it's used**: implemented by the abstract base
  [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (next section) and
  module-specific authorization specs in both apps (e.g. `OwnedByCustomerSpec`); accepted as an optional
  argument by [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and the read-repository query methods (G07).

### Specification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15` · Level 2 · class (abstract)

- **What it is**: the abstract base for the Specification pattern: subclasses supply an
  `Expression<Func<TEntity, bool>>` (`Criteria`, usable in EF `Where` clauses) and inherit an in-memory
  `IsSatisfiedBy` shortcut backed by a lazy-compiled, cached delegate.
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the contract it implements), [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, the Specification pattern with expression trees.** `[Rubric §2, Design
  Patterns]` assesses whether a pattern solves a real problem rather than being pattern theater; here
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
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) /
  [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) (next sections) and every
  module-specific access-control specification; passed as the optional `specification` argument to
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for authorization scoping (e.g. an `OwnerSpecification` restricting results to the authenticated
  user's own entities).

### AndSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:62` · Level 3 · class (sealed)

- **What it is**: a **composite combinator** that ANDs two specifications into a new one whose `Criteria`
  is satisfied only when both children are. Its siblings
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) and
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) share the identical shape and differ
  only in the `Expression` node they emit, so this section teaches the mechanism once and those two
  cross-reference it.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class), [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the two constructor parameters), [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, expression-tree composition for EF translatability.** `[Rubric §8, Data
  Architecture]` assesses whether query predicates reach the database rather than filtering in-memory
  after a full load. The trick is `Expression.Invoke`: the combinator creates **one** shared
  `ParameterExpression` named `"entity"`, then embeds each child spec's existing `Criteria` tree as a
  sub-expression via `Expression.Invoke(spec.Criteria, parameter)`. Composing at the *expression-tree*
  level (not by combining compiled `Func`s) is what keeps the composite translatable: a compiled
  delegate cannot be turned into SQL, but `Expression.AndAlso(invoke1, invoke2)` can. Most EF providers
  accept `Invoke` in composed expressions.
- **Walkthrough**: a sealed primary-constructor subclass taking two `ISpecification`s (lines 62-64); the
  `Criteria` getter (lines 70-79) builds a fresh tree each call:
  1. `var parameter = Expression.Parameter(typeof(TEntity), "entity");` (line 74), the single shared
     lambda parameter.
  2. `var body = Expression.AndAlso(Expression.Invoke(spec1.Criteria, parameter),
     Expression.Invoke(spec2.Criteria, parameter));` (lines 75-77), combines the two invoked child trees
     with a short-circuiting logical AND.
  3. `return Expression.Lambda<Func<TEntity, bool>>(body, parameter);` (line 78), re-wrap as a
     strongly-typed predicate lambda.
  Note `Criteria` is a computed property here (a fresh tree on each `get`), not a cached field:
  composites are cheap and usually constructed per query.
- **Why it's built this way**: combinators let query callers compose access rules
  (`new AndSpecification(ownerSpec, activeSpec)`) without the query service knowing the predicate
  internals, and the expression-tree approach preserves database translation throughout the composition.
  Keeping it `sealed` signals it is a leaf implementation, not meant for further subclassing.
- **Where it's used**: "owner + active" filtering, combined with the sibling combinators and passed as
  the `specification` argument to the query service and read repositories (G07).

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
  specs; `InlineSpecification` instead adopts a tree someone else built. This is the small extension
  point that lets a dynamic, runtime-assembled cross-source predicate participate in the same
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
  stays in the domain layer ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) builds the cross-source filter on top of it from the Application
  layer).
- **Where it's used**: returned by
  [`CrossSourceSpecification.BuildAsync`](#crosssourcespecification) to wrap the
  `localPredicate AND principalKeys.Contains(fk)` expression it assembles.

### NotSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:114` · Level 3 · class (sealed)

- **What it is**: the negating composite combinator: it wraps a single specification and satisfies its
  `Criteria` when the child does *not*. Same shape as
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the
  expression-tree mechanism); it just takes one child instead of two.
- **Depends on**: same as `AndSpecification`, but its constructor takes a single
  [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype) (line 115).
- **Walkthrough**: the `Criteria` getter (lines 121-130) builds `Expression.Not(Expression.Invoke(spec.Criteria,
  parameter))` (lines 126-127) over the shared `"entity"` parameter, then wraps it as a lambda. `sealed`.
- **Where it's used**: "exclude soft-deleted" or "not in this set" predicates, combined with the other
  combinators and passed as the `specification` argument to the query service and read repositories
  (G07).

### OrSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:88` · Level 3 · class (sealed)

- **What it is**: the disjunctive composite combinator: it ORs two specifications so its `Criteria` is
  satisfied when either child is. Structurally identical to
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the
  expression-tree mechanism); it differs by one node.
- **Depends on**: identical to `AndSpecification`.
- **Walkthrough**: the `Criteria` getter (lines 96-105) is the And getter with `Expression.OrElse`
  (line 101) in place of `Expression.AndAlso`, a short-circuiting logical OR over the two invoked child
  trees. `sealed`.
- **Where it's used**: "admin or owner" access patterns where either condition grants access, combined
  with the other combinators and passed as the `specification` argument to the query service and read
  repositories (G07).

### IEntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10` · Level 4 · interface

- **What it is**: the contract for the multi-step read pipeline: given a base `IQueryable`, navigation
  metadata, and an [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity), it applies
  includes, criteria, dynamic filters, sorting, pagination, and field projection, then returns the
  materialized page plus the total row count.
- **Depends on**: [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (the input bundle),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (supported vs unsupported
  includes), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq` (`IQueryable`).
- **Concept introduced, the query pipeline as a single boundary-free step.** `[Rubric §5, Vertical Slice]`
  assesses whether a capability lives behind one focused abstraction rather than smeared across
  callers; every read endpoint's list logic funnels through this one method. The single method's return
  type, `Task<(IReadOnlyCollection<TEntity> Items, int TotalCount)>` (line 23), returns both the page
  and the count needed to build pagination metadata in one call.
- **Walkthrough**: one generic method, `ExecuteAsync<TEntity, TIdentifierType>` (lines 23-30),
  constrained `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType :
  notnull` (lines 29-30):
  - `IQueryable<TEntity> baseQuery`, the untracked or tracked starting queryable from the repository.
  - `NavigationMetadata navigationMetadata`, the supported/unsupported include classification.
  - `EntityQueryParameters<TEntity> parameters`, all the query inputs.
  - `Func<IReadOnlyCollection<TEntity>, NavigationMetadata, bool, bool, CancellationToken, Task>
    navigationPopulator`, a callback the pipeline invokes to manually load *unsupported* navigations
    (the two `bool`s are `includeFKs`/`includeChildren`). Passing this as a delegate keeps the pipeline
    in the Application layer while the actual populator lives in Infrastructure (G11).
- **Why it's built this way**: abstracting the pipeline behind an interface lets the query service
  depend on the behavior, not the concrete steps, and lets the navigation-population strategy be injected
  as a delegate rather than a hard dependency (Clean Architecture, `[Rubric §3]`).
- **Where it's used**: implemented by [`EntityQueryPipeline`](#entityquerypipeline); called by the
  concrete [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) (this group,
  p01).

### INavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9` · Level 4 · interface

- **What it is**: the contract that inspects an entity type and classifies each of its navigation
  properties as **supported** (loadable via EF Core `.Include()`) or **unsupported** (needs manual
  loading), based on whether the two entities share a JOIN-capable data source.
- **Depends on**: [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (the
  return type); no other first-party dependency in the interface.
- **Concept introduced, include-capability classification.** `[Rubric §8, Data Architecture]` assesses
  whether the persistence strategy adapts to the physical store; in a database-per-service / polyglot
  setup, two related entities may live in *different* stores, so an `.Include()` that generates a SQL
  JOIN cannot span them. This provider is where that "can EF JOIN these two?" decision is made, up front,
  before the pipeline runs.
- **Walkthrough**: one method, `NavigationMetadata BuildIncludes<TEntity>(bool includeFKs, bool
  includeChildren)` (line 19), builds the classification for the requested navigation kinds (FK
  references and/or child collections) on `TEntity`.
- **Where it's used**: implemented by [`NavigationMetadataProvider`](#navigationmetadataprovider);
  called by the concrete [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  to produce the `NavigationMetadata` it then feeds to [`IEntityQueryPipeline`](#ientityquerypipeline).

### EntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13` · Level 5 · class (sealed)

- **What it is**: the concrete read pipeline. It runs a **two-path strategy**: PATH 1 uses EF Core
  `.Include()` when the data source can JOIN (server-side), PATH 2 materializes first and loads
  unsupported navigations manually. Both paths apply criteria, filters, sorting, pagination, and field
  projection, with a hard row ceiling to keep every read bounded.
- **Depends on**: [`IEntityQueryPipeline`](#ientityquerypipeline) (the contract),
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (the injected abstraction
  over EF's async `Include`/`Count`/`ToList`/`AsSplitQuery`, keeping this Application-layer class free of
  a direct EF reference), [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata), the p01 helpers
  `QueryFilterService` / [`QueryFieldService`](#queryfieldservice), and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint).
- **Concept introduced, the two-path include strategy and the unbounded-result ceiling.** `[Rubric §8,
  Data Architecture]` (the pipeline adapts to the store's JOIN capability) and `[Rubric §12, Performance
  & Scalability]` (results are always bounded, and filtering is pushed server-side before
  materialization) both apply directly. The ceiling is codified as `public const int
  MaxUnboundedResultLimit = 1000;` (line 23): a defense-in-depth cap so that even an Application-layer
  caller that bypasses the API's page-size clamp cannot trigger an unbounded full-table load.
- **Walkthrough**: constructed with an `IQueryableExecutor` (line 13); the single public method
  `ExecuteAsync` (lines 26-69) orchestrates:
  1. **PATH 1 includes** (lines 40-51): for each supported include, call
     `queryableExecutor.Include(...)`; if any supported include is a `ChildCollection`, switch to
     `AsSplitQuery` (lines 49-50). The inline comment (lines 45-48) documents *why*: paginating a
     single-query collection-`Include` truncates child rows because EF applies `Skip`/`Take` to the
     JOIN-expanded set, so a split query loads each collection in its own statement (the R24/§8 fix).
  2. **Server-side filtering before materialization** (lines 56-60): apply `parameters.Criteria` via
     `Where` (line 57), then the dynamic filters via `QueryFilterService.ApplyFilters` (line 60), so the
     store does as much filtering as possible.
  3. **Path selection** (lines 65-68): if there are any *unsupported* includes, delegate to
     `ExecuteWithManualNavigationAsync`; otherwise to `ExecuteWithServerSideIncludesAsync`.
  - `ExecuteWithManualNavigationAsync` (lines 76-119): sort at the DB level (line 89), then if paginated
    take the total count and clamp the page size with `Math.Min(parameters.PageSize!.Value,
    MaxUnboundedResultLimit)` and a `checked` skip (lines 96-97); if not paginated, cap with
    `.Take(MaxUnboundedResultLimit)` (line 104). Materialize, then run the `navigationPopulator` callback
    on the paged subset (line 110), and finally apply field selection (line 117).
  - `ExecuteWithServerSideIncludesAsync` (lines 125-162): same sort / count-before-`Skip` / clamp / cap
    shape (lines 132-152) but applies `QueryFieldService.ApplyFieldSelection` on the `IQueryable`
    directly (line 155) so the projection reaches the database as a `MemberInit`.
- **Why it's built this way**: pushing filters and projection to the store, forcing split-query for
  paginated child collections, and capping every path keeps reads correct and bounded regardless of
  engine; injecting `IQueryableExecutor` keeps EF out of the Application layer (Clean Architecture).
- **Where it's used**: the sole implementation behind
  [`IEntityQueryPipeline`](#ientityquerypipeline); driven by the concrete
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype).

### IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19` · Level 5 · interface (generic)

- **What it is**: the central read-query contract of the framework: generic operations for
  `GetAllAsync` (with filter/sort/pagination/projection), `GetAllForLookupAsync`, `GetEntityByIdAsync`,
  `GetByIdAsync`, and `ExistsAsync` over any entity/DTO pair. It is the read half of the application's
  CQRS split (the write half flows through command handlers).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, line 20), [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (the `TEntityDTO` constraint, line 21), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  (the `DTOMapper` property), [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (optional scoping argument), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`Result`](group-01-result-error-handling.md#result), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype);
  `System.Linq.Expressions` (BCL).
- **Concept introduced, the entity query service contract.** `[Rubric §5, Vertical Slice]` assesses
  whether a feature's read logic is encapsulated in one place; here the API controller delegates to this
  service and never touches `IQueryable` directly. `[Rubric §12, Performance & Scalability]` assesses
  whether result sets are bounded; explicit `pageNumber`/`pageSize` parameters and a `fields` projection
  prevent returning unbounded rows or over-fetching columns. The most distinctive design choice is the
  return shape: the read methods return `Result<...<object>>`. The interface doc (lines 9-15) explains
  it: when **no** `fields` subset is requested the typed `TEntityDTO`s are returned as-is (no per-row
  shaping cost); when an explicit `fields` list is supplied, dynamically shaped objects (an
  `ExpandoObject` property bag, from `System.Dynamic`) carrying only the requested fields are returned.
  Both serialize to the same camelCase JSON, so one contract serves full-detail and sparse-field
  responses alike, without proliferating one DTO per projection.
- **Walkthrough**: constraints `where TEntity : AuditableBaseEntity<TIdentifierType>`,
  `where TEntityDTO : IBaseDTO<TIdentifierType>`, `where TIdentifierType : notnull` (lines 20-22):
  - `IEntityDTOMapper<...> DTOMapper { get; }` (line 25), exposes the mapper so callers can do manual
    entity-to-DTO mapping outside the pipeline when needed (e.g. a custom join result).
  - `GetAllAsync(...)` (lines 37-43), the **simple** overload: navigate FKs and/or children
    (`includeFKs`/`includeChildren`), optionally scope by `Specification`, optionally project `fields`;
    returns `Task<Result<PagedCollectionResult<object>>>`.
  - `GetAllAsync(...)` (lines 60-71), the **full** overload: adds `filters`
    (`Dictionary<string, (string Operator, string Value)>`, a dynamic filter map), `sortColumn`,
    `sortDirection` ("asc"/"desc"), `pageNumber`, `pageSize`. Callers pick the minimal overload for
    their use case.
  - `GetAllForLookupAsync(string nameProperty, ...)` (lines 82-87), returns lightweight
    `IReadOnlyCollection<BaseLookup<TIdentifierType>>` id/name pairs for dropdowns, with optional
    `where` and `orderBy` expressions.
  - `GetEntityByIdAsync(string idValue, ...)` (lines 101-109), returns the raw `Result<TEntity>` (the
    tracked entity) for command handlers that need to mutate it; takes the id as a string plus an
    optional `idField` so non-`Id` lookups are possible.
  - `GetByIdAsync(TIdentifierType id, ...)` (lines 123-130), returns a projected `Result<object>` (typed
    DTO, or shaped object when a field subset was requested) for read-only detail responses.
  - `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, ...)` (lines
    139-142), a cheap existence check; `ignoreQueryFilters` can bypass the global soft-delete filter.
- **Why it's built this way**: a single generic read contract over every entity lets the generic
  controller base (G12) expose uniform list/detail/lookup/exists endpoints without per-entity query
  code, while the `object` return + `fields` shaping keeps the wire payload caller-controlled without
  paying a shaping cost when no projection is asked for. Splitting `GetEntityByIdAsync` (raw entity) from
  `GetByIdAsync` (shaped DTO) cleanly separates the command-side need (a tracked aggregate to mutate)
  from the query-side need (a projected response).
- **Where it's used**: implemented by
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (this group, p01), which delegates navigation classification to
  [`INavigationMetadataProvider`](#inavigationmetadataprovider) and the heavy lifting to
  [`IEntityQueryPipeline`](#ientityquerypipeline); consumed by every read endpoint through the generic
  controller base (G12).

### NavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20` · Level 5 · class (sealed)

- **What it is**: the concrete implementation of
  [`INavigationMetadataProvider`](#inavigationmetadataprovider). It reflects over an entity's properties
  looking for [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), then asks
  the data-source service whether EF Core can `.Include()` each navigation or whether it needs manual
  loading, caching the answer per entity/navigation-kind.
- **Depends on**: [`INavigationMetadataProvider`](#inavigationmetadataprovider) (the contract),
  `IDataSourceService` (the `HaveIncludeSupport` check, G07),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (the marker it reflects
  on), [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (the result type);
  `System.Reflection` and `System.Collections.Concurrent` (BCL).
- **Concept introduced, reflection-driven, host-scoped include classification.** `[Rubric §12,
  Performance & Scalability]` assesses whether repeated expensive work is memoized; reflection over
  every entity's properties runs once per (entity type, navigation kind) and is cached. The cache is a
  deliberate instance field, not `static`: the doc comment (lines 22-27) explains that classification
  depends on the *host's* data-source configuration, so a process hosting multiple service
  configurations (integration tests) must not share classification results across hosts.
- **Walkthrough**: constructed with an `IDataSourceService` (line 20):
  - `private readonly ConcurrentDictionary<(Type EntityType, NavigationType NavType), NavigationMetadata>
    _cache` (line 28), the per-host memoization store.
  - `BuildIncludes<TEntity>(bool includeFKs, bool includeChildren)` (line 31), builds a fresh
    `NavigationMetadata`, adding the FK-reference classifications when `includeFKs` and the
    child-collection ones when `includeChildren`.
  - `GetNavigationProperties` (line 52), the cache lookup: `_cache.GetOrAdd(...)` computes
    `BuildNavigationMetadata` on a miss.
  - `BuildNavigationMetadata` (line 60), reflects over the entity's public instance properties and
    classifies each.
  - `ClassifyNavigationProperty` (line 72), reads the [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute)
    (skips properties without one, line 74), matches its `IsCollection` flag to the requested
    `NavigationType`, unwraps the collection element type, then calls
    `dataSourceService.HaveIncludeSupport(declaringType, targetType)` (line 96) to sort the navigation
    into the supported or unsupported bucket.
  - `UnwrapCollectionType` (line 106), pulls the element type out of `ICollection<T>` /
    `IReadOnlyCollection<T>` so the compatibility check sees the actual target entity.
- **Why it's built this way**: classifying by reflection keeps navigation configuration declarative (an
  attribute on the property) rather than hand-registered, and caching per host makes the reflection cost
  a one-time hit while staying correct across differently-configured hosts.
- **Where it's used**: injected into the concrete
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype), which calls
  `BuildIncludes` and passes the resulting
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) into
  [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline).

### CrossSourceSpecification
> MMCA.Common.Application · `MMCA.Common.Application.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` · Level 8 · class (static)

- **What it is**: a static helper that builds a specification filtering a *dependent* entity by a
  condition on a **cross-source principal** it references by foreign key. Its single method,
  `BuildAsync`, resolves the matching principal keys first (a scalar query against the principal's own
  data source) and returns an [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) whose
  criteria is the engine-portable `localPredicate AND principalKeys.Contains(dependent.ForeignKey)`.
- **Depends on**: [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype)
  and [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (the return
  type), [`ParameterReplacer`](#parameterreplacer) (its private rebind visitor),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) + `GetReadRepository<,>` /
  `GetProjectedAsync` (G07) to query the principal source,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TPrincipal` constraint) and [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TDependent` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, cross-source filtering under polyglot persistence `[Rubric §8, Data
  Architecture]`.** In a database-per-service / polyglot setup an entity and a related entity can live
  in *different physical data sources* (e.g. a Cosmos-stored `Session` referencing a SQL-Server `Event`).
  A query cannot join across physical sources, so a predicate that *navigates*, `s => s.Event.IsPublished`,
  is not translatable; on Cosmos the cross-source navigation is even degraded out of the model entirely
  by [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention).
  The engine-portable alternative is **resolve-then-filter-by-FK**: read the principal keys that satisfy
  the condition from the principal's own source, then filter the dependent by `foreignKey IN (those
  keys)` (which every provider translates: SQL `IN`, Cosmos `ARRAY_CONTAINS`). This is the runtime
  counterpart to [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s polyglot model, and it is enforced by the opt-in
  [`SpecificationsDoNotNavigateToOtherEntities`](group-27-testing-infrastructure.md#specificationconventiontestsbase)
  fitness rule (G25).
- **Walkthrough**
  - `BuildAsync<TDependent, TDependentId, TPrincipal, TPrincipalId>(IUnitOfWork unitOfWork,
    Expression<Func<TPrincipal, bool>> principalPredicate, Expression<Func<TDependent, TPrincipalId>>
    dependentForeignKey, Expression<Func<TDependent, bool>>? localPredicate = null, CancellationToken =
    default)` (lines 39-64), four type parameters: the dependent + its id, and the principal + its id
    (which is also the dependent's FK type). Constraints require `TPrincipal :
    AuditableBaseEntity<TPrincipalId>` (line 47).
  - Resolves keys: `unitOfWork.GetReadRepository<TPrincipal, TPrincipalId>()` (line 54) then
    `GetProjectedAsync(p => p.Id, principalPredicate, asTracking: false, ct)` (lines 55-57), materialized
    once into a list (line 60) so the predicate embeds a stable collection EF can translate.
  - `BuildCriteria` (lines 66-91) builds `Enumerable.Contains(keys, fk)` via `Expression.Call` (lines
    74-79); if a `localPredicate` is supplied it is rebound onto the FK selector's parameter (via
    [`ParameterReplacer`](#parameterreplacer), lines 85-86) and ANDed with `Expression.AndAlso` (line 87),
    deliberately **not** `Expression.Invoke`, so the combined predicate stays translatable on every
    provider.
- **Why it's built this way**: it makes a module's storage engine a movable choice ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)): a
  Session-by-published-event filter written this way keeps working whether `Session` is in SQL Server,
  SQLite, or Cosmos, with no query rewrite. Returning an `InlineSpecification` means the result drops
  straight into the existing `IEntityQueryService` / read-repository `specification` argument.
- **Where it's used**: ADC Conference's
  [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler)
  (G18), which resolves published `Event` ids and filters `Session.EventId IN (…)`, the refactor that
  replaced the former navigation-based `PublicSessionSpecification`.
- **Caveats / not-in-source**: the matching keys are materialized and embedded in the predicate, so this
  fits **small/bounded** principal sets (the common "published events", "active tenants" shape); an
  unbounded principal set would inline a very large `IN` list. The class doc (lines 17-20) states this
  explicitly.


---
[⬅ Domain Building Blocks (Entities, Value Objects, Aggregates)](group-02-domain-building-blocks.md)  •  [Index](00-index.md)  •  [Domain & Integration Events + Outbox Dual-Dispatch ➡](group-04-events-outbox.md)
