# 3. Querying: Specifications, Filtering & the Entity Query Service

**What this group covers.** Every read in MMCA.Common and ADC ("list the published events", "get session 42", "the speakers in Atlanta, page 3, sorted by name, with only the `name` and `bio` fields") flows through one reusable read engine. This chapter is the read side of CQRS (the command/query split is introduced in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)): side-effect-free queries that turn query-string knobs into `WHERE`, `ORDER BY`, `OFFSET`, and `SELECT` clauses the database executes, then shape the rows down to the fields the caller asked for. There is no per-entity repository method and no hand-rolled `IQueryable` plumbing in each controller: add an entity and it inherits filtering, sorting, paging, sparse-fieldset projection, and eager loading of navigations. The trade-offs behind that generic read surface (dynamic filtering, sparse fieldsets, per-type filter strategies, the pagination header, the unbounded-result ceiling, and the two-path include strategy) are recorded in [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html), which also explains how it composes with manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), and the Result pattern at the edge ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)).

Three sub-systems cooperate here, and it pays to hold them apart from the start:

1. **The Specification pattern** (Domain layer): the type-safe, programmer-authored predicate. A compiled `Expression<Func<TEntity, bool>>` that usually carries an authorization or business scope the caller must not be able to override ("only published events").
2. **Dynamic filtering, sorting, and field selection** (Application layer): the string-driven, user-authored shaping behind `?filter=...&sort=...&fields=...`. Untrusted input that must be validated against the entity's real properties before it reaches the database.
3. **The query pipeline and the entity query service** (Application layer): the orchestrator that composes both, decides how to load navigations given the data source's JOIN capabilities, runs the query, and packages the result with pagination metadata.

The split matters: specifications are trusted and live with the domain, dynamic filters are untrusted and are validated, capped, and reflection-cached at the application boundary.

## The Specification pattern, the trusted predicate

[`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12`) exposes two faces of one rule: a `Criteria` expression tree that EF Core translates to SQL, so the filter runs in the database rather than in memory after a full-table load (`ISpecification.cs:17`), and `IsSatisfiedBy(entity)` for in-memory evaluation (`ISpecification.cs:22`). The abstract base [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`) leaves `Criteria` abstract (`Specification.cs:23`), compiles it lazily on first use, and caches the delegate in a private field (`Specification.cs:27`, `Specification.cs:32`), so repeated in-memory checks do not recompile the tree.

The three combinators, [`AndSpecification<TEntity, TIdentifierType>`](#andspecificationtentity-tidentifiertype) (`Specification.cs:62`), [`OrSpecification<TEntity, TIdentifierType>`](#orspecificationtentity-tidentifiertype) (`Specification.cs:88`), and [`NotSpecification<TEntity, TIdentifierType>`](#notspecificationtentity-tidentifiertype) (`Specification.cs:114`), each build a fresh lambda over a single shared `ParameterExpression` and embed the operands with `Expression.Invoke`, combined by `Expression.AndAlso`, `Expression.OrElse`, or `Expression.Not` (`Specification.cs:75`, `Specification.cs:101`, `Specification.cs:126`, each closed by `Expression.Lambda` at `Specification.cs:78`, `:104`, `:128`). Rebuilding the lambda, rather than composing delegates, is what keeps the combined `Criteria` a single translatable tree. ADC's concrete specifications are how a controller scopes a query to allowed data without trusting the request to do it: `PublishedEventSpecification` is one line, `e => e.IsPublished` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11`, criteria at `:14`), with `OwnEventQuestionAnswerSpecification` alongside it and `OwnSessionQuestionAnswerSpecification` under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Specifications/`. This is [Rubric §4, Domain-Driven Design] (the rule is a first-class, reusable domain object) and [Rubric §2, Design Patterns] (a textbook Specification), with a [Rubric §11, Security] overtone: an authorization predicate is server-supplied criteria the client cannot tamper with.

Two members round the family out for polyglot persistence ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype) (`Specification.cs:45`) wraps an already-composed `Criteria` expression as a first-class specification, for predicates built at runtime where no hand-written class exists. The static [`CrossSourceSpecification`](#crosssourcespecification) (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22`) builds the cross-source filter: when a dependent entity references a principal that lives in a different physical data source (database-per-service, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), a navigating predicate like `s => s.Event.IsPublished` cannot be translated, so `BuildAsync` first projects the matching principal keys from the principal's own source through `IReadRepository.GetProjectedAsync` (`CrossSourceSpecification.cs:55`), materializes them once (`CrossSourceSpecification.cs:60`), and returns an `InlineSpecification` (`CrossSourceSpecification.cs:62`) whose body is an `Enumerable.Contains(keys, dependent.ForeignKey)` call that translates to `IN` or `ARRAY_CONTAINS` (`CrossSourceSpecification.cs:74`). An optional local predicate on the dependent's own columns is rebound onto the foreign-key selector's parameter by the nested [`ParameterReplacer`](#parameterreplacer) visitor (`CrossSourceSpecification.cs:85`, class at `CrossSourceSpecification.cs:93`) and ANDed in (`CrossSourceSpecification.cs:87`), deliberately without `Expression.Invoke` so the combined predicate stays translatable on every provider (`CrossSourceSpecification.cs:83-84`). The doc comment is explicit about the limit: the keys are materialized and embedded in the predicate, so the shape fits bounded principal sets (`CrossSourceSpecification.cs:17-20`). Today no module calls it: its only callers are the framework's own unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:46`), so treat it as a ready extension point rather than a live production path. The convention it exists to serve is guarded by an opt-in fitness rule, [`SpecificationConventionTestsBase`](group-27-testing-infrastructure.md#specificationconventiontestsbase) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10`), whose single fact asserts that no specification navigates to another entity (`SpecificationConventionTestsBase.cs:16`), which is [Rubric §14, Testability] applied to an architectural rule.

## Dynamic filtering, one Strategy per CLR type

User filters arrive as a `Dictionary<string, (string Operator, string Value)>`, property name to operator key plus raw string value, parsed from the query string by [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) at the API edge, which caps a single request at `MaxFilters = 50` distinct properties (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:34`, enforced at `QueryFilterModelBinder.cs:61`). Turning `("Name", "CONTAINS", "blazor")` into a `.Where()` clause depends entirely on the property's CLR type, so instead of one large `switch` each type gets an [`IFilterStrategy`](#ifilterstrategy) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6`) declaring an `Apply` method (`IFilterStrategy.cs:17`), the operator set it supports (`IFilterStrategy.cs:24`, where the default `SupportedOperators` is `null`, meaning operator validation is skipped for custom strategies), and a `CanParseValue` predicate that defaults to `true` (`IFilterStrategy.cs:44`). That last member exists because `Apply` fails open: a strategy that cannot parse a value silently returns the query unfiltered, so `?filter=id:equals:abc` used to return the whole result set instead of no matches (`IFilterStrategy.cs:33-38`). Validating the value up front turns that into a 400, and the default of `true` keeps a custom strategy behaving exactly as before until it opts in.

The seven built-ins each override `SupportedOperators` with a `FrozenSet`: [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:12`, operators at `:14-18`: `CONTAINS`, `NOT CONTAINS`, `EQUALS`, `NOT EQUALS`, `STARTS WITH`, `ENDS WITH`, `IS EMPTY`, `IS NOT EMPTY`, `IN`), [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:12`), [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:14`), and [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:14`), which share one numeric set (equality, the four comparisons, `IN`, an inclusive `BETWEEN` range, and the two presence checks, with `long` and `decimal` parsing invariant-culture), [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:13`: `IS`, `IS NOT`, `IS AFTER`, `IS ON OR AFTER`, `IS BEFORE`, `IS ON OR BEFORE`, the two presence checks, `IN`, and `BETWEEN`, all parsed with `CultureInfo.InvariantCulture` at `DateTimeFilterStrategy.cs:15`), [`BoolFilterStrategy`](#boolfilterstrategy) (`BoolFilterStrategy.cs:12`: `IS` plus the two presence checks), and [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:13`: `EQUALS`, `NOT EQUALS`, `IN`, and the two presence checks; GUIDs have no ordering, so no comparisons). Every value-typed strategy implements `CanParseValue` by delegating to one shared rule (`IntFilterStrategy.cs:22`, `LongFilterStrategy.cs:24`, `DecimalFilterStrategy.cs:24`, `DateTimeFilterStrategy.cs:25`, `BoolFilterStrategy.cs:20`, `GuidFilterStrategy.cs:21`); `StringFilterStrategy` declares none, because any string parses. That shared rule lives in the internal [`FilterValueParser`](#filtervalueparser) (`FilterValueParser.cs:8`): `CanParse` (`FilterValueParser.cs:53`) says presence checks ignore the value, `IN` needs at least one parseable item, `BETWEEN` needs exactly two bounds, and every other operator needs the single scalar to parse (`FilterValueParser.cs:58-64`). The same class decodes the lists at apply time: `ParseList<T>` skips unparseable entries rather than failing the request (`FilterValueParser.cs:17`, the `if (parse(part) is { } parsed)` guard at `FilterValueParser.cs:26`), and `ParseStringList` splits on comma, trimming and dropping empty entries (`FilterValueParser.cs:34`).

Every clause is built through **System.Linq.Dynamic.Core** string predicates with parameter placeholders (`@0`), never string-concatenated values, and every call site passes the one shared [`DynamicQueryConfig.Parameterized`](#dynamicqueryconfig) parsing config (`DynamicQueryConfig.cs:18`, the instance at `DynamicQueryConfig.cs:21-24`). That flag is not cosmetic: Dynamic LINQ defaults `UseParameterizedNamesInDynamicQuery` to `false`, which turns each `@0` into a `ConstantExpression` that EF inlines, so one filter value produced one distinct SQL string, one SQL Server plan-cache entry per value, and an EF compiled-query cache miss on every request (`DynamicQueryConfig.cs:8-15`). With the flag on the value is reached through a member access and EF parameterizes it, and `QueryParameterizationTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:26`) is the regression guard. This is [Rubric §12, Performance & Scalability] hiding inside a one-property config object.

The static [`QueryFilterService`](#queryfilterservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19`) is the registry and dispatcher. It seeds a `ConcurrentDictionary<Type, IFilterStrategy>` with the built-ins, registering both the value type and its `Nullable<>` form (`QueryFilterService.cs:29-45`), keeps a dedicated string instance for string properties and for dotted paths whose leaf type cannot be resolved (`QueryFilterService.cs:52`, fallback at `QueryFilterService.cs:280-283`), and exposes `RegisterStrategy` so a module can add a custom type without touching framework code (`QueryFilterService.cs:60`, the open/closed principle made literal, [Rubric §1, SOLID]). Reflection is memoized per (entity type, property name) but **hits only** (`QueryFilterService.cs:27`, `LookupProperty` at `QueryFilterService.cs:235-246`): the probed names come from the client's query string, so caching misses would let any caller grow a never-evicted static dictionary simply by filtering on names that do not exist, while the request still gets a clean 400 (`QueryFilterService.cs:214-221`). One shared resolver, `ResolvePropertyInfo` (`QueryFilterService.cs:223`), backs both phases so they cannot disagree about what resolves; they used to, and a plain rename entry passed validation and was then silently dropped, returning an unfiltered 200 (`QueryFilterService.cs:208-213`). A dotted path like `"Category.Name"` is walked segment by segment to its leaf type by `ResolveFilterValueType` (`QueryFilterService.cs:259`), so the leaf's own strategy validates the operator instead of every nested path defaulting to the string strategy (`QueryFilterService.cs:153-157`).

The two phases and their ordering are the security story. `ValidateFilters` (`QueryFilterService.cs:111`) runs before the query and returns a [`Result`](group-01-result-error-handling.md#result) carrying every [`Error`](group-01-result-error-handling.md#error) it found: `Filter.Property.NotFound` (`QueryFilterService.cs:143`), `Filter.Type.NotSupported` (`QueryFilterService.cs:163`), `Filter.Operator.NotSupported` (`QueryFilterService.cs:295`), and `Filter.Value.Invalid` (`QueryFilterService.cs:196`), the last suppressed when the operator itself was already rejected so one mistake does not produce two errors (`QueryFilterService.cs:191`). A bad filter is therefore a validation failure, not a SQL exception and not a silently widened result set. `ApplyFilters` (`QueryFilterService.cs:76`) then builds the actual `.Where()` chain, resolving the DTO name through the property map first (`QueryFilterService.cs:84`) and skipping any property it cannot resolve (`QueryFilterService.cs:90`). Strategy dispatch plus allow-listing untrusted input against real entity metadata is [Rubric §2, Design Patterns] and [Rubric §11, Security] together.

## Sorting, sparse fieldsets, and paging arithmetic

[`QueryFieldService`](#queryfieldservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16`) owns the rest of read shaping. `ApplySorting` (`QueryFieldService.cs:112`) resolves a DTO sort name through the server-authored map, and otherwise accepts the column **only** when it names a real public property of the entity (`QueryFieldService.cs:121-125`), falling back to the optional default sort when it does not (`QueryFieldService.cs:134`). That guard is deliberate and documented in the summary (`QueryFieldService.cs:100-103`): a client-supplied string can never reach Dynamic LINQ to order by nested paths or expressions the DTO does not expose. Map entries, being server-authored, may be expressions: ADC sorts speakers by `FullName` through the entry `"(FirstName + \" \" + LastName)"` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:28-31`).

`ApplyFieldSelection` (`QueryFieldService.cs:146`) builds a `MemberInit` `Select` expression so a `fields=name,bio` request pulls only those columns from the database ([Rubric §12, Performance & Scalability]), restricted to writable properties because the projection needs setters (`QueryFieldService.cs:181`). The compiled lambda is cached per (entity type, normalized field set) (`QueryFieldService.cs:174`), and a `null` is cached on purpose to record "this field set projects nothing writable" so the miss is not recomputed per request (`QueryFieldService.cs:167-173`). `ShapeData` and `ShapeCollectionData` (`QueryFieldService.cs:52`, `QueryFieldService.cs:73`) produce the wire shape: an `ExpandoObject` (or a list of them) holding only the requested fields under camelCase keys. To make that cheap on large result sets the service caches a per-type array of [`PropertyAccessor`](#propertyaccessor) (`QueryFieldService.cs:23`), a private `readonly record struct` bundling each property's name, its precomputed camelCase key, and a compiled `Func<object, object?>` getter built with `Expression.Lambda(...).Compile()` rather than `PropertyInfo.GetValue` (`QueryFieldService.cs:25-42`); the field-filtered subset is cached again per field set (`QueryFieldService.cs:299`, `QueryFieldService.cs:305`), under an order- and case-insensitive key so `name,id` and `Id, Name` share one entry (`QueryFieldService.cs:322`). Validation mirrors the filter side: `Validate<TEntity>` rejects unknown field names and (when shaping) read-only properties (`QueryFieldService.cs:209`), and `ValidateSortDirection` accepts only `asc` or `desc` (`QueryFieldService.cs:255`).

Paging arithmetic is small enough to look trivial and is not, which is why it has its own type. [`PagingMath.Clamp`](#pagingmath) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:32`) clamps the page size into `[1, maxPageSize]` and the page number to at least 1 (`PagingMath.cs:37-38`), computes the offset in 64-bit (`PagingMath.cs:40`), and returns `(0, 0)` for a page beyond the reachable offset range, materializing the empty page that page genuinely holds (`PagingMath.cs:42`). A 32-bit `(pageNumber - 1) * pageSize` overflows and wraps negative near `int.MaxValue`, and SQL Server rejects a negative `OFFSET` outright, so the request surfaced as a 500 instead of an empty page (`PagingMath.cs:8-12`). The rule is that every paginating caller routes through here rather than open-coding the multiply, because the arithmetic previously lived only inside the pipeline and the handlers that paginate their own queryable each re-derived it in 32-bit (`PagingMath.cs:14-18`).

## The pipeline, two paths and one contract

[`IEntityQueryPipeline`](#ientityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10`) is the execution contract, implemented by the sealed [`EntityQueryPipeline`](#entityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`), which talks to the database through the [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) abstraction rather than referencing EF Core from the Application layer ([Rubric §3, Clean Architecture]). Its inputs are bundled into [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11`), an immutable record carrying the specification `Criteria`, the dynamic `Filters`, sort column and direction, `Fields`, page number and size, the two include flags, and the DTO-to-entity property map (defaulting to an empty `FrozenDictionary`, `EntityQueryParameters.cs:44`).

`ExecuteAsync` (`EntityQueryPipeline.cs:26`) first adds every supported navigation as an `.Include()` (`EntityQueryPipeline.cs:42-43`), forcing `AsSplitQuery()` when a child collection is among them (`EntityQueryPipeline.cs:49-50`). The comment above that line records the hard-won reason, annotated `R24/§8`: paginating a single-query collection include truncates child rows because EF applies `Skip`/`Take` to the JOIN-expanded set, so list reads returned empty child collections while by-id reads worked (`EntityQueryPipeline.cs:45-48`). It then applies the specification criteria and the dynamic filters **before** materializing anything (`EntityQueryPipeline.cs:56-57`, `EntityQueryPipeline.cs:59-60`), so the data source does as much of the work as possible. From there it branches on whether any requested navigation is unsupported (`EntityQueryPipeline.cs:65`). **Path 1, server-side includes** (`EntityQueryPipeline.cs:125`): sort (`:132`), count before paging (`:141`), `Skip`/`Take` (`:142`), field-selection `Select` (`:152`), materialize (`:153`). **Path 2, manual navigation** (`EntityQueryPipeline.cs:76`), taken when a requested navigation crosses a physical data source and cannot be joined: sort and page at the database first (`:89`, `:96`), materialize the page (`:105`), then invoke the `navigationPopulator` callback to batch-load those navigations in a second query (`:108`), the [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) extension point of [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), and apply field selection in memory afterwards (`:117`).

Both paths share one [Rubric §12, Performance & Scalability] safety ceiling: an unpaginated query is capped at `MaxUnboundedResultLimit`, a public `const int` of 1000 (`EntityQueryPipeline.cs:23`, applied at `EntityQueryPipeline.cs:102` and `EntityQueryPipeline.cs:148`), and a paginated call has its page size clamped to that same ceiling inside `ApplyPaging`, which delegates the offset arithmetic to `PagingMath.Clamp` (`EntityQueryPipeline.cs:172-181`). A direct service caller who forgets or oversizes paging therefore can never trigger an unbounded full-table load. The reported total for an unpaginated read is not simply the materialized count: `CountUnpaginatedAsync` (`EntityQueryPipeline.cs:189`) returns the materialized count only while it stays under the ceiling and issues a real `COUNT` otherwise, because at the cap the materialized number is the cap itself and reporting it told callers the set was exactly 1000 rows (`EntityQueryPipeline.cs:184-195`).

Which navigations are eligible, and which path each takes, is decided by [`NavigationMetadataProvider`](#navigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`) behind [`INavigationMetadataProvider`](#inavigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9`). `BuildIncludes` asks separately for FK references and child collections (`NavigationMetadataProvider.cs:31`), and the classifier reflects over the entity's public properties looking for [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (`NavigationMetadataProvider.cs:74`), unwraps `ICollection<T>` / `IReadOnlyCollection<T>` to find the target entity (`NavigationMetadataProvider.cs:106`), and asks [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) whether the two ends share a JOIN-capable source, sorting each [`NavigationPropertyInfo`](group-11-navigation-populators.md#navigationpropertyinfo) into the supported or unsupported bucket of [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (`NavigationMetadataProvider.cs:96-99`). Results are cached per (entity type, [`NavigationType`](group-11-navigation-populators.md#navigationtype)) in an **instance-level** dictionary, not a static one, precisely so that a process hosting more than one data-source configuration (integration tests, for example) cannot share classifications across hosts (`NavigationMetadataProvider.cs:28`, rationale at `NavigationMetadataProvider.cs:22-27`).

## The query service, the public face

[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19`) and its concrete [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:31`) are what controllers and handlers inject. The service is constructed from [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the metadata provider, the pipeline, an [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), and an `INavigationPopulator<TEntity>` (`EntityQueryService.cs:31-36`), and it resolves its [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) from the unit of work through a `virtual` property (`EntityQueryService.cs:48`).

`GetAllAsync` (`EntityQueryService.cs:209`, with a five-parameter convenience overload at `EntityQueryService.cs:188`) is the four-step orchestration. **(1) Validate** every parameter up front with `Result.Combine` over the fields, sort-column, sort-direction, and filter validators, so a bad `fields` fails before any database hit (`EntityQueryService.cs:223-228`), re-stamping each error with the operation and entity name (`EntityQueryService.cs:231-237`). **(2) Build the query** in `BuildQueryAsync` (`EntityQueryService.cs:406`): pick `Repository.Table` or `TableNoTracking` from the `asTracking` flag (`EntityQueryService.cs:419-421`), ask the metadata provider which includes are supported (`EntityQueryService.cs:423`), pack everything into `EntityQueryParameters` (`EntityQueryService.cs:425`), and hand off to `IEntityQueryPipeline.ExecuteAsync` with the populator callback (`EntityQueryService.cs:439-444`). **(3) Map and shape**: convert entities to DTOs through `DTOMapper.MapToDTOs`, then shape **only when a field subset was requested**, otherwise return the typed DTOs as-is to avoid a per-row `ExpandoObject` allocation and boxing (`EntityQueryService.cs:264-266`); both forms serialize to the same camelCase JSON, which is why the return type is `PagedCollectionResult<object>` rather than a typed collection ([`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), and the contract note at `IEntityQueryService.cs:12-14`). **(4) Wrap** in [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) (`EntityQueryService.cs:447`), which for an unpaginated call reports the total count as the page size and page 1 (`EntityQueryService.cs:451-456`), and for a paginated call reports the page size the pipeline actually applied, `Math.Min(pageSize, MaxUnboundedResultLimit)`, rather than the one requested (`EntityQueryService.cs:465`).

The by-id path has a fast lane worth knowing. `GetEntityByIdAsync` (`EntityQueryService.cs:306`) validates the fields (`:316`), then tries `TryGetByIdFastPathAsync` (`EntityQueryService.cs:80`). `TryGetFastPathIncludes` (`EntityQueryService.cs:122`) decides eligibility: a field projection, a specification, or a non-default `idField` disqualifies the request (`EntityQueryService.cs:132-134`), and so do unsupported (cross-source) navigations, since only the pipeline's populator can batch-load those (`EntityQueryService.cs:145-147`, rationale at `:116-120`). Requested includes do **not** disqualify it: the repository's include overload applies the same `Include` calls and auto-applies `AsSplitQuery` for a child collection (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:164`, split at `EFReadRepository.cs:277`), and disqualifying on includes left the fast path unreachable for every entity that declares a navigation, because the REST by-id action defaults `includeFKs` to true (`EntityQueryService.cs:106-114`). The string id is converted with a `TypeConverter` cached per identifier type (`EntityQueryService.cs:159`, cache at `EntityQueryService.cs:68`), and the read runs on the filtered `TableNoTracking`, so soft-delete query filters still apply, unlike `FindAsync` (`EntityQueryService.cs:74-77`, `EFReadRepository.cs:173`). Anything else falls through to the pipeline with a synthetic `Id EQUALS <value>` filter (`EntityQueryService.cs:338-341`) and returns `Error.NotFound` when the page is empty (`EntityQueryService.cs:357`). `GetByIdAsync` (`EntityQueryService.cs:367`) layers DTO mapping and the same shape-only-if-fields rule on top (`EntityQueryService.cs:391-393`); `GetAllForLookupAsync` (`EntityQueryService.cs:278`) returns lightweight [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) id/name pairs for dropdowns; `ExistsAsync` (`EntityQueryService.cs:397`) delegates straight to the repository. The class is built for extension over modification ([Rubric §1, SOLID]): `Repository` (`:48`), `DTOToEntityPropertyMap` (`:61`), and every query method are `virtual`, so a module subclass such as [`SpeakerEntityQueryService`](group-18-conference-application.md#speakerentityqueryservice) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:15`) overrides one behavior (`SpeakerEntityQueryService.cs:34`) without reimplementing the engine.

## End to end, one list request

The request reaches a read controller, [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) (Group 12), which resolves `MaxPageSize` per request from [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), falling back to 500 when unset (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:50-56`), clamps the requested page size to it (`EntityControllerBase.cs:127`), binds `?filter=` through `QueryFilterModelBinder` (`EntityControllerBase.cs:124`), and may supply a server-authored specification for authorization scope. It calls `IEntityQueryService.GetAllAsync`. The service validates fields, sort, and filters (an early failure short-circuits to an error result), classifies the requested includes, and packages an `EntityQueryParameters`. `EntityQueryPipeline` chooses Path 1 or Path 2, applies the specification criteria plus the dynamic filters as translated, parameterized `WHERE` clauses, sorts, counts, pages through `PagingMath`, projects the requested columns, materializes, batch-loads any cross-source navigations, and returns the entities plus the total. The service maps to DTOs, shapes only if a field subset was asked for, and returns a `Result<PagedCollectionResult<object>>` that the controller unwraps into the HTTP body plus an `X-Pagination` header carrying the serialized metadata (`EntityControllerBase.cs:144`). One pipeline, every entity, validated input, server-side execution, and a clean extension point for navigations that cross a service boundary ([Rubric §6, CQRS & Event-Driven] on the read side, [Rubric §9, API & Contract Design] for the uniform query contract).

### DynamicQueryConfig
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DynamicQueryConfig.cs:18` · Level 0 · class (internal, static)

- **What it is**: a one-field static holder for the single `ParsingConfig` that every
  System.Linq.Dynamic.Core call in the read pipeline passes, with
  `UseParameterizedNamesInDynamicQuery` turned on.
- **Depends on**: nothing first-party. `System.Linq.Dynamic.Core` (`ParsingConfig`), the
  string-expression query API taught in
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0).
- **Concept introduced, why a dynamic-LINQ value must become a SQL parameter and not a literal.**
  Dynamic LINQ defaults `UseParameterizedNamesInDynamicQuery` to `false`, which compiles each `@0`
  argument into a `ConstantExpression`. EF Core inlines constants, so
  `filters["Name"] = ("EQUALS", "Widget")` emitted `WHERE [Name] = 'Widget'`: a *distinct SQL string
  per distinct filter value* (`DynamicQueryConfig.cs:8-16`). Two costs follow from that, both stated
  in the doc comment: SQL Server allocates a plan-cache entry per value, and EF's compiled-query
  cache misses on every request because the expression tree differs each time. With the flag on, the
  value is reached through a member access on a closure object instead, so EF parameterizes it and
  one plan serves every value. `[Rubric §12, Performance & Scalability]` (assesses whether the hot
  path avoids repeated per-request work): this is a one-line configuration change that converts an
  unbounded plan-cache footprint into a single cached plan. `[Rubric §14, Testability]` (assesses
  whether an invariant has an executable guard): the doc comment names its own regression test,
  `QueryParameterizationTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:26`),
  which inspects the emitted SQL through `ToQueryString()` (`:34-37`) because nothing else in the
  suite looks at SQL shape.
- **Walkthrough**: the whole type is one field.
  `internal static readonly ParsingConfig Parameterized = new() { UseParameterizedNamesInDynamicQuery = true }`
  (`DynamicQueryConfig.cs:21-24`). The doc comment on the field (`:20`) explains why it is a single
  shared instance rather than a per-call `new`: building a config per call would reintroduce the
  parse cost the flag exists to avoid.
- **Why it's built this way**: `ParsingConfig` is immutable in use and thread-safe to share, so one
  static instance is both the cheapest and the only way to guarantee that no call site accidentally
  runs with the default (constant-folding) config. Keeping it `internal` means no consumer can pass a
  different config into the built-in strategies.
- **Where it's used**: passed as the first argument to every `query.Where(...)` in all seven built-in
  strategies (for example `IntFilterStrategy.cs:28`, `StringFilterStrategy.cs:23`,
  `DateTimeFilterStrategy.cs:32`) and to the `OrderBy` in
  [`QueryFieldService.ApplySorting`](#queryfieldservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:130`, which
  qualifies it as `Filtering.DynamicQueryConfig.Parameterized` because it sits in the parent
  namespace).
- **Caveats / not-in-source**: `internal`, so a consumer writing a custom
  [`IFilterStrategy`](#ifilterstrategy) outside this assembly cannot pass this config and gets the
  Dynamic LINQ default (constant inlining) unless it builds its own `ParsingConfig`.

---

### FilterValueParser
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/FilterValueParser.cs:8` · Level 0 · class (internal, static)

- **What it is**: a small internal helper that splits the comma-separated value list carried by the
  `IN` filter operator (and the two-bound list behind `BETWEEN`) into a typed list, skipping any
  entry that fails to parse, plus the shared up-front check that decides whether a raw value is
  usable at all for a given operator.
- **Depends on**: nothing first-party. BCL only (`string.Split`, `StringSplitOptions`).
- **Concept introduced, set membership in a URL filter, and the split between lenient application
  and strict validation.** The dynamic-filter vocabulary is one operator string plus one value string
  per property (see [`IFilterStrategy`](#ifilterstrategy)), so an `IN` filter has to smuggle a *set*,
  and `BETWEEN` a *pair of bounds*, through a single string. This class is the one place that decodes
  that convention:
  `value.Split(Separator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)`
  (`FilterValueParser.cs:24`, `:39`), so `"1, 2 ,3"` and `"1,2,3"` behave identically and empty slots
  vanish. `[Rubric §9, API & Contract Design]` (assesses whether query conventions are uniform and
  predictable): every strategy that supports `IN` or `BETWEEN` decodes the list the same way, so a
  client never has to learn a per-type list syntax. `[Rubric §15, Best Practices & Code Quality]`
  (assesses defensive, exception-free handling of untrusted input): at *application* time an
  unparseable entry is skipped rather than thrown on (`:3-7`), matching the single-value strategies,
  which return the query unfiltered instead of failing.
- **Walkthrough**
  - `Separator` (`:10`): a `static readonly char[]` holding a single comma, hoisted to a field so the
    array is allocated once rather than per call.
  - `ParseList<T>(string value, Func<string, T?> parse)` (`:17-31`), constrained `where T : struct`.
    The caller supplies the per-item parse delegate, so the parser stays type-agnostic. A
    null/whitespace input returns an empty list (`:21-22`); each part is run through `parse` and
    added only when the nullable result has a value (`if (parse(part) is { } parsed)`, `:26-27`).
  - `ParseStringList(string value)` (`:34-40`): the string overload, no per-item parse needed, just
    the split with the same options, returning `[]` for empty input (`:37`).
  - `CanParse<T>(string op, string value, Func<string, T?> parse)` (`:53-65`): the shared
    value-usability check every value-type strategy delegates its `CanParseValue` to. It encodes the
    shape all seven strategies share, verbatim from the switch at `:58-64`: presence checks
    (`IS EMPTY`, `IS NOT EMPTY`) ignore the value and always return `true`; `IN` needs at least one
    parseable item (`ParseList(...).Count > 0`); `BETWEEN` needs exactly two bounds
    (`ParseList(...).Count == 2`); every other operator needs the single scalar to parse
    (`parse(value) is not null`). It null-guards the delegate (`:56`).
- **Why it's built this way**: the `Func<string, T?>` shape lets each caller pass its own `TryParse`
  in a `static` lambda or a `static` method group, so no closure is allocated (see
  [`IntFilterStrategy`](#intfilterstrategy)`.ParseInt`, `IntFilterStrategy.cs:63`). Returning a
  `List<T>` rather than an array matters downstream: LINQ Dynamic binds it as the receiver of a
  `Contains` call. Putting `CanParse` here rather than in each strategy is what keeps the *validation*
  rule and the *application* rule from drifting apart, which is exactly the class of bug
  [`QueryFilterService`](#queryfilterservice) documents at
  `QueryFilterService.cs:176-179`.
- **Where it's used**: every value strategy that supports `IN` or `BETWEEN` routes through
  `ParseList`: [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:59`,
  `:66`), [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:55`, `:62`),
  [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:38`),
  [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:50`, `:57`), and
  [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:55`, `:62`);
  [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:45`) calls
  `ParseStringList`. `CanParse` backs the `CanParseValue` override on all six value strategies
  (`BoolFilterStrategy.cs:21`, `DateTimeFilterStrategy.cs:26`, `DecimalFilterStrategy.cs:25`,
  `GuidFilterStrategy.cs:22`, `IntFilterStrategy.cs:23`, `LongFilterStrategy.cs:25`).
- **Caveats / not-in-source**: `internal`, so a consumer writing a custom
  [`IFilterStrategy`](#ifilterstrategy) outside this assembly cannot reuse it and must decode its own
  list syntax. There is no size cap on the parsed list in this class; the only bound on how many
  values an `IN` filter may carry comes from the request size and from `MaxFilters = 50` in
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:34`),
  which caps the number of *filters*, not the number of values inside one.

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
    query when the operator is unrecognized: application is best-effort and never throws.
  - `IReadOnlySet<string>? SupportedOperators => null` (`:24`), a **default interface member**. A
    default interface member supplies a body on the interface itself, so an implementer can ignore it
    entirely. Returning `null` means "skip operator validation" (`:21-22`), the tolerant default for
    a third-party strategy; the seven built-in strategies override it with a `FrozenSet` so
    [`QueryFilterService`](#queryfilterservice) can reject an unknown operator up front as a
    validation failure instead of letting it degrade into a silent no-op.
  - `bool CanParseValue(string op, string value) => true` (`:44`), the second default interface
    member and the fix for the failure mode the remarks spell out (`:32-43`). Because `Apply` fails
    *open* (an unparseable value yields the query unfiltered), `?filter=id:equals:abc` used to return
    the **whole result set** instead of no matches. Validating the value before execution turns that
    into a 400. `[Rubric §11, Security]` (assesses whether malformed input can widen a response
    beyond what the caller is entitled to see): a filter that silently disappears is not a neutral
    no-op, it is a broadened read. The default of `true` keeps a pre-existing custom strategy working
    unchanged until it opts in (`:39-42`).
- **Why it's built this way**: operators are plain strings rather than an enum, so a consumer can
  extend the vocabulary without a framework change; splitting per type keeps each type's parsing and
  comparison rules isolated and unit-testable. Both extension points are default interface members
  rather than abstract ones precisely so that adding them was not a breaking change for an
  out-of-tree implementer.
- **Where it's used**: implemented by the seven built-in strategies below; the registry, the
  dispatch, and the up-front validation all live in [`QueryFilterService`](#queryfilterservice)
  (`QueryFilterService.cs:191`, `:194` for the two validation hooks).

---

### PropertyAccessor
> MMCA.Common.Application · `MMCA.Common.Application.Services` (private, nested in `QueryFieldService`) · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:46` · Level 0 · record struct (readonly, private)

- **What it is**: a tiny `private readonly record struct` declared inside
  [`QueryFieldService`](#queryfieldservice) that bundles a property's CLR name, its pre-computed
  camelCase JSON name, and a compiled `Func<object, object?>` getter, so a property value can be read
  without per-call reflection.
- **Depends on**: nothing first-party. `System.Reflection`, `System.Linq.Expressions`,
  `System.Text.Json` (`JsonNamingPolicy`) (BCL).
- **Concept introduced, compile-once expression delegates instead of per-call reflection.**
  `[Rubric §12, Performance & Scalability]` (assesses whether hot paths avoid avoidable per-request
  work): `PropertyInfo.GetValue` allocates an argument array on *every* invocation, and shaping a
  1,000-row page with 20 properties would pay that cost 20,000 times. The getter is instead built as
  an expression tree and compiled once per property, inside the per-type loop in `GetAccessors`
  (`QueryFieldService.cs:53-62`): a parameter of `object` (`:56`), a cast to the entity type (`:57`),
  the property access (`:58`), a box back to `object` (`:59`), then
  `Expression.Lambda<Func<object, object?>>(...).Compile()` (`:60`). Caching the result collapses each
  later read to a delegate call. The `readonly record struct` shape is the idiomatic .NET carrier for
  a small immutable tuple of values: no heap allocation per element, structural equality for free.
- **Walkthrough**: the whole type is one positional declaration,
  `private readonly record struct PropertyAccessor(string PropertyName, string CamelCaseName,
  Func<object, object?> GetValue)` (`QueryFieldService.cs:46`).
  - `PropertyName` is the raw CLR name (`:61`) and is what a requested `?fields=` entry is matched
    against, case-insensitively, when the accessor array is filtered down to the requested subset in
    `FilterAccessorsByFields` (`:387-393`, the `StringComparer.OrdinalIgnoreCase` match at `:392`).
  - `CamelCaseName` is computed once at construction with `CamelCase.ConvertName(prop.Name)` (`:61`,
    the `JsonNamingPolicy.CamelCase` field held at `:43`) and becomes the `ExpandoObject` key, so the
    shaped payload matches the JSON casing a typed DTO would produce.
  - `GetValue` is the compiled getter, invoked once per property per row: in `ShapeData` (`:75-87`,
    the invocation at `:83`) and in `ShapeCollectionData` (`:96-117`, the invocation at `:110`).
- **Why it's built this way**: `private` keeps a hot-path implementation detail out of the public
  surface; the struct plus record combination gives an allocation-free value carrier that is cheap to
  store in the cached arrays.
- **Where it's used**: exclusively inside [`QueryFieldService`](#queryfieldservice). Two caches hold
  it: `AccessorCache` (`ConcurrentDictionary<Type, PropertyAccessor[]>`, `:42`), populated once per
  entity/DTO type by `GetAccessors<TEntity>` (`:48-65`), and `ShapedAccessorCache`
  (`ConcurrentDictionary<(Type EntityType, string Fields), PropertyAccessor[]>`, `:405`), which holds
  the pre-filtered subset for a given `fields=` request. Both are read by `GetShapedAccessors`
  (`:411-436`), which returns the full array when no field list was given (`:416-417`) and, once
  `ShapedAccessorCache` has reached the `MaxCacheEntries` cap of 512 (`:39`), filters per request
  rather than admitting another client-shaped key (`:429-430`).

---

> The **seven built-in filter strategies** that follow share one shape: each is an `internal sealed`
> class implementing [`IFilterStrategy`](#ifilterstrategy) for one CLR type family, declaring its
> `SupportedOperators` as a `HashSet` built with `StringComparer.Ordinal` and frozen with
> `.ToFrozenSet(StringComparer.Ordinal)` (a `FrozenSet` is the read-optimised immutable set the
> framework reaches for whenever a lookup table is built once and read many times), then switching on
> the operator to build a LINQ Dynamic `.Where()` string. Five rules hold across all seven and are
> not repeated in every section below.
>
> 1. **Bound parameters, never string concatenation, and never inlined constants.** Values are passed
>    as the positional parameter `@0` (`@0`/`@1` for `BETWEEN`) rather than interpolated into the
>    expression text, and every call passes
>    [`DynamicQueryConfig.Parameterized`](#dynamicqueryconfig) so the argument reaches EF Core as a
>    real SQL parameter instead of a folded constant. That is both the injection-resistance property
>    (`[Rubric §11, Security]`) and the plan-reuse property (`[Rubric §12, Performance &
>    Scalability]`).
> 2. **Parse failure is a no-op at apply time.** A value that fails to parse (or an unrecognized
>    operator via the `_ =>` default arm) returns the **unfiltered** query rather than throwing,
>    exactly the no-op the [`IFilterStrategy`](#ifilterstrategy) contract promises.
> 3. **Validation closes the fail-open hole that rule 2 leaves.** Because an unfiltered query is a
>    *widened* response, the six value strategies override `CanParseValue` by delegating to
>    [`FilterValueParser.CanParse`](#filtervalueparser) with their own parse function, so
>    [`QueryFilterService`](#queryfilterservice) rejects the request before it executes.
>    [`StringFilterStrategy`](#stringfilterstrategy) is the one that does not override it: every raw
>    string is a valid string, so the interface default of `true` is already correct.
> 4. **`IN` is set membership.** The strategies that support `IN` decode a comma list through
>    [`FilterValueParser`](#filtervalueparser) and emit `@0.Contains({property})`, with the parsed
>    list as the *receiver* `@0` and the entity property as the argument, the shape LINQ Dynamic turns
>    into SQL `IN (...)`. An empty parsed list short-circuits to the unfiltered query at apply time.
>    `[Rubric §12, Performance & Scalability]`: a UI that fetches many rows by id issues one query
>    instead of a chain of round trips.
> 5. **`BETWEEN` is an inclusive range, `IS EMPTY` / `IS NOT EMPTY` are value-free null checks.**
>    `BETWEEN` reads exactly two comma-separated bounds and emits
>    `{property} >= @0 && {property} <= @1` (inclusive on both ends); a list that is not exactly two
>    bounds is a no-op at apply time and a `Filter.Value.Invalid` error at validation time. `IS EMPTY`
>    / `IS NOT EMPTY` take no value at all and emit `{property} == null` / `{property} != null`
>    (`string.IsNullOrEmpty(...)` for the string strategy), so a nullable column can be filtered for
>    presence.
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
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core` (the `query.Where(config, "expr", args)` string-expression API taught in
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0)).
- **Walkthrough**: `SupportedOperators` is the three-entry frozen set `{ "IS", "IS EMPTY", "IS NOT
  EMPTY" }` (`:14-17`). `CanParseValue` (`:20-21`) delegates to
  [`FilterValueParser.CanParse`](#filtervalueparser) with a `static` lambda over `bool.TryParse`.
  `Apply<T>` (`:23-31`) puts the value-free presence checks *first*, before the parse, because they
  do not depend on the value (the inline comment states this, `:26`):
  `"IS EMPTY" => query.Where(DynamicQueryConfig.Parameterized, $"{property} == null")` and the `!=`
  twin (`:27-28`). The one equality arm parses inside a `when` guard,
  `"IS" when bool.TryParse(value, out var boolValue) => query.Where(DynamicQueryConfig.Parameterized,
  $"{property} == @0", boolValue)` (`:29`), so an unparseable value falls to `_ => query` (`:30`)
  rather than throwing, and is caught earlier by `CanParseValue` at validation time.
- **Why it's built this way**: `IS` (rather than `EQUALS`) reads naturally for a boolean in a URL
  filter, and a boolean has no ordering, so no comparison operators exist to support; the null checks
  are the meaningful extra for a `bool?` column.
- **Where it's used**: registered against both `typeof(bool)` and `typeof(bool?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:33-34`). Note that the two keys
  get **two separate instances**, not one shared instance.
- **Caveats / not-in-source**: there is no `IN` arm, since a boolean set is degenerate.

---

### DateTimeFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `DateTime` and `DateTime?`, covering
  the six temporal comparisons, the two null checks, set membership (`IN`), and an inclusive
  `BETWEEN` range.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Globalization`, `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Concept introduced, culture-invariant parsing of untrusted input.** `FormatProvider` is a static
  `CultureInfo.InvariantCulture` (`:15`) used by every `DateTime.TryParse` call, so `"2026-07-21"`
  parses identically regardless of the server's locale. That is the single-locale, culture-safe
  posture described in [primer §4](00-primer.md#4-c-build-and-code-style-conventions), and it is what
  keeps a filter from meaning different things on two hosts in the same cluster.
- **Walkthrough**: `SupportedOperators` (`:17-22`) is the ten-entry frozen set. `CanParseValue`
  (`:25-26`) delegates to [`FilterValueParser.CanParse`](#filtervalueparser) with the `ParseDateTime`
  method group. `Apply<T>` (`:28-47`) parses **inside** each temporal arm via a `when` clause, for
  example
  `"IS AFTER" when DateTime.TryParse(value, FormatProvider, DateTimeStyles.None, out var dt) =>
  query.Where(DynamicQueryConfig.Parameterized, $"{property} > @0", dt)` (`:35-36`). A failed parse
  means the `when` guard is false and the arm does not match. The two null operators need no value
  (`:43-44`). The `_ =>` arm routes to `ApplyInOrRange` (`:46`), which dispatches `IN` to `ApplyIn`
  and `BETWEEN` to `ApplyBetween` (`:49-55`). `ApplyIn` (`:57-61`) parses through
  [`FilterValueParser.ParseList`](#filtervalueparser) with `ParseDateTime` (`:59`) and emits
  `@0.Contains({property})` (`:60`); `ApplyBetween` (`:63-70`) requires exactly two bounds and emits
  `{property} >= @0 && {property} <= @1` (`:68`). `ParseDateTime` (`:72-73`) is the shared
  culture-invariant `TryParse`.
- **Why it's built this way**: parsing per arm keeps the value-taking and the value-free operators in
  one switch without a pre-parse that would reject `IS EMPTY` for having no parsable value; splitting
  `IN`/`BETWEEN` into a helper keeps the main switch under the analyzers' cyclomatic-complexity
  ceiling (the inline comment at `:45` records the reason).
- **Where it's used**: registered against `typeof(DateTime)` and `typeof(DateTime?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:39-40`), as two instances.
- **Caveats / not-in-source**: nothing here normalizes to UTC: the parsed value is used as given
  (`DateTimeStyles.None`), so the caller is responsible for supplying a value in the column's kind.

---

### DecimalFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:14` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `decimal` and `decimal?`, supporting
  equality, the four ordering comparisons, set membership (`IN`), an inclusive `BETWEEN`, and the two
  null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Globalization`, `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:16-21`) lists the ten operators. `CanParseValue` (`:24-25`)
  delegates to [`FilterValueParser.CanParse`](#filtervalueparser) with `ParseDecimal`. `Apply<T>`
  (`:27-40`) parses each single-value arm through the private `TryParse` helper
  (`decimal.TryParse(value, CultureInfo.InvariantCulture, out result)`, `:42-43`) inside a `when`
  guard, then the six `@0` comparisons (`:30-35`) and the two null checks (`:36-37`). The `_ =>` arm
  routes to `ApplyInOrRange` (`:39`, `:45-51`); `ApplyIn` (`:53-57`) and `ApplyBetween` (`:59-66`)
  parse through [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseDecimal` helper
  (`:68-69`). The invariant culture is the load-bearing detail: it fixes `.` as the decimal separator,
  so a price filter cannot silently change meaning on a host with a different locale.
- **Why it's built this way**: `decimal` (not `double`) is the money/quantity type across the
  codebase, so the filter type matches the storage type exactly and no precision is lost at the
  boundary.
- **Where it's used**: registered against `typeof(decimal)` and `typeof(decimal?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:41-42`).

---

### GuidFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:13` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `Guid` and `Guid?`, supporting
  equality, set membership (`IN`), and the two null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:15-18`) is `{ EQUALS, NOT EQUALS, IN, IS EMPTY, IS NOT
  EMPTY }`. `CanParseValue` (`:21-22`) delegates to
  [`FilterValueParser.CanParse`](#filtervalueparser) with `ParseGuid`. `Apply<T>` (`:24-34`) parses
  the two single-value equality arms with a `Guid.TryParse` `when` guard (`:27-28`), handles the
  value-free null checks (`:29-30`), and routes `IN` last (`:32`) because a comma-separated list
  would never parse as one GUID (the inline comment at `:31` records this). `ApplyIn` (`:36-40`)
  parses through [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseGuid` method
  group (`:38`) and emits the receiver-inverted `@0.Contains({property})` (`:39`). `ParseGuid`
  (`:42`) is the shared `TryParse` wrapper.
- **Why it's built this way**: GUIDs have no meaningful ordering, so no comparison or range operators
  are provided; equality, membership, and presence are the full useful set for an opaque identifier.
- **Where it's used**: registered against `typeof(Guid)` and `typeof(Guid?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:43-44`). It is the strategy that
  serves by-id filtering wherever an entity's identifier alias resolves to `Guid`.
- **Caveats / not-in-source**: no ordering operators and no `BETWEEN`, since a GUID range is
  meaningless.

---

### IntFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:12` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `int` and `int?`, one of the four
  widest surfaces: equality, the four ordering comparisons, `IN`, an inclusive `BETWEEN`, and the two
  null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:14-19`) holds the ten operators. `CanParseValue` (`:22-23`)
  delegates to [`FilterValueParser.CanParse`](#filtervalueparser) with `ParseInt`. `Apply<T>`
  (`:25-38`) handles the six single-value comparison arms with an inline `int.TryParse` guard
  (`:28-33`) and the two value-free null checks (`:34-35`), then falls to `ApplyInOrRange` (`:37`,
  `:40-46`). `ApplyIn` (`:48-52`) parses through
  [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseInt` method group (`:50`);
  `ApplyBetween` (`:54-61`) requires exactly two bounds (`bounds.Count == 2`, `:58`) and emits
  `{property} >= @0 && {property} <= @1` (`:59`). `ParseInt` (`:63`) is the shared wrapper. Unlike
  the `decimal` and `long` strategies this one does not pass an explicit `CultureInfo`, since a
  plain `int.TryParse` has no culture-sensitive separator to get wrong for the digits-only forms the
  API accepts.
- **Why it's built this way**: `int` is the default identifier alias across most modules, so this
  strategy carries the by-id and by-parent-id filtering for the majority of entities, which is why it
  gets the full comparison/`IN`/`BETWEEN` surface.
- **Where it's used**: registered against `typeof(int)` and `typeof(int?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:35-36`); reached indirectly by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype)'s synthetic
  `Id EQUALS` filter (`EntityQueryService.cs:338-341`) whenever the identifier alias is `int` and the
  by-id fast path did not apply.

---

### LongFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/LongFilterStrategy.cs:14` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `long` and `long?`, a structural twin
  of [`IntFilterStrategy`](#intfilterstrategy): equality, the four ordering comparisons, `IN`, an
  inclusive `BETWEEN`, and the two null checks, over 64-bit integers.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Globalization`, `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Concept, filling a type gap without a startup call.** The class doc comment (`:11-12`) states the
  reason this type exists: it is "registered by default so long-keyed entities filter without a
  startup [`QueryFilterService`](#queryfilterservice)`.RegisterStrategy` call." Earlier editions of
  the framework had no built-in `long` strategy, so a `bigint`-keyed entity had to call
  `RegisterStrategy` at composition time; making it a default entry closes that gap
  (`[Rubric §16, Maintainability]`, which assesses whether a common case works with zero
  configuration).
- **Walkthrough**: `SupportedOperators` (`:16-21`) holds the ten operators. `CanParseValue` (`:24-25`)
  delegates to [`FilterValueParser.CanParse`](#filtervalueparser) with `ParseLong`. `Apply<T>`
  (`:27-40`) parses each single-value arm through the private `TryParse` helper
  (`long.TryParse(value, CultureInfo.InvariantCulture, out result)`, `:42-43`) inside a `when` guard,
  then the two null checks (`:36-37`), then `ApplyInOrRange` (`:39`, `:45-51`). `ApplyIn` (`:53-57`)
  and `ApplyBetween` (`:59-66`) parse through [`FilterValueParser.ParseList`](#filtervalueparser) with
  the `ParseLong` helper (`:68-69`), the same shape as the `int` and `decimal` strategies.
- **Why it's built this way**: mirroring the `int` strategy keeps the numeric operator vocabulary
  identical whether a key is 32-bit or 64-bit, so a client never has to know the underlying width.
- **Where it's used**: registered against `typeof(long)` and `typeof(long?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:37-38`).

---

### StringFilterStrategy
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/StringFilterStrategy.cs:12` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `string` properties, and the fallback
  strategy for any nested property path whose leaf type cannot be resolved by reflection.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Collections.Frozen`,
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
  the family behind the four ten-operator numeric/date strategies. This is the only built-in strategy
  that does **not** override `CanParseValue`, so it inherits the interface default of `true`
  (`IFilterStrategy.cs:44`): every raw string is a usable string value, so there is nothing to
  reject. `Apply<T>` (`:20-30`) handles the six value-taking text operators, then delegates the rest
  to `ApplyPresenceOrSet` (`:34-41`); the inline comment (`:32-33`) records why, the split keeps each
  method under the cyclomatic-complexity ceiling the analyzers enforce as errors.
  `ApplyPresenceOrSet` covers `IS EMPTY`, `IS NOT EMPTY`, and routes `IN` to `ApplyIn` (`:43-47`),
  which uses [`FilterValueParser.ParseStringList`](#filtervalueparser) (`:45`) and emits the same
  `@0.Contains({property})` receiver-inverted form as the other `IN` strategies.
- **Why it's built this way**: the class doc comment (`:6-11`) still describes this strategy as the
  one used "for nested property paths (e.g. `Category.Name`) regardless of the target type, since
  LINQ Dynamic evaluates the full path as a string expression." The code no longer routes *every*
  dotted path here: [`QueryFilterService.ResolveFilterValueType`](#queryfilterservice)
  (`QueryFilterService.cs:259-278`) walks the path to its leaf and picks the leaf's own strategy, and
  only falls back to this one when a segment cannot be resolved (`ResolveStrategy`, `:280-283`, maps
  a `null` value type to `StringStrategy`). **Trust the code here, not the doc comment**: a filter on
  `"Category.Id"` now gets [`IntFilterStrategy`](#intfilterstrategy)'s operator set, not this one's.
- **Where it's used**: registered against `typeof(string)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:32`), and held a second time as
  the dedicated `StringStrategy` field (`QueryFilterService.cs:52`) that `ResolveStrategy` returns for
  string properties and unresolvable paths (`:280-283`).
- **Caveats / not-in-source**: nothing here escapes LIKE wildcards, so a `%` inside a `CONTAINS`
  value reaches the database as part of the pattern. The value is still a bound parameter (rule 1 of
  the family preamble), so this is a matching-semantics detail, not an injection vector.

---

### QueryFieldService
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16` · Level 3 · class (sealed, all members static)

- **What it is**: the read-side utility that owns four jobs: **field validation**, **data shaping**
  (sparse-fieldset projection onto `ExpandoObject`), **dynamic sorting**, and **server-side field
  selection** (building an EF `Select` expression). It caches reflected metadata, compiled getters,
  and compiled projections per type so that work is paid once per process, not once per request.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error),
  [`PropertyAccessor`](#propertyaccessor) (its own nested struct),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Linq.Dynamic.Core`, `System.Dynamic`
  (`ExpandoObject`), `System.Reflection`, `System.Text.Json`, `System.Collections.Concurrent`.
- **Concept introduced, sparse fieldsets and a four-cache metadata layer.** `[Rubric §9, API &
  Contract Design]` (assesses whether clients can ask for exactly the data they need): a
  `?fields=id,name` request narrows both the SQL `SELECT` and the JSON payload. `[Rubric §12,
  Performance & Scalability]`: four static `ConcurrentDictionary` caches back everything.
  - `PropertiesCache` (`Type -> PropertyInfo[]`, `:18`) for the validation and projection paths.
  - `AccessorCache` (`Type -> PropertyAccessor[]`, `:19`) for the shaping path, built by
    `GetAccessors<TEntity>` (`:25-42`), which compiles one
    `Expression.Lambda<Func<object, object?>>` per property (`:33-37`) and pre-computes the camelCase
    name (`:38`).
  - `ProjectionCache` (`(Type, string Fields) -> LambdaExpression?`, `:174`) so the `MemberInit`
    tree is built once per (entity, field set) instead of per request. Its remarks (`:167-173`)
    explain that a `null` value is cached **deliberately**: it records "this field set projects
    nothing writable", so the miss is not recomputed every time.
  - `ShapedAccessorCache` (`(Type, string Fields) -> PropertyAccessor[]`, `:299`) so a repeated
    `fields=` request reuses the filtered accessor array instead of re-filtering per call.

  The keys of the last two are normalized by `NormalizeFieldsKey` (`:322-323`), which uppercases and
  sorts the field names so `"name,id"` and `"Id, Name"` share one entry rather than multiplying the
  cache by however many spellings callers happen to send. The hot-path `GetOrAdd` calls pass `static`
  lambdas and thread state through the overload's extra argument (`:26`, `:28`, `:156`, `:314`), so
  no closure is allocated per call.
- **Walkthrough** (members in teaching order)
  - `ShapeData<TEntity>(entity, fields)` (`:52-64`) and
    `ShapeCollectionData<TEntity>(entities, fields)` (`:73-94`): resolve accessors through
    `GetShapedAccessors` (`:54`, `:77`), then fill an `ExpandoObject` keyed by `CamelCaseName`
    (`:60`, `:87`). An empty field list means all properties (`GetShapedAccessors`, `:310-311`).
  - `ApplySorting<TEntity>` (`:112-135`): resolves the sort column, then emits
    `query.OrderBy(Filtering.DynamicQueryConfig.Parameterized, $"{sortExpr} {(descending ?
    "descending" : "ascending")}")` (`:130`), falling back to the optional `defaultSort` lambda when
    nothing valid was supplied (`:134`).
  - `ApplyFieldSelection<TEntity>` (`:146-162`): returns the query untouched for an empty field list
    (`:150-151`), otherwise pulls the compiled projection out of `ProjectionCache` (`:154-157`) and
    applies it as `query.Select(...)` (`:161`). `BuildProjection<TEntity>` (`:176-198`) is the
    builder: it keeps only **writable** properties that match the field set (`p.CanWrite`, `:181`),
    since EF cannot translate a `MemberInit` that assigns a read-only member, returns `null` when
    nothing survives (`:184-185`), and otherwise builds
    `new TEntity { Prop = e.Prop, ... }` (`:187-197`) so the projection is pushed into the SQL
    `SELECT`.
  - `Validate<TEntity>(fields, allowWriteableFields)` (`:209-248`): checks every requested field
    exists on the type, case-insensitively (`:221-222`), and, when `allowWriteableFields` is false,
    additionally rejects read-only properties (`:235-242`). It accumulates **all** offenders into a
    list of [`Error`](group-01-result-error-handling.md#error) built from `Error.InvalidEntityField`
    with a `with` expression, then returns one aggregate
    [`Result`](group-01-result-error-handling.md#result) (`:245-247`).
  - `ValidateSortDirection` (`:255-274`): accepts only `"asc"`, `"desc"`, or null/empty, and returns
    an `Error.Validation("Error.InvalidSortDirection", ...)` failure otherwise (`:266-273`).
  - Private helpers: `ParseFields` (`:276-280`) splits the comma list into a case-insensitive
    `HashSet`; `GetProperties<TEntity>` (`:282-285`) reads through `PropertiesCache`;
    `FilterAccessorsByFields` (`:287-293`) narrows an accessor array; `GetShapedAccessors`
    (`:305-316`) is the cached front door to it.
- **Why it's built this way**: the sort path is the security-relevant one. A sort column with no
  entry in `dtoToEntityPropertyMap` is accepted **only** when it names a real public property of the
  entity, resolved by reflection with `BindingFlags.IgnoreCase` (`:123-125`); anything else is null
  and falls through to `defaultSort` without ever reaching Dynamic LINQ. The doc comment (`:96-104`)
  spells out the three risks that guard closes: inferring hidden-column data through a nested path,
  forcing an unindexed sort, and turning a parse error into a 500. Server-authored map entries may
  still be navigation paths or expressions, client-supplied strings may not.
  `[Rubric §11, Security]` (assesses whether untrusted input can reach an expression evaluator) and
  `[Rubric §12, Performance & Scalability]`.
- **Where it's used**: `Validate` and `ValidateSortDirection` are called by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) before the database is
  touched (`EntityQueryService.cs:223-228`, `:285`, `:316`); `ShapeData` / `ShapeCollectionData` are
  called after mapping (`EntityQueryService.cs:266`, `:393`); `ApplySorting` and
  `ApplyFieldSelection` are called inside [`EntityQueryPipeline`](#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:89`,
  `:117`, `:132`, `:152`).
- **Caveats / not-in-source**: the class is `sealed` but every member is `static`, so it is never
  instantiated or injected; treat it as a static utility despite the shape. `ProjectionCache` and
  `ShapedAccessorCache` are keyed partly by a client-supplied field set, but the field names are
  validated against the entity's real properties before those paths run, so the key space is bounded
  by the entity's property count, not by what a caller can invent.

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
  `ConcurrentDictionary` (`:29-45`) seeds thirteen entries, one per supported CLR type including each
  nullable variant (string, bool/bool?, int/int?, long/long?, DateTime/DateTime?, decimal/decimal?,
  Guid/Guid?), and `RegisterStrategy(Type, IFilterStrategy)` (`:60-65`) lets a host add a type at
  startup without editing this file. `[Rubric §9, API & Contract Design]` (assesses validation at the
  right boundary): `ValidateFilters` runs the property, operator, and value checks *before* the query
  is built, so a bad filter becomes a precise validation failure rather than a LINQ Dynamic parse
  exception at execution time or, worse, a silently widened result set.
- **Walkthrough**
  - `PropertyCache` (`:27`): `ConcurrentDictionary<(Type EntityType, string PropertyName),
    PropertyInfo>`, so a reflected lookup is paid once per entity/property pair. Read the doc comment
    (`:21-26`) and `LookupProperty<TEntity>` (`:235-246`) together: **only successful lookups are
    memoized**. Caching misses too would let any caller grow a process-lifetime static dictionary
    without bound simply by filtering on names that do not exist, and because the request still gets
    a clean 400 the growth would be invisible in error metrics. A miss now costs one reflection
    lookup, bounded per request by `MaxFilters = 50` in
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder). This is an
    unbounded-memory-growth defense, `[Rubric §11, Security]` and `[Rubric §12, Performance &
    Scalability]`.
  - `StringStrategy` (`:52`): a dedicated [`StringFilterStrategy`](#stringfilterstrategy) instance
    held apart from the table, returned by `ResolveStrategy` for string properties and for any path
    whose leaf type could not be resolved.
  - `ApplyFilters<TEntity>` (`:76-101`): for each `(property, (op, value))` it translates the DTO name
    through `dtoToEntityPropertyMap` (`:84-86`), resolves the `PropertyInfo` through
    `ResolvePropertyInfo` (`:88`) and **silently skips** an unresolvable property (`:90-91`),
    uppercases the operator once (`:93`, the caller-side half of the
    [`IFilterStrategy`](#ifilterstrategy) contract), then resolves the strategy from the *value type*
    (`ResolveStrategy(ResolveFilterValueType<TEntity>(...))`, `:95`) and applies it (`:97`).
  - `ValidateFilters<TEntity>` (`:111-126`): returns success for a null/empty filter map (`:115-116`),
    otherwise runs `ValidateSingleFilter` per entry and collects **all** errors into one
    [`Result`](group-01-result-error-handling.md#result) (`:123-125`), so a client sees every problem
    at once rather than one per round trip.
  - `ValidateSingleFilter<TEntity>` (`:128-174`) produces four distinct error codes:
    `Filter.Property.NotFound` when reflection cannot resolve the property (`:143-148`),
    `Filter.Type.NotSupported` when no strategy is registered for the resolved value type
    (`:163-168`), then delegates to `ValidateOperatorSupported` (`:285-301`) for
    `Filter.Operator.NotSupported` (`:295-300`) and `ValidateValueParseable` (`:181-202`) for
    `Filter.Value.Invalid` (`:196-201`).
  - `ValidateValueParseable` (`:181-202`) is the guard behind rule 3 of the family preamble. Its doc
    comment (`:176-179`) states the bug it closes: without it the strategy returns the query
    unfiltered, so a malformed value **widened** the response to the full result set instead of
    narrowing it to no matches. It deliberately stays silent when the operator itself is already
    invalid (`:191-192`), so one bad filter does not produce two errors describing the same mistake.
  - `ResolvePropertyInfo` (`:223-230`): probes the DTO-facing name first, then the mapped entity name
    (its root segment for a dotted path). The doc comment (`:204-221`) records why both paths share
    it: application and validation used to disagree on the fallback order, so a plain rename entry
    such as `["Name"] = "Title"` passed validation and was then **silently dropped**, returning an
    unfiltered result set with a 200.
  - `ResolveFilterValueType<TEntity>` (`:259-278`): for a flat property this is the property's own
    type (`:261-262`); for a dotted path it walks each segment to the **leaf's** type (`:264-277`),
    starting from the path's own root rather than from the already-resolved property (`:266-268`,
    because for a nested path the DTO-facing name and the path root need not agree). It returns
    `null` when a segment cannot be walked, and the remarks (`:253-258`) explain the fallback: callers
    then use the string strategy, which is what every dotted path used to get unconditionally, so an
    unresolvable path keeps working exactly as before rather than newly failing validation. The
    comment in `ValidateSingleFilter` (`:153-157`) states the bug this fixed: routing every dotted
    path to the string strategy let a nested non-string leaf pass validation for a string-only
    operator (say `IS EMPTY` on `"Category.Id"`) and then fail inside Dynamic LINQ at query-build
    time, a 500 for what is really a bad request.
  - `ResolveStrategy` (`:280-283`): `null` or `typeof(string)` maps to `StringStrategy`, everything
    else is a `GetValueOrDefault` on the table.
- **Why it's built this way**: validating up front converts would-be runtime exceptions and silently
  widened responses into precise validation errors at the API boundary, and the property cache
  amortises resolution to first use per process while refusing to memoize client-controlled misses.
- **Where it's used**: `ValidateFilters` is called from
  [`EntityQueryService.GetAllAsync`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`EntityQueryService.cs:227`); `ApplyFilters` is called inside
  [`EntityQueryPipeline`](#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:60`) before
  materialization. The filter map itself is produced at the API edge by
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Caveats / not-in-source**: this is a **static class**, not a DI-resolved service, so
  `RegisterStrategy` mutates process-global state and is only safe at startup. Nullable variants are
  registered as separate instances rather than a shared one (`:32-44`), which costs a few extra
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
  list path, the wide `GetAllAsync` overload (`:209-275`), is four steps:
  1. **Validate before touching the database** (`:223-228`): `Result.Combine` of
     [`QueryFieldService.Validate`](#queryfieldservice) for `fields`
     (`allowWriteableFields: false`, so read-only fields are rejected) and for `sortColumn`
     (`allowWriteableFields: true`, since a computed column may still be sortable),
     `ValidateSortDirection`, and
     [`QueryFilterService.ValidateFilters`](#queryfilterservice). On failure every
     [`Error`](group-01-result-error-handling.md#error) is re-stamped with
     `Source = nameof(GetAllAsync)` and `Target = typeof(TEntity).Name` via a `with` expression
     (`:231-237`), so the caller sees which operation and which entity produced each problem.
  2. **Build and execute** through `BuildQueryAsync` (`:406-445`): pick `Repository.Table` when
     tracking is requested or `TableNoTracking` otherwise (`:419-421`), ask
     [`NavigationMetadataProvider.BuildIncludes`](#navigationmetadataprovider) which navigations EF
     can `Include` (`:423`), pack everything (including `specification?.Criteria`, `:427`) into an
     [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`:425-437`), and hand off to
     [`IEntityQueryPipeline.ExecuteAsync`](#ientityquerypipeline) passing
     `NavigationPopulator.PopulateAsync` as the callback (`:439-444`) so cross-source navigations EF
     cannot join are batch-loaded after materialization ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
  3. **Map, then shape only when asked** (`:262-266`): the entities go through the injected
     [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype),
     and the result is cast to `object` as-is unless a `fields` subset was requested, in which case
     [`QueryFieldService.ShapeCollectionData`](#queryfieldservice) produces `ExpandoObject`s. The
     comment (`:256-259`) explains the rule: typed DTOs already serialize to the same camelCase JSON,
     so paying the per-row `ExpandoObject` allocation and boxing only makes sense when it actually
     removes fields.
  4. **Wrap** in a `PagedCollectionResult<object>` (`:268-272`) with
     [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) from
     `BuildPaginationMetadata` (`:447-468`); when no page was requested, page size equals the total
     count and the current page is 1 (`:449-457`).
- **Walkthrough, the other read paths**
  - **The by-id fast path** (`TryGetByIdFastPathAsync`, `:80-100`). For a plain primary-key lookup it
    issues a single keyed read through `Repository.GetByIdAsync(typedId, includes, asTracking, ...)`
    (`:96`) and skips the dynamic-filter pipeline entirely. The doc comment (`:70-79`) states why
    this exists: the pipeline would parse a string predicate and emit a `TOP 1000` plus a
    client-side `FirstOrDefault`, and it notes that the repository overload runs on the filtered
    `TableNoTracking`, so soft-delete query filters still apply (unlike EF's `FindAsync`, which
    bypasses them). A miss returns `Error.NotFound` stamped with `WithSource`/`WithTarget`
    (`:97-99`).
  - **What qualifies for it** (`TryGetFastPathIncludes`, `:122-152`). Field projection, a
    [`Specification`](#specificationtentity-tidentifiertype), or a non-default `idField` disqualify
    (`:132-137`). Requested **includes do not**: the remarks (`:106-120`) record that disqualifying
    on includes left the fast path unreachable for every entity declaring a navigation, because the
    REST by-id action defaults `includeFKs` to true, so those reads fell back to the pipeline. The
    repository's include overload applies the same `Include` calls and auto-applies `AsSplitQuery`
    for child collections, so the two agree. **Unsupported** includes still disqualify (`:145-148`),
    because those are cross-source navigations only the pipeline's
    [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) can
    batch-load. Otherwise the supported navigation names are handed back (`:150`).
  - `TryConvertId` (`:159-185`) converts the string id via a `TypeConverter` cached per identifier
    type in `IdConverterCache` (`:68`), catching only `FormatException`, `NotSupportedException`, and
    `ArgumentException` (`:179`) and returning `false` so a malformed id falls back to the pipeline
    rather than failing. The whole fast path is a targeted `[Rubric §12, Performance & Scalability]`
    optimization on the single hottest read shape in the system.
  - `GetEntityByIdAsync` (`:306-364`): validates `fields`, tries the fast path (`:332-336`), and
    otherwise reuses the list pipeline through a synthetic `Id EQUALS` filter built with an
    `OrdinalIgnoreCase` comparer (`:338-341`), returning
    `Error.NotFound.WithSource(nameof(GetByIdAsync)).WithTarget(...)` when nothing came back
    (`:357-361`).
  - `GetByIdAsync` (`:367-394`): stringifies the typed id (throwing `InvalidOperationException` if
    `ToString()` returns null, `:376`), delegates to `GetEntityByIdAsync`, maps the single entity, and
    applies the same shape-only-when-asked rule as the list path (`:391-393`).
  - `GetAllForLookupAsync` (`:278-303`): validates one `nameProperty` with
    `allowWriteableFields: true` (`:285`), then delegates to the repository's lookup query, returning
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
    id/name pairs for dropdowns (`:299-302`). Note that the `where` and `orderBy` parameters it
    accepts (`:280-281`) are not forwarded to the repository call.
  - `ExistsAsync` (`:397-401`): a thin non-virtual pass-through to
    `Repository.ExistsAsync(where, ignoreQueryFilters, ...)`.
  - **Extensibility points**: `Repository` (`:48`) and `DTOToEntityPropertyMap` (`:61`) are
    `virtual`, as are all the read methods, and the class is deliberately **not** `sealed`, so a
    module subclass can override one behavior (a scoped repository, a
    `"CategoryName" -> "Category.Name"` mapping) without reimplementing the pipeline. `UnitOfWork` is
    `protected` (`:43`) for subclasses that need a custom query.
- **Why it's built this way**: centralizing read mechanics means every entity gets identical
  filter/sort/page/projection semantics for free, and validate-before-database turns a bad `fields`
  or operator into a validation failure rather than a SQL or expression-parser error. The
  [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) callback
  is the database-per-service escape hatch ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) and [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): EF cannot join across physical
  sources, so those navigations are filled by a second batch query against the page that was actually
  returned.
- **Where it's used**: injected as the query service of the read controllers
  ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype))
  in both apps, and subclassed per module wherever a default must change.
- **Caveats / not-in-source**: this class does not clamp the page size it *applies* (the clamp lives
  in [`EntityQueryPipeline`](#entityquerypipeline)'s `ApplyPaging`), but it does clamp the page size
  it *reports*: `BuildPaginationMetadata` returns
  `Math.Min(pageSize.Value, EntityQueryPipeline.MaxUnboundedResultLimit)` (`:465`, ceiling of 1000 at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:23`) because
  an over-large request previously advertised a page size the response never contained (`:462-464`).
  Error stamping in the by-id path always uses `Source = nameof(GetByIdAsync)` (`:322`, `:359`) even
  when `GetEntityByIdAsync` is called directly, a cosmetic label, not a behavior difference.

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
- **Walkthrough**: ten `init`-only properties, all optional (nullable or defaulted):
  - `Expression<Func<TEntity, bool>>? Criteria` (`EntityQueryParameters.cs:14`), the specification
    predicate (e.g. an authorization filter) applied server-side before materialization.
  - `Dictionary<string, (string Operator, string Value)>? Filters` (`EntityQueryParameters.cs:17`), the
    dynamic user-supplied filter map (property name to operator/value pair) that
    [`QueryFilterService`](#queryfilterservice) turns into `Where` clauses.
  - `string? SortColumn` / `string? SortDirection` (`EntityQueryParameters.cs:20`,
    `EntityQueryParameters.cs:23`), the sort column and `"asc"`/`"desc"` direction consumed by
    [`QueryFieldService`](#queryfieldservice)`.ApplySorting`.
  - `string? Fields` (`EntityQueryParameters.cs:26`), the comma-separated sparse-fieldset projection
    list.
  - `int? PageNumber` / `int? PageSize` (`EntityQueryParameters.cs:29`, `EntityQueryParameters.cs:32`),
    1-based pagination; both must be present for the pipeline to treat the query as paginated.
  - `bool IncludeFKs` / `bool IncludeChildren` (`EntityQueryParameters.cs:35`,
    `EntityQueryParameters.cs:38`), whether FK reference navigations and/or child-collection navigations
    were requested.
  - `IReadOnlyDictionary<string, string> DTOToEntityPropertyMap` (`EntityQueryParameters.cs:44`), maps
    DTO property names to entity property paths (e.g. `"CategoryName"` to `"Category.Name"`) so
    filtering and sorting can use DTO-facing names even when they differ from the entity's own
    properties; it defaults to `FrozenDictionary<string, string>.Empty` so callers that do not need
    remapping can omit it.
- **Why it's built this way**: threading one immutable value through a multi-stage pipeline keeps each
  stage's signature stable and its inputs unambiguous, and the frozen-empty default keeps the common
  no-remapping case allocation-light (the generic read layer's rationale is [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
- **Where it's used**: constructed by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (this group, p01) from the controller's query arguments
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:425`), then handed to
  [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline)
  (`EntityQueryService.cs:439`).

### PagingMath
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:20` · Level 0 · class (static)

- **What it is**: the one place a page number and page size are turned into a `Skip`/`Take` pair. A
  single static `Clamp` method that floors the page size, floors the page number, computes the offset in
  64-bit, and refuses to hand back an offset that cannot fit in an `int`.
- **Depends on**: nothing. It is pure BCL arithmetic (`Math.Clamp`, `Math.Max`), with no first-party
  type in its signature, which is why it can be shared by the pipeline and by hand-written handlers
  alike.
- **Concept introduced, arithmetic overflow as a production bug class.** `[Rubric §12, Performance &
  Scalability]` assesses whether reads are bounded and paginate correctly at the edges of their input
  range; `[Rubric §16, Maintainability]` assesses whether a subtle rule is expressed once rather than
  re-derived per call site. Both apply literally here. The naive expression `(pageNumber - 1) * pageSize`
  is a 32-bit multiply: for page numbers near `int.MaxValue` it overflows and wraps **negative**, and a
  negative `Skip` is not a benign no-op, because SQL Server rejects a negative `OFFSET` outright, so the
  request surfaces as a 500 instead of the empty page that page genuinely holds. The type's remarks
  (`PagingMath.cs:6-19`) record that this logic previously lived only inside
  [`EntityQueryPipeline`](#entityquerypipeline), so handlers paginating their own queryable (the
  notification inbox and history reads) each re-derived it in 32-bit and kept the overflow. The rule the
  doc states: callers route through here rather than open-coding the multiply.
- **Walkthrough**: one method, `(int Skip, int Take) Clamp(int pageNumber, int pageSize, int
  maxPageSize)` (`PagingMath.cs:32`):
  - `var take = Math.Clamp(pageSize, 1, Math.Max(maxPageSize, 1));` (`PagingMath.cs:37`), the page size
    is clamped into `[1, maxPageSize]`, so a zero or negative size cannot become `Take(0)` or a negative
    `Take`, and the inner `Math.Max` keeps the clamp range valid even if a caller passes a zero ceiling.
  - `var page = Math.Max(pageNumber, 1);` (`PagingMath.cs:38`), a zero or negative page number is
    treated as page 1 rather than becoming a negative `Skip`. The comment above both lines
    (`PagingMath.cs:34-36`) explains why neither can be assumed away: these values arrive from callers
    outside the API boundary's `[Range]` attributes.
  - `long skip = (long)take * (page - 1);` (`PagingMath.cs:40`), the offset is computed in 64-bit, so the
    multiply itself cannot wrap.
  - `return skip > int.MaxValue ? (0, 0) : ((int)skip, take);` (`PagingMath.cs:42`), a page beyond the
    reachable offset range yields `(0, 0)`, which materializes the empty page that page actually holds
    instead of throwing or erroring.
- **Why it's built this way**: a static, dependency-free helper is the cheapest way to make a shared
  invariant unavoidable; both the framework pipeline and the two hand-written paginating handlers now
  call the same six lines, so the overflow cannot be reintroduced in one of them.
- **Where it's used**: [`EntityQueryPipeline`](#entityquerypipeline)'s private `ApplyPaging`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:176-179`,
  passing `MaxUnboundedResultLimit` as the ceiling), and the two notification read handlers that
  paginate their own joined queryable,
  [`GetMyNotificationsHandler`](group-10-notifications.md#getmynotificationshandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:32`,
  ceiling 500 at `GetMyNotificationsHandler.cs:21`) and
  [`GetNotificationHistoryHandler`](group-10-notifications.md#getnotificationhistoryhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:30`).
  Covered directly by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/Query/PagingMathTests.cs:12`,
  including the far-page case (`PagingMathTests.cs:81`), which is the `[Rubric §14, Testability]` payoff
  of extracting the arithmetic into a pure function.

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
  ParameterExpression to)` (`CrossSourceSpecification.cs:93`) with a single override:
  - `VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node)`
    (`CrossSourceSpecification.cs:95-96`), when the visitor reaches the `from` parameter it returns `to`
    instead; every other node is left untouched by delegating to the base visitor.
- **Why it's built this way**: rebinding at the expression-tree level (rather than via
  `Expression.Invoke`) keeps the resulting composite predicate translatable on every provider, which is
  the whole point of [`CrossSourceSpecification`](#crosssourcespecification); a one-method visitor is the
  minimal, standard way to do the swap.
- **Where it's used**: only inside `CrossSourceSpecification.BuildCriteria`
  (`CrossSourceSpecification.cs:85-86`), to rebind an optional local predicate onto the foreign-key
  selector's parameter before ANDing the two bodies together.

### ISpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12` · Level 1 · interface

- **What it is**: the Specification pattern interface: an encapsulated, reusable predicate that exposes
  *both* an EF-translatable expression tree (`Criteria`) and an in-memory evaluation path
  (`IsSatisfiedBy`).
- **Depends on**: [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint, `ISpecification.cs:13`); `System.Linq.Expressions` (BCL).
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
  `where TIdentifierType : notnull` (`ISpecification.cs:13-14`):
  - `Expression<Func<TEntity, bool>> Criteria { get; }` (`ISpecification.cs:17`), the expression tree EF
    Core translates to SQL via LINQ-to-DB. It is an *expression*, not a compiled `Func`, precisely so EF
    can inspect and translate it.
  - `bool IsSatisfiedBy(TEntity entity)` (`ISpecification.cs:22`), the compiled in-memory predicate, for
    unit-testing business rules or evaluating a rule against an already-materialized entity without a
    database.
  Both members on the same type is the key insight: one specification works equally against EF and
  in-memory collections, eliminating duplicate filter logic. `[Rubric §14, Testability]` (business
  rules become testable without infrastructure).
- **Where it's used**: implemented by the abstract base
  [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (next section),
  which is what the composites and every module-specific specification derive from (e.g. ADC's
  [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification));
  taken directly as the constructor parameter type of the combinators
  ([`AndSpecification`](#andspecificationtentity-tidentifiertype),
  [`OrSpecification`](#orspecificationtentity-tidentifiertype),
  [`NotSpecification`](#notspecificationtentity-tidentifiertype)).

### Specification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15` · Level 2 · class (abstract)

- **What it is**: the abstract base for the Specification pattern: subclasses supply an
  `Expression<Func<TEntity, bool>>` (`Criteria`, usable in EF `Where` clauses) and inherit an in-memory
  `IsSatisfiedBy` shortcut backed by a lazy-compiled, cached delegate.
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the contract it implements, `Specification.cs:16`),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint, `Specification.cs:17`); `System.Linq.Expressions` (BCL).
- **Concept reinforced, the Specification pattern with expression trees.** `[Rubric §2, Design
  Patterns]` assesses whether a pattern solves a real problem rather than being pattern theater; here
  specifications solve authorization scoping and reusable query predicates without leaking logic into
  repositories. `[Rubric §4, DDD]` (domain logic as reusable, composable predicates rather than
  scattered `if`s). The pattern is dual-purpose: because `Criteria` is an expression tree (not a
  compiled delegate), EF Core can translate it to SQL, so `Where(spec.Criteria)` becomes a `WHERE` clause
  in the database; for in-memory use, `IsSatisfiedBy` compiles the same expression once and caches the
  result. One object, two evaluation modes, zero duplicate logic.
- **Walkthrough**
  - `protected Specification() { }` (`Specification.cs:20`), a do-nothing protected constructor so only
    subclasses (and the composites below) can construct one.
  - `public abstract Expression<Func<TEntity, bool>> Criteria { get; }` (`Specification.cs:23`),
    subclasses provide the expression tree; this is the single piece of state a concrete specification
    must define.
  - `private Func<TEntity, bool>? _compiled` (`Specification.cs:27`), the lazily-compiled delegate,
    cached to avoid recompiling the expression tree on every `IsSatisfiedBy` call (expression compilation
    is expensive).
  - `public virtual bool IsSatisfiedBy(TEntity entity)` (`Specification.cs:30`): `_compiled ??=
    Criteria.Compile();` then `return _compiled(entity);` (`Specification.cs:32-33`). First call
    compiles; subsequent calls reuse the delegate. It is `virtual`, so a subclass could override it,
    though none in the workspace does.
- **Why it's built this way**: placing `Specification` in `MMCA.Common.Domain` (not Infrastructure)
  keeps query business rules in the domain layer, where they are testable without an EF context or a
  database, and the domain stays free of any EF reference (the expression tree is plain BCL). Note the
  caching is per instance and the composites below recompute `Criteria` on every `get`, so the compiled
  delegate only pays off for a specification instance that is reused.
- **Where it's used**: base class for the composites
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) /
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) /
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) /
  [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) (next sections) and every
  module-specific access-control specification; it is also the declared type of the optional
  `specification` argument on every read method of
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:40`), so
  authorization scoping enters the read pipeline through this type and not through `ISpecification`.

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
  (the two constructor parameters, `Specification.cs:63-64`),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept reinforced, expression-tree composition for EF translatability.** `[Rubric §8, Data
  Architecture]` assesses whether query predicates reach the database rather than filtering in-memory
  after a full load. The mechanism is `Expression.Invoke`: the combinator creates **one** shared
  `ParameterExpression` named `"entity"`, then embeds each child spec's existing `Criteria` tree as a
  sub-expression via `Expression.Invoke(spec.Criteria, parameter)`. Composing at the *expression-tree*
  level (not by combining compiled `Func`s) is what keeps the composite translatable: a compiled
  delegate cannot be turned into SQL, but `Expression.AndAlso(invoke1, invoke2)` can. Most EF providers
  accept `Invoke` in composed expressions; where a provider does not,
  [`CrossSourceSpecification`](#crosssourcespecification) shows the `Invoke`-free alternative (rebind the
  parameter with [`ParameterReplacer`](#parameterreplacer), then AND the raw bodies).
- **Walkthrough**: a sealed primary-constructor subclass taking two `ISpecification`s
  (`Specification.cs:62-64`); the `Criteria` getter (`Specification.cs:70-80`) builds a fresh tree each
  call:
  1. `var parameter = Expression.Parameter(typeof(TEntity), "entity");` (`Specification.cs:74`), the
     single shared lambda parameter.
  2. `var body = Expression.AndAlso(Expression.Invoke(spec1.Criteria, parameter),
     Expression.Invoke(spec2.Criteria, parameter));` (`Specification.cs:75-77`), combines the two invoked
     child trees with a short-circuiting logical AND.
  3. `return Expression.Lambda<Func<TEntity, bool>>(body, parameter);` (`Specification.cs:78`), re-wrap
     as a strongly-typed predicate lambda.
  Note `Criteria` is a computed property here (a fresh tree on each `get`), not a cached field:
  composites are cheap and usually constructed per query.
- **Why it's built this way**: combinators let query callers compose access rules
  (`new AndSpecification(ownerSpec, activeSpec)`) without the query service knowing the predicate
  internals, and the expression-tree approach preserves database translation throughout the composition.
  Keeping it `sealed` signals it is a leaf implementation, not meant for further subclassing.
- **Where it's used**: ADC's [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller)
  ANDs the public-session filter with the speaker-scoped filter when a `SpeakerId` filter is present
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:117`),
  passing the composite as the `specification` argument to the query service. Combinator behavior is
  pinned by `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:53`
  and the nested-composition cases in `SpecificationAdditionalTests.cs:125-127`.

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
  ([`AndSpecification`](#andspecificationtentity-tidentifiertype) and siblings) build *new* trees from
  existing specs; `InlineSpecification` instead adopts a tree someone else built. This is the small
  extension point that lets a dynamic, runtime-assembled predicate participate in the same
  `Where(spec.Criteria)` / `IsSatisfiedBy` machinery every other specification uses.
- **Walkthrough**: a one-member sealed class with a primary constructor (`Specification.cs:45-53`):
  - `InlineSpecification(Expression<Func<TEntity, bool>> criteria)` (`Specification.cs:45`), the
    primary-constructor parameter is the pre-built criteria. Its doc comment (`Specification.cs:44`)
    states the caller's obligation: the expression must be EF-translatable to be usable in a DB query.
  - `public override Expression<Func<TEntity, bool>> Criteria { get; } = criteria ?? throw new ArgumentNullException(nameof(criteria));`
    (`Specification.cs:51-52`), the inherited abstract `Criteria` is satisfied by a get-only
    auto-property initialized once (and null-guarded) from the constructor argument; `IsSatisfiedBy` is
    inherited unchanged from the base, so the lazy-compiled in-memory path works too.
- **Why it's built this way**: without it, every helper that assembles a predicate at runtime would have
  to emit a bespoke `Specification` subclass per call site; a single sealed wrapper keeps that machinery
  to one type. It lives in `MMCA.Common.Domain` alongside the base and composites so the whole
  Specification family stays in the domain layer, while the Application layer builds on top of it
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s polyglot model is what makes that composition necessary).
- **Where it's used**: returned by
  [`CrossSourceSpecification.BuildAsync`](#crosssourcespecification) to wrap the
  `localPredicate AND principalKeys.Contains(fk)` expression it assembles
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:62-63`);
  and directly by ADC's cross-module filter handlers, which resolve ids over gRPC and wrap the resulting
  `ids.Contains(x.Id)` predicate:
  [`GetSessionsBySpeakerFilterHandler`](group-18-conference-application.md#getsessionsbyspeakerfilterhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:43`)
  and [`GetSpeakersByEventFilterHandler`](group-18-conference-application.md#getspeakersbyeventfilterhandler)
  (`.../Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:53`).

### NotSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:114` · Level 3 · class (sealed)

- **What it is**: the negating composite combinator: it wraps a single specification and satisfies its
  `Criteria` when the child does *not*. Same shape as
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the
  expression-tree mechanism); it just takes one child instead of two.
- **Depends on**: same as `AndSpecification`, but its constructor takes a single
  [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (`Specification.cs:115`).
- **Walkthrough**: the `Criteria` getter (`Specification.cs:121-131`) builds
  `Expression.Not(Expression.Invoke(spec.Criteria, parameter))` (`Specification.cs:126-127`) over the
  shared `"entity"` parameter, then wraps it as a lambda (`Specification.cs:128`). `sealed`.
- **Where it's used**: "exclude this set" predicates, composed with the other combinators and passed as
  the `specification` argument to the query service. No production call site in the workspace today; it
  is exercised by `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:102`
  and, nested inside an `OrSpecification`, at `SpecificationTests.cs:126-127`.

### OrSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:88` · Level 3 · class (sealed)

- **What it is**: the disjunctive composite combinator: it ORs two specifications so its `Criteria` is
  satisfied when either child is. Structurally identical to
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the
  expression-tree mechanism); it differs by one node.
- **Depends on**: identical to `AndSpecification` (`Specification.cs:88-93`).
- **Walkthrough**: the `Criteria` getter (`Specification.cs:96-107`) is the And getter with
  `Expression.OrElse` (`Specification.cs:101`) in place of `Expression.AndAlso`, a short-circuiting
  logical OR over the two invoked child trees. `sealed`.
- **Where it's used**: "admin or owner" access patterns where either condition grants access, composed
  with the other combinators and passed as the `specification` argument to the query service. No
  production call site in the workspace today; it is exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:78` and by the
  allocation benchmark that composes And over Or
  (`MMCA.Common/Tests/Performance/MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:48-50`).

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
- **Concept introduced, the read pipeline behind one method.** `[Rubric §5, Vertical Slice]`
  assesses whether a capability lives behind one focused abstraction rather than smeared across
  callers; every read endpoint's list logic funnels through this one method. The single method's return
  type, `Task<(IReadOnlyCollection<TEntity> Items, int TotalCount)>` (`IEntityQueryPipeline.cs:23`),
  returns both the page and the count needed to build pagination metadata in one call.
- **Walkthrough**: one generic method, `ExecuteAsync<TEntity, TIdentifierType>`
  (`IEntityQueryPipeline.cs:23-30`), constrained `where TEntity : AuditableBaseEntity<TIdentifierType>`
  and `where TIdentifierType : notnull` (`IEntityQueryPipeline.cs:29-30`):
  - `IQueryable<TEntity> baseQuery` (`IEntityQueryPipeline.cs:24`), the untracked or tracked starting
    queryable from the repository.
  - `NavigationMetadata navigationMetadata` (`IEntityQueryPipeline.cs:25`), the supported/unsupported
    include classification.
  - `EntityQueryParameters<TEntity> parameters` (`IEntityQueryPipeline.cs:26`), all the query inputs.
  - `Func<IReadOnlyCollection<TEntity>, NavigationMetadata, bool, bool, CancellationToken, Task>
    navigationPopulator` (`IEntityQueryPipeline.cs:27`), a callback the pipeline invokes to manually load
    *unsupported* navigations (the two `bool`s are `includeFKs`/`includeChildren`). Passing this as a
    delegate keeps the pipeline in the Application layer while the actual populator lives in
    Infrastructure ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), G11).
- **Why it's built this way**: abstracting the pipeline behind an interface lets the query service
  depend on the behavior, not the concrete steps, and lets the navigation-population strategy be injected
  as a delegate rather than a hard dependency (Clean Architecture, `[Rubric §3]`).
- **Where it's used**: implemented by [`EntityQueryPipeline`](#entityquerypipeline); injected into and
  called by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (this group, p01; `MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:34`,
  `EntityQueryService.cs:439`).

### INavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9` · Level 4 · interface

- **What it is**: the contract that inspects an entity type and classifies each of its navigation
  properties as **supported** (loadable via EF Core `.Include()`) or **unsupported** (needs manual
  loading), based on whether the two entities share a JOIN-capable data source.
- **Depends on**: [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (the
  return type); no other first-party dependency in the interface.
- **Concept introduced, include-capability classification.** `[Rubric §8, Data Architecture]` assesses
  whether the persistence strategy adapts to the physical store; in a database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) or
  polyglot ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) setup, two related entities may live in *different* stores, so an `.Include()` that
  generates a SQL JOIN cannot span them. This provider is where that "can EF JOIN these two?" decision is
  made, up front, before the pipeline runs.
- **Walkthrough**: one method, `NavigationMetadata BuildIncludes<TEntity>(bool includeFKs, bool
  includeChildren)` (`INavigationMetadataProvider.cs:19`), building the classification for the requested
  navigation kinds (FK references and/or child collections) on `TEntity`. There is no `CancellationToken`
  and no `Task`: the work is pure reflection plus a configuration lookup, so it is synchronous.
- **Where it's used**: implemented by [`NavigationMetadataProvider`](#navigationmetadataprovider);
  called by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:144`,
  `EntityQueryService.cs:423`) to produce the
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) it then feeds to
  [`IEntityQueryPipeline`](#ientityquerypipeline).

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
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) with its
  [`NavigationType`](group-11-navigation-populators.md#navigationtype) enum, the p01 helpers
  [`QueryFilterService`](#queryfilterservice) / [`QueryFieldService`](#queryfieldservice), the shared
  [`PagingMath`](#pagingmath), and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint).
- **Concept introduced, the two-path include strategy and the unbounded-result ceiling.** `[Rubric §8,
  Data Architecture]` (the pipeline adapts to the store's JOIN capability) and `[Rubric §12, Performance
  & Scalability]` (results are always bounded, and filtering is pushed server-side before
  materialization) both apply directly. The ceiling is codified as `public const int
  MaxUnboundedResultLimit = 1000;` (`EntityQueryPipeline.cs:23`): a defense-in-depth cap so that even an
  Application-layer caller that bypasses the API's page-size clamp cannot trigger an unbounded full-table
  load (the doc comment at `EntityQueryPipeline.cs:15-22` spells out that layering).
- **Walkthrough**: constructed with an `IQueryableExecutor` (`EntityQueryPipeline.cs:13`); the single
  public method `ExecuteAsync` (`EntityQueryPipeline.cs:26-69`) orchestrates:
  1. **PATH 1 includes** (`EntityQueryPipeline.cs:40-51`): for each supported include, call
     `queryableExecutor.Include(...)` (`EntityQueryPipeline.cs:43`); if any supported include is a
     `ChildCollection`, switch to `AsSplitQuery` (`EntityQueryPipeline.cs:49-50`). The inline comment
     (`EntityQueryPipeline.cs:45-48`) documents *why*: paginating a single-query collection-`Include`
     truncates child rows because EF applies `Skip`/`Take` to the JOIN-expanded set, so list reads come
     back with empty collections while by-id reads (no `Skip`) work; a split query loads each collection
     in its own statement (the R24/§8 fix).
  2. **Server-side filtering before materialization** (`EntityQueryPipeline.cs:56-60`): apply
     `parameters.Criteria` via `Where` (`EntityQueryPipeline.cs:57`), then the dynamic filters via
     `QueryFilterService.ApplyFilters` (`EntityQueryPipeline.cs:60`), so the store does as much filtering
     as possible.
  3. **Path selection** (`EntityQueryPipeline.cs:65-68`): if there are any *unsupported* includes,
     delegate to `ExecuteWithManualNavigationAsync`; otherwise to `ExecuteWithServerSideIncludesAsync`.
  - `ExecuteWithManualNavigationAsync` (`EntityQueryPipeline.cs:76-119`): sort at the DB level
    (`EntityQueryPipeline.cs:89`), keep a handle on the unpaged query (`EntityQueryPipeline.cs:91`), then
    if paginated take the total count before paging and call `ApplyPaging`
    (`EntityQueryPipeline.cs:95-96`); if not paginated, cap with `.Take(MaxUnboundedResultLimit)`
    (`EntityQueryPipeline.cs:102`). Materialize, run the `navigationPopulator` callback on the paged
    subset only when it is non-empty (`EntityQueryPipeline.cs:106-109`), settle the unpaginated total via
    `CountUnpaginatedAsync` (`EntityQueryPipeline.cs:113`), and finally apply field selection in memory
    over the materialized page (`EntityQueryPipeline.cs:116-118`).
  - `ExecuteWithServerSideIncludesAsync` (`EntityQueryPipeline.cs:125-161`): the same sort /
    count-before-paging / cap shape (`EntityQueryPipeline.cs:132-149`) but applies
    `QueryFieldService.ApplyFieldSelection` on the `IQueryable` directly
    (`EntityQueryPipeline.cs:152`) so the projection reaches the database as a `MemberInit`.
  - `ApplyPaging` (`EntityQueryPipeline.cs:172-182`), the shared paging step: it delegates the offset
    arithmetic to [`PagingMath.Clamp`](#pagingmath) with `MaxUnboundedResultLimit` as the ceiling
    (`EntityQueryPipeline.cs:176-179`) and returns `query.Skip(skip).Take(take)`
    (`EntityQueryPipeline.cs:181`). The page size is therefore clamped to the ceiling here as well as at
    the API boundary, defense in depth.
  - `CountUnpaginatedAsync` (`EntityQueryPipeline.cs:189-195`) fixes a subtle reporting bug: for an
    unpaginated read the materialized count is only the truth while it stays *under* the ceiling; at the
    ceiling it is the cap itself, so the method issues a real `CountAsync` against the unpaged query
    instead of reporting exactly 1000 rows (`EntityQueryPipeline.cs:193-195`).
- **Why it's built this way**: pushing filters and projection to the store, forcing split-query for
  paginated child collections, capping every path, and reporting an honest total keeps reads correct and
  bounded regardless of engine; injecting `IQueryableExecutor` keeps EF out of the Application layer
  (Clean Architecture), and routing the offset math through `PagingMath` keeps the overflow guard shared
  with the hand-written paginating handlers. [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html) records the generic read layer's trade-offs.
- **Where it's used**: the sole implementation behind
  [`IEntityQueryPipeline`](#ientityquerypipeline); driven by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype).

### IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19` · Level 5 · interface (generic)

- **What it is**: the central read-query contract of the framework: generic operations for
  `GetAllAsync` (with filter/sort/pagination/projection), `GetAllForLookupAsync`, `GetEntityByIdAsync`,
  `GetByIdAsync`, and `ExistsAsync` over any entity/DTO pair. It is the read half of the application's
  CQRS split (the write half flows through command handlers).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IEntityQueryService.cs:20`),
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (the `TEntityDTO` constraint, `IEntityQueryService.cs:21`),
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  (the `DTOMapper` property), [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (optional scoping argument), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`Result`](group-01-result-error-handling.md#result),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype);
  `System.Linq.Expressions` (BCL).
- **Concept introduced, the entity query service contract.** `[Rubric §5, Vertical Slice]` assesses
  whether a feature's read logic is encapsulated in one place; here the API controller delegates to this
  service and never touches `IQueryable` directly. `[Rubric §12, Performance & Scalability]` assesses
  whether result sets are bounded; explicit `pageNumber`/`pageSize` parameters and a `fields` projection
  prevent returning unbounded rows or over-fetching columns. `[Rubric §9, API & Contract Design]`
  assesses whether one contract can serve varied response shapes without proliferating types, and the
  most distinctive design choice here answers exactly that: the read methods return
  `Result<...<object>>`. The interface doc (`IEntityQueryService.cs:9-15`) explains it: when **no**
  `fields` subset is requested the typed `TEntityDTO`s are returned as-is (no per-row shaping cost); when
  an explicit `fields` list is supplied, dynamically shaped objects carrying only the requested fields
  are returned. Both serialize to the same camelCase JSON, so one contract serves full-detail and
  sparse-field responses alike, without one DTO per projection.
- **Walkthrough**: constraints `where TEntity : AuditableBaseEntity<TIdentifierType>`,
  `where TEntityDTO : IBaseDTO<TIdentifierType>`, `where TIdentifierType : notnull`
  (`IEntityQueryService.cs:20-22`):
  - `IEntityDTOMapper<...> DTOMapper { get; }` (`IEntityQueryService.cs:25`), exposes the mapper so
    callers can do manual entity-to-DTO mapping outside the pipeline when needed (e.g. a custom join
    result).
  - `GetAllAsync(...)` (`IEntityQueryService.cs:37-43`), the **simple** overload: navigate FKs and/or
    children (`includeFKs`/`includeChildren`), optionally scope by `Specification`, optionally project
    `fields`, optionally track; returns `Task<Result<PagedCollectionResult<object>>>`.
  - `GetAllAsync(...)` (`IEntityQueryService.cs:60-71`), the **full** overload: adds `filters`
    (`Dictionary<string, (string Operator, string Value)>`, a dynamic filter map), `sortColumn`,
    `sortDirection` ("asc"/"desc"), `pageNumber`, `pageSize`. Callers pick the minimal overload for
    their use case.
  - `GetAllForLookupAsync(string nameProperty, ...)` (`IEntityQueryService.cs:82-87`), returns
    lightweight `IReadOnlyCollection<BaseLookup<TIdentifierType>>` id/name pairs for dropdowns, with
    optional `where` and `orderBy` expressions.
  - `GetEntityByIdAsync(string idValue, ...)` (`IEntityQueryService.cs:101-109`), returns the raw
    `Result<TEntity>` (the entity itself) for command handlers that need to mutate it; takes the id as a
    string plus an optional `idField` (defaulting to `"Id"`) so non-`Id` lookups are possible.
  - `GetByIdAsync(TIdentifierType id, ...)` (`IEntityQueryService.cs:123-130`), returns a projected
    `Result<object>` (typed DTO, or shaped object when a field subset was requested) for read-only detail
    responses.
  - `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, ...)`
    (`IEntityQueryService.cs:139-142`), a cheap existence check. Note it returns a bare `Task<bool>`, not
    a `Result`: absence is an answer, not a failure. `ignoreQueryFilters` bypasses the global query
    filters (soft-delete), which is how a uniqueness check can still see a soft-deleted row.
- **Why it's built this way**: a single generic read contract over every entity lets the generic
  controller base (G12) expose uniform list/detail/lookup/exists endpoints without per-entity query
  code, while the `object` return plus `fields` shaping keeps the wire payload caller-controlled without
  paying a shaping cost when no projection is asked for. Splitting `GetEntityByIdAsync` (raw entity) from
  `GetByIdAsync` (shaped DTO) cleanly separates the command-side need (an aggregate to mutate) from the
  query-side need (a projected response). [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html) records the trade-offs of the generic read layer.
- **Where it's used**: implemented by
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (this group, p01), which delegates navigation classification to
  [`INavigationMetadataProvider`](#inavigationmetadataprovider) and the heavy lifting to
  [`IEntityQueryPipeline`](#ientityquerypipeline); consumed by every read endpoint through the generic
  controller base (G12), for example ADC's
  [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller).

### NavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20` · Level 5 · class (sealed)

- **What it is**: the concrete implementation of
  [`INavigationMetadataProvider`](#inavigationmetadataprovider). It reflects over an entity's properties
  looking for [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), then asks
  the data-source service whether EF Core can `.Include()` each navigation or whether it needs manual
  loading, caching the answer per entity/navigation-kind.
- **Depends on**: [`INavigationMetadataProvider`](#inavigationmetadataprovider) (the contract),
  [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) (the `HaveIncludeSupport`
  check), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (the marker it
  reflects on), [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) /
  [`NavigationPropertyInfo`](group-11-navigation-populators.md#navigationpropertyinfo) /
  [`NavigationType`](group-11-navigation-populators.md#navigationtype) (the result types);
  `System.Reflection` and `System.Collections.Concurrent` (BCL).
- **Concept introduced, reflection-driven, host-scoped include classification.** `[Rubric §12,
  Performance & Scalability]` assesses whether repeated expensive work is memoized; reflection over
  every entity's properties runs once per (entity type, navigation kind) and is cached. The cache is a
  deliberate instance field, not `static`: the doc comment (`NavigationMetadataProvider.cs:22-27`)
  explains that classification depends on the *host's* data-source configuration, so a process hosting
  multiple service configurations (integration tests) must not share classification results across
  hosts. That is `[Rubric §14, Testability]` paying for a small amount of per-host recomputation.
- **Walkthrough**: constructed with an `IDataSourceService` (`NavigationMetadataProvider.cs:20`):
  - `private readonly ConcurrentDictionary<(Type EntityType, NavigationType NavType), NavigationMetadata>
    _cache` (`NavigationMetadataProvider.cs:28`), the per-host memoization store.
  - `BuildIncludes<TEntity>(bool includeFKs, bool includeChildren)`
    (`NavigationMetadataProvider.cs:31-50`), builds a fresh `NavigationMetadata`, adding the FK-reference
    classifications when `includeFKs` (`NavigationMetadataProvider.cs:35-40`) and the child-collection
    ones when `includeChildren` (`NavigationMetadataProvider.cs:42-47`). Note the returned object is new
    per call even though the per-kind classifications are cached.
  - `GetNavigationProperties` (`NavigationMetadataProvider.cs:52-53`), the cache lookup:
    `_cache.GetOrAdd(...)` computes `BuildNavigationMetadata` on a miss.
  - `BuildNavigationMetadata` (`NavigationMetadataProvider.cs:60-70`), reflects over the entity's public
    instance properties (`NavigationMetadataProvider.cs:64`) and classifies each.
  - `ClassifyNavigationProperty` (`NavigationMetadataProvider.cs:72-100`), reads the
    [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) and skips properties
    without one (`NavigationMetadataProvider.cs:74-76`), matches the attribute's `IsCollection` flag to
    the requested `NavigationType` (`NavigationMetadataProvider.cs:78-80`), unwraps the collection
    element type (`NavigationMetadataProvider.cs:86`), then calls
    `dataSourceService.HaveIncludeSupport(declaringEntityType.FullName, targetEntityType.FullName)`
    (`NavigationMetadataProvider.cs:96`, note it compares full type *names*, not `Type` handles) to sort
    the navigation into the supported or unsupported bucket
    (`NavigationMetadataProvider.cs:97-99`).
  - `UnwrapCollectionType` (`NavigationMetadataProvider.cs:106-116`), pulls the element type out of
    `ICollection<T>` / `IReadOnlyCollection<T>` so the compatibility check sees the actual target entity.
- **Why it's built this way**: classifying by reflection keeps navigation configuration declarative (an
  attribute on the property) rather than hand-registered, and caching per host makes the reflection cost
  a one-time hit while staying correct across differently-configured hosts ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) for the populator
  half of this story).
- **Where it's used**: injected into the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:33`), which calls
  `BuildIncludes` and passes the resulting
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) into
  [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline).

### CrossSourceSpecification
> MMCA.Common.Application · `MMCA.Common.Application.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` · Level 8 · class (static)

- **What it is**: a static helper that builds a specification filtering a *dependent* entity by a
  condition on a **cross-source principal** it references by foreign key. Its single public method,
  `BuildAsync`, resolves the matching principal keys first (a scalar projection query against the
  principal's own data source) and returns an
  [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) whose criteria is the
  engine-portable `localPredicate AND principalKeys.Contains(dependent.ForeignKey)`.
- **Depends on**: [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype)
  and [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (the return
  type), [`ParameterReplacer`](#parameterreplacer) (its private rebind visitor),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) with `GetReadRepository<,>` /
  `GetProjectedAsync` (G07) to query the principal source,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TPrincipal` constraint) and
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TDependent` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, cross-source filtering under polyglot persistence `[Rubric §8, Data
  Architecture]`.** In a database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) or polyglot ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) setup an entity and a
  related entity can live in *different physical data sources* (e.g. a Cosmos-stored `Session`
  referencing a SQL-Server `Event`). A query cannot join across physical sources, so a predicate that
  *navigates*, `s => s.Event.IsPublished`, is not translatable; on Cosmos the cross-source navigation is
  even degraded out of the model entirely by
  [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention).
  The engine-portable alternative is **resolve-then-filter-by-FK**: read the principal keys that satisfy
  the condition from the principal's own source, then filter the dependent by `foreignKey IN (those
  keys)`, which every provider translates (SQL `IN`, Cosmos `ARRAY_CONTAINS`). The convention is enforced
  by the opt-in fitness rule `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:24`),
  which ADC subclasses through
  [`SpecificationConventionTestsBase`](group-27-testing-infrastructure.md#specificationconventiontestsbase)
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8`).
- **Walkthrough**
  - `BuildAsync<TDependent, TDependentId, TPrincipal, TPrincipalId>(IUnitOfWork unitOfWork,
    Expression<Func<TPrincipal, bool>> principalPredicate, Expression<Func<TDependent, TPrincipalId>>
    dependentForeignKey, Expression<Func<TDependent, bool>>? localPredicate = null, CancellationToken =
    default)` (`CrossSourceSpecification.cs:39-64`), four type parameters: the dependent plus its id, and
    the principal plus its id (which is also the dependent's FK type). Constraints require
    `TPrincipal : AuditableBaseEntity<TPrincipalId>` (`CrossSourceSpecification.cs:47`), and the three
    reference arguments are null-guarded up front (`CrossSourceSpecification.cs:50-52`).
  - Resolves keys: `unitOfWork.GetReadRepository<TPrincipal, TPrincipalId>()`
    (`CrossSourceSpecification.cs:54`) then `GetProjectedAsync(p => p.Id, principalPredicate,
    asTracking: false, cancellationToken)` (`CrossSourceSpecification.cs:55-57`), materialized once into
    a list (`CrossSourceSpecification.cs:60`) so the predicate embeds a stable collection EF can
    translate.
  - `BuildCriteria` (`CrossSourceSpecification.cs:66-91`) reuses the FK selector's own parameter
    (`CrossSourceSpecification.cs:71`) and builds `Enumerable.Contains(keys, fk)` via `Expression.Call`
    (`CrossSourceSpecification.cs:74-79`); if a `localPredicate` is supplied it is rebound onto that same
    parameter via [`ParameterReplacer`](#parameterreplacer) (`CrossSourceSpecification.cs:85-86`) and
    ANDed with `Expression.AndAlso` (`CrossSourceSpecification.cs:87`), deliberately **not**
    `Expression.Invoke`, so the combined predicate stays translatable on every provider. The finished
    body is wrapped as a lambda over that parameter (`CrossSourceSpecification.cs:90`).
- **Why it's built this way**: it makes a module's storage engine a movable choice ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)): a
  session-by-published-event filter written this way keeps working whether `Session` is in SQL Server,
  SQLite, or Cosmos, with no query rewrite. Returning an `InlineSpecification` means the result drops
  straight into the existing [`IEntityQueryService`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and read-repository `specification` argument.
- **Where it's used**: ADC Conference's
  [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:26-33`),
  which resolves published `Event` ids and filters `Session.EventId IN (...)`, ANDed with a local
  status check that excludes declined and cancelled sessions (BR-132/BR-49). That handler is the
  refactor that replaced the former navigation-based public-session specification.
- **Caveats / not-in-source**: the matching keys are materialized and embedded in the predicate, so this
  fits **small/bounded** principal sets (the common "published events", "active tenants" shape); an
  unbounded principal set would inline a very large `IN` list. The class doc
  (`CrossSourceSpecification.cs:17-20`) states this explicitly. It is also a point-in-time snapshot: the
  keys are read before the dependent query runs, so a principal that changes state in between is not
  reflected until the specification is rebuilt.


---
[⬅ Domain Building Blocks (Entities, Value Objects, Aggregates)](group-02-domain-building-blocks.md)  •  [Index](00-index.md)  •  [Domain & Integration Events + Outbox Dual-Dispatch ➡](group-04-events-outbox.md)
